/**
 * Rút token từ AgentWallet về deployer.
 * Chỉ owner (DEPLOYER_PRIVATE_KEY) mới gọi được.
 *
 * Usage:
 *   WITHDRAW_TOKEN=cUSD WITHDRAW_AMOUNT=5 npx hardhat run scripts/withdraw-agent.ts --network celo
 *   WITHDRAW_TOKEN=USDT WITHDRAW_AMOUNT=all npx hardhat run scripts/withdraw-agent.ts --network celo
 */

import { network } from 'hardhat';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: false });

const TOKEN_SYM = (process.env.WITHDRAW_TOKEN ?? 'cUSD') as 'cUSD' | 'USDT' | 'USDC';
const AMOUNT_IN = process.env.WITHDRAW_AMOUNT ?? 'all';

const TOKENS = {
  cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`, decimals: 18 },
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`, decimals: 6  },
  USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`, decimals: 6  },
};

function getAgentWallet(): `0x${string}` {
  const f = path.join(process.cwd(), 'deployments', 'celo.json');
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (d?.contracts?.AgentWallet) return d.contracts.AgentWallet;
  }
  return '0xe9b5e714509d7ad317e51e78ad34fa8bd4da7a97';
}

async function main() {
  const { viem } = network as any;
  const [owner] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const chainId = await pub.getChainId();
  if (chainId !== 42220) throw new Error(`Wrong network: expected Celo mainnet (42220), got ${chainId}`);

  const token = TOKENS[TOKEN_SYM];
  if (!token) throw new Error(`Unknown token: ${TOKEN_SYM}`);

  const agentAddr = getAgentWallet();
  const ownerAddr = owner.account.address;

  // Read current balance of AgentWallet
  const balance = await pub.readContract({
    address: token.address,
    abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view',
      inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
    functionName: 'balanceOf',
    args: [agentAddr],
  }) as bigint;

  const decimals = token.decimals;
  const fmt = (n: bigint) => `${(Number(n) / 10 ** decimals).toFixed(decimals === 18 ? 6 : 4)} ${TOKEN_SYM}`;

  console.log(`AgentWallet : ${agentAddr}`);
  console.log(`Owner       : ${ownerAddr}`);
  console.log(`Balance     : ${fmt(balance)}`);

  if (balance === 0n) {
    console.log('Nothing to withdraw.');
    return;
  }

  // Determine amount to withdraw
  let amount: bigint;
  if (AMOUNT_IN === 'all') {
    amount = balance;
  } else {
    const parsed = BigInt(Math.round(parseFloat(AMOUNT_IN) * 10 ** decimals));
    if (parsed > balance) throw new Error(`Requested ${fmt(parsed)} but balance is only ${fmt(balance)}`);
    amount = parsed;
  }

  console.log(`Withdrawing : ${fmt(amount)} → ${ownerAddr}`);

  const agentWalletAbi = [{
    name: 'emergencyWithdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  }] as const;

  const hash = await owner.writeContract({
    address: agentAddr,
    abi: agentWalletAbi,
    functionName: 'emergencyWithdraw',
    args: [token.address, amount, ownerAddr],
  });

  await pub.waitForTransactionReceipt({ hash });
  console.log(`✓ Done: https://celoscan.io/tx/${hash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
