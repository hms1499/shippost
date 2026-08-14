import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Await a receipt and REFUSE to continue unless it actually succeeded.
 *
 * waitForTransactionReceipt resolves for a reverted transaction too, so a bare
 * await reports failure as success. That is not hypothetical here: the first
 * Base deploy logged "USDC whitelisted" while setAllowedToken had run out of
 * gas (22,765 used) and reverted, leaving the contract live with no payable
 * token. Same class as the USDT approve-receipt bug in usePayForThread.
 */
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
 * load-balanced, and the node answering the read can be a block behind the one
 * that accepted the write. Observed live on Base — a confirmed setAllowedToken
 * read back as false, then true eight seconds later.
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

/**
 * Block until the RPC actually reports code at `address`.
 *
 * eth_estimateGas against a contract the node has not indexed yet estimates as
 * if it were an EOA — ~21,000 gas — and the resulting transaction dies of
 * out-of-gas on arrival. That is exactly how the first Base whitelist tx was
 * lost, so configuration waits for the code to be visible rather than assuming
 * a deploy receipt is enough.
 */
async function waitForCode(publicClient: any, address: `0x${string}`, label: string) {
  for (let i = 0; i < 30; i++) {
    const code = await publicClient.getCode({ address });
    if (code && code !== '0x') return;
    await sleep(1000);
  }
  throw new Error(`${label} at ${address} still reports no code after 30s`);
}

// Inline rather than viem.getContractAt('IERC20Metadata', ...): the interface
// comes from OpenZeppelin, so Hardhat has no artifact under that bare name.
const ERC20_ALLOWED_ABI = [
  {
    inputs: [{ type: 'address' }],
    name: 'allowedTokens',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ERC20_METADATA_ABI = [
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
] as const;

// Per-target deploy config. deploy-mainnet.ts asserted chainId 42220 and wrote
// deployments/celo.json; the guard was right and stays, only its hardcoded
// constants move in here.
//
// startThreadId is offset per chain so a bare thread id identifies its own
// chain in a log, and so a redeploy never collides with the previous contract's
// counter — the backend replay guard keys on (chainId, threadId), so the
// database was already safe, but a colliding id makes every log ambiguous.
//
// Token maps MUST match lib/tokens.ts. Base ships USDC only: USDT on Base is
// deliberately out of scope until its address is verified on-chain, and an
// unverified address reaching setAllowedToken on mainnet is the expensive
// class of mistake. Base USDC below was verified on 2026-08-14
// (symbol() == 'USDC', decimals() == 6).
const TARGETS = {
  base: {
    chainId: 8453,
    startThreadId: 1_000_000n,
    file: 'base.json',
    // Measured 2026-08-14: the two deploys plus the config txs are 2,212,128
    // gas, which at Base's typical 0.006 gwei is ~0.0000133 ETH. This floor is
    // ~7x that, so it still refuses a deploy that could strand half-finished
    // while not blocking one that comfortably fits. Far below Celo's floor
    // because CELO gas costs orders of magnitude more per unit.
    minNativeWei: 100_000_000_000_000n, // 0.0001 ETH
    nativeSymbol: 'ETH',
    tokens: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    },
  },
  baseSepolia: {
    chainId: 84532,
    startThreadId: 1_000_000n,
    file: 'baseSepolia.json',
    minNativeWei: 100_000_000_000_000n, // 0.0001 ETH, same measurement as base
    nativeSymbol: 'ETH',
    tokens: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
    },
  },
  celo: {
    chainId: 42220,
    startThreadId: 200_000n,
    file: 'celo.json',
    minNativeWei: 100_000_000_000_000_000n, // 0.1 CELO
    nativeSymbol: 'CELO',
    tokens: {
      cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
      USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
      USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
    },
  },
} as const;

type TargetName = keyof typeof TARGETS;

// $10/day per token, conservative for mainnet. Scaled from each token's own
// decimals rather than hardcoded — cUSD is 18, USDC/USDT are 6.
const DAILY_CAP_USD = 10n;

