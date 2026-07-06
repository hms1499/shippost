import { createPublicClient, http, erc20Abi, formatUnits, type Address } from 'viem';
import { getChain } from '../chains';
import { getContracts } from '../contracts';
import { getTokens, type TokenSymbol } from '../tokens';

// Heartbeat checks for the two money-holding addresses:
//   - the AgentWallet, which settles x402 in whatever token the user paid, so a
//     dry token silently mass-fails every run paid in it;
//   - the payment contract's reserve, which funds refunds, so a dry reserve
//     makes refunds fail.
// Both are per-token (all three stablecoins are ~$1 pegged, so the decimal-
// adjusted balance is treated directly as USD). Reports which tokens sit below a
// floor so the cron can page a human while there is still time to top up.

export type BalanceReader = (tokenAddress: Address) => Promise<bigint>;

export interface BalanceHealth {
  low: TokenSymbol[]; // tokens strictly below minUsd
  balances: Record<TokenSymbol, number>; // human ≈USD per token
}

async function checkHolderBalances(params: {
  chainId: number;
  holder: Address;
  minUsd: number;
  readBalanceOf?: BalanceReader;
}): Promise<BalanceHealth> {
  const { chainId, holder, minUsd } = params;
  const tokens = getTokens(chainId);
  const read = params.readBalanceOf ?? defaultReader(chainId, holder);

  const balances = {} as Record<TokenSymbol, number>;
  const low: TokenSymbol[] = [];

  for (const symbol of Object.keys(tokens) as TokenSymbol[]) {
    const token = tokens[symbol];
    const raw = await read(token.address);
    const usd = Number(formatUnits(raw, token.decimals));
    balances[symbol] = usd;
    if (usd < minUsd) low.push(symbol);
  }

  return { low, balances };
}

export function checkAgentWalletBalance(params: {
  chainId: number;
  minUsd: number;
  readBalanceOf?: BalanceReader;
}): Promise<BalanceHealth> {
  return checkHolderBalances({ ...params, holder: getContracts(params.chainId).AgentWallet });
}

export function checkReserveBalance(params: {
  chainId: number;
  minUsd: number;
  readBalanceOf?: BalanceReader;
}): Promise<BalanceHealth> {
  return checkHolderBalances({ ...params, holder: getContracts(params.chainId).ShipPostPayment });
}

// Real reader: erc20 balanceOf(holder) via a viem public client. When a reader
// is injected (tests) this is never constructed, so no RPC is touched.
function defaultReader(chainId: number, holder: Address): BalanceReader {
  const publicClient = createPublicClient({ chain: getChain(chainId), transport: http() });
  return (tokenAddress) =>
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder],
    }) as Promise<bigint>;
}
