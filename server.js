#!/usr/bin/env node
'use strict';
// Servidor SEM ESTADO: serve o app, repassa chamadas à NVIDIA (sem gravar nada) e,
// só para quem abre direto no computador, oferece o modo Claude Code.
// Não existe aqui banco de dados, conta, senha, sessão, convite nem arquivo de conversa.
if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('Precisa do Node.js 18 ou mais novo. Versão atual: ' + process.version);
  process.exit(1);
}
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('./lib/config');
const sec = require('./lib/security');
const { relay } = require('./lib/relay');
const code = require('./lib/code');

const PUBLIC = path.join(__dirname, 'public');

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const fail = (res, status, error) => send(res, status, { error });

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { const e = new Error('Pedido grande demais.'); e.status = 413; reject(e); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { const j = JSON.parse(raw); resolve(j && typeof j === 'object' ? j : {}); }
      catch { const e = new Error('Pedido inválido.'); e.status = 400; reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- arquivos estáticos ----------
const STATIC = {
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/sw.js': ['sw.js', 'application/javascript; charset=utf-8'],
  '/supabase-config.js': ['supabase-config.js', 'application/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/avatar-kodi.svg': ['avatar-kodi.svg', 'image/svg+xml'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'],
};
function serveStatic(res, pathname, cfg) {
  if (pathname === '/' || pathname === '/index.html') {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/\{\{APP_NAME\}\}/g, cfg.appName.replace(/[<>&"]/g, ''));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
    return true;
  }
  if (pathname === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      name: cfg.appName, short_name: cfg.appName, start_url: '/', scope: '/', display: 'standalone', lang: 'pt-BR',
      background_color: '#191919', theme_color: '#191919',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
    return true;
  }
  const f = STATIC[pathname];
  if (!f) return false;
  try {
    const data = fs.readFileSync(path.join(PUBLIC, f[0]));
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('não encontrado'); }
  return true;
}

// ---------- API pública (nada de pessoal) e modo Claude Code (só local) ----------
async function api(req, res, url, cfg) {
  const p = url.pathname;
  const method = req.method;
  let m;

  if (method === 'GET' && p === '/api/config') {
    return send(res, 200, {
      appName: cfg.appName, defaultModel: cfg.defaultModel, systemPrompt: cfg.systemPrompt,
      maxTokens: cfg.maxTokens, maxContextChars: cfg.maxContextChars, maxMessageChars: cfg.maxMessageChars,
      nvidiaBaseUrl: cfg.nvidiaBaseUrl, relayEnabled: cfg.relay.enabled, accessRequired: !!cfg.accessCode,
    });
  }
  if (method === 'GET' && p === '/api/local') {
    return send(res, 200, { code: !!(cfg.code.enabled && sec.isLocalRequest(req)) });
  }

  if (p.startsWith('/api/code/')) {
    if (!cfg.code.enabled || !sec.isLocalRequest(req)) {
      return fail(res, 403, 'O modo Claude Code só funciona abrindo o app direto no computador do servidor (http://127.0.0.1), nunca pelo link público.');
    }
    if (method !== 'GET') {
      if (!sec.sameOrigin(req)) return fail(res, 403, 'Origem não permitida.');
      if (!/application\/json/i.test(req.headers['content-type'] || '')) return fail(res, 415, 'Tipo de conteúdo inválido.');
    }
    if (method === 'GET' && p === '/api/code/config') return send(res, 200, { defaultCwd: cfg.code.defaultCwd, home: os.homedir() });
    if (method === 'GET' && p === '/api/code/sessions') return send(res, 200, code.listSessions());
    if (method === 'GET' && (m = p.match(/^\/api\/code\/session\/([^/]+)\/([^/]+)$/))) {
      const s = code.getSession(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      return s ? send(res, 200, s) : fail(res, 404, 'Sessão não encontrada.');
    }
    if (method === 'POST' && p === '/api/code/chat') return code.handleChat(req, res, await readJson(req), cfg);
  }
  return fail(res, 404, 'Não encontrado.');
}

const server = http.createServer(async (req, res) => {
  const cfg = loadConfig();
  let nvOrigin = '';
  try { nvOrigin = new URL(cfg.nvidiaBaseUrl).origin; } catch { /* sem conexão direta */ }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${nvOrigin} ${process.env.IA_EXTRA_CONNECT || ""} https://*.supabase.co; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  try {
    if (url.pathname.startsWith('/relay/v1/')) return await relay(req, res, url.pathname.slice('/relay/v1'.length), cfg);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url, cfg);
    if (req.method === 'GET' && serveStatic(res, url.pathname, cfg)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
  } catch (e) {
    if (e.status !== 413 && e.status !== 400) console.error('[erro]', e && e.message);   // nunca imprime conteúdo de pedidos
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Erro interno do servidor.');
    else res.end();
  }
});

const cfg0 = loadConfig();
server.listen(cfg0.port, '127.0.0.1', () => {
  console.log(`${cfg0.appName} rodando em http://127.0.0.1:${cfg0.port}`);
  console.log('Este servidor não guarda contas, conversas nem chaves de ninguém.');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`A porta ${cfg0.port} já está em uso. Feche o outro programa ou troque "port" no config.json.`);
  else console.error(e.message);
  process.exit(1);
});
