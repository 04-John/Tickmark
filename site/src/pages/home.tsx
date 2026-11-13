// The way in: real books in one click (the demo), any treasury built live, and the headline across NEAR DAOs.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SignedReport } from '../../../core/report.ts';
import type { Network } from '../../../core/rpc.ts';
import { useBooks } from '../app.tsx';
import { daoName, demoReport, measure, priceRange, type Measure } from '../lib/data.ts';
import { go, href, usePhone, useTheme } from '../lib/hooks.ts';
import { usd } from '../lib/format.ts';
import { Chevron, Group, Icon, Logo, Mark, MorphButton, Row, Segmented, Sk, Stat, ThemeButton } from '../ui.tsx';

export const EXAMPLES: [string, string, string][] = [
  ['daocubator.sputnik-dao.near', 'daocubator', ''],
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
    books.build({ dao: daoName(dao, network), network, since: since || undefined });
    go('books');
  };
}

export function openDemo(books: ReturnType<typeof useBooks>) {
  if (books.source !== 'demo') books.openDemo();
  go('books');
}

export function BuildForm({ range, compact, onStart }: { range: { from: string; to: string } | null; compact?: boolean; onStart?: () => void }) {
  const build = useBuild();
  const [dao, setDao] = useState('');
  const [since, setSince] = useState('');
  const [network, setNetwork] = useState<Network>('mainnet');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dao.trim()) return;
    onStart?.();
    build(dao, network, since || range?.from);
  };
  return (
    <form className={`build ${compact ? 'compact' : ''}`} onSubmit={submit} autoComplete="off">
      <label className="field">
        <span>DAO name</span>
        <input className="input" required spellCheck={false} autoCapitalize="off" placeholder="e.g. daocubator" value={dao} onChange={(e) => setDao(e.target.value)} />
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
          Look it up
        </button>
      </div>
      <p className="hint">Any Sputnik DAO or Trezu treasury. Free, runs in your browser, ready in under 2 minutes.</p>
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
              <Stat label="Adds up on chain" value={demo.balances.every((b) => b.status === 'ties') ? 'Yes' : 'Gaps'} tone={demo.balances.every((b) => b.status === 'ties') ? 'ok' : 'pencil'} />
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
        <span className="secondary">DAOs that paid out, measured from the public chain</span>
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
  const [theme, toggleTheme] = useTheme();
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
            <a className="link-quiet" href={href('welcome')}>
              Guide
            </a>
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
          <span className="home-nav-end">
            <ThemeButton theme={theme} onToggle={toggleTheme} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => buildRef.current?.scrollIntoView({ behavior: 'smooth' })}>
              Look up a DAO
            </button>
          </span>
        </div>
      </header>

      <section className="hero wrap">
        <span className="eyebrow">Built at NEAR HACKATHON</span>
        <h1>
          See where a DAO’s money went.
          <br />
          <span className="muted">And what nobody has explained.</span>
        </h1>
        <p className="lede">Type a DAO’s name. Tickmark reads every payment it made from the NEAR blockchain, sorts them into plain categories like pay and grants, and lists the ones no one has explained yet.</p>
        <p className="hero-aside">A DAO is a group that shares one wallet on NEAR and approves each payment by vote.</p>
        <div className="actions center">
          <MorphButton label="See an example" hover="Opens instantly" icon="arrow" size="lg" onClick={() => openDemo(books)} />
          <button type="button" className="btn btn-plain btn-lg" onClick={() => buildRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            Look up a DAO ›
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
            <h2 className="display-3">Look up a DAO.</h2>
            <p className="secondary">Type its name, or try one of these.</p>
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
        <h2 className="display-2">How Tickmark works</h2>
        <p className="lede">Five steps, all in your browser, from public NEAR data. Tickmark only reads: it never moves money or signs anything.</p>
        <ol className="steps">
          {[
            ['Read the treasury', 'Every proposal and vote, as of one moment on chain.'],
            ['Find each payment', 'And the vote that actually paid it, for its date.'],
            ['Price and file it', 'In dollars on that day, in an account, with the reason.'],
            ['Check and ask', 'Does the money add up? What needs a human answer?'],
            ['Seal it', 'A fingerprint the council approves with one vote.'],
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
  const [theme, toggleTheme] = useTheme();
  const books = useBooks();
  const build = useBuild();
  return (
    <div className="phone">
      <div className="pnav">
        <div className="pnav-lead">
          <a className="pnav-link" href={href('welcome')}>
            Guide
          </a>
        </div>
        <div className="pnav-title" />
        <div className="pnav-trail">
          <ThemeButton theme={theme} onToggle={toggleTheme} className="icon-btn" />
          <a href={href('verify')}>Verify</a>
        </div>
      </div>
      <div className="pscroll">
        <div className="large-head">
          <h1 className="large-title">Tickmark</h1>
          <p className="secondary">See where a DAO’s money went, and what nobody has explained. A DAO is a group that shares one wallet on NEAR and votes on each payment.</p>
        </div>
        <div className="pad">
          <button type="button" className="demo-card" onClick={() => openDemo(books)}>
            <div className="demo-top">
              <Mark size={44} />
              <span className="pill t-warn-ink">Testnet</span>
            </div>
            <b>See an example</b>
            <span className="demo-sub">A real DAO on NEAR’s test network. Opens instantly.</span>
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
        <section className="group">
          <h2 className="group-title">Look up a DAO</h2>
          <div className="build-card-phone">
            <BuildForm range={range} compact />
          </div>
        </section>
        <Group title="Or try one of these" footer="Books build on your phone from public NEAR data. Nothing is signed.">
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
          <a href={href('welcome')}>
            <Icon name="info" size={16} /> How Tickmark works
          </a>
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
