// Settle-free draft generation for the free preview. Delegates to the mode
// registry; each mode's preview() must NEVER settle an x402 call, spend from
// the agent wallet, or persist a thread row. A source-guard test enforces that
// across this file and every mode descriptor. Paying regenerates fresh via the
// unchanged paid pipeline.
import { getMode, type PreviewInput } from '@/lib/pipeline/modes';

export type { PreviewInput };

export async function runPreview(input: PreviewInput): Promise<{ tweets: string[] }> {
  const mode = getMode(input.mode);
  if (!mode) throw new Error(`unknown preview mode: ${input.mode}`);
  return mode.preview(input);
}
