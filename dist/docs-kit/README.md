# Docs Kit

A markdown-to-HTML documentation site generator, shipped as part of the
`@bydefaultstudio/design-system` package. It reads markdown files with
frontmatter and produces a complete static docs site: sidebar navigation,
table of contents, copy buttons for tokens and code, prev/next page
navigation, dark mode, and the design system's styling out of the box.

## Install

```bash
npm install "github:bydefaultstudio/design-system-dist#semver:^7.5.0"
```

The generator is a tool, not an asset — run it in place from `node_modules`.
Do not copy it into your project.

## Quick start

1. Create a `docs/` folder at your project root containing your markdown
   files and a `docs.config.js`:

   ```
   my-project/
   ├── docs/
   │   ├── docs.config.js
   │   ├── getting-started.md
   │   └── reference.md
   └── package.json
   ```

2. A minimal `docs/docs.config.js`:

   ```js
   module.exports = {
     siteName: 'My Project',
     footerText: '© 2026 My Project',
   };
   ```

3. Every markdown file starts with frontmatter — `title` and `section` are
   the two that matter:

   ```markdown
   ---
   title: "Getting Started"
   subtitle: "First steps"
   section: "Guides"
   order: 1
   ---

   # Getting Started

   Your content here.
   ```

4. Add a build script to your `package.json` and run it:

   ```json
   "scripts": {
     "docs:build": "node node_modules/@bydefaultstudio/design-system/dist/docs-kit/generate-docs.js"
   }
   ```

   ```bash
   npm run docs:build
   ```

   The site lands in `docs/site/`. Serve that folder with any static server
   (e.g. `npx serve docs/site`). It is served as the site root by default;
   to serve it under a subpath instead, set `basePath` in `docs.config.js`
   (e.g. `basePath: '/docs/site'`) and every internal link resolves under it.

The generator finds your project by walking up from the working directory
until it sees `docs/docs.config.js` (or `cms/docs.config.js`); that directory
becomes the project root and all config paths resolve from it.

With no `designSystemPath` configured, the packaged `design-system.css` is
copied into the output automatically, so the site is fully styled with zero
config. Point `designSystemPath` at your own stylesheet to override.

Favicons are optional: drop `favicon.svg` and/or `favicon.ico` into
`<outputDir>/assets/icons/` and regenerate — the pages link them only once
the files exist (a `brandManifest` can also supply `faviconSvg`/`faviconIco`
paths directly).

## Watch mode

```bash
node node_modules/@bydefaultstudio/design-system/dist/docs-kit/watch-docs.js
```

Regenerates on every markdown or template change.

## Configuration reference

All keys are optional. Paths are project-root-relative; URL-ish keys
(`docsCss`, `highlightJs`, `extraStylesheets`, `uiScripts`, `extraScripts`)
are site-root-relative and get the correct `../` prefix per page depth
automatically — external URLs pass through untouched.

### Core

