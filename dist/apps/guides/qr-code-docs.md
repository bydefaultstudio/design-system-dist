---
title: "QR Code Generator"
subtitle: "Brand the code without breaking the scan"
description: "Generate QR codes for campaigns, packaging and brand assets, as PNG or SVG. Set error correction, quiet zone, module shape and colour, and export at any size."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 7
status: "published"
access: "team"
brand: "internal"
actionUrl: "qr-code.html"
actionLabel: "Open Tool"
---

A QR code is a print asset like any other, and it arrives on packaging, in out-of-home and on stands where nobody can fix it afterwards. The tool generates one in the brand's colours and exports it as PNG or SVG, with the settings that decide whether it still scans kept in front of you rather than buried in a library call.

Everything runs in the browser. The text never leaves the page.

---

## What goes in

The tool is three parts: the code on the preview, the controls in three sections on the right — **Settings**, what the code carries and how it is built; **Style**, how it looks; **Export**, the file's format, size and name — and Download and Copy pinned under them. The button in the preview's bottom-right corner folds the sections away so the code takes the whole canvas. On a phone the sections sit under the preview.

The field at the top of Settings takes anything a scanner can carry — a campaign URL, a plain string, a phone number. The preview repaints as you type, a moment behind the keystroke. While the field is empty it shows a sample — the brand's own address, drawn with your current settings — so colour, shape and logo read before you type anything. The sample never exports and is never scan-checked. Download and Copy stay disabled until there is something to encode.

**Content type** above the field decides how it is read. **URL**, the default, adds `https://` when the address has no scheme, so `example.com` scans as a link a phone offers to open rather than as a line of text; a scheme you type yourself — `http:`, `mailto:`, `tel:` — is left alone. **Text** encodes the field exactly as typed. Switching keeps what is in the field, and the field's label and the note under it follow the choice.

Longer text needs more modules, so the grid gets denser at a fixed export size. A tracking URL with a long query string prints smaller squares than the bare domain does, which matters more on packaging than on screen. Shorten the link before encoding it, not after.

**Text beyond Latin-1 is encoded as UTF-8.** An em dash, curly quotes, CJK or emoji switch the whole code to UTF-8, which modern phone scanners detect on their own. Text within Latin-1, which covers plain ASCII and Western accented letters, keeps one byte per character, as it always has, so a code printed from it before still matches. Scan the result before it ships either way.

---

## Error correction

Every QR code carries redundant data so a damaged or obscured code still reads. Four levels, and the tool defaults to the highest.

| Level | Recovers | Use for |
|---|---|---|
| L | ~7% | Screen only, clean surface, shortest possible grid |
| M | ~15% | General print where nothing overlaps the code |
| Q | ~25% | Print that will be handled, folded or weathered |
| H | ~30% | Packaging, out-of-home, anything with a logo over the centre |

Higher correction costs modules: the same URL at H fills a denser grid than at L. That is the trade. Drop the level to win back module size, and only when the surface is forgiving.

Turning the logo on locks the level to H: all four levels go grey, and the note under them says to turn the logo off to choose. The logo is deliberate damage, and H is the only level with the budget for it.

---

## Size and quiet zone

**Size**, in Export beside the format, sets the exported square in pixels, from 128 to 2048, in steps of 64 — type it, step it, or take a preset: 256, 512, 1024 or 2048. A size that matches no preset leaves them all unselected. A value outside the range or between steps is corrected when you leave the field — above 2048 becomes 2048, below 128 becomes 128, 1000 becomes 1024 — so the field always shows the size that will be written. A blank field, a zero, or anything that is not a number becomes 512 rather than the minimum.

For SVG the number matters less than it looks — the file carries `width`, `height` and a matching `viewBox`, so it scales to any final dimension without loss. Set the size for PNG, where the pixels are the asset.

