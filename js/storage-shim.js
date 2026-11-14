/* Campaign storage namespacing (window.DMC). Must run first, synchronously, before any other script
   touches localStorage/sessionStorage/IndexedDB. No dependencies. */
/* More than one campaign: storage namespacing.
   Runs before every other script on the page. Each campaign gets its own slice of
   localStorage, sessionStorage and IndexedDB, so every saved key, today's and any
   added later, follows the open campaign without the rest of the board knowing.
   The first campaign keeps the original names ('dm-board-v1', 'dm-board-safety'),
   so an existing board opens unchanged as campaign 1. Others are stored as
   'dm-board~<id>~<key>' and IndexedDB '<name>~<id>'. The light/dark theme, the mood and
   the campaign list itself are shared by every campaign. */
(function () {
  'use strict';
  var REG = 'dm-board-campaigns',
    PIN = 'dm-board-campaign-tab',
    PFX = 'dm-board~';
  var GLOBAL = { 'dm-board-theme': 1, 'dm-board-mood': 1, 'dm-board-backup-prefs': 1 };
  GLOBAL[REG] = 1;
  GLOBAL[PIN] = 1;
  var LS = null,
    SS = null;
  try {
    LS = window.localStorage;
  } catch (e) {}
  try {
    SS = window.sessionStorage;
  } catch (e) {}
  // boards saved before November 2026 kept other campaigns under 'dmc~<id>~': move them once (a key is dropped only after its copy is written)
  [LS, SS].forEach(function (st) {
    if (!st) return;
    rawKeys(st).forEach(function (k) {
      if (k.indexOf('dmc~') !== 0) return;
      try {
        var nk = PFX + k.slice(4);
        if (st.getItem(nk) == null) st.setItem(nk, st.getItem(k));
        st.removeItem(k);
      } catch (e) {}
    });
  });
  var ID_RE = /^c[1-9]\d{0,5}$/;
  function clean(r) {
    var ok = r && typeof r === 'object' && Array.isArray(r.list);
    var out = { v: 1, active: 'c1', next: 2, list: [] },
      seen = {};
    if (ok)
      r.list.forEach(function (c) {
        if (c && ID_RE.test(c.id) && !seen[c.id]) {
          seen[c.id] = 1;
          out.list.push({
            id: c.id,
            name: typeof c.name === 'string' ? c.name.slice(0, 120) : '',
            at: +c.at || 0,
            used: +c.used || 0,
            del: +c.del || 0,
          });
        }
      });
    if (!seen.c1 && !(ok && r.c1gone)) out.list.unshift({ id: 'c1', name: '', at: 0, used: 0, del: 0 });
    if (ok && r.c1gone) out.c1gone = 1;
    var max = 1;
    out.list.forEach(function (c) {
      max = Math.max(max, +c.id.slice(1));
    });
    out.next = Math.max(max + 1, (ok && +r.next) || 0);
    out.active = ok && ID_RE.test(r.active) ? r.active : 'c1';
    return out;
  }
  function readReg() {
    var r = null;
    try {
      r = JSON.parse(LS.getItem(REG));
    } catch (e) {}
    return clean(r);
  }
  function writeReg(r) {
    try {
      LS.setItem(REG, JSON.stringify(clean(r)));
      return true;
    } catch (e) {
      return false;
    }
  }
  var live = function (r) {
    return r.list.filter(function (c) {
      return !c.del;
    });
  };
  function find(r, id) {
    for (var i = 0; i < r.list.length; i++) if (r.list[i].id === id) return r.list[i];
    return null;
  }

  // which campaign this tab shows: a tab keeps the campaign it was switched to, even after a reload
  var reg = readReg(),
    id = null,
    pin = null;
  try {
    pin = SS && SS.getItem(PIN);
  } catch (e) {}
  var pc = pin && find(reg, pin);
  if (pc && !pc.del) id = pin;
  if (!id) {
    var ac = find(reg, reg.active);
    id = ac && !ac.del ? reg.active : (live(reg)[0] || { id: 'c1' }).id;
  }

  function mapKey(k, cid) {
    k = String(k);
    cid = cid || id;
    return GLOBAL[k] || cid === 'c1' ? k : PFX + cid + '~' + k;
  }
  function unmapKey(raw, cid) {
    cid = cid || id;
    if (raw == null) return null;
    if (GLOBAL[raw]) return raw;
    if (cid === 'c1') return raw.indexOf(PFX) === 0 ? undefined : raw;
    var p = PFX + cid + '~';
    return raw.indexOf(p) === 0 ? raw.slice(p.length) : undefined;
  }
  function rawKeys(st) {
    var a = [];
    try {
      for (var i = 0; i < st.length; i++) {
        var k = st.key(i);
        if (k != null) a.push(k);
      }
    } catch (e) {}
    return a;
  }
  // the raw keys that belong to one campaign (campaign 1 owns the original 'dm-board…' names)
  function ownRaw(cid, st) {
    st = st || LS;
    return rawKeys(st).filter(function (k) {
      if (GLOBAL[k]) return false;
      return cid === 'c1' ? k.indexOf(PFX) !== 0 && k.indexOf('dm-board') === 0 : k.indexOf(PFX + cid + '~') === 0;
    });
  }

  var SP = window.Storage && Storage.prototype;
  function wrap(st) {
    if (!st || !SP) return st;
    var keys = function () {
      return rawKeys(st)
        .map(function (k) {
          return unmapKey(k);
        })
        .filter(function (k) {
          return k !== undefined && k !== PIN;
        });
    };
    var api = {
      getItem: function (k) {
        return st.getItem(mapKey(k));
      },
      setItem: function (k, v) {
        st.setItem(mapKey(k), String(v));
      },
      removeItem: function (k) {
        st.removeItem(mapKey(k));
      },
      // campaign 1 clears as before (theme and mood too); other campaigns leave the shared keys alone
      clear: function () {
        keys().forEach(function (k) {
          if (k === REG || k === PIN || (id !== 'c1' && GLOBAL[k])) return;
          st.removeItem(mapKey(k));
        });
      },
      key: function (i) {
        var a = keys();
        i = Math.floor(+i) || 0;
        return i >= 0 && i < a.length ? a[i] : null;
      },
    };
    return new Proxy(
      {},
      {
        get: function (t, p) {
          if (p === 'length') return keys().length;
          if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(api, p)) return api[p];
          if (typeof p !== 'string' || p in Object.prototype || p in SP) {
            var v = st[p];
            return typeof v === 'function' ? v.bind(st) : v;
          }
          var x = st.getItem(mapKey(p));
          return x == null ? undefined : x;
        },
        set: function (t, p, v) {
          if (typeof p !== 'string') return false;
          st.setItem(mapKey(p), String(v));
          return true;
        },
        has: function (t, p) {
          return typeof p === 'string' && (p in SP || st.getItem(mapKey(p)) !== null);
        },
        deleteProperty: function (t, p) {
          if (typeof p === 'string') st.removeItem(mapKey(p));
          return true;
        },
        ownKeys: function () {
          return keys();
        },
        getOwnPropertyDescriptor: function (t, p) {
          if (typeof p !== 'string') return undefined;
          var x = st.getItem(mapKey(p));
          return x == null ? undefined : { value: x, writable: true, enumerable: true, configurable: true };
        },
        defineProperty: function (t, p, d) {
          if (typeof p === 'string' && d && 'value' in d) {
            st.setItem(mapKey(p), String(d.value));
            return true;
          }
          return false;
        },
        getPrototypeOf: function () {
          return SP;
        },
      }
    );
  }
  var ok = false,
    LSP = null,
    SSP = null;
  if (LS && window.Proxy) {
    try {
      LSP = wrap(LS);
      SSP = SS ? wrap(SS) : null;
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        enumerable: true,
        get: function () {
          return LSP;
        },
      });
      if (SSP)
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          enumerable: true,
          get: function () {
            return SSP;
          },
        });
      ok = window.localStorage === LSP;
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      id = 'c1';
      try {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          enumerable: true,
          get: function () {
            return LS;
          },
        });
      } catch (e) {}
    }
  }

  // storage events from other tabs arrive with raw keys: hand listeners this campaign's names
  // and drop changes that belong to another campaign
  var addE = window.addEventListener,
    remE = window.removeEventListener,
    WR = new WeakMap();
  function mapEvent(e) {
    var area = e.storageArea === LS ? LSP : e.storageArea === SS ? SSP : null;
    if (!area) return e;
    var k = unmapKey(e.key);
    if (k === undefined) return null;
    if (k === e.key) return e;
    try {
      return new StorageEvent('storage', { key: k, oldValue: e.oldValue, newValue: e.newValue, url: e.url });
    } catch (x) {
      return null;
    }
  }
  function wrapL(f) {
    if (!f || (typeof f !== 'function' && typeof f.handleEvent !== 'function')) return f;
    var w = WR.get(f);
    if (!w) {
      w = function (e) {
        var m = mapEvent(e);
        if (!m) return;
        return typeof f === 'function' ? f.call(this, m) : f.handleEvent(m);
      };
      WR.set(f, w);
    }
    return w;
  }
  if (ok && id !== 'c1') {
    window.addEventListener = function (t, f, o) {
      return addE.call(this, t, t === 'storage' ? wrapL(f) : f, o);
    };
    window.removeEventListener = function (t, f, o) {
      return remE.call(this, t, (t === 'storage' && f && WR.get(f)) || f, o);
    };
    var onS = null;
    try {
      Object.defineProperty(window, 'onstorage', {
        configurable: true,
        enumerable: true,
        get: function () {
          return onS;
        },
        set: function (f) {
          if (onS) remE.call(window, 'storage', wrapL(onS));
          onS = typeof f === 'function' ? f : null;
          if (onS) addE.call(window, 'storage', wrapL(onS));
        },
      });
    } catch (e) {}
  }

  // IndexedDB (restore points, the linked backup file) follows the campaign too
  var IDF = window.IDBFactory && IDBFactory.prototype,
    iOpen = IDF && IDF.open,
    iDel = IDF && IDF.deleteDatabase,
    iList = IDF && IDF.databases;
  function dbName(n, cid) {
    cid = cid || id;
    n = String(n);
    return cid === 'c1' ? n : n + '~' + cid;
  }
  if (ok && IDF && id !== 'c1') {
    IDF.open = function (n, v) {
      return v === undefined ? iOpen.call(this, dbName(n)) : iOpen.call(this, dbName(n), v);
    };
    IDF.deleteDatabase = function (n) {
      return iDel.call(this, dbName(n));
    };
    if (iList)
      IDF.databases = function () {
        var sfx = '~' + id;
        return iList.call(this).then(function (l) {
          return l
            .filter(function (d) {
              return d.name.slice(-sfx.length) === sfx;
            })
            .map(function (d) {
              return { name: d.name.slice(0, -sfx.length), version: d.version };
            });
        });
      };
  }

  // file names: with more than one campaign, a backup's name says which campaign it is
  function slug() {
    var c = find(readReg(), id),
      n = ((c && c.name) || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return n || 'campaign-' + id.slice(1);
  }
  function named(n) {
    if (typeof n !== 'string' || n.indexOf('dm-board-') !== 0 || live(readReg()).length < 2) return n;
    var s = slug();
    return n.indexOf('dm-board-' + s + '-') === 0 ? n : 'dm-board-' + s + '-' + n.slice(9);
  }
  if (ok) {
    var AD = window.HTMLAnchorElement && Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download');
    if (AD && AD.set)
      try {
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
          configurable: true,
          enumerable: AD.enumerable,
          get: AD.get,
          set: function (v) {
            AD.set.call(this, named(v));
          },
        });
      } catch (e) {}
    if (typeof window.showSaveFilePicker === 'function') {
      var sp = window.showSaveFilePicker;
      window.showSaveFilePicker = function (o) {
        if (o && o.suggestedName) o = Object.assign({}, o, { suggestedName: named(o.suggestedName) });
        return sp.call(window, o);
      };
    }
    if (window.File) {
      var F = window.File;
      try {
        window.File = function (b, n, o) {
          return new F(b, named(n), o);
        };
        window.File.prototype = F.prototype;
      } catch (e) {}
    }
  }

  // a tab marks its campaign active when used, so a new tab opens the same one
  function markActive() {
    if (!ok) return;
    var r = readReg();
    var c = find(r, id);
    if (!c || c.del) return;
    if (r.active !== id || Date.now() - c.used > 6e4) {
      r.active = id;
      c.used = Date.now();
      writeReg(r);
    }
  }
  if (ok) {
    try {
      SS && SS.setItem(PIN, id);
    } catch (e) {}
    markActive();
    addE.call(window, 'focus', markActive);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') markActive();
    });
  }

  window.DMC = Object.freeze({
    ok: ok,
    id: id,
    REG: REG,
    PIN: PIN,
    reg: readReg,
    writeReg: writeReg,
    find: find,
    live: function () {
      return live(readReg());
    },
    mapKey: mapKey,
    unmapKey: unmapKey,
    ownRaw: ownRaw,
    dbName: dbName,
    raw: {
      ls: LS,
      ss: SS,
      open: function (n, v) {
        return iOpen.call(indexedDB, n, v);
      },
      del: function (n) {
        return iDel.call(indexedDB, n);
      },
      dbs: function () {
        return iList ? iList.call(indexedDB) : Promise.reject(new Error('no list'));
      },
    },
    addRaw: function (t, f) {
      addE.call(window, t, f);
    },
  });
})();
