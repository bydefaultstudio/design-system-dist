---
title: "Logo Tool"
subtitle: "Export the logo with the rules built in"
description: "Pick a variation, size and approved colour, then download a correctly named SVG, PNG or JPG. The guidelines are the interface."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 2
status: "published"
access: "team"
brand: "internal"
actionUrl: "./logo-tool.html"
actionLabel: "Open Tool"
hue: "aqua"
---

Guidelines are documentation: rules somebody has to read, remember and apply by hand every time they need the logo. This tool inverts that. Minimum size is the floor of the width field, not a paragraph on page twelve. The clear space is drawn round the logo you are looking at, not a diagram on another page. The approved colourways come first, one choice each, and the file is named for the colour it carries.

If the tool exports it, it is on brand.

---

## How to use it

The logo is at the top. Beside it, three sections: **Settings** picks which logo, **Style** how it looks, and **Export** makes the file. The reset buttons in the Settings and Style headers put the variation and the colour back to their defaults, each greyed out until you change it; **Reset all**, in the bar's menu, also resets the width, the format and the preview switches.

1. Pick a **variation** (Settings)
2. Pick a **colour** (Style) — an approved pair, or a foreground and, if the file needs one, a background
3. Choose what to **export as**, and set a **width** — the height follows, locked to the artwork's ratio
4. **Download** or **Copy** — each button names the format it makes

The preview is the file, except for one thing you choose: a background shows behind the logo even when Include background leaves it out of the file. With no background chosen, its ground follows the logo colour — a light ground behind a dark logo, a dark one behind a light logo — so the logo always reads; with one, the preview stands the logo on it. The **Details** in the top-left corner say what the file is — variation, colour and size. The **Preview** group in the top-right corner changes only what you see: **Transparent** shows it with nothing behind it, **Fill screen** draws it as large as the preview allows instead of at the export width, and **Clear space** draws the room it needs. Fill screen is on when the tool opens, so you see the whole drawing first; choosing a width turns it off, and the preview then shows that width. The frame is the artwork at true pixel size, scaled down to fit the screen, and the note at the foot of the preview says which — "Shown at 48%", beside the size in Details — so the preview never quietly misleads you about size or backing.

---

## Variations

Five lockups, drawn from the [Logo guidelines](/foundations/brand-logo.html).

| Variation | Artwork | Notes |
|---|---|---|
| Primary centred | 1050 × 505 | |
| Primary left | 1050 × 505 | |
| Secondary up | 1050 × 555 | Rotated 90° clockwise for vertical placements |
| Secondary down | 1050 × 555 | Rotated 90° anticlockwise |
| Avatar | 40 × 40 | Square mark. Its clear space is its own d-width, 9.80 units |

There are no separate light and dark files. Every fill is normalised to `currentColor` when the tool loads, which turns colour into a control rather than a duplicate file per colourway. That is the whole argument in miniature: the version of the logo you need is a choice, not a download folder.

---

## Size

The width field is the **logo's** width. Type a number, use the steppers, or take one of the presets under it — 150, 300, 600 or 960. A width that matches no preset leaves them all unselected, and a preset under the variation's minimum is disabled.

Below the variation's minimum the field clamps on commit and says why. It clamps when you leave the field, not while you type, so typing `5` on the way to `512` does not snap out from under you.

The ceiling is 4096 px. Past that browsers start failing to rasterise, and a logo that size has no use.

---

## Colour

