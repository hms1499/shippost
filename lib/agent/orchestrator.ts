import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, erc20Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain } from '../chains';
import { agentWalletAbi, shipPostPaymentAbi, getContracts } from '../contracts';
import { getTokens, type TokenSymbol } from '../tokens';

export async function settleX402Call(params: {
  chainId: number;
  serviceAddress: Address;
  tokenSymbol: TokenSymbol;
  amount: bigint;
  threadId: bigint;
}) {
  const pk = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error('AGENT_WALLET_PRIVATE_KEY missing');

  const account = privateKeyToAccount(pk);
  const chain = getChain(params.chainId);

  const wallet = createWalletClient({ account, chain, transport: http() });
  const publicClient = createPublicClient({ chain, transport: http() });

  const contracts = getContracts(params.chainId);
  const token = getTokens(params.chainId)[params.tokenSymbol];

  const hash = await wallet.writeContract({
    address: contracts.AgentWallet,
    abi: agentWalletAbi,
    functionName: 'executeX402Call',
    args: [params.serviceAddress, token.address, params.amount, params.threadId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// Canonical refundable base: payForThread always pulls exactly
// requiredAmount(token), so the trustless paid amount is that on-chain value —
// never the client-supplied amount_paid_raw stored in Supabase (which an
// attacker controls via the /api/generate/stream body).
export async function getOnChainPaidAmount(params: {
  chainId: number;
  tokenSymbol: TokenSymbol;
}): Promise<bigint> {
  const chain = getChain(params.chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const contracts = getContracts(params.chainId);
  const token = getTokens(params.chainId)[params.tokenSymbol];

  const amount = await publicClient.readContract({
    address: contracts.ShipPostPayment,
    abi: shipPostPaymentAbi,
    functionName: 'requiredAmount',
    args: [token.address],
  });
  return amount as bigint;
}

// MVP refund: direct ERC20 transfer from the deployer/reserve EOA to the user.
// Spec says refund comes from "reserve" — Week 1 deploy uses deployer EOA as reserve,
// so this avoids a contract change while still demonstrating the audit trail.
//
// ACCOUNTING CAVEAT: the contract only routes 10% (reserveBp) into the reserve
// pool, but a `full` refund returns 100% of the price. The shortfall is
// effectively paid out of the deployer EOA's own balance, not user fees. This
// is acceptable for the competition MVP but is NOT sustainable — a proper fix
// is an on-chain refund() that draws from accumulated reserve. Tracked as a
// follow-up; do not scale full-refund volume on this path.
export async function refundThread(params: {
  chainId: number;
  to: Address;
  tokenSymbol: TokenSymbol;
  amountHuman: string;
  reason: string;
}): Promise<Hex> {
  const pk = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY missing');

  const account = privateKeyToAccount(pk);
  const chain = getChain(params.chainId);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const publicClient = createPublicClient({ chain, transport: http() });

  const token = getTokens(params.chainId)[params.tokenSymbol];
  const amount = parseUnits(params.amountHuman, token.decimals);

  // Fail with a clear, actionable error instead of an opaque ERC20 revert when
  // the refund source is drained.
  const balance = (await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint;
  if (balance < amount) {
    throw new Error(
      `refund source ${account.address} has insufficient ${params.tokenSymbol}: ` +
        `need ${params.amountHuman}, have ${formatUnits(balance, token.decimals)} — top up before retrying`,
    );
  }

  const hash = await wallet.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [params.to, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
