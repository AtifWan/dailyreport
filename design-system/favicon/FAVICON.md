# Favicon

The brand mark is a teal (`#008C99`, the accent) rounded square with a white letter, matching the in-app `.mark`. The letter is swappable per product (here "Y" for YourGP).

## Files
- `favicon.svg` - scalable, preferred by modern browsers. Letter drawn as a stroked path (no font dependency).
- `favicon.ico` - multi-size (16/32/48) for legacy.
- `favicon-16.png`, `favicon-32.png`, `favicon-192.png`, `favicon-512.png`
- `apple-touch-icon.png` (180x180)
- `site.webmanifest`

## Wire-up (in <head>)
```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#008C99">
```

## To rebrand
Change the fill to the new accent and swap the letter in `favicon.svg`, then re-export the PNGs/ICO at 16/32/180/192/512.
