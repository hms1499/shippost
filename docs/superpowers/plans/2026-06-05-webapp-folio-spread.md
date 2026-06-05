# Webapp Folio Spread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ShipPost a desktop two-page "folio spread" layout (left = the brief, right = the result) while keeping the MiniPay/mobile single-column flow unchanged.

**Architecture:** Presentation-only. Keep the existing `screen` state machine in `HomeClient.tsx` as the single source of truth. Compute one pair of JSX nodes (`formNode` / `resultNode`) from the current screen, then a responsive branch places them: one column on mobile/MiniPay, a two-page spread on desktop web. No changes to `usePayForThread`, `useThreadGeneration`, refunds, or any `/api` route.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, framer-motion, Vitest (node env — repo has **no** React Testing Library, so component tests are not added; logic is unit-tested and components are verified via build/lint/manual, matching the existing convention where visual components like `ModePicker`/`WalletStatus` have no tests).

Spec: `docs/superpowers/specs/2026-06-05-webapp-folio-spread-design.md`

---

## File structure

- `lib/screens.ts` (new) — `Screen` type + `isInputScreen`/`isOutputScreen`. Owns screen categorisation. Tested.
- `lib/useIsDesktop.ts` (new) — pure `matchesDesktop()` + `useIsDesktop()` hook. `matchesDesktop()` tested.
- `components/RightLeafPlaceholder.tsx` (new) — decorative blank right-page filler for INPUT states. Presentational.
- `components/ComposeSummary.tsx` (new) — read-only brief card shown on the left page during OUTPUT states. Presentational.
- `components/FolioSpread.tsx` (new) — two-page grid layout wrapper with the central spine. Presentational.
- `app/HomeClient.tsx` (modify) — import `Screen` from `lib/screens`, add the responsive layout branch using the new components. No logic changes.

---

## Task 1: Screen categorisation helper

**Files:**
- Create: `lib/screens.ts`
- Test: `lib/screens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/screens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isInputScreen, isOutputScreen, type Screen } from './screens';

const ALL: Screen[] = [
  'mode',
  'educational',
  'hot-take',
  'preview-locked',
  'generating',
  'preview',
  'post-share',
];

describe('isInputScreen', () => {
  it('is true only for the three input screens', () => {
    expect(ALL.filter(isInputScreen)).toEqual(['mode', 'educational', 'hot-take']);
  });
});

describe('isOutputScreen', () => {
  it('is the exact complement of isInputScreen', () => {
    expect(ALL.filter(isOutputScreen)).toEqual([
      'preview-locked',
      'generating',
      'preview',
      'post-share',
    ]);
  });

  it('every screen is exactly one of input or output', () => {
    for (const s of ALL) {
      expect(isInputScreen(s)).toBe(!isOutputScreen(s));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:lib -- lib/screens.test.ts`
Expected: FAIL — cannot resolve `./screens`.

- [ ] **Step 3: Write the implementation**

Create `lib/screens.ts`:

```ts
export type Screen =
  | 'mode'
  | 'educational'
  | 'hot-take'
  | 'preview-locked'
  | 'generating'
  | 'preview'
  | 'post-share';

const INPUT_SCREENS = ['mode', 'educational', 'hot-take'] as const;

export function isInputScreen(screen: Screen): boolean {
  return (INPUT_SCREENS as readonly string[]).includes(screen);
}

export function isOutputScreen(screen: Screen): boolean {
  return !isInputScreen(screen);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:lib -- lib/screens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/screens.ts lib/screens.test.ts
git commit -m "feat(layout): add screen categorisation helper"
```

---

## Task 2: Desktop breakpoint hook

**Files:**
- Create: `lib/useIsDesktop.ts`
- Test: `lib/useIsDesktop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/useIsDesktop.test.ts` (mirrors the `vi.stubGlobal` pattern in `lib/useBodyScrollLock.test.ts`):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { matchesDesktop } from './useIsDesktop';

afterEach(() => vi.unstubAllGlobals());

