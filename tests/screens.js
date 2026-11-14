#!/usr/bin/env node
/* Wide screenshot sweep for refactors: one PNG per app state in tests/styles.js (about 110 screens: every
   sheet tab of Battles, Missions, Notes, Session, Campaign and Player, dialogs, dice, light/dark, 1280/390).
   Deterministic like tests/visual.js: seeded Math.random, fixed clock, reduced motion, animations paused.
   Use it to compare two trees (for example the single-file baseline commit with the current tree):
     git archive c89fe3c | tar -x -C /tmp/base
     DMB_ROOT=/tmp/base node tests/screens.js capture /tmp/shots-a
     node tests/screens.js capture /tmp/shots-b
     node tests/screens.js compare /tmp/shots-a /tmp/shots-b      (diff PNGs go to /tmp/shots-b/diff/)
   compare exits 1 if any screen has more than 0.05% of pixels differing by more than 16/255. */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, wait, diffImages } = require('./lib');
const { visit, PAUSE } = require('./styles');

const THRESH = 16;
const MAX_RATIO = 0.0005;

async function capture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch();
  let n = 0;
  const errs = await visit(browser, async (p, name) => {
    await p.addStyleTag({ content: PAUSE + '*{caret-color:transparent!important}' });
    await p.evaluate(() => document.fonts.ready);
    await wait(p, 300);
    await p.screenshot({ path: path.join(dir, name + '.png') });
    n++;
  });
  await browser.close();
  console.log(`${n} screens -> ${dir}`);
  if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].join('\n'));
  return errs.length ? 1 : 0;
}

async function compare(a, b) {
  const diffDir = path.join(b, 'diff');
  fs.mkdirSync(diffDir, { recursive: true });
  const names = [...new Set([...fs.readdirSync(a), ...fs.readdirSync(b)])].filter((f) => f.endsWith('.png')).sort();
  const browser = await launch();
  const res = await diffImages(
    browser,
    names.map((n) => ({ name: n, a: path.join(a, n), b: path.join(b, n), out: path.join(diffDir, n) })),
    THRESH
  );
  await browser.close();
  let failed = 0;
  for (const r of res) {
    const fail = r.missing || r.size || r.ratio > MAX_RATIO;
    if (fail) failed++;
    if (fail || r.n) console.log((fail ? 'FAIL ' : 'ok   ') + r.name + ': ' + r.msg);
  }
  console.log(`\n${res.length} screens compared, ${failed} failed`);
  return failed ? 1 : 0;
}

if (require.main === module) {
  const [cmd, d1, d2] = process.argv.slice(2);
  const run =
    cmd === 'capture' && d1 ? capture(d1) : cmd === 'compare' && d1 && d2 ? compare(d1, d2) : Promise.resolve(-1);
  run
    .then((code) => {
      if (code === -1) {
        console.log('usage: node tests/screens.js capture DIR | compare DIR_A DIR_B   (DMB_ROOT=tree to capture)');
        code = 2;
      }
      process.exit(code);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
