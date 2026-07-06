import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { alertOps } from './alert';

const ORIG = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIG };
  vi.unstubAllGlobals();
});

describe('alertOps', () => {
  it('logs and does not fetch when no webhook is configured', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await alertOps('agent wallet low', { balance: '0.4' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('POSTs both Slack (text) and Discord (content) keys with the message', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/abc';
    let sent: { url: string; body: string } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) };
      return { ok: true };
    }));

    await alertOps('3 stuck threads swept', { swept: 3 });

    expect(sent!.url).toBe('https://hooks.example/abc');
    const body = JSON.parse(sent!.body);
    expect(body.text).toContain('3 stuck threads swept');
    expect(body.content).toContain('3 stuck threads swept');
    expect(body.text).toContain('swept');
  });

  it('swallows webhook failures (never throws)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/abc';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));

    await expect(alertOps('boom')).resolves.toBeUndefined();
  });
});
