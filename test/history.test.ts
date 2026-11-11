import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeProposal } from '../core/decode.ts';
import { FinalError } from '../core/http.ts';
import { approvalsFromTxs, datePayments, findApprovals, TxIndex, type AccountTx, type IndexedReceipt, type IndexedTx, type TxSource } from '../core/history.ts';
import { PriceBook } from '../core/prices.ts';
import { Rpc, ViewError, type BlockClient, type ViewClient } from '../core/rpc.ts';
import { TokenBook } from '../core/tokens.ts';
import type { Movement } from '../core/types.ts';
import { valueMovements } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
/** Nanoseconds as the index sends them: a JSON number. */
const ns = (iso: string) => Date.parse(iso) * 1e6;

/** A receipt in the index's shape: `from` calls act_proposal on `to`. */
function voteReceipt(to: string, id: number, action: string, iso: string, height: number, ok = true): IndexedReceipt {
  return {
    execution_outcome: {
      block_height: height,
      block_timestamp: ns(iso),
      outcome: { status: ok ? { SuccessValue: '' } : { Failure: { ActionError: { index: 0, kind: { FunctionCallError: {} } } } } },
    },
    receipt: {
      receiver_id: to,
      predecessor_id: 'council-member.near',
      receipt: { Action: { actions: [{ FunctionCall: { method_name: 'act_proposal', args: b64({ id, action }), gas: 1, deposit: '0' } }] } },
    },
  };
}

/** Receipts that are not votes on the DAO: the relayer's refund and the payment itself. */
const noise = (height: number): IndexedReceipt[] => [
  { execution_outcome: { block_height: height, block_timestamp: 0, outcome: { status: { SuccessValue: '' } } }, receipt: { receiver_id: 'relayer.near', predecessor_id: 'system', receipt: { Action: { actions: ['Transfer'] } } } },
  { execution_outcome: { block_height: height + 1, block_timestamp: 0, outcome: { status: { SuccessValue: '' } } }, receipt: { receiver_id: 'designer.near', predecessor_id: fx.DAO, receipt: { Action: { actions: [{ Transfer: { deposit: '1' } }] } } } },
];

const tx = (hash: string, ...receipts: IndexedReceipt[]): IndexedTx => ({ transaction: { hash }, receipts });

test('the approving vote is the latest successful VoteApprove on the DAO', () => {
  const txs = [
    tx('h1', voteReceipt(fx.DAO, 7, 'VoteApprove', '2026-03-03T09:00:00Z', 100)), // first vote
    tx('h2', voteReceipt(fx.DAO, 7, 'VoteApprove', '2026-03-04T15:30:00Z', 200), ...noise(201)), // second vote approves and pays
    tx('h3', voteReceipt(fx.DAO, 7, 'VoteApprove', '2026-03-05T10:00:00Z', 300, false)), // late vote fails on chain
    tx('h4', voteReceipt(fx.DAO, 8, 'VoteReject', '2026-03-05T10:00:00Z', 310)),
    tx('h5', voteReceipt('other.sputnik-dao.near', 9, 'VoteApprove', '2026-03-05T10:00:00Z', 320)),
  ];
  const approvals = approvalsFromTxs(fx.DAO, txs);
  assert.deepEqual([...approvals.keys()], [7]);
  assert.deepEqual(approvals.get(7), { proposalId: 7, atMs: Date.parse('2026-03-04T15:30:00Z'), blockHeight: 200, txHash: 'h2' });
});

/** A fake index: pages of account rows (newest first) and the full transactions behind them. */
function fakeIndex(pages: { at: string; tx: IndexedTx }[][]): TxSource & { pagesRead: number; batchSizes: number[] } {
  const byHash = new Map(pages.flat().map((p) => [p.tx.transaction.hash, p.tx]));
  const source = {
    pagesRead: 0,
    batchSizes: [] as number[],
    async accountTxs(_account: string, resume?: string) {
      const i = resume ? Number(resume) : 0;
      source.pagesRead++;
      const txs: AccountTx[] = (pages[i] ?? []).map((p, k) => ({ transaction_hash: p.tx.transaction.hash, tx_block_height: k, tx_block_timestamp: String(ns(p.at)) }));
      return { txs, resumeToken: i + 1 < pages.length ? String(i + 1) : undefined };
    },
    async transactions(hashes: string[]) {
      source.batchSizes.push(hashes.length);
      return hashes.map((h) => byHash.get(h)!);
    },
  };
  return source;
}

