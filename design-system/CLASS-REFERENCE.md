# Class Reference

Every meaningful class in `css/styles.css`, grouped. Utilities and internal layout helpers are listed at the end.

## Shell & layout
| Class | Purpose |
|---|---|
| `.app` | Grid shell: sidebar + main |
| `.sidebar` | Fixed left nav (drawer on mobile) |
| `.main` | Right column (topbar + content) |
| `.topbar` | Page header bar |
| `.tb-titles` `.tt` `.ts` | Topbar title block, title, subtitle |
| `.content` | Scrolling page body (max-width ~1320) |
| `.grid2` | Two-column panel grid |
| `.mov-tables` | Stacked tables wrapper |

## Brand & nav
| Class | Purpose |
|---|---|
| `.brand` `.mark` `.nm` | Brand block, teal square mark, product name (+`<span>` subtitle) |
| `.nav-label` | Uppercase section label |
| `.nav` `.nav-item` (`.on`) `.nav-ic` | Nav list, item button, active state, leading icon |
| `.side-user` `.su-id` `.su-av` `.su-email` | Account footer |
| `.menu-btn` | Mobile hamburger |
| `.nav-backdrop` (`.show`) | Dim behind the mobile drawer |
| `.mob-only` | Elements shown only <=880px |

## Login
| Class | Purpose |
|---|---|
| `.login` `.login-card` | Full-screen gridded backdrop, centred card |
| `.li-h` `.li-sub` | Serif heading, description |
| `.li-lbl` `.li-in` | Field label, input |
| `.li-btn` | Full-width primary sign-in |
| `.li-note` `.li-err` | Quiet footnote, error text |

## Stat cards
| Class | Purpose |
|---|---|
| `.kpis` `.kpi` | Card grid, card |
| `.kpi.good` `.kpi.crit` | Blue rail (positive), vermillion rail+tint (critical) |
| `.k-l` `.k-v` (`.num`) `.k-n` `.k-vs` | Label, value (tabular), note, "vs" delta line |

## Panels & bars
| Class | Purpose |
|---|---|
| `.panel` `h3` `.q` `.take` | Container, serif title, subtitle, "reads as" callout |
| `.brow` `.bl` `.minibar` `.bv` | Horizontal bar row: label, mini bar, value |
| `.compbar` `.comp-seg` `.comp-legend` | Stacked composition bar + legend |
| `.albars` `.albar-row` `.al-l` `.al-track` `.al-seg` `.al-amt` | Aging bar rows |
| `.arow` | Aging row grid (label / bar / amount) |

## Charts
| Class | Purpose |
|---|---|
| `.chartbox` | Scroll wrapper for charts on mobile |
| `.linechart` | Chart SVG (width 100%) |
| `.lc-line` `.lc-area` | Current series line + area fill (accent) |
| `.lc-line2` `.lc-band` | Previous series dashed line + amber band |
| `.lc-dot` `.lc-dot2` `.lc-div` | Point markers, period divider |
| `.lc-x` `.lc-lg` | Axis labels, legend text |
| `.sparkline` `.spark-line` | Inline trend SVG + path |
| `.hdot` | Small coloured header dot in tables |

## Tables
| Class | Purpose |
|---|---|
| `.rtable-wrap` | Scroll container (sticky header/first col, edge shadow) |
| `.rtable` | The table |
| `.r` | Right-align a cell |
| `.strong` | Row key emphasis |
| `.thsort` `.thsort-i` | Sortable header button + arrow (⇅ / ▲ / ▼) |
| `.result-meta` | Filtered-set summary line |
| `.splitbar` `.seg` | Two-part ratio bar (labels on bar) |
| `.pager` `.pg-l` `.pg-btns` `.pg-btn` | Pagination row, summary, controls |

## Filters & controls
| Class | Purpose |
|---|---|
| `.filters` `.fgrp` `.flbl` | Filter row, group, label |
| `.dinput` `.sinput` `.selwrap` | Date input, search input, select wrapper |
| `.rpick` `.rt` | Report switcher tabs |
| `.locbtn` (`.on`) | Segmented tabs (e.g. sites) |
| `.pchip` (`.on`) | Preset pills (Day/Week/...) |
| `.rchip` `.rdot` `.rvs` | Range chips + dot + "VS" |
| `.mcb` `.mcb-lbl` `.mcbctl` | Age-group filter pills + label |
| `.cmp-toggle` (`.on`) | Compare on/off toggle |
| `.period` `.period-ranges` `.period-ctl` `.period-custom` `.cust-grp` `.cust-h` | Period control card + parts |

## Buttons & status
| Class | Purpose |
|---|---|
| `.btn.btn-primary` | Primary teal action |
| `.signout` | Quiet secondary button |
| `.chip.paid` `.chip.unpaid` | Status pills (blue / grey) |
| `.agepill` | Age number + bucket dot |
| `.d-up` `.d-down` `.d-flat` | Delta (bad / good / flat) with ▲▼ |

## Range widget
| Class | Purpose |
|---|---|
| `.rng` `.rng-v` | Row, flanking low/high values |
| `.rng-track` `.rng-fill` `.rng-mark` | Track, fill, donut marker |

## Feedback
| Class | Purpose |
|---|---|
| `.callout` `.ch` | Accent-rail callout + bold lead |
| `.demo-note` | Amber provisional-data note |
| `.foot-note` | Quiet caveat under content |
| `.toast` (`.show`) | Bottom-centre confirmation pill |
| `.chart-tip` (`.show`) | Cursor-following tooltip on `[data-tip]` |

## Utilities / state
`.on` active · `.num` tabular figures · `.r` right-align · `.strong` emphasis · `.muted` `.faint` de-emphasis · `.zero` zero cell (dash) · `.spacer` `.show` `.open` state flags.
