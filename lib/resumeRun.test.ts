import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  interpretThreadRow,
  fetchThreadRow,
  RESUME_POLL_MS,
  RESUME_CEILING_MS,
  type ThreadRow,
} from './resumeRun';

const DONE: ThreadRow = {
  status: 'completed',
  tweets: ['1/ hook', '2/ body'],
  topic: 'zk rollups',
  amountPaidRaw: '100000000000000000',
  totalCostUsd: '0.003',
  tokenSymbol: 'cUSD',
  payTxHash: '0x7f3a',
};

describe('interpretThreadRow', () => {
  it('keeps checking while the row is pending', () => {
    expect(interpretThreadRow({ ...DONE, status: 'pending', tweets: null })).toEqual({
      state: 'checking',
    });
  });

  it('keeps checking when the row does not exist yet', () => {
    // The row is inserted by /api/generate/stream. A client that died between
    // the payment landing and that request finds nothing here for a moment.
    expect(interpretThreadRow(null)).toEqual({ state: 'checking' });
  });

  it('reports done with the tweets and the verified amount once completed', () => {
    expect(interpretThreadRow(DONE)).toEqual({
      state: 'done',
      tweets: ['1/ hook', '2/ body'],
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.003',
      topic: 'zk rollups',
    });
  });

  it('defaults a missing total cost rather than inventing one', () => {
    const out = interpretThreadRow({ ...DONE, totalCostUsd: null });
    expect(out).toEqual({
      state: 'done',
      tweets: ['1/ hook', '2/ body'],
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.000',
      topic: 'zk rollups',
    });
  });

  it('passes a missing amount through as null rather than substituting a price', () => {
    const out = interpretThreadRow({ ...DONE, amountPaidRaw: null });
    expect(out).toEqual({
      state: 'done',
      tweets: ['1/ hook', '2/ body'],
      amountPaidRaw: null,
      totalCostUsd: '0.003',
      topic: 'zk rollups',
    });
  });

  it('reports failed when the run failed', () => {
    expect(interpretThreadRow({ ...DONE, status: 'failed', tweets: null })).toEqual({
      state: 'failed',
    });
  });

  it('treats completed-with-no-tweets as a failure, not a success', () => {
    expect(interpretThreadRow({ ...DONE, tweets: [] })).toEqual({ state: 'failed' });
    expect(interpretThreadRow({ ...DONE, tweets: null })).toEqual({ state: 'failed' });
  });

  it('treats an unrecognised status as still running', () => {
    expect(interpretThreadRow({ ...DONE, status: 'queued' })).toEqual({ state: 'checking' });
  });
});

describe('timing constants', () => {
  it('polls often enough to feel live and stops well before the TTL', () => {
    expect(RESUME_POLL_MS).toBe(3_000);
    expect(RESUME_CEILING_MS).toBe(180_000);
  });
});

describe('fetchThreadRow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The wallet is not decoration: without it the route serves any thread id to
  // anyone, so a caller that forgets it must be caught here rather than in prod.
  it('requests the thread by chain, id and owning wallet', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => DONE,
    });
    const out = await fetchThreadRow(42220, '4182', '0xAbCdEf0123456789abcdef0123456789ABCDEF01');
    expect(out).toEqual(DONE);
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(
      '/api/thread?chainId=42220&threadId=4182&wallet=0xabcdef0123456789abcdef0123456789abcdef01',
    );
  });

  it('returns null on 404 so the caller keeps waiting', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    });
    expect(await fetchThreadRow(42220, '4182', '0xabc')).toBeNull();
  });

  it('returns null when the network throws', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    expect(await fetchThreadRow(42220, '4182', '0xabc')).toBeNull();
  });
});
