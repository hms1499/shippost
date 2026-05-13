import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';

async function main() {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('refund_requests')
    .select('id, chain_id, onchain_thread_id, wallet_address, kind, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log('No pending refund requests.');
    return;
  }

  console.log(`${data.length} pending refund request(s):\n`);
  for (const r of data) {
    console.log(`#${r.id}  ${r.kind.padEnd(12)}  chain=${r.chain_id}  thread=${r.onchain_thread_id}`);
    console.log(`    wallet:  ${r.wallet_address}`);
    console.log(`    created: ${r.created_at}`);
    const hint = r.kind === 'partial'
      ? `pnpm refund:process ${r.id} --amount=<human>`
      : `pnpm refund:process ${r.id}`;
    console.log(`    → ${hint}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
