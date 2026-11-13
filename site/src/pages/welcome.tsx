// The guide: three welcome screens, shown once on a first visit and from "Guide" any time after.
// 1. What Tickmark is. 2. The four steps and where they live. 3. Where to start: the demo, a treasury, or a report.
// Every number on it is read from the committed demo report and the 92-DAO measurement, never written in.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { SignedReport } from '../../../core/report.ts';
import { useBooks } from '../app.tsx';
import { FLOW, markWelcomed } from '../guide.tsx';
import { demoReport, measure, priceRange, type Measure } from '../lib/data.ts';
import { plural, usd } from '../lib/format.ts';
import { go, previousHash, usePhone } from '../lib/hooks.ts';
import { Chevron, Icon, Mark } from '../ui.tsx';
import { BuildForm, openDemo } from './home.tsx';

const SCREENS = 3;

function Feature({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <li>
      <span className="glyph" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <span>
        <b>{title}</b>
        <span>{children}</span>
      </span>
    </li>
  );
}

function Choice({ icon, title, tag, children, onClick, expanded, primary }: { icon: string; title: string; tag?: string; children: ReactNode; onClick: () => void; expanded?: boolean; primary?: boolean }) {
  return (
    <button type="button" className={`choice ${primary ? 'primary' : ''}`} onClick={onClick} aria-expanded={expanded}>
      <span className="glyph" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <span className="choice-text">
        <b>
          {title} {tag && <span className="tag">{tag}</span>}
        </b>
        <span className="secondary">{children}</span>
      </span>
      <span className={`choice-chev ${expanded ? 'open' : ''}`}>
        <Chevron />
      </span>
    </button>
  );
}

export function Welcome({ first }: { first?: boolean }) {
  const phone = usePhone();
  const books = useBooks();
  const [screen, setScreen] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [building, setBuilding] = useState(false);
  const [demo, setDemo] = useState<SignedReport | null>(null);
  const [m, setM] = useState<Measure | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    void demoReport().then(setDemo).catch(() => {});
    void measure().then(setM);
    void priceRange().then(setRange);
  }, []);
  // Moving between screens puts focus on the new heading, so a screen reader reads it; not on first load.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [screen]);

  const to = (n: number) => {
    const target = Math.max(0, Math.min(SCREENS - 1, n));
    if (target === screen) return;
    moved.current = true;
    setDir(target > screen ? 'next' : 'prev');
    setScreen(target);
  };
  const leave = () => {
    markWelcomed();
    if (first) return; // the home page replaces the guide
    const back = previousHash();
    if (back && back !== '#/welcome' && back !== '#/' && back !== '#') location.hash = back;
    else go('');
  };
  const startDemo = () => {
    markWelcomed();
    openDemo(books);
  };
  const startVerify = () => {
    markWelcomed();
    go('verify');
  };
  const key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') to(screen + 1);
    else if (e.key === 'ArrowLeft') to(screen - 1);
    else if (e.key === 'Escape') leave();
  };

  const share = m ? Math.round(m.totals.unexplainedShare * 100) : null;
  const measuredTo = m ? new Date(m.measuredAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

  const screens = [
    <>
      <div className="wel-hero">
        <Mark size={phone ? 64 : 76} />
        <h1 ref={heading} tabIndex={-1}>
          Welcome to Tickmark
        </h1>
        <p>See where a DAO’s money went, and what nobody has explained yet. A DAO is a group that shares one wallet on NEAR and approves each payment by vote.</p>
      </div>
      <ul className="wel-features">
        <Feature icon="overview" title="See where the money went">
          Every payment the DAO made, sorted into plain categories like pay and grants, in dollars.
        </Feature>
        <Feature icon="questions" title="Spot what needs explaining">
          Payments with no reason given, possible double payments, people approving their own pay.
        </Feature>
        <Feature icon="close" title="Approve it together">
          The DAO’s members approve the final books with one ordinary vote. No money moves.
        </Feature>
        <Feature icon="verify" title="Check it yourself">
          Everything comes from the public blockchain, in your browser. Anyone can rebuild the same books.
        </Feature>
      </ul>
      {m && share !== null && (
        <p className="wel-fact">
          In the year to {measuredTo}, {m.totals.daosWithPayments} NEAR DAOs paid out <b>{usd(m.totals.paidOutUsd * 100)}</b>. For <b>{share}%</b> of it, nothing on chain or in the proposal said what it was for.
        </p>
      )}
    </>,
    <>
      <div className="wel-hero">
        <h1 ref={heading} tabIndex={-1}>
          Four steps, always in the same place
        </h1>
        <p>{phone ? 'The tabs at the bottom take you to each one, and More lists all four.' : 'They are numbered in the sidebar, in order.'} Every page ends with a Next button, so you always know where to go.</p>
      </div>
      <ol className="wel-path">
        {FLOW.map((s, i) => (
          <li key={s.page}>
            <i className="step-num now num">{i + 1}</i>
            <span>
              <b>{s.title}</b>
              <span>{s.why}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="wel-tip">
        <Icon name="search" size={18} />
        <span>
          Looking for one payment or person? <b>Journal</b> lists every payment and <b>Payees</b> lists who was paid.
          {!phone && (
            <>
              {' '}
              Press <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd> to search everything.
            </>
          )}
        </span>
      </p>
    </>,
    <>
      <div className="wel-hero">
        <h1 ref={heading} tabIndex={-1}>
          Where would you like to start?
        </h1>
        <p>You can open this guide again any time from {phone ? 'More' : 'Guide, at the top of every page'}.</p>
      </div>
      <div className="wel-choices">
        <Choice icon="overview" title="See an example" tag="Opens instantly" onClick={startDemo} primary>
          A real DAO on NEAR’s test network, with problems planted on purpose.
          {demo ? ` Tickmark raises ${plural(demo.questions.length, 'question')} about it.` : ''}
        </Choice>
        <div className={`choice-wrap ${building ? 'open' : ''}`}>
          <Choice icon="search" title="Look up a DAO" onClick={() => setBuilding(!building)} expanded={building}>
            Type a DAO’s name, like daocubator. Ready in under 2 minutes.
          </Choice>
          {building && (
            <div className="choice-build">
              <BuildForm range={range} compact onStart={markWelcomed} />
            </div>
          )}
        </div>
        <Choice icon="verify" title="Check a report someone sent you" onClick={startVerify}>
          Rebuild it from the chain and see whether the council approved it.
        </Choice>
      </div>
    </>,
  ];

  return (
    <div className="welcome" onKeyDown={key}>
      <section className="wel-card" aria-roledescription="guide" aria-label={`Welcome guide, screen ${screen + 1} of ${SCREENS}`}>
        <div className="wel-top">
          {screen > 0 ? (
            <button type="button" className="text-btn wel-back" onClick={() => to(screen - 1)}>
              <Icon name="back" size={18} /> Back
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="text-btn" onClick={leave}>
            {first ? 'Skip' : 'Close'}
          </button>
        </div>
        <div key={screen} className={`wel-body wel-${dir}`}>
          {screens[screen]}
        </div>
        <div className="wel-foot">
          <div className="wel-dots" role="group" aria-label="Screens">
            {Array.from({ length: SCREENS }, (_, i) => (
              <button key={i} type="button" className={i === screen ? 'on' : ''} aria-label={`Screen ${i + 1} of ${SCREENS}`} aria-current={i === screen ? 'step' : undefined} onClick={() => to(i)} />
            ))}
          </div>
          {screen < SCREENS - 1 ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => to(screen + 1)}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn btn-plain" onClick={leave}>
              {first ? 'Just look around' : 'Back to where I was'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
