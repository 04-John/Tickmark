// Who the treasury paid: one line per payee, with what kind of account it is, its role in the DAO, totals, the
// accounts its payments were placed in, and the questions about it.
import type { JournalEntry } from './books.ts';
import { isSputnikDao, sameNameAccount, type CategoryId } from './classify.ts';
import type { DaoPolicy } from './dao.ts';
import { isUnnamed, type Question } from './questions.ts';
import type { Proposal } from './types.ts';

/** named: a NEAR name; unnamed: 64-hex or 0x; dao: another Sputnik DAO; own_name: x.near for x.sputnik-dao.near. */
export type PayeeKind = 'named' | 'unnamed' | 'dao' | 'own_name';

export type Payee = {
  account: string;
  kind: PayeeKind;
  /** Roles the account holds in the DAO's policy (council members paid by the DAO they govern). */
  roles: string[];
  lines: number;
  proposals: number[];
  /** Priced total; null when no line had a price. */
  cents: number | null;
  unpriced: number;
  categories: { category: CategoryId; lines: number }[];
  first: string;
  last: string;
  /** Proposals paying this account that it voted to approve itself. */
  votedOnOwn: number[];
  /** Questions about this account. */
  questions: number;
};

/** Categories that are not payments to someone: moves within the treasury, swaps, protocol deposits. */
const NOT_A_PAYEE: Set<CategoryId> = new Set(['internal', 'swaps', 'protocols']);

export function payeeKind(dao: string, account: string): PayeeKind {
  if (isUnnamed(account)) return 'unnamed';
  if (sameNameAccount(dao, account)) return 'own_name';
  if (isSputnikDao(account)) return 'dao';
  return 'named';
}

/** Roles whose Group includes the account. */
export function rolesOf(policy: DaoPolicy | null, account: string): string[] {
  if (!policy) return [];
  return policy.roles
    .filter((r) => {
      const kind = r.kind as unknown;
      return Boolean(kind && typeof kind === 'object' && 'Group' in kind && ((kind as { Group: string[] }).Group ?? []).includes(account));
    })
    .map((r) => r.name);
}

/** Payees, largest priced total first. */
export function payeeList(dao: string, entries: JournalEntry[], proposals: Proposal[], policy: DaoPolicy | null, questions: Question[]): Payee[] {
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const map = new Map<string, Payee & { cats: Map<CategoryId, number> }>();
  for (const e of entries) {
    if (NOT_A_PAYEE.has(e.category)) continue;
    let p = map.get(e.payee);
    if (!p) {
      p = { account: e.payee, kind: payeeKind(dao, e.payee), roles: rolesOf(policy, e.payee), lines: 0, proposals: [], cents: null, unpriced: 0, categories: [], first: e.date, last: e.date, votedOnOwn: [], questions: 0, cats: new Map() };
      map.set(e.payee, p);
    }
    p.lines++;
    if (!p.proposals.includes(e.proposalId)) p.proposals.push(e.proposalId);
    if (e.cents === null) p.unpriced++;
    else p.cents = (p.cents ?? 0) + e.cents;
    p.cats.set(e.category, (p.cats.get(e.category) ?? 0) + 1);
    if (e.date < p.first) p.first = e.date;
    if (e.date > p.last) p.last = e.date;
    if (byId.get(e.proposalId)?.votes?.[e.payee] === 'Approve' && !p.votedOnOwn.includes(e.proposalId)) p.votedOnOwn.push(e.proposalId);
  }
  for (const q of questions) {
    const p = q.payee ? map.get(q.payee) : undefined;
    if (p) p.questions++;
  }
  return [...map.values()]
    .map(({ cats, ...p }) => ({ ...p, categories: [...cats].map(([category, lines]) => ({ category, lines })).sort((a, b) => b.lines - a.lines || a.category.localeCompare(b.category)) }))
    .sort((a, b) => (b.cents ?? -1) - (a.cents ?? -1) || a.account.localeCompare(b.account));
}
