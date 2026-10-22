import { fetchJSON, formatDate, todayISOInCanberra } from './util.js';
import { startOfWorkingStreak } from './workdays.js';

// Builds the downloadable report as a native, vector-drawn PDF — every word of text,
// every table cell and every chart line is drawn straight into the PDF with jsPDF,
// not screenshotted off the live page. That's what makes it print crisp at any zoom
// (a screenshot-based PDF blurs past ~150%) and small (a few hundred KB, not tens of
// MB of embedded JPEG). The trade-off is that this file no longer reuses the page
// modules under pages/ — it fetches the same report JSON directly and lays it out
// for print, so a schema change to one of those JSON files needs a matching update
// here too (each section builder below names the fields it reads).
//
// jsPDF's default fonts (Helvetica/Times/Courier) only encode WinAnsi/Latin-1 —
// no ✓, ☐, ▲, ▼, ⚑, or other Unicode symbol renders correctly. Every marker in this
// file is plain ASCII or a colour, never a symbol glyph, for exactly that reason.
const PAGE_W = 297, PAGE_H = 210, MARGIN = 10; // A4 landscape, mm
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 13; // margin-top to body start, on every section page (not the cover)
const FOOTER_H = 9; // body end to page bottom
const BODY_Y = MARGIN + HEADER_H;
const BODY_H = PAGE_H - MARGIN - FOOTER_H - BODY_Y;

const DASHBOARD_URL = 'https://dailyreport-x15l.vercel.app/';

let libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}
function ensureLibs() {
  if (window.jspdf) return Promise.resolve();
  if (!libsPromise) libsPromise = loadScript('assets/vendor/jspdf.umd.min.js');
  return libsPromise;
}

/** Resolves ANY valid CSS colour (oklch(), a hex string, a "/ 0.12"-alpha token, …) to
 *  opaque [r,g,b] ints — painting it onto a white 1x1 canvas and reading the pixel back
 *  both lets the browser's own colour parser do the oklch math (jsPDF's can't) and
 *  correctly composites a translucent design-system tint (e.g. --accent-weak) against
 *  the white page it'll actually sit on, in one step. */
function resolveRgb(cssColor) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** Reads the live design system's own custom properties so the PDF's palette always
 *  matches the dashboard's, even if tokens.css changes later — never a hand-copied
 *  duplicate set of colours to fall out of sync. */
function buildPalette() {
  const cs = getComputedStyle(document.documentElement);
  const rgb = (name) => resolveRgb(cs.getPropertyValue(name).trim());
  return {
    ink: rgb('--ink'), inkMuted: rgb('--ink-muted'), inkFaint: rgb('--ink-faint'),
    hairline: rgb('--hairline'), hairlineStrong: rgb('--hairline-strong'),
    surfaceSunk: rgb('--surface-sunk'),
    accent: rgb('--accent'), accentStrong: rgb('--accent-strong'), accentWeak: rgb('--accent-weak'),
    accent2: rgb('--accent-2'),
    live: rgb('--live'), liveSoft: rgb('--live-soft'), liveInk: rgb('--live-ink'),
    infer: rgb('--infer'), inferSoft: rgb('--infer-soft'), inferInk: rgb('--infer-ink'),
    danger: rgb('--danger'), dangerSoft: rgb('--danger-soft'), dangerInk: rgb('--danger-ink'),
    age1: rgb('--age1'), age2: rgb('--age2'), age3: rgb('--age3'), age4: rgb('--age4'),
    white: [255, 255, 255],
  };
}

