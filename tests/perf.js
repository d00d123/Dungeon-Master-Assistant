#!/usr/bin/env node
/* Performance measurements (Chromium, file://). Dev tooling only; not part of npm test.
   Run:  node tests/perf.js                      measure this tree
         node tests/perf.js --vs ../other/tree   measure both and print them side by side
   Env:  PERF_IDLE_MS (default 120000) idle window for memory and idle CPU with Effects on
         PERF_RUNS    (default 3)      start-up runs (the median is reported)
   Measures: start-up (FCP, LCP, script/style/layout time, long tasks), idle CPU with Effects on and off,
   frame rate at 4x CPU throttle during a battle round and a dice roll, JS heap and DOM nodes after idle,
   and the Effects default on simulated low-power devices. */
'use strict';
const path = require('path');
const { launch, open, enter, wait, setRoot } = require('./lib');

const IDLE = +process.env.PERF_IDLE_MS || 120000;
const RUNS = +process.env.PERF_RUNS || 3;
const OFF_IDLE = Math.min(20000, IDLE);

/* long tasks and paint timings, collected from the first script on */
const OBS = `(()=>{window.__lt=[];window.__lcp=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([e.startTime,e.duration])}).observe({type:'longtask'})}catch(e){}
try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}})();`;
/* frame counter: frames and the worst gap between frames in a window */
const FPS_START = () => {
  const f = (window.__fr = { n: 0, worst: 0, last: performance.now(), t0: performance.now(), on: true });
  const tick = (t) => {
    if (!f.on) return;
    f.worst = Math.max(f.worst, t - f.last);
    f.last = t;
    f.n++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const FPS_STOP = () => {
  const f = window.__fr;
  f.on = false;
  const s = (performance.now() - f.t0) / 1000;
  return { fps: f.n / s, worst: f.worst };
};

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = {};
  for (const x of metrics) m[x.name] = x.value;
  return m;
}
async function openP(browser, o) {
  let cdp;
  const r = await open(
    browser,
    Object.assign({ width: 1280, height: 900 }, o, {
      beforeGoto: async (p) => {
        await p.addInitScript(OBS);
        cdp = await p.context().newCDPSession(p);
        await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
      },
    })
  );
  r.cdp = cdp;
  return r;
}

async function startup(browser) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const { page, context, cdp } = await openP(browser, {});
    await wait(page, 1500);
    const m = await metrics(cdp);
    const p = await page.evaluate(() => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        fcp: fcp ? fcp.startTime : 0,
        lcp: window.__lcp,
        dcl: nav ? nav.domContentLoadedEventEnd : 0,
        load: nav ? nav.loadEventEnd : 0,
        lt: window.__lt.length,
        ltms: window.__lt.reduce((a, x) => a + x[1], 0),
      };
    });
    runs.push(
      Object.assign(p, {
        script: m.ScriptDuration * 1000,
        style: m.RecalcStyleDuration * 1000,
        layout: m.LayoutDuration * 1000,
        task: m.TaskDuration * 1000,
        heap0: m.JSHeapUsedSize / 1048576,
      })
    );
    await context.close();
  }
  const out = {};
  for (const k of Object.keys(runs[0])) out[k] = median(runs.map((r) => r[k]));
  return out;
}

/* CPU busy time per second of wall time on the home screen, after the intro (no rAF probe here: a probe
   would itself force a frame, and a style recalc, on every vsync) */
async function idle(browser, fx, ms, dark, calm) {
  const { page, context, cdp } = await openP(browser, { fx, dark });
  await enter(page);
  if (calm) {
    /* end the demo's live battle, so the table art is in its animated (campfire) state */
    await page.click('.navb[data-open="battle"]');
    await wait(page, 500);
    await page.click('#overlay [data-sub="live"]');
    await wait(page, 400);
    await page.click('#overlay [data-end="Victory"]');
    await wait(page, 600);
    for (let i = 0; i < 3; i++) {
      const pri = await page.$('#mcard .btn.pri');
      if (!pri) break;
      await pri.click();
      await wait(page, 500);
    }
    await page.keyboard.press('Escape');
  }
  await wait(page, 2500);
  await page.evaluate(() => (window.__lt.length = 0));
  const a = await metrics(cdp);
  const t0 = Date.now();
  await wait(page, ms);
  const b = await metrics(cdp);
  const s = (Date.now() - t0) / 1000;
  await cdp.send('HeapProfiler.collectGarbage');
  const c = await metrics(cdp);
  const lt = await page.evaluate(() => window.__lt.length);
  const st = await page.evaluate(() => (window.__fx && window.__fx.stats ? window.__fx.stats() : {}));
  await context.close();
  return {
    cpu: ((b.TaskDuration - a.TaskDuration) / s) * 100,
    script: ((b.ScriptDuration - a.ScriptDuration) * 1000) / s,
    layouts: b.LayoutCount - a.LayoutCount,
    recalc: b.RecalcStyleCount - a.RecalcStyleCount,
    lt,
    heap: c.JSHeapUsedSize / 1048576,
    nodes: c.Nodes,
    off: st.off,
  };
}

