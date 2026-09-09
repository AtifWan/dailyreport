import { esc } from './util.js';
import { holidayName, isWorkingDay } from './workdays.js';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function iso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Renders one month as a 7-column grid: real ACT public holidays (from
 * workdays.js — the same list the streak "since" dates use) plus, for
 * whichever dates `leaveByDate` covers, how many people are on leave.
 * Dates outside `leaveByDate`'s coverage are shown plainly rather than
 * implied to be leave-free — this report only has one week of leave data.
 *
 * @param {number} year
 * @param {number} month 0-11
 * @param {string} todayISO
 * @param {Map<string,{count:number,names:string[]}>} leaveByDate
 * @param {{start:string,end:string}} knownRange - the date range leaveByDate actually covers
 */
export function renderMonthCalendar({ year, month, todayISO, leaveByDate, knownRange }) {
  const first = new Date(Date.UTC(year, month, 1));
  const startWeekday = (first.getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const header = WEEKDAY_LABELS.map((w) => `<div class="dr-cal-weekday">${w}</div>`).join('');

  const body = cells.map((d) => {
    if (d == null) return '<div class="dr-cal-cell dr-cal-cell--empty"></div>';
    const dateISO = iso(year, month, d);
    const holiday = holidayName(dateISO);
    const weekend = !isWorkingDay(dateISO) && !holiday;
    const isToday = dateISO === todayISO;
    const inKnownRange = knownRange && dateISO >= knownRange.start && dateISO <= knownRange.end;
    const leave = leaveByDate.get(dateISO);

    const classes = ['dr-cal-cell'];
    if (holiday) classes.push('dr-cal-cell--holiday');
    else if (weekend) classes.push('dr-cal-cell--weekend');
    if (isToday) classes.push('dr-cal-cell--today');

    return `
      <div class="${classes.join(' ')}">
        <div class="dr-cal-daynum">${d}${isToday ? '<span class="dr-cal-today-tag">Today</span>' : ''}</div>
        ${holiday ? `<div class="dr-cal-holiday">${esc(holiday)}</div>` : ''}
        ${!holiday && !weekend ? (
          leave && leave.count > 0
            ? `<div class="dr-cal-leave" data-tip="${esc(leave.names.join(', '))}">${leave.count} on leave</div>`
            : inKnownRange
              ? `<div class="dr-cal-leave dr-cal-leave--none">All in</div>`
              : `<div class="dr-cal-leave dr-cal-leave--unknown">No leave data</div>`
        ) : ''}
      </div>`;
  }).join('');

  return `
    <div class="dr-cal-title">${MONTH_LABELS[month]} ${year}</div>
    <div class="dr-cal-grid">${header}${body}</div>`;
}
