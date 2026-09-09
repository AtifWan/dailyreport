// Small, dependency-free SVG chart helpers built ONLY from design-system tokens
// (var(--live), var(--danger), var(--accent), var(--age1..4), var(--infer), var(--hairline)…).
// Every function returns an HTML string. No colour is used without an accompanying
// label/shape per DESIGN-GUIDELINES.md §7 — bars and points always carry a value label.
//
// Phase 2 note: these take plain {dates, values} arrays. When Cloop/Call Logs/etc. move
// to a live feed, the page modules just fetch fresh JSON of the same shape — nothing
// here needs to change.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Edge points would otherwise centre their label past the viewBox edge and clip;
// anchor the first/last label to start/end instead so nothing gets cut off.
function edgeAnchor(i, n) {
  if (i === 0) return 'start';
  if (i === n - 1) return 'end';
  return 'middle';
}

// Axis space is tight at 10 points across a ~600px chart — "Wed 26 Aug" collides with
// its neighbour. Drop the weekday for the axis tick only; data-tip keeps the full label.
function shortDate(d) {
  const parts = String(d).split(' ');
  return parts.length === 3 ? parts.slice(1).join(' ') : d;
}

function niceMax(max) {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  let step;
  if (n <= 1) step = 1;
  else if (n <= 2) step = 2;
  else if (n <= 5) step = 5;
  else step = 10;
  return step * pow;
}

/** Single-series vertical bar chart with a value label above each bar. */
export function barChart({ dates, values, color = 'var(--accent)', height = 190, fmt = (v) => v, unit = '' }) {
  const W = 640, H = height, padL = 34, padB = 34, padT = 18, padR = 8;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = niceMax(Math.max(...values, 1) * 1.15);
  const n = values.length;
  const bw = (innerW / n) * 0.58;
  const step = innerW / n;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const bars = values.map((v, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const h = innerH - (y(v) - padT);
    return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="2" fill="${color}"
      data-tip="${esc(dates[i])}: ${esc(fmt(v))}${unit}"></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(y(v) - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${esc(fmt(v))}</text>`;
  }).join('');
  const gridlines = [0, 0.5, 1].map((f) => {
    const yy = padT + innerH * (1 - f);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="var(--hairline)" stroke-width="1"/>`;
  }).join('');
  const labels = dates.map((d, i) => {
    const x = padL + step * i + step / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 10}" text-anchor="${edgeAnchor(i, n)}" font-size="10" fill="var(--ink-faint)">${esc(shortDate(d))}</text>`;
  }).join('');
  return `<svg class="dr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${gridlines}${bars}${labels}</svg>`;
}

/** Two-series stacked vertical bar chart (e.g. accepted + missed), total labelled on top. */
export function stackedBarChart({ dates, seriesA, seriesB, colorA = 'var(--live)', colorB = 'var(--danger)', labelA = 'Accepted', labelB = 'Missed', height = 220 }) {
  const W = 640, H = height, padL = 34, padB = 46, padT = 20, padR = 8;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const totals = seriesA.map((v, i) => v + seriesB[i]);
  const max = niceMax(Math.max(...totals, 1) * 1.12);
  const n = seriesA.length;
  const bw = (innerW / n) * 0.58;
  const step = innerW / n;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const bars = seriesA.map((a, i) => {
    const b = seriesB[i];
    const x = padL + step * i + (step - bw) / 2;
    const yA = y(a);
    const hA = innerH - (yA - padT);
    const yB = y(a + b);
    const hB = yA - yB;
    return `<g>
      <rect x="${x.toFixed(1)}" y="${yA.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(hA, 0).toFixed(1)}" fill="${colorA}"
        data-tip="${esc(dates[i])}: ${labelA} ${a}"></rect>
      <rect x="${x.toFixed(1)}" y="${yB.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(hB, 0).toFixed(1)}" fill="${colorB}"
        data-tip="${esc(dates[i])}: ${labelB} ${b}"></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(yB - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${a + b}</text>
    </g>`;
  }).join('');
  const gridlines = [0, 0.5, 1].map((f) => {
    const yy = padT + innerH * (1 - f);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="var(--hairline)" stroke-width="1"/>`;
  }).join('');
  const labels = dates.map((d, i) => {
    const x = padL + step * i + step / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 30}" text-anchor="${edgeAnchor(i, n)}" font-size="10" fill="var(--ink-faint)">${esc(shortDate(d))}</text>`;
  }).join('');
  return `<svg class="dr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked bar chart">${gridlines}${bars}${labels}</svg>
    <div class="comp-legend" style="margin-top:2px">
      <span><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${colorA};vertical-align:-1px;margin-right:6px"></i>${esc(labelA)}</span>
      <span><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${colorB};vertical-align:-1px;margin-right:6px"></i>${esc(labelB)}</span>
    </div>`;
}