function niceMax(max) {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// The live dashboard drops the weekday from a "Wed 16 Sep"-style axis label when
// space is tight (see shortDate() in charts.js) — same fix, same reason, here.
function shortDate(d) {
  const parts = String(d).split(' ');
  return parts.length === 3 ? parts.slice(1).join(' ') : d;
}

function fmtSec(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Flow: a per-section vertical cursor that starts a fresh continuation page
// (same title, same colour, "(cont'd)" appended) the moment the next block
// wouldn't fit — so a page-per-section is the norm, but no report ever loses
// content or overlaps two panels because one date happened to have more rows
// than another. `pageMeta` is the single array the final chrome pass reads.
// ---------------------------------------------------------------------------
function makeFlow(doc, pageMeta, meta) {
  let y = BODY_Y;
  return {
    get y() { return y; },
    set y(v) { y = v; },
    get remaining() { return BODY_Y + BODY_H - y; },
    /** Ensures `h` mm are available at the current cursor, breaking to a new
     *  page first if not, and returns the y to draw at. */
    ensure(h) {
      if (y + h > BODY_Y + BODY_H + 0.01) {
        doc.addPage('a4', 'landscape');
        pageMeta.push({ isCover: false, title: `${meta.title} (cont'd)`, color: meta.color, dateLabel: meta.dateLabel });
        y = BODY_Y;
      }
      return y;
    },
  };
}

/** Every drawing primitive the section builders use, closed over one jsPDF document
 *  and one resolved palette so callers never repeat a setFillColor/setDrawColor triad. */
function makeKit(doc, pal) {
  const fill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const draw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const text = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  function kpiTile(x, y, w, h, { label, value, sub, tone = 'neutral' }) {
    const barRgb = tone === 'good' ? pal.live : tone === 'crit' ? pal.danger : pal.hairlineStrong;
    draw(pal.hairline); doc.setLineWidth(0.2);
    doc.roundedRect(x, y, w, h, 1.6, 1.6, 'S');
    fill(barRgb);
    doc.roundedRect(x, y, 1.6, h, 0.8, 0.8, 'F');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); text(pal.inkFaint);
    doc.text(String(label).toUpperCase(), x + 4.5, y + 5.1);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(15.5);
    text(tone === 'good' ? pal.liveInk : tone === 'crit' ? pal.dangerInk : pal.ink);
    doc.text(String(value), x + 4.5, y + 12.6);

    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); text(pal.inkMuted);
      doc.splitTextToSize(sub, w - 8).slice(0, 2).forEach((line, i) => doc.text(line, x + 4.5, y + 17.1 + i * 3.2));
    }
  }

  function kpiRow(x, y, w, h, tiles) {
    const gap = 3;
    const tw = (w - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((t, i) => kpiTile(x + i * (tw + gap), y, tw, h, t));
    return y + h;
  }

  function panelFrame(x, y, w, h, title, sub) {
    draw(pal.hairline); doc.setLineWidth(0.2);
    doc.roundedRect(x, y, w, h, 2, 2, 'S');
    let yy = y + 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text(pal.ink);
    doc.text(title, x + 4, yy);
    yy += 4;
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); text(pal.inkFaint);
      doc.text(sub, x + 4, yy);
      yy += 3.8;
    }
    return yy + 1.2;
  }
  /** Header consumed by panelFrame for a given title/sub combination — section
   *  builders use this to size a panel *before* drawing it (deciding how much
   *  room to ensure()). Positioning content, once the panel IS drawn, must
   *  always use panelFrame's own return value instead, never this estimate. */
  function panelHeaderH(sub) { return sub ? 15 : 7.2; }

  /** A label / proportional-bar / value row, e.g. a streak or a queue's accepted count. */
  function hBarRows(x, y, w, rowH, rows, { labelW = 34, valueW = 28 } = {}) {
    let yy = y;
    const barX = x + labelW, barW = w - labelW - valueW;
    rows.forEach((r) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); text(pal.ink);
      doc.text(r.label, x, yy + rowH * 0.62, { maxWidth: labelW - 2 });
      fill(pal.surfaceSunk);
      doc.roundedRect(barX, yy + rowH * 0.16, barW, rowH * 0.5, 0.8, 0.8, 'F');
      const frac = Math.max(0, Math.min(1, r.frac));
      const fw = frac > 0 ? Math.max(barW * frac, 1.4) : 0;
      if (fw > 0) { fill(r.color || pal.accent); doc.roundedRect(barX, yy + rowH * 0.16, fw, rowH * 0.5, 0.8, 0.8, 'F'); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); text(pal.ink);
      doc.text(r.valueLabel, x + w, yy + rowH * 0.62, { align: 'right' });
      if (r.subLabel) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); text(pal.inkFaint);
        doc.text(r.subLabel, x + w, yy + rowH - 0.6, { align: 'right' });
      }
      yy += rowH;
    });
    return yy;
  }

  /** Two thin stacked bars per row (accepted vs missed) instead of one combined bar —
   *  matches the live dashboard's own hBarGroup(), which draws each value as its own
   *  full-width-proportional bar rather than summing them. rowH needs to be generous
   *  enough (>=8mm) for both value labels to sit clear of one another. */
  function hBarGroupDual(x, y, w, rowH, items, { labelW = 40 } = {}) {
    let yy = y;
    const max = Math.max(...items.flatMap((it) => it.values.map((v) => v.value)), 1);
    const barX = x + labelW, barW = w - labelW - 16;
    items.forEach((it) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); text(pal.ink);
      doc.text(it.label, x, yy + rowH / 2 + 1, { maxWidth: labelW - 2 });
      const gap = 1;
      const barH = (rowH - gap) / it.values.length - gap;
      it.values.forEach((v, i) => {
        const by = yy + i * (barH + gap);
        fill(pal.surfaceSunk); doc.roundedRect(barX, by, barW, barH, 0.5, 0.5, 'F');
        const fw = v.value > 0 ? Math.max(barW * (v.value / max), 1.2) : 0;
        if (fw > 0) { fill(v.color); doc.roundedRect(barX, by, fw, barH, 0.5, 0.5, 'F'); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4); text(pal.inkMuted);
        doc.text(String(v.value), x + w, by + barH - 0.4, { align: 'right' });
      });
      yy += rowH;
    });
    return yy;
  }

  function legendChip(x, y, color, label, fontSize = 6.8) {
    fill(color); doc.rect(x, y - 2.2, 2.6, 2.6, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fontSize); text(pal.inkMuted);
    doc.text(label, x + 3.6, y);
    return x + 3.6 + doc.getTextWidth(label) + 6;
  }

  /** Single-series line chart with a point + value label at every date, and an
   *  optional dashed target line — every 10-day trend in this project is exactly
   *  this shape (see lineChart() in charts.js, which this mirrors in vector form). */
  function lineChart(x, y, w, h, { labels, data, color, unit = '', target, targetLabel }) {
    const padT = 5.5, padB = 6, padL = 1, padR = 1;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const allVals = data.concat(target != null ? [target] : []);
    const max = niceMax(Math.max(...allVals, 1) * 1.18);
    const n = labels.length;
    const stepX = n > 1 ? innerW / (n - 1) : 0;
    const X = (i) => x + padL + stepX * i;
    const Y = (v) => y + padT + innerH - (v / max) * innerH;

    draw(pal.hairline); doc.setLineWidth(0.15);
    [0, 0.5, 1].forEach((f) => { const yy = y + padT + innerH * (1 - f); doc.line(x, yy, x + w, yy); });

    if (target != null) {
      draw(pal.danger); doc.setLineWidth(0.3);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(x, Y(target), x + w, Y(target));
      doc.setLineDashPattern([], 0);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); text(pal.dangerInk);
      doc.text(targetLabel || `${target}${unit}`, x + w, Y(target) - 1, { align: 'right' });
    }

    draw(color); doc.setLineWidth(0.55);
    for (let i = 0; i < n - 1; i++) doc.line(X(i), Y(data[i]), X(i + 1), Y(data[i + 1]));
    fill(color);
    data.forEach((v, i) => {
      doc.circle(X(i), Y(v), 0.75, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6); text(color);
      const align = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
      doc.text(`${v}${unit}`, X(i), Y(v) - 1.6, { align });
    });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); text(pal.inkFaint);
    labels.forEach((d, i) => {
      const align = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
      doc.text(shortDate(d), X(i), y + h - 1, { align });
    });
  }

  /** Two-series stacked vertical bars with the combined total labelled on top and a
   *  small legend beneath — the print counterpart of stackedBarChart() in charts.js. */
  function stackedBarChart(x, y, w, h, { labels, seriesA, seriesB, colorA, colorB, labelA, labelB }) {
    const padT = 5.5, padB = 6, legendH = 5;
    const innerW = w, innerH = h - padT - padB - legendH;
    const totals = seriesA.map((v, i) => v + seriesB[i]);
    const max = niceMax(Math.max(...totals, 1) * 1.15);
    const n = seriesA.length;
    const step = innerW / n, bw = step * 0.6;
    const Y = (v) => y + padT + innerH - (v / max) * innerH;

    draw(pal.hairline); doc.setLineWidth(0.15);
    [0, 0.5, 1].forEach((f) => { const yy = y + padT + innerH * (1 - f); doc.line(x, yy, x + w, yy); });

    seriesA.forEach((a, i) => {
      const b = seriesB[i];
      const xx = x + step * i + (step - bw) / 2;
      const yA = Y(a), hA = (y + padT + innerH) - yA;
      const yB = Y(a + b), hB = yA - yB;
      fill(colorA); doc.rect(xx, yA, bw, Math.max(hA, 0), 'F');
      fill(colorB); doc.rect(xx, yB, bw, Math.max(hB, 0), 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); text(pal.ink);
      doc.text(String(a + b), xx + bw / 2, yB - 1, { align: 'center' });
    });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); text(pal.inkFaint);
    labels.forEach((d, i) => doc.text(shortDate(d), x + step * i + step / 2, y + h - legendH - 1, { align: 'center' }));

    const legendY = y + h - 1;
    let lx = x + w / 2 - 30;
    lx = legendChip(lx, legendY, colorA, labelA);
    legendChip(lx, legendY, colorB, labelB);
  }

  /** A hand-rolled data table — no autoTable plugin is vendored, and this project's
   *  tables are simple enough (flex/fixed columns, optional zebra rows) not to need one. */
  function table(x, y, w, { columns, rows, rowH = 5.4, headerH = 5.8, maxRows }) {
    const totalFlex = columns.reduce((s, c) => s + (c.flex || 0), 0) || 1;
    const fixedW = columns.reduce((s, c) => s + (c.width || 0), 0);
    const flexW = Math.max(w - fixedW, 0);
    let cx = x;
    const colBox = columns.map((c) => {
      const cw = c.width != null ? c.width : flexW * (c.flex || 0) / totalFlex;
      const box = { x: cx, w: cw };
      cx += cw;
      return box;
    });

    fill(pal.surfaceSunk); doc.rect(x, y, w, headerH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); text(pal.inkMuted);
    columns.forEach((c, i) => {
      const { x: cx0, w: cw } = colBox[i];
      doc.text(c.label.toUpperCase(), c.align === 'right' ? cx0 + cw - 2 : cx0 + 2, y + headerH - 1.8, { align: c.align === 'right' ? 'right' : 'left' });
    });
    let yy = y + headerH;

    if (rows.length === 0) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7); text(pal.inkFaint);
      doc.text('No data published for this date.', x + w / 2, yy + 5, { align: 'center' });
      return yy + 9;
    }

    const shown = maxRows ? rows.slice(0, Math.max(maxRows, 0)) : rows;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
    shown.forEach((r, ri) => {
      if (ri % 2 === 1) { fill(pal.surfaceSunk); doc.rect(x, yy, w, rowH, 'F'); }
      text(pal.ink);
      columns.forEach((c, i) => {
        const { x: cx0, w: cw } = colBox[i];
        const val = c.format ? c.format(r) : r[c.key];
        doc.text(String(val), c.align === 'right' ? cx0 + cw - 2 : cx0 + 2, yy + rowH - 1.5, { align: c.align === 'right' ? 'right' : 'left' });
      });
      yy += rowH;
    });
    draw(pal.hairline); doc.setLineWidth(0.15);
    doc.line(x, y + headerH, x + w, y + headerH);

    if (maxRows != null && rows.length > maxRows) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(6.6); text(pal.inkFaint);
      doc.text(`+ ${rows.length - maxRows} more — see the live dashboard for the full list`, x + 2, yy + 3);
      yy += 4.6;
    }
    return yy;
  }
  /** Estimated total height of a table() call before drawing it, so callers can
   *  ensure() the right amount of room (and know how many rows will actually fit). */
  function tableRowsFor(available, headerH, rowH, hasMoreNote) {
    const usable = available - headerH - (hasMoreNote ? 4.6 : 0);
    return Math.max(0, Math.floor(usable / rowH));
  }

  /** The week-at-a-glance leave grid: a name column plus one status chip per day,
   *  grouped by role, matching the colours the live leave.js page uses (vermillion =
   *  on leave, blue = available, amber = public holiday — see STATUS in leave.js). */
  function leaveGrid(x, y, w, { days, todayIndex, groups }) {
    const nameW = 58, rowH = 6.6, groupH = 5.2;
    const dayW = (w - nameW) / days.length;
    let yy = y;

    fill(pal.surfaceSunk); doc.rect(x, yy, w, rowH * 0.72, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); text(pal.inkMuted);
    doc.text('NAME', x + 2, yy + rowH * 0.5);
    days.forEach((d, i) => {
      const dx = x + nameW + i * dayW;
      if (i === todayIndex) { fill(pal.accentWeak); doc.rect(dx, yy, dayW, rowH * 0.72, 'F'); }
      text(i === todayIndex ? pal.accentStrong : pal.inkMuted);
      doc.text(d.slice(0, 3).toUpperCase(), dx + dayW / 2, yy + rowH * 0.5, { align: 'center' });
    });
    yy += rowH * 0.72;

    groups.forEach((g) => {
      fill(pal.ink); doc.rect(x, yy, w, groupH, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(255, 255, 255);
      doc.text(g.group.toUpperCase(), x + 2, yy + groupH - 1.7);
      yy += groupH;
      g.people.forEach((p, pi) => {
        if (pi % 2 === 1) { fill(pal.surfaceSunk); doc.rect(x, yy, w, rowH, 'F'); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); text(pal.ink);
        doc.text(p.name, x + 2, yy + rowH - 2, { maxWidth: nameW - 4 });
        p.status.forEach((s, i) => {
          const dx = x + nameW + i * dayW;
          const chipColor = s === 'leave' ? pal.danger : s === 'public_holiday' ? pal.infer : pal.live;
          const chipW = dayW - 2.4, chipH = 4;
          fill(chipColor);
          doc.roundedRect(dx + 1.2, yy + (rowH - chipH) / 2, chipW, chipH, 1, 1, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(255, 255, 255);
          const label = s === 'leave' ? 'Leave' : s === 'public_holiday' ? 'P.Hol' : 'Avail';
          doc.text(label, dx + 1.2 + chipW / 2, yy + (rowH - chipH) / 2 + chipH - 1.1, { align: 'center' });
        });
        yy += rowH;
      });
    });
    return yy;
  }
  function leaveGridH(groups, days) {
    return 5.2 + groups.reduce((s, g) => s + 5.2 + g.people.length * 6.6, 0) - 5.2; // header row + one 5.2 group band per group + 6.6 per person
  }

  /** The dashboard's ".take" callout — a tinted, left-railed box of one or two lines
   *  of plain-English interpretation under a chart or table. */
  function takeaway(x, y, w, label) {
    const pad = 2.6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    const lines = doc.splitTextToSize(label, w - pad * 2 - 2);
    const h = lines.length * 3.3 + pad * 1.8;
    fill(pal.surfaceSunk); doc.roundedRect(x, y, w, h, 1.2, 1.2, 'F');
    fill(pal.accent); doc.roundedRect(x, y, 1.2, h, 0.6, 0.6, 'F');
    text(pal.inkMuted);
    lines.forEach((l, i) => doc.text(l, x + pad + 1.4, y + pad + 1.4 + i * 3.3));
    return y + h;
  }
  function takeawayH(label, w) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    return doc.splitTextToSize(label, w - 2.6 * 2 - 2).length * 3.3 + 2.6 * 1.8;
  }

  function placeholder(x, y, w, h, msg) {
    draw(pal.hairline); doc.setLineWidth(0.2);
    doc.roundedRect(x, y, w, h, 2, 2, 'S');
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.6); text(pal.inkFaint);
    doc.text(msg, x + w / 2, y + h / 2, { align: 'center', maxWidth: w - 10 });
    return y + h;
  }

  return {
    kpiTile, kpiRow, panelFrame, panelHeaderH, hBarRows, hBarGroupDual, legendChip,
    lineChart, stackedBarChart, table, tableRowsFor, leaveGrid, leaveGridH, takeaway, takeawayH, placeholder,
    fill, draw, text,
  };
}

