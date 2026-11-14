#!/usr/bin/env node
/* Computed-style snapshot (refactoring safety net for CSS work).
   Visits many app states and records getComputedStyle for every element and its ::before/::after.
   Use it to prove a CSS refactor changes nothing that renders:
     node tests/styles.js snap  /tmp/before.json     (on the old version)
     node tests/styles.js snap  /tmp/after.json      (on the new version)
     node tests/styles.js diff  /tmp/before.json /tmp/after.json
     DMB_ROOT_A=/path/to/old/tree node tests/styles.js diff A.json B.json --detail   (property-level diffs)
   Also used by tests/coverage.js for the list of states. Hover/focus states are not covered. */
'use strict';
const fs = require('fs');
const { launch, open, enter, wait } = require('./lib');
/* (lib.setRoot lets the --detail mode open an older tree for comparison) */

const FIXED_TIME = new Date('2026-11-08T21:30:00');
const PAUSE = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
const TABS = [
  'live',
  'new',
  'plans',
  'map',
  'bestiary',
  'homebrew',
  'spells',
  'items',
  'dice',
  'conditions',
  'rules',
  'history',
];

/* Each state: [name, viewport, dark, async (page) => reach state]. Returns to home between states by reloading. */
function states() {
  const S = [];
  const nav = (open, sub) => async (p) => {
    await p.click(`.navb[data-open="${open}"]`);
    await wait(p, 350);
    if (sub) {
      const t = await p.$(`#overlay [data-sub="${sub}"]`);
      if (t) {
        await t.click();
        await wait(p, 350);
      }
    }
  };
  for (const [w, dark] of [
    [1280, false],
    [1280, true],
    [390, false],
    [390, true],
  ]) {
    S.push([`home-${w}-${dark ? 'dark' : 'light'}`, w, dark, async () => {}]);
    S.push([
      `tl-${w}-${dark ? 'dark' : 'light'}`,
      w,
      dark,
      async (p) => {
        await p.click('#tlBtn');
        await wait(p, 400);
      },
    ]);
    S.push([`live-${w}-${dark ? 'dark' : 'light'}`, w, dark, nav('battle', 'live')]);
  }
  for (const t of TABS) S.push([`battle-${t}`, 1280, false, nav('battle', t)]);
  for (const t of TABS.slice(0, 6)) S.push([`battle-${t}-390d`, 390, true, nav('battle', t)]);
  S.push(['missions', 1280, false, nav('mission')]);
  S.push(['notes', 1280, false, nav('notes')]);
  S.push(['notes-390d', 390, true, nav('notes')]);
  S.push(['missions-390d', 390, true, nav('mission')]);
  const subtabs = async (p, open) => {
    await nav(open)(p);
    return p.$$eval('#overlay [data-sub]', (a) => a.map((e) => e.getAttribute('data-sub')));
  };
  S.push(['__expand_notes', 1280, false, (p) => subtabs(p, 'notes')]);
  S.push(['__expand_mission', 1280, false, (p) => subtabs(p, 'mission')]);
  /* sheets opened from home controls rather than the nav: Session (#sPlan), Campaign (#editDm), Player (a name) */
  const opened = (sel) => async (p) => {
    await p.click(sel);
    await wait(p, 450);
    return p.$$eval('#overlay [data-sub]', (a) => a.map((e) => e.getAttribute('data-sub')));
  };
  S.push(['__expand_session', 1280, false, opened('#sPlan')]);
  S.push(['__expand_campaign', 1280, false, opened('#editDm')]);
  S.push(['__expand_player', 1280, false, opened('#party .cname')]);
  const click =
    (...sels) =>
    async (p) => {
      for (const s of sels) {
        await p.click(s);
        await wait(p, 450);
      }
    };
  S.push(['level-up', 1280, false, click('#party .cname', '#pLvUp')]);
  S.push(['party-short-rest', 1280, false, click('#tlBtn', '#partyShort')]);
  S.push(['party-long-rest', 1280, true, click('#tlBtn', '#partyRest')]);
  S.push([
    'search-results',
    1280,
    false,
    async (p) => {
      await nav('notes', 'search')(p);
      await p.fill('#sq', 'bell');
      await wait(p, 400);
    },
  ]);
  S.push([
    'party-sheet',
    1280,
    false,
    async (p) => {
      await p.click('#party .cname');
      await wait(p, 450);
    },
  ]);
  S.push([
    'party-sheet-390d',
    390,
    true,
    async (p) => {
      await p.click('#party .cname');
      await wait(p, 450);
    },
  ]);
  S.push([
    'dice-roll',
    1280,
    false,
    async (p) => {
      await p.keyboard.press('d');
      await wait(p, 400);
      await p.click('[data-face="20"]');
      await wait(p, 2500);
    },
  ]);
  S.push([
    'dice-group',
    1280,
    true,
    async (p) => {
      await p.keyboard.press('d');
      await wait(p, 400);
      await p.click('[data-dtab="group"]');
      await wait(p, 300);
    },
  ]);
  S.push([
    'dice-sweep',
    390,
    false,
    async (p) => {
      await p.keyboard.press('d');
      await wait(p, 400);
      await p.click('[data-dtab="sweep"]');
      await wait(p, 300);
    },
  ]);
  S.push([
    'monster-card',
    1280,
    false,
    async (p) => {
      await nav('battle', 'bestiary')(p);
      await p.fill('#bf', 'dragon');
      await wait(p, 300);
      await p.click('#overlay [data-mon]');
      await wait(p, 400);
    },
  ]);
  S.push([
    'help',
    1280,
    false,
    async (p) => {
      await p.keyboard.press('?');
      await wait(p, 400);
    },
  ]);
  S.push([
    'jot',
    1280,
    false,
    async (p) => {
      await p.click('#jotBtn');
      await wait(p, 400);
    },
  ]);
  S.push([
    'sketch',
    1280,
    false,
    async (p) => {
      await p.click('#skBtn');
      await wait(p, 500);
    },
  ]);
  S.push([
    'campaign',
    1280,
    false,
    async (p) => {
      await p.click('#editDm');
      await wait(p, 400);
    },
  ]);
  S.push([
    'tonight',
    1280,
    false,
    async (p) => {
      await p.click('#sPlan');
      await wait(p, 400);
    },
  ]);
  S.push([
    'wrap',
    1280,
    true,
    async (p) => {
      await p.click('#sWrap');
      await wait(p, 400);
    },
  ]);
  S.push([
    'load-backup-confirm',
    1280,
    false,
    async (p) => {
      const [d] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
      const f = require('path').join(require('os').tmpdir(), 'dmb-styles-bk.json');
      await d.saveAs(f);
      await p.setInputFiles('#importFile', f);
      await wait(p, 700);
    },
  ]);
  /* explicit theme choice (html[data-theme]): the theme button cycles auto -> light -> dark */
  S.push(['theme-light-on-dark-os', 1280, true, click('#themeBtn')]);
  S.push(['theme-dark-on-light-os', 1280, false, click('#themeBtn', '#themeBtn')]);
  S.push(['theme-dark-battle', 390, false, click('#themeBtn', '#themeBtn', '.navb[data-open="battle"]')]);
  S.push([
    'effects-off',
    1280,
    true,
    async (p) => {
      await p.click('#fxBtn');
      await wait(p, 300);
    },
  ]);
  S.push([
    'new-battle-init',
    1280,
    false,
    async (p) => {
      await nav('battle', 'live')(p);
      await p.click('#overlay [data-end="Victory"]');
      await wait(p, 500);
      for (let i = 0; i < 3; i++) {
        const pri = await p.$('#mcard .btn.pri');
        if (!pri) break;
        await pri.click();
        await wait(p, 400);
      }
      await p.click('#overlay [data-sub="new"]');
      await wait(p, 350);
      await p.fill('#nf', 'goblin');
      await wait(p, 250);
      await p.click('#overlay [data-inc]');
      await wait(p, 250);
      await p.click('#bStart');
      await wait(p, 500);
    },
  ]);
  S.push([
    'empty-board',
    1280,
    false,
    async (p) => {
      await p.evaluate(() => {
        localStorage.clear();
      });
      await p.reload();
      await wait(p, 900);
      await p.keyboard.press('Escape');
      await wait(p, 900);
    },
  ]);
  S.push(['entry-rm', 1280, false, null]);
  S.push(['entry-rm-390d', 390, true, null]);
  return S;
}

