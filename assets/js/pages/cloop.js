import { esc, fetchJSON, mountInteractiveTable } from '../util.js';
import { lineChart, hBarGroup } from '../charts.js';
import { datePickerHtml, wireDatePicker } from '../datepicker.js';

function weekOverWeek(totals) {
  const latest = totals[totals.length - 1];
  const prior = totals[totals.length - 6]; // 5 business days earlier = same weekday, 1 week prior
  const delta = latest - prior;
  const pct = prior !== 0 ? Math.round((delta / prior) * 1000) / 10 : null;
  return { latest, prior, delta, pct };
}

function deltaChip(delta, pct) {
  if (delta === 0) return `<span class="d-flat">– 0 (0%)</span>`;
  const cls = delta > 0 ? 'd-up' : 'd-down';
  const arrow = delta > 0 ? '▲' : '▼';
  return `<span class="${cls}">${arrow} ${Math.abs(delta)}${pct != null ? ` (${delta > 0 ? '+' : '-'}${Math.abs(pct)}%)` : ''}</span>`;
}

function mountRealTimeTable(container, rows, summary) {
  mountInteractiveTable(container, {
    rows,
    keyOf: (r) => r.queue,
    defaultSortKey: 'inQueue',
    emptyColspan: 3,
    renderRow: (r) => `
      <tr><td class="strong">${esc(r.queue)}</td><td class="r num">${r.inQueue}</td><td class="r num">${r.oldestDays}</td></tr>`,
  });
  const tfoot = container.querySelector('table').querySelector('tfoot');
  if (tfoot) tfoot.innerHTML = `<tr><td>Summary</td><td class="r num">${summary.inQueue}</td><td class="r num">${summary.oldestDays}</td></tr>`;
}

function mountEmailsTable(container, rows, totals) {
  mountInteractiveTable(container, {
    rows,
    keyOf: (r) => r.agent,
    defaultSortKey: 'total',
    emptyColspan: 4,
    renderRow: (r) => `
      <tr><td class="strong">${esc(r.agent)}</td><td class="r num">${r.incoming}</td><td class="r num">${r.outbound}</td><td class="r num strong">${r.total}</td></tr>`,
  });
  const tfoot = container.querySelector('table').querySelector('tfoot');
  if (tfoot) tfoot.innerHTML = `<tr><td>Total</td><td class="r num">${totals.incoming}</td><td class="r num">${totals.outbound}</td><td class="r num">${totals.total}</td></tr>`;
}

