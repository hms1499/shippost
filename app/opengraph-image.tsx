import { ImageResponse } from 'next/og';
import { SUPPORTED_CHAIN_IDS } from '@/lib/chainPolicy';
import { computePublicStats } from '@/lib/publicAnalytics';
import { sumChainStats, type ChainStats } from '@/lib/publicStats';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';

export const alt = 'CoinOp — one coin in, one thread out';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Regenerated a few times an hour at most. The card is scraped far more often
// than the numbers move, and a scrape must never wait on the database.
export const revalidate = 900;

const GROUND = '#0A0D0A';
const PANEL = '#111611';
const RULE = '#22331F';
const PHOSPHOR = '#59F87D';
const MONEY = '#FFC247';
const MUTED = '#7D8F7D';
const FOREGROUND = '#E8F0E8';

/**
 * Satori cannot read woff2, which is what Google serves to a modern browser,
 * so this asks with an ancient User-Agent to get a TTF back. Every failure
 * path returns no font at all: the card then renders in the default face,
 * which is worse-looking and still infinitely better than no card.
 */
async function monoFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1)' },
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.text());
    const url = css.match(/src:\s*url\((https:[^)]+?\.ttf)\)/)?.[1];
    if (!url) return null;
    return await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Totals across every chain, or null if the database cannot be reached. */
async function totals(): Promise<ChainStats | null> {
  try {
    const perChain = await Promise.all(
      SUPPORTED_CHAIN_IDS.map((id) => computePublicStats(id).catch(() => null)),
    );
    const summed = sumChainStats(perChain);
    // A card claiming zero threads sells nothing; drop the counter instead.
    return summed.threads > 0 ? summed : null;
  } catch {
    return null;
  }
}

function Counter({ value, label, money }: { value: string; label: string; money?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[...value].map((c, i) =>
          /\d/.test(c) ? (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 46,
                padding: '4px 6px',
                border: `2px solid ${RULE}`,
                borderRadius: 4,
                background: PANEL,
                fontSize: 60,
                color: money ? MONEY : FOREGROUND,
              }}
            >
              {c}
            </div>
          ) : (
            <div key={i} style={{ display: 'flex', alignItems: 'center', fontSize: 60, color: money ? MONEY : FOREGROUND }}>
              {c}
            </div>
          ),
        )}
      </div>
      <div style={{ display: 'flex', fontSize: 20, letterSpacing: 3, color: MUTED }}>{label}</div>
    </div>
  );
}

export default async function Image() {
  const [font, stats] = await Promise.all([monoFont(), totals()]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: GROUND,
          color: FOREGROUND,
          padding: 64,
          fontFamily: 'mono',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', fontSize: 44, letterSpacing: -1 }}>CoinOp</div>
          <div style={{ display: 'flex', fontSize: 20, letterSpacing: 4, color: MUTED }}>
            AI THREAD WRITER, AGENT-RUN
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 76, lineHeight: 1.06, letterSpacing: -2 }}>
            One coin in.
          </div>
          <div
            style={{ display: 'flex', fontSize: 76, lineHeight: 1.06, letterSpacing: -2, color: PHOSPHOR }}
          >
            One thread out.
          </div>
        </div>

        {stats ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
              <Counter value={String(stats.threads)} label="THREADS" />
              <Counter value={`$${stats.volumeUsd}`} label="SETTLED ON CHAIN" money />
              <Counter value={String(stats.x402Count)} label="X402 CALLS" />
            </div>
            <div style={{ display: 'flex', borderTop: `2px solid ${RULE}`, paddingTop: 22, fontSize: 22, color: MUTED }}>
              {THREAD_PRICE_LABEL} a thread — and only if you keep it
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', borderTop: `2px solid ${RULE}`, paddingTop: 22, fontSize: 22, color: MUTED }}>
            {THREAD_PRICE_LABEL} a thread — and only if you keep it
          </div>
        )}
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: 'mono', data: font, weight: 700, style: 'normal' }] : undefined,
    },
  );
}
