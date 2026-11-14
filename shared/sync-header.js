// The line under each sheet page's title: "Showing X of Y <items> · synced <time>" (the time links to the sheet) and
// a sync button that runs the sheet sync on GitHub. Used by the flower, juju and eyes pages:
// SyncHeader(DATA, subElement) adds it and returns the element the page fills with its "Showing …" count.
window.SyncHeader = (DATA, sub) => {
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
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));

const synced = DATA.synced ? new Date(DATA.synced) : null;
const syncStatus = h('span', { class: 'sync-status', role: 'status' });
const countEl = h('span', { class: 'count' });
// Circular-arrows icon button; it spins while a sync runs.
const syncBtn = h('button', { class: 'sync-btn', type: 'button', title: 'Sync now', 'aria-label': 'Sync now', onclick: () => syncNow() });
syncBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';
// "synced 25 Oct, 9:41 pm" (the year only when it isn't this year), linking to the sheet.
const syncedText = synced && 'synced ' + synced.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  ...(synced.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
sub.append(
  // "Showing X of Y flowers" (filled in by renderBar).
  countEl,
  ...(syncedText ? [' · '] : []),
  // The sync time and icon sit in one row so the icon centres on the text.
  h('span', { class: 'synced-row' }, syncedText && DATA.sheet
    ? h('a', { class: 'synced', href: DATA.sheet, target: '_blank', rel: 'noopener', title: 'Open the Google Sheet' }, syncedText)
    : syncedText || null, syncBtn), syncStatus
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
  syncBtn.disabled = true; syncBtn.classList.add('spinning'); say('Starting…');
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
      if (run.status !== 'completed') { say('Syncing…'); continue; }
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
  } finally { syncBtn.disabled = false; syncBtn.classList.remove('spinning'); }
}

return countEl;
};
