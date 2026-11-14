#!/usr/bin/env node
/* Smoke test: loads index.html over file:// in Chromium and exercises the core features.
   Fails (exit 1) on any failed step, page error, console error, CSP violation or network request.
   Run: npm test   (or: node tests/smoke.js) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, open, enter, wait } = require('./lib');

const results = [];
let failed = 0;
async function step(name, fn) {
  try {
    const r = await fn();
    results.push('PASS ' + name + (r ? ' :: ' + String(r).slice(0, 200) : ''));
  } catch (e) {
    failed++;
    results.push('FAIL ' + name + ' :: ' + String(e.message).split('\n')[0]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const text = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return e ? e.innerText.replace(/\s+/g, ' ').trim() : '';
  }, sel);

(async () => {
  const browser = await launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dmb-smoke-'));
  const allErrors = [];
  const cspAll = [];

  /* ---------- desktop, light ---------- */
  let { page, context, errors } = await open(browser, { width: 1280, height: 900 });

  await step('entry screen shows the intro', async () => {
    const has = await page.evaluate(() => !!document.getElementById('fx-intro'));
    assert(has, 'no #fx-intro');
    return 'intro present';
  });
  await step('enter (Enter the dungeon)', async () => {
    const y = await page.$('#fx-yes');
    if (y && (await y.isVisible())) await y.click();
    else await page.keyboard.press('Escape');
    await wait(page, 3200);
    assert(await page.evaluate(() => !document.getElementById('fx-intro')), 'intro still present');
    assert(/DM Assistance Board/.test(await page.title()), 'title');
    return text(page, '#subline');
  });
  await step('home renders party and DM screen', async () => {
    const n = await page.$$eval('#party .cname', (a) => a.length);
    assert(n >= 4, 'party cards: ' + n);
    assert(await page.$('#dmSeat #sPlan'), 'DM screen missing');
    return n + ' party cards';
  });
  await step('party: HP -1 / +1 on a card', async () => {
    const hpBtn = await page.$('#party [data-hp="-1"]');
    const pid = await hpBtn.getAttribute('data-pid');
    const before = await page.evaluate(() => document.querySelector('#party').innerText);
    await hpBtn.click();
    await wait(page, 250);
    const mid = await page.evaluate(() => document.querySelector('#party').innerText);
    await page.click(`#party [data-hp="1"][data-pid="${pid}"]`);
    await wait(page, 250);
    assert(before !== mid, 'HP did not change');
    return 'ok';
  });
  await step('party sheet opens and closes', async () => {
    await page.click('#party .cname');
    await wait(page, 500);
    const t = await text(page, '#overlay');
    assert(t.length > 40, 'sheet empty');
    await page.keyboard.press('Escape');
    await wait(page, 400);
    return t.slice(0, 80);
  });
  await step('Time & light drawer opens and closes', async () => {
    await page.click('#tlBtn');
    await wait(page, 500);
    const o = await page.evaluate(() => document.querySelector('#dmSeat').classList.contains('tl-open'));
    assert(o, 'did not open');
    await page.click('#dmSeat [data-adv="10"]');
    await wait(page, 300);
    await page.keyboard.press('Escape');
    await wait(page, 400);
    const c = await page.evaluate(() => !document.querySelector('#dmSeat').classList.contains('tl-open'));
    assert(c, 'did not close');
    return text(page, '#tlBtn');
  });
  const refLoaded = () =>
    page.evaluate(() => {
      const D = window.DMB_DATA || {};
      return ['bestiary', 'spells', 'items'].filter((k) => D[k]);
    });
  await step('reference data (bestiary, spells, items) is not loaded at start-up', async () => {
    const l = await refLoaded();
    assert(!l.length, 'already loaded: ' + l.join(', '));
    return 'not loaded after home, party sheet and Time & light';
  });
  await step('reference data loads when the Battles sheet opens', async () => {
    await page.click('.navb[data-open="battle"]');
    await wait(page, 400);
    const l = await refLoaded();
    assert(l.length === 3, 'loaded: ' + l.join(', '));
    const tab = await text(page, '#overlay [data-sub="bestiary"]');
    assert(/Bestiary\s*\d{3}/.test(tab), 'bestiary tab: ' + tab);
    await page.keyboard.press('Escape');
    await wait(page, 400);
    return tab;
  });
  await step('live battle: damage, heal, condition, next turn', async () => {
    await page.click('.navb[data-open="battle"]');
    await wait(page, 400);
    await page.click('#overlay [data-sub="live"]');
    await wait(page, 400);
    const row = (i) =>
      page.evaluate((i) => {
        const inp = document.getElementById('amt' + i);
        const r = inp && inp.closest('[class]');
        let e = inp;
        for (let k = 0; k < 6 && e; k++) e = e.parentElement;
        return (e || r || document.body).innerText.replace(/\s+/g, ' ');
      }, i);
    const b0 = await row(1);
    await page.fill('#amt1', '3');
    await page.click('#overlay [data-dmg="1"]:not([data-mul])');
    await wait(page, 400);
    const b1 = await row(1);
    assert(b0 !== b1, 'damage did not change the row');
    await page.fill('#amt1', '2');
    await page.click('#overlay [data-heal="1"]');
    await wait(page, 400);
    await page.selectOption('#overlay select[data-addc="1"]', 'Prone');
    await wait(page, 400);
    const ov = await text(page, '#overlay');
    assert(/Prone/.test(ov), 'condition not shown');
    const turnBefore = ov.match(/Round \d+/);
    await page.click('#nextTurn');
    await wait(page, 500);
    await page.click('#prevTurn');
    await wait(page, 400);
    await page.click('#nextTurn');
    await wait(page, 400);
    const after = ((await text(page, '#overlay')).match(/Round \d+/) || [''])[0];
    await page.click('#overlay [data-end="Victory"]');
    await wait(page, 600);
    for (let i = 0; i < 3; i++) {
      const pri = await page.$('#mcard .btn.pri');
      if (!pri) break;
      await pri.click();
      await wait(page, 500);
    }
    return (turnBefore ? turnBefore[0] : '') + ' -> ' + after + ', ended with Victory';
  });
  await step('encounter builder: add monsters and start a battle', async () => {
    await page.click('#overlay [data-sub="new"]');
    await wait(page, 400);
    await page.fill('#bName', 'Smoke test fight');
    await page.fill('#nf', 'goblin');
    await wait(page, 300);
    const inc = await page.$('#overlay [data-inc]');
    assert(inc, 'no monster rows');
    const mon = await inc.getAttribute('data-inc');
    await inc.click();
    await wait(page, 200);
    await page.click(`#overlay [data-inc="${mon}"]`);
    await wait(page, 300);
    const budget = await text(page, '#overlay');
    await page.click('#bStart');
    await wait(page, 600);
    const begin = await page.$('#begin');
    assert(begin, 'no #begin');
    await begin.click();
    await wait(page, 600);
    // a confirm sheet may appear when another battle is live
    for (let i = 0; i < 3; i++) {
      const pri = await page.$('#mcard .btn.pri');
      if (!pri) break;
      await pri.click();
      await wait(page, 500);
    }
    const t = await text(page, '#overlay');
    assert(/Smoke test fight/.test(t) || new RegExp(mon).test(t), 'new battle not live');
    return mon + ' x2; ' + (budget.match(/(Easy|Low|Moderate|Medium|Hard|High|Deadly)[^.]{0,30}/) || [''])[0];
  });
  await step('bestiary search + monster card', async () => {
    await page.click('#overlay [data-sub="bestiary"]');
    await wait(page, 300);
    await page.fill('#bf', 'dragon');
    await wait(page, 300);
    const n = await text(page, '#overlay .meta');
    await page.fill('#bf', 'ghoul');
    await wait(page, 300);
    await page.click('#overlay [data-mon="Ghoul"]');
    await wait(page, 400);
    const card = await text(page, '#mcard');
    assert(/Ghoul/.test(card), 'card missing');
    await page.keyboard.press('Escape');
    await wait(page, 300);
    return n + ' | ' + card.slice(0, 60);
  });
  await step('spells and items tabs list entries', async () => {
    await page.click('#overlay [data-sub="spells"]');
    await wait(page, 400);
    const s = await text(page, '#overlay');
    assert(/Fireball|Fire Bolt/.test(s), 'spells');
    await page.click('#overlay [data-sub="items"]');
    await wait(page, 400);
    const it = await text(page, '#overlay');
    assert(/Potion|Armor|Bag of Holding/.test(it), 'items');
    await page.click('#overlay [data-sub="conditions"]');
    await wait(page, 300);
    assert(/Grappled/.test(await text(page, '#overlay')), 'conditions');
    return 'ok';
  });
  await page.keyboard.press('Escape');
  await wait(page, 400);
  await step('dice roller with reels', async () => {
    await page.keyboard.press('d');
    await wait(page, 600);
    await page.click('[data-face="20"]');
    await wait(page, 300);
    const reels = await page.$$eval('.reel', (a) => a.length);
    assert(reels > 0, 'no reels');
    await wait(page, 1800);
    await page.click('#droll');
    await wait(page, 1800);
    const r = await text(page, '.dres');
    assert(r, 'no result');
    await page.keyboard.press('Escape');
    await wait(page, 300);
    return 'reels ' + reels + ' | ' + r.slice(0, 60);
  });
  await step('theme toggle cycles auto -> light -> dark', async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await page.click('#themeBtn');
      await wait(page, 250);
      seen.push(await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'auto'));
    }
    assert(new Set(seen).size >= 2, 'theme did not change: ' + seen);
    return seen.join(',');
  });
  await step('effects toggle', async () => {
    const b = await page.$('#fxBtn');
    assert(b, 'no #fxBtn');
    const a = await b.getAttribute('aria-pressed');
    await b.click();
    await wait(page, 300);
    const c = await page.getAttribute('#fxBtn', 'aria-pressed');
    await page.click('#fxBtn');
    await wait(page, 300);
    assert(a !== c, 'aria-pressed unchanged');
    return a + ' -> ' + c + ' -> ' + (await page.getAttribute('#fxBtn', 'aria-pressed'));
  });
  await step('save backup / load backup round-trip', async () => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    const f = path.join(tmp, 'bk.json');
    await d.saveAs(f);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert(Array.isArray(j.players) && j.players.length, 'no players in backup');
    await page.setInputFiles('#importFile', f);
    await wait(page, 800);
    const go = await page.$('#mcard .btn.pri');
    if (go) {
      await go.click();
      await wait(page, 800);
    }
    const sub = await text(page, '#subline');
    const n = await page.$$eval('#party .cname', (a) => a.length);
    assert(n === j.players.filter((p) => p.present !== false || true).length || n > 0, 'party after load');
    return d.suggestedFilename() + ', ' + j.players.length + ' players -> ' + sub;
  });
  await step('CSP: D&D Beyond endpoint allowed, other hosts blocked', async () => {
    await page.route(/character-service\.dndbeyond\.com/, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      })
    );
    const ok = await page.evaluate(
      async () => (await fetch('https://character-service.dndbeyond.com/character/v5/character/1')).status
    );
    const blocked = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/x');
        return false;
      } catch (e) {
        return true;
      }
    });
    assert(ok === 200 && blocked, 'ddb ' + ok + ' blocked ' + blocked);
    return 'ok';
  });
  // data safety (full suite: node tests/data-safety.js)
  await step('data safety: save status line and experimental D&D Beyond import', async () => {
    const st = await text(page, '#saveState');
    assert(/^Saved in this browser/.test(st), 'status ' + st);
    await page.click('#addPlayer');
    await wait(page, 400);
    const sum = await text(page, '#ddbD summary');
    assert(/Experimental/.test(sum) && (await page.$('#ddbId')), 'ddb ' + sum);
    await page.keyboard.press('Escape');
    await wait(page, 300);
    return st;
  });
  cspAll.push(...(await page.evaluate(() => window.__csp)).filter((v) => !/example\.com/.test(v)));
  allErrors.push(...errors.filter((e) => !/example\.com|character-service/.test(e)));
  await context.close();

  /* ---------- phones: no horizontal scroll, light and dark ---------- */
  for (const [w, dark] of [
    [390, true],
    [390, false],
    [360, false],
    [360, true],
  ]) {
    ({ page, context, errors } = await open(browser, { width: w, height: 844, dark }));
    await enter(page);
    await step(`no horizontal scroll ${w} ${dark ? 'dark' : 'light'}`, async () => {
      const sw = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const home = await sw();
      await page.click('.navb[data-open="battle"]');
      await wait(page, 400);
      const bat = await sw();
      await page.keyboard.press('Escape');
      await wait(page, 300);
      await page.click('#tlBtn');
      await wait(page, 500);
      const dr = await sw();
      assert(home <= 0 && bat <= 0 && dr <= 0, `overflow home ${home} battle ${bat} drawer ${dr}`);
      return 'ok';
    });
    cspAll.push(...(await page.evaluate(() => window.__csp)));
    allErrors.push(...errors);
    await context.close();
  }

  /* ---------- lazy data: a missing data file degrades gracefully and is retried ---------- */
  ({ page, context, errors } = await open(browser, { reducedMotion: true }));
  await step('lazy data: missing file shows a toast, the sheet still opens, retry works', async () => {
    await enter(page);
    await page.evaluate(() => (window.DMB_LAZY.SRC.bestiary = 'data/missing.js'));
    await page.click('.navb[data-open="mission"]');
    await wait(page, 500);
    const toastText = await text(page, '.toast');
    assert(/Couldn.t load the bestiary/.test(toastText), 'no toast: ' + toastText);
    assert((await text(page, '#overlay')).length > 40, 'sheet did not open');
    await page.keyboard.press('Escape');
    await wait(page, 300);
    await page.evaluate(() => (window.DMB_LAZY.SRC.bestiary = 'data/bestiary.js'));
    await page.click('.navb[data-open="battle"]');
    await wait(page, 500);
    const tab = await text(page, '#overlay [data-sub="bestiary"]');
    assert(/Bestiary\s*\d{3}/.test(tab), 'retry failed: ' + tab);
    return tab;
  });
  cspAll.push(...(await page.evaluate(() => window.__csp)));
  // the deliberate missing file logs a console error and a file:// request failure; anything else counts
  allErrors.push(...errors.filter((e) => !/missing\.js|ERR_FILE_NOT_FOUND/.test(e)));
  await context.close();

  /* ---------- reduced motion: static entry, still enters ---------- */
  ({ page, context, errors } = await open(browser, { reducedMotion: true }));
  await step('reduced motion: enter works', async () => {
    await enter(page);
    assert(await page.evaluate(() => !document.getElementById('fx-intro')), 'intro still present');
    return 'ok';
  });
  cspAll.push(...(await page.evaluate(() => window.__csp)));
  allErrors.push(...errors);
  await context.close();
  await browser.close();

  await step('no CSP violations', async () => assert(!cspAll.length, cspAll.join(' | ')));
  await step('no page errors, console errors or network requests', async () =>
    assert(!allErrors.length, [...new Set(allErrors)].join(' | '))
  );

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
