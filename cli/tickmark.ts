// Tickmark command line.
//   node cli/tickmark.ts scan  <dao> [options]   every money movement, valued
//   node cli/tickmark.ts books <dao> [options]   the books: categories, journal, monthly spending, suspense
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { centsToString, journal, statement, type JournalEntry } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import { fetchMovements, fetchPolicy } from '../core/dao.ts';
import { kindName } from '../core/decode.ts';
import { datePayments, TxIndex } from '../core/history.ts';
import { auditQuestions, type QuestionKind } from '../core/questions.ts';
import { ARCHIVAL_RPC, Rpc, type Network } from '../core/rpc.ts';
import { TokenBook } from '../core/tokens.ts';
import { bookingTime, type Proposal } from '../core/types.ts';
import { valueMovements, type ValuedMovement } from '../core/value.ts';
import { loadPriceBook } from './load.ts';

const USAGE = `Usage:
  node cli/tickmark.ts scan  <dao-account> [options]   list every money movement with its USD value
  node cli/tickmark.ts books <dao-account> [options]   categories, journal, monthly spending and suspense

Options:
  --since YYYY-MM-DD   first day to include (default: first day of the price snapshot)
  --network NAME       mainnet (default) or testnet
  --lines              print every line, not just the totals
  --json FILE          write everything Tickmark derived to FILE
  --skip-dates         book payments on their submission date instead of looking up when they were paid

Examples:
  node cli/tickmark.ts scan daocubator.sputnik-dao.near --lines
  node cli/tickmark.ts books daocubator.sputnik-dao.near`;

type Options = { since?: string; network: Network; lines: boolean; json?: string; skipDates: boolean };

const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s: string) => s.replace(/<br>/gi, ' ').replace(/\s+/g, ' ').trim();

/** Reads the DAO, dates the payments and values them. Shared by every command. */
async function load(dao: string, options: Options): Promise<{ sinceDate: string; proposals: Proposal[]; valued: ValuedMovement[]; dating: string; proposalPeriodMs?: number }> {
  const prices = loadPriceBook();
  const sinceDate = options.since ?? prices.range('near')?.from;
  if (!sinceDate) throw new Error('No NEAR prices in data/prices; run npm run prices:update');
  const sinceMs = Date.parse(`${sinceDate}T00:00:00Z`);
  if (Number.isNaN(sinceMs)) throw new Error(`--since must be YYYY-MM-DD, got ${sinceDate}`);

  const rpc = new Rpc({ network: options.network });
  const { proposals, movements: decoded } = await fetchMovements(rpc, dao, sinceMs);
  let movements = decoded;
  let dating = 'submission dates (--skip-dates)';
  if (!options.skipDates) {
    const dated = await datePayments(movements, {
      dao,
      sinceMs,
      index: new TxIndex({ network: options.network }),
      archival: new Rpc({ network: options.network, url: ARCHIVAL_RPC[options.network] }),
    });
    movements = dated.movements;
    const r = dated.report;
    dating = `${r.approvalVotes} from the approving vote, ${r.bulkPaidBlocks} from the bulk line's paid block, ${r.submissionDates} not found (submission date used)`;
    for (const problem of r.problems.slice(0, 3)) console.error(`  warning: ${problem}`);
  }
  const policy = await fetchPolicy(rpc, dao).catch(() => null);
  const proposalPeriodMs = policy ? Number(BigInt(policy.proposal_period) / 1_000_000n) : undefined;
  return { sinceDate, proposals, valued: await valueMovements(movements, new TokenBook(rpc), prices), dating, proposalPeriodMs };
}