export async function renderCloop(container, date, manifest) {
  const [d, callLogs] = await Promise.all([
    fetchJSON(`assets/data/reports/${date}/cloop.json`),
    fetchJSON(`assets/data/reports/${date}/call-logs.json`).catch(() => null),
  ]);
  const yesterdayTotal = d.contactsQueuedYesterday.reduce((s, q) => s + q.count, 0);
  const wowQueued = weekOverWeek(d.contactsQueuedTenDayTrend.totals);
  const wowProgress = weekOverWeek(d.inProgressTenDayTrend.totals);
  const wowOpen = weekOverWeek(d.openCasesTenDayTrend.totals);
  const emailTotals = d.emailsHandledYesterday.reduce((acc, a) => ({ incoming: acc.incoming + a.incoming, outbound: acc.outbound + a.outbound, total: acc.total + a.total }), { incoming: 0, outbound: 0, total: 0 });

  const callNames = new Set((callLogs?.inboundByStaff || []).concat(callLogs?.outboundByStaff || []).map((p) => p.name));
  const alsoOnPhones = d.emailsHandledYesterday.map((a) => a.agent).filter((name) => callNames.has(name));

  container.innerHTML = `
    ${datePickerHtml(date, manifest)}
    <div class="kpis">
      <div class="kpi">
        <div class="k-l">In queue right now</div>
        <div class="k-v num">${d.realTimeSummary.inQueue}</div>
        <div class="k-n">across ${d.realTimeQueues.length} queues</div>
      </div>
      <div class="kpi crit">
        <div class="k-l">Oldest case in queue</div>
        <div class="k-v num">${d.realTimeSummary.oldestDays}<small style="font-size:14px;font-weight:600"> days</small></div>
        <div class="k-n">extracted ${esc(d.extractedAtLabel)}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Contacts queued, yesterday</div>
        <div class="k-v num">${yesterdayTotal}</div>
        <div class="k-n">vs 1 week ago${' '}${deltaChip(wowQueued.delta, wowQueued.pct)}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Total overall cases</div>
        <div class="k-v num">${d.totalCasesToDate.totalOverallCases.toLocaleString()}</div>
        <div class="k-n">to date, as of ${d.totalCasesToDate.date}</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>Real-time metrics, by queue</h3>
        <p class="q">In queue now, and the age of the oldest case (days). Click a column to sort.</p>
        <div class="rtable-wrap dr-realtime-table" style="max-height:none">
          <table class="rtable">
            <thead><tr>
              <th><button class="thsort" data-key="queue">Queue name <span class="thsort-i">⇅</span></button></th>
              <th class="r"><button class="thsort on" data-key="inQueue">In queue <span class="thsort-i">▼</span></button></th>
              <th class="r"><button class="thsort" data-key="oldestDays">Oldest (days) <span class="thsort-i">⇅</span></button></th>
            </tr></thead>
            <tbody></tbody>
            <tfoot></tfoot>
          </table>
        </div>
      </div>
      <div class="panel">
        <h3>Contacts queued yesterday, by queue</h3>
        <p class="q">${yesterdayTotal} contacts queued in total.</p>
        ${hBarGroup({ items: d.contactsQueuedYesterday.map((q) => ({ label: q.queue, values: [{ value: q.count, color: 'var(--accent)' }] })) })}
      </div>
    </div>

    <div class="panel dr-section-gap">
      <h3>Total contacts queued — 10-day trend</h3>
      <p class="q">All queues combined</p>
      <div class="dr-chart-wrap">${lineChart({ dates: d.contactsQueuedTenDayTrend.labels, series: [{ data: d.contactsQueuedTenDayTrend.totals, color: 'var(--accent)', label: 'Contacts queued' }], height: 210 })}</div>
    </div>

    <div class="panel dr-section-gap">
      <h3>Emails handled yesterday, by agent</h3>
      <p class="q">Incoming vs outbound contacts handled — the cross-category matrix from the source report. Click a column to sort.</p>
      <div class="rtable-wrap dr-emails-table" style="max-height:none">
        <table class="rtable">
          <thead><tr>
            <th><button class="thsort" data-key="agent">Agent <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort" data-key="incoming">Incoming <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort" data-key="outbound">Outbound <span class="thsort-i">⇅</span></button></th>
            <th class="r"><button class="thsort on" data-key="total">Total handled <span class="thsort-i">▼</span></button></th>
          </tr></thead>
          <tbody></tbody>
          <tfoot></tfoot>
        </table>
      </div>
      ${alsoOnPhones.length ? `<p class="foot-note">${alsoOnPhones.map(esc).join(' and ')} also took phone calls today — <a href="#/call-logs/${esc(date)}" style="color:var(--accent)">see the Staff activity table on Call Logs &rarr;</a></p>` : ''}
    </div>

    <div class="kpis dr-section-gap">
      <div class="kpi">
        <div class="k-l">Total in progress</div>
        <div class="k-v num">${d.totalCasesToDate.totalInProgress}</div>
        <div class="k-n">vs 1 week ago ${deltaChip(wowProgress.delta, wowProgress.pct)}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Total open cases</div>
        <div class="k-v num">${d.totalCasesToDate.totalOpenCases}</div>
        <div class="k-n">vs 1 week ago ${deltaChip(wowOpen.delta, wowOpen.pct)}</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>Total in progress — 10-day trend</h3>
        <div class="dr-chart-wrap">${lineChart({ dates: d.inProgressTenDayTrend.labels, series: [{ data: d.inProgressTenDayTrend.totals, color: 'var(--infer)', label: 'In progress' }], height: 200 })}</div>
      </div>
      <div class="panel">
        <h3>Total open cases — 10-day trend</h3>
        <div class="dr-chart-wrap">${lineChart({ dates: d.openCasesTenDayTrend.labels, series: [{ data: d.openCasesTenDayTrend.totals, color: 'var(--accent-2)', label: 'Open cases' }], height: 200 })}</div>
      </div>
    </div>
  `;

  mountRealTimeTable(container.querySelector('.dr-realtime-table'), d.realTimeQueues, d.realTimeSummary);
  mountEmailsTable(container.querySelector('.dr-emails-table'), d.emailsHandledYesterday, emailTotals);
  wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/cloop/${newDate}`; } });
}