**Quiet zone**, in Settings, is the empty margin around the grid, measured in modules, from 0 to 8. It defaults to 2, which suits a code placed in a layout that already keeps clear space around it. The QR specification asks for 4, and quiet zone is the setting most often lost in layout. Scanners use that margin to find the code's edges; a code butted against a coloured panel or a photograph reads slowly or not at all. The tool will take it down to 0 without objecting. Raise it to 4 when the code sits on a busy or coloured surface, and let the design hold the space rather than trimming it in the export.

---

## Module shape

**Module radius** rounds the corner of every module, from 0 to 50% of the module's own width. At 0 the modules are squares, which is what scanners were built for. At 50 each one is a circle.

Rounding is a brand decision with a scanning cost: the rounder the module, the less ink meets its neighbour, and the more the grid depends on error correction to hold together. Round it if the brand asks for it, raise error correction when you do, and test the result on a real phone at the distance the code will actually be scanned from.

---

## Colour

Colour is in **Style**, as **Foreground** (the modules) and **Background**. Each is the brand palette as chips, with a picker and a hex field under it that always show the colour chosen. A chip fills the field. A hex typed into the field that is not a palette colour leaves every chip unchecked. The field takes six hex digits, with or without a leading `#`, in either case. It applies when you leave it or press Enter, and the picker applies as you drag it.

A value that is not six hex digits is not applied: the field turns red, a message under it says what it takes, and the code keeps the last valid colour until you put a valid hex back. Three-digit shorthand counts as invalid here, so write `#FF0000`, not `#F00`.

**Pairs**, above the two, sets both at once. Four combinations that scan well come first — black on white, off black on off white, blue on white, and brown dark on brown lighter — then the brand's recommended pairings, the same list [Colour Pairing](/tools/color-pairing.html) offers. Point at a chip to read its name; a pair under 4.5:1 is named low contrast. A pair stays checked while both colours match it. The line under the colours gives the pair's contrast and whether it clears 4.5:1.

**None**, the checkerboard chip at the start of Background, drops the background from the file: the PNG exports with an alpha channel, and the SVG omits its background rectangle. Turn on **Transparent** on the preview to see it on a checkerboard. A code with no background inherits whatever sits behind it in the layout, so the contrast question moves out of this tool and into the design — check the colour you are placing it on.

Contrast is what a scanner reads, and the direction is not symmetric: the foreground must be darker than the background. A light code on a dark ground fails on many scanners even at high contrast, so keep the dark value in Foreground. To check the colours against the layout the code sits in, use [Colour Pairing](/tools/color-pairing.html).

---

## Logo

**Logo**, the switch in Style, puts the brand's avatar in the middle of the code, drawn in the foreground colour. The mark comes from the Logo Tool's brand manifest, so a deployment for another brand shows that brand's avatar with no change to the tool; if the manifest carries no avatar, the switch is disabled.

The logo always takes 22% of the code's width. It is a proportion rather than a pixel size, so the logo holds its place at any export size. The tool turns that share into whole modules: it takes the nearest odd number of modules, so the logo sits exactly on the grid's centre with no module cut in half, then clears one empty module around it so the mark never touches the code's own dots. On short content it also raises the grid to at least 29 modules across (version 3), so the cleared square never reaches the corner patterns or the format strips beside them. From version 7 up — long URLs, roughly 45 modules and more — a small alignment square sits at the exact centre, and the logo covers it. Scanners locate the code without it, and the scan check reports the case where one does not.

**Why 22%.** Error correction at H recovers about 30%, but a scanner does not know where the logo is. It reads the covered modules as wrong rather than missing, and a wrong module costs twice what a missing one does, so the logo's real budget is nearer half of that 30%. The rest belongs to what happens after export: ink spread, a curved pack, glare, a camera at an angle. 22% of the width clears about 7–10% of the modules, the upper end of what that budget allows, and the largest mark reads best, so the size is fixed there rather than offered as a setting. For rough print, a curved pack or a very small code, check the badge and scan a proof; if either fails, turn the logo off. A clean on-screen render keeps scanning well past it — up to about 34% in testing — which is why the scan check cannot be the only guard.