| Key | Default | What it does |
|---|---|---|
| `outputDir` | `<contentDir>/site` | where the generated site lands |
| `basePath` | `''` (site root) | URL prefix when the site is served under a subpath, e.g. `'/docs/site'`. Leading slash, no trailing slash — anything else fails the build. All internal links, nav, and asset manifest paths resolve under it |
| `siteName` | `Documentation` | title suffix + nav logo text |
| `indexDescription` | generic line | home page description |
| `footerText` | empty | footer line on every page |
| `designSystemPath` | packaged CSS | href of the design system stylesheet |
| `docsCss` | kit-bundled `docs.css` | href of the docs chrome stylesheet |
| `brandCssPath` | none | optional brand stylesheet (e.g. your `theme.css`); copied into the output and linked after the framework CSS so brand overrides win the cascade |
| `googleFontsUrl` | none | Google Fonts stylesheet URL |
| `iconsDir` | kit-bundled icons | folder of SVG icons for `{{icon:...}}` and chrome |
| `highlightJs` | cdnjs highlight.js | syntax-highlighting script source |
| `sectionFolders` | `{}` (flat output) | map of section label → output subfolder; mapped sections get overview index pages |
| `filenameOverrides` | `{}` | per-file output folder/name overrides |
| `indexCards` | derived from pages | curated home page card list (`{ title, href, subtitle }`) |
| `logoHtml` | site name as text | raw HTML for the site-header logo |
| `contactHref` / `contactLabel` | none | site-header contact link |
| `sectionIcons` | `{}` | map of section label → icon key for the sidebar |
| `uiScripts` | the kit set: the docs chrome (`bar`, `dropdown`, `breadcrumb`, `copy-button`, `swatch`, `docs-copy-chrome`) and every core component (`number-input`, `toast`, `dialog`, `accordion`, `tabs`, `rating`, `cell-input`, `chip`, `scroller`, `date-picker`, `password-toggle`, `field`), copied to `assets/docs-kit/`. A file your `extraScripts` already lists by the same name is left out, so nothing loads twice | script list for docs UI behaviours. Setting it replaces the whole kit set |
| `markdownSourceBase` | none | serve path of the .md sources; enables "view as markdown" menu items |
| `search` | `false` | the header search button and dialog. The kit ships no `search.js` or indexer, so leave it off unless the project supplies both |
| `validateLayers` | `false` | require a valid `layer:` field in every file's frontmatter |
| `pageTransitions` | `false` | animated Barba.js page transitions — **opt-in only**; read the "Page transitions" section before enabling |
| `feedback` | `false` | the feedback form: "Was this helpful?" at the foot of every page, Share feedback and Report a problem in the bar's menu, and one shared dialog. **Opt-in only**: it needs your Worker's `/api/submit-form`; read the "Feedback" section first |
| `feedbackScript` | kit copy | where the site serves `feedback.js`, when it keeps its own copy; unset, the kit ships it to `assets/docs-kit/feedback.js` |
| `glossaryDrawer` | `true` | the glossary reading drawer, shipped whenever `cms/glossary/` exists; set `false` when the site loads and starts `glossary.js` itself. Read the "Glossary" section |
| `showcase` | `false` | By Default OS's Showcase: public `/showcase/` pages from `cms/showcase/`, `worker/showcase-assets.mjs`, and two cursor drawings under `assets/images/svg-cursors/` |
| `siteMap` | `false` | writes `experiments/site-map-data.js`, every page as data for the site-map experiment |
| `accessGate` | `false` | writes `worker/page-access.mjs` and draws a `lock` icon on the rows `nav.js` locks; the project's icon set must hold `lock` |
| `assetLibrary` | `false` | writes `worker/library-index.mjs`, the Asset Library's download map |

### Extension surface

Everything project-specific beyond the core arrives through these. All
default to off; the kit runs fine with none of them set.

| Key | Injected where |
|---|---|
| `extraHeadHtml` | end of `<head>` |
| `extraStylesheets` | `<link>` tags after the docs CSS |
| `extraScripts` | `<script defer>` tags after the UI scripts |
| `extraContentHtml` | inside the page container, after prev/next nav |
| `extraBodyEndHtml` | just before `</body>` |
| `bodyAttrs` | raw attribute string on `<body>` |
| `wrapperAttrs` / `containerAttrs` | raw attribute strings on the two divs wrapping page content |
| `brandManifest` | path to a `brand.json` that supplies site name, description, footer, favicons, and font sources (Typekit id, font preloads, Google Fonts) |
| `brandsDir` | folder of brand spaces (`<brand>/brand.json` + assets + markdown) to build as themed sub-sites |

Injected strings may contain template placeholders — most usefully
`{{NAV_BASE}}`, which resolves to the correct relative prefix for each page's
depth.

## Frontmatter reference

