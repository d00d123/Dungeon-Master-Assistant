# Tests (internal dev tooling)

These are regression checks for refactoring. They are not shipped with the app, and the app has no runtime dependencies.

## Requirements

- Node 18 or later.
- The preinstalled `playwright` module, Chromium only. The scripts never download browsers, so do not run `playwright install`.
- `npm install` once, for ESLint, Prettier and PostCSS. The browser tests themselves only need `playwright`.

## Determinism

The browser tests are set up to give the same result on every run:

- They open `index.html` over `file://`.
- `Math.random` is seeded in `addInitScript`, so dice, ids and cues repeat.
- `localStorage['ve-fx']` is seeded to `'on'` (when unset), so the low-power Effects default does not depend on the machine (headless Chromium reports 2 cores). Pass `fx: null` to `open()` to test the default.
- The clock is frozen at `2026-11-08 21:30` (`page.clock.setFixedTime`).
- Reduced motion is on, so the entry screen is a static frame.
- A style tag pauses all animations and transitions.
- `DMB_ROOT=/path/to/tree` points any script at another checkout.

## Scripts

| Command | What it checks | Time |
|---|---|---|
| `npm test` (`tests/smoke.js`) | Clicks through the core features (see below). Fails on any page error, console error, CSP violation or network request | ~1 min |
| `npm run test:visual` | 13 key screens compared with `tests/baseline/`. A screen fails if more than 0.05 % of its pixels differ by more than 16/255. Diff images go to `tests/output/*.diff.png` | ~1 min |
| `npm run test:visual:update` | Re-records `tests/baseline/`. Use it only after an intended visual change, and review the PNGs | ~1 min |
| `node tests/screens.js capture DIR` | About 90 screens: every tab of every sheet, dialogs, dice, rests, level up, light/dark/explicit theme, 1280/390 | ~1 min |
| `node tests/screens.js compare A B` | Pixel-compares two captures. Diff images go to `B/diff/` | ~10 s |
| `node tests/styles.js snap OUT.json` / `diff A.json B.json [--detail]` | Computed style of every element and `::before`/`::after` in the same ~90 states. Use it for CSS refactors. `--detail` needs `DMB_ROOT_A` | ~1.5 min |
| `npm run test:coverage` | CSS selectors that never match in any state. These are candidates only: grep `js/` before deleting, because class names are often built in JS | ~1.5 min |
| `node tests/data-safety.js` | Recovery from a damaged save, import checks, quota errors, the backup reminder, undo after a reload, the backup file (OPFS mock), the D&D Beyond box. Runs on a tiny localhost server (`DMB_FILE=1` forces `file://`); `ONLY=<regex>` runs a subset | ~1 min |
| `node tests/perf.js [--vs <other tree>]` | Start-up timings, idle CPU and style recalcs, frame rate under 4x CPU throttle, the Effects default on simulated devices. Not part of `npm test` | ~3 min per tree |
| `npm run lint` / `npm run format:check` | ESLint (flat config) / Prettier | seconds |

The smoke test covers:

- the entry screen
- party HP and the party sheet
- Time & light
- the lazy reference data: not loaded at start-up, then loaded when the Battles sheet opens
- live battle: damage, heal, conditions and turns
- the encounter builder
- the bestiary and the monster card
- spells and items
- dice
- theme and Effects
- a backup round-trip
- the CSP (the D&D Beyond host is allowed, other hosts are blocked)
- no horizontal scroll at 360 and 390
- a missing data file (degrades gracefully, then a retry works)
- reduced motion

## Comparing two trees

```
git archive <commit> | tar -x -C /tmp/base          # any earlier commit
DMB_ROOT=/tmp/base node tests/screens.js capture /tmp/shots-a
node tests/screens.js capture /tmp/shots-b
node tests/screens.js compare /tmp/shots-a /tmp/shots-b
DMB_ROOT=/tmp/base node tests/styles.js snap /tmp/st-a.json
node tests/styles.js snap /tmp/st-b.json
node tests/styles.js diff /tmp/st-a.json /tmp/st-b.json
```

