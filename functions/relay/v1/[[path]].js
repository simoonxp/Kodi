// Repassador "burro" para a NVIDIA, só para navegadores que não conseguem falar direto (CORS).
// Não grava nada, não registra conteúdo nem chave; a chave vem no pedido, é usada e esquecida.
const BASE = 'https://integrate.api.nvidia.com/v1';
const ALLOWED = new Set(['GET /models', 'POST /chat/completions']);
const AUTH_RE = /^Bearer [\w.\-]{20,400}$/;
const MAX_BODY = 1024 * 1024;

const json = (status, obj) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });
const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function onRequest({ request, env, params }) {
  if (env.RELAY_DISABLED === '1') return json(404, { error: 'O repasse pelo servidor está desativado.' });
  const sub = '/' + [].concat(params.path || []).join('/');
  if (!ALLOWED.has(`${request.method} ${sub}`)) return json(404, { error: 'Caminho não permitido.' });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'Origem não permitida.' });
  if (env.ACCESS_CODE && !(await safeEqual(request.headers.get('x-access-code') || '', env.ACCESS_CODE))) {
    return json(401, { error: 'Código de acesso necessário ou incorreto.', code: 'access' });
  }
  const auth = request.headers.get('authorization') || '';
  if (!AUTH_RE.test(auth)) return json(401, { error: 'Chave da NVIDIA ausente ou em formato inválido.', code: 'key' });

  let body;
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'Pedido grande demais.' });
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'Pedido grande demais.' });
    try { body = JSON.stringify(JSON.parse(text)); } catch { return json(400, { error: 'Pedido inválido.' }); }
  }
  let up;
  try {
    up = await fetch((env.NVIDIA_BASE_URL || BASE).replace(/\/+$/, '') + sub, {
      method: request.method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: request.headers.get('accept') || '*/*' },
      body, signal: request.signal,
    });
  } catch { return json(502, { error: 'O servidor não conseguiu falar com a NVIDIA.' }); }
  return new Response(up.body, { status: up.status, headers: {
    'Content-Type': up.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store',
  } });
}
