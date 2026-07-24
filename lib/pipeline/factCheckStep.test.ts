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

describe('runFactCheckStep', () => {
  it('does not settle when the run is already aborted (no spend after deadline)', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runFactCheckStep({ ...ctx, signal: ac.signal }, input, () => {})).rejects.toThrow(/abort/i);
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
