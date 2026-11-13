// Small hooks: the hash route, a media query, a ticking clock, and answers kept in this browser.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------- route: #/questions/<id>

export type Route = { page: string; id?: string };

function readRoute(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { page: parts[0] ?? '', id: parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : undefined };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
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
