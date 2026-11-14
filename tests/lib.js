/* Shared Playwright helpers for the smoke, visual and coverage scripts.
   Uses the preinstalled `playwright` module (Chromium only); never installs browsers. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

let ROOT = path.resolve(process.env.DMB_ROOT || path.join(__dirname, '..'));
let FILE_URL = 'file://' + path.join(ROOT, 'index.html');
/* Point the helpers at another checkout (used to compare an old tree with the current one). */
function setRoot(r) {
  ROOT = path.resolve(r);
  FILE_URL = 'file://' + path.join(ROOT, 'index.html');
}

/* Deterministic Math.random so dice, ambient effects and ids are repeatable in screenshots. */
const SEED = `(()=>{let s=12345;Math.random=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648}})();`;
/* Collect CSP violations from the very first script on. */
const CSP_HOOK = `window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+(e.blockedURI||'inline')+' '+(e.sourceFile||'')+':'+(e.lineNumber||'')));`;

async function launch() {
  return chromium.launch();
}

/**
 * Open the app in a fresh context.
 * opts: { width, height, dark, reducedMotion, seed, bypassCSP, fx, beforeGoto(page) }
 * fx: the Effects choice seeded into localStorage['ve-fx'] when it is unset ('on' by default, so the low-power
 * default does not depend on the test machine; headless Chromium reports 2 cores). null leaves it unset.
 * Returns { page, context, errors } where errors collects page errors, console errors and network requests.
 */
async function open(browser, opts = {}) {
  const o = Object.assign({ width: 1280, height: 900, dark: false, reducedMotion: false, seed: false, fx: 'on' }, opts);
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    colorScheme: o.dark ? 'dark' : 'light',
    reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    acceptDownloads: true,
    bypassCSP: !!o.bypassCSP, // visual tests inject a style tag to pause animations
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text());
  });
  page.on('request', (r) => {
    if (!/^(file|data|blob):/.test(r.url())) errors.push('NETWORK ' + r.url());
  });
  await page.addInitScript(CSP_HOOK);
  if (o.seed) await page.addInitScript(SEED);
  if (o.fx)
    await page.addInitScript((v) => {
      if (localStorage.getItem('ve-fx') === null) localStorage.setItem('ve-fx', v);
    }, o.fx);
  if (o.beforeGoto) await o.beforeGoto(page);
  page.setDefaultTimeout(8000);
  await page.goto(FILE_URL);
  await page.waitForTimeout(900);
  return { page, context, errors };
}

/* Skip the entry screen (Esc skips the intro in about 350 ms). */
async function enter(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
}

const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Pixel diff inside Chromium (canvas), so no image libraries are needed.
 * pairs: [{ name, a, b, out }] (a/b: PNG paths; out: where to write a diff image, changed pixels in magenta).
 * A pixel counts as different when any channel differs by more than thresh (0-255).
 * Returns [{ name, n, total, ratio, max, msg, missing, size }].
 */
async function diffImages(browser, pairs, thresh = 16) {
  const fs = require('fs');
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  await pg.setContent('<html><body></body></html>');
  const res = [];
  for (const { name, a, b, out } of pairs) {
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      res.push({ name, missing: true, msg: 'missing ' + (fs.existsSync(a) ? b : a) });
      continue;
    }
    const r = await pg.evaluate(
      async ([A, B, T]) => {
        const load = (src) =>
          new Promise((ok, no) => {
            const i = new Image();
            i.onload = () => ok(i);
            i.onerror = no;
            i.src = src;
          });
        const [ia, ib] = await Promise.all([load(A), load(B)]);
        if (ia.width !== ib.width || ia.height !== ib.height)
          return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
        const c = document.createElement('canvas');
        c.width = ia.width;
        c.height = ia.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(ia, 0, 0);
        const da = g.getImageData(0, 0, c.width, c.height).data;
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(ib, 0, 0);
        const db = g.getImageData(0, 0, c.width, c.height);
        const d = db.data;
        let n = 0,
          max = 0;
        for (let i = 0; i < d.length; i += 4) {
          const m = Math.max(Math.abs(da[i] - d[i]), Math.abs(da[i + 1] - d[i + 1]), Math.abs(da[i + 2] - d[i + 2]));
          if (m > max) max = m;
          if (m > T) {
            n++;
            d[i] = 255;
            d[i + 1] = 0;
            d[i + 2] = 255;
            d[i + 3] = 255;
          } else {
            d[i + 3] = 60;
          }
        }
        let diff = null;
        if (n) {
          g.putImageData(db, 0, 0);
          diff = c.toDataURL('image/png');
        }
        return { n, total: d.length / 4, max, diff };
      },
      [
        'data:image/png;base64,' + fs.readFileSync(a).toString('base64'),
        'data:image/png;base64,' + fs.readFileSync(b).toString('base64'),
        thresh,
      ]
    );
    if (r.size) {
      res.push({ name, size: true, msg: 'SIZE ' + r.size });
      continue;
    }
    if (r.diff && out) fs.writeFileSync(out, Buffer.from(r.diff.split(',')[1], 'base64'));
    const ratio = r.n / r.total;
    res.push({
      name,
      n: r.n,
      total: r.total,
      ratio,
      max: r.max,
      msg: `${r.n} px differ (${(ratio * 100).toFixed(3)}%), max delta ${r.max}`,
    });
  }
  await ctx.close();
  return res;
}

module.exports = {
  get ROOT() {
    return ROOT;
  },
  get FILE_URL() {
    return FILE_URL;
  },
  setRoot,
  SEED,
  launch,
  open,
  enter,
  wait,
  diffImages,
};