// ---------------------------------------------------------------------------
// Data fetching — every field a section builder reads is named in that builder,
// so a JSON schema change surfaces as a clear diff right where it's used.
// ---------------------------------------------------------------------------
async function loadReportData(date) {
  const get = (name) => fetchJSON(`assets/data/reports/${date}/${name}.json`).catch(() => null);
  const [overview, tasks, callLogs, cloop, leave] = await Promise.all([
    get('overview'), get('tasks'), get('call-logs'), get('cloop'), get('leave'),
  ]);
  return { overview, tasks, callLogs, cloop, leave };
}

function sinceLabel(streak, reportDate, longestStreak) {
  if (streak.longest) return `since ${formatDate(longestStreak.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (streak.onHalt) return null;
  const startDate = startOfWorkingStreak(reportDate, streak.days);
  return startDate ? `est. since ${formatDate(startDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : null;
}

function buildStaffActivity(callLogs) {
  const byName = new Map();
  const ensure = (name) => {
    if (!byName.has(name)) byName.set(name, { name, inboundCalls: 0, inboundMins: 0, outboundCalls: 0, outboundMins: 0 });
    return byName.get(name);
  };
  (callLogs.inboundByStaff || []).forEach((p) => { const r = ensure(p.name); r.inboundCalls = p.calls; r.inboundMins = p.durationMins; });
  (callLogs.outboundByStaff || []).forEach((p) => { const r = ensure(p.name); r.outboundCalls = p.calls; r.outboundMins = p.durationMins; });
  return Array.from(byName.values())
    .map((r) => ({ ...r, totalCalls: r.inboundCalls + r.outboundCalls, totalMins: r.inboundMins + r.outboundMins }))
    .sort((a, b) => b.totalCalls - a.totalCalls);
}

function weekOverWeek(totals) {
  const latest = totals[totals.length - 1];
  const prior = totals[totals.length - 6]; // 5 business days earlier = same weekday, 1 week prior
  const delta = latest - prior;
  const pct = prior !== 0 ? Math.round((delta / prior) * 1000) / 10 : null;
  return { delta, pct };
}
function deltaLabel(wow) {
  if (!wow) return null;
  if (wow.delta === 0) return 'flat vs 1 week ago';
  const sign = wow.delta > 0 ? '+' : '-';
  return `${sign}${Math.abs(wow.delta)}${wow.pct != null ? ` (${sign}${Math.abs(wow.pct)}%)` : ''} vs 1 week ago`;
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------
function buildCoverPage(doc, kit, pal, { date, overview, sectionsMeta }) {
  const centerX = PAGE_W / 2;
  const weekday = formatDate(date, { weekday: 'long' });

  kit.fill(pal.accentStrong);
  doc.roundedRect(centerX - 8, 22, 16, 16, 4, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
  doc.text('Y', centerX, 32.3, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(21); kit.text(pal.ink);
  doc.text('Dashy Daily', centerX, 50, { align: 'center' });
  doc.setFontSize(11.5); kit.text(pal.inkMuted);
  doc.text(`${weekday}, ${formatDate(date)}`, centerX, 58, { align: 'center' });
  if (overview?.report?.number) {
    doc.setFontSize(8.5); kit.text(pal.inkFaint);
    doc.text(`Report #${overview.report.number}`, centerX, 63.4, { align: 'center' });
  }

  // KPI highlight strip — the day's headline numbers, pulled straight from
  // overview.json, so the cover page is a summary in its own right rather than
  // just a title screen someone has to flip past.
  const stripY = 75;
  const t = overview?.criticalTasks, c = overview?.callLogs, cl = overview?.cloop, lv = overview?.leave;
  const tiles = [];
  if (c) tiles.push({ label: 'Calls accepted', value: `${c.acceptedPct}%`, sub: `${c.accepted} of ${c.totalInbound}`, tone: c.acceptedPct >= 85 ? 'good' : 'crit' });
  if (c) tiles.push({ label: 'Calls missed', value: `${c.missedPct}%`, sub: `${c.missed} of ${c.totalInbound}`, tone: c.missedPct > 15 ? 'crit' : 'neutral' });
  if (cl) tiles.push({ label: 'Cloop in queue', value: cl.inQueue, sub: `oldest ${cl.oldestDays} days` });
  if (t) {
    const longest = t.streaks.find((s) => s.longest);
    if (longest) tiles.push({ label: 'Longest streak', value: `${longest.days}d`, sub: longest.name });
  }
  if (t) tiles.push({ label: 'Sites on halt', value: t.streaks.filter((s) => s.onHalt).length, sub: `of ${t.streaks.length} tracked`, tone: 'crit' });
  if (lv) tiles.push({ label: 'On leave, doctors', value: lv.doctorLinesOnLeave, sub: lv.weekLabel });
  if (tiles.length) kit.kpiRow(MARGIN + 8, stripY, CONTENT_W - 16, 24, tiles.slice(0, 6));
  else kit.placeholder(MARGIN + 8, stripY, CONTENT_W - 16, 24, 'No overview data published for this date.');

  // Table of contents — real starting page numbers, computed after every section
  // was actually built, so a section that overflowed to a continuation page
  // doesn't throw off the numbering of everything after it.
  let y = stripY + 34;
  kit.draw(pal.hairline); doc.setLineWidth(0.2);
  doc.line(MARGIN + 60, y, PAGE_W - MARGIN - 60, y);
  y += 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); kit.text(pal.inkFaint);
  doc.text('CONTENTS', centerX, y, { align: 'center' });
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  sectionsMeta.forEach((s) => {
    const rowX = centerX - 55;
    kit.fill(s.color); doc.circle(rowX, y - 1.4, 1.2, 'F');
    kit.text(pal.ink);
    doc.text(s.title, rowX + 5, y);
    kit.text(pal.inkFaint);
    doc.text(`page ${s.startPage}`, centerX + 55, y, { align: 'right' });
    y += 7;
  });
}

// ---------------------------------------------------------------------------
// Section pages — each takes (doc, kit, pal, flow, data) and draws top to
// bottom via flow.ensure(neededHeight), which starts a continuation page for
// this same section automatically if a block wouldn't fit.
// ---------------------------------------------------------------------------
function buildOverviewPage(doc, kit, pal, flow, { overview }) {
  if (!overview) { kit.placeholder(MARGIN, flow.ensure(30), CONTENT_W, 30, 'No overview report was published for this date.'); return; }
  const c = overview.callLogs, cl = overview.cloop, lv = overview.leave;
  const w = CONTENT_W, colW = (w - 6) / 2;

  // The checklist/streak KPIs and the "Critical daily tasks — streak" + "Call
  // queue snapshot" panels that used to open this page are left out of the PDF
  // on purpose — they're already front and centre on the live dashboard's own
  // Overview tab, and in the full report the very next page (Critical daily
  // tasks) covers the same streaks in more detail anyway.
  let y = flow.ensure(20);
  y = kit.kpiRow(MARGIN, y, w, 20, [
    { label: 'Total inbound calls', value: c.totalInbound, sub: `${c.totalOutbound} outbound made` },
    { label: 'Calls accepted', value: `${c.acceptedPct}%`, sub: `${c.accepted} of ${c.totalInbound}`, tone: 'good' },
    { label: 'Calls missed', value: `${c.missedPct}%`, sub: `${c.missed} of ${c.totalInbound}`, tone: 'crit' },
    { label: 'Cloop cases in queue', value: cl ? cl.inQueue : '—', sub: cl ? `oldest ${cl.oldestDays} days` : 'No Cloop report this date' },
  ]);
  flow.y = y + 5;

  const panel2H = Math.max(46, Math.min(60, flow.remaining));
  const rowTop2 = flow.ensure(panel2H);
  let cloopY = kit.panelFrame(MARGIN, rowTop2, colW, panel2H, 'Cloop, at a glance', '');
  if (cl) {
    kit.fill(pal.accent); doc.roundedRect(MARGIN + 4, cloopY, colW - 8, 6, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
    doc.text(`${cl.contactsQueuedYesterday ?? '—'} emails queued yesterday`, MARGIN + 7, cloopY + 4);
    kit.takeaway(MARGIN + 4, cloopY + 9, colW - 8, `${cl.emailsHandledYesterday} emails handled yesterday, out of ${cl.totalOverallCases.toLocaleString()} total cases logged (${cl.totalInProgress} in progress, ${cl.totalOpenCases} open).`);
  } else {
    kit.placeholder(MARGIN + 4, cloopY, colW - 8, 20, 'No Cloop report was published for this date.');
  }

  let leaveY = kit.panelFrame(MARGIN + colW + 6, rowTop2, colW, panel2H, "Staff & doctors' leave — this week", lv.weekLabel);
  leaveY = kit.hBarRows(MARGIN + colW + 10, leaveY, colW - 8, 6, [
    { label: 'Doctor lines on leave', frac: lv.doctorLinesOnLeave / 4, valueLabel: String(lv.doctorLinesOnLeave), color: pal.dangerInk },
    { label: 'Staff fully on leave', frac: lv.staffFullyOnLeave / 5, valueLabel: String(lv.staffFullyOnLeave), color: pal.dangerInk },
    { label: 'Staff partially on leave', frac: lv.staffPartialLeave / 5, valueLabel: String(lv.staffPartialLeave), color: pal.infer },
  ]);
  if (lv.longTerm?.[0]) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.8); kit.text(pal.inkFaint);
    doc.text(`${lv.longTerm[0].name} remains on ${lv.longTerm[0].note.toLowerCase()}.`, MARGIN + colW + 10, leaveY + 3.5, { maxWidth: colW - 16 });
  }
  flow.y = rowTop2 + panel2H;
}

function buildTasksPage(doc, kit, pal, flow, { tasks }) {
  if (!tasks) { kit.placeholder(MARGIN, flow.ensure(30), CONTENT_W, 30, 'No critical-tasks report was published for this date.'); return; }
  const w = CONTENT_W;
  const maxStreak = Math.max(...tasks.streaks.map((s) => s.days), 1);

  let y = flow.ensure(20);
  y = kit.kpiRow(MARGIN, y, w, 20, tasks.streaks.map((s) => ({
    label: s.name, value: s.days, sub: `day${s.days === 1 ? '' : 's'} streak${s.onHalt ? ' · on halt' : ''}${s.longest ? ' · longest' : ''}`, tone: s.onHalt ? 'crit' : 'good',
  })));
  flow.y = y + 5;

  const streakRowH = 5.6;
  const streakH = kit.panelHeaderH('') + tasks.streaks.length * streakRowH + 2;
  const sy0 = flow.ensure(streakH);
  const streakTop = kit.panelFrame(MARGIN, sy0, w, streakH, 'Streak history', '');
  kit.hBarRows(MARGIN + 4, streakTop, w - 8, streakRowH, tasks.streaks.map((s) => {
    const label = sinceLabel(s, tasks.reportDate, tasks.longestStreak);
    return { label: s.name, frac: s.days / maxStreak, valueLabel: `${s.days}d`, subLabel: label, color: s.longest ? pal.live : s.onHalt ? pal.danger : pal.accent };
  }), { labelW: 30, valueW: 22 });
  flow.y = sy0 + streakH + 4;

  const colW = (w - 6) / 2;
  const panelH = Math.max(70, Math.min(100, flow.remaining));
  const py0 = flow.ensure(panelH);
  tasks.checklists.forEach((cl, i) => {
    const px = MARGIN + i * (colW + 6);
    let cy = py0 + 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); kit.text(pal.ink);
    doc.text(cl.name, px + 4, cy);
    doc.setFontSize(15);
    kit.text(cl.completionPct === 100 ? pal.liveInk : cl.completionPct < 50 ? pal.dangerInk : pal.ink);
    doc.text(`${cl.completionPct}%`, px + colW - 4, cy, { align: 'right' });
    kit.draw(pal.hairline); doc.setLineWidth(0.2); doc.roundedRect(px, py0, colW, panelH, 2, 2, 'S');
    cy += 4;
    const chartH = Math.min(30, panelH * 0.4);
    if (cl.trend) {
      kit.lineChart(px + 4, cy, colW - 8, chartH, { labels: tasks.trendDates, data: cl.trend, color: cl.completionPct === 100 ? pal.live : pal.accent, unit: '%' });
      cy += chartH + 1;
    } else {
      cy = kit.placeholder(px + 4, cy, colW - 8, 16, 'No 10-day trend published.') + 2;
    }
    const availableH = py0 + panelH - cy - 3;
    const maxCount = Math.max(cl.complete.length, cl.incomplete.length, 1);
    const rowH = Math.max(3, Math.min(4.4, (availableH - 5) / maxCount));
    const visible = Math.max(1, Math.floor((availableH - 5) / rowH));
    const listColW = (colW - 12) / 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); kit.text(pal.inkFaint);
    doc.text('COMPLETE', px + 4, cy);
    doc.text('INCOMPLETE', px + 8 + listColW, cy);
    let ly1 = cy + 3.6, ly2 = cy + 3.6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
    kit.text(pal.liveInk);
    cl.complete.slice(0, visible).forEach((task) => { doc.text(task.replace(/\s*\([^)]*\)\s*$/, ''), px + 4, ly1, { maxWidth: listColW - 2 }); ly1 += rowH; });
    if (cl.complete.length > visible) { kit.text(pal.inkFaint); doc.setFont('helvetica', 'italic'); doc.text(`+ ${cl.complete.length - visible} more`, px + 4, ly1); }
    kit.text(pal.dangerInk); doc.setFont('helvetica', 'normal');
    (cl.incomplete.length ? cl.incomplete : ['None — fully complete.']).slice(0, visible).forEach((task) => { doc.text(task, px + 8 + listColW, ly2, { maxWidth: listColW - 2 }); ly2 += rowH; });
  });
  flow.y = py0 + panelH;
}