/* frame rate under 4x CPU throttle while a battle round is played and while a d20 is rolled */
async function throttled(browser) {
  const { page, context, cdp } = await openP(browser, {});
  await enter(page);
  await page.click('.navb[data-open="battle"]');
  await wait(page, 600);
  await page.click('#overlay [data-sub="live"]');
  await wait(page, 600);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => (window.__lt.length = 0));
  await page.evaluate(FPS_START);
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    if (await page.$('#amt1')) {
      await page.fill('#amt1', '2');
      await page.click('#overlay [data-dmg="1"]:not([data-mul])');
      await wait(page, 350);
    }
    await page.click('#nextTurn');
    await wait(page, 650);
  }
  const battle = await page.evaluate(FPS_STOP);
  const bms = Date.now() - t0;
  const blt = await page.evaluate(() => [window.__lt.length, Math.max(0, ...window.__lt.map((x) => x[1]))]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.keyboard.press('Escape');
  await wait(page, 600);
  await page.keyboard.press('d');
  await wait(page, 800);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => (window.__lt.length = 0));
  await page.evaluate(FPS_START);
  await page.click('[data-face="20"]');
  await wait(page, 600);
  await page.click('#droll');
  await wait(page, 2400);
  const dice = await page.evaluate(FPS_STOP);
  const dlt = await page.evaluate(() => [window.__lt.length, Math.max(0, ...window.__lt.map((x) => x[1]))]);
  await context.close();
  return { battle, bms, blt, dice, dlt };
}

/* the Effects default on simulated devices (no ve-fx choice stored) */
async function defaults(browser) {
  const cases = [
    ['desktop, 8 cores', {}, ''],
    ['desktop, 4 cores', {}, 'hc=4'],
    ['desktop, 2 GB', {}, 'dm=2'],
    ['desktop, Save-Data', {}, 'sd'],
    ['desktop, reduced motion', { reducedMotion: true }, ''],
    ['phone (touch, 390 px)', { width: 390, height: 844, touch: true }, ''],
    ['tablet (touch, 820 px)', { width: 820, height: 1180, touch: true }, ''],
    ['phone, user chose on', { width: 390, height: 844, touch: true, fx: 'on' }, ''],
    ['desktop, user chose off', { fx: 'off' }, ''],
  ];
  const out = [];
  for (const [name, o, sim] of cases) {
    const { page, context } = await open(
      browser,
      Object.assign({ fx: null }, o, {
        beforeGoto: async (p) => {
          await p.addInitScript((sim) => {
            const N = Navigator.prototype;
            Object.defineProperty(N, 'hardwareConcurrency', { get: () => (sim === 'hc=4' ? 4 : 8) });
            Object.defineProperty(N, 'deviceMemory', { get: () => (sim === 'dm=2' ? 2 : 8) });
            if (sim === 'sd') Object.defineProperty(N, 'connection', { get: () => ({ saveData: true }) });
          }, sim);
          if (o.touch) {
            const c = await p.context().newCDPSession(p);
            await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
            await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
            await c.send('Emulation.setDeviceMetricsOverride', {
              width: o.width,
              height: o.height,
              deviceScaleFactor: 2,
              mobile: true,
              screenWidth: o.width,
              screenHeight: o.height,
            });
          }
        },
      })
    );
    const r = await page.evaluate(() => ({
      off: document.documentElement.classList.contains('fx-off'),
      coarse: matchMedia('(pointer: coarse)').matches,
    }));
    out.push([name, r.off ? 'Off' : 'On']);
    await context.close();
  }
  return out;
}

