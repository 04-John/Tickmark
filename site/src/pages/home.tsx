// The way in: real books in one click (the demo), any treasury built live, and the headline across NEAR DAOs.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SignedReport } from '../../../core/report.ts';
import type { Network } from '../../../core/rpc.ts';
import { useBooks } from '../app.tsx';
import { demoReport, measure, priceRange, type Measure } from '../lib/data.ts';
import { go, href, usePhone } from '../lib/hooks.ts';
import { usd } from '../lib/format.ts';
import { Chevron, Group, Icon, Logo, Mark, Row, Segmented, Sk, Stat } from '../ui.tsx';

const EXAMPLES: [string, string, string][] = [
  ['daocubator.sputnik-dao.near', 'daocubator', 'about 40 s'],
  ['n1-treasury.sputnik-dao.near', 'Near One treasury', ''],
  ['braindao-treasury.sputnik-dao.near', 'BrainDAO', ''],
];

function useHomeData() {
  const [demo, setDemo] = useState<SignedReport | null>(null);
  const [m, setM] = useState<Measure | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    void demoReport().then(setDemo).catch(() => {});
    void measure().then(setM);
    void priceRange().then(setRange);
  }, []);
  return { demo, m, range };
}

function useBuild() {
  const books = useBooks();
  return (dao: string, network: Network, since?: string) => {
    if (!dao.trim()) return;
    books.build({ dao: dao.trim().toLowerCase(), network, since: since || undefined });
    go('books');
  };
}

function openDemo(books: ReturnType<typeof useBooks>) {
  if (books.source !== 'demo') books.openDemo();
  go('books');
}

