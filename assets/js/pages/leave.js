import { esc, fetchJSON, formatDate } from '../util.js';

const STATUS = {
  leave: { label: 'On leave', bg: 'var(--manual-soft)', ink: 'var(--manual-ink)' },
  available: { label: 'Available', bg: 'var(--live-soft)', ink: 'var(--live-ink)' },
  public_holiday: { label: 'Public holiday', bg: 'var(--infer-soft)', ink: 'var(--infer-ink)' },
};

function cell(status) {
  const s = STATUS[status];
  return `<td><span class="chip" style="background:${s.bg};color:${s.ink}">${s.label}</span></td>`;
}

export async function renderLeave(container) {
  const d = await fetchJSON('assets/data/leave.json');

  const fullWeek = (person) => person.status.every((s) => s === 'leave');
  const noneWeek = (person) => person.status.every((s) => s === 'available');
  const allPeople = d.groups.flatMap((g) => g.people);
  const fullyOnLeave = allPeople.filter(fullWeek).length;
  const partialLeave = allPeople.filter((p) => !fullWeek(p) && !noneWeek(p)).length;

  const groupRows = d.groups.map((g) => `
    <tr class="dr-group-row"><td colspan="${d.days.length + 1}">${esc(g.group)}</td></tr>
    ${g.people.map((p) => `
      <tr>
        <td class="strong">${esc(p.name)}${p.site ? `<small style="color:var(--ink-faint)"> (${esc(p.site)})</small>` : ''}</td>
        ${p.status.map(cell).join('')}
      </tr>`).join('')}
  `).join('');

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
      <div class="kpi">
        <div class="k-l">Long-term leave</div>
        <div class="k-v num">${d.longTerm.length}</div>
        <div class="k-n">${d.longTerm.map((p) => esc(p.name)).join(', ')}</div>
      </div>
    </div>

    <div class="panel">
      <h3>Week at a glance</h3>
      <p class="q">One row per person, one column per day.</p>
      <div class="rtable-wrap" style="max-height:none">
        <table class="rtable dr-leave-table">
          <thead><tr><th>Name</th>${d.days.map((day) => `<th>${esc(day)}</th>`).join('')}</tr></thead>
          <tbody>${groupRows}</tbody>
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
}
