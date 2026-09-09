# Daily Operations Report

An internal operations dashboard for YourGP (Crace, Lyneham, Denman) — five pages that
replace the daily "Daily Operations Report" PDF that gets emailed around: Overview,
Critical Daily Tasks, Call Logs, Cloop, and Staff & Doctors' Leave.

**Phase 1 (this build): static/mock data.** Every number on every page was extracted
from the two source PDFs for Report #308 (8 September 2026) — see `assets/data/*.json`
for exactly what came from where, and `PHASE-2.md` for how to wire it to a live feed.

Built on the vendored **YourGP Design System** at `design-system/` — same tokens, same
component classes as `design-system/DESIGN-GUIDELINES.md` and
`design-system/CLASS-REFERENCE.md` describe. No new component styles were introduced;
see `COMPONENT-ANALYSIS.md` for the full breakdown of what's used where and why.

## Running it locally

It's a static site with no build step, but the page modules `fetch()` their JSON data
files, which browsers block over `file://`. Serve it instead:

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any static file server works the same way (`npx serve`, `php -S`, etc.).

## Layout

```
index.html                    <- app shell: sidebar + topbar + a #page-content mount point
assets/
  css/app.css                 <- a handful of layout-only additions on top of the design system
  js/
    app.js                    <- hash router (#/overview, #/critical-tasks, #/call-logs, #/cloop, #/leave)
    charts.js                 <- dependency-free SVG chart helpers, built only from design tokens
    util.js                   <- esc(), fetchJSON(), timezone-safe formatDate(), mountInteractiveTable()
    workdays.js                <- ACT (Canberra) 2026 public holidays (dated + named) + working-day math
    calendarview.js             <- renders one month grid: holidays + known leave counts
    pages/*.js                <- one render(container) module per page; each fetches its own JSON
  data/*.json                 <- one file per page — the Phase 2 seam (see PHASE-2.md)
design-system/                <- vendored, unmodified YourGP Design System package
COMPONENT-ANALYSIS.md         <- which design-system components each page uses, and why
PHASE-2.md                    <- what changes (and what doesn't) when this goes live
```

## Interactivity

- **Sortable, searchable tables** — Call Logs' Staff activity and Longest wait per
  queue, Cloop's Real-time metrics and Emails handled: click a column to sort, type in
  a search box to filter. All built on one small helper, `mountInteractiveTable()` in
  `util.js`, so any future table gets the same behaviour for free.
- **Real filters** — a queue picker on Call Logs narrows both 10-day trend grids to one
  queue; a day picker on Staff & Doctors' Leave shows only who's on leave that day.
- **Drill-down** — clicking a row in Call Logs' Staff activity table expands it to show
  that person's inbound + outbound split, cross-referenced against yesterday's Cloop
  email handling where the same name appears (a genuine cross-page view, not just the
  same numbers shown twice). Overview links straight through to each detail page.
- **Streak "since" dates** — Critical Daily Tasks computes a calendar start date for
  each streak by counting back its day-count across ACT (Canberra) *working days*
  (Mon–Fri, minus real 2026 ACT public holidays — see `workdays.js`) from the report
  date, and marks it "est." Denman's start date is the one exception: the source PDF
  states it directly (13 Jan 2026), and a plain ACT-working-day count between that date
  and the report date doesn't land on the stated 109-day streak either — so it's shown
  verbatim rather than recalculated, with both facts called out in the page's own
  footnote rather than silently papered over.
- **Leave & public holiday calendar** — Staff & Doctors' Leave has a month-by-month
  calendar (`calendarview.js`) marking every real 2026 ACT public holiday and, for the
  one week the source data covers, how many people are on leave each day (hover a day
  for names). Days outside that week honestly say "No leave data" rather than imply
  a clear roster; month nav is clamped to Jan–Dec 2026, the span the holiday list
  actually covers. "On leave" renders in the loud colour (vermillion) and "Available"
  in the calm one, deliberately matching the source PDF's orange/green emphasis — the
  first version had this backwards, which made a person's single leave day easy to
  miss next to a run of fully-on-leave rows.

## Pages

| Page | Route | Source |
|---|---|---|
| Overview | `#/overview` | Condensed headline figures, from the **short-version** PDF |
| Critical daily tasks | `#/critical-tasks` | Streaks + PST/Finance checklists (full PDF only publishes task-level detail for these two) |
| Call logs | `#/call-logs` | Queue volumes, answer rate, wait times, per-staff call activity |
| Cloop | `#/cloop` | Case queue volumes, agent handling matrix, week-over-week movement |
| Staff & doctors' leave | `#/leave` | Week-at-a-glance grid, 7–11 September 2026 |

Two labelled gaps, called out inline where they occur:
- Crace, Denman and Lyneham only publish a streak counter in the source report, not an
  itemised checklist (Critical Daily Tasks page) — flagged with a placeholder note.
- Neither PDF includes a Public Holiday day in this particular week's leave grid, so
  that legend entry has no live example — the colour/label are still wired up correctly.
