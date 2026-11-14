#!/usr/bin/env node
/* Visual regression: captures key screens and compares them with tests/baseline/.
   Deterministic: seeded Math.random, fixed clock, animations paused, reduced motion for app screens.
   Run: npm run test:visual            (compare; writes tests/output/ and diff images on mismatch)
        npm run test:visual:update     (re-record the baseline)
   A screen passes when at most MAX_RATIO of its pixels differ by more than THRESH in any channel. */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, open, enter, wait, diffImages } = require('./lib');

const UPDATE = process.argv.includes('--update');
const BASE = path.join(__dirname, 'baseline');
const OUT = path.join(__dirname, 'output');
const THRESH = 16;
const MAX_RATIO = 0.0005; // 0.05 % of pixels (anti-aliasing noise)
const FIXED_TIME = new Date('2026-11-08T21:30:00');
const PAUSE =
  '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}';

const dir = UPDATE ? BASE : OUT;
fs.mkdirSync(dir, { recursive: true });

async function page(browser, opts) {
  const o = await open(
    browser,
    Object.assign({ seed: true, reducedMotion: true, bypassCSP: true }, opts, {
      beforeGoto: async (p) => p.clock.setFixedTime(FIXED_TIME),
    })
  );
  return o;
}
async function snap(p, name, full) {
  await p.addStyleTag({ content: PAUSE });
  await p.evaluate(() => document.fonts.ready);
  await wait(p, 300);
  await p.screenshot({ path: path.join(dir, name + '.png'), fullPage: !!full });
}

async function capture(browser) {
  const errs = [];
  const done = async (o) => {
    errs.push(...o.errors);
    await o.context.close();
  };
  let o;
  // Entry screen, static frame (reduced motion shows the finished d20)
  o = await page(browser, { width: 1280, height: 800 });
  await snap(o.page, 'entry-1280');
  await done(o);
  o = await page(browser, { width: 390, height: 844 });
  await snap(o.page, 'entry-390');
  await done(o);
  // Home: light/dark, desktop/phone (top of page and full page)
  for (const [w, h, dark] of [
    [1280, 900, false],
    [1280, 900, true],
    [390, 844, false],
    [390, 844, true],
  ]) {
    o = await page(browser, { width: w, height: h, dark });
    await enter(o.page);
    await snap(o.page, `home-${w}-${dark ? 'dark' : 'light'}`, true);
    await done(o);
  }
  // Live battle, monster card, dice popup, party sheet, Time & light (1280 light) and live battle dark
  o = await page(browser, { width: 1280, height: 900 });
  const p = o.page;
  await enter(p);
  await p.click('.navb[data-open="battle"]');
  await wait(p, 400);
  await p.click('#overlay [data-sub="live"]');
  await wait(p, 400);
  await snap(p, 'battle-live');
  await p.click('#overlay [data-sub="bestiary"]');
  await wait(p, 300);
  await p.fill('#bf', 'ghoul');
  await wait(p, 300);
  await p.click('#overlay [data-mon="Ghoul"]');
  await wait(p, 400);
  await snap(p, 'monster-card');
  await p.keyboard.press('Escape');
  await wait(p, 250);
  await p.keyboard.press('Escape');
  await wait(p, 300);
  await p.keyboard.press('d');
  await wait(p, 500);
  await p.click('[data-face="20"]');
  await wait(p, 2500);
  await snap(p, 'dice');
  await p.keyboard.press('Escape');
  await wait(p, 300);
  await p.click('#party .cname');
  await wait(p, 500);
  await snap(p, 'party-sheet');
  await p.keyboard.press('Escape');
  await wait(p, 300);
  await p.click('#tlBtn');
  await wait(p, 500);
  await snap(p, 'time-light');
  await done(o);
  o = await page(browser, { width: 390, height: 844, dark: true });
  await enter(o.page);
  await o.page.click('#tlBtn');
  await wait(o.page, 500);
  await snap(o.page, 'time-light-390-dark');
  await done(o);
  o = await page(browser, { width: 1280, height: 900, dark: true });
  await enter(o.page);
  await o.page.click('.navb[data-open="battle"]');
  await wait(o.page, 400);
  await o.page.click('#overlay [data-sub="live"]');
  await wait(o.page, 400);
  await snap(o.page, 'battle-live-dark');
  await done(o);
  return errs;
}

/* Compare tests/output/<name> with tests/baseline/<name> (pixel diff in lib.diffImages). */
async function compare(browser, names) {
  const pairs = names.map((n) => ({
    name: n,
    a: path.join(BASE, n),
    b: path.join(OUT, n),
    out: path.join(OUT, n.replace('.png', '.diff.png')),
  }));
  return (await diffImages(browser, pairs, THRESH)).map((r) => ({
    n: r.name,
    msg: r.msg,
    fail: r.missing || r.size || r.ratio > MAX_RATIO,
  }));
}

(async () => {
  const browser = await launch();
  const errs = await capture(browser);
  let failed = 0;
  if (errs.length) {
    failed++;
    console.log('ERRORS:\n' + [...new Set(errs)].join('\n'));
  }
  if (UPDATE) {
    console.log('Baseline written to ' + BASE);
  } else {
    const names = fs.readdirSync(OUT).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png'));
    for (const r of await compare(browser, names)) {
      if (r.fail) failed++;
      console.log((r.fail ? 'FAIL ' : 'PASS ') + r.n + ': ' + r.msg);
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
