// The journal: every paid line, searchable and groupable, with one line's evidence in an inspector (web) or a sheet (phone).
import { useMemo, useState } from 'react';
import type { JournalEntry } from '../../../core/books.ts';
import { CATEGORIES, type CategoryId } from '../../../core/classify.ts';
import type { SignedReport } from '../../../core/report.ts';
import { PhoneNav, useReport } from '../app.tsx';
import { explorer } from '../lib/data.ts';
import { day, exactUsd, month, plural, shortAccount, usd } from '../lib/format.ts';
import { go, href, usePhone } from '../lib/hooks.ts';
import { BASIS, DATE_SOURCE } from '../lib/labels.ts';
import { Empty, Group, Icon, Pill, Row, Segmented } from '../ui.tsx';

type GroupBy = 'none' | 'payee' | 'month' | 'account';

function useJournal(report: SignedReport, filterAccount: CategoryId | null) {
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [suspenseOnly, setSuspenseOnly] = useState(false);
  const [sort, setSort] = useState<'date' | 'amount'>('date');
  const lines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return report.journal
      .filter((e) => !filterAccount || e.category === filterAccount)
      .filter((e) => !suspenseOnly || e.section === 'suspense')
      .filter((e) => !q || [e.payee, e.memo, e.ref, `#${e.proposalId}`, e.quantity, e.symbol, CATEGORIES[e.category].name, CATEGORIES[e.category].code, e.cents === null ? '' : exactUsd(e.cents)].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (sort === 'amount' ? (b.cents ?? -1) - (a.cents ?? -1) : b.date.localeCompare(a.date) || b.proposalId - a.proposalId));
  }, [report, query, suspenseOnly, sort, filterAccount]);
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', title: '', lines }];
    const keyOf = (e: JournalEntry) => (groupBy === 'payee' ? e.payee : groupBy === 'month' ? e.date.slice(0, 7) : e.category);
    const titleOf = (k: string) => (groupBy === 'payee' ? shortAccount(k) : groupBy === 'month' ? month(k) : `${CATEGORIES[k as CategoryId].code} ${CATEGORIES[k as CategoryId].name}`);
    const map = new Map<string, JournalEntry[]>();
    for (const e of lines) map.set(keyOf(e), [...(map.get(keyOf(e)) ?? []), e]);
    return [...map].map(([key, ls]) => ({ key, title: titleOf(key), lines: ls }));
  }, [lines, groupBy]);
  return { query, setQuery, groupBy, setGroupBy, suspenseOnly, setSuspenseOnly, sort, setSort, lines, groups };
}

