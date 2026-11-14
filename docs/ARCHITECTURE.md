# Architecture

DM Assistance Board is a static site with no build step. Open `index.html` from disk (`file://`) or serve the folder (GitHub Pages). It uses plain `<link>` and classic `<script>` tags: no bundler, no ES modules (Chrome blocks module scripts on `file://`). Nothing loads local files with `fetch()`/XHR: data ships as `.js` files that assign globals, and the large ones are injected with `<script src>` on first use.

## Module map

```
index.html            markup shell: head metas + CSP, <link>/<script> tags, header/nav, #party, #dmSeat, footer, #overlay
css/
  base.css            fonts (@font-face, ../fonts/), design tokens, reset, typography, layout, core components;
                      then sections: vo-css (visual overhaul), th-css (light/dark theme tokens), world-css,
                      setup-help-css (setup checklist, help sheet, session night)
  intro.css           entry screen (neon d20 intro, the only neon in the app) - needed before first paint
  components.css      polish layers over base: sl-css (scene pills), dp-css, ve-css: the paper-cut tokens
                      (--pc-*, "storybook day" / "candlelit night") and the paper skin of panels, cards, sheets,
                      buttons, pills, turns, dice and toasts; then the data-safety layout rules
  table.css           around-the-table home layout (DM screen, seats) + opt-css: the paper-cut diorama table art
  dice.css            slot-machine dice reels
  effects.css         cue layer, the Effects button, torch guttering (no ambient layer, no glows)
  time-light.css      Time & light drawer
js/
  storage-shim.js     window.DMC: per-campaign namespacing of localStorage/sessionStorage/IndexedDB
  theme.js            sets html[data-mood="dungeon"] before first paint
  effects.js          window.__fx: intro, event cues, Effects toggle and its low-power default
  lazy-data.js        window.DMB_LAZY: loads data/bestiary.js, spells.js, items.js on first use
  app.js              the app (one IIFE): state, storage, rendering, battles, dice, notes, help, data safety
                      (checkBoard, damaged copies, save hold, last good copy, quota handling, undo across
                      reloads), campaigns
  motion.js           Web Animations on redraws (enter/exit ghosts, HP flash)
  table-ui.js         table DOM order + phone focus snapping; Time & light drawer
  backup.js           window.DMB_BACKUP: backup reminder, footer save-status line, recovery dialog,
                      persisted-undo planning (UI and pure logic; app.js keeps the writes and the save hold)
data/                                                                       loaded   size
  rules.js            DMB_DATA.rules    = { conditions, conditionText }      start-up   3 KB
  demo.js             DMB_DATA.demoBoard(h) -> fresh demo board             start-up  13 KB
                      ("The Drowned Bell"); h = { uid, today, S }
  bestiary.js         DMB_DATA.bestiary = { monsters: [[name, type, AC,      lazy      66 KB
                      init, HP, CR, XP, speed], ...], attacks: {name: [...]} }
  spells.js           DMB_DATA.spells   = { quick: [...hand-written quick    lazy      73 KB
                      reference], srd: [...SRD 5.2.1 spells] }
  items.js            DMB_DATA.items    = { srd: [...SRD 5.2.1 magic items] } lazy      38 KB
fonts/                self-hosted WOFF2 subsets + OFL licences
tests/                Playwright (Chromium) smoke, visual, screen sweep, computed-style, coverage, data-safety and
                      performance scripts (tests/README.md)
```

`app.js` is split into sections by banner comments: `/* ---------- name ---------- */`. Search for `/* ----------` to list them. The order is: helpers, home, sheet framework, views, story, sketchpad, world tracking, storyteller tools, character growth, start over, setup and help, backup, dice, v10 features, travel and calendar, SRD reference, reference data (lazy), data safety, more than one campaign. The boot code is the last statement.

## Load order

The order is the same as in the old single file, so the cascade and globals are unchanged.

