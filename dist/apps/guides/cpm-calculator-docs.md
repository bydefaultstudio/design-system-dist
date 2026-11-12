---
title: "CPM Calculator"
subtitle: "Plan campaign impressions, fees and payouts"
description: "Plan a campaign from a spend or an impressions goal at a CPM, with creative and hosting fees, a partner's share, a monthly breakdown and a table that pastes into a sheet."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 9
status: "published"
access: "team"
brand: "internal"
actionUrl: "./cpm-calculator.html"
actionLabel: "Open Tool"
---

Plans a campaign for media planners and sales teams: what a budget buys at a CPM, or what an impressions goal costs, then what the fees, the partner and the net come to — as one total, or month by month. The plan copies as a table that pastes into a spreadsheet as numbers and into a document as a formatted table.

---

## The layout

The tool sits on the [tool canvas](/docs/tool-canvas.html) in the Side panels layout: the plan in the preview, the controls docked on the right, **Copy table** pinned at the dock's foot. The toggle in the preview's corner folds the dock away, so the table takes the canvas while you share your screen. **Copy link** and **Reset all** are in the bar's menu.

| Section | Holds | Its reset puts back |
|---|---|---|
| **Campaign** | Plan by (Spend or Impressions); Spend or Impressions beside CPM; Currency; the Creative fee and Ad hosting fee switches side by side, each over its CPM; the Partner share switch over the name beside the share, with the Net share read out under it | Spend, £300,000, CPM 15, GBP, both fees off at 1, no partner at 70% — the partner's name stays |
| **Months** | The Monthly breakdown switch, then Start month beside Length (1–24), Spread (Even or Custom) and, in a Custom plan, a field per month, two to a row | Breakdown off, this month, 12 months, Even |
| **Saved plans** | A name and Save, and the plans saved in this browser, each loaded or deleted from its row | No reset: saved plans are your work |

---

## Plan by

Spend, CPM and impressions are tied: any two decide the third. **CPM is always typed** — it is the rate being sold. Plan by decides which of the other two you type:

- **Spend** — you have a budget and want to know what it buys.
- **Impressions** — you have an impressions goal and want to know what it costs.

Only the typed quantity has a field; the other is worked out and shown in the preview. Switching keeps the plan: the figure the other quantity had becomes the typed one. Impressions are whole numbers, so a plan switched to Impressions and back can come back a few pence different.

---

## The preview

The **figures** give the answers as cards, as the World Clock's are: the label and a quiet fact on one line — the months, the rate, the share, Net's share of the spend — and the value large and light under them, every value at the largest size the longest one fits. They run three across at most: Spend, Impressions and Net fill the first row, and the fees and the partner, when on, start the next. Then **Where the spend goes** splits the spend into its parts as a bar, shown once there are two parts or more. Each part has its own colour — the creative fee purple, ad hosting aqua, the partner pink, Net the accent — and the same colour keys its card and its legend line. Only an amount that is itself below zero turns red.

The **month table** shows only while the breakdown is on: a row per month with spend, impressions, each active fee, the partner and net, and a Total row. Each row is a card, the header a small plain label line, and the Total row sits on white under a rule. The table is read-only — the months are typed in the dock. From 960px the header, the Total row and the Month column stay in view as the table scrolls.

With the breakdown off the figures are the whole answer, so there is no table on screen.

---

## The monthly breakdown

| Spread | You type | Worked out |
|---|---|---|
| **Even** | The total | Each month: the total split evenly |
| **Custom** | Each month, in its field in Months | The total: the sum of the months. Its field shows the sum, read-only |

- Going from Even to Custom keeps the even split, ready to edit.
- Going from Custom to Even keeps the total and spreads it evenly again — the shape of the months is lost, and the tool says so.
- Turning the breakdown off keeps the total the months added up to. Turning it back on brings back the months you typed.
- Shortening a Custom plan hides the months at its end; lengthening it again brings them back while the page is open. A link or a saved plan keeps only the months in the plan.
- A month cannot be negative: it counts as 0, and the line under the months says so.