/** Multi-series line chart with point markers, value labels and an optional dashed target line. */
export function lineChart({ dates, series, height = 200, target, targetLabel, unit = '' }) {
  const W = 640, H = height, padL = 34, padB = 30, padT = 20, padR = 12;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const allVals = series.flatMap((s) => s.data).concat(target != null ? [target] : []);
  const max = niceMax(Math.max(...allVals, 1) * 1.15);
  const n = dates.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const x = (i) => padL + stepX * i;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const gridlines = [0, 0.5, 1].map((f) => {
    const yy = padT + innerH * (1 - f);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="var(--hairline)" stroke-width="1"/>`;
  }).join('');
  const targetLine = target != null
    ? `<line x1="${padL}" y1="${y(target).toFixed(1)}" x2="${W - padR}" y2="${y(target).toFixed(1)}" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="4 4"/>
       <text x="${W - padR}" y="${(y(target) - 5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--danger-ink)">${esc(targetLabel || target + unit)}</text>`
    : '';
  const seriesSvg = series.map((s) => {
    const pathD = s.data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const dash = s.dashed ? ' stroke-dasharray="5 4"' : '';
    const dots = s.data.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${s.color}"
        data-tip="${esc(dates[i])} · ${esc(s.label || '')}: ${esc(v)}${unit}"></circle>
      <text x="${x(i).toFixed(1)}" y="${(y(v) - 8).toFixed(1)}" text-anchor="${edgeAnchor(i, n)}" font-size="10" font-weight="700" fill="${s.color}">${v}${unit}</text>`).join('');
    return `<path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2.5"${dash}/>${dots}`;
  }).join('');
  const labels = dates.map((d, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${edgeAnchor(i, n)}" font-size="10" fill="var(--ink-faint)">${esc(shortDate(d))}</text>`).join('');
  const legend = series.length > 1
    ? `<div class="comp-legend" style="margin-top:2px">${series.map((s) => `<span><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${s.color};vertical-align:-1px;margin-right:6px"></i>${esc(s.label)}</span>`).join('')}</div>`
    : '';
  return `<svg class="dr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">${gridlines}${targetLine}${seriesSvg}${labels}</svg>${legend}`;
}

/** Horizontal grouped bar list — one row per item, one or two value bars per row. */
export function hBarGroup({ items, height = 30 }) {
  const max = niceMax(Math.max(...items.flatMap((it) => it.values.map((v) => v.value)), 1) * 1.1);
  const rows = items.map((it) => {
    const bars = it.values.map((v) => {
      const w = Math.max((v.value / max) * 100, v.value > 0 ? 1.5 : 0);
      return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
        <div style="width:100%;background:var(--surface-sunk);border-radius:4px;overflow:hidden;height:14px">
          <div style="width:${w.toFixed(1)}%;height:100%;background:${v.color};border-radius:4px"></div>
        </div>
        <span class="num" style="flex:0 0 auto;font-size:12.5px;color:var(--ink-muted);min-width:34px;text-align:right">${v.value}${v.suffix || ''}</span>
      </div>`;
    }).join('');
    return `<div style="display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center;padding:${height / 2}px 0;border-bottom:1px solid var(--hairline)">
      <div style="font-size:13px;color:var(--ink)">${esc(it.label)}</div>
      <div>${bars}</div>
    </div>`;
  }).join('');
  return `<div>${rows}</div>`;
}

/** Wire up the design system's cursor-following .chart-tip on every [data-tip] element (once). */
export function initChartTooltips(root = document) {
  let tip = document.getElementById('dr-chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'dr-chart-tip';
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  const show = (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.classList.remove('show'); return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
    tip.classList.add('show');
  };
  root.addEventListener('mousemove', show);
  root.addEventListener('mouseleave', () => tip.classList.remove('show'), true);
}
