// The website: a Vite + React app in site/ over the same core/ engine the command line uses. No server at runtime.
// In development the committed data (prices, the demo report, the measurement) is served from where it lives in the
// repository; scripts/build-site.ts copies the same files into site/dist for GitHub Pages.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Serves prices/*.json, demo/report.json, measure.json and version.json during `npm run site:dev`. */
function committedData(): Plugin {
  return {
    name: 'tickmark-committed-data',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        let file: string | null = null;
        let body: string | null = null;
        if (/^\/prices\/[a-z]+\.json$/.test(path)) file = `${root}data${path}`;
        else if (path === '/demo/report.json') file = `${root}demo/report.json`;
        else if (path === '/measure.json') body = await measureJson();
        else if (path === '/version.json') body = JSON.stringify({ version: JSON.parse(await readFile(`${root}package.json`, 'utf8')).version });
        if (!file && body === null) return next();
        try {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(body ?? (await readFile(file!)));
        } catch {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    },
  };
}

/** Only the headline totals of data/measure travel to the browser. */
export async function measureJson(): Promise<string> {
  const m = JSON.parse(await readFile(`${root}data/measure/last-12-months.json`, 'utf8')) as { measuredAt: string; totals: Record<string, unknown> };
  const { testDaosLeftOut: _left, failed: _failed, ...totals } = m.totals;
  return JSON.stringify({ measuredAt: m.measuredAt, totals });
}

export default defineConfig({
  root: `${root}site`,
  base: './',
  publicDir: false,
  plugins: [committedData()],
  build: { outDir: `${root}site/dist`, emptyOutDir: true, target: 'es2022' },
  server: { port: 5180 },
  preview: { port: 5180 },
});
