// Guidance: the four steps every treasury goes through, where you are in them, and what comes next.
// Progress is real, never assumed: a step is done when its page was opened (overview, downloads), when every
// question has an answer (questions), or when a council vote approved these exact books (close).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Closing } from '../../core/closing.ts';
import type { SignedReport } from '../../core/report.ts';
import type { Network } from '../../core/rpc.ts';
import { useBooks } from './app.tsx';
import { closingsOf } from './lib/data.ts';
import { plural } from './lib/format.ts';
import { href, useAnswers, usePhone } from './lib/hooks.ts';
import { MorphButton } from './ui.tsx';

export type Step = { page: string; title: string; short: string; why: string; icon: string };

/** The path through a treasury's books, in order. The sidebar numbers these; every page ends with the next one. */
export const FLOW: Step[] = [
  { page: 'books', title: 'Overview', short: 'Where the money went', why: 'Spending by account and by month, and whether the balances add up on chain.', icon: 'overview' },
  { page: 'questions', title: 'Questions', short: 'What needs an answer', why: 'Payments Tickmark could not explain from the chain alone. Answer each one in your own words.', icon: 'questions' },
  { page: 'close', title: 'Close the books', short: 'The council approves', why: 'One ordinary DAO vote approves these exact books. It moves no money.', icon: 'close' },
  { page: 'downloads', title: 'Downloads', short: 'Files for your accountant', why: 'QuickBooks and Xero imports, spreadsheets, and the signed report anyone can check.', icon: 'downloads' },
];

/** Pages to look things up in, at any point. */
export const LOOKUP: Step[] = [
  { page: 'journal', title: 'Journal', short: 'Every payment, line by line', why: 'Every payment with the proposal’s own words and why it sits in its account.', icon: 'journal' },
  { page: 'payees', title: 'Payees', short: 'Who got paid, and how much', why: 'Everyone the treasury paid, largest first, with any votes on their own pay.', icon: 'payees' },
];

export const CHECK: Step = { page: 'verify', title: 'Check a report', short: 'Is it genuine, and approved?', why: 'Rebuild a report from the chain and find the vote that approved it.', icon: 'verify' };

export const PAGE_TITLE: Record<string, string> = Object.fromEntries([...FLOW, ...LOOKUP, CHECK].map((s) => [s.page, s.title]));

// ---------------------------------------------------------------- small stores kept in this browser

function store<T>(read: () => T) {
  const listeners = new Set<() => void>();
  return {
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    read,
    notify: () => listeners.forEach((l) => l()),
  };
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private windows can refuse storage; the value then lasts for this visit only
  }
}

// Whether this browser has seen the welcome guide.
let welcomed: boolean | null = null;
const welcomeStore = store(() => (welcomed ??= readStorage('tickmark:welcomed') === '1'));
export const useWelcomed = () => useSyncExternalStore(welcomeStore.subscribe, welcomeStore.read);
export function markWelcomed() {
  welcomed = true;
  writeStorage('tickmark:welcomed', '1');
  welcomeStore.notify();
}

// Which step pages were opened, per report.
const seen = new Map<string, string[]>();
const seenKey = (fp: string) => `tickmark:seen:${fp}`;
function seenOf(fp: string): string[] {
  if (!seen.has(fp)) {
    let pages: string[] = [];
    try {
      pages = JSON.parse(readStorage(seenKey(fp)) ?? '[]') as string[];
    } catch {
      pages = [];
    }
    seen.set(fp, Array.isArray(pages) ? pages : []);
  }
  return seen.get(fp)!;
}
const seenStore = store(() => seen);
export function markSeen(fp: string, page: string) {
  const pages = seenOf(fp);
  if (pages.includes(page)) return;
  const next = [...pages, page];
  seen.set(fp, next);
  writeStorage(seenKey(fp), JSON.stringify(next));
  seenStore.notify();
}
function useSeen(fp: string): string[] {
  useSyncExternalStore(seenStore.subscribe, () => seenOf(fp));
  return seenOf(fp);
}

// ---------------------------------------------------------------- progress

