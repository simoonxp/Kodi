'use strict';
// Repassador "burro" para a NVIDIA. Existe só para navegadores que não conseguem falar direto com a API.
//  - não grava NADA em disco (nem conversas, nem chaves, nem registros);
//  - não escreve o conteúdo dos pedidos em log nenhum;
//  - só aceita dois caminhos: lista de modelos e chat;
//  - a chave vem no próprio pedido, é usada e esquecida.
const crypto = require('crypto');
const sec = require('./security');

const ALLOWED = new Set(['GET /models', 'POST /chat/completions']);
const AUTH_RE = /^Bearer [\w.\-]{20,400}$/;
let inflight = 0;

const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { const e = new Error('grande'); e.status = 413; reject(e); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function relay(req, res, sub, cfg) {
  const out = (status, obj) => {
    if (res.headersSent) return res.end();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (!cfg.relay.enabled) return out(404, { error: 'O repasse pelo servidor está desativado.' });
  if (!ALLOWED.has(`${req.method} ${sub}`)) return out(404, { error: 'Caminho não permitido.' });
  if (!sec.sameOrigin(req)) return out(403, { error: 'Origem não permitida.' });
  if (cfg.accessCode && !safeEqual(req.headers['x-access-code'] || '', cfg.accessCode)) {
    return out(401, { error: 'Código de acesso necessário ou incorreto.', code: 'access' });
  }
  const auth = String(req.headers.authorization || '');
  if (!AUTH_RE.test(auth)) return out(401, { error: 'Chave da NVIDIA ausente ou em formato inválido.', code: 'key' });
  if (!sec.hit('relay:' + sec.clientIp(req), cfg.relay.per5Min, 5 * 60e3)) return out(429, { error: 'Muitos pedidos em pouco tempo. Espere um pouco.' });
  if (inflight >= cfg.relay.maxConcurrent) return out(503, { error: 'O servidor está ocupado agora. Tente de novo em instantes.' });

  let body;
  if (req.method === 'POST') {
    try { body = await readRaw(req, cfg.relay.maxBodyKB * 1024); }
    catch (e) { return out(e.status || 400, { error: e.status === 413 ? 'Pedido grande demais.' : 'Pedido inválido.' }); }
    try { body = JSON.stringify(JSON.parse(body.toString('utf8'))); } catch { return out(400, { error: 'Pedido inválido.' }); }
  }

  inflight++;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let idle;
  const bump = ms => { clearTimeout(idle); idle = setTimeout(() => ac.abort(), ms); };
  try {
    bump(30000);
    let up;
    try {
      up = await fetch(cfg.nvidiaBaseUrl + sub, {
        method: req.method,
        headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: String(req.headers.accept || '*/*') },
        body, signal: ac.signal,
      });
    } catch (e) {
      if (ac.signal.aborted && res.destroyed) return;
      return out(502, { error: 'O servidor não conseguiu falar com a NVIDIA.' });
    }
    res.writeHead(up.status, {
      'Content-Type': up.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
    });
    for await (const chunk of up.body) { bump(120000); if (!res.write(chunk)) await new Promise(r => res.once('drain', r)); }
    res.end();
  } catch (e) {
    try { res.end(); } catch { /* conexão já caiu */ }
  } finally {
    clearTimeout(idle);
    inflight--;
  }
}

module.exports = { relay };
