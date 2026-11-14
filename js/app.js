/* The app: board state, storage and backups, rendering, battles, dice, bestiary, notes, generators, help.
   One IIFE (shared closure state: S, render, save, ...). Exposes only window.DM_SHORTCUTS.
   Depends on: window.DMB_DATA (data/*.js: rules, bestiary, spells, items, demo), window.DMC (js/storage-shim.js),
   window.__fx (js/effects.js, optional). Deferred; data/*.js load before it.
   Sections (search for the "/* ---------- name" banners): helpers, home, sheet framework, views, story, sketchpad,
   world tracking, storyteller tools, character growth, start over, setup and help, backup, dice, v10 features,
   travel and calendar, SRD 5.2.1 reference, data safety, more than one campaign; boot is the last statement. */
(function () {
  const KEY = 'dm-board-v1';
  const CONDITIONS = window.DMB_DATA.rules.conditions;
  const INCAP = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'];
  const COND_TEXT = window.DMB_DATA.rules.conditionText;
  const CLASSES = [
    'Barbarian',
    'Bard',
    'Cleric',
    'Druid',
    'Fighter',
    'Monk',
    'Paladin',
    'Ranger',
    'Rogue',
    'Sorcerer',
    'Warlock',
    'Wizard',
    'Artificer',
  ];
  /* SRD 5.2.1 monsters (CC-BY-4.0, Wizards of the Coast), lazy-loaded from data/bestiary.js (see "reference data"
     near the end). Until then these hold only homebrew monsters. They are filled in place, never reassigned.
     MONSTERS: [{ n, t, ac, ini, hp, cr, xp, spd, hb? }]  (SRD rows first, then homebrew)
     MM_ATK:   { name: [multiattack count, [name, to-hit or save DC, reach/range, damage], ...] } */
  const MONSTERS = [];
  const MM_ATK = {};
  const MON_BY_NAME = new Map();
  // lazy reference data state, used by openSheet/monCard/withRef (see "reference data" near the end)
  const REF_SETS = ['bestiary', 'spells', 'items'];
  const REF_FREE = { player: 1, campaign: 1 }; // sheets that never show reference data
  let refOk = false,
    refFailed = false; // true only while the queued callbacks of a failed load run (they open without the data)
  const refQueue = [];
  const monLink = (n, label = n) =>
    MON_BY_NAME.has(n)
      ? `<button class="mlink" type="button" data-mon="${esc(n)}" title="Show attacks">${esc(label)}</button>`
      : `<strong>${esc(label)}</strong>`;
  const NUMW = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
  // combat aids: damage types, the DM's own notes per monster kind (S.monNotes), PB by CR
  const DMG_TYPES = [
    'Acid',
    'Bludgeoning',
    'Cold',
    'Fire',
    'Force',
    'Lightning',
    'Necrotic',
    'Piercing',
    'Poison',
    'Psychic',
    'Radiant',
    'Slashing',
    'Thunder',
  ];
  const MN_KIND = {
    res: ['Resistant', '½', 'resisted'],
    imm: ['Immune', '0', 'immune'],
    vul: ['Vulnerable', '×2', 'vulnerable'],
  };
  const COND_IMM = [
    'Blinded',
    'Charmed',
    'Deafened',
    'Exhaustion',
    'Frightened',
    'Grappled',
    'Incapacitated',
    'Invisible',
    'Paralyzed',
    'Petrified',
    'Poisoned',
    'Prone',
    'Restrained',
    'Stunned',
    'Unconscious',
  ];
  const crPB = (cr) => {
    const v = crNum(cr);
    return v >= 29 ? 9 : v >= 25 ? 8 : v >= 21 ? 7 : v >= 17 ? 6 : v >= 13 ? 5 : v >= 9 ? 4 : v >= 5 ? 3 : 2;
  };
  const monNote = (n) =>
    (S && S.monNotes && n && Object.prototype.hasOwnProperty.call(S.monNotes, n) && S.monNotes[n]) || null;
  const mnBlank = () => ({ tac: '', res: [], imm: [], vul: [], cimm: [], notes: '', advb: [] });
  function mnClean(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const pick = (v, L) => [...new Set(arr(v).map(String))].filter((x) => L.includes(x));
    const r = {
      tac: str(o.tac, 160).trim(),
      res: pick(o.res, DMG_TYPES),
      imm: pick(o.imm, DMG_TYPES),
      vul: pick(o.vul, DMG_TYPES),
      cimm: pick(o.cimm, COND_IMM),
      notes: str(o.notes, 1000).trim(),
      advb: [
        ...new Set(
          arr(o.advb)
            .map((x) => str(x, 80).trim())
            .filter(Boolean)
        ),
      ].slice(0, 12),
    };
    // one setting per damage type: immune wins, then resistant
    r.res = r.res.filter((x) => !r.imm.includes(x));
    r.vul = r.vul.filter((x) => !r.imm.includes(x) && !r.res.includes(x));
    return r.tac || r.notes || r.res.length || r.imm.length || r.vul.length || r.cimm.length || r.advb.length
      ? r
      : null;
  }
  function mnNorm() {
    const src = S.monNotes && typeof S.monNotes === 'object' && !Array.isArray(S.monNotes) ? S.monNotes : {};
    S.monNotes = {};
    Object.keys(src)
      .slice(0, 2000)
      .forEach((k) => {
        const n = str(k, 80).trim();
        if (!n || n === '__proto__') return;
        const c = mnClean(src[k]);
        if (c) S.monNotes[n] = c;
      });
  }
  function dmgKind(n, ty) {
    const o = monNote(n);
    if (!o || !ty) return '';
    return o.imm.includes(ty) ? 'imm' : o.res.includes(ty) ? 'res' : o.vul.includes(ty) ? 'vul' : '';
  }
  // resistance, immunity and vulnerability from the DM's notes, for a monster row
  function dmgMod(b, c, ty, n) {
    const k = c && !c.pid && !c.lair ? dmgKind(c.base || c.name, ty) : '';
    if (!k) return { n, k: '', line: '' };
    const m = k === 'imm' ? 0 : k === 'res' ? Math.floor(n / 2) : n * 2;
    return { n: m, k, line: `R${b.round}: ${ty} on ${c.name}: ${MN_KIND[k][2]}, ${n} → ${m}.` };
  }
  const lc = (a) => a.map((x) => x.toLowerCase()).join(', ');
  function mnBrief(o) {
    if (!o) return '';
    return [
      o.res.length ? `Resists ${lc(o.res)}` : '',
      o.imm.length ? `Immune to ${lc(o.imm)}` : '',
      o.vul.length ? `Vulnerable to ${lc(o.vul)}` : '',
      o.cimm.length ? `Can’t be ${lc(o.cimm)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function mnLine(n) {
    const o = monNote(n);
    if (!o) return '';
    const t = [o.tac, mnBrief(o)].filter(Boolean).join(' · ');
    return t ? `<div class="tac">${esc(t)}</div>` : '';
  }
  function advbHas(n, an) {
    const o = monNote(n);
    return !!(o && o.advb.includes(an));
  }
  function advbSet(n, an, on) {
    S.monNotes = S.monNotes || {};
    const o = monNote(n) || (S.monNotes[n] = mnBlank());
    o.advb = on ? [...new Set([...o.advb, an])] : o.advb.filter((x) => x !== an);
    if (!mnClean(o)) delete S.monNotes[n];
  }
  let MCE = null;
  function mnEditHTML(n) {
    const e = MCE;
    return `<div class="mnotes edit"><h4>Your notes for every ${esc(n)}</h4>
    <label class="f">Tactic or voice line<input type="text" id="mnTac" maxlength="160" value="${esc(e.tac)}" placeholder="Flees at half HP. “Shinies! Give us the shinies!”"></label>
    <div class="lbl">Damage types: click to cycle Resistant ½, Immune 0, Vulnerable ×2</div>
    <div class="mchips">${DMG_TYPES.map((t) => {
      const k = e.imm.includes(t) ? 'imm' : e.res.includes(t) ? 'res' : e.vul.includes(t) ? 'vul' : '';
      return `<button type="button" class="pill mchip" data-mnty="${t}" data-k="${k}" aria-pressed="${!!k}" aria-label="${t}: ${k ? MN_KIND[k][0] : 'normal damage'}">${t}${k ? ` ${MN_KIND[k][1]}` : ''}</button>`;
    }).join('')}</div>
    <div class="lbl">Condition immunities</div>
    <div class="mchips">${COND_IMM.map((t) => `<button type="button" class="pill mchip" data-mncond="${t}" aria-pressed="${e.cimm.includes(t)}">${t}</button>`).join('')}</div>
    <label class="f">Notes<textarea id="mnNotes" rows="3" maxlength="1000" placeholder="Anything you want to remember about this kind of monster">${esc(e.notes)}</textarea></label>
    <div class="row end"><button class="btn ghost" type="button" id="mnCancel">Cancel</button><button class="btn pri" type="button" id="mnSave">Save notes</button></div></div>`;
  }
  function mnViewHTML(n) {
    const o = monNote(n);
    const body = o
      ? [
          o.tac ? `<p class="tac">${esc(o.tac)}</p>` : '',
          mnBrief(o) ? `<p class="mnl">${esc(mnBrief(o))}</p>` : '',
          o.advb.length ? `<p class="mnl">Bonus die with Advantage: ${esc(o.advb.join(', '))}</p>` : '',
          o.notes ? `<p class="mnt">${esc(o.notes)}</p>` : '',
        ].join('')
      : '';
    return `<div class="mnotes"><div class="row between"><h4>Your notes</h4><button class="btn sm ghost" type="button" id="mnEdit">${o && (o.tac || o.notes || mnBrief(o)) ? 'Edit notes' : '+ Add notes'}</button></div>
    ${body || `<p class="mnl" style="color:var(--ink-3)">A tactic or voice line, resistances and immunities. Saved once, shown on every ${esc(n)} in every battle.</p>`}</div>`;
  }
  function monCard(n, edit) {
    if (!refOk && !refFailed) {
      withRef(() => monCard(n, edit));
      return;
    }
    const m = MON_BY_NAME.get(n);
    if (!m) return;
    const a = MM_ATK[n];
    const sign = (v) => (v >= 0 ? '+' : '−') + Math.abs(v);
    const reach = (r) => (!r ? '' : r.startsWith('range') ? esc(r) : `reach ${esc(r)}`);
    const atks = a
      ? a
          .slice(1)
          .map(([an, hit, r, d]) => {
            const save = hit.startsWith('DC');
            return `<div class="atk"><div class="an"><strong>${esc(an)}</strong><span class="hit">${save ? esc(hit) + ' save' : esc(hit) + ' to hit'}</span></div>
    <div class="dmg">${[reach(r), d ? (save ? 'Fail: ' : 'Hit: ') + esc(d) + ' damage' : ''].filter(Boolean).join(' · ') || 'No damage listed'}</div></div>`;
          })
          .join('')
      : '';
    // "Medium or Small Humanoid, Neutral Evil": size and type before the last comma, alignment after it
    const t = String(m.t || ''),
      ci = t.lastIndexOf(','),
      kind = ci > 0 ? t.slice(0, ci).trim() : t,
      align = ci > 0 ? t.slice(ci + 1).trim() : '';
    if (edit && (!MCE || MCE.n !== n)) {
      const o = monNote(n) || mnBlank();
      MCE = { n, ...JSON.parse(JSON.stringify(o)) };
    }
    if (!edit) MCE = null;
    $('mcard') && $('mcard').remove();
    const el = document.createElement('div');
    el.className = 'mc-ov';
    el.id = 'mcard';
    el.innerHTML = `<div class="mc" role="dialog" aria-modal="true" aria-label="${esc(n)}">
    <div class="mhead"><div><h3>${esc(n)}</h3><p class="ty">${esc([kind, align].filter(Boolean).join(' · '))}</p></div><button class="x" type="button" data-mclose aria-label="Close">×</button></div>
    <div class="st st5"><div><span>AC</span><b>${m.ac}</b></div><div><span>HP</span><b>${m.hp}</b></div><div><span>Init</span><b>${sign(m.ini)}</b></div><div><span>CR</span><b>${m.cr}</b></div><div><span>PB</span><b>+${crPB(m.cr)}</b></div></div>
    <div class="spd">Speed ${esc(m.spd || '')}${m.xp ? ` · ${m.xp.toLocaleString()} XP` : ''}</div>
    ${edit ? mnEditHTML(n) : mnViewHTML(n)}
    <h4>Attacks</h4>
    ${a && a[0] > 1 ? `<div class="multi">Multiattack: ${NUMW[a[0]] || a[0]} attacks a turn</div>` : ''}
    ${atks || (a ? '<div class="multi">No attacks. Check its SRD stat block for what it does instead.</div>' : '<div class="multi">No attacks recorded for this one.</div>')}
    <p class="foot">${m.hb ? 'Homebrew monster. Change it under Battles, Homebrew.' : 'Numbers from the SRD 5.2.1 (CC-BY-4.0). Traits and spells are in its full stat block there.'}</p></div>`;
    document.body.appendChild(el);
    el.onclick = (e) => {
      if (e.target === el || e.target.closest('[data-mclose]')) el.remove();
    };
    const q = (s) => el.querySelector(s);
    if (!edit) {
      q('#mnEdit').onclick = () => monCard(n, true);
      q('[data-mclose]').focus();
      return;
    }
    const keep = () => {
      MCE.tac = q('#mnTac').value;
      MCE.notes = q('#mnNotes').value;
    };
    el.querySelectorAll('[data-mnty]').forEach(
      (x) =>
        (x.onclick = () => {
          keep();
          const ty = x.dataset.mnty,
            k = x.dataset.k,
            nx = { '': 'res', res: 'imm', imm: 'vul', vul: '' }[k];
          ['res', 'imm', 'vul'].forEach((z) => (MCE[z] = MCE[z].filter((v) => v !== ty)));
          if (nx) MCE[nx].push(ty);
          monCard(n, true);
          const f = $('mcard').querySelector(`[data-mnty="${ty}"]`);
          f && f.focus();
        })
    );
    el.querySelectorAll('[data-mncond]').forEach(
      (x) =>
        (x.onclick = () => {
          keep();
          const k = x.dataset.mncond;
          MCE.cimm = MCE.cimm.includes(k) ? MCE.cimm.filter((v) => v !== k) : [...MCE.cimm, k];
          monCard(n, true);
          const f = $('mcard').querySelector(`[data-mncond="${k}"]`);
          f && f.focus();
        })
    );
    q('#mnCancel').onclick = () => monCard(n);
    q('#mnSave').onclick = () => {
      keep();
      const { n: _n, ...o } = MCE;
      const was = monNote(n);
      o.advb = was ? was.advb : [];
      const c = mnClean(o);
      S.monNotes = S.monNotes || {};
      if (c) S.monNotes[n] = c;
      else delete S.monNotes[n];
      MCE = null;
      commit();
      monCard(n);
      toast(c ? `Notes saved for every ${n}` : `Notes cleared for ${n}`);
    };
    q('#mnTac').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        q('#mnSave').click();
      }
    };
    if (!document.activeElement || !el.contains(document.activeElement)) q('#mnTac').focus();
  }
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest('[data-mon]');
      if (b) {
        e.preventDefault();
        e.stopPropagation();
        monCard(b.dataset.mon);
      }
    },
    true
  );
  const crNum = (c) => {
    const [x, y] = String(c).split('/');
    return y ? x / y : +x;
  };
  const CR_BANDS = [
    ['all', 'Any CR', () => true],
    ['low', 'CR 0–1', (v) => v <= 1],
    ['mid', 'CR 2–4', (v) => v >= 2 && v <= 4],
    ['high', 'CR 5–10', (v) => v >= 5 && v <= 10],
    ['epic', 'CR 11–16', (v) => v >= 11 && v <= 16],
    ['myth', 'CR 17+', (v) => v >= 17],
  ];
  const crSelect = (id, cur) =>
    `<select id="${id}" aria-label="Filter by challenge rating" style="width:auto">${CR_BANDS.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const crOk = (m, band) => m.cr === 'custom' || (CR_BANDS.find((b) => b[0] === band) || CR_BANDS[0])[2](crNum(m.cr));

  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const d20 = () => 1 + Math.floor(Math.random() * 20);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // first run: the original demo campaign, flagged as example data so the first real entry clears it
  function sample() {
    const d = demoBoard();
    d.example = true;
    d.dm.name = 'Dungeon Master';
    return d;
  }

  let S;
  // every load, undo and backup passes through here, so damaged or hand-edited data can't break the board
  const num = (v, d, lo, hi) => {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  };
  const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));
  const str = (v, max) => (v == null || typeof v === 'object' ? '' : String(v).slice(0, max || 4000));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const objs = (v) => arr(v).filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  const ID_RE = /^[a-z0-9]{1,16}$/;
  const fixId = (o, map) => {
    if (o.id == null || !ID_RE.test(String(o.id))) {
      const n = uid();
      if (map && o.id != null) map[o.id] = n;
      o.id = n;
    }
  };
  const dsOf = (d) => ({ s: int(d && d.s, 0, 0, 3), f: int(d && d.f, 0, 0, 3) });
  const ATTITUDES = ['Friendly', 'Indifferent', 'Hostile', 'Unknown'],
    PLACE_KINDS = ['Town', 'Dungeon', 'Wilderness', 'Landmark', 'Building'];
  function normalize() {
    if (!S || typeof S !== 'object' || Array.isArray(S)) S = {};
    [
      'players',
      'battles',
      'missions',
      'loot',
      'notes',
      'npcs',
      'places',
      'secrets',
      'plans',
      'homebrew',
      'scenes',
      'clocks',
      'fronts',
    ].forEach((k) => (S[k] = objs(S[k])));
    const dm = S.dm && typeof S.dm === 'object' ? S.dm : {};
    S.dm = {
      lastBackup: str(dm.lastBackup, 20),
      name: str(dm.name, 80),
      campaign: str(dm.campaign, 120),
      session: int(dm.session, 1, 1, 9999),
      gritty: !!dm.gritty,
      injuries: !!dm.injuries,
      wander: int(dm.wander, 6, 0, 20),
      dturn: int(dm.dturn, 0, 0, 1e6),
      ...(str(dm.nextUp, 300) ? { nextUp: str(dm.nextUp, 300) } : {}),
    };
    const pmap = {};
    S.players.forEach((p) => {
      fixId(p, pmap);
      p.name = str(p.name, 80) || 'Unnamed hero';
      p.player = str(p.player, 80);
      p.cls = CLASSES.includes(p.cls) ? p.cls : 'Fighter';
      p.level = int(p.level, 1, 1, 20);
      p.maxHp = int(p.maxHp, 10, 1, 9999);
      p.hp = int(p.hp, p.maxHp, 0, p.maxHp);
      p.thp = int(p.thp, 0, 0, 9999);
      p.ac = int(p.ac, 10, 0, 40);
      p.ini = int(p.ini, 0, -20, 30);
      p.pp = int(p.pp, 10, 0, 40);
      p.pins = int(p.pins, 10, 0, 40);
      p.pinv = int(p.pinv, 10, 0, 40);
      p.sdc = int(p.sdc, 0, 0, 40);
      p.spd = int(p.spd, 30, 0, 200);
      p.dead = !!p.dead && p.hp <= 0;
      p.ds = p.hp <= 0 && !p.dead ? dsOf(p.ds) : { s: 0, f: 0 };
      p.present = p.present !== false;
      {
        const pm = p.mods && typeof p.mods === 'object' && !Array.isArray(p.mods) ? p.mods : {};
        p.mods = {};
        GC_ALL.forEach((k) => {
          if (pm[k] != null && pm[k] !== '') p.mods[k] = int(pm[k], 0, -20, 30);
        });
      }
      p.xp = int(p.xp, 0, 0, 1e7);
      p.exh = int(p.exh, 0, 0, 6);
      p.hdu = int(p.hdu, 0, 0, p.level);
      p.insp = !!p.insp;
      p.notes = str(p.notes, 20000);
      p.ds = dsOf(p.ds);
      p.conditions = [...new Set(arr(p.conditions).filter((c) => CONDITIONS.includes(c)))];
      p.injuries = arr(p.injuries)
        .map((x) => str(x, 80).trim())
        .filter(Boolean)
        .slice(0, 12);
      const hk = p.hooks && typeof p.hooks === 'object' && !Array.isArray(p.hooks) ? p.hooks : {};
      p.hooks = {};
      HOOKS.forEach(([k]) => (p.hooks[k] = str(hk[k], 300)));
      if (p.slots != null || p.sused != null) {
        p.slots = Array.from({ length: 9 }, (_, i) => int(arr(p.slots)[i], 0, 0, 9));
        p.sused = Array.from({ length: 9 }, (_, i) => int(arr(p.sused)[i], 0, 0, p.slots[i]));
      }
      growNorm(p);
      pactNorm(p);
    });
    const pids = new Set(S.players.map((p) => p.id));
    let live = false;
    S.battles.forEach((b) => {
      fixId(b);
      b.name = str(b.name, 120) || 'Battle';
      b.date = str(b.date, 20);
      b.session = int(b.session, 1, 1, 9999);
      b.round = int(b.round, 1, 1, 99999);
      b.xp = int(b.xp, 0, 0, 1e8);
      b.outcome = str(b.outcome, 20);
      b.log = arr(b.log).map((l) => str(l, 500));
      b.reach = int(b.reach, 0, 0, 1e9);
      b.goal = str(b.goal, 200);
      b.lose = str(b.lose, 200);
      b.events = objs(b.events)
        .map((e) => ({ r: int(e.r, 1, 1, 999), text: str(e.text, 200), done: !!e.done }))
        .filter((e) => e.text)
        .slice(0, 30);
      b.morDue = !!b.morDue;
      b.morHalf = !!b.morHalf;
      b.morLead = !!b.morLead;
      b.morWhy = str(b.morWhy, 120);
      b.morDC = int(b.morDC, 10, 1, 30);
      b.gone = objs(b.gone)
        .map((g) => ({ name: str(g.name, 80), xp: int(g.xp, 0, 0, 1e7) }))
        .slice(0, 300);
      b.combatants = objs(b.combatants).filter((c) => {
        fixId(c);
        c.name = str(c.name, 80) || 'Creature';
        c.init = num(c.init, 0, -99, 99);
        c.ini = num(c.ini, 0, -99, 30);
        c.fx = objs(c.fx).map((x) => ({ name: str(x.name, 60) || 'Effect', rounds: int(x.rounds, 1, 1, 100) }));
        if (!c.spent || typeof c.spent !== 'object' || Array.isArray(c.spent)) c.spent = {};
        if (c.pid != null) {
          c.pid = pmap[c.pid] || c.pid;
          if (!pids.has(c.pid)) return false;
          c.ds = dsOf(c.ds);
          return true;
        }
        if (c.lair) {
          c.lair = true;
          return true;
        }
        c.base = c.base == null ? undefined : str(c.base, 80);
        c.maxHp = int(c.maxHp, 1, 1, 99999);
        c.hp = int(c.hp, c.maxHp, 0, c.maxHp);
        c.thp = int(c.thp, 0, 0, 99999);
        c.ac = int(c.ac, 10, 0, 40);
        if (c.leg != null) {
          const l = c.leg;
          if (l && typeof l === 'object' && !Array.isArray(l)) {
            const a = int(l.a, 3, 1, 5),
              r = int(l.r, 3, 0, 5);
            c.leg = { a, au: int(l.au, 0, 0, a), r, ru: int(l.ru, 0, 0, r) };
          } else delete c.leg;
        }
        c.fled = !!c.fled;
        c.ally = !!c.ally;
        c.hidden = !!c.hidden;
        c.xp = int(c.xp, 0, 0, 1e7);
        delete c.pg;
        c.conditions = [...new Set(arr(c.conditions).filter((k) => CONDITIONS.includes(k)))];
        return true;
      });
      b.turn = b.combatants.length ? int(b.turn, 0, 0, b.combatants.length - 1) : 0;
      b.active = !!b.active && !live;
      if (b.active) live = true;
      if (b.map != null) {
        const m = b.map;
        if (typeof m !== 'object' || Array.isArray(m)) b.map = null;
        else {
          m.cols = int(m.cols, 20, 5, 40);
          m.rows = int(m.rows, 14, 5, 40);
          const pos = {};
          if (m.pos && typeof m.pos === 'object')
            Object.entries(m.pos).forEach(([k, v]) => {
              if (ID_RE.test(k) && Array.isArray(v))
                pos[k] = [int(v[0], 0, 0, m.cols - 1), int(v[1], 0, 0, m.rows - 1)];
            });
          m.pos = pos;
          if (m.img != null && !ID_RE.test(String(m.img))) m.img = null;
          if (m.bg != null && !IMG_RE.test(String(m.bg))) delete m.bg;
        }
      }
    });
    S.missions.forEach((m) => {
      fixId(m);
      m.title = str(m.title, 160) || 'Untitled mission';
      ['giver', 'where', 'reward'].forEach((k) => (m[k] = str(m[k], 160)));
      m.notes = str(m.notes, 20000);
      if (!MS[m.status]) m.status = 'active';
      m.clues = objs(m.clues)
        .map((c) => {
          fixId(c);
          return { id: c.id, text: str(c.text, 300), src: str(c.src, 160), found: !!c.found };
        })
        .filter((c) => c.text)
        .slice(0, 40);
      {
        const du = m.due && typeof m.due === 'object' && !Array.isArray(m.due) ? m.due : null;
        m.due = du ? { day: int(du.day, 1, 1, 1e6), min: int(du.min, 0, 0, 1439) } : null;
      }
      m.ifIgnored = str(m.ifIgnored, 300);
      m.dueFired = !!m.dueFired && !!m.due;
    });
    S.loot.forEach((l) => {
      fixId(l);
      l.item = str(l.item, 160) || 'Item';
      l.holder = str(l.holder, 80) || 'Party';
      l.value = str(l.value, 40);
      l.session = int(l.session, 1, 0, 9999);
    });
    S.notes.forEach((n) => {
      fixId(n);
      n.title = str(n.title, 160) || 'Session notes';
      n.date = str(n.date, 20);
      n.body = str(n.body, 50000);
    });
    S.npcs.forEach((n) => {
      fixId(n);
      n.name = str(n.name, 80) || 'Unnamed';
      n.role = str(n.role, 80);
      n.where = str(n.where, 120);
      n.notes = str(n.notes, 4000);
      if (n.attitude === 'Neutral') n.attitude = 'Indifferent';
      if (!ATTITUDES.includes(n.attitude)) n.attitude = 'Unknown';
      n.voice = str(n.voice, 200);
      n.wants = str(n.wants, 300);
      n.knows = str(n.knows, 1000);
      n.last = int(n.last, 0, 0, 9999);
    });
    S.places.forEach((p) => {
      fixId(p);
      p.name = str(p.name, 120) || 'Unnamed place';
      p.notes = str(p.notes, 4000);
      if (!PLACE_KINDS.includes(p.kind)) p.kind = 'Landmark';
    });
    S.secrets.forEach((x) => {
      fixId(x);
      x.text = str(x.text, 2000);
      x.revealed = !!x.revealed;
      x.link = LINK_RE.test(String(x.link)) ? String(x.link) : '';
      x.tonight = !!x.tonight && !x.revealed;
      x.rsess = int(x.rsess, 0, 0, 9999);
    });
    S.plans.forEach((pl) => {
      fixId(pl);
      pl.name = str(pl.name, 120) || 'Encounter';
      pl.goal = str(pl.goal, 200);
      pl.lose = str(pl.lose, 200);
      pl.events = objs(pl.events)
        .map((e) => ({ r: int(e.r, 1, 1, 999), text: str(e.text, 200) }))
        .filter((e) => e.text)
        .slice(0, 30);
      pl.foes = objs(pl.foes).map((g) => ({
        base: str(g.base, 80) || 'Monster',
        count: int(g.count, 1, 1, 30),
        hp: int(g.hp, 1, 1, 99999),
        ac: int(g.ac, 10, 0, 40),
        ini: num(g.ini, 0, -20, 30),
        xp: int(g.xp, 0, 0, 1e7),
      }));
    });
    const seen = new Set();
    S.homebrew = S.homebrew.filter((h) => {
      fixId(h);
      h.n = str(h.n, 80).trim();
      if (!h.n || seen.has(h.n)) return false;
      seen.add(h.n);
      h.t = str(h.t, 80);
      h.cr = CR_XP[String(h.cr)] != null ? String(h.cr) : '1';
      h.xp = CR_XP[h.cr];
      h.ac = int(h.ac, 10, 0, 40);
      h.hp = int(h.hp, 1, 1, 99999);
      h.ini = int(h.ini, 0, -20, 30);
      h.spd = str(h.spd, 60);
      h.multi = int(h.multi, 1, 1, 6);
      h.atks = arr(h.atks)
        .filter(Array.isArray)
        .slice(0, 4)
        .map((a) => [0, 1, 2, 3, 4].map((i) => str(a[i], 60)));
      return true;
    });
    const pu = S.purse && typeof S.purse === 'object' ? S.purse : {};
    S.purse = {};
    ['cp', 'sp', 'ep', 'gp', 'pp'].forEach((k) => (S.purse[k] = int(pu[k], 0, 0, 1e9)));
    const t = S.time && typeof S.time === 'object' ? S.time : {};
    S.time = { day: int(t.day, 1, 1, 1e6), min: int(t.min, 480, 0, 1439), weather: str(t.weather, 120) };
    S.lights = objs(S.lights)
      .map((l) => {
        fixId(l);
        return { id: l.id, name: str(l.name, 40) || 'Torch', min: int(l.min, 60, 0, 1e5), max: int(l.max, 60, 1, 1e5) };
      })
      .filter((l) => l.min > 0)
      .slice(0, 20);
    S.scenes = S.scenes
      .map((s) => {
        fixId(s);
        return {
          id: s.id,
          title: str(s.title, 120) || 'Scene',
          kind: SCENE_KINDS.includes(s.kind) ? s.kind : 'Other',
          goal: str(s.goal, 200),
          read: str(s.read, 4000),
          done: !!s.done,
          ...slNorm(s),
        };
      })
      .slice(0, 100);
    S.clocks = S.clocks
      .map((c) => {
        fixId(c);
        const size = CLOCK_SIZES.includes(+c.size) ? +c.size : 6;
        return {
          id: c.id,
          name: str(c.name, 80) || 'Clock',
          size,
          fill: int(c.fill, 0, 0, size),
          tick: CLOCK_TICK[c.tick] ? c.tick : 'none',
          acc: int(c.acc, 0, 0, 1e6),
          cons: str(c.cons, 300),
        };
      })
      .slice(0, 40);
    {
      const cks = new Set(S.clocks.map((c) => c.id)),
        mis = new Set(S.missions.map((m) => m.id));
      const fid = (o) => {
        if (o.id == null) o.id = uid();
        fixId(o);
      };
      const kids = (v, max, fn) =>
        objs(v)
          .map((x) => {
            fid(x);
            return fn(x);
          })
          .filter(Boolean)
          .slice(0, max);
      S.fronts = S.fronts
        .map((f) => {
          fid(f);
          let on = true;
          // portents happen in order, so the ones done are always the first ones
          const portents = kids(f.portents, 12, (x) => {
            const text = str(x.text, 300).trim();
            if (!text) return null;
            on = on && !!x.done;
            return { id: x.id, text, done: on, day: on ? int(x.day, 0, 0, 1e6) : 0 };
          });
          return {
            id: f.id,
            name: str(f.name, 120) || 'Front',
            kind: FRONT_KINDS.includes(f.kind) ? f.kind : 'Adventure',
            goal: str(f.goal, 300),
            doom: str(f.doom, 300),
            cast: kids(f.cast, 12, (x) => {
              const name = str(x.name, 80).trim();
              return name ? { id: x.id, name, impulse: str(x.impulse, 160) } : null;
            }),
            portents,
            stakes: kids(f.stakes, 8, (x) => {
              const q = str(x.q, 300).trim();
              return q ? { id: x.id, q, a: str(x.a, 300) } : null;
            }),
            clock: cks.has(f.clock) ? f.clock : '',
            mission: mis.has(f.mission) ? f.mission : '',
            status: FRONT_STATUS.includes(f.status) ? f.status : 'active',
            tickWas: ['hour', 'day'].includes(f.tickWas) ? f.tickWas : '',
          };
        })
        .slice(0, 30);
      syncFronts(true);
    }
    const tn = S.tonight && typeof S.tonight === 'object' && !Array.isArray(S.tonight) ? S.tonight : {};
    const t0 = tn.t0 && typeof tn.t0 === 'object' ? tn.t0 : null;
    S.tonight = {
      started: int(tn.started, 0, 0, 9e15),
      t0: t0 ? { day: int(t0.day, 1, 1, 1e6), min: int(t0.min, 0, 0, 1439) } : null,
      log: objs(tn.log)
        .map((e) => {
          fixId(e);
          return {
            id: e.id,
            at: int(e.at, 0, 0, 9e15),
            day: int(e.day, 1, 1, 1e6),
            min: int(e.min, 0, 0, 1439),
            text: str(e.text, 500),
            auto: !!e.auto,
          };
        })
        .filter((e) => e.text)
        .slice(-400),
      wrap:
        tn.wrap && typeof tn.wrap === 'object' && !Array.isArray(tn.wrap)
          ? {
              draft: str(tn.wrap.draft, 50000),
              edited: !!tn.wrap.edited,
              cliff: str(tn.wrap.cliff, 300),
              lvl: !!tn.wrap.lvl,
              next: str(tn.wrap.next, 300),
            }
          : null,
    };
    S.handouts = objs(S.handouts)
      .map((h) => {
        fixId(h);
        return {
          id: h.id,
          title: str(h.title, 120) || 'Handout',
          body: str(h.body, 20000),
          img: h.img != null && ID_RE.test(String(h.img)) ? String(h.img) : null,
          shown: int(h.shown, 0, 0, 9999),
        };
      })
      .slice(0, 200);
    delete S.showHandout;
    mnNorm();
    draftNorm();
    skNorm();
    travelNorm();
    wNorm();
    S.example = !!S.example;
    liftImages();
    syncHomebrew();
  }
  // the New battle draft is kept in S.draftBattle, so a reload or a closed tab doesn't lose a half-built fight
  function draftNorm() {
    const d = S.draftBattle;
    S.draftBattle = null;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    const pids = new Set(S.players.map((p) => p.id));
    const foe = (f) => {
      fixId(f);
      const base = str(f.base, 80).trim();
      if (!base) return null;
      const maxHp = int(f.maxHp, 1, 1, 99999);
      const x = {
        id: f.id,
        base,
        name: str(f.name, 80) || base,
        maxHp,
        hp: maxHp,
        ac: int(f.ac, 10, 0, 40),
        ini: num(f.ini, 0, -20, 30),
        xp: int(f.xp, 0, 0, 1e7),
        conditions: [],
      };
      if (f.hidden) x.hidden = true;
      return x;
    };
    const r = {
      name: str(d.name, 120),
      picked: [...new Set(arr(d.picked).map(String))].filter((id) => pids.has(id)),
      foes: objs(d.foes).map(foe).filter(Boolean).slice(0, 100),
      custom: objs(d.custom)
        .map((m) => {
          const n = str(m.n, 80).trim();
          return n
            ? {
                n,
                hp: int(m.hp, 1, 1, 99999),
                ac: int(m.ac, 10, 0, 40),
                ini: num(m.ini, 0, -20, 30),
                xp: int(m.xp, 0, 0, 1e7),
              }
            : null;
        })
        .filter(Boolean)
        .slice(0, 40),
      goal: str(d.goal, 200),
      lose: str(d.lose, 200),
      events: objs(d.events)
        .map((e) => ({ r: int(e.r, 1, 1, 99), text: str(e.text, 200) }))
        .filter((e) => e.text)
        .slice(0, 30),
      evT: str(d.evT, 200),
      stakesOpen: !!d.stakesOpen,
      showCustom: !!d.showCustom,
      genD: int(d.genD, 1, 0, 2),
      genT: str(d.genT, 60),
    };
    const pr = d.prep;
    if (pr && typeof pr === 'object' && !Array.isArray(pr)) {
      const ini = (v) => (v === '' || v == null ? '' : num(v, 0, -99, 99));
      r.prep = {
        pcs: objs(pr.pcs)
          .map((c) => {
            fixId(c);
            return pids.has(c.pid)
              ? {
                  id: c.id,
                  pid: c.pid,
                  name: str(c.name, 80) || 'Player',
                  ini: num(c.ini, 0, -20, 30),
                  init: ini(c.init),
                  ds: { s: 0, f: 0 },
                }
              : null;
          })
          .filter(Boolean),
        foes: objs(pr.foes)
          .map((f) => {
            const x = foe(f);
            if (!x) return null;
            x.roll = int(f.roll, 1, 1, 20);
            x.init = num(f.init, x.roll + x.ini, -99, 99);
            return x;
          })
          .filter(Boolean)
          .slice(0, 100),
        group: !!pr.group,
        surp: !!pr.surp,
      };
    }
    if (!r.name && !r.foes.length && !r.goal && !r.lose && !r.events.length && !r.custom.length && !r.prep) return;
    S.draftBattle = r;
  }
  let DRAFT_T = 0,
    DRAFT_PREV = null,
    DRAFT_UNDO = null;
  const draftLoad = () => (S && S.draftBattle ? JSON.parse(JSON.stringify(S.draftBattle)) : null);
  function draftClean() {
    if (!bdraft) return null;
    const keep = S.draftBattle;
    S.draftBattle = JSON.parse(JSON.stringify(bdraft));
    draftNorm();
    const r = S.draftBattle;
    S.draftBattle = keep;
    return r;
  }
  // a quiet save: the draft is not an undo step of its own
  function draftWrite() {
    clearTimeout(DRAFT_T);
    DRAFT_T = 0;
    if (!S) return;
    const d = bdraft ? draftClean() : S.draftBattle || null;
    if (JSON.stringify(d) === JSON.stringify(S.draftBattle || null)) return;
    S.draftBattle = d;
    if (!dirty && !TAB_STALE) save();
  }
  function draftSync() {
    clearTimeout(DRAFT_T);
    DRAFT_T = setTimeout(draftWrite, 300);
  }
  // Begin battle and Clear can be undone, and the undo brings the draft back
  function draftDrop() {
    DRAFT_PREV = draftClean() || S.draftBattle || null;
    clearTimeout(DRAFT_T);
    DRAFT_T = 0;
    S.draftBattle = null;
  }
  function draftMark() {
    if (DRAFT_PREV) {
      DRAFT_UNDO = { ref: UNDO[UNDO.length - 1], d: DRAFT_PREV };
      DRAFT_PREV = null;
    }
  }
  function draftAfterUndo(top, keep) {
    if (DRAFT_UNDO && top && DRAFT_UNDO.ref === top) {
      S.draftBattle = DRAFT_UNDO.d;
      DRAFT_UNDO = null;
      bdraft = draftLoad();
    } else S.draftBattle = keep || null;
  }
  addEventListener('pagehide', () => {
    try {
      draftWrite();
    } catch (e) {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      try {
        draftWrite();
      } catch (e) {}
  });
  document.addEventListener('input', () => {
    if (bdraft && view && view.sec === 'battle' && view.sub === 'new') draftSync();
  });
  document.addEventListener('change', () => {
    if (bdraft && view && view.sec === 'battle' && view.sub === 'new') draftSync();
  });
  // live difficulty read for the DM
  function diffRead(b) {
    const pcs = b.combatants.filter((c) => c.pid && S.players.some((p) => p.id === c.pid));
    const foes = b.combatants.filter((c) => !c.pid && !c.lair && !c.ally),
      gone = b.gone || [];
    if (!pcs.length || (!foes.length && !gone.length)) return null;
    let hp = 0,
      max = 0,
      down = 0;
    pcs.forEach((c) => {
      const h = cbState(c);
      hp += Math.max(0, +h.hp || 0);
      max += +h.max || 0;
      if (h.hp <= 0) down++;
    });
    const up = foes.filter((c) => c.hp > 0 && !c.fled),
      total = foes.length + gone.length;
    const xp0 = foes.reduce((t, c) => t + (+c.xp || 0), 0) + gone.reduce((t, g) => t + (+g.xp || 0), 0),
      xpUp = up.reduce((t, c) => t + (+c.xp || 0), 0);
    const hpP = max ? Math.round((hp / max) * 100) : 0,
      foeP = xp0 ? xpUp / xp0 : total ? up.length / total : 0;
    let hint = '',
      lvl = '';
    if (!up.length) {
      hint = 'No foes standing. End the battle?';
      lvl = 'ok';
    } else if ((hpP <= 35 || down * 2 >= pcs.length) && foeP >= 0.5) {
      hint = `Party at ${hpP}% HP, ${up.length} of ${total} foes standing. Consider a retreat or reinforcements.`;
      lvl = 'dn';
    } else if (foeP <= 0.25 && hpP >= 40) {
      hint = 'Foes nearly gone. Wrap it up?';
      lvl = 'ok';
    }
    return { hpP, down, pcs: pcs.length, up: up.length, total, xpUp, xp0, hint, lvl };
  }
  function diffHTML(b) {
    const r = diffRead(b);
    if (!r) return '';
    return `<div class="diffst" id="diffSt" title="Only you see this"><span>Party <b class="num">${r.hpP}%</b> HP</span><span>${r.down ? `<b class="num">${r.down}</b> of ${r.pcs} down` : 'No one down'}</span><span>Foes <b class="num">${r.up}</b> of ${r.total} standing${r.xp0 ? ` · <span class="num">${r.xpUp.toLocaleString()} of ${r.xp0.toLocaleString()} XP</span> left` : ''}</span>${r.hint ? `<span class="pill ${r.lvl}">${esc(r.hint)}</span>` : ''}</div>`;
  }
  // damage type on Hit: remembered for the rest of the turn (a multiattack keeps it), cleared when the turn passes
  let DTY = null;
  const dtyKey = (b) => `${b.id}:${b.round}:${b.turn}`;
  const dtyNow = (b) => (DTY && DTY.k === dtyKey(b) ? DTY.ty : '');
  function dtySel(b, i, c) {
    const cur = dtyNow(b),
      n = c.base || c.name;
    return `<select class="dty" data-dty="${i}" aria-label="Damage type for ${esc(c.name)}" title="Damage type, optional. Your notes on this monster decide resisted, immune or vulnerable">${[
      '',
      ...DMG_TYPES,
    ]
      .map((t) => {
        const k = dmgKind(n, t);
        return `<option value="${t}"${t === cur ? ' selected' : ''}>${t || 'Type'}${k ? ` (${MN_KIND[k][1]})` : ''}</option>`;
      })
      .join('')}</select>`;
  }
  let loadDamaged = false,
    loadMissing = false;
  // data safety: while a damaged save is unresolved nothing may write KEY or the backup file (see "data safety")
  let RECOVERY_HOLD = false,
    DAMAGED = null, // { raw, reasons, key }
    UNDO_READY = false;
  const isQuota = (e) =>
    !!e &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  /* Is this saved text a readable board? Pure: normalize() runs on a copy, never on S.
     Returns { ok, damaged, reasons[], board } (board = the normalized copy). */
  function checkBoard(raw) {
    let d;
    try {
      d = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (e) {
      return { ok: false, damaged: true, reasons: ['unreadable'], board: null };
    }
    if (!d || typeof d !== 'object' || Array.isArray(d))
      return { ok: false, damaged: true, reasons: ['shape'], board: null };
    const reasons = [],
      keys = [...EX_KEYS, 'plans', 'homebrew', 'handouts', 'sketches'],
      before = {};
    if (d.dm !== undefined && (!d.dm || typeof d.dm !== 'object' || Array.isArray(d.dm))) reasons.push('dm');
    keys.forEach((k) => {
      if (d[k] !== undefined && d[k] !== null && !Array.isArray(d[k])) reasons.push(k);
      before[k] = Array.isArray(d[k]) ? d[k].length : 0;
    });
    const keep = S;
    let out = null;
    try {
      S = d;
      normalize();
      out = S;
    } catch (e) {
      reasons.push('normalize');
    } finally {
      S = keep;
    }
    if (out)
      keys.forEach((k) => {
        const a = Array.isArray(out[k]) ? out[k].length : 0,
          b = before[k];
        if (a < b && (k === 'players' || (b >= 4 && (b - a) / b > 0.25))) reasons.push('dropped:' + k);
      });
    return { ok: !reasons.length, damaged: !!reasons.length, reasons, board: out };
  }
  /* keep the unreadable text aside: newest 3 copies, never the same text twice, IndexedDB if storage is full */
  const DMG_PFX = KEY + '-damaged-';
  function damagedKeys() {
    try {
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(DMG_PFX) || k === KEY + '-damaged')
        .sort((a, b) => (+a.slice(DMG_PFX.length) || 0) - (+b.slice(DMG_PFX.length) || 0));
    } catch (e) {
      return [];
    }
  }
  function keepDamaged(raw) {
    const ks = damagedKeys();
    for (const k of ks) {
      try {
        if (localStorage.getItem(k) === raw) return k;
      } catch (e) {}
    }
    let at = Date.now();
    while (ks.includes(DMG_PFX + at)) at++;
    try {
      localStorage.setItem(DMG_PFX + at, raw);
      ks.filter((k) => k !== KEY + '-damaged')
        .slice(0, -2)
        .forEach((k) => localStorage.removeItem(k));
      return DMG_PFX + at;
    } catch (e) {
      queued(() =>
        tx(['kv'], 'readwrite', (st) => {
          st('kv').put(raw, 'damaged:' + at);
        })
      ).catch((e2) => console.warn('Damaged copy not kept', e2));
      return 'idb:damaged:' + at;
    }
  }
  function load() {
    loadDamaged = loadMissing = false;
    loadImgs();
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {}
    if (raw) {
      const c = checkBoard(raw);
      if (c.ok) {
        S = c.board;
        lastJSON = JSON.stringify(S);
        return;
      }
      loadDamaged = true;
      RECOVERY_HOLD = true;
      DAMAGED = { raw, reasons: c.reasons, key: keepDamaged(raw) };
    }
    loadMissing = !raw;
    S = sample();
    normalize();
    lastJSON = JSON.stringify(S);
  }
  let UNDO = [],
    lastJSON = null;
  // map images are stored under their own key so every save and undo step stays small
  const IMG_KEY = KEY + '-img';
  let IMGS = {};
  const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const cleanImgs = (o) => {
    const r = {};
    if (o && typeof o === 'object')
      Object.entries(o).forEach(([k, v]) => {
        if (ID_RE.test(k) && typeof v === 'string' && IMG_RE.test(v)) r[k] = v;
      });
    return r;
  };
  function loadImgs() {
    try {
      IMGS = cleanImgs(JSON.parse(localStorage.getItem(IMG_KEY) || '{}'));
    } catch (e) {
      IMGS = {};
    }
  }
  function saveImgs() {
    try {
      localStorage.setItem(IMG_KEY, JSON.stringify(IMGS));
      return true;
    } catch (e) {
      return false;
    }
  }
  function liftImages() {
    let moved = false;
    (S.battles || []).forEach((b) => {
      if (b.map && b.map.bg) {
        const id = uid();
        IMGS[id] = b.map.bg;
        b.map.img = id;
        delete b.map.bg;
        moved = true;
      }
    });
    if (moved && !RECOVERY_HOLD && saveImgs()) {
      try {
        localStorage.setItem(KEY, JSON.stringify(S));
      } catch (e) {}
    }
  }
  function pruneImgs(force) {
    // persisted undo steps come back after load and may still need their images
    if (!UNDO_READY && !force) return;
    const used = new Set(
      [...S.battles.map((b) => b.map && b.map.img), ...(S.handouts || []).map((h) => h.img)].filter(Boolean)
    );
    UNDO.forEach((j) => j.replace(/"img":"([a-z0-9]+)"/g, (m, k) => used.add(k)));
    Object.keys(IMGS).forEach((k) => {
      if (!used.has(k)) delete IMGS[k];
    });
  }
  const mapBg = (m) => (m && m.img ? IMGS[m.img] || '' : '');
  let warnedFull = false,
    holdToastAt = 0;
  function save() {
    clearTimeout(saveTimer);
    dirty = false;
    if (TAB_STALE) {
      toast('Not saved: this board was changed in another tab. Reload first');
      return;
    }
    if (RECOVERY_HOLD) {
      // the damaged save stays where it is until the DM picks a recovery option
      dirty = true;
      if (Date.now() - holdToastAt > 8000) {
        holdToastAt = Date.now();
        toast('Choose how to recover first');
      }
      drawSaveState();
      return;
    }
    lastJSON = JSON.stringify(S);
    afterSave();
    try {
      localStorage.setItem(KEY, lastJSON);
      if (warnedFull || document.getElementById('saveWarn')) saveWarn(false);
      afterWriteOk();
    } catch (e) {
      if (!isQuota(e)) {
        // not "full": storage is blocked (private mode, policy); pruning images wouldn't help
        saveWarn(true, 'error');
        return;
      }
      // browser storage is full: drop map images from finished battles and try once more
      pruneImgs(true);
      saveImgs();
      try {
        localStorage.setItem(KEY, lastJSON);
        saveWarn(false);
        afterWriteOk();
        return;
      } catch (e1) {}
      const old = S.battles.filter((b) => !b.active && b.map && b.map.img);
      if (old.length) {
        const keep = old.map((b) => [b, b.map.img, IMGS[b.map.img]]);
        old.forEach((b) => {
          delete IMGS[b.map.img];
          b.map.img = null;
        });
        saveImgs();
        lastJSON = JSON.stringify(S);
        try {
          localStorage.setItem(KEY, lastJSON);
          saveWarn(false);
          afterWriteOk();
          toast('Storage was full, so map images from finished battles were removed');
          return;
        } catch (e2) {
          keep.forEach(([b, id, d]) => {
            b.map.img = id;
            IMGS[id] = d;
          });
          saveImgs();
          lastJSON = JSON.stringify(S);
        }
      }
      saveWarn(true, 'full');
    }
  }
  function saveWarn(on, kind) {
    let el = document.getElementById('saveWarn');
    if (!on) {
      el && el.remove();
      warnedFull = false;
      drawSaveState();
      return;
    }
    warnedFull = kind || 'full';
    if (!el) {
      el = document.createElement('div');
      el.id = 'saveWarn';
      el.className = 'savewarn';
      el.setAttribute('role', 'alert');
      document.body.appendChild(el);
    }
    const fileOk = SAFE.file && !SAFE.filePaused && !SAFE.fileErr;
    const msg =
      warnedFull === 'error'
        ? 'Changes aren’t being saved: this browser blocked storage. Your board is still open. Save a backup now.'
        : `Browser storage is full, so changes aren’t being saved here. Your board is still open. Save a backup now, then delete old campaigns, battles or map images.${fileOk ? ' Your backup file is still being updated.' : ''}`;
    if (el.dataset.msg !== msg) {
      el.dataset.msg = msg;
      el.innerHTML = `<span>${esc(msg)}</span> <span class="sfbtns"><button class="btn sm pri" type="button" id="swSave">Save backup now</button>${warnedFull === 'error' ? '' : '<button class="btn sm ghost" type="button" id="swSpace">See what uses space</button>'}</span>`;
      el.querySelector('#swSave').onclick = () => exportData();
      const sp = el.querySelector('#swSpace');
      if (sp) sp.onclick = () => openSheet('campaign', CAMP ? 'camps' : 'data');
    }
    drawSaveState();
  }
  function pushUndo() {
    if (lastJSON) {
      UNDO.push(lastJSON);
      if (UNDO.length > 40) UNDO.shift();
    }
  }
  // saving is batched: the screen updates at once, the write to storage follows a moment later
  let saveTimer = null,
    dirty = false;
  function commit() {
    if (!dirty) pushUndo();
    dirty = true;
    dsMirror();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
    try {
      render();
      if (view) drawSheet();
    } catch (e) {
      oops(e);
    }
  }
  // last line of defence: a screen error never loses data, and the DM is told how to recover
  let oopsAt = 0;
  function oops(e) {
    console.warn(e);
    if (Date.now() - oopsAt > 5000) {
      oopsAt = Date.now();
      toast('Something went wrong drawing the screen. Your data is safe. Press Ctrl+Z to undo the last change.');
    }
  }
  window.addEventListener('error', (e) => oops(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => oops(e.reason));
  function flush() {
    if (dirty) save();
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  function undo() {
    if (view && view.sec === 'player' && pdraft) {
      const src = S.players.find((x) => x.id === pdraft.id);
      const { _new, ...dr } = pdraft;
      if (_new || !src || JSON.stringify(dr) !== JSON.stringify(src)) {
        toast('Save or close the player sheet first, then undo');
        return;
      }
    }
    if (!UNDO.length) {
      toast('Nothing to undo');
      return;
    }
    clearTimeout(saveTimer);
    dirty = false;
    const dTop = UNDO[UNDO.length - 1],
      dKeep = bdraft ? draftClean() : S.draftBattle || null;
    S = JSON.parse(UNDO.pop());
    normalize();
    draftAfterUndo(dTop, dKeep);
    lastJSON = JSON.stringify(S);
    if (!TAB_STALE && !RECOVERY_HOLD) {
      let ok = false;
      try {
        localStorage.setItem(KEY, lastJSON);
        ok = true;
      } catch (e) {}
      afterSave();
      if (ok) afterWriteOk();
    } else schedUndo();
    if (view && view.sec === 'player' && pdraft && !pdraft._new) {
      const src = S.players.find((x) => x.id === pdraft.id);
      if (src) pdraft = JSON.parse(JSON.stringify(src));
      else {
        view = null;
        $('overlay').innerHTML = '';
      }
    }
    $('mcard') && $('mcard').remove();
    render();
    if (view) drawSheet();
    toast('Undone');
  }
  const EX_KEYS = [
    'players',
    'battles',
    'missions',
    'loot',
    'notes',
    'npcs',
    'places',
    'secrets',
    'scenes',
    'clocks',
    'fronts',
  ];
  const backupAge = () => {
    const d = S.dm.lastBackup;
    if (!d) return null;
    const n = Math.floor((Date.parse(today()) - Date.parse(d)) / 864e5);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };
  try {
    navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
  } catch (e) {}
  function clearExample() {
    if (S.example) {
      EX_KEYS.forEach((k) => (S[k] = []));
      ['plans', 'handouts', 'lights'].forEach((k) => (S[k] = []));
      S.purse = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      S.time = { day: 1, min: 480, weather: '' };
      S.tonight = { started: 0, t0: null, log: [] };
      if (S.dm.campaign === 'The Drowned Bell (demo)') {
        S.dm.campaign = '';
        S.dm.session = 1;
        S.dm.dturn = 0;
        S.dm.lastBackup = '';
      }
      S.example = false;
    }
  }

  /* ---------- helpers ---------- */
  function hpClass(hp, max) {
    const p = max > 0 ? hp / max : 0;
    return p <= 0.25 ? 'low' : p <= 0.5 ? 'mid' : '';
  }
  function pct(hp, max) {
    return max ? clamp((hp / max) * 100, 0, 100) : 0;
  }
  function statusPills(p) {
    const out = [];
    if (p.hp <= 0)
      out.push(
        p.dead
          ? '<span class="pill dn">Dead</span>'
          : '<span class="pill dn">Down</span>' + (inFight(p) ? '' : cardDs(p))
      );
    else if (p.hp <= p.maxHp / 2) out.push('<span class="pill bl">Bloodied</span>');
    else out.push('<span class="pill ok">Healthy</span>');
    (p.conditions || []).forEach((c) => {
      if (!(c === 'Unconscious' && p.hp <= 0)) out.push(`<span class="pill cd">${esc(c)}</span>`);
    });
    if (p.exh)
      out.push(
        `<span class="pill bl" title="${p.exh >= 6 ? 'Dead' : `−${2 * p.exh} to every D20 Test, Speed −${5 * p.exh} ft`}">Exhaustion ${p.exh}</span>`
      );
    (p.injuries || []).forEach((n) => out.push(`<span class="pill inj" title="${esc(injFx(n))}">${esc(n)}</span>`));
    if (levelUpReady(p))
      out.push(
        `<button type="button" class="pill ok" data-lvup="${p.id}" title="Open the level up box">Level up</button>`
      );
    return out.join('');
  }
  // lingering injuries (an optional rule): d20 table, effects summarised for the DM
  const INJ = [
    [1, 1, 'Lost an eye', 'Disadvantage on sight-based Perception checks and ranged attack rolls.'],
    [2, 2, 'Lost an arm or hand', 'Can hold only one thing and can no longer use two-handed weapons.'],
    [3, 3, 'Lost a foot or leg', 'Speed halved and needs a cane or crutch. Falls prone after Dashing.'],
    [4, 4, 'Limp', 'Speed drops by 5 feet. Dashing can leave them prone.'],
    [5, 7, 'Internal injury', 'Before acting in combat, DC 15 Constitution save or lose that action.'],
    [8, 10, 'Broken ribs', 'Before acting in combat, DC 10 Constitution save or lose that action.'],
    [11, 13, 'Horrible scar', 'Disadvantage on Persuasion, advantage on Intimidation.'],
    [14, 16, 'Festering wound', 'Hit point maximum drops by 1 every 24 hours until magic heals it.'],
    [17, 20, 'Minor scar', 'No lasting effect beyond a story.'],
  ];
  const injFx = (n) => (INJ.find((x) => x[2] === n) || [])[3] || '';
  function rollInjury(p) {
    const r = rnd(20),
      row = INJ.find((x) => r >= x[0] && r <= x[1]);
    p.injuries = p.injuries || [];
    if (row[2] !== 'Minor scar' && !p.injuries.includes(row[2]) && p.injuries.length < 12) p.injuries.push(row[2]);
    return { r, name: row[2], fx: row[3] };
  }
  function activeBattle() {
    return S.battles.find((b) => b.active);
  }
  const XP_LEVEL = [
    0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000,
    265000, 305000, 355000,
  ];
  function levelUpReady(p) {
    const l = clamp(+p.level || 1, 1, 20);
    return l < 20 && (+p.xp || 0) >= XP_LEVEL[l];
  }
  function xpLine(p) {
    const l = clamp(+p.level || 1, 1, 20);
    return l >= 20
      ? 'Level 20, the top of the table.'
      : levelUpReady(p)
        ? `Ready for level ${l + 1}. Press Level up below.`
        : `${(XP_LEVEL[l] - (+p.xp || 0)).toLocaleString()} XP to level ${l + 1}.`;
  }
  function revive(p) {
    if (!p || !p.dead) return;
    p.dead = false;
    if ((+p.exh || 0) >= 6) p.exh = 5;
    p.hp = Math.max(1, +p.hp || 0);
    p.conditions = (p.conditions || []).filter((c) => c !== 'Unconscious');
    resetDs(p);
    const b = activeBattle();
    if (b && b.combatants.some((c) => c.pid === p.id)) b.log.push(`R${b.round}: ${p.name} is revived with 1 HP.`);
    tlog(`${p.name} was brought back to life.`, true);
    commit();
    toast(`${p.name} is back with 1 HP`);
  }
  // the live battle's death saves are copied onto the player, so they outlast the battle
  function dsMirror() {
    const b = activeBattle();
    if (!b) return;
    b.combatants.forEach((c) => {
      if (!c.pid || !c.ds) return;
      const p = S.players.find((x) => x.id === c.pid);
      if (p && (+p.hp || 0) <= 0) p.ds = dsOf(c.ds);
    });
  }
  const dsSeed = (p) => (p && (+p.hp || 0) <= 0 && !p.dead && p.ds ? dsOf(p.ds) : { s: 0, f: 0 });
  const inFight = (p) => {
    const b = activeBattle();
    return !!b && b.combatants.some((c) => c.pid === p.id);
  };
  function cardDs(p) {
    const d = dsOf(p.ds);
    if (d.s >= 3) return '<span class="pill ok">Stable</span>';
    const dots = (k, n, l) =>
      Array.from(
        { length: 3 },
        (_, i) =>
          `<button type="button" class="${k}${i < n ? ' on' : ''}" data-pds="${p.id}" data-k="${k}" data-n="${i}" aria-label="${l} ${i + 1}"></button>`
      ).join('');
    return `<span class="ds" data-pdsw title="Death saves">${dots('s', d.s, 'Death save success')} ${dots('f', d.f, 'Death save failure')}<button type="button" class="mini" data-pdsroll="${p.id}" title="d20: 10 or higher succeeds">Roll</button></span>`;
  }
  // a death save away from the battle tracker: the same 2024 rules as deathSave()
  function pDeathSave(p) {
    p.ds = dsOf(p.ds);
    const r = rnd(20),
      ex = 2 * (+p.exh || 0),
      tot = r - ex;
    if (r === 20) {
      changeHp(p, 1);
      tlog(`${p.name} rolled a 20 on a death save and is back up with 1 HP.`, true);
      toast(`${p.name} rolls a 20 and is back up with 1 HP`);
      return;
    }
    if (r === 1) p.ds.f = Math.min(3, p.ds.f + 2);
    else if (tot >= 10) p.ds.s = Math.min(3, p.ds.s + 1);
    else p.ds.f = Math.min(3, p.ds.f + 1);
    if (p.ds.f >= 3) {
      p.dead = true;
      tlog(`${p.name} died.`, true);
      toast(`${p.name} has died`);
    } else if (p.ds.s >= 3) {
      p.ds.f = 0;
      tlog(`${p.name} is stable.`, true);
      toast(`${p.name} is stable`);
    } else
      toast(
        `Death save ${r}${ex && r > 1 ? ` − ${ex}` : ''}: ${r === 1 ? 'two failures' : tot >= 10 ? 'success' : 'failure'} (${p.ds.s} ✓, ${p.ds.f} ✗)`
      );
  }
  function resetDs(p) {
    p.ds = { s: 0, f: 0 };
    S.battles.forEach((b) =>
      b.combatants.forEach((c) => {
        if (c.pid === p.id) c.ds = { s: 0, f: 0 };
      })
    );
  }
  /* short rest: players spend Hit Dice, the DM types what each regains */
  const HIT_DIE = { Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10, Sorcerer: 6, Wizard: 6 };
  const hitDie = (p) => HIT_DIE[p.cls] || 8;
  const hdLeft = (p) => Math.max(0, (+p.level || 1) - (+p.hdu || 0));
  const hdText = (p) => `${hdLeft(p)} of ${+p.level || 1} d${hitDie(p)} left`;
  /* the current scene's boxed text, big enough to read aloud */
  function readAloudPop() {
    const sc = S.scenes.find((x) => !x.done);
    if (!sc) return;
    const el = popup(
      sc.title,
      popHead(sc.title, `${esc(sc.kind)} scene`) +
        `${sc.goal ? `<p class="goal">Goal: ${esc(sc.goal)}</p>` : ''}<p class="readbig">${esc(sc.read)}</p>
    <div class="row end"><button class="btn ghost" type="button" data-mclose>Close</button>${S.tonight.started ? '<button class="btn" type="button" id="rdDone">Scene done</button>' : ''}</div>`
    );
    el.querySelector('.mc').classList.add('readpop');
    el.querySelector('#rdDone') &&
      (el.querySelector('#rdDone').onclick = () => {
        el.remove();
        $('sceneDone') && $('sceneDone').click();
      });
  }
  function shortRestPop() {
    const ps = S.players.filter((p) => isHere(p) && !p.dead);
    const el = popup(
      'Short rest',
      popHead(
        'Short rest',
        `${S.dm.gritty ? '8 hours pass' : '1 hour passes'}. Each player rolls the Hit Dice they spend and adds their Constitution modifier. Type what they regain.`
      ) +
        (ps.length
          ? `<div class="srlist">${ps
              .map((p) => {
                const left = Math.max(0, p.level - (+p.hdu || 0));
                return `<div class="srrow"><div><b>${esc(p.name)}</b><small class="num">HP ${p.hp} / ${p.maxHp} · Hit Dice ${left} / ${p.level} d${hitDie(p)}</small>${(+p.hp || 0) <= 0 ? '<span class="srdown">Down</span>' : ''}</div>
      <label>Dice spent<input type="number" min="0" max="${left}" value="" placeholder="0" data-srd="${p.id}" aria-label="Hit Dice ${esc(p.name)} spends"></label>
      <label>HP regained<input type="number" min="0" value="" placeholder="0" data-srh="${p.id}" aria-label="HP ${esc(p.name)} regains"></label><button class="btn sm ghost" type="button" data-srr="${p.id}" title="Roll the Hit Dice spent. Add Constitution yourself">Roll</button></div>`;
              })
              .join('')}</div>`
          : '<p class="quiet">Nobody here can rest.</p>') +
        `<div class="row end"><button class="btn ghost" type="button" data-mclose>Cancel</button><button class="btn pri" type="button" id="srGo">Finish short rest</button></div>`
    );
    el.querySelector('.mc').classList.add('srpop');
    const ins = [...el.querySelectorAll('input')];
    ins.forEach(
      (x, k) =>
        (x.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const nx = ins[k + 1];
            nx ? nx.focus() : $('srGo').focus();
          }
        })
    );
    ins[0] && ins[0].focus();
    el.querySelectorAll('[data-srr]').forEach(
      (x) =>
        (x.onclick = () => {
          const p = ps.find((y) => y.id === x.dataset.srr);
          if (!p) return;
          const left = Math.max(0, p.level - (+p.hdu || 0)),
            di = el.querySelector(`[data-srd="${p.id}"]`);
          let d = clamp(Math.round(+di.value || 0), 0, left);
          if (!d) {
            if (!left) {
              toast(`${p.name} has no Hit Dice left`);
              return;
            }
            d = 1;
            di.value = 1;
          }
          const r = Array.from({ length: d }, () => 1 + Math.floor(Math.random() * hitDie(p))),
            t = r.reduce((a, b) => a + b, 0);
          el.querySelector(`[data-srh="${p.id}"]`).value = t;
          toast(`${p.name}: ${d}d${hitDie(p)} rolled ${r.join(' + ')} = ${t}. Add Constitution × ${d} if you like`);
        })
    );
    $('srGo').onclick = () => {
      const got = [];
      ps.forEach((p) => {
        const left = Math.max(0, p.level - (+p.hdu || 0));
        const d = clamp(Math.round(+el.querySelector(`[data-srd="${p.id}"]`).value || 0), 0, left);
        const h = Math.max(0, Math.round(+el.querySelector(`[data-srh="${p.id}"]`).value || 0));
        p.hdu = (+p.hdu || 0) + d;
        if (h > 0) changeHp(p, h);
        if (d || h)
          got.push(
            `${p.name} ${h ? `+${h} HP` : ''}${d && h ? ', ' : ''}${d ? `${d} Hit ${d > 1 ? 'Dice' : 'Die'}` : ''}`
          );
      });
      ps.forEach((p) => restoreRes(p, 'short'));
      S.players.forEach((p) => {
        if (pureWarlock(p)) p.sused = Array(9).fill(0);
        if (p.pact) p.pact.used = 0;
      });
      advance(S.dm.gritty ? 480 : 60);
      if (S.tonight.started) tlog(`Short rest${got.length ? `: ${got.join('; ')}` : ''}.`, true);
      el.remove();
      commit();
      toast(
        `Short rest: ${S.dm.gritty ? '8 hours pass' : '1 hour passes'}${S.players.some((p) => pureWarlock(p) || p.pact) ? '. Pact Magic slots are back' : ''}. Undo with Ctrl+Z`
      );
    };
  }
  function longRest(p) {
    if (p.dead || (+p.hp || 0) <= 0) return false;
    p.hdu = 0;
    p.sused = Array(9).fill(0);
    if (p.pact) p.pact.used = 0;
    p.hp = +p.maxHp;
    p.thp = 0;
    p.conditions = (p.conditions || []).filter((c) => !['Unconscious', 'Concentrating'].includes(c));
    p.exh = Math.max(0, (+p.exh || 0) - 1);
    resetDs(p);
    restoreRes(p, 'long');
    return true;
  }
  // 2024 rules: no resting in the middle of a fight, so ask first while a battle is live
  function restGuard(what, go) {
    if (!activeBattle()) {
      go();
      return;
    }
    const el = popup(
      'Rest',
      popHead(
        'A battle is running',
        `Characters can’t take a ${what} during combat. End the battle first, or rest anyway if the fight is really over.`
      ) +
        `<div class="row end"><button class="btn ghost" type="button" data-mclose id="rgNo">Cancel</button><button class="btn" type="button" id="rgGo">Rest anyway</button></div>`
    );
    el.querySelector('#rgNo').focus();
    el.querySelector('#rgGo').onclick = () => {
      el.remove();
      go();
    };
  }
  const andList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  function hpPop(p) {
    if (!p) return;
    const el = popup(
      p.name,
      popHead(
        p.name,
        `HP ${p.hp} / ${p.maxHp}${+p.thp > 0 ? ` · ${p.thp} temp` : ''} · AC ${p.ac} · Passive Perception ${p.pp ?? 10}, Insight ${p.pins ?? 10}, Investigation ${p.pinv ?? 10}${+p.sdc ? ` · Spell DC ${p.sdc}` : ''}`
      ) +
        `
    <div class="row"><input type="number" min="0" id="hpAmt" placeholder="Amount" style="flex:1" aria-label="Amount"></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn pri" type="button" data-hpk="dmg">Damage</button><button class="btn" type="button" data-hpk="heal">Heal</button><button class="btn ghost" type="button" data-hpk="thp">Set temp HP</button></div>
    ${p.dead ? `<div class="row"><button class="btn" type="button" id="hpRevive">Revive with 1 HP</button></div><p class="foot">${esc(p.name)} is dead, so healing has no effect. Revive covers Revivify, Raise Dead and the like.</p>` : `<p class="foot">Hit Dice: ${hdText(p)}. Damage uses temp HP first. Healing a downed character brings them back up.</p>`}`
    );
    el.querySelector('#hpRevive') &&
      (el.querySelector('#hpRevive').onclick = () => {
        el.remove();
        revive(p);
      });
    const inp = el.querySelector('#hpAmt');
    inp.focus();
    const go = (k) => {
      const n = Math.max(0, +inp.value || 0);
      if (!n && k !== 'thp') return;
      if (k === 'heal' && p.dead) {
        toast(`${p.name} is dead. Use Revive instead`);
        return;
      }
      const b = activeBattle(),
        c = b && b.combatants.find((x) => x.pid === p.id);
      if (k === 'thp') {
        p.thp = n;
        if (c) b.log.push(`R${b.round}: ${p.name} has ${n} temporary HP.`);
      } else if (c) b.log.push(hurt(b, c, k === 'dmg' ? -n : n, false));
      else changeHp(p, k === 'dmg' ? -n : n);
      el.remove();
      commit();
      toast(k === 'thp' ? `${p.name} has ${n} temp HP` : k === 'dmg' ? `${p.name} took ${n}` : `${p.name} healed ${n}`);
    };
    el.querySelectorAll('[data-hpk]').forEach((x) => (x.onclick = () => go(x.dataset.hpk)));
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') go('dmg');
    };
  }
  function absorb(t, delta) {
    if (delta < 0 && +t.thp > 0) {
      const a = Math.min(+t.thp, -delta);
      t.thp = +t.thp - a;
      delta += a;
    }
    return delta;
  }
  function changeHp(p, delta) {
    if (p.dead && delta > 0) {
      toast(`${p.name} is dead. Healing won’t help: use Revive in their HP box`);
      return;
    }
    delta = absorb(p, delta);
    const was = +p.hp || 0;
    p.hp = clamp(was + delta, 0, +p.maxHp || 0);
    p.conditions = p.conditions || [];
    if (p.hp <= 0) {
      if (!p.conditions.includes('Unconscious')) p.conditions.push('Unconscious');
      // dropping to 0 breaks concentration
      p.conditions = p.conditions.filter((c) => c !== 'Concentrating');
      // 2024 rules: damage left over after reaching 0 (or any hit at 0) that equals or exceeds the HP maximum kills outright
      if (delta < 0 && -delta - was >= (+p.maxHp || 1)) p.dead = true;
    }
    if (p.hp > 0) {
      p.conditions = p.conditions.filter((c) => c !== 'Unconscious');
      resetDs(p);
      p.dead = false;
    }
  }
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), Math.min(6000, 1900 + msg.length * 35));
  }
  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id)?.value ?? '').trim();

  /* ---------- home ---------- */
  const CLS_HUE = {
    Barbarian: 28,
    Bard: 340,
    Cleric: 85,
    Druid: 140,
    Fighter: 12,
    Monk: 205,
    Paladin: 55,
    Ranger: 165,
    Rogue: 265,
    Sorcerer: 310,
    Warlock: 290,
    Wizard: 235,
  };
  function avHue(p) {
    if (CLS_HUE[p.cls] != null) return CLS_HUE[p.cls];
    let h = 0;
    for (const ch of String(p.name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }
  /* theme: auto follows the device, or the DM picks light or dark (kept per browser) */
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_ICON = {
    auto: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
  };
  function getTheme() {
    try {
      const t = localStorage.getItem('dm-board-theme');
      return THEMES.includes(t) ? t : 'auto';
    } catch (e) {
      return 'auto';
    }
  }
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const b = $('themeBtn');
    if (b) {
      b.innerHTML = THEME_ICON[t];
      const lbl = { auto: 'Theme: matches your device', light: 'Theme: light', dark: 'Theme: dark' }[t];
      b.title = lbl + '. Click to change';
      b.setAttribute('aria-label', lbl + '. Click to change');
    }
  }
  function render() {
    const dm = S.dm;
    $('subline').textContent = `${dm.campaign || 'Untitled campaign'} · ${dm.name || 'Dungeon Master'}`;
    const tn = S.tonight,
      sc = S.scenes.find((x) => !x.done);
    $('dmSeat').innerHTML = `
    <section class="panel"><div class="ph"><h2>Session</h2><button class="lnk" type="button" id="editDm">Edit campaign</button></div>
      <div class="sessrow"><span class="sessn num"><small>Session</small>${esc(dm.session)}</span><button class="step" type="button" id="prevSess" aria-label="Previous session">‹</button><button class="step" type="button" id="nextSess" aria-label="Next session">›</button></div>
      ${tn.started ? `<div class="runline"><span class="live">Running</span><span class="num" id="runFor">${since(tn.started)}</span></div>` : ''}
      ${sc ? `<div class="scenenow"><small>${tn.started ? 'Now' : 'First scene'} · ${esc(sc.kind)}</small><b>${esc(sc.title)}</b>${sc.goal ? `<span>${esc(sc.goal)}</span>` : ''}${sc.read || tn.started ? `<div class="acts">${sc.read ? `<button class="lnk" type="button" id="sceneRead">Read aloud</button>` : ''}${tn.started ? `<button class="lnk" type="button" id="sceneDone">Scene done</button>` : ''}</div>` : ''}${slHome(sc)}</div>` : ''}
      <div class="row2"><button class="btn sm" type="button" id="sPlan">${tn.started ? 'Tonight' : 'Plan'}</button>${tn.started ? `<button class="btn sm" type="button" id="sWrap">Wrap up</button>` : `<button class="btn sm pri" type="button" id="sGo">Start session</button>`}</div></section>
    <section class="panel"><div class="ph"><h2>Time</h2></div>${clockHTML()}
      <div class="restrow"><button class="btn sm" type="button" id="partyShort" title="Party short rest (${dm.gritty ? '8 hours' : '1 hour'})">Short rest</button><button class="btn sm" type="button" id="partyRest" title="Party long rest (${dm.gritty ? '7 days' : '8 hours'})">Long rest</button></div></section>
    <section class="panel">${lightsHTML()}</section>
`;
    $('prevSess').onclick = () => {
      if (S.tonight.started) {
        toast('This session is still running. Use Wrap up to end it and move on');
        return;
      }
      S.dm.session = Math.max(1, (+S.dm.session || 1) - 1);
      commit();
    };
    $('nextSess').onclick = () => {
      takeSnap('End of session ' + S.dm.session, true);
      if (S.tonight.started) {
        toast('This session is still running. Use Wrap up to end it and move on');
        return;
      }
      S.dm.session = (+S.dm.session || 0) + 1;
      commit();
      writeFile();
      toast(
        remindBackup('wrap')
          ? `Now on session ${S.dm.session}.`
          : `Now on session ${S.dm.session}. Press Start session when you play`
      );
    };
    $('editDm').onclick = () => openSheet('campaign');
    $('partyRest').onclick = () => {
      if (!S.players.length) return;
      restGuard('long rest', () => {
        const out = S.players.filter((p) => !p.dead && !longRest(p)).map((p) => p.name);
        advance(S.dm.gritty ? 10080 : 480);
        commit();
        toast(
          `Party long rest: ${S.dm.gritty ? '7 days pass' : '8 hours pass'}${out.length ? `. ${andList(out)} ${out.length > 1 ? 'are' : 'is'} at 0 HP and ${out.length > 1 ? 'get' : 'gets'} no benefit` : ''}. Undo with Ctrl+Z`
        );
      });
    };
    $('partyShort').onclick = () => restGuard('short rest', shortRestPop);
    bindClock();
    bindLights();
    $('sPlan').onclick = () => openSheet('session', S.tonight.started ? 'tonight' : 'scenes');
    $('sGo') && ($('sGo').onclick = askPresent);
    $('sWrap') && ($('sWrap').onclick = () => openSheet('session', 'wrap'));
    $('sceneDone') &&
      ($('sceneDone').onclick = () => {
        const x = S.scenes.find((y) => !y.done);
        if (!x) return;
        x.done = true;
        tlog(`Scene played: ${x.title}.`, true);
        commit();
        const nx = S.scenes.find((y) => !y.done);
        toast(nx ? `Next scene: ${nx.title}` : 'That was the last planned scene');
      });
    $('sceneRead') && ($('sceneRead').onclick = readAloudPop);
    slBindHome();

    const ab = activeBattle();
    const up = S.players.filter((p) => p.hp > 0).length;
    const act = S.missions.filter((m) => m.status === 'active').length;
    const ts = $('tstate');
    ts.classList.toggle('is-live', !!ab);
    ts.innerHTML = ab
      ? `<span class="live">Live</span><b>${esc(ab.name)}</b><span>Round ${ab.round} · ${esc(ab.combatants[ab.turn]?.name || '')}’s turn</span><button class="btn sm" type="button" id="goLive">Open battle</button>`
      : `${plural(S.players.length, 'adventurer')} · ${up} standing · ${plural(act, 'active mission')} · ${plural(S.secrets.filter((s) => !s.revealed).length, 'secret')} kept`;
    if (ab) $('goLive').onclick = () => openSheet('battle', 'live');
    $('bCount').textContent = ab ? 'Live' : `${S.battles.length}`;
    $('bCount').classList.toggle('live', !!ab);
    $('mCount').textContent = `${act}`;
    {
      const mw = missionWarn();
      $('mCount').classList.toggle('warn', mw);
      $('mCount').title = mw ? 'A mission needs attention' : '';
    }
    $('nCount').textContent = `${S.notes.length + S.npcs.length + S.places.length}`;

    const party = $('party');
    party.innerHTML =
      S.players
        .map(
          (p) => `
    <div class="card${p.hp <= 0 ? ' down' : ''}${isHere(p) ? '' : ' away'}" data-pid="${p.id}" style="--h:${avHue(p)}">
      <div class="chead"><h3><button type="button" class="cname" aria-label="Open ${esc(p.name)}">${esc(p.name)}</button></h3><span class="ac">AC <b class="num">${esc(p.ac)}</b></span></div>
      <div class="cls">${esc(p.cls)} ${esc(p.level)}${p.player && p.player !== 'Example' ? ` · ${esc(p.player)}` : ''} · <span class="pp num" title="Passive Perception">PP ${esc(p.pp ?? 10)}</span> · <span class="pp num" title="Hit Dice ${hdText(p)}">HD ${hdLeft(p)}/${esc(p.level)}</span></div>
      <div class="hprow"><div class="bar"><i class="${hpClass(p.hp, p.maxHp)}" style="width:${pct(p.hp, p.maxHp)}%"></i></div><span class="v num"><b>${p.hp}</b> / ${p.maxHp}${+p.thp > 0 ? `<span class="tmpv">+${p.thp} temp</span>` : ''}</span></div>
      ${slotsHTML(p)}${resCardHTML(p)}
      <div class="cfoot">${isHere(p) ? '' : '<span class="pill mut">Away</span>'}${statusPills(p)}
        <span class="quick"><button type="button" class="insp${p.insp ? ' on' : ''}" data-insp="${p.id}" aria-pressed="${!!p.insp}" title="Heroic Inspiration">${p.insp ? '★' : '☆'}</button><button type="button" data-hp="-1" data-pid="${p.id}" aria-label="Lose 1 HP">−</button><button type="button" data-hp="1" data-pid="${p.id}" aria-label="Gain 1 HP">+</button></span></div>
    </div>`
        )
        .join('') + `<button class="add" type="button" id="addPlayer">+ Add player</button>`;
    party.querySelectorAll('.card').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('.quick,.slots')) return;
        if (e.target.closest('.hprow')) {
          hpPop(S.players.find((x) => x.id === el.dataset.pid));
          return;
        }
        openSheet('player', 'overview', el.dataset.pid);
      };
    });
    bindRes(party, (id) => S.players.find((x) => x.id === id), commit);
    party.querySelectorAll('[data-lvup]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          lvlPop(b.dataset.lvup);
        })
    );
    party.querySelectorAll('[data-pdsw]').forEach((w) => (w.onclick = (e) => e.stopPropagation()));
    party.querySelectorAll('[data-pds]').forEach(
      (d) =>
        (d.onclick = (e) => {
          e.stopPropagation();
          const p = S.players.find((x) => x.id === d.dataset.pds);
          if (!p) return;
          p.ds = dsOf(p.ds);
          const k = d.dataset.k,
            n = +d.dataset.n;
          p.ds[k] = p.ds[k] > n ? n : n + 1;
          if (p.ds.f >= 3) {
            p.dead = true;
            tlog(`${p.name} died.`, true);
          } else if (p.ds.s >= 3) {
            p.ds.f = 0;
            tlog(`${p.name} is stable.`, true);
          }
          commit();
        })
    );
    party.querySelectorAll('[data-pdsroll]').forEach(
      (d) =>
        (d.onclick = (e) => {
          e.stopPropagation();
          const p = S.players.find((x) => x.id === d.dataset.pdsroll);
          if (!p) return;
          pDeathSave(p);
          commit();
        })
    );
    party.querySelectorAll('[data-slot]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          toggleSlot(
            S.players.find((x) => x.id === b.dataset.slot),
            +b.dataset.lv,
            +b.dataset.k
          );
          commit();
        })
    );
    party.querySelectorAll('[data-insp]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          const p = S.players.find((x) => x.id === b.dataset.insp);
          p.insp = !p.insp;
          if (p.insp) tlog(`${p.name} earned Heroic Inspiration.`, true);
          commit();
        })
    );
    party.querySelectorAll('[data-hp]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          changeHp(
            S.players.find((x) => x.id === b.dataset.pid),
            +b.dataset.hp
          );
          commit();
        })
    );
    $('addPlayer').onclick = () => openSheet('player', 'overview', null);
    $('exampleNote').innerHTML = S.example
      ? '<span class="example-note">Showing example data. Add your own players, missions or notes to replace it. <button class="btn sm ghost" type="button" id="clearEx">Clear example data</button></span>'
      : '';
    $('clearEx') &&
      ($('clearEx').onclick = () => {
        pushUndo();
        clearExample();
        save();
        render();
        toast('Example data cleared. Ctrl+Z brings it back');
      });
  }

  /* ---------- sheet framework ---------- */
  let view = null; // {sec, sub, id}
  let pdraft = null,
    bdraft = null,
    bestFilter = '',
    bestCr = 'all',
    newCr = 'all';
  const SECTIONS = {
    battle: {
      title: 'Battles',
      eyebrow: 'Combat',
      subs: () => [
        ['live', 'Live battle', activeBattle() ? 'dot' : ''],
        ['new', 'New battle'],
        ['plans', 'Planned', S.plans.length || ''],
        ['map', 'Map'],
        ['bestiary', 'Bestiary', MONSTERS.length],
        ['homebrew', 'Homebrew', S.homebrew.length || ''],
        ['spells', 'Spells'],
        ['dice', 'Dice roller'],
        ['conditions', 'Conditions'],
        ['rules', 'Quick rules'],
        ['history', 'History', S.battles.filter((b) => !b.active).length],
      ],
    },
    mission: {
      title: 'Missions',
      eyebrow: 'Quests',
      subs: () => [
        ['active', 'Active', S.missions.filter((m) => m.status === 'active' || m.status === 'hold').length],
        ['new', 'New mission'],
        ['loot', 'Loot & rewards', S.loot.length],
        ['archive', 'Archive', S.missions.filter((m) => m.status === 'done' || m.status === 'failed').length],
        ['rumours', 'Rumours', (S.rumours || []).filter((r) => r.status === 'open').length || ''],
      ],
    },
    notes: {
      title: 'Notes',
      eyebrow: 'Campaign',
      subs: () => [
        ['sessions', 'Session log', S.notes.length],
        ['npcs', 'NPCs', S.npcs.length],
        ['places', 'Places', S.places.length],
        ['factions', 'Factions', (S.factions || []).length || ''],
        ['secrets', 'DM secrets', S.secrets.filter((s) => !s.revealed).length],
        ['handouts', 'Handouts', S.handouts.length || ''],
        ['sketch', 'Sketchpad', skCount()],
        ['timeline', 'Timeline', (S.timeline || []).length || ''],
        ['rulings', 'Rulings', (S.rulings || []).length || ''],
        ['gen', 'Generators'],
        ['search', 'Search'],
      ],
    },
    player: {
      title: 'Player',
      eyebrow: 'Party',
      subs: () => [
        ['overview', 'Overview'],
        ['abilities', 'Abilities'],
        ['res', 'Resources'],
        ['conditions', 'Conditions'],
        ['spells', 'Spell slots'],
        ['hooks', 'Hooks'],
        ['notes', 'Notes'],
      ],
    },
    session: {
      title: 'Session',
      eyebrow: 'Story',
      subs: () => [
        ['tonight', 'Tonight', S.tonight.started ? 'dot' : ''],
        ['scenes', 'Scenes', S.scenes.filter((s) => !s.done).length || ''],
        ['fronts', 'Fronts', S.fronts.filter(frontLive).length || ''],
        ['clocks', 'Clocks', S.clocks.length || ''],
        ['travel', 'Travel', activeJourney() ? 'dot' : ''],
        ['hooks', 'Character hooks'],
        ['wrap', 'Wrap up'],
      ],
    },
    campaign: {
      title: 'Campaign',
      eyebrow: 'Settings',
      subs: () => [
        ['details', 'Details'],
        ['calendar', 'Calendar'],
        ['data', 'Data'],
      ],
    },
  };
  let popNext = false;
  function openSheet(sec, sub, id) {
    if (!refOk && !refFailed && !REF_FREE[sec]) {
      withRef(() => openSheet(sec, sub, id)); // reference data loads on first use (see "reference data")
      return;
    }
    if (view && view.sec === 'player' && (sec !== 'player' || id !== view.id) && pDirty()) {
      leaveGuard(() => openSheet(sec, sub, id));
      return;
    }
    popNext = !view;
    if (sec === 'player') {
      const src = id ? S.players.find((x) => x.id === id) : null;
      pdraft = src
        ? JSON.parse(JSON.stringify(src))
        : {
            id: uid(),
            name: '',
            player: '',
            cls: 'Fighter',
            level: 1,
            maxHp: 10,
            hp: 10,
            ac: 10,
            ini: 0,
            pp: 10,
            exh: 0,
            conditions: [],
            notes: '',
          };
      pdraft._new = !src;
    }
    if (sec === 'battle' && !sub) sub = activeBattle() ? 'live' : 'new';
    EDIT = null;
    view = { sec, sub: sub || SECTIONS[sec].subs()[0][0], id };
    drawSheet(true);
  }
  function resetTemp() {
    bdraft = null;
    EDIT = null;
    mapSel = null;
    fxOpen = null;
    logAll = false;
    Object.keys(AT).forEach((k) => delete AT[k]);
    $('mcard') && $('mcard').remove();
    if (view) closeSheet();
  }
  function closeSheet() {
    view = null;
    $('overlay').innerHTML = '';
    render();
  }
  // the Player sheet edits a copy: has it changed since it was opened?
  function pDirty() {
    if (!view || view.sec !== 'player' || !pdraft) return false; // tabs fill in empty defaults as they open (slots, uses), so empty values don't count as a change
    const blank = (v) =>
      v == null ||
      v === '' ||
      (Array.isArray(v) && v.every((x) => x === 0 || x == null)) ||
      (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    const strip = (o) => {
      const c = JSON.parse(JSON.stringify(o || {}));
      delete c._new;
      delete c._hpT;
      Object.keys(c)
        .sort()
        .forEach((k) => {
          if (blank(c[k])) delete c[k];
        });
      return JSON.stringify(
        Object.keys(c)
          .sort()
          .map((k) => [k, c[k]])
      );
    };
    if (pdraft._new) return !!String(pdraft.name || '').trim();
    const was = S.players.find((x) => x.id === pdraft.id);
    return !!was && strip(was) !== strip(pdraft);
  }
  // Esc, ×, a click outside and the S, / and J keys come through here, so unsaved edits are never dropped silently
  function leaveGuard(go) {
    if (!pDirty()) {
      go();
      return;
    }
    const nm = pdraft.name || 'this character';
    const el = popup(
      'Unsaved changes',
      popHead(
        'Save your changes?',
        `You changed <strong>${esc(nm)}</strong> on the Player sheet. Save the changes, or throw them away.`
      ) +
        `<div class="row end"><button class="btn ghost" type="button" data-mclose id="lgStay">Keep editing</button><button class="btn" type="button" id="lgDrop">Discard</button><button class="btn pri" type="button" id="lgSave">Save changes</button></div>`
    );
    el.querySelector('#lgSave').focus();
    el.querySelector('#lgDrop').onclick = () => {
      el.remove();
      closeSheet();
      go();
    };
    el.querySelector('#lgSave').onclick = () => {
      el.remove();
      playerSave();
      go();
    };
  }
  function userClose() {
    leaveGuard(() => {
      if (view) closeSheet();
    });
  }
  // a focused field can fire change on blur while the sheet is being replaced; let it finish first and never redraw re-entrantly
  let drawing = false;
  // after a turn change, scroll the sheet just enough to show the creature whose turn it is
  let TURN_KEY = '',
    TURN_AT = 0;
  function followTurn(fresh) {
    const b = view && view.sec === 'battle' && view.sub === 'live' && activeBattle();
    if (!b) {
      TURN_KEY = '';
      return;
    }
    const c = b.combatants[b.turn],
      k = `${b.round}:${b.turn}:${c ? c.name : ''}`,
      t = performance.now();
    const changed = k !== TURN_KEY,
      recent = t - TURN_AT < 700;
    if (!fresh && !changed && !recent) return;
    const smooth = !!TURN_KEY && !fresh;
    if (changed) {
      TURN_KEY = k;
      TURN_AT = t;
    }
    const r = $('overlay').querySelector('.turns>.cb.cur');
    if (!r) return;
    const ov = r.closest('.ov'),
      o = ov.getBoundingClientRect(),
      q = r.getBoundingClientRect(),
      bar = ov.querySelector('.rbar');
    // the round bar is sticky, so the row has to clear its bottom edge, not the top of the sheet
    const top = (bar ? Math.max(o.top, bar.getBoundingClientRect().bottom) : o.top) + 8,
      bot = Math.min(o.bottom, innerHeight) - 16;
    const d = q.top < top ? q.top - top : q.bottom > bot ? Math.min(q.bottom - bot, q.top - top) : 0;
    if (d)
      ov.scrollBy({
        top: d,
        behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
      });
  }
  function drawSheet(fresh) {
    if (drawing || !view) return;
    drawing = true;
    try {
      const ae = document.activeElement;
      if (ae && $('overlay').contains(ae) && ae.onchange) ae.blur();
      if (view) drawSheetNow(fresh);
    } finally {
      drawing = false;
    }
  }
  function drawSheetNow(fresh) {
    const sec = SECTIONS[view.sec];
    const ovEl = $('overlay');
    const keep = !fresh && ovEl.querySelector('.ov') ? ovEl.querySelector('.ov').scrollTop : 0;
    const pk = !fresh && ovEl.querySelector('.picker') ? ovEl.querySelector('.picker').scrollTop : 0;
    const title = view.sec === 'player' ? pdraft.name || 'New player' : sec.title;
    const body = VIEWS[view.sec][view.sub]();
    ovEl.innerHTML = `<div class="ov" id="ovBg"><div class="sheet${popNext ? ' pop' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <nav class="side" aria-label="${esc(title)} menu"><div class="eyebrow">${esc(sec.eyebrow)}</div><h2>${esc(title)}</h2>
      <div role="tablist" aria-label="${esc(title)} sections" style="display:contents">${sec
        .subs()
        .map(
          ([k, l, c]) =>
            `<button class="tab" role="tab" type="button" data-sub="${k}" aria-selected="${k === view.sub}"><span>${esc(l)}</span>${c === 'dot' ? '<span class="dot" aria-label="live"></span>' : c !== undefined && c !== '' ? `<span class="count num">${c}</span>` : ''}</button>`
        )
        .join('')}
    </div></nav>
    <div class="main">${body.html}</div></div></div>`;
    popNext = false;
    ovEl.querySelector('.ov').scrollTop = keep;
    if (pk && ovEl.querySelector('.picker')) ovEl.querySelector('.picker').scrollTop = pk;
    ovEl.querySelectorAll('[data-sub]').forEach(
      (b) =>
        (b.onclick = () => {
          view.sub = b.dataset.sub;
          EDIT = null;
          drawSheet(true);
        })
    );
    ovEl.querySelectorAll('[data-close]').forEach((b) => (b.onclick = b.id === 'pCancel' ? closeSheet : userClose));
    $('ovBg').onclick = (e) => {
      if (e.target.id === 'ovBg') userClose();
    };
    body.bind && body.bind();
    followTurn(fresh);
    if (bdraft) draftSync();
    if (fresh) {
      const t = ovEl.querySelector('.tab[aria-selected="true"]');
      t && t.focus({ preventScroll: true });
    }
  }
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable]');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
      return;
    }
    if (e.key === 'Escape') {
      const mc = $('mcard');
      if (mc) {
        mc.remove();
        return;
      }
      if (view) userClose();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || $('mcard')) return;
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      openJot();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      openSheet('notes', 'search');
      return;
    }
    if ((e.key === 's' || e.key === 'S') && !(view && view.sec === 'notes' && view.sub === 'sketch')) {
      e.preventDefault();
      openSheet('notes', 'sketch');
      return;
    }
    const b = activeBattle();
    if (view && view.sec === 'battle' && view.sub === 'live' && b) {
      if (e.key === 'n') {
        e.preventDefault();
        nextTurn(b);
      } else if (e.key === 'p') {
        e.preventDefault();
        $('prevTurn') && $('prevTurn').click();
      } else if (e.key === 'd') {
        e.preventDefault();
        openDice();
      }
    } else if (!view && e.key === 'd') {
      e.preventDefault();
      openDice();
    }
  });
  const head = (h, p) =>
    `<div class="mhead"><div><h3>${h}</h3>${p ? `<p>${p}</p>` : ''}</div><button class="x" type="button" data-close aria-label="Close">×</button></div>`;
  function armDelete(btn, fn, label = 'Confirm delete') {
    let armed = false;
    btn.onclick = () => {
      if (!armed) {
        armed = true;
        btn.textContent = label;
        btn.classList.add('danger');
        return;
      }
      fn();
    };
  }

  /* ---------- views ---------- */
  const VIEWS = { battle: {}, mission: {}, notes: {}, player: {}, campaign: {}, session: {} };

  /* Battles */
  VIEWS.battle.live = () => {
    const b = activeBattle();
    if (!b)
      return {
        html:
          head('Live battle', 'Run initiative, track hit points and conditions, and log every hit.') +
          `<div class="empty">No battle running. <button class="btn sm pri" type="button" id="goNew">Set up a battle</button></div>`,
        bind: () => {
          $('goNew').onclick = () => {
            view.sub = 'new';
            drawSheet(true);
          };
        },
      };
    const rows = b.combatants
      .map((c, i) => {
        if (c.lair) return lairRow(b, c, i);
        const h = cbState(c);
        const pcDown = c.pid && h.hp <= 0;
        return `
    <div class="cb ${c.pid ? 'pc' : ''} ${i === b.turn ? 'cur' : ''} ${(h.hp <= 0 || c.fled) && !c.pid ? 'down' : ''}">
      <div class="ini" title="Initiative">${c.init}</div>
      <div class="who">${c.base ? monLink(c.base, c.name) : `<strong>${esc(c.name)}</strong>`}${!c.pid && c.base ? mnLine(c.base) : ''}
        <div class="tags">${c.hidden && !c.pid ? `<button class="pill hid" type="button" data-hide="${i}" title="The players can’t see it. Click to reveal">Hidden · reveal</button>` : ''}${c.ally ? '<span class="pill ok">Ally</span>' : ''}${c.fled ? '<span class="pill dn">Fled</span>' : ''}${!c.pid && h.hp > 0 && !c.fled ? `<button class="atkbtn" type="button" data-atk="${i}" title="Roll an attack against a player">Roll attack</button>` : ''}<span class="pill mut num">AC ${h.ac}</span>${+h.thp > 0 ? `<span class="pill tmp num">+${h.thp} temp</span>` : ''}${(c.fx || []).map((x, k) => `<span class="pill fx" role="button" tabindex="0" data-rmfx="${i}" data-k="${k}" title="Remove ${esc(x.name)}">${esc(x.name)} · ${x.rounds} rd ×</span>`).join('')}${Object.keys(
          c.spent || {}
        )
          .map(
            (n) =>
              `<span class="pill dn" title="Used. Rolls to recharge at the start of its turn">${esc(n.replace(/\s*\(Recharge[^)]*\)/, ''))} spent</span>`
          )
          .join(
            ''
          )}${h.cond.map((k) => `<span class="pill cd" role="button" tabindex="0" data-rmc="${i}" data-c="${esc(k)}" title="Remove ${esc(k)}">${esc(k)} ×</span>`).join('')}
          ${!c.pid ? `<button class="mini" type="button" data-ally="${i}" aria-pressed="${!!c.ally}" title="${c.ally ? 'Make it an enemy again' : 'Fights on the party’s side: no XP, no morale'}">${c.ally ? 'Not an ally' : '+ ally'}</button>` : ''}${!c.pid && !c.hidden ? `<button class="mini" type="button" data-hide="${i}" title="Mark it hidden from the players, for a lurker or an ambush">+ hide</button>` : ''}${!c.pid ? (c.leg ? legHTML(c, i) : `<button class="mini" type="button" data-leg="${i}" title="Track legendary actions and legendary resistances">+ legendary</button>`) : ''}<select data-addc="${i}" aria-label="Add condition to ${esc(c.name)}"><option value="">+ condition</option>${CONDITIONS.filter(
            (k) => !h.cond.includes(k)
          )
            .map(
              (k) =>
                `<option value="${k}">${k}${!c.pid && monNote(c.base) && monNote(c.base).cimm.includes(k) ? ' (immune)' : ''}</option>`
            )
            .join('')}</select><button class="mini" type="button" data-fxo="${i}">+ effect</button></div>
        ${fxOpen === c.id ? `<div class="fxform"><input type="text" id="fxName" placeholder="Bless, Hold Person…" aria-label="Effect name"><input type="number" id="fxR" min="1" max="100" value="10" aria-label="Rounds"><span class="kbd">rounds</span><button class="btn sm" type="button" id="fxAdd" data-i="${i}">Add</button></div>` : ''}
        ${pcDown && S.dm.injuries ? `<button class="mini" type="button" data-inj="${i}" title="Roll on the lingering injury table">Roll injury</button>` : ''}${pcDown && !cbTarget(c).dead && (c.ds?.s || 0) < 3 && (c.ds?.f || 0) < 3 ? `<button class="mini" type="button" data-dsroll="${i}" title="d20: 10 or higher succeeds, 1 counts twice, 20 regains 1 HP">Roll death save</button>` : ''}${pcDown && cbTarget(c).dead ? `<div class="deadrow"><span class="pill dn">Dead</span><button class="mini" type="button" data-revive="${c.pid}" title="Revivify, Raise Dead and similar magic: back with 1 HP">Revive</button></div>` : ''}${pcDown && !cbTarget(c).dead ? `<div class="ds">Death saves <span class="s">${[0, 1, 2].map((n) => `<button type="button" class="${(c.ds?.s || 0) > n ? 'on' : ''}" data-ds="${i}" data-k="s" data-n="${n}" aria-label="Success ${n + 1}"></button>`).join(' ')}</span><span class="f">${[0, 1, 2].map((n) => `<button type="button" class="${(c.ds?.f || 0) > n ? 'on' : ''}" data-ds="${i}" data-k="f" data-n="${n}" aria-label="Failure ${n + 1}"></button>`).join(' ')}</span></div>` : ''}
      </div>
      <div class="hprow hpcell"><div class="bar"><i class="${hpClass(h.hp, h.max)}" style="width:${pct(h.hp, h.max)}%"></i></div><span class="v num"><b>${h.hp}</b> / ${h.max}</span></div>
      <div class="act"><input type="number" min="0" id="amt${i}" aria-label="Amount for ${esc(c.name)}" placeholder="0">${c.pid ? '' : dtySel(b, i, c)}
        <button class="btn sm" type="button" data-dmg="${i}">Hit</button><button class="btn sm ghost" type="button" data-dmg="${i}" data-mul="0.5" title="Resisted: half damage, rounded down" aria-label="Half damage to ${esc(c.name)}">½</button><button class="btn sm ghost" type="button" data-dmg="${i}" data-mul="2" title="Vulnerable: double damage" aria-label="Double damage to ${esc(c.name)}">×2</button><button class="btn sm" type="button" data-heal="${i}">Heal</button><button class="btn sm ghost" type="button" data-thp="${i}" title="Set temporary HP to this amount">Temp</button><button class="rmb" type="button" data-rmcb="${i}" aria-label="Remove ${esc(c.name)} from battle" title="Remove from battle">×</button></div>
    </div>`;
      })
      .join('');
    return {
      html:
        head(esc(b.name), `Session ${esc(b.session || S.dm.session)} · started ${esc(b.date)}`) +
        `
    <div class="rbar"><div class="r">Round <em class="num">${b.round}</em> · ${esc(b.combatants[b.turn]?.name || '')} <span class="ttimer num" id="tTimer" title="Time spent on this turn">${turnClock(b)}</span></div>
      <div class="row"><button class="btn sm ghost" type="button" id="liveUndo" title="Undo (Ctrl+Z)">Undo</button><button class="btn sm ghost" type="button" id="liveDice">Dice</button><button class="btn sm ghost" type="button" id="delayTurn" title="Move this creature after the next one">Delay</button><button class="btn sm" type="button" id="prevTurn">Previous</button><button class="btn pri" type="button" id="nextTurn">Next turn</button></div></div>
    ${stakesHTML(b)}${diffHTML(b)}${b.morDue ? `<div class="morale"><span><b>Morale check</b> · ${esc(b.morWhy || 'the monsters are losing')}. Each monster still standing rolls a d20.</span><label class="row">DC <input type="number" id="morDC" min="1" max="30" value="${b.morDC || 10}" style="width:64px" aria-label="Morale DC"></label><button class="btn sm" type="button" id="morRoll">Roll morale</button><button class="btn sm ghost" type="button" id="morSkip">Skip</button></div>` : ''}
    <div class="turns">${rows}</div>
    <div class="kbd">Shortcuts: <kbd>N</kbd> next turn · <kbd>P</kbd> previous · <kbd>D</kbd> dice · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo. Effects count down at the start of that creature’s turn.</div>
    <div class="box"><h4>Add to battle</h4>
      <div class="row" style="flex-wrap:wrap"><input type="text" list="monList" id="addMon" placeholder="Monster name, e.g. Goblin Warrior" style="flex:1;min-width:180px" aria-label="Monster to add"><input type="number" id="addMonN" min="1" max="20" value="1" style="width:70px" aria-label="How many"><button class="btn" type="button" id="addMonBtn">Add monster</button></div>
      ${
        S.players.filter((p) => !b.combatants.some((c) => c.pid === p.id)).length
          ? `<div class="row" style="flex-wrap:wrap"><select id="addPc" style="flex:1;min-width:160px" aria-label="Player to add">${S.players
              .filter((p) => !b.combatants.some((c) => c.pid === p.id))
              .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
              .join(
                ''
              )}</select><input type="number" id="addPcInit" placeholder="Initiative" style="width:110px" aria-label="Their initiative"><button class="btn" type="button" id="addPcBtn">Add player</button></div>`
          : ''
      }
      <div class="row" style="flex-wrap:wrap"><input type="text" id="addLair" placeholder="Lair action, trap or hazard" style="flex:1;min-width:160px" aria-label="Lair action or hazard"><input type="number" id="addLairInit" value="20" style="width:80px" aria-label="Initiative count"><button class="btn" type="button" id="addLairBtn">Add entry</button></div>
      </div>
    ${aoeHTML(b)}
    <div class="box"><h4>Battle log</h4><div class="log">${(logAll ? b.log : b.log.slice(-60))
      .slice()
      .reverse()
      .map((l) => `<div>${esc(l)}</div>`)
      .join(
        ''
      )}</div>${b.log.length > 60 ? `<div class="row"><button class="btn sm ghost" type="button" id="logAll">${logAll ? 'Show recent only' : `Show all ${b.log.length} entries`}</button></div>` : ''}</div>
    <div class="box"><h4>End battle</h4><div class="row">
      <button class="btn pri" type="button" data-end="Victory">Victory</button><button class="btn" type="button" data-end="Retreat">Retreat</button><button class="btn danger" type="button" data-end="Defeat">Defeat</button></div></div>`,
      bind: () => {
        const ov = $('overlay');
        ov.querySelectorAll('[data-dmg],[data-heal]').forEach(
          (btn) =>
            (btn.onclick = () => {
              const i = +(btn.dataset.dmg ?? btn.dataset.heal),
                heal = btn.dataset.heal != null,
                raw = Math.max(0, +$('amt' + i).value || 0);
              if (!raw) return;
              let n = Math.floor(raw * (+btn.dataset.mul || 1));
              const c = b.combatants[i];
              const tsel = ov.querySelector(`[data-dty="${i}"]`),
                ty = heal || !tsel ? '' : tsel.value;
              let mod = null;
              // the ½ and ×2 buttons are the DM's own call, so the notes only apply to a plain Hit
              if (ty) {
                DTY = { k: dtyKey(b), ty };
                if (!btn.dataset.mul) {
                  mod = dmgMod(b, c, ty, n);
                  n = mod.n;
                  if (mod.k) {
                    b.log.push(mod.line);
                    toast(mod.line.replace(/^R\d+: /, ''));
                  }
                }
              }
              if (!n) {
                if (mod && mod.k) {
                  commit();
                  return;
                }
                toast('Halved to 0 damage');
                return;
              }
              let line = hurt(b, c, heal ? n : -n, false);
              if (ty) line = line.replace(' damage', ` ${ty.toLowerCase()} damage`);
              b.log.push(line);
              commit();
            })
        );
        ov.querySelectorAll('[data-addc]').forEach(
          (s) =>
            (s.onchange = () => {
              if (!s.value) return;
              const c = b.combatants[+s.dataset.addc];
              if (!c.pid && monNote(c.base) && monNote(c.base).cimm.includes(s.value))
                toast(`Your notes say ${c.base} can’t be ${s.value.toLowerCase()}. Added anyway`);
              const t = cbTarget(c);
              t.conditions = [...(t.conditions || []), s.value];
              b.log.push(`R${b.round}: ${c.name} is ${s.value.toLowerCase()}.`);
              if (INCAP.includes(s.value) && t.conditions.includes('Concentrating')) {
                t.conditions = t.conditions.filter((k) => k !== 'Concentrating');
                b.log.push(`R${b.round}: ${c.name} loses Concentration.`);
              }
              commit();
            })
        );
        ov.querySelectorAll('[data-rmc]').forEach((p) => {
          const fn = () => {
            const c = b.combatants[+p.dataset.rmc];
            const t = cbTarget(c);
            t.conditions = (t.conditions || []).filter((k) => k !== p.dataset.c);
            commit();
          };
          p.onclick = fn;
          p.onkeydown = (e) => {
            if (e.key === 'Enter') fn();
          };
        });
        ov.querySelectorAll('[data-leg]').forEach(
          (x) =>
            (x.onclick = () => {
              b.combatants[+x.dataset.leg].leg = { a: 3, au: 0, r: 3, ru: 0 };
              commit();
            })
        );
        ov.querySelectorAll('[data-legoff]').forEach(
          (x) =>
            (x.onclick = () => {
              delete b.combatants[+x.dataset.legoff].leg;
              commit();
            })
        );
        ov.querySelectorAll('[data-lg]').forEach(
          (x) =>
            (x.onclick = () => {
              const c = b.combatants[+x.dataset.lg],
                k = x.dataset.k,
                n = +x.dataset.n;
              if (!c.leg) return;
              const was = c.leg[k];
              c.leg[k] = was > n ? n : n + 1;
              if (c.leg[k] > was)
                b.log.push(
                  `R${b.round}: ${c.name} uses a legendary ${k === 'au' ? 'action' : 'resistance'} (${c.leg[k]} of ${k === 'au' ? c.leg.a : c.leg.r}).`
                );
              commit();
            })
        );
        ov.querySelectorAll('[data-inj]').forEach(
          (x) =>
            (x.onclick = () => {
              const c = b.combatants[+x.dataset.inj],
                p = S.players.find((q) => q.id === c.pid);
              if (!p) return;
              const r = rollInjury(p);
              b.log.push(`R${b.round}: ${c.name} rolls ${r.r} for a lingering injury: ${r.name}.`);
              commit();
              toast(`${p.name}: ${r.name}. ${r.fx}`);
            })
        );
        ov.querySelectorAll('[data-dsroll]').forEach(
          (x) =>
            (x.onclick = () => {
              const c = b.combatants[+x.dataset.dsroll];
              b.log.push(deathSave(b, c));
              commit();
            })
        );
        ov.querySelectorAll('[data-ds]').forEach(
          (d) =>
            (d.onclick = () => {
              const c = b.combatants[+d.dataset.ds];
              c.ds = c.ds || { s: 0, f: 0 };
              const k = d.dataset.k,
                n = +d.dataset.n;
              c.ds[k] = c.ds[k] > n ? n : n + 1;
              {
                const pl = S.players.find((q) => q.id === c.pid);
                if (pl) pl.dead = c.ds.f >= 3;
              }
              if (c.ds.s >= 3 && c.ds.f < 3) {
                c.ds.f = 0;
                b.log.push(`R${b.round}: ${c.name} is stable.`);
              }
              if (c.ds.f >= 3) b.log.push(`R${b.round}: ${c.name} has died.`);
              commit();
            })
        );
        ov.querySelectorAll('input[id^="amt"]').forEach(
          (inp) =>
            (inp.onkeydown = (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const h = ov.querySelector(`[data-dmg="${inp.id.slice(3)}"]:not([data-mul])`);
                h && h.click();
              }
            })
        );
        ov.querySelectorAll('[data-dty]').forEach(
          (x) =>
            (x.onchange = () => {
              DTY = { k: dtyKey(b), ty: x.value };
              ov.querySelectorAll('[data-dty]').forEach((y) => {
                if (y !== x && [...y.options].some((o) => o.value === x.value)) y.value = x.value;
              });
            })
        );
        $('liveDice').onclick = openDice;
        $('liveUndo').onclick = undo;
        bindAoe(b);
        $('logAll') &&
          ($('logAll').onclick = () => {
            logAll = !logAll;
            drawSheet();
          });
        ov.querySelectorAll('[data-thp]').forEach(
          (btn) =>
            (btn.onclick = () => {
              const i = +btn.dataset.thp,
                n = Math.max(0, +$('amt' + i).value || 0);
              const t = cbTarget(b.combatants[i]);
              t.thp = n;
              b.log.push(`R${b.round}: ${b.combatants[i].name} has ${n} temporary HP.`);
              commit();
            })
        );
        ov.querySelectorAll('[data-rmcb]').forEach((btn) =>
          armDelete(
            btn,
            () => {
              const i = +btn.dataset.rmcb;
              const c = b.combatants[i];
              const foe = c && !c.pid && !c.lair && !c.ally;
              if (foe && c.hp > 0 && !c.fled) {
                const el = popup(
                  'Remove',
                  popHead(`Remove ${c.name}`, 'Does it count as defeated for XP?') +
                    `<div class="row end"><button class="btn" type="button" id="rmNo">Remove, no XP</button><button class="btn pri" type="button" id="rmYes">Defeated, counts for XP</button></div>`
                );
                el.querySelector('#rmYes').onclick = () => {
                  el.remove();
                  rmCb(b, i, true);
                };
                el.querySelector('#rmNo').onclick = () => {
                  el.remove();
                  rmCb(b, i, false);
                };
                el.querySelector('#rmYes').focus();
                return;
              }
              rmCb(b, i, foe);
            },
            '✓'
          )
        );
        ov.querySelectorAll('[data-hide]').forEach(
          (x) =>
            (x.onclick = () => {
              const c = b.combatants[+x.dataset.hide];
              c.hidden = !c.hidden;
              if (!c.hidden) b.log.push(`R${b.round}: ${c.name} is revealed.`);
              toast(c.hidden ? `${c.name} is hidden until you reveal it` : `${c.name} is revealed to the players`);
              commit();
            })
        );
        ov.querySelectorAll('[data-ally]').forEach(
          (x) =>
            (x.onclick = () => {
              const c = b.combatants[+x.dataset.ally];
              c.ally = !c.ally;
              b.log.push(`R${b.round}: ${c.name} ${c.ally ? 'fights on the party’s side' : 'is an enemy again'}.`);
              commit();
            })
        );
        ov.querySelectorAll('[data-revive]').forEach(
          (x) => (x.onclick = () => revive(S.players.find((p) => p.id === x.dataset.revive)))
        );
        ov.querySelectorAll('[data-fxo]').forEach(
          (btn) =>
            (btn.onclick = () => {
              const id = b.combatants[+btn.dataset.fxo].id;
              fxOpen = fxOpen === id ? null : id;
              drawSheet();
              $('fxName') && $('fxName').focus();
            })
        );
        $('fxAdd') &&
          (() => {
            const go = () => {
              const nm = val('fxName');
              if (!nm) {
                toast('Name the effect');
                return;
              }
              const c = b.combatants[+$('fxAdd').dataset.i];
              c.fx = [...(c.fx || []), { name: nm, rounds: clamp(+val('fxR') || 1, 1, 100) }];
              fxOpen = null;
              b.log.push(`R${b.round}: ${c.name} gains ${nm}.`);
              commit();
            };
            $('fxAdd').onclick = go;
            $('fxName').onkeydown = (e) => {
              if (e.key === 'Enter') go();
            };
          })();
        ov.querySelectorAll('[data-rmfx]').forEach((p) => {
          const fn = () => {
            const c = b.combatants[+p.dataset.rmfx];
            c.fx.splice(+p.dataset.k, 1);
            commit();
          };
          p.onclick = fn;
          p.onkeydown = (e) => {
            if (e.key === 'Enter') fn();
          };
        });
        $('addMonBtn').onclick = () => {
          const m =
            MON_BY_NAME.get(val('addMon')) || MONSTERS.find((x) => x.n.toLowerCase() === val('addMon').toLowerCase());
          if (!m) {
            toast('Pick a monster from the list');
            return;
          }
          const n = clamp(+val('addMonN') || 1, 1, 20);
          const cur = b.combatants[b.turn];
          let k = Math.max(
            0,
            ...b.combatants.filter((c) => c.base === m.n).map((c) => +(c.name.match(/ (\d+)$/) || [0, 1])[1])
          );
          for (let j = 0; j < n; j++) {
            k++;
            const roll = d20();
            b.combatants.push({
              id: uid(),
              base: m.n,
              name: k > 1 || n > 1 ? `${m.n} ${k}` : m.n,
              maxHp: m.hp,
              hp: m.hp,
              ac: m.ac,
              ini: m.ini,
              xp: m.xp || 0,
              conditions: [],
              init: roll + (+m.ini || 0),
            });
          }
          sortCombat(b, cur);
          b.log.push(`R${b.round}: ${n > 1 ? `${n} × ${m.n}` : m.n} joined the battle.`);
          commit();
        };
        $('addMon').onkeydown = (e) => {
          if (e.key === 'Enter') $('addMonBtn').click();
        };
        $('addLairBtn').onclick = () => {
          const n = val('addLair');
          if (!n) {
            toast('Name the lair action or hazard');
            return;
          }
          const at = val('addLairInit') === '' ? 20 : +val('addLairInit');
          const cur = b.combatants[b.turn];
          b.combatants.push({ id: uid(), lair: true, name: n, init: at, ini: -99 });
          sortCombat(b, cur);
          b.log.push(`R${b.round}: ${n} added at initiative ${at}.`);
          commit();
        };
        $('addPcBtn') &&
          ($('addPcBtn').onclick = () => {
            const p = S.players.find((x) => x.id === val('addPc'));
            if (!p) return;
            if (val('addPcInit') === '') {
              toast('Type their initiative first');
              $('addPcInit').focus();
              return;
            }
            const cur = b.combatants[b.turn];
            b.combatants.push({
              id: uid(),
              pid: p.id,
              name: p.name,
              ini: +p.ini || 0,
              init: +val('addPcInit'),
              ds: dsSeed(p),
            });
            sortCombat(b, cur);
            b.log.push(`R${b.round}: ${p.name} joined the battle.`);
            commit();
          });
        ov.querySelectorAll('[data-atk]').forEach((btn) => (btn.onclick = () => openAttack(b, +btn.dataset.atk)));
        $('nextTurn').onclick = () => nextTurn(b);
        $('morDC') &&
          ($('morDC').onchange = (e) => {
            b.morDC = clamp(Math.round(+e.target.value || 10), 1, 30);
          });
        $('morSkip') &&
          ($('morSkip').onclick = () => {
            b.morDue = false;
            b.log.push(`R${b.round}: Morale check skipped.`);
            commit();
          });
        $('morRoll') && ($('morRoll').onclick = () => rollMorale(b));
        $('delayTurn').onclick = () => {
          const t = b.turn;
          if (t >= b.combatants.length - 1) {
            toast('Already last this round');
            return;
          }
          const c = b.combatants[t],
            n = b.combatants[t + 1];
          b.combatants[t] = n;
          b.combatants[t + 1] = c;
          c.init = n.init;
          c.ini = (+n.ini || 0) - 0.01;
          c.delayed = true;
          b.log.push(`R${b.round}: ${c.name} delays until after ${n.name}.`);
          startTurn(b, n);
          commit();
        };
        $('prevTurn').onclick = () => {
          let t = b.turn - 1;
          if (t < 0) {
            if (b.round > 1) {
              b.round--;
              t = b.combatants.length - 1;
            } else t = 0;
          }
          b.turn = t;
          commit();
        };
        ov.querySelectorAll('[data-end]').forEach(
          (btn) =>
            (btn.onclick = () => {
              b.active = false;
              b.outcome = btn.dataset.end;
              advance(Math.max(1, Math.ceil((b.round * 6) / 60)));
              b.xp =
                b.combatants
                  .filter((c) => !c.pid && !c.lair && !c.ally && (c.hp <= 0 || c.fled))
                  .reduce((s, c) => s + (+c.xp || 0), 0) + (b.gone || []).reduce((s, g) => s + (+g.xp || 0), 0);
              b.morDue = false;
              const pcs = b.combatants
                .filter((c) => c.pid)
                .map((c) => S.players.find((p) => p.id === c.pid))
                .filter(isHere);
              const share = b.outcome === 'Victory' && pcs.length ? Math.floor(b.xp / pcs.length) : 0;
              if (share) pcs.forEach((p) => (p.xp = (+p.xp || 0) + share));
              b.log.push(
                `Battle ended: ${b.outcome}.${b.xp ? ` ${b.xp} XP from defeated foes${share ? `, ${share} each` : ''}.` : ''}`
              );
              if (b.outcome === 'Victory' || b.outcome === 'Retreat') {
                AFTER = b.id;
                AF = {};
                view.sub = 'after';
              } else view.sub = 'history';
              commit();
              toast(`${b.outcome}${share ? ` · ${share} XP each` : b.xp ? ` · ${b.xp} XP` : ''}`);
            })
        );
      },
    };
  };
  const AOE = { open: false, dmg: '', name: '', mode: 'half', dc: '', bon: '', pick: {}, sv: {} };
  function aoeHTML(b) {
    const live = b.combatants.filter((c) => !c.lair && (c.pid || (cbState(c).hp > 0 && !c.fled)));
    if (!AOE.open)
      return `<div class="box"><div class="row between"><h4 style="margin:0">Area damage</h4><button class="btn sm" type="button" id="aoeOpen">Fireball, breath weapon…</button></div></div>`;
    const sv = (c) => AOE.sv[c.id] || (c.pid ? 'fail' : 'roll');
    return `<div class="box aoe"><div class="row between"><h4 style="margin:0">Area damage</h4><button class="btn sm ghost" type="button" id="aoeClose">Close</button></div>
    <div class="row" style="flex-wrap:wrap"><input type="text" id="aoeName" placeholder="Fireball" value="${esc(AOE.name)}" style="flex:1;min-width:110px" aria-label="Effect name"><input type="text" id="aoeDmg" placeholder="8d6 or 28" value="${esc(AOE.dmg)}" style="width:110px" aria-label="Damage, dice or a number"><select id="aoeTy" style="width:auto" aria-label="Damage type" title="Damage type, optional. Your monster notes decide resisted, immune or vulnerable">${['', ...DMG_TYPES].map((t) => `<option value="${t}"${(AOE.ty || '') === t ? ' selected' : ''}>${t || 'Damage type'}</option>`).join('')}</select>
      <select id="aoeMode" style="width:auto" aria-label="Saving throw"><option value="half"${AOE.mode === 'half' ? ' selected' : ''}>Save for half</option><option value="none"${AOE.mode === 'none' ? ' selected' : ''}>Save for none</option><option value="nosave"${AOE.mode === 'nosave' ? ' selected' : ''}>No save</option></select>
      ${AOE.mode === 'nosave' ? '' : `<input type="number" id="aoeDC" placeholder="DC" value="${esc(AOE.dc)}" style="width:70px" aria-label="Save DC"><input type="number" id="aoeBon" placeholder="Monster bonus" value="${esc(AOE.bon)}" style="width:120px" aria-label="Monster save bonus" title="Added to each monster's d20 when it rolls">`}</div>
    <div class="list">${live
      .map(
        (
          c
        ) => `<div class="eg"><label class="pn" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" data-aoet="${c.id}"${AOE.pick[c.id] ? ' checked' : ''}><strong>${esc(c.name)}</strong></label>
      ${
        AOE.mode === 'nosave'
          ? ''
          : `<select data-aoes="${c.id}" style="width:auto" aria-label="Save for ${esc(c.name)}">${(c.pid
              ? [
                  ['fail', 'Failed'],
                  ['made', 'Made'],
                ]
              : [
                  ['roll', 'Roll'],
                  ['fail', 'Failed'],
                  ['made', 'Made'],
                ]
            )
              .map(([k, l]) => `<option value="${k}"${sv(c) === k ? ' selected' : ''}>${l}</option>`)
              .join('')}</select>`
      }</div>`
      )
      .join('')}</div>
    <div class="row end"><button class="btn pri" type="button" id="aoeGo">Roll and apply</button></div></div>`;
  }
  function bindAoe(b) {
    const ov = $('overlay'),
      q = (s) => ov.querySelector(s);
    q('#aoeOpen') &&
      (q('#aoeOpen').onclick = () => {
        AOE.open = true;
        AOE.pick = {};
        AOE.sv = {};
        drawSheet();
        q('#aoeName') && $('aoeName').focus();
      });
    if (!q('#aoeGo')) return;
    q('#aoeClose').onclick = () => {
      AOE.open = false;
      drawSheet();
    };
    q('#aoeName').oninput = (e) => (AOE.name = e.target.value);
    q('#aoeTy') && (q('#aoeTy').onchange = (e) => (AOE.ty = e.target.value));
    q('#aoeDmg').oninput = (e) => (AOE.dmg = e.target.value);
    q('#aoeMode').onchange = (e) => {
      AOE.mode = e.target.value;
      drawSheet();
    };
    q('#aoeDC') && (q('#aoeDC').oninput = (e) => (AOE.dc = e.target.value));
    q('#aoeBon') && (q('#aoeBon').oninput = (e) => (AOE.bon = e.target.value));
    ov.querySelectorAll('[data-aoet]').forEach((x) => (x.onchange = () => (AOE.pick[x.dataset.aoet] = x.checked)));
    ov.querySelectorAll('[data-aoes]').forEach((x) => (x.onchange = () => (AOE.sv[x.dataset.aoes] = x.value)));
    q('#aoeGo').onclick = () => {
      const ts = b.combatants.filter((c) => AOE.pick[c.id] && !c.lair);
      if (!ts.length) {
        toast('Tick who is caught in it');
        return;
      }
      const raw = AOE.dmg.trim(),
        r = /^\d+$/.test(raw) ? { total: +raw, parts: raw } : rollExpr(raw);
      if (!r) {
        toast('Damage should be dice like 8d6, or a number');
        return;
      }
      const dmg = Math.max(0, r.total),
        saves = AOE.mode !== 'nosave',
        dc = +AOE.dc || 0,
        bon = +AOE.bon || 0;
      if (saves && !dc && ts.some((c) => (AOE.sv[c.id] || (c.pid ? 'fail' : 'roll')) === 'roll')) {
        toast('Enter the save DC so monsters can roll');
        return;
      }
      const nm = AOE.name.trim() || 'Area effect';
      b.log.push(
        `R${b.round}: ${nm} deals ${dmg}${AOE.ty ? ' ' + AOE.ty.toLowerCase() : ''} (${r.parts})${saves ? `, DC ${dc} save for ${AOE.mode === 'half' ? 'half' : 'none'}` : ''}.`
      );
      const K = {};
      ts.forEach((c) => {
        let made = false,
          note = '';
        if (saves) {
          const s = AOE.sv[c.id] || (c.pid ? 'fail' : 'roll');
          if (s === 'roll') {
            const d = rnd(20);
            made = d + bon >= dc;
            note = ` (save ${d}${sgn(bon)} = ${d + bon})`;
          } else made = s === 'made';
        }
        let n = !saves || !made ? dmg : AOE.mode === 'half' ? Math.floor(dmg / 2) : 0;
        const mod = n && AOE.ty ? dmgMod(b, c, AOE.ty, n) : null;
        if (mod && mod.k) {
          b.log.push(mod.line);
          n = mod.n;
          K[mod.k] = (K[mod.k] || 0) + 1;
        }
        b.log.push(
          n
            ? hurt(b, c, -n, false).replace(' damage', `${AOE.ty ? ' ' + AOE.ty.toLowerCase() : ''} damage${note}`)
            : mod && mod.k
              ? `R${b.round}: ${c.name} takes no damage${note}.`
              : `R${b.round}: ${c.name} saves${note} and takes no damage.`
        );
      });
      AOE.open = false;
      commit();
      const kx = [
        ['res', 'resisted'],
        ['imm', 'immune'],
        ['vul', 'vulnerable'],
      ]
        .filter(([k]) => K[k])
        .map(([k, l]) => `${K[k]} ${l}`);
      toast(`${nm}: ${dmg} damage to ${plural(ts.length, 'target')}${kx.length ? ` (${kx.join(', ')})` : ''}`);
    };
  }
  // remove a combatant; a defeated foe keeps its XP for the end of the battle
  function rmCb(b, i, credit) {
    const c = b.combatants[i];
    if (!c) return;
    const wasCur = i === b.turn;
    b.combatants.splice(i, 1);
    if (i < b.turn) b.turn--;
    if (credit && +c.xp) {
      b.gone = b.gone || [];
      b.gone.push({ name: c.name, xp: +c.xp || 0 });
    }
    b.log.push(`R${b.round}: ${c.name} left the battle${credit && +c.xp ? `, counted as defeated (${c.xp} XP)` : ''}.`);
    if (b.turn >= b.combatants.length) {
      b.turn = 0;
      if (wasCur && b.combatants.length) {
        b.round++;
        if (b.round > Math.floor((b.reach || 0) / 1000)) b.log.push(`Round ${b.round} begins.`);
        fireEvents(b);
      }
    }
    if (wasCur && b.combatants.length) {
      b.reach = 0;
      reachTurn(b);
    }
    commit();
  }
  function cbTarget(c) {
    return c.pid ? S.players.find((x) => x.id === c.pid) || c : c;
  }
  function cbState(c) {
    if (c.lair) return { hp: 1, max: 1, ac: '—', thp: 0, cond: [] };
    const t = cbTarget(c);
    return c.pid
      ? { hp: t.hp, max: t.maxHp, ac: t.ac, thp: t.thp || 0, cond: t.conditions || [] }
      : { hp: c.hp, max: c.maxHp, ac: c.ac, thp: c.thp || 0, cond: c.conditions || [] };
  }
  let fxOpen = null,
    logAll = false;
  // a quiet clock for the current turn, so slow turns are easy to spot
  let turnKey = '',
    turnAt = Date.now();
  function turnClock(b) {
    const k = `${b.id}:${b.round}:${b.turn}`;
    if (k !== turnKey) {
      turnKey = k;
      turnAt = Date.now();
    }
    const s = Math.floor((Date.now() - turnAt) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  setInterval(() => {
    const el = document.getElementById('tTimer'),
      b = activeBattle();
    if (!el || !b) return;
    el.textContent = turnClock(b);
    el.classList.toggle('long', Date.now() - turnAt >= 90000);
  }, 1000);
  // 2024 conditions that change an attack roll; both together cancel out
  function advHint(c, th, a) {
    const tc = th ? th.cond : [],
      ac = (c && c.conditions) || [],
      rng = String((a && a[2]) || '').startsWith('range'),
      adv = [],
      dis = [];
    ['Blinded', 'Paralyzed', 'Petrified', 'Restrained', 'Stunned', 'Unconscious'].forEach((k) => {
      if (tc.includes(k)) adv.push('target ' + k.toLowerCase());
    });
    if (tc.includes('Prone') && !tc.includes('Unconscious'))
      (rng ? dis : adv).push(rng ? 'target prone, attack from range' : 'target prone, if within 5 ft');
    if (tc.includes('Invisible')) dis.push('target invisible');
    ['Blinded', 'Frightened', 'Poisoned', 'Prone', 'Restrained'].forEach((k) => {
      if (ac.includes(k)) dis.push('attacker ' + k.toLowerCase());
    });
    if (ac.includes('Invisible')) adv.push('attacker invisible');
    if (!adv.length && !dis.length) return '';
    const v =
      adv.length && dis.length
        ? 'Advantage and Disadvantage cancel: roll normally'
        : adv.length
          ? 'Roll with Advantage'
          : 'Roll with Disadvantage';
    const crit =
      (tc.includes('Paralyzed') || tc.includes('Unconscious')) && !rng
        ? '. A hit from within 5 ft is a critical hit'
        : '';
    return `${v} (${[...adv, ...dis].join(', ')})${crit}.`;
  }
  const concDC = (n) => Math.min(30, Math.max(10, Math.floor(n / 2)));
  // apply damage (negative) or healing to a combatant; returns the log line
  function hurt(b, c, delta, crit) {
    const t = cbTarget(c),
      was = cbState(c).hp,
      cbConcWas = cbState(c).cond.includes('Concentrating'),
      wasDead = !!(c.pid && cbTarget(c).dead);
    let line;
    const raw = delta < 0 ? -delta : 0;
    if (c.pid) {
      const p = S.players.find((x) => x.id === c.pid);
      if (p) changeHp(p, delta);
    } else {
      delta = absorb(c, delta);
      c.hp = clamp(c.hp + delta, 0, c.maxHp);
    }
    const h = cbState(c),
      n = Math.abs(delta);
    line = `R${b.round}: ${c.name} ${raw ? 'took' : 'healed'} ${raw || n}${raw ? ' damage' : ' HP'}${h.hp <= 0 && was > 0 ? ' and is down' : ''}.${c.pid && h.hp <= 0 && was > 0 && S.dm.injuries ? ' Roll for a lingering injury.' : ''}`;
    const pl = c.pid && S.players.find((x) => x.id === c.pid);
    if (delta > 0 && pl && wasDead)
      return `R${b.round}: ${c.name} is dead, so healing does nothing. Use Revive to bring them back.`;
    if (delta < 0 && pl && wasDead) line += ' They are already dead.';
    else if (delta < 0 && pl && pl.dead) {
      tlog(`${c.name} died from massive damage.`, true);
      line += ` That is more than their HP maximum: they die outright.`;
      toast(`${c.name} dies from massive damage`);
    } else if (delta < 0 && c.pid && was <= 0) {
      c.ds = c.ds || { s: 0, f: 0 };
      if (c.ds.s >= 3) {
        c.ds = { s: 0, f: 0 };
        line += ' They are no longer stable.';
      }
      c.ds.f = Math.min(3, (c.ds.f || 0) + (crit ? 2 : 1));
      line += ` Damage at 0 HP: ${crit ? 'two death save failures' : 'one death save failure'}${c.ds.f >= 3 ? ', and they die' : ''}.`;
      if (c.ds.f >= 3 && pl) {
        pl.dead = true;
        tlog(`${c.name} died.`, true);
      }
    }
    if (delta < 0 && c.pid && h.hp <= 0 && was > 0 && t.conditions && cbConcWas) line += ' Concentration ends.';
    if (raw && h.cond.includes('Concentrating') && h.hp > 0) line += ` Concentration save DC ${concDC(raw)}.`;
    if (!c.pid && !c.lair && h.hp <= 0 && was > 0) moraleCheck(b, c);
    return line;
  }
  function sortCombat(b, cur) {
    b.combatants.sort((a, c) => c.init - a.init || c.ini - a.ini || (c.pid ? 1 : 0) - (a.pid ? 1 : 0));
    b.turn = Math.max(0, b.combatants.indexOf(cur));
  }
  function nextTurn(b) {
    if (!b.combatants.length) {
      toast('No one is left in this battle');
      return;
    }
    const alive = (i) => (cbState(b.combatants[i]).hp > 0 && !b.combatants[i].fled) || !!b.combatants[i].pid;
    const r0 = b.round;
    let t = b.turn,
      g = 0;
    do {
      t++;
      if (t >= b.combatants.length) {
        t = 0;
        b.round++;
        if (b.round > Math.floor((b.reach || 0) / 1000)) b.log.push(`Round ${b.round} begins.`);
      }
      g++;
    } while (!alive(t) && g <= b.combatants.length);
    b.turn = t;
    reachTurn(b);
    if (b.round > r0) fireEvents(b);
    commit();
  }
  function addFoes(base, n) {
    draftSync();
    bdraft = bdraft ||
      draftLoad() || { name: '', picked: S.players.filter(inPlay).map((p) => p.id), foes: [], custom: [] };
    for (let i = 0; i < n; i++)
      bdraft.foes.push({
        id: uid(),
        base: base.n,
        name: base.n,
        maxHp: base.hp,
        hp: base.hp,
        ac: base.ac,
        ini: base.ini,
        xp: base.xp || 0,
        conditions: [],
      });
  }
  function removeFoe(name) {
    const i = bdraft.foes.map((f) => f.base).lastIndexOf(name);
    if (i >= 0) bdraft.foes.splice(i, 1);
  }
  // 2024 DMG XP budget per character by level: low, moderate, high
  const BUDGET = [
    null,
    [50, 75, 100],
    [100, 150, 200],
    [150, 225, 400],
    [250, 375, 500],
    [500, 750, 1100],
    [600, 1000, 1400],
    [750, 1300, 1700],
    [1000, 1700, 2100],
    [1300, 2000, 2600],
    [1600, 2300, 3100],
    [1900, 2900, 4100],
    [2200, 3700, 4700],
    [2600, 4200, 5400],
    [2900, 4900, 6200],
    [3300, 5400, 7800],
    [3800, 6100, 9800],
    [4500, 7200, 11700],
    [5000, 8700, 14200],
    [5500, 10700, 17200],
    [6400, 13200, 22000],
  ];
  function xpBudget() {
    const f = bdraft?.foes || [];
    const total = f.reduce((s, x) => s + (+x.xp || 0), 0);
    const pcs = S.players.filter((p) => bdraft.picked.includes(p.id));
    const th = pcs.reduce(
      (a, p) => {
        const t = BUDGET[clamp(+p.level || 1, 1, 20)];
        return a.map((v, i) => v + t[i]);
      },
      [0, 0, 0]
    );
    let rating = '';
    if (pcs.length && total) {
      rating = total > th[2] ? 'Beyond high' : total > th[1] ? 'High' : total > th[0] ? 'Moderate' : 'Low';
    }
    return { total, rating, th };
  }
  function foeGroups() {
    const g = new Map();
    (bdraft.foes || []).forEach((f) => {
      if (!g.has(f.base)) g.set(f.base, { f, count: 0 });
      g.get(f.base).count++;
    });
    return [...g.values()];
  }
  let newFilter = '';
  VIEWS.battle.new = () => {
    bdraft = bdraft ||
      draftLoad() || { name: '', picked: S.players.filter(inPlay).map((p) => p.id), foes: [], custom: [] };
    bdraft.custom = bdraft.custom || [];
    if (bdraft.prep) return initiativeEntry();
    const ab = activeBattle();
    const xp = xpBudget();
    const count = (n) => bdraft.foes.filter((f) => f.base === n).length;
    const q = newFilter.toLowerCase();
    const pool = [...bdraft.custom.map((m) => ({ ...m, cr: 'custom' })), ...MONSTERS].filter(
      (m) => (!q || m.n.toLowerCase().includes(q) || (m.t || '').toLowerCase().includes(q)) && crOk(m, newCr)
    );
    const groups = foeGroups();
    const ratingCls = { Low: 'ok', Moderate: 'ok', High: 'bl', 'Beyond high': 'dn' }[xp.rating] || 'mut';
    return {
      html:
        head(
          'New battle',
          'Choose who is fighting and build the monster list. Next you\u2019ll enter each player\u2019s initiative roll.'
        ) +
        (ab
          ? `<div class="empty">A battle is already running. End it before starting another. <button class="btn sm" type="button" id="goLive">Go to live battle</button></div>`
          : '') +
        `
    <div class="box"><label class="f">Battle name<input type="text" id="bName" placeholder="Ambush at the old bridge" value="${esc(bdraft.name)}"></label>
      <h4>Players joining</h4>
      <div class="toggles">${S.players.map((p) => `<label><input type="checkbox" value="${p.id}"${bdraft.picked.includes(p.id) ? ' checked' : ''}>${esc(p.name)}</label>`).join('') || '<span class="empty">Add players on the home screen first.</span>'}</div>
      <details class="stakes" id="stakesD"${bdraft.stakesOpen || bdraft.goal || bdraft.lose || (bdraft.events || []).length ? ' open' : ''}><summary>Stakes and round events <span>optional</span></summary>
        <div class="grid"><label class="f">Objective<input type="text" id="bGoal" placeholder="Hold the bridge for 5 rounds" value="${esc(bdraft.goal || '')}"></label>
          <label class="f">If they lose<input type="text" id="bLose" placeholder="The cultists finish the ritual" value="${esc(bdraft.lose || '')}"></label></div>
        ${(bdraft.events || []).length ? `<div class="evlist">${bdraft.events.map((x, k) => `<div class="ev"><span class="num">Round ${x.r}</span><span>${esc(x.text)}</span><button class="rmb" type="button" data-rmev="${k}" aria-label="Remove event">×</button></div>`).join('')}</div>` : ''}
        <div class="row"><input type="number" id="evR" min="1" max="99" value="3" style="width:76px" aria-label="Round"><input type="text" id="evT" value="${esc(bdraft.evT || '')}" placeholder="Round event, e.g. two more goblins arrive" style="flex:1;min-width:150px" aria-label="What happens"><button class="btn" type="button" id="evAdd">Add event</button></div>
      </details></div>
    <div class="enc">
      <div class="box"><div class="row between"><h4>Add monsters</h4><button class="btn sm ghost" type="button" id="custTog">${bdraft.showCustom ? 'Hide custom' : '+ Custom monster'}</button></div>
        <div class="grid" id="customRow"${bdraft.showCustom ? '' : ' hidden'}>
          <label class="f">Name<input type="text" id="cName" placeholder="Cult fanatic"></label>
          <label class="f">HP<input type="number" id="cHp" min="1" value="10"></label>
          <label class="f">AC<input type="number" id="cAc" min="0" value="12"></label>
          <label class="f">Initiative bonus<input type="number" id="cIni" value="0"></label>
          <label class="f">XP<input type="number" id="cXp" min="0" value="0"></label>
          <label class="f">How many<input type="number" id="cHow" min="1" max="30" value="1"></label>
          <div class="row" style="align-self:end"><button class="btn" type="button" id="cAdd">Add to list</button></div>
        </div>
        <div class="row" style="flex-wrap:nowrap"><input type="search" id="nf" placeholder="Search ${MONSTERS.length} monsters" value="${esc(newFilter)}" aria-label="Search monsters">${crSelect('ncr', newCr)}</div>
        <div class="picker">${
          pool
            .map((m) => {
              const c = count(m.n);
              return `<div class="pk${c ? ' on' : ''}">
          <div class="pn">${m.cr === 'custom' ? `<strong>${esc(m.n)}</strong>` : monLink(m.n)}<span class="num">${m.cr === 'custom' ? 'Custom' : 'CR ' + m.cr} · HP ${m.hp} · AC ${m.ac}</span></div>
          <div class="stepper"><button type="button" data-dec="${esc(m.n)}" aria-label="One fewer ${esc(m.n)}"${c ? '' : ' disabled'}>−</button><span class="num" aria-label="${esc(m.n)} count">${c}</span><button type="button" data-inc="${esc(m.n)}" aria-label="One more ${esc(m.n)}">+</button></div>
        </div>`;
            })
            .join('') || '<div class="empty">No monsters match.</div>'
        }</div>
        <div class="row" style="flex-wrap:wrap"><select id="genD" style="width:auto" aria-label="Difficulty">${['Low', 'Moderate', 'High'].map((l, i) => `<option value="${i}"${(bdraft.genD ?? 1) === i ? ' selected' : ''}>${l}</option>`).join('')}</select><input type="text" id="genT" placeholder="Any type, or e.g. undead" value="${esc(bdraft.genT || '')}" style="flex:1;min-width:130px" aria-label="Monster type"><button class="btn" type="button" id="genGo">Random encounter</button></div>
      </div>
      <div class="box encl"><div class="row between"><h4>Monster list</h4>${groups.length ? '<button class="btn sm ghost" type="button" id="clearFoes">Clear list</button>' : ''}</div>
        ${
          groups.length
            ? `<div class="list">${groups
                .map(
                  ({ f, count: c }) => `<div class="eg">
          <div class="pn"><strong>${monLink(f.base)} <span class="x-n num">×${c}</span></strong><span class="num">HP ${f.maxHp} · AC ${f.ac}${f.xp ? ` · ${f.xp * c} XP` : ''}</span></div>
          <div class="stepper"><button type="button" data-dec="${esc(f.base)}" aria-label="One fewer ${esc(f.base)}">−</button><button type="button" data-inc="${esc(f.base)}" aria-label="One more ${esc(f.base)}">+</button><button type="button" data-rmall="${esc(f.base)}" aria-label="Remove all ${esc(f.base)}">×</button></div>
        </div>`
                )
                .join('')}</div>
        <div class="esum"><div class="row between"><span>${plural(bdraft.foes.length, 'monster')}</span><span class="num">${xp.total} XP</span></div>
          ${
            xp.rating
              ? `<div class="row between"><span>Difficulty for ${plural(bdraft.picked.length, 'player')}</span><span class="pill ${ratingCls}">${xp.rating}</span></div>
          <div class="thr num">Party budget: Low ${xp.th[0]} · Moderate ${xp.th[1]} · High ${xp.th[2]} XP</div>`
              : ''
          }</div>`
            : '<div class="empty">Use + next to a monster to add it here. Add as many kinds as you like.</div>'
        }
      </div>
    </div>
    <div class="row end">${bdraft.foes.length || bdraft.name || bdraft.goal || bdraft.lose || (bdraft.events || []).length ? '<button class="btn ghost" type="button" id="bClear" title="Start this battle over. Ctrl+Z brings it back">Clear</button>' : ''}<button class="btn" type="button" id="bPlan">Save as plan</button><button class="btn pri" type="button" id="bStart"${ab ? ' disabled' : ''}>Next: initiative</button></div>`,
      bind: () => {
        const ov = $('overlay');
        const base = (n) =>
          bdraft.custom.find((m) => m.n === n) ||
          MONSTERS.find((m) => m.n === n) ||
          (() => {
            const f = bdraft.foes.find((x) => x.base === n);
            return f && { n, hp: f.maxHp, ac: f.ac, ini: f.ini, xp: f.xp };
          })();
        $('goLive') &&
          ($('goLive').onclick = () => {
            view.sub = 'live';
            drawSheet(true);
          });
        $('bName').oninput = (e) => (bdraft.name = e.target.value);
        $('stakesD').ontoggle = (e) => (bdraft.stakesOpen = e.target.open);
        $('bGoal').oninput = (e) => (bdraft.goal = e.target.value);
        $('bLose').oninput = (e) => (bdraft.lose = e.target.value);
        const evGo = () => {
          const t = val('evT');
          if (!t) {
            toast('Describe what happens');
            return;
          }
          bdraft.events = bdraft.events || [];
          if (bdraft.events.length >= 30) return;
          bdraft.events.push({ r: clamp(Math.round(+val('evR') || 1), 1, 99), text: t.slice(0, 200) });
          bdraft.events.sort((x, y) => x.r - y.r);
          bdraft.evT = '';
          drawSheet();
          $('evT') && $('evT').focus();
        };
        $('evAdd').onclick = evGo;
        $('evT').oninput = (e) => (bdraft.evT = e.target.value);
        $('evT').onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            evGo();
          }
        };
        ov.querySelectorAll('[data-rmev]').forEach(
          (x) =>
            (x.onclick = () => {
              bdraft.events.splice(+x.dataset.rmev, 1);
              drawSheet();
            })
        );
        ov.querySelectorAll('.toggles input').forEach(
          (c) =>
            (c.onchange = () => {
              bdraft.picked = [...ov.querySelectorAll('.toggles input:checked')].map((i) => i.value);
              drawSheet();
            })
        );
        $('custTog').onclick = () => {
          bdraft.showCustom = !bdraft.showCustom;
          drawSheet();
        };
        $('cAdd').onclick = () => {
          const n = val('cName');
          if (!n) {
            toast('Name the monster first');
            return;
          }
          const m = {
            n,
            hp: Math.max(1, +val('cHp') || 1),
            ac: +val('cAc') || 10,
            ini: +val('cIni') || 0,
            xp: +val('cXp') || 0,
          };
          bdraft.custom = bdraft.custom.filter((x) => x.n !== n);
          bdraft.custom.unshift(m);
          addFoes(m, clamp(+val('cHow') || 1, 1, 30));
          drawSheet();
        };
        $('ncr').onchange = (e) => {
          newCr = e.target.value;
          drawSheet();
        };
        const f = $('nf');
        f.oninput = () => {
          newFilter = f.value;
          drawSheet();
          const n = $('nf');
          n.focus();
          n.setSelectionRange(n.value.length, n.value.length);
        };
        ov.querySelectorAll('[data-inc]').forEach(
          (b) =>
            (b.onclick = () => {
              const m = base(b.dataset.inc);
              if (m) {
                addFoes(m, 1);
                drawSheet();
              }
            })
        );
        ov.querySelectorAll('[data-dec]').forEach(
          (b) =>
            (b.onclick = () => {
              removeFoe(b.dataset.dec);
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-rmall]').forEach(
          (b) =>
            (b.onclick = () => {
              bdraft.foes = bdraft.foes.filter((x) => x.base !== b.dataset.rmall);
              drawSheet();
            })
        );
        $('clearFoes') &&
          ($('clearFoes').onclick = () => {
            bdraft.foes = [];
            drawSheet();
          });
        $('genD').onchange = (e) => (bdraft.genD = +e.target.value);
        $('genT').oninput = (e) => (bdraft.genT = e.target.value);
        $('genGo').onclick = () => {
          const r = genEncounter(bdraft.genD ?? 1, bdraft.genT || '');
          if (r) {
            toast(r);
            return;
          }
          drawSheet();
          toast(`Rolled a ${xpBudget().rating.toLowerCase()} encounter`);
        };
        $('bPlan').onclick = () => {
          if (val('evT')) evGo();
          savePlan();
        };
        $('bClear') &&
          ($('bClear').onclick = () => {
            draftDrop();
            bdraft = null;
            newFilter = '';
            commit();
            draftMark();
            toast('Battle draft cleared. Ctrl+Z brings it back');
          });
        $('bStart').onclick = () => {
          if (val('evT')) evGo();
          const pcs = S.players.filter((p) => bdraft.picked.includes(p.id));
          if (!pcs.length && !bdraft.foes.length) {
            toast('Add someone to the fight first');
            return;
          }
          const totals = {},
            seen = {};
          bdraft.foes.forEach((f) => (totals[f.base] = (totals[f.base] || 0) + 1));
          const foes = bdraft.foes.map((f) => {
            seen[f.base] = (seen[f.base] || 0) + 1;
            const roll = d20();
            return {
              ...f,
              id: uid(),
              name: totals[f.base] > 1 ? `${f.base} ${seen[f.base]}` : f.base,
              roll,
              init: roll + (+f.ini || 0),
            };
          });
          bdraft.prep = {
            pcs: pcs.map((p) => ({
              id: uid(),
              pid: p.id,
              name: p.name,
              ini: +p.ini || 0,
              init: '',
              ds: { s: 0, f: 0 },
            })),
            foes,
          };
          drawSheet(true);
          setTimeout(() => {
            const f = $('overlay').querySelector('[data-pinit]');
            f && f.focus();
          }, 0);
        };
      },
    };
  };
  function initiativeEntry() {
    const pr = bdraft.prep;
    const missing = pr.pcs.filter((c) => c.init === '' || c.init == null);
    return {
      html:
        head(
          'Roll for initiative',
          'Ask each player for their initiative total and type it in. Monsters have already rolled; change any number you like.'
        ) +
        `
    <div class="box"><h4>Players</h4>
      ${
        pr.pcs.length
          ? `<div class="list">${pr.pcs
              .map((c, i) => {
                const p = S.players.find((x) => x.id === c.pid);
                return `<div class="eg ie${c.init === '' ? ' need' : ''}">
        <div class="pn"><strong>${esc(c.name)}</strong><span>Initiative bonus ${c.ini >= 0 ? '+' : ''}${c.ini}${p ? ` · ${esc(p.cls)} ${esc(p.level)}` : ''}</span></div>
        <input type="number" inputmode="numeric" class="initin num" data-pinit="${i}" value="${c.init}" placeholder="Total" aria-label="Initiative for ${esc(c.name)}">
      </div>`;
              })
              .join('')}</div>`
          : '<div class="empty">No players in this battle.</div>'
      }
    </div>
    <div class="box"><div class="row between"><h4>Monsters</h4><button class="btn sm ghost" type="button" id="reroll">Reroll all</button></div>
      ${pr.foes.length ? `<div class="toggles"><label><input type="checkbox" id="grpInit"${pr.group ? ' checked' : ''}>Same monsters share one roll</label><label title="2024 rules: a surprised creature rolls initiative with disadvantage"><input type="checkbox" id="surpInit"${pr.surp ? ' checked' : ''}>Monsters are surprised</label></div>` : ''}
      ${
        pr.foes.length
          ? `<div class="list">${pr.foes
              .map(
                (f, i) => `<div class="eg ie">
        <div class="pn"><strong>${esc(f.name)}</strong><span class="num">Rolled ${f.roll} ${f.ini >= 0 ? '+' : '−'} ${Math.abs(f.ini)}</span></div>
        <label class="hidebox" title="Not yet seen by the players. Reveal it when they spot it"><input type="checkbox" data-fhide="${i}"${f.hidden ? ' checked' : ''}>Hidden</label><input type="number" class="initin num" data-finit="${i}" value="${f.init}" aria-label="Initiative for ${esc(f.name)}">
      </div>`
              )
              .join('')}</div>`
          : '<div class="empty">No monsters in this battle.</div>'
      }
    </div>
    <div class="row between"><button class="btn ghost" type="button" id="backBuild">Back to monster list</button>
      <div class="row"><span id="waitN" style="color:var(--ink-3);font-size:13px">${missing.length ? `Waiting on ${missing.length}` : ''}</span><button class="btn pri" type="button" id="begin">Begin battle</button></div></div>`,
      bind: () => {
        const ov = $('overlay');
        const inputs = [...ov.querySelectorAll('[data-pinit]')];
        inputs.forEach((el, k) => {
          el.oninput = () => {
            pr.pcs[+el.dataset.pinit].init = el.value === '' ? '' : +el.value;
            el.closest('.ie').classList.toggle('need', el.value === '');
            const m = pr.pcs.filter((c) => c.init === '' || c.init == null).length;
            $('waitN').textContent = m ? `Waiting on ${m}` : '';
          };
          el.onkeydown = (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const nx = inputs[k + 1];
              nx ? nx.focus() : $('begin').focus();
            }
          };
        });
        ov.querySelectorAll('[data-finit]').forEach(
          (el) =>
            (el.oninput = () => {
              if (el.value !== '') pr.foes[+el.dataset.finit].init = +el.value;
            })
        );
        ov.querySelectorAll('[data-fhide]').forEach(
          (el) =>
            (el.onchange = () => {
              pr.foes[+el.dataset.fhide].hidden = el.checked;
            })
        );
        $('reroll').onclick = () => {
          rollFoes(pr);
          drawSheet();
        };
        $('grpInit') &&
          ($('grpInit').onchange = (e) => {
            pr.group = e.target.checked;
            rollFoes(pr);
            drawSheet();
          });
        $('surpInit') &&
          ($('surpInit').onchange = (e) => {
            pr.surp = e.target.checked;
            rollFoes(pr);
            drawSheet();
            toast(pr.surp ? 'Monsters rerolled with disadvantage' : 'Monsters rerolled');
          });
        $('backBuild').onclick = () => {
          delete bdraft.prep;
          drawSheet(true);
        };
        $('begin').onclick = () => {
          pr.pcs = pr.pcs.filter((c) => S.players.some((p) => p.id === c.pid));
          const miss = pr.pcs.filter((c) => c.init === '' || c.init == null);
          if (miss.length) {
            toast(`Enter initiative for ${miss.map((c) => c.name).join(', ')}`);
            const el = ov.querySelector(`[data-pinit="${pr.pcs.indexOf(miss[0])}"]`);
            el && el.focus();
            return;
          }
          pr.pcs.forEach((c) => (c.ds = dsSeed(S.players.find((x) => x.id === c.pid))));
          const cs = [...pr.pcs, ...pr.foes.map(({ roll, ...f }) => f)];
          cs.forEach((c) => (c.init = clamp(Math.round(+c.init || 0), -99, 99)));
          // ties: higher bonus first, players before monsters
          cs.sort((a, b) => b.init - a.init || b.ini - a.ini || (b.pid ? 1 : 0) - (a.pid ? 1 : 0));
          if (S.example) S.battles = S.battles.filter((x) => x.active);
          const evs = (bdraft.events || []).map((x) => ({ r: x.r, text: x.text, done: false }));
          S.battles.push({
            id: uid(),
            name: bdraft.name || `Battle ${S.battles.length + 1}`,
            date: today(),
            session: S.dm.session,
            active: true,
            round: 1,
            turn: 0,
            combatants: cs,
            log: [`Round 1 begins. ${cs[0].name} acts first.`],
            outcome: '',
            xp: 0,
            goal: (bdraft.goal || '').trim(),
            lose: (bdraft.lose || '').trim(),
            events: evs,
          });
          const nb = S.battles[S.battles.length - 1];
          fireEvents(nb);
          draftDrop();
          bdraft = null;
          newFilter = '';
          view.sub = 'live';
          commit();
          draftMark();
        };
      },
    };
  }
  let BROWS = [];
  VIEWS.battle.bestiary = () => {
    const q = bestFilter.toLowerCase();
    const list = MONSTERS.filter(
      (m) => (!q || m.n.toLowerCase().includes(q) || (m.t || '').toLowerCase().includes(q)) && crOk(m, bestCr)
    );
    return {
      html:
        head(
          'Bestiary',
          `${MONSTERS.filter((m) => !m.hb).length} monsters from the SRD 5.2.1${S.homebrew.length ? ' and your homebrew' : ''}. Click a name for its attacks.`
        ) +
        `
    <div class="row" style="flex-wrap:nowrap"><input type="search" id="bf" placeholder="Search by name or type, e.g. dragon, undead" value="${esc(bestFilter)}" aria-label="Search monsters">${crSelect('bcr', bestCr)}</div>
    <div class="meta" style="color:var(--ink-3);font-size:13px">${list.length === MONSTERS.length ? `${list.length} monsters` : `${list.length} of ${MONSTERS.length} monsters`}</div>
    <div class="tw"><table class="t"><thead><tr><th>Monster</th><th>CR</th><th>AC</th><th>HP</th><th>Init</th><th>Speed</th><th></th></tr></thead><tbody>
    ${(BROWS = list.map((m) => `<tr><td>${monLink(m.n)}${m.t ? `<div class="sub">${esc(m.t)}</div>` : ''}${mnLine(m.n)}</td><td class="n">${m.cr}</td><td class="n">${m.ac}</td><td class="n">${m.hp}</td><td class="n">${m.ini >= 0 ? '+' : '−'}${Math.abs(m.ini)}</td><td><span class="sub">${esc(m.spd)}</span></td><td><button class="btn sm" type="button" data-addm="${esc(m.n)}">Add</button></td></tr>`)).slice(0, 60).join('') || '<tr><td colspan="7" class="sub">No monsters match.</td></tr>'}
    </tbody></table></div>
    <p style="margin:0;color:var(--ink-3);font-size:12px">Monster numbers and attacks are from the SRD 5.2.1 (CC-BY-4.0). Credit in Quick rules.</p>`,
      bind: () => {
        const f = $('bf');
        f.oninput = () => {
          bestFilter = f.value;
          drawSheet();
          const n = $('bf');
          n.focus();
          n.setSelectionRange(n.value.length, n.value.length);
        };
        $('bcr').onchange = (e) => {
          bestCr = e.target.value;
          drawSheet();
        };
        const tb = $('overlay').querySelector('.t tbody');
        tb.onclick = (e) => {
          const b = e.target.closest('[data-addm]');
          if (!b) return;
          const m = MON_BY_NAME.get(b.dataset.addm);
          if (m) {
            addFoes(m, 1);
            toast(`${m.n} added to the next battle`);
          }
        };
        if (BROWS.length > 60) {
          const rest = BROWS.slice(60).join(''),
            keep = BROWS;
          requestAnimationFrame(() => {
            if (BROWS === keep && tb.isConnected) tb.insertAdjacentHTML('beforeend', rest);
          });
        }
      },
    };
  };
  VIEWS.battle.conditions = () => ({
    html:
      head('Conditions', 'Quick reference for the 2024 rules conditions, in short form.') +
      `<div class="cond">${Object.entries(COND_TEXT)
        .map(([k, t]) => `<div class="item"><strong>${k}</strong><p>${t}</p></div>`)
        .join('')}</div>`,
  });
  VIEWS.battle.rules = () => ({
    html:
      head('Quick rules', 'The numbers you look up most during play, in short form. 2024 rules.') +
      wRulesTop() +
      `<div class="rules">
  <div class="item"><h4>Setting a DC</h4><dl><dt>5</dt><dd>Very easy</dd><dt>10</dt><dd>Easy</dd><dt>15</dt><dd>Medium</dd><dt>20</dt><dd>Hard</dd><dt>25</dt><dd>Very hard</dd><dt>30</dt><dd>Nearly impossible</dd></dl></div>
  <div class="item"><h4>Cover</h4><dl><dt>Half</dt><dd>+2 to AC and Dexterity saves</dd><dt>Three-quarters</dt><dd>+5 to AC and Dexterity saves</dd><dt>Total</dt><dd>Can’t be targeted directly</dd></dl></div>
  <div class="item"><h4>Actions</h4><p style="margin:0;color:var(--ink-2);font-size:14px">Attack, Dash, Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, Utilize. Plus one Bonus Action if a feature grants one, one Reaction per round, and movement up to Speed.</p></div>
  <div class="item"><h4>Dropping to 0 HP</h4><dl><dt>Death save</dt><dd>d20 at the start of each turn, 10+ succeeds</dd><dt>Three</dt><dd>successes stabilise, failures kill</dd><dt>Natural 20</dt><dd>Regain 1 HP</dd><dt>Natural 1</dt><dd>Counts as two failures</dd><dt>Hit at 0 HP</dt><dd>One failure, two if it’s a critical</dd><dt>Instant death</dt><dd>Damage past 0 that equals or exceeds the HP maximum</dd></dl></div>
  <div class="item"><h4>Concentration</h4><p style="margin:0;color:var(--ink-2);font-size:14px">On taking damage, Constitution save DC 10 or half the damage, whichever is higher (max DC 30). Also ends if Incapacitated or the caster dies.</p></div>
  <div class="item"><h4>Helpless targets</h4><p style="margin:0;color:var(--ink-2);font-size:14px">Attacks against an Unconscious or Paralyzed creature have Advantage, and any hit from within 5 feet is a critical hit.</p></div>
  <div class="item"><h4>Falling and breath</h4><dl><dt>Falling</dt><dd>1d6 Bludgeoning per 10 ft, max 20d6, land Prone</dd><dt>Breath</dt><dd>Hold for 1 + Con mod minutes (min 30 seconds)</dd></dl></div>
  <div class="item"><h4>Travel pace</h4><dl><dt>Fast</dt><dd>4 mph, 30 miles a day, Disadvantage on Perception and Survival</dd><dt>Normal</dt><dd>3 mph, 24 miles a day, Disadvantage on Stealth</dd><dt>Slow</dt><dd>2 mph, 18 miles a day, Advantage on Perception and Survival</dd></dl><button class="lnk" type="button" data-gotravel>Plan a journey in Travel</button></div>
  <div class="item"><h4>Light</h4><dl><dt>Bright</dt><dd>Normal vision</dd><dt>Dim</dt><dd>Lightly obscured, Disadvantage on sight-based Perception</dd><dt>Darkness</dt><dd>Heavily obscured, effectively Blinded</dd></dl></div>
  <div class="item"><h4>Resting</h4><dl><dt>Short</dt><dd>1 hour, spend Hit Point Dice to heal. Warlocks regain Pact Magic slots</dd><dt>Long</dt><dd>8 hours, regain all HP and all spent Hit Point Dice, lose 1 Exhaustion</dd></dl></div>
</div>`,
  });
  VIEWS.battle.history = () => {
    const past = S.battles
      .filter((b) => !b.active)
      .slice()
      .reverse();
    return {
      html:
        head('History', 'Every finished battle with its outcome and XP.') +
        (past.length
          ? `
    <div class="tw"><table class="t"><thead><tr><th>Battle</th><th>Session</th><th>Outcome</th><th>Rounds</th><th>XP</th><th></th></tr></thead><tbody>
    ${past.map((b) => `<tr><td><strong>${esc(b.name)}</strong><div class="sub">${esc(b.date)}</div></td><td class="n">${esc(b.session || '')}</td><td>${esc(b.outcome)}</td><td class="n">${b.round}</td><td class="n">${b.xp || 0}</td><td><button class="btn sm ghost" type="button" data-bdel="${b.id}">Delete</button></td></tr>`).join('')}
    </tbody></table></div>`
          : '<div class="empty">No finished battles yet.</div>'),
      bind: () =>
        $('overlay')
          .querySelectorAll('[data-bdel]')
          .forEach((b) =>
            armDelete(
              b,
              () => {
                S.battles = S.battles.filter((x) => x.id !== b.dataset.bdel);
                commit();
                pruneImgs();
                saveImgs();
              },
              'Confirm'
            )
          ),
    };
  };

  /* Missions */
  const MS = { active: ['Active', 'ok'], hold: ['On hold', 'bl'], done: ['Complete', 'mut'], failed: ['Failed', 'dn'] };
  function missionList(list) {
    return list.length
      ? `<div class="list">${list
          .map(
            (m) => `<div class="item">
    <div class="row between"><strong>${esc(m.title)}</strong><span class="pill ${MS[m.status][1]}">${MS[m.status][0]}</span></div>
    <div class="meta">${[m.giver && `From ${esc(m.giver)}`, m.where && esc(m.where), m.reward && `Reward: ${esc(m.reward)}`].filter(Boolean).join(' · ') || 'No details yet'}</div>
    ${dueLine(m)}${wMissionFac(m)}${m.notes ? `<p>${esc(m.notes)}</p>` : ''}${secretsFor('mission', m.id)}${cluesHTML(m)}
    <div class="row end">${Object.keys(MS)
      .filter((k) => k !== m.status)
      .map(
        (k) =>
          `<button class="btn sm ghost" type="button" data-ms="${m.id}" data-to="${k}">${k === 'active' ? 'Reopen' : k === 'done' ? 'Complete' : k === 'failed' ? 'Mark failed' : 'Put on hold'}</button>`
      )
      .join('')}
      ${wFileBtn(m)}<button class="btn sm ghost" type="button" data-clo="${m.id}" aria-expanded="${CLUE_OPEN === m.id}">+ Clue</button>${editBtn('missions', m.id)}<button class="btn sm ghost" type="button" data-mdel="${m.id}">Delete</button></div>
  </div>`
          )
          .join('')}</div>`
      : '';
  }
  function bindMissions() {
    const ov = $('overlay');
    bindEdits();
    bindRevs();
    bindClues(ov);
    wBindMissions(ov);
    ov.querySelectorAll('[data-ms]').forEach(
      (b) =>
        (b.onclick = () => {
          const m = S.missions.find((x) => x.id === b.dataset.ms);
          m.status = b.dataset.to;
          tlog(`Mission ${MS[m.status][0].toLowerCase()}: ${m.title}.`, true);
          commit();
          wMissionEnd(m);
          toast(`${m.title}: ${MS[m.status][0].toLowerCase()}`);
        })
    );
    ov.querySelectorAll('[data-mdel]').forEach((b) =>
      armDelete(
        b,
        () => {
          untieClues('mission', b.dataset.mdel);
          S.fronts.forEach((f) => {
            if (f.mission === b.dataset.mdel) f.mission = '';
          });
          S.missions = S.missions.filter((x) => x.id !== b.dataset.mdel);
          S.secrets.forEach((s) => {
            if (s.link === `mission:${b.dataset.mdel}`) s.link = '';
          });
          commit();
        },
        'Confirm'
      )
    );
  }
  VIEWS.mission.active = () => {
    const list = S.missions.filter((m) => m.status === 'active' || m.status === 'hold');
    return {
      html:
        head('Active missions', 'What the party is working on right now.') +
        (missionList(list) || '<div class="empty">No active missions. Add one under New mission.</div>'),
      bind: bindMissions,
    };
  };
  VIEWS.mission.archive = () => {
    const list = S.missions.filter((m) => m.status === 'done' || m.status === 'failed');
    return {
      html:
        head('Archive', 'Completed and failed missions.') +
        (missionList(list) || '<div class="empty">Nothing archived yet.</div>'),
      bind: bindMissions,
    };
  };
  /* Edit-in-place: EDIT={k,id} prefills the add form of that list */
  let EDIT = null,
    SQ = '',
    NPCQ = '';
  function bindNpcF() {
    const f = $('npcF');
    if (!f) return;
    const run = () => {
      NPCQ = f.value;
      const q = f.value.trim().toLowerCase();
      let n = 0;
      $('overlay')
        .querySelectorAll('[data-npcq]')
        .forEach((r) => {
          const on = !q || r.dataset.npcq.includes(q);
          r.hidden = !on;
          if (on) n++;
        });
      $('npcNone').hidden = n > 0;
    };
    f.oninput = run;
    run();
  }
  const editing = (k) => (EDIT && EDIT.k === k ? S[k].find((x) => x.id === EDIT.id) || null : null);
  const ev = (o, k) => (o ? esc(o[k] ?? '') : '');
  const formBtns = (o, id, add) =>
    `<div class="row end">${o ? `<button class="btn ghost" type="button" data-ecancel>Cancel</button>` : ''}<button class="btn pri" type="button" id="${id}">${o ? 'Save changes' : add}</button></div>`;
  const editBtn = (k, id) =>
    `<button class="btn sm ghost" type="button" data-edit="${k}" data-id="${id}">Edit</button>`;
  function upsert(k, o, fields, ex) {
    if (o) {
      Object.assign(o, fields);
      EDIT = null;
      commit();
      toast('Changes saved');
    } else {
      clearExample(k);
      S[k].push(Object.assign({ id: uid() }, fields, ex || {}));
      commit();
    }
  }
  function bindEdits() {
    const ov = $('overlay');
    ov.querySelectorAll('[data-edit]').forEach(
      (b) =>
        (b.onclick = () => {
          EDIT = { k: b.dataset.edit, id: b.dataset.id };
          if (EDIT.k === 'missions') view.sub = 'new';
          drawSheet();
          const m = ov.querySelector('.main');
          m && m.scrollTo && m.scrollTo(0, 0);
          const o = ov.querySelector('.ov');
          if (o) o.scrollTop = 0;
          const i = ov.querySelector('.editing input,.editing textarea');
          i && i.focus();
        })
    );
    ov.querySelectorAll('[data-ecancel]').forEach(
      (b) =>
        (b.onclick = () => {
          const k = EDIT && EDIT.k;
          EDIT = null;
          if (k === 'missions') view.sub = 'active';
          drawSheet();
        })
    );
  }
  VIEWS.mission.new = () => {
    const o = editing('missions');
    return {
      html:
        head(
          o ? 'Edit mission' : 'New mission',
          o ? 'Change anything, then save.' : 'Log a quest as soon as the party accepts it.'
        ) +
        `
  <div class="box ${o ? 'editing' : ''}"><div class="grid">
    <label class="f">Mission<input type="text" id="mTitle" placeholder="Rescue the blacksmith’s daughter" value="${ev(o, 'title')}"></label>
    <label class="f">Quest giver<input type="text" id="mGiver" placeholder="Mayor Harbin Wester" value="${ev(o, 'giver')}"></label>
    <label class="f">Location<input type="text" id="mWhere" placeholder="The sunken chapel" value="${ev(o, 'where')}"></label>
    <label class="f">Reward<input type="text" id="mReward" placeholder="100 gp" value="${ev(o, 'reward')}"></label></div>
    <label class="f">Details<textarea id="mNotes" placeholder="What the party knows and any complications">${ev(o, 'notes')}</textarea></label>
    <div class="grid"><label class="f">Deadline day<input type="number" id="mDay" min="1" placeholder="Today is ${esc(dayLabel(S.time.day))}" value="${o && o.due ? o.due.day : ''}"></label>
      <label class="f">Deadline time<input type="time" id="mTime" value="${o && o.due ? hhmm(o.due.min) : ''}"></label>
      <label class="f" style="grid-column:1/-1">If ignored<input type="text" id="mIfx" maxlength="300" placeholder="The cult finishes the ritual and the dead rise" value="${ev(o, 'ifIgnored')}"></label></div>
    <p class="quiet">Leave the day empty for no deadline, or the time empty for the end of that day. The log notes when a deadline passes.</p>
    ${formBtns(o, 'mNew', 'Add mission')}</div>`,
      bind: () => {
        bindEdits();
        $('mNew').onclick = () => {
          const t = val('mTitle');
          if (!t) {
            toast('Give the mission a name');
            return;
          }
          view.sub = o && (o.status === 'done' || o.status === 'failed') ? 'archive' : 'active';
          const had = !!o;
          upsert(
            'missions',
            o,
            {
              title: t,
              giver: val('mGiver'),
              where: val('mWhere'),
              reward: val('mReward'),
              notes: $('mNotes').value.trim(),
              ...dueFields(o),
            },
            { status: 'active', clues: [] }
          );
          if (!had) toast('Mission added');
        };
      },
    };
  };
  const COINS = [
    ['pp', 10],
    ['gp', 1],
    ['ep', 0.5],
    ['sp', 0.1],
    ['cp', 0.01],
  ];
  const purseGp = () => COINS.reduce((t, [k, v]) => t + (+S.purse[k] || 0) * v, 0);
  // pay n coins of kind k: use that coin first, then others, breaking bigger coins for change. -1 if the party can't afford it, 1 if change was made
  const CP = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 },
    BREAK = { pp: ['gp', 10], gp: ['sp', 10], ep: ['sp', 5], sp: ['cp', 10] };
  function payCoins(n, k) {
    const P = S.purse,
      tot = Object.keys(CP).reduce((t, c) => t + (+P[c] || 0) * CP[c], 0);
    let R = n * CP[k];
    if (tot < R) return -1;
    const use = Math.min(+P[k] || 0, n);
    P[k] -= use;
    R -= use * CP[k];
    if (!R) return 0;
    for (let g = 0; R > 0 && g < 200; g++) {
      for (const c of ['pp', 'gp', 'ep', 'sp', 'cp']) {
        const t = Math.min(+P[c] || 0, Math.floor(R / CP[c]));
        P[c] -= t;
        R -= t * CP[c];
      }
      if (R > 0) {
        const c = ['cp', 'sp', 'ep', 'gp', 'pp'].find((c) => (+P[c] || 0) > 0 && BREAK[c]);
        if (!c) return -1;
        P[c]--;
        P[BREAK[c][0]] = (+P[BREAK[c][0]] || 0) + BREAK[c][1];
      }
    }
    return 1;
  }
  VIEWS.mission.loot = () => {
    const o = editing('loot');
    const hold = o ? o.holder : 'Party';
    return {
      html:
        head('Loot & rewards', 'Treasure the party has found and who is carrying it.') +
        `
  <div class="box"><div class="row between"><h4 class="eyebrow" style="margin:0">Party funds</h4><span class="meta num" id="pTot">Worth ${purseGp().toLocaleString(undefined, { maximumFractionDigits: 2 })} gp</span></div>
    <div class="purse" style="margin-top:10px">${COINS.map(([k]) => `<label>${k}<input type="number" min="0" data-coin="${k}" value="${+S.purse[k] || 0}" aria-label="${k}"></label>`).join('')}</div>
    <div class="row" style="flex-wrap:wrap;margin-top:10px"><input type="text" id="coinAdj" placeholder="+250 gp, -15 sp" style="flex:1;min-width:150px" aria-label="Add or spend coins"><button class="btn" type="button" id="coinGo">Add / spend</button><button class="btn ghost" type="button" id="coinSplit">Split gp across party</button></div></div>
  <div class="box ${o ? 'editing' : ''}"><div class="grid">
    <label class="f">Item<input type="text" id="lItem" placeholder="+1 longsword" value="${ev(o, 'item')}"></label>
    <label class="f">Held by<select id="lHolder">${['Party', ...S.players.map((p) => p.name)].map((n) => `<option${n === hold ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label class="f">Value<input type="text" id="lVal" placeholder="250 gp" value="${ev(o, 'value')}"></label></div>
    ${formBtns(o, 'lAdd', 'Add loot')}</div>
  ${
    S.loot.length
      ? `<div class="tw"><table class="t"><thead><tr><th>Item</th><th>Held by</th><th>Value</th><th>Session</th><th></th></tr></thead><tbody>
  ${S.loot
    .slice()
    .reverse()
    .map(
      (l) =>
        `<tr><td>${esc(l.item)}</td><td>${esc(l.holder)}</td><td class="n">${esc(l.value)}</td><td class="n">${esc(l.session)}</td><td><span class="row">${editBtn('loot', l.id)}<button class="btn sm ghost" type="button" data-ldel="${l.id}">Remove</button></span></td></tr>`
    )
    .join('')}
  </tbody></table></div>`
      : '<div class="empty">No loot logged yet.</div>'
  }`,
      bind: () => {
        bindEdits();
        const ov = $('overlay');
        ov.querySelectorAll('[data-coin]').forEach(
          (i) =>
            (i.onchange = () => {
              S.purse[i.dataset.coin] = Math.max(0, Math.floor(+i.value || 0));
              commit();
            })
        );
        $('coinGo').onclick = () => {
          const t = $('coinAdj').value.toLowerCase();
          const ops = [];
          t.replace(/([+-]?)\s*(\d+)\s*(pp|gp|ep|sp|cp)/g, (m, sg, n, k) => {
            ops.push([sg === '-' ? -1 : 1, +n, k]);
          });
          if (!ops.length) {
            toast('Try something like +250 gp or -15 sp');
            return;
          }
          const before = JSON.stringify(S.purse);
          let changed = false;
          for (const [sg, n, k] of ops) {
            if (sg > 0) {
              S.purse[k] = (+S.purse[k] || 0) + n;
              continue;
            }
            const r = payCoins(n, k);
            if (r < 0) {
              S.purse = JSON.parse(before);
              toast(
                `The party can’t cover ${n} ${k}. They have ${purseGp().toLocaleString(undefined, { maximumFractionDigits: 2 })} gp in all`
              );
              return;
            }
            if (r) changed = true;
          }
          tlog(`Party funds ${ops.map(([sg, n, k]) => `${sg > 0 ? '+' : '−'}${n} ${k}`).join(', ')}.`, true);
          commit();
          toast(changed ? 'Funds updated, with change made from bigger coins' : 'Funds updated');
        };
        $('coinSplit').onclick = () => {
          const n = S.players.length;
          if (!n) {
            toast('Add players first');
            return;
          }
          const each = Math.floor((+S.purse.gp || 0) / n);
          toast(
            each
              ? `${each} gp each for ${n} players, ${(+S.purse.gp || 0) - each * n} gp left over`
              : 'Not enough gp to split'
          );
        };
        $('lAdd').onclick = () => {
          const it = val('lItem');
          if (!it) {
            toast('Name the item first');
            return;
          }
          upsert('loot', o, { item: it, holder: val('lHolder'), value: val('lVal') }, { session: S.dm.session });
        };
        ov.querySelectorAll('[data-ldel]').forEach((b) =>
          armDelete(
            b,
            () => {
              S.loot = S.loot.filter((x) => x.id !== b.dataset.ldel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };

  /* Notes */
  VIEWS.notes.sessions = () => {
    const o = editing('notes');
    return {
      html:
        head('Session log', 'A recap for every session, newest first.') +
        `
  <div class="box ${o ? 'editing' : ''}"><div class="grid"><label class="f">Title<input type="text" id="nTitle" value="${o ? ev(o, 'title') : `Session ${esc(S.dm.session)} recap`}"></label>
    <label class="f">Date<input type="date" id="nDate" value="${o ? ev(o, 'date') : today()}"></label></div>
    <label class="f">Recap<textarea id="nBody" placeholder="What happened, choices the party made, cliffhanger for next time">${ev(o, 'body')}</textarea></label>
    ${formBtns(o, 'nSave', 'Save recap')}</div>
  <div class="list">${S.notes
    .slice()
    .reverse()
    .map(
      (n) =>
        `<div class="item"><div class="row between"><strong>${esc(n.title)}</strong><span class="meta num">${esc(n.date)}</span></div><p>${esc(n.body)}</p><div class="row end">${editBtn('notes', n.id)}<button class="btn sm ghost" type="button" data-ndel="${n.id}">Delete</button></div></div>`
    )
    .join('')}</div>`,
      bind: () => {
        bindEdits();
        $('nSave').onclick = () => {
          const body = $('nBody').value.trim();
          if (!body) {
            toast('Write the recap first');
            return;
          }
          const had = !!o;
          upsert('notes', o, { date: val('nDate') || today(), title: val('nTitle') || 'Session notes', body });
          if (!had) toast('Recap saved');
        };
        $('overlay')
          .querySelectorAll('[data-ndel]')
          .forEach((b) =>
            armDelete(
              b,
              () => {
                S.notes = S.notes.filter((x) => x.id !== b.dataset.ndel);
                commit();
              },
              'Confirm'
            )
          );
      },
    };
  };
  VIEWS.notes.npcs = () => {
    const o = editing('npcs');
    const att = o ? o.attitude : 'Indifferent';
    const npcForm = `
  <div class="box ${o ? 'editing' : ''}" id="npcForm"><div class="grid">
    <label class="f">Name<input type="text" id="cN" placeholder="Tam Brisket" value="${ev(o, 'name')}"></label>
    <label class="f">Role<input type="text" id="cR" placeholder="Innkeeper" value="${ev(o, 'role')}"></label>
    <label class="f">Where<input type="text" id="cW" placeholder="The Gull &amp; Lantern" value="${ev(o, 'where')}"></label>
    <label class="f">Attitude<select id="cA">${ATTITUDES.map((a) => `<option${a === att ? ' selected' : ''}>${a}</option>`).join('')}</select></label></div>
    <p class="quiet" id="cInfl">${INFL[att] || ''}</p>
    <label class="f">Notes<input type="text" id="cNo" placeholder="Anything else worth remembering" value="${ev(o, 'notes')}"></label>
    <div class="grid"><label class="f">Voice or mannerism<input type="text" id="cV" maxlength="200" placeholder="Talks fast and never meets your eye" value="${ev(o, 'voice')}"></label>
      <label class="f">Wants<input type="text" id="cWa" maxlength="300" placeholder="To pay off a debt to the wreckers" value="${ev(o, 'wants')}"></label>
      <label class="f">Knows<input type="text" id="cK" maxlength="1000" placeholder="Where the hideout’s back door is" value="${ev(o, 'knows')}"></label>
      <label class="f">Last seen in session<input type="number" id="cL" min="0" max="9999" placeholder="Not yet" value="${o && o.last ? o.last : ''}"></label></div>
    ${formBtns(o, 'cAdd', 'Add NPC')}</div>`;
    const npcList = `
  ${
    S.npcs.length
      ? `${S.npcs.length > 1 ? `<input type="search" class="npcf" id="npcF" placeholder="Find an NPC by name, role, place or what they know" aria-label="Find an NPC" value="${esc(NPCQ)}">` : ''}<div class="tw"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Where</th><th>Attitude</th><th></th></tr></thead><tbody>
  ${S.npcs.map((n) => `<tr data-npcq="${esc([n.name, n.role, n.where, n.notes, n.attitude, n.voice, n.wants, n.knows].join(' ').toLowerCase())}"><td><strong>${esc(n.name)}</strong>${n.notes ? `<div class="sub">${esc(n.notes)}</div>` : ''}${npcMore(n)}${secretsFor('npc', n.id)}</td><td>${esc(n.role)}</td><td>${esc(n.where)}</td><td><span class="pill ${n.attitude === 'Friendly' ? 'ok' : n.attitude === 'Hostile' ? 'dn' : 'mut'}">${esc(n.attitude)}</span></td><td><span class="row">${editBtn('npcs', n.id)}<button class="btn sm ghost" type="button" data-cdel="${n.id}">Remove</button></span></td></tr>`).join('')}
  </tbody></table></div><div class="empty" id="npcNone" hidden>No NPC matches.</div>`
      : '<div class="empty">No NPCs yet.</div>'
  }`;
    return {
      html:
        head('NPCs', 'Everyone the party has met, so names and attitudes stay consistent.') +
        (o || !S.npcs.length ? npcForm + npcList : npcList + npcForm),
      bind: () => {
        bindEdits();
        bindRevs();
        bindSeen();
        bindNpcF();
        $('cA').onchange = (e) => {
          $('cInfl').textContent = INFL[e.target.value] || '';
        };
        $('cAdd').onclick = () => {
          const n = val('cN');
          if (!n) {
            toast('Give the NPC a name');
            return;
          }
          upsert('npcs', o, {
            name: n,
            role: val('cR'),
            where: val('cW'),
            attitude: val('cA'),
            notes: val('cNo'),
            voice: val('cV').slice(0, 200),
            wants: val('cWa').slice(0, 300),
            knows: val('cK').slice(0, 1000),
            last: clamp(Math.round(+val('cL') || 0), 0, 9999),
          });
        };
        $('overlay')
          .querySelectorAll('[data-cdel]')
          .forEach((b) =>
            armDelete(
              b,
              () => {
                untieClues('npc', b.dataset.cdel);
                S.npcs = S.npcs.filter((x) => x.id !== b.dataset.cdel);
                S.secrets.forEach((s) => {
                  if (s.link === `npc:${b.dataset.cdel}`) s.link = '';
                });
                commit();
              },
              'Confirm'
            )
          );
      },
    };
  };
  VIEWS.notes.places = () => {
    const o = editing('places');
    const kd = o ? o.kind : 'Town';
    return {
      html:
        head('Places', 'Towns, dungeons and landmarks the party knows about.') +
        `
  <div class="box ${o ? 'editing' : ''}"><div class="grid">
    <label class="f">Name<input type="text" id="plN" placeholder="Gull Rock" value="${ev(o, 'name')}"></label>
    <label class="f">Type<select id="plK">${['Town', 'Dungeon', 'Wilderness', 'Landmark', 'Building'].map((a) => `<option${a === kd ? ' selected' : ''}>${a}</option>`).join('')}</select></label></div>
    <label class="f">Notes<input type="text" id="plNo" placeholder="What is here, who controls it" value="${ev(o, 'notes')}"></label>
    ${formBtns(o, 'plAdd', 'Add place')}</div>
  <div class="list">${S.places.map((p) => `<div class="item"><div class="row between"><strong>${esc(p.name)}</strong><span class="pill mut">${esc(p.kind)}</span></div>${p.notes ? `<p>${esc(p.notes)}</p>` : ''}${secretsFor('place', p.id)}<div class="row end">${editBtn('places', p.id)}<button class="btn sm ghost" type="button" data-pldel="${p.id}">Remove</button></div></div>`).join('') || '<div class="empty">No places yet.</div>'}</div>`,
      bind: () => {
        bindEdits();
        bindRevs();
        $('plAdd').onclick = () => {
          const n = val('plN');
          if (!n) {
            toast('Name the place first');
            return;
          }
          upsert('places', o, { name: n, kind: val('plK'), notes: val('plNo') });
        };
        $('overlay')
          .querySelectorAll('[data-pldel]')
          .forEach((b) =>
            armDelete(
              b,
              () => {
                untieClues('place', b.dataset.pldel);
                S.places = S.places.filter((x) => x.id !== b.dataset.pldel);
                S.secrets.forEach((s) => {
                  if (s.link === `place:${b.dataset.pldel}`) s.link = '';
                });
                commit();
              },
              'Confirm'
            )
          );
      },
    };
  };
  /* Search across everything */
  function searchAll(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    const add = (kind, title, text, go, fields) => {
      if (
        fields.some((v) =>
          String(v ?? '')
            .toLowerCase()
            .includes(q)
        )
      )
        out.push({ kind, title, text, go });
    };
    S.players.forEach((p) =>
      add(
        'Player',
        p.name,
        [p.player, p.cls && `${p.cls} ${p.level}`].filter(Boolean).join(' · '),
        ['player', 'overview', p.id],
        [p.name, p.player, p.cls, p.notes]
      )
    );
    S.missions.forEach((m) =>
      add(
        'Mission',
        m.title,
        [m.giver, m.where, m.reward].filter(Boolean).join(' · '),
        ['mission', 'edit:missions', m.id],
        [m.title, m.giver, m.where, m.reward, m.notes, m.ifIgnored, ...(m.clues || []).map((c) => c.text)]
      )
    );
    S.loot.forEach((l) =>
      add(
        'Loot',
        l.item,
        [l.holder, l.value].filter(Boolean).join(' · '),
        ['mission', 'loot', l.id, 'loot'],
        [l.item, l.holder, l.value]
      )
    );
    S.notes.forEach((n) =>
      add('Session', n.title, n.body, ['notes', 'sessions', n.id, 'notes'], [n.title, n.body, n.date])
    );
    S.npcs.forEach((n) =>
      add(
        'NPC',
        n.name,
        [n.role, n.where, n.notes].filter(Boolean).join(' · '),
        ['notes', 'npcs', n.id, 'npcs'],
        [n.name, n.role, n.where, n.notes, n.attitude, n.voice, n.wants, n.knows]
      )
    );
    S.places.forEach((p) =>
      add('Place', p.name, p.notes, ['notes', 'places', p.id, 'places'], [p.name, p.kind, p.notes])
    );
    (S.handouts || []).forEach((h) =>
      add('Handout', h.title, h.body, ['notes', 'handouts', h.id, 'handouts'], [h.title, h.body])
    );
    S.fronts.forEach((f) =>
      add(
        'Front',
        f.name,
        f.goal,
        ['session', 'fronts', f.id, 'fronts'],
        [
          f.name,
          f.goal,
          f.doom,
          ...f.portents.map((p) => p.text),
          ...f.cast.map((x) => `${x.name} ${x.impulse}`),
          ...f.stakes.map((x) => `${x.q} ${x.a}`),
        ]
      )
    );
    wSearch(add);
    S.secrets.forEach((s) =>
      add('Secret', s.revealed ? 'Revealed secret' : 'Secret', s.text, ['notes', 'secrets'], [s.text])
    );
    return out;
  }
  function sresHTML() {
    const r = searchAll(SQ);
    if (!SQ.trim())
      return '<div class="empty">Type a name, place or word to search players, missions, loot, recaps, NPCs, places, factions, rumours, rulings, the timeline and secrets.</div>';
    return r.length
      ? `<div class="list sres">${r.map((x, i) => `<div class="item" role="button" tabindex="0" data-sr="${i}"><div class="row between"><strong>${esc(x.title)}</strong><span class="pill mut">${x.kind}</span></div>${x.text ? `<p>${esc(String(x.text).slice(0, 180))}</p>` : ''}</div>`).join('')}</div>`
      : `<div class="empty">Nothing matches “${esc(SQ)}”.</div>`;
  }
  VIEWS.notes.search = () => ({
    html:
      head('Search', 'Find anything you have written down.') +
      `<div class="box"><input type="search" id="sq" placeholder="Search everything" value="${esc(SQ)}" aria-label="Search everything" style="width:100%"></div><div id="sres">${sresHTML()}</div>`,
    bind: () => {
      const i = $('sq');
      const bindR = () =>
        $('sres')
          .querySelectorAll('[data-sr]')
          .forEach((el) => {
            const go = () => {
              const x = searchAll(SQ)[+el.dataset.sr];
              const [sec, sub, id, ek] = x.go;
              if (sec === 'player') {
                openSheet('player', 'overview', id);
                return;
              }
              const ed = sub === 'edit:missions';
              view = { sec, sub: ed ? 'new' : sub };
              EDIT = ed ? { k: 'missions', id } : ek ? { k: ek, id } : null;
              drawSheet(true);
            };
            el.onclick = go;
            el.onkeydown = (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go();
              }
            };
          });
      i.oninput = () => {
        SQ = i.value;
        $('sres').innerHTML = sresHTML();
        bindR();
      };
      bindR();
      setTimeout(() => i.focus(), 0);
    },
  });
  VIEWS.notes.secrets = () => {
    const o = editing('secrets');
    const kept = S.secrets.filter((s) => !s.revealed),
      rev = S.secrets.filter((s) => s.revealed);
    const row = (s) =>
      `<div class="item"><div class="row between"><div class="stext"><p style="color:var(--ink)">${esc(s.text)}</p>${linkName(s.link) || s.tonight || s.rsess ? `<div class="meta">${[linkName(s.link) && `Tied to ${esc(linkName(s.link))}`, s.tonight && 'Planned for tonight', s.revealed && s.rsess && `Revealed in session ${s.rsess}`].filter(Boolean).join(' · ')}</div>` : ''}</div><span class="row">${s.revealed ? '' : `<button class="btn sm ghost" type="button" data-tn="${s.id}" aria-pressed="${!!s.tonight}">${s.tonight ? 'Not tonight' : 'Tonight'}</button>`}<button class="btn sm ${s.revealed ? 'ghost' : ''}" type="button" data-rev="${s.id}">${s.revealed ? 'Hide again' : 'Mark revealed'}</button>${editBtn('secrets', s.id)}<button class="btn sm ghost" type="button" data-sdel="${s.id}">Delete</button></span></div></div>`;
    return {
      html:
        head('DM secrets', 'Twists and clues the party hasn’t discovered yet. Keep this screen to yourself.') +
        `
    <div class="box ${o ? 'editing' : ''}"><div class="grid"><label class="f" style="grid-column:span 2">Secret or clue<input type="text" id="sT" placeholder="The innkeeper is a Zhentarim spy" value="${ev(o, 'text')}"></label><label class="f">Tied to<select id="sL">${linkOptions(o ? o.link : '', true)}</select></label></div>${formBtns(o, 'sAdd', 'Add secret')}</div>
    <div class="list">${kept.map(row).join('') || '<div class="empty">No secrets kept.</div>'}</div>
    ${rev.length ? `<h4 class="eyebrow">Revealed</h4><div class="list">${rev.map(row).join('')}</div>` : ''}`,
      bind: () => {
        bindEdits();
        $('sAdd').onclick = () => {
          const t = val('sT');
          if (!t) return;
          const l = val('sL');
          upsert(
            'secrets',
            o,
            { text: t.slice(0, 2000), link: LINK_RE.test(l) ? l : '' },
            { revealed: false, tonight: false, rsess: 0 }
          );
        };
        $('overlay')
          .querySelectorAll('[data-tn]')
          .forEach(
            (x) =>
              (x.onclick = () => {
                const s = S.secrets.find((y) => y.id === x.dataset.tn);
                s.tonight = !s.tonight;
                commit();
              })
          );
        const ov = $('overlay');
        ov.querySelectorAll('[data-rev]').forEach(
          (b) =>
            (b.onclick = () => {
              const s = S.secrets.find((x) => x.id === b.dataset.rev);
              setRevealed(s, !s.revealed);
              commit();
            })
        );
        ov.querySelectorAll('[data-sdel]').forEach((b) =>
          armDelete(
            b,
            () => {
              S.secrets = S.secrets.filter((x) => x.id !== b.dataset.sdel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };

  /* ---------- story: session flow, scenes, clocks, hooks, quick notes ---------- */
  const HOOKS = [
    ['goal', 'Goal', 'Avenge her brother'],
    ['bond', 'Bond', 'The priest who raised him'],
    ['fear', 'Fear', 'Deep water'],
    ['secret', 'Secret', 'Owes a debt to a devil'],
  ];
  const SCENE_KINDS = ['Social', 'Exploration', 'Combat', 'Other'];
  const CLOCK_SIZES = [4, 6, 8, 10, 12];
  const CLOCK_TICK = { none: 'By hand', hour: 'Every in-game hour', day: 'Every in-game day' };
  const LINK_RE = /^(npc|place|mission|front):[A-Za-z0-9_-]{1,40}$/;
  function tlog(text, auto) {
    wOnLog(text, auto);
    const t = S.tonight;
    t.log.push({
      id: uid(),
      at: Date.now(),
      day: S.time.day,
      min: S.time.min,
      text: String(text).slice(0, 500),
      auto: !!auto,
    });
    if (t.log.length > 400) t.log.splice(0, t.log.length - 400);
  }
  const since = (ms) => {
    const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };
  setInterval(() => {
    const el = document.getElementById('runFor');
    if (el && S.tonight.started) el.textContent = since(S.tonight.started);
  }, 30000);
  // Fronts are the DM's private plan, so the version read to the table leaves them out
  const frontLine = (l) => {
    const t = l.replace(/^\s*[-•]\s*/, '');
    if (/^(Grim portent, |Doom falls, |Stakes answered, |Front averted: )/.test(t)) return true;
    const m = t.match(/^Clock complete: (.+?)\./);
    return !!m && (S.clocks || []).some((c) => c.name === m[1] && linkedFront(c));
  };
  const readAloud = (t) => {
    const out = [];
    let skip = false;
    String(t)
      .split('\n')
      .forEach((l) => {
        if (l.trim() === 'Table notes') {
          skip = true;
          return;
        }
        if (skip && !l.trim()) {
          skip = false;
          return;
        }
        if (
          skip ||
          /^(Spotlight|Present): /.test(l) ||
          /\(hidden\)/.test(l) ||
          /^- Group .+ check, DC \d+:/.test(l) ||
          frontLine(l) ||
          /^\s*[-•]?\s*(Ruling|DM only)\b/i.test(l)
        )
          return;
        out.push(l);
      });
    return out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  const span = (m) => {
    const d = Math.floor(m / 1440),
      h = Math.floor((m % 1440) / 60),
      mm = m % 60;
    return (
      [d && plural(d, 'day'), h && plural(h, 'hour'), !d && mm && plural(mm, 'minute')].filter(Boolean).join(' ') ||
      'no time'
    );
  };
  function sessStart() {
    const t = S.tonight;
    t.started = Date.now();
    t.t0 = { day: S.time.day, min: S.time.min };
    commit();
    wrapDraft = null;
    wrapEdited = false;
    wrapCliff = '';
    wrapLvl = false;
    wrapNext = '';
    clearTimeout(keepWrapT);
    const d = backupAge();
    toast(
      d == null || d >= 7
        ? `Session ${S.dm.session} is running. ${d == null ? 'You haven’t saved a backup yet' : `Last backup was ${d} days ago`}, so Save backup now`
        : `Session ${S.dm.session} is running. Press J any time for a quick note`
    );
  }

  /* progress clocks */
  const segs = (c) =>
    `<span class="segs" role="img" aria-label="${c.fill} of ${c.size}">${Array.from({ length: c.size }, (_, i) => `<i${i < c.fill ? ' class="on"' : ''}></i>`).join('')}</span>`;
  function clockFull(c) {
    if (linkedFront(c)) return;
    tlog(`Clock complete: ${c.name}.${c.cons ? ` ${c.cons}` : ''}`, true);
    setTimeout(() => toast(`${c.name} is complete${c.cons ? `. ${c.cons}` : ''}`), 300);
  }
  function tickClock(c, d) {
    const was = c.fill;
    c.fill = clamp(c.fill + d, 0, c.size);
    if (c.fill === was) return;
    if (c.fill < c.size) c.acc = 0;
    if (c.fill >= c.size && was < c.size) clockFull(c);
    syncFronts();
    commit();
  }
  function tickTime(m) {
    checkDeadlines();
    if (!(m > 0) || !S.clocks) return;
    S.clocks.forEach((c) => {
      if (c.tick === 'none' || c.fill >= c.size) return;
      const per = c.tick === 'day' ? 1440 : 60;
      c.acc += m;
      while (c.acc >= per && c.fill < c.size) {
        c.acc -= per;
        c.fill++;
      }
      if (c.fill >= c.size) {
        c.acc = 0;
        clockFull(c);
      }
    });
    syncFronts();
  }

  /* fronts: threats that move on their own, Dungeon World style. A goal, a cast, grim portents in order and an impending doom */
  const FRONT_KINDS = ['Campaign', 'Adventure'],
    FRONT_STATUS = ['active', 'doom', 'averted', 'spent'];
  const frontClock = (f) => (f.clock ? S.clocks.find((c) => c.id === f.clock) || null : null);
  const linkedFront = (c) => (S.fronts || []).some((f) => f.clock === c.id);
  const frontLive = (f) => f.status === 'active' || f.status === 'doom';
  // with a clock, portent i of n lands when the clock passes its share and the doom when the clock is full
  const portentAt = (f, i, c) => clamp(Math.round(((i + 1) * c.size) / (f.portents.length + 1)), 1, c.size - 1);
  const reachedOf = (f) => f.portents.filter((p) => p.done).length;
  const canBack = (f) => f.status === 'doom' || reachedOf(f) > 0;
  const nextLabel = (f) => (reachedOf(f) < f.portents.length ? 'Next portent' : 'Doom falls');
  let FNEWS = [],
    fnewsT = 0;
  function fnews(t) {
    FNEWS.push(t);
    clearTimeout(fnewsT);
    fnewsT = setTimeout(() => {
      toast(FNEWS.join(' · '));
      FNEWS = [];
    }, 300);
  }
  function portentHit(f, p, quiet) {
    p.done = true;
    p.day = S.time.day;
    if (quiet) return;
    tlog(`Grim portent, ${f.name}: ${p.text}`, true);
    fnews(`Grim portent: ${p.text}`);
  }
  function doomFalls(f, quiet) {
    f.status = 'doom';
    if (quiet) return;
    tlog(`Doom falls, ${f.name}.${f.doom ? ` ${f.doom}` : ''}`, true);
    fnews(`${f.name}: the doom falls${f.doom ? `. ${f.doom}` : ''}`);
  }
  // a linked clock drives its front both ways: filling it brings portents and the doom, emptying it takes them back
  function syncFronts(quiet) {
    (S.fronts || []).forEach((f) => {
      if (!frontLive(f)) return;
      const c = frontClock(f);
      if (!c) return;
      f.portents.forEach((p, i) => {
        const on = c.fill >= portentAt(f, i, c);
        if (on && !p.done) portentHit(f, p, quiet);
        else if (!on && p.done) {
          p.done = false;
          p.day = 0;
        }
      });
      if (c.fill >= c.size && f.status !== 'doom') doomFalls(f, quiet);
      else if (c.fill < c.size && f.status === 'doom') f.status = 'active';
    });
  }
  // one step along a front: the next portent, then the doom. Returns false when nothing moved
  function stepFront(f, d) {
    if (!f || !frontLive(f)) return false;
    const c = frontClock(f),
      n = f.portents.length,
      r = reachedOf(f);
    if (c) {
      const was = c.fill;
      if (d > 0) {
        if (f.status === 'doom' || c.fill >= c.size) return false;
        c.fill = r < n ? Math.max(c.fill + 1, portentAt(f, r, c)) : c.size;
      } else c.fill = f.status === 'doom' ? c.size - 1 : r ? portentAt(f, r - 1, c) - 1 : was;
      c.fill = clamp(c.fill, 0, c.size);
      if (c.fill === was) return false;
      c.acc = 0;
      syncFronts();
      return true;
    }
    if (d > 0) {
      if (f.status === 'doom') return false;
      if (r < n) portentHit(f, f.portents[r]);
      else doomFalls(f);
      return true;
    }
    if (f.status === 'doom') {
      f.status = 'active';
      return true;
    }
    if (!r) return false;
    const p = f.portents[r - 1];
    p.done = false;
    p.day = 0;
    return true;
  }
  function advanceFront(f, d) {
    if (stepFront(f, d)) commit();
  }
  const frontTrack = (f) =>
    `<span class="segs ftrack" role="img" aria-label="${reachedOf(f)} of ${f.portents.length} grim portents${f.status === 'doom' || f.status === 'spent' ? ', the doom has fallen' : ''}">${f.portents.map((p) => `<i${p.done ? ' class="on"' : ''}></i>`).join('')}<i class="doom${f.status === 'doom' || f.status === 'spent' ? ' on' : ''}"></i></span>`;
  const frontNext = (f) => {
    if (f.status === 'doom' || f.status === 'spent') return 'The doom has fallen';
    if (f.status === 'averted') return 'Averted';
    const p = f.portents.find((x) => !x.done);
    return p ? `Next: ${p.text}` : `Next: the doom${f.doom ? `. ${f.doom}` : ''}`;
  };
  function frontMeta(f) {
    const c = frontClock(f),
      m = f.mission ? S.missions.find((x) => x.id === f.mission) : null;
    const l = m && m.status === 'active' && m.due && !m.dueFired ? minsUntil(m) : null;
    return [
      `${reachedOf(f)} of ${plural(f.portents.length, 'portent')}`,
      c &&
        `clock ${c.fill} / ${c.size}${c.tick !== 'none' && f.status === 'active' ? `, fills every ${c.tick === 'day' ? 'day' : 'hour'}` : ''}`,
      m && (l != null ? `${esc(m.title)} deadline in ${span(Math.max(0, l))}` : `tied to ${esc(m.title)}`),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function frontBody(f, sheet) {
    const cur = f.status === 'active' ? reachedOf(f) : -1,
      fell = f.status === 'doom' || f.status === 'spent';
    return `<div class="fbody"><div class="fprog">${frontTrack(f)}<span class="meta num">${frontMeta(f)}</span></div>
    ${f.portents.length ? `<ol class="portents" aria-label="Grim portents">${f.portents.map((p, i) => `<li class="${p.done ? 'on' : i === cur ? 'next' : ''}"><span>${esc(p.text)}</span>${p.done && p.day ? `<small class="num">${esc(dayLabel(p.day))}</small>` : i === cur ? '<small>Next</small>' : ''}</li>`).join('')}</ol>` : ''}
    <div class="fdoom${fell ? ' on' : ''}"><small>${fell ? 'The doom has fallen' : 'Impending doom'}</small><span>${f.doom ? esc(f.doom) : 'Not written yet.'}</span></div>
    ${
      f.cast.length || f.stakes.length
        ? `<div class="fsplit">${f.cast.length ? `<div class="fsec"><h5>Cast and dangers</h5><ul class="fcast">${f.cast.map((x) => `<li><b>${esc(x.name)}</b>${x.impulse ? ` <span>${esc(x.impulse)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${f.stakes.length ? `<div class="fsec"><h5>Stakes</h5><div class="fstakes">${f.stakes.map((q) => `<div class="fq"><span>${esc(q.q)}</span>${sheet ? `<input type="text" maxlength="300" data-fsa="${f.id}:${q.id}" value="${esc(q.a)}" placeholder="Not answered yet" aria-label="Answer: ${esc(q.q)}">` : `<small${q.a ? '' : ' class="open"'}>${q.a ? esc(q.a) : 'Not answered yet'}</small>`}</div>`).join('')}</div></div>` : ''}</div>`
        : ''
    }
    ${sheet ? secretsFor('front', f.id) : ''}</div>`;
  }

  /* ---------- sketchpad: freehand drawing pages under Notes ---------- */
  // Strokes are kept as numbers in S.sketches, so they save, back up, restore and undo like the rest of the board.
  // Points are whole numbers on a fixed 1600 x 1000 page and the canvas scales to fit, so a sketch looks the same at any size.
  const SK_W = 1600,
    SK_H = 1000,
    SK_MAXP = 30,
    SK_MAXS = 3000,
    SK_MAXN = 8000;
  const SK_COLS = [
    ['ink', 'Ink', '--ink'],
    ['blue', 'Blue', '--sk-blue'],
    ['red', 'Red', '--crit'],
    ['green', 'Green', '--good'],
    ['gold', 'Gold', '--gold'],
    ['purple', 'Purple', '--magic'],
  ];
  const SK_SIZES = [
    ['Fine', 3],
    ['Medium', 8],
    ['Thick', 18],
  ];
  const SK_BGS = [
    ['plain', 'Plain'],
    ['dots', 'Dots'],
    ['grid', 'Squares'],
  ];
  // light paper colours for PNG downloads and handouts, whatever theme the DM is using
  const SK_PRINT = {
    paper: '#ffffff',
    line: '#d9d7d0',
    ink: '#1a1a18',
    blue: '#4651d6',
    red: '#bd3328',
    green: '#1d7449',
    gold: '#8f6300',
    purple: '#7444b8',
  };
  let SK = { page: null, col: 'ink', size: 1, tool: 'pen', redo: [], cleared: null };
  function skNorm() {
    S.sketches = objs(S.sketches)
      .map((p) => {
        fixId(p);
        return {
          id: p.id,
          name: str(p.name, 80).trim() || 'Sketch',
          bg: SK_BGS.some((b) => b[0] === p.bg) ? p.bg : 'plain',
          strokes: objs(p.strokes)
            .map((s) => {
              const pts = arr(s.p).slice(0, SK_MAXN);
              const p2 = [];
              for (let i = 0; i + 1 < pts.length; i += 2) p2.push(int(pts[i], 0, 0, SK_W), int(pts[i + 1], 0, 0, SK_H));
              return p2.length
                ? { k: SK_COLS.some((c) => c[0] === s.k) ? s.k : 'ink', w: int(s.w, 8, 1, 120), e: !!s.e, p: p2 }
                : null;
            })
            .filter(Boolean)
            .slice(-SK_MAXS),
        };
      })
      .slice(0, SK_MAXP);
  }
  const skPage = () => S.sketches.find((p) => p.id === SK.page) || S.sketches[S.sketches.length - 1] || null;
  const skCount = () => S.sketches.filter((p) => p.strokes.length).length || '';
  function skNew() {
    if (S.sketches.length >= SK_MAXP) {
      toast(`You can keep up to ${SK_MAXP} sketch pages. Delete one first`);
      return null;
    }
    const used = new Set(S.sketches.map((p) => p.name));
    let n = S.sketches.length + 1;
    while (used.has('Sketch ' + n)) n++;
    const p = { id: uid(), name: 'Sketch ' + n, bg: 'plain', strokes: [] };
    S.sketches.push(p);
    SK.page = p.id;
    SK.redo = [];
    SK.cleared = null;
    return p;
  }
  // draw one page onto a 2D context already scaled to the 1600 x 1000 page
  function skPaint(ctx, page, col) {
    page.strokes.forEach((s) => {
      const p = s.p;
      ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = s.e ? '#000' : col(s.k);
      ctx.lineWidth = s.w;
      ctx.lineCap = ctx.lineJoin = 'round';
      if (p.length <= 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // smooth the line through the midpoints between samples
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length - 2; i += 2)
        ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      ctx.lineTo(p[p.length - 2], p[p.length - 1]);
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  function skInk() {
    const cs = getComputedStyle(document.body),
      m = {};
    SK_COLS.forEach(([k, , v]) => (m[k] = cs.getPropertyValue(v).trim() || SK_PRINT[k]));
    return (k) => m[k] || m.ink;
  }
  // layout size, not the on-screen size, so the sheet's opening animation can't change the resolution
  function skFit(cv) {
    const d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * d)),
      h = Math.max(1, Math.round((cv.clientWidth * d * SK_H) / SK_W));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(w / SK_W, 0, 0, h / SK_H, 0, 0);
    return ctx;
  }
  function skDraw(cv, page) {
    const ctx = skFit(cv);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(cv.width / SK_W, 0, 0, cv.height / SK_H, 0, 0);
    if (page) skPaint(ctx, page, skInk());
  }
  // a flat picture of the page on light paper, for downloads and handouts
  function skPicture(page, type, q) {
    const cv = document.createElement('canvas');
    cv.width = SK_W;
    cv.height = SK_H;
    const ctx = cv.getContext('2d');
    const ink = document.createElement('canvas');
    ink.width = SK_W;
    ink.height = SK_H;
    skPaint(ink.getContext('2d'), page, (k) => SK_PRINT[k] || SK_PRINT.ink);
    ctx.fillStyle = SK_PRINT.paper;
    ctx.fillRect(0, 0, SK_W, SK_H);
    if (page.bg !== 'plain') {
      ctx.fillStyle = ctx.strokeStyle = SK_PRINT.line;
      ctx.lineWidth = 1.5;
      for (let x = 50; x < SK_W; x += 50)
        for (let y = 50; y < SK_H; y += 50) {
          if (page.bg === 'dots') {
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      if (page.bg === 'grid') {
        ctx.beginPath();
        for (let x = 50; x < SK_W; x += 50) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, SK_H);
        }
        for (let y = 50; y < SK_H; y += 50) {
          ctx.moveTo(0, y);
          ctx.lineTo(SK_W, y);
        }
        ctx.stroke();
      }
    }
    ctx.drawImage(ink, 0, 0);
    let d = cv.toDataURL(type, q);
    if (type === 'image/webp' && !d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', q);
    return d;
  }
  const skBtn = (attr, on, label, inner, extra = '') =>
    `<button type="button" ${attr} aria-pressed="${on}" title="${label}" aria-label="${label}"${extra}>${inner}</button>`;
  VIEWS.notes.sketch = () => {
    const page = skPage();
    if (page) SK.page = page.id;
    const pen = SK.tool === 'pen';
    const n = page ? page.strokes.length : 0,
      canUndo = !!page && (n > 0 || (SK.cleared && SK.cleared.id === page.id)),
      canRedo = !!page && SK.redo.length > 0;
    return {
      html:
        head('Sketchpad', 'Draw maps, layouts and ideas with the mouse or trackpad. Pages are saved with the board.') +
        `
    <div class="skpages" role="group" aria-label="Sketch pages">${S.sketches.map((p) => `<button type="button" class="skpg" data-skpg="${p.id}" aria-pressed="${p === page}">${esc(p.name)}</button>`).join('')}<button type="button" class="skpg sknew" id="skNew"${S.sketches.length >= SK_MAXP ? ' disabled' : ''}>+ New page</button></div>
    <div class="sktools">
      <div class="seg" role="group" aria-label="Tool">${skBtn('data-sktool="pen"', pen, 'Pen', 'Pen')}${skBtn('data-sktool="eraser"', !pen, 'Eraser', 'Eraser')}</div>
      <div class="skcols" role="group" aria-label="Colour">${SK_COLS.map(([k, l, v]) => skBtn(`data-skcol="${k}" class="skcol"`, pen && SK.col === k, l, '', ` style="--sw:var(${v})"`)).join('')}</div>
      <div class="seg" role="group" aria-label="Size">${SK_SIZES.map(([l, w], i) => skBtn(`data-sksize="${i}"`, SK.size === i, l, `<i class="skdot" style="--d:${Math.max(4, Math.round(w * 0.7))}px"></i>`)).join('')}</div>
      <span class="skgap"></span>
      <button class="btn sm ghost" type="button" id="skUndo"${canUndo ? '' : ' disabled'}>Undo</button><button class="btn sm ghost" type="button" id="skRedo"${canRedo ? '' : ' disabled'}>Redo</button>
      <button class="btn sm ghost" type="button" id="skClear"${n ? '' : ' disabled'}>Clear</button>
    </div>
    <div class="skwrap"><canvas class="skcv sk-${page ? page.bg : 'plain'}${pen ? '' : ' erase'}" id="skCv" role="img" aria-label="${page ? `Drawing: ${esc(page.name)}` : 'Empty drawing page'}"></canvas>${n ? '' : '<p class="skhint">Click and drag to draw</p>'}</div>
    ${
      page
        ? `<div class="skfoot"><label class="f">Page name<input type="text" id="skName" maxlength="80" value="${esc(page.name)}"></label>
      <label class="f">Paper<select id="skBg">${SK_BGS.map(([k, l]) => `<option value="${k}"${page.bg === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="skgap"></span><button class="btn sm" type="button" id="skPng"${n ? '' : ' disabled'}>Download PNG</button><button class="btn sm" type="button" id="skHo"${n ? '' : ' disabled'}>Make a handout</button><button class="btn sm ghost" type="button" id="skDel">Delete page</button></div>`
        : ''
    }`,
      bind: () => {
        const ov = $('overlay'),
          cv = $('skCv');
        skDraw(cv, page);
        if (window.ResizeObserver) {
          const ro = new ResizeObserver(() => {
            if (!cv.isConnected) {
              ro.disconnect();
              return;
            }
            if (!cv._live) skDraw(cv, skPage());
          });
          ro.observe(cv);
        }
        ov.querySelectorAll('[data-skpg]').forEach(
          (b) =>
            (b.onclick = () => {
              if (SK.page !== b.dataset.skpg) {
                SK.page = b.dataset.skpg;
                SK.redo = [];
              }
              drawSheet();
            })
        );
        $('skNew').onclick = () => {
          if (skNew()) commit();
        };
        ov.querySelectorAll('[data-sktool]').forEach(
          (b) =>
            (b.onclick = () => {
              SK.tool = b.dataset.sktool;
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-skcol]').forEach(
          (b) =>
            (b.onclick = () => {
              SK.col = b.dataset.skcol;
              SK.tool = 'pen';
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-sksize]').forEach(
          (b) =>
            (b.onclick = () => {
              SK.size = +b.dataset.sksize;
              drawSheet();
            })
        );
        $('skUndo').onclick = () => {
          const p = skPage();
          if (!p) return;
          if (!p.strokes.length && SK.cleared && SK.cleared.id === p.id) {
            p.strokes = SK.cleared.strokes;
            SK.cleared = null;
            commit();
            return;
          }
          if (p.strokes.length) {
            SK.redo.push(p.strokes.pop());
            commit();
          }
        };
        $('skRedo').onclick = () => {
          const p = skPage();
          if (p && SK.redo.length) {
            p.strokes.push(SK.redo.pop());
            commit();
          }
        };
        armDelete(
          $('skClear'),
          () => {
            const p = skPage();
            if (!p) return;
            SK.cleared = { id: p.id, strokes: p.strokes };
            SK.redo = [];
            p.strokes = [];
            commit();
            toast('Page cleared. Undo brings it back');
          },
          'Click again to clear'
        );
        if (page) {
          $('skName').onchange = (e) => {
            page.name = e.target.value.trim().slice(0, 80) || page.name;
            commit();
          };
          $('skBg').onchange = (e) => {
            page.bg = e.target.value;
            commit();
          };
          $('skPng').onclick = () => {
            const a = document.createElement('a');
            a.href = skPicture(page, 'image/png');
            a.download = (page.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'sketch') + '.png';
            document.body.appendChild(a);
            a.click();
            a.remove();
          };
          $('skHo').onclick = () => {
            const id = uid();
            IMGS[id] = skPicture(page, 'image/webp', 0.8);
            if (!saveImgs()) {
              delete IMGS[id];
              toast('Not enough browser storage for that picture. Save a backup and delete an old map image');
              return;
            }
            S.handouts.push({ id: uid(), title: page.name, body: '', img: id, shown: 0 });
            commit();
            toast(`“${page.name}” is now a handout. Show it from Notes → Handouts`);
          };
          armDelete(
            $('skDel'),
            () => {
              S.sketches = S.sketches.filter((p) => p.id !== page.id);
              SK.page = null;
              SK.redo = [];
              if (SK.cleared && SK.cleared.id === page.id) SK.cleared = null;
              commit();
              toast('Sketch page deleted. Ctrl+Z brings it back');
            },
            'Click again to delete'
          );
        }
        skBindDraw(cv);
      },
    };
  };
  // drawing with the mouse, trackpad or a pen; the stroke is saved when the button is let go
  function skBindDraw(cv) {
    let pts = null,
      ctx = null,
      pid = null,
      w = 0,
      erase = false;
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      return [
        clamp(Math.round(((e.clientX - r.left) / r.width) * SK_W), 0, SK_W),
        clamp(Math.round(((e.clientY - r.top) / r.height) * SK_H), 0, SK_H),
      ];
    };
    const seg = (a, b) => {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    cv.onpointerdown = (e) => {
      if (e.button !== 0 || pts) return;
      e.preventDefault();
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      pid = e.pointerId;
      cv._live = true;
      erase = SK.tool === 'eraser';
      w = SK_SIZES[SK.size][1] * (erase ? 3 : 1);
      ctx = skFit(cv);
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = erase ? '#000' : skInk()(SK.col);
      ctx.lineWidth = w;
      ctx.lineCap = ctx.lineJoin = 'round';
      const p = at(e);
      pts = [p];
      ctx.beginPath();
      ctx.arc(p[0], p[1], w / 2, 0, Math.PI * 2);
      ctx.fill();
      const h = cv.parentNode.querySelector('.skhint');
      h && h.remove();
    };
    cv.onpointermove = (e) => {
      if (!pts || e.pointerId !== pid) return;
      (e.getCoalescedEvents ? e.getCoalescedEvents() : []).concat([e]).forEach((ev) => {
        const p = at(ev),
          q = pts[pts.length - 1];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 2) return;
        seg(q, p);
        pts.push(p);
      });
    };
    const end = (e) => {
      if (!pts || e.pointerId !== pid) return;
      const done = pts;
      pts = null;
      cv._live = false;
      ctx.globalCompositeOperation = 'source-over';
      let page = skPage();
      if (!page) page = skNew();
      if (!page) {
        drawSheet();
        return;
      }
      if (page.strokes.length >= SK_MAXS) {
        toast('This page is full. Start a new page');
        drawSheet();
        return;
      }
      const flat = [];
      done.slice(0, SK_MAXN / 2).forEach((p) => flat.push(p[0], p[1]));
      page.strokes.push({ k: SK.col, w, e: erase, p: flat });
      SK.redo = [];
      if (SK.cleared && SK.cleared.id === page.id) SK.cleared = null;
      commit();
    };
    cv.onpointerup = end;
    cv.onpointercancel = end;
    cv.onlostpointercapture = end;
  }
  /* ---------- world tracking: factions, rumours, rulings and the timeline ---------- */
  const W_STAND = ['Hostile', 'Unfriendly', 'Indifferent', 'Friendly', 'Allied'];
  const W_STAND_PILL = { Hostile: 'dn', Unfriendly: 'bl', Indifferent: 'mut', Friendly: 'ok', Allied: 'ok' };
  const W_AREAS = ['Combat', 'Spells', 'Conditions', 'Movement', 'Skills', 'Rests', 'Items', 'Social', 'Other'];
  const W_TRUTH = { unknown: 'Undecided', true: 'True', partly: 'Partly true', false: 'False' };
  const W_TRUTH_PILL = { unknown: 'mut', true: 'ok', partly: 'bl', false: 'dn' };
  const W_RSTAT = ['open', 'made', 'dropped'];
  const W_KINDS = {
    session: 'Sessions',
    mission: 'Missions',
    deadline: 'Deadlines',
    front: 'Fronts',
    journey: 'Journeys',
    faction: 'Factions',
    history: 'History',
    manual: 'Notes',
  };
  const W_KIND1 = {
    session: 'Session',
    mission: 'Mission',
    deadline: 'Deadline',
    front: 'Front',
    journey: 'Journey',
    faction: 'Faction',
    history: 'History',
    manual: 'Note',
  };
  const W_MAX = { factions: 40, flog: 60, rumours: 300, rulings: 500, timeline: 1000 };
  // timeline label for an in-game day: the travel calendar's date when one is set, otherwise Day N
  function wDay(d) {
    if (d == null) return 'Before the campaign';
    try {
      if (typeof calDate === 'function') {
        const c = calDate(d);
        if (c) return String(c);
      }
    } catch (e) {}
    return `Day ${d}`;
  }
  function wNorm() {
    const npcs = new Set(S.npcs.map((x) => x.id)),
      places = new Set(S.places.map((x) => x.id)),
      mis = new Set(S.missions.map((x) => x.id)),
      frs = new Set((S.fronts || []).map((x) => x.id));
    const ids = (v, ok, max) => [...new Set(arr(v).map((x) => String(x)))].filter((x) => ok.has(x)).slice(0, max);
    S.factions = objs(S.factions)
      .map((f) => {
        fixId(f);
        return {
          id: f.id,
          name: str(f.name, 120).trim() || 'Faction',
          standing: W_STAND.includes(f.standing) ? f.standing : 'Indifferent',
          wants: str(f.wants, 300),
          notes: str(f.notes, 2000),
          npcs: ids(f.npcs, npcs, 60),
          missions: ids(f.missions, mis, 60),
          front: frs.has(f.front) ? f.front : '',
          log: objs(f.log)
            .map((e) => ({
              from: W_STAND.includes(e.from) ? e.from : '',
              to: W_STAND.includes(e.to) ? e.to : 'Indifferent',
              why: str(e.why, 200),
              sess: int(e.sess, 0, 0, 9999),
              day: int(e.day, 0, 0, 1e6),
            }))
            .slice(-W_MAX.flog),
        };
      })
      .slice(0, W_MAX.factions);
    const facs = new Set(S.factions.map((f) => f.id));
    const linkOk = (l) => {
      const m = /^(npc|place):(.+)$/.exec(String(l || ''));
      return !!m && (m[1] === 'npc' ? npcs : places).has(m[2]);
    };
    S.rumours = objs(S.rumours)
      .map((r) => {
        fixId(r);
        const text = str(r.text, 300).trim();
        if (!text) return null;
        const status = W_RSTAT.includes(r.status) ? r.status : 'open';
        return {
          id: r.id,
          text,
          src: str(r.src, 160),
          link: linkOk(r.link) ? String(r.link) : '',
          fac: facs.has(r.fac) ? r.fac : '',
          truth: W_TRUTH[r.truth] ? r.truth : 'unknown',
          notes: str(r.notes, 1000),
          sess: int(r.sess, 0, 0, 9999),
          day: int(r.day, 0, 0, 1e6),
          status,
          mission: status === 'made' && mis.has(r.mission) ? r.mission : '',
        };
      })
      .filter(Boolean)
      .slice(-W_MAX.rumours);
    S.rulings = objs(S.rulings)
      .map((r) => {
        fixId(r);
        const text = str(r.text, 1000).trim();
        return text
          ? {
              id: r.id,
              text,
              area: W_AREAS.includes(r.area) ? r.area : 'Other',
              sess: int(r.sess, 0, 0, 9999),
              day: int(r.day, 0, 0, 1e6),
            }
          : null;
      })
      .filter(Boolean)
      .slice(-W_MAX.rulings);
    S.timeline = objs(S.timeline)
      .map((e) => {
        fixId(e);
        const text = str(e.text, 300).trim();
        if (!text) return null;
        const hist = e.day == null || e.day === '' || e.kind === 'history';
        return {
          id: e.id,
          day: hist ? null : int(e.day, 1, 1, 1e6),
          when: hist ? str(e.when, 80) : '',
          min: hist ? -1 : int(e.min, -1, -1, 1439),
          text,
          kind: hist ? 'history' : W_KINDS[e.kind] && e.kind !== 'history' ? e.kind : 'manual',
          sess: int(e.sess, 0, 0, 9999),
          dm: !!e.dm,
        };
      })
      .filter(Boolean)
      .slice(-W_MAX.timeline);
  }
  const wHas = () => ['factions', 'rumours', 'rulings', 'timeline'].some((k) => (S[k] || []).length > 0);
  // add an in-game event to the timeline, dated now
  function wTL(text, kind, dm) {
    const L = S.timeline || (S.timeline = []);
    L.push({
      id: uid(),
      day: S.time.day,
      when: '',
      min: S.time.min,
      text: String(text).slice(0, 300),
      kind,
      sess: +S.dm.session || 0,
      dm: !!dm,
    });
    if (L.length > W_MAX.timeline) {
      const i = L.findIndex((e) => e.kind !== 'history' && e.kind !== 'manual');
      L.splice(i < 0 ? 0 : i, 1);
    }
  }
  // tonight's log lines that also belong on the timeline (journey lines come from the travel package)
  const W_LOGTL = [
    [/^Mission complete: /, 'mission'],
    [/^Mission failed: /, 'mission'],
    [/^Deadline passed: /, 'deadline'],
    [/^Doom falls, /, 'front', 1],
    [/^Front averted: /, 'front', 1],
    [/^Standing with /, 'faction'],
    [/^(Journey started: |Journey encounter |Arrived at )/, 'journey'],
  ];
  function wOnLog(text, auto) {
    if (!auto || !S || !S.time) return;
    const t = String(text);
    const hit = W_LOGTL.find(([re]) => re.test(t));
    if (hit) wTL(t, hit[1], hit[2]);
  }
  // show a popup once nothing else is showing (a deadline popup or another card may be up)
  function wAsk(fn) {
    let n = 0;
    const go = () => {
      if ($('mcard') && n++ < 240) {
        setTimeout(go, 500);
        return;
      }
      fn();
    };
    setTimeout(go, 350);
  }

  /* factions */
  function wShift(f, to, why) {
    const from = f.standing;
    if (!W_STAND.includes(to) || from === to) return false;
    f.standing = to;
    why = String(why || '')
      .trim()
      .slice(0, 200);
    f.log.push({ from, to, why, sess: +S.dm.session || 0, day: S.time.day });
    if (f.log.length > W_MAX.flog) f.log.splice(0, f.log.length - W_MAX.flog);
    tlog(`Standing with ${f.name}: ${from} → ${to}${why ? ` (${why})` : ''}.`, true);
    return true;
  }
  function wShiftPop(f, to) {
    const up = W_STAND.indexOf(to) > W_STAND.indexOf(f.standing);
    const el = popup(
      'Shift standing',
      popHead(
        `${f.name}: ${f.standing} → ${to}`,
        'Why did their standing change? It goes in the faction’s history, tonight’s log and the timeline.'
      ) +
        `
    <label class="f">Reason<input type="text" id="wsWhy" maxlength="200" placeholder="${up ? 'The party returned their stolen cargo' : 'The party killed one of their agents'}"></label>
    <div class="row end"><button class="btn ghost" type="button" data-mclose>Cancel</button><button class="btn pri" type="button" id="wsGo">Shift standing</button></div>`
    );
    const go = () => {
      const x = S.factions.find((y) => y.id === f.id);
      if (x && wShift(x, to, el.querySelector('#wsWhy').value)) {
        commit();
        toast(`${x.name} now ${to}`);
      }
      el.remove();
    };
    el.querySelector('#wsGo').onclick = go;
    el.querySelector('#wsWhy').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    };
    el.querySelector('#wsWhy').focus();
  }
  // finishing or failing a mission tied to a faction asks whether their standing moves
  function wMissionEnd(m) {
    if (!m || (m.status !== 'done' && m.status !== 'failed')) return;
    const fs = (S.factions || []).filter((f) => f.missions.includes(m.id));
    if (!fs.length) return;
    const id = m.id;
    wAsk(() => {
      const mm = S.missions.find((x) => x.id === id);
      if (!mm || (mm.status !== 'done' && mm.status !== 'failed')) return;
      const facs = S.factions.filter((f) => f.missions.includes(id));
      if (!facs.length) return;
      const pick = {};
      facs.forEach((f) => (pick[f.id] = f.standing));
      const won = mm.status === 'done';
      const el = popup(
        'Shift standing',
        popHead(
          `Shift standing with ${facs.map((f) => f.name).join(' and ')}?`,
          `${esc(mm.title)} was ${won ? 'completed' : 'failed'}. Pick a new standing, or leave it as it is.`
        ) +
          `
      <div class="list tight">${facs
        .map(
          (
            f
          ) => `<div class="item"><div class="row between"><strong>${esc(f.name)}</strong><span class="meta">Now ${esc(f.standing)}</span></div>
        <div class="seg wtrack" role="group" aria-label="Standing with ${esc(f.name)}">${W_STAND.map((s) => `<button type="button" data-wmp="${f.id}" data-to="${s}" aria-pressed="${s === f.standing}">${s}</button>`).join('')}</div></div>`
        )
        .join('')}</div>
      <label class="f">Reason<input type="text" id="wmWhy" maxlength="200" value="${esc(`${won ? 'Completed' : 'Failed'}: ${mm.title}`.slice(0, 200))}"></label>
      <div class="row end"><button class="btn ghost" type="button" data-mclose id="wmNo">No change</button><button class="btn pri" type="button" id="wmGo">Save</button></div>`
      );
      el.querySelectorAll('[data-wmp]').forEach(
        (b) =>
          (b.onclick = () => {
            pick[b.dataset.wmp] = b.dataset.to;
            el.querySelectorAll(`[data-wmp="${b.dataset.wmp}"]`).forEach((x) =>
              x.setAttribute('aria-pressed', String(x === b))
            );
          })
      );
      el.querySelector('#wmGo').onclick = () => {
        const why = el.querySelector('#wmWhy').value;
        let n = 0;
        S.factions.forEach((f) => {
          if (pick[f.id] && wShift(f, pick[f.id], why)) n++;
        });
        el.remove();
        if (n) {
          commit();
          toast(n > 1 ? `${n} factions shifted` : 'Standing shifted');
        }
      };
      el.querySelector('#wmGo').focus();
    });
  }
  let W_FLOG = '';
  const wChecks = (name, list, sel, lab) =>
    list.length
      ? `<div class="f"><span>${name}</span><div class="toggles wchecks">${list.map((o) => `<label><input type="checkbox" data-${name.toLowerCase() === 'members' ? 'wfn' : 'wfm'}="${o.id}"${sel.includes(o.id) ? ' checked' : ''}>${esc(lab(o))}</label>`).join('')}</div></div>`
      : '';
  function wFacCard(f) {
    const npcs = f.npcs.map((id) => S.npcs.find((n) => n.id === id)).filter(Boolean),
      ms = f.missions.map((id) => S.missions.find((m) => m.id === id)).filter(Boolean),
      fr = f.front && S.fronts.find((x) => x.id === f.front);
    const open = W_FLOG === f.id,
      lg = f.log.slice().reverse(),
      shown = open ? lg : lg.slice(0, 3);
    return `<div class="item wfac" id="wf-${f.id}"><div class="row between"><strong>${esc(f.name)}</strong><span class="pill ${W_STAND_PILL[f.standing]}">${esc(f.standing)}</span></div>
    <div class="seg wtrack" role="group" aria-label="Standing with ${esc(f.name)}">${W_STAND.map((s) => `<button type="button" data-wst="${f.id}" data-to="${s}" aria-pressed="${s === f.standing}" title="${s === f.standing ? 'Where they stand now' : `Shift to ${s}`}">${s}</button>`).join('')}</div>
    ${f.wants ? `<div class="meta">Wants: ${esc(f.wants)}</div>` : ''}${f.notes ? `<p>${esc(f.notes)}</p>` : ''}
    ${npcs.length ? `<div class="meta">Members: ${npcs.map((n) => `${esc(n.name)}${n.attitude && n.attitude !== 'Unknown' ? ` (${esc(n.attitude)})` : ''}`).join(', ')}</div>` : ''}
    ${ms.length ? `<div class="meta">Missions: ${ms.map((m) => `${esc(m.title)} (${esc(MS[m.status][0].toLowerCase())})`).join(', ')}</div>` : ''}
    ${fr ? `<div class="meta">Front: ${esc(fr.name)}</div>` : ''}
    ${lg.length ? `<ul class="wflog">${shown.map((e) => `<li>${e.sess ? `Session ${e.sess} · ` : ''}${e.from ? `${esc(e.from)} → ` : ''}${esc(e.to)}${e.why ? ` · ${esc(e.why)}` : ''}</li>`).join('')}</ul>${lg.length > 3 ? `<button class="lnk" type="button" data-wflog="${f.id}">${open ? 'Show fewer' : `All ${lg.length} changes`}</button>` : ''}` : ''}
    <div class="row end">${editBtn('factions', f.id)}<button class="btn sm ghost" type="button" data-wfdel="${f.id}">Delete</button></div></div>`;
  }
  VIEWS.notes.factions = () => {
    const o = editing('factions');
    const st = o ? o.standing : 'Indifferent';
    const form = `<div class="box ${o ? 'editing' : ''}"><div class="grid">
      <label class="f">Faction<input type="text" id="wfN" maxlength="120" placeholder="The Zhentarim" value="${ev(o, 'name')}"></label>
      <label class="f">Standing with the party<select id="wfS">${W_STAND.map((s) => `<option${s === st ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f" style="grid-column:1/-1">What they want<input type="text" id="wfW" maxlength="300" placeholder="Control of the salt trade through Saltreach" value="${ev(o, 'wants')}"></label></div>
    <label class="f">Notes<textarea id="wfNo" maxlength="2000" placeholder="Who leads them, where they meet, what they offer">${ev(o, 'notes')}</textarea></label>
    ${wChecks('Members', S.npcs, o ? o.npcs : [], (n) => n.name)}${wChecks('Missions', S.missions, o ? o.missions : [], (m) => m.title)}
    ${S.fronts.length ? `<label class="f">Front<select id="wfF"><option value="">None</option>${S.fronts.map((x) => `<option value="${x.id}"${o && o.front === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    <p class="quiet">Completing or failing a ticked mission asks whether their standing shifts.</p>
    ${formBtns(o, 'wfAdd', 'Add faction')}</div>`;
    const list = S.factions.length
      ? `<div class="list">${S.factions.map(wFacCard).join('')}</div>`
      : '<div class="empty">No factions yet. Guilds, cults, noble houses, the town watch: anyone the party can win over or cross.</div>';
    return {
      html:
        head(
          'Factions',
          'Groups with their own goals, and where the party stands with each. Click a step on the track to shift their standing.'
        ) + (o || !S.factions.length ? form + list : list + form),
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        $('wfAdd').onclick = () => {
          const n = val('wfN');
          if (!n) {
            toast('Name the faction first');
            return;
          }
          const fields = {
            name: n.slice(0, 120),
            wants: val('wfW').slice(0, 300),
            notes: $('wfNo').value.trim().slice(0, 2000),
            npcs: [...ov.querySelectorAll('[data-wfn]:checked')].map((x) => x.dataset.wfn),
            missions: [...ov.querySelectorAll('[data-wfm]:checked')].map((x) => x.dataset.wfm),
            front: $('wfF') ? val('wfF') : '',
          };
          const to = val('wfS');
          if (o) {
            if (to !== o.standing) wShift(o, to, 'Set by hand');
            upsert('factions', o, fields);
          } else
            upsert('factions', null, { ...fields, standing: W_STAND.includes(to) ? to : 'Indifferent' }, { log: [] });
        };
        ov.querySelectorAll('[data-wst]').forEach(
          (b) =>
            (b.onclick = () => {
              const f = S.factions.find((x) => x.id === b.dataset.wst);
              if (f && b.dataset.to !== f.standing) wShiftPop(f, b.dataset.to);
            })
        );
        ov.querySelectorAll('[data-wflog]').forEach(
          (b) =>
            (b.onclick = () => {
              W_FLOG = W_FLOG === b.dataset.wflog ? '' : b.dataset.wflog;
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-wfdel]').forEach((b) =>
          armDelete(
            b,
            () => {
              const id = b.dataset.wfdel;
              S.factions = S.factions.filter((x) => x.id !== id);
              S.rumours.forEach((r) => {
                if (r.fac === id) r.fac = '';
              });
              commit();
              toast('Faction deleted. Ctrl+Z brings it back');
            },
            'Confirm'
          )
        );
      },
    };
  };
  const wMissionFac = (m) => {
    const fs = (S.factions || []).filter((f) => f.missions.includes(m.id));
    return fs.length
      ? `<div class="meta">Faction: ${fs.map((f) => `${esc(f.name)} (${esc(f.standing)})`).join(', ')}</div>`
      : '';
  };

  /* rumours */
  const wSrcName = (r) => linkName(r.link) || r.src;
  function wAddRumour(fields) {
    const r = {
      id: uid(),
      text: '',
      src: '',
      link: '',
      fac: '',
      truth: 'unknown',
      notes: '',
      sess: +S.dm.session || 0,
      day: S.time.day,
      status: 'open',
      mission: '',
      ...fields,
    };
    S.rumours.push(r);
    if (S.rumours.length > W_MAX.rumours) S.rumours.splice(0, S.rumours.length - W_MAX.rumours);
    if (S.tonight.started) tlog(`New rumour: ${r.text}${wSrcName(r) ? ` (from ${wSrcName(r)})` : ''}`, true);
    return r;
  }
  function wMakeMission(r) {
    const nm = r.link.startsWith('npc:') ? linkName(r.link) : '',
      pl = r.link.startsWith('place:') ? linkName(r.link) : '';
    const m = {
      id: uid(),
      title: r.text.slice(0, 160),
      giver: (nm || r.src).slice(0, 160),
      where: pl.slice(0, 160),
      reward: '',
      notes: [r.notes, wSrcName(r) && `Heard from ${wSrcName(r)}${r.sess ? ` in session ${r.sess}` : ''}.`]
        .filter(Boolean)
        .join('\n')
        .slice(0, 20000),
      status: 'active',
      clues: [],
      due: null,
      ifIgnored: '',
      dueFired: false,
    };
    S.missions.push(m);
    const f = r.fac && S.factions.find((x) => x.id === r.fac);
    if (f && !f.missions.includes(m.id)) f.missions.push(m.id);
    r.status = 'made';
    r.mission = m.id;
    return m;
  }
  // a mission the party ignored goes back on the rumour board
  function wFileBack(m) {
    const npc = S.npcs.find((n) => sameName(n.name, m.giver)),
      pl = S.places.find((p) => sameName(p.name, m.where));
    const f = S.factions.find((x) => x.missions.includes(m.id));
    const r = wAddRumour({
      text: m.title.slice(0, 300),
      src: npc ? '' : m.giver.slice(0, 160),
      link: npc ? `npc:${npc.id}` : pl ? `place:${pl.id}` : '',
      fac: f ? f.id : '',
      notes: [m.where && !pl && `Where: ${m.where}`, m.reward && `Reward: ${m.reward}`, m.notes]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1000),
    });
    untieClues('mission', m.id);
    S.fronts.forEach((x) => {
      if (x.mission === m.id) x.mission = '';
    });
    S.secrets.forEach((s) => {
      if (s.link === `mission:${m.id}`) s.link = '';
    });
    S.factions.forEach((x) => {
      x.missions = x.missions.filter((id) => id !== m.id);
    });
    S.missions = S.missions.filter((x) => x.id !== m.id);
    return r;
  }
  const wFileBtn = (m) =>
    m.status === 'active' || m.status === 'hold'
      ? `<button class="btn sm ghost" type="button" data-wfile="${m.id}" title="The party passed on it. Keep it as a rumour instead">File as rumour</button>`
      : '';
  function wBindMissions(ov) {
    ov.querySelectorAll('[data-wfile]').forEach((b) =>
      armDelete(
        b,
        () => {
          const m = S.missions.find((x) => x.id === b.dataset.wfile);
          if (!m) return;
          wFileBack(m);
          commit();
          toast('Filed under Rumours. Ctrl+Z puts the mission back');
        },
        'Confirm: file as rumour'
      )
    );
  }
  const wSrcOptions = (sel) =>
    `<option value="">Nobody in particular</option>${[
      ['NPCs', 'npc', S.npcs],
      ['Places', 'place', S.places],
    ]
      .filter((g) => g[2].length)
      .map(
        ([lb, k, list]) =>
          `<optgroup label="${lb}">${list.map((o) => `<option value="${k}:${o.id}"${sel === `${k}:${o.id}` ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</optgroup>`
      )
      .join('')}`;
  function wRumCard(r) {
    const fac = r.fac && S.factions.find((f) => f.id === r.fac),
      mm = r.mission && S.missions.find((m) => m.id === r.mission);
    return `<div class="item wrum" id="wr-${r.id}"><div class="row between"><strong>${esc(r.text)}</strong><span class="pill ${W_TRUTH_PILL[r.truth]}" title="Only you see this">${W_TRUTH[r.truth]}</span></div>
    <div class="meta">${[wSrcName(r) && `From ${esc(wSrcName(r))}`, r.sess && `Heard in session ${r.sess}`, fac && `Faction: ${esc(fac.name)}`].filter(Boolean).join(' · ') || 'No source yet'}</div>
    ${r.notes ? `<p>${esc(r.notes)}</p>` : ''}${r.status === 'made' ? `<div class="meta">Became the mission ${mm ? esc(mm.title) : '(since deleted)'}</div>` : ''}
    <div class="row end">${r.status === 'open' ? `<button class="btn sm" type="button" data-wmk="${r.id}">Make mission</button><button class="btn sm ghost" type="button" data-wdrop="${r.id}">Drop</button>` : r.status === 'dropped' ? `<button class="btn sm ghost" type="button" data-wback="${r.id}">Bring back</button>` : ''}
      ${editBtn('rumours', r.id)}<button class="btn sm ghost" type="button" data-wrdel="${r.id}">Delete</button></div></div>`;
  }
  VIEWS.mission.rumours = () => {
    const o = editing('rumours');
    const open = S.rumours.filter((r) => r.status === 'open').reverse(),
      made = S.rumours.filter((r) => r.status === 'made').reverse(),
      drop = S.rumours.filter((r) => r.status === 'dropped').reverse();
    const form = `<div class="box ${o ? 'editing' : ''}"><div class="grid">
      <label class="f" style="grid-column:1/-1">Rumour<input type="text" id="wrT" maxlength="300" placeholder="False beacons have been seen on Gull Rock" value="${ev(o, 'text')}"></label>
      <label class="f">Heard from<select id="wrL">${wSrcOptions(o ? o.link : '')}</select></label>
      <label class="f">Or another source<input type="text" id="wrS" maxlength="160" placeholder="Tavern gossip" value="${ev(o, 'src')}"></label>
      <label class="f">Is it true? (only you see this)<select id="wrTr">${Object.entries(W_TRUTH)
        .map(([k, l]) => `<option value="${k}"${(o ? o.truth : 'unknown') === k ? ' selected' : ''}>${l}</option>`)
        .join('')}</select></label>
      ${S.factions.length ? `<label class="f">Faction<select id="wrF"><option value="">None</option>${S.factions.map((f) => `<option value="${f.id}"${o && o.fac === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>` : ''}
      <label class="f" style="grid-column:1/-1">DM notes<input type="text" id="wrN" maxlength="1000" placeholder="What is really going on" value="${ev(o, 'notes')}"></label></div>
    <p class="quiet">Tip: a Quick note (J) that starts with “Rumour:” is filed here too.</p>
    ${formBtns(o, 'wrAdd', 'Add rumour')}</div>`;
    const list = `${open.length ? `<div class="list">${open.map(wRumCard).join('')}</div>` : '<div class="empty">No open rumours. Add the hooks the party hears but hasn’t chased yet.</div>'}
    ${made.length ? `<h4 class="eyebrow">Followed up</h4><div class="list">${made.map(wRumCard).join('')}</div>` : ''}
    ${drop.length ? `<h4 class="eyebrow">Dropped</h4><div class="list">${drop.map(wRumCard).join('')}</div>` : ''}`;
    return {
      html:
        head('Rumours', 'Hooks the party has heard but not taken up. Make one a mission when they bite.') +
        (o || !S.rumours.length ? form + list : list + form),
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        $('wrAdd').onclick = () => {
          const t = val('wrT');
          if (!t) {
            toast('Write the rumour first');
            return;
          }
          const l = val('wrL');
          const fields = {
            text: t.slice(0, 300),
            src: val('wrS').slice(0, 160),
            link: /^(npc|place):/.test(l) ? l : '',
            truth: W_TRUTH[val('wrTr')] ? val('wrTr') : 'unknown',
            fac: $('wrF') ? val('wrF') : '',
            notes: val('wrN').slice(0, 1000),
          };
          if (o) upsert('rumours', o, fields);
          else {
            clearExample('rumours');
            wAddRumour(fields);
            commit();
            toast('Rumour added');
          }
        };
        ov.querySelectorAll('[data-wmk]').forEach(
          (b) =>
            (b.onclick = () => {
              const r = S.rumours.find((x) => x.id === b.dataset.wmk);
              if (!r) return;
              const m = wMakeMission(r);
              EDIT = { k: 'missions', id: m.id };
              view.sub = 'new';
              commit();
              toast('Mission made from the rumour. Add a reward or deadline, then save');
            })
        );
        ov.querySelectorAll('[data-wdrop]').forEach(
          (b) =>
            (b.onclick = () => {
              const r = S.rumours.find((x) => x.id === b.dataset.wdrop);
              if (r) {
                r.status = 'dropped';
                commit();
              }
            })
        );
        ov.querySelectorAll('[data-wback]').forEach(
          (b) =>
            (b.onclick = () => {
              const r = S.rumours.find((x) => x.id === b.dataset.wback);
              if (r) {
                r.status = 'open';
                commit();
              }
            })
        );
        ov.querySelectorAll('[data-wrdel]').forEach((b) =>
          armDelete(
            b,
            () => {
              S.rumours = S.rumours.filter((x) => x.id !== b.dataset.wrdel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };

  /* rulings */
  const W_GUESS = [
    [
      'Conditions',
      /\b(prone|stun|paraly|charm|frighten|poison|blind|deafen|invisib|restrain|grappled|incapacit|exhaust|unconscious|petrif|condition)/i,
    ],
    ['Spells', /\b(spell|cast|concentrat|slot|cantrip|ritual|counterspell|component)/i],
    ['Movement', /\b(move|moving|speed|jump|climb|swim|fly|flying|terrain|fall|falling|squeez|mount)/i],
    ['Rests', /\b(rest|hit dic|hit die|sleep|watch)/i],
    ['Items', /\b(item|potion|weapon|armou?r|shield|attun|scroll|wand|carry|equip|ammo|ammunition)/i],
    ['Skills', /\b(check|skill|stealth|percept|insight|persua|athlet|acrobat|hide|hiding|search|investigat|tool)/i],
    ['Social', /\b(npc|attitude|influence|bargain|haggle|intimidat|decept)/i],
    [
      'Combat',
      /\b(attack|hit|damage|crit|grapple|shove|opportunity|initiative|cover|flank|reaction|bonus action|ac\b|surprise)/i,
    ],
  ];
  const wGuessArea = (t) => (W_GUESS.find(([, re]) => re.test(t)) || ['Other'])[0];
  function wAddRuling(text, area) {
    const r = {
      id: uid(),
      text: String(text).slice(0, 1000),
      area: W_AREAS.includes(area) ? area : wGuessArea(text),
      sess: +S.dm.session || 0,
      day: S.time.day,
    };
    S.rulings.push(r);
    if (S.rulings.length > W_MAX.rulings) S.rulings.splice(0, S.rulings.length - W_MAX.rulings);
    return r;
  }
  // Quick note lines that start with "Ruling:" or "Rumour:" are filed straight into their lists
  function wJot(t) {
    const m = /^\s*(rulings?|rumou?rs?)\s*[:\-–—]\s*([\s\S]+)$/i.exec(String(t));
    if (!m || !m[2].trim()) return '';
    const body = m[2].trim();
    if (/^rul/i.test(m[1])) {
      const r = wAddRuling(body);
      return `Filed in Notes › Rulings under ${r.area}`;
    }
    wAddRumour({ text: body.slice(0, 300) });
    return 'Filed in Missions › Rumours';
  }
  let W_RA = 'all',
    W_RQ = '';
  const wRulRow = (r) =>
    `<div class="item wrul" data-wrq="${esc([r.text, r.area].join(' ').toLowerCase())}"><p style="color:var(--ink);margin:0">${esc(r.text)}</p><div class="row between"><span class="meta">${esc(r.area)}${r.sess ? ` · Session ${r.sess}` : ''}</span><span class="row">${editBtn('rulings', r.id)}<button class="btn sm ghost" type="button" data-wudel="${r.id}">Delete</button></span></div></div>`;
  VIEWS.notes.rulings = () => {
    const o = editing('rulings');
    const areas = W_AREAS.filter((a) => S.rulings.some((r) => r.area === a));
    if (W_RA !== 'all' && !areas.includes(W_RA)) W_RA = 'all';
    const list = S.rulings.filter((r) => W_RA === 'all' || r.area === W_RA).reverse();
    const form = `<div class="box ${o ? 'editing' : ''}"><label class="f">Ruling<textarea id="wuT" maxlength="1000" placeholder="You can use a bonus action to stand from prone with a successful DC 10 Acrobatics check">${ev(o, 'text')}</textarea></label>
    <div class="grid"><label class="f">Rule area<select id="wuA"><option value="">Guess from the text</option>${W_AREAS.map((a) => `<option${o && o.area === a ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
      <label class="f">Session<input type="number" id="wuS" min="0" max="9999" value="${o ? o.sess : +S.dm.session}"></label></div>
    ${formBtns(o, 'wuAdd', 'Add ruling')}</div>`;
    const body = S.rulings.length
      ? `<div class="box rowbox"><input type="search" id="wuQ" placeholder="Find a ruling" aria-label="Find a ruling" value="${esc(W_RQ)}" style="flex:1;min-width:0">
      ${areas.length > 1 ? `<div class="seg" role="group" aria-label="Rule area"><button type="button" data-wua="all" aria-pressed="${W_RA === 'all'}">All</button>${areas.map((a) => `<button type="button" data-wua="${a}" aria-pressed="${W_RA === a}">${a}</button>`).join('')}</div>` : ''}</div>
    <div class="list" id="wuList">${list.map(wRulRow).join('')}</div><div class="empty" id="wuNone" hidden>No ruling matches.</div>`
      : '<div class="empty">No rulings yet. When you make a call at the table, press J and type “Ruling: …”, and it lands here.</div>';
    return {
      html:
        head(
          'Rulings',
          'Calls you made at the table, so the next one matches. They also show at the top of Quick rules.'
        ) + (o || !S.rulings.length ? form + body : body + form),
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        $('wuAdd').onclick = () => {
          const t = $('wuT').value.trim();
          if (!t) {
            toast('Write the ruling first');
            return;
          }
          const a = val('wuA'),
            s = clamp(Math.round(+val('wuS') || 0), 0, 9999);
          if (o)
            upsert('rulings', o, { text: t.slice(0, 1000), area: W_AREAS.includes(a) ? a : wGuessArea(t), sess: s });
          else {
            const r = wAddRuling(t, a);
            r.sess = s;
            commit();
            toast(`Ruling filed under ${r.area}`);
          }
        };
        ov.querySelectorAll('[data-wua]').forEach(
          (b) =>
            (b.onclick = () => {
              W_RA = b.dataset.wua;
              drawSheet();
            })
        );
        const q = $('wuQ');
        if (q) {
          const run = () => {
            W_RQ = q.value;
            const s = q.value.trim().toLowerCase();
            let n = 0;
            ov.querySelectorAll('[data-wrq]').forEach((r) => {
              const on = !s || r.dataset.wrq.includes(s);
              r.hidden = !on;
              if (on) n++;
            });
            $('wuNone').hidden = n > 0;
          };
          q.oninput = run;
          run();
        }
        ov.querySelectorAll('[data-wudel]').forEach((b) =>
          armDelete(
            b,
            () => {
              S.rulings = S.rulings.filter((x) => x.id !== b.dataset.wudel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };
  // "Your rulings" at the top of Quick rules
  function wRulesTop() {
    const L = (S.rulings || []).slice(-6).reverse();
    if (!L.length) return '';
    return `<div class="box wyr"><div class="row between"><h4>Your rulings</h4><button class="lnk" type="button" data-wgo="rulings">${S.rulings.length > 6 ? `All ${S.rulings.length} rulings` : 'Open Rulings'}</button></div>
    <ul class="wflog">${L.map((r) => `<li><strong>${esc(r.area)}</strong> ${esc(r.text)}</li>`).join('')}</ul></div>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-wgo]');
    if (b) {
      e.preventDefault();
      openSheet('notes', b.dataset.wgo);
    }
  });

  /* timeline */
  let W_TK = 'all',
    W_TQ = '',
    W_THIST = false;
  function wSortTL() {
    return S.timeline
      .map((e, i) => [e, i])
      .sort((a, c) => {
        const A = a[0],
          C = c[0];
        if ((A.day == null) !== (C.day == null)) return A.day == null ? -1 : 1;
        if (A.day !== C.day) return (A.day || 0) - (C.day || 0);
        if (A.min !== C.min) return A.min - C.min;
        return a[1] - c[1];
      })
      .map((x) => x[0]);
  }
  VIEWS.notes.timeline = () => {
    const o = editing('timeline');
    const hist = o ? o.day == null : W_THIST;
    const kinds = Object.keys(W_KINDS).filter((k) => S.timeline.some((e) => e.kind === k));
    if (W_TK !== 'all' && !kinds.includes(W_TK)) W_TK = 'all';
    const list = wSortTL().filter((e) => W_TK === 'all' || e.kind === W_TK);
    const groups = [];
    list.forEach((e) => {
      const k = e.day == null ? 'h' : String(e.day);
      const g = groups[groups.length - 1];
      if (g && g.k === k) g.items.push(e);
      else groups.push({ k, label: wDay(e.day), items: [e] });
    });
    const form = `<div class="box ${o ? 'editing' : ''}"><label class="f">What happened<input type="text" id="wtT" maxlength="300" placeholder="A storm drowned the old chapel and half the town" value="${ev(o, 'text')}"></label>
    <div class="grid"><label class="f">When<select id="wtH"><option value="0"${hist ? '' : ' selected'}>During the campaign</option><option value="1"${hist ? ' selected' : ''}>Before the campaign</option></select></label>
      <label class="f" id="wtDayF"${hist ? ' hidden' : ''}>Day<input type="number" id="wtD" min="1" value="${o && o.day != null ? o.day : S.time.day}"></label>
      <label class="f" id="wtWhenF"${hist ? '' : ' hidden'}>Date or era<input type="text" id="wtW" maxlength="80" placeholder="300 years ago" value="${ev(o, 'when')}"></label></div>
    <div class="toggles"><label><input type="checkbox" id="wtDm"${o && o.dm ? ' checked' : ''}>DM only (the players don’t know this yet)</label></div>
    ${formBtns(o, 'wtAdd', 'Add to timeline')}</div>`;
    const body = S.timeline.length
      ? `<div class="box rowbox"><input type="search" id="wtQ" placeholder="Find an event" aria-label="Find an event" value="${esc(W_TQ)}" style="flex:1;min-width:0">
      ${kinds.length > 1 ? `<div class="seg" role="group" aria-label="Show">${[['all', 'All'], ...kinds.map((k) => [k, W_KINDS[k]])].map(([k, l]) => `<button type="button" data-wtk="${k}" aria-pressed="${W_TK === k}">${l}</button>`).join('')}</div>` : ''}</div>
    <div class="wtl">${groups
      .map(
        (g) =>
          `<section class="wtlg" data-wtg><h4 class="eyebrow">${esc(g.label)}</h4><div class="list">${g.items
            .map(
              (
                e
              ) => `<div class="item" data-wtq="${esc([e.text, e.when, W_KIND1[e.kind]].join(' ').toLowerCase())}"><div class="row between"><span style="color:var(--ink)">${e.when ? `<strong>${esc(e.when)}</strong> · ` : ''}${esc(e.text)}</span><span class="row">${e.dm ? '<span class="pill bl">DM only</span>' : ''}<span class="pill mut">${W_KIND1[e.kind]}</span></span></div>
      <div class="row between"><span class="meta">${[e.min >= 0 && fmtTime(e.min), e.sess && `Session ${e.sess}`].filter(Boolean).join(' · ')}</span><span class="row">${editBtn('timeline', e.id)}<button class="btn sm ghost" type="button" data-wtdel="${e.id}">Delete</button></span></div></div>`
            )
            .join('')}</div></section>`
      )
      .join('')}</div>
    <div class="empty" id="wtNone" hidden>No event matches.</div>`
      : '<div class="empty">Nothing on the timeline yet. Wrapped sessions, finished missions, Fronts reaching doom, passed deadlines, journeys and faction shifts land here by themselves. Add your world’s history too.</div>';
    return {
      html: head('Timeline', 'What happened when in your world, oldest first.') + (o ? form + body : body + form),
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        $('wtH').onchange = (e) => {
          W_THIST = e.target.value === '1';
          $('wtDayF').hidden = W_THIST;
          $('wtWhenF').hidden = !W_THIST;
        };
        $('wtAdd').onclick = () => {
          const t = val('wtT');
          if (!t) {
            toast('Say what happened first');
            return;
          }
          const h = val('wtH') === '1';
          const d = clamp(Math.round(+val('wtD') || S.time.day), 1, 1e6);
          const fields = h
            ? { day: null, when: val('wtW').slice(0, 80), min: -1, kind: 'history' }
            : {
                day: d,
                when: '',
                ...(o && o.day === d ? {} : { min: -1 }),
                kind: o && o.kind !== 'history' ? o.kind : 'manual',
              };
          if (o) upsert('timeline', o, { text: t.slice(0, 300), dm: $('wtDm').checked, ...fields });
          else
            upsert('timeline', null, {
              text: t.slice(0, 300),
              dm: $('wtDm').checked,
              sess: h ? 0 : +S.dm.session || 0,
              ...fields,
            });
        };
        ov.querySelectorAll('[data-wtk]').forEach(
          (b) =>
            (b.onclick = () => {
              W_TK = b.dataset.wtk;
              drawSheet();
            })
        );
        const q = $('wtQ');
        if (q) {
          const run = () => {
            W_TQ = q.value;
            const s = q.value.trim().toLowerCase();
            let n = 0;
            ov.querySelectorAll('[data-wtg]').forEach((g) => {
              let k = 0;
              g.querySelectorAll('[data-wtq]').forEach((r) => {
                const on = !s || r.dataset.wtq.includes(s);
                r.hidden = !on;
                if (on) k++;
              });
              g.hidden = !k;
              n += k;
            });
            $('wtNone').hidden = n > 0;
          };
          q.oninput = run;
          run();
        }
        ov.querySelectorAll('[data-wtdel]').forEach((b) =>
          armDelete(
            b,
            () => {
              S.timeline = S.timeline.filter((x) => x.id !== b.dataset.wtdel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };

  /* search */
  function wSearch(add) {
    S.factions.forEach((f) =>
      add(
        'Faction',
        f.name,
        [f.standing, f.wants].filter(Boolean).join(' · '),
        ['notes', 'factions', f.id, 'factions'],
        [f.name, f.wants, f.notes, f.standing, ...f.log.map((e) => e.why)]
      )
    );
    S.rumours.forEach((r) =>
      add(
        'Rumour',
        r.text,
        [wSrcName(r) && `From ${wSrcName(r)}`, W_TRUTH[r.truth]].filter(Boolean).join(' · '),
        ['mission', 'rumours', r.id, 'rumours'],
        [r.text, r.src, r.notes, linkName(r.link)]
      )
    );
    S.rulings.forEach((r) =>
      add(
        'Ruling',
        r.text.slice(0, 120),
        `${r.area}${r.sess ? ` · Session ${r.sess}` : ''}`,
        ['notes', 'rulings', r.id, 'rulings'],
        [r.text, r.area]
      )
    );
    S.timeline.forEach((e) =>
      add(
        'Timeline',
        e.text.slice(0, 120),
        e.when || wDay(e.day),
        ['notes', 'timeline', e.id, 'timeline'],
        [e.text, e.when]
      )
    );
  }
  /* quick note from anywhere */
  function openJot() {
    const el = popup(
      'Quick note',
      popHead('Quick note', 'Lands in tonight’s log with the in-game time. Sort it out after the session.') +
        `<div class="row"><input type="text" id="jotT" maxlength="500" placeholder="The barkeep is called Morla. Ruling: …" style="flex:1;min-width:0" aria-label="Note"><button class="btn pri" type="button" id="jotGo">Save</button></div>`
    );
    const go = () => {
      const t = el.querySelector('#jotT').value.trim();
      if (!t) {
        el.remove();
        return;
      }
      const wf = wJot(t);
      if (!wf) tlog(t, false);
      el.remove();
      commit();
      toast(wf || 'Noted in tonight’s log');
    };
    el.querySelector('#jotGo').onclick = go;
    el.querySelector('#jotT').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    };
    el.querySelector('#jotT').focus();
  }

  /* battle stakes, round events and morale */
  function stakesHTML(b) {
    const nx = (b.events || []).find((x) => !x.done);
    if (!b.goal && !b.lose && !nx) return '';
    return `<div class="stakesline">${b.goal ? `<span><small>Objective</small>${esc(b.goal)}</span>` : ''}${b.lose ? `<span><small>If they lose</small>${esc(b.lose)}</span>` : ''}${nx ? `<span><small>Round ${nx.r}</small>${esc(nx.text)}</span>` : ''}</div>`;
  }
  function fireEvents(b) {
    const due = (b.events || []).filter((x) => !x.done && x.r <= b.round);
    due.forEach((x) => {
      x.done = true;
      b.log.push(`R${b.round}: Round event. ${x.text}`);
    });
    if (due.length) setTimeout(() => toast(`Round ${b.round}: ${due.map((x) => x.text).join(' · ')}`), 50);
  }
  const LEADER =
    /\b(boss|captain|chief|chieftain|leader|lord|king|queen|warlord|warchief|high priest|matriarch|patriarch)\b/i;
  function moraleCheck(b, c) {
    if (c.ally) return;
    const foes = b.combatants.filter((x) => !x.pid && !x.lair && !x.ally);
    const up = foes.filter((x) => x.hp > 0 && !x.fled);
    if (foes.length < 2 || !up.length) return;
    let why = '';
    if (!b.morLead && LEADER.test(c.name)) {
      b.morLead = true;
      why = `${c.name} fell`;
    } else if (!b.morHalf && foes.filter((x) => x.hp <= 0 || x.fled).length * 2 >= foes.length) {
      b.morHalf = true;
      why = 'half of the monsters are down';
    }
    if (why) {
      b.morDue = true;
      b.morWhy = why;
      b.log.push(`R${b.round}: Morale check, ${why}.`);
    }
  }
  function rollMorale(b) {
    const dc = b.morDC || 10;
    const up = b.combatants.filter((x) => !x.pid && !x.lair && !x.ally && x.hp > 0 && !x.fled);
    const fled = [];
    up.forEach((x) => {
      const r = d20();
      if (r < dc) {
        x.fled = true;
        fled.push(x.name);
      }
      b.log.push(
        `R${b.round}: ${x.name} rolls ${r} for morale vs DC ${dc}${r < dc ? ' and flees or surrenders' : ' and holds'}.`
      );
    });
    b.morDue = false;
    const cur = b.combatants[b.turn];
    if (cur && cur.fled && !cur.pid) nextTurn(b);
    else commit();
    toast(
      fled.length
        ? `${fled.join(', ')} ${fled.length > 1 ? 'break' : 'breaks'} and ${fled.length > 1 ? 'flee' : 'flees'}`
        : 'They hold their ground'
    );
  }

  /* secrets tied to NPCs, places and missions */
  function linkName(l) {
    if (!l) return '';
    const [k, id] = l.split(':');
    const o =
      k === 'npc'
        ? S.npcs.find((x) => x.id === id)
        : k === 'place'
          ? S.places.find((x) => x.id === id)
          : k === 'front'
            ? (S.fronts || []).find((x) => x.id === id)
            : S.missions.find((x) => x.id === id);
    return o ? o.name || o.title || '' : '';
  }
  const linkOptions = (sel, fr) =>
    `<option value="">Nothing</option>${[
      ['NPCs', 'npc', S.npcs, 'name'],
      ['Places', 'place', S.places, 'name'],
      ['Missions', 'mission', S.missions, 'title'],
      ...(fr ? [['Fronts', 'front', S.fronts, 'name']] : []),
    ]
      .filter((g) => g[2].length)
      .map(
        ([lb, k, list, f]) =>
          `<optgroup label="${lb}">${list.map((o) => `<option value="${k}:${o.id}"${sel === `${k}:${o.id}` ? ' selected' : ''}>${esc(o[f])}</option>`).join('')}</optgroup>`
      )
      .join('')}`;
  const secretsFor = (k, id) => {
    const list = S.secrets.filter((s) => !s.revealed && s.link === `${k}:${id}`);
    return list.length
      ? `<div class="seclist">${list.map((s) => `<div class="sec"><small>Secret</small><span>${esc(s.text)}</span><button class="lnk" type="button" data-revs="${s.id}">Reveal</button></div>`).join('')}</div>`
      : '';
  };
  function setRevealed(s, on) {
    s.revealed = on;
    if (on) {
      s.rsess = S.dm.session;
      {
        const nl = /^npc:/.test(s.link || '') && S.npcs.find((n) => `npc:${n.id}` === s.link);
        if (nl) nl.last = +S.dm.session;
      }
      s.tonight = false;
      tlog(`Secret revealed: ${s.text}`, true);
    } else s.rsess = 0;
  }
  function bindRevs() {
    $('overlay')
      .querySelectorAll('[data-revs]')
      .forEach(
        (x) =>
          (x.onclick = (e) => {
            e.stopPropagation();
            const s = S.secrets.find((y) => y.id === x.dataset.revs);
            if (!s) return;
            setRevealed(s, true);
            commit();
            toast('Secret revealed and logged');
          })
      );
  }

  /* the session sheet */
  VIEWS.session.tonight = () => {
    const t = S.tonight;
    const last = S.notes[S.notes.length - 1];
    const clues = S.secrets.filter((s) => !s.revealed).sort((a, c) => !!c.tonight - !!a.tonight);
    const log = t.log.slice().reverse();
    return {
      html:
        head(
          'Tonight',
          t.started
            ? `Session ${esc(S.dm.session)} · running for ${since(t.started)}`
            : `Session ${esc(S.dm.session)} hasn’t started yet.`
        ) +
        `
    ${t.started ? '' : `<div class="box rowbox"><p class="quiet">Starting marks the time and begins tonight’s log. Plan your scenes first if you like.</p><button class="btn pri" type="button" id="tGo">Start session</button></div>`}
    <div class="box"><h4>Previously on…</h4>${last ? `<p class="readaloud">${esc(readAloud(last.body))}</p><div class="meta">${esc(last.title)}</div>` : '<p class="quiet">No recap yet. Wrap up a session and the board drafts one for you.</p>'}</div>
    <div class="box"><div class="row between"><h4>Clues to deliver</h4><button class="lnk" type="button" data-go="notes:secrets">All secrets</button></div>
      ${clues.length ? `<div class="list tight">${clues.map((s) => `<div class="clue${s.tonight ? ' on' : ''}"><div><span>${esc(s.text)}</span>${linkName(s.link) ? `<small>${esc(linkName(s.link))}</small>` : ''}</div><button class="btn sm ghost" type="button" data-tn="${s.id}" aria-pressed="${!!s.tonight}">${s.tonight ? 'Tonight' : 'Later'}</button><button class="btn sm" type="button" data-revs="${s.id}">Revealed</button></div>`).join('')}</div>` : '<p class="quiet">No secrets kept. Add some under Notes, then mark the ones to deliver tonight.</p>'}</div>
    <div class="box"><h4>Who’s here</h4>
      ${S.players.length ? `<div class="list tight">${S.players.map((p) => `<div class="spotrow${isHere(p) ? '' : ' away'}"><span>${esc(p.name)}<button class="lnk" type="button" data-away="${p.id}">${isHere(p) ? 'Mark away' : 'Mark here'}</button></span>${isHere(p) ? '' : '<small class="aw">Away</small>'}</div>`).join('')}</div>` : '<p class="quiet">Add players first.</p>'}</div>
    <div class="box"><h4>Tonight’s log</h4>
      <div class="row"><input type="text" id="tlT" maxlength="500" placeholder="Jot a name, a ruling or a promise. Press J anywhere for this box." style="flex:1;min-width:0" aria-label="Quick note"><button class="btn" type="button" id="tlGo">Add</button></div>
      ${log.length ? `<div class="tlog">${log.map((e) => `<div class="tl${e.auto ? ' auto' : ''}"><small class="num">${esc(dayLabel(e.day))} · ${fmtTime(e.min)}</small><span>${esc(e.text)}</span>${e.auto ? '' : `<span class="tlact"><button class="lnk" type="button" data-mk="npc" data-id="${e.id}">Make NPC</button><button class="lnk" type="button" data-mk="secret" data-id="${e.id}">Make secret</button><button class="rmb" type="button" data-rmlog="${e.id}" aria-label="Delete note">×</button></span>`}</div>`).join('')}</div>` : '<p class="quiet">Empty so far. Mission changes, revealed secrets, inspiration and filled clocks land here on their own.</p>'}</div>`,
      bind: () => {
        const ov = $('overlay');
        bindRevs();
        $('tGo') && ($('tGo').onclick = askPresent);
        ov.querySelectorAll('[data-go]').forEach(
          (x) =>
            (x.onclick = () => {
              const [s, u] = x.dataset.go.split(':');
              view = { sec: s, sub: u };
              EDIT = null;
              drawSheet(true);
            })
        );
        ov.querySelectorAll('[data-tn]').forEach(
          (x) =>
            (x.onclick = () => {
              const s = S.secrets.find((y) => y.id === x.dataset.tn);
              s.tonight = !s.tonight;
              commit();
            })
        );
        ov.querySelectorAll('[data-away]').forEach(
          (x) =>
            (x.onclick = () => {
              const p = S.players.find((y) => y.id === x.dataset.away);
              if (!p) return;
              p.present = !isHere(p);
              commit();
            })
        );
        const go = () => {
          const v = val('tlT');
          if (!v) return;
          tlog(v, false);
          commit();
          setTimeout(() => $('tlT') && $('tlT').focus(), 0);
        };
        $('tlGo').onclick = go;
        $('tlT').onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          }
        };
        ov.querySelectorAll('[data-rmlog]').forEach(
          (x) =>
            (x.onclick = () => {
              S.tonight.log = S.tonight.log.filter((e) => e.id !== x.dataset.rmlog);
              commit();
            })
        );
        ov.querySelectorAll('[data-mk]').forEach(
          (x) =>
            (x.onclick = () => {
              const e = S.tonight.log.find((y) => y.id === x.dataset.id);
              if (!e) return;
              if (x.dataset.mk === 'npc') {
                clearExample('npcs');
                S.npcs.push({
                  id: uid(),
                  name: e.text.slice(0, 80),
                  role: '',
                  where: '',
                  attitude: 'Unknown',
                  notes: e.text.length > 80 ? e.text : '',
                  last: +S.dm.session,
                });
                toast('Added to NPCs. Fill in the details under Notes');
              } else {
                clearExample('secrets');
                S.secrets.push({ id: uid(), text: e.text, revealed: false, link: '', tonight: false });
                toast('Added to DM secrets');
              }
              S.tonight.log = S.tonight.log.filter((y) => y.id !== e.id);
              commit();
            })
        );
      },
    };
  };
  /*scene-links*/
  // Scene links: a scene can point at the planned battle, NPCs, place and handout it uses,
  // so prep carries into play. Plus "Next time" from Wrap up feeding the next prep.
  function slId(x) {
    return typeof x === 'string' && ID_RE.test(x) ? x : '';
  }
  function slNorm(s) {
    const o = {};
    const p = slId(s.plan),
      pl = slId(s.place),
      h = slId(s.handout);
    const n = Array.isArray(s.npcs) ? [...new Set(s.npcs.map(slId).filter(Boolean))].slice(0, 12) : [];
    if (p) o.plan = p;
    if (n.length) o.npcs = n;
    if (pl) o.place = pl;
    if (h) o.handout = h;
    return o;
  }
  function slLinks(s) {
    return {
      plan: s.plan ? S.plans.find((x) => x.id === s.plan) : null,
      npcs: (s.npcs || []).map((id) => S.npcs.find((x) => x.id === id)).filter(Boolean),
      place: s.place ? S.places.find((x) => x.id === s.place) : null,
      handout: s.handout ? S.handouts.find((x) => x.id === s.handout) : null,
    };
  }
  function slAny(L) {
    return !!(L.plan || L.npcs.length || L.place || L.handout);
  }
  function slForm(o) {
    const L = o ? slLinks(o) : { plan: null, npcs: [], place: null, handout: null };
    const sel = (id, lab, list, cur, name) =>
      list.length
        ? `<label class="f">${lab}<select id="${id}"><option value="">None</option>${list.map((x) => `<option value="${x.id}"${cur && cur.id === x.id ? ' selected' : ''}>${esc(name(x))}</option>`).join('')}</select></label>`
        : '';
    const f =
      sel('slPlan', 'Battle', S.plans, L.plan, (x) => x.name) +
      sel('slPlace', 'Place', S.places, L.place, (x) => x.name) +
      sel('slHo', 'Handout', S.handouts, L.handout, (x) => x.title);
    const npc = S.npcs.length
      ? `<div class="sl-npcs" style="grid-column:1/-1"><span>NPCs in this scene</span><div class="toggles" id="slNpcs">${S.npcs.map((n) => `<label><input type="checkbox" value="${n.id}"${L.npcs.some((x) => x.id === n.id) ? ' checked' : ''}>${esc(n.name)}</label>`).join('')}</div></div>`
      : '';
    return f || npc
      ? `${f}${npc}`
      : `<p class="quiet" style="grid-column:1/-1">Planned battles, NPCs, places and handouts can be linked to a scene once you have some.</p>`;
  }
  function slRead() {
    const v = (id) => ($(id) ? slId($(id).value) : '');
    return {
      plan: v('slPlan'),
      place: v('slPlace'),
      handout: v('slHo'),
      npcs: $('slNpcs') ? [...$('slNpcs').querySelectorAll('input:checked')].map((i) => i.value) : [],
    };
  }
  function slPills(s) {
    const L = slLinks(s);
    if (!slAny(L)) return '';
    return `<div class="row sl-pills">${L.plan ? `<span class="pill mut">Battle: ${esc(L.plan.name)}</span>` : ''}${L.npcs.length ? `<span class="pill mut">NPCs: ${esc(L.npcs.map((n) => n.name).join(', '))}</span>` : ''}${L.place ? `<span class="pill mut">Place: ${esc(L.place.name)}</span>` : ''}${L.handout ? `<span class="pill mut">Handout: ${esc(L.handout.title)}</span>` : ''}</div>`;
  }
  function slHome(sc) {
    const L = slLinks(sc);
    if (!slAny(L)) return '';
    return `<div class="acts sl-home">${L.plan ? `<button class="lnk" type="button" id="slBattle" title="Load ${esc(L.plan.name)} into New battle">Set up battle</button>` : ''}${L.npcs.map((n) => `<button class="lnk" type="button" data-slnpc="${n.id}" title="NPC">${esc(n.name)}</button>`).join('')}${L.place ? `<button class="lnk" type="button" id="slPlaceGo" title="Place">${esc(L.place.name)}</button>` : ''}${L.handout ? `<button class="lnk" type="button" id="slHoGo" title="Handout: ${esc(L.handout.title)}">${+L.handout.shown === +S.dm.session ? 'Handout shown' : 'Mark handout shown'}</button>` : ''}</div>`;
  }
  function slBattle(pl) {
    if (!pl) return;
    if (activeBattle()) {
      toast('End the current battle first');
      return;
    }
    withRef(() =>
      draftGuard((kept) => {
        openSheet('battle', 'new');
        loadPlan(pl);
        if (kept) toast(`${pl.name} loaded. Your old draft is under Planned`);
      })
    );
  }
  function slNpcPop(n) {
    const now = +n.last === +S.dm.session;
    const row = (l, v) => (v ? `<p><b>${l}</b> ${esc(v)}</p>` : '');
    const el = popup(
      n.name,
      popHead(n.name, [n.role, n.where, n.attitude].filter(Boolean).map(esc).join(' · ')) +
        `<div class="sl-npc">${row('Voice:', n.voice)}${row('Wants:', n.wants)}${row('Knows:', n.knows)}${n.notes ? `<p>${esc(n.notes)}</p>` : ''}</div>
    <div class="row end"><button class="btn ghost" type="button" data-mclose>Close</button><button class="btn" type="button" id="slNpcAll">Open NPCs</button>${now ? '' : '<button class="btn pri" type="button" id="slSeen">Mark seen</button>'}</div>`
    );
    el.querySelector('#slNpcAll').onclick = () => {
      el.remove();
      openSheet('notes', 'npcs');
    };
    el.querySelector('#slSeen') &&
      (el.querySelector('#slSeen').onclick = () => {
        n.last = +S.dm.session;
        el.remove();
        commit();
        toast(`${n.name} marked as seen this session`);
      });
  }
  function slPlacePop(p) {
    const el = popup(
      p.name,
      popHead(p.name, esc(p.kind || 'Place')) +
        `${p.notes ? `<p>${esc(p.notes)}</p>` : ''}
    <div class="row end"><button class="btn ghost" type="button" data-mclose>Close</button><button class="btn" type="button" id="slPlAll">Open Places</button></div>`
    );
    el.querySelector('#slPlAll').onclick = () => {
      el.remove();
      openSheet('notes', 'places');
    };
  }
  function hoMarkShown(h) {
    if (!h) return false;
    if (+h.shown === +S.dm.session) return false;
    h.shown = +S.dm.session;
    tlog(`Handout shown: ${h.title}.`, true);
    commit();
    return true;
  }
  function slHandout(h) {
    if (!h) return;
    toast(hoMarkShown(h) ? `${h.title} marked as shown this session` : 'Already marked as shown this session');
  }
  function slBindHome() {
    const sc = S.scenes.find((x) => !x.done);
    if (!sc) return;
    const L = slLinks(sc);
    $('slBattle') && ($('slBattle').onclick = () => slBattle(L.plan));
    $('slPlaceGo') && ($('slPlaceGo').onclick = () => slPlacePop(L.place));
    $('slHoGo') && ($('slHoGo').onclick = () => slHandout(L.handout));
    document.querySelectorAll('[data-slnpc]').forEach(
      (b) =>
        (b.onclick = () => {
          const n = S.npcs.find((x) => x.id === b.dataset.slnpc);
          n && slNpcPop(n);
        })
    );
  }
  function slNextBox() {
    const t = S.dm.nextUp;
    if (!t) return '';
    return `<div class="box sl-next"><div class="row between"><h4>Last time, the party said they’d…</h4></div><p>${esc(t)}</p>
    <div class="row end"><button class="btn sm ghost" type="button" id="slNextClear">Clear</button><button class="btn sm pri" type="button" id="slNextMake">Make a scene</button></div></div>`;
  }
  function slBindScenes() {
    $('slNextMake') &&
      ($('slNextMake').onclick = () => {
        const t = S.dm.nextUp;
        if (!t) return;
        clearExample('scenes');
        const open = S.scenes.filter((s) => !s.done),
          done = S.scenes.filter((s) => s.done);
        S.scenes = [
          {
            id: uid(),
            title: t.slice(0, 120),
            kind: 'Other',
            goal: 'Where the party said they were heading',
            read: '',
            done: false,
          },
          ...open,
          ...done,
        ];
        delete S.dm.nextUp;
        commit();
        toast('Scene added at the top. Edit it to add details and links');
      });
    $('slNextClear') &&
      ($('slNextClear').onclick = () => {
        delete S.dm.nextUp;
        commit();
      });
  }
  VIEWS.session.scenes = () => {
    const o = editing('scenes');
    const kd = o ? o.kind : 'Social';
    const open = S.scenes.filter((s) => !s.done),
      done = S.scenes.filter((s) => s.done);
    const row = (
      s,
      i
    ) => `<div class="item scene${s.done ? ' done' : ''}"><div class="row between"><strong>${esc(s.title)}</strong><span class="pill mut">${esc(s.kind)}</span></div>
    ${s.goal ? `<div class="meta">${esc(s.goal)}</div>` : ''}${slPills(s)}${s.read ? `<p class="readaloud">${esc(s.read)}</p>` : ''}
    <div class="row end">${s.done ? '' : `<button class="btn sm ghost" type="button" data-sup="${s.id}" aria-label="Move up"${i ? '' : ' disabled'}>↑</button><button class="btn sm ghost" type="button" data-sdown="${s.id}" aria-label="Move down"${i < open.length - 1 ? '' : ' disabled'}>↓</button>`}${editBtn('scenes', s.id)}<button class="btn sm ghost" type="button" data-scdel="${s.id}">Delete</button><button class="btn sm${s.done ? ' ghost' : ''}" type="button" data-scdone="${s.id}">${s.done ? 'Not done' : 'Done'}</button></div></div>`;
    return {
      html:
        head('Scenes', 'Tonight’s plan in order. Unplayed scenes roll over to the next session.') +
        slNextBox() +
        `
    <div class="box ${o ? 'editing' : ''}"><div class="grid">
      <label class="f">Scene<input type="text" id="scT" placeholder="Strong start: the bridge is on fire" value="${ev(o, 'title')}"></label>
      <label class="f">Type<select id="scK">${SCENE_KINDS.map((k) => `<option${k === kd ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="f" style="grid-column:1/-1">Goal<input type="text" id="scG" placeholder="What this scene is for, in one line" value="${ev(o, 'goal')}"></label>${slForm(o)}</div>
      <label class="f">Read-aloud text<textarea id="scR" placeholder="Optional. What the players see, hear and smell">${ev(o, 'read')}</textarea></label>
      ${formBtns(o, 'scAdd', 'Add scene')}</div>
    ${open.length ? `<div class="list">${open.map(row).join('')}</div>` : '<div class="empty">No scenes planned. Start with a strong opening scene.</div>'}
    ${done.length ? `<h4 class="eyebrow">Played this session</h4><div class="list">${done.map(row).join('')}</div>` : ''}`,
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        slBindScenes();
        $('scAdd').onclick = () => {
          const t = val('scT');
          if (!t) {
            toast('Name the scene first');
            return;
          }
          upsert(
            'scenes',
            o,
            {
              title: t.slice(0, 120),
              kind: val('scK'),
              goal: val('scG').slice(0, 200),
              read: $('scR').value.trim().slice(0, 4000),
              ...slRead(),
            },
            { done: false }
          );
        };
        const mv = (id, d) => {
          const op = S.scenes.filter((s) => !s.done);
          const i = op.findIndex((s) => s.id === id),
            j = i + d;
          if (j < 0 || j >= op.length) return;
          [op[i], op[j]] = [op[j], op[i]];
          S.scenes = [...op, ...S.scenes.filter((s) => s.done)];
          commit();
        };
        ov.querySelectorAll('[data-sup]').forEach((x) => (x.onclick = () => mv(x.dataset.sup, -1)));
        ov.querySelectorAll('[data-sdown]').forEach((x) => (x.onclick = () => mv(x.dataset.sdown, 1)));
        ov.querySelectorAll('[data-scdone]').forEach(
          (x) =>
            (x.onclick = () => {
              const s = S.scenes.find((y) => y.id === x.dataset.scdone);
              s.done = !s.done;
              if (s.done) tlog(`Scene played: ${s.title}.`, true);
              commit();
            })
        );
        ov.querySelectorAll('[data-scdel]').forEach((x) =>
          armDelete(
            x,
            () => {
              S.scenes = S.scenes.filter((y) => y.id !== x.dataset.scdel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };
  let FRONT_FORM = false;
  VIEWS.session.fronts = () => {
    const o = editing('fronts');
    const form = !!o || FRONT_FORM || !S.fronts.length;
    const live = S.fronts.filter(frontLive),
      ended = S.fronts.filter((f) => !frontLive(f));
    const cur = o && o.clock && S.clocks.some((c) => c.id === o.clock) ? 'ck:' + o.clock : '';
    const moves = `<option value=""${cur ? '' : ' selected'}>By hand</option><optgroup label="New clock"><option value="new:none">New clock, filled by hand</option><option value="new:hour">New clock, fills every in-game hour</option><option value="new:day">New clock, fills every in-game day</option></optgroup>${S.clocks.length ? `<optgroup label="Existing clock">${S.clocks.map((c) => `<option value="ck:${c.id}"${cur === 'ck:' + c.id ? ' selected' : ''}>${esc(c.name)} (${c.fill} / ${c.size})</option>`).join('')}</optgroup>` : ''}`;
    const mis = S.missions.filter((m) => m.status === 'active' || m.status === 'hold' || (o && o.mission === m.id));
    const pill = (f) =>
      f.status === 'doom'
        ? '<span class="pill dn">Doom fell</span>'
        : f.status === 'averted'
          ? '<span class="pill ok">Averted</span>'
          : f.status === 'spent'
            ? '<span class="pill mut">Doom fell</span>'
            : '';
    const card = (
      f
    ) => `<div class="item fcard${f.status === 'doom' ? ' doomed' : ''}"><div class="row between"><strong>${esc(f.name)}</strong><span class="row">${pill(f)}<span class="pill mut">${esc(f.kind)} front</span></span></div>
    ${f.goal ? `<p>${esc(f.goal)}</p>` : ''}${frontLive(f) ? frontBody(f, true) : `<div class="meta">${esc(frontNext(f) === 'Averted' ? (f.doom ? `Stopped before: ${f.doom}` : 'Stopped in time.') : f.doom || 'The doom fell.')}</div>`}
    <div class="row end">${editBtn('fronts', f.id)}<button class="btn sm ghost" type="button" data-fdel="${f.id}">Delete</button>${f.status === 'active' ? `<button class="btn sm ghost" type="button" data-fend="${f.id}" title="The party stopped it">Averted</button>` : f.status === 'doom' ? `<button class="btn sm ghost" type="button" data-fend="${f.id}" title="Move it to Ended">Close front</button>` : `<button class="btn sm ghost" type="button" data-fre="${f.id}">Reopen</button>`}
      ${frontLive(f) ? `<button class="btn sm" type="button" data-fstep="${f.id}" data-d="-1"${canBack(f) ? '' : ' disabled'}>Undo portent</button>` : ''}${f.status === 'active' ? `<button class="btn sm ${reachedOf(f) < f.portents.length ? 'pri' : 'danger'}" type="button" data-fstep="${f.id}" data-d="1">${nextLabel(f)}</button>` : ''}</div></div>`;
    return {
      html:
        head('Fronts', 'Threats with a goal, warning signs and a doom. They move whether the party acts or not.') +
        (form
          ? `<div class="box ${o ? 'editing' : ''}" id="frontForm"><div class="grid">
      <label class="f">Front<input type="text" id="fN" maxlength="120" placeholder="The Cult of the Dragon" value="${ev(o, 'name')}"></label>
      <label class="f">Type<select id="fK">${FRONT_KINDS.map((k) => `<option value="${k}"${k === (o ? o.kind : 'Adventure') ? ' selected' : ''}>${k} front</option>`).join('')}</select></label>
      <label class="f">Moves with<select id="fC">${moves}</select></label>
      <label class="f">Tied to mission<select id="fM"><option value="">No mission</option>${mis.map((m) => `<option value="${m.id}"${o && o.mission === m.id ? ' selected' : ''}>${esc(m.title)}${m.due ? ' (has a deadline)' : ''}</option>`).join('')}</select></label>
      <label class="f" style="grid-column:1/-1">Goal<input type="text" id="fG" maxlength="300" placeholder="What it wants and how it means to get it" value="${ev(o, 'goal')}"></label>
      <label class="f" style="grid-column:1/-1">Impending doom<input type="text" id="fD" maxlength="300" placeholder="What happens if nobody stops it" value="${ev(o, 'doom')}"></label></div>
      <div class="grid fgrid">
      <label class="f">Grim portents, in order<textarea id="fP" placeholder="One per line. Warning signs the players can see coming">${o ? esc(o.portents.map((p) => p.text).join('\n')) : ''}</textarea></label>
      <label class="f">Cast and dangers<textarea id="fCa" placeholder="One per line, as name: what it wants to do">${o ? esc(o.cast.map((x) => (x.impulse ? `${x.name}: ${x.impulse}` : x.name)).join('\n')) : ''}</textarea></label>
      <label class="f">Stakes questions<textarea id="fS" placeholder="One per line. Questions you want play to answer">${o ? esc(o.stakes.map((x) => x.q).join('\n')) : ''}</textarea></label></div>
      <p class="quiet">With a clock, portents land as it fills and the doom when it is full. When a tied mission’s deadline passes, the next portent happens.</p>
      <div class="row end">${o || S.fronts.length ? `<button class="btn ghost" type="button" ${o ? 'data-ecancel' : 'id="fCancel"'}>Cancel</button>` : ''}<button class="btn pri" type="button" id="fAdd">${o ? 'Save changes' : 'Add front'}</button></div></div>`
          : `<div class="row end"><button class="btn" type="button" id="fNew">New front</button></div>`) +
        (live.length
          ? `<div class="list">${live.map(card).join('')}</div>`
          : S.fronts.length
            ? '<div class="empty">No live fronts. Every threat is averted or done.</div>'
            : '') +
        (ended.length ? `<h4 class="eyebrow">Ended</h4><div class="list">${ended.map(card).join('')}</div>` : ''),
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        bindRevs();
        $('fNew') &&
          ($('fNew').onclick = () => {
            FRONT_FORM = true;
            drawSheet();
            $('fN').focus();
          });
        $('fCancel') &&
          ($('fCancel').onclick = () => {
            FRONT_FORM = false;
            drawSheet();
          });
        $('fAdd') &&
          ($('fAdd').onclick = () => {
            const name = val('fN');
            if (!name) {
              toast('Name the front first');
              return;
            }
            {
              const mv = val('fC'),
                n = Math.min(
                  12,
                  $('fP')
                    .value.split('\n')
                    .filter((x) => x.trim()).length
                ),
                lc = mv.startsWith('ck:') && S.clocks.find((c) => c.id === mv.slice(3)),
                cap = mv.startsWith('new:') ? 11 : lc ? lc.size - 1 : 12;
              if (n > cap) {
                toast(
                  lc
                    ? `${lc.name} has ${lc.size} segments, so it fits ${cap} portents at most because the doom takes the last one. Pick a bigger clock or trim the list`
                    : `A front with its own clock fits 11 portents at most, because the doom takes the last segment`
                );
                $('fP').focus();
                return;
              }
            }
            if (!o) clearExample();
            const ls = (id) =>
              $(id)
                .value.split('\n')
                .map((x) => x.trim())
                .filter(Boolean);
            const op = o ? o.portents : [],
              os = o ? o.stakes : [];
            const portents = ls('fP')
              .slice(0, 12)
              .map((t, i) => ({
                id: op[i] ? op[i].id : uid(),
                text: t.slice(0, 300),
                done: !!(op[i] && op[i].done),
                day: op[i] ? op[i].day : 0,
              }));
            const cast = ls('fCa')
              .slice(0, 12)
              .map((l) => {
                const k = l.indexOf(':');
                return {
                  id: uid(),
                  name: (k > 0 ? l.slice(0, k) : l).trim().slice(0, 80),
                  impulse: (k > 0 ? l.slice(k + 1) : '').trim().slice(0, 160),
                };
              })
              .filter((x) => x.name);
            const stakes = ls('fS')
              .slice(0, 8)
              .map((q) => {
                const x = os.find((y) => y.q === q);
                return { id: x ? x.id : uid(), q: q.slice(0, 300), a: x ? x.a : '' };
              });
            const mv = val('fC');
            let clock = mv.startsWith('ck:') && S.clocks.some((c) => c.id === mv.slice(3)) ? mv.slice(3) : '';
            if (mv.startsWith('new:')) {
              const n = portents.length,
                r = portents.filter((p) => p.done).length,
                size = CLOCK_SIZES.find((z) => z > n) || 12;
              const c = {
                id: uid(),
                name: name.slice(0, 80),
                size,
                fill: 0,
                tick: CLOCK_TICK[mv.slice(4)] ? mv.slice(4) : 'none',
                acc: 0,
                cons: val('fD').slice(0, 300),
              };
              // a new clock starts where the front already is
              c.fill = o && o.status === 'doom' ? size : r ? portentAt({ portents }, r - 1, c) : 0;
              S.clocks.push(c);
              clock = c.id;
            }
            const fields = {
              name: name.slice(0, 120),
              kind: FRONT_KINDS.includes(val('fK')) ? val('fK') : 'Adventure',
              goal: val('fG').slice(0, 300),
              doom: val('fD').slice(0, 300),
              portents,
              cast,
              stakes,
              clock,
              mission: S.missions.some((m) => m.id === val('fM')) ? val('fM') : '',
            };
            FRONT_FORM = false;
            upsert('fronts', o, fields, { status: 'active' });
            syncFronts(true);
            commit();
          });
        ov.querySelectorAll('[data-fstep]').forEach(
          (x) =>
            (x.onclick = () =>
              advanceFront(
                S.fronts.find((y) => y.id === x.dataset.fstep),
                +x.dataset.d
              ))
        );
        ov.querySelectorAll('[data-fend]').forEach(
          (x) =>
            (x.onclick = () => {
              const f = S.fronts.find((y) => y.id === x.dataset.fend);
              if (!f) return;
              const c = frontClock(f);
              if (f.status === 'doom') {
                f.status = 'spent';
                commit();
                toast(`${f.name} moved to Ended`);
                return;
              }
              f.status = 'averted';
              if (c) {
                if (c.tick !== 'none') f.tickWas = c.tick;
                c.tick = 'none';
              }
              tlog(`Front averted: ${f.name}.`, true);
              commit();
              toast(`${f.name} averted${c ? '. Its clock stops filling' : ''}`);
            })
        );
        ov.querySelectorAll('[data-fre]').forEach(
          (x) =>
            (x.onclick = () => {
              const f = S.fronts.find((y) => y.id === x.dataset.fre);
              if (!f) return;
              f.status = f.status === 'spent' ? 'doom' : 'active';
              const rc = frontClock(f);
              let back = '';
              if (rc && f.tickWas && rc.tick === 'none') {
                rc.tick = f.tickWas;
                back = CLOCK_TICK[rc.tick].toLowerCase();
              }
              f.tickWas = '';
              syncFronts(true);
              commit();
              toast(
                `${f.name} is active again${back ? `. Its clock fills ${back.replace('every in-game', 'each in-game')} again` : ''}`
              );
            })
        );
        ov.querySelectorAll('[data-fdel]').forEach((x) =>
          armDelete(
            x,
            () => {
              const id = x.dataset.fdel;
              S.fronts = S.fronts.filter((y) => y.id !== id);
              S.secrets.forEach((z) => {
                if (z.link === `front:${id}`) z.link = '';
              });
              commit();
            },
            'Confirm'
          )
        );
        ov.querySelectorAll('[data-fsa]').forEach(
          (x) =>
            (x.onchange = () => {
              const [fi, qi] = x.dataset.fsa.split(':');
              const f = S.fronts.find((y) => y.id === fi),
                q = f && f.stakes.find((y) => y.id === qi);
              if (!q) return;
              const a = x.value.trim().slice(0, 300);
              if (a === q.a) return;
              q.a = a;
              if (a) tlog(`Stakes answered, ${f.name}: ${q.q} ${a}`, true);
              commit();
            })
        );
      },
    };
  };
  VIEWS.session.clocks = () => {
    const o = editing('clocks');
    return {
      html:
        head('Progress clocks', 'Villain plans, faction goals and dangers that move whether the party acts or not.') +
        `
    <div class="box ${o ? 'editing' : ''}"><div class="grid">
      <label class="f">Clock<input type="text" id="ckN" placeholder="The cult completes the ritual" value="${ev(o, 'name')}"></label>
      <label class="f">Segments<select id="ckS">${CLOCK_SIZES.map((n) => `<option${n === (o ? o.size : 6) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f">Fills<select id="ckT">${Object.entries(CLOCK_TICK)
        .map(([k, l]) => `<option value="${k}"${k === (o ? o.tick : 'none') ? ' selected' : ''}>${l}</option>`)
        .join('')}</select></label>
      <label class="f" style="grid-column:1/-1">When it fills<input type="text" id="ckC" placeholder="The dead rise in Saltreach" value="${ev(o, 'cons')}"></label></div>
      ${formBtns(o, 'ckAdd', 'Add clock')}</div>
    ${
      S.clocks.length
        ? `<div class="list">${S.clocks
            .map(
              (
                c
              ) => `<div class="item clockitem${c.fill >= c.size ? ' full' : ''}"><div class="row between"><strong>${esc(c.name)}</strong><span class="meta">${c.fill >= c.size ? 'Complete' : CLOCK_TICK[c.tick]}</span></div>
      <div class="row">${segs(c)}<span class="num meta">${c.fill} / ${c.size}</span><span class="stepper" style="margin-left:auto"><button type="button" data-ck="${c.id}" data-d="-1" aria-label="Empty one segment of ${esc(c.name)}"${c.fill ? '' : ' disabled'}>−</button><button type="button" data-ck="${c.id}" data-d="1" aria-label="Fill one segment of ${esc(c.name)}"${c.fill < c.size ? '' : ' disabled'}>+</button></span></div>
      ${S.fronts
        .filter((f) => f.clock === c.id)
        .map((f) => `<div class="meta">Drives the front ${esc(f.name)}</div>`)
        .join('')}${c.cons ? `<div class="meta">When full: ${esc(c.cons)}</div>` : ''}
      <div class="row end">${editBtn('clocks', c.id)}<button class="btn sm ghost" type="button" data-ckdel="${c.id}">Delete</button></div></div>`
            )
            .join('')}</div>`
        : '<div class="empty">No clocks yet. Four segments is a short fuse, eight is a slow burn.</div>'
    }`,
      bind: () => {
        const ov = $('overlay');
        bindEdits();
        $('ckAdd').onclick = () => {
          const n = val('ckN');
          if (!n) {
            toast('Name the clock first');
            return;
          }
          const size = +val('ckS');
          const wasFull = !!o && o.fill >= o.size;
          upsert(
            'clocks',
            o,
            {
              name: n.slice(0, 80),
              size,
              tick: val('ckT'),
              cons: val('ckC').slice(0, 300),
              ...(o ? { fill: Math.min(o.fill, size) } : {}),
            },
            { fill: 0, acc: 0 }
          );
          if (o && !wasFull && o.fill >= o.size) {
            clockFull(o);
            commit();
          }
          if (o && linkedFront(o)) {
            syncFronts(true);
            commit();
          }
        };
        ov.querySelectorAll('[data-ck]').forEach(
          (x) =>
            (x.onclick = () => {
              const c = S.clocks.find((y) => y.id === x.dataset.ck);
              if (c) tickClock(c, +x.dataset.d);
            })
        );
        ov.querySelectorAll('[data-ckdel]').forEach((x) =>
          armDelete(
            x,
            () => {
              S.fronts.forEach((f) => {
                if (f.clock === x.dataset.ckdel) f.clock = '';
              });
              S.clocks = S.clocks.filter((y) => y.id !== x.dataset.ckdel);
              commit();
            },
            'Confirm'
          )
        );
      },
    };
  };
  let hookShown = '';
  VIEWS.session.hooks = () => ({
    html:
      head(
        'Character hooks',
        'Each character’s goal, bond, fear and secret, so you can weave them into tonight’s scenes.'
      ) +
      `
  <div class="box rowbox"><p class="quiet" id="hookOut">${hookShown ? esc(hookShown) : 'Need a personal twist fast? Draw a random hook from the party.'}</p><button class="btn" type="button" id="hookAll">Hook me</button></div>
  ${
    S.players.length
      ? `<div class="list">${S.players
          .map((p) => {
            const h = HOOKS.filter(([k]) => (p.hooks?.[k] || '').trim());
            return `<div class="item"><div class="row between"><strong>${esc(p.name)}</strong><button class="lnk" type="button" data-hp-edit="${p.id}">${h.length ? 'Edit' : 'Add hooks'}</button></div>
    ${h.length ? `<dl class="hooks">${h.map(([k, l]) => `<dt>${l}</dt><dd>${esc(p.hooks[k])}</dd>`).join('')}</dl>` : '<div class="meta">No hooks yet.</div>'}</div>`;
          })
          .join('')}</div>`
      : '<div class="empty">Add players first.</div>'
  }`,
    bind: () => {
      $('hookAll').onclick = () => {
        const all = S.players
          .filter(inPlay)
          .flatMap((p) =>
            HOOKS.filter(([k]) => (p.hooks?.[k] || '').trim()).map(([k, l]) => `${p.name} · ${l}: ${p.hooks[k]}`)
          );
        hookShown = all.length ? pick(all) : '';
        $('hookOut').textContent = hookShown || 'No hooks written yet. Open a player and fill in Hooks.';
      };
      $('overlay')
        .querySelectorAll('[data-hp-edit]')
        .forEach(
          (x) =>
            (x.onclick = () => {
              openSheet('player', 'hooks', x.dataset.hpEdit);
            })
        );
    },
  });
  // the wrap-up draft is saved with the board (not as an undo step), so a reload doesn't lose it
  let keepWrapT = 0;
  function keepWrap() {
    S.tonight.wrap = {
      draft: wrapEdited ? String(wrapDraft || '').slice(0, 50000) : '',
      edited: wrapEdited,
      cliff: String(wrapCliff || '').slice(0, 300),
      lvl: !!wrapLvl,
      next: String(wrapNext || '').slice(0, 300),
    };
    clearTimeout(keepWrapT);
    keepWrapT = setTimeout(() => {
      try {
        save();
      } catch (e) {}
    }, 400);
  }
  let wrapDraft = null,
    wrapEdited = false,
    wrapCliff = '',
    wrapLvl = false,
    wrapNext = '';
  function buildRecap() {
    const n = +S.dm.session,
      t = S.tonight,
      L = [];
    L.push(`Session ${n}${S.dm.campaign ? ` of ${S.dm.campaign}` : ''}.`);
    if (S.players.length) {
      const aw = S.players.filter((p) => !isHere(p));
      L.push(
        `Present: ${
          S.players
            .filter(isHere)
            .map((p) => p.name)
            .join(', ') || 'nobody'
        }.${aw.length ? ` Away: ${aw.map((p) => p.name).join(', ')}.` : ''}`
      );
    }
    if (t.t0) {
      const m = (S.time.day - t.t0.day) * 1440 + S.time.min - t.t0.min;
      if (m > 0) L.push(`${span(m)} passed in the world. It is now ${dayLabel(S.time.day)}, ${fmtTime(S.time.min)}.`);
    }
    {
      const tr = travelRecap(n);
      if (tr.length) L.push('', 'Travel', ...tr);
    }
    const sc = S.scenes.filter((s) => s.done);
    if (sc.length) L.push('', 'Scenes', ...sc.map((s) => `- ${s.title}${s.goal ? `: ${s.goal}` : ''}`));
    const bs = S.battles.filter((b) => !b.active && +b.session === n);
    if (bs.length)
      L.push(
        '',
        'Battles',
        ...bs.map(
          (b) =>
            `- ${b.name}: ${(b.outcome || 'ended').toLowerCase()} after ${plural(b.round, 'round')}${b.xp ? `, ${b.xp} XP` : ''}`
        )
      );
    const lt = S.loot.filter((l) => +l.session === n);
    if (lt.length)
      L.push(
        '',
        'Loot',
        ...lt.map(
          (l) =>
            `- ${l.item}${l.holder && l.holder !== 'Party' ? ` (${l.holder})` : ''}${l.value ? `, ${l.value}` : ''}`
        )
      );
    const ev = t.log.filter((e) => e.auto && !e.text.startsWith('Scene played') && !travelLine(e.text));
    if (ev.length) L.push('', 'What changed', ...ev.map((e) => `- ${e.text}`));
    const nt = t.log.filter((e) => !e.auto);
    if (nt.length) L.push('', 'Table notes', ...nt.map((e) => `- ${e.text}`));
    return L.join('\n');
  }
  VIEWS.session.wrap = () => {
    const sw = S.tonight.wrap;
    if (wrapDraft == null && sw) {
      wrapEdited = sw.edited;
      wrapCliff = sw.cliff;
      wrapLvl = sw.lvl;
      wrapNext = sw.next || '';
      if (sw.edited) wrapDraft = sw.draft;
    }
    if (wrapDraft == null || !wrapEdited) wrapDraft = buildRecap();
    const left = S.scenes.filter((s) => !s.done).length;
    return {
      html:
        head(
          'Wrap up',
          'The board drafted tonight’s recap from what it saw. Edit it, add a cliffhanger and end the session.'
        ) +
        `
    <div class="box"><div class="row between"><h4>Recap</h4><button class="lnk" type="button" id="wRe">Redraft</button></div>
      <textarea id="wBody" style="min-height:260px" aria-label="Recap">${esc(wrapDraft)}</textarea>
      <label class="f">Cliffhanger<input type="text" id="wCliff" placeholder="As the door creaks open, a voice says your name…" value="${esc(wrapCliff)}"></label>
      <label class="f">Next time, the party plans to…<input type="text" id="wNext" maxlength="300" placeholder="Search the old manor under the town" value="${esc(wrapNext)}"></label></div>
    <div class="box"><h4>Before the next session</h4>
      <div class="toggles"><label><input type="checkbox" id="wLvl"${wrapLvl ? ' checked' : ''}>Milestone: everyone here gains a level (the Level up box opens for each)</label></div>
      <p class="quiet">${left ? `${plural(left, 'unplayed scene')} will roll over. ` : ''}Played scenes are cleared and the session number goes up to ${+S.dm.session + 1}.</p></div>
    ${activeBattle() ? '<div class="warnbox">A battle is still running. End it first so it goes into the recap.</div>' : ''}
    <div class="row end"><button class="btn ghost" type="button" data-close>Not yet</button><button class="btn pri" type="button" id="wEnd">Save recap and end session</button></div>`,
      bind: () => {
        $('wBody').oninput = (e) => {
          wrapDraft = e.target.value;
          wrapEdited = true;
          keepWrap();
        };
        $('wCliff').oninput = (e) => {
          wrapCliff = e.target.value;
          keepWrap();
        };
        $('wNext').oninput = (e) => {
          wrapNext = e.target.value;
          keepWrap();
        };
        $('wLvl').onchange = (e) => {
          wrapLvl = e.target.checked;
          keepWrap();
        };
        $('wRe').onclick = () => {
          wrapEdited = false;
          wrapDraft = buildRecap();
          keepWrap();
          drawSheet();
        };
        $('wEnd').onclick = () => {
          const n = +S.dm.session;
          const cl = val('wCliff'),
            nx = val('wNext').slice(0, 300);
          const body = (
            $('wBody').value.trim() +
            (cl ? `\n\nCliffhanger: ${cl}` : '') +
            (nx ? `\n\nNext time: ${nx}` : '')
          ).slice(0, 50000);
          if (nx) S.dm.nextUp = nx;
          else delete S.dm.nextUp;
          wTL(`Session ${n} played.${cl ? ` Cliffhanger: ${cl.slice(0, 200)}` : ''}`, 'session');
          S.notes.push({ id: uid(), date: today(), title: `Session ${n} recap`, body: body || `Session ${n}.` });
          // "Ruling: …" lines typed into the recap go to Notes › Rulings, like a Quick note
          let ruled = 0;
          body.split('\n').forEach((l) => {
            const m = /^\s*(?:[-•*]\s*)?rulings?\s*[:\-–—]\s*(.+)$/i.exec(l);
            const t = m && m[1].trim();
            if (t && !S.rulings.some((r) => r.text === t)) {
              wAddRuling(t);
              ruled++;
            }
          });
          const lvl = $('wLvl').checked,
            lvq = lvl ? S.players.filter((p) => isHere(p) && !p.dead && (+p.level || 1) < 20).map((p) => p.id) : [];
          S.scenes = S.scenes.filter((s) => !s.done);
          takeSnap('End of session ' + n, true);
          S.dm.session = n + 1;
          S.players.forEach((p) => (p.present = true));
          S.tonight = { started: 0, t0: null, log: [] };
          wrapDraft = null;
          wrapEdited = false;
          wrapCliff = '';
          wrapLvl = false;
          wrapNext = '';
          clearTimeout(keepWrapT);
          closeSheet();
          commit();
          // the session-end write to the backup file is the important one: do it now, not after the idle delay
          writeFile();
          const asked = remindBackup('wrap');
          setTimeout(() => lvlQueue(lvq), 0);
          toast(
            `Session ${n} saved to the Session log.${ruled ? ` ${plural(ruled, 'ruling')} filed under Notes › Rulings.` : ''}${lvq.length ? ' Now level up each player.' : ''}${S.dm.lastBackup === today() || SAFE.file || asked ? ' See you next time' : ' Now click Save backup'}`
          );
        };
      },
    };
  };
  VIEWS.player.hooks = () => {
    const p = pdraft;
    p.hooks = p.hooks || {};
    return {
      html:
        head('Hooks', 'Goal, bond, fear and secret. Weave them into scenes so every character matters.') +
        `
  <div class="box"><div class="grid">${HOOKS.map(([k, l, ph]) => `<label class="f">${l}<input type="text" maxlength="300" data-hk="${k}" value="${esc(p.hooks[k] || '')}" placeholder="${ph}"></label>`).join('')}</div>
    <div class="row"><button class="btn sm" type="button" id="hookMe">Hook me</button><span class="quiet" id="hookOne"></span></div></div>
  ${pFooter()}`,
      bind: () => {
        bindPFooter();
        $('overlay')
          .querySelectorAll('[data-hk]')
          .forEach(
            (i) =>
              (i.oninput = () => {
                pdraft.hooks[i.dataset.hk] = i.value;
              })
          );
        $('hookMe').onclick = () => {
          const h = HOOKS.filter(([k]) => (pdraft.hooks[k] || '').trim());
          $('hookOne').textContent = h.length
            ? (([k, l]) => `${l}: ${pdraft.hooks[k]}`)(pick(h))
            : 'Fill in a hook first';
        };
      },
    };
  };

  /* ---------- storyteller tools ---------- */
  /* who is at the table tonight */
  const isHere = (p) => !!p && p.present !== false;
  const inPlay = (p) => isHere(p) && !p.dead;
  function askPresent() {
    if (!S.players.length) {
      sessStart();
      return;
    }
    const el = popup(
      'Who’s here?',
      popHead('Who’s here tonight?', 'Anyone left unticked is skipped in new battles, the XP split and group rolls.') +
        `<div class="list tight herelist">${S.players.map((p) => `<label class="hererow"><input type="checkbox" data-here="${p.id}" checked><span>${esc(p.name)}</span><small>${esc(p.cls)} ${esc(p.level)}</small></label>`).join('')}</div>
    <div class="row end"><button class="btn ghost" type="button" data-mclose>Cancel</button><button class="btn pri" type="button" id="hereGo">Start session</button></div>`
    );
    el.querySelector('#hereGo').onclick = () => {
      el.querySelectorAll('[data-here]').forEach((i) => {
        const p = S.players.find((x) => x.id === i.dataset.here);
        if (p) p.present = i.checked;
      });
      el.remove();
      sessStart();
    };
    el.querySelector('#hereGo').focus();
  }

  /* group checks and the secret check, in Dice */
  const GC_ABIL = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
  const GC_SK = [
    'Acrobatics',
    'Animal Handling',
    'Arcana',
    'Athletics',
    'Deception',
    'History',
    'Insight',
    'Intimidation',
    'Investigation',
    'Medicine',
    'Nature',
    'Perception',
    'Performance',
    'Persuasion',
    'Religion',
    'Sleight of Hand',
    'Stealth',
    'Survival',
  ];
  const GC_ALL = [...GC_ABIL, ...GC_SK],
    SWEEP = ['Perception', 'Insight', 'Investigation'];
  // the board knows passive Perception, Insight and Investigation, and initiative (usually the Dexterity modifier); anything else the DM types once and it is remembered
  const gcBase = (p, k) =>
    !SWEEP.includes(k) && abCalc(p, k) != null
      ? abCalc(p, k)
      : k === 'Perception'
        ? (+p.pp || 10) - 10
        : k === 'Insight'
          ? (+p.pins || 10) - 10
          : k === 'Investigation'
            ? (+p.pinv || 10) - 10
            : k === 'Dexterity'
              ? Math.trunc(+p.ini || 0)
              : 0;
  const gcMod = (p, k) => (p.mods && p.mods[k] != null ? +p.mods[k] : gcBase(p, k));
  const DTABS = [
    ['roll', 'Roll'],
    ['group', 'Group check'],
    ['sweep', 'Secret check'],
  ];
  function diceHTML() {
    const t = DICE.tab;
    return (
      `<div class="seg dtabs" role="group" aria-label="Dice mode">${DTABS.map(([k, l]) => `<button type="button" data-dtab="${k}" aria-pressed="${t === k}">${l}</button>`).join('')}</div>` +
      (t === 'group' ? groupHTML() : t === 'sweep' ? sweepHTML() : diceRollHTML())
    );
  }
  function bindDice(host) {
    const redraw = () => {
      host.innerHTML = diceHTML();
      bindDice(host);
    };
    host.querySelectorAll('[data-dtab]').forEach(
      (b) =>
        (b.onclick = () => {
          DICE.tab = b.dataset.dtab;
          redraw();
          const f = host.querySelector(`[data-dtab="${DICE.tab}"]`);
          f && f.focus();
        })
    );
    if (DICE.tab === 'group') bindGroup(host, redraw);
    else if (DICE.tab === 'sweep') bindSweep(host, redraw);
    else bindRoll(host);
  }
  const dcInput = (id, v) =>
    `<label class="grp">DC <input type="number" id="${id}" min="1" max="40" value="${v}" class="dcin"></label>`;
  function groupHTML() {
    const ps = S.players.filter(inPlay),
      k = DICE.gk,
      R = DICE.gres;
    const spin = !!DICE.spin;
    DICE.spin = false;
    const RL = R ? reelsHTML({ dice: R.rows.map((r) => ({ f: 20, v: r.v })) }, spin) : { html: '', end: 0 };
    return `<div class="dice">
    <p class="quiet">Everyone here tonight rolls. The group succeeds if at least half of them succeed. Poisoned players roll with Disadvantage, and Exhaustion is taken off for you.</p>
    <div class="dopts"><label class="grp">Check <select id="gcK">${[
      ['Abilities', GC_ABIL],
      ['Skills', GC_SK],
    ]
      .map(
        ([g, l]) =>
          `<optgroup label="${g}">${l.map((x) => `<option${x === k ? ' selected' : ''}>${x}</option>`).join('')}</optgroup>`
      )
      .join('')}</select></label>${dcInput('gcDC', DICE.gdc)}</div>
    ${
      ps.length
        ? `<div class="gclist"><div class="gchead"><span>Player</span><span>${esc(k)} modifier</span></div>${ps.map((p) => `<label class="gcrow"><span>${esc(p.name)}</span><input type="number" data-gcm="${p.id}" min="-20" max="30" value="${gcMod(p, k)}" aria-label="${esc(p.name)}’s ${esc(k)} modifier"></label>`).join('')}</div>
      <div class="row end"><button class="btn pri" type="button" id="gcGo">Roll for the group</button></div>`
        : '<div class="empty">Nobody is marked as here tonight.</div>'
    }
    ${
      R
        ? `<div class="dres${RL.end ? ' spinning' : ''}" style="--t:${RL.end}ms" aria-live="polite"><div class="lbl">${esc(R.label)}</div>${RL.html}<div class="tot late" style="color:var(--${R.ok ? 'good' : 'crit'})">${R.ok ? 'Success' : 'Failure'}</div><div class="bd late">${R.k} of ${R.n} succeeded</div></div>
      <div class="gcres late" style="--t:${RL.end}ms">${R.rows.map((r) => `<div class="gcrow"><span>${esc(r.name)}</span><span class="num meta">${r.v} ${r.m < 0 ? '−' : '+'} ${Math.abs(r.m)} = <b>${r.t}</b>${r.why ? ` <small>(${esc(r.why)})</small>` : ''}</span><span class="pill ${r.ok ? 'ok' : 'dn'}">${r.ok ? 'Pass' : 'Fail'}</span></div>`).join('')}</div>`
        : ''
    }
  </div>`;
  }
  function bindGroup(host, redraw) {
    host.querySelector('#gcK').onchange = (e) => {
      DICE.gk = e.target.value;
      DICE.gres = null;
      redraw();
      host.querySelector('#gcK').focus();
    };
    host.querySelector('#gcDC').onchange = (e) => {
      DICE.gdc = clamp(Math.round(+e.target.value || 10), 1, 40);
    };
    host.querySelectorAll('[data-gcm]').forEach(
      (i) =>
        (i.onchange = () => {
          const p = S.players.find((x) => x.id === i.dataset.gcm);
          if (!p) return;
          const v = clamp(Math.round(+i.value || 0), -20, 30),
            k = DICE.gk;
          p.mods = p.mods || {};
          if (v === gcBase(p, k)) delete p.mods[k];
          else p.mods[k] = v;
          commit();
        })
    );
    const go = host.querySelector('#gcGo');
    go &&
      (go.onclick = () => {
        const dc = (DICE.gdc = clamp(Math.round(+host.querySelector('#gcDC').value || 10), 1, 40)),
          k = DICE.gk;
        const rows = S.players.filter(inPlay).map((p) => {
          const pz = (p.conditions || []).includes('Poisoned'),
            d = d20m(pz ? 'dis' : 'norm'),
            v = d.v,
            ex = 2 * (+p.exh || 0),
            m = gcMod(p, k) - ex;
          return {
            name: p.name,
            v,
            m,
            t: v + m,
            ok: v + m >= dc,
            why: [pz ? `Poisoned: rolled ${d.r.join(' and ')}` : '', ex ? `−${ex} Exhaustion` : '']
              .filter(Boolean)
              .join(', '),
          };
        });
        if (!rows.length) return;
        const n = rows.length,
          kk = rows.filter((r) => r.ok).length,
          ok = kk * 2 >= n;
        DICE.gres = { label: `Group ${k} check, DC ${dc}`, rows, n, k: kk, ok };
        pushRoll({
          dice: rows.map((r) => ({ f: 20, v: r.v })),
          label: `Group ${k} DC ${dc}`,
          total: `${kk}/${n}`,
          bd: rows.map((r) => `${r.name} ${r.t}`).join(', '),
        });
        tlog(
          `Group ${k} check, DC ${dc}: ${ok ? 'success' : 'failure'}, ${kk} of ${n} passed (${rows.map((r) => `${r.name} ${r.t}`).join(', ')}).`,
          true
        );
        commit();
        if (host.isConnected) {
          redraw();
          const b = host.querySelector('#gcGo');
          b && b.focus();
        }
      });
  }
  function sweepHTML() {
    const ps = S.players.filter(inPlay),
      k = DICE.sk,
      R = DICE.sres;
    return `<div class="dice">
    <p class="quiet">No dice and nothing said out loud. Each player here tonight is compared on their passive score (10 + modifier).</p>
    <div class="dopts"><div class="grp">Sense <div class="seg" role="group" aria-label="Sense">${SWEEP.map((x) => `<button type="button" data-swk="${x}" aria-pressed="${x === k}">${x}</button>`).join('')}</div></div>${dcInput('swDC', DICE.sdc)}</div>
    ${ps.length ? `<div class="row end"><button class="btn pri" type="button" id="swGo">Check quietly</button></div>` : '<div class="empty">Nobody is marked as here tonight.</div>'}
    ${
      R
        ? `<div class="sweepres" aria-live="polite"><div class="row between"><b>${esc(R.label)}</b><span class="meta">${R.who.length ? `${R.who.length} of ${R.rows.length} notice` : 'Nobody notices'}</span></div>
      ${R.rows.map((r) => `<div class="gcrow"><span>${esc(r.name)}</span><span class="num meta">Passive ${r.pas}</span><span class="pill ${r.ok ? 'ok' : 'mut'}">${r.ok ? 'Notices' : 'Misses it'}</span></div>`).join('')}</div>`
        : ''
    }
  </div>`;
  }
  function bindSweep(host, redraw) {
    host.querySelectorAll('[data-swk]').forEach(
      (b) =>
        (b.onclick = () => {
          DICE.sk = b.dataset.swk;
          DICE.sres = null;
          redraw();
          const f = host.querySelector(`[data-swk="${DICE.sk}"]`);
          f && f.focus();
        })
    );
    host.querySelector('#swDC').onchange = (e) => {
      DICE.sdc = clamp(Math.round(+e.target.value || 13), 1, 40);
    };
    const go = host.querySelector('#swGo');
    go &&
      (go.onclick = () => {
        const dc = (DICE.sdc = clamp(Math.round(+host.querySelector('#swDC').value || 13), 1, 40)),
          k = DICE.sk;
        const rows = S.players.filter(inPlay).map((p) => {
          const pas = 10 + gcMod(p, k);
          return { name: p.name, pas, ok: pas >= dc };
        });
        const who = rows.filter((r) => r.ok).map((r) => r.name);
        DICE.sres = { label: `Secret ${k} check, DC ${dc}`, rows, who };
        pushRoll({
          dice: [],
          label: `Secret ${k} DC ${dc} (hidden)`,
          total: `${who.length}/${rows.length}`,
          bd: who.length ? `${who.join(', ')} notice` : 'Nobody notices',
        });
        DICE.spin = false;
        tlog(
          `Secret ${k} check, DC ${dc}: ${who.length ? `${who.join(', ')} noticed` : 'nobody noticed'} (hidden).`,
          true
        );
        commit();
        if (host.isConnected) {
          redraw();
          const b = host.querySelector('#swGo');
          b && b.focus();
        }
      });
  }

  /* battle aftermath: treasure, prisoners, injuries and a one-line summary */
  let AFTER = null,
    AF = {};
  const crOfXp = (x) =>
    (Object.entries(CR_XP)
      .filter(([, v]) => v <= x)
      .sort((a, c) => c[1] - a[1])[0] || ['0'])[0];
  const baseName = (n) => String(n).replace(/\s+\d+$/, '');
  function beaten(b) {
    return [
      ...b.combatants
        .filter((c) => !c.pid && !c.lair && !c.ally && (c.hp <= 0 || c.fled))
        .map((c) => ({ name: c.name, xp: +c.xp || 0 })),
      ...(b.gone || []).map((g) => ({ name: g.name, xp: +g.xp || 0 })),
    ];
  }
  function downs(b) {
    return b.combatants
      .filter((c) => c.pid)
      .map((c) => ({
        p: S.players.find((x) => x.id === c.pid),
        n: b.log.filter((l) => l.includes(`: ${c.name} took `) && l.includes(' and is down')).length,
      }))
      .filter((d) => d.p);
  }
  function afterSummary(b) {
    const g = {};
    beaten(b).forEach((x) => {
      const k = baseName(x.name);
      g[k] = (g[k] || 0) + 1;
    });
    const foes = Object.entries(g)
      .map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
      .join(', ');
    const dn = downs(b)
      .filter((d) => d.n)
      .map((d) => `${d.p.name} went down${d.n > 1 ? ` ${d.n} times` : ''}`);
    return `${b.name}: ${b.outcome.toLowerCase()}${foes ? ` against ${foes}` : ''} after ${plural(b.round, 'round')}.${dn.length ? ` ${dn.join(', ')}.` : ''}`.slice(
      0,
      300
    );
  }
  function afterClose() {
    AFTER = null;
    AF = {};
    view.sub = 'history';
  }
  VIEWS.battle.after = () => {
    const b = S.battles.find((x) => x.id === AFTER && !x.active);
    if (!b) {
      afterClose();
      return VIEWS.battle.history();
    }
    if (AF.id !== b.id) AF = { id: b.id, sum: afterSummary(b), tre: null, treDone: '', pris: {}, inj: {} };
    const all = beaten(b),
      cr = crOfXp(all.reduce((m, x) => Math.max(m, x.xp), 0));
    const pris = b.combatants.filter((c) => !c.pid && !c.lair && !c.ally && c.fled && c.hp > 0);
    const hurtPCs = S.dm.injuries ? downs(b).filter((d) => d.n) : [];
    return {
      html:
        head(
          'Aftermath',
          `${esc(b.name)} ended in ${esc(b.outcome.toLowerCase())} after ${plural(b.round, 'round')}${b.xp ? `, ${b.xp} XP` : ''}. Everything here is optional.`
        ) +
        `
    <div class="box"><h4>Treasure</h4>
      ${
        all.length
          ? AF.tre
            ? `<div class="afrow"><div class="stext"><b>${esc(AF.tre.title)}</b><span class="quiet">${esc(AF.tre.text)}</span></div>${AF.treDone ? `<span class="pill ok">${esc(AF.treDone)}</span>` : `<div class="row"><button class="btn sm ghost" type="button" id="afReroll">Reroll</button><button class="btn sm" type="button" id="afLoot">Add to loot</button><button class="btn sm pri" type="button" id="afFunds">Add to party funds</button></div>`}</div>`
            : `<div class="afrow"><p class="quiet">Roll coins for the toughest foe defeated (CR ${esc(cr)}).</p><button class="btn" type="button" id="afRoll">Roll treasure</button></div>`
          : '<p class="quiet">No foes were defeated, so there are no coins to roll.</p>'
      }
      <div class="row"><input type="text" id="afItem" maxlength="160" placeholder="Anything else they found: a silver key, a +1 shield" style="flex:1;min-width:0" aria-label="Item they found"><button class="btn" type="button" id="afItemGo">Add to loot</button></div></div>
    ${pris.length ? `<div class="box"><h4>Prisoners</h4><p class="quiet">These foes fled or surrendered. Keep the ones the party caught as NPCs.</p><div class="list tight">${pris.map((c) => `<div class="spotrow"><span>${esc(c.name)}</span>${AF.pris[c.id] ? '<small>Saved to NPCs</small>' : `<button class="btn sm" type="button" data-afnpc="${c.id}">Save as NPC</button>`}</div>`).join('')}</div></div>` : ''}
    ${hurtPCs.length ? `<div class="box"><h4>Lingering injuries</h4><div class="list tight">${hurtPCs.map(({ p, n }) => `<div class="spotrow"><span>${esc(p.name)} <span class="meta">went down ${n > 1 ? `${n} times` : 'once'}</span></span>${AF.inj[p.id] ? `<small>${esc(AF.inj[p.id])}</small>` : `<button class="btn sm" type="button" data-afinj="${p.id}">Roll injury</button>`}</div>`).join('')}</div></div>` : ''}
    <div class="box"><h4>Summary for tonight’s log</h4><input type="text" id="afSum" maxlength="300" value="${esc(AF.sum)}" aria-label="Battle summary"></div>
    <div class="row end"><button class="btn ghost" type="button" id="afSkip">Skip</button><button class="btn pri" type="button" id="afDone">Save summary and finish</button></div>`,
      bind: () => {
        const ov = $('overlay'),
          keep = () => {
            const s = $('afSum');
            if (s) AF.sum = s.value;
          };
        const on = (id, f) => {
          const el = $(id);
          el &&
            (el.onclick = () => {
              keep();
              f();
            });
        };
        $('afSum').oninput = keep;
        const roll = () => {
          AF.tre = genOne('coins', crNum(cr));
          drawSheet();
        };
        on('afRoll', roll);
        on('afReroll', roll);
        on('afFunds', () => {
          tlog(`Treasure from ${b.name}: ${AF.tre.title}.`, true);
          AF.treDone = 'Added to party funds';
          AF.tre.run();
        });
        on('afLoot', () => {
          S.loot.push({
            id: uid(),
            item: `Coins from ${b.name}`.slice(0, 160),
            holder: 'Party',
            value: AF.tre.title,
            session: +S.dm.session,
          });
          AF.treDone = 'Added to loot';
          commit();
          toast('Added to loot');
        });
        on('afItemGo', () => {
          const it = val('afItem');
          if (!it) {
            toast('Name the item first');
            return;
          }
          S.loot.push({ id: uid(), item: it.slice(0, 160), holder: 'Party', value: '', session: +S.dm.session });
          commit();
          toast(`${it} added to loot`);
        });
        $('afItem').onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            $('afItemGo').click();
          }
        };
        ov.querySelectorAll('[data-afnpc]').forEach(
          (x) =>
            (x.onclick = () => {
              keep();
              const c = b.combatants.find((y) => y.id === x.dataset.afnpc);
              if (!c) return;
              S.npcs.push({
                id: uid(),
                name: c.name.slice(0, 80),
                role: 'Prisoner',
                where: '',
                attitude: 'Hostile',
                notes: `Captured after ${b.name}, session ${S.dm.session}.`.slice(0, 4000),
                voice: '',
                wants: '',
                knows: '',
                last: +S.dm.session,
              });
              AF.pris[c.id] = 1;
              tlog(`${c.name} was taken prisoner.`, true);
              commit();
              toast(`${c.name} saved to NPCs`);
            })
        );
        ov.querySelectorAll('[data-afinj]').forEach(
          (x) =>
            (x.onclick = () => {
              keep();
              const p = S.players.find((y) => y.id === x.dataset.afinj);
              if (!p) return;
              const r = rollInjury(p);
              AF.inj[p.id] = `${r.name} (rolled ${r.r})`;
              tlog(`${p.name}: lingering injury, ${r.name}.`, true);
              commit();
            })
        );
        on('afSkip', () => {
          afterClose();
          drawSheet(true);
        });
        on('afDone', () => {
          const s = String(AF.sum || '').trim();
          if (s) tlog(`Battle: ${s}`, true);
          afterClose();
          commit();
          toast(s ? 'Saved to tonight’s log' : 'Battle closed');
        });
      },
    };
  };

  /* mission clues and deadlines */
  let CLUE_OPEN = null;
  const minsUntil = (m) => (m.due.day - S.time.day) * 1440 + m.due.min - S.time.min;
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const srcName = (s) => (LINK_RE.test(s || '') ? linkName(s) : s || '');
  function untieClues(k, id) {
    const key = `${k}:${id}`,
      nm = linkName(key).slice(0, 160);
    S.missions.forEach((m) =>
      (m.clues || []).forEach((c) => {
        if (c.src === key) c.src = nm;
      })
    );
  }
  const leadsLeft = (m) => (m.clues || []).filter((c) => !c.found).length;
  const leadWarn = (m) => m.status === 'active' && leadsLeft(m) > 0 && leadsLeft(m) < 3;
  const dueSoon = (m) => m.status === 'active' && !!m.due && !m.dueFired && minsUntil(m) <= 1440;
  const missionWarn = () => S.missions.some((m) => leadWarn(m) || dueSoon(m));
  function dueFields(o) {
    const d = Math.round(+val('mDay')),
      mm = /^(\d\d):(\d\d)$/.exec(val('mTime'));
    const due = d >= 1 ? { day: Math.min(d, 1e6), min: mm ? clamp(+mm[1] * 60 + +mm[2], 0, 1439) : 1439 } : null;
    const same = !!o && JSON.stringify(o.due || null) === JSON.stringify(due);
    return { due, ifIgnored: val('mIfx').slice(0, 300), dueFired: same ? !!o.dueFired : false };
  }
  function dueLine(m) {
    if (!m.due) return '';
    const left = minsUntil(m),
      soon = m.status === 'active' && left <= 1440;
    return `<div class="dueline${soon ? ' soon' : ''}"><span>${left <= 0 ? `Deadline passed (${esc(dayLabel(m.due.day))}, ${fmtTime(m.due.min)})` : `Due ${esc(dayLabel(m.due.day))}, ${fmtTime(m.due.min)} · ${span(left)} left`}</span>${m.ifIgnored ? `<small>If ignored: ${esc(m.ifIgnored)}</small>` : ''}</div>`;
  }
  function cluesHTML(m) {
    const open = CLUE_OPEN === m.id,
      cl = m.clues || [];
    if (!cl.length && !open) return '';
    const left = leadsLeft(m);
    return `<div class="mclues"><div class="row between"><h5>Clues</h5>${cl.length ? `<span class="meta num">${cl.length - left} of ${cl.length} found</span>` : ''}</div>
    ${cl.length ? `<div class="list tight">${cl.map((c) => `<div class="clue${c.found ? ' on' : ''}"><div><span>${esc(c.text)}</span>${srcName(c.src) ? `<small>${esc(srcName(c.src))}</small>` : ''}</div><button class="btn sm ghost" type="button" data-clf="${m.id}:${c.id}" aria-pressed="${c.found}">${c.found ? 'Found' : 'Not found'}</button><button class="rmb" type="button" data-clx="${m.id}:${c.id}" aria-label="Remove clue">×</button></div>`).join('')}</div>` : ''}
    ${leadWarn(m) ? `<div class="warnbox">Only ${plural(left, 'lead')} left. Add another route?</div>` : ''}
    ${open ? `<div class="clueadd"><input type="text" id="clT" maxlength="300" placeholder="Bloody boot prints lead to the cellar" aria-label="Clue"><select id="clS" aria-label="Found with">${linkOptions('').replace('>Nothing<', '>Found with…<')}</select><input type="text" id="clF" maxlength="160" placeholder="Or say where" aria-label="Where it is found, in your words"><button class="btn sm pri" type="button" id="clGo">Add clue</button></div>` : ''}</div>`;
  }
  function bindClues(ov) {
    ov.querySelectorAll('[data-clo]').forEach(
      (x) =>
        (x.onclick = () => {
          CLUE_OPEN = CLUE_OPEN === x.dataset.clo ? null : x.dataset.clo;
          drawSheet();
          const t = $('clT');
          t && t.focus();
        })
    );
    const fc = (k) => {
      const [mi, ci] = k.split(':');
      const m = S.missions.find((y) => y.id === mi);
      return [m, m && m.clues.find((c) => c.id === ci)];
    };
    ov.querySelectorAll('[data-clf]').forEach(
      (x) =>
        (x.onclick = () => {
          const [m, c] = fc(x.dataset.clf);
          if (!c) return;
          c.found = !c.found;
          if (c.found) tlog(`Clue found for ${m.title}: ${c.text}`, true);
          commit();
        })
    );
    ov.querySelectorAll('[data-clx]').forEach(
      (x) =>
        (x.onclick = () => {
          const [m, c] = fc(x.dataset.clx);
          if (!c) return;
          m.clues = m.clues.filter((y) => y !== c);
          commit();
        })
    );
    const go = () => {
      const m = S.missions.find((y) => y.id === CLUE_OPEN),
        t = val('clT');
      if (!m) return;
      if (!t) {
        toast('Write the clue first');
        return;
      }
      m.clues.push({ id: uid(), text: t.slice(0, 300), src: (val('clS') || val('clF')).slice(0, 160), found: false });
      commit();
      setTimeout(() => {
        const i = $('clT');
        i && i.focus();
      }, 0);
    };
    $('clGo') && ($('clGo').onclick = go);
    $('clT') &&
      ($('clT').onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          go();
        }
      });
  }
  // called whenever in-game time moves on
  function checkDeadlines() {
    const hit = S.missions.filter((m) => m.status === 'active' && m.due && !m.dueFired && minsUntil(m) <= 0);
    if (!hit.length) return;
    hit.forEach((m) => {
      m.dueFired = true;
      // the log and the timeline show when the deadline passed, not when the clock stopped
      const now = { day: S.time.day, min: S.time.min };
      S.time.day = m.due.day;
      S.time.min = m.due.min;
      try {
        tlog(`Deadline passed: ${m.title}.${m.ifIgnored ? ` ${m.ifIgnored}` : ''}`, true);
      } finally {
        S.time.day = now.day;
        S.time.min = now.min;
      }
      S.fronts.forEach((f) => {
        if (f.mission === m.id && f.status === 'active') stepFront(f, 1);
      });
    });
    setTimeout(() => duePop(hit.map((m) => m.id)), 350);
  }
  function duePop(ids) {
    if ($('mcard')) {
      setTimeout(() => duePop(ids), 600);
      return;
    }
    const ms = ids.map((id) => S.missions.find((m) => m.id === id)).filter((m) => m && m.status === 'active');
    if (!ms.length) return;
    const el = popup(
      'Deadline passed',
      popHead(
        ms.length > 1 ? 'Deadlines passed' : 'Deadline passed',
        'It’s in tonight’s log. Mark the mission failed, or keep it going if the party can still save it.'
      ) +
        `<div class="list">${ms.map((m) => `<div class="item"><strong>${esc(m.title)}</strong>${m.ifIgnored ? `<p>${esc(m.ifIgnored)}</p>` : '<div class="meta">No consequence written. Decide what happens now.</div>'}<div class="row end"><button class="btn sm" type="button" data-dkeep="${m.id}">Keep active</button><button class="btn sm danger" type="button" data-dfail="${m.id}">Mark failed</button></div></div>`).join('')}</div>`
    );
    const done = (x) => {
      x.closest('.item').remove();
      const n = el.querySelector('[data-dkeep]');
      if (n) n.focus();
      else el.remove();
    };
    el.querySelectorAll('[data-dkeep]').forEach((x) => (x.onclick = () => done(x)));
    el.querySelectorAll('[data-dfail]').forEach(
      (x) =>
        (x.onclick = () => {
          const m = S.missions.find((y) => y.id === x.dataset.dfail);
          if (m && m.status === 'active') {
            m.status = 'failed';
            tlog(`Mission failed: ${m.title}.`, true);
            commit();
            wMissionEnd(m);
          }
          done(x);
        })
    );
    const f = el.querySelector('[data-dkeep]');
    f && f.focus();
  }

  /* richer NPCs */
  const INFL = {
    Friendly: 'Friendly: a reasonable request usually goes through with little or no roll.',
    Indifferent: 'Indifferent: expect a Charisma check, often around DC 15.',
    Hostile: 'Hostile: a hard check at best, and many requests are simply refused.',
    Unknown: 'Unknown: decide how they feel when the party first meets them.',
  };
  const sameName = (a, c) => !!a && !!c && String(a).trim().toLowerCase() === String(c).trim().toLowerCase();
  function npcMore(n) {
    const key = `npc:${n.id}`;
    const ms = S.missions.filter((m) => sameName(m.giver, n.name) || (m.clues || []).some((c) => c.src === key));
    const pl = S.places.filter((p) => sameName(p.name, n.where));
    const bits = [
      n.voice && ['Voice', esc(n.voice)],
      n.wants && ['Wants', esc(n.wants)],
      n.knows && ['Knows', esc(n.knows)],
      ms.length && ['Missions', ms.map((m) => esc(m.title)).join(', ')],
      pl.length && ['Place', pl.map((p) => `${esc(p.name)} <span class="meta">${esc(p.kind)}</span>`).join(', ')],
    ].filter(Boolean);
    const now = +n.last === +S.dm.session;
    return `${bits.length ? `<dl class="hooks npcx">${bits.map(([l, v]) => `<dt>${l}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}<div class="seen"><span>${n.last ? (now ? 'Seen this session' : `Last seen in session ${n.last}`) : 'Not seen yet'}</span>${now ? '' : `<button class="lnk" type="button" data-seen="${n.id}">Mark seen</button>`}</div>`;
  }
  function bindSeen() {
    $('overlay')
      .querySelectorAll('[data-seen]')
      .forEach(
        (x) =>
          (x.onclick = () => {
            const n = S.npcs.find((y) => y.id === x.dataset.seen);
            if (n) {
              n.last = +S.dm.session;
              commit();
            }
          })
      );
  }

  /* handouts */
  let HO_IMG,
    HO_FOR = null;
  function readImg(f, cb) {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let d = cv.toDataURL('image/webp', 0.72);
        if (!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', 0.72);
        cb(d);
      };
      img.onerror = () => toast('That image couldn’t be read');
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }
  const hoImgHTML = (img) =>
    `${img && IMGS[img] ? `<img class="hothumb" src="${IMGS[img]}" alt="Handout image">` : ''}<button class="btn sm" type="button" id="hoPick">${img ? 'Change image' : 'Add image'}</button>${img ? '<button class="btn sm ghost" type="button" id="hoNoImg">Remove image</button>' : ''}`;
  VIEWS.notes.handouts = () => {
    const o = editing('handouts');
    if (HO_FOR !== (o ? o.id : null)) {
      HO_FOR = o ? o.id : null;
      HO_IMG = undefined;
    }
    const cur = () => (HO_IMG === undefined ? (o ? o.img : null) : HO_IMG);
    const now = (h) => +h.shown === +S.dm.session;
    return {
      html:
        head('Handouts', 'Letters, maps and notes for the players. Mark one shown when you hand it over.') +
        `
    <div class="box ${o ? 'editing' : ''}"><label class="f">Title<input type="text" id="hoT" maxlength="120" placeholder="A letter sealed in black wax" value="${ev(o, 'title')}"></label>
      <label class="f">Text<textarea id="hoB" placeholder="What the players can read">${ev(o, 'body')}</textarea></label>
      <div class="row hoimg" id="hoImg">${hoImgHTML(cur())}</div><input type="file" id="hoFile" accept="image/*" hidden>
      ${formBtns(o, 'hoAdd', 'Add handout')}</div>
    ${
      S.handouts.length
        ? `<div class="list">${S.handouts
            .slice()
            .reverse()
            .map(
              (
                h
              ) => `<div class="item ho${now(h) ? ' on' : ''}"><div class="row between"><strong>${esc(h.title)}</strong>${now(h) ? '<span class="pill ok">Shown this session</span>' : h.shown ? `<span class="pill mut">Shown in session ${h.shown}</span>` : '<span class="pill mut">Not shown yet</span>'}</div>
      ${(h.img && IMGS[h.img]) || h.body ? `<div class="horow">${h.img && IMGS[h.img] ? `<img class="hothumb" src="${IMGS[h.img]}" alt="">` : ''}${h.body ? `<p>${esc(h.body.slice(0, 300))}${h.body.length > 300 ? '…' : ''}</p>` : ''}</div>` : ''}
      <div class="row end">${now(h) ? '' : `<button class="btn sm pri" type="button" data-hoshow="${h.id}">Mark shown</button>`}${editBtn('handouts', h.id)}<button class="btn sm ghost" type="button" data-hodel="${h.id}">Delete</button></div></div>`
            )
            .join('')}</div>`
        : '<div class="empty">No handouts yet. Write one, add a picture if you have it, then mark it shown when the players get it.</div>'
    }`,
      bind: () => {
        bindEdits();
        const ov = $('overlay');
        const bindImg = () => {
          $('hoPick').onclick = () => $('hoFile').click();
          $('hoNoImg') &&
            ($('hoNoImg').onclick = () => {
              HO_IMG = null;
              $('hoImg').innerHTML = hoImgHTML(null);
              bindImg();
              $('hoPick').focus();
            });
        };
        bindImg();
        $('hoFile').onchange = (e) => {
          const f = e.target.files[0];
          if (!f) return;
          readImg(f, (d) => {
            const id = uid();
            IMGS[id] = d;
            if (!saveImgs()) {
              delete IMGS[id];
              toast('Not enough browser storage for that image. Try a smaller one.');
              return;
            }
            HO_IMG = id;
            const box = $('hoImg');
            if (box) {
              box.innerHTML = hoImgHTML(id);
              bindImg();
            }
          });
          e.target.value = '';
        };
        $('hoAdd').onclick = () => {
          const t = val('hoT');
          if (!t) {
            toast('Give the handout a title');
            return;
          }
          const im = cur() || null;
          HO_IMG = undefined;
          const had = !!o;
          upsert(
            'handouts',
            o,
            { title: t.slice(0, 120), body: $('hoB').value.trim().slice(0, 20000), img: im },
            { shown: 0 }
          );
          pruneImgs();
          saveImgs();
          if (!had) toast('Handout added');
        };
        ov.querySelectorAll('[data-hoshow]').forEach(
          (x) =>
            (x.onclick = () => {
              const h = S.handouts.find((y) => y.id === x.dataset.hoshow);
              if (h && hoMarkShown(h)) toast(`${h.title} marked as shown`);
            })
        );
        ov.querySelectorAll('[data-hodel]').forEach((x) =>
          armDelete(
            x,
            () => {
              const id = x.dataset.hodel;
              S.handouts = S.handouts.filter((y) => y.id !== id);
              commit();
              pruneImgs();
              saveImgs();
            },
            'Confirm'
          )
        );
      },
    };
  };

  /* Player */
  function playerSave() {
    const p = pdraft;
    const isNew = p._new;
    delete p._new;
    if (isNew && !p._hpT) p.hp = +p.maxHp || 1;
    delete p._hpT;
    {
      const was = S.players.find((x) => x.id === p.id);
      if (!isNew && was && clamp(+p.level || 1, 1, 20) > (+was.level || 1))
        tlog(`${p.name || was.name} reached level ${clamp(+p.level || 1, 1, 20)}.`, true);
    }
    p.name = p.name || 'Unnamed hero';
    p.hp = clamp(+p.hp || 0, 0, +p.maxHp || 1);
    const exh6 = (+p.exh || 0) >= 6 && !p.dead;
    if (exh6) {
      p.hp = 0;
      p.dead = true;
      p.conditions = [...new Set([...(p.conditions || []).filter((c) => c !== 'Concentrating'), 'Unconscious'])];
      tlog(`${p.name} died of Exhaustion.`, true);
    }
    if (isNew) {
      clearExample('players');
      S.players.push(p);
    } else {
      const i = S.players.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const old = S.players[i].name;
        if (old !== p.name)
          S.loot.forEach((l) => {
            if (l.holder === old) l.holder = p.name;
          });
        S.players[i] = p;
      } else S.players.push(p);
      S.battles.forEach((b) =>
        b.combatants.forEach((c) => {
          if (c.pid === p.id) c.name = p.name;
        })
      );
    }
    if (!dirty) pushUndo();
    closeSheet();
    S.example = false;
    normalize();
    save();
    render();
    toast(exh6 ? `${p.name} dies: Exhaustion level 6` : isNew ? `${p.name} joined the party` : 'Saved');
  }
  /* D&D Beyond import: fills a new player from a D&D Beyond character (link, ID, pasted JSON or a saved .json file) */
  const DDB_SK = {
    Acrobatics: 1,
    'Animal Handling': 4,
    Arcana: 3,
    Athletics: 0,
    Deception: 5,
    History: 3,
    Insight: 4,
    Intimidation: 5,
    Investigation: 3,
    Medicine: 4,
    Nature: 3,
    Perception: 4,
    Performance: 5,
    Persuasion: 5,
    Religion: 3,
    'Sleight of Hand': 1,
    Stealth: 1,
    Survival: 4,
  };
  const DDB_COND = [
    null,
    'Blinded',
    'Charmed',
    'Deafened',
    null,
    'Frightened',
    'Grappled',
    'Incapacitated',
    'Invisible',
    'Paralyzed',
    'Petrified',
    'Poisoned',
    'Prone',
    'Restrained',
    'Stunned',
    'Unconscious',
  ];
  const DDB_ALIGN = [
    null,
    'Lawful Good',
    'Neutral Good',
    'Chaotic Good',
    'Lawful Neutral',
    'Neutral',
    'Chaotic Neutral',
    'Lawful Evil',
    'Neutral Evil',
    'Chaotic Evil',
  ];
  const DDB_URL = (id) => `https://character-service.dndbeyond.com/character/v5/character/${id}`;
  let DDB = { for: null, msg: '', bad: false, busy: false };
  // accepts the service reply {success,data:{…}}, the bare character, or that JSON as text
  function ddbChar(raw) {
    let j = raw;
    if (typeof j === 'string') {
      try {
        j = JSON.parse(j.trim().replace(/^\uFEFF/, ''));
      } catch (e) {
        throw new Error('That isn’t valid character JSON. Copy the whole page, from the first { to the last }', {
          cause: e,
        });
      }
    }
    if (j && j.data && typeof j.data === 'object' && !Array.isArray(j.data)) j = j.data;
    if (j && j.character && typeof j.character === 'object') j = j.character;
    if (!j || typeof j !== 'object' || !Array.isArray(j.stats) || !Array.isArray(j.classes))
      throw new Error('That doesn’t look like a D&D Beyond character');
    return j;
  }
  function ddbParse(raw) {
    const c = ddbChar(raw),
      warn = [];
    const nm = (x) => Math.trunc(+x) || 0,
      abl = GC_ABIL.map((a) => a.toLowerCase());
    // equipped (and attuned, where it matters) items are the only ones whose bonuses count
    const inv = (Array.isArray(c.inventory) ? c.inventory : []).filter((i) => i && i.definition);
    const live = (i) => i.equipped && (!i.definition.canAttune || i.isAttuned);
    const M = [];
    Object.entries(c.modifiers && typeof c.modifiers === 'object' ? c.modifiers : {}).forEach(([k, list]) => {
      if (!Array.isArray(list)) return;
      list.forEach((m) => {
        if (!m || typeof m !== 'object') return;
        if (k === 'item') {
          const it = inv.filter((i) => i.definition.id === m.componentId);
          if (it.length && !it.some(live)) return;
        }
        M.push(m);
      });
    });
    const of = (t, s) => M.filter((m) => m.type === t && m.subType === s),
      has = (t, s) => of(t, s).length > 0;
    const statOf = (arr, id) => {
      const s = (Array.isArray(arr) ? arr : []).find((x) => x && x.id === id);
      return s && s.value != null ? nm(s.value) : null;
    };
    const score = abl.map((a, i) => {
      const ov = statOf(c.overrideStats, i + 1);
      if (ov != null) return ov;
      let v =
        (statOf(c.stats, i + 1) ?? 10) +
        (statOf(c.bonusStats, i + 1) || 0) +
        of('bonus', a + '-score').reduce((t, m) => t + nm(m.value ?? m.fixedValue), 0);
      of('set', a + '-score').forEach((m) => (v = Math.max(v, nm(m.value ?? m.fixedValue))));
      return clamp(v, 1, 30);
    });
    const mod = (i) => Math.floor((score[i] - 10) / 2),
      modId = (id) => (id >= 1 && id <= 6 ? mod(id - 1) : 0);
    const amt = (m) =>
      m.value != null || m.fixedValue != null ? nm(m.value ?? m.fixedValue) : m.statId ? modId(m.statId) : 0;
    const sum = (t, s) => of(t, s).reduce((x, m) => x + amt(m), 0);
    // classes: the highest level leads, the starting class breaks a tie
    const cls = c.classes
      .filter((k) => k && k.definition)
      .map((k) => ({
        name: String(k.definition.name || ''),
        sub: (k.subclassDefinition && k.subclassDefinition.name) || '',
        lv: clamp(nm(k.level) || 1, 1, 20),
        start: !!k.isStartingClass,
        used: nm(k.hitDiceUsed),
        cast:
          nm(k.definition.spellCastingAbilityId) ||
          nm(k.subclassDefinition && k.subclassDefinition.spellCastingAbilityId),
      }));
    if (!cls.length) throw new Error('That character has no class yet. Finish the class on D&D Beyond first');
    const lead = [...cls].sort((a, b) => b.lv - a.lv || b.start - a.start)[0],
      level = clamp(
        cls.reduce((t, k) => t + k.lv, 0),
        1,
        20
      ),
      pb = 2 + Math.floor((level - 1) / 4);
    if (!CLASSES.includes(lead.name))
      warn.push(`${lead.name || 'The class'} isn’t one of the board’s classes, so it’s set to Fighter`);
    if (cls.length > 1) warn.push('Multiclass: the board tracks one class, so the full split is in Notes');
    // hit points
    const conM = mod(2);
    let maxHp =
      c.overrideHitPoints != null && +c.overrideHitPoints > 0
        ? nm(c.overrideHitPoints)
        : nm(c.baseHitPoints) +
          nm(c.bonusHitPoints) +
          (conM + sum('bonus', 'hit-points-per-level')) * level +
          sum('bonus', 'hit-points');
    maxHp = clamp(maxHp, 1, 9999);
    const hp = clamp(maxHp - nm(c.removedHitPoints), 0, maxHp);
    // armor class: worn armor or the best unarmored option, then shield and bonuses
    const eq = inv.filter((i) => i.equipped),
      armT = (i) => nm(i.definition.armorTypeId),
      dex = mod(1);
    const armor = eq
        .filter((i) => armT(i) >= 1 && armT(i) <= 3)
        .sort((a, b) => nm(b.definition.armorClass) - nm(a.definition.armorClass))[0],
      shield = eq.find((i) => armT(i) === 4);
    let ac;
    if (armor) {
      const a = nm(armor.definition.armorClass),
        t = armT(armor);
      ac = t === 1 ? a + dex : t === 2 ? a + Math.min(dex, 2) : a;
      ac += sum('bonus', 'armored-armor-class');
    } else {
      ac = 10 + dex;
      of('set', 'unarmored-armor-class').forEach((m) => {
        if (m.statId && shield && m.statId === 5) return;
        ac = Math.max(ac, m.statId ? 10 + dex + modId(m.statId) : nm(m.value) ? nm(m.value) + dex : ac);
      });
      ac += sum('bonus', 'unarmored-armor-class');
    }
    if (shield) ac += nm(shield.definition.armorClass) || 2;
    ac = clamp(ac + sum('bonus', 'armor-class'), 0, 40);
    // checks and skills
    const half =
      has('half-proficiency', 'ability-checks') || has('half-proficiency', 'initiative') ? Math.floor(pb / 2) : 0;
    const mods = {};
    GC_ABIL.forEach(
      (a, i) => (mods[a] = mod(i) + half + sum('bonus', 'ability-checks') + sum('bonus', abl[i] + '-ability-checks'))
    );
    GC_SK.forEach((sk) => {
      const s = sk.toLowerCase().replace(/ /g, '-');
      const pr = has('expertise', s)
        ? 2 * pb
        : has('proficiency', s)
          ? pb
          : has('half-proficiency', s)
            ? Math.floor(pb / 2)
            : half;
      mods[sk] = mod(DDB_SK[sk]) + pr + sum('bonus', s) + sum('bonus', 'ability-checks');
    });
    const passive = (sk) => 10 + mods[sk] + sum('bonus', 'passive-' + sk.toLowerCase());
    const ini = dex + (has('proficiency', 'initiative') ? pb : half) + sum('bonus', 'initiative');
    // walking speed
    const sp = c.race && c.race.weightSpeeds && c.race.weightSpeeds.normal;
    let spd = sp && sp.walk != null ? nm(sp.walk) : 30;
    of('set', 'innate-speed-walking').forEach((m) => (spd = Math.max(spd, nm(m.value))));
    spd += sum('bonus', 'speed') + sum('bonus', 'speed-walking');
    if (!armor && !shield) {
      const um = of('bonus', 'unarmored-movement');
      const monk = cls.find((k) => k.name === 'Monk');
      spd += um.some((m) => nm(m.value))
        ? um.reduce((t, m) => t + nm(m.value), 0)
        : monk && monk.lv >= 2
          ? [0, 10, 10, 10, 10, 15, 15, 15, 15, 20, 20, 20, 20, 25, 25, 25, 25, 30, 30, 30][monk.lv - 1]
          : 0;
    }
    // spellcasting: save DC from the highest-level caster, slots from the board's own tables
    const caster = cls.filter((k) => k.cast).sort((a, b) => b.lv - a.lv)[0];
    const sdc = caster ? clamp(8 + pb + modId(caster.cast) + sum('bonus', 'spell-save-dc'), 0, 40) : 0;
    const div = (k) =>
      ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'].includes(k.name)
        ? [1, 0]
        : ['Paladin', 'Ranger', 'Artificer'].includes(k.name)
          ? [2, 1]
          : /Eldritch Knight|Arcane Trickster/.test(k.sub)
            ? [3, 0]
            : null;
    const casters = cls.filter(div);
    let slots = Array(9).fill(0);
    if (casters.length) {
      const cl = casters.reduce((t, k) => {
        const [d, up] = div(k);
        return t + (up ? Math.ceil(k.lv / d) : Math.floor(k.lv / d));
      }, 0);
      if (cl >= 1) SLOT_FULL[Math.min(20, cl)].forEach((v, i) => (slots[i] = v));
    }
    const wl = cls.find((k) => k.name === 'Warlock'),
      pact =
        wl && cls.filter((k) => CLASSES.includes(k.name)).length > 1
          ? { lvl: Math.min(5, Math.ceil(wl.lv / 2)), n: PACT[Math.min(20, wl.lv)], used: 0 }
          : null;
    if (wl && !pact) {
      const pl = Math.min(5, Math.ceil(wl.lv / 2)) - 1;
      slots[pl] = Math.min(9, slots[pl] + PACT[wl.lv]);
    }
    const sused = Array(9).fill(0);
    [
      ...(Array.isArray(c.spellSlots) ? c.spellSlots : []),
      ...(pact ? [] : Array.isArray(c.pactMagic) ? c.pactMagic : []),
    ].forEach((s) => {
      const l = nm(s && s.level) - 1;
      if (l >= 0 && l < 9) sused[l] = Math.min(slots[l], sused[l] + nm(s.used));
    });
    if (pact)
      (Array.isArray(c.pactMagic) ? c.pactMagic : []).forEach((s) => {
        pact.used = Math.min(pact.n, pact.used + nm(s && s.used));
      });
    // conditions, exhaustion, death saves
    const conds = [];
    let exh = 0;
    (Array.isArray(c.conditions) ? c.conditions : []).forEach((k) => {
      if (!k) return;
      if (k.id === 4) exh = clamp(nm(k.level), 0, 6);
      else if (DDB_COND[k.id]) conds.push(DDB_COND[k.id]);
    });
    const dsv = c.deathSaves || {};
    // the rest goes into Notes, so nothing on the sheet is lost
    const t = c.traits || {},
      bg =
        (c.background &&
          ((c.background.definition && c.background.definition.name) ||
            (c.background.customBackground && c.background.customBackground.name))) ||
        '';
    const species = (c.race && (c.race.fullName || c.race.baseRaceName || c.race.baseName)) || '';
    const saves = GC_ABIL.filter((a, i) => has('proficiency', abl[i] + '-saving-throws')).map((a) =>
      a.slice(0, 3).toUpperCase()
    );
    const sk = GC_SK.filter((s) => {
      const k = s.toLowerCase().replace(/ /g, '-');
      return has('proficiency', k) || has('expertise', k);
    }).map((s) => `${s} ${ddbSg(mods[s])}`);
    const langs = [
      ...new Set(
        M.filter((m) => m.type === 'language')
          .map((m) => m.friendlySubtypeName)
          .filter(Boolean)
      ),
    ];
    const line = (l, v) => (v && String(v).trim() ? `${l}: ${String(v).trim()}` : '');
    const notes = [
      `From D&D Beyond${c.id ? ` (character ${nm(c.id)})` : ''}, imported ${today()}.`,
      [line('Species', species), line('Background', bg), line('Alignment', DDB_ALIGN[c.alignmentId])]
        .filter(Boolean)
        .join(' · '),
      'Class: ' + cls.map((k) => `${k.name} ${k.lv}${k.sub ? ` (${k.sub})` : ''}`).join(' / '),
      GC_ABIL.map((a, i) => `${a.slice(0, 3).toUpperCase()} ${score[i]} (${ddbSg(mod(i))})`).join(' · '),
      line('Saving throws', saves.join(', ')),
      line('Skills', sk.join(', ')),
      line('Languages', langs.join(', ')),
      line('Personality', t.personalityTraits),
      line('Ideals', t.ideals),
      line('Flaws', t.flaws),
      line('Backstory', c.notes && c.notes.backstory),
    ]
      .filter(Boolean)
      .join('\n');
    const p = {
      name: str(c.name, 80).trim() || 'Unnamed hero',
      cls: CLASSES.includes(lead.name) ? lead.name : 'Fighter',
      level,
      maxHp,
      hp,
      thp: clamp(nm(c.temporaryHitPoints), 0, 9999),
      ac,
      ini: clamp(ini, -20, 30),
      pp: clamp(passive('Perception'), 0, 40),
      pins: clamp(passive('Insight'), 0, 40),
      pinv: clamp(passive('Investigation'), 0, 40),
      sdc,
      spd: clamp(spd, 0, 200),
      xp: clamp(nm(c.currentXp), 0, 1e7),
      hdu: clamp(
        cls.reduce((x, k) => x + k.used, 0),
        0,
        level
      ),
      insp: !!c.inspiration,
      exh,
      conditions: [...new Set(conds)],
      mods,
      notes: str(notes, 20000),
    };
    if (slots.some((v) => v)) Object.assign(p, { slots, sused });
    if (pact && pact.n) p.pact = pact;
    if (hp <= 0) p.ds = { s: clamp(nm(dsv.successCount), 0, 3), f: clamp(nm(dsv.failCount), 0, 3) };
    if (t.bonds && String(t.bonds).trim()) p.bond = str(String(t.bonds).trim(), 300);
    growDdb(c, p, { score, cls, has, pb });
    return {
      p,
      warn,
      summary: `${p.name}: ${cls.map((k) => `${k.name} ${k.lv}`).join(' / ')}${species ? `, ${species}` : ''}`,
    };
  }
  const ddbSg = (n) => (n >= 0 ? '+' : '') + n;
  // put an import onto the open new-player sheet; the player name and anything typed in Hooks stay
  function ddbApply(raw) {
    if (pdraft && !pdraft._new) {
      ddbUpdate(raw);
      return;
    }
    const r = ddbParse(raw),
      d = pdraft,
      { bond, ...p } = r.p;
    d._hpT = true;
    Object.assign(d, p);
    if (bond) {
      d.hooks = d.hooks || {};
      if (!(d.hooks.bond || '').trim()) d.hooks.bond = bond;
    }
    if (!r.p.slots) {
      delete d.slots;
      delete d.sused;
    }
    if (!r.p.pact) delete d.pact;
    DDB = {
      for: d.id,
      bad: false,
      busy: false,
      msg: `Imported ${r.summary}. Check the numbers, AC especially, then add them to the party.${r.warn.length ? ' ' + r.warn.join('. ') + '.' : ''}`,
    };
    drawSheet();
    toast(`${r.p.name} imported from D&D Beyond`);
  }
  function ddbFail(msg) {
    DDB = { for: pdraft && pdraft.id, bad: true, busy: false, msg };
    const el = $('ddbMsg');
    if (el) {
      el.className = 'ddbmsg bad';
      el.innerHTML = msg;
    }
  }
  const ddbId = (s) => {
    const m = String(s).match(/(?:characters?\/|^\s*)(\d{4,12})(?:\D|$)/);
    return m ? m[1] : null;
  };
  async function ddbGo(text) {
    text = String(text || '').trim();
    if (!text) {
      ddbFail('Paste a D&D Beyond link, a character ID, or the character’s JSON first.');
      return;
    }
    if (/^[[{]/.test(text.replace(/^\uFEFF/, ''))) {
      try {
        ddbApply(text);
      } catch (e) {
        ddbFail(esc(e.message) + '.');
      }
      return;
    }
    const id = ddbId(text);
    if (!id) {
      ddbFail('No character ID found. A link looks like dndbeyond.com/characters/12345678.');
      return;
    }
    const how = `Open <a href="${DDB_URL(id)}" target="_blank" rel="noopener">the character’s data</a>, press Ctrl+A then Ctrl+C (⌘A, ⌘C on a Mac), and paste it in the box. Saving that page as a .json file and choosing it works too.`;
    DDB = { for: pdraft.id, bad: false, busy: true, msg: 'Fetching from D&D Beyond…' };
    const el = $('ddbMsg');
    if (el) {
      el.className = 'ddbmsg';
      el.textContent = DDB.msg;
    }
    let res;
    const ac = new AbortController(),
      tm = setTimeout(() => ac.abort(), 10000);
    try {
      res = await fetch(DDB_URL(id), { signal: ac.signal, credentials: 'omit' });
    } catch (e) {
      clearTimeout(tm);
      ddbFail(`The board couldn’t reach D&D Beyond directly. ${how}`);
      return;
    }
    clearTimeout(tm);
    if (!pdraft) return;
    if (!res.ok) {
      ddbFail(
        res.status === 403 || res.status === 401 || res.status === 404
          ? `D&D Beyond won’t share character ${id}. On D&D Beyond, set its Privacy to Public, then try again. Or: ${how}`
          : `D&D Beyond answered with an error (${res.status}). ${how}`
      );
      return;
    }
    try {
      const j = await res.json();
      if (j && j.success === false) throw new Error(j.message || 'not shared');
      ddbApply(j);
    } catch (e) {
      ddbFail(`That character couldn’t be read (${esc(e.message)}). ${how}`);
    }
  }
  // Experimental: paste or choose the character JSON (primary); fetching is a secondary "may not work" try
  const ddbBox = () => {
    const on = DDB.for === pdraft.id && DDB.msg;
    return `<details class="box ddb" id="ddbD"${on && DDB.bad ? ' open' : ''}><summary>Import from D&D Beyond <span class="pill">Experimental</span></summary>
  <p class="meta">Experimental: D&D Beyond can change its format without notice. Check every number after importing. Nothing is saved until you press Add to party / Save changes.</p>
  <ol class="ddbsteps">
  <li>On D&D Beyond, set the character’s Privacy to Public.</li>
  <li><label for="ddbId">Paste the character’s link or ID here:</label> <input type="text" id="ddbId" autocomplete="off" spellcheck="false" placeholder="dndbeyond.com/characters/12345678"> <a class="lnk" id="ddbOpen" target="_blank" rel="noopener" hidden>Open character data</a></li>
  <li id="ddbStep3" tabindex="-1">On that page press Ctrl+A, Ctrl+C (⌘A, ⌘C on a Mac), then paste into the box below, or save the page as a .json file and choose it.
  <textarea id="ddbIn" rows="2" placeholder="{&quot;id&quot;: … }" aria-label="Character data (JSON)"></textarea>
  <div class="row"><button class="btn sm pri" type="button" id="ddbGo">Import pasted data</button><button class="btn sm" type="button" id="ddbFile">Choose a .json file…</button><input type="file" id="ddbF" accept=".json,application/json,text/plain" hidden></div></li>
  </ol>
  <div class="row"><button class="btn sm ghost" type="button" id="ddbFetch">Try fetching it for me</button><span class="meta">May not work: D&D Beyond often blocks this.</span></div></details>
  ${on ? `<p class="ddbmsg${DDB.bad ? ' bad' : ''}" id="ddbMsg" role="status">${DDB.bad ? DDB.msg : esc(DDB.msg)}</p>` : '<p class="ddbmsg" id="ddbMsg" role="status" hidden></p>'}`;
  };
  function bindDdb() {
    const go = $('ddbGo');
    if (!go) return;
    const msgShow = () => {
      const m = $('ddbMsg');
      if (m) m.hidden = false;
    };
    const idIn = $('ddbId'),
      open = $('ddbOpen');
    const idUpd = () => {
      const id = ddbId(idIn.value);
      open.hidden = !id;
      if (id) open.href = DDB_URL(id);
      else open.removeAttribute('href');
    };
    idIn.oninput = idUpd;
    go.onclick = () => {
      msgShow();
      const t = $('ddbIn').value;
      if (t.length > 5e6) {
        ddbFail('That text is too big to be a character export.');
        return;
      }
      if (!t.trim()) {
        ddbFail('Paste the character’s data first (step 3), or choose a .json file.');
        return;
      }
      if (!/^[[{]/.test(t.trim().replace(/^\uFEFF/, ''))) {
        ddbFail('That isn’t the character’s data. Paste what the Open character data page shows (it starts with {).');
        return;
      }
      ddbGo(t);
    };
    $('ddbFetch').onclick = async () => {
      msgShow();
      await ddbGo(idIn.value);
      if (DDB.bad) {
        const st = $('ddbStep3');
        st && st.focus();
      }
    };
    idIn.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        idUpd();
      }
    };
    $('ddbFile').onclick = () => $('ddbF').click();
    $('ddbF').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      msgShow();
      if (f.size > 5e6) {
        ddbFail('That file is too big to be a character export.');
        return;
      }
      f.text().then(
        (t) => {
          try {
            ddbApply(t);
          } catch (err) {
            ddbFail(esc(err.message) + '.');
          }
        },
        () => ddbFail('That file couldn’t be read.')
      );
    };
  }
  window.DDB_IMPORT = { parse: ddbParse, id: ddbId };
  /* ---------- character growth: level up, abilities, limited-use resources, D&D Beyond update ---------- */
  const pbOf = (lv) => 2 + Math.floor((clamp(+lv || 1, 1, 20) - 1) / 4);
  const hdAvg = (d) => d / 2 + 1; // 2024 fixed hit points per level: d6 4, d8 5, d10 6, d12 7
  const abMod = (s) => Math.floor(((+s || 10) - 10) / 2);
  const AB3 = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const hasAb = (p) => !!(p && p.ab && Array.isArray(p.ab.sc));
  const gsg = (n) => (n < 0 ? '−' : '+') + Math.abs(n);
  // 2024 saving throw proficiencies and skill lists by class
  const CLS_SAVES = {
    Barbarian: [0, 2],
    Bard: [1, 5],
    Cleric: [4, 5],
    Druid: [3, 4],
    Fighter: [0, 2],
    Monk: [0, 1],
    Paladin: [4, 5],
    Ranger: [0, 1],
    Rogue: [1, 3],
    Sorcerer: [2, 5],
    Warlock: [4, 5],
    Wizard: [3, 4],
  };
  const CLS_SK = {
    Barbarian: [2, 'Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival'],
    Bard: [3],
    Cleric: [2, 'History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
    Druid: [2, 'Arcana', 'Animal Handling', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival'],
    Fighter: [
      2,
      'Acrobatics',
      'Animal Handling',
      'Athletics',
      'History',
      'Insight',
      'Intimidation',
      'Persuasion',
      'Perception',
      'Survival',
    ],
    Monk: [2, 'Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth'],
    Paladin: [2, 'Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'],
    Ranger: [
      3,
      'Animal Handling',
      'Athletics',
      'Insight',
      'Investigation',
      'Nature',
      'Perception',
      'Stealth',
      'Survival',
    ],
    Rogue: [
      4,
      'Acrobatics',
      'Athletics',
      'Deception',
      'Insight',
      'Intimidation',
      'Investigation',
      'Perception',
      'Persuasion',
      'Sleight of Hand',
      'Stealth',
    ],
    Sorcerer: [2, 'Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion'],
    Warlock: [2, 'Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion'],
    Wizard: [2, 'Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Nature', 'Religion'],
  };
  const clsSkill = (cls, s) => {
    const l = CLS_SK[cls];
    return !!l && (l.length === 1 || l.includes(s));
  };
  // the plain ability modifier: stored score, else a typed check modifier, else 0
  function abilityMod(p, a) {
    const i = GC_ABIL.indexOf(a);
    if (hasAb(p)) return abMod(p.ab.sc[i]);
    return p && p.mods && p.mods[a] != null ? +p.mods[a] : 0;
  }
  // a check or save worked out from stored scores and the Proficiency Bonus; null when the sheet has no scores
  function abCalc(p, k) {
    if (!hasAb(p)) return null;
    const a = p.ab,
      pb = pbOf(p.level),
      half = a.jat ? Math.floor(pb / 2) : 0;
    if (String(k).startsWith('save:')) {
      const j = GC_ABIL.indexOf(k.slice(5));
      return j < 0 ? null : abMod(a.sc[j]) + (a.sv[j] ? pb : 0);
    }
    const i = GC_ABIL.indexOf(k);
    if (i >= 0) return abMod(a.sc[i]) + half;
    const si = DDB_SK[k];
    if (si == null) return null;
    const pr = +(a.sk[k] || 0);
    return abMod(a.sc[si]) + (pr === 2 ? 2 * pb : pr === 1 ? pb : half);
  }
  const calcAll = (p) => {
    const o = {};
    GC_ALL.forEach((k) => (o[k] = abCalc(p, k)));
    return o;
  };
  const PASS = [
    ['pp', 'Perception'],
    ['pins', 'Insight'],
    ['pinv', 'Investigation'],
  ];
  const passAuto = (p) => {
    const o = {};
    PASS.forEach(([f, k]) => {
      const c = abCalc(p, k);
      o[f] = c == null ? null : 10 + (p.mods && p.mods[k] != null ? +p.mods[k] : c);
    });
    return o;
  };
  // change a character and keep the derived numbers honest: hand-typed modifiers keep their extra bonus, and passives that were never typed follow the scores
  function growSync(p, fn) {
    const b = calcAll(p),
      pa = passAuto(p),
      old = {};
    PASS.forEach(([f]) => (old[f] = p[f]));
    fn();
    const a = calcAll(p);
    if (p.mods && typeof p.mods === 'object')
      Object.keys(p.mods).forEach((k) => {
        if (b[k] != null && a[k] != null) p.mods[k] = clamp(+p.mods[k] + a[k] - b[k], -20, 30);
        else if (b[k] == null && a[k] != null && +p.mods[k] === a[k]) delete p.mods[k];
      });
    const na = passAuto(p);
    PASS.forEach(([f]) => {
      if (na[f] == null) return;
      const cur = old[f] == null || old[f] === '' ? 10 : +old[f];
      if (pa[f] != null ? cur === pa[f] : cur === 10) p[f] = clamp(na[f], 0, 40);
    });
  }

  /* limited-use features: 2024 SRD 5.2 class presets, plus anything the DM adds */
  const RC = {
    short: 'Short or long rest',
    short1: 'One back on a short rest, all on a long rest',
    long: 'Long rest',
    dawn: 'Dawn',
    manual: 'By hand',
  };
  const RES_PRE = {
    rage: {
      n: 'Rage',
      c: 'Barbarian',
      from: 1,
      max: (l) => (l >= 17 ? 6 : l >= 12 ? 5 : l >= 6 ? 4 : l >= 3 ? 3 : 2),
      rc: 'short1',
    },
    bardic: { n: 'Bardic Inspiration', c: 'Bard', from: 1, ab: 'Charisma', rc: (l) => (l >= 5 ? 'short' : 'long') },
    cdC: { n: 'Channel Divinity', c: 'Cleric', from: 2, max: (l) => (l >= 18 ? 4 : l >= 6 ? 3 : 2), rc: 'short1' },
    wild: { n: 'Wild Shape', c: 'Druid', from: 2, max: (l) => (l >= 17 ? 4 : l >= 6 ? 3 : 2), rc: 'short1' },
    sw: { n: 'Second Wind', c: 'Fighter', from: 1, max: (l) => (l >= 10 ? 4 : l >= 4 ? 3 : 2), rc: 'short1' },
    surge: { n: 'Action Surge', c: 'Fighter', from: 2, max: (l) => (l >= 17 ? 2 : 1), rc: 'short' },
    indom: { n: 'Indomitable', c: 'Fighter', from: 9, max: (l) => (l >= 17 ? 3 : l >= 13 ? 2 : 1), rc: 'long' },
    focus: { n: 'Focus Points', c: 'Monk', from: 2, max: (l) => l, rc: 'short' },
    meta: { n: 'Uncanny Metabolism', c: 'Monk', from: 2, max: () => 1, rc: 'long' },
    cdP: { n: 'Channel Divinity', c: 'Paladin', from: 3, max: (l) => (l >= 11 ? 3 : 2), rc: 'short1' },
    loh: { n: 'Lay on Hands', c: 'Paladin', from: 1, max: (l) => 5 * l, rc: 'long' },
    mark: {
      n: 'Favored Enemy',
      c: 'Ranger',
      from: 1,
      max: (l) => (l >= 17 ? 6 : l >= 13 ? 5 : l >= 9 ? 4 : l >= 5 ? 3 : 2),
      rc: 'long',
    },
    luck: { n: 'Stroke of Luck', c: 'Rogue', from: 20, max: () => 1, rc: 'short' },
    sorc: { n: 'Sorcery Points', c: 'Sorcerer', from: 2, max: (l) => l, rc: 'long' },
    cunning: { n: 'Magical Cunning', c: 'Warlock', from: 2, max: () => 1, rc: 'long' },
    arcrec: { n: 'Arcane Recovery', c: 'Wizard', from: 1, max: () => 1, rc: 'long' },
  };
  const classLevel = (p, c) => {
    if (Array.isArray(p.mc)) {
      const m = p.mc.find((x) => x.c === c);
      return m ? m.l : 0;
    }
    return p.cls === c ? +p.level || 1 : 0;
  };
  const preLevel = (p, k) => classLevel(p, RES_PRE[k].c) || +p.level || 1;
  function resMax(p, r) {
    let v;
    if (r.kind === 'pre' && RES_PRE[r.pre]) {
      const P = RES_PRE[r.pre];
      v = P.ab ? Math.max(1, abilityMod(p, P.ab)) : P.max(preLevel(p, r.pre));
    } else if (r.kind === 'pb') v = pbOf(p.level);
    else if (r.kind === 'mod') v = Math.max(1, abilityMod(p, r.ab || 'Charisma'));
    else if (r.kind === 'lvl') v = (+p.level || 1) * Math.max(1, +r.n || 1);
    else v = +r.n || 0;
    return clamp(Math.round(v), 0, 99);
  }
  const resRc = (p, r) => {
    if (r.kind === 'pre' && RES_PRE[r.pre]) {
      const x = RES_PRE[r.pre].rc;
      return typeof x === 'function' ? x(preLevel(p, r.pre)) : x;
    }
    return RC[r.rc] ? r.rc : 'long';
  };
  const resLeft = (p, r) => Math.max(0, resMax(p, r) - (+r.used || 0));
  // rests and dawn give uses back by each feature's recharge
  function restoreRes(p, kind) {
    (p.res || []).forEach((r) => {
      const rc = resRc(p, r);
      if (kind === 'dawn' ? rc === 'dawn' : kind === 'long' ? ['short', 'short1', 'long'].includes(rc) : rc === 'short')
        r.used = 0;
      else if (kind === 'short' && rc === 'short1') r.used = Math.max(0, (+r.used || 0) - 1);
    });
  }
  function dawnRes(m) {
    if (!(m > 0) || !S.players) return;
    const t = S.time || {},
      a = (+t.day || 1) * 1440 + (+t.min || 0) - 360;
    if (Math.floor((a + m) / 1440) > Math.floor(a / 1440))
      S.players.forEach((p) => {
        if (!p.dead) restoreRes(p, 'dawn');
      });
  }
  function resNew(p, key) {
    const P = RES_PRE[key];
    return { id: uid(), name: P.n, kind: 'pre', pre: key, n: 0, ab: '', rc: 'long', used: 0, card: false };
  }
  const resTitle = (p, r) => `${r.name}: ${resLeft(p, r)} of ${resMax(p, r)} left. Recharge: ${RC[resRc(p, r)]}`;
  // pips for small pools, a counter with − and + for big ones (Lay on Hands, Focus Points…)
  function resRow(p, r) {
    const mx = resMax(p, r),
      av = resLeft(p, r),
      k = `${p.id}:${r.id}`;
    if (mx <= 10)
      return `<span class="sl" title="${esc(resTitle(p, r))}"><em>${esc(r.name)}</em>${Array.from({ length: mx }, (_, i) => `<button type="button" class="pip${i < av ? ' on' : ''}" data-res="${k}" data-k="${i}" aria-label="${esc(r.name)} use ${i + 1}, ${i < av ? 'available' : 'spent'}"></button>`).join('')}</span>`;
    return `<span class="sl" title="${esc(resTitle(p, r))}"><em>${esc(r.name)}</em><button type="button" class="lnk" data-resd="${k}" data-d="1" aria-label="Spend one ${esc(r.name)}">−</button><b class="num">${av}/${mx}</b><button type="button" class="lnk" data-resd="${k}" data-d="-1" aria-label="Get one ${esc(r.name)} back">+</button></span>`;
  }
  function resCardHTML(p) {
    const rs = (p.res || []).filter((r) => r.card && resMax(p, r) > 0);
    return rs.length
      ? `<div class="slots rescard" aria-label="Limited-use features">${rs.map((r) => resRow(p, r)).join('')}</div>`
      : '';
  }
  function bindRes(root, find, done) {
    root.querySelectorAll('[data-res]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          const [pid, rid] = b.dataset.res.split(':'),
            p = find(pid),
            r = p && (p.res || []).find((x) => x.id === rid);
          if (!r) return;
          const mx = resMax(p, r),
            av = resLeft(p, r);
          r.used = clamp((+r.used || 0) + (+b.dataset.k < av ? 1 : -1), 0, mx);
          done();
        })
    );
    root.querySelectorAll('[data-resd]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          const [pid, rid] = b.dataset.resd.split(':'),
            p = find(pid),
            r = p && (p.res || []).find((x) => x.id === rid);
          if (!r) return;
          r.used = clamp((+r.used || 0) + +b.dataset.d, 0, resMax(p, r));
          done();
        })
    );
  }
  // old backups have none of these fields; anything odd is cleaned or dropped
  function growNorm(p) {
    if (p.ab && typeof p.ab === 'object' && !Array.isArray(p.ab)) {
      const a = p.ab,
        sk = a.sk && typeof a.sk === 'object' && !Array.isArray(a.sk) ? a.sk : {};
      p.ab = {
        sc: Array.from({ length: 6 }, (_, i) => int(arr(a.sc)[i], 10, 1, 30)),
        sv: Array.from({ length: 6 }, (_, i) => (arr(a.sv)[i] ? 1 : 0)),
        sk: {},
        jat: !!a.jat,
      };
      GC_SK.forEach((k) => {
        const v = int(sk[k], 0, 0, 2);
        if (v) p.ab.sk[k] = v;
      });
    } else delete p.ab;
    if (Array.isArray(p.mc)) {
      const m = objs(p.mc)
        .map((x) => ({ c: CLASSES.includes(x.c) ? x.c : '', l: int(x.l, 1, 1, 20) }))
        .filter((x) => x.c)
        .slice(0, 6);
      if (m.length > 1 && m.reduce((t, x) => t + x.l, 0) === p.level) p.mc = m;
      else delete p.mc;
    } else delete p.mc;
    if (p.res != null) {
      p.res = objs(p.res)
        .slice(0, 30)
        .map((r) => {
          fixId(r);
          const kind = ['n', 'pb', 'mod', 'lvl', 'pre'].includes(r.kind) ? r.kind : 'n';
          const o = {
            id: r.id,
            name: str(r.name, 60).trim() || (RES_PRE[r.pre] && RES_PRE[r.pre].n) || 'Feature',
            kind: kind === 'pre' && !RES_PRE[r.pre] ? 'n' : kind,
            pre: RES_PRE[r.pre] ? r.pre : '',
            n: int(r.n, 1, 0, 99),
            ab: GC_ABIL.includes(r.ab) ? r.ab : 'Charisma',
            rc: RC[r.rc] ? r.rc : 'long',
            used: int(r.used, 0, 0, 99),
            card: !!r.card,
          };
          o.used = Math.min(o.used, resMax(p, o));
          return o;
        });
      if (!p.res.length) delete p.res;
    }
  }

  /* level up: the new level, the HP gain (2024 average or a roll), Hit Dice, slots, PB and scaling features, previewed first */
  // a multiclass Warlock keeps Pact Magic apart from the other slots: p.pact = {lvl, n, used}
  const pactOf = (p) => {
    const w = Array.isArray(p.mc) && p.mc.length > 1 && p.mc.find((m) => m.c === 'Warlock');
    return w ? { lvl: Math.min(5, Math.ceil(w.l / 2)), n: PACT[Math.min(20, w.l)] } : null;
  };
  const pactSet = (p, old) => {
    const k = pactOf(p);
    if (k) p.pact = { lvl: k.lvl, n: k.n, used: Math.min(+(old || {}).used || 0, k.n) };
    else delete p.pact;
  };
  const pureWarlock = (p) => p.cls === 'Warlock' && !(Array.isArray(p.mc) && p.mc.length > 1);
  function pactNorm(p) {
    const k = pactOf(p);
    if (!k) {
      delete p.pact;
      return;
    }
    if (p.pact && typeof p.pact === 'object') {
      p.pact = { lvl: k.lvl, n: k.n, used: int(p.pact.used, 0, 0, k.n) };
      return;
    }
    // boards from before this kept the pact slots inside the shared slots: take them back out when they match the tables
    const pl = k.lvl - 1,
      mine = slotsOf(p);
    mine[pl] += k.n;
    let used = 0;
    if (Array.isArray(p.slots) && JSON.stringify(p.slots.map(Number)) === JSON.stringify(mine)) {
      p.slots[pl] -= k.n;
      const u = +(p.sused || [])[pl] || 0;
      used = Math.max(0, u - p.slots[pl]);
      if (p.sused) p.sused[pl] = Math.min(u, p.slots[pl]);
    }
    p.pact = { lvl: k.lvl, n: k.n, used };
  }
  const slotsOf = (p) => {
    if (!Array.isArray(p.mc)) return classSlots(p.cls, p.level);
    const s = Array(9).fill(0);
    const cl = p.mc.reduce(
      (t, m) =>
        t +
        (['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'].includes(m.c)
          ? m.l
          : ['Paladin', 'Ranger'].includes(m.c)
            ? Math.ceil(m.l / 2)
            : 0),
      0
    );
    if (cl >= 1) SLOT_FULL[Math.min(20, cl)].forEach((v, i) => (s[i] = v));
    const w = p.mc.length < 2 && p.mc.find((m) => m.c === 'Warlock');
    if (w) {
      const pl = Math.min(5, Math.ceil(w.l / 2)) - 1;
      s[pl] = Math.min(9, s[pl] + PACT[w.l]);
    }
    return s;
  };
  const slotsAuto = (p) =>
    !Array.isArray(p.slots) ||
    !p.slots.some((v) => +v) ||
    JSON.stringify(p.slots.map(Number)) === JSON.stringify(slotsOf(p));
  function lvlPlan(p, o) {
    const c = JSON.parse(JSON.stringify(p));
    const cls = o.cls || p.cls,
      die = HIT_DIE[cls] || 8,
      auto = slotsAuto(p);
    const base = o.how === 'roll' && o.roll ? o.roll : hdAvg(die),
      gain = Math.max(1, base + (+o.con || 0));
    growSync(c, () => {
      c.level = (+p.level || 1) + 1;
      if (Array.isArray(c.mc)) {
        const m = c.mc.find((x) => x.c === cls);
        if (m) m.l++;
        else c.mc.push({ c: cls, l: 1 });
      } else if (cls !== p.cls) {
        c.mc = [
          { c: p.cls, l: +p.level || 1 },
          { c: cls, l: 1 },
        ];
      }
    });
    c.maxHp = (+p.maxHp || 1) + gain;
    if (!c.dead && (+c.hp || 0) > 0) c.hp = (+p.hp || 0) + gain;
    const ns = slotsOf(c);
    pactSet(c, p.pact);
    if (auto || o.slots) {
      if (ns.some((v) => v) || Array.isArray(p.slots)) {
        c.slots = ns;
        c.sused = Array.from({ length: 9 }, (_, i) => Math.min(+(p.sused || [])[i] || 0, ns[i]));
      }
    }
    return { c, die, gain, base, auto, cls };
  }
  function lvlPop(id, queue) {
    queue = queue || [];
    const next = () => {
      if (queue.length) lvlPop(queue[0], queue.slice(1));
    };
    const p = S.players.find((x) => x.id === id);
    if (!p || (+p.level || 1) >= 20) {
      if (p) toast(`${p.name} is already level 20`);
      next();
      return;
    }
    const o = { how: 'avg', roll: 0, spin: false, con: abilityMod(p, 'Constitution'), cls: p.cls, slots: false },
      el = popup('Level up', '');
    const draw = () => {
      const L = (+p.level || 1) + 1,
        pl = lvlPlan(p, o),
        c = pl.c,
        pb0 = pbOf(p.level),
        pb1 = pbOf(L);
      const slotRows = ORD.map((n, i) => {
        const a = +(p.slots || [])[i] || 0,
          b = +(c.slots || p.slots || [])[i] || 0;
        return a !== b ? `${n} ${a} → ${b}` : '';
      }).filter(Boolean);
      const resRows = (p.res || [])
        .map((r) => {
          const a = resMax(p, r),
            b = resMax(c, r);
          return a !== b ? `${r.name} ${a} → ${b}` : '';
        })
        .filter(Boolean);
      const spun = o.spin ? reelsHTML({ dice: [{ f: pl.die, v: o.roll }] }, true) : { html: '', end: 0 };
      o.spin = false;
      el.querySelector('.mc').innerHTML =
        popHead(
          `${p.name} reaches level ${L}`,
          `${queue.length ? `Milestone level up. ${plural(queue.length, 'more player')} after this one. ` : ''}Choose how hit points go up, check the preview, then Level up.`
        ) +
        `
      ${Array.isArray(p.mc) || o.mcOpen ? `<label class="f">Class that gains the level<select id="luCls">${CLASSES.map((k) => `<option${k === o.cls ? ' selected' : ''}>${k}</option>`).join('')}</select></label>` : ''}
      <div class="seg" role="group" aria-label="Hit points"><button type="button" data-luh="avg" aria-pressed="${o.how === 'avg'}">Average: ${hdAvg(pl.die)}</button><button type="button" data-luh="roll" aria-pressed="${o.how === 'roll'}">${o.roll ? `Rolled ${o.roll} · roll again` : `Roll d${pl.die}`}</button></div>
      ${spun.html ? `<div class="dres spinning" style="--t:${spun.end}ms">${spun.html}<div class="tot late">${o.roll}</div></div>` : ''}
      <label class="f">Constitution modifier<input type="number" id="luCon" min="-5" max="10" value="${o.con}"></label>
      <div class="gclist" id="luPrev">
        <div class="gcrow"><span>Level</span><b class="num">${p.level} → ${L}</b></div>
        <div class="gcrow"><span>Hit point maximum</span><b class="num">${p.maxHp} → ${c.maxHp} <small>(${pl.base} ${o.con < 0 ? '−' : '+'} ${Math.abs(o.con)}${pl.base + o.con < 1 ? ', at least 1' : ''} = +${pl.gain})</small></b></div>
        <div class="gcrow"><span>Current hit points</span><b class="num">${p.hp} → ${c.hp}</b></div>
        <div class="gcrow"><span>Hit Dice</span><b class="num">${hdLeft(p)} / ${p.level} → ${Math.max(0, c.level - (+c.hdu || 0))} / ${c.level} d${pl.die}</b></div>
        <div class="gcrow"><span>Proficiency Bonus</span><b class="num">${pb1 > pb0 ? `+${pb0} → +${pb1}` : `+${pb1}`}</b></div>
        ${slotRows.length ? `<div class="gcrow"><span>Spell slots</span><b class="num">${slotRows.join(', ')}</b></div>` : ''}
        ${resRows.length ? `<div class="gcrow"><span>Features</span><b class="num">${esc(resRows.join(', '))}</b></div>` : ''}
      </div>
      ${!pl.auto ? `<label class="toggles" style="display:flex"><label><input type="checkbox" id="luSl"${o.slots ? ' checked' : ''}>Replace the hand-set spell slots with the level ${L} table</label></label>` : ''}
      ${!Array.isArray(p.mc) && !o.mcOpen ? '<button class="lnk" type="button" id="luMc">Multiclass: a level in another class</button>' : ''}
      <div class="row end">${queue.length ? '<button class="btn ghost" type="button" id="luSkip">Skip</button>' : ''}<button class="btn ghost" type="button" data-mclose>Cancel</button><button class="btn pri" type="button" id="luGo">Level up</button></div>`;
      el.querySelectorAll('[data-luh]').forEach(
        (b) =>
          (b.onclick = () => {
            o.how = b.dataset.luh;
            if (o.how === 'roll') {
              o.roll = rnd(pl.die);
              o.spin = true;
            }
            draw();
          })
      );
      const ci = el.querySelector('#luCon');
      ci.onchange = () => {
        o.con = clamp(Math.round(+ci.value || 0), -5, 10);
        draw();
      };
      el.querySelector('#luCls') &&
        (el.querySelector('#luCls').onchange = (e) => {
          o.cls = e.target.value;
          o.roll = 0;
          o.how = 'avg';
          draw();
        });
      el.querySelector('#luMc') &&
        (el.querySelector('#luMc').onclick = () => {
          o.mcOpen = true;
          draw();
        });
      el.querySelector('#luSl') &&
        (el.querySelector('#luSl').onchange = (e) => {
          o.slots = e.target.checked;
          draw();
        });
      el.querySelector('#luSkip') &&
        (el.querySelector('#luSkip').onclick = () => {
          el.remove();
          next();
        });
      el.querySelector('#luGo').onclick = () => {
        const P2 = lvlPlan(p, o),
          q = P2.c;
        ['level', 'maxHp', 'hp', 'slots', 'sused', 'mods', 'pp', 'pins', 'pinv', 'mc', 'pact'].forEach((k) => {
          if (q[k] === undefined) delete p[k];
          else p[k] = q[k];
        });
        tlog(`${p.name} reached level ${p.level}${Array.isArray(p.mc) ? ` (${o.cls})` : ''}.`, true);
        if (view && view.sec === 'player' && pdraft && pdraft.id === p.id && !pdraft._new) {
          ['level', 'maxHp', 'hp', 'slots', 'sused', 'mods', 'pp', 'pins', 'pinv', 'mc', 'cls', 'pact'].forEach((k) => {
            if (p[k] === undefined) delete pdraft[k];
            else pdraft[k] = JSON.parse(JSON.stringify(p[k]));
          });
        }
        el.remove();
        commit();
        toast(
          `${p.name} is level ${p.level}: +${P2.gain} max HP, Proficiency Bonus +${pbOf(p.level)}.${queue.length ? '' : ' Undo with Ctrl+Z'}`
        );
        next();
      };
      el.querySelector('#luGo').focus();
    };
    draw();
  }
  function lvlQueue(ids) {
    ids = ids.filter((id) => {
      const p = S.players.find((x) => x.id === id);
      return p && (+p.level || 1) < 20;
    });
    if (ids.length) lvlPop(ids[0], ids.slice(1));
  }

  /* sheet: Abilities */
  VIEWS.player.abilities = () => {
    const p = pdraft;
    if (!hasAb(p))
      return {
        html:
          head(
            'Abilities',
            'Ability scores, saving throws and skills. The board works out every modifier with the Proficiency Bonus, and Group check and Secret check use them.'
          ) +
          `
    <div class="empty">No ability scores yet. <button class="btn sm pri" type="button" id="abAdd">Add ability scores</button></div>
    <p class="quiet">D&D Beyond import fills these in. Typed modifiers from Group check stay as they are until you add scores.</p>${pFooter()}`,
        bind: () => {
          bindPFooter();
          $('abAdd').onclick = () => {
            growSync(p, () => {
              const sv = CLS_SAVES[p.cls] || [];
              p.ab = {
                sc: [10, 10, 10, 10, 10, 10],
                sv: [0, 1, 2, 3, 4, 5].map((i) => (sv.includes(i) ? 1 : 0)),
                sk: {},
                jat: false,
              };
            });
            drawSheet();
          };
        },
      };
    const a = p.ab,
      pb = pbOf(p.level),
      eff = (k) => (p.mods && p.mods[k] != null ? +p.mods[k] : abCalc(p, k)),
      cs = CLS_SK[p.cls] || [0];
    return {
      html:
        head(
          'Abilities',
          `Proficiency Bonus +${pb} at level ${esc(p.level)}. Modifiers update as scores, proficiencies and level change.`
        ) +
        `
  <div class="box"><h4>Ability scores and saving throws</h4><div class="grid">${GC_ABIL.map((n, i) => `<label class="f">${n} <span class="num meta">${gsg(abMod(a.sc[i]))}</span><input type="number" min="1" max="30" data-absc="${i}" value="${a.sc[i]}"></label>`).join('')}</div>
    <div class="toggles">${GC_ABIL.map((n, i) => `<label title="Save ${gsg(abCalc(p, 'save:' + n))}"><input type="checkbox" data-absv="${i}"${a.sv[i] ? ' checked' : ''}>${AB3[i]} save ${gsg(abCalc(p, 'save:' + n))}</label>`).join('')}</div></div>
  <div class="box"><div class="row between"><h4 style="margin:0">Skills</h4><span class="meta">${cs.length === 1 ? `A ${esc(p.cls)} picks ${cs[0]} skills from any` : `A ${esc(p.cls)} picks ${cs[0]} from the skills marked •`}. The background adds 2 more.</span></div>
    <div class="gclist"><div class="gchead"><span>Skill</span><span>Proficiency and modifier</span></div>${GC_SK.map(
      (s) => {
        const pr = +(a.sk[s] || 0),
          hand = p.mods && p.mods[s] != null;
        return `<div class="gcrow"><span>${clsSkill(p.cls, s) && cs.length > 1 ? '• ' : ''}${esc(s)} <small class="meta">${AB3[DDB_SK[s]]}</small></span>
      <span class="row"><select data-absk="${esc(s)}" aria-label="${esc(s)} proficiency"><option value="0"${pr === 0 ? ' selected' : ''}>Not proficient</option><option value="1"${pr === 1 ? ' selected' : ''}>Proficient</option><option value="2"${pr === 2 ? ' selected' : ''}>Expertise</option></select>
      <b class="num" title="${hand ? `Set by hand to ${gsg(eff(s))}; worked out ${gsg(abCalc(p, s))}` : ''}">${gsg(eff(s))}${hand ? '*' : ''}</b>${hand ? `<button class="lnk" type="button" data-abclr="${esc(s)}" title="Use the worked-out ${gsg(abCalc(p, s))}">Reset</button>` : ''}</span></div>`;
      }
    ).join('')}</div>
    <label class="toggles" style="display:flex"><label><input type="checkbox" id="abJat"${a.jat ? ' checked' : ''}>Half proficiency on other checks (Jack of All Trades)</label></label>
    <p class="quiet">* typed by hand in Group check or brought in from D&D Beyond with an extra bonus. It moves with the scores. Passives: Perception ${esc(p.pp ?? 10)}, Insight ${esc(p.pins ?? 10)}, Investigation ${esc(p.pinv ?? 10)}; they follow the scores unless typed on Overview.</p>
    <div class="row"><button class="btn sm ghost" type="button" id="abDel">Remove ability scores</button></div></div>
  ${pFooter()}`,
      bind: () => {
        bindPFooter();
        const ov = $('overlay');
        ov.querySelectorAll('[data-absc]').forEach(
          (i) =>
            (i.onchange = () => {
              growSync(p, () => (p.ab.sc[+i.dataset.absc] = clamp(Math.round(+i.value || 10), 1, 30)));
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-absv]').forEach(
          (i) =>
            (i.onchange = () => {
              p.ab.sv[+i.dataset.absv] = i.checked ? 1 : 0;
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-absk]').forEach(
          (i) =>
            (i.onchange = () => {
              growSync(p, () => {
                const v = +i.value;
                if (v) p.ab.sk[i.dataset.absk] = v;
                else delete p.ab.sk[i.dataset.absk];
              });
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-abclr]').forEach(
          (b) =>
            (b.onclick = () => {
              delete p.mods[b.dataset.abclr];
              drawSheet();
            })
        );
        $('abJat').onchange = (e) => {
          growSync(p, () => (p.ab.jat = e.target.checked));
          drawSheet();
        };
        armDelete(
          $('abDel'),
          () => {
            delete p.ab;
            drawSheet();
            toast('Ability scores removed. Save changes to keep that');
          },
          'Confirm remove'
        );
      },
    };
  };

  /* sheet: Resources (limited-use features) */
  VIEWS.player.res = () => {
    const p = pdraft;
    p.res = p.res || [];
    const mine = Object.entries(RES_PRE).filter(([, P]) => classLevel(p, P.c) >= P.from);
    return {
      html:
        head(
          'Resources',
          'Rage, Channel Divinity, Second Wind and other features with limited uses. Rests give them back by their recharge. Tap a dot to spend or regain a use.'
        ) +
        `
  <div class="box"><h4>Features</h4>${
    p.res.length
      ? `<div class="list">${p.res
          .map(
            (
              r
            ) => `<div class="eg"><div class="pn"><strong>${esc(r.name)}</strong><span>${resMax(p, r)} use${resMax(p, r) === 1 ? '' : 's'} · ${esc(RC[resRc(p, r)])}${r.kind === 'pre' ? ' · scales with level' : r.kind === 'pb' ? ' · Proficiency Bonus' : r.kind === 'mod' ? ` · ${esc(r.ab)} modifier` : r.kind === 'lvl' ? ` · level × ${r.n}` : ''}</span></div>
      <div class="slots">${resRow(p, r)}</div><label class="meta"><input type="checkbox" data-rcard="${r.id}"${r.card ? ' checked' : ''}> On card</label><button class="rmb" type="button" data-rdel="${r.id}" aria-label="Remove ${esc(r.name)}">×</button></div>`
          )
          .join('')}</div>`
      : '<p class="quiet">None yet. Add a class preset or your own below.</p>'
  }</div>
  <div class="box"><h4>Add a class feature</h4>
    ${mine.length ? `<div class="row" style="flex-wrap:wrap">${mine.map(([k, P]) => `<button class="btn sm" type="button" data-rpre="${k}"${p.res.some((r) => r.pre === k) ? ' disabled' : ''}>+ ${esc(P.n)}</button>`).join('')}</div>` : ''}
    <div class="row"><select id="rPreAll" aria-label="Any class feature"><option value="">Any class feature…</option>${Object.entries(
      RES_PRE
    )
      .map(([k, P]) => `<option value="${k}">${esc(P.n)} (${P.c})</option>`)
      .join('')}</select><button class="btn sm" type="button" id="rPreAdd">Add</button></div>
    <p class="quiet">From the 2024 rules (SRD 5.2). Uses grow on level up by the class table.</p></div>
  <div class="box"><h4>Add your own</h4><div class="grid">
    <label class="f">Name<input type="text" id="rN" maxlength="60" placeholder="Lucky, Breath Weapon…"></label>
    <label class="f">Uses<select id="rK"><option value="n">A number</option><option value="pb">Proficiency Bonus</option><option value="mod">Ability modifier</option><option value="lvl">Level × number</option></select></label>
    <label class="f">Number<input type="number" id="rNum" min="0" max="99" value="1"></label>
    <label class="f">Ability<select id="rAb">${GC_ABIL.map((a) => `<option>${a}</option>`).join('')}</select></label>
    <label class="f">Recharge<select id="rRc">${Object.entries(RC)
      .map(([k, l]) => `<option value="${k}"${k === 'long' ? ' selected' : ''}>${l}</option>`)
      .join('')}</select></label></div>
    <div class="row"><label class="meta"><input type="checkbox" id="rCard"> Show on the card</label><button class="btn sm" type="button" id="rAdd">Add</button></div></div>
  ${pFooter()}`,
      bind: () => {
        bindPFooter();
        const ov = $('overlay');
        bindRes(
          ov,
          () => p,
          () => drawSheet()
        );
        ov.querySelectorAll('[data-rcard]').forEach(
          (i) =>
            (i.onchange = () => {
              const r = p.res.find((x) => x.id === i.dataset.rcard);
              if (r) r.card = i.checked;
            })
        );
        ov.querySelectorAll('[data-rdel]').forEach(
          (b) =>
            (b.onclick = () => {
              p.res = p.res.filter((x) => x.id !== b.dataset.rdel);
              drawSheet();
            })
        );
        const addPre = (k) => {
          if (!RES_PRE[k]) return;
          if (p.res.some((r) => r.pre === k)) {
            toast(`${RES_PRE[k].n} is already on the list`);
            return;
          }
          if (p.res.length >= 30) return;
          p.res.push(resNew(p, k));
          drawSheet();
        };
        ov.querySelectorAll('[data-rpre]').forEach((b) => (b.onclick = () => addPre(b.dataset.rpre)));
        $('rPreAdd').onclick = () => addPre($('rPreAll').value);
        $('rAdd').onclick = () => {
          const n = val('rN').slice(0, 60);
          if (!n) {
            toast('Give the feature a name');
            $('rN').focus();
            return;
          }
          if (p.res.length >= 30) return;
          p.res.push({
            id: uid(),
            name: n,
            kind: $('rK').value,
            pre: '',
            n: clamp(Math.round(+$('rNum').value || 0), 0, 99),
            ab: $('rAb').value,
            rc: $('rRc').value,
            used: 0,
            card: $('rCard').checked,
          });
          drawSheet();
        };
      },
    };
  };

  /* D&D Beyond: scores, proficiencies, classes and limited-use features from the character JSON */
  function growDdb(c, p, x) {
    const { score, cls, has } = x,
      abl = GC_ABIL.map((a) => a.toLowerCase());
    p.ab = {
      sc: score.slice(0, 6),
      sv: abl.map((a) => (has('proficiency', a + '-saving-throws') ? 1 : 0)),
      sk: {},
      jat: has('half-proficiency', 'ability-checks'),
    };
    if (!p.ab.sv.some((v) => v)) {
      const st = cls.find((k) => k.start && CLS_SAVES[k.name]) || cls.find((k) => CLS_SAVES[k.name]);
      if (st) CLS_SAVES[st.name].forEach((i) => (p.ab.sv[i] = 1));
    }
    GC_SK.forEach((s) => {
      const k = s.toLowerCase().replace(/ /g, '-');
      if (has('expertise', k)) p.ab.sk[s] = 2;
      else if (has('proficiency', k)) p.ab.sk[s] = 1;
    });
    const ks = cls.filter((k) => CLASSES.includes(k.name));
    if (ks.length > 1) p.mc = ks.map((k) => ({ c: k.name, l: k.lv }));
    const res = [];
    ks.forEach((k) =>
      Object.entries(RES_PRE).forEach(([key, P]) => {
        if (P.c === k.name && k.lv >= P.from && !res.some((r) => r.pre === key))
          res.push({ id: uid(), name: P.n, kind: 'pre', pre: key, n: 0, ab: '', rc: 'long', used: 0, card: false });
      })
    );
    const acts =
      c.actions && typeof c.actions === 'object' ? Object.values(c.actions).filter(Array.isArray).flat() : [];
    const RT = { 1: 'short', 2: 'long', 3: 'dawn' };
    acts.forEach((a) => {
      const lu = a && a.limitedUse;
      if (!lu || typeof lu !== 'object' || !a.name) return;
      const nm = String(a.name).trim().slice(0, 60),
        used = Math.max(0, Math.trunc(+lu.numberUsed) || 0);
      const hit = res.find((r) => r.name.toLowerCase() === nm.toLowerCase());
      if (hit) {
        hit.used = used;
        return;
      }
      let kind = 'n',
        n = Math.trunc(+lu.maxUses) || 0,
        ab = 'Charisma';
      if (lu.useProficiencyBonus) {
        kind = 'pb';
        n = 0;
      } else if (+lu.statModifierUsesId >= 1 && +lu.statModifierUsesId <= 6) {
        kind = 'mod';
        ab = GC_ABIL[+lu.statModifierUsesId - 1];
      }
      if (kind === 'n' && n <= 0) return;
      if (res.length < 30)
        res.push({ id: uid(), name: nm, kind, pre: '', n, ab, rc: RT[+lu.resetType] || 'manual', used, card: false });
    });
    if (res.length) p.res = res;
  }

  /* Update from D&D Beyond on an existing player: what changed first, then apply to the sheet. Board-only data stays. */
  function ddbUpBox() {
    return ddbBox()
      .replace('id="ddbD"', 'id="ddbU"')
      .replace(
        'Import from D&D Beyond <span class="pill">Experimental</span>',
        'Update from D&D Beyond <span class="pill">Experimental</span>'
      )
      .replace(
        'Nothing is saved until you press Add to party / Save changes.',
        'Hooks, injuries, notes, conditions, spent Hit Dice and slots, and current HP stay as they are on the board. Nothing is saved until you press Save changes.'
      )
      .replace('id="ddbGo">Import pasted data<', 'id="ddbGo">Check for changes<');
  }
  function ddbMerge(d, raw) {
    const r = ddbParse(raw),
      n = r.p,
      m = JSON.parse(JSON.stringify(d)),
      ch = [];
    const F = [
      ['name', 'Name'],
      ['cls', 'Class'],
      ['level', 'Level'],
      ['maxHp', 'Max HP'],
      ['ac', 'AC'],
      ['ini', 'Initiative'],
      ['pp', 'Passive Perception'],
      ['pins', 'Passive Insight'],
      ['pinv', 'Passive Investigation'],
      ['sdc', 'Spell save DC'],
      ['spd', 'Speed'],
    ];
    F.forEach(([k, l]) => {
      const a = d[k] ?? '',
        b = n[k] ?? '';
      if (String(a) !== String(b)) {
        ch.push(`${l}: ${a === '' ? 'none' : a} → ${b === '' ? 'none' : b}`);
        m[k] = b;
      }
    });
    if ((+n.xp || 0) > (+d.xp || 0)) {
      ch.push(`XP: ${d.xp || 0} → ${n.xp}`);
      m.xp = n.xp;
    }
    m.hp = d.dead ? d.hp : clamp((+d.hp || 0) + Math.max(0, (+n.maxHp || 0) - (+d.maxHp || 0)), 0, +n.maxHp || 1);
    if (m.hp !== d.hp) ch.push(`Current HP: ${d.hp} → ${m.hp} (the max HP gain)`);
    m.hdu = Math.min(+d.hdu || 0, +n.level || 1);
    const os = d.slots || Array(9).fill(0),
      ns = n.slots || Array(9).fill(0);
    ORD.forEach((o, i) => {
      if ((+os[i] || 0) !== (+ns[i] || 0)) ch.push(`${o} slots: ${+os[i] || 0} → ${+ns[i] || 0}`);
    });
    if (n.slots) {
      m.slots = n.slots;
      m.sused = Array.from({ length: 9 }, (_, i) => Math.min(+(d.sused || [])[i] || 0, n.slots[i]));
    } else {
      delete m.slots;
      delete m.sused;
    }
    {
      const a = d.pact,
        b = n.pact,
        f = (x) => (x ? `${x.n} × ${ORD[x.lvl - 1]} level` : 'none');
      if (f(a) !== f(b)) ch.push(`Pact Magic slots: ${f(a)} → ${f(b)}`);
      if (b) m.pact = { lvl: b.lvl, n: b.n, used: Math.min(+(a || {}).used || 0, b.n) };
      else delete m.pact;
    }
    if (n.ab && !hasAb(d)) {
      ch.push('Ability scores, saving throws and skills added');
      m.ab = n.ab;
    } else if (n.ab) {
      const o = d.ab;
      GC_ABIL.forEach((a, i) => {
        const x = o ? o.sc[i] : null;
        if (x !== n.ab.sc[i]) ch.push(`${a}: ${x ?? 'not set'} → ${n.ab.sc[i]}`);
      });
      GC_SK.forEach((s) => {
        const x = o ? +(o.sk[s] || 0) : 0,
          y = +(n.ab.sk[s] || 0);
        if (x !== y)
          ch.push(
            `${s}: ${['not proficient', 'proficient', 'expertise'][x]} → ${['not proficient', 'proficient', 'expertise'][y]}`
          );
      });
      GC_ABIL.forEach((a, i) => {
        const x = o ? o.sv[i] : 0;
        if (!!x !== !!n.ab.sv[i]) ch.push(`${a} save: ${n.ab.sv[i] ? 'now proficient' : 'no longer proficient'}`);
      });
      m.ab = n.ab;
    }
    m.mods = n.mods;
    if (n.mc) m.mc = n.mc;
    else delete m.mc;
    const old = d.res || [],
      res = old.map((x) => ({ ...x }));
    (n.res || []).forEach((x) => {
      const h = res.find((y) => y.name.toLowerCase() === x.name.toLowerCase());
      if (h) {
        Object.assign(h, { kind: x.kind, pre: x.pre, n: x.n, ab: x.ab, rc: x.rc });
      } else {
        res.push({ ...x, used: 0 });
        ch.push(`New feature: ${x.name}`);
      }
    });
    if (res.length) m.res = res;
    return { m, ch, summary: r.summary };
  }
  function ddbUpdate(raw) {
    const d = pdraft,
      { m, ch, summary } = ddbMerge(d, raw);
    DDB = { for: d.id, bad: false, busy: false, msg: '' };
    const msg = $('ddbMsg');
    if (msg) msg.hidden = true;
    const el = popup(
      'Update from D&D Beyond',
      popHead('Update from D&D Beyond', esc(summary)) +
        (ch.length
          ? `<div class="gclist" id="duList">${ch.map((t) => `<div class="gcrow"><span>${esc(t)}</span></div>`).join('')}</div>
    <p class="quiet">Hooks, injuries, notes, conditions, Exhaustion, temp HP, spent Hit Dice, spent slots and feature uses stay as the board has them.</p>`
          : '<p class="quiet" id="duList">Nothing changed. The board already matches D&D Beyond.</p>') +
        `<div class="row end"><button class="btn ghost" type="button" data-mclose>Cancel</button>${ch.length ? '<button class="btn pri" type="button" id="duGo">Apply to the sheet</button>' : ''}</div>`
    );
    const go = el.querySelector('#duGo');
    if (go) {
      go.focus();
      go.onclick = () => {
        Object.keys(pdraft).forEach((k) => {
          if (!(k in m)) delete pdraft[k];
        });
        Object.assign(pdraft, m);
        el.remove();
        DDB = {
          for: pdraft.id,
          bad: false,
          busy: false,
          msg: `Updated from D&D Beyond: ${plural(ch.length, 'change')}. Save changes to keep them.`,
        };
        drawSheet();
        toast('Updated. Save changes to keep it');
      };
    }
  }
  // read-only hook for tests and tools
  const pFooter = () => `<div class="row between" style="border-top:1px solid var(--line);padding-top:16px">
  ${pdraft._new ? '<span></span>' : '<button class="btn danger" type="button" id="pDel">Remove from party</button>'}
  <div class="row"><button class="btn ghost" type="button" data-close id="pCancel">Cancel</button><button class="btn pri" type="button" id="pSave">${pdraft._new ? 'Add to party' : 'Save changes'}</button></div></div>`;
  function bindPFooter() {
    $('pSave').onclick = playerSave;
    $('pDel') &&
      armDelete(
        $('pDel'),
        () => {
          const id = pdraft.id;
          S.players = S.players.filter((x) => x.id !== id);
          S.battles.forEach((b) => {
            const cur = b.combatants[b.turn];
            b.combatants = b.combatants.filter((c) => c.pid !== id);
            if (cur && cur.pid === id) b.turn = Math.min(b.turn, Math.max(0, b.combatants.length - 1));
            else b.turn = Math.max(0, b.combatants.indexOf(cur));
          });
          closeSheet();
          commit();
        },
        'Confirm remove'
      );
    $('overlay')
      .querySelectorAll('[data-pf]')
      .forEach(
        (el) =>
          (el.oninput = () => {
            const k = el.dataset.pf,
              v = el.type === 'number' ? +el.value : el.value;
            if (k === 'level' || k === 'cls') growSync(pdraft, () => (pdraft[k] = v));
            else pdraft[k] = v;
            // on a new character Current HP follows Max HP until the DM types a Current HP of their own
            if (k === 'hp') pdraft._hpT = true;
            if (pdraft._new && !pdraft._hpT && (k === 'maxHp' || k === 'level' || k === 'cls')) {
              pdraft.hp = +pdraft.maxHp || 1;
              const h = $('pHp');
              if (h && h !== el) h.value = pdraft.hp;
            }
          })
      );
  }
  VIEWS.player.overview = () => {
    const p = pdraft;
    return {
      html:
        head(
          p._new ? 'New player' : 'Overview',
          p._new ? 'Add a character to the party, or import one from D&D Beyond.' : 'Core stats you need at the table.'
        ) +
        `${p._new ? ddbBox() : ''}
  <div class="box"><h4>Character</h4><div class="grid">
    <label class="f">Character name<input type="text" data-pf="name" value="${esc(p.name)}"></label>
    <label class="f">Player<input type="text" data-pf="player" value="${esc(p.player)}"></label>
    <label class="f">Class<select data-pf="cls">${CLASSES.map((c) => `<option${c === p.cls ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="f">Level<input type="number" min="1" max="20" data-pf="level" value="${esc(p.level)}"></label></div>${p._new ? '' : `<div class="row"><button class="btn sm" type="button" id="pLvUp"${+p.level >= 20 ? ' disabled' : ''}>Level up</button><span class="meta">Proficiency Bonus +${pbOf(p.level)}. ${levelUpReady(p) ? 'Enough XP for the next level.' : 'Milestone or XP: the box previews the changes first.'}</span></div>`}</div>
  <div class="box"><h4>Combat</h4><div class="grid">
    <label class="f">Current HP<input type="number" min="0" data-pf="hp" id="pHp" value="${esc(p.hp)}"></label>
    <label class="f">Max HP<input type="number" min="1" data-pf="maxHp" id="pMax" value="${esc(p.maxHp)}"></label>
    <label class="f">Armor class<input type="number" min="0" data-pf="ac" value="${esc(p.ac)}"></label>
    <label class="f">Initiative bonus<input type="number" data-pf="ini" value="${esc(p.ini)}"></label>
    <label class="f">Passive Perception<input type="number" data-pf="pp" value="${esc(p.pp ?? 10)}"></label>
    <label class="f">Passive Insight<input type="number" data-pf="pins" value="${esc(p.pins ?? 10)}"></label>
    <label class="f">Passive Investigation<input type="number" data-pf="pinv" value="${esc(p.pinv ?? 10)}"></label>
    <label class="f">Spell save DC<input type="number" min="0" data-pf="sdc" value="${esc(p.sdc || '')}" placeholder="None"></label>
    <label class="f">Speed (ft)<input type="number" min="0" data-pf="spd" value="${esc(p.spd ?? 30)}"></label>
    <label class="f">Temp HP<input type="number" min="0" data-pf="thp" value="${esc(p.thp || 0)}"></label>
    <label class="f">Hit Dice spent<input type="number" min="0" max="${esc(p.level)}" data-pf="hdu" value="${esc(p.hdu || 0)}" aria-describedby="pHdNote"></label>
    <label class="f">XP<input type="number" min="0" data-pf="xp" value="${esc(p.xp || 0)}"></label></div>
    <p style="margin:0;color:var(--ink-3);font-size:13px">${xpLine(p)} <span id="pHdNote">Hit Dice: ${hdText(p)}.</span></p>
    <label class="toggles" style="display:flex"><label><input type="checkbox" id="pInsp"${p.insp ? ' checked' : ''}>Heroic Inspiration</label><label><input type="checkbox" id="pHere"${isHere(p) ? ' checked' : ''}>Here tonight</label></label>
    <div class="row"><button class="btn sm" type="button" id="pRest">Long rest</button><span class="meta" style="color:var(--ink-3);font-size:13px">Just this character, saved straight away: restores HP and all Hit Dice, clears unconscious and concentration, and removes one level of exhaustion. For the whole party, use Long rest in Time &amp; light on the home screen, which also moves the clock.</span></div></div>${p._new ? '' : ddbUpBox()}
  ${pFooter()}`,
      bind: () => {
        bindPFooter();
        bindDdb();
        $('pLvUp') && ($('pLvUp').onclick = () => lvlPop(pdraft.id));
        $('pInsp').onchange = (e) => (pdraft.insp = e.target.checked);
        $('pHere').onchange = (e) => (pdraft.present = e.target.checked);
        $('pRest').onclick = () => {
          if (!pdraft.dead && (+pdraft.hp || 0) <= 0) {
            toast(
              `${pdraft.name || 'This character'} is at 0 HP, so a long rest gives no benefit. Heal them to at least 1 HP first`
            );
            return;
          }
          restGuard('long rest', () => {
            const real = !pdraft._new && S.players.find((x) => x.id === pdraft.id);
            longRest(pdraft);
            if (!real) {
              drawSheet();
              toast('Long rest applied');
              return;
            }
            longRest(real);
            tlog(`${real.name} took a long rest.`, true);
            commit();
            toast(`${real.name} took a long rest. Undo with Ctrl+Z`);
          });
        };
      },
    };
  };
  VIEWS.player.conditions = () => {
    const p = pdraft;
    return {
      html:
        head('Conditions', 'Toggle what applies right now. Shown on the player’s card.') +
        `
  <div class="box"><div class="toggles">${CONDITIONS.map((c) => `<label title="${esc(COND_TEXT[c] || '')}"><input type="checkbox" value="${c}"${(p.conditions || []).includes(c) ? ' checked' : ''}>${c}</label>`).join('')}</div></div>
  <div class="box"><label class="f">Exhaustion level<select id="pExh">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${(+p.exh || 0) === n ? ' selected' : ''}>${n === 0 ? 'None' : n === 6 ? '6 (death)' : n}</option>`).join('')}</select></label>
    <p style="margin:0;color:var(--ink-3);font-size:13px">${COND_TEXT.Exhaustion}</p></div>
  <div class="box"><h4>Lingering injuries</h4>
    ${(p.injuries || []).length ? `<div class="list">${p.injuries.map((n, k) => `<div class="eg"><div class="pn"><strong>${esc(n)}</strong><span>${esc(injFx(n) || 'Your own ruling')}</span></div><button class="rmb" type="button" data-rminj="${k}" aria-label="Heal ${esc(n)}" title="Healed">×</button></div>`).join('')}</div>` : '<p style="margin:0;color:var(--ink-3);font-size:13px">None. Greater restoration or a long recovery usually cures one.</p>'}
    <div class="row"><input type="text" id="injTxt" placeholder="Add your own, e.g. Cursed brand" style="flex:1;min-width:160px" aria-label="Injury"><button class="btn" type="button" id="injAdd">Add</button><button class="btn" type="button" id="injRoll">Roll injury</button></div></div>
  ${pFooter()}`,
      bind: () => {
        bindPFooter();
        $('overlay')
          .querySelectorAll('[data-rminj]')
          .forEach(
            (x) =>
              (x.onclick = () => {
                pdraft.injuries.splice(+x.dataset.rminj, 1);
                drawSheet();
              })
          );
        $('injAdd').onclick = () => {
          const t = val('injTxt').slice(0, 80);
          if (!t) return;
          pdraft.injuries = pdraft.injuries || [];
          if (pdraft.injuries.length < 12 && !pdraft.injuries.includes(t)) pdraft.injuries.push(t);
          drawSheet();
        };
        $('injRoll').onclick = () => {
          const r = rollInjury(pdraft);
          drawSheet();
          toast(`Rolled ${r.r}: ${r.name}. Save changes to keep it`);
        };
        $('overlay')
          .querySelectorAll('.toggles input')
          .forEach(
            (c) =>
              (c.onchange = () => {
                pdraft.conditions = [...$('overlay').querySelectorAll('.toggles input:checked')].map((i) => i.value);
                if (c.checked && INCAP.includes(c.value) && pdraft.conditions.includes('Concentrating')) {
                  pdraft.conditions = pdraft.conditions.filter((k) => k !== 'Concentrating');
                  drawSheet();
                  toast(`${c.value} ends Concentration`);
                }
              })
          );
        $('pExh').onchange = (e) => (pdraft.exh = +e.target.value);
      },
    };
  };
  VIEWS.player.notes = () => ({
    html:
      head('Notes', 'Backstory hooks, debts, secrets and anything to remember about this character.') +
      `
  <div class="box"><textarea data-pf="notes" style="min-height:200px" aria-label="Player notes">${esc(pdraft.notes)}</textarea></div>${pFooter()}`,
    bind: bindPFooter,
  });

  /* Campaign */
  VIEWS.campaign.details = () => ({
    html:
      head('Campaign details') +
      `
  <div class="box"><div class="grid">
    <label class="f">Your name<input type="text" id="dmName" value="${esc(S.dm.name)}"></label>
    <label class="f">Campaign<input type="text" id="dmCamp" value="${esc(S.dm.campaign)}"></label>
    <label class="f">Session number<input type="number" min="1" id="dmSess" value="${esc(S.dm.session)}"></label>
    <label class="f">Wandering monsters<select id="dmWander">${[
      [0, 'Never'],
      [6, '1 in 6'],
      [8, '1 in 8'],
      [10, '1 in 10'],
      [12, '1 in 12'],
      [20, '1 in 20'],
    ]
      .map(
        ([v, l]) => `<option value="${v}"${(+S.dm.wander || 0) === v ? ' selected' : ''}>${l} per dungeon turn</option>`
      )
      .join('')}</select></label></div>
    <h4>Gritty rules</h4>
    <div class="toggles"><label title="Short rest 8 hours, long rest 7 days"><input type="checkbox" id="dmGrit"${S.dm.gritty ? ' checked' : ''}>Gritty realism rests</label><label title="Roll on the injury table when a character drops to 0 HP or takes a critical hit"><input type="checkbox" id="dmInj"${S.dm.injuries ? ' checked' : ''}>Lingering injuries</label></div>
    <p style="margin:0;color:var(--ink-3);font-size:13px">Gritty realism makes a short rest 8 hours and a long rest 7 days. Lingering injuries adds a Roll injury button when a character drops to 0 HP.</p>
    <div class="row end"><button class="btn pri" type="button" id="dmSave">Save</button></div></div>`,
    bind: () => {
      $('dmSave').onclick = () => {
        S.dm.name = val('dmName');
        S.dm.campaign = val('dmCamp');
        S.dm.session = Math.max(1, +val('dmSess') || 1);
        S.dm.wander = +$('dmWander').value || 0;
        S.dm.gritty = $('dmGrit').checked;
        S.dm.injuries = $('dmInj').checked;
        commit();
        toast('Saved');
      };
    },
  });
  VIEWS.campaign.data = () => ({
    html:
      head('Data', 'Everything is stored in this browser. Save a backup before switching devices.') +
      `
  <div class="box"><div class="row"><button class="btn" type="button" id="exp2">Save backup</button><button class="btn" type="button" id="imp2">Load backup</button>${safetyButtons()}</div>
    <p style="margin:0;color:var(--ink-3);font-size:13px">${backupAge() == null ? 'No backup saved from this browser yet.' : `Last backup ${esc(S.dm.lastBackup)}${backupAge() ? `, ${plural(backupAge(), 'day')} ago` : ', today'}.`} Save one at the end of every session.</p></div>
  ${safetyHTML()}${startOverHTML()}`,
    bind: () => {
      bindSafety();
      $('exp2').onclick = exportData;
      $('imp2').onclick = () => $('importFile').click();
      bindStartOver();
    },
  });

  /* ---------- start over: erase everything, or load the demo board ---------- */
  // Both replace the whole board, so each one offers a backup first. Both also stop the linked
  // backup file, so an empty or demo board never overwrites the DM's last good backup.
  const hasBoard = () =>
    !!S &&
    !S.example &&
    (EX_KEYS.some((k) => (S[k] || []).length) ||
      (S.handouts || []).length > 0 ||
      (S.plans || []).length > 0 ||
      (S.homebrew || []).length > 0 ||
      !!(S.travel && (S.travel.journeys.length || S.travel.tables.length)) ||
      !!(S.cal && S.cal.on) ||
      Object.keys(S.monNotes || {}).length > 0 ||
      !!(S.draftBattle && S.draftBattle.foes && S.draftBattle.foes.length) ||
      (S.sketches || []).some((p) => p.strokes.length) ||
      wHas());
  function startOverHTML() {
    return `<div class="box"><h4>Start over</h4><p style="margin:0;color:var(--ink-2)">Load a demo campaign to show the board off, or erase everything and start with an empty board. Both offer a backup first.</p>
    <div class="row"><button class="btn" type="button" id="demoB">Load demo data</button><button class="btn danger" type="button" id="wipe">Erase all data</button></div></div>`;
  }
  function bindStartOver() {
    $('demoB').onclick = askDemo;
    $('wipe').onclick = askErase;
  }
  const soBackup = () =>
    `<div class="row"><button class="btn" type="button" id="soBak">Download a backup first</button><span class="sfmuted" id="soBakNote" role="status">${backupAge() === 0 ? 'You saved one today.' : ''}</span></div>`;
  function bindSoBackup(el) {
    el.querySelector('#soBak').onclick = async () => {
      await exportData();
      el.querySelector('#soBakNote').textContent =
        'Backup downloaded. Check it’s in your Downloads folder before you go on.';
    };
  }
  const soFileLine = (what) =>
    SAFE.file
      ? `<p style="margin:0;color:var(--ink-2)">Your backup file <strong>${esc(SAFE.file.name)}</strong> stops being updated, so it keeps the board you have now${what}.</p>`
      : '';
  async function stopFile() {
    SAFE.file = null;
    SAFE.filePaused = false;
    SAFE.fileErr = false;
    clearTimeout(SAFE.fileT);
    clearBar('file');
    try {
      await tx(['kv'], 'readwrite', (st) => {
        st('kv').delete('file');
        st('kv').delete('fileAt');
      });
    } catch (e) {}
  }

  function askErase() {
    const el = popup(
      'Erase all data',
      popHead(
        'Erase all data?',
        'Deletes every player, battle, mission, note, NPC, place, front, clock, handout and map image, then starts you on an empty board. Your light or dark theme is kept.'
      ) +
        `
    ${hasBoard() ? soBackup() : ''}
    <label class="toggles" style="display:flex"><label><input type="checkbox" id="erKeep" checked>Keep restore points in this browser, so this can be undone</label></label>
    <p style="margin:0;color:var(--ink-3);font-size:13px" id="erKeepNote">A restore point of this board is kept in Campaign → Data.</p>
    ${soFileLine('')}
    <label class="f">Type ERASE to confirm<input type="text" id="erText" autocomplete="off" spellcheck="false" maxlength="20"></label>
    <div class="row end"><button class="btn ghost" type="button" data-mclose id="erNo">Cancel</button><button class="btn danger" type="button" id="erGo" disabled>Erase everything</button></div>`
    );
    if (hasBoard()) bindSoBackup(el);
    const go = el.querySelector('#erGo'),
      txt = el.querySelector('#erText'),
      keep = el.querySelector('#erKeep');
    keep.onchange = () => {
      el.querySelector('#erKeepNote').textContent = keep.checked
        ? 'A restore point of this board is kept in Campaign → Data.'
        : 'Restore points are deleted too. Only a downloaded backup can bring this board back.';
    };
    txt.oninput = () => {
      go.disabled = txt.value.trim().toUpperCase() !== 'ERASE';
    };
    txt.onkeydown = (e) => {
      if (e.key === 'Enter' && !go.disabled) go.click();
    };
    go.onclick = () => {
      go.disabled = true;
      eraseAll(keep.checked);
    };
    txt.focus();
  }
  let ERASE_NAME = ''; // set when only one of several campaigns is erased, so it keeps its name
  let ERASE_KEEP_DAMAGED = false; // "Start fresh" from the recovery dialog keeps the damaged copies
  async function eraseAll(keep) {
    if (keep && hasBoard()) await takeSnap('Before erasing all data', true);
    // nothing may write the old board back while the page reloads
    clearTimeout(saveTimer);
    dirty = false;
    SAFE.changed = false;
    SAFE.lastSnapAt = Date.now();
    await stopFile();
    if (!keep) {
      try {
        await queued(() =>
          tx(['snaps', 'list', 'imgs', 'kv'], 'readwrite', (st) => {
            ['snaps', 'list', 'imgs', 'kv'].forEach((n) => st(n).clear());
          })
        );
      } catch (e) {}
      SAFE.snaps = [];
    } else await undoClear();
    RECOVERY_HOLD = false;
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(KEY) && !(ERASE_KEEP_DAMAGED && k.startsWith(KEY + '-damaged')))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
    S = { example: false, dm: { campaign: String(ERASE_NAME || '').slice(0, 120), session: 1 } };
    IMGS = {};
    UNDO = [];
    normalize();
    lastJSON = JSON.stringify(S);
    try {
      localStorage.setItem(KEY, lastJSON);
      sessionStorage.setItem(KEY + '-erased', '1');
    } catch (e) {}
    location.reload();
  }
  function eraseToast() {
    try {
      if (sessionStorage.getItem(KEY + '-erased')) {
        sessionStorage.removeItem(KEY + '-erased');
        setTimeout(() => toast('All data erased. You’re starting with an empty board'), 300);
      }
    } catch (e) {}
  }

  function askDemo() {
    if (!hasBoard()) {
      loadDemo();
      return;
    }
    const el = popup(
      'Load demo data',
      popHead(
        'Replace this board with the demo?',
        'The demo campaign takes the place of everything on this board. A restore point of your board is kept in Campaign → Data.'
      ) +
        `
    ${soBackup()}${soFileLine(', not the demo')}
    <div class="row end"><button class="btn ghost" type="button" data-mclose id="dmNo">Cancel</button><button class="btn pri" type="button" id="dmGo">Load demo data</button></div>`
    );
    bindSoBackup(el);
    el.querySelector('#dmNo').focus();
    el.querySelector('#dmGo').onclick = () => {
      el.remove();
      loadDemo();
    };
  }
  async function loadDemo() {
    if (hasBoard()) await takeSnap('Before loading demo data', true);
    const hadFile = !!SAFE.file;
    await stopFile();
    if (applyBoard(demoBoard(), {})) {
      toast(
        hadFile
          ? 'Demo campaign loaded. Your backup file was left as it was'
          : 'Demo campaign loaded. Erase all data in Campaign → Data clears it'
      );
    }
  }
  // an original coastal horror campaign that fills every part of the board, with a fight in progress
  function demoBoard() {
    return window.DMB_DATA.demoBoard({ uid, today, S });
  }
  /* ---------- setup and help: getting started, the ? help sheet, session-night checklist ---------- */
  // Everything here wraps existing functions (render, normalize, askPresent, two Session views)
  // instead of editing them, so other packages can change those functions freely.
  // Other packages can list a shortcut on the help sheet with
  //   (window.DM_SHORTCUTS=window.DM_SHORTCUTS||[]).push({key:'T',what:'Travel a day',where:'Time box'})
  window.DM_SHORTCUTS = window.DM_SHORTCUTS || [];
  /* setup/help styles live in css/base.css (formerly injected here as #setup-help-css) */

  /* a getting-started checklist on a new board */
  function gsSteps() {
    const real = !S.example;
    const n = S.dm.session || 1;
    return [
      {
        k: 'name',
        t: 'Name the campaign',
        done: real && !!(S.dm.campaign || '').trim(),
        sub:
          real && (S.dm.campaign || '').trim() ? esc(S.dm.campaign) : 'Shown at the top of the board and on backups.',
        act:
          real && (S.dm.campaign || '').trim()
            ? ''
            : `<button class="btn sm" type="button" id="gsNameGo">Set up campaign</button>`,
      },
      {
        k: 'players',
        t: 'Add or import your players',
        done: real && S.players.length > 0,
        sub:
          real && S.players.length
            ? plural(S.players.length, 'adventurer')
            : 'Type them in, or paste a D&amp;D Beyond character link.',
        act: `<button class="btn sm" type="button" data-gs="player">Add player</button><button class="btn sm ghost" type="button" data-gs="ddb">Import from D&amp;D Beyond (experimental)</button>`,
      },
      {
        k: 'mission',
        t: 'Add the first mission',
        done: real && S.missions.length > 0,
        sub: 'The hook that gets the party moving.',
        act: `<button class="btn sm" type="button" data-gs="mission">New mission</button>`,
      },
      {
        k: 'front',
        t: 'Add a Front',
        done: real && (S.fronts || []).length > 0,
        sub: 'A villain plan or faction goal that moves when the party doesn’t.',
        act: `<button class="btn sm" type="button" data-gs="front">Add a Front</button>`,
      },
      {
        k: 'scenes',
        t: `Plan session ${esc(n)}’s scenes`,
        done: real && S.scenes.length > 0,
        sub: 'Two or three scenes are plenty: an opening, a choice, a fight.',
        act: `<button class="btn sm" type="button" data-gs="scenes">Plan scenes</button>`,
      },
      {
        k: 'backup',
        t: 'Save a first backup',
        done: real && !!S.dm.lastBackup,
        sub:
          real && S.dm.lastBackup
            ? `Saved ${esc(S.dm.lastBackup)}`
            : 'A file you keep, in case this browser is cleared.',
        act: `<button class="btn sm" type="button" data-gs="backup">Save backup</button>`,
      },
    ];
  }
  const gsComplete = () => gsSteps().every((s) => s.done);
  // shown on the example board and on a new board (session 1, no recaps yet) until done or hidden
  const gsShow = () =>
    !S.dm.setupHide && (S.example || ((+S.dm.session || 1) <= 1 && !S.notes.length && !gsComplete()));
  function gsRender() {
    let el = $('setupSeat');
    if (!el) {
      el = document.createElement('div');
      el.id = 'setupSeat';
      const p = $('party');
      if (!p) return;
      p.after(el);
    }
    const on = gsShow();
    if (!on) {
      el.innerHTML = '';
      return;
    }
    const steps = gsSteps(),
      n = steps.filter((s) => s.done).length;
    el.innerHTML = `<section class="gs" id="gsBox" aria-label="Getting started"><div class="gs-h"><div><h2>Getting started</h2><p>${S.example ? 'Set up your own campaign in six steps.' : `${n} of ${steps.length} done. Each step ticks off by itself.`}</p></div><button class="lnk" type="button" id="gsHide">Hide</button></div>
    ${S.example ? `<p class="gs-ex">You’re looking at example data. Clear it first, and the steps below start ticking. <button class="btn sm pri" type="button" id="gsClearEx">Clear example data</button></p>` : ''}
    <ol>${steps.map((s, i) => `<li class="${s.done ? 'done' : ''}" data-step="${s.k}"><span class="gs-tick" aria-hidden="true">${s.done ? '✓' : i + 1}</span><div><b>${s.t}</b>${s.done ? '' : ''}<small>${s.sub}</small></div><div class="gs-acts">${S.example ? '' : s.act}</div></li>`).join('')}</ol>
    <p class="gs-imp">Have a campaign file made from your notes? Open it with <button class="lnk" type="button" id="gsLoad">Load backup</button>. Press <kbd>?</kbd> any time for keys and where everything lives.</p></section>`;
    const go = {
      player: () => openSheet('player', 'overview', null),
      ddb: () => {
        openSheet('player', 'overview', null);
        setTimeout(() => {
          const dd = $('ddbD');
          if (dd) dd.open = true;
          const d = $('ddbId');
          d && d.focus();
        }, 60);
      },
      mission: () => openSheet('mission', 'new'),
      front: () => openSheet('session', 'fronts'),
      scenes: () => openSheet('session', 'scenes'),
      backup: () => Promise.resolve(exportData()).finally(() => render()),
    };
    el.querySelectorAll('[data-gs]').forEach((b) => (b.onclick = () => go[b.dataset.gs]()));
    $('gsNameGo') && ($('gsNameGo').onclick = () => window.DMB_CAMP.openWizard({ source: 'getting-started' }));
    $('gsHide').onclick = () => {
      S.dm.setupHide = true;
      commit();
      toast('Getting started hidden. Press ? to bring it back, or Ctrl+Z');
    };
    $('gsLoad').onclick = () => $('importBtn').click();
    $('gsClearEx') &&
      ($('gsClearEx').onclick = () => {
        const c = $('clearEx');
        if (c) c.click();
        else {
          pushUndo();
          clearExample();
          save();
          render();
        }
      });
  }
  {
    const r0 = render;
    render = function () {
      const out = r0.apply(this, arguments);
      try {
        gsRender();
      } catch (e) {
        console.warn('getting started', e);
      }
      return out;
    };
  }
  {
    const n0 = normalize;
    normalize = function () {
      const h = !!(S && typeof S === 'object' && S.dm && typeof S.dm === 'object' && S.dm.setupHide === true);
      const out = n0.apply(this, arguments);
      if (S && S.dm) {
        if (h) S.dm.setupHide = true;
        else delete S.dm.setupHide;
      }
      return out;
    };
  }

  /* session night: a short before-play checklist where Plan opens */
  // the old players' screen left a heartbeat key behind: clear it
  try {
    localStorage.removeItem('dm-board-pv-seen');
  } catch (e) {}
  let NIGHT = { s: 0, here: false };
  const night = () => {
    if (NIGHT.s !== S.dm.session) NIGHT = { s: S.dm.session, here: false };
    return NIGHT;
  };
  function nightHTML() {
    if (S.tonight.started) return '';
    const N = night();
    const d = backupAge();
    const last = S.notes[S.notes.length - 1];
    const first = (+S.dm.session || 1) <= 1 && !last;
    const rows = [
      {
        k: 'backup',
        t: 'Backup is recent',
        done: d != null && d <= 1,
        sub: d == null ? 'No backup saved yet.' : d === 0 ? 'Saved today.' : `Last saved ${plural(d, 'day')} ago.`,
        act: `<button class="btn sm" type="button" data-nt="backup">Save backup</button>`,
      },
      {
        k: 'here',
        t: 'Who’s here tonight',
        done: N.here || !S.players.length,
        sub: S.players.length
          ? `<span class="herechips">${S.players.map((p) => `<button type="button" data-nh="${p.id}" aria-pressed="${isHere(p)}" title="${isHere(p) ? 'Here. Click to mark away' : 'Away. Click to mark here'}">${esc(p.name)}</button>`).join('')}</span>`
          : 'Add players first.',
        act:
          N.here || !S.players.length
            ? ''
            : `<button class="btn sm" type="button" data-nt="here">That’s everyone</button>`,
      },
      {
        k: 'prev',
        t: 'Previously on is ready',
        done: !!last || first,
        sub: last
          ? esc(String(readAloud(last.body) || '').slice(0, 140)) +
            (String(readAloud(last.body) || '').length > 140 ? '…' : '')
          : first
            ? 'First session, so there’s nothing to recap yet.'
            : 'No recap yet. Write one in the Session log.',
        act: last
          ? `<button class="btn sm ghost" type="button" data-nt="prev">Read it</button>`
          : first
            ? ''
            : `<button class="btn sm" type="button" data-nt="log">Session log</button>`,
      },
    ];
    const n = rows.filter((r) => r.done).length;
    return `<div class="box night" id="nightBox"><div class="row between"><h4>Before you play · ${n} of ${rows.length}</h4><button class="btn sm pri" type="button" data-nt="start">Start session</button></div>
    <ol>${rows.map((r) => `<li class="${r.done ? 'done' : ''}" data-night="${r.k}"><span class="gs-tick" aria-hidden="true">${r.done ? '✓' : ''}</span><div><b>${r.t}</b><small>${r.sub}</small></div><div class="gs-acts">${r.act}</div></li>`).join('')}</ol></div>`;
  }
  function bindNight() {
    const box = $('nightBox');
    if (!box) return;
    const N = night();
    const act = {
      backup: () => Promise.resolve(exportData()).finally(() => view && drawSheet()),
      here: () => {
        N.here = true;
        drawSheet();
      },
      prev: () => openSheet('session', 'tonight'),
      log: () => openSheet('notes', 'sessions'),
      start: () => askPresent(),
    };
    box.querySelectorAll('[data-nt]').forEach((b) => (b.onclick = () => act[b.dataset.nt]()));
    box.querySelectorAll('[data-nh]').forEach(
      (b) =>
        (b.onclick = () => {
          const p = S.players.find((x) => x.id === b.dataset.nh);
          if (!p) return;
          p.present = !isHere(p);
          N.here = true;
          commit();
        })
    );
  }
  function withNight(k) {
    const v0 = VIEWS.session[k];
    if (!v0) return;
    VIEWS.session[k] = function () {
      const r = v0.apply(this, arguments);
      if (!r || typeof r.html !== 'string') return r;
      const h = nightHTML();
      if (!h) return r;
      const cut = 'data-close aria-label="Close">×</button></div>',
        i = r.html.indexOf(cut);
      const html = i < 0 ? h + r.html : r.html.slice(0, i + cut.length) + h + r.html.slice(i + cut.length);
      const b0 = r.bind;
      return {
        ...r,
        html,
        bind: function () {
          const o = b0 && b0.apply(this, arguments);
          bindNight();
          return o;
        },
      };
    };
  }
  withNight('scenes');
  withNight('tonight');
  // Start session after confirming who's here: the Who's here popup starts from those choices
  {
    const a0 = askPresent;
    askPresent = function () {
      const out = a0.apply(this, arguments);
      if (night().here)
        document.querySelectorAll('#mcard [data-here]').forEach((i) => {
          const p = S.players.find((x) => x.id === i.dataset.here);
          if (p) i.checked = isHere(p);
        });
      return out;
    };
  }

  /* help sheet on ? and a ? button in the footer */
  const KEY_INFO = {
    n: ['Next turn', 'Live battle'],
    p: ['Previous turn', 'Live battle'],
    d: ['Dice roller', 'Home screen and live battle'],
    j: ['Quick note into tonight’s log', 'Anywhere'],
    s: ['Sketchpad', 'Anywhere'],
    '/': ['Search everything you’ve written', 'Anywhere'],
    'ctrl+z': ['Undo the last change', 'Anywhere outside a text box'],
    '?': ['This help', 'Anywhere outside a text box'],
    escape: ['Close the top popup, then the open sheet', 'Anywhere'],
  };
  const KEY_ORDER = ['n', 'p', 'd', 'v', 'j', 's', '/', 'ctrl+z', '?', 'escape'];
  const keyLabel = (k) =>
    k === 'escape'
      ? 'Esc'
      : k === 'ctrl+z'
        ? 'Ctrl+Z'
        : k.startsWith('ctrl+')
          ? 'Ctrl+' + k.slice(5).toUpperCase()
          : k.length === 1
            ? k.toUpperCase()
            : k[0].toUpperCase() + k.slice(1);
  const GLOBAL_KEYS = ['ctrl+z', 'Escape', 'j', '/', 's', 'n', 'p', 'd'];
  // read the shortcuts the board really has: the global key handlers (GLOBAL_KEYS), button tooltips like "Sketch (S)", and DM_SHORTCUTS
  function readShortcuts() {
    const found = new Map();
    const add = (k, what, where) => {
      k = String(k).toLowerCase();
      if (!k || found.has(k)) return;
      found.set(k, { k, what, where });
    };
    // The global keydown handlers' keys. (This used to be scraped from inline <script> text; scripts are external files now.)
    // Keep in step with the document/window keydown listeners when adding a shortcut.
    GLOBAL_KEYS.forEach((key) => add(key, ...(KEY_INFO[key.toLowerCase()] || ['', ''])));
    document.querySelectorAll('[title]').forEach((el) => {
      const t = el.getAttribute('title') || '';
      const x = /^(.*?)\s*\((Ctrl\+[A-Za-z]|[A-Za-z/?])\)\s*$/.exec(t);
      if (!x) return;
      const k = x[2].toLowerCase();
      if (found.has(k)) {
        const f = found.get(k);
        if (!f.what) f.what = x[1];
      } else add(k, ...(KEY_INFO[k] || [x[1], '']));
    });
    (window.DM_SHORTCUTS || []).forEach((s) => {
      if (s && s.key) {
        const k = String(s.key).toLowerCase();
        if (found.has(k)) {
          const f = found.get(k);
          f.what = f.what || String(s.what || '');
          f.where = f.where || String(s.where || '');
        } else add(k, String(s.what || ''), String(s.where || ''));
      }
    });
    found.delete('enter');
    return [...found.values()].sort((a, b) => {
      const i = KEY_ORDER.indexOf(a.k),
        j = KEY_ORDER.indexOf(b.k);
      return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.k.localeCompare(b.k);
    });
  }
  const HOME_PARTS = [
    ['Party cards', 'Click a card for the full sheet, the HP bar to heal or hurt'],
    ['Session', 'Plan, Start session, Wrap up, Edit campaign'],
    ['Time & light', 'Button on the Session leaf: clock, travel, short and long rests, weather, lights, dungeon turn'],
  ];
  const TOOL_TXT = {
    themeBtn: ['Theme', 'Light, dark, or follow the device'],
    exportBtn: ['Save backup', 'A file with the whole board'],
    importBtn: ['Load backup', 'Open a backup or a campaign file'],
  };
  function helpHTML() {
    const ks = readShortcuts();
    const secs = Object.entries(SECTIONS)
      .filter(([k]) => k !== 'player')
      .map(([k, s]) => {
        let subs = [];
        try {
          subs = s.subs();
        } catch (e) {}
        return `<div class="wl"><b>${esc(s.title)}</b>${subs.map(([sk, l]) => `<button class="lnk" type="button" data-hgo="${k}:${sk}">${esc(l)}</button>`).join('')}</div>`;
      })
      .join('');
    const tools = [...document.querySelectorAll('header .tools button')]
      .filter((b) => !b.hidden && b.offsetParent !== null)
      .map((b) => {
        const fx = TOOL_TXT[b.id];
        if (fx) return `<span>${fx[0]} <small>${fx[1]}</small></span>`;
        const l = (b.textContent || '').trim() || b.getAttribute('aria-label') || '';
        const t = (b.getAttribute('title') || '').replace(/\s*\([^)]*\)\s*$/, '');
        return l
          ? `<span>${esc(l.replace(/[.:].*$/, ''))}${t && t !== l ? ` <small>${esc(t)}</small>` : ''}</span>`
          : '';
      })
      .filter(Boolean);
    return (
      popHead('Help', 'Keys and where everything lives. Press ? to open this, Esc to close it.') +
      `<div class="helpgrid"><div><h4>Keys</h4><div class="keys">${ks.map((s) => `<kbd>${esc(keyLabel(s.k))}</kbd><span>${esc(s.what || 'Shortcut')}${s.where ? `<small>${esc(s.where)}</small>` : ''}</span>`).join('')}</div>
      <p class="quiet" style="margin-top:12px">Keys don’t fire while you type in a box.</p></div>
    <div class="where"><div><h4>Where things live</h4></div>${secs}
      <div class="wl"><b>Players</b><small>Click a player card: Overview, Conditions, Spell slots, Hooks, Notes</small></div>
      <div class="wl"><b>Home screen</b><div style="display:flex;flex-direction:column;gap:3px">${HOME_PARTS.map(([a, b]) => `<span>${a} <small>${b}</small></span>`).join('')}</div></div>
      ${tools.length ? `<div class="wl"><b>Top bar</b><div style="display:flex;flex-direction:column;gap:3px">${tools.join('')}</div></div>` : ''}
      <div class="wl"><b>Setup</b><span><button class="lnk" type="button" id="hlpGs">Show getting started</button></span></div>
      <div class="wl"><b>About</b><span>Unofficial fan content, not affiliated with Wizards of the Coast. Includes SRD 5.2.1 material (CC-BY-4.0). <button class="lnk" type="button" data-hgo="battle:rules">Credits in Quick rules</button></span></div></div></div>`
    );
  }
  function openHelp() {
    const el = popup('Help', helpHTML());
    el.querySelector('.mc').classList.add('helpmc');
    el.dataset.help = '1';
    el.querySelectorAll('[data-hgo]').forEach(
      (b) =>
        (b.onclick = () => {
          const [s, k] = b.dataset.hgo.split(':');
          el.remove();
          openSheet(s, k);
        })
    );
    el.querySelector('#hlpGs').onclick = () => {
      el.remove();
      if (view) closeSheet();
      if (S.dm.setupHide) {
        S.dm.setupHide = false;
        commit();
      }
      if (!gsShow()) {
        toast(
          gsComplete()
            ? 'Every getting started step is done'
            : 'Getting started is for a new board, before the first recap'
        );
        return;
      }
      const g = $('gsBox');
      g && g.scrollIntoView({ block: 'center' });
    };
    el.querySelector('[data-mclose]').focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    const mc = $('mcard');
    if (mc) {
      if (mc.dataset.help) {
        e.preventDefault();
        mc.remove();
      }
      return;
    }
    e.preventDefault();
    openHelp();
  });
  (() => {
    const f = document.querySelector('footer.foot');
    if (!f || $('helpBtn')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'helpBtn';
    b.className = 'helpb';
    b.textContent = '?';
    b.title = 'Keys and where everything lives (?)';
    b.setAttribute('aria-label', 'Help: keys and where everything lives');
    b.onclick = openHelp;
    f.appendChild(b);
  })();
  /* ---------- backup ---------- */
  async function exportData() {
    S.dm.lastBackup = today();
    save();
    if (view && view.sec === 'campaign') drawSheet();
    const json = backupJSON();
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `dm-board-${today()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {}
    askPersist();
    drawSaveState();
    try {
      await navigator.clipboard.writeText(json);
      toast('Backup saved and copied to clipboard');
    } catch (e) {
      toast('Backup saved');
    }
  }
  $('exportBtn').onclick = exportData;
  $('importBtn').onclick = () => $('importFile').click();
  $('jotBtn').onclick = openJot;
  $('skBtn').onclick = () => openSheet('notes', 'sketch');
  $('importFile').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 50e6) {
      toast('That file is too big to be a board backup');
      e.target.value = '';
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      let d;
      try {
        d = JSON.parse(r.result);
        if (!d || typeof d !== 'object' || !Array.isArray(d.players) || !d.dm) throw 0;
      } catch (err) {
        toast('That file isn’t a board backup');
        return;
      }
      const bMeta = d._meta && typeof d._meta === 'object' ? d._meta : {};
      if (bMeta.app !== undefined && bMeta.app !== 'dm-board') {
        toast('That file isn’t a board backup');
        return;
      }
      if (+bMeta.format > 1) {
        toast('This backup was made by a newer version of the board');
        return;
      }
      delete d._meta;
      const imgs = d.images;
      delete d.images;
      const chk = checkBoard(d);
      if (!chk.board) {
        toast('That backup is damaged and couldn’t be loaded');
        return;
      }
      const go = () => {
        const kept = !S.example,
          localAt = localChangedAt();
        takeSnap('Before loading a backup', true);
        // build the new board on the side; the current one stays untouched unless this succeeds
        const oldS = S,
          oldI = IMGS;
        try {
          if (imgs) IMGS = Object.assign({}, IMGS, cleanImgs(imgs));
          S = chk.board;
          normalize();
        } catch (err) {
          S = oldS;
          IMGS = oldI;
          toast('That backup is damaged and couldn’t be loaded');
          return;
        }
        UNDO = [];
        undoClear();
        endHold();
        resetTemp();
        S.example = false;
        pruneImgs(true);
        saveImgs();
        save();
        render();
        toast(importNote(bMeta, localAt, kept));
      };
      if (!chk.damaged) return go();
      const el = popup(
        'Damaged backup',
        popHead(
          'Some of this backup looks damaged',
          esc(BK() ? BK().reasonText(chk.reasons) : chk.reasons.join(', ')) + ' Load what can be read?'
        ) +
          `<div class="row end"><button class="btn ghost" type="button" data-mclose id="dbNo">Cancel</button><button class="btn pri" type="button" id="dbGo">Load what can be read</button></div>`
      );
      el.querySelector('#dbNo').focus();
      el.querySelector('#dbGo').onclick = () => {
        el.remove();
        go();
      };
    };
    r.readAsText(f);
    e.target.value = '';
  };

  /* ---------- dice ---------- */
  const rnd = (n) => 1 + Math.floor(Math.random() * n);
  const sgn = (v) => (v ? (v > 0 ? ` + ${v}` : ` − ${-v}`) : '');
  function d20m(mode) {
    const a = rnd(20),
      c = rnd(20);
    return mode === 'adv'
      ? { v: Math.max(a, c), r: [a, c] }
      : mode === 'dis'
        ? { v: Math.min(a, c), r: [a, c] }
        : { v: a, r: [a] };
  }
  // "2d6+1d4+3" -> {total, parts}; crit doubles the dice, not the modifier
  function rollExpr(expr, crit) {
    const x = String(expr).toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
    if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(x)) return null;
    let total = 0;
    const parts = [],
      dice = [];
    x.replace(/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g, (m, sg, c, fc, sg2, k) => {
      if (fc) {
        const sign = sg === '-' ? -1 : 1,
          n = Math.min(100, (+c || 1) * (crit ? 2 : 1)),
          face = Math.max(1, Math.min(1000, +fc)),
          r = [];
        for (let i = 0; i < n; i++) r.push(rnd(face));
        r.forEach((v) => dice.push({ f: face, v, neg: sign < 0 }));
        total += sign * r.reduce((a, v) => a + v, 0);
        parts.push(`${sign < 0 ? '− ' : parts.length ? '+ ' : ''}${n}d${face} [${r.join(', ')}]`);
      } else {
        const v = (sg2 === '-' ? -1 : 1) * +k;
        total += v;
        parts.push(v < 0 ? `− ${-v}` : `${parts.length ? '+ ' : ''}${v}`);
      }
      return m;
    });
    return { total, parts: parts.join(' '), dice };
  }
  const DICE = {
    n: 1,
    mod: 0,
    mode: 'norm',
    expr: '',
    last: null,
    hist: [],
    tab: 'roll',
    gk: 'Stealth',
    gdc: 10,
    sk: 'Perception',
    sdc: 13,
    gres: null,
    sres: null,
  };
  const FACES = [4, 6, 8, 10, 12, 20, 100];
  function pushRoll(r) {
    DICE.spin = true;
    DICE.last = r;
    DICE.hist.unshift(r);
    DICE.hist = DICE.hist.slice(0, 12);
  }
  function rollFace(f) {
    const n = DICE.n,
      mod = DICE.mod;
    if (f === 20 && n === 1) {
      const d = d20m(DICE.mode);
      pushRoll({
        dice: d.r.map((v, i) => ({ f: 20, v, off: d.r.length > 1 && i !== d.r.indexOf(d.v) })),
        label: `d20${sgn(mod)}${DICE.mode === 'adv' ? ' with advantage' : DICE.mode === 'dis' ? ' with disadvantage' : ''}`,
        total: d.v + mod,
        bd: `${d.r.length > 1 ? `[${d.r.join(', ')}] keep ${d.v}` : d.v}${sgn(mod)}`,
        nat: d.v,
      });
      return;
    }
    const r = [];
    for (let i = 0; i < n; i++) r.push(rnd(f));
    pushRoll({
      dice: r.map((v) => ({ f, v })),
      label: `${n}d${f}${sgn(mod)}`,
      total: r.reduce((a, v) => a + v, 0) + mod,
      bd: `[${r.join(', ')}]${sgn(mod)}`,
    });
  }
  // slot-machine reels: each die scrolls through random faces and lands on its roll, one after another
  function reelsHTML(L, spin) {
    const ds = (L.dice || []).slice(0, 8),
      more = (L.dice || []).length - ds.length;
    if (!ds.length) return { html: '', end: 0 };
    const step = ds.length > 4 ? 140 : 220;
    let end = 0;
    const html = `<div class="reels${spin ? '' : ' still'}" aria-hidden="true">${ds
      .map((d, i) => {
        const k = 12 + i * 3,
          dur = 850 + i * step;
        end = Math.max(end, dur);
        const nums = Array.from({ length: k - 1 }, () => rnd(d.f));
        nums.push(d.v);
        return `<div class="reel${d.off ? ' off' : ''}" style="--d:${dur}ms"><div class="win"><div class="strip" style="--end:calc(${-(k - 1)} * var(--rh))">${nums.map((v) => `<span>${v}</span>`).join('')}</div></div><small>${d.neg ? '−' : ''}d${d.f}</small></div>`;
      })
      .join(
        ''
      )}${more > 0 ? `<span class="rmore" title="${more} more dice not shown" aria-label="${more} more dice not shown">+${more} more</span>` : ''}</div>`;
    return { html, end: spin ? end : 0 };
  }
  function diceRollHTML() {
    const L = DICE.last;
    const spin = !!DICE.spin;
    DICE.spin = false;
    const RL = L ? reelsHTML(L, spin) : { html: '', end: 0 };
    return `<div class="dice">
    <div class="dpre">${FACES.map((f) => `<button type="button" data-face="${f}" aria-label="Roll ${DICE.n}d${f}">${f === 100 ? '%' : f}<small>d${f}</small></button>`).join('')}</div>
    <div class="dopts">
      <div class="grp">How many <div class="stepper"><button type="button" data-dn="-1" aria-label="Fewer dice">−</button><span class="v">${DICE.n}</span><button type="button" data-dn="1" aria-label="More dice">+</button></div></div>
      <div class="grp">Modifier <div class="stepper"><button type="button" data-dm="-1" aria-label="Lower modifier">−</button><span class="v">${DICE.mod > 0 ? '+' : ''}${DICE.mod}</span><button type="button" data-dm="1" aria-label="Raise modifier">+</button></div></div>
      <div class="grp">d20 <div class="seg" role="group" aria-label="Advantage">${[
        ['dis', 'Disadv.'],
        ['norm', 'Normal'],
        ['adv', 'Adv.'],
      ]
        .map(([k, l]) => `<button type="button" data-dmode="${k}" aria-pressed="${DICE.mode === k}">${l}</button>`)
        .join('')}</div></div>
    </div>
    <div class="dcust"><input type="text" id="dexpr" placeholder="Any roll, e.g. 2d6+3 or 1d8+2d6" value="${esc(DICE.expr)}" aria-label="Custom roll"><button class="btn" type="button" id="droll">Roll</button></div>
    <div class="dres${L && L.nat === 20 ? ' n20' : L && L.nat === 1 ? ' n1' : ''}${RL.end ? ' spinning' : ''}" style="--t:${RL.end}ms" aria-live="polite">${L ? `<div class="lbl">${esc(L.label)}</div>${RL.html}<div class="tot late">${L.total}</div>${L.nat === 20 ? '<div class="tag late" style="color:var(--good)">Natural 20</div>' : L.nat === 1 ? '<div class="tag late" style="color:var(--crit)">Natural 1</div>' : ''}<div class="bd late">${esc(L.bd)}</div>` : '<div class="lbl">Tap a die to roll it</div><div class="tot" style="color:var(--ink-3)">–</div>'}</div>
    ${
      DICE.hist.length > 1
        ? `<div class="dhist">${DICE.hist
            .slice(1)
            .map((h) => `<div><span>${esc(h.label)}</span><b>${h.total}</b></div>`)
            .join('')}</div>`
        : ''
    }
  </div>`;
  }
  function bindRoll(host) {
    const redraw = () => {
      host.innerHTML = diceHTML();
      bindDice(host);
    };
    host.querySelectorAll('[data-face]').forEach(
      (b) =>
        (b.onclick = () => {
          rollFace(+b.dataset.face);
          redraw();
        })
    );
    host.querySelectorAll('[data-dn]').forEach(
      (b) =>
        (b.onclick = () => {
          DICE.n = clamp(DICE.n + +b.dataset.dn, 1, 20);
          redraw();
        })
    );
    host.querySelectorAll('[data-dm]').forEach(
      (b) =>
        (b.onclick = () => {
          DICE.mod = clamp(DICE.mod + +b.dataset.dm, -20, 30);
          redraw();
        })
    );
    host.querySelectorAll('[data-dmode]').forEach(
      (b) =>
        (b.onclick = () => {
          DICE.mode = b.dataset.dmode;
          redraw();
        })
    );
    const ex = host.querySelector('#dexpr'),
      go = () => {
        DICE.expr = ex.value;
        const r = rollExpr(ex.value);
        if (!r) {
          toast('Try something like 2d6+3');
          return;
        }
        pushRoll({ dice: r.dice, label: ex.value.replace(/\s+/g, ''), total: r.total, bd: r.parts });
        redraw();
        const n = host.querySelector('#dexpr');
        n && n.focus();
      };
    host.querySelector('#droll').onclick = go;
    ex.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    };
  }
  function popup(label, inner) {
    $('mcard') && $('mcard').remove();
    const el = document.createElement('div');
    el.className = 'mc-ov';
    el.id = 'mcard';
    el.innerHTML = `<div class="mc" role="dialog" aria-modal="true" aria-label="${esc(label)}">${inner}</div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('[data-mclose]')) el.remove();
    });
    return el;
  }
  const popHead = (h, p) =>
    `<div class="mhead"><div><h3>${esc(h)}</h3>${p ? `<p class="ty">${p}</p>` : ''}</div><button class="x" type="button" data-mclose aria-label="Close">×</button></div>`;
  function openDice() {
    const el = popup(
      'Dice',
      popHead('Dice', 'Tap a die to roll. Set how many and a modifier first.') + '<div id="dhost"></div>'
    );
    const host = el.querySelector('#dhost');
    host.innerHTML = diceHTML();
    bindDice(host);
    (el.querySelector('[data-face="20"]') || el.querySelector('[data-dtab]')).focus();
  }
  VIEWS.battle.dice = () => ({
    html:
      head('Dice roller', 'Tap a die to roll it. Set how many dice and a modifier, or type any roll.') +
      '<div id="dhostS"></div>',
    bind: () => {
      const h = $('dhostS');
      h.innerHTML = diceHTML();
      bindDice(h);
    },
  });

  /* monster attack rolls in a live battle */
  // a later damage part of the same type as the first is a conditional bonus in the stat block (e.g. a goblin's extra 1d4 with Advantage)
  function splitBonus(str) {
    const s = String(str || '').split(' + '),
      ty = (x) => x.trim().split(' ').pop();
    if (s.length < 2) return { base: str, bonus: '' };
    const k = s.findIndex((x, i) => i > 0 && ty(x) === ty(s[0]));
    return k < 0 ? { base: str, bonus: '' } : { base: s.filter((_, i) => i !== k).join(' + '), bonus: s[k].trim() };
  }
  function rollDamage(str, crit) {
    // "7 (1d6+2) Slashing + 2 (1d4) Poison" or "1 Piercing"
    let total = 0;
    const bits = [];
    String(str || '')
      .split(' + ')
      .forEach((seg) => {
        const m = seg.trim().match(/^(\d+)(?: \(([^)]+)\))? ([A-Za-z]+)$/);
        if (!m) return;
        if (m[2]) {
          const r = rollExpr(m[2], crit);
          if (r) {
            total += Math.max(0, r.total);
            bits.push(`${Math.max(0, r.total)} ${m[3]} (${r.parts})`);
            return;
          }
        }
        total += +m[1];
        bits.push(`${m[1]} ${m[3]}`);
      });
    return { total, text: bits.join(' + ') };
  }
  const AT = {};
  function openAttack(b, i) {
    const c = b.combatants[i];
    const atks = (MM_ATK[c.base] || [0]).slice(1);
    const pcs = b.combatants.map((x, j) => ({ x, j })).filter((o) => o.x.pid);
    if (AT.cid !== c.id || AT.bid !== b.id || !pcs.some((o) => o.x.id === AT.tid))
      Object.assign(AT, {
        cid: c.id,
        bid: b.id,
        ai: 0,
        tid: ((pcs.find((o) => cbState(o.x).hp > 0) || pcs[0] || {}).x || {}).id || null,
        mode: 'norm',
        res: null,
        hit: '+3',
        dmg: '1d6+1',
      });
    const draw = () => {
      const custom = AT.ai >= atks.length;
      const a = custom ? ['Attack', AT.hit, '', AT.dmg] : atks[AT.ai];
      const isSave = !custom && a[1].startsWith('DC');
      const t = b.combatants.find((x) => x.pid && x.id === AT.tid) || null,
        th = t ? cbState(t) : null;
      const R = AT.res;
      const el = popup(
        `${c.name} attacks`,
        popHead(`${c.name} attacks`, 'Pick the attack and the target, then roll.') +
          `
      <div class="atkf">
        <label>Attack<select id="aSel">${atks.map((x, k) => `<option value="${k}"${k === AT.ai ? ' selected' : ''}>${esc(x[0])} (${esc(x[1])})${(c.spent || {})[x[0]] ? ' · spent' : ''}</option>`).join('')}<option value="${atks.length}"${custom ? ' selected' : ''}>Custom attack…</option></select></label>
        <label>Target<select id="tSel">${
          pcs.length
            ? pcs
                .map((o) => {
                  const h = cbState(o.x);
                  return `<option value="${o.x.id}"${o.x.id === AT.tid ? ' selected' : ''}>${esc(o.x.name)} · AC ${h.ac} · HP ${h.hp}/${h.max}</option>`;
                })
                .join('')
            : '<option value="">No players in this battle</option>'
        }</select></label>
        ${custom ? `<label>To-hit bonus<input type="text" id="cHit" value="${esc(AT.hit)}"></label><label>Damage dice<input type="text" id="cDmg" value="${esc(AT.dmg)}" placeholder="1d8+3"></label>` : ''}
      </div>
      ${!custom && (c.spent || {})[a[0]] ? '<div class="spd" style="color:var(--crit)">Spent. It rolls to recharge at the start of its turn.</div>' : ''}
      ${!isSave && advHint(c, th, a) ? `<div class="spd advhint">${esc(advHint(c, th, a))}</div>` : ''}
      ${!custom ? `<div class="spd">${isSave ? `${esc(a[1])} save` : `${esc(a[1])} to hit${a[2] ? `, ${a[2].startsWith('range') ? '' : 'reach '}${esc(a[2])}` : ''}`}${a[3] ? ` · ${esc(a[3])}` : ''}</div>` : ''}
      ${!custom && splitBonus(a[3]).bonus ? `<label class="spd" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="aBonus"${AT.bonus ? ' checked' : ''}>Add the extra ${esc(splitBonus(a[3]).bonus)} (only when its condition is met, e.g. Advantage)</label><label class="spd" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="aAdvB"${advbHas(c.base, a[0]) ? ' checked' : ''}>Only with Advantage: tick it for me when I choose Advantage (remembered for every ${esc(c.base)})</label>` : ''}
      ${
        isSave
          ? ''
          : `<div class="row between"><div class="seg" role="group" aria-label="Advantage">${[
              ['dis', 'Disadvantage'],
              ['norm', 'Normal'],
              ['adv', 'Advantage'],
            ]
              .map(([k, l]) => `<button type="button" data-amode="${k}" aria-pressed="${AT.mode === k}">${l}</button>`)
              .join('')}</div><button class="btn pri" type="button" id="aRoll">Roll to hit</button></div>`
      }
      ${isSave ? `<div class="row between"><span class="spd">${t ? esc(t.name) : 'The target'} rolls the save.</span><div class="row"><button class="btn" type="button" data-sv="made">Made save</button><button class="btn pri" type="button" data-sv="fail">Failed save</button></div></div>` : ''}
      ${
        R
          ? `<div class="dres"><div class="verdict ${R.hit ? 'hit' : 'miss'}">${R.title}</div><div class="bd">${esc(R.bd)}</div>${R.dmg != null ? `<div class="lbl" style="margin-top:6px">Damage</div><div class="tot">${R.dmg}</div><div class="bd">${esc(R.dtext)}</div>` : ''}</div>
        ${R.dmg && t ? `<div class="apply"><input type="number" min="0" id="aAmt" value="${R.dmg}" aria-label="Damage to apply"><button class="btn pri" type="button" id="aApply">Apply to ${esc(t.name)}</button></div>` : ''}`
          : ''
      }`
      );
      const q = (s) => el.querySelector(s);
      q('#aSel').onchange = (e) => {
        AT.ai = +e.target.value;
        AT.res = null;
        {
          const x = atks[AT.ai];
          if (x && splitBonus(x[3]).bonus && advbHas(c.base, x[0])) AT.bonus = AT.mode === 'adv';
        }
        draw();
      };
      q('#tSel').onchange = (e) => {
        AT.tid = e.target.value || null;
        AT.res = null;
        draw();
      };
      q('#cHit') && (q('#cHit').oninput = (e) => (AT.hit = e.target.value));
      q('#cDmg') && (q('#cDmg').oninput = (e) => (AT.dmg = e.target.value));
      el.querySelectorAll('[data-amode]').forEach(
        (x) =>
          (x.onclick = () => {
            AT.mode = x.dataset.amode;
            if (!custom && splitBonus(a[3]).bonus && advbHas(c.base, a[0])) AT.bonus = AT.mode === 'adv';
            draw();
          })
      );
      q('#aAdvB') &&
        (q('#aAdvB').onchange = (e) => {
          advbSet(c.base, a[0], e.target.checked);
          if (e.target.checked) AT.bonus = AT.mode === 'adv';
          commit();
          draw();
        });
      const dmgOf = (crit) => {
        if (custom) {
          const r = rollExpr(AT.dmg, crit);
          return r ? { total: Math.max(0, r.total), text: r.parts } : { total: 0, text: 'Check the damage dice' };
        }
        const sp = splitBonus(a[3]);
        return rollDamage(sp.bonus && !AT.bonus ? sp.base : a[3], crit);
      };
      const bx = q('#aBonus');
      bx &&
        (bx.onchange = (e) => {
          AT.bonus = e.target.checked;
        });
      q('#aRoll') &&
        (q('#aRoll').onclick = () => {
          const bonus = parseInt(String(a[1]).replace('−', '-'), 10) || 0;
          const d = d20m(AT.mode),
            tot = d.v + bonus,
            crit = d.v === 20;
          const autoCrit =
            th &&
            (th.cond.includes('Unconscious') || th.cond.includes('Paralyzed')) &&
            !String(a[2]).startsWith('range');
          const hit = crit || (d.v !== 1 && (!th || tot >= th.ac));
          const crit2 = crit || (hit && autoCrit);
          const dm = hit ? dmgOf(crit2) : null;
          AT.crit = crit2;
          if (!custom && /Recharge/.test(a[0])) {
            c.spent = c.spent || {};
            c.spent[a[0]] = true;
          }
          AT.res = {
            hit,
            title: crit
              ? 'Critical hit!'
              : crit2
                ? 'Critical hit (target is helpless)'
                : d.v === 1
                  ? 'Natural 1, miss'
                  : hit
                    ? 'Hit'
                    : 'Miss',
            bd: `${d.r.length > 1 ? `[${d.r.join(', ')}] keep ${d.v}` : d.v}${sgn(bonus)} = ${tot}${th ? ` vs AC ${th.ac}` : ''}`,
            dmg: dm ? dm.total : null,
            dtext: dm ? dm.text + (crit ? ' · dice doubled' : '') : '',
          };
          b.log.push(
            `R${b.round}: ${c.name} ${crit ? 'crits' : hit ? 'hits' : 'misses'}${t ? ` ${t.name}` : ''} with ${a[0]} (${tot}${th ? ` vs AC ${th.ac}` : ''}).`
          );
          save();
          draw();
          if (view) drawSheet();
        });
      el.querySelectorAll('[data-sv]').forEach(
        (x) =>
          (x.onclick = () => {
            const made = x.dataset.sv === 'made',
              dm = dmgOf(false),
              n = made ? Math.floor(dm.total / 2) : dm.total;
            AT.crit = false;
            if (/Recharge/.test(a[0])) {
              c.spent = c.spent || {};
              c.spent[a[0]] = true;
            }
            AT.res = {
              hit: !made,
              title: made ? 'Save made, half damage' : 'Save failed',
              bd: `${a[1]} save`,
              dmg: a[3] ? n : null,
              dtext: a[3] ? dm.text + (made ? ` · halved from ${dm.total}` : '') : '',
            };
            b.log.push(
              `R${b.round}: ${t ? t.name : 'Target'} ${made ? 'makes' : 'fails'} the ${a[1]} save against ${c.name}'s ${a[0]}.`
            );
            save();
            draw();
            if (view) drawSheet();
          })
      );
      q('#aApply') &&
        (q('#aApply').onclick = () => {
          const n = Math.max(0, +q('#aAmt').value || 0);
          if (!S.players.find((x) => x.id === t.pid)) return;
          b.log.push(hurt(b, t, -n, AT.crit).replace(' damage', ` damage from ${c.name}`));
          AT.res = null;
          $('mcard') && $('mcard').remove();
          commit();
          toast(`${t.name} took ${n} damage`);
        });
      (q('#aRoll') || q('[data-sv="fail"]') || q('#aSel')).focus();
    };
    draw();
  }
  /* ---------- v10: features found in other DM tools ---------- */
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const CR_XP = {
    0: 10,
    '1/8': 25,
    '1/4': 50,
    '1/2': 100,
    1: 200,
    2: 450,
    3: 700,
    4: 1100,
    5: 1800,
    6: 2300,
    7: 2900,
    8: 3900,
    9: 5000,
    10: 5900,
    11: 7200,
    12: 8400,
    13: 10000,
    14: 11500,
    15: 13000,
    16: 15000,
    17: 18000,
    18: 20000,
    19: 22000,
    20: 25000,
    21: 33000,
    22: 41000,
    23: 50000,
    24: 62000,
    25: 75000,
    26: 90000,
    27: 105000,
    28: 120000,
    29: 135000,
    30: 155000,
  };
  function avgExpr(x) {
    let t = 0,
      ok = false;
    String(x || '')
      .replace(/\s+/g, '')
      .replace(/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi, (m, sg, c, f, sg2, k) => {
        ok = true;
        if (f) t += ((sg === '-' ? -1 : 1) * (+c || 1) * (+f + 1)) / 2;
        else t += (sg2 === '-' ? -1 : 1) * +k;
        return m;
      });
    return ok ? Math.max(0, Math.floor(t)) : 0;
  }
  function dmgStr(dice, type) {
    dice = String(dice || '').trim();
    if (!dice) return '';
    let ty =
      String(type || '')
        .trim()
        .split(/\s+/)[0] || 'Bludgeoning';
    ty = ty[0].toUpperCase() + ty.slice(1).toLowerCase();
    return /d/i.test(dice) ? `${avgExpr(dice)} (${dice.replace(/\s+/g, '')}) ${ty}` : `${+dice || 0} ${ty}`;
  }
  // homebrew monsters join the bestiary, pickers and attack rolls
  function syncHomebrew() {
    for (let i = MONSTERS.length - 1; i >= 0; i--)
      if (MONSTERS[i].hb) {
        MON_BY_NAME.delete(MONSTERS[i].n);
        delete MM_ATK[MONSTERS[i].n];
        MONSTERS.splice(i, 1);
      }
    (S.homebrew || []).forEach((h) => {
      if (!h.n || MON_BY_NAME.has(h.n)) return;
      const m = {
        n: h.n,
        t: h.t || 'Homebrew',
        ac: +h.ac || 10,
        ini: +h.ini || 0,
        hp: +h.hp || 1,
        cr: h.cr || '0',
        xp: +h.xp || 0,
        spd: h.spd || '30 ft.',
        hb: true,
      };
      MONSTERS.push(m);
      MON_BY_NAME.set(m.n, m);
      MM_ATK[m.n] = [
        (+h.multi || 1) > 1 ? +h.multi : 0,
        ...(h.atks || []).filter((a) => a[0]).map((a) => [a[0], a[1] || '+0', a[2] || '', dmgStr(a[3], a[4])]),
      ];
    });
    let dl = document.getElementById('monList');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'monList';
      document.body.appendChild(dl);
    }
    dl.innerHTML = MONSTERS.map((m) => `<option value="${esc(m.n)}">`).join('');
  }
  VIEWS.battle.homebrew = () => {
    const o = editing('homebrew');
    const A = (o && o.atks) || [];
    const at = (i, j) => esc((A[i] || [])[j] ?? '');
    return {
      html:
        head(
          'Homebrew monsters',
          'Your own creatures. They appear in the Bestiary, New battle and Add to battle, and can roll attacks.'
        ) +
        `
  <div class="box ${o ? 'editing' : ''}"><div class="grid">
    <label class="f">Name<input type="text" id="hN" placeholder="Ash Wraith" value="${ev(o, 'n')}"></label>
    <label class="f">Type<input type="text" id="hT" placeholder="Medium Undead" value="${ev(o, 't')}"></label>
    <label class="f">CR<select id="hCr">${Object.keys(CR_XP)
      .map((k) => `<option${(o ? o.cr : '1') === k ? ' selected' : ''}>${k}</option>`)
      .join('')}</select></label>
    <label class="f">AC<input type="number" id="hAc" value="${o ? ev(o, 'ac') : 13}"></label>
    <label class="f">HP<input type="number" id="hHp" min="1" value="${o ? ev(o, 'hp') : 20}"></label>
    <label class="f">Initiative bonus<input type="number" id="hIni" value="${o ? ev(o, 'ini') : 1}"></label>
    <label class="f">Speed<input type="text" id="hSpd" value="${o ? ev(o, 'spd') : '30 ft.'}"></label>
    <label class="f">Attacks per turn<input type="number" id="hMulti" min="1" max="6" value="${o ? Math.max(1, +o.multi || 1) : 1}"></label></div>
    <h4>Attacks</h4>
    ${[0, 1].map((i) => `<div class="hbatk"><input type="text" id="hA${i}n" placeholder="${i ? 'Second attack (optional)' : 'Claw'}" value="${at(i, 0)}" aria-label="Attack name"><input type="text" id="hA${i}h" placeholder="+5 or DC 13 DEX" value="${at(i, 1)}" aria-label="To hit or save DC"><input type="text" id="hA${i}r" placeholder="5 ft" value="${at(i, 2)}" aria-label="Reach or range"><input type="text" id="hA${i}d" placeholder="1d8+3" value="${at(i, 3)}" aria-label="Damage dice"><input type="text" id="hA${i}t" placeholder="Slashing" value="${at(i, 4)}" aria-label="Damage type"></div>`).join('')}
    ${formBtns(o, 'hSave', 'Add monster')}</div>
  ${
    S.homebrew.length
      ? `<div class="list">${S.homebrew
          .map(
            (h) =>
              `<div class="item"><div class="row between">${monLink(h.n)}<span class="pill mut num">CR ${esc(h.cr)} · AC ${esc(h.ac)} · HP ${esc(h.hp)}</span></div><div class="meta">${esc(h.t || 'Homebrew')}${(
                h.atks || []
              )
                .filter((a) => a[0])
                .map((a) => ` · ${esc(a[0])} ${esc(a[1])}`)
                .join(
                  ''
                )}</div><div class="row end">${editBtn('homebrew', h.id)}<button class="btn sm ghost" type="button" data-hdel="${h.id}">Delete</button></div></div>`
          )
          .join('')}</div>`
      : '<div class="empty">No homebrew monsters yet.</div>'
  }`,
      bind: () => {
        bindEdits();
        $('hSave').onclick = () => {
          const n = val('hN');
          if (!n) {
            toast('Name the monster first');
            return;
          }
          const clash = MON_BY_NAME.get(n);
          if (clash && (!clash.hb || !o || o.n !== n)) {
            toast('That name is already in the bestiary');
            return;
          }
          const atks = [0, 1]
            .map((i) => [val(`hA${i}n`), val(`hA${i}h`) || '+0', val(`hA${i}r`), val(`hA${i}d`), val(`hA${i}t`)])
            .filter((a) => a[0]);
          const cr = val('hCr');
          const f = {
            n,
            t: val('hT'),
            cr,
            xp: CR_XP[cr] || 0,
            ac: +val('hAc') || 10,
            hp: Math.max(1, +val('hHp') || 1),
            ini: +val('hIni') || 0,
            spd: val('hSpd'),
            multi: clamp(+val('hMulti') || 1, 1, 6),
            atks,
          };
          if (o && o.n !== n) {
            if (S.monNotes && monNote(o.n) && !monNote(n)) {
              S.monNotes[n] = S.monNotes[o.n];
              delete S.monNotes[o.n];
            }
            S.battles.forEach((b) =>
              b.combatants.forEach((c) => {
                if (c.base === o.n) c.base = n;
              })
            );
            S.plans.forEach((pl) =>
              pl.foes.forEach((g) => {
                if (g.base === o.n) g.base = n;
              })
            );
          }
          if (o) Object.assign(o, f);
          else S.homebrew.push(Object.assign({ id: uid() }, f));
          EDIT = null;
          syncHomebrew();
          commit();
          toast(o ? 'Changes saved' : `${n} added to the bestiary`);
        };
        $('overlay')
          .querySelectorAll('[data-hdel]')
          .forEach((b) =>
            armDelete(
              b,
              () => {
                const h = S.homebrew.find((x) => x.id === b.dataset.hdel),
                  ab = activeBattle();
                if (h && ab && ab.combatants.some((c) => c.base === h.n)) {
                  toast(`${h.n} is in the live battle. End it first.`);
                  return;
                }
                S.homebrew = S.homebrew.filter((x) => x.id !== b.dataset.hdel);
                syncHomebrew();
                commit();
              },
              'Confirm'
            )
          );
      },
    };
  };

  /* planned encounters */
  const planXp = (pl) => pl.foes.reduce((s, g) => s + (+g.xp || 0) * g.count, 0);
  VIEWS.battle.plans = () => ({
    html:
      head('Planned encounters', 'Fights you built ahead of time. Load one when the party gets there.') +
      (S.plans.length
        ? `<div class="list">${S.plans.map((pl) => `<div class="item"><div class="row between"><strong>${esc(pl.name)}</strong><span class="pill mut num">${planXp(pl).toLocaleString()} XP</span></div><div class="meta">${esc(pl.foes.map((g) => `${g.count} × ${g.base}`).join(', '))}</div><div class="row end"><button class="btn sm pri" type="button" data-pload="${pl.id}">Load into New battle</button><button class="btn sm ghost" type="button" data-pdel="${pl.id}">Delete</button></div></div>`).join('')}</div>`
        : '<div class="empty">No planned encounters. Build one under New battle and choose Save as plan.</div>'),
    bind: () => {
      const ov = $('overlay');
      ov.querySelectorAll('[data-pload]').forEach(
        (b) =>
          (b.onclick = () => {
            if (activeBattle()) {
              toast('End the current battle first');
              return;
            }
            loadPlan(S.plans.find((x) => x.id === b.dataset.pload));
          })
      );
      ov.querySelectorAll('[data-pdel]').forEach((b) =>
        armDelete(
          b,
          () => {
            S.plans = S.plans.filter((x) => x.id !== b.dataset.pdel);
            commit();
          },
          'Confirm'
        )
      );
    },
  });
  function loadPlan(pl) {
    bdraft = {
      name: pl.name,
      picked: S.players.filter(inPlay).map((p) => p.id),
      foes: [],
      custom: [],
      goal: pl.goal || '',
      lose: pl.lose || '',
      events: (pl.events || []).map((x) => ({ ...x })),
    };
    pl.foes.forEach((g) => {
      let m = MON_BY_NAME.get(g.base);
      if (!m) {
        m = { n: g.base, hp: g.hp, ac: g.ac, ini: g.ini, xp: g.xp };
        bdraft.custom.push(m);
      }
      addFoes(m, g.count);
    });
    view.sub = 'new';
    drawSheet(true);
    toast(`${pl.name} loaded`);
  }
  function savePlan() {
    if (!bdraft || !bdraft.foes.length) {
      toast('Add monsters first');
      return;
    }
    const name = bdraft.name || `Encounter ${S.plans.length + 1}`;
    const pl = {
      id: uid(),
      name,
      foes: foeGroups().map(({ f, count }) => ({
        base: f.base,
        count,
        hp: f.maxHp,
        ac: f.ac,
        ini: f.ini,
        xp: f.xp || 0,
      })),
      created: today(),
      goal: (bdraft.goal || '').trim(),
      lose: (bdraft.lose || '').trim(),
      events: (bdraft.events || []).map((x) => ({ r: x.r, text: x.text })),
    };
    const i = S.plans.findIndex((x) => x.name === name);
    if (i >= 0) S.plans[i] = pl;
    else S.plans.push(pl);
    commit();
    toast(`Saved “${name}” under Planned`);
  }
  // random encounter that fits the party's 2024 XP budget
  function genEncounter(diff, type) {
    if (!bdraft.picked.length) return 'Pick the players joining first';
    const th = xpBudget().th,
      hi = th[diff],
      lo = diff ? th[diff - 1] : Math.floor(th[0] / 2);
    const t = type.trim().toLowerCase();
    const pool = MONSTERS.filter(
      (m) => m.xp > 0 && m.xp <= hi && (!t || (m.t || '').toLowerCase().includes(t) || m.n.toLowerCase().includes(t))
    );
    if (!pool.length) return t ? `No “${type}” monster fits this party’s budget` : 'No monsters fit this budget';
    let best = null,
      bestTot = -1;
    for (let k = 0; k < 40; k++) {
      const lead = pool.filter((m) => m.xp >= hi / 6),
        L = pick(lead.length ? lead : pool);
      const nL = 1 + Math.floor(Math.random() * Math.min(4, Math.floor(hi / L.xp)));
      let left = hi - nL * L.xp;
      const set = [[L, nL]];
      const mins = pool.filter((m) => m.n !== L.n && m.xp <= left && m.xp >= left / 6);
      if (mins.length && Math.random() < 0.7) {
        const M = pick(mins),
          c = Math.min(6, Math.floor(left / M.xp));
        if (c) {
          set.push([M, c]);
          left -= c * M.xp;
        }
      }
      const tot = hi - left;
      if (tot > bestTot) {
        best = set;
        bestTot = tot;
      }
      if (tot > lo) break;
    }
    bdraft.foes = [];
    best.forEach(([m, c]) => addFoes(m, c));
    return '';
  }
  function rollFoes(pr) {
    const g = {},
      roll = () => (pr.surp ? Math.min(d20(), d20()) : d20());
    pr.foes.forEach((f) => {
      const r = pr.group ? (g[f.base] ??= roll()) : roll();
      f.roll = r;
      f.init = r + (+f.ini || 0);
    });
  }
  // a turn's start-of-turn effects run once, even if the DM steps back with Previous and forward again
  function reachTurn(b) {
    const k = b.round * 1000 + b.turn;
    if (k > (b.reach || 0)) {
      b.reach = k;
      startTurn(b, b.combatants[b.turn]);
    }
  }
  // 2024 death saving throw: 10+ succeeds, a 1 counts as two failures, a 20 brings them back with 1 HP
  function deathSave(b, c) {
    const p = S.players.find((x) => x.id === c.pid);
    if (!p) return '';
    c.ds = c.ds || { s: 0, f: 0 };
    const r = rnd(20),
      ex = 2 * (+p.exh || 0),
      tot = r - ex;
    let line = `R${b.round}: ${c.name} rolls ${r}${ex && r > 1 && r < 20 ? ` − ${ex} for Exhaustion = ${tot}` : ''} on a death save`;
    if (r === 20) {
      changeHp(p, 1);
      line += ' and regains 1 HP.';
      toast(`${c.name} rolls a 20 and is back up with 1 HP`);
      return line;
    }
    if (r === 1) c.ds.f = Math.min(3, c.ds.f + 2);
    else if (tot >= 10) c.ds.s = Math.min(3, c.ds.s + 1);
    else c.ds.f = Math.min(3, c.ds.f + 1);
    line += `: ${r === 1 ? 'two failures' : tot >= 10 ? 'success' : 'failure'} (${c.ds.s} ✓, ${c.ds.f} ✗).`;
    if (c.ds.f >= 3) {
      p.dead = true;
      tlog(`${c.name} died.`, true);
      line += ` ${c.name} has died.`;
      toast(`${c.name} has died`);
    } else if (c.ds.s >= 3) {
      c.ds.f = 0;
      line += ` ${c.name} is stable.`;
      toast(`${c.name} is stable`);
    } else toast(`Death save ${r}: ${r === 1 ? 'two failures' : tot >= 10 ? 'success' : 'failure'}`);
    return line;
  }
  function startTurn(b, c) {
    if (!c) return;
    if (c.delayed) {
      delete c.delayed;
      return;
    }
    {
      const p = c.pid && S.players.find((x) => x.id === c.pid);
      if (p && p.hp <= 0 && !p.dead && (c.ds?.s || 0) < 3)
        b.log.push(`R${b.round}: ${c.name} is dying and makes a death saving throw.`);
    }
    if (c.leg && c.leg.au) {
      c.leg.au = 0;
      b.log.push(`R${b.round}: ${c.name} regains its legendary actions.`);
    }
    (c.fx || []).forEach((x) => x.rounds--);
    (c.fx || []).filter((x) => x.rounds <= 0).forEach((x) => b.log.push(`R${b.round}: ${x.name} on ${c.name} ends.`));
    c.fx = (c.fx || []).filter((x) => x.rounds > 0);
    Object.keys(c.spent || {}).forEach((n) => {
      const m = n.match(/Recharge (\d)/);
      const need = m ? +m[1] : 6;
      const r = rnd(6);
      const nm = n.replace(/\s*\(Recharge[^)]*\)/, '');
      if (r >= need) {
        delete c.spent[n];
        b.log.push(`R${b.round}: ${c.name} rolls ${r} and recharges ${nm}.`);
      } else b.log.push(`R${b.round}: ${c.name} rolls ${r}, ${nm} is still spent.`);
    });
  }
  const legPips = (i, k, max, used, lbl) =>
    `<span class="lp" title="${lbl}">${k === 'au' ? 'LA' : 'LR'} ${Array.from({ length: max }, (_, n) => `<button type="button" class="${n < used ? 'on' : ''}" data-lg="${i}" data-k="${k}" data-n="${n}" aria-label="${lbl} ${n + 1}${n < used ? ' used' : ''}"></button>`).join('')}</span>`;
  const legHTML = (c, i) =>
    `<span class="leg">${legPips(i, 'au', c.leg.a, c.leg.au, 'Legendary action')}${c.leg.r ? legPips(i, 'ru', c.leg.r, c.leg.ru, 'Legendary resistance') : ''}<button type="button" class="legx" data-legoff="${i}" aria-label="Stop tracking legendary actions" title="Stop tracking">×</button></span>`;
  const lairRow = (
    b,
    c,
    i
  ) => `<div class="cb lair ${i === b.turn ? 'cur' : ''}"><div class="ini" title="Initiative">${c.init}</div>
  <div class="who"><strong>${esc(c.name)}</strong><div class="tags"><span class="pill mut">Lair action or hazard</span></div></div><div></div>
  <div class="act"><button class="rmb" type="button" data-rmcb="${i}" aria-label="Remove ${esc(c.name)} from battle" title="Remove from battle">×</button></div></div>`;

  /* battle map */
  let mapSel = null;
  function mapOf(b) {
    b.map = b.map || { cols: 20, rows: 14, img: null, pos: {} };
    b.map.pos = b.map.pos || {};
    return b.map;
  }
  const tokLabel = (n) => {
    const w = String(n).trim().split(/\s+/);
    const num = w.length > 1 && /^\d+$/.test(w[w.length - 1]) ? w.pop() : '';
    return (
      w
        .map((x) => [...x][0] || '')
        .slice(0, 2)
        .join('')
        .toUpperCase() + num
    );
  };
  function tokHTML(b, c, i, inGrid, ro) {
    const p = b.map.pos[c.id],
      h = cbState(c);
    return `<button type="button" class="tok${c.pid ? ' pc' : ''}${i === b.turn ? ' cur' : ''}${!ro && mapSel === c.id ? ' sel' : ''}${h.hp <= 0 ? ' down' : ''}" data-tok="${c.id}"${inGrid && p ? ` style="grid-area:${p[1] + 1}/${p[0] + 1}"` : ''} title="${esc(c.name)}" aria-label="${esc(c.name)}">${esc(tokLabel(c.name))}</button>`;
  }
  function mapGrid(b, ro) {
    const m = mapOf(b);
    let cells = '';
    if (!ro)
      for (let y = 0; y < m.rows; y++)
        for (let x = 0; x < m.cols; x++)
          cells += `<div class="cell" data-x="${x}" data-y="${y}" style="grid-area:${y + 1}/${x + 1}"></div>`;
    const toks = b.combatants
      .map((c, i) =>
        !c.lair && m.pos[c.id] && (!ro || c.pid || (cbState(c).hp > 0 && !c.hidden)) ? tokHTML(b, c, i, true, ro) : ''
      )
      .join('');
    return `<div class="map${ro ? ' ro' : ''}" style="--c:${m.cols};--r:${m.rows};grid-template-columns:repeat(${m.cols},minmax(0,1fr));grid-template-rows:repeat(${m.rows},minmax(0,1fr));aspect-ratio:${m.cols}/${m.rows};${mapBg(m) ? `background-image:url(${mapBg(m)});` : ''}">${cells}${toks}</div>`;
  }
  VIEWS.battle.map = () => {
    const b = activeBattle();
    if (!b)
      return {
        html:
          head('Battle map', 'A simple grid for positions and distances.') +
          '<div class="empty">Start a battle first, then place tokens here.</div>',
      };
    const m = mapOf(b);
    if (mapSel && !b.combatants.some((c) => c.id === mapSel)) mapSel = null;
    const sel = mapSel && b.combatants.find((c) => c.id === mapSel);
    const off = b.combatants.map((c, i) => (!c.lair && !m.pos[c.id] ? tokHTML(b, c, i, false) : '')).join('');
    return {
      html:
        head('Battle map', 'Tap a token, then tap a square to move it. Each square is 5 feet.') +
        `
    <div class="row mapctl" style="flex-wrap:wrap"><label class="f">Columns<input type="number" id="mC" min="5" max="40" value="${m.cols}"></label><label class="f">Rows<input type="number" id="mR" min="5" max="40" value="${m.rows}"></label>
      <button class="btn sm" type="button" id="mBg">${mapBg(m) ? 'Change' : 'Add'} map image</button>${mapBg(m) ? '<button class="btn sm ghost" type="button" id="mBgX">Remove image</button>' : ''}<button class="btn sm ghost" type="button" id="mClr">Clear tokens</button><input type="file" id="mFile" accept="image/*" hidden></div>
    <div class="mapinfo" id="mapDist">${sel ? `${esc(sel.name)} selected. Tap a square to move${m.pos[sel.id] ? ', or point at one to measure' : ''}.` : `Round ${b.round} · ${esc(b.combatants[b.turn]?.name || '')}’s turn`}</div>
    ${mapGrid(b, false)}
    ${sel && m.pos[sel.id] ? `<div class="row"><button class="btn sm ghost" type="button" id="mOff">Take ${esc(sel.name)} off the map</button></div>` : ''}
    ${off ? `<div class="box"><h4>Not on the map yet</h4><div class="tray">${off}</div></div>` : ''}`,
      bind: () => {
        const ov = $('overlay');
        ov.querySelectorAll('[data-tok]').forEach(
          (t) =>
            (t.onclick = (e) => {
              e.stopPropagation();
              mapSel = mapSel === t.dataset.tok ? null : t.dataset.tok;
              drawSheet();
            })
        );
        ov.querySelectorAll('.map .cell').forEach((cl) => {
          cl.onclick = () => {
            if (!mapSel) return;
            m.pos[mapSel] = [+cl.dataset.x, +cl.dataset.y];
            mapSel = null;
            commit();
          };
          cl.onmouseenter = () => {
            if (!sel || !m.pos[sel.id]) return;
            const [x, y] = m.pos[sel.id];
            $('mapDist').textContent =
              `${sel.name}: ${Math.max(Math.abs(x - cl.dataset.x), Math.abs(y - cl.dataset.y)) * 5} ft to that square`;
          };
        });
        const sz = () => {
          m.cols = clamp(+val('mC') || 20, 5, 40);
          m.rows = clamp(+val('mR') || 14, 5, 40);
          Object.keys(m.pos).forEach((k) => {
            const p = m.pos[k];
            if (p[0] >= m.cols || p[1] >= m.rows) delete m.pos[k];
          });
          commit();
        };
        $('mC').onchange = sz;
        $('mR').onchange = sz;
        $('mBg').onclick = () => $('mFile').click();
        $('mFile').onchange = (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            const img = new Image();
            img.onload = () => {
              const k = Math.min(1, 1600 / Math.max(img.width, img.height));
              const cv = document.createElement('canvas');
              cv.width = Math.round(img.width * k);
              cv.height = Math.round(img.height * k);
              cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
              let d = cv.toDataURL('image/webp', 0.72);
              if (!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', 0.72);
              const old = m.img,
                id = uid();
              m.img = id;
              IMGS[id] = d;
              if (!saveImgs()) {
                delete IMGS[id];
                m.img = old;
                toast('Not enough browser storage for that image. Try a smaller one.');
                return;
              }
              commit();
              pruneImgs();
              saveImgs();
              toast('Map image added');
            };
            img.onerror = () => toast('That image couldn’t be read');
            img.src = r.result;
          };
          r.readAsDataURL(f);
          e.target.value = '';
        };
        $('mBgX') &&
          ($('mBgX').onclick = () => {
            m.img = null;
            commit();
            pruneImgs();
            saveImgs();
          });
        armDelete(
          $('mClr'),
          () => {
            m.pos = {};
            mapSel = null;
            commit();
          },
          'Confirm'
        );
        $('mOff') &&
          ($('mOff').onclick = () => {
            delete m.pos[mapSel];
            mapSel = null;
            commit();
          });
      },
    };
  };

  /* player-facing screen */

  /* spell slots */
  const SLOT_FULL = [
    null,
    [2],
    [3],
    [4, 2],
    [4, 3],
    [4, 3, 2],
    [4, 3, 3],
    [4, 3, 3, 1],
    [4, 3, 3, 2],
    [4, 3, 3, 3, 1],
    [4, 3, 3, 3, 2],
    [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1],
  ];
  const PACT = [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
  function classSlots(cls, lv) {
    lv = clamp(+lv || 1, 1, 20);
    const a = Array(9).fill(0);
    if (['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'].includes(cls)) SLOT_FULL[lv].forEach((v, i) => (a[i] = v));
    else if (['Paladin', 'Ranger', 'Artificer'].includes(cls))
      SLOT_FULL[Math.ceil(lv / 2)].forEach((v, i) => (a[i] = v));
    else if (cls === 'Warlock') a[Math.min(5, Math.ceil(lv / 2)) - 1] = PACT[lv];
    return a;
  }
  function slotsHTML(p) {
    const mx = p.slots || [],
      pk = p.pact && p.pact.n ? p.pact : null;
    if (!mx.some((v) => +v > 0) && !pk) return '';
    const u = p.sused || [];
    const pact = pk
      ? `<span class="sl" title="Pact Magic: ${ORD[pk.lvl - 1]} level slots, back on a short rest: ${pk.n - pk.used} of ${pk.n} left"><em>P${pk.lvl}</em>${Array.from({ length: pk.n }, (_, k) => `<button type="button" class="pip${k < pk.n - pk.used ? ' on' : ''}" data-slot="${p.id}" data-lv="-1" data-k="${k}" aria-label="Pact Magic slot ${k + 1}, ${k < pk.n - pk.used ? 'available' : 'spent'}"></button>`).join('')}</span>`
      : '';
    return `<div class="slots" aria-label="Spell slots">${pact}${mx
      .map((v, i) => {
        v = +v || 0;
        if (!v) return '';
        const av = v - (+u[i] || 0);
        return `<span class="sl" title="${ORD[i]} level slots: ${av} of ${v} left"><em>${i + 1}</em>${Array.from({ length: v }, (_, k) => `<button type="button" class="pip${k < av ? ' on' : ''}" data-slot="${p.id}" data-lv="${i}" data-k="${k}" aria-label="${ORD[i]} level slot ${k + 1}, ${k < av ? 'available' : 'spent'}"></button>`).join('')}</span>`;
      })
      .join('')}</div>`;
  }
  function toggleSlot(p, lv, k) {
    if (!p) return;
    if (lv < 0) {
      const pk = p.pact;
      if (pk) pk.used = clamp(pk.used + (k < pk.n - pk.used ? 1 : -1), 0, pk.n);
      return;
    }
    p.sused = p.sused || Array(9).fill(0);
    const mx = +(p.slots || [])[lv] || 0,
      used = +p.sused[lv] || 0;
    p.sused[lv] = clamp(used + (k < mx - used ? 1 : -1), 0, mx);
  }
  VIEWS.player.spells = () => {
    const p = pdraft;
    p.slots = p.slots || Array(9).fill(0);
    p.sused = p.sused || Array(9).fill(0);
    return {
      html:
        head(
          'Spell slots',
          'Set the slots this character has. Tap a dot to spend or recover a slot; the card on the table works the same way.'
        ) +
        `
  <div class="box"><div class="row between" style="flex-wrap:wrap"><h4 style="margin:0">Slots by level</h4><button class="btn sm" type="button" id="slFill">Fill in for a level ${esc(p.level)} ${esc(p.cls)}</button></div>
    <div class="slotgrid">${ORD.map((o, i) => `<label class="f">${o}<input type="number" min="0" max="9" data-slmax="${i}" value="${+p.slots[i] || 0}"></label>`).join('')}</div>
    ${slotsHTML(p) || '<p style="margin:0;color:var(--ink-3);font-size:13px">No spell slots set.</p>'}
    <p style="margin:0;color:var(--ink-3);font-size:13px">A long rest restores every slot. Warlock slots also come back on a short rest${p.pact ? `: Pact Magic is the P${p.pact.lvl} row, ${plural(p.pact.n, 'slot')} of ${ORD[p.pact.lvl - 1]} level` : ''}. Fighters and Rogues with spellcasting subclasses need their slots entered by hand.</p></div>
  ${pFooter()}`,
      bind: () => {
        bindPFooter();
        const ov = $('overlay');
        ov.querySelectorAll('[data-slmax]').forEach(
          (i) =>
            (i.onchange = () => {
              const l = +i.dataset.slmax;
              p.slots[l] = clamp(+i.value || 0, 0, 9);
              p.sused[l] = Math.min(+p.sused[l] || 0, p.slots[l]);
              drawSheet();
            })
        );
        ov.querySelectorAll('[data-slot]').forEach(
          (b) =>
            (b.onclick = () => {
              toggleSlot(p, +b.dataset.lv, +b.dataset.k);
              drawSheet();
            })
        );
        $('slFill').onclick = () => {
          p.slots = slotsOf(p);
          p.sused = Array(9).fill(0);
          pactSet(p);
          drawSheet();
          toast(
            p.slots.some((v) => v) ? 'Slots filled in. Save to keep them' : `A ${p.cls} has no spell slots by default`
          );
        };
      },
    };
  };

  /* in-game time and weather */
  const DAYPART = (m) => (m < 300 ? 'Night' : m < 420 ? 'Dawn' : m < 1080 ? 'Day' : m < 1200 ? 'Dusk' : 'Night');
  const fmtTime = (m) => {
    const h = Math.floor(m / 60),
      mm = m % 60;
    return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  function clockText() {
    const t = S.time;
    return `${dayLabel(t.day)} · ${fmtTime(t.min)} · ${DAYPART(t.min)}${t.weather ? ` · ${t.weather}` : ''}`;
  }
  function advance(m) {
    dawnRes(m);
    const t = S.time;
    t.min = (+t.min || 0) + (+m || 0);
    t.day = Math.min(1e6, (+t.day || 1) + Math.floor(t.min / 1440));
    t.min = ((t.min % 1440) + 1440) % 1440;
    burn(+m || 0);
    tickTime(+m || 0);
  }
  // torches, lanterns and candles burn while time passes; the DM hears when one gutters out
  function burn(m) {
    if (m <= 0 || !S.lights || !S.lights.length) return;
    S.lights.forEach((l) => (l.min -= m));
    const out = S.lights.filter((l) => l.min <= 0);
    if (out.length) {
      S.lights = S.lights.filter((l) => l.min > 0);
      setTimeout(
        () =>
          toast(
            `${out.map((l) => l.name).join(', ')} burned out.${S.lights.length ? '' : ' The party is in darkness.'}`
          ),
        2200
      );
    }
  }
  const LIGHTS = { Torch: 60, Lantern: 360, Candle: 60 };
  const fmtLeft = (m) =>
    m >= 120 ? `${Math.round(m / 60)} hr` : m >= 60 ? `1 hr ${m - 60 ? `${m - 60}m` : ''}`.trim() : `${m}m`;
  function lightsHTML() {
    return `<div class="delve"><div class="eyebrow">Delve</div>
  <button class="btn sm" type="button" id="dTurn" title="10 minutes pass, lights burn and you roll for wandering monsters">Dungeon turn</button>
  <div class="lights">${S.lights.map((l) => `<span class="light${l.min <= 10 ? ' low' : ''}" title="${esc(l.name)}: ${l.min} minutes left"><i style="width:${pct(l.min, l.max)}%"></i><span>${esc(l.name)} <b class="num">${fmtLeft(l.min)}</b></span><button type="button" data-snuff="${l.id}" aria-label="Put out ${esc(l.name)}">×</button></span>`).join('') || '<span class="dark">No light</span>'}</div>
  <div class="row lightadd">${Object.keys(LIGHTS)
    .map(
      (k) =>
        `<button class="btn sm ghost" type="button" data-light="${k}" title="Light a ${k.toLowerCase()} (${fmtLeft(LIGHTS[k])})">+ ${k}</button>`
    )
    .join('')}</div></div>`;
  }
  function bindLights() {
    $('dTurn').onclick = dungeonTurn;
    document.querySelectorAll('[data-light]').forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.light;
          if (S.lights.length >= 20) return;
          S.lights.push({ id: uid(), name: k, min: LIGHTS[k], max: LIGHTS[k] });
          commit();
        })
    );
    document.querySelectorAll('[data-snuff]').forEach(
      (b) =>
        (b.onclick = () => {
          S.lights = S.lights.filter((l) => l.id !== b.dataset.snuff);
          commit();
        })
    );
  }
  const ATMOS = [
    'Water drips somewhere ahead, slow and steady.',
    'A cold draught carries the smell of wet stone and rot.',
    'Something skitters across the passage just beyond the light.',
    'A distant scream, cut short.',
    'The torchlight catches old claw marks gouged into the wall.',
    'Bones crunch underfoot. Most of them are small.',
    'A low rumble shakes dust from the ceiling.',
    'The air grows warm and smells of smoke.',
    'Faint chanting echoes up from far below.',
    'A rusted chain sways, though there is no wind.',
    'A broken shield lies in a dried pool of blood.',
    'The silence is total. Even the dripping has stopped.',
    'Fresh tracks in the dust lead the way you came.',
    'A door slams shut somewhere in the dark.',
    'Rats pour out of a crack and flee past the party.',
    'The walls are slick with a faintly glowing fungus.',
    'Someone has scratched tally marks into the stone. Hundreds of them.',
    'A sour, chemical stink stings the eyes.',
    'Iron bars lie bent outward from an empty cell.',
    'Wind moans through the passage like a voice.',
    'A torch sconce still holds a stub that was lit recently.',
    'Distant hammering, then laughter, then nothing.',
    'Cobwebs as thick as rope hang across the corridor.',
    'The floor tilts slightly here, and loose pebbles roll toward a crack.',
  ];
  function dungeonTurn() {
    S.dm.dturn = (+S.dm.dturn || 0) + 1;
    advance(10);
    const w = +S.dm.wander || 0,
      r = w ? rnd(w) : 0,
      hit = w && r === 1,
      a = ATMOS[rnd(ATMOS.length) - 1];
    commit();
    const el = popup(
      'Dungeon turn',
      popHead(`Dungeon turn ${S.dm.dturn}`, `10 minutes pass · ${esc(clockText())}`) +
        `
    <p class="atmos">${esc(a)}</p>
    ${w ? `<div class="dres${hit ? ' n1' : ''}"><div class="lbl">Wandering monster check · 1 in ${w}</div><div class="tot">${r}</div><div class="tag" style="color:var(${hit ? '--crit' : '--ink-3'})">${hit ? 'Something is coming' : 'Nothing stirs'}</div></div>` : ''}
    ${hit ? '<div class="row end"><button class="btn pri" type="button" id="wGo">Roll the encounter</button></div>' : ''}
    <p class="foot">${S.lights.length ? `Light: ${S.lights.map((l) => `${esc(l.name)} ${fmtLeft(l.min)}`).join(', ')}.` : 'No lights are lit.'} Change the wandering chance in Edit campaign.</p>`
    );
    const g = el.querySelector('#wGo');
    g &&
      (g.onclick = () => {
        el.remove();
        if (activeBattle()) {
          toast('A battle is already running');
          return;
        }
        withRef(() =>
          draftGuard((kept) => {
            openSheet('battle', 'new');
            const m = genEncounter(rnd(2) - 1, '');
            drawSheet();
            toast(
              m ||
                `Wandering monsters rolled.${kept ? ' Your old draft is under Planned.' : ''} Check the list, then start the battle`
            );
          })
        );
      });
  }
  function clockHTML() {
    const t = S.time;
    return `<div class="clock"><button type="button" class="clk" id="clk" title="Set the day, time and weather"><span class="eyebrow">In-game time</span><b class="num">Day ${t.day} · ${fmtTime(t.min)}</b><span>${calDate(t.day) ? `${esc(calDate(t.day, true))} · ` : ''}${DAYPART(t.min)}${t.weather ? ` · ${esc(t.weather)}` : ''}</span></button>
  <div class="row" style="justify-content:center;flex-wrap:wrap">${[
    [10, '+10 min'],
    [60, '+1 hr'],
    [480, '+8 hr'],
  ]
    .map(([m, l]) => `<button class="btn sm ghost" type="button" data-adv="${m}">${l}</button>`)
    .join('')}<button class="btn sm ghost" type="button" id="travelBtn" title="${(() => {
    const j = activeJourney();
    return j
      ? `On the road to ${esc(j.to)}: ${j.done} of ${j.miles} miles`
      : 'Plan a journey: each travel day moves clocks, Fronts and deadlines';
  })()}">${activeJourney() ? `Travel ${activeJourney().days + 1}/${activeJourney().days + jLeft(activeJourney())}` : 'Travel'}</button></div></div>`;
  }
  function bindClock() {
    document.querySelectorAll('[data-adv]').forEach(
      (b) =>
        (b.onclick = () => {
          advance(+b.dataset.adv);
          commit();
        })
    );
    $('clk').onclick = clockPop;
    $('travelBtn') && ($('travelBtn').onclick = () => openSheet('session', 'travel'));
  }
  function rollWeather() {
    const r = rnd(20),
      tp = rnd(20),
      w = rnd(20);
    const sky =
      r <= 8
        ? 'Clear'
        : r <= 13
          ? 'Overcast'
          : r <= 16
            ? 'Light rain or snow'
            : r <= 18
              ? 'Heavy rain or snow'
              : r === 19
                ? 'Thick fog'
                : 'Thunderstorm';
    const temp = tp <= 3 ? 'bitter cold' : tp <= 7 ? 'cold' : tp <= 15 ? 'mild' : tp <= 18 ? 'warm' : 'scorching';
    return `${sky}, ${temp}${w <= 12 ? '' : w <= 18 ? ', windy' : ', gale-force wind'}`;
  }
  function clockPop() {
    const t = S.time;
    const el = popup(
      'Time',
      popHead('Day, time and weather', 'Rests and battles move the clock forward on their own.') +
        `
    ${S.cal.on ? `<p class="quiet" id="tCal">${esc(calDate(t.day, true))}</p>` : ''}<div class="atkf"><label>Day<input type="number" min="1" id="tDay" value="${t.day}"></label><label>Time<input type="time" id="tTime" value="${String(Math.floor(t.min / 60)).padStart(2, '0')}:${String(t.min % 60).padStart(2, '0')}"></label></div>
    <div class="atkf" style="grid-template-columns:minmax(0,1fr)"><label>Weather<input type="text" id="tW" value="${esc(t.weather || '')}" placeholder="Clear, cold"></label></div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-end"><button class="btn" type="button" id="tRoll">Roll weather</button><button class="btn pri" type="button" id="tSave">Save</button></div>`
    );
    el.querySelector('#tDay').addEventListener('input', (e) => {
      const c = el.querySelector('#tCal');
      if (c) c.textContent = calDate(Math.max(1, Math.floor(+e.target.value || 1)), true);
    });
    el.querySelector('#tRoll').onclick = () => {
      el.querySelector('#tW').value = rollWeather();
    };
    el.querySelector('#tSave').onclick = () => {
      const was = (+t.day || 1) * 1440 + (+t.min || 0),
        nd = Math.max(1, Math.min(1e6, Math.floor(+el.querySelector('#tDay').value || 1)));
      const [h, m] = (el.querySelector('#tTime').value || '08:00').split(':');
      const nm = clamp((+h || 0) * 60 + (+m || 0), 0, 1439),
        gap = nd * 1440 + nm - was;
      if (gap > 0) advance(gap);
      else {
        t.day = nd;
        t.min = nm;
      }
      t.weather = el.querySelector('#tW').value.trim();
      el.remove();
      commit();
    };
    el.querySelector('#tDay').focus();
  }

  /* ---------- travel and calendar: journeys that move the world, encounter tables, a named calendar ---------- */
  // 2024 travel pace. A travel day is about 8 hours on the move; the rest of the day is camp
  const PACES = {
    fast: { l: 'Fast', mpd: 30, fx: 'Disadvantage on Wisdom (Perception or Survival) checks' },
    normal: { l: 'Normal', mpd: 24, fx: 'Disadvantage on Dexterity (Stealth) checks' },
    slow: { l: 'Slow', mpd: 18, fx: 'Advantage on Wisdom (Perception or Survival) checks' },
  };
  const J_STATUS = ['active', 'arrived', 'stopped'],
    WATCHES = ['morning', 'afternoon', 'night'];
  const CAL_PRESETS = {
    plain: {
      l: 'Plain (12 months of 30 days)',
      months: Array.from({ length: 12 }, (_, i) => ({ n: `Month ${i + 1}`, d: 30 })),
      wd: [],
      era: '',
    },
    harptos: {
      l: 'Harptos (Forgotten Realms)',
      months: [
        ['Hammer', 30],
        ['Midwinter', 1],
        ['Alturiak', 30],
        ['Ches', 30],
        ['Tarsakh', 30],
        ['Greengrass', 1],
        ['Mirtul', 30],
        ['Kythorn', 30],
        ['Flamerule', 30],
        ['Midsummer', 1],
        ['Eleasis', 30],
        ['Eleint', 30],
        ['Highharvestide', 1],
        ['Marpenoth', 30],
        ['Uktar', 30],
        ['Feast of the Moon', 1],
        ['Nightal', 30],
      ].map(([n, d]) => ({ n, d })),
      wd: [],
      era: 'DR',
    },
  };
  // every load, undo and backup passes through here (called from normalize)
  function travelNorm() {
    const tv = S.travel && typeof S.travel === 'object' && !Array.isArray(S.travel) ? S.travel : {};
    const tables = objs(tv.tables)
      .map((t) => {
        fixId(t);
        return {
          id: t.id,
          name: str(t.name, 80).trim() || 'Encounter table',
          chance: int(t.chance, 6, 0, 20),
          per: t.per === 'watch' ? 'watch' : 'day',
          rows: objs(t.rows)
            .map((r) => {
              fixId(r);
              const text = str(r.text, 200).trim();
              return text ? { id: r.id, w: int(r.w, 1, 1, 20), text } : null;
            })
            .filter(Boolean)
            .slice(0, 30),
        };
      })
      .slice(0, 40);
    const tids = new Set(tables.map((t) => t.id));
    const journeys = objs(tv.journeys).map((j) => {
      fixId(j);
      const miles = int(j.miles, 24, 1, 100000);
      return {
        id: j.id,
        from: str(j.from, 120).trim(),
        to: str(j.to, 120).trim() || 'somewhere',
        miles,
        pace: PACES[j.pace] ? j.pace : 'normal',
        mpd: int(j.mpd, 0, 0, 1000),
        table: tids.has(j.table) ? j.table : '',
        rest: j.rest == null ? !S.dm.gritty : !!j.rest,
        done: int(j.done, 0, 0, miles),
        days: int(j.days, 0, 0, 1e5),
        status: J_STATUS.includes(j.status) ? j.status : 'active',
        start: int(j.start, 1, 1, 1e6),
        log: objs(j.log)
          .map((e) => ({
            day: int(e.day, 1, 1, 1e6),
            s: int(e.s, 0, 0, 9999),
            text: str(e.text, 300),
            enc: !!e.enc,
            q: !!e.q,
          }))
          .filter((e) => e.text)
          .slice(-300),
      };
    });
    // one journey on the road at a time, and a journey with every mile behind it has arrived
    let on = false;
    journeys.forEach((j) => {
      if (j.status === 'active' && j.done >= j.miles) j.status = 'arrived';
      if (j.status === 'active') {
        if (on) j.status = 'stopped';
        on = true;
      }
    });
    S.travel = {
      journeys: journeys.slice(-60),
      tables,
      rations: int(tv.rations, 0, 0, 99999),
      eat: tv.eat == null ? !!S.dm.gritty : !!tv.eat,
    };
    const c = S.cal && typeof S.cal === 'object' && !Array.isArray(S.cal) ? S.cal : {};
    const months = objs(c.months)
      .map((m) => ({ n: str(m.n, 40).trim(), d: int(m.d, 30, 1, 400) }))
      .filter((m) => m.n)
      .slice(0, 40);
    const wd = arr(c.wd)
      .map((w) => str(w, 30).trim())
      .filter(Boolean)
      .slice(0, 20);
    const mi = int(c.m, 0, 0, Math.max(0, months.length - 1));
    S.cal = {
      on: !!c.on && months.length > 0,
      months,
      wd,
      y: int(c.y, 1, -1e6, 1e6),
      m: mi,
      d: int(c.d, 1, 1, months[mi] ? months[mi].d : 1),
      w0: int(c.w0, 0, 0, Math.max(0, wd.length - 1)),
      era: str(c.era, 20).trim(),
    };
  }

  /* the calendar: Day 1 is stored as a calendar date, so the internal day count never changes */
  const calYear = () => S.cal.months.reduce((a, m) => a + m.d, 0);
  const calBefore = (m) => S.cal.months.slice(0, m).reduce((a, x) => a + x.d, 0);
  function calParts(day) {
    const c = S.cal;
    if (!c || !c.on || !c.months.length) return null;
    const Y = calYear(),
      n = Math.round(+day || 1) - 1;
    let off = calBefore(c.m) + c.d - 1 + n;
    const y = c.y + Math.floor(off / Y);
    off = ((off % Y) + Y) % Y;
    let m = 0;
    while (m < c.months.length - 1 && off >= c.months[m].d) {
      off -= c.months[m].d;
      m++;
    }
    return { y, m, d: off + 1, wd: c.wd.length ? c.wd[(((c.w0 + n) % c.wd.length) + c.wd.length) % c.wd.length] : '' };
  }
  // "14 Mirtul 1492 DR", or '' when no calendar is set. One-day months (festivals) show just their name
  function calDate(day, withWd) {
    const p = calParts(day);
    if (!p) return '';
    const c = S.cal,
      mo = c.months[p.m];
    return `${withWd && p.wd ? p.wd + ', ' : ''}${mo.d === 1 ? mo.n : `${p.d} ${mo.n}`} ${p.y}${c.era ? ' ' + c.era : ''}`;
  }
  const dayLabel = (d) => {
    const c = calDate(d);
    return c ? `${c} (Day ${d})` : `Day ${d}`;
  };
  // which in-game day number a calendar date falls on (null if it is before Day 1)
  function calToDay(y, m, d) {
    const c = S.cal;
    if (!c.on || !c.months.length) return null;
    const Y = calYear();
    const a = y * Y + calBefore(m) + d - 1,
      a1 = c.y * Y + calBefore(c.m) + c.d - 1;
    return a - a1 + 1;
  }

  /* journeys */
  const jMpd = (j) => j.mpd || PACES[j.pace].mpd;
  const jDays = (j) => Math.ceil(j.miles / jMpd(j));
  const jLeft = (j) => Math.ceil((j.miles - j.done) / jMpd(j));
  const activeJourney = () => ((S.travel && S.travel.journeys) || []).find((j) => j.status === 'active') || null;
  const jName = (j) => (j.from ? `${j.from} to ${j.to}` : `the road to ${j.to}`);
  const jTable = (j) => (j && j.table ? S.travel.tables.find((t) => t.id === j.table) || null : null);
  function jlog(j, text, o) {
    j.log.push(Object.assign({ day: S.time.day, s: +S.dm.session || 1, text: String(text).slice(0, 300) }, o || {}));
    if (j.log.length > 300) j.log.splice(0, j.log.length - 300);
  }
  // a table row reads like "1d4+1 Goblin Warrior, Bugbear Warrior": if every part names a monster it becomes a battle
  function rowFoes(text) {
    const parts = String(text)
      .split(/\s*(?:,|\+(?=\s*\D)|\band\b|&)\s*/i)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!parts.length) return null;
    const out = [];
    for (const p of parts) {
      const m = p.match(/^(?:(\d{1,2}d\d{1,3}(?:[+-]\d{1,2})?|\d{1,2})\s*[x×]?\s+)?(.+?)$/i);
      if (!m) return null;
      const nm = m[2].trim().toLowerCase(),
        mon =
          MONSTERS.find((x) => x.n.toLowerCase() === nm) ||
          MONSTERS.find((x) => x.n.toLowerCase() === nm.replace(/e?s$/, ''));
      if (!mon) return null;
      out.push([mon, m[1] || '1']);
    }
    return out;
  }
  const tableDie = (t) => t.rows.reduce((a, r) => a + r.w, 0);
  function rowRange(t, i) {
    let lo = 1;
    for (let k = 0; k < i; k++) lo += t.rows[k].w;
    const hi = lo + t.rows[i].w - 1;
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  }
  function rollTable(t) {
    const n = tableDie(t);
    if (!n) return null;
    const r = rnd(n);
    let acc = 0;
    for (const row of t.rows) {
      acc += row.w;
      if (r <= acc) return { r, n, row };
    }
    return null;
  }
  // one travel day: the party covers the day's miles, the encounter checks are rolled, then a full day passes
  function travelDay(j) {
    const before = S.missions.filter((m) => m.dueFired).length,
      logAt = S.tonight.log.length;
    const step = Math.min(jMpd(j), j.miles - j.done);
    j.done += step;
    j.days++;
    const tot = j.days + jLeft(j);
    const line = `Journey to ${j.to}, day ${j.days} of ${tot}: ${j.done} of ${j.miles} miles.`;
    jlog(j, line);
    tlog(line, true);
    let enc = null;
    const t = jTable(j);
    if (t && t.chance) {
      const checks = t.per === 'watch' ? 3 : 1;
      for (let k = 0; k < checks && !enc; k++) {
        const r = rnd(t.chance),
          when = t.per === 'watch' ? ` (${WATCHES[k]})` : '';
        if (r === 1) {
          const res = rollTable(t);
          enc = { when: WATCHES[k], per: t.per, check: r, chance: t.chance, res, table: t.name };
          const what = res ? res.row.text : 'Something crosses the party’s path';
          jlog(
            j,
            `Encounter check${when}: ${r} on d${t.chance}. ${res ? `Rolled ${res.r} on d${res.n}: ${what}` : what}.`,
            { enc: true }
          );
          tlog(`Journey encounter on the way to ${j.to}: ${what}.`, true);
        }
        // rolls where nothing happens stay in the journey log (DM only) and out of the recap
        else jlog(j, `Encounter check${when}: ${r} on d${t.chance}, nothing.`, { q: true });
      }
    }
    // the last day ends when the party gets there: 8 hours on the road, not a full day and night
    const last = j.done >= j.miles;
    advance(last ? 480 : 1440);
    if (j.rest && !last) {
      const rested = S.players.filter(inPlay).filter((p) => longRest(p));
      if (rested.length) jlog(j, `Camp: long rest for ${andList(rested.map((p) => p.name))}.`, { q: true });
    }
    let hungry = false;
    if (S.travel.eat && S.players.length) {
      const mouths = S.players.filter(inPlay).length;
      if (mouths) {
        const had = S.travel.rations;
        S.travel.rations = Math.max(0, had - mouths);
        if (had < mouths) {
          hungry = true;
          jlog(j, had ? `Rations ran out: only ${had} of ${mouths} eaten.` : 'No rations left. The party goes hungry.');
          tlog(`Journey: the party is out of rations${had ? ` (only ${had} of ${mouths} eaten)` : ''}.`, true);
        }
      }
    }
    if (j.done >= j.miles) {
      j.status = 'arrived';
      const a = `Arrived at ${j.to} after ${plural(j.days, 'day')} on the road (${j.miles} miles).`;
      jlog(j, a);
      tlog(a, true);
    }
    const fired = S.missions.filter((m) => m.dueFired).length > before;
    const big = S.tonight.log.slice(logAt).some((e) => /^(Clock complete|Doom falls)/.test(e.text));
    return { enc, deadline: fired, big, hungry, arrived: j.status === 'arrived' };
  }
  function travelGo(all) {
    const j = activeJourney();
    if (!j) return;
    if (activeBattle()) {
      toast('A battle is running. End it before the party moves on');
      return;
    }
    const d0 = j.days;
    let r;
    for (let g = 0; g < 400; g++) {
      r = travelDay(j);
      if (!all || r.enc || r.deadline || r.big || r.hungry || r.arrived) break;
    }
    commit();
    if (view && view.sec === 'session' && view.sub === 'travel') drawSheet();
    const n = j.days - d0,
      why = r.enc
        ? ''
        : r.deadline
          ? ' A deadline passed.'
          : r.big
            ? ' A clock filled.'
            : r.hungry
              ? ' The party is out of rations.'
              : '';
    if (r.enc) {
      encPop(j, r.enc);
      return;
    }
    toast(
      r.arrived
        ? `Arrived at ${j.to} after ${plural(j.days, 'day')} on the road. It is ${dayLabel(S.time.day)}`
        : `${all ? `${plural(n, 'day')} on the road. ` : ''}Day ${j.days} of ${j.days + jLeft(j)} toward ${j.to}, ${j.done} of ${j.miles} miles.${why || (jTable(j) && jTable(j).chance ? ' No encounter.' : '')}`
    );
  }
  function encPop(j, e) {
    const foes = e.res ? rowFoes(e.res.row.text) : null;
    const el = popup(
      'Encounter on the road',
      popHead(
        j ? 'Encounter on the road' : `Roll on ${e.table}`,
        j
          ? `Day ${j.days} toward ${esc(j.to)}${e.per === 'watch' ? `, ${e.when}` : ''} · ${esc(dayLabel(S.time.day))}`
          : 'A test roll. Nothing is logged and no time passes.'
      ) +
        `
    ${j ? `<div class="dres n1"><div class="lbl">Encounter check · 1 in ${e.chance}</div><div class="tot">${e.check}</div><div class="tag" style="color:var(--crit)">Something is coming</div></div>` : ''}
    ${e.res ? `<div class="item"><div class="meta">${esc(e.table)} · rolled ${e.res.r} on d${e.res.n}</div><strong>${esc(e.res.row.text)}</strong></div>` : '<p class="quiet">The table has no rows yet, so decide what the party meets.</p>'}
    <div class="row end"><button class="btn ghost" type="button" data-mclose>Carry on</button>${foes ? '<button class="btn pri" type="button" id="encGo">Set up the battle</button>' : ''}</div>`
    );
    const g = el.querySelector('#encGo');
    g &&
      (g.onclick = () => {
        el.remove();
        encBattle(foes, j ? `${e.res.row.text} on the road to ${j.to}` : e.table);
      });
    (g || el.querySelector('[data-mclose]')).focus();
  }
  // opens New battle with the rolled group already in the list
  // a road or wandering encounter never silently replaces a battle the DM is building
  function draftGuard(go) {
    const cur = bdraft || draftLoad();
    if (!cur || !(cur.foes || []).length) {
      go(false);
      return;
    }
    const el = popup(
      'Battle draft',
      popHead(
        'Replace your battle draft?',
        `New battle already holds <strong>${esc(cur.name || 'an unnamed battle')}</strong> with ${plural(cur.foes.length, 'monster')}. Save it under Planned to load it later, or replace it. Ctrl+Z brings it back either way.`
      ) +
        `<div class="row end"><button class="btn ghost" type="button" data-mclose id="dgNo">Cancel</button><button class="btn" type="button" id="dgRep">Replace it</button><button class="btn pri" type="button" id="dgKeep">Save it to Planned first</button></div>`
    );
    el.querySelector('#dgKeep').focus();
    const swap = (keep) => {
      el.remove();
      if (keep) {
        bdraft = bdraft || draftLoad();
        if (!bdraft.name) bdraft.name = `Draft from ${dayLabel(S.time.day)}`;
        savePlan();
      }
      draftDrop();
      bdraft = null;
      commit();
      draftMark();
      go(keep);
    };
    el.querySelector('#dgRep').onclick = () => swap(false);
    el.querySelector('#dgKeep').onclick = () => swap(true);
  }
  function encBattle(foes, name) {
    if (activeBattle()) {
      toast('A battle is already running');
      return;
    }
    withRef(() => encBattleGo(foes, name));
  }
  function encBattleGo(foes, name) {
    draftGuard((kept) => {
      openSheet('battle', 'new');
      if (!bdraft) return;
      bdraft.foes = [];
      bdraft.name = String(name).slice(0, 120);
      foes.forEach(([m, c]) => {
        const r = rollExpr(c);
        addFoes(m, clamp(r ? r.total : 1, 1, 30));
      });
      drawSheet();
      toast(
        `${andList(foes.map(([m]) => m.n))} added.${kept ? ' Your old draft is under Planned.' : ''} Check the list, then start the battle`
      );
    });
  }
  // lines for the Wrap up recap: each journey travelled this session, and what the party met
  function travelRecap(n) {
    const out = [];
    ((S.travel && S.travel.journeys) || []).forEach((j) => {
      const es = j.log.filter((e) => e.s === n);
      const days = es.filter((e) => /^Journey to /.test(e.text)).length;
      if (!days) return;
      out.push(
        `- ${jName(j)}: ${plural(days, 'day')} on the road, ${j.done} of ${j.miles} miles.${j.status === 'arrived' && es.some((e) => /^Arrived at /.test(e.text)) ? ` Arrived at ${j.to}.` : j.status === 'stopped' ? ' Stopped short.' : ''}`
      );
      es.filter((e) => e.enc).forEach((e) =>
        out.push(`- Met on the road: ${e.text.replace(/^Encounter check[^:]*: [^.]*\.\s*(Rolled \d+ on d\d+: )?/, '')}`)
      );
    });
    return out;
  }
  const travelLine = (t) => /^(Journey |Arrived at )/.test(t);

  /* Session › Travel */
  let jNew = false,
    tEdit = null;
  const paceOpts = (sel) =>
    Object.entries(PACES)
      .map(([k, p]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${p.l}, ${p.mpd} miles a day</option>`)
      .join('');
  const tableOpts = (sel) =>
    `<option value="">No encounter checks</option>${S.travel.tables.map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}${t.chance ? ` (1 in ${t.chance} a ${t.per})` : ' (off)'}</option>`).join('')}`;
  function journeyCard(j) {
    const tot = j.days + jLeft(j),
      pc = PACES[j.pace],
      segN = Math.min(tot, 30),
      on = Math.round((j.done / j.miles) * segN);
    const lg = j.log.slice(-12).reverse();
    return `<div class="item jcard"><div class="row between"><strong>${esc(jName(j))}</strong><span class="pill">${j.status === 'active' ? 'On the road' : j.status === 'arrived' ? 'Arrived' : 'Stopped'}</span></div>
    <div class="row"><span class="segs" role="img" aria-label="${j.done} of ${j.miles} miles">${Array.from({ length: segN }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</span><span class="num meta">${j.done} / ${j.miles} mi</span></div>
    <div class="meta">${j.days ? `Day ${j.days} of ${tot}` : `${plural(tot, 'day')} to go`} · ${j.mpd ? `Own speed, ${j.mpd} miles a day` : `${pc.l} pace, ${pc.mpd} miles a day: ${pc.fx}`}</div>
    ${
      j.status === 'active'
        ? `<div class="grid jopts">
      <label class="f">Pace<select id="jPace">${paceOpts(j.pace)}</select></label>
      <label class="f">Own speed (miles a day)<input type="number" min="0" max="1000" id="jMpd" value="${j.mpd || ''}" placeholder="Mount or vehicle"></label>
      <label class="f">Encounter table<select id="jTab">${tableOpts(j.table)}</select></label></div>
      <div class="toggles"><label title="Each night at camp the party takes a long rest, with no extra time added"><input type="checkbox" id="jRest"${j.rest ? ' checked' : ''}>Long rest at camp each night</label></div>
      <div class="row end"><button class="btn ghost" type="button" id="jStop">Stop here</button><button class="btn" type="button" id="jAll" title="Travel day after day until the party arrives, meets something, or a deadline or clock fires">Travel all</button><button class="btn pri" type="button" id="jDay">Travel a day</button></div>`
        : ''
    }
    ${lg.length ? `<details class="jlog"${j.status === 'active' ? ' open' : ''}><summary>Journey log (DM only)</summary><div class="tlog">${lg.map((e) => `<div class="tl${e.q ? ' auto' : ''}"><small class="num">${esc(dayLabel(e.day))}</small><span>${esc(e.text)}</span></div>`).join('')}</div></details>` : ''}</div>`;
  }
  function tableForm(t) {
    const rows = t ? t.rows.map((r) => `${r.w > 1 ? `${r.w}: ` : ''}${r.text}`).join('\n') : '';
    return `<div class="box" id="tForm"><h4>${t ? 'Edit encounter table' : 'New encounter table'}</h4><div class="grid">
    <label class="f">Name or region<input type="text" id="tbN" maxlength="80" placeholder="The Mistmarsh" value="${t ? esc(t.name) : ''}"></label>
    <label class="f">Chance<select id="tbC">${[0, 2, 3, 4, 6, 8, 10, 12, 20].map((v) => `<option value="${v}"${(t ? t.chance : 6) === v ? ' selected' : ''}>${v ? `1 in ${v}` : 'Never'}</option>`).join('')}</select></label>
    <label class="f">Checks<select id="tbP"><option value="day"${t && t.per === 'watch' ? '' : ' selected'}>Once a travel day</option><option value="watch"${t && t.per === 'watch' ? ' selected' : ''}>Each watch (3 a day)</option></select></label>
    <label class="f" style="grid-column:1/-1">Rows, one per line<textarea id="tbR" rows="6" placeholder="1d4+1 Goblin Warrior\nA merchant caravan heading the other way\n2: Nothing but birdsong and mud\nOgre, 2 Goblin Warrior">${esc(rows)}</textarea></label></div>
    <p class="quiet">Rows that name bestiary monsters (with an optional count or dice, like “1d4+1 Goblin Warrior”) open New battle with them. Any other row is a line of text. Start a line with “2:” to make it twice as likely. The die is the total, so 6 plain rows is a d6.</p>
    <div class="row end">${t ? '<button class="btn ghost" type="button" id="tbX">Cancel</button>' : ''}<button class="btn pri" type="button" id="tbGo">${t ? 'Save changes' : 'Add table'}</button></div></div>`;
  }
  VIEWS.session.travel = () => {
    const tv = S.travel,
      j = activeJourney(),
      past = tv.journeys
        .filter((x) => x !== j)
        .slice(-8)
        .reverse(),
      te = tEdit ? tv.tables.find((t) => t.id === tEdit) : null;
    const pl = S.places.map((p) => `<option value="${esc(p.name)}">`).join('');
    return {
      html:
        head(
          'Travel',
          'Journeys move the clock a day at a time, so clocks, Fronts and deadlines keep pace with the road. 2024 travel pace.'
        ) +
        `
  ${j ? journeyCard(j) : ''}
  ${
    !j || jNew
      ? `<div class="box" id="jForm"><h4>${j ? 'Start a different journey' : 'New journey'}</h4><datalist id="jPlaces">${pl}</datalist><div class="grid">
    <label class="f">From<input type="text" id="jFrom" maxlength="120" list="jPlaces" placeholder="Saltreach"></label>
    <label class="f">To<input type="text" id="jTo" maxlength="120" list="jPlaces" placeholder="Gull Rock"></label>
    <label class="f">Distance (miles)<input type="number" min="1" max="100000" id="jMi" placeholder="120"></label>
    <label class="f">Pace<select id="jNP">${paceOpts('normal')}</select></label>
    <label class="f">Own speed (miles a day)<input type="number" min="0" max="1000" id="jNM" placeholder="Mount or vehicle"></label>
    <label class="f">Encounter table<select id="jNT">${tableOpts(tv.tables[0] ? tv.tables[0].id : '')}</select></label></div>
    <p class="quiet" id="jEst">Fast 30, Normal 24, Slow 18 miles a day. Travel days are 8 hours on the move, then camp.</p>
    <div class="row end">${j ? '<button class="btn ghost" type="button" id="jNX">Cancel</button>' : ''}<button class="btn pri" type="button" id="jGo">Set out</button></div></div>`
      : `<div class="row end"><button class="lnk" type="button" id="jNew">Start a different journey</button></div>`
  }
  <div class="box"><h4>Rations</h4><div class="grid"><label class="f">Party rations<input type="number" min="0" max="99999" id="rTot" value="${tv.rations}"></label></div>
    <div class="toggles"><label><input type="checkbox" id="rEat"${tv.eat ? ' checked' : ''}>Count down one ration per character each travel day</label></div>
    <p class="quiet">${tv.eat ? `${plural(S.players.filter(inPlay).length, 'character')} on the road, so ${tv.rations ? `about ${plural(Math.floor(tv.rations / Math.max(1, S.players.filter(inPlay).length)), 'day')} of food left` : 'no food left'}.` : 'Turn this on for gritty, survival-heavy travel.'}</p></div>
  <div class="box"><div class="row between"><h4>Encounter tables</h4>${te || !tv.tables.length ? '' : '<button class="lnk" type="button" id="tbNew">New table</button>'}</div>
    ${
      tv.tables.length
        ? `<div class="list">${tv.tables
            .map(
              (
                t
              ) => `<div class="item"><div class="row between"><strong>${esc(t.name)}</strong><span class="meta">${t.chance ? `1 in ${t.chance} ${t.per === 'watch' ? 'each watch' : 'a day'}` : 'Off'} · d${tableDie(t) || 0}</span></div>
      ${t.rows.length ? `<ol class="enctab">${t.rows.map((r, i) => `<li><span class="num">${rowRange(t, i)}</span><span>${esc(r.text)}</span>${rowFoes(r.text) ? '<small>Battle</small>' : ''}</li>`).join('')}</ol>` : '<div class="meta">No rows yet.</div>'}
      <div class="row end"><button class="btn sm ghost" type="button" data-tbroll="${t.id}">Roll</button><button class="btn sm ghost" type="button" data-tbed="${t.id}">Edit</button><button class="btn sm ghost" type="button" data-tbdel="${t.id}">Delete</button></div></div>`
            )
            .join('')}</div>`
        : ''
    }
    ${te || !tv.tables.length || tEdit === 'new' ? tableForm(te) : ''}</div>
  ${past.length ? `<div class="box"><h4>Earlier journeys</h4><div class="list">${past.map(journeyCard).join('')}</div></div>` : ''}`,
      bind: () => {
        const ov = $('overlay');
        if (j) {
          $('jPace') &&
            ($('jPace').onchange = (e) => {
              j.pace = e.target.value;
              commit();
              drawSheet();
            });
          $('jMpd') &&
            ($('jMpd').onchange = (e) => {
              j.mpd = clamp(Math.round(+e.target.value || 0), 0, 1000);
              commit();
              drawSheet();
            });
          $('jTab') &&
            ($('jTab').onchange = (e) => {
              j.table = e.target.value;
              commit();
              drawSheet();
            });
          $('jRest') &&
            ($('jRest').onchange = (e) => {
              j.rest = e.target.checked;
              commit();
            });
          $('jDay') && ($('jDay').onclick = () => travelGo(false));
          $('jAll') && ($('jAll').onclick = () => travelGo(true));
          $('jStop') &&
            armDelete(
              $('jStop'),
              () => {
                j.status = 'stopped';
                jlog(j, `Journey stopped after ${j.done} of ${j.miles} miles.`);
                tlog(`Journey to ${j.to} stopped after ${j.done} of ${j.miles} miles.`, true);
                commit();
                toast('Journey stopped. Undo with Ctrl+Z');
              },
              'Confirm stop'
            );
        }
        $('jNew') &&
          ($('jNew').onclick = () => {
            jNew = true;
            drawSheet();
          });
        $('jNX') &&
          ($('jNX').onclick = () => {
            jNew = false;
            drawSheet();
          });
        const est = () => {
          const mi = +val('jMi'),
            mpd = +val('jNM') || PACES[val('jNP')].mpd;
          $('jEst').textContent =
            mi > 0
              ? `${mi} miles at ${mpd} miles a day: ${plural(Math.ceil(mi / mpd), 'travel day')}.`
              : 'Fast 30, Normal 24, Slow 18 miles a day. Travel days are 8 hours on the move, then camp.';
        };
        ['jMi', 'jNP', 'jNM'].forEach((k) => $(k) && ($(k).oninput = est));
        $('jGo') &&
          ($('jGo').onclick = () => {
            const to = val('jTo'),
              mi = Math.round(+val('jMi'));
            if (!to) {
              toast('Where is the party going?');
              $('jTo').focus();
              return;
            }
            if (!(mi > 0)) {
              toast('How many miles is it?');
              $('jMi').focus();
              return;
            }
            if (j) {
              j.status = 'stopped';
              jlog(j, `Journey stopped after ${j.done} of ${j.miles} miles.`);
            }
            const nj = {
              id: uid(),
              from: val('jFrom').slice(0, 120),
              to: to.slice(0, 120),
              miles: clamp(mi, 1, 100000),
              pace: val('jNP'),
              mpd: clamp(Math.round(+val('jNM') || 0), 0, 1000),
              table: val('jNT'),
              rest: !S.dm.gritty,
              done: 0,
              days: 0,
              status: 'active',
              start: S.time.day,
              log: [],
            };
            S.travel.journeys.push(nj);
            if (S.travel.journeys.length > 60) S.travel.journeys.shift();
            const st = `Journey started: ${nj.from ? `${nj.from} to ` : ''}${nj.to}, ${nj.miles} miles at ${nj.mpd ? `${nj.mpd} miles a day` : `${PACES[nj.pace].l} pace`}.`;
            jlog(nj, st);
            tlog(st, true);
            jNew = false;
            commit();
            toast(`${plural(jDays(nj), 'travel day')} to ${nj.to}. Press Travel a day to set off`);
          });
        $('rTot').onchange = (e) => {
          S.travel.rations = clamp(Math.round(+e.target.value || 0), 0, 99999);
          commit();
        };
        $('rEat').onchange = (e) => {
          S.travel.eat = e.target.checked;
          commit();
        };
        $('tbNew') &&
          ($('tbNew').onclick = () => {
            tEdit = 'new';
            drawSheet();
            $('tbN') && $('tbN').focus();
          });
        $('tbX') &&
          ($('tbX').onclick = () => {
            tEdit = null;
            drawSheet();
          });
        $('tbGo') &&
          ($('tbGo').onclick = () => {
            const n = val('tbN');
            if (!n) {
              toast('Name the table first');
              $('tbN').focus();
              return;
            }
            const rows = $('tbR')
              .value.split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .slice(0, 30)
              .map((l) => {
                const m = l.match(/^(\d{1,2})\s*:\s*(.+)$/);
                return { id: uid(), w: m ? clamp(+m[1], 1, 20) : 1, text: (m ? m[2] : l).slice(0, 200) };
              });
            const f = {
              name: n.slice(0, 80),
              chance: +val('tbC'),
              per: val('tbP') === 'watch' ? 'watch' : 'day',
              rows,
            };
            if (te) Object.assign(te, f);
            else {
              const t = Object.assign({ id: uid() }, f);
              S.travel.tables.push(t);
              const aj = activeJourney();
              if (aj && !aj.table) aj.table = t.id;
            }
            tEdit = null;
            commit();
            toast(te ? 'Table saved' : `Table added${rows.length ? `: d${rows.reduce((a, r) => a + r.w, 0)}` : ''}`);
          });
        ov.querySelectorAll('[data-tbed]').forEach(
          (b) =>
            (b.onclick = () => {
              tEdit = b.dataset.tbed;
              drawSheet();
              $('tbN') && $('tbN').focus();
            })
        );
        ov.querySelectorAll('[data-tbroll]').forEach(
          (b) =>
            (b.onclick = () => {
              const t = S.travel.tables.find((x) => x.id === b.dataset.tbroll);
              const r = t && rollTable(t);
              if (!r) {
                toast('Add rows to the table first');
                return;
              }
              encPop(null, { res: r, table: t.name });
            })
        );
        ov.querySelectorAll('[data-tbdel]').forEach((b) =>
          armDelete(
            b,
            () => {
              S.travel.tables = S.travel.tables.filter((t) => t.id !== b.dataset.tbdel);
              S.travel.journeys.forEach((x) => {
                if (x.table === b.dataset.tbdel) x.table = '';
              });
              if (tEdit === b.dataset.tbdel) tEdit = null;
              commit();
              toast('Table deleted. Undo with Ctrl+Z');
            },
            'Confirm'
          )
        );
      },
    };
  };

  /* Edit campaign › Calendar */
  function calLines(ms) {
    return ms.map((m) => `${m.n} ${m.d}`).join('\n');
  }
  function parseMonths(t) {
    return String(t)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map((l) => {
        const m = l.match(/^(.*?)[\s,:=-]+(\d{1,3})$/);
        return m && m[1].trim()
          ? { n: m[1].trim().slice(0, 40), d: clamp(+m[2], 1, 400) }
          : { n: l.slice(0, 40), d: 30 };
      });
  }
  let calPre = null;
  VIEWS.campaign.calendar = () => {
    const c = S.cal,
      base = calPre || (c.months.length ? { months: c.months, wd: c.wd, era: c.era } : CAL_PRESETS.plain);
    const now = calParts(S.time.day);
    const ms = base.months,
      wd = base.wd || [],
      cm = now && !calPre ? now.m : 0,
      cd = now && !calPre ? now.d : 1,
      cy = now && !calPre ? now.y : c.y,
      cw = now && !calPre ? Math.max(0, wd.indexOf(now.wd)) : 0;
    return {
      html:
        head(
          'Calendar',
          'Name the months and the year, and the board shows real dates next to the day count. Day numbers never change, so old notes and deadlines stay put.'
        ) +
        `
  <div class="box"><div class="toggles"><label><input type="checkbox" id="calOn"${c.on ? ' checked' : ''}>Use a calendar</label></div>
    <div class="row">${Object.entries(CAL_PRESETS)
      .map(([k, p]) => `<button class="btn sm ghost" type="button" data-calpre="${k}">${esc(p.l)}</button>`)
      .join('')}</div>
    <div class="grid">
      <label class="f" style="grid-row:span 3">Months, one per line with their days<textarea id="calM" rows="12">${esc(calLines(ms))}</textarea></label>
      <label class="f">Weekdays, comma separated (optional)<input type="text" id="calW" value="${esc(wd.join(', '))}" placeholder="Moonday, Toilday, Wealday"></label>
      <label class="f">Year label (optional)<input type="text" id="calE" maxlength="20" value="${esc(base.era || '')}" placeholder="DR"></label></div>
    <h4>Today, Day ${S.time.day}, is</h4>
    <div class="grid calnow">
      <label class="f">Day of the month<input type="number" min="1" max="400" id="calD" value="${cd}"></label>
      <label class="f">Month<select id="calMo">${ms.map((m, i) => `<option value="${i}"${i === cm ? ' selected' : ''}>${esc(m.n)}</option>`).join('')}</select></label>
      <label class="f">Year<input type="number" id="calY" value="${cy}"></label>
      <label class="f">Weekday<select id="calWd"${wd.length ? '' : ' disabled'}>${wd.length ? wd.map((w, i) => `<option value="${i}"${i === cw ? ' selected' : ''}>${esc(w)}</option>`).join('') : '<option>No weekdays</option>'}</select></label></div>
    <p class="quiet" id="calPrev">${c.on ? `Day 1 was ${esc(calDate(1, true))}. Today is ${esc(calDate(S.time.day, true))}.` : 'No calendar yet. The board shows Day numbers only.'}</p>
    <div class="row end"><button class="btn pri" type="button" id="calSave">Save calendar</button></div></div>`,
      bind: () => {
        const ov = $('overlay');
        const redo = () => {
          const m = parseMonths($('calM').value),
            w = $('calW')
              .value.split(',')
              .map((x) => x.trim())
              .filter(Boolean)
              .slice(0, 20),
            sm = +$('calMo').value || 0,
            sw = +$('calWd').value || 0;
          $('calMo').innerHTML = m
            .map(
              (x, i) =>
                `<option value="${i}"${i === Math.min(sm, m.length - 1) ? ' selected' : ''}>${esc(x.n)}</option>`
            )
            .join('');
          $('calWd').disabled = !w.length;
          $('calWd').innerHTML = w.length
            ? w
                .map(
                  (x, i) =>
                    `<option value="${i}"${i === Math.min(sw, w.length - 1) ? ' selected' : ''}>${esc(x)}</option>`
                )
                .join('')
            : '<option>No weekdays</option>';
        };
        $('calM').onchange = redo;
        $('calW').onchange = redo;
        ov.querySelectorAll('[data-calpre]').forEach(
          (b) =>
            (b.onclick = () => {
              const p = CAL_PRESETS[b.dataset.calpre];
              calPre = { months: p.months.map((x) => ({ ...x })), wd: [...p.wd], era: p.era };
              drawSheet();
            })
        );
        $('calSave').onclick = () => {
          const ms = parseMonths($('calM').value);
          if (!ms.length) {
            toast('Add at least one month');
            return;
          }
          const wd = $('calW')
            .value.split(',')
            .map((x) => x.trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 20);
          const mo = clamp(+$('calMo').value || 0, 0, ms.length - 1);
          const d = Math.round(+$('calD').value || 1);
          if (d < 1 || d > ms[mo].d) {
            toast(`${ms[mo].n} has ${plural(ms[mo].d, 'day')}`);
            $('calD').focus();
            return;
          }
          const y = Math.round(+$('calY').value || 0),
            Y = ms.reduce((a, m) => a + m.d, 0),
            n = S.time.day - 1;
          // work back from today to the date of Day 1
          let a = y * Y + ms.slice(0, mo).reduce((s, m) => s + m.d, 0) + d - 1 - n;
          const y1 = Math.floor(a / Y);
          a -= y1 * Y;
          let m1 = 0;
          while (m1 < ms.length - 1 && a >= ms[m1].d) {
            a -= ms[m1].d;
            m1++;
          }
          const w = wd.length ? ((+$('calWd').value || 0) - (n % wd.length) + wd.length * 2) % wd.length : 0;
          S.cal = {
            on: $('calOn').checked,
            months: ms,
            wd,
            y: y1,
            m: m1,
            d: a + 1,
            w0: w,
            era: $('calE').value.trim().slice(0, 20),
          };
          calPre = null;
          commit();
          toast(S.cal.on ? `Calendar saved. Today is ${calDate(S.time.day, true)}` : 'Calendar saved but turned off');
        };
      },
    };
  };

  // Quick rules and anywhere else can link to the Travel tool
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-gotravel]');
    if (b) {
      e.preventDefault();
      openSheet('session', 'travel');
    }
  });
  window.DM_TRAVEL = { calDate, dayLabel, calToDay }; // read-only hook for tests and tools
  /* generators */
  const NAMES = {
    Human: [
      [
        'Aldric',
        'Brenna',
        'Corwin',
        'Della',
        'Edrin',
        'Fiona',
        'Garrick',
        'Hilde',
        'Isolde',
        'Jory',
        'Kestrel',
        'Lorne',
        'Mara',
        'Niles',
        'Orla',
        'Perrin',
        'Rosalind',
        'Silas',
        'Tamsin',
        'Ulric',
        'Vera',
        'Wendell',
        'Yara',
      ],
      [
        'Ashford',
        'Blackwood',
        'Copperpot',
        'Dunmore',
        'Fairweather',
        'Greaves',
        'Holloway',
        'Marsh',
        'Thorne',
        'Underhill',
        'Whitlock',
        'Wren',
      ],
    ],
    Dwarf: [
      ['Brannoc', 'Dagna', 'Thorvik', 'Helka', 'Korrin', 'Vesta', 'Durgan', 'Brunhild'],
      ['Ironfoot', 'Stonebrow', 'Ambervein', 'Deephollow', 'Coalbeard', 'Hammerfall'],
    ],
    Elf: [
      ['Aeris', 'Liriel', 'Theren', 'Nivessa', 'Caladrel', 'Sariel', 'Ilvane', 'Vaelith'],
      ['Moonwhisper', 'Silverbough', 'Duskleaf', 'Starbrook', 'Willowmere'],
    ],
    Halfling: [
      ['Pip', 'Merrow', 'Lavender', 'Roscoe', 'Tilly', 'Tobin', 'Posy', 'Barnaby'],
      ['Goodbarrel', 'Thistledown', 'Applebrook', 'Underbough', 'Quickstep'],
    ],
    Gnome: [
      ['Fizwick', 'Nissa', 'Bimble', 'Orryn', 'Tansy', 'Wobbin'],
      ['Sprocketeer', 'Gemcutter', 'Tinkerly', 'Brasswhistle'],
    ],
    Orc: [
      ['Grusk', 'Shara', 'Thokk', 'Varga', 'Mogra', 'Durash'],
      ['Bonecleaver', 'Redtusk', 'Ashborn', 'Stonehide'],
    ],
    Tiefling: [
      ['Ashen', 'Kallix', 'Mordai', 'Nyxa', 'Riven', 'Zarael', 'Hope', 'Sorrow'],
      ['Vane', 'Cinder', 'Hollowmere', 'Nightbloom'],
    ],
    Dragonborn: [
      ['Arkhos', 'Biraxa', 'Medrin', 'Soraal', 'Kavrix', 'Thessa'],
      ['Clan Myrkath', 'Clan Vorrun', 'Clan Ixaris', 'Clan Tharn'],
    ],
  };
  const JOBS = [
    'blacksmith',
    'innkeeper',
    'street urchin',
    'temple acolyte',
    'caravan guard',
    'fence',
    'apothecary',
    'city watch sergeant',
    'minstrel',
    'farmer',
    'retired adventurer',
    'scribe',
    'ferryman',
    'noble’s steward',
    'hunter',
    'ratcatcher',
    'merchant',
    'gravedigger',
  ];
  const TRAITS = [
    'Speaks in a whisper',
    'Laughs at their own jokes',
    'Never makes eye contact',
    'Fidgets with a coin',
    'Quotes old proverbs',
    'Suspicious of magic',
    'Overly polite',
    'Blunt to the point of rudeness',
    'Hums constantly',
    'Easily flattered',
    'Chews on a pipe stem',
    'Has a nervous stammer',
    'Is missing two fingers',
    'Wears far too much jewellery',
  ];
  const WANTS = [
    'to pay off a gambling debt',
    'revenge on a former partner',
    'to find a missing sibling',
    'a quiet life',
    'to be taken seriously',
    'to leave town before winter',
    'a cure for a sick parent',
    'to buy their own shop',
    'proof that a rival is a cheat',
    'to see the ocean once',
  ];
  const SECRETS2 = [
    'informs for the local thieves’ guild',
    'is hiding a deserter in the cellar',
    'owes money to a dangerous noble',
    'once killed a man in self-defence',
    'is not who they claim to be',
    'knows a back way into the old keep',
    'is secretly a follower of a forbidden god',
    'stole the item everyone is looking for',
  ];
  const TAV_A = [
    'Prancing',
    'Rusty',
    'Gilded',
    'Drunken',
    'Sleeping',
    'Crooked',
    'Wandering',
    'Laughing',
    'Silver',
    'Broken',
    'Salty',
    'Howling',
    'Golden',
    'Wicked',
  ];
  const TAV_N = [
    'Pony',
    'Dragon',
    'Tankard',
    'Griffon',
    'Lantern',
    'Goose',
    'Anchor',
    'Stag',
    'Kettle',
    'Raven',
    'Boar',
    'Wyvern',
    'Barrel',
    'Fiddle',
  ];
  const TAV_F = [
    'Famous for a spiced stew nobody can identify.',
    'A bard plays here every night, badly.',
    'The floor slopes toward the bar.',
    'A mounted owlbear head hangs over the hearth.',
    'Rooms upstairs are cheap and haunted.',
    'Dice games run in the back room.',
    'The ale is watered but the pies are excellent.',
    'Mercenaries drink here and pick fights with strangers.',
  ];
  let GEN = [],
    genCrV = '0';
  function genOne(k, cr) {
    if (k === 'npc') {
      const anc = pick(Object.keys(NAMES)),
        [g, s] = NAMES[anc],
        name = `${pick(g)} ${pick(s)}`,
        job = pick(JOBS),
        tr = pick(TRAITS),
        want = pick(WANTS),
        sec = pick(SECRETS2);
      const notes = `${anc}. ${tr}. Wants ${want}. Secretly ${sec}.`;
      return {
        kind: 'NPC',
        title: name,
        text: `${anc} ${job}. ${tr}. Wants ${want}. Secretly ${sec}.`,
        act: 'Save to NPCs',
        run() {
          clearExample('npcs');
          S.npcs.push({
            id: uid(),
            name,
            role: job[0].toUpperCase() + job.slice(1),
            where: '',
            attitude: 'Unknown',
            notes,
          });
          commit();
          toast(`${name} saved to NPCs`);
        },
      };
    }
    if (k === 'tavern') {
      const name = `The ${pick(TAV_A)} ${pick(TAV_N)}`,
        text = `${pick(TAV_F)} The keeper ${pick(TRAITS).toLowerCase().replace(/^has /, 'has ')}.`;
      return {
        kind: 'Tavern',
        title: name,
        text,
        act: 'Save to Places',
        run() {
          clearExample('places');
          S.places.push({ id: uid(), name, kind: 'Building', notes: text });
          commit();
          toast(`${name} saved to Places`);
        },
      };
    }
    if (k === 'weather') {
      const text = rollWeather();
      return {
        kind: 'Weather',
        title: 'Weather',
        text,
        act: 'Set as today’s weather',
        run() {
          S.time.weather = text;
          commit();
          toast('Weather set');
        },
      };
    }
    const sum = (n, f) => {
      let t = 0;
      for (let i = 0; i < n; i++) t += rnd(f);
      return t;
    };
    const [amt, coin, band] =
      cr >= 17
        ? [sum(2, 8) * 100, 'pp', '17+']
        : cr >= 11
          ? [sum(2, 10) * 10, 'pp', '11–16']
          : cr >= 5
            ? [sum(2, 8) * 10, 'gp', '5–10']
            : [sum(3, 6), 'gp', '0–4'];
    return {
      kind: 'Treasure',
      title: `${amt.toLocaleString()} ${coin}`,
      text: `Individual treasure carried by a CR ${band} creature.`,
      act: 'Add to party funds',
      run() {
        S.purse[coin] = (+S.purse[coin] || 0) + amt;
        commit();
        toast(`${amt} ${coin} added to party funds`);
      },
    };
  }
  VIEWS.notes.gen = () => ({
    html:
      head('Generators', 'Quick inspiration for when the party goes somewhere you didn’t plan.') +
      `
  <div class="box"><div class="row" style="flex-wrap:wrap"><button class="btn" type="button" data-gen="npc">NPC</button><button class="btn" type="button" data-gen="tavern">Tavern</button><button class="btn" type="button" data-gen="weather">Weather</button>
    <span class="row"><select id="genCr" style="width:auto" aria-label="Treasure challenge rating">${[
      ['0', 'CR 0–4'],
      ['5', 'CR 5–10'],
      ['11', 'CR 11–16'],
      ['17', 'CR 17+'],
    ]
      .map(([k, l]) => `<option value="${k}"${k === genCrV ? ' selected' : ''}>${l}</option>`)
      .join('')}</select><button class="btn" type="button" data-gen="coins">Treasure</button></span></div></div>
  <div class="list">${GEN.map((g, i) => `<div class="item"><div class="row between"><strong>${esc(g.title)}</strong><span class="pill mut">${g.kind}</span></div><p>${esc(g.text)}</p>${g.act ? `<div class="row end"><button class="btn sm" type="button" data-gact="${i}">${esc(g.act)}</button></div>` : ''}</div>`).join('') || '<div class="empty">Tap a button to roll something up.</div>'}</div>`,
    bind: () => {
      const ov = $('overlay');
      $('genCr').onchange = (e) => (genCrV = e.target.value);
      ov.querySelectorAll('[data-gen]').forEach(
        (b) =>
          (b.onclick = () => {
            GEN.unshift(genOne(b.dataset.gen, +genCrV));
            GEN = GEN.slice(0, 12);
            drawSheet();
          })
      );
      ov.querySelectorAll('[data-gact]').forEach(
        (b) =>
          (b.onclick = () => {
            const g = GEN[+b.dataset.gact];
            g.act = '';
            g.run();
          })
      );
    },
  });

  /* spell quick reference (2024 rules, short summaries). Filled in place when data/spells.js loads
     (quick rows, then merged with the SRD list; see "reference data"). */
  const SPELLS = [];
  let spellQ = '',
    spellL = 'all';
  VIEWS.battle.spells = () => {
    const q = spellQ.toLowerCase();
    const list = SPELLS.filter(
      (s) =>
        (spellL === 'all' || String(s[1]) === spellL) &&
        (!q || s[0].toLowerCase().includes(q) || s[7].toLowerCase().includes(q) || s[2].toLowerCase().includes(q))
    );
    return {
      html:
        head(
          'Spells',
          `Short summaries of ${SPELLS.length} spells that come up most in combat, 2024 rules. The Player’s Handbook has the full text.`
        ) +
        `
  <div class="row" style="flex-wrap:nowrap"><input type="search" id="spq" placeholder="Search spells, e.g. fire, heal, paralyzed" value="${esc(spellQ)}" aria-label="Search spells"><select id="spl" style="width:auto" aria-label="Spell level"><option value="all">Any level</option>${[0, 1, 2, 3, 4, 5, 6].map((l) => `<option value="${l}"${spellL === String(l) ? ' selected' : ''}>${l ? ORD[l - 1] + ' level' : 'Cantrips'}</option>`).join('')}</select></div>
  <div class="list">${list.map((s) => `<div class="item"><div class="row between"><strong>${esc(s[0])}</strong><span class="pill ${s[6] ? 'cd' : 'mut'}">${s[1] ? ORD[s[1] - 1] + ' level' : 'Cantrip'}${s[6] ? ' · Concentration' : ''}</span></div><div class="meta">${esc(s[2])} · ${esc(s[3])} · ${esc(s[4])} · ${esc(s[5])}</div><p>${esc(s[7])}</p></div>`).join('') || '<div class="empty">No spells match.</div>'}</div>`,
      bind: () => {
        const f = $('spq');
        f.oninput = () => {
          spellQ = f.value;
          drawSheet();
          const n = $('spq');
          n.focus();
          n.setSelectionRange(n.value.length, n.value.length);
        };
        $('spl').onchange = (e) => {
          spellL = e.target.value;
          drawSheet();
        };
      },
    };
  };

  /* ---------- SRD 5.2.1 reference: every SRD spell, magic items, loot links ---------- */
  /* SRD 5.2.1 spells and magic items (CC-BY-4.0, Wizards of the Coast). Summaries in our own words.
   Generated from the SRD 5.2.1 text; regenerate rather than hand-editing this block. */
  const SRD_IT = []; // filled in place from data/items.js (see "reference data")
  const SRD_CLS = {
    B: 'Bard',
    C: 'Cleric',
    D: 'Druid',
    P: 'Paladin',
    R: 'Ranger',
    S: 'Sorcerer',
    K: 'Warlock',
    W: 'Wizard',
  };
  const SRD_RAR = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'];
  const SRD_GP = { Common: 100, Uncommon: 400, Rare: 4000, 'Very Rare': 40000, Legendary: 200000 };
  const srdKey = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[‘’`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  // The full spell list: SRD facts, with the board's original wording kept for the 62 it already had.
  // Any spell that isn't in the SRD stays, marked as such.
  // Row: [name, level, school, time, range, duration, conc, summary, ritual, components, save/attack, classes, srd]
  function mergeSpells(SRD_SP) {
    const old = new Map(SPELLS.map((s) => [srdKey(s[0]), s]));
    const seen = new Set();
    const all = SRD_SP.map((r) => {
      const o = old.get(srdKey(r[0]));
      seen.add(srdKey(r[0]));
      return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7] || (o ? o[7] : ''), r[8], r[9], r[10], r[11], 1];
    });
    SPELLS.forEach((s) => {
      if (!seen.has(srdKey(s[0]))) all.push([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], 0, '', '', '', 0]);
    });
    all.sort((a, b) => a[0].localeCompare(b[0]));
    SPELLS.splice(0, SPELLS.length, ...all);
    SRD_SPN = SPELLS.filter((s) => s[12]).length;
  }
  let SRD_SPN = 0;
  const srdRank = (q, name) => {
    const n = srdKey(name);
    return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
  };
  const srdLvl = (l) => (l ? `${ORD[l - 1]} level` : 'Cantrip');
  let spellC = '',
    spellCo = false,
    spellRi = false;
  VIEWS.battle.spells = () => {
    const q = srdKey(spellQ);
    const list = SPELLS.filter(
      (s) =>
        (spellL === 'all' || String(s[1]) === spellL) &&
        (!spellC || s[11].includes(spellC)) &&
        (!spellCo || s[6]) &&
        (!spellRi || s[8]) &&
        (!q ||
          srdKey(s[0]).includes(q) ||
          srdKey(s[7]).includes(q) ||
          srdKey(s[2]).includes(q) ||
          srdKey(s[10]).includes(q))
    );
    if (q) list.sort((x, y) => srdRank(q, x[0]) - srdRank(q, y[0]));
    const opt = (v, l, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`;
    return {
      html:
        head(
          'Spells',
          `All ${SRD_SPN} spells in the SRD 5.2.1${SPELLS.length > SRD_SPN ? `, plus ${SPELLS.length - SRD_SPN} more` : ''}. 2024 rules, summarised in our own words. The Player’s Handbook has the full text.`
        ) +
        `
  <div class="row" style="flex-wrap:wrap"><input type="search" id="spq" placeholder="Search spells, e.g. fire, heal, Wis save" value="${esc(spellQ)}" aria-label="Search spells" style="flex:1;min-width:200px">
    <select id="spl" style="width:auto" aria-label="Spell level">${opt('all', 'Any level', spellL)}${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => opt(String(l), l ? ORD[l - 1] + ' level' : 'Cantrips', spellL)).join('')}</select>
    <select id="spc" style="width:auto" aria-label="Class">${opt('', 'Any class', spellC)}${Object.entries(SRD_CLS)
      .map(([k, v]) => opt(k, v, spellC))
      .join('')}</select>
    <label class="row" style="gap:6px;flex:none"><input type="checkbox" id="spco"${spellCo ? ' checked' : ''}>Concentration</label>
    <label class="row" style="gap:6px;flex:none"><input type="checkbox" id="spri"${spellRi ? ' checked' : ''}>Ritual</label></div>
  <p class="meta" id="spn" aria-live="polite">${list.length === SPELLS.length ? `${list.length} spells` : `${list.length} of ${SPELLS.length} spells`}</p>
  <div class="list">${
    list
      .map(
        (
          s
        ) => `<div class="item" data-spell="${esc(s[0])}"><div class="row between"><strong>${esc(s[0])}</strong><span class="pill ${s[6] ? 'cd' : 'mut'}">${srdLvl(s[1])}${s[6] ? ' · Concentration' : ''}${s[8] ? ' · Ritual' : ''}</span></div>
    <div class="meta">${[s[2], s[3], s[4], s[5], s[9]].filter(Boolean).map(esc).join(' · ')}</div><p>${esc(s[7])}</p>
    <div class="meta">${[
      s[10],
      s[11]
        .split('')
        .map((c) => SRD_CLS[c])
        .join(', '),
      s[12] ? '' : 'Not in the SRD',
    ]
      .filter(Boolean)
      .map(esc)
      .join(' · ')}</div></div>`
      )
      .join('') || '<div class="empty">No spells match.</div>'
  }</div>
  <p class="meta">Spell facts from the SRD 5.2.1 (CC-BY-4.0). Credit in Quick rules.</p>`,
      bind: () => {
        const f = $('spq');
        f.oninput = () => {
          spellQ = f.value;
          drawSheet();
          const n = $('spq');
          n.focus();
          n.setSelectionRange(n.value.length, n.value.length);
        };
        $('spl').onchange = (e) => {
          spellL = e.target.value;
          drawSheet();
        };
        $('spc').onchange = (e) => {
          spellC = e.target.value;
          drawSheet();
        };
        $('spco').onchange = (e) => {
          spellCo = e.target.checked;
          drawSheet();
        };
        $('spri').onchange = (e) => {
          spellRi = e.target.checked;
          drawSheet();
        };
      },
    };
  };

  /* magic items */
  // Row: [name, category, rarities, attunement (0, 1 or "by a ..."), summary]
  const srdType = (it) => it[1].split(' (')[0];
  const srdRarText = (r) => (r.length === 1 ? r[0] : `${r[0]} to ${r[r.length - 1]}`);
  const srdAtt = (it) => (it[3] ? (it[3] === 1 ? 'Requires attunement' : `Requires attunement by ${it[3]}`) : '');
  const srdConsumable = (it) => /^Potion/.test(it[1]);
  function srdValue(it, rar) {
    const rs = rar ? [rar] : it[2];
    if (it[0] === 'Spell Scroll') return 'Twice the scribing cost';
    if (rs.includes('Artifact')) return 'Priceless';
    const v = (r) => Math.round((SRD_GP[r] || 0) / (srdConsumable(it) ? 2 : 1)).toLocaleString('en-US');
    return rs.length === 1 ? `${v(rs[0])} gp` : `${v(rs[0])}–${v(rs[rs.length - 1])} gp`;
  }
  const SRD_IT_BY = new Map(); // filled with SRD_IT
  const srdIt = (n) => SRD_IT_BY.get(srdKey(n));
  // name a specific version of an item that comes in several rarities
  const SRD_PLUS = {
    'Ammunition, +1, +2, or +3': 'Ammunition',
    'Armor, +1, +2, or +3': 'Armor',
    'Shield, +1, +2, or +3': 'Shield',
    'Weapon, +1, +2, or +3': 'Weapon',
    'Wand of the War Mage, +1, +2, or +3': 'Wand of the War Mage',
  };
  const SRD_HEAL = {
    Common: 'Potion of Healing',
    Uncommon: 'Potion of Greater Healing',
    Rare: 'Potion of Superior Healing',
    'Very Rare': 'Potion of Supreme Healing',
  };
  const SRD_GIANT = {
    belt: {
      hill: 'Rare',
      frost: 'Very Rare',
      stone: 'Very Rare',
      fire: 'Very Rare',
      cloud: 'Legendary',
      storm: 'Legendary',
    },
    potion: {
      hill: 'Uncommon',
      frost: 'Rare',
      stone: 'Rare',
      fire: 'Very Rare',
      cloud: 'Very Rare',
      storm: 'Legendary',
    },
  };
  const SRD_HORN = { silver: 'Rare', brass: 'Rare', bronze: 'Very Rare', iron: 'Legendary' };
  function srdVariant(it, rar) {
    const base = SRD_PLUS[it[0]];
    if (base) {
      const n = it[2].indexOf(rar) + 1;
      return base === 'Wand of the War Mage' ? `${base} +${n}` : `+${n} ${base}`;
    }
    if (it[0] === 'Potions of Healing') return SRD_HEAL[rar] || it[0];
    const g = it[0] === 'Belt of Giant Strength' ? 'belt' : it[0] === 'Potion of Giant Strength' ? 'potion' : '';
    if (g) {
      const ks = Object.keys(SRD_GIANT[g]).filter((k) => SRD_GIANT[g][k] === rar);
      const k = ks.length ? pick(ks) : 'hill';
      return `${g === 'belt' ? 'Belt' : 'Potion'} of ${k[0].toUpperCase() + k.slice(1)} Giant Strength`;
    }
    if (it[0] === 'Horn of Valhalla') {
      const ks = Object.keys(SRD_HORN).filter((k) => SRD_HORN[k] === rar);
      return `${ks.length ? ks[0][0].toUpperCase() + ks[0].slice(1) : 'Silver'} Horn of Valhalla`;
    }
    if (it[2].length > 1) return `${it[0]} (${rar})`;
    return it[0];
  }
  const SRD_ARMOR = /\b(armou?r|mail|plate|leather|hide|breastplate|chain|splint|padded)\b/;
  const SRD_SCROLL_R = [
    'Common',
    'Common',
    'Uncommon',
    'Uncommon',
    'Rare',
    'Rare',
    'Very Rare',
    'Very Rare',
    'Very Rare',
    'Legendary',
  ];
  // match a loot name like "Cloak of Protection", "+1 longsword", "potion of greater healing" to an SRD item
  function srdItem(name) {
    let k = srdKey(name)
      .replace(/^(a|an|the|one|two|\d+)\s+/, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/[.!]+$/, '')
      .trim();
    if (k.length < 3) return null;
    const hit = (n, rar) => {
      const it = srdIt(n);
      return it ? { it, rar: rar || (it[2].length === 1 ? it[2][0] : null) } : null;
    };
    let m = srdIt(k);
    if (m) return hit(m[0]);
    if ((m = k.match(/^potions? of (greater |superior |supreme )?healing$/)))
      return hit(
        'Potions of Healing',
        { '': 'Common', 'greater ': 'Uncommon', 'superior ': 'Rare', 'supreme ': 'Very Rare' }[m[1] || '']
      );
    if ((m = k.match(/^(?:spell )?scrolls? of (.+)$/))) {
      const sp = SPELLS.find((s) => srdKey(s[0]) === m[1]);
      return hit('Spell Scroll', sp ? SRD_SCROLL_R[sp[1]] : null);
    }
    if ((m = k.match(/^(belt|potion)s? of (hill|frost|stone|fire|cloud|storm) giant strength$/)))
      return hit(m[1] === 'belt' ? 'Belt of Giant Strength' : 'Potion of Giant Strength', SRD_GIANT[m[1]][m[2]]);
    if ((m = k.match(/^(silver|brass|bronze|iron) horn of valhalla$/))) return hit('Horn of Valhalla', SRD_HORN[m[1]]);
    if (k === 'luckstone') return hit('Stone of Good Luck (Luckstone)');
    if ((m = k.match(/^\+([123]) (.+)$/) || k.match(/^(.+?),? \+([123])$/))) {
      const n = +(/^\d$/.test(m[1]) ? m[1] : m[2]),
        b = /^\d$/.test(m[1]) ? m[2] : m[1];
      const nm = /wand of the war mage/.test(b)
        ? 'Wand of the War Mage, +1, +2, or +3'
        : /\bshield\b/.test(b)
          ? 'Shield, +1, +2, or +3'
          : SRD_ARMOR.test(b)
            ? 'Armor, +1, +2, or +3'
            : /\b(arrows?|bolts?|bullets?|needles?|ammunition)\b/.test(b)
              ? 'Ammunition, +1, +2, or +3'
              : 'Weapon, +1, +2, or +3';
      const it = srdIt(nm);
      return it ? { it, rar: it[2][n - 1] } : null;
    }
    // "Cloak of Protection, Vex's" or "Bag of Holding with 30 gp inside": the longest SRD name the text starts with
    let best = null;
    for (const [key, it] of SRD_IT_BY) {
      if ((!best || key.length > best[0].length) && (k.startsWith(key + ' ') || k.startsWith(key + ',')))
        best = [key, it];
    }
    return best ? hit(best[1][0]) : null;
  }
  // save an item as a handout to give the players (reuses one with the same title and text)
  function srdShowItem(it, rar, title) {
    title = String(title || it[0]).slice(0, 120);
    const r = rar || srdRarText(it[2]);
    const body = `${r} ${srdType(it).toLowerCase()}${it[3] ? `, ${srdAtt(it).toLowerCase()}` : ''}.\n\n${it[4]}`;
    let h = S.handouts.find((x) => x.title === title && x.body === body && !x.img);
    if (!h) {
      upsert('handouts', null, { title, body, img: null }, { shown: 0 });
      h = S.handouts[S.handouts.length - 1];
    }
    if (!h) return;
    toast(`${h.title} is in Handouts`);
  }
  function srdAddLoot(it, rar, name) {
    upsert(
      'loot',
      null,
      { item: String(name || it[0]).slice(0, 200), holder: 'Party', value: srdValue(it, rar) },
      { session: S.dm.session }
    );
    toast(`${name || it[0]} added to Loot`);
  }
  let itemQ = '',
    itemR = 'all',
    itemT = 'all',
    itemA = 'all';
  VIEWS.battle.items = () => {
    const q = srdKey(itemQ);
    const types = [...new Set(SRD_IT.map(srdType))].sort();
    const list = SRD_IT.filter(
      (it) =>
        (itemR === 'all' || it[2].includes(itemR)) &&
        (itemT === 'all' || srdType(it) === itemT) &&
        (itemA === 'all' || (itemA === 'yes') === !!it[3]) &&
        (!q || srdKey(it[0]).includes(q) || srdKey(it[4]).includes(q) || srdKey(it[1]).includes(q))
    );
    if (q) list.sort((x, y) => srdRank(q, x[0]) - srdRank(q, y[0]));
    const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
    return {
      html:
        head(
          'Magic items',
          `All ${SRD_IT.length} magic items in the SRD 5.2.1, summarised in our own words. 2024 rules.`
        ) +
        `
  <div class="row" style="flex-wrap:wrap"><input type="search" id="itq" placeholder="Search items, e.g. cloak, fly, +1" value="${esc(itemQ)}" aria-label="Search magic items" style="flex:1;min-width:200px">
    <select id="itr" style="width:auto" aria-label="Rarity">${opt('all', 'Any rarity', itemR)}${SRD_RAR.map((r) => opt(r, r, itemR)).join('')}</select>
    <select id="itt" style="width:auto" aria-label="Type">${opt('all', 'Any type', itemT)}${types.map((t) => opt(t, t, itemT)).join('')}</select>
    <select id="ita" style="width:auto" aria-label="Attunement">${opt('all', 'Attunement or not', itemA)}${opt('yes', 'Needs attunement', itemA)}${opt('no', 'No attunement', itemA)}</select></div>
  <details class="box" id="itprice"><summary><strong>Value by rarity</strong> <span class="meta">2024 guidance</span></summary><dl class="hooks" style="margin-top:8px">${Object.entries(
    SRD_GP
  )
    .map(([r, v]) => `<dt>${r}</dt><dd>${v.toLocaleString('en-US')} gp</dd>`)
    .join('')}<dt>Artifact</dt><dd>Priceless</dd></dl>
    <p class="meta" style="margin:6px 0 0">Halve it for consumables such as potions. A spell scroll is worth twice its scribing cost. For magic armor or weapons, add the base item’s cost.</p></details>
  <p class="meta" id="itn" aria-live="polite">${list.length === SRD_IT.length ? `${list.length} items` : `${list.length} of ${SRD_IT.length} items`}</p>
  <div class="list">${
    list
      .map((it) => {
        const i = SRD_IT.indexOf(it);
        return `<div class="item" data-item="${esc(it[0])}"><div class="row between"><strong>${esc(it[0])}</strong><span class="pill ${it[3] ? 'cd' : 'mut'}">${esc(srdRarText(it[2]))}${it[3] ? ' · Attunement' : ''}</span></div>
    <div class="meta">${[it[1], srdAtt(it), `Value ${srdValue(it)}`].filter(Boolean).map(esc).join(' · ')}</div><p>${esc(it[4])}</p>
    <div class="row end"><button class="btn sm ghost" type="button" data-itloot="${i}">Add to loot</button><button class="btn sm" type="button" data-itshow="${i}" title="Save it as a handout for the players">Make handout</button></div></div>`;
      })
      .join('') || '<div class="empty">No items match.</div>'
  }</div>
  <p class="meta">Item facts from the SRD 5.2.1 (CC-BY-4.0). Credit in Quick rules.</p>`,
      bind: () => {
        const ov = $('overlay');
        const f = $('itq');
        f.oninput = () => {
          itemQ = f.value;
          drawSheet();
          const n = $('itq');
          n.focus();
          n.setSelectionRange(n.value.length, n.value.length);
        };
        $('itr').onchange = (e) => {
          itemR = e.target.value;
          drawSheet();
        };
        $('itt').onchange = (e) => {
          itemT = e.target.value;
          drawSheet();
        };
        $('ita').onchange = (e) => {
          itemA = e.target.value;
          drawSheet();
        };
        ov.querySelectorAll('[data-itloot]').forEach(
          (b) =>
            (b.onclick = () => {
              const it = SRD_IT[+b.dataset.itloot];
              it &&
                srdAddLoot(
                  it,
                  itemR !== 'all' && it[2].includes(itemR) ? itemR : null,
                  itemR !== 'all' && it[2].length > 1 && it[2].includes(itemR) ? srdVariant(it, itemR) : it[0]
                );
            })
        );
        ov.querySelectorAll('[data-itshow]').forEach(
          (b) =>
            (b.onclick = () => {
              const it = SRD_IT[+b.dataset.itshow];
              it && srdShowItem(it);
            })
        );
      },
    };
  };
  {
    const subs = SECTIONS.battle.subs;
    SECTIONS.battle.subs = () => {
      const a = subs();
      const i = a.findIndex((x) => x[0] === 'spells');
      if (!a.some((x) => x[0] === 'items')) a.splice(i < 0 ? a.length : i + 1, 0, ['items', 'Items']);
      return a;
    };
  }

  /* loot links: a loot line named like an SRD item shows its rarity and attunement, and can be shown to the players */
  {
    const lootV = VIEWS.mission.loot;
    VIEWS.mission.loot = () => {
      const r = lootV();
      const b = r.bind;
      r.html += `<datalist id="srdItems">${SRD_IT.filter((it) => !SRD_PLUS[it[0]])
        .map((it) => `<option value="${esc(it[0])}">`)
        .join('')}</datalist>`;
      r.bind = () => {
        b && b();
        const ov = $('overlay');
        const li = $('lItem');
        li && li.setAttribute('list', 'srdItems');
        ov.querySelectorAll('[data-ldel]').forEach((x) => {
          const l = S.loot.find((y) => y.id === x.dataset.ldel);
          const tr = x.closest('tr');
          if (!l || !tr) return;
          const m = srdItem(l.item);
          if (!m) return;
          const td = tr.querySelector('td');
          const tip = `${m.rar || srdRarText(m.it[2])}${m.it[3] ? ', ' + srdAtt(m.it).toLowerCase() : ''}. ${m.it[4]}`;
          td.insertAdjacentHTML(
            'beforeend',
            ` <span class="pill ${m.it[3] ? 'cd' : 'mut'} srdtag" title="${esc(tip)}" tabindex="0" aria-label="${esc(`SRD item: ${tip}`)}">${esc(m.rar || srdRarText(m.it[2]))}${m.it[3] ? ' · Attunement' : ''}</span>`
          );
          const sb = document.createElement('button');
          sb.className = 'btn sm ghost';
          sb.type = 'button';
          sb.dataset.lshow = l.id;
          sb.textContent = 'Make handout';
          sb.title = 'Save it as a handout for the players';
          sb.onclick = () => srdShowItem(m.it, m.rar, l.item);
          x.parentNode.insertBefore(sb, x);
        });
      };
      return r;
    };
  }

  /* treasure: roll an SRD magic item by rarity in Generators */
  let genRar = 'Uncommon';
  function srdRollItem(rar) {
    const pool = SRD_IT.filter((it) => it[2].includes(rar) && !it[2].includes('Artifact'));
    const it = pick(pool);
    const name = srdVariant(it, rar);
    return {
      kind: 'Magic item',
      title: name,
      text: `${rar} ${srdType(it).toLowerCase()}${it[3] ? `, ${srdAtt(it).toLowerCase()}` : ''}. ${it[4]} Value about ${srdValue(it, rar)}.`,
      act: 'Add to loot',
      run() {
        srdAddLoot(it, rar, name);
      },
    };
  }
  {
    const g = genOne;
    genOne = (k, cr) => (k === 'item' ? srdRollItem(genRar) : g(k, cr));
    const gv = VIEWS.notes.gen;
    VIEWS.notes.gen = () => {
      const r = gv();
      const ui = `<span class="row"><select id="genRar" style="width:auto" aria-label="Magic item rarity">${SRD_RAR.slice(
        0,
        5
      )
        .map((x) => `<option${x === genRar ? ' selected' : ''}>${x}</option>`)
        .join('')}</select><button class="btn" type="button" data-gen="item">Magic item</button></span>`;
      const at = 'data-gen="coins">Treasure</button></span>';
      r.html = r.html.includes(at) ? r.html.replace(at, at + ui) : r.html.replace('</div></div>', ui + '</div></div>');
      const b = r.bind;
      r.bind = () => {
        b && b();
        const s = $('genRar');
        s && (s.onchange = (e) => (genRar = e.target.value));
      };
      return r;
    };
  }

  /* search finds SRD spells and magic items by name */
  {
    const sa = searchAll;
    searchAll = (q) => {
      const out = sa(q);
      const k = srdKey(q);
      if (k.length < 3) return out;
      SPELLS.forEach((s) => {
        if (srdKey(s[0]).includes(k))
          out.push({
            kind: 'Spell',
            title: s[0],
            text: `${srdLvl(s[1])} ${s[2].toLowerCase()}. ${s[7]}`,
            go: ['battle', 'spells'],
            srd: { spell: s[0] },
          });
      });
      SRD_IT.forEach((it) => {
        if (srdKey(it[0]).includes(k))
          out.push({
            kind: 'Magic item',
            title: it[0],
            text: `${srdRarText(it[2])}${it[3] ? ', attunement' : ''}. ${it[4]}`,
            go: ['battle', 'items'],
            srd: { item: it[0] },
          });
      });
      return out;
    };
    const pre = (e) => {
      const el = e.target && e.target.closest && e.target.closest('[data-sr]');
      if (!el || (e.type === 'keydown' && e.key !== 'Enter')) return;
      const x = searchAll(SQ)[+el.dataset.sr];
      if (!x || !x.srd) return;
      if (x.srd.spell != null) {
        spellQ = x.srd.spell;
        spellL = 'all';
        spellC = '';
        spellCo = spellRi = false;
      } else {
        itemQ = x.srd.item;
        itemR = itemT = itemA = 'all';
      }
    };
    document.addEventListener('click', pre, true);
    document.addEventListener('keydown', pre, true);
  }

  /* credit line, in Quick rules */
  {
    const rv = VIEWS.battle.rules;
    VIEWS.battle.rules = () => {
      const r = rv();
      const about = `<div class="item" id="srdAbout"><h4>About</h4><p style="margin:0;color:var(--ink-2);font-size:14px">This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.</p><p style="margin:8px 0 0;color:var(--ink-2);font-size:14px">The monster statistics, spells, magic items and conditions come from the SRD 5.2.1. Spell, item and condition summaries are shortened and reworded in our own words, and monster entries are cut down to numbers and attacks.</p><p style="margin:8px 0 0;color:var(--ink-2);font-size:14px">Unofficial fan content. Not approved, endorsed, sponsored by or affiliated with Wizards of the Coast. Dungeons &amp; Dragons, D&amp;D and D&amp;D Beyond are trademarks of Wizards of the Coast LLC.</p></div>`;
      r.html = /<\/div>\s*$/.test(r.html) ? r.html.replace(/<\/div>\s*$/, about + '</div>') : r.html + about;
      return r;
    };
  }
  /* ---------- reference data: bestiary, spells and magic items load on first use ---------- */
  // data/bestiary.js, spells.js and items.js (about 180 KB) are not in index.html. js/lazy-data.js injects them the
  // first time something needs them: a sheet other than Player/Campaign opens (openSheet), a monster card opens
  // (monCard), or a home action rolls monsters (wandering monsters, a scene's battle). withRef(fn) runs fn at once
  // when the data is in, otherwise after it loads. Code that reads MONSTERS, MON_BY_NAME, MM_ATK, SPELLS, SRD_IT or
  // SRD_IT_BY must run inside such a sheet or behind withRef. The containers are filled in place, once.
  // (state: REF_SETS, REF_FREE, refOk, refFailed, refQueue are declared at the top, next to MONSTERS)
  function applyRef() {
    const D = window.DMB_DATA;
    MONSTERS.length = 0;
    MON_BY_NAME.clear();
    Object.keys(MM_ATK).forEach((k) => delete MM_ATK[k]);
    D.bestiary.monsters.forEach(([n, t, ac, ini, hp, cr, xp, spd]) => {
      const m = { n, t, ac, ini, hp, cr, xp, spd };
      MONSTERS.push(m);
      MON_BY_NAME.set(n, m);
    });
    Object.assign(MM_ATK, D.bestiary.attacks);
    syncHomebrew(); // homebrew goes after the SRD rows, as before
    SPELLS.splice(0, SPELLS.length, ...D.spells.quick);
    mergeSpells(D.spells.srd);
    SRD_IT.splice(0, SRD_IT.length, ...D.items.srd);
    SRD_IT.forEach((it) => SRD_IT_BY.set(srdKey(it[0]), it));
    refOk = true;
  }
  function withRef(fn) {
    if (refOk || refFailed) {
      fn();
      return;
    }
    refQueue.push(fn);
    if (refQueue.length > 1) return; // already loading
    const root = document.documentElement;
    root.setAttribute('aria-busy', 'true');
    root.style.cursor = 'progress';
    window.DMB_LAZY.loadAll(REF_SETS)
      .then(applyRef)
      .catch((e) => {
        refFailed = true;
        console.error(e);
        toast('Couldn’t load the bestiary, spells and items. Keep the data folder next to index.html');
      })
      .finally(() => {
        root.removeAttribute('aria-busy');
        root.style.cursor = '';
        refQueue.splice(0).forEach((f) => {
          try {
            f();
          } catch (e) {
            setTimeout(() => {
              throw e;
            });
          }
        });
        refFailed = false; // the next use tries again
      });
  }

  document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openSheet(b.dataset.open)));
  document.querySelector('[data-dice]').onclick = openDice;
  document.documentElement.lang = document.documentElement.lang || 'en';
  /* ---------- data safety: restore points, backup file, warnings ---------- */
  // Restore points live in IndexedDB, apart from the main save, so a bad load, a mistaken
  // "Clear all data" or a damaged save can be rolled back. They are kept per browser, so a
  // backup file (linked or downloaded) is still what protects against losing the browser itself.
  var SAFE = {
    snaps: null,
    persisted: null,
    file: null,
    fileAt: 0,
    filePaused: false,
    fileErr: false,
    lastSnapJSON: null,
    lastSnapAt: 0,
    changed: false,
    all: false,
  };
  var TAB_STALE = false;
  const FS_OK = typeof window.showSaveFilePicker === 'function';
  const rq = (r) =>
    new Promise((a, b) => {
      r.onsuccess = () => a(r.result);
      r.onerror = () => b(r.error);
    });
  let sdbP = null;
  function sdb() {
    if (!sdbP)
      sdbP = new Promise((a, b) => {
        if (!window.indexedDB) return b(new Error('no IndexedDB'));
        const r = indexedDB.open('dm-board-safety', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          ['snaps', 'list', 'imgs', 'kv'].forEach((n) => {
            if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
          });
        };
        r.onsuccess = () => a(r.result);
        r.onerror = () => b(r.error);
        r.onblocked = () => b(new Error('blocked'));
      }).catch((e) => {
        sdbP = null;
        throw e;
      });
    return sdbP;
  }
  async function tx(stores, mode, fn) {
    const d = await sdb();
    const t = d.transaction(stores, mode);
    const done = new Promise((a, b) => {
      t.oncomplete = a;
      t.onerror = t.onabort = () => b(t.error);
    });
    let out;
    try {
      out = await fn((n) => t.objectStore(n));
    } catch (e) {
      // a put that throws (quota, a handle that can't be stored) aborts the whole write, never half of it
      done.catch(() => {});
      try {
        t.abort();
      } catch (e2) {}
      throw e;
    }
    await done;
    return out;
  }
  // restore point writes run one at a time so pruning never removes an image another write still needs
  let snapQ = Promise.resolve();
  const queued = (f) => (snapQ = snapQ.then(f, f));
  function takeSnap(label, force) {
    if (!S || S.example || RECOVERY_HOLD) return Promise.resolve(false);
    if (label === 'Opened the board' && !hasBoard()) return Promise.resolve(false);
    const json = JSON.stringify(S);
    if (!force && json === SAFE.lastSnapJSON) return Promise.resolve(false);
    const ids = [
        ...new Set(
          [...(S.battles || []).map((b) => b.map && b.map.img), ...(S.handouts || []).map((h) => h.img)].filter(
            (id) => id && IMGS[id]
          )
        ),
      ],
      imgs = ids.map((id) => [id, IMGS[id]]);
    const at = Math.max(Date.now(), SAFE.lastSnapAt + 1);
    const meta = {
      at,
      label,
      campaign: S.dm.campaign || '',
      session: S.dm.session,
      players: (S.players || []).length,
      size: json.length,
      imgs: ids,
    };
    SAFE.lastSnapJSON = json;
    SAFE.lastSnapAt = at;
    SAFE.changed = false;
    return queued(() =>
      tx(['snaps', 'list', 'imgs'], 'readwrite', (st) => {
        st('snaps').put(json, at);
        st('list').put(meta, at);
        imgs.forEach(([k, v]) => st('imgs').put(v, k));
      })
        .then(pruneSnaps)
        .then(() => true)
    ).catch(async (e) => {
      if (isQuota(e) && !SAFE.idbRetried) {
        // IndexedDB is full: make room (undo history first, then old restore points) and try once more
        SAFE.idbRetried = true;
        try {
          await undoClear();
          await pruneSnapsTo(6);
          SAFE.lastSnapJSON = null;
          if (await takeSnap(label, true)) return true;
        } catch (e2) {}
      }
      idbFull(e);
      console.warn('Restore point not saved', e);
      return false;
    });
  }
  function idbFull(e) {
    if (!isQuota(e) || SAFE.idbToast) return;
    SAFE.idbToast = true;
    toast('Restore points couldn’t be saved: storage is full');
  }
  async function pruneSnapsTo(n) {
    const list = (await tx(['list'], 'readonly', (st) => rq(st('list').getAll()))).sort((a, b) => b.at - a.at);
    const drop = list.slice(n);
    if (drop.length)
      await tx(['snaps', 'list'], 'readwrite', (st) =>
        drop.forEach((m) => {
          st('snaps').delete(m.at);
          st('list').delete(m.at);
        })
      );
    SAFE.snaps = list.slice(0, n);
  }
  // keep the 12 newest, the newest of each of the last 60 days played, and the 10 newest taken before a big change
  async function pruneSnaps() {
    const list = (await tx(['list'], 'readonly', (st) => rq(st('list').getAll()))).sort((a, b) => b.at - a.at);
    const keep = new Set(),
      days = new Set();
    let big = 0;
    list.forEach((m, i) => {
      const day = new Date(m.at).toDateString();
      if (i < 12) keep.add(m.at);
      if (!days.has(day) && days.size < 60) {
        days.add(day);
        keep.add(m.at);
      }
      if (/^(Before|End of)/.test(m.label) && big < 10) {
        big++;
        keep.add(m.at);
      }
    });
    const kept = list.filter((m) => keep.has(m.at)),
      drop = list.filter((m) => !keep.has(m.at));
    const used = new Set();
    kept.forEach((m) => (m.imgs || []).forEach((k) => used.add(k)));
    const imgKeys = await tx(['imgs'], 'readonly', (st) => rq(st('imgs').getAllKeys()));
    if (drop.length || imgKeys.some((k) => !used.has(k)))
      await tx(['snaps', 'list', 'imgs'], 'readwrite', (st) => {
        drop.forEach((m) => {
          st('snaps').delete(m.at);
          st('list').delete(m.at);
        });
        imgKeys.forEach((k) => {
          if (!used.has(k)) st('imgs').delete(k);
        });
      });
    SAFE.snaps = kept;
    refreshDataView();
  }
  async function readSnap(at) {
    const [json, meta] = await tx(['snaps', 'list'], 'readonly', (st) =>
      Promise.all([rq(st('snaps').get(at)), rq(st('list').get(at))])
    );
    const imgs = {};
    if (meta && meta.imgs && meta.imgs.length)
      await tx(['imgs'], 'readonly', (st) =>
        Promise.all(
          meta.imgs.map((k) =>
            rq(st('imgs').get(k)).then((v) => {
              if (v) imgs[k] = v;
            })
          )
        )
      );
    return { json, meta, imgs };
  }
  function applyBoard(d, imgs) {
    const oldS = S,
      oldI = IMGS;
    try {
      if (typeof d === 'string') d = JSON.parse(d);
      if (!d || typeof d !== 'object' || !Array.isArray(d.players) || !d.dm) throw 0;
      delete d._meta;
      const c = checkBoard(d);
      if (!c.board || c.reasons.some((r) => !r.startsWith('dropped:'))) throw 0;
      IMGS = Object.assign({}, IMGS, cleanImgs(imgs || {}));
      S = c.board;
      normalize();
    } catch (e) {
      S = oldS;
      IMGS = oldI;
      toast('That restore point is damaged and couldn’t be loaded');
      return false;
    }
    UNDO = [];
    undoClear();
    endHold();
    resetTemp();
    S.example = false;
    pruneImgs(true);
    saveImgs();
    save();
    render();
    if (view) drawSheet();
    return true;
  }
  async function restoreSnap(at) {
    let r = null;
    try {
      r = await readSnap(at);
    } catch (e) {}
    if (!r || !r.json) {
      toast('That restore point couldn’t be read');
      return false;
    }
    await takeSnap('Before restoring a restore point', true);
    if (!applyBoard(r.json, r.imgs)) return false;
    clearBar('lost');
    toast(`Board restored to ${fmtAt(at)}`);
    return true;
  }
  async function downloadSnap(at) {
    let r = null;
    try {
      r = await readSnap(at);
    } catch (e) {}
    if (!r || !r.json) {
      toast('That restore point couldn’t be read');
      return;
    }
    const d = Object.assign(
      { _meta: { app: 'dm-board', format: 1, savedAt: new Date(at).toISOString() } },
      JSON.parse(r.json)
    );
    if (Object.keys(r.imgs).length) d.images = r.imgs;
    const t = new Date(at),
      p = (n) => String(n).padStart(2, '0');
    downloadText(
      JSON.stringify(d, null, 2),
      `dm-board-${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.json`
    );
  }
  function downloadText(text, name) {
    try {
      const a = document.createElement('a'),
        u = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.href = u;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 6e4);
    } catch (e) {}
  }
  function backupJSON() {
    const o = Object.assign({ _meta: { app: 'dm-board', format: 1, savedAt: new Date().toISOString() } }, S);
    if (Object.keys(IMGS).length) o.images = IMGS;
    return JSON.stringify(o, null, 2);
  }
  function localChangedAt() {
    try {
      return +localStorage.getItem(KEY + '-at') || 0;
    } catch (e) {
      return 0;
    }
  }
  function importNote(m, localAt, kept) {
    const at = Date.parse(m && m.savedAt);
    const tail = kept ? ' The board you had is kept as a restore point in Campaign → Data.' : '';
    if (!at) return 'Backup loaded.' + tail;
    if (kept && localAt && localAt > at + 6e4)
      return `Loaded a backup from ${fmtAt(at)}, which is older than the board you had here.` + tail;
    return `Backup from ${fmtAt(at)} loaded.` + tail;
  }
  function fmtAt(at) {
    const d = new Date(at),
      n = new Date(),
      hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === n.toDateString()) return 'Today ' + hm;
    if (d.toDateString() === new Date(n - 864e5).toDateString()) return 'Yesterday ' + hm;
    return (
      d.toLocaleDateString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric',
      }) +
      ' ' +
      hm
    );
  }
  const SNAP_LABEL = { Auto: 'Saved while playing' };
  function afterSave() {
    if (!SAFE) return;
    SAFE.changed = true;
    try {
      localStorage.setItem(KEY + '-at', String(Date.now()));
    } catch (e) {}
    if (SAFE.file && !SAFE.filePaused) {
      // 4 s after the last change, but never more than 60 s after the first unsaved one (steady editing)
      clearTimeout(SAFE.fileT);
      if (!SAFE.fileFirst) SAFE.fileFirst = Date.now();
      if (Date.now() - SAFE.fileFirst >= 6e4) writeFile();
      else SAFE.fileT = setTimeout(writeFile, 4000);
    }
    drawSaveState();
  }
  /* after a write to localStorage went through: keep a last good copy and the undo history */
  function afterWriteOk() {
    schedLKG();
    schedUndo();
  }
  function schedLKG() {
    clearTimeout(SAFE.lkgT);
    SAFE.lkgT = setTimeout(writeLKG, 5000);
  }
  function writeLKG() {
    if (!S || S.example || RECOVERY_HOLD || TAB_STALE || !lastJSON) return Promise.resolve(false);
    const json = lastJSON;
    try {
      JSON.parse(json);
    } catch (e) {
      return Promise.resolve(false);
    }
    const ids = Object.keys(IMGS).filter((k) => json.includes('"' + k + '"'));
    return queued(() =>
      tx(['kv'], 'readwrite', (st) => {
        st('kv').put({ at: Date.now(), json, imgs: ids }, 'good');
      })
    ).then(
      () => true,
      (e) => {
        idbFull(e);
        console.warn('Last good copy not saved', e);
        return false;
      }
    );
  }
  async function readLKG() {
    try {
      const g = await tx(['kv'], 'readonly', (st) => rq(st('kv').get('good')));
      return g && typeof g.json === 'string' && g.at ? g : null;
    } catch (e) {
      return null;
    }
  }
  async function restoreLKG() {
    const g = await readLKG();
    if (!g) {
      toast('The last good copy couldn’t be read');
      return false;
    }
    await takeSnap('Before restoring', true);
    if (!applyBoard(g.json, IMGS)) return false;
    toast(`Board restored to the last good copy, ${fmtAt(g.at)}`);
    return true;
  }
  /* ---- undo that survives a reload: kv['undo:<seq>'] = json, kv.undoHead = {seq0, seq1, hash, len} ---- */
  const UNDO_MAX = 20,
    UNDO_BYTES = 2e6;
  let undoSeq = 0,
    undoCap = UNDO_MAX,
    undoT = 0;
  const UNDO_DB = new Set(), // seqs stored in IndexedDB
    UNDO_SEQ = new Map(); // json -> seq
  const undoKey = (n) => 'undo:' + String(n).padStart(10, '0');
  const undoOn = () => !BK() || BK().prefs().keepUndo !== false;
  function schedUndo() {
    clearTimeout(undoT);
    undoT = setTimeout(persistUndo, 1000);
  }
  function persistUndo() {
    if (!UNDO_READY) return schedUndo();
    if (TAB_STALE || !S || S.example || RECOVERY_HOLD || !undoOn() || !lastJSON || !BK()) return Promise.resolve();
    const B = BK();
    const plan = B.planUndo(UNDO, undoCap, UNDO_BYTES);
    SAFE.undoTooBig = plan.tooBig;
    SAFE.undoN = plan.keep.length;
    const keep = [];
    let last = 0;
    plan.keep.forEach((j) => {
      let n = UNDO_SEQ.get(j);
      if (!n || n <= last) n = ++undoSeq;
      last = n;
      keep.push([n, j]);
    });
    const want = new Set(keep.map((x) => x[0]));
    const puts = keep.filter(([n]) => !UNDO_DB.has(n)),
      dels = [...UNDO_DB].filter((n) => !want.has(n));
    const head = {
      v: 1,
      seq0: keep.length ? keep[0][0] : 0,
      seq1: keep.length ? keep[keep.length - 1][0] : 0,
      hash: B.fnv(lastJSON),
      len: lastJSON.length,
      at: Date.now(),
    };
    return queued(() =>
      tx(['kv'], 'readwrite', (st) => {
        puts.forEach(([n, j]) => st('kv').put(j, undoKey(n)));
        dels.forEach((n) => st('kv').delete(undoKey(n)));
        st('kv').put(head, 'undoHead');
      })
    ).then(
      () => {
        puts.forEach(([n]) => UNDO_DB.add(n));
        dels.forEach((n) => UNDO_DB.delete(n));
        UNDO_SEQ.clear();
        keep.forEach(([n, j]) => UNDO_SEQ.set(j, n));
      },
      (e) => {
        if (isQuota(e) && undoCap === UNDO_MAX) {
          undoCap = Math.floor(UNDO_MAX / 2);
          return persistUndo();
        }
        console.warn('Undo history not kept', e);
      }
    );
  }
  function undoClear() {
    clearTimeout(undoT);
    UNDO_DB.clear();
    UNDO_SEQ.clear();
    SAFE.undoN = 0;
    return queued(() =>
      tx(['kv'], 'readwrite', (st) => {
        st('kv').delete(IDBKeyRange.bound('undo:', 'undo:~'));
        st('kv').delete('undoHead');
      })
    ).catch(() => {});
  }
  // on load: bring the saved steps back only if they lead to exactly the board that was loaded
  async function undoRestore(j0) {
    try {
      const [head, keys, vals] = await tx(['kv'], 'readonly', (st) => {
        const r = IDBKeyRange.bound('undo:', 'undo:~');
        return Promise.all([rq(st('kv').get('undoHead')), rq(st('kv').getAllKeys(r)), rq(st('kv').getAll(r))]);
      });
      const B = BK();
      const match = head && B && j0 && head.len === j0.length && head.hash === B.fnv(j0);
      if (loadDamaged) {
        // leave the damaged board's history alone until the DM chooses; any recovery clears it
      } else if (!match || !undoOn()) {
        if (head || keys.length) await undoClear();
      } else {
        const got = [];
        keys.forEach((k, i) => {
          const n = +String(k).slice(5);
          try {
            if (typeof vals[i] === 'string' && JSON.parse(vals[i]) && n >= head.seq0 && n <= head.seq1) {
              got.push(vals[i]);
              UNDO_DB.add(n);
              UNDO_SEQ.set(vals[i], n);
              undoSeq = Math.max(undoSeq, n);
              return;
            }
          } catch (e) {}
          UNDO_DB.add(n); // unreadable: deleted on the next write
        });
        UNDO = [...got, ...UNDO].slice(-40);
        SAFE.undoN = got.length;
      }
    } catch (e) {
      console.warn('Undo history unavailable', e);
    }
    UNDO_READY = true;
  }
  /* ---- recovery: the save hold ends only when the DM picks an option ---- */
  function endHold() {
    if (!RECOVERY_HOLD && !loadDamaged) return;
    RECOVERY_HOLD = false;
    loadDamaged = false;
    clearBar('lost');
    const m = $('mcard');
    if (m && m.dataset.recovery) m.remove();
    drawSaveState();
  }
  async function openRecovery() {
    if (!RECOVERY_HOLD) return;
    const lkg = await readLKG();
    withBK((B) =>
      B.recovery(
        {
          popup,
          popHead,
          esc,
          fmtAt,
          armDelete,
          holding: () => RECOVERY_HOLD,
          restoreLKG,
          restoreSnap: (at) => restoreSnap(at),
          restoreFile,
          loadFile: () => $('importFile').click(),
          downloadDamaged: () => {
            const raw = DAMAGED ? DAMAGED.raw : '';
            try {
              const a = document.createElement('a'),
                u = URL.createObjectURL(new Blob([raw], { type: 'text/plain' }));
              a.href = u;
              a.download = `dm-board-damaged-${today()}.txt`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(u), 6e4);
            } catch (e) {}
          },
          startFresh,
          later: recoveryLater,
        },
        {
          reasons: DAMAGED ? DAMAGED.reasons : [],
          lkg: lkg && (!DAMAGED || lkg.json !== DAMAGED.raw) ? lkg : null,
          snaps: (SAFE.snaps || []).map((m) => ({ at: m.at, label: SNAP_LABEL[m.label] || m.label })),
          file: SAFE.file ? { name: SAFE.file.name, at: SAFE.fileAt } : null,
        }
      )
    );
  }
  function recoveryLater() {
    bar('lost', 'Your board couldn’t be read. Nothing will be saved until you choose how to recover.', [
      ['Choose', openRecovery],
    ]);
    drawSaveState();
  }
  async function restoreFile() {
    const f = SAFE.file;
    if (!f) return false;
    try {
      let p = 'granted';
      if (f.queryPermission) p = await f.queryPermission({ mode: 'read' });
      if (p !== 'granted' && f.requestPermission) p = await f.requestPermission({ mode: 'read' });
      if (p !== 'granted') {
        toast('The backup file wasn’t allowed, so it couldn’t be read');
        return false;
      }
      const file = await f.getFile();
      // the same path as Load backup: checks, the campaign question, the restore point
      $('importFile').onchange({ target: { files: [file], value: '' } });
      return false; // the import ends the hold when it succeeds
    } catch (e) {
      toast('Couldn’t read the backup file. Try Load a backup file instead');
      return false;
    }
  }
  async function startFresh() {
    ERASE_KEEP_DAMAGED = true;
    RECOVERY_HOLD = false;
    await eraseAll(true, false);
    return true;
  }
  function askPersist() {
    try {
      if (SAFE.persisted !== true && navigator.storage && navigator.storage.persist)
        navigator.storage
          .persist()
          .then((p) => (SAFE.persisted = p))
          .catch(() => {});
    } catch (e) {}
  }
  function drawSaveState() {
    const B = BK();
    if (B) B.drawStatus();
  }
  /* backup file: Chrome and Edge on a computer can keep one file updated as you play */
  let fileBusy = false;
  async function writeFile(loud) {
    if (!SAFE.file || SAFE.filePaused || !S || S.example || TAB_STALE || RECOVERY_HOLD) return;
    if (fileBusy) {
      SAFE.fileAgain = true;
      return;
    }
    fileBusy = true;
    clearTimeout(SAFE.fileT);
    SAFE.fileT = 0;
    SAFE.fileFirst = 0;
    try {
      const w = await SAFE.file.createWritable();
      await w.write(backupJSON());
      await w.close();
      SAFE.fileAt = Date.now();
      SAFE.fileErr = false;
      tx(['kv'], 'readwrite', (st) => {
        st('kv').put(SAFE.fileAt, 'fileAt');
      }).catch(() => {});
      if (S.dm.lastBackup !== today()) {
        S.dm.lastBackup = today();
        if (!dirty) {
          lastJSON = JSON.stringify(S);
          try {
            localStorage.setItem(KEY, lastJSON);
          } catch (e) {}
        }
      }
      clearBar('remind');
      if (loud) toast(`Backup file ${SAFE.file.name} updated`);
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) pauseFile();
      else {
        SAFE.fileErr = true;
        if (loud) toast('Couldn’t write the backup file. Choose it again in Campaign → Data');
      }
    }
    fileBusy = false;
    refreshDataView();
    drawSaveState();
    if (warnedFull === 'full') saveWarn(true, 'full');
    if (SAFE.fileAgain) {
      SAFE.fileAgain = false;
      writeFile();
    }
  }
  function pauseFile() {
    SAFE.filePaused = true;
    drawSaveState();
    bar('file', `Your backup file ${SAFE.file.name} isn’t being updated until you allow it.`, [
      ['Allow', resumeFile],
      ['Not now', () => clearBar('file')],
    ]);
  }
  async function resumeFile() {
    if (!SAFE.file) return;
    try {
      const p = await SAFE.file.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') {
        SAFE.filePaused = false;
        clearBar('file');
        await writeFile(true);
      } else toast('The backup file wasn’t allowed, so it isn’t being updated');
    } catch (e) {
      toast('Couldn’t reach the backup file. Choose it again in Campaign → Data');
    }
    refreshDataView();
    drawSaveState();
  }
  async function linkFile() {
    let h;
    try {
      h = await window.showSaveFilePicker({
        suggestedName: 'dm-board-backup.json',
        types: [{ description: 'Board backup', accept: { 'application/json': ['.json'] } }],
      });
    } catch (e) {
      if (!e || e.name !== 'AbortError')
        toast('This browser won’t let the board keep a backup file here. Use Save backup instead');
      return;
    }
    SAFE.file = h;
    SAFE.filePaused = false;
    SAFE.fileErr = false;
    try {
      await tx(['kv'], 'readwrite', (st) => {
        st('kv').put(h, 'file');
      });
    } catch (e) {}
    await writeFile(true);
    askPersist();
    refreshDataView();
  }
  async function unlinkFile() {
    SAFE.file = null;
    SAFE.filePaused = false;
    clearBar('file');
    try {
      await tx(['kv'], 'readwrite', (st) => {
        st('kv').delete('file');
      });
    } catch (e) {}
    refreshDataView();
    drawSaveState();
    toast('The backup file won’t be updated any more. The file itself is kept');
  }
  async function fileInit() {
    if (FS_OK) {
      try {
        const [h, at] = await tx(['kv'], 'readonly', (st) =>
          Promise.all([rq(st('kv').get('file')), rq(st('kv').get('fileAt'))])
        );
        SAFE.file = h || null;
        SAFE.fileAt = at || 0;
      } catch (e) {}
      if (SAFE.file) {
        let p = 'denied';
        try {
          p = await SAFE.file.queryPermission({ mode: 'readwrite' });
        } catch (e) {}
        if (p === 'granted') writeFile();
        else pauseFile();
      }
    }
    withBK(() => remindBackup('load'));
    refreshDataView();
    drawSaveState();
  }
  async function shareBackup() {
    const f = new File([backupJSON()], `dm-board-${today()}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try {
        await navigator.share({ files: [f], title: 'DM board backup' });
        S.dm.lastBackup = today();
        save();
        clearBar('remind');
        refreshDataView();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    exportData();
  }
  /* one quiet bar at a time, most important first */
  const BARS = {},
    BAR_ORDER = ['tab', 'lost', 'file', 'remind'];
  function bar(kind, text, btns) {
    BARS[kind] = { text, btns };
    drawBar();
  }
  function clearBar(kind) {
    delete BARS[kind];
    drawBar();
  }
  function drawBar() {
    let el = $('safebar');
    const k = BAR_ORDER.find((x) => BARS[x]);
    if (!k) {
      el && el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'safebar';
      el.className = 'safebar';
      el.setAttribute('role', 'status');
      const w = $('party') && $('party').closest('.wrap');
      w ? w.prepend(el) : document.body.prepend(el);
    }
    const b = BARS[k];
    el.dataset.kind = k;
    el.innerHTML = `<span>${esc(b.text)}</span><span class="sfbtns">${b.btns.map((x, i) => `<button class="btn sm${i ? ' ghost' : ' pri'}" type="button" data-sb="${i}">${esc(x[0])}</button>`).join('')}</span>`;
    el.querySelectorAll('[data-sb]').forEach((x) => (x.onclick = () => b.btns[+x.dataset.sb][1]()));
  }
  const BK = () => window.DMB_BACKUP || null;
  // js/backup.js loads after this file: run f once it's there (at once, or on DOMContentLoaded)
  function withBK(f) {
    if (BK()) return f(BK());
    addEventListener('DOMContentLoaded', () => BK() && f(BK()), { once: true });
  }
  // reason: 'load' (every N days) or 'wrap' (after a session ends, unless a backup was made today)
  function remindBackup(reason) {
    if (RECOVERY_HOLD) return false;
    const B = BK();
    if (!B) return false;
    return B.remind(
      {
        S: () => S,
        SAFE,
        KEY,
        FS_OK,
        hasBoard,
        backupAge,
        today,
        bar,
        clearBar,
        exportData,
        toast,
      },
      reason || 'load'
    );
  }
  function refreshDataView() {
    try {
      if (view && view.sec === 'campaign' && view.sub === 'data') drawSheet();
    } catch (e) {}
  }
  const IS_SAFARI = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);
  const IS_IOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE =
    navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  function safetyHTML() {
    const snaps = SAFE.snaps,
      show = snaps ? snaps.slice(0, SAFE.all ? snaps.length : 6) : [];
    const rows =
      snaps == null
        ? '<p class="sfmuted">Looking for restore points…</p>'
        : !snaps.length
          ? '<p class="sfmuted">None yet. The first one is made shortly after you change something.</p>'
          : `<div class="sflist">${show.map((m) => `<div class="sfrow"><div class="sfwhat"><strong>${esc(fmtAt(m.at))}</strong><small>${esc([SNAP_LABEL[m.label] || m.label, 'Session ' + m.session, plural(m.players, 'player')].join(' · '))}</small></div><button class="btn sm ghost" type="button" data-snapdl="${m.at}" title="Download as a backup file">Download</button><button class="btn sm" type="button" data-snap="${m.at}">Restore</button></div>`).join('')}</div>${snaps.length > show.length ? `<button class="btn sm ghost" type="button" id="snapAll">Show all ${snaps.length}</button>` : ''}`;
    const f = SAFE.file;
    const file = FS_OK
      ? f
        ? `<p style="margin:0">Keeping <strong>${esc(f.name)}</strong> up to date. ${SAFE.filePaused ? 'Paused until you allow it.' : SAFE.fileErr ? 'The last update failed.' : SAFE.fileAt ? `Updated ${esc(fmtAt(SAFE.fileAt))}.` : ''}</p>
      <div class="row">${SAFE.filePaused || SAFE.fileErr ? '<button class="btn sm pri" type="button" id="fileResume">Allow updates</button>' : ''}<button class="btn sm ghost" type="button" id="fileLink">Choose another file</button><button class="btn sm ghost" type="button" id="fileStop">Stop updating</button></div>`
        : `<p style="margin:0;color:var(--ink-2)">Pick a file once and the board rewrites it a few seconds after every change. Put it in iCloud Drive, Dropbox or Google Drive and it’s also copied off this computer, where your phone can load it.</p><div class="row"><button class="btn sm pri" type="button" id="fileLink">Choose backup file</button></div>`
      : `<p style="margin:0;color:var(--ink-2)">This browser can’t keep a backup file updated by itself (Chrome and Edge on a computer can), so save a backup at the end of every session.</p>`;
    const where =
      SAFE.persisted === true
        ? 'This browser has agreed not to clear the board on its own.'
        : SAFE.persisted === false
          ? 'This browser may clear the board if the device runs short of space, so keep backups.'
          : '';
    const tip =
      IS_IOS && !STANDALONE
        ? 'On iPhone and iPad, Safari erases a site’s data after 7 days without a visit. Add the board to your Home Screen (Share → Add to Home Screen) and always open it from there. The Home Screen copy has its own storage, so move your board across with Save backup and Load backup once.'
        : IS_SAFARI && !STANDALONE
          ? 'Safari erases a site’s data after 7 days without a visit. Keep backups, or use Chrome or Edge with a backup file.'
          : '';
    const B = BK(),
      pf = B ? B.prefs() : { remind: true, days: 7, keepUndo: true };
    const undoLine = pf.keepUndo
      ? SAFE.undoTooBig
        ? 'The board is too big to keep undo steps after a reload, so undo works until you close it.'
        : `Undo keeps your last ${SAFE.undoN || UNDO.length ? Math.min(UNDO_MAX, Math.max(SAFE.undoN || 0, UNDO.length)) : UNDO_MAX} changes, even after a reload.`
      : 'Undo works until you close the board.';
    const undoBox = `<p style="margin:0;color:var(--ink-2)" id="undoLine">${esc(undoLine)}</p>
    <label class="toggles" style="display:flex"><label><input type="checkbox" id="keepUndo"${pf.keepUndo ? ' checked' : ''}>Keep undo history after closing the board</label></label>
    <p class="sfmuted" style="margin:0">Deleted text can be undone for up to 20 changes; untick on a shared computer.</p>
    <div class="row"><button class="btn sm ghost" type="button" id="undoClr">Clear undo history</button></div>`;
    const remindBox = `<div class="box" id="remindBox"><h4>Reminders</h4><label class="toggles" style="display:flex"><label><input type="checkbox" id="remOn"${pf.remind ? ' checked' : ''}>Remind me to save a backup every</label></label>
    <select id="remDays" aria-label="Days between backup reminders"${pf.remind ? '' : ' disabled'}>${(B ? B.DAYS : [3, 7, 14, 30]).map((d) => `<option value="${d}"${d === pf.days ? ' selected' : ''}>${d} days</option>`).join('')}</select>
    <p class="sfmuted" style="margin:0">Also after every Wrap up, unless you saved a backup that day or the backup file is up to date.</p></div>`;
    const dmg = damagedKeys();
    const dmgBox = dmg.length
      ? `<div class="box" id="dmgBox"><h4>Damaged copies</h4><p style="margin:0;color:var(--ink-2)">Saved boards that couldn’t be read, kept so nothing is lost.</p><div class="sflist">${dmg
          .map((k) => {
            const at = +k.slice(DMG_PFX.length);
            return `<div class="sfrow"><div class="sfwhat"><strong>${esc(at ? fmtAt(at) : 'Older copy')}</strong></div><button class="btn sm ghost" type="button" data-dmgdl="${esc(k)}">Download</button><button class="btn sm ghost" type="button" data-dmgdel="${esc(k)}">Delete</button></div>`;
          })
          .join('')}</div></div>`
      : '';
    return `<div class="box"><h4>Restore points</h4><p style="margin:0;color:var(--ink-2)">Kept automatically in this browser: when you open the board, every 10 minutes while you play, at the end of each session, and before loading a backup or clearing data.</p>${rows}${undoBox}</div>
  <div class="box"><h4>Backup file</h4>${file}</div>${remindBox}${dmgBox}
  ${where || tip ? `<div class="box"><h4>This browser</h4>${where ? `<p style="margin:0;color:var(--ink-2)">${where}</p>` : ''}${tip ? `<p style="margin:0;color:var(--ink-2)">${tip}</p>` : ''}</div>` : ''}`;
  }
  function safetyButtons() {
    return navigator.share ? '<button class="btn" type="button" id="shareB">Send to another device</button>' : '';
  }
  function bindSafety() {
    document
      .querySelectorAll('[data-snap]')
      .forEach((b) => armDelete(b, () => restoreSnap(+b.dataset.snap), 'Click again to restore'));
    document.querySelectorAll('[data-snapdl]').forEach((b) => (b.onclick = () => downloadSnap(+b.dataset.snapdl)));
    $('snapAll') &&
      ($('snapAll').onclick = () => {
        SAFE.all = true;
        drawSheet();
      });
    $('fileLink') && ($('fileLink').onclick = linkFile);
    $('fileResume') && ($('fileResume').onclick = resumeFile);
    $('fileStop') && armDelete($('fileStop'), unlinkFile, 'Click again to stop');
    $('shareB') && ($('shareB').onclick = shareBackup);
    const B = BK();
    if (!B) return;
    $('remOn').onchange = (e) => {
      B.setPrefs({ remind: e.target.checked });
      $('remDays').disabled = !e.target.checked;
    };
    $('remDays').onchange = (e) => B.setPrefs({ days: +e.target.value });
    $('keepUndo').onchange = (e) => {
      B.setPrefs({ keepUndo: e.target.checked });
      if (e.target.checked) schedUndo();
      else undoClear().then(refreshDataView);
    };
    $('undoClr').onclick = () => {
      UNDO = [];
      undoClear().then(refreshDataView);
      toast('Undo history cleared');
    };
    document.querySelectorAll('[data-dmgdl]').forEach(
      (b) =>
        (b.onclick = () => {
          let raw = '';
          try {
            raw = localStorage.getItem(b.dataset.dmgdl) || '';
          } catch (e) {}
          const at = +b.dataset.dmgdl.slice(DMG_PFX.length) || Date.now();
          downloadText(raw, `dm-board-damaged-${new Date(at).toISOString().slice(0, 10)}.txt`);
        })
    );
    document.querySelectorAll('[data-dmgdel]').forEach((b) =>
      armDelete(b, () => {
        try {
          localStorage.removeItem(b.dataset.dmgdel);
        } catch (e) {}
        refreshDataView();
      })
    );
  }
  function safetyInit() {
    // another tab or window saving the same board: warn before this one overwrites it
    addEventListener('storage', (e) => {
      if (e.key === KEY && e.newValue != null && e.newValue !== lastJSON) {
        if (!dirty && !view && !$('mcard') && !TAB_STALE && !RECOVERY_HOLD) {
          UNDO = [];
          undoClear();
          load();
          render();
          toast('Updated from your other tab');
          return;
        }
        TAB_STALE = true;
        bar(
          'tab',
          'This board was changed in another tab or window, so changes made here are no longer saved. Reload to pick up the latest board.',
          [['Reload', () => location.reload()]]
        );
      }
    });
    const j0 = lastJSON;
    const snapsP = tx(['list'], 'readonly', (st) => rq(st('list').getAll()))
      .then(async (l) => {
        SAFE.snaps = l.sort((a, b) => b.at - a.at);
        const latest = SAFE.snaps[0];
        if (latest) {
          SAFE.lastSnapAt = latest.at;
          try {
            SAFE.lastSnapJSON = (await readSnap(latest.at)).json;
          } catch (e) {}
        }
        if (loadMissing) {
          // no saved board: offer the newest of the last good copy and the latest restore point
          const g = await readLKG();
          if (g && (!latest || g.at > latest.at))
            bar('lost', `No saved board was found in this browser, but a copy from ${fmtAt(g.at)} was.`, [
              ['Restore it', restoreLKG],
              ['Not now', () => clearBar('lost')],
            ]);
          else if (latest)
            bar('lost', `No saved board was found in this browser, but a restore point from ${fmtAt(latest.at)} was.`, [
              ['Restore it', () => restoreSnap(latest.at)],
              ['Not now', () => clearBar('lost')],
            ]);
        } else if (!loadDamaged) setTimeout(() => takeSnap('Opened the board'), 1500);
        refreshDataView();
      })
      .catch((e) => {
        SAFE.snaps = [];
        console.warn('Restore points unavailable', e);
      });
    undoRestore(j0);
    const fileP = fileInit();
    setInterval(() => {
      if (SAFE.changed && Date.now() - SAFE.lastSnapAt >= 6e5) takeSnap('Auto');
    }, 3e4);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (SAFE.changed && Date.now() - SAFE.lastSnapAt >= 6e4) takeSnap('Auto');
        if (SAFE.file && SAFE.fileT) writeFile();
      }
    });
    try {
      navigator.storage &&
        navigator.storage.persisted &&
        navigator.storage
          .persisted()
          .then((p) => {
            SAFE.persisted = p;
            refreshDataView();
          })
          .catch(() => {});
    } catch (e) {}
    // a damaged save: once restore points, the last good copy and the backup file are known, ask what to do
    if (RECOVERY_HOLD) Promise.all([snapsP, fileP.catch(() => {})]).then(openRecovery);
    withBK((B) =>
      B.mountStatus({
        SAFE,
        hold: () => RECOVERY_HOLD,
        stale: () => TAB_STALE,
        full: () => warnedFull,
        backupAge,
        fmtAt,
        openData: () => openSheet('campaign', 'data'),
      })
    );
    // when hosted on a web address, sw.js (next to index.html) lets it open with no connection
    if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator)
      navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  /* ---------- more than one campaign ---------- */
  // Storage is split per campaign by the shim at the top of the page (window.DMC), so the
  // rest of the board keeps using KEY, localStorage and IndexedDB as before. This part adds
  // the Campaigns tab, tags backups with their campaign, and makes Erase all data and
  // Load backup aware of other campaigns.
  const CAMP = window.DMC && window.DMC.ok ? window.DMC : null;
  const CAMP_DO = 'dm-board-campaign-do';
  let campEdit = null;
  const campLabel = (n) => String(n || '').trim() || 'Untitled campaign';
  // tells js/campaign-switcher.js (and anything else) that the campaign list or the open campaign changed
  const campFire = () => {
    try {
      window.dispatchEvent(new CustomEvent('dmb:campaigns'));
    } catch (e) {}
  };
  function campSync() {
    if (!CAMP || !S || S.example || TAB_STALE || RECOVERY_HOLD) return;
    const r = CAMP.reg(),
      c = CAMP.find(r, CAMP.id),
      n = S.dm.campaign || '';
    if (c && !c.del && c.name !== n) {
      c.name = n;
      CAMP.writeReg(r);
      campFire();
    }
  }
  // what another campaign holds, read straight from storage
  function campPeek(cid) {
    if (cid === CAMP.id)
      return {
        name: S.dm.campaign || '',
        session: S.dm.session,
        players: (S.players || []).length,
        size: campSize(cid),
      };
    let d = null;
    try {
      d = JSON.parse(CAMP.raw.ls.getItem(CAMP.mapKey(KEY, cid)));
    } catch (e) {}
    const dm = (d && d.dm) || {};
    return {
      name: typeof dm.campaign === 'string' ? dm.campaign : null,
      session: dm.session,
      players: d && Array.isArray(d.players) ? d.players.length : 0,
      size: campSize(cid),
    };
  }
  function campSize(cid) {
    let n = 0;
    CAMP.ownRaw(cid).forEach((k) => {
      n += k.length + (CAMP.raw.ls.getItem(k) || '').length;
    });
    return n * 2;
  }
  const campKB = (b) => (b < 1e6 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  async function campOpen(cid, flag) {
    clearTimeout(saveTimer);
    if (dirty && !TAB_STALE) save();
    if (SAFE.file && !SAFE.filePaused && SAFE.fileT && !TAB_STALE) {
      try {
        await writeFile();
      } catch (e) {}
    }
    const r = CAMP.reg(),
      c = CAMP.find(r, cid);
    if (!c) return;
    r.active = cid;
    c.used = Date.now();
    c.del = 0;
    CAMP.writeReg(r);
    try {
      CAMP.raw.ss.setItem(CAMP.PIN, cid);
      if (flag) CAMP.raw.ss.setItem(CAMP_DO, JSON.stringify(Object.assign({ id: cid }, flag)));
    } catch (e) {}
    campFire();
    location.reload();
  }
  // x (from the new-campaign wizard): { dm: DM name, players: [{ name, cls, level }], ddb: open the import after }
  function campNew(name, demo, x) {
    x = x || {};
    if (dirty && !TAB_STALE) save();
    const r = CAMP.reg(),
      cid = 'c' + r.next;
    r.next++;
    const dmName = x.dm != null ? String(x.dm).trim().slice(0, 80) : S.dm.name || '';
    const blank = { example: false, dm: { campaign: name, session: 1, name: dmName }, players: [] };
    if (!demo && Array.isArray(x.players))
      blank.players = x.players.map((p) => {
        const lv = clamp(+p.level || 1, 1, 20);
        return { id: uid(), name: String(p.name || '').slice(0, 80), cls: p.cls, level: lv, maxHp: 10, hp: 10 };
      });
    try {
      CAMP.raw.ls.setItem(CAMP.mapKey(KEY, cid), JSON.stringify(blank));
    } catch (e) {
      toast('Browser storage is full, so a new campaign can’t be made. Delete an old campaign or map images first');
      return false;
    }
    r.list.push({ id: cid, name, at: Date.now(), used: Date.now(), del: 0 });
    CAMP.writeReg(r);
    const wiz = x.wiz ? { wiz: 1, ddb: x.ddb ? 1 : 0 } : {};
    campOpen(cid, Object.assign(demo ? { demo: 1, name, dm: x.dm != null ? dmName : undefined } : { fresh: 1 }, wiz));
    return true;
  }
  function campCopyKeys(from, to, rename) {
    const done = [];
    try {
      CAMP.ownRaw(from).forEach((k) => {
        const u = CAMP.unmapKey(k, from);
        if (u === undefined) return;
        let v = CAMP.raw.ls.getItem(k);
        if (u === KEY && rename != null) {
          try {
            const d = JSON.parse(v);
            d.dm = d.dm || {};
            d.dm.campaign = rename;
            v = JSON.stringify(d);
          } catch (e) {}
        }
        const nk = CAMP.mapKey(u, to);
        CAMP.raw.ls.setItem(nk, v);
        done.push(nk);
      });
      return true;
    } catch (e) {
      done.forEach((k) => {
        try {
          CAMP.raw.ls.removeItem(k);
        } catch (e2) {}
      });
      return false;
    }
  }
  function campDuplicate(cid) {
    if (cid === CAMP.id) {
      clearTimeout(saveTimer);
      if (dirty && !TAB_STALE) save();
    }
    const r = CAMP.reg(),
      src = CAMP.find(r, cid);
    if (!src) return;
    const nm = campLabel(cid === CAMP.id ? S.dm.campaign : src.name) + ' (copy)',
      nid = 'c' + r.next;
    if (!campCopyKeys(cid, nid, nm)) {
      toast('Browser storage is full, so this campaign couldn’t be copied');
      return;
    }
    r.next++;
    r.list.push({ id: nid, name: nm, at: Date.now(), used: 0, del: 0 });
    CAMP.writeReg(r);
    drawSheet();
    campFire();
    toast(`Copied as ${nm}. The copy starts with no restore points of its own`);
  }
  function campRename(cid, name) {
    name = String(name || '')
      .trim()
      .slice(0, 120);
    if (cid === CAMP.id) {
      S.dm.campaign = name;
      commit();
      campSync();
      toast('Renamed');
      return;
    }
    const k = CAMP.mapKey(KEY, cid);
    try {
      const d = JSON.parse(CAMP.raw.ls.getItem(k));
      if (d && typeof d === 'object') {
        d.dm = d.dm && typeof d.dm === 'object' ? d.dm : {};
        d.dm.campaign = name;
        CAMP.raw.ls.setItem(k, JSON.stringify(d));
      }
    } catch (e) {}
    const r = CAMP.reg(),
      c = CAMP.find(r, cid);
    if (c) {
      c.name = name;
      CAMP.writeReg(r);
    }
    campFire();
    toast('Renamed');
  }
  // a restore point written into another campaign's own store, the same shape data safety uses
  function campIdb(cid) {
    return new Promise((a, b) => {
      let q;
      try {
        q = CAMP.raw.open(CAMP.dbName('dm-board-safety', cid));
      } catch (e) {
        return b(e);
      }
      q.onupgradeneeded = () => {
        const d = q.result;
        ['snaps', 'list', 'imgs', 'kv'].forEach((n) => {
          if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
        });
      };
      q.onsuccess = () => a(q.result);
      q.onerror = () => b(q.error);
      q.onblocked = () => b(new Error('blocked'));
    });
  }
  async function campSnapOther(cid, label) {
    const json = CAMP.raw.ls.getItem(CAMP.mapKey(KEY, cid));
    if (!json) return false;
    let d;
    try {
      d = JSON.parse(json);
    } catch (e) {
      return false;
    }
    if (!d || d.example) return false;
    let im = {};
    try {
      im = JSON.parse(CAMP.raw.ls.getItem(CAMP.mapKey(KEY + '-img', cid)) || '{}') || {};
    } catch (e) {}
    const ids = Object.keys(im).filter((k) => typeof im[k] === 'string'),
      at = Date.now(),
      dm = d.dm || {};
    const meta = {
      at,
      label,
      campaign: dm.campaign || '',
      session: dm.session,
      players: (d.players || []).length,
      size: json.length,
      imgs: ids,
    };
    let db;
    try {
      db = await campIdb(cid);
    } catch (e) {
      return false;
    }
    try {
      await new Promise((a, b) => {
        const t = db.transaction(['snaps', 'list', 'imgs'], 'readwrite');
        t.objectStore('snaps').put(json, at);
        t.objectStore('list').put(meta, at);
        ids.forEach((k) => t.objectStore('imgs').put(im[k], k));
        t.oncomplete = a;
        t.onerror = t.onabort = () => b(t.error);
      });
      return true;
    } catch (e) {
      return false;
    } finally {
      db.close();
    }
  }
  async function campDropDbs(cid) {
    let names = ['dm-board-safety'];
    try {
      const l = await CAMP.raw.dbs();
      if (Array.isArray(l))
        names = [
          ...new Set(
            names.concat(
              l
                .map((x) => x && x.name)
                .filter(
                  (n) =>
                    typeof n === 'string' &&
                    n.indexOf('dm-board') === 0 &&
                    (cid === 'c1' ? !/~c\d+$/.test(n) : n.endsWith('~' + cid))
                )
                .map((n) => (cid === 'c1' ? n : n.slice(0, -(cid.length + 1))))
            )
          ),
        ];
    } catch (e) {}
    await Promise.all(
      names.map(
        (n) =>
          new Promise((a) => {
            try {
              const q = CAMP.raw.del(CAMP.dbName(n, cid));
              q.onsuccess = q.onerror = q.onblocked = () => a();
            } catch (e) {
              a();
            }
          })
      )
    );
  }
  function campDropKeys(cid) {
    CAMP.ownRaw(cid).forEach((k) => {
      try {
        CAMP.raw.ls.removeItem(k);
      } catch (e) {}
    });
    if (CAMP.raw.ss)
      CAMP.ownRaw(cid, CAMP.raw.ss).forEach((k) => {
        try {
          CAMP.raw.ss.removeItem(k);
        } catch (e) {}
      });
  }
  async function campDelete(cid) {
    if (cid === CAMP.id) return;
    await campSnapOther(cid, 'Before deleting this campaign');
    campDropKeys(cid);
    const r = CAMP.reg(),
      c = CAMP.find(r, cid);
    if (c) {
      c.del = Date.now();
      if (r.active === cid) r.active = CAMP.id;
    }
    CAMP.writeReg(r);
    drawSheet();
    campFire();
    toast(`${campLabel(c && c.name)} deleted. Bring it back from Recently deleted`);
  }
  async function campForget(cid) {
    if (cid === CAMP.id) return;
    campDropKeys(cid);
    await campDropDbs(cid);
    const r = CAMP.reg();
    r.list = r.list.filter((c) => c.id !== cid);
    if (cid === 'c1') r.c1gone = 1;
    CAMP.writeReg(r);
    drawSheet();
    campFire();
    toast('Erased for good');
  }
  // Erase all data → Every campaign: the others go too (kept as Recently deleted when restore points are kept)
  async function campEraseOthers(keep) {
    const r = CAMP.reg();
    for (const c of r.list.filter((c) => c.id !== CAMP.id)) {
      if (keep) {
        if (!c.del) {
          await campSnapOther(c.id, 'Before erasing all data');
          c.del = Date.now();
        }
        campDropKeys(c.id);
      } else {
        campDropKeys(c.id);
        await campDropDbs(c.id);
        c.gone = 1;
      }
    }
    if (!keep) {
      if (r.list.some((c) => c.gone && c.id === 'c1')) r.c1gone = 1;
      r.list = r.list.filter((c) => !c.gone);
    }
    r.active = CAMP.id;
    CAMP.writeReg(r);
  }
  function askCampDelete(cid) {
    const c = CAMP.find(CAMP.reg(), cid);
    if (!c) return;
    const nm = campLabel(c.name),
      p = campPeek(cid);
    const el = popup(
      'Delete campaign',
      popHead(
        `Delete ${nm}?`,
        `Removes its ${plural(p.players, 'player')}, battles, notes and everything else from this browser. A restore point is kept first, so you can bring it back from Recently deleted. Other campaigns aren’t touched.`
      ) +
        `
    <label class="f">Type the campaign’s name to confirm<input type="text" id="cdText" autocomplete="off" spellcheck="false" maxlength="120" placeholder="${esc(nm)}"></label>
    <div class="row end"><button class="btn ghost" type="button" data-mclose id="cdNo">Cancel</button><button class="btn danger" type="button" id="cdGo" disabled>Delete campaign</button></div>`
    );
    const t = el.querySelector('#cdText'),
      go = el.querySelector('#cdGo');
    t.oninput = () => {
      go.disabled = t.value.trim().toLowerCase() !== nm.trim().toLowerCase();
    };
    t.onkeydown = (e) => {
      if (e.key === 'Enter' && !go.disabled) go.click();
    };
    go.onclick = async () => {
      go.disabled = true;
      await campDelete(cid);
      el.remove();
    };
    t.focus();
  }
  if (CAMP) {
    SECTIONS.campaign.subs = ((f) => () => {
      const n = CAMP.live().length;
      return [...f(), ['camps', 'Campaigns', n > 1 ? n : '']];
    })(SECTIONS.campaign.subs);
    const _save = save;
    save = function () {
      const out = _save.apply(this, arguments);
      campSync();
      return out;
    };
    // a backup says which campaign it came from
    const _bj = backupJSON;
    backupJSON = function () {
      const s = _bj.apply(this, arguments);
      const m = JSON.stringify({ id: CAMP.id, name: S.dm.campaign || '' });
      return s.replace(/^\{\s*"_meta":\s*\{/, (x) => x + '\n    "campaign": ' + m + ',');
    };
    // loading another campaign's backup asks first, so it can't land in the wrong campaign unnoticed
    const inp = $('importFile'),
      _oc = inp.onchange;
    inp.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      inp.value = '';
      const ev = { target: { files: [f], value: '' } };
      if (CAMP.live().length < 2) return _oc.call(inp, ev);
      const rd = new FileReader();
      rd.onload = () => {
        let m = null;
        try {
          const d = JSON.parse(rd.result);
          m = d && d._meta && d._meta.campaign;
        } catch (x) {}
        if (!m || typeof m !== 'object' || !m.id || m.id === CAMP.id) return _oc.call(inp, ev);
        const here = campLabel(S.dm.campaign),
          there = campLabel(m.name),
          other = CAMP.find(CAMP.reg(), m.id);
        const el = popup(
          'Backup from another campaign',
          popHead(
            'This backup is from another campaign',
            `It was saved from <strong>${esc(there)}</strong>. Loading it here replaces <strong>${esc(here)}</strong>.${other && !other.del ? ` To load it into ${esc(there)}, open that campaign in Campaign → Campaigns first.` : ''}`
          ) +
            `
        <div class="row end"><button class="btn ghost" type="button" data-mclose id="cbNo">Cancel</button><button class="btn danger" type="button" id="cbGo">Replace ${esc(here)}</button></div>`
        );
        el.querySelector('#cbNo').focus();
        el.querySelector('#cbGo').onclick = () => {
          el.remove();
          _oc.call(inp, ev);
        };
      };
      rd.readAsText(f);
    };
    // Erase all data asks: this campaign, or every campaign
    const _ae = askErase;
    askErase = function () {
      _ae.apply(this, arguments);
      const mc = $('mcard'),
        L = CAMP.live();
      if (!mc || L.length < 2) return;
      const lab = mc.querySelector('#erText') && mc.querySelector('#erText').closest('label');
      if (!lab) return;
      const nm = campLabel(S.dm.campaign),
        hp = mc.querySelector('.mhead p'),
        go = mc.querySelector('#erGo'),
        txt0 = hp ? hp.innerHTML : '';
      const w = document.createElement('div');
      w.className = 'toggles';
      w.style.display = 'flex';
      w.setAttribute('role', 'radiogroup');
      w.setAttribute('aria-label', 'What to erase');
      w.innerHTML = `<label><input type="radio" name="erWhich" id="erOne" value="one" checked>Only ${esc(nm)}</label><label><input type="radio" name="erWhich" id="erAll" value="all">Every campaign (${L.length})</label>`;
      lab.before(w);
      const upd = () => {
        const all = mc.querySelector('#erAll').checked;
        if (hp)
          hp.innerHTML = all
            ? `Deletes all ${L.length} campaigns in this browser, then starts you on one empty board. Your light or dark theme is kept.`
            : txt0.replace('Deletes every', 'Deletes ' + esc(nm) + '’s') + ' Other campaigns aren’t touched.';
        if (go) go.textContent = all ? 'Erase every campaign' : 'Erase this campaign';
      };
      w.querySelectorAll('input').forEach((x) => (x.onchange = upd));
      upd();
    };
    const _ea = eraseAll;
    eraseAll = async function (keep, all) {
      if (all === undefined) all = !!document.querySelector('#mcard #erAll:checked');
      if (all) await campEraseOthers(keep);
      else if (CAMP.live().length > 1) {
        const c = CAMP.find(CAMP.reg(), CAMP.id);
        ERASE_NAME = S.dm.campaign || (c && c.name) || '';
      }
      return _ea.call(this, keep);
    };
    // the Data tab says whose backups these are
    const _dv = VIEWS.campaign.data;
    VIEWS.campaign.data = function () {
      const v = _dv.apply(this, arguments);
      if (CAMP.live().length > 1 && v && typeof v.html === 'string')
        v.html = v.html.replace(
          '<div class="box">',
          `<p class="sfmuted" id="campDataNote" style="margin:0">Backups, restore points and the backup file here belong to <strong>${esc(campLabel(S.dm.campaign))}</strong> only. Each campaign keeps its own.</p><div class="box">`
        );
      return v;
    };
    // another tab deleting this campaign stops this one from writing it back
    CAMP.addRaw('storage', (e) => {
      if (e.key !== CAMP.REG && e.key !== null) return;
      const c = CAMP.find(CAMP.reg(), CAMP.id);
      if ((!c || c.del) && !TAB_STALE) {
        TAB_STALE = true;
        bar('tab', 'This campaign was deleted in another tab, so changes made here are no longer saved.', [
          ['Reload', () => location.reload()],
        ]);
      }
      if (view && view.sec === 'campaign' && view.sub === 'camps' && !$('mcard')) drawSheet();
    });
  }
  VIEWS.campaign.camps = () => {
    if (!CAMP)
      return {
        html:
          head('Campaigns') +
          '<div class="box"><p style="margin:0;color:var(--ink-2)">This browser can’t keep separate campaigns, so the board holds one. Use Save backup and Load backup to swap between campaigns.</p></div>',
      };
    const r = CAMP.reg(),
      L = r.list.filter((c) => !c.del),
      D = r.list.filter((c) => c.del);
    let total = 0;
    const rows = L.map((c) => {
      const cur = c.id === CAMP.id,
        p = campPeek(c.id),
        nm = campLabel(cur ? S.dm.campaign : p.name != null ? p.name : c.name);
      total += p.size;
      const bits = [
        cur ? 'Open now' : c.used ? 'Last opened ' + fmtAt(c.used) : 'Not opened yet',
        p.session ? 'Session ' + p.session : '',
        plural(p.players, 'player'),
        campKB(p.size),
      ].filter(Boolean);
      if (campEdit === c.id)
        return `<div class="sfrow" data-camprow="${c.id}"><label class="f" style="flex:1">Name<input type="text" id="cpRen" maxlength="120" value="${esc(cur ? S.dm.campaign : p.name != null ? p.name : c.name)}"></label><button class="btn sm ghost" type="button" id="cpRenNo">Cancel</button><button class="btn sm pri" type="button" id="cpRenGo">Save</button></div>`;
      return `<div class="sfrow" data-camprow="${c.id}"><div class="sfwhat"><strong>${esc(nm)}</strong><small>${esc(bits.join(' · '))}</small></div>
      ${cur ? '' : `<button class="btn sm pri" type="button" data-cpopen="${c.id}">Open</button>`}<button class="btn sm ghost" type="button" data-cpren="${c.id}">Rename</button><button class="btn sm ghost" type="button" data-cpdup="${c.id}">Duplicate</button>${cur ? '' : `<button class="btn sm ghost" type="button" data-cpdel="${c.id}">Delete</button>`}</div>`;
    }).join('');
    const gone = D.length
      ? `<div class="box"><h4>Recently deleted</h4><p style="margin:0;color:var(--ink-2)">Deleted campaigns keep their restore points in this browser until you erase them for good.</p><div class="sflist">${D.map((c) => `<div class="sfrow"><div class="sfwhat"><strong>${esc(campLabel(c.name))}</strong><small>Deleted ${esc(fmtAt(c.del))}</small></div><button class="btn sm" type="button" data-cpback="${c.id}">Bring back</button><button class="btn sm ghost" type="button" data-cpforget="${c.id}">Erase for good</button></div>`).join('')}</div></div>`
      : '';
    return {
      html:
        head(
          'Campaigns',
          'Each campaign has its own players, battles, notes, restore points and backup file. Your theme and mood are shared.'
        ) +
        `
  <div class="box"><h4>Your campaigns</h4><div class="sflist" id="campList">${rows}</div>
    <p class="sfmuted" style="margin:0">All campaigns share this browser’s storage, about 5 MB in most browsers. They use ${campKB(total)} now.</p></div>
  <div class="box"><h4>New campaign</h4><p style="margin:0;color:var(--ink-2)">Name it, add your players and choose a blank board or the demo, in three short steps.</p>
    <div class="row"><button class="btn pri" type="button" id="cpNew">New campaign…</button></div>
    <p style="margin:0;color:var(--ink-3);font-size:13px">The new campaign opens straight away. ${esc(campLabel(S.dm.campaign))} stays exactly as it is.</p></div>
  ${gone}`,
      bind: () => {
        const ov = $('overlay');
        ov.querySelectorAll('[data-cpopen]').forEach((b) => (b.onclick = () => campOpen(b.dataset.cpopen, {})));
        ov.querySelectorAll('[data-cpren]').forEach(
          (b) =>
            (b.onclick = () => {
              campEdit = b.dataset.cpren;
              drawSheet();
              const i = $('cpRen');
              i && (i.focus(), i.select());
            })
        );
        ov.querySelectorAll('[data-cpdup]').forEach((b) => (b.onclick = () => campDuplicate(b.dataset.cpdup)));
        ov.querySelectorAll('[data-cpdel]').forEach((b) => (b.onclick = () => askCampDelete(b.dataset.cpdel)));
        ov.querySelectorAll('[data-cpback]').forEach(
          (b) => (b.onclick = () => campOpen(b.dataset.cpback, { restore: 1 }))
        );
        ov.querySelectorAll('[data-cpforget]').forEach((b) =>
          armDelete(b, () => campForget(b.dataset.cpforget), 'Click again to erase')
        );
        if ($('cpRen')) {
          const go = () => {
            const cid = campEdit;
            campEdit = null;
            campRename(cid, val('cpRen'));
            drawSheet();
          };
          $('cpRenGo').onclick = go;
          $('cpRenNo').onclick = () => {
            campEdit = null;
            drawSheet();
          };
          $('cpRen').onkeydown = (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              campEdit = null;
              drawSheet();
            }
          };
        }
        $('cpNew').onclick = () => window.DMB_CAMP.openWizard({ source: 'sheet' });
      },
    };
  };
  // after a switch: start the new campaign with the demo, or bring a deleted one back from its restore point
  function campAfterLoad() {
    if (!CAMP) return;
    campSync();
    let f = null;
    try {
      f = JSON.parse(CAMP.raw.ss.getItem(CAMP_DO));
      CAMP.raw.ss.removeItem(CAMP_DO);
    } catch (e) {}
    if (!f || f.id !== CAMP.id) return;
    if (f.demo)
      setTimeout(async () => {
        await loadDemo();
        if (f.name || f.dm != null) {
          if (f.name) S.dm.campaign = f.name;
          if (f.dm != null) S.dm.name = String(f.dm).slice(0, 80);
          save();
          render();
        }
        campSync();
        campFire();
        toast(f.wiz ? `Campaign ${campLabel(S.dm.campaign)} started` : 'New campaign started with the demo data');
      }, 0);
    else if (f.restore) {
      let n = 0;
      const t = setInterval(async () => {
        if (SAFE.snaps == null && ++n < 100) return;
        clearInterval(t);
        if (SAFE.snaps && SAFE.snaps.length && !hasBoard()) {
          if (await restoreSnap(SAFE.snaps[0].at)) {
            campSync();
            toast(`${campLabel(S.dm.campaign)} is back`);
          }
        } else if (!hasBoard()) toast('No restore point was found for that campaign, so it starts empty');
      }, 100);
    } else if (f.fresh) {
      save();
      if (f.wiz) {
        toast(`Campaign ${campLabel(S.dm.campaign)} started`);
        if (f.ddb) setTimeout(campDdb, 0);
      } else toast(`${campLabel(S.dm.campaign)} is ready. Add your players to begin`);
    } else toast(`Opened ${campLabel(S.dm.campaign)}`);
  }
  // open the Player sheet at the D&D Beyond import (the wizard's "import after creating" choice)
  function campDdb() {
    openSheet('player', 'overview', null);
    setTimeout(() => {
      const dd = $('ddbD');
      if (dd) dd.open = true;
      const d = $('ddbId');
      d && d.focus();
    }, 60);
  }
  // A new board with nothing on it (getting started on a fresh, unnamed board) is set up in place instead of
  // leaving an empty "Untitled campaign" behind. Players go through normalize(), like playerSave().
  function campSetupHere(o) {
    const name = o.name;
    if (o.demo) {
      loadDemo().then(() => {
        S.dm.campaign = name;
        if (o.dm != null) S.dm.name = String(o.dm).trim().slice(0, 80);
        commit();
        campSync();
        campFire();
        toast(`Campaign ${campLabel(name)} started`);
      });
      return true;
    }
    pushUndo();
    S.dm.campaign = name;
    if (o.dm != null) S.dm.name = String(o.dm).trim().slice(0, 80);
    (o.players || []).forEach((p) =>
      S.players.push({
        id: uid(),
        name: String(p.name || '').slice(0, 80),
        cls: p.cls,
        level: p.level,
        maxHp: 10,
        hp: 10,
      })
    );
    normalize();
    commit();
    campSync();
    campFire();
    toast(`Campaign ${campLabel(name)} started`);
    if (o.ddb) setTimeout(campDdb, 0);
    return true;
  }
  /* window.DMB_CAMP: the campaign API for js/campaign-wizard.js and js/campaign-switcher.js
     list() → [{ id, name, current, updated? }]   current() → { id, name, isDemo }   open(id)
     openWizard({ source: 'header' | 'banner' | 'sheet' | 'getting-started' })   manage()
     create({ name, dm, players: [{ name, cls, level }], demo, ddb, here }) → true when it started (the wizard's)
     The 'dmb:campaigns' window event fires after a campaign is created, opened, renamed, copied or deleted. */
  window.DMB_CAMP = {
    list() {
      if (!CAMP) return [{ id: 'c1', name: campLabel(S.dm.campaign), current: true }];
      return CAMP.reg()
        .list.filter((c) => !c.del)
        .map((c) => {
          const cur = c.id === CAMP.id;
          let nm = c.name;
          if (cur) nm = S.dm.campaign;
          else
            try {
              const d = JSON.parse(CAMP.raw.ls.getItem(CAMP.mapKey(KEY, c.id)));
              if (d && d.dm && typeof d.dm.campaign === 'string') nm = d.dm.campaign;
            } catch (e) {}
          const o = { id: c.id, name: campLabel(nm), current: cur };
          if (c.used || c.at) o.updated = c.used || c.at;
          return o;
        });
    },
    current: () => ({ id: CAMP ? CAMP.id : 'c1', name: campLabel(S.dm.campaign), isDemo: !!S.example }),
    open(id) {
      if (!CAMP || id === CAMP.id) return;
      campOpen(id, {});
    },
    manage() {
      $('mcard') && $('mcard').remove();
      openSheet('campaign', 'camps');
    },
    // the getting-started step on an empty board sets that board up instead of making another campaign
    canSetupHere: () => !CAMP || (!S.example && !hasBoard() && !(S.dm.campaign || '').trim()),
    openWizard(opts) {
      opts = Object.assign({ source: 'header' }, opts);
      const W = window.DMB_WIZARD;
      if (!W || (!CAMP && !window.DMB_CAMP.canSetupHere())) return window.DMB_CAMP.manage();
      W.open(
        Object.assign({}, opts, {
          here: opts.source === 'getting-started' && window.DMB_CAMP.canSetupHere(),
          classes: CLASSES.slice(),
          currentName: campLabel(S.dm.campaign),
          dmName: S.dm.name || '',
          isDemo: !!S.example,
        })
      );
    },
    create(o) {
      o = o || {};
      const name = String(o.name || '')
        .trim()
        .slice(0, 120);
      if (!name) return false;
      const players = (Array.isArray(o.players) ? o.players : [])
        .map((p) => ({
          name: String((p && p.name) || '')
            .trim()
            .slice(0, 80),
          cls: CLASSES.includes(p && p.cls) ? p.cls : 'Fighter',
          level: clamp(Math.round(+(p && p.level)) || 1, 1, 20),
        }))
        .filter((p) => p.name)
        .slice(0, 20);
      const x = { name, dm: o.dm, players, demo: !!o.demo, ddb: !!o.ddb };
      if (o.here || !CAMP) return campSetupHere(x);
      return campNew(name, x.demo, Object.assign({ wiz: 1 }, x)) !== false;
    },
  };
  load();
  safetyInit();
  eraseToast();
  campAfterLoad();
  applyTheme(getTheme());
  $('themeBtn').onclick = () => {
    const t = THEMES[(THEMES.indexOf(getTheme()) + 1) % 3];
    try {
      localStorage.setItem('dm-board-theme', t);
    } catch (e) {}
    applyTheme(t);
    if (!$('themeBtn').title.includes('device')) toast(t === 'light' ? 'Light theme' : 'Dark theme');
    else toast('Theme follows your device');
  };
  window.addEventListener('storage', (e) => {
    if (e.key === 'dm-board-theme') applyTheme(getTheme());
  });
  render();
})();