/** The vote that approved these exact books, if any (read for small treasuries and the demo only: it reads every proposal). */
export function useClosedBy(report?: SignedReport): Closing | null {
  const books = useBooks();
  const [found, setFound] = useState<{ fp: string; closing: Closing | null } | null>(null);
  const small = !!report && (books.source === 'demo' || report.journal.length <= 200);
  useEffect(() => {
    if (!report || !small) return;
    let live = true;
    void closingsOf(report.dao, report.network as Network).then((all) => {
      if (live) setFound({ fp: report.fingerprint, closing: all.find((c) => c.fingerprint === report.fingerprint && c.status === 'Approved') ?? null });
    });
    return () => {
      live = false;
    };
  }, [report, small]);
  return found && found.fp === report?.fingerprint ? found.closing : null;
}

export type Progress = { done: Record<string, boolean>; count: number; open: number; closedBy: Closing | null };

export function useProgress(report?: SignedReport): Progress {
  const fp = report?.fingerprint ?? 'none';
  const { answers } = useAnswers(fp);
  const pages = useSeen(fp);
  const closedBy = useClosedBy(report);
  const open = report ? report.questions.filter((q) => !answers[q.id]?.answered).length : 0;
  const done: Record<string, boolean> = {
    books: pages.includes('books'),
    questions: !!report && open === 0,
    close: !!closedBy,
    downloads: pages.includes('downloads'),
  };
  return { done, count: FLOW.filter((s) => done[s.page]).length, open, closedBy };
}

/** After a step, the next step; from anywhere else, the first step not done yet. */
export function nextFor(page: string, done: Record<string, boolean>): Step | null {
  const i = FLOW.findIndex((s) => s.page === page);
  if (i >= 0) return FLOW[i + 1] ?? null;
  return FLOW.find((s) => !done[s.page]) ?? FLOW[0]!;
}

/** What a step will do here and now, from the open books. */
export function doing(step: Step, p: Progress): string {
  if (step.page === 'books') return 'See where it went';
  if (step.page === 'questions') return p.open ? `Answer ${plural(p.open, 'question')}` : 'Every question answered';
  if (step.page === 'close') return p.closedBy ? `Approved by vote #${p.closedBy.proposalId}` : 'Put it to a vote';
  return 'Get the files';
}

// ---------------------------------------------------------------- pieces

function StepDots({ page, done }: { page: string; done: Record<string, boolean> }) {
  return (
    <span className="ns-dots" aria-hidden="true">
      {FLOW.map((s) => (
        <i key={s.page} className={s.page === page ? 'now' : done[s.page] ? 'done' : ''} />
      ))}
    </span>
  );
}

/** The end of every page: where you are in the four steps, what comes next, and one button to go there. */
export function NextStep({ page, compact }: { page: string; compact?: boolean }) {
  const phone = usePhone();
  const books = useBooks();
  const p = useProgress(books.report);
  const i = FLOW.findIndex((s) => s.page === page);
  const step = FLOW[i];
  const next = nextFor(page, p.done);
  const where = step ? `Step ${i + 1} of ${FLOW.length}` : `${p.count} of ${FLOW.length} steps done`;

  if (!next)
    return (
      <nav className={`next-step ${compact ? 'compact' : ''}`} aria-label="Next step">
        <div className="ns-text">
          <span className="ns-where">
            <StepDots page={page} done={p.done} />
            {where}
          </span>
          <b className="ns-title">That’s every step.</b>
        </div>
        <div className="ns-actions">
          <a className="btn btn-gray btn-sm" href={href('verify')}>
            Check a report
          </a>
        </div>
      </nav>
    );

  return (
    <nav className={`next-step ${compact ? 'compact' : ''}`} aria-label="Next step">
      <div className="ns-text">
        <span className="ns-where">
          <StepDots page={page} done={p.done} />
          {where}
        </span>
        <b className="ns-title">Next: {next.title}</b>
      </div>
      <div className="ns-actions">
        {phone ? (
          <a className="btn btn-primary btn-sm" href={href(next.page)}>
            Continue
          </a>
        ) : (
          <MorphButton href={href(next.page)} label="Continue" hover={doing(next, p)} icon="arrow" size="sm" />
        )}
      </div>
    </nav>
  );
}
