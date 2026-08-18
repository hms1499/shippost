# Paid-Run Survival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run the user has paid for survives losing its screen — the client remembers the receipt before paying, and fetches the finished thread when it comes back.

**Architecture:** Write `{chainId, threadId, payTxHash, mode, tokenSymbol, wallet, startedAt}` to `localStorage` the moment payment succeeds. On mount, if that record is fresh and matches the connected wallet and chain, show a `resuming` screen and poll a new read-only endpoint until the thread row is `completed` or `failed`. **Never call `/api/generate/stream` again** — the server answers `409 thread already generated` and the run is already finished or finishing on its own.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, wagmi/viem (already wired), Supabase service-role reads, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-18-paid-run-survival-design.md`

## Global Constraints

- **Never re-run a paid generation.** Resume is read-only. No task may call `/api/generate/stream`.
- **Never derive a past payment from the head price.** `computeTokenAmount()` / `THREAD_PRICE_USD` / `THREAD_PRICE_LABEL` are display fallbacks only (CLAUDE.md). A resumed receipt takes its amount from the database row.
- **Never fabricate a receipt number.** `X402_UNIT_COST_USD` must not be used to fill a missing per-step cost. Pass `initialState.steps` and let the existing empty-calls fallback (`components/PostShareScreen.tsx:124-134`) print one honest total line.
- **`lib/chainPolicy.ts` is the only chain allowlist.** Validate with `isSupportedChain`; never introduce a second list.
- **Every storage access is wrapped in `try/catch`.** Some webviews throw on `localStorage`. A throw degrades to "no saved run" and never propagates. Follow the precedent in `lib/guestSession.ts`.
- **Tests only run under `lib/` and `app/`.** `package.json` script: `"test:lib": "vitest run lib app"`. Nothing under `hooks/` or `components/` is collected, so all testable logic lives in `lib/`.
- **Storage key:** `coinop.paidRun.v1`. **TTL:** 30 minutes. **Poll interval:** 3s. **Poll ceiling:** 3 minutes.
- **Gates before any push:** `pnpm test:lib`, `pnpm test:contracts`, `npx tsc --noEmit`, `pnpm lint`, `pnpm build`. `test:lib` and `build` do **not** typecheck `*.test.ts` — only `tsc --noEmit` catches those.
- **Commit after every task.** Trunk-based: commit directly to `main`, no branches.

---

### Task 1: The memory — `lib/paidRun.ts`

Pure storage module. No React, no network. Modelled on `lib/guestSession.ts`.

**Files:**
- Create: `lib/paidRun.ts`
- Test: `lib/paidRun.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PaidRun { v: 1; chainId: number; threadId: string; payTxHash: string; mode: 0|1|2|3|4|5; tokenSymbol: string; wallet: string; startedAt: number }`
  - `savePaidRun(run: PaidRun): void`
  - `loadPaidRun(): PaidRun | null`
  - `clearPaidRun(): void`
  - `isResumable(run: PaidRun, ctx: { now: number; wallet: string; chainId: number }): boolean`
  - `const PAID_RUN_TTL_MS: number`

- [ ] **Step 1: Write the failing test**

Create `lib/paidRun.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  savePaidRun,
  loadPaidRun,
  clearPaidRun,
  isResumable,
  PAID_RUN_TTL_MS,
  type PaidRun,
} from './paidRun';

const mem = new Map<string, string>();
const stub = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v);
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
};

const RUN: PaidRun = {
  v: 1,
  chainId: 42220,
  threadId: '4182',
  payTxHash: '0x7f3a',
  mode: 0,
  tokenSymbol: 'cUSD',
  wallet: '0xabc',
  startedAt: 1_000_000,
};
const CTX = { now: 1_000_000, wallet: '0xabc', chainId: 42220 };

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('localStorage', stub);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('paidRun storage', () => {
  it('round-trips a saved run', () => {
    savePaidRun(RUN);
    expect(loadPaidRun()).toEqual(RUN);
  });

  it('clear removes it', () => {
    savePaidRun(RUN);
    clearPaidRun();
    expect(loadPaidRun()).toBeNull();
  });

  it('returns null when nothing was saved', () => {
    expect(loadPaidRun()).toBeNull();
  });

  it('treats malformed JSON as absent', () => {
    mem.set('coinop.paidRun.v1', '{not json');
    expect(loadPaidRun()).toBeNull();
  });

  it('treats a record missing required fields as absent', () => {
    mem.set('coinop.paidRun.v1', JSON.stringify({ v: 1, chainId: 42220 }));
    expect(loadPaidRun()).toBeNull();
  });

  it('survives localStorage throwing on read and on write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => savePaidRun(RUN)).not.toThrow();
    expect(loadPaidRun()).toBeNull();
    expect(() => clearPaidRun()).not.toThrow();
  });
});

