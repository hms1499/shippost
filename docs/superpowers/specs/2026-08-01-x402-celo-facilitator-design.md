# Route Model 2 x402 through the Celo facilitator — design

**Date:** 2026-08-01
**Status:** Design approved, pending spec review
**Scope:** Let Model 2 (the service we *sell* at `/api/x402/groq`) settle on
**Celo mainnet** through the hosted Celo x402 facilitator, selected by env,
without removing the working Base/CDP path.

## Background

Model 2 is real x402 and has been live on **Base** since 2026-06-03: `generateDraft`
→ `payGroqViaX402` (`lib/x402/client.ts`) signs an EIP-3009 `X-Payment` with the
agent EOA, calls our own `/api/x402/groq`, and the Coinbase CDP facilitator settles
USDC on Base to `X402_PAY_TO`. Model 1 (Celo, in-process through `AgentWallet`)
is unrelated and unchanged — see [`.claude/docs/x402.md`](../../../.claude/docs/x402.md).

Everything about that flow is chain-agnostic except three things: the chain entry
in `lib/x402/config.ts`, the facilitator auth in `lib/x402/server.ts`, and the
daily-cap key in `lib/x402/cap.ts`.

### What was verified before writing this

- **Celo USDC (`0xcebA9300f2b948710d2653dD7B07f33A8B32118C`) supports EIP-3009.**
  `authorizationState(address,bytes32)` reads cleanly; `version()` is `2`. The
  scheme the client already signs works on Celo without change.
- **The payer is already funded on Celo.** The agent EOA
  `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78` holds **4.15 USDC** on Celo
  (and 1.08 USDC on Base). EIP-3009 is gasless for the payer — the facilitator's
  relayer submits the transaction — so no CELO top-up is required for settlement.
- **The facilitator charges per settlement.** x402.celo.org sells **prepaid
  credits: 1 credit = 1 settlement, flat $0.001**, bought with USDC; connecting a
  wallet and signing a message (no gas, no transaction) yields an API key plus
  **500 free credits**. Auth is `X-API-Key: x402_live_…`, not a bearer token and
  not a CDP JWT.
- **The facilitator was down while this was written.** `api.x402.celo.org`
  returned HTTP 500 on every registered route (`/supported`, `/health`) and its
  relayer `0x0d74d5cefd2e7f24e623330ebe3d8d4cb45ffb48` sent **zero transactions
  for ~2 hours** after averaging ~35–50/minute earlier the same day (nonce
  239,926 → 244,139 between 11:38 and 13:38 UTC, then flat). Its own status
  widget still read "Celo mainnet · operational".

## Goal and non-goals

**Goal:** make Model 2 settle on Celo when configured to, so the agent's own
service payment lands on the same chain the user pays on, and so those
settlements are attributable to CoinOp's registered wallet.

**Non-goals:**

- Moving Model 1 off its in-process `executeX402Call` path. Groq/Serper/CoinGecko
  do not speak x402; nothing changes there.
- Removing Base. It stays configured and working; the switch is an env flip and
  so is the rollback.
- Chasing the hackathon's `most-x402-payments` count. Model 2 produces **one
  settlement per paid thread**, so honest volume tracks real usage. Rejected
  explicitly: generating settlements in a loop to move a leaderboard.

## Decisions made (with rationale)

**Add Celo as another configured chain rather than replacing Base.** The
facilitator's uptime is unproven — it was returning 500s during design — and the
CDP path is proven in production. Keeping both makes rollback an env change
rather than a revert.

**Select the facilitator auth scheme explicitly, not by inference.** Today
`buildAuthHeaders` (`lib/x402/server.ts:22`) checks `CDP_API_KEY_ID` first, so
merely pointing `X402_FACILITATOR_URL` at Celo would still mint Coinbase JWTs
against the Celo host and fail authentication in a way that looks like a
facilitator outage. A new `X402_FACILITATOR_AUTH` names the scheme.

**Accept one daily-cap reset at cutover.** `cap.ts:30` keys the counter by token
address, so changing chains starts a fresh counter for the remainder of that UTC
day. Worst case is one day at up to 2× the cap ($5 default → $10). Cheaper to
document than to migrate a Redis key, and the cap is a safety net rather than a
budget.

**Pay to the wallet already registered in the hackathon submission.**
`X402_PAY_TO` becomes `0x006cBA3012139C299Aa4A522697B4A0c49F38895`, the
`agentWalletAddress` on file. Track 2 attributes settlements by the registered
wallet appearing as payer or payee; the payer is an EOA, so the payee is what
must match. No submission edit needed.

**Resolve the facilitator's wire format before writing code.** See Risks.

## Architecture

Unchanged in shape. `payGroqViaX402` signs, `/api/x402/groq` verifies before the
handler and settles only after a 2xx, and delivery stays gated on settlement.
Only the chain entry, the auth header, and the cap key differ.

```
generateDraft
  └─ payGroqViaX402 (lib/x402/client.ts)      agent EOA signs EIP-3009 X-Payment
       └─ POST /api/x402/groq                  (our own resource server)
            └─ x402ResourceServer.verify ──►  facilitator  ── CDP (Base)
                 handler runs (Groq)                        └─ X-API-Key (Celo)
            └─ settle ─────────────────────►  facilitator
                                                └─ relayer submits
                                                   transferWithAuthorization
                                                   payer EOA → X402_PAY_TO
```

## Components

### 1. `lib/x402/config.ts` — add Celo mainnet

Add `42220` to `CONFIG`:

| field | value |
|---|---|
| `caip2` | `eip155:42220` |
| `usdc` | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| `usdcDecimals` | `6` |

