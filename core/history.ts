// When each payment actually went out.
//
// A Sputnik proposal records only when it was submitted. The payment runs in the transaction whose vote approved it,
// so Tickmark finds that vote in FastNear's free transaction index (https://tx.main.fastnear.com). Trezu bulk payment
// lines record their own "paid in block N"; that block's time comes from an archival RPC node.
// When neither is found the submission date is kept, and the movement says so.
import { mapLimit } from './dao.ts';
import { FinalError, throttled, throwIfRetryable, withRetries } from './http.ts';
import type { BlockClient, Network } from './rpc.ts';
import type { Movement } from './types.ts';
import { parseBase64Json } from './units.ts';

export const DEFAULT_TX_INDEX: Record<Network, string> = {
  mainnet: 'https://tx.main.fastnear.com',
  testnet: 'https://tx.test.fastnear.com',
};

/** One row of the index's per-account list. */
export type AccountTx = { transaction_hash: string; tx_block_height: number; tx_block_timestamp: string };

/** A receipt as the index returns it (only the fields Tickmark reads). */
export type IndexedReceipt = {
  execution_outcome: { block_height: number; block_timestamp: number | string; outcome: { status: Record<string, unknown> | string } };
  receipt: { receiver_id: string; predecessor_id: string; receipt: { Action?: { actions: unknown[] } } };
};

export type IndexedTx = { transaction: { hash: string }; receipts: IndexedReceipt[] };

export interface TxSource {
  /** One page of function-call transactions touching `account`, newest first. Failed ones too: a vote that went through can sit in a transaction whose payment receipt failed. */
  accountTxs(account: string, resumeToken?: string): Promise<{ txs: AccountTx[]; resumeToken?: string }>;
  /** Full transactions with their receipts; at most 20 hashes per call. */
  transactions(hashes: string[]): Promise<IndexedTx[]>;
}

export type TxIndexOptions = { network?: Network; url?: string; attempts?: number; retryDelayMs?: number; fetchImpl?: typeof fetch };

