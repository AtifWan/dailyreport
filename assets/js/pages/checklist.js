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

export async function renderChecklist(container) {
  if (!window.claude || typeof window.claude.use !== 'function') {
    renderMessage(container, 'Not available here', 'The report checklist only works on the main published dashboard link.');
    return;
  }
  const user = await window.claude.use('user');
  const canEdit = user ? await user.canEdit() : false;
  if (!canEdit) {
    renderMessage(container, 'No access', "You don't have access to this page.");
    return;
  }
  const db = await window.claude.use('db');
  if (!db) {
    renderMessage(container, 'Not available here', 'The report checklist only works on the main published dashboard link.');
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
