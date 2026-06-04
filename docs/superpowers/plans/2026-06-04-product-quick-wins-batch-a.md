# Product Quick-Wins (Batch A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add share attribution to the auto-posted tweet, surface an aggregate agent-spend dashboard on `/stats` with Mode B promoted to hero, and correct two documentation inaccuracies.

**Architecture:** Extract the two pieces of real logic (share-text composition, agent-spend aggregation) into pure, unit-tested modules under `lib/`; keep the React/route changes as thin wiring. Dashboard data comes from the existing `threads` table via the existing analytics endpoint — no new table, no on-chain indexer. Docs changes are text-only.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Vitest (logic-only; no jsdom configured), Supabase service-role reads, wagmi/viem.

**Spec:** `docs/superpowers/specs/2026-06-04-product-quick-wins-design.md`

Note: Vitest has **no jsdom environment** in this repo — all existing tests are pure-logic. Therefore component changes (ShareToX wiring, ModePicker, stats page) are verified via `pnpm lint` + `pnpm build` + manual check, and only the extracted pure functions get unit tests.

---

## Task 1: Share-text builder (pure logic)

**Files:**
- Create: `lib/shareText.ts`
- Test: `lib/shareText.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

Create `lib/shareText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildShareText } from './shareText';

const URL = 'https://shippost.app';

