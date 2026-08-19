import { MODE_NAMES } from '@/lib/threadLabel';
import { RuleDivider } from '@/components/terminal/RuleDivider';

// The repository this app is built from, taken from the git remote rather than
// from memory — a wrong link here sends every reader to a stranger's code.
const REPO_URL = 'https://github.com/hms1499/shippost';
const X_URL = 'https://x.com/coin_oppx';

/**
 * The plate riveted to the back of a coin-operated machine: what it takes, what
 * it makes, what it keeps. Facts only, and only ones the landing does not
 * already state — the price and the chains it runs on are in the hero and the
 * counter, so they are not repeated here.
 */
export function SpecPlate() {
  return (
    <section aria-label="Specification" className="w-full flex flex-col gap-4">
      <RuleDivider />
      <p className="heading-sub text-[10px]">Specification</p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-5 sm:gap-x-8 gap-y-3">
        <Row label="Takes">
          <span className="font-mono text-xs text-foreground">USDC</span>
          <span className="font-mono text-xs text-muted-foreground"> on Base · </span>
          <span className="font-mono text-xs text-foreground">cUSD, USDT, USDC</span>
          <span className="font-mono text-xs text-muted-foreground"> on Celo</span>
        </Row>

        <Row label="Writes">
          <span className="font-mono text-xs text-foreground">{MODE_NAMES.join(' · ')}</span>
        </Row>

        <Row label="Keeps">
          <span className="text-xs font-sans text-muted-foreground leading-snug">
            Your wallet address and each thread&apos;s metadata. No account, no email, no
            personal data.
          </span>
        </Row>

        <Row label="Elsewhere">
          {/* Negative margin cancels the links' own padding so the first mark
              sits on the same left edge as the text in the rows above. */}
          <span className="flex items-center gap-1 flex-wrap -ml-1.5">
            <IconLink href={REPO_URL} label="GitHub repository">
              <GithubMark />
            </IconLink>
            <IconLink href={X_URL} label="X profile">
              <XMark />
            </IconLink>
          </span>
        </Row>
      </dl>
    </section>
  );
}

/**
 * A mark on its own. With no visible text the accessible name has to carry the
 * whole meaning, so `label` is required rather than optional.
 *
 * The padding is not decoration: the mark is 14px, and a 14px tap target fails
 * every pointer guideline going. Padding takes the hit area past 24px square
 * without making the mark itself louder.
 */
function IconLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex items-center justify-center p-1.5 rounded text-muted-foreground no-underline hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </a>
  );
}

/* Inline rather than imported: lucide ships no current X mark, so both marks
 * are drawn here and stay the same size and weight as each other. */
function GithubMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="heading-sub text-[10px] pt-[3px]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
