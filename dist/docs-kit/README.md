# Docs Kit

A markdown-to-HTML documentation site generator, shipped as part of the
`@bydefaultstudio/design-system` package. It reads markdown files with
frontmatter and produces a complete static docs site: sidebar navigation,
table of contents, copy buttons for tokens and code, prev/next page
navigation, dark mode, and the design system's styling out of the box.

## Install

```bash
npm install "github:bydefaultstudio/design-system-dist#semver:^8.1.0"
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
the files exist (`brand.json` can also supply `favicons.svg` and
`favicons.ico` paths directly).

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
| `retiredSections` | `{}` | map of renamed section label → its new label; docgen fails on a page that still names the old one |
| `filenameOverrides` | `{}` | per-file output folder/name overrides |
| `indexCards` | derived from pages | curated home page card list (`{ title, href, subtitle }`) |
| `logoHtml` | site name as text | raw HTML for the site-header logo |
| `contactHref` / `contactLabel` | none | site-header contact link |
| `sectionIcons` | `{}` | map of section label → icon key for the sidebar |
| `uiScripts` | the kit set: the docs chrome (`bar`, `dropdown`, `breadcrumb`, `copy-button`, `swatch`, `docs-copy-chrome`) and every core component (`number-input`, `toast`, `dialog`, `accordion`, `tabs`, `rating`, `cell-input`, `chip`, `scroller`, `date-picker`, `password-toggle`, `field`), copied to `assets/docs-kit/`. A file your `extraScripts` already lists by the same name is left out, so nothing loads twice | script list for docs UI behaviours. Setting it replaces the whole kit set |
| `markdownSourceBase` | none | serve path of the .md sources; enables "view as markdown" menu items |
| `search` | on with `install`, else `false` | the header search button, its dialog and `/search.html`. Run `npx bd-search` from the site root after the site is assembled to build the indexes; `false` opts out. A site that sets its own `uiScripts` lists `search.js` itself. Node 20.19 or later |
| `validateLayers` | `false` | require a valid `layer:` field in every file's frontmatter |
| `transitions` | the kit's defaults | which named transition each navigation scenario plays, e.g. `{ open: 'fade' }`. The router is on for every site; read the "Page transitions" section |
| `feedback` | `false` | the feedback form: "Was this helpful?" at the foot of every page, Share feedback and Report a problem in the bar's menu, and one shared dialog. **Opt-in only**: it needs `forms` passed to `createGate()` and the `SITE_KEY` secret; read the "Feedback" section first |
| `feedbackScript` | kit copy | where the site serves `feedback.js`, when it keeps its own copy; unset, the kit ships it to `assets/docs-kit/feedback.js` |
| `glossaryDrawer` | `true` | the glossary reading drawer, shipped whenever `cms/glossary/` exists; set `false` when the site loads and starts `glossary.js` itself. Read the "Glossary" section |
| `showcase` | `false` | By Default OS's Showcase: public `/showcase/` pages from `cms/showcase/`, `worker/showcase-assets.mjs`, and two cursor drawings under `assets/images/svg-cursors/` |
| `siteMap` | `false` | writes `experiments/site-map-data.js`, every page as data for the site-map experiment |
| `accessGate` | `false` | the access gate's side of the site: writes `worker/page-access.mjs`, draws a `lock` icon on the rows `nav.js` locks, and, on a site that installs, builds the sign-in, Ask for access and locked pages and loads the gate's scripts. Read the "Access gate" section |
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
| `brandManifest` | path to the site's `brand.json` (see below). Defaults to `cms/brand.json` when that file exists |
| `brandOutputs` | where the two files generated from `brand.json` are written, from the output root: `{ themeConfig: 'assets/js/theme-config.js', logoManifest: 'assets/js/logo-manifest.js' }` by default. Serve the logo manifest from a gated folder if your artwork is private |
| `allowWording` | engine-brand mentions a client site keeps on purpose, each `{ file, text, reason }`. The build fails on any other (see below) |
| `doorFilesAddedLater` | site paths a public door page loads that a build step after docgen copies into the output, such as `['/media/fonts/x.woff2']`. The door check fails on any other file it can't find (read "Access gate") |

`brandsDir` has been removed: a site holds one brand. A config that still
sets it gets a warning and the key is ignored.

Injected strings may contain template placeholders — most usefully
`{{NAV_BASE}}`, which resolves to the correct relative prefix for each page's
depth.

## brand.json

One file holds every brand value the engine reads: the name, colours, logos,
wording and the ask-for-access route. The build validates it on every run and
writes `theme-config.js` and `logo-manifest.js` from it, so neither is ever
hand-kept. The engine only reads it; an update never writes your brand data.

A JSON Schema ships beside the generator for editor autocompletion. Put this
first in the file:

```json
"$schema": "../node_modules/@bydefaultstudio/design-system/dist/docs-kit/brand.schema.json"
```

### Version 1

| Field | Required | What it is |
|---|---|---|
| `version` | yes | `1` |
| `name` | yes | The brand's name. The site is always called "<name> OS"; never add "OS" here |
| `slug` | yes | Lower-case and hyphenated. It names the sender address and the subdomain |
| `url` | yes | The site's https address, no trailing slash |
| `description`, `footerText` | yes | The site description and the footer line |
| `fonts` | no | `{ googleFontsUrl, typekitId, preload: [paths] }` |
| `favicons` | no | `{ svg, ico }`, site paths |
| `ogImage` | no | An absolute https address |
| `colours.hues` | yes | The hues the colour tools offer, in grid order. Each needs `-dark`, base, `-light` and `-lighter` tokens in your theme |
| `colours.named` | no | The brand's colours as Figma names them: `{ id, label, token, group }`, group `primary` or `secondary`. Set it when a hue's base step is a text ink rather than the brand colour, so the tools show the brand colour |
| `colours.pairings`, `colours.toolPairings` | no | `{ fg, bg }` token pairs: Colour Pairing's recommendations, and every other tool's Pairs row (defaults to `pairings`) |
| `logos.clearSpaceGlyph` | yes | `{ label, file }`: the glyph X is measured from. Its viewBox is the glyph's own box, starting at x 0 |
| `logos.primary` | yes | The id of the variant the clear-space rule is stated on. List it first |
| `logos.spec` | no | The clear-space rule as a Layout Spec, exported from the Layout Specs tool, drawn round every logo without a spec of its own. Left out, the plain ring at `--artwork-logo-clear-space` X |
| `logos.variants` | yes | `{ id, label, file, minWidth, clearSpace: { paths, label } }`, plus optional `shortLabel`, `rotate` and `spec` (the logo's own Layout Spec) |
| `logos.colourways` | yes | `{ id, label, value, bg: { id, value } }`, in hex: an exported file can't resolve a token |
| `wording.organisation` | no | Who app copy names: who to tell when something breaks, who a licence names. Defaults to `name` |
| `wording.website` | no | The organisation's own website, when it differs from `url`. Defaults to `url` |
| `wording.supportEmail` | no | The address a reader writes to when a form can't send, named in the Ask for access form's error. One plain address |
| `access.turnstileSiteKey` | no | The spam check's site key on the Ask for access page, given with the form service's address. Public. Left out, a signed-out reader's request is refused |
| `access.requestRoute` | no | No longer read: Ask for access is `/support.html` on every site. The build warns until it is deleted |
| `emailSignature` | no | The Email Signature tool's settings. `base` is a permanent address: sent signatures fetch their images from it forever |

Logo `file` paths are from the project root. The build inlines each SVG's
markup into the logo manifest, so an export never taints a canvas.

### Clear space is required, and calculated

Every logo variant needs `clearSpace.paths`: the glyph's paths in that file,
numbered from 1 in the order it draws them. The build measures X off them,
the glyph's width in that logo's viewBox, so no X is ever typed by hand. It
fails when a variant has none, when a path doesn't exist or the file carries
a transform, when X is wider than the logo, when the primary's X isn't the
glyph's width, when the glyph's viewBox doesn't start at x 0, or when the
primary isn't listed first.

### {{logo-spec:id}} in guide pages

A line holding only `{{logo-spec:primary}}` draws that logo with its Layout
Spec (its own, else `logos.spec`, else the plain ring) and a caption giving
X. It uses the same data as the Logo Tool, so a guide can't disagree with it.
The page needs `layer-stack.js` and the logo manifest.

### Older files

A `brand.json` with no `version` is version 0. The build moves what it can
in memory and prints a warning, then fails listing each field you must add.
To rewrite the file in the new shape:

```bash
npx bd-brand upgrade
```

It keeps the original beside it as `brand.json.bak`, and lists what is still
to do by hand.

### {{brand:key}} in app pages

A tool page's HTML body can use `{{brand:name}}`, `{{brand:siteName}}`,
`{{brand:slug}}`, `{{brand:url}}`, `{{brand:organisation}}`,
`{{brand:website}}` and `{{brand:websiteHost}}`. An unknown key fails the
build.

### No engine wording on your pages

On a client site the build fails when a page it wrote shows the engine's own
name or addresses: a page started from the engine's copy, for example. The
footer's one engine credit line is the exception. Keep a mention on purpose by
adding `{ file, text, reason }` to `allowWording`.

## Apps

Every app ships in the package, in `dist/apps/`. A site installs packages of
them in `docs.config.js`:

```js
install: {
  packages: ['brand', 'utilities'],    // core (People) is always on
  off: ['color-palette'],              // switch single apps off inside a package
},
```

| Package | Apps |
|---|---|
| `core` | People (needs `accessGate: true`) |
| `brand` | Asset Library, Colour Pairing, Colour Palette, Icon Library, Layout Specs, Logo Tool, QR Code |
| `formats` (needs `brand`) | Format Library |
| `utilities` | CPM Calculator, Email Signature, Image Placeholder, SVG Cleaner, World Clock |
| `web` | the Components section (`components/`, or `web/` on a site that kept the old folder) |

An installed app gets its page in `tools/`, and its scripts and styles, with the
libraries they need, load on every page, in dependency order, so a page
transition into an app finds it ready. The build copies each file to the same
path it has in the engine (`assets/js/logo-tool.js`), and stops if the site
has its own copy there: delete it, since the engine ships it now. The brand's
`theme-config.js` and `logo-manifest.js` are loaded by the engine too, so they
leave `extraScripts`.

Each app's manifest is its frontmatter in `dist/apps/<slug>.md`: `version`,
`status` (stable, beta, draft), `package`, `needs`, `scripts`, `styles`,
`guide`. A
site's own `cms/apps/<slug>.md` or `.html` replaces the package's copy, and
the build says so on every run. Every full build writes `os.json`: the
engine's version, `brand.json`'s version as the file is written (`brand`,
null without one), the packages, and each installed app with its version,
status and package. A site not on `install` yet writes `packages` and `apps`
as `null`. The build checks the file before writing it, and
`os.schema.json` ships beside the generator with the same shape. It carries no
build time, so two builds of the same tree are byte-identical, and it stays
behind the gate at team level: your Worker sends it to the fleet service
itself (see "Version reports").

Each app's guide ships with it (`guide` in the manifest, the files in
`dist/apps/guides/`), and the build makes its page in the guide's own section,
`tools/<app>-docs.html` for most. A site's own `cms/<app>-docs.md` replaces the
package's, and the build says so on every run. An app that isn't installed
has no guide page, even where the site keeps the file. Guides name the site
with `{{brand:key}}`, which works in any markdown page, frontmatter title,
subtitle and description included; `\{{brand:key}}` stays as written. On a
site with no `brand.json`, `{{brand:url}}` is `siteUrl`, which the utilities
and formats guides need. A guide's link to a page the site doesn't have reads
as plain text.

An app the site doesn't install keeps its address: the Worker answers it, and
its guide's, with `not-installed.html` and a 404, naming the app and pointing
the reader to the site's owner. The build writes those addresses to
`page-access.mjs` as `NOT_INSTALLED`; pass it to `createGate({ notInstalled })`
and ship `not-installed.html` (with `assets.html_handling: "none"`, as the
gate already needs). A site's own `cms/not-installed.md` replaces the
engine's.

Three sections come with a package, by their folder: `brand/` (the Brand
Book) with `brand`, `components/` (and `web/`, its old folder) with
`web` and `formats/` with `formats`. With its
package off, a section builds no pages, no index and no home card, and its
addresses answer like an uninstalled app's. Every other section is the
site's own and always builds. A link from the site's own pages to an app or
section it doesn't install fails the build.

Apps with a server route get it from the engine's gate. Pass `apps: APPS`
(from `page-access.mjs`) to `createGate()`, and it mounts the Image
Placeholder's public `/image`, with the brand's primary logo, and the Asset
Library's gated `/files/`, served from the R2 binding `LIBRARY` with
`library: { index, downloadAccess }` from `library-index.mjs`. An app's embed
(the World Clock's, the Format Library's) is public and frameable while the
app is installed. Switch an app off and its route and embed go with it.

The Tools index is a bookshelf: one cover per tool, which opens the tool. The
covers show each tool's drawing once every tool on the shelf has one.

Without `install`, a site keeps every `cms/apps/` page it has and loads app
files itself, as before.

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

Every site runs the kit's router, `barba-docs.js` (engine parity C3): there is
no flag, and no site ships a router of its own. Navigations are fetched and
animated instead of hard-loaded, with a directional scenario system driven by
the page hierarchy the generator already emits. Drilling into a doc slides up
over its receding index, backing out slides down, sibling pages slide left and
right in reading order, and anything unresolvable crossfades. Under reduced
motion every scenario is a short crossfade instead.

Page transitions change how every script on your site runs: the page is no
longer reloaded between navigations, so anything that assumes a fresh page per
URL is wrong. Check your page scripts against the contract below, and run
`npx bd-verify-router` (below) after any change to the scripts a site loads.

### What the generator does

- Emits `data-barba="wrapper"` / `data-barba="container"` markup, with the
  scenario attributes (`data-level`, `data-section`, `data-order`) resolved
  per page. `wrapperAttrs` and `containerAttrs` may add attributes of your
  own, but a `data-barba` attribute in either fails the build.
- Copies the router's files into the output (`assets/docs-kit/`):
  `barba-docs.js`, `barba-transitions.css`, and a vendored `@barba/core`
  2.9.7 (MIT, licence alongside).
- Links the stylesheet before your `extraStylesheets` (your overrides win) and
  loads the two scripts after your `extraScripts`, so your modules are in
  document order before the router boots.

### What the router does on its own

- **Closes any open dialog or drawer** (`dialog.js`, in the default
  `uiScripts`) before leaving, after `bd:before-nav` and before your
  `onBeforeLeave`, so `onBeforeLeave` always sees dialogs closed.
- **Moves focus to the arriving page's `<main>`**, or to the heading a
  fragment names, so a keyboard or screen-reader user starts at the content
  rather than the top of the header. An unnamed `<main>` is named after the
  page's heading, so a screen reader says "Button, main". It takes no focus
  ring, and its temporary `tabindex` goes on the first blur: the next Tab
  reaches the first control, which shows its own. A module that has already
  put focus in the arriving page keeps it.
- **Makes the leaving page `inert`** for its slide, out of the accessibility
  tree and the tab order, from the moment `is-animating` goes on.
- **Reloads a page the browser restores mid-transition** from its
  back-forward cache, which would otherwise come back with both containers.
- **Takes Barba's `aria-live` off the wrapper.** Left on, the whole page is a
  live region and every tool readout is announced; the focus move is the
  arrival cue instead.
- **Leaves the door and every bare page to the browser**, read from
  `window.bdPaths`, which `nav.js` writes before the router loads: the login
  page's folder (`/auth/`, Worker routes as well as pages, sign-out among
  them), `/api/`, Ask for access (`/support.html`) and each `bare` page the
  build writes, all under your `basePath`. A bare page has no container, so
  a swap into one would reload the page it left. No link needs
  `data-barba-prevent` for any of these. Add your own with `preventPaths`.
  On a page without `nav.js` the router falls back to path segments
  (`auth/`, `api/` and `support.html` at any depth). A script that navigates
  with `barba.go()`, which skips this rule, asks
  `window.bdRouterPrevents(href)` first and loads in full when it says so.
- **Locks and prunes on arrival.** Before the enter animation it prunes empty
  card sections under `accessNav: 'hidden'` and locks the arriving page's
  links, and it refuses a click on a locked link once the session is known.

### Conflicts checklist

- **Scripts run once per session, not once per page.** `DOMContentLoaded`
  fires only on the first load. A module that binds only there is inert after
  the first navigation, with a clean console.
- **Head scripts and stylesheets are never synced across a navigation.** Every
  page must load the full script and style set. Meta tags (title, description,
  OG/Twitter, canonical) are synced; `<script>` and `<link rel="stylesheet">`
  are deliberately not.
- **Sticky and fixed elements inside the container ride the transition
  transform.** During a transition the containers are absolutely positioned
  and translated; `position: sticky`/`fixed` descendants move with them. If
  something must stay put, fade it via `body.is-animating` styling or mount it
  outside the wrapper.
- **In-page state does not survive navigation away and back** unless your
  scripts rebuild it on arrival.
- **Pages outside the generated output have no Barba markup.** A link into a
  hand-authored page fails the router's container lookup, and the router
  reloads the page it left. List such pages in `preventPaths`. A generated
  `bare` page needs no entry: the router already knows it.
- **Dark-first sites:** the transition backdrop falls back to white when
  `--background-primary` is undefined. Define the token (the packaged
  design-system CSS does) or override `[data-barba="container"]`'s background
  in your own stylesheet.

### The page-module contract

The router names no module. Any script that touches page content must:

1. Register its init on **both** `DOMContentLoaded` and the `bd:after-nav`
   event. It is dispatched on `document` in Barba's `after` hook, once the old
   container is gone, `is-animating` is off and the layout is final, with the
   arriving container in `event.detail.container`.
2. Be **idempotent**: guard with a `dataset` flag or equivalent so running
   twice on the same node is harmless.
3. Scope its queries to `event.detail.container` rather than `document` where
   possible.
4. Tear down document/window listeners, observers, and timers on
   `bd:before-nav` (dispatched in `beforeLeave`, before the leave animation,
   with the departing container in `event.detail.container`).

Listeners run in registration order, so a module whose `bd:after-nav` work
another module depends on loads first (`bd-video.js` before `gallery.js`).
Declare it with `loadsAfter` in the module's ledger entry, and
`npx bd-verify-router` fails when the site loads them the other way round.

Scripts placed *inside* the container are re-executed on every arrival;
scripts matching the library patterns (`/vendor/`, common CDNs, Splide,
highlight.js) load once and are skipped after, and data blocks
(`type="application/json"`) are never re-run.

### Scenarios and the transition library

The resolver reads `data-level` (0 = home, 1 = section index, 2 = doc page or
tool), `data-section`, and `data-order` from the container, all emitted by the
generator. Pages without `data-level` (custom markup) resolve to `fade` by
design. Motion timing comes from the design system's `--motion-page-*` tokens,
with working fallbacks when they are absent.

| Scenario | When | Default |
|---|---|---|
| `open` | deeper (home to index, index to page), or a page in another section | `slide-up` |
| `close` | shallower (page to index) | `slide-down` |
| `swap` | a sibling forward in reading order, or index to index | `slide-left` |
| `swap-back` | a sibling backward in reading order | `slide-right` |
| `fade` | anything the resolver can't place | `fade` |

The library today: `slide-up`, `slide-down`, `slide-left`, `slide-right`,
`fade`. Choose per scenario in `docs.config.js`:

```js
transitions: { open: 'fade', close: 'fade' },
```

The build fails on a scenario or a transition name that doesn't exist. Each
transition still takes its scenario's motion token, so timing follows intent.
New transitions join the kit's library and reach every site by version bump.

### Options

For site-specific behaviour, set `window.bdBarbaOptions` in any script loaded
before the router: anything in `extraScripts`, or inline HTML in
`extraBodyEndHtml` (an *external* script added there loads too late; use
`extraScripts` for files). The router reads it once, when it loads. All keys
optional:

- `preventPaths` (RegExp[] the router must not intercept), `preventWhen`
  (predicate)
- `libraryPatterns` (RegExp[], appended), `metaSelectors` (string[], appended)
- `transitionMap` (per-scenario names, applied after `transitions`)
- `motion`: element motion played at the moments the layout each step needs is
  true. `bd-animate.js` registers it itself; a site sets it only to replace
  the engine. `{ freeze(container), out(container) → Promise,
  in(container, { arriving, offset }), show(container),
  land(container) → boolean, reducedMotion() → boolean }`
- `onBeforeLeave(data)`, `onAfterNav(container)`, `onNextDocument(doc)`
- `timeout` (ms, default 5000), `cacheIgnore` (default `false`; set `true` if
  your pages vary per request), `prefetchIgnore` (default `true`)

### Checking a site: `npx bd-verify-router`

Run from the site's root. It reads `docs.config.js` and proves, against
source, that every script the site ships survives a page swap:

- every script is declared in a ledger: the kit's (engine scripts, by file
  name) or the site's own `cms/router-ledger.js` (its own scripts, by path,
  each with `strategies` and a `note`)
- each declared strategy (`delegated`, `self-registered`, `central-list`,
  `router-option`, `none`) is true of the file, and a self-registered module
  also starts on a hard load (a `DOMContentLoaded` listener or a
  `document.readyState` test), where no `bd:after-nav` fires; one that
  starts another way says how in `hardLoad`
- every `loadsAfter` order holds
- every init the router calls by name exists
- every page with a container loads the full script set and the kit's router,
  and none loads a router of its own

It exits non-zero on a failure, so it belongs in the site's test script.

## Feedback

`feedback: true` gives every page the same feedback form every site on the
engine runs. The form service keeps each one, tagged with the site it came
from.

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
  switch for a bug. It has no follow-up switch: your readers' names and
  emails never reach the form service with their feedback. It closes on
  sending; the footer
  thanks the reader, or `showToast` does when the dialog opened from a bar.
- **`feedback.js`**, shipped to `assets/docs-kit/feedback.js` unless
  `feedbackScript` names your own copy.

What your site must already have: the design system's CSS, `dialog.js`
(the dialog, chips and switches are engine components) and `toast.js` for the
bar's thank-you (both in the kit's default `uiScripts`; without `toast.js` the
dialog still closes, silently), and the kit's `docs.css` or your own copy of
its feedback rules.

**The server half is the engine's.** The form POSTs to `/api/submit-form`
with `{ formType: "feedback", data, hp }` and the sign-in session cookie.
`createGate()` answers that path when you pass it the form service's
address, and forwards each form there, signed with your site's key:

```js
export default createGate({
  // ...your other options
  forms: { relay: 'https://<the form service>/api/forms/relay' },
});
```

| Name | Kind | Value |
| --- | --- | --- |
| `SITE_KEY` | secret | your site's key for talking to the service, forms and version reports alike, given with its address. `npx wrangler secret put SITE_KEY` |

Without `SITE_KEY` the route answers 503 and every form says it is not set
up. The address must be https, or `createGate()` refuses to start.

What the gate checks before it forwards: the body size, an origin on your
own domains, and, for feedback, this origin exactly and a live session.
The reader is checked from the session, never from the form. The form
service checks the fields, the spam check and the rate limit, and files
feedback under your site's name. It never keeps a reader's name or email
with your site's feedback, even when one is sent. The Turnstile secret and
the form schemas live there, so your Worker holds none of them.

**The access form** is the engine's Ask for access page, `/support.html`,
which the access gate builds (read "Access gate"). It posts
`access-support` to the same route, which needs no session. Its spam check
takes the site key in `brand.json` (`access.turnstileSiteKey`): ask for your
domain to be added to the service's spam check, or it fails on your site.
Once your site's domains are registered with the service, a spam check
token from any other domain is refused, so register every domain your
support page is served on.

An access request is about your people, so the service does not keep it.
It emails it at once to your site's access inbox, set when your site is
registered, and deletes it once sent:

- **From** `<your slug>@` the service's sending domain, named for your site.
  Let that address through your mail filters.
- **Reply-To** the person who asked, so a reply answers them.
- **Subject** "Access request for <your site>", with every field listed in
  plain text and in a simple HTML version.

While sending fails it is retried, waiting longer after each failure (from
ten minutes up to six hours apart), for 7 days at most, then deleted unsent. Until your inbox is set, the form answers "This form
isn't set up yet."

## Version reports

Your Worker tells the fleet service what your site runs, once per deployment:
the `os.json` your build wrote (see "Apps"), with the deployment's id and
the time it was deployed. The service shows every site on the engine side by
side, and which ones are behind. Nothing about your readers is in a report.
The service never fetches anything from your site, and `os.json` stays
behind the gate.

```js
export default createGate({
  // ...your other options
  report: { to: 'https://<the fleet service>/api/fleet/report' },
});
```

| Name | Kind | Value |
| --- | --- | --- |
| `SITE_KEY` | secret | the same key forms use. `npx wrangler secret put SITE_KEY` |
| `CF_VERSION_METADATA` | binding | `"version_metadata": { "binding": "CF_VERSION_METADATA" }` in `wrangler.jsonc`: the deployment's id and time |

How it behaves:

- **When.** On the first request a new deployment serves on one of your
  `hosts`, in the background, so no reader waits. Never from `localhost` or a
  preview address. Each Worker instance sends once; the service keeps one
  record per deployment, so several are harmless.
- **Off, with one log line saying which,** when the binding or `SITE_KEY` is
  missing. The address must be https, or `createGate()` refuses to start.
- **A refusal** (a wrong key, a report the service won't take) is logged and
  not sent again until your next deployment. While the service is down, it
  is tried again every 15 minutes.
- **A site with no visitors after a deploy reports nothing until its first
  one.** The dashboard shows when each site last reported, so a quiet site
  is visible, never mistaken for an up-to-date one.
- **`brand.json` needs a `slug`**: the service checks the report is your
  site's own.

## Access gate

`accessGate: true` puts the site behind the engine's sign-in (`createGate()`
in your Worker): named people sign in with a one-time code, and every page
opens at the level its `access:` frontmatter sets.

**The pages at the door come from the engine.** On a site that installs
(`install`), the build makes three, in your brand:

| Page | Address | Type | What it is |
| --- | --- | --- | --- |
| Sign in | `/auth/login.html` | `bare`, public | the email and code panes. The logo is your `brand.json` primary, inline, in the text colour; a long wordmark scales to the card |
| Ask for access | `/support.html` | `bare`, public | the access form, which posts to the form service (read "Feedback") |
| Locked | `/locked.html` | `page`, team | what a signed-in reader meets at a page their account can't open. The Worker serves it at that page's own address, with 403 |

The addresses are the same on every site and never move: the invite emails
link to the login page, and the gate, the generator and the scripts read all
three from one module, `worker/engine-paths.mjs` (the browser reads
`window.bdPaths`, which `nav.js` writes first). `createGate()`'s
`loginPath` and `lockedPath` are deprecated: a value other than the engine's
warns at start-up, and both go at the next major.

To replace one, write your own `cms/auth-login.md`, `cms/support.md` or
`cms/locked.md`: the build uses it instead of the engine's, at the same
address. Start from the engine's in the package
(`dist/apps/guides/`). A sign-in page must keep every id `auth-login.js`
reads, the email field's `<label for="login-email">`, `role="alert"` on
its `.form-error` lines and `role="status"` on `#login-success`, and stay
public; the build fails otherwise. A replacement marked `status: "draft"`
fails the build too, since it would leave the site with no page at that
address. The access gate needs an `install` list (without one the door
pages aren't installed) and no `basePath` (the gate serves from the site
root); the build refuses either. The sign-in page's logo must load nothing
from outside its own file, or the build names what to remove.

