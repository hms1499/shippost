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
  tokenSymbol: 'cUSD' as const,
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

describe('fetchSerper', () => {
  it('fetches and shapes results without settling', async () => {
    const { fetchSerper } = await import('./serperStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ organic: [{ title: 't', snippet: 's', link: 'l' }], answerBox: { snippet: 'box' } }),
      })),
    );
    const out = await fetchSerper('bitcoin');
    expect(out.query).toBe('bitcoin');
    expect(out.organic).toHaveLength(1);
    expect(out.newsSnippet).toBe('box');
    expect(settleX402Call).not.toHaveBeenCalled();
  });

  it('sends the recency window and default /search endpoint', async () => {
    const { fetchSerper } = await import('./serperStep');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ organic: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchSerper('bitcoin', { recency: 'qdr:w' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://google.serper.dev/search');
    expect(JSON.parse(init.body)).toMatchObject({ q: 'bitcoin', tbs: 'qdr:w' });
  });

  it('hits the /news endpoint and normalises dated headlines to organic', async () => {
    const { fetchSerper } = await import('./serperStep');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        news: [{ title: 'ETF approved', snippet: 'today', link: 'l', date: '2 hours ago' }],
        answerBox: { snippet: 'ignored for news' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchSerper('crypto today', { mode: 'news', recency: 'qdr:d' });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://google.serper.dev/news');
    expect(out.organic).toEqual([
      { title: 'ETF approved', snippet: 'today', link: 'l', date: '2 hours ago' },
    ]);
    expect(out.newsSnippet).toBeNull();
  });
});
