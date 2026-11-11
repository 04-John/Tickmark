// The shared pipeline (core/pipeline.ts) with what Node supplies: prices from data/prices and the package version.
import { readFileSync } from 'node:fs';
import * as core from '../core/pipeline.ts';
import type { PriceBook } from '../core/prices.ts';
import { loadPriceBook } from './load.ts';

export type { Loaded, PipelineOptions } from '../core/pipeline.ts';

export const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

let prices: PriceBook | undefined;
const deps = () => ({ prices: (prices ??= loadPriceBook()), version: VERSION });

export const load = (dao: string, options: core.PipelineOptions) => core.load(dao, options, deps());
export const makeBooks = (dao: string, options: core.PipelineOptions) => core.makeBooks(dao, options, deps());
