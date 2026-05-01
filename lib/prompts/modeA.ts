export type Audience = 'beginner' | 'intermediate' | 'advanced';
export type Length = 5 | 8 | 12;

interface ModeAInput {
  topic: string;
  audience: Audience;
  length: Length;
}

const AUDIENCE_GUIDANCE: Record<Audience, string> = {
  beginner:
    'Assume the reader has never written Solidity. Define every jargon word the first time it appears. Prefer analogies to familiar web2 ideas.',
  intermediate:
    'Assume the reader has shipped one dapp. Skip basic definitions. Compare against alternatives and name specific EIPs/ERCs.',
  advanced:
    'Assume the reader reads yellow papers. Include gas numbers, storage layout tradeoffs, and known footguns.',
};

const STRUCTURE = `Structure:
- Tweet 1: a hook — a concrete surprising claim or one-line framing.
- Next tweets: 3 core concepts / steps / facts, one per tweet. Each self-contained.
- Second-last tweet: an analogy or a "why this matters for builders" line.
- Last tweet: a call-to-action (follow for more / reply with your take / link to docs).`;

export function buildModeAPrompt(input: ModeAInput): string {
  return [
    `Topic: ${input.topic.trim()}`,
    `Target audience: ${input.audience}. ${AUDIENCE_GUIDANCE[input.audience]}`,
    `Thread length: exactly ${input.length} tweets.`,
    STRUCTURE,
    'Output only the numbered tweets separated by blank lines. Nothing else.',
  ].join('\n\n');
}

export function buildThumbnailPrompt(topic: string): string {
  return `Minimal high-contrast dark-mode illustration representing "${topic}". Thin line art, electric blue accents on near-black background, no text, no human faces, 16:9 aspect ratio, crypto/developer aesthetic.`;
}