/** The three patient-facing call KPIs (longest call, longest wait, avg handling) —
 *  shared between the full report's Call logs page and the short report's
 *  at-a-glance page, which surfaces them a page earlier since the short report
 *  has no separate Call logs page of its own. */
function addPatientServiceKpiRow(doc, kit, pal, flow, patientServiceKpi, w) {
  if (!patientServiceKpi) return;
  const k = patientServiceKpi;
  let y = flow.ensure(18);
  y = kit.kpiRow(MARGIN, y, w, 18, [
    { label: 'Longest call duration', value: fmtSec(k.longestCallDurationSec), sub: `${k.longestCallAt} · ${k.longestCallAgent}` },
    { label: 'Longest waiting time', value: fmtSec(k.longestWaitingTimeSec), sub: k.longestWaitingAt, tone: 'crit' },
    { label: 'Avg call handling', value: fmtSec(k.avgCallHandlingSec), sub: 'per accepted call, today' },
  ]);
  flow.y = y + 4;
}

function buildCallLogsPage(doc, kit, pal, flow, { callLogs }) {
  if (!callLogs) { kit.placeholder(MARGIN, flow.ensure(30), CONTENT_W, 30, 'No call-logs report was published for this date.'); return; }
  const d = callLogs, t = d.tenDayTrend || {};
  const w = CONTENT_W, colW = (w - 6) / 2;

  let y = flow.ensure(20);
  y = kit.kpiRow(MARGIN, y, w, 20, [
    { label: 'Total inbound calls', value: d.summary.totalInbound, sub: 'across all queues today' },
    { label: 'Calls accepted', value: `${d.summary.acceptedPct}%`, sub: `${d.summary.accepted} of ${d.summary.totalInbound}`, tone: 'good' },
    { label: 'Calls missed', value: `${d.summary.missedPct}%`, sub: `${d.summary.missed} of ${d.summary.totalInbound}`, tone: 'crit' },
    { label: 'Total outbound calls', value: d.summary.totalOutbound, sub: 'made by staff today' },
  ]);
  flow.y = y + 5;

  const qRowH = 9;
  const qH = kit.panelHeaderH('') + d.queueReport.length * qRowH;
  const qy0 = flow.ensure(qH);
  const queueTop = kit.panelFrame(MARGIN, qy0, w, qH, 'Queue report', '');
  kit.hBarGroupDual(MARGIN + 4, queueTop, w - 8, qRowH, d.queueReport.map((q) => ({ label: q.queue, values: [{ value: q.accepted, color: pal.live }, { value: q.missed, color: pal.danger }] })));
  let lx = MARGIN + w - 70;
  lx = kit.legendChip(lx, qy0 + 6, pal.live, 'Accepted');
  kit.legendChip(lx, qy0 + 6, pal.danger, 'Missed');
  flow.y = qy0 + qH + 4;

  const chartH = 38;
  const cy0 = flow.ensure(chartH);
  if (t.answerRatePct) kit.lineChart(MARGIN + 4, kit.panelFrame(MARGIN, cy0, colW, chartH, 'Call answer rate — 10-day trend', `Target: ${t.answerRateTargetPct}%`), colW - 8, chartH - kit.panelHeaderH('x') - 2, { labels: t.labels, data: t.answerRatePct, color: pal.accent, unit: '%', target: t.answerRateTargetPct, targetLabel: `${t.answerRateTargetPct}% target` });
  else kit.placeholder(MARGIN, cy0, colW, chartH, 'Not published this date.');
  if (t.accepted) kit.stackedBarChart(MARGIN + colW + 10, kit.panelFrame(MARGIN + colW + 6, cy0, colW, chartH, 'Call volume — 10-day trend', ''), colW - 8, chartH - kit.panelHeaderH('') - 2, { labels: t.labels, seriesA: t.accepted, seriesB: t.missed, colorA: pal.live, colorB: pal.danger, labelA: 'Accepted', labelB: 'Missed' });
  else kit.placeholder(MARGIN + colW + 6, cy0, colW, chartH, 'Not published this date.');
  flow.y = cy0 + chartH + 4;

  addPatientServiceKpiRow(doc, kit, pal, flow, d.patientServiceKpi, w);

  const staff = buildStaffActivity(d);
  const staffPanelH = Math.max(40, Math.min(70, flow.remaining));
  const sy0 = flow.ensure(staffPanelH);
  const tableTop = kit.panelFrame(MARGIN, sy0, w, staffPanelH, 'Staff activity', 'Inbound + outbound calls today, busiest first.');
  const rowH = 5.2, headerH = 5.8;
  const maxRows = kit.tableRowsFor(sy0 + staffPanelH - tableTop - 2, headerH, rowH, staff.length > 0);
  kit.table(MARGIN + 4, tableTop, w - 8, {
    columns: [
      { label: 'Name', key: 'name', flex: 2 },
      { label: 'Inbound', key: 'inboundCalls', flex: 1, align: 'right' },
      { label: 'Outbound', key: 'outboundCalls', flex: 1, align: 'right' },
      { label: 'Total calls', key: 'totalCalls', flex: 1, align: 'right' },
      { label: 'Duration', flex: 1, align: 'right', format: (r) => `${r.totalMins}m` },
    ],
    rows: staff, rowH, headerH, maxRows,
  });
  flow.y = sy0 + staffPanelH;
}

