// Check a report: rebuild it at its block from public data, compare fingerprints, and find the vote that approved it.
import { useState, type DragEvent } from 'react';
import type { SignedReport } from '../../../core/report.ts';
import { PhoneNav, useBooks } from '../app.tsx';
import { readReportFile, STEPS, verifyReport, type Verdict } from '../lib/data.ts';
import { elapsed } from '../lib/format.ts';
import { href, useNow, usePhone } from '../lib/hooks.ts';
import { Group, Icon, Row, Sk } from '../ui.tsx';

type State = { kind: 'idle' } | { kind: 'running'; report: SignedReport; step: number; started: number } | { kind: 'done'; report: SignedReport; verdict: Verdict } | { kind: 'error'; message: string };

function Running({ state }: { state: Extract<State, { kind: 'running' }> }) {
  const now = useNow(true);
  return (
    <section className="card verdict-card" aria-live="polite" aria-busy="true">
      <div className="verdict-top">
        <Sk w={64} h={64} r={99} />
        <b className="title-2">Rebuilding the books at block {state.report.asOf.block.toLocaleString('en-US')}</b>
        <span className="secondary num">
          {STEPS[Math.max(0, state.step)]} · {elapsed(now - state.started)} · reads an archival node, about 2 minutes
        </span>
      </div>
      <div className="facts-list">
        {[0, 1, 2].map((i) => (
          <div className="row" key={i}>
            <Sk w="35%" h={12} />
            <Sk w="30%" h={12} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Result({ report, v }: { report: SignedReport; v: Verdict }) {
  const books = useBooks();
  const good = v.same && v.intact;
  const closing = v.closings.find((c) => c.status === 'Approved') ?? v.closings[0];
  const openThese = () => {
    books.build({ dao: report.dao, network: report.network === 'testnet' ? 'testnet' : 'mainnet', since: report.since, block: report.asOf.block });
    location.hash = href('books');
  };
  return (
    <section className={`card verdict-card ${good ? 'good' : 'bad'}`} aria-live="polite">
      <div className="verdict-top">
        <span className={`verdict-icon ${good ? 'ok' : 'pencil'}`} aria-hidden="true">
          {good ? '✓' : '✕'}
        </span>
        <h2 className="title-1">{good ? (closing?.status === 'Approved' ? 'These books match the chain, and the council approved them.' : 'These books match the chain.') : v.intact ? 'These books don’t match the chain.' : 'This file was changed after it was made.'}</h2>
        <span className="secondary num">
          Rebuilt at block {report.asOf.block.toLocaleString('en-US')} in {elapsed(v.ms)}
          {closing ? ` · vote #${closing.proposalId} is ${closing.status === 'Approved' ? 'approved' : closing.status.toLowerCase()}` : ' · no vote carries this fingerprint yet'}
        </span>
        {good && (
          <button type="button" className="btn btn-ok" onClick={openThese}>
            Open these books
          </button>
        )}
      </div>
      <Group>
        <Row>
          <span className="row-main">Fingerprint in the file</span>
          <span className="row-value mono">{v.fileFingerprint.slice(0, 16)}…</span>
        </Row>
        <Row>
          <span className="row-main">Rebuilt from the chain</span>
          <span className={`row-value mono ${v.same ? 'ok' : 'pencil'}`}>
            {v.rebuiltFingerprint.slice(0, 16)}… {v.same ? '✓' : '✕'}
          </span>
        </Row>
        <Row>
          <span className="row-main">File unedited</span>
          <span className={`row-value ${v.intact ? 'ok' : 'pencil'}`}>{v.intact ? '✓ Yes' : '✕ Its content no longer hashes to its fingerprint'}</span>
        </Row>
        {v.difference && (
          <Row>
            <span className="row-main">First difference</span>
            <span className="row-value mono">{v.difference}</span>
          </Row>
        )}
        {v.versions.file !== v.versions.checker && (
          <Row>
            <span className="row-main wrap-text">
              Built by Tickmark {v.versions.file}, checked with {v.versions.checker}. Rebuild with the same version for the same fingerprint.
            </span>
          </Row>
        )}
      </Group>
    </section>
  );
}

export function Verify() {
  const phone = usePhone();
  const books = useBooks();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const run = async (report: SignedReport) => {
    const started = Date.now();
    setState({ kind: 'running', report, step: 0, started });
    try {
      const verdict = await verifyReport(report, (step) => step >= 0 && setState((s) => (s.kind === 'running' ? { ...s, step } : s)));
      setState({ kind: 'done', report, verdict });
    } catch (e) {
      setState({ kind: 'error', message: `Could not rebuild: ${(e as Error).message}` });
    }
  };
  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await run(await readReportFile(file));
    } catch (e) {
      setState({ kind: 'error', message: `This is not a Tickmark report.json (${(e as Error).message}).` });
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void fromFile(e.dataTransfer.files[0]);
  };
  const busy = state.kind === 'running';

  const inputs = (
    <div className="verify-inputs">
      <label className={`dropzone ${over ? 'over' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
        <Icon name="file" size={28} />
        <b>{phone ? 'Choose report.json' : 'Drop report.json'}</b>
        <span className="secondary small">{phone ? 'From Files or a download' : 'or click to choose a file'}</span>
        <input type="file" accept="application/json,.json" className="visually-hidden" disabled={busy} onChange={(e) => void fromFile(e.target.files?.[0])} />
      </label>
      {books.status === 'ready' && books.report && (
        <div className="card verify-current">
          <b>Check the books open now</b>
          <span className="secondary small mono truncate">{books.report.dao}</span>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(books.report!)}>
            Rebuild and compare
          </button>
        </div>
      )}
    </div>
  );

  const result = state.kind === 'running' ? <Running state={state} /> : state.kind === 'done' ? <Result report={state.report} v={state.verdict} /> : state.kind === 'error' ? <div className="card error-card" role="alert">{state.message}</div> : null;

  if (phone)
    return (
      <>
        <PhoneNav back={books.status === 'ready' ? href('books') : '#/'} backLabel={books.status === 'ready' ? 'Books' : 'Treasuries'} />
        <div className="pscroll">
          <div className="large-head">
            <h1 className="large-title">Verify</h1>
            <div className="sub secondary">Rebuild a report from the chain and find the vote that approved it.</div>
          </div>
          <div className="pad stack">
            {inputs}
            {result}
          </div>
        </div>
      </>
    );
  return (
    <div className="page narrow">
      <div className="verify-head">
        <h1 className="display-3">Are these the books the council approved?</h1>
        <p className="lede">Tickmark rebuilds the report at its block from public data, compares fingerprints, then finds the vote. Nothing is uploaded.</p>
      </div>
      {inputs}
      {result}
    </div>
  );
}
