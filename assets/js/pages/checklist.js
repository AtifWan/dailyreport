import { esc } from '../util.js';

// Single shared doc: this page only ever tracks the one report currently
// being assembled, not a history of past days (the committed JSON under
// assets/data/reports/ is already that history). The daily routine writes
// cloopDone/callLogsDone here as it ingests each source; only an editor's
// own Total Cases form write ever touches casesEntered/casesValues.
const DOC_PATH = 'checklist/current';

function renderMessage(container, heading, body) {
  container.innerHTML = `<div class="callout"><div class="ch">${esc(heading)}</div><p style="margin:0">${esc(body)}</p></div>`;
}

function statusRow(label, done, subtitle) {
  return `
    <div class="dr-check-row">
      <span class="dr-check-dot${done ? ' on' : ''}"></span>
      <div class="dr-check-text">
        <div class="dr-check-label">${esc(label)}</div>
        ${subtitle ? `<div class="dr-check-sub">${esc(subtitle)}</div>` : ''}
      </div>
      <span class="pill${done ? ' live' : ''}"${done ? '' : ' style="background:var(--surface-sunk);color:var(--ink-muted)"'}>${done ? 'Done' : 'Pending'}</span>
    </div>`;
}

function renderBoard(container, data, { saving, onSaveCases }) {
  const d = data || {};
  const cases = d.casesValues || {};
  const allDone = !!(d.cloopDone && d.callLogsDone && d.casesEntered);
  const missing = [!d.cloopDone && 'Cloop', !d.callLogsDone && 'Call logs', !d.casesEntered && 'Total Cases to Date'].filter(Boolean);

  container.innerHTML = `
    <div class="panel">
      <h3>Report readiness${d.date ? ` — ${esc(d.date)}` : ''}</h3>
      <p class="q">Cloop and Call logs are filled in automatically once the daily ingestion finds and parses that day's files. Total Cases to Date has no automated source yet, so it's entered below.</p>
      <div class="dr-check-list dr-section-gap">
        ${statusRow('Cloop data ingested', d.cloopDone, d.cloopDate ? `Covers ${d.cloopDate}` : null)}
        ${statusRow('Call logs data ingested', d.callLogsDone, d.callLogsDate ? `Covers ${d.callLogsDate}` : null)}
        ${statusRow('Total Cases to Date entered', d.casesEntered, d.casesEntered ? `${cases.totalOverallCases} overall · ${cases.totalInProgress} in progress · ${cases.totalOpenCases} open` : null)}
      </div>
      <div class="take">${allDone
        ? '<b>Ready.</b> Everything required is in — the next daily run will finalize and publish this report.'
        : `<b>Waiting on:</b> ${esc(missing.join(', '))}`}</div>
    </div>
    <div class="panel dr-section-gap">
      <h3>Enter Total Cases to Date</h3>
      <p class="q">From Cloop's own Status sheet — there's no automated export for this yet.</p>
      <form id="casesForm" class="dr-cases-form">
        <label>Total overall cases<input class="dinput" type="number" name="totalOverallCases" value="${cases.totalOverallCases ?? ''}" required></label>
        <label>Total in progress<input class="dinput" type="number" name="totalInProgress" value="${cases.totalInProgress ?? ''}" required></label>
        <label>Total open cases<input class="dinput" type="number" name="totalOpenCases" value="${cases.totalOpenCases ?? ''}" required></label>
        <button class="btn btn-primary" type="submit"${saving ? ' disabled' : ''}>${saving ? 'Saving…' : 'Save'}</button>
      </form>
    </div>`;

  container.querySelector('#casesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSaveCases({
      totalOverallCases: Number(fd.get('totalOverallCases')),
      totalInProgress: Number(fd.get('totalInProgress')),
      totalOpenCases: Number(fd.get('totalOpenCases')),
    });
  });
}

