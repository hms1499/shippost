# Free Preview Paywall (Batch B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see the first tweet of their thread for free, then pay $0.05 to unlock the full thread — without ever spending from AgentWallet or writing a thread row before payment.

**Architecture:** Extract the external-call (Groq/Serper/CoinGecko) portions of the pipeline steps out of their settle/emit wrappers into pure helpers. A new `runPreview` composes those helpers to produce a draft *without* settling. A new `POST /api/preview` runs it behind a per-wallet + global rate limit (fail-closed) and returns only `{ firstTweet, totalTweets }`. The client shows a `preview-locked` screen; "Unlock" runs the **unchanged** existing pay→generate flow (which regenerates fresh).

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest (no jsdom — logic tests only), Upstash rate limiting, Groq/Serper/CoinGecko.

**Spec:** `docs/superpowers/specs/2026-06-04-free-preview-paywall-design.md`

**Invariant (never regress):** the preview path must never import or call `settleX402Call`, never reference AgentWallet, and never write a `threads` row. Tasks 4 and 6 carry tests that enforce this.

---

## Task 1: Extract `generateTweets` from `generateDraft.ts`

Factor the direct-Groq generation (call + parse + bound) out of the settle path so the preview can generate without settling. The paid `generateDraft` keeps identical behaviour (calls the new helper, then settles).

**Files:**
- Modify: `lib/pipeline/generateDraft.ts`
- Test: `lib/pipeline/generateDraft.test.ts`

- [ ] **Step 1: Add the failing test** — append this `describe` block to `lib/pipeline/generateDraft.test.ts` (after the existing `describe('generateDraft', ...)` block, before the file ends):

```ts
describe('generateTweets', () => {
  it('calls Groq, parses + bounds, and never settles', async () => {
    const { generateTweets } = await import('./generateDraft');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    const tweets = await generateTweets(msgs);
    expect(create).toHaveBeenCalledOnce();
    expect(tweets.length).toBeGreaterThan(0);
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('throws on empty Groq output (and never settles)', async () => {
    const { generateTweets } = await import('./generateDraft');
    create.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    await expect(generateTweets(msgs)).rejects.toThrow();
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run lib/pipeline/generateDraft.test.ts`
Expected: FAIL — `generateTweets is not a function` / undefined export.

- [ ] **Step 3: Extract the helper** — in `lib/pipeline/generateDraft.ts`, add this exported function (place it directly above `export async function generateDraft`):

```ts
// Direct Groq generation: call, validate, parse — NO settle, NO abort plumbing.
// Reused by the paid `generateDraft` (legacy branch) and by the free preview.
export async function generateTweets(input: DraftInput): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });
  const resp = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
  });
  const raw = resp.choices[0]?.message?.content ?? '';
  if (!raw.trim()) throw new Error('Groq returned empty content');
  return boundThread(parseThread(raw));
}
```

Then replace the legacy branch body of `generateDraft` (everything from `// legacy: call Groq directly...` through the `return { tweets, txHash, ... }`) with:

```ts
  // legacy: call Groq directly, validate, then push-to-sink in cUSD.
  const tweets = await generateTweets(input);
  // Re-check: the deadline may have fired while Groq was responding. Never
  // settle (spend) after the run is already considered failed.
  throwIfAborted(ctx.signal);
  const txHash = await settleX402Call({
    chainId: ctx.chainId,
    serviceAddress: GROQ_SINK,
    tokenSymbol: 'cUSD',
    amount: GROQ_COST_CUSD,
    threadId: ctx.threadId,
  });
  return { tweets, txHash, costHuman: GROQ_COST_HUMAN, tokenSymbol: 'cUSD' };
```

(The top-of-function `throwIfAborted(ctx.signal)` and the x402-mode branch are unchanged.)

- [ ] **Step 4: Run the full file, watch it pass**

