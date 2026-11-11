// The pipeline every command shares: read a DAO at one block, date and value its payments, then build the books
// and their fingerprinted report. Node only (prices are read from data/prices).
import { readFileSync } from 'node:fs';
import { journal, statement } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import { fetchMovements, fetchPolicy } from '../core/dao.ts';
import { datePayments, TxIndex } from '../core/history.ts';
import { auditQuestions, sortQuestions } from '../core/questions.ts';
import { balanceQuestions, blockBefore, GENESIS_HEIGHT, holdingsOf, readHoldings, reconcile } from '../core/reconcile.ts';
import { buildReport, signReport } from '../core/report.ts';
import { ARCHIVAL_RPC, Rpc, type BlockInfo, type Network } from '../core/rpc.ts';
import { TokenBook } from '../core/tokens.ts';
import type { Proposal } from '../core/types.ts';
import { valueMovements, type ValuedMovement } from '../core/value.ts';
import { loadPriceBook } from './load.ts';

export type PipelineOptions = {
  since?: string;
  network: Network;
  skipDates: boolean;
  block?: number;
  /** Where lookup warnings go (default: stderr). */
  warn?: (message: string) => void;
};

export const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const PRICE_ASSETS = ['near', 'eth', 'btc', 'zec', 'sol', 'aurora'] as const;

export type Loaded = {
  sinceDate: string;
  asOf: BlockInfo;
  proposals: Proposal[];
  valued: ValuedMovement[];
  dating: string;
  proposalPeriodMs?: number;
  pricesThrough: Record<string, string>;
};

/**
 * Reads the DAO, dates the payments and values them. Shared by every command.
 * Every contract read is pinned to one block (the latest final block, or --block from an archival node),
 * so the same block always gives the same books.
 */
export async function load(dao: string, options: PipelineOptions): Promise<Loaded> {
  const prices = loadPriceBook();
  const sinceDate = options.since ?? prices.range('near')?.from;
  if (!sinceDate) throw new Error('No NEAR prices in data/prices; run npm run prices:update');
  const sinceMs = Date.parse(`${sinceDate}T00:00:00Z`);
  if (Number.isNaN(sinceMs)) throw new Error(`--since must be YYYY-MM-DD, got ${sinceDate}`);
  const pricesThrough = Object.fromEntries(PRICE_ASSETS.flatMap((a) => (prices.range(a) ? [[a, prices.range(a)!.to]] : [])));

  const archival = new Rpc({ network: options.network, url: ARCHIVAL_RPC[options.network] });
  const head = options.block === undefined ? new Rpc({ network: options.network }) : archival;
  const asOf = await head.block(options.block ?? 'final');
  const rpc = head.at(asOf.height);
  const { proposals, movements: decoded } = await fetchMovements(rpc, dao, sinceMs);
  let movements = decoded;
  let dating = 'submission dates (--skip-dates)';
  if (!options.skipDates) {
    const dated = await datePayments(movements, {
      dao,
      sinceMs,
      index: new TxIndex({ network: options.network }),
      archival,
    });
    movements = dated.movements;
    const r = dated.report;
    dating = `${r.approvalVotes} from the approving vote, ${r.bulkPaidBlocks} from the bulk line's paid block, ${r.submissionDates} not found (submission date used)`;
    for (const problem of r.problems.slice(0, 3)) (options.warn ?? ((m: string) => console.error(m)))(`  warning: ${problem}`);
  }
  const policy = await fetchPolicy(rpc, dao).catch(() => null);
  const proposalPeriodMs = policy ? Number(BigInt(policy.proposal_period) / 1_000_000n) : undefined;
  return { sinceDate, asOf, proposals, valued: await valueMovements(movements, new TokenBook(rpc), prices), dating, proposalPeriodMs, pricesThrough };
}

/** The opening block for a start date is the same for every DAO; find it once per run. */
const openingBlocks = new Map<string, Promise<BlockInfo>>();

/** The books, their balance check against the chain, and their signed report, from one pinned read of the chain. */
export async function makeBooks(dao: string, options: PipelineOptions) {
  const loaded = await load(dao, options);
  const classified = classify(loaded.valued);
  const entries = journal(classified);
  const st = statement(entries);

  // Balances at the last block before the first day and at the report's block.
  const archival = new Rpc({ network: options.network, url: ARCHIVAL_RPC[options.network] });
  const sinceMs = Date.parse(`${loaded.sinceDate}T00:00:00Z`);
  const openingKey = `${options.network}:${sinceMs}`;
  if (!openingBlocks.has(openingKey)) openingBlocks.set(openingKey, blockBefore(archival, sinceMs, loaded.asOf, GENESIS_HEIGHT[options.network]));
  const opening = await openingBlocks.get(openingKey)!;
  const holdings = holdingsOf(classified);
  const tokens = new Map<string, { symbol: string; decimals: number }>([['near', { symbol: 'NEAR', decimals: 24 }]]);
  for (const m of loaded.valued) tokens.set(m.token, { symbol: m.symbol, decimals: m.decimals });
  const closingReader = (options.block === undefined ? new Rpc({ network: options.network }) : archival).at(loaded.asOf.height);
  const balances = reconcile(
    classified,
    holdings,
    await readHoldings(archival.at(opening.height), dao, holdings),
    await readHoldings(closingReader, dao, holdings),
    tokens,
  );

  const asOfDate = new Date(loaded.asOf.timestampMs).toISOString().slice(0, 10);
  const questions = sortQuestions([
    ...auditQuestions(classified, loaded.proposals, { proposalPeriodMs: loaded.proposalPeriodMs, nowMs: loaded.asOf.timestampMs }),
    ...balanceQuestions(balances, loaded.sinceDate, asOfDate),
  ]);
  const report = await signReport(
    buildReport({
      tickmark: VERSION,
      dao,
      network: options.network,
      since: loaded.sinceDate,
      asOf: { block: loaded.asOf.height, time: new Date(loaded.asOf.timestampMs).toISOString() },
      opening: { block: opening.height, time: new Date(opening.timestampMs).toISOString() },
      pricesThrough: loaded.pricesThrough,
      statement: st,
      balances,
      questions,
      journal: entries,
    }),
  );
  return { ...loaded, entries, st, balances, opening, questions, report };
}
