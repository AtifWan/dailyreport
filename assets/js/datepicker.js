import { esc, formatDate } from './util.js';

const DATEPICKER_WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DATEPICKER_MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ym(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  return { year, month: month - 1 };
}
function isoOf(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function monthIndex(year, month) { return year * 12 + month; }

/**
 * A calendar-grid date picker — one instance per page, all reading/writing the
 * same date via the URL (see app.js). Renders as a button (showing the current
 * report date) that opens a month-grid popover; only dates that actually have a
 * report (manifest.dates) are clickable, everything else in the grid is shown
 * greyed-out so the shape of "which days have data" is visible at a glance —
 * the thing the old native <input type=date>'s <datalist> tick marks only did
 * inconsistently (and not at all in browsers that render it as a plain list,
 * as opposed to a calendar).
 *
 * @param {string} currentDate
 * @param {{dates:string[], latest:string}} manifest
 */
export function datePickerHtml(currentDate, manifest) {
  const min = manifest.dates[0];
  const max = manifest.latest;
  const rangeLabel = min === max
    ? formatDate(min, { day: 'numeric', month: 'short', year: 'numeric' })
    : `${formatDate(min, { day: 'numeric', month: 'short' })} – ${formatDate(max, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `
    <div class="filters dr-date-filter" style="margin-bottom:20px">
      <div class="fgrp dr-datepicker" data-value="${esc(currentDate)}">
        <span class="flbl">Report date</span>
        <button type="button" class="dinput dr-datepicker-btn" aria-haspopup="true" aria-expanded="false">
          <span class="dr-datepicker-val">${esc(formatDate(currentDate, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="dr-datepicker-pop" hidden>
          <div class="dr-datepicker-nav">
            <button type="button" class="dr-datepicker-prev" aria-label="Previous month">‹</button>
            <span class="dr-datepicker-mon"></span>
            <button type="button" class="dr-datepicker-next" aria-label="Next month">›</button>
          </div>
          <div class="dr-pick-grid"></div>
        </div>
      </div>
      <p class="foot-note" style="margin:0;align-self:center">
        ${manifest.dates.length} report${manifest.dates.length === 1 ? '' : 's'} available (${rangeLabel})
      </p>
    </div>`;
}

// Outside-click / Escape-to-close is handled by one delegated pair of document
// listeners, installed once for the page's whole lifetime (this module is a
// singleton) rather than per render — the app re-renders #page-content (and so
// re-runs wireDatePicker) on every navigation, and per-instance document
// listeners would otherwise pile up, each holding a dead reference to a
// detached .dr-datepicker from a previous page.
let globalHandlersInstalled = false;
function closePop(pop) {
  if (pop.hidden) return;
  pop.hidden = true;
  pop.closest('.dr-datepicker')?.querySelector('.dr-datepicker-btn')?.setAttribute('aria-expanded', 'false');
}
function installGlobalHandlersOnce() {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.dr-datepicker-pop').forEach((pop) => {
      if (!pop.hidden && !pop.closest('.dr-datepicker').contains(e.target)) closePop(pop);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.dr-datepicker-pop').forEach(closePop);
  });
}

/**
 * @param {Element} container
 * @param {{manifest:object, onChange:(date:string)=>void}} opts
 */
export function wireDatePicker(container, { manifest, onChange }) {
  const root = container.querySelector('.dr-datepicker');
  if (!root) return;
  installGlobalHandlersOnce();

  const btn = root.querySelector('.dr-datepicker-btn');
  const pop = root.querySelector('.dr-datepicker-pop');
  const monLabel = root.querySelector('.dr-datepicker-mon');
  const grid = root.querySelector('.dr-pick-grid');
  const prevBtn = root.querySelector('.dr-datepicker-prev');
  const nextBtn = root.querySelector('.dr-datepicker-next');

  const available = new Set(manifest.dates);
  const selected = root.dataset.value;
  const minMonth = ym(manifest.dates[0]);
  const maxMonth = ym(manifest.latest);
  let view = ym(selected);

  function paint() {
    monLabel.textContent = `${DATEPICKER_MONTH_LABELS[view.month]} ${view.year}`;
    prevBtn.disabled = monthIndex(view.year, view.month) <= monthIndex(minMonth.year, minMonth.month);
    nextBtn.disabled = monthIndex(view.year, view.month) >= monthIndex(maxMonth.year, maxMonth.month);

    const first = new Date(Date.UTC(view.year, view.month, 1));
    const startWeekday = (first.getUTCDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();

    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const header = DATEPICKER_WEEKDAY_LABELS.map((w) => `<div class="dr-pick-weekday">${w}</div>`).join('');
    const body = cells.map((d) => {
      if (d == null) return '<div class="dr-pick-cell dr-pick-cell--empty"></div>';
      const dateISO = isoOf(view.year, view.month, d);
      const has = available.has(dateISO);
      const classes = ['dr-pick-day', has ? 'dr-pick-day--has' : 'dr-pick-day--empty'];
      if (dateISO === selected) classes.push('dr-pick-day--sel');
      return `<div class="dr-pick-cell"><button type="button" class="${classes.join(' ')}" data-date="${dateISO}" ${has ? '' : 'disabled tabindex="-1"'}>${d}</button></div>`;
    }).join('');

    grid.innerHTML = header + body;
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) {
      // Reopen back on the selected date's month, not wherever it was last browsed to.
      view = ym(selected);
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      paint();
    } else {
      closePop(pop);
    }
  });

  prevBtn.addEventListener('click', () => {
    if (prevBtn.disabled) return;
    view = view.month === 0 ? { year: view.year - 1, month: 11 } : { year: view.year, month: view.month - 1 };
    paint();
  });
  nextBtn.addEventListener('click', () => {
    if (nextBtn.disabled) return;
    view = view.month === 11 ? { year: view.year + 1, month: 0 } : { year: view.year, month: view.month + 1 };
    paint();
  });

  grid.addEventListener('click', (e) => {
    const day = e.target.closest('.dr-pick-day--has');
    if (!day) return;
    const val = day.dataset.date;
    closePop(pop);
    if (val !== selected) onChange(val);
  });

  paint();
}
