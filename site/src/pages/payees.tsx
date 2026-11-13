// Payees: who the treasury paid, and for each one its payments, accounts, questions and any votes on its own pay.
import { CATEGORIES } from '../../../core/classify.ts';
import type { Payee } from '../../../core/payees.ts';
import type { SignedReport } from '../../../core/report.ts';
import { PhoneNav, useReport } from '../app.tsx';
import { day, plural, shortAccount, usd } from '../lib/format.ts';
import { href, usePhone } from '../lib/hooks.ts';
import { KIND, PAYEE_KIND } from '../lib/labels.ts';
import { Empty, Group, Pill, Row, Stat } from '../ui.tsx';

const initial = (p: Payee) => (p.kind === 'unnamed' ? '0x' : (p.account[0] ?? '?').toUpperCase());

function Avatar({ p, size = 32 }: { p: Payee; size?: number }) {
  return (
    <span className={`avatar ${p.kind === 'unnamed' ? 'pencil' : p.roles.length ? 'ink' : ''}`} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initial(p)}
    </span>
  );
}

function PayeeDetail({ p, report }: { p: Payee; report: SignedReport }) {
  const phone = usePhone();
  const lines = report.journal.filter((e) => e.payee === p.account);
  const questions = report.questions.filter((q) => q.payee === p.account);
  const [kind, tone] = PAYEE_KIND[p.kind];
  return (
    <div className="payee">
      <div className="payee-head">
        <Avatar p={p} size={phone ? 64 : 80} />
        <div className="payee-name">
          <h1 className="mono title-1 break" title={p.account}>
            {shortAccount(p.account)}
          </h1>
          <div className="chips-row">
            <Pill tone={tone}>{kind}</Pill>
            {p.roles.map((r) => (
              <Pill key={r} tone="ink">
                {r}
              </Pill>
            ))}
          </div>
        </div>
      </div>
      <div className="stats">
        <Stat label="Total paid" value={usd(p.cents)} note={p.unpriced ? `+${p.unpriced} without a price` : undefined} />
        <Stat label="Lines" value={p.lines} note={`${day(p.first)} – ${day(p.last)}`} />
        <Stat label="Accounts" value={<span className="stat-text">{p.categories.map((c) => CATEGORIES[c.category].name).join(', ')}</span>} />
        {p.votedOnOwn.length > 0 ? <Stat label="Voted on own pay" value={p.votedOnOwn.map((id) => `#${id}`).join(' ')} tone="pencil" /> : <Stat label="Questions" value={p.questions} tone={p.questions ? 'pencil' : 'plain'} />}
      </div>
      {questions.length > 0 && (
        <Group title="Questions about this payee">
          {questions.map((q) => (
            <Row key={q.id} href={href('questions', q.id)}>
              <span className="dot-mark" />
              <span className="row-two">
                <span className="strong">{KIND[q.kind]}</span>
                <span className="secondary small clamp-2">{q.ask}</span>
              </span>
            </Row>
          ))}
        </Group>
      )}
      <Group title="Payments">
        {lines.map((e) => (
          <Row key={e.ref} href={href('journal', e.ref)}>
            <span className="row-two">
              <span className="truncate">{e.memo ? `“${e.memo}”` : 'No description'}</span>
              <span className="secondary small num">
                {CATEGORIES[e.category].name} · {day(e.date)} · #{e.proposalId}
              </span>
            </span>
            <span className="row-value num strong">{usd(e.cents)}</span>
          </Row>
        ))}
      </Group>
    </div>
  );
}

export function Payees({ id }: { id?: string }) {
  const report = useReport();
  const phone = usePhone();
  const current = report.payees.find((p) => p.account === id) ?? (phone ? undefined : report.payees[0]);
  const list = report.payees.map((p) => (
    <Row key={p.account} href={href('payees', p.account)} className={!phone && current?.account === p.account ? 'on' : ''}>
      <Avatar p={p} />
      <span className="row-two">
        <span className="mono truncate">{shortAccount(p.account)}</span>
        <span className="secondary small">
          {plural(p.lines, 'line')}
          {p.roles.length ? ` · ${p.roles.join(', ')}` : ''}
          {p.questions ? ` · ${plural(p.questions, 'question')}` : ''}
        </span>
      </span>
      <span className="row-value num">{usd(p.cents)}</span>
    </Row>
  ));
  if (phone)
    return current ? (
      <>
        <PhoneNav back={href('payees')} backLabel="Payees" />
        <div className="pscroll">
          <PayeeDetail p={current} report={report} />
        </div>
      </>
    ) : (
      <>
        <PhoneNav back={href('books')} backLabel="Books" />
        <div className="pscroll">
          <div className="large-head">
            <h1 className="large-title">Payees</h1>
            <div className="sub secondary">Largest first. Moves within the treasury and swaps are left out.</div>
          </div>
          {report.payees.length ? <Group>{list}</Group> : <Empty title="No payees" />}
        </div>
      </>
    );
  return (
    <div className="split-list">
      <section className="side-list" aria-label="Payees">
        <div className="card-head">
          <h1 className="title-2">Payees</h1>
          <span className="faint">by total</span>
        </div>
        <div className="group-body">{list}</div>
      </section>
      <main className="page">{current ? <PayeeDetail p={current} report={report} /> : <Empty title="No payees">This treasury paid no one in the period.</Empty>}</main>
    </div>
  );
}