describe('isResumable', () => {
  it('accepts a fresh run on the same wallet and chain', () => {
    expect(isResumable(RUN, CTX)).toBe(true);
  });

  it('accepts a run just inside the TTL', () => {
    expect(isResumable(RUN, { ...CTX, now: RUN.startedAt + PAID_RUN_TTL_MS - 1 })).toBe(true);
  });

  it('rejects a run past the TTL', () => {
    expect(isResumable(RUN, { ...CTX, now: RUN.startedAt + PAID_RUN_TTL_MS + 1 })).toBe(false);
  });

  it('rejects a run started in a different wallet', () => {
    expect(isResumable(RUN, { ...CTX, wallet: '0xdef' })).toBe(false);
  });

  it('compares wallets case-insensitively', () => {
    expect(isResumable(RUN, { ...CTX, wallet: '0xABC' })).toBe(true);
  });

  it('rejects a run started on a different chain', () => {
    expect(isResumable(RUN, { ...CTX, chainId: 8453 })).toBe(false);
  });

  it('rejects a record from a future schema version', () => {
    expect(isResumable({ ...RUN, v: 2 as unknown as 1 }, CTX)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/paidRun.test.ts`
Expected: FAIL — `Failed to resolve import "./paidRun"`.

- [ ] **Step 3: Implement `lib/paidRun.ts`**

```ts
// The one thing the client must not forget: that money already left the wallet.
//
// localStorage, not sessionStorage: an Android back gesture can tear down the
// whole MiniPay webview, and sessionStorage dies with it — which is precisely
// the failure this exists to survive. The cost is owning the lifetime by hand,
// hence the TTL and the explicit clears.

const KEY = 'coinop.paidRun.v1';

/** A run older than this is the history page's problem, not a resume. */
export const PAID_RUN_TTL_MS = 30 * 60 * 1000;

export interface PaidRun {
  v: 1;
  chainId: number;
  /** bigint as a decimal string — JSON has no bigint. */
  threadId: string;
  payTxHash: string;
  mode: 0 | 1 | 2 | 3 | 4 | 5;
  tokenSymbol: string;
  /** lowercased */
  wallet: string;
  startedAt: number;
}

function isPaidRun(v: unknown): v is PaidRun {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.chainId === 'number' &&
    typeof r.threadId === 'string' &&
    r.threadId.length > 0 &&
    typeof r.payTxHash === 'string' &&
    typeof r.mode === 'number' &&
    typeof r.tokenSymbol === 'string' &&
    typeof r.wallet === 'string' &&
    typeof r.startedAt === 'number'
  );
}

export function savePaidRun(run: PaidRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...run, wallet: run.wallet.toLowerCase() }));
  } catch {
    // Storage blocked. The run still completes on screen; only recovery is lost.
  }
}

export function loadPaidRun(): PaidRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPaidRun(parsed) ? parsed : null;
  } catch {
    // Unreadable or unparseable is the same as absent — never a crash.
    return null;
  }
}

export function clearPaidRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pure predicate, so the rules are testable without a browser. A run belongs to
 * one wallet on one chain: resuming someone else's payment, or a payment made on
 * a chain the user has since left, would show them a thread they did not buy.
 */
export function isResumable(
  run: PaidRun,
  ctx: { now: number; wallet: string; chainId: number },
): boolean {
  if (run.v !== 1) return false;
  if (ctx.now - run.startedAt > PAID_RUN_TTL_MS) return false;
  if (run.wallet.toLowerCase() !== ctx.wallet.toLowerCase()) return false;
  if (run.chainId !== ctx.chainId) return false;
  return true;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/paidRun.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/paidRun.ts lib/paidRun.test.ts
git commit -m "feat(resume): remember that money already left the wallet

localStorage rather than sessionStorage: a back gesture can tear down the
MiniPay webview and sessionStorage dies with it, which is the exact failure
this exists to survive. Lifetime is owned by hand instead — 30-minute TTL,
wallet and chain must match, every access wrapped so a blocked storage
degrades to 'no saved run' rather than a crash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The read path — `GET /api/thread`

**Files:**
- Create: `app/api/thread/route.ts`
- Test: `app/api/thread/route.test.ts`

**Interfaces:**
- Consumes: `getSupabaseServer` (`lib/supabase.ts`), `isSupportedChain` (`lib/chainPolicy.ts:30`).
- Produces: `GET /api/thread?chainId=<int>&threadId=<digits>` →
  - 200 `{ status: string; tweets: string[] | null; topic: string | null; amountPaidRaw: string | null; totalCostUsd: string | null; tokenSymbol: string | null; payTxHash: string | null; walletAddress: string | null }`
  - 400 `{ error }` on an unsupported chain or a non-numeric threadId
  - 404 `{ error: 'not found' }` when no row matches
  - 500 `{ error }` on a Supabase failure

Query params rather than a dynamic segment: `app/api` has no `[param]` route today, and `/api/public/threads?wallet=` is the established shape.

- [ ] **Step 1: Write the failing test**

Create `app/api/thread/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const eqChain = vi.fn(() => ({ eq: eqThread }));
const eqThread = vi.fn(() => ({ maybeSingle }));
// Typed with its parameter: an untyped vi.fn() infers a zero-arg mock, so
// `select.mock.calls[0][0]` is an empty tuple index and the column assertion
// below fails `tsc --noEmit` (TS2352 + TS2493) while still passing at runtime.
const select = vi.fn((_columns: string) => ({ eq: eqChain }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => ({ from }) }));

const { GET } = await import('./route');

function req(qs: string): Request {
  return new Request(`http://localhost/api/thread${qs}`);
}

