import { esc, todayISOInCanberra, formatDate, fetchJSON } from '../util.js';
import { isWorkingDay } from '../workdays.js';

// The local upload server (scripts/upload_server.py) is the only backend this
// page talks to now — always http://127.0.0.1:<port>, regardless of whether
// this page itself is being viewed from the Vercel deployment or from inside
// the Artifact, because "local" here means the viewer's own machine, not this
// page's own origin. Raw files (including leave screenshots) go ONLY to this
// address — never to Vercel, GitHub, or anywhere else — so they never leave
// the machine the browser is running on.
const LOCAL_UPLOAD_BASE = 'http://127.0.0.1:8787';

function statusRow(label, done, subtitle) {
  // Grey = not started, green = done — a deliberate, page-specific exception
  // to the vendored design system's own blue "good" colour (see app.css's
  // own note on --success/--success-soft/--success-ink).
  return `
    <div class="dr-check-row">
      <span class="dr-check-dot${done ? ' on' : ''}"></span>
      <div class="dr-check-text">
        <div class="dr-check-label">${esc(label)}</div>
        ${subtitle ? `<div class="dr-check-sub">${esc(subtitle)}</div>` : ''}
      </div>
      <span class="pill${done ? ' dr-pill-done' : ''}"${done ? '' : ' style="background:var(--surface-sunk);color:var(--ink-muted)"'}>${done ? 'Done' : 'Pending'}</span>
    </div>`;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // readAsDataURL gives "data:<mime>;base64,<the actual base64>" — strip
    // everything up to and including the first comma.
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// One block per upload category: a file input (multiple files allowed, since
// a single day's Call Logs or Cloop upload is several CSVs at once) plus a
// running log of per-file save confirmations/errors. Every selected file is
// POSTed to the local upload server individually and immediately, so a
// failure partway through (e.g. the server isn't running) still leaves
// whichever files got through saved, with the log showing exactly which.

function parseCsvHeaderColumns(text) {
  const firstLine = text.replace(/^﻿/, '').split(/\r\n|\r|\n/, 1)[0] || '';
  return firstLine.split(',').map((c) => c.trim());
}

// --- Call Logs validation -------------------------------------------------
// One uniquely-identifying column per sub-type (confirmed against real raw
// exports seen all season), checked first to classify the file, then a full
// required-columns check against exactly what scripts/parse_call_logs.py
// itself reads (see that file) — so "this will actually parse" is the bar,
// not just "looks like a CSV".
const CALL_LOGS_SUBTYPES = {
  outbound: {
    label: 'Outbound',
    fullLabel: 'Outbound (ExportCallRecords)',
    marker: 'Direction',
    required: ['CallGUID', 'Direction', 'UserName', 'BillableTime'],
  },
  inbound: {
    label: 'Inbound',
    fullLabel: 'Inbound (InboundCalls_Detailed)',
    marker: 'CallAnsweredDateTime',
    required: ['CallGUID', 'CallDateTime', 'FirstUserName', 'TotalTalkTimeAllUsers', 'UserTimeToAnswer'],
  },
  queue: {
    label: 'Queue',
    fullLabel: 'Queue (CallQueue_Detailed)',
    marker: 'CallQueueName',
    required: ['CallGUID', 'CallDateTime', 'FirstUserName', 'UserTimeToAnswer', 'CallAnsweredInQueue', 'CallTimedOutOrExit'],
  },
};

async function validateCallLogsFile(file) {
  if (!/\.csv$/i.test(file.name)) {
    return { ok: false, error: `only .csv files are accepted here (got "${file.name}")` };
  }
  let text;
  try {
    text = await readFileText(file);
  } catch {
    return { ok: false, error: "couldn't read this file" };
  }
  const columns = new Set(parseCsvHeaderColumns(text));
  const subtypeKey = Object.keys(CALL_LOGS_SUBTYPES).find((k) => columns.has(CALL_LOGS_SUBTYPES[k].marker));
  if (!subtypeKey) {
    return { ok: false, error: "doesn't look like a Call Logs export we recognize (no matching columns — expected ExportCallRecords, InboundCalls_Detailed or CallQueue_Detailed)" };
  }
  const subtype = CALL_LOGS_SUBTYPES[subtypeKey];
  const missing = subtype.required.filter((c) => !columns.has(c));
  if (missing.length) {
    return { ok: false, error: `looks like ${subtype.fullLabel}, but is missing expected column(s): ${missing.join(', ')}` };
  }
  return { ok: true, subtypeKey, subtypeFullLabel: subtype.fullLabel };
}

// --- Cloop validation -------------------------------------------------------
// The Real-Time Metrics Report isn't a plain single-header-row CSV (see
// scripts/parse_cloop.py's own parse_realtime): row 0 is just the word
// "Queues", row 1 a group header, row 2 the real column header, read
// POSITIONALLY (r[9]="In queue", r[10]="Oldest") rather than by column name —
// so unlike the other two sub-types, validation here checks that row 2 matches
// this exact column sequence, not just that certain names are present
// somewhere in it.
const CLOOP_REALTIME_HEADER = ['', 'Online', 'On contact', 'NPT', 'ACW', 'Error', 'Available', 'Availability', 'Active', 'In queue', 'Oldest', 'Scheduled', 'Queued', 'Handled', 'Abandoned', 'AHT', 'SL 60 secs'];

const CLOOP_SUBTYPES = {
  realtime: { label: 'Real-Time', fullLabel: 'Real-Time Metrics Report' },
  queueHistorical: {
    label: 'Historical (queue)',
    fullLabel: 'Historical Metrics Report (queue)',
    marker: 'Queue',
    required: ['Queue', 'Contacts queued'],
  },
  agentHistorical: {
    label: 'Historical (agent)',
    fullLabel: 'Historical Metrics Report (agent)',
    marker: 'Agent',
    required: ['Agent', 'Contacts handled incoming', 'Contacts handled outbound', 'Contacts handled'],
  },
};

async function validateCloopFile(file) {
  if (!/\.csv$/i.test(file.name)) {
    return { ok: false, error: `only .csv files are accepted here (got "${file.name}")` };
  }
  let text;
  try {
    text = await readFileText(file);
  } catch {
    return { ok: false, error: "couldn't read this file" };
  }
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const firstLine = (lines[0] || '').trim();

  if (firstLine === 'Queues') {
    const colHeader = (lines[2] || '').split(',').map((c) => c.trim());
    const matches = colHeader.length === CLOOP_REALTIME_HEADER.length && colHeader.every((c, i) => c === CLOOP_REALTIME_HEADER[i]);
    if (!matches) {
      return { ok: false, error: "looks like a Real-Time Metrics Report, but its column layout on row 3 doesn't match what's expected — it may be from a different export or a changed format" };
    }
    return { ok: true, subtypeKey: 'realtime', subtypeFullLabel: CLOOP_SUBTYPES.realtime.fullLabel };
  }

  const columns = new Set(parseCsvHeaderColumns(text));
  const subtypeKey = Object.keys(CLOOP_SUBTYPES).find((k) => CLOOP_SUBTYPES[k].marker && columns.has(CLOOP_SUBTYPES[k].marker));
  if (!subtypeKey) {
    return { ok: false, error: "doesn't look like a Cloop export we recognize (expected a Real-Time Metrics Report, or a Historical Metrics Report for either queue or agent)" };
  }
  const subtype = CLOOP_SUBTYPES[subtypeKey];
  const missing = subtype.required.filter((c) => !columns.has(c));
  if (missing.length) {
    return { ok: false, error: `looks like ${subtype.fullLabel}, but is missing expected column(s): ${missing.join(', ')}` };
  }
  return { ok: true, subtypeKey, subtypeFullLabel: subtype.fullLabel };
}

// --- Per-day readiness state (browser-local only; see localStorage note) --
// What's "ready" has to survive a page reload within the same day without a
// server round trip, but must never be mistaken for yesterday's leftovers —
// keyed by today's own date, read fresh from localStorage every render.
// Shared across categories (Call Logs, Cloop, ...) by category key.
function entriesStorageKey(category, dateIso) {
  return `dr-checklist-${category}-${dateIso}`;
}

function loadEntries(category, dateIso) {
  try {
    return JSON.parse(localStorage.getItem(entriesStorageKey(category, dateIso))) || [];
  } catch {
    return [];
  }
}

// allowMultiple=false (the default — see each subtype's own config in
// UPLOAD_CATEGORIES) means a fresh upload for the same sub-type REPLACES the
// one already recorded today rather than piling up alongside it — the
// graceful way to recover from dropping the wrong file: just drop the right
// one in after it. Only Call Logs' "Queue" sub-type sets allowMultiple:true,
// since several distinct queue files are genuinely expected the same day.
// Either way this never touches the actual saved file on disk — only which
// entry this page's own readiness tracking currently points at.
function saveEntry(category, dateIso, entry, allowMultiple) {
  const existing = loadEntries(category, dateIso);
  const entries = allowMultiple ? existing : existing.filter((e) => e.subtypeKey !== entry.subtypeKey);
  entries.push(entry);
  try {
    localStorage.setItem(entriesStorageKey(category, dateIso), JSON.stringify(entries));
  } catch {
    // localStorage can be unavailable (private browsing, quota) — the upload
    // itself already succeeded, so just skip persisting the readiness tick
    // rather than failing the whole upload over it.
  }
  return entries;
}

// The Cloop "Total Cases to Date" status is explicitly not a file (Cloop has
// no raw export for it) — a few typed numbers, stored the same local-only
// way as the file-upload readiness ticks, just under its own key.
function statusStorageKey(category, dateIso) {
  return `dr-checklist-${category}-status-${dateIso}`;
}

function loadStatusValue(category, dateIso) {
  try {
    return JSON.parse(localStorage.getItem(statusStorageKey(category, dateIso))) || {};
  } catch {
    return {};
  }
}

function saveStatusValue(category, dateIso, value) {
  try {
    localStorage.setItem(statusStorageKey(category, dateIso), JSON.stringify(value));
  } catch {
    // see saveEntry's own note — not fatal, just means the tick won't persist.
  }
}

// Cloop's two report dates: the day the Real-Time snapshot was taken (always
// today, by construction — it's a live view) and the day the two Historical
// reports cover (the most recently completed BUSINESS day — see
// scripts/parse_cloop.py's own docstring on why that's deliberately not
// auto-guessed as "yesterday": a weekend or public holiday breaks that simple
// rule). Defaulted here using the same isWorkingDay() the rest of this
// project already uses for exactly that reason, but left fully editable,
// stored per-day like the rest of this page's local-only state.
function cloopDatesStorageKey(dateIso) {
  return `dr-checklist-cloop-dates-${dateIso}`;
}

function defaultCloopDates(dateIso) {
  let d = new Date(`${dateIso}T00:00:00Z`);
  do {
    d = new Date(d.getTime() - 86400000);
  } while (!isWorkingDay(d.toISOString().slice(0, 10)));
  return { realtimeDate: dateIso, historicalDate: d.toISOString().slice(0, 10) };
}

function loadCloopDatesValue(dateIso) {
  try {
    const saved = JSON.parse(localStorage.getItem(cloopDatesStorageKey(dateIso)));
    if (saved && saved.realtimeDate && saved.historicalDate) return saved;
  } catch {
    // fall through to the computed default
  }
  return defaultCloopDates(dateIso);
}

function saveCloopDatesValue(dateIso, value) {
  try {
    localStorage.setItem(cloopDatesStorageKey(dateIso), JSON.stringify(value));
  } catch {
    // see saveEntry's own note — not fatal, just means it won't persist.
  }
}

function formatSydneyTime(isoTimestamp) {
  // Matches this project's established "7:49 AM" style (uppercase AM/PM,
  // baked into every committed JSON file's own time strings) rather than
  // the lowercase "am"/"pm" some ICU locale data gives by default.
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(isoTimestamp)).toUpperCase();
}

