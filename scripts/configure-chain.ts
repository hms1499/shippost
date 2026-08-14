import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Re-apply the post-deploy configuration to contracts that already exist.
 *
 * deploy-chain.ts does this inline, but a config transaction can fail while the
 * deploy itself succeeded — which is not hypothetical: the first Base deploy
 * lost setAllowedToken to an out-of-gas revert (the RPC estimated against a
 * contract it had not indexed yet) and left a live payment contract with no
 * payable token. Redeploying to recover would abandon two contracts and their
 * thread counter, so recovery is a separate, idempotent step.
 *
 * Reads addresses from deployments/<target>.json, checks the current on-chain
 * state, and only sends the transactions that are actually missing.
 *
 *   DEPLOY_TARGET=base npx hardhat run scripts/configure-chain.ts --network base
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TARGETS = {
  base: {
    chainId: 8453,
    file: 'base.json',
    tokens: { USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 } },
  },
  baseSepolia: {
    chainId: 84532,
    file: 'baseSepolia.json',
    tokens: { USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 } },
  },
  celo: {
    chainId: 42220,
    file: 'celo.json',
    tokens: {
      cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
      USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
      USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
    },
  },
} as const;

const DAILY_CAP_USD = 10n;

const ENV_KEYS: Record<keyof typeof TARGETS, { payment: string; agent: string }> = {
  base: { payment: 'NEXT_PUBLIC_PAYMENT_CONTRACT_BASE', agent: 'NEXT_PUBLIC_AGENT_WALLET_BASE' },
  baseSepolia: {
    payment: 'NEXT_PUBLIC_PAYMENT_CONTRACT_BASE_SEPOLIA',
    agent: 'NEXT_PUBLIC_AGENT_WALLET_BASE_SEPOLIA',
  },
  celo: {
    payment: 'NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET',
    agent: 'NEXT_PUBLIC_AGENT_WALLET_MAINNET',
  },
};

