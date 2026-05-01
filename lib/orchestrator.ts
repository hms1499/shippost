import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain } from './chains';
import { agentWalletAbi, getContracts } from './contracts';
import { getTokens, type TokenSymbol } from './tokens';

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
