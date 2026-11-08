'use strict';
// Utilidades de segurança do servidor. Aqui NÃO existe banco de dados, conta, senha ou sessão.

// ---------- limite de pedidos ----------
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  const b = (buckets.get(key) || []).filter(t => now - t < windowMs);
  buckets.set(key, b);
  if (b.length >= max) return false;
  b.push(now);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some(t => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();

// ---------- origem do pedido ----------
const FORWARD_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'tailscale-user-login'];
const hostName = req => String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();

function clientIp(req) {
  const h = req.headers;
  return String(h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x');
}

// "Local" = veio direto do próprio computador, sem túnel/proxy no meio.
function isLocalRequest(req) {
  const ra = req.socket.remoteAddress || '';
  const loop = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  const hn = hostName(req);
  const hostOk = hn === '127.0.0.1' || hn === 'localhost' || hn === '[::1]';
  return loop && hostOk && !FORWARD_HEADERS.some(k => k in req.headers);
}

// Bloqueia pedidos vindos de outro site: se há Origin, tem de ser o mesmo host.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers.host).toLowerCase(); } catch { return false; }
}

module.exports = { hit, clientIp, isLocalRequest, sameOrigin, hostName };
