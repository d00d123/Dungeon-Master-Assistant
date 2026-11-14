/* Lazy data loader (window.DMB_LAZY). Loads the large reference data files on first use instead of at start-up.
   Works from file:// and https: it injects a classic <script src> (no fetch/XHR, no modules), which the CSP allows
   through script-src 'self' file:. Each data file assigns window.DMB_DATA[name].
     DMB_LAZY.load('bestiary')                 -> Promise<DMB_DATA.bestiary>   (idempotent; retried after a failure)
     DMB_LAZY.loadAll(['bestiary', 'spells'])  -> Promise<[...]>
     DMB_LAZY.ready('bestiary')                -> boolean
   No dependencies. Deferred, before js/app.js (which decides when to load; see its "reference data" section).
   To add a lazy dataset: create data/<name>.js that sets window.DMB_DATA.<name>, and list it in SRC below. */
(function () {
  'use strict';
  var SRC = {
    bestiary: 'data/bestiary.js',
    spells: 'data/spells.js',
    items: 'data/items.js',
  };
  var pending = {};

  function data() {
    return (window.DMB_DATA = window.DMB_DATA || {});
  }
  function ready(name) {
    return !!data()[name];
  }
  function load(name) {
    if (pending[name]) return pending[name];
    if (ready(name)) return (pending[name] = Promise.resolve(data()[name]));
    if (!SRC[name]) return Promise.reject(new Error('Unknown data set: ' + name));
    pending[name] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var fail = function (why) {
        delete pending[name]; // let a later call try again
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error('Could not load ' + SRC[name] + ' (' + why + ')'));
      };
      s.src = SRC[name];
      s.onload = function () {
        if (ready(name)) resolve(data()[name]);
        else fail('it did not set DMB_DATA.' + name);
      };
      s.onerror = function () {
        fail('missing or blocked');
      };
      document.head.appendChild(s);
    });
    return pending[name];
  }
  function loadAll(names) {
    return Promise.all(names.map(load));
  }

  window.DMB_LAZY = { load: load, loadAll: loadAll, ready: ready, SRC: SRC };
})();
