import { privateKeyToAccount } from 'viem/accounts';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { getX402ChainConfig, priceRawUSDC, dailyCapRawUSDC } from './config';
import { isPaused, reserveDailySpend } from './cap';

export interface PayGroqParams {
  chainId: number;
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  maxTokens: number;
}

export interface PayGroqResult {
  tweets: string[];
  settlementTxHash: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

// The x402 server sets the settlement result under `PAYMENT-RESPONSE`; some
// facilitators/older versions use the `X-PAYMENT-RESPONSE` alias. Read either.
function readPaymentHeader(headers: { get(name: string): string | null }): string | null {
  return headers.get('payment-response') ?? headers.get('x-payment-response');
}

// Decode the facilitator's settlement result (base64 JSON). Field name varies by
// version; try the known aliases. A missing hash is non-fatal (cost still
// settled) — we fall back to '' and the caller uses '0x0'.
function decodePaymentTxHash(header: string | null): string {
  if (!header) return '';
  try {
    const json = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return (json.transaction || json.transactionHash || json.txHash || '') as string;
  } catch {
    return '';
  }
}

export async function payGroqViaX402(params: PayGroqParams): Promise<PayGroqResult> {
  const cfg = getX402ChainConfig(params.chainId);

  // Fail fast on misconfig BEFORE reserving cap budget or touching Redis, so a
  // missing key doesn't burn a daily-cap reservation on a call that can't run.
  const pk = requireEnv('AGENT_WALLET_PRIVATE_KEY') as `0x${string}`;
  const proxyBase = requireEnv('X402_PROXY_BASE_URL');

  // Layer 3 then Layer 2, BEFORE any payment. Either throws => refundable, no spend.
  if (await isPaused()) throw new Error('x402 settlement paused');
  await reserveDailySpend({ token: cfg.usdc, amountRaw: priceRawUSDC(), capRaw: dailyCapRawUSDC() });

  // Constructed per call (cheap; mirrors the per-call wallet-client pattern in
  // lib/agent/orchestrator.ts). The agent EOA signs the EIP-3009 X-Payment.
  const account = privateKeyToAccount(pk);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const url = `${proxyBase}/api/x402/groq`;
  const res = await fetchWithPay(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`x402 groq proxy failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { tweets?: unknown };
  if (!Array.isArray(data.tweets) || data.tweets.length === 0) {
    throw new Error('x402 groq proxy returned no tweets');
  }

  return {
    tweets: data.tweets as string[],
    settlementTxHash: decodePaymentTxHash(readPaymentHeader(res.headers)),
  };
}
