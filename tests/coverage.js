#!/usr/bin/env node
/* Selector coverage: which CSS selectors never match any element across the app states in tests/styles.js.
   Dynamic pseudo-classes (:hover, :focus...) and pseudo-elements are stripped before matching.
   Run: npm run test:coverage [-- --json out.json]
   A selector listed here is only a candidate for deletion: states not visited (rare dialogs, errors, hover)
   and class names built in JS may still use it. Grep js/ before deleting. */
'use strict';
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { launch, ROOT } = require('./lib');
const { visit } = require('./styles');

const CSS_DIR = path.join(ROOT, 'css');
const DYN =
  /::?(before|after|placeholder|selection|backdrop|marker|first-letter|first-line|-webkit-[\w-]+|-moz-[\w-]+)\b|:(hover|focus-visible|focus-within|focus|active|visited|target)\b/g;

function selectors() {
  const out = [];
  for (const f of fs.readdirSync(CSS_DIR).filter((x) => x.endsWith('.css'))) {
    const root = postcss.parse(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
    root.walkRules((r) => {
      if (r.parent && r.parent.type === 'atrule' && /keyframes$/.test(r.parent.name)) return;
      for (const s of r.selectors)
        out.push({
          file: f,
          line: r.source.start.line,
          sel: s,
          test:
            s
              .replace(DYN, '')
              .replace(/:not\(\s*\)/g, '')
              .trim() || '*',
        });
    });
  }
  return out;
}

(async () => {
  const list = selectors();
  const tests = [...new Set(list.map((x) => x.test))];
  const matched = new Set();
  const browser = await launch();
  const errs = await visit(browser, async (page) => {
    const hit = await page.evaluate(
      (T) =>
        T.filter((s) => {
          try {
            return !!document.querySelector(s);
          } catch (e) {
            return true;
          }
        }),
      tests.filter((t) => !matched.has(t))
    );
    hit.forEach((h) => matched.add(h));
  });
  await browser.close();
  const unused = list.filter((x) => !matched.has(x.test));
  const i = process.argv.indexOf('--json');
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(unused, null, 1));
  const byFile = {};
  unused.forEach((u) => (byFile[u.file] = (byFile[u.file] || 0) + 1));
  console.log(`${list.length} selectors, ${unused.length} never matched`, byFile);
  if (i < 0) unused.slice(0, 400).forEach((u) => console.log(`${u.file}:${u.line}  ${u.sel}`));
  if (errs.length) console.log('state errors:\n' + errs.join('\n'));
})();
