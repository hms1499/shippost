/**
 * Toggle pause/unpause on both ShipPostPayment and AgentWallet.
 * Hardhat does not forward extra CLI args to scripts — use ACTION env var instead.
 *
 * Usage:
 *   ACTION=pause   npx hardhat run scripts/pause.ts --network celo
 *   ACTION=unpause npx hardhat run scripts/pause.ts --network celo
 *
 * DO NOT unpause mainnet unless rescue is complete and new owner key is in env.
 */
import { network } from 'hardhat';
import * as path from 'path';
import * as fs from 'fs';

const AGENT_ABI = [
  { name: 'paused',   type: 'function', stateMutability: 'view',        inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pause',    type: 'function', stateMutability: 'nonpayable',  inputs: [], outputs: [] },
  { name: 'unpause',  type: 'function', stateMutability: 'nonpayable',  inputs: [], outputs: [] },
] as const;

const PAYMENT_ABI = [
  { name: 'paused',   type: 'function', stateMutability: 'view',        inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pause',    type: 'function', stateMutability: 'nonpayable',  inputs: [], outputs: [] },
  { name: 'unpause',  type: 'function', stateMutability: 'nonpayable',  inputs: [], outputs: [] },
] as const;

function getAddresses(chainId: number): { payment: `0x${string}`; agent: `0x${string}` } {
  const net = chainId === 42220 ? 'celo' : 'celoSepolia';
  const f = path.join(process.cwd(), 'deployments', `${net}.json`);
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { payment: d.contracts.ShipPostPayment, agent: d.contracts.AgentWallet };
  }
  throw new Error(`No deployment file for chain ${chainId}`);
}

async function toggleContract(
  label: string,
  address: `0x${string}`,
  abi: typeof PAYMENT_ABI | typeof AGENT_ABI,
  action: 'pause' | 'unpause',
  signer: any,
  pub: any,
) {
  const isPaused = await pub.readContract({ address, abi, functionName: 'paused' }) as boolean;
  if (action === 'pause' && isPaused)   { console.log(`  ${label}: already paused — skip`);   return; }
  if (action === 'unpause' && !isPaused) { console.log(`  ${label}: already unpaused — skip`); return; }

  const hash = await signer.writeContract({ address, abi, functionName: action });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${action} ✓  ${hash}`);
}

async function main() {
  const action = (process.env.ACTION ?? '').toLowerCase();
  if (action !== 'pause' && action !== 'unpause') {
    console.error('Set ACTION=pause or ACTION=unpause');
    process.exit(1);
  }

  const { viem } = await network.create();
  const [signer] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();
  const chainId = await pub.getChainId();
  const { payment, agent } = getAddresses(chainId);

  console.log(`Action: ${action}  |  chain: ${chainId}`);
  await toggleContract('ShipPostPayment', payment, PAYMENT_ABI, action, signer, pub);
  await toggleContract('AgentWallet',     agent,   AGENT_ABI,   action, signer, pub);
}

main().catch((e) => { console.error(e); process.exit(1); });
