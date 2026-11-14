/* Sets html[data-mood="dungeon"] before first paint. Loaded synchronously in <head>; no dependencies.
   The board has one look ("Dungeon"). The CSS no longer depends on this attribute, but js/effects.js and
   js/table-ui.js still check it (dg()), so it stays. The light/dark theme is applied by js/app.js (applyTheme). */
document.documentElement.setAttribute('data-mood', 'dungeon');
