# ShipPost Week 2 — Ship Mode A on Celo Mainnet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Week 1 Alfajores demo into a production-grade Celo mainnet MiniApp running Mode A (Educational threads) end-to-end, with real Groq generation + Flux thumbnails, a live "progress theatre" UI, tweet-level preview/edit, Share-to-X deep link, and ≥10 real paid threads from ≥5 unique wallets.

**Architecture:** Keep the Week 1 monorepo (Next.js + viem/wagmi + Hardhat). Add a pipeline abstraction in `lib/pipeline/` that runs a sequence of x402-backed steps (`groq-generate` → `flux-thumbnail`) and streams progress events via SSE from `/api/generate/stream` to the client. Add Supabase (free tier) for thread persistence. Deploy the same contracts (unchanged from Week 1) to Celo mainnet (chainId 42220) and wire the frontend's chain/token/contract maps to support both chains simultaneously.

**Tech Stack (additions on top of Week 1):** Server-Sent Events (native Next.js `ReadableStream`), `@fal-ai/client` SDK, `@supabase/supabase-js`, Framer Motion for progress theatre animation, mainnet Celo RPC (Forno `https://forno.celo.org`).

**Spec reference:** `/Users/vanhuy/shippost/docs/superpowers/specs/2026-04-24-shippost-minipay-design.md`
**Prior plan:** `/Users/vanhuy/shippost/docs/superpowers/plans/2026-04-24-shippost-week1-foundation.md` (assumes all 25 Week 1 tasks complete and `week1-complete` git tag exists)

**Week 2 Gate (end of plan):**
- Contracts deployed + verified on Celo mainnet (chainId 42220)
- Vercel production URL works inside real MiniPay browser on an Android phone
- ≥10 real threads generated on mainnet by ≥5 unique wallets
- ≥$0.50 on-chain volume (≥10 × $0.05)
- Both Groq generation **and** Flux thumbnail x402 payments visible on Celoscan mainnet
- Progress theatre shows live step checkmarks + per-step cost + agent wallet Celoscan link
- Share-to-X deep link opens a composable thread in the X app

---

## File Structure

New / modified files in Week 2:

```
shippost/
├── .env.example                              # + FAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE, NEXT_PUBLIC_*_MAINNET
├── hardhat.config.ts                         # mainnet network added
├── package.json                              # new deps
│
├── scripts/
│   ├── deploy.ts                             # already exists (Week 1) — now supports --network celo
│   └── fund-agent.ts                         # NEW — send cUSD to AgentWallet on any chain
│
├── lib/
│   ├── chains.ts                             # NEW — helpers (getChain, explorerBase)
│   ├── contracts.ts                          # + mainnet addresses
│   ├── tokens.ts                             # + mainnet addresses
│   ├── wagmi.ts                              # add celo mainnet chain
│   ├── orchestrator.ts                       # MODIFIED — accept multiple service calls, reuse client
│   ├── supabase.ts                           # NEW — server + client instances
│   ├── threadParser.ts                       # NEW — split LLM output into numbered tweets
│   ├── pipeline/
│   │   ├── types.ts                          # NEW — PipelineStep, PipelineEvent
│   │   ├── groqStep.ts                       # NEW — generation step + x402 settle
│   │   ├── fluxStep.ts                       # NEW — thumbnail step + x402 settle
│   │   └── runModeA.ts                       # NEW — orchestrates steps + streams events
│   └── prompts/
│       ├── modeA.ts                          # NEW — prompt templates by audience × length
│       └── system.ts                         # NEW — base system prompt
│
├── app/
│   ├── api/
│   │   ├── x402/
│   │   │   ├── groq/route.ts                 # MODIFIED — takes {topic,audience,length}
│   │   │   └── flux/route.ts                 # NEW
│   │   └── generate/
│   │       └── stream/route.ts               # NEW — SSE pipeline runner
│   └── page.tsx                              # MODIFIED — uses useThreadGeneration, new screens
│
├── components/
│   ├── GeneratingStatus.tsx                  # REPLACED — live progress theatre
│   ├── ThreadPreview.tsx                     # NEW — tweet cards with inline edit
│   ├── ThumbnailCard.tsx                     # NEW — image + regenerate
│   ├── ShareToX.tsx                          # NEW — deep link + copy-all
│   ├── PostShareScreen.tsx                   # NEW — cost transparency + "write another"
│   └── ModePicker.tsx                        # MODIFIED — hot-take stays disabled
│
├── hooks/
│   └── useThreadGeneration.ts                # NEW — SSE consumer + typed state machine
│
└── supabase/
    └── migrations/
        └── 0001_threads.sql                  # NEW — threads table
```

---

## Prerequisite: Before Task 1

**You must have completed Week 1 (tag `week1-complete` exists) and have:**

- A Celo mainnet wallet (the SAME deployer you used for Alfajores, or a new one) funded with:
  - ≥0.5 CELO for gas (buy on Coinbase / Minswap / bridge)
  - ≥$15 cUSD for agent-wallet funding + self-testing threads
- A free Supabase account (https://supabase.com/dashboard) — create a new project named `shippost`
- A fal.ai account with the $5 signup credit (https://fal.ai) and a generated API key
- 1 Android phone with MiniPay installed for real MiniPay smoke tests (day-13 bug bash)
- 5 tester wallets you can share with (Discord / Twitter DMs): each needs ≥$0.25 cUSD

---

## Task 1: Mode A prompt template library

**Files:**
- Create: `/Users/vanhuy/shippost/lib/prompts/system.ts`
- Create: `/Users/vanhuy/shippost/lib/prompts/modeA.ts`

- [x] **Step 1: Create the shared system prompt**

Create `lib/prompts/system.ts`:

```typescript
export const SYSTEM_PROMPT = `You are ShipPost, a concise crypto/dev content writer.

Rules:
- Write X (Twitter) threads, each tweet on its own line, numbered like "1/", "2/", etc.
- Each tweet must be <= 270 characters (leaves room for thread reply indicators).
- No hashtags. No emojis unless strictly needed for structural clarity.
- No marketing fluff. No "in this thread we will explore…" style filler.
- Use plain language. Concrete examples > abstractions. Specific numbers > vague claims.
- Never invent facts, token prices, or stats. If unsure, omit the claim.
- Do not write a title or preamble — only the numbered tweets, separated by one blank line.`;
```

- [x] **Step 2: Create Mode A prompt builder**

Create `lib/prompts/modeA.ts`:

```typescript
export type Audience = 'beginner' | 'intermediate' | 'advanced';
export type Length = 5 | 8 | 12;

interface ModeAInput {
  topic: string;
  audience: Audience;
  length: Length;
}

const AUDIENCE_GUIDANCE: Record<Audience, string> = {
  beginner:
    'Assume the reader has never written Solidity. Define every jargon word the first time it appears. Prefer analogies to familiar web2 ideas.',
  intermediate:
    'Assume the reader has shipped one dapp. Skip basic definitions. Compare against alternatives and name specific EIPs/ERCs.',
  advanced:
    'Assume the reader reads yellow papers. Include gas numbers, storage layout tradeoffs, and known footguns.',
};

const STRUCTURE = `Structure:
- Tweet 1: a hook — a concrete surprising claim or one-line framing.
- Next tweets: 3 core concepts / steps / facts, one per tweet. Each self-contained.
- Second-last tweet: an analogy or a "why this matters for builders" line.
- Last tweet: a call-to-action (follow for more / reply with your take / link to docs).`;

export function buildModeAPrompt(input: ModeAInput): string {
  return [
    `Topic: ${input.topic.trim()}`,
    `Target audience: ${input.audience}. ${AUDIENCE_GUIDANCE[input.audience]}`,
    `Thread length: exactly ${input.length} tweets.`,
    STRUCTURE,
    'Output only the numbered tweets separated by blank lines. Nothing else.',
  ].join('\n\n');
}

export function buildThumbnailPrompt(topic: string): string {
  return `Minimal high-contrast dark-mode illustration representing "${topic}". Thin line art, electric blue accents on near-black background, no text, no human faces, 16:9 aspect ratio, crypto/developer aesthetic.`;
}
```

- [x] **Step 3: Commit**

```bash
git add lib/prompts/system.ts lib/prompts/modeA.ts
git commit -m "feat: Mode A prompt templates"
```

---

## Task 2: Thread parser (split LLM output into tweets)

**Files:**
- Create: `/Users/vanhuy/shippost/lib/threadParser.ts`
- Create: `/Users/vanhuy/shippost/lib/threadParser.test.ts`

- [ ] **Step 1: Install test runner if not present**

Week 1 did not add a JS test runner (Hardhat tests live in `test/*.t.ts`). Add Vitest for lib-level tests:

```bash
pnpm add -D vitest
```

Add to `package.json` scripts:

```json
"test:lib": "vitest run lib"
```

- [ ] **Step 2: Write the failing parser test**

Create `lib/threadParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseThread } from './threadParser';

describe('parseThread', () => {
  it('splits numbered tweets separated by blank lines', () => {
    const raw = `1/ first tweet text here.

2/ second tweet text here.

3/ last one.`;
    expect(parseThread(raw)).toEqual([
      '1/ first tweet text here.',
      '2/ second tweet text here.',
      '3/ last one.',
    ]);
  });

  it('handles tweets with internal line breaks (single newline)', () => {
    const raw = `1/ line one
still line one.

2/ second tweet.`;
    expect(parseThread(raw)).toEqual([
      '1/ line one\nstill line one.',
      '2/ second tweet.',
    ]);
  });

  it('tolerates "1." or "1)" numbering', () => {
    const raw = `1. first

2) second

3/ third`;
    expect(parseThread(raw)).toEqual([
      '1. first',
      '2) second',
      '3/ third',
    ]);
  });

  it('drops leading/trailing whitespace and empty paragraphs', () => {
    const raw = `\n\n1/ first\n\n\n2/ second\n\n`;
    expect(parseThread(raw)).toEqual(['1/ first', '2/ second']);
  });

  it('returns single element if LLM forgot to number', () => {
    const raw = `Some unnumbered text from the model.`;
    expect(parseThread(raw)).toEqual(['Some unnumbered text from the model.']);
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

```bash
pnpm test:lib
```

Expected: fails with "Cannot find module './threadParser'".

- [ ] **Step 4: Implement parser**

Create `lib/threadParser.ts`:

```typescript
const NUMBERED_START = /^\s*\d+\s*[\/\.\)]\s*/;

