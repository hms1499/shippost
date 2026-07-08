import { describe, it, expect } from 'vitest';
import { buildShareText, tweetIntentUrl } from './shareText';

const URL = 'https://shippost.app';

describe('buildShareText', () => {
  it('appends the full attribution when there is room', () => {
    const out = buildShareText('gm', { attribution: true, appUrl: URL });
    expect(out).toBe(`gm\n\n✍️ made with CoinOp — ${URL}`);
  });

  it('returns the tweet unchanged when attribution is off', () => {
    const out = buildShareText('gm', { attribution: false, appUrl: URL });
    expect(out).toBe('gm');
  });

  it('falls back to the short form when the full form would overflow 280', () => {
    const shortSuffixLen = `\n\nvia CoinOp ${URL}`.length;
    const tweet = 'a'.repeat(280 - shortSuffixLen); // tweet + short == exactly 280
    expect((tweet + `\n\n✍️ made with CoinOp — ${URL}`).length).toBeGreaterThan(280);
    const out = buildShareText(tweet, { attribution: true, appUrl: URL });
    expect(out).toBe(`${tweet}\n\nvia CoinOp ${URL}`);
    expect(out.length).toBeLessThanOrEqual(280);
  });

  it('omits attribution entirely when even the short form overflows', () => {
    const tweet = 'a'.repeat(280);
    const out = buildShareText(tweet, { attribution: true, appUrl: URL });
    expect(out).toBe(tweet);
  });
});

describe('tweetIntentUrl', () => {
  it('builds an https web-intent URL, never a custom app scheme', () => {
    const out = tweetIntentUrl('gm');
    // twitter:// errors with ERR_UNKNOWN_URL_SCHEME in the MiniPay webview.
    expect(out.startsWith('https://x.com/intent/post?text=')).toBe(true);
  });

  it('percent-encodes newlines, emoji and URLs in the text', () => {
    const out = tweetIntentUrl(`1/ gm\n\n✍️ made with CoinOp — ${URL}`);
    expect(out).toBe(
      'https://x.com/intent/post?text=1%2F%20gm%0A%0A%E2%9C%8D%EF%B8%8F%20made%20with%20CoinOp%20%E2%80%94%20https%3A%2F%2Fshippost.app',
    );
  });
});
