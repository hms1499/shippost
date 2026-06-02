import { parseEther, formatEther } from 'viem';

// x402 settlement sink. We run a custom proxy (no Coinbase facilitator), so
// by default settlement BURNS the spend to the dead address to demonstrate
// the on-chain flow without a real payee. This is real money to nowhere —
// set X402_SINK_ADDRESS in prod to route it to a real treasury (no code
// change). Malformed env falls back to the burn address rather than reverting.
const RAW_SINK = process.env.X402_SINK_ADDRESS;
export const GROQ_SINK = (RAW_SINK && /^0x[a-fA-F0-9]{40}$/.test(RAW_SINK)
  ? RAW_SINK
  : '0x000000000000000000000000000000000000dead') as `0x${string}`;

// Single source of truth for the Groq x402 charge. The displayed cost is
// derived from the same bigint that's actually settled on-chain, so the
// number shown to the user can't drift from what moved.
export const GROQ_COST_CUSD = parseEther('0.001');
export const GROQ_COST_HUMAN = formatEther(GROQ_COST_CUSD);
