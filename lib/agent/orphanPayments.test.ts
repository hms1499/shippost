import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paymentMayHaveMoved, recordOrphanPayment } from './orphanPayments';

describe('paymentMayHaveMoved', () => {
  // The whole point of the table: record the ones where a user might really be
  // out of pocket, and nothing else. Getting this wrong in one direction loses
  // a paid user; in the other it invites anyone to manufacture records.
  it('records the two ambiguous rejections', () => {
    // Could not read the receipt — a lagging node looks exactly like a fake hash.
    expect(paymentMayHaveMoved('receipt-unavailable')).toBe(true);
    // Our contract emitted ThreadRequested, so money definitely moved; the body
    // just described it wrongly.
    expect(paymentMayHaveMoved('mismatch')).toBe(true);
  });

  it('records nothing when the chain proves no payment reached us', () => {
    expect(paymentMayHaveMoved('tx-reverted')).toBe(false);
    expect(paymentMayHaveMoved('no-payment-event')).toBe(false);
  });
});

function makeDb(opts: { error?: string } = {}) {
  const upserts: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
  const client = {
    from() {
      return {
        upsert(row: Record<string, unknown>, upsertOpts: unknown) {
          upserts.push({ row, opts: upsertOpts });
          return Promise.resolve({ error: opts.error ? { message: opts.error } : null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, upserts };
}

const base = {
  chainId: 42220,
  payTxHash: '0xABCDEF',
  walletAddress: '0xWALLET',
  claimedThreadId: '77',
  tokenAddress: '0xTOKEN',
  mode: 1,
  detail: 'payment tx not found on chain',
};

describe('recordOrphanPayment', () => {
  it('writes a row for an ambiguous rejection, lowercasing the identifiers', async () => {
    const db = makeDb();
    const wrote = await recordOrphanPayment(db.client, {
      ...base,
      kind: 'receipt-unavailable',
    });

    expect(wrote).toBe(true);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].row).toMatchObject({
      chain_id: 42220,
      pay_tx_hash: '0xabcdef',
      wallet_address: '0xwallet',
      token_address: '0xtoken',
      claimed_thread_id: '77',
      reason: 'receipt-unavailable',
    });
    // The column default owns the triage state; the caller must not preset it.
    expect(db.upserts[0].row).not.toHaveProperty('status');
  });

  it('keeps the first observation when the same tx is retried', async () => {
    const db = makeDb();
    await recordOrphanPayment(db.client, { ...base, kind: 'receipt-unavailable' });
    expect(db.upserts[0].opts).toMatchObject({
      onConflict: 'chain_id,pay_tx_hash',
      ignoreDuplicates: true,
    });
  });

  it('carries what the chain said when our contract was actually paid', async () => {
    const db = makeDb();
    await recordOrphanPayment(db.client, {
      ...base,
      kind: 'mismatch',
      detail: 'payer does not match the payment tx',
      observed: { threadId: '99', user: '0xREALPAYER', amountRaw: '50000' },
    });

    expect(db.upserts[0].row).toMatchObject({
      observed_thread_id: '99',
      observed_payer: '0xrealpayer',
      observed_amount_raw: '50000',
    });
  });

  it('writes nothing when the chain proves no payment reached us', async () => {
    const db = makeDb();
    expect(await recordOrphanPayment(db.client, { ...base, kind: 'tx-reverted' })).toBe(false);
    expect(await recordOrphanPayment(db.client, { ...base, kind: 'no-payment-event' })).toBe(false);
    expect(db.upserts).toHaveLength(0);
  });

  it('reports not-written when there is no database, instead of throwing', async () => {
    expect(await recordOrphanPayment(null, { ...base, kind: 'mismatch' })).toBe(false);
  });

  // This runs inside the 402 path. A failure to record must stay a clean 402 —
  // turning it into a 500 would lose the reason the user needs to read.
  it('swallows a write failure and reports not-written', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeDb({ error: 'relation does not exist' });
    expect(await recordOrphanPayment(db.client, { ...base, kind: 'mismatch' })).toBe(false);
    spy.mockRestore();
  });

  it('truncates a runaway detail rather than rejecting the row', async () => {
    const db = makeDb();
    await recordOrphanPayment(db.client, {
      ...base,
      kind: 'mismatch',
      detail: 'x'.repeat(2000),
    });
    expect((db.upserts[0].row.detail as string).length).toBe(500);
  });
});
