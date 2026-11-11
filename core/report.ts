// The report and its fingerprint.
//
// A report is the books of one DAO as of one block: every chain read is pinned to that block, prices come from the
// committed snapshot, and "now" is the block's time. So anyone can rebuild it later (with an archival RPC node) and
// get the same bytes. The fingerprint is the SHA-256 of the report's canonical JSON; a DAO can vote on it
// ("close the books"), and `tickmark verify` recomputes it.
import type { JournalEntry, Statement } from './books.ts';
import type { Question } from './questions.ts';

export const REPORT_FORMAT = 'tickmark-report/1';

export type Report = {
  format: typeof REPORT_FORMAT;
  /** Tickmark version that built it; rebuild with the same version to get the same fingerprint. */
  tickmark: string;
  dao: string;
  network: string;
  /** First day included, YYYY-MM-DD (UTC). */
  since: string;
  /** Every chain read was made at this block. */
  asOf: { block: number; time: string };
  /** Last day of each price series used, so a refreshed snapshot is visible. */
  pricesThrough: Record<string, string>;
  totals: { lines: number; spendingCents: number; suspenseCents: number; unpricedLines: number; questions: number };
  statement: Statement;
  questions: Question[];
  journal: JournalEntry[];
};

export type SignedReport = Report & { fingerprint: string };

/**
 * JSON with object keys sorted and no spaces, so the same data always gives the same bytes.
 * Undefined fields are left out (as JSON.stringify does); non-finite numbers are refused.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot fingerprint ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new Error(`cannot fingerprint a ${typeof value}`);
}

/** SHA-256 as lowercase hex, with Web Crypto (Node and browsers). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildReport(input: Omit<Report, 'format' | 'totals'>): Report {
  return {
    format: REPORT_FORMAT,
    ...input,
    totals: {
      lines: input.journal.length,
      spendingCents: input.statement.spendingCents,
      suspenseCents: input.statement.suspenseCents,
      unpricedLines: input.journal.filter((e) => e.cents === null).length,
      questions: input.questions.length,
    },
  };
}

/** The report with its fingerprint: sha256 of the canonical JSON of everything except the fingerprint. */
export async function signReport(report: Report): Promise<SignedReport> {
  return { ...report, fingerprint: await fingerprintOf(report) };
}

export async function fingerprintOf(report: Report | SignedReport): Promise<string> {
  const { fingerprint: _ignored, ...body } = report as SignedReport;
  return sha256Hex(canonicalJson(body));
}

/** Where two reports first differ, for `verify`: a path like "journal[12].date" and both values. */
export function firstDifference(a: unknown, b: unknown, path = ''): { path: string; a: unknown; b: unknown } | null {
  const text = (v: unknown) => (v === undefined ? 'undefined' : canonicalJson(v));
  if (text(a) === text(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = firstDifference(a[i], b[i], `${path}[${i}]`);
        if (d) return d;
      }
    } else {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const k of keys) {
        const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
        if (d) return d;
      }
    }
  }
  return { path: path || '(root)', a, b };
}