**The scripts load themselves.** `header-account.js` (the account menu, and
the page's one session check, which publishes `window.bdSession` for the
lock guard and the nav's locks) and `locked.js` load on every page;
`auth-login.js` and `access-support-form.js` on the pages that use them.
The build copies all four to `assets/js/` and fails while a different copy
of one sits there. Don't list them in `uiScripts` or `extraScripts`.

**Signing out.** The account menu signs out, and every page with a level
carries a `<noscript>` Sign out link for a browser with no JavaScript. For a
plain link of your own, link to `/auth/sign-out`: it signs out a navigation
the reader made (a click on your site, or the address typed or bookmarked),
then sends them to the login page. A link on another site can't sign your
readers out: it gets a page saying nothing changed, with the way to sign
out.

**Every file a door page loads must be public**, because a signed-out reader
is the one who loads it. The build checks each file the sign-in and Ask for
access pages load, and each file their stylesheets load in turn, against the
gate, and fails on one the gate keeps behind the sign-in, judged by the
path as the Worker is asked for it, still percent-encoded. That covers every
way a page loads a file: `link`, `script`, `img` and `srcset`, media,
`<use href>`, `<style>` blocks and `style="url(…)"`, quoted or not. It also
fails on a file that isn't in the output, since a signed-out reader would
get a broken page; if a build step after docgen copies one in, name its
site path in `doorFilesAddedLater` in `docs.config.js`. Everything under
`/assets/` is public. Anything else must be opened in your `createGate()`
options (`publicPaths`, `publicPrefixes`); export those options as
`SITE_OPTIONS` from `worker/site-config.mjs` so the build judges by them:

```js
// worker/site-config.mjs
import { PAGE_ACCESS, SECTIONS, SOURCE_PAGES, ACCESS_NAV, APPS, NOT_INSTALLED } from './page-access.mjs';
export const SITE_OPTIONS = {
  name: 'Acme OS', pages: PAGE_ACCESS, sections: SECTIONS, sources: SOURCE_PAGES,
  accessNav: ACCESS_NAV, apps: APPS, notInstalled: NOT_INSTALLED,
  hosts: ['acme.example'],
  publicPrefixes: ['/brand-assets/'],
};
// worker/index.js: createGate({ ...SITE_OPTIONS, routes: { ... } })
```

**Your own page outside the docs layout.** Any `cms/*.md` can be
`type: "bare"`: the site's head, the header bar alone and your raw HTML body
in `main`, with no sidebar or page transitions. Give it a page of its own in
`filenameOverrides` (`{ folder: '', name: 'welcome.html' }`), and name its
scripts by file name in `scripts:`, from your UI scripts or the gate's own:

```markdown
---
title: "Welcome"
type: "bare"
access: "public"
layer: "app"
scripts: "access-support-form.js"
ogImage: "/assets/images/og/welcome.jpg"
---
<section class="top-small"> … </section>
```

A bare page that is public gets the same public-files check.

**What your Worker needs**: the `DB` (D1) and `EMAIL` bindings, the
`ASSETS` binding with `run_worker_first: true` and `html_handling: "none"`,
`nodejs_compat`, the `BETTER_AUTH_SECRET` secret, and `ACCESS_OWNER`. Run
`npx bd-migrations` for the gate's tables. Add `auth/login.html`,
`support.html` and `locked.html` to the files your build ships.

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
  (`bd:after-nav`). By Default OS uses the same starter.

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
ended), the drawer offers "Sign in again", linking to the access gate's
login page (`window.bdPaths.login`, `/auth/login.html` on every site).

Set `glossaryDrawer: false` if your site loads `glossary.js` itself and calls
`window.initGlossary`. Otherwise the kit's copy loads it a second time.

## Versioning

The docs kit has no version of its own — it is versioned by this package.
Upgrading the package upgrades the generator.
