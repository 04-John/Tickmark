// The overview: where the money went, by account and by month, the balance check as an equation, and the questions.
// LoadingBooks is the same layout as skeletons, with the run's progress on top.
import { useEffect, useState } from 'react';
import type { Closing } from '../../../core/closing.ts';
import type { SignedReport } from '../../../core/report.ts';
import type { Network } from '../../../core/rpc.ts';
import { PhoneNav, useBooks, useReport } from '../app.tsx';
import { closingsOf, STEPS } from '../lib/data.ts';
import { day, elapsed, month, plural, qty, usd } from '../lib/format.ts';
import { href, useAnswers, useNow, usePhone } from '../lib/hooks.ts';
import { BALANCE, KIND, LOCATION } from '../lib/labels.ts';
import { Group, Icon, Pill, Row, Sk, Stamp, Stat } from '../ui.tsx';

const SHADES = ['var(--ink)', 'var(--ink-2)', 'var(--ink-3)', 'var(--ink-4)'];

/** The vote that approved these exact books, if any (read for small treasuries and the demo only: it reads every proposal). */
export function useClosedBy(report: SignedReport): Closing | null {
  const books = useBooks();
  const [closing, setClosing] = useState<Closing | null>(null);
  useEffect(() => {
    if (books.source !== 'demo' && report.journal.length > 200) return;
    let live = true;
    void closingsOf(report.dao, report.network as Network).then((all) => {
      if (live) setClosing(all.find((c) => c.fingerprint === report.fingerprint && c.status === 'Approved') ?? null);
    });
    return () => {
      live = false;
    };
  }, [report, books.source]);
  return closing;
}

function summary(report: SignedReport, answered: (id: string) => boolean) {
  const st = report.statement;
  const expense = st.rows.filter((r) => r.section === 'expense').sort((a, b) => b.totalCents - a.totalCents);
  const suspense = st.rows.filter((r) => r.section === 'suspense');
  const notSpending = st.rows.filter((r) => r.section === 'balance_sheet');
  const paid = st.spendingCents + st.suspenseCents;
  const gaps = report.balances.filter((b) => b.status === 'unexplained_outflow').length;
  const ties = report.balances.every((b) => b.status === 'ties' || b.status === 'received');
  const done = report.questions.filter((q) => answered(q.id)).length;
  const kinds = new Map<string, { total: number; open: number }>();
  for (const q of report.questions) {
    const k = kinds.get(q.kind) ?? { total: 0, open: 0 };
    k.total++;
    if (!answered(q.id)) k.open++;
    kinds.set(q.kind, k);
  }
  return { st, expense, suspense, notSpending, paid, gaps, ties, done, kinds };
}

function AccountBars({ s }: { s: ReturnType<typeof summary> }) {
  const max = Math.max(1, ...s.expense.map((r) => r.totalCents), ...s.suspense.map((r) => r.totalCents));
  const bar = (r: (typeof s.expense)[number], i: number, tone?: string) => (
    <a key={r.code} className={`bar-row ${tone ?? ''}`} href={href('journal', `account:${r.category}`)}>
      <div className="bar-label">
        <span>{r.name}</span>
        <span className="num strong">{usd(r.totalCents)}</span>
      </div>
      <div className="bar">
        <span style={{ width: `${Math.max(1, (100 * r.totalCents) / max)}%`, background: tone ? undefined : SHADES[Math.min(i, 3)] }} />
      </div>
      <span className="bar-note num">
        {r.code} · {plural(r.count, 'line')}
        {r.unpriced ? ` · ${r.unpriced} without a price` : ''}
      </span>
    </a>
  );
  return (
    <div className="bars">
      {s.expense.length === 0 && s.suspense.length === 0 && <p className="secondary">No payments in this period.</p>}
      {s.expense.map((r, i) => bar(r, i))}
      {s.suspense.length > 0 && <div className="sep" />}
      {s.suspense.map((r, i) => bar(r, i, 'pencil'))}
    </div>
  );
}

