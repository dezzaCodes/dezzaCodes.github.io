/**
 * Row history: when did each flower row first appear in the sheet?
 *
 * Paste into the sheet's Extensions → Apps Script, add the "Drive API" service (Services +, Drive API, v3),
 * then run findRowDates. It reads every saved version of the flowers tab from the sheet's version history,
 * oldest first, follows each row from version to version (so a colour or name filled in later doesn't make a
 * row look new), and writes each current row's first-seen time to a "Row history" tab. It never changes the
 * flowers tab. If it runs out of time (Apps Script stops scripts after 6 minutes) it saves its place; run it
 * again to continue. Run resetRowHistory to start over.
 */

const FLOWERS_SHEET_ID = 0;        // the flowers tab's gid
const OUTPUT_TAB = 'Row history';
const TIME_ZONE = 'Australia/Sydney';
const TIME_BUDGET_MS = 4.5 * 60 * 1000;

function findRowDates() {
  if (typeof Drive === 'undefined') {
    throw new Error('The Drive API service is missing. In the left sidebar, click + next to Services, choose ' +
      'Drive API (version v3, identifier "Drive"), click Add, then run findRowDates again.');
  }
  const started = Date.now();
  const fileId = SpreadsheetApp.getActive().getId();
  const revisions = listRevisions(fileId);
  const state = loadState() || { next: 0, rows: null, dates: null };
  console.log(`${revisions.length} saved versions; starting at #${state.next + 1}.`);

  while (state.next < revisions.length) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      saveState(state);
      const msg = `Read ${state.next} of ${revisions.length} versions. Run findRowDates again to continue.`;
      console.log(msg);
      SpreadsheetApp.getActive().toast(msg, 'Row history', 10);
      return;
    }
    const rev = revisions[state.next];
    const rows = revisionRows(fileId, rev);
    if (rows) {
      state.dates = carryDates(state.rows, state.dates, rows, rev.modifiedTime);
      state.rows = rows;
    } else {
      console.log(`Version ${rev.id} (${rev.modifiedTime}) couldn't be read; skipped.`);
    }
    state.next++;
  }

  // Finally the sheet as it is now, so every current row gets a date.
  const now = flowersSheet(SpreadsheetApp.getActive()).getDataRange().getDisplayValues();
  const current = dataRows(now);
  const dates = carryDates(state.rows, state.dates, current, new Date().toISOString());
  writeOutput(now, current, dates);
  clearState();
  const msg = `Done: ${current.length} rows dated from ${revisions.length} saved versions.`;
  console.log(msg);
  SpreadsheetApp.getActive().toast(msg, 'Row history', 10);
}

function resetRowHistory() {
  clearState();
  console.log('Cleared saved progress.');
}

// ---------- reading versions ----------

