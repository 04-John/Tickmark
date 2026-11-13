// Everything the screens read: the committed price snapshot, the demo report, the 92-DAO measurement, and live runs of
// the same core pipeline the command line uses. No server: every request goes to static files or public NEAR endpoints.
import { findClosings, type Closing } from '../../../core/closing.ts';
import { fetchPolicy, fetchProposals, type DaoPolicy } from '../../../core/dao.ts';
import { setMaxInFlightPerHost } from '../../../core/http.ts';
import { makeBooks, type PipelineDeps } from '../../../core/pipeline.ts';
import { PriceBook, type PriceSeries } from '../../../core/prices.ts';
import { fingerprintOf, firstDifference, type SignedReport } from '../../../core/report.ts';
import { Rpc, type Network } from '../../../core/rpc.ts';

// Every browser request is preceded by a CORS preflight; two at a time per host keeps the free endpoints happy.
setMaxInFlightPerHost(2);

let depsPromise: Promise<PipelineDeps> | undefined;
export function deps(): Promise<PipelineDeps> {
  depsPromise ??= (async () => {
    const assets = ['near', 'eth', 'btc', 'zec', 'sol', 'aurora'];
    const series = await Promise.all(
      assets.map(async (a) => {
        const res = await fetch(`prices/${a}.json`);
        return res.ok ? ((await res.json()) as PriceSeries) : null;
      }),
    );
    const version = (await fetch('version.json').then((r) => (r.ok ? r.json() : { version: 'dev' }))) as { version: string };
    return { prices: new PriceBook(series.filter((s): s is PriceSeries => s !== null)), version: version.version };
  })();
  return depsPromise;
}

/** First and last day of the NEAR price series: the range a run can start in. */
export async function priceRange(): Promise<{ from: string; to: string } | null> {
  return (await deps()).prices.range('near');
}

let demoPromise: Promise<SignedReport> | undefined;
/** The testnet demo treasury's committed report: real books, approved by a real council vote, with no waiting. */
export function demoReport(): Promise<SignedReport> {
  demoPromise ??= fetch('demo/report.json').then((r) => {
    if (!r.ok) throw new Error(`demo report: HTTP ${r.status}`);
    return r.json() as Promise<SignedReport>;
  });
  return demoPromise;
}

export type Measure = {
  measuredAt: string;
  totals: { daosWithPayments: number; paidOutUsd: number; unexplainedUsd: number; unexplainedShare: number; lines: number; questions: number };
};

let measurePromise: Promise<Measure | null> | undefined;
/** The headline across NEAR DAOs, from data/measure (the build copies only its totals). */
export function measure(): Promise<Measure | null> {
  measurePromise ??= fetch('measure.json')
    .then((r) => (r.ok ? (r.json() as Promise<Measure>) : null))
    .catch(() => null);
  return measurePromise;
}

/** The four steps a run reports, in order, matched against core/pipeline.ts progress messages. */
export const STEPS = ['Reading proposals', 'Finding the vote that paid each', 'Reading prices and the voting policy', 'Checking balances against the chain'] as const;

export function stepOf(message: string): number {
  if (message.startsWith('reading proposals')) return 0;
  if (message.startsWith('finding the vote')) return 1;
  if (message.startsWith('reading prices')) return 2;
  if (message.startsWith('checking balances')) return 3;
  return -1;
}

export type RunRequest = { dao: string; network: Network; since?: string; block?: number };

/** Builds a treasury's books in the browser: 20 s to 2 min. `onStep` gets the step index and the raw message. */
export async function buildBooks(req: RunRequest, onStep: (step: number, message: string) => void): Promise<SignedReport> {
  const { report } = await makeBooks(
    req.dao,
    {
      network: req.network,
      since: req.since || undefined,
      block: req.block,
      skipDates: false,
      onProgress: (m) => onStep(stepOf(m), m),
      warn: () => {},
    },
    await deps(),
  );
  return report;
}

const policies = new Map<string, Promise<DaoPolicy | null>>();
/** The DAO's policy (roles and bond), for the close-the-books flow. */
export function policyOf(dao: string, network: Network): Promise<DaoPolicy | null> {
  const key = `${network}:${dao}`;
  if (!policies.has(key)) policies.set(key, fetchPolicy(new Rpc({ network }), dao).catch(() => null));
  return policies.get(key)!;
}

const closings = new Map<string, Promise<Closing[]>>();
/** Every close-the-books proposal in the DAO, newest first. Reads all proposals, so it is fetched only when needed. */
export function closingsOf(dao: string, network: Network): Promise<Closing[]> {
  const key = `${network}:${dao}`;
  if (!closings.has(key)) {
    const p = fetchProposals(new Rpc({ network }), dao, 0)
      .then(findClosings)
      .catch(() => {
        closings.delete(key);
        return [] as Closing[];
      });
    closings.set(key, p);
  }
  return closings.get(key)!;
}

export type Verdict = {
  intact: boolean;
  same: boolean;
  fileFingerprint: string;
  rebuiltFingerprint: string;
  difference: string | null;
  versions: { file: string; checker: string };
  closings: Closing[];
  ms: number;
};

/** Rebuilds a saved report at its block (archival node), compares fingerprints, and finds the votes that approved it. */
export async function verifyReport(saved: SignedReport, onStep: (step: number, message: string) => void): Promise<Verdict> {
  const started = Date.now();
  const network = (saved.network === 'testnet' ? 'testnet' : 'mainnet') as Network;
  const intact = (await fingerprintOf(saved)) === saved.fingerprint;
  const rebuilt = await buildBooks({ dao: saved.dao, network, since: saved.since, block: saved.asOf.block }, onStep);
  const same = rebuilt.fingerprint === saved.fingerprint;
  const diff = same ? null : firstDifference({ ...saved, fingerprint: undefined }, { ...rebuilt, fingerprint: undefined });
  const all = await closingsOf(saved.dao, network);
  return {
    intact,
    same,
    fileFingerprint: saved.fingerprint,
    rebuiltFingerprint: rebuilt.fingerprint,
    difference: diff?.path ?? null,
    versions: { file: saved.tickmark, checker: rebuilt.tickmark },
    closings: all.filter((c) => c.fingerprint === saved.fingerprint),
    ms: Date.now() - started,
  };
}

/** Reads a dropped file as a Tickmark report, or explains why it is not one. */
export async function readReportFile(file: File): Promise<SignedReport> {
  const parsed = JSON.parse(await file.text()) as SignedReport;
  if (!parsed || typeof parsed !== 'object' || !parsed.fingerprint || !parsed.asOf?.block || !parsed.dao) throw new Error('this is not a Tickmark report.json');
  return parsed;
}

export const explorer = (network: string, tx: string) => `https://${network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${tx}`;
