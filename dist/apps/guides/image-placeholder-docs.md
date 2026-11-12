---
title: "Image Placeholder"
subtitle: "Placeholder images, served from a URL."
description: "A URL-based SVG placeholder image generator. Set custom dimensions, colours, and text for rapid prototyping."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 11
status: "published"
access: "team"
brand: "internal"
actionUrl: "image-placeholder.html"
actionLabel: "Open Tool"
---

The Image Placeholder tool generates SVG placeholder images on the fly via URL parameters. Change the URL to change the image, no image libraries required. The default image carries the brand logo; text and colour are opt-in.

---

## URL Schema

```
/image/[width]x[height]
/image/[width]
/image/[width]x[height]/[bgColor]
/image/[width]x[height]/[bgColor]/[fgColor]
/image/[width]x[height]/[bgColor]/[fgColor]?text=Hello+World
/image/[width]x[height]?logo=0
```

---

## Size

- `600x400`: width 600, height 400
- `400`: 400 × 400 square (height defaults to width)
- Minimum: 10 × 10 px
- Maximum: 4000 × 4000 px (values outside range are clamped silently)

---

## Logo

The brand logo is drawn in the text colour, centred, at a quarter of the image width — capped at 18% of the height, so a wide banner keeps a small mark. Images narrower than about 66 px or shorter than about 43 px are too small for it and render without.

- `?logo=0`: no logo (`false`, `no` and `off` also work)
- Any other value, or no `logo` param: the logo is shown

---

## Colour

Colours are specified without `#` in the URL path.

| Format | Example | Notes |
|---|---|---|
| 6-digit hex | `ff0000` | Standard hex colour |
| 3-digit hex | `f00` | Expanded to `ff0000` internally |
| CSS name | `orange`, `white` | Full W3C CSS Color 3 list |
| Keyword | `transparent` | Renders a checkerboard pattern |

- Default background: `e5e5e5`
- Default text colour: `5c5c5c` — the logo takes it too
- Invalid values fall back to defaults silently
- A `transparent` text colour draws the text and logo black

In the tool, the size, the logo switch and the text are in the **Settings** section, the URL is the readout in **Export**, and **Copy image URL** and **Open image** sit at the foot of the panel. Colour is in the **Style** section, on the control every tool uses ([Tool Canvas](/docs/tool-canvas.html#colour)). **Pairs** sets both colours at once: **Default**, then the presets — `--green-lighter` with `--green`, and so on (peach takes `--peach-light`) — then the brand's recommended pairings, the list [Colour Pairing](/tools/color-pairing.html) offers. Point at a chip to read its name. **Foreground** is the text and logo colour, and **Background** is the fill. Each takes a palette chip, the picker or six hex digits; the tool's fields do not accept CSS names or three-digit hex, although the URL still does. **None**, first in Background, writes `transparent` into the URL. Whatever is chosen is written into the URL as hex, so a URL never depends on the brand's token values: `/image/600x400/dbf7cc/167255`. The line under the colours gives the pair's contrast against 3:1.

---

## Text

- No `text` param: no text, the logo alone
- `?text=` with no value: the dimensions, e.g. `600 × 400`
- `?text=Hello+World`: spaces via `+`
- `?text=Hello\nWorld`: literal `\n` in URL creates a line break
- Text sits under the logo when both are shown, and is centred alone with `?logo=0`
- All text is HTML-escaped before embedding in the SVG, and cut at 100 characters

---

## Examples

```html
<!-- Basic: the logo on the default grey -->
<img src="{{brand:url}}/image/800x400" alt="">

<!-- Square -->
<img src="{{brand:url}}/image/400" alt="">

<!-- Logo and the dimensions -->
<img src="{{brand:url}}/image/800x400?text=" alt="">

<!-- The dimensions alone -->
<img src="{{brand:url}}/image/800x400?logo=0&text=" alt="">

<!-- A brand preset, written as hex -->
<img src="{{brand:url}}/image/600x400/dbf7cc/167255" alt="">

<!-- CSS colour names -->
<img src="{{brand:url}}/image/600x400/orange/white" alt="">

<!-- Transparent background -->
<img src="{{brand:url}}/image/600x400/transparent/333333" alt="">

<!-- Multi-line label, no logo -->
<img src="{{brand:url}}/image/600x400?logo=0&text=Hero\nSection" alt="">
```