// --- Undated, cumulative entry list (Staff and Drs Leaves only) -----------
// Unlike Call Logs/Cloop, leave screenshots are a WEEKLY artifact, not a
// daily one — "is today ready" depends on whether *any* past upload is still
// current, not just today's. So this keeps every upload ever made (via this
// UI) in one list, each entry carrying its own Sydney-calendar date, rather
// than bucketing storage by day the way entriesStorageKey() does.
function allEntriesStorageKey(category) {
  return `dr-checklist-${category}-all-entries`;
}

function loadAllEntries(category) {
  try {
    return JSON.parse(localStorage.getItem(allEntriesStorageKey(category))) || [];
  } catch {
    return [];
  }
}

function appendAllEntry(category, entry) {
  const entries = loadAllEntries(category);
  entries.push(entry);
  try {
    localStorage.setItem(allEntriesStorageKey(category), JSON.stringify(entries));
  } catch {
    // see saveEntry's own note — not fatal, just means the tick won't persist.
  }
  return entries;
}

// "Does the leave data need updating today?" is answered at most once per
// day — recorded here so reopening the checklist later the same day doesn't
// ask again.
function dailyAnswerStorageKey(category, dateIso) {
  return `dr-checklist-${category}-answer-${dateIso}`;
}

function loadDailyAnswer(category, dateIso) {
  try {
    return localStorage.getItem(dailyAnswerStorageKey(category, dateIso));
  } catch {
    return null;
  }
}

