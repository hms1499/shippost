# Real x402 settlement for Groq on Base — design

**Date:** 2026-06-02
**Status:** Design approved, pending spec review
**Scope:** Replace the simulated x402 burn-to-sink for the **Groq** step with a
real x402 payment flow on **Base** (USDC), via our own x402-gated proxy and the
Coinbase facilitator.

## Background

Today x402 settlement is **simulated**: `settleX402Call` (lib/agent/orchestrator.ts)
calls `executeX402Call` on `AgentWallet`, which just `transfer`s stablecoin from
the contract to a sink address (default `0x…dead` burn). There is no HTTP 402,
no `X-Payment` intent, no facilitator, no real payee. The whole settlement is
denominated in cUSD (18 decimals); the cost constant is `GROQ_COST_CUSD =
parseEther('0.001')`.

Two facts shape this design:

1. **Upstream APIs don't speak x402.** Groq/Serper/CoinGecko have no native x402,
   so "real x402" cannot mean "Groq accepts x402." It means *we* stand up an
   x402-gated proxy in front of the service and the agent pays that proxy.
2. **The security model already anticipates this.** CLAUDE.md records that the
   old `/api/x402/*` routes were removed as an unauthenticated drain risk, with
   the rule: *"If a public agent-callable x402 surface is ever reintroduced, it
   MUST verify a signed `X-Payment` intent before settling."* Real x402 **is**
   that signed-intent verification — narrative goal and security requirement
   coincide.

**Goal:** make "the agent makes real x402 micro-payments to AI services" literally
true for the Groq step, in USDC on Base, on the standard's home turf (Coinbase
facilitator). This serves the product's x402/agent narrative.

**Non-goal:** moving Celo/MiniPay off its current `legacy` settlement. Celo keeps
push-to-sink; Base gets real x402, selected by a feature flag.

## Decisions made (with rationale)

These were genuine forks resolved during brainstorming; recorded so the rationale
isn't lost.

### D1 — "Real x402" = our own x402-gated proxy per service (not facilitator-pull, not selling ShipPost)

The agent calls *our* proxy → `402` → signs `X-Payment` → facilitator verifies &
settles USDC → proxy calls Groq with the real key → returns content. This is the
most faithful to the narrative **and** is the secure reintroduction of the proxy
surface the codebase already calls for. A pure on-chain facilitator-pull (no HTTP
402) was rejected: it moves more real money but is still not the x402 *protocol*,
so it half-simulates the exact thing we want to showcase. Exposing ShipPost
itself as an x402 resource server (others pay us) is a different monetization
layer and out of scope.

### D2 — Funds are spent from an EOA (EIP-3009), not from the AgentWallet contract

Coinbase x402 settles via EIP-3009 `transferWithAuthorization` on USDC, which
needs an **EOA** to produce the ECDSA signature. The `AgentWallet` *contract*
cannot sign. The existing orchestrator EOA (`AGENT_WALLET_PRIVATE_KEY`) holds
USDC and signs `X-Payment`. The ERC-8004 contract remains the **identity** anchor
(ERC-8004 is about identity/reputation, not mandatory custody). Trade-off: we
lose contract-custody. Mitigated by D3.

### D3 — Spend cap becomes a 3-layer defense, not the on-chain `CAP_EXCEEDED`

Moving to an EOA loses the contract's on-chain daily cap. Critically, an
**off-chain code check does not protect against a stolen key** — a thief signs
EIP-3009 directly, bypassing our code. So protection is layered:

- **Layer 1 — small hot float (the real security boundary):** the EOA holds only
  ~1 day of spend (e.g. $5–50), topped up from a cold treasury. Stolen key ⇒ max
  loss = the float. *This* is the durable protection, not code.