test('findApprovals reads newest first and stops once every proposal is found', async () => {
  const filler = Array.from({ length: 25 }, (_, i) => ({ at: '2026-03-10T00:00:00Z', tx: tx(`f${i}`) }));
  const index = fakeIndex([
    [...filler, { at: '2026-03-09T00:00:00Z', tx: tx('a2', voteReceipt(fx.DAO, 2, 'VoteApprove', '2026-03-09T00:00:00Z', 900)) }],
    [
      { at: '2026-03-08T00:00:00Z', tx: tx('e2', voteReceipt(fx.DAO, 2, 'VoteApprove', '2026-03-08T00:00:00Z', 800)) }, // earlier vote on #2
      { at: '2026-03-07T00:00:00Z', tx: tx('a1', voteReceipt(fx.DAO, 1, 'VoteApprove', '2026-03-07T00:00:00Z', 700)) },
    ],
    [{ at: '2026-03-01T00:00:00Z', tx: tx('old') }],
  ]);
  const found = await findApprovals(index, fx.DAO, new Set([1, 2]), Date.parse('2026-01-01'));
  assert.equal(found.get(2)?.txHash, 'a2', 'the newest vote wins, not an earlier one on a later page');
  assert.equal(found.get(1)?.txHash, 'a1');
  assert.equal(index.pagesRead, 2, 'the third page is never read');
  assert.ok(index.batchSizes.every((n) => n <= 20), 'at most 20 transactions per request');
});

test('findApprovals stops at the first transaction older than the start date', async () => {
  const index = fakeIndex([[{ at: '2026-03-02T00:00:00Z', tx: tx('x') }], [{ at: '2026-01-01T00:00:00Z', tx: tx('y') }]]);
  const found = await findApprovals(index, fx.DAO, new Set([5]), Date.parse('2026-02-01'));
  assert.equal(found.size, 0);
  assert.equal(index.pagesRead, 2);
  assert.deepEqual(index.batchSizes, [1], 'the old transaction is not fetched');
});

const blocks = (times: Record<number, string>): BlockClient => ({
  async block(ref) {
    const iso = times[ref as number];
    if (!iso) throw new Error(`no block ${ref}`);
    return { height: ref as number, hash: 'h', timestampMs: Date.parse(iso) };
  },
});

test('datePayments uses the bulk line block, then the approving vote, then says it fell back', async () => {
  const [transfer] = decodeProposal(fx.DAO, fx.nativeTransfer); // #1
  const [usdc] = decodeProposal(fx.DAO, fx.usdcTransfer); // #2, no vote in the index
  const [failed] = decodeProposal(fx.DAO, fx.failedTransfer); // #10, not executed
  const bulkLine: Movement = { ...transfer!, proposalId: 6, via: 'bulk_payment', bulkPaidBlock: 555 };
  const index = fakeIndex([
    [
      { at: '2026-03-04T00:00:00Z', tx: tx('v1', voteReceipt(fx.DAO, 1, 'VoteApprove', '2026-03-04T08:00:00Z', 400)) },
      { at: '2026-03-04T00:00:00Z', tx: tx('v6', voteReceipt(fx.DAO, 6, 'VoteApprove', '2026-03-04T09:00:00Z', 450)) },
    ],
  ]);
  const { movements, report } = await datePayments([transfer!, usdc!, failed!, bulkLine], {
    dao: fx.DAO,
    sinceMs: 0,
    index,
    archival: blocks({ 555: '2026-03-06T10:00:00Z' }),
  });
  const [t, u, f, b] = movements;
  assert.deepEqual([t!.dateSource, t!.paidAt, t!.paidAtBlock, t!.approvalTx], ['approval_vote', Date.parse('2026-03-04T08:00:00Z'), 400, 'v1']);
  assert.deepEqual([u!.dateSource, u!.paidAt], ['submitted', undefined]);
  assert.match(u!.note ?? '', /submission date used/);
  assert.equal(f, failed, 'unexecuted movements are left alone');
  assert.deepEqual([b!.dateSource, b!.paidAt, b!.paidAtBlock, b!.approvalTx], ['bulk_paid_block', Date.parse('2026-03-06T10:00:00Z'), 555, 'v6']);
  assert.deepEqual(report, { approvalVotes: 1, bulkPaidBlocks: 1, submissionDates: 1, problems: [] });
});

