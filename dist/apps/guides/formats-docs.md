---
title: "Format Library"
subtitle: "Every platform format, found in one search and checked layer by layer"
description: "How the Format Library works: search and the Platform, Ratio and Type filters, the layer switches, the spec and its sources, the download, and how a format gets into the registry."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 5
status: "published"
access: "public"
brand: "internal"
actionUrl: "./formats.html"
actionLabel: "Open Tool"
---

A format used to live on its channel page, so finding one meant knowing which channel to open and scrolling to it. The Format Library puts every format in one grid: type what you are making, or narrow by platform, ratio or type, and open the one you need.

An open format is drawn with its layers, so you see what the platform does to it before you make it: what the interface covers, what the grid cuts off, where the safe area sits. Its spec says where each figure comes from, and its default artwork downloads as a PNG.

The tool is public: anyone with the link can use it, signed in or not, and the downloads need no sign-in either.

## How to use it

1. **Find the format.** Type into the search, or press a chip under it.
2. **Open it.** Click a tile, or move to it with the arrow keys and press Enter. The format opens large over the grid, with its name and where it sits among the formats showing ("5 of 10"). The arrows, or the left and right keys, move to the previous and next format the filters show.
3. **Switch its layers.** Artwork and App screen start on. Safe area, Profile grid, Profile and Measurements are one switch away. App screen, Profile grid and Profile are views: one shows at a time. On a wide screen the Layers and Spec panels sit beside the drawing, and the Panels button in its corner folds them away. On a phone they are two bars under the drawing; tap one to open it.
4. **Check the spec, then download.** Download PNG saves the default artwork at full size; a format whose artwork is not drawn yet offers Read the guide in its place. Copy link to this format gives a link that opens it.

Back to formats, the button at the top right, or Escape, takes you back to the grid with your search and filters as you left them.

## Search and filters

Search reads each format's name, platform, ratio, type and size, so `story`, `9:16` and `1080x1920` all find the Instagram Story. Every word you type has to match.

Under the search are three rows of chips. Each row picks one value, or All:

| Filter | What it narrows by |
|---|---|
| Platform | Where the format is posted: Instagram, and the others as they are added |
| Ratio | The canvas shape, tall to wide: `9:16`, `3:4`, `4:5`, `1:1`, `1.91:1` |
| Type | Post, story, video, profile or ad; Banner joins when a platform brings one |

The search, the filters and the open format are all in the page address, so a filtered view (every 9:16 format) or one format can be sent as a link.

## The layers

Each switch shows or hides one group of the format's drawing. The layers are the Figma templates' own, listed as a layers panel lists them: the top layer first, Artwork last. A switch appears only where the format has that layer. Green is fine, red is lost.

| Layer | What it shows |
|---|---|
| Measurements | How far from each edge to keep clear, in pixels: one dimension line per distance, with the safe area's size in its corner. Where the distance is measured from a crop, the crop and the distance from it are two lines |
| Profile | How a circle format looks in its circle: the corners are masked out in the page's background colour |
| Profile grid | How the file looks as a tile on a profile, cropped to the grid's 3:4 tile. Safe area switches off while it shows |
| App screen | What the app shows on top while the post plays or opens, with anything the screen trims masked out |
| Safe area | Where text and logos are seen in every view: the file is shaded green outside it, as the Figma templates draw it. A green cross marks its centre when it sits off-centre |
| Artwork | The default artwork, as it downloads |

App screen and Profile grid appear on a format once its interface drawing is on the site; every Instagram format has them where the platform shows one. The three views are one at a time: turning one on turns the others off. Each crops the drawing as that view crops the post, masking what is lost in the page's background colour, so what is left is what a viewer sees.

The info button beside each layer's name opens a short note on what that layer tells you, in a panel under the button that floats over what is below, so the switches never move. It opens on a click, not on hover, so it works on a phone too, and Escape or a click elsewhere closes it. Reset Layers, beside the Layers heading, puts the switches back as they started.

## The spec and its sources

The Spec panel lists the size, ratio, file types, the safe area, how far to keep clear from each edge, what is cropped, and where and when it was measured. Only what deserves less trust is marked: a number Meta publishes says Meta, and an estimate says estimated, so a guess never reads as a spec. The 65 px margin is ours, Meta's 6% side margin applied wherever a platform publishes none. The registry still records where every number comes from, in one of five labels (platform rule, measured, calculated, house rule, estimated), and a sum takes its least certain part's label. The official links live on the platform's page, one section per format: Read the guide, at the foot of the Spec panel, opens it.