export function LineDetail({ entry, report, onClose }: { entry: JournalEntry; report: SignedReport; onClose?: () => void }) {
  const [basisLabel, basisTone] = BASIS[entry.basis];
  const [dateLabel, dateTone] = DATE_SOURCE[entry.dateSource];
  const cat = CATEGORIES[entry.category];
  const citing = report.questions.filter((q) => q.proposals.includes(entry.proposalId));
  return (
    <div className="line-detail">
      <div className="line-amount">
        <span className="title-xl num">{exactUsd(entry.cents)}</span>
        <span className="secondary num">
          {entry.quantity} {entry.symbol}
          {entry.unitPrice !== null ? ` × $${entry.unitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })} on ${entry.priceDate}` : ' · no trusted price'}
        </span>
        <a className="mono small" href={href('payees', entry.payee)}>
          to {shortAccount(entry.payee)}
        </a>
      </div>
      <div className="quote">
        <span className="faint small">The proposal says</span>
        {entry.memo ? <p>“{entry.memo}”</p> : <p className="faint">Nothing. The proposal has no description.</p>}
      </div>
      <dl className="facts">
        <div>
          <dt>Account</dt>
          <dd>
            {cat.code} {cat.name}
          </dd>
        </div>
        <div>
          <dt>Placed by</dt>
          <dd>
            <Pill tone={basisTone}>{basisLabel}</Pill>
          </dd>
        </div>
        <div className="wide">
          <dt>Why</dt>
          <dd>{entry.evidence}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd className="num">{day(entry.date)}</dd>
        </div>
        <div>
          <dt>Dated by</dt>
          <dd>
            <Pill tone={dateTone}>{dateLabel}</Pill>
          </dd>
        </div>
        <div>
          <dt>Proposal</dt>
          <dd className="num">#{entry.proposalId}</dd>
        </div>
        {entry.approvalTx && (
          <div>
            <dt>Transaction</dt>
            <dd>
              <a href={explorer(report.network, entry.approvalTx)} target="_blank" rel="noopener noreferrer">
                View on chain <Icon name="external" size={12} />
              </a>
            </dd>
          </div>
        )}
      </dl>
      {entry.lines.length > 0 && (
        <div className="entries">
          <span className="faint small">Balancing entries</span>
          <div className="entries-box num">
            {entry.lines.map((l) => (
              <div key={l.code + l.debitCents}>
                <span>
                  {l.debitCents ? 'Dr' : 'Cr'} {l.code} {l.account}
                </span>
                <span>{exactUsd(l.debitCents || l.creditCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {citing.length > 0 && (
        <a className="btn btn-pencil" href={href('questions', citing[0]!.id)} onClick={onClose}>
          {plural(citing.length, 'question')} cite{citing.length === 1 ? 's' : ''} this line
        </a>
      )}
    </div>
  );
}

function Controls({ j, phone }: { j: ReturnType<typeof useJournal>; phone?: boolean }) {
  return (
    <div className={`controls ${phone ? 'pad' : ''}`}>
      <label className="search">
        <Icon name="search" size={15} />
        <span className="visually-hidden">Search the journal</span>
        <input placeholder="Search payee, memo, amount" value={j.query} onChange={(e) => j.setQuery(e.target.value)} />
      </label>
      <Segmented<GroupBy>
        label="Group by"
        value={j.groupBy}
        onChange={j.setGroupBy}
        options={[
          ['none', phone ? 'Lines' : 'Lines'],
          ['payee', 'Payee'],
          ['month', 'Month'],
          ['account', 'Account'],
        ]}
      />
      {!phone && (
        <>
          <button type="button" className={`btn btn-sm ${j.suspenseOnly ? 'btn-pencil' : 'btn-gray'}`} aria-pressed={j.suspenseOnly} onClick={() => j.setSuspenseOnly(!j.suspenseOnly)}>
            Suspense only
          </button>
          <button type="button" className="btn btn-sm btn-gray" onClick={() => j.setSort(j.sort === 'date' ? 'amount' : 'date')}>
            Sort: {j.sort === 'date' ? 'newest' : 'largest'}
          </button>
        </>
      )}
    </div>
  );
}

export function Journal({ id }: { id?: string }) {
  const report = useReport();
  const phone = usePhone();
  const filterAccount = id?.startsWith('account:') ? (id.slice(8) as CategoryId) : null;
  const selectedRef = id && !filterAccount ? id : null;
  const j = useJournal(report, filterAccount);
  const selected = report.journal.find((e) => e.ref === selectedRef) ?? null;
  const total = j.lines.reduce((s, e) => s + (e.cents ?? 0), 0);
  const open = (ref: string) => go('journal', ref);
  const closeLine = () => go('journal', filterAccount ? `account:${filterAccount}` : undefined);

  if (phone)
    return (
      <>
        <PhoneNav back={filterAccount ? href('books') : undefined} backLabel="Books" />
        <div className="pscroll">
          <div className="large-head">
            <h1 className="large-title">{filterAccount ? CATEGORIES[filterAccount].name : 'Journal'}</h1>
            <div className="sub secondary num">
              {plural(j.lines.length, 'line')} · {usd(total)}
            </div>
          </div>
          <Controls j={j} phone />
          {j.groups.map((g) => (
            <Group key={g.key} title={g.title || undefined}>
              {g.lines.map((e) => (
                <Row key={e.ref} onClick={() => open(e.ref)} className={e.section === 'suspense' ? 'pencil' : ''}>
                  <span className="row-two">
                    <span className="mono truncate">{shortAccount(e.payee)}</span>
                    <span className="secondary small truncate">
                      {CATEGORIES[e.category].name} · {day(e.date)}
                    </span>
                  </span>
                  <span className="row-value num strong">{usd(e.cents)}</span>
                </Row>
              ))}
            </Group>
          ))}
          {j.lines.length === 0 && <Empty title="No lines match">Try another search.</Empty>}
        </div>
        {selected && (
          <div className="sheet-backdrop" onClick={closeLine}>
            <section className="sheet" role="dialog" aria-label={`Journal line ${selected.ref}`} onClick={(e) => e.stopPropagation()}>
              <span className="grabber" aria-hidden="true" />
              <div className="sheet-head">
                <span />
                <span className="mono">{selected.ref}</span>
                <button type="button" className="text-btn strong" onClick={closeLine}>
                  Done
                </button>
              </div>
              <div className="sheet-body">
                <LineDetail entry={selected} report={report} onClose={closeLine} />
              </div>
            </section>
          </div>
        )}
      </>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title-xl">{filterAccount ? CATEGORIES[filterAccount].name : 'Journal'}</h1>
          <span className="secondary num">
            {plural(j.lines.length, 'paid line')} · {usd(total)} · exact amounts, UTC dates
            {filterAccount && (
              <>
                {' · '}
                <a href={href('journal')}>Show all accounts</a>
              </>
            )}
          </span>
        </div>
      </div>
      <Controls j={j} />
      <div className="split">
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Account</th>
                <th className="r">Amount</th>
                <th className="r">USD</th>
              </tr>
            </thead>
            {j.groups.map((g) => (
              <tbody key={g.key}>
                {g.title && (
                  <tr className="group-row">
                    <td colSpan={4}>{g.title}</td>
                    <td className="r num">{usd(g.lines.reduce((s, e) => s + (e.cents ?? 0), 0))}</td>
                  </tr>
                )}
                {g.lines.map((e) => {
                  const [b, tone] = BASIS[e.basis];
                  const flagged = report.questions.some((q) => q.proposals.includes(e.proposalId));
                  return (
                    <tr key={e.ref} className={`${selected?.ref === e.ref ? 'selected' : ''} ${e.section === 'suspense' ? 'pencil' : ''}`} onClick={() => open(e.ref)}>
                      <td className="num faint">
                        <button type="button" className="row-link" onClick={() => open(e.ref)}>
                          {e.date}
                        </button>
                      </td>
                      <td className="mono truncate-cell" title={e.payee}>
                        {shortAccount(e.payee)} {flagged && <span className="flag" title="A question cites this line" />}
                      </td>
                      <td>
                        {CATEGORIES[e.category].name} <Pill tone={tone}>{b}</Pill>
                      </td>
                      <td className="r num">
                        {e.quantity} {e.symbol}
                      </td>
                      <td className="r num strong">{exactUsd(e.cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <td colSpan={4}>Total</td>
                <td className="r num">{exactUsd(total)}</td>
              </tr>
            </tfoot>
          </table>
          {j.lines.length === 0 && <Empty title="No lines match">Try another search or filter.</Empty>}
        </div>
        {selected ? (
          <aside className="card inspector" aria-label={`Line ${selected.ref}`}>
            <div className="card-head">
              <span className="mono faint">
                {selected.ref} · proposal #{selected.proposalId}
              </span>
              <button type="button" className="icon-btn round" aria-label="Close the line" onClick={closeLine}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <LineDetail entry={selected} report={report} />
          </aside>
        ) : (
          <aside className="card inspector placeholder">
            <Empty title="Choose a line">See the proposal’s words, why it was placed where it is, the paying transaction and both entries.</Empty>
          </aside>
        )}
      </div>
    </div>
  );
}