/** FastNear's transaction index. Free, no key, allows browser requests. */
export class TxIndex implements TxSource {
  static readonly BATCH = 20;
  readonly url: string;
  private readonly options: TxIndexOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TxIndexOptions = {}) {
    this.options = options;
    this.url = options.url ?? DEFAULT_TX_INDEX[options.network ?? 'mainnet'];
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return withRetries(
      `${this.url}${path}`,
      this.options.attempts ?? 6,
      () =>
        throttled(this.url, async () => {
          const res = await this.fetchImpl(`${this.url}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          throwIfRetryable(res);
          if (!res.ok) throw new FinalError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          return (await res.json()) as T;
        }),
      (error) => error instanceof FinalError,
      this.options.retryDelayMs,
    );
  }

  async accountTxs(account: string, resumeToken?: string) {
    const page = await this.post<{ account_txs?: AccountTx[]; resume_token?: string }>('/v0/account', {
      account_id: account,
      is_function_call: true,
      limit: 200,
      ...(resumeToken ? { resume_token: resumeToken } : {}),
    });
    return { txs: page.account_txs ?? [], resumeToken: page.resume_token ?? undefined };
  }

  async transactions(hashes: string[]) {
    if (hashes.length > TxIndex.BATCH) throw new Error(`at most ${TxIndex.BATCH} transactions per call`);
    const out = await this.post<{ transactions?: IndexedTx[] }>('/v0/transactions', { tx_hashes: hashes });
    return out.transactions ?? [];
  }
}

export type Approval = {
  proposalId: number;
  atMs: number;
  blockHeight: number;
  txHash: string;
  /** Accounts the DAO paid in that transaction whose receipt failed (the money came back). */
  failedReceivers: string[];
};

const succeeded = (status: IndexedReceipt['execution_outcome']['outcome']['status']) =>
  typeof status === 'object' && status !== null && ('SuccessValue' in status || 'SuccessReceiptId' in status);

/**
 * Accounts the DAO sent a receipt to in this transaction that failed: a transfer to an account that doesn't exist,
 * an ft_transfer the token contract refused. Sputnik can still mark such a proposal Approved, but the money came back.
 */
function failedOutgoing(dao: string, tx: IndexedTx): string[] {
  const out = new Set<string>();
  for (const r of tx.receipts ?? []) {
    const status = r.execution_outcome?.outcome?.status;
    if (r.receipt?.predecessor_id === dao && typeof status === 'object' && status !== null && 'Failure' in status) out.add(r.receipt.receiver_id);
  }
  return [...out];
}

/**
 * Successful `act_proposal` VoteApprove receipts executed by the DAO, latest per proposal.
 * Votes after a proposal is decided fail on chain, so the latest successful approve vote is the one that approved it.
 * Works the same for votes sent directly and for sponsored (meta-transaction) votes, because both reach the DAO as a receipt.
 */
export function approvalsFromTxs(dao: string, txs: IndexedTx[]): Map<number, Approval> {
  const out = new Map<number, Approval>();
  for (const tx of txs) {
    for (const r of tx.receipts ?? []) {
      if (r.receipt?.receiver_id !== dao || !succeeded(r.execution_outcome?.outcome?.status)) continue;
      for (const action of r.receipt.receipt?.Action?.actions ?? []) {
        const call = (action as { FunctionCall?: { method_name?: string; args?: string } } | null)?.FunctionCall;
        if (call?.method_name !== 'act_proposal' || typeof call.args !== 'string') continue;
        const args = parseBase64Json(call.args) as { id?: unknown; action?: unknown } | null;
        if (!args || args.action !== 'VoteApprove' || typeof args.id !== 'number') continue;
        const blockHeight = r.execution_outcome.block_height;
        const prev = out.get(args.id);
        if (prev && prev.blockHeight >= blockHeight) continue;
        out.set(args.id, {
          proposalId: args.id,
          // The index sends nanoseconds as a JSON number; ms precision survives the float conversion.
          atMs: Math.floor(Number(r.execution_outcome.block_timestamp) / 1e6),
          blockHeight,
          txHash: tx.transaction.hash,
          failedReceivers: failedOutgoing(dao, tx),
        });
      }
    }
  }
  return out;
}

/**
 * The approving vote of each proposal in `ids`, read newest first from the index.
 * Stops when every id is found or the transactions are older than `sinceMs`.
 */
export async function findApprovals(source: TxSource, dao: string, ids: Set<number>, sinceMs: number): Promise<Map<number, Approval>> {
  const found = new Map<number, Approval>();
  let resume: string | undefined;
  do {
    const page = await source.accountTxs(dao, resume);
    resume = page.resumeToken;
    const inRange = page.txs.filter((t) => Number(BigInt(t.tx_block_timestamp) / 1_000_000n) >= sinceMs);
    const batches: string[][] = [];
    for (let i = 0; i < inRange.length; i += TxIndex.BATCH) batches.push(inRange.slice(i, i + TxIndex.BATCH).map((t) => t.transaction_hash));
    const fetched = (await mapLimit(batches, 3, (hashes) => source.transactions(hashes))).flat();
    // Pages run newest to oldest, so an id already found has its approving vote; older pages only hold earlier votes.
    for (const [id, approval] of approvalsFromTxs(dao, fetched)) if (ids.has(id) && !found.has(id)) found.set(id, approval);
    if (inRange.length < page.txs.length || page.txs.length === 0) break;
  } while (resume && found.size < ids.size);
  return found;
}

export type DatingReport = { approvalVotes: number; bulkPaidBlocks: number; submissionDates: number; bounced: number; problems: string[] };

/**
 * Sets paidAt on every executed movement: the bulk line's paid block if it has one, else the approving vote.
 * Never throws for lookup trouble: the movement keeps its submission date and a note, and the report lists the problem.
 */
export async function datePayments(
  movements: Movement[],
  deps: { dao: string; sinceMs: number; index?: TxSource; archival?: BlockClient },
): Promise<{ movements: Movement[]; report: DatingReport }> {
  const report: DatingReport = { approvalVotes: 0, bulkPaidBlocks: 0, submissionDates: 0, bounced: 0, problems: [] };
  const executed = movements.filter((m) => m.executed);

  let approvals = new Map<number, Approval>();
  if (deps.index && executed.length) {
    try {
      approvals = await findApprovals(deps.index, deps.dao, new Set(executed.map((m) => m.proposalId)), deps.sinceMs);
    } catch (error) {
      report.problems.push(`transaction index: ${(error as Error).message}`);
    }
  }

  const blockTimes = new Map<number, number>();
  const heights = [...new Set(executed.flatMap((m) => (m.bulkPaidBlock ? [m.bulkPaidBlock] : [])))];
  if (deps.archival && heights.length) {
    const archival = deps.archival;
    await mapLimit(heights, 4, async (h) => {
      try {
        blockTimes.set(h, (await archival.block(h)).timestampMs);
      } catch (error) {
        report.problems.push(`block ${h}: ${(error as Error).message}`);
      }
    });
  }

  const dated = movements.map((m): Movement => {
    if (!m.executed) return m;
    const approval = approvals.get(m.proposalId);
    const approvalFields = approval ? { approvalTx: approval.txHash } : {};
    const lineTime = m.bulkPaidBlock ? blockTimes.get(m.bulkPaidBlock) : undefined;
    if (lineTime !== undefined) {
      report.bulkPaidBlocks++;
      return { ...m, ...approvalFields, paidAt: lineTime, paidAtBlock: m.bulkPaidBlock, dateSource: 'bulk_paid_block' };
    }
    if (approval) {
      report.approvalVotes++;
      const failedTo = approval.failedReceivers;
      const sentVia = m.token === 'near' ? m.to : m.via === 'intents_transfer' || m.via === 'intents_withdraw' ? 'intents.near' : m.token;
      if (m.via !== 'bulk_payment' && (failedTo.includes(m.to) || failedTo.includes(sentVia))) {
        report.bounced++;
        const note = 'approved, but the payment failed on chain and the money came back to the treasury';
        return { ...m, ...approvalFields, executed: false, bounced: true, paidAt: approval.atMs, paidAtBlock: approval.blockHeight, dateSource: 'approval_vote', note: m.note ? `${m.note}; ${note}` : note };
      }
      return { ...m, ...approvalFields, paidAt: approval.atMs, paidAtBlock: approval.blockHeight, dateSource: 'approval_vote' };
    }
    report.submissionDates++;
    const note = 'payment date not found; submission date used';
    return { ...m, dateSource: 'submitted', note: m.note ? `${m.note}; ${note}` : note };
  });
  return { movements: dated, report };
}
