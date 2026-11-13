// The app: which books are open (the demo, or a treasury built live), the hash route, and the two shells.
// Web gets a toolbar and a source-list sidebar; phones get an iOS-style tab bar and each page draws its own nav bar.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NotADao } from '../../core/dao.ts';
import type { SignedReport } from '../../core/report.ts';
import { buildBooks, daoName, demoReport, type RunRequest } from './lib/data.ts';
import { go, href, useAnswers, usePhone, useRoute, useSideOpen, useTheme } from './lib/hooks.ts';
import { Icon, Mark, MorphButton, NetworkPill, ThemeButton } from './ui.tsx';
import { Palette, SearchButton, usePaletteShortcut } from './palette.tsx';
import { CHECK, doing, FLOW, LOOKUP, markSeen, nextFor, PAGE_TITLE, useProgress, useWelcomed, type Step } from './guide.tsx';
import { Home } from './pages/home.tsx';
import { More } from './pages/more.tsx';
import { Welcome } from './pages/welcome.tsx';
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
  /** Set when the name asked for is not a DAO treasury (a personal wallet, another contract, or no account). */
  notDao?: NotADao['kind'];
};

type BooksApi = BooksState & { build: (req: RunRequest) => void; openDemo: () => void; cancel: () => void };

const BooksContext = createContext<BooksApi | null>(null);
export const useBooks = () => useContext(BooksContext)!;

/** The open books when they are ready (pages under the books shell only render then). */
export const useReport = () => useBooks().report!;

