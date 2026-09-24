import { formatDate } from './util.js';
import { renderOverview } from './pages/overview.js';
import { renderTasks } from './pages/tasks.js';
import { renderCallLogs } from './pages/call-logs.js';
import { renderCloop } from './pages/cloop.js';
import { renderLeave } from './pages/leave.js';

// Renders each tab off-screen, in the same order as the sidebar nav, and stitches
// the result into one paginated PDF — the file that gets attached to the Teams
// channel today, built with a click instead of by hand from the source PDFs.
const SECTIONS = [
  { label: 'Overview', render: renderOverview },
  { label: 'Critical daily tasks', render: renderTasks },
  { label: 'Call logs', render: renderCallLogs },
  { label: 'Cloop', render: renderCloop },
  { label: "Staff & doctors' leave", render: renderLeave },
];

// Controls that only make sense on a live page (a date-picker button, a search box,
// filter chips) — hidden for the snapshot rather than rendered as dead chrome with
// nothing behind it. Nothing they gate is hidden: call-logs' per-queue panels and
// leave's day rows all default to "show everything", exactly what a full export wants.
const EXPORT_HIDE_SELECTOR = '.dr-date-filter, input.sinput, .dr-queue-filter, .dr-day-filter';

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

/** html2canvas + jsPDF (~100KB gzipped together, vendored under assets/vendor/ so
 *  the export works with no third-party dependency at request time) are only
 *  fetched the first time an export actually runs, not on every page load. */
function ensureLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (!libsPromise) {
    libsPromise = Promise.all([
      window.html2canvas ? null : loadScript('assets/vendor/html2canvas.min.js'),
      window.jspdf ? null : loadScript('assets/vendor/jspdf.umd.min.js'),
    ]);
  }
  return libsPromise;
}

/** Resolves ANY valid CSS colour (oklch(), a hex string, "transparent", …) to the
 *  rgb()/rgba() string a 2024-era canvas renderer like html2canvas can read —
 *  Canvas 2D's own fillStyle parser already understands oklch(), so painting one
 *  pixel and reading it back is a more reliable translator than hand-rolling an
 *  oklch-to-rgb formula. */
function resolveToRgb(cssColor) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

// html2canvas's own CSS colour parser predates oklch() and paints anything it can't
// read as solid black — and design-system/css/styles.css uses oklch() both behind
// custom properties AND written directly into rules (.topbar, .toast, .kpi.crit's
// border-color, …), so patching individual properties on individual elements can't
// cover it. The two stylesheets' own text is fetched once and every oklch(...)
// literal in it is swapped for the rgb()/rgba() a 1x1 canvas resolves it to.
//
// That fixed CSS then has to win the cascade on the *live* page while a capture is
// in flight, not just inside html2canvas's cloned copy — it turns out html2canvas
// also reads computed style straight off the original elements for some of its own
// bookkeeping (observed via `getComputedStyle(svg).borderTopColor` resolving
// `currentcolor` back to oklch()), so a clone-only fix still throws on a real page.
// Appending it as one more <style> after the two original stylesheets makes it win
// every overlapping declaration (same selectors, same specificity, later wins) —
// same computed colours everywhere, just spelled in a syntax html2canvas can read;
// nothing changes visibly while it's active.
let oklchFreeCssPromise = null;
function loadOklchFreeCss() {
  if (!oklchFreeCssPromise) {
    oklchFreeCssPromise = (async () => {
      const hrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => link.href)
        .filter((href) => href && !href.includes('fonts.googleapis.com'));
      const texts = await Promise.all(hrefs.map((href) => fetch(href).then((r) => r.text())));
      return texts.join('\n').replace(/oklch\([^)]*\)/g, (m) => resolveToRgb(m));
    })();
  }
  return oklchFreeCssPromise;
}

// The live dashboard's two-column panels (.grid2) and the ad-hoc per-queue chart
// grids in call-logs.js are sized for a desktop browser window; printed at that same
// width on a single A4 page, every line of text comes out well under 6pt — legible
// on a phone screen at hi-DPI, not on paper. Stacking everything to one column lets
// each section render at a *narrower* width and still print at a readable size (see
// CAPTURE_WIDTH below), and a table's own overflow-scroll wrapper is unclipped too,
// so a wide table prints in full rather than losing whatever columns need scrolling
// live (measured for real and grown into if still not enough — see captureSection).
// html2canvas clones the document before it reads any of this: cloning re-serialises
// every inline style attribute through the CSSOM ("display:grid;grid-template-columns:…"
// becomes "display: grid; grid-template-columns: …", spaced), so a substring selector
// copied verbatim from the source (no space after the colon) never matches inside the
// clone even though it matches the live page — confirmed by dumping the cloned
// attribute text mid-capture. Matching on "auto-fit" alone sidesteps the whole
// punctuation-spacing question, since html2canvas's reserialisation doesn't touch it.
const PRINT_LAYOUT_CSS = `
  .grid2 { grid-template-columns: 1fr !important; }
  [style*="auto-fit"] { grid-template-columns: 1fr !important; }
  .rtable-wrap { overflow: visible !important; max-height: none !important; width: fit-content !important; max-width: none !important; }
`;

