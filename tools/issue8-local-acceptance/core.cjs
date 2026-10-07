'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SOURCE_SHA = '1f01916b906a7ea39cdd1506cfe4d4722fdc1e30';
const PROJECT = 'demo-catamon-registration';
const BUILD = 'v2.0.187-issue8-recovery';
const embeddedRepo = path.resolve(__dirname,'../..');
const DEFAULT_REPO = fs.existsSync(path.join(embeddedRepo,'.git')) ? embeddedRepo : 'C:/Users/futsa/Documents/Codex/2026-10-03/task-2/katamon';
const PORTS = Object.freeze({ web: 42884, database: 19000, auth: 19099, hub: 19400, logging: 19450 });
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf' };
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function git(repo, args, encoding = 'utf8') { return execFileSync('git', ['-C', repo, ...args], { encoding, windowsHide:true, maxBuffer:128 * 1024 * 1024, stdio:['ignore','pipe','pipe'] }); }
function sourceReader(repo = DEFAULT_REPO) {
  const commit = git(repo, ['rev-parse', '--verify', SOURCE_SHA + '^{commit}']).trim();
  if (commit !== SOURCE_SHA) throw new Error('固定commitが一致しません');
  const entries = git(repo, ['ls-tree','-rz',SOURCE_SHA]).split('\0').filter(Boolean);
  const files = new Map(entries.map(line => { const [meta,name] = line.split('\t'); return [name, meta.split(' ')[0]]; }));
  return { repo, files, read(name) {
    if (files.get(name) !== '100644' && files.get(name) !== '100755') throw new Error('固定commitに通常ファイルがありません');
    return git(repo, ['show', SOURCE_SHA + ':' + name], null);
  } };
}
function replaceOnce(text, find, replacement) {
  if (text.split(find).length !== 2) throw new Error('固定コードの置換境界が不一致です');
  return text.replace(find, replacement);
}
function instrumentIndex(bytes) {
  let source = bytes.toString('utf8');
  if (!source.includes("const BUILD_ID = '" + BUILD + "'")) throw new Error('BUILDが不一致です');
  const db = source.match(/databaseURL: '(https:\/\/[^'\s]+\.firebasedatabase\.app)'/);
  if (!db) throw new Error('DB接続先を特定できません');
  source = source.replace(/apiKey: '[^']+'/, "apiKey: 'demo-local-acceptance'");
  source = replaceOnce(source, "databaseURL: '" + db[1] + "'", "databaseURL: location.origin + '/__lab/db'");
  source = source.replaceAll('https://identitytoolkit.googleapis.com/', "__LAB_AUTH__");
  source = source.replaceAll('https://securetoken.googleapis.com/', "__LAB_TOKEN__");
  // Both endpoints are string literals in the fixed source. No credential is copied to an output file.
  source = source.replaceAll("'__LAB_AUTH__", "location.origin + '/__lab/auth/identitytoolkit.googleapis.com/");
  source = source.replaceAll("'__LAB_TOKEN__", "location.origin + '/__lab/auth/securetoken.googleapis.com/");
  if (source.includes('__LAB_AUTH__') || source.includes('__LAB_TOKEN__')) throw new Error('Auth接続先の置換に失敗しました');
  source = replaceOnce(source, 'new URLSearchParams({ auth: auth.idToken })', "new URLSearchParams({ auth: auth.idToken, ns: '" + PROJECT + "-default-rtdb' })");
  const banner = `<div style="position:fixed;top:0;left:0;z-index:2147483647;background:#623000;color:white;font:12px sans-serif;padding:3px 6px;pointer-events:none">ローカル検証専用 / ${BUILD} / SW無効 / 本番接続遮断</div>`;
  source = replaceOnce(source, '</body>', banner + '</body>');
  return Buffer.from(source);
}
function publicFile(name) {
  if (!name || name.includes('\\') || name.split('/').some(p => p === '..' || p === '.' || p.startsWith('.'))) return false;
  if (!MIME[path.extname(name).toLowerCase()]) return false;
  if (name === 'sw.js') return false;
  return (!name.includes('/') && (['index.html','manifest.webmanifest'].includes(name) || /\.(js|css)$/.test(name))) || /^(assets|shared|generated)\//.test(name);
}
function proxyRoute(url) {
  if (url.pathname.startsWith('/__lab/db/')) {
    const rest = url.pathname.slice('/__lab/db'.length);
    if (!/^\/(rooms|open)(\/[^\s?#]*)?\.json$/.test(rest)) return null;
    const query = new URLSearchParams(url.search);
    if (query.get('auth') === 'owner') return null;
    if (query.has('ns') && query.get('ns') !== PROJECT + '-default-rtdb') return null;
    if ([...query.keys()].some(k => !['auth','ns','orderBy','limitToLast','limitToFirst','startAt','endAt','equalTo','print','format'].includes(k))) return null;
    query.set('ns', PROJECT + '-default-rtdb');
    return { backend:'database', path:rest + '?' + query.toString() };
  }
  if (url.pathname.startsWith('/__lab/auth/')) {
    const rest = url.pathname.slice('/__lab/auth'.length);
    if (!/^\/(identitytoolkit\.googleapis\.com\/v1\/accounts:(signUp|lookup)|securetoken\.googleapis\.com\/v1\/token)$/.test(rest)) return null;
    if ([...url.searchParams.keys()].some(k => k !== 'key')) return null;
    return { backend:'auth', path:rest + url.search };
  }
  return null;
}
function createLab({ source, key, cert, ports = PORTS, shutdownToken, onStop = () => {}, metrics = {} }) {
  if (!key || !cert) throw new Error('TLS証明書ファイルが必要です');
  for (const value of Object.values(ports)) if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('port不正');
  const index = instrumentIndex(source.read('index.html'));
  const status = { sourceSha:SOURCE_SHA, build:BUILD, project:PROJECT, bind:'127.0.0.1', serviceWorkers:'blocked', production:'blocked-by-rewrite-and-CSP', sourceIndexSha256:hash(source.read('index.html')), servedIndexSha256:hash(index) };
  const server = https.createServer({ key, cert }, (req,res) => {
    const expectedHosts = [`127.0.0.1:${ports.web}`,`localhost:${ports.web}`];
    res.setHeader('Content-Security-Policy',CSP);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    const deny = (code=403) => { metrics.denied = (metrics.denied || 0)+1; res.writeHead(code).end('ローカル検証の許可範囲外です'); };
    if (!expectedHosts.includes(req.headers.host)) return deny();
    if (req.headers.origin && !expectedHosts.map(h=>'https://'+h).includes(req.headers.origin)) return deny();
    if (req.headers['sec-fetch-site'] === 'cross-site') return deny();
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return deny();
    let url;
    try { url = new URL(req.url, 'https://' + req.headers.host); if (decodeURIComponent(req.url.split('?')[0]).split('/').some(p=>p==='..'||p==='.') || /%2f|%5c/i.test(req.url.split('?')[0])) return deny(); } catch { return deny(); }
    if (url.pathname === '/__lab/status' && req.method === 'GET') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(status)); }
    if (url.pathname === '/__lab/stop' && req.method === 'POST') {
      if (!shutdownToken || req.headers['x-lab-stop'] !== shutdownToken) return deny();
      res.end('停止します'); setImmediate(onStop); return;
    }
    if (url.pathname === '/sw.js') return deny(410);
    if (url.pathname.startsWith('/__lab/')) {
      const route = proxyRoute(url);
      if (!route || !['GET','PUT','PATCH','POST','DELETE'].includes(req.method)) return deny();
      if (route.backend === 'auth' && req.method !== 'POST') return deny();
      if (req.headers.authorization) return deny(); // Browser may never use emulator admin credentials.
      const headers = {};
      for (const k of ['content-type','accept','if-match','x-firebase-etag','last-event-id']) if (req.headers[k]) headers[k] = req.headers[k];
      metrics.proxied = (metrics.proxied || 0)+1;
      const upstream = http.request({ hostname:'127.0.0.1', port:ports[route.backend], path:route.path, method:req.method, headers }, remote => {
        if (remote.statusCode >= 300 && remote.statusCode < 400) { remote.resume(); return deny(502); }
        for (const k of ['content-type','etag','cache-control']) if (remote.headers[k]) res.setHeader(k,remote.headers[k]);
        res.setHeader('Cache-Control','no-store');
        res.writeHead(remote.statusCode); res.flushHeaders(); remote.pipe(res);
      });
      upstream.on('error',()=>{ if(!res.headersSent) res.writeHead(502); res.end('ローカルemulatorへ接続できません'); });
      res.on('close',()=>upstream.destroy());
      req.pipe(upstream); return;
    }
    if (!['GET','HEAD'].includes(req.method)) return deny();
    let name;
    try { name=decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)); } catch { return deny(); }
    if (!publicFile(name) || !source.files.has(name)) return deny(404);
    try { const body=name==='index.html'?index:source.read(name); res.setHeader('Content-Type',MIME[path.extname(name).toLowerCase()]); res.setHeader('Content-Length',body.length); res.end(req.method==='HEAD'?undefined:body); } catch { deny(404); }
  });
  return { server, status, metrics };
}
module.exports = { SOURCE_SHA, PROJECT, BUILD, DEFAULT_REPO, PORTS, CSP, hash, sourceReader, instrumentIndex, publicFile, proxyRoute, createLab };