function saveDailyAnswer(category, dateIso, answer) {
  try {
    localStorage.setItem(dailyAnswerStorageKey(category, dateIso), answer);
  } catch {
    // not fatal — worst case the question just gets asked again next load.
  }
}

function statusFieldsDone(statusFields, statusValue) {
  return statusFields.every((f) => Number.isFinite(Number(statusValue[f.key])) && String(statusValue[f.key]).trim() !== '');
}

// Generic readiness row for any upload category: ticks Done once every
// required file sub-type has at least one entry today, and (if the category
// also needs one) every typed status field has a value.
function renderReadiness(el, { title, subtypes, entries, statusValue, statusRequired, statusLabel, statusFields }) {
  const have = {};
  subtypes.forEach((s) => { have[s.key] = entries.filter((e) => e.subtypeKey === s.key); });
  const filesDone = subtypes.every((s) => have[s.key].length > 0);
  const statusDone = !statusRequired || statusFieldsDone(statusFields, statusValue);
  const done = filesDone && statusDone;

  const parts = subtypes.filter((s) => have[s.key].length)
    .map((s) => `${s.label}: ${have[s.key].map((e) => `${e.originalName} at ${formatSydneyTime(e.at)}`).join(', ')}`);
  if (statusRequired && statusDone) {
    parts.push(`${statusLabel}: ${statusFields.map((f) => `${f.label} ${statusValue[f.key]}`).join(', ')} (entered at ${formatSydneyTime(statusValue._savedAt)})`);
  }

  const missing = subtypes.filter((s) => !have[s.key].length).map((s) => s.label);
  if (statusRequired && !statusDone) missing.push(statusLabel);

  // One plain "last updated" headline up front — the per-file/-field detail
  // below it is useful, but this is the "at a glance" date/time this page
  // was asked for, independent of how many parts make it up.
  const timestamps = [...entries.map((e) => e.at), ...(statusRequired && statusValue && statusValue._savedAt ? [statusValue._savedAt] : [])];
  const lastUpdated = timestamps.length ? timestamps.reduce((a, b) => (a > b ? a : b)) : null;
  const headline = lastUpdated ? `Last updated ${shortSydneyDate(todayISOInCanberra())} at ${formatSydneyTime(lastUpdated)}` : null;

  const subtitleParts = [headline, ...parts].filter(Boolean);
  el.innerHTML = statusRow(title, done, subtitleParts.length ? subtitleParts.join(' · ') : null)
    + (!done && missing.length ? `<p class="q" style="margin-top:4px">Still need: ${esc(missing.join(', '))}.</p>` : '');
}

function renderReadinessForCategory(el, cat) {
  const today = todayISOInCanberra();
  const entries = loadEntries(cat.key, today);
  const statusValue = cat.readiness.statusRequired ? loadStatusValue(cat.key, today) : null;
  renderReadiness(el, {
    title: cat.title,
    subtypes: cat.readiness.subtypes,
    entries,
    statusValue,
    statusRequired: cat.readiness.statusRequired,
    statusLabel: cat.readiness.statusLabel,
    statusFields: cat.readiness.statusFields,
  });
}

// Same look as the existing (Vercel-backed) "Enter Total Cases to Date" form
// elsewhere on this page — reuses .dr-cases-form — but this one is purely
// local (see loadStatusValue/saveStatusValue), scoped to this upload
// category's own readiness tick, not the remote checklist board.
function renderStatusField(el, cat, readinessEl) {
  const today = todayISOInCanberra();
  const current = loadStatusValue(cat.key, today);
  const fields = cat.readiness.statusFields;
  el.innerHTML = `
    <h5>${esc(cat.readiness.statusHeading)}</h5>
    <p class="q">${esc(cat.readiness.statusHint)}</p>
    <form class="dr-cases-form">
      ${fields.map((f) => `<label>${esc(f.label)}<input class="dinput" type="number" name="${esc(f.key)}" value="${current[f.key] ?? ''}" required></label>`).join('')}
      <button class="btn btn-primary" type="submit">Save</button>
    </form>`;
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const value = { _savedAt: new Date().toISOString() };
    fields.forEach((f) => { value[f.key] = Number(fd.get(f.key)); });
    saveStatusValue(cat.key, today, value);
    renderStatusField(el, cat, readinessEl);
    if (readinessEl) renderReadinessForCategory(readinessEl, cat);
  });
}

// Cloop-only: the two dates the Generate step needs to tell the Real-Time
// snapshot apart from the Historical reports' own coverage date (see
// cloopDatesStorageKey's own note on why these can't just be "today" and
// "yesterday"). Not part of the Done/Pending readiness tick above — the
// files and Total Cases to Date already decide that — just metadata Generate
// reads later.
function renderCloopDates(el) {
  const today = todayISOInCanberra();
  const current = loadCloopDatesValue(today);
  el.innerHTML = `
    <h5>Cloop report dates</h5>
    <p class="q">Defaults to today (Real-Time) and the most recent business day (Historical) — change these if that's wrong.</p>
    <form class="dr-cases-form">
      <label>Real-Time snapshot date<input class="dinput" type="date" name="realtimeDate" value="${esc(current.realtimeDate)}" required></label>
      <label>Historical reports cover date<input class="dinput" type="date" name="historicalDate" value="${esc(current.historicalDate)}" required></label>
      <button class="btn btn-primary" type="submit">Save</button>
    </form>`;
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    saveCloopDatesValue(today, { realtimeDate: fd.get('realtimeDate'), historicalDate: fd.get('historicalDate') });
    renderCloopDates(el);
  });
}

