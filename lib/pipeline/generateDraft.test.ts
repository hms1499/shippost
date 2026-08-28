import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSettleMode = vi.fn();
const getSettleChainId = vi.fn();
const payGroqViaX402 = vi.fn();
const settleX402Call = vi.fn();
const create = vi.fn();
const alertOps = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/x402/config', () => ({
  getSettleMode,
  getSettleChainId,
  X402_PRICE_USD: '0.001',
  GROQ_MODEL: 'openai/gpt-oss-120b',
  groqCompletionExtras: () => ({ reasoning_effort: 'low' as const }),
}));
vi.mock('@/lib/x402/client', () => ({ payGroqViaX402 }));
vi.mock('@/lib/agent/orchestrator', () => ({ settleX402Call }));
vi.mock('@/lib/alert', () => ({ alertOps }));
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create } }; } }));

const { generateDraft } = await import('./generateDraft');

const ctx = { chainId: 42220, threadId: 1n, topic: 't', audience: 'beginner' as const, agentWallet: '0xw' as const, tokenSymbol: 'cUSD' as const };
const msgs = { messages: [{ role: 'user' as const, content: 'x' }], temperature: 0.7, maxTokens: 1200 };

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('GROQ_API_KEY', 'k'); getSettleChainId.mockReturnValue(8453); });
afterEach(() => { vi.unstubAllEnvs(); });

// 296 chars with a clean seam at 182 — one cut leaves two postable tweets.
const LONG =
  '1/ Base sequencer revenue hit $2.1M in July, up 40% from June. Almost all of it comes from L1 data costs falling after Dencun, not from more users. Daily transactions are flat at 8M. The margin story is a blob pricing story, and blob prices are set by whoever else is bidding for that same space.';

describe('length fitting', () => {
  it('legacy mode: splits an over-long tweet the model returned', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: `${LONG}\n\n2/ tail` } }] });
    settleX402Call.mockResolvedValue('0xtx');
    const out = await generateDraft(ctx, msgs);
    expect(out.tweets).toHaveLength(3);
    expect(out.tweets.every((t) => t.length <= 280)).toBe(true);
    expect(out.tweets.map((t) => t.slice(0, 3))).toEqual(['1/ ', '2/ ', '3/ ']);
  });

  it('x402 mode: fits what the proxy returns, without the proxy having to', async () => {
    // /api/x402/groq stays raw for the agents that buy it; we fit on consumption.
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockResolvedValue({ tweets: [LONG], settlementTxHash: '0xtx' });
    const out = await generateDraft(ctx, msgs);
    expect(out.tweets).toHaveLength(2);
    expect(out.tweets.every((t) => t.length <= 280)).toBe(true);
  });

  it('hands over a tweet with no sentence seam rather than cutting it', async () => {
    const seamless = `1/ ${'blob base fee moves with how many rollups post in the same block and that is an incentive question not a demand question '.repeat(3)}`;
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: seamless } }] });
    settleX402Call.mockResolvedValue('0xtx');
    const out = await generateDraft(ctx, msgs);
    expect(out.tweets).toHaveLength(1);
    expect(out.tweets[0].length).toBeGreaterThan(280);
    expect(out.tweets[0]).toContain('blob base fee moves');
  });
});

