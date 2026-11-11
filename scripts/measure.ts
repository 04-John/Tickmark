// Measures many DAOs with the same pipeline as `books` (each read at its own block) and adds them up.
//   node scripts/measure.ts <daos.txt> [--summary FILE] [--out FILE] [--since YYYY-MM-DD] [--concurrency N]
//   --summary: totals plus each DAO's block and fingerprint (no per-DAO dollars); --out: everything
//
// Definitions (USD, priced lines only):
//   paid out      spending + Suspense: money that left the treasury for someone else. Swaps, wrapping, staking,
//                 moves between the treasury's own balances, protocol deposits, exchange deposits and transfers to
//                 the organization's other wallets are not paid out.
//   unexplained   the Suspense part of paid out: nothing in the proposal, the chain or the payee's history says what it was for.
//   undescribed   paid out whose own proposal says nothing (empty, "transfer", "payment request"...), however it was placed.
// DAOs whose names say they are tests (test, qa, staging, demo...) are measured but left out of the totals, and listed.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CATEGORIES } from '../core/classify.ts';
import { mapLimit } from '../core/dao.ts';
import { saysNothing } from '../core/questions.ts';
import { makeBooks, VERSION } from '../cli/pipeline.ts';

const TEST_NAME = /test|qa|staging|stg-|demo|sandbox|playground|trial|-dev\b|dev\.|example/i;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, summary: { type: 'string' }, since: { type: 'string' }, concurrency: { type: 'string', default: '2' } },
});

const DEFINITIONS = {
  paidOut: 'spending + Suspense, in USD: money that left the treasury for someone else (not swaps, wrapping, staking, moves between own balances, protocol or exchange deposits, own wallets, loans)',
  unexplained: 'the Suspense part of paid out: nothing in the proposal, the chain or the payee history says what it was for',
  undescribed: 'paid out whose own proposal says nothing (empty, "transfer", "payment request"...), however it was placed',
  testDaos: `left out of the totals when the name matches ${String(/test|qa|staging|stg-|demo|sandbox|playground|trial|-dev\b|dev\.|example/i)}`,
};
if (!positionals[0]) {
  console.log('Usage: node scripts/measure.ts <daos.txt> [--summary FILE] [--out FILE] [--since YYYY-MM-DD] [--concurrency N]');
  process.exit(1);
}
const daos = readFileSync(positionals[0], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));

type DaoResult = {
  dao: string;
  test: boolean;
  error?: string;
  block?: number;
  fingerprint?: string;
  lines?: number;
  paidOutCents?: number;
  unexplainedCents?: number;
  undescribedCents?: number;
  notSpendingCents?: number;
  unpricedLines?: number;
  questions?: number;
};

let done = 0;
const measureOne = async (dao: string): Promise<DaoResult> => {
  const test = TEST_NAME.test(dao.split('.')[0]!);
  try {
    const { report, entries } = await makeBooks(dao, { network: 'mainnet', since: values.since, skipDates: false, warn: () => {} });
    let paidOut = 0;
    let unexplained = 0;
    let undescribed = 0;
    let notSpending = 0;
    for (const e of entries) {
      if (e.cents === null) continue;
      if (CATEGORIES[e.category].section === 'balance_sheet') {
        notSpending += e.cents;
        continue;
      }
      paidOut += e.cents;
      if (e.section === 'suspense') unexplained += e.cents;
      if (saysNothing(e.memo)) undescribed += e.cents;
    }
    return {
      dao,
      test,
      block: report.asOf.block,
      fingerprint: report.fingerprint,
      lines: entries.length,
      paidOutCents: paidOut,
      unexplainedCents: unexplained,
      undescribedCents: undescribed,
      notSpendingCents: notSpending,
      unpricedLines: report.totals.unpricedLines,
      questions: report.totals.questions,
    };
  } catch (error) {
    return { dao, test, error: (error as Error).message };
  }
};

const results = await mapLimit(daos, Number(values.concurrency), async (dao) => {
  const r = await measureOne(dao);
  done++;
  if (done % 10 === 0 || done === daos.length) console.error(`  ${done}/${daos.length} DAOs read`);
  return r;
});
// Public endpoints drop connections now and then: retry each failure once, one at a time.
for (let i = 0; i < results.length; i++) {
  if (!results[i]!.error) continue;
  console.error(`  retrying ${results[i]!.dao}`);
  results[i] = await measureOne(results[i]!.dao);
}

const counted = results.filter((r) => !r.test && !r.error);
const sum = (key: keyof DaoResult) => counted.reduce((s, r) => s + ((r[key] as number | undefined) ?? 0), 0);
const paidOut = sum('paidOutCents');
const totals = {
  daosListed: daos.length,
  daosCounted: counted.length,
  daosWithPayments: counted.filter((r) => (r.paidOutCents ?? 0) > 0).length,
  testDaosLeftOut: results.filter((r) => r.test).map((r) => r.dao),
  failed: results.filter((r) => r.error).map((r) => ({ dao: r.dao, error: r.error })),
  lines: sum('lines'),
  paidOutUsd: Math.round(paidOut / 100),
  unexplainedUsd: Math.round(sum('unexplainedCents') / 100),
  unexplainedShare: paidOut ? sum('unexplainedCents') / paidOut : 0,
  undescribedUsd: Math.round(sum('undescribedCents') / 100),
  undescribedShare: paidOut ? sum('undescribedCents') / paidOut : 0,
  notSpendingUsd: Math.round(sum('notSpendingCents') / 100),
  unpricedLines: sum('unpricedLines'),
  questions: sum('questions'),
};

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(`Measured ${totals.daosCounted} DAOs (${totals.testDaosLeftOut.length} test DAOs left out, ${totals.failed.length} failed), ${totals.lines} paid lines`);
console.log(`  paid out:     $${totals.paidOutUsd.toLocaleString('en-US')} from ${totals.daosWithPayments} DAOs`);
console.log(`  unexplained:  $${totals.unexplainedUsd.toLocaleString('en-US')} (${pct(totals.unexplainedShare)})`);
console.log(`  undescribed:  $${totals.undescribedUsd.toLocaleString('en-US')} (${pct(totals.undescribedShare)})`);
console.log(`  not spending: $${totals.notSpendingUsd.toLocaleString('en-US')} (swaps, internal moves, protocol and exchange deposits, own wallets)`);
console.log(`  ${totals.questions} questions; ${totals.unpricedLines} lines without a trusted price are not in the dollar totals`);
for (const f of totals.failed) console.log(`  failed: ${f.dao}: ${f.error}`);

if (values.summary) {
  // Totals, plus each DAO's block and fingerprint so any one can be rebuilt; no per-DAO dollar figures.
  const daosOut = results.map((r) => ({ dao: r.dao, test: r.test, block: r.block ?? null, fingerprint: r.fingerprint ?? null, lines: r.lines ?? null, error: r.error ?? null }));
  writeFileSync(values.summary, JSON.stringify({ tickmark: VERSION, measuredAt: new Date().toISOString(), since: values.since ?? null, definitions: DEFINITIONS, totals, daos: daosOut }, null, 2) + '\n');
  console.log(`wrote ${values.summary}`);
}
if (values.out) {
  writeFileSync(values.out, JSON.stringify({ tickmark: VERSION, measuredAt: new Date().toISOString(), since: values.since ?? null, totals, daos: results }, null, 2) + '\n');
  console.log(`wrote ${values.out}`);
}