test('datePayments survives a broken index or archival node', async () => {
  const [transfer] = decodeProposal(fx.DAO, fx.nativeTransfer);
  const bulkLine: Movement = { ...transfer!, via: 'bulk_payment', bulkPaidBlock: 9 };
  const broken: TxSource = {
    async accountTxs() {
      throw new Error('index down');
    },
    async transactions() {
      return [];
    },
  };
  const { movements, report } = await datePayments([transfer!, bulkLine], { dao: fx.DAO, sinceMs: 0, index: broken, archival: blocks({}) });
  assert.deepEqual(movements.map((m) => m.dateSource), ['submitted', 'submitted']);
  assert.equal(report.problems.length, 2);
  assert.match(report.problems.join(' | '), /index down.*no block 9/);
});

test('a payment is valued on the day it was paid, not the day it was proposed', async () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
  const prices = new PriceBook([{ asset: 'near', coingeckoId: 'near', fetchedAt: '', points: [[day('2026-03-02'), 3], [day('2026-03-05'), 5]] }]);
  const [m] = decodeProposal(fx.DAO, fx.nativeTransfer); // proposed 2026-03-02, 133 NEAR
  const noTokens: ViewClient = { view: async () => Promise.reject(new Error('unused')) };
  const [valued] = await valueMovements([{ ...m!, paidAt: Date.parse('2026-03-05T18:00:00Z') }], new TokenBook(noTokens), prices);
  assert.deepEqual([valued!.priceDate, valued!.usd], ['2026-03-05', 665]);
});

/** A fetch that answers from a list of canned responses and records what was sent. */
function fakeFetch(answers: (() => Response)[]) {
  const sent: { url: string; body: any }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next();
  }) as typeof fetch;
  return { impl, sent };
}

test('TxIndex asks for successful function calls, pages with the resume token and retries rate limits', async () => {
  const f = fakeFetch([
    () => new Response('slow down', { status: 429 }),
    () => Response.json({ account_txs: [{ transaction_hash: 'a', tx_block_height: 1, tx_block_timestamp: '1' }], resume_token: 'next' }),
  ]);
  const index = new TxIndex({ fetchImpl: f.impl, retryDelayMs: 1 });
  const page = await index.accountTxs(fx.DAO, 'r1');
  assert.deepEqual(page, { txs: [{ transaction_hash: 'a', tx_block_height: 1, tx_block_timestamp: '1' }], resumeToken: 'next' });
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[1], {
    url: 'https://tx.main.fastnear.com/v0/account',
    body: { account_id: fx.DAO, is_function_call: true, is_success: true, limit: 200, resume_token: 'r1' },
  });
});

test('TxIndex does not retry a bad request', async () => {
  const f = fakeFetch([() => new Response('{"error":"Bad request"}', { status: 400 })]);
  await assert.rejects(new TxIndex({ fetchImpl: f.impl, retryDelayMs: 1 }).transactions(['a']), FinalError);
  assert.equal(f.sent.length, 1);
  await assert.rejects(new TxIndex().transactions(Array.from({ length: 21 }, (_, i) => String(i))), /at most 20/);
});

test('Rpc reads block times, pins state to a block, and does not retry chain errors', async () => {
  const f = fakeFetch([
    () => Response.json({ result: { header: { height: 42, hash: 'H', timestamp_nanosec: '1772452800123456789' } } }),
    () => Response.json({ result: { result: [...Buffer.from('"ok"')] } }),
    () => Response.json({ error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } }),
  ]);
  const rpc = new Rpc({ fetchImpl: f.impl, retryDelayMs: 1 });
  assert.deepEqual(await rpc.block(42), { height: 42, hash: 'H', timestampMs: 1772452800123 });
  assert.equal(await rpc.at(41).view('dao.near', 'get_config'), 'ok');
  assert.equal(f.sent[1]!.body.params.block_id, 41);
  await assert.rejects(rpc.view('nobody.near', 'get_config'), ViewError);
  assert.equal(f.sent.length, 3, 'the chain error was not retried');
});
