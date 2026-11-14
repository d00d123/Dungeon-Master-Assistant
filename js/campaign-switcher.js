/* Header campaign switcher and demo banner. Uses window.DMB_CAMP. See docs/ARCHITECTURE.md. */
/* Additive only: never edits app state directly. Everything goes through window.DMB_CAMP
   (list, current, open, openWizard, manage) and is feature-detected, so the page works without it.
   1. Switcher: wraps #subline in a button with a ▾ that opens a paper menu of campaigns.
      app.js keeps writing #subline.textContent on every render; the wrapper is untouched by that.
   2. Demo banner: a paper strip inserted before main.home (so it pushes the live-battle banner
      and the DM screen down instead of overlapping them) while DMB_CAMP.current().isDemo. */
(function () {
  'use strict';
  var D = document;
  var DISMISS_KEY = 'dmb-demo-banner-dismissed';

  function api() {
    var c = window.DMB_CAMP;
    return c && typeof c.list === 'function' && typeof c.current === 'function' ? c : null;
  }
  function call(name, arg) {
    var c = window.DMB_CAMP;
    if (c && typeof c[name] === 'function') {
      try {
        return c[name](arg);
      } catch (err) {
        console.warn('DMB_CAMP.' + name + ' failed', err);
      }
    }
  }
  function cur() {
    var c = api();
    try {
      return (c && c.current()) || null;
    } catch (err) {
      return null;
    }
  }
  function list() {
    var c = api();
    try {
      var l = c && c.list();
      return Array.isArray(l) ? l : [];
    } catch (err) {
      return [];
    }
  }
  function el(tag, cls, text) {
    var e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- 1. header switcher ---------- */
  var btn = null,
    menu = null;

  function ensureButton() {
    var sub = D.getElementById('subline');
    if (!sub || !api()) return;
    if (btn && btn.isConnected && btn.contains(sub)) return;
    btn = el('button', 'csw-btn');
    btn.type = 'button';
    btn.id = 'campSwitch';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'campMenu');
    btn.title = 'Switch campaign';
    sub.parentNode.insertBefore(btn, sub);
    btn.appendChild(sub);
    btn.insertAdjacentHTML(
      'beforeend',
      '<svg class="csw-caret" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
    btn.addEventListener('click', function () {
      if (isOpen()) closeMenu(false);
      else openMenu('current');
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openMenu(e.key === 'ArrowUp' ? 'last' : 'first');
      }
    });
    labelButton();
  }
  function labelButton() {
    if (!btn) return;
    var sub = D.getElementById('subline');
    btn.setAttribute('aria-label', 'Campaign: ' + ((sub && sub.textContent) || '') + '. Switch campaign');
    btn.title = ((sub && sub.textContent) || '') + ' (switch campaign)';
  }

  function isOpen() {
    return !!(menu && !menu.hidden);
  }
  function items() {
    return menu ? Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]')) : [];
  }
  function focusItem(i) {
    var it = items();
    if (!it.length) return;
    it[(i + it.length) % it.length].focus();
  }

  function buildMenu() {
    if (!menu) {
      menu = el('div', 'csw-menu');
      menu.id = 'campMenu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      menu.addEventListener('keydown', onMenuKey);
      menu.addEventListener('click', onMenuClick);
      D.body.appendChild(menu);
    }
    menu.setAttribute('aria-label', 'Campaigns');
    menu.textContent = '';
    var c = cur() || {};
    var l = list();
    var head = el('div', 'csw-head', 'Campaigns');
    head.setAttribute('role', 'presentation');
    menu.appendChild(head);
    l.forEach(function (x) {
      var on = x.current || (c.id != null && x.id === c.id);
      var b = el('button', 'csw-item csw-camp' + (on ? ' is-current' : ''));
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      b.dataset.cid = String(x.id);
      if (on) b.setAttribute('aria-current', 'true');
      var tick = el('span', 'csw-tick', on ? '✓' : '');
      tick.setAttribute('aria-hidden', 'true');
      b.appendChild(tick);
      b.appendChild(el('span', 'csw-name', x.name || 'Untitled campaign'));
      if (on) b.appendChild(el('span', 'csw-sr', ' (current)'));
      menu.appendChild(b);
    });
    var hr = el('div', 'csw-sep');
    hr.setAttribute('role', 'separator');
    menu.appendChild(hr);
    var nw = el('button', 'csw-item csw-act', '+ New campaign');
    nw.type = 'button';
    nw.setAttribute('role', 'menuitem');
    nw.tabIndex = -1;
    nw.dataset.act = 'new';
    menu.appendChild(nw);
    var mg = el('button', 'csw-item csw-act', 'Manage campaigns…');
    mg.type = 'button';
    mg.setAttribute('role', 'menuitem');
    mg.tabIndex = -1;
    mg.dataset.act = 'manage';
    menu.appendChild(mg);
  }

  function place() {
    if (!menu || !btn) return;
    var r = btn.getBoundingClientRect(),
      vw = D.documentElement.clientWidth,
      w = Math.min(320, vw - 16);
    menu.style.width = w + 'px';
    var left = Math.max(8, Math.min(r.left, vw - w - 8));
    menu.style.left = left + window.scrollX + 'px';
    menu.style.top = r.bottom + 6 + window.scrollY + 'px';
  }

  function openMenu(where) {
    ensureButton();
    if (!btn) return;
    buildMenu();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place();
    var it = items();
    if (where === 'last') focusItem(it.length - 1);
    else if (where === 'current') {
      var i = it.findIndex(function (b) {
        return b.classList.contains('is-current');
      });
      focusItem(i < 0 ? 0 : i);
    } else focusItem(0);
    D.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', place);
  }
  function closeMenu(refocus) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    D.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', place);
    if (refocus && btn && btn.isConnected) btn.focus();
  }
  function onOutside(e) {
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
    closeMenu(false);
  }
  function onMenuKey(e) {
    var it = items(),
      i = it.indexOf(D.activeElement);
    var k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      e.preventDefault();
      focusItem(k === 'Home' ? 0 : k === 'End' ? -1 : i + (k === 'ArrowDown' ? 1 : -1));
    } else if (k === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (k === 'Tab') {
      closeMenu(false);
      return;
    } else return;
    e.stopPropagation(); // keep the app's Escape (closes sheets) and shortcut keys out of the menu
  }
  function onMenuClick(e) {
    var b = e.target.closest && e.target.closest('.csw-item');
    if (!b) return;
    closeMenu(true);
    if (b.dataset.act === 'new') call('openWizard', { source: 'header' });
    else if (b.dataset.act === 'manage') call('manage');
    else if (b.dataset.cid != null && !b.classList.contains('is-current')) {
      var x = list().find(function (c) {
        return String(c.id) === b.dataset.cid;
      });
      call('open', x ? x.id : b.dataset.cid);
    }
  }

  /* ---------- 2. demo banner ---------- */
  var banner = null;

  function dismissed() {
    try {
      var v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (err) {
      return {};
    }
  }
  function dismiss(id) {
    var v = dismissed();
    v[String(id)] = Date.now();
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(v));
    } catch (err) {}
  }
  function buildBanner() {
    banner = el('section', 'csw-demo');
    banner.id = 'demoBanner';
    banner.setAttribute('aria-label', 'Demo campaign');
    banner.hidden = true;
    var p = el('p', 'csw-demo-txt');
    p.appendChild(el('b', null, 'You’re exploring the demo campaign.'));
    p.appendChild(el('span', null, ' Everything here is example data.'));
    banner.appendChild(p);
    var acts = el('div', 'csw-demo-acts');
    var go = el('button', 'btn sm pri', 'Start your own campaign');
    go.type = 'button';
    go.id = 'demoStart';
    go.addEventListener('click', function () {
      call('openWizard', { source: 'banner' });
    });
    var keep = el('button', 'btn sm ghost', 'Keep exploring');
    keep.type = 'button';
    keep.id = 'demoKeep';
    keep.addEventListener('click', function () {
      var c = cur();
      dismiss(c && c.id != null ? c.id : '');
      banner.hidden = true;
      if (btn && btn.isConnected) btn.focus();
    });
    acts.appendChild(go);
    acts.appendChild(keep);
    banner.appendChild(acts);
  }
  function syncBanner() {
    var home = D.querySelector('main.home');
    var c = cur();
    var show = !!(c && c.isDemo && !dismissed()[String(c.id != null ? c.id : '')]);
    if (!show && !banner) return;
    if (!banner) buildBanner();
    if (home && banner.nextElementSibling !== home) home.parentNode.insertBefore(banner, home);
    banner.hidden = !show;
  }

  /* ---------- wiring ---------- */
  var queued = false;
  function refresh() {
    queued = false;
    ensureButton();
    labelButton();
    syncBanner();
    if (isOpen()) {
      var f = D.activeElement && D.activeElement.dataset ? D.activeElement.dataset : {};
      buildMenu();
      place();
      var it = items(),
        j = it.findIndex(function (b) {
          return (f.cid != null && b.dataset.cid === f.cid) || (f.act != null && b.dataset.act === f.act);
        });
      focusItem(j < 0 ? 0 : j);
    }
  }
  function queue() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(refresh);
  }
  function init() {
    refresh();
    window.addEventListener('dmb:campaigns', queue);
    /* app.js rewrites #subline on every render; follow it (and re-wrap if the header is ever rebuilt) */
    var hdr = D.querySelector('header.top') || D.body;
    new MutationObserver(queue).observe(hdr, { childList: true, subtree: true, characterData: true });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init);
  else init();
})();