---

## Calculations

All money is worked in pence. Impressions typed are whole numbers.

```
Impressions     = Spend ÷ CPM × 1,000          (planning by spend)
Spend           = Impressions × CPM ÷ 1,000    (planning by impressions)
Creative fee    = Impressions ÷ 1,000 × Creative fee CPM
Ad hosting      = Impressions ÷ 1,000 × Ad hosting fee CPM
Net spend       = Spend − Creative fee − Ad hosting
Partner         = Net spend × Partner share %
Net             = Net spend − Partner
```

**Rounding is done by column, not by cell.** Each column's exact total is rounded to the penny once, and the months share it: a month takes its amount rounded down, and the pennies left over go to the months with the largest remainders. So six months of a £20,000 fee add up to £20,000 — never 6 × £3,333.33 — and the Total row always matches the figures. The month cells can differ from one another by a penny. Impressions worked out from a spend are shared out the same way, in whole impressions, so that column adds up too; the fees are worked from the exact figure.

**What the tool will not quietly accept:**

- **A CPM of 0 or empty** — nothing can be worked out, so every derived figure shows "–" and the CPM field says so.
- **Fees above the CPM** — net spend goes negative. The numbers still show, in the error colour, and the Fees section and the preview say why.

While you type in a number field, an error is only ever cleared: it is written when you leave the field, so passing through "1" on the way to "15" raises nothing.

**Currency** changes the symbol only. Amounts are not converted.

---

## Copy table

Copies the month table, header and Total row included — or, with the breakdown off, the campaign statement the figures show: the spend, the impressions, each fee taken off, the net spend, the partner's share taken off, and the net. Two forms at once; the app you paste into takes the one it reads:

- **For a spreadsheet** — tab-separated values with plain numbers (no symbol, no thousands separator) and the currency named in the header, `Spend (GBP)`. Deductions in the statement are negative, so a `SUM` down the column gives the net.
- **For a document** — a formatted table (`£300,000.00`) for email, Google Docs and Slides, Keynote or Notion. Each number also carries the spreadsheet hints Google Sheets and Excel read, so a sheet that takes this form still gets numbers.

A partner name that starts with `=`, `+`, `-` or `@` is copied with a leading `'`, so a spreadsheet never reads it as a formula. In the statement a deduction is copied with a minus. If the browser blocks the clipboard, the line above the button says so.

---

## Links and saved plans

Every change rewrites the page's address, so **Copy link** shares the exact plan. A breakdown's link always carries its start month, so it opens on the same months whenever it is opened.

Links and plans saved before the monthly breakdown existed still open: one with month values opens as a Custom breakdown starting in January this year; one without opens as its total.

Saved plans stay in this browser (`localStorage`), named as you choose. Saving under a name already used asks before replacing it, and deleting one asks first too — neither can be undone. If another tab changed the list, the tool redraws it rather than act on a plan the row no longer names.

---

## Default values

| Input | Default |
|---|---|
| Plan by | Spend |
| Campaign spend | £300,000 |
| Impressions (when planning by impressions) | 20,000,000 |
| CPM | £15 |
| Currency | GBP |
| Monthly breakdown | Off; when on, this month, 12 months, Even |
| Creative fee CPM, Ad hosting fee CPM | £1 each, when on |
| Partner share | 70%, when on |

---

## Technical notes

- `assets/js/cpm-calculator.js` (3.0.0) and `assets/css/cpm-calculator.css`; the page is the source pair `cms/apps/cpm-calculator.{md,html}`.
- One computation, `computePlan(state)`, is pure and feeds the figures, the split, the month table and the copied table. It is exposed as `window.CpmCalculator` and checked by `scripts/verify-cpm-calculator.js` in `npm test` — including against the 2.x formulas, to the penny.
- Self-registered on `bd:after-nav`, bound to the incoming page only; every lookup goes through the tool's root.
- Plain JavaScript, no dependencies.
