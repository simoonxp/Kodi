/* Mascote do Kodi: camaleão em pixel art desenhado num <canvas>.
   Mora na barra lateral (olhando o chat) ou na borda da caixa de mensagem (virado para dentro, olhando o chat).
   Os olhos seguem o mouse, ele "lê" o que você digita, pega a mosquinha quando a resposta termina e ganha acessórios com o uso.
   A cor base é sempre o verde do Kodi; só muda nas animações (pensando, precisa de você, erro, sono, dança). */
(() => {
  'use strict';
  const SW = 24, SH = 22, FR = 8;
  const OX = 5, OYT = 9, OYB = 2;                            // moldura em volta do sprite, para corações e mosquinha não serem cortados
  const ROWS = { idle: 0, think: 1, need: 2, ready: 3, block: 4, sleep: 5 };
  const DY = { idle: [0, 0, 1, 1], think: [0, 0, 0, 0], need: [0, -1, -2, -1], ready: [0, -1, -1, 0], block: [0, 0, 0, 0], sleep: [0, 0, 1, 1] };
  const BODY_ROWS = new Set([0, 3, 5]);                       // estados "verdes": podem receber outra cor (dança e duplo clique)
  const PUPIL = '#072a2a';
  const UNLOCK = { oculos: { n: 10 }, festa: { n: 50 }, coroa: { n: 200 }, cachecol: { streak: 3 }, natal: { month: 11 } };
  const ACC_NAMES = { nenhum: 'Nenhum', oculos: 'Óculos', festa: 'Chapéu de festa', coroa: 'Coroa', cachecol: 'Cachecol', natal: 'Gorro de Natal' };
  const TIPS = [{ key: 'hide', sel: '#btnHideSide' }, { key: 'model', sel: '#modelChip' }, { key: 'settings', sel: '#btnSettings' }];
  const ART = {
    oculos: [...[12, 13, 14, 15, 16].flatMap(x => [[x, 5, '#101820'], [x, 9, '#101820']]), [12, 6, '#101820'], [12, 7, '#101820'], [12, 8, '#101820'], [16, 6, '#101820'], [16, 7, '#101820'], [16, 8, '#101820'], [11, 7, '#101820'], [10, 7, '#101820'], [17, 7, '#101820'], [18, 7, '#101820'], [13, 6, '#cfefff']],
    festa: [[12, 0, '#ffd95a'], [11, 1, '#ff5c8a'], [12, 1, '#ff5c8a'], [13, 1, '#ff5c8a'], [10, 2, '#ff5c8a'], [11, 2, '#ffd95a'], [12, 2, '#ff5c8a'], [13, 2, '#ffd95a'], [14, 2, '#ff5c8a']],
    natal: [...[9, 10, 11, 12, 13, 14].map(x => [x, 3, '#f5f5f5']), ...[10, 11, 12, 13].map(x => [x, 2, '#e03a3a']), [11, 1, '#e03a3a'], [12, 1, '#e03a3a'], [13, 1, '#e03a3a'], [12, 0, '#e03a3a'], [13, 0, '#e03a3a'], [14, 0, '#f5f5f5'], [14, -1, '#f5f5f5'], [15, 0, '#f5f5f5'], [15, -1, '#f5f5f5']],
    cachecol: [...[9, 10, 11, 12].map((x, i) => [x, 8, i % 2 ? '#f5f5f5' : '#e03a3a']), ...[9, 10, 11, 12].map((x, i) => [x, 9, i % 2 ? '#e03a3a' : '#f5f5f5']), [10, 10, '#e03a3a'], [11, 10, '#f5f5f5'], [10, 11, '#f5f5f5'], [10, 12, '#e03a3a']],
    coroa: [[10, 0, '#ffd95a'], [12, 0, '#ffd95a'], [14, 0, '#ffd95a'], [10, 1, '#ffd95a'], [11, 1, '#ffd95a'], [12, 1, '#ff5c8a'], [13, 1, '#ffd95a'], [14, 1, '#ffd95a'], [10, 2, '#e0a92a'], [11, 2, '#e0a92a'], [12, 2, '#e0a92a'], [13, 2, '#e0a92a'], [14, 2, '#e0a92a']],
  };
  const HEART = ['.#.#.', '#####', '.###.', '..#..'];

  const $ = s => document.querySelector(s);
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };

  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  function hsv2rgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  const GREEN_H = 148;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const dayNum = str => { const [y, m, d] = str.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const rnd = (a, b) => a + Math.random() * (b - a);

  const Pet = {
    el: null, hit: null, cv: null, ctx: null, slot: null, base: null, fx: null, cur: null, variants: new Map(),
    state: 'idle', t: 0, k: 4, hueOverride: null, ready: false, on: true, flip: false, flipHome: false, dir: null, size: 'auto', still: false, life: true, onChange: null, onUnlock: null,
    cursor: { x: -1, y: -1 }, typingUntil: 0, hearts: [], fly: null, catching: 0, danceUntil: 0, colorT: null, act: null, actT: null, walking: false, holdF: null, away: false,
    timer: null, sleepT: null, lifeT: null, errAt: 0, drag: null, mode: '', konami: 0, count: 0, best: 0, acc: 'nenhum', home: null, pos: { left: 0, top: 0 },
    streamAt: 0, streamN: 0, tip: null, tipAt: 0, tempAcc: null, shyUntil: 0, shyCool: 0, lastMove: null, bornAt: Date.now(), reply: null,

    init() {
      this.on = ls.get('kodi.pet') !== '0'; this.size = ls.get('kodi.petSize') || 'auto'; this.life = ls.get('kodi.petLife') !== '0';
      this.still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.count = parseInt(ls.get('kodi.petCount') || '0', 10) || 0; this.acc = ls.get('kodi.petAcc') || 'nenhum';
      const miss = this.visit();
      if (this.acc !== 'nenhum' && !this.unlocked(this.acc)) this.acc = 'nenhum';
      this.slot = $('#petSlot');
      const el = this.el = document.createElement('div'); el.id = 'pet';
      this.cv = document.createElement('canvas'); this.ctx = this.cv.getContext('2d'); el.appendChild(this.cv);
      const hit = this.hit = document.createElement('div'); hit.className = 'pethit'; hit.setAttribute('role', 'button'); hit.tabIndex = 0; hit.setAttribute('aria-label', 'Mascote do Kodi'); hit.title = 'Mascote do Kodi'; el.appendChild(hit);
      document.body.append(el); el.hidden = !this.on;
      this.bind();
      let loaded = 0; const done = () => { if (++loaded < 2) return; this.ready = true; this.cur = this.base; this.place(true); this.draw(); };
      const load = (src, cb) => { const i = new Image(); i.onload = () => { cb(this.toCanvas(i)); done(); }; i.src = src; };
      load('/mascote.png', c => { this.base = c; }); load('/mascote-fx.png', c => { this.fx = c; });
      const hour = new Date().getHours();
      this.set(hour < 5 ? 'sleep' : 'idle'); this.place(true);        // de madrugada ele acorda sonolento
      setInterval(() => this.tick(), 125);
      if (hour >= 5) setTimeout(() => this.hop(), 900);
      if (miss) setTimeout(() => { this.pet(); setTimeout(() => this.pet(), 900); }, 1600);   // saudade: voltou depois de uns dias
      this.scheduleLife();
    },
    toCanvas(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c; },
    // sequência de dias de uso (libera o cachecol) e saudade
    visit() {
      let st = null; try { st = JSON.parse(ls.get('kodi.petStreak') || 'null'); } catch { /* ok */ }
      const t = today(); let n = 1, best = this.best, miss = false;
      if (st && st.d) {
        const gap = dayNum(t) - dayNum(st.d);
        if (gap === 0) n = st.n || 1; else if (gap === 1) n = (st.n || 1) + 1; else { n = 1; miss = gap >= 3; }
        best = Math.max(best, st.best || 0);
      }
      const before = this.best; this.best = Math.max(best, n);
      ls.set('kodi.petStreak', JSON.stringify({ d: t, n, best: this.best }));
      if (before < UNLOCK.cachecol.streak && this.best >= UNLOCK.cachecol.streak && st) setTimeout(() => this.onUnlock && this.onUnlock(ACC_NAMES.cachecol), 3500);
      return miss;
    },
    unlocked(k) {
      const u = UNLOCK[k]; if (!u) return true;
      if (u.n != null) return this.count >= u.n; if (u.streak != null) return this.best >= u.streak; if (u.month != null) return new Date().getMonth() === u.month; return true;
    },
    lockText(k) {
      const u = UNLOCK[k]; if (!u || this.unlocked(k)) return '';
      if (u.n != null) return `faltam ${u.n - this.count} respostas`; if (u.streak != null) return `use ${u.streak} dias seguidos`; return 'só em dezembro';
    },

    // ---------- cor (base sempre verde; outras cores só em animações) ----------
    variantFor(h) {
      const key = Math.round(h / 4); if (this.variants.has(key)) return this.variants.get(key);
      const src = this.base, c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(src, 0, 0); const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
      for (let row = 0; row < 6; row++) {
        if (!BODY_ROWS.has(row)) continue;
        for (let y = row * SH; y < (row + 1) * SH; y++) for (let xx = 0; xx < c.width; xx++) {
          const i = (y * c.width + xx) * 4; if (d[i + 3] < 10) continue;
          const [ph, ps, pv] = rgb2hsv(d[i], d[i + 1], d[i + 2]);
          if (ph < 95 || ph > 200 || ps < .25) continue;     // só o verde do corpo (olho e língua ficam)
          const [nr, ng, nb] = hsv2rgb((h + (ph - GREEN_H) * .3 + 360) % 360, Math.min(1, ps * .95), pv);
          d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
        }
      }
      x.putImageData(id, 0, 0); if (this.variants.size > 24) this.variants.clear(); this.variants.set(key, c); return c;
    },
    applyColor() { if (!this.ready) return; this.cur = this.hueOverride == null ? this.base : this.variantFor(this.hueOverride); },
    tint(h, ms) { this.hueOverride = h; this.applyColor(); clearTimeout(this.colorT); this.colorT = setTimeout(() => { this.hueOverride = null; this.applyColor(); }, ms); },
    // camuflagem: ele "imita" por instantes a cor da IA que você acabou de escolher e volta ao verde
    camo(color) {
      if (!this.ready || this.state !== 'idle' || this.danceUntil || Date.now() - this.bornAt < 4000) return;
      let h = null, m;
      if ((m = /^hsl\(\s*(\d+)/i.exec(color || ''))) h = +m[1];
      else if ((m = /^#([0-9a-f]{6})$/i.exec(color || ''))) { const n = parseInt(m[1], 16); const [hh, ss] = rgb2hsv(n >> 16, (n >> 8) & 255, n & 255); if (ss > .15) h = hh; }
      if (h == null) h = Math.floor(Math.random() * 360);
      this.cancelAct(true); this.startAct('camo', 2800); this.tint(h, 2800); this.hop();
    },

    // ---------- estados ----------
    set(state, ms = 0) {
      clearTimeout(this.timer); clearTimeout(this.sleepT);
      if (state !== this.state) { this.t = 0; if (state !== 'idle') this.cancelAct(true); }
      this.state = state;
      if (ms) this.timer = setTimeout(() => this.set('idle'), ms);
      else if (state === 'idle') this.sleepT = setTimeout(() => this.set('sleep'), 100000);
    },
    busy(on) {
      if (on) { this.cancelAct(true); this.tip = null; this.set('think'); this.fly = { born: Date.now() }; return; }
      this.fly = null;
      if (Date.now() - this.errAt < 1500) return;
      this.addCount(); this.catching = 1; this.readyAt = Date.now(); this.set('ready', 2600); const iv = setInterval(() => this.draw(), 45); setTimeout(() => clearInterval(iv), 900);
      const r = this.reply; this.reply = null;
      if (r && r.code) { this.tempAcc = { name: 'oculos', until: Date.now() + 8000 }; }           // resposta com código: óculos de programador
      if (r && r.len > 2500) setTimeout(() => { if (this.state === 'idle') this.startAct('yawn', 1600); }, 3000);   // resposta longa: cansa
    },
    noteReply(text) { text = String(text || ''); this.reply = { len: text.length, code: text.includes('```') }; },
    fail() { this.errAt = Date.now(); this.fly = null; this.set('block', 3200); },
    hop() { if (!this.el || this.still) return; this.el.classList.add('hop'); setTimeout(() => this.el && this.el.classList.remove('hop'), 520); },
    typing() { this.cancelAct(true); this.tip = null; this.typingUntil = Date.now() + 1800; if (this.state === 'sleep') this.set('idle'); },
    stream(n) { this.streamAt = Date.now(); this.streamN = n || 0; },
    sent(text) {
      this.hop(); if (this.state === 'sleep') this.set('idle');
      if (/obrigad|brigad|valeu|thank|vlw/i.test(String(text || ''))) { this.pet(); setTimeout(() => this.hop(), 600); }   // agradeceu: ele fica feliz
    },
    dance(ms = 4200) { this.cancelAct(true); this.danceUntil = Date.now() + ms; this.set('need', ms); },
    show(on) { this.on = on; if (this.el) this.el.hidden = !on; ls.set('kodi.pet', on ? '1' : '0'); this.place(true); this.changed(); },
    setSize(v) { this.size = v; ls.set('kodi.petSize', v); this.place(true); this.renderSettings(); this.changed(); },
    setLife(on) { this.life = on; ls.set('kodi.petLife', on ? '1' : '0'); if (!on) { this.cancelAct(true); this.goHome(); } },
    // comandos do chat: /mascote [esconder|mostrar|pequeno|medio|grande|quieto|livre]
    command(arg) {
      arg = (arg || '').toLowerCase().trim();
      if (arg === 'esconder') this.show(false); else if (arg === 'mostrar') this.show(true);
      else if (arg === 'pequeno') this.setSize('pequeno'); else if (arg === 'medio' || arg === 'médio') this.setSize('auto'); else if (arg === 'grande') this.setSize('grande');
      else if (arg === 'quieto' || arg === 'parado') this.setLife(false); else if (arg === 'livre' || arg === 'solto') this.setLife(true);
      else this.show(!this.on);
      const c = $('#petOn'); if (c) c.checked = this.on;
    },
    changed() { if (this.onChange) this.onChange(this.export()); },
    export() { return { on: this.on, count: this.count, acc: this.acc, size: this.size, streak: this.best }; },
    import(o) {                                   // preferências vindas da conta (outro aparelho)
      if (!o || typeof o !== 'object') return;
      if (typeof o.count === 'number') { this.count = Math.max(this.count, o.count); ls.set('kodi.petCount', String(this.count)); }
      if (typeof o.streak === 'number') this.best = Math.max(this.best, o.streak);
      if ((typeof o.acc === 'string' && ART[o.acc]) || o.acc === 'nenhum') { this.acc = o.acc; ls.set('kodi.petAcc', this.acc); }
      if (typeof o.size === 'string') { this.size = o.size; ls.set('kodi.petSize', this.size); }
      if (typeof o.on === 'boolean') { this.on = o.on; ls.set('kodi.pet', o.on ? '1' : '0'); if (this.el) this.el.hidden = !o.on; const c = $('#petOn'); if (c) c.checked = o.on; }
      if (this.acc !== 'nenhum' && !this.unlocked(this.acc)) this.acc = 'nenhum';
      this.renderSettings(); if (this.el) this.place(true);
    },

    // ---------- acessórios ----------
    addCount() {
      const before = this.count; this.count++; ls.set('kodi.petCount', String(this.count));
      for (const [k, u] of Object.entries(UNLOCK)) if (u.n != null && before < u.n && this.count >= u.n && this.onUnlock) setTimeout(() => this.onUnlock(ACC_NAMES[k]), 2800);
      this.renderSettings(); this.changed();
    },
    setAcc(a) { this.acc = a; ls.set('kodi.petAcc', a); this.renderSettings(); this.changed(); },
    renderSettings() {
      const box = $('#petAcc'); if (box) {
        box.innerHTML = '';
        for (const [k, name] of Object.entries(ACC_NAMES)) {
          const lock = this.lockText(k);
          const b = document.createElement('button'); b.type = 'button'; b.className = 'accopt' + (this.acc === k ? ' on' : ''); b.disabled = !!lock;
          b.textContent = lock ? `${name} · ${lock}` : name; b.addEventListener('click', () => this.setAcc(k)); box.appendChild(b);
        }
      }
      const sz = $('#petSize'); if (sz) {
        sz.innerHTML = '';
        for (const [k, name] of [['pequeno', 'Pequeno'], ['auto', 'Médio'], ['grande', 'Grande']]) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'accopt' + (this.size === k ? ' on' : ''); b.textContent = name; b.addEventListener('click', () => this.setSize(k)); sz.appendChild(b);
        }
      }
      const lf = $('#petLife'); if (lf) lf.checked = this.life;
    },

    // ---------- posição ----------
    desktop: () => window.innerWidth >= 761,
    sizeFor(mode) {
      const w = window.innerWidth, noside = document.body.classList.contains('noside');
      let k = mode === 'side' ? 3 : (w >= 761 && noside) ? (w >= 1500 ? 7 : 6) : 4;
      if (this.size === 'pequeno') k = Math.max(2, k - 1); else if (this.size === 'grande') k += 1;
      return k;
    },
    place(first) {
      if (!this.el) return;
      const side = $('#side');
      const sideShown = this.desktop() && !document.body.classList.contains('noside') && side && side.getBoundingClientRect().width > 0;
      const mode = sideShown ? 'side' : 'perch';
      const changed = this.mode !== mode;
      if (changed) { if (!first && this.mode) this.hop(); this.mode = mode; }
      this.flipHome = mode === 'perch';                     // pousado à direita da caixa: vira para dentro, olhando o chat
      document.body.classList.toggle('pet-side', mode === 'side' && this.on);
      const k = this.sizeFor(mode), kChanged = k !== this.k; this.k = k;
      const cw = (SW + 2 * OX) * k, ch = (SH + OYT + OYB) * k;
      if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
      this.el.style.width = cw + 'px'; this.el.style.height = ch + 'px';
      Object.assign(this.hit.style, { left: OX * k + 'px', top: OYT * k + 'px', width: SW * k + 'px', height: SH * k + 'px' });
      const w = SW * k, h = SH * k, lim = window.innerWidth - w - 4; let homeL, top, minL, maxL;
      if (mode === 'side') { const r = (this.slot || side).getBoundingClientRect(); homeL = r.left + 14; top = r.bottom - h + 2 * k; minL = homeL; maxL = Math.max(homeL, r.right - w - 14); }
      else { const b = $('#box'); const r = b ? b.getBoundingClientRect() : { left: 20, right: window.innerWidth - 20, top: window.innerHeight - 90 }; homeL = r.right - w - 26; top = r.top - 19 * k + 2; maxL = homeL; minL = r.left + 24; }
      homeL = clamp(homeL, 4, lim); maxL = clamp(maxL, 4, lim); minL = Math.min(clamp(minL, 4, lim), maxL); top = Math.max(4, top);
      this.minL = minL; this.maxL = maxL; this.home = { left: homeL, top, w, h };
      if (changed || kChanged || first) { this.cancelAct(false); this.away = false; }
      if (first) this.el.classList.add('nomove');
      if (!this.drag) {
        if (!this.away) { this.pos.left = this.home.left; this.el.style.left = this.home.left - OX * k + 'px'; }
        this.pos.top = top; this.el.style.top = top - OYT * k + 'px';
      }
      this.face();
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove('nomove')));
      this.draw();
    },
    face() { this.flip = this.dir ? this.dir === 'L' : this.flipHome; },

    // ---------- vida própria: passeios, pulos e manias ----------
    freeze() {                                                   // para onde ele está agora (no meio do caminho)
      const r = this.hit.getBoundingClientRect(); this.el.style.transition = 'none';
      this.pos.left = r.left; this.el.style.left = r.left - OX * this.k + 'px'; void this.el.offsetWidth; this.el.style.transition = '';
    },
    startAct(name, ms) { clearTimeout(this.actT); this.act = { name, until: Date.now() + ms }; this.actT = setTimeout(() => this.endAct(), ms + 30); const c = this.el.classList; if (name === 'stretch') c.add('stretch'); if (name === 'yawn') c.add('yawn'); if (name === 'yawn' || name === 'scratch') this.holdF = 6; },
    endAct() {
      clearTimeout(this.actT); this.act = null; this.walking = false; this.dir = null; this.holdF = null; this.tip = null;
      if (this.el) { this.el.style.transition = ''; this.el.classList.remove('stretch', 'yawn'); }
      if (this.home) this.away = Math.abs(this.pos.left - this.home.left) > 4;
      this.face();
    },
    cancelAct(freeze) {
      if (!this.act) return;
      if (freeze && (this.act.name === 'walk' || this.act.name === 'jump')) this.freeze();
      this.endAct();
    },
    canAct() { return this.on && this.ready && !this.still && this.life && !this.drag && !this.act && this.state === 'idle' && Date.now() >= this.typingUntil && document.visibilityState !== 'hidden' && this.danceUntil < Date.now(); },
    walkTo(x, kind = 'walk') {
      x = clamp(x, this.minL, this.maxL); const dist = x - this.pos.left; if (Math.abs(dist) < 10) return false;
      const ms = kind === 'jump' ? 560 : Math.max(900, Math.abs(dist) / (this.k * 16) * 1000);
      this.dir = dist < 0 ? 'L' : 'R'; this.face(); this.startAct(kind, ms); this.walking = kind === 'walk';
      if (kind === 'jump') this.hop();
      this.el.style.transition = (kind === 'jump' ? 'left .56s cubic-bezier(.3, 1.2, .5, 1)' : `left ${ms}ms linear`) + ', top .55s cubic-bezier(.3, 1.4, .5, 1)';
      this.pos.left = x; this.el.style.left = x - OX * this.k + 'px'; return true;
    },
    goHome() { if (this.home && this.away) { this.cancelAct(true); this.walkTo(this.home.left, 'walk'); } },
    scheduleLife() {
      clearTimeout(this.lifeT);
      const h = new Date().getHours(), mood = h >= 5 && h < 12 ? .7 : (h >= 22 || h < 5) ? 1.6 : 1;     // manhã animado, noite sonolento
      this.lifeT = setTimeout(() => { try { this.lifeStep(h); } catch { /* ok */ } this.scheduleLife(); }, rnd(6500, 15000) * mood);
    },
    lifeStep(h) {
      if (!this.canAct()) return;
      const night = h >= 22 || h < 5, range = this.maxL - this.minL;
      const tips = this.pickTip();
      const opts = [['walk', range > 30 ? 3 : 0], ['jump', range > 30 ? 1.5 : 0], ['stretch', 1.5], ['yawn', night ? 3.5 : 1], ['scratch', 1], ['look', 1.6], ['camo', .7], ['tip', tips && Date.now() - this.tipAt > 120000 ? 2 : 0], ['home', this.away ? 4 : 0]];
      let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), pick = 'look';
      for (const o of opts) { if ((r -= o[1]) < 0) { pick = o[0]; break; } }
      const far = () => { let x, n = 0; do { x = rnd(this.minL, this.maxL); } while (Math.abs(x - this.pos.left) < range * .25 && ++n < 6); return x; };
      if (pick === 'walk' || pick === 'jump') this.walkTo(far(), pick);
      else if (pick === 'home') this.walkTo(this.home.left, 'walk');
      else if (pick === 'stretch') this.startAct('stretch', 1100);
      else if (pick === 'yawn') this.startAct('yawn', 1500);
      else if (pick === 'scratch') this.startAct('scratch', 1300);
      else if (pick === 'look') this.startAct('look', 2400);
      else if (pick === 'camo') { this.startAct('camo', 2800); this.tint(Math.floor(Math.random() * 360), 2800); this.hop(); }
      else if (pick === 'tip' && tips) { this.tipAt = Date.now(); this.startAct('tip', 3200); this.tip = tips; this.hop(); tips.el.classList.add('petping'); setTimeout(() => tips.el.classList.remove('petping'), 3000); }
    },
    // dica por olhar: ele olha para um botão que você ainda não usou
    pickTip() {
      let used = {}; try { used = JSON.parse(ls.get('kodi.petTips') || '{}'); } catch { /* ok */ }
      const ok = TIPS.filter(t => !used[t.key]).map(t => ({ ...t, el: $(t.sel) })).filter(t => { if (!t.el) return false; const r = t.el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
    },
    markTip(target) {
      for (const t of TIPS) if (target.closest(t.sel)) { let used = {}; try { used = JSON.parse(ls.get('kodi.petTips') || '{}'); } catch { /* ok */ } if (!used[t.key]) { used[t.key] = 1; ls.set('kodi.petTips', JSON.stringify(used)); } }
    },
    shy() {                                                      // passou o mouse rápido demais por cima: ele se encolhe
      if (!this.on || this.state === 'sleep' || Date.now() < this.shyCool) return;
      this.shyCool = Date.now() + 7000; this.shyUntil = Date.now() + 1300; this.cancelAct(true); this.el.classList.add('shy');
      setTimeout(() => this.el && this.el.classList.remove('shy'), 1300);
    },

    // ---------- desenho ----------
    tick() {
      if (!this.ready || !this.on) return;
      if (!this.still || this.danceUntil > Date.now()) this.t = (this.t + 1) % (FR * 100);
      const now = Date.now();
      if (this.danceUntil > now) { this.hueOverride = (this.t * 47) % 360; this.applyColor(); }
      else if (this.danceUntil) { this.danceUntil = 0; this.hueOverride = null; this.applyColor(); }
      if (this.catching && this.state !== 'ready') this.catching = 0;
      if (this.tempAcc && now > this.tempAcc.until) this.tempAcc = null;
      this.hearts = this.hearts.filter(h => (h.life -= 1) > 0);
      this.draw();
    },
    // pupila: retângulo 1 x 1,5 (em pixels do sprite) que anda em meios-pixels dentro do olho (muitas direções)
    pupilRect() {
      const f = this.t % FR, now = Date.now();
      let px, py;
      const aim = (tx, ty) => {
        const r = this.hit.getBoundingClientRect(); const ex = this.flip ? SW - 14.5 : 14.5;
        let dx = tx - (r.left + (ex / SW) * r.width), dy = ty - (r.top + (7.5 / SH) * r.height);
        if (this.flip) dx = -dx;
        const d = Math.hypot(dx, dy), m = clamp(d / 220, 0, 1), ang = Math.atan2(dy, dx);
        px = 14 + Math.cos(ang) * m * 1.15; py = 6.75 + Math.sin(ang) * m * .95;
      };
      if (now - this.streamAt < 800) {                                           // acompanhando o texto da resposta: lê e vai descendo
        px = 13 + (this.t % 5) * .5; py = 6 + Math.min(1.5, this.streamN / 2200 * 1.5);
      } else if (this.state === 'think') { const a = (f / FR) * Math.PI * 2; px = 14 + Math.cos(a); py = 6.75 + Math.sin(a) * .75; }
      else if (now < this.typingUntil) {                                         // "lendo": varre o olho como quem lê linhas de texto
        const step = this.t % 6; px = 13 + step * .4; py = (Math.floor(this.t / 6) % 2) ? 7 : 7.5;
      } else if (this.act && this.act.name === 'look') {
        const seq = [[13, 6], [15, 6], [15, 7.5], [13, 7.5], [14, 6.5], [15, 7]]; [px, py] = seq[Math.floor((now - (this.act.until - 2400)) / 400) % seq.length];
      } else if (this.act && this.act.name === 'scratch') { px = 14; py = 6; }
      else if (this.tip && this.tip.el) { const r = this.tip.el.getBoundingClientRect(); aim(r.left + r.width / 2, r.top + r.height / 2); }
      else if (this.cursor.x < 0) { px = 15; py = 6; }
      else aim(this.cursor.x, this.cursor.y);
      px = Math.round(clamp(px, 13, 15) * 2) / 2; py = Math.round(clamp(py, 6, 7.5) * 2) / 2;
      if (py > 6.5) px = Math.max(px, 14);                                       // a fileira de baixo do olho é mais estreita
      return [px, py];
    },
    draw() {
      if (!this.ready || !this.cv) return;
      const k = this.k, c = this.ctx, row = ROWS[this.state] ?? 0, f = this.holdF != null ? this.holdF : this.t % FR, now = Date.now(), an = this.act && this.act.name;
      this.face();
      c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = false; c.clearRect(0, 0, this.cv.width, this.cv.height);
      const bob = this.walking ? (this.t % 2 ? -1 : 0) : 0;          // andando: balança a cada passo
      c.translate(OX * k, (OYT + bob) * k);
      const src = BODY_ROWS.has(row) && this.cur ? this.cur : this.base;
      // inclinação da cabeça: para o chat ao digitar; balançando no erro; coçando; bocejando
      const reading = now < this.typingUntil || now - this.streamAt < 800 || !!this.tip;
      const lean = this.state === 'block' ? (this.t % 2 ? 1 : -1) : an === 'scratch' ? (this.t % 2 ? 1 : -1) : an === 'yawn' ? -1 : (reading || this.walking) ? 1 : 0, HEAD = 10;
      c.save(); if (this.flip) { c.translate(SW * k, 0); c.scale(-1, 1); }
      c.drawImage(src, f * SW, row * SH, SW, HEAD, lean * k, 0, SW * k, HEAD * k);
      c.drawImage(src, f * SW, row * SH + HEAD, SW, SH - HEAD, 0, HEAD * k, SW * k, (SH - HEAD) * k);
      const dy = DY[this.state][f % 4];
      const px = (x, y, col, a = 1, w = 1, h = 1) => { c.globalAlpha = a; c.fillStyle = col; const xx = x + (y < HEAD ? lean : 0); c.fillRect(Math.round(xx * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)); c.globalAlpha = 1; };
      const closed = this.state === 'sleep' || this.state === 'block' || (this.state === 'idle' && f === 6);
      if (!closed) { const [ex, ey] = this.pupilRect(); px(ex, ey + dy, PUPIL, 1, 1, 1.5); }
      const art = ART[this.acc] || (this.tempAcc && ART[this.tempAcc.name]); if (art) for (const [x, y, col] of art) px(x, y + dy, col);
      // mosquinhas (claras, bem visíveis)
      const fly = (x, y, wing, s = 1) => { px(x, y, '#f4f4f4', 1, 2 * s, 1.2 * s); px(x + .2 * s, y + .2 * s, '#7a7a7a', 1, .6 * s, .6 * s); px(x - .6 * s, y - (1.4 + wing) * s, '#bfe9ff', .95, 1.2 * s, 1.2 * s); px(x + 1.4 * s, y - (1.4 + wing) * s, '#bfe9ff', .95, 1.2 * s, 1.2 * s); };
      if (this.state === 'think' && this.fly) {
        const a = (now - this.fly.born) / 650; fly(21.5 + Math.cos(a * 1.3) * 3.2, 3 + Math.sin(a * 2.2) * 2.6, this.t % 2);
      } else if (this.catching && this.state === 'ready') {
        // língua comprida: sai da boca, pega a mosquinha e a puxa de volta (tudo desenhado, sem língua no sprite)
        const p = (now - this.readyAt) / 750, mx = 18.6, my = 7.7, fx = 27, fy = 5.4;
        if (p < 1) {
          const e = p < .3 ? p / .3 : 1 - (p - .3) / .7, tx = mx + (fx - mx) * e, ty = my + (fy - my) * e, n = Math.max(2, Math.round(Math.hypot(tx - mx, ty - my) * 1.6));
          for (let i = 0; i <= n; i++) px(mx + (tx - mx) * i / n, my + (ty - my) * i / n, '#ff7aa8', 1, 1.1, 1.1);
          if (e > .08) { px(tx - .2, ty - .2, '#ff4f8b', 1, 1.5, 1.5); }
          if (p < 1 - .12) fly(tx + .6, ty - .5, this.t % 2);          // a mosquinha vem presa na ponta
        }
      }
      // mosquinhas adotadas: rodeiam o camaleão (mais delas conforme o uso)
      const comp = this.count < 25 ? 0 : Math.min(3, 1 + Math.floor(this.count / 100));
      if (comp && this.state !== 'sleep' && this.state !== 'think') for (let i = 0; i < comp; i++) { const a = now / 1700 + i * 2.1; fly(13 + Math.cos(a) * 8.5, 0 + Math.sin(a * 1.7) * 2.2 - i * .5, (this.t + i) % 2, .75); }
      // corações do carinho (sobem por cima da cabeça, dentro da moldura)
      for (const h of this.hearts) {
        const age = 1 - h.life / h.max, a = Math.min(1, h.life / 4);
        HEART.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') px(h.x + i * .9 + Math.sin(age * 6 + h.s) * 1.2, h.y - age * 9 + j * .9, '#ff5c8a', a, .9, .9); }));
      }
      c.restore();
      // efeitos (!, ?, z, reticências, brilhos): ficam do lado certo, sem espelhar
      if (this.fx) c.drawImage(this.fx, f * SW, row * SH, SW, SH, 0, 0, SW * k, SH * k);
    },

    // ---------- interação ----------
    bind() {
      const hit = this.hit;
      document.addEventListener('pointermove', e => {
        const now = performance.now(); this.cursor.x = e.clientX; this.cursor.y = e.clientY;
        if (this.drag) this.dragMove(e);
        else if (this.lastMove && now > this.lastMove.t) {
          const v = Math.hypot(e.clientX - this.lastMove.x, e.clientY - this.lastMove.y) / (now - this.lastMove.t);
          if (v > 1.7 && this.home) { const r = hit.getBoundingClientRect(); if (e.clientX > r.left - 8 && e.clientX < r.right + 8 && e.clientY > r.top - 8 && e.clientY < r.bottom + 8) this.shy(); }
        }
        this.lastMove = { x: e.clientX, y: e.clientY, t: now };
      }, { passive: true });
      document.addEventListener('click', e => { if (e.target && e.target.closest) this.markTip(e.target); }, true);
      hit.addEventListener('pointerdown', e => { this.cancelAct(true); this.drag = { sx: e.clientX, sy: e.clientY, ox: parseFloat(this.el.style.left), oy: parseFloat(this.el.style.top), moved: false }; try { hit.setPointerCapture(e.pointerId); } catch { /* ok */ } });
      hit.addEventListener('pointerup', e => this.dragEnd(e)); hit.addEventListener('pointercancel', e => this.dragEnd(e));
      hit.addEventListener('dblclick', () => { this.tint(Math.floor(Math.random() * 360), 3500); this.hop(); });
      hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pet(); } });
      window.addEventListener('resize', () => this.place());
      const ro = new ResizeObserver(() => this.place()); [$('#box'), $('#main'), $('#side')].forEach(n => n && ro.observe(n));
      new MutationObserver(() => this.place()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
      document.addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; this.konami = e.key === seq[this.konami] ? this.konami + 1 : (e.key === seq[0] ? 1 : 0); if (this.konami === seq.length) { this.konami = 0; this.dance(5000); } });
    },
    pet() {
      this.hop(); if (this.state === 'sleep') this.set('idle');
      for (let i = 0; i < 4; i++) this.hearts.push({ x: 12 + i * 2.2, y: 1 - (i % 2), life: 14 + i * 2, max: 16 + i * 2, s: i * 2 });
    },
    dragMove(e) {
      const d = this.drag; const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; this.el.classList.add('dragging'); }
      if (d.moved) { this.el.style.left = d.ox + dx + 'px'; this.el.style.top = d.oy + dy + 'px'; }
    },
    dragEnd() {
      const d = this.drag; if (!d) return; this.drag = null; this.el.classList.remove('dragging');
      if (d.moved) { this.away = false; this.place(); this.hop(); } else this.pet();
    },
  };
  window.Pet = Pet;
})();
