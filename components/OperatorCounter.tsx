/**
 * A figure rendered as a mechanical counter: every digit sits in its own cell,
 * the way the coin counter inside an arcade cabinet or a vending machine reads.
 * Separators ($ , .) stay loose between the cells so the number still reads as
 * money rather than as a row of boxes.
 *
 * The counter is the artifact that proves a machine has been used, which is the
 * one thing a stranger on this page needs to believe.
 */
export function OperatorCounter({
  value,
  label,
  money,
}: {
  value: string;
  label: string;
  money?: boolean;
}) {
  const chars = [...value];

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex items-center gap-[0.12em] font-mono font-bold tabular-nums leading-none text-[clamp(1.35rem,4.2vw,2.25rem)] ${
          money ? 'text-money' : 'text-foreground'
        }`}
        // The cells are a drawing of the number; assistive tech gets it whole.
        role="img"
        aria-label={`${value} ${label}`}
      >
        {chars.map((c, i) =>
          /\d/.test(c) ? (
            <span key={i} className="digit-cell">
              <span style={{ animationDelay: `${i * 45}ms` }}>{c}</span>
            </span>
          ) : (
            <span key={i} aria-hidden className="px-[0.02em] opacity-80">
              {c}
            </span>
          ),
        )}
      </div>
      <p className="heading-sub text-[10px] leading-tight text-center">{label}</p>
    </div>
  );
}