/** Applies the oklch-free + print-layout overrides to the live document for the
 *  duration of `fn` (the whole multi-section capture), then removes them either way. */
async function withOklchOverride(fn) {
  const css = await loadOklchFreeCss();
  const styleEl = document.createElement('style');
  styleEl.textContent = `${css}\n${PRINT_LAYOUT_CSS}`;
  document.head.appendChild(styleEl);
  try {
    return await fn();
  } finally {
    styleEl.remove();
  }
}

function buildSandbox(width) {
  const el = document.createElement('div');
  // Off-screen, not display:none — html2canvas needs the element actually laid out.
  el.style.cssText = `position:fixed; left:-10000px; top:0; width:${width}px; background:var(--bg);`;
  document.body.appendChild(el);
  return el;
}

// charts.js's SVGs set fill/stroke directly as presentation attributes
// (`fill="var(--live)"`), not through a stylesheet rule — swapping the stylesheet
// text (above) doesn't touch these, and unlike an inline style="color:var(--x)",
// they don't reliably re-resolve against the clone's own cascade. Baked to a literal
// rgb() on the *live* sandbox element, straight from its own computed style, before
// html2canvas ever clones it, so there's no var() left for the clone to get wrong.
function bakeSvgPaintColors(root) {
  root.querySelectorAll('[fill*="var("], [stroke*="var("]').forEach((el) => {
    const computed = getComputedStyle(el);
    if (el.getAttribute('fill')?.includes('var(')) el.setAttribute('fill', resolveToRgb(computed.fill));
    if (el.getAttribute('stroke')?.includes('var(')) el.setAttribute('stroke', resolveToRgb(computed.stroke));
  });
}

// getBoundingClientRect() always reports an element's own real layout box, even when
// an ancestor would normally clip it (clipping is a paint-time effect, not a layout
// one) — so this finds how wide the widest actual table wants to be regardless of
// its .rtable-wrap's overflow setting, independent of PRINT_LAYOUT_CSS having
// unclipped that wrapper already.
function measureNeededWidth(sandbox, baseWidth) {
  const left = sandbox.getBoundingClientRect().left;
  let needed = baseWidth;
  sandbox.querySelectorAll('.rtable').forEach((table) => {
    const right = table.getBoundingClientRect().right - left;
    if (right > needed) needed = right + 24; // small right-hand breathing room
  });
  return needed;
}