async function pageFor(browser, w, dark) {
  const o = await open(browser, {
    width: w,
    height: w > 500 ? 900 : 844,
    dark,
    reducedMotion: true,
    seed: true,
    bypassCSP: true,
    beforeGoto: async (p) => p.clock.setFixedTime(FIXED_TIME),
  });
  return o;
}

/* Visit every state and call fn(page, name). Expands notes/mission sub-tabs. */
async function visit(browser, fn, only) {
  const errs = [];
  const list = states().filter(
    ([n]) => !only || only.some((o) => o === n || (n.startsWith('__expand_') && o.startsWith(n.slice(9) + '-')))
  );
  const run = async ([name, w, dark, go]) => {
    const o = await pageFor(browser, w, dark);
    try {
      if (go) await enter(o.page);
      if (name.startsWith('__expand_')) {
        const open = name.slice(9);
        const subs = await go(o.page);
        for (const sub of subs) {
          await o.page.click(`#overlay [data-sub="${sub}"]`).catch(() => {});
          await wait(o.page, 350);
          await fn(o.page, `${open}-${sub}`);
        }
      } else {
        if (go) await go(o.page);
        await fn(o.page, name);
      }
    } catch (e) {
      errs.push(name + ': ' + e.message.split('\n')[0]);
    }
    errs.push(...o.errors.map((e) => name + ': ' + e));
    await o.context.close();
  };
  const queue = list.slice();
  const CONC = Number(process.env.DMB_CONC || 4);
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (queue.length) await run(queue.shift());
    })
  );
  return errs;
}

