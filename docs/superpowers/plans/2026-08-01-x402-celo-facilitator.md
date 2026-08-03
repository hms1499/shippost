# x402 Celo facilitator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Model 2 (the service we sell at `/api/x402/groq`) settle USDC on Celo mainnet through the hosted Celo x402 facilitator, selected by env, without disturbing the working Base/CDP path.

**Architecture:** Three small, independent changes to `lib/x402/`: add Celo to the chain table, replace the facilitator's implicit auth precedence with an explicitly named scheme, and namespace the daily-spend counter by chain. Nothing about the payment flow, the verify-before-handler rule, or Model 1 changes. Switching chains — and rolling back — is an env change.

**Tech Stack:** TypeScript, `@x402/core` + `@x402/next` + `@x402/evm`, viem, Upstash Redis, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-01-x402-celo-facilitator-design.md`. Read it before Task 1.
- **Task 1 is a hard gate.** If the facilitator's wire format does not match `HTTPFacilitatorClient`, stop and redesign. Do not adapt inline.
- **Celo mainnet** (chainId `42220`, USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`, 6 decimals) **and Celo Sepolia** (`11142220`, USDC `0x01C5C0122039549AD1493B8220cABEdD739BC44E`). Sepolia was out of scope only while its USDC was unverified; the Task 1 probes resolved that asset on-chain, and it is what lets the shim be exercised off mainnet.
- **Base must keep working.** No task removes the CDP path or its env vars.
- **Never move a `step_output` emit before its settle**, and never expose `settleX402Call` unguarded — see `.claude/docs/x402.md`.
- **Model 1 is untouched.** No edits under `lib/pipeline/` or `lib/agent/`.
- `X402_PAY_TO` on production must be `0x006cBA3012139C299Aa4A522697B4A0c49F38895` — the wallet registered in the hackathon submission.
- Run `npx tsc --noEmit` before every commit: `pnpm test:lib` and `pnpm build` do not typecheck `*.test.ts`.

---

### Task 1: Resolve the facilitator wire format (blocking spike) — **DONE 2026-08-02, re-probed 2026-08-03: GO via a v1 shim**

> **Re-probe 2026-08-03 (findings §4–§5) supersedes the gate below.** Mainnet is
> back up and settling, and the kind mismatch is confirmed on *both* networks —
> §3c's "only the first `kinds` entry is served" was wrong, it is v1-only
> whatever the advertised order. What changed is the price of the workaround:
> `@x402/core` already ships the v1 schemas and the EIP-3009 signature is
> indifferent to the envelope, so the downgrade is a ~50-line adapter at one
> call site rather than the custom client this spike costed.
>
> **Verdict: GO via `lib/x402/facilitator-v1.ts` (Task 2b). Tasks 2–5 unblocked**,
> and Celo Sepolia is in scope now that its USDC is verified. The shim is proven
> on the wire against both live hosts (findings §5).

> **Original outcome (2026-08-02): NO-GO. Tasks 2–5 must not start.** Findings:
> [`2026-08-01-x402-celo-facilitator-findings.md`](2026-08-01-x402-celo-facilitator-findings.md).
> The envelope question resolved *in our favour* — the facilitator speaks the
> standard interface and `HTTPFacilitatorClient` is reusable. The blocker is a
> different one: it serves only `(x402Version 1, bare network name)` on
> `/verify`, while `@x402` 2.14.0 emits `(2, eip155:*)`. It advertises the v2
> kind in `/supported` and then rejects it. Auth (`X-API-Key`) is confirmed.
> Mainnet has been 500 for ~36h; the testnet host
> `api.x402.sepolia.celo.org` is up and is what the matrix was probed against.

The spec's one open question. The Celo facilitator's landing page advertises `POST /settle` with `{"payment": "<x402-payload>", "network": "celo"}`, while `@x402/core`'s `HTTPFacilitatorClient` posts the standard `{x402Version, paymentPayload, paymentRequirements}`. If they differ, none of the tasks below are the right work.

