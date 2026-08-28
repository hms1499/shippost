import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';
import { MODE_A_STEPS, MODE_B_STEPS, stepPlanFor } from './stepPlan';

// The point of this file: stepPlan.ts is a hand-written mirror of what the
// runners do, read by AgentTrace to show "step 2 of 4". A mirror that drifts
// turns the progress counter into a lie on the screen where the user has just
// paid. So drive the REAL runners with mocked steps and compare call order.
const runSerperStep = vi.fn();
const runCoinGeckoStep = vi.fn();
const runFactCheckStep = vi.fn();
const generateDraft = vi.fn();
const runGroqStep = vi.fn();

vi.mock('./serperStep', () => ({ runSerperStep }));
vi.mock('./coingeckoStep', () => ({ runCoinGeckoStep }));
vi.mock('./factCheckStep', () => ({ runFactCheckStep }));
vi.mock('./generateDraft', () => ({ generateDraft }));
vi.mock('./groqStep', () => ({ runGroqStep }));

const { runModeA } = await import('./runModeA');
const { runModeB } = await import('./runModeB');
const { educationalMode } = await import('./modes/educational');

const baseCtx = {
  chainId: 42220,
  threadId: 1n,
  topic: 'EIP-712',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000001' as Address,
  tokenSymbol: 'cUSD' as const,
};

const calls: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  runSerperStep.mockImplementation(async () => {
    calls.push('serper');
    return { query: 'q', organic: [], newsSnippet: null };
  });
  runCoinGeckoStep.mockImplementation(async () => {
    calls.push('coingecko');
    return {
      symbol: null, priceUsd: null, change24hPct: null, change7dPct: null,
      change30dPct: null, marketCapUsd: null, marketCapRank: null,
      volume24hUsd: null, circulatingSupply: null, maxSupply: null,
      athChangePct: null,
    };
  });
  generateDraft.mockImplementation(async () => {
    calls.push('groq');
    return { tweets: ['1', '2'], txHash: '0xabc', costHuman: '0.001', tokenSymbol: 'cUSD', chainId: 42220 };
  });
  runGroqStep.mockImplementation(async () => {
    calls.push('groq');
    return { tweets: ['1', '2'] };
  });
  runFactCheckStep.mockImplementation(async () => {
    calls.push('factCheck');
    return { tweets: ['1', '2'] };
  });
});

describe('stepPlan mirrors the runners', () => {
  it('MODE_B_STEPS is exactly what runModeB attempts, in order', async () => {
    await runModeB({ ...baseCtx, angle: 'skeptical', eventDescription: 'token X depegged' }, () => {});
    expect(calls).toEqual([...MODE_B_STEPS]);
  });

  it('MODE_A_STEPS is exactly what runModeA attempts, in order', async () => {
    await runModeA(baseCtx, () => {});
    expect(calls).toEqual([...MODE_A_STEPS]);
  });
});

describe('stepPlanFor', () => {
  it('pins mode 0 to Educational, the only runModeA mode', () => {
    expect(educationalMode.id).toBe(0);
    expect(stepPlanFor(0)).toEqual(MODE_A_STEPS);
  });

  it('puts every other mode on the runModeB plan', () => {
    for (const id of [1, 2, 3, 4, 5]) {
      expect(stepPlanFor(id)).toEqual(MODE_B_STEPS);
    }
  });

  it('falls back to the longer plan when the mode is unknown', () => {
    // A short denominator that grows mid-run reads as a broken progress bar.
    expect(stepPlanFor(null)).toEqual(MODE_B_STEPS);
    expect(stepPlanFor(undefined)).toEqual(MODE_B_STEPS);
  });
});
