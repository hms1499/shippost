import { createPublicClient, http, erc20Abi, formatUnits, parseEther, type Address } from 'viem';
import { getChain } from '../chains';
import { agentWalletAbi, getContracts } from '../contracts';
import { computeX402CostAmount, getTokens, type TokenSymbol } from '../tokens';

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
    // Keys come from the map itself, so this cannot miss — the guard is here
    // only because the map is Partial (Base has no cUSD).
    if (!token) continue;
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

// ---------------------------------------------------------------------------
// Spend readiness — asked BEFORE the user signs payForThread, so a run we
// provably cannot settle never takes their money.
//
// Deliberately NOT a token-balance check. payForThread transfers 50% of the
// $0.05 to the AgentWallet in the SAME token, in the same tx, and the route
// only generates after verifyPayment confirms it — so every thread arrives
// with $0.025 against a $0.004 worst case. Mainnet cUSD balance is 0 right
// now, and those threads still succeed; `balance >= cost` here would block all
// of them. If a balance predicate is ever wanted it must be
// `balance + agentShare >= maxSpend`. See
// docs/superpowers/specs/2026-07-27-preflight-spend-readiness-design.md.
//
// What this checks is what can still fail after the money is taken: the
// kill-switch, gas on the orchestrator EOA, and daily cap headroom.

export type SpendReadiness = { ok: true } | { ok: false; reason: 'paused' | 'gas' | 'cap' };

export interface ReadinessReaders {
  readPaused: () => Promise<boolean>;
  readOwner: () => Promise<Address>;
  readNativeBalance: (address: Address) => Promise<bigint>;
  readDailyCap: (token: Address) => Promise<bigint>;
  readSpentToday: (token: Address) => Promise<bigint>;
}

// Mode B fires the most x402 calls of any mode (serper, coingecko, groq,
// factCheck), so a thread must have headroom for four to avoid dying mid-run.
const MAX_X402_CALLS_PER_THREAD = 4n;

// ~0.002 of the native token settles one executeX402Call, so this floor is
// roughly 25 threads of runway — enough for the cron heartbeat to page a human
// before users are ever blocked. Deliberately one number for both chains: it is
// a floor, and ETH gas on Base is cheaper than CELO gas, so it errs safe.
const DEFAULT_MIN_GAS_NATIVE = 0.05;

export interface GasHealth {
  low: boolean;
  native: number; // human units of the chain's native token on the orchestrator EOA
  address: Address;
}

// Native-gas heartbeat for the EOA that signs executeX402Call. The ERC-20
// checks above cannot see this: a wallet full of stablecoins still cannot
// settle anything once its signer is out of native gas. Named minNative rather
// than minCelo because an ETH threshold is not a CELO threshold.
export async function checkOrchestratorGas(params: {
  chainId: number;
  minNative?: number;
  readers?: Pick<ReadinessReaders, 'readOwner' | 'readNativeBalance'>;
}): Promise<GasHealth> {
  const readers = params.readers ?? defaultReadinessReaders(params.chainId);
  // Read from the chain rather than deriving it from AGENT_WALLET_PRIVATE_KEY —
  // nothing here touches a private key.
  const address = await readers.readOwner();
  const raw = await readers.readNativeBalance(address);
  const min = parseEther(String(params.minNative ?? DEFAULT_MIN_GAS_NATIVE));
  return { low: raw < min, native: Number(formatUnits(raw, 18)), address };
}

export async function checkSpendReadiness(params: {
  chainId: number;
  tokenSymbol: TokenSymbol;
  minGasNative?: number;
  readers?: ReadinessReaders;
}): Promise<SpendReadiness> {
  const readers = params.readers ?? defaultReadinessReaders(params.chainId);

  // Ordered by how actionable the answer is: a paused wallet explains
  // everything else, so it must win over the symptoms it causes.
  if (await readers.readPaused()) return { ok: false, reason: 'paused' };

  const gas = await checkOrchestratorGas({
    chainId: params.chainId,
    minNative: params.minGasNative,
    readers,
  });
  if (gas.low) return { ok: false, reason: 'gas' };

  const token = getTokens(params.chainId)[params.tokenSymbol];
  if (!token) {
    throw new Error(`token ${params.tokenSymbol} not configured for chain ${params.chainId}`);
  }
  const [cap, spent] = await Promise.all([
    readers.readDailyCap(token.address),
    readers.readSpentToday(token.address),
  ]);
  // A token whose cap was never set reads 0 here, which reverts CAP_EXCEEDED on
  // every call — the subtraction catches that case for free.
  if (cap - spent < computeX402CostAmount(token) * MAX_X402_CALLS_PER_THREAD) {
    return { ok: false, reason: 'cap' };
  }

  return { ok: true };
}

// Real readers against the AgentWallet. Never constructed when readers are
// injected (tests), so no RPC is touched there.
function defaultReadinessReaders(chainId: number): ReadinessReaders {
  const publicClient = createPublicClient({ chain: getChain(chainId), transport: http() });
  const agentWallet = getContracts(chainId).AgentWallet;
  const read = <T>(functionName: string, args?: readonly unknown[]) =>
    publicClient.readContract({
      address: agentWallet,
      abi: agentWalletAbi,
      functionName,
      ...(args ? { args } : {}),
    } as never) as Promise<T>;

  return {
    readPaused: () => read<boolean>('paused'),
    readOwner: () => read<Address>('owner'),
    readNativeBalance: (address) => publicClient.getBalance({ address }),
    readDailyCap: (token) => read<bigint>('dailySpendCap', [token]),
    readSpentToday: async (token) =>
      read<bigint>('spentOnDay', [await read<bigint>('currentDay'), token]),
  };
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
