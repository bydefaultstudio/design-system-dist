---
title: "Icon Library"
subtitle: "The whole set, in brand colours, at the size you need"
description: "How the Icon Library works: search and the Brand Book's categories, palette swatches, export sizes, and what each of the five export formats gives you."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 3
status: "published"
access: "team"
brand: "internal"
actionUrl: "./icon-library.html"
actionLabel: "Open Tool"
---

The icon set lives as a directory of SVG files and a set of tables in the Brand Book. Neither hands you a coloured, sized file. This tool does: search it, filter it by the Brand Book's categories, pick an icon, set its colour and size, and take it in the form the job needs.

If the tool exports it, it is the brand's icon.

---

## How to use it

1. **Search** by name, or pick a **category** from the chips under the search
2. **Select** an icon in the Icons panel; the preview at the top shows it
3. Pick a **colour** from the palette in the Style section, or type a hex under it
4. Set an **export size** in pixels, from 16 to 512, in the Export section beside the format — type it, step it, or take a preset: 16, 24, 32 or 48
5. Choose the format in the Export section, then **Download** or **Copy** under it

The page opens with the first icon selected, or the one a link names with `?icon=arrow-up`, so the preview is never empty. Selecting an icon writes it into the address, so **Copy link** in the bar's menu hands someone the icon you are looking at. The tiles are the drawings alone. Hover one, or select it, to read its name; the preview's Details name it and the search matches it either way.

On a large screen the settings sit in a column on the right, with Download and Copy at its foot, and the icons fill the space under the preview and scroll on their own, so the icon you picked four hundred rows down is still in view above. The button in the preview's bottom-right corner folds the icons away to their header so the preview takes the height, and brings them back. On a smaller screen the page scrolls, with the settings before the icons, and the bar stays docked at the top. The search and category stay put over the icons while the grid scrolls.

From the search field, one Tab reaches the grid. The arrow keys move between icons and select as they go, so the preview follows them; Home and End jump to the first and last. After a click, the arrows carry on from the icon you clicked. Enter moves focus to the icon's name in the preview's Details corner, and the settings are the next Tab. Escape in the search field clears it.

---

## Search and categories

Search matches the icon's name, its key and its category, so `arrows` returns the whole category and `arrow up` finds the icon whether you hyphenate it or not. Every word has to match: `check circle` narrows to the circled check rather than widening to everything with either word.

The categories are the Brand Book's own, read from the [Iconography](/foundations/brand-iconography.html) page at build time. An icon in the directory with no row on that page lands under "Other" and the build says so, which is the prompt to go and list it.

Every category is a chip on one line under the search, so switching is one press. While a category or a search narrows the set, the count beside the Icons title reads as the share showing, like 47 of 249. When there are more than the panel fits, the row scrolls sideways and fades at whichever edge has more past it. The arrow keys move between chips and choose as they go; Tab leaves the row in one step. Search and category combine: a search inside a category only looks there, and **All** puts the whole set back.

---

## Colour and size

**Colour**, in the Style section, is the brand palette as chips, read from the design system's colour tokens when the page loads. It is the same control every tool uses ([Tool Canvas](/docs/tool-canvas.html#colour)). See [Colour](/foundations/brand-color.html) for what each one is for. A brand instance that re-points those tokens gets its own swatches with no change to the tool.

Under the chips, the hex field always shows the colour chosen. It is the way out for a spec you do not control, and the only way to leave the palette; brand work stays on the chips. Type six hex digits, with or without the `#`, and press Enter, or choose by eye with the picker at the start of the field. A hex that is a palette colour checks its chip, and any other checks none. A value that is not six hex digits is not applied: the field says so and the colour stays as it was.

The preview stands the icon on the ground it needs: a light ground behind a dark icon, a dark one behind a pale one, so the lightest accents never disappear, even the pale ones that sit below 2:1 against off-white. **Fill screen**, in the preview's top-right corner, draws the icon as large as the preview allows instead of at the export size, so a 24px icon can be inspected properly; fold the icons away with the corner button and it takes the full height. The note at the foot says how far it is enlarged, and the export size is untouched. **Transparent**, beside it, swaps in the checkerboard, which is what an SVG or PNG export really is, and stays on whatever the colour, so a pale icon on it shows how faint the file would be on white. Nothing about the file changes; every SVG and PNG export is transparent whatever the preview stands on. **Guides** draws the icon spec over the icon: the 2px padding, centre lines, diagonals and the keyline circles. **Grids** draws the 1px unit grid. Each switches on its own, from the same layer engine as [Layout Specs](/tools/layout-specs-docs.html) and the `--artwork-icon-padding` and `--artwork-icon-grid` tokens. They are preview only; no export carries them. The top-left corner names the icon, its category, the colour and the export size.

