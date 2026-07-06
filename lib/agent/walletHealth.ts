import { createPublicClient, http, erc20Abi, formatUnits, type Address } from 'viem';
import { getChain } from '../chains';
import { getContracts } from '../contracts';
import { getTokens, type TokenSymbol } from '../tokens';

// Heartbeat check for the agent wallet's stablecoin balances. settleX402Call
// spends in whatever token the user paid, so a dry token means every run paid in
// that token hard-fails (refundable, but silently and en masse). This reports
// which tokens are below a USD floor so the cron can page a human while there is
// still time to top up. All three tokens are ~$1 pegged, so the decimal-adjusted
// balance is treated directly as USD.

export type BalanceReader = (tokenAddress: Address) => Promise<bigint>;

export interface WalletHealth {
  low: TokenSymbol[]; // tokens strictly below minUsd
  balances: Record<TokenSymbol, number>; // human ≈USD per token
}

export async function checkAgentWalletBalance(params: {
  chainId: number;
  minUsd: number;
  readBalanceOf?: BalanceReader;
}): Promise<WalletHealth> {
  const { chainId, minUsd } = params;
  const tokens = getTokens(chainId);
  const read = params.readBalanceOf ?? defaultReader(chainId);

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

// Real reader: erc20 balanceOf(AgentWallet) via a viem public client. Resolved
// lazily so callers that inject a reader (tests) never touch RPC or contract env.
function defaultReader(chainId: number): BalanceReader {
  const agentWallet = getContracts(chainId).AgentWallet;
  const publicClient = createPublicClient({ chain: getChain(chainId), transport: http() });
  return (tokenAddress) =>
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [agentWallet],
    }) as Promise<bigint>;
}
