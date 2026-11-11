// Builds the website into site/dist: core/ and site/app.ts compiled to browser JavaScript by TypeScript
// (imports rewritten from .ts to .js, no bundler), the page, the committed price snapshot, and the version.
//   npm run site:build    then    npm run site:serve
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}site/dist/`;

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '-p', `${root}tsconfig.site.json`], { stdio: 'inherit' });

for (const file of ['index.html', 'styles.css']) copyFileSync(`${root}site/${file}`, `${dist}${file}`);
mkdirSync(`${dist}prices`, { recursive: true });
for (const file of readdirSync(`${root}data/prices`)) if (file.endsWith('.json')) copyFileSync(`${root}data/prices/${file}`, `${dist}prices/${file}`);
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string };
writeFileSync(`${dist}version.json`, JSON.stringify({ version }));
writeFileSync(`${dist}.nojekyll`, ''); // GitHub Pages: serve files as they are

console.log(`built site/dist (Tickmark ${version})`);