function buildCloopPage(doc, kit, pal, flow, { cloop, callLogs }) {
  if (!cloop) { kit.placeholder(MARGIN, flow.ensure(30), CONTENT_W, 30, 'No Cloop report was published for this date.'); return; }
  const d = cloop;
  const w = CONTENT_W, colW = (w - 6) / 2;
  const yesterdayTotal = d.contactsQueuedYesterday ? d.contactsQueuedYesterday.reduce((s, q) => s + q.count, 0) : null;
  const wowQueued = d.contactsQueuedTenDayTrend ? deltaLabel(weekOverWeek(d.contactsQueuedTenDayTrend.totals)) : null;
  const wowProgress = d.inProgressTenDayTrend ? deltaLabel(weekOverWeek(d.inProgressTenDayTrend.totals)) : null;
  const wowOpen = d.openCasesTenDayTrend ? deltaLabel(weekOverWeek(d.openCasesTenDayTrend.totals)) : null;

  let y = flow.ensure(20);
  y = kit.kpiRow(MARGIN, y, w, 20, [
    { label: 'In queue right now', value: d.realTimeSummary.inQueue, sub: `across ${d.realTimeQueues.length} queues` },
    { label: 'Oldest case in queue', value: `${d.realTimeSummary.oldestDays}d`, sub: `extracted ${d.extractedAtLabel}`, tone: 'crit' },
    { label: 'Emails queued, yesterday', value: yesterdayTotal ?? '—', sub: wowQueued || 'Not published this date' },
    { label: 'Total overall cases', value: d.totalCasesToDate.totalOverallCases.toLocaleString(), sub: `to date, as of ${d.totalCasesToDate.date}` },
  ]);
  flow.y = y + 5;

  const rtRowH = 4.6, rtHeaderH = 5.4, rtMaxRows = 5;
  const rtShown = Math.min(d.realTimeQueues.length, rtMaxRows);
  const rtHasMore = d.realTimeQueues.length > rtMaxRows;
  const rtH = kit.panelHeaderH('') + rtHeaderH + rtShown * rtRowH + (rtHasMore ? 4.6 : 0) + 2;
  const cqRows = Math.min(d.contactsQueuedYesterday?.length || 0, 5);
  const cqH = kit.panelHeaderH(d.contactsQueuedYesterday ? 'x' : '') + cqRows * 4.4 + 2;
  const row1H = Math.max(rtH, cqH, 30);
  const row1y = flow.ensure(row1H);
  let rty = kit.panelFrame(MARGIN, row1y, colW, row1H, 'Real-time metrics, by queue', '');
  kit.table(MARGIN + 4, rty, colW - 8, {
    columns: [{ label: 'Queue', key: 'queue', flex: 2 }, { label: 'In queue', key: 'inQueue', flex: 1, align: 'right' }, { label: 'Oldest (d)', key: 'oldestDays', flex: 1, align: 'right' }],
    rows: d.realTimeQueues, rowH: rtRowH, headerH: rtHeaderH, maxRows: rtMaxRows,
  });

  let cqy = kit.panelFrame(MARGIN + colW + 6, row1y, colW, row1H, 'Emails queued yesterday, by queue', d.contactsQueuedYesterday ? `${yesterdayTotal} emails queued in total.` : '');
  if (d.contactsQueuedYesterday) {
    const maxQ = Math.max(...d.contactsQueuedYesterday.map((q) => q.count), 1);
    kit.hBarRows(MARGIN + colW + 10, cqy, colW - 8, 4.4, d.contactsQueuedYesterday.slice(0, cqRows).map((q) => ({ label: q.queue, frac: q.count / maxQ, valueLabel: String(q.count), color: pal.accent })), { labelW: 32, valueW: 16 });
  } else kit.placeholder(MARGIN + colW + 6, row1y + 9, colW, 20, 'Not published this date.');
  flow.y = row1y + row1H + 4;

  if (d.contactsQueuedTenDayTrend) {
    const trendH = 32;
    const ty0 = flow.ensure(trendH);
    const ty = kit.panelFrame(MARGIN, ty0, w, trendH, 'Total emails queued — 10-day trend', '');
    kit.lineChart(MARGIN + 4, ty, w - 8, trendH - kit.panelHeaderH('') - 2, { labels: d.contactsQueuedTenDayTrend.labels, data: d.contactsQueuedTenDayTrend.totals, color: pal.accent });
    flow.y = ty0 + trendH + 4;
  }

  const emailRows = d.emailsHandledYesterday.slice().sort((a, b) => b.total - a.total);
  const emRowH = 4.4, emHeaderH = 5.4, emMaxRows = Math.min(emailRows.length, 6);
  const emH = kit.panelHeaderH('') + emHeaderH + emMaxRows * emRowH + (emailRows.length > emMaxRows ? 4.6 : 0) + 2;
  const ey0 = flow.ensure(emH);
  const ety = kit.panelFrame(MARGIN, ey0, w, emH, 'Emails handled yesterday, by agent', '');
  kit.table(MARGIN + 4, ety, w - 8, {
    columns: [{ label: 'Agent', key: 'agent', flex: 2 }, { label: 'Incoming', key: 'incoming', flex: 1, align: 'right' }, { label: 'Outbound', key: 'outbound', flex: 1, align: 'right' }, { label: 'Total handled', key: 'total', flex: 1, align: 'right' }],
    rows: emailRows, rowH: emRowH, headerH: emHeaderH, maxRows: emMaxRows,
  });
  const activeNames = new Set([...(callLogs?.inboundByStaff || []), ...(callLogs?.outboundByStaff || [])].map((p) => p.name));
  const alsoOnPhones = callLogs ? emailRows.map((a) => a.agent).filter((name) => activeNames.has(name)) : [];
  flow.y = ey0 + emH + (alsoOnPhones.length ? 5 : 4);
  if (alsoOnPhones.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.4); kit.text(pal.inkFaint);
    doc.text(`${alsoOnPhones.slice(0, 4).join(', ')}${alsoOnPhones.length > 4 ? ', …' : ''} also took phone calls today.`, MARGIN + 4, ey0 + emH - 0.6, { maxWidth: w - 8 });
  }

  y = flow.ensure(16);
  y = kit.kpiRow(MARGIN, y, w, 16, [
    { label: 'Total in progress', value: d.totalCasesToDate.totalInProgress, sub: wowProgress || 'Not published this date' },
    { label: 'Total open cases', value: d.totalCasesToDate.totalOpenCases, sub: wowOpen || 'Not published this date' },
  ]);
  flow.y = y + 4;

  if (d.inProgressTenDayTrend || d.openCasesTenDayTrend) {
    const row2H = Math.max(34, Math.min(50, flow.remaining));
    const row2y = flow.ensure(row2H);
    if (d.inProgressTenDayTrend) {
      const py = kit.panelFrame(MARGIN, row2y, colW, row2H, 'Total in progress — 10-day trend', '');
      kit.lineChart(MARGIN + 4, py, colW - 8, row2H - kit.panelHeaderH('') - 2, { labels: d.inProgressTenDayTrend.labels, data: d.inProgressTenDayTrend.totals, color: pal.infer });
    }
    if (d.openCasesTenDayTrend) {
      const py = kit.panelFrame(MARGIN + colW + 6, row2y, colW, row2H, 'Total open cases — 10-day trend', '');
      kit.lineChart(MARGIN + colW + 10, py, colW - 8, row2H - kit.panelHeaderH('') - 2, { labels: d.openCasesTenDayTrend.labels, data: d.openCasesTenDayTrend.totals, color: pal.accent2 });
    }
    flow.y = row2y + row2H;
  }
}