export function parseThread(raw: string): string[] {
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  // If no paragraph starts with a number, return as single block.
  const anyNumbered = paragraphs.some((p) => NUMBERED_START.test(p));
  if (!anyNumbered) return [paragraphs.join('\n\n')];

  return paragraphs;
}
```

- [ ] **Step 5: Run the test to see it pass**

```bash
pnpm test:lib
```

Expected: 5/5 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/threadParser.ts lib/threadParser.test.ts package.json pnpm-lock.yaml
git commit -m "feat: thread parser with vitest coverage"
```

---

## Task 3: Groq step wrapper + wire prompts through API

**Files:**
- Create: `/Users/vanhuy/shippost/lib/pipeline/types.ts`
- Create: `/Users/vanhuy/shippost/lib/pipeline/groqStep.ts`
- Modify: `/Users/vanhuy/shippost/app/api/x402/groq/route.ts`

- [ ] **Step 1: Define pipeline event types**

Create `lib/pipeline/types.ts`:

```typescript
import type { Address, Hex } from 'viem';

export type StepId = 'groq' | 'flux';

export interface StepMeta {
  id: StepId;
  label: string;
  estimatedCost: string; // human-readable like "$0.001"
}

export type PipelineEvent =
  | { type: 'step_started'; step: StepId }
  | { type: 'step_settled'; step: StepId; txHash: Hex; costAmount: string; tokenSymbol: 'cUSD' | 'USDT' | 'USDC' }
  | { type: 'step_output'; step: StepId; output: unknown }
  | { type: 'step_failed'; step: StepId; error: string }
  | { type: 'done'; totalCostUsd: string }
  | { type: 'fatal'; error: string };

export interface PipelineContext {
  chainId: number;
  threadId: bigint;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  agentWallet: Address;
}
```

- [ ] **Step 2: Create reusable Groq step**

Create `lib/pipeline/groqStep.ts`:

```typescript
import Groq from 'groq-sdk';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import { parseThread } from '@/lib/threadParser';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import type { PipelineContext, PipelineEvent } from './types';

const GROQ_SINK = '0x000000000000000000000000000000000000dead' as const;
const GROQ_COST_CUSD = parseEther('0.001'); // 0.001 cUSD per generation

export async function runGroqStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'groq' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  const userPrompt = buildModeAPrompt({
    topic: ctx.topic,
    audience: ctx.audience,
    length: ctx.length,
  });

  let raw: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    });
    raw = resp.choices[0]?.message?.content ?? '';
    if (!raw.trim()) throw new Error('Groq returned empty content');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Groq failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  const tweets = parseThread(raw);
  emit({ type: 'step_output', step: 'groq', output: tweets });

  // Settle x402 on-chain (best-effort; failure here does not fail the thread)
  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: GROQ_SINK,
      tokenSymbol: 'cUSD',
      amount: GROQ_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'groq',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e) {
    console.error('groq x402 settle failed', e);
  }

  return { tweets };
}
```

- [ ] **Step 3: Update /api/x402/groq to accept structured input**

Replace `app/api/x402/groq/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { runGroqStep } from '@/lib/pipeline/groqStep';
import { getContracts } from '@/lib/contracts';

interface GroqRequest {
  threadId: string;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
}

export async function POST(req: Request) {
  const body = (await req.json()) as GroqRequest;

  if (!body.topic?.trim()) {
    return NextResponse.json({ error: 'topic required' }, { status: 400 });
  }

  try {
    const contracts = getContracts(body.chainId);
    const events: unknown[] = [];
    const { tweets } = await runGroqStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: body.topic,
        audience: body.audience,
        length: body.length,
        agentWallet: contracts.AgentWallet,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ tweets, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 4: Smoke test manually**

Start dev server, then:

```bash
curl -X POST http://localhost:3000/api/x402/groq \
  -H "Content-Type: application/json" \
  -d '{"threadId":"1","topic":"ERC-4626 vault basics","audience":"beginner","length":5,"chainId":44787}'
```

Expected: JSON with `tweets: ["1/ …", "2/ …", …]` array of length ~5, plus an `events` array containing `step_started`, `step_output`, and `step_settled` entries.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/types.ts lib/pipeline/groqStep.ts app/api/x402/groq/route.ts
git commit -m "feat: Mode A prompts + structured Groq pipeline step"
```

---

## Task 4: fal.ai Flux step + x402 proxy endpoint

**Files:**
- Create: `/Users/vanhuy/shippost/lib/pipeline/fluxStep.ts`
- Create: `/Users/vanhuy/shippost/app/api/x402/flux/route.ts`

- [ ] **Step 1: Install fal client + update env**

```bash
pnpm add @fal-ai/client
```

Append to `.env.example`:

```
FAL_KEY=
```

Add `FAL_KEY` locally to `.env` using the key from https://fal.ai/dashboard/keys.

- [ ] **Step 2: Create Flux step**

Create `lib/pipeline/fluxStep.ts`:

```typescript
import { fal } from '@fal-ai/client';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import { buildThumbnailPrompt } from '@/lib/prompts/modeA';
import type { PipelineContext, PipelineEvent } from './types';

const FLUX_SINK = '0x000000000000000000000000000000000000beef' as const;
const FLUX_COST_CUSD = parseEther('0.003'); // 0.003 cUSD per image

interface FluxResult {
  imageUrl: string;
}

export async function runFluxStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<FluxResult> {
  emit({ type: 'step_started', step: 'flux' });

  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing');
  fal.config({ credentials: key });

  const prompt = buildThumbnailPrompt(ctx.topic);

  let imageUrl: string;
  try {
    const result = await fal.subscribe('fal-ai/flux/schnell', {
      input: { prompt, image_size: 'landscape_16_9', num_inference_steps: 4 },
    });
    const data = result.data as { images?: Array<{ url: string }> };
    const url = data.images?.[0]?.url;
    if (!url) throw new Error('fal returned no image');
    imageUrl = url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fal failed';
    emit({ type: 'step_failed', step: 'flux', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'flux', output: { imageUrl } });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: FLUX_SINK,
      tokenSymbol: 'cUSD',
      amount: FLUX_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'flux',
      txHash,
      costAmount: '0.003',
      tokenSymbol: 'cUSD',
    });
  } catch (e) {
    console.error('flux x402 settle failed', e);
  }

  return { imageUrl };
}
```

- [ ] **Step 3: Add Flux proxy endpoint (debug / regenerate hook)**

Create `app/api/x402/flux/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { runFluxStep } from '@/lib/pipeline/fluxStep';
import { getContracts } from '@/lib/contracts';

interface FluxRequest {
  threadId: string;
  topic: string;
  chainId: number;
}

export async function POST(req: Request) {
  const body = (await req.json()) as FluxRequest;
  if (!body.topic?.trim()) {
    return NextResponse.json({ error: 'topic required' }, { status: 400 });
  }
  try {
    const contracts = getContracts(body.chainId);
    const events: unknown[] = [];
    const { imageUrl } = await runFluxStep(
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
    return NextResponse.json({ imageUrl, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 4: Smoke test the Flux endpoint**

```bash
curl -X POST http://localhost:3000/api/x402/flux \
  -H "Content-Type: application/json" \
  -d '{"threadId":"1","topic":"ERC-4626 vaults","chainId":44787}' | jq
```

Expected: `{ "imageUrl": "https://fal.media/..." }` with a viewable PNG, plus `events` array showing `step_started`, `step_output`, `step_settled`.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/fluxStep.ts app/api/x402/flux/route.ts package.json pnpm-lock.yaml .env.example
git commit -m "feat: fal.ai Flux x402 proxy step"
```

---

## Task 5: Mode A pipeline runner + SSE endpoint

**Files:**
- Create: `/Users/vanhuy/shippost/lib/pipeline/runModeA.ts`
- Create: `/Users/vanhuy/shippost/app/api/generate/stream/route.ts`

- [ ] **Step 1: Create the orchestrating runner**

Create `lib/pipeline/runModeA.ts`:

```typescript
import { runGroqStep } from './groqStep';
import { runFluxStep } from './fluxStep';
import type { PipelineContext, PipelineEvent } from './types';

export interface ModeAOutput {
  tweets: string[];
  imageUrl: string | null;
}

export async function runModeA(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<ModeAOutput> {
  // Step 1: generate tweets (hard-fail if this fails — user gets refund upstream)
  const { tweets } = await runGroqStep(ctx, emit);

  // Step 2: thumbnail (soft-fail — thread still shippable without an image)
  let imageUrl: string | null = null;
  try {
    const res = await runFluxStep(ctx, emit);
    imageUrl = res.imageUrl;
  } catch (e) {
    console.error('Flux step failed, continuing without image', e);
  }

  const totalCostUsd = imageUrl ? '0.004' : '0.001';
  emit({ type: 'done', totalCostUsd });

  return { tweets, imageUrl };
}
```

