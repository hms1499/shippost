import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getX402ChainConfig, isX402Chain, getSettleMode, getSettleChainId, priceRawUSDC, dailyCapRawUSDC,
  priceForChain,
} from './config';

const BASE = 8453;
const BASE_SEPOLIA = 84532;
const CELO = 42220;
const CELO_SEPOLIA = 11142220;
const UNSUPPORTED = 1; // Ethereum mainnet — no x402 config, and not meant to have one

afterEach(() => { vi.unstubAllEnvs(); });

describe('x402 config', () => {
  it('maps Base chains to CAIP-2 + canonical USDC (6 dec)', () => {
    expect(getX402ChainConfig(BASE).caip2).toBe('eip155:8453');
    expect(getX402ChainConfig(BASE).usdc.toLowerCase())
      .toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    expect(getX402ChainConfig(BASE_SEPOLIA).usdc.toLowerCase())
      .toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  });

  it('maps Celo chains to CAIP-2 + canonical USDC (6 dec)', () => {
    expect(getX402ChainConfig(CELO).caip2).toBe('eip155:42220');
    expect(getX402ChainConfig(CELO).usdc.toLowerCase())
      .toBe('0xceba9300f2b948710d2653dd7b07f33a8b32118c');
    expect(getX402ChainConfig(CELO).usdcDecimals).toBe(6);
    expect(isX402Chain(CELO)).toBe(true);

    expect(getX402ChainConfig(CELO_SEPOLIA).caip2).toBe('eip155:11142220');
    expect(getX402ChainConfig(CELO_SEPOLIA).usdc.toLowerCase())
      .toBe('0x01c5c0122039549ad1493b8220cabedd739bc44e');
  });

  // The bare name is what the Celo facilitator's /verify actually answers to;
  // its presence is also what tells the resource server to wrap the facilitator
  // in the v1 downgrade shim at all.
  it('carries the v1 bare network name only for chains whose facilitator needs it', () => {
    expect(getX402ChainConfig(CELO).v1Network).toBe('celo');
    expect(getX402ChainConfig(CELO_SEPOLIA).v1Network).toBe('celo-sepolia');
    expect(getX402ChainConfig(BASE).v1Network).toBeUndefined();
    expect(getX402ChainConfig(BASE_SEPOLIA).v1Network).toBeUndefined();
  });

  it('throws for chains with no x402 config', () => {
    expect(() => getX402ChainConfig(UNSUPPORTED)).toThrow();
    expect(isX402Chain(UNSUPPORTED)).toBe(false);
  });

  it('x402 only when flag=x402 AND X402_CHAIN_ID is a configured chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'x402');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('x402');
    expect(getSettleChainId()).toBe(BASE);

    vi.stubEnv('X402_CHAIN_ID', String(CELO)); // Celo is a configured chain now
    expect(getSettleMode()).toBe('x402');

    vi.stubEnv('X402_CHAIN_ID', String(UNSUPPORTED)); // flag on, unconfigured chain
    expect(getSettleMode()).toBe('legacy');

    vi.stubEnv('X402_CHAIN_ID', 'garbage'); // flag on, unparseable
    expect(getSettleMode()).toBe('legacy');
  });

  it('legacy when the flag is off, whatever the settle chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'legacy');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('legacy');
  });

  // @x402/evm resolves a bare "$0.001" through its own DEFAULT_STABLECOINS
  // table, which has no Celo entry — building the 402 challenge threw
  // "No default asset configured for network eip155:42220" and the whole x402
  // path degraded to legacy. Naming the asset ourselves skips that table.
  it('prices in explicit asset + atomic amount, never a money string', () => {
    for (const chainId of [BASE, BASE_SEPOLIA, CELO, CELO_SEPOLIA]) {
      const price = priceForChain(chainId);
      expect(price.asset).toBe(getX402ChainConfig(chainId).usdc);
      expect(price.amount).toBe('1000'); // 0.001 USDC at 6 decimals
    }
  });

  // The client signs EIP-3009 against the token's own EIP-712 domain, so a
  // wrong name/version here produces a signature the token contract rejects
  // inside ECRecover.
  it('carries each USDC contract EIP-712 domain for the payment signature', () => {
    expect(priceForChain(CELO).extra).toEqual({ name: 'USDC', version: '2' });
    expect(priceForChain(CELO_SEPOLIA).extra).toEqual({ name: 'USDC', version: '2' });
    // Mirrors @x402/evm's own table for Base, which our Base settlements proved.
    expect(priceForChain(BASE).extra).toEqual({ name: 'USD Coin', version: '2' });
    expect(priceForChain(BASE_SEPOLIA).extra).toEqual({ name: 'USDC', version: '2' });
  });

  it('computes raw USDC amounts (6 decimals)', () => {
    expect(priceRawUSDC()).toBe(1000n);           // 0.001 USDC
    vi.stubEnv('X402_DAILY_CAP_USDC', '5');
    expect(dailyCapRawUSDC()).toBe(5_000_000n);   // 5 USDC
  });
});
