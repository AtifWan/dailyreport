import { initChartTooltips } from './charts.js';
import { renderOverview } from './pages/overview.js';
import { renderTasks } from './pages/tasks.js';
import { renderCallLogs } from './pages/call-logs.js';
import { renderCloop } from './pages/cloop.js';
import { renderLeave } from './pages/leave.js';

// Each route: hash -> { title, subtitle, navId, render(container) }
const ROUTES = {
  '#/overview': { title: 'Overview', subtitle: 'At-a-glance summary of the daily operations report.', navId: 'nav-overview', render: renderOverview },
  '#/critical-tasks': { title: 'Critical daily tasks', subtitle: 'Streaks and checklist completion for each site and department.', navId: 'nav-tasks', render: renderTasks },
  '#/call-logs': { title: 'Call logs', subtitle: 'Call volume, answer rate and per-queue performance.', navId: 'nav-calls', render: renderCallLogs },
  '#/cloop': { title: 'Cloop', subtitle: 'Case queue volumes, handling and week-over-week movement.', navId: 'nav-cloop', render: renderCloop },
  '#/leave': { title: "Staff & doctors' leave", subtitle: 'Week at a glance for clinical and admin staff.', navId: 'nav-leave', render: renderLeave },
};
const DEFAULT_ROUTE = '#/overview';

const contentEl = document.getElementById('page-content');
const titleEl = document.querySelector('.tt');
const subtitleEl = document.querySelector('.ts');

async function navigate() {
  const hash = ROUTES[location.hash] ? location.hash : DEFAULT_ROUTE;
  const route = ROUTES[hash];

  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('on', el.id === route.navId));
  titleEl.textContent = route.title;
  subtitleEl.textContent = route.subtitle;
  document.title = `${route.title} · Daily Operations Report · YourGP`;

  contentEl.innerHTML = '<p class="result-meta">Loading…</p>';
  try {
    await route.render(contentEl);
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="callout"><div class="ch">Couldn't load this page</div>${err.message || err}</div>`;
  }
  closeDrawer();
  window.scrollTo(0, 0);
}

// Mobile drawer
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('navBackdrop');
function openDrawer() { sidebar.classList.add('open'); backdrop.classList.add('show'); }
function closeDrawer() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
document.getElementById('menuBtn').addEventListener('click', openDrawer);
backdrop.addEventListener('click', closeDrawer);

window.addEventListener('hashchange', navigate);
initChartTooltips(document.body);
navigate();