**Files:**
- Create: `docs/superpowers/plans/2026-08-01-x402-celo-facilitator-findings.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a go/no-go decision for Tasks 2–5, plus the confirmed facilitator base URL and the exact auth header name.

- [x] **Step 1: Check whether the facilitator is up at all**

```bash
for p in /supported /health /verify; do
  printf "%-12s " "$p"
  curl -s --max-time 15 -o /tmp/x402probe -w "%{http_code}\n" "https://api.x402.celo.org$p"
  head -c 300 /tmp/x402probe; echo
done
```

Expected when healthy: `/supported` returns `200` with JSON. It returned **500 on every route** on 2026-08-01, and the relayer `0x0d74d5cefd2e7f24e623330ebe3d8d4cb45ffb48` had been idle for ~2 hours. **If it is still 500, stop here** — record the timestamp in the findings file and end the task. Do not write code against an API you cannot observe.

- [x] **Step 2: Confirm the relayer is actually settling**

```bash
node -e '
const {createPublicClient,http}=require("viem");
const c=createPublicClient({transport:http("https://forno.celo.org")});
(async()=>{
  const R="0x0d74d5cefd2e7f24e623330ebe3d8d4cb45ffb48";
  const latest=await c.getBlockNumber();
  for (const back of [0n,3600n,86400n]) {
    const bn=latest-back;
    const n=await c.getTransactionCount({address:R,blockNumber:bn});
    const b=await c.getBlock({blockNumber:bn});
    console.log(bn, new Date(Number(b.timestamp)*1000).toISOString(), "nonce="+n);
  }
})()'
```

Expected: the nonce increases between the 1-hour-ago and now samples. A flat nonce means the service is down regardless of what any status page says.

- [x] **Step 3: Compare the response shape against what the client sends**

Read `GET /supported` and check it returns the x402 `supported` shape — a list of `{x402Version, scheme, network}` entries — and that `network` uses CAIP-2 (`eip155:42220`) rather than a bare string like `"celo"`.

Then read the installed client to see exactly what it posts:

```bash
grep -rn "verify\|settle\|x402Version" node_modules/@x402/core/dist/**/*facilitator* | head -30
```

- [x] **Step 4: Record the decision**

Write `docs/superpowers/plans/2026-08-01-x402-celo-facilitator-findings.md` containing: the probe timestamp, the raw `/supported` body, the auth header name the docs require, and one of two verdicts stated explicitly:

- **GO** — the facilitator speaks the standard interface; `HTTPFacilitatorClient` is reusable; continue to Task 2.
- **NO-GO** — the shapes differ; stop, and return to the spec to design a custom facilitator client. Do not start Task 2.

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-01-x402-celo-facilitator-findings.md
git commit -m "docs(x402): probe the Celo facilitator's wire format"
```

---

### Task 2: Add Celo mainnet to the x402 chain table — **DONE 2026-08-03** (`3e4b613`)

> Shipped wider than planned: Celo **Sepolia** too (its USDC is verified now), and
> each Celo entry carries a `v1Network` bare name. That field is not decoration —
> its presence is what selects the shim in Task 2b, so deleting it is the rollback.

**Files:**
- Modify: `lib/x402/config.ts:20-34` (add the Celo entry), `lib/x402/config.ts:46-50` (fix the stale "Base chain" comment)
- Test: `lib/x402/config.test.ts:21-37` (two existing tests assert Celo is *unsupported* — they must change)

**Interfaces:**
- Consumes: nothing.
- Produces: `getX402ChainConfig(42220)` returns `{ caip2: 'eip155:42220', usdc: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', usdcDecimals: 6 }`; `isX402Chain(42220) === true`. Task 4 uses `cfg.caip2` as a cap-key component.

- [x] **Step 1: Update the two tests that encode "Celo is not supported"**

