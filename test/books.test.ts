import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centsToString, journal, statement } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import { decodeProposal } from '../core/decode.ts';
import type { Proposal } from '../core/types.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const near = (n: number) => (BigInt(n) * 10n ** 24n).toString();

/** A paid NEAR transfer on a given day, valued at $2.505 per NEAR (to exercise cent rounding). */
function paid(id: number, isoDay: string, to: string, nearAmount: number, description: string, extra: Partial<ValuedMovement> = {}): ValuedMovement {
  const p: Proposal = { ...fx.nativeTransfer, id, description, kind: { Transfer: { token_id: '', receiver_id: to, amount: near(nearAmount), msg: null } } };
  const [m] = decodeProposal(fx.DAO, p);
  const usd = Math.round(nearAmount * 2.505 * 100) / 100;
  return { ...m!, paidAt: Date.parse(`${isoDay}T15:00:00Z`), dateSource: 'approval_vote', symbol: 'NEAR', decimals: 24, quantity: String(nearAmount), unitPrice: 2.505, usd, priceDate: isoDay, ...extra };
}

const items = [
  paid(1, '2026-01-20', 'designer.near', 100, 'Invoice 7'),
  paid(2, '2026-03-05', 'cafe.near', 3, 'Team lunch catering'),
  paid(3, '2026-03-28', 'ab'.repeat(32), 1000, ''),
  paid(4, '2026-03-30', fx.DAO, 50, 'to our Intents balance'),
  paid(5, '2026-03-31', 'meme-holder.near', 9, 'Prize', { token: 'meme.near', symbol: 'MEME', usd: null, unitPrice: null, priceDate: null }),
  { ...paid(6, '2026-02-01', 'designer.near', 5, 'Invoice 8'), executed: false, status: 'Rejected' as const },
];

test('the journal: one balanced entry per paid line, in date order, in whole cents', () => {
  const entries = journal(classify(items));
  assert.deepEqual(entries.map((e) => e.ref), ['TM-1-0', 'TM-2-0', 'TM-3-0', 'TM-4-0', 'TM-5-0'], 'the rejected proposal is not booked');
  for (const e of entries) {
    const debit = e.lines.reduce((s, l) => s + l.debitCents, 0);
    const credit = e.lines.reduce((s, l) => s + l.creditCents, 0);
    assert.equal(debit, credit, `${e.ref} balances`);
  }
  const [invoice] = entries;
  assert.deepEqual(invoice!.lines, [
    { code: '6020', account: 'Contractors and services', debitCents: 25050, creditCents: 0 },
    { code: '1110', account: 'Digital assets: NEAR', debitCents: 0, creditCents: 25050 },
  ]);
  assert.deepEqual([invoice!.date, invoice!.dateSource, invoice!.payee], ['2026-01-20', 'approval_vote', 'designer.near']);
  const meme = entries.find((e) => e.ref === 'TM-5-0')!;
  assert.deepEqual([meme.cents, meme.lines, meme.quantity, meme.symbol], [null, [], '9', 'MEME'], 'no price, no dollar lines, quantity kept');
});

test('the statement: every month from first to last payment, spending apart from suspense and balance-sheet moves', () => {
  const st = statement(journal(classify(items)));
  assert.deepEqual(st.months, ['2026-01', '2026-02', '2026-03'], 'February is shown even though nothing was paid');
  assert.deepEqual(
    st.rows.map((r) => [r.category, r.section, r.byMonth, r.totalCents, r.count, r.unpriced]),
    [
      ['contractors', 'expense', [25050, 0, 0], 25050, 1, 0],
      ['marketing', 'expense', [0, 0, 752], 752, 1, 0],
      ['bounties', 'expense', [0, 0, 0], 0, 1, 1],
      ['suspense', 'suspense', [0, 0, 250500], 250500, 1, 0],
      ['internal', 'balance_sheet', [0, 0, 12525], 12525, 1, 0],
    ],
  );
  assert.equal(st.spendingCents, 25050 + 752);
  assert.equal(st.suspenseCents, 250500);
  assert.deepEqual(statement([]), { months: [], rows: [], spendingCents: 0, suspenseCents: 0 });
});

test('cents print as plain decimals', () => {
  assert.equal(centsToString(25050), '250.50');
  assert.equal(centsToString(7), '0.07');
  assert.equal(centsToString(-1999), '-19.99');
  assert.equal(centsToString(0), '0.00');
});
