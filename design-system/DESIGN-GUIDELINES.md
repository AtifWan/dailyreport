# YourGP Design System - Guidelines

The single reference for building any new internal tool so it looks and behaves like the Finance Intelligence Hub. Load this file plus `theme/tokens.css` (or `theme/theme.json`) and reuse the components in `components/`. Do not reinvent tokens, class names, or patterns; extend them.

If one sentence: **calm, data-dense, professional light UI with a teal brand accent, a serif display face paired with a clean sans, colour-blind-safe semantics, and generous but disciplined spacing.**

---

## 1. Design principles

1. **Data is the hero, not decoration.** Screens are dashboards for finance and admin users. Lead with the numbers and the structure that makes them legible. No hero gradients, no marketing flourishes.
2. **Quiet surface, one accent.** Near-white backgrounds, hairline borders, soft shadows. Teal is the only brand colour and it is used sparingly (active state, primary action, brand mark).
3. **Legibility over style, always.** Serif for character in headings; sans for anything a user has to read fast, including all numbers. Contrast and size are tuned for older users.
4. **Colour is never the only signal.** Every good/bad or category cue is paired with a shape, label, or position, so it survives colour blindness and greyscale.
5. **Consistency is the system.** The same card, table, filter, and pill everywhere. A user learns the vocabulary once.

---

## 2. Colour tokens

Authored in OKLCH (source of truth), with sRGB hex for reference. Use the CSS variables, not raw values.

### Surfaces & text
| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `--bg` | 98.5% 0.006 200 | #F6FBFC | App background |
| `--surface` | 100% 0 0 | #FFFFFF | Cards, panels, inputs |
| `--surface-sunk` | 97% 0.006 200 | #F1F6F7 | Recessed areas, tracks, zebra |
| `--ink` | 26% 0.02 220 | #19262B | Primary text, headings, values |
| `--ink-muted` | 41% 0.016 220 | #414D50 | Secondary text, labels |
| `--ink-faint` | 49% 0.014 220 | #586266 | Tertiary text, captions (still AA) |
| `--hairline` | 91% 0.008 200 | #DBE3E3 | Default borders |
| `--hairline-strong` | 83% 0.012 200 | #BFCACA | Input outlines, stronger dividers |

### Brand & semantic
| Token | Hex | Use |
|---|---|---|
| `--accent` | #008C99 | BRAND teal. Active state, primary buttons, links, brand mark. |
| `--accent-strong` | #007583 | Accent hover/pressed. |
| `--accent-2` | #11846E | Secondary teal-green. |
| `--live` / `--live-ink` | #006CB4 / #00569F | SEMANTIC GOOD = blue. Positive delta, paid, "good" KPI. NEVER green. |
| `--danger` / `--danger-ink` | #DD5400 / #B03000 | SEMANTIC BAD = vermillion. Negative delta, critical KPI, alerts. NEVER pure red. |
| `--infer` | #D98B09 | Amber. "Previous period" / inferred / comparison. |
| `--manual` | #7D8792 | Neutral grey. Unpaid, inactive, disabled. |

### Aging palette (Okabe-Ito, colour-blind-safe, always in order)
| Token | Hex | Bucket |
|---|---|---|
| `--age1` | #56B4E9 | Current (0-30) - sky blue |
| `--age2` | #009E73 | 31-60 - bluish green |
| `--age3` | #E69F00 | 61-90 - orange |
| `--age4` | #D55E00 | 91+ - vermillion |

**Rule:** good = blue (`--live`), bad = vermillion (`--danger`). Do not use a green-vs-red pair anywhere as the sole distinction. For any categorical sequence, prefer the Okabe-Ito age tokens.

---

## 3. Typography

Two families (see `fonts/FONTS.md` for the load link).

- **Fraunces** (display serif, weights 400/500/600, optical sizing): section headings, page titles. Characterful, used with restraint.
- **Hanken Grotesk** (sans, weights 400-700): body, labels, buttons, filters, and **the stat-card numbers** (700). Numbers are deliberately sans for legibility, never the serif.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on all figures and tables.

Type scale in use: page title ~20px serif; panel heading (`h3`) ~15-16px serif; stat value ~24-31px sans 700; body ~14-15px; labels/captions ~12.5-14px (uppercase tracked for `.k-l`, `.flbl`, `.nav-label`). Nothing readable sits below ~12.5px.

---

## 4. Shape, spacing, elevation

- **Radius:** cards/panels `--radius` 14px; inputs/small `--radius-sm` 9px; pills 999px.
- **Shadow:** `--shadow` for resting cards; `--shadow-pop` for overlays/drawer/login.
- **Borders:** 1px `--hairline` default, `--hairline-strong` for inputs.
- **Spacing:** panels pad 18-20px; card grid gap 14px; content padding 16-24px. Generous but not loose. Group related controls; separate sections with whitespace, not heavy rules.

---

## 5. Layout

- **App shell:** fixed left `.sidebar` (`--sidebar-w` 256px) + `.main` (`.topbar` + scrolling `.content`, max-width ~1320px).
- **Sidebar:** brand mark + product name, a section label, a flat nav of `.nav-item`s, a pinned account/sign-out footer.
- **Topbar:** page title (serif) + subtitle. On mobile it also carries the hamburger and sign-out.
- **Content:** stat cards row (`.kpis`), then `.panel`s (single or `.grid2` two-up), then tables.

---

## 6. Components

Full renderable examples with exact markup are in `components/` (see `components/COMPONENTS.md`). Summary:

- **Stat cards** `.kpi` in a `.kpis` grid. Label `.k-l`, value `.k-v.num`, note `.k-n`, optional delta line `.k-vs`. Modifiers `.good` (blue left rail) and `.crit` (vermillion rail + tint).
- **Panel** `.panel`: serif `h3`, `.q` subtitle, content, optional `.take` "reads as" callout.
- **Data table** `.rtable-wrap > table.rtable`: sticky header and first column, horizontal scroll with a right-edge shadow on mobile, `.r` right-aligns numeric cells, `.strong` for the row key, sortable headers use `button.thsort` with a `.thsort-i` arrow (⇅ idle, ▲/▼ active), `tfoot` for totals.
- **Buttons:** primary `.btn.btn-primary` (teal, optional leading line icon); segmented tabs `.locbtn` (`.on` active); quiet `.signout`; icon button `.menu-btn`.
- **Filters** `.filters`: each control is a `.fgrp` with a `.flbl` label and a `.dinput` (date), `.sinput` (search), or `.selwrap>select`. Reflows to a 2-column grid on mobile.
- **Chips/pills/tabs:** report tabs `.rpick .rt`; preset pills `.pchip`; range chips `.rchip` with `.rvs` "VS"; filter pills `.mcb` with `.mcb-lbl`. Active = `.on`.
- **Status & deltas:** `.chip.paid` / `.chip.unpaid`; age `.agepill` with a bucket-coloured dot; deltas `.d-up` (bad), `.d-down` (good), `.d-flat`, always with a ▲▼ shape cue.
- **Range widget** `.rng`: low value, `.rng-track` with `.rng-fill` and donut `.rng-mark`, high value.
- **Bars:** horizontal `.brow` (label / `.minibar` / value); composition/stacked bars use the age tokens; aging-by-row uses `.albar-row` / `.al-track`.
- **Tooltip** `.chart-tip`: dark pill that follows the cursor on any `[data-tip]` element.

---

## 7. Accessibility (non-negotiable)

1. **Colour-blind-safe:** good = blue, bad = vermillion; categorical = Okabe-Ito. Never rely on green-vs-red.
2. **Shape cues everywhere:** delta arrows (▲▼), dashed line for "previous period", coloured dots on age pills, left rails on good/crit cards. The meaning must survive greyscale.
3. **Contrast:** secondary text tokens are tuned to stay readable (AA) on white. Do not lighten text below `--ink-faint`.
4. **Type size:** nothing meaningful below ~12.5px; stat numbers are large and sans.
5. **Focus & motion:** visible keyboard focus; respect `prefers-reduced-motion`.

---

## 8. Responsive

- **> 880px:** sidebar + content side by side.
- **<= 880px:** sidebar becomes a slide-in drawer opened by the `.menu-btn` hamburger (brand and sign-out live in the drawer); a top bar shows the mark, title, and sign-out; stat cards go 2-up; filters become a 2-column grid; the custom date range and range chips stack; wide tables scroll horizontally with a pinned first column and a right-edge scroll shadow.
- **<= 520px:** stat cards and filters go single column.

Never let the page scroll horizontally as a whole; only tables and charts scroll inside their own containers.

---

## 9. Icons & favicon

- **Icons:** line only, `viewBox 0 0 24 24`, `stroke=currentColor`, width 1.9-2.2, round caps/joins, ~18-20px, inlined so they follow state colour. See `icons/ICONS.md`. No filled/duotone sets, no emoji.
- **Favicon:** teal rounded-square mark with a white letter; full set in `favicon/` (see `favicon/FAVICON.md`). Rebrand by changing the accent fill and the letter.

---

## 10. Writing / copy

- Sentence case, plain verbs, no filler. Name things by what the user controls ("Sign out", "Download Excel"), not by system internals.
- A control says what happens ("Sign out", not "Log off"); keep the same word through the flow.
- Empty and error states give direction, not apology or mood. "No invoices match these filters" beats "Sorry, nothing here".
- Short "reads as" takeaways under a chart are welcome; they explain the number in one plain sentence.

---

## 7b. States & modes

- **Light mode only** by intent; there is no dark theme. Do not add one unless asked.
- **Hover:** primary buttons brighten slightly; tabs/pills and nav items shift toward the accent; table sort headers reveal the accent.
- **Active/selected:** the `.on` class (accent fill or accent text + rule). One selected item per group.
- **Focus:** keep a visible focus ring for keyboard users; never remove outlines without a replacement.
- **Disabled:** reduce to `--manual` grey, drop shadows/hover, keep the label readable.
- **Empty/error:** use `.result-meta` copy or a `.callout`; say what to do next, in plain words, not an apology.

## 11. Applying this to a NEW system (checklist)

When asked to build a different internal tool, keep the identity and swap the content:

- [ ] Load `theme/tokens.css`, the two fonts, and the favicon links.
- [ ] Use the app shell: sidebar (brand mark + product name + flat nav + account footer) + topbar + content.
- [ ] Rebrand the mark letter and, only if the client needs it, shift the accent hue; keep the same lightness/chroma feel and keep the semantic blue/vermillion and age tokens unchanged.
- [ ] Build screens from the existing components (cards, panels, tables, filters, chips, buttons). Do not introduce new component styles unless the content truly needs one; if you do, match the token system and the class-naming style.
- [ ] Keep numbers sans and tabular; keep headings serif.
- [ ] Apply the accessibility rules and the two responsive breakpoints.
- [ ] Copy in sentence case, active voice, user-facing vocabulary.

## Do / Don't
- DO reuse tokens and class names. DON'T hardcode hex or invent parallel classes.
- DO keep one accent. DON'T add a second brand colour.
- DO pair colour with shape. DON'T signal with colour alone, and never green-vs-red.
- DO use serif for headings, sans for numbers. DON'T set data in the serif.
- DO let tables/charts scroll in their containers. DON'T let the page scroll sideways.
- DO keep surfaces calm. DON'T add gradients, glows, or decorative flourishes.