1. `<head>`: all seven stylesheets, in cascade order: base, intro, components, table, dice, effects, time-light. Later files override earlier ones, so do not reorder them.
2. `<head>`, synchronous: `js/storage-shim.js`, then `js/theme.js`. The shim must run before anything touches storage. Both are tiny.
3. `<head>`, `defer`, in this order: `data/rules.js`, `data/demo.js`, `js/lazy-data.js`, `js/app.js`, `js/motion.js`, `js/table-ui.js`, `js/backup.js`. Deferred scripts run in document order, after parsing and before `DOMContentLoaded`.
4. `<body>`, first element, synchronous: `js/effects.js`. It builds the intro overlay before the board paints. This is the one script that is neither in `<head>` nor deferred, and that is on purpose.
5. On first use: `data/bestiary.js`, `data/spells.js` and `data/items.js`, all three together. See below.

## Reference data (lazy)

The bestiary, spells and magic items (177 KB) are not loaded at start-up. The flow is:

- `js/lazy-data.js` exposes `DMB_LAZY.load(name)` and `DMB_LAZY.loadAll(names)`. Each call injects `<script src="data/<name>.js">` once and returns a promise for `DMB_DATA[name]`. A second call returns the same promise. After a failure the next call tries again.
- `app.js` declares `MONSTERS`, `MON_BY_NAME`, `MM_ATK`, `SPELLS`, `SRD_IT` and `SRD_IT_BY` as empty containers. They are never reassigned. `applyRef()` fills them in place, once, when all three files are in. It also runs `syncHomebrew()` (homebrew monsters go after the SRD rows) and `mergeSpells()`.
- `withRef(fn)` runs `fn` at once if the data is loaded. Otherwise it queues `fn`, starts the load, sets `aria-busy` and a progress cursor on `<html>`, and runs the queue when the load ends.
- **Gates.** These are the only entry points that need the data, and each goes through `withRef`:
  - `openSheet()`, for every sheet except Player and Campaign (`REF_FREE`). Battles, Missions (loot links), Notes (search, encounter-table rows) and Session (travel encounters) all read the data.
  - `monCard()`, the monster card.
  - Home actions that roll monsters: wandering monsters from Dungeon turn, a scene's Set up battle (`slBattle`), and a road encounter (`encBattle`).
- **Rule for new code.** Code that reads those containers must run inside a gated sheet or behind `withRef(fn)`. Home-screen rendering must not read them.
- **If the load fails** (for example, the `data/` folder is missing), a toast explains the problem, the sheet opens without the data, and the next use tries again.
- **First run.** The demo board comes from `data/demo.js` (eager, because `load()` is synchronous at boot). It does not need the bestiary. The live demo battle stores its combatants' stats, so the home screen renders without the data. The data loads when the Battles sheet opens.

**To add a dataset:**

- *Eager (small, needed at boot):* create `data/<name>.js` that sets `window.DMB_DATA.<name> = {...}`. Add `<script defer src="data/<name>.js">` before `js/app.js` in `index.html`, then read it in `app.js`.
- *Lazy:* create the file in the same way and add it to `SRC` in `js/lazy-data.js`. Then either add it to `REF_SETS` in `app.js` and fill your containers in `applyRef()`, or call `DMB_LAZY.load('<name>').then(...)` yourself at the point of use.
- Keep data files to one record per line. Prettier skips `data/`.

## Globals

