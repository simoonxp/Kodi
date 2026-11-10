'use strict';
// Tudo o que é pessoal (conversas, chave, preferências) fica no navegador desta pessoa (IndexedDB).
// O servidor só entrega este programa e, se o navegador não puder falar direto com a NVIDIA, repassa a chamada.
(() => {
  const VERSION = '2.4.0';   // sobe a cada atualização do app; aparece ao lado do nome
  // ---------- utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const base = p => (p || '').replace(/\/+$/, '').split('/').pop() || p || '';
  const shortModel = m => String(m || '').split('/').pop();
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
  const ICON = {
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19z"/></svg>',
  };
  let cfg = {};
  const S = {
    appName: 'IA', mode: 'chat', codeMode: false, codeCfg: null,
    key: null, conn: null, access: '', model: '', models: [], good: [], bad: [],
    chats: [], chat: null, messages: [], codeSessions: [],
    current: { id: null, project: null, cwd: null },
    search: '', streaming: false, abort: null, deferred: null,
  };
  const msgs = $('#msgs');

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
  }
  const friendly = (message, code) => Object.assign(new Error(message), { friendly: true, code });

  // ======================================================================
  // Armazenamento local (IndexedDB; se o navegador não permitir, fica só na memória)
  // ======================================================================
  const SYNCED = new Set(['model', 'good', 'bad', 'quota', 'usage']);   // preferências que vão para a conta (nunca a chave da NVIDIA)
  const Store = (() => {
    let db = null;
    const mem = { chats: new Map(), msgs: new Map(), meta: new Map() };
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
    async function init() {
      if (!('indexedDB' in window)) return false;
      try {
        db = await new Promise((res, rej) => {
          const o = indexedDB.open('ia-pessoal', 1);
          o.onupgradeneeded = () => {
            const d = o.result;
            d.createObjectStore('chats', { keyPath: 'id' });
            d.createObjectStore('msgs', { keyPath: 'id' });
            d.createObjectStore('meta', { keyPath: 'k' });
          };
          o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); o.onblocked = () => rej(new Error('bloqueado'));
        });
        return true;
      } catch { db = null; return false; }
    }
    async function put(store, val) {
      if (!db) { mem[store].set(val.id !== undefined ? val.id : val.k, val); return; }
      const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(val); await done(t);
    }
    async function get(store, key) {
      if (!db) return mem[store].get(key);
      return req(db.transaction(store).objectStore(store).get(key));
    }
    async function all(store) {
      if (!db) return [...mem[store].values()];
      return req(db.transaction(store).objectStore(store).getAll());
    }
    async function del(store, key) {
      if (!db) { mem[store].delete(key); return; }
      const t = db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); await done(t);
    }
    return {
      init, isPersistent: () => !!db,
      listChats: async () => (await all('chats')).sort((a, b) => b.updated - a.updated),
      getMessages: async id => { const r = await get('msgs', id); return r ? r.messages : []; },
      saveChat: chat => put('chats', chat),
      saveMessages: (id, messages) => put('msgs', { id, messages }),
      deleteChat: async id => { await del('chats', id); await del('msgs', id); },
      getMeta: async k => { const r = await get('meta', k); return r ? r.v : null; },
      setMeta: async (k, v) => { await put('meta', { k, v }); if (SYNCED.has(k) && Store.onSetting) Store.onSetting(); },
      delMeta: async k => { await del('meta', k); if (SYNCED.has(k) && Store.onSetting) Store.onSetting(); },
      clearAll: async () => {
        for (const s of ['chats', 'msgs', 'meta']) {
          if (!db) mem[s].clear(); else { const t = db.transaction(s, 'readwrite'); t.objectStore(s).clear(); await done(t); }
        }
      },
      exportAll: async () => {
        const chats = [];
        for (const c of await all('chats')) chats.push({ ...c, messages: await (async () => { const r = await get('msgs', c.id); return r ? r.messages : []; })() });
        return { app: 'ia-backup', version: 1, exportedAt: new Date().toISOString(), chats };
      },
    };
  })();

  // ======================================================================
  // Conexão com a NVIDIA: direta, ou repassada pelo servidor quando o navegador não deixa
  // ======================================================================
  const NOT_CHAT = /(embed|rerank|guard|reward|safety|parse|clip|retriev|vila|neva|paligemma|cosmos|riva|nemoretriever|bge|e5-|arctic-embed|nv-)/i;
  function parseModels(j) {
    const ids = ((j && j.data) || []).map(m => m && m.id).filter(id => typeof id === 'string' && id.length < 120);
    return [...new Set(ids)].filter(id => !NOT_CHAT.test(id)).sort((a, b) => a.localeCompare(b));
  }
  const timeout = ms => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

  async function askAccessCode() {
    const c = prompt('Este servidor pede um código de acesso (quem te convidou deve ter passado). Digite aqui:');
    return c && c.trim() ? c.trim() : '';
  }

  // Descobre como falar com a NVIDIA usando a chave informada.
  async function detectConn(key) {
    const probe = (url, extra = {}) => fetch(url, { headers: { Authorization: 'Bearer ' + key, ...extra }, credentials: 'omit', cache: 'no-store', signal: timeout(12000) });
    try {                                            // 1) direto, sem passar pelo servidor do app
      const r = await probe(cfg.nvidiaBaseUrl + '/models');
      if (r.status === 401 || r.status === 403) return { invalid: true };
      if (r.ok) return { conn: 'direct', models: parseModels(await r.json()) };
    } catch { /* bloqueado pelo navegador (CORS) ou sem rede: tenta pelo servidor */ }
    if (!cfg.relayEnabled) return { offline: true };
    for (let i = 0; i < 2; i++) {                    // 2) repassado pelo servidor
      try {
        const r = await probe('/relay/v1/models', S.access ? { 'X-Access-Code': S.access } : {});
        if (r.ok) return { conn: 'relay', models: parseModels(await r.json()) };
        const j = await r.json().catch(() => null);
        if (r.status === 401 && j && j.code === 'access') { const c = await askAccessCode(); if (!c) return { offline: true, access: true }; S.access = c; continue; }
        if (r.status === 401 || r.status === 403) return { invalid: true };
        return { offline: true };
      } catch { return { offline: true }; }
    }
    return { offline: true, access: true };
  }

  async function nvFetch(path, { method = 'GET', body, signal } = {}) {
    if (!S.key) throw friendly('Cadastre sua chave da NVIDIA em Configurações.', 'no_key');
    const direct = S.conn === 'direct';
    const go = () => {
      const headers = { Authorization: 'Bearer ' + S.key };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (!direct && S.access) headers['X-Access-Code'] = S.access;
      return fetch((direct ? cfg.nvidiaBaseUrl : '/relay/v1') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'omit', cache: 'no-store' });
    };
    const netErr = () => friendly(direct
      ? 'Não consegui falar com a NVIDIA. Verifique a internet; se continuar, abra Configurações e toque em "Testar de novo".'
      : 'Não consegui falar com o servidor do app. Verifique a internet.');
    let res;
    try { res = await go(); } catch (e) { if (e.name === 'AbortError') throw e; throw netErr(); }
    if (!direct && res.status === 401) {
      const j = await res.clone().json().catch(() => null);
      if (j && j.code === 'access') {
        const c = await askAccessCode();
        if (c) { S.access = c; await Store.setMeta('access', c); try { res = await go(); } catch (e) { if (e.name === 'AbortError') throw e; throw netErr(); } }
      }
    }
    return res;
  }

  async function upstreamError(res) {
    let text = ''; try { text = await res.text(); } catch { /* sem corpo */ }
    let j = null, detail = '';
    try { j = JSON.parse(text); detail = j.detail || (j.error && (j.error.message || j.error)) || j.message || ''; if (typeof detail !== 'string') detail = JSON.stringify(detail); }
    catch { detail = text; }
    detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
    const s = res.status;
    if (j && j.code === 'access') return friendly('O código de acesso do servidor está incorreto.');
    if (s === 401 || s === 403) return friendly('A chave da NVIDIA é inválida, expirou ou não tem acesso a este modelo. Confira em Configurações.');
    if (s === 404) return friendly(`O modelo ${S.model} não está disponível para a sua conta. Escolha outro no seletor lá em cima.`, 'model404');
    if (s === 413) return friendly('Mensagem grande demais.');
    if (s === 429) return friendly('Você atingiu o limite de uso. Espere um pouco e tente de novo.');
    if (s >= 500) return friendly(S.conn === 'relay' && j && j.error ? j.error : `A NVIDIA está com problemas agora (erro ${s}). Tente de novo em instantes.`);
    return friendly('A NVIDIA recusou o pedido' + (detail ? ': ' + detail : ` (erro ${s}).`));
  }

  async function nvModels() {
    const res = await nvFetch('/models');
    if (!res.ok) throw await upstreamError(res);
    return parseModels(await res.json());
  }

  async function* nvStream({ model, messages, signal }) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    let idle;
    const bump = ms => { clearTimeout(idle); idle = setTimeout(() => ac.abort(), ms); };
    try {
      bump(90000);
      const body = { model, messages, stream: true, max_tokens: cfg.maxTokens, stream_options: { include_usage: true } };
      let res = await nvFetch('/chat/completions', { method: 'POST', body, signal: ac.signal });
      if (res.status === 400) {                     // alguns modelos não aceitam stream_options: tenta de novo sem pedir o uso
        delete body.stream_options;
        res = await nvFetch('/chat/completions', { method: 'POST', body, signal: ac.signal });
      }
      if (!res.ok) throw await upstreamError(res);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bump(120000);
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let j; try { j = JSON.parse(data); } catch { continue; }
          if (j.error) throw friendly('A NVIDIA devolveu um erro: ' + String(j.error.message || j.error.code || 'desconhecido').slice(0, 200));
          if (j.usage && typeof j.usage.total_tokens === 'number') yield { type: 'u', usage: j.usage };
          const d = j.choices && j.choices[0] && j.choices[0].delta;
          if (!d) continue;
          const r = d.reasoning_content || d.reasoning;
          if (r) yield { type: 'r', text: r };
          if (d.content) yield { type: 'd', text: d.content };
        }
      }
    } catch (e) {
      if (ac.signal.aborted || e.name === 'AbortError') {
        if (signal && signal.aborted) return;                   // o usuário clicou em parar
        throw friendly(`O modelo ${model} demorou demais para responder (provavelmente está sobrecarregado ou fora do ar).`, 'timeout');
      }
      throw e;
    } finally {
      clearTimeout(idle);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }


  // ======================================================================
  // Controle de tokens (só neste navegador; conta o que passou pelo Kodi, não o saldo da conta NVIDIA)
  // ======================================================================
  const fmtTok = n => n < 1000 ? String(Math.round(n)) : n < 1e6 ? (n / 1000).toFixed(n < 10000 ? 1 : 0).replace('.', ',') + ' mil' : (n / 1e6).toFixed(1).replace('.', ',') + ' mi';
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const estTokens = chars => Math.max(1, Math.round(chars / 3.6));
  async function getUsage() { try { return (await Store.getMeta('usage')) || { days: {}, models: {} }; } catch { return { days: {}, models: {} }; } }
  async function addUsage(model, p, c, est) {
    const u = await getUsage();
    const d = (u.days[dayKey()] = u.days[dayKey()] || { p: 0, c: 0, n: 0, est: 0 });
    d.p += p; d.c += c; d.n += 1; if (est) d.est += 1;
    const m = (u.models[model] = u.models[model] || { p: 0, c: 0, n: 0 });
    m.p += p; m.c += c; m.n += 1;
    const keep = Object.keys(u.days).sort().slice(-120); for (const k of Object.keys(u.days)) if (!keep.includes(k)) delete u.days[k];
    try { await Store.setMeta('usage', u); } catch { /* sem espaço */ }
    refreshUsageBadge();
  }
  async function refreshUsageBadge() {
    const u = await getUsage(); const t = u.days[dayKey()];
    $('#usageTokens').textContent = t ? `Hoje: ${fmtTok(t.p + t.c)} tokens` : 'Hoje: 0 tokens';
    refreshQuota();
  }
  function usageLabel(us) { return us ? `${us.est ? '~' : ''}${fmtTok(us.p + us.c)} tokens` : ''; }
  function usageTip(us) { return us ? `${us.est ? 'Estimado. ' : ''}${fmtTok(us.p)} tokens enviados + ${fmtTok(us.c)} recebidos` : ''; }
  async function renderUsage() {
    const u = await getUsage(); const days = Object.keys(u.days).sort();
    const sum = keys => keys.reduce((a, k) => { const d = u.days[k]; a.p += d.p; a.c += d.c; a.n += d.n; return a; }, { p: 0, c: 0, n: 0 });
    const today = sum([dayKey()].filter(k => u.days[k]));
    const week = sum(days.filter(k => (Date.now() - new Date(k + 'T12:00:00').getTime()) < 7 * 864e5));
    const all = sum(days);
    const row = (name, x) => `<tr><td>${name}</td><td>${fmtTok(x.p + x.c)}</td><td>${fmtTok(x.p)}</td><td>${fmtTok(x.c)}</td><td>${x.n}</td></tr>`;
    const models = Object.entries(u.models).sort((a, b) => (b[1].p + b[1].c) - (a[1].p + a[1].c)).slice(0, 6);
    $('#usageBox').innerHTML = `<table class="utab"><thead><tr><th></th><th>Total</th><th>Enviados</th><th>Recebidos</th><th>Msgs</th></tr></thead><tbody>${row('Hoje', today)}${row('7 dias', week)}${row('Tudo', all)}</tbody></table>` +
      (models.length ? '<div class="muted small" style="margin-top:8px">Por modelo (total):</div>' + models.map(([id, x]) => `<div class="mline"><span>${esc(id)}</span><b>${fmtTok(x.p + x.c)}</b></div>`).join('') : '<p class="muted small">Ainda sem uso registrado.</p>');
  }


  // Cota estimada: a NVIDIA conta CRÉDITOS por pedido (~1 por mensagem) e não informa o saldo por API.
  // O Kodi soma os pedidos feitos aqui neste mês; o usuário pode corrigir com o saldo que vê em build.nvidia.com.
  const monthKey = () => dayKey().slice(0, 7);
  async function getQuota() {
    let q = null; try { q = await Store.getMeta('quota'); } catch { /* sem dados */ }
    q = q || { limit: 1000, adj: 0, month: monthKey() };
    if (q.month !== monthKey()) q = { limit: q.limit || 1000, adj: 0, month: monthKey() };
    return q;
  }
  async function quotaState() {
    const u = await getUsage(); const q = await getQuota(); const mk = monthKey();
    const mine = Object.entries(u.days).filter(([k]) => k.startsWith(mk)).reduce((n, [, d]) => n + d.n + (d.pr || 0), 0);
    const used = Math.max(0, mine + q.adj);
    const left = Math.max(0, q.limit - used);
    const pct = q.limit ? Math.min(100, Math.round(used / q.limit * 100)) : 0;
    return { q, used, left, pct, mine };
  }
  const quotaColor = pct => pct >= 90 ? 'var(--err)' : pct >= 70 ? '#e0b04a' : 'var(--accent)';
  async function refreshQuota() {
    const { q, used, left, pct } = await quotaState();
    const pctText = used > 0 && pct === 0 ? 'menos de 1%' : pct + '%';
    const fill = $('#qfill'); fill.style.width = Math.max(pct, used > 0 ? 1 : 0) + '%'; fill.style.background = quotaColor(pct);
    $('#qtext').textContent = `Restam ~${left} de ${q.limit} mensagens (${pctText} usado)`;
    const big = $('#qbigfill');
    if (big) {
      big.style.width = Math.max(pct, used > 0 ? 1 : 0) + '%'; big.style.background = quotaColor(pct);
      $('#qbigtext').textContent = `Você usou ${used} de ${q.limit} mensagens neste mês (${pctText}). Restam cerca de ${left}.`;
    }
  }

  // ---------- markdown ----------
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[i] + '</code>');
  }
  const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
  function md(src) {
    const blocks = [];
    src = src.replace(/```([^\n]*)\n([\s\S]*?)(```|$)/g, (m, lang, c) => {
      blocks.push(`<div class="code"><div class="codehead"><span>${esc(lang.trim())}</span><button class="copy" type="button">Copiar</button></div><pre><code>${esc(c.replace(/\n$/, ''))}</code></pre></div>`);
      return '\u0000' + (blocks.length - 1) + '\u0000';
    });
    const lines = esc(src).split('\n');
    const out = []; let list = null, para = [], quote = [];
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
    const flushQuote = () => { if (quote.length) { out.push('<blockquote>' + inline(quote.join('<br>')) + '</blockquote>'); quote = []; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]; let m;
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushAll();
        const head = cells(line); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        i--;
        out.push('<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushAll(); const n = m[1].length + 1; out.push(`<h${n}>${inline(m[2])}</h${n}>`); }
      else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); out.push('<hr>'); }
      else if ((m = line.match(/^&gt;\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); }
      else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
      else if (line.trim() === '') flushAll();
      else { flushList(); flushQuote(); para.push(line); }
    }
    flushAll();
    return out.join('').replace(/<p>\u0000(\d+)\u0000<\/p>/g, (m, i) => blocks[i]).replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[i]);
  }
  function splitThink(raw) {
    const m = raw.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
    return m ? { think: m[1].trim(), body: raw.slice(m[0].length) } : { think: '', body: raw };
  }

  // ---------- rolagem e mensagens ----------
  const nearBottom = () => { const s = $('#scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 140; };
  const scrollDown = force => { const s = $('#scroll'); if (force || nearBottom()) s.scrollTop = s.scrollHeight; };
  function addUser(text) {
    const d = document.createElement('div'); d.className = 'user';
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text;
    d.appendChild(b); msgs.appendChild(d); return d;
  }
  function showError(text) {
    const e = document.createElement('div'); e.className = 'err-box'; e.textContent = text; msgs.appendChild(e); scrollDown(true); return e;
  }
  const fmtSecs = ms => { const t = Math.floor(ms / 1000); return t < 60 ? t + 's' : Math.floor(t / 60) + 'min ' + String(t % 60).padStart(2, '0') + 's'; };
  class AsstView {
    constructor(live = false) {
      this.el = document.createElement('div'); this.el.className = 'asst';
      this.el.innerHTML = '<details class="think" hidden><summary>Raciocínio do modelo</summary><div class="thinkbody"></div></details><div class="txt"></div>';
      this.think = $('.think', this.el); this.thinkBody = $('.thinkbody', this.el); this.txt = $('.txt', this.el);
      this.raw = ''; this.reasoning = ''; this.pending = false;
      this.typing = null; this.t0 = Date.now(); this.iv = null;
      if (live) {                                   // resposta ao vivo: mostra há quanto tempo a IA está pensando
        this.typing = document.createElement('div'); this.typing.className = 'typing';
        this.typing.innerHTML = '<i>●</i> <span class="lbl">pensando…</span> <span class="clock">0s</span>';
        this.lbl = $('.lbl', this.typing); this.clock = $('.clock', this.typing);
        this.el.appendChild(this.typing);
        this.iv = setInterval(() => { this.clock.textContent = fmtSecs(Date.now() - this.t0); }, 500);
      }
      msgs.appendChild(this.el);
    }
    stopClock() { if (this.iv) { clearInterval(this.iv); this.iv = null; } if (this.typing) { this.typing.remove(); this.typing = null; } }
    addText(t) { this.raw += t; this.schedule(); }
    addReasoning(t) { this.reasoning += t; this.schedule(); }
    set(raw) { this.raw = raw; this.render(); }
    schedule() {
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => { this.pending = false; this.render(); scrollDown(); });
    }
    render() {
      if (this.typing && (this.raw.trim() || this.reasoning)) this.lbl.textContent = this.raw.trim() ? 'escrevendo…' : 'raciocinando…';
      const { think, body } = splitThink(this.raw);
      const rs = [this.reasoning, think].filter(Boolean).join('\n').trim();
      if (rs) { this.think.hidden = false; this.thinkBody.textContent = rs; }
      this.txt.innerHTML = md(body);
    }
    finish(info = '', tip = '') {
      const took = this.iv ? Date.now() - this.t0 : 0;
      this.stopClock(); this.render();
      if (!this.raw.trim()) return;
      const a = document.createElement('div'); a.className = 'actions';
      a.innerHTML = '<button type="button" class="copyall">Copiar resposta</button>' + (took || info ? `<span class="took" title="${esc(tip)}">${[took ? fmtSecs(took) : '', info].filter(Boolean).join(' · ')}</span>` : '');
      this.el.appendChild(a);
    }
    remove() { this.stopClock(); this.el.remove(); }
  }
  function copyText(text, done) {
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* sem suporte */ }
      ta.remove(); done && done();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done && done(), fallback);
    else fallback();
  }
  msgs.addEventListener('click', e => {
    const c = e.target.closest('.copy');
    if (c) { copyText($('code', c.closest('.code')).textContent, () => { c.textContent = 'Copiado!'; setTimeout(() => { c.textContent = 'Copiar'; }, 1500); }); return; }
    const all = e.target.closest('.copyall');
    if (all) {
      const t = $('.txt', all.closest('.asst'));
      copyText(t.innerText, () => { all.textContent = 'Copiado!'; setTimeout(() => { all.textContent = 'Copiar resposta'; }, 1500); });
    }
  });

  function welcome() {
    msgs.innerHTML = '';
    const w = document.createElement('div'); w.className = 'welcome';
    w.innerHTML = `<img src="/icon.svg" alt="" width="64" height="64"><h1>Olá!</h1><p>${S.mode === 'code' ? 'Escolha uma sessão à esquerda ou comece uma nova.' : S.key ? 'Como posso ajudar hoje?' : 'Seu espaço pessoal de conversas com IA.'}</p>`;
    msgs.appendChild(w);
    if (S.mode === 'chat' && !S.key) {
      const s = document.createElement('div'); s.className = 'setup';
      s.innerHTML = `<h3>Primeiro, sua chave da NVIDIA</h3>
        <ol><li>Crie uma conta gratuita em <a href="https://build.nvidia.com/" target="_blank" rel="noopener noreferrer">build.nvidia.com</a>.</li>
        <li>Gere uma chave de API (<em>API Key</em>): ela começa com <code>nvapi-</code>.</li>
        <li>Cole a chave abaixo.</li></ol>
        <div class="row"><input class="field" id="wKey" type="password" placeholder="nvapi-…" autocomplete="off" spellcheck="false"><button class="primary" id="wKeySave">Salvar</button></div>
        <div class="err" id="wErr"></div>
        <p class="muted small">Sua chave da NVIDIA fica guardada só neste aparelho, no navegador, e o uso conta na sua própria conta da NVIDIA. Para salvar suas conversas em qualquer aparelho, crie uma conta no ícone no canto superior direito.</p>`;
      w.appendChild(s);
      const save = async () => {
        const btn = $('#wKeySave'); btn.disabled = true; btn.textContent = 'Conferindo…'; $('#wErr').textContent = '';
        try { await saveKey($('#wKey').value); } catch (err) { $('#wErr').textContent = err.message; btn.disabled = false; btn.textContent = 'Salvar'; }
      };
      $('#wKeySave').addEventListener('click', save);
      $('#wKey').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    }
  }

  // ---------- cabeçalho / modelos ----------
  function setHead(title, cwd) {
    $('#title').textContent = title;
    $('#cwdLabel').textContent = cwd ? cwd.replace(/^\/home\/[^/]+/, '~') : '';
    document.title = 'Kodi';
  }
  // Modelos que costumam responder bem, em ordem de preferência (o primeiro que existir na conta é usado).
  const PREFER = [/nemotron-3-ultra/, /nemotron-3\.5-super/, /minimax-m3/, /nemotron-3\.5-lightning/, /gemma-4/, /deepseek-v4/, /qwen3/, /kimi/, /glm/, /nemotron/, /llama-3\.3-70b/, /llama-3\.1-70b/, /llama-3\.1-405b/, /deepseek-v3/, /gpt-oss-120b/, /qwen.*(235b|72b|coder)/, /mistral-large/, /llama-3\.1-8b/];
  const rankOf = id => { const i = PREFER.findIndex(re => re.test(id)); return i < 0 ? 99 : i; };
  function bestModel(list) {
    for (const re of PREFER) { const m = list.find(id => re.test(id)); if (m) return m; }
    return list[0];
  }
  // Ordem para tentar: o escolhido primeiro, depois os preferidos, depois o resto da lista.
  function modelCandidates() {
    const rest = [];
    for (const re of PREFER) for (const id of S.models) if (re.test(id)) rest.push(id);
    return S.good.length ? [...new Set([S.model, ...S.good])] : [...new Set([S.model, ...rest, ...S.models])];
  }
  function fillModels(list) {
    const sel = $('#model');
    const cur = S.model || cfg.defaultModel;
    const all = [...new Set([...S.good, ...list])];
    const pick = !all.length || all.includes(cur) ? cur : (S.good[0] || bestModel(list));
    const ids = [...new Set([pick, ...S.good, ...list])];
    sel.innerHTML = ids.map(id => `<option value="${esc(id)}">${S.good.includes(id) ? '✓ ' : ''}${esc(id)}</option>`).join('') + '<option value="__custom">Outro modelo (digitar o nome)…</option>';
    sel.value = pick; S.model = pick;
  }
  // Manda um pedido mínimo a vários modelos para descobrir quais respondem de verdade nesta conta (e quão rápido).
  let probing = false;
  async function probeModels(onProgress = () => {}) {
    if (probing || !S.key || !S.models.length) return null;
    probing = true;
    const ranked = [];
    for (const re of PREFER) for (const id of S.models) if (re.test(id)) ranked.push(id);
    const cands = [...new Set([...ranked, ...S.models])].filter(id => !S.bad.includes(id)).slice(0, 80);   // pula os que já deram "não existe"
    const newBad = [];
    const ok = []; const report = []; let done = 0, next = 0;
    const one = async m => {
      const t0 = Date.now(); const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 40000);
      try {
        const r = await nvFetch('/chat/completions', { method: 'POST', body: { model: m, messages: [{ role: 'user', content: 'oi' }], max_tokens: 1, stream: false }, signal: ac.signal });
        if (r.ok) { ok.push({ id: m, ms: Date.now() - t0 }); report.push({ id: m, res: `ok, ${((Date.now() - t0) / 1000).toFixed(1)}s` }); }
        else { if (r.status === 404) newBad.push(m); report.push({ id: m, res: r.status === 404 ? 'não existe nesta conta' : `erro ${r.status}` }); }
        await r.text().catch(() => '');
      } catch { report.push({ id: m, res: 'sem resposta em 40s (lento ou fora do ar)' }); }
      clearTimeout(to); onProgress(++done, cands.length, ok.length);
    };
    const pool = async () => { while (next < cands.length) await one(cands[next++]); };
    try { await Promise.all([pool(), pool(), pool(), pool(), pool()]); } finally { probing = false; }
    ok.sort((a, b) => rankOf(a.id) - rankOf(b.id) || a.ms - b.ms);   // melhor qualidade primeiro; desempate pela velocidade
    S.good = ok.map(x => x.id);
    S.bad = [...new Set([...S.bad, ...newBad])]; Store.setMeta('bad', S.bad).catch(() => {});
    Store.setMeta('good', S.good).catch(() => {});
    if (S.good.length && !S.good.includes(S.model)) S.model = S.good[0];
    fillModels(S.models);
    S.report = report;
    try { const u = await getUsage(); const d = (u.days[dayKey()] = u.days[dayKey()] || { p: 0, c: 0, n: 0, est: 0 }); d.pr = (d.pr || 0) + ok.length; await Store.setMeta('usage', u); refreshUsageBadge(); } catch { /* ignora */ }
    return { tested: cands.length, ok, report };
  }
  async function autoProbe(msg) {
    toast(msg);
    const r = await probeModels();
    if (!r) return;
    toast(r.ok.length ? `${r.ok.length} modelo(s) respondem na sua conta. Usando ${S.model}.` : 'Nenhum modelo respondeu agora. Tente de novo mais tarde (a NVIDIA pode estar lenta).');
  }
  async function loadModels() {
    if (!S.key) { fillModels([]); return; }
    try { S.models = await nvModels(); fillModels(S.models); }
    catch (e) { fillModels(S.models); if (e.friendly) toast(e.message); }
  }
  $('#model').addEventListener('change', e => {
    if (e.target.value === '__custom') {
      const id = (prompt('Digite o nome exato do modelo (ex.: meta/llama-3.1-8b-instruct):') || '').trim();
      if (!/^[\w.\-]+\/[\w.\-:]+$/.test(id)) { fillModels(S.models); if (id) toast('Nome inválido. O formato é empresa/modelo.'); return; }
      if (!S.models.includes(id)) S.models = [id, ...S.models];
      S.model = id;
    } else S.model = e.target.value;
    fillModels(S.models); Store.setMeta('model', S.model).catch(() => {});
  });

  // ---------- barra lateral ----------
  const ago = ms => {
    const d = (Date.now() - ms) / 1000;
    if (d < 60) return 'agora'; if (d < 3600) return Math.floor(d / 60) + ' min';
    if (d < 86400) return Math.floor(d / 3600) + ' h'; if (d < 86400 * 30) return Math.floor(d / 86400) + ' d';
    return new Date(ms).toLocaleDateString('pt-BR');
  };
  function renderList() {
    const box = $('#list'); const q = S.search.toLowerCase();
    let items;
    if (S.mode === 'chat') {
      items = S.chats.filter(c => !q || c.title.toLowerCase().includes(q))
        .map(c => ({ id: c.id, title: c.title, sub: shortModel(c.model), mtime: c.updated, chat: c }));
    } else {
      const f = $('#folder').value;
      items = S.codeSessions.filter(s => (!f || s.cwd === f) && (!q || s.title.toLowerCase().includes(q)))
        .map(s => ({ id: s.id, title: s.title, sub: base(s.cwd), mtime: s.mtime, session: s }));
    }
    if (!items.length) { box.innerHTML = `<div class="empty">${q ? 'Nada encontrado.' : 'Nenhuma conversa ainda.'}</div>`; return; }
    const now = Date.now(), day = 86400000;
    const groups = [['Hoje', []], ['Ontem', []], ['Últimos 7 dias', []], ['Antigas', []]];
    for (const it of items) { const d = now - it.mtime; groups[d < day ? 0 : d < 2 * day ? 1 : d < 7 * day ? 2 : 3][1].push(it); }
    box.innerHTML = '';
    for (const [name, arr] of groups) {
      if (!arr.length) continue;
      const g = document.createElement('div'); g.className = 'grp'; g.textContent = name; box.appendChild(g);
      for (const it of arr) {
        const row = document.createElement('div');
        row.className = 'item' + (it.id === S.current.id ? ' active' : '');
        const open = document.createElement('button'); open.className = 'open'; open.type = 'button';
        open.innerHTML = '<div class="t"></div><div class="s"></div>';
        $('.t', open).textContent = it.title; $('.s', open).textContent = [it.sub, ago(it.mtime)].filter(Boolean).join(' · ');
        open.addEventListener('click', () => (it.chat ? openChat(it.id) : openSession(it.session)));
        row.appendChild(open);
        if (it.chat) {
          const acts = document.createElement('div'); acts.className = 'acts';
          acts.innerHTML = `<button class="icon" type="button" aria-label="Renomear" title="Renomear">${ICON.pencil}</button><button class="icon" type="button" aria-label="Apagar" title="Apagar">${ICON.trash}</button>`;
          const [ren, del] = $$('button', acts);
          ren.addEventListener('click', () => renameChat(it.chat));
          del.addEventListener('click', () => deleteChat(it.chat));
          row.appendChild(acts);
        }
        box.appendChild(row);
      }
    }
  }
  async function loadChats() {
    try { S.chats = await Store.listChats(); } catch { S.chats = []; }
    if (S.mode === 'chat') renderList();
  }
  async function renameChat(c) {
    const t = prompt('Novo nome da conversa:', c.title);
    if (!t || !t.trim()) return;
    const title = t.trim().slice(0, 80);
    try {
      await Store.saveChat({ ...c, title, updated: Date.now() }); Cloud.pushChat(c.id);
      if (S.chat && S.chat.id === c.id) { S.chat.title = title; setHead(title); }
      await loadChats();
    } catch { toast('Não consegui salvar a mudança neste aparelho.'); }
  }
  async function deleteChat(c) {
    if (S.streaming) return;
    if (!confirm(`Apagar a conversa "${c.title}"? Isso não pode ser desfeito.`)) return;
    try { await Store.deleteChat(c.id); Cloud.deleteRemote(c.id); if (S.chat && S.chat.id === c.id) newChat(); await loadChats(); }
    catch { toast('Não consegui apagar neste aparelho.'); }
  }
  $('#search').addEventListener('input', e => { S.search = e.target.value; renderList(); });
  $('#folder').addEventListener('change', e => {
    const sel = e.target;
    if (sel.value === '__other') {
      const p = prompt('Caminho completo da pasta (ex.: /home/simon/projetos/app):');
      if (p && p.trim()) { lsSet('ia.cwd', p.trim()); lsSet('ia.filter', '1'); renderFolders(); }
      else sel.value = lsGet('ia.filter') === '1' ? sel.dataset.cwd : '';
    } else if (sel.value) { lsSet('ia.cwd', sel.value); lsSet('ia.filter', '1'); sel.dataset.cwd = sel.value; }
    else lsSet('ia.filter', '0');
    if (!S.current.id) { S.current.cwd = null; setHead('Nova sessão', workingCwd()); }
    renderList();
  });
  function renderFolders() {
    const sel = $('#folder'); const home = S.codeCfg.home;
    const saved = lsGet('ia.cwd') || S.codeCfg.defaultCwd;
    const cwds = [...new Set([S.codeCfg.defaultCwd, ...S.codeSessions.map(s => s.cwd).filter(Boolean), saved])];
    sel.innerHTML = '<option value="">Todas as pastas</option><option disabled>──────────</option>' +
      cwds.map(c => `<option value="${esc(c)}">${esc(c.replace(home, '~'))}</option>`).join('') +
      '<option disabled>──────────</option><option value="__other">Outra pasta…</option>';
    sel.value = lsGet('ia.filter') === '1' ? saved : '';
    sel.dataset.cwd = saved;
  }
  const workingCwd = () => S.current.cwd || $('#folder').dataset.cwd || (S.codeCfg && S.codeCfg.defaultCwd) || '';

  // ---------- gaveta (celular) ----------
  const openDrawer = () => document.body.classList.add('drawer');
  const closeDrawer = () => document.body.classList.remove('drawer');
  $('#btnMenu').addEventListener('click', openDrawer);
  $('#btnCloseMenu').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  // ---------- modos e conversas ----------
  function setMode(mode) {
    if (S.streaming) return;
    S.mode = mode;
    $$('#modeTabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    $('#folder').hidden = mode !== 'code';
    $('#model').hidden = mode !== 'chat';
    S.search = ''; $('#search').value = '';
    newChat();
    if (mode === 'code') loadCodeSessions(); else renderList();
  }
  $$('#modeTabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function newChat() {
    if (S.streaming) return;
    S.chat = null; S.messages = [];
    S.current = { id: null, project: null, cwd: null };
    setHead(S.mode === 'code' ? 'Nova sessão' : 'Nova conversa', S.mode === 'code' ? workingCwd() : '');
    updateComposer(); welcome(); renderList(); closeDrawer();
    if (!matchMedia('(pointer: coarse)').matches) $('#inp').focus();
  }
  $('#newChat').addEventListener('click', newChat);

  function updateComposer() {
    const needKey = S.mode === 'chat' && !S.key;
    $('#inp').disabled = needKey;
    $('#send').disabled = needKey && !S.streaming;
    $('#inp').placeholder = needKey ? 'Cadastre sua chave da NVIDIA para começar' : 'Escreva sua mensagem…';
    const touch = matchMedia('(pointer: coarse)').matches;
    const how = S.mode !== 'chat' ? '' : S.conn === 'direct' ? 'conexão direta com a NVIDIA' : S.conn === 'relay' ? 'repassado pelo servidor, sem gravar nada' : '';
    $('#hint').textContent = [touch ? '' : 'Enter envia · Shift+Enter quebra linha', how].filter(Boolean).join(' · ');
  }

  async function openChat(id) {
    if (S.streaming) return;
    const chat = S.chats.find(c => c.id === id);
    if (!chat) return;
    S.chat = chat; S.current = { id, project: null, cwd: null };
    closeDrawer(); renderList(); msgs.innerHTML = '<div class="empty">Carregando…</div>';
    let list = [];
    try { list = await Store.getMessages(id); } catch { list = []; }
    if (!S.chat || S.chat.id !== id) return;
    S.messages = list;
    setHead(chat.title);
    if (chat.model && (!S.models.length || S.models.includes(chat.model))) { S.model = chat.model; fillModels(S.models); }
    msgs.innerHTML = '';
    for (const m of S.messages) {
      if (m.role === 'user') addUser(m.content); else { const v = new AsstView(); v.set(m.content); v.finish(usageLabel(m.usage), usageTip(m.usage)); }
    }
    scrollDown(true);
  }

  async function persistChat() {
    try {
      S.chat.updated = Date.now();
      await Store.saveChat(S.chat);
      await Store.saveMessages(S.chat.id, S.messages);
      Cloud.pushChat(S.chat.id);
    } catch { toast('Não consegui salvar neste aparelho (sem espaço?). Faça um backup e apague conversas antigas.'); }
  }
  function buildContext(list) {
    const all = list.map(m => ({ role: m.role, content: m.content }));
    const out = []; let total = 0;
    for (let i = all.length - 1; i >= 0; i--) {
      total += all[i].content.length;
      if (out.length && total > cfg.maxContextChars) break;
      out.unshift(all[i]);
    }
    while (out.length > 1 && out[0].role !== 'user') out.shift();
    return [{ role: 'system', content: cfg.systemPrompt }, ...out];
  }

  function setStreaming(on) {
    S.streaming = on;
    const b = $('#send');
    b.classList.toggle('stop', on); b.title = on ? 'Parar' : 'Enviar'; b.setAttribute('aria-label', b.title);
    b.innerHTML = on ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 19V6M6 11.5l6-6 6 6"/></svg>';
    b.disabled = false;
    $$('#modeTabs button, #newChat').forEach(x => { x.disabled = on; });
  }

  async function sendChat(text) {
    const inp = $('#inp');
    if (text.length > cfg.maxMessageChars) { toast(`Mensagem grande demais (máximo ${cfg.maxMessageChars} caracteres).`); return; }
    if (!S.key) { openSettings(); return; }
    if (!S.chat) {
      S.chat = { id: rid(), title: 'Nova conversa', model: S.model, created: Date.now(), updated: Date.now() };
      S.messages = []; S.current = { id: S.chat.id, project: null, cwd: null };
    }
    const chat = S.chat;
    if (msgs.querySelector('.welcome')) msgs.innerHTML = '';
    S.messages.push({ role: 'user', content: text, t: Date.now() });
    if (S.messages.length === 1) { chat.title = text.replace(/\s+/g, ' ').slice(0, 60); setHead(chat.title); }
    chat.model = S.model;
    await persistChat();
    const userEl = addUser(text);
    const view = new AsstView(true);
    scrollDown(true);
    inp.value = ''; inp.style.height = 'auto';
    setStreaming(true);
    const ac = new AbortController(); S.abort = ac;
    let got = '', failed = null, failCode = null, usage = null, ctxChars = 0;
    const tried = []; const first = S.model;
    try {
      // Se o modelo escolhido não existir para a conta (404), tenta outros automaticamente até achar um que responda.
      for (const m of modelCandidates().slice(0, 8)) {
        S.model = m; tried.push(m);
        try {
          const ctx = buildContext(S.messages); ctxChars = ctx.reduce((n, x) => n + x.content.length, 0);
          for await (const ev of nvStream({ model: m, messages: ctx, signal: ac.signal })) {
            if (ev.type === 'd') { got += ev.text; view.addText(ev.text); }
            else if (ev.type === 'u') usage = { p: Number(ev.usage.prompt_tokens) || 0, c: Number(ev.usage.completion_tokens) || 0 };
            else view.addReasoning(ev.text);
          }
          break;
        } catch (e) {
          if (e.code === 'model404' && !got && !ac.signal.aborted) continue;
          throw e;
        }
      }
    } catch (e) {
      failed = e.code === 'model404' && tried.length > 1 ? `Tentei ${tried.length} modelos e nenhum está disponível para a sua conta. Escolha um no seletor lá em cima.` : e.friendly ? e.message : 'Erro inesperado: ' + (e && e.message ? e.message : e);
      failCode = e.code;
      if (!e.friendly) console.error(e);
    } finally { setStreaming(false); S.abort = null; }
    if (!got) S.model = first;
    else if (S.model !== first) { fillModels(S.models); toast(`O modelo ${first} não está disponível; usei ${S.model}.`); }

    if (got) {
      if (!usage) usage = { p: estTokens(ctxChars), c: estTokens(got.length + view.reasoning.length), est: true };   // a NVIDIA não informou: estimativa
      S.messages.push({ role: 'assistant', content: got, t: Date.now(), model: S.model, usage });
      view.finish(usageLabel(usage), usageTip(usage));
      addUsage(S.model, usage.p, usage.c, !!usage.est);
      Store.setMeta('model', S.model).catch(() => {});
    } else {                                         // nada foi gerado: desfaz a mensagem e devolve o texto à caixa
      S.messages.pop(); userEl.remove(); view.remove();
      inp.value = text; inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 220) + 'px';
      if (!S.messages.length) {
        try { await Store.deleteChat(chat.id); } catch { /* ignora */ }
        S.chat = null; S.current.id = null; setHead('Nova conversa'); welcome();
      }
    }
    if (failed) showError(failed);
    if (S.chat) await persistChat();
    await loadChats();
    if (failed && /Configurações/.test(failed) && /chave/i.test(failed)) toast('Confira sua chave em Configurações.');
    if (failCode === 'timeout') autoProbe('Testando quais modelos respondem na sua conta…');
    if (!matchMedia('(pointer: coarse)').matches) inp.focus();
  }

  // ======================================================================
  // Claude Code (aparece só se o app foi aberto direto no computador do servidor)
  // ======================================================================
  async function api(path) {
    const r = await fetch(path, { credentials: 'same-origin' });
    let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) throw Object.assign(new Error((j && j.error) || `Erro ${r.status}`), { status: r.status });
    return j;
  }
  async function streamPost(url, body, signal, onEvent) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!r.ok) { let j = null; try { j = await r.json(); } catch { /* ignora */ } throw new Error((j && j.error) || `Erro ${r.status}`); }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        onEvent(ev);
      }
    }
  }
  async function loadCodeSessions() {
    try { S.codeSessions = await api('/api/code/sessions'); } catch { S.codeSessions = []; }
    renderFolders(); renderList();
    if (!S.current.id) setHead('Nova sessão', workingCwd());
  }
  const toolArg = i => { i = i || {}; return String(i.command || i.file_path || i.path || i.pattern || i.query || i.url || i.description || JSON.stringify(i)).replace(/\s+/g, ' ').slice(0, 140); };
  function addTool(parent, id, name, input) {
    const d = document.createElement('details'); d.className = 'tool'; d.dataset.id = id || '';
    d.innerHTML = `<summary><span class="dot"></span><b>${esc(name)}</b><span class="arg">${esc(toolArg(input))}</span></summary><pre></pre>`;
    $('pre', d).textContent = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    parent.appendChild(d); return d;
  }
  function setToolResult(id, text, isErr) {
    const d = $$('details.tool', msgs).reverse().find(x => x.dataset.id === id);
    if (!d) return;
    d.classList.add(isErr ? 'err' : 'done');
    $('pre', d).textContent += '\n\n— resultado —\n' + String(text || '').slice(0, 4000);
  }
  function addTextBlock(parent) { const t = document.createElement('div'); t.className = 'txt'; t.raw = ''; parent.appendChild(t); return t; }
  const resultText = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';

  async function openSession(s) {
    if (S.streaming) return;
    setHead(s.title, s.cwd); msgs.innerHTML = '<div class="empty">Carregando…</div>';
    S.current = { id: s.id, project: s.project, cwd: s.cwd };
    closeDrawer(); renderList();
    let data;
    try { data = await api(`/api/code/session/${encodeURIComponent(s.project)}/${encodeURIComponent(s.id)}`); }
    catch (e) { msgs.innerHTML = ''; return showError(e.message); }
    if (S.current.id !== s.id) return;
    msgs.innerHTML = '';
    if (data.cwd) S.current.cwd = data.cwd;
    for (const m of data.messages) {
      if (m.role === 'user') { addUser(m.blocks.map(b => b.text).join('\n')); continue; }
      const a = document.createElement('div'); a.className = 'asst'; msgs.appendChild(a);
      for (const b of m.blocks) {
        if (b.type === 'text') { const t = addTextBlock(a); t.innerHTML = md(b.text); }
        else if (b.type === 'tool_use') addTool(a, b.id, b.name, b.input);
        else if (b.type === 'tool_result') setToolResult(b.tool_use_id, b.text, b.is_error);
      }
    }
    scrollDown(true);
  }

  async function sendCode(text) {
    const inp = $('#inp');
    if (msgs.querySelector('.welcome')) msgs.innerHTML = '';
    addUser(text);
    const asst = document.createElement('div'); asst.className = 'asst'; msgs.appendChild(asst);
    const typing = document.createElement('div'); typing.className = 'typing'; typing.innerHTML = '<i>●</i> pensando…'; asst.appendChild(typing);
    inp.value = ''; inp.style.height = 'auto'; scrollDown(true);
    if (!S.current.id) setHead(text.slice(0, 70), workingCwd());
    const wasNew = !S.current.id;
    setStreaming(true);
    const ac = new AbortController(); S.abort = ac;
    let curText = null; const streamed = new Set();
    const dropTyping = () => { if (typing.parentNode) typing.remove(); };
    const handle = ev => {
      if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) { S.current.id = ev.session_id; S.current.cwd = S.current.cwd || workingCwd(); }
      else if (ev.type === 'stream_event' && ev.event) {
        const e = ev.event;
        if (e.type === 'message_start') { curText = null; if (e.message && e.message.id) streamed.add(e.message.id); }
        else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'text') { dropTyping(); curText = addTextBlock(asst); }
        else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
          if (!curText) { dropTyping(); curText = addTextBlock(asst); }
          curText.raw += e.delta.text;
          if (!curText.pending) { const t = curText; t.pending = true; requestAnimationFrame(() => { t.pending = false; t.innerHTML = md(t.raw); scrollDown(); }); }
        }
      } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        dropTyping();
        for (const b of ev.message.content) {
          if (b.type === 'tool_use') { addTool(asst, b.id, b.name, b.input); curText = null; }
          else if (b.type === 'text' && b.text && !streamed.has(ev.message.id)) { const t = addTextBlock(asst); t.innerHTML = md(b.text); }
        }
        scrollDown();
      } else if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
        for (const b of ev.message.content) if (b.type === 'tool_result') setToolResult(b.tool_use_id, resultText(b.content), b.is_error);
      } else if (ev.type === 'result') {
        dropTyping();
        if (ev.session_id) S.current.id = ev.session_id;
        if (ev.is_error) showError(typeof ev.result === 'string' && ev.result ? ev.result : 'A resposta terminou com erro.');
        else if (!$('.txt', asst) && typeof ev.result === 'string' && ev.result) { const t = addTextBlock(asst); t.innerHTML = md(ev.result); }
      } else if (ev.type === 'gui_error') { dropTyping(); showError(ev.message); }
    };
    try { await streamPost('/api/code/chat', { message: text, sessionId: S.current.id, cwd: workingCwd() }, ac.signal, handle); }
    catch (e) { if (e.name !== 'AbortError') showError(e.message); }
    finally { dropTyping(); setStreaming(false); S.abort = null; }
    await loadCodeSessions();
    const s = S.codeSessions.find(x => x.id === S.current.id);
    if (s) { S.current.project = s.project; if (wasNew) setHead(s.title, s.cwd || workingCwd()); }
  }

  // ---------- compositor ----------
  function submit() {
    if (S.streaming) { S.abort && S.abort.abort(); return; }
    const text = $('#inp').value.trim();
    if (!text) return;
    (S.mode === 'code' ? sendCode : sendChat)(text);
  }
  $('#send').addEventListener('click', submit);
  $('#inp').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); if (!S.streaming) submit(); }
  });
  $('#inp').addEventListener('input', e => { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; });

  // ======================================================================
  // Configurações, chave, backup
  // ======================================================================
  const say = (id, text, ok) => { const el = $('#' + id); el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'bad'); };
  const CONN_TEXT = {
    direct: 'Conexão direta: seu navegador fala com a NVIDIA sem passar pelo servidor do app. O servidor não participa das suas conversas.',
    relay: 'Pelo servidor: seu navegador não consegue falar direto com a NVIDIA, então cada mensagem passa pelo servidor do app só para ser repassada. O programa do servidor não grava nada, mas, como em qualquer repasse, quem administra o servidor teria a possibilidade técnica de alterá-lo para ver o que passa.',
    none: 'Ainda não definido: cadastre sua chave para o app descobrir o melhor caminho.',
  };
  function refreshSettings() {
    $('#keyStatus').textContent = S.key ? `Chave salva neste aparelho (••••${S.key.slice(-4)}). Cole outra abaixo para trocar.` : 'Nenhuma chave cadastrada ainda.';
    $('#keyDel').hidden = !S.key;
    $('#keyInput').value = '';
    $('#connStatus').textContent = CONN_TEXT[S.conn || 'none'];
    $('#connTest').hidden = !S.key;
    const w = $('#storeWarn');
    w.hidden = Store.isPersistent();
    if (!Store.isPersistent()) w.textContent = 'Atenção: seu navegador não permite guardar dados (janela privada?). As conversas serão perdidas ao fechar esta aba.';
  }
  async function saveKey(value) {
    const key = String(value || '').trim();
    if (!/^[\w.\-]{20,400}$/.test(key)) throw new Error('Essa chave não parece válida. Ela costuma começar com "nvapi-".');
    const r = await detectConn(key);
    if (r.invalid) throw new Error('A NVIDIA recusou essa chave. Confira se copiou inteira e se ela ainda está ativa.');
    if (r.offline) throw new Error(r.access ? 'O servidor não aceitou o código de acesso.' : 'Não consegui conferir a chave agora. Verifique a internet e tente de novo.');
    S.key = key; S.conn = r.conn; S.models = r.models;
    await Store.setMeta('key', key); await Store.setMeta('conn', r.conn);
    if (r.conn === 'relay' && S.access) await Store.setMeta('access', S.access);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* opcional */ }
    fillModels(S.models); updateComposer(); refreshSettings();
    toast(r.conn === 'direct' ? 'Chave salva. Conexão direta com a NVIDIA!' : 'Chave salva. As mensagens vão passar pelo servidor só para serem repassadas.');
    if (!S.chat && S.mode === 'chat') welcome();
    autoProbe('Chave salva. Testando quais modelos respondem na sua conta…');
  }
  function openAccount() {
    closeDrawer(); accModeNow = ''; accStep = 'pick'; renderAccount(); $('#accMsg').textContent = '';
    $('#dlgAcc').classList.toggle('profile', cloudOn && !!Cloud.session);
    if (!$('#dlgAcc').open) $('#dlgAcc').showModal();
  }
  $('#btnAcc').addEventListener('click', openAccount);
  function closeAccMenu() { $('#accMenu').hidden = true; $('#accBlock').setAttribute('aria-expanded', 'false'); }
  $('#accBlock').addEventListener('click', e => { e.stopPropagation(); const open = $('#accMenu').hidden; $('#accMenu').hidden = !open; $('#accBlock').setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', e => { if (!e.target.closest('#acct')) closeAccMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAccMenu(); });
  $('#amProfile').addEventListener('click', () => { closeAccMenu(); openAccount(); });
  $('#amSettings').addEventListener('click', () => { closeAccMenu(); openSettings(); });
  $('#amLogout').addEventListener('click', () => { closeAccMenu(); $('#accLogout').click(); });
  $('#accSaveName').addEventListener('click', async () => {
    const v = $('#accName').value.trim(); if (!v) return say('accMsg', 'Escreva um nome.', false);
    accBusy(true); try { const r = await Cloud.call('/auth/v1/user', { method: 'PUT', body: { data: { full_name: v } } });
      if (r.ok) { Cloud.save({ ...Cloud.session, user: { ...Cloud.session.user, name: v } }); renderAccount(); say('accMsg', 'Nome salvo.', true); } else say('accMsg', Cloud.errText(r), false); } finally { accBusy(false); }
  });
  $('#dlgAcc').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  function openSettings() {
    closeDrawer(); refreshSettings(); updateInstallBox(); renderAccount();
    ['keyMsg', 'connMsg', 'dataMsg', 'modelsMsg', 'qMsg'].forEach(i => { $('#' + i).textContent = ''; });
    if (S.report) showReport(S.report);
    renderUsage(); loadQuotaInputs();
    $('#dlgSettings').showModal();
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#keySave').addEventListener('click', async () => {
    const b = $('#keySave'); b.disabled = true;
    try { await saveKey($('#keyInput').value); say('keyMsg', 'Chave salva e conferida com a NVIDIA.', true); }
    catch (e) { say('keyMsg', e.message, false); } finally { b.disabled = false; }
  });
  $('#keyDel').addEventListener('click', async () => {
    if (!confirm('Remover sua chave da NVIDIA deste aparelho? Suas conversas continuam aqui.')) return;
    await Store.delMeta('key'); await Store.delMeta('conn');
    S.key = null; S.conn = null; S.models = []; fillModels([]); updateComposer(); refreshSettings();
    say('keyMsg', 'Chave removida deste aparelho.', true);
    if (!S.chat && S.mode === 'chat') welcome();
  });
  $('#connTest').addEventListener('click', async () => {
    const b = $('#connTest'); b.disabled = true; $('#connMsg').textContent = '';
    try {
      const r = await detectConn(S.key);
      if (r.invalid) say('connMsg', 'A NVIDIA recusou a chave salva. Cadastre-a de novo.', false);
      else if (r.offline) say('connMsg', 'Não consegui falar com a NVIDIA nem pelo servidor agora.', false);
      else { S.conn = r.conn; S.models = r.models; await Store.setMeta('conn', r.conn); fillModels(S.models); refreshSettings(); updateComposer(); say('connMsg', 'Conexão testada com sucesso.', true); }
    } finally { b.disabled = false; }
  });

  function showReport(rep) {
    const box = $('#modelsList'); box.innerHTML = '';
    for (const x of rep.slice().sort((a, b) => (b.res.startsWith('ok') - a.res.startsWith('ok')))) {
      const d = document.createElement('div'); d.className = x.res.startsWith('ok') ? 'okline' : 'badline';
      d.textContent = `${x.res.startsWith('ok') ? '✓' : '✗'} ${x.id} — ${x.res}`; box.appendChild(d);
    }
  }
  $('#modelsTest').addEventListener('click', async () => {
    const b = $('#modelsTest'); b.disabled = true; $('#modelsMsg').textContent = '';
    try {
      const r = await probeModels((d, n, k) => say('modelsMsg', `Testando… ${d} de ${n} (${k} respondendo)`, true));
      if (r) showReport(r.report);
      if (!r) say('modelsMsg', 'Cadastre a chave primeiro (ou aguarde o teste que já está rodando).', false);
      else if (r.ok.length) say('modelsMsg', `${r.ok.length} modelo(s) respondem. Marcados com ✓ no seletor; o mais rápido foi escolhido: ${S.model}.`, true);
      else say('modelsMsg', 'Nenhum modelo respondeu agora. Tente de novo mais tarde.', false);
    } finally { b.disabled = false; }
  });

  async function loadQuotaInputs() { const { q } = await quotaState(); $('#qLimit').value = q.limit; $('#qLeft').value = ''; refreshQuota(); }
  $('#qApply').addEventListener('click', async () => {
    const limit = Math.round(Number($('#qLimit').value)); const leftTxt = $('#qLeft').value.trim();
    if (!(limit > 0 && limit < 10000000)) { say('qMsg', 'Informe um limite válido (ex.: 1000).', false); return; }
    const { mine } = await quotaState();
    const q = { limit, adj: 0, month: monthKey() };
    if (leftTxt !== '') {
      const left = Math.round(Number(leftTxt));
      if (!(left >= 0 && left <= limit)) { say('qMsg', 'O saldo atual precisa estar entre 0 e o limite.', false); return; }
      q.adj = (limit - left) - mine;                // ajusta para bater com o saldo que a NVIDIA mostra
    }
    await Store.setMeta('quota', q); await loadQuotaInputs(); say('qMsg', 'Cota atualizada.', true);
  });
  $('#usageReset').addEventListener('click', async () => {
    if (!confirm('Zerar os contadores de tokens deste aparelho?')) return;
    await Store.delMeta('usage'); await Store.delMeta('quota'); renderUsage(); loadQuotaInputs(); refreshUsageBadge();
  });
  $('#usageToday').addEventListener('click', openSettings);

  // backup e restauração (a única forma de levar as conversas para outro aparelho)
  $('#btnBackup').addEventListener('click', async () => {
    try {
      const data = await Store.exportAll();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `ia-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say('dataMsg', `Backup com ${data.chats.length} conversa(s) baixado. Ele NÃO inclui sua chave da NVIDIA.`, true);
    } catch { say('dataMsg', 'Não consegui gerar o backup.', false); }
  });
  $('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
  $('#fileRestore').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      if (f.size > 100 * 1024 * 1024) throw new Error('grande');
      const data = JSON.parse(await f.text());
      if (!data || data.app !== 'ia-backup' || !Array.isArray(data.chats)) throw new Error('formato');
      const have = new Set(S.chats.map(c => c.id));
      let n = 0;
      for (const c of data.chats) {
        if (!c || typeof c.id !== 'string' || !/^[\w-]{8,64}$/.test(c.id) || have.has(c.id) || !Array.isArray(c.messages)) continue;
        const messages = c.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map(m => ({ role: m.role, content: m.content, t: Number(m.t) || 0, ...(typeof m.model === 'string' ? { model: m.model.slice(0, 120) } : {}) }));
        const now = Date.now();
        await Store.saveChat({ id: c.id, title: String(c.title || 'Conversa').slice(0, 80), model: typeof c.model === 'string' ? c.model.slice(0, 120) : null, created: Number(c.created) || now, updated: Number(c.updated) || now });
        await Store.saveMessages(c.id, messages); n++;
      }
      await loadChats(); if (n) Cloud.syncAll();
      say('dataMsg', n ? `${n} conversa(s) restaurada(s).` : 'Nenhuma conversa nova neste arquivo (as que já existem aqui foram mantidas).', true);
    } catch { say('dataMsg', 'Esse arquivo não parece ser um backup deste app.', false); }
  });
  $('#btnWipe').addEventListener('click', async () => {
    if (!confirm('Apagar TODAS as conversas, a chave e as preferências deste aparelho? Isso não pode ser desfeito (faça backup antes se quiser guardar).')) return;
    try { await Store.clearAll(); } catch { /* segue */ }
    location.href = '/';
  });
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- instalar como app ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.deferred = e; });
  window.addEventListener('appinstalled', () => { S.deferred = null; toast('App instalado!'); });
  function updateInstallBox() {
    const box = $('#installBox');
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) { box.hidden = true; return; }
    box.hidden = false;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('#btnInstall').hidden = !S.deferred;
    $('#installText').textContent = S.deferred ? 'Abra o app em janela própria, sem a barra do navegador. Instalado, o navegador também evita apagar suas conversas.'
      : ios ? 'No iPhone/iPad: toque no botão de compartilhar do Safari e escolha "Adicionar à Tela de Início". Instalado, o iOS não apaga suas conversas por falta de uso.'
        : 'No celular: abra o menu do navegador e escolha "Instalar app" ou "Adicionar à tela inicial". No computador (Chrome/Edge): use o ícone de instalar na barra de endereço.';
  }
  $('#btnInstall').addEventListener('click', async () => {
    if (!S.deferred) return;
    S.deferred.prompt(); try { await S.deferred.userChoice; } catch { /* ignora */ }
    S.deferred = null; updateInstallBox();
  });


  // ======================================================================
  // Conta (Supabase): salva conversas e preferências na nuvem para qualquer aparelho.
  // A chave da NVIDIA NUNCA é enviada: continua só neste navegador.
  // ======================================================================
  const SB = window.KODI_SUPABASE || {};
  const cloudOn = !!(SB.url && SB.key);
  const nameOf = u => { const m = (u && u.user_metadata) || {}; return String(m.full_name || m.name || '').trim(); };
  const Cloud = {
    session: null, applying: false, busy: false, timer: null, state: '', last: 0, recovery: false,
    load() { try { this.session = JSON.parse(localStorage.getItem('kodi.session') || 'null'); } catch { this.session = null; } },
    save(sess) { this.session = sess; try { sess ? localStorage.setItem('kodi.session', JSON.stringify(sess)) : localStorage.removeItem('kodi.session'); } catch { /* sem armazenamento */ } },
    fromAuth(j) { return j && j.access_token ? { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, user: { id: j.user && j.user.id, email: j.user && j.user.email, name: nameOf(j.user) } } : null; },
    async fresh() {
      const se = this.session;
      if (!se || se.exp - Date.now() > 60000) return !!se;
      const r = await this.raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: se.rt }, auth: false });
      const ns = r.ok && this.fromAuth(r.data);
      if (ns) { this.save(ns); return true; }
      if (r.status >= 400 && r.status < 500) { this.save(null); renderAccount(); }   // sessão vencida: precisa entrar de novo
      return false;
    },
    async raw(path, { method = 'GET', body, auth = true, prefer } = {}) {
      const headers = { apikey: SB.key, 'Content-Type': 'application/json' };
      if (auth && this.session) headers.Authorization = 'Bearer ' + this.session.at;
      if (prefer) headers.Prefer = prefer;
      let res;
      try { res = await fetch(SB.url.replace(/\/+$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); }
      catch { return { ok: false, status: 0, data: null }; }
      let data = null; try { const t = await res.text(); data = t ? JSON.parse(t) : null; } catch { /* sem corpo */ }
      return { ok: res.ok, status: res.status, data };
    },
    async call(path, opt = {}) { if (!(await this.fresh())) return { ok: false, status: 401, data: null }; return this.raw(path, opt); },
    errText(r) {
      if (r.status === 0) return 'Sem conexão com o servidor da conta. Verifique a internet.';
      const d = r.data || {}; const code = d.error_code || d.code || ''; const msg = String(d.msg || d.error_description || d.message || d.error || '');
      if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return 'E-mail ou senha incorretos.';
      if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'Esse e-mail já tem conta. Use "Entrar".';
      if (code === 'weak_password' || /password/i.test(msg) && /(least|weak|short)/i.test(msg)) return 'Senha fraca: use pelo menos 8 caracteres.';
      if (code === 'email_not_confirmed') return 'Confirme seu e-mail pelo link que enviamos e tente de novo.';
      if (/rate limit|too many|over_/i.test(code + msg) || r.status === 429) return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
      if (code === 'validation_failed' || /valid email|unable to validate email/i.test(msg)) return 'Esse e-mail não parece válido.';
      if (code === 'signup_disabled') return 'Novos cadastros estão desativados.';
      return 'Não deu certo' + (msg ? ': ' + msg.slice(0, 140) : ` (erro ${r.status}).`);
    },
    async signUp(email, password) {
      const r = await this.raw('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false });
      if (!r.ok) return { error: this.errText(r) };
      const se = this.fromAuth(r.data);
      if (!se) return { pending: true };                 // projeto exige confirmar o e-mail
      this.save(se); return { ok: true };
    },
    async signIn(email, password) {
      const r = await this.raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
      const se = r.ok && this.fromAuth(r.data);
      if (!se) return { error: this.errText(r) };
      this.save(se); return { ok: true };
    },
    async signOut() { if (this.session) await this.raw('/auth/v1/logout', { method: 'POST', body: {} }); this.save(null); },
    async forgot(email) { return this.raw('/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin), { method: 'POST', body: { email }, auth: false }); },
    async newPassword(password) { return this.call('/auth/v1/user', { method: 'PUT', body: { password } }); },

    // ---- conversas
    async pushChat(id) {
      if (!this.session) return;
      try {
        const chat = (await Store.listChats()).find(c => c.id === id); if (!chat) return;
        const messages = await Store.getMessages(id);
        const a = await this.call('/rest/v1/chats?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ id, title: chat.title, model: chat.model || null, created: chat.created, updated: chat.updated, deleted: false }] });
        if (!a.ok) throw new Error('chat');
        const b = await this.call('/rest/v1/chat_messages?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ id, messages, updated: chat.updated }] });
        if (!b.ok) throw new Error('msgs');
        this.mark('ok');
      } catch { this.mark('error'); }
    },
    async deleteRemote(id) {
      if (!this.session) return;
      const a = await this.call('/rest/v1/chats?id=eq.' + encodeURIComponent(id), { method: 'PATCH', prefer: 'return=minimal', body: { deleted: true, updated: Date.now() } });
      await this.call('/rest/v1/chat_messages?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' });
      this.mark(a.ok ? 'ok' : 'error');
    },
    mark(state) { this.state = state; if (state === 'ok') this.last = Date.now(); renderAccount(); },
    async syncAll({ quiet = true } = {}) {
      if (!this.session || this.busy || S.streaming) return;
      this.busy = true; this.mark('syncing'); let pulled = 0, pushed = 0;
      try {
        const rem = await this.call('/rest/v1/chats?select=id,title,model,created,updated,deleted&order=updated.desc&limit=2000');
        if (!rem.ok || !Array.isArray(rem.data)) throw new Error('lista');
        const local = await Store.listChats(); const lmap = new Map(local.map(c => [c.id, c])); const rmap = new Map(rem.data.map(c => [c.id, c]));
        for (const r of rem.data) {
          const l = lmap.get(r.id);
          if (r.deleted) { if (l) { await Store.deleteChat(r.id); pulled++; } continue; }
          if (!l || r.updated > l.updated) {
            const m = await this.call('/rest/v1/chat_messages?select=messages&id=eq.' + encodeURIComponent(r.id));
            if (!m.ok || !Array.isArray(m.data)) throw new Error('msgs');
            const messages = Array.isArray(m.data[0] && m.data[0].messages) ? m.data[0].messages.filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string') : [];
            await Store.saveChat({ id: r.id, title: String(r.title || 'Conversa').slice(0, 80), model: r.model || null, created: Number(r.created) || Date.now(), updated: Number(r.updated) || Date.now() });
            await Store.saveMessages(r.id, messages); pulled++;
          } else if (l.updated > r.updated) { await this.pushChat(r.id); pushed++; }
        }
        for (const l of local) if (!rmap.has(l.id)) { await this.pushChat(l.id); pushed++; }
        await this.syncSettings();
        this.mark('ok');
        if (pulled) { await loadChats(); if (S.chat && !S.chats.some(c => c.id === S.chat.id) && !S.streaming) newChat(); }
        if (!quiet || pulled || pushed) toast(pulled || pushed ? `Sincronizado (${pulled} recebida(s), ${pushed} enviada(s)).` : 'Tudo sincronizado.');
      } catch { this.mark('error'); if (!quiet) toast('Não consegui sincronizar agora. Tento de novo em instantes.'); }
      finally { this.busy = false; renderAccount(); }
    },

    // ---- preferências
    async settingsPayload() { return { model: S.model, good: S.good, bad: S.bad, quota: await Store.getMeta('quota'), usage: await Store.getMeta('usage') }; },
    touch() {
      if (this.applying) return;
      Store.setMeta('settingsUpdated', Date.now()).catch(() => {});
      if (!this.session) return;
      clearTimeout(this.timer); this.timer = setTimeout(() => this.pushSettings(), 2500);
    },
    async pushSettings() {
      if (!this.session) return;
      const updated = Number(await Store.getMeta('settingsUpdated')) || Date.now();
      const r = await this.call('/rest/v1/user_settings?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ data: await this.settingsPayload(), updated }] });
      this.mark(r.ok ? 'ok' : 'error');
    },
    async syncSettings() {
      const r = await this.call('/rest/v1/user_settings?select=data,updated');
      if (!r.ok || !Array.isArray(r.data)) throw new Error('settings');
      const remote = r.data[0]; const mine = Number(await Store.getMeta('settingsUpdated')) || 0;
      if (remote && Number(remote.updated) > mine && remote.data && typeof remote.data === 'object') {
        this.applying = true;
        try {
          for (const k of SYNCED) {
            const v = remote.data[k];
            if (v === undefined || v === null) continue;
            await Store.setMeta(k, v);
          }
          await Store.setMeta('settingsUpdated', Number(remote.updated));
          if (typeof remote.data.model === 'string') S.model = remote.data.model;
          if (Array.isArray(remote.data.good)) S.good = remote.data.good;
          if (Array.isArray(remote.data.bad)) S.bad = remote.data.bad;
        } finally { this.applying = false; }
        fillModels(S.models); refreshUsageBadge();
      } else if (!remote || mine > Number(remote.updated)) await this.pushSettings();
    },
  };
  Store.onSetting = () => Cloud.touch();

  function renderAccount() {
    const box = $('#accBox'); if (!box) return;
    const lg = cloudOn && !!Cloud.session;
    $('#btnAcc').hidden = lg; $('#acct').hidden = !lg;
    if (!lg) closeAccMenu();
    if (lg) {
      const u = Cloud.session.user, nm = u.name || (u.email || '').split('@')[0] || 'Minha conta';
      document.querySelectorAll('#acct .am-name').forEach(e => { e.textContent = nm; });
      document.querySelectorAll('#acct .am-mail').forEach(e => { e.textContent = u.email || ''; });
      if (document.activeElement !== $('#accName')) $('#accName').value = u.name || '';
    }
    $('#dlgAcc h2').textContent = lg ? 'Perfil' : 'Conta';
    const on = cloudOn;
    $('#accOff').hidden = on; $('#accOut').hidden = !on || !!Cloud.session; $('#accIn').hidden = !on || !Cloud.session;
    $('#accRec').hidden = !(on && Cloud.recovery && Cloud.session);
    if (!on) { $('#accStatus').textContent = 'Contas ainda não estão ativadas neste site. Suas conversas ficam só neste aparelho.'; return; }
    if (!Cloud.session) { $('#accStatus').textContent = ''; accMode(accModeNow, accStep); return; }
    const st = Cloud.state === 'syncing' ? 'sincronizando…' : Cloud.state === 'error' ? 'erro ao sincronizar (vou tentar de novo)' : Cloud.last ? 'sincronizado às ' + new Date(Cloud.last).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'aguardando sincronização';
    $('#accStatus').textContent = `Logado como ${Cloud.session.user.email} · ${st}`;
  }
  let accModeNow = '', accStep = 'pick';
  function accMode(m, step) {                // '' = só Entrar/Criar conta; 'in'/'up' = escolher e-mail ou Google; depois o formulário
    accModeNow = m; accStep = step || 'pick';
    $('#accChoose').hidden = !!m;
    $('#accPick').hidden = !m || accStep !== 'pick';
    $('#accForm').hidden = !m || accStep !== 'email';
    $('#accLogin').hidden = m !== 'in'; $('#accSignup').hidden = m !== 'up'; $('#accForgot').hidden = m !== 'in';
    $('#accEmailTxt').textContent = m === 'up' ? 'Criar com e-mail' : 'Entrar com e-mail';
    $('#accGoogleTxt').textContent = m === 'up' ? 'Criar com Google' : 'Entrar com Google';
    $('#accPass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
    if (m && accStep === 'email') $('#accEmail').focus();
  }
  $('#accGoogle').addEventListener('click', async () => {   // o login com Google acontece no Supabase e volta para cá já logado
    const base = SB.url.replace(/\/$/, '');
    say('accMsg', 'Abrindo o Google...', true);
    try {
      const r = await fetch(base + '/auth/v1/settings', { headers: { apikey: SB.key } });
      const j = r.ok ? await r.json() : null;
      if (j && j.external && j.external.google === false) { say('accMsg', 'O login com Google ainda não foi ativado no Supabase.', false); return; }
    } catch (e) { say('accMsg', 'Não consegui falar com o servidor. Verifique a internet e tente de novo.', false); return; }
    location.href = base + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(location.origin + '/');
  });
  $('#accGoIn').addEventListener('click', () => accMode('in'));
  $('#accGoUp').addEventListener('click', () => accMode('up'));
  $('#accPickEmail').addEventListener('click', () => accMode(accModeNow, 'email'));
  $('#accPickBack').addEventListener('click', () => { accMode(''); $('#accMsg').textContent = ''; });
  $('#accBack').addEventListener('click', () => { accMode(accModeNow, 'pick'); $('#accMsg').textContent = ''; });
  function accBusy(on) { $$('#accBox button').forEach(b => { b.disabled = on; }); }
  async function afterLogin(msg) {
    renderAccount(); say('accMsg', msg, true); $('#accPass').value = '';
    await Cloud.syncAll({ quiet: false });
  }
  const accCreds = () => ({ email: $('#accEmail').value.trim(), pass: $('#accPass').value });
  $('#accLogin').addEventListener('click', async () => {
    const { email, pass } = accCreds(); if (!email || !pass) return say('accMsg', 'Preencha e-mail e senha.', false);
    accBusy(true); try { const r = await Cloud.signIn(email, pass); if (r.error) say('accMsg', r.error, false); else await afterLogin('Você entrou. Conversas deste aparelho também foram salvas na conta.'); } finally { accBusy(false); }
  });
  $('#accSignup').addEventListener('click', async () => {
    const { email, pass } = accCreds();
    if (!/^\S+@\S+\.\S+$/.test(email)) return say('accMsg', 'Digite um e-mail válido.', false);
    if (pass.length < 8) return say('accMsg', 'A senha precisa ter pelo menos 8 caracteres.', false);
    accBusy(true);
    try {
      const r = await Cloud.signUp(email, pass);
      if (r.error) say('accMsg', r.error, false);
      else if (r.pending) say('accMsg', 'Conta criada! Enviamos um e-mail de confirmação: clique no link e depois use "Entrar".', true);
      else await afterLogin('Conta criada! Suas conversas deste aparelho foram salvas na conta.');
    } finally { accBusy(false); }
  });
  $('#accForgot').addEventListener('click', async () => {
    const { email } = accCreds(); if (!/^\S+@\S+\.\S+$/.test(email)) return say('accMsg', 'Digite seu e-mail acima e clique de novo.', false);
    accBusy(true); try { const r = await Cloud.forgot(email); say('accMsg', r.ok ? 'Se esse e-mail tiver conta, enviamos um link para criar uma nova senha.' : Cloud.errText(r), r.ok); } finally { accBusy(false); }
  });
  $('#accSavePw').addEventListener('click', async () => {
    const pw = $('#accNewPw').value; if (pw.length < 8) return say('accMsg', 'A senha precisa ter pelo menos 8 caracteres.', false);
    accBusy(true); try { const r = await Cloud.newPassword(pw); if (r.ok) { Cloud.recovery = false; $('#accNewPw').value = ''; renderAccount(); say('accMsg', 'Senha alterada.', true); } else say('accMsg', Cloud.errText(r), false); } finally { accBusy(false); }
  });
  $('#accSync').addEventListener('click', async () => { accBusy(true); try { await Cloud.syncAll({ quiet: false }); } finally { accBusy(false); } });
  $('#accLogout').addEventListener('click', async () => {
    if (!confirm('Sair da conta neste aparelho?')) return;
    const wipe = confirm('Apagar também as conversas guardadas neste aparelho? (recomendado em computador compartilhado)\n\nOK = apagar daqui (continuam salvas na conta)\nCancelar = manter aqui');
    await Cloud.signOut();
    if (wipe) { try { for (const c of await Store.listChats()) await Store.deleteChat(c.id); } catch { /* segue */ } await loadChats(); newChat(); }
    renderAccount(); say('accMsg', 'Você saiu da conta.', true);
  });
  $('#accWipeCloud').addEventListener('click', async () => {
    if (!confirm('Apagar TODAS as suas conversas e preferências guardadas na nuvem? As cópias deste aparelho continuam. Isso não pode ser desfeito.')) return;
    accBusy(true);
    try {
      const uid = encodeURIComponent(Cloud.session.user.id); let ok = true;
      for (const t of ['chat_messages', 'chats', 'user_settings']) { const r = await Cloud.call(`/rest/v1/${t}?user_id=eq.${uid}`, { method: 'DELETE', prefer: 'return=minimal' }); ok = ok && r.ok; }
      say('accMsg', ok ? 'Seus dados na nuvem foram apagados.' : 'Não consegui apagar tudo. Tente de novo.', ok);
    } finally { accBusy(false); }
  });
  $('#accDelete').addEventListener('click', async () => {
    if (!confirm('EXCLUIR sua conta e todos os dados dela na nuvem? Isso não pode ser desfeito.')) return;
    if (prompt('Para confirmar, digite EXCLUIR:') !== 'EXCLUIR') return;
    accBusy(true);
    try {
      const r = await Cloud.call('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
      if (r.ok) { Cloud.save(null); renderAccount(); say('accMsg', 'Conta excluída. Suas conversas continuam neste aparelho.', true); }
      else say('accMsg', 'Não consegui excluir a conta agora. Tente de novo ou peça a exclusão pelo contato do site.', false);
    } finally { accBusy(false); }
  });
  function readRecoveryHash() {                       // link do e-mail "esqueci a senha" volta com a sessão no endereço
    const h = location.hash.replace(/^#/, ''); if (!h.includes('access_token')) return false;
    const p = new URLSearchParams(h); const se = Cloud.fromAuth({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
    history.replaceState(null, '', location.pathname + location.search);
    if (!se) return false;
    Cloud.save({ ...se, user: se.user.id ? se.user : { id: '', email: '' } });
    if (p.get('type') === 'recovery') Cloud.recovery = true;
    fetch(SB.url.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: SB.key, Authorization: 'Bearer ' + se.at } })
      .then(r => r.ok ? r.json() : null).then(u => { if (u && u.id && Cloud.session) { Cloud.save({ ...Cloud.session, user: { id: u.id, email: u.email, name: nameOf(u) } }); renderAccount(); } }).catch(() => {});
    return true;
  }

  // ---------- início ----------
  async function boot() {
    try { cfg = await (await fetch('/api/config', { cache: 'no-store' })).json(); }
    catch { document.body.innerHTML = '<p style="padding:24px">Não consegui falar com o servidor. Tente de novo em instantes.</p>'; return; }
    S.appName = cfg.appName; $('#brandName').textContent = S.appName; $('#ver').textContent = 'v' + VERSION;
    await Store.init();
    try {
      S.key = await Store.getMeta('key'); S.conn = await Store.getMeta('conn');
      S.access = (await Store.getMeta('access')) || ''; S.model = (await Store.getMeta('model')) || cfg.defaultModel; S.good = (await Store.getMeta('good')) || []; S.bad = (await Store.getMeta('bad')) || [];
    } catch { /* começa vazio */ }
    try { S.codeMode = (await api('/api/local')).code; } catch { S.codeMode = false; }
    if (S.codeMode) { try { S.codeCfg = await api('/api/code/config'); $('#modeTabs').hidden = false; } catch { S.codeMode = false; } }
    Cloud.load(); if (cloudOn && readRecoveryHash() && Cloud.recovery) setTimeout(() => { openAccount(); say('accMsg', 'Escolha uma nova senha abaixo.', true); }, 300);
    renderAccount();
    await loadChats();
    refreshUsageBadge();
    newChat();
    if (cloudOn && Cloud.session) Cloud.syncAll();
    if (S.key) {
      if (!S.conn) { const r = await detectConn(S.key); if (r.conn) { S.conn = r.conn; await Store.setMeta('conn', r.conn); updateComposer(); } }
      loadModels();
    } else fillModels([]);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !S.streaming) { if (S.mode === 'chat') loadChats(); else if (S.codeMode) loadCodeSessions(); if (cloudOn) Cloud.syncAll(); }
  });
  setInterval(() => { if (cloudOn && Cloud.session && document.visibilityState === 'visible' && !S.streaming) Cloud.syncAll(); }, 60000);
  boot();
})();
