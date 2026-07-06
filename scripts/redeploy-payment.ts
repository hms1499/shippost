import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { isAddress, getAddress } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real Celo mainnet stablecoin addresses (matches lib/tokens.ts CELO_MAINNET_TOKENS)
const MAINNET_TOKENS = {
  cUSD: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`,
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`,
  USDC: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`,
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
    : content + `\n${key}=${value}`;
  fs.writeFileSync(envPath, content);
}

function requireAddrEnv(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v || !isAddress(v)) {
    throw new Error(
      `${name} missing or not a valid address. Set it before redeploying: ${name}=0x...`,
    );
  }
  return getAddress(v) as `0x${string}`;
}

async function main() {
  // Payout targets are env-driven. The reserve is retained in-contract now
  // (v2), so there is no reservePool address. startThreadId MUST be above the
  // OLD contract's highest threadId or fresh payments collide with existing DB
  // rows on the (chainId, threadId) replay guard — default 100000 is safely past
  // the current ~32.
  const treasury = requireAddrEnv('TREASURY_ADDRESS');
  const newOwner = requireAddrEnv('NEW_OWNER_ADDRESS');
  const startThreadId = BigInt(process.env.START_THREAD_ID ?? '100000');

  // Reuse the live AgentWallet — do NOT deploy a new one (it holds funds and
  // already has daily caps + correct owner).
  const deployPath = path.join(__dirname, '..', 'deployments', 'celo.json');
  const prev = JSON.parse(fs.readFileSync(deployPath, 'utf8')) as {
    contracts: { AgentWallet: string };
  };
  const agentWalletAddr = prev.contracts?.AgentWallet;
  if (!agentWalletAddr || !isAddress(agentWalletAddr)) {
    throw new Error('Existing AgentWallet address not found in deployments/celo.json');
  }
  const agentWallet = getAddress(agentWalletAddr) as `0x${string}`;

  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const deployerAddr = deployer.account.address;

  const chainId = await publicClient.getChainId();
  if (chainId !== 42220) throw new Error(`Wrong network: expected 42220, got ${chainId}`);

  const balance = await publicClient.getBalance({ address: deployerAddr });
  const MIN_CELO = 100_000_000_000_000_000n; // 0.1 CELO
  if (balance < MIN_CELO) {
    throw new Error(`Insufficient CELO: deployer has ${balance} wei, need >= 0.1 CELO`);
  }

  console.log('=== Redeploy ShipPostPayment (mainnet) ===');
  console.log('Deployer    :', deployerAddr);
  console.log('AgentWallet :', agentWallet, '(reused, not redeployed)');
  console.log('Treasury    :', treasury);
  console.log('StartThreadId:', startThreadId.toString());
  console.log('New owner   :', newOwner);

  // 1. Deploy ShipPostPayment v2 (reserve retained in-contract)
  const payment = await viem.deployContract('ShipPostPayment', [
    agentWallet,
    treasury,
    startThreadId,
  ]);
  console.log('\nShipPostPayment deployed:', payment.address);

  // Persist immediately so a later config failure doesn't lose the address
  const partial = {
    network: 'celo',
    chainId: 42220,
    deployer: deployerAddr,
    contracts: { ShipPostPayment: payment.address, AgentWallet: agentWallet },
    treasury,
    startThreadId: startThreadId.toString(),
    status: 'partial — configuration in progress',
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(deployPath, JSON.stringify(partial, null, 2));
  console.log('Partial record saved to deployments/celo.json');

  // 2. Whitelist tokens — a fresh contract has an empty allowlist, so
  //    payForThread reverts TOKEN_NOT_ALLOWED until this runs.
  console.log('\nWhitelisting tokens...');
  for (const [symbol, addr] of Object.entries(MAINNET_TOKENS) as [string, `0x${string}`][]) {
    const hash = await payment.write.setAllowedToken([addr, true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol} whitelisted`);
    await sleep(2000);
  }

  // 3. Transfer ownership LAST (after admin config, while deployer is owner)
  console.log('\nTransferring ownership to', newOwner, '...');
  const transferHash = await payment.write.transferOwnership([newOwner]);
  await publicClient.waitForTransactionReceipt({ hash: transferHash });
  const onChainOwner = await payment.read.owner();
  if (onChainOwner.toLowerCase() !== newOwner.toLowerCase()) {
    throw new Error(`Ownership transfer failed: owner is ${onChainOwner}, expected ${newOwner}`);
  }
  console.log('Ownership confirmed:', onChainOwner);

  // 4. Final record + env
  const out = {
    network: 'celo',
    chainId: 42220,
    deployer: deployerAddr,
    owner: newOwner,
    contracts: { ShipPostPayment: payment.address, AgentWallet: agentWallet },
    treasury,
    startThreadId: startThreadId.toString(),
    tokens: MAINNET_TOKENS,
    dailyCapsUSD: 10,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(deployPath, JSON.stringify(out, null, 2));
  patchEnvLocal('NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET', payment.address);

  console.log('\n=== REDEPLOY COMPLETE ===');
  console.log('ShipPostPayment:', payment.address);
  console.log('Next steps:');
  console.log('  1. vercel env: set NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET =', payment.address, '(Production)');
  console.log('  2. Update README + deployments/celo.json references');
  console.log('  3. Redeploy frontend so the new contract is used');
  console.log('  4. Seed the refund reserve: transfer a small stablecoin float');
  console.log('     to', payment.address, '— refunds are paid from its balance,');
  console.log('     which starts at 0 and only accrues 10% of new payments.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
