// Builds the website into site/dist: the Vite + React app in site/ (bundling core/ for the browser), the committed
// price snapshot, the demo report, the measurement's headline totals, and the version.
//   npm run site:build    then    npm run site:serve
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { measureJson } from '../vite.config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}site/dist/`;

await build({ configFile: `${root}vite.config.ts`, logLevel: 'warn' });

mkdirSync(`${dist}prices`, { recursive: true });
for (const file of readdirSync(`${root}data/prices`)) if (file.endsWith('.json')) copyFileSync(`${root}data/prices/${file}`, `${dist}prices/${file}`);
mkdirSync(`${dist}demo`, { recursive: true });
copyFileSync(`${root}demo/report.json`, `${dist}demo/report.json`);
writeFileSync(`${dist}measure.json`, await measureJson());
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string };
writeFileSync(`${dist}version.json`, JSON.stringify({ version }));
writeFileSync(`${dist}.nojekyll`, ''); // GitHub Pages: serve files as they are

console.log(`built site/dist (Tickmark ${version})`);
