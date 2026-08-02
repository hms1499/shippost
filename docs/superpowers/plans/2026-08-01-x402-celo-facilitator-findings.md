# x402 Celo facilitator — Task 1 findings (blocking spike)

**Probed:** 2026-08-02, 02:07–02:25 UTC
**Plan:** [`2026-08-01-x402-celo-facilitator.md`](2026-08-01-x402-celo-facilitator.md) Task 1
**Spec:** [`../specs/2026-08-01-x402-celo-facilitator-design.md`](../specs/2026-08-01-x402-celo-facilitator-design.md)

## Verdict: **NO-GO**

Not for the reason the spec expected. The *envelope* question resolved in our
favour — the facilitator speaks the standard x402 facilitator interface and
`HTTPFacilitatorClient` posts a body it accepts. But the **kind** it actually
serves is `(x402Version 1, bare network name)`, and our stack emits
`(x402Version 2, CAIP-2)`. Those do not intersect.

Adding `caip2: 'eip155:42220'` to `CONFIG` as Task 2 describes would produce a
config that builds, typechecks, passes its unit tests, and then fails at the
first live `verify` with `unsupported_scheme` — precisely the "fails only at
settle time" outcome the spec set out to avoid.

**Per the plan's global constraint, Tasks 2–5 do not start.** Return to the spec.

## Step 1 — is the facilitator up?

`api.x402.celo.org` (mainnet), 2026-08-02 02:07 UTC:

| route | result |
|---|---|
| `GET /supported` | **500** `Internal Server Error` after 11.5s |
| `GET /health` | **500** `Internal Server Error` after 11.0s |
| `POST /verify` | **500** `Internal Server Error` after 11.2s |
| `POST /settle` | **401** `{"error":"unauthorized","message":"Missing X-API-Key"}` in 0.79s |

Still down, ~36 hours after the 2026-08-01 outage recorded in the spec. The
`/settle` 401 is not a sign of health: it is the auth middleware answering
before the request reaches the dead backend. The ~11s uniform latency on every
other route is a backend timeout.

**One thing confirmed by it:** the auth header is `X-API-Key`, exactly as the
spec assumed. `X402_FACILITATOR_AUTH=api-key` is the right scheme name.

## Step 2 — is the relayer settling?

Relayer `0x0d74d5cefd2e7f24e623330ebe3d8d4cb45ffb48`, nonce on Celo mainnet:

| block | time (UTC) | nonce |
|---|---|---|
| 73735704 | 2026-08-02T02:07:42Z | 244,139 |
| 73732104 | 2026-08-02T01:07:42Z | 244,139 |
| 73649304 | 2026-08-01T02:07:42Z | 233,557 |
| 73562904 | 2026-07-31T02:07:42Z | 222,917 |

Normal throughput is ~10,600 tx/day. The nonce has not moved since ~13:38 UTC
on 2026-08-01. The mainnet facilitator has settled **nothing for ~12.5 hours**
and counting. Its own status widget still reads "operational" — as before,
probe the relayer nonce, never the status page.

## Step 3 — the wire format

The mainnet host is unobservable, so the format was resolved two other ways.

### 3a. A testnet host exists (not in the spec)

`api.x402.sepolia.celo.org` — found in the landing page's JS bundle
(`/assets/index-C7yW9BvL.js`), not in any prose. **It is up.**

`GET /supported` → `200`:

```json
{"kinds":[{"x402Version":1,"scheme":"exact","network":"celo-sepolia"},
          {"x402Version":2,"scheme":"exact","network":"eip155:11142220","extra":{}}],
 "extensions":[],
 "signers":{"eip155:11142220":["0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48"]}}
```

This is the standard x402 `supported` shape. Same relayer address as mainnet.

### 3b. The envelope is standard — the landing page is marketing shorthand

The spec's stated risk was that the facilitator speaks
`{"payment":"<payload>","network":"celo"}` instead of the standard
`{x402Version, paymentPayload, paymentRequirements}`. **It does not.** That curl
snippet is decorative copy in the marketing bundle, not the wire format.

Posting a well-formed *standard* body to `POST /verify` got past schema
validation and kind matching and all the way to an on-chain call:

```json
{"isValid":false,"invalidReason":"unexpected_error",
 "invalidReasonDetails":"Contract call failed: contract call to `name` returned no data (\"0x\"); the called address might not be a contract",
 "payer":""}
```

— failing only because the probe deliberately passed a non-contract asset
address (`0x…0001`). Responses use the standard `verifyResponse` shape
(`isValid` / `invalidReason` / `invalidReasonDetails` / `payer`), which is what
`HTTPFacilitatorClient`'s `VerifyError` branch keys on.

**So `HTTPFacilitatorClient` is reusable. The spec's headline risk is closed.**

### 3c. The blocker: it serves only one of the two kinds it advertises

Four probes, byte-identical except for `x402Version` and the `network` string
(in both `paymentPayload` and `paymentRequirements`):

| `x402Version` | `network` | result |
|---|---|---|
| **1** | **`celo-sepolia`** | **accepted** — reached the on-chain call |
| 1 | `eip155:11142220` | `unsupported_scheme`, HTTP 400 |
| 2 | `celo-sepolia` | `unsupported_scheme`, HTTP 400 |
| 2 | `eip155:11142220` | `unsupported_scheme`, HTTP 400 |

Only the pair `(1, celo-sepolia)` is served — the *first* entry in `kinds`. The
second entry, `(2, eip155:11142220)`, is advertised by `/supported` and then
rejected by `/verify`. **The facilitator's own `/supported` is wrong.**

