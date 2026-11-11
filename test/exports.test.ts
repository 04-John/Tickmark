import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journal, statement } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import { decimal, toCsv } from '../core/csv.ts';
import { decodeProposal } from '../core/decode.ts';
import { exportBooks, type BooksInput } from '../core/exports.ts';
import { auditQuestions } from '../core/questions.ts';
import type { Proposal } from '../core/types.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

/** Splits CSV (no embedded newlines in these fixtures) into rows of cells, honouring quotes. */
function parse(csv: string): string[][] {
  return csv
    .replace(/^﻿/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
          else if (ch === '"') quoted = false;
          else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') cells.push(cur), (cur = '');
        else cur += ch;
      }
      cells.push(cur);
      return cells;
    });
}

test('CSV: quoting, CRLF, Excel BOM, and formulas from on-chain text are neutralised but numbers are not', () => {
  const csv = toCsv(['a', 'b', 'c', 'd'], [['=HYPERLINK("http://x")', 'plain, with comma', decimal('-19.99'), -5], ['@SUM(A1)', 'say "hi"', null, '-not a number']], { bom: true });
  assert.ok(csv.startsWith('﻿a,b,c,d\r\n'));
  assert.deepEqual(parse(csv).slice(1), [
    [`'=HYPERLINK("http://x")`, 'plain, with comma', '-19.99', '-5'],
    [`'@SUM(A1)`, 'say "hi"', '', `'-not a number`],
  ]);
  assert.throws(() => decimal('1e5'), /not a decimal/);
});

const near = (n: number) => (BigInt(n) * 10n ** 24n).toString();
function paid(id: number, isoDay: string, to: string, n: number, description: string, extra: Partial<ValuedMovement> = {}): ValuedMovement {
  const p: Proposal = { ...fx.nativeTransfer, id, description, kind: { Transfer: { token_id: '', receiver_id: to, amount: near(n), msg: null } } };
  const [m] = decodeProposal(fx.DAO, p);
  return { ...m!, paidAt: Date.parse(`${isoDay}T10:00:00Z`), dateSource: 'approval_vote', approvalTx: `tx${id}`, symbol: 'NEAR', decimals: 24, quantity: String(n), unitPrice: 2.5, usd: n * 2.5, priceDate: isoDay, ...extra };
}

function books(items: ValuedMovement[]): BooksInput {
  const classified = classify(items);
  const entries = journal(classified);
  return { dao: fx.DAO, network: 'mainnet', since: '2026-01-01', entries, statement: statement(entries), questions: auditQuestions(classified, []) };
}

const sample = books([
  paid(1, '2026-01-20', 'designer.near', 100, 'Invoice 7, design work'),
  paid(2, '2026-03-05', 'cafe.near', 4, '=cmd|calc — catering'),
  paid(3, '2026-03-28', 'ab'.repeat(32), 1000, ''),
  paid(4, '2026-03-30', 'artist.near', 9, 'Prize', { token: 'meme.near', symbol: 'MEME', usd: null, unitPrice: null, priceDate: null }),
]);
const file = (name: string) => exportBooks(sample).find((f) => f.name === name)!.content;

test('journal.csv: one row per paid line, unpriced lines included without dollars, formula text neutralised', () => {
  const rows = parse(file('journal.csv'));
  assert.equal(rows[0]![0], 'Date paid');
  assert.equal(rows.length, 1 + 4);
  const col = (name: string) => rows[0]!.indexOf(name);
  assert.deepEqual([rows[1]![col('Reference')], rows[1]![col('Account code')], rows[1]![col('Amount (USD)')], rows[1]![col('Approval transaction')]], ['TM-1-0', '6020', '250.00', 'https://nearblocks.io/txns/tx1']);
  assert.equal(rows[2]![col('Description')], "'=cmd|calc — catering");
  assert.deepEqual([rows[4]![col('Token')], rows[4]![col('Quantity')], rows[4]![col('Amount (USD)')]], ['MEME', '9', '']);
});

test('QuickBooks: two balancing lines per journal, US dates, unpriced lines left out', () => {
  const rows = parse(file('quickbooks-journal.csv'));
  assert.deepEqual(rows[0], ['Journal No', 'Journal Date', 'Account Name', 'Debits', 'Credits', 'Description']);
  assert.equal(rows.length, 1 + 3 * 2);
  assert.deepEqual(rows.slice(1, 3).map((r) => r.slice(0, 5)), [
    ['TM-1-0', '01/20/2026', 'Contractors and services', '250.00', ''],
    ['TM-1-0', '01/20/2026', 'Digital assets: NEAR', '', '250.00'],
  ]);
  const byJournal = new Map<string, number>();
  for (const r of rows.slice(1)) byJournal.set(r[0]!, (byJournal.get(r[0]!) ?? 0) + Math.round(Number(r[3] || 0) * 100) - Math.round(Number(r[4] || 0) * 100));
  assert.ok([...byJournal.values()].every((v) => v === 0), 'every journal balances');
});

test('Xero: signed amounts that sum to zero per journal, day-first dates, files split between journals', () => {
  const files = exportBooks(sample, { xeroRowsPerFile: 4 }).filter((f) => f.name.startsWith('xero-'));
  assert.deepEqual(files.map((f) => f.name), ['xero-manual-journal-1.csv', 'xero-manual-journal-2.csv']);
  const rows = files.flatMap((f) => parse(f.content).slice(1));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], ['TM-1-0 designer.near: Invoice 7, design work', '20/01/2026', rows[0]![2], '6020', 'Tax Exempt', '250.00']);
  assert.deepEqual(rows[1]!.slice(3), ['1110', 'Tax Exempt', '-250.00']);
  for (const f of files) assert.ok(parse(f.content).length - 1 <= 4);
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r[0]!, (sums.get(r[0]!) ?? 0) + Math.round(Number(r[5]) * 100));
  assert.ok([...sums.values()].every((v) => v === 0));
  assert.equal(parse(exportBooks(sample, { xeroTaxRate: 'No VAT' }).find((f) => f.name === 'xero-manual-journal-1.csv')!.content)[1]![4], 'No VAT');
});

test('chart of accounts lists only the accounts used; spending and questions have totals', () => {
  assert.deepEqual(parse(file('chart-of-accounts.csv')).slice(1).map((r) => [r[0], r[2], r[5]]), [
    ['1110', 'Asset', '3'],
    ['1999', 'Asset', '1'],
    ['6020', 'Expense', '1'],
    ['6050', 'Expense', '1'],
  ]);
  const spending = parse(file('monthly-spending.csv'));
  assert.deepEqual(spending[0], ['Code', 'Account', 'Section', '2026-01', '2026-02', '2026-03', 'Total (USD)', 'Lines', 'Lines without a price']);
  assert.deepEqual(spending[spending.length - 1]!.slice(1, 7), ['Total spending', 'Spending', '250.00', '0.00', '10.00', '260.00']);
  const questions = parse(file('questions.csv'));
  assert.ok(questions.some((r) => r[0] === 'unnamed payee' && r[2] === '2500.00'));
  assert.match(file('about-these-files.txt'), /1 line here\); they are in journal\.csv but not in the QuickBooks or Xero files/);
});
