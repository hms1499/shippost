import { NextResponse } from 'next/server';
import { DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';
import { computePublicStats } from '@/lib/publicAnalytics';

export const runtime = 'nodejs';
export const revalidate = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainIdParam = url.searchParams.get('chainId');
  // The fallback follows the deployment's own chain policy — a hardcoded id
  // here answered every param-less call with Celo's numbers once Base became
  // the default chain.
  const chainId = chainIdParam ? Number(chainIdParam) : DEFAULT_CHAIN_ID;

  try {
    return NextResponse.json(await computePublicStats(chainId));
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
