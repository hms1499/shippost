/**
 * Toggle ShipPostPayment pause/unpause via the deployer EOA.
 * Usage:
 *   npx hardhat run scripts/pause.ts --network celoSepolia pause
 *   npx hardhat run scripts/pause.ts --network celoSepolia unpause
 *
 * DO NOT pause mainnet outside of an actual incident — this is the kill switch.
 */
import { network } from 'hardhat';
import { shipPostPaymentAbi, getContracts } from '../lib/contracts.js';

async function main() {
  const action = process.argv[process.argv.length - 1];
  if (action !== 'pause' && action !== 'unpause') {
    console.error('usage: pnpm hardhat run scripts/pause.ts --network <net> <pause|unpause>');
    process.exit(1);
  }

  const { viem } = await network.create();
  const [signer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const contracts = getContracts(chainId);

  const isPaused = await publicClient.readContract({
    address: contracts.ShipPostPayment,
    abi: shipPostPaymentAbi,
    functionName: 'paused',
  });
  console.log(`current paused state on chain ${chainId}: ${isPaused}`);

  if (action === 'pause' && isPaused) {
    console.log('already paused — no-op');
    return;
  }
  if (action === 'unpause' && !isPaused) {
    console.log('already unpaused — no-op');
    return;
  }

  const hash = await signer.writeContract({
    address: contracts.ShipPostPayment,
    abi: shipPostPaymentAbi,
    functionName: action,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${action} tx: ${hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
