// Serve the page locally the way GitHub Pages does: part files are joined on request.
//   npm run serve   then open http://localhost:8017
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = Number(process.env.PORT ?? 8017);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.gz': 'application/gzip'};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let body = null;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) body = fs.readFileSync(file);
  else if (file.endsWith('.gz')) {
    const dir = path.dirname(file), base = path.basename(file);
    const parts = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(base + '.part')).sort() : [];
    if (parts.length) body = Buffer.concat(parts.map(f => fs.readFileSync(path.join(dir, f))));
  }
  if (!body) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream'}).end(body);
}).listen(port, () => console.log(`Jukebox at http://localhost:${port}`));
