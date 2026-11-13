// Files a bookkeeper can open or import. Built in memory (no file system), so the website offers the same downloads.
//
//   journal.csv                  every paid line, with price, account, evidence and a link to the approving transaction
//   quickbooks-journal.csv       QuickBooks Online "Import journal entries" (Journal No., Journal Date, Account Name, Debits, Credits, Description)
//   xero-manual-journal-N.csv    Xero manual journal import (Narration, Date, Description, AccountCode, TaxRate, Amount), at most 300 rows per file
//   chart-of-accounts.csv        the accounts the journals use, to create before importing
//   monthly-spending.csv         spending by account and month
//   questions.csv                the questions for the treasurer
//   about-these-files.txt        what every file and column means
import { centsToString, type JournalEntry, type Statement } from './books.ts';
import { CATEGORIES } from './classify.ts';
import { decimal, toCsv, type Cell } from './csv.ts';
import type { Question } from './questions.ts';
import type { Payee } from './payees.ts';
import type { BalanceCheck } from './reconcile.ts';

/** Where people can get Tickmark to re-run it. Confirm before submitting (PLAN T6.1). */
export const REPO_URL = 'https://github.com/04-John/Tickmark';

export type ExportFile = { name: string; content: string };

export type BooksInput = {
  dao: string;
  network: string;
  /** First day included, YYYY-MM-DD. */
  since: string;
  entries: JournalEntry[];
  statement: Statement;
  questions: Question[];
  /** Balances checked against the chain, with the blocks they were read at. */
  balances?: { checks: BalanceCheck[]; openingBlock: number; openingDate: string; closingBlock: number };
  /** Who the treasury paid. */
  payees?: Payee[];
};

export type ExportOptions = {
  /** Name of the Xero tax rate for lines without tax (default "Tax Exempt"); it differs by region. */
  xeroTaxRate?: string;
  /** Date order in the QuickBooks file (default mdy, as US QuickBooks expects) and the Xero file (default dmy). */
  quickbooksDates?: 'mdy' | 'dmy';
  xeroDates?: 'mdy' | 'dmy';
  /** Rows per Xero file; journals are never split across files (default 300). */
  xeroRowsPerFile?: number;
};

const SECTION_NAMES = { expense: 'Spending', suspense: 'Not explained yet', balance_sheet: 'Not spending (stays on the balance sheet)' } as const;
const BASIS_NAMES = { chain: 'chain facts', account_name: "the payee's account name", memo: 'words in the proposal', payee_history: 'earlier payments to the same payee', none: 'not placed' } as const;
const DATE_SOURCE_NAMES = { approval_vote: 'approving vote', bulk_paid_block: 'bulk list paid block', submitted: 'submission date (payment date not found)' } as const;

const usdCell = (cents: number | null) => (cents === null ? null : decimal(centsToString(cents)));
const dated = (iso: string, order: 'mdy' | 'dmy') => {
  const [y, m, d] = iso.split('-');
  return order === 'mdy' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
};
const oneLine = (s: string, max = 200) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const txLink = (network: string, hash?: string) => (hash ? `https://${network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${hash}` : '');

/** The words that describe one journal entry in an accounting system. */
function lineDescription(e: JournalEntry): string {
  const price = e.unitPrice === null ? '' : ` @ $${e.unitPrice} (${e.priceDate})`;
  return oneLine(`#${e.proposalId} ${e.quantity} ${e.symbol}${price} to ${e.payee}${e.memo ? ` - ${e.memo}` : ''}`, 400);
}

function journalCsv(input: BooksInput): string {
  const header = [
    'Date paid', 'Reference', 'Proposal', 'Payee', 'Paid to on chain', 'Account code', 'Account', 'Paid from code', 'Paid from',
    'Token', 'Token contract', 'Quantity', 'Price (USD)', 'Price date', 'Amount (USD)', 'Description', 'Placed by', 'Why', 'Date from', 'Approval transaction',
  ];
  const rows: Cell[][] = input.entries.map((e) => {
    const [debit, credit] = e.lines.length ? [e.lines[0]!, e.lines[1]!] : [null, null];
    const cat = CATEGORIES[e.category];
    return [
      e.date, e.ref, e.proposalId, e.payee, e.onChainTo,
      debit?.code ?? cat.code, debit?.account ?? cat.name, credit?.code ?? '', credit?.account ?? '',
      e.symbol, e.token, decimal(e.quantity), e.unitPrice, e.priceDate, usdCell(e.cents),
      oneLine(e.memo, 1000), BASIS_NAMES[e.basis], e.evidence, DATE_SOURCE_NAMES[e.dateSource], txLink(input.network, e.approvalTx),
    ];
  });
  return toCsv(header, rows, { bom: true });
}

function quickbooksCsv(input: BooksInput, order: 'mdy' | 'dmy'): string {
  const rows: Cell[][] = [];
  for (const e of input.entries) {
    for (const l of e.lines) {
      rows.push([e.ref, dated(e.date, order), l.account, l.debitCents ? usdCell(l.debitCents) : null, l.creditCents ? usdCell(l.creditCents) : null, lineDescription(e)]);
    }
  }
  return toCsv(['Journal No', 'Journal Date', 'Account Name', 'Debits', 'Credits', 'Description'], rows);
}

