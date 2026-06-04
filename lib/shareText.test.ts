import { describe, it, expect } from 'vitest';
import { buildShareText } from './shareText';

const URL = 'https://shippost.app';

describe('buildShareText', () => {
  it('appends the full attribution when there is room', () => {
    const out = buildShareText('gm', { attribution: true, appUrl: URL });
    expect(out).toBe(`gm\n\n✍️ made with ShipPost — ${URL}`);
  });

  it('returns the tweet unchanged when attribution is off', () => {
    const out = buildShareText('gm', { attribution: false, appUrl: URL });
    expect(out).toBe('gm');
  });

  it('falls back to the short form when the full form would overflow 280', () => {
    const shortSuffixLen = `\n\nvia ShipPost ${URL}`.length;
    const tweet = 'a'.repeat(280 - shortSuffixLen); // tweet + short == exactly 280
    expect((tweet + `\n\n✍️ made with ShipPost — ${URL}`).length).toBeGreaterThan(280);
    const out = buildShareText(tweet, { attribution: true, appUrl: URL });
    expect(out).toBe(`${tweet}\n\nvia ShipPost ${URL}`);
    expect(out.length).toBeLessThanOrEqual(280);
  });

  it('omits attribution entirely when even the short form overflows', () => {
    const tweet = 'a'.repeat(280);
    const out = buildShareText(tweet, { attribution: true, appUrl: URL });
    expect(out).toBe(tweet);
  });
});
