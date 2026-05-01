'use client';

import { Card } from '@/components/ui/card';
import type { Hex } from 'viem';

interface Props {
  txHash: Hex | null;
  threadId: bigint | null;
  mockOutput: string | null;
  chainExplorerBase: string;
}

export function GeneratingStatus({ txHash, threadId, mockOutput, chainExplorerBase }: Props) {
  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Generating your thread…</h2>
      <ul className="text-sm flex flex-col gap-1">
        <li>💸 Payment confirmed {txHash ? '✓' : '⏳'}</li>
        <li>✍️ Writing thread {mockOutput ? '✓' : '⏳'}</li>
      </ul>
      {txHash && (
        <a
          href={`${chainExplorerBase}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline"
        >
          View pay tx on explorer →
        </a>
      )}
      {threadId && (
        <p className="text-xs text-muted-foreground">Thread #{threadId.toString()}</p>
      )}
      {mockOutput && (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold mb-2">Output (mock)</h3>
          <pre className="text-xs whitespace-pre-wrap">{mockOutput}</pre>
        </div>
      )}
    </Card>
  );
}
