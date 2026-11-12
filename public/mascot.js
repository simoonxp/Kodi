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
  const UNLOCK = { oculos: 10, festa: 50, coroa: 200 };
  const ACC_NAMES = { nenhum: 'Nenhum', oculos: 'Óculos', festa: 'Chapéu de festa', coroa: 'Coroa' };
  const ART = {
    oculos: [...[12, 13, 14, 15, 16].flatMap(x => [[x, 5, '#101820'], [x, 9, '#101820']]), [12, 6, '#101820'], [12, 7, '#101820'], [12, 8, '#101820'], [16, 6, '#101820'], [16, 7, '#101820'], [16, 8, '#101820'], [11, 7, '#101820'], [10, 7, '#101820'], [17, 7, '#101820'], [18, 7, '#101820'], [13, 6, '#cfefff']],
    festa: [[12, 0, '#ffd95a'], [11, 1, '#ff5c8a'], [12, 1, '#ff5c8a'], [13, 1, '#ff5c8a'], [10, 2, '#ff5c8a'], [11, 2, '#ffd95a'], [12, 2, '#ff5c8a'], [13, 2, '#ffd95a'], [14, 2, '#ff5c8a']],
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

  const Pet = {
    el: null, hit: null, cv: null, ctx: null, slot: null, base: null, fx: null, cur: null, variants: new Map(),
    state: 'idle', t: 0, k: 4, hueOverride: null, ready: false, on: true, flip: false, size: 'auto', still: false, onChange: null, onUnlock: null,
    cursor: { x: -1, y: -1 }, typingUntil: 0, hearts: [], fly: null, catching: 0, danceUntil: 0, colorT: null,
    timer: null, sleepT: null, errAt: 0, drag: null, mode: '', konami: 0, count: 0, acc: 'nenhum', home: null,

    init() {
      this.on = ls.get('kodi.pet') !== '0'; this.size = ls.get('kodi.petSize') || 'auto';
      this.still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.count = parseInt(ls.get('kodi.petCount') || '0', 10) || 0; this.acc = ls.get('kodi.petAcc') || 'nenhum';
      if (this.acc !== 'nenhum' && this.count < (UNLOCK[this.acc] || 0)) this.acc = 'nenhum';
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
    },
    toCanvas(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c; },

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

    // ---------- estados ----------
    set(state, ms = 0) {
      clearTimeout(this.timer); clearTimeout(this.sleepT);
      if (state !== this.state) this.t = 0;
      this.state = state;
      if (ms) this.timer = setTimeout(() => this.set('idle'), ms);
      else if (state === 'idle') this.sleepT = setTimeout(() => this.set('sleep'), 100000);
    },
    busy(on) {
      if (on) { this.set('think'); this.fly = { born: Date.now() }; return; }
      if (Date.now() - this.errAt < 1500) { this.fly = null; return; }
      this.addCount(); this.catching = 1; this.set('ready', 2600);
    },
    fail() { this.errAt = Date.now(); this.fly = null; this.set('block', 3200); },
    hop() { if (!this.el || this.still) return; this.el.classList.add('hop'); setTimeout(() => this.el && this.el.classList.remove('hop'), 520); },
    typing() { this.typingUntil = Date.now() + 1800; if (this.state === 'sleep') this.set('idle'); },
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
      if ((typeof o.acc === 'string' && ART[o.acc]) || o.acc === 'nenhum') { this.acc = o.acc; ls.set('kodi.petAcc', this.acc); }
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
      this.flip = mode === 'perch';                         // pousado à direita da caixa: vira para dentro, olhando o chat
      document.body.classList.toggle('pet-side', mode === 'side' && this.on);
      const k = this.sizeFor(mode); this.k = k;
      const cw = (SW + 2 * OX) * k, ch = (SH + OYT + OYB) * k;
      if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
      this.el.style.width = cw + 'px'; this.el.style.height = ch + 'px';
      Object.assign(this.hit.style, { left: OX * k + 'px', top: OYT * k + 'px', width: SW * k + 'px', height: SH * k + 'px' });
      const w = SW * k, h = SH * k; let left, top;
      if (mode === 'side') { const r = (this.slot || side).getBoundingClientRect(); left = r.left + 14; top = r.bottom - h + 2 * k; }
      else { const b = $('#box'); const r = b ? b.getBoundingClientRect() : { right: window.innerWidth - 20, top: window.innerHeight - 90 }; left = r.right - w - 26; top = r.top - 19 * k + 2; }
      left = clamp(left, 4, window.innerWidth - w - 4); top = Math.max(4, top);
      if (first) this.el.classList.add('nomove');
      this.home = { left, top, w, h };
      if (!this.drag) { this.el.style.left = left - OX * k + 'px'; this.el.style.top = top - OYT * k + 'px'; }
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove('nomove')));
      this.draw();
    },

    // ---------- desenho ----------
    tick() {
      if (!this.ready || !this.on) return;
      if (!this.still || this.danceUntil > Date.now()) this.t = (this.t + 1) % (FR * 100);
      const now = Date.now();
      if (this.danceUntil > now) { this.hueOverride = (this.t * 47) % 360; this.applyColor(); }
      else if (this.danceUntil) { this.danceUntil = 0; this.hueOverride = null; this.applyColor(); }
      if (this.catching && this.state !== 'ready') this.catching = 0;
      this.hearts = this.hearts.filter(h => (h.life -= 1) > 0);
      this.draw();
    },
    // pupila: retângulo 1 x 1,5 (em pixels do sprite) que anda em meios-pixels dentro do olho (muitas direções)
    pupilRect() {
      const f = this.t % FR;
      let px, py;
      if (this.state === 'think') { const a = (f / FR) * Math.PI * 2; px = 14 + Math.cos(a); py = 6.75 + Math.sin(a) * .75; }
      else if (Date.now() < this.typingUntil) {                                  // "lendo": varre o olho como quem lê linhas de texto
        const step = this.t % 6; px = 13 + step * .4; py = (Math.floor(this.t / 6) % 2) ? 7 : 7.5;
      } else if (this.cursor.x < 0) { px = 15; py = 6; }
      else {
        const r = this.hit.getBoundingClientRect(); const ex = this.flip ? SW - 14.5 : 14.5;
        let dx = this.cursor.x - (r.left + (ex / SW) * r.width), dy = this.cursor.y - (r.top + (7.5 / SH) * r.height);
        if (this.flip) dx = -dx;
        const d = Math.hypot(dx, dy), m = clamp(d / 220, 0, 1), ang = Math.atan2(dy, dx);
        px = 14 + Math.cos(ang) * m * 1.15; py = 6.75 + Math.sin(ang) * m * .95;
      }
      px = Math.round(clamp(px, 13, 15) * 2) / 2; py = Math.round(clamp(py, 6, 7.5) * 2) / 2;
      if (py > 6.5) px = Math.max(px, 14);                                       // a fileira de baixo do olho é mais estreita
      return [px, py];
    },
    draw() {
      if (!this.ready || !this.cv) return;
      const k = this.k, c = this.ctx, row = ROWS[this.state] ?? 0, f = this.t % FR, now = Date.now();
      c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = false; c.clearRect(0, 0, this.cv.width, this.cv.height);
      c.translate(OX * k, OYT * k);
      const src = BODY_ROWS.has(row) && this.cur ? this.cur : this.base;
      // inclinação da cabeça: para o chat ao digitar; balançando no erro
      const lean = this.state === 'block' ? (f % 2 ? 1 : -1) : (now < this.typingUntil ? 1 : 0), HEAD = 10;
      c.save(); if (this.flip) { c.translate(SW * k, 0); c.scale(-1, 1); }
      c.drawImage(src, f * SW, row * SH, SW, HEAD, lean * k, 0, SW * k, HEAD * k);
      c.drawImage(src, f * SW, row * SH + HEAD, SW, SH - HEAD, 0, HEAD * k, SW * k, (SH - HEAD) * k);
      const dy = DY[this.state][f % 4];
      const px = (x, y, col, a = 1, w = 1, h = 1) => { c.globalAlpha = a; c.fillStyle = col; const xx = x + (y < HEAD ? lean : 0); c.fillRect(Math.round(xx * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)); c.globalAlpha = 1; };
      const closed = this.state === 'sleep' || this.state === 'block' || (this.state === 'idle' && f === 6);
      if (!closed) { const [ex, ey] = this.pupilRect(); px(ex, ey + dy, PUPIL, 1, 1, 1.5); }
      const art = ART[this.acc]; if (art) for (const [x, y, col] of art) px(x, y + dy, col);
      // mosquinha (clara, bem visível) enquanto ele pensa; e a pegada da língua
      const fly = (x, y, wing) => { px(x, y, '#f4f4f4', 1, 2, 1.2); px(x + .2, y + .2, '#7a7a7a', 1, .6, .6); px(x - .6, y - 1.4 - wing, '#bfe9ff', .95, 1.2, 1.2); px(x + 1.4, y - 1.4 - wing, '#bfe9ff', .95, 1.2, 1.2); };
      if (this.state === 'think' && this.fly) {
        const a = (now - this.fly.born) / 650; fly(21.5 + Math.cos(a * 1.3) * 3.2, 3 + Math.sin(a * 2.2) * 2.6, this.t % 2);
      } else if (this.catching && this.state === 'ready' && f <= 2) {
        const pos = [[23.5, 5.5], [22.8, 7.6], [22, 8.4]][f]; fly(pos[0], pos[1], 0);
      }
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
      document.addEventListener('pointermove', e => { this.cursor.x = e.clientX; this.cursor.y = e.clientY; if (this.drag) this.dragMove(e); }, { passive: true });
      hit.addEventListener('pointerdown', e => { this.drag = { sx: e.clientX, sy: e.clientY, ox: parseFloat(this.el.style.left), oy: parseFloat(this.el.style.top), moved: false }; try { hit.setPointerCapture(e.pointerId); } catch { /* ok */ } });
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
      if (d.moved) { this.place(); this.hop(); } else this.pet();
    },
  };
  window.Pet = Pet;
})();
