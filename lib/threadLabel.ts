// Human-readable title for a thread row in public lists. Some modes carry no
// free-text "topic" (Daily Recap is input-free; Hot Take/Token rows can land
// with a null topic), so a bare `thread.topic` renders as an empty/"(no topic)"
// row that reads as broken data. Prefer the topic when present; otherwise fall
// back to the mode's name.
const MODE_FALLBACK: Record<number, string> = {
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
};

export function threadLabel({ mode, topic }: { mode: number; topic: string | null }): string {
  const trimmed = topic?.trim();
  if (trimmed) return trimmed;
  return MODE_FALLBACK[mode] ?? 'Untitled thread';
}