describe('buildShareText', () => {
  it('appends the full attribution when there is room', () => {
    const out = buildShareText('gm', { attribution: true, appUrl: URL });
    expect(out).toBe(`gm\n\n✍️ made with ShipPost — ${URL}`);
  });

  it('returns the tweet unchanged when attribution is off', () => {
    const out = buildShareText('gm', { attribution: false, appUrl: URL });
    expect(out).toBe('gm');
  });

  it('falls back to the short form when the full form would overflow 280', () => {
    const shortSuffixLen = `\n\nvia ShipPost ${URL}`.length;
    const tweet = 'a'.repeat(280 - shortSuffixLen); // tweet + short == exactly 280
    expect((tweet + `\n\n✍️ made with ShipPost — ${URL}`).length).toBeGreaterThan(280);
    const out = buildShareText(tweet, { attribution: true, appUrl: URL });
    expect(out).toBe(`${tweet}\n\nvia ShipPost ${URL}`);
    expect(out.length).toBeLessThanOrEqual(280);
  });

  it('omits attribution entirely when even the short form overflows', () => {
    const tweet = 'a'.repeat(280);
    const out = buildShareText(tweet, { attribution: true, appUrl: URL });
    expect(out).toBe(tweet);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/shareText.test.ts`
Expected: FAIL — `Failed to resolve import "./shareText"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/shareText.ts`:

```ts
// Builds the text posted to X for the FIRST tweet, optionally appending a
// ShipPost attribution. Attribution is added ONLY here (at share time), never
// to the user's editable tweets. The 280-char cap is approximated with string
// length: X actually weighs any URL as 23 chars (t.co) and the ✍️ emoji as 2,
// so `.length` over-counts the URL — that is safe, because the only effect of
// over-counting is dropping the attribution, never truncating the user's text.
const DEFAULT_APP_URL = 'https://shippost.app';
const TWEET_MAX = 280;

export function shareAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL;
}

export function buildShareText(
  firstTweet: string,
  opts: { attribution: boolean; appUrl?: string },
): string {
  if (!opts.attribution) return firstTweet;
  const url = opts.appUrl ?? shareAppUrl();
  const full = `${firstTweet}\n\n✍️ made with ShipPost — ${url}`;
  if (full.length <= TWEET_MAX) return full;
  const short = `${firstTweet}\n\nvia ShipPost ${url}`;
  if (short.length <= TWEET_MAX) return short;
  return firstTweet;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/shareText.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Add the env var**

In `.env.example`, add this line directly after the `NEXT_PUBLIC_TARGET_CHAIN_ID=...` line (around line 8):

```
NEXT_PUBLIC_APP_URL=https://shippost.app
```

- [ ] **Step 6: Commit**

```bash
git add lib/shareText.ts lib/shareText.test.ts .env.example
git commit -m "feat(share): add attribution-aware share-text builder"
```

---

## Task 2: Wire ShareToX to the builder + attribution toggle

**Files:**
- Modify: `components/ShareToX.tsx`

- [ ] **Step 1: Import the builder and add toggle state**

In `components/ShareToX.tsx`, add the import after the existing `haptic` import (line 7):

```ts
import { buildShareText } from '@/lib/shareText';
```

Inside `export function ShareToX`, add state next to the existing `copied` state (after line 41 `const [copyError, setCopyError] = useState<string | null>(null);`):

```ts
  const [credit, setCredit] = useState(true);
```

- [ ] **Step 2: Use the builder when posting**

Replace the post button (lines 67-69):

```tsx
      <Button onClick={() => postFirstTweet(first)}>
        Post first tweet in X →
      </Button>
```

with:

```tsx
      <Button onClick={() => postFirstTweet(buildShareText(first, { attribution: credit }))}>
        Post first tweet in X →
      </Button>

      <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={credit}
          onChange={(e) => setCredit(e.target.checked)}
          className="accent-[hsl(var(--ink-deep))]"
        />
        Add a small “made with ShipPost” credit to the first tweet
      </label>
```

- [ ] **Step 3: Verify build + lint**

Run: `pnpm lint && pnpm build`
Expected: no errors. (Manual check: the checkbox renders, defaults checked, and toggling it changes whether the posted text ends with the attribution.)

- [ ] **Step 4: Commit**

```bash
git add components/ShareToX.tsx
git commit -m "feat(share): append ShipPost attribution to first tweet with opt-out toggle"
```

---

## Task 3: Agent-spend aggregator (pure logic)

**Files:**
- Create: `lib/agentSpend.ts`
- Test: `lib/agentSpend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/agentSpend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateAgentSpend, type ThreadCostRow } from './agentSpend';

function row(p: Partial<ThreadCostRow>): ThreadCostRow {
  return {
    total_cost_usd: null,
    groq_tx_hash: null,
    serper_tx_hash: null,
    coingecko_tx_hash: null,
    fact_check_tx_hash: null,
    token_symbol: 'cUSD',
    ...p,
  };
}

describe('aggregateAgentSpend', () => {
  it('sums total_cost_usd and counts every non-null x402 tx hash', () => {
    const out = aggregateAgentSpend([
      row({ total_cost_usd: '0.001', groq_tx_hash: '0xa' }),
      row({
        total_cost_usd: '0.003',
        groq_tx_hash: '0xb',
        serper_tx_hash: '0xc',
        coingecko_tx_hash: '0xd',
        fact_check_tx_hash: '0xe',
      }),
    ]);
    expect(out.agentSpendUsd).toBe('0.0040');
    expect(out.x402CallCount).toBe(5);
  });

  it('counts coingecko settlements (regression: route previously omitted them)', () => {
    const out = aggregateAgentSpend([row({ coingecko_tx_hash: '0xfeed' })]);
    expect(out.x402CallCount).toBe(1);
  });

  it('treats null/garbage total_cost_usd as zero', () => {
    const out = aggregateAgentSpend([
      row({ total_cost_usd: null }),
      row({ total_cost_usd: 'not-a-number' }),
    ]);
    expect(out.agentSpendUsd).toBe('0.0000');
  });

  it('groups spend and thread counts by token, busiest first', () => {
    const out = aggregateAgentSpend([
      row({ token_symbol: 'cUSD', total_cost_usd: '0.001' }),
      row({ token_symbol: 'USDC', total_cost_usd: '0.002' }),
      row({ token_symbol: 'cUSD', total_cost_usd: '0.001' }),
    ]);
    expect(out.byToken).toEqual([
      { token: 'cUSD', threads: 2, spendUsd: '0.0020' },
      { token: 'USDC', threads: 1, spendUsd: '0.0020' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/agentSpend.test.ts`
Expected: FAIL — `Failed to resolve import "./agentSpend"`.

- [ ] **Step 3: Write the implementation**

Create `lib/agentSpend.ts`:

```ts
// Aggregates per-thread agent x402 spend for the public stats page. Pure:
// takes completed-thread rows and returns display-ready totals. `total_cost_usd`
// is stored as a string; non-numeric/null is treated as 0 so a bad row never
// poisons the total. Each non-null *_tx_hash is one settled x402 call.
export interface ThreadCostRow {
  total_cost_usd: string | null;
  groq_tx_hash: string | null;
  serper_tx_hash: string | null;
  coingecko_tx_hash: string | null;
  fact_check_tx_hash: string | null;
  token_symbol: string;
}

export interface TokenSpend {
  token: string;
  threads: number;
  spendUsd: string;
}

export interface AgentSpendAggregate {
  agentSpendUsd: string;
  x402CallCount: number;
  byToken: TokenSpend[];
}

export function aggregateAgentSpend(rows: ThreadCostRow[]): AgentSpendAggregate {
  let totalSpend = 0;
  let calls = 0;
  const tokenMap = new Map<string, { threads: number; spend: number }>();

  for (const r of rows) {
    const parsed = r.total_cost_usd ? Number(r.total_cost_usd) : 0;
    const spend = Number.isFinite(parsed) ? parsed : 0;
    totalSpend += spend;
    calls +=
      (r.groq_tx_hash ? 1 : 0) +
      (r.serper_tx_hash ? 1 : 0) +
      (r.coingecko_tx_hash ? 1 : 0) +
      (r.fact_check_tx_hash ? 1 : 0);
    const t = tokenMap.get(r.token_symbol) ?? { threads: 0, spend: 0 };
    t.threads += 1;
    t.spend += spend;
    tokenMap.set(r.token_symbol, t);
  }

  const byToken = Array.from(tokenMap.entries())
    .map(([token, v]) => ({ token, threads: v.threads, spendUsd: v.spend.toFixed(4) }))
    .sort((a, b) => b.threads - a.threads);

  return {
    agentSpendUsd: totalSpend.toFixed(4),
    x402CallCount: calls,
    byToken,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/agentSpend.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add lib/agentSpend.ts lib/agentSpend.test.ts
git commit -m "feat(stats): add pure agent-spend aggregator (includes coingecko)"
```

---

## Task 4: Extend the analytics endpoint to return agent spend

**Files:**
- Modify: `app/api/public/analytics/route.ts`

- [ ] **Step 1: Import the aggregator**

In `app/api/public/analytics/route.ts`, add after the existing `getSupabaseServer` import (line 2):

```ts
import { aggregateAgentSpend } from '@/lib/agentSpend';
```

- [ ] **Step 2: Replace the x402 query + manual count with the aggregator**

Replace this block (current lines 35-48):

```ts
    const { data: x402 } = await supabase
      .from('threads')
      .select('groq_tx_hash,serper_tx_hash,fact_check_tx_hash')
      .eq('chain_id', chainId)
      .eq('status', 'completed');

    const x402Count = (x402 ?? []).reduce(
      (acc, r) =>
        acc +
        (r.groq_tx_hash ? 1 : 0) +
        (r.serper_tx_hash ? 1 : 0) +
        (r.fact_check_tx_hash ? 1 : 0),
      0,
    );
```

with:

```ts
    const { data: costRows } = await supabase
      .from('threads')
      .select(
        'total_cost_usd,groq_tx_hash,serper_tx_hash,coingecko_tx_hash,fact_check_tx_hash,token_symbol',
      )
      .eq('chain_id', chainId)
      .eq('status', 'completed');

    const agent = aggregateAgentSpend(costRows ?? []);
```

- [ ] **Step 3: Add the new fields to the JSON response**

Replace the `return NextResponse.json({...})` block (current lines 52-58):

```ts
    return NextResponse.json({
      threads: threads ?? 0,
      uniqueWallets: walletCounts.size,
      volumeUsd: volumeUsd.toFixed(2),
      x402Count,
      repeatUsers,
    });
```

with:

```ts
    return NextResponse.json({
      threads: threads ?? 0,
      uniqueWallets: walletCounts.size,
      volumeUsd: volumeUsd.toFixed(2),
      x402Count: agent.x402CallCount,
      agentSpendUsd: agent.agentSpendUsd,
      byToken: agent.byToken,
      repeatUsers,
    });
```

- [ ] **Step 4: Verify build**

Run: `pnpm lint && pnpm build`
Expected: no errors. (The route still type-checks; `costRows` shape matches `ThreadCostRow`.)

- [ ] **Step 5: Commit**

```bash
git add app/api/public/analytics/route.ts
git commit -m "feat(stats): return agentSpendUsd + byToken from analytics endpoint"
```

---

## Task 5: Render the agent-economy metrics on /stats

**Files:**
- Modify: `app/stats/page.tsx`

- [ ] **Step 1: Import the contracts helper**

In `app/stats/page.tsx`, add after the `explorerBase` import (line 11):

```ts
import { getContracts } from '@/lib/contracts';
```

- [ ] **Step 2: Add the new field to the Stats interface**

Replace the `Stats` interface (current lines 13-19):

```ts
interface Stats {
  threads: number;
  uniqueWallets: number;
  volumeUsd: string;
  x402Count: number;
  repeatUsers: number;
}
```

with:

```ts
interface Stats {
  threads: number;
  uniqueWallets: number;
  volumeUsd: string;
  x402Count: number;
  agentSpendUsd: string;
  repeatUsers: number;
}
```

- [ ] **Step 3: Render the agent-spend metric + Celoscan audit link**

Replace the entire `{stats && ( ... )}` Card block (current lines 126-149):

```tsx
        {stats && (
          <Card ornament className="relative p-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              {/* Vertical ledger rule — separates the 2-col area; stops above
                  the bottom row which spans full width. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-5 bottom-[4.25rem] left-1/2 w-px bg-[hsl(var(--ink-faded)/0.3)]"
              />
              <Metric label="threads composed" value={stats.threads} />
              <Metric label="unique scribes" value={stats.uniqueWallets} />
              <Metric label="volume on chain" value={`$${stats.volumeUsd}`} />
              <Metric label="x402 settlements" value={stats.x402Count} />
              <div className="col-span-2 pt-3 border-t border-[hsl(var(--ink-faded)/0.3)]">
                <Metric label="repeat scribes" value={stats.repeatUsers} />
              </div>
            </div>
          </Card>
        )}
```

with:

```tsx
        {stats && (
          <Card ornament className="relative p-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              {/* Vertical ledger rule — separates the 2-col grid; stops above
                  the audit link footer. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-5 bottom-[3.5rem] left-1/2 w-px bg-[hsl(var(--ink-faded)/0.3)]"
              />
              <Metric label="threads composed" value={stats.threads} />
              <Metric label="unique scribes" value={stats.uniqueWallets} />
              <Metric label="volume on chain" value={`$${stats.volumeUsd}`} />
              <Metric label="x402 settlements" value={stats.x402Count} />
              <Metric label="agent x402 spend" value={`$${stats.agentSpendUsd}`} />
              <Metric label="repeat scribes" value={stats.repeatUsers} />
            </div>
            <a
              href={`${explorer}/address/${getContracts(chainId).AgentWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1 heading-sub text-[10px] no-underline hover:text-primary transition-colors"
            >
              Audit the agent wallet on-chain
              <ArrowRight size={11} aria-hidden />
            </a>
          </Card>
        )}
```

- [ ] **Step 4: Verify build + lint + manual render**

Run: `pnpm lint && pnpm build`
Expected: no errors. Manual: `/stats` shows six metrics including "agent x402 spend" and an "Audit the agent wallet on-chain" link that points to `<celoscan>/address/<AgentWallet>`. Confirm the vertical rule still lines up; if it looks off, nudge the `bottom-[3.5rem]` value.

- [ ] **Step 5: Commit**

```bash
git add app/stats/page.tsx
git commit -m "feat(stats): show agent x402 spend + on-chain audit link"
```

---

## Task 6: Promote Mode B (Hot Take) to hero in the picker

**Files:**
- Modify: `components/ModePicker.tsx`

- [ ] **Step 1: Add an optional badge to the Mode type**

In `components/ModePicker.tsx`, replace the `Mode` interface (current lines 15-22):

```ts
interface Mode {
  id: 'educational' | 'hot-take';
  numeral: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  blurb: string;
  cost: string;
}
```

with:

```ts
interface Mode {
  id: 'educational' | 'hot-take';
  numeral: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  blurb: string;
  cost: string;
  badge?: string;
}
```

- [ ] **Step 2: Reorder so Hot Take is first, and badge it**

Replace the `MODES` array (current lines 24-41):

```ts
const MODES: Mode[] = [
  {
    id: 'educational',
    numeral: 'I',
    label: 'Educational Thread',
    Icon: IllumGraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001',
  },
  {
    id: 'hot-take',
    numeral: 'II',
    label: 'Hot Take',
    Icon: IllumFlame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003',
  },
];
```

with:

```ts
const MODES: Mode[] = [
  {
    id: 'hot-take',
    numeral: 'I',
    label: 'Hot Take',
    Icon: IllumFlame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · fact-checked · live data',
  },
  {
    id: 'educational',
    numeral: 'II',
    label: 'Educational Thread',
    Icon: IllumGraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001',
  },
];
```

- [ ] **Step 3: Render the badge under the label**

Replace this fragment (current lines 95-102):

```tsx
                  <div>
                    <h3 className="font-display italic text-xl leading-tight">
                      {m.label}
                    </h3>
                    <p className="text-sm text-muted-foreground italic mt-1 leading-snug">
                      {m.blurb}
                    </p>
                  </div>
```

with:

```tsx
                  <div>
                    <h3 className="font-display italic text-xl leading-tight">
                      {m.label}
                    </h3>
                    {m.badge && (
                      <span className="mt-1 inline-block rounded-full border border-[hsl(var(--ink-faded)/0.4)] px-2 py-0.5 text-[9px] uppercase tracking-wide text-[hsl(var(--ink-faded))]">
                        {m.badge}
                      </span>
                    )}
                    <p className="text-sm text-muted-foreground italic mt-1 leading-snug">
                      {m.blurb}
                    </p>
                  </div>
```

- [ ] **Step 4: Verify build + lint + manual render**

Run: `pnpm lint && pnpm build`
Expected: no errors. Manual: on `/`, the **Hot Take** card is first (numeral I) with the badge "grounded · fact-checked · live data"; Educational is second (numeral II). Tapping each still routes to the correct input screen (`onSelect('hot-take')` / `onSelect('educational')`).

- [ ] **Step 5: Commit**

```bash
git add components/ModePicker.tsx
git commit -m "feat(modes): promote Hot Take to hero with grounded/fact-checked badge"
```

---

## Task 7: Fix the agent-cap value in docs

The on-chain truth: AgentWallet daily cap is **$10/token/day on mainnet** (`scripts/deploy-mainnet.ts`) and **$50 on testnet** (`scripts/deploy.ts`). The four docs below say `$50`. (`README.md` already says `$10` — leave it.)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/docs/architecture.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: CLAUDE.md**

Replace `enforce the AgentWallet $50/token/day cap in `executeX402Call`` with:
`enforce the AgentWallet $10/token/day (mainnet; $50 testnet) cap in `executeX402Call``

- [ ] **Step 2: .claude/docs/architecture.md**

Replace ``executeX402Call` enforces $50/token/day cap` with:
``executeX402Call` enforces the $10/token/day cap (mainnet; $50 testnet)`

- [ ] **Step 3: docs/ARCHITECTURE.md — three spots**

Replace `kèm **daily spend cap** $50/token/ngày.` with:
`kèm **daily spend cap** $10/token/ngày (mainnet; $50 testnet).`

Replace `rút tối đa $50/token/ngày.` with:
`rút tối đa $10/token/ngày (mainnet; $50 testnet).`

Replace `mặc định ~$50.` with:
`mặc định $10 trên mainnet ($50 testnet).`

- [ ] **Step 4: Verify no stale $50 cap remains**

Run: `grep -rnE '\$50/token|cap.*\$50|\$50.*cap' CLAUDE.md .claude/docs/architecture.md docs/ARCHITECTURE.md`
Expected: every remaining hit also names $10/mainnet (i.e. the "($50 testnet)" qualifier), no bare "$50/token/day cap".

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .claude/docs/architecture.md docs/ARCHITECTURE.md
git commit -m "docs: correct agent daily cap to \$10 mainnet (\$50 testnet)"
```

---

## Task 8: Fix the stale x402-proxy architecture in README

`README.md` still describes the removed unauthenticated `/api/x402/*` proxy routes (deleted in `8f4c222`) and is internally inconsistent about `/api/x402/groq`. Align it with `docs/ARCHITECTURE.md` §2.3.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Fix the component view's pipeline children**

Replace this block (the `/api/generate/stream` children in the "Component view", current lines 97-101):

```
           └─ /api/generate/stream (SSE)
                  ├─ /api/x402/groq        ← proxies Groq, settles via AgentWallet
                  ├─ /api/x402/serper      ← proxies Serper search
                  ├─ /api/x402/coingecko   ← proxies CoinGecko price
                  └─ /api/x402/fact-check  ← Groq fact verification pass
```

with:

```
           └─ /api/generate/stream (SSE)
                  └─ in-process pipeline: groq · serper · coingecko · fact-check
                     steps — each settles via AgentWallet (Model 1, no HTTP route)
```

- [ ] **Step 2: Rewrite the "x402 proxy" section**

Replace the entire `### x402 proxy` section (current lines 109-113):

```
### x402 proxy

Groq, Serper, and CoinGecko don't support x402 natively. Each `/api/x402/*` route verifies the payment intent, calls the real API with our backend keys, then settles by pulling stablecoin from AgentWallet.

**Real x402 on Base mainnet:** the Groq step settles real USDC through the Coinbase CDP facilitator — proven live on Base mainnet ([tx `0x7b71d5f7…92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1)). MiniPay user payments still settle on Celo via the legacy path. See [docs/x402-mainnet-proof.md](docs/x402-mainnet-proof.md).
```

with:

```
### x402 settlement — two models

**Model 1 — per-thread generate (Celo).** Groq, Serper, and CoinGecko don't support x402 natively, so each pipeline step *simulates* x402 in-process by pulling stablecoin from AgentWallet via `settleX402Call`. There are **no public `/api/x402/*` proxy routes** for these — the earlier unauthenticated proxies were removed in `8f4c222` (free-drain risk).

**Model 2 — `/api/x402/groq` (Base).** A genuine x402 endpoint: the *caller* pays *us* in USDC through the Coinbase CDP facilitator, settling to the treasury. It does **not** touch AgentWallet. Proven live on Base mainnet ([tx `0x7b71d5f7…92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1)). See [docs/x402-mainnet-proof.md](docs/x402-mainnet-proof.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §2.3.
```

- [ ] **Step 3: Verify the removed routes are gone from README**

Run: `grep -nE '/api/x402/(serper|coingecko|fact-check)' README.md`
Expected: no matches (those proxy routes no longer referenced).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): replace removed x402 proxy description with the two-model reality"
```

---

## Final verification

- [ ] **Run the full logic test suite**

Run: `pnpm test:lib`
Expected: all pass, including the new `lib/shareText.test.ts` and `lib/agentSpend.test.ts`.

- [ ] **Build once more**

Run: `pnpm lint && pnpm build`
Expected: clean.

---

## Self-review notes (spec coverage)

- Task 2 (attribution) → Tasks 1+2. ✓ (suffix forms, 280 guard, toggle default-on, `NEXT_PUBLIC_APP_URL` with fallback)
- Task 4 (dashboard + Mode B hero) → Tasks 3+4+5 (aggregate `agentSpendUsd`/`x402CallCount`/`byToken`, /stats render, Celoscan link) + Task 6 (hero Mode B). ✓ `byToken` is returned by the endpoint; rendering it is out of scope for v1 (aggregate metrics only) — kept available for later without a schema change.
- Task 5 (docs) → Tasks 7 (cap) + 8 (README architecture). ✓
- Dropped/deferred: Task 1 (allowance) and Task 3 (paywall) are not in this plan, per spec.
