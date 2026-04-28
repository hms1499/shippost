import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  console.log('Deployer:', deployer.account.address);

  // Deploy mocks for all 3 stablecoins (Alfajores deprecated; Celo Sepolia has no cUSD)
  const mockCusd = await viem.deployContract('MockERC20', ['Mock Celo Dollar', 'cUSD', 18]);
  console.log('MockCUSD:', mockCusd.address);

  const mockUsdt = await viem.deployContract('MockERC20', ['Mock Tether', 'USDT', 6]);
  console.log('MockUSDT:', mockUsdt.address);

  const mockUsdc = await viem.deployContract('MockERC20', ['Mock USDC', 'USDC', 6]);
  console.log('MockUSDC:', mockUsdc.address);

  // Deploy AgentWallet first — its address is needed by Payment
  const agentWallet = await viem.deployContract('AgentWallet', []);
  console.log('AgentWallet:', agentWallet.address);

  // Use deployer as both treasury and reservePool for MVP simplicity
  const payment = await viem.deployContract('ShipPostPayment', [
    agentWallet.address,
    deployer.account.address, // treasury
    deployer.account.address, // reservePool
  ]);
  console.log('ShipPostPayment:', payment.address);

  // Whitelist all 3 mock tokens — wait for each receipt before next tx
  console.log('Whitelisting tokens...');
  let hash = await payment.write.setAllowedToken([mockCusd.address, true]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('  cUSD whitelisted');
  await sleep(2000);

  hash = await payment.write.setAllowedToken([mockUsdt.address, true]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('  USDT whitelisted');
  await sleep(2000);

  hash = await payment.write.setAllowedToken([mockUsdc.address, true]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('  USDC whitelisted');
  await sleep(2000);

  // Set daily caps on AgentWallet (50 USD equivalent per token)
  console.log('Setting daily caps...');
  hash = await agentWallet.write.setDailySpendCap([mockCusd.address, 50n * 10n ** 18n]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('  cUSD cap set');
  await sleep(2000);

  hash = await agentWallet.write.setDailySpendCap([mockUsdt.address, 50_000_000n]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('  USDT cap set');
  await sleep(2000);

  hash = await agentWallet.write.setDailySpendCap([mockUsdc.address, 50_000_000n]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('  USDC cap set');

  // Write addresses to a file for frontend consumption
  const out = {
    network: 'celoSepolia',
    chainId: 11142220,
    deployer: deployer.account.address,
    contracts: {
      ShipPostPayment: payment.address,
      AgentWallet: agentWallet.address,
      MockCUSD: mockCusd.address,
      MockUSDT: mockUsdt.address,
      MockUSDC: mockUsdc.address,
    },
    tokens: {
      cUSD: mockCusd.address,
      USDT: mockUsdt.address,
      USDC: mockUsdc.address,
    },
  };
  const outPath = path.join(__dirname, '..', 'deployments', 'celoSepolia.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(JSON.stringify(out.contracts, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
