import 'dotenv/config';
import { refundThread } from '../lib/orchestrator';

async function main() {
  const [chainIdStr, to, tokenSymbol, amount, ...reasonParts] = process.argv.slice(2);
  if (!chainIdStr || !to || !tokenSymbol || !amount) {
    console.log(
      'usage: pnpm refund <chainId> <to> <cUSD|USDT|USDC> <amount> [reason]',
    );
    process.exit(1);
  }
  const reason = reasonParts.join(' ').trim() || 'manual';
  const hash = await refundThread({
    chainId: Number(chainIdStr),
    to: to as `0x${string}`,
    tokenSymbol: tokenSymbol as 'cUSD' | 'USDT' | 'USDC',
    amountHuman: amount,
    reason,
  });
  console.log('refund tx:', hash);
  console.log('reason   :', reason);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
