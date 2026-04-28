# ShipPost Week 3 — Refine + Mode B (Hot Take)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Mode B (Hot Take) end-to-end with Serper search + CoinGecko market data + Groq fact-check as additional x402 steps, add a thread History screen and a public Analytics page, harden error/refund paths, polish mobile UX, and drive a second user-testing round to ≥30 total mainnet threads and ≥3 repeat users.

**Architecture:** Reuse the Week 2 pipeline abstraction (`lib/pipeline/*`). Add three new steps (`serperStep`, `coingeckoStep`, `factCheckStep`). Add `lib/pipeline/runModeB.ts` that composes them into Research → Generate → Fact-check → Thumbnail. The SSE endpoint dispatches on the new `mode` field. Refunds are handled by a Pausable-protected `refundLastThread` admin script that uses the Reserve pool share (10%). History + Analytics pages read directly from Supabase via an edge-runtime API so the main app bundle stays small.

**Tech Stack (additions on top of Week 2):** `open-graph-scraper` for URL parsing, `swr` for history-page data fetching with caching, `@next/bundle-analyzer` for bundle audit.

**Spec reference:** `/Users/vanhuy/shippost/docs/superpowers/specs/2026-04-24-shippost-minipay-design.md`
**Prior plans:**
- `/Users/vanhuy/shippost/docs/superpowers/plans/2026-04-24-shippost-week1-foundation.md`
- `/Users/vanhuy/shippost/docs/superpowers/plans/2026-04-24-shippost-week2-mode-a-mainnet.md`

**Week 3 Gate (end of plan):**
- Both modes (Educational + Hot Take) work end-to-end on Celo mainnet
- ≥30 total mainnet threads in Supabase
- ≥3 repeat users (distinct wallets with ≥2 threads)
- History screen lists a signed-in user's threads with cost, token, tx links, and image
- Public analytics page (no wallet required) shows live totals, unique wallets, x402 count, last-10 threads
- At least one refund tx demonstrated (simulated or real) from the Reserve pool
- Bundle size audit produces ≤200KB gzipped for the app-entry chunk on `/`
- All 8 error states from the spec (section 5, UX response table) have a user-visible UX path

---

## File Structure

New / modified files in Week 3:

```
shippost/
├── package.json                              # new deps
├── next.config.js                            # bundle analyzer wrapper
│
├── lib/
│   ├── orchestrator.ts                       # MODIFIED — add `refundThread()`
│   ├── urlParser.ts                          # NEW — detect URL type + OG fetch
│   ├── pipeline/
│   │   ├── serperStep.ts                     # NEW
│   │   ├── coingeckoStep.ts                  # NEW
│   │   ├── factCheckStep.ts                  # NEW
│   │   ├── runModeB.ts                       # NEW
│   │   └── types.ts                          # MODIFIED — add 'serper' | 'coingecko' | 'factCheck'
│   └── prompts/
│       ├── modeB.ts                          # NEW
│       └── factCheck.ts                      # NEW
│
├── app/
│   ├── api/
│   │   ├── x402/
│   │   │   ├── serper/route.ts               # NEW
│   │   │   ├── coingecko/route.ts            # NEW
│   │   │   └── fact-check/route.ts           # NEW
│   │   ├── generate/
│   │   │   └── stream/route.ts               # MODIFIED — branch on mode
│   │   ├── refund/
│   │   │   └── route.ts                      # NEW
│   │   ├── url-preview/
│   │   │   └── route.ts                      # NEW
│   │   └── public/
│   │       ├── analytics/route.ts            # NEW
│   │       └── threads/route.ts              # NEW
│   ├── history/
│   │   └── page.tsx                          # NEW
│   ├── stats/
│   │   └── page.tsx                          # NEW
│   └── page.tsx                              # MODIFIED — hot-take flow enabled
│
├── components/
│   ├── HotTakeInput.tsx                      # NEW
│   ├── ModePicker.tsx                        # MODIFIED — Hot Take enabled
│   ├── UrlPreviewCard.tsx                    # NEW
│   ├── HistoryList.tsx                       # NEW
│   ├── ErrorSurface.tsx                      # NEW — maps error code → UX
│   └── GeneratingStatus.tsx                  # MODIFIED — render all 5 step ids
│
├── scripts/
│   └── refund.ts                             # NEW — admin refund helper
│
└── docs/
    ├── bug-bash.md                           # append Week 3 round
    └── error-states.md                       # NEW — mapping spec → component
```

---

## Prerequisite: Before Task 1

**You must have completed Week 2 (tag `week2-complete` exists) and have:**

- A Serper.dev account with the free 2,500-query key (https://serper.dev)
- CoinGecko free Demo API key (https://www.coingecko.com/en/api/pricing) — optional; falls back to public endpoint
- 10 creator testers recruited for round-2 feedback (ideally 3-4 are crypto Twitter/newsletter writers)
- Mainnet AgentWallet balance ≥3 cUSD (refills if low from Week 2 testing)
- Reserve wallet (the 10% pool) funded by Week 2 payments — query Supabase to confirm non-zero

---

## Task 1: Install Week 3 dependencies

**Files:**
- Modify: `/Users/vanhuy/shippost/package.json`
- Modify: `/Users/vanhuy/shippost/.env.example`

- [ ] **Step 1: Add deps**

```bash
pnpm add open-graph-scraper swr
pnpm add -D @next/bundle-analyzer
```

- [ ] **Step 2: Add env placeholders**

Append to `.env.example`:

```
SERPER_API_KEY=
COINGECKO_API_KEY=
```

Populate `.env` locally with real keys.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore: install Week 3 deps"
```

---

## Task 2: Serper step (x402 search)

**Files:**
- Create: `/Users/vanhuy/shippost/lib/pipeline/serperStep.ts`
- Create: `/Users/vanhuy/shippost/app/api/x402/serper/route.ts`
- Modify: `/Users/vanhuy/shippost/lib/pipeline/types.ts`

- [ ] **Step 1: Extend StepId + StepMeta**

In `lib/pipeline/types.ts`, replace the `StepId` line and add:

```typescript
export type StepId = 'groq' | 'flux' | 'serper' | 'coingecko' | 'factCheck';
```

- [ ] **Step 2: Create Serper step**

Create `lib/pipeline/serperStep.ts`:

```typescript
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import type { PipelineContext, PipelineEvent } from './types';

const SERPER_SINK = '0x00000000000000000000000000000000000053E2' as const;
const SERPER_COST_CUSD = parseEther('0.001');
const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface SerperResult {
  query: string;
  organic: Array<{ title: string; snippet: string; link: string; date?: string }>;
  newsSnippet: string | null;
}

export async function runSerperStep(
  ctx: PipelineContext & { query: string },
  emit: (e: PipelineEvent) => void,
): Promise<SerperResult> {
  emit({ type: 'step_started', step: 'serper' });
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing');

  let organic: SerperResult['organic'] = [];
  let newsSnippet: string | null = null;

  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: ctx.query, num: 5, gl: 'us', hl: 'en' }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const json = (await res.json()) as {
      organic?: Array<{ title: string; snippet: string; link: string; date?: string }>;
      answerBox?: { snippet?: string };
      knowledgeGraph?: { description?: string };
    };
    organic = json.organic ?? [];
    newsSnippet = json.answerBox?.snippet ?? json.knowledgeGraph?.description ?? null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'serper failed';
    emit({ type: 'step_failed', step: 'serper', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'serper', output: { organic, newsSnippet } });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: SERPER_SINK,
      tokenSymbol: 'cUSD',
      amount: SERPER_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'serper',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e) {
    console.error('serper x402 settle failed', e);
  }

  return { query: ctx.query, organic, newsSnippet };
}
```

- [ ] **Step 3: Add debug endpoint**

Create `app/api/x402/serper/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { runSerperStep } from '@/lib/pipeline/serperStep';
import { getContracts } from '@/lib/contracts';