function buildLeavePage(doc, kit, pal, flow, { leave }) {
  if (!leave) { kit.placeholder(MARGIN, flow.ensure(30), CONTENT_W, 30, 'No leave report was published for this date.'); return; }
  const d = leave;
  const w = CONTENT_W;
  const todayISO = todayISOInCanberra();
  const start = new Date(`${d.weekStart}T00:00:00Z`);
  const diff = Math.round((new Date(`${todayISO}T00:00:00Z`) - start) / 86400000);
  const todayIndex = diff >= 0 && diff <= 4 ? diff : -1;

  // A person's whole status array can be missing rather than guessed at (e.g. a
  // brand-new week with no prior report to carry a day-by-day grid forward from)
  // — see this date's own leave.json note. Treated as its own bucket below
  // rather than crashing .every()/.filter() against a null.
  const hasStatus = (p) => Array.isArray(p.status);
  const fullWeek = (p) => hasStatus(p) && p.status.every((s) => s === 'leave');
  const noneWeek = (p) => hasStatus(p) && p.status.every((s) => s === 'available');
  const leaveDayCount = (p) => hasStatus(p) ? p.status.filter((s) => s === 'leave').length : 0;
  const allPeople = d.groups.flatMap((g) => g.people);
  const confirmedPeople = allPeople.filter(hasStatus);
  const unconfirmedCount = allPeople.length - confirmedPeople.length;
  const fullyOnLeave = confirmedPeople.filter(fullWeek).length;
  const partialLeave = confirmedPeople.filter((p) => !fullWeek(p) && !noneWeek(p)).length;
  const outToday = todayIndex >= 0 ? confirmedPeople.filter((p) => p.status[todayIndex] === 'leave').length : null;

  let y = flow.ensure(5);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); kit.text(pal.inkFaint);
  doc.text(`Week of ${formatDate(d.weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(d.weekEnd, { day: 'numeric', month: 'long', year: 'numeric' })}`, MARGIN, y + 3);
  flow.y = y + 6;

  y = flow.ensure(18);
  y = kit.kpiRow(MARGIN, y, w, 18, [
    { label: 'Out, all week', value: fullyOnLeave, sub: `of ${allPeople.length} on this roster`, tone: 'crit' },
    { label: 'Partial leave this week', value: partialLeave, sub: 'see grid below' },
    outToday != null && { label: `Out today (${d.days[todayIndex]})`, value: outToday, sub: `of ${allPeople.length} on this roster`, tone: outToday > 0 ? 'crit' : 'good' },
    { label: 'Long-term leave', value: d.longTerm.length, sub: d.longTerm.map((p) => p.name).join(', ') },
  ].filter(Boolean));
  flow.y = y + 5;

  // Condensed for print: everyone with at least one leave day, fully-out first —
  // people fully available all week are summarised in one footnote line instead
  // of taking up a row each (the live dashboard's own table shows everyone).
  // People with no status array at all (unconfirmed) are kept out of that
  // "fully available" footnote entirely — that would misreport unknown as
  // available — and counted in their own note instead.
  const condensedGroups = d.groups.map((g) => {
    const withLeave = g.people.filter((p) => hasStatus(p) && leaveDayCount(p) > 0).sort((a, b) => leaveDayCount(b) - leaveDayCount(a));
    const unconfirmed = g.people.filter((p) => !hasStatus(p)).length;
    return { group: g.group, people: withLeave, hiddenCount: g.people.length - withLeave.length - unconfirmed, unconfirmedCount: unconfirmed };
  }).filter((g) => g.people.length || g.hiddenCount || g.unconfirmedCount);
  const gridGroups = condensedGroups.map((g) => ({ group: g.group, people: g.people }));
  const gridInnerH = kit.leaveGridH(gridGroups, d.days);
  const gridPanelH = kit.panelHeaderH('x') + gridInnerH + 5;

  const gy0 = flow.ensure(Math.min(gridPanelH, BODY_H));
  const gridTop = kit.panelFrame(MARGIN, gy0, w, gridPanelH, 'Week at a glance', 'People with at least one day of leave this week; fully-out first.');
  const afterGrid = kit.leaveGrid(MARGIN + 4, gridTop, w - 8, { days: d.days, todayIndex, groups: gridGroups });
  const hiddenNote = condensedGroups.filter((g) => g.hiddenCount > 0).map((g) => `${g.hiddenCount} ${g.group.toLowerCase()}${g.hiddenCount === 1 ? '' : 's'}`).join(', ');
  let noteY = afterGrid;
  if (hiddenNote) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.6); kit.text(pal.inkFaint);
    doc.text(`+ ${hiddenNote} fully available all week (not shown).`, MARGIN + 4, noteY + 3.5);
    noteY += 3.5;
  }
  if (unconfirmedCount > 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.6); kit.text(pal.inkFaint);
    doc.text(`${unconfirmedCount} ${unconfirmedCount === 1 ? 'person' : 'people'} not shown — no day-by-day leave grid published for this week yet.`, MARGIN + 4, noteY + 3.5);
  }
  flow.y = gy0 + gridPanelH + 4;

  if (d.longTerm.length) {
    y = flow.ensure(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); kit.text(pal.ink);
    doc.text('Long-term leave: ', MARGIN, y + 3.5);
    doc.setFont('helvetica', 'normal'); kit.text(pal.inkMuted);
    const w0 = doc.getTextWidth('Long-term leave: ');
    doc.text(d.longTerm.map((p) => `${p.name} — ${p.note} (${formatDate(p.from, { day: 'numeric', month: 'short' })} – ${formatDate(p.to, { day: 'numeric', month: 'short', year: 'numeric' })})`).join('  ·  '), MARGIN + w0, y + 3.5, { maxWidth: w - w0 });
    flow.y = y + 6;
  }
}

