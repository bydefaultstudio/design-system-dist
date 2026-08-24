# Docs Kit

A markdown-to-HTML documentation site generator, shipped as part of the
`@bydefaultstudio/design-system` package. It reads markdown files with
frontmatter and produces a complete static docs site: sidebar navigation,
table of contents, copy buttons for tokens and code, prev/next page
navigation, dark mode, and the design system's styling out of the box.

## Install

```bash
npm install "github:bydefaultstudio/design-system-dist#semver:^4.5.0"
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
| `uiScripts` | kit-bundled copy-button + dropdown | script list for docs UI behaviours |
| `markdownSourceBase` | none | serve path of the .md sources; enables "view as markdown" menu items |
| `validateLayers` | `false` | require a valid `layer:` field in every file's frontmatter |
| `pageTransitions` | `false` | animated Barba.js page transitions — **opt-in only**; read the "Page transitions" section before enabling |

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

## Versioning

The docs kit has no version of its own — it is versioned by this package.
Upgrading the package upgrades the generator.