function listRevisions(fileId) {
  const all = [];
  let pageToken;
  do {
    const page = Drive.Revisions.list(fileId, {
      pageSize: 1000, pageToken, fields: 'nextPageToken,revisions(id,modifiedTime,exportLinks)',
    });
    all.push(...(page.revisions || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
}

/** The flowers tab of one saved version, as [sheet row number, cells] pairs; null if it can't be read. */
function revisionRows(fileId, rev) {
  const links = rev.exportLinks || {};
  const auth = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (links['text/csv']) {
    const url = links['text/csv'].replace(/([?&])gid=\d+/, '$1') + `&gid=${FLOWERS_SHEET_ID}`;
    const res = UrlFetchApp.fetch(url, auth);
    if (res.getResponseCode() === 200) return dataRows(Utilities.parseCsv(res.getContentText()));
  }
  // Fallback: open the version as a temporary spreadsheet and read its first tab.
  const xlsx = links['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
  if (!xlsx) return null;
  const res = UrlFetchApp.fetch(xlsx, auth);
  if (res.getResponseCode() !== 200) return null;
  const tmp = Drive.Files.create({ name: 'row-history temp', mimeType: MimeType.GOOGLE_SHEETS }, res.getBlob());
  try {
    const book = SpreadsheetApp.openById(tmp.id);
    return dataRows(book.getSheets()[0].getDataRange().getDisplayValues());
  } finally {
    Drive.Files.remove(tmp.id);
  }
}

/** Non-blank rows below the header, with their sheet row numbers (the header is row 1). */
function dataRows(values) {
  const out = [];
  values.forEach((r, i) => {
    if (i && r.some(c => String(c).trim())) out.push([i + 1, r.map(c => String(c).trim().toLowerCase())]);
  });
  return out;
}

// ---------- following rows from version to version (same rules as the site's sync) ----------

function similarity(a, b) {
  const n = Math.max(a.length, b.length);
  let filled = 0, same = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] || '', y = b[i] || '';
    if (x || y) { filled++; if (x === y) same++; }
  }
  return filled ? same / filled : 1;
}

/** Dates for `rows`, carried over from the previous version's rows (identical row, then the same position if
 *  mostly unchanged, then the most similar row elsewhere); rows matching nothing are new as of `when`. */
function carryDates(oldRows, oldDates, rows, when) {
  const oldCells = (oldRows || []).map(r => r[1]), newCells = rows.map(r => r[1]);
  const used = new Set(), dates = new Array(rows.length).fill(null);
  const take = (i, j) => { used.add(j); dates[i] = oldDates[j]; };
  newCells.forEach((k, i) => {
    const j = oldCells.findIndex((o, j) => !used.has(j) && o.join('\u0001') === k.join('\u0001'));
    if (j >= 0) take(i, j);
  });
  newCells.forEach((k, i) => {
    if (dates[i] === null && i < oldCells.length && !used.has(i) && similarity(oldCells[i], k) >= 0.5) take(i, i);
  });
  newCells.forEach((k, i) => {
    if (dates[i] !== null) return;
    let best = -1, bestScore = 0;
    oldCells.forEach((o, j) => { if (!used.has(j)) { const s = similarity(o, k); if (s > bestScore) { best = j; bestScore = s; } } });
    if (best >= 0 && bestScore >= 0.6) take(i, best);
  });
  return dates.map(d => d || when);
}

// ---------- output ----------

function flowersSheet(book) {
  return book.getSheets().find(s => s.getSheetId() === FLOWERS_SHEET_ID);
}

function writeOutput(values, current, dates) {
  const book = SpreadsheetApp.getActive();
  const header = values[0].map(h => String(h).trim().toLowerCase());
  const col = name => header.indexOf(name);
  const pick = (r, name) => (col(name) >= 0 ? values[r - 1][col(name)] : '');
  const out = [['Sheet row', 'Flower', 'From', 'Description', 'First seen (Sydney)']];
  current.forEach(([row], i) => out.push([
    row, pick(row, 'flower'), pick(row, 'from') || pick(row, 'where from'), pick(row, 'description'),
    Utilities.formatDate(new Date(dates[i]), TIME_ZONE, 'yyyy-MM-dd HH:mm'),
  ]));
  const tab = book.getSheetByName(OUTPUT_TAB) || book.insertSheet(OUTPUT_TAB);
  tab.clear();
  tab.getRange(1, 1, out.length, out[0].length).setNumberFormat('@').setValues(out);
  tab.setFrozenRows(1);
}

// ---------- progress between runs (split into chunks: each script property holds at most 9 KB) ----------

function saveState(state) {
  const props = PropertiesService.getScriptProperties();
  clearState();
  const text = JSON.stringify(state), size = 8000, parts = Math.ceil(text.length / size);
  const chunks = { rh_parts: String(parts) };
  for (let i = 0; i < parts; i++) chunks['rh_' + i] = text.slice(i * size, (i + 1) * size);
  props.setProperties(chunks);
}

function loadState() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const parts = Number(props.rh_parts || 0);
  if (!parts) return null;
  let text = '';
  for (let i = 0; i < parts; i++) text += props['rh_' + i] || '';
  return JSON.parse(text);
}

function clearState() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).filter(k => k.startsWith('rh_')).forEach(k => props.deleteProperty(k));
}
