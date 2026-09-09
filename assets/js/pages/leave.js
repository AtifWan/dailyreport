import { esc, fetchJSON, formatDate } from '../util.js';

const STATUS = {
  leave: { label: 'On leave', bg: 'var(--manual-soft)', ink: 'var(--manual-ink)' },
  available: { label: 'Available', bg: 'var(--live-soft)', ink: 'var(--live-ink)' },
  public_holiday: { label: 'Public holiday', bg: 'var(--infer-soft)', ink: 'var(--infer-ink)' },
};

function cell(status, isToday) {
  const s = STATUS[status];
  return `<td style="${isToday ? 'background:var(--accent-weak)' : ''}"><span class="chip" style="background:${s.bg};color:${s.ink}">${s.label}</span></td>`;
}

function dayIndexOf(reportDateISO, weekStartISO) {
  const report = new Date(`${reportDateISO}T00:00:00Z`);
  const start = new Date(`${weekStartISO}T00:00:00Z`);
  const diff = Math.round((report - start) / 86400000);
  return diff >= 0 && diff <= 4 ? diff : -1;
}

export async function renderLeave(container) {
  const d = await fetchJSON('assets/data/leave.json');
  const todayIndex = dayIndexOf(d.reportDate, d.weekStart);

  const fullWeek = (person) => person.status.every((s) => s === 'leave');
  const noneWeek = (person) => person.status.every((s) => s === 'available');
  const allPeople = d.groups.flatMap((g) => g.people);
  const fullyOnLeave = allPeople.filter(fullWeek).length;
  const partialLeave = allPeople.filter((p) => !fullWeek(p) && !noneWeek(p)).length;
  const outToday = todayIndex >= 0 ? allPeople.filter((p) => p.status[todayIndex] === 'leave').length : null;

  container.innerHTML = `
    <p class="result-meta">Week of ${formatDate(d.weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(d.weekEnd, { day: 'numeric', month: 'long', year: 'numeric' })}</p>

    <div class="kpis">
      <div class="kpi crit">
        <div class="k-l">People, out all week</div>
        <div class="k-v num">${fullyOnLeave}</div>
        <div class="k-n">of ${allPeople.length} on this roster</div>
      </div>
      <div class="kpi">
        <div class="k-l">Partial leave this week</div>
        <div class="k-v num">${partialLeave}</div>
        <div class="k-n">1-2 days out</div>
      </div>
      ${outToday != null ? `
      <div class="kpi ${outToday > 0 ? 'crit' : 'good'}">
        <div class="k-l">Out today (${esc(d.days[todayIndex])})</div>
        <div class="k-v num">${outToday}</div>
        <div class="k-n">of ${allPeople.length} on this roster</div>
      </div>` : ''}
      <div class="kpi">
        <div class="k-l">Long-term leave</div>
        <div class="k-v num">${d.longTerm.length}</div>
        <div class="k-n">${d.longTerm.map((p) => esc(p.name)).join(', ')}</div>
      </div>
    </div>

    <div class="panel">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h3>Week at a glance</h3>
          <p class="q">One row per person, one column per day. Filter by day, or search a name.</p>
        </div>
        <input class="sinput dr-leave-search" type="text" placeholder="Search name">
      </div>
      <div class="dr-day-filter" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px">
        <button class="locbtn on" data-day="-1">All</button>
        ${d.days.map((day, i) => `<button class="locbtn" data-day="${i}">${esc(day)}${i === todayIndex ? ' (today)' : ''}</button>`).join('')}
      </div>
      <div class="rtable-wrap" style="max-height:none">
        <table class="rtable dr-leave-table">
          <thead><tr><th>Name</th>${d.days.map((day, i) => `<th style="${i === todayIndex ? 'background:var(--accent-weak);color:var(--accent-strong)' : ''}">${esc(day)}${i === todayIndex ? '<br><span style="font-weight:400;font-size:11px;text-transform:none;letter-spacing:0">Today</span>' : ''}</th>`).join('')}</tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="dr-legend">
        ${d.legend.map((l) => `<span><i style="background:${STATUS[l.key].bg};border:1px solid ${STATUS[l.key].ink}"></i>${esc(l.label)}</span>`).join('')}
      </div>
    </div>

    <div class="panel dr-section-gap">
      <h3>Long-term leave</h3>
      ${d.longTerm.map((p) => `<p class="foot-note" style="font-size:14px;color:var(--ink-muted)"><b style="color:var(--ink)">${esc(p.name)}</b> — ${esc(p.note)} [${formatDate(p.from)} – ${formatDate(p.to)}]</p>`).join('')}
    </div>
  `;

  const tbody = container.querySelector('.dr-leave-table tbody');
  const searchInput = container.querySelector('.dr-leave-search');
  const dayButtons = container.querySelectorAll('.dr-day-filter .locbtn');
  let dayFilter = -1;
  let query = '';

  function paint() {
    const q = query.trim().toLowerCase();
    const rows = d.groups.map((g) => {
      const people = g.people.filter((p) => {
        const matchesDay = dayFilter === -1 || p.status[dayFilter] === 'leave';
        const matchesQuery = !q || p.name.toLowerCase().includes(q);
        return matchesDay && matchesQuery;
      });
      if (!people.length) return '';
      return `
        <tr class="dr-group-row"><td colspan="${d.days.length + 1}">${esc(g.group)}</td></tr>
        ${people.map((p) => `
          <tr>
            <td class="strong">${esc(p.name)}${p.site ? `<small style="color:var(--ink-faint)"> (${esc(p.site)})</small>` : ''}</td>
            ${p.status.map((s, i) => cell(s, i === todayIndex)).join('')}
          </tr>`).join('')}`;
    }).join('');
    tbody.innerHTML = rows || `<tr><td colspan="${d.days.length + 1}" class="foot-note">No one matches this filter.</td></tr>`;
  }

  dayButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      dayButtons.forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      dayFilter = parseInt(btn.dataset.day, 10);
      paint();
    });
  });
  searchInput.addEventListener('input', () => { query = searchInput.value; paint(); });

  paint();
}
