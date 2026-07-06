// Minimal ops alert: fire-and-forget a message to an incoming webhook. Kept
// deliberately tiny — it is the primitive the reconcile cron (and, later, the
// wider alerting surface) posts to when something needs a human. A missing
// webhook degrades to a console warning; a failed POST is swallowed, because an
// alert path must never break the caller it is trying to warn about.
export async function alertOps(message: string, context?: Record<string, unknown>): Promise<void> {
  const detail =
    context && Object.keys(context).length ? `${message}\n${JSON.stringify(context)}` : message;

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    console.warn('[alert]', detail);
    return;
  }

  try {
    // `text` is Slack's field, `content` is Discord's — send both so either
    // style of incoming webhook renders the message and the caller doesn't have
    // to know which one is wired up.
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: detail, content: detail }),
    });
  } catch (e) {
    console.warn('[alert] webhook failed:', e instanceof Error ? e.message : e);
  }
}
