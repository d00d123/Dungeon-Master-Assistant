#!/usr/bin/env node
/* Data safety tests (Playwright, Chromium): recovery from a damaged save, quota errors, the backup
   reminder, the save status line, undo after a reload, auto-backup to a file, and the D&D Beyond box.
   Runs on a tiny localhost server (OPFS for the backup-file mock, and stable storage across reloads).
   Run: node tests/data-safety.js */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(process.env.DMB_ROOT || path.join(__dirname, '..'));
const FILE_URL = 'file://' + path.join(ROOT, 'index.html');
let DEF_URL = FILE_URL;
const results = [];
let failed = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // run a subset: ONLY=6a node tests/data-safety.js
async function step(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    const r = await fn();
    results.push('PASS ' + name + (r ? ' :: ' + String(r).slice(0, 160) : ''));
  } catch (e) {
    failed++;
    results.push('FAIL ' + name + ' :: ' + String(e.message).split('\n')[0]);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m);
}
const KEY = 'dm-board-v1';
const BOARD = {
  dm: { campaign: 'Test campaign', session: 3 },
  players: [
    { id: 'p1', name: 'Ana', maxHp: 20, hp: 20 },
    { id: 'p2', name: 'Bo', maxHp: 15, hp: 15 },
  ],
  notes: [{ id: 'n1', title: 'Secret door', body: 'Behind the altar' }],
};
const GOOD = JSON.stringify(BOARD);

