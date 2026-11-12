---
title: "Colour Pairing"
subtitle: "Check any two colours before the pair ships"
description: "Measure a text colour against a background with the WCAG contrast thresholds, from the brand palette, the brand's recommended pairings, or any hex. Reads the live theme."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 5
status: "published"
access: "team"
brand: "internal"
actionUrl: "color-pairing.html"
actionLabel: "Open Tool"
---

The Colour Pairing tool measures a text colour against a background with the Web Content Accessibility Guidelines (WCAG) 2 contrast thresholds. Pick a text colour and a background from the palette, choose one of the brand's recommended pairs, or type any hex. The preview paints the pair in four cells, at every size the checks distinguish; the Contrast section beside it reports the ratio and a Pass or Fail for each check.

To see every colour at once, with its hex and its token, open the [Colour Palette](/tools/color-palette-docs.html).

---

## What it measures

The tool reads the palette from the page it runs on, so a brand that overrides the ramps in its theme sees its own colours, not the engine defaults.

- The nine hues, green, aqua, blue, purple, pink, red, peach, yellow and brown, at every step: `--<hue>-dark`, `--<hue>`, `--<hue>-light`, `--<hue>-lighter`
- `--off-black` and `--off-white`

That is 38 colours. The tools know these nine hue names; a brand retunes their values in its theme, and a hue it adds under a new name is not picked up. The neutral ramp and pure white and black are not in the grids: the off tones are what the brand sets type in, and the whole neutral ramp is on the Colour Palette. The grids leave out a token the brand does not define, and one that carries transparency, because one number would be wrong over most surfaces. A note at the foot of Style counts each cause separately.

Semantic tokens (`--text-primary`, `--background-secondary`, `--status-*`) are not in the set. They change with the theme and some carry transparency, so a single reading would be wrong in one of the two themes.

---

## The preview

Four cells fill the preview with no gap between them, painted in a checkerboard: top left and bottom right are the pair as chosen, text on background, and top right and bottom left are the same pair inverted. Every seam is a change of colour, so no rule divides them. Everything in a cell sits on its vertical centre. Each cell is a specimen for a row of the checks:

| Cell | Shows | Check rows |
|---|---|---|
| Top left | a large title, body copy at 16px, and a button | Large for the title; Normal for the copy and the button's label; Graphics for the button's fill against the cell |
| Top right | one glyph at display size, in the brand's tertiary face, inverted: it steps through & @ ? ! # % * $ every three seconds, and stays on & when the reader asks for reduced motion | Large, with the colours the other way round |
| Bottom left | six icons, inverted | Graphics |
| Bottom right | a paragraph at 20px, about what the ratio measures | Normal |

The ratio is the same whichever colour is the text, because WCAG 2 measures luminance in both directions alike: the inverted cells show the pair used the other way round, not a second result. The specimens are for the eye; a screen reader hears the pair and its verdict from the status line and reads the checks in the Contrast section.

The toggle in the preview's corner, which folds the controls away, is set in the pair while it clears AA 4.5:1, and in off black or off white below that, whichever reads on the cell under it, so a failing pair never hides the way back to the controls; the specimens stay in the pair, because they are what is being judged.

On a wide screen the cells are two by two, the top row the taller. On a phone they stack, in an order that keeps the colours alternating: the title, the ampersand, the paragraph, then the icons.

---

## Choosing a pair

The controls sit in a column on the right: **Contrast**, pinned at the top, then **Style** and **Export**. On a phone they follow the preview down the page.

**Style** opens with **Pairs**, the brand's tool pairs — the same list every tool's Pairs row offers — each drawn as a split circle with the darker colour on the left, whichever of the two is the text. Hovering one names it, text first. Choosing one sets both sides at once, and the chosen pair takes a ring in its darker colour, or its lighter one on the dark theme, where a dark ring would sink into the page. The list is the brand's own `toolPairings`, set in its `brand.json`, or its whole `colorPairings` where it sets none; the first pair is the one the tool opens on, and a brand that sets neither sees a sentence saying so. A brand can list as many pairs as it likes: the chips wrap onto more rows, on the same size and spacing as the grids.

