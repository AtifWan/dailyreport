import { esc, fetchJSON, formatDate } from '../util.js';
import { renderMonthCalendar } from '../calendarview.js';

// "On leave" is deliberately the LOUD colour (vermillion), matching the source PDF's
// vivid orange — someone scanning the grid needs the exception (who's out) to pop,
// not the default (who's in). Getting this the other way round is exactly what made
// Kiara Pfeffer's and Renee Bowman's single leave day easy to miss next to five
// fully-orange rows: see the "Interactivity" note in README.
const STATUS = {
  leave: { label: 'On leave', bg: 'var(--danger-soft)', ink: 'var(--danger-ink)' },
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

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** date -> { count, names } for every day the leave grid actually covers (Mon-Fri
 *  of the one known week) — built from the same people/status arrays the week
 *  grid renders, so the calendar can never drift out of sync with it. */
function buildLeaveByDate(d) {
  const map = new Map();
  const allPeople = d.groups.flatMap((g) => g.people);
  d.days.forEach((_, i) => {
    const dateISO = addDaysISO(d.weekStart, i);
    const onLeave = allPeople.filter((p) => p.status[i] === 'leave').map((p) => p.name);
    map.set(dateISO, { count: onLeave.length, names: onLeave });
  });
  return map;
}

const CAL_MIN = { year: 2026, month: 0 };
const CAL_MAX = { year: 2026, month: 11 };

export async function renderLeave(container) {
  const d = await fetchJSON('assets/data/leave.json');
  const todayIndex = dayIndexOf(d.reportDate, d.weekStart);
  const leaveByDate = buildLeaveByDate(d);
  const knownRange = { start: d.weekStart, end: addDaysISO(d.weekStart, d.days.length - 1) };

  const fullWeek = (person) => person.status.every((s) => s === 'leave');
  const noneWeek = (person) => person.status.every((s) => s === 'available');
  const allPeople = d.groups.flatMap((g) => g.people);
  const fullyOnLeave = allPeople.filter(fullWeek).length;
  const partialLeave = allPeople.filter((p) => !fullWeek(p) && !noneWeek(p)).length;
  const outToday = todayIndex >= 0 ? allPeople.filter((p) => p.status[todayIndex] === 'leave').length : null;
  const partialNames = allPeople.filter((p) => !fullWeek(p) && !noneWeek(p)).map((p) => p.name);

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
        <div class="k-n">${partialNames.map(esc).join(', ')}</div>
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
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h3>Leave &amp; public holiday calendar</h3>
          <p class="q">Real 2026 ACT (Canberra) public holidays, plus how many people are on leave each day.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="locbtn dr-cal-prev" aria-label="Previous month">&larr;</button>
          <button class="locbtn dr-cal-next" aria-label="Next month">&rarr;</button>
        </div>
      </div>
      <div class="dr-cal-mount" style="margin-top:14px"></div>
      <p class="foot-note">Public holidays are the real ACT calendar for all of 2026. Day-by-day leave counts are only known for the week above (7–11 Sept 2026) — other working days show <i>"No leave data"</i> rather than imply nobody's out.</p>
    </div>

    <div class="panel dr-section-gap">
      <h3>Long-term leave</h3>
      ${d.longTerm.map((p) => `<p class="foot-note" style="font-size:14px;color:var(--ink-muted)"><b style="color:var(--ink)">${esc(p.name)}</b> — ${esc(p.note)} [${formatDate(p.from)} – ${formatDate(p.to)}]</p>`).join('')}
    </div>
  `;

  // Week grid: day filter + name search
  const tbody = container.querySelector('.dr-leave-table tbody');
  const searchInput = container.querySelector('.dr-leave-search');
  const dayButtons = container.querySelectorAll('.dr-day-filter .locbtn');
  let dayFilter = -1;
  let query = '';

  function paintWeek() {
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
      paintWeek();
    });
  });
  searchInput.addEventListener('input', () => { query = searchInput.value; paintWeek(); });
  paintWeek();

  // Calendar: month navigation, starting on the report month
  const reportDate = new Date(`${d.reportDate}T00:00:00Z`);
  let calYear = reportDate.getUTCFullYear();
  let calMonth = reportDate.getUTCMonth();
  const calMount = container.querySelector('.dr-cal-mount');
  const prevBtn = container.querySelector('.dr-cal-prev');
  const nextBtn = container.querySelector('.dr-cal-next');

  function paintCalendar() {
    calMount.innerHTML = renderMonthCalendar({ year: calYear, month: calMonth, todayISO: d.reportDate, leaveByDate, knownRange });
    prevBtn.disabled = calYear === CAL_MIN.year && calMonth === CAL_MIN.month;
    nextBtn.disabled = calYear === CAL_MAX.year && calMonth === CAL_MAX.month;
    prevBtn.style.opacity = prevBtn.disabled ? .4 : 1;
    nextBtn.style.opacity = nextBtn.disabled ? .4 : 1;
  }
  prevBtn.addEventListener('click', () => {
    if (prevBtn.disabled) return;
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    paintCalendar();
  });
  nextBtn.addEventListener('click', () => {
    if (nextBtn.disabled) return;
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    paintCalendar();
  });
  paintCalendar();
}
