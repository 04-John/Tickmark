// Small hooks: the hash route, a media query, a ticking clock, and answers kept in this browser.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// ---------------------------------------------------------------- route: #/questions/<id>

export type Route = { page: string; id?: string };

function readRoute(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { page: parts[0] ?? '', id: parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : undefined };
}

/** Which way a move goes: deeper (forward), shallower (back), or across. Phones slide; the web lifts and fades. */
function direction(from: Route, to: Route): 'forward' | 'back' | 'across' {
  if (from.page === to.page) return to.id && !from.id ? 'forward' : !to.id && from.id ? 'back' : 'across';
  if (from.page === '' || (to.id && !from.id)) return 'forward';
  if (to.page === '') return 'back';
  return 'across';
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let lastHash = '';
/** The hash of the screen before this one in this visit ('' on a fresh load), so "Close" can go back to it. */
export const previousHash = () => lastHash;

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    let current = readRoute();
    const on = (e: HashChangeEvent) => {
      lastHash = new URL(e.oldURL).hash;
      const next = readRoute();
      const apply = () => {
        setRoute(next);
        window.scrollTo(0, 0);
      };
      document.documentElement.dataset.nav = direction(current, next);
      current = next;
      // View Transitions animate between the old and new page; browsers without them just swap.
      if (document.startViewTransition && !reducedMotion()) document.startViewTransition(() => flushSync(apply));
      else apply();
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = (page: string, id?: string) => `#/${page}${id ? `/${encodeURIComponent(id)}` : ''}`;
export const go = (page: string, id?: string) => {
  location.hash = href(page, id);
};

// ---------------------------------------------------------------- layout

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
  );
}

/** Phones get the iOS-style layout: large titles, inset lists, a tab bar and sheets. */
export const usePhone = () => useMedia('(max-width: 760px)');

// ---------------------------------------------------------------- preferences kept in this browser

const prefs = new Map<string, string>();
function readPref(key: string): string | null {
  if (prefs.has(key)) return prefs.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  prefs.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // private windows can refuse storage; the choice then lasts for this visit only
  }
}

export type Theme = 'light' | 'dark';

/** Light or dark. index.html sets it before the first paint; a choice made here is remembered, else the system decides. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      if (readPref('tickmark:theme')) return; // the visitor chose; the system no longer decides
      const next: Theme = m.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    m.addEventListener('change', follow);
    return () => m.removeEventListener('change', follow);
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writePref('tickmark:theme', next);
    setTheme(next);
  }, []);
  return [theme, toggle];
}

const sideListeners = new Set<() => void>();
/** Whether the web sidebar shows its labels or only its icons. Icons only until the visitor opens it. */
export function useSideOpen(): [boolean, () => void] {
  const open = useSyncExternalStore(
    (cb) => {
      sideListeners.add(cb);
      return () => sideListeners.delete(cb);
    },
    () => readPref('tickmark:side') === 'open',
  );
  const toggle = useCallback(() => {
    writePref('tickmark:side', readPref('tickmark:side') === 'open' ? 'closed' : 'open');
    sideListeners.forEach((l) => l());
  }, []);
  return [open, toggle];
}

export function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

// ---------------------------------------------------------------- answers (kept in this browser, never in the report)

export type Answer = { answered: boolean; note: string; at: string };
type Answers = Record<string, Answer>;

const key = (fingerprint: string) => `tickmark:answers:${fingerprint}`;
const listeners = new Set<() => void>();

function load(fingerprint: string): Answers {
  try {
    return JSON.parse(localStorage.getItem(key(fingerprint)) ?? '{}') as Answers;
  } catch {
    return {};
  }
}

const cache = new Map<string, Answers>();

export function useAnswers(fingerprint: string) {
  const answers = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      if (!cache.has(fingerprint)) cache.set(fingerprint, load(fingerprint));
      return cache.get(fingerprint)!;
    },
  );
  const save = useCallback(
    (id: string, change: Partial<Answer>) => {
      const prev = cache.get(fingerprint) ?? load(fingerprint);
      const base: Answer = prev[id] ?? { answered: false, note: '', at: '' };
      const next: Answers = { ...prev, [id]: { ...base, ...change, at: new Date().toISOString() } };
      cache.set(fingerprint, next);
      try {
        localStorage.setItem(key(fingerprint), JSON.stringify(next));
      } catch {
        // private windows can refuse storage; answers then last for this visit only
      }
      listeners.forEach((l) => l());
    },
    [fingerprint],
  );
  return { answers, save };
}
