export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Fetch a page's JSON data file. In Phase 2, swap the URL for a live API endpoint —
 *  every page module only ever deals with the parsed object this returns. */
export async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

export function pct(n) { return `${n}%`; }

/** Format a date-only ISO string ("2026-01-13") without local-timezone drift.
 *  `new Date("2026-01-13").toLocaleDateString()` shifts a day back for any viewer
 *  west of UTC, because the string parses as UTC midnight; pinning timeZone:'UTC'
 *  makes the displayed date always match the literal string, everywhere. */
export function formatDate(isoDate, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' });
}
