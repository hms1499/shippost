import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { fromDataSuffix, codeFromHostname } from '@celo/attribution-tags';
import { getAttributionSuffix, resetAttributionSuffixCache } from './attributionTag';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const CODE = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE;

function setEnv(appUrl?: string, code?: string) {
  if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = appUrl;
  if (code === undefined) delete process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE;
  else process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE = code;
  resetAttributionSuffixCache();
}

// Decode what actually lands on the wire, rather than asserting on an opaque
// hex blob — a suffix that doesn't round-trip is a suffix no indexer can read.
function codesOf(suffix: `0x${string}` | undefined): string[] | null {
  if (!suffix) return null;
  return fromDataSuffix(suffix)?.codes ?? null;
}

beforeEach(() => resetAttributionSuffixCache());

afterEach(() => {
  setEnv(APP_URL, CODE);
  resetAttributionSuffixCache();
});

describe('getAttributionSuffix', () => {
  it('derives a code from the configured app origin', () => {
    setEnv('https://shippost-kappa.vercel.app');
    expect(codesOf(getAttributionSuffix())).toEqual([codeFromHostname('shippost-kappa.vercel.app')]);
  });

  it('carries both the derived and the assigned code', () => {
    setEnv('https://shippost-kappa.vercel.app', 'celo_b7k3p9da');
    expect(codesOf(getAttributionSuffix())).toEqual([
      codeFromHostname('shippost-kappa.vercel.app'),
      'celo_b7k3p9da',
    ]);
  });

  it('emits the assigned code alone when no origin is configured', () => {
    setEnv(undefined, 'celo_b7k3p9da');
    expect(codesOf(getAttributionSuffix())).toEqual(['celo_b7k3p9da']);
  });

  it('does not double-count a code that matches the derived one', () => {
    const derived = codeFromHostname('shippost-kappa.vercel.app');
    setEnv('https://shippost-kappa.vercel.app', derived);
    expect(codesOf(getAttributionSuffix())).toEqual([derived]);
  });

  // The three ways this can go wrong in production — every one of them has to
  // degrade to "send the transaction untagged", never to a throw. A payment
  // must not fail because telemetry is misconfigured.
  it('returns undefined when nothing is configured', () => {
    setEnv(undefined, undefined);
    expect(getAttributionSuffix()).toBeUndefined();
  });

  it('treats a blank env var as absent (the Vercel empty-string bug)', () => {
    setEnv('   ', '  ');
    expect(getAttributionSuffix()).toBeUndefined();
  });

  it('drops an invalid assigned code instead of throwing', () => {
    // Uppercase and spaces are rejected by the SDK at encode time.
    setEnv(undefined, 'Celo Bad Code');
    expect(getAttributionSuffix()).toBeUndefined();
  });

  it('falls back past a malformed app URL', () => {
    setEnv('not a url', 'celo_b7k3p9da');
    expect(codesOf(getAttributionSuffix())).toEqual(['celo_b7k3p9da']);
  });
});