| Global | Set by | Used by |
|---|---|---|
| `window.DMC` | storage-shim.js | app.js (campaigns), effects.js (raw storage) |
| `window.DMB_DATA` | data/*.js | app.js (`CONDITIONS`, `COND_TEXT`, `demoBoard()` at start-up; the reference containers via `applyRef()`) |
| `window.DMB_LAZY` | lazy-data.js | app.js (`withRef`) |
| `window.__fx` | effects.js | table-ui.js (`__fx.sync`), app.js (optional hooks) |
| `window.DM_SHORTCUTS` | app.js | anything that wants to list a shortcut on the help sheet |
| `window.DDB_IMPORT`, `window.DM_TRAVEL` | app.js | read-only hooks for tests and tools |
| `html[data-mood]` | theme.js | table-ui.js `dg()` checks (no CSS depends on it any more) |
| `html[data-theme]` | app.js (`applyTheme`) | CSS: an explicit light/dark choice overrides the OS setting |

## Storage keys

All keys are in `localStorage` unless noted. Keys marked *per campaign* are namespaced by `DMC` for every campaign after the first, as `dm-board~<id>~<key>` (IndexedDB uses `<name>~<id>`).

| Key | Scope | What |
|---|---|---|
| `dm-board-v1` | per campaign | the board (JSON). `KEY` in app.js |
| `dm-board-v1-img` | per campaign | images (handouts, maps, sketch pages) |
| `dm-board-v1-damaged-<ts>` | per campaign | an unreadable save, kept aside (newest 3, no duplicates). The legacy `dm-board-v1-damaged` is still read. If localStorage is full the copy goes to IndexedDB `kv['damaged:<ts>']` |
| `dm-board-v1-at`, `dm-board-v1-nag` | per campaign | last backup time, and the reminder snooze (an ms timestamp; the legacy date form is still read) |
| `dm-board-backup-prefs` | shared | reminder and undo preferences `{v, remind, days, keepUndo}` (in the shim's `GLOBAL` map) |
| `dm-board-v1-erased` | per campaign, sessionStorage | flag set by "erase everything" across the reload |
| `dm-board-safety` | per campaign, IndexedDB | restore points (data safety), plus the `kv` store: `good` (last good copy, written 5 s after a successful save), `undo:<seq>` and `undoHead` (undo across reloads: 20 steps, 2 MB, checked against an FNV-1a hash of the loaded board), `damaged:<ts>` |
| `dm-board-theme` | shared | auto / light / dark |
| `dm-board-mood` | shared | legacy, always Dungeon |
| `dm-board-campaigns`, `dm-board-campaign-tab`, `dm-board-campaign-do` | shared | campaign list, the open campaign, a pending campaign action |
| `dm-board-pv-seen` | per campaign | one-time hint |
| `ve-fx` | per campaign | Effects on/off, set only by the user's choice. Unset = the default: off on touch phones/tablets, <= 4 cores, <= 4 GB, Save-Data or reduced motion; on otherwise |

## Data flow

1. **Boot.** `load()` reads `dm-board-v1`, or builds the demo the first time. Every load, undo and backup import passes through `normalize()`, so damaged or hand-edited data cannot break the board. Then `render()` draws the home screen.
2. **Changes.** A user action changes the board state `S`. It then calls `commit()`/`save()`, which writes `localStorage` (and restore points, see data safety), and `render()`.
   - `render()` redraws regions with `innerHTML`.
   - If a sheet is open, `drawSheet()` redraws it from `VIEWS[section][tab]()`, which returns `{ html, bind }`.
3. **Layering.** Later sections of app.js extend earlier ones by wrapping a function's current binding, for example `const r = render; render = () => { r(); ... }`. Keep that pattern: wrap the current binding and never replace the original declaration.

## Data safety

- **Load.** `load()` runs `checkBoard()` (which uses `normalize()` on a copy). A save that doesn't parse, has the wrong shape, or would lose a player or more than 25 % of a list of 4 or more is *damaged*: its raw text is kept as a damaged copy and the **save hold** starts. While the hold is on nothing writes `dm-board-v1` (save, undo, image lifting, the backup file, restore points, the last good copy, persisted undo and campaign sync all skip), and `backup.js` shows the recovery dialog: last good copy, restore points, the backup file, load a file, download the damaged data, or start fresh. Any of those, or an import, ends the hold.
- **Save errors.** Quota errors prune images and show the `#saveWarn` banner (Save backup now, See what uses space); other storage errors show a "blocked" message. IndexedDB quota errors clear undo, prune restore points to 6 and retry once.
- **Backups.** The reminder bar (`#safebar[data-kind=remind]`) follows `dm-board-backup-prefs`. A linked backup file is rewritten after changes (60 s max wait) and at session end. The footer's `#saveState` line (`data-state` = hold/stale/blocked/full/file/paused/failed/local) opens Campaign → Data.
- **Imports** are capped at 50 MB, checked for `_meta.app`/`_meta.format` and passed through `checkBoard()`; a partly damaged backup asks before loading what can be read.
- `backup.js` loads after app.js. app.js reaches it through `BK()`/`withBK()`; if the file is missing, the reminder, status line and dialog are absent but the hold still protects the data. `tests/data-safety.js` covers it.

## How Effects and motion hook in (non-invasively)

`js/effects.js` and `js/motion.js` never call, patch or replace app code.

- **effects.js.** It watches the board with a `MutationObserver` and class changes (for example, a new `.cb.cur` row, a nat-20 result, an HP change). It then plays cues with Web Animations. It writes only these to app nodes:
  - WAAPI transforms and opacity
  - `data-fx="conc"` on card pills
  - `inert` on `.wrap`/`#overlay` while the intro is open

  Every entry point is wrapped in try/catch, so a failure only turns the effects off. The Effects toggle sets `html.fx-off` and stores `ve-fx`. Other classes on `<html>`: `fx-rm` (reduced motion), `fx-hold` (a sheet, popup or the Time & light drawer covers the table), `fx-paused` (tab hidden), `fx-battle`. Cues are short, inline-styled paper shapes in `#fx-top` (confetti, ink splats, tears, ribbon drops, rings), all limited by one flash gate (at most 2 per second, at least 400 ms apart); there are no glows or full-screen washes. The only loops are the diorama campfire (`Efire` in table.css) and torch guttering; both stop under `fx-off`/`fx-rm` and pause under `fx-hold`/`fx-paused`. `tests/perf.js` measures start-up, idle CPU, frame rate and the Effects default.
- **motion.js.** When a region is redrawn, it reads the old values from the removed nodes and animates the new nodes (transform and opacity, plus a colour flash on a changed HP number). The exit "ghost" plays inside a closed shadow root that clones the page's `<link>` stylesheets, so a query can never find it and it never receives a click. Nothing runs under reduced motion.
- **table-ui.js.** It moves `aside.side-col` before the party column (DOM order = visual order), snaps focus on phones, and turns `#dmSeat` into the Time & light drawer. All of this happens without touching app state.

## Content-Security-Policy

The CSP is set by a meta tag in `index.html`:

```
default-src 'none'; script-src 'self' file:; style-src 'self' file: 'unsafe-inline';
style-src-elem 'self' file:; style-src-attr 'unsafe-inline'; font-src 'self' file:;
img-src 'self' data: blob:; connect-src https://character-service.dndbeyond.com;
base-uri 'none'; form-action 'none'; object-src 'none'
```

- There are no inline scripts and no inline event handlers, so `script-src` has no `'unsafe-inline'`. Lazily injected data scripts are same-origin files, so `'self' file:` covers them.
- `style-src-attr 'unsafe-inline'` is needed because the app's HTML templates use `style="..."` attributes (widths, `--i` indices, progress bars). Inline `<style>` elements are blocked by `style-src-elem`.
- `style-src` also keeps `'unsafe-inline'`, but only as a fallback for older browsers that don't support `-elem`/`-attr`. Modern browsers use the two specific directives instead.
- `file:` sits next to `'self'` because browsers differ on whether `'self'` matches `file://` URLs. It has no effect over https.
- The only network host is the D&D Beyond character endpoint, used by the import feature.

## Tests

See `tests/README.md`. In short: `npm test` (smoke), `npm run test:visual` (13 key screens against `tests/baseline/`), `node tests/data-safety.js` (recovery, quota, reminder, undo after reload, backup file), `node tests/perf.js` (start-up, idle CPU, frame rate, Effects default), `node tests/screens.js` (about 90 screens, any tree against any other), `tests/styles.js` (computed styles, for CSS refactors), `npm run lint`, `npm run format:check`.

## Conventions

- **Formatting.** Prettier with `printWidth` 120 and single quotes. EditorConfig: 2 spaces, LF.
- **Data files** are generated, with one record per line. Edit the data, not the format.
- **Header comments.** Every module starts with a header comment that gives its purpose and dependencies.
- **CSS cascade.** Later files win.
  - Many selectors start with `:root `. They used to start with `:root[data-mood="dungeon"]`, and the mood layer is gone. All of them lost the same one attribute of specificity. The `tests/styles.js` diff against the single-file baseline is 0, so this changed nothing.
  - Keep conditions that apply only to `<html>` qualified with `:root`, for example `:root:not([data-theme='light'])`. A bare `:not([data-theme='light'])` matches every element.
  - Remove or change a `:root` prefix only if the `tests/styles.js` diff stays at 0.
- **Repeated selectors.** Some selectors appear more than once in a file. These are real layers: a rule in between targets the same elements. Rules that could be folded safely have been folded. Before you merge two of them, check with `tests/styles.js`.
