// The overview: four figures, where the money went by account and by month, the questions, and whether it adds up
// on chain. Web fills the page on a 12-column grid; phones get a summary card and one clear next action.
// LoadingBooks is the same layout as skeletons, with the run's progress on top.
import type { ReactNode } from 'react';
import type { Closing } from '../../../core/closing.ts';
import type { SignedReport } from '../../../core/report.ts';
import { PhoneNav, useBooks, useReport } from '../app.tsx';
import { doing, nextFor, NextStep, useClosedBy, useProgress } from '../guide.tsx';
import { openPalette } from '../palette.tsx';
import { STEPS } from '../lib/data.ts';
import { day, elapsed, month, plural, qty, usd } from '../lib/format.ts';
import { href, useAnswers, useNow, usePhone } from '../lib/hooks.ts';
import { BALANCE, KIND, LOCATION } from '../lib/labels.ts';
import { Check, Group, Icon, Pill, Row, Sk, Stamp, Stat } from '../ui.tsx';

const SHADES = ['var(--ink)', 'var(--ink-2)', 'var(--ink-3)', 'var(--ink-4)'];

function summary(report: SignedReport, answered: (id: string) => boolean) {
  const st = report.statement;
  const expense = st.rows.filter((r) => r.section === 'expense').sort((a, b) => b.totalCents - a.totalCents);
  const suspense = st.rows.filter((r) => r.section === 'suspense');
  const paid = st.spendingCents + st.suspenseCents;
  const gaps = report.balances.filter((b) => b.status === 'unexplained_outflow').length;
  const unreadable = report.balances.filter((b) => b.status === 'unreadable').length;
  const done = report.questions.filter((q) => answered(q.id)).length;
  return { st, expense, suspense, paid, gaps, unreadable, done };
}

type Summary = ReturnType<typeof summary>;

/** "Adds up on chain": yes, the gaps, or that some balances could not be read. */
function addsUp(s: Summary): { value: string; tone: 'ok' | 'pencil' | 'plain' } {
  if (s.gaps) return { value: plural(s.gaps, 'gap'), tone: 'pencil' };
  if (s.unreadable) return { value: 'Partly', tone: 'plain' };
  return { value: 'Yes', tone: 'ok' };
}

function AccountBars({ s }: { s: Summary }) {
  const max = Math.max(1, ...s.expense.map((r) => r.totalCents), ...s.suspense.map((r) => r.totalCents));
  const bar = (r: (typeof s.expense)[number], i: number, tone?: string) => (
    <a key={r.code} className={`bar-row ${tone ?? ''}`} href={href('journal', `account:${r.category}`)} title={`${r.code} · ${plural(r.count, 'line')}`}>
      <div className="bar-label">
        <span>{r.section === 'suspense' ? 'Not explained yet' : r.name}</span>
        <span className="num">{usd(r.totalCents)}</span>
      </div>
      <div className="bar">
        <span style={{ width: `${Math.max(1, (100 * r.totalCents) / max)}%`, background: tone ? undefined : SHADES[Math.min(i, 3)] }} />
      </div>
    </a>
  );
  return (
    <div className="bars">
      {s.expense.length === 0 && s.suspense.length === 0 && <p className="secondary">No payments in this period.</p>}
      {s.expense.map((r, i) => bar(r, i))}
      {s.suspense.map((r, i) => bar(r, i, 'pencil'))}
    </div>
  );
}

function MonthChart({ s }: { s: Summary }) {
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
    </div>
  );
}

/** A signed token amount as "+ 8.01" or "− 0.5", with a real minus sign. */
function signed(value: string | null, sign: '+' | '−'): string {
  if (value === null) return '?';
  const negative = value.startsWith('-');
  const flip = negative ? (sign === '+' ? '−' : '+') : sign;
  return `${flip} ${qty(negative ? value.slice(1) : value)}`;
}

/** One balance as a ledger line: opening, out, in, and what the chain holds now, with dotted leaders. */
function Receipt({ b }: { b: SignedReport['balances'][number] }) {
  const [label, tone] = BALANCE[b.status];
  const line = (name: ReactNode, value: string, cls = '', title?: string) => (
    <div className={`rc-line ${cls}`} title={title}>
      <span>{name}</span>
      <i aria-hidden="true" />
      <b className="num">{value}</b>
    </div>
  );
  return (
    <div className="receipt">
      <div className="rc-head">
        <b>
          {b.symbol} <span className="secondary">· {LOCATION[b.location] ?? b.location}</span>
        </b>
        <Pill tone={tone}>{b.status === 'ties' ? `✓ ${label}` : label}</Pill>
      </div>
      {line('Opening', qty(b.opening))}
      {line('Paid out', signed(b.bookedOut, '−'))}
      {b.movedIn !== '0' && line('Moved in', signed(b.movedIn, '+'))}
      {line('Other money in', signed(b.otherIn, '+'), '', 'Money the chain shows arriving that no proposal explains, like deposits or rewards. Negative means money left unseen.')}
      {line(b.closing === null ? 'Closing' : 'On chain now', qty(b.closing), `rc-total t-${tone}-text`)}
    </div>
  );
}

