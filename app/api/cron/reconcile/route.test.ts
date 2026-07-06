import { describe, it, expect, vi, beforeEach } from 'vitest';

const reconcileStuckThreads = vi.fn();
const alertOps = vi.fn();
const getSupabaseServer = vi.fn(() => ({}));

vi.mock('@/lib/agent/reconcile', () => ({ reconcileStuckThreads }));
vi.mock('@/lib/alert', () => ({ alertOps }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { GET } = await import('./route');

const ORIG = { ...process.env };

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/reconcile', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG, CRON_SECRET: 'sekret' };
  reconcileStuckThreads.mockResolvedValue({ swept: 0, enqueued: 0, errors: [] });
});

describe('GET /api/cron/reconcile', () => {
  it('503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: 'Bearer sekret' }));
    expect(res.status).toBe(503);
    expect(reconcileStuckThreads).not.toHaveBeenCalled();
  });

  it('401 when the bearer token is missing or wrong', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer nope' }))).status).toBe(401);
    expect(reconcileStuckThreads).not.toHaveBeenCalled();
  });

  it('runs reconcile and returns the summary on valid auth', async () => {
    reconcileStuckThreads.mockResolvedValue({ swept: 2, enqueued: 2, errors: [] });
    const res = await GET(req({ authorization: 'Bearer sekret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 2, enqueued: 2, errors: [] });
    expect(reconcileStuckThreads).toHaveBeenCalledOnce();
  });

  it('alerts when threads were swept', async () => {
    reconcileStuckThreads.mockResolvedValue({ swept: 3, enqueued: 3, errors: [] });
    await GET(req({ authorization: 'Bearer sekret' }));
    expect(alertOps).toHaveBeenCalledOnce();
  });

  it('does not alert on a clean run (nothing swept, no errors)', async () => {
    await GET(req({ authorization: 'Bearer sekret' }));
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('alerts when reconcile reports errors even with nothing swept', async () => {
    reconcileStuckThreads.mockResolvedValue({
      swept: 0,
      enqueued: 0,
      errors: [{ stage: 'select', message: 'db down' }],
    });
    await GET(req({ authorization: 'Bearer sekret' }));
    expect(alertOps).toHaveBeenCalledOnce();
  });

  it('returns 500 and alerts when reconcile throws', async () => {
    reconcileStuckThreads.mockRejectedValue(new Error('boom'));
    const res = await GET(req({ authorization: 'Bearer sekret' }));
    expect(res.status).toBe(500);
    expect(alertOps).toHaveBeenCalledOnce();
  });
});