Celo Sepolia is **out of scope** — the testnet USDC address has not been
confirmed, and guessing it would produce a config that fails only at settle time.
Add it in a follow-up once verified against the facilitator's `/supported`.

`getSettleMode`, `getSettleChainId`, `priceRawUSDC` and `dailyCapRawUSDC` need no
change: they are already chain-agnostic and `isX402Chain` gates on `CONFIG`.

The comment on `getSettleMode` currently says "is a supported Base chain" — it
must be corrected, since Base is no longer the only option.

### 2. `lib/x402/server.ts` — explicit auth selection

Replace the implicit precedence in `buildAuthHeaders` with a named scheme read
from `X402_FACILITATOR_AUTH`:

| value | headers | required env |
|---|---|---|
| `cdp` | `Authorization: Bearer <per-operation JWT>` | `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` |
| `api-key` | `X-API-Key: <key>` | `X402_FACILITATOR_API_KEY` |
| `bearer` | `Authorization: Bearer <token>` | `X402_FACILITATOR_TOKEN` |
| `none` | none | — |

When `X402_FACILITATOR_AUTH` is unset, fall back to today's behaviour exactly
(CDP if both CDP vars are present, else static bearer if `X402_FACILITATOR_TOKEN`
is set, else none) so an un-migrated environment keeps working.

A named scheme whose required env is missing must **throw when the resource
server is built** (lazily, on the first request — `getResourceServer` memoises)
rather than silently degrade to no-auth: an unauthenticated facilitator call
fails anyway, and failing early names the actual cause instead of surfacing as a
facilitator error.

The `X-API-Key` header is returned for all three operations (`verify`, `settle`,
`supported`) — unlike the CDP JWT it is not per-path.

### 3. `lib/x402/cap.ts` — namespace the counter by chain

Key becomes `x402:spend:${day}:${caip2}:${token}`. This makes two chains'
budgets independent instead of colliding, at the cost of one reset on the day of
the cutover (see Decisions).

### 4. Operations

- Obtain the API key at x402.celo.org (connect wallet, sign a message) → store as
  `X402_FACILITATOR_API_KEY`. Vercel CLI v54 `env add` writes `""`; use the REST
  upsert and read the value back.
- Env to set on production: `X402_FACILITATOR_AUTH=api-key`,
  `X402_FACILITATOR_API_KEY=…`, `X402_FACILITATOR_URL=https://api.x402.celo.org`,
  `X402_CHAIN_ID=42220`, `X402_PAY_TO=0x006cBA3012139C299Aa4A522697B4A0c49F38895`.
  `NEXT_PUBLIC_*` inlining does not apply — all of these are server-side.
- 500 free credits cover 500 settlements; top up with USDC before that runs out.
  At one settlement per paid thread, that is 500 threads.

## Data flow and money

Per paid thread, in Celo mode:

| leg | amount | who pays |
|---|---|---|
| user → `ShipPostPayment` | $0.05 | the user (unchanged, Model 1 path) |
| agent EOA → `X402_PAY_TO` (USDC, EIP-3009) | $0.001 | us, to ourselves |
| facilitator credit | $0.001 | us, to Celo Core Co. |
| gas for the settlement | — | the facilitator's relayer |

The facilitator fee equals the service price, so Model 2 on Celo costs $0.001 per
thread in real money that Base does not. That is the price of the rail, and it is
recorded here so nobody later reads the self-payment as revenue.

## Error handling

No new failure semantics. Every failure below already leaves the run refundable
and is covered by the existing degrade path:

- **Facilitator unreachable or 5xx** (its state during design): `payGroqViaX402`
  throws, `generateDraft` alerts ops and falls back to Model 1 in-process for the
  Groq step. The thread still completes.
- **Auth rejected (bad or exhausted API key):** same path. Credits running out is
  therefore a degradation, not an outage — but it is silent, so the alert message
  must distinguish a 401/402 from a 5xx.
- **Cap or pause tripped:** unchanged, both are checked before any payment.
- **Deadline fired:** unchanged, `throwIfAborted` before and during the fetch.

## Testing

Existing suites (`lib/x402/*.test.ts`) already cover config selection, cap
behaviour and the resource-server build; extend rather than replace:

- `config.test.ts` — Celo is a supported chain; an unknown chain still degrades
  to `legacy`.
- `server.test.ts` — each `X402_FACILITATOR_AUTH` value produces the right
  headers; a named scheme with missing env throws; unset preserves today's
  precedence.
- `cap.test.ts` — two chains keep independent counters under the new key.

End-to-end is **not** unit-testable: it needs the live facilitator. Acceptance is
a real settlement on Celo mainnet whose transaction shows
`transferWithAuthorization` from the agent EOA to `X402_PAY_TO`, submitted by the
facilitator relayer.

## Risks

**The facilitator's wire format may not match `HTTPFacilitatorClient`.** The
landing page advertises `POST /settle` with `{"payment": "<x402-payload>",
"network": "celo"}`, while `@x402/core`'s client posts the standard
`{x402Version, paymentPayload, paymentRequirements}`. If the hosted facilitator
really speaks the simplified shape, `HTTPFacilitatorClient` cannot be reused and
this design grows a custom facilitator client — a materially larger change.

**This must be resolved first.** Fetch `GET /supported` once the service is
healthy and compare against the x402 spec's facilitator interface; if it
disagrees, stop and redesign rather than adapting inline.

**The facilitator is a single hosted dependency with demonstrated downtime and no
status page worth trusting.** Acceptable only because failure degrades to Model 1
rather than failing the thread.

## Out of scope

- Celo Sepolia configuration (needs a verified testnet USDC address).
- Model 1 changes of any kind.
- Any settlement generated other than by a real paid thread.
