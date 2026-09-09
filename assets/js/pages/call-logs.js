import { esc, fetchJSON, mountInteractiveTable } from '../util.js';
import { barChart, stackedBarChart, lineChart, hBarGroup } from '../charts.js';
import { datePickerHtml, wireDatePicker } from '../datepicker.js';

const QUEUE_COLORS = { Appointments: 'var(--age1)', 'General Enquiries': 'var(--age2)', 'Health Professionals': 'var(--age3)', 'Canberra Vasectomy': 'var(--age4)' };
const QUEUES = Object.keys(QUEUE_COLORS);

function fmtSec(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m} min ${s} sec` : `${s} sec`;
}

/** One row per person seen in either call list, cross-referenced against yesterday's
 *  Cloop email activity where the same name appears — a cross-page view of who did
 *  what, not just three separate rankings of the same roster. */
function buildStaffActivity(callLogs, cloop) {
  const byName = new Map();
  const ensure = (name) => {
    if (!byName.has(name)) byName.set(name, { name, inboundCalls: 0, inboundMins: 0, outboundCalls: 0, outboundMins: 0, emailIncoming: 0, emailOutbound: 0, emailTotal: 0 });
    return byName.get(name);
  };
  callLogs.inboundByStaff.forEach((p) => { const r = ensure(p.name); r.inboundCalls = p.calls; r.inboundMins = p.durationMins; });
  callLogs.outboundByStaff.forEach((p) => { const r = ensure(p.name); r.outboundCalls = p.calls; r.outboundMins = p.durationMins; });
  (cloop?.emailsHandledYesterday || []).forEach((p) => { const r = ensure(p.agent); r.emailIncoming = p.incoming; r.emailOutbound = p.outbound; r.emailTotal = p.total; });
  return Array.from(byName.values()).map((r) => ({ ...r, totalCalls: r.inboundCalls + r.outboundCalls, totalMins: r.inboundMins + r.outboundMins }));
}

function mountStaffActivityTable(container, staff, date) {
  const maxCalls = Math.max(...staff.map((s) => s.totalCalls), 1);
  mountInteractiveTable(container, {
    rows: staff,
    keyOf: (r) => r.name,
    defaultSortKey: 'totalCalls',
    emptyColspan: 5,
    searchInputSelector: '.dr-staff-search',
    searchText: (r) => r.name,
    renderRow: (r, open) => `
      <tr data-key="${esc(r.name)}" style="cursor:pointer">
        <td class="strong">${esc(r.name)} <span class="thsort-i" style="opacity:.5">${open ? '▲' : '▼'}</span></td>
        <td class="r num">${r.inboundCalls}</td>
        <td class="r num">${r.outboundCalls}</td>
        <td class="r">
          <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
            <div style="width:70px;background:var(--surface-sunk);border-radius:4px;height:10px;overflow:hidden"><div style="width:${Math.max((r.totalCalls / maxCalls) * 100, r.totalCalls > 0 ? 3 : 0)}%;height:100%;background:var(--accent)"></div></div>
            <span class="num strong">${r.totalCalls}</span>
          </div>
        </td>
        <td class="r num">${r.totalMins}m</td>
      </tr>`,
    renderDetail: (r) => `
      <tr data-key="${esc(r.name)}-detail">
        <td colspan="5" style="background:var(--surface-sunk)">
          <div style="display:flex;flex-wrap:wrap;gap:20px;padding:6px 0;font-size:13.5px;color:var(--ink-muted)">
            <span><b style="color:var(--ink)">Inbound:</b> ${r.inboundCalls} calls · ${r.inboundMins}m total</span>
            <span><b style="color:var(--ink)">Outbound:</b> ${r.outboundCalls} calls · ${r.outboundMins}m total</span>
            ${r.emailTotal > 0
              ? `<span><b style="color:var(--ink)">Cloop, yesterday:</b> ${r.emailTotal} contacts handled (${r.emailIncoming} in / ${r.emailOutbound} out) — <a href="#/cloop/${esc(date)}" style="color:var(--accent)">view in Cloop &rarr;</a></span>`
              : `<span class="foot-note" style="margin:0">No Cloop email activity logged for this agent yesterday.</span>`}
          </div>
        </td>
      </tr>`,
  });
}

function mountLongestWaitTable(container, rows) {
  mountInteractiveTable(container, {
    rows,
    keyOf: (r) => r.queue,
    defaultSortKey: 'waitSec',
    emptyColspan: 5,
    renderRow: (r) => `
      <tr>
        <td class="strong">${esc(r.queue)}</td>
        <td class="r num">${r.waitSec}</td>
        <td>${r.time ? esc(r.time) : '&mdash;'}</td>
        <td>${r.name ? esc(r.name) : '&mdash;'}</td>
        <td class="r">${esc(r.waitLabel)}</td>
      </tr>`,
  });
}

function wireQueueFilter(container) {
  const buttons = container.querySelectorAll('.dr-queue-filter .locbtn');
  const panels = container.querySelectorAll('[data-queue-panel]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      const q = btn.dataset.queue;
      panels.forEach((p) => { p.hidden = q !== 'All' && p.dataset.queuePanel !== q; });
    });
  });
}

export async function renderCallLogs(container, date, manifest) {
  const [d, cloop] = await Promise.all([
    fetchJSON(`assets/data/reports/${date}/call-logs.json`),
    fetchJSON(`assets/data/reports/${date}/cloop.json`).catch(() => null),
  ]);
  const t = d.tenDayTrend;
  const staff = buildStaffActivity(d, cloop);

  const queueBars = hBarGroup({
    items: d.queueReport.map((q) => ({ label: q.queue, values: [{ value: q.accepted, color: 'var(--live)' }, { value: q.missed, color: 'var(--danger)' }] })),
  });

  const queueFilterBtns = ['All', ...QUEUES].map((q) => `<button class="locbtn${q === 'All' ? ' on' : ''}" data-queue="${esc(q)}">${esc(q)}</button>`).join('');

  const queueTrendPanels = Object.entries(d.queues).map(([name, q]) => `
    <div class="panel" data-queue-panel="${esc(name)}">
      <h3 style="color:${QUEUE_COLORS[name]}">${esc(name)}</h3>
      <p class="q">Accepted vs missed, 10-day trend</p>
      <div class="dr-chart-wrap">${stackedBarChart({ dates: t.labels, seriesA: q.accepted, seriesB: q.missed, height: 190 })}</div>
    </div>`).join('');

  const waitTrendPanels = Object.entries(d.queues).map(([name, q]) => `
    <div class="panel" data-queue-panel="${esc(name)}">
      <h3 style="color:${QUEUE_COLORS[name]}">${esc(name)}</h3>
      <p class="q">Average wait time (seconds), 10-day trend</p>
      <div class="dr-chart-wrap">${lineChart({ dates: t.labels, series: [{ data: q.avgWaitSec, color: QUEUE_COLORS[name], label: 'Avg wait (sec)' }], height: 170, unit: 's' })}</div>
    </div>`).join('');

  const hourly = d.todaysHourlyPattern;

  container.innerHTML = `
    ${datePickerHtml(date, manifest)}
    <div class="kpis">
      <div class="kpi">
        <div class="k-l">Total inbound calls</div>
        <div class="k-v num">${d.summary.totalInbound}</div>
        <div class="k-n">across all queues today</div>
      </div>
      <div class="kpi good">
        <div class="k-l">Calls accepted</div>
        <div class="k-v num">${d.summary.acceptedPct}%</div>
        <div class="k-n">${d.summary.accepted} of ${d.summary.totalInbound} calls</div>
      </div>
      <div class="kpi crit">
        <div class="k-l">Calls missed</div>
        <div class="k-v num">${d.summary.missedPct}%</div>
        <div class="k-n">${d.summary.missed} of ${d.summary.totalInbound} calls</div>
      </div>
      <div class="kpi">
        <div class="k-l">Total outbound calls</div>
        <div class="k-v num">${d.summary.totalOutbound}</div>
        <div class="k-n">made by staff today</div>
      </div>
    </div>

    <div class="panel">
      <h3>Queue report</h3>
      <p class="q">Accepted vs missed calls, by queue — ${d.summary.totalInbound} calls today.</p>
      ${queueBars}
      <div class="dr-legend"><span><i style="background:var(--live)"></i>Accepted</span><span><i style="background:var(--danger)"></i>Missed</span></div>
      <div class="take"><b>Reads as:</b> Appointments and General Enquiries carry almost all traffic; Canberra Vasectomy and Health Professionals are low-volume queues today.</div>
    </div>

    <div class="grid2 dr-section-gap">
      <div class="panel">
        <h3>Call answer rate — 10-day trend</h3>
        <p class="q">Target: ${t.answerRateTargetPct}%</p>
        <div class="dr-chart-wrap">${lineChart({ dates: t.labels, series: [{ data: t.answerRatePct, color: 'var(--accent)', label: 'Answer rate' }], height: 200, target: t.answerRateTargetPct, targetLabel: `${t.answerRateTargetPct}% target`, unit: '%' })}</div>
      </div>
      <div class="panel">
        <h3>Call volume — 10-day trend</h3>
        <p class="q">Accepted vs missed, all queues</p>
        <div class="dr-chart-wrap">${stackedBarChart({ dates: t.labels, seriesA: t.accepted, seriesB: t.missed, height: 220 })}</div>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:24px 2px 0">
      <h3 style="font-family:Fraunces,serif;font-weight:600;font-size:17px;color:var(--accent-strong);margin:0">Per-queue trends</h3>
      <div class="dr-queue-filter" style="display:flex;gap:8px;flex-wrap:wrap">${queueFilterBtns}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:12px">
      ${queueTrendPanels}
    </div>

    <div class="kpis dr-section-gap">
      <div class="kpi">
        <div class="k-l">Longest call duration</div>
        <div class="k-v num">${fmtSec(d.patientServiceKpi.longestCallDurationSec)}</div>
        <div class="k-n">${d.patientServiceKpi.longestCallAt} · ${esc(d.patientServiceKpi.longestCallAgent)}</div>
      </div>
      <div class="kpi crit">
        <div class="k-l">Longest waiting time</div>
        <div class="k-v num">${fmtSec(d.patientServiceKpi.longestWaitingTimeSec)}</div>
        <div class="k-n">${d.patientServiceKpi.longestWaitingAt}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Avg call handling</div>
        <div class="k-v num">${fmtSec(d.patientServiceKpi.avgCallHandlingSec)}</div>
        <div class="k-n">per accepted call, today</div>
      </div>
    </div>

    <div class="panel">
      <h3>Longest wait per queue</h3>
      <p class="q">Click a column to sort.</p>
      <div class="rtable-wrap dr-longest-wait">
        <table class="rtable">
          <thead><tr>
            <th><button class="thsort" data-key="queue">Queue <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort on" data-key="waitSec">Longest wait (sec) <span class="thsort-i">▼</span></button></th>
            <th>Time</th><th>Name</th><th class="r">Longest wait</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="panel dr-section-gap">
      <h3>Overall average wait time — 10-day trend</h3>
      <div class="dr-chart-wrap">${lineChart({ dates: t.labels, series: [{ data: t.overallAvgWaitSec, color: 'var(--accent-2)', label: 'Avg wait (sec)' }], height: 200, unit: 's' })}</div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:24px 2px 0">
      <h3 style="font-family:Fraunces,serif;font-weight:600;font-size:17px;color:var(--accent-strong);margin:0">Queue average wait time — 10-day trend</h3>
      <p class="foot-note" style="margin:0">Filtered by the queue picker above</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:12px">
      ${waitTrendPanels}
    </div>

    <div class="panel dr-section-gap">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h3>Staff activity</h3>
          <p class="q">Inbound + outbound calls, cross-referenced with yesterday's Cloop email handling. Click a row for detail, click a column to sort.</p>
        </div>
        <input class="sinput dr-staff-search" type="text" placeholder="Search staff">
      </div>
      <div class="rtable-wrap dr-staff-table" style="margin-top:12px">
        <table class="rtable">
          <thead><tr>
            <th><button class="thsort" data-key="name">Name <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort" data-key="inboundCalls">Inbound <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort" data-key="outboundCalls">Outbound <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort on" data-key="totalCalls">Total calls <span class="thsort-i">▼</span></button></th>
            <th class="r"><button class="thsort" data-key="totalMins">Total duration <span class="thsort-i">⇅</span></button></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="grid2 dr-section-gap">
      <div class="panel">
        <h3>Total outbound calls — 10-day trend</h3>
        <div class="dr-chart-wrap">${barChart({ dates: d.outboundTenDayTrend.labels, values: d.outboundTenDayTrend.totals, color: 'var(--accent-2)' })}</div>
      </div>
      <div class="panel">
        <h3>Today's inbound pattern by hour</h3>
        <p class="q">Accepted vs missed, hour by hour</p>
        <div class="dr-chart-wrap">${stackedBarChart({ dates: hourly.hours, seriesA: hourly.accepted, seriesB: hourly.missed, height: 200 })}</div>
      </div>
    </div>
  `;

  wireQueueFilter(container);
  mountLongestWaitTable(container.querySelector('.dr-longest-wait'), d.longestWaitPerQueue);
  mountStaffActivityTable(container.querySelector('.dr-staff-table'), staff, date);
  wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/call-logs/${newDate}`; } });
}
