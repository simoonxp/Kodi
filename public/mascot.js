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
  const PUP = { C: [[14, 7]], R: [[15, 6], [15, 7]], DR: [[15, 8]], D: [[14, 7], [14, 8]], DL: [[13, 7]], L: [[13, 6], [13, 7]], UL: [[13, 6]], U: [[14, 6]], UR: [[15, 6]] };
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

  const $ = s => document.querySelector(s);
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };

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
    el: null, cv: null, ctx: null, slot: null, sheet: null, base: null, variants: new Map(),
    state: 'idle', t: 0, k: 4, hue: null, hueOverride: null, ready: false, on: true,
    size: 'auto', still: false, onChange: null, onUnlock: null,
    cursor: { x: -1, y: -1 }, typingUntil: 0, hearts: [], fly: null, catching: 0, hopUntil: 0, danceUntil: 0,
    timer: null, sleepT: null, errAt: 0, drag: null, mode: '', konami: 0,
    count: 0, acc: 'nenhum',

    init() {
      this.on = ls.get('kodi.pet') !== '0'; this.size = ls.get('kodi.petSize') || 'auto';
      this.still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.count = parseInt(ls.get('kodi.petCount') || '0', 10) || 0; this.acc = ls.get('kodi.petAcc') || 'nenhum';
      if (this.acc !== 'nenhum' && this.count < (UNLOCK[this.acc] || 0)) this.acc = 'nenhum';
      this.slot = $('#petSlot');
      const el = this.el = document.createElement('div'); el.id = 'pet'; el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', 'Mascote do Kodi'); el.title = 'Mascote do Kodi';
      this.cv = document.createElement('canvas'); this.ctx = this.cv.getContext('2d'); el.appendChild(this.cv);
      document.body.append(el); el.hidden = !this.on;
      this.bind();
      const img = new Image(); img.onload = () => { this.sheet = img; this.base = this.toCanvas(img); this.ready = true; this.applyColor(); this.place(true); this.draw(); }; img.src = '/mascote.png';
      const hour = new Date().getHours();
      this.set(hour < 5 ? 'sleep' : 'idle'); this.place(true);        // de madrugada ele acorda sonolento
      setInterval(() => this.tick(), 125);
      if (hour >= 5) setTimeout(() => this.hop(), 900);
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
      else if (state === 'idle') { this.sleepT = setTimeout(() => { this.sleepT = setTimeout(() => this.set('sleep'), 3000); }, 100000); }
    },
    busy(on) {
      if (on) { this.set('think'); this.fly = { born: Date.now() }; return; }
      if (Date.now() - this.errAt < 1500) { this.fly = null; return; }
      this.addCount(); this.catching = 1; this.set('ready', 2600);
    },
    fail() { this.errAt = Date.now(); this.fly = null; this.set('block', 3200); },
    hop() { this.hopUntil = Date.now() + 500; this.el && this.el.classList.add('hop'); setTimeout(() => this.el && this.el.classList.remove('hop'), 520); },
    typing() { this.typingUntil = Date.now() + 1600; if (this.state === 'sleep') this.set('idle'); },
    sent() { this.hop(); if (this.state === 'sleep') this.set('idle'); },
    dance(ms = 4200) { this.danceUntil = Date.now() + ms; this.set('need', ms); },
    show(on) { this.on = on; if (this.el) this.el.hidden = !on; ls.set('kodi.pet', on ? '1' : '0'); this.place(true); this.changed(); },
    setSize(v) { this.size = v; ls.set('kodi.petSize', v); this.place(true); this.renderSettings(); this.changed(); },
    // comandos do chat: /mascote, /mascote esconder|mostrar|pequeno|medio|grande
    command(arg) {
      arg = (arg || '').toLowerCase().trim();
      if (arg === 'esconder') this.show(false); else if (arg === 'mostrar') this.show(true);
      else if (arg === 'pequeno') this.setSize('pequeno'); else if (arg === 'medio' || arg === 'médio') this.setSize('auto'); else if (arg === 'grande') this.setSize('grande');
      else this.show(!this.on);
      const c = $('#petOn'); if (c) c.checked = this.on;
    },
    changed() { if (this.onChange) this.onChange(this.export()); },
    export() { return { on: this.on, count: this.count, acc: this.acc, size: this.size }; },
    import(o) {                                   // preferências vindas da conta (outro aparelho)
      if (!o || typeof o !== 'object') return;
      if (typeof o.count === 'number') { this.count = Math.max(this.count, o.count); ls.set('kodi.petCount', String(this.count)); }
      if (typeof o.acc === 'string' && ART[o.acc] || o.acc === 'nenhum') { this.acc = o.acc; ls.set('kodi.petAcc', this.acc); }
      if (typeof o.size === 'string') { this.size = o.size; ls.set('kodi.petSize', this.size); }
      if (typeof o.on === 'boolean') { this.on = o.on; ls.set('kodi.pet', o.on ? '1' : '0'); if (this.el) this.el.hidden = !o.on; const c = $('#petOn'); if (c) c.checked = o.on; }
      if (this.acc !== 'nenhum' && this.count < (UNLOCK[this.acc] || 0)) this.acc = 'nenhum';
      this.renderSettings(); if (this.el) this.place(true);
    },

    // ---------- acessórios ----------
    addCount() {
      const before = this.count; this.count++; ls.set('kodi.petCount', String(this.count));
      for (const [k, n] of Object.entries(UNLOCK)) if (before < n && this.count >= n && this.onUnlock) setTimeout(() => this.onUnlock(ACC_NAMES[k]), 2800);
      this.renderSettings(); this.changed();
    },
    setAcc(a) { this.acc = a; ls.set('kodi.petAcc', a); this.renderSettings(); this.changed(); },
    renderSettings() {
      const box = $('#petAcc'); if (box) {
        box.innerHTML = '';
        for (const [k, name] of Object.entries(ACC_NAMES)) {
          const need = UNLOCK[k] || 0, locked = this.count < need;
          const b = document.createElement('button'); b.type = 'button'; b.className = 'accopt' + (this.acc === k ? ' on' : ''); b.disabled = locked;
          b.textContent = locked ? `${name} · faltam ${need - this.count} respostas` : name; b.addEventListener('click', () => this.setAcc(k)); box.appendChild(b);
        }
      }
      const sz = $('#petSize'); if (sz) {
        sz.innerHTML = '';
        for (const [k, name] of [['pequeno', 'Pequeno'], ['auto', 'Médio'], ['grande', 'Grande']]) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'accopt' + (this.size === k ? ' on' : ''); b.textContent = name; b.addEventListener('click', () => this.setSize(k)); sz.appendChild(b);
        }
      }
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
      if (this.mode !== mode) { if (!first && this.mode) this.hop(); this.mode = mode; }
      document.body.classList.toggle('pet-side', mode === 'side' && this.on);
      const k = this.sizeFor(mode); this.k = k; const w = SW * k, h = SH * k;
      if (this.cv.width !== w) { this.cv.width = w; this.cv.height = h; }
      this.el.style.width = w + 'px'; this.el.style.height = h + 'px';
      let left, top;
      if (mode === 'side') { const r = (this.slot || side).getBoundingClientRect(); left = r.left + 14; top = r.bottom - h + 2 * k; }
      else { const b = $('#box'); const r = b ? b.getBoundingClientRect() : { right: window.innerWidth - 20, top: window.innerHeight - 90 }; left = r.right - w - 26; top = r.top - 19 * k + 2; }
      left = Math.max(4, Math.min(window.innerWidth - w - 4, left)); top = Math.max(4, top);
      if (first) this.el.classList.add('nomove');
      this.home = { left, top, w, h };
      if (!this.drag) { this.el.style.left = left + 'px'; this.el.style.top = top + 'px'; }
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove('nomove')));
      this.draw();
    },

    // ---------- desenho ----------
    tick() {
      if (!this.ready || !this.on) return;
      if (!this.still || this.danceUntil > Date.now()) this.t = (this.t + 1) % (FR * 100);
      const now = Date.now();
      if (this.danceUntil > now) { this.hueOverride = (this.t * 47) % 360; this.applyColor(); this.hopUntil = now + 200; }
      else if (this.danceUntil && this.danceUntil <= now) { this.danceUntil = 0; this.hueOverride = null; this.applyColor(); }
      if (this.catching && this.state !== 'ready') this.catching = 0;
      this.hearts = this.hearts.filter(h => (h.life -= 1) > 0);
      this.draw();
    },
    // posições da pupila dentro do olho (8 direções + centro). Cada uma é a lista de células [x, y] pintadas.
    pupilCells() {
      const f = this.t % FR;
      if (this.state === 'think') { const [x, y] = THINK_PATH[f % THINK_PATH.length]; return [[x, y], [x, y + 1]]; }
      if (Date.now() < this.typingUntil) return PUP.D;                      // olhando para a caixa de texto
      if (this.cursor.x < 0) return PUP.R;
      const r = this.el.getBoundingClientRect(); const cx = r.left + (14.5 / SW) * r.width, cy = r.top + (7.5 / SH) * r.height;
      const dx = this.cursor.x - cx, dy = this.cursor.y - cy, dist = Math.hypot(dx, dy);
      if (dist < 50) return PUP.C;
      const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));            // -4..4: 0 = direita, 2 = baixo, ±4 = esquerda, -2 = cima
      return ({ 0: PUP.R, 1: PUP.DR, 2: PUP.D, 3: PUP.DL, 4: PUP.L, '-4': PUP.L, '-3': PUP.UL, '-2': PUP.U, '-1': PUP.UR })[oct] || PUP.C;
    },
    draw() {
      if (!this.ready || !this.cv) return;
      const k = this.k, c = this.ctx, row = ROWS[this.state] ?? 0, f = this.t % FR;
      c.imageSmoothingEnabled = false; c.clearRect(0, 0, this.cv.width, this.cv.height);
      const src = BODY_ROWS.has(row) && this.cur ? this.cur : this.base;
      // inclinação da cabeça: curioso ao digitar, balançando (coçando a cabeça) no erro
      const lean = this.state === 'block' ? (f % 2 ? 1 : -1) : (Date.now() < this.typingUntil ? 1 : 0), HEAD = 10;
      c.drawImage(src, f * SW, row * SH, SW, HEAD, lean * k, 0, SW * k, HEAD * k);
      c.drawImage(src, f * SW, row * SH + HEAD, SW, SH - HEAD, 0, HEAD * k, SW * k, (SH - HEAD) * k);
      const dy = DY[this.state][f % 4];
      const px = (x, y, col, a = 1) => { c.globalAlpha = a; c.fillStyle = col; c.fillRect(Math.round((x + (y < HEAD ? lean : 0)) * k), Math.round(y * k), k, k); c.globalAlpha = 1; };
      const closed = this.state === 'sleep' || this.state === 'block' || (this.state === 'idle' && f === 6);
      if (!closed) for (const [ex, ey] of this.pupilCells()) px(ex, ey + dy, PUPIL);
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
      el.addEventListener('dblclick', () => { this.hueOverride = Math.floor(Math.random() * 360); this.applyColor(); this.hop(); });
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
    },
    dragMove(e) {
      const d = this.drag; const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; this.el.classList.add('dragging'); }
      if (d.moved) { this.el.style.left = d.ox + dx + 'px'; this.el.style.top = d.oy + dy + 'px'; }
    },
    dragEnd() {
      const d = this.drag; if (!d) return; this.drag = null; this.el.classList.remove('dragging');
      if (d.moved) { this.place(); this.hop(); } else this.pet();
    },
  };
  window.Pet = Pet;
})();