function patchEnvLocal(key: string, value: string) {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${key}=${value}\n`);
    return;
  }
  let content = fs.readFileSync(envPath, 'utf8');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escapedKey}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, `${key}=${value}`)
    // Normalise the trailing newline before appending. Without it a file whose
    // last line has no newline gets the next key glued onto the end of it —
    // observed live, which left NEXT_PUBLIC_AGENT_WALLET_BASE holding an
    // address with a whole other assignment stuck to it.
    : `${content.replace(/\n*$/, '')}\n${key}=${value}`;
  fs.writeFileSync(envPath, `${content.replace(/\n*$/, '')}\n`);
}

const PAYMENT_ABI = [
  { inputs: [{ type: 'address' }], name: 'allowedTokens', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ type: 'address' }, { type: 'bool' }], name: 'setAllowedToken', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

const AGENT_ABI = [
  { inputs: [{ type: 'address' }], name: 'dailySpendCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ type: 'address' }, { type: 'uint256' }], name: 'setDailySpendCap', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

async function confirm(publicClient: any, hash: `0x${string}`, what: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`${what} REVERTED (gas used ${receipt.gasUsed}) — tx ${hash}`);
  }
  return receipt;
}

/**
 * Poll a read until it satisfies `want`.
 *
 * A single read straight after a write is not evidence: these RPC endpoints are
 * load-balanced, and the node answering the read can be a block or two behind
 * the one that accepted the write. Observed live on Base — a confirmed
 * setAllowedToken read back as false, then true eight seconds later. Retrying
 * distinguishes "not applied" from "not visible yet"; without it the check
 * produces false alarms on writes that actually landed.
 */
async function readUntil<T>(
  read: () => Promise<T>,
  want: (v: T) => boolean,
  what: string,
  attempts = 10,
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await read();
    if (want(last)) return last;
    await sleep(2000);
  }
  throw new Error(`${what}: still ${String(last)} after ${attempts} reads — the write did not take effect`);
}

async function main() {
  const targetName = process.env.DEPLOY_TARGET as keyof typeof TARGETS | undefined;
  const target = targetName ? TARGETS[targetName] : undefined;
  if (!target) throw new Error(`set DEPLOY_TARGET to one of ${Object.keys(TARGETS).join(', ')}`);

  const { viem } = await network.create();
  const [wallet] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const chainId = await publicClient.getChainId();
  if (chainId !== target.chainId) {
    throw new Error(
      `Wrong network: DEPLOY_TARGET=${targetName} expects chainId ${target.chainId}, connected to ${chainId}`,
    );
  }

  const recordPath = path.join(__dirname, '..', 'deployments', target.file);
  if (!fs.existsSync(recordPath)) throw new Error(`no deployment record at ${recordPath}`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const payment = record.contracts.ShipPostPayment as `0x${string}`;
  const agentWallet = record.contracts.AgentWallet as `0x${string}`;

  console.log(`Target: ${targetName} (chainId ${chainId})`);
  console.log(`ShipPostPayment: ${payment}`);
  console.log(`AgentWallet:     ${agentWallet}`);

  // Refuse to configure an address with no code — a stale or hand-edited
  // deployment record would otherwise send transactions into the void.
  for (const [label, addr] of [
    ['ShipPostPayment', payment],
    ['AgentWallet', agentWallet],
  ] as const) {
    const code = await publicClient.getCode({ address: addr });
    if (!code || code === '0x') throw new Error(`${label} at ${addr} has no code on chain ${chainId}`);
  }

  let changed = 0;

  console.log('\nToken whitelist:');
  for (const [symbol, t] of Object.entries(target.tokens)) {
    const addr = t.address as `0x${string}`;
    const already = await publicClient.readContract({
      address: payment, abi: PAYMENT_ABI, functionName: 'allowedTokens', args: [addr],
    });
    if (already) {
      console.log(`  ${symbol} already allowed — skip`);
      continue;
    }
    const hash = await wallet.writeContract({
      address: payment, abi: PAYMENT_ABI, functionName: 'setAllowedToken', args: [addr, true],
    });
    await confirm(publicClient, hash, `setAllowedToken(${symbol})`);
    await readUntil(
      () => publicClient.readContract({
        address: payment, abi: PAYMENT_ABI, functionName: 'allowedTokens', args: [addr],
      }),
      (v) => v === true,
      `allowedTokens(${symbol})`,
    );
    console.log(`  ${symbol} allowed — verified (${hash})`);
    changed++;
    await sleep(2000);
  }

  console.log('\nDaily spend caps:');
  for (const [symbol, t] of Object.entries(target.tokens)) {
    const addr = t.address as `0x${string}`;
    const want = DAILY_CAP_USD * 10n ** BigInt(t.decimals);
    const have = (await publicClient.readContract({
      address: agentWallet, abi: AGENT_ABI, functionName: 'dailySpendCap', args: [addr],
    })) as bigint;
    if (have === want) {
      console.log(`  ${symbol} cap already ${have} — skip`);
      continue;
    }
    const hash = await wallet.writeContract({
      address: agentWallet, abi: AGENT_ABI, functionName: 'setDailySpendCap', args: [addr, want],
    });
    await confirm(publicClient, hash, `setDailySpendCap(${symbol})`);
    console.log(`  ${symbol} cap ${have} → ${want} (${hash})`);
    changed++;
    await sleep(2000);
  }

  // Finish the bookkeeping deploy-chain.ts does at the end of a clean run. If it
  // died partway — which is how this script comes to be needed — the record is
  // still marked partial and .env.local never got the addresses, so a recovered
  // deployment would look unfinished to everything downstream.
  record.status = 'complete';
  record.tokens = Object.fromEntries(
    Object.entries(target.tokens).map(([s, t]) => [s, t.address]),
  );
  record.dailyCapsUSD = Number(DAILY_CAP_USD);
  record.configuredAt = new Date().toISOString();
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log(`\nMarked deployments/${target.file} complete`);

  const keys = ENV_KEYS[targetName!];
  patchEnvLocal(keys.payment, payment);
  patchEnvLocal(keys.agent, agentWallet);
  console.log(`Patched .env.local: ${keys.payment}, ${keys.agent}`);

  console.log(`\n=== CONFIGURE COMPLETE — ${changed} change(s) applied ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
