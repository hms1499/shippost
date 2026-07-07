/**
 * Seed (nạp) reserve cho ShipPostPayment v2 — chuyển stablecoin từ deployer
 * vào thẳng contract. Reserve trả refund; rút lại được bằng withdrawReserve
 * (owner-only), nên đây là gửi tạm chứ không phải chi tiêu.
 *
 * Usage:
 *   SEED_TOKEN=cUSD SEED_AMOUNT=1.5 npx hardhat run scripts/seed-reserve.ts --network celo
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

function getPaymentContract(): `0x${string}` {
  const f = path.join(process.cwd(), 'deployments', 'celo.json');
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (d?.contracts?.ShipPostPayment) return d.contracts.ShipPostPayment;
  }
  throw new Error('deployments/celo.json missing ShipPostPayment address');
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

  const paymentAddr = getPaymentContract();
  const ownerAddr = owner.account.address;
  const amount = parseUnits(AMOUNT_IN, token.decimals);
  const fmt = (n: bigint) => `${formatUnits(n, token.decimals)} ${TOKEN_SYM}`;

  const [deployerBal, reserveBefore, celoBal] = await Promise.all([
    pub.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [ownerAddr] }),
    pub.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [paymentAddr] }),
    pub.getBalance({ address: ownerAddr }),
  ]);

  console.log(`Deployer      : ${ownerAddr}`);
  console.log(`Payment (v2)  : ${paymentAddr}`);
  console.log(`Deployer bal  : ${fmt(deployerBal)} | gas ${formatUnits(celoBal, 18)} CELO`);
  console.log(`Reserve before: ${fmt(reserveBefore)}`);
  console.log(`Seeding       : ${fmt(amount)}`);

  if (deployerBal < amount) throw new Error(`Insufficient ${TOKEN_SYM}: have ${fmt(deployerBal)}, need ${fmt(amount)}`);
  if (celoBal === 0n) throw new Error('Deployer has 0 CELO for gas');

  // Same explicit gas limit as withdraw-agent.ts — some Celo RPCs underestimate
  // (EIP-7623 calldata floor). Unused gas is not charged.
  const hash = await owner.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [paymentAddr, amount],
    gas: 200_000n,
  });

  await pub.waitForTransactionReceipt({ hash });

  // Load-balanced RPCs can serve a stale balance right after the receipt —
  // retry until the read reflects the transfer instead of reporting a false 0.
  let reserveAfter = reserveBefore;
  for (let i = 0; i < 5 && reserveAfter < reserveBefore + amount; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));
    reserveAfter = await pub.readContract({
      address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [paymentAddr],
    });
  }
  console.log(`✓ Done: https://celoscan.io/tx/${hash}`);
  console.log(`Reserve after : ${fmt(reserveAfter)}${reserveAfter < reserveBefore + amount ? ' (RPC may be lagging — verify on celoscan)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
