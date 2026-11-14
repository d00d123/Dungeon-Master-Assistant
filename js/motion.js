/* Motion layer: plays short Web Animations when the app redraws regions (enter/exit/HP flash).
   Depends on: the DOM rendered by js/app.js. Deferred, after app.js. */
/* Visual overhaul motion layer.
   The board redraws whole regions with innerHTML, so CSS transitions never get
   an old state to start from. This script watches those redraws with one
   MutationObserver, reads the old values off the nodes that were removed, and
   plays short Web Animations on the new nodes. It only ever animates transform
   and opacity (plus a colour flash on a changed HP number), never changes board
   state, text, ids or classes the app relies on, and does nothing at all when
   the device asks for reduced motion. Exits play inside a closed shadow root,
   so the old node can never be found by a query or receive a click. */
(function () {
  'use strict';
  if (!window.MutationObserver || !Element.prototype.animate) return;
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => RM.matches || document.hidden;
  const OUT = 'cubic-bezier(.16,1,.3,1)',
    IN = 'cubic-bezier(.4,0,1,1)',
    POP = 'cubic-bezier(.34,1.36,.64,1)';
  const play = (el, kf, o) => {
    try {
      return el.animate(kf, Object.assign({ duration: 220, easing: OUT }, o));
    } catch (e) {
      return null;
    }
  };
  const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pctOf = (i) => {
    const w = i && i.style.width;
    return w && w.endsWith('%') ? parseFloat(w) : null;
  };
  const txt = (el) => (el ? el.textContent.trim() : '');
  const now = () => performance.now();

  /* ---------- HP bars: heals grow, damage leaves a trail that drains ---------- */
  const BAR_MEMO = new Map(); // key -> {kind,from,to,start,dur,delay}
  const TRAIL = { delay: 200, dur: 520 },
    GROW = { dur: 440 };
  function barAnim(bar, key, from, to) {
    const i = bar.querySelector('i');
    if (!i) return;
    const t = now();
    let m = BAR_MEMO.get(key);
    if (m && t - m.start >= m.delay + m.dur) {
      BAR_MEMO.delete(key);
      m = null;
    }
    if (from == null || to == null) return;
    if (from === to) {
      if (m && m.to === to) drawBar(bar, i, m, t - m.start);
      return;
    }
    if (to < from) {
      const origin = m && m.kind === 'trail' && m.from > from ? m.from : from;
      m = { kind: 'trail', from: origin, to, start: t, delay: TRAIL.delay, dur: TRAIL.dur };
    } else m = { kind: 'grow', from, to, start: t, delay: 0, dur: GROW.dur };
    BAR_MEMO.set(key, m);
    drawBar(bar, i, m, 0);
  }
  function drawBar(bar, i, m, elapsed) {
    if (m.kind === 'grow') {
      if (m.to <= 0) return;
      const a = play(i, [{ transform: `scaleX(${Math.max(0, m.from / m.to)})` }, { transform: 'scaleX(1)' }], {
        duration: m.dur,
        easing: OUT,
      });
      if (a) {
        i.style.transformOrigin = 'left center';
        a.currentTime = elapsed;
      }
      return;
    }
    if (m.from <= 0) return;
    const tr = document.createElement('span');
    tr.className = 'vo-trail';
    tr.setAttribute('aria-hidden', 'true');
    tr.style.width = m.from + '%';
    bar.appendChild(tr);
    const a = play(
      tr,
      [
        { transform: 'scaleX(1)', opacity: 1 },
        { transform: `scaleX(${m.to / m.from})`, opacity: 1, offset: 0.85 },
        { transform: `scaleX(${m.to / m.from})`, opacity: 0 },
      ],
      { duration: m.dur, delay: m.delay, easing: OUT, fill: 'both' }
    );
    if (!a) {
      tr.remove();
      return;
    }
    a.currentTime = elapsed;
    a.onfinish = a.oncancel = () => tr.remove();
  }
  function numFlash(b, from, to) {
    if (!b || from === to || isNaN(from) || isNaN(to)) return;
    const c = tok(to < from ? '--crit' : '--good');
    if (!c) return;
    play(
      b,
      [
        { color: c, transform: 'scale(1.14)' },
        { color: getComputedStyle(b).color, transform: 'scale(1)' },
      ],
      { duration: 520, easing: POP }
    );
  }
  // rows: [{key,el}] old and new; reads bar % and the bold HP number
  function hpContinuity(oldRows, newRows, prefix) {
    const old = new Map(oldRows.map((r) => [r.key, r.el]));
    for (const r of newRows) {
      const o = old.get(r.key);
      if (!o) continue;
      const ob = o.querySelector('.bar'),
        nb = r.el.querySelector('.bar');
      if (ob && nb) barAnim(nb, prefix + r.key, pctOf(ob.querySelector('i')), pctOf(nb.querySelector('i')));
      const on = o.querySelector('.v b'),
        nn = r.el.querySelector('.v b');
      if (on && nn) numFlash(nn, +txt(on), +txt(nn));
    }
  }
  function enter(els, stagger) {
    els.forEach((el, k) =>
      play(
        el,
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 280, delay: (stagger || 0) * k, fill: 'backwards' }
      )
    );
  }

  /* ---------- a highlight that travels between two items ---------- */
  function slideMark(box, fromEl, toEl, cls, moving) {
    if (!box || !fromEl || !toEl || fromEl === toEl) return;
    const b = box.getBoundingClientRect(),
      f = fromEl.getBoundingClientRect(),
      t = toEl.getBoundingClientRect();
    if (!t.width || !t.height || !f.height) return;
    const ox = b.left + box.clientLeft - box.scrollLeft,
      oy = b.top + box.clientTop - box.scrollTop;
    const mk = document.createElement('i');
    mk.className = cls;
    mk.setAttribute('aria-hidden', 'true');
    Object.assign(mk.style, {
      left: t.left - ox + 'px',
      top: t.top - oy + 'px',
      width: t.width + 'px',
      height: t.height + 'px',
    });
    if (cls === 'vo-turnmark') {
      mk.style.left = '0';
      mk.style.right = '0';
      mk.style.width = 'auto';
    }
    box.appendChild(mk);
    box.classList.add(moving);
    const sx = cls === 'vo-turnmark' ? 1 : f.width / t.width;
    const a = play(
      mk,
      [
        {
          transform: `translate(${cls === 'vo-turnmark' ? 0 : f.left - t.left}px,${f.top - t.top}px) scale(${sx},${f.height / t.height})`,
        },
        { transform: 'none' },
      ],
      { duration: 340, easing: OUT }
    );
    const done = () => {
      mk.remove();
      box.classList.remove(moving);
    };
    if (a) {
      a.onfinish = a.oncancel = done;
    } else done();
  }

  /* ---------- exits: the removed node fades out in an inert shadow host ---------- */
  let SHEET = null,
    SHEET_N = -1,
    GHOST_LINKS = [];
  function ghostSheet() {
    const list = [...document.styleSheets];
    if (SHEET && SHEET_N === list.length) return SHEET;
    // Copy rules when readable; sheets loaded from file:// are opaque to cssRules, so their <link>s are cloned into the ghost instead.
    let css = '';
    GHOST_LINKS = [];
    for (const s of list) {
      const o = s.ownerNode;
      if (o && o.tagName !== 'STYLE' && o.tagName !== 'LINK') continue;
      try {
        let t = '';
        for (const r of s.cssRules) t += r.cssText + '\n';
        css += t;
      } catch (e) {
        if (o && o.tagName === 'LINK') GHOST_LINKS.push(o);
      }
    }
    css += '*,*::before,*::after{animation:none!important;transition:none!important}';
    try {
      SHEET = new CSSStyleSheet();
      SHEET.replaceSync(css);
    } catch (e) {
      SHEET = css;
    }
    SHEET_N = list.length;
    return SHEET;
  }
  function ghost(node, z, parts) {
    if (still() || !node || node.nodeType !== 1) return;
    const host = document.createElement('vo-ghost');
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.style.zIndex = z;
    const sr = host.attachShadow({ mode: 'closed' }),
      sh = ghostSheet();
    GHOST_LINKS.forEach((l) => sr.appendChild(l.cloneNode()));
    if (typeof sh === 'string') {
      const st = document.createElement('style');
      st.textContent = sh;
      sr.appendChild(st);
    } else sr.adoptedStyleSheets = [sh];
    sr.appendChild(node);
    document.body.appendChild(host);
    const kill = () => host.remove();
    setTimeout(kill, 700);
    const a = play(parts.fade || node, [{ opacity: 1 }, { opacity: 0 }], {
      duration: parts.dur || 170,
      easing: IN,
      fill: 'forwards',
    });
    if (parts.move) {
      const m = parts.move(node);
      m && play(m[0], m[1], { duration: parts.dur || 170, easing: IN, fill: 'forwards' });
    }
    if (a) a.onfinish = kill;
  }
  const sheetOut = (n) => [
    n.querySelector('.sheet,.mc'),
    [{ transform: 'none' }, { transform: 'translateY(6px) scale(.985)' }],
  ];

  /* ---------- region handlers ---------- */
  const cardRows = (root) =>
    [...(root.querySelectorAll ? root.querySelectorAll('.card[data-pid]') : [])].map((el) => ({
      key: el.dataset.pid,
      el,
    }));
  function party(oldNodes, box) {
    const oldCards = oldNodes
      .filter((n) => n.nodeType === 1 && n.matches('.card[data-pid]'))
      .map((el) => ({ key: el.dataset.pid, el }));
    const nowCards = cardRows(box);
    if (!oldCards.length) {
      return;
    }
    hpContinuity(oldCards, nowCards, 'p:');
    const had = new Set(oldCards.map((r) => r.key));
    enter(nowCards.filter((r) => !had.has(r.key)).map((r) => r.el));
  }
  const rowName = (el) => txt(el.querySelector('.who strong,.who .mlink,strong'));
  const keyed = (rows) => {
    const seen = {};
    return rows.map((el) => {
      const n = rowName(el);
      seen[n] = (seen[n] || 0) + 1;
      return { key: n + '#' + seen[n], el };
    });
  };
  function turnOrder(oldBox, newBox, rowSel, mark) {
    if (!oldBox || !newBox) return;
    const o = keyed([...oldBox.querySelectorAll(':scope>' + rowSel)]),
      n = keyed([...newBox.querySelectorAll(':scope>' + rowSel)]);
    hpContinuity(o, n, 'c:');
    const oc = o.find((r) => r.el.classList.contains('cur')),
      nc = n.find((r) => r.el.classList.contains('cur'));
    if (oc && nc && oc.key !== nc.key) {
      const from = n.find((r) => r.key === oc.key);
      from && slideMark(newBox, from.el, nc.el, 'vo-turnmark', 'vo-moving');
    }
    if (o.length) {
      const had = new Set(o.map((r) => r.key));
      enter(n.filter((r) => !had.has(r.key)).map((r) => r.el));
    }
  }
  const sheetKey = (ov) => {
    const s = ov && ov.querySelector('.sheet');
    if (!s) return null;
    return {
      sec: txt(s.querySelector('.side .eyebrow')),
      sub: (s.querySelector('.tab[aria-selected="true"]') || { dataset: {} }).dataset.sub,
      label: s.getAttribute('aria-label'),
    };
  };
  function overlay(oldNodes, box) {
    const oldOv = oldNodes.find((n) => n.nodeType === 1 && n.classList.contains('ov')),
      newOv = box.querySelector(':scope>.ov');
    if (oldOv && !newOv) {
      ghost(oldOv, 20, { move: sheetOut });
      return;
    }
    if (!oldOv || !newOv || newOv.querySelector('.sheet.pop')) return;
    const a = sheetKey(oldOv),
      b = sheetKey(newOv);
    if (!a || !b) return;
    if (a.sec !== b.sec || a.label !== b.label) {
      const m = newOv.querySelector('.main');
      m &&
        play(
          m,
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 240 }
        );
      return;
    }
    if (a.sub !== b.sub) {
      const side = newOv.querySelector('.side'),
        from = side && side.querySelector(`.tab[data-sub="${CSS.escape(a.sub || '')}"]`),
        to = side && side.querySelector('.tab[aria-selected="true"]');
      slideMark(side, from, to, 'vo-tabmark', 'vo-sliding');
      const m = newOv.querySelector('.main');
      m &&
        play(
          m,
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 240 }
        );
      return;
    }
    turnOrder(oldOv.querySelector('.turns'), newOv.querySelector('.turns'), '.cb');
  }
  function bodyLevel(oldNodes) {
    for (const n of oldNodes) {
      if (n.nodeType !== 1 || n.isConnected) continue;
      if (n.classList.contains('mc-ov') && !document.querySelector('.mc-ov')) ghost(n, 40, { move: sheetOut });
      else if (n.classList.contains('toast') && !document.querySelector('.toast'))
        ghost(n, 60, {
          dur: 200,
          move: (x) => [x, [{ transform: 'translate(-50%,0)' }, { transform: 'translate(-50%,6px) scale(.98)' }]],
        });
    }
  }

  /* ---------- one observer for the whole page ---------- */
  function onMut(recs) {
    if (still()) return;
    const first = new Map();
    for (const r of recs) {
      if (r.type !== 'childList') continue;
      const t = r.target;
      if (t === document.body || t.id === 'party' || t.id === 'overlay') {
        if (!first.has(t)) first.set(t, []);
        first.get(t).push(...r.removedNodes);
      }
    }
    for (const [t, old] of first) {
      try {
        if (t === document.body) bodyLevel(old);
        else if (t.id === 'party') party(old, t);
        else if (t.id === 'overlay') overlay(old, t);
      } catch (e) {
        /* motion is decoration: never let it break the board */
      }
    }
  }
  let armed = false;
  function start() {
    new MutationObserver(onMut).observe(document.body, { childList: true, subtree: true });
    // theme switch: brief colour cross-fade, only for changes after load
    new MutationObserver(() => {
      if (!armed || still()) return;
      const h = document.documentElement;
      h.classList.add('vo-theming');
      clearTimeout(start.t);
      start.t = setTimeout(() => h.classList.remove('vo-theming'), 280);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // first paint: the party and the DM seat settle in once
    requestAnimationFrame(() => {
      if (!still()) {
        const c = [...document.querySelectorAll('#party>*')];
        enter(c, 35);
        const d = document.getElementById('dmSeat');
        d && enter([d]);
      }
      setTimeout(() => {
        armed = true;
      }, 400);
    });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