const UPLOAD_CATEGORIES = [
  {
    key: 'call-logs', title: 'Call Logs', folder: 'Call Logs', accept: '.csv',
    hint: 'The raw ExportCallRecords, InboundCalls_Detailed and CallQueue_Detailed CSVs for the day — drag them in or click to browse.',
    dropzone: true, validate: validateCallLogsFile,
    readiness: {
      subtypes: [{ key: 'outbound', label: 'Outbound' }, { key: 'inbound', label: 'Inbound' }, { key: 'queue', label: 'Queue', multiple: true }],
      statusRequired: false,
    },
  },
  {
    key: 'cloop', title: 'Cloop', folder: 'Cloop', accept: '.csv',
    hint: 'The Real Time Metrics Report and the two Historical Metrics Report CSVs — drag them in or click to browse.',
    dropzone: true, validate: validateCloopFile,
    readiness: {
      subtypes: [{ key: 'realtime', label: 'Real-Time' }, { key: 'queueHistorical', label: 'Historical (queue)' }, { key: 'agentHistorical', label: 'Historical (agent)' }],
      statusRequired: true,
      statusLabel: 'Total Cases to Date',
      statusHeading: 'Enter Total Cases to Date',
      statusHint: "From Cloop's own Status sheet — there's no automated export for this yet.",
      statusFields: [
        { key: 'totalOverallCases', label: 'Total overall cases' },
        { key: 'totalInProgress', label: 'Total in progress' },
        { key: 'totalOpenCases', label: 'Total open cases' },
      ],
    },
  },
  {
    key: 'leave', title: 'Staff and Drs Leaves', folder: 'Staff and Drs Leaves',
    hint: 'A simple weekly grid — who’s available, on leave, or on a public holiday, Monday to Friday. Updating this is a weekly job, not a daily one, so most days you’ll just confirm the existing week is still current rather than editing anything.',
  },
];

function uploadLogRowHtml(entry) {
  const icon = entry.ok ? '✓' : '✕';
  const label = entry.ok ? `Saved <b>${esc(entry.savedAs)}</b> to <b>${esc(entry.folder)}/</b>${entry.subtypeFullLabel ? ` — ${esc(entry.subtypeFullLabel)}` : ''}` : `${esc(entry.filename)} — ${esc(entry.error)}`;
  return `<div class="dr-upload-log-row${entry.ok ? '' : ' err'}">
    <span class="dr-upload-log-icon">${icon}</span>
    <span>${label}</span>
  </div>`;
}