Where both exist an organic format and its ad can differ, so they are two formats. The Story keeps clear of the top bar, 124 px measured, and of a short phone's reply bar, about 172 px and estimated until it is measured. The Story ad keeps Meta's published zone: the top 14%, the bottom 35% and 6% each side. Type tells them apart: Story or Ad.

## Downloads

Download PNG saves the format's default artwork at its full size: the format's grid with the brand's logo, the starting point a designer replaces. It is a public file under `/assets/`, so it needs no sign-in.

The profile picture's PNG is the logo kit's avatar mark, centred inside the safe area. For the mark at another size or colour, use the Logo Tool.

## A format on any page

The same drawing and switches go on any documentation page as a [format card](/web/format-card.html). Put the tag on a line of its own in the page's `cms/*.md` source:

```markdown
{{format: instagram/story}}
{{format: instagram/story show="artwork, safe-area"}}
{{format: instagram/story show="artwork, safe-area" on="safe-area"}}
{{format: instagram/square-post show="none"}}
```

`show` picks the switches that appear, `on` which of them start on, and `show="none"` gives a plain drawing. The names are the layer ids: `artwork`, `safe-area`, `app-screen`, `profile-grid`, `profile`, `measurements`. Old ids still work: `app-interface` reads as `app-screen`, checked like any other, and `guides`, `cut-off` and `cropped-area` are dropped. The format's data goes into the page when it is built, and a format or layer that does not exist stops the build, naming the page.

A platform's page lists every format at a glance with one line:

```markdown
{{format-table: instagram}}
```

It becomes a table of each format's size, safe area and where it shows, read from the registry, so the page's numbers are the tool's. A safe area Meta publishes names Meta and links the source (the platform file's `ruleOwner` and the format's first reference starting with it); one with an estimated number carries an estimated badge. Keep-clear distances stay on the drawing, under Measurements. Each row links to the format's section on the page. Where a format shows is the registry's `shows` field.

## Embedding a format

For Notion, Webflow, a deck or a client document, frame the public embed. It takes the tag's settings in its address, needs no sign-in, and any site can frame it:

```html
<iframe src="{{brand:url}}/tools/formats-embed.html?format=instagram/story&show=artwork,safe-area" width="480" height="760" title="Instagram Story format" loading="lazy"></iframe>
```

A wrong address shows a message saying what is wrong in place of the card. The full reference is on the [format card](/web/format-card.html#embedding-a-format-elsewhere) page.

## Adding a format

The tool reads the format registry: one file per platform in `assets/data/formats/`, checked against `assets/data/format.schema.json`. Figma is the source of every number: the Figma templates export one file per format to `cms/formats/export/<platform>/`, and `scripts/import-formats.js` folds them into the registry and draws the layers from them. Nobody types a number in by hand.

1. Add the format's own entry to its platform's file: its name, type, file types, references and default artwork. The import fills in the rest.
2. Put the artwork PNG under `assets/images/social/<platform>/`, and any app screen under `assets/images/platform-ui/`.
3. Run `node scripts/import-formats.js`, then `node scripts/verify-formats.js`, then the doc generator (`cd cms/generator && npm run docgen`), which inlines the registry on the tool page and stops if a file is wrong.

The verify script holds what the schema cannot: the file name matches the platform, every id is unique and starts with the platform, the ratio matches the size, every file named exists, the switches are the ones above, in that order, with Artwork and App screen on, and the registry is exactly what the import makes of the export.

## Where things live

| What | Where |
|---|---|
| The tool page | `cms/apps/formats.md` and `cms/apps/formats.html`, built to `/tools/formats.html` |
| The script | `assets/js/formats.js`, drawing through `assets/js/format-card.js` and `assets/js/layer-stack.js` |
| The format card, the tag and the embed | `assets/js/format-card.js`, `assets/js/formats-embed.js`, `cms/generator/format-card.js`, `docs-site.css` section 5B |
| The styles | `assets/css/formats.css` |
| The registry | `assets/data/formats/<platform>.json` |
| The Figma export, and its import | `cms/formats/export/<platform>/<format>.json`, `scripts/import-formats.js` |
| Its schema | `assets/data/format.schema.json`, beside `assets/data/layout-spec.schema.json` |
| The checks | `cms/generator/formats.js`, shared by the doc generator and `scripts/verify-formats.js` |
