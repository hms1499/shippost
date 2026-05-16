/**
 * EMERGENCY RESCUE SCRIPT
 *
 * Dùng khi owner key bị compromise. Script làm 4 việc theo thứ tự:
 *   1. Pause ShipPostPayment  (ngăn payForThread mới)
 *   2. Pause AgentWallet      (ngăn executeX402Call)
 *   3. emergencyWithdraw tất cả cUSD / USDT / USDC về SAFE_ADDRESS
 *   4. transferOwnership cả 2 contract về SAFE_ADDRESS
 *
 * Cách chạy:
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   SAFE_ADDRESS=0x<new-wallet> \
 *   npx hardhat run scripts/emergency-rescue.ts --network celo
 *
 * SAFE_ADDRESS phải là ví mới hoàn toàn, KHÔNG cùng seed phrase với key bị hack.
 */

import { network } from 'hardhat';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: false });

const SAFE_ADDRESS = process.env.SAFE_ADDRESS as `0x${string}` | undefined;

const TOKENS: Record<string, { address: `0x${string}`; decimals: number }> = {
  cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
};

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const PAYMENT_ABI = [
  { name: 'paused',  type: 'function', stateMutability: 'view',   inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pause',   type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'transferOwnership', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
] as const;

const AGENT_ABI = [
  { name: 'paused',  type: 'function', stateMutability: 'view',   inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pause',   type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'emergencyWithdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to',     type: 'address' },
    ], outputs: [] },
  { name: 'transferOwnership', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
] as const;

function getAddresses(): { payment: `0x${string}`; agent: `0x${string}` } {
  const f = path.join(process.cwd(), 'deployments', 'celo.json');
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { payment: d.contracts.ShipPostPayment, agent: d.contracts.AgentWallet };
  }
  return {
    payment: '0x40dc09399f24a8052f10ad4930246d1409390343',
    agent:   '0xe9b5e714509d7ad317e51e78ad34fa8bd4da7a97',
  };
}

async function main() {
  if (!SAFE_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(SAFE_ADDRESS)) {
    console.error('ERROR: Set SAFE_ADDRESS=0x<new-wallet> — must be a fresh wallet, NOT same seed as hacked key.');
    process.exit(1);
  }

  const { viem } = await network.create();
  const [signer] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const chainId = await pub.getChainId();
  if (chainId !== 42220) {
    console.error(`Wrong network: expected Celo mainnet (42220), got ${chainId}`);
    process.exit(1);
  }

  const { payment, agent } = getAddresses();
  const signerAddr = signer.account.address;

  console.log('=== EMERGENCY RESCUE ===');
  console.log(`Signer      : ${signerAddr}`);
  console.log(`Safe target : ${SAFE_ADDRESS}`);
  console.log(`Payment     : ${payment}`);
  console.log(`AgentWallet : ${agent}`);
  console.log('');

  // ── 1. Pause ShipPostPayment ──────────────────────────────────────────────
  const paymentPaused = await pub.readContract({ address: payment, abi: PAYMENT_ABI, functionName: 'paused' });
  if (paymentPaused) {
    console.log('[1] ShipPostPayment already paused — skip');
  } else {
    console.log('[1] Pausing ShipPostPayment...');
    const h = await signer.writeContract({ address: payment, abi: PAYMENT_ABI, functionName: 'pause' });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`    ✓ https://celoscan.io/tx/${h}`);
  }

  // ── 2. Pause AgentWallet ──────────────────────────────────────────────────
  const agentPaused = await pub.readContract({ address: agent, abi: AGENT_ABI, functionName: 'paused' });
  if (agentPaused) {
    console.log('[2] AgentWallet already paused — skip');
  } else {
    console.log('[2] Pausing AgentWallet...');
    const h = await signer.writeContract({ address: agent, abi: AGENT_ABI, functionName: 'pause' });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`    ✓ https://celoscan.io/tx/${h}`);
  }

  // ── 3. Drain all tokens from AgentWallet ─────────────────────────────────
  console.log('[3] Draining AgentWallet tokens...');
  for (const [sym, tok] of Object.entries(TOKENS)) {
    const balance = await pub.readContract({
      address: tok.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [agent],
    }) as bigint;

    const fmt = (n: bigint) => `${(Number(n) / 10 ** tok.decimals).toFixed(4)} ${sym}`;

    if (balance === 0n) {
      console.log(`    ${sym}: 0 — skip`);
      continue;
    }

    console.log(`    Withdrawing ${fmt(balance)} → ${SAFE_ADDRESS}`);
    const h = await signer.writeContract({
      address: agent, abi: AGENT_ABI, functionName: 'emergencyWithdraw',
      args: [tok.address, balance, SAFE_ADDRESS],
    });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`    ✓ https://celoscan.io/tx/${h}`);
  }

  // ── 4. Transfer ownership of both contracts ───────────────────────────────
  console.log('[4] Transferring ownership...');

  const h1 = await signer.writeContract({
    address: payment, abi: PAYMENT_ABI, functionName: 'transferOwnership', args: [SAFE_ADDRESS],
  });
  await pub.waitForTransactionReceipt({ hash: h1 });
  console.log(`    ShipPostPayment → ${SAFE_ADDRESS}`);
  console.log(`    ✓ https://celoscan.io/tx/${h1}`);

  const h2 = await signer.writeContract({
    address: agent, abi: AGENT_ABI, functionName: 'transferOwnership', args: [SAFE_ADDRESS],
  });
  await pub.waitForTransactionReceipt({ hash: h2 });
  console.log(`    AgentWallet → ${SAFE_ADDRESS}`);
  console.log(`    ✓ https://celoscan.io/tx/${h2}`);

  console.log('');
  console.log('=== RESCUE COMPLETE ===');
  console.log('Bước tiếp theo (ngoài chain):');
  console.log('  • Rotate AGENT_WALLET_PRIVATE_KEY trên Vercel');
  console.log('  • Rotate GROQ_API_KEY, SERPER_API_KEY');
  console.log('  • Rotate SUPABASE_SERVICE_ROLE');
  console.log('  • Redeploy contracts nếu cần unpause từ safe address mới');
}

main().catch((e) => { console.error(e); process.exit(1); });