async function uploadOneFile(category, file) {
  const contentBase64 = await readFileBase64(file);
  const res = await fetch(`${LOCAL_UPLOAD_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, filename: file.name, contentBase64 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

function dropzoneHtml(cat, busy) {
  return `
    <label class="dr-dropzone" tabindex="0">
      <input class="dr-dropzone-input" type="file" accept="${esc(cat.accept)}" multiple ${busy ? 'disabled' : ''}>
      <span class="dr-dropzone-text">Drag files here, or click to browse</span>
    </label>`;
}

// --- Staff and Drs Leaves: its own flow, not the generic one above --------
// Leave screenshots only change weekly, so unlike Call Logs/Cloop this isn't
// "upload today's files" every day — most days the right answer is "nothing's
// changed, keep using what's there". The daily question only appears when
// there's something to decide (history exists, nothing uploaded yet today,
// not already answered today); otherwise it just shows the resulting state.
function shortSydneyDate(dateIso) {
  return formatDate(dateIso, { weekday: 'short', day: 'numeric', month: 'short' });
}

// --- Staff and Drs Leaves: typed weekly grid, not screenshots -------------
// A GP Calendar screenshot and a staff leave-list screenshot are hard to
// read reliably (wrong-week screenshots, ambiguous multi-day bars) — this
// form lets whoever's updating leave type the same weekly grid the dashboard
// already shows, directly, with no image interpretation needed at all.
const LEAVE_STATUS_CYCLE = ['available', 'leave', 'public_holiday'];
const LEAVE_STATUS_META = {
  available: { label: 'Available', bg: 'var(--live-soft)', ink: 'var(--live-ink)' },
  leave: { label: 'Leave', bg: 'var(--danger-soft)', ink: 'var(--danger-ink)' },
  public_holiday: { label: 'Public holiday', bg: 'var(--infer-soft)', ink: 'var(--infer-ink)' },
};
const LEAVE_DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function blankLeaveGrid() {
  return { groups: [{ group: 'Doctor', people: [] }, { group: 'Staff', people: [] }], longTerm: [] };
}

// Pre-fills the form from the most recently committed leave.json — most
// weeks only a handful of people's days actually change, so starting from
// last week's grid means only touching what's different. Walks backwards
// through the manifest since not every date necessarily has its own
// leave.json (carried-forward dates reuse an earlier one).
async function loadTemplateLeaveGrid() {
  try {
    const manifest = await fetchJSON('assets/data/reports/index.json');
    const dates = [...(manifest.dates || [])].sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      try {
        const d = await fetchJSON(`assets/data/reports/${dates[i]}/leave.json`);
        if (d && Array.isArray(d.groups)) {
          return {
            groups: d.groups.map((g) => ({
              group: g.group,
              people: g.people.map((p) => ({ name: p.name, status: Array.isArray(p.status) ? [...p.status] : LEAVE_DAY_SHORT.map(() => 'available') })),
            })),
            longTerm: (d.longTerm || []).map((x) => ({ ...x })),
          };
        }
      } catch { /* this date has no leave.json — try an earlier one */ }
    }
  } catch { /* no manifest reachable at all — fall through to blank */ }
  return blankLeaveGrid();
}

function mondayOf(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

function leaveWeekLabel(dateIso) {
  const start = mondayOf(dateIso);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 4);
  const fmt = (dt) => dt.toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function leaveGridFormHtml(state) {
  const grid = state.leaveGrid;
  const today = todayISOInCanberra();

  const groupsHtml = grid.groups.map((g) => `
    <div class="dr-leave-grid-group">
      <h5>${esc(g.group)}</h5>
      <div class="dr-leave-grid-table-wrap">
        <table class="dr-leave-grid-table">
          <thead><tr><th>Name</th>${LEAVE_DAY_SHORT.map((d) => `<th>${d}</th>`).join('')}<th></th></tr></thead>
          <tbody>
            ${g.people.map((p, pi) => `
              <tr>
                <td><input type="text" class="dinput dr-leave-name-input" placeholder="Name" data-group="${esc(g.group)}" data-person="${pi}" value="${esc(p.name)}"></td>
                ${p.status.map((s, di) => {
                  const meta = LEAVE_STATUS_META[s] || LEAVE_STATUS_META.available;
                  return `<td><button type="button" class="dr-leave-cell" data-group="${esc(g.group)}" data-person="${pi}" data-day="${di}" style="background:${meta.bg};color:${meta.ink}">${esc(meta.label)}</button></td>`;
                }).join('')}
                <td><button type="button" class="dr-leave-remove" data-group="${esc(g.group)}" data-person="${pi}" aria-label="Remove row" title="Remove">&times;</button></td>
              </tr>`).join('')}
            ${!g.people.length ? `<tr><td colspan="${LEAVE_DAY_SHORT.length + 2}" class="dr-leave-grid-empty">No one listed yet.</td></tr>` : ''}
          </tbody>
        </table>
      </div>
      <button type="button" class="btn dr-leave-add-person" data-group="${esc(g.group)}">+ Add ${esc(g.group.toLowerCase())}</button>
    </div>`).join('');

  const longTermHtml = `
    <div class="dr-leave-grid-group">
      <h5>Long-term leave</h5>
      ${grid.longTerm.length ? `
      <div class="dr-leave-grid-table-wrap">
        <table class="dr-leave-grid-table dr-leave-grid-longterm">
          <thead><tr><th>Name</th><th>Note</th><th>From</th><th>To</th><th></th></tr></thead>
          <tbody>
            ${grid.longTerm.map((lt, li) => `
              <tr>
                <td><input type="text" class="dinput" placeholder="Name" data-lt="${li}" data-field="name" value="${esc(lt.name || '')}"></td>
                <td><input type="text" class="dinput" placeholder="e.g. Maternity Leave" data-lt="${li}" data-field="note" value="${esc(lt.note || '')}"></td>
                <td><input type="date" class="dinput" data-lt="${li}" data-field="from" value="${esc(lt.from || '')}"></td>
                <td><input type="date" class="dinput" data-lt="${li}" data-field="to" value="${esc(lt.to || '')}"></td>
                <td><button type="button" class="dr-leave-remove" data-lt-remove="${li}" aria-label="Remove row" title="Remove">&times;</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="q">None recorded.</p>'}
      <button type="button" class="btn" data-lt-add>+ Add long-term leave</button>
    </div>`;

  return `
    <div class="dr-leave-grid">
      <p class="q"><b>Week of ${esc(leaveWeekLabel(today))}</b> — click a day to cycle Available → Leave → Public holiday.</p>
      ${groupsHtml}
      ${longTermHtml}
      ${state.leaveGridError ? `<p class="q" style="color:var(--danger-ink)">${esc(state.leaveGridError)}</p>` : ''}
      <div class="dr-leave-grid-actions">
        <button type="button" class="btn" data-leave-grid-cancel ${state.leaveGridBusy ? 'disabled' : ''}>Cancel</button>
        <button type="button" class="btn btn-primary" data-leave-grid-save ${state.leaveGridBusy ? 'disabled' : ''}>${state.leaveGridBusy ? 'Saving…' : "Save this week's leave"}</button>
      </div>
    </div>`;
}

function wireLeaveGridForm(el, cat, state) {
  const groupByName = (name) => state.leaveGrid.groups.find((g) => g.group === name);

  el.querySelectorAll('.dr-leave-cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = groupByName(btn.dataset.group);
      const person = g.people[Number(btn.dataset.person)];
      const day = Number(btn.dataset.day);
      const next = (LEAVE_STATUS_CYCLE.indexOf(person.status[day]) + 1) % LEAVE_STATUS_CYCLE.length;
      person.status[day] = LEAVE_STATUS_CYCLE[next];
      renderLeaveBlock(el, cat, state);
    });
  });
  el.querySelectorAll('.dr-leave-name-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const g = groupByName(inp.dataset.group);
      g.people[Number(inp.dataset.person)].name = inp.value;
    });
  });
  el.querySelectorAll('.dr-leave-remove[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = groupByName(btn.dataset.group);
      g.people.splice(Number(btn.dataset.person), 1);
      renderLeaveBlock(el, cat, state);
    });
  });
  el.querySelectorAll('.dr-leave-add-person').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = groupByName(btn.dataset.group);
      g.people.push({ name: '', status: LEAVE_DAY_SHORT.map(() => 'available') });
      renderLeaveBlock(el, cat, state);
    });
  });
  el.querySelectorAll('[data-lt]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.leaveGrid.longTerm[Number(inp.dataset.lt)][inp.dataset.field] = inp.value;
    });
  });
  el.querySelectorAll('[data-lt-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.leaveGrid.longTerm.splice(Number(btn.dataset.ltRemove), 1);
      renderLeaveBlock(el, cat, state);
    });
  });
  const addLt = el.querySelector('[data-lt-add]');
  if (addLt) addLt.addEventListener('click', () => {
    state.leaveGrid.longTerm.push({ name: '', note: '', from: '', to: '' });
    renderLeaveBlock(el, cat, state);
  });

  const cancelBtn = el.querySelector('[data-leave-grid-cancel]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    state.forceOpen = false;
    state.leaveGridError = null;
    renderLeaveBlock(el, cat, state);
  });

  const saveBtn = el.querySelector('[data-leave-grid-save]');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const today = todayISOInCanberra();
    const groups = state.leaveGrid.groups.map((g) => ({ group: g.group, people: g.people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), site: null, status: p.status })) }));
    const longTerm = state.leaveGrid.longTerm.filter((lt) => lt.name.trim() && lt.from && lt.to);
    state.leaveGridBusy = true;
    state.leaveGridError = null;
    renderLeaveBlock(el, cat, state);
    try {
      // Unlike Call Logs/Cloop, this doesn't need a CSV parser running
      // anywhere — it's typed data, so it goes straight to this page's own
      // Vercel API (api/generate/leave-grid.py), which commits leave.json to
      // GitHub itself. No local upload server involved for Leave at all.
      const res = await fetch('/api/generate/leave-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, groups, longTerm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `request failed (${res.status})`);
      if (body.mainBranchError) {
        throw new Error(`saved, but the live site may not show it yet (${body.mainBranchError})`);
      }
      appendAllEntry(cat.key, { originalName: "typed leave grid", savedAs: body.relativePath, at: new Date().toISOString(), dateIso: today });
      saveDailyAnswer(cat.key, today, 'yes');
      state.forceOpen = false;
      state.leaveGrid = null;
    } catch (err) {
      state.leaveGridError = err.message || String(err);
    }
    state.leaveGridBusy = false;
    renderLeaveBlock(el, cat, state);
  });
}

// Fires the (async) template load the first time the form needs to be shown,
// however it got triggered (the Yes/No question, the "Edit" button, or
// straight away because there's no history yet) — idempotent, so calling it
// on every render is harmless once the load is in flight or done.
function ensureLeaveGridLoaded(el, cat, state) {
  if (state.leaveGrid || state.leaveGridLoading) return;
  state.leaveGridLoading = true;
  loadTemplateLeaveGrid().then((grid) => {
    state.leaveGrid = grid;
    state.leaveGridLoading = false;
    renderLeaveBlock(el, cat, state);
  });
}

function renderLeaveBlock(el, cat, state) {
  const today = todayISOInCanberra();
  const allEntries = loadAllEntries(cat.key);
  const mostRecent = allEntries.length ? allEntries[allEntries.length - 1] : null;
  const todaysEntries = allEntries.filter((e) => e.dateIso === today);
  const answer = loadDailyAnswer(cat.key, today);

  const showQuestion = !!mostRecent && todaysEntries.length === 0 && answer === null;
  // Once today's entry exists (a save already went through), the form
  // collapses back to the "Done" status row + "Edit this week's leave"
  // button — unlike the old per-file dropzone, there's nothing left to add
  // after one successful save, so `answer === 'yes'` only keeps reopening
  // the form while that save hasn't happened yet (e.g. the page was
  // reloaded mid-edit).
  const showForm = state.forceOpen || !mostRecent || (answer === 'yes' && todaysEntries.length === 0);
  if (showForm) ensureLeaveGridLoaded(el, cat, state);

  const mostRecentBatch = mostRecent ? allEntries.filter((e) => e.dateIso === mostRecent.dateIso) : [];
  const lastUpdatedLabel = mostRecent ? `${shortSydneyDate(mostRecent.dateIso)} (${mostRecentBatch.map((e) => e.originalName).join(', ')})` : null;

  let statusHtml;
  if (todaysEntries.length > 0) {
    statusHtml = statusRow(cat.title, true, `Last updated ${shortSydneyDate(today)} · ${todaysEntries.map((e) => `${e.originalName} at ${formatSydneyTime(e.at)}`).join(', ')}`);
  } else if (answer === 'no' && mostRecent) {
    statusHtml = statusRow(cat.title, true, `Last updated ${lastUpdatedLabel} (reused today)`);
  } else {
    statusHtml = statusRow(cat.title, false, mostRecent ? `Last updated ${lastUpdatedLabel}` : null);
  }

  el.innerHTML = `
    ${statusHtml}
    <h5 class="dr-section-gap">${esc(cat.title)}</h5>
    <p class="q">${esc(cat.hint)}</p>
    ${showQuestion ? `
      <div class="dr-leave-question">
        <p class="q" style="margin:0 0 8px">Does the leave data need updating today? <span class="dr-check-sub">(last updated ${esc(lastUpdatedLabel)})</span></p>
        <div class="dr-leave-question-btns">
          <button type="button" class="btn" data-leave-answer="no">No — reuse those</button>
          <button type="button" class="btn btn-primary" data-leave-answer="yes">Yes — I have new ones</button>
        </div>
      </div>` : ''}
    ${!showQuestion && !showForm ? '<button type="button" class="btn" data-leave-force-open>Edit this week\'s leave</button>' : ''}
    ${showForm ? (state.leaveGridLoading || !state.leaveGrid ? '<p class="q">Loading last week\'s grid…</p>' : leaveGridFormHtml(state)) : ''}`;

  el.querySelectorAll('[data-leave-answer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveDailyAnswer(cat.key, today, btn.dataset.leaveAnswer);
      if (btn.dataset.leaveAnswer === 'yes') state.forceOpen = true;
      renderLeaveBlock(el, cat, state);
    });
  });
  const forceBtn = el.querySelector('[data-leave-force-open]');
  if (forceBtn) forceBtn.addEventListener('click', () => {
    state.forceOpen = true;
    renderLeaveBlock(el, cat, state);
  });

  if (showForm && state.leaveGrid && !state.leaveGridLoading) wireLeaveGridForm(el, cat, state, el);
}

async function handleFiles(el, cat, state, files, readinessEl) {
  state.busy = true;
  renderUploadBlock(el, cat, state, readinessEl);
  for (const file of files) {
    let validation = { ok: true };
    if (cat.validate) validation = await cat.validate(file);
    if (!validation.ok) {
      state.log.unshift({ ok: false, filename: file.name, error: validation.error });
      renderUploadBlock(el, cat, state, readinessEl);
      continue; // invalid files are never sent to the upload server at all
    }
    try {
      const result = await uploadOneFile(cat.key, file);
      state.log.unshift({ ok: true, savedAs: result.savedAs, folder: result.folder, subtypeFullLabel: validation.subtypeFullLabel });
      if (readinessEl && validation.subtypeKey) {
        const subtypeConfig = cat.readiness.subtypes.find((s) => s.key === validation.subtypeKey);
        saveEntry(
          cat.key, todayISOInCanberra(),
          { subtypeKey: validation.subtypeKey, originalName: file.name, savedAs: result.savedAs, at: new Date().toISOString() },
          subtypeConfig && subtypeConfig.multiple,
        );
        renderReadinessForCategory(readinessEl, cat);
      }
    } catch (err) {
      // fetch() itself throws a TypeError for a network-level failure (e.g.
      // nothing listening on LOCAL_UPLOAD_BASE) — anything else is a real
      // error response from the server, so show its own message instead.
      const networkError = err instanceof TypeError;
      state.log.unshift({
        ok: false,
        filename: file.name,
        error: networkError ? "couldn't reach the local upload server — is `python3 scripts/upload_server.py` running?" : (err.message || String(err)),
      });
    }
    renderUploadBlock(el, cat, state, readinessEl);
  }
  state.busy = false;
  renderUploadBlock(el, cat, state, readinessEl);
}

function renderUploadBlock(el, cat, state, readinessEl) {
  el.innerHTML = `
    <h5>${esc(cat.title)}</h5>
    <p class="q">${esc(cat.hint)}</p>
    ${cat.dropzone ? dropzoneHtml(cat, state.busy) : `<input class="dinput" type="file" accept="${esc(cat.accept)}" multiple ${state.busy ? 'disabled' : ''}>`}
    <div class="dr-upload-log">${state.log.map(uploadLogRowHtml).join('')}</div>`;

  const input = el.querySelector('input[type="file"]');
  input.addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (files.length) handleFiles(el, cat, state, files, readinessEl);
  });

  if (cat.dropzone) {
    const zone = el.querySelector('.dr-dropzone');
    ['dragenter', 'dragover'].forEach((evt) => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((evt) => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) handleFiles(el, cat, state, files, readinessEl);
    });
  }
}

// Clears today's Call Logs/Cloop progress and today's leave yes/no answer —
// local tracking only. Never touches a saved file (nothing in Call Logs/,
// Cloop/ or Staff and Drs Leaves/ is deleted) and never touches the leave
// screenshot history itself, which is weekly, not daily.
function startNewDay(container) {
  const today = todayISOInCanberra();
  const ok = confirm(
    "Start a new day?\n\nThis clears today's Call Logs and Cloop progress and today's leave "
    + "answer, on this browser only. It does NOT delete any saved files, and your leave "
    + 'screenshot history is kept.',
  );
  if (!ok) return;
  try {
    localStorage.removeItem(entriesStorageKey('call-logs', today));
    localStorage.removeItem(entriesStorageKey('cloop', today));
    localStorage.removeItem(statusStorageKey('cloop', today));
    localStorage.removeItem(dailyAnswerStorageKey('leave', today));
  } catch {
    // if localStorage is unavailable there's nothing to clear anyway
  }
  renderUploadSection(container);
}

function renderUploadSection(container) {
  container.innerHTML = `
    <div class="panel">
      <div class="dr-panel-header-row">
        <h3>Upload today's files</h3>
        <button type="button" class="btn" id="startNewDayBtn">Start a new day</button>
      </div>
      <p class="q">Call Logs and Cloop are saved straight to folders in this repo on your own machine — nothing there is sent to GitHub, Vercel, or anywhere else — and need the local upload server running (<code>python3 scripts/upload_server.py</code>). Staff and Drs Leave is different: it saves straight from this website, no local server needed.</p>
      <div class="dr-upload-grid">
        <div class="dr-upload-block" id="upload-call-logs"></div>
        <div class="dr-upload-block" id="upload-cloop"></div>
        <div class="dr-upload-block" id="upload-leave"></div>
      </div>
    </div>`;
  container.querySelector('#startNewDayBtn').addEventListener('click', () => startNewDay(container));
  UPLOAD_CATEGORIES.forEach((cat) => {
    const blockEl = container.querySelector(`#upload-${cat.key}`);
    if (cat.key === 'leave') {
      renderLeaveBlock(blockEl, cat, { forceOpen: false, leaveGrid: null, leaveGridLoading: false, leaveGridBusy: false, leaveGridError: null });
      return;
    }
    let readinessEl = null;
    if (cat.readiness) {
      readinessEl = document.createElement('div');
      readinessEl.className = 'dr-section-gap';
      blockEl.before(readinessEl);
      renderReadinessForCategory(readinessEl, cat);
    }
    renderUploadBlock(blockEl, cat, { busy: false, log: [] }, readinessEl);
    let afterEl = blockEl;
    if (cat.key === 'cloop') {
      const datesEl = document.createElement('div');
      datesEl.className = 'dr-section-gap';
      afterEl.after(datesEl);
      renderCloopDates(datesEl);
      afterEl = datesEl;
    }
    if (cat.readiness && cat.readiness.statusRequired) {
      const statusEl = document.createElement('div');
      statusEl.className = 'dr-section-gap';
      afterEl.after(statusEl);
      renderStatusField(statusEl, cat, readinessEl);
    }
  });
}

