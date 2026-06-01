import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress, type Hex, type Address } from 'viem';
import { getContracts } from '../contracts';
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

const { verifyPayment } = await import('./orchestrator');

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

  it('returns the on-chain amount when the ThreadRequested event matches', async () => {
    mockReceipt([log()]);
    await expect(verifyPayment(baseParams)).resolves.toEqual({ amountRaw: AMOUNT });
  });

  it('throws when the tx receipt cannot be fetched', async () => {
    getTransactionReceipt.mockRejectedValue(new Error('not found'));
    await expect(verifyPayment(baseParams)).rejects.toThrow('payment tx not found on chain');
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
});