function MonthChart({ s }: { s: ReturnType<typeof summary> }) {
  const rows = [...s.expense, ...s.suspense];
  const totals = s.st.months.map((_, i) => rows.reduce((sum, r) => sum + (r.byMonth[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const color = (r: (typeof rows)[number]) => (r.section === 'suspense' ? 'var(--pencil)' : SHADES[Math.min(s.expense.indexOf(r), 3)]);
  const months = s.st.months;
  return (
    <div className="months">
      <div className="month-bars" role="img" aria-label={`Spending by month, ${months.map((m, i) => `${month(m)} ${usd(totals[i]!)}`).join(', ')}`}>
        {months.map((m, i) => (
          <div key={m} className="month" title={`${month(m)}: ${usd(totals[i]!)}`}>
            <div className="month-stack" style={{ height: `${totals[i] ? Math.max(2, (100 * totals[i]!) / max) : 0}%` }}>
              {rows
                .filter((r) => r.byMonth[i])
                .map((r) => (
                  <span key={r.code} style={{ flexGrow: r.byMonth[i], background: color(r) }} />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="month-axis num">
        <span>{months[0] ? month(months[0]) : ''}</span>
        {months.length > 2 && <span>{month(months[Math.floor(months.length / 2)]!)}</span>}
        {months.length > 1 && <span>{month(months[months.length - 1]!)}</span>}
      </div>
      <div className="legend">
        {rows.slice(0, 5).map((r) => (
          <span key={r.code}>
            <i style={{ background: color(r) }} />
            {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function BalanceEquation({ report }: { report: SignedReport }) {
  return (
    <div className="balances">
      {report.balances.map((b) => {
        const [label, tone] = BALANCE[b.status];
        return (
          <div key={`${b.token}:${b.location}`} className="balance">
            <div className="balance-head">
              <b>
                {b.symbol} · {LOCATION[b.location] ?? b.location}
              </b>
              <Pill tone={tone}>{b.status === 'ties' ? `✓ ${label}` : label}</Pill>
            </div>
            <div className="equation">
              <span>
                <small>Opening</small>
                <b className="num">{qty(b.opening)}</b>
              </span>
              <i>−</i>
              <span>
                <small>Paid out</small>
                <b className="num">{qty(b.bookedOut)}</b>
              </span>
              <i>+</i>
              <span>
                <small>Moved in</small>
                <b className="num">{qty(b.movedIn)}</b>
              </span>
              <i>+</i>
              <span>
                <small className="link-c">Other in</small>
                <b className="num">{qty(b.otherIn)}</b>
              </span>
              <i>=</i>
              <span className={`closing t-${tone}`}>
                <small>{b.closing === null ? 'Closing' : 'On chain'}</small>
                <b className="num">{qty(b.closing)}</b>
              </span>
            </div>
          </div>
        );
      })}
      {report.balances.length === 0 && <p className="secondary">No balances to check.</p>}
      <p className="secondary small">
        <b className="link-c">Other in</b> is money the chain shows arriving that no proposal explains, like deposits or rewards. Tickmark solves for it so the books close to the real balance. A negative value means money left unseen.
      </p>
    </div>
  );
}

function WebOverview({ report, s, closedBy }: { report: SignedReport; s: ReturnType<typeof summary>; closedBy: Closing | null }) {
  const books = useBooks();
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused: the address bar already holds the link */
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="secondary num">
            {day(report.since)} – {day(report.asOf.time)}
          </span>
          <h1 className="title-xl">Where the money went</h1>
          <span className="faint num">
            Read at block {report.asOf.block.toLocaleString('en-US')} · {report.asOf.time.slice(0, 16).replace('T', ', ')} UTC · prices through {report.pricesThrough.near ?? '—'}
          </span>
        </div>
        <div className="actions">
          {closedBy && <Stamp id={closedBy.proposalId} block={report.asOf.block} small />}
          {books.source === 'live' && (
            <button className="btn btn-gray btn-sm" type="button" onClick={share}>
              {copied ? 'Link copied' : 'Copy link to these books'}
            </button>
          )}
          <a className="btn btn-gray btn-sm" href={href('downloads')}>
            Download
          </a>
        </div>
      </div>

      <div className="stats">
        <Stat label="Spending" value={usd(s.st.spendingCents)} note={plural(report.totals.lines, 'paid line')} />
        <Stat label="Not explained yet" value={usd(s.st.suspenseCents)} note={s.paid ? `${Math.round((100 * s.st.suspenseCents) / s.paid)}% of paid out · review ›` : 'nothing in Suspense'} tone={s.st.suspenseCents ? 'pencil' : 'plain'} href={href('questions')} />
        <Stat label="Balances vs chain" value={s.gaps ? plural(s.gaps, 'gap') : 'Tie out'} note={s.gaps ? 'money left that no proposal explains' : 'every token and place'} tone={s.gaps ? 'pencil' : 'ok'} />
        <Stat
          label="Questions answered"
          value={
            <>
              {s.done}
              <span className="dim"> of {report.questions.length}</span>
            </>
          }
          note={<span className="progress-line"><span style={{ width: `${report.questions.length ? (100 * s.done) / report.questions.length : 100}%` }} /></span>}
          href={href('questions')}
        />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2 className="title-3">By account</h2>
            <span className="faint">USD</span>
          </div>
          <AccountBars s={s} />
          {s.notSpending.length > 0 && (
            <p className="secondary small">
              Not spending: {s.notSpending.map((r) => `${r.name} ${usd(r.totalCents)}`).join(' · ')}
            </p>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="title-3">By month</h2>
            <span className="faint">USD</span>
          </div>
          <MonthChart s={s} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2 className="title-3">Balance check</h2>
          </div>
          <BalanceEquation report={report} />
        </section>
        <section className="card list-card">
          <div className="card-head pad-x">
            <h2 className="title-3">Questions</h2>
            <a href={href('questions')}>Start ›</a>
          </div>
          {[...s.kinds].map(([kind, k]) => (
            <a key={kind} className={`list-row ${k.open ? '' : 'done'}`} href={href('questions')}>
              <span>{KIND[kind as keyof typeof KIND] ?? kind}</span>
              <span className="num">{k.open ? k.open : '✓'}</span>
            </a>
          ))}
          {s.kinds.size === 0 && <p className="secondary pad-x">No questions: every payment was explained and the balances tie out.</p>}
        </section>
      </div>
    </div>
  );
}

function PhoneOverview({ report, s, closedBy }: { report: SignedReport; s: ReturnType<typeof summary>; closedBy: Closing | null }) {
  const share = () => {
    if (navigator.share) void navigator.share({ title: `Tickmark · ${report.dao}`, url: location.href }).catch(() => {});
    else void navigator.clipboard?.writeText(location.href).catch(() => {});
  };
  const max = Math.max(1, s.paid);
  return (
    <>
      <PhoneNav back="#/" backLabel="Treasuries">
        <button type="button" className="icon-btn" aria-label="Share these books" onClick={share}>
          <Icon name="share" size={22} />
        </button>
      </PhoneNav>
      <div className="pscroll">
        <div className="large-head">
          <h1 className="large-title">Books</h1>
          <div className="sub">
            <span className="mono truncate">{report.dao}</span>
            <Pill tone={report.network === 'testnet' ? 'warn' : 'ok'}>{report.network === 'testnet' ? 'Testnet' : 'Mainnet'}</Pill>
          </div>
        </div>
        {closedBy && (
          <div className="pad">
            <Stamp id={closedBy.proposalId} block={report.asOf.block} small />
          </div>
        )}
        <div className="stats pad">
          <Stat label="Spending" value={usd(s.st.spendingCents)} note={plural(report.totals.lines, 'line')} />
          <Stat label="Unexplained" value={usd(s.st.suspenseCents)} note="Review ›" tone={s.st.suspenseCents ? 'pencil' : 'plain'} href={href('questions')} />
          <Stat label="Balances" value={s.gaps ? plural(s.gaps, 'gap') : 'Tie out'} note={s.gaps ? 'Look closer' : 'Checked on chain'} tone={s.gaps ? 'pencil' : 'ok'} />
          <Stat
            label="Questions"
            value={
              <>
                {s.done}
                <span className="dim">/{report.questions.length}</span>
              </>
            }
            note={<span className="progress-line"><span style={{ width: `${report.questions.length ? (100 * s.done) / report.questions.length : 100}%` }} /></span>}
            href={href('questions')}
          />
        </div>
        <Group title="Where it went">
          <div className="stack-bar" aria-hidden="true">
            {[...s.expense, ...s.suspense].map((r, i) => (
              <span key={r.code} style={{ flexGrow: r.totalCents / max, background: r.section === 'suspense' ? 'var(--pencil)' : SHADES[Math.min(i, 3)] }} />
            ))}
          </div>
          {[...s.expense, ...s.suspense].map((r, i) => (
            <Row key={r.code} href={href('journal', `account:${r.category}`)} className={r.section === 'suspense' ? 'pencil' : ''}>
              <i className="swatch" style={{ background: r.section === 'suspense' ? 'var(--pencil)' : SHADES[Math.min(i, 3)] }} />
              <span className="row-main truncate">{r.name}</span>
              <span className="row-value num">{usd(r.totalCents)}</span>
            </Row>
          ))}
        </Group>
        {report.balances.map((b) => (
          <Group key={`${b.token}:${b.location}`} title={`Balance check · ${b.symbol}`}>
            <Row>
              <span className="row-main">Opening</span>
              <span className="row-value num">{qty(b.opening)}</span>
            </Row>
            <Row>
              <span className="row-main">Paid out</span>
              <span className="row-value num">−{qty(b.bookedOut)}</span>
            </Row>
            {b.movedIn !== '0' && (
              <Row>
                <span className="row-main">Moved in</span>
                <span className="row-value num">+{qty(b.movedIn)}</span>
              </Row>
            )}
            <Row>
              <span className="row-main link-c">Other money in</span>
              <span className="row-value num">+{qty(b.otherIn)}</span>
            </Row>
            <Row className={`strong t-${BALANCE[b.status][1]}-text`}>
              <span className="row-main">{b.status === 'ties' ? '✓ Closing, on chain' : BALANCE[b.status][0]}</span>
              <span className="row-value num">{qty(b.closing)}</span>
            </Row>
          </Group>
        ))}
        <Group title="More">
          <Row href={href('payees')}>
            <span className="row-main">Payees</span>
            <span className="row-value">{report.payees.length}</span>
          </Row>
          <Row href={href('downloads')}>
            <span className="row-main">Downloads</span>
          </Row>
          <Row href={href('verify')}>
            <span className="row-main">Check a report</span>
          </Row>
        </Group>
        <p className="group-foot num">
          Read at block {report.asOf.block.toLocaleString('en-US')} · {day(report.since)} – {day(report.asOf.time)}
        </p>
      </div>
    </>
  );
}

export function Overview() {
  const report = useReport();
  const { answers } = useAnswers(report.fingerprint);
  const s = summary(report, (id) => !!answers[id]?.answered);
  const closedBy = useClosedBy(report);
  return usePhone() ? <PhoneOverview report={report} s={s} closedBy={closedBy} /> : <WebOverview report={report} s={s} closedBy={closedBy} />;
}

// ---------------------------------------------------------------- loading: the same layout as skeletons

function Progress() {
  const books = useBooks();
  const now = useNow(true);
  const step = Math.max(0, books.step);
  const pct = Math.min(0.95, (step + 0.5) / STEPS.length);
  const C = 2 * Math.PI * 26;
  return (
    <section className="card progress" aria-live="polite">
      <svg width="52" height="52" viewBox="0 0 64 64" role="img" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        <circle cx="32" cy="32" r="26" className="ring-bg" strokeWidth="7" fill="none" />
        <circle cx="32" cy="32" r="26" className="ring" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90 32 32)" />
      </svg>
      <div className="progress-text">
        <b>{STEPS[step]}</b>
        <span className="secondary num">
          Step {step + 1} of {STEPS.length} · {elapsed(now - books.startedAt)} · usually 20 s to 2 min
        </span>
      </div>
      <ol className="chips hide-sm">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'done' : i === step ? 'now' : ''}>
            {i < step ? '✓ ' : ''}
            {['Proposals', 'Votes', 'Prices', 'Balances'][i]}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-gray btn-sm" onClick={books.cancel}>
        Cancel
      </button>
    </section>
  );
}

export function LoadingBooks() {
  const books = useBooks();
  const phone = usePhone();
  const live = books.source === 'live';
  const card = (lines: number) => (
    <div className="stat">
      <Sk w="50%" h={10} />
      <Sk w="70%" h={28} r={8} />
      {lines > 2 && <Sk w="35%" h={10} />}
    </div>
  );
  if (phone)
    return (
      <>
        <PhoneNav back="#/" backLabel="Treasuries">
          {live && (
            <button type="button" className="text-btn" onClick={books.cancel}>
              Cancel
            </button>
          )}
        </PhoneNav>
        <div className="pscroll" aria-busy="true">
          <div className="large-head">
            <h1 className="large-title">Books</h1>
            <div className="sub">{live ? <span className="mono truncate">{books.request?.dao}</span> : <Sk w={180} h={12} />}</div>
          </div>
          {live && (
            <div className="pad">
              <Progress />
            </div>
          )}
          <div className="stats pad">
            {card(3)}
            {card(3)}
            {card(3)}
            {card(3)}
          </div>
          <Group title="Where it went">
            {[60, 45, 52].map((w) => (
              <div className="row" key={w}>
                <span className="row-main">
                  <Sk w={`${w}%`} h={12} />
                </span>
                <Sk w={56} h={14} />
              </div>
            ))}
          </Group>
          {live && <p className="group-foot">Keep Tickmark open. The books build on this phone from public NEAR data.</p>}
        </div>
      </>
    );
  return (
    <div className="page" aria-busy="true">
      {live && <Progress />}
      <div className="page-head">
        <div className="sk-stack">
          <Sk w={180} h={12} />
          <Sk w={360} h={34} r={8} />
          <Sk w={300} h={10} />
        </div>
      </div>
      <div className="stats">
        {card(3)}
        {card(3)}
        {card(3)}
        {card(3)}
      </div>
      <div className="grid-2">
        <section className="card sk-stack gap-lg">
          <Sk w={160} h={16} />
          {[90, 60, 30].map((w) => (
            <div className="sk-stack" key={w}>
              <Sk w="55%" h={10} />
              <Sk w={`${w}%`} h={10} r={99} />
            </div>
          ))}
        </section>
        <section className="card sk-stack gap-lg">
          <Sk w={140} h={16} />
          <div className="sk-bars">
            {[30, 55, 40, 75, 50, 90, 60, 35, 70].map((h, i) => (
              <Sk key={i} h={`${h}%`} r={4} />
            ))}
          </div>
        </section>
      </div>
      <section className="card sk-stack gap-lg">
        <Sk w={200} h={16} />
        {[0, 1, 2, 3].map((i) => (
          <div className="sk-row" key={i}>
            <Sk w="12%" h={10} />
            <Sk w="40%" h={10} />
            <Sk w="14%" h={10} />
            <Sk w="10%" h={10} />
          </div>
        ))}
      </section>
    </div>
  );
}
