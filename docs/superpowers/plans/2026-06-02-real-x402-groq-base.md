# Real x402 settlement for Groq on Base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated x402 burn-to-sink for the Groq draft step with a real x402 payment flow on Base (USDC) — the agent pays an own x402-gated proxy via EIP-3009, the Coinbase/x402 facilitator verifies & settles, and settlement happens only after Groq returns valid content.

**Architecture:** A new `app/api/x402/groq` proxy (resource server) wraps the Groq call with `@x402/next`'s `withX402`, which settles only on a `< 400` response. A new x402 client (`lib/x402/client.ts`) pays it using the agent EOA (`AGENT_WALLET_PRIVATE_KEY`) via EIP-3009. A 3-layer spend cap (small hot float + Redis daily counter + pause flag) replaces the contract's on-chain `CAP_EXCEEDED`. A `getSettleMode(chainId)` resolver keeps Celo/MiniPay on the existing `legacy` push-to-sink; only Base + `X402_SETTLE_MODE=x402` uses the new path. A shared `generateDraft` helper removes the duplicated Groq-draft logic in Mode A and Mode B.

**Tech Stack:** Next.js 14 (App Router, Node runtime), TypeScript, viem, `@x402/next` / `@x402/fetch` / `@x402/evm` / `@x402/core`, `@upstash/redis`, `groq-sdk`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-real-x402-groq-base-design.md`

---

## File structure

**Create:**
- `lib/x402/config.ts` — chain/token/price/cap config + `getSettleMode`. Single source of truth for the x402 price.
- `lib/x402/cap.ts` — Redis daily-spend reservation (Layer 2) + pause flag (Layer 3).
- `lib/x402/server.ts` — builds the `x402ResourceServer` (facilitator from env), cached.
- `lib/x402/client.ts` — `payGroqViaX402(...)`: cap-check → pay proxy via EIP-3009 → return `{ tweets, settlementTxHash }`.
- `lib/pipeline/generateDraft.ts` — shared Groq-draft + settle unit used by both modes; branches legacy vs x402.
- `app/api/x402/groq/route.ts` — the payment-gated proxy that calls Groq + validates the thread.
- Tests: `lib/x402/config.test.ts`, `lib/x402/cap.test.ts`, `lib/x402/client.test.ts`, `app/api/x402/groq/route.test.ts`, `lib/pipeline/generateDraft.test.ts`.

**Modify:**
- `lib/pipeline/groqStep.ts` — `runGroqStep` delegates the draft to `generateDraft`; keep `GROQ_COST_*` / `GROQ_SINK` exports (legacy path still uses them).
- `lib/pipeline/runModeB.ts:62-121` — replace the inline Groq+settle block with `generateDraft`.
- `.env.example` — new env vars.

**Unchanged (relied on):** `app/api/generate/stream/route.ts`, its tests, `lib/agent/orchestrator.ts` (`settleX402Call` stays for legacy), `lib/threadParser.ts`.

---

## Task 1: Install x402 packages and verify the exact exports

x402's package layout moves fast. Before writing code against it, install and confirm the real export paths on the installed version. This is a one-time verification, not a guess.

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install the x402 packages**

```bash
pnpm add @x402/next @x402/fetch @x402/evm @x402/core
```

- [ ] **Step 2: Confirm the exports we depend on actually exist**

Run this one-off check (adjust import paths only if it fails, then update the plan's imports to match):

```bash
node --input-type=module -e "
import { withX402, x402ResourceServer } from '@x402/next';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
console.log('exports ok:', [withX402, x402ResourceServer, x402Client, wrapFetchWithPayment, registerExactEvmScheme, ExactEvmScheme, HTTPFacilitatorClient].every(Boolean));
"
```
Expected: `exports ok: true`. If any import throws "not exported", find the correct path with `cat node_modules/@x402/*/package.json | grep -A30 '\"exports\"'` and update the imports in Tasks 4–6 accordingly before proceeding.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add x402 packages for real Base settlement"
```

---

## Task 2: x402 config — chains, price, cap, settle-mode resolver

**Files:**
- Create: `lib/x402/config.ts`
- Test: `lib/x402/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/x402/config.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getX402ChainConfig, isX402Chain, getSettleMode, priceRawUSDC, dailyCapRawUSDC,
} from './config';

const BASE = 8453;
const BASE_SEPOLIA = 84532;
const CELO = 42220;

afterEach(() => { vi.unstubAllEnvs(); });

describe('x402 config', () => {
  it('maps Base chains to CAIP-2 + canonical USDC (6 dec)', () => {
    expect(getX402ChainConfig(BASE).caip2).toBe('eip155:8453');
    expect(getX402ChainConfig(BASE).usdc.toLowerCase())
      .toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    expect(getX402ChainConfig(BASE_SEPOLIA).usdc.toLowerCase())
      .toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  });

  it('throws for non-Base chains', () => {
    expect(() => getX402ChainConfig(CELO)).toThrow();
    expect(isX402Chain(CELO)).toBe(false);
  });

  it('uses x402 only when flag=x402 AND chain is Base', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'x402');
    expect(getSettleMode(BASE)).toBe('x402');
    expect(getSettleMode(CELO)).toBe('legacy'); // flag on, wrong chain
    vi.stubEnv('X402_SETTLE_MODE', 'legacy');
    expect(getSettleMode(BASE)).toBe('legacy');  // right chain, flag off
  });

  it('computes raw USDC amounts (6 decimals)', () => {
    expect(priceRawUSDC()).toBe(1000n);           // 0.001 USDC
    vi.stubEnv('X402_DAILY_CAP_USDC', '5');
    expect(dailyCapRawUSDC()).toBe(5_000_000n);   // 5 USDC
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:lib lib/x402/config`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/x402/config.ts
import { parseUnits, type Address } from 'viem';

export type SettleMode = 'legacy' | 'x402';

export interface X402ChainConfig {
  caip2: `eip155:${number}`;
  usdc: Address;
  usdcDecimals: number;
}

// Single source of truth for the x402 Groq price (human USDC). The displayed
// cost derives from this, so it cannot drift from what settles.
export const X402_PRICE_USD = '0.001';
export const X402_PRICE_LABEL = `$${X402_PRICE_USD}`; // withX402 `price` form

const BASE_MAINNET = 8453;
const BASE_SEPOLIA = 84532;

const CONFIG: Record<number, X402ChainConfig> = {
  [BASE_MAINNET]: {
    caip2: 'eip155:8453',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
  },
  [BASE_SEPOLIA]: {
    caip2: 'eip155:84532',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDecimals: 6,
  },
};

export function getX402ChainConfig(chainId: number): X402ChainConfig {
  const c = CONFIG[chainId];
  if (!c) throw new Error(`no x402 config for chain ${chainId}`);
  return c;
}

export function isX402Chain(chainId: number): boolean {
  return chainId in CONFIG;
}

// x402 only when explicitly enabled AND on a supported (Base) chain; everything
// else stays on legacy push-to-sink (Celo/MiniPay untouched).
export function getSettleMode(chainId: number): SettleMode {
  return process.env.X402_SETTLE_MODE === 'x402' && isX402Chain(chainId)
    ? 'x402'
    : 'legacy';
}

export function priceRawUSDC(): bigint {
  return parseUnits(X402_PRICE_USD, 6);
}

export function dailyCapRawUSDC(): bigint {
  return parseUnits(process.env.X402_DAILY_CAP_USDC || '5', 6);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm test:lib lib/x402/config`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/x402/config.ts lib/x402/config.test.ts
git commit -m "feat(x402): chain/price/cap config + settle-mode resolver"
```

---

## Task 3: Spend cap ledger — Redis daily reservation + pause flag

**Files:**
- Create: `lib/x402/cap.ts`
- Test: `lib/x402/cap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/x402/cap.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const incrby = vi.fn();
const decrby = vi.fn();
const expire = vi.fn();
const get = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: () => ({ incrby, decrby, expire, get }) },
}));

const { reserveDailySpend, isPaused } = await import('./cap');

beforeEach(() => { vi.clearAllMocks(); expire.mockResolvedValue(1); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('reserveDailySpend', () => {
  it('reserves and sets a TTL when under the cap', async () => {
    incrby.mockResolvedValue(1000); // new total = 0.001 USDC, cap = 5 USDC
    await expect(reserveDailySpend({
      token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    })).resolves.toBeUndefined();
    expect(incrby).toHaveBeenCalledOnce();
    expect(expire).toHaveBeenCalledOnce();
    expect(decrby).not.toHaveBeenCalled();
  });

  it('rolls back and throws when the reservation would exceed the cap', async () => {
    incrby.mockResolvedValue(6_000_000); // over 5 USDC cap
    await expect(reserveDailySpend({
      token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    })).rejects.toThrow('daily spend cap exceeded');
    expect(decrby).toHaveBeenCalledWith(expect.any(String), 1000);
  });
});

describe('isPaused', () => {
  it('is true when the env flag is set', async () => {
    vi.stubEnv('X402_PAUSED', 'true');
    expect(await isPaused()).toBe(true);
  });

  it('is true when the Redis pause key is 1', async () => {
    get.mockResolvedValue('1');
    expect(await isPaused()).toBe(true);
  });

  it('is false otherwise', async () => {
    get.mockResolvedValue(null);
    expect(await isPaused()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:lib lib/x402/cap`
Expected: FAIL — `Cannot find module './cap'`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/x402/cap.ts
import { Redis } from '@upstash/redis';

function redis() {
  return Redis.fromEnv();
}

function secondsToNextUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

// Layer 3 kill-switch: env flag OR a Redis key, so it can be flipped without a
// redeploy. NOTE: this only stops OUR code path — a stolen agent key bypasses
// it (that is what the small hot float guards against, see spec D3).
export async function isPaused(): Promise<boolean> {
  if (process.env.X402_PAUSED === 'true') return true;
  return (await redis().get<string>('x402:paused')) === '1';
}

// Layer 2: reserve `amountRaw` against a per-UTC-day counter. Throws if it would
// exceed the cap. Amounts are small USDC raw units (0.001 USDC = 1000), well
// within JS Number range, so incrby/decrby take Number. Over-counting on later
// failure is conservative (stops sooner) — acceptable for a spend cap.
export async function reserveDailySpend(params: {
  token: string;
  amountRaw: bigint;
  capRaw: bigint;
}): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = `x402:spend:${day}:${params.token}`;
  const r = redis();
  const total = await r.incrby(key, Number(params.amountRaw));
  await r.expire(key, secondsToNextUtcMidnight());
  if (BigInt(total) > params.capRaw) {
    await r.decrby(key, Number(params.amountRaw));
    throw new Error('x402 daily spend cap exceeded');
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm test:lib lib/x402/cap`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/x402/cap.ts lib/x402/cap.test.ts
git commit -m "feat(x402): Redis daily spend cap + pause flag"
```

---

## Task 4: x402 client — pay the proxy via EIP-3009

**Files:**
- Create: `lib/x402/client.ts`
- Test: `lib/x402/client.test.ts`

- [ ] **Step 1: Write the failing test**

The x402 SDK is mocked: `wrapFetchWithPayment` returns a fetch we control, so we test our orchestration (cap check, request shape, parsing tweets + tx hash, error mapping) — not the SDK's signing.

```typescript
// lib/x402/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reserveDailySpend = vi.fn();
const isPaused = vi.fn();
const payFetch = vi.fn();

vi.mock('./cap', () => ({ reserveDailySpend, isPaused }));
vi.mock('./config', async (orig) => ({
  ...(await orig<typeof import('./config')>()),
}));
vi.mock('@x402/fetch', () => ({
  x402Client: class {},
  wrapFetchWithPayment: () => payFetch,
}));
vi.mock('@x402/evm/exact/client', () => ({ registerExactEvmScheme: vi.fn() }));
vi.mock('viem/accounts', () => ({ privateKeyToAccount: () => ({ address: '0xagent' }) }));

const { payGroqViaX402 } = await import('./client');

const PAYMENT_RESPONSE = Buffer.from(
  JSON.stringify({ transaction: '0xsettletx' }),
).toString('base64');

function res(body: unknown, status = 200, header = PAYMENT_RESPONSE) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (k: string) => (k.toLowerCase() === 'x-payment-response' ? header : null) },
  };
}

const params = {
  chainId: 84532,
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.7,
  maxTokens: 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AGENT_WALLET_PRIVATE_KEY', '0x' + '1'.repeat(64));
  vi.stubEnv('X402_PROXY_BASE_URL', 'https://proxy.test');
  vi.stubEnv('X402_DAILY_CAP_USDC', '5');
  isPaused.mockResolvedValue(false);
  reserveDailySpend.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('payGroqViaX402', () => {
  it('reserves cap, pays the proxy, returns tweets + settlement tx hash', async () => {
    payFetch.mockResolvedValue(res({ tweets: ['t1', 't2'] }));
    const out = await payGroqViaX402(params);
    expect(reserveDailySpend).toHaveBeenCalledOnce();
    expect(out.tweets).toEqual(['t1', 't2']);
    expect(out.settlementTxHash).toBe('0xsettletx');
    const [url, init] = payFetch.mock.calls[0];
    expect(url).toBe('https://proxy.test/api/x402/groq');
    expect(JSON.parse(init.body)).toMatchObject({ messages: params.messages });
  });

  it('throws and never pays when paused', async () => {
    isPaused.mockResolvedValue(true);
    await expect(payGroqViaX402(params)).rejects.toThrow('paused');
    expect(reserveDailySpend).not.toHaveBeenCalled();
    expect(payFetch).not.toHaveBeenCalled();
  });

  it('throws and never pays when the cap is exceeded', async () => {
    reserveDailySpend.mockRejectedValue(new Error('x402 daily spend cap exceeded'));
    await expect(payGroqViaX402(params)).rejects.toThrow('cap exceeded');
    expect(payFetch).not.toHaveBeenCalled();
  });

  it('throws on a non-OK proxy response (no content leaked)', async () => {
    payFetch.mockResolvedValue(res({ error: 'invalid thread' }, 422));
    await expect(payGroqViaX402(params)).rejects.toThrow('422');
  });

  it('throws when the proxy returns no tweets', async () => {
    payFetch.mockResolvedValue(res({ tweets: [] }));
    await expect(payGroqViaX402(params)).rejects.toThrow('no tweets');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:lib lib/x402/client`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/x402/client.ts
import { privateKeyToAccount } from 'viem/accounts';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { getX402ChainConfig, priceRawUSDC, dailyCapRawUSDC } from './config';
import { isPaused, reserveDailySpend } from './cap';

export interface PayGroqParams {
  chainId: number;
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  maxTokens: number;
}

export interface PayGroqResult {
  tweets: string[];
  settlementTxHash: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

// Decode the facilitator's settlement result from the X-PAYMENT-RESPONSE header
// (base64 JSON). Field name varies by version; try the known aliases. A missing
// hash is non-fatal (cost still settled) — we fall back to '' and the caller
// uses '0x0'.
function decodePaymentTxHash(header: string | null): string {
  if (!header) return '';
  try {
    const json = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return (json.transaction || json.transactionHash || json.txHash || '') as string;
  } catch {
    return '';
  }
}

export async function payGroqViaX402(params: PayGroqParams): Promise<PayGroqResult> {
  const cfg = getX402ChainConfig(params.chainId);

  // Layer 3 then Layer 2, BEFORE any payment. Either throws => refundable, no spend.
  if (await isPaused()) throw new Error('x402 settlement paused');
  await reserveDailySpend({ token: cfg.usdc, amountRaw: priceRawUSDC(), capRaw: dailyCapRawUSDC() });

  const account = privateKeyToAccount(requireEnv('AGENT_WALLET_PRIVATE_KEY') as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const url = `${requireEnv('X402_PROXY_BASE_URL')}/api/x402/groq`;
  const res = await fetchWithPay(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`x402 groq proxy failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { tweets?: unknown };
  if (!Array.isArray(data.tweets) || data.tweets.length === 0) {
    throw new Error('x402 groq proxy returned no tweets');
  }

  return {
    tweets: data.tweets as string[],
    settlementTxHash: decodePaymentTxHash(res.headers.get('x-payment-response')),
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm test:lib lib/x402/client`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/x402/client.ts lib/x402/client.test.ts
git commit -m "feat(x402): client that pays the Groq proxy via EIP-3009"
```

---

## Task 5: Resource server builder

**Files:**
- Create: `lib/x402/server.ts`

No dedicated unit test (thin wiring around the SDK + env; exercised by Task 6's route test, which mocks `withX402`). Keep it tiny.

- [ ] **Step 1: Write the implementation**

```typescript
// lib/x402/server.ts
import { HTTPFacilitatorClient } from '@x402/core/server';
import { x402ResourceServer } from '@x402/next';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getX402ChainConfig } from './config';

let cached: ReturnType<typeof build> | null = null;

function build() {
  // Testnet (Base Sepolia): the x402.org facilitator needs no auth.
  // Mainnet (Base): set X402_FACILITATOR_URL to the Coinbase CDP facilitator and
  // X402_FACILITATOR_TOKEN to a bearer token (CDP key), see .env.example.
  const url = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
  const token = process.env.X402_FACILITATOR_TOKEN;

  const facilitator = new HTTPFacilitatorClient({
    url,
    ...(token
      ? {
          createAuthHeaders: async () => ({
            verify: { Authorization: `Bearer ${token}` },
            settle: { Authorization: `Bearer ${token}` },
          }),
        }
      : {}),
  });

  const caip2 = getX402ChainConfig(Number(process.env.X402_CHAIN_ID || '84532')).caip2;
  return new x402ResourceServer(facilitator).register(caip2, new ExactEvmScheme());
}

export function getResourceServer() {
  if (!cached) cached = build();
  return cached;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the imports resolve on the installed version — if not, fix paths per Task 1 Step 2).

- [ ] **Step 3: Commit**

```bash
git add lib/x402/server.ts
git commit -m "feat(x402): resource server builder (facilitator from env)"
```

---

## Task 6: The payment-gated Groq proxy route

**Files:**
- Create: `app/api/x402/groq/route.ts`
- Test: `app/api/x402/groq/route.test.ts`

The handler validates the thread BEFORE returning 200, so Groq failure (502) or junk output (422) returns `>= 400` and `withX402` does NOT settle — preserving "no charge for no content". The test mocks `withX402` as an identity wrapper (returns the handler unchanged) so we test the handler's branching directly.

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/x402/groq/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('groq-sdk', () => ({
  default: class { chat = { completions: { create } }; },
}));
// withX402 passes the handler through unchanged so we exercise handler logic.
vi.mock('@x402/next', () => ({
  withX402: (handler: unknown) => handler,
  x402ResourceServer: class { register() { return this; } },
}));
vi.mock('@x402/evm/exact/server', () => ({ ExactEvmScheme: class {} }));
vi.mock('@x402/core/server', () => ({ HTTPFacilitatorClient: class {} }));
// boundThread throws on empty/junk; keep parsing real for fidelity.

const { POST } = await import('./route');

function postReq(body: unknown) {
  return new Request('http://localhost/api/x402/groq', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const okBody = { messages: [{ role: 'user', content: 'topic' }], temperature: 0.7, maxTokens: 1200 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GROQ_API_KEY', 'test-key');
  vi.stubEnv('X402_PAY_TO', '0x' + '2'.repeat(40));
  vi.stubEnv('X402_CHAIN_ID', '84532');
});

describe('POST /api/x402/groq (handler)', () => {
  it('returns 200 with tweets when Groq returns a valid thread', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hello\n\n2/ world' } }] });
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tweets)).toBe(true);
    expect(data.tweets.length).toBeGreaterThan(0);
  });

  it('returns 502 (no settle) when Groq throws', async () => {
    create.mockRejectedValue(new Error('groq down'));
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(502);
  });

  it('returns 422 (no settle) when the output is empty/junk', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(422);
  });

  it('returns 400 when messages are missing', async () => {
    const res = await POST(postReq({ temperature: 0.7 }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:lib app/api/x402/groq`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```typescript
// app/api/x402/groq/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { withX402 } from '@x402/next';
import { parseThread, boundThread } from '@/lib/threadParser';
import { getResourceServer } from '@/lib/x402/server';
import { getX402ChainConfig, X402_PRICE_LABEL } from '@/lib/x402/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProxyBody {
  messages?: { role: string; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

const handler = async (req: NextRequest) => {
  let body: ProxyBody;
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  let raw: string;
  try {
    const groq = new Groq({ apiKey });
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: body.messages as { role: 'system' | 'user'; content: string }[],
      temperature: body.temperature ?? 0.7,
      max_tokens: body.maxTokens ?? 1200,
    });
    raw = resp.choices[0]?.message?.content ?? '';
  } catch {
    // Groq failed -> >=400 -> withX402 does NOT settle (no charge).
    return NextResponse.json({ error: 'groq failed' }, { status: 502 });
  }

  let tweets: string[];
  try {
    tweets = boundThread(parseThread(raw)); // empty/junk throws -> no settle
  } catch {
    return NextResponse.json({ error: 'invalid thread' }, { status: 422 });
  }

  // 200 -> withX402 settles AFTER this returns. Content + settlement together.
  return NextResponse.json({ tweets }, { status: 200 });
};

const cfg = getX402ChainConfig(Number(process.env.X402_CHAIN_ID || '84532'));

export const POST = withX402(
  handler,
  {
    accepts: {
      scheme: 'exact',
      price: X402_PRICE_LABEL,
      network: cfg.caip2,
      payTo: process.env.X402_PAY_TO as `0x${string}`,
      maxTimeoutSeconds: 120,
    },
    description: 'ShipPost AI thread generation (Groq)',
    mimeType: 'application/json',
  },
  getResourceServer(),
);
```

> Note: `accepts` omits `asset` — x402 defaults the asset to USDC for the given network. If the installed version requires an explicit asset, add `asset: cfg.usdc`.

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm test:lib app/api/x402/groq`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/x402/groq/route.ts app/api/x402/groq/route.test.ts
git commit -m "feat(x402): payment-gated Groq proxy (settle only after valid thread)"
```

---

## Task 7: Shared `generateDraft` helper + wire both modes

Removes the duplicated Groq-draft-and-settle logic in `runGroqStep` (Mode A) and `runModeB` (Mode B), and routes it through `getSettleMode`.

**Files:**
- Create: `lib/pipeline/generateDraft.ts`
- Test: `lib/pipeline/generateDraft.test.ts`
- Modify: `lib/pipeline/groqStep.ts`
- Modify: `lib/pipeline/runModeB.ts:62-121`

- [ ] **Step 1: Write the failing test for `generateDraft`**

```typescript
// lib/pipeline/generateDraft.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSettleMode = vi.fn();
const payGroqViaX402 = vi.fn();
const settleX402Call = vi.fn();
const create = vi.fn();

vi.mock('@/lib/x402/config', () => ({ getSettleMode, X402_PRICE_USD: '0.001' }));
vi.mock('@/lib/x402/client', () => ({ payGroqViaX402 }));
vi.mock('@/lib/agent/orchestrator', () => ({ settleX402Call }));
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create } }; } }));

const { generateDraft } = await import('./generateDraft');

const ctx = { chainId: 84532, threadId: 1n, topic: 't', audience: 'beginner' as const, agentWallet: '0xw' as const };
const msgs = { messages: [{ role: 'user' as const, content: 'x' }], temperature: 0.7, maxTokens: 1200 };

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('GROQ_API_KEY', 'k'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('generateDraft', () => {
  it('x402 mode: pays via proxy, returns USDC cost + settlement hash, never calls Groq directly', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockResolvedValue({ tweets: ['a', 'b'], settlementTxHash: '0xtx' });
    const out = await generateDraft(ctx, msgs);
    expect(out).toEqual({ tweets: ['a', 'b'], txHash: '0xtx', costHuman: '0.001', tokenSymbol: 'USDC' });
    expect(create).not.toHaveBeenCalled();
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('legacy mode: calls Groq, parses, settles to sink in cUSD', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    settleX402Call.mockResolvedValue('0xsink');
    const out = await generateDraft(ctx, msgs);
    expect(create).toHaveBeenCalledOnce();
    expect(settleX402Call).toHaveBeenCalledOnce();
    expect(out.tokenSymbol).toBe('cUSD');
    expect(out.txHash).toBe('0xsink');
    expect(out.tweets.length).toBeGreaterThan(0);
  });

  it('legacy mode: throws (no settle) on empty Groq output', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '  ' } }] });
    await expect(generateDraft(ctx, msgs)).rejects.toThrow();
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:lib lib/pipeline/generateDraft`
Expected: FAIL — `Cannot find module './generateDraft'`.

- [ ] **Step 3: Write `generateDraft`**

```typescript
// lib/pipeline/generateDraft.ts
import Groq from 'groq-sdk';
import type { Hex } from 'viem';
import { parseThread, boundThread } from '@/lib/threadParser';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { getSettleMode, X402_PRICE_USD } from '@/lib/x402/config';
import { payGroqViaX402 } from '@/lib/x402/client';
import { GROQ_COST_CUSD, GROQ_COST_HUMAN, GROQ_SINK } from './groqStep';
import type { PipelineContext } from './types';

export interface DraftInput {
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  maxTokens: number;
}

export interface DraftResult {
  tweets: string[];
  txHash: Hex;
  costHuman: string;
  tokenSymbol: 'cUSD' | 'USDC';
}

// Produce a validated draft thread and settle for it. Settle gates delivery in
// both modes: legacy settles after boundThread here; x402 settles inside the
// proxy only after it returns a validated thread.
export async function generateDraft(ctx: PipelineContext, input: DraftInput): Promise<DraftResult> {
  if (getSettleMode(ctx.chainId) === 'x402') {
    const { tweets, settlementTxHash } = await payGroqViaX402({
      chainId: ctx.chainId,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    return {
      tweets,
      txHash: (settlementTxHash || '0x0') as Hex,
      costHuman: X402_PRICE_USD,
      tokenSymbol: 'USDC',
    };
  }

  // legacy: call Groq directly, validate, then push-to-sink in cUSD.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });
  const resp = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
  });
  const raw = resp.choices[0]?.message?.content ?? '';
  if (!raw.trim()) throw new Error('Groq returned empty content');

  const tweets = boundThread(parseThread(raw));
  const txHash = await settleX402Call({
    chainId: ctx.chainId,
    serviceAddress: GROQ_SINK,
    tokenSymbol: 'cUSD',
    amount: GROQ_COST_CUSD,
    threadId: ctx.threadId,
  });
  return { tweets, txHash, costHuman: GROQ_COST_HUMAN, tokenSymbol: 'cUSD' };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm test:lib lib/pipeline/generateDraft`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `runGroqStep` (Mode A) to use `generateDraft`**

Replace the body of `runGroqStep` in `lib/pipeline/groqStep.ts` (keep the `GROQ_*` and `GROQ_SINK` exports above it unchanged). New `runGroqStep`:

```typescript
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import { generateDraft } from './generateDraft';
import type { PipelineContext, PipelineEvent } from './types';

export async function runGroqStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'groq' });

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildModeAPrompt({ topic: ctx.topic, audience: ctx.audience }) },
  ];

  let draft;
  try {
    draft = await generateDraft(ctx, { messages, temperature: 0.7, maxTokens: 1200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'groq step failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  emit({
    type: 'step_settled',
    step: 'groq',
    txHash: draft.txHash,
    costAmount: draft.costHuman,
    tokenSymbol: draft.tokenSymbol,
  });
  emit({ type: 'step_output', step: 'groq', output: draft.tweets });
  return { tweets: draft.tweets };
}
```

> Remove the now-unused `Groq`, `parseThread`, `boundThread`, `settleX402Call` imports from `groqStep.ts` (they live in `generateDraft.ts` now). Keep `parseEther`/`formatEther` for `GROQ_COST_*`.

- [ ] **Step 6: Refactor `runModeB` (replace lines 62–121) to use `generateDraft`**

In `lib/pipeline/runModeB.ts`, replace the inline Groq-draft + settle block (the `emit step_started` through the `emit step_output` after settle) with:

```typescript
  // Step 3 — Groq draft (HARD-fail: strict-settle, no thread = no value)
  emit({ type: 'step_started', step: 'groq' });

  const userPrompt = buildModeBPrompt({
    eventDescription: ctx.eventDescription,
    angle: ctx.angle,
    searchSummary,
    marketSnippet,
  });

  let draft;
  try {
    draft = await generateDraft(ctx, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.85,
      maxTokens: 1400,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'draft failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  wrappedEmit({
    type: 'step_settled',
    step: 'groq',
    txHash: draft.txHash,
    costAmount: draft.costHuman,
    tokenSymbol: draft.tokenSymbol,
  });
  emit({ type: 'step_output', step: 'groq', output: draft.tweets });

  const draftTweets = draft.tweets;
```

Update `runModeB.ts` imports: add `import { generateDraft } from './generateDraft';`; remove the now-unused `Groq`, `settleX402Call`, `parseThread`, `boundThread`, and the `GROQ_COST_CUSD, GROQ_COST_HUMAN, GROQ_SINK` import line. Keep `SYSTEM_PROMPT`, `buildModeBPrompt`, `summarizeSerper`, `summarizeMarket`.

- [ ] **Step 7: Run the full unit suite (nothing regressed)**

Run: `pnpm test:lib`
Expected: PASS — all prior tests (route, modeB prompt, orchestrator, etc.) plus the new x402 tests. The `/api/generate/stream` route tests still pass unchanged (they mock `runModeA`/`runModeB`).

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors, no warnings.

- [ ] **Step 9: Commit**

```bash
git add lib/pipeline/generateDraft.ts lib/pipeline/generateDraft.test.ts lib/pipeline/groqStep.ts lib/pipeline/runModeB.ts
git commit -m "refactor(pipeline): shared generateDraft routing legacy vs x402"
```

---

## Task 8: Env documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the new vars to `.env.example`**

```bash
# --- x402 real settlement (Base) ---
# Enable real x402 settlement (only takes effect on Base chains; else legacy).
X402_SETTLE_MODE=legacy
# Base chain the proxy settles on: 84532 (Base Sepolia) or 8453 (Base mainnet).
X402_CHAIN_ID=84532
# Public base URL the agent calls to reach the proxy (this app's own URL).
X402_PROXY_BASE_URL=http://localhost:3000
# Address that receives the x402 USDC payment (the service treasury).
X402_PAY_TO=0x0000000000000000000000000000000000000000
# Facilitator: leave unset for the x402.org testnet facilitator (Base Sepolia).
# For Base mainnet use the Coinbase CDP facilitator URL + a bearer token (CDP key).
X402_FACILITATOR_URL=
X402_FACILITATOR_TOKEN=
# Daily x402 spend cap in USDC (Layer 2 guard). Keep small; the real security
# boundary is the small hot float in the agent EOA (Layer 1).
X402_DAILY_CAP_USDC=5
# Kill-switch: set to "true" to pause all x402 settlement (Layer 3).
X402_PAUSED=false
# Upstash Redis (already used for rate limiting) backs the daily cap counter.
# UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (see existing entries)
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): x402 Base settlement configuration"
```

---

## Task 9: Base Sepolia integration (manual, on testnet only)

No mainnet exposure. This validates the real facilitator + EIP-3009 loop end-to-end.

- [ ] **Step 1: Deploy contracts to Base Sepolia** (out-of-scope contracts, but needed to run the full flow): add a `baseSepolia` network to `hardhat.config.ts` and deploy `ShipPostPayment` + `AgentWallet`; record addresses in `deployments/baseSepolia.json` and `lib/contracts.ts`. (If Base contract support is not yet in `lib/contracts.ts`/`lib/chains.ts`, that belongs to the separate multi-chain spec — for this task you only need the proxy + EOA, so you may stub the on-chain payment and drive `/api/x402/groq` directly.)

- [ ] **Step 2: Fund the agent EOA** (`AGENT_WALLET_PRIVATE_KEY`) with Base Sepolia ETH (gas) and test USDC (from a Circle faucet).

- [ ] **Step 3: Configure env**: `X402_SETTLE_MODE=x402`, `X402_CHAIN_ID=84532`, `X402_PROXY_BASE_URL=<your deployed/preview URL>`, `X402_PAY_TO=<a treasury address you control>`, leave `X402_FACILITATOR_URL` unset (testnet default), set Upstash vars.

- [ ] **Step 4: Drive one payment** with a tiny script and confirm the loop:

```bash
node --input-type=module -e "
import { payGroqViaX402 } from './lib/x402/client.ts';
const out = await payGroqViaX402({
  chainId: 84532,
  messages: [{ role: 'user', content: 'Write a 3-tweet thread about stablecoins.' }],
  temperature: 0.7, maxTokens: 1200,
});
console.log('tweets:', out.tweets.length, 'settle tx:', out.settlementTxHash);
"
```
(Use `tsx` if needed: `pnpm dlx tsx <file>`.)
Expected: prints tweet count and a non-empty `settlementTxHash`. Verify on `sepolia.basescan.org`: a USDC transfer of 0.001 from the agent EOA to `X402_PAY_TO`.

- [ ] **Step 5: Verify the cap + pause guards**: set `X402_DAILY_CAP_USDC=0.0005` (below price) → expect "daily spend cap exceeded", no transfer. Set `X402_PAUSED=true` → expect "settlement paused", no transfer.

- [ ] **Step 6: Verify no-charge-on-failure**: temporarily set an invalid `GROQ_API_KEY` → the proxy returns 502 → confirm on BaseScan that **no USDC transfer** occurred.

- [ ] **Step 7: Document the results** in the PR description (tx hashes, screenshots) and only then plan the mainnet cutover (small float, `X402_CHAIN_ID=8453`, CDP facilitator).

---

## Self-review notes

- **Spec coverage:** D1 (own proxy) → Tasks 5–6; D2 (EOA/EIP-3009) → Task 4; D3 3-layer cap → Task 3 (Layers 2–3) + Task 9 Step 2 & docs (Layer 1 float); D4 (settle after Groq success) → Task 6 handler returns `>=400` on failure before `withX402` settles. Decimals-aware cost/price single-source → Task 2. Feature flag `X402_SETTLE_MODE` + Celo untouched → Task 2 `getSettleMode` + Task 7 branch. Error matrix → Tasks 4 & 6 tests. Testing → Tasks 2–7. Rollout Sepolia→mainnet → Tasks 8–9.
- **Out of scope (as specced):** Serper/CoinGecko proxies, factCheckStep's Groq call (stays legacy), wallet-environment abstraction + multi-chain wagmi/contracts, smart-account/ERC-1271. Task 9 Step 1 notes the contract/multi-chain dependency and how to proceed without it.
- **Type consistency:** `generateDraft` returns `{ tweets, txHash: Hex, costHuman, tokenSymbol: 'cUSD'|'USDC' }`, consumed identically by `runGroqStep` and `runModeB`; `tokenSymbol` is within the existing `PipelineEvent.step_settled` union (`'cUSD'|'USDT'|'USDC'`). `payGroqViaX402` returns `{ tweets, settlementTxHash }`, consumed by `generateDraft`. Config exports (`getSettleMode`, `priceRawUSDC`, `dailyCapRawUSDC`, `X402_PRICE_USD`, `X402_PRICE_LABEL`, `getX402ChainConfig`) match their usages in Tasks 3–7.
- **API-churn caveat:** Task 1 Step 2 verifies the exact x402 export paths before any code depends on them; if they differ, fix imports in Tasks 4–6.
```