async function measure(browser, root) {
  setRoot(root);
  const r = { root };
  process.stderr.write(`[perf] ${root}: start-up\n`);
  r.start = await startup(browser);
  process.stderr.write(`[perf] ${root}: idle, Effects on (${IDLE / 1000} s)\n`);
  r.on = await idle(browser, 'on', IDLE);
  process.stderr.write(`[perf] ${root}: idle, Effects off (${OFF_IDLE / 1000} s)\n`);
  r.off = await idle(browser, 'off', OFF_IDLE);
  process.stderr.write(`[perf] ${root}: idle, dark, Effects on (${OFF_IDLE / 1000} s)\n`);
  r.dark = await idle(browser, 'on', OFF_IDLE, true);
  process.stderr.write(`[perf] ${root}: idle, no live battle, Effects on (${OFF_IDLE / 1000} s)\n`);
  r.calm = await idle(browser, 'on', OFF_IDLE, false, true);
  process.stderr.write(`[perf] ${root}: 4x throttle\n`);
  r.thr = await throttled(browser);
  r.def = await defaults(browser);
  return r;
}

const f1 = (v) => (v == null || isNaN(v) ? '-' : v.toFixed(1));
const f0 = (v) => (v == null || isNaN(v) ? '-' : Math.round(v).toString());
function rows(r) {
  return [
    ['Start-up: FCP (ms)', f0(r.start.fcp)],
    ['Start-up: LCP (ms)', f0(r.start.lcp)],
    ['Start-up: DOMContentLoaded (ms)', f0(r.start.dcl)],
    ['Start-up: script time (ms)', f0(r.start.script)],
    ['Start-up: style recalc (ms)', f0(r.start.style)],
    ['Start-up: layout (ms)', f0(r.start.layout)],
    ['Start-up: main-thread total (ms)', f0(r.start.task)],
    ['Start-up: long tasks (n / ms)', f0(r.start.lt) + ' / ' + f0(r.start.ltms)],
    [`Idle ${IDLE / 1000}s, Effects on: CPU %`, f1(r.on.cpu)],
    ['Idle, Effects on: script ms/s', f1(r.on.script)],
    ['Idle, Effects on: style recalcs', f0(r.on.recalc)],
    ['Idle, Effects on: long tasks', f0(r.on.lt)],
    [`Idle ${OFF_IDLE / 1000}s, Effects off: CPU %`, f1(r.off.cpu)],
    ['Idle, Effects off: style recalcs', f0(r.off.recalc)],
    [`Idle ${OFF_IDLE / 1000}s, dark, Effects on: CPU %`, f1(r.dark.cpu)],
    ['Idle, dark, Effects on: style recalcs', f0(r.dark.recalc)],
    [`Idle ${OFF_IDLE / 1000}s, no live battle, Effects on: CPU %`, f1(r.calm.cpu)],
    ['Idle, no live battle, Effects on: style recalcs', f0(r.calm.recalc)],
    ['After idle (GC): JS heap MB', f1(r.on.heap)],
    ['After idle: DOM nodes', f0(r.on.nodes)],
    ['4x CPU, battle round: fps', f1(r.thr.battle.fps)],
    ['4x CPU, battle round: worst frame ms', f0(r.thr.battle.worst)],
    ['4x CPU, battle round: long tasks (n / max ms)', r.thr.blt[0] + ' / ' + f0(r.thr.blt[1])],
    ['4x CPU, d20 roll: fps', f1(r.thr.dice.fps)],
    ['4x CPU, d20 roll: worst frame ms', f0(r.thr.dice.worst)],
    ['4x CPU, d20 roll: long tasks (n / max ms)', r.thr.dlt[0] + ' / ' + f0(r.thr.dlt[1])],
    ...r.def.map(([n, v]) => ['Effects default: ' + n, v]),
  ];
}
function table(results) {
  const all = results.map(rows);
  const head = ['Metric', ...results.map((r) => path.basename(r.root))];
  const lines = all[0].map((row, i) => [row[0], ...all.map((a) => a[i][1])]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (l) => '| ' + l.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join(' | ') + ' |';
  return [
    fmt(head),
    '|' + w.map((n, i) => (i ? '-'.repeat(n + 1) + ':' : '-'.repeat(n + 2))).join('|') + '|',
    ...lines.map(fmt),
  ].join('\n');
}

(async () => {
  const browser = await launch();
  const roots = [path.resolve(process.env.DMB_ROOT || path.join(__dirname, '..'))];
  const vs = process.argv.indexOf('--vs');
  if (vs > 0 && process.argv[vs + 1]) roots.unshift(path.resolve(process.argv[vs + 1]));
  const res = [];
  for (const r of roots) res.push(await measure(browser, r));
  await browser.close();
  console.log(table(res));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
