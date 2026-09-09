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

/** Add `n` calendar days to a date-only ISO string, returning another one.
 *  UTC-based so it never drifts a day under a non-UTC viewer timezone — same
 *  reasoning as formatDate() below. */
export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Format a date-only ISO string ("2026-01-13") without local-timezone drift.
 *  `new Date("2026-01-13").toLocaleDateString()` shifts a day back for any viewer
 *  west of UTC, because the string parses as UTC midnight; pinning timeZone:'UTC'
 *  makes the displayed date always match the literal string, everywhere. */
export function formatDate(isoDate, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' });
}

/**
 * Wires up a sortable, optionally searchable, optionally expandable data table.
 *
 * Expects `container` to already hold a <table> (matching `tableSelector`) whose
 * <thead> has one `button.thsort[data-key="<field>"]` per sortable column and an
 * empty <tbody> — this function owns repainting the <tbody> from here on. Backing
 * data lives in plain JS (`rows`), not the DOM, so sort/search/expand are just a
 * repaint, never a live DOM reorder.
 *
 * @param {Element} container
 * @param {object} opts
 * @param {string} [opts.tableSelector]
 * @param {object[]} opts.rows
 * @param {(row:object)=>string} opts.keyOf - stable id for a row (expand tracking)
 * @param {(row:object, open:boolean)=>string} opts.renderRow - the <tr> for a row;
 *   include `data-key="${keyOf(row)}"` on it if `renderDetail` is used.
 * @param {(row:object)=>string} [opts.renderDetail] - an extra <tr> shown when expanded
 * @param {string} [opts.searchInputSelector]
 * @param {(row:object)=>string} [opts.searchText]
 * @param {string} [opts.defaultSortKey]
 * @param {'asc'|'desc'} [opts.defaultSortDir]
 * @param {number} [opts.emptyColspan]
 */
export function mountInteractiveTable(container, {
  tableSelector = 'table',
  rows,
  keyOf,
  renderRow,
  renderDetail,
  searchInputSelector,
  searchText,
  defaultSortKey,
  defaultSortDir = 'desc',
  emptyColspan = 6,
}) {
  const table = container.querySelector(tableSelector);
  const tbody = table.querySelector('tbody');
  const searchInput = searchInputSelector ? container.querySelector(searchInputSelector) : null;
  let sortKey = defaultSortKey;
  let sortDir = defaultSortDir;
  let query = '';
  const openKeys = new Set();

  function currentRows() {
    let list = rows;
    if (query && searchText) {
      const q = query.toLowerCase();
      list = list.filter((r) => searchText(r).toLowerCase().includes(q));
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }

  function paint() {
    const list = currentRows();
    tbody.innerHTML = list.length
      ? list.map((r) => {
          const key = keyOf(r);
          const open = openKeys.has(key);
          return renderRow(r, open) + (open && renderDetail ? renderDetail(r) : '');
        }).join('')
      : `<tr><td colspan="${emptyColspan}" class="foot-note">No matches for "${esc(query)}".</td></tr>`;
    table.querySelectorAll('.thsort').forEach((btn) => {
      const on = btn.dataset.key === sortKey;
      btn.classList.toggle('on', on);
      const arrow = btn.querySelector('.thsort-i');
      if (arrow) arrow.textContent = on ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
    });
  }

  table.querySelectorAll('.thsort').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      sortDir = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
      sortKey = key;
      paint();
    });
  });

  if (renderDetail) {
    tbody.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return; // don't hijack an in-row link/button
      const tr = e.target.closest('tr[data-key]');
      if (!tr) return;
      const key = tr.dataset.key;
      if (openKeys.has(key)) openKeys.delete(key); else openKeys.add(key);
      paint();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => { query = searchInput.value.trim(); paint(); });
  }

  paint();
}