async function captureSection(sandbox, section, date, manifest, width, scale) {
  sandbox.style.width = `${width}px`;
  sandbox.innerHTML = '';
  await section.render(sandbox, date, manifest);
  sandbox.querySelectorAll(EXPORT_HIDE_SELECTOR).forEach((el) => { el.style.display = 'none'; });
  bakeSvgPaintColors(sandbox);
  // Give the browser a couple of frames to settle the layout this innerHTML swap
  // just triggered before html2canvas measures it.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // A table wider than `width` (its .rtable-wrap scrolls horizontally live) would
  // otherwise just get cropped at `width` — no scrollbar to hint anything is missing
  // once it's a flat image. Growing the sandbox to fit trades a smaller effective
  // print scale on that one section for never silently dropping a column.
  const neededWidth = measureNeededWidth(sandbox, width);
  if (neededWidth > width) {
    sandbox.style.width = `${neededWidth}px`;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  return window.html2canvas(sandbox, {
    scale,
    width: neededWidth,
    windowWidth: neededWidth,
    backgroundColor: '#faf9f5',
    onclone: (clonedDoc) => {
      // Box-shadow support in html2canvas is unreliable regardless of colour syntax;
      // a flat report reads fine without the dashboard's subtle elevation shadows.
      const style = clonedDoc.createElement('style');
      style.textContent = '*{ box-shadow: none !important; }';
      clonedDoc.head.appendChild(style);
    },
  });
}

/** Cuts one tall canvas into page-height chunks, each a separate PDF page. */
function sliceCanvas(canvas, sliceHeightPx) {
  const slices = [];
  let y = 0;
  while (y < canvas.height) {
    const h = Math.min(sliceHeightPx, canvas.height - y);
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = h;
    c.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    slices.push({ heightPx: h, dataUrl: c.toDataURL('image/jpeg', 0.94) });
    y += h;
  }
  return slices;
}

function drawCoverPage(doc, { date, sections, contentW, margin, pageH }) {
  const centerX = margin + contentW / 2;
  const weekday = formatDate(date, { weekday: 'long' });
  const long = formatDate(date);

  doc.setFillColor(0, 140, 153); // matches the sidebar brand mark's --accent
  doc.roundedRect(centerX - 9, 34, 18, 18, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Y', centerX, 45.5, { align: 'center' });

  doc.setTextColor(20, 20, 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(24);
  doc.text('Daily Operations Report', centerX, 68, { align: 'center' });

  doc.setFontSize(13);
  doc.setTextColor(90, 90, 90);
  doc.text(`${weekday} ${long}`, centerX, 77, { align: 'center' });

  let y = 96;
  doc.setDrawColor(225, 225, 220);
  doc.line(margin, y, margin + contentW, y);
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 115);
  doc.text('CONTENTS', margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 19);
  let page = 2;
  sections.forEach((section) => {
    doc.text(section.label, margin, y);
    doc.text(`page ${page}`, margin + contentW, y, { align: 'right' });
    y += 8;
    page += section.slices.length;
  });

  y += 2;
  doc.setDrawColor(225, 225, 220);
  doc.line(margin, y, margin + contentW, y);

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 145);
  doc.text('Generated automatically from the dashboard.', centerX, pageH - margin, { align: 'center' });
}

/**
 * Renders every section for `date` off-screen, exactly as the dashboard itself
 * would, and downloads one combined PDF: a cover page, then each section starting
 * on its own page.
 *
 * @param {string} date
 * @param {{dates:string[], latest:string}} manifest
 * @param {{onProgress?: (msg:string)=>void}} [opts]
 * @returns {Promise<string>} the downloaded file's name
 */
export async function exportFullReport(date, manifest, { onProgress } = {}) {
  await ensureLibs();
  await document.fonts.ready;
  const { jsPDF } = window.jspdf;

  // PRINT_LAYOUT_CSS stacks every section to one column, so this only has to be
  // wide enough for a *single* panel to read comfortably — not two side by side —
  // which is what actually keeps the printed font size legible (see captureSection
  // and PRINT_LAYOUT_CSS above for why 1280px, right for the live 2-column desktop
  // layout, printed at illegibly small text once squeezed onto one A4 page width).
  const CAPTURE_WIDTH = 820; // CSS px baseline; a section only grows past this if a table needs more room
  const SCALE = 2; // html2canvas render scale, for crisp text in the PDF
  const PAGE_W = 210, PAGE_H = 297, MARGIN = 14; // A4, mm
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const CONTENT_H = PAGE_H - MARGIN * 2;

  const sandbox = buildSandbox(CAPTURE_WIDTH);
  const sections = [];
  try {
    await withOklchOverride(async () => {
      for (const section of SECTIONS) {
        onProgress?.(`Rendering ${section.label}…`);
        const canvas = await captureSection(sandbox, section, date, manifest, CAPTURE_WIDTH, SCALE);
        // Computed from this canvas's own width rather than the shared baseline —
        // a section that had to grow for a wide table prints at a smaller scale
        // *only for that section*, instead of shrinking every other page too.
        const mmPerCanvasPx = CONTENT_W / canvas.width;
        const pageHeightPx = CONTENT_H / mmPerCanvasPx;
        sections.push({ label: section.label, mmPerCanvasPx, slices: sliceCanvas(canvas, pageHeightPx) });
      }
    });
  } finally {
    sandbox.remove();
  }

  onProgress?.('Assembling PDF…');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawCoverPage(doc, { date, sections, contentW: CONTENT_W, margin: MARGIN, pageH: PAGE_H });

  sections.forEach((section) => {
    section.slices.forEach((slice) => {
      doc.addPage();
      doc.addImage(slice.dataUrl, 'JPEG', MARGIN, MARGIN, CONTENT_W, slice.heightPx * section.mmPerCanvasPx);
    });
  });

  const filename = `daily-report-${date}.pdf`;
  doc.save(filename);
  return filename;
}

let toastTimer = null;

/** A shared bottom-of-screen toast (design-system's own .toast component; this is
 *  its first real caller, so it creates the element the first time it's needed). */
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
