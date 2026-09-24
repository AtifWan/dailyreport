import { initChartTooltips } from './charts.js';
import { fetchJSON } from './util.js';
import { renderOverview } from './pages/overview.js';
import { renderTasks } from './pages/tasks.js';
import { renderCallLogs } from './pages/call-logs.js';
import { renderCloop } from './pages/cloop.js';
import { renderLeave } from './pages/leave.js';
import { exportFullReport, showToast } from './export.js';

// Each route: key -> { title, subtitle, navId, render(container, date, manifest) }
const ROUTES = {
  overview: { title: 'Overview', subtitle: 'At-a-glance summary of the daily operations report.', navId: 'nav-overview', render: renderOverview },
  'critical-tasks': { title: 'Critical daily tasks', subtitle: 'Streaks and checklist completion for each site and department.', navId: 'nav-tasks', render: renderTasks },
  'call-logs': { title: 'Call logs', subtitle: 'Call volume, answer rate and per-queue performance.', navId: 'nav-calls', render: renderCallLogs },
  cloop: { title: 'Cloop', subtitle: 'Case queue volumes, handling and week-over-week movement.', navId: 'nav-cloop', render: renderCloop },
  leave: { title: "Staff & doctors' leave", subtitle: 'Week at a glance for clinical and admin staff.', navId: 'nav-leave', render: renderLeave },
};
const DEFAULT_ROUTE = 'overview';

const contentEl = document.getElementById('page-content');
const titleEl = document.querySelector('.tt');
const subtitleEl = document.querySelector('.ts');

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
  titleEl.textContent = route.title;
  subtitleEl.textContent = route.subtitle;
  document.title = `${route.title} · Daily Operations Report · YourGP`;

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

// Export button: always builds the full combined report for whatever date is
// currently selected, regardless of which tab is open — it renders all 5 tabs
// off-screen (see export.js), so the file it downloads is the same one no matter
// where on the dashboard you clicked it from.
const exportBtn = document.getElementById('exportBtn');
const exportBtnLabel = document.getElementById('exportBtnLabel');
exportBtn.addEventListener('click', async () => {
  if (exportBtn.disabled) return;
  const idleLabel = exportBtnLabel.textContent;
  exportBtn.disabled = true;
  exportBtn.style.opacity = '.6';
  try {
    const filename = await exportFullReport(currentDate, manifest, {
      onProgress: (msg) => { exportBtnLabel.textContent = msg; },
    });
    showToast(`Downloaded ${filename}`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't export the report — try again.", { ok: false });
  } finally {
    exportBtnLabel.textContent = idleLabel;
    exportBtn.disabled = false;
    exportBtn.style.opacity = '';
  }
});

window.addEventListener('hashchange', navigate);
initChartTooltips(document.body);
navigate();
