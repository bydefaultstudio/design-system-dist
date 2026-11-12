---
title: "Asset Library"
subtitle: "Every approved brand file, found by name and taken in the right format"
description: "How the Asset Library works: search that turns words into filters, the Type, Format, Project and Tag filters, links, font licences, and how a file gets into the library."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 1
status: "published"
access: "team"
brand: "internal"
actionUrl: "./asset-library.html"
actionLabel: "Open Tool"
---

Approved brand files used to live in folders, and finding the right one meant knowing which folder. The Asset Library is the one place: logos, icons, images, fonts, documents and the Figma files they come from, each a tile you find by saying what you are making, not where it was filed.

If the library offers it, it is approved. Nothing in it is a draft.

---

## How to use it

1. **Search** for what you need, or narrow the grid with the **Type**, **Format**, **Project** and **Tag** filters under it
2. **Select** a tile and the panel on the right shows its facts. **Double-click** it, or press Enter, to see the file large over the grid; the arrows move to the next and previous file and the panel follows
3. **Download** at the foot of the panel, or **Open** for a link. The Format row under File details says what you get

On a phone, a tap opens the preview, which fills the screen and carries Download and Copy link at its foot.

Selecting a file writes it into the address, so **Copy link** in the panel hands someone the file you are looking at; **Copy link to this view** in the bar's menu carries the search and filters too. Every link opens only for someone signed in to this site.

From the search field, one Tab reaches the grid. The arrow keys move between tiles and select as they go, so the panel follows them; Home and End jump to the first and last. After a click, the arrows carry on from the tile you clicked. Enter opens the file, and Escape in the search field clears the words. Backspace in an empty field takes off the last filter you turned on. In the preview, Escape returns to the tile you came from.

---

## Search and filters

**Search does most of the work.** It matches a file's title, its projects and their client, its tags, its type, its format and the words in its filename, so `banner` finds the website banners and `blackdoctor` finds the festival project. Every word has to match, and a few words stand in for each other: logo for mark, photo for image, deck for presentation.

A word the library knows becomes a filter as soon as you finish it, with a space or Enter: a tag (`portrait`, `social`), a format (`svg`, `figma`) or a type (`logos`, `photo`). It presses that option in its row and matches that filter alone, never a word in a title. Words it does not know stay as text. Only what some file carries is recognised, so a filter never empties the grid on its own.

**Every filter that is on sits at the end of the search field**, each with a mark for its kind and a cross to take it off, whichever way it came: typed, pressed in a row, or pressed in the panel.

Under the search, four tabs each open one row of options. Every option shows how many files it would give you with everything else that is on, and pressing it again turns it off.

- **Type** is what a file is: Logos, Icons, Images, Video, Fonts, Documents, Presentations, Prototypes, Design files. A logo stands for a brand, an icon for an idea; a design file is a Figma file or library.
- **Format** is the file you get: SVG, PNG, PDF, a font file, or where a link lives, such as Figma.
- **Project** is a hand-picked set for a job: a campaign, a press kit, a new-starter pack. A file can be in several. A project made for a client names it, so searching the client finds the project. Evergreen files belong to none.
- **Tag** is everything else the library says about a file: its variant (light, stacked, italic), its use (social, print, web, presentation, email), its subject, a font's style, and its orientation.

Only the options some file has are offered, and a category with none has no tab. **Tags in the panel** filter too: pressing one shows every file that carries it, and pressing it again turns it off.

Within one row any option matches (logos or icons), and within Tag any tag of one group (portrait or square); across rows and groups every one must (logos, tagged social, as SVG). The count over the files says what is showing; when nothing matches, the message names the search and the filters, and offers the way back. The control beside the count shows the files as a grid or a list, and the browser remembers which.

Orientation, landscape, portrait or square, is read from each file's dimensions; nobody tags it.

---

## Links, fonts and icons

**One file per asset.** Each tile is one file, and Download gives it. A reader below the library's level sees Download locked, with the reason as its tooltip; a press goes to the login. A logo's white, centred and sized versions come from the [Logo Tool](/tools/logo-tool.html), not from the library.

