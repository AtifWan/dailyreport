import { esc, fetchJSON, formatDate } from '../util.js';
import { datePickerHtml, wireDatePicker } from '../datepicker.js';

function viewLink(route, date, label) {
  return `<a href="#/${route}/${date}" style="display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none">${label} <span aria-hidden="true">&rarr;</span></a>`;
}

export async function renderOverview(container, date, manifest) {
  const d = await fetchJSON(`assets/data/reports/${date}/overview.json`);
  const t = d.criticalTasks, c = d.callLogs, cl = d.cloop, lv = d.leave;

  const pstChecklist = t.checklists.find((x) => x.name === 'PST');
  const financeChecklist = t.checklists.find((x) => x.name === 'Finance');
  const queueRows = c.queueBreakdown.map((q) => {
    const total = q.accepted + q.missed;
    const acceptedPct = total > 0 ? Math.round((q.accepted / total) * 100) : null;
    return `
    <div class="brow">
      <div class="bl">${esc(q.queue)}</div>
      <div class="minibar"><i style="width:${Math.max((q.accepted / 158) * 100, 2)}%"></i></div>
      <div class="bv">${q.accepted}${acceptedPct != null ? ` (${acceptedPct}%)` : ''}<small>${q.missed} missed</small></div>
    </div>`;
  }).join('');

  container.innerHTML = `
    ${datePickerHtml(date, manifest, `Report #${d.report.number}`)}

    <div class="kpis">
      ${pstChecklist ? `
      <div class="kpi ${pstChecklist.completionPct === 100 ? 'good' : ''}">
        <div class="k-l">PST checklist</div>
        <div class="k-v num">${pstChecklist.completionPct}%</div>
      </div>
      ` : ''}
      ${financeChecklist ? `
      <div class="kpi ${financeChecklist.completionPct < 100 ? 'crit' : 'good'}">
        <div class="k-l">Finance checklist</div>
        <div class="k-v num">${financeChecklist.completionPct}%</div>
        <div class="k-n">${financeChecklist.incompleteCount != null ? `${financeChecklist.incompleteCount} task outstanding: ${esc(financeChecklist.incompleteExample)}` : (financeChecklist.completionPct === 100 ? 'Fully complete' : '')}</div>
      </div>
      ` : ''}
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>Side Quest Score</h3>
        <div class="kpi" style="background:transparent;border:none;box-shadow:none;padding:0">
          <div class="k-v">—</div>
          <div class="k-n">Not tracked yet — coming soon.</div>
        </div>
        ${viewLink('critical-tasks', date, 'View full checklist detail')}
      </div>
      <div class="panel">
        <h3>Call queue snapshot</h3>
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
        ${cl ? `
        <div class="k-v num">${cl.inQueue}</div>
        <div class="k-n">oldest case ${cl.oldestDays} days</div>
        ` : `<div class="k-n">No Cloop report this date</div>`}
      </div>
    </div>

    <div class="panel dr-section-gap">
      <h3>Staff &amp; doctors' leave — this week</h3>
      <p class="q">${esc(lv.weekLabel)}</p>
      <div class="brow"><div class="bl">Doctor lines on leave</div><div class="minibar"><i style="width:${(lv.doctorLinesOnLeave / 4) * 100}%"></i></div><div class="bv">${lv.doctorLinesOnLeave}<small>of 4 rostered lines</small></div></div>
      <div class="brow"><div class="bl">Staff fully on leave</div><div class="minibar"><i style="width:${(lv.staffFullyOnLeave / 5) * 100}%"></i></div><div class="bv">${lv.staffFullyOnLeave}<small>all week</small></div></div>
      <div class="brow"><div class="bl">Staff partially on leave</div><div class="minibar"><i style="width:${(lv.staffPartialLeave / 5) * 100}%"></i></div><div class="bv">${lv.staffPartialLeave}<small>${lv.staffPartialLeaveNames.map(esc).join(', ')}</small></div></div>
      <p class="foot-note">${esc(lv.longTerm[0].name)} remains on ${esc(lv.longTerm[0].note).toLowerCase()} (${formatDate(lv.longTerm[0].from)} – ${formatDate(lv.longTerm[0].to)}).</p>
      ${viewLink('leave', date, 'View the week-at-a-glance grid')}
    </div>
  `;

  wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/overview/${newDate}`; } });
}
