'use client';

import { useChainId } from 'wagmi';
import { chainLabel } from '@/lib/chainPolicy';
import { useGasSponsorship, gasNote } from '@/lib/useGasSponsorship';

interface Props {
  symbol: string;
  /** Opens the wallet sheet. Omitted where the user cannot change it (MiniPay). */
  onChange?: () => void;
}

/**
 * What is about to be spent, and where — one line under every pay CTA.
 *
 * It exists because the chain is otherwise invisible at the only moment it
 * matters. The gas half is omitted entirely when sponsorship is unknown: see
 * gasNote.
 */
export function PayContext({ symbol, onChange }: Props) {
  const chainId = useChainId();
  const note = gasNote(useGasSponsorship());

  return (
    <p className="flex items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground">
      <span>
        {symbol} on {chainLabel(chainId)}
        {note ? ` · ${note}` : ''}
      </span>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-muted-foreground underline underline-offset-2 hover:text-primary transition-colors"
        >
          change
        </button>
      )}
    </p>
  );
}
