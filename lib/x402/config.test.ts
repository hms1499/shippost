import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getX402ChainConfig, isX402Chain, getSettleMode, getSettleChainId, priceRawUSDC, dailyCapRawUSDC,
} from './config';

const BASE = 8453;
const BASE_SEPOLIA = 84532;
const CELO = 42220;

afterEach(() => { vi.unstubAllEnvs(); });

describe('x402 config', () => {
  it('maps Base chains to CAIP-2 + canonical USDC (6 dec)', () => {
    expect(getX402ChainConfig(BASE).caip2).toBe('eip155:8453');
    expect(getX402ChainConfig(BASE).usdc.toLowerCase())
      .toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    expect(getX402ChainConfig(BASE_SEPOLIA).usdc.toLowerCase())
      .toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  });

  it('throws for non-Base chains', () => {
    expect(() => getX402ChainConfig(CELO)).toThrow();
    expect(isX402Chain(CELO)).toBe(false);
  });

  it('x402 only when flag=x402 AND X402_CHAIN_ID is a supported Base chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'x402');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('x402');
    expect(getSettleChainId()).toBe(BASE);

    vi.stubEnv('X402_CHAIN_ID', String(CELO)); // flag on, non-Base settle chain
    expect(getSettleMode()).toBe('legacy');

    vi.stubEnv('X402_CHAIN_ID', 'garbage'); // flag on, unparseable
    expect(getSettleMode()).toBe('legacy');
  });

  it('legacy when the flag is off, whatever the settle chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'legacy');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('legacy');
  });

  it('computes raw USDC amounts (6 decimals)', () => {
    expect(priceRawUSDC()).toBe(1000n);           // 0.001 USDC
    vi.stubEnv('X402_DAILY_CAP_USDC', '5');
    expect(dailyCapRawUSDC()).toBe(5_000_000n);   // 5 USDC
  });
});
