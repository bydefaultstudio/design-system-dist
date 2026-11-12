---
title: "Colour Palette"
subtitle: "Every brand colour, with its hex and its token"
description: "The brand palette at full size, read from the live theme: the nine hues at four steps, the off tones and the neutral ramp, each one click from its hex or its token."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 6
status: "published"
access: "team"
brand: "internal"
actionUrl: "color-palette.html"
actionLabel: "Open Tool"
---

The Colour Palette shows every colour in the brand palette at full size, edge to edge, with its name and its hex. Each colour copies as a hex value or as its token.

To check two of these colours against each other, open [Colour Pairing](/tools/color-pairing-docs.html).

---

## What it shows

The tool reads the palette from the page it runs on, so a brand that overrides the ramps in its theme sees its own colours, and the hex under each name is the value the theme actually resolves to, not a copy that can drift.

- **The hues.** Green, aqua, blue, purple, pink, red, peach, yellow and brown, a column each, at four steps from the top: `--<hue>-dark`, `--<hue>`, `--<hue>-light`, `--<hue>-lighter`
- **The off tones.** `--off-black` and `--off-white`, the colours the brand sets type in
- **The neutrals.** The full ramp, `--neutral-50` to `--neutral-990`, labelled by step

Each tile's text is set in the far end of its own hue — the lightest step on a dark tile, the darkest on a light one — when that clears AA 4.5:1 against the tile. When it does not, and on the off tones and neutrals, the text is off black or off white, whichever measures higher.

On a window at least 1025 by 760 the whole palette fits on screen: the six rows share the height under the header and the bar, and grow with the window. Shorter or narrower, the tiles keep a fixed height and the page scrolls.

A token the brand does not define is left out, its cell left empty, and a footnote counts how many. The tool knows the nine hue names above; a brand retunes their values in its theme, and a hue added under a new name is not picked up.

---

## Three views

The control in the bar picks how much of the palette is on screen.

- **All.** Every hue at every step, the off tones and the neutral ramp, as above
- **Primary.** Every hue at its base step, then off white and off black
- **Tints & Shades.** Every hue at its four steps, the same grid as All, with the rows taking the whole window
- **Neutrals.** The neutral ramp on its own, `--neutral-50` to `--neutral-990`

In Primary the hues are columns side by side, and the two off tones split a band beneath them that takes a fifth of the height. On a phone every colour stacks full width. In Neutrals every step is a band the full width of the page, stacked lightest to darkest on every screen, and the bands share the window's height. The view is kept in the address, so **Copy link** shares the view on screen.

Every view reads the palette from the theme, so a brand's own colours show in each. In Primary and Neutrals the copy actions sit in the middle of each tile.

---

## Copying a colour

Point at a tile, or tab to it, and two actions appear at its foot:

- **Hex** copies the value, e.g. `#003E37`
- **CSS** copies the token, e.g. `var(--green-dark)`

On a touch screen both are always showing. The label changes to Copied for a moment, and a screen reader hears the same.

---

## Primitives and production

Every colour here is a palette primitive, the layer a brand tunes. In production, components take semantic tokens, which point at these. Reach for the primitive in a theme file or an experiment; reach for the semantic token in a component. See [Colour](/foundations/color.html) for the mapping.

---

## When the hex is missing

The tool reads each value by painting it to a canvas and reading the pixel back. A browser with fingerprinting protection on may refuse that readback. The tiles still paint and **CSS** still copies the token, but the hex and its copy action are hidden, and a line under the bar says why. Open the page in another browser, or turn the protection off for this site, to see them.
