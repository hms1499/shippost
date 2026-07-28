/**
 * Rút reserve (10% giữ lại trong ShipPostPayment) về owner.
 * Chỉ owner (DEPLOYER_PRIVATE_KEY) mới gọi được.
 *
 * LƯU Ý: reserve là nguồn trả refund — refund() transfer thẳng từ balance của
 * contract và revert RESERVE_INSUFFICIENT nếu thiếu. Rút cạn = không refund
 * được cho user. Dùng RESERVE_KEEP để chừa lại một phần.
 *
 * Usage:
 *   WITHDRAW_TOKEN=USDC WITHDRAW_AMOUNT=all npx hardhat run scripts/withdraw-reserve.ts --network celo
 *   WITHDRAW_TOKEN=cUSD WITHDRAW_AMOUNT=all RESERVE_KEEP=0.5 npx hardhat run scripts/withdraw-reserve.ts --network celo
 *   WITHDRAW_TOKEN=cUSD WITHDRAW_AMOUNT=1.25 WITHDRAW_TO=0x... npx hardhat run scripts/withdraw-reserve.ts --network celo
 */

import { network } from 'hardhat';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: false });

const TOKEN_SYM = (process.env.WITHDRAW_TOKEN ?? 'cUSD') as 'cUSD' | 'USDT' | 'USDC';
const AMOUNT_IN = process.env.WITHDRAW_AMOUNT ?? 'all';
const KEEP_IN = process.env.RESERVE_KEEP ?? '0';
const TO_IN = process.env.WITHDRAW_TO as `0x${string}` | undefined;

const TOKENS = {
  cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`, decimals: 18 },
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`, decimals: 6  },
  USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`, decimals: 6  },
};

const ERC20_ABI = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
}] as const;

const PAYMENT_ABI = [
  { name: 'owner', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'withdrawReserve', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',  type: 'address' },
      { name: 'to',     type: 'address' },
      { name: 'amount', type: 'uint256' },
    ], outputs: [] },
] as const;

function getPayment(): `0x${string}` {
  const f = path.join(process.cwd(), 'deployments', 'celo.json');
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (d?.contracts?.ShipPostPayment) return d.contracts.ShipPostPayment;
  }
  return '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800';
}

function parseUnits(v: string, decimals: number): bigint {
  const [whole, frac = ''] = v.trim().split('.');
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) throw new Error(`Bad amount: ${v}`);
  if (frac.length > decimals) throw new Error(`Too many decimals for ${TOKEN_SYM}: ${v}`);
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

async function main() {
  const { viem } = await network.create();
  const [owner] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const chainId = await pub.getChainId();
  if (chainId !== 42220) throw new Error(`Wrong network: expected Celo mainnet (42220), got ${chainId}`);

  const token = TOKENS[TOKEN_SYM];
  if (!token) throw new Error(`Unknown token: ${TOKEN_SYM}`);

  const payment = getPayment();
  const signerAddr = owner.account.address;
  const to = TO_IN ?? signerAddr;
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error(`Bad WITHDRAW_TO: ${to}`);

  const onchainOwner = await pub.readContract({
    address: payment, abi: PAYMENT_ABI, functionName: 'owner',
  }) as `0x${string}`;
  if (onchainOwner.toLowerCase() !== signerAddr.toLowerCase()) {
    throw new Error(`Signer ${signerAddr} is not the owner (${onchainOwner}) — tx would revert`);
  }

  const balance = await pub.readContract({
    address: token.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [payment],
  }) as bigint;

  const decimals = token.decimals;
  const fmt = (n: bigint) => `${(Number(n) / 10 ** decimals).toFixed(decimals === 18 ? 6 : 4)} ${TOKEN_SYM}`;

  console.log(`Payment  : ${payment}`);
  console.log(`Owner    : ${signerAddr}`);
  console.log(`Reserve  : ${fmt(balance)}`);

  if (balance === 0n) {
    console.log('Nothing to withdraw.');
    return;
  }

  // Chừa lại một phần reserve để refund() còn chạy được.
  const keep = parseUnits(KEEP_IN, decimals);
  const available = balance > keep ? balance - keep : 0n;
  if (keep > 0n) console.log(`Keep     : ${fmt(keep)} (available ${fmt(available)})`);
  if (available === 0n) {
    console.log('Nothing withdrawable after RESERVE_KEEP.');
    return;
  }

  const amount = AMOUNT_IN === 'all' ? available : parseUnits(AMOUNT_IN, decimals);
  if (amount > available) {
    throw new Error(`Requested ${fmt(amount)} but only ${fmt(available)} is withdrawable`);
  }

  const left = balance - amount;
  console.log(`Withdraw : ${fmt(amount)} → ${to}`);
  console.log(`Left     : ${fmt(left)}`);
  if (left === 0n) console.log('⚠  Reserve về 0 — refund() sẽ revert RESERVE_INSUFFICIENT cho tới khi nạp lại.');

  // Một số node Celo trả eth_estimateGas thấp hơn EIP-7623 calldata floor →
  // "insufficient gas for floor data gas cost". Đặt limit rộng tay; gas thừa
  // không bị tính. (Giống scripts/withdraw-agent.ts.)
  const hash = await owner.writeContract({
    address: payment,
    abi: PAYMENT_ABI,
    functionName: 'withdrawReserve',
    args: [token.address, to as `0x${string}`, amount],
    gas: 200_000n,
  });

  await pub.waitForTransactionReceipt({ hash });
  console.log(`✓ Done: https://celoscan.io/tx/${hash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