export async function POST(req: Request) {
  const body = (await req.json()) as { threadId: string; query: string; chainId: number };
  if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 });
  try {
    const contracts = getContracts(body.chainId);
    const events: unknown[] = [];
    const r = await runSerperStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: body.query,
        audience: 'beginner',
        length: 5,
        agentWallet: contracts.AgentWallet,
        query: body.query,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ ...r, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 4: Smoke test**

```bash
curl -X POST http://localhost:3000/api/x402/serper \
  -H "Content-Type: application/json" \
  -d '{"threadId":"1","query":"EigenLayer EIGEN token launch date","chainId":42220}' | jq
```

Expected: `organic` array with ≥3 results; `events` includes settled x402 tx.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/serperStep.ts app/api/x402/serper/route.ts lib/pipeline/types.ts
git commit -m "feat: Serper x402 search step"
```

---

## Task 3: CoinGecko step (market data — no x402 settle, free API)

**Files:**
- Create: `/Users/vanhuy/shippost/lib/pipeline/coingeckoStep.ts`
- Create: `/Users/vanhuy/shippost/app/api/x402/coingecko/route.ts`

- [ ] **Step 1: Create step (no settle — CoinGecko is free and not revenue-bearing)**

Create `lib/pipeline/coingeckoStep.ts`:

```typescript
import type { PipelineContext, PipelineEvent } from './types';

const CG_BASE = 'https://api.coingecko.com/api/v3';

export interface CoinGeckoResult {
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
}

function extractSymbol(topic: string): string | null {
  // Very naive: look for $TICKER or known project tokens
  const cashTag = topic.match(/\$([A-Z]{2,6})\b/);
  if (cashTag) return cashTag[1].toLowerCase();
  return null;
}

async function resolveCoinId(symbol: string): Promise<string | null> {
  const res = await fetch(`${CG_BASE}/search?query=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { coins?: Array<{ id: string; symbol: string }> };
  const hit = j.coins?.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
  return hit?.id ?? null;
}

export async function runCoinGeckoStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<CoinGeckoResult> {
  emit({ type: 'step_started', step: 'coingecko' });

  const sym = extractSymbol(ctx.topic);
  if (!sym) {
    const empty: CoinGeckoResult = { symbol: null, priceUsd: null, change24hPct: null, marketCapUsd: null };
    emit({ type: 'step_output', step: 'coingecko', output: empty });
    emit({ type: 'step_settled', step: 'coingecko', txHash: '0x0' as `0x${string}`, costAmount: '0.000', tokenSymbol: 'cUSD' });
    return empty;
  }

  try {
    const id = await resolveCoinId(sym);
    if (!id) {
      const empty: CoinGeckoResult = { symbol: sym, priceUsd: null, change24hPct: null, marketCapUsd: null };
      emit({ type: 'step_output', step: 'coingecko', output: empty });
      emit({ type: 'step_settled', step: 'coingecko', txHash: '0x0' as `0x${string}`, costAmount: '0.000', tokenSymbol: 'cUSD' });
      return empty;
    }
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const j = (await res.json()) as Record<string, { usd: number; usd_24h_change?: number; usd_market_cap?: number }>;
    const entry = j[id];
    const result: CoinGeckoResult = {
      symbol: sym.toUpperCase(),
      priceUsd: entry?.usd ?? null,
      change24hPct: entry?.usd_24h_change ?? null,
      marketCapUsd: entry?.usd_market_cap ?? null,
    };
    emit({ type: 'step_output', step: 'coingecko', output: result });
    emit({ type: 'step_settled', step: 'coingecko', txHash: '0x0' as `0x${string}`, costAmount: '0.000', tokenSymbol: 'cUSD' });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'coingecko failed';
    emit({ type: 'step_failed', step: 'coingecko', error: msg });
    throw e;
  }
}
```

> **Why no on-chain settle:** CoinGecko is free + non-monetized. The Progress Theatre still shows a step row (spec screen 3 intent preserved), but the cost is `$0.000` and no tx is emitted. This keeps the UX consistent without forging fake on-chain activity.

- [ ] **Step 2: Add debug endpoint**

Create `app/api/x402/coingecko/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { runCoinGeckoStep } from '@/lib/pipeline/coingeckoStep';
import { getContracts } from '@/lib/contracts';

export async function POST(req: Request) {
  const body = (await req.json()) as { threadId: string; topic: string; chainId: number };
  try {
    const contracts = getContracts(body.chainId);
    const events: unknown[] = [];
    const r = await runCoinGeckoStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: body.topic,
        audience: 'beginner',
        length: 5,
        agentWallet: contracts.AgentWallet,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ ...r, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 3: Smoke test**

```bash
curl -X POST http://localhost:3000/api/x402/coingecko \
  -H "Content-Type: application/json" \
  -d '{"threadId":"1","topic":"Why $CELO deserves more attention","chainId":42220}' | jq
```

Expected: `{ "symbol": "CELO", "priceUsd": <number>, … }`.

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/coingeckoStep.ts app/api/x402/coingecko/route.ts
git commit -m "feat: CoinGecko market data step"
```

---

## Task 4: Fact-check step (Groq with different prompt)

**Files:**
- Create: `/Users/vanhuy/shippost/lib/prompts/factCheck.ts`
- Create: `/Users/vanhuy/shippost/lib/pipeline/factCheckStep.ts`
- Create: `/Users/vanhuy/shippost/app/api/x402/fact-check/route.ts`

- [ ] **Step 1: Create fact-check prompt**

Create `lib/prompts/factCheck.ts`:

```typescript
export const FACT_CHECK_SYSTEM = `You are a rigorous fact-checker for crypto/dev X threads.
Reject any tweet that:
- states a number (price, TVL, market cap, date) that cannot be verified against the provided context
- claims a project does X without evidence in the context
- makes a prediction stated as fact

For each tweet you accept as-is, output it unchanged.
For each tweet that fails, rewrite it into a safer version that removes unverifiable claims while preserving the point.
Output the same number of tweets, in the same order, numbered with "1/", "2/", etc. Separated by blank lines. No commentary.`;

export function buildFactCheckUserPrompt(params: {
  tweets: string[];
  searchSummary: string | null;
  marketData: string | null;
}): string {
  return [
    'Context (verified sources):',
    params.searchSummary ?? '(no search data)',
    '',
    'Market data:',
    params.marketData ?? '(no market data)',
    '',
    'Draft thread:',
    params.tweets.join('\n\n'),
    '',
    'Return the revised thread only.',
  ].join('\n');
}
```

- [ ] **Step 2: Create step**

Create `lib/pipeline/factCheckStep.ts`:

```typescript
import Groq from 'groq-sdk';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import { parseThread } from '@/lib/threadParser';
import { FACT_CHECK_SYSTEM, buildFactCheckUserPrompt } from '@/lib/prompts/factCheck';
import type { PipelineContext, PipelineEvent } from './types';

const FC_SINK = '0x00000000000000000000000000000000000FAC7C' as const;
const FC_COST_CUSD = parseEther('0.001');

interface Input {
  tweets: string[];
  searchSummary: string | null;
  marketData: string | null;
}

export async function runFactCheckStep(
  ctx: PipelineContext,
  input: Input,
  emit: (e: PipelineEvent) => void,
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'factCheck' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  let raw: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: FACT_CHECK_SYSTEM },
        { role: 'user', content: buildFactCheckUserPrompt(input) },
      ],
      temperature: 0.1,
      max_tokens: 1400,
    });
    raw = resp.choices[0]?.message?.content ?? '';
    if (!raw.trim()) throw new Error('fact-check returned empty');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fact-check failed';
    emit({ type: 'step_failed', step: 'factCheck', error: msg });
    throw e;
  }

  const tweets = parseThread(raw);
  emit({ type: 'step_output', step: 'factCheck', output: tweets });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: FC_SINK,
      tokenSymbol: 'cUSD',
      amount: FC_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'factCheck',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e) {
    console.error('factCheck x402 settle failed', e);
  }

  return { tweets };
}
```

- [ ] **Step 3: Add debug endpoint**

Create `app/api/x402/fact-check/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { runFactCheckStep } from '@/lib/pipeline/factCheckStep';
import { getContracts } from '@/lib/contracts';

export async function POST(req: Request) {
  const body = (await req.json()) as {
    threadId: string;
    chainId: number;
    tweets: string[];
    searchSummary: string | null;
    marketData: string | null;
  };
  try {
    const contracts = getContracts(body.chainId);
    const events: unknown[] = [];
    const r = await runFactCheckStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: '',
        audience: 'beginner',
        length: 5,
        agentWallet: contracts.AgentWallet,
      },
      {
        tweets: body.tweets,
        searchSummary: body.searchSummary,
        marketData: body.marketData,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ ...r, events });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/prompts/factCheck.ts lib/pipeline/factCheckStep.ts app/api/x402/fact-check/route.ts
git commit -m "feat: Groq fact-check x402 step"
```

---

## Task 5: Mode B prompts (4 angles)

**Files:**
- Create: `/Users/vanhuy/shippost/lib/prompts/modeB.ts`

- [ ] **Step 1: Create angle prompt builder**

Create `lib/prompts/modeB.ts`:

```typescript
export type Angle = 'bullish' | 'bearish' | 'skeptical' | 'contrarian';

interface ModeBInput {
  eventDescription: string;   // URL-or-description
  angle: Angle;
  length: 5 | 8 | 12;
  searchSummary: string | null;
  marketSnippet: string | null;
}

const ANGLE_BRIEF: Record<Angle, string> = {
  bullish:
    'You are bullish. Lead with the biggest positive implication that most people are missing. Back it with a specific data point from the context. Acknowledge the strongest bear argument in one line, then dismiss it with reasoning.',
  bearish:
    'You are bearish. Lead with the most important risk or flaw that is being downplayed. Back it with a specific data point. Acknowledge what bulls get right in one line, then explain why it does not change the picture.',
  skeptical:
    'You are skeptical. Do not pick a side. Ask the three questions a professional investor would ask before getting excited. End with what evidence would change your mind.',
  contrarian:
    'You are contrarian. The consensus view is in the event description. State the consensus clearly in tweet 1, then argue the opposite in the rest, grounded in data from the context.',
};

const STRUCTURE = `Structure:
- Tweet 1: a one-line hook framing the event (no jargon).
- Tweet 2: a specific, verifiable fact or number from the context.
- Middle tweets: your perspective, concrete, one idea per tweet.
- Second-last tweet: a prediction — with a caveat ("if X then Y").
- Last tweet: a question or CTA to the reader.`;

export function buildModeBPrompt(input: ModeBInput): string {
  return [
    `Event: ${input.eventDescription.trim()}`,
    `Angle: ${input.angle}. ${ANGLE_BRIEF[input.angle]}`,
    `Thread length: exactly ${input.length} tweets.`,
    input.searchSummary ? `\nSearch context:\n${input.searchSummary}` : '',
    input.marketSnippet ? `\nMarket data:\n${input.marketSnippet}` : '',
    '',
    STRUCTURE,
    'Output only the numbered tweets separated by blank lines. Nothing else.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function summarizeSerper(
  organic: Array<{ title: string; snippet: string; link: string; date?: string }>,
  newsSnippet: string | null,
): string {
  const lines: string[] = [];
  if (newsSnippet) lines.push(`Answer: ${newsSnippet}`);
  for (const r of organic.slice(0, 5)) {
    const when = r.date ? ` (${r.date})` : '';
    lines.push(`- ${r.title}${when}: ${r.snippet}`);
  }
  return lines.join('\n');
}

export function summarizeMarket(cg: {
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
}): string | null {
  if (!cg.symbol || cg.priceUsd === null) return null;
  const mc = cg.marketCapUsd ? `mcap ~$${(cg.marketCapUsd / 1e6).toFixed(1)}M` : '';
  const ch = cg.change24hPct !== null ? `${cg.change24hPct.toFixed(2)}% 24h` : '';
  return `${cg.symbol} @ $${cg.priceUsd.toPrecision(4)} ${ch} ${mc}`.trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/prompts/modeB.ts
git commit -m "feat: Mode B angle prompt builder"
```

---

## Task 6: URL parser + preview endpoint

**Files:**
- Create: `/Users/vanhuy/shippost/lib/urlParser.ts`
- Create: `/Users/vanhuy/shippost/app/api/url-preview/route.ts`
- Create: `/Users/vanhuy/shippost/components/UrlPreviewCard.tsx`

- [ ] **Step 1: Create URL type detector**

Create `lib/urlParser.ts`:

```typescript
export type UrlKind = 'tweet' | 'news' | 'unknown';

export interface ParsedUrl {
  url: string;
  kind: UrlKind;
  tweetId?: string;
  host?: string;
}

const TWEET_RE = /^https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/i;

export function parseUrl(input: string): ParsedUrl | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const m = trimmed.match(TWEET_RE);
  if (m) return { url: trimmed, kind: 'tweet', tweetId: m[1], host: url.host };

  return { url: trimmed, kind: 'news', host: url.host };
}

export function extractLikelyQuery(tweetOrArticleText: string, fallbackTopic: string): string {
  // Strip URLs, mentions, and hashtags — keep noun-heavy core.
  const cleaned = tweetOrArticleText
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@\w+/g, '')
    .replace(/#\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallbackTopic;
}
```

- [ ] **Step 2: Create preview endpoint using open-graph-scraper**

Create `app/api/url-preview/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';
import { parseUrl } from '@/lib/urlParser';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json()) as { url: string };
  const parsed = parseUrl(body.url);
  if (!parsed) return NextResponse.json({ error: 'invalid url' }, { status: 400 });

  try {
    const { result } = await ogs({ url: parsed.url, timeout: 8000 });
    return NextResponse.json({
      kind: parsed.kind,
      host: parsed.host,
      title: result.ogTitle ?? result.twitterTitle ?? '',
      description: result.ogDescription ?? result.twitterDescription ?? '',
      image: result.ogImage?.[0]?.url ?? result.twitterImage?.[0]?.url ?? null,
      tweetId: parsed.tweetId ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'og fetch failed', kind: parsed.kind },
      { status: 200 }, // soft-fail: still allow the user to proceed with the raw URL
    );
  }
}
```

- [ ] **Step 3: Create UrlPreviewCard component**

Create `components/UrlPreviewCard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

interface Preview {
  kind: 'tweet' | 'news' | 'unknown';
  host?: string;
  title?: string;
  description?: string;
  image?: string | null;
  tweetId?: string | null;
  error?: string;
}

interface Props {
  url: string;
  onResolved: (preview: Preview) => void;
}

export function UrlPreviewCard({ url, onResolved }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/url-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json())
      .then((j: Preview) => {
        if (cancelled) return;
        setPreview(j);
        onResolved(j);
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'unknown', error: 'fetch failed' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, onResolved]);

  if (loading) return <p className="text-xs text-muted-foreground">Loading preview…</p>;
  if (!preview || preview.error)
    return <p className="text-xs text-muted-foreground">Could not preview URL — thread will use the URL text only.</p>;

  return (
    <Card className="p-3 flex gap-3 items-start">
      {preview.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.image} alt="" className="w-16 h-16 rounded object-cover" />
      )}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{preview.host}</p>
        <p className="text-sm font-medium truncate">{preview.title || '(no title)'}</p>
        {preview.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{preview.description}</p>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Smoke test**

```bash
curl -X POST http://localhost:3000/api/url-preview \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/celo/status/1234567890"}' | jq
```

Expected: JSON with `kind: "tweet"`, some title/description.

- [ ] **Step 5: Commit**

```bash
git add lib/urlParser.ts app/api/url-preview/route.ts components/UrlPreviewCard.tsx
git commit -m "feat: URL parser + preview card"
```

---

## Task 7: HotTakeInput component

**Files:**
- Create: `/Users/vanhuy/shippost/components/HotTakeInput.tsx`

- [ ] **Step 1: Create HotTakeInput**

Create `components/HotTakeInput.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TokenSelector } from './TokenSelector';
import { UrlPreviewCard } from './UrlPreviewCard';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { parseUrl } from '@/lib/urlParser';
import { formatUnits } from 'viem';

export type Angle = 'bullish' | 'bearish' | 'skeptical' | 'contrarian';

export interface HotTakeSubmitPayload {
  eventUrl: string | null;
  eventDescription: string;
  angle: Angle;
  length: 5 | 8 | 12;
  token: TokenBalance;
}

interface Props {
  onSubmit: (p: HotTakeSubmitPayload) => void;
  disabled?: boolean;
}

export function HotTakeInput({ onSubmit, disabled }: Props) {
  const { balances, isLoading } = useBalances();
  const [input, setInput] = useState('');
  const [angle, setAngle] = useState<Angle>('skeptical');
  const [length, setLength] = useState<5 | 8 | 12>(8);

  const parsed = useMemo(() => parseUrl(input), [input]);
  const isUrl = parsed !== null;

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(defaultToken);
  if (!selectedToken && defaultToken) setSelectedToken(defaultToken);

  const canSubmit = input.trim().length > 10 && selectedToken !== null && !disabled;

  const amountStr = selectedToken
    ? Number(formatUnits(computeTokenAmount(selectedToken), selectedToken.decimals)).toFixed(2)
    : '';

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">🔥 Hot Take</h2>

      <div className="flex flex-col gap-1">
        <Label htmlFor="event">Event URL or description</Label>
        <Textarea
          id="event"
          rows={3}
          placeholder="Paste a tweet URL, an article link, or describe the event in 1-2 sentences."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {isUrl && <UrlPreviewCard url={parsed!.url} onResolved={() => {}} />}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Angle</Label>
        <RadioGroup
          value={angle}
          onValueChange={(v) => setAngle(v as Angle)}
          className="grid grid-cols-2 gap-2"
        >
          {(['bullish', 'bearish', 'skeptical', 'contrarian'] as Angle[]).map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={a} />
              <span className="capitalize">{a}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Length</Label>
        <RadioGroup
          value={String(length)}
          onValueChange={(v) => setLength(Number(v) as 5 | 8 | 12)}
          className="flex gap-4"
        >
          {[5, 8, 12].map((n) => (
            <label key={n} className="flex items-center gap-1.5">
              <RadioGroupItem value={String(n)} />
              <span className="text-sm">{n} tweets</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading balances…</p>
      ) : (
        <TokenSelector balances={balances} selected={selectedToken} onSelect={setSelectedToken} />
      )}

      <Button
        disabled={!canSubmit}
        onClick={() => {
          if (canSubmit && selectedToken) {
            onSubmit({
              eventUrl: isUrl ? input.trim() : null,
              eventDescription: input,
              angle,
              length,
              token: selectedToken,
            });
          }
        }}
      >
        {selectedToken ? `Generate for ${amountStr} ${selectedToken.symbol} →` : 'Select token'}
      </Button>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/HotTakeInput.tsx
git commit -m "feat: HotTakeInput form"
```

---

## Task 8: Mode B pipeline runner

**Files:**
- Create: `/Users/vanhuy/shippost/lib/pipeline/runModeB.ts`

- [ ] **Step 1: Create runModeB**

Create `lib/pipeline/runModeB.ts`:

```typescript
import Groq from 'groq-sdk';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import { parseThread } from '@/lib/threadParser';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeBPrompt, summarizeSerper, summarizeMarket, type Angle } from '@/lib/prompts/modeB';
import { runSerperStep } from './serperStep';
import { runCoinGeckoStep } from './coingeckoStep';
import { runFactCheckStep } from './factCheckStep';
import { runFluxStep } from './fluxStep';
import type { PipelineContext, PipelineEvent } from './types';

const GROQ_SINK = '0x000000000000000000000000000000000000dead' as const;
const GROQ_COST_CUSD = parseEther('0.001');

export interface ModeBOutput {
  tweets: string[];
  imageUrl: string | null;
  searchSummary: string | null;
  marketSnippet: string | null;
}

export async function runModeB(
  ctx: PipelineContext & { angle: Angle; eventDescription: string },
  emit: (e: PipelineEvent) => void,
): Promise<ModeBOutput> {
  // 1. Search
  let searchSummary: string | null = null;
  try {
    const s = await runSerperStep({ ...ctx, query: ctx.eventDescription }, emit);
    searchSummary = summarizeSerper(s.organic, s.newsSnippet);
  } catch (e) {
    console.error('serper failed, continuing with no search context', e);
  }

  // 2. Market data (soft-fail)
  let marketSnippet: string | null = null;
  try {
    const cg = await runCoinGeckoStep(ctx, emit);
    marketSnippet = summarizeMarket(cg);
  } catch (e) {
    console.error('coingecko failed', e);
  }

  // 3. Draft with Groq (hard-fail)
  emit({ type: 'step_started', step: 'groq' });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  const prompt = buildModeBPrompt({
    eventDescription: ctx.eventDescription,
    angle: ctx.angle,
    length: ctx.length,
    searchSummary,
    marketSnippet,
  });

  let draftRaw: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.85,
      max_tokens: 1400,
    });
    draftRaw = resp.choices[0]?.message?.content ?? '';
    if (!draftRaw.trim()) throw new Error('Groq returned empty draft');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'draft failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  let draftTweets = parseThread(draftRaw);
  emit({ type: 'step_output', step: 'groq', output: draftTweets });

  try {
    const hash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: GROQ_SINK,
      tokenSymbol: 'cUSD',
      amount: GROQ_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({ type: 'step_settled', step: 'groq', txHash: hash, costAmount: '0.001', tokenSymbol: 'cUSD' });
  } catch (e) {
    console.error('groq x402 settle failed', e);
  }

  // 4. Fact-check pass (soft-fail — fall back to draft if fact-check errors)
  let finalTweets = draftTweets;
  try {
    const fc = await runFactCheckStep(ctx, { tweets: draftTweets, searchSummary, marketData: marketSnippet }, emit);
    finalTweets = fc.tweets;
  } catch (e) {
    console.error('fact-check failed, using draft', e);
  }

  // 5. Thumbnail (soft-fail)
  let imageUrl: string | null = null;
  try {
    const fx = await runFluxStep({ ...ctx, topic: ctx.eventDescription }, emit);
    imageUrl = fx.imageUrl;
  } catch (e) {
    console.error('flux failed', e);
  }

  // Compute total cost (0.001 serper + 0.001 groq + 0.001 fc + 0.003 flux = 0.006, minus any soft-failures)
  const total =
    0.001 +
    0.001 +
    (finalTweets !== draftTweets ? 0.001 : 0) +
    (imageUrl ? 0.003 : 0);
  emit({ type: 'done', totalCostUsd: total.toFixed(3) });

  return { tweets: finalTweets, imageUrl, searchSummary, marketSnippet };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/pipeline/runModeB.ts
git commit -m "feat: Mode B pipeline runner"
```

---

## Task 9: Wire Mode B into SSE endpoint

**Files:**
- Modify: `/Users/vanhuy/shippost/app/api/generate/stream/route.ts`

- [ ] **Step 1: Branch on `mode` in the handler**

Replace `app/api/generate/stream/route.ts`:

```typescript
import { runModeA } from '@/lib/pipeline/runModeA';
import { runModeB } from '@/lib/pipeline/runModeB';
import { getContracts } from '@/lib/contracts';
import { getSupabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import type { PipelineEvent } from '@/lib/pipeline/types';
import type { Angle } from '@/lib/prompts/modeB';

interface StreamRequest {
  threadId: string;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
  mode: 0 | 1;
  // Mode A
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  // Mode B
  eventDescription?: string;
  angle?: Angle;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sseLine(e: PipelineEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as StreamRequest;

  const rl = await checkRateLimit(body.walletAddress);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limit', message: 'Max 10 threads per wallet per 24h' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (body.mode === 0 && !body.topic?.trim()) {
    return new Response('topic required', { status: 400 });
  }
  if (body.mode === 1 && !body.eventDescription?.trim()) {
    return new Response('eventDescription required', { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const txByStep: Partial<Record<'groq' | 'flux' | 'serper' | 'factCheck', string>> = {};

      const emit = (e: PipelineEvent) => {
        if (e.type === 'step_settled' && e.step !== 'coingecko') {
          txByStep[e.step] = e.txHash;
        }
        controller.enqueue(encoder.encode(sseLine(e)));
      };

      let supabase;
      try {
        supabase = getSupabaseServer();
      } catch {
        supabase = null;
      }

      if (supabase) {
        await supabase.from('threads').insert({
          chain_id: body.chainId,
          onchain_thread_id: body.threadId,
          wallet_address: body.walletAddress.toLowerCase(),
          mode: body.mode,
          token_symbol: body.tokenSymbol,
          token_address: body.tokenAddress.toLowerCase(),
          amount_paid_raw: body.amountPaidRaw,
          pay_tx_hash: body.payTxHash.toLowerCase(),
          topic: body.topic ?? body.eventDescription ?? null,
          audience: body.audience ?? null,
          length: body.length,
        });
      }

      try {
        const contracts = getContracts(body.chainId);
        const ctx = {
          chainId: body.chainId,
          threadId: BigInt(body.threadId),
          topic: body.topic ?? body.eventDescription ?? '',
          audience: body.audience ?? 'beginner',
          length: body.length,
          agentWallet: contracts.AgentWallet,
        };

        let tweets: string[];
        let imageUrl: string | null;
        let totalCost: string;

        if (body.mode === 0) {
          const out = await runModeA(ctx, emit);
          tweets = out.tweets;
          imageUrl = out.imageUrl;
          totalCost = imageUrl ? '0.004' : '0.001';
        } else {
          const out = await runModeB(
            { ...ctx, angle: body.angle ?? 'skeptical', eventDescription: body.eventDescription ?? '' },
            emit,
          );
          tweets = out.tweets;
          imageUrl = out.imageUrl;
          // Reported via 'done' event; duplicate here for DB write
          totalCost = (
            0.001 + 0.001 + (txByStep.factCheck ? 0.001 : 0) + (imageUrl ? 0.003 : 0)
          ).toFixed(3);
        }

        if (supabase) {
          await supabase
            .from('threads')
            .update({
              tweets,
              image_url: imageUrl,
              total_cost_usd: totalCost,
              groq_tx_hash: txByStep.groq ?? null,
              flux_tx_hash: txByStep.flux ?? null,
              serper_tx_hash: txByStep.serper ?? null,
              factcheck_tx_hash: txByStep.factCheck ?? null,
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', body.threadId);
        }

        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets, imageUrl },
        });
      } catch (e: unknown) {
        emit({ type: 'fatal', error: e instanceof Error ? e.message : 'pipeline failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: Extend Supabase schema with new tx columns**

Create `supabase/migrations/0002_mode_b_columns.sql`:

```sql
alter table public.threads
  add column if not exists serper_tx_hash text,
  add column if not exists factcheck_tx_hash text;
```

Apply it in Supabase SQL editor.

- [ ] **Step 3: Commit**

```bash
git add app/api/generate/stream/route.ts supabase/migrations/0002_mode_b_columns.sql
git commit -m "feat: SSE endpoint dispatches Mode A vs Mode B"
```

---

## Task 10: Enable Mode B in ModePicker + page.tsx

**Files:**
- Modify: `/Users/vanhuy/shippost/components/ModePicker.tsx`
- Modify: `/Users/vanhuy/shippost/app/page.tsx`
- Modify: `/Users/vanhuy/shippost/hooks/useThreadGeneration.ts`
- Modify: `/Users/vanhuy/shippost/lib/usePayForThread.ts`

- [ ] **Step 1: Enable Hot Take card**

In `components/ModePicker.tsx`, remove the `opacity-60` class and the "(Week 3)" label from the Hot Take card, and drop the disabled messaging:

```tsx
<Card
  onClick={() => onSelect('hot-take')}
  className="p-4 cursor-pointer hover:border-primary transition-colors"
>
  <div className="flex items-start gap-3">
    <span className="text-2xl">🔥</span>
    <div>
      <h3 className="font-semibold">Hot Take</h3>
      <p className="text-sm text-muted-foreground">
        React to news or a tweet with data.
      </p>
    </div>
  </div>
</Card>
```

- [ ] **Step 2: Extend usePayForThread to accept mode param**

Inspect `lib/usePayForThread.ts` — the `pay()` function already accepts `(token, mode)` per Week 1. Confirm it passes `mode` to `payForThread` contract call. If not, update it.

- [ ] **Step 3: Extend useThreadGeneration StartParams**

In `hooks/useThreadGeneration.ts`, extend `StartParams`:

```typescript
interface StartParams {
  threadId: bigint;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
  mode: 0 | 1;
  length: 5 | 8 | 12;
  // Mode A
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  // Mode B
  eventDescription?: string;
  angle?: 'bullish' | 'bearish' | 'skeptical' | 'contrarian';
}
```

Include all fields in the fetch body (they are optional on the server when irrelevant to the chosen mode).

- [ ] **Step 4: Add Hot Take branch to page.tsx**

In `app/page.tsx`, add:

```tsx
import { HotTakeInput, type HotTakeSubmitPayload } from '@/components/HotTakeInput';
// …
type Screen = 'mode' | 'educational' | 'hot-take' | 'generating' | 'preview' | 'post-share';

// Inside Home:
const [hotTakeSubmission, setHotTakeSubmission] = useState<HotTakeSubmitPayload | null>(null);

async function handleHotTakeSubmit(p: HotTakeSubmitPayload) {
  setHotTakeSubmission(p);
  setSubmission(null); // ensure mode A state cleared
  setScreen('generating');
  await pay(p.token, 1);
}

// In the ModePicker:
<ModePicker
  onSelect={(m) => {
    if (m === 'educational') setScreen('educational');
    if (m === 'hot-take') setScreen('hot-take');
  }}
/>

{screen === 'hot-take' && (
  <HotTakeInput
    onSubmit={handleHotTakeSubmit}
    disabled={status === 'approving' || status === 'paying'}
  />
)}
```

Then update the `useEffect` that starts generation to pass the right params:

```tsx
useEffect(() => {
  if (status !== 'success' || !threadId || gen.isDone || gen.fatal || gen.tweets) return;

  if (submission) {
    startGen({
      threadId,
      chainId,
      walletAddress: account.address ?? '0x0',
      tokenSymbol: submission.token.symbol,
      tokenAddress: submission.token.address,
      amountPaidRaw: computeTokenAmount(submission.token).toString(),
      payTxHash: txHash ?? '0x0',
      mode: 0,
      topic: submission.topic,
      audience: submission.audience,
      length: submission.length,
    });
  } else if (hotTakeSubmission) {
    startGen({
      threadId,
      chainId,
      walletAddress: account.address ?? '0x0',
      tokenSymbol: hotTakeSubmission.token.symbol,
      tokenAddress: hotTakeSubmission.token.address,
      amountPaidRaw: computeTokenAmount(hotTakeSubmission.token).toString(),
      payTxHash: txHash ?? '0x0',
      mode: 1,
      length: hotTakeSubmission.length,
      eventDescription: hotTakeSubmission.eventDescription,
      angle: hotTakeSubmission.angle,
    });
  }
}, [status, threadId, submission, hotTakeSubmission, gen.isDone, gen.fatal, gen.tweets, chainId, account.address, txHash, startGen]);
```

And reset in `handleWriteAnother`:

```tsx
setHotTakeSubmission(null);
```

- [ ] **Step 5: Smoke test end-to-end Hot Take on Alfajores**

```bash
pnpm dev
```

1. Pick Hot Take → paste a recent crypto tweet URL or type "Vitalik posted a new EIP about encrypted mempools".
2. Pick "bullish", 5 tweets.
3. Pay 0.05 cUSD.
4. Progress theatre should show Serper ✓ → CoinGecko ✓ → Groq draft ✓ → Fact-check ✓ → Flux ✓.
5. Preview page renders revised tweets + thumbnail.

- [ ] **Step 6: Commit**

```bash
git add components/ModePicker.tsx app/page.tsx hooks/useThreadGeneration.ts lib/usePayForThread.ts
git commit -m "feat: Hot Take wired into pay → SSE pipeline"
```

---

## Task 11: Update GeneratingStatus to render all 5 step rows

**Files:**
- Modify: `/Users/vanhuy/shippost/components/GeneratingStatus.tsx`

- [ ] **Step 1: Render step rows based on which ones were seen**

In `GeneratingStatus.tsx`, extend `STEP_META` and `ORDER`:

```tsx
const STEP_META: Record<StepId, { label: string; icon: string; budget: string }> = {
  serper: { label: 'Searching news', icon: '🔍', budget: '$0.001' },
  coingecko: { label: 'Fetching market data', icon: '📊', budget: '$0.000' },
  groq: { label: 'Writing thread', icon: '✍️', budget: '$0.001' },
  factCheck: { label: 'Fact-checking', icon: '✅', budget: '$0.001' },
  flux: { label: 'Creating thumbnail', icon: '🎨', budget: '$0.003' },
};

const ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck', 'flux'];
```

Change the `show` check:

```tsx
const show = step.status !== 'pending'; // only render steps that started
```

Remove the `id === 'groq'` fallback — if a mode never ran a step, its row stays hidden.

Add Serper + Fact-check explorer links at the bottom alongside Groq and Flux:

```tsx
{gen.steps.serper.txHash && (
  <a
    className="text-primary underline"
    href={`${chainExplorerBase}/tx/${gen.steps.serper.txHash}`}
    target="_blank"
    rel="noopener noreferrer"
  >
    View Serper x402 settlement →
  </a>
)}
{gen.steps.factCheck.txHash && (
  <a
    className="text-primary underline"
    href={`${chainExplorerBase}/tx/${gen.steps.factCheck.txHash}`}
    target="_blank"
    rel="noopener noreferrer"
  >
    View fact-check x402 settlement →
  </a>
)}
```

- [ ] **Step 2: Ensure hook initial state covers all 5 step ids**

In `hooks/useThreadGeneration.ts`, change `initial`:

```typescript
const initial: ThreadGenerationState = {
  steps: {
    serper: { status: 'pending' },
    coingecko: { status: 'pending' },
    groq: { status: 'pending' },
    factCheck: { status: 'pending' },
    flux: { status: 'pending' },
  },
  tweets: null,
  imageUrl: null,
  fatal: null,
  isDone: false,
  totalCostUsd: null,
};
```

- [ ] **Step 3: Commit**

```bash
git add components/GeneratingStatus.tsx hooks/useThreadGeneration.ts
git commit -m "feat: Progress theatre renders all 5 pipeline steps"
```

---

## Task 12: Refund path — orchestrator helper + admin script

**Files:**
- Modify: `/Users/vanhuy/shippost/lib/orchestrator.ts`
- Create: `/Users/vanhuy/shippost/scripts/refund.ts`
- Create: `/Users/vanhuy/shippost/app/api/refund/route.ts`
- Modify: `/Users/vanhuy/shippost/supabase/migrations/0003_refunds.sql`

- [ ] **Step 1: Add refund column to Supabase**

Create `supabase/migrations/0003_refunds.sql`:

```sql
alter table public.threads
  add column if not exists refund_tx_hash text,
  add column if not exists refund_reason text;
```

Apply it.

- [ ] **Step 2: Implement a simple refund using cUSD transfer from deployer wallet**

> **MVP approach:** The spec says refund comes "from reserve". In Week 1 deploy, `reserve` and `treasury` are both the deployer EOA. We implement refund as a direct cUSD `transfer` from the deployer (reserve) wallet — tagged in Supabase with `refund_tx_hash` and `refund_reason`. This avoids a contract change for Week 3 and still demonstrates the flow.

Add to `lib/orchestrator.ts`:

```typescript
import { createWalletClient, createPublicClient, http, parseUnits, erc20Abi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getTokens } from './tokens';
import { getChain } from './chains-server'; // new helper below

export async function refundThread(params: {
  chainId: number;
  to: Address;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  amountHuman: string; // e.g. "0.035"
  reason: string;
}): Promise<`0x${string}`> {
  const pk = process.env.ORCHESTRATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error('ORCHESTRATOR_PRIVATE_KEY missing');

  const chain = getChain(params.chainId);
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const publicClient = createPublicClient({ chain, transport: http() });

  const token = getTokens(params.chainId)[params.tokenSymbol];
  const amount = parseUnits(params.amountHuman, token.decimals);

  const hash = await wallet.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [params.to, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
```

Create the missing `lib/chains-server.ts`:

```typescript
import { celo, celoAlfajores } from 'viem/chains';

export function getChain(chainId: number) {
  if (chainId === celo.id) return celo;
  if (chainId === celoAlfajores.id) return celoAlfajores;
  throw new Error(`Unsupported chain ${chainId}`);
}
```

(Keep `lib/chains.ts` client-safe with only `getExplorerBase` / `isSupportedChain`.)

- [ ] **Step 3: Admin refund API (gated by REFUND_ADMIN_KEY)**

Create `app/api/refund/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { refundThread } from '@/lib/orchestrator';
import { getSupabaseServer } from '@/lib/supabase';
import type { Address } from 'viem';

interface RefundRequest {
  chainId: number;
  onchainThreadId: string;
  to: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  amountHuman: string;
  reason: string;
}

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const admin = req.headers.get('x-admin-key');
  if (!admin || admin !== process.env.REFUND_ADMIN_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json()) as RefundRequest;

  try {
    const hash = await refundThread({
      chainId: body.chainId,
      to: body.to as Address,
      tokenSymbol: body.tokenSymbol,
      amountHuman: body.amountHuman,
      reason: body.reason,
    });

    const supabase = getSupabaseServer();
    await supabase
      .from('threads')
      .update({ refund_tx_hash: hash, refund_reason: body.reason })
      .eq('chain_id', body.chainId)
      .eq('onchain_thread_id', body.onchainThreadId);

    return NextResponse.json({ txHash: hash });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: CLI admin script**

Create `scripts/refund.ts`:

```typescript
import 'dotenv/config';
import { refundThread } from '../lib/orchestrator';

async function main() {
  const [chainIdStr, to, tokenSymbol, amount, reason] = process.argv.slice(2);
  if (!chainIdStr || !to || !tokenSymbol || !amount) {
    console.log('usage: tsx scripts/refund.ts <chainId> <to> <cUSD|USDT|USDC> <amount> [reason]');
    process.exit(1);
  }
  const hash = await refundThread({
    chainId: Number(chainIdStr),
    to: to as `0x${string}`,
    tokenSymbol: tokenSymbol as 'cUSD',
    amountHuman: amount,
    reason: reason ?? 'manual',
  });
  console.log('refund tx:', hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Install `tsx` if not already:

```bash
pnpm add -D tsx
```

Add script to `package.json`:

```json
"refund": "tsx scripts/refund.ts"
```

- [ ] **Step 5: Add `REFUND_ADMIN_KEY` env placeholder**

Append to `.env.example`:

```
REFUND_ADMIN_KEY=
```

Generate a random value and add to `.env` + Vercel:

```bash
openssl rand -hex 24
```

- [ ] **Step 6: Demonstrate one refund on Alfajores**

On Alfajores, pick any `threadId` you've generated (Week 1 or 2), refund 0.035 cUSD back to your own wallet:

```bash
pnpm refund 44787 0x<your-wallet> cUSD 0.035 'week3 refund path smoke test'
```

Confirm tx appears on https://alfajores.celoscan.io and the `refund_tx_hash` appears in the Supabase row for that thread.

- [ ] **Step 7: Commit**

```bash
git add lib/orchestrator.ts lib/chains-server.ts scripts/refund.ts app/api/refund/route.ts supabase/migrations/0003_refunds.sql .env.example package.json pnpm-lock.yaml
git commit -m "feat: admin refund flow with Supabase audit trail"
```

---

## Task 13: ErrorSurface — map spec error states to UX

**Files:**
- Create: `/Users/vanhuy/shippost/docs/error-states.md`
- Create: `/Users/vanhuy/shippost/components/ErrorSurface.tsx`
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Document the spec mapping**

Create `docs/error-states.md`:

```markdown
# Error-state mapping (spec §5 → code)

| Spec error | Detection | UX response | Component |
|---|---|---|---|
| Insufficient balance | `computeTokenAmount > balance` in EducationalInput / HotTakeInput | Inline message + link to `https://minipay.to/topup` | ErrorSurface kind='insufficient' |
| Token not approved | `usePayForThread` sees no allowance | Auto-trigger approve tx (Week 1 already does) | usePayForThread |
| Approve rejected | `approve` tx throws | "Cancelled. Try again?" with retry button | ErrorSurface kind='approve-rejected' |
| Pay tx failed | `payForThread` reverts or tx fails | "Payment failed — funds not moved" (no refund needed) | ErrorSurface kind='pay-failed' |
| x402 fails mid-pipeline | `step_failed` emitted, but `tweets` exist (partial output) | "Partial output saved. We'll refund the failed step within 24h." | ErrorSurface kind='partial' |
| All x402 fail | `fatal` event with no tweets | "Generation failed — full refund in progress." + request refund CTA | ErrorSurface kind='full-fail' |
| Agent bucket empty | Orchestrator catches `DailySpendCapExceeded` revert | Pause app UI + "We ran out of budget today, back tomorrow" | ErrorSurface kind='cap-hit' (global banner) |
| Generation >60s | Client-side timeout in useThreadGeneration | Inline "Still working… cancel? (50% refund)" | ErrorSurface kind='slow' |
```

- [ ] **Step 2: Build ErrorSurface component**

Create `components/ErrorSurface.tsx`:

```tsx
'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export type ErrorKind =
  | 'insufficient'
  | 'approve-rejected'
  | 'pay-failed'
  | 'partial'
  | 'full-fail'
  | 'cap-hit'
  | 'slow';

interface Props {
  kind: ErrorKind;
  onRetry?: () => void;
  onRefundRequest?: () => void;
}

const COPY: Record<ErrorKind, { title: string; body: string; primary?: string }> = {
  insufficient: {
    title: 'Not enough balance',
    body: 'You need 0.05 of the selected token. Top up in MiniPay or pick another token above.',
    primary: 'Open MiniPay top-up',
  },
  'approve-rejected': {
    title: 'Approval cancelled',
    body: 'You rejected the approve step. No funds moved.',
    primary: 'Try again',
  },
  'pay-failed': {
    title: 'Payment failed',
    body: 'The pay transaction reverted. No funds moved. You can retry safely.',
    primary: 'Try again',
  },
  partial: {
    title: 'Partial output — partial refund queued',
    body: 'One of the AI steps failed. You get the working part of the thread. We will refund the failed step within 24h.',
    primary: 'Request refund now',
  },
  'full-fail': {
    title: 'Generation failed',
    body: 'All steps failed. A full refund will be sent automatically within 24h.',
    primary: 'Request refund now',
  },
  'cap-hit': {
    title: 'Agent paused — back tomorrow',
    body: 'Today\'s agent budget is spent. The app pauses new generations until midnight UTC.',
  },
  slow: {
    title: 'This is taking longer than usual',
    body: 'The pipeline is still running. You can cancel for a 50% refund.',
    primary: 'Cancel + refund 50%',
  },
};

export function ErrorSurface({ kind, onRetry, onRefundRequest }: Props) {
  const c = COPY[kind];
  const primary =
    kind === 'insufficient'
      ? () => window.open('https://minipay.to', '_blank')
      : kind === 'slow' || kind === 'partial' || kind === 'full-fail'
      ? onRefundRequest
      : onRetry;

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3 border-destructive/40">
      <h3 className="text-sm font-semibold">{c.title}</h3>
      <p className="text-sm text-muted-foreground">{c.body}</p>
      {c.primary && primary && (
        <Button variant="outline" onClick={primary}>
          {c.primary}
        </Button>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Wire ErrorSurface into page.tsx**

In `app/page.tsx`, render an ErrorSurface when:
- `gen.fatal` and no tweets → `full-fail`
- `gen.fatal` and tweets → `partial`
- `error` from `usePayForThread` matches "approve" (case-insensitive) → `approve-rejected`
- `error` from `usePayForThread` includes "revert" → `pay-failed`
- Balance check fails → `insufficient` (add pre-flight in EducationalInput/HotTakeInput)

Example block at the bottom of the authenticated branch:

```tsx
{gen.fatal && !gen.tweets && (
  <ErrorSurface
    kind="full-fail"
    onRefundRequest={() => alert('Refund request sent. Check Celoscan within 24h.')}
  />
)}
{gen.fatal && gen.tweets && (
  <ErrorSurface
    kind="partial"
    onRefundRequest={() => alert('Partial refund requested.')}
  />
)}
{error && /approve/i.test(error) && (
  <ErrorSurface kind="approve-rejected" onRetry={resetPay} />
)}
{error && /revert|reject/i.test(error) && !/approve/i.test(error) && (
  <ErrorSurface kind="pay-failed" onRetry={resetPay} />
)}
```

> **Note:** MVP's refund CTA invokes `alert()` — wiring a real call to `/api/refund` requires an admin key and is driven by the operator through Supabase monitoring. Week 4 (or post-MVP) can wire a proper dispute flow.

- [ ] **Step 4: Add client timeout for slow generations**

In `hooks/useThreadGeneration.ts`, inside `start()` after the fetch kick-off, add a watchdog:

```typescript
const slowTimer = setTimeout(() => {
  setState((s) => (s.isDone ? s : { ...s, fatal: 'slow', isDone: false }));
}, 60_000);
// …and in the reader loop's "done" branch, clearTimeout(slowTimer).
```

> Note: a `fatal` value of the string `'slow'` is overloaded — treat it as a sentinel rendered by `ErrorSurface kind='slow'` in page.tsx when `fatal === 'slow' && !isDone`.

- [ ] **Step 5: Commit**

```bash
git add docs/error-states.md components/ErrorSurface.tsx app/page.tsx hooks/useThreadGeneration.ts
git commit -m "feat: ErrorSurface covers all 8 spec error states"
```

---

## Task 14: Public analytics + threads API

**Files:**
- Create: `/Users/vanhuy/shippost/app/api/public/analytics/route.ts`
- Create: `/Users/vanhuy/shippost/app/api/public/threads/route.ts`

- [ ] **Step 1: Create analytics summary endpoint**

Create `app/api/public/analytics/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 30;

export async function GET() {
  try {
    const supabase = getSupabaseServer();

    const { count: threads } = await supabase
      .from('threads')
      .select('*', { count: 'exact', head: true })
      .eq('chain_id', 42220);

    const { data: uniqueWallets } = await supabase
      .from('threads')
      .select('wallet_address')
      .eq('chain_id', 42220);

    const wallets = new Set((uniqueWallets ?? []).map((r) => r.wallet_address));

    const { data: x402 } = await supabase
      .from('threads')
      .select('groq_tx_hash,flux_tx_hash,serper_tx_hash,factcheck_tx_hash')
      .eq('chain_id', 42220);

    const x402Count = (x402 ?? []).reduce(
      (acc, r) =>
        acc +
        (r.groq_tx_hash ? 1 : 0) +
        (r.flux_tx_hash ? 1 : 0) +
        (r.serper_tx_hash ? 1 : 0) +
        (r.factcheck_tx_hash ? 1 : 0),
      0,
    );

    // repeat users = wallets with count > 1
    const walletCounts = new Map<string, number>();
    for (const r of uniqueWallets ?? []) {
      walletCounts.set(r.wallet_address, (walletCounts.get(r.wallet_address) ?? 0) + 1);
    }
    const repeatUsers = Array.from(walletCounts.values()).filter((n) => n > 1).length;

    // $volume: threads * $0.05 (since every thread is a fixed price)
    const volumeUsd = (threads ?? 0) * 0.05;

    return NextResponse.json({
      threads: threads ?? 0,
      uniqueWallets: wallets.size,
      volumeUsd: volumeUsd.toFixed(2),
      x402Count,
      repeatUsers,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Create threads listing endpoint**

Create `app/api/public/threads/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get('wallet')?.toLowerCase();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '10'), 50);

  try {
    const supabase = getSupabaseServer();
    let query = supabase
      .from('threads')
      .select(
        'chain_id,onchain_thread_id,wallet_address,mode,token_symbol,pay_tx_hash,topic,image_url,total_cost_usd,tweets,created_at',
      )
      .eq('chain_id', 42220)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (wallet) query = query.eq('wallet_address', wallet);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ threads: data ?? [] });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Smoke test**

```bash
curl http://localhost:3000/api/public/analytics | jq
curl http://localhost:3000/api/public/threads?limit=3 | jq
```

Expected: non-zero counts, array of 3 most recent mainnet threads.

- [ ] **Step 4: Commit**

```bash
git add app/api/public/analytics/route.ts app/api/public/threads/route.ts
git commit -m "feat: public analytics + threads API"
```

---

## Task 15: Public `/stats` page

**Files:**
- Create: `/Users/vanhuy/shippost/app/stats/page.tsx`

- [ ] **Step 1: Create stats page (read-only, no wallet)**

Create `app/stats/page.tsx`:

```tsx
'use client';

import useSWR from 'swr';
import { Card } from '@/components/ui/card';

interface Stats {
  threads: number;
  uniqueWallets: number;
  volumeUsd: string;
  x402Count: number;
  repeatUsers: number;
}

interface Thread {
  chain_id: number;
  onchain_thread_id: string;
  wallet_address: string;
  mode: number;
  token_symbol: string;
  pay_tx_hash: string;
  topic: string;
  total_cost_usd: string | null;
  image_url: string | null;
  created_at: string;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json());

export default function StatsPage() {
  const { data: stats } = useSWR<Stats>('/api/public/analytics', fetcher, { refreshInterval: 30000 });
  const { data: threadsData } = useSWR<{ threads: Thread[] }>(
    '/api/public/threads?limit=10',
    fetcher,
    { refreshInterval: 30000 },
  );

  const threads = threadsData?.threads ?? [];

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <h1 className="text-3xl font-bold text-primary">ShipPost — live stats</h1>
      <p className="text-xs text-muted-foreground">
        Pulled from Supabase every 30s. All transactions on Celo mainnet (chainId 42220).
      </p>

      {stats && (
        <Card className="w-full max-w-md p-4 grid grid-cols-2 gap-3 text-sm">
          <Metric label="Threads" value={String(stats.threads)} />
          <Metric label="Unique wallets" value={String(stats.uniqueWallets)} />
          <Metric label="Volume" value={`$${stats.volumeUsd}`} />
          <Metric label="x402 payments" value={String(stats.x402Count)} />
          <Metric label="Repeat users" value={String(stats.repeatUsers)} />
        </Card>
      )}

      <section className="w-full max-w-md flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Last 10 threads</h2>
        {threads.map((t) => (
          <Card key={`${t.chain_id}-${t.onchain_thread_id}`} className="p-3 flex flex-col gap-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{new Date(t.created_at).toLocaleString()}</span>
              <span>
                {t.mode === 0 ? '🎓' : '🔥'} {t.token_symbol}
              </span>
            </div>
            <p className="text-sm line-clamp-2">{t.topic}</p>
            <a
              className="text-xs text-primary underline"
              href={`https://celoscan.io/tx/${t.pay_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Pay tx →
            </a>
          </Card>
        ))}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Add link on main page**

At the bottom of `app/page.tsx`'s `<main>`, append:

```tsx
<a href="/stats" className="text-xs text-muted-foreground underline">
  📊 Public stats →
</a>
```

- [ ] **Step 3: Commit**

```bash
git add app/stats/page.tsx app/page.tsx
git commit -m "feat: /stats public analytics page"
```

---

## Task 16: `/history` screen (personal)

**Files:**
- Create: `/Users/vanhuy/shippost/app/history/page.tsx`
- Create: `/Users/vanhuy/shippost/components/HistoryList.tsx`

- [ ] **Step 1: Create HistoryList component**

Create `components/HistoryList.tsx`:

```tsx
'use client';

import useSWR from 'swr';
import { Card } from '@/components/ui/card';

interface Thread {
  chain_id: number;
  onchain_thread_id: string;
  mode: number;
  token_symbol: string;
  pay_tx_hash: string;
  topic: string;
  total_cost_usd: string | null;
  image_url: string | null;
  tweets: string[] | null;
  created_at: string;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface Props {
  walletAddress: string;
  explorerBase: string;
}

export function HistoryList({ walletAddress, explorerBase }: Props) {
  const { data, isLoading } = useSWR<{ threads: Thread[] }>(
    `/api/public/threads?wallet=${walletAddress.toLowerCase()}&limit=50`,
    fetcher,
  );

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const threads = data?.threads ?? [];
  if (threads.length === 0)
    return <p className="text-sm text-muted-foreground">No threads yet. Write your first one ↗</p>;

  return (
    <div className="w-full max-w-md flex flex-col gap-2">
      {threads.map((t) => (
        <Card key={`${t.chain_id}-${t.onchain_thread_id}`} className="p-3 flex flex-col gap-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{new Date(t.created_at).toLocaleString()}</span>
            <span>{t.mode === 0 ? '🎓 Educational' : '🔥 Hot Take'}</span>
          </div>
          <p className="text-sm font-medium line-clamp-1">{t.topic}</p>
          <div className="flex justify-between text-xs">
            <span className="font-mono">
              Paid 0.05 {t.token_symbol} · agent spent ${t.total_cost_usd ?? '—'}
            </span>
            <a
              className="text-primary underline"
              href={`${explorerBase}/tx/${t.pay_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              tx →
            </a>
          </div>
          {t.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.image_url} alt="" className="rounded w-full mt-1" />
          )}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create /history page**

Create `app/history/page.tsx`:

```tsx
'use client';

import { useAccount, useChainId } from 'wagmi';
import { HistoryList } from '@/components/HistoryList';
import { getExplorerBase } from '@/lib/chains';
import Link from 'next/link';

export default function HistoryPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  return (
    <main className="min-h-screen flex flex-col items-center gap-4 p-6 pt-8">
      <h1 className="text-2xl font-bold text-primary">My threads</h1>
      <Link href="/" className="text-xs underline text-muted-foreground">
        ← back to composer
      </Link>
      {!isConnected || !address ? (
        <p className="text-sm text-muted-foreground">Connect wallet to see your history.</p>
      ) : (
        <HistoryList walletAddress={address} explorerBase={getExplorerBase(chainId)} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Link from main page**

In `app/page.tsx`, add alongside the `/stats` link:

```tsx
<a href="/history" className="text-xs text-muted-foreground underline">
  🧵 My threads →
</a>
```

- [ ] **Step 4: Commit**

```bash
git add app/history/page.tsx components/HistoryList.tsx app/page.tsx
git commit -m "feat: /history personal thread list"
```

---

## Task 17: Bundle size audit + code splitting

**Files:**
- Modify: `/Users/vanhuy/shippost/next.config.js`
- Modify: `/Users/vanhuy/shippost/package.json`
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Enable bundle analyzer**

Edit `next.config.js`:

```javascript
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer({
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'https', hostname: '*.fal.ai' },
    ],
  },
});
```

Add to `package.json`:

```json
"analyze": "ANALYZE=true next build"
```

- [ ] **Step 2: Run audit**

```bash
pnpm analyze
```

Open the generated `.next/analyze/client.html` (auto-opens). Record the size of `/` entry chunk.

- [ ] **Step 3: Lazy-load heavy components**

In `app/page.tsx`, change the imports of screens that only render mid-flow to dynamic:

```tsx
import dynamic from 'next/dynamic';

const GeneratingStatus = dynamic(
  () => import('@/components/GeneratingStatus').then((m) => m.GeneratingStatus),
  { ssr: false },
);
const ThreadPreview = dynamic(
  () => import('@/components/ThreadPreview').then((m) => m.ThreadPreview),
  { ssr: false },
);
const ThumbnailCard = dynamic(
  () => import('@/components/ThumbnailCard').then((m) => m.ThumbnailCard),
  { ssr: false },
);
const ShareToX = dynamic(() => import('@/components/ShareToX').then((m) => m.ShareToX), {
  ssr: false,
});
const PostShareScreen = dynamic(
  () => import('@/components/PostShareScreen').then((m) => m.PostShareScreen),
  { ssr: false },
);
const HotTakeInput = dynamic(
  () => import('@/components/HotTakeInput').then((m) => m.HotTakeInput),
  { ssr: false },
);
const EducationalInput = dynamic(
  () => import('@/components/EducationalInput').then((m) => m.EducationalInput),
  { ssr: false },
);
```

(Drop the top-level `import { ... } from ...` lines for these components in favor of the dynamic versions.)

- [ ] **Step 4: Re-run audit**

```bash
pnpm analyze
```

Target: the `/` entry ≤ 200KB gzipped (as spec demands). Record before/after in `docs/bug-bash.md` under `## Bundle audit`.

- [ ] **Step 5: Commit**

```bash
git add next.config.js app/page.tsx package.json pnpm-lock.yaml
git commit -m "perf: lazy-load mid-flow components, target 200KB"
```

---

## Task 18: Mobile UX polish pass

**Files:**
- Modify: existing components flagged in `docs/bug-bash.md`

- [ ] **Step 1: Re-read `docs/bug-bash.md` P0 + P1 items**

Triage remaining polish items. Group by component file so each commit is scoped.

- [ ] **Step 2: Common items to verify on real MiniPay**

Go through this checklist on an Android phone in MiniPay:

- Tap targets ≥ 44×44 px for all buttons
- Textareas do not get covered by the keyboard (scroll into view on focus)
- Token symbols and amounts use `font-mono` to avoid layout jitter
- Long topic text wraps correctly in `ThreadPreview`
- Progress theatre rows animate in without pushing the layout (use `motion.li` height=auto)
- Images use `loading="lazy"` where possible
- Scroll restoration between screens (e.g., generating → preview keeps you at the top)

Fix issues one by one, commit per fix:

```bash
git commit -m "fix: <specific polish item>"
```

- [ ] **Step 3: Test on 3G throttle**

Chrome DevTools → Network → "Slow 3G". Reload `/`. The initial screen (connect / mode picker) should be interactive within 4s. If slower, investigate with the bundle analyzer output from Task 17.

- [ ] **Step 4: Commit a summary**

```bash
git add docs/bug-bash.md
git commit -m "docs: Week 3 polish pass notes"
```

---

## Task 19: Round 2 user testing

**Files:**
- Modify: `/Users/vanhuy/shippost/docs/bug-bash.md`

- [ ] **Step 1: Invite 10 creators**

Mix: 3 crypto X writers (≥500 followers), 2 devrel folks, 2 newsletter writers, 3 general crypto users.

Message template:

```
ShipPost is now live with Hot Take mode. Pick any recent crypto event or tweet URL. 
Pay 0.05 cUSD. Post the thread to your real X. Reply here with 
(1) quality of the thread 1-10, 
(2) would you reuse it tomorrow, 
(3) one thing to cut, 
(4) one thing to add.
```

Offer $0.25 cUSD reimbursement per tester (5× the thread cost) to reduce friction.

- [ ] **Step 2: Track in `docs/bug-bash.md`**

Append a new section:

```markdown
## Round 2 — week 3 (Hot Take launch)

| # | Name | Role | Quality | Reuse? | Cut | Add |
|---|------|------|---------|--------|-----|-----|
| 1 | … | crypto writer | 8/10 | yes | … | … |
| … |
```

- [ ] **Step 3: Sort feedback**

Cross-reference feedback to code:
- Which prompt templates to revise → `lib/prompts/modeB.ts`
- Which UI flows to shorten → `app/page.tsx`
- Which error messages were unclear → `components/ErrorSurface.tsx`

Update the P0/P1/P2 list.

- [ ] **Step 4: Commit**

```bash
git add docs/bug-bash.md
git commit -m "docs: round 2 user testing feedback"
```

---

## Task 20: Act on round 2 feedback (P0 + prompt tuning)

**Files:**
- Modify: `lib/prompts/modeA.ts`, `lib/prompts/modeB.ts`, `lib/prompts/factCheck.ts`
- Plus whichever components the P0s live in

- [ ] **Step 1: Prompt tuning**

Re-read the round-2 qualitative comments on thread quality. For Mode A, common levers:
- Shorten tweet 1 (hook) — add "≤180 chars" constraint
- Ban vague verbs like "explore" / "dive into"
- Require a concrete number or named EIP in tweet 2

For Mode B (Hot Take), common levers:
- Force an opposing-view tweet explicitly
- Require a named source when using context

Make the edits directly in the prompt files. Example for `modeA.ts`:

```typescript
const STRUCTURE = `Structure:
- Tweet 1: a hook — max 180 characters. A concrete surprising claim or one-line framing. Must contain a specific number, a named project, or a named EIP/ERC.
- Next tweets: 3 core concepts / steps / facts, one per tweet. Each self-contained. Ban the verbs "explore", "dive into", "unpack".
- Second-last tweet: an analogy or a "why this matters for builders" line.
- Last tweet: a call-to-action (reply, follow, link).`;
```

- [ ] **Step 2: Generate 3 new threads per mode and verify quality improves**

Self-test:

```bash
# Educational
curl -X POST http://localhost:3000/api/x402/groq \
  -H "Content-Type: application/json" \
  -d '{"threadId":"99","topic":"ERC-4337 account abstraction for developers","audience":"intermediate","length":5,"chainId":42220}' | jq '.tweets'

# Hot Take
# …run via the UI with a tweet URL
```

Compare output to pre-change threads saved in Supabase. Commit prompt edits with a before/after note in the commit message body.

- [ ] **Step 3: Fix P0 UX items**

For each P0, a separate commit. Examples:

```bash
git commit -m "fix: url preview fallback when og-scraper hits 403"
git commit -m "fix: clearer copy when agent wallet returns DailySpendCapExceeded"
```

- [ ] **Step 4: Commit prompt + P0 batch**

```bash
git add lib/prompts/
git commit -m "feat: tighten prompt constraints from round 2 feedback"
git push
```

---

## Task 21: Verify repeat users + >= 30 threads

**Files:**
- (analytics + manual verification)

- [ ] **Step 1: Query Supabase**

```sql
select
  count(*) as threads,
  count(distinct wallet_address) as wallets,
  (select count(*) from (
    select wallet_address from threads where chain_id = 42220 group by wallet_address having count(*) > 1
  ) s) as repeat_users
from threads
where chain_id = 42220;
```

Target:
- `threads >= 30`
- `wallets >= 10`
- `repeat_users >= 3`

- [ ] **Step 2: If repeat_users < 3, nudge testers**

DM the 10 round-2 testers: "Would you write a second thread? Here's 0.10 cUSD on the house." Send them 0.10 cUSD directly; they choose when to use it.

- [ ] **Step 3: Record results**

Append to `docs/bug-bash.md` under `## Week 3 gate numbers`:

```markdown
### Week 3 gate numbers (date YYYY-MM-DD)

- threads: N
- unique wallets: N
- repeat users: N
- x402 payments: N
- bundle size /: X KB gzipped
```

- [ ] **Step 4: Commit**

```bash
git add docs/bug-bash.md
git commit -m "docs: Week 3 gate numbers"
```

---

## Task 22: Pause + resume smoke (spec risk mitigation)

**Files:**
- Create: `/Users/vanhuy/shippost/scripts/pause.ts`

- [ ] **Step 1: Add pause/unpause admin script**

Create `scripts/pause.ts`:

```typescript
import 'dotenv/config';
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const action = process.argv[2];
  if (action !== 'pause' && action !== 'unpause') {
    console.log('usage: pnpm hardhat run scripts/pause.ts --network <net> <pause|unpause>');
    process.exit(1);
  }
  const deployments = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network.name}.json`), 'utf8'),
  );
  const [signer] = await ethers.getSigners();
  const payment = await ethers.getContractAt('ShipPostPayment', deployments.ShipPostPayment, signer);
  const tx = action === 'pause' ? await payment.pause() : await payment.unpause();
  const r = await tx.wait();
  console.log(action, 'tx:', r?.hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Test the kill switch on Alfajores only**

```bash
pnpm hardhat run scripts/pause.ts --network alfajores pause
# Try to pay from the UI → expect revert
pnpm hardhat run scripts/pause.ts --network alfajores unpause
# Try again → succeeds
```

**DO NOT** pause mainnet during gate verification. This script is ammunition for Week 4 if an incident happens.

- [ ] **Step 3: Commit**

```bash
git add scripts/pause.ts
git commit -m "feat: pause / unpause admin script"
```

---

## Task 23: Week 3 gate verification

**Files:**
- (manual verification + documentation)

- [ ] **Step 1: Verify Definition of Done**

- [ ] Both modes work end-to-end on Celo mainnet
- [ ] ≥30 mainnet threads (Supabase SQL confirms)
- [ ] ≥3 repeat users (Supabase SQL confirms)
- [ ] Serper, Flux, Groq, Fact-check all produce visible x402 txs on Celoscan across recent threads
- [ ] `/stats` page shows non-zero data and refreshes
- [ ] `/history` page lists connected wallet's threads correctly
- [ ] At least 1 `refund_tx_hash` row in Supabase (real or smoke-test)
- [ ] All 8 spec error states have a visible `ErrorSurface` path (cross-check `docs/error-states.md`)
- [ ] Bundle size of `/` entry ≤ 200KB gzipped (from Task 17)
- [ ] Pause kill switch verified on Alfajores, mainnet script ready
- [ ] `pnpm test:contracts` and `pnpm test:lib` still pass

- [ ] **Step 2: Update README**

```markdown
## Status

🛠 **Week 3 of 4 — Both modes live, analytics public**

- ✅ Mode B (Hot Take) with Serper + CoinGecko + fact-check
- ✅ Personal `/history` + public `/stats` pages
- ✅ Full error-state coverage + refund flow
- ✅ Bundle ≤ 200KB gzipped
- ✅ ≥30 mainnet threads, ≥3 repeat users
- ⏭️ Week 4: Judge analytics, demo video, pitch deck, submission
```

- [ ] **Step 3: Tag + push**

```bash
git add README.md
git commit -m "docs: Week 3 gate complete"
git tag -a week3-complete -m "Week 3: Mode B + polish"
git push origin main week3-complete
```

---

## Week 3 Completion

When this plan is fully executed:

1. Both Educational and Hot Take modes ship end-to-end with a 5-step x402 pipeline.
2. Every spec error state has an actual UX surface, and refunds are demonstrable via a tagged Supabase row + Celoscan tx.
3. Public + personal analytics pages exist and are wired to Supabase with 30s revalidation.
4. Bundle budget is met (≤200KB).
5. ≥30 threads, ≥10 wallets, ≥3 repeat users on mainnet — datapoints for the Week 4 judge pitch.
6. A pause kill switch + admin refund script give you operational control for submission week.
