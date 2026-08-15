# Wallet Flow UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user deliberately choose which chain they pay on, and make every wallet state around that choice legible instead of silent.

**Architecture:** The wallet stays the single source of truth for the current chain — the picker is a `switchChain` call and nothing else, so `useChainId()` remains authoritative everywhere. All behaviour worth testing is extracted into pure functions in `lib/`; components stay thin wrappers over them, matching how `useBodyScrollLock`/`setBodyScrollLocked` and `usePayForThread`/`resolveBundleTxHash` are already built.

**Tech Stack:** Next.js 14 App Router, React 18, wagmi 2.19 + viem 2.48, Tailwind + Radix + framer-motion, Vitest 4 (Node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-15-wallet-flow-ux-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **No jsdom, no @testing-library.** Vitest runs in plain Node. Any behaviour that needs a test MUST live in a pure exported function in `lib/`. Components are verified at runtime, not by unit test. Never add a test that renders a component.
- **`lib/chainPolicy.ts` is the only allowlist.** Never introduce a second source of truth for which chains are supported.
- **The wallet's chain is the truth.** Never store a "selected chain" in React state. `selectedChain === useChainId()`.
- **Import EIP-5792 actions (`sendCalls`, `waitForCallsStatus`, `getCapabilities`) from `wagmi/actions`, never `@wagmi/core`** — two copies of `@wagmi/core` resolve in this repo and the direct import is a type error at every call site.
- **No brand colours.** Use only existing theme tokens: `--primary`, `border-border`, `bg-card`, `text-destructive`, `text-muted-foreground`, and the `heading-sub` / `font-mono` type classes. Chains are distinguished by uppercase mono type, never by colour.
- **Never render `0.00` for a balance that is still loading.** Render `·····`. A false zero reads as "you are broke" and gets acted on.
- **Never claim "no gas" unless `getCapabilities` actually reported `paymasterService.supported === true`.** Unknown means say nothing about gas.
- **Type system:** JetBrains Mono (`font-mono`) for chrome, data and status; Inter (`font-sans`) for full sentences of prose.
- **Run `npx tsc --noEmit` before finishing any task.** `pnpm test:lib` and `pnpm build` do not typecheck `*.test.ts`; only `tsc` catches it.
- **Commit after every task.** Small, reviewable commits, directly on `main`.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `lib/chainChoice.ts` | Pure logic: decimals-correct balance comparison, token re-derivation on chain change, chain-option shaping for the picker. |
| `lib/chainChoice.test.ts` | Tests for the above. |
| `lib/useGasSponsorship.ts` | Capability probe hook + the pure `gasNote` policy. |
| `lib/useGasSponsorship.test.ts` | Tests for `gasNote`. |
| `components/ChainPicker.tsx` | Presentational picker: rows, selection, pending/error states. Props-driven, no wagmi calls. |
| `components/PayContext.tsx` | The one-line "USDC on Base · no gas · change →" shown under every pay CTA. |

**Modify**

| File | Change |
|---|---|
| `lib/payError.ts` | Extract the shared core; add `describeSwitchError`. |
| `lib/useBalances.ts` | Accept an explicit `chainId` and an `enabled` flag, for reading the unconnected chain. |
| `lib/usePayForThread.ts` | Assert the token belongs to the chain being paid on, before approve. |
| `components/WalletStatus.tsx` | Chain label; decimals-correct top token; empty-balance exit. |
| `components/{HotTake,Educational,TokenAnalysis,DailyRecap,ChainComparison,NewsBreakdown}Input.tsx` | Replace the duplicated buggy sort with the shared helper. |
| `components/WalletMenu.tsx` | Chain on the chip; mount the picker; switch lifecycle. |
| `components/PreviewLocked.tsx` | Render `PayContext` under the CTA. |
| `app/HomeClient.tsx` | Wrong-network block; MiniPay retry; token re-derivation on chain change; `PayContext` at the other two unlock CTAs. |

---

### Task 1: `describeSwitchError`

A switch that fails currently produces no UI at all. This gives the lifecycle states (Task 8) something to render.

**Files:**
- Modify: `lib/payError.ts:34-61`
- Test: `lib/payError.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `describeSwitchError(e: unknown): string`.

- [ ] **Step 1: Write the failing test**

Append to `lib/payError.test.ts`:

```ts
import { describePayError, describeSwitchError } from './payError';

describe('describeSwitchError', () => {
  it('names a user rejection from the EIP-1193 code', () => {
    const e = Object.assign(new Error('User rejected'), { code: 4001 });
    expect(describeSwitchError(e)).toBe('Switch declined in wallet.');
  });

  it('finds the rejection code one level down on cause', () => {
    const e = Object.assign(new Error('wrapped'), {
      cause: { code: 4001 },
    });
    expect(describeSwitchError(e)).toBe('Switch declined in wallet.');
  });

  it('tells the user to change network manually when the wallet cannot switch', () => {
    const e = Object.assign(new Error('unsupported'), {
      name: 'SwitchChainNotSupportedError',
    });
    expect(describeSwitchError(e)).toBe(
      "This wallet can't switch chains. Change network in the wallet, then reopen.",
    );
  });

  it("keeps the wallet's own message for anything else", () => {
    const e = Object.assign(new Error('RPC endpoint unreachable'), { code: -32603 });
    const out = describeSwitchError(e);
    expect(out).toContain('RPC endpoint unreachable');
    expect(out).toContain('-32603');
  });

  it('falls back without throwing on a non-error', () => {
    expect(describeSwitchError(undefined)).toBe('Could not switch chain');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/payError.test.ts`
Expected: FAIL — `describeSwitchError is not a function`.

- [ ] **Step 3: Extract the core and add the new function**

In `lib/payError.ts`, rename the body of `describePayError` into a shared core that takes the fallback string, then define both public functions. Replace lines 34-61 with:

```ts
function describeError(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e.slice(0, MAX_LEN);

  const err = asErrorLike(e);
  if (!err) return fallback;

  const head = err.shortMessage ?? err.message;
  if (!head) return fallback;

  let out = head;

  // `Error` and `TypeError` say nothing a reader doesn't already see; a viem or
  // wallet class name (UserRejectedRequestError, …) is the whole diagnosis.
  if (err.name && err.name !== 'Error' && !head.includes(err.name)) {
    out += ` [${err.name}]`;
  }

  const code = findCode(err);
  if (code !== undefined && !out.includes(String(code))) {
    out += out.endsWith(']') ? ` code=${code}` : ` [code=${code}]`;
  }

  const details = asErrorLike(e)?.details ?? asErrorLike(err.cause)?.details;
  if (details && !out.includes(details)) {
    out += ` — ${details}`;
  }

  return out.length > MAX_LEN ? `${out.slice(0, MAX_LEN - 1)}…` : out;
}

export function describePayError(e: unknown): string {
  return describeError(e, 'Payment failed (unknown error)');
}

/**
 * A failed chain switch, in one line.
 *
 * Two failures deserve canned copy because the wallet's own words are useless
 * to a user: a rejection (they know they rejected — what they need is the UI to
 * admit it happened) and a wallet that has no wallet_switchEthereumChain at all
 * (the action is impossible here, so the copy must point somewhere it is
 * possible). Everything else keeps the wallet's message, which is the only
 * evidence of what actually went wrong.
 */
export function describeSwitchError(e: unknown): string {
  const err = asErrorLike(e);
  if (err) {
    if (findCode(err) === 4001) return 'Switch declined in wallet.';
    if (err.name === 'SwitchChainNotSupportedError') {
      return "This wallet can't switch chains. Change network in the wallet, then reopen.";
    }
  }
  return describeError(e, 'Could not switch chain');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/payError.test.ts && npx tsc --noEmit`
Expected: all pass, including the pre-existing `describePayError` tests (the core is unchanged behaviour).

- [ ] **Step 5: Commit**

```bash
git add lib/payError.ts lib/payError.test.ts
git commit -m "feat(wallet): give a failed chain switch words to say"
```

---

### Task 2: Decimals-correct balance value, and token re-derivation

This is the load-bearing task. It fixes a live bug and provides the primitive the picker needs.

The bug: `[...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))` appears in 7 files and compares raw bigints across different decimals. cUSD has 18, USDC/USDT have 6 — so `0.30 cUSD` (3e17 raw) beats `2.40 USDC` (2.4e6 raw), and the forms pre-select a token worth 8× less. A user holding 0.05 cUSD and 2.40 USDC is defaulted to the token they cannot pay with.

**Files:**
- Create: `lib/chainChoice.ts`
- Test: `lib/chainChoice.test.ts`

**Interfaces:**
- Consumes: `getTokens`, `TokenSymbol`, `TokenConfig` from `lib/tokens.ts`.
- Produces:
  - `normalizeTo18(balance: bigint, decimals: number): bigint`
  - `byValueDesc(a: HasValue, b: HasValue): number`
  - `highestValue<T extends HasValue>(balances: readonly T[]): T | null`
  - `reselectTokenForChain(params: { previousSymbol: TokenSymbol | null; chainId: number; balances: readonly TokenBalanceLike[] }): TokenReselection`
  - types `HasValue`, `TokenBalanceLike`, `TokenReselection`

- [ ] **Step 1: Write the failing test**

Create `lib/chainChoice.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { base, celo } from 'wagmi/chains';
import {
  normalizeTo18,
  highestValue,
  reselectTokenForChain,
} from './chainChoice';

const cUSD = { symbol: 'cUSD' as const, decimals: 18 };
const USDC = { symbol: 'USDC' as const, decimals: 6 };
const USDT = { symbol: 'USDT' as const, decimals: 6 };

// 0.30 cUSD and 2.40 USDC — the case the raw-bigint sort gets backwards.
const THIRTY_CENTS_CUSD = 300_000_000_000_000_000n;
const TWO_FORTY_USDC = 2_400_000n;

describe('normalizeTo18', () => {
  it('leaves an 18-decimal balance alone', () => {
    expect(normalizeTo18(THIRTY_CENTS_CUSD, 18)).toBe(THIRTY_CENTS_CUSD);
  });

  it('scales a 6-decimal balance up to the same unit', () => {
    expect(normalizeTo18(TWO_FORTY_USDC, 6)).toBe(2_400_000_000_000_000_000n);
  });

  it('scales down if a token ever has more than 18 decimals', () => {
    expect(normalizeTo18(1_000n, 21)).toBe(1n);
  });
});

describe('highestValue', () => {
  it('picks by real value, not raw bigint', () => {
    const top = highestValue([
      { ...cUSD, balance: THIRTY_CENTS_CUSD },
      { ...USDC, balance: TWO_FORTY_USDC },
    ]);
    expect(top?.symbol).toBe('USDC');
  });

  it('returns null when every balance is zero', () => {
    expect(
      highestValue([
        { ...cUSD, balance: 0n },
        { ...USDC, balance: 0n },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(highestValue([])).toBeNull();
  });
});

describe('reselectTokenForChain', () => {
  it('keeps the symbol when it exists on the new chain', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'USDC',
      chainId: base.id,
      balances: [{ ...USDC, balance: TWO_FORTY_USDC }],
    });
    expect(out).toEqual({ kind: 'keep', symbol: 'USDC' });
  });

  it('falls back to the most valuable funded token when the symbol is gone', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'cUSD',
      chainId: base.id,
      balances: [{ ...USDC, balance: TWO_FORTY_USDC }],
    });
    expect(out.kind).toBe('switched');
    if (out.kind === 'switched') {
      expect(out.symbol).toBe('USDC');
      expect(out.token.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    }
  });

  it('ignores a funded token that does not exist on the target chain', () => {
    // cUSD is funded but Base has no cUSD — it must not be chosen.
    const out = reselectTokenForChain({
      previousSymbol: 'USDT',
      chainId: base.id,
      balances: [
        { ...cUSD, balance: THIRTY_CENTS_CUSD },
        { ...USDC, balance: TWO_FORTY_USDC },
      ],
    });
    expect(out.kind).toBe('switched');
    if (out.kind === 'switched') expect(out.symbol).toBe('USDC');
  });

  it('reports none when nothing on the new chain is funded', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'cUSD',
      chainId: base.id,
      balances: [{ ...USDC, balance: 0n }],
    });
    expect(out).toEqual({ kind: 'none' });
  });

  it('reports none rather than throwing on an unsupported chain', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'USDC',
      chainId: 1,
      balances: [{ ...USDC, balance: TWO_FORTY_USDC }],
    });
    expect(out).toEqual({ kind: 'none' });
  });

  it('keeps a symbol that exists on the chain even with no balance loaded yet', () => {
    // Balances arrive asynchronously; a keep must not depend on them.
    const out = reselectTokenForChain({
      previousSymbol: 'USDC',
      chainId: celo.id,
      balances: [],
    });
    expect(out).toEqual({ kind: 'keep', symbol: 'USDC' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/chainChoice.test.ts`
Expected: FAIL — cannot resolve `./chainChoice`.

- [ ] **Step 3: Create `lib/chainChoice.ts`**

```ts
import { getTokens, type TokenConfig, type TokenSymbol } from './tokens';

export interface HasValue {
  balance: bigint;
  decimals: number;
}

export interface TokenBalanceLike extends HasValue {
  symbol: TokenSymbol;
}

export type TokenReselection =
  | { kind: 'keep'; symbol: TokenSymbol }
  | { kind: 'switched'; symbol: TokenSymbol; token: TokenConfig }
  | { kind: 'none' };

/**
 * A balance in one common unit, so two tokens can be compared.
 *
 * Raw bigints are not comparable across tokens: cUSD has 18 decimals and
 * USDC/USDT have 6, so 0.30 cUSD (3e17) outranks 2.40 USDC (2.4e6) by raw
 * value while being worth eight times less. Every "which token do they have
 * most of" decision must go through here.
 */
export function normalizeTo18(balance: bigint, decimals: number): bigint {
  if (decimals === 18) return balance;
  if (decimals < 18) return balance * 10n ** BigInt(18 - decimals);
  return balance / 10n ** BigInt(decimals - 18);
}

/** Descending by real value. Use with `Array.prototype.sort`. */
export function byValueDesc(a: HasValue, b: HasValue): number {
  const av = normalizeTo18(a.balance, a.decimals);
  const bv = normalizeTo18(b.balance, b.decimals);
  if (av === bv) return 0;
  return av > bv ? -1 : 1;
}

/** The most valuable funded balance, or null if none is funded. */
export function highestValue<T extends HasValue>(balances: readonly T[]): T | null {
  const funded = balances.filter((b) => b.balance > 0n);
  if (funded.length === 0) return null;
  return [...funded].sort(byValueDesc)[0] ?? null;
}

/**
 * Which token to pay with after the chain changed.
 *
 * The payment token is captured into the submitted payload before the preview,
 * so a chain switch mid-flow can leave a token from the old chain pointed at
 * the new chain's contract — one chain's address against another chain's
 * payment contract. Re-derive instead of discarding the user's work:
 *
 *   - the symbol still exists here  → keep it, silently (a non-event)
 *   - it does not                   → most valuable funded token here, announced
 *   - nothing here is funded        → none; the caller disables paying
 */
export function reselectTokenForChain(params: {
  previousSymbol: TokenSymbol | null;
  chainId: number;
  balances: readonly TokenBalanceLike[];
}): TokenReselection {
  let available: Partial<Record<TokenSymbol, TokenConfig>>;
  try {
    available = getTokens(params.chainId);
  } catch {
    // An unsupported chain is a state the UI already gates on; re-throwing here
    // would take down a render that is about to show the wrong-network screen.
    return { kind: 'none' };
  }

  if (params.previousSymbol && available[params.previousSymbol]) {
    return { kind: 'keep', symbol: params.previousSymbol };
  }

  const payable = params.balances.filter((b) => available[b.symbol]);
  const top = highestValue(payable);
  if (!top) return { kind: 'none' };

  const token = available[top.symbol];
  if (!token) return { kind: 'none' };
  return { kind: 'switched', symbol: top.symbol, token };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/chainChoice.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chainChoice.ts lib/chainChoice.test.ts
git commit -m "feat(wallet): compare token balances by value, not by raw bigint"
```

---

### Task 3: Retire the seven duplicated sorts

**Files:**
- Modify: `components/WalletStatus.tsx:26-27`
- Modify: `components/HotTakeInput.tsx:61`
- Modify: `components/EducationalInput.tsx`, `components/TokenAnalysisInput.tsx`, `components/DailyRecapInput.tsx`, `components/ChainComparisonInput.tsx`, `components/NewsBreakdownInput.tsx` (same one-line pattern in each)

**Interfaces:**
- Consumes: `highestValue`, `byValueDesc` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Find every copy**

Run: `grep -rn "a.balance > b.balance" components/`
Expected: 7 hits, one per file listed above.

- [ ] **Step 2: Replace the default-token pick in each input form**

In each of the six `*Input.tsx` files, the pattern is a `useMemo` returning the top balance. Replace the sort with `highestValue`, which also drops the `balance > 0n` check where one exists:

```tsx
// before
return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];

// after
return highestValue(balances) ?? balances[0];
```

Add the import to each file:

```tsx
import { highestValue } from '@/lib/chainChoice';
```

The `?? balances[0]` keeps the previous behaviour when nothing is funded: the selector still shows a token rather than going blank. `highestValue` returns null there because no balance is above zero.

- [ ] **Step 3: Replace the highlight pick in `WalletStatus.tsx`**

```tsx
// before
const sorted = [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1));
const topSymbol = sorted[0] && sorted[0].balance > 0n ? sorted[0].symbol : null;

// after
const topSymbol = highestValue(balances)?.symbol ?? null;
```

- [ ] **Step 4: Verify no copies remain**

Run: `grep -rn "a.balance > b.balance" components/ || echo "all replaced"`
Expected: `all replaced`.

- [ ] **Step 5: Run the suite**

Run: `pnpm test:lib && npx tsc --noEmit`
Expected: 621+ passing, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add components/
git commit -m "fix(wallet): stop defaulting to the token the user has least of"
```

---

### Task 4: Assert the token belongs to the chain being paid on

The UI can race. This is the gate at the point where real money leaves.

**Files:**
- Modify: `lib/usePayForThread.ts` (add the export near `resolveBundleTxHash:97`; call it inside `pay` after `getContracts`, around `:187`)
- Test: `lib/usePayForThread.test.ts`

**Interfaces:**
- Consumes: `getTokens` from `lib/tokens.ts`, `chainLabel` from `lib/chainPolicy.ts`.
- Produces: `tokenChainMismatch(chainId: number, token: TokenConfig): string | null` — the error message, or null when the pair is valid.

- [ ] **Step 1: Write the failing test**

Append to `lib/usePayForThread.test.ts`:

```ts
import { tokenChainMismatch } from './usePayForThread';
import { base, celo } from 'wagmi/chains';
import { BASE_MAINNET_TOKENS, CELO_MAINNET_TOKENS } from './tokens';

describe('tokenChainMismatch', () => {
  it('accepts a token that belongs to the chain', () => {
    expect(tokenChainMismatch(base.id, BASE_MAINNET_TOKENS.USDC!)).toBeNull();
  });

  it('rejects a token from another chain', () => {
    const msg = tokenChainMismatch(base.id, CELO_MAINNET_TOKENS.cUSD);
    expect(msg).toContain('cUSD');
    expect(msg).toContain('Base');
  });

  it('rejects USDC from the wrong chain even though the symbol exists on both', () => {
    // The trap this guard exists for: same symbol, different address.
    const msg = tokenChainMismatch(base.id, CELO_MAINNET_TOKENS.USDC);
    expect(msg).not.toBeNull();
  });

  it('is case-insensitive about the address', () => {
    const lower = {
      ...BASE_MAINNET_TOKENS.USDC!,
      address: BASE_MAINNET_TOKENS.USDC!.address.toLowerCase() as `0x${string}`,
    };
    expect(tokenChainMismatch(base.id, lower)).toBeNull();
  });

  it('rejects rather than throwing on an unsupported chain', () => {
    expect(tokenChainMismatch(1, CELO_MAINNET_TOKENS.cUSD)).not.toBeNull();
  });

  it('accepts a Celo token on Celo', () => {
    expect(tokenChainMismatch(celo.id, CELO_MAINNET_TOKENS.USDT)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/usePayForThread.test.ts`
Expected: FAIL — `tokenChainMismatch is not a function`.

- [ ] **Step 3: Add the function**

In `lib/usePayForThread.ts`, next to `resolveBundleTxHash`:

```ts
/**
 * Does this token actually exist, at this address, on this chain?
 *
 * The chain picker lets a user switch after the payment token was captured
 * into the submitted payload, so a stale token can arrive here carrying one
 * chain's address while `chainId` names another chain's payment contract. On
 * the wrong chain that address usually has no code — the approve goes nowhere.
 * If some unrelated contract happens to occupy it, behaviour is undefined.
 *
 * The UI re-derives the token on every chain change (lib/chainChoice.ts); this
 * is the second gate, at the point where money actually moves.
 */
export function tokenChainMismatch(chainId: number, token: TokenConfig): string | null {
  let available: Partial<Record<TokenSymbol, TokenConfig>>;
  try {
    available = getTokens(chainId);
  } catch {
    return `chainId ${chainId} is not a chain CoinOp accepts.`;
  }

  const expected = available[token.symbol];
  if (!expected) {
    return `${token.symbol} is not payable on ${chainLabel(chainId)}. Pick another token and retry.`;
  }
  if (expected.address.toLowerCase() !== token.address.toLowerCase()) {
    return `${token.symbol} address does not match ${chainLabel(chainId)}. Reopen the form and pick a token again.`;
  }
  return null;
}
```

Add to the imports at the top of the file:

```ts
import { getTokens, type TokenConfig, type TokenSymbol } from './tokens';
```

(`chainLabel` is already imported — it is used in the existing switch-chain error copy at `:201`.)

- [ ] **Step 4: Call it in the pay path**

In `pay`, immediately after `const paymentAddr = contracts.ShipPostPayment;` (around `:188`), before the price read:

```ts
const mismatch = tokenChainMismatch(chainId, token);
if (mismatch) {
  fail('setup', mismatch);
  return;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/usePayForThread.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/usePayForThread.ts lib/usePayForThread.test.ts
git commit -m "feat(pay): refuse a token that belongs to a different chain"
```

---

### Task 5: Read balances for a chain the wallet is not on

The picker needs the other chain's balances without switching to it.

**Files:**
- Modify: `lib/useBalances.ts`
- Test: `lib/useBalances.test.ts` (create)

**Interfaces:**
- Consumes: `getTokens` from `lib/tokens.ts`.
- Produces:
  - `tokenListFor(chainId: number | undefined): TokenConfig[]` — `[]` instead of throwing.
  - `useBalances(options?: { chainId?: number; enabled?: boolean })` — unchanged return shape `{ balances, isLoading, refetch }`. Existing zero-argument callers keep working.

- [ ] **Step 1: Write the failing test**

Create `lib/useBalances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { base, celo } from 'wagmi/chains';
import { tokenListFor } from './useBalances';

describe('tokenListFor', () => {
  it('lists the one token Base accepts', () => {
    expect(tokenListFor(base.id).map((t) => t.symbol)).toEqual(['USDC']);
  });

  it('lists all three Celo accepts', () => {
    expect(tokenListFor(celo.id).map((t) => t.symbol).sort()).toEqual([
      'USDC',
      'USDT',
      'cUSD',
    ]);
  });

  it('returns empty for an unsupported chain instead of throwing', () => {
    expect(tokenListFor(1)).toEqual([]);
  });

  it('returns empty when the chain is not known yet', () => {
    expect(tokenListFor(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/useBalances.test.ts`
Expected: FAIL — `tokenListFor` is not exported.

- [ ] **Step 3: Rewrite `lib/useBalances.ts`**

```tsx
'use client';

import { useAccount, useChainId, useReadContracts } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { getTokens, type TokenConfig, type TokenSymbol } from './tokens';

export interface TokenBalance {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  balance: bigint;
  displayName: string;
}

/**
 * The tokens payable on a chain, or none.
 *
 * getTokens throws on an unsupported chain, which is the right shape for
 * server code but wrong inside a render: the wrong-network screen is about to
 * be shown and must not be pre-empted by a thrown error.
 */
export function tokenListFor(chainId: number | undefined): TokenConfig[] {
  if (!chainId) return [];
  try {
    return Object.values(getTokens(chainId));
  } catch {
    return [];
  }
}

export function useBalances(options?: { chainId?: number; enabled?: boolean }) {
  const { address } = useAccount();
  const connectedChainId = useChainId();
  // Default to the connected chain. An explicit chainId reads a chain the
  // wallet is NOT on — wagmi routes it through that chain's transport, so no
  // switch is involved. Used by the picker to show both chains at once.
  const chainId = options?.chainId ?? connectedChainId;
  const tokenList = tokenListFor(chainId);

  const enabled =
    (options?.enabled ?? true) && Boolean(address) && tokenList.length > 0;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address ?? '0x0000000000000000000000000000000000000000'],
      chainId,
    })),
    query: { enabled },
  });

  const balances: TokenBalance[] = tokenList.map((t, i) => ({
    ...t,
    balance: (data?.[i]?.result as bigint | undefined) ?? 0n,
  }));

  // `isLoading` is false when the query is disabled, which would let a caller
  // render 0.00 for balances that were never fetched. Report "still loading"
  // until a fetch has actually resolved.
  const pending = enabled && (isLoading || data === undefined);

  return { balances, isLoading: pending, refetch };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/useBalances.test.ts && pnpm test:lib && npx tsc --noEmit`
Expected: PASS, and no existing caller breaks (all call `useBalances()` with no argument).

- [ ] **Step 5: Commit**

```bash
git add lib/useBalances.ts lib/useBalances.test.ts
git commit -m "feat(wallet): read balances for a chain the wallet is not on"
```

---

### Task 6: Gas sponsorship probe

**Files:**
- Create: `lib/useGasSponsorship.ts`
- Test: `lib/useGasSponsorship.test.ts`

**Interfaces:**
- Consumes: `getCapabilities` from `wagmi/actions` (never `@wagmi/core`).
- Produces:
  - type `SponsorshipState = 'unknown' | 'sponsored' | 'self'`
  - `gasNote(state: SponsorshipState): string | null`
  - `useGasSponsorship(): SponsorshipState`

- [ ] **Step 1: Write the failing test**

Create `lib/useGasSponsorship.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gasNote } from './useGasSponsorship';

describe('gasNote', () => {
  it('promises no gas only when sponsorship was confirmed', () => {
    expect(gasNote('sponsored')).toBe('no gas');
  });

  it('says the user pays when the wallet answered and had no paymaster', () => {
    expect(gasNote('self')).toBe('you pay gas');
  });

  it('says nothing at all when the wallet never answered', () => {
    // Guessing "no gas" for a MiniPay user who will pay gas is the fastest way
    // to lose the trust this line exists to build.
    expect(gasNote('unknown')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/useGasSponsorship.test.ts`
Expected: FAIL — cannot resolve `./useGasSponsorship`.

- [ ] **Step 3: Create `lib/useGasSponsorship.ts`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, useChainId, useConfig } from 'wagmi';
import { getCapabilities } from 'wagmi/actions';

export type SponsorshipState = 'unknown' | 'sponsored' | 'self';

/**
 * The gas half of the pay-moment line, or nothing.
 *
 * `unknown` renders nothing on purpose. Sponsorship is only knowable by asking
 * the wallet, and a wallet that cannot answer wallet_getCapabilities is the
 * common case (MiniPay is one). Claiming "no gas" there would be a promise
 * broken at exactly the moment the user is deciding whether to trust us.
 */
export function gasNote(state: SponsorshipState): string | null {
  if (state === 'sponsored') return 'no gas';
  if (state === 'self') return 'you pay gas';
  return null;
}

/**
 * Ask once per account+chain whether this wallet can have its gas sponsored.
 *
 * This is a wallet-local call, not an RPC — it costs nothing on the network.
 * It runs here, on connect, rather than inside pay() where it lives today,
 * because the answer has to be on screen BEFORE the user commits.
 */
export function useGasSponsorship(): SponsorshipState {
  const config = useConfig();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const [state, setState] = useState<SponsorshipState>('unknown');

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address) {
      setState('unknown');
      return;
    }
    // Re-probing per chain matters: the same wallet is sponsored on Base and
    // not on Celo.
    setState('unknown');
    getCapabilities(config, { account: address, chainId })
      .then((caps) => {
        if (cancelled) return;
        setState(caps?.paymasterService?.supported === true ? 'sponsored' : 'self');
      })
      .catch(() => {
        if (!cancelled) setState('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [config, chainId, address, isConnected]);

  return state;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/useGasSponsorship.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/useGasSponsorship.ts lib/useGasSponsorship.test.ts
git commit -m "feat(wallet): learn whether gas is sponsored before the user commits"
```

---

### Task 7: Chain option shaping and the `ChainPicker` component

**Files:**
- Modify: `lib/chainChoice.ts` (add `buildChainOptions`)
- Modify: `lib/chainChoice.test.ts`
- Create: `components/ChainPicker.tsx`

**Interfaces:**
- Consumes: `SUPPORTED_CHAIN_IDS`, `chainLabel` from `lib/chainPolicy.ts`; `TokenBalance` from `lib/useBalances.ts`.
- Produces:
  - `buildChainOptions(params: { currentChainId: number; balancesByChain: Record<number, readonly TokenBalanceLike[] | undefined> }): ChainOption[]`
  - `ChainPicker` React component.

- [ ] **Step 1: Write the failing test**

Append to `lib/chainChoice.test.ts`:

```ts
import { buildChainOptions } from './chainChoice';

describe('buildChainOptions', () => {
  const balances = {
    [base.id]: [{ symbol: 'USDC' as const, decimals: 6, balance: 2_400_000n }],
    [celo.id]: [{ symbol: 'cUSD' as const, decimals: 18, balance: 0n }],
  };

  it('marks the connected chain as current', () => {
    const opts = buildChainOptions({ currentChainId: base.id, balancesByChain: balances });
    expect(opts.find((o) => o.chainId === base.id)?.isCurrent).toBe(true);
    expect(opts.find((o) => o.chainId === celo.id)?.isCurrent).toBe(false);
  });

  it('lists one option per supported chain', () => {
    const opts = buildChainOptions({ currentChainId: base.id, balancesByChain: balances });
    expect(opts.map((o) => o.chainId).sort()).toEqual([...SUPPORTED_CHAIN_IDS].sort());
  });

  it('labels each chain from chainPolicy, never a hardcoded name', () => {
    const opts = buildChainOptions({ currentChainId: base.id, balancesByChain: balances });
    expect(opts.find((o) => o.chainId === base.id)?.label).toBe(chainLabel(base.id));
  });

  it('marks a chain whose balances have not arrived as loading', () => {
    const opts = buildChainOptions({
      currentChainId: base.id,
      balancesByChain: { [base.id]: balances[base.id] },
    });
    expect(opts.find((o) => o.chainId === celo.id)?.isLoading).toBe(true);
    expect(opts.find((o) => o.chainId === base.id)?.isLoading).toBe(false);
  });

  it('reports whether a chain has anything funded', () => {
    const opts = buildChainOptions({ currentChainId: base.id, balancesByChain: balances });
    expect(opts.find((o) => o.chainId === base.id)?.hasFunds).toBe(true);
    expect(opts.find((o) => o.chainId === celo.id)?.hasFunds).toBe(false);
  });
});
```

Add `SUPPORTED_CHAIN_IDS` and `chainLabel` to the test's imports from `./chainPolicy`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/chainChoice.test.ts`
Expected: FAIL — `buildChainOptions is not a function`.

- [ ] **Step 3: Add `buildChainOptions` to `lib/chainChoice.ts`**

```ts
import { SUPPORTED_CHAIN_IDS, chainLabel } from './chainPolicy';

export interface ChainOption {
  chainId: number;
  label: string;
  isCurrent: boolean;
  /** Balances not fetched yet — render `·····`, never `0.00`. */
  isLoading: boolean;
  hasFunds: boolean;
  tokens: readonly TokenBalanceLike[];
}

export function buildChainOptions(params: {
  currentChainId: number;
  balancesByChain: Record<number, readonly TokenBalanceLike[] | undefined>;
}): ChainOption[] {
  return SUPPORTED_CHAIN_IDS.map((chainId) => {
    const tokens = params.balancesByChain[chainId];
    return {
      chainId,
      label: chainLabel(chainId),
      isCurrent: chainId === params.currentChainId,
      isLoading: tokens === undefined,
      hasFunds: (tokens ?? []).some((t) => t.balance > 0n),
      tokens: tokens ?? [],
    };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/chainChoice.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Create `components/ChainPicker.tsx`**

Presentational only — it receives everything and calls back. No wagmi hooks here, so the wiring in Task 8 stays testable by inspection.

```tsx
'use client';

import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import type { ChainOption } from '@/lib/chainChoice';

interface Props {
  options: ChainOption[];
  /** Chain currently being switched to, if any. */
  pendingChainId: number | null;
  /** One line from describeSwitchError, or null. */
  error: string | null;
  gasNoteFor: (chainId: number) => string | null;
  onSelect: (chainId: number) => void;
}

/**
 * "Which chain do you want to pay on", with the two facts that decide it:
 * what you hold there, and who pays the gas.
 *
 * Chains are told apart by uppercase mono type, never by colour — Coinbase
 * blue and Celo yellow would break the monochrome terminal theme.
 */
export function ChainPicker({
  options,
  pendingChainId,
  error,
  gasNoteFor,
  onSelect,
}: Props) {
  const busy = pendingChainId !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="heading-sub text-[10px]">Pay on</p>

      <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
        {options.map((o) => {
          const pending = pendingChainId === o.chainId;
          const note = gasNoteFor(o.chainId);
          return (
            <button
              key={o.chainId}
              type="button"
              disabled={busy || o.isCurrent}
              onClick={() => onSelect(o.chainId)}
              aria-current={o.isCurrent}
              className={
                'w-full px-3 py-2.5 flex flex-col gap-1 text-left transition-colors ' +
                (o.isCurrent ? 'bg-[hsl(var(--primary)/0.08)] ' : 'hover:bg-muted/40 ') +
                (busy && !pending ? 'opacity-50 ' : '')
              }
            >
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className={
                      'w-1.5 h-1.5 rounded-full shrink-0 ' +
                      (o.isCurrent ? 'bg-primary' : 'border border-muted-foreground')
                    }
                    aria-hidden
                  />
                  <span className="heading-sub text-[10px] text-foreground">
                    {o.label.toUpperCase()}
                  </span>
                </span>

                {pending ? (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <Loader2 size={10} className="animate-spin" aria-hidden />
                    switching…
                  </span>
                ) : (
                  note && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {note}
                    </span>
                  )
                )}
              </span>

              <span className="font-mono text-[11px] text-muted-foreground pl-3.5">
                {o.isLoading
                  ? o.tokens.length === 0
                    ? '·····'
                    : o.tokens.map((t) => `${t.symbol} ·····`).join(' · ')
                  : o.tokens.length === 0
                    ? 'no tokens here'
                    : o.tokens
                        .map(
                          (t) =>
                            `${t.symbol} ${
                              t.balance === 0n
                                ? '—'
                                : Number(formatUnits(t.balance, t.decimals)).toFixed(2)
                            }`,
                        )
                        .join(' · ')}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="font-mono text-[11px] text-destructive leading-snug">{error}</p>
      )}
    </div>
  );
}
```

Note the loading branch: when a chain's balances have not arrived, tokens are rendered as `·····` rather than `0.00`. When the chain is known to have no token list at all, it says so in words.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit && pnpm lint`

```bash
git add lib/chainChoice.ts lib/chainChoice.test.ts components/ChainPicker.tsx
git commit -m "feat(wallet): a chain picker that shows what you hold and who pays gas"
```

---

### Task 8: Wire the picker into `WalletMenu`, with the switch lifecycle

**Files:**
- Modify: `components/WalletMenu.tsx`

**Interfaces:**
- Consumes: `ChainPicker` (Task 7), `buildChainOptions` (Task 7), `describeSwitchError` (Task 1), `useBalances` (Task 5), `useGasSponsorship`/`gasNote` (Task 6).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Put the chain on the chip**

In the connected branch (`:198-205`), add the chain name before the address:

```tsx
<span className="heading-sub text-[10px] text-muted-foreground">
  {chainLabel(chainId).toUpperCase()}
</span>
<span className="font-mono text-[11px] text-foreground">
  {shorten(account.address)}
</span>
```

`chainLabel` and `chainId` are already in scope (`:19`, `:107`).

- [ ] **Step 2: Replace the fire-and-forget switch with a tracked one**

Replace `:97-103`:

```tsx
const { switchChain, isPending: switching, variables: switchVars, error: switchError, reset: resetSwitch } =
  useSwitchChain();

const pendingChainId = switching ? switchVars?.chainId ?? null : null;
const switchMessage = switchError ? describeSwitchError(switchError) : null;

const selectChain = (id: number) => {
  resetSwitch();
  switchChain(
    { chainId: id as Parameters<typeof switchChain>[0]['chainId'] },
    { onSuccess: () => setOpen(false) },
  );
};
```

The sheet closes only on success. A rejection leaves it open so the user can read why and try again — closing it would hide the only explanation they get.

Add the import:

```tsx
import { describeSwitchError } from '@/lib/payError';
```

- [ ] **Step 3: Fetch both chains' balances, lazily**

Add near the other hooks, before the `ConnectButton.Custom` return:

```tsx
// Balances for the chain the wallet is NOT on are only worth an RPC call once
// the sheet is actually open — both public endpoints rate-limit (mainnet.base.org
// bursts, forno.celo.org drops transactions).
const otherChainId = SUPPORTED_CHAIN_IDS.find((id) => id !== chainId);
const current = useBalances();
const other = useBalances({ chainId: otherChainId, enabled: open && otherChainId !== undefined });

const balancesByChain: Record<number, readonly TokenBalanceLike[] | undefined> = {
  [chainId]: current.isLoading ? undefined : current.balances,
};
if (otherChainId !== undefined) {
  balancesByChain[otherChainId] = other.isLoading ? undefined : other.balances;
}

const sponsorship = useGasSponsorship();
// Sponsorship was probed for the connected chain only; claiming anything about
// the other chain would be a guess.
const gasNoteFor = (id: number) => (id === chainId ? gasNote(sponsorship) : null);
```

Imports to add:

```tsx
import { SUPPORTED_CHAIN_IDS } from '@/lib/chainPolicy';
import { useBalances } from '@/lib/useBalances';
import { buildChainOptions, type TokenBalanceLike } from '@/lib/chainChoice';
import { useGasSponsorship, gasNote } from '@/lib/useGasSponsorship';
import { ChainPicker } from '@/components/ChainPicker';
```

- [ ] **Step 4: Render the picker in the sheet**

Replace the existing conditional switch button (`:314-328`) with:

```tsx
{isMiniPay ? (
  <div className="flex flex-col gap-1.5">
    <p className="heading-sub text-[10px]">Pay on</p>
    <p className="font-mono text-[11px] text-muted-foreground">
      <span className="text-foreground">{chainLabel(chainId).toUpperCase()}</span>
      {' · MiniPay runs on Celo only'}
    </p>
  </div>
) : (
  <ChainPicker
    options={buildChainOptions({ currentChainId: chainId, balancesByChain })}
    pendingChainId={pendingChainId}
    error={switchMessage}
    gasNoteFor={gasNoteFor}
    onSelect={selectChain}
  />
)}
```

MiniPay gets a stated reason rather than a missing control — a hidden control with no explanation reads as a broken feature.

- [ ] **Step 5: Make the wrong-network chip use the tracked switch**

In the `chain.unsupported` web branch (`:171-179`), swap `onClick={switchToDefault}` for `onClick={() => selectChain(DEFAULT_CHAIN_ID)}` and delete the now-unused `switchToDefault`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib`
Expected: clean.

Then verify at runtime — connected-state UI needs an injected EIP-1193 provider, so use the `verify` skill's dev-server + Playwright mock. Check: chip shows the chain; opening the sheet fetches the other chain's balances (network tab shows exactly one extra batch, and only on open); selecting the other chain shows `switching…`; rejecting in the mock wallet leaves the sheet open with `Switch declined in wallet.`

- [ ] **Step 7: Commit**

```bash
git add components/WalletMenu.tsx
git commit -m "feat(wallet): let the user pick a chain, and say what happens when they do"
```

---

### Task 9: `WalletStatus` — name the chain, and give the empty state an exit

**Files:**
- Modify: `components/WalletStatus.tsx`

**Interfaces:**
- Consumes: `useBalances` (Task 5), `highestValue` (Task 2), `chainLabel`, `SUPPORTED_CHAIN_IDS`.
- Produces: nothing.

- [ ] **Step 1: Label the panel with the chain**

Replace the heading (`:32`):

```tsx
<p className="heading-sub text-[10px]">
  Wallet · {chainLabel(chainId).toLowerCase()}
</p>
```

`chainId` comes from `useChainId()`, added to the imports.

- [ ] **Step 2: Give the empty state somewhere to go**

The current dead end is `No stable balances on this chain.` (`:47-49`). Replace with a block that looks at the other chain — the one moment a spare RPC call earns its keep, because the user is stuck:

```tsx
const hasFunds = balances.some((b) => b.balance > 0n);
const otherChainId = SUPPORTED_CHAIN_IDS.find((id) => id !== chainId);
// Only when this chain is empty. The funded path costs nothing extra.
const other = useBalances({
  chainId: otherChainId,
  enabled: !isLoading && !hasFunds && otherChainId !== undefined && !isMiniPay,
});
const otherTop = highestValue(other.balances);
```

and in the empty branch:

```tsx
<div className="flex flex-col gap-1.5">
  <span className="text-xs font-sans text-muted-foreground">
    No balance on {chainLabel(chainId)}.
  </span>
  {otherTop && otherChainId !== undefined && (
    <span className="text-xs font-sans text-muted-foreground">
      You have{' '}
      <span className="font-mono text-money text-foreground">
        {otherTop.symbol} {Number(formatUnits(otherTop.balance, otherTop.decimals)).toFixed(2)}
      </span>{' '}
      on {chainLabel(otherChainId)} — open the wallet menu to switch.
    </span>
  )}
</div>
```

The copy points at the picker rather than duplicating a switch button here; there must stay exactly one place that switches chains.

MiniPay is excluded from the probe (`!isMiniPay`) because it cannot act on the answer.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && pnpm lint`

Runtime, via the `verify` skill: with a funded wallet, no extra request fires for the other chain. With an empty wallet on Base, the panel names Celo and its balance.

- [ ] **Step 4: Commit**

```bash
git add components/WalletStatus.tsx
git commit -m "feat(wallet): turn the empty-balance dead end into a way out"
```

---

### Task 10: The pay-moment line

`unlock()` is the only path to `pay()`, but three CTAs reach it. One shared component, three call sites.

**Files:**
- Create: `components/PayContext.tsx`
- Modify: `components/PreviewLocked.tsx`
- Modify: `app/HomeClient.tsx:649-672` (`preview-unavailable`), `app/HomeClient.tsx:673-700` (`spend-unavailable`)

**Interfaces:**
- Consumes: `useGasSponsorship`/`gasNote` (Task 6), `chainLabel`.
- Produces: `PayContext({ symbol, onChange }: { symbol: string; onChange?: () => void })`. It takes the symbol, not a token object — it renders a name and nothing else, so passing a whole token would couple it to `TokenBalance` vs `TokenConfig` for no gain.

- [ ] **Step 1: Create `components/PayContext.tsx`**

```tsx
'use client';

import { useChainId } from 'wagmi';
import { chainLabel } from '@/lib/chainPolicy';
import { useGasSponsorship, gasNote } from '@/lib/useGasSponsorship';

interface Props {
  symbol: string;
  /** Opens the wallet sheet. Omitted where the user cannot change it (MiniPay). */
  onChange?: () => void;
}

/**
 * What is about to be spent, and where — one line under every pay CTA.
 *
 * It exists because the chain is otherwise invisible at the only moment it
 * matters. The gas half is omitted entirely when sponsorship is unknown: see
 * gasNote.
 */
export function PayContext({ symbol, onChange }: Props) {
  const chainId = useChainId();
  const note = gasNote(useGasSponsorship());

  return (
    <p className="flex items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground">
      <span>
        {symbol} on {chainLabel(chainId)}
        {note ? ` · ${note}` : ''}
      </span>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-muted-foreground underline underline-offset-2 hover:text-primary transition-colors"
        >
          change
        </button>
      )}
    </p>
  );
}
```

- [ ] **Step 2: Render it under the `PreviewLocked` CTA**

In `components/PreviewLocked.tsx`, after the `<Button onClick={onUnlock}>` block (`:48-50`), add `<PayContext symbol={tokenSymbol} onChange={onChangeChain} />`. Add both to `Props`:

```tsx
interface Props {
  firstTweet: string;
  lockedCount: number;
  onUnlock: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  tokenSymbol: string;
  onChangeChain?: () => void;
}
```

- [ ] **Step 3: Render it at the other two CTAs**

In `app/HomeClient.tsx`, under the `<Button onClick={unlock}>` at `:658` and the retry at `:688`, add the same `<PayContext symbol={activeToken.symbol} />`. Both branches already guard on `activeToken`.

- [ ] **Step 4: Pass the props from `HomeClient`**

Where `PreviewLocked` is rendered (`:637`), pass `tokenSymbol={activeToken.symbol}`. Leave `onChangeChain` undefined for now — Task 11 wires the sheet-opening callback, and an undefined callback renders no `change` link, which is the correct MiniPay behaviour anyway.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib`

- [ ] **Step 6: Commit**

```bash
git add components/PayContext.tsx components/PreviewLocked.tsx app/HomeClient.tsx
git commit -m "feat(pay): say which chain and token the money leaves from"
```

---

### Task 11: `HomeClient` — wrong-network, retry, and token re-derivation

**Files:**
- Modify: `app/HomeClient.tsx:206-231` (auto-connect), `:938-995` (gates)

**Interfaces:**
- Consumes: `reselectTokenForChain` (Task 2), `useSwitchChain`, `describeSwitchError` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Make the MiniPay connect timeout retryable**

`autoConnectAttempted` is a one-way `useRef`, so a retry button would do nothing without resetting it. Add a retry counter to the effect's dependencies and reset the ref:

```tsx
const [retryNonce, setRetryNonce] = useState(0);

const retryMiniPayConnect = useCallback(() => {
  autoConnectAttempted.current = false;
  setMiniPayTimeout(false);
  setRetryNonce((n) => n + 1);
}, []);
```

Add `retryNonce` to the auto-connect effect's dependency array (`:231`).

Then replace the dead-end copy (`:946-950`) with:

```tsx
<div className="flex flex-col items-center gap-3 max-w-sm text-center">
  <p className="text-sm font-sans text-destructive">
    Could not connect to MiniPay.
  </p>
  <Button onClick={retryMiniPayConnect}>Try again</Button>
  <p className="text-xs font-sans text-muted-foreground">
    Still stuck? Close and reopen CoinOp from the MiniPay app list.
  </p>
</div>
```

- [ ] **Step 2: Make the web wrong-network screen actionable**

Replace the web branch (`:990-995`):

```tsx
<div className="flex flex-col items-center gap-3 max-w-sm text-center">
  <p className="text-sm font-sans text-destructive">Wrong network</p>
  <p className="text-xs font-sans text-muted-foreground leading-snug">
    CoinOp runs on {SUPPORTED_CHAIN_IDS.map(chainLabel).join(' or ')}. Your wallet is on
    chainId {chainId}.
  </p>
  <div className="flex items-center gap-2">
    {SUPPORTED_CHAIN_IDS.map((id) => (
      <Button
        key={id}
        variant={id === DEFAULT_CHAIN_ID ? 'default' : 'outline'}
        onClick={() => switchChain({ chainId: id as Parameters<typeof switchChain>[0]['chainId'] })}
        disabled={switching}
      >
        {switching && pendingChainId === id ? 'Switching…' : `Switch to ${chainLabel(id)}`}
      </Button>
    ))}
  </div>
  {switchError && (
    <p className="font-mono text-[11px] text-destructive">{describeSwitchError(switchError)}</p>
  )}
</div>
```

Both chains are offered — forcing everyone to `DEFAULT_CHAIN_ID` here would contradict the picker. `DEFAULT_CHAIN_ID` is still the visually primary button.

Add at the top of the component:

```tsx
const { switchChain, isPending: switching, variables: switchVars, error: switchError } = useSwitchChain();
const pendingChainId = switching ? switchVars?.chainId ?? null : null;
```

- [ ] **Step 3: Re-derive the payment token when the chain changes**

Add an effect that runs on `chainId` change. It must not fire on first mount, only on an actual change:

```tsx
const prevChainId = useRef<number | null>(null);
const [tokenSwitchNotice, setTokenSwitchNotice] = useState<string | null>(null);

useEffect(() => {
  const previous = prevChainId.current;
  prevChainId.current = chainId;
  if (previous === null || previous === chainId) return;

  const active =
    submitted?.token ?? hotTake?.token ?? newsBreakdown?.token ??
    tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token ?? null;

  const outcome = reselectTokenForChain({
    previousSymbol: active?.symbol ?? null,
    chainId,
    balances,
  });

  if (outcome.kind === 'keep') {
    setTokenSwitchNotice(null);
    return;
  }
  if (outcome.kind === 'switched') {
    applyToken(outcome.symbol);
    setTokenSwitchNotice(`Now paying with ${outcome.symbol} on ${chainLabel(chainId)}`);
    return;
  }
  setTokenSwitchNotice(`No payable balance on ${chainLabel(chainId)}`);
}, [chainId, balances, submitted, hotTake, newsBreakdown, tokenAnalysis, dailyRecap, comparison]);
```

`applyToken` writes the new token into whichever submitted payload is active — add it beside the existing payload setters, mirroring how each `set*` already replaces its payload.

It takes a **symbol**, not the `TokenConfig` that `reselectTokenForChain` returns. The payload fields are typed `TokenBalance` (see `components/HotTakeInput.tsx:23`), which is `TokenConfig` plus `balance`; assigning a bare `TokenConfig` into one is a type error. The symbol came out of `balances` in the first place, so the lookup always resolves:

```tsx
const applyToken = useCallback(
  (symbol: TokenSymbol) => {
    const token = balances.find((b) => b.symbol === symbol);
    if (!token) return;
    if (submitted) setSubmitted({ ...submitted, token });
    else if (hotTake) setHotTake({ ...hotTake, token });
    else if (tokenAnalysis) setTokenAnalysis({ ...tokenAnalysis, token });
    else if (dailyRecap) setDailyRecap({ ...dailyRecap, token });
    else if (comparison) setComparison({ ...comparison, token });
    else if (newsBreakdown) setNewsBreakdown({ ...newsBreakdown, token });
  },
  [balances, submitted, hotTake, tokenAnalysis, dailyRecap, comparison, newsBreakdown],
);
```

and the call site in the effect becomes `applyToken(outcome.symbol)`.

Render `tokenSwitchNotice` above the form area, and clear it whenever the screen changes:

```tsx
{tokenSwitchNotice && (
  <p className="font-mono text-[11px] text-muted-foreground text-center">
    {tokenSwitchNotice}
  </p>
)}
```

- [ ] **Step 4: Disable paying when nothing is payable**

The `none` outcome must actually block. In `unlock()` (`:495`), after resolving `token`, the existing `if (!token) return;` already covers a missing token; add the balance check so a zero balance cannot start a pay that will revert:

```tsx
const payable = balances.find((b) => b.symbol === token.symbol);
if (!payable || payable.balance === 0n) {
  setTokenSwitchNotice(`No ${token.symbol} on ${chainLabel(chainId)}`);
  return;
}
```

- [ ] **Step 5: Wire `onChangeChain`**

`PayContext`'s `change` link must open the sheet that `WalletMenu` owns. Lift that state so there is still exactly one sheet.

In `components/WalletMenu.tsx`, accept optional control props and fall back to internal state:

```tsx
interface WalletMenuProps {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

export function WalletMenu({ open: openProp, onOpenChange }: WalletMenuProps = {}) {
  const [openSelf, setOpenSelf] = useState(false);
  // Controlled when a parent passes `open`, uncontrolled otherwise — so the
  // existing `<WalletMenu />` call sites keep working untouched.
  const open = openProp ?? openSelf;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenSelf(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  // …rest of the component unchanged; every existing setOpen(true/false) call
  // now goes through this wrapper.
```

Replace the existing `const [open, setOpen] = useState(false);` at `:36` with the block above, and add `useCallback` to the React import.

In `app/HomeClient.tsx`, own the state and pass it both ways:

```tsx
const [walletOpen, setWalletOpen] = useState(false);
```

```tsx
{mounted && <WalletMenu open={walletOpen} onOpenChange={setWalletOpen} />}
```

```tsx
<PreviewLocked
  /* …existing props… */
  tokenSymbol={activeToken.symbol}
  onChangeChain={isMiniPay ? undefined : () => setWalletOpen(true)}
/>
```

MiniPay gets `undefined`: `PayContext` renders no `change` link, because there is nothing there to change.

- [ ] **Step 6: Verify**

Run: `pnpm test:lib && npx tsc --noEmit && pnpm lint && pnpm build`

Runtime, via the `verify` skill:
- On Celo, pick cUSD, submit, reach the preview. Switch to Base in the sheet. Expect `Now paying with USDC on Base`, and the pay-moment line to agree.
- Repeat with a Base wallet holding no USDC: expect `No payable balance on Base` and a blocked unlock.
- Force a rejected switch: expect the message, and no state change.

- [ ] **Step 7: Commit**

```bash
git add app/HomeClient.tsx components/WalletMenu.tsx components/PreviewLocked.tsx
git commit -m "feat(wallet): re-derive the payment token when the chain changes"
```

---

## Done when

- `pnpm test:lib` (621 + roughly 30 new), `pnpm test:contracts` (31), `npx tsc --noEmit`, `pnpm lint`, `pnpm build` all clean.
- A web wallet can move between Base and Celo deliberately, and sees balances for both before choosing.
- A declined switch, an unsupported wallet, and a failed MiniPay connect each produce visible, specific copy.
- The chain and token are named under every pay CTA, and "no gas" appears only where `getCapabilities` confirmed it.
- Switching chains mid-flow never carries a token address across chains — blocked in the UI by re-derivation and at the spend by `tokenChainMismatch`.

## Out of scope

Live per-chain price at the pay CTA (still `THREAD_PRICE_LABEL`). See the spec's "Out of scope" for why, and revisit it with the pay flow.
