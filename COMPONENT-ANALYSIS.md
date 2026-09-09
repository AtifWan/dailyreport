# Component analysis — Daily Operations Report

Which classes from the vendored `design-system/` each of the five pages uses, and why.
Produced against `design-system/DESIGN-GUIDELINES.md`, `design-system/CLASS-REFERENCE.md`
and `design-system/components/COMPONENTS.md`. No new component classes were introduced
anywhere in this app — every element below is an existing design-system class, optionally
with an inline `style="...var(--token)..."` override for a specific value, which is the
same pattern the design system's own component demos use (e.g. `.comp-seg` segment
widths, `.agepill i` dot colours).

## Shell

`.app` / `.sidebar` / `.brand` `.mark` `.nm` / `.nav-label` / `.nav-item` (`.on`) `.nav-ic`
/ `.main` `.topbar` `.tb-titles` `.tt` `.ts` / `.content` / `.menu-btn`
`.nav-backdrop` (`.show`) `.sidebar.open` — used verbatim from `examples/starter.html`,
minus its `.side-user` account footer and topbar sign-out: this report needs no
sign-in to view, so those elements were removed rather than left as dead UI.
Two icons (call-logs phone glyph, leave calendar glyph) were hand-drawn in `index.html`
to the exact construction `ICONS.md` specifies (`viewBox 0 0 24 24`, `stroke=currentColor`,
1.9 width, round caps) since the shipped icon set doesn't include a phone or calendar mark
— guidance explicitly allows adding new icons in the same style when needed.

## Per-page usage

| Page | Components used | Notes |
|---|---|---|
| **Overview** | `.kpis` `.kpi` (`.good`/`.crit`), `.panel` `.q` `.take`, `.brow`/`.bl`/`.minibar`/`.bv`, `.splitbar`/`.seg`, `.foot-note`, `.result-meta`, `.grid2` | Streak and queue-breakdown bars reuse the "By location" `.brow` pattern from `components/panels.html` verbatim. |
| **Critical daily tasks** | `.kpis` `.kpi`, `.panel` `.brow`, custom line chart (10-day % trend), `check`/incomplete-box list styled after the PDF's own ✓/☐ convention, `.dr-placeholder` (new, minimal — see below) | Complete tasks render in `--live-ink`, incomplete in `--danger-ink` — text colour only ever *reinforces* the ✓/☐ glyph, never replaces it. Each streak's "since" date (`workdays.js`) is marked *est.* in the `.k-n`/`.foot-note` text rather than presented as fact — see README's Interactivity section. |
| **Call logs** | `.kpis` `.kpi`, `.panel`, `.rtable-wrap` `.rtable` `.r` `.strong` `.thsort`/`.thsort-i` (now wired live), `.locbtn` (`.on`) as a queue filter, `.sinput` as a staff search box, stacked/line/bar charts, `.dr-legend` (new, minimal) | Accepted/missed always renders as `--live`/`--danger` (blue/vermillion) — the same fixed semantic pair the design system uses for paid/unpaid, good/bad KPI deltas. The Staff activity table merges inbound + outbound + (where the name matches) yesterday's Cloop email handling into one sortable, searchable, expandable table, rather than three separate static rankings of the same roster. |
| **Cloop** | `.kpis` `.kpi`, `.panel`, `.rtable-wrap` `.rtable` `.thsort`/`.thsort-i` (live) with `tfoot`, `.splitbar`, line charts, `.d-up`/`.d-down`/`.d-flat` | Week-over-week deltas use the design system's fixed convention: `.d-up` is always vermillion (an increase), `.d-down` always blue (a decrease) — this reads correctly for backlog-style metrics (more in-queue/in-progress is the "worse" direction) without needing a per-metric override. |
| **Staff & doctors' leave** | `.rtable-wrap` `.rtable`, `.chip` (base class, not `.paid`/`.unpaid` — see below), `.locbtn` (`.on`) as a day-of-week filter and for calendar month nav, `.sinput` as a name search, `.kpis` `.kpi`, new `.dr-cal-*` month calendar (see below) | Leave status is categorical, not a paid/unpaid or good/bad distinction, so the leave grid reuses bare `.chip` (pill shape) with inline `background`/`color` from `--danger-soft`/`--live-soft`/`--infer-soft` + matching `-ink` tokens, rather than repurposing `.chip.paid`/`.chip.unpaid`'s specific naming for an unrelated meaning. Every cell carries a text label ("On leave" / "Available" / "Public holiday"), never colour alone — and "On leave" is deliberately the loud vermillion, matching the source PDF's orange emphasis (an earlier version used a quiet grey here, which buried a person's single leave day next to fully-on-leave rows). The day whose date matches the report date gets an `--accent-weak` tint and a "Today" tag — real, not decorative, since this leave week happens to contain the report date. |

## New, minimal additions (`assets/css/app.css`)

Everything in `app.css` is layout glue for content this app generates, not a parallel
design system:

- `.dr-chart` / `.dr-chart-wrap` — makes the hand-rolled SVG charts (`assets/js/charts.js`)
  scale responsively and scroll inside their own container on narrow screens, per
  `DESIGN-GUIDELINES.md` §8 ("only tables and charts scroll inside their own containers").
- `.dr-legend` — a plain flex row of coloured swatches + labels, visually identical to
  the design system's own `.comp-legend` but reusable for the two-series bar/line charts
  that aren't the aging composition bar `.comp-legend` was built for.
- `.dr-placeholder` — a dashed, muted box for the one documented data gap (Crace/Denman/
  Lyneham task checklists); styled from existing tokens (`--hairline-strong`,
  `--surface-sunk`, `--ink-faint`), not a new visual language.
- `.dr-group-row` — the "DOCTOR" / "STAFF" section header row inside the leave table;
  same background/typography as `.nav-label`, applied to a table row instead.
- `.dr-cal-*` — a month calendar grid (`calendarview.js`) has no design-system precedent
  to extend, so it's built from the same tokens a `.panel` would use: `--hairline`
  dividers, `--radius-sm` corners, `--surface-sunk` for a receding (weekend/empty) day,
  and the same `--infer` (holiday) / `--danger` (leave) / `--live` (clear) tokens used
  everywhere else in this app for that three-way meaning.

## New JS utilities (`assets/js/util.js`, `assets/js/workdays.js`)

Behaviour, not markup, so they don't have a design-system precedent to extend — but
neither introduces a competing visual language:

- `mountInteractiveTable()` wires up sort/search/expand against whatever `.thsort` /
  `.sinput` markup a page already rendered with the design system's own classes; it
  owns no styling of its own.
- `workdays.js` is pure date math (an ACT 2026 public holiday list + a "count back N
  working days" function) — no DOM, no styling.

## Deliberately not used

- `.agepill` / the Okabe-Ito age tokens (`--age1..4`) — these describe *invoice ageing
  buckets*, a concept absent from this report. They are, however, reused as a plain
  categorical palette to colour-code the four call queues consistently across the
  per-queue trend panels on the Call Logs page (a legitimate categorical sequence per
  §2's "for any categorical sequence, prefer the Okabe-Ito age tokens").
- `.login` / `.li-*` — this app has no sign-in screen of its own.
- `.rng` / `.rng-track` (range widget) — built for a low→high range with a current-position
  marker; nothing in either source PDF has that shape of data.
