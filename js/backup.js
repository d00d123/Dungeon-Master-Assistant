/* Data safety helpers: backup reminder, save status line, recovery dialog, persisted-undo planning.
   window.DMB_BACKUP. Loaded last (defer), so it runs after app.js has booted. app.js keeps the
   storage writes and the save hold (they are needed at boot); this file holds the pure logic and
   the UI pieces, and talks to the app only through the `host` object app.js passes in.
   Depends on: nothing at load time. Uses localStorage key dm-board-backup-prefs (global, see storage-shim.js). */
(function () {
  'use strict';
  const PREFS_KEY = 'dm-board-backup-prefs';
  const DAY = 864e5;
  const DEF = { v: 1, remind: true, days: 7, keepUndo: true };
  const DAYS = [3, 7, 14, 30];

  /* ---------- pure helpers ---------- */
  const isQuota = (e) =>
    !!e &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  // FNV-1a, 32 bit
  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }
  function prefs() {
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(PREFS_KEY));
    } catch (e) {}
    const o = Object.assign({}, DEF);
    if (p && typeof p === 'object') {
      if (typeof p.remind === 'boolean') o.remind = p.remind;
      if (DAYS.includes(+p.days)) o.days = +p.days;
      if (typeof p.keepUndo === 'boolean') o.keepUndo = p.keepUndo;
    }
    return o;
  }
  function setPrefs(patch) {
    const o = Object.assign(prefs(), patch);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(o));
    } catch (e) {}
    return o;
  }
  // the snooze is an ms timestamp; older boards stored a YYYY-MM-DD date meaning "not today"
  function snoozeUntil(raw) {
    if (!raw) return 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-').map(Number);
      return new Date(y, m - 1, d + 1).getTime();
    }
    const n = +raw;
    return Number.isFinite(n) ? n : 0;
  }
  function rel(at, now, fmtAt) {
    const s = Math.max(0, (now || Date.now()) - at) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return fmtAt ? fmtAt(at) : new Date(at).toLocaleString();
  }
  /* Which undo steps to keep across a reload: the newest ones that fit in n entries and maxBytes.
     list is oldest first. Returns { keep: [...newest that fit, oldest first], tooBig }. */
  function planUndo(list, n, maxBytes) {
    const keep = [];
    let bytes = 0;
    for (let i = list.length - 1; i >= 0 && keep.length < n; i--) {
      const b = list[i].length * 2;
      if (bytes + b > maxBytes) break;
      bytes += b;
      keep.unshift(list[i]);
    }
    return { keep, tooBig: list.length > 0 && list[list.length - 1].length * 2 > maxBytes, bytes };
  }
  const WHY = {
    unreadable: 'The saved data is incomplete or not valid, so it may have been cut short while saving.',
    shape: 'The saved data doesn’t look like a board.',
    dropped: 'Reading it would lose part of the board',
    normalize: 'The board couldn’t be read.',
  };
  function reasonText(reasons) {
    const r = reasons || [];
    if (r.includes('unreadable')) return WHY.unreadable;
    if (r.includes('shape')) return WHY.shape;
    const parts = r.filter((x) => !['dropped', 'normalize'].includes(x) && !x.startsWith('dropped:'));
    const lost = r.filter((x) => x.startsWith('dropped:')).map((x) => x.slice(8));
    const out = [];
    if (parts.length) out.push(`Some parts are the wrong shape (${parts.join(', ')}).`);
    if (lost.length) out.push(`${WHY.dropped} (${lost.join(', ')}).`);
    if (r.includes('normalize')) out.push(WHY.normalize);
    return out.join(' ') || WHY.normalize;
  }

  /* ---------- backup reminder ---------- */
  let remindGone = false; // dismissed once: not again in this page load
  function remind(h, reason) {
    const p = prefs();
    const S = h.S();
    if (!p.remind || remindGone || !S || S.example || !h.hasBoard()) return false;
    const SAFE = h.SAFE;
    const healthy =
      SAFE.file && !SAFE.filePaused && !SAFE.fileErr && SAFE.fileAt && Date.now() - SAFE.fileAt < p.days * DAY;
    if (healthy) return false;
    let raw = '';
    try {
      raw = localStorage.getItem(h.KEY + '-nag');
    } catch (e) {}
    if (Date.now() < snoozeUntil(raw)) return false;
    const age = h.backupAge();
    if (reason === 'wrap') {
      if (S.dm.lastBackup === h.today()) return false;
    } else if (age != null && age < p.days) return false;
    const done = () => {
      remindGone = true;
      h.clearBar('remind');
    };
    const text =
      reason === 'wrap'
        ? `Session ${Math.max(1, (+S.dm.session || 2) - 1)} is saved in this browser. Save a backup file too?` +
          (h.FS_OK ? '' : ' This browser can’t keep a backup file updated, so a downloaded backup is the safe copy.')
        : age == null
          ? 'You haven’t saved a backup of this campaign yet.'
          : `Last backup was ${age === 1 ? '1 day' : age + ' days'} ago.`;
    h.bar('remind', text, [
      [
        'Save backup now',
        () => {
          h.exportData();
          done();
        },
      ],
      [
        'Remind me later',
        () => {
          try {
            localStorage.setItem(h.KEY + '-nag', String(Date.now() + DAY));
          } catch (e) {}
          done();
        },
      ],
      [
        'Turn off reminders',
        () => {
          setPrefs({ remind: false });
          done();
          h.toast('Backup reminders are off. Turn them back on in Campaign → Data');
        },
      ],
    ]);
    return true;
  }

  /* ---------- save status in the footer ---------- */
  let ssHost = null,
    ssT = 0;
  function statusOf(h) {
    const SAFE = h.SAFE;
    const fileOk = SAFE.file && !SAFE.filePaused && !SAFE.fileErr && SAFE.fileAt;
    if (h.hold()) return ['hold', 'Not saved: choose how to recover your board', ''];
    if (h.stale()) return ['stale', 'Not saved: changed in another tab', ''];
    if (h.full() === 'error') return ['blocked', 'Not saved: this browser blocked storage', ''];
    if (h.full()) return ['full', 'Not saved: browser storage is full', ''];
    if (fileOk)
      return ['file', 'Saved in this browser · Auto-backup on', ' · last saved ' + rel(SAFE.fileAt, 0, h.fmtAt)];
    if (SAFE.file && SAFE.filePaused) return ['paused', 'Saved in this browser · Auto-backup paused (Allow)', ''];
    if (SAFE.file && SAFE.fileErr) return ['failed', 'Saved in this browser · Auto-backup failed', ''];
    const a = h.backupAge();
    return [
      'local',
      'Saved in this browser',
      ' · Last backup ' + (a == null ? 'never' : a === 0 ? 'today' : a === 1 ? '1 day ago' : a + ' days ago'),
    ];
  }
  function mountStatus(h) {
    ssHost = h;
    const f = document.querySelector('footer.foot');
    if (!f || document.getElementById('saveState')) return;
    const old = [...f.children].find((x) => /^Saved in this browser/.test(x.textContent || ''));
    const el = document.createElement('span');
    el.id = 'saveState';
    el.innerHTML =
      '<button type="button" class="lnk" id="ssOpen" title="Backups and restore points (Campaign → Data)"><span role="status" id="ssCat"></span><span aria-hidden="true" id="ssRel"></span></button>';
    if (old) old.replaceWith(el);
    else f.insertBefore(el, f.children[1] || null);
    el.querySelector('#ssOpen').onclick = () => h.openData();
    drawStatus(true);
    setInterval(() => drawStatus(), 6e4);
  }
  function drawStatus(now) {
    if (!ssHost) return;
    clearTimeout(ssT);
    if (!now) {
      ssT = setTimeout(() => drawStatus(true), 150);
      return;
    }
    const el = document.getElementById('saveState');
    if (!el) return;
    let st;
    try {
      st = statusOf(ssHost);
    } catch (e) {
      return;
    }
    const [cat, text, r] = st;
    el.dataset.state = cat;
    const c = el.querySelector('#ssCat'),
      rr = el.querySelector('#ssRel');
    if (c.textContent !== text) c.textContent = text;
    if (rr.textContent !== r) rr.textContent = r;
  }

  /* ---------- recovery dialog ---------- */
  /* d: { reasons, lkg:{at}|null, snaps:[{at}], file:{name, at}|null }
     h: popup, popHead, esc, fmtAt, armDelete, and the actions restoreLKG, restoreSnap(at), restoreFile, loadFile,
        downloadDamaged, startFresh, later */
  function recovery(h, d) {
    const esc = h.esc;
    const opts = [];
    const newestSnap = d.snaps[0] ? d.snaps[0].at : 0;
    if (d.lkg && d.lkg.at > newestSnap)
      opts.push([
        'lkg',
        `Restore last good copy, ${h.fmtAt(d.lkg.at)}`,
        'pri',
        'The board as it was the last time it saved properly.',
      ]);
    d.snaps
      .slice(0, 3)
      .forEach((s, i) =>
        opts.push(['snap:' + s.at, `Restore point ${h.fmtAt(s.at)}`, !opts.length && !i ? 'pri' : '', s.label || ''])
      );
    if (d.file)
      opts.push([
        'file',
        `Restore from backup file ${d.file.name}${d.file.at ? `, saved ${h.fmtAt(d.file.at)}` : ''}`,
        opts.length ? '' : 'pri',
        '',
      ]);
    opts.push(['load', 'Load a backup file…', opts.length ? '' : 'pri', 'A .json file you saved with Save backup.']);
    opts.push([
      'dl',
      'Download the damaged data',
      'ghost',
      'Keeps a copy you can send for help. You still choose an option here.',
    ]);
    opts.push(['fresh', 'Start fresh', 'ghost', 'An empty board. The damaged copies stay in Campaign → Data.']);
    const el = h.popup(
      'Your saved board couldn’t be read',
      h.popHead(
        'Your saved board couldn’t be read',
        esc(reasonText(d.reasons)) + ' Nothing will be saved until you choose.'
      ) +
        `<div class="sflist" id="recOpts">${opts
          .map(
            ([k, label, cls, sub]) =>
              `<div class="sfrow"><div class="sfwhat"><button class="btn sm${cls ? ' ' + cls : ''}" type="button" data-rec="${esc(k)}">${esc(label)}</button>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`
          )
          .join('')}</div><p class="sfmuted" id="recMsg" role="status"></p>`
    );
    el.id = 'mcard';
    el.dataset.recovery = '1';
    let chose = false;
    const act = async (k, b) => {
      const msg = el.querySelector('#recMsg');
      b.disabled = true;
      let ok = false;
      try {
        if (k === 'lkg') ok = await h.restoreLKG();
        else if (k.startsWith('snap:')) ok = await h.restoreSnap(+k.slice(5));
        else if (k === 'file') ok = await h.restoreFile();
        else if (k === 'load') {
          h.loadFile();
          ok = false;
        } else if (k === 'dl') h.downloadDamaged();
        else if (k === 'fresh') ok = await h.startFresh();
      } catch (e) {
        if (msg) msg.textContent = 'That didn’t work. Try another option.';
      }
      b.disabled = false;
      if (ok) {
        chose = true;
        el.remove();
      }
    };
    el.querySelectorAll('[data-rec]').forEach((b) => {
      const k = b.dataset.rec;
      if (k === 'fresh') h.armDelete(b, () => act(k, b), 'Click again to start with an empty board');
      else b.onclick = () => act(k, b);
    });
    const first = el.querySelector('[data-rec]');
    first && first.focus();
    const mo = new MutationObserver(() => {
      if (el.isConnected) return;
      mo.disconnect();
      if (!chose && h.holding()) h.later();
    });
    mo.observe(el.parentNode || document.body, { childList: true });
    return el;
  }

  window.DMB_BACKUP = {
    PREFS_KEY,
    DAYS,
    isQuota,
    fnv,
    prefs,
    setPrefs,
    snoozeUntil,
    rel,
    planUndo,
    reasonText,
    remind,
    mountStatus,
    drawStatus,
    statusOf,
    recovery,
  };
})();