| Field | Purpose |
|---|---|
| `title` | page title (required) |
| `subtitle` | shown under the title and on cards |
| `description` | meta description |
| `section` | navigation group (required for grouping) |
| `subsection` | collapsible group inside a section |
| `order` | sort position within the section |
| `toc: false` | hide the table of contents |
| `bar: false` | hide the breadcrumb bar |
| `pagination: false` | hide prev/next links |
| `status: draft` | skip the page |
| `dropcap: true` | drop cap on the first paragraph |
| `actionUrl` / `actionLabel` | call-to-action button in the page header |
| `scripts` | comma-separated per-page script registry keys (e.g. `splide`) |

Folder-wide defaults go in `_defaults.md` next to your markdown files —
useful keys: `section-order`, `subsection-order`, `author`.

## Markdown extras

- `` `.class-name` ``, `` `var(--token)` ``, and `` `#a1b2c3` `` inline code
  become click-to-copy chips (hex chips get a colour swatch).
- Token tables get copy buttons automatically; code blocks get a copy button.
- `{{icon:name}}` inlines an SVG icon from `iconsDir`.
- `{{icon-registry}}` on its own line expands to a table of every icon.

## Tables

Markdown tables work out of the box. After conversion, every bare `<table>`
is wrapped in a scroll container and given the design system's base class:

```html
<div class="table-scroll"><table class="table">…</table></div>
```

That buys, with zero markup from the author:

- horizontal swipe-scrolling when a table is wider than the page
- a right-edge fade hint while more columns are off-screen, gone once the
  reader scrolls to the end (the kit's page template ships the small script
  that drives it — nothing to wire)
- condensed cell padding on small screens

Hand-written HTML tables inside markdown are skipped by the wrapper pass
(any `<table>` already carrying attributes passes through untouched) — give
those the same wrapper + base class yourself and compose the modifiers:

| Class | Effect |
|---|---|
| `.table-full` | width 100% |
| `.table-hover` | hover highlight on body rows |
| `.table-header-filled` | filled header cells |

Table styling lives in the design system stylesheet, not the docs chrome CSS
— if you point `designSystemPath` at your own stylesheet, bring the `.table`
and `.table-scroll` rules with you or tables render unstyled. The same applies
to `.site-header`, `.nav` and `.bar`: they are design system components,
so a custom `designSystemPath` must supply them or the docs chrome loses its
header and page sub-header.

## Page transitions

`pageTransitions: true` turns the docs site into a single-page experience:
navigations are fetched and animated instead of hard-loaded, with a
directional scenario system driven by the page hierarchy the generator
already emits — drilling into a doc slides up over its receding index,
backing out slides down, sibling pages slide left and right in reading
order, and anything unresolvable crossfades.

**This is off by default, and enabling it is a decision, not a default.**
Page transitions change how every script on your site runs: the page is no
longer reloaded between navigations, so anything that assumes a fresh page
per URL is now wrong. Do not enable it without reading this section, and
expect to audit your page scripts when you do.

### What the flag does

- Emits `data-barba="wrapper"` / `data-barba="container"` markup, with the
  scenario attributes (`data-level`, `data-section`, `data-order`) resolved
  per page.
- Copies the transition assets into the output (`assets/docs-kit/`):
  `barba-docs.js`, `barba-transitions.css`, and a vendored `@barba/core`
  2.9.7 (MIT — license ships alongside).
- Links the stylesheet before your `extraStylesheets` (your overrides win)
  and loads the two scripts after your `extraScripts` (your modules are in
  document order before the router boots).

If your `wrapperAttrs`/`containerAttrs` already carry a `data-barba`
attribute, you own your Barba wiring outright and the flag is skipped
entirely, with a build warning — loading a second copy of Barba next to
your own would boot two routers and intercept every click twice. Use manual
wiring or the flag, never both.

### Conflicts checklist — read before enabling

- **Scripts run once per session, not once per page.** `DOMContentLoaded`
  fires only on the first load. A module that binds only there is inert
  after the first navigation, with a clean console.
- **Head scripts and stylesheets are never synced across a navigation.**
  Every page must load the full script and style set. Meta tags (title,
  description, OG/Twitter, canonical) are synced; `<script>` and
  `<link rel="stylesheet">` are deliberately not.
