// Read a Sputnik DAO (or Trezu treasury) from the chain: proposals, policy, and Trezu bulk payment lists.
import { decodeProposal, normalizeToken } from './decode.ts';
import type { ViewClient } from './rpc.ts';
import type { Movement, Proposal } from './types.ts';
import { nsToMs } from './units.ts';

const PAGE = 100;

/** Run `fn` over `items` with at most `limit` calls in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Proposals submitted at or after `sinceMs` (all of them when omitted), oldest first.
 * Pages backwards from the newest id, so a DAO with years of history costs only the pages in range.
 */
export async function fetchProposals(rpc: ViewClient, dao: string, sinceMs = 0): Promise<Proposal[]> {
  const count = await rpc.view<number>(dao, 'get_last_proposal_id');
  const kept: Proposal[] = [];
  let hi = count;
  while (hi > 0) {
    const lo = Math.max(0, hi - PAGE);
    const page = await rpc.view<Proposal[]>(dao, 'get_proposals', { from_index: lo, limit: hi - lo });
    const inRange = page.filter((p) => nsToMs(p.submission_time) >= sinceMs);
    kept.push(...inRange);
    if (inRange.length < page.length || page.length === 0) break;
    hi = lo;
  }
  return kept.sort((a, b) => a.id - b.id);
}

export type DaoPolicy = {
  roles: { name: string; kind: unknown; permissions: string[]; vote_policy: Record<string, unknown> }[];
  default_vote_policy: unknown;
  proposal_bond: string;
  /** Nanoseconds, as a decimal string. */
  proposal_period: string;
};

export function fetchPolicy(rpc: ViewClient, dao: string): Promise<DaoPolicy> {
  return rpc.view<DaoPolicy>(dao, 'get_policy');
}

export type DaoConfig = { name: string; purpose: string; metadata: string };

export function fetchConfig(rpc: ViewClient, dao: string): Promise<DaoConfig> {
  return rpc.view<DaoConfig>(dao, 'get_config');
}

/** A stored Trezu bulk payment list (`view_list` on bulkpayment.near). */
export type BulkList = {
  token_id: string;
  submitter: string;
  status: string;
  payments: { recipient: string; amount: string; status: unknown }[];
};

export function isPaid(status: unknown): boolean {
  return typeof status === 'object' && status !== null && 'Paid' in status;
}

/** The block a bulk line was paid in, when the list records it ({ Paid: { block_height } }). */
export function paidBlock(status: unknown): number | undefined {
  if (!isPaid(status)) return undefined;
  const paid = (status as { Paid: unknown }).Paid;
  const height = typeof paid === 'object' && paid !== null ? (paid as { block_height?: unknown }).block_height : undefined;
  return typeof height === 'number' && Number.isSafeInteger(height) && height > 0 ? height : undefined;
}

/**
 * Replace each bulk payment placeholder with one movement per recipient, read from the list contract.
 * A list that can't be read stays as one line with a note, so its total is never lost.
 */
export async function expandBulkPayments(rpc: ViewClient, movements: Movement[]): Promise<Movement[]> {
  const lists = movements.filter((m) => m.via === 'bulk_payment' && m.bulkListId);
  const fetched = new Map<string, BulkList | Error>();
  await mapLimit(lists, 4, async (m) => {
    try {
      fetched.set(m.bulkListId!, await rpc.view<BulkList>(m.to, 'view_list', { list_id: m.bulkListId }));
    } catch (error) {
      fetched.set(m.bulkListId!, error as Error);
    }
  });

  const out: Movement[] = [];
  for (const m of movements) {
    if (m.via !== 'bulk_payment' || !m.bulkListId) {
      out.push(m);
      continue;
    }
    const list = fetched.get(m.bulkListId);
    if (!list || list instanceof Error) {
      out.push({ ...m, note: `bulk list ${m.bulkListId} could not be read: ${list instanceof Error ? list.message : 'missing'}` });
      continue;
    }
    const token = list.token_id === 'native' ? 'near' : normalizeToken(list.token_id);
    list.payments.forEach((payment, i) => {
      out.push({
        ...m,
        line: m.line * 1000 + i,
        token,
        to: payment.recipient,
        amount: payment.amount,
        executed: m.executed && isPaid(payment.status),
        bulkListId: undefined,
        bulkList: m.bulkListId,
        bulkPaidBlock: paidBlock(payment.status),
        note: isPaid(payment.status) ? undefined : `bulk line status: ${JSON.stringify(payment.status)}`,
      });
    });
  }
  return out;
}

/** Proposals in range, decoded into movements with bulk lists expanded. */
export async function fetchMovements(rpc: ViewClient, dao: string, sinceMs = 0): Promise<{ proposals: Proposal[]; movements: Movement[] }> {
  const proposals = await fetchProposals(rpc, dao, sinceMs);
  const decoded = proposals.flatMap((p) => decodeProposal(dao, p));
  return { proposals, movements: await expandBulkPayments(rpc, decoded) };
}
