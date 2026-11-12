---
title: "Layout Specs"
subtitle: "Build the rules once. Make every piece after from them."
description: "Layout Specs builds the rules artwork lives by, its padding, clear space, grid and the interface that covers it, around a stand-in, and keeps them as a Layout Spec any tool can read."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 4
status: "published"
access: "team"
brand: "internal"
actionUrl: "layout-specs.html"
actionLabel: "Open Tool"
---

Layout Specs builds the rules a piece of artwork lives by and keeps them as a [Layout Spec](/foundations/layout-spec.html): padding, clear space, keylines, a grid, a tap area, the platform interface that will cover it. Place a stand-in, draw the rules around it, and the next piece starts from them instead of from a blank canvas. Until 2026-10-04 the tool was called Artwork Layers.

---

## Start from a template

A template sets the canvas, the specimen and a first set of rules at once.

| Template | Starts with |
|---|---|
| Icon, 24 × 24 | Padding, live area, unit grid, centre lines, diagonals, two keylines |
| Logo with clear space | Clear space in X, an X grid, centre lines across the clear space |
| Avatar, circle | A circle canvas, its cut-away shaded and outlined, and a safe area |
| Story 9:16, Post 1:1, Post 4:5, Video 16:9 | The frame for every format of that ratio, ready for its platform's layers |
| Instagram Reels, 9:16 | The 9:16 frame with the Reels interface laid over it |
| Blank | A 1000 × 1000 canvas and the specimen, nothing else. A new spec and a reset start here |

A new spec, a reset and a template all open on the canvas. **New spec** on the bar opens the same dialog every time, a tile per template like Add layer's: the tile you pick starts the spec. Once the spec holds something, the dialog warns first, since a template replaces it.

---

## The canvas

The bottom row of the layer list is the canvas. Select it to set the frame.

| Setting | Choose |
|---|---|
| Size | **Hug** the specimen, a preset, or your own width and height |
| Shape | Rectangle, circle, rounded or app icon |
| Show | Shade what the shape cuts away, shade what stays, draw its outline |
| Corner | For a rounded shape: the corner, in % of the shorter side |
| Background | **None**, the checkerboard chip, for a transparent canvas, then a colour from the palette, or a hex |

The shape clips the specimen, the background and any image under the specimen. Your rules stay visible past it, so a clear space can reach beyond a circle avatar's edge. Choosing a shape turns its outline on, so a clip is never silent.

---

## The specimen

The specimen is the stand-in your rules are tested against. Swap it and the rules stay put.

| Source | What it is |
|---|---|
| None | The rules on an empty canvas |
| Asset | An icon or logo from the library |
| Image | A file from this computer. It stays in this browser tab and never goes into the spec or an export |

Select it to place it: **Fit** or **Fill**, a **Size**, an **Offset** across and down, and its **Overshoot** on each edge. Overshoot tells the rules where the real edge is when a letter dips past it, so clear space starts at the baseline, not at the foot of the *o*.

---

## Add rules

**Layers stays at the top of the column.** On a wide screen the stack holds the column's top and scrolls inside itself once it is long, so the selected layer's settings sit right under it however many layers there are. Hold a dragged layer near the list's top or bottom edge and the list scrolls to take it there. Close Layers and Settings takes the whole column.

**Add layer** asks for a type: seven tiles, each with the icon it has in the list. The tile you pick is added at once, as its type's first preset, on top of the stack or into the selected group. **Start from** in its settings swaps it to another preset of its type, keeping a name you gave it and any image, marker file or text you added.

| Type | Presets | What it is |
|---|---|---|
| Zone | Padding, Live area, Clear space | A rule measured from a box: where things may and may not go |
| Shape | Tap area, Coloured area | A rule placed where you put it |
| Guide | Centre lines, Diagonals, Thirds, Guide line, Keyline circle, Keyline rectangle | Construction: the lines the next piece is built on |
| Grid | Cell grid, X grid, Columns, Rows | Construction: cells, columns or rows |
| Image | Platform UI, Instagram Reels UI | A picture, under the specimen to check against or over it as a rule |
| Measure | Canvas size, Specimen size, Zone inset, Zone area | Annotation: one dimension line, a width or a height, with its value |
| Note | Note | Annotation: a line of text, on or beside the canvas |

Safe area and the unit and percent grids are presets the templates use; Start from offers them on a layer that came from one.

**A zone follows its box.** Padding sits inside the canvas; clear space sits outside the specimen. Resize either and the zone moves with it.

**A shape stays where you put it.** Use one for a tap target, the slot an object sits in, or a coloured area. Set its position and size, and whether it draws as an outline, a fill or both.

**An image takes its role from where it sits.** Under the specimen it is something to check against; over it, an overlay such as the Instagram Reels interface.

Every drawn layer has the same **appearance**: **Draw** (outline, fill or both, where there is an area to fill), then the outline and the fill, each with its own settings. The outline has its **Line**, solid or dashed, its **Weight** in screen pixels, **Outline opacity** and **Outline colour**; the fill has **Fill opacity** and **Fill colour**. Drawn as both, a zone or a shape can have a dark edge round a pale area. Only the paints the draw uses show: a fill alone has no outline to style, an outline alone no fill. A measure draws lines only, so it has one **Opacity** and **Colour**.

