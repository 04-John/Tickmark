// Daily USD prices from a committed snapshot (CoinGecko, refreshed by scripts/update-prices.ts).
import type { PriceKey } from './tokens.ts';

/** One asset's daily closes: [Unix seconds, USD]. */
export type PriceSeries = { asset: Exclude<PriceKey, 'usd'>; coingeckoId: string; fetchedAt: string; points: [number, number][] };

export type PriceQuote = { usd: number; /** UTC date of the price used, YYYY-MM-DD. */ date: string };

const DAY = 86_400;
/** A price older than this is refused rather than silently reused. */
const MAX_STALE_DAYS = 2;

export class PriceBook {
  private readonly series = new Map<string, [number, number][]>();

  constructor(series: PriceSeries[]) {
    for (const s of series) this.series.set(s.asset, [...s.points].sort((a, b) => a[0] - b[0]));
  }

  /** The covered date range of an asset, or null when it has no prices. */
  range(asset: PriceKey): { from: string; to: string } | null {
    if (asset === 'usd') return null;
    const points = this.series.get(asset);
    if (!points?.length) return null;
    return { from: isoDate(points[0]![0]), to: isoDate(points[points.length - 1]![0]) };
  }

  /** USD price of one unit at a moment: the last daily price at or before it. Null outside the snapshot. */
  quote(asset: PriceKey, atMs: number): PriceQuote | null {
    const at = Math.floor(atMs / 1000);
    if (asset === 'usd') return { usd: 1, date: isoDate(at) };
    const points = this.series.get(asset);
    if (!points?.length || at < points[0]![0]) return null;
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid]![0] <= at) lo = mid;
      else hi = mid - 1;
    }
    const [t, usd] = points[lo]!;
    if (at - t > MAX_STALE_DAYS * DAY) return null;
    return { usd, date: isoDate(t) };
  }
}

export function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
