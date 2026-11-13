// ⌘K: a quick-actions palette over a frosted backdrop. With no query it lists the actions; typing also finds
// questions, payees and journal lines in the open books. ↑ ↓ to move, ↵ to open, esc to close.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CATEGORIES } from '../../core/classify.ts';
import { useBooks } from './app.tsx';
import { shortAccount, usd } from './lib/format.ts';
import { go, useAnswers } from './lib/hooks.ts';
import { KIND } from './lib/labels.ts';
import { Icon } from './ui.tsx';

type Item = { id: string; group: string; label: string; hint?: string; icon: string; run: () => void };

const listeners = new Set<(open: boolean) => void>();
export const openPalette = () => listeners.forEach((l) => l(true));

/** ⌘K / Ctrl+K anywhere opens the palette. */
export function usePaletteShortcut() {
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}

export function SearchButton() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <button type="button" className="search-btn" onClick={openPalette} aria-label="Search and quick actions">
      <Icon name="search" size={14} />
      <span>Search</span>
      <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

export function Palette() {
  const books = useBooks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    const l = (v: boolean) => {
      lastFocus.current = document.activeElement;
      setOpen(v);
      setQuery('');
      setActive(0);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
    else (lastFocus.current as HTMLElement | null)?.focus?.();
  }, [open]);

  const report = books.status === 'ready' ? books.report : undefined;
  const { answers } = useAnswers(report?.fingerprint ?? 'none');
  const items = useMemo<Item[]>(() => {
    const close = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const openQs = report ? report.questions.filter((q) => !answers[q.id]?.answered).length : 0;
    const actions: Item[] = [
      ...(report
        ? [
            { id: 'a:questions', group: 'Quick actions', label: 'Review questions', hint: openQs ? `${openQs}` : undefined, icon: 'questions', run: close(() => go('questions')) },
            { id: 'a:journal', group: 'Quick actions', label: 'Open the journal', icon: 'journal', run: close(() => go('journal')) },
            { id: 'a:payees', group: 'Quick actions', label: 'Payees', icon: 'payees', run: close(() => go('payees')) },
            { id: 'a:downloads', group: 'Quick actions', label: 'Download the books', icon: 'downloads', run: close(() => go('downloads')) },
            { id: 'a:close', group: 'Quick actions', label: 'Close the books', icon: 'close', run: close(() => go('close')) },
          ]
        : []),
      { id: 'a:verify', group: 'Quick actions', label: 'Check a report', icon: 'verify', run: close(() => go('verify')) },
      { id: 'a:build', group: 'Quick actions', label: 'Build another treasury', icon: 'search', run: close(() => go('')) },
      { id: 'a:guide', group: 'Quick actions', label: 'Guide: how Tickmark works', icon: 'info', run: close(() => go('welcome')) },
      ...(books.source === 'live' ? [{ id: 'a:demo', group: 'Quick actions', label: 'Open the demo books', icon: 'overview', run: close(() => (books.openDemo(), go('books'))) }] : []),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    const found: Item[] = actions.filter((a) => a.label.toLowerCase().includes(q));
    if (report) {
      for (const x of report.questions)
        if (`${KIND[x.kind]} ${x.ask}`.toLowerCase().includes(q)) found.push({ id: `q:${x.id}`, group: 'Questions', label: x.ask, hint: x.cents === null ? undefined : usd(x.cents), icon: 'questions', run: close(() => go('questions', x.id)) });
      for (const p of report.payees) if (p.account.toLowerCase().includes(q)) found.push({ id: `p:${p.account}`, group: 'Payees', label: shortAccount(p.account), hint: usd(p.cents), icon: 'payees', run: close(() => go('payees', p.account)) });
      for (const e of report.journal)
        if ([e.ref, e.memo, e.payee, `#${e.proposalId}`, CATEGORIES[e.category].name].some((v) => v.toLowerCase().includes(q)))
          found.push({ id: `j:${e.ref}`, group: 'Journal', label: e.memo || `${shortAccount(e.payee)}, no description`, hint: `${e.ref} · ${usd(e.cents)}`, icon: 'journal', run: close(() => go('journal', e.ref)) });
    }
    return found.slice(0, 40);
  }, [query, report, books, answers]);

  if (!open) return null;
  const pick = Math.min(active, Math.max(0, items.length - 1));
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((pick + 1) % Math.max(1, items.length)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((pick - 1 + items.length) % Math.max(1, items.length)));
    else if (e.key === 'Enter') items[pick]?.run();
  };
  let lastGroup = '';
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and quick actions" onMouseDown={(e) => e.stopPropagation()} onKeyDown={key}>
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={input}
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), setActive(0))}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[pick] ? `pi-${pick}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {head && <div className="palette-group">{head}</div>}
                <button type="button" id={`pi-${i}`} role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''} onMouseMove={() => setActive(i)} onClick={it.run}>
                  <Icon name={it.icon} size={16} />
                  <span className="truncate">{it.label}</span>
                  {it.hint && <span className="palette-hint num">{it.hint}</span>}
                  {i === pick && <kbd>↵</kbd>}
                </button>
              </li>
            );
          })}
          {items.length === 0 && <li className="palette-empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