function requestFromUrl(): RunRequest | null {
  const p = new URLSearchParams(location.search);
  const network = p.get('network') === 'testnet' ? 'testnet' : 'mainnet';
  const dao = daoName(p.get('dao') ?? '', network);
  if (!dao) return null;
  const block = Number(p.get('block'));
  return { dao, network, since: p.get('since') ?? undefined, block: Number.isSafeInteger(block) && block > 0 ? block : undefined };
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
      .catch((e: Error) => id === run.current && setState((s) => ({ ...s, status: 'error', error: e.message, notDao: e instanceof NotADao ? e.kind : undefined })));
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

/**
 * The source list: the four steps in order, then the pages to look things up in. Closed, it is a rail of icons
 * (the label shows on hover); open, each icon has its name. A green dot marks a step that is done.
 */
function Sidebar({ page }: { page: string }) {
  const books = useBooks();
  const report = books.status === 'ready' ? books.report : undefined;
  const p = useProgress(report);
  const link = (s: Step, done?: boolean, count?: number, alert?: boolean) => (
    <a key={s.page} href={href(s.page)} className={`nav ${page === s.page ? 'on' : ''}`} aria-current={page === s.page ? 'page' : undefined} title={s.title}>
      <i className="nav-icon">
        <Icon name={s.icon} size={18} />
        {done && <span className="nav-done" aria-label="done" />}
        {alert && count ? <span className="nav-badge num">{count}</span> : null}
      </i>
      <span className="nav-label">{s.title}</span>
      {count !== undefined && <span className={`count ${alert ? 'pencil' : ''}`}>{count}</span>}
    </a>
  );
  return (
    <nav className="side" aria-label="Pages">
      {FLOW.map((s) => link(s, p.done[s.page], s.page === 'questions' && report && p.open ? p.open : undefined, s.page === 'questions'))}
      <span className="side-divider" />
      {LOOKUP.map((s) => link(s, false, report ? (s.page === 'journal' ? report.journal.length : report.payees.length) : undefined))}
      <span className="side-divider" />
      {link(CHECK)}
    </nav>
  );
}

/** Where you are (All treasuries › treasury › page), search, the guide, light or dark, and the next step. */
function Toolbar({ page, onSide }: { page: string; onSide: () => void }) {
  const books = useBooks();
  const report = books.status === 'ready' ? books.report : undefined;
  const p = useProgress(report);
  const [theme, toggleTheme] = useTheme();
  const dao = books.report?.dao ?? books.request?.dao;
  const network = books.report?.network ?? books.request?.network ?? 'testnet';
  const next = report && page !== 'verify' ? nextFor(page, p.done) : null;
  const title = PAGE_TITLE[page];
  return (
    <header className="toolbar">
      <button type="button" className="tb-btn" onClick={onSide} aria-label="Show or hide the sidebar" title="Show or hide the sidebar">
        <Icon name="sidebar" size={18} />
      </button>
      <a className="logo" href="#/" aria-label="Tickmark home">
        <Mark size={26} />
      </a>
      <nav className="crumbs" aria-label="You are here">
        <a href="#/" className="crumb">
          All treasuries
        </a>
        {dao && (
          <>
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
            <a className="treasury mono" href={href('books')} title={`${dao}: open its overview`}>
              {dao}
            </a>
            <NetworkPill network={network} />
            {books.source === 'demo' && books.status === 'ready' && <span className="faint hide-md">Demo</span>}
          </>
        )}
        {title && (page !== 'books' || !dao) && (
          <>
            <span className="crumb-sep hide-md" aria-hidden="true">
              ›
            </span>
            <span className="crumb-now hide-md" aria-current="page">
              {title}
            </span>
          </>
        )}
      </nav>
      <span className="spacer" />
      <SearchButton />
      <a className="tb-btn" href={href('welcome')} aria-label="Guide: how Tickmark works" title="Guide: how Tickmark works">
        <Icon name="info" size={17} />
      </a>
      <ThemeButton theme={theme} onToggle={toggleTheme} />
      {next && <MorphButton href={href(next.page)} label={`Next: ${next.title}`} hover={doing(next, p)} icon="arrow" size="sm" />}
    </header>
  );
}

/** The web shell: toolbar, the sidebar (open or a rail of icons), and the page. */
function WebShell({ page, children }: { page: string; children: ReactNode }) {
  const [open, toggle] = useSideOpen();
  return (
    <div className={`web ${open ? 'side-open' : 'side-closed'}`}>
      <Toolbar page={page} onSide={toggle} />
      <div className="frame">
        <Sidebar page={page} />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

const TABS: [string, string, string][] = [
  ['books', 'Books', 'overview'],
  ['questions', 'Questions', 'questions'],
  ['journal', 'Journal', 'journal'],
  ['close', 'Close', 'close'],
  ['more', 'More', 'more'],
];

/** Pages reached from More keep the More tab lit. */
const UNDER_MORE = new Set(['more', 'payees', 'downloads']);

function TabBar({ page }: { page: string }) {
  const books = useBooks();
  const { answers } = useAnswers(books.report?.fingerprint ?? 'none');
  const open = books.report ? books.report.questions.filter((q) => !answers[q.id]?.answered).length : 0;
  return (
    <nav className="tabbar" aria-label="Tabs">
      {TABS.map(([p, label, icon]) => {
        const on = page === p || (p === 'more' && UNDER_MORE.has(page));
        return (
          <a key={p} href={href(p)} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
            <span className="tab-icon">
              <Icon name={icon} size={25} />
              {p === 'questions' && open > 0 && <span className="badge num">{open}</span>}
            </span>
            {label}
          </a>
        );
      })}
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
  const fp = books.status === 'ready' ? books.report?.fingerprint : undefined;
  // Opening the overview or the downloads is that step done.
  useEffect(() => {
    if (fp && (page === 'books' || page === 'downloads')) markSeen(fp, page);
  }, [fp, page]);
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

/** The name asked for is not a DAO treasury: say what it is, what Tickmark reads, and where to go next. */
function NotADaoNotice({ kind, account, network }: { kind: NotADao['kind']; account: string; network: string }) {
  const books = useBooks();
  const title = kind === 'wallet' ? 'That’s a personal wallet' : kind === 'contract' ? 'That account isn’t a DAO treasury' : `No account by that name on ${network === 'testnet' ? 'Testnet' : 'Mainnet'}`;
  return (
    <div className="page narrow">
      <div className="card notice-card" role="alert">
        <h1 className="title-2">{title}</h1>
        <p className="mono small faint">{account}</p>
        {kind === 'missing' ? (
          <p className="secondary">Check the spelling, or switch between Mainnet and Testnet. A DAO’s name usually ends in .sputnik-dao.near.</p>
        ) : (
          <p className="secondary">
            Tickmark reads DAO treasuries: shared wallets where every payment is approved by a vote, with a proposal that says why. A personal wallet has no such record, so there is nothing to explain its payments with. Personal wallets are on the list for later.
          </p>
        )}
        <div className="actions">
          <a className="btn btn-primary" href="#/">
            Try a DAO
          </a>
          <button className="btn btn-gray" type="button" onClick={books.cancel}>
            Open the demo
          </button>
        </div>
      </div>
    </div>
  );
}

function BuildError() {
  const books = useBooks();
  if (books.notDao && books.request) return <NotADaoNotice kind={books.notDao} account={books.request.dao} network={books.request.network} />;
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
  const welcomed = useWelcomed();
  const isBooks = BOOK_PAGES.has(page);

  // A first visit to the front page starts with the guide; a link to a treasury's books goes straight to them.
  if (page === '') return welcomed || new URLSearchParams(location.search).has('dao') ? <Home /> : <Welcome first />;
  if (page === 'welcome') return <Welcome />;
  if (page === 'more') {
    if (!phone) {
      go('books');
      return null;
    }
    return (
      <div className="phone with-tabs">
        <More />
        <TabBar page={page} />
      </div>
    );
  }
  if (page === 'verify')
    return phone ? (
      <div className="phone">
        <Verify />
      </div>
    ) : (
      <WebShell page={page}>
        <Verify />
      </WebShell>
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
    <WebShell page={page}>
      <BooksPage page={page} id={id} />
    </WebShell>
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