- **Sticky and fixed elements inside the container ride the transition
  transform.** During a transition the containers are absolutely positioned
  and translated; `position: sticky`/`fixed` descendants move with them. If
  something must stay put, fade it via `body.is-animating` styling or mount
  it outside the wrapper.
- **In-page state does not survive navigation away and back** unless your
  scripts rebuild it on arrival.
- **Pages outside the generated output have no Barba markup.** A link into a
  hand-authored page fails the router's container lookup. List such pages in
  `preventPaths` so the router leaves them to the browser.
- **Dark-first sites:** the transition backdrop falls back to white when
  `--background-primary` is undefined. Define the token (the packaged
  design-system CSS does) or override `[data-barba="container"]`'s
  background in your own stylesheet.

### The page-module contract

Any script that touches page content must:

1. Register its init on **both** `DOMContentLoaded` and the `bd:after-nav`
   event (dispatched on `document` after every completed navigation, once
   the new container is settled and the old one removed).
2. Be **idempotent** — guard with a `dataset` flag or equivalent so running
   twice on the same node is harmless.
3. Scope its queries to `event.detail.container` rather than `document`
   where possible.
4. Tear down document/window listeners, observers, and timers on
   `bd:before-nav` (dispatched before the leave animation, with the
   departing container in `event.detail.container`).

The router also does three things of its own around a swap. Before leaving
it closes any open dialog or drawer (`dialog.js`, in the default `uiScripts`),
after `bd:before-nav` and before your `onBeforeLeave`, so `onBeforeLeave`
always sees dialogs closed; a dialog in the arriving page's markup that is
`open` arrives closed too. On arrival, before the enter animation, it prunes
empty card sections under `accessNav: 'hidden'` and locks the arriving page's
links, and it refuses a click on a locked link once the session is known.

Scripts placed *inside* the container are re-executed on every arrival
automatically; scripts matching the library patterns (`/vendor/`, common
CDNs) load once and are skipped after.

### Scenario contract

The resolver reads `data-level` (1 = section index, 2 = doc page),
`data-section`, and `data-order` from the container — all emitted by the
generator. Pages without `data-level` (e.g. custom markup) resolve to the
`fade` scenario by design. Motion timing comes from the design system's
`--motion-page-*` tokens, with working fallbacks when they are absent.

### Options

For site-specific behavior, set `window.bdBarbaOptions` in any script loaded
before the router — anything in `extraScripts`, or inline HTML in
`extraBodyEndHtml` (an *external* script added there loads too late; use
`extraScripts` for files). All keys optional:
`preventPaths` (RegExp[] the router must not intercept), `preventWhen`
(predicate), `libraryPatterns` (RegExp[], appended), `metaSelectors`
(string[], appended), `transitionMap` (per-scenario animation overrides),
`onBeforeLeave(data)`, `onAfterNav(container)`, `onNextDocument(doc)`,
`timeout` (ms, default 5000), `cacheIgnore` (default `false` — set `true`
if your pages vary per request), `prefetchIgnore` (default `true`).

### Enabling it later

A site built without transitions upgrades cleanly: add
`pageTransitions: true` to `docs.config.js`, rerun the build, and audit
every page script against the contract above. The markup is generated, so
nothing else changes by hand. To back out, remove the key and rebuild.

No verification tool ships with the kit — after enabling, click through a
section index, a doc page, sibling pages in both directions, and any page
with custom scripts, and check the console on each navigation.

## Feedback

`feedback: true` gives every page the same feedback form every By Default OS
hub runs, so feedback from all of them lands in one Notion database, tagged by
the hub it came from.

What the generator adds:

- **The footer block** on every page with the footer: "Was this helpful?" with
  Yes and No. Yes records a thumbs up at once and offers "Tell us more"; No
  opens the dialog.
- **Share feedback and Report a problem** at the end of the doc bar's menu.
  A tool page that authors its own bar adds the same two items itself:
  `<button type="button" class="dropdown-item" data-feedback-open="share">` and
  `data-feedback-open="problem"`, each in a `bar-group` with
  `data-priority="menu"`.
