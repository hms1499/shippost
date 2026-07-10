# Comparison Mode (Chain vs Chain) — Design

**Date:** 2026-07-10
**Status:** Approved design → ready for implementation plan
**Mode id (on-chain, append-only):** `4` — key `comparison`

## Summary

A new paid generation mode that produces an X thread comparing **two blockchains**
(e.g. Solana vs Base) and **always picks a data-grounded winner**. It reuses the
vetted `runModeB` settle/delivery orchestration via overrides — exactly the
pattern already used by `tokenAnalysis` (id 2) and `dailyRecap` (id 3) — so it
inherits the *settle-gates-delivery* invariant for free and adds no new spend
path.

### Decisions locked during brainstorming

| Question | Decision |
|----------|----------|
| What is compared | **Chain vs chain** (not token vs token) |
| Output framing | **Always pick one winner**, justified from the data |
| Chain input | **Dropdown whitelist** of ~14 major chains (client), re-validated server-side |
| Degrade when both chains lose TVL | **Soft-fail** — thread still ships (consistent with other modes); factCheck still runs |
| Architecture | **Reuse `runModeB(overrides)`** (Approach A) |
| Native token (CoinGecko) | **Dropped for this mode** — mcap is a poor/duplicative chain signal (Base has no token; it uses ETH, so "Base mcap" == "Ethereum mcap"). Hard data = DefiLlama chain TVL + 7d momentum. |

## Why DefiLlama, not CoinGecko

For a chain, on-chain **TVL** and its **momentum** are the meaningful "size and
growth" signals. CoinGecko native-token mcap breaks down for chains: Base and
other L2s have no native token and settle in ETH, so their mcap would duplicate
Ethereum's and mislead the verdict. This mode therefore grounds on
DefiLlama chain TVL (hard data) + Serper narrative (color), and reuses the free
`coingecko` step *lifecycle slot* as the umbrella "market data" step — the same
fold `dailyRecap` already does with `defiLine()`.

## Cost