/* Returns { elementKey: hash } (or full "prop:value;" strings when full=true, optionally only for some keys). */
async function snapshot(page, full = false, only = null) {
  await page.addStyleTag({ content: PAUSE });
  await wait(page, 150);
  return page.evaluate(
    ([full, only]) => {
      const out = {};
      const want = only ? new Set(only) : null;
      const key = (e) => {
        const parts = [];
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
          let i = 0;
          for (let s = n; (s = s.previousElementSibling);) if (!/^(STYLE|SCRIPT|LINK)$/.test(s.tagName)) i++;
          parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + ':' + i);
        }
        return parts.join('>');
      };
      const ser = (cs) => {
        // custom-property enumeration order is not stable, so sort; entries are separated by \u0001
        const names = [];
        for (let i = 0; i < cs.length; i++) names.push(cs[i]);
        names.sort();
        let s = '';
        // custom properties keep their source text, so normalise formatting-only differences (spaces, quotes, leading 0)
        const normVar = (v) =>
          v
            .replace(/\s+/g, '')
            .replace(/'/g, '"')
            .replace(/(^|[^\d.])0\./g, '$1.');
        for (const n of names)
          s += n + ':' + (n.startsWith('--') ? normVar(cs.getPropertyValue(n)) : cs.getPropertyValue(n)) + '\u0001';
        return s;
      };
      const hash = (s) => {
        let h1 = 0x811c9dc5,
          h2 = 0x1234567;
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          h1 = Math.imul(h1 ^ c, 16777619);
          h2 = Math.imul(h2 ^ c, 2246822519);
        }
        return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
      };
      const put = (k, cs) => {
        if (want && !want.has(k)) return;
        const s = ser(cs);
        out[k] = full ? s : hash(s);
      };
      for (const e of document.querySelectorAll('body *')) {
        if (e.tagName === 'STYLE' || e.tagName === 'SCRIPT') continue;
        const k = key(e) + '.' + [...e.classList].join('.');
        put(k, getComputedStyle(e));
        for (const ps of ['::before', '::after']) {
          const c = getComputedStyle(e, ps);
          if (c.content && c.content !== 'none' && c.content !== 'normal') put(k + ps, c);
        }
      }
      put('html', getComputedStyle(document.documentElement));
      put('body', getComputedStyle(document.body));
      return out;
    },
    [full, only]
  );
}