describe('generateDraft', () => {
  it('x402 mode: pays via proxy, returns USDC cost + settlement hash, never calls Groq directly', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockResolvedValue({ tweets: ['a', 'b'], settlementTxHash: '0xtx' });
    const out = await generateDraft(ctx, msgs);
    expect(out).toEqual({ tweets: ['a', 'b'], txHash: '0xtx', costHuman: '0.001', tokenSymbol: 'USDC', chainId: 8453 });
    expect(create).not.toHaveBeenCalled();
    expect(settleX402Call).not.toHaveBeenCalled();
    // Decoupling: payment chain is Celo, settle chain comes from env config.
    expect(payGroqViaX402).toHaveBeenCalledWith(expect.objectContaining({ chainId: 8453 }));
  });

  it('x402 mode: empty settlementTxHash falls back to 0x0', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockResolvedValue({ tweets: ['a'], settlementTxHash: '' });
    const out = await generateDraft(ctx, msgs);
    expect(out.txHash).toBe('0x0');
  });

  it('legacy mode: calls Groq, parses, settles to sink in cUSD', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    settleX402Call.mockResolvedValue('0xsink');
    const out = await generateDraft(ctx, msgs);
    expect(create).toHaveBeenCalledOnce();
    expect(settleX402Call).toHaveBeenCalledOnce();
    expect(out.tokenSymbol).toBe('cUSD');
    expect(out.txHash).toBe('0xsink');
    expect(out.tweets.length).toBeGreaterThan(0);
    expect(out.chainId).toBeUndefined();
  });

  it('legacy mode: settles in the token the user paid (USDT), not hardcoded cUSD', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    settleX402Call.mockResolvedValue('0xsink');
    const out = await generateDraft({ ...ctx, tokenSymbol: 'USDT' }, msgs);
    expect(out.tokenSymbol).toBe('USDT');
    // The AgentWallet spends the paid token — the whole point of the fix.
    expect(settleX402Call).toHaveBeenCalledWith(
      expect.objectContaining({ tokenSymbol: 'USDT' }),
    );
  });

  it('legacy mode: throws (no settle) on empty Groq output', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '  ' } }] });
    await expect(generateDraft(ctx, msgs)).rejects.toThrow();
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('legacy mode: aborted-before-start does no work and never settles', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    const ac = new AbortController();
    ac.abort();
    await expect(generateDraft({ ...ctx, signal: ac.signal }, msgs)).rejects.toThrow(/abort/i);
    expect(create).not.toHaveBeenCalled();
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('legacy mode: abort DURING Groq call still prevents settle (no spend after deadline)', async () => {
    getSettleMode.mockReturnValue('legacy');
    const ac = new AbortController();
    create.mockImplementation(async () => {
      ac.abort(); // deadline fires while the model is responding
      return { choices: [{ message: { content: '1/ a\n\n2/ b' } }] };
    });
    await expect(generateDraft({ ...ctx, signal: ac.signal }, msgs)).rejects.toThrow(/abort/i);
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('x402 mode: aborted signal never pays via the proxy', async () => {
    getSettleMode.mockReturnValue('x402');
    const ac = new AbortController();
    ac.abort();
    await expect(generateDraft({ ...ctx, signal: ac.signal }, msgs)).rejects.toThrow(/abort/i);
    expect(payGroqViaX402).not.toHaveBeenCalled();
  });

  it('x402 mode: forwards the run signal so a mid-call deadline can cancel the settle', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockResolvedValue({ tweets: ['a'], settlementTxHash: '0xtx' });
    const ac = new AbortController();
    await generateDraft({ ...ctx, signal: ac.signal }, msgs);
    expect(payGroqViaX402).toHaveBeenCalledWith(expect.objectContaining({ signal: ac.signal }));
  });

  it('x402 infra failure falls back to the legacy settle and alerts ops', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockRejectedValue(new Error('facilitator 503'));
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    settleX402Call.mockResolvedValue('0xsink');
    const out = await generateDraft(ctx, msgs);
    expect(out.tokenSymbol).toBe('cUSD'); // legacy result, user still gets the thread
    expect(out.txHash).toBe('0xsink');
    expect(settleX402Call).toHaveBeenCalledOnce();
    expect(alertOps).toHaveBeenCalledOnce();
    expect(alertOps.mock.calls[0][0]).toMatch(/fell back/i);
  });

  it('x402 failure after the deadline fired rethrows — no legacy settle, no alert-then-spend', async () => {
    getSettleMode.mockReturnValue('x402');
    const ac = new AbortController();
    payGroqViaX402.mockImplementation(async () => {
      ac.abort(); // deadline fires mid-settle
      throw new Error('aborted: generation deadline exceeded');
    });
    await expect(generateDraft({ ...ctx, signal: ac.signal }, msgs)).rejects.toThrow(/abort/i);
    expect(create).not.toHaveBeenCalled();
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});

describe('generateTweets', () => {
  it('calls Groq, parses + bounds, and never settles', async () => {
    const { generateTweets } = await import('./generateDraft');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    const tweets = await generateTweets(msgs);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: 'low' }));
    expect(tweets.length).toBeGreaterThan(0);
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('throws on empty Groq output (and never settles)', async () => {
    const { generateTweets } = await import('./generateDraft');
    create.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    await expect(generateTweets(msgs)).rejects.toThrow();
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
