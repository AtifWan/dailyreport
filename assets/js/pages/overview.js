import { esc, fetchJSON, formatDate } from '../util.js';
import { datePickerHtml, wireDatePicker } from '../datepicker.js';

function viewLink(route, date, label) {
  return `<a href="#/${route}/${date}" style="display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none">${label} <span aria-hidden="true">&rarr;</span></a>`;
}

export async function renderOverview(container, date, manifest) {
  const d = await fetchJSON(`assets/data/reports/${date}/overview.json`);
  const t = d.criticalTasks, c = d.callLogs, cl = d.cloop, lv = d.leave;
  const maxStreak = Math.max(...t.streaks.map((s) => s.days), 1);

  const streakRows = t.streaks.map((s) => `
    <div class="brow">
      <div class="bl">${esc(s.name)}</div>
      <div class="minibar"><i style="width:${Math.max((s.days / maxStreak) * 100, s.days > 0 ? 2 : 0)}%"></i></div>
      <div class="bv">${s.days} day${s.days === 1 ? '' : 's'}${s.onHalt ? '<small style="color:var(--danger-ink)">On halt</small>' : ''}</div>
    </div>`).join('');

  const financeChecklist = t.checklists.find((x) => x.name === 'Finance');
  const queueRows = c.queueBreakdown.map((q) => `
    <div class="brow">
      <div class="bl">${esc(q.queue)}</div>
      <div class="minibar"><i style="width:${Math.max((q.accepted / 158) * 100, 2)}%"></i></div>
      <div class="bv">${q.accepted}<small>${q.missed} missed</small></div>
    </div>`).join('');

  container.innerHTML = `
    ${datePickerHtml(date, manifest)}
    <p class="result-meta">Report #${d.report.number} · ${esc(d.report.weekday)} ${formatDate(d.report.date)}</p>

    <div class="kpis">
      <div class="kpi ${t.checklists[0].completionPct === 100 ? 'good' : ''}">
        <div class="k-l">PST checklist</div>
        <div class="k-v num">${t.checklists[0].completionPct}%</div>
        <div class="k-n">${t.streaks.find((s) => s.name === 'PST').days}-day streak</div>
      </div>
      <div class="kpi ${financeChecklist.completionPct < 100 ? 'crit' : 'good'}">
        <div class="k-l">Finance checklist</div>
        <div class="k-v num">${financeChecklist.completionPct}%</div>
        <div class="k-n">${financeChecklist.incompleteCount} task outstanding: ${esc(financeChecklist.incompleteExample)}</div>
      </div>
      <div class="kpi good">
        <div class="k-l">Longest streak</div>
        <div class="k-v num">${t.streaks.find((s) => s.longest).days} days</div>
        <div class="k-n">${esc(t.streaks.find((s) => s.longest).name)} · since ${formatDate(t.longestStreak.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>
      <div class="kpi crit">
        <div class="k-l">Sites on halt</div>
        <div class="k-v num">${t.streaks.filter((s) => s.onHalt).length}</div>
        <div class="k-n">of ${t.streaks.length} tracked streaks</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>Critical daily tasks — streak</h3>
        <p class="q">Consecutive days at 100% checklist completion.</p>
        ${streakRows}
        <div class="take"><b>Reads as:</b> Denman's 109-day streak is intact; Crace and Lyneham reset recently and both sit on halt.</div>
        ${viewLink('critical-tasks', date, 'View full checklist detail')}
      </div>
      <div class="panel">
        <h3>Call queue snapshot</h3>
        <p class="q">Accepted calls by queue, today.</p>
        ${queueRows}
        <div class="take"><b>Reads as:</b> Appointments takes just over half of all inbound traffic; ${esc(c.topInboundAgent.name)} answered the most calls today (${c.topInboundAgent.calls}).</div>
        ${viewLink('call-logs', date, 'View full call logs')}
      </div>
    </div>

    <div class="kpis dr-section-gap">
      <div class="kpi">
        <div class="k-l">Total inbound calls</div>
        <div class="k-v num">${c.totalInbound}</div>
        <div class="k-n">${c.totalOutbound} outbound calls made</div>
      </div>
      <div class="kpi good">
        <div class="k-l">Calls accepted</div>
        <div class="k-v num">${c.acceptedPct}%</div>
        <div class="k-n">${c.accepted} of ${c.totalInbound} calls</div>
      </div>
      <div class="kpi crit">
        <div class="k-l">Calls missed</div>
        <div class="k-v num">${c.missedPct}%</div>
        <div class="k-n">${c.missed} of ${c.totalInbound} calls</div>
      </div>
      <div class="kpi">
        <div class="k-l">Cloop cases in queue</div>
        <div class="k-v num">${cl.inQueue}</div>
        <div class="k-n">oldest case ${cl.oldestDays} days</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>Cloop, at a glance</h3>
        <p class="q">Case queue activity as of the report snapshot.</p>
        <div class="splitbar">
          <div class="seg" style="width:100%;background:var(--accent)">${cl.contactsQueuedYesterday} contacts queued yesterday</div>
        </div>
        <div class="take"><b>Reads as:</b> ${cl.emailsHandledYesterday} contacts were handled yesterday across the team, out of ${cl.totalOverallCases.toLocaleString()} total cases logged to date (${cl.totalInProgress} in progress, ${cl.totalOpenCases} open).</div>
        ${viewLink('cloop', date, 'View full Cloop report')}
      </div>
      <div class="panel">
        <h3>Staff &amp; doctors' leave — this week</h3>
        <p class="q">${esc(lv.weekLabel)}</p>
        <div class="brow"><div class="bl">Doctor lines on leave</div><div class="minibar"><i style="width:${(lv.doctorLinesOnLeave / 4) * 100}%"></i></div><div class="bv">${lv.doctorLinesOnLeave}<small>of 4 rostered lines</small></div></div>
        <div class="brow"><div class="bl">Staff fully on leave</div><div class="minibar"><i style="width:${(lv.staffFullyOnLeave / 5) * 100}%"></i></div><div class="bv">${lv.staffFullyOnLeave}<small>all week</small></div></div>
        <div class="brow"><div class="bl">Staff partially on leave</div><div class="minibar"><i style="width:${(lv.staffPartialLeave / 5) * 100}%"></i></div><div class="bv">${lv.staffPartialLeave}<small>${lv.staffPartialLeaveNames.map(esc).join(', ')}</small></div></div>
        <p class="foot-note">${esc(lv.longTerm[0].name)} remains on ${esc(lv.longTerm[0].note).toLowerCase()} (${formatDate(lv.longTerm[0].from)} – ${formatDate(lv.longTerm[0].to)}).</p>
        ${viewLink('leave', date, 'View the week-at-a-glance grid')}
      </div>
    </div>
  `;

  wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/overview/${newDate}`; } });
}
