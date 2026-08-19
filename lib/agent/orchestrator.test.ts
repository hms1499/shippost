import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAddress, type Hex, type Address } from 'viem';
import { getContracts, shipPostPaymentAbi } from '../contracts';
import { celoSepolia } from '../chains';

// verifyPayment is the single trustless gate between an attacker-controlled
// /api/generate/stream body and real x402 spend from the AgentWallet. These
// tests lock in that every claimed field is proven against the on-chain
// ThreadRequested event — not trusted.
//
// We mock the two viem boundaries verifyPayment owns the *use* of, not the
// implementation of: createPublicClient (the network) and decodeEventLog (ABI
// decoding is viem's job — what we own is the address filtering and the
// field-by-field comparison that runs on the decoded result). getAddress stays
// real so checksum normalization is exercised for the equality checks.
const getTransactionReceipt = vi.fn();
const readContract = vi.fn();
let decodeImpl: (arg: unknown) => unknown;

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ getTransactionReceipt, readContract }),
    decodeEventLog: (arg: unknown) => decodeImpl(arg),
  };
});

const { verifyPayment, getOnChainPaidAmount } = await import('./orchestrator');

// The real viem, for the tests that want a genuine ABI round-trip rather than
// the decodeEventLog stub above.
const realViem = await vi.importActual<typeof import('viem')>('viem');

const CHAIN_ID = celoSepolia.id;
const PAYMENT_ADDR = getAddress(getContracts(CHAIN_ID).ShipPostPayment);
const OTHER_CONTRACT = getAddress('0x000000000000000000000000000000000000dEaD');
const PAYER = getAddress('0x1111111111111111111111111111111111111111');
const OTHER_ADDR = getAddress('0x2222222222222222222222222222222222222222');
const TOKEN = getAddress('0xb7e155e9d4ab5a97f950c3259dace91b0f6c33f5'); // Celo Sepolia cUSD
const THREAD_ID = 42n;
const AMOUNT = 50_000_000_000_000_000n; // 0.05 cUSD (18 decimals)

interface EvtArgs {
  user: Address;
  threadId: bigint;
  mode: number;
  token: Address;
  amount: bigint;
}

const defaultArgs: EvtArgs = {
  user: PAYER,
  threadId: THREAD_ID,
  mode: 0,
  token: TOKEN,
  amount: AMOUNT,
};

// A ThreadRequested log carries no real encoding here — decodeEventLog is
// mocked — so topics/data are placeholders. Only `address` is read by the
// contract-filter step before decode.
function log(emitter: Address = PAYMENT_ADDR) {
  return { address: emitter, topics: ['0x' as Hex], data: '0x' as Hex };
}

function decodesTo(args: Partial<EvtArgs>) {
  decodeImpl = () => ({ eventName: 'ThreadRequested', args: { ...defaultArgs, ...args } });
}

function mockReceipt(logs: unknown[], status: 'success' | 'reverted' = 'success') {
  getTransactionReceipt.mockResolvedValue({ status, logs });
}

const baseParams = {
  chainId: CHAIN_ID,
  payTxHash: '0xabc' as Hex,
  threadId: THREAD_ID,
  walletAddress: PAYER,
  tokenAddress: TOKEN,
  mode: 0 as const,
};

describe('verifyPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readContract.mockResolvedValue(AMOUNT); // requiredAmount() returns the canonical price
    decodesTo({}); // default: a fully matching ThreadRequested event
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the on-chain amount when the ThreadRequested event matches', async () => {
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).resolves.toEqual({ amountRaw: AMOUNT });
  });

  // A node that has not caught up yet answers exactly like one that never will:
  // viem throws TransactionReceiptNotFoundError, and because the transport
  // itself succeeded (a null result is a valid answer), the fallback() in
  // lib/rpc.ts never rotates to another RPC. The 402 that produced landed
  // BEFORE the pending row is inserted, so the thread was paid for on chain
  // with no record anywhere to refund from — Base threads 1000007 and 1000008
  // were lost that way on 2026-08-19.
  it('retries a receipt the node has not caught up to yet', async () => {
    getTransactionReceipt
      .mockRejectedValueOnce(new Error('TransactionReceiptNotFoundError'))
      .mockRejectedValueOnce(new Error('TransactionReceiptNotFoundError'))
      .mockResolvedValue({ status: 'success', logs: [log()] });

    vi.useFakeTimers();
    const p = verifyPayment(baseParams);
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(p).resolves.toEqual({ amountRaw: AMOUNT });
    expect(getTransactionReceipt).toHaveBeenCalledTimes(3);
  });

  it('gives up after a bounded number of attempts', async () => {
    getTransactionReceipt.mockRejectedValue(new Error('not found'));

    vi.useFakeTimers();
    const p = verifyPayment(baseParams);
    const settled = expect(p).rejects.toThrow('payment tx not found on chain');
    await vi.advanceTimersByTimeAsync(120_000);
    await settled;

    // Bounded: a permanently missing tx must not hold the request open.
    expect(getTransactionReceipt.mock.calls.length).toBeGreaterThan(1);
    expect(getTransactionReceipt.mock.calls.length).toBeLessThanOrEqual(6);
  });

  // Retrying is only correct for "I have not seen it yet". Everything below is
  // a decided answer, and re-asking cannot change it.
  it('does not retry a receipt that came back reverted', async () => {
    mockReceipt([log()], 'reverted');
    await expect(verifyPayment(baseParams)).rejects.toThrow('payment tx did not succeed');
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it('does not retry an event that fails a field check', async () => {
    decodesTo({ threadId: 999n });
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).rejects.toThrow('threadId does not match');
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it('throws when the payment tx reverted', async () => {
    mockReceipt([log()], 'reverted');
    await expect(verifyPayment(baseParams)).rejects.toThrow('payment tx did not succeed');
  });

  it('throws when there is no ThreadRequested event in the tx', async () => {
    mockReceipt([]);
    await expect(verifyPayment(baseParams)).rejects.toThrow(
      'no ThreadRequested event from ShipPostPayment in this tx',
    );
  });

  it('ignores a ThreadRequested event emitted by a different contract', async () => {
    // A forged event from an attacker contract is filtered by address before
    // decode, so it can never satisfy the check.
    mockReceipt([log(OTHER_CONTRACT)]);
    await expect(verifyPayment(baseParams)).rejects.toThrow(
      'no ThreadRequested event from ShipPostPayment in this tx',
    );
  });

  it('throws when the threadId does not match', async () => {
    decodesTo({ threadId: 999n });
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).rejects.toThrow('threadId does not match');
  });

  it('throws when the payer does not match', async () => {
    decodesTo({ user: OTHER_ADDR });
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).rejects.toThrow('payer does not match');
  });

  it('throws when the token does not match', async () => {
    decodesTo({ token: OTHER_ADDR });
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).rejects.toThrow('token does not match');
  });

  it('throws when the mode does not match', async () => {
    decodesTo({ mode: 1 });
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).rejects.toThrow('mode does not match');
  });

  it('throws when the paid amount is not the canonical required price', async () => {
    // Event fields all match, but requiredAmount() disagrees with the amount in
    // the event — defense in depth against a forged event slipping through.
    mockReceipt([log()]);
    readContract.mockResolvedValue(AMOUNT + 1n);
    await expect(verifyPayment(baseParams)).rejects.toThrow(
      'paid amount does not match required price',
    );
  });

  // The price is settable now, so requiredAmount() read at HEAD is the price
  // *today*, not the price this payment was made at. Reading it at the
  // payment's own block keeps the defence-in-depth check exact instead of
  // rejecting a legitimately paid thread the moment setPrice lands.
  it('reads requiredAmount at the payment block, not at head', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [log()],
      blockNumber: 12345n,
    });

    await verifyPayment(baseParams);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'requiredAmount', blockNumber: 12345n }),
    );
  });
});

