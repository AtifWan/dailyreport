# Components

Each file is a standalone, renderable example that links `../css/styles.css` and uses the real class names from the app. Open any in a browser, or copy the markup. Reuse these classes; do not invent parallel ones.

| File | Component | Key classes |
|---|---|---|
| login.html | Login / entry screen | `.login`, `.login-card`, `.brand`, `.li-h`, `.li-sub`, `.li-btn`, `.li-note`, `.li-lbl`, `.li-in` |
| nav-sidebar.html | Sidebar / drawer | `.sidebar`, `.brand`, `.mark`, `.nm`, `.nav-label`, `.nav-item`, `.nav-ic`, `.side-user` |
| kpi-cards.html | Stat cards | `.kpis`, `.kpi` (+`.good`/`.crit`), `.k-l`, `.k-v .num`, `.k-n`, `.k-vs` |
| panels.html | Content panel + bar rows | `.panel`, `h3`, `.q`, `.take`, `.brow`, `.bl`, `.minibar`, `.bv` |
| charts-bars.html | Charts & bars | `.compbar`/`.comp-seg`/`.comp-legend`, `.albars`/`.albar-row`/`.al-track`/`.al-seg`, `.sparkline`/`.spark-line`, `.linechart`/`.lc-line`/`.lc-line2`/`.lc-area`/`.lc-band`/`.lc-dot`/`.lc-x`/`.lc-lg` |
| data-table.html | Data table | `.rtable-wrap`, `.rtable`, `.r`, `.strong`, `.thsort`, `.thsort-i`, `tfoot` |
| table-extras.html | Summary, split bar, pager | `.result-meta`, `.splitbar`/`.seg`, `.pager`/`.pg-l`/`.pg-btns`/`.pg-btn` |
| filters.html | Filter bar | `.filters`, `.fgrp`, `.flbl`, `.dinput`, `.sinput`, `.selwrap>select` |
| chips-pills.html | Tabs, pills, chips | `.rpick .rt`, `.pchip`, `.rchip`, `.rvs`, `.mcb`, `.mcb-lbl` |
| buttons.html | Buttons | `.btn.btn-primary`, `.locbtn` (+`.on`), `.signout`, `.menu-btn` |
| status-badges.html | Status, age, deltas | `.chip.paid`/`.unpaid`, `.agepill`, `.d-up`/`.d-down`/`.d-flat` |
| range-widget.html | Range low→high | `.rng`, `.rng-v`, `.rng-track`, `.rng-fill`, `.rng-mark` |
| feedback.html | Callouts, toast, tooltip, modal | `.callout`/`.ch`, `.demo-note`, `.foot-note`, `.toast`, `.chart-tip`, modal (composed) |

## Rules of thumb
- **`.on`** marks the active/selected state on tabs, pills, and nav items.
- **Right-align numbers** with `.r` on the cell and `.num` (tabular figures) on the value.
- **Good/bad is blue/vermillion, never green/red**, and always carries a shape cue.
- **Aging** always uses the four Okabe-Ito tokens `--age1..--age4` in order.
- **The modal** has no dedicated class; compose it from `--surface`, `--shadow-pop`, `--radius` over a dimmed backdrop (see feedback.html).

See `../CLASS-REFERENCE.md` for the complete class index.
