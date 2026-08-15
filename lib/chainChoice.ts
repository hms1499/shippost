import { getTokens, type TokenConfig, type TokenSymbol } from './tokens';
import { SUPPORTED_CHAIN_IDS, chainLabel } from './chainPolicy';

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

export interface ChainOption {
  chainId: number;
  label: string;
  isCurrent: boolean;
  /** Balances not fetched yet — render `·····`, never `0.00`. */
  isLoading: boolean;
  /** The read for this chain settled but failed — distinct from still loading. */
  hasFailed: boolean;
  hasFunds: boolean;
  tokens: readonly TokenBalanceLike[];
}

/**
 * One row per supported chain, for the ChainPicker.
 *
 * balancesByChain[chainId] === undefined is ambiguous on its own — it means
 * either "still loading" or "the read failed" (useBalances now distinguishes
 * the two via isError). failedChainIds resolves that ambiguity so a failed
 * chain renders an explicit failure state instead of spinning forever.
 */
export function buildChainOptions(params: {
  currentChainId: number;
  balancesByChain: Record<number, readonly TokenBalanceLike[] | undefined>;
  failedChainIds: readonly number[];
}): ChainOption[] {
  return SUPPORTED_CHAIN_IDS.map((chainId) => {
    const tokens = params.balancesByChain[chainId];
    const hasFailed = params.failedChainIds.includes(chainId);
    return {
      chainId,
      label: chainLabel(chainId),
      isCurrent: chainId === params.currentChainId,
      isLoading: tokens === undefined && !hasFailed,
      hasFailed,
      // Enforced here, not left to the caller: a chain whose balances could
      // not be read has no known funds. Inferring funds from token data that
      // happens to survive a failed refetch would state as fact something we
      // do not actually know — the same fabricated-number class `isLoading`
      // already guards against.
      hasFunds: hasFailed ? false : (tokens ?? []).some((t) => t.balance > 0n),
      tokens: tokens ?? [],
    };
  });
}
