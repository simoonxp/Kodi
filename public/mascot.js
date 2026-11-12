/* Mascote do Kodi: camaleão em pixel art desenhado num <canvas>.
   Mora na borda da caixa de mensagem (ou na barra lateral, ou no "Olá!"), segue o mouse com os olhos,
   pega a mosquinha quando a resposta termina, muda de cor conforme a IA em uso e ganha acessórios com o uso. */
(() => {
  'use strict';
  const SW = 24, SH = 22, FR = 8;
  const ROWS = { idle: 0, think: 1, need: 2, ready: 3, block: 4, sleep: 5 };
  const DY = { idle: [0, 0, 1, 1], think: [0, 0, 0, 0], need: [0, -1, -2, -1], ready: [0, -1, -1, 0], block: [0, 0, 0, 0], sleep: [0, 0, 1, 1] };
  const BODY_ROWS = new Set([0, 3, 5]);                       // só estes estados recebem a cor do modelo
  const EYE_POS = [[13, 6], [14, 6], [15, 6], [14, 7], [15, 7]];   // onde a pupila (1x2) pode ficar dentro do olho
  const THINK_PATH = [[14, 6], [15, 6], [15, 7], [14, 7], [13, 6]];
  const PUPIL = '#072a2a';
  const UNLOCK = { oculos: 10, festa: 50, coroa: 200 };
  const ACC_NAMES = { nenhum: 'Nenhum', oculos: 'Óculos', festa: 'Chapéu de festa', coroa: 'Coroa' };
  // acessórios em pixels: [x, y, cor]
  const ART = {
    oculos: [...[12, 13, 14, 15, 16].flatMap(x => [[x, 5, '#101820'], [x, 9, '#101820']]), [12, 6, '#101820'], [12, 7, '#101820'], [12, 8, '#101820'], [16, 6, '#101820'], [16, 7, '#101820'], [16, 8, '#101820'], [11, 7, '#101820'], [10, 7, '#101820'], [13, 6, '#cfefff'], [17, 7, '#101820'], [18, 7, '#101820']],
    festa: [[12, 0, '#ffd95a'], [11, 1, '#ff5c8a'], [12, 1, '#ff5c8a'], [13, 1, '#ff5c8a'], [10, 2, '#ff5c8a'], [11, 2, '#ffd95a'], [12, 2, '#ff5c8a'], [13, 2, '#ffd95a'], [14, 2, '#ff5c8a']],
    coroa: [[10, 0, '#ffd95a'], [12, 0, '#ffd95a'], [14, 0, '#ffd95a'], [10, 1, '#ffd95a'], [11, 1, '#ffd95a'], [12, 1, '#ffd95a'], [13, 1, '#ffd95a'], [14, 1, '#ffd95a'], [12, 1, '#ff5c8a'], [10, 2, '#e0a92a'], [11, 2, '#e0a92a'], [12, 2, '#e0a92a'], [13, 2, '#e0a92a'], [14, 2, '#e0a92a']],
  };
  const HEART = ['.#.#.', '#####', '.###.', '..#..'];
  const FRASES_PENSANDO = ['Pensando…', 'Hmm, deixa eu ver…', 'Já te respondo!', 'Procurando a resposta…'];
  const FRASES_PRONTO = ['Pronto!', 'Aqui está!', 'Nhac! Peguei.', 'Resposta na mesa!'];
  const FRASES_IDLE = ['Dica: Shift+Enter quebra a linha.', 'Sabia que eu mudo de cor com a IA em uso?', 'Clique em mim, eu gosto.', 'Arraste e solte: eu volto pro meu lugar.', 'Escreva /dançar e veja o que acontece.', 'Dá pra me esconder nas configurações.'];

  const $ = s => document.querySelector(s);
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };
  const rnd = a => a[Math.floor(Math.random() * a.length)];

  // ---------- cor ----------
  function cssToRgb(c) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  }
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

  const Pet = {
    el: null, cv: null, ctx: null, bubble: null, slot: null, sheet: null, base: null, variants: new Map(),
    state: 'idle', t: 0, k: 4, hue: null, hueOverride: null, ready: false, on: true, talk: true,
    cursor: { x: -1, y: -1 }, typingUntil: 0, hearts: [], fly: null, catching: 0, hopUntil: 0, danceUntil: 0,
    timer: null, sleepT: null, nudgeT: null, errAt: 0, drag: null, mode: '', konami: 0,
    count: 0, acc: 'nenhum',

    init() {
      this.on = ls.get('kodi.pet') !== '0'; this.talk = ls.get('kodi.petTalk') !== '0';
      this.count = parseInt(ls.get('kodi.petCount') || '0', 10) || 0; this.acc = ls.get('kodi.petAcc') || 'nenhum';
      if (this.acc !== 'nenhum' && this.count < (UNLOCK[this.acc] || 0)) this.acc = 'nenhum';
      this.slot = $('#petSlot');
      const el = this.el = document.createElement('div'); el.id = 'pet'; el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', 'Mascote do Kodi'); el.title = 'Mascote do Kodi';
      this.cv = document.createElement('canvas'); this.ctx = this.cv.getContext('2d'); el.appendChild(this.cv);
      this.bubble = document.createElement('div'); this.bubble.id = 'petBubble'; this.bubble.hidden = true;
      document.body.append(el, this.bubble); el.hidden = !this.on;
      this.bind();
      const img = new Image(); img.onload = () => { this.sheet = img; this.base = this.toCanvas(img); this.ready = true; this.applyColor(); this.place(true); this.draw(); }; img.src = '/mascote.png';
      this.set('idle'); this.place(true);
      setInterval(() => this.tick(), 125);
      setTimeout(() => this.greet(), 1200);
      this.scheduleNudge();
    },
    toCanvas(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c; },

    // ---------- cor do modelo ----------
    setColor(css) { try { const [r, g, b] = cssToRgb(css); const [h] = rgb2hsv(r, g, b); const prev = this.hue; this.hue = h; if (!this.hueOverride) { this.applyColor(); if (prev !== null && Math.abs(prev - h) > 8) this.hop(); } } catch { /* sem cor */ } },
    variantFor(h) {
      const key = Math.round(h / 4); if (this.variants.has(key)) return this.variants.get(key);
      const src = this.base, c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(src, 0, 0); const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
      for (let row = 0; row < 6; row++) {
        if (!BODY_ROWS.has(row)) continue;
        for (let y = row * SH; y < (row + 1) * SH; y++) for (let xx = 0; xx < c.width; xx++) {
          const i = (y * c.width + xx) * 4; if (d[i + 3] < 10) continue;
          const [ph, ps, pv] = rgb2hsv(d[i], d[i + 1], d[i + 2]);
          if (ph < 95 || ph > 200 || ps < .25) continue;     // só o verde do corpo (olho, língua e efeitos ficam)
          const [nr, ng, nb] = hsv2rgb((h + (ph - GREEN_H) * .3 + 360) % 360, Math.min(1, ps * .95), pv);
          d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
        }
      }
      x.putImageData(id, 0, 0); if (this.variants.size > 24) this.variants.clear(); this.variants.set(key, c); return c;
    },
    applyColor() { if (!this.ready) return; const h = this.hueOverride ?? this.hue; this.cur = (h == null || Math.abs(h - GREEN_H) < 6) ? this.base : this.variantFor(h); },

    // ---------- estados ----------
    set(state, ms = 0) {
      clearTimeout(this.timer); clearTimeout(this.sleepT);
      if (state !== this.state) this.t = 0;
      this.state = state;
      if (ms) this.timer = setTimeout(() => this.set('idle'), ms);
      else if (state === 'idle') { this.sleepT = setTimeout(() => { this.say('Bateu o sono…'); this.sleepT = setTimeout(() => this.set('sleep'), 3000); }, 100000); }
    },
    busy(on) {
      if (on) { this.set('think'); this.fly = { born: Date.now() }; this.say(rnd(FRASES_PENSANDO), 2600); return; }
      if (Date.now() - this.errAt < 1500) { this.fly = null; return; }
      this.addCount(); this.catching = 1; this.set('ready', 2600); this.say(rnd(FRASES_PRONTO), 2400);
    },
    fail() { this.errAt = Date.now(); this.fly = null; this.set('block', 3200); this.say('Ops… deu erro.', 3000); },
    hop() { this.hopUntil = Date.now() + 500; this.el && this.el.classList.add('hop'); setTimeout(() => this.el && this.el.classList.remove('hop'), 520); },
    typing() { this.typingUntil = Date.now() + 1600; if (this.state === 'sleep') this.set('idle'); },
    sent() { this.hop(); if (this.state === 'sleep') this.set('idle'); },
    dance(ms = 4200) { this.danceUntil = Date.now() + ms; this.set('need', ms); this.say('Hora da dança!', 2500); },
    say(text, ms = 3200) {
      if (!this.talk || !this.on || !this.bubble) return;
      this.bubble.textContent = text; this.bubble.hidden = false; this.placeBubble(); this.bubble.classList.add('show');
      clearTimeout(this.bT); this.bT = setTimeout(() => { this.bubble.classList.remove('show'); setTimeout(() => { this.bubble.hidden = true; }, 220); }, ms);
    },
    greet() {
      const h = new Date().getHours();
      const f = h < 5 ? 'Ainda acordado? Que sono…' : h < 12 ? 'Bom dia!' : h < 18 ? 'Boa tarde!' : 'Boa noite!';
      this.hop(); this.say(f, 3600);
    },
    scheduleNudge() { clearTimeout(this.nudgeT); this.nudgeT = setTimeout(() => { if (this.state === 'idle' && this.on) this.say(rnd(FRASES_IDLE), 4200); this.scheduleNudge(); }, 70000 + Math.random() * 70000); },
    show(on) { this.on = on; if (this.el) this.el.hidden = !on; if (!on && this.bubble) this.bubble.hidden = true; ls.set('kodi.pet', on ? '1' : '0'); this.place(true); },
    setTalk(on) { this.talk = on; ls.set('kodi.petTalk', on ? '1' : '0'); if (!on && this.bubble) this.bubble.hidden = true; },

    // ---------- acessórios ----------
    addCount() {
      const before = this.count; this.count++; ls.set('kodi.petCount', String(this.count));
      for (const [k, n] of Object.entries(UNLOCK)) if (before < n && this.count >= n) setTimeout(() => this.say(`Desbloqueei: ${ACC_NAMES[k]}! Veja nas configurações.`, 5000), 2800);
      this.renderSettings();
    },
    setAcc(a) { this.acc = a; ls.set('kodi.petAcc', a); this.renderSettings(); if (a !== 'nenhum') this.say('Combinou comigo?', 2400); },
    renderSettings() {
      const box = $('#petAcc'); if (!box) return; box.innerHTML = '';
      for (const [k, name] of Object.entries(ACC_NAMES)) {
        const need = UNLOCK[k] || 0, locked = this.count < need;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'accopt' + (this.acc === k ? ' on' : ''); b.disabled = locked;
        b.textContent = locked ? `${name} · faltam ${need - this.count} respostas` : name; b.addEventListener('click', () => this.setAcc(k)); box.appendChild(b);
      }
    },

    // ---------- posição ----------
    desktop: () => window.innerWidth >= 761,
    sizeFor(mode) {
      const w = window.innerWidth, noside = document.body.classList.contains('noside');
      if (mode === 'welcome') return w >= 761 ? 7 : 5;
      if (mode === 'side') return 3;
      if (w >= 761 && noside) return w >= 1500 ? 7 : 6;
      return 4;
    },
    place(first) {
      if (!this.el) return;
      const welcome = document.querySelector('.welcome img'), side = $('#side');
      const sideShown = this.desktop() && !document.body.classList.contains('noside') && side && side.getBoundingClientRect().width > 0;
      let mode = welcome && welcome.offsetParent ? 'welcome' : sideShown ? 'side' : 'perch';
      if (this.mode !== mode) { this.mode = mode; document.body.classList.toggle('pet-side', mode === 'side' && this.on); document.body.classList.toggle('pet-welcome', mode === 'welcome' && this.on); if (!first) this.hop(); }
      else { document.body.classList.toggle('pet-side', mode === 'side' && this.on); document.body.classList.toggle('pet-welcome', mode === 'welcome' && this.on); }
      const k = this.sizeFor(mode); this.k = k; const w = SW * k, h = SH * k;
      if (this.cv.width !== w) { this.cv.width = w; this.cv.height = h; }
      this.el.style.width = w + 'px'; this.el.style.height = h + 'px';
      let left, top;
      if (mode === 'welcome') { const r = welcome.getBoundingClientRect(); left = r.left + r.width / 2 - w / 2; top = r.top + r.height / 2 - h / 2; }
      else if (mode === 'side') { const r = (this.slot || side).getBoundingClientRect(); left = r.left + 14; top = r.bottom - h + 2 * k; if (!this.slot) top = r.bottom - h - 70; }
      else { const b = $('#box'); const r = b ? b.getBoundingClientRect() : { right: window.innerWidth - 20, top: window.innerHeight - 90 }; left = r.right - w - 26; top = r.top - 19 * k + 2; }
      left = Math.max(4, Math.min(window.innerWidth - w - 4, left)); top = Math.max(4, top);
      if (first) this.el.classList.add('nomove');
      this.home = { left, top, w, h };
      if (!this.drag) { this.el.style.left = left + 'px'; this.el.style.top = top + 'px'; }
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove('nomove')));
      this.placeBubble(); this.draw();
    },
    placeBubble() {
      if (!this.bubble || this.bubble.hidden || !this.home) return;
      const b = this.bubble, bw = b.offsetWidth, bh = b.offsetHeight; const p = this.drag ? { left: parseFloat(this.el.style.left), top: parseFloat(this.el.style.top), w: this.home.w } : this.home;
      let left = p.left + p.w - bw + 10, top = p.top - bh - 8;
      if (this.mode === 'side') { left = p.left + p.w + 6; top = p.top + 8; }
      if (this.mode === 'welcome') { left = p.left + p.w / 2 - bw / 2; top = p.top - bh - 4; }
      b.style.left = Math.max(6, Math.min(window.innerWidth - bw - 6, left)) + 'px'; b.style.top = Math.max(6, top) + 'px';
    },

    // ---------- desenho ----------
    tick() {
      if (!this.ready || !this.on) return;
      this.t = (this.t + 1) % (FR * 100);
      const now = Date.now();
      if (this.danceUntil > now) { this.hueOverride = (this.t * 47) % 360; this.applyColor(); this.hopUntil = now + 200; }
      else if (this.danceUntil && this.danceUntil <= now) { this.danceUntil = 0; this.hueOverride = null; this.applyColor(); }
      if (this.catching && this.state !== 'ready') this.catching = 0;
      this.hearts = this.hearts.filter(h => (h.life -= 1) > 0);
      this.draw();
    },
    pupilPos() {
      const f = this.t % FR;
      if (this.state === 'think') return THINK_PATH[f % THINK_PATH.length];
      if (Date.now() < this.typingUntil) return [14, 7];                    // olhando para a caixa de texto
      const r = this.el.getBoundingClientRect(); const cx = r.left + (14.5 / SW) * r.width, cy = r.top + (7.5 / SH) * r.height;
      const dx = this.cursor.x - cx, dy = this.cursor.y - cy; if (this.cursor.x < 0) return [15, 6];
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const px = ax < 40 ? 14 : dx > 0 ? 15 : 13; let py = ay > 30 && dy > 0 ? 7 : 6; if (px === 13) py = 6;
      return [px, py];
    },
    draw() {
      if (!this.ready || !this.cv) return;
      const k = this.k, c = this.ctx, row = ROWS[this.state] ?? 0, f = this.t % FR;
      c.imageSmoothingEnabled = false; c.clearRect(0, 0, this.cv.width, this.cv.height);
      const src = BODY_ROWS.has(row) && this.cur ? this.cur : this.base;
      c.drawImage(src, f * SW, row * SH, SW, SH, 0, 0, SW * k, SH * k);
      const dy = DY[this.state][f % 4];
      const px = (x, y, col, a = 1) => { c.globalAlpha = a; c.fillStyle = col; c.fillRect(Math.round(x * k), Math.round(y * k), k, k); c.globalAlpha = 1; };
      const closed = this.state === 'sleep' || this.state === 'block' || (this.state === 'idle' && f === 6);
      if (!closed) { const [ex, ey] = this.pupilPos(); px(ex, ey + dy, PUPIL); px(ex, ey + 1 + dy, PUPIL); }
      // acessório
      const art = ART[this.acc]; if (art) for (const [x, y, col] of art) px(x, y + dy, col);
      // mosquinha (enquanto pensa) e a pegada da língua
      if (this.state === 'think' && this.fly) {
        const a = (Date.now() - this.fly.born) / 700, fx = 21 + Math.cos(a * 1.3) * 2.6, fy = 4 + Math.sin(a * 2.1) * 2.2, wing = (this.t % 2) ? 1 : 0;
        px(fx, fy, '#16120d'); px(fx + 1, fy, '#16120d'); px(fx, fy - 1 - wing, '#cfefff', .9); px(fx + 1, fy - 1 - wing, '#cfefff', .9);
      } else if (this.catching && this.state === 'ready' && f >= 0 && f <= 2) {
        px(21.5, 8.5 + dy, '#16120d'); px(22.5, 8.5 + dy, '#16120d');
      }
      // corações do carinho
      for (const h of this.hearts) {
        const age = 1 - h.life / h.max; const a = Math.min(1, h.life / 4);
        HEART.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') px(h.x + i * .6 + Math.sin(age * 6 + h.s) * .8, h.y - age * 9 + j * .6, '#ff5c8a', a); }));
      }
      // pulinho (CSS) quando alguém clica ou muda de lugar
    },

    // ---------- interação ----------
    bind() {
      const el = this.el;
      document.addEventListener('pointermove', e => { this.cursor.x = e.clientX; this.cursor.y = e.clientY; if (this.drag) this.dragMove(e); }, { passive: true });
      el.addEventListener('pointerdown', e => { this.drag = { sx: e.clientX, sy: e.clientY, ox: parseFloat(el.style.left), oy: parseFloat(el.style.top), moved: false, id: e.pointerId }; try { el.setPointerCapture(e.pointerId); } catch { /* ok */ } });
      el.addEventListener('pointerup', e => this.dragEnd(e)); el.addEventListener('pointercancel', e => this.dragEnd(e));
      el.addEventListener('dblclick', () => { this.hueOverride = Math.floor(Math.random() * 360); this.applyColor(); this.hop(); this.say('Que tal essa cor?', 2600); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pet(); } });
      window.addEventListener('resize', () => this.place());
      const ro = new ResizeObserver(() => this.place()); [$('#box'), $('#main'), $('#side')].forEach(n => n && ro.observe(n));
      new MutationObserver(() => this.place()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      const m = $('#msgs'); if (m) new MutationObserver(() => this.place()).observe(m, { childList: true });
      const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
      document.addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; this.konami = e.key === seq[this.konami] ? this.konami + 1 : (e.key === seq[0] ? 1 : 0); if (this.konami === seq.length) { this.konami = 0; this.dance(5000); } });
    },
    pet() {
      this.hop(); if (this.state === 'sleep') this.set('idle');
      for (let i = 0; i < 3; i++) this.hearts.push({ x: 15 + i * 2 - 2, y: 3 - i, life: 12 + i * 2, max: 14 + i * 2, s: i * 2 });
      this.say(rnd(['Hehe!', 'Gostei!', 'Mais um pouquinho…', 'Cócegas!']), 1800);
    },
    dragMove(e) {
      const d = this.drag; const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; this.el.classList.add('dragging'); }
      if (d.moved) { this.el.style.left = d.ox + dx + 'px'; this.el.style.top = d.oy + dy + 'px'; this.placeBubble(); }
    },
    dragEnd() {
      const d = this.drag; if (!d) return; this.drag = null; this.el.classList.remove('dragging');
      if (d.moved) { this.place(); this.hop(); this.say('Voltei pro meu lugar!', 2200); } else this.pet();
    },
  };
  window.Pet = Pet;
})();
