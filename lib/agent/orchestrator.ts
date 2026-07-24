import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, erc20Abi, decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain } from '../chains';
import { agentWalletAbi, shipPostPaymentAbi, getContracts } from '../contracts';
import { getTokens, computeX402CostAmount, type TokenSymbol } from '../tokens';

export async function settleX402Call(params: {
  chainId: number;
  serviceAddress: Address;
  tokenSymbol: TokenSymbol;
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
  // Amount is derived from the token's own decimals here — callers pass only the
  // token symbol, so a step can never hand us a wrong-scaled bigint (e.g. an
  // 18-decimal amount for 6-decimal USDT).
  const amount = computeX402CostAmount(token);

  const hash = await wallet.writeContract({
    address: contracts.AgentWallet,
    abi: agentWalletAbi,
    functionName: 'executeX402Call',
    args: [params.serviceAddress, token.address, amount, params.threadId],
  });
  // Bound the wait: a stuck tx or dead RPC must not hang the whole generation
  // until maxDuration (user paid, no content). A timeout throws cleanly ->
  // pipeline fails -> thread refundable, which is the correct outcome.
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
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

// Verify a payForThread payment actually happened on-chain before doing any
// paid work. The /api/generate/stream body is fully attacker-controlled, so
// every field a caller claims (threadId, payer, token, mode, amount) must be
// proven against the ThreadRequested event emitted by our payment contract —
// not trusted. Returns the on-chain amount so callers store the real value
// instead of the client-supplied amount_paid_raw.
export async function verifyPayment(params: {
  chainId: number;
  payTxHash: Hex;
  threadId: bigint;
  walletAddress: Address;
  tokenAddress: Address;
  mode: number;
}): Promise<{ amountRaw: bigint }> {
  const chain = getChain(params.chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const contracts = getContracts(params.chainId);
  const paymentAddr = getAddress(contracts.ShipPostPayment);

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: params.payTxHash });
  } catch {
    throw new Error('payment tx not found on chain');
  }
  if (receipt.status !== 'success') {
    throw new Error('payment tx did not succeed');
  }

  // Find the ThreadRequested log emitted *by our contract* (don't rely on
  // receipt.to — tolerate router/multicall paths).
  let evt:
    | { user: Address; threadId: bigint; mode: number; token: Address; amount: bigint }
    | null = null;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== paymentAddr) continue;
    try {
      const decoded = decodeEventLog({
        abi: shipPostPaymentAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'ThreadRequested') {
        evt = decoded.args as unknown as {
          user: Address;
          threadId: bigint;
          mode: number;
          token: Address;
          amount: bigint;
        };
        break;
      }
    } catch {
      // not the event we want — keep scanning
    }
  }
  if (!evt) {
    throw new Error('no ThreadRequested event from ShipPostPayment in this tx');
  }

  if (evt.threadId !== params.threadId) {
    throw new Error('threadId does not match the payment tx');
  }
  if (getAddress(evt.user) !== getAddress(params.walletAddress)) {
    throw new Error('payer does not match the payment tx');
  }
  if (getAddress(evt.token) !== getAddress(params.tokenAddress)) {
    throw new Error('token does not match the payment tx');
  }
  if (Number(evt.mode) !== params.mode) {
    throw new Error('mode does not match the payment tx');
  }

  // Defense in depth: the amount pulled must equal the canonical price for
  // that token, so a forged event (wrong contract somehow) still can't pass.
  const required = (await publicClient.readContract({
    address: paymentAddr,
    abi: shipPostPaymentAbi,
    functionName: 'requiredAmount',
    args: [params.tokenAddress],
  })) as bigint;
  if (evt.amount !== required) {
    throw new Error('paid amount does not match required price');
  }

  return { amountRaw: evt.amount };
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
  onchainThreadId: string;
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
  const contracts = getContracts(params.chainId);

  // Refunds are paid from the payment contract's accumulated reserve (its own
  // token balance), NOT the deployer EOA — see ShipPostPayment.refund. The
  // deployer key here is the contract owner that authorizes the call. Pre-check
  // the reserve for a clear "drained" error instead of an opaque revert.
  const reserve = (await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [contracts.ShipPostPayment],
  })) as bigint;
  if (reserve < amount) {
    throw new Error(
      `refund reserve on ${contracts.ShipPostPayment} has insufficient ${params.tokenSymbol}: ` +
        `need ${params.amountHuman}, have ${formatUnits(reserve, token.decimals)} — top up the reserve before retrying`,
    );
  }

  const hash = await wallet.writeContract({
    address: contracts.ShipPostPayment,
    abi: shipPostPaymentAbi,
    functionName: 'refund',
    args: [BigInt(params.onchainThreadId), token.address, params.to, amount],
  });
  // Bound the wait so refund:process can't hang indefinitely on a dead RPC.
  // The tx is already broadcast here — a timeout is the "on-chain state
  // unknown" case the runbook covers (row left 'processing', verify manually).
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return hash;
}
