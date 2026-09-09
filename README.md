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
    app.js                    <- date-aware hash router: #/<route>/<date>, e.g. #/overview/2026-09-08
    datepicker.js              <- the per-page native <input type="date"> (item 10) — markup + wiring
    charts.js                 <- dependency-free SVG chart helpers, built only from design tokens
    util.js                   <- esc(), fetchJSON(), timezone-safe formatDate()/addDaysISO(), mountInteractiveTable()
    workdays.js                <- ACT (Canberra) 2026 public holidays (dated + named) + working-day math
    calendarview.js             <- renders one month grid: holidays + known leave counts
    pages/*.js                <- one render(container, date, manifest) module per page; each fetches its own dated JSON
  data/reports/
    index.json                 <- manifest: {"dates": [...], "latest": "..."} — the only file that lists what's available
    <YYYY-MM-DD>/*.json        <- one dated folder per report, same 5 filenames each time — the Phase 2 seam (see PHASE-2.md)
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
- **Public holiday calendar** — Staff & Doctors' Leave has a month-by-month calendar
  (`calendarview.js`) marking every real 2026 ACT public holiday, so admin staff can
  browse ahead to what's coming up; month nav is clamped to Jan–Dec 2026, the span the
  holiday list actually covers. It deliberately does *not* also show a per-day leave
  count — that would just duplicate the "Week at a glance" table above it.
- **"Today" vs. the report date** — a report is always published a day after the date
  its figures describe (Report #308's data is *about* Tuesday, but is only ever read
  starting Wednesday). Retrospective figures (call volumes, checklist completion,
  streak day-counts) stay anchored to the report's own date throughout. The one
  exception is anything showing "which day is today, right now" — the Leave page's
  today-highlight and the Public holiday calendar's today-ring — which use the report
  date plus one day instead (`addDaysISO()` in `util.js`), so "Today" always lands on
  the actual day the report is being read, not the day its data is about.
- **Week at a glance, redesigned for scanability** — "On leave" renders in the loud
  colour (vermillion) and "Available" in the calm one, deliberately matching the
  source PDF's orange/green emphasis (an earlier version had this backwards, which
  made a person's single leave day easy to miss next to a run of fully-on-leave rows).
  Rows are sorted fully-out-first, then by days-out descending, and each name carries
  an "Out all week" / "N/5 days out" badge plus a left status rail (the same inset-rail
  idiom the KPI cards use for good/crit) — so who needs attention is obvious before
  you've read a single day cell.

## Historical reports & the date picker

Every report date lives in its own folder, `assets/data/reports/<YYYY-MM-DD>/`, holding
the same five JSON files described above. `assets/data/reports/index.json` is the one
manifest listing which dates exist (`dates`) and which is newest (`latest`) — nothing
else in the app hardcodes a date list. Adding a new day's report is: drop in a new dated
folder, add its date to the manifest, done.

The selected date lives in the URL hash itself — `#/<route>/<date>`, e.g.
`#/leave/2026-09-08` — not inside any one page's state, which is what makes it survive
navigating between pages (item 11). `app.js` is the one place that reads/resolves it
(from the URL, falling back to whatever was last selected, falling back to
`manifest.latest`) and passes it into every page's `render(container, date, manifest)`;
sidebar nav clicks carry the current date forward via `data-route` attributes rather
than resetting it. `manifest.latest` is never the live/real calendar date — a report is
always published a day after the date it covers (see "Today" below), so "newest
available" and "today's real date" are two different things on purpose.

Each page renders its own date picker (`datepicker.js`) — a plain native
`<input type="date">`, not a custom calendar widget, per the explicit ask — clamped to
the manifest's date range and backed by a `<datalist>` so browsers that support it show
tick marks on the specific dates that actually have data. Changing it on any one page
re-renders that page at the new date and updates the URL; the picker is per-page by
design (so, e.g., picking an older date on Leave doesn't also jump Overview to it), but
navigating via the sidebar always preserves whatever date you were last looking at.

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
