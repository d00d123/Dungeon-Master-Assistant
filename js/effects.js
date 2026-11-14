/* Effects: entry screen (neon d20 intro), event cues, the Effects toggle and its low-power default (window.__fx).
   Loaded synchronously at the start of <body> so the intro covers the board before first paint.
   Depends on: window.DMC (js/storage-shim.js, optional). Styles: css/intro.css, css/effects.css. */
/* Effects: neon d20 intro, event cues. Decoration only. No ambient loops: the table is static apart from the
   campfire flicker in css/table.css, which runs only with Effects on and pauses under html.fx-hold/fx-paused.
   Watches the board (MutationObserver, class changes) and never calls, patches or replaces app code.
   Writes to app nodes only: WAAPI translate/scale/rotate/opacity, data-fx="conc" on card pills,
   inert on .wrap/#overlay while the intro is open. Every entry point is guarded. */
(function () {
  'use strict';
  try {
    if (window.__fxBreak) throw new Error('fx test break');
    const D = document,
      H = D.documentElement,
      W = window,
      KD = 'key' + 'down';
    const safe = (f) =>
      function () {
        try {
          return f.apply(this, arguments);
        } catch (e) {}
      };
    const RAW = (W.DMC && W.DMC.raw) || {};
    let LS = null;
    try {
      LS = RAW.ls || W.localStorage;
    } catch (e) {}
    const sget = (s, k) => {
      try {
        return s ? s.getItem(k) : null;
      } catch (e) {
        return null;
      }
    };
    const sset = (s, k, v) => {
      try {
        s && s.setItem(k, v);
      } catch (e) {}
    };
    const RMq = W.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let RM = !!RMq.matches;
    /* Effects default: off on phones/tablets and low-power devices, on for desktops. An explicit choice in
       've-fx' ('on'/'off', written only by the Effects button) always wins. */
    const mq = (q) => {
      try {
        return !!(W.matchMedia && matchMedia(q).matches);
      } catch (e) {
        return false;
      }
    };
    const lowPower = () => {
      const n = navigator,
        sc = W.screen || {},
        small = Math.min(sc.width || innerWidth, sc.height || innerHeight) <= 1024 || innerWidth <= 1024;
      return (
        RM ||
        (mq('(pointer: coarse)') && small) ||
        (n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 4) ||
        (n.deviceMemory > 0 && n.deviceMemory <= 4) ||
        !!(n.connection && n.connection.saveData)
      );
    };
    const wantOff = () => {
      const v = sget(LS, 've-fx');
      return v === 'off' || (v !== 'on' && lowPower());
    };
    let off = wantOff(),
      armed = false,
      quietUntil = 0,
      ready = false;
    const cl = (c, on) => H.classList.toggle(c, !!on);
    cl('fx-off', off);
    cl('fx-rm', RM);
    const lowEnd = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;
    const now = () => performance.now(),
      clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
      rnd = (a, b) => a + Math.random() * (b - a);
    const $ = (id) => D.getElementById(id);
    const FOC = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    const TOG = (id) =>
      `<button type="button" id="${id}"${id === 'fxBtn' ? ' class="btn sm ghost"' : ''} aria-pressed="${!off}" title="Turn table effects on or off">Effects<span aria-hidden="true">: ${off ? 'Off' : 'On'}</span></button>`;

    /* ================= intro ================= */
    let intro = null,
      phase = 'ask',
      tmr = [],
      L = [];
    /* The animated d20 plays on every load (new tab, reload, back/forward), whatever the Effects setting.
       Only the OS Reduce Motion setting gets the still version with a short fade. */
    const isStatic = () => RM;
    const P = {
      H0: [100, 12],
      H1: [176.2, 56],
      H2: [176.2, 144],
      H3: [100, 188],
      H4: [23.8, 144],
      H5: [23.8, 56],
      T0: [100, 45.6],
      T1: [147.1, 127.2],
      T2: [52.9, 127.2],
    };
    const SEG = [
      ['hex', 'M100 12 23.8 56V144L100 188'],
      ['hex', 'M100 12 176.2 56V144L100 188'],
      ['tri', 'M100 45.6 147.1 127.2H52.9Z'],
      ...[
        ['T0', 'H0'],
        ['T0', 'H1'],
        ['T0', 'H5'],
        ['T1', 'H1'],
        ['T1', 'H2'],
        ['T1', 'H3'],
        ['T2', 'H4'],
        ['T2', 'H5'],
        ['T2', 'H3'],
      ].map(([a, b]) => ['sp', `M${P[a]} ${P[b]}`]),
    ];
    const paths = () =>
      SEG.map(
        ([k, d], i) => `<path data-seg="${k}" d="${d}" pathLength="1"${i > 2 ? ` style="--i:${i - 3}"` : ''}/>`
      ).join('');
    const spark = (d, dur, beg) =>
      `<circle class="fx-spark" r="1.6" fill="#fff" opacity="0" filter="url(#fxSpk)" data-b="${beg}"><animateMotion begin="indefinite" dur="${dur}ms" fill="freeze" path="${d}" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .2 1"/><animate attributeName="opacity" begin="indefinite" dur="${dur}ms" fill="freeze" values="0;1;1;0" keyTimes="0;.06;.85;1"/></circle>`;
    const blur = (s, r) => `<feGaussianBlur in="SourceGraphic" stdDeviation="${s}" result="${r}"/>`;
    const SVG = `<svg class="fx-d20" viewBox="-14 -14 228 228" aria-hidden="true" focusable="false" fill="none" stroke-linecap="round" stroke-linejoin="round"><defs>
<linearGradient id="fxAur" gradientUnits="userSpaceOnUse" x1="20" y1="10" x2="180" y2="190"><stop offset="0" stop-color="#5ef2c8"/><stop offset=".55" stop-color="#8fb4ff"/><stop offset="1" stop-color="#c99bff"/></linearGradient>
<filter id="fxNeon" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">${lowEnd ? '' : blur(11, 'c')}${blur(4.5, 'b')}${blur(1.5, 'a')}<feMerge>${lowEnd ? '' : '<feMergeNode in="c"/>'}<feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="fxSpk" filterUnits="userSpaceOnUse" x="-16" y="-16" width="32" height="32">${blur(3, 'b')}<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="fxFace" cx="100" cy="100" r="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8fb4ff" stop-opacity=".24"/><stop offset="1" stop-color="#5ef2c8" stop-opacity=".04"/></radialGradient>
<radialGradient id="fxBloom"><stop offset="0" stop-color="#fff3d6" stop-opacity=".55"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/></radialGradient></defs>
<circle class="fx-bloom" cx="100" cy="100" r="96" fill="url(#fxBloom)"/><path class="fx-face" d="${SEG[2][1]}" fill="url(#fxFace)"/>
<g class="fx-ghost">${paths()}</g><g class="fx-glow" filter="url(#fxNeon)">${paths()}</g><g class="fx-core">${paths()}</g>
<text class="fx-num" x="100" y="106" text-anchor="middle" dominant-baseline="central">20</text>${lowEnd ? '' : spark(SEG[0][1], 600, 0.08) + spark(SEG[1][1], 600, 0.08) + spark(SEG[2][1], 400, 0.52)}</svg>`;
    /* Paper-cut entry: hillside dungeon door. Shapes reuse the table's mountain, cloud, tree, and castle cut-outs. */
    const ARCH = (() => {
      let v = '';
      const n = 11,
        g = 0.012,
        c = 183,
        pt = (r, a) => `${(c + r * Math.cos(a)).toFixed(1)} ${(c - r * Math.sin(a)).toFixed(1)}`;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (1 - i / n) - g,
          b = Math.PI * (1 - (i + 1) / n) + g,
          k = i === 5,
          r = k ? 186 : 180;
        v += `<path fill="${k ? '#d5dce6' : ['#aab3c2', '#9aa3b3', '#b8c0cc'][i % 3]}" d="M${pt(125, a)}L${pt(r, a)}A${r} ${r} 0 0 0 ${pt(r, b)}L${pt(125, b)}A125 125 0 0 1 ${pt(125, a)}Z"/>`;
      }
      for (let j = 0; j < 4; j++)
        v += `<rect x="3" y="${186 + j * 43}" width="54" height="40" rx="3" fill="${['#b8c0cc', '#9aa3b3'][j % 2]}"/><rect x="309" y="${186 + j * 43}" width="54" height="40" rx="3" fill="${['#9aa3b3', '#b8c0cc'][j % 2]}"/>`;
      const A = (x, y, r) => `M${x} 358V${y}A${r} ${r} 0 0 1 ${366 - x} ${y}V358Z`;
      return `<svg class="fx-arch" viewBox="0 0 366 358" aria-hidden="true" focusable="false"><path d="${A(0, 183, 183)}" fill="#6b7484" filter="url(#fxP)"/><path d="${A(58, 183, 125)}" fill="#3a3152"/>
<g filter="url(#fxP)"><path d="${A(82, 205, 101)}" fill="#2b2440"/><path d="${A(106, 224, 77)}" fill="#211b33"/><path d="${A(128, 240, 55)}" fill="#191428"/></g><g filter="url(#fxP)">${v}</g>
<g filter="url(#fxP)"><rect x="34" y="344" width="298" height="16" rx="3" fill="#c3cad5"/><rect x="14" y="356" width="338" height="16" rx="3" fill="#9aa3b3"/></g></svg>`;
    })();
    const SCN = `<svg class="fx-far" viewBox="-1200 -800 2400 800" aria-hidden="true" focusable="false"><defs>
<filter id="fxP" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dy="3" stdDeviation="3"/></filter><filter id="fxQ" y="-15%" height="140%"><feDropShadow dy="1.2" stdDeviation="1"/></filter>
<symbol id="fxM" viewBox="0 0 160 80"><path d="M10 80 66 6l58 74z" fill="#aab3c2"/><path d="M66 6 52 25l6-2 4 5 5-6 5 5 6-2z" fill="#f7f3ea"/><g filter="url(#fxQ)"><path d="M60 80l50-58 50 58z" fill="#8791a3"/><path d="M110 22 98 36l5-2 4 4 4-5 5 4 5-1z" fill="#f2eee6"/></g><g filter="url(#fxQ)"><path d="M0 80l34-40 36 40z" fill="#9aa3b3"/><path d="M34 40l-8 10 4-1 4 3 4-3 4 1z" fill="#f7f3ea"/></g></symbol>
<symbol id="fxO" viewBox="0 0 34 16"><path d="M3 15a5 5 0 0 1 4-7 7 7 0 0 1 13-4 6 6 0 0 1 10 5 4 4 0 0 1 1 6z" fill="#fdfaf2"/></symbol>
<symbol id="fxS" viewBox="-6 -6 12 12"><path d="M0-6 1.4-1.4 6 0 1.4 1.4 0 6-1.4 1.4-6 0-1.4-1.4z" fill="#f6e9c4"/></symbol>
<symbol id="fxT" viewBox="0 0 120 76"><path d="M10 26a10 10 0 0 1 18-8a12 12 0 0 1 22-4a12 12 0 0 1 22 0a12 12 0 0 1 22 4a10 10 0 0 1 18 8q7 12-5 24H15q-12-12-5-24z" fill="#2f7a4c" filter="url(#fxQ)"/><path d="M2 40a10 10 0 0 1 18-8a12 12 0 0 1 22-4a12 12 0 0 1 22 0a12 12 0 0 1 22 4a10 10 0 0 1 18 8q7 11-5 22H7q-12-11-5-22z" fill="#45a159" filter="url(#fxQ)"/><path d="M14 54a10 10 0 0 1 18-8a12 12 0 0 1 22-4a12 12 0 0 1 22 0a12 12 0 0 1 22 4a10 10 0 0 1 18 8q7 9-5 18H19q-12-9-5-18z" fill="#74c46c" filter="url(#fxQ)"/></symbol><symbol id="fxC" viewBox="0 0 120 110"><path d="M0 110C8 82 30 74 60 72s52 10 60 38z" fill="#8fc65e"/><path d="M40 84V34h6v-6h6v6h5v-6h6v6h5v-6h6v6h6v50z" fill="#ece3d1" filter="url(#fxQ)"/><g filter="url(#fxQ)"><path d="M22 86V42h18v44zM80 86V42h18v44z" fill="#f6efe1"/><path d="M18 43 31 16l13 27zM76 43l13-27 13 27z" fill="#4b74b0"/></g><path d="M53 86V73a7 7 0 0 1 14 0v13z" fill="#6c5440"/><path d="M58 46h4v8h-4zM29 52h4v7h-4zM87 52h4v7h-4z" fill="#5a6b86"/></symbol></defs>
<g class="fx-sun"><g class="fx-day" filter="url(#fxP)"><circle cx="560" cy="-520" r="48" fill="#f6c94c"/><circle cx="560" cy="-520" r="34" fill="#fbdc78"/></g>
<g class="fx-nite"><circle cx="560" cy="-520" r="40" fill="#f1e6c8" filter="url(#fxP)"/><circle cx="548" cy="-530" r="9" fill="#e2d4b0"/><circle cx="574" cy="-508" r="6" fill="#e2d4b0"/>${[
      [-560, -590],
      [-330, -470],
      [-160, -640],
      [200, -600],
      [330, -470],
      [720, -610],
      [880, -480],
      [-820, -520],
      [1040, -600],
      [-1040, -620],
      [-60, -540],
      [420, -680],
    ]
      .map(
        ([x, y], i) =>
          `<use href="#fxS" x="${x - 6}" y="${y - 6}" width="${i % 3 ? 10 : 14}" height="${i % 3 ? 10 : 14}"/>`
      )
      .join('')}</g>
</g><g filter="url(#fxP)" class="fx-cl"><use href="#fxO" x="-470" y="-560" width="140" height="66"/><use href="#fxO" x="620" y="-430" width="116" height="54"/><use href="#fxO" x="-1060" y="-470" width="110" height="52"/><use href="#fxO" x="900" y="-580" width="130" height="60"/></g>
<g class="fx-mt"><use href="#fxM" x="-1460" y="-370" width="500" height="250"/><use href="#fxM" class="fx-mL" x="-930" y="-430" width="580" height="290"/><use href="#fxM" class="fx-mR" x="300" y="-450" width="600" height="300"/><use href="#fxM" x="860" y="-360" width="480" height="240"/></g>
<g filter="url(#fxP)"><path fill="#ecd294" d="M-3000-150H-1200C-1000-190-800-170-600-150S-200-130 0-150 400-190 600-160 1000-140 1200-160H3000V40H-3000z"/></g>
<g class="fx-cas" filter="url(#fxP)"><use href="#fxC" x="-700" y="-340" width="240" height="220"/><path d="M-580-284v-40" stroke="#6b4426" stroke-width="2.4"/><path class="fx-pen" d="M-579-324h30l-8 8 8 8h-30z" fill="#f2b829"/></g>
<g filter="url(#fxP)"><path fill="#b8c46a" d="M-3000-95H-1200C-1000-120-760-110-560-96S-160-80 0-92 380-118 640-100 1000-84 1200-100H3000V40H-3000z"/></g>
<g filter="url(#fxP)"><path d="M-440 20C-410-290-240-450 0-450S410-290 440 20z" fill="#5f9f4c"/><path d="M-395 20C-365-262-215-414 0-414S365-262 395 20z" fill="#8fc65e"/><path d="M-320 20C-296-214-176-352 0-352S296-214 320 20z" fill="#9fd16d"/></g>
<g class="fx-for"><use href="#fxT" x="-1000" y="-190" width="340" height="215"/><use href="#fxT" x="400" y="-200" width="360" height="228"/><use href="#fxT" x="-1320" y="-170" width="320" height="202"/><use href="#fxT" x="840" y="-176" width="330" height="208"/></g>
<g filter="url(#fxP)"><path fill="#9fbf5e" d="M-3000-36H-1200C-900-56-600-28-300-14S300-6 600-28 900-50 1200-38H3000V1600H-3000z"/><path fill="#f5ebcd" d="M-3000 170C-2000 150-1400 190-900 180S-300 150 0 172 600 196 1000 176 2000 160 3000 172V1600H-3000z"/><path fill="#ecd294" d="M-122 4C-150 140-230 300-360 1600H360C230 300 150 140 122 4z"/></g>
<g filter="url(#fxP)"><use href="#fxT" x="-370" y="-50" width="170" height="108"/><use href="#fxT" x="205" y="-46" width="160" height="101"/></g></svg>`;
    const TORCH = (
      i
    ) => `<div class="fx-torch fx-t${i}" aria-hidden="true"><svg viewBox="0 0 46 120" focusable="false"><g filter="url(#fxQ)"><rect x="15" y="80" width="16" height="30" rx="3" fill="#4b5262"/><path d="M17 58h12l-3 54h-6z" fill="#8a5a34"/><path d="M17 64h12v5H17zM18 76h10v4H18z" fill="#5b3720"/><path d="M10 48h26l-5 14H15z" fill="#6b4426"/><rect x="9" y="46" width="28" height="6" rx="2" fill="#a0683a"/></g>
<g class="fx-fl" filter="url(#fxQ)"><path class="fx-f1" fill="#e2533a" d="M23 2c4 10 15 16 14 32-1 12-7 18-14 18S9 46 9 36c0-10 6-14 7-24 2 5 4 7 5 11 1-8 0-14 2-21z"/><path class="fx-f2" fill="#f7922f" d="M23 14c3 8 9 13 8 24-.5 9-4 13-8 13s-8-4-7.5-11c.5-7 4.5-10 5.5-16 1 4 2 6 2.5 8 .5-6-.5-12-.5-18z"/><path class="fx-f3" fill="#ffd45c" d="M23 28c2 6 5 10 4.5 16-.5 5-2 7-4.5 7s-4.5-2-4.2-6c.2-5 3.2-8 4.2-17z"/><path class="fx-f4" fill="#fff4c4" d="M23 40c1.2 3 2.6 5 2.4 7.6-.2 2.4-1 3.4-2.4 3.4s-2.4-1-2.3-3c.1-2.6 1.6-4 2.3-8z"/></g></svg></div>`;
    const on = (t, ev, f, o) => {
      t.addEventListener(ev, f, o);
      L.push([t, ev, f, o]);
    };
    const later = (ms, f) => {
      tmr.push(setTimeout(safe(f), ms));
    };
    function build() {
      intro = D.createElement('div');
      intro.id = 'fx-intro';
      intro.setAttribute('role', 'dialog');
      intro.setAttribute('aria-modal', 'true');
      intro.setAttribute('aria-labelledby', 'fx-q');
      intro.className = isStatic() ? 'fx-static' : '';
      intro.innerHTML = `<div class="fx-stage"><div class="fx-door">${SCN}${ARCH}${SVG}${TORCH(0)}${TORCH(1)}</div><div class="fx-copy"><p class="fx-eye">DM Assistance Board</p><p class="fx-ctx" hidden></p><p class="fx-h">The table is set.</p><p class="fx-q" id="fx-q">Enter the dungeon</p><button type="button" id="fx-yes">Enter the dungeon</button><button type="button" id="fx-skip">Skip</button><p class="fx-hint">Enter to begin · Esc to skip</p></div></div>${TOG('fx-tog')}`;
      (D.body || H).appendChild(intro);
      cl('fx-intro-on', 1);
      on(W, KD, onKey, true);
      on(intro, 'click', onClick);
      const pd = (e) => {
        if (e.cancelable) e.preventDefault();
      };
      on(intro, 'wheel', pd, { passive: false });
      on(intro, 'touchmove', pd, { passive: false });
      focusYes();
    }
    function focusYes() {
      const y = $('fx-yes');
      if (y && phase === 'ask')
        try {
          y.focus({ preventScroll: true });
        } catch (e) {}
    }
    const INTRO_KEYS = { Enter: 'yes', Escape: 'skip', Tab: 'tab', ' ': 'ff' };
    function onKey(ev) {
      try {
        if (!intro) return;
        const act = INTRO_KEYS[ev.key];
        ev.stopImmediatePropagation();
        if (act === 'tab') {
          trapTab(ev);
          return;
        }
        if (phase === 'ask') {
          if (act === 'skip') {
            ev.preventDefault();
            skip();
          } else if (act === 'yes' && !(ev.target.closest && ev.target.closest('#fx-skip,#fx-tog'))) {
            ev.preventDefault();
            yes();
          }
        } else if (act) {
          ev.preventDefault();
          fastForward();
        }
      } catch (e) {
        destroy();
      }
    }
    function trapTab(ev) {
      ev.preventDefault();
      const f = [...intro.querySelectorAll('button')];
      if (!f.length) return;
      const i = f.indexOf(D.activeElement),
        n = f.length,
        j = i < 0 ? (ev.shiftKey ? n - 1 : 0) : (i + (ev.shiftKey ? -1 : 1) + n) % n;
      f[j].focus({ preventScroll: true });
    }
    function onClick(ev) {
      try {
        const t = ev.target.closest ? ev.target.closest('button') : null;
        if (t && t.id === 'fx-tog') {
          setOff(!off, true);
          return;
        }
        if (phase !== 'ask') {
          fastForward();
          return;
        }
        if (t && t.id === 'fx-yes') yes();
        else if (t && t.id === 'fx-skip') skip();
      } catch (e) {
        destroy();
      }
    }
    function yes() {
      if (phase !== 'ask') return;
      phase = 'draw';
      if (isStatic()) {
        fade(200);
        return;
      }
      intro.classList.add('fx-go');
      cl('fx-intro-go', 1);
      intro.querySelectorAll('.fx-spark').forEach((c) => {
        const b = +c.dataset.b || 0;
        c.querySelectorAll('animateMotion,animate').forEach((a) => {
          try {
            a.beginElementAt(b);
          } catch (e) {}
        });
      });
      later(1850, () => out(550));
      later(4000, destroy);
    }
    function out(ms) {
      if (!intro || phase === 'out') return;
      phase = 'out';
      intro.classList.add('fx-out');
      if (ms < 550) intro.classList.add('fx-ff');
      on(intro, 'transitionend', (e) => {
        if (e.target === intro && e.propertyName === 'opacity') destroy();
      });
      later(ms + 80, destroy);
    }
    function fastForward() {
      if (phase === 'draw') out(300);
    }
    function skip() {
      if (phase !== 'ask') return fastForward();
      phase = 'out';
      fade(200);
    }
    function fade(ms) {
      intro.style.pointerEvents = 'none';
      let a = null;
      try {
        a = intro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' });
      } catch (e) {}
      if (!a) return destroy();
      a.onfinish = safe(destroy);
      later(ms + 150, destroy);
    }
    function setInert(v) {
      ['.wrap', '#overlay'].forEach((s) => {
        const el = D.querySelector(s);
        if (!el) return;
        if (v) el.inert = true;
        else {
          el.inert = false;
          el.removeAttribute('inert');
        }
      });
    }
    function destroy() {
      if (!intro) return;
      const n = intro;
      intro = null;
      phase = 'gone';
      tmr.forEach(clearTimeout);
      tmr = [];
      L.forEach(([t, ev, f, o]) => {
        try {
          t.removeEventListener(ev, f, o);
        } catch (e) {}
      });
      L = [];
      try {
        n.remove();
      } catch (e) {}
      H.classList.remove('fx-intro-on', 'fx-intro-go');
      setInert(false);
      try {
        const mc = D.querySelector('.mc-ov'),
          f = mc && mc.querySelector(FOC);
        if (f) f.focus({ preventScroll: true });
        else if (D.activeElement && D.activeElement !== D.body) D.activeElement.blur();
      } catch (e) {}
      if (ready) afterIntro();
    }
    function afterIntro() {
      setTimeout(
        safe(() => {
          armed = true;
        }),
        600
      );
    }
    function fillCtx() {
      const c = intro && intro.querySelector('.fx-ctx');
      if (!c) return;
      const sub = ($('subline') || {}).textContent || '',
        camp = sub.indexOf(' · ') > 0 ? sub.split(' · ')[0].trim() : '';
      const sn = ((D.querySelector('#dmSeat .sessn') || {}).textContent || '').replace(/\D+/g, '');
      const ex = (($('exampleNote') || {}).textContent || '').trim();
      if (camp && sn && camp !== 'Untitled campaign' && !ex) {
        c.textContent = camp + ' · Session ' + sn;
        c.hidden = false;
      }
    }
    try {
      build();
    } catch (e) {
      destroy();
    }
    /* back/forward cache: the page is restored without reloading, so show the intro again */
    W.addEventListener(
      'pageshow',
      safe((e) => {
        if (!e.persisted || intro) return;
        tmr.forEach(clearTimeout);
        tmr = [];
        phase = 'ask';
        armed = false;
        clearTop();
        build();
        if (ready) {
          setInert(true);
          fillCtx();
          focusYes();
        }
      })
    );

    /* ================= toggle ================= */
    function syncBtns() {
      ['fxBtn', 'fx-tog'].forEach((id) => {
        const b = $(id);
        if (!b) return;
        b.setAttribute('aria-pressed', String(!off));
        const s = b.querySelector('span');
        if (s) s.textContent = ': ' + (off ? 'Off' : 'On');
      });
    }
    function setOff(v, persist) {
      off = !!v;
      cl('fx-off', off);
      if (persist) sset(LS, 've-fx', off ? 'off' : 'on');
      syncBtns();
      if (intro && phase === 'ask') intro.classList.toggle('fx-static', isStatic());
      if (off) clearTop();
    }

    /* ================= cue helpers ================= */
    let top = null,
      cues = 0;
    const live = () => armed && !off && !RM && !D.hidden && !intro && now() > quietUntil;
    const G = 'var(--gild,var(--gold,#c99a3c))',
      cm = (c, p) => `color-mix(in srgb,${c} ${p}%,transparent)`;
    const POP = 'cubic-bezier(.34,1.36,.64,1)';
    const Gate = {
      t: [],
      n: 0,
      ok() {
        const n = now();
        this.t = this.t.filter((x) => n - x < 1000);
        if (this.t.length >= 2 || (this.t.length && n - this.t[this.t.length - 1] < 400)) return false;
        this.t.push(n);
        this.n++;
        return true;
      },
    };
    const clearTop = () => {
      if (top) top.textContent = '';
    };
    const box = (x, y, w, h) => ({ left: x, top: y, width: w, height: h });
    function vis(el) {
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect(),
        w = innerWidth,
        h = innerHeight;
      if (!r.width || !r.height || r.bottom <= 0 || r.right <= 0 || r.top >= h || r.left >= w) return null;
      const hit = D.elementFromPoint(
        clamp(r.left + r.width / 2, 1, w - 1),
        clamp(r.top + Math.min(r.height / 2, 20), 1, h - 1)
      );
      return hit && (hit === el || el.contains(hit)) ? r : null;
    }
    function cue(r, css, tag) {
      if (!top) return null;
      while (top.childElementCount >= 24) top.firstElementChild.remove();
      const n = D.createElement(tag || 'i');
      n.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;${css || ''}`;
      top.appendChild(n);
      cues++;
      return n;
    }
    function play(n, kf, o) {
      if (!n) return null;
      let a = null;
      try {
        a = n.animate(kf, Object.assign({ fill: 'both' }, o));
      } catch (e) {}
      const k = () => n.remove();
      if (a) {
        a.onfinish = k;
        a.oncancel = k;
      }
      setTimeout(k, (o.duration || 0) + (o.delay || 0) + 400);
      return a;
    }
    const wa = (el, kf, o) => {
      try {
        return el.animate(kf, o);
      } catch (e) {
        return null;
      }
    };
    const ctr = (r) => [r.left + r.width / 2, r.top + r.height / 2];
    function ring(r, color, scale, dur, radius, delay) {
      const n = cue(r, `border:2px solid ${color};border-radius:${radius || '50%'}`);
      return play(
        n,
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: `scale(${scale})`, opacity: 0 },
        ],
        { duration: dur, delay: delay || 0, easing: 'cubic-bezier(.2,.7,.2,1)' }
      );
    }
    /* paper confetti: small cut rectangles that tumble as they fly (no glow) */
    function dots(n, cx, cy, color, f, dur, size) {
      for (let i = 0; i < n; i++) {
        const s = size || 3,
          h = s * 1.6,
          rt = Math.round(rnd(0, 180)),
          d = cue(box(cx - s / 2, cy - h / 2, s, h), `border-radius:1px;background:${color}`);
        const [dx, dy, dl] = f(i);
        play(
          d,
          [
            { transform: `translate(0,0) rotate(${rt}deg)`, opacity: 1 },
            { transform: `translate(${dx * 0.6}px,${dy * 0.6}px) rotate(${rt + 110}deg)`, opacity: 1, offset: 0.6 },
            { transform: `translate(${dx}px,${dy}px) rotate(${rt + 180}deg)`, opacity: 0 },
          ],
          { duration: dur, delay: dl || 0, easing: 'cubic-bezier(.2,.7,.3,1)' }
        );
      }
    }
    function textRect(el) {
      try {
        const rg = D.createRange();
        rg.selectNodeContents(el);
        const r = rg.getBoundingClientRect();
        if (r.width) return r;
      } catch (e) {}
      return el.getBoundingClientRect();
    }
    function sheen(el, color, dur) {
      const r = vis(el);
      if (!r) return;
      const n = cue(r, 'overflow:hidden;border-radius:8px');
      const b = D.createElement('i');
      b.style.cssText = `inset:0;background:linear-gradient(100deg,transparent 30%,${cm(color, 22)} 50%,transparent 70%)`;
      n.appendChild(b);
      play(b, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }], {
        duration: dur || 700,
        easing: 'ease-in-out',
      });
      setTimeout(() => n.remove(), (dur || 700) + 300);
    }
    /* turn change: the new row's bookmark ribbon drops in */
    function ribbon(el) {
      const r = vis(el);
      if (!r) return;
      play(
        cue(
          box(r.left + 8, r.top - 1, 12, 30),
          'background:var(--brass,var(--gild));clip-path:polygon(0 0,100% 0,100% 100%,50% 76%,0 100%)'
        ),
        [
          { transform: 'translateY(-14px)', opacity: 0 },
          { transform: 'none', opacity: 1, offset: 0.6 },
          { transform: 'none', opacity: 0 },
        ],
        { duration: 700, easing: POP }
      );
    }
    function svgCue(r, inner) {
      const n = cue(r, '', null);
      n.innerHTML = `<svg width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
      return n;
    }

    /* ================= dice ================= */
    let lastFace = null;
    function tumble(d) {
      d.querySelectorAll('.reels:not(.still)>.reel').forEach((reel) => {
        const w = reel.querySelector('.win');
        if (!w) return;
        const dur = parseFloat(reel.style.getPropertyValue('--d')) || 850;
        wa(
          w,
          { rotate: ['-12deg', '9deg', '-4deg', '0deg'], translate: ['0 -6px', '0 0', '0 -2px', '0 0'] },
          { duration: dur, easing: 'ease-out' }
        );
        wa(w, { scale: [1.08, 1] }, { duration: 140, delay: dur, easing: 'ease-out' });
      });
      if (lastFace && now() - lastFace.t < 800) {
        const b = d.closest('.dice') && d.closest('.dice').querySelector(`[data-face="${lastFace.f}"]`);
        b && wa(b, { rotate: ['0deg', '360deg'] }, { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
      lastFace = null;
    }
    function thud(el) {
      wa(el, { translate: ['0 0', '-3px 0', '3px 0', '-2px 0', '0 0'] }, { duration: 280 });
    }
    /* gold paper burst: banner, dragon, lake and forest paper (the storybook palette) */
    const CONF = [
      'var(--pc-banner,#f2b829)',
      'var(--pc-dragon,#c23a32)',
      'var(--pc-lake,#3f6fb8)',
      'var(--pc-forest,#2f7a4c)',
    ];
    function nat20(d) {
      const tot = d.querySelector('.tot');
      if (!vis(d) || !tot) return;
      const r = textRect(tot),
        [cx, cy] = ctr(r),
        s = Math.max(r.width, r.height) * 1.2;
      ring(box(cx - s / 2, cy - s / 2, s, s), G, 2.6, 700);
      for (let i = 0; i < 14; i++) {
        const a = (((i * 360) / 14 + rnd(-8, 8)) * Math.PI) / 180,
          R = rnd(60, 110),
          c = Math.cos(a),
          sn = Math.sin(a),
          r0 = s / 2;
        dots(1, cx + c * r0, cy + sn * r0, CONF[i % 4], () => [c * R, sn * R + 14], 650, 4);
      }
      wa(tot, { scale: [1, 1.16, 1] }, { duration: 420, easing: POP });
    }
    function nat1(d) {
      const r = vis(d);
      if (!r) return;
      const w = r.width,
        h = r.height;
      /* torn paper: one jagged tear across the result, a felt-coloured gap with an ink edge on top */
      let tear = `M3 ${(h * 0.55).toFixed(1)}`;
      for (let k = 1; k <= 14; k++)
        tear += ` L${(3 + ((w - 6) * k) / 14).toFixed(1)} ${(h * 0.55 + (k % 2 ? 1 : -1) * rnd(2, 5)).toFixed(1)}`;
      const col = 'color-mix(in srgb,var(--crit) 70%,var(--ink))';
      const n = svgCue(
        r,
        [
          [tear, 'var(--pc-felt,var(--surface))', 5],
          [tear, col, 1.2],
        ]
          .map(
            ([p, c, sw]) =>
              `<path d="${p}" pathLength="1" stroke="${c}" stroke-width="${sw}" stroke-dasharray="1" stroke-dashoffset="1"/>`
          )
          .join('')
      );
      n.querySelectorAll('path').forEach((p) =>
        wa(p, { strokeDashoffset: [1, 0] }, { duration: 220, fill: 'forwards' })
      );
      play(n, [{ opacity: 1 }, { opacity: 1, offset: 0.69 }, { opacity: 0 }], { duration: 1620 });
      thud(d);
    }
    function scanAdded(n) {
      const d = n.matches('.dres.spinning') ? n : n.querySelector('.dres.spinning');
      if (!d) return;
      const t = parseFloat(d.style.getPropertyValue('--t')) || 0;
      tumble(d);
      const at = (f) =>
        setTimeout(
          safe(() => {
            if (d.isConnected && live()) f(d);
          }),
          t + 120
        );
      if (d.classList.contains('n20')) at(nat20);
      else if (d.classList.contains('n1')) at(nat1);
      else if (d.querySelector('.gcres')) {
        const tot = d.querySelector('.tot');
        if (tot && /Failure/.test(tot.textContent)) at(() => thud(tot));
      }
    }

    /* ================= rows & cards ================= */
    const txt = (e) => (e ? e.textContent.trim() : '');
    const rowName = (el) => txt(el.querySelector('.who strong,.who .mlink,strong'));
    const keyed = (els) => {
      const seen = {};
      return els.map((el) => {
        const n = rowName(el);
        seen[n] = (seen[n] || 0) + 1;
        return [n + '#' + seen[n], el];
      });
    };
    const pills = (el) => [...el.querySelectorAll('.pill.cd')];
    const pname = (p) => p.dataset.c || txt(p).replace(/\s*×$/, '');
    function rowState(el) {
      const v = el.querySelector('.hprow .v'),
        b = v && v.querySelector('b'),
        m = /\/\s*(\d+)/.exec(v ? v.textContent : '');
      const dn = [...el.querySelectorAll('.pill.dn')].some((p) => txt(p) === 'Dead');
      return {
        hp: b ? +txt(b) || 0 : 0,
        max: m ? +m[1] : 0,
        down: el.classList.contains('down'),
        ds: [el.querySelectorAll('.ds .s.on,.ds .s .on').length, el.querySelectorAll('.ds .f.on,.ds .f .on').length],
        dsb: !!el.querySelector('.ds'),
        dead: !!el.querySelector('.deadrow') || dn,
        stable: [...el.querySelectorAll('.pill.ok')].some((p) => txt(p) === 'Stable'),
        cond: pills(el).map(pname),
        fx: [...el.querySelectorAll('.pill.fx')].map((p) => txt(p).split(' · ')[0]),
        insp: !!el.querySelector('.insp.on'),
        lv: !!el.querySelector('[data-lvup]'),
      };
    }
    const sig = (s) => JSON.stringify([s.hp, s.down, s.ds, s.dead, s.stable, s.cond, s.fx, s.insp, s.lv]);
    function diffRows(oldR, newR, kind) {
      if (!oldR.length) return;
      const O = new Map(oldR.map(([k, e]) => [k, rowState(e)])),
        ch = [];
      for (const [k, el] of newR) {
        const a = O.get(k);
        if (!a) continue;
        const b = rowState(el);
        if (sig(a) !== sig(b)) ch.push([el, a, b, k]);
      }
      if (ch.length >= 4) return;
      ch.forEach(([el, a, b, k]) => safe(cueRow)(el, a, b, kind, k));
      if (kind === 'c') {
        const oc = oldR.find(([, e]) => e.classList.contains('cur')),
          nc = newR.find(([, e]) => e.classList.contains('cur'));
        if (oc && nc && oc[0] !== nc[0]) {
          const key = nc[0];
          setTimeout(
            safe(() => {
              if (!live()) return;
              const el = curRow(key);
              if (el) {
                ribbon(el);
                el.closest('.turns')
                  .querySelectorAll('.pill.fx')
                  .forEach((p) => {
                    if (/·\s*1 rd/.test(txt(p))) {
                      const r = vis(p) && p.getBoundingClientRect();
                      r && ring(r, 'var(--warn)', 1.3, 600, '999px');
                    }
                  });
              }
            }),
            300
          );
        }
      }
    }
    function curRow(key) {
      const ov = D.querySelector('#overlay>.ov');
      if (!ov) return null;
      const f = keyed([...ov.querySelectorAll('.turns>.cb:not(.lair)')]).find(([k]) => k === key);
      return f ? f[1] : null;
    }
    const pillEl = (el, name) => pills(el).find((p) => pname(p) === name);
    function cueRow(el, a, b, kind) {
      const r = vis(el);
      if (!r) return;
      const row = kind === 'c',
        drop = a.hp - b.hp,
        max = b.max || a.max || 1;
      if (b.dead && !a.dead) toll(el, r);
      else if ((!a.down && b.down) || (a.hp > 0 && b.hp <= 0)) downed(el, r);
      else if (drop > 0 && (drop / max >= 0.3 || drop >= 20)) bigHit(el, r, row, drop / max >= 0.6 || drop >= 40);
      else if (drop < 0 && a.hp > 0) heal(el);
      if (a.hp <= 0 && b.hp > 0 && !b.dead) rekindle(el, r);
      // death saves
      const dsd = (k, c) => {
        const n = b.ds[k] - a.ds[k];
        if (n <= 0) return;
        const on = [...el.querySelectorAll(k ? '.ds .f.on,.ds .f .on' : '.ds .s.on,.ds .s .on')].pop();
        const dr = on && vis(on) && on.getBoundingClientRect();
        if (!dr) return;
        const [x, y] = ctr(dr);
        for (let i = 0; i < Math.min(n, 2); i++) ring(box(x - 6, y - 6, 12, 12), c, 2.4, 500, 0, i * 220);
        if (k) wa(on, { translate: ['0 0', '-2px 0', '2px 0', '0 0'] }, { duration: 240 });
      };
      dsd(0, 'var(--good)');
      dsd(1, 'var(--crit)');
      if (b.hp <= 0 && !b.dead && ((!a.stable && b.stable) || (row && a.dsb && !b.dsb))) sheen(el, 'var(--good)');
      // conditions & effects
      b.cond
        .filter((c) => !a.cond.includes(c))
        .forEach((c) => {
          const p = pillEl(el, c);
          p && wa(p, { scale: [1.3, 1], opacity: [0.2, 1] }, { duration: 240, easing: POP });
        });
      if (row)
        b.fx
          .filter((c) => !a.fx.includes(c))
          .forEach((c) => {
            const p = [...el.querySelectorAll('.pill.fx')].find((x) => txt(x).split(' · ')[0] === c);
            p && wa(p, { scale: [1.3, 1], opacity: [0.2, 1] }, { duration: 240, easing: POP });
          });
      const CC = 'Concentrating';
      if (drop > 0 && b.hp > 0 && a.cond.includes(CC) && b.cond.includes(CC)) {
        const pr = () => {
          const p = pillEl(el, CC);
          const q = p && vis(p) && p.getBoundingClientRect();
          q && ring(q, 'var(--magic)', 1.25, 500, '999px');
        };
        pr();
        setTimeout(
          safe(() => {
            if (el.isConnected && live()) pr();
          }),
          600
        );
      }
      if (a.cond.includes(CC) && !b.cond.includes(CC)) {
        const t = el.querySelector('.tags,.cfoot');
        const q = t && t.getBoundingClientRect();
        if (q)
          dots(
            8,
            q.left + 8,
            q.top + q.height / 2,
            'var(--magic)',
            (i) => {
              const g = (i / 8) * Math.PI * 2;
              return [Math.cos(g) * rnd(18, 30), Math.sin(g) * rnd(14, 24)];
            },
            450,
            3
          );
      }
      if (!a.insp && b.insp) {
        const s = el.querySelector('.insp');
        const q = s && s.getBoundingClientRect();
        if (q) {
          const [x, y] = ctr(q);
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].forEach(([u, v], i) =>
            play(
              cue(box(x + u * 12 - 2, y + v * 12 - 2, 4, 4), `background:${G};transform:rotate(45deg)`),
              [
                { transform: 'rotate(45deg) scale(0)', opacity: 0 },
                { transform: 'rotate(45deg) scale(1.4)', opacity: 1 },
                { transform: 'rotate(45deg) scale(0)', opacity: 0 },
              ],
              { duration: 450, delay: i * 40 }
            )
          );
        }
      }
      if (!a.lv && b.lv) {
        const p = el.querySelector('[data-lvup]'),
          id = el.dataset.pid || '';
        if (p && !LV.has(id)) {
          LV.add(id);
          sheen(p, G);
        }
      }
    }
    const LV = new Set();
    /* washes share the one flash limiter (Gate: <=2 per second, >=400 ms apart); the knockback is motion, not a flash */
    /* big hit: knockback plus an ink splat; huge: a stronger paper shake and a bigger splat (no screen wash) */
    function bigHit(el, r, row, huge) {
      if (huge) wa(el, { translate: ['8px 0', '-5px 0', '3px 0', '0 0'] }, { duration: 320, easing: 'ease-out' });
      else if (row) wa(el, { translate: ['5px 0', '0 0'] }, { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (!Gate.ok()) return;
      const s = huge ? 40 : 28;
      play(
        cue(
          box(r.left - 4, r.top + r.height / 2 - s / 2, s, s),
          'background:var(--crit);border-radius:46% 54% 40% 60%/55% 42% 58% 45%'
        ),
        [
          { scale: 0.2, opacity: 0.9 },
          { scale: 1, opacity: 0.85, offset: 0.3 },
          { scale: 1.1, opacity: 0 },
        ],
        { duration: 450 }
      );
    }
    function heal(el) {
      const bar = el.querySelector('.bar'),
        q = bar && bar.getBoundingClientRect();
      if (!q) return;
      dots(3, q.left + q.width * 0.5, q.top, 'var(--good)', (i) => [(i - 1) * 14, -14], 600, 4);
    }
    function rekindle(el, r) {
      const bar = el.querySelector('.bar'),
        q = bar && bar.getBoundingClientRect();
      if (q) dots(8, q.left + q.width * 0.15, q.top, G, (i) => [rnd(-6, 30) + i * 3, -rnd(16, 30)], 900, 3);
      if (r) sheen(el, 'var(--good)');
    }
    /* The crack runs along the top edge (y 1..5 px) so it never crosses the name, HP or the Unconscious pill */
    function downed(el, r) {
      const w = r.width,
        x1 = w - 6;
      const pts = [];
      for (let k = 0; k < 10; k++) pts.push([6 + ((x1 - 6) * k) / 9, 3 + (k % 2 ? 1 : -1) * rnd(0.6, 2)]);
      const d = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
      const col = 'color-mix(in srgb,var(--crit) 75%,var(--ink))';
      const n = svgCue(
        r,
        `<path d="${d}" pathLength="1" stroke="${col}" stroke-width="3" opacity=".3" stroke-dasharray="1" stroke-dashoffset="1"/><path d="${d}" pathLength="1" stroke="${col}" stroke-width="1.6" stroke-dasharray="1" stroke-dashoffset="1"/>`
      );
      n.querySelectorAll('path').forEach((p) =>
        wa(p, { strokeDashoffset: [1, 0] }, { duration: 260, fill: 'forwards' })
      );
      play(n, [{ opacity: 1 }, { opacity: 1, offset: 0.52 }, { opacity: 0 }], { duration: 1860 });
      for (let i = 0; i < 6; i++) {
        const p = pts[1 + (i % 8)];
        dots(
          1,
          r.left + p[0],
          r.top + p[1],
          'color-mix(in srgb,var(--ink-3) 60%,transparent)',
          () => [rnd(-14, 14), -rnd(8, 16)],
          600,
          2
        );
      }
      wa(
        el,
        { transform: ['none', 'perspective(700px) rotateX(10deg) scale(.985)', 'none'] },
        { duration: 420, easing: 'ease-in-out' }
      );
    }
    function toll(el, r) {
      const dark = isDark();
      if (Gate.ok())
        play(
          cue(
            box(0, 0, innerWidth, innerHeight),
            `background:radial-gradient(ellipse at center,transparent 50%,${dark ? 'rgba(0,0,0,.18)' : 'rgba(43,28,12,.12)'})`
          ),
          [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }],
          { duration: 1600, easing: 'ease-in-out' }
        );
      for (let i = 0; i < 10; i++)
        dots(
          1,
          r.left + rnd(0.1, 0.9) * r.width,
          r.top + rnd(0.1, 0.5) * r.height,
          'color-mix(in srgb,var(--ink-3) 55%,transparent)',
          () => [rnd(-14, 14), rnd(26, 46)],
          2400,
          2.5
        );
    }

    /* ================= home + DM seat ================= */
    function diffSeat(old, t) {
      const had = old.some(
          (n) => n.nodeType === 1 && (n.matches('.runline') || (n.querySelector && n.querySelector('.runline')))
        ),
        has = !!t.querySelector('.runline');
      if (!had && has && live()) {
        if (vis(t)) wa(t, { translate: ['0 0', '0 -4px', '0 0'] }, { duration: 500, easing: POP });
      }
    }
    function diffTurnHome(old, t) {
      const nm = (s) => {
        const m = /·\s*([^·]*?)’s turn/.exec(s);
        return m ? m[1] : null;
      };
      const a = nm(old.map((n) => n.textContent || '').join('')),
        b = nm(t.textContent || '');
      if (a && b && a !== b && live()) {
        const lv = t.querySelector('.live'),
          q = lv && vis(t) && lv.getBoundingClientRect();
        if (q) ring(box(q.left, q.top + q.height / 2 - 3.5, 7, 7), 'var(--crit)', 3, 700);
      }
    }
    function markConc() {
      D.querySelectorAll('#party .card .pill.cd').forEach((p) => {
        if (txt(p) === 'Concentrating' && p.dataset.fx !== 'conc') p.dataset.fx = 'conc';
      });
    }
    function battleState() {
      const on = !!($('tstate') && $('tstate').classList.contains('is-live'));
      cl('fx-battle', on);
    }
    const isDark = () => /dark/.test(getComputedStyle(H).colorScheme || '');

    /* ================= hold ================= */
    /* hold: a sheet, popup or the Time & light drawer covers the table, so html.fx-hold pauses the CSS loops */
    const HOLD = '#overlay>.ov,#mcard,.mc-ov,#dmSeat.tl-open';
    let held = false;
    function holdSync() {
      const h = !!D.querySelector(HOLD);
      if (h !== held) {
        held = h;
        cl('fx-hold', h);
      }
    }

    /* ================= observer ================= */
    const OWN = (n) => n && n.closest && n.closest('#fx-top,#fx-intro,vo-ghost,#tTimer,#runFor');
    const mo = new MutationObserver(
      safe((recs) => {
        const first = new Map();
        let party = false;
        holdSync();
        for (const r of recs) {
          if (r.type !== 'childList') continue;
          const t = r.target;
          if (t.nodeType !== 1 || OWN(t)) continue;
          if ([...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && n.classList.contains('tl-own')))
            continue;
          const id = t.id;
          if (id === 'party' || id === 'overlay' || id === 'dmSeat' || id === 'tstate') {
            if (!first.has(t)) first.set(t, []);
            first.get(t).push(...r.removedNodes);
            if (id === 'party') party = true;
          }
          if (live()) for (const n of r.addedNodes) if (n.nodeType === 1 && n.querySelector) safe(scanAdded)(n);
        }
        if (party) markConc();
        for (const [t, old] of first) {
          const id = t.id;
          if (id === 'dmSeat') {
            safe(diffSeat)(old, t);
            continue;
          }
          if (!live()) continue;
          if (id === 'overlay') {
            const o = old.find((n) => n.nodeType === 1 && n.classList.contains('ov')),
              nw = t.querySelector(':scope>.ov');
            if (o && nw) {
              const sel = '.turns>.cb:not(.lair)';
              safe(diffRows)(keyed([...o.querySelectorAll(sel)]), keyed([...nw.querySelectorAll(sel)]), 'c');
              const ra = o.querySelector('.rbar .r em'),
                rb = nw.querySelector('.rbar .r em'),
                rr = nw.querySelector('.rbar .r');
              if (ra && rb && +txt(rb) > +txt(ra) && vis(rr)) {
                const q = rr.getBoundingClientRect();
                play(
                  cue(box(q.left, q.bottom + 1, q.width, 1.5), `background:${G};transform-origin:left`),
                  [
                    { transform: 'scaleX(0)', opacity: 1 },
                    { transform: 'scaleX(1)', opacity: 1, offset: 0.45 },
                    { transform: 'scaleX(1)', opacity: 0 },
                  ],
                  { duration: 900 }
                );
              }
            }
          } else if (id === 'party')
            safe(diffRows)(
              old.filter((n) => n.nodeType === 1 && n.matches('.card[data-pid]')).map((n) => [n.dataset.pid, n]),
              [...t.querySelectorAll(':scope>.card[data-pid]')].map((n) => [n.dataset.pid, n]),
              'p'
            );
          else if (id === 'tstate') safe(diffTurnHome)(old, t);
        }
      })
    );

    /* ================= boot (DOMContentLoaded) ================= */
    const boot = safe(() => {
      ready = true;
      if (intro) {
        setInert(true);
        fillCtx();
        if (!intro.contains(D.activeElement)) focusYes();
      }
      top = D.createElement('div');
      top.id = 'fx-top';
      top.setAttribute('aria-hidden', 'true');
      D.body.append(top);
      const f = D.querySelector('footer.foot');
      if (f && !$('fxBtn')) {
        const hb = $('helpBtn');
        f.insertAdjacentHTML('beforeend', TOG('fxBtn'));
        const b = $('fxBtn');
        if (hb) f.insertBefore(b, hb);
        b.addEventListener(
          'click',
          safe(() => setOff(!off, true))
        );
      }
      mo.observe(D.body, { childList: true, subtree: true });
      const ts = $('tstate');
      if (ts) new MutationObserver(safe(battleState)).observe(ts, { attributes: true, attributeFilter: ['class'] });
      battleState();
      markConc();
      // undo quiet window: read-only capture listeners, never preventDefault
      const UNDO = { z: 1, Z: 1 };
      D.addEventListener(
        KD,
        (e) => {
          if ((e.ctrlKey || e.metaKey) && UNDO[e.key]) quietUntil = now() + 400;
        },
        true
      );
      D.addEventListener(
        'click',
        (e) => {
          if (e.target.closest && e.target.closest('#liveUndo')) quietUntil = now() + 400;
        },
        true
      );
      D.addEventListener(
        'pointerdown',
        (e) => {
          const b = e.target.closest && e.target.closest('[data-face]');
          if (b) lastFace = { f: b.dataset.face, t: now() };
        },
        true
      );
      D.addEventListener(
        'visibilitychange',
        safe(() => {
          cl('fx-paused', D.hidden);
          if (D.hidden) clearTop();
        })
      );
      holdSync();
      const st = safe((s) => {
        if (s.key === 've-fx' || s.key === null) setOff(wantOff(), false);
      });
      if (W.DMC && W.DMC.addRaw) W.DMC.addRaw('storage', st);
      else W.addEventListener('storage', st);
      if (!intro) afterIntro();
    });
    try {
      RMq.addEventListener(
        'change',
        safe(() => {
          RM = RMq.matches;
          cl('fx-rm', RM);
          if (RM) clearTop();
          if (wantOff() !== off) setOff(wantOff(), false);
        })
      );
    } catch (e) {}
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
    W.__fx = {
      on: () => setOff(false, true),
      off: () => setOff(true, true),
      destroyIntro: destroy,
      sync: safe(holdSync),
      stats: () => ({
        intro: !!intro,
        phase,
        armed,
        off,
        rm: RM,
        live: live(),
        cues,
        top: top ? top.childElementCount : 0,
        held,
        flashes: Gate.n,
        lowPower: lowPower(),
      }),
    };
  } catch (e) {
    try {
      const n = document.getElementById('fx-intro');
      n && n.remove();
      document.documentElement.classList.remove('fx-intro-on', 'fx-intro-go');
    } catch (_) {}
  }
})();
