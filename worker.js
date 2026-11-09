// Kodi na Cloudflare Workers: o site é estático (pasta public/); este arquivo só trata
// /api/config, /api/local e o repasse /relay/v1/*. Não grava nada e não registra conteúdo nem chave.
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

async function relay(request, env, sub) {
  if (env.RELAY_DISABLED === '1') return json(404, { error: 'O repasse pelo servidor está desativado.' });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/config' && request.method === 'GET') {
      return json(200, {
        appName: 'Kodi',
        defaultModel: env.DEFAULT_MODEL || 'meta/llama-3.3-70b-instruct',
        systemPrompt: 'Você é o Kodi, um assistente de IA criado por Felipe Simon. Quando perguntarem quem você é ou quem te criou, apresente-se como Kodi, feito por Felipe Simon. Se perguntarem qual modelo de linguagem funciona por trás, diga com honestidade que o Kodi usa modelos de linguagem disponibilizados pela NVIDIA e que o modelo pode variar, sem inventar detalhes. Responda no mesmo idioma do usuário, de forma clara e direta.',
        maxTokens: 4096, maxContextChars: 48000, maxMessageChars: 20000,
        nvidiaBaseUrl: BASE,
        relayEnabled: env.RELAY_DISABLED !== '1',
        accessRequired: !!env.ACCESS_CODE,
      });
    }
    if (p === '/api/local' && request.method === 'GET') return json(200, { code: false });   // modo Claude Code só existe no computador de quem instala
    if (p.startsWith('/relay/v1/')) return relay(request, env, p.slice('/relay/v1'.length));
    if (p.startsWith('/api/')) return json(404, { error: 'Não encontrado.' });
    return env.ASSETS.fetch(request);
  },
};