Colour is in **Style**, on the control every tool uses ([Tool Canvas](/docs/tool-canvas.html#colour)).

- **Pairs** are the brand's approved colourways: each logo colour on the background it was designed for, such as *Off white on black*. One choice sets both. A colourway the brand approves only on some lockups leaves the row on the others. After them come the brand's recommended pairings, the list [Colour Pairing](/tools/color-pairing.html) offers, for a logo set on a coloured ground. Point at a chip to read its name. A pair under 3:1, the WCAG non-text bar for a logo mark, is named low contrast, with its ratio.
- **Foreground** is the logo colour: the brand palette, the picker, or any six-digit hex.
- **Background** is the ground the logo is shown on. It defaults to **None**, the checkerboard chip, which lets the preview pick a light or dark ground for the logo colour.

The line under the colours gives the contrast against the background, and stays empty while there is none.

A background colours the preview; it goes into the file only when **Include background**, in Export, is on — a rectangle behind the SVG, a filled PNG. It is off by default, so *Off white on black* gives an off white logo on a transparent file, previewed on black. The switch is locked under None, with nothing to include, and locked on under JPG, which has no alpha: a JPG always carries the background, or white under None.

**Transparent** lives in the Preview group, so it cannot be mistaken for an export option. On, the preview drops its ground for the checkerboard, whatever the background and the format. It changes nothing in the file.

The preview grounds under None are neutral 50 and neutral 990: they are the preview's, and never reach the file.

---

## Clear space

One d-width on every side, taken from the brand's clear-space rule ([Logo → Clearspace](/foundations/brand-logo.html#clearspace)): the width of the *d* in *default*, measured in the artwork's coordinates. On the four full lockups that is 171.48 units of a 1050-unit drawing; on the Avatar, whose *d* is far smaller, it is 9.80 units of 40. The rule travels by the glyph, not by the number, so the zone is the same proportion of the mark it guards.

**Clear space** in the Preview group draws it round the logo in the logo's own colour: a faint band for the room it needs, with dashed edges at the logo's box and at the room's outer edge. In each side of the band sits the *d* itself, one X wide and turned so its ascender lies along the zone's outer edge, the way the brand's clear-space diagram draws it. It is drawn by the same layer engine as [Layout Specs](/tools/layout-specs-docs.html), as its clear-space zone with a glyph marker, and it reads the brand's `--artwork-logo-clear-space` token, in X: change the token and the frame and the zone both move. It is a usage guide, not part of the file — the export is the logo alone, at the size you set.

---

## Format

| Format | Background | Notes |
|---|---|---|
| SVG | Transparent, or the background as a rectangle with Include background on | Vector. Colours are written as hex, so the file renders correctly in Finder, in an `<img>`, anywhere |
| PNG | Transparent, or the background with Include background on | Rasterised at the exact export pixels |
| JPG | The chosen background, or white under None | No alpha, so the background is flattened in |

Format lives in the **Export** section with Include background, the width, the file name and Flatten — everything that defines the file, above the two buttons that make it. The width is here because it only scales the file: the logo looks the same at any width. Settings and Style hold what defines the logo: the variation, and the colour. The buttons name the format: *Download SVG*, *Copy SVG*. JPG copies **as PNG**, because the clipboard has no JPEG type; the pixels are the same, background included.

**Flatten** applies to SVG only. It merges every letter path into one, which is what most workflows want from a downloaded logo. It is a merge, not a geometry operation: counters and holes survive because they are already subpaths. Where artwork mixes fill rules the option refuses rather than silently corrupting the shape.

---

## Filenames

The tool names the file:

```
logo_<brand>_<variant>_<colour>_<file-width>.<ext>
logo_bydefault_primary-centered_off-black_400.svg
logo_bydefault_primary-centered_off-white-on-black_400.png
```

The colour is the foreground's name, then `-on-` and the background's when the file includes it. A name comes from the manifest where the hex is one of its colours, then from the palette, then `hex-<hex>` for a colour picked by hand, so the name gives the value to paste into a design tool. JPG's white under None is not named: it is what every JPG has.

The width in the name is the file's width, which is the logo's — the clear space never reaches the file — so the number in the name always matches what a design tool measures. The name is shown in the Export panel before you export. Nobody ships `logo-final-v2 (1).png` again.

---

## Still placeholder

Two values in the manifest are not brand decisions yet. They are flagged here rather than left to look official:

- **Minimum sizes** — a variation with no minimum carries 120 px until the brand sets its own. The enforcement is real; the number is the engine's.
- **Colourways** — the Pairs row is seeded from the brand's tool pairs until it lists approved logo colourways.
The clear space is the real rule on every variation: the lockups' from the brand's diagram, the Avatar's measured from its own *d* the same way.

---

## Adding another brand

The tool renders a manifest. It holds no artwork, sizes or colours of its own, so a second brand needs no code change.

`assets/js/logo-manifest.js` declares `window.LogoManifest`:

```js
window.LogoManifest = {
  brand: { id: "acme", name: "Acme" },
  variants: [
    {
      id: "primary",
      label: "Primary centred",
      shortLabel: "Centred",   // optional, the chip's text; omitted = label
      minWidth: 160,
      clearSpace: { units: 171.48, label: "d-width" },   // X: the glyph the clear space is measured in
      rotate: 90,              // optional, ±90 for vertical placements
      markup: '<svg viewBox="0 0 1050 505" …>…</svg>'
    }
  ],
  colours: [
    { id: "ink", label: "Ink", value: "#1F1F1F", bg: { id: "white", value: "#FFFFFF" } }
  ]
};
```

Notes on the shape:

- `label` is the full name the notes use ("At least 120 px for the Primary centred logo"); `shortLabel` is what the Variation chip shows, since the caption already says Variation.
- `markup` is **inlined**, not a path. Raster export goes through a canvas, and a string the page owns can never taint it the way a fetched file can.
- `clearSpace.units` is **X**: the width of the glyph the rule is measured in, in the artwork's viewBox units, not pixels; `label` names that glyph. How many X the clear space is lives in one place, the `--artwork-logo-clear-space` brand token (`design-system.css` §1, set in a brand's `theme.css`), so the manifest never carries a multiple that could disagree with it. Set `clearSpace` to `null` where the brand has no rule and the toggle disables itself.
- `clearSpaceGlyph` (top level, required wherever a `clearSpace` is set) is X's own glyph as SVG markup, its viewBox the glyph's own box so its width is X. The Clear space switch and any clear-space zone with a glyph marker draw it in the band. It is copied verbatim from the primary lockup's path.
- `value` and `bg.value` are six-digit hex, not tokens. They end up inside an exported file, which cannot resolve a custom property.
- `variants` on a colour is an optional allow-list, for a colour approved on some lockups but not others.

### Every hub defines its clear space

A hub's logos are not finished until their clear space is, and since engine parity phase 0 the build fails until it is. The manifest is generated from `brand.json`, where three things are required:

- **X on every mark, measured, never typed.** Each variant's `clearSpace.paths` names the glyph's paths in its file, numbered from 1 in the order the file draws them. The build measures their width in that logo's viewBox (`cms/generator/svg-measure.js`, exact for curves) and writes it as `clearSpace.units`. A letter drawn as one path is one number; a letter drawn as two, such as a B with a separate counter, is two. The primary's measured X must equal the glyph's width.
- **The rule, as a Layout Spec.** `logos.spec` is the clear-space rule built in [Layout Specs](/tools/layout-specs-docs.html), drawn round every logo that has no spec of its own. Left out, every logo gets the plain ring at `--artwork-logo-clear-space` X. A logo whose rule is a placement (an avatar on a circle) carries its own `spec`.
- **The graphic for X.** `clearSpaceGlyph` is the shape X is measured from, so a reader sees the unit rather than a number. Its viewBox is the glyph's **whole** box, so the glyph's width is exactly X and the marker sits inside the band. A viewBox cropped tighter than the glyph draws it larger than X and spills over the zone (a letter cropped to half its height overlaps the band, and the rule reads as the letter's width).

The Brand Book draws the same thing with `{{logo-spec:<id>}}` ([Logo Spec Figure](/components/logo-spec.html)), so a guide's clear-space figure can never disagree with this tool.

### One manifest, and that is now the design

This used to be recorded as a limitation: brand instances linked to this tool page and it loaded one global manifest, so every brand saw the same logos. **Since 2026-09-18 that is correct rather than limiting** — the engine is single-brand, one deployment per company, so one manifest per deployment is the right shape. The email signature reads a single top-level block for the same reason. A different brand means a different deployment with its own manifest.

Since engine parity phase 0 the manifest is generated from the deployment's `brand.json` (`logos`), with each logo's SVG inlined, and the build fails when a mark has no clear space. Nobody hand-keeps `logo-manifest.js` any more.
