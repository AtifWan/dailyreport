import { esc } from '../util.js';

// Vercel (its KV store, via api/checklist/*) is the one and only backend for
// this page's live state — on the Vercel-hosted site these are same-origin
// calls; from inside the Artifact they're cross-origin fetches to the same
// URL. No separate Artifact-side store, no login, no sync step between two
// backends: whichever host renders this page, it's reading and writing the
// same place.
const VERCEL_BASE = 'https://dailyreport-x15l-git-claude-zip-comp-8f7c55-atif-wan-s-projects.vercel.app';
const API_BASE = (typeof window !== 'undefined' && window.claude) ? VERCEL_BASE : '';

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

const DEFAULT_QUEUES = ['Appointments', 'General Enquiries', 'Canberra Vasectomy'];

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function queueRowHtml(name) {
  return `
    <div class="dr-queue-row">
      <input class="dinput" type="text" placeholder="Queue name" value="${esc(name)}" data-queue-name required>
      <input class="dinput" type="file" accept=".csv" data-queue-file required>
      <button type="button" class="btn" data-remove-queue>Remove</button>
    </div>`;
}

function renderGenerateCallLogs(el, state, { onSubmit }) {
  el.innerHTML = `
    <h4>Call logs</h4>
    <form id="genCallLogsForm" class="dr-generate-form">
      <label>Date<input class="dinput" type="date" name="date" required></label>
      <label>Inbound calls CSV<input class="dinput" type="file" name="inbound" accept=".csv" required></label>
      <label>Outbound calls CSV<input class="dinput" type="file" name="outbound" accept=".csv" required></label>
      <div class="dr-queue-list" id="genQueueList">${DEFAULT_QUEUES.map(queueRowHtml).join('')}</div>
      <button type="button" class="btn" id="genAddQueue">+ Add another queue file</button>
      <button class="btn btn-primary" type="submit"${state.busy ? ' disabled' : ''}>${state.busy ? 'Generating…' : 'Generate call logs'}</button>
    </form>
    ${state.message ? `<div class="take">${esc(state.message)}</div>` : ''}`;

  el.querySelector('#genAddQueue').addEventListener('click', () => {
    el.querySelector('#genQueueList').insertAdjacentHTML('beforeend', queueRowHtml(''));
  });
  el.querySelector('#genQueueList').addEventListener('click', (e) => {
    if (e.target.matches('[data-remove-queue]')) e.target.closest('.dr-queue-row').remove();
  });
  el.querySelector('#genCallLogsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const date = form.date.value;
    const inboundFile = form.inbound.files[0];
    const outboundFile = form.outbound.files[0];
    const queueRows = [...el.querySelectorAll('.dr-queue-row')];
    const queueEntries = queueRows.map((row) => ({
      name: row.querySelector('[data-queue-name]').value.trim(),
      file: row.querySelector('[data-queue-file]').files[0],
    }));
    if (!inboundFile || !outboundFile || queueEntries.some((q) => !q.name || !q.file)) {
      state.message = 'Fill in every field — date, inbound, outbound, and a name + file for each queue.';
      renderGenerateCallLogs(el, state, { onSubmit });
      return;
    }
    state.busy = true;
    state.message = null;
    renderGenerateCallLogs(el, state, { onSubmit });
    try {
      const [inbound, outbound, ...queueTexts] = await Promise.all([
        readFileText(inboundFile), readFileText(outboundFile), ...queueEntries.map((q) => readFileText(q.file)),
      ]);
      const queues = {};
      queueEntries.forEach((q, i) => { queues[q.name] = queueTexts[i]; });
      await onSubmit({ date, inbound, outbound, queues });
      state.message = `Generated for ${date}.`;
    } catch (err) {
      state.message = `Failed: ${err.message || err}`;
    } finally {
      state.busy = false;
      renderGenerateCallLogs(el, state, { onSubmit });
    }
  });
}

function renderGenerateCloop(el, state, { onSubmit }) {
  el.innerHTML = `
    <h4>Cloop</h4>
    <form id="genCloopForm" class="dr-generate-form">
      <label>Real-Time snapshot date<input class="dinput" type="date" name="date" required></label>
      <label>Historical reports cover (date)<input class="dinput" type="date" name="historicalDate" required></label>
      <label>Real-Time Metrics Report CSV<input class="dinput" type="file" name="realtime" accept=".csv" required></label>
      <label>Historical Metrics Report (queue) CSV<input class="dinput" type="file" name="queueHistorical" accept=".csv" required></label>
      <label>Historical Metrics Report (agent) CSV<input class="dinput" type="file" name="agentHistorical" accept=".csv" required></label>
      <button class="btn btn-primary" type="submit"${state.busy ? ' disabled' : ''}>${state.busy ? 'Generating…' : 'Generate Cloop'}</button>
    </form>
    ${state.message ? `<div class="take">${esc(state.message)}</div>` : ''}`;

  el.querySelector('#genCloopForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const date = form.date.value;
    const historicalDate = form.historicalDate.value;
    const realtimeFile = form.realtime.files[0];
    const queueHistFile = form.queueHistorical.files[0];
    const agentHistFile = form.agentHistorical.files[0];
    state.busy = true;
    state.message = null;
    renderGenerateCloop(el, state, { onSubmit });
    try {
      const [realtime, queueHistorical, agentHistorical] = await Promise.all([
        readFileText(realtimeFile), readFileText(queueHistFile), readFileText(agentHistFile),
      ]);
      await onSubmit({ date, historicalDate, realtime, queueHistorical, agentHistorical });
      state.message = `Generated for ${historicalDate}.`;
    } catch (err) {
      state.message = `Failed: ${err.message || err}`;
    } finally {
      state.busy = false;
      renderGenerateCloop(el, state, { onSubmit });
    }
  });
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

async function postGenerate(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

export async function renderChecklist(container) {
  let latest = null;
  let saving = false;
  let pollTimer = null;

  container.innerHTML = `
    <div id="checklistBoard"></div>
    <div class="panel dr-section-gap">
      <h3>Generate from raw files</h3>
      <p class="q">Upload the same raw exports the daily automated routine reads, and parse them right now. Runs alongside the daily routine, not instead of it — if this date already has a home in the dashboard (tasks and leave committed), the result is committed straight to GitHub; either way, the checklist above updates.</p>
      <div id="genCallLogsArea"></div>
      <div id="genCloopArea" class="dr-section-gap"></div>
    </div>`;
  const boardEl = container.querySelector('#checklistBoard');
  const genCallLogsEl = container.querySelector('#genCallLogsArea');
  const genCloopEl = container.querySelector('#genCloopArea');

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function drawBoard() {
    renderBoard(boardEl, latest, { saving, onSaveCases: save });
  }

  async function load() {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/checklist`, { credentials: 'same-origin' });
    } catch {
      stopPolling();
      renderMessage(boardEl, "Couldn't load", 'There was a problem reaching the checklist data.');
      return;
    }
    if (!res.ok) {
      stopPolling();
      renderMessage(boardEl, "Couldn't load", 'There was a problem reaching the checklist data.');
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

  async function save(values) {
    saving = true;
    drawBoard();
    try {
      const res = await fetch(`${API_BASE}/api/checklist/cases`, {
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

  renderGenerateCallLogs(genCallLogsEl, { busy: false, message: null }, {
    onSubmit: async (payload) => {
      await postGenerate('/api/generate/call-logs', payload);
      await load();
    },
  });
  renderGenerateCloop(genCloopEl, { busy: false, message: null }, {
    onSubmit: async (payload) => {
      await postGenerate('/api/generate/cloop', payload);
      await load();
    },
  });

  await load();
}
