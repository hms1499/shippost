import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const settleX402Call = vi.fn();
const create = vi.fn();
vi.mock('@/lib/agent/orchestrator', () => ({ settleX402Call }));
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create } }; } }));

const { runFactCheckStep } = await import('./factCheckStep');

const ctx = {
  chainId: 84532,
  threadId: 1n,
  topic: 't',
  audience: 'beginner' as const,
  agentWallet: '0xw' as const,
  tokenSymbol: 'cUSD' as const,
};
const input = { tweets: ['1/ a', '2/ b'], searchSummary: null, marketData: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GROQ_API_KEY', 'k');
  create.mockResolvedValue({ choices: [{ message: { content: '1/ checked\n\n2/ ok' } }] });
  settleX402Call.mockResolvedValue('0xfc');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// 296 chars, one clean seam: a hedge the fact-check added pushed it over.
const LONG =
  '2/ Base sequencer revenue hit $2.1M in July, up 40% from June. Almost all of it comes from L1 data costs falling after Dencun, not from more users. Daily transactions are flat at 8M. The margin story is a blob pricing story, and blob prices are set by whoever else is bidding for that same space.';

describe('runFactCheckStep length fitting', () => {
  it('splits an over-long revision and delivers the fitted thread', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: `1/ checked\n\n${LONG}` } }] });
    const events: { type: string; output?: string[] }[] = [];
    const out = await runFactCheckStep(ctx, input, (e) => events.push(e as never));
    expect(out.tweets).toHaveLength(3);
    expect(out.tweets.every((t) => t.length <= 280)).toBe(true);
    const delivered = events.find((e) => e.type === 'step_output');
    expect(delivered?.output).toEqual(out.tweets);
  });

  it('counts BEFORE fitting, so a split revision still passes the count check', async () => {
    // Two tweets in, two tweets back — the check passes. Fitting then makes it
    // three. Fitting first would have failed the check and dropped the whole
    // fact-check, delivering the unchecked draft instead.
    create.mockResolvedValue({ choices: [{ message: { content: `1/ checked\n\n${LONG}` } }] });
    const events: { type: string }[] = [];
    const out = await runFactCheckStep(ctx, input, (e) => events.push(e as never));
    expect(out.tweets).toHaveLength(3);
    expect(events.some((e) => e.type === 'step_failed')).toBe(false);
  });

  it('still settles before it emits the fitted content', async () => {
    // Base settles soft steps as a bookkeeping emit (settleSoftStep.ts:21), so
    // the ordering that matters is the event order, not the on-chain call.
    const order: string[] = [];
    create.mockResolvedValue({ choices: [{ message: { content: `1/ checked\n\n${LONG}` } }] });
    await runFactCheckStep(ctx, input, (e) => {
      if (e.type === 'step_settled' || e.type === 'step_output') {
        order.push(e.type === 'step_settled' ? 'settle' : 'emit');
      }
    });
    expect(order).toEqual(['settle', 'emit']);
  });
});

describe('runFactCheckStep', () => {
  it('does not settle when the run is already aborted (no spend after deadline)', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runFactCheckStep({ ...ctx, signal: ac.signal }, input, () => {})).rejects.toThrow(/abort/i);
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('skips executeX402Call on Base and records a zero-cost settle', async () => {
    const events: { type: string; txHash?: string; costAmount?: string }[] = [];
    const out = await runFactCheckStep({ ...ctx, chainId: 8453, tokenSymbol: 'USDC' }, input, (e) => events.push(e));
    expect(out.tweets.length).toBeGreaterThan(0);
    expect(settleX402Call).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'step_settled', step: 'factCheck', txHash: '0x0', costAmount: '0.000' }),
    );
  });

  // The fact-check REPLACES the draft (runModeB.ts:127, unconditionally), and it
  // is the last word on 5 of the 6 modes. So its output has to be checked
  // against the draft it is replacing, not just parsed. The prompt already
  // demands "exactly the same number of tweets ... No commentary, no preamble"
  // (lib/prompts/factCheck.ts) — these are the ways a model ignores that.
  describe('rejects output that is not a plausible replacement for the draft', () => {
    it('rejects a refusal / prose blob that would collapse the thread to one tweet', async () => {
      // parseThread turns unnumbered prose into a SINGLE tweet, so without a
      // count check a 2-tweet draft is delivered as one line of apology.
      create.mockResolvedValue({
        choices: [{ message: { content: 'I cannot verify these claims.' } }],
      });
      const events: { type: string }[] = [];
      await expect(runFactCheckStep(ctx, input, (e) => events.push(e))).rejects.toThrow(/tweet/i);
      // and the bad content must never have been handed to the client
      expect(events.some((e) => e.type === 'step_output')).toBe(false);
      expect(settleX402Call).not.toHaveBeenCalled();
    });

    it('rejects runaway output far longer than the draft', async () => {
      const runaway = Array.from({ length: 60 }, (_, i) => `${i + 1}/ rambling`).join('\n\n');
      create.mockResolvedValue({ choices: [{ message: { content: runaway } }] });
      await expect(runFactCheckStep(ctx, input, () => {})).rejects.toThrow(/tweet/i);
      expect(settleX402Call).not.toHaveBeenCalled();
    });

    it('accepts output that matches the draft tweet-for-tweet', async () => {
      const out = await runFactCheckStep({ ...ctx, chainId: 42220 }, input, () => {});
      expect(out.tweets).toHaveLength(input.tweets.length);
      expect(settleX402Call).toHaveBeenCalledOnce();
    });
  });

  it('settles before delivering the revision, never after', async () => {
    // Settle gates delivery (.claude/docs/generate-flow.md). Emitting first let
    // the client show a fact-checked thread that a failed settle then revoked.
    const order: string[] = [];
    await runFactCheckStep({ ...ctx, chainId: 42220 }, input, (e) => order.push(e.type));
    expect(order.indexOf('step_settled')).toBeLessThan(order.indexOf('step_output'));
  });

  it('delivers nothing when the settle fails', async () => {
    settleX402Call.mockRejectedValue(new Error('sink unreachable'));
    const events: { type: string }[] = [];
    await expect(
      runFactCheckStep({ ...ctx, chainId: 42220 }, input, (e) => events.push(e)),
    ).rejects.toThrow(/settle/i);
    expect(events.some((e) => e.type === 'step_output')).toBe(false);
  });

  it('still settles on Celo', async () => {
    await runFactCheckStep({ ...ctx, chainId: 42220, tokenSymbol: 'cUSD' }, input, () => {});
    expect(settleX402Call).toHaveBeenCalledOnce();
    expect(settleX402Call).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 42220, tokenSymbol: 'cUSD' }),
    );
  });
});
