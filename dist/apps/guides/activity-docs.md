---
title: "Activity"
subtitle: "Who signed in, what they opened, what they downloaded"
description: "How the Activity page records sign-ins, page views and file downloads on {{brand:siteName}}, what it keeps and for how long, and how a site switches it on."
author: "Studio"
section: "Settings"
layer: "app"
order: 14
status: "published"
access: "owner"
brand: "internal"
actionUrl: "./activity.html"
actionLabel: "Open Tool"
---

[Activity](activity.html) answers one question: who has been using {{brand:siteName}}, and for what. It lists everyone who has signed in, when they last did, and every gated page they opened and file they downloaded. It is for the owner alone: the page by its level, and its data by the Worker, which checks your role on every request.

---

## What the page shows

**People** has one row per person the log holds, most recently seen first: their last sign-in, when they were last seen, and how many sign-ins, pages and downloads the log holds for them.

**Log** is every entry, newest first, a hundred at a time. Filter it by person, or by what happened, and press **Show older** for the hundred before.

| Entry | Recorded when |
|---|---|
| **Signed in** | A sign-in code is accepted |
| **Page** | A signed-in reader opens a page behind the sign-in, by a link, the sidebar or the address bar |
| **Download** | A signed-in reader downloads a file from the Asset Library. A thumbnail or a preview is not a download, and a download that resumes is counted once |

Public pages are not recorded: they are open to everyone, so who opened them is not the log's business. For anonymous traffic, use Cloudflare Web Analytics.

A page opened twice in a row through the sidebar can count once: the site keeps a page it has already shown, and showing it again asks nothing of the Worker.

---

## What it keeps

Each entry is four things: when, the reader's email, what happened, and the page or file. **No IP address, browser, device or search terms are recorded.** Names come from each person's sign-in record when the page is read, so the log itself holds only the email.

Entries are deleted after **13 months**. That is a year, plus a month, so this month can always be read beside the same month last year. Deletion runs as entries are written, at most once an hour, so the oldest entries can last an hour past their time.

Removing someone from [People](people.html) does not delete their entries: the log is a record of what happened. They stay until their 13 months are up.

---

## Switching it on

The log is off until a site asks for it, because it records named people. On a site of its own:

1. **Install the package.** Add `insights` to `install.packages` in `cms/docs.config.js`. That installs the page and switches the recording on, in one: the Worker records only while the app is installed.
2. **Copy the migration.** Run `npx bd-migrations` to copy `0016_activity.sql` into `worker/migrations/`.
3. **Apply it** to the site's database: `npx wrangler d1 migrations apply <database> --remote`. Until it is applied the site works as before and records nothing, and the page says the table is missing.
4. **Change the retention, if you need to.** Pass `activity: { retentionDays: 395 }` to `createGate()` in `worker/index.js` with another number of days.
5. **Tell the people it records.** The log names them, so say so before it starts.
