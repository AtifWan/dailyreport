# Daily Report

A same-day billing report for YourGP, built on the **YourGP Design System**
(vendored at `design-system/`): today's billed/paid/unpaid totals, a
per-site breakdown, and the invoice list for the day.

Open `index.html` directly in a browser — it's a static page with no build
step, referencing `design-system/css/styles.css` and the two Google Fonts.

## What's here

- `index.html` — the Daily Report tool.
- `design-system/` — the unmodified YourGP Design System package (tokens,
  stylesheet, component examples, icons, fonts, favicon, guidelines).
- `COMPONENT-ANALYSIS.md` — an analysis of every component in the design
  system, mapped to how (or whether) it's used on this page, and why.

## Design system rules this tool follows

See `design-system/DESIGN-GUIDELINES.md` for the full reference. In short:
teal accent only, serif (Fraunces) headings with sans (Hanken Grotesk,
tabular) numbers and body text, blue = good / vermillion = bad (never
green/red), every colour cue paired with a shape (▲▼, dots, rails), calm
light surfaces, and the two standard responsive breakpoints (≤880px sidebar
becomes a drawer, ≤520px stat cards/filters go single column).

No new component classes were introduced — everything is assembled from
`design-system/CLASS-REFERENCE.md`.
