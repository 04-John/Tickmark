// Formatting for the screens. Overviews may round; the journal and exports always show exact amounts.
import { centsToString } from '../../../core/books.ts';

/** Overview money: cents under $100 keep two decimals, larger amounts are whole dollars, millions are compact. */
export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  if (abs >= 100_000_000) return `${sign}$${(abs / 100_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 100).toLocaleString('en-US')}`;
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

/** Exact dollars and cents, for the journal. */
export function exactUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `$${Number(centsToString(cents)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Token quantity for overviews: at most four decimals. Exact strings are shown where accuracy matters. */
export function qty(value: string | null): string {
  if (value === null) return '?';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** 64-character hex accounts are shortened; named accounts are kept whole (CSS truncates them). */
export function shortAccount(account: string): string {
  return /^[0-9a-f]{64}$/.test(account) ? `${account.slice(0, 8)}…${account.slice(-4)}` : account;
}

/** A short name for lists: "studio" for studio.tickmark-demo.testnet, "120bd3f9…" for a hex account. */
export function nameOf(account: string | null | undefined): string {
  if (!account) return '';
  return /^[0-9a-f]{64}$/.test(account) ? `${account.slice(0, 8)}…` : account.split('.')[0]!;
}

/** The part of a payee name worth showing first: "studio" for studio.tickmark-demo.testnet. */
export function payeeLabel(account: string): string {
  if (/^[0-9a-f]{64}$/.test(account)) return shortAccount(account);
  return account;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-12 → 12 Nov 2026 (UTC dates stay UTC). */
export function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 2026-11 → Nov 26 */
export function month(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : ym;
}

export const block = (n: number) => n.toLocaleString('en-US');

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