- **The dialog**, once per page at the end of `<body>`, outside any page
  container: topic chips, a message, an optional "This is stopping me working"
  switch for a bug, and a follow-up switch. It closes on sending; the footer
  thanks the reader, or `showToast` does when the dialog opened from a bar.
- **`feedback.js`**, shipped to `assets/docs-kit/feedback.js` unless
  `feedbackScript` names your own copy.

What your site must already have: the design system's CSS, `dialog.js`
(the dialog, chips and switches are engine components) and `toast.js` for the
bar's thank-you (both in the kit's default `uiScripts`; without `toast.js` the
dialog still closes, silently), and the kit's `docs.css` or your own copy of
its feedback rules.

**The server is yours to provide.** The form POSTs to `/api/submit-form` with
`{ formType: "feedback", data, hp }` and expects the sign-in session cookie.
**Today this copy does not work:** `submit-form.js` imports `gate.mjs` and
`session.js`, which the package does not export, so leave `feedback` off until
the engine ships the forms route. The steps, for reference: copy
`worker/submit-form.js` and `worker/notion-config.js` from the design
system repo into your Worker, route `/api/submit-form` to
`handleSubmitForm`, add your hub's host to `ALLOWED_APEXES`, and set:

| Name | Kind | Value |
| --- | --- | --- |
| `FEEDBACK_HUB` | var (`wrangler.jsonc`) | the name entries are filed under, e.g. `Acme`. No commas, 100 characters at most |
| `NOTION_API_KEY` | secret | the Notion integration token |
| `NOTION_DATABASE_ID_FEEDBACK` | secret | the Feedback database's ID |

The hub, the reader's email (only when they turn follow-up on), the type and
the status are written by the server, never taken from the browser.

## Glossary

A `cms/glossary/` folder, one markdown file per term plus `_tags.json`,
builds the glossary: the `{{glossary-terms}}`, `{{glossary-topics}}` and
`{{glossary-count}}` placeholders on your glossary page, one page per
published term at `/glossary/<slug>.html`, and the feed at
`/glossary/index.json`.

**The reading drawer comes with it.** When the folder exists, the generator
ships two scripts to `assets/docs-kit/` and loads them after every other
script:

- **`glossary.js`** filters the cards by search and topic, and opens a term
  in a drawer instead of leaving the page. The term's own page stays the
  link, so sharing, search engines and readers without JavaScript still get
  it, and `?term=` and `?topic=` in the address open a term or a topic
  straight away.
- **`glossary-init.js`** starts it on load and after every page transition
  (`bd:after-nav`), since a docs-kit site has no `bd-site-init.js`.

The drawer's styles are in the kit's `docs.css`.

What your site should already load, before the kit's scripts:

- **The design system's CSS.** The drawer is the engine's `.drawer`.
- **`dialog.js`**, in the kit's default `uiScripts` (or from the package's
  `dist/js/` if you set your own list). It gives the drawer its
  opening and closing motion, and its drag to close. Without it the drawer
  still opens as a plain modal and closes on Escape.
- **`scroller.js`**, also in the default `uiScripts`. It fades the edges of the
  drawer's one-line topic row and turns the mouse wheel into sideways
  scrolling. It's optional: the row scrolls without it.

The A to Z rail beside the list needs `az-index.js`, which the kit does not
ship. A rail written into your glossary page stays hidden without it, and
the list works as before.

When a term's page answers 401 (a site behind a sign-in whose session has
ended), the drawer offers "Sign in again" linking to `/auth/login.html`,
which is the access gate's login page. A site whose sign-in lives elsewhere
should redirect that path.

Set `glossaryDrawer: false` if your site loads `glossary.js` itself and calls
`window.initGlossary`. Otherwise the kit's copy loads it a second time.

## Versioning

The docs kit has no version of its own — it is versioned by this package.
Upgrading the package upgrades the generator.
