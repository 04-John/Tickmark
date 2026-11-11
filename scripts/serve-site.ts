// Serves site/dist on http://localhost:5180 for a local look before publishing. Static files only.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../site/dist/', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const port = Number(process.env.PORT ?? 5180);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.includes('..')) {
    res.writeHead(400).end();
    return;
  }
  try {
    const body = await readFile(dist + (path === '' || path.endsWith('/') || path.endsWith('\\') ? `${path}index.html` : path));
    res.writeHead(200, { 'content-type': `${TYPES[extname(path) || '.html'] ?? 'application/octet-stream'}; charset=utf-8` }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Tickmark site on http://localhost:${port}`));
