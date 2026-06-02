import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSettleMode = vi.fn();
const payGroqViaX402 = vi.fn();
const settleX402Call = vi.fn();
const create = vi.fn();

vi.mock('@/lib/x402/config', () => ({ getSettleMode, X402_PRICE_USD: '0.001', GROQ_MODEL: 'llama-3.3-70b-versatile' }));
vi.mock('@/lib/x402/client', () => ({ payGroqViaX402 }));
vi.mock('@/lib/agent/orchestrator', () => ({ settleX402Call }));
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create } }; } }));

const { generateDraft } = await import('./generateDraft');

const ctx = { chainId: 84532, threadId: 1n, topic: 't', audience: 'beginner' as const, agentWallet: '0xw' as const };
const msgs = { messages: [{ role: 'user' as const, content: 'x' }], temperature: 0.7, maxTokens: 1200 };

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('GROQ_API_KEY', 'k'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('generateDraft', () => {
  it('x402 mode: pays via proxy, returns USDC cost + settlement hash, never calls Groq directly', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockResolvedValue({ tweets: ['a', 'b'], settlementTxHash: '0xtx' });
    const out = await generateDraft(ctx, msgs);
    expect(out).toEqual({ tweets: ['a', 'b'], txHash: '0xtx', costHuman: '0.001', tokenSymbol: 'USDC' });
    expect(create).not.toHaveBeenCalled();
    expect(settleX402Call).not.toHaveBeenCalled();
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
  });

  it('legacy mode: throws (no settle) on empty Groq output', async () => {
    getSettleMode.mockReturnValue('legacy');
    create.mockResolvedValue({ choices: [{ message: { content: '  ' } }] });
    await expect(generateDraft(ctx, msgs)).rejects.toThrow();
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
