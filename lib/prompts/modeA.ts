export type Audience = 'beginner' | 'intermediate' | 'advanced';

interface ModeAInput {
  topic: string;
  audience: Audience;
  // Optional retrieved reference facts. Fact-anchor ONLY — see REFERENCE_GUIDANCE.
  searchSummary?: string | null;
}

const REFERENCE_GUIDANCE = `Reference facts (fact-check only — NOT a content source):
The lines below were retrieved by search for this topic. Use them for ONE thing: keeping concrete specifics accurate — EIP/ERC numbers, function signatures, gas figures, dates, proper names. Your explanation, structure, and narrative come entirely from your own understanding. Do NOT summarize these results, do NOT let them add or reorder sub-topics, do NOT copy their phrasing. If a specific in your draft conflicts with a reference, trust the reference or drop the specific. If the references are thin, off-topic, or marketing fluff, ignore them and write from your own knowledge.`;

const AUDIENCE_GUIDANCE: Record<Audience, string> = {
  beginner:
    'Reader is new to Solidity. Define every jargon word the first time it appears. Prefer familiar web2 analogies. Choose the simplest valid version of the explanation; defer edge cases.',
  intermediate:
    'Reader has shipped one dapp. Skip basic definitions. Compare against alternatives. Name specific EIPs/ERCs/contracts. One concept, examined closely.',
  advanced:
    'Reader reads yellow papers. Include gas figures, storage layout, ABI specifics, and known footguns where they reinforce the concept, not as the focus. Stay on one idea.',
};

const STRUCTURE = `Structure (ONE concept, ONE thread — narrative, not bullet list):
- Tweet 1: lead with a hook (see HOOK) — a hard specific about the concept, or a real question the reader cannot yet answer. Anchor it to something concrete. No "in this thread", no preamble.
- Tweet 2: name the concept and define it concretely, with one example. This is the foundation every later tweet builds on.
- Middle tweets: extend the explanation step-by-step. Each tweet picks up where the previous left off. Avoid the standalone-bullet feel. This is one narrative on one idea, not N independent facts.
- Second-last tweet: connect the pieces, so the reader can answer "what does this give me?".
- Last tweet: a single takeaway sentence. No CTA, no DYOR, no "follow for more".

Constraint: do not introduce a new sub-topic mid-thread. If the topic has multiple angles, pick the single most useful angle and stay on it the whole thread.`;

const LENGTH_GUIDANCE = `Length: use as many tweets as the topic naturally needs to be explained well. Typical range is 5–9 tweets. Never fewer than 4. Never more than 10. Stop the moment the explanation is complete; do not pad to hit a number.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and quality bar (different topic — match the style, do NOT copy content or length):
<example_thread>
1/ EIP-712 lets a wallet sign structured data, like a permit or a meta-transaction, instead of a raw 32-byte hash. The mechanic underneath has three pieces.

2/ When you sign a normal ethereum message, you sign keccak256("\\x19Ethereum Signed Message:\\n" + len + msg). Fine for "I own this wallet". Useless for "I authorize 100 USDC to address X by 5pm".

3/ EIP-712 hashes a typed data structure with three parts: a domain (chain, contract, name, version), a primary type description, and the actual values. The wallet shows all of it to the user before signing.

4/ The final digest is keccak256("\\x19\\x01" + domainSeparator + structHash). The 0x1901 prefix isolates EIP-712 hashes from regular eth_sign and EIP-191 messages, so the same key cannot accidentally sign across schemes.

5/ structHash itself is keccak256(typeHash + encoded fields). typeHash commits to the schema. Changing one field in the struct invalidates every old signature, by design.

6/ This is why permit, gasless meta-tx, and order-book sigs all use EIP-712. The user sees the exact intent. The contract verifies it without trusting the relayer that brought the sig in.
</example_thread>`;

export function buildModeAPrompt(input: ModeAInput): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a thread on:`,
    `Topic: ${input.topic.trim()}`,
    `Target audience: ${input.audience}. ${AUDIENCE_GUIDANCE[input.audience]}`,
  ];
  if (input.searchSummary) {
    blocks.push(REFERENCE_GUIDANCE);
    blocks.push(`Reference facts:\n${input.searchSummary}`);
  }
  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');
  return blocks.join('\n\n');
}

export function buildThumbnailPrompt(topic: string): string {
  return `Minimal high-contrast dark-mode illustration representing "${topic}". Thin line art, electric blue accents on near-black background, no text, no human faces, 16:9 aspect ratio, crypto/developer aesthetic.`;
}