---

## Scan check

A badge in the preview's Details corner reads the code back the way a phone would, each time it changes:

| Badge | What it means |
|---|---|
| Scans | The code decodes to exactly what you entered |
| Doesn't scan | Nothing decodes. Stronger contrast, a wider quiet zone or no logo will usually fix it |
| Reads back wrong | It decodes, but to something else — usually a character the encoder cannot carry (see above) |

The check reads a clean digital render, and a transparent code is read on white. A pass is necessary, not sufficient: print, glare and distance take margin the screen never needs. Scan a proof on the real material before it ships. The decoder loads the first time the tool opens; until it arrives, or if it fails to load, the badge stays hidden and the rest of the tool works as before.

---

## Exporting

**Export as**, in the Export section, chooses the format; **File name** under it shows what the download will be called, with a button to copy it. **Download** and **Copy**, pinned at the foot of the sections, each name the format they make — *Download PNG*, *Copy SVG*.

| Format | What you get | Reach for it |
|---|---|---|
| PNG | A flat raster at the chosen size, alpha when the background is transparent | Slides, email, anything that wants a picture |
| SVG | A background rectangle, one rectangle per dark module, then the logo as a group of paths — scalable without loss | Print, packaging, artwork handed to a production house |

Files are named for the format and the size — `qr-code-512px.png`, `qr-code-512px.svg` — so a folder of exports stays sortable.

A click that lands while the preview is still catching up with a keystroke renders first, so the file always matches what you typed.

**Copy SVG** puts the markup on the clipboard for pasting straight into a template or an email build. The SVG is plain geometry with no script and no external reference, so it survives being inlined. **Copy PNG** puts the image itself on the clipboard, for pasting into a slide or a chat; a browser that cannot hold an image on the clipboard says so under the buttons, and Download still works.

**Copy link** in the bar's ⋯ menu copies the page's address. The settings do not travel with it — send the exported file, not the link, when someone else needs this exact code.

---

## The preview

The preview shows the code as the file draws it and changes nothing in it. **Details**, top left, says what the file is — URL or text (or *Sample* while the field is empty), the size in pixels, the grid in modules, the error correction level — and whether it scans. The note at the foot says at what scale the code is drawn: the band shows the export size when it fits and scales it down when it does not.

The ground behind the code is the light off-white while the code has a background, so the code shows as its own square. With no background it is light or dark, whichever the foreground stands out on, so a pale code never vanishes. Two switches, top right, change only what you see:

- **Transparent** puts a checkerboard behind the code, to show where the file is empty.
- **Fill screen** draws the code as large as the preview allows, to inspect the modules. The scale note says how far it is enlarged.

---

## Starting over

The reset button beside **Settings** puts error correction, module radius and quiet zone back to the defaults and keeps what you typed. The one beside **Style** puts back the colours, the background and the logo. Each is greyed out while its section is already at the defaults. **Reset all** in the bar's ⋯ menu clears everything: the field, the content type, both sections, the format, the size and the preview's switches.

---

## When it refuses

The tool reports one failure in words, worded for whether the logo is on:

> URL too long for this error correction level. Try a lower level or shorten it.

> URL too long to carry a logo. Turn the logo off or shorten it.

The first word follows the content type: *Text too long…* in Text mode.

A QR code tops out at a fixed capacity, and raising error correction lowers it. With the logo off, the message names both ways out. Shortening the text is the better one, because dropping to L to fit a long URL produces a code that is both dense and fragile. The tool shows this message for anything the encoder refuses, so treat it as the likeliest cause rather than the only one.

If nothing on the page responds at all — the preview never paints, the controls do nothing, Download stays grey — the encoder did not load, and the console says so: `[QR Code Tool] qrcode-generator not loaded`. None of the page is wired up in that state, so there is nothing in the tool left to try.