// --- Step 4: Generate today's report ---------------------------------------
// Re-derives the same "is this category done" logic renderReadiness/
// renderLeaveBlock already compute for their own on-screen ticks, rather than
// reading it back off the DOM — this only needs to know yes/no, not render
// anything.
function categoryDoneCallLogsOrCloop(cat) {
  const today = todayISOInCanberra();
  const entries = loadEntries(cat.key, today);
  const have = {};
  cat.readiness.subtypes.forEach((s) => { have[s.key] = entries.filter((e) => e.subtypeKey === s.key); });
  const filesDone = cat.readiness.subtypes.every((s) => have[s.key].length > 0);
  if (!cat.readiness.statusRequired) return filesDone;
  return filesDone && statusFieldsDone(cat.readiness.statusFields, loadStatusValue(cat.key, today));
}

function leaveDone() {
  const today = todayISOInCanberra();
  const allEntries = loadAllEntries('leave');
  const mostRecent = allEntries.length ? allEntries[allEntries.length - 1] : null;
  const todaysEntries = allEntries.filter((e) => e.dateIso === today);
  const answer = loadDailyAnswer('leave', today);
  return todaysEntries.length > 0 || (answer === 'no' && !!mostRecent);
}

// The pop-up shown while Generate runs and once it finishes — one native
// <dialog> per page load (created in renderChecklist, reused here by id),
// its content swapped between loading/done/error states rather than a new
// dialog opened each time. Native <dialog> gives the backdrop, centering and
// Escape-to-close for free.
function renderDialogLoading(dialog, date) {
  dialog.innerHTML = `
    <div class="dr-dialog-body">
      <div class="dr-spinner" aria-hidden="true"></div>
      <h3>Generating ${esc(date)}'s report…</h3>
      <p class="q">Parsing today's files and writing the report — this takes a few seconds.</p>
    </div>`;
}

