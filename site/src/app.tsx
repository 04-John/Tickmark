// The app: which books are open (the demo, or a treasury built live), the hash route, and the two shells.
// Web gets a toolbar and a source-list sidebar; phones get an iOS-style tab bar and each page draws its own nav bar.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SignedReport } from '../../core/report.ts';
import { buildBooks, demoReport, type RunRequest } from './lib/data.ts';
import { go, href, useAnswers, usePhone, useRoute } from './lib/hooks.ts';
import { Icon, Mark, MorphButton, NetworkPill } from './ui.tsx';
import { Palette, SearchButton, usePaletteShortcut } from './palette.tsx';
import { Home } from './pages/home.tsx';
import { Overview, LoadingBooks } from './pages/overview.tsx';
import { Questions } from './pages/questions.tsx';
import { Journal } from './pages/journal.tsx';
import { Payees } from './pages/payees.tsx';
import { Downloads } from './pages/downloads.tsx';
import { Close } from './pages/close.tsx';
import { Verify } from './pages/verify.tsx';

// ---------------------------------------------------------------- the open books

export type BooksState = {
  status: 'loading' | 'ready' | 'error';
  source: 'demo' | 'live';
  request?: RunRequest;
  report?: SignedReport;
  step: number;
  message: string;
  startedAt: number;
  error?: string;
};

type BooksApi = BooksState & { build: (req: RunRequest) => void; openDemo: () => void; cancel: () => void };

const BooksContext = createContext<BooksApi | null>(null);
export const useBooks = () => useContext(BooksContext)!;

/** The open books when they are ready (pages under the books shell only render then). */
export const useReport = () => useBooks().report!;

function requestFromUrl(): RunRequest | null {
  const p = new URLSearchParams(location.search);
  const dao = p.get('dao')?.trim().toLowerCase();
  if (!dao) return null;
  const block = Number(p.get('block'));
  return { dao, network: p.get('network') === 'testnet' ? 'testnet' : 'mainnet', since: p.get('since') ?? undefined, block: Number.isSafeInteger(block) && block > 0 ? block : undefined };
}

function urlFor(req: RunRequest | null, block?: number): string {
  if (!req) return location.pathname + location.hash;
  const p = new URLSearchParams({ dao: req.dao });
  if (req.network === 'testnet') p.set('network', 'testnet');
  if (req.since) p.set('since', req.since);
  if (block ?? req.block) p.set('block', String(block ?? req.block));
  return `${location.pathname}?${p}${location.hash}`;
}

function BooksProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BooksState>({ status: 'loading', source: 'demo', step: -1, message: '', startedAt: Date.now() });
  const run = useRef(0);

  const openDemo = useCallback(() => {
    const id = ++run.current;
    history.replaceState(null, '', urlFor(null));
    setState({ status: 'loading', source: 'demo', step: -1, message: 'opening the demo books', startedAt: Date.now() });
    demoReport()
      .then((report) => id === run.current && setState((s) => ({ ...s, status: 'ready', report })))
      .catch((e: Error) => id === run.current && setState((s) => ({ ...s, status: 'error', error: e.message })));
  }, []);

  const build = useCallback((req: RunRequest) => {
    const id = ++run.current;
    history.replaceState(null, '', urlFor(req));
    setState({ status: 'loading', source: 'live', request: req, step: 0, message: `reading ${req.dao}`, startedAt: Date.now() });
    buildBooks(req, (step, message) => id === run.current && setState((s) => ({ ...s, step: step < 0 ? s.step : step, message })))
      .then((report) => {
        if (id !== run.current) return;
        history.replaceState(null, '', urlFor(req, report.asOf.block));
        setState((s) => ({ ...s, status: 'ready', report }));
      })
      .catch((e: Error) => id === run.current && setState((s) => ({ ...s, status: 'error', error: e.message })));
  }, []);

  const cancel = useCallback(() => {
    openDemo();
    go('');
  }, [openDemo]);

  useEffect(() => {
    const req = requestFromUrl();
    if (req) {
      build(req);
      if (!location.hash || location.hash === '#/') go('books');
    } else openDemo();
  }, [build, openDemo]);

  return <BooksContext.Provider value={{ ...state, build, openDemo, cancel }}>{children}</BooksContext.Provider>;
}

// ---------------------------------------------------------------- shells

/** The source list, grouped by relationship: the books, who and what they hand on, and approving them. */
const NAV: [string, [string, string, string][]][] = [
  [
    'Books',
    [
      ['books', 'Overview', 'overview'],
      ['questions', 'Questions', 'questions'],
      ['journal', 'Journal', 'journal'],
    ],
  ],
  [
    'Hand on',
    [
      ['payees', 'Payees', 'payees'],
      ['downloads', 'Downloads', 'downloads'],
    ],
  ],
  [
    'Approve',
    [
      ['close', 'Close the books', 'close'],
      ['verify', 'Check a report', 'verify'],
    ],
  ],
];