The mainnet bare name is presumably `celo` (that is what the marketing curl
uses), but this is unverified while mainnet is 500.

### 3d. Ruled out: a malformed request on our side

`https://x402.celo.org/skill.md` — the official integration doc, found via the
README of `celo-org/x402-celo-example-deprecated` — states that Celo is **not**
in the x402 packages' default-asset table, so the asset and its EIP-712 domain
must be named explicitly (`extra: { name: "USDC", version: "2" }`), and that a
bare `price: "$0.01"` will 500. The first probes omitted `extra` and used a
placeholder asset, so the matrix was re-run correctly:

| body | result |
|---|---|
| v2 + `eip155:11142220` + real Sepolia USDC + `extra` | `unsupported_scheme`, 400 |
| v1 + `celo-sepolia` + **same** asset + **same** `extra` | `insufficient_funds`, 400 |

The v1 control passed kind matching, scheme validation, asset resolution *and*
an on-chain balance read — `insufficient_funds` is correct, the agent EOA holds
no Sepolia USDC. Only `x402Version` and `network` differ between the two rows.

**`extra` and the asset are not the cause.** And the rejected combination is
precisely the one `skill.md` instructs every integrator to use:

> **Networks:** Celo mainnet is CAIP-2 `eip155:42220`; Celo Sepolia testnet is
> `eip155:11142220`.

with `server.register("eip155:*", new ExactEvmScheme())` and `@x402` **v2**
packages. So the facilitator contradicts both its own `/supported` and its own
documentation. This is a facilitator defect, not an integration mistake.

### 3e. Two spec unknowns closed in passing

- **Celo Sepolia USDC is `0x01C5C0122039549AD1493B8220cABEdD739BC44E`** (from
  `skill.md`). The spec put Sepolia out of scope solely because this address was
  unverified; that reason no longer holds.
- **The EIP-712 domain is `name: "USDC", version: "2"`** on both networks, and
  mainnet USDC matches the spec's `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`.

### 3f. Context: Celo is moving x402 → MPP

`celo-org/x402-celo-example-deprecated` is archived. Its live successor,
`celo-org/mpp-celo-example` (pushed 2026-07-16), is **not** an x402 example — it
implements the **Machine Payments Protocol** (`WWW-Authenticate: Payment`
challenge → credential → receipt), settled by the same hosted facilitator, and
describes itself as "verified end-to-end on Celo (testnet **and** mainnet)".

That is a plausible explanation for the half-served kind table: x402 v2 support
looks de-prioritised mid-migration. It also means a v1 client written today
would be built against the path Celo is walking away from.

### 3g. What our stack emits

- `@x402/{core,evm,next,fetch}` are all **2.14.0**, and the EVM exact scheme
  hard-codes `x402Version: 2`.
- `lib/x402/server.ts:64` registers the scheme under `cfg.caip2`, i.e.
  `eip155:*`.

We emit `(2, eip155:42220)` — the combination the facilitator rejects. There is
no env flip that changes this; it is what the installed protocol version is.

## Consequences for the design

The spec's three-change plan (chain table, auth scheme, cap key) is sound and
unaffected on its own terms. Auth (`X-API-Key`) is confirmed correct. What
breaks is the unstated assumption that a CAIP-2 chain entry is sufficient.

Options, for the spec to decide between — **not** to be adapted inline:

1. **Wait and re-probe.** The v2/CAIP-2 kind is advertised *and* documented, so
   it is clearly intended — either unfinished or broken. This costs nothing and
   is the only option that keeps `HTTPFacilitatorClient` as-is. It depends on a
   service that has now been down ~36h.
2. **Report the discrepancy to Celo.** `/supported` and `skill.md` both specify
   a kind that `/verify` rejects; the matrix in §3c–3d reproduces it in four
   curl calls. Concrete, well-evidenced, and it blocks anyone following the
   official doc — not just us. Pairs naturally with (1).
3. **Speak v1 to this facilitator.** Needs a custom facilitator client or a
   pinned older `@x402` — the "materially larger change" the spec named. Worse
   than the spec thought: §3f suggests v1 is the path Celo is leaving. Not worth
   it for a $0.001 self-payment on a rail with this uptime record.
4. **Stay on Base.** Zero work, keeps a proven path. The cost is that Model 2
   settlements remain unattributable to Celo.

Recommendation: **(2) then (1)**. Do not build a v1 client.

## Reproducing

```bash
# mainnet: still 500?
curl -s -w '\n[%{http_code}]\n' https://api.x402.celo.org/supported

# testnet: up, and what does it advertise?
curl -s https://api.x402.sepolia.celo.org/supported

# the kind matrix — flip x402Version and network, keep everything else fixed
curl -s -X POST https://api.x402.sepolia.celo.org/verify \
  -H 'content-type: application/json' --data-binary @probe.json
```

`probe.json` is a standard `{x402Version, paymentPayload, paymentRequirements}`
body with `scheme: "exact"`, asset `0x01C5C0122039549AD1493B8220cABEdD739BC44E`
and `extra: {"name":"USDC","version":"2"}`. Any syntactically valid EIP-3009
authorization works — the kind is matched long before the signature is checked.
Flip `x402Version` between 1 and 2 and `network` between `celo-sepolia` and
`eip155:11142220`, in **both** `paymentPayload` and `paymentRequirements`.

Reference doc: <https://x402.celo.org/skill.md>.
