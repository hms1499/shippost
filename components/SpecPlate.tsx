import { MODE_NAMES } from '@/lib/threadLabel';
import { RuleDivider } from '@/components/terminal/RuleDivider';

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
      </dl>
    </section>
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