function xeroCsvs(input: BooksInput, order: 'mdy' | 'dmy', taxRate: string, perFile: number): ExportFile[] {
  const header = ['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount'];
  const files: Cell[][][] = [[]];
  for (const e of input.entries) {
    if (!e.lines.length) continue;
    const rows: Cell[][] = e.lines.map((l) => [
      oneLine(`${e.ref} ${e.payee}${e.memo ? `: ${e.memo}` : ''}`, 300),
      dated(e.date, order),
      lineDescription(e),
      l.code,
      taxRate,
      usdCell(l.debitCents ? l.debitCents : -l.creditCents),
    ]);
    if (files[files.length - 1]!.length + rows.length > perFile) files.push([]);
    files[files.length - 1]!.push(...rows);
  }
  return files.filter((f) => f.length).map((rows, i) => ({ name: `xero-manual-journal-${i + 1}.csv`, content: toCsv(header, rows) }));
}

function chartCsv(input: BooksInput): string {
  const used = new Map<string, { name: string; lines: number }>();
  for (const e of input.entries) {
    for (const l of e.lines) {
      const a = used.get(l.code) ?? { name: l.account, lines: 0 };
      a.lines++;
      used.set(l.code, a);
    }
  }
  const expenseCodes = new Set(Object.values(CATEGORIES).filter((c) => c.section === 'expense').map((c) => c.code));
  const rows: Cell[][] = [...used].sort(([a], [b]) => a.localeCompare(b)).map(([code, a]) => {
    const expense = expenseCodes.has(code);
    return [code, a.name, expense ? 'Expense' : 'Asset', expense ? 'Expenses' : 'Other Current Assets', expense ? 'Expense' : 'Current Asset', a.lines];
  });
  return toCsv(['Code', 'Name', 'Kind', 'QuickBooks account type', 'Xero account type', 'Journal lines using it'], rows, { bom: true });
}

function spendingCsv(input: BooksInput): string {
  const st = input.statement;
  const rows: Cell[][] = st.rows.map((r) => [r.code, r.name, SECTION_NAMES[r.section], ...r.byMonth.map((c) => usdCell(c)), usdCell(r.totalCents), r.count, r.unpriced]);
  rows.push(['', 'Total spending', SECTION_NAMES.expense, ...st.months.map((_, i) => usdCell(st.rows.filter((r) => r.section === 'expense').reduce((s, r) => s + r.byMonth[i]!, 0))), usdCell(st.spendingCents), null, null]);
  return toCsv(['Code', 'Account', 'Section', ...st.months, 'Total (USD)', 'Lines', 'Lines without a price'], rows, { bom: true });
}

const BALANCE_STATUS = { ties: 'ties out', received: 'received from outside the proposals', unexplained_outflow: 'money left that no proposal explains', unreadable: 'could not be read' } as const;

function balancesCsv(b: NonNullable<BooksInput['balances']>): string {
  const num = (s: string | null) => (s === null ? null : decimal(s));
  const rows: Cell[][] = b.checks.map((c) => [c.symbol, c.token, c.location === 'intents' ? 'NEAR Intents balance' : c.location, num(c.opening), num(c.bookedOut), num(c.movedIn), num(c.otherIn), num(c.closing), BALANCE_STATUS[c.status], b.openingBlock, b.closingBlock]);
  return toCsv(['Token', 'Token contract', 'Held in', 'Opening', 'Paid out (booked)', 'Moved in from own balances', 'Other money in (derived)', 'Closing', 'Result', 'Opening block', 'Closing block'], rows, { bom: true });
}

const PAYEE_KIND = { named: 'named account', unnamed: 'no name (hex)', dao: 'another DAO', own_name: "the DAO's own name" } as const;

function payeesCsv(payees: Payee[]): string {
  const rows: Cell[][] = payees.map((p) => [
    p.account,
    PAYEE_KIND[p.kind],
    p.roles.join(' '),
    usdCell(p.cents),
    p.lines,
    p.unpriced,
    p.categories.map((c) => `${CATEGORIES[c.category].name} (${c.lines})`).join('; '),
    p.first,
    p.last,
    p.proposals.map((id) => `#${id}`).join(' '),
    p.votedOnOwn.map((id) => `#${id}`).join(' '),
    p.questions,
  ]);
  return toCsv(['Payee', 'Account kind', 'Roles in the DAO', 'Paid (USD)', 'Lines', 'Lines without a price', 'Placed in', 'First paid', 'Last paid', 'Proposals', 'Voted to approve its own payment in', 'Questions'], rows, { bom: true });
}

function questionsCsv(input: BooksInput): string {
  const rows: Cell[][] = input.questions.map((q) => [q.kind.replace(/_/g, ' '), q.ask, usdCell(q.cents), q.proposals.map((p) => `#${p}`).join(' '), q.payee ?? '', q.facts.join(' | ')]);
  return toCsv(['Kind', 'Question', 'At stake (USD)', 'Proposals', 'Payee', 'Facts'], rows, { bom: true });
}

