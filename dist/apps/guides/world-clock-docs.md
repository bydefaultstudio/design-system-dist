---
title: "World Clock"
subtitle: "See every timezone your team works across"
description: "Configure a multi-timezone clock and embed it in Notion, dashboards, or any HTML page. Search cities, pick presets, and generate embed URLs or iframe snippets."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 12
status: "published"
access: "public"
brand: "all"
actionUrl: "world-clock.html"
actionLabel: "Open Tool"
---

Track time across every city your team operates in. Configure the clock here, then embed it in Notion, dashboards, internal tools, or any HTML page.

---

## How It Works

1. **Add cities** with the search in the **Cities** section: type a city name, then pick it with a click or the arrow keys and Enter
2. **Or start from a preset** under the list, for common timezone groups (UK + US East, Global, etc.)
3. **Reorder the cities** by dragging a row by its handle, by clicking the handle for Move up, Move down, Move to top and Move to bottom, or by focusing the handle and using the arrow keys. The clock shows them left to right in the list's order
4. **Choose what each card shows** with the City, Timezone and Seconds switches in **Style**
5. **Pick a theme** there too, light or dark to match your Notion page background
6. **Copy embed URL** at the foot of the panel copies the embed URL for Notion's `/embed` command; **Copy embed code** beside it copies the iframe snippet for any HTML page. Both are readouts in **Export**, so you can read what you are about to paste

The clock at the top of the tool is the embed itself, so what it shows is what you paste. The Style reset puts the switches and the theme back; **Reset all** in the ⋯ menu puts the default cities back too.

---

## Embedding in Notion

1. Open the World Clock tool and configure your cities
2. Click **Copy embed URL** at the foot of the panel
3. In Notion, type `/embed` and paste the URL
4. Resize the embed block to fit your layout

---

## Embedding via Iframe

1. Configure your clock and click **Copy embed code** at the foot of the panel
2. Paste the snippet into any HTML page:

```html
<iframe src="{{brand:url}}/tools/world-clock-embed.html?cities=Europe/London,America/New_York,Asia/Tokyo" width="100%" height="140" frameborder="0" style="border:none;"></iframe>
```

---

## URL Parameters

The embed page accepts these URL parameters:

| Parameter | Default | Description |
|---|---|---|
| `cities` | `Europe/London,America/New_York,Asia/Tokyo` | Comma-separated IANA timezone identifiers |
| `showCity` | `true` | Set to `false` to hide city names |
| `showTz` | `true` | Set to `false` to hide timezone abbreviations |
| `showSeconds` | `false` | Set to `true` to show seconds |
| `interval` | `60` | Update interval in seconds |
| `theme` | `light` | `light` or `dark`, matches Notion's background |

---

## Supported Cities

The search includes 80+ major cities across all continents. Cities map to IANA timezone identifiers (e.g. `Europe/London`, `America/New_York`, `Asia/Tokyo`). You can also use any valid IANA timezone identifier directly in the URL.

---

## Files

| File | Purpose |
|---|---|
| `tools/world-clock.html` | Tool configuration page |
| `tools/world-clock-embed.html` | Standalone embed widget |
| `assets/js/world-clock-core.js` | Shared clock rendering logic |
| `assets/js/world-clock.js` | Tool page controller |
| `assets/css/world-clock.css` | Tool page styles |