Identical to Hot Take / Token Analysis: **3 x402 settles** — Serper (narrative)
+ Groq (draft, gates delivery) + factCheck. All DefiLlama fetches are free and
carry no settle (the `coingecko` step is excluded from `totalCost` in
`runModeB`'s `wrappedEmit`). Flat $0.05/thread revenue unchanged.

## Components & files

### New

- **`lib/pipeline/modes/comparison.ts`** — `ModeDef` (id 4, key `comparison`).
  - `validateInput(body)`: parse `body.topic` into two chain keys; both must be
    in the whitelist and must differ; else return a 400 message (no paid work).
  - `run(ctx, body, emit)`: call `runModeB` with overrides (see Data flow).
  - `preview(input)`: settle-free draft mirroring the paid path — free
    DefiLlama + free `fetchSerper` + `generateTweets`. Never settles/persists.

- **`lib/prompts/comparison.ts`**
  - `CHAINS` whitelist: `Record<key, { defiLlamaName: string; label: string }>`
    (~14 entries). One exported source of truth, consumed by both server
    validation and the client dropdown.
  - `parseChains(topic): [key, key] | null` — split `"solana|base"`, lowercase,
    validate against `CHAINS`, reject equal keys.
  - `serperQueryFor(aLabel, bLabel): string` — narrative query naming both.
  - `buildComparisonPrompt({ aLabel, bLabel, chainData, searchSummary })`.

- **`components/ChainComparisonInput.tsx`** — two chain dropdowns (A ≠ B),
  token selector + pay row, following `TokenAnalysisInput` structure. Emits a
  payload the parent turns into `{ mode: 4, topic: "<aKey>|<bKey>" }`.

### Touched (additive, small)

- **`lib/pipeline/defiLlamaStep.ts`**
  - `fetchChainTvl(chain): Promise<{ tvlUsd: number; change7dPct: number | null } | null>`
    — reads existing `/v2/chains` for absolute TVL + `/v2/historicalChainTvl/{chain}`
    for 7d momentum. Soft: returns `null` on any failure or no match.
  - `summarizeChainTvl(aLabel, a, bLabel, b): string | null` — one/two-line
    "A: TVL $X (+7d%) | B: TVL $Y (−7d%)" snippet, or `null` if both null.
- **`lib/pipeline/modes/index.ts`** — register `comparisonMode` in `MODES`.
- **`components/ModePicker.tsx`** — add `'comparison'` entry (display numeral V;
  on-chain id stays 4). Blurb + `grounded · TVL · fact-checked` badge, cost `$0.003`.
- **`app/HomeClient.tsx`** — render `ChainComparisonInput` for the new mode and
  map its payload to the request body (`topic = "<aKey>|<bKey>"`).

## Data flow (server)

```
comparison.run(ctx, body, emit):
  [aKey, bKey] = parseChains(body.topic)          // re-validated; 400 already gated
  A = CHAINS[aKey], B = CHAINS[bKey]
  return runModeB({
    ...ctx,
    angle: 'skeptical',                            // required by type; prompt fully overrides
    eventDescription: `${A.label} vs ${B.label}`,  // fallback only
    serperQuery: serperQueryFor(A.label, B.label), // 1 Serper settle — narrative color
    serperOpts: { recency: 'qdr:m' },
    marketStep: async (c, emit) => {               // FREE, emits 'coingecko' lifecycle
      emit step_started 'coingecko'
      const [a, b] = await Promise.all([fetchChainTvl(A.defiLlamaName),
                                        fetchChainTvl(B.defiLlamaName)])
      emit step_settled 'coingecko' (free / cost 0) + step_output
      return summarizeChainTvl(A.label, a, B.label, b)   // null if both failed
    },
    buildPrompt: ({ searchSummary, marketSnippet }) =>
      buildComparisonPrompt({ aLabel: A.label, bLabel: B.label,
                              chainData: marketSnippet, searchSummary }),
  }, emit)
  // runModeB then: Groq draft (settle, gates delivery) → factCheck (settle)
```

The internals of `runModeB` are **not modified** — only overrides are passed.
This preserves settle-gates-delivery: content emits still happen only after the
Groq settle confirms.

## Verdict prompt (`buildComparisonPrompt`)

Instructions:

1. **Pick one winner explicitly**, stated in the opening tweet.
2. **Justify only from the provided data** — the TVL/momentum snippet and the
   Serper narrative. Do not invent numbers.
3. Devote **one tweet to the loser's genuine strength** so the thread reads as
   analysis, not blind shilling — reduces bias risk.
4. Close with "one thing to watch" for the loser.
5. Keep house voice/system prompt; factCheckStep runs afterward and cross-checks
   the tweets against `searchSummary` + `chainData`.

## Chain whitelist (initial ~14)

Ethereum, Solana, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, Sui,
Aptos, Tron, Celo, Blast, zkSync. Each maps to its exact DefiLlama chain name
(the `name` field in `/v2/chains`). Final list tunable during implementation;
the invariant is that every whitelisted key resolves to a DefiLlama chain so
TVL is always available on the happy path.

## Error handling / invariants

- **Serper soft-fail** → verdict proceeds on chain-TVL (hard data intact).
- **DefiLlama soft-fail** → `summarizeChainTvl` returns `null`; if **both**
  chains lack TVL the verdict leans on Serper narrative + model knowledge.
  **Soft-fail chosen** (thread still ships) for consistency with
  Educational/Hot Take; factCheck still runs.
- **Settle gates delivery** — untouched (overrides only).
- **`preview()`** never settles, never spends from AgentWallet, never persists a
  row — enforced by the existing source-guard test that covers all modes.
- **No route/body change** — both chains ride in the existing `topic` field
  (`ModeInputBody` unchanged), same trick `tokenAnalysis` uses for its ticker.
- **Contract unchanged** — `ThreadRequested`'s `uint8 mode` is append-only; id 4
  needs no redeploy.

## Testing

- `lib/pipeline/modes/comparison.test.ts` — mock `runModeB`, assert:
  - `serperQuery` mentions both chain labels;
  - `buildPrompt` is invoked (comparison prompt, not Hot Take);
  - `validateInput` rejects unknown chain, equal chains, and missing input.
- `lib/pipeline/defiLlamaStep.test.ts` — add cases for `fetchChainTvl`
  (name match, 7d momentum, soft-null on error) and `summarizeChainTvl`
  (both-null → null, one-null → single line).
- Existing preview source-guard test automatically covers the new mode.

## Out of scope (YAGNI)

- Per-chain Serper (Approach B, 4 settles) — dropped for cost/risk.
- Stablecoin-supply-per-chain signal — possible v2 enrichment.
- Free-text chain entry / aliases — whitelist dropdown only for reliability.
- Token-vs-token comparison — a separate future mode if wanted.
