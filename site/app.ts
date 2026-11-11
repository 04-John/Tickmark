// Tickmark in the browser: the same core code as the command line, reading public NEAR endpoints directly.
// All text that comes from the chain (memos, account names) is inserted as text nodes, never as HTML.
import { centsToString, type JournalEntry } from '../core/books.ts';
import { CATEGORIES, type CategoryId } from '../core/classify.ts';
import { closingProposal, findClosings, mayPropose, nearCliCommand } from '../core/closing.ts';
import { fetchPolicy, fetchProposals, type DaoPolicy } from '../core/dao.ts';
import { exportBooks } from '../core/exports.ts';
import { setMaxInFlightPerHost } from '../core/http.ts';
import { makeBooks, type PipelineDeps } from '../core/pipeline.ts';
import { PriceBook, type PriceSeries } from '../core/prices.ts';
import type { Question } from '../core/questions.ts';
import type { BalanceCheck } from '../core/reconcile.ts';
import { fingerprintOf, firstDifference, type SignedReport } from '../core/report.ts';
import { Rpc, type Network } from '../core/rpc.ts';

type Child = Node | string | number | null | undefined | false;

/** Builds an element. Strings become text nodes, so nothing here can inject HTML. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const usd = (cents: number | null) => (cents === null ? '—' : `${cents < 0 ? '-' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`);
const exactUsd = (cents: number | null) => (cents === null ? '—' : `$${Number(centsToString(cents)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
const qty = (s: string | null) => (s === null ? '?' : Number(s).toLocaleString('en-US', { maximumFractionDigits: 4 }));
const shortHex = (a: string) => (/^[0-9a-f]{64}$/.test(a) ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

// ---------------------------------------------------------------- data the page needs once

let depsPromise: Promise<PipelineDeps> | undefined;
function deps(): Promise<PipelineDeps> {
  depsPromise ??= (async () => {
    const assets = ['near', 'eth', 'btc', 'zec', 'sol', 'aurora'];
    const series = await Promise.all(
      assets.map(async (a) => {
        const res = await fetch(`prices/${a}.json`);
        return res.ok ? ((await res.json()) as PriceSeries) : null;
      }),
    );
    const version = (await fetch('version.json').then((r) => (r.ok ? r.json() : { version: 'dev' }))) as { version: string };
    return { prices: new PriceBook(series.filter((s): s is PriceSeries => s !== null)), version: version.version };
  })();
  return depsPromise;
}

// ---------------------------------------------------------------- building the books

type Books = Awaited<ReturnType<typeof makeBooks>>;

async function run(dao: string, network: Network, since?: string) {
  const go = $<HTMLButtonElement>('go');
  const progress = $('progress');
  const error = $('error');
  const results = $('results');
  go.disabled = true;
  error.hidden = true;
  results.hidden = true;
  progress.hidden = false;
  progress.replaceChildren();
  const step = (text: string) => progress.append(el('div', {}, text));
  const started = Date.now();
  try {
    step(`reading ${dao} on ${network}`);
    const books = await makeBooks(dao, { network, since: since || undefined, skipDates: false, onProgress: step, warn: (m) => step(m.trim()) }, await deps());
    step(`done in ${Math.round((Date.now() - started) / 1000)} s`);
    const policy = await fetchPolicy(new Rpc({ network }), dao).catch(() => null);
    render(books, network, policy);
    results.hidden = false;
    progress.hidden = true;
    history.replaceState(null, '', `?dao=${encodeURIComponent(dao)}${network === 'testnet' ? '&network=testnet' : ''}${since ? `&since=${since}` : ''}`);
  } catch (e) {
    error.textContent = `Could not build the books: ${(e as Error).message}`;
    error.hidden = false;
  } finally {
    go.disabled = false;
  }
}

function render(b: Books, network: Network, policy: DaoPolicy | null) {
  const { report } = b;
  const ties = b.balances.filter((x) => x.status === 'ties').length;
  const gaps = b.balances.filter((x) => x.status === 'unexplained_outflow').length;
  const paidOut = report.totals.spendingCents + report.totals.suspenseCents;
  const results = $('results');
  results.replaceChildren(
    el(
      'section',
      { class: 'panel' },
      el('div', { class: 'title-row' }, el('h2', {}, report.dao), el('span', { class: 'meta' }, `${network} · ${report.since} to ${report.asOf.time.slice(0, 10)} · as of block ${report.asOf.block.toLocaleString('en-US')}`)),
      el('p', { class: 'meta' }, `Payment dates: ${b.dating}.`),
      el(
        'div',
        { class: 'figures' },
        figure('Paid lines', String(report.totals.lines), `${report.totals.unpricedLines} without a trusted price`),
        figure('Spending', usd(report.totals.spendingCents), 'placed in an expense account'),
        figure('Not explained yet', usd(report.totals.suspenseCents), paidOut ? `${Math.round((100 * report.totals.suspenseCents) / paidOut)}% of what was paid out` : '', 'pencil'),
        figure('Balances vs chain', gaps ? `${gaps} gap${gaps === 1 ? '' : 's'}` : `${ties}/${b.balances.length} tie out`, gaps ? 'money left that no proposal explains' : 'opening − paid out + in = closing', gaps ? 'pencil' : 'ok'),
        figure('Questions', String(b.questions.length), 'for the treasurer'),
        figure('Report sha256', `${report.fingerprint.slice(0, 12)}…`, 'rebuild it with “Check a report”'),
      ),
    ),
    spendingPanel(b),
    balancesPanel(b.balances, b),
    questionsPanel(b.questions),
    journalPanel(b.entries, network),
    downloadsPanel(b, network),
    closePanel(report, policy, network),
  );
}

function figure(label: string, value: string, note: string, tone?: 'pencil' | 'ok') {
  return el('div', { class: `figure ${tone ?? ''}` }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), note ? el('div', { class: 'note' }, note) : null);
}

function spendingPanel(b: Books) {
  const st = b.st;
  const head = el('tr', {}, el('th', {}, 'Account'), ...st.months.map((m) => el('th', { class: 'num' }, m)), el('th', { class: 'num' }, 'Total'));
  const rows: HTMLElement[] = [];
  const sections: [string, string][] = [
    ['expense', 'Spending'],
    ['suspense', 'Not explained yet'],
    ['balance_sheet', 'Not spending: still the treasury’s, in another form or place'],
  ];
  for (const [section, title] of sections) {
    const list = st.rows.filter((r) => r.section === section);
    if (!list.length) continue;
    rows.push(el('tr', { class: 'section' }, el('td', { colspan: String(st.months.length + 2) }, title)));
    for (const r of list) {
      rows.push(
        el(
          'tr',
          {},
          el('td', {}, `${r.code} ${r.name}`, r.unpriced ? el('span', { class: 'meta' }, ` (+${r.unpriced} unpriced)`) : null),
          ...r.byMonth.map((c) => el('td', { class: 'num' }, c ? usd(c) : '')),
          el('td', { class: 'num' }, usd(r.totalCents)),
        ),
      );
    }
    if (section === 'expense') {
      rows.push(
        el(
          'tr',
          { class: 'total' },
          el('td', {}, 'Total spending'),
          ...st.months.map((_, i) => el('td', { class: 'num' }, usd(list.reduce((s, r) => s + r.byMonth[i]!, 0)))),
          el('td', { class: 'num' }, usd(st.spendingCents)),
        ),
      );
    }
  }
  return el('section', { class: 'panel' }, el('h2', {}, 'Spending by account and month'), el('p', {}, 'In US dollars at the daily price on the day each payment was made (UTC).'), el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, head), el('tbody', {}, rows))));
}

function balancesPanel(checks: BalanceCheck[], b: Books) {
  const verdict = (c: BalanceCheck) =>
    c.status === 'ties' ? el('span', { class: 'status-ties' }, '✓ ties out') : c.status === 'unexplained_outflow' ? el('span', { class: 'status-gap' }, 'money left unseen') : c.status === 'received' ? el('span', { class: 'status-received' }, 'received from outside') : el('span', {}, 'unreadable');
  return el(
    'section',
    { class: 'panel' },
    el('h2', {}, 'Balances checked against the chain'),
    el('p', {}, `Opening balance at block ${b.opening.height.toLocaleString('en-US')} (the last block before ${b.sinceDate}) − what these books paid out + moves in from the treasury’s own balances + other money in = closing balance at block ${b.asOf.height.toLocaleString('en-US')}. “Other money in” is derived: income, donations or swap proceeds. If it is negative, money left in a way no proposal explains.`),
    el(
      'div',
      { class: 'scroll' },
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ...['Token', 'Held in', 'Opening', '− Paid out', '+ Moved in', '+ Other in', '= Closing', 'Result'].map((h, i) => el('th', { class: i >= 2 && i <= 6 ? 'num' : '' }, h)))),
        el(
          'tbody',
          {},
          checks.map((c) =>
            el(
              'tr',
              {},
              el('td', {}, c.symbol),
              el('td', {}, c.location === 'intents' ? 'NEAR Intents' : c.location),
              ...[c.opening, c.bookedOut, c.movedIn, c.otherIn, c.closing].map((v) => el('td', { class: 'num' }, qty(v))),
              el('td', {}, verdict(c)),
            ),
          ),
        ),
      ),
    ),
  );
}

const KIND_NAMES: Record<string, string> = {
  possible_duplicate: 'Possible duplicate',
  memo_amount_mismatch: 'Amount differs from the description',
  balance_gap: 'Balance gap',
  possibly_still_owed: 'Possibly still owed',
  payee_voted: 'Payee voted',
  large_without_description: 'Large payment, no description',
  unnamed_payee: 'Unnamed payee',
  unexplained: 'Unexplained',
};

function questionsPanel(questions: Question[]) {
  return el(
    'section',
    { class: 'panel' },
    el('h2', {}, `Questions for the treasurer (${questions.length})`),
    el('p', {}, 'Each comes from a strict rule over what the chain shows, and lists the facts behind it. They are questions, not accusations.'),
    questions.length
      ? el(
          'div',
          { class: 'questions' },
          questions.map((q) =>
            el(
              'article',
              { class: 'q' },
              el('div', { class: 'kind' }, KIND_NAMES[q.kind] ?? q.kind),
              el('p', { class: 'ask-text' }, q.ask),
              q.facts.length ? el('details', {}, el('summary', {}, 'Facts'), el('ul', {}, q.facts.map((f) => el('li', {}, f)))) : null,
            ),
          ),
        )
      : el('p', {}, 'No questions: every payment was explained and the balances tie out.'),
  );
}

const BASIS_BADGE: Record<string, [string, string]> = {
  chain: ['chain', 'chain fact'],
  memo: ['memo', 'proposal words'],
  payee_history: ['history', 'payee history'],
  account_name: ['name', 'account name'],
  none: ['none', 'not placed'],
};

function journalPanel(entries: JournalEntry[], network: Network) {
  const used = [...new Set(entries.map((e) => e.category))];
  const select = el('select', { 'aria-label': 'Filter by account' }, el('option', { value: '' }, `All accounts (${entries.length})`), used.map((c) => el('option', { value: c }, `${CATEGORIES[c as CategoryId].code} ${CATEGORIES[c as CategoryId].name} (${entries.filter((e) => e.category === c).length})`)));
  const body = el('tbody');
  let showAll = false;
  const more = el('button', { class: 'quiet', type: 'button' }, 'Show all lines');
  const draw = () => {
    const shown = entries.filter((e) => !select.value || e.category === select.value);
    const list = showAll ? shown : shown.slice(0, 100);
    more.hidden = showAll || shown.length <= 100;
    body.replaceChildren(
      ...list.map((e) => {
        const [cls, label] = BASIS_BADGE[e.basis] ?? ['none', e.basis];
        const tx = e.approvalTx ? el('a', { href: `https://${network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${e.approvalTx}`, target: '_blank', rel: 'noopener' }, e.date) : e.date;
        return el(
          'tr',
          {},
          el('td', { class: 'num' }, tx, e.dateSource === 'submitted' ? el('span', { class: 'meta', title: 'payment date not found; submission date used' }, '*') : null),
          el('td', { class: 'num' }, `#${e.proposalId}`),
          el('td', { class: 'payee', title: e.payee }, shortHex(e.payee)),
          el('td', { class: 'num' }, `${qty(e.quantity)} ${e.symbol}`),
          el('td', { class: 'num' }, exactUsd(e.cents)),
          el('td', {}, `${CATEGORIES[e.category].code} ${CATEGORIES[e.category].name}`, el('br'), el('span', { class: `badge ${cls}` }, label)),
          el('td', { class: 'why' }, e.memo ? el('div', {}, `“${e.memo.slice(0, 160)}”`) : null, e.evidence),
        );
      }),
    );
  };
  select.addEventListener('change', draw);
  more.addEventListener('click', () => {
    showAll = true;
    draw();
  });
  draw();
  return el(
    'section',
    { class: 'panel' },
    el('h2', {}, 'Journal'),
    el('p', {}, 'Every paid line with the account it was placed in and why. The date links to the transaction whose vote paid it.'),
    el('div', { class: 'controls' }, select),
    el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Paid', 'Proposal', 'Payee', 'Amount', 'USD', 'Account', 'Why'].map((h, i) => el('th', { class: i === 3 || i === 4 ? 'num' : '' }, h)))), body)),
    el('div', { class: 'controls' }, more),
  );
}

function downloadsPanel(b: Books, network: Network) {
  const files = [
    ...exportBooks({
      dao: b.report.dao,
      network,
      since: b.sinceDate,
      entries: b.entries,
      statement: b.st,
      questions: b.questions,
      balances: { checks: b.balances, openingBlock: b.opening.height, openingDate: b.sinceDate, closingBlock: b.asOf.height },
    }),
    { name: 'report.json', content: JSON.stringify(b.report, null, 2) },
  ];
  const prefix = b.report.dao.split('.')[0];
  return el(
    'section',
    { class: 'panel' },
    el('h2', {}, 'Download the books'),
    el('p', {}, 'The journal, QuickBooks and Xero imports, the chart of accounts, monthly spending, the balance check, the questions, a plain-language guide to every file, and the fingerprinted report.'),
    el(
      'div',
      { class: 'downloads' },
      files.map((f) => {
        const type = f.name.endsWith('.json') ? 'application/json' : f.name.endsWith('.txt') ? 'text/plain' : 'text/csv';
        const url = URL.createObjectURL(new Blob([f.content], { type: `${type};charset=utf-8` }));
        return el('a', { href: url, download: `${prefix}-${f.name}` }, f.name);
      }),
    ),
  );
}

function closePanel(report: SignedReport, policy: DaoPolicy | null, network: Network) {
  if (!policy) return el('section', { class: 'panel' }, el('h2', {}, 'Close the books by vote'), el('p', {}, 'The DAO’s policy could not be read, so the proposal can’t be drafted here. Use the command line: node cli/tickmark.ts close report.json'));
  const call = closingProposal(report, policy);
  const signer = el('input', { placeholder: 'your-account.near', spellcheck: 'false', 'aria-label': 'Your account' });
  const who = el('p', { class: 'meta' });
  const cmd = el('pre', { class: 'cmd' });
  const update = () => {
    const account = signer.value.trim();
    cmd.textContent = nearCliCommand(call, account || '<your-account.near>', network);
    if (!account) who.textContent = 'Enter your account to check that the DAO’s policy lets you submit it.';
    else {
      const may = mayPropose(policy, account);
      who.textContent = may.allowed ? `${account} may submit it (role: ${may.roles.join(', ')}).` : `${account} is not in a role that may add vote proposals under this policy; a council member should submit it.`;
    }
  };
  signer.addEventListener('input', update);
  update();
  const copy = el('button', { class: 'quiet', type: 'button' }, 'Copy command');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(cmd.textContent ?? '');
      copy.textContent = 'Copied';
    } catch {
      getSelection()?.selectAllChildren(cmd);
    }
  });
  const bond = Number(BigInt(policy.proposal_bond) / 10n ** 21n) / 1000;
  return el(
    'section',
    { class: 'panel' },
    el('h2', {}, 'Close the books by vote'),
    el('p', {}, `The council approves these books with the treasury’s own governance: an ordinary Sputnik proposal of kind “Vote” (text only, it moves no money) that carries the report’s fingerprint. No new multisig, no new contract. Bond: ${bond} NEAR, returned when it passes. Tickmark never signs: a council member submits it.`),
    el('div', { class: 'proposal' }, call.args.proposal.description.split(' <br>').map((line) => el('p', {}, line.replace(/^\* /, '')))),
    el('div', { class: 'controls' }, signer, copy),
    who,
    cmd,
    el('p', { class: 'meta' }, 'After the vote, anyone can download report.json above and check it under “Check a report”: it shows the vote that approved this exact report.'),
  );
}

// ---------------------------------------------------------------- checking a report

async function verifyFile(file: File) {
  const out = $('verify-out');
  const line = (text: string) => out.append(el('div', { class: 'meta' }, text));
  out.replaceChildren();
  let saved: SignedReport;
  try {
    saved = JSON.parse(await file.text()) as SignedReport;
    if (!saved.fingerprint || !saved.asOf?.block || !saved.dao) throw new Error('not a Tickmark report');
  } catch (e) {
    out.append(el('div', { class: 'verdict bad' }, `This is not a Tickmark report.json (${(e as Error).message}).`));
    return;
  }
  const network = (saved.network === 'testnet' ? 'testnet' : 'mainnet') as Network;
  const intact = (await fingerprintOf(saved)) === saved.fingerprint;
  line(`${saved.dao} · ${network} · ${saved.since} to block ${saved.asOf.block.toLocaleString('en-US')}`);
  line(intact ? '✓ the file was not edited (its content hashes to its fingerprint)' : '✗ the file was edited after it was made');
  line('… rebuilding the books from the chain at that block (archival node)');
  try {
    const { report } = await makeBooks(saved.dao, { network, since: saved.since, block: saved.asOf.block, skipDates: false, warn: () => {} }, await deps());
    const closings = findClosings(await fetchProposals(new Rpc({ network }), saved.dao, 0)).filter((c) => c.fingerprint === saved.fingerprint);
    const same = report.fingerprint === saved.fingerprint;
    const diff = same ? null : firstDifference({ ...saved, fingerprint: undefined }, { ...report, fingerprint: undefined });
    out.append(
      el(
        'div',
        { class: `verdict ${same && intact ? 'good' : 'bad'}` },
        el('strong', {}, same && intact ? 'VERIFIED: the report matches the chain.' : 'NOT VERIFIED.'),
        el('div', { class: 'mono' }, `file:    ${saved.fingerprint}`),
        el('div', { class: 'mono' }, `rebuilt: ${report.fingerprint}`),
        diff ? el('div', {}, `First difference at ${diff.path}.`) : null,
        saved.tickmark !== report.tickmark ? el('div', {}, `Built by Tickmark ${saved.tickmark}, checked with ${report.tickmark}.`) : null,
        closings.length
          ? closings.map((c) => el('div', {}, `Closed by vote: proposal #${c.proposalId} is ${c.status} (${Object.entries(c.votes).map(([w, v]) => `${w} ${v}`).join(', ') || 'no votes yet'}).`))
          : el('div', {}, 'No proposal in this DAO carries this fingerprint yet.'),
      ),
    );
  } catch (e) {
    out.append(el('div', { class: 'verdict bad' }, `Could not rebuild: ${(e as Error).message}`));
  }
}

// ---------------------------------------------------------------- wiring

async function start() {
  // Every browser request is preceded by a CORS preflight; two at a time per host keeps the free endpoints happy.
  setMaxInFlightPerHost(2);
  const { prices } = await deps();
  const range = prices.range('near');
  const since = $<HTMLInputElement>('since');
  if (range) {
    since.min = range.from;
    since.max = range.to;
    since.value = range.from;
  }
  const params = new URLSearchParams(location.search);
  const dao = $<HTMLInputElement>('dao');
  const network = $<HTMLSelectElement>('network');
  if (params.get('dao')) dao.value = params.get('dao')!;
  if (params.get('network') === 'testnet') network.value = 'testnet';
  if (params.get('since')) since.value = params.get('since')!;
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    void run(dao.value.trim().toLowerCase(), network.value as Network, since.value);
  });
  $<HTMLInputElement>('verify-file').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void verifyFile(file);
  });
  if (params.get('dao')) void run(dao.value.trim().toLowerCase(), network.value as Network, since.value);
}

void start();
