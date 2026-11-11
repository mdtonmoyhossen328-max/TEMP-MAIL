/* MailVault — zero-dependency static server + Mail.tm API proxy.
   Run: node server.mjs   →   http://localhost:8123
   The proxy exists because api.mail.tm only allows its own origin via CORS. */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8123;
const UPSTREAM = 'https://api.mail.tm';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function proxyApi(req, res, pathname, search) {
  const target = new URL(UPSTREAM + (pathname.slice(4) || '/') + search);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = {
      'accept': req.headers['accept'] || 'application/json',
      'user-agent': 'mailvault/1.0'
    };
    if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (body.length) headers['content-length'] = body.length;

    const preq = https.request(target, { method: req.method, headers }, pres => {
      const out = {
        'content-type': pres.headers['content-type'] || 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      };
      if (pres.headers['retry-after']) out['retry-after'] = pres.headers['retry-after'];
      res.writeHead(pres.statusCode || 502, out);
      pres.pipe(res);
    });
    preq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: 'Cannot reach the Mail.tm server. Please try again in a moment.' }));
    });
    preq.setTimeout(25000, () => preq.destroy(new Error('upstream timeout')));
    if (body.length) preq.write(body);
    preq.end();
  });
  req.on('error', () => { if (!res.headersSent) res.writeHead(400); res.end(); });
}

function serveStatic(res, pathname) {
  let file = path.normalize(path.join(__dirname, decodeURIComponent(pathname)));
  if (!file.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(__dirname, 'index.html');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
}

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); }
  catch (e) { res.writeHead(400); res.end(); return; }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    proxyApi(req, res, url.pathname, url.search);
    return;
  }
  serveStatic(res, url.pathname);
}).listen(PORT, () => {
  console.log('MailVault running → http://localhost:' + PORT);
});