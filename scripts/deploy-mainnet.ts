import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real Celo mainnet stablecoin addresses (matches lib/tokens.ts CELO_MAINNET_TOKENS)
const MAINNET_TOKENS = {
  cUSD: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`,
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`,
  USDC: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`,
};

// $10/day caps — cUSD has 18 decimals, USDT/USDC have 6
const DAILY_CAPS = {
  cUSD: 10n * 10n ** 18n,
  USDT: 10_000_000n,
  USDC: 10_000_000n,
};

function patchEnvLocal(key: string, value: string) {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${key}=${value}\n`);
    return;
  }
  let content = fs.readFileSync(envPath, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content);
}

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const deployerAddr = deployer.account.address;
  console.log('Deployer:', deployerAddr);
  console.log('Network: Celo mainnet (chainId 42220)');

  // 1. Deploy AgentWallet — owner = deployer
  const agentWallet = await viem.deployContract('AgentWallet', []);
  console.log('AgentWallet:', agentWallet.address);

  // 2. Deploy ShipPostPayment — treasury and reservePool both = deployer (MVP)
  const payment = await viem.deployContract('ShipPostPayment', [
    agentWallet.address,
    deployerAddr, // treasury
    deployerAddr, // reservePool
  ]);
  console.log('ShipPostPayment:', payment.address);

  // 3. Whitelist real mainnet tokens on ShipPostPayment
  console.log('Whitelisting tokens...');
  for (const [symbol, addr] of Object.entries(MAINNET_TOKENS) as [string, `0x${string}`][]) {
    const hash = await payment.write.setAllowedToken([addr, true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol} whitelisted`);
    await sleep(2000);
  }

  // 4. Set $10/day spend caps on AgentWallet
  console.log('Setting daily spend caps ($10/day per token)...');
  for (const [symbol, addr] of Object.entries(MAINNET_TOKENS) as [string, `0x${string}`][]) {
    const cap = DAILY_CAPS[symbol as keyof typeof DAILY_CAPS];
    const hash = await agentWallet.write.setDailySpendCap([addr, cap]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol} cap set`);
    await sleep(2000);
  }

  // 5. Write deployments/celo.json
  const out = {
    network: 'celo',
    chainId: 42220,
    deployer: deployerAddr,
    contracts: {
      ShipPostPayment: payment.address,
      AgentWallet: agentWallet.address,
    },
    tokens: MAINNET_TOKENS,
    dailyCapsUSD: 10,
    deployedAt: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, '..', 'deployments', 'celo.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);

  // 6. Patch .env.local with mainnet contract addresses
  patchEnvLocal('NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET', payment.address);
  patchEnvLocal('NEXT_PUBLIC_AGENT_WALLET_MAINNET', agentWallet.address);
  console.log('Patched .env.local with mainnet addresses');

  console.log('\n=== DEPLOY COMPLETE ===');
  console.log('ShipPostPayment:', payment.address);
  console.log('AgentWallet:    ', agentWallet.address);
  console.log('\nNext: push env vars to Vercel (see Task 4)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
