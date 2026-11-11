// Tickmark command line.
//   node cli/tickmark.ts scan <dao> [--since YYYY-MM-DD] [--network mainnet|testnet] [--lines] [--json out.json]
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchMovements } from '../core/dao.ts';
import { kindName } from '../core/decode.ts';
import { Rpc, type Network } from '../core/rpc.ts';
import { TokenBook } from '../core/tokens.ts';
import { valueMovements, type ValuedMovement } from '../core/value.ts';
import { loadPriceBook } from './load.ts';

const USAGE = `Usage:
  node cli/tickmark.ts scan <dao-account> [options]

Options:
  --since YYYY-MM-DD   first day to include (default: first day of the price snapshot)
  --network NAME       mainnet (default) or testnet
  --lines              print every money movement, not just the totals
  --json FILE          write the valued movements to FILE

Example:
  node cli/tickmark.ts scan marketing.sputnik-dao.near --lines`;

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s: string) => s.replace(/<br>/gi, ' ').replace(/\s+/g, ' ').trim();

async function scan(dao: string, options: { since?: string; network: Network; lines: boolean; json?: string }) {
  const prices = loadPriceBook();
  const sinceDate = options.since ?? prices.range('near')?.from;
  if (!sinceDate) throw new Error('No NEAR prices in data/prices; run npm run prices:update');
  const sinceMs = Date.parse(`${sinceDate}T00:00:00Z`);
  if (Number.isNaN(sinceMs)) throw new Error(`--since must be YYYY-MM-DD, got ${sinceDate}`);

  const rpc = new Rpc({ network: options.network });
  const { proposals, movements } = await fetchMovements(rpc, dao, sinceMs);
  const valued = await valueMovements(movements, new TokenBook(rpc), prices);
  const executed = valued.filter((m) => m.executed);

  console.log(`${dao} (${options.network}) since ${sinceDate}`);
  const kinds = new Map<string, number>();
  for (const p of proposals) kinds.set(kindName(p.kind), (kinds.get(kindName(p.kind)) ?? 0) + 1);
  console.log(`  ${proposals.length} proposals: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`  ${movements.length} money movements, ${executed.length} executed`);

  const byToken = new Map<string, { count: number; quantity: number; usd: number; unpriced: number }>();
  for (const m of executed) {
    const t = byToken.get(m.symbol) ?? { count: 0, quantity: 0, usd: 0, unpriced: 0 };
    t.count++;
    t.quantity += Number(m.quantity);
    if (m.usd === null) t.unpriced++;
    else t.usd += m.usd;
    byToken.set(m.symbol, t);
  }
  const total = executed.reduce((s, m) => s + (m.usd ?? 0), 0);
  console.log(`  Executed outflows: ${usd(total)} priced`);
  for (const [symbol, t] of [...byToken].sort((a, b) => b[1].usd - a[1].usd)) {
    const value = t.unpriced === t.count ? 'no trusted price' : usd(t.usd) + (t.unpriced ? ` (+${t.unpriced} unpriced)` : '');
    console.log(`    ${symbol.padEnd(18)} ${String(t.count).padStart(4)} lines  ${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(18)}  ${value}`);
  }
  const notes = valued.filter((m) => m.note);
  if (notes.length) console.log(`  ${notes.length} movements with notes, e.g. ${notes[0]!.note}`);

  if (options.lines) {
    console.log('\n  date        #id    status      via               amount                     usd  to / memo');
    for (const m of valued) printLine(m);
  }
  if (options.json) {
    writeFileSync(options.json, JSON.stringify({ dao, network: options.network, since: sinceDate, movements: valued }, null, 2));
    console.log(`\n  wrote ${valued.length} movements to ${options.json}`);
  }
}

function printLine(m: ValuedMovement) {
  const amount = `${Number(m.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${cut(m.symbol, 8)}`;
  const value = m.usd === null ? '—' : usd(m.usd);
  console.log(
    `  ${day(m.proposedAt)}  ${String('#' + m.proposalId).padEnd(6)} ${m.status.padEnd(11)} ${m.via.padEnd(17)} ${amount.padStart(24)} ${value.padStart(10)}  ${cut(m.to, 24)} | ${cut(oneLine(m.memo) || '(no memo)', 50)}`,
  );
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: 'string' },
    network: { type: 'string', default: 'mainnet' },
    lines: { type: 'boolean', default: false },
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command, dao] = positionals;
if (values.help || command !== 'scan' || !dao) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (values.network !== 'mainnet' && values.network !== 'testnet') {
  console.error('--network must be mainnet or testnet');
  process.exit(1);
}
await scan(dao, { since: values.since, network: values.network, lines: values.lines, json: values.json });