function renderDialogDone(dialog, result, date) {
  const lines = Object.entries(result.written || {}).map(([, path]) => `<li><code>${esc(path)}</code></li>`);
  const stillNeeded = (result.stillNeeded || []).map((s) => `<li>${esc(s)}</li>`);
  const unmatched = (result.unmatchedAgentNames || []).length
    ? `<p class="q">Cloop agent email(s) not matched to a known name (saved as a best-effort guess): ${esc(result.unmatchedAgentNames.join(', '))}.</p>`
    : '';
  dialog.innerHTML = `
    <div class="dr-dialog-body">
      <div class="dr-dialog-icon dr-dialog-icon--ok" aria-hidden="true">✓</div>
      <h3>Done — ${esc(date)}'s report is generated</h3>
      <p style="margin:4px 0">Wrote:</p>
      <ul style="margin:0 0 8px;padding-left:20px">${lines.join('')}</ul>
      ${unmatched}
      <p style="margin:8px 0 4px"><b>Preview it:</b> use the date picker on any page below to switch to ${esc(date)}, or jump straight there:</p>
      <ul style="margin:0 0 8px;padding-left:20px">
        <li><a href="#/call-logs/${esc(date)}">Call logs — #/call-logs/${esc(date)}</a></li>
        <li><a href="#/cloop/${esc(date)}">Cloop — #/cloop/${esc(date)}</a></li>
        <li><a href="#/critical-tasks/${esc(date)}">Critical daily tasks — #/critical-tasks/${esc(date)}</a></li>
        <li><a href="#/leave/${esc(date)}">Staff &amp; doctors' leave — #/leave/${esc(date)}</a></li>
      </ul>
      <p class="q" style="margin:0 0 4px">The Overview page won't show ${esc(date)} yet — still needed:</p>
      <ul class="q" style="margin:0 0 14px;padding-left:20px">${stillNeeded.join('')}</ul>
      <button type="button" class="btn btn-primary" data-dialog-close>Close</button>
    </div>`;
  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
}