function about(input: BooksInput, options: Required<ExportOptions>, xeroFiles: number): string {
  const unpriced = input.entries.filter((e) => e.cents === null).length;
  const last = input.entries[input.entries.length - 1]?.date ?? input.since;
  const fmt = (o: 'mdy' | 'dmy') => (o === 'mdy' ? 'MM/DD/YYYY' : 'DD/MM/YYYY');
  return `Tickmark books for ${input.dao} (${input.network})
Payments from ${input.since} to ${last}: ${input.entries.length} paid lines, ${input.questions.length} questions for the treasurer.

Where the numbers come from
- Every line is a payment a DAO proposal made on the NEAR blockchain. "Reference" (TM-<proposal>-<line>) is unique; "Proposal" is the DAO's proposal number.
- Date paid: the block of the vote that approved the proposal (the payment runs in that transaction), or for Trezu bulk payments the block in which the line was paid. "Date from" says which. The time zone is UTC.
- Amount (USD): quantity x the daily USD price for that day (CoinGecko daily price). Dollar stablecoins are valued at $1. Tokens Tickmark cannot price by their exact contract have no USD amount (${unpriced} line${unpriced === 1 ? '' : 's'} here); they are in journal.csv but not in the QuickBooks or Xero files, and need a price before import.
- Account: where each payment was placed, and "Why". "Placed by" says whether that came from chain facts, words in the proposal, or earlier payments to the same payee. Suspense (1999) holds what nothing explains yet; questions.csv asks about each.
- Moves that are not spending (swaps, wrapping NEAR, staking, money moved between the treasury's own balances) are booked between asset accounts and are not in the spending totals.

Files
- journal.csv: one row per paid line, everything above, with a link to the approving transaction on nearblocks.io.
- chart-of-accounts.csv: the accounts the journals use. Create them first. In QuickBooks, "Digital assets: NEAR" means parent account "Digital assets" with sub-account "NEAR".
- quickbooks-journal.csv: QuickBooks Online > Settings > Import data > Journal entries. Turn account numbers off first, as QuickBooks asks. Dates are ${fmt(options.quickbooksDates)}. Each journal has two lines (debit and credit) that balance.
- xero-manual-journal-1.csv${xeroFiles > 1 ? ` to -${xeroFiles}.csv` : ''}: Xero > Accounting > Manual journals > Import. Amount is positive for debits and negative for credits; each journal balances to zero. Dates are ${fmt(options.xeroDates)}. Tax rate: "${options.xeroTaxRate}" (use your organization's no-tax rate name if it differs). At most ${options.xeroRowsPerFile} rows per file.
- monthly-spending.csv: spending by account and month, then what is not explained yet, then moves that are not spending.
- questions.csv: the questions for the treasurer, largest first within each kind, with the facts behind each.${
    input.payees
      ? `
- payees.csv: every account the treasury paid (moves within the treasury and swaps left out): what kind of account it is, its roles in the DAO, total, accounts its payments were placed in, first and last payment, proposals, the proposals it voted to approve itself, and how many questions are about it.`
      : ''
  }${
    input.balances
      ? `
- balance-check.csv: for each token and place: opening balance (read from the chain at block ${input.balances.openingBlock}, the last block before ${input.balances.openingDate}) - paid out (from these books) + moved in from the treasury's own balances + other money in = closing balance (read at block ${input.balances.closingBlock}). "Other money in" is derived: income, donations or swap proceeds. If it is negative, money left in a way no proposal explains, and questions.csv asks about it.`
      : ''
  }

Check any line yourself: open the approval transaction link, or run Tickmark again (${REPO_URL}).
`;
}

export function exportBooks(input: BooksInput, options: ExportOptions = {}): ExportFile[] {
  const opts: Required<ExportOptions> = {
    xeroTaxRate: options.xeroTaxRate ?? 'Tax Exempt',
    quickbooksDates: options.quickbooksDates ?? 'mdy',
    xeroDates: options.xeroDates ?? 'dmy',
    xeroRowsPerFile: options.xeroRowsPerFile ?? 300,
  };
  const xero = xeroCsvs(input, opts.xeroDates, opts.xeroTaxRate, opts.xeroRowsPerFile);
  return [
    { name: 'journal.csv', content: journalCsv(input) },
    { name: 'chart-of-accounts.csv', content: chartCsv(input) },
    { name: 'quickbooks-journal.csv', content: quickbooksCsv(input, opts.quickbooksDates) },
    ...xero,
    { name: 'monthly-spending.csv', content: spendingCsv(input) },
    { name: 'questions.csv', content: questionsCsv(input) },
    ...(input.balances ? [{ name: 'balance-check.csv', content: balancesCsv(input.balances) }] : []),
    ...(input.payees ? [{ name: 'payees.csv', content: payeesCsv(input.payees) }] : []),
    { name: 'about-these-files.txt', content: about(input, opts, xero.length) },
  ];
}
