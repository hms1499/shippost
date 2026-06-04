# Product quick-wins — Batch A design

**Date:** 2026-06-04
**Status:** approved, ready for implementation plan

Three product improvements bundled as one low-risk batch: share attribution
(viral loop), a public agent-spend dashboard + Mode B hero (competition
narrative), and documentation accuracy fixes.

## Scope

**In (Batch A):**
- Task 2 — share attribution on the auto-posted tweet
- Task 4 — aggregate agent-spend dashboard on `/stats` + make Mode B the hero
- Task 5 — fix documentation inaccuracies (agent cap value, stale README architecture)

**Out:**
- Task 1 (raise ERC-20 allowance to cut per-thread approve tx) — **dropped** by
  decision; keep the current `approve(amount)` per-thread flow.
- Task 3 (free first tweet / paywall) — **deferred to its own spec.** It inverts
  the pay→generate ordering and touches the "verify payment before any paid
  work" security invariant; it is not a quick win and must be brainstormed
  separately.

---

## Task 2 — Share attribution

**File:** `components/ShareToX.tsx`

`postFirstTweet(text)` auto-posts only the first tweet (`tweets[0]`) via the
`twitter://post` deep link with a web `intent/tweet` fallback. Attribution is
appended **only to the shared text**, never to the `tweets` array or
`ThreadPreview` — the user's edited content stays clean (non-destructive). The
first tweet is the highest-visibility surface, so attribution there maximizes
the loop.

### Behaviour

- **Suffix:** `\n\n✍️ made with ShipPost — https://shippost.app`
  (`https://shippost.app` is a **placeholder** canonical URL.)
- **280-char guard:** if `tweets[0] + suffix` exceeds 280 chars, fall back to a
  short form `\n\nvia ShipPost https://shippost.app`; if still over, **omit the
  suffix entirely**. Never truncate the user's own text.
- **Toggle:** a checkbox "Add ShipPost credit" in the ShareToX card, default
  **ON**. When off, share without the suffix. Local component state; no
  persistence required.

### New dependency

- `NEXT_PUBLIC_APP_URL` — canonical MiniApp URL, default
  `https://shippost.app`. Add to `.env.example` and a small lib constant with a
  hardcoded fallback so a missing env never breaks sharing.

### Approach note

Chosen over an "extra attribution tweet card" because it can't be accidentally
deleted from the thread, doesn't consume a tweet slot, and lands on the
most-seen tweet.

---

## Task 4 — Aggregate agent-spend dashboard + Mode B hero

Pure read-extension of the existing analytics path. **No new table, no on-chain
indexer, no live feed** — aggregates only.

### Data source (already present in `threads`)

- `total_cost_usd` (text) — per-thread agent x402 spend
- `groq_tx_hash`, `serper_tx_hash`, `coingecko_tx_hash`, `fact_check_tx_hash` —
  one per settled x402 call; count of non-null = number of calls
- `token_symbol`, `mode`, `status`

### `/api/public/analytics` — extend response

- `agentSpendUsd` — `sum(total_cost_usd)` over `status = 'completed'` threads
- `x402CallCount` — count of non-null `*_tx_hash` across those rows
- `byToken` (optional) — thread count + spend grouped by `token_symbol`

The endpoint already selects the tx-hash columns, so this is an additive change.

### `/app/stats` — new "Agent economy" section

Render: total agent x402 spend · number of x402 calls · number of threads, with
a link to **AgentWallet on Celoscan** (to inspect `X402PaymentMade` events) and
to ShipPostPayment. Reinforces the "AI agent that spends real money,
auditable" story for the Proof of Ship AI-Agents category.

### Mode B hero

In the mode picker, make **Mode B (Hot Take) the default selection** and add a
badge `grounded · fact-checked · live data`. Mode B's live Serper/CoinGecko
grounding + fact-check pass is the real differentiator vs a generic LLM; Mode A
(Groq-only) stays available but secondary.

---

## Task 5 — Documentation accuracy fixes

### Source of truth

AgentWallet daily spend cap: **$10/day/token on mainnet** (`scripts/deploy-mainnet.ts`,
`DAILY_CAPS = 10`), **$50 on testnet** (`scripts/deploy.ts`). The contract has no
hardcoded cap — it is set per deployment via `setDailySpendCap`.

### Fix 1 — cap value

Files currently stating `$50/token/day` must read **"$10/token/day mainnet
($50 testnet)"**:
- `CLAUDE.md` (Key Constraints + Core Logic mention)
- `.claude/docs/architecture.md` (AgentWallet quick-reference)
- `docs/ARCHITECTURE.md` §2.1 and §3.3

`README.md` already states $10 — leave it. (Note: the $50 was introduced into
`CLAUDE.md` / `.claude/docs/` in commit `e4dc347`; this corrects that.)

### Fix 2 — README stale architecture

`README.md` lines ~90–113 ("Component view" + "x402 proxy") describe
`/api/x402/serper`, `/api/x402/coingecko`, `/api/x402/fact-check` proxy routes
settling via AgentWallet. Those unauthenticated proxies were **removed in
`8f4c222`**; Model 1 runs in-process with **no HTTP proxy routes**. The README
is also internally inconsistent about `/api/x402/groq` (describes it both as an
AgentWallet-settle proxy and as the CDP/Base route).

Rewrite to match `docs/ARCHITECTURE.md` §2.3:
- **Model 1** (per-thread generate) = in-process x402 *simulation* pulling from
  AgentWallet via `settleX402Call`; no public proxy routes.
- **`/api/x402/groq`** = Model 2 only: real x402 on Base via the CDP
  facilitator, caller pays us; does not touch AgentWallet.

---

## Testing

- **Task 2:** unit-test the share-text builder — suffix appended when room;
  short form near the 280 boundary; suffix omitted when even short form
  overflows; suffix absent when toggle off. (`pnpm test:lib`)
- **Task 4:** unit-test the analytics aggregation (sum of `total_cost_usd`,
  count of non-null tx hashes) against fixture rows; manual check of `/stats`
  render and Celoscan links.
- **Task 5:** docs only — no automated test; verify cap numbers against the
  deploy scripts and the architecture claims against §2.3.

## Out-of-scope guardrails (don't regress)

- Attribution must never mutate the editable `tweets` array.
- The dashboard is read-only aggregation; do not add write paths or expose any
  non-public field.
- Doc fixes must not change behaviour — text only.