function Receipts({ report }: { report: SignedReport }) {
  return (
    <div className="receipts">
      {report.balances.map((b) => (
        <Receipt key={`${b.token}:${b.location}`} b={b} />
      ))}
      {report.balances.length === 0 && <p className="secondary">No balances to check.</p>}
    </div>
  );
}

function WebOverview({ report, s, closedBy }: { report: SignedReport; s: Summary; closedBy: Closing | null }) {
  const total = report.questions.length;
  const up = addsUp(s);
  return (
    <div className="page overview">
      <header className="ov-head">
        <div>
          <h1 className="title-xl">Where the money went</h1>
          <p className="ov-sub num">
            {day(report.since)} – {day(report.asOf.time)}
          </p>
        </div>
        {closedBy && <Stamp id={closedBy.proposalId} block={report.asOf.block} small />}
      </header>

      <div className="stats strip">
        <Stat label="Paid out" value={usd(s.paid)} note={plural(report.totals.lines, 'payment')} />
        <Stat label="Not explained" value={usd(s.st.suspenseCents)} note={s.paid ? `${Math.round((100 * s.st.suspenseCents) / s.paid)}% of paid out` : undefined} tone={s.st.suspenseCents ? 'pencil' : 'plain'} href={href('questions')} />
        <Stat label="Adds up on chain" value={up.value} tone={up.tone} />
        <Stat label="Questions answered" value={`${s.done} of ${total}`} href={href('questions')} />
      </div>

      <div className="ov-grid">
        <section className="card ov-accounts">
          <div className="card-head">
            <h2 className="title-3">By account</h2>
          </div>
          <AccountBars s={s} />
        </section>
        <section className="card ov-months">
          <div className="card-head">
            <h2 className="title-3">By month</h2>
          </div>
          <MonthChart s={s} />
        </section>
        <ActionItems report={report} />
        <section className="card ov-balance">
          <div className="card-head">
            <h2 className="title-3">Balance check</h2>
          </div>
          <Receipts report={report} />
        </section>
      </div>

      <NextStep page="books" />
    </div>
  );
}

/** Open questions as a checklist: tick one off here, or open it to see the payments it cites. */
function ActionItems({ report }: { report: SignedReport }) {
  const { answers, save } = useAnswers(report.fingerprint);
  const open = report.questions.filter((q) => !answers[q.id]?.answered);
  const recent = report.questions.filter((q) => answers[q.id]?.answered).slice(0, Math.max(0, 5 - open.length));
  const rows = [...open.slice(0, 5), ...recent];
  return (
    <section className="card list-card action-items ov-questions">
      <div className="card-head pad-x">
        <h2 className="title-3">
          Questions <span className="count-chip num">{open.length}</span>
        </h2>
        <a href={href('questions')}>All</a>
      </div>
      {rows.map((q) => {
        const done = !!answers[q.id]?.answered;
        return (
          <div key={q.id} className={`action-row ${done ? 'done' : ''}`}>
            <Check checked={done} onChange={() => save(q.id, { answered: !done })} label={`Mark answered: ${q.ask}`} />
            <a href={href('questions', q.id)} className="action-text" title={q.ask}>
              <span className="truncate">{KIND[q.kind]}</span>
            </a>
            <span className="action-meta num">{q.cents === null ? '' : usd(q.cents)}</span>
          </div>
        );
      })}
      {rows.length === 0 && <p className="secondary pad-x">No questions.</p>}
    </section>
  );
}

function PhoneActions({ report }: { report: SignedReport }) {
  const { answers, save } = useAnswers(report.fingerprint);
  const open = report.questions.filter((q) => !answers[q.id]?.answered);
  if (!report.questions.length) return null;
  return (
    <Group title={`Questions · ${open.length} open`}>
      {(open.length ? open : report.questions).slice(0, 3).map((q) => {
        const done = !!answers[q.id]?.answered;
        return (
          <div key={q.id} className={`row action-row ${done ? 'done' : ''}`}>
            <Check checked={done} onChange={() => save(q.id, { answered: !done })} label={`Mark answered: ${q.ask}`} />
            <a className="row-main action-text truncate" href={href('questions', q.id)}>
              {KIND[q.kind]}
            </a>
            {q.cents !== null && <span className="row-value num">{usd(q.cents)}</span>}
          </div>
        );
      })}
      {open.length > 3 && (
        <Row href={href('questions')}>
          <span className="row-main link-c">All {open.length}</span>
        </Row>
      )}
    </Group>
  );
}

