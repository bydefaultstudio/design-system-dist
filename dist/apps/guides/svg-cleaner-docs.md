---
title: "SVG Cleaner"
subtitle: "Prepare SVGs for the design system"
description: "Paste raw SVG code and get a cleaned, optimised version ready for the design system."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 8
status: "published"
access: "team"
brand: "internal"
actionUrl: "./svg-cleaner.html"
actionLabel: "Open Tool"
---

Paste raw SVG code and get a cleaned, optimised version ready for the design system. Strips namespaces, normalises fills, sets responsive sizing, and minifies output.

---

## What It Does (Always)

- Strips `xmlns` and `xmlns:xlink` from the root `<svg>` element
- Strips script execution vectors — `<script>` blocks, event handler attributes, `javascript:` links and `<foreignObject>`. Declarative animation (CSS keyframes, SMIL) is preserved. The CLI can opt out with `--no-sanitise` for trusted, deliberately scripted SVGs.

---

## Modes

The cleaner has three mutually exclusive modes. Each locks the relevant options automatically.

### Logo

Wraps the SVG in a `<div class="svg-logo">` container with an `aspect-ratio` derived from the original dimensions. The logo name is added as a `data-logo` attribute on the `<svg>` element for semantic identification, matching how icons use `data-icon`.

Locks on: **Size 100%**, **currentColor**, **Strip Comments**

```html
<div class="svg-logo" style="aspect-ratio: 200 / 50">
  <svg data-logo="brand" viewBox="0 0 200 50" width="100%" height="100%">
    <path d="M10 10h80v30H10z" fill="currentColor"/>
  </svg>
</div>
```

### Icon

Wraps the SVG in a `<div class="svg-icn">` container. The icon name is added as a `data-icon` attribute on the `<svg>` element. See the [Iconography docs](/foundations/iconography.html) for full icon guidelines.

Locks on: **Size 100%**, **currentColor**, **Strip Comments**

```html
<span class="svg-icn">
  <svg data-icon="arrow-right" viewBox="0 0 24 24" width="100%" height="100%">
    <path d="M14.4679 14.7071C15.0979 14.0771 14.6517 13 13.7608 13H4V11H13.7608C14.6517 11 15.0979 9.92286 14.4679 9.29289L10.575 5.4L12 4L20 12L12 20L10.575 18.6L14.4679 14.7071Z" fill="currentColor"/>
  </svg>
</span>
```

### Image File

Exports the SVG as a downloadable `.svg` file with `xmlns` and XML declaration re-added. Use this when the SVG will be loaded via `<img>` tags or CSS `background-image`.

Locks off: **Icon**, **Logo**, **currentColor**, **Size 100%**

---

## Optional Flags

| Flag | Effect |
|------|--------|
| `var(--current-color)` | Sets all `<path>` fill attributes to `currentColor` |
| `var(--size)` | Removes width/height, adds `width="100%" height="100%"` |
| `var(--standalone)` | Re-adds `xmlns` and XML declaration for standalone `.svg` files |
| `var(--strip-comments)` | Removes XML/HTML comments |
| `var(--strip-metadata)` | Removes `data-*` attributes and editor class names |
| `--precision N` | Rounds decimal values to N decimal places |
| `var(--minify)` | Collapses whitespace and optimises path data |
| `var(--logo)` | Wraps in `<div class="svg-logo">` with `data-logo` on SVG |
| `--logo-name NAME` | Sets the `data-logo` attribute value |
| `var(--icon)` | Wraps in `<div class="svg-icn">` |
| `--icon-name NAME` | Sets the `data-icon` attribute on SVG |

---

## Browser UI

Open the SVG Cleaner tool in your browser to use the visual paste-and-copy workflow:

1. Paste your raw SVG code into **Settings**. The drawing appears in the preview as you type, with the bytes it saved in the preview's Details corner, and the cleaned code in **Export** under Result.
2. Pick a **Format** under the code — **SVG** is the plain clean with the options as set; **Icon**, **Logo**, **Image** and **CSS** each lock the options they decide, and the hint under the options says which. Icon and Logo ask for a name, Image for a file name and CSS for its shape, each right under the format. Then set the options that are still free.
3. **Copy SVG** (or **Copy CSS**) at the foot of the panel. In Image format **Download SVG** sits beside it and writes the standalone `.svg` file.

The Preview switches in the band's corner change what the band shows and nothing in the result: **Transparent** puts the checkerboard behind the drawing, **Fill screen** draws it as large as the band allows instead of at its own size (its width, or its viewBox's), and **Artboard** outlines the SVG's own box as a dotted line, so you can see how much of it the drawing fills. The note at the foot of the band says the scale it is shown at.

The Settings reset puts the format back to SVG and the options to their defaults without touching the paste or the names; **Reset all** in the ⋯ menu clears everything, the Preview switches included.

---

## CLI Usage

The same engine is available from the command line via the `@bydefaultstudio/svg-cleaner` package, installed in this repo as a devDependency:

```bash
# Icon
npx svg-cleaner --icon --icon-name arrow-right --current-color --strip-comments <<'SVGEOF'
<svg>...pasted code...</svg>
SVGEOF

# Logo
npx svg-cleaner --logo --logo-name brand --current-color --strip-comments <<'SVGEOF'
<svg>...pasted code...</svg>
SVGEOF

# Image file
npx svg-cleaner --standalone --strip-comments -o assets/images/logos/bydefault/logo_bydefault-primary.svg <<'SVGEOF'
<svg>...pasted code...</svg>
SVGEOF
```

Use heredoc syntax (`<<'SVGEOF'`) to avoid shell escaping issues with quotes in SVG attributes.

---

## File Locations

| Location | Use for |
|---|---|
| `assets/icons/` | Favicons and app icons |
| `assets/images/logos/` | Site and publication logos |
| `assets/images/og/` | Open Graph social sharing images |
| `assets/images/illustrations/` | Decorative and UI illustrations |
| `assets/images/svg-icons/` | SVG component icons |
