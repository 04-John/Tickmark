// Refresh data/prices/*.json from CoinGecko's free API (daily prices, last 364 days; the free tier allows 365).
// Usage: npm run prices:update
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PriceSeries } from '../core/prices.ts';

const ASSETS: [PriceSeries['asset'], string][] = [
  ['near', 'near'],
  ['eth', 'ethereum'],
  ['btc', 'bitcoin'],
  ['zec', 'zcash'],
  ['sol', 'solana'],
  ['aurora', 'aurora-near'],
];

const dir = fileURLToPath(new URL('../data/prices/', import.meta.url));
const to = Math.floor(Date.now() / 1000);
const from = to - 364 * 86_400;

// Optional args pick assets: `npm run prices:update -- aurora near`
const only = process.argv.slice(2);

async function get(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'tickmark-price-snapshot' } });
    if (res.status !== 429 || attempt === 3) return res;
    console.log('rate limited; waiting 65 s');
    await new Promise((resolve) => setTimeout(resolve, 65_000));
  }
}

for (const [asset, coingeckoId] of ASSETS.filter(([a]) => !only.length || only.includes(a))) {
  const url = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`${coingeckoId}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { prices?: [number, number][] };
  if (!body.prices?.length) throw new Error(`${coingeckoId}: no prices in response`);
  const points = body.prices.map(([ms, usd]) => [Math.floor(ms / 1000), Math.round(usd * 1e6) / 1e6] as [number, number]);
  const series: PriceSeries = { asset, coingeckoId, fetchedAt: new Date().toISOString(), points };
  writeFileSync(`${dir}${asset}.json`, JSON.stringify(series) + '\n');
  console.log(`${asset}: ${points.length} daily prices, ${new Date(points[0]![0] * 1000).toISOString().slice(0, 10)} to ${new Date(points.at(-1)![0] * 1000).toISOString().slice(0, 10)}`);
  await new Promise((resolve) => setTimeout(resolve, 2500)); // stay well inside the free rate limit
}