**Foreground** and **Background** hold the palette, a column per hue with the darkest step at the top and the off tones on the row below. Select a colour on either side and the preview follows. The chosen colour carries a ring and a mark: a tick when the pair clears 3:1, a cross when it misses every check. A screen reader hears the same thing in the colour's name. Hovering or arrowing onto a colour shows its name. The grids keep their nine hue columns at every width the column allows; only a phone too narrow for nine chips turns them into four columns, one per step.

Each grid is one tab stop. Arrow keys walk it one hue at a time, darkest first, and the pair follows the colour you land on.

**Swap colours**, the arrows in Style's header, exchanges the pair: what changes is which colour is painted where. **Reset**, in the bar's menu, returns to the default pair and clears any custom colour.

---

## A colour outside the palette

Under each grid, a picker and a hex field always show that side's colour. Drag the picker, or type a hex such as `1F1F1F` or `#1F1F1F` and press Enter or leave the field: the colour becomes that side's custom colour and is chosen. It joins the grid's last row for the rest of the visit, so you can compare it back against the palette, and it travels in the link. It is never saved.

---

## Reading the result

**Contrast** reports the ratio to two decimal places, cut rather than rounded. A pair at 4.499:1 fails AA, and the tool says 4.49:1. The tool compares every number before it shortens it.

Every check is marked Pass or Fail against its real threshold, and the info button beside each check's name opens a short note on what the check covers, in a panel that floats under it. The section stays pinned at the top of the column while Style scrolls under it, so the verdict is in view as you choose:

| Check | Minimum | Applies to |
|---|---|---|
| AA Normal | 4.5:1 | Text under 24px, or under 19px bold |
| AAA Normal | 7:1 | The same text, at the enhanced level |
| AA Large | 3:1 | Text from 24px, or from 19px bold |
| AAA Large | 4.5:1 | The same text, at the enhanced level |
| Graphics | 3:1 | Icons that carry meaning, component boundaries, focus rings |

Graphics has no AAA level in WCAG, so the table has one row for it. Large text is WCAG's 18pt, or 14pt bold. In CSS pixels that is 24px, or 18.66px bold, which the tool rounds up to 19px so the rule errs on the safe side.

Each result is a stamp with a word and a mark, Pass with a tick or Fail with a cross, so the verdict never rests on colour alone.

---

## Sharing a pair

The URL always carries the pair: `color-pairing.html#fg=yellow-lighter&bg=purple`. A custom colour travels as its hex, `#fg=1f1f1f&bg=purple`. **Copy link** in the bar's menu copies it, and opening the link lands on that pair.

Older links still open: `white` and `neutral-50` open as `off-white`, `black` and `neutral-900` as `off-black`, and a `grade` value is ignored. A link naming a token the brand does not define falls back to that side of the default pair, and to the first colour in the palette if that is missing too. So a link written against one brand still opens under another.

The default pair is the brand's first recommended pairing. A brand that recommends none opens on off black text on off white.

---

## Primitives and production

Every colour the tool names is a palette primitive. Primitives are the subject here, because the ramps are what a brand tunes. In production, components take semantic tokens, and the primitive is what the semantic token points at. See [Colour](/foundations/color.html) for the mapping.

**Export** shows the pair as the system spells it, `color: var(--yellow-lighter); background-color: var(--purple);`, and **Copy CSS** under it copies that, for a theme file or an experiment. A custom colour is written as its hex. Do not paste either into a component.

---

## What it does not measure

WCAG 2's contrast ratio is the only enforceable standard today. The tool does not show the Advanced Perceptual Contrast Algorithm (APCA), the candidate method for WCAG 3, because WCAG 3 is still a working draft with no decided contrast method and the APCA licence does not cover commercial use. That is a decision to revisit when either changes.

The tool also does not composite transparency. A colour with an alpha channel reads differently over every surface, and one number would be wrong for most of them.

---

## When nothing can be measured

The tool reads colour values by painting them to a canvas and reading the pixel back. A browser with fingerprinting protection on may refuse that readback, and the tool says so rather than guessing. Open it in another browser, or turn the protection off for this site.

A brand that defines fewer than two palette tokens gets the same treatment: nothing to pair, so the tool says so and names the fix — set the palette in the brand theme, then reload.
