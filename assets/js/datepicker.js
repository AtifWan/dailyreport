import { esc, formatDate } from './util.js';

/**
 * A plain native date input (not a calendar widget) — one instance per page,
 * all reading/writing the same date via the URL (see app.js). `<datalist>`
 * hints which specific dates actually have data (Chrome/Edge show tick marks)
 * without turning this into a custom picker component.
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
      <div class="fgrp">
        <span class="flbl">Report date</span>
        <input class="dinput dr-date-picker" type="date" value="${esc(currentDate)}" min="${esc(min)}" max="${esc(max)}" list="dr-report-dates">
      </div>
      <p class="foot-note" style="margin:0;align-self:center">
        ${manifest.dates.length} report${manifest.dates.length === 1 ? '' : 's'} available (${rangeLabel})
      </p>
    </div>
    <datalist id="dr-report-dates">
      ${manifest.dates.map((d) => `<option value="${esc(d)}"></option>`).join('')}
    </datalist>`;
}

/**
 * @param {Element} container
 * @param {{manifest:object, onChange:(date:string)=>void}} opts
 */
export function wireDatePicker(container, { manifest, onChange }) {
  const input = container.querySelector('.dr-date-picker');
  if (!input) return;
  input.addEventListener('change', () => {
    const val = input.value;
    if (!val) return;
    if (!manifest.dates.includes(val)) {
      // Min/max already keep the native picker within range; this only catches
      // a manually-typed date that's in range but still has no report folder.
      input.value = input.defaultValue;
      return;
    }
    onChange(val);
  });
}