// init script: no intro, seed storage once per context, optional fault injection
function init(seed, extra) {
  return `window.__fxBreak=1;window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));
  try{if(!localStorage.getItem('__seeded')){localStorage.setItem('__seeded','1');${Object.entries(seed || {})
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`)
    .join('')}}}catch(e){}
  ${extra || ''}`;
}
const QUOTA = (name) => `(()=>{const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
  if(sessionStorage.getItem('__full')&&/^dm-board-v1(?!-at)/.test(String(k).replace(/^dm-board~c\\d+~/,'')))throw new DOMException('full','${name}');
  return o.call(this,k,v)}})();`;

async function ctx(browser, { seed, extra, url, dl } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: !!dl });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('request', (r) => {
    if (/dndbeyond/.test(r.url())) errors.push('NETWORK ' + r.url());
  });
  await page.addInitScript(init(seed, extra));
  page.setDefaultTimeout(6000);
  await page.goto(url || DEF_URL);
  await page.waitForTimeout(700);
  return { page, context, errors };
}
const ls = (page, k) => page.evaluate((k) => window.DMC.raw.ls.getItem(k), k);
const lsKeys = (page, pre) => page.evaluate((p) => Object.keys(window.DMC.raw.ls).filter((k) => k.startsWith(p)), pre);
const kv = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const r = indexedDB.open('dm-board-safety');
        r.onsuccess = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('kv')) return ok({});
          const t = d.transaction('kv'),
            st = t.objectStore('kv'),
            out = {};
          const c = st.openCursor();
          c.onsuccess = () => {
            const cur = c.result;
            if (!cur) return ok(out);
            out[cur.key] = typeof cur.value === 'string' ? cur.value.length : cur.value && cur.value.at ? 'obj' : 1;
            cur.continue();
          };
        };
        r.onerror = () => ok({});
      })
  );
const txt = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return e ? e.innerText.replace(/\s+/g, ' ').trim() : '';
  }, sel);

function server() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      r.writeHead(404);
      return r.end();
    }
    r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

(async () => {
  const browser = await chromium.launch();
  // localhost, not file://: headless Chromium sometimes drops localStorage writes across reload() on file://
  // (a renderer swap), which made the reload tests flaky. Set DMB_FILE=1 to run over file:// anyway.
  const srv = await server();
  const base = `http://127.0.0.1:${srv.address().port}/index.html`;
  DEF_URL = process.env.DMB_FILE ? FILE_URL : base;
  const allErr = [];
  const done = async (c) => {
    allErr.push(...c.errors);
    const csp = await c.page.evaluate(() => window.__csp || []).catch(() => []);
    allErr.push(...csp.map((x) => 'CSP ' + x));
    await c.context.close();
  };

  /* ---------- 5. recovery ---------- */
  const SEEDS = [
    ['bad JSON', '{oops'],
    ['array', '[]'],
    ['null', 'null'],
    ['truncated', GOOD.slice(0, Math.floor(GOOD.length / 2))],
    ['wrong types', '{"players":"nope","dm":5}'],
    [
      'notes not a list',
      JSON.stringify({ dm: {}, players: [1, 2, 3, 4, 5].map((i) => ({ id: 'q' + i, name: 'P' + i })), notes: 'x' }),
    ],
  ];
  for (const [name, raw] of SEEDS) {
    await step('5a recovery dialog + hold: ' + name, async () => {
      const c = await ctx(browser, { seed: { [KEY]: raw } });
      const { page } = c;
      await page.waitForSelector('#mcard[data-recovery]');
      const keys = await lsKeys(page, KEY + '-damaged-');
      assert(keys.length === 1 && (await ls(page, keys[0])) === raw, 'damaged copy ' + keys);
      await page.click('#mcard [data-mclose]');
      await page.click('#party [data-hp="-1"]');
      await page.waitForTimeout(2000);
      assert((await ls(page, KEY)) === raw, 'KEY overwritten during hold');
      const st = await page.getAttribute('#saveState', 'data-state');
      assert(st === 'hold', 'status ' + st);
      assert((await page.getAttribute('#safebar', 'data-kind')) === 'lost', 'no lost bar');
      await done(c);
      return keys[0];
    });
  }

  await step('5b/5c restore point and last good copy', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.waitForTimeout(2200); // "Opened the board" restore point
    await page.click('#party [data-hp="-1"]');
    await page.waitForTimeout(6000); // last good copy (5 s debounce)
    const k = await kv(page);
    assert(k.good === 'obj', 'no LKG ' + JSON.stringify(k));
    await page.evaluate(() => window.DMC.raw.ls.setItem('dm-board-v1', '{broken'));
    await page.reload();
    await page.waitForSelector('#mcard[data-recovery]');
    const labels = await page.$$eval('[data-rec]', (a) => a.map((b) => b.dataset.rec));
    assert(labels[0] === 'lkg' && labels.some((l) => l.startsWith('snap:')), 'options ' + labels);
    await page.click('[data-rec="lkg"]');
    await page.waitForTimeout(600);
    assert(!(await page.$('#mcard[data-recovery]')), 'dialog still open');
    const saved = JSON.parse(await ls(page, KEY));
    assert(saved.players.length === 2 && saved.players[0].hp === 19, 'LKG not restored: hp ' + saved.players[0].hp);
    assert((await lsKeys(page, KEY + '-damaged-')).length === 1, 'damaged copy dropped');
    assert((await page.getAttribute('#saveState', 'data-state')) !== 'hold', 'hold not ended');
    await done(c);
    return labels.join(',');
  });

  await step('5b restore point option restores players', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.DMC.raw.ls.setItem('dm-board-v1', 'null'));
    await page.reload();
    await page.waitForSelector('#mcard[data-recovery]');
    const snap = await page.$('[data-rec^="snap:"]');
    assert(snap, 'no restore point option');
    await snap.click();
    await page.waitForTimeout(600);
    assert(JSON.parse(await ls(page, KEY)).players.length === 2, 'players not restored');
    await done(c);
  });

  await step('5d/5f/5g download, decide later, start fresh', async () => {
    const c = await ctx(browser, { seed: { [KEY]: '{oops' }, dl: true });
    const { page } = c;
    await page.waitForSelector('#mcard[data-recovery]');
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-rec="dl"]')]);
    const body = fs.readFileSync(await d.path(), 'utf8');
    assert(body === '{oops', 'download ' + body);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.$('#mcard[data-recovery]')) await page.click('#mcard [data-mclose]');
    await page.waitForSelector('#safebar[data-kind="lost"]');
    await page.click('#safebar [data-sb="0"]');
    await page.waitForSelector('#mcard[data-recovery]');
    await page.click('[data-rec="fresh"]');
    await page.waitForTimeout(300);
    assert((await ls(page, KEY)) === '{oops', 'first click acted');
    await Promise.all([page.waitForEvent('load'), page.click('[data-rec="fresh"]')]);
    await page.waitForTimeout(800);
    const s = JSON.parse(await ls(page, KEY));
    assert(s.players.length === 0 && !s.example, 'not an empty board');
    assert((await lsKeys(page, KEY + '-damaged-')).length === 1, 'damaged copy erased');
    assert(!(await page.$('#mcard[data-recovery]')), 'dialog after fresh start');
    await done(c);
  });

  await step('5e load a backup file ends the hold', async () => {
    const c = await ctx(browser, { seed: { [KEY]: '[]' } });
    const { page } = c;
    await page.waitForSelector('#mcard[data-recovery]');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-rec="load"]')]);
    await fc.setFiles({
      name: 'b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ _meta: { app: 'dm-board', format: 1 }, ...BOARD })),
    });
    await page.waitForTimeout(800);
    assert(JSON.parse(await ls(page, KEY)).players.length === 2, 'not loaded');
    assert((await page.getAttribute('#saveState', 'data-state')) !== 'hold', 'hold not ended');
    await done(c);
  });

  await step('5j two failed loads keep both copies', async () => {
    const c = await ctx(browser, { seed: { [KEY]: '{one' } });
    const { page } = c;
    await page.evaluate(() => window.DMC.raw.ls.setItem('dm-board-v1', '{two'));
    await page.reload();
    await page.waitForTimeout(700);
    const ks = await lsKeys(page, KEY + '-damaged-');
    const vals = await Promise.all(ks.map((k) => ls(page, k)));
    assert(vals.includes('{one') && vals.includes('{two'), 'copies ' + vals);
    await done(c);
  });

  await step('5h damaged images and registry do not open the dialog', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD, [KEY + '-img']: '{bad', 'dm-board-campaigns': '{bad' } });
    const { page } = c;
    await page.waitForTimeout(500);
    assert(!(await page.$('#mcard[data-recovery]')), 'dialog shown');
    assert((await page.$$('#party .cname')).length === 2, 'board not shown');
    await done(c);
  });

  await step('1c import rejects non-boards, other apps, newer formats, huge files', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    const cases = [
      ['x.json', 'not json', /isn’t a board backup/],
      ['x.json', '{}', /isn’t a board backup/],
      ['x.json', JSON.stringify({ _meta: { app: 'other' }, ...BOARD }), /isn’t a board backup/],
      ['x.json', JSON.stringify({ _meta: { app: 'dm-board', format: 2 }, ...BOARD }), /newer version/],
    ];
    const out = [];
    for (const [name, body, re] of cases) {
      await page.setInputFiles('#importFile', {
        name,
        mimeType: 'application/json',
        buffer: Buffer.isBuffer(body) ? body : Buffer.from(body),
      });
      await page.waitForTimeout(400);
      const t = await txt(page, '.toast');
      assert(re.test(t), 'toast ' + t);
      out.push(t.slice(0, 20));
    }
    // a 50 MB file is too big for setInputFiles; hand the handler a File directly
    await page.evaluate(() => {
      const f = new File([new Uint8Array(50e6 + 10)], 'big.json');
      const i = document.getElementById('importFile');
      i.onchange({ target: { files: [f], value: '' } });
    });
    await page.waitForTimeout(300);
    assert(/too big/.test(await txt(page, '.toast')), 'big ' + (await txt(page, '.toast')));
    assert((await ls(page, KEY)) === GOOD || JSON.parse(await ls(page, KEY)).players.length === 2, 'board changed');
    await done(c);
    return out.length + ' rejected';
  });

  await step('5k missing board: offers the last good copy', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.click('#party [data-hp="-1"]');
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.DMC.raw.ls.removeItem('dm-board-v1'));
    await page.reload();
    await page.waitForSelector('#safebar[data-kind="lost"]');
    await page.click('#safebar [data-sb="0"]');
    await page.waitForTimeout(600);
    assert(JSON.parse(await ls(page, KEY)).players[0].hp === 19, 'not restored');
    await done(c);
  });

  /* ---------- 6. quota ---------- */
  await step('6a quota: banner, buttons, footer, recovery', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD }, extra: QUOTA('QuotaExceededError'), dl: true });
    const { page } = c;
    await page.evaluate(() => sessionStorage.setItem('__full', '1'));
    await page.click('#party [data-hp="-1"]');
    await page.waitForSelector('#saveWarn');
    assert(await page.$('#saveWarn #swSave'), 'no Save backup now');
    assert(await page.$('#saveWarn #swSpace'), 'no See what uses space');
    await page.waitForTimeout(300); // the status line redraws on a short debounce
    assert(/storage is full/.test(await txt(page, '#saveState')), 'footer ' + (await txt(page, '#saveState')));
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#swSave')]);
    const j = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
    assert(j.players[0].hp === 19, 'backup missing the change');
    await page.evaluate(() => sessionStorage.removeItem('__full'));
    await page.click('#party [data-hp="-1"]');
    await page.waitForTimeout(600);
    assert(!(await page.$('#saveWarn')), 'banner still shown');
    assert(JSON.parse(await ls(page, KEY)).players[0].hp === 18, 'latest not saved');
    await done(c);
  });

  await step('6c non-quota error: blocked message', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD }, extra: QUOTA('SecurityError') });
    const { page } = c;
    await page.evaluate(() => sessionStorage.setItem('__full', '1'));
    await page.click('#party [data-hp="-1"]');
    await page.waitForSelector('#saveWarn');
    const t = await txt(page, '#saveWarn');
    assert(/blocked storage/.test(t) && !(await page.$('#swSpace')), t);
    await done(c);
  });

  await step('6e IndexedDB quota fails quietly', async () => {
    const c = await ctx(browser, {
      seed: { [KEY]: GOOD },
      extra: `(()=>{const p=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){if(window.__idbFull)throw new DOMException('full','QuotaExceededError');return p.apply(this,arguments)}})();`,
    });
    const { page } = c;
    await page.evaluate(() => (window.__idbFull = 1));
    for (let i = 0; i < 3; i++) {
      await page.click('#party [data-hp="-1"]');
      await page.waitForTimeout(300);
    }
    await page.click('#nextSess'); // forces a restore point
    await page.waitForTimeout(6500);
    assert(JSON.parse(await ls(page, KEY)).players[0].hp === 17, 'board not saved');
    await done(c);
  });

  /* ---------- 2. reminder ---------- */
  await step('2a/2b reminder on load, remind me later', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.waitForSelector('#safebar[data-kind="remind"]');
    const n = await page.$$eval('#safebar [data-sb]', (a) => a.map((b) => b.textContent));
    assert(n.join('|') === 'Save backup now|Remind me later|Turn off reminders', n.join('|'));
    await page.click('#safebar [data-sb="1"]');
    assert(!(await page.$('#safebar')), 'bar still there');
    await page.reload();
    await page.waitForTimeout(900);
    assert(!(await page.$('#safebar[data-kind="remind"]')), 'shown again after snooze');
    await page.evaluate(() => window.DMC.raw.ls.setItem('dm-board-v1-nag', String(Date.now() - 1)));
    await page.reload();
    await page.waitForSelector('#safebar[data-kind="remind"]');
    await done(c);
  });

  await step('2c turn off reminders (global), Data tab re-enables', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.waitForSelector('#safebar[data-kind="remind"]');
    await page.click('#safebar [data-sb="2"]');
    const p = JSON.parse(await ls(page, 'dm-board-backup-prefs'));
    assert(p.remind === false, 'prefs ' + JSON.stringify(p));
    await page.reload();
    await page.waitForTimeout(900);
    assert(!(await page.$('#safebar[data-kind="remind"]')), 'bar after off');
    await page.click('#editDm');
    await page.click('[data-sub="data"]');
    await page.check('#remOn');
    await page.selectOption('#remDays', '14');
    const p2 = JSON.parse(await ls(page, 'dm-board-backup-prefs'));
    assert(p2.remind === true && p2.days === 14, JSON.stringify(p2));
    await done(c);
  });

  await step('2d reminder after a session ends, not if backed up today', async () => {
    const old = JSON.stringify({ ...BOARD, dm: { ...BOARD.dm, lastBackup: '2000-01-01' } });
    const c = await ctx(browser, { seed: { [KEY]: old, [KEY + '-nag']: String(Date.now() + 864e5) }, dl: true });
    const { page } = c;
    await page.waitForTimeout(300);
    assert(!(await page.$('#safebar[data-kind="remind"]')), 'snoozed bar shown');
    // a session end skips the "days" rule but still respects the snooze, so clear it
    await page.evaluate(() => window.DMC.raw.ls.removeItem('dm-board-v1-nag'));
    await page.click('#nextSess');
    await page.waitForSelector('#safebar[data-kind="remind"]');
    assert(/Session 3 is saved/.test(await txt(page, '#safebar')), await txt(page, '#safebar'));
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#safebar [data-sb="0"]')]);
    assert(d && !(await page.$('#safebar[data-kind="remind"]')), 'bar not cleared');
    await page.click('#nextSess');
    await page.waitForTimeout(300);
    assert(!(await page.$('#safebar[data-kind="remind"]')), 'reminded although backed up today');
    await done(c);
  });

  /* ---------- 4. persistent undo ---------- */
  await step('4a undo survives a reload', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    for (let i = 0; i < 3; i++) {
      await page.click('#party [data-hp="-1"][data-pid="p1"]');
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForTimeout(900);
    const hp = async () => JSON.parse(await ls(page, KEY)).players[0].hp;
    assert((await hp()) === 17, 'hp ' + (await hp()));
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      seen.push(await hp());
    }
    assert(seen.join() === '18,19,20', 'undo steps ' + seen);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    assert(/Nothing to undo/.test(await txt(page, '.toast')), 'toast ' + (await txt(page, '.toast')));
    await done(c);
    return seen.join();
  });

  await step('4b at most 20 steps kept', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    for (let i = 0; i < 25; i++) {
      await page.click('#party [data-hp="-1"][data-pid="p1"]');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1500);
    const k = await kv(page);
    const n = Object.keys(k).filter((x) => x.startsWith('undo:')).length;
    assert(n === 20, 'undo entries ' + n);
    await done(c);
    return n + ' entries';
  });

  await step('4c board changed behind the app: undo discarded', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.click('#party [data-hp="-1"]');
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const s = JSON.parse(window.DMC.raw.ls.getItem('dm-board-v1'));
      s.dm.campaign = 'Changed elsewhere';
      window.DMC.raw.ls.setItem('dm-board-v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    assert(/Nothing to undo/.test(await txt(page, '.toast')), 'undo applied');
    const n = Object.keys(await kv(page)).filter((x) => x.startsWith('undo')).length;
    assert(n === 0, 'undo keys left ' + n);
    await done(c);
  });

  await step('4d untick keep undo clears it', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.click('#party [data-hp="-1"]');
    await page.waitForTimeout(1800);
    assert(
      Object.keys(await kv(page)).some((x) => x.startsWith('undo:')),
      'nothing persisted'
    );
    await page.click('#editDm');
    await page.click('[data-sub="data"]');
    await page.uncheck('#keepUndo');
    await page.waitForTimeout(400);
    assert(!Object.keys(await kv(page)).some((x) => x.startsWith('undo')), 'undo keys left');
    await done(c);
  });

  /* ---------- 3. auto-backup file (localhost + OPFS) ---------- */
  await step('3a/3b/3c backup file: link, update, session end, status', async () => {
    const c = await ctx(browser, {
      url: base,
      seed: { [KEY]: GOOD },
      extra: `window.showSaveFilePicker=async()=>(await navigator.storage.getDirectory()).getFileHandle('dm-board-backup.json',{create:true});`,
    });
    const { page } = c;
    const read = () =>
      page.evaluate(async () => {
        const h = await (await navigator.storage.getDirectory()).getFileHandle('dm-board-backup.json');
        return (await h.getFile()).text();
      });
    await page.click('#editDm');
    await page.click('[data-sub="data"]');
    await page.click('#fileLink');
    await page.waitForTimeout(600);
    assert(JSON.parse(await read()).players.length === 2, 'file empty');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const st = await txt(page, '#saveState');
    assert(/Auto-backup on · last saved just now/.test(st), st);
    await page.click('#party [data-hp="-1"]');
    await page.waitForTimeout(5000);
    assert(JSON.parse(await read()).players[0].hp === 19, 'file not updated');
    await page.click('#nextSess');
    await page.waitForTimeout(700);
    assert(JSON.parse(await read()).dm.session === 4, 'session end not written at once');
    assert(!(await page.$('#safebar[data-kind="remind"]')), 'reminder with healthy file');
    await done(c);
    return st;
  });

  await step('3d/3e paused and failed file states (file:// fake handle)', async () => {
    const fake = (mode) => `window.__writes=[];window.showSaveFilePicker=async()=>({name:'fake.json',kind:'file',
      queryPermission:async()=>'${mode === 'prompt' ? 'prompt' : 'granted'}',requestPermission:async()=>'granted',
      createWritable:async()=>{${mode === 'fail' ? "throw new Error('disk');" : ''}return{write:async(t)=>window.__writes.push(t),close:async()=>{}}}});`;
    const c = await ctx(browser, { seed: { [KEY]: GOOD }, extra: fake('fail') });
    const { page } = c;
    await page.click('#editDm');
    await page.click('[data-sub="data"]');
    await page.click('#fileLink');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    const st = await txt(page, '#saveState');
    assert(/Auto-backup failed/.test(st), st);
    await done(c);
    return st;
  });

  /* ---------- 7. D&D Beyond ---------- */
  await step('7a-7f D&D Beyond box: experimental, steps, link, no network', async () => {
    const c = await ctx(browser, { seed: { [KEY]: GOOD } });
    const { page } = c;
    await page.click('#addPlayer');
    await page.waitForSelector('#ddbD');
    await page.click('#ddbD summary');
    const sum = await txt(page, '#ddbD summary');
    assert(/Experimental/.test(sum), sum);
    await page.fill('#ddbId', 'https://www.dndbeyond.com/characters/12345678');
    const href = await page.getAttribute('#ddbOpen', 'href');
    assert(/character\/v5\/character\/12345678$/.test(href || ''), 'href ' + href);
    await page.fill('#ddbIn', '{not json');
    await page.click('#ddbGo');
    await page.waitForTimeout(200);
    assert(/bad/.test(await page.getAttribute('#ddbMsg', 'class')), 'no error');
    await page.evaluate(() => {
      const t = document.getElementById('ddbIn');
      t.value = '{' + 'x'.repeat(5e6 + 10);
    });
    await page.click('#ddbGo');
    await page.waitForTimeout(200);
    assert(/too big/.test(await txt(page, '#ddbMsg')), await txt(page, '#ddbMsg'));
    await page.route('https://character-service.dndbeyond.com/**', (r) => r.abort());
    await page.click('#ddbFetch');
    await page.waitForTimeout(600);
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert(focus === 'ddbStep3', 'focus ' + focus);
    c.errors.splice(0); // the deliberate fetch above
    await done(c);
    return sum;
  });

  srv.close();
  await browser.close();
  console.log(results.join('\n'));
  if (allErr.length) {
    failed++;
    console.log('ERRORS\n' + allErr.join('\n'));
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