function propDiff(A, B) {
  const parse = (x) =>
    Object.fromEntries(
      x
        .split('\u0001')
        .filter(Boolean)
        .map((y) => {
          const i = y.indexOf(':');
          return [y.slice(0, i), y.slice(i + 1)];
        })
    );
  const pa = parse(A),
    pb = parse(B),
    r = [];
  for (const p of new Set([...Object.keys(pa), ...Object.keys(pb)]))
    if (pa[p] !== pb[p]) r.push(`${p}: [${pa[p]}] -> [${pb[p]}]`);
  return r;
}

/* Compare two hash snapshots; returns { state: [keys] } of differing elements. */
function diff(a, b) {
  const res = {};
  let total = 0;
  for (const st of Object.keys(a)) {
    if (!b[st]) {
      console.log('missing state in B: ' + st);
      continue;
    }
    const A = a[st],
      B = b[st];
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (A[k] === B[k]) continue;
      total++;
      (res[st] ||= []).push(k + (!A[k] ? '  (added)' : !B[k] ? '  (removed)' : ''));
    }
  }
  for (const [st, l] of Object.entries(res)) {
    console.log(`\n${st}: ${l.length}`);
    l.slice(0, 8).forEach((x) => console.log('   ' + x.slice(-140)));
  }
  console.log(`\n${total} differing element styles`);
  return res;
}

module.exports = { states, visit, pageFor, snapshot, PAUSE };

if (require.main === module) {
  const [cmd, f1, f2] = process.argv.slice(2);
  if (cmd === 'diff') {
    const r = diff(JSON.parse(fs.readFileSync(f1)), JSON.parse(fs.readFileSync(f2)));
    if (f2 && process.argv[5] === '--detail') {
      /* Re-visit the differing states on both trees (A root from DMB_ROOT_A, B from DMB_ROOT) and print property diffs. */
      (async () => {
        const browser = await launch();
        const lib = require('./lib');
        const keys = Object.fromEntries(
          Object.entries(r).map(([st, l]) => [st, l.map((x) => x.replace(/ {2}\((added|removed)\)$/, ''))])
        );
        const full = {};
        for (const side of ['A', 'B']) {
          lib.setRoot(side === 'A' ? process.env.DMB_ROOT_A : process.env.DMB_ROOT || lib.ROOT);
          full[side] = {};
          await visit(
            browser,
            async (p, name) => {
              if (keys[name]) full[side][name] = await snapshot(p, true, keys[name].slice(0, 40));
            },
            Object.keys(keys)
          );
        }
        for (const st of Object.keys(keys))
          for (const k of keys[st].slice(0, 40)) {
            const A = (full.A[st] || {})[k],
              B = (full.B[st] || {})[k];
            if (!A || !B) continue;
            console.log(`\n[${st}] ${k.slice(-120)}\n   ` + propDiff(A, B).join('\n   '));
          }
        await browser.close();
      })();
    } else process.exit(Object.keys(r).length ? 1 : 0);
  } else if (cmd === 'snap') {
    (async () => {
      const browser = await launch();
      const all = {};
      const errs = await visit(browser, async (p, name) => {
        all[name] = await snapshot(p);
      });
      await browser.close();
      fs.writeFileSync(f1, JSON.stringify(all));
      console.log(
        Object.keys(all).length +
          ' states, ' +
          Object.values(all).reduce((n, s) => n + Object.keys(s).length, 0) +
          ' element styles -> ' +
          f1
      );
      if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
    })();
  } else {
    console.log(
      'usage: node tests/styles.js snap OUT.json | diff A.json B.json [--detail]  (detail: DMB_ROOT_A=old tree)'
    );
  }
}
