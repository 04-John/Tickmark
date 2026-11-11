// The books: a double-entry journal and a monthly spending statement, in US dollars.
//
// Each paid movement is one journal entry with two lines: the account it went to (debit) and the asset
// account it left (credit), at the USD value on the day it was paid. Amounts are whole cents, so debits
// always equal credits exactly. A movement without a trusted price still appears, with its quantity and
// no dollar lines, and is listed as needing a price.
import { CATEGORIES, paidInOrder, type Basis, type CategoryId, type Classified, type RuleId, type Section } from './classify.ts';
import { bookingTime, type DateSource } from './types.ts';

export type JournalLine = { code: string; account: string; debitCents: number; creditCents: number };

export type JournalEntry = {
  /** Stable reference: TM-<proposal>-<line>. */
  ref: string;
  /** UTC payment date, YYYY-MM-DD. */
  date: string;
  dateSource: DateSource;
  dao: string;
  proposalId: number;
  payee: string;
  /** Account the money went to on chain (differs from payee for Trezu deposit-address payments). */
  onChainTo: string;
  category: CategoryId;
  section: Section;
  token: string;
  symbol: string;
  quantity: string;
  unitPrice: number | null;
  priceDate: string | null;
  cents: number | null;
  memo: string;
  rule: RuleId;
  basis: Basis;
  evidence: string;
  approvalTx?: string;
  /** Two lines when priced, none when the token has no trusted price. */
  lines: JournalLine[];
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function journal(items: Classified[]): JournalEntry[] {
  return paidInOrder(items).map((c) => {
    const b = c.booking!;
    const cents = c.usd === null ? null : Math.round(c.usd * 100);
    return {
      ref: `TM-${c.proposalId}-${c.line}`,
      date: day(bookingTime(c)),
      dateSource: c.dateSource ?? 'submitted',
      dao: c.dao,
      proposalId: c.proposalId,
      payee: c.payee,
      onChainTo: c.to,
      category: b.category,
      section: CATEGORIES[b.category].section,
      token: c.token,
      symbol: c.symbol,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      priceDate: c.priceDate,
      cents,
      memo: c.memoText,
      rule: b.rule,
      basis: b.basis,
      evidence: b.evidence,
      approvalTx: c.approvalTx,
      lines:
        cents === null
          ? []
          : [
              { code: b.debit.code, account: b.debit.name, debitCents: cents, creditCents: 0 },
              { code: b.credit.code, account: b.credit.name, debitCents: 0, creditCents: cents },
            ],
    };
  });
}

export type StatementRow = { category: CategoryId; code: string; name: string; section: Section; byMonth: number[]; totalCents: number; count: number; unpriced: number };

export type Statement = {
  /** YYYY-MM, oldest first, every month from the first to the last payment. */
  months: string[];
  /** Spending (expense categories), then Suspense, then movements that stay on the balance sheet. */
  rows: StatementRow[];
  spendingCents: number;
  suspenseCents: number;
};

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  const [ly, lm] = last.split('-').map(Number) as [number, number];
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  return out;
}

const SECTION_ORDER: Record<Section, number> = { expense: 0, suspense: 1, balance_sheet: 2 };

/** Monthly totals by category. */
export function statement(entries: JournalEntry[]): Statement {
  const months = entries.length ? monthsBetween(entries[0]!.date.slice(0, 7), entries[entries.length - 1]!.date.slice(0, 7)) : [];
  const index = new Map(months.map((m, i) => [m, i]));
  const rows = new Map<CategoryId, StatementRow>();
  for (const e of entries) {
    const cat = CATEGORIES[e.category];
    const row = rows.get(e.category) ?? { category: e.category, code: cat.code, name: cat.name, section: cat.section, byMonth: months.map(() => 0), totalCents: 0, count: 0, unpriced: 0 };
    row.count++;
    if (e.cents === null) row.unpriced++;
    else {
      row.byMonth[index.get(e.date.slice(0, 7))!]! += e.cents;
      row.totalCents += e.cents;
    }
    rows.set(e.category, row);
  }
  const sorted = [...rows.values()].sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || b.totalCents - a.totalCents || a.code.localeCompare(b.code));
  const sum = (section: Section) => sorted.filter((r) => r.section === section).reduce((s, r) => s + r.totalCents, 0);
  return { months, rows: sorted, spendingCents: sum('expense'), suspenseCents: sum('suspense') };
}

/** Cents as a plain decimal string, "1234.50". */
export function centsToString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
