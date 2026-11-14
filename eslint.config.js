// ESLint flat config. Run: npm run lint
'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'tests/output/', 'tests/baseline/'] },
  js.configs.recommended,
  {
    // Browser scripts: classic <script> files sharing a few globals (no modules, no bundler).
    files: ['js/**/*.js', 'data/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        DMB_DATA: 'readonly', // data/*.js
        DMC: 'readonly', // js/storage-shim.js
        __fx: 'readonly', // js/effects.js
      },
    },
    rules: {
      // empty catch blocks are deliberate (storage/DOM guards that must never throw)
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    // app.js wraps its own function declarations (setup/help, search, safety layers re-assign render, save, ...)
    // so features can extend each other without editing them. That is intentional.
    files: ['js/app.js'],
    rules: { 'no-func-assign': 'off' },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  {
    // page.evaluate callbacks in tests run in the browser
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
