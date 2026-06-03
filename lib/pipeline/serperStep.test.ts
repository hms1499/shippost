import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const settleX402Call = vi.fn();
vi.mock('@/lib/agent/orchestrator', () => ({ settleX402Call }));

const { runSerperStep } = await import('./serperStep');

const ctx = {
  chainId: 84532,
  threadId: 1n,
  topic: 't',
  audience: 'beginner' as const,
  agentWallet: '0xw' as const,
  query: 'q',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SERPER_API_KEY', 'k');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ organic: [], answerBox: { snippet: 's' } }) })),
  );
  settleX402Call.mockResolvedValue('0xserper');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('runSerperStep', () => {
  it('does not settle when the run is already aborted (no spend after deadline)', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runSerperStep({ ...ctx, signal: ac.signal }, () => {})).rejects.toThrow(/abort/i);
    expect(settleX402Call).not.toHaveBeenCalled();
  });
});