const ROW = {
  status: 'completed',
  tweets: ['1/ hook', '2/ body'],
  topic: 'zk rollups',
  amount_paid_raw: '100000000000000000',
  total_cost_usd: '0.003',
  token_symbol: 'cUSD',
  pay_tx_hash: '0x7f3a',
  wallet_address: '0xabc',
};

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: ROW, error: null });
});

describe('GET /api/thread', () => {
  it('rejects a chain outside the allowlist', async () => {
    const res = await GET(req('?chainId=1&threadId=4182'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a missing chainId', async () => {
    const res = await GET(req('?threadId=4182'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric threadId', async () => {
    const res = await GET(req('?chainId=42220&threadId=4182;DROP'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a negative threadId', async () => {
    const res = await GET(req('?chainId=42220&threadId=-1'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 404 when no row matches', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(404);
  });

  it('returns the camelCased row for a completed thread', async () => {
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'completed',
      tweets: ['1/ hook', '2/ body'],
      topic: 'zk rollups',
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.003',
      tokenSymbol: 'cUSD',
      payTxHash: '0x7f3a',
      walletAddress: '0xabc',
    });
  });

  it('scopes the query to both chain and thread id', async () => {
    await GET(req('?chainId=42220&threadId=4182'));
    expect(eqChain).toHaveBeenCalledWith('chain_id', 42220);
    expect(eqThread).toHaveBeenCalledWith('onchain_thread_id', '4182');
  });

  it('never selects a column beyond the resume payload', async () => {
    await GET(req('?chainId=42220&threadId=4182'));
    const cols = (select.mock.calls[0][0] as string).split(',');
    expect(cols.sort()).toEqual(
      [
        'amount_paid_raw',
        'pay_tx_hash',
        'status',
        'token_symbol',
        'topic',
        'total_cost_usd',
        'tweets',
        'wallet_address',
      ].sort(),
    );
  });

  it('returns 500 when Supabase errors', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run app/api/thread/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Implement `app/api/thread/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { isSupportedChain } from '@/lib/chainPolicy';

export const runtime = 'nodejs';
// Never cached. The caller is a user who has already paid and is watching this
// poll; /api/public/threads carries `revalidate = 30`, which would show them a
// finished thread up to half a minute late.
export const dynamic = 'force-dynamic';

// amount_paid_raw is the on-chain VERIFIED amount the route wrote at insert
// time (app/api/generate/stream/route.ts:133). It is the only honest source for
// a resumed receipt's price — the head price may have changed since.
const COLUMNS =
  'status,tweets,topic,amount_paid_raw,total_cost_usd,token_symbol,pay_tx_hash,wallet_address';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get('chainId'));
  const threadId = url.searchParams.get('threadId') ?? '';

  // lib/chainPolicy is the only allowlist in the app — never a second list here.
  if (!isSupportedChain(chainId)) {
    return NextResponse.json({ error: 'unsupported chain' }, { status: 400 });
  }
  if (!/^\d+$/.test(threadId)) {
    return NextResponse.json({ error: 'invalid threadId' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from('threads')
      .select(COLUMNS)
      .eq('chain_id', chainId)
      .eq('onchain_thread_id', threadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const row = data as Record<string, unknown>;
    return NextResponse.json({
      status: row.status ?? null,
      tweets: row.tweets ?? null,
      topic: row.topic ?? null,
      amountPaidRaw: row.amount_paid_raw ?? null,
      totalCostUsd: row.total_cost_usd ?? null,
      tokenSymbol: row.token_symbol ?? null,
      payTxHash: row.pay_tx_hash ?? null,
      walletAddress: row.wallet_address ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run app/api/thread/route.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/thread/route.ts app/api/thread/route.test.ts
git commit -m "feat(resume): a read path for one thread, uncached

/api/public/threads carries revalidate=30, so polling it would show a user
who is already waiting a finished thread up to half a minute late, and
widening it would put two opposite caching rules in one handler that also
serves /history.

Read-only, chain validated against the single allowlist, threadId digits
only, and the column list is asserted by a test so the payload cannot grow
by accident.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Reading the row's meaning — `lib/resumeRun.ts`

The poll's decisions live here as pure functions, because `package.json` collects tests from `lib` and `app` only — nothing under `hooks/` is tested. Task 4's hook is then a thin, boring wrapper.

**Files:**
- Create: `lib/resumeRun.ts`
- Test: `lib/resumeRun.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ThreadRow { status: string | null; tweets: string[] | null; topic: string | null; amountPaidRaw: string | null; totalCostUsd: string | null; tokenSymbol: string | null; payTxHash: string | null; walletAddress: string | null }`
  - `type ResumeState = { state: 'checking' } | { state: 'done'; tweets: string[]; amountPaidRaw: string | null; totalCostUsd: string; topic: string | null } | { state: 'failed' } | { state: 'gone' }`
  - `interpretThreadRow(row: ThreadRow | null): ResumeState`
  - `fetchThreadRow(chainId: number, threadId: string, signal?: AbortSignal): Promise<ThreadRow | null>`
  - `const RESUME_POLL_MS: number`, `const RESUME_CEILING_MS: number`

- [ ] **Step 1: Write the failing test**

Create `lib/resumeRun.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  interpretThreadRow,
  fetchThreadRow,
  RESUME_POLL_MS,
  RESUME_CEILING_MS,
  type ThreadRow,
} from './resumeRun';

const DONE: ThreadRow = {
  status: 'completed',
  tweets: ['1/ hook', '2/ body'],
  topic: 'zk rollups',
  amountPaidRaw: '100000000000000000',
  totalCostUsd: '0.003',
  tokenSymbol: 'cUSD',
  payTxHash: '0x7f3a',
  walletAddress: '0xabc',
};

describe('interpretThreadRow', () => {
  it('keeps checking while the row is pending', () => {
    expect(interpretThreadRow({ ...DONE, status: 'pending', tweets: null })).toEqual({
      state: 'checking',
    });
  });

  it('keeps checking when the row does not exist yet', () => {
    // The row is inserted by /api/generate/stream. A client that died between
    // the payment landing and that request finds nothing here for a moment.
    expect(interpretThreadRow(null)).toEqual({ state: 'checking' });
  });

  it('reports done with the tweets and the verified amount once completed', () => {
    expect(interpretThreadRow(DONE)).toEqual({
      state: 'done',
      tweets: ['1/ hook', '2/ body'],
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.003',
      topic: 'zk rollups',
    });
  });

  it('defaults a missing total cost rather than inventing one', () => {
    const out = interpretThreadRow({ ...DONE, totalCostUsd: null });
    expect(out).toEqual({
      state: 'done',
      tweets: ['1/ hook', '2/ body'],
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.000',
      topic: 'zk rollups',
    });
  });

  it('passes a missing amount through as null rather than substituting a price', () => {
    const out = interpretThreadRow({ ...DONE, amountPaidRaw: null });
    expect(out).toEqual({
      state: 'done',
      tweets: ['1/ hook', '2/ body'],
      amountPaidRaw: null,
      totalCostUsd: '0.003',
      topic: 'zk rollups',
    });
  });

  it('reports failed when the run failed', () => {
    expect(interpretThreadRow({ ...DONE, status: 'failed', tweets: null })).toEqual({
      state: 'failed',
    });
  });

  it('treats completed-with-no-tweets as a failure, not a success', () => {
    expect(interpretThreadRow({ ...DONE, tweets: [] })).toEqual({ state: 'failed' });
    expect(interpretThreadRow({ ...DONE, tweets: null })).toEqual({ state: 'failed' });
  });

  it('treats an unrecognised status as still running', () => {
    expect(interpretThreadRow({ ...DONE, status: 'queued' })).toEqual({ state: 'checking' });
  });
});

describe('timing constants', () => {
  it('polls often enough to feel live and stops well before the TTL', () => {
    expect(RESUME_POLL_MS).toBe(3_000);
    expect(RESUME_CEILING_MS).toBe(180_000);
  });
});

describe('fetchThreadRow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the thread by chain and id', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => DONE,
    });
    const out = await fetchThreadRow(42220, '4182');
    expect(out).toEqual(DONE);
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('/api/thread?chainId=42220&threadId=4182');
  });

  it('returns null on 404 so the caller keeps waiting', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    });
    expect(await fetchThreadRow(42220, '4182')).toBeNull();
  });

  it('returns null when the network throws', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    expect(await fetchThreadRow(42220, '4182')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/resumeRun.test.ts`
Expected: FAIL — `Failed to resolve import "./resumeRun"`.

- [ ] **Step 3: Implement `lib/resumeRun.ts`**

```ts
// What a thread row means to someone waiting for a run they already paid for.
// Kept pure and outside hooks/ so `vitest run lib app` actually collects it.

/** Fast enough to feel live, slow enough not to hammer the row. */
export const RESUME_POLL_MS = 3_000;
/** A healthy run is 20-40s. Past this the answer is /history, not a spinner. */
export const RESUME_CEILING_MS = 180_000;

export interface ThreadRow {
  status: string | null;
  tweets: string[] | null;
  topic: string | null;
  /** On-chain verified amount in token base units, as written at insert time. */
  amountPaidRaw: string | null;
  totalCostUsd: string | null;
  tokenSymbol: string | null;
  payTxHash: string | null;
  walletAddress: string | null;
}

export type ResumeState =
  | { state: 'checking' }
  | {
      state: 'done';
      tweets: string[];
      amountPaidRaw: string | null;
      totalCostUsd: string;
      topic: string | null;
    }
  | { state: 'failed' }
  | { state: 'gone' };

export function interpretThreadRow(row: ThreadRow | null): ResumeState {
  // No row yet is not the same as no run. /api/generate/stream inserts the row
  // itself, so a client that died right after the payment landed can arrive
  // here before the row exists. Keep waiting; the caller's ceiling decides when
  // to give up.
  if (!row) return { state: 'checking' };

  if (row.status === 'failed') return { state: 'failed' };

  if (row.status === 'completed') {
    // Completed with nothing to show is a broken run, not a delivery. Sending
    // the user to the refund copy is the honest branch.
    if (!row.tweets || row.tweets.length === 0) return { state: 'failed' };
    return {
      state: 'done',
      tweets: row.tweets,
      // Never substituted. A receipt that cannot state the price says nothing
      // rather than reprinting today's price for yesterday's payment.
      amountPaidRaw: row.amountPaidRaw,
      // The row is the only record of what this run cost. Absent means unknown,
      // and '0.000' reads as unknown — it is never back-filled from a constant.
      totalCostUsd: row.totalCostUsd ?? '0.000',
      topic: row.topic,
    };
  }

  return { state: 'checking' };
}

/** null means "no answer yet" — a 404, an error status, or an offline device. */
export async function fetchThreadRow(
  chainId: number,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadRow | null> {
  try {
    const res = await fetch(`/api/thread?chainId=${chainId}&threadId=${threadId}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as ThreadRow;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/resumeRun.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/resumeRun.ts lib/resumeRun.test.ts
git commit -m "feat(resume): what a thread row means to someone still waiting

Pure, because vitest collects lib and app only — the hook that wraps this
would otherwise be untested.

Two branches worth naming: a missing row keeps waiting rather than giving
up, since /api/generate/stream inserts the row itself and a client can
arrive before it; and completed-with-no-tweets resolves to failed, because
a delivery with nothing in it is a broken run, not a success.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The poll and the screen

**Files:**
- Create: `hooks/useResumeRun.ts`
- Create: `components/ResumingRun.tsx`
- Modify: `lib/screens.ts` — add `'resuming'` to the `Screen` union

**Interfaces:**
- Consumes: `PaidRun` (Task 1); `ResumeState`, `interpretThreadRow`, `fetchThreadRow`, `RESUME_POLL_MS`, `RESUME_CEILING_MS` (Task 3); `TerminalPanel` (`components/terminal/TerminalPanel.tsx`); `threadLabel` (`lib/threadLabel.ts:48`).
- Produces:
  - `useResumeRun(run: PaidRun | null): ResumeState`
  - `<ResumingRun run={PaidRun} state={ResumeState} onOpenHistory={() => void} />` — no explorer prop: the pay tx is rendered as text, never as a link
  - `Screen` gains `'resuming'`.

- [ ] **Step 1: Add `'resuming'` to the screen union**

In `lib/screens.ts`, insert after the `'spend-unavailable'` entry and before `'generating'`:

```ts
  // The client lost its screen mid-run (reload, back gesture, webview reclaimed)
  // and found a paid run in storage. Read-only: it polls the thread row and
  // never re-issues /api/generate/stream, which would be rejected 409 anyway.
  | 'resuming'
```

`isInputScreen` needs no change — `INPUT_SCREENS` is an explicit list and `isOutputScreen` is its complement, so `'resuming'` is already classified as an output screen.

- [ ] **Step 2: Typecheck to confirm the union widened cleanly**

Run: `npx tsc --noEmit`
Expected: PASS. (If a `switch` somewhere became non-exhaustive, fix it before continuing.)

- [ ] **Step 3: Implement `hooks/useResumeRun.ts`**

```ts
'use client';

import { useEffect, useState } from 'react';
import type { PaidRun } from '@/lib/paidRun';
import {
  fetchThreadRow,
  interpretThreadRow,
  RESUME_CEILING_MS,
  RESUME_POLL_MS,
  type ResumeState,
} from '@/lib/resumeRun';

/**
 * Polls one thread row until it resolves. Read-only by construction: there is
 * no code path here that starts a generation.
 *
 * `run` must be referentially stable — hold it in state, not in a literal, or
 * every render restarts the poll.
 */
export function useResumeRun(run: PaidRun | null): ResumeState {
  const [state, setState] = useState<ResumeState>({ state: 'checking' });

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const deadline = Date.now() + RESUME_CEILING_MS;

    async function tick() {
      if (cancelled) return;
      const row = await fetchThreadRow(run!.chainId, run!.threadId, controller.signal);
      if (cancelled) return;

      const next = interpretThreadRow(row);
      if (next.state !== 'checking') {
        setState(next);
        return;
      }
      // Still nothing. Give up only at the ceiling, and say so as 'gone' rather
      // than spinning forever at a user who has already paid.
      if (Date.now() >= deadline) {
        setState({ state: 'gone' });
        return;
      }
      setState(next);
      timer = setTimeout(tick, RESUME_POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [run]);

  return state;
}
```

- [ ] **Step 4: Implement `components/ResumingRun.tsx`**

```tsx
'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import type { PaidRun } from '@/lib/paidRun';
import type { ResumeState } from '@/lib/resumeRun';
import { threadLabel } from '@/lib/threadLabel';

/**
 * Shown when the app reopens onto a run that was already paid for. The first
 * question a user has here is whether their money is gone, so the payment is
 * stated before anything else.
 *
 * The pay tx is deliberately NOT a link: this screen exists because the user
 * lost the app once already, and handing them a target="_blank" into an
 * external browser is how it happens again (audit finding 6.2).
 */
export function ResumingRun({
  run,
  state,
  onOpenHistory,
}: {
  run: PaidRun;
  state: ResumeState;
  onOpenHistory: () => void;
}) {
  const label = threadLabel({ mode: run.mode, topic: null });

  return (
    <TerminalPanel title={`RESUMING RUN #${run.threadId}`} className="w-full max-w-md">
      <p className="text-sm font-mono text-money">
        paid · {run.tokenSymbol}
      </p>
      <p className="mt-1 text-[11px] font-mono text-muted-foreground break-all">
        tx {run.payTxHash}
      </p>
      <p className="mt-3 text-sm font-sans text-muted-foreground leading-snug">
        {label} — the agent kept working while you were away. Nothing was lost and
        you will not be charged again.
      </p>

      {state.state === 'checking' && (
        <p className="mt-4 flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          checking for your thread…
        </p>
      )}

      {state.state === 'gone' && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            This is taking longer than expected. Your thread is not lost — it
            appears in history as soon as the agent finishes.
          </p>
          <Button variant="outline" onClick={onOpenHistory}>
            Open history
          </Button>
        </div>
      )}
    </TerminalPanel>
  );
}
```

The `failed` and `done` states never render here — Task 5 routes them onward before this component sees them.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add hooks/useResumeRun.ts components/ResumingRun.tsx lib/screens.ts
git commit -m "feat(resume): a screen that answers 'is my money gone' first

The poll is read-only by construction — no path in the hook starts a
generation. The screen states the payment before anything else, because
that is the question someone has when the app reopens on a run they paid
for and never saw finish.

The pay tx is shown but not linked: this screen exists because the user
lost the app once already, and target=_blank into an external browser is
how that happens (audit finding 6.2).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Wiring — remember, restore, clear

**Files:**
- Modify: `app/HomeClient.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4.
- Produces: no new exports. Behaviour only.

Six edits, in this order.

- [ ] **Step 1: Add the imports**

`app/HomeClient.tsx:44` already reads
`import { computeTokenAmount, type TokenSymbol } from '@/lib/tokens';` — **extend
that line** rather than adding a second import from the same module:

```ts
import { computeTokenAmount, getTokens, type TokenSymbol } from '@/lib/tokens';
```

Then, after `import { peekGuestTopic } from '@/lib/guestSession';` (`:57`):

```ts
import { savePaidRun, loadPaidRun, clearPaidRun, isResumable, type PaidRun } from '@/lib/paidRun';
import { useResumeRun } from '@/hooks/useResumeRun';
import { ResumingRun } from '@/components/ResumingRun';
import { initialState as initialGenState } from '@/lib/threadGeneration';
```

`formatUnits` is already imported from `viem` (`:6`).

- [ ] **Step 2: Add the resume state**

Beside the other `useState` declarations (`app/HomeClient.tsx:163-183`):

```ts
  // Held in state, not recomputed each render, because useResumeRun keys its
  // effect on this object's identity — an inline value would restart the poll
  // on every render.
  const [resumingRun, setResumingRun] = useState<PaidRun | null>(null);
  // The row's own numbers for a resumed receipt. Null during a live run, where
  // the SSE stream supplies them instead.
  const [resumedReceipt, setResumedReceipt] = useState<
    { amountPaidRaw: string | null; totalCostUsd: string } | null
  >(null);
  const restoreAttempted = useRef(false);
  const resumeApplied = useRef(false);
```

- [ ] **Step 3: Remember the run at the moment the payment succeeds**

The effect at `app/HomeClient.tsx:388-397` already fires exactly once per
successful payment (guarded by the `paidTracked` ref) and already computes
`mode` as `0 | 1 | 2 | 3 | 4 | 5`. Inside its `if (paidTracked.current !== key)`
block, after the existing `track('pay', …)` call:

```ts
        const payToken =
          submitted?.token ?? hotTake?.token ?? tokenAnalysis?.token ??
          dailyRecap?.token ?? comparison?.token ?? newsBreakdown?.token ?? null;
        if (txHash && address && payToken) {
          // Written before the SSE stream can finish, because the whole point is
          // surviving a client that does not live that long.
          savePaidRun({
            v: 1,
            chainId,
            threadId: key,
            payTxHash: txHash,
            mode,
            tokenSymbol: payToken.symbol,
            wallet: address.toLowerCase(),
            startedAt: Date.now(),
          });
        }
```

Add `txHash` to that effect's dependency array.

- [ ] **Step 4: Restore once on mount**

Add after the disconnect effect (`app/HomeClient.tsx:206-227`). It must come
**after** that effect in source order: the disconnect/connect effect can call
`setScreen('mode')` or `setScreen('educational')`, and whichever runs last wins.

```ts
  // Reopening onto a paid run. One shot, latched by a ref: a user who moves on
  // from the resume screen must not be dragged back into it on a later render.
  useEffect(() => {
    if (!mounted || !isConnected || !address) return;
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;

    const saved = loadPaidRun();
    if (!saved) return;
    if (!isResumable(saved, { now: Date.now(), wallet: address, chainId })) {
      // Wrong wallet, wrong chain, or too old to be this session's problem.
      clearPaidRun();
      return;
    }
    setResumingRun(saved);
    setScreen('resuming');
  }, [mounted, isConnected, address, chainId]);

  const resumeState = useResumeRun(resumingRun);

  // A resumed run rejoins the ordinary flow rather than growing a parallel one:
  // same preview screen, same downstream states.
  useEffect(() => {
    if (!resumingRun || resumeApplied.current) return;
    if (resumeState.state === 'done') {
      resumeApplied.current = true;
      setDraftTweets(resumeState.tweets);
      setResumedReceipt({
        amountPaidRaw: resumeState.amountPaidRaw,
        totalCostUsd: resumeState.totalCostUsd,
      });
      setScreen('preview');
      // The thread has been handed back; storage has done its job.
      clearPaidRun();
    } else if (resumeState.state === 'failed') {
      resumeApplied.current = true;
      setScreen('mode');
      clearPaidRun();
      setResumingRun(null);
    }
  }, [resumeState, resumingRun]);
```

`resumingRun` is deliberately **kept** on the `done` path. It is the only source
of the token symbol and thread id that `post-share` needs in Step 6, and the
poll has already stopped — `useResumeRun` schedules no further tick once the
state leaves `checking`.

- [ ] **Step 5: Forget the run when the user moves on**

At each of the three existing `reset()` sites — `app/HomeClient.tsx:909`
(`onWriteAnother`), `:955` and `:996` (the two post-failure exits) — add
immediately before the existing `reset()` call:

```ts
            clearPaidRun();
            setResumingRun(null);
            setResumedReceipt(null);
            resumeApplied.current = false;
```

Also add the same four lines to the disconnect branch of the effect at
`app/HomeClient.tsx:206-227`, beside the existing `setDraftTweets(null)`: a run
belongs to a wallet, and the wallet just left.

- [ ] **Step 6: Render the resume screen, and make `post-share` survive a resume**

Add a branch immediately before `screen === 'generating'` (`app/HomeClient.tsx:842`):

```tsx
    ) : screen === 'resuming' && resumingRun ? (
      <ResumingRun
        run={resumingRun}
        state={resumeState}
        onOpenHistory={() => {
          window.location.href = '/history';
        }}
      />
```

`post-share` is guarded on `activeToken` (`:895`), which a resumed run has no
form payload to supply. Beside the existing `activeToken` definition (`:185`):

```ts
  // A resumed run has no payload, so the token comes back from storage. Config
  // supplies the DECIMALS only — the amount comes from the row, below.
  const resumedToken = resumingRun
    ? (getTokens(resumingRun.chainId)[resumingRun.tokenSymbol as TokenSymbol] ?? null)
    : null;
  const receiptToken = activeToken ?? resumedToken;
```

Change the branch guard from `screen === 'post-share' && activeToken` to
`screen === 'post-share' && receiptToken`, and inside it:

```tsx
      <PostShareScreen
        threadId={threadId ?? (resumingRun ? BigInt(resumingRun.threadId) : null)}
        paidAmountUsd={
          // The row's amount is the on-chain VERIFIED one. Only when it is
          // absent does this fall back to the head price — which is exactly what
          // the live path already does today (audit finding 6.4/7.1, fixed in a
          // separate pass). This never makes the live path worse and makes the
          // resumed path right whenever the data exists.
          resumedReceipt?.amountPaidRaw
            ? Number(
                formatUnits(BigInt(resumedReceipt.amountPaidRaw), receiptToken.decimals),
              ).toFixed(3)
            : Number(
                formatUnits(computeTokenAmount(receiptToken), receiptToken.decimals),
              ).toFixed(3)
        }
        agentSpentUsd={gen.totalCostUsd ?? resumedReceipt?.totalCostUsd ?? '0.001'}
        tokenSymbol={receiptToken.symbol}
        payTxHash={txHash ?? resumingRun?.payTxHash ?? null}
        // No live run means no per-step costs were ever streamed, and the
        // database never stored any. settledCalls drops cost-less steps, so
        // PostShareScreen prints its single `agent spend` line instead of
        // per-call rows invented from X402_UNIT_COST_USD.
        steps={gen.hasStarted ? gen.steps : initialGenState.steps}
        agentWalletAddress={getContracts(chainId).AgentWallet}
        explorerBase={explorerBase(chainId)}
```

Leave the rest of the props as they are. Add `clearPaidRun(); setResumingRun(null);
setResumedReceipt(null); resumeApplied.current = false;` to its `onWriteAnother`
if Step 5 has not already covered that site.

- [ ] **Step 7: Run the full gate**

Run: `pnpm test:lib && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all PASS. Paste the real output; do not claim green without reading it.

- [ ] **Step 8: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(resume): reopen onto the run instead of an empty mode picker

Remember when the payment succeeds, restore once on mount, forget when the
user moves on or the wallet leaves. A resumed run rejoins the ordinary flow
at the preview screen rather than growing a parallel one.

post-share previously required a form payload it cannot have after a
reload. The token is rebuilt from storage for its decimals; the amount
comes from the row's on-chain verified amount_paid_raw, and the agent
spend from the row's total_cost_usd — neither from the head price nor from
the 0.001 constant. Steps come back as the initial state, so the receipt
collapses to one honest total line rather than printing per-call costs the
database never stored.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The guards

Analgesic, not the cure — neither event is reliable in an Android webview, and an OS-reclaimed process fires nothing at all. Task 5 is what makes the run recoverable; this only reduces how often recovery is needed.

**Files:**
- Modify: `app/HomeClient.tsx`

**Interfaces:**
- Consumes: `screen` state from Task 5.
- Produces: behaviour only.

- [ ] **Step 1: Add the guard effect**

Place after the resume effects from Task 5:

```ts
  // While a paid run is on screen, the first back press should return into the
  // app rather than close the webview, and a desktop reload should ask first.
  // Neither is load-bearing: if both fail, the resume path still recovers the
  // run. They exist so recovery is needed less often.
  useEffect(() => {
    if (screen !== 'generating') return;

    const marker = { coinop: 'run' };
    window.history.pushState(marker, '', window.location.href);

    const onPopState = () => {
      // Re-arm, so a second press is caught too. There is nowhere useful to go
      // back to mid-run: every earlier screen is a form whose payload is spent.
      window.history.pushState(marker, '', window.location.href);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [screen]);
```

- [ ] **Step 2: Verify the gate still passes**

Run: `npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(resume): make the first back press stay in the app

Analgesic, not the cure. Neither popstate nor beforeunload is reliable in
an Android webview and an OS-reclaimed process fires neither, so nothing
depends on them — the resume path is what recovers the run. These only
reduce how often it has to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Runtime verification and the manual test guide

The user asked for a detailed manual test walkthrough. It is a deliverable, not an afterthought.

**Files:**
- Create: `docs/manual-tests/2026-08-18-paid-run-survival.md`
- Temporary (not committed): a Playwright harness in the scratchpad

**Interfaces:**
- Consumes: the whole feature.
- Produces: a document a person can follow on a device.

- [ ] **Step 1: Read the repo's `verify` skill and follow its setup**

The skill covers the dev server plus a mocked injected EIP-1193 provider, which is required because connected-state UI cannot render without a wallet. Notes carried from previous runs: Playwright is **not** a project dependency — install it in the scratchpad with `npm i playwright --no-save`; and Next excludes `_`-prefixed app folders from routing, so a temporary harness page must not start with an underscore.

- [ ] **Step 2: Verify the resume path without spending money**

Pick a real `onchain_thread_id` that is already `completed` on the current chain (read one from `/api/public/threads?chainId=42220&limit=5`). Then, at 390×844 with the mocked wallet connected:

```js
localStorage.setItem('coinop.paidRun.v1', JSON.stringify({
  v: 1,
  chainId: 42220,
  threadId: '<a real completed onchain_thread_id>',
  payTxHash: '<that row pay_tx_hash>',
  mode: 0,
  tokenSymbol: 'cUSD',
  wallet: '<the mocked wallet address, lowercase>',
  startedAt: Date.now(),
}));
location.reload();
```

Expected: the `RESUMING RUN #…` panel appears, then the app lands on the preview screen with that thread's tweets. Confirm in devtools that **no** request to `/api/generate/stream` was made.

- [ ] **Step 3: Verify each rejection branch**

Repeat Step 2's seed with one field changed at a time, reloading between each:

| Change | Expected |
|---|---|
| `wallet` set to a different address | no resume, mode picker, key cleared |
| `chainId` set to the other supported chain | no resume, mode picker, key cleared |
| `startedAt: Date.now() - 31*60*1000` | no resume, mode picker, key cleared |
| `threadId` set to a `pending` row | `checking for your thread…` persists |
| `threadId: '999999999'` (no such row) | stays checking, then `Open history` after the ceiling |

- [ ] **Step 4: Write the manual test guide**

Create `docs/manual-tests/2026-08-18-paid-run-survival.md` containing, in order:

1. **What this feature is for** — one paragraph: paid run, lost screen, recovered.
2. **The free tests** (no payment): every row from Step 3 above, written as numbered steps with the exact `localStorage` snippet to paste into the MiniPay/desktop devtools console and the exact expected screen.
3. **The real test** (costs one thread at the live price): run a paid thread on a device, and at the moment the amber `SPENT` line first appears, swipe back / kill the app. Reopen. Expected: `RESUMING RUN #…`, then the tweets. Record what actually happened, including the thread id, so a failure is diagnosable afterwards.
4. **What "correct" looks like for each screen** — the exact copy on the resuming panel, and that the pay tx is shown as text, not a tappable link.
5. **Known limits, stated plainly** — a resumed receipt shows one `agent spend $X` total rather than per-call rows (the database never stored per-call costs); and a client that died between the payment landing and the first `/api/generate/stream` request will poll for three minutes and then point at history, because no thread row was ever created — that case is the refund path, not a resume.
6. **How to reset between tests** — `localStorage.removeItem('coinop.paidRun.v1')`.

- [ ] **Step 5: Commit**

```bash
git add docs/manual-tests/2026-08-18-paid-run-survival.md
git commit -m "docs: how to test paid-run survival by hand

Most of it costs nothing — seeding the storage key against a thread that
already exists exercises restore, poll and render without a payment. The
one test that does cost money is the only one that proves the real gesture.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Final gate before reporting done**

Run: `pnpm test:lib && pnpm test:contracts && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all PASS. Paste the real output. `test:contracts` must stay green even though no contract changed — it is the check that nothing was disturbed.

---

## Definition of done

- 6.1 no longer reproduces: a reload during `generating` returns to the run, not the mode picker.
- No path calls `/api/generate/stream` twice for one payment.
- A resumed receipt contains no number the database did not supply.
- The manual test guide exists and its free tests have been executed at least once.
