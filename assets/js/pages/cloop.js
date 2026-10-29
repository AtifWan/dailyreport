import { esc, fetchJSON, formatDate, mountInteractiveTable } from '../util.js';
import { lineChart, hBarGroup } from '../charts.js';
import { datePickerHtml, wireDatePicker } from '../datepicker.js';
import { compareBadge, getPreviousDate } from '../compare.js';

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
  const prevDate = getPreviousDate(manifest, date);
  const [d, callLogs, prevD] = await Promise.all([
    fetchJSON(`assets/data/reports/${date}/cloop.json`).catch(() => null),
    fetchJSON(`assets/data/reports/${date}/call-logs.json`).catch(() => null),
    prevDate ? fetchJSON(`assets/data/reports/${prevDate}/cloop.json`).catch(() => null) : Promise.resolve(null),
  ]);
  const prevDateLabel = prevD ? formatDate(prevDate, { day: 'numeric', month: 'short' }) : null;
  const prevYesterdayTotal = prevD?.contactsQueuedYesterday ? prevD.contactsQueuedYesterday.reduce((s, q) => s + q.count, 0) : null;

  // A handful of the oldest reports in this project's backlog (see PHASE-2.md's
  // Pattern B note) have no Cloop section published at all — not a thinner one,
  // none whatsoever — so there's no cloop.json for this date to even omit fields
  // from. Show that plainly instead of falling through to the generic page-load
  // error a missing file would otherwise produce.
  if (!d) {
    container.innerHTML = `
      ${datePickerHtml(date, manifest)}
      <p class="dr-placeholder">No Cloop report was published for this date.</p>
    `;
    wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/cloop/${newDate}`; } });
    return;
  }
  // Some earlier/thinner reports (see Pattern A/B notes in the backlog) don't publish
  // every Cloop section — no per-queue "contacts queued yesterday" breakdown, or none
  // of the three 10-day trend charts. Each is optional here rather than assumed present.
  const yesterdayTotal = d.contactsQueuedYesterday ? d.contactsQueuedYesterday.reduce((s, q) => s + q.count, 0) : null;
  const wowQueued = d.contactsQueuedTenDayTrend ? weekOverWeek(d.contactsQueuedTenDayTrend.totals) : null;
  const wowProgress = d.inProgressTenDayTrend ? weekOverWeek(d.inProgressTenDayTrend.totals) : null;
  const wowOpen = d.openCasesTenDayTrend ? weekOverWeek(d.openCasesTenDayTrend.totals) : null;
  const emailTotals = d.emailsHandledYesterday.reduce((acc, a) => ({ incoming: acc.incoming + a.incoming, outbound: acc.outbound + a.outbound, total: acc.total + a.total }), { incoming: 0, outbound: 0, total: 0 });

  const callNames = new Set((callLogs?.inboundByStaff || []).concat(callLogs?.outboundByStaff || []).map((p) => p.name));
  const alsoOnPhones = d.emailsHandledYesterday.map((a) => a.agent).filter((name) => callNames.has(name));

  container.innerHTML = `
    ${datePickerHtml(date, manifest)}
    <div class="kpis">
      <div class="kpi">
        <div class="k-l">In queue right now</div>
        <div class="k-v num">${d.realTimeSummary.inQueue}</div>
        ${compareBadge(d.realTimeSummary.inQueue, prevD?.realTimeSummary?.inQueue, { goodWhen: 'down', prevDateLabel })}
        <div class="k-n">across ${d.realTimeQueues.length} queues</div>
      </div>
      <div class="kpi crit">
        <div class="k-l">Oldest case in queue</div>
        <div class="k-v num">${d.realTimeSummary.oldestDays}<small style="font-size:14px;font-weight:600"> days</small></div>
        ${compareBadge(d.realTimeSummary.oldestDays, prevD?.realTimeSummary?.oldestDays, { goodWhen: 'down', prevDateLabel, format: (v) => `${Math.round(v * 100) / 100}d` })}
        <div class="k-n">extracted ${esc(d.extractedAtLabel)}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Emails queued, yesterday</div>
        <div class="k-v num">${yesterdayTotal != null ? yesterdayTotal : '—'}</div>
        ${compareBadge(yesterdayTotal, prevYesterdayTotal, { goodWhen: 'neutral', prevDateLabel })}
        <div class="k-n">${wowQueued ? `vs 1 week ago ${deltaChip(wowQueued.delta, wowQueued.pct)}` : 'Not published this date'}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Total overall cases</div>
        <div class="k-v num">${d.totalCasesToDate.totalOverallCases.toLocaleString()}</div>
        ${compareBadge(d.totalCasesToDate.totalOverallCases, prevD?.totalCasesToDate?.totalOverallCases, { goodWhen: 'neutral', prevDateLabel, format: (v) => v.toLocaleString() })}
        <div class="k-n">to date, as of ${d.totalCasesToDate.date}</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>Real-time metrics, by queue</h3>
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
        <h3>Emails queued yesterday, by queue</h3>
        ${d.contactsQueuedYesterday ? `
        <p class="q">${yesterdayTotal} emails queued in total.</p>
        ${hBarGroup({ items: d.contactsQueuedYesterday.map((q) => ({ label: q.queue, values: [{ value: q.count, color: 'var(--accent)' }] })) })}
        ` : `<p class="dr-placeholder">Not published this date.</p>`}
      </div>
    </div>

    ${d.contactsQueuedTenDayTrend ? `
    <div class="panel dr-section-gap">
      <h3>Total emails queued — 10-day trend</h3>
      <div class="dr-chart-wrap">${lineChart({ dates: d.contactsQueuedTenDayTrend.labels, series: [{ data: d.contactsQueuedTenDayTrend.totals, color: 'var(--accent)', label: 'Emails queued' }], height: 210 })}</div>
    </div>
    ` : ''}

    <div class="panel dr-section-gap">
      <h3>Emails handled yesterday, by agent</h3>
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
        ${compareBadge(d.totalCasesToDate.totalInProgress, prevD?.totalCasesToDate?.totalInProgress, { goodWhen: 'down', prevDateLabel })}
        <div class="k-n">${wowProgress ? `vs 1 week ago ${deltaChip(wowProgress.delta, wowProgress.pct)}` : 'Not published this date'}</div>
      </div>
      <div class="kpi">
        <div class="k-l">Total open cases</div>
        <div class="k-v num">${d.totalCasesToDate.totalOpenCases}</div>
        ${compareBadge(d.totalCasesToDate.totalOpenCases, prevD?.totalCasesToDate?.totalOpenCases, { goodWhen: 'down', prevDateLabel })}
        <div class="k-n">${wowOpen ? `vs 1 week ago ${deltaChip(wowOpen.delta, wowOpen.pct)}` : 'Not published this date'}</div>
      </div>
    </div>

    ${(d.inProgressTenDayTrend || d.openCasesTenDayTrend) ? `
    <div class="grid2">
      ${d.inProgressTenDayTrend ? `
      <div class="panel">
        <h3>Total in progress — 10-day trend</h3>
        <div class="dr-chart-wrap">${lineChart({ dates: d.inProgressTenDayTrend.labels, series: [{ data: d.inProgressTenDayTrend.totals, color: 'var(--infer)', label: 'In progress' }], height: 200 })}</div>
      </div>
      ` : ''}
      ${d.openCasesTenDayTrend ? `
      <div class="panel">
        <h3>Total open cases — 10-day trend</h3>
        <div class="dr-chart-wrap">${lineChart({ dates: d.openCasesTenDayTrend.labels, series: [{ data: d.openCasesTenDayTrend.totals, color: 'var(--accent-2)', label: 'Open cases' }], height: 200 })}</div>
      </div>
      ` : ''}
    </div>
    ` : ''}
  `;

  mountRealTimeTable(container.querySelector('.dr-realtime-table'), d.realTimeQueues, d.realTimeSummary);
  mountEmailsTable(container.querySelector('.dr-emails-table'), d.emailsHandledYesterday, emailTotals);
  wireDatePicker(container, { manifest, onChange: (newDate) => { location.hash = `#/cloop/${newDate}`; } });
}
