import { esc } from './util.js';

/** The previous REPORT (manifest-adjacent date), not the previous calendar day —
 *  reports skip weekends, so "Monday vs Friday" is the meaningful comparison,
 *  not "Monday vs Sunday". Returns null for the very first date in the manifest. */
export function getPreviousDate(manifest, date) {
  const idx = manifest.dates.indexOf(date);
  return idx > 0 ? manifest.dates[idx - 1] : null;
}

/** Renders a "vs previous report" badge for a single KPI tile.
 *  `goodWhen` is which way a RISE in the number reads for that metric —
 *  'up' (higher is good, e.g. Calls Accepted), 'down' (higher is bad, e.g.
 *  Calls Missed or a backlog count), or 'neutral' (no inherent good/bad, e.g.
 *  a plain volume count) — not which way the digit itself moved, so e.g.
 *  Calls Missed falling still reads as good (not "down = red").
 *  `format` overrides the default `${v}${percent ? '%' : ''}` rendering for
 *  both the previous value and the delta magnitude (e.g. a seconds formatter).
 *  Returns '' (renders nothing) when either value or the comparison date is
 *  missing, rather than guessing. */
export function compareBadge(curr, prev, { goodWhen = 'neutral', prevDateLabel, percent = false, format } = {}) {
  if (curr == null || prev == null || prevDateLabel == null) return '';
  const fmt = format || ((v) => `${v}${percent ? '%' : ''}`);
  const delta = curr - prev;
  const prevText = `${fmt(prev)} on ${esc(prevDateLabel)}`;
  if (delta === 0) {
    return `<div class="dr-compare-row"><span class="dr-compare-badge dr-compare-badge--flat">No change (${prevText})</span></div>`;
  }
  const kind = goodWhen === 'neutral' ? 'neutral' : (delta > 0) === (goodWhen === 'up') ? 'good' : 'bad';
  const arrow = delta > 0 ? '&#9650;' : '&#9660;';
  return `<div class="dr-compare-row"><span class="dr-compare-badge dr-compare-badge--${kind}">${arrow} ${fmt(Math.abs(delta))} (was ${prevText})</span></div>`;
}