**A measure is one line, as the Figma Annotation kit's measure is.** **Direction** picks Width or Height; for both sides add a second measure, as the templates do in their *Canvas size* group. **Line at** places the line across the box: Top, Centre or Bottom for a width, Left, Centre or Right for a height. Beside a box it stands off it; on a zone it lies on the zone. **Value** puts the number on the line or beside it, Left, Right, Top or Bottom, growing away from the line. **Size** Large doubles the lines, ticks and value for a diagram seen small. **Value style** Filled is a pill in the measure's colour; Text is the number in that colour.

**Measures and notes take the kit's colours.** **Colour** offers Auto, the ground's ink, which flips on a dark ground, then Ink, White, Red, Blue, Pink and Green. A note with a colour becomes a pill. White is for a dark ground.

**A rule can carry where it came from.** A spec from a platform's published specs says who set each rule and when it was checked. An **approximate** rule, a measured estimate, draws with a finer dash and a fainter area, so it never looks more precise than it is. A **locked** rule is the platform's: its settings show but do not change, it cannot be deleted, and **Duplicate** makes a copy of your own.

---

## Markers

A zone can carry a **marker**: a graphic drawn in its band, as wide as the band is deep, the way a brand's clear-space diagram draws the unit it is measured in. Every ring zone has one; it is off until you pick a kind.

| Kind | Draws |
|---|---|
| Glyph | The glyph the logo's manifest names as X, so the clear space shows the very letter it is measured in |
| Text | A letter or a short word, such as *x* |
| SVG | Any drawing you pick, sanitised before it is drawn |
| Image | A PNG, JPG or WebP you pick, or a web address |

**Rotation.** The default is −90°, a quarter turn left, so a *d* lies with its ascender on the ground. **Turns** keeps that ground on the zone's outer edge all the way round; **Fixed** turns them all alike. **Repeat** puts one marker on each edge or tiles them along it. The marker's colour and opacity are its own: by default the outline's colour at 60%, or the fill's when the zone is drawn as a fill alone.

---

## Groups

A group shows and hides a set of layers with one eye. **Add group** beside Add; add a layer while the group is selected to put it in, or drag it in. **Ungroup** in Settings returns its layers to the top level as they were. A group's **folder icon** folds it: closed, its layers leave the list (they still draw), and the open folder brings them back. Folding is the list's view, not the spec; a layer added to or moved into a folded group opens it. The specimen never goes in a group, so hiding a group never hides it.

---

## Units and tokens

Every length and position takes **px**, **%** or **X**: px in canvas units (pixels for a social format, the viewBox for an icon), % a share of the box it is measured from, X the specimen's own unit (for a logo, the width of the glyph its manifest names). A grid in % divides exactly at any size: 10% is ten columns on a 98px canvas and on a 1080px one. A grid in px or X keeps its cell size; align it from the centre and the remainder splits evenly.

A length can **follow a token**. The icon padding follows `--artwork-icon-padding`, the logo's clear space `--artwork-logo-clear-space`. While a layer follows a token, a change to the token redraws it here and in the Icon Library and the Logo Tool. Type a number to unbind it.

---

## One spec, many formats

A spec records the size it was written at. Drawn on another canvas of the same ratio, its px lengths scale with the width, so a story spec written at 1080 × 1920 draws the same at 720 × 1280. A canvas of another ratio is flagged rather than stretched. **Write the spec at this size**, under the canvas's dimensions, rescales its px lengths to the canvas in use; a locked rule keeps its own.

Formats that share a ratio share a starting point: an Instagram story and a TikTok video both start from the 9:16 template and differ by the layers on top, such as an image of each platform's interface. The Reels interface is ready made, a flat outline export at `assets/images/platform-ui/instagram-reels.svg`; an image layer takes a web address, a picked file, or a file under `/assets/images/`, which is how the platform interfaces travel in a link.

---

## Keep the spec

| Export as | You get | Opens again |
|---|---|---|
| SVG (`.layout-spec.svg`) | The rules as a drawing, each layer a named group, the spec inside | Yes, through **Import spec** |
| JSON (`.layout-spec.json`) | The spec alone | Yes |

**Layers arrive named.** Paste the SVG into Figma and the frame is named for the template and size, each layer by its label, every part inside it for what it is, groups stay groups, and each layer's labels sit inside it.

**Include specimen** decides whether the specimen and background go into the SVG. Turn it off for the rules alone, to lay over artwork in a design tool. An image specimen never goes in.

**Copy link** in the ⋯ menu carries the spec in a link, without picked images, which are too large for one. Your last spec stays in this browser and comes back when you return; **Reset** clears it.

**A spec from before opens converted.** One made while the tool was Artwork Layers (Layout Spec version 1), from a file, a link or this browser, comes in as version 2: the fill under the artwork becomes the background, its masks the canvas shape, any other fill a filled shape. The canvas settings say what changed.

---

## Previews only

The rules are drawn here, written into the spec and, in an exported SVG, drawn into that file. They are never part of an exported icon or logo: the Icon Library's Guides switch and the Logo Tool's Safe zone switch draw the same rules over their previews and leave every file they export untouched.
