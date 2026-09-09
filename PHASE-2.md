# Phase 2 — wiring this to live data

Phase 1 (this build) hardcodes one day's numbers into `assets/data/*.json`, one file per
page. Every page module (`assets/js/pages/*.js`) only ever touches the parsed object
`fetchJSON()` hands back — it never knows or cares whether that came from a static file
or a live API. That's the seam.

## What changes

For each page, replace the `fetchJSON('assets/data/<page>.json')` call with a call to
whatever the real extraction pipeline serves — same shape in, same shape out:

```js
// Phase 1
const d = await fetchJSON('assets/data/call-logs.json');

// Phase 2 — same object shape, different source
const d = await fetchJSON('/api/reports/latest/call-logs');
```

Concretely, that means:

1. **Stand up an endpoint (or a build step) per data file** that returns JSON matching
   the shape documented at the top of each file under `assets/data/`. The `_source`
   field in each file is a comment for humans, not read by the app — safe to drop or
   keep in the live version.
2. **Point `fetchJSON()` at it** in each `pages/*.js` module (one line each).
3. **Decide a refresh strategy.** Nothing here polls today. The simplest upgrade is a
   `setInterval` in `app.js` that re-runs the current route's `render()` every few
   minutes; a fancier one pushes updates over SSE/WebSocket and re-renders on message.
   Either way, `render(container)` is already idempotent (it replaces the container's
   `innerHTML` from scratch each call), so re-invoking it on a timer is enough.
4. **Auth**, if the live endpoint needs it: add headers/credentials inside `fetchJSON()`
   in `util.js` — the one place every page module already funnels through.

## What doesn't change

- `index.html`, the sidebar/router (`app.js`), and every `assets/js/charts.js` helper —
  they're all data-shape-driven, not content-driven.
- The design system (`design-system/`) and `assets/css/app.css`.
- The page modules' rendering logic, **as long as the live feed's JSON matches the
  documented shape**. If a live field is genuinely unavailable (e.g. Crace/Denman/
  Lyneham's task-level checklists — see the placeholder note on the Critical Daily
  Tasks page), the `dr-placeholder` block is the pattern to extend or remove once that
  data actually exists.

## Known placeholders to close out

- `tasks.json.sitePlaceholderNote` — Crace, Denman, Lyneham checklists are streak-only
  today; once BestPractice/Cloop expose their per-task detail, add them as a third and
  fourth entry in `checklists` and this note can go.
- `leave.json` has no `public_holiday` example this week — the color/label are wired
  (see `assets/js/pages/leave.js`'s `STATUS` map) and need no change when one appears
  in a future week's data.
