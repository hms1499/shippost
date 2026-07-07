/**
 * Seed (nạp) stablecoin từ deployer vào reserve (ShipPostPayment v2) hoặc
 * AgentWallet. Cả hai chiều đều đảo ngược được: reserve rút bằng
 * withdrawReserve, AgentWallet rút bằng emergencyWithdraw (đều owner-only),
 * nên đây là gửi tạm chứ không phải chi tiêu.
 *
 * Usage:
 *   SEED_TOKEN=cUSD SEED_AMOUNT=1.5 npx hardhat run scripts/seed-reserve.ts --network celo
 *   SEED_TO=agent SEED_TOKEN=cUSD SEED_AMOUNT=1 npx hardhat run scripts/seed-reserve.ts --network celo
 *   SEED_TO=0x... SEED_AMOUNT=0.5   → arbitrary recipient (e.g. a test wallet)
 */

import { network } from 'hardhat';
import { parseUnits, formatUnits } from 'viem';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: false });

const TOKEN_SYM = (process.env.SEED_TOKEN ?? 'cUSD') as 'cUSD' | 'USDT' | 'USDC';
const AMOUNT_IN = process.env.SEED_AMOUNT ?? '';
const SEED_TO = process.env.SEED_TO ?? 'reserve'; // 'reserve' | 'agent' | 0x-address

const TOKENS = {
  cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`, decimals: 18 },
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`, decimals: 6  },
  USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`, decimals: 6  },
};

const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }] },
] as const;

function getTarget(): { label: string; address: `0x${string}` } {
  if (/^0x[0-9a-fA-F]{40}$/.test(SEED_TO)) {
    return { label: 'Recipient', address: SEED_TO as `0x${string}` };
  }
  if (SEED_TO !== 'reserve' && SEED_TO !== 'agent') {
    throw new Error(`SEED_TO must be 'reserve', 'agent', or a 0x address — got: ${SEED_TO}`);
  }
  const f = path.join(process.cwd(), 'deployments', 'celo.json');
  if (!fs.existsSync(f)) throw new Error('deployments/celo.json not found');
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const key = SEED_TO === 'agent' ? 'AgentWallet' : 'ShipPostPayment';
  const address = d?.contracts?.[key];
  if (!address) throw new Error(`deployments/celo.json missing ${key} address`);
  return { label: SEED_TO === 'agent' ? 'AgentWallet' : 'Payment (v2)', address };
}

async function main() {
  if (!AMOUNT_IN) throw new Error('SEED_AMOUNT is required (e.g. SEED_AMOUNT=1.5)');

  const { viem } = await network.create();
  const [owner] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const chainId = await pub.getChainId();
  if (chainId !== 42220) throw new Error(`Wrong network: expected Celo mainnet (42220), got ${chainId}`);

  const token = TOKENS[TOKEN_SYM];
  if (!token) throw new Error(`Unknown token: ${TOKEN_SYM}`);

  const target = getTarget();
  const ownerAddr = owner.account.address;
  const amount = parseUnits(AMOUNT_IN, token.decimals);
  const fmt = (n: bigint) => `${formatUnits(n, token.decimals)} ${TOKEN_SYM}`;

  const [deployerBal, targetBefore, celoBal] = await Promise.all([
    pub.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [ownerAddr] }),
    pub.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [target.address] }),
    pub.getBalance({ address: ownerAddr }),
  ]);

  console.log(`Deployer      : ${ownerAddr}`);
  console.log(`${target.label.padEnd(14)}: ${target.address}`);
  console.log(`Deployer bal  : ${fmt(deployerBal)} | gas ${formatUnits(celoBal, 18)} CELO`);
  console.log(`Target before : ${fmt(targetBefore)}`);
  console.log(`Seeding       : ${fmt(amount)}`);

  if (deployerBal < amount) throw new Error(`Insufficient ${TOKEN_SYM}: have ${fmt(deployerBal)}, need ${fmt(amount)}`);
  if (celoBal === 0n) throw new Error('Deployer has 0 CELO for gas');

  // Same explicit gas limit as withdraw-agent.ts — some Celo RPCs underestimate
  // (EIP-7623 calldata floor). Unused gas is not charged.
  const hash = await owner.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [target.address, amount],
    gas: 200_000n,
  });

  await pub.waitForTransactionReceipt({ hash });

  // Load-balanced RPCs can serve a stale balance right after the receipt —
  // retry until the read reflects the transfer instead of reporting a false 0.
  let targetAfter = targetBefore;
  for (let i = 0; i < 5 && targetAfter < targetBefore + amount; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));
    targetAfter = await pub.readContract({
      address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [target.address],
    });
  }
  console.log(`✓ Done: https://celoscan.io/tx/${hash}`);
  console.log(`Target after  : ${fmt(targetAfter)}${targetAfter < targetBefore + amount ? ' (RPC may be lagging — verify on celoscan)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