// Trims leave-grid groups to fit a height budget, in the same units
// leaveGrid/leaveGridH use internally (5.2mm per group band, 6.6mm per person
// row) — needed where the grid shares a page with other content instead of
// getting its own, so it can't just overflow onto a continuation page.
function fitLeaveGroups(groups, availableH) {
  let used = 0, hiddenCount = 0;
  const kept = [];
  for (const g of groups) {
    if (!g.people.length) continue;
    const roomForBand = availableH - used - 5.2;
    const roomPeople = roomForBand < 6.6 ? 0 : Math.min(g.people.length, Math.floor(roomForBand / 6.6));
    if (roomPeople === 0) { hiddenCount += g.people.length; continue; }
    kept.push({ group: g.group, people: g.people.slice(0, roomPeople) });
    used += 5.2 + roomPeople * 6.6;
    hiddenCount += g.people.length - roomPeople;
  }
  return { groups: kept, hiddenCount };
}

// The short report's one detail page: the three things a same-day reader is most
// likely to need beyond the at-a-glance numbers on page 1, condensed to fit one
// page together — everything else (trend charts, staff tables, task checklists)
// stays in the full report and the live dashboard.
function buildShortDetailPage(doc, kit, pal, flow, { cloop, leave }) {
  const w = CONTENT_W;

  if (cloop) {
    const rowH = 4.8, headerH = 5.6, maxRows = Math.min(cloop.realTimeQueues.length, 10);
    const tableH = kit.panelHeaderH('') + headerH + maxRows * rowH + (cloop.realTimeQueues.length > maxRows ? 4.6 : 0) + 2;
    const ty0 = flow.ensure(tableH);
    const tableTop = kit.panelFrame(MARGIN, ty0, w, tableH, 'Cloop — real-time metrics, by queue', '');
    kit.table(MARGIN + 4, tableTop, w - 8, {
      columns: [{ label: 'Queue', key: 'queue', flex: 2 }, { label: 'In queue', key: 'inQueue', flex: 1, align: 'right' }, { label: 'Oldest (d)', key: 'oldestDays', flex: 1, align: 'right' }],
      rows: cloop.realTimeQueues, rowH, headerH, maxRows,
    });
    flow.y = ty0 + tableH + 5;
  } else {
    flow.y = kit.placeholder(MARGIN, flow.ensure(24), w, 24, 'No Cloop report was published for this date.') + 5;
  }

  if (leave) {
    // See buildLeavePage's own note: a person's whole status array can be
    // missing (unconfirmed) rather than guessed at — excluded from "fully
    // available" here too, not folded in as if they were.
    const condensedGroups = leave.groups.map((g) => {
      const withLeave = g.people.filter((p) => Array.isArray(p.status) && p.status.some((s) => s === 'leave')).sort((a, b) => b.status.filter((s) => s === 'leave').length - a.status.filter((s) => s === 'leave').length);
      const unconfirmed = g.people.filter((p) => !Array.isArray(p.status)).length;
      return { group: g.group, people: withLeave, hiddenCount: g.people.length - withLeave.length - unconfirmed };
    }).filter((g) => g.people.length || g.hiddenCount);
    const todayISO = todayISOInCanberra();
    const start = new Date(`${leave.weekStart}T00:00:00Z`);
    const diff = Math.round((new Date(`${todayISO}T00:00:00Z`) - start) / 86400000);
    const todayIndex = diff >= 0 && diff <= 4 ? diff : -1;

    // This panel shares the page with the two above it rather than getting a page
    // of its own, so — unlike the full report's Leave page — it can't just let an
    // overflow spill onto a continuation page: rows are fitted to whatever height
    // is actually left, with any that don't fit folded into the footnote instead.
    const dayHeaderRowH = 6.6 * 0.72; // matches leaveGrid's own top NAME/MON/TUE… row, which leaveGridH doesn't count
    const panelChromeH = kit.panelHeaderH('x') + dayHeaderRowH + 5;
    const { groups: gridGroups, hiddenCount: spaceHiddenCount } = fitLeaveGroups(
      condensedGroups.map((g) => ({ group: g.group, people: g.people })),
      Math.max(0, flow.remaining - panelChromeH),
    );
    const gridInnerH = kit.leaveGridH(gridGroups, leave.days);
    const gridPanelH = panelChromeH + gridInnerH;
    const gy0 = flow.ensure(gridPanelH);
    const gridTop = kit.panelFrame(MARGIN, gy0, w, gridPanelH, "Staff & doctors' leave — week at a glance", 'People with at least one day of leave this week; fully-out first.');
    const afterGrid = gridGroups.length
      ? kit.leaveGrid(MARGIN + 4, gridTop, w - 8, { days: leave.days, todayIndex, groups: gridGroups })
      : kit.placeholder(MARGIN + 4, gridTop, w - 8, 16, 'No room left on this page — see the live dashboard for the full grid.');
    const availableNote = condensedGroups.filter((g) => g.hiddenCount > 0).map((g) => `${g.hiddenCount} ${g.group.toLowerCase()}${g.hiddenCount === 1 ? '' : 's'}`).join(', ');
    const notes = [];
    if (availableNote) notes.push(`+ ${availableNote} fully available all week (not shown)`);
    if (spaceHiddenCount > 0) notes.push(`+ ${spaceHiddenCount} more on leave this week — see the live dashboard`);
    if (notes.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(6.6); kit.text(pal.inkFaint);
      doc.text(`${notes.join('; ')}.`, MARGIN + 4, afterGrid + 3.5, { maxWidth: w - 8 });
    }
    flow.y = gy0 + gridPanelH;
  } else {
    kit.placeholder(MARGIN, flow.ensure(24), w, 24, 'No leave report was published for this date.');
  }
}

// The short report's closing page: no section content, just a pointer back to the
// live dashboard for everything this condensed version left out.
function buildLinkPage(doc, pal, dateLabel) {
  const centerX = PAGE_W / 2, centerY = PAGE_H / 2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(...pal.ink);
  doc.textWithLink('For more information, visit Dashy Daily', centerX, centerY, { align: 'center', url: DASHBOARD_URL });
  doc.setDrawColor(...pal.accent); doc.setLineWidth(0.3);
  const linkW = doc.getTextWidth('For more information, visit Dashy Daily');
  doc.line(centerX - linkW / 2, centerY + 1.4, centerX + linkW / 2, centerY + 1.4);
}

