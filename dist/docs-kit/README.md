# Docs Kit

A markdown-to-HTML documentation site generator, shipped as part of the
`@bydefaultstudio/design-system` package. It reads markdown files with
frontmatter and produces a complete static docs site: sidebar navigation,
table of contents, copy buttons for tokens and code, prev/next page
navigation, dark mode, and the design system's styling out of the box.

## Install

```bash
npm install "github:bydefaultstudio/design-system-dist#semver:^1.6.0"
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
| `logoHtml` | site name as text | raw HTML for the top-nav logo |
| `contactHref` / `contactLabel` | none | top-nav contact link |
| `sectionIcons` | `{}` | map of section label → icon key for the sidebar |
| `uiScripts` | kit-bundled copy-button + dropdown | script list for docs UI behaviours |
| `markdownSourceBase` | none | serve path of the .md sources; enables "view as markdown" menu items |
| `validateLayers` | `false` | require a valid `layer:` field in every file's frontmatter |

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
| `sticky-bar: false` | hide the breadcrumb bar |
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

## Versioning

The docs kit has no version of its own — it is versioned by this package.
Upgrading the package upgrades the generator.