A **link** is an asset that lives somewhere else, a Figma file, a Figma Slides or Google Slides deck, a website, shown with a cover picture. Its Type says what it is and its Format where it lives, and in place of Download the panel offers **Open in Figma** (or wherever it is).

A **font** is downloadable, open or paid. A downloadable font gives its file. An open font (free, on Google Fonts) shows a specimen and, in place of Download, a button that goes straight to where it lives. A paid font (`link-only`) shows a specimen and an About the licence button, whose dialog says the licence covers the brand's own work and where to license it, or to ask the brand team when there is no foundry link. Open and paid fonts' bytes are never on this site. Upright and italic are separate files, tagged `italic`, and every font carries its style: sans, serif, display, mono or script. A whole family can be one zip: its tile shows a specimen set from the Regular style inside it, the dock says how many styles the pack holds, and Download gives them all. A downloadable font's Download opens the licence notice first, the terms every licensed file in the library is handed out under: for {{brand:organisation}} work only, never shared or passed on, deleted when the work ends. The download starts from Accept and from nothing else: until then a middle-click, a drag or Save link as on the button is refused. A font under an open licence (`openLicence: true`, such as one on the SIL Open Font Licence) is free to share, so its Download skips the notice.

Downloads need the tool's level: its `downloadAccess`, or its `access` when it sets none. The page locks Download for a reader below it, and the Worker refuses the file to them as well (`LIBRARY_DOWNLOAD_ACCESS` in `worker/library-index.mjs`). A guest never gets a library file, whatever their groups open, because no grant reaches `/files/`, so the page locks Download for every guest too.

The brand's **icons** are one tile, the whole set as a zip. For one icon at a size or a colour, use the [Icon Library](/tools/icon-library.html).

---

## Adding a file

The site's owner curates the library for now; **Add new** in the bar brings you here until adding from the page is built. On the machine that holds the drop folder:

1. Drop the file into `library/<group>/`, named `<asset-id>[@<variant>].<ext>` in lowercase with hyphens: `logo-primary.svg`, `bdff-opengraph.png`. Each file is its own asset; a variant marker names it (`logo@dark.svg` becomes `logo-dark`). The group folder is only where it sits, unless it is a project's id, which puts the file in that project.
2. Run `npm run asset-library:build`. A new file is scaffolded into `cms/asset-library/catalog.json`, appended, nothing overwritten. Fill in its title, type, projects (the catalog's `kits`), tags, a description and, for a picture, alt text. A font needs a `licence` — `downloadable`, `open` with `licenceUrl` and `licenceFoundry` ("Google Fonts"), or `link-only` for a paid font, where the foundry and its URL are optional — and the build will not go on until it has one. A downloadable font under an open licence also takes `openLicence: true`, so its Download skips the licence notice. A link is a catalog entry with a `link` (its URL and source) whose one file is the cover picture: drop the cover, add the `link`, and the build uploads its thumbnails and never the cover itself.
3. Run it again. Thumbnails are made (WebP at two widths with a placeholder hash; an SVG as itself; page one of a PDF; a specimen for a font, from the Regular style when the font is a family zip), originals and thumbnails are uploaded to the private bucket, and `lock.json` records what is there.
4. Run the doc generator, then commit `catalog.json`, `lock.json` and `worker/library-index.mjs`.

A file the catalog names that the bucket does not hold fails the build, as does an unknown tag or project, a duplicate id, a second file on one asset, or a picture with no alt text: the page is generated from this data, and a Download that 404s is worse than a build that stops. Tags come from the catalog's own vocabulary, in four groups (Variant, Use, Subject, Style); add a word to its group before using it.

Removing an asset from the catalog revokes its download on the next deploy, whatever the bucket still holds.

---

## Where things live

| What | Where |
|---|---|
| The catalog, its schema and the lock | `cms/asset-library/` |
| Originals, on the owner's machine only | `library/` — gitignored, "Keep Downloaded" in iCloud |
| The build | `scripts/asset-library/`, with its own dependencies |
| Originals and thumbnails, served | a private R2 bucket, through the Worker at `/files/`, signed in only |
| The tool | `cms/apps/asset-library.{md,html}`, `assets/js/asset-library.js`, `assets/css/asset-library.css` |

The full design — decisions, accessibility, performance, the Worker — is `asset-library-plan.md` in the repo.