Exports carry the palette's base step. An icon placed on a dark surface *in a page* takes the token's `light` or `lighter` step through `currentColor`, not a baked value. See [Colour](/foundations/brand-color.html) for how the modes pair.

Size is the exported pixel size, set in the Export section beside the format, because it changes the file's pixels and not the icon's drawing. A size that matches no preset leaves them all unselected. The preview draws the icon large enough to judge and no larger than the band, so it is rarely at the exported size; the note at the foot of the preview says at what percentage it is shown, or that it is the actual size. The reset button in the Style section's header returns the colour to its default; it is greyed out until you change it. **Reset all**, in the bar's menu, also returns the size to 24 and turns Transparent, Fill, Guides and Grids off. Neither touches your selection.

---

## Exports

Pick a format, then copy it or download it. Four formats, two verbs, and the same artefact either way.

| Format | What you get | Colour and size |
|---|---|---|
| SVG | A standalone file: `xmlns` restored, explicit `width` and `height`, the colour baked in as hex | Applied |
| PNG | The same drawing rasterised at the chosen size on a transparent background | Applied |
| HTML | A snippet in the design-system form: the `.svg-icn` wrapper with `data-icon`, `aria-hidden` and `currentColor` | Not applied |
| CSS | A `url('data:image/svg+xml,...')` value for `background-image`, with the colour baked in | Applied |

**Copy** puts the format on the clipboard. For PNG that is the image itself, which not every browser will accept; when yours will not, it says so and download still works. **Download** writes the file.

The HTML snippet is the odd one out on purpose. Inline icons inherit their colour from the text around them and their size from the wrapper, which is the whole point of the `.svg-icn` convention. Baking a colour into that snippet would break the convention the moment it was pasted. The rule, and the standalone file as its one exception, is in the [Icon](/foundations/iconography.html) documentation.

The browser renders the PNG at exactly the pixels you asked for. Nothing leaves the page.

---

## Filenames

The name is shown under the preview before you export, and it says what the file is:

| Format | Filename |
|---|---|
| SVG, palette colour | `icon_bydefault_arrow-up_off-black_24.svg` |
| PNG, palette colour, 512 px | `icon_bydefault_arrow-up_red_512.png` |
| SVG, hand-picked hex | `icon_bydefault_arrow-up_hex-ff0066_24.svg` |
| HTML | `icon_bydefault_arrow-up.html` |

Type, brand, key, colour, size: the [Logo Tool](/tools/logo-tool-docs.html)'s convention, underscores between the fields and hyphens inside them, because both the key and the colour name carry hyphens of their own. Nobody has to open the file to find out which colour it carries or which brand it belongs to, and a hand-picked colour names its hex (`hex-ff0066`), the value to paste into a design tool. The HTML snippet carries neither colour nor size, so its name does not claim to.

---

## What not to do

Do not paste an exported SVG where an inline icon belongs. Inline icons take their colour from the text and their size from the wrapper; a baked-in hex freezes both. The HTML snippet is the format for that.

Do not reach for PNG on the web. The SVG is smaller and stays sharp. PNG is for the places that cannot take vector: decks, email, some ad platforms.

Do not set a custom hex for brand work. The swatches are the palette; the custom field is for the cases it does not cover, and those are rare enough to be worth a conversation.

---

## Where the icons come from

Every icon comes from `assets/images/svg-icons/`, the same directory the `{{icon:name}}` shorthand and the sprite read. The doc generator inlines the set into the tool page at build time, so the tool is current with everything the docs publish and needs no network request to run. Add an icon to the directory, list it on the Brand Book's Iconography page, run the generator, and it appears in the tool.

### One icon set today, not one per instance

The swatches follow the brand's tokens, and so does the icon set — the manifest is built from this repo's icon directory, which is this deployment's icon directory. This was previously logged as a limitation with "serve each instance its own icons" as a roadmap item; **that item dissolved on 2026-09-18** when the engine became single-brand. One deployment, one icon set.