- **Layer 2 — off-chain daily counter (guards against our own bugs):** an Upstash
  Redis counter per UTC day per token, checked before signing. Stops a runaway
  loop/bug from draining the float. Does **not** stop key theft (that's Layer 1).
- **Layer 3 — kill switch:** a pause flag (env or Redis key) both client and proxy
  read; paused ⇒ client won't sign, proxy won't serve. Ultimate kill = stop
  funding the EOA / rotate the key. Weaker than on-chain `pause()` (a thief
  ignores the flag) — which is exactly why Layer 1 must exist.

Trade-off accepted: the EOA-float model is weaker against key theft than
contract custody, in exchange for x402-standard compatibility. Future hardening
(out of scope): smart account + ERC-1271 to restore an on-chain cap while staying
x402-compatible.

### D4 — Settle only *after* Groq succeeds (verify/settle split)

x402 separates `verify` and `settle`. The proxy **verifies** the `X-Payment`,
calls Groq, and **settles only on Groq success**. This strengthens the existing
"settle gates delivery" invariant into two guarantees:
- no content leaves the server before settle (no free content), and
- no charge when there's no content (Groq failure ⇒ no settle).

## Architecture

### Core restructure: "call the API" and "pay for it" merge

Today `groqStep` calls the Groq SDK directly, then settles separately. In the new
model the **proxy** makes the Groq call, so the agent pays *for that specific
call*. `groqStep` no longer imports the Groq SDK.

```
groqStep (new):  build prompt → payGroqViaX402(prompt) → { tweets, txHash }
                 → boundThread → emit step_settled / step_output
```

### New components

**1. x402 resource server — `app/api/x402/groq/route.ts`** (deployed on Base)
- No valid `X-Payment` → respond `402` with payment requirements: USDC on Base,
  `amount` = price (USDC, 6 dec), `payTo` = service treasury, scheme `exact`,
  network `base`.
- Valid `X-Payment` → **verify** (facilitator) → call Groq with server-side
  `GROQ_API_KEY` → on Groq success, **settle** (facilitator) → return
  `{ tweets, settlementTxHash }`. Holds the API key; never exposed to the client.
- This is the secure, payment-gated reintroduction of the proxy surface.

**2. x402 client — replaces the body of `settleX402Call`**
- Calls the proxy → on `402`, reads requirements → checks Layer-2 cap → signs
  EIP-3009 USDC authorization with the agent EOA → retries with `X-Payment` →
  returns `{ tweets, settlementTxHash }` parsed from the response / payment
  header. On any failure: throws (→ refundable).

**3. Cap ledger — Upstash Redis** (`@upstash/redis`, already a dependency)
```
key   = x402:spend:{YYYY-MM-DD}:{token}
total = INCRBY(key, amount); EXPIRE(key, seconds_to_next_utc_midnight)
if total > cap: DECRBY(key, amount); throw   // refundable, no spend
```
The INCRBY at the cap check (data-flow step 3) is the reservation; it is not
incremented again later. If the call later fails *after* reserving, the
reservation is left in place — over-counting is conservative (it only makes us
stop sooner), which is the safe direction for a spend cap.

**4. Facilitator** — Coinbase's hosted facilitator on Base (verify + settle).
Configured via env. (Exact package names / endpoints confirmed against current
x402 docs at planning time.)

### Unchanged (to limit blast radius)

`/api/generate/stream` (payment verification, replay guard, SSE state machine),
`ThreadPreview`, the refund flow, and the **route tests already written** — all
mock the pipeline layer, so they're unaffected. We only swap the settle internals
and add the proxy.

## Data flow (Mode A, Base)

```
User → ShipPostPayment (USDC, Base)                         [unchanged in shape]
  → /api/generate/stream: verifyPayment → insert pending → open SSE   [unchanged]
  → groqStep:
       1. client calls proxy (with prompt)
       2. proxy → 402 + USDC requirements
       3. client reserves cap in Redis (INCRBY + check, Layer 2); throw if over
       4. client signs EIP-3009, recalls with X-Payment
       5. proxy verifies signature (no settle yet)
       6. proxy calls Groq → content
       7. proxy SETTLES USDC via facilitator   (only if step 6 succeeded)
       8. proxy returns { tweets, settlementTxHash }
  → emit step_settled(txHash) → boundThread → emit step_output → done  [unchanged]
```

## Error handling

Invariant preserved: every failure → thread `failed`, `fatal` emitted, refundable,
no orphaned charge.

| Failure | Settled? | Outcome |
|---|---|---|
| Layer-2 cap exceeded (before signing) | No | failed, **zero spend** |
| Paused (Layer 3) | No | failed, zero spend |
| Sign/verify `X-Payment` fails, facilitator down | No | failed, refundable |
| **Groq fails in proxy** | **No** (settle is after Groq) | failed, **no charge** |
| Settle fails *after* Groq success | In-flight | proxy **withholds content**, returns error → client treats as fail → refundable; no free content |
| Settle/receipt timeout | Unknown | bounded wait (keep 90s) → throw → refundable |

## Testing

- **Unit — x402 client** (mock `fetch`): 402-then-200; asserts EIP-3009 signature
  built correctly, cap checked, throws on cap exceeded, parses `settlementTxHash`.
- **Unit — proxy route** (mock facilitator verify/settle + Groq SDK): no
  `X-Payment` → 402; Groq error → **settle not called**; Groq OK → settle *then*
  return content; settle error → content withheld, error returned.
- **Unit — cap ledger** (mock Redis): daily accumulation, UTC-midnight reset,
  DECRBY-on-exceed.
- **Reuse** the existing route + pipeline tests unchanged (they mock the layer
  below) — the reason they were written first: a safety net for this refactor.
- **Integration** on **Base Sepolia** with the testnet facilitator + test USDC:
  one end-to-end Mode A run.

## Rollout (staged risk)

1. **Base Sepolia first** — deploy contracts + proxy, fund agent EOA with test
   USDC, run the full x402 loop. No mainnet exposure.
2. **Feature flag** `X402_SETTLE_MODE` (`legacy` | `x402`) selects the settle
   layer. Base → `x402`; Celo/MiniPay → `legacy` (untouched).
3. **Base mainnet** — once Sepolia is solid: fund the EOA with a **small float**
   (Layer 1), enable the flag, monitor.

## Config / env additions

`X402_FACILITATOR_URL`, `X402_PROXY_BASE_URL`, `USDC_BASE_ADDRESS`,
`X402_DAILY_CAP_USDC`, `X402_SETTLE_MODE` (`legacy`/`x402`). Upstash vars already
present. Cost stays a **single source of truth** (human string like `'0.001'`,
raw computed per `token.decimals`, mirroring `computeTokenAmount`), so the
displayed cost cannot drift from what settles.

## Scope

**In scope:** x402 proxy + client for **Groq**, the 3-layer cap, decimals-aware
token/cost config, the tests above, Base Sepolia → mainnet rollout.

**Out of scope (separate specs):** Serper/CoinGecko proxies (replicate this
pattern), the wallet-environment abstraction + multi-chain wagmi (long-term
roadmap steps 1–2), smart-account / ERC-1271 on-chain cap.

## Open items to confirm at planning time

- Exact x402 package(s) and facilitator endpoint, verified against current docs
  (do not rely on memorized APIs).
- Base Sepolia facilitator + test USDC availability for the integration test.
