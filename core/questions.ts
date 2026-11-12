// The questions an auditor would ask the treasurer. Each comes from a strict rule over what the chain shows,
// is phrased as a question (never an accusation), and lists the facts and proposals behind it.
import { CATEGORIES, type Classified } from './classify.ts';
import { parseDescription, trezuAction } from './describe.ts';
import { KNOWN_TOKENS } from './tokens.ts';
import { bookingTime, type Proposal } from './types.ts';

export type QuestionKind =
  | 'possible_duplicate'
  | 'memo_amount_mismatch'
  | 'balance_gap'
  | 'possibly_still_owed'
  | 'payee_voted'
  | 'large_without_description'
  | 'unnamed_payee'
  | 'unexplained';

export type Question = {
  /** Stable id: the kind plus the proposals or payee it is about. */
  id: string;
  kind: QuestionKind;
  /** The question, as the treasurer reads it. */
  ask: string;
  /** What Tickmark saw. */
  facts: string[];
  proposals: number[];
  payee?: string;
  /** Dollar amount at stake, when priced. */
  cents: number | null;
};

export type QuestionOptions = {
  /** Lines at or above this many dollars need a description (default 10,000). */
  largeUsd?: number;
  /** Same payee, token and amount within this many days is a possible duplicate (default 14). */
  duplicateDays?: number;
  /** Repeated payments below this many dollars each are not asked about (default 100). */
  minDuplicateUsd?: number;
  /** The DAO's voting period, for proposals left open past it. */
  proposalPeriodMs?: number;
  /** "Now", for proposals left open. */
  nowMs?: number;
};

const DAY = 86_400_000;
const KIND_ORDER: QuestionKind[] = ['possible_duplicate', 'memo_amount_mismatch', 'balance_gap', 'possibly_still_owed', 'payee_voted', 'large_without_description', 'unnamed_payee', 'unexplained'];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dollars = (cents: number | null) => (cents === null ? 'no price' : `$${Math.round(cents / 100).toLocaleString('en-US')}`);
const amount = (c: Classified) => `${Number(c.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${c.symbol}`;
const centsOf = (c: Classified) => (c.usd === null ? null : Math.round(c.usd * 100));
const sumCents = (items: Classified[]) => (items.every((c) => c.usd === null) ? null : items.reduce((s, c) => s + (centsOf(c) ?? 0), 0));
/** Shortens only nameless hex accounts; named accounts are shown whole. */
const short = (account: string) => (isUnnamed(account) ? `${account.slice(0, 8)}…${account.slice(-4)}` : account);

/** Implicit accounts (64 hex characters) and Ethereum-style accounts have no human name. */
export function isUnnamed(account: string): boolean {
  return /^[0-9a-f]{64}$/.test(account) || /^0x[0-9a-f]{40}$/.test(account);
}

/** Descriptions that say nothing about what a payment was for. */
const GENERIC = /^(transfer|payment|payment request|pay|send|test|funds?|withdraw(al)?|n\/a|-|\.)?$/i;
export function saysNothing(memoText: string): boolean {
  return GENERIC.test(memoText.trim()) || memoText.replace(/[^a-z]/gi, '').length < 3;
}

const STABLE = (token: string) => KNOWN_TOKENS[token]?.price === 'usd';
const SYMBOLS = 'NEAR|wNEAR|USDC|USDT|USDt|USDC\\.e|USDT\\.e|DAI|ETH|BTC|ZEC|SOL';
const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)([kKmM])?';

