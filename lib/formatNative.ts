import { formatUnits } from 'viem';

/**
 * Format a native-token amount for the wallet chip. Stables use 2 decimals
 * because they are ~$1; ETH/CELO gas balances are often 0.00x and would
 * otherwise render as "0.00".
 */
export function formatNativeAmount(value: bigint, decimals = 18): string {
  if (value === 0n) return '0';
  const n = Number(formatUnits(value, decimals));
  if (!Number.isFinite(n)) return '0';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  const raw = n.toFixed(6);
  return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}
