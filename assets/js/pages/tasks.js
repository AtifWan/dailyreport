import { esc, fetchJSON, formatDate } from '../util.js';
import { lineChart } from '../charts.js';
import { startOfWorkingStreak } from '../workdays.js';

// The PDF states Denman's streak start date directly — that's sourced fact, so we
// show it verbatim rather than re-derive it (a real ACT-working-day count from
// 13 Jan 2026 to the report date doesn't land on 109 either, so whatever internal
// rule the source system uses isn't a plain business-day count — see PHASE-2.md).
function sinceInfo(streak, reportDate, longestStreak) {
  if (streak.longest) return { date: longestStreak.startDate, estimated: false };
  const date = startOfWorkingStreak(reportDate, streak.days);
  return { date, estimated: true };
}

function sinceLabel(info) {
  if (!info.date) return 'Reset today';
  const label = formatDate(info.date, { day: 'numeric', month: 'short', year: 'numeric' });
  return info.estimated ? `est. since ${label}` : `since ${label}`;
}

function checklistPanel(cl, dates) {
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
  const since = Object.fromEntries(d.streaks.map((s) => [s.name, sinceInfo(s, d.reportDate, d.longestStreak)]));

  const kpis = d.streaks.map((s) => `
    <div class="kpi ${s.onHalt ? 'crit' : 'good'}" data-tip="${esc(s.name)}: ${s.days}-day streak, ${esc(sinceLabel(since[s.name]))}">
      <div class="k-l">${esc(s.name)}</div>
      <div class="k-v num">${s.days}</div>
      <div class="k-n">day${s.days === 1 ? '' : 's'} streak${s.onHalt ? ' · on halt' : ''}${s.longest ? ' · longest' : ''}<span class="k-vs" style="display:block;margin-top:2px">${esc(sinceLabel(since[s.name]))}</span></div>
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
          <div class="bv">${s.days} day${s.days === 1 ? '' : 's'}<small>${esc(sinceLabel(since[s.name]))}</small></div>
        </div>`).join('')}
      <div class="take"><b>Reads as:</b> Longest streak is ${esc(d.longestStreak.name)} at ${d.longestStreak.days} days, running since ${formatDate(d.longestStreak.startDate, { day: 'numeric', month: 'short', year: 'numeric' })} — as stated in the source report. Crace and Lyneham are both on halt after resetting recently.</div>
      <p class="foot-note">"Since" dates are calculated by counting back each streak's day-count across ACT (Canberra) working days — Mon–Fri, excluding public holidays — from this report's date (${formatDate(d.reportDate, { day: 'numeric', month: 'short', year: 'numeric' })}), and marked <i>est.</i> where the source report doesn't state a start date directly. Denman's date above is stated in the source report, not calculated — a plain working-day count between the two doesn't reconcile, so whatever the source system counts by isn't a straightforward ACT business-day tally.</p>
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