// ---------------------------------------------------------------------------
// Chrome (top accent strip, section header, footer) — drawn in a second pass
// over every page once the total page count is known, onto the blank margin
// area each page already reserved for it.
// ---------------------------------------------------------------------------
function drawChrome(doc, pal, meta, pageNum, totalPages) {
  doc.setFillColor(...meta.color);
  doc.rect(0, 0, PAGE_W, 2, 'F');

  if (!meta.isCover && !meta.noHeader) {
    doc.setFillColor(...meta.color);
    doc.roundedRect(MARGIN, MARGIN - 3.4, 3.6, 3.6, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...pal.ink);
    doc.text(meta.title, MARGIN + 6.5, MARGIN);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...pal.inkMuted);
    doc.text(meta.dateLabel, PAGE_W - MARGIN, MARGIN, { align: 'right' });
    doc.setDrawColor(...pal.hairline); doc.setLineWidth(0.25);
    doc.line(MARGIN, MARGIN + 3.4, PAGE_W - MARGIN, MARGIN + 3.4);
  }

  doc.setDrawColor(...pal.hairline); doc.setLineWidth(0.2);
  doc.line(MARGIN, PAGE_H - MARGIN - 6, PAGE_W - MARGIN, PAGE_H - MARGIN - 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...pal.inkFaint);
  doc.text('YourGP · Dashy Daily', MARGIN, PAGE_H - MARGIN - 1.8);
  doc.text(meta.dateLabel, PAGE_W / 2, PAGE_H - MARGIN - 1.8, { align: 'center' });
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 1.8, { align: 'right' });
}

const SECTIONS = [
  { key: 'overview', title: 'Overview', colorKey: 'accentStrong', build: buildOverviewPage, needs: (data) => ({ overview: data.overview }) },
  { key: 'tasks', title: 'Critical daily tasks', colorKey: 'live', build: buildTasksPage, needs: (data) => ({ tasks: data.tasks }) },
  { key: 'calls', title: 'Call logs', colorKey: 'age3', build: buildCallLogsPage, needs: (data) => ({ callLogs: data.callLogs }) },
  { key: 'cloop', title: 'Cloop', colorKey: 'accent2', build: buildCloopPage, needs: (data) => ({ cloop: data.cloop, callLogs: data.callLogs }) },
  { key: 'leave', title: "Staff & doctors' leave", colorKey: 'dangerInk', build: buildLeavePage, needs: (data) => ({ leave: data.leave }) },
];

function buildFullReportDoc(doc, kit, pal, data, date, dateLabel, onProgress) {
  // Page 1 (the cover) is drawn LAST, once every section's actual page count is
  // known — but it still occupies page 1 throughout, since jsPDF always starts a
  // document with one page and drawing order doesn't have to match page order.
  const pageMeta = [null];
  const sectionsMeta = [];

  for (const section of SECTIONS) {
    onProgress?.(`Building ${section.title}…`);
    doc.addPage('a4', 'landscape');
    const startPage = doc.internal.getNumberOfPages();
    const meta = { title: section.title, color: pal[section.colorKey], dateLabel };
    pageMeta.push({ isCover: false, ...meta });
    const flow = makeFlow(doc, pageMeta, meta);
    section.build(doc, kit, pal, flow, section.needs(data));
    sectionsMeta.push({ title: section.title, color: pal[section.colorKey], startPage });
  }

  onProgress?.('Building cover page…');
  doc.setPage(1);
  pageMeta[0] = { isCover: true, color: pal.accentStrong, dateLabel };
  buildCoverPage(doc, kit, pal, { date, overview: data.overview, sectionsMeta });
  return pageMeta;
}

// Short report: an at-a-glance page (reusing the same Overview layout as the full
// report, just with the title folded into its own header instead of a separate
// cover), one detail page for what's most likely to need same-day attention, and
// a closing page pointing back to the dashboard for everything left out.
function buildShortReportDoc(doc, kit, pal, data, dateLabel, onProgress) {
  // Unlike the full report, page 1 here is real content, not a cover reserved for
  // later — jsPDF already starts the document on it, so no addPage() for this one.
  onProgress?.('Building at-a-glance page…');
  const meta1 = { title: 'Dashy Daily', color: pal.accentStrong, dateLabel };
  const pageMeta = [{ isCover: false, ...meta1 }];
  const flow1 = makeFlow(doc, pageMeta, meta1);
  buildOverviewPage(doc, kit, pal, flow1, { overview: data.overview });
  // The patient-service call KPIs ride along on this page rather than the next —
  // the short report has no separate Call logs page for them to live on, and
  // there's room here now that the checklist/streak content above is gone.
  addPatientServiceKpiRow(doc, kit, pal, flow1, data.callLogs?.patientServiceKpi, CONTENT_W);

  // Fills whatever's left on the page — a 10-day trend is the one piece of
  // "is today normal?" context missing everywhere else in the short report
  // (every trend chart in the full report was otherwise cut for space), and a
  // chart reads better in leftover space than an empty bordered box would.
  const trendH = Math.max(34, flow1.remaining);
  const ty0 = flow1.ensure(trendH);
  const t = data.callLogs?.tenDayTrend;
  const chartTop = kit.panelFrame(MARGIN, ty0, CONTENT_W, trendH, 'Call volume — 10-day trend', '');
  if (t?.accepted) {
    kit.stackedBarChart(MARGIN + 4, chartTop, CONTENT_W - 8, trendH - kit.panelHeaderH('') - 2, { labels: t.labels, seriesA: t.accepted, seriesB: t.missed, colorA: pal.live, colorB: pal.danger, labelA: 'Accepted', labelB: 'Missed' });
  } else {
    kit.placeholder(MARGIN + 4, chartTop, CONTENT_W - 8, trendH - kit.panelHeaderH('') - 4, 'Not published this date.');
  }
  flow1.y = ty0 + trendH;

  onProgress?.("Building today's detail page…");
  doc.addPage('a4', 'landscape');
  const meta2 = { title: "Today's detail", color: pal.live, dateLabel };
  pageMeta.push({ isCover: false, ...meta2 });
  buildShortDetailPage(doc, kit, pal, makeFlow(doc, pageMeta, meta2), { cloop: data.cloop, leave: data.leave });

  onProgress?.('Building closing page…');
  doc.addPage('a4', 'landscape');
  const meta3 = { title: null, color: pal.accentStrong, dateLabel, noHeader: true };
  pageMeta.push({ isCover: false, ...meta3 });
  buildLinkPage(doc, pal, dateLabel);

  return pageMeta;
}

/**
 * Renders the report as one native, vector-drawn landscape PDF.
 *
 * mode: 'full' (default) — a cover page (title, headline KPIs, contents) followed
 * by one densely laid-out page per section, in the same order as the sidebar nav,
 * with a continuation page for any section whose content doesn't fit on one.
 *
 * mode: 'short' — a 3-page condensed version: an at-a-glance page, one detail
 * page, and a closing page linking back to the dashboard for everything else.
 *
 * @param {string} date
 * @param {{dates:string[], latest:string}} manifest
 * @param {{onProgress?: (msg:string)=>void, mode?: 'full'|'short'}} [opts]
 * @returns {Promise<string>} the downloaded file's name
 */
export async function exportReport(date, manifest, { onProgress, mode = 'full' } = {}) {
  onProgress?.('Preparing…');
  await ensureLibs();
  await document.fonts.ready;
  const { jsPDF } = window.jspdf;
  const pal = buildPalette();

  onProgress?.('Fetching report data…');
  const data = await loadReportData(date);
  const dateLabel = `${formatDate(date, { weekday: 'long' })}, ${formatDate(date)}`;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const kit = makeKit(doc, pal);
  const pageMeta = mode === 'short'
    ? buildShortReportDoc(doc, kit, pal, data, dateLabel, onProgress)
    : buildFullReportDoc(doc, kit, pal, data, date, dateLabel, onProgress);

  onProgress?.('Finishing…');
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawChrome(doc, pal, pageMeta[i - 1], i, totalPages);
  }

  const filename = mode === 'short' ? `daily-report-short-${date}.pdf` : `daily-report-${date}.pdf`;
  doc.save(filename);
  return filename;
}

let toastTimer = null;

/** A shared bottom-of-screen toast (design-system's own .toast component). */
export function showToast(message, { ok = true, duration = 3400 } = {}) {
  let toast = document.getElementById('dr-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dr-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  const iconPath = ok ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M12 8v5M12 16.5h.01"/><circle cx="12" cy="12" r="9"/>';
  const iconColor = ok ? '' : ' style="color:var(--danger)"';
  toast.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"${iconColor}>${iconPath}</svg><span>${message}</span>`;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}
