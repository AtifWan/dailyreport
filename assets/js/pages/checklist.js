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

export async function renderChecklist(container) {
  let latest = null;
  let saving = false;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function drawBoard() {
    renderBoard(container, latest, { saving, onSaveCases: save });
  }

  async function load() {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/checklist`, { credentials: 'same-origin' });
    } catch {
      stopPolling();
      renderMessage(container, "Couldn't load", 'There was a problem reaching the checklist data.');
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

  await load();
}
