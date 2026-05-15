import { createWalletClient, createPublicClient, http, parseUnits, erc20Abi, type Address, type Hex } from 'viem';
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

  const hash = await wallet.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [params.to, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
