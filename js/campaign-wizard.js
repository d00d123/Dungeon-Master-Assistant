/* New-campaign wizard: a 3-step paper card (name, players, start).
   window.DMB_WIZARD.open(opts) is called by window.DMB_CAMP.openWizard() in app.js, which adds to opts:
   { source, here, classes, currentName, dmName, isDemo }. The wizard changes nothing until "Create campaign";
   then it calls DMB_CAMP.create({ name, dm, players, demo, ddb, here }). Esc, × or a click outside cancels.
   It uses the popup shell (#mcard.mc-ov > .mc), so app.js's shortcuts stay quiet while it is open.
   Styles: css/campaign-wizard.css. See docs/ARCHITECTURE.md. */
'use strict';
(() => {
  const STEPS = ['Name', 'Players', 'Start'];
  const MAX_ROWS = 20;
  const esc = (s) =>
    String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  let st = null; // { step, name, dm, rows: [{ name, cls, level }], demo, ddb, opts, el, back }

  function open(opts) {
    close(true);
    const old = document.getElementById('mcard');
    old && old.remove();
    opts = opts || {};
    st = {
      step: 0,
      name: '',
      dm: opts.dmName || '',
      rows: [{ name: '', cls: '', level: 1 }],
      demo: false,
      ddb: false,
      opts,
      back: document.activeElement,
      busy: false,
    };
    const el = document.createElement('div');
    el.className = 'mc-ov cw-ov';
    el.id = 'mcard';
    el.dataset.wiz = '1';
    el.innerHTML = `<div class="mc cw" role="dialog" aria-modal="true" aria-labelledby="cwTitle" aria-describedby="cwStep">
      <div class="mhead"><div><h3 id="cwTitle">${opts.here ? 'Set up your campaign' : 'New campaign'}</h3><p class="ty" id="cwStep" aria-live="polite"></p></div><button class="x" type="button" data-cwclose aria-label="Cancel and close">×</button></div>
      <ol class="cw-dots" aria-hidden="true">${STEPS.map((s, i) => `<li data-i="${i}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>
      <div class="cw-body" id="cwBody"></div>
      <p class="cw-err" id="cwErr" role="alert"></p>
      <div class="row cw-foot"><button class="btn ghost" type="button" id="cwBack">Back</button><span class="cw-sp"></span><button class="btn ghost" type="button" id="cwSkip">Skip</button><button class="btn pri" type="button" id="cwNext">Next</button></div>
    </div>`;
    document.body.appendChild(el);
    st.el = el;
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) st && (st.downOut = true);
    });
    el.addEventListener('click', (e) => {
      if ((e.target === el && st && st.downOut) || e.target.closest('[data-cwclose]')) close();
      if (st) st.downOut = false;
    });
    el.addEventListener('keydown', onKey);
    el.querySelector('#cwBack').onclick = () => go(st.step - 1);
    el.querySelector('#cwSkip').onclick = () => {
      st.rows = [{ name: '', cls: '', level: 1 }];
      st.ddb = false;
      go(2);
    };
    el.querySelector('#cwNext').onclick = next;
    draw();
  }

  // cancel: nothing was changed, so just remove the card and give focus back
  function close(quiet) {
    if (!st) return;
    const s = st;
    st = null;
    s.el && s.el.remove();
    if (!quiet && s.back && s.back.isConnected && s.back.focus) s.back.focus();
  }

  function onKey(e) {
    if (!st) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const f = [...st.el.querySelectorAll('button,input,select,a[href],[tabindex]:not([tabindex="-1"])')].filter(
        (x) => !x.disabled && !x.hidden && x.offsetParent !== null
      );
      if (!f.length) return;
      const a = f[0],
        z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      const t = e.target;
      if (t.closest('button,a')) return;
      e.preventDefault();
      e.stopPropagation();
      next();
    }
  }

  function read() {
    if (!st) return;
    const b = st.el.querySelector('#cwBody');
    if (st.step === 0) {
      st.name = b.querySelector('#cwName').value;
      st.dm = b.querySelector('#cwDm').value;
    } else if (st.step === 1) {
      st.rows = [...b.querySelectorAll('.cw-row')].map((r) => ({
        name: r.querySelector('[data-k="name"]').value,
        cls: r.querySelector('[data-k="cls"]').value,
        level: r.querySelector('[data-k="level"]').value,
      }));
      const d = b.querySelector('#cwDdb');
      st.ddb = !!(d && d.checked);
    } else {
      const r = b.querySelector('input[name="cwStart"]:checked');
      st.demo = !!r && r.value === 'demo';
    }
  }

  const named = () => st.rows.filter((r) => String(r.name).trim());

  function err(msg, field) {
    const e = st.el.querySelector('#cwErr');
    e.textContent = msg || '';
    st.el.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'cwErr');
      field.focus();
    }
  }

  function valid() {
    if (st.step === 0) {
      const n = st.name.trim();
      const f = st.el.querySelector('#cwName');
      if (!n) return (err('Give the campaign a name first.', f), false);
      if (n.length > 120) return (err('Keep the name to 120 characters or fewer.', f), false);
    }
    if (st.step === 1) {
      const bad = st.rows.findIndex((r) => {
        const v = String(r.level).trim();
        return v !== '' && !(+v >= 1 && +v <= 20 && Math.round(+v) === +v);
      });
      if (bad >= 0) {
        const f = st.el.querySelectorAll('.cw-row [data-k="level"]')[bad];
        return (err('Levels go from 1 to 20.', f), false);
      }
    }
    return true;
  }

  function next() {
    if (!st || st.busy) return;
    read();
    if (!valid()) return;
    if (st.step < 2) return go(st.step + 1);
    create();
  }

  function go(i) {
    if (!st) return;
    read();
    if (i > st.step && !valid()) return;
    st.step = Math.max(0, Math.min(2, i));
    draw();
  }

  function create() {
    const D = window.DMB_CAMP;
    if (!D || !D.create) return err('The campaign list isn’t available in this browser.');
    st.busy = true;
    const btn = st.el.querySelector('#cwNext');
    btn.disabled = true;
    let ok;
    try {
      ok = D.create({
        name: st.name.trim().slice(0, 120),
        dm: st.dm.trim().slice(0, 80),
        players: st.demo ? [] : named().map((r) => ({ name: r.name.trim(), cls: r.cls, level: +r.level || 1 })),
        demo: st.demo,
        ddb: !st.demo && st.ddb,
        here: !!st.opts.here,
      });
    } catch (e) {
      ok = false;
    }
    if (!st) return;
    if (ok) {
      // a new campaign reloads the page; the in-place set up is already done
      close(true);
      return;
    }
    st.busy = false;
    btn.disabled = false;
    err('The campaign couldn’t be made. Browser storage may be full: delete an old campaign or map images first.');
  }

  function rowHTML(r, i) {
    const cl = st.opts.classes || [];
    return `<div class="cw-row" data-row="${i}">
      <label class="f cw-n">Character name<input type="text" data-k="name" maxlength="80" autocomplete="off" value="${esc(r.name)}" placeholder="e.g. Brin Ashdown"></label>
      <label class="f cw-c">Class<select data-k="cls">${cl.map((c) => `<option${c === (r.cls || 'Fighter') ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="f cw-l">Level<input type="number" data-k="level" min="1" max="20" step="1" inputmode="numeric" value="${esc(r.level)}"></label>
      <button class="x cw-del" type="button" data-cwdel="${i}" aria-label="Remove player ${i + 1}">×</button>
    </div>`;
  }

  function draw() {
    const el = st.el,
      b = el.querySelector('#cwBody'),
      o = st.opts;
    el.querySelector('#cwStep').textContent = `Step ${st.step + 1} of 3: ${STEPS[st.step]}`;
    el.querySelectorAll('.cw-dots li').forEach((li) => {
      const i = +li.dataset.i;
      li.className = i < st.step ? 'done' : i === st.step ? 'on' : '';
    });
    el.querySelector('#cwErr').textContent = '';
    el.querySelector('#cwBack').hidden = st.step === 0;
    el.querySelector('#cwSkip').hidden = st.step !== 1 || named().length > 0;
    el.querySelector('#cwNext').textContent = st.step === 2 ? (o.here ? 'Start campaign' : 'Create campaign') : 'Next';
    let focus;
    b.oninput = null;
    if (st.step === 0) {
      b.innerHTML = `<label class="f">Campaign name<input type="text" id="cwName" maxlength="120" autocomplete="off" required aria-required="true" value="${esc(st.name)}" placeholder="e.g. Saturday one-shot"></label>
        <label class="f">Your DM name <span class="cw-opt">(optional)</span><input type="text" id="cwDm" maxlength="80" autocomplete="off" value="${esc(st.dm)}" placeholder="Shown next to the campaign name"></label>`;
      focus = b.querySelector('#cwName');
    } else if (st.step === 1) {
      if (!st.rows.length) st.rows.push({ name: '', cls: '', level: 1 });
      b.innerHTML = `<p class="cw-hint">Optional. Add the party now or later from the board. HP and AC can be filled in later.</p>
        <div class="cw-rows" role="group" aria-label="Players">${st.rows.map(rowHTML).join('')}</div>
        <button class="btn sm" type="button" id="cwAdd"${st.rows.length >= MAX_ROWS ? ' disabled' : ''}>+ Add player</button>
        <label class="cw-chk"><input type="checkbox" id="cwDdb"${st.ddb ? ' checked' : ''}> Import from D&amp;D Beyond (experimental) after the campaign opens</label>`;
      b.querySelector('#cwAdd').onclick = () => {
        read();
        if (st.rows.length >= MAX_ROWS) return;
        st.rows.push({ name: '', cls: '', level: 1 });
        draw();
        const ns = b.querySelectorAll('.cw-row [data-k="name"]');
        ns[ns.length - 1].focus();
      };
      b.querySelectorAll('[data-cwdel]').forEach(
        (x) =>
          (x.onclick = () => {
            read();
            const i = +x.dataset.cwdel;
            st.rows.splice(i, 1);
            draw();
            const ns = b.querySelectorAll('.cw-row [data-k="name"]');
            (ns[Math.min(i, ns.length - 1)] || b.querySelector('#cwAdd')).focus();
          })
      );
      b.oninput = () => {
        read();
        el.querySelector('#cwSkip').hidden = named().length > 0;
      };
      focus = b.querySelector('.cw-row [data-k="name"]');
    } else {
      const ps = named();
      const where = o.here
        ? 'Sets up this board.'
        : `Opens as a new campaign. ${esc(o.currentName || 'The campaign you have open')} stays exactly as it is.`;
      b.innerHTML = `<fieldset class="cw-pick"><legend>How do you want to start?</legend>
        <label class="cw-card"><input type="radio" name="cwStart" value="blank"${st.demo ? '' : ' checked'}><span><b>Blank board</b><small>An empty table for your own players, missions and notes.</small></span></label>
        <label class="cw-card"><input type="radio" name="cwStart" value="demo"${st.demo ? ' checked' : ''}><span><b>With demo data</b><small>“The Drowned Bell”: a full example campaign to explore, with its own party.</small></span></label>
      </fieldset>
      <dl class="cw-sum" id="cwSum"></dl>
      <p class="cw-hint">${where}</p>`;
      const sum = () => {
        read();
        const pl = st.demo
          ? ps.length
            ? `The demo brings its own party, so the ${ps.length === 1 ? 'player' : ps.length + ' players'} you listed won’t be added`
            : 'The demo’s own party'
          : ps.length
            ? ps.map((r) => `${r.name.trim()} (${r.cls || 'Fighter'} ${+r.level || 1})`).join(', ')
            : 'None yet';
        b.querySelector('#cwSum').innerHTML =
          `<dt>Campaign</dt><dd>${esc(st.name.trim())}</dd><dt>DM</dt><dd>${esc(st.dm.trim() || '—')}</dd><dt>Players</dt><dd>${esc(pl)}</dd>` +
          (st.ddb && !st.demo ? '<dt>Then</dt><dd>Import from D&amp;D Beyond</dd>' : '');
      };
      b.querySelectorAll('input[name="cwStart"]').forEach((r) => (r.onchange = sum));
      sum();
      focus = b.querySelector('input[name="cwStart"]:checked');
    }
    focus && focus.focus();
  }

  window.DMB_WIZARD = { open, close: () => close(), isOpen: () => !!st };
})();
