import { esc, fetchJSON, formatDate } from '../util.js';
import { lineChart } from '../charts.js';
import { datePickerHtml, wireDatePicker } from '../datepicker.js';
import { compareBadge, getPreviousDate } from '../compare.js';

function checklistPanel(cl, dates, prevCl, prevDateLabel) {
  return `
    <div class="panel">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <h3>${esc(cl.name)}</h3>
        <span class="k-v num" style="font-size:22px;color:${cl.completionPct === 100 ? 'var(--live-ink)' : cl.completionPct < 50 ? 'var(--danger-ink)' : 'var(--ink)'}">${cl.completionPct}%</span>
      </div>
      ${compareBadge(cl.completionPct, prevCl?.completionPct, { percent: true, goodWhen: 'up', prevDateLabel })}
      ${cl.trend ? `
      <div class="dr-chart-wrap">${lineChart({ dates, series: [{ data: cl.trend, color: cl.completionPct === 100 ? 'var(--live)' : 'var(--accent)', label: '% complete' }], height: 150, unit: '%' })}</div>
      ` : `<p class="foot-note">No 10-day trend chart was published for this checklist on this date.</p>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px">
        <div>
          <p style="font-size:12.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 8px">&check; Complete tasks</p>
          <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px">
            ${cl.complete.map((task) => `<li style="font-size:13.5px;color:var(--live-ink)">${esc(task)}</li>`).join('') || '<li class="foot-note">None recorded.</li>'}
          </ul>
        </div>
        <div>
          <p style="font-size:12.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 8px">&#9744; Incomplete tasks</p>
          <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px">
            ${cl.incomplete.map((task) => `<li style="font-size:13.5px;color:var(--danger-ink)">${esc(task)}</li>`).join('') || '<li class="foot-note" style="color:var(--live-ink)">None — fully complete.</li>'}
          </ul>
        </div>
      </div>
    </div>`;
}

export async function renderTasks(container, date, manifest) {
  const prevDate = getPreviousDate(manifest, date);
  const [d, prevD] = await Promise.all([
    fetchJSON(`assets/data/reports/${date}/tasks.json`),
    prevDate ? fetchJSON(`assets/data/reports/${prevDate}/tasks.json`).catch(() => null) : Promise.resolve(null),
  ]);
  const prevDateLabel = prevD ? formatDate(prevDate, { day: 'numeric', month: 'short' }) : null;

  container.innerHTML = `
    ${datePickerHtml(date, manifest)}

    <div class="grid2">
      ${d.checklists.map((cl) => checklistPanel(cl, d.trendDates, prevD?.checklists.find((x) => x.name === cl.name), prevDateLabel)).join('')}
    </div>

    <div class="panel dr-section-gap">
      <h3>Side Quests</h3>
      <p class="dr-placeholder">Not tracked yet — data will come from Tasky.</p>
    </div>
  `;

  wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/critical-tasks/${newDate}`; } });
}
