import { esc, fetchJSON, formatDate } from '../util.js';
import { lineChart } from '../charts.js';

function checklistPanel(cl, dates) {
  const pctClass = cl.completionPct === 100 ? 'good' : cl.completionPct < 50 ? 'crit' : '';
  return `
    <div class="panel">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <h3>${esc(cl.name)}</h3>
        <span class="k-v num" style="font-size:22px;color:${cl.completionPct === 100 ? 'var(--live-ink)' : cl.completionPct < 50 ? 'var(--danger-ink)' : 'var(--ink)'}">${cl.completionPct}%</span>
      </div>
      <p class="q">10-day performance checklist</p>
      <div class="dr-chart-wrap">${lineChart({ dates, series: [{ data: cl.trend, color: cl.completionPct === 100 ? 'var(--live)' : 'var(--accent)', label: '% complete' }], height: 150, unit: '%' })}</div>
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

export async function renderTasks(container) {
  const d = await fetchJSON('assets/data/tasks.json');
  const maxStreak = Math.max(...d.streaks.map((s) => s.days), 1);

  const kpis = d.streaks.map((s) => `
    <div class="kpi ${s.onHalt ? 'crit' : 'good'}">
      <div class="k-l">${esc(s.name)}</div>
      <div class="k-v num">${s.days}</div>
      <div class="k-n">day${s.days === 1 ? '' : 's'} streak${s.onHalt ? ' · on halt' : ''}${s.longest ? ' · longest' : ''}</div>
    </div>`).join('');

  container.innerHTML = `
    <div class="kpis">${kpis}</div>

    <div class="panel">
      <h3>Streak history</h3>
      <p class="q">Consecutive days each site/department hit 100% on its critical checklist.</p>
      ${d.streaks.map((s) => `
        <div class="brow">
          <div class="bl">${esc(s.name)}</div>
          <div class="minibar"><i style="width:${Math.max((s.days / maxStreak) * 100, s.days > 0 ? 2 : 0)}%;background:${s.longest ? 'var(--live)' : s.onHalt ? 'var(--danger)' : 'var(--accent)'}"></i></div>
          <div class="bv">${s.days} day${s.days === 1 ? '' : 's'}</div>
        </div>`).join('')}
      <div class="take"><b>Reads as:</b> Longest streak is ${esc(d.longestStreak.name)} at ${d.longestStreak.days} days, running since ${formatDate(d.longestStreak.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}. Crace and Lyneham are both on halt after resetting recently.</div>
    </div>

    <div class="grid2 dr-section-gap">
      ${d.checklists.map((cl) => checklistPanel(cl, d.trendDates)).join('')}
    </div>

    <div class="panel dr-section-gap">
      <h3>Crace, Denman &amp; Lyneham</h3>
      <p class="q">Site-level checklists</p>
      <div class="dr-placeholder">${esc(d.sitePlaceholderNote)}</div>
    </div>
  `;
}