function renderDialogError(dialog, message) {
  dialog.innerHTML = `
    <div class="dr-dialog-body">
      <div class="dr-dialog-icon dr-dialog-icon--err" aria-hidden="true">✕</div>
      <h3>Couldn't generate the report</h3>
      <p class="q">${esc(message)}</p>
      <button type="button" class="btn" data-dialog-close>Close</button>
    </div>`;
  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
}

function renderGenerateSection(container) {
  const callLogsCat = UPLOAD_CATEGORIES.find((c) => c.key === 'call-logs');
  const cloopCat = UPLOAD_CATEGORIES.find((c) => c.key === 'cloop');
  const callLogsDone = categoryDoneCallLogsOrCloop(callLogsCat);
  const cloopDone = categoryDoneCallLogsOrCloop(cloopCat);
  const leaveIsDone = leaveDone();
  const allDone = callLogsDone && cloopDone && leaveIsDone;
  const missing = [!callLogsDone && 'Call Logs', !cloopDone && 'Cloop', !leaveIsDone && 'Staff and Drs Leaves'].filter(Boolean);

  container.innerHTML = `
    <div class="panel">
      <h3>Generate today's report</h3>
      <p class="q">Builds call-logs.json, cloop.json, tasks.json and leave.json from everything above, in the dashboard's existing format, and saves them straight into this repo. Previous dates are never touched.</p>
      <button type="button" class="btn btn-primary" id="generateBtn" ${allDone ? '' : 'disabled'}>Generate today's report</button>
      ${!allDone ? `<p class="q" style="margin-top:8px">Still need: ${esc(missing.join(', '))}.</p>` : ''}
    </div>`;

  const btn = container.querySelector('#generateBtn');
  if (!allDone) return;

  btn.addEventListener('click', async () => {
    const dialog = document.getElementById('generateDialog');
    const today = todayISOInCanberra();
    renderDialogLoading(dialog, today);
    dialog.showModal();
    const payload = {
      date: today,
      callLogsFiles: loadEntries('call-logs', today).map((e) => ({ subtypeKey: e.subtypeKey, savedAs: e.savedAs })),
      cloopFiles: loadEntries('cloop', today).map((e) => ({ subtypeKey: e.subtypeKey, savedAs: e.savedAs })),
      cloopDates: loadCloopDatesValue(today),
      totalCasesToDate: loadStatusValue('cloop', today),
    };
    try {
      const res = await fetch(`${LOCAL_UPLOAD_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `request failed (${res.status})`);
      renderDialogDone(dialog, body, today);
    } catch (err) {
      const networkError = err instanceof TypeError;
      const message = networkError
        ? "couldn't reach the local upload server — is `python3 scripts/upload_server.py` running?"
        : (err.message || String(err));
      renderDialogError(dialog, message);
    }
  });
}

export async function renderChecklist(container) {
  // One dialog per visit to this page — document.body, not this container,
  // since app.js's router only ever replaces #page-content's own innerHTML
  // (navigating away and back would otherwise leave a stale dialog behind
  // alongside the new one).
  document.getElementById('generateDialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'generateDialog';
  dialog.className = 'dr-generate-dialog';
  document.body.appendChild(dialog);

  container.innerHTML = `
    <div id="uploadSection"></div>
    <div id="generateSection" class="dr-section-gap"></div>`;
  const uploadSectionEl = container.querySelector('#uploadSection');
  const generateSectionEl = container.querySelector('#generateSection');

  renderUploadSection(uploadSectionEl);
  renderGenerateSection(generateSectionEl);

  // Keep the Generate button's enabled state and "still need" list in sync
  // with every upload/status/leave-answer change above, without threading a
  // callback through each of those separate render functions (renderUploadBlock,
  // renderStatusField, renderLeaveBlock, startNewDay, ...) — they all replace
  // DOM via innerHTML, so watching for that is simpler than wiring one up to
  // each call site individually.
  let generateRefreshQueued = false;
  const observer = new MutationObserver(() => {
    if (generateRefreshQueued) return;
    generateRefreshQueued = true;
    queueMicrotask(() => {
      generateRefreshQueued = false;
      renderGenerateSection(generateSectionEl);
    });
  });
  observer.observe(uploadSectionEl, { childList: true, subtree: true });
}
