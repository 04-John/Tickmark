// Node-only helpers: load the committed price snapshot from data/prices.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PriceBook, type PriceSeries } from '../core/prices.ts';

const PRICES_DIR = fileURLToPath(new URL('../data/prices/', import.meta.url));

export function loadPriceBook(dir = PRICES_DIR): PriceBook {
  const series = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as PriceSeries);
  return new PriceBook(series);
}
