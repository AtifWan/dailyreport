# Typography

Two families, loaded from Google Fonts.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
```

## Fraunces (display serif)
- **Use:** section headings (`h1`, `h3`), page titles, the report title. Characterful, used with restraint.
- **Weights:** 400 / 500 / 600. Optical sizing `opsz 9..144`.
- **Do NOT** use Fraunces for data: stat-card numbers and table figures are sans, because the serif is harder to read at a glance (a decision made for older finance/admin users).

## Hanken Grotesk (body + numbers)
- **Use:** all body text, labels, buttons, filters, AND the big stat-card numbers (700 weight).
- **Weights:** 400 / 500 / 600 / 700.

## Numerals
- All figures and tables use `font-variant-numeric: tabular-nums` so columns align.

## Fallbacks
`"Fraunces", Georgia, serif` and `"Hanken Grotesk", system-ui, -apple-system, sans-serif`.