Run: `pnpm vitest run lib/pipeline/generateDraft.test.ts`
Expected: PASS — all existing `generateDraft` tests plus the 2 new `generateTweets` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/generateDraft.ts lib/pipeline/generateDraft.test.ts
git commit -m "refactor(pipeline): extract settle-free generateTweets from generateDraft"
```

---

## Task 2: Extract `fetchSerper` from `serperStep.ts`

**Files:**
- Modify: `lib/pipeline/serperStep.ts`
- Test: `lib/pipeline/serperStep.test.ts`

- [ ] **Step 1: Add the failing test** — append to `lib/pipeline/serperStep.test.ts`:

```ts
describe('fetchSerper', () => {
  it('fetches and shapes results without settling', async () => {
    const { fetchSerper } = await import('./serperStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ organic: [{ title: 't', snippet: 's', link: 'l' }], answerBox: { snippet: 'box' } }),
      })),
    );
    const out = await fetchSerper('bitcoin');
    expect(out.query).toBe('bitcoin');
    expect(out.organic).toHaveLength(1);
    expect(out.newsSnippet).toBe('box');
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run lib/pipeline/serperStep.test.ts`
Expected: FAIL — `fetchSerper is not a function`.

- [ ] **Step 3: Extract the helper** — in `lib/pipeline/serperStep.ts`, add this exported function above `runSerperStep`:

```ts
// Pure Serper fetch — no emit, no settle. Used by the paid step (which then
// settles + emits) and by the free preview (which does neither).
export async function fetchSerper(query: string): Promise<SerperResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing');
  const data = await retryOnce(async () => {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5, gl: 'us', hl: 'en' }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const json = (await res.json()) as {
      organic?: SerperOrganicResult[];
      answerBox?: { snippet?: string };
      knowledgeGraph?: { description?: string };
    };
    return {
      organic: json.organic ?? [],
      newsSnippet: json.answerBox?.snippet ?? json.knowledgeGraph?.description ?? null,
    };
  });
  return { query, organic: data.organic, newsSnippet: data.newsSnippet };
}
```

Then in `runSerperStep`, replace the fetch block (the `try { const data = await retryOnce(...) ... organic = data.organic; newsSnippet = data.newsSnippet; } catch ...`) so it delegates to `fetchSerper`:

```ts
  let organic: SerperOrganicResult[] = [];
  let newsSnippet: string | null = null;

  try {
    const data = await fetchSerper(ctx.query);
    organic = data.organic;
    newsSnippet = data.newsSnippet;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'serper failed';
    emit({ type: 'step_failed', step: 'serper', error: msg });
    throw e;
  }