function renderLoginForm(container, { error, signingIn, onSubmit }) {
  container.innerHTML = `
    <div class="panel">
      <h3>Report checklist</h3>
      <p class="q">This page is for whoever generates the report. Enter the shared password to continue.</p>
      <form id="loginForm" class="dr-cases-form dr-section-gap">
        <label>Password<input class="dinput" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit"${signingIn ? ' disabled' : ''}>${signingIn ? 'Checking…' : 'Sign in'}</button>
      </form>
      ${error ? `<p class="dr-check-sub" style="color:var(--danger-ink);margin-top:10px">${esc(error)}</p>` : ''}
    </div>`;
  container.querySelector('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSubmit(String(fd.get('password') || ''));
  });
}

async function renderChecklistViaArtifact(container) {
  const user = await window.claude.use('user');
  const canEdit = user ? await user.canEdit() : false;
  if (!canEdit) {
    renderMessage(container, 'No access', "You don't have access to this page.");
    return;
  }
  const db = await window.claude.use('db');
  if (!db) {
    renderMessage(container, 'Not available here', 'The report checklist needs the db capability, which this view did not grant.');
    return;
  }

  const ref = db.doc(DOC_PATH);
  let latest = null;
  let saving = false;

  const draw = () => renderBoard(container, latest, { saving, onSaveCases: save });

  async function save(values) {
    saving = true;
    draw();
    try {
      const snap = await ref.get();
      if (snap.exists) await ref.update({ casesEntered: true, casesValues: values });
      else await ref.set({ casesEntered: true, casesValues: values });
    } finally {
      saving = false;
    }
  }

  ref.onSnapshot(
    (snap) => { latest = snap.exists ? snap.data() : null; draw(); },
    () => renderMessage(container, "Couldn't load", 'There was a problem reaching the checklist data.'),
  );
}

// Outside the Artifact runtime (e.g. the Vercel-hosted copy), there's no
// window.claude to ask "who is this viewer" or to hold shared state — so this
// path talks to real serverless endpoints (api/checklist/*) backed by Vercel
// KV instead, gated by a single shared password rather than the Artifact's
// own owner/editor model.
async function renderChecklistViaApi(container) {
  let latest = null;
  let saving = false;
  let signingIn = false;
  let loginError = null;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function drawBoard() {
    renderBoard(container, latest, { saving, onSaveCases: save });
  }

  async function load() {
    const res = await fetch('/api/checklist', { credentials: 'same-origin' });
    if (res.status === 401) {
      stopPolling();
      renderLoginForm(container, { error: loginError, signingIn, onSubmit: login });
      return;
    }
    if (!res.ok) {
      stopPolling();
      renderMessage(container, "Couldn't load", 'There was a problem reaching the checklist data.');
      return;
    }
    ({ data: latest } = await res.json());
    drawBoard();
    if (!pollTimer) {
      // No live-push channel here (no websocket backend) — a light poll picks
      // up the daily routine's own writes without the editor refreshing by
      // hand. Stops itself once this page is navigated away from.
      pollTimer = setInterval(() => {
        if (!document.contains(container)) { stopPolling(); return; }
        load();
      }, 30000);
    }
  }

  async function login(password) {
    signingIn = true;
    loginError = null;
    renderLoginForm(container, { error: loginError, signingIn, onSubmit: login });
    try {
      const res = await fetch('/api/checklist/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        await load();
        return;
      }
      loginError = res.status === 401 ? 'Wrong password.' : "Couldn't sign in — try again.";
    } catch {
      loginError = "Couldn't reach the server — try again.";
    } finally {
      signingIn = false;
    }
    renderLoginForm(container, { error: loginError, signingIn, onSubmit: login });
  }

  async function save(values) {
    saving = true;
    drawBoard();
    try {
      const res = await fetch('/api/checklist/cases', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.ok) ({ data: latest } = await res.json());
    } finally {
      saving = false;
      drawBoard();
    }
  }

  await load();
}

export async function renderChecklist(container) {
  if (window.claude && typeof window.claude.use === 'function') {
    await renderChecklistViaArtifact(container);
  } else {
    await renderChecklistViaApi(container);
  }
}