/** Amounts a memo states, by unit: "USD" for dollar amounts, otherwise the token symbol as written (uppercased). */
export function statedAmounts(text: string): { unit: string; value: number }[] {
  const out: { unit: string; value: number }[] = [];
  const toNumber = (n: string, suffix?: string) => Number(n.replace(/,/g, '')) * (suffix?.toLowerCase() === 'k' ? 1e3 : suffix?.toLowerCase() === 'm' ? 1e6 : 1);
  for (const m of text.matchAll(new RegExp(`(?:US\\$|\\$|\\bUSD\\s?)\\s?${NUM}(?![\\w.])`, 'g'))) out.push({ unit: 'USD', value: toNumber(m[1]!, m[2]) });
  for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${NUM}\\s?(${SYMBOLS})\\b`, 'gi'))) out.push({ unit: m[3]!.toUpperCase(), value: toNumber(m[1]!, m[2]) });
  for (const m of text.matchAll(new RegExp(`\\b(${SYMBOLS})\\s?${NUM}(?![\\w.])`, 'gi'))) out.push({ unit: m[1]!.toUpperCase(), value: toNumber(m[2]!, m[3]) });
  return out;
}

/** True when a stated amount is in the unit of what was sent: dollars for $1 stablecoins, the same symbol otherwise. */
function comparable(unit: string, c: Classified): boolean {
  if (unit === 'USD') return STABLE(c.token);
  const symbol = c.symbol.toUpperCase();
  return unit === symbol || (unit === 'NEAR' && symbol === 'WNEAR') || (unit === 'WNEAR' && symbol === 'NEAR') || (STABLE(c.token) && unit.startsWith(symbol.slice(0, 4)));
}

/** A Trezu bulk payment states its list total ("* Amount: 2700") in the list's token. */
function bulkListTotal(proposal: Proposal | undefined, line: Classified): { unit: string; value: number }[] {
  if (!proposal) return [];
  const d = parseDescription(proposal.description);
  const total = d.fields['amount'];
  if (trezuAction(d) !== 'bulk-payment' || !total || !/^[\d,]+(\.\d+)?$/.test(total)) return [];
  return [{ unit: line.symbol.toUpperCase(), value: Number(total.replace(/,/g, '')) }];
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005 * Math.max(a, b), 0.01);

/** Invoice numbers a description mentions: "Invoice 41", "inv 47", "invoice #12", "INV-0042". */
export function invoiceNumbers(text: string): string[] {
  return [...text.matchAll(/\binv(?:oice)?\.?\s*(?:no\.?|number)?\s*[#-]?\s*(\d{1,10})\b/gi)].map((m) => String(Number(m[1])));
}

/** The invoice number every line of a cluster mentions, or null. */
function sharedInvoice(lines: Classified[]): string | null {
  const [first, ...rest] = lines.map((c) => new Set(invoiceNumbers(c.memoText)));
  for (const n of first ?? []) if (rest.every((s) => s.has(n))) return n;
  return null;
}

/** "#1, #2 and #3" (the first `max`, then "and N more"). */
function ids(list: number[], max = 6): string {
  const shown = list.slice(0, max).map((i) => `#${i}`);
  const rest = list.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const groupBy = <T>(items: T[], key: (t: T) => string) => {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
};
const uniqueIds = (lines: Classified[]) => [...new Set(lines.map((c) => c.proposalId))];

export function auditQuestions(items: Classified[], proposals: Proposal[], options: QuestionOptions = {}): Question[] {
  const largeCents = (options.largeUsd ?? 10_000) * 100;
  const minDuplicateCents = (options.minDuplicateUsd ?? 100) * 100;
  const duplicateMs = (options.duplicateDays ?? 14) * DAY;
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const paid = items.filter((c) => c.booking).sort((a, b) => bookingTime(a) - bookingTime(b) || a.proposalId - b.proposalId);
  const spending = paid.filter((c) => CATEGORIES[c.booking!.category].section !== 'balance_sheet');
  const questions: Question[] = [];

  // 1. The same payee, token and amount from different proposals, each within `duplicateDays` of the previous one.
  for (const lines of groupBy(spending, (c) => `${c.payee}|${c.token}|${c.amount}`).values()) {
    let cluster: Classified[] = [];
    const flush = () => {
      const clusterIds = uniqueIds(cluster);
      const first = cluster[0];
      // The same invoice number in every description is a strong signal at any amount; otherwise small repeats are ignored.
      const invoice = first ? sharedInvoice(cluster) : null;
      if (first && clusterIds.length >= 2 && (invoice || (centsOf(first) ?? 0) >= minDuplicateCents)) {
        const days = Math.round((bookingTime(cluster[cluster.length - 1]!) - bookingTime(first)) / DAY);
        const when = days === 0 ? 'on the same day' : clusterIds.length === 2 ? `${plural(days, 'day')} apart` : `within ${plural(days, 'day')}`;
        const what = invoice ? `invoice ${invoice}` : short(first.payee);
        questions.push({
          id: `possible_duplicate:${clusterIds.join(',')}`,
          kind: 'possible_duplicate',
          ask:
            clusterIds.length === 2
              ? `Was ${what} paid twice? ${ids(clusterIds)} each sent ${amount(first)}${invoice ? ` to ${short(first.payee)}` : ''}, ${when}.`
              : `Was ${what} meant to be paid ${clusterIds.length} times? ${ids(clusterIds)} each sent ${amount(first)}${invoice ? ` to ${short(first.payee)}` : ''}, ${when}.`,
          facts: cluster.map((c) => `#${c.proposalId} paid ${amount(c)} on ${day(bookingTime(c))}: ${c.memoText || 'no description'}`),
          proposals: clusterIds,
          payee: first.payee,
          cents: sumCents(cluster.slice(1)),
        });
      }
      cluster = [];
    };
    for (const c of lines) {
      const last = cluster[cluster.length - 1];
      if (last && c.proposalId === last.proposalId) continue; // two lines of one bulk list to the same payee are not a duplicate payment
      if (last && bookingTime(c) - bookingTime(last) > duplicateMs) flush();
      cluster.push(c);
    }
    flush();
  }

  // 2. The description states an amount that differs from what the proposal sent (same unit only).
  for (const lines of groupBy(spending, (c) => `${c.proposalId}|${c.token}`).values()) {
    const first = lines[0]!;
    const stated = [...statedAmounts(first.memoText), ...bulkListTotal(byId.get(first.proposalId), first)].filter((s) => comparable(s.unit, first));
    if (!stated.length) continue;
    const sent = lines.reduce((s, c) => s + Number(c.quantity), 0);
    if (stated.some((s) => close(s.value, sent) || lines.some((c) => close(s.value, Number(c.quantity))))) continue;
    questions.push({
      id: `memo_amount_mismatch:${first.proposalId}:${first.token}`,
      kind: 'memo_amount_mismatch',
      ask: `#${first.proposalId} says ${stated.map((s) => `${s.value.toLocaleString('en-US')} ${s.unit}`).join(' / ')}, but sent ${sent.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${first.symbol}. Which is right?`,
      facts: [`description: ${first.memoText || '(Trezu fields only)'}`, ...lines.map((c) => `${amount(c)} to ${c.payee} on ${day(bookingTime(c))}`)],
      proposals: [first.proposalId],
      payee: lines.length === 1 ? first.payee : undefined,
      cents: sumCents(lines),
    });
  }

  // 3. Asked to pay someone, never paid: failed, expired, or left open past the voting period, with no later matching payment.
  //    Swaps and moves within the treasury are not debts, so they are skipped.
  const now = options.nowMs ?? Date.now();
  for (const c of items) {
    if (c.executed || CATEGORIES[c.intended].section === 'balance_sheet' || c.payee === c.dao) continue;
    const openTooLong = c.status === 'InProgress' && options.proposalPeriodMs !== undefined && now - c.proposedAt > options.proposalPeriodMs;
    if (c.status !== 'Failed' && c.status !== 'Expired' && !openTooLong && !c.bounced) continue;
    if (paid.some((p) => p.payee === c.payee && p.token === c.token && p.amount === c.amount && bookingTime(p) >= c.proposedAt)) continue;
    const what = c.bounced ? 'was approved, but the payment failed on chain and the money came back' : c.status === 'Failed' ? 'failed on chain' : c.status === 'Expired' ? 'expired without a decision' : `has been open since ${day(c.proposedAt)}, past the voting period`;
    questions.push({
      id: `possibly_still_owed:${c.proposalId}:${c.line}`,
      kind: 'possibly_still_owed',
      ask: `Is ${short(c.payee)} still owed ${amount(c)}? #${c.proposalId} ${what}, and no later payment matches.`,
      facts: [`#${c.proposalId} proposed ${day(c.proposedAt)} by ${c.proposer}: ${c.memoText || 'no description'}`, `status: ${c.status}`, `payee: ${c.payee}`],
      proposals: [c.proposalId],
      payee: c.payee,
      cents: centsOf(c),
    });
  }

  for (const [payee, lines] of groupBy(spending, (c) => c.payee)) {
    const name = short(payee);
    // 4. The payee voted to approve proposals that paid them.
    const votedFor = lines.filter((c) => byId.get(c.proposalId)?.votes?.[payee] === 'Approve');
    if (votedFor.length) {
      const vIds = uniqueIds(votedFor);
      questions.push({
        id: `payee_voted:${payee}`,
        kind: 'payee_voted',
        ask:
          vIds.length === 1
            ? `${name} voted to approve #${vIds[0]}, which paid them ${votedFor.map(amount).join(' + ')}. Did someone other than the payee review it?`
            : `${name} voted to approve ${plural(vIds.length, 'proposal')} that paid them ${dollars(sumCents(votedFor))} (${ids(vIds)}). Did someone other than the payee review them?`,
        facts: vIds.map((id) => `#${id} votes: ${Object.entries(byId.get(id)!.votes).map(([who, v]) => `${who} ${v}`).join(', ')}`),
        proposals: vIds,
        payee,
        cents: sumCents(votedFor),
      });
    }

    // 5. Large payments whose own proposal says nothing about them (even when the payee's history placed them).
    const silent = lines.filter((c) => c.booking!.category !== 'suspense' && saysNothing(c.memoText));
    const bigIds = [...groupBy(silent, (c) => String(c.proposalId))].filter(([, ls]) => (sumCents(ls) ?? 0) >= largeCents).map(([id]) => Number(id));
    if (bigIds.length) {
      const bigLines = silent.filter((c) => bigIds.includes(c.proposalId));
      const cents = sumCents(bigLines);
      const first = bigLines[0]!;
      questions.push({
        id: `large_without_description:${payee}`,
        kind: 'large_without_description',
        ask:
          bigIds.length === 1
            ? `Which invoice or agreement does #${bigIds[0]} pay? ${dollars(cents)} to ${name} on ${day(bookingTime(first))}, and the proposal does not say.`
            : `Which invoices or agreements do the ${bigIds.length} payments to ${name} without a description pay? ${dollars(cents)} in total (${ids(bigIds)}).`,
        facts: [
          `placed in ${CATEGORIES[first.booking!.category].name} because ${first.booking!.evidence}`,
          ...bigLines.slice(0, 8).map((c) => `#${c.proposalId} ${day(bookingTime(c))} ${amount(c)} (${dollars(centsOf(c))})`),
        ],
        proposals: bigIds,
        payee,
        cents,
      });
    }

    // 6. Accounts without a name.
    if (isUnnamed(payee)) {
      const pIds = uniqueIds(lines);
      questions.push({
        id: `unnamed_payee:${payee}`,
        kind: 'unnamed_payee',
        ask: `Who is ${name}? It received ${dollars(sumCents(lines))} in ${plural(lines.length, 'payment')}, and an account without a name can’t be matched to a vendor or invoice.`,
        facts: [`full account: ${payee}`, `${ids(pIds)}, ${day(bookingTime(lines[0]!))} to ${day(bookingTime(lines[lines.length - 1]!))}`],
        proposals: pIds,
        payee,
        cents: sumCents(lines),
      });
    }

    // 7. Payments nothing explains.
    const unexplained = lines.filter((c) => c.booking!.category === 'suspense');
    if (unexplained.length) {
      questions.push({
        id: `unexplained:${payee}`,
        kind: 'unexplained',
        ask: `What ${unexplained.length === 1 ? 'was the payment' : 'were the payments'} to ${name} for? ${dollars(sumCents(unexplained))} in ${plural(unexplained.length, 'payment')}.`,
        facts: unexplained.slice(0, 6).map((c) => `#${c.proposalId} ${day(bookingTime(c))} ${amount(c)}: ${c.booking!.evidence}`),
        proposals: uniqueIds(unexplained),
        payee,
        cents: sumCents(unexplained),
      });
    }
  }

  return sortQuestions(questions);
}

/** Questions in reading order: by kind, then largest amount first. */
export function sortQuestions(questions: Question[]): Question[] {
  return [...questions].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (b.cents ?? -1) - (a.cents ?? -1) || a.id.localeCompare(b.id));
}
