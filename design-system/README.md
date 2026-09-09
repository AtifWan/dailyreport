# YourGP Design System

A portable design system extracted from the Finance Intelligence Hub. Its purpose: any Claude (or developer) can load this folder and build a **new** internal tool that looks and behaves identically in theme, colour, typography, components, tables, buttons, icons, filters, and layout.

## What's inside
```
yourgp-design-system/
├── README.md                 <- you are here
├── DESIGN-GUIDELINES.md      <- the brain: principles, tokens, components, states, rules, checklist
├── CLASS-REFERENCE.md        <- every class in the stylesheet, grouped, with its purpose
├── theme/
│   ├── tokens.css            <- the :root design tokens (import this)
│   └── theme.json            <- same tokens as data (OKLCH + hex + type + spacing)
├── css/
│   └── styles.css            <- the complete, authoritative stylesheet (all components)
├── components/               <- standalone, renderable examples with real class names
│   ├── COMPONENTS.md
│   └── *.html
├── icons/                    <- line-icon set (SVG) + ICONS.md
├── fonts/FONTS.md            <- the two typefaces and how to load them
├── favicon/                  <- full favicon set + FAVICON.md
└── examples/starter.html     <- a working app-shell skeleton to build on
```

## How to teach a Claude with this (paste something like this)

> You are building a new internal web tool for me. Follow the YourGP design system in this folder exactly.
> 1. Read `DESIGN-GUIDELINES.md` in full and treat it as binding.
> 2. Link `css/styles.css` (or `theme/tokens.css` if you are writing your own component CSS) and the two Google Fonts from `fonts/FONTS.md`, and wire the favicon per `favicon/FAVICON.md`.
> 3. Start from `examples/starter.html` (app shell: sidebar + topbar + content).
> 4. Build every screen from the components in `components/` using their exact class names. Do not invent parallel styles or hardcode colours; use the tokens.
> 5. Keep the identity: teal accent, serif headings, sans (tabular) numbers, colour-blind-safe blue/vermillion semantics and Okabe-Ito aging colours, calm light surfaces, the two responsive breakpoints, and sentence-case user-facing copy.
> 6. Only the content changes between systems; the look does not.

## Quickest start
Open `examples/starter.html` in a browser to see the shell, then open any file in `components/` to see each piece. Copy markup from there.

## Rebranding for a different product
Change the favicon letter and (optionally) shift the `--accent` hue in `theme/tokens.css`, keeping its lightness/chroma. Leave the semantic (`--live`/`--danger`) and aging (`--age1..4`) tokens unchanged. Everything else carries over.