// A thread bought at $0.05 must still refund $0.05 after the price moves to
// $0.10. Reading the live requiredAmount() would refund the new price and
// overdraw the reserve — the bug a settable price introduces.
describe('getOnChainPaidAmount', () => {
  const paymentAddr = PAYMENT_ADDR;
  const OLD_PRICE = 50_000n; // $0.05 at 6 decimals

  beforeEach(() => {
    vi.clearAllMocks();
    // Real decoding here: this function's whole job is to pick one event out of
    // a receipt, so stubbing the decode would test nothing.
    decodeImpl = (arg: unknown) =>
      realViem.decodeEventLog(arg as Parameters<typeof realViem.decodeEventLog>[0]);
  });

  function threadRequestedLog(threadId: bigint, amount: bigint, emitter: Address = paymentAddr) {
    return {
      address: emitter,
      topics: realViem.encodeEventTopics({
        abi: shipPostPaymentAbi,
        eventName: 'ThreadRequested',
        args: { user: PAYER, threadId },
      }),
      data: realViem.encodeAbiParameters(
        [{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }],
        [0, TOKEN, amount],
      ),
    };
  }

  it('returns the amount from the thread ThreadRequested event, not the current price', async () => {
    const getTxReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      logs: [threadRequestedLog(100042n, OLD_PRICE)],
    });

    const amount = await getOnChainPaidAmount({
      chainId: CHAIN_ID,
      payTxHash: '0xabc' as Hex,
      threadId: 100042n,
      readers: { getTransactionReceipt: getTxReceipt },
    });

    expect(amount).toBe(OLD_PRICE);
  });

  it('ignores a ThreadRequested for a different threadId in the same tx', async () => {
    const getTxReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      logs: [threadRequestedLog(999n, 1n), threadRequestedLog(100042n, OLD_PRICE)],
    });

    await expect(
      getOnChainPaidAmount({
        chainId: CHAIN_ID,
        payTxHash: '0xabc' as Hex,
        threadId: 100042n,
        readers: { getTransactionReceipt: getTxReceipt },
      }),
    ).resolves.toBe(OLD_PRICE);
  });

  it('ignores an event emitted by a contract that is not ours', async () => {
    const getTxReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      logs: [threadRequestedLog(100042n, OLD_PRICE, OTHER_CONTRACT)],
    });

    await expect(
      getOnChainPaidAmount({
        chainId: CHAIN_ID,
        payTxHash: '0xabc' as Hex,
        threadId: 100042n,
        readers: { getTransactionReceipt: getTxReceipt },
      }),
    ).rejects.toThrow(/ThreadRequested/);
  });

  it('throws when the receipt holds no ThreadRequested for that threadId', async () => {
    const getTxReceipt = vi.fn().mockResolvedValue({ status: 'success', logs: [] });

    await expect(
      getOnChainPaidAmount({
        chainId: CHAIN_ID,
        payTxHash: '0xabc' as Hex,
        threadId: 100042n,
        readers: { getTransactionReceipt: getTxReceipt },
      }),
    ).rejects.toThrow(/ThreadRequested/);
  });

  it('throws when the payment tx did not succeed', async () => {
    const getTxReceipt = vi.fn().mockResolvedValue({ status: 'reverted', logs: [] });

    await expect(
      getOnChainPaidAmount({
        chainId: CHAIN_ID,
        payTxHash: '0xabc' as Hex,
        threadId: 100042n,
        readers: { getTransactionReceipt: getTxReceipt },
      }),
    ).rejects.toThrow(/did not succeed/);
  });
});
