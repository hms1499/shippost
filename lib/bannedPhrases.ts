// Single source of truth for the anti-slop ban list. Consumed by
// lib/prompts/system.ts (rendered into the prompt) and by ThreadPreview
// (live inline highlighting). No 'use client' / server-only imports — this
// module is safe on both sides of the boundary.

export type BannedGroup = 'slop-opener' | 'marketing' | 'hype-adjective' | 'cta-filler';

export interface Match {
  start: number;
  end: number; // exclusive
  phrase: string;
  group: BannedGroup;
}

export const BANNED_PHRASES: { group: BannedGroup; phrases: string[] }[] = [
  {
    group: 'slop-opener',
    phrases: [
      "let's dive in", 'in this thread', 'buckle up', 'imagine', 'ever wondered',
      "let's explore", 'delve', 'leverage', 'harness', 'navigate', 'embark',
      'journey', 'tap into',
    ],
  },
  {
    group: 'marketing',
    phrases: ['the world of', 'game changer', 'revolutionize', 'unlock the power'],
  },
  {
    group: 'hype-adjective',
    phrases: [
      'massive', 'huge', 'incredible', 'exciting', 'fascinating', 'powerful',
      'seamless', 'robust', 'cutting-edge',
    ],
  },
  {
    group: 'cta-filler',
    phrases: ['DYOR', 'WAGMI', 'GM', 'ngmi', 'anon'],
  },
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One global, case-insensitive, word-bounded matcher per phrase, built once.
// Every phrase starts and ends with a word character, so \b...\b is valid.
const MATCHERS: { group: BannedGroup; phrase: string; re: RegExp }[] =
  BANNED_PHRASES.flatMap((entry) =>
    entry.phrases.map((phrase) => ({
      group: entry.group,
      phrase,
      re: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi'),
    })),
  );

export function detectBannedPhrases(text: string): Match[] {
  const matches: Match[] = [];
  for (const { group, phrase, re } of MATCHERS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, phrase, group });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

export function phraseList(group: BannedGroup): string {
  return BANNED_PHRASES.filter((e) => e.group === group)
    .flatMap((e) => e.phrases)
    .map((p) => `"${p}"`)
    .join(', ');
}
