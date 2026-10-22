import { initChartTooltips } from './charts.js';
import { fetchJSON } from './util.js';
import { renderOverview } from './pages/overview.js';
import { renderTasks } from './pages/tasks.js';
import { renderCallLogs } from './pages/call-logs.js';
import { renderCloop } from './pages/cloop.js';
import { renderLeave } from './pages/leave.js';
import { renderChecklist } from './pages/checklist.js';
import { exportReport, showToast } from './export.js';

// Each route: key -> { title, navId, render(container, date, manifest) }
// `title` only feeds the browser tab (document.title) and the sidebar's active-item
// styling now — the visible in-page title/subtitle header was removed (the sidebar
// nav already says which page you're on), so there's no on-page subtitle to carry.
const ROUTES = {
  overview: { title: 'Overview', navId: 'nav-overview', render: renderOverview },
  'critical-tasks': { title: 'Critical daily tasks', navId: 'nav-tasks', render: renderTasks },
  'call-logs': { title: 'Call logs', navId: 'nav-calls', render: renderCallLogs },
  cloop: { title: 'Cloop', navId: 'nav-cloop', render: renderCloop },
  leave: { title: "Staff & doctors' leave", navId: 'nav-leave', render: renderLeave },
  'report-checklist': { title: 'Report checklist', navId: 'nav-checklist', render: (container) => renderChecklist(container) },
};
const DEFAULT_ROUTE = 'overview';

const contentEl = document.getElementById('page-content');

// The selected report date lives in the URL (#/<route>/<date>), not inside any one
// page — that's what makes it survive navigating between pages (item 11). This is
// the one place that reads/writes it; every page module just receives it as an
// argument to render().
let manifest = null;
let currentDate = null;

async function ensureManifest() {
  if (!manifest) manifest = await fetchJSON('assets/data/reports/index.json');
  return manifest;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [routeKeyRaw, dateParam] = raw.split('/');
  const routeKey = ROUTES[routeKeyRaw] ? routeKeyRaw : DEFAULT_ROUTE;
  return { routeKey, dateParam: dateParam || null };
}

async function navigate() {
  await ensureManifest();
  const { routeKey, dateParam } = parseHash();

  // Prefer an explicit, valid date in the URL; otherwise carry over whatever was
  // last selected; otherwise fall back to the newest report available. A report
  // is always published a day after the date it covers (see README), so "newest
  // available" is exactly manifest.latest — never today's real calendar date.
  const date = manifest.dates.includes(dateParam) ? dateParam
    : manifest.dates.includes(currentDate) ? currentDate
    : manifest.latest;
  currentDate = date;

  const canonical = `#/${routeKey}/${date}`;
  if (location.hash !== canonical) {
    location.hash = canonical; // re-enters navigate() via hashchange, now canonical
    return;
  }

  const route = ROUTES[routeKey];
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('on', el.id === route.navId));
  document.title = `${route.title} · Dashy Daily · YourGP`;

  contentEl.innerHTML = '<p class="result-meta">Loading…</p>';
  try {
    await route.render(contentEl, date, manifest);
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="callout"><div class="ch">Couldn't load this page</div>${err.message || err}</div>`;
  }
  closeDrawer();
  window.scrollTo(0, 0);
}

// Sidebar nav carries the current date forward instead of resetting to whatever
// that page's default would otherwise be — the other half of item 11.
document.querySelectorAll('.nav-item[data-route]').forEach((btn) => {
  btn.addEventListener('click', () => {
    location.hash = `#/${btn.dataset.route}/${currentDate || ''}`;
  });
});

// Mobile drawer
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('navBackdrop');
function openDrawer() { sidebar.classList.add('open'); backdrop.classList.add('show'); }
function closeDrawer() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
document.getElementById('menuBtn').addEventListener('click', openDrawer);
backdrop.addEventListener('click', closeDrawer);

// Export split button: always builds the report for whatever date is currently
// selected, regardless of which tab is open — it renders every section
// off-screen (see export.js), so the file it downloads is the same one no
// matter where on the dashboard you clicked it from. The main button re-runs
// whichever report type was used last (Full, until the caret menu picks
// Short); the caret just offers the choice, it doesn't perform an export itself.
const exportMenu = document.getElementById('exportMenu');
const exportBtn = document.getElementById('exportBtn');
const exportBtnLabel = document.getElementById('exportBtnLabel');
const exportCaretBtn = document.getElementById('exportCaretBtn');
const exportPop = document.getElementById('exportPop');
let lastExportMode = 'full';

function closeExportPop() {
  exportPop.hidden = true;
  exportCaretBtn.setAttribute('aria-expanded', 'false');
}

async function runExport(mode) {
  if (exportBtn.disabled) return;
  lastExportMode = mode;
  exportBtn.setAttribute('aria-label', mode === 'short' ? 'Export short report' : 'Export full report');
  const idleLabel = exportBtnLabel.textContent;
  exportMenu.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  exportMenu.style.opacity = '.6';
  try {
    const filename = await exportReport(currentDate, manifest, {
      mode,
      onProgress: (msg) => { exportBtnLabel.textContent = msg; },
    });
    showToast(`Downloaded ${filename}`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't export the report — try again.", { ok: false });
  } finally {
    exportBtnLabel.textContent = idleLabel;
    exportMenu.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    exportMenu.style.opacity = '';
  }
}

exportBtn.addEventListener('click', () => runExport(lastExportMode));
exportCaretBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (exportPop.hidden) {
    exportPop.hidden = false;
    exportCaretBtn.setAttribute('aria-expanded', 'true');
  } else {
    closeExportPop();
  }
});
exportPop.addEventListener('click', (e) => {
  const opt = e.target.closest('.dr-export-opt');
  if (!opt) return;
  closeExportPop();
  runExport(opt.dataset.mode);
});
document.addEventListener('click', (e) => { if (!exportPop.hidden && !exportMenu.contains(e.target)) closeExportPop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !exportPop.hidden) closeExportPop(); });

window.addEventListener('hashchange', navigate);
initChartTooltips(document.body);
navigate();