- [ ] **Step 2: Create SSE streaming endpoint**

Create `app/api/generate/stream/route.ts`:

```typescript
import { runModeA } from '@/lib/pipeline/runModeA';
import { getContracts } from '@/lib/contracts';
import type { PipelineEvent } from '@/lib/pipeline/types';

interface StreamRequest {
  threadId: string;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // viem + groq-sdk require Node runtime

function sseLine(e: PipelineEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as StreamRequest;

  if (!body.topic?.trim()) {
    return new Response('topic required', { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (e: PipelineEvent) => {
        controller.enqueue(encoder.encode(sseLine(e)));
      };

      // ⚠️ RECOMMENDATION: flush an initial byte immediately.
      // Vercel has a 25s timeout before the first byte reaches the client.
      // Without this, a slow pipeline kills the connection before any UI update.
      controller.enqueue(encoder.encode(sseLine({ type: 'started' } as unknown as PipelineEvent)));

      try {
        const contracts = getContracts(body.chainId);
        const output = await runModeA(
          {
            chainId: body.chainId,
            threadId: BigInt(body.threadId),
            topic: body.topic,
            audience: body.audience,
            length: body.length,
            agentWallet: contracts.AgentWallet,
          },
          emit,
        );
        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets: output.tweets, imageUrl: output.imageUrl },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'pipeline failed';
        emit({ type: 'fatal', error: msg });
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

- [ ] **Step 3: Smoke test SSE stream**

```bash
curl -N -X POST http://localhost:3000/api/generate/stream \
  -H "Content-Type: application/json" \
  -d '{"threadId":"1","topic":"EIP-7702","audience":"beginner","length":5,"chainId":44787}'
```

Expected: a sequence of `data: {"type":"step_started",...}` lines, then `step_settled`, `step_output`, and finally `done`.

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/runModeA.ts app/api/generate/stream/route.ts
git commit -m "feat: Mode A pipeline runner with SSE streaming"
```

---

## Task 6: useThreadGeneration hook (SSE consumer)

**Files:**
- Create: `/Users/vanhuy/shippost/hooks/useThreadGeneration.ts`

- [ ] **Step 1: Create hook with typed state machine**

Create `hooks/useThreadGeneration.ts`:

```typescript
'use client';

import { useCallback, useRef, useState } from 'react';
import type { PipelineEvent, StepId } from '@/lib/pipeline/types';

export interface StepState {
  status: 'pending' | 'running' | 'settled' | 'failed';
  txHash?: string;
  costAmount?: string;
  tokenSymbol?: string;
  error?: string;
}

export interface ThreadGenerationState {
  steps: Record<StepId, StepState>;
  tweets: string[] | null;
  imageUrl: string | null;
  fatal: string | null;
  isDone: boolean;
  totalCostUsd: string | null;
}

const initial: ThreadGenerationState = {
  steps: {
    groq: { status: 'pending' },
    flux: { status: 'pending' },
  },
  tweets: null,
  imageUrl: null,
  fatal: null,
  isDone: false,
  totalCostUsd: null,
};

interface StartParams {
  threadId: bigint;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
}

export function useThreadGeneration() {
  const [state, setState] = useState<ThreadGenerationState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((e: PipelineEvent) => {
    setState((prev) => {
      const steps = { ...prev.steps };
      switch (e.type) {
        case 'step_started':
          steps[e.step] = { ...steps[e.step], status: 'running' };
          return { ...prev, steps };
        case 'step_settled':
          steps[e.step] = {
            ...steps[e.step],
            status: 'settled',
            txHash: e.txHash,
            costAmount: e.costAmount,
            tokenSymbol: e.tokenSymbol,
          };
          return { ...prev, steps };
        case 'step_failed':
          steps[e.step] = { ...steps[e.step], status: 'failed', error: e.error };
          return { ...prev, steps };
        case 'step_output': {
          const output = e.output as {
            final?: boolean;
            tweets?: string[];
            imageUrl?: string | null;
          };
          if (output.final) {
            return {
              ...prev,
              tweets: output.tweets ?? null,
              imageUrl: output.imageUrl ?? null,
            };
          }
          if (e.step === 'groq' && Array.isArray(e.output)) {
            return { ...prev, tweets: e.output as string[] };
          }
          if (e.step === 'flux' && typeof output.imageUrl === 'string') {
            return { ...prev, imageUrl: output.imageUrl };
          }
          return prev;
        }
        case 'done':
          return { ...prev, isDone: true, totalCostUsd: e.totalCostUsd };
        case 'fatal':
          return { ...prev, fatal: e.error, isDone: true };
      }
    });
  }, []);

  const start = useCallback(
    async (params: StartParams) => {
      setState(initial);
      abortRef.current = new AbortController();
      const res = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: params.threadId.toString(),
          topic: params.topic,
          audience: params.audience,
          length: params.length,
          chainId: params.chainId,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        setState((s) => ({ ...s, fatal: `HTTP ${res.status}`, isDone: true }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            apply(JSON.parse(line) as PipelineEvent);
          } catch {
            /* malformed chunk — ignore */
          }
        }
      }
    },
    [apply],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initial);
  }, []);

  return { state, start, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useThreadGeneration.ts
git commit -m "feat: useThreadGeneration SSE consumer hook"
```

---

## Task 7: Progress theatre UI (replaces GeneratingStatus)

**Files:**
- Modify: `/Users/vanhuy/shippost/components/GeneratingStatus.tsx`

- [ ] **Step 1: Install Framer Motion**

```bash
pnpm add framer-motion
```

- [ ] **Step 2: Replace GeneratingStatus with live progress theatre**

Replace `components/GeneratingStatus.tsx`:

