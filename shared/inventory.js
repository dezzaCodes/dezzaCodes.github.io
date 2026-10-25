// Shared script for the inventory pages (flower-inventory/, juju-inventory/).
(() => {
// Each page sets window.INVENTORY (its nouns and column settings) and holds its sheet rows in #sheet-data.
const CFG = window.INVENTORY;
const DATA = JSON.parse(document.getElementById('sheet-data').textContent);
// Sentence case: capitalise the first letter of each line, keep the rest, and keep place names capitalised.
const PROPER = ['Hong Kong', 'New York', 'Abu Dhabi'];
const PROPER_RE = new RegExp('\\b(' + PROPER.map(p => p.replace(/ /g, '\\s+')).join('|') + ')\\b', 'gi');
const sentence = s => s.split('\n').map(l => {
  l = l.trim();
  l = l.charAt(0).toUpperCase() + l.slice(1);
  return l.replace(PROPER_RE, m => PROPER.find(p => p.toLowerCase() === m.toLowerCase().replace(/\s+/g, ' ')) || m);
}).join('\n');
// The Added column: the sheet's own date column (e.g. "purchased" or "date added") where it has a date, otherwise
// the date the sync first saw the row ("added" in the data). It takes the sheet column's name, and the sheet
// column itself isn't shown separately. Page settings refer to it as "added".
const TRACKED = Array.isArray(DATA.added) && DATA.added.length === DATA.rows.length ? DATA.added : null;
const DATE_NAMES = ['purchased', 'purchase date', 'date purchased', 'bought', 'date bought', 'date added', 'added'];
const DATE_ADDED_C = DATA.columns.findIndex(c => DATE_NAMES.includes(String(c).trim().toLowerCase()));
const ADDED_LABEL = DATE_ADDED_C >= 0 ? sentence(String(DATA.columns[DATE_ADDED_C]).trim()) : 'Added';
const cfgName = n => (n === 'added' ? ADDED_LABEL.toLowerCase() : n);
const sheetDates = (() => {
  if (DATE_ADDED_C < 0) return [];
  const vals = DATA.rows.map(r => String(r[DATE_ADDED_C] ?? '').trim());
  const nums = vals.map(v => v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/)).filter(Boolean);
  // Day-first unless some date only makes sense month-first (e.g. 10/25/2026).
  const monthFirst = !nums.some(m => +m[1] > 12) && nums.some(m => +m[2] > 12);
  const pad = n => String(n).padStart(2, '0');
  return vals.map(v => {
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
    if (m) {
      const [day, month] = monthFirst ? [m[2], m[1]] : [m[1], m[2]];
      return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(month)}-${pad(day)}`;
    }
    const t = v && Date.parse(v);
    return t ? new Date(t).toLocaleDateString('en-CA') : '';
  });
})();
const ADDED = TRACKED || DATE_ADDED_C >= 0 ? DATA.rows.map((_, i) => sheetDates[i] || (TRACKED && TRACKED[i]) || '') : null;
const HAS_ADDED = !!ADDED;
// The sheet's own date column keeps a distinct name so lookups by name find the combined column.
const COLS = [...DATA.columns.map((c, i) => sentence(String(c)) + (i === DATE_ADDED_C ? ' (sheet)' : '')), ...(HAS_ADDED ? [ADDED_LABEL] : [])];
const ADDED_C = HAS_ADDED ? COLS.length - 1 : -1;
const BLANK = '\u0000blank';
const MONEY = /^([\d.,]+)\s*([A-Za-z]{3})$/;
// Values to show when a cell is blank, by column name.
const BLANK_AS = CFG.blankAs || {};
// Columns whose bracketed notes are left out of the page, e.g. a price of "23 AUD (paid 20)" reads as "23 AUD".
const DROP_BRACKETS = CFG.dropBrackets || [];
// Tag columns show each value as a green pill; "no" means no tag.
const TAG_COLS = CFG.tagCols || [];
// Currency for bare amounts, by column name, e.g. { price: 'AUD' } reads "40" as "40 AUD".
const BARE_CURRENCY = CFG.bareCurrency || {};
const clean = (name, x) => {
  const n = name.toLowerCase();
  if (DROP_BRACKETS.includes(n)) x = x.replace(/\s*\(.*$/s, '');
  if (BARE_CURRENCY[n] && /^\s*[\d.,]+\s*$/.test(x)) return `${x.trim()} ${BARE_CURRENCY[n]}`;
  if (TAG_COLS.includes(n) && /^\s*no\s*$/i.test(x)) return '';
  return x;
};
// Colour columns can list several colours separated by commas, e.g. "Pink, Orange".
const SWATCH_COLS = ['colour', 'color'];
const splitCell = (name, x) => x.split(SWATCH_COLS.includes(name.toLowerCase()) ? /[\n,]+/ : /\n+/).map(t => sentence(t.trim())).filter(Boolean);
// Number columns filtered by thresholds: a row with 3 matches "1+", "2+" and "3+"; 0 or blank matches none.
const AT_LEAST = CFG.atLeast || [];
const atLeast = x => Array.from({ length: Math.max(0, Math.floor(Number(x)) || 0) }, (_, k) => `${k + 1}+`);
const ROWS = DATA.rows.map((r, i) => {
  if (HAS_ADDED) r = [...DATA.columns.map((_, c) => r[c]), ADDED[i]];
  const v = COLS.map((name, c) => sentence(clean(name, String(r[c] ?? '')).trim()) || BLANK_AS[name.toLowerCase()] || '');
  return { i, v, hay: v.join(' \n ').toLowerCase(),
    tok: v.map((x, c) => AT_LEAST.includes(COLS[c].toLowerCase()) ? atLeast(x)
      : x ? [...new Set(splitCell(COLS[c], x))] : [BLANK]) };
});

const kindOf = c => {
  const vals = ROWS.map(r => r.v[c]).filter(Boolean);
  if (!vals.length) return 'empty';
  if (vals.every(v => /^https?:\/\//i.test(v))) return 'url';
  if (vals.every(v => v !== '' && !isNaN(Number(v)))) return 'number';
  if (vals.every(v => MONEY.test(v))) return 'money';
  if (vals.every(v => /^(yes|no)$/i.test(v))) return 'bool';
  if (vals.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
  return 'text';
};
const META = COLS.map((name, c) => ({ name, c, kind: kindOf(c) }));
// Column order for the table, filters and detail panel; columns not listed follow in sheet order.
const ORDER = (CFG.order || []).map(cfgName);
const rank = m => { const k = ORDER.indexOf(m.name.toLowerCase()); return k < 0 ? ORDER.length + m.c : k; };
// A "sold" column marks sold items: anything typed in it (yes, a date, a ticked checkbox) except no/false/0.
// It isn't shown as a column; sold rows are left out of the table and every count unless "Show sold" is on.
const SOLD_C = META.findIndex(m => m.name.toLowerCase() === 'sold');
ROWS.forEach(r => { r.sold = SOLD_C >= 0 && !!r.v[SOLD_C] && !/^(no|n|false|0|-)$/i.test(r.v[SOLD_C]); });
const SOLD_N = ROWS.filter(r => r.sold).length;
const ORDERED = META.filter(m => m.c !== SOLD_C && m.c !== DATE_ADDED_C).sort((a, b) => rank(a) - rank(b));
const SHOWN = ORDERED.filter(m => m.kind !== 'empty');
// Columns that get no filter list in the sidebar; search still covers them.
const NO_FILTER = (CFG.noFilter || []).map(cfgName);
// Columns shown inside another column's cell instead of their own, e.g. { excess: 'description' } adds
// "2 excess" under the description. They keep their filter and their line in the detail panel.
const INLINE = Object.fromEntries(Object.entries(CFG.inline || {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
// A column shown on a bar over each table photo instead of in its own column (e.g. the price); pages without
// photos keep it as a column.
const OVERLAY = DATA.images > 0 && CFG.thumbOverlay ? SHOWN.find(m => m.name.toLowerCase() === CFG.thumbOverlay.toLowerCase()) : null;
const TABLE = SHOWN.filter(m => !INLINE[m.name.toLowerCase()] && m !== OVERLAY);
document.body.classList.toggle('thumb-overlaid', !!OVERLAY);
const extras = (r, m) => SHOWN.filter(x => INLINE[x.name.toLowerCase()] === m.name.toLowerCase())
  .filter(x => r.v[x.c] && !(x.kind === 'number' && Number(r.v[x.c]) === 0))
  .map(x => `${r.v[x.c]} ${x.name.toLowerCase()}`);
const FACETED = SHOWN.filter(m => m.kind !== 'url' && !NO_FILTER.includes(m.name.toLowerCase()));

const money = s => { const m = s.match(MONEY); return [m[2].toUpperCase(), parseFloat(m[1].replace(/,/g, ''))]; };
const cmpVal = (kind, x, y) => {
  if (kind === 'number') return parseFloat(x) - parseFloat(y); // parseFloat so "2+" sorts as 2
  if (kind === 'money') { const [ac, an] = money(x), [bc, bn] = money(y); return ac.localeCompare(bc) || an - bn; }
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
};

let IMGS = {};
const HAS_IMG = DATA.images > 0;
document.body.classList.toggle('no-img', !HAS_IMG);
// High-resolution photo files by row ({src, w, h}), for the detail panel. The thumbnail shows behind each one until it loads.
// Photo paths in the data are relative to the site root; CFG.photoBase gets there from this page's folder.
const PHOTOS = Object.fromEntries(Object.entries(DATA.photos || {}).map(([k, p]) => [k, { ...p, src: (CFG.photoBase || '') + p.src }]));
// Start downloading a row's photo before its panel opens: on press, on keyboard focus, and for the neighbours of an open row.
const preloaded = new Set();
const preload = r => {
  const p = r && PHOTOS[r.i];
  if (p && !preloaded.has(p.src)) { preloaded.add(p.src); new Image().src = p.src; }
};
const hero = r => {
  const p = PHOTOS[r.i];
  if (!p) return IMGS[r.i] ? h('img', { class: 'hero', src: IMGS[r.i], alt: '' }) : null;
  const img = h('img', { class: 'hero', src: p.src, alt: '', width: p.w, height: p.h });
  if (!img.complete) {
    img.classList.add('loading');
    const show = () => img.classList.remove('loading');
    img.addEventListener('load', show); img.addEventListener('error', show);
  }
  return h('span', { class: 'hero-box' }, img);
};
const thumb = (r, cls) => IMGS[r.i]
  ? h('img', { class: cls, src: IMGS[r.i], alt: r.v[0] ? `${r.v[0]}, ${r.v[2] || ''}`.replace(/, $/, '') : '', loading: 'lazy', decoding: 'async' })
  : h('span', { class: cls, 'aria-hidden': 'true' });
const colIdx = name => META.findIndex(m => m.name.toLowerCase() === name);

// Columns shown as colour-coded chips. Each distinct value gets its own colour, in alphabetical order.
const CHIP_COLS = CFG.chipCols || [];
const chipColour = new Map();
META.filter(m => CHIP_COLS.includes(m.name.toLowerCase())).forEach(m => {
  const vals = [...new Set(ROWS.map(r => r.v[m.c]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  chipColour.set(m.c, new Map(vals.map((v, k) => [v, 'c' + (k % 6 + 1)])));
});
// Colour columns show a swatch of the named colour beside the value.
const SWATCHES = { red: '#D2353B', pink: '#EC86B0', orange: '#F08A35', yellow: '#F3CB45', green: '#4C9A58', blue: '#4B80D2',
  purple: '#8B5CC4', white: '#FFFFFF', cream: '#F2E6C4', brown: '#7B5535', black: '#222222', grey: '#9A9A9A',
  multicolour: 'conic-gradient(#D2353B, #F3CB45, #4C9A58, #4B80D2, #8B5CC4, #D2353B)' };
const swatchCols = new Set(META.filter(m => SWATCH_COLS.includes(m.name.toLowerCase())).map(m => m.c));
const swatch = v => SWATCHES[v.toLowerCase()] ? h('span', { class: 'swatch', style: 'background:' + SWATCHES[v.toLowerCase()], 'aria-hidden': 'true' }) : null;
const chip = (c, v) => h('span', { class: 'pill chip-col ' + (chipColour.get(c)?.get(v) || 'no') }, v);

// Default sort: CFG.sortBy's column if the page names one, else the first column; ties go by the first column.
const SHOW_SOLD_KEY = `${CFG.plural}-show-sold`;
const state = { q: '', sort: { c: Math.max(0, colIdx(cfgName(CFG.sortBy))), dir: CFG.sortDir || 1 }, sel: new Map(), view: [],
  showSold: (() => { try { return localStorage.getItem(SHOW_SOLD_KEY) === '1'; } catch { return false; } })() };
// How many rows the current sold setting allows, before search and filters.
const inStock = () => (state.showSold ? ROWS.length : ROWS.length - SOLD_N);
const soldPill = r => (r.sold ? h('span', { class: 'pill sold-pill' }, 'Sold') : null);

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (k === 'class') el.className = val;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), val);
    else el.setAttribute(k, val === true ? '' : val);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};

// replaceChildren would print null/false as text, so drop empty parts first.
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));

// ---------- header ----------
const synced = DATA.synced ? new Date(DATA.synced) : null;
const syncStatus = h('span', { class: 'sync-status', role: 'status' });
const syncBtn = h('button', { class: 'linkbtn sync-btn', type: 'button', onclick: () => syncNow() }, 'Sync now');
document.getElementById('sub').append(
  h('b', {}, ROWS.length - SOLD_N), ` ${CFG.plural}`, SOLD_N ? ` (${SOLD_N} sold)` : '',
  synced ? ` · synced ${synced.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '',
  ...(DATA.sheet ? [synced ? ' from ' : ' · From ', h('a', { href: DATA.sheet, target: '_blank', rel: 'noopener' },
    DATA.sheetTitle || 'the Google Sheet')] : []),
  ' · ', syncBtn, syncStatus
);

// ---------- sync now ----------
// Runs the repo's sync workflow with the GitHub token CJ Money saved on this device (it needs Actions: Read and
// write on this repo), follows the run, then reloads once GitHub Pages serves the new data. Without a usable token
// it opens the workflow on GitHub, where "Run workflow" does the same.
const SITE_REPO = 'dezzaCodes/dezzaCodes.github.io', WORKFLOW = 'sync.yml';
const WORKFLOW_URL = `https://github.com/${SITE_REPO}/actions/workflows/${WORKFLOW}`;
const savedToken = () => { try { return localStorage.getItem('flower-ledger-token'); } catch { return null; } };
const ghApi = (path, body) => fetch(`https://api.github.com/repos/${SITE_REPO}${path}`, {
  method: body ? 'POST' : 'GET', cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
  headers: { Authorization: `Bearer ${savedToken()}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const say = (msg, link) => fill(syncStatus, msg ? [' ', msg] : [], link ? [' ', h('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.text)] : []);
async function syncNow() {
  if (!savedToken()) { window.open(WORKFLOW_URL, '_blank', 'noopener'); return; }
  syncBtn.disabled = true; syncBtn.hidden = true; say('Starting sync…');
  try {
    const runs = async () => (await (await ghApi(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`)).json()).workflow_runs || [];
    // While waiting, a failed check (a dropped connection, say) is retried on the next round.
    const tryRuns = async () => { try { return await runs(); } catch { return []; } };
    const before = Math.max(0, ...(await runs()).map(r => r.id));
    const res = await ghApi(`/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main' });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      // GitHub answers 401 for a dead token, 404 when the token doesn't cover this repo, 403 when it lacks Actions access.
      const why = res.status === 401 ? 'This device’s GitHub token has expired or been deleted.'
        : res.status === 404 ? 'This device’s GitHub token doesn’t include the dezzaCodes.github.io repository.'
        : 'This device’s GitHub token needs Actions set to “Read and write”.';
      say(why, { href: 'https://github.com/settings/personal-access-tokens', text: 'Edit the token' });
      return;
    }
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    let run;
    for (let t = 0; t < 120; t++) { // up to about 8 minutes
      await wait(4000);
      run = (await tryRuns()).find(r => r.id > before) || run;
      if (!run) continue;
      if (run.status !== 'completed') { say('Syncing from the sheet…'); continue; }
      if (run.conclusion !== 'success') { say('Sync failed.', { href: run.html_url, text: 'See why' }); return; }
      break;
    }
    if (!run || run.status !== 'completed') { say('Sync is taking a while.', { href: WORKFLOW_URL, text: 'Check on GitHub' }); return; }
    say('Publishing…');
    for (let t = 0; t < 60; t++) { // GitHub Pages usually republishes within a minute or two
      await wait(5000);
      const page = await fetch(location.pathname, { cache: 'no-store' }).then(r => r.text(), () => '');
      const m = page.match(/"synced": "([^"]+)"/);
      if (m && m[1] !== DATA.synced) { location.reload(); return; }
    }
    say('Synced. Reload in a minute to see it.');
  } catch (e) {
    say(`Couldn’t sync (${e.message}).`, { href: WORKFLOW_URL, text: 'Run it on GitHub' });
  } finally { syncBtn.disabled = false; syncBtn.hidden = false; }
}

// ---------- filtering ----------
const passes = (r, skip) => {
  if (r.sold && !state.showSold) return false;
  if (state.q && !r.hay.includes(state.q)) return false;
  for (const [c, set] of state.sel) {
    if (c === skip || !set.size) continue;
    if (!r.tok[c].some(t => set.has(t))) return false;
  }
  return true;
};

// ---------- facets ----------
const facetEls = new Map();
const facetsBox = document.getElementById('facets');
for (const m of FACETED) {
  const counts = new Map();
  ROWS.forEach(r => r.tok[m.c].forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  // Blank cells get no option of their own.
  const toks = [...counts.keys()].filter(t => t !== BLANK).sort((a, b) => cmpVal(m.kind, a, b));
  const items = new Map();
  const list = h('div', { class: 'opts' });
  for (const t of toks) {
    const cb = h('input', { type: 'checkbox', id: `f-${m.c}-${items.size}`, onchange: () => {
      const set = state.sel.get(m.c) || new Set();
      cb.checked ? set.add(t) : set.delete(t);
      state.sel.set(m.c, set);
      update();
    }});
    const count = h('span', { class: 'c' });
    const label = h('label', { class: 'opt', for: cb.id }, cb,
      h('span', {}, swatchCols.has(m.c) ? [swatch(t), ' '] : null, t), count);
    items.set(t, { label, cb, count });
    list.append(label);
  }
  const nSel = h('span', { class: 'n-sel', hidden: true });
  const clear = h('button', { class: 'linkbtn clear', type: 'button', hidden: true, 'aria-label': `Clear ${m.name} filter`,
    onclick: e => { e.preventDefault(); e.stopPropagation(); state.sel.delete(m.c); update(); } }, 'Clear');
  const summary = h('summary', {}, h('span', { class: 'name' }, m.name), nSel, clear);
  const det = h('details', { class: 'facet', open: true }, summary, list);
  facetsBox.append(det);
  facetEls.set(m.c, { items, nSel, clear });
}

const updateFacets = () => {
  for (const m of FACETED) {
    const { items, nSel, clear } = facetEls.get(m.c);
    const counts = new Map();
    ROWS.forEach(r => { if (passes(r, m.c)) r.tok[m.c].forEach(t => counts.set(t, (counts.get(t) || 0) + 1)); });
    const sel = state.sel.get(m.c) || new Set();
    items.forEach((it, t) => {
      const n = counts.get(t) || 0;
      it.count.textContent = n;
      it.cb.checked = sel.has(t);
      it.label.classList.toggle('zero', !n && !sel.has(t));
    });
    nSel.hidden = clear.hidden = !sel.size; nSel.textContent = sel.size;
  }
};

// ---------- table ----------
const thead = document.getElementById('thead');
const renderHead = () => {
  thead.replaceChildren(...(HAS_IMG ? [h('th', { class: 'img-cell' }, h('span', { class: 'sr' }, 'Image'))] : []), ...TABLE.map(m => {
    const on = state.sort.c === m.c;
    return h('th', { 'aria-sort': on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : null },
      h('button', { type: 'button', onclick: () => {
        state.sort = { c: m.c, dir: on ? -state.sort.dir : 1 };
        update();
      }}, m.name, h('span', { class: 'arrow', 'aria-hidden': 'true' }, on && state.sort.dir < 0 ? '↓' : '↑')));
  }));
};

// "Chrysanthemum (one ply)" -> name "Chrysanthemum" with "One ply" shown as a subtext underneath.
const splitName = v => {
  const m = v.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m && m[1] ? [m[1], sentence(m[2].trim())] : [v, ''];
};
const nameParts = v => { const [name, variety] = splitName(v); return [name, variety ? h('span', { class: 'variety' }, variety) : null]; };

const cell = (m, v, first) => {
  if (!v) return h('span', { class: 'dash' }, '—');
  if (first) return nameParts(v);
  if (chipColour.has(m.c)) return chip(m.c, v);
  if (TAG_COLS.includes(m.name.toLowerCase())) return h('span', { class: 'swatches' }, splitCell(m.name, v).map(t => h('span', { class: 'pill yes chip-col' }, t)));
  if (swatchCols.has(m.c)) return h('span', { class: 'swatches' }, splitCell(m.name, v).map(t => h('span', { class: 'pill swatch-pill' }, swatch(t), t)));
  if (m.kind === 'bool') return [h('span', { class: 'pill wide-only ' + v.toLowerCase() }, v),
    /^yes$/i.test(v) ? h('span', { class: 'pill phone-only yes' }, m.name) : null];
  if (m.kind === 'number') return h('span', { class: 'num' }, v);
  if (m.kind === 'money') return h('span', { class: 'mono' }, v);
  if (m.kind === 'date') return h('span', { class: 'mono' }, new Date(v + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }));
  if (m.kind === 'url') return h('a', { href: v, target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, 'Open ↗');
  const lines = v.split(/\n+/);
  return [lines[0], ...lines.slice(1).map(l => h('span', { class: 'line2' }, l))];
};

const tbody = document.getElementById('tbody');
const renderBody = () => {
  tbody.replaceChildren(...state.view.map((r, idx) => h('tr', { tabindex: 0, class: r.sold ? 'sold' : null,
    onclick: () => openDetail(idx),
    onpointerdown: () => preload(r), onfocus: () => preload(r),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(idx); } } },
    HAS_IMG ? h('td', { class: 'img-cell' }, h('span', { class: 'thumb-box' }, thumb(r, 'thumb'),
      OVERLAY && r.v[OVERLAY.c] ? h('span', { class: 'thumb-overlay' }, r.v[OVERLAY.c]) : null)) : null,
    TABLE.map((m, k) => { const ex = extras(r, m); return h('td', {
      class: [k === 0 ? 'first' : '', m.c === ADDED_C ? 'added-col' : '', (!r.v[m.c] && !ex.length) || (m.kind === 'number' && Number(r.v[m.c]) === 0) ? 'nil' : ''].join(' ').trim() || null,
      'data-col': m.name.toLowerCase(),
      'data-label': m.kind === 'number' ? m.name : null,
      'data-bool': m.kind === 'bool' ? (/^yes$/i.test(r.v[m.c]) ? 'yes' : 'no') : null,
    }, r.v[m.c] || !ex.length ? [cell(m, r.v[m.c], k === 0), ex.map(t => h('span', { class: 'line2' }, t))] : ex.join(' · '),
      k === 0 ? soldPill(r) : null); }))));
  document.getElementById('empty').hidden = state.view.length > 0;
};

// ---------- bar ----------
const bar = document.getElementById('bar');
const filtersEl = document.getElementById('filters');
const nActive = () => [...state.sel.values()].reduce((a, s) => a + s.size, 0);
// ---------- total, converted to Australian dollars at the latest exchange rate ----------
const PRICE = META.find(m => m.kind === 'money');
const HOME = 'AUD';
let FX = null; // null while loading, false if no rate service answered, else { rates, date, source }
async function loadFx() {
  const want = [...new Set(ROWS.filter(r => PRICE && r.v[PRICE.c]).map(r => money(r.v[PRICE.c])[0]))].filter(c => c !== HOME);
  const sources = [
    async () => {
      const j = await (await fetch(`https://api.frankfurter.dev/v1/latest?base=${HOME}&symbols=${want.join(',')}`)).json();
      return { rates: j.rates, date: j.date, source: 'European Central Bank' };
    },
    async () => {
      const j = await (await fetch(`https://open.er-api.com/v6/latest/${HOME}`)).json();
      return { rates: j.rates, date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10), source: 'ExchangeRate-API' };
    },
  ];
  FX = false;
  if (!want.length) FX = { rates: {}, date: null, source: '' };
  else for (const src of sources) {
    try { const fx = await src(); if (want.every(c => fx.rates && fx.rates[c] > 0)) { FX = fx; break; } } catch {}
  }
  renderBar();
}
const fmtHome = n => '$' + Math.round(n).toLocaleString('en-AU');
const totalEl = () => {
  if (!PRICE) return null;
  const by = new Map(); let unpriced = 0;
  state.view.forEach(r => {
    const v = r.v[PRICE.c];
    if (!v) { unpriced++; return; }
    const [cur, n] = money(v);
    by.set(cur, (by.get(cur) || 0) + n);
  });
  const parts = [...by].map(([cur, n]) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })} ${cur}`);
  const note = unpriced ? ` · ${unpriced} without a price` : '';
  if (FX === null) return h('span', { class: 'total' }, 'Total ', h('small', {}, 'loading exchange rates…'));
  if (!FX) return h('span', { class: 'total' }, 'Total ', h('b', {}, parts.join(' + ') || '0'),
    h('small', {}, 'exchange rates unavailable right now' + note));
  const sum = [...by].reduce((a, [cur, n]) => a + (cur === HOME ? n : n / FX.rates[cur]), 0);
  const foreign = [...by.keys()].filter(c => c !== HOME);
  const rateText = foreign.map(c => `1 ${c} = ${(1 / FX.rates[c]).toFixed(3)} ${HOME}`).join(', ');
  const day = FX.date ? new Date(FX.date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
  return h('span', { class: 'total', title: parts.join(' + ') + (rateText ? `\n${rateText} (${FX.source}, ${FX.date})` : '') },
    'Total ', h('b', {}, `${fmtHome(sum)} ${HOME}`),
    note ? h('small', {}, note.replace(/^ · /, '')) : null);
};

// Columns left out of the phone Sort by menu.
const PHONE_NO_SORT = CFG.phoneNoSort || [];

const renderBar = () => {
  const chips = [];
  for (const [c, set] of state.sel) for (const t of set) {
    chips.push(h('button', { class: 'chip', type: 'button', 'aria-label': `Remove filter ${COLS[c]}: ${t === BLANK ? 'blank' : t}`,
      onclick: () => { set.delete(t); update(); } },
      h('span', {}, COLS[c] + ':'), t === BLANK ? '(blank)' : t, h('i', { 'aria-hidden': 'true' }, '×')));
  }
  const n = nActive();
  fill(bar,
    filtersEl.classList.contains('open') ? null : h('button', { class: 'chip show-filters', type: 'button', 'aria-expanded': 'false',
      onclick: () => { filtersEl.classList.add('open'); renderBar(); } }, `Filters${n ? ` (${n})` : ''}`),
    h('label', { class: 'mobile-sort' }, 'Sort by ',
      h('select', { id: 'sortSel', onchange: e => { const [c, dir] = e.target.value.split(':').map(Number); state.sort = { c, dir }; update(); } },
        SHOWN.filter(m => !PHONE_NO_SORT.includes(m.name.toLowerCase()) || state.sort.c === m.c)
          // Yes/no columns get one option that puts the yeses first ("No" < "Yes", so descending).
          .flatMap(m => (m.kind === 'bool' ? [-1] : [1, -1]).map(dir => h('option', { value: `${m.c}:${dir}`, selected: state.sort.c === m.c && (m.kind === 'bool' || state.sort.dir === dir) || null },
            m.kind === 'bool' ? `${m.name} first`
              : `${m.name} ${m.kind === 'number' || m.kind === 'money' ? (dir > 0 ? '(low–high)' : '(high–low)') : m.kind === 'date' ? (dir > 0 ? '(oldest first)' : '(newest first)') : (dir > 0 ? '(A–Z)' : '(Z–A)')}`))))),
    h('span', { class: 'count' }, 'Showing ', h('b', {}, state.view.length), ' of ', h('b', {}, inStock()), ` ${CFG.plural}`),
    SOLD_N ? h('button', { class: 'chip sold-toggle', type: 'button', 'aria-pressed': String(state.showSold),
      onclick: () => { state.showSold = !state.showSold; try { localStorage.setItem(SHOW_SOLD_KEY, state.showSold ? '1' : '0'); } catch {} update(); } },
      `${state.showSold ? 'Hide' : 'Show'} sold (${SOLD_N})`) : null,
    ...chips, totalEl());
  document.getElementById('clearAll').hidden = !n;
  syncToTop();
  document.getElementById('doneFilters').textContent = `Show ${state.view.length} ${state.view.length === 1 ? CFG.noun : CFG.plural}`;
};
document.getElementById('clearAll').onclick = () => { state.sel.clear(); update(); };
// Phones: close the filter panel and bring the results into view.
const closeFilters = () => {
  filtersEl.classList.remove('open');
  renderBar();
  const top = bar.getBoundingClientRect().top;
  if (top < 0) window.scrollTo({ top: window.scrollY + top - 12 });
};
document.getElementById('closeFilters').onclick = closeFilters;
document.getElementById('doneFilters').onclick = closeFilters;

// ---------- update ----------
function update(toTop = true) {
  const { c, dir } = state.sort; const kind = META[c].kind;
  state.view = ROWS.filter(r => passes(r)).sort((a, b) => {
    const x = a.v[c], y = b.v[c];
    if (!x !== !y) return x ? -1 : 1; // blanks always last
    return (x ? dir * cmpVal(kind, x, y) : 0) || (c !== 0 && ((!a.v[0]) - (!b.v[0]) || a.v[0].localeCompare(b.v[0]))) || a.i - b.i;
  });
  renderHead(); renderBody(); renderBar(); updateFacets();
  if (toTop) scrollToTable();
}

let qTimer;
document.getElementById('q').addEventListener('input', e => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); update(); }, 120);
});

// ---------- detail sheet ----------
const scrim = document.getElementById('scrim'), sheet = document.getElementById('sheet');
let cur = -1, lastFocus = null;
function openDetail(idx) {
  if (cur < 0) lastFocus = document.activeElement;
  cur = idx;
  const r = state.view[idx];
  preload(state.view[idx - 1]); preload(state.view[idx + 1]);
  // "Other <name> entries" rows show this text column and chip column.
  const DESC = colIdx(CFG.sibText), FROM = colIdx(CFG.sibChip);
  const sibs = ROWS.filter(o => o !== r && o.v[0] && o.v[0].toLowerCase() === r.v[0].toLowerCase());
  const close = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: closeDetail }, '×');
  fill(sheet,
    h('div', { class: 'sheet-nav' },
      h('span', { class: 'pos' }, `${idx + 1} / ${state.view.length}`),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous', disabled: idx === 0 || null, onclick: () => openDetail(idx - 1) }, '←'),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next', disabled: idx === state.view.length - 1 || null, onclick: () => openDetail(idx + 1) }, '→'),
      close),
    HAS_IMG ? hero(r) : null,
    h('h2', { id: 'sheetTitle' }, r.v[0] ? nameParts(r.v[0]) : '(untitled)', soldPill(r)),
    h('dl', { class: 'fields' }, ORDERED.filter(m => m.c !== 0 && m.kind !== 'empty' && m.name.toLowerCase() !== 'image').flatMap(m => [
      h('dt', {}, m.name),
      h('dd', {}, !r.v[m.c] ? h('span', { class: 'dash' }, '—')
        : m.kind === 'url' ? h('a', { href: r.v[m.c], target: '_blank', rel: 'noopener' }, r.v[m.c])
        : m.kind === 'bool' ? h('span', { class: 'pill ' + r.v[m.c].toLowerCase() }, r.v[m.c])
        : m.kind === 'text' && !chipColour.has(m.c) && !swatchCols.has(m.c) && !TAG_COLS.includes(m.name.toLowerCase()) ? r.v[m.c] : cell(m, r.v[m.c]))
    ])),
    sibs.length ? h('div', { class: 'siblings' },
      h('h3', { class: 'eyebrow' }, `Other ${splitName(r.v[0]).filter(Boolean).join(', ')} entries (${sibs.length})`),
      sibs.map(o => h('button', { class: 'sib', type: 'button', onclick: () => {
        let j = state.view.indexOf(o);
        if (j < 0) { state.view.splice(idx + 1, 0, o); renderBody(); j = idx + 1; }
        openDetail(j);
      }}, HAS_IMG ? thumb(o, 'sib-thumb') : h('span'),
         h('span', {}, (DESC >= 0 ? o.v[DESC].split('\n')[0] : '') || '—'),
         h('span', { class: 'from' }, FROM >= 0 && o.v[FROM] ? (chipColour.has(FROM) ? chip(FROM, o.v[FROM]) : o.v[FROM]) : '')))) : null
  );
  scrim.hidden = false;
  close.focus();
}
function closeDetail() {
  scrim.hidden = true; cur = -1;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
scrim.addEventListener('click', e => { if (e.target === scrim) closeDetail(); });
document.addEventListener('keydown', e => {
  if (cur < 0) return;
  if (e.key === 'Escape') closeDetail();
  else if (e.key === 'ArrowLeft' && cur > 0) openDetail(cur - 1);
  else if (e.key === 'ArrowRight' && cur < state.view.length - 1) openDetail(cur + 1);
});

loadFx();
if (HAS_IMG) fetch(CFG.images).then(res => res.ok ? res.json() : {}).then(j => {
  IMGS = j || {};
  renderBody();
  if (cur >= 0) openDetail(cur);
}).catch(() => {});

// After a filter, search or sort change, show the first rows: reset the table's own scroll and,
// if the page is scrolled past the table's top, bring it back into view.
function scrollToTable() {
  const box = document.getElementById('tableBox');
  box.scrollTop = 0;
  const top = bar.getBoundingClientRect().top;
  if (top < 0) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: window.scrollY + top - 12, behavior: reduce ? 'auto' : 'smooth' });
  }
}

// Back-to-top button. Wide screens scroll the table inside its box and phones scroll the page, so watch both.
// Hidden while the phone filter panel is open, where it would cover the "Show N <items>" button.
const toTop = document.getElementById('toTop'), tableBox = document.getElementById('tableBox');
function syncToTop() {
  const off = filtersEl.classList.contains('open') || (window.scrollY < window.innerHeight * 0.8 && tableBox.scrollTop < tableBox.clientHeight * 0.8);
  toTop.classList.toggle('off', off); toTop.tabIndex = off ? -1 : 0;
}
window.addEventListener('scroll', syncToTop, { passive: true });
tableBox.addEventListener('scroll', syncToTop, { passive: true });
toTop.addEventListener('click', () => {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  if (tableBox.scrollTop) tableBox.scrollTo({ top: 0, behavior });
  if (window.scrollY) window.scrollTo({ top: 0, behavior });
});

update(false);
})();