/** The treasury in brief: what was paid out, and the three things to know about it. */
function SummaryCard({ report, s, closedBy }: { report: SignedReport; s: Summary; closedBy: Closing | null }) {
  const total = report.questions.length;
  const up = addsUp(s);
  return (
    <section className="summary-card" aria-label="These books in brief">
      <div className="sc-figure">
        <small>Paid out</small>
        <b className="num">{usd(s.paid)}</b>
        <span className="secondary num">
          {day(report.since)} – {day(report.asOf.time)}
        </span>
      </div>
      <div className="sc-row">
        <a href={href('questions')}>
          <small>Not explained</small>
          <b className={`num ${s.st.suspenseCents ? 'pencil' : ''}`}>{usd(s.st.suspenseCents)}</b>
        </a>
        <span>
          <small>Adds up</small>
          <b className={up.tone === 'ok' ? 'ok' : up.tone === 'pencil' ? 'pencil' : ''}>{up.value}</b>
        </span>
        <a href={href('questions')}>
          <small>Answered</small>
          <b className="num">
            {s.done}/{total}
          </b>
        </a>
      </div>
      {closedBy && <span className="sc-stamp">✓ Closed by vote #{closedBy.proposalId}</span>}
    </section>
  );
}

function PhoneOverview({ report, s, closedBy }: { report: SignedReport; s: Summary; closedBy: Closing | null }) {
  const p = useProgress(report);
  const next = nextFor('books', p.done);
  const share = () => {
    if (navigator.share) void navigator.share({ title: `Tickmark · ${report.dao}`, url: location.href }).catch(() => {});
    else void navigator.clipboard?.writeText(location.href).catch(() => {});
  };
  const max = Math.max(1, s.paid);
  return (
    <>
      <PhoneNav back="#/" backLabel="Treasuries">
        <button type="button" className="icon-btn" aria-label="Search and quick actions" onClick={openPalette}>
          <Icon name="search" size={21} />
        </button>
        <button type="button" className="icon-btn" aria-label="Share these books" onClick={share}>
          <Icon name="share" size={22} />
        </button>
      </PhoneNav>
      <div className="pscroll ph-books">
        <div className="large-head">
          <h1 className="large-title">Books</h1>
          <div className="sub">
            <span className="mono truncate secondary">{report.dao}</span>
          </div>
        </div>
        <div className="pad">
          <SummaryCard report={report} s={s} closedBy={closedBy} />
        </div>
        {next && (
          <div className="pad">
            <a className="btn btn-primary ph-next" href={href(next.page)}>
              <span>{doing(next, p)}</span>
              <Icon name="arrow" size={18} />
            </a>
          </div>
        )}
        <PhoneActions report={report} />
        <Group title="Where it went">
          <div className="stack-bar" aria-hidden="true">
            {[...s.expense, ...s.suspense].map((r, i) => (
              <span key={r.code} style={{ flexGrow: r.totalCents / max, background: r.section === 'suspense' ? 'var(--pencil)' : SHADES[Math.min(i, 3)] }} />
            ))}
          </div>
          {[...s.expense, ...s.suspense].map((r, i) => (
            <Row key={r.code} href={href('journal', `account:${r.category}`)} className={r.section === 'suspense' ? 'pencil' : ''}>
              <i className="swatch" style={{ background: r.section === 'suspense' ? 'var(--pencil)' : SHADES[Math.min(i, 3)] }} />
              <span className="row-main truncate">{r.section === 'suspense' ? 'Not explained yet' : r.name}</span>
              <span className="row-value num">{usd(r.totalCents)}</span>
            </Row>
          ))}
        </Group>
        <section className="group">
          <h2 className="group-title">Balance check</h2>
          <div className="receipt-wrap">
            <Receipts report={report} />
          </div>
        </section>
        <NextStep page="books" />
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
      <svg width="40" height="40" viewBox="0 0 64 64" role="img" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        <circle cx="32" cy="32" r="26" className="ring-bg" strokeWidth="7" fill="none" />
        <circle cx="32" cy="32" r="26" className="ring" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90 32 32)" />
      </svg>
      <div className="progress-text">
        <b>{STEPS[step]}</b>
        <span className="secondary num">
          Step {step + 1} of {STEPS.length} · {elapsed(now - books.startedAt)}
        </span>
      </div>
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
          <div className="pad">
            <Sk h={150} r={14} />
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
        </div>
      </>
    );
  return (
    <div className="page overview" aria-busy="true">
      {live && <Progress />}
      <div className="ov-head">
        <div className="sk-stack">
          <Sk w={260} h={26} r={8} />
          <Sk w={180} h={12} />
        </div>
      </div>
      <Sk h={84} r={12} />
      <div className="ov-grid">
        <section className="card sk-stack gap-lg ov-accounts">
          <Sk w={120} h={14} />
          {[90, 60, 30].map((w) => (
            <div className="sk-stack" key={w}>
              <Sk w="55%" h={10} />
              <Sk w={`${w}%`} h={6} r={99} />
            </div>
          ))}
        </section>
        <section className="card sk-stack gap-lg ov-months">
          <Sk w={120} h={14} />
          <div className="sk-bars">
            {[30, 55, 40, 75, 50, 90, 60, 35, 70].map((h, i) => (
              <Sk key={i} h={`${h}%`} r={4} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
