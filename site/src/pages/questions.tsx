// Questions as a work queue: each opens the payments it cites; the treasurer marks it answered and adds a note,
// kept in this browser and downloadable with the books. The signed report itself never changes.
import { useState } from 'react';
import { centsToString } from '../../../core/books.ts';
import { decimal, toCsv } from '../../../core/csv.ts';
import type { Question } from '../../../core/questions.ts';
import type { SignedReport } from '../../../core/report.ts';
import { PhoneNav, useReport } from '../app.tsx';
import { day, shortAccount, usd } from '../lib/format.ts';
import { go, href, useAnswers, usePhone, type Answer } from '../lib/hooks.ts';
import { KIND } from '../lib/labels.ts';
import { Empty, Group, Icon, MorphButton, Pill, Row, Segmented } from '../ui.tsx';

type Filter = 'open' | 'answered' | 'all';

/** Questions and the answers given in this browser, as a spreadsheet-safe CSV. */
export function answersCsv(report: SignedReport, answers: Record<string, Answer>): string {
  return toCsv(
    ['question_id', 'kind', 'question', 'proposals', 'payee', 'at_stake_usd', 'answered', 'answer', 'answered_at'],
    report.questions.map((q) => {
      const a = answers[q.id];
      return [q.id, q.kind, q.ask, q.proposals.map((p) => `#${p}`).join(' '), q.payee ?? '', q.cents === null ? null : decimal(centsToString(q.cents)), a?.answered ? 'yes' : 'no', a?.note ?? '', a?.answered ? a.at : ''];
    }),
  );
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const prefix = (report: SignedReport) => report.dao.split('.')[0];

function Detail({ q, report, onNext }: { q: Question; report: SignedReport; onNext?: () => void }) {
  const phone = usePhone();
  const { answers, save } = useAnswers(report.fingerprint);
  const a = answers[q.id];
  const [note, setNote] = useState(a?.note ?? '');
  const lines = report.journal.filter((e) => q.proposals.includes(e.proposalId) && (!q.payee || e.payee === q.payee));
  const answer = () => {
    save(q.id, { answered: true, note });
    onNext?.();
  };
  const body = (
    <>
      <div className="q-head">
        <Pill tone="pencil">
          {KIND[q.kind]}
          {q.cents !== null && ` · ${usd(q.cents)} at stake`}
        </Pill>
        <h2 className={phone ? 'title-1' : 'title-xl'}>{q.ask}</h2>
        {q.payee && (
          <a className="mono small" href={href('payees', q.payee)}>
            Payee: {shortAccount(q.payee)}
          </a>
        )}
      </div>
      {lines.length > 0 && (
        <Group title="Payments it cites">
          {lines.map((e) => (
            <Row key={e.ref} href={href('journal', e.ref)}>
              <span className="row-two">
                <span className="truncate">{e.memo ? `“${e.memo}”` : 'No description'}</span>
                <span className="secondary small mono">
                  {e.ref} · #{e.proposalId} · {day(e.date)}
                </span>
              </span>
              <span className="row-value num">
                {e.quantity} {e.symbol}
              </span>
            </Row>
          ))}
        </Group>
      )}
      <Group title="What Tickmark saw">
        {q.facts.map((f, i) => (
          <Row key={i}>
            <span className="row-main wrap-text">{f}</span>
          </Row>
        ))}
      </Group>
      <Group title="Your answer" footer="Kept in this browser and downloaded with the books. The signed report never changes.">
        <label className="visually-hidden" htmlFor="answer">
          Your answer
        </label>
        <textarea id="answer" className="note" placeholder="What happened? e.g. the second payment was the deposit for invoice 42." value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (a?.note ?? '') && save(q.id, { note })} />
      </Group>
    </>
  );
  const actions = a?.answered ? (
    <>
      <button type="button" className="btn btn-gray" onClick={() => save(q.id, { answered: false, note })}>
        Reopen
      </button>
      {onNext && (
        <button type="button" className="btn btn-plain" onClick={onNext}>
          Next question
        </button>
      )}
    </>
  ) : (
    <>
      <MorphButton tone="ok" label="Mark answered" hover={onNext ? 'Answered, next one' : 'Mark it answered'} icon="tick" onClick={answer} />
      {onNext && (
        <button type="button" className={phone ? 'btn btn-plain' : 'btn btn-gray'} onClick={onNext}>
          Skip for now
        </button>
      )}
    </>
  );
  if (phone)
    return (
      <>
        <div className="pscroll">{body}</div>
        <div className="bottom-actions">{actions}</div>
      </>
    );
  return (
    <div className="q-detail">
      {body}
      <div className="actions">
        {actions}
        <span className="faint small push">{a?.answered ? `Answered ${day(a.at)}` : 'Your notes save as you type'}</span>
      </div>
    </div>
  );
}