In `lib/x402/config.test.ts`, replace the `throws for non-Base chains` test and fix the settle-mode test, which uses Celo as its example of an unsupported chain. Add `const UNSUPPORTED = 1;` (Ethereum mainnet) next to the existing chain constants.

```ts
  it('maps Celo mainnet to CAIP-2 + canonical USDC (6 dec)', () => {
    expect(getX402ChainConfig(CELO).caip2).toBe('eip155:42220');
    expect(getX402ChainConfig(CELO).usdc.toLowerCase())
      .toBe('0xceba9300f2b948710d2653dd7b07f33a8b32118c');
    expect(getX402ChainConfig(CELO).usdcDecimals).toBe(6);
    expect(isX402Chain(CELO)).toBe(true);
  });

  it('throws for chains with no x402 config', () => {
    expect(() => getX402ChainConfig(UNSUPPORTED)).toThrow();
    expect(isX402Chain(UNSUPPORTED)).toBe(false);
  });

  it('x402 only when flag=x402 AND X402_CHAIN_ID is a configured chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'x402');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('x402');
    expect(getSettleChainId()).toBe(BASE);

    vi.stubEnv('X402_CHAIN_ID', String(CELO)); // Celo is now configured too
    expect(getSettleMode()).toBe('x402');

    vi.stubEnv('X402_CHAIN_ID', String(UNSUPPORTED)); // flag on, unconfigured chain
    expect(getSettleMode()).toBe('legacy');

    vi.stubEnv('X402_CHAIN_ID', 'garbage'); // flag on, unparseable
    expect(getSettleMode()).toBe('legacy');
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/x402/config.test.ts`
Expected: FAIL — `getX402ChainConfig(42220)` throws `no x402 config for chain 42220`.

- [x] **Step 3: Add the Celo entry**

In `lib/x402/config.ts`, next to the Base constants:

```ts
const BASE_MAINNET = 8453;
const BASE_SEPOLIA = 84532;
const CELO_MAINNET = 42220;
```

and inside `CONFIG`:

```ts
  // Celo mainnet. USDC here is Circle's native issuance and supports EIP-3009
  // (`authorizationState` reads, `version()` is "2"), which is what the exact
  // scheme signs — so no client-side change is needed to settle here.
  // Celo Sepolia is deliberately absent: its USDC address is unverified, and a
  // wrong one would only fail at settle time.
  [CELO_MAINNET]: {
    caip2: 'eip155:42220',
    usdc: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    usdcDecimals: 6,
  },
```

- [x] **Step 4: Fix the stale comment on `getSettleMode`**

Replace "is a supported Base chain" with wording that no longer claims Base is the only option:

