import { X402_UNIT_COST_USD } from '@/lib/tokens';

// x402 settlement sink. We run a custom proxy (no Coinbase facilitator), so
// by default settlement BURNS the spend to the dead address to demonstrate
// the on-chain flow without a real payee. This is real money to nowhere —
// set X402_SINK_ADDRESS in prod to route it to a real treasury (no code
// change). Malformed env falls back to the burn address rather than reverting.
const RAW_SINK = process.env.X402_SINK_ADDRESS;
export const GROQ_SINK = (RAW_SINK && /^0x[a-fA-F0-9]{40}$/.test(RAW_SINK)
  ? RAW_SINK
  : '0x000000000000000000000000000000000000dead') as `0x${string}`;

// Human-readable Groq charge, re-exported from the single cost source in
// lib/tokens. settleX402Call converts this USD figure to the paid token's
// decimals, so the displayed number can't drift from what settles on-chain.
export const GROQ_COST_HUMAN = X402_UNIT_COST_USD;