export function Questions({ id }: { id?: string }) {
  const report = useReport();
  const phone = usePhone();
  const { answers } = useAnswers(report.fingerprint);
  const [filter, setFilter] = useState<Filter>('open');
  const done = (q: Question) => !!answers[q.id]?.answered;
  const shown = report.questions.filter((q) => (filter === 'all' ? true : filter === 'open' ? !done(q) : done(q)));
  const openQs = report.questions.filter((q) => !done(q));
  const current = report.questions.find((q) => q.id === id) ?? (phone ? undefined : (shown[0] ?? report.questions[0]));
  const next = (from: Question) => {
    const rest = openQs.filter((q) => q.id !== from.id);
    const i = openQs.findIndex((q) => q.id === from.id);
    const target = rest[Math.max(0, i)] ?? rest[0];
    if (target) go('questions', target.id);
    else go('questions');
  };
  const doneCount = report.questions.length - openQs.length;
  const exportAnswers = () => downloadText(`${prefix(report)}-questions-and-answers.csv`, answersCsv(report, answers));

  const filterControl = (
    <Segmented<Filter>
      label="Show"
      value={filter}
      onChange={setFilter}
      options={[
        ['open', `Open · ${openQs.length}`],
        ['answered', `Answered · ${doneCount}`],
        ['all', 'All'],
      ]}
    />
  );

  const list = shown.map((q) => {
    const isDone = done(q);
    return phone ? (
      <Row key={q.id} href={href('questions', q.id)}>
        <span className={`dot-mark ${isDone ? 'ok' : ''}`} />
        <span className="row-two">
          <span className={`strong ${isDone ? 'struck' : ''}`}>{KIND[q.kind]}</span>
          <span className="secondary small clamp-2">{q.ask}</span>
        </span>
        {q.cents !== null && <span className="row-value num">{usd(q.cents)}</span>}
      </Row>
    ) : (
      <a key={q.id} href={href('questions', q.id)} className={`q-item ${current?.id === q.id ? 'on' : ''} ${isDone ? 'done' : ''}`} aria-current={current?.id === q.id ? 'true' : undefined}>
        <span className={`dot-mark ${isDone ? 'ok' : ''}`} />
        <span className="q-item-body">
          <span className="q-item-top">
            <span>{KIND[q.kind]}</span>
            {q.cents !== null && <span className="num">{usd(q.cents)}</span>}
          </span>
          <span className="clamp-2">{q.ask}</span>
        </span>
      </a>
    );
  });

  if (phone) {
    if (current)
      return (
        <>
          <PhoneNav back={href('questions')} backLabel="Questions" title={`${Math.max(1, openQs.findIndex((q) => q.id === current.id) + 1)} of ${openQs.length || report.questions.length}`} />
          <Detail key={current.id} q={current} report={report} onNext={() => next(current)} />
        </>
      );
    return (
      <>
        <PhoneNav>
          <button type="button" className="text-btn" onClick={exportAnswers}>
            Export
          </button>
        </PhoneNav>
        <div className="pscroll">
          <div className="large-head">
            <h1 className="large-title">Questions</h1>
            <div className="sub secondary num">
              {doneCount} of {report.questions.length} answered
            </div>
          </div>
          <div className="pad">{filterControl}</div>
          {shown.length ? (
            <Group footer="Answers stay on this device.">{list}</Group>
          ) : (
            <Empty title={filter === 'open' ? 'All answered' : 'Nothing here yet'}>{filter === 'open' ? 'Every question has an answer. Close the books when the council is ready.' : undefined}</Empty>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="q-layout">
      <section className="q-list" aria-label="Question list">
        <div className="q-list-head">
          <div className="card-head">
            <h1 className="title-xl">Questions</h1>
            <span className="faint num">
              {doneCount} of {report.questions.length} done
            </span>
          </div>
          {filterControl}
        </div>
        {list}
        {shown.length === 0 && <Empty title={filter === 'open' ? 'All answered' : 'Nothing here yet'} />}
        <button type="button" className="btn btn-gray btn-sm export" onClick={exportAnswers}>
          <Icon name="downloads" size={14} /> Download answers
        </button>
      </section>
      <main className="q-main">{current ? <Detail key={current.id} q={current} report={report} onNext={openQs.length > 1 || !done(current) ? () => next(current) : undefined} /> : <Empty title="No questions">Every payment was explained and the balances tie out.</Empty>}</main>
    </div>
  );
}