```ts
// x402 only when explicitly enabled AND the settlement chain (X402_CHAIN_ID) is
// a configured chain; everything else stays legacy. Deliberately NOT keyed on
// the user's payment chain — that stays Celo either way (Model 1). The settle
// chain is an independent choice: Base via CDP, or Celo via the hosted Celo
// facilitator (spec docs/superpowers/specs/2026-08-01-x402-celo-facilitator-design.md).
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/x402/config.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [x] **Step 6: Commit**

```bash
git add lib/x402/config.ts lib/x402/config.test.ts
git commit -m "feat(x402): configure Celo mainnet as a settlement chain"
```

---

---

### Task 2b: Speak v1 to the facilitator — **DONE 2026-08-03** (`4fa3831`, `18b63ea`)

Added by the 2026-08-03 re-probe. `@x402` has no server-side v1 path
(`registerV1` is client-only; `x402ResourceServer.register` takes a CAIP-2
`Network`), so the translation happens in one adapter at the facilitator
boundary and nowhere else.

**Files:**
- Create: `lib/x402/facilitator-v1.ts`, `lib/x402/facilitator-v1.test.ts`
- Modify: `lib/x402/server.ts` (wrap the facilitator when `cfg.v1Network` is set)

- [x] **Step 1: `V1DowngradeFacilitator`** — payload to `{x402Version: 1, scheme,
  network, payload}`; requirements `amount` → `maxAmountRequired` plus the
  `resource`/`description`/`mimeType` v2 hoisted onto the payload; the settled
  network mapped back to CAIP-2 so the bare name cannot leak into
  `X-PAYMENT-RESPONSE`; `getSupported()` states the v2 CAIP-2 kind itself,
  because the resource server refuses to build a 402 challenge for a kind the
  facilitator does not advertise.
- [x] **Step 2: refuse a foreign chain.** One shim, one chain — rewriting another
  network's payment would settle real money on the wrong chain.
- [x] **Step 3: select it from the chain table**, not from an env flag, so the
  rollback is deleting `v1Network`.
- [x] **Step 4: prove it on the wire** against both live hosts — findings §5.
  Sepolia reaches `insufficient_funds`, mainnet reaches `ECRecover: invalid
  signature length` inside the real USDC contract. Neither is
  `unsupported_scheme`.

---

### Task 3: Select the facilitator auth scheme explicitly — **DONE 2026-08-03** (`76580b8`)

Today `buildAuthHeaders` checks `CDP_API_KEY_ID` first, so pointing `X402_FACILITATOR_URL` at Celo while CDP vars remain set would mint Coinbase JWTs against the Celo host — an auth failure that reads like a facilitator outage.

**Files:**
- Modify: `lib/x402/server.ts:21-50` (`buildAuthHeaders`)
- Test: `lib/x402/server.test.ts`

**Interfaces:**
- Consumes: `X402_FACILITATOR_URL` (unchanged).
- Produces: `X402_FACILITATOR_AUTH` ∈ `cdp | api-key | bearer | none`; when set to `api-key`, every operation carries `X-API-Key: <X402_FACILITATOR_API_KEY>`. Unset preserves today's precedence exactly.

- [x] **Step 1: Write the failing tests**

Append to the `describe` block in `lib/x402/server.test.ts`. Also add `delete process.env.X402_FACILITATOR_AUTH;` and `delete process.env.X402_FACILITATOR_API_KEY;` to the existing `beforeEach`.

```ts
  it('api-key: sends X-API-Key on every operation and never touches CDP', async () => {
    process.env.X402_FACILITATOR_AUTH = 'api-key';
    process.env.X402_FACILITATOR_API_KEY = 'x402_live_abc';
    process.env.X402_FACILITATOR_URL = 'https://api.x402.celo.org';
    // CDP creds present but must be ignored — this is the trap the named
    // scheme exists to close.
    process.env.CDP_API_KEY_ID = 'key-id';
    process.env.CDP_API_KEY_SECRET = 'key-secret';

    const { getResourceServer } = await import('./server');
    getResourceServer();

    const headers = (await captured.config!.createAuthHeaders!()) as {
      verify: Record<string, string>;
      settle: Record<string, string>;
      supported: Record<string, string>;
    };
    expect(headers.verify['X-API-Key']).toBe('x402_live_abc');
    expect(headers.settle['X-API-Key']).toBe('x402_live_abc');
    expect(headers.supported['X-API-Key']).toBe('x402_live_abc');
    expect(headers.verify.Authorization).toBeUndefined();
    expect(generateJwt).not.toHaveBeenCalled();
  });

  it('a named scheme with its env missing throws instead of degrading to no auth', async () => {
    process.env.X402_FACILITATOR_AUTH = 'api-key'; // no X402_FACILITATOR_API_KEY
    const { getResourceServer } = await import('./server');
    expect(() => getResourceServer()).toThrow(/X402_FACILITATOR_API_KEY/);
  });

  it('an unknown scheme name throws rather than silently picking one', async () => {
    process.env.X402_FACILITATOR_AUTH = 'oauth';
    const { getResourceServer } = await import('./server');
    expect(() => getResourceServer()).toThrow(/X402_FACILITATOR_AUTH/);
  });

  it('scheme=none sends no auth even when CDP creds are present', async () => {
    process.env.X402_FACILITATOR_AUTH = 'none';
    process.env.CDP_API_KEY_ID = 'key-id';
    process.env.CDP_API_KEY_SECRET = 'key-secret';
    const { getResourceServer } = await import('./server');
    getResourceServer();
    expect(captured.config?.createAuthHeaders).toBeUndefined();
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/x402/server.test.ts`
Expected: FAIL — the `api-key` test gets `Authorization: Bearer jwt:...` because the CDP branch wins; the throwing tests get no throw.

- [x] **Step 3: Rewrite `buildAuthHeaders`**

Replace the body of `buildAuthHeaders` in `lib/x402/server.ts` with an explicitly named scheme, keeping the legacy precedence as the unset default:

```ts
type AuthScheme = 'cdp' | 'api-key' | 'bearer' | 'none';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for X402_FACILITATOR_AUTH=${process.env.X402_FACILITATOR_AUTH}`);
  return v;
}

// Which facilitator auth to use, named rather than inferred. Inference was a
// trap: CDP creds outlive a chain switch, so a Celo facilitator URL would still
// get Coinbase JWTs and fail as if the facilitator were down. Unset keeps the
// old precedence so existing deployments are unaffected.
function resolveScheme(): AuthScheme {
  const raw = process.env.X402_FACILITATOR_AUTH;
  if (!raw) {
    if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) return 'cdp';
    if (process.env.X402_FACILITATOR_TOKEN) return 'bearer';
    return 'none';
  }
  if (raw === 'cdp' || raw === 'api-key' || raw === 'bearer' || raw === 'none') return raw;
  throw new Error(`X402_FACILITATOR_AUTH must be cdp | api-key | bearer | none (got "${raw}")`);
}

function buildAuthHeaders(facilitatorUrl: string): (() => Promise<AuthHeaders>) | undefined {
  const scheme = resolveScheme();

  if (scheme === 'none') return undefined;

  // CDP (Base mainnet): the Coinbase facilitator rejects a static bearer — it
  // needs a JWT whose host+method+path are baked in (~2min TTL). We mint one per
  // operation against the facilitator's own base path. generateJwt is imported
  // lazily so the other paths (and tests) don't load the CDP SDK.
  if (scheme === 'cdp') {
    const apiKeyId = requireEnv('CDP_API_KEY_ID');
    const apiKeySecret = requireEnv('CDP_API_KEY_SECRET');
    const u = new URL(facilitatorUrl);
    const host = u.host;
    const base = u.pathname.replace(/\/$/, '');
    return async () => {
      const { generateJwt } = await import('@coinbase/cdp-sdk/auth');
      const bearer = async (requestMethod: string, requestPath: string) => ({
        Authorization: `Bearer ${await generateJwt({ apiKeyId, apiKeySecret, requestMethod, requestHost: host, requestPath })}`,
      });
      const [verify, settle, supported] = await Promise.all([
        bearer('POST', `${base}/verify`),
        bearer('POST', `${base}/settle`),
        bearer('GET', `${base}/supported`),
      ]);
      return { verify, settle, supported };
    };
  }

  // Celo's hosted facilitator meters prepaid credits against an API key, and
  // sends it under X-API-Key rather than Authorization. Same header on every
  // operation — unlike the CDP JWT it is not scoped to a path.
  if (scheme === 'api-key') {
    const h = { 'X-API-Key': requireEnv('X402_FACILITATOR_API_KEY') };
    return async () => ({ verify: h, settle: h, supported: h });
  }

  const h = { Authorization: `Bearer ${requireEnv('X402_FACILITATOR_TOKEN')}` };
  return async () => ({ verify: h, settle: h, supported: h });
}
```

Note the existing module already declares `type AuthHeaders` above `buildAuthHeaders`; keep it.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/x402/server.test.ts && npx tsc --noEmit`
Expected: PASS — including the three pre-existing tests (no-auth, CDP, static bearer), which cover the unset-default path.

- [x] **Step 5: Commit**

```bash
git add lib/x402/server.ts lib/x402/server.test.ts
git commit -m "fix(x402): name the facilitator auth scheme instead of inferring it"
```

---

### Task 4: Namespace the daily spend counter by chain — **DONE 2026-08-03** (`db58bb8`)

`cap.ts` keys the counter by token address alone, so two chains would share one budget and a cutover silently resets it. Namespacing by CAIP-2 makes the budgets independent; the one-time reset on cutover day is accepted and documented in the spec.

**Files:**
- Modify: `lib/x402/cap.ts:24-38` (`reserveDailySpend`), `lib/x402/client.ts:69` (the only caller)
- Test: `lib/x402/cap.test.ts`

**Interfaces:**
- Consumes: `cfg.caip2` from `getX402ChainConfig` (Task 2).
- Produces: `reserveDailySpend({ caip2, token, amountRaw, capRaw })` — `caip2` is a new **required** parameter; the Redis key becomes `x402:spend:${day}:${caip2}:${token}`.

- [x] **Step 1: Write the failing test**

Add to the `reserveDailySpend` describe block in `lib/x402/cap.test.ts`:

```ts
  it('keys the counter by chain so two chains do not share one budget', async () => {
    incrby.mockResolvedValue(1000);
    await reserveDailySpend({
      caip2: 'eip155:8453', token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    });
    await reserveDailySpend({
      caip2: 'eip155:42220', token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    });

    const keys = incrby.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toContain('eip155:8453');
    expect(keys[1]).toContain('eip155:42220');
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toMatch(/^x402:spend:\d{4}-\d{2}-\d{2}:eip155:8453:0xusdc$/);
  });
```

Then add `caip2: 'eip155:8453',` to the two existing `reserveDailySpend` calls in that file so they still typecheck.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/x402/cap.test.ts`
Expected: FAIL — the key has no `eip155:` segment.

- [x] **Step 3: Add `caip2` to the key**

In `lib/x402/cap.ts`:

```ts
export async function reserveDailySpend(params: {
  caip2: string;
  token: string;
  amountRaw: bigint;
  capRaw: bigint;
}): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  // Namespaced by chain: the same token symbol has a different address per
  // chain, and two settlement chains must not share one budget. Changing this
  // key shape resets the running counter once, on the day it ships — bounded at
  // one extra cap's worth of spend, which the cap exists to bound anyway.
  const key = `x402:spend:${day}:${params.caip2}:${params.token}`;
```

The rest of the function is unchanged.

- [x] **Step 4: Update the caller**

In `lib/x402/client.ts:69`:

```ts
  await reserveDailySpend({ caip2: cfg.caip2, token: cfg.usdc, amountRaw: priceRawUSDC(), capRaw: dailyCapRawUSDC() });
```

- [x] **Step 5: Run the full lib suite to verify nothing else called it**

Run: `pnpm test:lib && npx tsc --noEmit`
Expected: PASS — `caip2` is required, so any missed caller is a type error, not a silent wrong key.

- [x] **Step 6: Commit**

```bash
git add lib/x402/cap.ts lib/x402/cap.test.ts lib/x402/client.ts
git commit -m "fix(x402): namespace the daily spend cap by settlement chain"
```

---

### Task 5: Tell an exhausted key apart from a facilitator outage — **DONE 2026-08-03** (`cbe8ec4`)

Credits are prepaid and finite. When they run out the rail stops, every thread quietly degrades to Model 1, and the ops alert says only that the proxy failed — which reads as "the facilitator is down" and sends whoever is on call to the wrong place. The spec calls for the error to name the difference.

**Files:**
- Modify: `lib/x402/client.ts:94-97` (the `!res.ok` branch)
- Test: `lib/x402/client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the error thrown by `payGroqViaX402` starts with `x402 payment rejected` for 401/402/403 and `x402 groq proxy failed` for everything else. `generateDraft` already forwards this message into the ops alert unchanged.

- [x] **Step 1: Write the failing test**

Append to the `describe('payGroqViaX402', …)` block in `lib/x402/client.test.ts`. That file already provides everything needed: the mocked fetch is `payFetch`, the response helper is `res(body, status)`, and the request fixture is the module-level `params` — use them rather than hand-rolling a response object.

```ts
  it('names a rejected payment separately from a proxy outage', async () => {
    payFetch.mockResolvedValue(res({ error: 'insufficient credits' }, 402));
    await expect(payGroqViaX402(params)).rejects.toThrow(
      /x402 payment rejected \(402\).*credit or key/i,
    );
  });

  it('still reports a 5xx as a proxy failure', async () => {
    payFetch.mockResolvedValue(res({ error: 'bad gateway' }, 502));
    await expect(payGroqViaX402(params)).rejects.toThrow(/x402 groq proxy failed \(502\)/);
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/x402/client.test.ts`
Expected: FAIL — a 402 currently throws `x402 groq proxy failed (402)`.

- [x] **Step 3: Split the branch**

Replace the `!res.ok` branch in `lib/x402/client.ts`:

```ts
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // A 401/402/403 is the payment rail refusing us, not the service being
    // down: an invalid key, or — on a metered facilitator like Celo's, which
    // sells prepaid credits — a balance that has run out. Both degrade every
    // thread to Model 1 silently, so the alert has to name the cause instead of
    // sending whoever is on call to look for an outage.
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      throw new Error(
        `x402 payment rejected (${res.status}) — check the facilitator credit or key: ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`x402 groq proxy failed (${res.status}): ${text.slice(0, 200)}`);
  }
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/x402/client.test.ts && npx tsc --noEmit`
Expected: PASS, including the pre-existing client tests.

- [x] **Step 5: Commit**

```bash
git add lib/x402/client.ts lib/x402/client.test.ts
git commit -m "fix(x402): name a rejected payment apart from a proxy outage"
```

---

### Task 6: Document the env surface and roll out to production — **docs DONE, rollout BLOCKED on the user**

**Files:**
- Modify: `.env.example:100-108`, `.claude/docs/x402.md:8`
- No test — this task's deliverable is a real settlement, verified on-chain.

**Interfaces:**
- Consumes: everything from Tasks 2–5, plus an API key obtained by the user at x402.celo.org.
- Produces: a production deployment settling on Celo, and one on-chain settlement transaction as proof.

- [x] **Step 1: Document the new vars in `.env.example`**

Replace the facilitator block (lines 100–108) with:

```bash
# Facilitator. Which auth to send is named explicitly — never inferred from
# which credentials happen to be present, because CDP creds outlive a chain
# switch and would otherwise be sent to a non-Coinbase host.
#   cdp      Coinbase CDP (Base mainnet) — needs CDP_API_KEY_ID/SECRET
#   api-key  Celo hosted facilitator     — needs X402_FACILITATOR_API_KEY
#   bearer   any facilitator using a static token
#   none     no auth (x402.org testnet facilitator)
# Unset keeps the legacy precedence: cdp > bearer > none.
X402_FACILITATOR_AUTH=
# Leave unset for the x402.org testnet facilitator (Base Sepolia).
#   https://api.cdp.coinbase.com/platform/v2/x402  (Base mainnet, auth=cdp)
#   https://api.x402.celo.org                      (Celo mainnet, auth=api-key)
X402_FACILITATOR_URL=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
# Celo facilitator key from x402.celo.org (connect wallet, sign a message).
# Sold as prepaid credits: 1 credit = 1 settlement, $0.001 each, 500 free.
X402_FACILITATOR_API_KEY=
# Static bearer fallback for any facilitator that uses one (most don't):
X402_FACILITATOR_TOKEN=
```

- [x] **Step 2: Update the agent rule-set to stop saying settlement is Base-only**

In `.claude/docs/x402.md`, the Model 2 bullet says USDC "settles on **Base**". Replace that clause with:

```
USDC settles on the chain named by `X402_CHAIN_ID` — Base via the Coinbase CDP facilitator, or Celo mainnet via the hosted Celo facilitator (`X402_FACILITATOR_AUTH=api-key`, prepaid credits at $0.001/settlement) — to `X402_PAY_TO`.
```

- [x] **Step 3: Commit the docs**

```bash
git add .env.example .claude/docs/x402.md
git commit -m "docs(x402): document the Celo facilitator env surface"
```

- [ ] **Step 4: Get the API key (user action)**

Ask the user to visit x402.celo.org, connect the agent wallet, and sign the message — no gas, no transaction. The key looks like `x402_live_…` and comes with 500 free credits.

- [ ] **Step 5: Set production env**

Vercel CLI v54 `env add` stores `""` when fed on stdin — use the REST upsert and read each value back before trusting it.

```bash
vercel env ls production | grep -E "X402_"
```

Target state on production:

| var | value |
|---|---|
| `X402_SETTLE_MODE` | `x402` (unchanged) |
| `X402_CHAIN_ID` | `42220` |
| `X402_FACILITATOR_URL` | `https://api.x402.celo.org` |
| `X402_FACILITATOR_AUTH` | `api-key` |
| `X402_FACILITATOR_API_KEY` | the `x402_live_…` key |
| `X402_PAY_TO` | `0x006cBA3012139C299Aa4A522697B4A0c49F38895` |

Leave `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` in place — they are the rollback.

- [ ] **Step 6: Deploy and run one real paid thread**

Deploy, then generate one thread end to end on production. Confirm the Groq step settled through x402 rather than degrading to Model 1 — a degrade fires an ops alert, so no alert plus a settlement hash is the pass condition.

- [ ] **Step 7: Verify the settlement on-chain**

```bash
node -e '
const {createPublicClient,http,parseAbi}=require("viem");
const c=createPublicClient({transport:http("https://forno.celo.org")});
(async()=>{
  const PAY_TO="0x006cBA3012139C299Aa4A522697B4A0c49F38895";
  const USDC="0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
  const ev=parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  const latest=await c.getBlockNumber();
  const logs=await c.getLogs({address:USDC,event:ev[0],args:{to:PAY_TO},fromBlock:latest-4899n,toBlock:latest});
  for (const l of logs) {
    const tx=await c.getTransaction({hash:l.transactionHash});
    console.log("value=",l.args.value.toString(),"payer=",l.args.from,"submitted_by=",tx.from,"tx=",l.transactionHash);
  }
})()'
```

Pass condition: a transfer of `1000` raw USDC (0.001) whose `payer` is the agent EOA `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78` and whose `submitted_by` is the facilitator relayer `0x0d74d5cefd2e7f24e623330ebe3d8d4cb45ffb48` — proving it settled gaslessly through the facilitator rather than being a direct transfer.

- [ ] **Step 8: Record the proof**

Append the transaction hash, block, and date to `docs/x402-mainnet-proof.md` under a new "Celo mainnet" heading, mirroring the existing Base entry.

```bash
git add docs/x402-mainnet-proof.md
git commit -m "docs(x402): record the first Celo mainnet settlement"
```

---

## Rollback

Every code change is inert until the env points at Celo. To roll back, set `X402_CHAIN_ID=8453`, `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`, `X402_FACILITATOR_AUTH=cdp` and redeploy. No revert required.

If the facilitator fails at runtime, no rollback is needed for correctness: `generateDraft` alerts ops and falls back to Model 1 in-process for the Groq step, and the thread still completes.