describe('matchesDesktop', () => {
  it('returns false during SSR (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(matchesDesktop()).toBe(false);
  });

  it('returns false when matchMedia is unavailable', () => {
    vi.stubGlobal('window', {});
    expect(matchesDesktop()).toBe(false);
  });

  it('returns true when the min-width query matches', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(min-width: 1024px)' }),
    });
    expect(matchesDesktop()).toBe(true);
  });

  it('returns false when the query does not match', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(matchesDesktop()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:lib -- lib/useIsDesktop.test.ts`
Expected: FAIL — cannot resolve `./useIsDesktop`.

- [ ] **Step 3: Write the implementation**

Create `lib/useIsDesktop.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px)';

/** SSR-safe synchronous read of the desktop breakpoint. */
export function matchesDesktop(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * Tracks whether the viewport is at the desktop breakpoint (>=1024px).
 * Returns false until mounted, matching the `mounted` flash pattern in
 * HomeClient so SSR and first paint render the mobile single column.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:lib -- lib/useIsDesktop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/useIsDesktop.ts lib/useIsDesktop.test.ts
git commit -m "feat(layout): add useIsDesktop breakpoint hook"
```

---

## Task 3: RightLeafPlaceholder component

**Files:**
- Create: `components/RightLeafPlaceholder.tsx`

No unit test (presentational, no logic — matches repo convention). Verified by `pnpm build`.

- [ ] **Step 1: Write the component**

Create `components/RightLeafPlaceholder.tsx`:

```tsx
'use client';

/**
 * Fills the right page of the desktop folio spread while the user is still on
 * an INPUT screen, so the spread is never lopsided. Decorative only; parchment
 * aesthetic (faint folio numeral + an italic invitation line).
 */
export function RightLeafPlaceholder() {
  return (
    <div className="w-full max-w-md min-h-[20rem] flex flex-col items-center justify-center gap-4 text-center select-none">
      <span
        aria-hidden
        className="font-display italic text-[7rem] leading-none text-[hsl(var(--ink-faded))] opacity-[0.15]"
      >
        0
      </span>
      <p className="font-display italic text-base text-muted-foreground max-w-[15rem] leading-snug">
        The right leaf awaits ink — compose on the left, and the agent fills this
        page.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: build succeeds (component is not yet imported anywhere — Next will tree-shake it; the goal is a clean typecheck/compile).

- [ ] **Step 3: Commit**

```bash
git add components/RightLeafPlaceholder.tsx
git commit -m "feat(layout): add RightLeafPlaceholder for folio spread"
```

---

## Task 4: ComposeSummary component

**Files:**
- Create: `components/ComposeSummary.tsx`

No unit test (presentational). Verified by `pnpm build`. Note the numeral mapping: in `ModePicker`, Hot Take is "I" and Educational is "II" — `mode === 0` is Educational ("II"), `mode === 1` is Hot Take ("I").

- [ ] **Step 1: Write the component**

Create `components/ComposeSummary.tsx`:

```tsx
'use client';

import { Card } from '@/components/ui/card';
import { InkDivider } from './InkDivider';

interface ComposeSummaryProps {
  mode: 0 | 1;
  tokenSymbol: string;
  topic?: string;
  audience?: string;
  eventDescription?: string;
  angle?: string;
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Read-only "brief" shown on the left page of the desktop spread once the user
 * has submitted, replacing the input form so the left page is never empty.
 * Left = what you asked; the right page shows what the agent forged.
 */
export function ComposeSummary({
  mode,
  tokenSymbol,
  topic,
  audience,
  eventDescription,
  angle,
}: ComposeSummaryProps) {
  const numeral = mode === 0 ? 'II' : 'I';
  const label = mode === 0 ? 'Educational' : 'Hot Take';

  return (
    <Card className="w-full max-w-md p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="heading-sub text-[10px]">Your brief</p>
        <span
          aria-hidden
          className="font-display italic text-2xl leading-none text-[hsl(var(--ink-faded))]"
        >
          {numeral}
        </span>
      </div>
      <h3 className="font-display italic text-xl leading-tight">{label}</h3>
      <InkDivider />
      <dl className="flex flex-col gap-2 text-sm">
        {mode === 0 ? (
          <>
            <Field label="Topic" value={topic ?? ''} />
            <Field label="Audience" value={cap(audience ?? '')} />
          </>
        ) : (
          <>
            <Field label="Event" value={eventDescription ?? ''} />
            <Field label="Angle" value={cap(angle ?? '')} />
          </>
        )}
        <Field label="Paid in" value={tokenSymbol} />
      </dl>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="heading-sub text-[9px] text-[hsl(var(--ink-faded))]">
        {label}
      </dt>
      <dd className="text-foreground italic leading-snug">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/ComposeSummary.tsx
git commit -m "feat(layout): add ComposeSummary brief card"
```

---

## Task 5: FolioSpread layout wrapper

**Files:**
- Create: `components/FolioSpread.tsx`

No unit test (presentational). Verified by `pnpm build`.

- [ ] **Step 1: Write the component**

Create `components/FolioSpread.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ScreenTransition } from './motion/ScreenTransition';

interface FolioSpreadProps {
  leftKey: string;
  rightKey: string;
  left: ReactNode;
  right: ReactNode;
}

/**
 * Desktop-only open-codex layout: two ~max-w-md pages separated by a vertical
 * "spine" rule, centered within max-w-4xl. Each page cross-fades its own
 * content via an independent AnimatePresence keyed by leftKey/rightKey.
 */
export function FolioSpread({ leftKey, rightKey, left, right }: FolioSpreadProps) {
  return (
    <div className="w-full max-w-4xl grid grid-cols-2">
      <div className="pr-10 flex justify-end">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <ScreenTransition key={leftKey}>{left}</ScreenTransition>
          </AnimatePresence>
        </div>
      </div>
      <div className="pl-10 border-l border-[hsl(var(--ink-faded)/0.4)] flex justify-start">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <ScreenTransition key={rightKey}>{right}</ScreenTransition>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/FolioSpread.tsx
git commit -m "feat(layout): add FolioSpread two-page wrapper"
```

---

## Task 6: Wire the responsive layout into HomeClient

This is the only change to the sensitive file. It is presentation-only: extract the existing screen JSX into `formNode`/`resultNode`/`errorSurfaces`/`composeSummary` consts, then branch between the current single column and the new spread. No logic, props, or effect changes.

**Files:**
- Modify: `app/HomeClient.tsx`

- [ ] **Step 1: Replace the inline `Screen` type with the shared import**

In `app/HomeClient.tsx`, delete this line (currently ~line 75):

```ts
type Screen = 'mode' | 'educational' | 'hot-take' | 'preview-locked' | 'generating' | 'preview' | 'post-share';
```

Add to the import block near the other `@/lib` imports (e.g. next to `import { fetchPreview } from '@/lib/previewClient';`):

```ts
import { type Screen, isInputScreen, isOutputScreen } from '@/lib/screens';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { FolioSpread } from '@/components/FolioSpread';
import { ComposeSummary } from '@/components/ComposeSummary';
import { RightLeafPlaceholder } from '@/components/RightLeafPlaceholder';
```

- [ ] **Step 2: Add the layout state**

Immediately after the existing line `const isMiniPay = useIsMiniPay();` add:

```ts
  const isDesktop = useIsDesktop();
  const spread = !isMiniPay && isDesktop;
```

- [ ] **Step 3: Build the shared nodes before `return (`**

Just above the `return (` of the component (after the `beginFlow`/`unlock` callbacks and the `capHit`/`degradedSteps` consts), add the following. The JSX inside is moved verbatim from the current connected branch — same props, same handlers.

```tsx
  const formNode =
    screen === 'mode' ? (
      <ModePicker
        onSelect={(m) => {
          if (m === 'educational') setScreen('educational');
          if (m === 'hot-take') setScreen('hot-take');
        }}
      />
    ) : screen === 'educational' ? (
      <EducationalInput
        onSubmit={async (p) => {
          setSubmitted(p);
          setHotTake(null);
          await beginFlow(p, 0);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
      />
    ) : screen === 'hot-take' ? (
      <HotTakeInput
        onSubmit={async (p) => {
          setHotTake(p);
          setSubmitted(null);
          await beginFlow(p, 1);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
      />
    ) : null;

  const resultNode =
    screen === 'preview-locked' && previewData ? (
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
    ) : screen === 'generating' ? (
      <GeneratingStatus
        gen={gen}
        payStatus={status}
        payTxHash={txHash}
        threadId={threadId}
        chainExplorerBase={explorerBase(chainId)}
        agentWalletAddress={getContracts(chainId).AgentWallet}
      />
    ) : screen === 'preview' && draftTweets ? (
      <Stagger className="w-full max-w-md flex flex-col gap-4">
        {degradedSteps.length > 0 && (
          <StaggerItem>
            <div className="rounded-md border border-[hsl(var(--ink-faded))] bg-[hsl(var(--ink-faded)/0.06)] px-4 py-3 flex flex-col gap-2.5">
              <p className="text-sm text-muted-foreground">
                Built without live data ({degradedSteps.join(', ')}). Still
                usable — or request a refund if it falls short.
              </p>
              {refundStatus === 'sent' ? (
                <p className="text-xs text-muted-foreground">
                  Refund requested. Operator will process within 24h.
                </p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => requestRefund('partial')}
                  disabled={refundStatus === 'sending'}
                >
                  {refundStatus === 'sending' ? 'Sending…' : 'Request a refund'}
                </Button>
              )}
              {refundStatus === 'error' && refundError && (
                <p className="text-xs text-destructive">{refundError}</p>
              )}
            </div>
          </StaggerItem>
        )}
        <StaggerItem>
          <ThreadPreview tweets={draftTweets} onChange={setDraftTweets} />
        </StaggerItem>
        <StaggerItem>
          <ShareToX tweets={draftTweets} />
        </StaggerItem>
        <StaggerItem>
          <Button onClick={() => setScreen('post-share')}>I posted it →</Button>
        </StaggerItem>
      </Stagger>
    ) : screen === 'post-share' && activeToken ? (
      <PostShareScreen
        paidAmountUsd={Number(
          formatUnits(computeTokenAmount(activeToken), activeToken.decimals),
        ).toFixed(3)}
        agentSpentUsd={gen.totalCostUsd ?? '0.001'}
        tokenSymbol={activeToken.symbol}
        payTxHash={txHash}
        agentWalletAddress={getContracts(chainId).AgentWallet}
        explorerBase={explorerBase(chainId)}
        onWriteAnother={() => {
          reset();
          resetGen();
          setDraftTweets(null);
          setSubmitted(null);
          setHotTake(null);
          setScreen('mode');
        }}
      />
    ) : null;

  const errorSurfaces = (
    <>
      {error && /approve/i.test(error) && (
        <ErrorSurface
          kind="approve-rejected"
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : 'mode';
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setScreen(back);
          }}
        />
      )}
      {error && !/approve/i.test(error) && /revert|reject|fail/i.test(error) && (
        <ErrorSurface
          kind="pay-failed"
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : 'mode';
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setScreen(back);
          }}
        />
      )}
      {screen === 'generating' && gen.fatal === 'slow' && !gen.isDone && (
        <ErrorSurface
          kind="slow"
          onRefundRequest={() => requestRefund('slow-cancel')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && capHit && (
        <ErrorSurface
          kind="cap-hit"
          onRefundRequest={() => requestRefund('full')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && !capHit && gen.fatal && gen.fatal !== 'slow' && !gen.tweets && (
        <ErrorSurface
          kind="full-fail"
          onRefundRequest={() => requestRefund('full')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && !capHit && gen.fatal && gen.fatal !== 'slow' && gen.tweets && (
        <ErrorSurface
          kind="partial"
          onRefundRequest={() => requestRefund('partial')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && gen.fatal && gen.fatal !== 'slow' && (
        <Button
          variant="outline"
          onClick={() => {
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setScreen('mode');
          }}
        >
          Write another
        </Button>
      )}
    </>
  );

  const composeSummary = submitted ? (
    <ComposeSummary
      mode={0}
      topic={submitted.topic}
      audience={submitted.audience}
      tokenSymbol={submitted.token.symbol}
    />
  ) : hotTake ? (
    <ComposeSummary
      mode={1}
      eventDescription={hotTake.eventDescription}
      angle={hotTake.angle}
      tokenSymbol={hotTake.token.symbol}
    />
  ) : null;
```

- [ ] **Step 4: Replace the connected-branch render**

Find the final branch of the big render ternary — the block that currently starts (after `) : (`) with:

```tsx
        <>
          <WalletStatus />
          <AnimatePresence mode="wait">
            <ScreenTransition key={screen}>
```

…and runs through the closing `</>` just before the `)}` that precedes the `<footer>`. Replace that **entire** `<> … </>` block with:

```tsx
        <>
          <WalletStatus />
          {spread ? (
            <FolioSpread
              leftKey={isInputScreen(screen) ? screen : 'summary'}
              rightKey={isOutputScreen(screen) ? screen : 'placeholder'}
              left={isInputScreen(screen) ? formNode : composeSummary}
              right={
                isOutputScreen(screen) ? (
                  <div className="w-full flex flex-col items-center gap-4">
                    {resultNode}
                    {errorSurfaces}
                  </div>
                ) : (
                  <RightLeafPlaceholder />
                )
              }
            />
          ) : (
            <>
              <AnimatePresence mode="wait">
                <ScreenTransition key={screen}>
                  {isInputScreen(screen) ? formNode : resultNode}
                </ScreenTransition>
              </AnimatePresence>
              {errorSurfaces}
            </>
          )}
        </>
```

Note: the non-spread branch reproduces today's behaviour exactly — `WalletStatus`, then a single `ScreenTransition` keyed by `screen` rendering the one active node, then `errorSurfaces` as siblings (unchanged).

- [ ] **Step 5: Widen the header for the spread**

So the running-head aligns with the wider spread, make the header width responsive. Find the header opening tag:

```tsx
      <header className="w-full max-w-md flex flex-col gap-3">
```

Replace with:

```tsx
      <header className={`w-full ${spread ? 'max-w-4xl' : 'max-w-md'} flex flex-col gap-3`}>
```

- [ ] **Step 6: Run the full lib test suite (no regression)**

Run: `pnpm test:lib`
Expected: PASS — the entire existing suite stays green (proof the paid flow logic is untouched), plus the new `screens` and `useIsDesktop` tests.

- [ ] **Step 7: Lint and typecheck via build**

Run: `pnpm lint && pnpm build`
Expected: lint clean, build succeeds (no unused-import or type errors; `Screen` now imported, inline type removed).

- [ ] **Step 8: Manual verification**

Run: `pnpm dev`, then:
1. Desktop browser (>=1024px), connect a wallet on Celo → confirm the **two-page spread**: ModePicker on the left, RightLeafPlaceholder on the right. Submit a mode → left becomes `ComposeSummary`, right shows generating → preview.
2. Narrow the browser below 1024px → confirm it collapses to the **single centered column**, unchanged from today.
3. In devtools, set `window.ethereum = { isMiniPay: true }` before load (or test in MiniPay) → confirm **single dark column**, no spread, no placeholder/summary.

Confirm each manually and note the result.

- [ ] **Step 9: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(layout): desktop folio spread, mobile/MiniPay column unchanged"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** breakpoint hook (T2) ✓; screen split (T1) ✓; three render layers — pre-flow stays full-width because the spread branch lives only inside the connected/on-chain branch, leaving the not-connected / wrong-network / `LandingHero` branches untouched (T6) ✓; state→pane mapping (T6 Step 4) ✓; `ComposeSummary` (T4) ✓; `RightLeafPlaceholder` (T3) ✓; `FolioSpread` + spine (T5) ✓; header running-head (T6 Step 5) ✓; `!isMiniPay && isDesktop` guard (T6 Step 2) ✓; no-regression via `pnpm test:lib` (T6 Step 6) ✓.
- **Known minor (accepted, per spec):** `WalletStatus` keeps its `max-w-md` and sits centered above the wider spread. Acceptable for v1; not worth editing `WalletStatus` props.
- **Type consistency:** `Screen` is defined once in `lib/screens.ts` and imported by `HomeClient`; `isInputScreen`/`isOutputScreen` names are used identically in T1 and T6.
