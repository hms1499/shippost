# Hot Take prompt — signal-extraction body + angle close

**Date:** 2026-05-06
**Scope:** `lib/prompts/modeB.ts`
**Status:** approved, ready for implementation

## Why

Current Mode B prompt bakes the chosen angle (`bullish` / `bearish` / `skeptical`)
into every tweet — lead, anchor, middle, prediction, and close. The result reads
as one continuous opinion piece. Two problems:

1. **Signal under-use.** The user already gives the most context-rich input we
   have (their description of the event). Spreading angle across the whole
   thread leaves no slot dedicated to extracting and presenting those signals
   neutrally.
2. **Skeptical drift.** Forcing `skeptical` into a thread-wide angle pushes the
   model toward fake-balanced wordsmithing. Skeptical readers want the open
   questions, not a "balanced" verdict.

The fix: separate **exposition** (signals from description + Serper + CoinGecko)
from **interpretation** (a single angle-specific close).

## Behaviour change (user-visible)

| | Before | After |
|---|---|---|
| Body tweets (T1 → T(n-1)) | Each tweet leans toward the chosen angle | Neutral signal extraction. Mix of hard facts and light implications, no verdict adjectives. |
| Penultimate tweet | Angle-specific falsifiable prediction | Final signal or implication, still neutral. |
| Closing tweet (Tn) | Closing observation, angle-aligned | The *only* angle-specific tweet. Asymmetric: bull/bear deliver a 1-line verdict; skeptical delivers an evidence-test. |
| Tweet count (5-9) | unchanged | unchanged |
| Honest-cite rule (no invented numbers/names) | unchanged | unchanged |

## Structure prompt (new)

The body section of `STRUCTURE` becomes:

```
- T1: hook framing the event in plain terms. No question opener,
      no "in this thread", no angle adjectives.
- T2: anchor signal — the single most verifiable fact about this event,
      drawn directly from the user description, search context, or market data.
- T3 ... T(n-1): additional signals. Each tweet does ONE of:
      (a) present a hard fact (named entity, number, date, contract, EIP, protocol)
      (b) draw a single light implication from a signal already on the table
          ("3 client teams committed → adoption pressure on the rest")
      No directional adjectives ("massive", "huge", "critical risk").
      Body must read as a neutral exposition of what is known.
- T(n): the only angle-specific tweet. See ANGLE rules below.

Constraints (unchanged):
- Cite only facts that appear in description / search / market context, or are universally known.
- Stay on the single event the user named. No drifting to adjacent stories.
```

## Angle close rules (new)

Replace `ANGLE_BRIEF` with a conclusion-only directive that branches per angle:

```
bullish:
  T(n) is one short verdict line: "net bullish on <event> because <signal X>."
  Pick the single signal from the body that, on net, supports a long-side
  position. No hedging, no DYOR, no "but". 1 sentence.

bearish:
  T(n) is one short verdict line: "net bearish on <event> because <signal X>."
  Pick the single signal from the body that, on net, supports a short-side
  position. No hedging, no DYOR, no "but". 1 sentence.

skeptical:
  T(n) is one evidence-test line: "what would change my mind: <specific
  observable signal Z>." The Z must be concrete and falsifiable —
  a number above/below a threshold, a named protocol shipping by a date,
  a contract reaching a TVL level, etc. No verdict, no fence-sitting prose.
```

The close enforces a 1-sentence cap so it can't pad into pseudo-balance.

## Few-shot example (rewrite)

Current example demonstrates a thread-wide skeptical voice. New example shows
the new shape: 4 neutral signal tweets followed by one skeptical evidence-test
close. Use the same Dencun event so the swap is self-contained:

```
Sample event: Dencun upgrade activated on Ethereum mainnet, March 13 2024.
Sample search context: (4 lines of facts as in current prompt)
Sample angle: skeptical

<example_thread>
1/ Dencun activated on Ethereum mainnet on March 13 2024 and changed how
L2s post data to L1.

2/ Pre-Dencun, L2s settled calldata at the same gas market as everyone else.
EIP-4844 introduced a separate blob fee market, target 3 blobs per block,
max 6.

3/ In the days after activation, L2 user fees on Arbitrum, Optimism, and
Base fell roughly 10x. Throughput limits on those L2s are now a function
of blob supply, not L1 calldata gas.

4/ Blob base fees have hovered near zero since launch — supply has run
ahead of demand. That means the cost L2s pay for L1 data is currently
not a meaningful ETH burn input.

5/ What would change my mind: a sustained stretch (>2 weeks) where blob
base fees stay non-zero and L2 throughput continues to climb.
</example_thread>
```

This keeps the few-shot under 10 lines, removes the angle-leaning lines from
the old version, and demonstrates the asymmetric `skeptical` close.

## What stays the same

- `system.ts` (VOICE / DO NOT WRITE / FORMAT) untouched.
- Serper and CoinGecko summaries continue to feed `buildModeBPrompt` via
  `searchSummary` and `marketSnippet`. Their position in the prompt and the
  "use as ground truth" framing are unchanged.
- `LENGTH_GUIDANCE` (5-9 tweets, hard floor 4, hard cap 10) unchanged.
- `Angle` type union, `summarizeSerper`, `summarizeMarket` — no signature change.
- Thread parser, fact-check step, runModeB pipeline — no change. Output shape
  is still N numbered tweets.

## Out of scope

- Tuning prompts for Mode A (Educational).
- Changing how Serper / CoinGecko summarize their inputs.
- Reworking `system.ts` voice rules.
- Any UI change in `HotTakeInput` or `GeneratingStatus`.
- Adding a new angle (e.g. `contrarian`) — the current 3-angle union stays.

## Risks

- **Model drift back to thread-wide angle.** Llama-3.3-70B may still slip a
  bullish adjective into a body tweet. Mitigation: the new STRUCTURE explicitly
  bans directional adjectives in the body; few-shot models the neutral tone.
- **Skeptical evidence-test gets vague.** "I'd need more data" is the failure
  mode. Mitigation: ANGLE rule for `skeptical` requires the test to be
  concrete and falsifiable — number, threshold, named protocol, date.
- **Bullish/bearish close gets hedgy.** Models trained on safety-tuned data
  add caveats. Mitigation: ANGLE rule for `bullish` / `bearish` says
  "no hedging, no DYOR, no 'but'. 1 sentence."

## Acceptance

- `pnpm exec tsc --noEmit` clean.
- `pnpm build` clean.
- A manual smoke run on `/api/x402/groq` (or via the UI) for each angle on
  the same event description produces:
  - 5-9 tweets total
  - body tweets (T1 → T(n-1)) free of directional adjectives from the system
    prompt's banned-words list, and no verdict statements
  - exactly one verdict / evidence-test in T(n), matching the chosen angle
- The Dencun example in `FEW_SHOT_EXAMPLE` matches the new structure.

No new tests are required (current `lib` tests do not assert on prompt
content). The change is prompt-only; the runtime contract with the rest of
the pipeline is identical.
