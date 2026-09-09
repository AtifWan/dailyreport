# Icons

Line icons only. One consistent construction so any new icon looks native:

- `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`
- `stroke-width` 1.9 to 2.2 (nav 1.9, utility 2, emphasis 2.4), `stroke-linecap="round"`, `stroke-linejoin="round"`
- Rendered at ~18-20px. Colour comes from `currentColor`, so the icon inherits text colour (teal when active, ink otherwise).

Do **not** use filled/duotone icon sets, emoji, or multi-colour icons. If you need a new icon, draw it in this same line style.

| File | Use |
|---|---|
| nav-overview.svg | Overview (bar chart) |
| nav-movement.svg | Movement (trend line) |
| nav-matrix.svg | Category matrix (2x2 grid) |
| nav-invoice.svg | Invoice list (document) |
| menu.svg | Mobile hamburger |
| download.svg | Export / download |
| search.svg | Search inputs |
| check.svg | Success / confirmation |

In the app these are inlined as `<svg class="nav-ic">...</svg>` so they can be coloured by state. Inline rather than `<img>` when you need the icon to follow `currentColor`.