// Which env var pair each target's addresses belong to, so .env.local is patched
// with the same names lib/contracts.ts reads.
const ENV_KEYS: Record<TargetName, { payment: string; agent: string }> = {
  base: {
    payment: 'NEXT_PUBLIC_PAYMENT_CONTRACT_BASE',
    agent: 'NEXT_PUBLIC_AGENT_WALLET_BASE',
  },
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
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    // Normalise the trailing newline before appending. Without it a file whose
    // last line has no newline gets the next key glued onto the end of it —
    // observed live, which left NEXT_PUBLIC_AGENT_WALLET_BASE holding an
    // address with a whole other assignment stuck to it.
    content = `${content.replace(/\n*$/, '')}\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, `${content.replace(/\n*$/, '')}\n`);
}

async function main() {
  const targetName = process.env.DEPLOY_TARGET as TargetName | undefined;
  const target = targetName ? TARGETS[targetName] : undefined;
  if (!target) {
    throw new Error(`set DEPLOY_TARGET to one of ${Object.keys(TARGETS).join(', ')}`);
  }

  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const deployerAddr = deployer.account.address;

  // Assert the network BEFORE anything is deployed: --network and DEPLOY_TARGET
  // are set independently, and a mismatch would put the contracts on the wrong
  // chain with the wrong token whitelist.
  const chainId = await publicClient.getChainId();
  if (chainId !== target.chainId) {
    throw new Error(
      `Wrong network: DEPLOY_TARGET=${targetName} expects chainId ${target.chainId}, connected to ${chainId}`,
    );
  }

  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Target:   ${targetName} (chainId ${chainId})`);

  const balance = await publicClient.getBalance({ address: deployerAddr });
  if (balance < target.minNativeWei) {
    throw new Error(
      `Insufficient ${target.nativeSymbol}: deployer holds ${balance} wei, need at least ${target.minNativeWei}.`,
    );
  }
  console.log(`Deployer balance: ${balance} wei ${target.nativeSymbol} — OK`);

  // Verify every token on-chain before it can reach setAllowedToken. The
  // addresses below are ours, not an independent source, and a wrong one would
  // whitelist a token users cannot pay with (or worse, one we do not control).
  console.log('Verifying token addresses on-chain...');
  for (const [symbol, t] of Object.entries(target.tokens)) {
    const [onChainSymbol, onChainDecimals] = await Promise.all([
      publicClient.readContract({
        address: t.address as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: 'symbol',
      }),
      publicClient.readContract({
        address: t.address as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: 'decimals',
      }),
    ]);
    if (onChainDecimals !== t.decimals) {
      throw new Error(
        `${symbol} at ${t.address}: decimals() is ${onChainDecimals}, expected ${t.decimals}`,
      );
    }
    console.log(`  ${symbol} → ${onChainSymbol}, ${onChainDecimals} decimals — OK`);
  }

  // 1. AgentWallet — owner = deployer
  const agentWallet = await viem.deployContract('AgentWallet', []);
  console.log('AgentWallet:', agentWallet.address);

  // 2. ShipPostPayment — treasury = deployer. Reserve is retained in-contract.
  const payment = await viem.deployContract('ShipPostPayment', [
    agentWallet.address,
    deployerAddr,
    target.startThreadId,
  ]);
  console.log('ShipPostPayment:', payment.address);

  // Persist addresses immediately, before the configuration txs: if one of them
  // fails the contracts still exist and must not be lost.
  const outPath = path.join(__dirname, '..', 'deployments', target.file);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const record = {
    network: targetName,
    chainId: target.chainId,
    deployer: deployerAddr,
    contracts: {
      ShipPostPayment: payment.address,
      AgentWallet: agentWallet.address,
    },
    startThreadId: target.startThreadId.toString(),
    status: 'partial — configuration in progress',
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log(`Partial deploy record saved to deployments/${target.file}`);

  // Both contracts must be visible to the RPC before anything is estimated
  // against them — see waitForCode.
  await waitForCode(publicClient, payment.address, 'ShipPostPayment');
  await waitForCode(publicClient, agentWallet.address, 'AgentWallet');

  // 3. Whitelist tokens on ShipPostPayment
  console.log('Whitelisting tokens...');
  for (const [symbol, t] of Object.entries(target.tokens)) {
    const hash = await payment.write.setAllowedToken([t.address as `0x${string}`, true]);
    await confirm(publicClient, hash, `setAllowedToken(${symbol})`);
    // Read it back: the receipt says the call did not revert, this says it did
    // what it was for. Retried, because a read straight after a write can hit a
    // load-balanced node that is a block behind and answer with the old value.
    await readUntil(
      () =>
        publicClient.readContract({
          address: payment.address,
          abi: ERC20_ALLOWED_ABI,
          functionName: 'allowedTokens',
          args: [t.address as `0x${string}`],
        }),
      (v: unknown) => v === true,
      `allowedTokens(${symbol})`,
    );
    console.log(`  ${symbol} whitelisted — verified on-chain`);
    await sleep(2000);
  }

  // 4. Daily spend caps on AgentWallet. A cap left at 0 reverts CAP_EXCEEDED on
  // every executeX402Call, so this is required, not optional.
  console.log(`Setting daily spend caps ($${DAILY_CAP_USD}/day per token)...`);
  for (const [symbol, t] of Object.entries(target.tokens)) {
    const cap = DAILY_CAP_USD * 10n ** BigInt(t.decimals);
    const hash = await agentWallet.write.setDailySpendCap([t.address as `0x${string}`, cap]);
    await confirm(publicClient, hash, `setDailySpendCap(${symbol})`);
    console.log(`  ${symbol} cap set to ${cap}`);
    await sleep(2000);
  }

  // 5. Final record
  const finalRecord = {
    ...record,
    tokens: Object.fromEntries(
      Object.entries(target.tokens).map(([s, t]) => [s, t.address]),
    ),
    dailyCapsUSD: Number(DAILY_CAP_USD),
    status: 'complete',
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(finalRecord, null, 2));
  console.log(`\nWrote ${outPath}`);

  // 6. Patch .env.local so a local run picks the new addresses up immediately.
  // Vercel is a separate step, and must be set via the REST API rather than
  // `vercel env add` over stdin, which has stored "" on this project twice.
  const keys = ENV_KEYS[targetName!];
  patchEnvLocal(keys.payment, payment.address);
  patchEnvLocal(keys.agent, agentWallet.address);
  console.log(`Patched .env.local: ${keys.payment}, ${keys.agent}`);

  console.log('\n=== DEPLOY COMPLETE ===');
  console.log('ShipPostPayment:', payment.address);
  console.log('AgentWallet:    ', agentWallet.address);
  console.log('\nNext: seed the reserve, then set the same two vars on Vercel.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