```

(Everything after — `emit step_output`, `throwIfAborted`, the settle block — is unchanged. The `const key = ...` guard at the top of `runSerperStep` can be removed since `fetchSerper` now owns it; if you leave it, it's harmless.)

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm vitest run lib/pipeline/serperStep.test.ts`
Expected: PASS (existing + new `fetchSerper` test).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/serperStep.ts lib/pipeline/serperStep.test.ts
git commit -m "refactor(pipeline): extract settle-free fetchSerper from serperStep"
```

---

## Task 3: Extract `fetchCoinGecko` from `coingeckoStep.ts`

**Files:**
- Modify: `lib/pipeline/coingeckoStep.ts`
- Test: `lib/pipeline/coingeckoStep.test.ts` (create if absent)

- [ ] **Step 1: Add the failing test** — create/append `lib/pipeline/coingeckoStep.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCoinGecko', () => {
  it('returns EMPTY when no $cashtag is present', async () => {
    const { fetchCoinGecko } = await import('./coingeckoStep');
    const out = await fetchCoinGecko('no ticker here');
    expect(out).toEqual({ symbol: null, priceUsd: null, change24hPct: null, marketCapUsd: null });
  });

  it('resolves a $cashtag to price data', async () => {
    const { fetchCoinGecko } = await import('./coingeckoStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search')) {
          return { ok: true, json: async () => ({ coins: [{ id: 'bitcoin', symbol: 'btc' }] }) };
        }
        return {
          ok: true,
          json: async () => ({ bitcoin: { usd: 50000, usd_24h_change: 2.5, usd_market_cap: 1e12 } }),
        };
      }),
    );
    const out = await fetchCoinGecko('thoughts on $BTC today');
    expect(out.symbol).toBe('BTC');
    expect(out.priceUsd).toBe(50000);
    expect(out.change24hPct).toBe(2.5);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run lib/pipeline/coingeckoStep.test.ts`
Expected: FAIL — `fetchCoinGecko is not a function`.

- [ ] **Step 3: Extract the helper** — in `lib/pipeline/coingeckoStep.ts`, add this exported function above `runCoinGeckoStep`:

```ts
// Pure CoinGecko lookup — no emit. Returns EMPTY when no $cashtag is found or
// the coin can't be resolved. Used by the paid step and the free preview.
export async function fetchCoinGecko(topicText: string): Promise<CoinGeckoResult> {
  const sym = extractSymbol(topicText);
  if (!sym) return EMPTY;
  const id = await resolveCoinId(sym);
  if (!id) return { ...EMPTY, symbol: sym.toUpperCase() };
  const entry = await retryOnce(async () => {
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const j = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number; usd_market_cap?: number }
    >;
    return j[id];
  });
  return {
    symbol: sym.toUpperCase(),
    priceUsd: entry?.usd ?? null,
    change24hPct: entry?.usd_24h_change ?? null,
    marketCapUsd: entry?.usd_market_cap ?? null,
  };
}
```

Then refactor `runCoinGeckoStep` to delegate to `fetchCoinGecko`, keeping its emits. Replace the body (from `const sym = extractSymbol(ctx.topic);` to the final `return result;` in the try block) with:

```ts
  let result: CoinGeckoResult;
  try {
    result = await fetchCoinGecko(ctx.topic);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'coingecko failed';
    emit({ type: 'step_failed', step: 'coingecko', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'coingecko', output: result });
  emit({
    type: 'step_settled',
    step: 'coingecko',
    txHash: NULL_TX,
    costAmount: '0.000',
    tokenSymbol: 'cUSD',
  });
  return result;
```

(`extractSymbol`, `resolveCoinId`, `EMPTY`, `NULL_TX`, `CG_BASE` stay. The `emit({ type: 'step_started', step: 'coingecko' })` at the top of `runCoinGeckoStep` stays.)

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm vitest run lib/pipeline/coingeckoStep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/coingeckoStep.ts lib/pipeline/coingeckoStep.test.ts
git commit -m "refactor(pipeline): extract settle-free fetchCoinGecko from coingeckoStep"
```

---

## Task 4: `runPreview` — settle-free draft generation

**Files:**
- Create: `lib/pipeline/runPreview.ts`
- Test: `lib/pipeline/runPreview.test.ts`

- [ ] **Step 1: Write the failing test** — create `lib/pipeline/runPreview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateTweets = vi.fn();
const fetchSerper = vi.fn();
const fetchCoinGecko = vi.fn();

vi.mock('./generateDraft', () => ({ generateTweets }));
vi.mock('./serperStep', () => ({ fetchSerper }));
vi.mock('./coingeckoStep', () => ({ fetchCoinGecko }));

const { runPreview } = await import('./runPreview');

beforeEach(() => {
  vi.clearAllMocks();
  generateTweets.mockResolvedValue(['1/ hook', '2/ body']);
});

describe('runPreview', () => {
  it('Mode A: generates from topic/audience, no grounding calls', async () => {
    const out = await runPreview({ mode: 0, topic: 'EIP-712', audience: 'beginner' });
    expect(out.tweets).toHaveLength(2);
    expect(fetchSerper).not.toHaveBeenCalled();
    expect(fetchCoinGecko).not.toHaveBeenCalled();
    expect(generateTweets).toHaveBeenCalledOnce();
  });

  it('Mode B: runs grounding (serper + coingecko) then generates', async () => {
    fetchSerper.mockResolvedValue({ query: 'q', organic: [], newsSnippet: null });
    fetchCoinGecko.mockResolvedValue({ symbol: null, priceUsd: null, change24hPct: null, marketCapUsd: null });
    const out = await runPreview({ mode: 1, eventDescription: 'BTC ETF', angle: 'bullish' });
    expect(fetchSerper).toHaveBeenCalledOnce();
    expect(fetchCoinGecko).toHaveBeenCalledOnce();
    expect(out.tweets).toHaveLength(2);
  });

  it('Mode B: soft-fails grounding and still generates', async () => {
    fetchSerper.mockRejectedValue(new Error('serper down'));
    fetchCoinGecko.mockRejectedValue(new Error('cg down'));
    const out = await runPreview({ mode: 1, eventDescription: 'BTC ETF', angle: 'bearish' });
    expect(generateTweets).toHaveBeenCalledOnce();
    expect(out.tweets).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run lib/pipeline/runPreview.test.ts`
Expected: FAIL — cannot resolve `./runPreview`.

- [ ] **Step 3: Write `lib/pipeline/runPreview.ts`**

```ts
// Settle-free draft generation for the free preview. Composes the pure
// fetch/generate helpers — it must NEVER import settleX402Call, touch
// AgentWallet, or write to Supabase. Returns the full draft; the caller slices
// the first tweet. Paying regenerates fresh via the unchanged paid pipeline.
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt, type Audience } from '@/lib/prompts/modeA';
import {
  buildModeBPrompt,
  summarizeSerper,
  summarizeMarket,
  type Angle,
} from '@/lib/prompts/modeB';
import { generateTweets } from './generateDraft';
import { fetchSerper } from './serperStep';
import { fetchCoinGecko } from './coingeckoStep';

export interface PreviewInput {
  mode: 0 | 1;
  topic?: string;
  audience?: Audience;
  eventDescription?: string;
  angle?: Angle;
}

export async function runPreview(input: PreviewInput): Promise<{ tweets: string[] }> {
  if (input.mode === 0) {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeAPrompt({ topic: input.topic ?? '', audience: input.audience ?? 'beginner' }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.7, maxTokens: 1200 }) };
  }

  // Mode B — grounding is soft: a failed Serper/CoinGecko still yields a draft.
  const event = input.eventDescription ?? '';
  let searchSummary: string | null = null;
  try {
    const s = await fetchSerper(event);
    searchSummary = summarizeSerper(s.organic, s.newsSnippet);
  } catch (e) {
    console.error('[runPreview] serper failed, continuing:', e instanceof Error ? e.message : e);
  }
  let marketSnippet: string | null = null;
  try {
    marketSnippet = summarizeMarket(await fetchCoinGecko(event));
  } catch (e) {
    console.error('[runPreview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: buildModeBPrompt({
        eventDescription: event,
        angle: input.angle ?? 'bullish',
        searchSummary,
        marketSnippet,
      }),
    },
  ];
  return { tweets: await generateTweets({ messages, temperature: 0.85, maxTokens: 1400 }) };
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm vitest run lib/pipeline/runPreview.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Add the no-settle invariant guard test** — append to `lib/pipeline/runPreview.test.ts`:

```ts
import { readFileSync } from 'node:fs';

describe('runPreview drain-safety invariant', () => {
  it('source never references settle / AgentWallet / supabase', () => {
    const src = readFileSync(new URL('./runPreview.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/settleX402Call/);
    expect(src).not.toMatch(/agentWallet|AgentWallet/);
    expect(src).not.toMatch(/supabase/i);
  });
});
```

Run: `pnpm vitest run lib/pipeline/runPreview.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline/runPreview.ts lib/pipeline/runPreview.test.ts
git commit -m "feat(preview): add settle-free runPreview composing pure pipeline helpers"
```

---

## Task 5: Rate-limit gate `checkPreviewAllowed` (per-wallet + global, fail-closed)

**Files:**
- Modify: `lib/rateLimit.ts`
- Test: `lib/rateLimit.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test** — append to `lib/rateLimit.test.ts` (it already mocks `@upstash/ratelimit` + `@upstash/redis` with hoisted `limitMock` and has a `load()` helper that `vi.resetModules()` + imports `./rateLimit`; reuse them):

```ts
describe('checkPreviewAllowed', () => {
  it('fails CLOSED (unavailable) when Upstash env is missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc')).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('allows when both per-wallet and global pass', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock.mockResolvedValue({ success: true, limit: 3, remaining: 2, reset: 0 });
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc')).toEqual({ allowed: true });
  });

  it('blocks with reason "rate" when the per-wallet limit is exhausted', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock.mockResolvedValueOnce({ success: false, limit: 3, remaining: 0, reset: 0 });
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc')).toEqual({ allowed: false, reason: 'rate' });
  });

  it('blocks with reason "global" when the daily cap is hit', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock
      .mockResolvedValueOnce({ success: true, limit: 3, remaining: 1, reset: 0 })
      .mockResolvedValueOnce({ success: false, limit: 500, remaining: 0, reset: 0 });
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc')).toEqual({ allowed: false, reason: 'global' });
  });

  it('fails CLOSED when the limiter throws', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock.mockRejectedValue(new Error('redis down'));
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc')).toEqual({ allowed: false, reason: 'unavailable' });
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run lib/rateLimit.test.ts`
Expected: FAIL — `checkPreviewAllowed is not a function`.

- [ ] **Step 3: Extend `lib/rateLimit.ts`**

Change the `LimiterName` type and `LIMITS` to add the two preview limiters, and add the daily-cap constant:

```ts
export type LimiterName = 'url-preview' | 'refund-request' | 'free-preview' | 'free-preview-global';
```

```ts
// Global daily cap protects the Serper free tier (env-tunable).
const PREVIEW_DAILY_CAP = Number(process.env.PREVIEW_DAILY_CAP) || 500;

const LIMITS: Record<LimiterName, { tokens: number; window: `${number} s` }> = {
  'url-preview': { tokens: 10, window: '60 s' },
  'refund-request': { tokens: 5, window: '60 s' },
  'free-preview': { tokens: 3, window: '600 s' },
  'free-preview-global': { tokens: PREVIEW_DAILY_CAP, window: '86400 s' },
};
```

Then add the gate function at the end of the file (after `getClientIp`):

```ts
export interface PreviewGate {
  allowed: boolean;
  reason?: 'rate' | 'global' | 'unavailable';
}

// Preview consumes shared third-party quota, so unlike checkRateLimit this
// fails CLOSED: if the limiter can't be reached we deny rather than allow.
// Per-wallet is checked first so one abuser hits their own ceiling before
// eating into the global daily budget.
export async function checkPreviewAllowed(walletAddress: string): Promise<PreviewGate> {
  const perWallet = getLimiter('free-preview');
  const global = getLimiter('free-preview-global');
  if (!perWallet || !global) return { allowed: false, reason: 'unavailable' };
  try {
    const w = await perWallet.limit(`wallet:${walletAddress.toLowerCase()}`);
    if (!w.success) return { allowed: false, reason: 'rate' };
    const g = await global.limit('global');
    if (!g.success) return { allowed: false, reason: 'global' };
    return { allowed: true };
  } catch (e) {
    console.error(
      '[rateLimit] preview gate error — failing closed:',
      e instanceof Error ? e.message : e,
    );
    return { allowed: false, reason: 'unavailable' };
  }
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm vitest run lib/rateLimit.test.ts`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Document the env var** — in `.env.example`, add after the `NEXT_PUBLIC_APP_URL` line:

```
# Free-preview global daily cap (protects Serper free tier). Default 500.
PREVIEW_DAILY_CAP=500
```

- [ ] **Step 6: Commit**

```bash
git add lib/rateLimit.ts lib/rateLimit.test.ts .env.example
git commit -m "feat(preview): add fail-closed per-wallet + global preview rate gate"
```

---

## Task 6: `POST /api/preview` endpoint

**Files:**
- Create: `app/api/preview/route.ts`
- Test: `app/api/preview/route.test.ts`

- [ ] **Step 1: Write the failing test** — create `app/api/preview/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPreviewAllowed = vi.fn();
const runPreview = vi.fn();

vi.mock('@/lib/rateLimit', () => ({ checkPreviewAllowed }));
vi.mock('@/lib/pipeline/runPreview', () => ({ runPreview }));

const { POST } = await import('./route');

function req(body: unknown): Request {
  return new Request('http://localhost/api/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkPreviewAllowed.mockResolvedValue({ allowed: true });
});

describe('POST /api/preview', () => {
  it('returns 200 { available: false } when the gate denies', async () => {
    checkPreviewAllowed.mockResolvedValue({ allowed: false, reason: 'unavailable' });
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('returns only firstTweet + totalTweets (never the full thread)', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ secret', '3/ secret'] });
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ firstTweet: '1/ hook', totalTweets: 3 });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('400 on missing walletAddress', async () => {
    const res = await POST(req({ mode: 0, topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(400);
  });

  it('502 when generation throws', async () => {
    runPreview.mockRejectedValue(new Error('groq down'));
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run app/api/preview/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write `app/api/preview/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { checkPreviewAllowed } from '@/lib/rateLimit';
import { runPreview, type PreviewInput } from '@/lib/pipeline/runPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;
const ANGLES = ['bullish', 'bearish', 'skeptical'] as const;
const PREVIEW_DEADLINE_MS = 30_000;

interface Body {
  mode?: number;
  walletAddress?: string;
  topic?: string;
  audience?: string;
  eventDescription?: string;
  angle?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body.walletAddress !== 'string' || body.walletAddress.length === 0) {
    return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
  }
  if (body.mode !== 0 && body.mode !== 1) {
    return NextResponse.json({ error: 'mode must be 0 or 1' }, { status: 400 });
  }

  let input: PreviewInput;
  if (body.mode === 0) {
    if (typeof body.topic !== 'string' || !body.topic.trim()) {
      return NextResponse.json({ error: 'topic required' }, { status: 400 });
    }
    const audience = AUDIENCES.includes(body.audience as never)
      ? (body.audience as PreviewInput['audience'])
      : 'beginner';
    input = { mode: 0, topic: body.topic, audience };
  } else {
    if (typeof body.eventDescription !== 'string' || !body.eventDescription.trim()) {
      return NextResponse.json({ error: 'eventDescription required' }, { status: 400 });
    }
    const angle = ANGLES.includes(body.angle as never)
      ? (body.angle as PreviewInput['angle'])
      : 'bullish';
    input = { mode: 1, eventDescription: body.eventDescription, angle };
  }

  // Fail-closed gate: deny → fall back to pay-first on the client.
  const gate = await checkPreviewAllowed(body.walletAddress);
  if (!gate.allowed) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  try {
    const { tweets } = await Promise.race([
      runPreview(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('preview timed out')), PREVIEW_DEADLINE_MS),
      ),
    ]);
    if (!tweets.length) {
      return NextResponse.json({ error: 'empty preview' }, { status: 502 });
    }
    return NextResponse.json({ firstTweet: tweets[0], totalTweets: tweets.length }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'preview failed' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm vitest run app/api/preview/route.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Verify build**

Run: `pnpm lint && pnpm build`
Expected: clean; the `/api/preview` route appears in the build output.

- [ ] **Step 6: Commit**

```bash
git add app/api/preview/route.ts app/api/preview/route.test.ts
git commit -m "feat(preview): add POST /api/preview (gated, settle-free, first-tweet only)"
```

---

## Task 7: Client preview fetcher `lib/previewClient.ts`

**Files:**
- Create: `lib/previewClient.ts`
- Test: `lib/previewClient.test.ts`

- [ ] **Step 1: Write the failing test** — create `lib/previewClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPreview } from './previewClient';

afterEach(() => vi.unstubAllGlobals());

const args = { mode: 0 as const, walletAddress: '0xabc', topic: 't', audience: 'beginner' as const };

describe('fetchPreview', () => {
  it('returns the preview on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ firstTweet: 'hi', totalTweets: 4 }) })));
    expect(await fetchPreview(args)).toEqual({ firstTweet: 'hi', totalTweets: 4 });
  });

  it('returns null when the server reports unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: false }) })));
    expect(await fetchPreview(args)).toBeNull();
  });

  it('returns null on a non-ok (e.g. 502) response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'x' }) })));
    expect(await fetchPreview(args)).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await fetchPreview(args)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run lib/previewClient.test.ts`
Expected: FAIL — cannot resolve `./previewClient`.

- [ ] **Step 3: Write `lib/previewClient.ts`**

```ts
// Client helper: ask the server for a free first-tweet preview. Returns null
// on ANY non-success (unavailable, error, network) so the caller can cleanly
// fall back to the pay-first flow — a failed preview must never block paying.
export interface PreviewArgs {
  mode: 0 | 1;
  walletAddress: string;
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  eventDescription?: string;
  angle?: 'bullish' | 'bearish' | 'skeptical';
}

export interface PreviewResult {
  firstTweet: string;
  totalTweets: number;
}

export async function fetchPreview(args: PreviewArgs): Promise<PreviewResult | null> {
  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PreviewResult> & { available?: boolean };
    if (data.available === false) return null;
    if (typeof data.firstTweet !== 'string' || typeof data.totalTweets !== 'number') return null;
    return { firstTweet: data.firstTweet, totalTweets: data.totalTweets };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm vitest run lib/previewClient.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add lib/previewClient.ts lib/previewClient.test.ts
git commit -m "feat(preview): add client fetchPreview with null-on-failure fallback"
```

---

## Task 8: `PreviewLocked` component

**Files:**
- Create: `components/PreviewLocked.tsx`

- [ ] **Step 1: Write the component** (presentational only — no data fetching)

```tsx
'use client';

import { Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  firstTweet: string;
  lockedCount: number;
  onUnlock: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

export function PreviewLocked({ firstTweet, lockedCount, onUnlock, onRegenerate, regenerating }: Props) {
  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="heading-sub text-[10px]">Preview · First tweet free</p>
        <p className="text-sm italic text-muted-foreground leading-snug">
          Here is your opening tweet. Unlock the full thread for $0.05.
        </p>
      </div>

      <Card className="p-4">
        <p className="whitespace-pre-wrap text-sm">{firstTweet}</p>
      </Card>

      <div className="relative flex flex-col gap-2" aria-hidden>
        {Array.from({ length: Math.min(Math.max(lockedCount, 0), 4) }).map((_, i) => (
          <Card key={i} className="p-4 select-none">
            <div className="h-3 w-3/4 rounded bg-[hsl(var(--ink-faded)/0.25)] blur-[1.5px]" />
            <div className="mt-2 h-3 w-1/2 rounded bg-[hsl(var(--ink-faded)/0.2)] blur-[1.5px]" />
          </Card>
        ))}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--ink-faded))] bg-background/80 px-3 py-1 text-xs text-muted-foreground">
            <Lock size={12} aria-hidden />
            {lockedCount} more {lockedCount === 1 ? 'tweet' : 'tweets'} locked
          </span>
        </div>
      </div>

      <Button onClick={onUnlock}>Unlock full thread · $0.05</Button>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        className="self-center inline-flex items-center gap-1.5 heading-sub text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
      >
        <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} aria-hidden />
        {regenerating ? 'Regenerating…' : 'Regenerate preview'}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm lint && pnpm build`
Expected: clean (component compiles; not yet rendered anywhere).

- [ ] **Step 3: Commit**

```bash
git add components/PreviewLocked.tsx
git commit -m "feat(preview): add PreviewLocked screen component"
```

---

## Task 9: Wire the preview-locked screen into `HomeClient`

**Files:**
- Modify: `app/HomeClient.tsx`

- [ ] **Step 1: Add imports** — after the `PostShareScreen` dynamic import block (around line 67) add a dynamic import for the new component, and add the fetcher import near the other `@/lib` imports:

```ts
const PreviewLocked = dynamic(
  () => import('@/components/PreviewLocked').then((m) => m.PreviewLocked),
  { ssr: false },
);
```

```ts
import { fetchPreview } from '@/lib/previewClient';
```

- [ ] **Step 2: Extend the `Screen` union and add state** — change the `Screen` type to include the new screen:

```ts
type Screen = 'mode' | 'educational' | 'hot-take' | 'preview-locked' | 'generating' | 'preview' | 'post-share';
```

Then, next to the existing `const [draftTweets, setDraftTweets] = useState<string[] | null>(null);` line, add:

```ts
  const [previewData, setPreviewData] = useState<{ firstTweet: string; totalTweets: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
```

- [ ] **Step 3: Add `beginFlow` and `unlock` helpers** — add these just above the `return (` of the component (after the `capHit` const):

```ts
  // Try a free preview first; if it's unavailable for any reason, fall straight
  // through to the existing pay-first flow. A failed preview never blocks paying.
  const beginFlow = useCallback(
    async (payload: EducationalSubmitPayload | HotTakeSubmitPayload, mode: 0 | 1) => {
      if (!address) return;
      setPreviewLoading(true);
      const preview = await fetchPreview(
        mode === 0
          ? {
              mode: 0,
              walletAddress: address,
              topic: (payload as EducationalSubmitPayload).topic,
              audience: (payload as EducationalSubmitPayload).audience,
            }
          : {
              mode: 1,
              walletAddress: address,
              eventDescription: (payload as HotTakeSubmitPayload).eventDescription,
              angle: (payload as HotTakeSubmitPayload).angle,
            },
      );
      setPreviewLoading(false);
      if (preview) {
        setPreviewData(preview);
        setScreen('preview-locked');
      } else {
        setScreen('generating');
        await pay(payload.token, mode);
      }
    },
    [address, pay],
  );

  const unlock = useCallback(async () => {
    const token = submitted?.token ?? hotTake?.token;
    if (!token) return;
    const mode: 0 | 1 = submitted ? 0 : 1;
    setScreen('generating');
    await pay(token, mode);
  }, [submitted, hotTake, pay]);
```

- [ ] **Step 4: Route the input submits through `beginFlow`** — replace the Educational `onSubmit`:

```tsx
              onSubmit={async (p) => {
                setSubmitted(p);
                setHotTake(null);
                setScreen('generating');
                await pay(p.token, 0);
              }}
```

with:

```tsx
              onSubmit={async (p) => {
                setSubmitted(p);
                setHotTake(null);
                await beginFlow(p, 0);
              }}
```

and replace the Hot Take `onSubmit`:

```tsx
              onSubmit={async (p) => {
                setHotTake(p);
                setSubmitted(null);
                setScreen('generating');
                await pay(p.token, 1);
              }}
```

with:

```tsx
              onSubmit={async (p) => {
                setHotTake(p);
                setSubmitted(null);
                await beginFlow(p, 1);
              }}
```

- [ ] **Step 5: Render the `preview-locked` screen** — directly before the `{screen === 'generating' && (` block (around line 379) insert:

```tsx
          {screen === 'preview-locked' && previewData && (
            <PreviewLocked
              firstTweet={previewData.firstTweet}
              lockedCount={Math.max(previewData.totalTweets - 1, 0)}
              onUnlock={unlock}
              onRegenerate={() => {
                const payload = submitted ?? hotTake;
                if (payload) void beginFlow(payload, submitted ? 0 : 1);
              }}
              regenerating={previewLoading}
            />
          )}
```

- [ ] **Step 6: Reset preview state on disconnect** — in the disconnect-cleanup `useEffect` (the one that calls `setScreen('mode')` and `setDraftTweets(null)`), add these two lines alongside the other resets:

```ts
      setPreviewData(null);
      setPreviewLoading(false);
```

- [ ] **Step 7: Verify build + lint + manual flow**

Run: `pnpm lint && pnpm build`
Expected: clean. Manual: submitting an input shows `preview-locked` (tweet 1 + blurred locked cards + "Unlock $0.05"); "Unlock" runs the normal pay→generating→preview flow; "Regenerate preview" refetches. If `/api/preview` is unavailable (e.g. Upstash unset → fail-closed), the flow goes straight to pay-first as before.

- [ ] **Step 8: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(preview): wire preview-locked screen with pay-first fallback"
```

---

## Final verification

- [ ] **Full logic suite**

Run: `pnpm test:lib`
Expected: all pass, including the new `runPreview`, `previewClient`, `route`, `coingeckoStep`, and `checkPreviewAllowed` tests, and the unchanged `generateDraft` / `serperStep` tests.

- [ ] **Build + lint**

Run: `pnpm lint && pnpm build`
Expected: clean; `/api/preview` present in the route list.

---

## Self-review notes (spec coverage)

- **Core principle / drain-safety** → Task 4 (`runPreview` composes settle-free helpers) + its source-guard test; Task 1–3 extractions keep the paid path's settle intact. `/api/preview` (Task 6) imports neither `settleX402Call` nor Supabase.
- **`POST /api/preview` (input, validation, slice, errors pinned 200/502)** → Task 6.
- **Rate limiting per-wallet + global, fail-closed** → Task 5 (`checkPreviewAllowed`) + `PREVIEW_DAILY_CAP` env.
- **Both modes; Mode B grounded** → Task 4 (Mode B runs `fetchSerper` + `fetchCoinGecko`, soft-fail).
- **Frontend `preview-locked` + graceful fallback** → Tasks 7 (fetcher returns null→fallback), 8 (component), 9 (wiring; unavailable/error → pay-first).
- **Testing requirements (invariant, slice, rate-limit, fallback, mode coverage)** → Tasks 4, 5, 6, 7.
- Paid `/api/generate/stream` flow is untouched (Tasks 1–3 are behaviour-preserving refactors verified by the existing tests).
