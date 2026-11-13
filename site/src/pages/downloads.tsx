// Downloads: every file built in the browser from the signed report, grouped by who it is for, with a preview.
import { useMemo, useState } from 'react';
import { exportBooks, type ExportFile } from '../../../core/exports.ts';
import { PhoneNav, useReport } from '../app.tsx';
import { href, useAnswers, usePhone } from '../lib/hooks.ts';
import { Group, Icon, Row } from '../ui.tsx';
import { answersCsv, downloadText } from './questions.tsx';

type Meta = { title: string; note: string; group: 'software' | 'review' | 'proof'; badge?: string };

function metaOf(name: string): Meta {
  if (name === 'quickbooks-journal.csv') return { title: 'QuickBooks import', note: 'Journal entries in QuickBooks’ layout', group: 'software', badge: 'QB' };
  if (name.startsWith('xero-manual-journal')) return { title: `Xero import${name.match(/-(\d+)\.csv$/)?.[1] !== '1' ? ` (part ${name.match(/-(\d+)\.csv$/)?.[1]})` : ''}`, note: 'Manual journals', group: 'software', badge: 'X' };
  if (name === 'journal.csv') return { title: 'Journal', note: 'Every line, both entries and its evidence', group: 'software', badge: 'J' };
  if (name === 'chart-of-accounts.csv') return { title: 'Chart of accounts', note: 'Set these up first', group: 'software', badge: '#' };
  if (name === 'monthly-spending.csv') return { title: 'Monthly spending', note: 'Accounts down, months across', group: 'review' };
  if (name === 'balance-check.csv') return { title: 'Balance check', note: 'Opening to closing, per token and place', group: 'review' };
  if (name === 'payees.csv') return { title: 'Payees', note: 'Who was paid, roles, own-pay votes', group: 'review' };
  if (name === 'questions.csv') return { title: 'Questions', note: 'As the rules raised them', group: 'review' };
  if (name === 'questions-and-answers.csv') return { title: 'Questions and your answers', note: 'Answers from this browser', group: 'review' };
  if (name === 'about-these-files.txt') return { title: 'Guide to the files', note: 'Plain-language notes for your accountant', group: 'proof' };
  return { title: 'Signed report', note: 'report.json · anyone can check it', group: 'proof' };
}

/** A few rows of a CSV, for the preview. Handles quoted cells; the files themselves come from core/csv.ts. */
function previewRows(text: string, max = 7): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length && rows.length < max; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (rows.length < max && (cell || row.length)) rows.push([...row, cell]);
  return rows;
}

const TYPE = (name: string) => (name.endsWith('.json') ? 'application/json' : name.endsWith('.txt') ? 'text/plain' : 'text/csv');

export function Downloads() {
  const report = useReport();
  const phone = usePhone();
  const { answers } = useAnswers(report.fingerprint);
  const prefix = report.dao.split('.')[0];
  const files: ExportFile[] = useMemo(
    () => [
      ...exportBooks({
        dao: report.dao,
        network: report.network,
        since: report.since,
        entries: report.journal,
        statement: report.statement,
        questions: report.questions,
        balances: { checks: report.balances, openingBlock: report.opening.block, openingDate: report.since, closingBlock: report.asOf.block },
        payees: report.payees,
      }),
      { name: 'questions-and-answers.csv', content: answersCsv(report, answers) },
      { name: 'report.json', content: JSON.stringify(report, null, 2) },
    ],
    [report, answers],
  );
  const [chosen, setChosen] = useState('quickbooks-journal.csv');
  const file = files.find((f) => f.name === chosen) ?? files[0]!;
  const save = (f: ExportFile) => downloadText(`${prefix}-${f.name}`, f.content, TYPE(f.name));
  const saveAll = () => files.forEach((f, i) => setTimeout(() => save(f), i * 350));

  const groups: [Meta['group'], string][] = [
    ['software', 'For your accounting software'],
    ['review', 'For review'],
    ['proof', 'Start here · proof'],
  ];
  const rowFor = (f: ExportFile) => {
    const m = metaOf(f.name);
    return (
      <Row key={f.name} onClick={() => (phone ? save(f) : setChosen(f.name))} className={!phone && chosen === f.name ? 'on' : ''} chevron={false}>
        {m.badge ? <span className="file-badge">{m.badge}</span> : <span className="file-badge plain"><Icon name="file" size={16} /></span>}
        <span className="row-two">
          <span className="strong">{m.title}</span>
          <span className="secondary small">{m.note}</span>
        </span>
        <span className="row-value small mono">{f.name.split('.').pop()?.toUpperCase()}</span>
        {phone && <Icon name="downloads" size={18} className="link-c" />}
      </Row>
    );
  };

  const lists = groups.map(([g, title]) => (
    <Group key={g} title={title}>
      {files.filter((f) => metaOf(f.name).group === g).map(rowFor)}
    </Group>
  ));

  if (phone)
    return (
      <>
        <PhoneNav back={href('books')} backLabel="Books" />
        <div className="pscroll">
          <div className="large-head">
            <h1 className="large-title">Downloads</h1>
            <div className="sub secondary">Built on this phone from the signed report. Tap a file to save it.</div>
          </div>
          {lists}
        </div>
      </>
    );

  const preview = file.name.endsWith('.csv') ? previewRows(file.content) : null;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title-xl">Hand the books to accounting</h1>
          <span className="secondary">Every file is built in your browser from the signed report. Spreadsheet-safe CSV.</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={saveAll}>
          Download all
        </button>
      </div>
      <div className="split">
        <div className="stack">{lists}</div>
        <aside className="card preview-card" aria-label={`Preview of ${file.name}`}>
          <div className="card-head">
            <div>
              <b>{metaOf(file.name).title}</b>
              <div className="faint small mono">{prefix}-{file.name}</div>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => save(file)}>
              Download
            </button>
          </div>
          {preview ? (
            <div className="scroll-x">
              <table className="table mini">
                <thead>
                  <tr>
                    {preview[0]?.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1).map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className="num">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="text-preview">{file.content.slice(0, 1600)}</pre>
          )}
          <p className="secondary small">{file.name.endsWith('.csv') ? 'First rows only. Set up the chart of accounts before importing; the guide to the files explains every column.' : 'Shown as plain text, exactly as downloaded.'}</p>
        </aside>
      </div>
    </div>
  );
}
