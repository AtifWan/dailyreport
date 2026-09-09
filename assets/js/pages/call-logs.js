import { esc, fetchJSON } from '../util.js';
import { barChart, stackedBarChart, lineChart, hBarGroup } from '../charts.js';

const QUEUE_COLORS = { Appointments: 'var(--age1)', 'General Enquiries': 'var(--age2)', 'Health Professionals': 'var(--age3)', 'Canberra Vasectomy': 'var(--age4)' };

function fmtSec(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m} min ${s} sec` : `${s} sec`;
}

export async function renderCallLogs(container) {
  const d = await fetchJSON('assets/data/call-logs.json');
  const t = d.tenDayTrend;

  const queueBars = hBarGroup({
    items: d.queueReport.map((q) => ({ label: q.queue, values: [{ value: q.accepted, color: 'var(--live)' }, { value: q.missed, color: 'var(--danger)' }] })),
  });

  const queueTrendPanels = Object.entries(d.queues).map(([name, q]) => `
    <div class="panel">
      <h3 style="color:${QUEUE_COLORS[name]}">${esc(name)}</h3>
      <p class="q">Accepted vs missed, 10-day trend</p>
      <div class="dr-chart-wrap">${stackedBarChart({ dates: t.labels, seriesA: q.accepted, seriesB: q.missed, height: 190 })}</div>
    </div>`).join('');

  const waitTrendPanels = Object.entries(d.queues).map(([name, q]) => `
    <div class="panel">
      <h3 style="color:${QUEUE_COLORS[name]}">${esc(name)}</h3>
      <p class="q">Average wait time (seconds), 10-day trend</p>
      <div class="dr-chart-wrap">${lineChart({ dates: t.labels, series: [{ data: q.avgWaitSec, color: QUEUE_COLORS[name], label: 'Avg wait (sec)' }], height: 170, unit: 's' })}</div>
    </div>`).join('');

  const wp = d.longestWaitPerQueue.map((q) => `
    <tr>
      <td class="strong">${esc(q.queue)}</td>
      <td class="r num">${q.waitSec}</td>
      <td>${q.time ? esc(q.time) : '&mdash;'}</td>
      <td>${q.name ? esc(q.name) : '&mdash;'}</td>
      <td class="r">${esc(q.waitLabel)}</td>
    </tr>`).join('');

  const hourly = d.todaysHourlyPattern;

  container.innerHTML = `
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

    <h3 style="font-family:Fraunces,serif;font-weight:600;font-size:17px;color:var(--accent-strong);margin:24px 2px 0">Per-queue trends</h3>
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
      <div class="rtable-wrap">
        <table class="rtable">
          <thead><tr><th>Queue</th><th class="r">Longest wait (sec)</th><th>Time</th><th>Name</th><th class="r">Longest wait</th></tr></thead>
          <tbody>${wp}</tbody>
        </table>
      </div>
    </div>

    <div class="panel dr-section-gap">
      <h3>Overall average wait time — 10-day trend</h3>
      <div class="dr-chart-wrap">${lineChart({ dates: t.labels, series: [{ data: t.overallAvgWaitSec, color: 'var(--accent-2)', label: 'Avg wait (sec)' }], height: 200, unit: 's' })}</div>
    </div>

    <h3 style="font-family:Fraunces,serif;font-weight:600;font-size:17px;color:var(--accent-strong);margin:24px 2px 0">Queue average wait time — 10-day trend</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:12px">
      ${waitTrendPanels}
    </div>

    <div class="grid2 dr-section-gap">
      <div class="panel">
        <h3>Inbound calls by staff</h3>
        <p class="q">Total calls / total duration (mins)</p>
        ${hBarGroup({ items: d.inboundByStaff.map((p) => ({ label: p.name, values: [{ value: p.calls, color: 'var(--accent)' }, { value: p.durationMins, color: 'var(--accent-2)', suffix: 'm' }] })) })}
        <div class="dr-legend"><span><i style="background:var(--accent)"></i>Calls</span><span><i style="background:var(--accent-2)"></i>Duration (mins)</span></div>
      </div>
      <div class="panel">
        <h3>Outbound calls by staff</h3>
        <p class="q">Total calls / total duration (mins)</p>
        ${hBarGroup({ items: d.outboundByStaff.map((p) => ({ label: p.name, values: [{ value: p.calls, color: 'var(--accent)' }, { value: p.durationMins, color: 'var(--accent-2)', suffix: 'm' }] })) })}
        <div class="dr-legend"><span><i style="background:var(--accent)"></i>Calls</span><span><i style="background:var(--accent-2)"></i>Duration (mins)</span></div>
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
}
