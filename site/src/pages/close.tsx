// Close the books: the council approves this exact report with an ordinary Sputnik "Vote" proposal carrying its
// fingerprint. Tickmark drafts it and shows exactly what is signed; a council member signs it. Tickmark never signs.
import { useEffect, useState } from 'react';
import type { Closing } from '../../../core/closing.ts';
import { closingProposal, mayPropose, nearCliCommand } from '../../../core/closing.ts';
import type { DaoPolicy } from '../../../core/dao.ts';
import type { Network } from '../../../core/rpc.ts';
import { PhoneNav, useReport } from '../app.tsx';
import { NextStep } from '../guide.tsx';
import { closingsOf, policyOf } from '../lib/data.ts';
import { day, plural, usd } from '../lib/format.ts';
import { href, useAnswers, usePhone } from '../lib/hooks.ts';
import { Group, Icon, Pill, Row, Sk, Stamp } from '../ui.tsx';

const STEPS = ['Review', 'Proposal', 'Sign', 'Vote', 'Closed'];

function nearAmount(yocto: string): string {
  const milli = Number(BigInt(yocto) / 10n ** 21n);
  return `${(milli / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} NEAR`;
}

export function Close() {
  const report = useReport();
  const phone = usePhone();
  const network = report.network as Network;
  const { answers } = useAnswers(report.fingerprint);
  const [policy, setPolicy] = useState<DaoPolicy | null | undefined>(undefined);
  const [closings, setClosings] = useState<Closing[] | undefined>(undefined);
  const [signer, setSigner] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void policyOf(report.dao, network).then((p) => live && setPolicy(p));
    void closingsOf(report.dao, network).then((c) => live && setClosings(c));
    return () => {
      live = false;
    };
  }, [report, network]);

  const mine = closings?.filter((c) => c.fingerprint === report.fingerprint) ?? [];
  const approved = mine.find((c) => c.status === 'Approved');
  const pending = mine.find((c) => c.status === 'InProgress');
  const open = report.questions.filter((q) => !answers[q.id]?.answered).length;
  const step = approved ? 4 : pending ? 3 : 2;
  const call = policy ? closingProposal(report, policy) : null;
  const account = signer.trim();
  const may = policy && account ? mayPropose(policy, account) : null;
  const command = call ? nearCliCommand(call, account || '<your-account.near>', network) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the command stays selectable on screen */
    }
  };

  const summary = (
    <Group title="Summary">
      <Row>
        <span className="row-main">Spending</span>
        <span className="row-value num">
          {usd(report.statement.spendingCents)} · {plural(report.totals.lines, 'line')}
        </span>
      </Row>
      <Row>
        <span className="row-main">Not explained</span>
        <span className="row-value num pencil">{usd(report.statement.suspenseCents)}</span>
      </Row>
      <Row>
        <span className="row-main">Balances</span>
        <span className={`row-value ${report.balances.some((b) => b.status === 'unexplained_outflow') ? 'pencil' : 'ok'}`}>{report.balances.some((b) => b.status === 'unexplained_outflow') ? 'Gaps' : '✓ Tie out'}</span>
      </Row>
      <Row href={href('questions')}>
        <span className="row-main">Questions</span>
        <span className={`row-value num ${open ? 'pencil' : 'ok'}`}>{open ? `${open} open` : 'All answered'}</span>
      </Row>
    </Group>
  );

  if (approved)
    return (
      <>
        {phone && <PhoneNav />}
        <div className={phone ? 'pscroll' : 'page narrow'}>
          <div className="closed-hero">
            <div className="ledger-card">
              <Stamp id={approved.proposalId} block={report.asOf.block} />
            </div>
            <h1 className="title-xl">The council approved these books.</h1>
            <p className="secondary">Anyone with the link can rebuild them at this block and see the same fingerprint and this vote.</p>
          </div>
          <Group>
            <Row>
              <span className="row-main">Proposal</span>
              <span className="row-value num">
                #{approved.proposalId} · {approved.status}
              </span>
            </Row>
            <Row>
              <span className="row-main">Proposed by</span>
              <span className="row-value mono truncate">{approved.proposer}</span>
            </Row>
            <Row>
              <span className="row-main">Votes</span>
              <span className="row-value">{Object.values(approved.votes).filter((v) => v === 'Approve').length} approve · {Object.values(approved.votes).filter((v) => v !== 'Approve').length} other</span>
            </Row>
            <Row>
              <span className="row-main">Block</span>
              <span className="row-value num">{report.asOf.block.toLocaleString('en-US')}</span>
            </Row>
            <Row>
              <span className="row-main">Fingerprint</span>
              <span className="row-value mono">{report.fingerprint.slice(0, 12)}…</span>
            </Row>
          </Group>
          <div className={phone ? 'pad actions' : 'actions'}>
            <a className="btn btn-primary" href={href('verify')}>
              Check it yourself
            </a>
            <a className="btn btn-gray" href={href('books')}>
              Back to the books
            </a>
          </div>
          <NextStep page="close" />
        </div>
      </>
    );

  const proposal = (
    <Group title="Exactly what will be signed">
      {call ? (
        <>
          <Row>
            <span className="row-main">Proposal type</span>
            <span className="row-value">Sputnik “Vote”, moves no money</span>
          </Row>
          <Row>
            <span className="row-main">Treasury</span>
            <span className="row-value mono truncate">{report.dao}</span>
          </Row>
          <Row>
            <span className="row-main">Period</span>
            <span className="row-value num">
              {day(report.since)} – {day(report.asOf.time)}
            </span>
          </Row>
          <Row>
            <span className="row-main">Bond</span>
            <span className="row-value num strong">{nearAmount(call.deposit)}</span>
          </Row>
          <div className="proposal-text">
            {call.args.proposal.description.split(' <br>').map((line) => (
              <p key={line} className="mono">
                {line.replace(/^\* /, '')}
              </p>
            ))}
          </div>
        </>
      ) : policy === null ? (
        <Row>
          <span className="row-main wrap-text">The DAO’s policy could not be read, so the proposal can’t be drafted here. Use the command line: node cli/tickmark.ts close report.json</span>
        </Row>
      ) : (
        [0, 1, 2].map((i) => (
          <div className="row" key={i}>
            <Sk w="35%" h={12} />
            <Sk w="30%" h={12} />
          </div>
        ))
      )}
    </Group>
  );

  const sign = call && (
    <Group title="Sign it" footer="The bond comes back when the proposal passes. Tickmark never sees your key.">
      <div className="sign">
        <label className="field">
          <span>Your account</span>
          <input className="input mono" placeholder="your-account.near" spellCheck={false} autoCapitalize="off" value={signer} onChange={(e) => setSigner(e.target.value)} />
        </label>
        {may && (
          <p className={may.allowed ? 'ok small' : 'pencil small'}>
            {may.allowed ? `✓ ${account} may submit it (role: ${may.roles.join(', ')}).` : `${account} is not in a role that may add vote proposals here. A council member should submit it.`}
          </p>
        )}
        <p className="secondary small">Copy this one command and run it with near CLI in your terminal. It signs with your own key, after showing you the call.</p>
        <pre className="cmd">{command}</pre>
        <button type="button" className="btn btn-primary" onClick={copy}>
          <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy command'}
        </button>
      </div>
    </Group>
  );

  const follow = pending && (
    <Group title="Follow the vote">
      <Row>
        <span className="row-main">Proposal #{pending.proposalId}</span>
        <span className="row-value">
          <Pill tone="warn">Voting</Pill>
        </span>
      </Row>
      {Object.entries(pending.votes).map(([who, vote]) => (
        <Row key={who}>
          <span className="row-main mono truncate">{who}</span>
          <span className="row-value">{vote}</span>
        </Row>
      ))}
    </Group>
  );

  const stepper = (
    <ol className="stepper" aria-label="Where the vote is">
      {STEPS.map((s, i) => (
        <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="num">{i < step ? '✓' : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );

  if (phone)
    return (
      <>
        <PhoneNav title="Close the books" />
        <div className="pscroll">
          <div className="large-head">
            <h1 className="title-1">{pending ? 'The council is voting.' : 'Sign the closing proposal.'}</h1>
            <p className="secondary">One vote approves these exact books. Tickmark never signs.</p>
          </div>
          {follow}
          {summary}
          {proposal}
          {!pending && sign}
          <NextStep page="close" />
        </div>
      </>
    );

  return (
    <div className="page">
      {stepper}
      <div className="page-head">
        <div>
          <h1 className="title-xl">{pending ? 'The council is voting.' : 'Sign the closing proposal.'}</h1>
          <span className="secondary">One vote approves these exact books. Tickmark never signs.</span>
        </div>
      </div>
      <div className="split close-split">
        <div className="stack">
          {follow}
          {proposal}
          {!pending && sign}
        </div>
        <aside className="stack">
          {summary}
          {open > 0 && <div className="note-card warn">{plural(open, 'question is', 'questions are')} still open. The council will see that in the summary.</div>}
        </aside>
      </div>
      <NextStep page="close" />
    </div>
  );
}