function Sidebar({ page }: { page: string }) {
  const books = useBooks();
  const report = books.report;
  const { answers } = useAnswers(report?.fingerprint ?? 'none');
  const open = report ? report.questions.filter((q) => !answers[q.id]?.answered).length : 0;
  const count = (p: string) => {
    if (!report) return null;
    if (p === 'questions') return open ? <span className="count pencil">{open}</span> : <span className="count ok">✓</span>;
    if (p === 'journal') return <span className="count">{report.journal.length}</span>;
    if (p === 'payees') return <span className="count">{report.payees.length}</span>;
    return null;
  };
  return (
    <nav className="side" aria-label="Books">
      {NAV.map(([head, items]) => (
        <div key={head} className="side-group">
          <span className="side-head">{head}</span>
          {items.map(([p, label, icon]) => (
            <a key={p} href={href(p)} className={page === p ? 'on' : ''} aria-current={page === p ? 'page' : undefined}>
              <Icon name={icon} className={p === 'questions' && open ? 'pencil' : ''} />
              <span>{label}</span>
              {count(p)}
            </a>
          ))}
        </div>
      ))}
      <span className="spacer" />
      {report && (
        <div className="side-card">
          <b>Signed report</b>
          <span className="num">Block {report.asOf.block.toLocaleString('en-US')}</span>
          <span className="mono">{report.fingerprint.slice(0, 12)}…</span>
          <span className="faint">Sort, filter and add notes. The books themselves never change.</span>
        </div>
      )}
    </nav>
  );
}

function Toolbar() {
  const books = useBooks();
  const dao = books.report?.dao ?? books.request?.dao;
  const network = books.report?.network ?? books.request?.network ?? 'testnet';
  return (
    <header className="toolbar">
      <a className="logo" href="#/" aria-label="Tickmark home">
        <Mark size={28} />
      </a>
      {dao && (
        <a className="treasury mono" href="#/" title="Open another treasury">
          {dao}
        </a>
      )}
      {dao && <NetworkPill network={network} />}
      {books.source === 'demo' && books.status === 'ready' && <span className="faint hide-sm">Demo treasury</span>}
      <span className="spacer" />
      <SearchButton />
      <MorphButton href={href('close')} label="Close the books" hover="Put it to a vote" icon="tick" size="sm" />
    </header>
  );
}

const TABS: [string, string, string][] = [
  ['books', 'Books', 'overview'],
  ['questions', 'Questions', 'questions'],
  ['journal', 'Journal', 'journal'],
  ['close', 'Approve', 'close'],
];

function TabBar({ page }: { page: string }) {
  const books = useBooks();
  const { answers } = useAnswers(books.report?.fingerprint ?? 'none');
  const open = books.report ? books.report.questions.filter((q) => !answers[q.id]?.answered).length : 0;
  return (
    <nav className="tabbar" aria-label="Tabs">
      {TABS.map(([p, label, icon]) => (
        <a key={p} href={href(p)} className={page === p ? 'on' : ''} aria-current={page === p ? 'page' : undefined}>
          <span className="tab-icon">
            <Icon name={icon} size={25} />
            {p === 'questions' && open > 0 && <span className="badge num">{open}</span>}
          </span>
          {label}
        </a>
      ))}
    </nav>
  );
}

/** The phone nav bar: a back link, an optional centred title, and trailing actions. */
export function PhoneNav({ back, backLabel, title, children }: { back?: string; backLabel?: string; title?: string; children?: ReactNode }) {
  return (
    <div className="pnav">
      <div className="pnav-lead">
        {back && (
          <a href={back} className="pnav-back">
            <Icon name="back" size={22} />
            {backLabel}
          </a>
        )}
      </div>
      <div className="pnav-title">{title}</div>
      <div className="pnav-trail">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- pages

const BOOK_PAGES = new Set(['books', 'questions', 'journal', 'payees', 'downloads', 'close']);

function BooksPage({ page, id }: { page: string; id?: string }) {
  const books = useBooks();
  if (books.status === 'loading') return <LoadingBooks />;
  if (books.status === 'error') return <BuildError />;
  switch (page) {
    case 'questions':
      return <Questions id={id} />;
    case 'journal':
      return <Journal id={id} />;
    case 'payees':
      return <Payees id={id} />;
    case 'downloads':
      return <Downloads />;
    case 'close':
      return <Close />;
    default:
      return <Overview />;
  }
}

function BuildError() {
  const books = useBooks();
  return (
    <div className="page">
      <div className="card error-card" role="alert">
        <h1 className="title-2">Couldn’t build the books</h1>
        <p className="secondary">{books.error}</p>
        <p className="secondary">The free NEAR endpoints rate-limit busy moments. Trying again usually works.</p>
        <div className="actions">
          {books.request && (
            <button className="btn btn-primary" type="button" onClick={() => books.build(books.request!)}>
              Try again
            </button>
          )}
          <button className="btn btn-gray" type="button" onClick={books.cancel}>
            Open the demo instead
          </button>
        </div>
      </div>
    </div>
  );
}

function Screen() {
  const { page, id } = useRoute();
  const phone = usePhone();
  const isBooks = BOOK_PAGES.has(page);

  if (page === '') return <Home />;
  if (page === 'verify')
    return phone ? (
      <div className="phone">
        <Verify />
      </div>
    ) : (
      <div className="web">
        <Toolbar />
        <div className="frame">
          <Sidebar page={page} />
          <main className="main">
            <Verify />
          </main>
        </div>
      </div>
    );
  if (!isBooks) {
    go('');
    return null;
  }
  // A question, a journal line or a payee opened on a phone is a pushed screen: no tab bar, its own bottom actions.
  const pushed = phone && !!id && page !== 'journal';
  return phone ? (
    <div className={`phone ${pushed ? '' : 'with-tabs'}`}>
      <BooksPage page={page} id={id} />
      {!pushed && <TabBar page={page} />}
    </div>
  ) : (
    <div className="web">
      <Toolbar />
      <div className="frame">
        <Sidebar page={page} />
        <main className="main">
          <BooksPage page={page} id={id} />
        </main>
      </div>
    </div>
  );
}

export function App() {
  usePaletteShortcut();
  return (
    <BooksProvider>
      <Screen />
      <Palette />
    </BooksProvider>
  );
}

