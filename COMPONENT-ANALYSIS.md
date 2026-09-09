# Component analysis — YourGP Design System

Analysis of every component shipped in `yourgpdesignsystem.zip` (vendored at
`design-system/`), and how each is used (or deliberately left unused) in this
tool's `index.html`. Produced by reading `DESIGN-GUIDELINES.md`,
`CLASS-REFERENCE.md`, `components/COMPONENTS.md`, every file in
`components/*.html`, `theme/tokens.css`, and `css/styles.css`.

## What the package contains

| Area | Files | Purpose |
|---|---|---|
| Guidelines | `DESIGN-GUIDELINES.md`, `README.md`, `CLASS-REFERENCE.md` | Principles, tokens, component rules, accessibility, checklist |
| Tokens | `theme/tokens.css`, `theme/theme.json` | OKLCH/hex colour, radius, shadow, spacing tokens as the single source of truth |
| Stylesheet | `css/styles.css` | The one authoritative stylesheet implementing every class below |
| Components | `components/*.html` (13 files) | Standalone renderable examples, one per component family |
| Icons | `icons/*.svg` + `ICONS.md` | 8 line icons, `viewBox 0 0 24 24`, `stroke=currentColor` |
| Fonts | `fonts/FONTS.md` | Fraunces (serif headings) + Hanken Grotesk (sans body/numbers) |
| Favicon | `favicon/*` + `FAVICON.md` | Teal rounded-square mark, full icon set |
| Starter | `examples/starter.html` | App-shell skeleton (sidebar + topbar + content) |

## Component-by-component usage in this tool

| Component file | Classes | Used in `index.html`? | Notes |
|---|---|---|---|
| `nav-sidebar.html` | `.sidebar`, `.brand`, `.mark`, `.nm`, `.nav-label`, `.nav-item`(`.on`), `.nav-ic`, `.side-user` | **Yes** | Rebranded to "Daily Report" / YourGP, 3 nav items (Today, Invoices, By site); only "Today" has a built screen |
| `kpi-cards.html` | `.kpis`, `.kpi`(`.good`/`.crit`), `.k-l`, `.k-v.num`, `.k-n`, `.k-vs` | **Yes** | Billed / Paid (`.good`) / Unpaid (`.crit`) / Average invoice; one delta (`.d-up`, correctly vermillion because a rising unpaid figure is bad) |
| `panels.html` | `.panel`, `h3`, `.q`, `.take`, `.brow`/`.bl`/`.minibar`/`.bv` | **Yes** | "Billed by location" panel with per-site bars and a "reads as" callout |
| `data-table.html` | `.rtable-wrap`, `.rtable`, `.r`, `.strong`, `.thsort`/`.thsort-i`, `.chip`, `tfoot` | **Yes** | "Today's invoices" table; sort wired up on the Total column |
| `table-extras.html` | `.result-meta`, `.splitbar`/`.seg`, `.pager`/`.pg-l`/`.pg-btns`/`.pg-btn` | **Yes** | "Paid vs unpaid" panel (split bar) + pagination row under the invoice table |
| `filters.html` | `.filters`, `.fgrp`, `.flbl`, `.dinput`, `.sinput`, `.selwrap>select` | **Yes** | Report date, site, invoice search, status, category |
| `chips-pills.html` | `.rpick .rt`, `.pchip`, `.rchip`/`.rvs`, `.mcb`/`.mcb-lbl` | **Partially** | None of these fit a single-day report (they're for period pickers and range comparison); see "Not used" below |
| `buttons.html` | `.btn.btn-primary`, `.locbtn`(`.on`), `.signout`, `.menu-btn` | **Yes** | Download Excel (primary), site segmented tabs (`.locbtn`), sign-out, mobile hamburger |
| `status-badges.html` | `.chip.paid`/`.unpaid`, `.agepill`, `.d-up`/`.d-down`/`.d-flat` | **Yes (partial)** | Status chips throughout the table and the one KPI delta; `.agepill` not used — see below |
| `range-widget.html` | `.rng`, `.rng-track`, `.rng-fill`, `.rng-mark` | **No** | Built for a Movement-style low→high range; a single day has no range to show |
| `charts-bars.html` | `.compbar`, `.albars`, `.sparkline`, `.linechart` | **No** | Aging composition/movement trend belong to a multi-day aging report, out of scope for a same-day sheet |
| `feedback.html` | `.callout`, `.demo-note`, `.foot-note`, `.toast`, `.chart-tip` | **Yes (partial)** | `.demo-note` flags the sample data, `.foot-note` explains ageing, `.toast` confirms the Excel export; `.callout` and `.chart-tip` not needed here |
| `login.html` | `.login`, `.login-card`, `.li-*` | **No** | This tool has no auth screen of its own; out of scope |

### Why `.agepill` and the aging palette are not on this page

The aging tokens (`--age1..--age4`) and `.agepill` describe **how overdue an
outstanding invoice is** (0–30 / 31–60 / 61–90 / 91+ days). Every invoice on
a *daily* report was raised **today**, so its age is always 0 — showing an
`.agepill` for every row would be true but useless, and `DESIGN-GUIDELINES.md`
§1.3 ("legibility over style") argues against decoration that doesn't carry
information. The `.foot-note` under the table says explicitly where an
unpaid invoice goes once the day rolls over (into the 0–30 bucket of a
separate ageing report), so the aging system is referenced, not duplicated.

### Why `.d-up` / `.d-down` are used the way they are

`css/styles.css` hard-codes `.d-up { color: var(--danger-ink) }` and
`.d-down { color: var(--live-ink) }` — i.e. these classes are not "any
increase/decrease", they are "increase in something bad" / "decrease in
something bad", always vermillion/blue respectively. The only delta on this
page is **Unpaid today vs yesterday**, where a rise is genuinely bad, so
`.d-up` (▲, vermillion) is correct. "Paid today" and "Billed today" are
shown without a delta rather than force-fitting a good-news increase into a
class whose colour means "bad".

## Tokens, type, and accessibility — how the guidelines were followed

- **Tokens only.** No hex values were hardcoded in `index.html`; every
  colour comes from `design-system/theme/tokens.css` via `css/styles.css`.
- **Semantics kept intact.** Good = blue (`--live`), bad = vermillion
  (`--danger`); paid/unpaid chips never rely on colour alone (the label
  text *is* the signal, and delta arrows add a shape cue).
- **Type.** Page title and panel headings stay in Fraunces (serif); every
  figure (`.num`) is Hanken Grotesk with `font-variant-numeric: tabular-nums`.
- **Responsive.** Reuses the system's two breakpoints verbatim (sidebar → 
  slide-in drawer with `.menu-btn` + `.nav-backdrop` at ≤880px, stat cards
  and filters collapse to fewer columns) — no new breakpoints introduced.
- **Copy.** Sentence case throughout ("Download Excel", "Sign out", "No
  invoices match these filters" style language for empty states, if wired
  to a real filter later).
- **No new component classes were introduced.** Everything on the page is
  assembled from the classes listed in `CLASS-REFERENCE.md`.

## File layout added to this repo

```
design-system/     <- unmodified vendored copy of the ZIP (tokens, css, icons,
                      fonts doc, favicon set, component examples, guidelines)
index.html         <- the Daily Report tool, built from those components
COMPONENT-ANALYSIS.md  <- this file
```
