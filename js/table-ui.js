/* Table UI helpers: (1) around-the-table DOM order and phone focus snapping, (2) the Time & light drawer.
   Depends on: #dmSeat rendered by js/app.js, window.__fx (js/effects.js, optional). Deferred, after app.js. */
/* Around-the-table layout helper (Dungeon mood only). 1) DOM order = visual order: the DM screen
   (aside.side-col) is moved before the party column while the mood is Dungeon, restored otherwise.
   2) Phone: focusing a control in a peeking DM-screen leaf snaps that leaf into view.
   Decoration only; never touches app data. */
(function () {
  try {
    const h = document.documentElement,
      home = document.querySelector('main.home');
    if (!home) return;
    const side = home.querySelector(':scope>.side-col'),
      party = home.querySelector(':scope>.partycol');
    if (!side || !party) return;
    const dg = () => h.getAttribute('data-mood') === 'dungeon';
    const order = () => {
      try {
        if (dg()) {
          if (side.nextElementSibling !== party) home.insertBefore(side, party);
        } else if (party.nextElementSibling !== side) home.insertBefore(party, side);
      } catch (e) {}
    };
    order();
    new MutationObserver(order).observe(h, { attributes: true, attributeFilter: ['data-mood'] });
    const seat = document.getElementById('dmSeat');
    if (seat)
      seat.addEventListener('focusin', (e) => {
        try {
          if (innerWidth < 768 && dg()) {
            const p = e.target.closest && e.target.closest('#dmSeat>.panel');
            if (p) p.scrollIntoView({ inline: 'start', block: 'nearest' });
          }
        } catch (_) {}
      });
  } catch (e) {}
})();

/* Time & light drawer (see #tl-css). Additive only: it inserts a button into the Session leaf and a header into #dmSeat
   after each app render, toggles .tl-open on #dmSeat, and never calls or replaces app code. */
(function () {
  try {
    const D = document,
      H = D.documentElement,
      seat = D.getElementById('dmSeat');
    if (!seat) return;
    const KD = 'key' + 'down',
      FOC = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    const ICON =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/></svg>';
    let open = false,
      lastId = null,
      scrim = null;
    const isOpen = () => seat.classList.contains('tl-open');
    const sync = () => {
      try {
        window.__fx && __fx.sync && __fx.sync();
      } catch (e) {}
    };
    const nowTxt = () => {
      const b = seat.querySelector('#clk b');
      return b ? b.textContent.trim() : '';
    };
    function ensure() {
      try {
        const p1 = seat.querySelector(':scope>.panel');
        if (p1 && !p1.querySelector('#tlBtn')) {
          const r = D.createElement('div');
          r.className = 'tl-row tl-own';
          r.innerHTML = `<button type="button" class="btn sm tl-btn" id="tlBtn" aria-haspopup="dialog" aria-controls="dmSeat" aria-expanded="false" title="Clock, travel, rests, weather, lights and dungeon turns">${ICON}<span>Time &amp; light</span><small></small></button>`;
          p1.appendChild(r);
          r.firstElementChild.addEventListener('click', () => toggle(true));
        }
        const b = D.getElementById('tlBtn');
        if (b) {
          b.setAttribute('aria-expanded', String(open));
          const sm = b.querySelector('small'),
            t = nowTxt();
          if (sm && sm.textContent !== t) sm.textContent = t;
        }
        if (!seat.querySelector(':scope>.tl-head')) {
          const h = D.createElement('div');
          h.className = 'tl-head tl-own';
          h.innerHTML =
            '<h2 id="tlTitle">Time &amp; light</h2><button type="button" class="tl-x" aria-label="Close Time and light">×</button>';
          seat.appendChild(h);
          h.querySelector('.tl-x').addEventListener('click', () => toggle(false));
        }
        if (open) refocus();
      } catch (e) {}
    }
    function refocus() {
      const a = D.activeElement;
      if (a && a !== D.body && a !== H) return;
      if (D.getElementById('mcard') || D.querySelector('#overlay>.ov')) return;
      let t = null;
      try {
        t = lastId && seat.querySelector(lastId);
      } catch (e) {}
      t = t || seat.querySelector('.tl-x');
      if (t && seat.contains(t) && t.getClientRects().length)
        try {
          t.focus({ preventScroll: true });
        } catch (e) {}
    }
    function toggle(v) {
      try {
        if (v === open) return;
        open = v;
        const side = seat.parentElement;
        if (v) {
          if (side) side.style.minHeight = side.offsetHeight + 'px';
          if (!scrim) {
            scrim = D.createElement('div');
            scrim.id = 'tlScrim';
            scrim.setAttribute('aria-hidden', 'true');
            scrim.addEventListener('click', () => toggle(false));
          }
          /* main.home isolates its stacking context, so the scrim sits beside #dmSeat (same context, one layer below it) */
          if (scrim.nextElementSibling !== seat) seat.before(scrim);
          seat.classList.add('tl-open');
          H.classList.add('tl-on');
          seat.setAttribute('role', 'dialog');
          seat.setAttribute('aria-modal', 'true');
          seat.setAttribute('aria-labelledby', 'tlTitle');
          ensure();
          seat.scrollTop = 0;
          const x = seat.querySelector('.tl-x');
          x && x.focus({ preventScroll: true });
        } else {
          seat.classList.remove('tl-open');
          H.classList.remove('tl-on');
          ['role', 'aria-modal', 'aria-labelledby'].forEach((a) => seat.removeAttribute(a));
          if (side) side.style.minHeight = '';
          lastId = null;
          ensure();
          const b = D.getElementById('tlBtn');
          b && b.focus({ preventScroll: true });
        }
        const b = D.getElementById('tlBtn');
        b && b.setAttribute('aria-expanded', String(open));
        sync();
      } catch (e) {}
    }
    new MutationObserver(ensure).observe(seat, { childList: true });
    ensure();
    /* remember the focused control (by id or its data-* attribute) so focus survives the app re-rendering the panels */
    const key = (n) => {
      if (n.id) return '#' + CSS.escape(n.id);
      const a = [...n.attributes].find((a) => a.name.startsWith('data-'));
      return a ? `${n.tagName.toLowerCase()}[${a.name}="${CSS.escape(a.value)}"]` : null;
    };
    seat.addEventListener('focusin', (e) => {
      if (open && !e.target.closest('.tl-head')) lastId = key(e.target);
    });
    D.addEventListener(
      KD,
      (ev) => {
        try {
          if (!open || D.getElementById('fx-intro')) return;
          const k = ev.key;
          if (D.getElementById('mcard') || D.querySelector('#overlay>.ov')) return;
          if (k === 'Escape') {
            ev.preventDefault();
            toggle(false);
            return;
          }
          if (k === 'Tab') {
            const f = [...seat.querySelectorAll(FOC)].filter((n) => n.getClientRects().length);
            if (!f.length) return;
            const i = f.indexOf(D.activeElement);
            if (i < 0) {
              ev.preventDefault();
              f[0].focus();
              return;
            }
            if (!ev.shiftKey && i === f.length - 1) {
              ev.preventDefault();
              f[0].focus();
            } else if (ev.shiftKey && i === 0) {
              ev.preventDefault();
              f[f.length - 1].focus();
            }
          }
        } catch (e) {}
      },
      true
    );
    window.__tl = { open: () => toggle(true), close: () => toggle(false), isOpen };
  } catch (e) {}
})();