function BuildForm({ range, compact }: { range: { from: string; to: string } | null; compact?: boolean }) {
  const build = useBuild();
  const [dao, setDao] = useState('');
  const [since, setSince] = useState('');
  const [network, setNetwork] = useState<Network>('mainnet');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    build(dao, network, since || range?.from);
  };
  return (
    <form className={`build ${compact ? 'compact' : ''}`} onSubmit={submit} autoComplete="off">
      <label className="field">
        <span>Sputnik DAO or Trezu treasury</span>
        <input className="input mono" required spellCheck={false} placeholder="name.sputnik-dao.near" value={dao} onChange={(e) => setDao(e.target.value)} />
      </label>
      <div className="build-row">
        <Segmented<Network>
          label="Network"
          value={network}
          onChange={setNetwork}
          options={[
            ['mainnet', 'Mainnet'],
            ['testnet', 'Testnet'],
          ]}
        />
        <label className="field inline">
          <span>From</span>
          <input className="input input-sm" type="date" min={range?.from} max={range?.to} value={since || range?.from || ''} onChange={(e) => setSince(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit">
          Build the books
        </button>
      </div>
      <p className="hint">Runs in your browser on public NEAR data. 20 seconds to 2 minutes. Nothing is signed.</p>
    </form>
  );
}

function DemoPreview({ demo }: { demo: SignedReport | null }) {
  const books = useBooks();
  const top = demo?.statement.rows.find((r) => r.section === 'expense');
  return (
    <button type="button" className="preview" onClick={() => openDemo(books)} aria-label="Open the demo treasury's books">
      <div className="preview-bar">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
        <span className="mono faint">{demo?.dao ?? 'tickmark-demo…'}</span>
        <span className="pill t-warn">Testnet</span>
      </div>
      <div className="preview-body">
        <span className="title-1">Where the money went</span>
        <div className="stats">
          {demo ? (
            <>
              <Stat label="Spending" value={usd(demo.statement.spendingCents)} />
              <Stat label="Not explained" value={usd(demo.statement.suspenseCents)} tone="pencil" />
              <Stat label="Balances" value={demo.balances.every((b) => b.status === 'ties') ? 'Tie out' : 'Gaps'} tone={demo.balances.every((b) => b.status === 'ties') ? 'ok' : 'pencil'} />
              <Stat label="Questions" value={demo.questions.length} />
            </>
          ) : (
            [0, 1, 2, 3].map((i) => (
              <div className="stat" key={i}>
                <Sk w="50%" h={10} />
                <Sk w="70%" h={26} r={8} />
              </div>
            ))
          )}
        </div>
        {top && demo ? (
          <div className="bar-row">
            <div className="bar-label">
              <span>{top.name}</span>
              <span className="num strong">{usd(top.totalCents)}</span>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.round((100 * top.totalCents) / Math.max(1, demo.statement.spendingCents + demo.statement.suspenseCents))}%` }} />
            </div>
          </div>
        ) : (
          <Sk h={10} />
        )}
      </div>
    </button>
  );
}

function Headline({ m }: { m: Measure | null }) {
  if (!m) return null;
  const share = Math.round(m.totals.unexplainedShare * 100);
  return (
    <div className="headline">
      <div className="card">
        <span className="big num">{usd(m.totals.paidOutUsd * 100)}</span>
        <span className="secondary">paid out by NEAR DAOs in the 12 months to {new Date(m.measuredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
      </div>
      <div className="card">
        <span className="big num">{m.totals.daosWithPayments}</span>
        <span className="secondary">DAOs measured from the public chain</span>
      </div>
      <div className="card ink">
        <span className="big num pencil-on-ink">{share}%</span>
        <span>with nothing on chain or in the proposal to explain it</span>
      </div>
    </div>
  );
}

function WebHome() {
  const { demo, m, range } = useHomeData();
  const build = useBuild();
  const buildRef = useRef<HTMLDivElement>(null);
  const how = useRef<HTMLElement>(null);
  const books = useBooks();
  return (
    <div className="home">
      <header className="home-nav">
        <div className="wrap">
          <Logo />
          <nav aria-label="Main">
            <button type="button" className="link-quiet" onClick={() => openDemo(books)}>
              Demo
            </button>
            <button type="button" className="link-quiet" onClick={() => how.current?.scrollIntoView({ behavior: 'smooth' })}>
              How it works
            </button>
            <a className="link-quiet" href={href('verify')}>
              Check a report
            </a>
            <a className="link-quiet" href="https://github.com/04-John/Tickmark">
              GitHub
            </a>
          </nav>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => buildRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            Build books
          </button>
        </div>
      </header>

      <section className="hero wrap">
        <span className="eyebrow">Built at NEAR HACKATHON</span>
        <h1>
          Books for every NEAR DAO.
          <br />
          <span className="muted">Checked against the chain.</span>
        </h1>
        <p className="lede">Every payment dated by the vote that paid it, valued at that day’s price, placed in an account. With the questions an auditor would ask.</p>
        <div className="actions center">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => openDemo(books)}>
            Open the demo books
          </button>
          <button type="button" className="btn btn-plain btn-lg" onClick={() => buildRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            Build any treasury ›
          </button>
        </div>
      </section>

      <section className="wrap preview-wrap">
        <DemoPreview demo={demo} />
      </section>

      {m && (
        <section className="wrap section">
          <h2 className="display-2">Most DAO spending says nothing about what it was for.</h2>
          <Headline m={m} />
        </section>
      )}

      <section className="wrap section" ref={buildRef as never}>
        <div className="card build-card">
          <div>
            <h2 className="display-3">Build any treasury.</h2>
            <p className="secondary">Pick a treasury, or try one of these.</p>
            <div className="examples">
              {EXAMPLES.map(([dao, name]) => (
                <button key={dao} type="button" className="link" onClick={() => build(dao, 'mainnet', range?.from)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <BuildForm range={range} />
        </div>
      </section>

      <section className="wrap section" ref={how}>
        <h2 className="display-2">One engine. Pinned to one block.</h2>
        <ol className="steps">
          {[
            ['Read', 'Proposals and policy at one block.'],
            ['Decode and date', 'Every payment, and the vote that paid it.'],
            ['Value and place', 'The day’s price, an account, the evidence.'],
            ['Check and ask', 'Balances against the chain, then questions.'],
            ['Sign', 'A SHA-256 fingerprint the council votes on.'],
          ].map(([t, d], i) => (
            <li key={t} className="card">
              <span className="eyebrow num">{i + 1}</span>
              <b>{t}</b>
              <span className="secondary">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="wrap home-foot">
        <span>No server · books anyone can rebuild · Tickmark never signs</span>
        <span>
          Open source (MIT) · <a href="https://github.com/04-John/Tickmark">github.com/04-John/Tickmark</a>
        </span>
      </footer>
    </div>
  );
}

function PhoneHome() {
  const { demo, m, range } = useHomeData();
  const books = useBooks();
  const build = useBuild();
  return (
    <div className="phone">
      <div className="pnav">
        <div className="pnav-lead" />
        <div className="pnav-title" />
        <div className="pnav-trail">
          <a href={href('verify')}>Verify</a>
        </div>
      </div>
      <div className="pscroll">
        <h1 className="large-title">Treasuries</h1>
        <div className="pad">
          <BuildForm range={range} compact />
        </div>
        <div className="pad">
          <button type="button" className="demo-card" onClick={() => openDemo(books)}>
            <div className="demo-top">
              <Mark size={44} />
              <span className="pill t-warn-ink">Testnet</span>
            </div>
            <b>See real books in one tap</b>
            <span className="demo-sub">The demo treasury, approved by vote. Opens instantly.</span>
            <div className="demo-stats">
              {demo ? (
                <>
                  <span>
                    <small>Spent</small>
                    <b className="num">{usd(demo.statement.spendingCents)}</b>
                  </span>
                  <span>
                    <small>Unexplained</small>
                    <b className="num pencil-on-ink">{usd(demo.statement.suspenseCents)}</b>
                  </span>
                  <span>
                    <small>Questions</small>
                    <b className="num">{demo.questions.length}</b>
                  </span>
                </>
              ) : (
                <Sk h={20} />
              )}
            </div>
          </button>
        </div>
        <Group title="Build live" footer="Books build on your phone from public NEAR data. Nothing is signed.">
          {EXAMPLES.map(([dao, name, note]) => (
            <Row key={dao} onClick={() => build(dao, 'mainnet', range?.from)} chevron={false}>
              <span className="row-icon">{name[0]!.toUpperCase()}</span>
              <span className="row-main">{name}</span>
              {note && <span className="row-value">{note}</span>}
              <Chevron />
            </Row>
          ))}
        </Group>
        {m && (
          <div className="pad">
            <div className="card">
              <span className="title-1 num">
                <span className="pencil">{Math.round(m.totals.unexplainedShare * 100)}%</span> of {usd(m.totals.paidOutUsd * 100)}
              </span>
              <p className="secondary">paid by {m.totals.daosWithPayments} NEAR DAOs in a year had nothing saying what it was for.</p>
            </div>
          </div>
        )}
        <div className="pad foot-links">
          <a href={href('verify')}>
            <Icon name="verify" size={16} /> Check a report
          </a>
          <a href="https://github.com/04-John/Tickmark">GitHub</a>
        </div>
      </div>
    </div>
  );
}

export function Home() {
  return usePhone() ? <PhoneHome /> : <WebHome />;
}