async function scan(dao: string, options: Options) {
  const { sinceDate, proposals, valued, dating } = await load(dao, options);
  const executed = valued.filter((m) => m.executed);

  console.log(`${dao} (${options.network}) since ${sinceDate}`);
  const kinds = new Map<string, number>();
  for (const p of proposals) kinds.set(kindName(p.kind), (kinds.get(kindName(p.kind)) ?? 0) + 1);
  console.log(`  ${proposals.length} proposals: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`  ${valued.length} money movements, ${executed.length} executed`);
  console.log(`  Payment dates: ${dating}`);

  const byToken = new Map<string, { count: number; quantity: number; usd: number; unpriced: number }>();
  for (const m of executed) {
    const t = byToken.get(m.symbol) ?? { count: 0, quantity: 0, usd: 0, unpriced: 0 };
    t.count++;
    t.quantity += Number(m.quantity);
    if (m.usd === null) t.unpriced++;
    else t.usd += m.usd;
    byToken.set(m.symbol, t);
  }
  console.log(`  Executed movements by token (includes moves between the treasury's own balances; see "books" for spending):`);
  for (const [symbol, t] of [...byToken].sort((a, b) => b[1].usd - a[1].usd)) {
    const value = t.unpriced === t.count ? 'no trusted price' : usd(t.usd) + (t.unpriced ? ` (+${t.unpriced} unpriced)` : '');
    console.log(`    ${symbol.padEnd(18)} ${String(t.count).padStart(4)} lines  ${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(18)}  ${value}`);
  }
  const notes = valued.filter((m) => m.note);
  if (notes.length) console.log(`  ${notes.length} movements with notes, e.g. ${notes[0]!.note}`);

  if (options.lines) {
    console.log('\n  paid on     #id    status      via               amount                     usd  to / memo');
    for (const m of valued) {
      const amount = `${Number(m.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${cut(m.symbol, 8)}`;
      const flag = m.dateSource === 'submitted' ? '*' : ' ';
      console.log(
        `  ${day(bookingTime(m))}${flag} ${String('#' + m.proposalId).padEnd(6)} ${m.status.padEnd(11)} ${m.via.padEnd(17)} ${amount.padStart(24)} ${(m.usd === null ? '—' : usd(m.usd)).padStart(10)}  ${cut(m.to, 24)} | ${cut(oneLine(m.memo) || '(no memo)', 50)}`,
      );
    }
  }
  if (options.json) {
    writeFileSync(options.json, JSON.stringify({ dao, network: options.network, since: sinceDate, movements: valued }, null, 2));
    console.log(`\n  wrote ${valued.length} movements to ${options.json}`);
  }
}

async function books(dao: string, options: Options) {
  const { sinceDate, proposals, valued, dating, proposalPeriodMs } = await load(dao, options);
  const classified = classify(valued);
  const questions = auditQuestions(classified, proposals, { proposalPeriodMs });
  const entries = journal(classified);
  const st = statement(entries);
  const money = (cents: number) => usd(cents / 100).padStart(14);

  console.log(`${dao} (${options.network}) since ${sinceDate}: ${entries.length} paid lines`);
  console.log(`  Payment dates: ${dating}`);
  const section = (title: string, which: string) => {
    const rows = st.rows.filter((r) => r.section === which);
    if (!rows.length) return;
    console.log(`\n  ${title}`);
    for (const r of rows) {
      const unpriced = r.unpriced ? `  (+${r.unpriced} without a price)` : '';
      console.log(`    ${r.code}  ${r.name.padEnd(42)} ${money(r.totalCents)}  ${String(r.count).padStart(4)} lines${unpriced}`);
    }
  };
  section('Spending', 'expense');
  console.log(`          ${'Total spending'.padEnd(42)} ${money(st.spendingCents)}`);
  section('Not explained yet (the treasurer is asked about each one)', 'suspense');
  section('Not spending: the money is still the treasury’s, in another form or place', 'balance_sheet');

  const basis = new Map<string, number>();
  for (const e of entries) basis.set(e.basis, (basis.get(e.basis) ?? 0) + 1);
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(entries.length, 1))}%`;
  console.log(
    `\n  How lines were placed: chain facts ${basis.get('chain') ?? 0} (${pct(basis.get('chain') ?? 0)}), proposal words ${basis.get('memo') ?? 0} (${pct(basis.get('memo') ?? 0)}), ` +
      `payee history ${basis.get('payee_history') ?? 0} (${pct(basis.get('payee_history') ?? 0)}), not placed ${basis.get('none') ?? 0} (${pct(basis.get('none') ?? 0)})`,
  );

  const suspense = entries.filter((e) => e.section === 'suspense').sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0));
  if (suspense.length) {
    console.log(`\n  Largest lines in Suspense:`);
    for (const e of suspense.slice(0, options.lines ? suspense.length : 8)) printEntry(e);
  }
  const kinds = new Map<QuestionKind, number>();
  for (const q of questions) kinds.set(q.kind, (kinds.get(q.kind) ?? 0) + 1);
  console.log(`\n  ${questions.length} questions for the treasurer: ${[...kinds].map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ') || 'none'}`);
  for (const q of questions.slice(0, options.lines ? questions.length : 12)) {
    console.log(`    • ${q.ask}`);
    if (options.lines) for (const f of q.facts) console.log(`        ${cut(f, 150)}`);
  }
  if (options.lines) {
    console.log(`\n  Journal (${entries.length} entries):`);
    for (const e of entries) printEntry(e, true);
  }
  if (options.json) {
    writeFileSync(options.json, JSON.stringify({ dao, network: options.network, since: sinceDate, statement: st, questions, journal: entries }, null, 2));
    console.log(`\n  wrote the journal and statement to ${options.json}`);
  }
}

function printEntry(e: JournalEntry, withEvidence = false) {
  const value = e.cents === null ? `${e.quantity} ${e.symbol}` : `$${Number(centsToString(e.cents)).toLocaleString('en-US')}`;
  console.log(`    ${e.date}  #${String(e.proposalId).padEnd(5)} ${cut(value, 22).padStart(22)}  ${cut(e.payee, 28).padEnd(28)}  ${cut(e.memo || '(no memo)', 40)}`);
  if (withEvidence) console.log(`               ${e.category} ← ${cut(e.evidence, 140)}`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: 'string' },
    network: { type: 'string', default: 'mainnet' },
    lines: { type: 'boolean', default: false },
    json: { type: 'string' },
    'skip-dates': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command, dao] = positionals;
const commands = { scan, books } as const;
if (values.help || !dao || !(command && command in commands)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (values.network !== 'mainnet' && values.network !== 'testnet') {
  console.error('--network must be mainnet or testnet');
  process.exit(1);
}
await commands[command as keyof typeof commands](dao, {
  since: values.since,
  network: values.network,
  lines: values.lines,
  json: values.json,
  skipDates: values['skip-dates'],
});