```tsx
'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import type { ThreadGenerationState } from '@/hooks/useThreadGeneration';
import type { StepId } from '@/lib/pipeline/types';

const STEP_META: Record<StepId, { label: string; icon: string; budget: string }> = {
  groq: { label: 'Writing thread', icon: '✍️', budget: '$0.001' },
  flux: { label: 'Creating thumbnail', icon: '🎨', budget: '$0.003' },
};

const ORDER: StepId[] = ['groq', 'flux'];

interface Props {
  gen: ThreadGenerationState;
  payTxHash: string | null;
  threadId: bigint | null;
  chainExplorerBase: string;
  agentWalletAddress: string;
}

function statusIcon(s: string): string {
  if (s === 'settled') return '✓';
  if (s === 'running') return '⏳';
  if (s === 'failed') return '✕';
  return '—';
}

export function GeneratingStatus({
  gen,
  payTxHash,
  threadId,
  chainExplorerBase,
  agentWalletAddress,
}: Props) {
  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Generating your thread…</h2>

      <ul className="text-sm flex flex-col gap-2">
        <li className="flex items-center justify-between">
          <span>💸 Payment confirmed</span>
          <span className="font-mono text-xs">{payTxHash ? '✓' : '⏳'}</span>
        </li>

        {ORDER.map((id) => {
          const meta = STEP_META[id];
          const step = gen.steps[id];
          const show = step.status !== 'pending' || id === 'groq';
          if (!show) return null;
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-2"
            >
              <span>
                {meta.icon} {meta.label}
              </span>
              <span className="flex items-center gap-2 font-mono text-xs">
                {step.costAmount
                  ? `$${step.costAmount} ${step.tokenSymbol ?? ''}`
                  : meta.budget}
                <span className="min-w-[1ch] text-right">{statusIcon(step.status)}</span>
              </span>
            </motion.li>
          );
        })}
      </ul>

      {gen.totalCostUsd && (
        <p className="text-xs text-muted-foreground">
          Agent spent <span className="font-mono">${gen.totalCostUsd}</span> of $0.025 budget
        </p>
      )}

      <div className="flex flex-col gap-1 text-xs">
        {payTxHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${payTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View pay tx →
          </a>
        )}
        {gen.steps.groq.txHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${gen.steps.groq.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Groq x402 settlement →
          </a>
        )}
        {gen.steps.flux.txHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${gen.steps.flux.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Flux x402 settlement →
          </a>
        )}
        <a
          className="text-muted-foreground underline"
          href={`${chainExplorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Agent wallet on Celoscan →
        </a>
      </div>

      {threadId !== null && (
        <p className="text-xs text-muted-foreground">Thread #{threadId.toString()}</p>
      )}

      {gen.fatal && <p className="text-sm text-destructive">Pipeline failed: {gen.fatal}</p>}
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/GeneratingStatus.tsx package.json pnpm-lock.yaml
git commit -m "feat: live progress theatre with Framer Motion"
```

---

## Task 8: Wire progress theatre into page.tsx

**Files:**
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Update page to use useThreadGeneration**

Replace the `Home` component body in `app/page.tsx`. Find the existing mockOutput `useEffect` and the `generating` screen and refactor to:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { usePayForThread } from '@/lib/usePayForThread';
import { useThreadGeneration } from '@/hooks/useThreadGeneration';
import { getContracts } from '@/lib/contracts';
import { getExplorerBase } from '@/lib/chains';

type Screen = 'mode' | 'educational' | 'generating' | 'preview';

export default function Home() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();

  const [screen, setScreen] = useState<Screen>('mode');
  const [submission, setSubmission] = useState<EducationalSubmitPayload | null>(null);

  const { pay, status, threadId, txHash, error, reset: resetPay } = usePayForThread();
  const { state: gen, start: startGen, reset: resetGen } = useThreadGeneration();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  // Kick off pipeline as soon as the payment succeeds
  useEffect(() => {
    if (status === 'success' && threadId && submission && !gen.isDone && !gen.fatal && !gen.tweets) {
      startGen({
        threadId,
        topic: submission.topic,
        audience: submission.audience,
        length: submission.length,
        chainId,
      });
    }
  }, [status, threadId, submission, gen.isDone, gen.fatal, gen.tweets, chainId, startGen]);

  // When pipeline finishes, move to preview screen
  useEffect(() => {
    if (gen.isDone && gen.tweets && !gen.fatal) {
      setScreen('preview');
    }
  }, [gen.isDone, gen.tweets, gen.fatal]);

  const explorerBase = getExplorerBase(chainId);
  const contracts = getContracts(chainId);

  async function handleEducationalSubmit(p: EducationalSubmitPayload) {
    setSubmission(p);
    setScreen('generating');
    await pay(p.token, 0);
  }

  function handleWriteAnother() {
    resetPay();
    resetGen();
    setSubmission(null);
    setScreen('mode');
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-primary">ShipPost</h1>
        {isMiniPay && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            MiniPay
          </span>
        )}
      </div>

      {!isConnected ? (
        <Button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</Button>
      ) : (
        <>
          <WalletStatus />

          {screen === 'mode' && (
            <ModePicker
              onSelect={(m) => {
                if (m === 'educational') setScreen('educational');
              }}
            />
          )}

          {screen === 'educational' && (
            <EducationalInput
              onSubmit={handleEducationalSubmit}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}

          {screen === 'generating' && (
            <>
              <GeneratingStatus
                gen={gen}
                payTxHash={txHash}
                threadId={threadId}
                chainExplorerBase={explorerBase}
                agentWalletAddress={contracts.AgentWallet}
              />
              {gen.fatal && (
                <Button variant="outline" onClick={handleWriteAnother}>
                  Try again
                </Button>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Create getExplorerBase helper**

Create `lib/chains.ts`:

```typescript
import { celo, celoAlfajores } from 'viem/chains';

export function getExplorerBase(chainId: number): string {
  if (chainId === celo.id) return 'https://celoscan.io';
  if (chainId === celoAlfajores.id) return 'https://alfajores.celoscan.io';
  return 'https://celoscan.io';
}

export function isSupportedChain(chainId: number): boolean {
  return chainId === celo.id || chainId === celoAlfajores.id;
}
```

- [ ] **Step 3: Smoke test end-to-end on Alfajores**

```bash
pnpm dev
```

In browser (with simulated MiniPay):
- Connect → Educational mode → type real topic → pay.
- Watch progress theatre: Groq checkmark appears with tx link, then Flux.
- On done, app jumps to preview screen (currently empty — Task 9 builds it).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx lib/chains.ts
git commit -m "feat: wire pay → SSE pipeline → progress theatre"
```

---

## Task 9: ThreadPreview component with inline edit

**Files:**
- Create: `/Users/vanhuy/shippost/components/ThreadPreview.tsx`

- [ ] **Step 1: Install textarea shadcn component if missing**

```bash
pnpm dlx shadcn@latest add textarea badge
```

- [ ] **Step 2: Create ThreadPreview**

Create `components/ThreadPreview.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const MAX_TWEET_LEN = 270;

interface Props {
  tweets: string[];
  onChange: (tweets: string[]) => void;
}

export function ThreadPreview({ tweets, onChange }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(i: number) {
    setEditingIdx(i);
    setDraft(tweets[i]);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setDraft('');
  }

  function saveEdit() {
    if (editingIdx === null) return;
    const next = [...tweets];
    next[editingIdx] = draft.trim();
    onChange(next);
    setEditingIdx(null);
    setDraft('');
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-2">
      {tweets.map((tw, i) => {
        const isEditing = editingIdx === i;
        const over = tw.length > MAX_TWEET_LEN;
        return (
          <Card key={i} className="p-3 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <Badge variant="outline" className="text-xs">
                {i + 1}/{tweets.length}
              </Badge>
              {!isEditing && (
                <button
                  onClick={() => startEdit(i)}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
                <div className="flex justify-between items-center">
                  <span
                    className={`text-xs font-mono ${draft.length > MAX_TWEET_LEN ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {draft.length}/{MAX_TWEET_LEN}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit}>
                      Save
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{tw}</p>
            )}
            {!isEditing && over && (
              <p className="text-xs text-destructive">
                {tw.length}/{MAX_TWEET_LEN} — X will split this tweet when posted.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/ThreadPreview.tsx
git commit -m "feat: ThreadPreview with inline tweet edit + length meter"
```

---

## Task 10: ThumbnailCard with regenerate button

**Files:**
- Create: `/Users/vanhuy/shippost/components/ThumbnailCard.tsx`

- [ ] **Step 1: Create ThumbnailCard**

Create `components/ThumbnailCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  imageUrl: string | null;
  topic: string;
  threadId: bigint;
  chainId: number;
  onUpdated: (newUrl: string) => void;
}

export function ThumbnailCard({ imageUrl, topic, threadId, chainId, onUpdated }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/x402/flux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: threadId.toString(), topic, chainId }),
      });
      const j = await res.json();
      if (!res.ok || !j.imageUrl) throw new Error(j.error ?? 'regen failed');
      onUpdated(j.imageUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Card className="w-full max-w-md p-3 flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Thumbnail</h3>
        <Button size="sm" variant="ghost" disabled={regenerating} onClick={regenerate}>
          {regenerating ? 'Regenerating…' : 'Regenerate (+$0.003)'}
        </Button>
      </div>
      {imageUrl ? (
        <div className="relative w-full aspect-video rounded overflow-hidden bg-muted">
          {/* External URL → use <img> to skip Next/Image loader config */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={topic} className="w-full h-full object-cover" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No thumbnail (Flux step failed — thread still shippable).</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ThumbnailCard.tsx
git commit -m "feat: ThumbnailCard with regenerate button"
```

---

## Task 11: ShareToX component + deep link

**Files:**
- Create: `/Users/vanhuy/shippost/components/ShareToX.tsx`

- [ ] **Step 1: Create ShareToX**

Create `components/ShareToX.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  tweets: string[];
}

function buildFirstTweetUrl(text: string): string {
  // Use intent URL: works on mobile (attempts to open X app via universal link) and falls back to web.
  const encoded = encodeURIComponent(text);
  return `https://twitter.com/intent/tweet?text=${encoded}`;
}

export function ShareToX({ tweets }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    await navigator.clipboard.writeText(tweets.join('\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const first = tweets[0] ?? '';
  const rest = tweets.slice(1);

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Share to X</h3>

      <p className="text-xs text-muted-foreground">
        X mobile can&apos;t post a full thread at once. Tap <b>Post first tweet</b> below — then in
        X, use the <b>+</b> button under your own tweet to add each follow-up from the clipboard.
      </p>

      <Button asChild>
        <a href={buildFirstTweetUrl(first)} target="_blank" rel="noopener noreferrer">
          Post first tweet in X →
        </a>
      </Button>

      <Button variant="outline" onClick={copyAll}>
        {copied ? 'Copied ✓' : `Copy all ${tweets.length} tweets`}
      </Button>

      {rest.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Preview follow-ups ({rest.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-2 pl-4 list-decimal">
            {rest.map((t, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {t}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ShareToX.tsx
git commit -m "feat: ShareToX deep link + copy-all"
```

---

## Task 12: PostShareScreen with cost transparency

**Files:**
- Create: `/Users/vanhuy/shippost/components/PostShareScreen.tsx`

- [ ] **Step 1: Create PostShareScreen**

Create `components/PostShareScreen.tsx`:

```tsx
'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  paidAmountUsd: string;
  agentSpentUsd: string;
  tokenSymbol: string;
  payTxHash: string | null;
  agentWalletAddress: string;
  explorerBase: string;
  onWriteAnother: () => void;
}

export function PostShareScreen({
  paidAmountUsd,
  agentSpentUsd,
  tokenSymbol,
  payTxHash,
  agentWalletAddress,
  explorerBase,
  onWriteAnother,
}: Props) {
  const agentShare = (Number(paidAmountUsd) * 0.5).toFixed(3);
  const treasuryShare = (Number(paidAmountUsd) * 0.4).toFixed(3);
  const reserveShare = (Number(paidAmountUsd) * 0.1).toFixed(3);
  const agentProfit = (Number(agentShare) - Number(agentSpentUsd)).toFixed(3);

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">💰 Where did your {tokenSymbol} go?</h3>

      <ul className="text-xs flex flex-col gap-1 font-mono">
        <li className="flex justify-between">
          <span>You paid</span>
          <span>${paidAmountUsd}</span>
        </li>
        <li className="flex justify-between text-muted-foreground">
          <span>→ Agent wallet (50%)</span>
          <span>${agentShare}</span>
        </li>
        <li className="flex justify-between text-muted-foreground">
          <span>→ Treasury (40%)</span>
          <span>${treasuryShare}</span>
        </li>
        <li className="flex justify-between text-muted-foreground">
          <span>→ Reserve pool (10%)</span>
          <span>${reserveShare}</span>
        </li>
        <li className="flex justify-between pt-1 border-t border-border">
          <span>Agent spent on x402</span>
          <span>${agentSpentUsd}</span>
        </li>
        <li className="flex justify-between text-primary">
          <span>Agent profit on this thread</span>
          <span>${agentProfit}</span>
        </li>
      </ul>

      <div className="flex flex-col gap-1 text-xs">
        {payTxHash && (
          <a
            className="text-primary underline"
            href={`${explorerBase}/tx/${payTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View payment on Celoscan →
          </a>
        )}
        <a
          className="text-muted-foreground underline"
          href={`${explorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          See the agent&apos;s full tx history →
        </a>
      </div>

      <Button variant="outline" onClick={onWriteAnother}>
        Write another →
      </Button>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PostShareScreen.tsx
git commit -m "feat: PostShareScreen with 50/40/10 cost breakdown"
```

---

## Task 13: Wire preview + share + post-share screens into page.tsx

**Files:**
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Extend Screen type + add preview/shared states**

In `app/page.tsx`, update the top imports and add preview/shared state. Replace the file body with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { ThreadPreview } from '@/components/ThreadPreview';
import { ThumbnailCard } from '@/components/ThumbnailCard';
import { ShareToX } from '@/components/ShareToX';
import { PostShareScreen } from '@/components/PostShareScreen';
import { usePayForThread } from '@/lib/usePayForThread';
import { useThreadGeneration } from '@/hooks/useThreadGeneration';
import { getContracts } from '@/lib/contracts';
import { getExplorerBase } from '@/lib/chains';
import { computeTokenAmount } from '@/lib/tokens';

type Screen = 'mode' | 'educational' | 'generating' | 'preview' | 'post-share';

export default function Home() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();

  const [screen, setScreen] = useState<Screen>('mode');
  const [submission, setSubmission] = useState<EducationalSubmitPayload | null>(null);
  const [editedTweets, setEditedTweets] = useState<string[] | null>(null);
  const [editedImageUrl, setEditedImageUrl] = useState<string | null>(null);

  const { pay, status, threadId, txHash, error, reset: resetPay } = usePayForThread();
  const { state: gen, start: startGen, reset: resetGen } = useThreadGeneration();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  useEffect(() => {
    if (
      status === 'success' &&
      threadId !== null &&
      submission &&
      !gen.isDone &&
      !gen.fatal &&
      !gen.tweets
    ) {
      startGen({
        threadId,
        topic: submission.topic,
        audience: submission.audience,
        length: submission.length,
        chainId,
      });
    }
  }, [status, threadId, submission, gen.isDone, gen.fatal, gen.tweets, chainId, startGen]);

  useEffect(() => {
    if (gen.isDone && gen.tweets && !gen.fatal) {
      setEditedTweets(gen.tweets);
      setEditedImageUrl(gen.imageUrl);
      setScreen('preview');
    }
  }, [gen.isDone, gen.tweets, gen.imageUrl, gen.fatal]);

  const explorerBase = getExplorerBase(chainId);
  const contracts = getContracts(chainId);

  async function handleEducationalSubmit(p: EducationalSubmitPayload) {
    setSubmission(p);
    setScreen('generating');
    await pay(p.token, 0);
  }

  function handleWriteAnother() {
    resetPay();
    resetGen();
    setSubmission(null);
    setEditedTweets(null);
    setEditedImageUrl(null);
    setScreen('mode');
  }

  const paidAmountUsd = submission
    ? Number(formatUnits(computeTokenAmount(submission.token), submission.token.decimals)).toFixed(
        3,
      )
    : '0';

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-primary">ShipPost</h1>
        {isMiniPay && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            MiniPay
          </span>
        )}
      </div>

      {!isConnected ? (
        <Button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</Button>
      ) : (
        <>
          <WalletStatus />

          {screen === 'mode' && (
            <ModePicker
              onSelect={(m) => {
                if (m === 'educational') setScreen('educational');
              }}
            />
          )}

          {screen === 'educational' && (
            <EducationalInput
              onSubmit={handleEducationalSubmit}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}

          {screen === 'generating' && (
            <>
              <GeneratingStatus
                gen={gen}
                payTxHash={txHash}
                threadId={threadId}
                chainExplorerBase={explorerBase}
                agentWalletAddress={contracts.AgentWallet}
              />
              {gen.fatal && (
                <Button variant="outline" onClick={handleWriteAnother}>
                  Try again
                </Button>
              )}
            </>
          )}

          {screen === 'preview' && editedTweets && submission && threadId !== null && (
            <>
              <ThumbnailCard
                imageUrl={editedImageUrl}
                topic={submission.topic}
                threadId={threadId}
                chainId={chainId}
                onUpdated={setEditedImageUrl}
              />
              <ThreadPreview tweets={editedTweets} onChange={setEditedTweets} />
              <ShareToX tweets={editedTweets} />
              <Button onClick={() => setScreen('post-share')}>I posted it →</Button>
            </>
          )}

          {screen === 'post-share' && submission && (
            <PostShareScreen
              paidAmountUsd={paidAmountUsd}
              agentSpentUsd={gen.totalCostUsd ?? '0.004'}
              tokenSymbol={submission.token.symbol}
              payTxHash={txHash}
              agentWalletAddress={contracts.AgentWallet}
              explorerBase={explorerBase}
              onWriteAnother={handleWriteAnother}
            />
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: End-to-end smoke on Alfajores**

```bash
pnpm dev
```

Run through the full flow:
1. Connect → Educational → real topic → pay
2. Progress theatre runs (Groq + Flux with checkmarks and tx links)
3. Preview screen shows thumbnail, editable tweet cards, Share to X
4. Click "I posted it" → see cost transparency
5. Click "Write another" → back to mode picker

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire preview + share + post-share screens"
```

---

## Task 14: Supabase project + threads schema

**Files:**
- Create: `/Users/vanhuy/shippost/supabase/migrations/0001_threads.sql`
- Create: `/Users/vanhuy/shippost/lib/supabase.ts`

- [ ] **Step 1: Create Supabase project**

In https://supabase.com/dashboard:
1. New project → name `shippost` → choose region closest to Vercel (e.g., `us-east-1`)
2. Wait for provisioning (~2 min)
3. Copy: Project URL, `anon` key, `service_role` key

- [ ] **Step 2: Install Supabase client**

```bash
pnpm add @supabase/supabase-js
```

- [ ] **Step 3: Create migration SQL**

Create `supabase/migrations/0001_threads.sql`:

```sql
-- threads: one row per paid generation
create table if not exists public.threads (
  id bigint generated always as identity primary key,
  chain_id int not null,
  onchain_thread_id text not null,
  wallet_address text not null,
  mode smallint not null, -- 0 = educational, 1 = hot-take
  token_symbol text not null,
  token_address text not null,
  amount_paid_raw text not null,    -- raw base units as string (bigint)
  pay_tx_hash text not null,
  topic text,
  audience text,
  length int,
  tweets jsonb,
  image_url text,
  total_cost_usd text,
  groq_tx_hash text,
  flux_tx_hash text,
  created_at timestamptz not null default now()
);

create index if not exists threads_wallet_idx on public.threads (wallet_address);
create index if not exists threads_chain_idx on public.threads (chain_id);
create unique index if not exists threads_onchain_idx on public.threads (chain_id, onchain_thread_id);

-- Minimal rate-limit support: count threads per wallet per 24h window
-- queried from API with: select count(*) from threads where wallet_address = $1 and created_at > now() - interval '24 hours';

alter table public.threads enable row level security;

-- Anyone can select (public history page, Task 20 Week 3); only service role inserts/updates.
drop policy if exists threads_select_public on public.threads;
create policy threads_select_public on public.threads
  for select
  using (true);
```

- [ ] **Step 4: Run migration**

In Supabase dashboard → SQL editor → paste the migration → Run. Confirm the `threads` table appears under Table editor.

- [ ] **Step 5: Add env vars + client helper**

Append to `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE=
```

Populate `.env` locally with values from Step 1.

Create `lib/supabase.ts`:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serverClient: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (serverClient) return serverClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Supabase env vars missing');
  serverClient = createClient(url, key, { auth: { persistSession: false } });
  return serverClient;
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_threads.sql lib/supabase.ts package.json pnpm-lock.yaml .env.example
git commit -m "feat: Supabase threads schema + server client"
```

---

## Task 15: Log threads to Supabase from SSE endpoint

**Files:**
- Modify: `/Users/vanhuy/shippost/app/api/generate/stream/route.ts`

- [ ] **Step 1: Add insert + update inside the SSE handler**

Replace `app/api/generate/stream/route.ts` with:

```typescript
import { runModeA } from '@/lib/pipeline/runModeA';
import { getContracts } from '@/lib/contracts';
import { getSupabaseServer } from '@/lib/supabase';
import type { PipelineEvent } from '@/lib/pipeline/types';

interface StreamRequest {
  threadId: string;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sseLine(e: PipelineEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as StreamRequest;
  if (!body.topic?.trim()) return new Response('topic required', { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let groqTx: string | null = null;
      let fluxTx: string | null = null;

      const emit = (e: PipelineEvent) => {
        if (e.type === 'step_settled' && e.step === 'groq') groqTx = e.txHash;
        if (e.type === 'step_settled' && e.step === 'flux') fluxTx = e.txHash;
        controller.enqueue(encoder.encode(sseLine(e)));
      };

      const supabase = (() => {
        try {
          return getSupabaseServer();
        } catch {
          return null;
        }
      })();

      // Insert row up-front so we record paid attempts even if the pipeline fails
      if (supabase) {
        await supabase.from('threads').insert({
          chain_id: body.chainId,
          onchain_thread_id: body.threadId,
          wallet_address: body.walletAddress.toLowerCase(),
          mode: 0,
          token_symbol: body.tokenSymbol,
          token_address: body.tokenAddress.toLowerCase(),
          amount_paid_raw: body.amountPaidRaw,
          pay_tx_hash: body.payTxHash.toLowerCase(),
          topic: body.topic,
          audience: body.audience,
          length: body.length,
        });
      }

      try {
        const contracts = getContracts(body.chainId);
        const output = await runModeA(
          {
            chainId: body.chainId,
            threadId: BigInt(body.threadId),
            topic: body.topic,
            audience: body.audience,
            length: body.length,
            agentWallet: contracts.AgentWallet,
          },
          emit,
        );

        if (supabase) {
          await supabase
            .from('threads')
            .update({
              tweets: output.tweets,
              image_url: output.imageUrl,
              total_cost_usd: output.imageUrl ? '0.004' : '0.001',
              groq_tx_hash: groqTx,
              flux_tx_hash: fluxTx,
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', body.threadId);
        }

        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets: output.tweets, imageUrl: output.imageUrl },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'pipeline failed';
        emit({ type: 'fatal', error: msg });
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

- [ ] **Step 2: Update client hook + page.tsx to send wallet+pay context to SSE**

In `hooks/useThreadGeneration.ts`, extend `StartParams`:

```typescript
interface StartParams {
  threadId: bigint;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
}
```

And include those fields in the fetch body. Then in `app/page.tsx`, update the `startGen` call site:

```tsx
startGen({
  threadId,
  topic: submission.topic,
  audience: submission.audience,
  length: submission.length,
  chainId,
  walletAddress: account.address ?? '0x0',
  tokenSymbol: submission.token.symbol,
  tokenAddress: submission.token.address,
  amountPaidRaw: computeTokenAmount(submission.token).toString(),
  payTxHash: txHash ?? '0x0',
});
```

(At top of Home: `const account = useAccount();` — replace `const { isConnected } = useAccount();` with `const account = useAccount(); const isConnected = account.isConnected;`.)

- [ ] **Step 3: Smoke-test on Alfajores**

Run a full paid thread. Then in Supabase dashboard → Table editor → `threads`: confirm one row inserted with topic, tweets, image_url, pay_tx_hash, groq_tx_hash, flux_tx_hash populated.

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/stream/route.ts hooks/useThreadGeneration.ts app/page.tsx
git commit -m "feat: persist threads to Supabase"
```

---

## Task 16: Celo mainnet chain config + token + contract maps

**Files:**
- Modify: `/Users/vanhuy/shippost/lib/wagmi.ts`
- Modify: `/Users/vanhuy/shippost/lib/tokens.ts`
- Modify: `/Users/vanhuy/shippost/lib/contracts.ts`
- Modify: `/Users/vanhuy/shippost/.env.example`

- [ ] **Step 1: Add celo mainnet chain to wagmi config**

In `lib/wagmi.ts`, add `celo` to the chains array exactly once (it was already imported in Week 1 — now it's in the wagmi config too):

```typescript
import { http, createConfig } from 'wagmi';
import { celo, celoAlfajores } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

export const config = createConfig({
  chains: [celo, celoAlfajores],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [celo.id]: http(process.env.NEXT_PUBLIC_CELO_RPC ?? 'https://forno.celo.org'),
    [celoAlfajores.id]: http(
      process.env.NEXT_PUBLIC_ALFAJORES_RPC ?? 'https://alfajores-forno.celo-testnet.org',
    ),
  },
  ssr: true,
});
```

- [ ] **Step 2: Add mainnet tokens**

In `lib/tokens.ts`, extend `getTokens()` to return mainnet addresses:

```typescript
import type { Address } from 'viem';
import { celo, celoAlfajores } from 'viem/chains';

export interface TokenMeta {
  symbol: 'cUSD' | 'USDT' | 'USDC';
  address: Address;
  decimals: number;
}

export type TokenMap = Record<'cUSD' | 'USDT' | 'USDC', TokenMeta>;

export function getTokens(chainId: number): TokenMap {
  if (chainId === celo.id) {
    return {
      cUSD: { symbol: 'cUSD', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
      USDT: { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
      USDC: { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
    };
  }
  if (chainId === celoAlfajores.id) {
    const usdt = process.env.NEXT_PUBLIC_MOCK_USDT_ALFAJORES as Address | undefined;
    const usdc = process.env.NEXT_PUBLIC_MOCK_USDC_ALFAJORES as Address | undefined;
    if (!usdt || !usdc) throw new Error('Alfajores mock token addresses missing');
    return {
      cUSD: { symbol: 'cUSD', address: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1', decimals: 18 },
      USDT: { symbol: 'USDT', address: usdt, decimals: 6 },
      USDC: { symbol: 'USDC', address: usdc, decimals: 6 },
    };
  }
  throw new Error(`Unsupported chainId ${chainId}`);
}

// Preserve Week 1's helper
import { parseUnits } from 'viem';
import type { TokenBalance } from './useBalances';

export function computeTokenAmount(t: TokenBalance | TokenMeta): bigint {
  return parseUnits('0.05', t.decimals);
}
```

- [ ] **Step 3: Add mainnet contract addresses**

In `lib/contracts.ts`, extend `getContracts()`:

```typescript
import type { Address } from 'viem';
import { celo, celoAlfajores } from 'viem/chains';

// ABIs imported from artifacts (already set up in Week 1 Task 16)
export { paymentAbi, agentWalletAbi } from './abis';

export interface ContractMap {
  ShipPostPayment: Address;
  AgentWallet: Address;
}

export function getContracts(chainId: number): ContractMap {
  if (chainId === celo.id) {
    const pay = process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET as Address | undefined;
    const agent = process.env.NEXT_PUBLIC_AGENT_WALLET_MAINNET as Address | undefined;
    if (!pay || !agent) throw new Error('Mainnet contract addresses missing');
    return { ShipPostPayment: pay, AgentWallet: agent };
  }
  if (chainId === celoAlfajores.id) {
    const pay = process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_ALFAJORES as Address | undefined;
    const agent = process.env.NEXT_PUBLIC_AGENT_WALLET_ALFAJORES as Address | undefined;
    if (!pay || !agent) throw new Error('Alfajores contract addresses missing');
    return { ShipPostPayment: pay, AgentWallet: agent };
  }
  throw new Error(`Unsupported chainId ${chainId}`);
}
```

- [ ] **Step 4: Add mainnet env placeholders**

Append to `.env.example`:

```
NEXT_PUBLIC_CELO_RPC=https://forno.celo.org
NEXT_PUBLIC_ALFAJORES_RPC=https://alfajores-forno.celo-testnet.org
NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET=
NEXT_PUBLIC_AGENT_WALLET_MAINNET=
CELOSCAN_API_KEY=
```

- [ ] **Step 5: Commit**

```bash
git add lib/wagmi.ts lib/tokens.ts lib/contracts.ts .env.example
git commit -m "feat: Celo mainnet chain + token + contract config"
```

---

## Task 17: Hardhat mainnet network + deploy config

**Files:**
- Modify: `/Users/vanhuy/shippost/hardhat.config.ts`

- [ ] **Step 1: Register the `celo` network in Hardhat**

In `hardhat.config.ts`, add:

```typescript
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
dotenv.config();

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CELOSCAN_KEY = process.env.CELOSCAN_API_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    alfajores: {
      url: 'https://alfajores-forno.celo-testnet.org',
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
      chainId: 44787,
    },
    celo: {
      url: process.env.MAINNET_RPC ?? 'https://forno.celo.org',
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
      chainId: 42220,
    },
  },
  etherscan: {
    apiKey: {
      alfajores: CELOSCAN_KEY,
      celo: CELOSCAN_KEY,
    },
    customChains: [
      {
        network: 'alfajores',
        chainId: 44787,
        urls: {
          apiURL: 'https://api-alfajores.celoscan.io/api',
          browserURL: 'https://alfajores.celoscan.io',
        },
      },
      {
        network: 'celo',
        chainId: 42220,
        urls: {
          apiURL: 'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io',
        },
      },
    ],
  },
};

export default config;
```

- [ ] **Step 2: Verify config compiles**

```bash
pnpm hardhat compile
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hardhat.config.ts
git commit -m "feat: hardhat celo mainnet + verify config"
```

---

## Task 18: Mainnet deploy script

**Files:**
- Modify: `/Users/vanhuy/shippost/scripts/deploy.ts`

- [ ] **Step 1: Update deploy script to write to per-network JSON**

Inspect the current `scripts/deploy.ts` (Week 1 Task 15). Ensure it writes addresses to `deployments/<network>.json`. If not, replace with:

```typescript
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const CUSD_MAINNET = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const USDT_MAINNET = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e';
const USDC_MAINNET = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';

const CUSD_ALFAJORES = '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', await deployer.getAddress());
  console.log('Network:', network.name, 'chainId:', (await ethers.provider.getNetwork()).chainId);

  // Resolve token addresses per network
  let tokens: string[];
  if (network.name === 'celo') {
    tokens = [CUSD_MAINNET, USDT_MAINNET, USDC_MAINNET];
  } else if (network.name === 'alfajores') {
    const mockUsdt = process.env.NEXT_PUBLIC_MOCK_USDT_ALFAJORES;
    const mockUsdc = process.env.NEXT_PUBLIC_MOCK_USDC_ALFAJORES;
    if (!mockUsdt || !mockUsdc) throw new Error('Set mock token addresses in .env before deploying');
    tokens = [CUSD_ALFAJORES, mockUsdt, mockUsdc];
  } else {
    throw new Error(`Unsupported network: ${network.name}`);
  }

  const treasury = await deployer.getAddress();
  const reserve = await deployer.getAddress(); // single-wallet for MVP

  const AgentWallet = await ethers.getContractFactory('AgentWallet');
  const agent = await AgentWallet.deploy(await deployer.getAddress(), tokens);
  await agent.waitForDeployment();
  console.log('AgentWallet:', await agent.getAddress());

  const Payment = await ethers.getContractFactory('ShipPostPayment');
  const payment = await Payment.deploy(
    await agent.getAddress(),
    treasury,
    reserve,
    tokens,
  );
  await payment.waitForDeployment();
  console.log('ShipPostPayment:', await payment.getAddress());

  const out = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    network: network.name,
    AgentWallet: await agent.getAddress(),
    ShipPostPayment: await payment.getAddress(),
    deployer: await deployer.getAddress(),
    timestamp: new Date().toISOString(),
    tokens,
  };

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log('Wrote deployments/' + network.name + '.json');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Double-check gas on mainnet**

Before real deploy, estimate gas on mainnet without broadcasting:

```bash
pnpm hardhat run scripts/deploy.ts --network celo --dry-run || true
```

Hardhat may not support `--dry-run`; if that flag errors, skip. Instead, ensure deployer address has ≥0.5 CELO:

```bash
cast balance $(cast wallet address $DEPLOYER_PRIVATE_KEY) --rpc-url https://forno.celo.org
```

(If `cast` unavailable, check on https://celoscan.io/address/<deployer>.)

- [ ] **Step 3: Commit (do NOT deploy yet)**

```bash
git add scripts/deploy.ts
git commit -m "feat: deploy script supports celo mainnet"
```

---

## Task 19: Deploy to Celo mainnet

**Files:**
- (no source changes; this task produces `deployments/celo.json`)

> ⚠️ **IRREVERSIBLE**: This task spends real CELO. Double-check the deployer key and contract code before running.

- [ ] **Step 1: Confirm contracts match tested code**

```bash
git log --oneline contracts/ | head -10
pnpm test:contracts
```

Expected: 12/12 passing against the same contract source you're about to deploy.

- [ ] **Step 2: Run the mainnet deploy**

```bash
pnpm hardhat run scripts/deploy.ts --network celo
```

Expected output:

```
Deployer: 0x…
Network: celo chainId: 42220
AgentWallet: 0x…
ShipPostPayment: 0x…
Wrote deployments/celo.json
```

If a tx reverts, read the error, top up gas if needed, and rerun.

- [ ] **Step 3: Verify contracts on Celoscan**

```bash
pnpm hardhat verify --network celo <AgentWallet_address> <deployer_address> '[0x765DE816845861e75A25fCA122bb6898B8B1282a,0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e,0xcebA9300f2b948710d2653dD7B07f33A8B32118C]'

pnpm hardhat verify --network celo <ShipPostPayment_address> <AgentWallet_address> <deployer_address> <deployer_address> '[0x765DE816845861e75A25fCA122bb6898B8B1282a,0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e,0xcebA9300f2b948710d2653dD7B07f33A8B32118C]'
```

Replace addresses with the actual ones from Step 2. Quote the array exactly as shown (one line, no spaces, brackets included).

Visit https://celoscan.io/address/<ShipPostPayment_address>#code and confirm: "Contract Source Code Verified (Exact Match)".

- [ ] **Step 4: Commit deployment record**

```bash
git add deployments/celo.json
git commit -m "chore: deploy ShipPost contracts to Celo mainnet"
```

- [ ] **Step 5: Update README with mainnet addresses**

Edit the "Deployed addresses" section of `README.md` to include a mainnet row. Commit:

```bash
git add README.md
git commit -m "docs: Celo mainnet contract addresses"
```

---

## Task 20: Fund the mainnet agent wallet

**Files:**
- Create: `/Users/vanhuy/shippost/scripts/fund-agent.ts`

- [ ] **Step 1: Write the funding script**

Create `scripts/fund-agent.ts`:

```typescript
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

async function main() {
  const tokenAddr = process.env.FUND_TOKEN;
  const amountHuman = process.env.FUND_AMOUNT ?? '5';
  if (!tokenAddr) throw new Error('FUND_TOKEN env var required (token address)');

  const deployments = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network.name}.json`), 'utf8'),
  );
  const agent = deployments.AgentWallet as string;

  const [signer] = await ethers.getSigners();
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const [decimals, symbol]: [bigint, string] = await Promise.all([token.decimals(), token.symbol()]);

  const amount = ethers.parseUnits(amountHuman, Number(decimals));
  console.log(`Transferring ${amountHuman} ${symbol} to AgentWallet ${agent}…`);
  const tx = await token.transfer(agent, amount);
  const receipt = await tx.wait();
  console.log('tx:', receipt?.hash);

  const bal: bigint = await token.balanceOf(agent);
  console.log(`AgentWallet ${symbol} balance: ${ethers.formatUnits(bal, Number(decimals))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Send 5 cUSD to the mainnet AgentWallet**

```bash
FUND_TOKEN=0x765DE816845861e75A25fCA122bb6898B8B1282a FUND_AMOUNT=5 \
  pnpm hardhat run scripts/fund-agent.ts --network celo
```

Expected: tx hash printed, final balance shows `5.0`.

- [ ] **Step 2b: Add balance monitoring to the x402 proxy (RECOMMENDATION)**

After every successful `settleX402Call`, check the AgentWallet balance and log an alert if it drops below $5. Paste this helper into `lib/orchestrator.ts`:

```typescript
// Real token addresses on Celo mainnet
const MAINNET_TOKEN_DECIMALS: Record<string, number> = {
  '0x765de816845861e75a25fca122bb6898b8b1282a': 18, // cUSD
  '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e': 6,  // USDT
  '0xceba9300f2b948710d2653dd7b07f33a8b32118c': 6,  // USDC
};

export async function warnIfLowBalance(
  chainId: number,
  tokenAddress: Address,
  agentWalletAddress: Address,
): Promise<void> {
  const chain = getChain(chainId);
  const client = createPublicClient({ chain, transport: http() });
  const balance = await client.readContract({
    address: tokenAddress,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: [agentWalletAddress],
  });
  const dec = MAINNET_TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  const humanBalance = Number(balance) / 10 ** dec;
  if (humanBalance < 5) {
    // Replace with Slack/email alert in production
    console.error(`[ALERT] AgentWallet ${tokenAddress} balance LOW: $${humanBalance.toFixed(4)} — refill now`);
  }
}
```

Call `warnIfLowBalance(...)` at the end of `settleX402Call()`. This ensures every pipeline step that settles logs an alert before the next user hits an empty bucket.

- [ ] **Step 3: (Optional) Also fund with USDT / USDC**

```bash
FUND_TOKEN=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e FUND_AMOUNT=2 \
  pnpm hardhat run scripts/fund-agent.ts --network celo

FUND_TOKEN=0xcebA9300f2b948710d2653dD7B07f33A8B32118C FUND_AMOUNT=2 \
  pnpm hardhat run scripts/fund-agent.ts --network celo
```

Skip if you don't hold USDT/USDC — cUSD alone is sufficient for the Week 2 gate.

- [ ] **Step 4: Commit**

```bash
git add scripts/fund-agent.ts
git commit -m "feat: fund-agent script"
```

---

## Task 21: Update Vercel production with mainnet env

**Files:**
- (Vercel dashboard only; no code changes)

- [ ] **Step 1: Add mainnet env vars in Vercel**

In Vercel project settings → Environment Variables, add for Production + Preview:

- `NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET` = from `deployments/celo.json`
- `NEXT_PUBLIC_AGENT_WALLET_MAINNET` = from `deployments/celo.json`
- `NEXT_PUBLIC_CELO_RPC` = `https://forno.celo.org`
- `NEXT_PUBLIC_SUPABASE_URL` = from Supabase dashboard
- `SUPABASE_SERVICE_ROLE` = from Supabase dashboard (mark as secret)
- `FAL_KEY` = from fal.ai dashboard (mark as secret)

Verify existing vars are still present: `DEPLOYER_PRIVATE_KEY`, `ORCHESTRATOR_PRIVATE_KEY`, `GROQ_API_KEY`, and the Alfajores-specific ones.

- [ ] **Step 2: Trigger production deploy**

Push any doc change (e.g., README mainnet note from Task 19) to main. Confirm Vercel build succeeds and production URL (`https://shippost.vercel.app` or your custom one) is live.

- [ ] **Step 3: Smoke-test the production URL against mainnet**

In a desktop browser:
1. Switch MetaMask to Celo mainnet (add chainId 42220 if missing).
2. Open your Vercel production URL.
3. Connect wallet → confirm `WalletStatus` shows real cUSD balance.
4. Run Educational flow with a small topic → pay 0.05 cUSD → confirm tx on https://celoscan.io.
5. Confirm thread rendered + thumbnail loaded + cost transparency screen correct.

- [ ] **Step 4: Record the first mainnet thread id**

Query Supabase: open `threads` table, note the `onchain_thread_id` of this first production thread. Save the Celoscan tx link — it's the first datapoint for your Week 2 gate.

- [ ] **Step 5: Commit a note in README**

```bash
# Edit README.md and add a "Live on mainnet" section with the Celoscan tx link
git add README.md
git commit -m "docs: first mainnet thread recorded"
```

---

## Task 22: Real MiniPay smoke test on Android

**Files:**
- (no code changes; manual device verification)

- [ ] **Step 1: Install MiniPay on an Android phone**

From Play Store or https://www.opera.com/products/minipay. Create a wallet; top it up with 0.25 cUSD on Celo mainnet (buy in-app or bridge).

- [ ] **Step 2: Open the Vercel production URL inside MiniPay Discover**

MiniPay Discover → bottom URL bar → paste your Vercel URL → Open.

Expected:
- MiniPay badge (green pill from Week 1 Task 5) appears under the ShipPost title.
- Wallet auto-connects (no modal). `WalletStatus` shows your mainnet cUSD balance.

- [ ] **Step 3: Run a real thread end-to-end**

Educational mode → topic "How MiniPay makes crypto feel like M-Pesa" → audience beginner → 5 tweets → Generate for 0.05 cUSD.

MiniPay should show a single signature prompt (the `payForThread` tx). On approval:
- Progress theatre runs.
- Preview screen shows tweets + thumbnail.
- Share-to-X deep link opens the X app composer.

- [ ] **Step 4: Log observations**

Note anything broken, ugly, or slow. Common issues to check:
- Bundle size on 4G (open DevTools remote on phone if needed)
- Buttons too small / keyboard covers inputs
- SSE connection dropping inside MiniPay webview (if yes, Task 23 mitigates with polling fallback)

Create a `docs/bug-bash.md` with the observations:

```bash
# add notes (see Task 23 for format)
git add docs/bug-bash.md
git commit -m "docs: real MiniPay smoke test observations"
```

---

## Task 23: Bug bash with 5 testers

**Files:**
- Create: `/Users/vanhuy/shippost/docs/bug-bash.md`

- [ ] **Step 1: Prepare the tester message**

Pick 5 testers (Discord/Twitter DMs — 2 crypto devs, 2 non-crypto-native creators, 1 trusted friend). Give each ~$0.25 cUSD on Celo mainnet by sending directly to their wallet, or point them at https://minipay.to to get started.

Paste them this template:

```
Hey — 3-min ask. Open <Vercel URL> in MiniPay (Android) or in mobile Chrome.
Generate ONE educational thread on any crypto topic you know. Pay 0.05 cUSD.
Then reply to this DM with: (1) anything confusing, (2) anything broken,
(3) would you pay $0.05 for this every time? why / why not.
```

- [ ] **Step 2: Track feedback in `docs/bug-bash.md`**

Create `docs/bug-bash.md`:

```markdown
# Bug bash — 2026-04-24 week 2

## Testers

| # | Name | Device | OS | Browser |
|---|------|--------|----|---------|
| 1 | … | Pixel 7 | Android 14 | MiniPay |
| 2 | … | iPhone 13 | iOS 17 | Safari (not in MiniPay) |
| 3 | … | Samsung A52 | Android 13 | Chrome mobile |
| 4 | … | Xiaomi 11 | Android 13 | MiniPay |
| 5 | … | Pixel 6 | Android 14 | MiniPay |

## Observations (raw, unsorted)

### Tester 1
- `<paste>`

### Tester 2
- `<paste>`

...

## Sorted by severity

### P0 (must fix before Week 2 gate)
- …

### P1 (fix in Week 3)
- …

### P2 (nice to have)
- …
```

- [ ] **Step 3: Sit with each tester's feedback for ≥15 minutes before coding**

Resist the urge to fix anything until all 5 have reported. Patterns emerge only across multiple testers.

Update the "Sorted by severity" section once feedback arrives.

- [ ] **Step 4: Commit feedback log**

```bash
git add docs/bug-bash.md
git commit -m "docs: week 2 bug bash feedback log"
```

---

## Task 24: Fix P0 bugs + rate limiting

**Files:**
- Create: `/Users/vanhuy/shippost/lib/rateLimit.ts`
- Modify: `/Users/vanhuy/shippost/app/api/generate/stream/route.ts`
- Modify: (each P0 item from Task 23 maps to a file)

- [ ] **Step 1: Implement server-side rate limit (spec risk mitigation: spam)**

Create `lib/rateLimit.ts`:

```typescript
import { getSupabaseServer } from './supabase';

const WINDOW_HOURS = 24;
const MAX_PER_WALLET = 10;
// ⚠️ RECOMMENDATION: global cap prevents AgentWallet being drained by many wallets at once.
// 200 threads/day = $10 AgentWallet spend max, well within the $50 daily cap.
const MAX_GLOBAL_PER_DAY = 200;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reason?: 'per_wallet' | 'global_cap';
}

export async function checkRateLimit(walletAddress: string): Promise<RateLimitResult> {
  let supabase;
  try {
    supabase = getSupabaseServer();
  } catch {
    // If Supabase not configured, allow (local dev)
    return { allowed: true, remaining: MAX_PER_WALLET };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const since = todayStart.toISOString();

  // Check global daily cap first (cheaper query, fails fast if app is saturated)
  const { count: globalCount, error: globalError } = await supabase
    .from('threads')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since);

  if (!globalError && (globalCount ?? 0) >= MAX_GLOBAL_PER_DAY) {
    return { allowed: false, remaining: 0, reason: 'global_cap' };
  }

  // Per-wallet check
  const windowSince = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('threads')
    .select('*', { count: 'exact', head: true })
    .eq('wallet_address', walletAddress.toLowerCase())
    .gte('created_at', windowSince);

  if (error) {
    console.error('rateLimit query failed', error);
    return { allowed: true, remaining: MAX_PER_WALLET };
  }

  const used = count ?? 0;
  return {
    allowed: used < MAX_PER_WALLET,
    remaining: Math.max(0, MAX_PER_WALLET - used),
    reason: used >= MAX_PER_WALLET ? 'per_wallet' : undefined,
  };
}
```

- [ ] **Step 2: Enforce rate limit in SSE endpoint**

At the top of the SSE POST handler in `app/api/generate/stream/route.ts`, add:

```typescript
import { checkRateLimit } from '@/lib/rateLimit';
// …

export async function POST(req: Request) {
  const body = (await req.json()) as StreamRequest;
  if (!body.topic?.trim()) return new Response('topic required', { status: 400 });

  const rl = await checkRateLimit(body.walletAddress);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limit', message: 'Max 10 threads per wallet per 24h' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // … rest unchanged
}
```

- [ ] **Step 3: Surface the 429 in the client hook**

In `hooks/useThreadGeneration.ts`, within `start()`, handle the 429 case before reading SSE:

```typescript
if (res.status === 429) {
  const j = await res.json().catch(() => ({ message: 'Rate limit exceeded' }));
  setState((s) => ({ ...s, fatal: j.message, isDone: true }));
  return;
}
if (!res.ok || !res.body) {
  setState((s) => ({ ...s, fatal: `HTTP ${res.status}`, isDone: true }));
  return;
}
```

- [ ] **Step 4: Fix each P0 from Task 23**

For each P0 issue, produce a separate commit. Example commits (adapt to your actual P0 list):

```bash
git commit -m "fix: larger tap targets on EducationalInput buttons"
git commit -m "fix: token selector shows correct decimals on USDT"
git commit -m "fix: SSE reconnect on MiniPay webview drop"
```

- [ ] **Step 5: Run the Week 1 contract tests to confirm nothing regressed**

```bash
pnpm test:contracts
pnpm test:lib
```

Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit rate limit + push**

```bash
git add lib/rateLimit.ts app/api/generate/stream/route.ts hooks/useThreadGeneration.ts
git commit -m "feat: 10-thread/wallet/24h rate limit"
git push
```

---

## Task 25: Week 2 gate verification

**Files:**
- (manual verification + documentation)

- [ ] **Step 1: Verify Definition of Done**

Confirm each item:

- [ ] Contracts deployed + verified on Celo mainnet (green checkmark on Celoscan source code tab)
- [ ] AgentWallet holds ≥5 cUSD on mainnet
- [ ] Production Vercel URL loads on desktop + mobile
- [ ] Real MiniPay Android test succeeded (Task 22 Step 3 thread visible)
- [ ] ≥10 mainnet threads persisted in Supabase (`select count(*) from threads where chain_id = 42220`)
- [ ] ≥5 distinct `wallet_address` values (`select count(distinct wallet_address) from threads where chain_id = 42220`)
- [ ] ≥$0.50 on-chain volume (10 threads × $0.05 = $0.50 — count any additional)
- [ ] Groq AND Flux x402 settlement txs visible for at least 10 threads
- [ ] Progress theatre never stalls silently: fatal errors show a Try Again button
- [ ] Share-to-X deep link opens the X composer with the first tweet pre-filled
- [ ] Rate limit rejects the 11th thread from the same wallet within 24h

- [ ] **Step 2: Quick analytics query**

In Supabase SQL editor:

```sql
select
  count(*) as threads,
  count(distinct wallet_address) as wallets,
  count(*) filter (where groq_tx_hash is not null) as groq_settled,
  count(*) filter (where flux_tx_hash is not null) as flux_settled
from threads
where chain_id = 42220;
```

Record the output in `docs/bug-bash.md` under a new `## Week 2 gate numbers` section.

- [ ] **Step 3: Tag + push**

If all above pass:

```bash
git tag -a week2-complete -m "Week 2: Mode A shipped on mainnet"
git push origin week2-complete
```

- [ ] **Step 4: Update README status block**

Edit `README.md` status block to:

```markdown
## Status

🚢 **Week 2 of 4 — Mode A shipped on mainnet**

- ✅ Smart contracts deployed + verified on Celo mainnet
- ✅ Real MiniPay integration tested on Android
- ✅ Mode A with Groq + Flux x402 pipeline
- ✅ Live progress theatre + thread editor + Share-to-X
- ✅ ≥10 mainnet threads, ≥5 unique wallets (see live analytics)
- ⏭️ Week 3: Mode B (Hot Take), history screen, public analytics, mobile polish
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: Week 2 gate complete"
git push
```

---

## Week 2 Completion

When this plan is fully executed:

1. ShipPost is live on Celo mainnet with a production URL usable in real MiniPay.
2. Mode A ships the full loop: pay → Groq thread → Flux thumbnail → edit → Share to X → cost transparency.
3. Thread history is persisted in Supabase with full tx provenance.
4. ≥10 real paid threads from ≥5 distinct wallets, ≥$0.50 on-chain volume.
5. Rate limiting + Pausable contracts give you a kill switch for abuse.
6. Week 3 plan can safely extend the pipeline with Serper + Groq fact-check without touching the Mode A path.
