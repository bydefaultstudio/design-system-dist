#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

//------- Project discovery -------//
//
// Walk up from cwd: the first directory containing docs/docs.config.js or
// cms/docs.config.js is the project root, and the folder holding the config
// is the content dir. All config paths resolve from the project root. This
// keeps `cd cms/generator && npm run docgen` working when the generator runs
// from source, and lets a consumer run it straight from node_modules with no
// flags (node_modules sits inside the project root, so the walk finds it).
function locateProject() {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of ['docs', 'cms']) {
      const configPath = path.join(dir, candidate, 'docs.config.js');
      if (fs.existsSync(configPath)) {
        return { root: dir, contentDir: path.join(dir, candidate), configPath };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      console.error(`❌ No docs/docs.config.js or cms/docs.config.js found from ${process.cwd()} upward.`);
      console.error('   Create one next to your markdown files (see the generator README).');
      process.exit(1);
    }
    dir = parent;
  }
}

const PROJECT = locateProject();
const ROOT = PROJECT.root;
const DOCS_DIR = PROJECT.contentDir;
const TEMPLATE_FILE = path.join(__dirname, 'template.html');
// Bundled fallback assets (docs.css, ui scripts, chrome icons) — present only
// in the shipped docs-kit package, not when running from repo source.
const KIT_ASSETS = path.join(__dirname, 'assets');

const userConfig = require(PROJECT.configPath);

// One config contract. Core keys have neutral defaults; the extension surface
// (extra*, bodyAttrs, wrapperAttrs, containerAttrs, brandManifest, brandsDir)
// defaults to off — that is the lean core a consuming project runs.
const CONFIG = {
  // Core
  outputDir: userConfig.outputDir || path.join(path.basename(DOCS_DIR), 'site'),
  basePath: userConfig.basePath || '',
  designSystemPath: userConfig.designSystemPath || 'assets/css/design-system.css',
  brandCssPath: userConfig.brandCssPath || null,
  googleFontsUrl: userConfig.googleFontsUrl !== undefined ? userConfig.googleFontsUrl : null,
  siteName: userConfig.siteName || 'Documentation',
  footerText: userConfig.footerText || '',
  indexDescription: userConfig.indexDescription || 'Complete documentation for your project.',
  iconsDir: userConfig.iconsDir || null,
  docsCss: userConfig.docsCss || null,
  highlightJs: userConfig.highlightJs || 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  sectionFolders: userConfig.sectionFolders || {},
  filenameOverrides: userConfig.filenameOverrides || {},
  indexCards: userConfig.indexCards || null,
  logoHtml: userConfig.logoHtml || null,
  contactHref: userConfig.contactHref || null,
  contactLabel: userConfig.contactLabel || 'Contact',
  sectionIcons: userConfig.sectionIcons || {},
  rootLinks: userConfig.rootLinks || [],
  markdownSourceBase: userConfig.markdownSourceBase || null,
  validateLayers: userConfig.validateLayers === true,
  pageTransitions: userConfig.pageTransitions === true,
  uiScripts: userConfig.uiScripts || null, // null = kit-bundled copy-button + dropdown
  // Extension surface (all off by default)
  extraHeadHtml: userConfig.extraHeadHtml || '',
  extraStylesheets: userConfig.extraStylesheets || [],
  extraScripts: userConfig.extraScripts || [],
  extraContentHtml: userConfig.extraContentHtml || '',
  extraBodyEndHtml: userConfig.extraBodyEndHtml || '',
  bodyAttrs: userConfig.bodyAttrs || '',
  wrapperAttrs: userConfig.wrapperAttrs || '',
  containerAttrs: userConfig.containerAttrs || '',
  brandManifest: userConfig.brandManifest || null,
  brandsDir: userConfig.brandsDir || null,
};
// Legacy alias — the body of this file predates the unified contract.
const PROJECT_CONFIG = CONFIG;

// basePath contract: '' (site root, the default) or '/sub/path' — leading
// slash, no trailing slash. Fail loudly; a silently malformed prefix would
// break every nav link in the output.
if (CONFIG.basePath && (!CONFIG.basePath.startsWith('/') || CONFIG.basePath.endsWith('/'))) {
  console.error(`❌ Invalid basePath: "${CONFIG.basePath}" — it must start with "/" and must not end with "/", e.g. "/docs/site". Leave it unset to serve from the site root.`);
  process.exit(1);
}

// pageTransitions contract: strictly true or false/unset — an options object
// is reserved for later, so anything else fails loudly rather than being
// silently coerced to off.
if (userConfig.pageTransitions !== undefined && typeof userConfig.pageTransitions !== 'boolean') {
  console.error(`❌ Invalid pageTransitions: expected true or false, got ${JSON.stringify(userConfig.pageTransitions)}. Page transitions are opt-in — set pageTransitions: true only after reading the "Page transitions" section of the docs-kit README.`);
  process.exit(1);
}

// When running from the shipped package with no explicit designSystemPath,
// serve the packaged framework CSS (a dist/ sibling of the docs-kit) so a
// zero-config project still gets a fully styled site.
const PACKAGED_DS_CSS = path.join(__dirname, '..', 'design-system.css');
const USE_PACKAGED_DS = !userConfig.designSystemPath && fs.existsSync(PACKAGED_DS_CSS);
if (USE_PACKAGED_DS) CONFIG.designSystemPath = 'assets/docs-kit/design-system.css';

const OUTPUT_DIR = path.resolve(ROOT, CONFIG.outputDir);
const BRANDS_DIR = CONFIG.brandsDir ? path.resolve(ROOT, CONFIG.brandsDir) : null;
// Site-relative brands path for markdown-source links in brand doc pages
const BRANDS_REL = BRANDS_DIR ? path.relative(ROOT, BRANDS_DIR).split(path.sep).join('/') : '';

// Root-site manifest (config: brandManifest): the site's admin values — name,
// description, footer, favicons, fonts — come from a brand.json when one is
// configured. docs.config.js keys are the fallback for projects without one.
const ROOT_MANIFEST_PATH = CONFIG.brandManifest ? path.resolve(ROOT, CONFIG.brandManifest) : null;
const ROOT_MANIFEST = ROOT_MANIFEST_PATH ? readManifestFile(ROOT_MANIFEST_PATH) : null;
const ROOT_BRAND_KEY = ROOT_MANIFEST_PATH ? path.basename(path.dirname(ROOT_MANIFEST_PATH)) : null;

// Root pages load the root brand's theme as a static render-blocking link, so
// the site carries its brand before any JS runs; a previewed brand theme is
// injected after it in the head and wins the cascade. Only meaningful when
// the manifest lives in a brandsDir whose assets get copied to output.
function rootThemeCss(prefix) {
  if (!ROOT_MANIFEST || !BRANDS_DIR) return '';
  return `<!-- Instance-0 brand theme -->\n    <link rel="stylesheet" href="${prefix}${ROOT_BRAND_KEY}/assets/theme.css">`;
}
const SITE = {
  name: (ROOT_MANIFEST && (ROOT_MANIFEST.siteName || ROOT_MANIFEST.name)) || CONFIG.siteName,
  description: (ROOT_MANIFEST && ROOT_MANIFEST.description) || CONFIG.indexDescription,
  footerText: (ROOT_MANIFEST && ROOT_MANIFEST.footerText) || CONFIG.footerText,
};

// Root a site-absolute href under basePath. The default '' keeps output
// byte-identical to a build without the option; external (http, //) and
// relative hrefs pass through untouched. Applied exactly once, at each
// output boundary — never on the internal page model.
function siteHref(href) {
  return href && href.startsWith('/') && !href.startsWith('//') ? CONFIG.basePath + href : href;
}

// Prefix a page-relative base onto a path unless it is already absolute
// (site-absolute paths resolve under basePath instead)
function prefixHref(base, p) {
  if (/^(https?:)?\/\//.test(p)) return p;
  return p.startsWith('/') ? siteHref(p) : base + p;
}

// Brand CSS <link> for a page at the given base ('' for root pages).
// prefixHref keeps relative paths depth-correct and roots site-absolute
// ones under basePath, so every page depth emits the same working href.
function brandCssLink(base) {
  return PROJECT_CONFIG.brandCssPath
    ? `<link rel="stylesheet" href="${prefixHref(base, PROJECT_CONFIG.brandCssPath)}">`
    : '';
}

// Per-brand font sources, emitted into the {{FONT_HEAD}} slot: Typekit kit,
// self-hosted preloads, Google Fonts. All come from the brand manifest
// (typekitId, fontPreload[], googleFontsUrl); a missing field emits nothing.
// fontPreload paths are site-relative and get the page's nav base prefixed.
// Falls back to docs.config.js googleFontsUrl for template instantiations
// without a root manifest. @font-face declarations for self-hosted files
// live in the brand's own theme.css, not here.
const FONT_PRELOAD_TYPES = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
function fontHeadHtml(manifest, navBase) {
  const m = manifest || { googleFontsUrl: PROJECT_CONFIG.googleFontsUrl };
  const lines = [];
  if (m.typekitId) {
    lines.push(`<link rel="stylesheet" href="https://use.typekit.net/${m.typekitId}.css">`);
  }
  for (const fontPath of m.fontPreload || []) {
    const ext = fontPath.split('.').pop().toLowerCase();
    const type = FONT_PRELOAD_TYPES[ext] ? ` type="${FONT_PRELOAD_TYPES[ext]}"` : '';
    lines.push(`<link rel="preload" href="${navBase}${fontPath}" as="font"${type} crossorigin>`);
  }
  if (m.googleFontsUrl) {
    lines.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
    lines.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    lines.push(`<link href="${m.googleFontsUrl}" rel="stylesheet">`);
  }
  if (!lines.length) return '';
  return '<!-- Brand fonts (from brand.json) -->\n    ' + lines.join('\n    ');
}

//------- Icon Map -------//

// Project icons (config: iconsDir), falling back to the chrome icons bundled
// with the shipped docs-kit. Without either, pages build but icon slots warn.
const ICONS_DIR = CONFIG.iconsDir
  ? path.resolve(ROOT, CONFIG.iconsDir)
  : path.join(KIT_ASSETS, 'icons');
let ICON_MAP = {};

/**
 * Renamed icons keep a byte-identical source file under the old name so
 * consumer icons.manifest.json entries keep resolving. Those files must ship
 * in the sprite but stay out of every browsable surface, or the registry
 * shows two names for one glyph.
 * @returns {Set<string>} deprecated icon keys
 */
function readIconAliases() {
  // Beside the icons first — that's where the package puts it for consumers
  // building against dist/icons/src — then the project root, for this repo.
  const file = [
    path.join(ICONS_DIR, '..', 'aliases.json'),
    path.join(ROOT, 'icons.aliases.json'),
  ].find(p => fs.existsSync(p));
  if (!file) return new Set();
  try {
    const aliases = JSON.parse(fs.readFileSync(file, 'utf8')).aliases;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      console.warn(`⚠️  ${path.basename(file)} has no "aliases" object — deprecated icon names will show in the registry`);
      return new Set();
    }
    return new Set(Object.keys(aliases).map(k => k.toLowerCase()));
  } catch (err) {
    console.warn(`⚠️  ${path.basename(file)} is unreadable (${err.message}) — deprecated icon names will show in the registry`);
    return new Set();
  }
}

// Numbers as SVG path data actually writes them: optional sign, optional
// leading dot (".5"), optional exponent ("-1.52588e-05"). A naive \d+(\.\d+)?
// splits both of those into garbage.
const PATH_NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * Reduce an icon to its drawing: the sequence of path commands plus the
 * coordinates they use. Attributes, formatting and element order around the
 * paths are ignored — only the shape matters.
 * @param {string} svg - raw SVG source
 * @returns {{commands: string, coords: number[]}|null} null if it draws no paths
 */
function readGeometry(svg) {
  const d = (svg.match(/\sd="[^"]*"/g) || []).join('');
  if (!d) return null;
  return {
    commands: (d.match(/[A-Za-z]/g) || []).join(''),
    coords: (d.match(PATH_NUMBER) || []).map(Number),
  };
}

/**
 * Two names for the same drawing is the failure that reaches designers: they
 * look an icon up, find two entries, and have no basis to choose. Matching
 * filenames were always caught; matching artwork was not, which is how a
 * re-export saved under a new name becomes the registry's second copy.
 *
 * Compared numerically rather than as a string hash, so a re-export rounded to
 * fewer decimal places still matches its full-precision original — string
 * comparison of rounded coordinates misses those whenever a value sits near a
 * rounding boundary, which most icons have somewhere.
 * @param {Array<{key: string, geometry: object}>} shapes
 */
function warnDuplicateGeometry(shapes) {
  const TOLERANCE = 0.05; // sub-pixel at any size the wrapper renders
  const pairs = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i].geometry;
      const b = shapes[j].geometry;
      if (a.commands !== b.commands || a.coords.length !== b.coords.length) continue;
      if (a.coords.every((n, k) => Math.abs(n - b.coords[k]) <= TOLERANCE)) {
        pairs.push(`${shapes[i].key}=${shapes[j].key}`);
      }
    }
  }
  // One line, not one per pair — a warning repeated eleven times is a warning
  // nobody reads, and the twelfth is the one that matters.
  if (pairs.length) {
    console.warn(`⚠️  ${pairs.length} icon(s) duplicate another's artwork under a second name: ${pairs.join(', ')}`);
  }
}

/**
 * Scan the icons dir and build icon-name → normalised SVG string map.
 * Called once at the start of generateDocs().
 */
function buildIconMap() {
  if (!fs.existsSync(ICONS_DIR)) {
    console.warn(`⚠️  Icons directory not found: ${ICONS_DIR} — icon placeholders will render as comments`);
    ICON_MAP = {};
    return;
  }
  // Underscore-prefixed files are drafts — the sprite builder skips them too
  const files = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.svg') && !f.startsWith('_'));
  const aliases = readIconAliases();
  const map = {};
  const seen = {};
  const shapes = [];

  for (const file of files) {
    const key = file.replace(/\.svg$/i, '').toLowerCase().replace(/\s+/g, '-');
    if (aliases.has(key)) continue; // deprecated name — ships in the sprite, hidden from the docs

    // The {{icon:...}} shorthand and warnBrandRegistryGaps only match
    // [a-z0-9-] keys — a filename outside that charset would publish as
    // literal placeholder text, so flag it at build time
    if (!/^[a-z0-9-]+$/.test(key)) {
      console.warn(`⚠️  Icon "${file}" produces key "${key}" — not referenceable by {{icon:...}}; rename to lowercase kebab-case`);
    }

    // Handle duplicates — prefer capitalised filename, warn on collision
    if (seen[key]) {
      console.warn(`⚠️  Duplicate icon key "${key}" — "${file}" collides with "${seen[key]}". Keeping first.`);
      continue;
    }
    seen[key] = file;

    let svg = fs.readFileSync(path.join(ICONS_DIR, file), 'utf8')
      .replace(/\n\s*/g, '') // collapse to single line
      .trim();

    // The file's own markup, kept for the icon manifest: the Icon Library tool
    // feeds it through the SVG Cleaner engine's icon mode, which adds data-icon
    // itself — handing it the normalised form below would double the attribute.
    const raw = svg;

    const geometry = readGeometry(svg);
    if (geometry) shapes.push({ key: key, geometry: geometry });

    // Normalise: replace fixed width/height with 100%
    svg = svg.replace(/(<svg[^>]*)\s+width=["']\d+["']/i, '$1 width="100%"');
    svg = svg.replace(/(<svg[^>]*)\s+height=["']\d+["']/i, '$1 height="100%"');

    // Add aria-hidden if not present
    if (!svg.includes('aria-hidden')) {
      svg = svg.replace(/<svg/, '<svg aria-hidden="true"');
    }

    // Add data-icon on the <svg> element for CSS targeting
    svg = svg.replace(/<svg/, `<svg data-icon="${key}"`);

    map[key] = { svg: svg, file: file, raw: raw };
  }

  ICON_MAP = map;
  warnDuplicateGeometry(shapes);
  console.log(`🎨 Icon map built: ${Object.keys(map).length} icons`);
}

/**
 * Return icon wrapped in the standard .svg-icn container.
 * @param {string} name - kebab-case icon key
 * @returns {string} HTML string
 */
function getIcon(name) {
  const entry = ICON_MAP[name];
  if (!entry) {
    console.warn(`⚠️  Unknown icon: "${name}"`);
    return `<!-- unknown icon: ${name} -->`;
  }
  return `<div class="svg-icn">${entry.svg}</div>`;
}

/**
 * Return raw SVG string (no wrapper). For contexts that build their own wrapper,
 * such as nav.js where icons have additional classes.
 * @param {string} name - kebab-case icon key
 * @returns {string} SVG string
 */
function getRawIcon(name) {
  const entry = ICON_MAP[name];
  if (!entry) {
    console.warn(`⚠️  Unknown icon (raw): "${name}"`);
    return `<!-- unknown icon: ${name} -->`;
  }
  return entry.svg;
}

/**
 * Render the full icon registry as a markdown table, one row per ICON_MAP
 * entry, sorted alphabetically. Expanded from the {{icon-registry}}
 * placeholder before markdown conversion, so the table flows through the
 * same table/icon pipeline as hand-written registry tables.
 */
function renderIconRegistry() {
  const names = Object.keys(ICON_MAP).sort();
  if (names.length === 0) {
    console.warn('⚠️  {{icon-registry}}: icon map is empty — no icons found in assets/images/svg-icons/');
  }
  const rows = names.map(name => `| {{icon:${name}}} | \`${name}\` |`);
  return ['| Icon | data-icon |', '|---|---|', ...rows].join('\n');
}

/**
 * The Brand Book icon page claims to show every icon in the set. Its tables
 * are hand-curated into categories, so they can silently fall behind the
 * source directory — warn on every build when they do.
 */
function warnBrandRegistryGaps() {
  const brandRegistryFile = path.join(DOCS_DIR, 'brand-iconography.md');
  if (!fs.existsSync(brandRegistryFile)) return;
  const source = fs.readFileSync(brandRegistryFile, 'utf8');
  const listed = new Set([...source.matchAll(/\{\{icon:([a-z0-9-]+)\}\}/g)].map(m => m[1]));
  const missing = Object.keys(ICON_MAP).filter(name => !listed.has(name)).sort();
  if (missing.length) {
    console.warn(`⚠️  ${missing.length} icon(s) not listed in cms/brand-iconography.md: ${missing.join(', ')}`);
  }
}

//------- Icon Manifest -------//

/**
 * The Brand Book icon page is the only place the set is grouped and named:
 * one `## Category` heading over each table, whose rows read
 * `| {{icon:key}} | Display Name | \`key\` |`. Read that structure once so
 * the Icon Library tool filters by the categories the brand book shows,
 * rather than carrying a second list that drifts from it.
 * @returns {{order: string[], byKey: Object<string, {name: string, category: string}>}}
 */
function parseIconCategories() {
  const result = { order: [], byKey: {} };
  const brandRegistryFile = path.join(DOCS_DIR, 'brand-iconography.md');
  if (!fs.existsSync(brandRegistryFile)) {
    console.warn('cms/brand-iconography.md not found — every icon in the manifest falls under "Other"');
    return result;
  }

  // The body only: a frontmatter line starting "## " must not register a
  // category.
  const body = parseFrontmatter(fs.readFileSync(brandRegistryFile, 'utf8')).content;
  let category = null;
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      category = heading[1];
      if (!result.order.includes(category)) result.order.push(category);
      continue;
    }
    const row = line.match(/^\|\s*\{\{icon:([a-z0-9-]+)\}\}\s*\|\s*([^|]*?)\s*\|/);
    if (!row || !category) continue;
    const key = row[1];
    const existing = result.byKey[key];
    if (existing) {
      console.warn(`Icon "${key}" is listed twice in cms/brand-iconography.md (${existing.category}, ${category}) — the manifest keeps ${existing.category}`);
      continue;
    }
    result.byKey[key] = { name: row[2].trim() || titleFromKey(key), category: category };
  }
  return result;
}

/**
 * Figma exports carry internal ids ("clip0_14540_880") referenced by
 * url(#id) and href="#id". Inlined 175 times on one page they collide, and a
 * browser resolves url(#id) to the FIRST match document-wide, so later icons
 * pick up the wrong clip. Prefix every id and its references with the icon
 * key. The same three rewrites as scripts/build-icon-sprite.js, which cannot
 * be required from here — it is a CLI that runs on load.
 * @param {string} svg
 * @param {string} prefix
 * @returns {string}
 */
function namespaceIds(svg, prefix) {
  const ids = new Set();
  const idRe = /\sid="([^"]+)"/g;
  let match;
  while ((match = idRe.exec(svg))) ids.add(match[1]);
  let out = svg;
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ns = `${prefix}-${id}`;
    // Function replacers: a string replacement would read a "$&" or "$1"
    // inside an id as a substitution pattern.
    out = out
      .replace(new RegExp(`id="${safe}"`, 'g'), () => `id="${ns}"`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), () => `url(#${ns})`)
      .replace(new RegExp(`href="#${safe}"`, 'g'), () => `href="#${ns}"`);
  }
  return out;
}

/**
 * "arrow-top-right" → "Arrow Top Right", for icons the brand book has not
 * named yet.
 * @param {string} key
 * @returns {string}
 */
function titleFromKey(key) {
  return key.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/**
 * The Icon Library tool's data, inlined on that page alone as a JSON block.
 * Not a global script on purpose: the set is over 100 KB, and every entry in
 * extraScripts ships on all ~125 pages. Expanded from {{icon-manifest}} in a
 * tool body — an HTML body is the only place it resolves.
 *
 * The trade-off: _headers serves *.html with max-age=0, must-revalidate, so
 * the block re-transfers on every deploy (about 36 KB brotli), where a
 * fetched file under assets/ would sit in the hour cache. One page, static
 * data, no async render or Barba re-entry race — inline is still the simpler
 * correct answer.
 *
 * `raw` is the file's own markup (collapsed, ids namespaced), named as it
 * is in ICON_MAP and deliberately not the normalised {{icon:}} form; see the
 * note in buildIconMap. The tool re-derives the display form (100% sizing) in
 * one pass at render, which is cheaper than shipping both forms twice over.
 * @returns {string} HTML string
 */
function renderIconManifest() {
  const keys = Object.keys(ICON_MAP).sort();
  if (keys.length === 0) {
    console.warn('{{icon-manifest}}: icon map is empty — no icons found in assets/images/svg-icons/');
  }
  const categories = parseIconCategories();
  const OTHER = 'Other';
  const unlisted = [];
  const icons = keys.map(key => {
    const meta = categories.byKey[key];
    if (!meta) unlisted.push(key);
    return {
      key: key,
      name: meta ? meta.name : titleFromKey(key),
      category: meta ? meta.category : OTHER,
      raw: namespaceIds(ICON_MAP[key].raw, key),
    };
  });
  // warnBrandRegistryGaps matches {{icon:}} anywhere in the brand book; this
  // parser only reads table rows under a heading, so an icon can pass that
  // check and still land here. Name the ones that did.
  if (unlisted.length && categories.order.length) {
    console.warn(`${unlisted.length} icon(s) have no category row in cms/brand-iconography.md and fall under "Other": ${unlisted.join(', ')}`);
  }
  const used = new Set(icons.map(icon => icon.category));
  const order = categories.order.filter(name => used.has(name));
  if (used.has(OTHER) && !order.includes(OTHER)) order.push(OTHER);

  // \u003c keeps "</script>" and "<!--" out of the block whatever the markup holds
  // The brand names the export files (icon_<brand>_<key>_...), so a second
  // instance's arrow-up never collides with this one's in a downloads folder.
  const manifest = Object.assign(ROOT_BRAND_KEY ? { brand: ROOT_BRAND_KEY } : {}, { categories: order, icons: icons });
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c');
  console.log(`Icon manifest: ${icons.length} icons in ${order.length} categories, ${Math.round(json.length / 1024)} KB`);
  return `<script type="application/json" id="icon-manifest">${json}</script>`;
}

/**
 * Render a .book-cover anchor with the standard header/content/footer layout.
 *
 *   header  → full-screen icon (top right)
 *   content → card-title + optional card-description
 *   footer  → author (left) + add icon (right placeholder for future meta)
 *
 * @param {object} opts
 * @param {string} opts.href      - link target
 * @param {string} opts.title     - card title (required)
 * @param {string} [opts.subtitle] - card description (optional)
 * @param {string} [opts.author]  - footer author label (defaults to "Studio")
 * @param {string} [opts.access]  - data-access value (omitted if falsy)
 * @param {number} [opts.headingLevel] - heading level for the title (default 3)
 * @returns {string} HTML string
 */
function renderBookCover(opts) {
  // Cards render h3 by default. A caller with no group heading above the
  // list passes 2, so the page does not jump from h1 straight to h3.
  const level = opts.headingLevel || 3;
  const author = opts.author || 'Studio';
  const accessAttr = opts.access ? ` data-access="${opts.access}"` : '';
  const description = opts.subtitle
    ? `<p class="book-cover-description" data-text-wrap="pretty">${opts.subtitle}</p>`
    : '';
  const flipId = flipIdFromHref(opts.href);
  const flipAttr = flipId ? ` data-flip-id="${escapeAttr(flipId)}"` : '';
  return `<a href="${siteHref(opts.href)}" class="book-cover"${accessAttr}>
        <header class="book-cover-header"><div class="book-cover-trailing">${getIcon('open-full')}</div></header>
        <div class="book-cover-body">
          <h${level} class="book-cover-title"${flipAttr}>${opts.title}</h${level}>
          ${description}
        </div>
        <footer class="book-cover-footer">
          <span class="book-cover-byline"><em>by</em> ${author}</span>
        </footer>
      </a>`;
}

/**
 * Render a book-contents-item row for L1 section index pages.
 * Wide horizontal row — title + description left-aligned,
 * icon on the right (revealed on hover).
 * @param {Object} opts - { href, title, subtitle, access, headingLevel, identity, meta }
 * @returns {string} HTML string
 */
function renderBookContentsItem(opts) {
  // Cards render h3 by default. A caller with no group heading above the
  // list passes 2, so the page does not jump from h1 straight to h3.
  const level = opts.headingLevel || 3;
  const accessAttr = opts.access ? ` data-access="${opts.access}"` : '';
  const description = opts.subtitle
    ? `<p class="book-contents-item-description" data-text-wrap="pretty">${opts.subtitle}</p>`
    : '';
  const flipId = flipIdFromHref(opts.href);
  const flipAttr = flipId ? ` data-flip-id="${escapeAttr(flipId)}"` : '';
  // Optional slots. Both are left out entirely when empty rather than emitted
  // hollow — an empty slot still draws a gap inside the row's flex container.
  const identity = opts.identity
    ? `<div class="book-contents-item-leading">${opts.identity}</div>\n        `
    : '';
  // Meta goes inside the content column, under the description — a row has no
  // footer strip, so a trailing meta would compete with the title for width.
  const meta = opts.meta
    ? `\n          <span class="book-contents-item-meta">${opts.meta}</span>`
    : '';
  return `<a href="${siteHref(opts.href)}" class="book-contents-item"${accessAttr}>
        ${identity}<div class="book-contents-item-body">
          <h${level} class="book-contents-item-title"${flipAttr}>${opts.title}</h${level}>
          ${description}${meta}
        </div>
        <div class="book-contents-item-trailing">${getIcon('open-full')}</div>
      </a>`;
}

/**
 * Audience tag for a contents row, or '' for the default audience.
 *
 * This is a *classification*, not a lock. Auth was removed in July 2026
 * (CLAUDE.md §20): `auth.js` is gone, the page template no longer loads it,
 * and nothing server-side reads `data-access`. So the label names who a page
 * is written for, and must never imply it is protected — "Admin", not
 * "Admin only". Restoring enforcement is a separate job from labelling it.
 *
 * Only non-default audiences are tagged. `team` is the frontmatter default and
 * covers 87 of ~100 pages; tagging those would be chrome, not signal.
 *
 * @param {string} access - value from deriveDataAccess()
 * @returns {string} HTML for the meta slot, or ''
 */
function audienceTag(access) {
  if (!access || access === 'team') return '';
  if (access === 'public') return '<span class="tag">Public</span>';
  if (access.startsWith('admin')) return '<span class="tag" data-color="warning">Admin</span>';
  if (access.startsWith('brand')) return '<span class="tag">Brand</span>';
  if (access.startsWith('user:')) return '<span class="tag" data-color="warning">Named</span>';
  return '';
}

/**
 * Derive a Barba/GSAP Flip identifier from a destination href.
 * Only the filename slug is needed — the source and destination pages
 * resolve the element by attribute within their own DOM, and the two
 * pages are only ever in the DOM together during a single transition.
 * "color.html" → "color", "../tools/cpm-calculator.html" → "cpm-calculator"
 */
function flipIdFromHref(href) {
  if (!href) return '';
  return String(href).replace(/[?#].*$/, '').replace(/^.*\//, '').replace(/\.html$/, '');
}

//------- Section-to-Folder Mapping (config: sectionFolders) -------//
// Empty map = flat output: every page lands at the output root, no section
// index pages, no per-section subfolders.

const SECTION_FOLDERS = CONFIG.sectionFolders;

// Fallback section order when _defaults.md doesn't define one: config-map order
const DEFAULT_SECTION_ORDER = Object.keys(SECTION_FOLDERS);

/**
 * Slugify a section name for use as a Barba namespace.
 * "Brand Book" → "brand-book", "Design System" → "design-system", undefined → "page".
 */
function slugifySection(section) {
  if (!section) return 'page';
  return String(section).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
}

// Special filename overrides for files that don't follow the prefix-strip
// pattern (config: filenameOverrides)
const FILENAME_OVERRIDES = CONFIG.filenameOverrides;

/**
 * Derive output folder and filename for a markdown file
 */
function deriveOutputPath(filename, section) {
  // Check for explicit override
  if (FILENAME_OVERRIDES[filename]) {
    const override = FILENAME_OVERRIDES[filename];
    return { folder: override.folder, htmlName: override.name };
  }

  // Get section folder
  const folder = SECTION_FOLDERS[section];
  if (!folder) {
    // Fallback: use filename as-is at root (shouldn't happen for mapped sections)
    return { folder: '', htmlName: filename.replace('.md', '.html') };
  }

  // Strip section prefix from filename
  // e.g. "brand-values.md" with folder "brand" → strip "brand-" → "values.html"
  let baseName = filename.replace('.md', '');
  const prefixes = [folder + '-', section.toLowerCase().replace(/\s+/g, '-') + '-'];
  for (const prefix of prefixes) {
    if (baseName.startsWith(prefix)) {
      baseName = baseName.substring(prefix.length);
      break;
    }
  }

  return { folder, htmlName: baseName + '.html' };
}

/**
 * Load folder defaults from _defaults.md in a given directory.
 * Returns parsed frontmatter object, or empty object if no _defaults.md exists.
 */
const _defaultsCache = {};
function loadDefaults(dirPath) {
  if (_defaultsCache[dirPath] !== undefined) return _defaultsCache[dirPath];
  const defaultsFile = path.join(dirPath, '_defaults.md');
  if (fs.existsSync(defaultsFile)) {
    const raw = fs.readFileSync(defaultsFile, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    _defaultsCache[dirPath] = frontmatter;
    return frontmatter;
  }
  _defaultsCache[dirPath] = {};
  return {};
}

/**
 * Derive the data-access attribute value from access + brand frontmatter fields.
 *
 * Rules:
 *   access "public" / "team" / "admin"  → passthrough
 *   access "brand"        + brand "all"        → "brand"
 *   access "brand"        + brand "<name>"      → "brand:<name>"
 *   access "admin+brand"  + brand "all"        → "admin+brand"
 *   access "admin+brand"  + brand "<name>"      → "admin+brand:<name>"
 *   fallback                                      → "team"
 */
function deriveDataAccess(frontmatter) {
  const access = frontmatter.access || 'team';
  const brand = frontmatter.brand || 'internal';

  if (access === 'brand' || access === 'admin+brand') {
    let brandPart;
    if (brand === 'all') {
      brandPart = 'brand';
    } else if (brand && brand !== 'internal') {
      brandPart = 'brand:' + brand;
    } else {
      return 'team'; // access: "brand" with no valid brand → fallback
    }
    return access === 'admin+brand' ? 'admin+' + brandPart : brandPart;
  }

  return access;
}

/**
 * Parse a comma-separated string into a trimmed array.
 * Returns the provided fallback if the value is falsy.
 */
function parseList(value, fallback) {
  if (!value) return fallback || [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Get subsection ordering for a given section.
 * Looks for a section-specific key first (e.g. "design-system-subsection-order"),
 * then falls back to the generic "subsection-order" key.
 */
function getSubsectionOrder(defaults, section) {
  const slug = section.toLowerCase().replace(/\s+/g, '-');
  const key = `${slug}-subsection-order`;
  if (defaults[key]) return parseList(defaults[key], []);
  return parseList(defaults['subsection-order'], []);
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, content: content.trim() };
  }

  const frontmatterText = match[1];
  const markdownContent = match[2];

  const frontmatter = {};
  const lines = frontmatterText.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: markdownContent.trim() };
}

/**
 * Sitewide pre-pass: chipify any inline <code> matching one of the three
 * explicit conventions, anywhere in the document (paragraphs, lists, tables, etc.).
 *
 *   `.class-name`        → class chip,  copies `.class-name`
 *   `var(--token-name)`  → token chip,  copies `var(--token-name)`
 *   `#abc123`            → hex chip,    copies `#abc123` + colour swatch
 *
 * Anything else in <code> is left alone. Block code (<pre><code class="language-...">)
 * has a `class` attribute on the <code>, so the bare-tag regex below skips it.
 */
function chipifyExplicitPatterns(html) {
  return html.replace(/<code>([^<]+)<\/code>/g, (match, content) => {
    // Class: .foo-bar, .is-active, .cols-3
    if (/^\.[a-z][\w-]*$/i.test(content)) {
      return buildClassButton(content);
    }
    // Token: var(--foo-bar)
    if (/^var\(--[a-z0-9_-]+\)$/i.test(content)) {
      return buildTokenButton(content);
    }
    // Hex: #abc, #abcd, #abcdef, #abcdef12
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(content)) {
      return buildHexButton(content);
    }
    return match;
  });
}

function buildClassButton(className) {
  return `<button type="button" class="token-copy is-class" data-copy="${escapeAttr(className)}" aria-label="Copy ${escapeAttr(className)}"><code>${className}</code></button>`;
}

function buildTokenButton(varExpression) {
  return `<button type="button" class="token-copy is-token" data-copy="${escapeAttr(varExpression)}" aria-label="Copy ${escapeAttr(varExpression)}"><code>${varExpression}</code></button>`;
}

/**
 * Turn token-table cells into clickable copy buttons (legacy heuristic pass).
 *
 * Runs after chipifyExplicitPatterns and acts as a fallback for older docs that
 * still use bare `--token` syntax, unwrapped hex values, or font-stack literals
 * inside table cells. Cells already chipified by the explicit-pattern pass are
 * skipped to avoid double-wrapping.
 *
 * Skips the description column (last column when its <th> matches description|notes|usage).
 */
function injectTokenCopyButtons(tableInner) {
  // Identify the description column index from the header row, if any.
  let descriptionIndex = -1;
  const theadMatch = tableInner.match(/<thead>([\s\S]*?)<\/thead>/);
  if (theadMatch) {
    const headers = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1]);
    descriptionIndex = headers.findIndex(h => /description|notes|usage/i.test(h.replace(/<[^>]*>/g, '')));
  }

  // Walk every <tr> and rebuild its <td> cells.
  return tableInner.replace(/<tr>([\s\S]*?)<\/tr>/g, (rowMatch, rowInner) => {
    // Leave header rows alone.
    if (/<th[\s>]/.test(rowInner)) return rowMatch;

    let cellIndex = -1;
    const newInner = rowInner.replace(/<td>([\s\S]*?)<\/td>/g, (_, cell) => {
      cellIndex++;
      if (cellIndex === descriptionIndex) return `<td>${cell}</td>`;
      return `<td>${transformTokenCell(cell)}</td>`;
    });
    return `<tr>${newInner}</tr>`;
  });
}

/**
 * Transform a single token-table cell into a copy button.
 *
 * The new explicit-pattern pre-pass (chipifyExplicitPatterns) handles the
 * common cases: `.class`, `var(--token)`, and `#hex`. This legacy fallback
 * exists only for two narrow backward-compat cases on un-migrated docs:
 *
 *   1. <code>--bare-token</code>  → wraps in var() and chipifies
 *   2. bare #hex (no backticks)   → chipifies with swatch
 *
 * Everything else is left alone. Earlier versions had a "literal copy of any
 * single <code>" case plus a looksLikeValue heuristic that misfired badly
 * (e.g. chipifying "Centre items" because "items" contains "em"). Both removed.
 */
function transformTokenCell(cell) {
  const raw = cell.trim();
  if (!raw) return cell;

  // Already chipified by the sitewide explicit-pattern pre-pass — leave it alone.
  if (raw.includes('class="token-copy')) return cell;

  // Backward-compat 1: <code>--bare-token</code> → copies var(--bare-token)
  const codeVarMatch = raw.match(/^<code>(--[a-z0-9-]+)<\/code>$/i);
  if (codeVarMatch) {
    return buildVarButton(codeVarMatch[1]);
  }

  // Backward-compat 2: bare hex code with no backticks
  const hexMatch = raw.match(/^(#[0-9a-fA-F]{6,8}|#[0-9a-fA-F]{3,4})$/);
  if (hexMatch) {
    return buildHexButton(hexMatch[1]);
  }

  // Backward-compat 3: mixed cells containing one or more <code>--bare-token</code>
  // entries — chipify just the bare tokens, leave any other <code> untouched.
  if (/<code>--[a-z0-9-]+<\/code>/i.test(raw)) {
    return raw.replace(/<code>(--[a-z0-9-]+)<\/code>/gi, (_, inner) => buildVarButton(inner));
  }

  return cell;
}

function buildVarButton(varName) {
  const copyValue = `var(${varName})`;
  return `<button type="button" class="token-copy is-token" data-copy="${escapeAttr(copyValue)}" aria-label="Copy ${escapeAttr(copyValue)}"><code>${varName}</code></button>`;
}

function buildHexButton(hex) {
  return `<button type="button" class="token-copy has-swatch" data-copy="${hex}" aria-label="Copy ${hex}"><code>${hex}</code><span class="token-swatch" style="background:${hex};" aria-hidden="true"></span></button>`;
}

/**
 * Escape a string for safe inclusion in an HTML attribute value.
 */
function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert markdown to HTML using marked
 */
function markdownToHtml(markdown) {
  // Configure marked options
  marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert \n to <br>
    pedantic: false,
    sanitize: false,
    smartLists: true,
    smartypants: false,
    langPrefix: 'language-', // Prefix for language classes (for Highlight.js)
  });

  // Expand {{icon-registry}} into the full registry table before markdown
  // conversion. Only a line holding nothing but the placeholder matches, so
  // inline mentions like `{{icon-registry}}` in docs survive as text.
  // [^\S\n] (not \s) keeps the line's trailing newline out of the match, and
  // the function replacer keeps renderIconRegistry lazy — it only runs when
  // a page actually contains the placeholder.
  markdown = markdown.replace(/^\{\{icon-registry\}\}[^\S\n]*$/m, renderIconRegistry);

  // {{icon-manifest}} is a tool-body placeholder (cms/apps/<slug>.html). In
  // markdown it would publish as literal text, so say so at build time. Same
  // line-only match as the registry, so a doc can still mention it inline.
  if (/^\{\{icon-manifest\}\}[^\S\n]*$/m.test(markdown)) {
    console.warn('{{icon-manifest}} only resolves in a tool body (cms/apps/<slug>.html) — here it renders as text');
  }

  let html = marked(markdown);

  // Add IDs to headings for anchor links
  html = html.replace(/<h([1-6])>([^<]+)<\/h[1-6]>/g, (match, level, text) => {
    const id = text.toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim();

    return `<h${level} id="${id}">${text}</h${level}>`;
  });

  // Add target="_blank" and rel="noopener noreferrer" to external links
  html = html.replace(/<a\s+([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (match, before, href, after) => {
    // Check if link is external (starts with http:// or https://)
    if (href.startsWith('http://') || href.startsWith('https://')) {
      let newMatch = match;

      // Add target="_blank" if it doesn't exist
      if (!newMatch.includes('target=')) {
        newMatch = newMatch.replace(/>$/, ' target="_blank">');
      }

      // Add or update rel attribute
      if (newMatch.includes('rel=')) {
        newMatch = newMatch.replace(/rel=["']([^"']*)["']/i, (m, rel) => {
          // Check if noopener noreferrer already exists in rel
          if (!rel.includes('noopener') && !rel.includes('noreferrer')) {
            return `rel="${rel} noopener noreferrer"`;
          }
          return m;
        });
      } else {
        // Add new rel attribute
        newMatch = newMatch.replace(/>$/, ' rel="noopener noreferrer">');
      }

      return newMatch;
    }
    return match;
  });

  // Sitewide pre-pass: chipify any inline <code> matching .class / var(--token) / #hex.
  // Works anywhere in the document — paragraphs, lists, tables, callouts.
  html = chipifyExplicitPatterns(html);

  // Wrap bare tables (markdown-generated) in a scroll container — skip demo tables that already have classes
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="table-scroll"><table class="table">$1</table></div>');

  // Turn token-table cells into copy buttons.
  // Skips the "Description" column (last column when its header text matches description|notes|usage).
  // Each non-description cell whose content is a recognisable token, value, or hex
  // is replaced with a <button class="token-copy"> that copies the right thing on click.
  html = html.replace(/<table class="table">([\s\S]*?)<\/table>/g, (_, tableInner) => {
    return `<table class="table">${injectTokenCopyButtons(tableInner)}</table>`;
  });

  // Add copy buttons to code blocks — deterministic, page-local ids.
  // markdownToHtml runs once per output page, so a per-call counter keeps ids
  // stable across builds (no git churn) and page-locally unique (all copy-button
  // targets are resolved with a page-scoped querySelector).
  let codeBlockIndex = 0;
  html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (match, attributes, code) => {
    const codeId = 'code-' + codeBlockIndex++;

    return `
      <div class="code-block-wrapper">
        <button class="button copy-btn is-icon-only" data-size="xsmall" data-clipboard-target="#${codeId}" data-tooltip="Copy" type="button" aria-label="Copy code"><span class="copy-btn-default">${getIcon('copy')}</span><span class="copy-btn-copied">${getIcon('check')}</span></button>
        <pre><code id="${codeId}"${attributes}>${code}</code></pre>
      </div>
    `;
  });

  // Expand icon shorthand: {{icon:name}} (skip matches inside <code> or <pre> blocks)
  html = html.replace(/(<code[^>]*>[\s\S]*?<\/code>)|(<pre[^>]*>[\s\S]*?<\/pre>)|\{\{icon:([a-z0-9-]+)\}\}/g,
    (match, code, pre, name) => {
      if (code || pre) return match; // preserve code blocks as-is
      return getIcon(name);
    });

  return html;
}

/**
 * Generate table of contents from HTML content
 */
function generateTableOfContents(html) {
  const headingRegex = /<h([1-6])[^>]*id="([^"]*)"[^>]*>.*?<\/h[1-6]>/g;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const id = match[2];
    const text = match[0].replace(/<[^>]*>/g, '').trim();

    // Only include H1 and H2 headings in TOC
    if (level <= 2) {
      headings.push({ level, id, text });
    }
  }

  // Empty in, empty out — a falsy return collapses both TOC renderings
  // (tocAside and tocDropdown), rather than shipping a wrapper around
  // "no headings" copy.
  if (headings.length === 0) {
    return '';
  }

  // Labelled "Table of contents", not "On this page": the dropdown's
  // <summary> already says "On this page", and a nav label repeating its
  // disclosure's name gets announced twice.
  let toc = '<nav class="toc" aria-label="Table of contents"><ul class="toc-list">';

  headings.forEach((heading) => {
    const { level, id, text } = heading;
    toc += `<li class="toc-item toc-level-${level}"><a href="#${id}" class="toc-link">${text}</a></li>`;
  });

  toc += '</ul></nav>';
  return toc;
}

// ── Styleguide coverage ──
//
// cms/styleguide.md carries every foundation and component in one scroll. This
// keeps it honest: the page it generates is only trustworthy if it is complete.
const STYLEGUIDE_SOURCE = 'styleguide.md';

/**
 * The slug a styleguide section declares, derived from the page it must cover.
 *
 * Taken from the output basename rather than the cms filename so the gate
 * compares the section against what the build actually writes.
 *
 * Basenames are unique across the pages this gate sees today, but nothing in
 * the code guarantees it: deriveOutputPath honours CONFIG.filenameOverrides,
 * which can send any page anywhere (styleguide.md and glossary.md are already
 * pulled to the output root that way). Two Website pages overridden into
 * different folders with the same basename would collide here. Hence
 * assertUniqueSlugs below — the invariant is asserted rather than assumed.
 */
function styleguideSlug(htmlPath) {
  return path.basename(htmlPath, '.html');
}

/**
 * Strip the regions of a source file where markup is quoted rather than live:
 * HTML comments, <pre> and <code>.
 *
 * The coverage gate scans raw text for an attribute, so without this a section
 * commented out while debugging still counts as covered — the component
 * vanishes from the page and the build stays green, which is the exact failure
 * the gate exists to prevent. A <code> or <pre> block showing the attribute as
 * an example counts too.
 */
function stripQuotedMarkup(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<pre\b[\s\S]*?<\/pre>/g, '')
    .replace(/<code\b[\s\S]*?<\/code>/g, '');
}

/**
 * Reconcile the styleguide against the pages it is supposed to show.
 *
 * An entry is declared by `data-component="<slug>"` on the section presenting
 * that component. This replaced a "Full docs:" link when the page became a
 * raw-HTML presentation — an HTML body has no markdown link syntax to key on —
 * but it is the better anchor either way: an attribute is written by the
 * author and never by a demo, which closes the "a link inside a demo counts as
 * coverage" hole the old form had. It is also the section's CSS and JS hook,
 * so a declaration that goes missing takes the styling with it rather than
 * failing silently in one place only.
 *
 * @param {Array<{filename: string, title: string, htmlPath: string}>} expected
 * @returns {{missing: string[], stale: string[]}}
 */
function validateStyleguideCoverage(expected, known) {
  const source = path.join(DOCS_DIR, STYLEGUIDE_SOURCE);
  if (!fs.existsSync(source)) return { missing: [], stale: [], empty: false };

  const body = stripQuotedMarkup(fs.readFileSync(source, 'utf8'));
  const declared = new Set();
  // Either quote style: a single-quoted attribute is valid HTML, and silently
  // not matching it reports the page as missing a declaration that is visibly
  // right there on the tag.
  for (const match of body.matchAll(/\sdata-component=("([^"]*)"|'([^']*)')/g)) {
    const slug = (match[2] !== undefined ? match[2] : match[3]).trim();
    if (slug) declared.add(slug);
  }

  return {
    missing: expected
      .filter(page => !declared.has(styleguideSlug(page.htmlPath)))
      .map(page => `  ${page.title} — cms/${page.filename}`),
    // The digest drifts both ways: a component that is removed or drafted
    // leaves its section behind, presenting something the system no longer has.
    //
    // Checked against every page the build produces, not just the pages the
    // gate requires. `styleguide-exempt` means a page need not appear — it has
    // never meant it must not, and scoping this to the required set would turn
    // the opt-out into a ban (CLAUDE.md §8). The same allowance covers showing
    // a docs-site or brand component here deliberately.
    stale: [...declared]
      .filter(slug => !known.has(slug))
      .map(slug => `  data-component="${slug}" — no cms page produces this`),
    // A styleguide that declares nothing at all is not a passing styleguide.
    // Without this the gate is satisfied by an empty file, since `missing` is
    // the only other thing standing between it and a green build.
    empty: declared.size === 0,
  };
}

// ── Page types ──
//
// What a page IS, which decides which chrome it gets. One table, read by every
// emitter — no emitter decides chrome inline, so the answer to "does this kind
// of page have a pager?" is in exactly one place.
//
// Declared per page with an optional `type:` frontmatter field. Absent means
// `doc`, which is what all but a handful of pages are; an invalid value fails
// the build the way an invalid `layer:` does.
//
//   header    the Page Header component
//   stickyBar 'full' = breadcrumb + .md dropdown + close; false = none
//   toc       the on-this-page rail, and with it the 2-column content grid
//   pager     prev/next through the reading order
//   chrome    feedback block + footer
//   frame     'grid' = the 1080px content grid; 'wide' = full measure;
//             'free' = no frame at all, the body brings its own layout
//   body      'markdown' | 'html' — 'html' skips markdownToHtml entirely
//
// `shelf` and `contents` are assigned by the generator for the pages it builds
// itself (home, section indexes). They are in the table because the renderer
// keys on them, not because anyone authors them.
const PAGE_TYPES = {
  shelf:    { level: 0, header: true,  stickyBar: false,  toc: false, pager: false, chrome: true,  frame: 'grid', body: 'markdown' },
  contents: { level: 1, header: true,  stickyBar: 'full', toc: false, pager: false, chrome: true,  frame: 'grid', body: 'markdown' },
  doc:      { level: 2, header: true,  stickyBar: 'full', toc: true,  pager: true,  chrome: true,  frame: 'grid', body: 'markdown' },
  page:     { level: 2, header: true,  stickyBar: 'full', toc: false, pager: true,  chrome: true,  frame: 'wide', body: 'html' },
  // The loosest type on purpose. A tool can look like anything; its only
  // requirement is that the reader can get out, which is the data-page-close
  // contract enforced at build time — not chrome this emits.
  tool:     { level: 2, header: false, stickyBar: false,  toc: false, pager: false, chrome: false, frame: 'free', body: 'html' },
  bare:     { level: null, header: false, stickyBar: false, toc: false, pager: false, chrome: false, frame: 'free', body: 'html' },
};

const DEFAULT_PAGE_TYPE = 'doc';

/**
 * Resolve a page's type preset, then apply the per-page overrides.
 *
 * The overrides are the escape hatch that keeps a type a default rather than a
 * cage. Three of the four already existed and were read by generatePage;
 * `chrome` is new, and is what lets a framed tool keep its footer and feedback
 * block without the `tool` type forcing them on every tool.
 *
 * Frontmatter values are strings, so these compare against the literal 'false'
 * / 'true' — only an explicit flag flips the preset.
 */
function resolvePageType(frontmatter = {}) {
  const name = frontmatter.type || DEFAULT_PAGE_TYPE;
  // hasOwnProperty, not a truthiness test on the lookup: `type: "constructor"`
  // (or toString, valueOf, …) finds a function on Object.prototype, passes a
  // plain `if (!preset)` check, and spreads to nothing — producing
  // data-level="undefined" and no chrome from a typo the gate exists to catch.
  if (!Object.prototype.hasOwnProperty.call(PAGE_TYPES, name)) return null;
  const preset = PAGE_TYPES[name];

  const resolved = { ...preset, name };
  if (frontmatter.toc === 'false') resolved.toc = false;
  if (frontmatter.bar === 'false') resolved.stickyBar = false;
  if (frontmatter.bar === 'true') resolved.stickyBar = 'full';
  if (frontmatter.pagination === 'false') resolved.pager = false;
  if (frontmatter.chrome === 'false') resolved.chrome = false;
  if (frontmatter.chrome === 'true') resolved.chrome = true;
  // header can be opted into as well as out of, because `tool` hard-codes it
  // off — which is why five tools used to hand-draw the same page header.
  if (frontmatter.header === 'false') resolved.header = false;
  if (frontmatter.header === 'true') resolved.header = true;
  return resolved;
}

// ── Spaces ──
//
// The generator writes two kinds of site from one template: the root docs site,
// and one mini-site per brand instance under cms/brands/. They differ in seven
// values and nothing else — theme stylesheet, theme attribute, favicons, OG
// image, fonts, footer text, and the prefix on Barba's section slug.
//
// Before this descriptor existed, that difference was expressed by having two
// of every emitter (generatePage/generateBrandDocs,
// generateSectionIndexPage/generateBrandSectionOverviews, and so on), each a
// near-copy of the other. A new page type had to be built twice or the two
// sites silently disagreed, which is how the page bar's markup drifted apart.
//
// `brandRelBase` is a page's depth inside its own space, which is not the same
// as navBase (depth from the output root). A brand page at
// /acme/docs/x.html has navBase '../../' but brandRelBase '../'.

const ROOT_SPACE = {
  key: null,
  manifest: ROOT_MANIFEST,
  themeCss: (navBase) => rootThemeCss(navBase),
  themeAttr: '',
  slugPrefix: '',
  footerText: () => SITE.footerText,
  defaultsDir: () => DOCS_DIR,
};

function brandSpace(brandKey, theme) {
  return {
    key: brandKey,
    manifest: theme.manifest,
    // Relative to the brand's own root, where copyBrandAssets puts theme.css —
    // so this takes brandRelBase, unlike the root space which takes navBase.
    themeCss: (brandRelBase) =>
      `<!-- Brand Theme Override (must load last to override base styles) -->\n    <link rel="stylesheet" href="${brandRelBase}assets/theme.css">`,
    themeAttr: `data-brand-theme="${brandKey}"`,
    slugPrefix: `${brandKey}-`,
    footerText: () => buildFooterHtml(theme.manifest.footerText),
    defaultsDir: () => path.join(DOCS_DIR, 'brands', brandKey),
  };
}

/**
 * Fill the page template's slots. Every page the generator writes goes through
 * here — home, section indexes, doc pages, the brand book, brand overviews.
 *
 * Callers build their own content and pass finished strings; this function
 * knows the slot names and nothing about what a page means. That is the point:
 * adding a slot to the template is a change here and nowhere else.
 *
 * Replacements use function values throughout. A plain string replacement
 * treats `$&`, `$'` and `` $` `` in the *replacement* as patterns, so a page
 * whose content happened to contain them would silently corrupt itself.
 */
function renderPage(template, {
  space,
  navBase,
  // The home page links its assets with a bare relative path but sets NAV_BASE
  // to './' — an empty NAV_BASE would turn a dynamic import('{{NAV_BASE}}…')
  // into a bare module specifier. The two bases are therefore not always equal.
  assetBase = null,
  brandRelBase = null,
  title,
  description = '',
  header = '',
  stickyBar = '',
  content = '',
  toc = '',
  frame = 'grid',
  pageNav = '',
  access,
  scripts = '',
  sectionSlug,
  pageSection,
  order,
  level,
  chrome: hasChrome = true,
  // Sidebar start state for this page. nav.js reads data-sidebar-default and
  // matches the literal 'collapsed'; a user's saved preference still wins.
  sidebar = null,
  containerExtra = '',
}) {
  const assets = assetBase === null ? navBase : assetBase;
  const chrome = brandChromeSlots(space.manifest, assets);
  const themeCssBase = brandRelBase === null ? assets : brandRelBase;

  // {{PAGE_BODY}} is filled LAST, and the order matters.
  //
  // .replace() with a string needle takes the first occurrence in the document.
  // Every other slot sits either side of the body in the template, so if the
  // body went in first, a page whose *content* contained a slot token would
  // have the page's own copy substituted and the real slot left as a literal
  // {{PAGE_NAV}} in the shipped HTML. That is not hypothetical here: this
  // generator's own documentation page prints template tokens in code fences.
  // Filling the body last means every real slot is already gone, and whatever
  // the content says stays text. markdownToHtml makes the same move for
  // {{icon:}} by skipping <code> and <pre>.
  //
  // {{NAV_BASE}} is the one exception left — it is replaceAll, so a doc quoting
  // it verbatim still gets it rewritten. Nothing does, and the alternative is
  // sentinels for a case that has not come up.
  return template
    .replaceAll('{{PAGE_TITLE}}', () => title)
    .replaceAll('{{META_DESCRIPTION}}', () => description)
    .replace('{{PAGE_HEADER}}', () => header)
    .replace('{{PAGE_STICKY_BAR}}', () => stickyBar)
    .replace('{{DESIGN_SYSTEM_PATH}}', () => prefixHref(assets, PROJECT_CONFIG.designSystemPath))
    .replace('{{BRAND_CSS}}', () => brandCssLink(assets))
    .replace('{{BRAND_THEME_CSS}}', () => space.themeCss(themeCssBase))
    .replace('{{BRAND_THEME_ATTR}}', () => space.themeAttr)
    .replace('{{FONT_HEAD}}', () => fontHeadHtml(space.manifest, navBase))
    .replace('{{PAGE_NAV}}', () => pageNav)
    .replace('{{PAGE_CHROME}}', () => hasChrome ? buildPageChrome(space.footerText()) : '')
    .replace('{{FAVICON_LINKS}}', () => chrome.faviconLinks)
    .replace('{{OG_IMAGE}}', () => chrome.ogImage)
    .replace('{{PAGE_ACCESS}}', () => access)
    .replace('{{PAGE_SCRIPTS}}', () => scripts)
    // replaceAll: these are page-scoped constants, and the pageTransitions
    // flag appends a second set of occurrences to containerAttrs — a single
    // .replace() would let chrome injected earlier in the document steal the
    // one substitution and leave the container carrying literal tokens.
    .replaceAll('{{SECTION_SLUG}}', () => sectionSlug)
    .replaceAll('{{PAGE_SECTION}}', () => pageSection)
    .replaceAll('{{PAGE_ORDER}}', () => String(order))
    .replaceAll('{{PAGE_LEVEL}}', () => String(level))
    .replace('{{CONTAINER_EXTRA}}', () => containerExtra)
    .replace('{{LAYOUT_ATTRS}}', () => sidebar ? ` data-sidebar-default="${escapeAttr(sidebar)}"` : '')
    .replaceAll('{{NAV_BASE}}', () => navBase)
    .replace('{{PAGE_BODY}}', () => buildPageBody({ frame, content, toc }));
}

/**
 * The feedback block and footer, emitted into {{PAGE_CHROME}}.
 *
 * Kept together because they are one decision: either a page ends with the
 * site's closing furniture or it does not. `tool` pages default to not.
 */
/**
 * The page body — content, and the frame around it, emitted into {{PAGE_BODY}}.
 *
 * `free` returns the content untouched. That is the whole point of the `tool`
 * type: no measured grid, no article wrapper, nothing between <main> and the
 * markup the tool wrote.
 *
 * `wide` is the same grid as `doc` with its max-width lifted (docs-site.css
 * §1, `.docs-content-grid[data-width="wide"]`), so a custom body can use the
 * full column while keeping the page's padding and rhythm.
 */
function buildPageBody({ frame, content, toc = '' }) {
  if (frame === 'free') return content;

  const widthAttr = frame === 'wide' ? ' data-width="wide"' : '';
  return `<div class="docs-content-grid padding-global"${widthAttr}>
            <!-- Main Content -->
            <div class="docs-main">
                ${tocDropdown(toc)}
                <article>
                    ${content}
                </article>
            </div>

            <!-- Table of Contents -->
            ${tocAside(toc)}
        </div>`;
}

let _extraContentHtml = null;
function buildPageChrome(footerText) {
  // Icons are expanded here, not inherited from the template's pre-pass. This
  // block used to be substituted into the template before that pass ran; now
  // it is injected per page afterwards, so it has to expand its own. Cached
  // rather than computed at module load, because the icon map is built at the
  // start of generateDocs and is empty before then.
  if (_extraContentHtml === null) {
    _extraContentHtml = CONFIG.extraContentHtml
      .trimEnd()
      .replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name));
  }

  return `${_extraContentHtml}

        <footer class="footer">
            <div class="footer-inner">
                <div class="footer-bottom" data-layout="center">
                    <p class="text-size-small text-secondary">${footerText}</p>
                </div>
            </div>
        </footer>`;
}

/**
 * Wrap a table of contents in the docs-toc aside. Empty in, empty out.
 * Both TOC renderings are emitted by buildPageBody from the same raw list;
 * docs-site.css §8 shows exactly one of them, keyed on content-area width.
 */
function tocAside(tableOfContents) {
  if (!tableOfContents) return '';
  return `<aside class="docs-toc">
      <span class="toc-header">On this page</span>
      <div class="toc-wrapper">${tableOfContents}</div>
    </aside>`;
}

/**
 * The narrow-state TOC: a disclosure at the top of the article column,
 * directly under the sticky breadcrumb bar. Same list markup as the aside;
 * the aside, being later in the DOM, keeps the scroll-position highlighting
 * (template.html keys links by heading id — last copy wins), which a closed
 * disclosure has no use for anyway.
 */
function tocDropdown(tableOfContents) {
  if (!tableOfContents) return '';
  return `<details class="docs-toc-dropdown">
      <summary>On this page</summary>
      <div class="disclosure-content">${tableOfContents}</div>
    </details>`;
}

/**
 * Generate index page HTML
 */
function generateIndexPage(template, filesBySection) {
  let cards = '';

  if (CONFIG.indexCards) {
    // Curated index (config: indexCards): one card per entry in a 2-column grid
    cards = `<div class="docs-section">
      <div class="book-shelf">`;

    for (const card of CONFIG.indexCards) {
      cards += `
        ${renderBookCover({ ...card, headingLevel: 2 })}`;
    }

    cards += `
      </div>
    </div>`;
  } else {
    // Default index: pages grouped by section, one card per page
    const defaults = loadDefaults(DOCS_DIR);
    const sectionOrder = parseList(defaults['section-order'], DEFAULT_SECTION_ORDER);
    const sortedSections = Object.keys(filesBySection).sort((a, b) => {
      const indexA = sectionOrder.indexOf(a);
      const indexB = sectionOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });

    for (const section of sortedSections) {
      const files = [...filesBySection[section]].sort((a, b) => {
        const orderA = a.frontmatter.order || 999;
        const orderB = b.frontmatter.order || 999;
        if (orderA !== orderB) return orderA - orderB;
        return a.title.localeCompare(b.title);
      });

      cards += `<div class="docs-section">
      <h2 class="book-shelf-title">${section}</h2>
      <div class="book-shelf">`;
      for (const file of files) {
        cards += `
        ${renderBookCover({ href: file.htmlPath, title: file.title, subtitle: file.frontmatter.subtitle })}`;
      }
      cards += `
      </div>
    </div>`;
    }
  }

  const indexContent = cards;

  const access = deriveDataAccess(loadDefaults(DOCS_DIR));

  // Home lives at the repo root, so its NAV_BASE is the current directory.
  // It must be './' not '' — an empty base turns the GoTrue dynamic
  // import('{{NAV_BASE}}assets/...') into a bare module specifier, which
  // throws "Failed to resolve module specifier" and breaks auth (the home
  // page is data-access="team"), causing a login redirect loop.
  return renderPage(template, {
    space: ROOT_SPACE,
    navBase: './',
    assetBase: '',
    title: 'Home',
    description: SITE.description,
    header: buildPageHeaderHtml({ title: SITE.name, subtitle: SITE.description }),
    content: indexContent,
    access,
    sectionSlug: 'home',
    pageSection: 'home',
    order: 0,
    level: PAGE_TYPES.shelf.level,
    frame: PAGE_TYPES.shelf.frame,
    chrome: PAGE_TYPES.shelf.chrome,
  });
}

/**
 * Generate a section overview page with card grid
 */
function generateSectionIndexPage(section, template, files, filesBySection) {
  const sectionFolder = SECTION_FOLDERS[section];
  if (!sectionFolder) return null;

  // Layer Discipline (CLAUDE.md §17 Rule 5): docs-site chrome components
  // (asset-card, book-cover, dont-card) still get standalone
  // pages but are hidden from every section index, so the browsable surface
  // stays portable. Keyed on layer, not section label — the old section gate
  // silently stopped filtering when pages moved or a section was renamed.
  // An app-layer page misfiled into a portable section is a content error
  // for review to catch, not for the index to hide.
  files = files.filter(f => f.frontmatter.layer !== 'docs-site');

  // Sort files by order
  const sorted = [...files].sort((a, b) => {
    const orderA = a.frontmatter.order || 999;
    const orderB = b.frontmatter.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });

  let cards = '';

  // Generic subsection grouping (works for all sections)
  const defaults = loadDefaults(DOCS_DIR);
  const subsectionOrder = getSubsectionOrder(defaults, section);
  const ungrouped = sorted.filter(f => !f.frontmatter.subsection);
  const grouped = {};
  for (const file of sorted) {
    const sub = file.frontmatter.subsection;
    if (sub) {
      if (!grouped[sub]) grouped[sub] = [];
      grouped[sub].push(file);
    }
  }

  // Ungrouped files first
  if (ungrouped.length > 0) {
    cards += `<div class="docs-section"><div class="book-contents">`;
    for (const file of ungrouped) {
      // Absolute href so the link resolves correctly from any depth and survives
      // Barba transitions that don't update the chrome's data-base.
      let cardHref = '/' + file.htmlPath;
      let cardAccess = deriveDataAccess(file.frontmatter);
      const cardActionUrl = file.frontmatter.actionUrl || file.frontmatter.toolUrl;
      if (cardActionUrl) {
        // Frontmatter actionUrl normalized to absolute. Supports `./foo.html`,
        // `../foo.html`, and bare `foo.html` — all rooted at /<section>/.
        if (cardActionUrl.startsWith('/')) {
          cardHref = cardActionUrl;
        } else {
          const sectionFolder = SECTION_FOLDERS[section] || section.toLowerCase();
          const stripped = cardActionUrl.replace(/^(\.\.?\/)+/, '');
          cardHref = '/' + sectionFolder + '/' + stripped;
        }
        cardAccess = file.frontmatter.actionAccess || file.frontmatter.toolAccess || cardAccess;
      }
      cards += renderBookContentsItem({
        href: cardHref,
        title: file.title,
        subtitle: file.frontmatter.subtitle,
        access: cardAccess,
        meta: audienceTag(cardAccess),
        headingLevel: 2,
      });
    }

    cards += `</div></div>`;
  }

  // Subsections in configured order
  const subs = Object.keys(grouped).sort((a, b) => {
    const idxA = subsectionOrder.indexOf(a);
    const idxB = subsectionOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  for (const sub of subs) {
    cards += `<div class="docs-section"><h2 class="book-contents-title">${sub}</h2><div class="book-contents">`;
    for (const file of grouped[sub]) {
      cards += renderBookContentsItem({
        href: '/' + file.htmlPath,
        title: file.title,
        subtitle: file.frontmatter.subtitle,
        access: deriveDataAccess(file.frontmatter),
        meta: audienceTag(deriveDataAccess(file.frontmatter)),
      });
    }
    cards += `</div></div>`;
  }

  const navBase = '../';

  // Section's index in the global sectionOrder — used by the level-based
  // transition system to resolve L1 → L1 sibling navigation (e.g. clicking
  // Design System overview while on Brand Book overview slides forward).
  // Mirrors the same default chain buildPageOrder uses (line ~790).
  const sectionDefaults = loadDefaults(DOCS_DIR);
  const globalSectionOrder = parseList(sectionDefaults['section-order'], DEFAULT_SECTION_ORDER);
  const sectionIndex = globalSectionOrder.indexOf(section);
  const sectionOrderValue = sectionIndex === -1 ? 999 : sectionIndex;

  return renderPage(template, {
    space: ROOT_SPACE,
    navBase,
    title: `${section} - Overview`,
    description: `Overview of all ${section} pages.`,
    header: buildPageHeaderHtml({ title: section }),
    // A contents page closes to the shelf, the way a doc page closes to its
    // contents. Without it the only routes home are the sidebar and the header
    // logo, so the one level in the book model that could not be backed out of
    // was the middle one.
    //
    // No .md source behind a generated index, so the dropdown carries Copy link
    // alone — buildBar omits the markdown items when mdHref is null.
    stickyBar: PAGE_TYPES.contents.stickyBar
      ? buildBar({
          sectionHref: siteHref('/index.html'),
          sectionLabel: 'Home',
          title: section,
        })
      : '',
    content: cards,
    access: deriveDataAccess(loadDefaults(DOCS_DIR)),
    sectionSlug: `${slugifySection(section)}-overview`,
    pageSection: slugifySection(section),
    order: sectionOrderValue,
    level: PAGE_TYPES.contents.level,
    frame: PAGE_TYPES.contents.frame,
    chrome: PAGE_TYPES.contents.chrome,
  });
}

/**
 * Build a flat ordered list of all pages following the nav order
 */
function buildPageOrder(filesBySection) {
  const defaults = loadDefaults(DOCS_DIR);
  const sectionOrder = parseList(defaults['section-order'], DEFAULT_SECTION_ORDER);
  const hiddenSections = [];
  const sortedSections = Object.keys(filesBySection)
    .filter(s => !hiddenSections.includes(s))
    .sort((a, b) => {
    const indexA = sectionOrder.indexOf(a);
    const indexB = sectionOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  const sortByOrder = (a, b) => {
    const orderA = a.frontmatter.order || 999;
    const orderB = b.frontmatter.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  };

  const ordered = [];
  for (const section of sortedSections) {
    const files = [...filesBySection[section]];
    const subsectionOrder = getSubsectionOrder(defaults, section);

    // Ungrouped files first (no subsection), matching nav sidebar order
    const ungrouped = files.filter(f => !f.frontmatter.subsection).sort(sortByOrder);
    ordered.push(...ungrouped);

    // Then subsection groups in configured order
    const grouped = {};
    for (const file of files) {
      const sub = file.frontmatter.subsection;
      if (sub) {
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(file);
      }
    }
    const subsections = Object.keys(grouped).sort((a, b) => {
      const idxA = subsectionOrder.indexOf(a);
      const idxB = subsectionOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const sub of subsections) {
      ordered.push(...grouped[sub].sort(sortByOrder));
    }
  }
  return ordered;
}

/**
 * Build a per-section sidebar position map for Phase 3 directional transitions.
 *
 * Returns an object keyed by `file.htmlPath` whose value is the file's integer
 * position within its own section's sidebar list. Position 0 is reserved for
 * the section's "Overview" link, so real files start at position 1.
 *
 * The walk mirrors `buildNavSectionsHtml` exactly — section sort order, files
 * sorted by frontmatter.order, ungrouped files before subsection groups,
 * subsections in configured order. Using a single function for both the map
 * and the nav HTML would be cleaner, but the sidebar already has enough
 * responsibilities; a separate walk is easier to reason about.
 *
 * Tool app links: the sidebar renders the app URL (derived from actionUrl),
 * not file.htmlPath. We key the map by file.htmlPath because that's what the
 * destination doc page's container looks up. Clicked sidebar links use the
 * integer written directly into their `data-order` attribute, so the two
 * paths stay consistent.
 */
function buildSidebarOrderMap(filesBySection) {
  const defaults = loadDefaults(DOCS_DIR);
  const map = {};

  const sortByOrder = (a, b) => {
    const orderA = a.frontmatter.order || 999;
    const orderB = b.frontmatter.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  };

  for (const section of Object.keys(filesBySection)) {
    const files = [...filesBySection[section]];
    const subsectionOrder = getSubsectionOrder(defaults, section);

    let pos = 1; // 0 is the Overview link

    // Ungrouped files first
    const ungrouped = files.filter(f => !f.frontmatter.subsection).sort(sortByOrder);
    for (const file of ungrouped) {
      map[file.htmlPath] = pos++;
    }

    // Then subsection groups in configured order
    const grouped = {};
    for (const file of files) {
      const sub = file.frontmatter.subsection;
      if (sub) {
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(file);
      }
    }
    const subs = Object.keys(grouped).sort((a, b) => {
      const idxA = subsectionOrder.indexOf(a);
      const idxB = subsectionOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const sub of subs) {
      for (const file of grouped[sub].sort(sortByOrder)) {
        map[file.htmlPath] = pos++;
      }
    }
  }

  return map;
}

/**
 * Generate prev/next navigation HTML for a page
 */
function generatePageNav(file, pageOrder) {
  const index = pageOrder.findIndex(p => p.filename === file.filename);
  if (index === -1) return '';

  const prev = index > 0 ? pageOrder[index - 1] : null;
  const next = index < pageOrder.length - 1 ? pageOrder[index + 1] : null;

  if (!prev && !next) return '';

  // Compute relative href from current file's folder to target file
  function relativeHref(target) {
    const fromFolder = file.htmlFolder || '';
    const toFolder = target.htmlFolder || '';
    if (fromFolder === toFolder) return target.htmlName;
    if (fromFolder && !toFolder) return '../' + target.htmlName;
    if (!fromFolder && toFolder) return target.htmlPath;
    return '../' + target.htmlPath;
  }

  /**
   * One markup shape for both directions — the arrow always leads, and
   * data-direction="next" reverses the row in CSS. The section line renders
   * only when the target sits in a different section, marking the move from
   * one book to the next.
   *
   * The title is a span, not a heading: it labels a link rather than opening
   * a section, and two h3s in the page footer would put phantom entries in
   * the document outline that screen-reader users navigate by.
   *
   * @param {string} direction - "prev" or "next"
   * @param {object} target    - the page being linked to
   * @param {string} label     - visible eyebrow ("Previous" / "Next")
   * @param {string} arrow     - rendered arrow icon
   */
  function renderLink(direction, target, label, arrow) {
    // Truthiness matters as well as inequality: a page with no `section` in
    // frontmatter yields '', and '' !== 'Docs' would emit an empty span that
    // still draws a gap inside the column flex container.
    const sectionLabel = target.section && target.section !== file.section
      ? `<span class="page-nav-section">${target.section}</span>`
      : '';
    return `<a href="${relativeHref(target)}" class="page-nav-link" data-direction="${direction}" rel="${direction}">
      ${arrow}
      <span class="page-nav-text">
        <span class="page-nav-label">${label}</span>
        ${sectionLabel}
        <span class="page-nav-title">${target.title}</span>
      </span>
    </a>`;
  }

  const arrowLeft = `<div class="svg-icn page-nav-arrow">${getRawIcon('chevron-left-large')}</div>`;
  const arrowRight = `<div class="svg-icn page-nav-arrow">${getRawIcon('chevron-right-large')}</div>`;

  // No placeholder for a missing neighbour: grid-column pins each link to its
  // own half, so the surviving link keeps its side on its own.
  let html = '<nav class="page-nav" aria-label="Page navigation"><div class="page-nav-inner">';
  if (prev) html += renderLink('prev', prev, 'Previous', arrowLeft);
  if (next) html += renderLink('next', next, 'Next', arrowRight);
  html += '</div></nav>';
  return html;
}

/**
 * Build footer text from project config (shared by internal and brand docs).
 * A brand manifest's footerText overrides the site default.
 */
function buildFooterHtml(override) {
  return override || SITE.footerText || '';
}

/**
 * The opening block of every page the generator writes — documentation pages,
 * the brand book, the site home, section overviews and brand overviews.
 *
 * It is the Page Header component (design-system.css §44), emitted into
 * {{PAGE_HEADER}}. That slot sits inside the page's <main> and outside the
 * content grid, which is what the component expects: full bleed, with
 * .page-header-container supplying the measure.
 *
 * One function for all seven call sites on purpose. Before this there were
 * seven copies of the same markup — four emitting a `.docs-hero` into the page
 * content and three emitting `<div class="page-header"><div class="container-s">`
 * — and they had already drifted: two carried a description and two did not,
 * one carried an eyebrow, two carried an action link in a `.button-group`
 * rather than the component's own actions slot.
 *
 * No data-text-wrap on the subtitle: §44 sets text-wrap on
 * .page-header-subtitle itself and wins the specificity tie on source order,
 * so the attribute would be inert and imply behaviour that does not happen.
 */
function buildPageHeaderHtml({ title, subtitle = '', eyebrow = '', actions = '', flipId = '' } = {}) {
  if (!title) return '';
  const flipAttr = flipId ? ` data-flip-id="${escapeAttr(flipId)}"` : '';
  const parts = [];
  if (eyebrow) parts.push(`<p class="eyebrow">${eyebrow}</p>`);
  parts.push(`<h1 class="page-header-title"${flipAttr}>${title}</h1>`);
  if (subtitle) parts.push(`<p class="page-header-subtitle">${subtitle}</p>`);
  if (actions) parts.push(`<div class="page-header-actions">${actions}</div>`);
  return `<header class="page-header" data-align="center">
      <div class="page-header-container">
        ${parts.join('\n        ')}
      </div>
    </header>`;
}

/**
 * The page bar — breadcrumb, markdown-source dropdown, and the close
 * that takes the reader back up a level. Emitted into {{PAGE_STICKY_BAR}}.
 *
 * One function for both spaces. The root and brand generators each carried a
 * full copy of this markup and had already drifted apart in whitespace; a
 * change to the dropdown had to be made twice or the two spaces disagreed.
 *
 * @param {string}      sectionHref  where the breadcrumb and close point (absolute)
 * @param {string}      sectionLabel breadcrumb's first crumb
 * @param {string}      title        current page, the crumb that is not a link
 * @param {string|null} mdHref       markdown source; null omits the .md items,
 *                                   which is what a project without a served
 *                                   markdownSourceBase needs
 */
function buildBar({ sectionHref, sectionLabel, title, mdHref = null, width = 'docs' }) {
  // role="presentation" on the wrapper: role="menu" may only own menu items,
  // groups and separators, and this div exists purely to carry the auth gate.
  // Presentation hands its children straight to the menu.
  const mdSourceItems = mdHref ? `<div data-auth-role="team" role="presentation">
                <div class="dropdown-divider" role="separator"></div>
                <a href="${mdHref}" class="dropdown-item js-md-download" role="menuitem" download>
                  ${getIcon('download')}
                  <span>Download .md file</span>
                </a>
                <div class="dropdown-divider" role="separator"></div>
                <a href="${mdHref}" class="dropdown-item js-md-open" role="menuitem" target="_blank" rel="noopener noreferrer">
                  ${getIcon('open-full')}
                  <span>Open .md in new tab</span>
                </a>
              </div>` : '';

  // The order inside .bar-actions is the component's universal rule: content,
  // actions, overflow, close — close last, because it is the terminal cell
  // (design-system.css §41). No role="toolbar" here: this bar carries a
  // breadcrumb, and the class names the box while the role names the contents.
  const widthAttr = width ? ` data-width="${width}"` : '';
  return `<div class="bar" data-density="regular"${widthAttr} data-sticky="true">
      <div class="bar-container">
        <div class="bar-content">
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="${sectionHref}">${sectionLabel}</a>
            <span class="breadcrumb-separator" aria-hidden="true">/</span>
            <span aria-current="page">${title}</span>
          </nav>
        </div>
        <div class="bar-actions">
          <div class="dropdown">
            <button class="dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Markdown source options">
              ${getIcon('more-horizontal')}
            </button>
            <div class="dropdown-menu is-right" role="menu">
              <button type="button" class="dropdown-item js-copy-url" role="menuitem">
                ${getIcon('link')}
                <span>Copy link</span>
              </button>
              ${mdSourceItems}
            </div>
          </div>
          <a href="${sectionHref}" class="bar-close" data-page-close aria-label="Back to ${sectionLabel}">
            ${getIcon('close-large')}
          </a>
        </div>
      </div>
    </div>`;
}

/**
 * Build script tags for a page based on section and frontmatter.
 * - Any page can request additional scripts via the "scripts" frontmatter field.
 *   e.g. scripts: "splide, splide-auto-scroll"
 */
function buildPageScripts(section, frontmatter, navBase = '../') {
  const base = navBase;

  // Script registry — maps keywords to script tag paths (load order matters)
  const SCRIPT_REGISTRY = {
    // Third-party (per-page)
    'splide':           'https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/js/splide.min.js',
    'splide-auto-scroll': 'https://cdn.jsdelivr.net/npm/@splidejs/splide-extension-auto-scroll@0.5.3/dist/js/splide-extension-auto-scroll.min.js',
    'splide-intersection': 'https://cdn.jsdelivr.net/npm/@splidejs/splide-extension-intersection@0.2.0/dist/js/splide-extension-intersection.min.js',
  };

  const scripts = [];

  // Add per-page scripts from frontmatter (e.g. scripts: "splide")
  if (frontmatter.scripts) {
    const requested = frontmatter.scripts.split(',').map(s => s.trim().toLowerCase());
    for (const key of requested) {
      if (SCRIPT_REGISTRY[key] && !scripts.includes(SCRIPT_REGISTRY[key])) {
        scripts.push(SCRIPT_REGISTRY[key]);
      }
    }
  }

  if (scripts.length === 0) return '';

  return scripts.map(src => `    <script src="${src}" defer></script>`).join('\n');
}

/**
 * Generate page HTML
 */
// ── "Use in another product" appendix ──
// Core Design System components are consumable from the artefact package
// (see cms/setup.md). Each core component page gets a generated consumption
// block so the install command and the component's own artefacts are on the
// page where they're needed. The module list is shared with
// scripts/build-package.js via component-modules.json — a component whose
// JS ships in dist/js/ automatically gets its script include documented.
const COMPONENT_MODULES = require('./component-modules.json');
const { isPortableComponentPage } = require('./portable');

// An alias pointing at a module that isn't shipped would silently fall back to
// "No JavaScript, nothing else to include" — the exact wrong claim the alias
// exists to prevent, on a page that needs a script to work at all. Fail loudly.
for (const [slug, moduleName] of Object.entries(COMPONENT_MODULES.moduleAliases || {})) {
  if (!COMPONENT_MODULES.modules.includes(moduleName)) {
    throw new Error(
      `component-modules.json: moduleAliases "${slug}" → "${moduleName}" is not in modules[]`
    );
  }
}

// The React adapter names are advertised as importable on each component
// page, so an entry naming an export the package does not have would ship a
// copy-pasteable import that throws. Check against react/index.mjs.
const REACT_INDEX = require('path').join(__dirname, '..', '..', 'react', 'index.mjs');
if (require('fs').existsSync(REACT_INDEX)) {
  const exported = new Set(
    [...require('fs').readFileSync(REACT_INDEX, 'utf8').matchAll(/^export\s*\{([^}]+)\}/gm)]
      .flatMap((m) => m[1].split(','))
      .map((name) => name.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean)
  );
  for (const [slug, exportName] of Object.entries(COMPONENT_MODULES.reactAdapters || {})) {
    if (!exported.has(exportName)) {
      throw new Error(
        `component-modules.json: reactAdapters "${slug}" → "${exportName}" is not exported from react/index.mjs`
      );
    }
  }
}

function buildComponentUsage(file) {
  // Keyed on layer + filename, not section label (see portable.js) — the old
  // section gate would have silently dropped this block from every core page
  // the moment the section was renamed.
  if (!isPortableComponentPage(file.markdownPath, file.frontmatter)) return '';

  const slug = file.markdownPath.replace(/\.md$/, '');
  // Most components own a module named after themselves. Where two components
  // share one implementation (drawer rides on dialog.js), the alias map is what
  // stops the page claiming it needs no JavaScript at all.
  const moduleName = (COMPONENT_MODULES.moduleAliases || {})[slug] || slug + '.js';
  const cssName = slug + '.css';
  const hasJs = COMPONENT_MODULES.modules.includes(moduleName);
  const hasOwnCss = (COMPONENT_MODULES.componentCss || []).includes(cssName);
  const isHeadless = (COMPONENT_MODULES.headless || []).includes(moduleName);

  // Three style stories: companion file (ships as dist/css/<name>.css),
  // headless (no CSS at all), or the default (rules live in design-system.css).
  const stylesPart = hasOwnCss
    ? `This component's styles ship as \`dist/css/${cssName}\` — copy it into the product's served assets and link it after \`design-system.css\`.`
    : isHeadless
      ? `This component ships no CSS — it is behaviour only.`
      : `This component's styles ship in \`design-system.css\`.`;

  const jsPart = hasJs
    ? `${stylesPart} Its behaviour ships as \`dist/js/${moduleName}\` — copy it into the product's served assets and include it once per page:

\`\`\`html
<script src="assets/js/${moduleName}" defer></script>
\`\`\``
    : `${stylesPart} No JavaScript, nothing else to include.`;

  // A React product renders this contract through the packaged adapter
  // rather than by hand, so name it where the consumer is already standing.
  const adapterName = (COMPONENT_MODULES.reactAdapters || {})[slug];
  const reactPart = adapterName
    ? `

In React, render this contract through the packaged adapter instead of writing the markup by hand:

\`\`\`jsx
import { ${adapterName} } from '@bydefaultstudio/design-system/react';
\`\`\`

The adapter renders the contract above and bridges this component's events to props — see [React](/docs/react.html).`
    : '';

  return `

---

## Use in another product

The design system installs once per product:

\`\`\`bash
${COMPONENT_MODULES.install}
\`\`\`

${jsPart}${reactPart}
`;
}

function generatePage(file, template, pageOrder, sidebarOrderMap = {}) {
  const { frontmatter, content } = file;

  // The page type decides which chrome this page gets; the per-page flags in
  // frontmatter override the preset. Validated in generateDocs, so an unknown
  // type has already failed the build by the time we get here.
  const type = resolvePageType(frontmatter);

  // `html` bodies skip markdownToHtml entirely. Its post-passes rewrite markup
  // unconditionally — <table> becomes .table-scroll > table.table, <pre><code>
  // gains a copy button, inline <code> gets chipified — which is right for
  // prose and wrong for a hand-written page body. {{icon:name}} still expands:
  // the expansion normally lives inside markdownToHtml, so it is done here for
  // the bodies that skip it — the same parity the pair renderer keeps for
  // tools, and what page-types.md promises for every HTML body. The guard
  // matches the markdown path's: the shorthand stays literal inside <code>,
  // <pre>, and HTML comments — an expansion inside a comment injects the
  // fallback's own comment markers and breaks the comment open at the first
  // `-->`, spilling the remainder into the rendered page.
  let htmlContent = type.body === 'html'
    ? content.replace(
        /(<code[^>]*>[\s\S]*?<\/code>)|(<pre[^>]*>[\s\S]*?<\/pre>)|(<!--[\s\S]*?-->)|\{\{icon:([a-z0-9-]+)\}\}/g,
        (match, code, pre, comment, name) => (code || pre || comment) ? match : getIcon(name)
      )
    : markdownToHtml(content + buildComponentUsage(file));

  // Apply drop cap to first paragraph if enabled in frontmatter
  if (frontmatter.dropcap === 'true') {
    htmlContent = htmlContent.replace(/<p>/, '<p class="drop-cap">');
  }

  const tableOfContents = type.toc ? generateTableOfContents(htmlContent) : '';
  const access = deriveDataAccess(frontmatter);

  // Generate full-width page header (lives outside the content grid)
  const actionUrl = frontmatter.actionUrl || frontmatter.toolUrl;
  const actionLabel = frontmatter.actionLabel || frontmatter.toolLabel || 'Open';
  const actionLinkHtml = actionUrl
    ? `<a href="${siteHref(actionUrl)}" class="button page-action-link" data-size="small">${actionLabel}</a>`
    : '';
  pageHeader = type.header ? buildPageHeaderHtml({
    title: frontmatter.title,
    subtitle: frontmatter.subtitle,
    actions: actionLinkHtml,
    flipId: flipIdFromHref(file.htmlName),
  }) : '';

  // Page depth drives every relative href; folderless pages sit at output root
  const navBase = file.htmlFolder ? '../' : './';

  // Generate sticky sub-header bar (breadcrumb + markdown dropdown)
  //
  // Root pages close to home. They belong to no section by design — an
  // explicit filenameOverrides entry with folder '' keeps them at the output
  // root and out of every section index, and the nav reaches them through
  // rootLinks — so there is no section index to go back to. Before this they
  // got no bar at all, which left the Glossary as the one page on the
  // site with no way out and no pager: reachable, and then a dead end.
  let pageSubbar = '';
  if (type.stickyBar && frontmatter.title) {
    const sectionHref = file.htmlFolder
      ? siteHref(`/${file.htmlFolder}/index.html`)
      : siteHref('/index.html');
    const sectionLabel = file.htmlFolder
      ? (file.section || file.htmlFolder.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '))
      : 'Home';
    pageSubbar = buildBar({
      sectionHref,
      sectionLabel,
      title: frontmatter.title,
      // Markdown-source items only when the .md files are reachable from the
      // served site (config: markdownSourceBase)
      mdHref: CONFIG.markdownSourceBase ? `${navBase}${CONFIG.markdownSourceBase}/${file.markdownPath}` : null,
    });
  }

  // Build page scripts based on section and frontmatter
  const pageScripts = buildPageScripts(file.section, frontmatter, navBase);

  return renderPage(template, {
    space: ROOT_SPACE,
    navBase,
    title: frontmatter.title || 'Untitled',
    description: frontmatter.description || '',
    header: pageHeader,
    stickyBar: pageSubbar,
    content: htmlContent,
    toc: type.toc ? tableOfContents : '',
    frame: type.frame,
    pageNav: type.pager ? generatePageNav(file, pageOrder) : '',
    access,
    scripts: pageScripts,
    sectionSlug: slugifySection(file.section),
    pageSection: slugifySection(file.section),
    // Per-section sidebar position (matches the data-order on the matching
    // sidebar sidebar-nav-link). Falls back to 999 for files not in any sidebar.
    order: sidebarOrderMap[file.htmlPath] || 999,
    level: type.level,
    chrome: type.chrome,
    // The tool pair renderer has always passed this; a cms/*.md page could not,
    // so `sidebar: "collapsed"` in frontmatter was read by nothing and did
    // nothing — the quietest kind of wrong, since the page still built. Both
    // renderers now read the same field.
    sidebar: frontmatter.sidebar || null,
  });
}

/**
 * Generate nav.js — a synchronous script that injects the top nav + sidebar
 * into any page via a #site-nav mount point.
 *
 * Mount point attributes:
 *   data-base=""     → root pages (assets/...)
 *   data-base="../"  → subdirectory pages (../assets/...)
 *   data-sidebar="false" → top nav only, no sidebar
 */
function generateNavJs(filesBySection) {
  // Build navigation HTML (no active page — active detection is done at runtime)
  const navSectionsHtml = buildNavSectionsHtml(filesBySection);

  // Escape backticks and backslashes for embedding in a JS template literal
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/'/g, "\\'");

  // Site-header logo (config: logoHtml) — plain site name when not configured.
  // A bare <span> rather than a class, because the class would have no CSS
  // anywhere; the link it sits in already supplies colour and alignment.
  const logoHtml = CONFIG.logoHtml || `<span>${SITE.name}</span>`;

  // Contact link (config: contactHref / contactLabel) — omitted when unset.
  // .header-action-label is what the header's mobile rules collapse away; the
  // accessible name stays on aria-label, so nothing is lost when it goes.
  const contactNavJs = CONFIG.contactHref ? `
    + '<a href="${siteHref(CONFIG.contactHref)}" class="button header-action header-contact-link" aria-label="${CONFIG.contactLabel}">'
    + '<div class="svg-icn">' + ICON_MAIL + '</div>'
    + '<span class="header-action-label">${CONFIG.contactLabel}</span>'
    + '</a>'` : '';

  const script = `/**
 * nav.js — Auto-generated by cms/generator/generate-docs.js
 * Injects top nav + sidebar into any page with a #site-nav mount point.
 * DO NOT EDIT MANUALLY — re-run: cd cms/generator && npm run docgen
 */
(function initSiteNav() {
  'use strict';

  var mount = document.getElementById('site-nav');
  if (!mount) return;

  var hasSidebar = mount.getAttribute('data-sidebar') !== 'false';

  // ── Shared SVG icons (loaded from assets/images/svg-icons/) ──
  var ICON_HAMBURGER = '${esc(getRawIcon('menu'))}';
  var ICON_CLOSE = '${esc(getRawIcon('close'))}';
  var ICON_COLLAPSE = '${esc(getRawIcon('sidebar-left-close'))}';
  var ICON_EXPAND = '${esc(getRawIcon('sidebar-left-open'))}';
  var ICON_BACK = '${esc(getRawIcon('back-arrow'))}';
  var ICON_HOME = '${esc(getRawIcon('home'))}';
  var ICON_SUN = '${esc(getRawIcon('sun'))}';
  var ICON_MOON = '${esc(getRawIcon('moon'))}';
  var ICON_MAIL = '${esc(getRawIcon('mail'))}';

  // ── Build site header HTML ──
  var headerStart = '<div class="site-header-start">';

  if (hasSidebar) {
    // Opens the nav drawer. dialog.js supplies Escape, the focus trap, focus
    // return and scroll lock from these attributes alone — there is no
    // hand-written open/close code behind this button.
    headerStart += '<button type="button" class="button header-action header-menu-btn" data-icon-only'
      + ' data-drawer-open="site-nav-drawer" aria-controls="site-nav-drawer"'
      + ' aria-expanded="false" aria-label="Open navigation">'
      + '<div class="svg-icn hamburger-icon-open">' + ICON_HAMBURGER + '</div>'
      + '<div class="svg-icn hamburger-icon-close">' + ICON_CLOSE + '</div>'
      + '</button>';
  }

  headerStart += '<a href="${siteHref('/index.html')}" class="site-header-logo">'
    + '${esc(logoHtml)}'
    + '</a></div>';

  var ICON_CHEVRON_DOWN = '${esc(getRawIcon('chevron-down'))}';

  var headerEnd = '<div class="site-header-end">'${contactNavJs}
    + '<button type="button" class="button header-action dark-mode-toggle" data-icon-only aria-label="Dark mode">'
    + '<div class="svg-icn dark-mode-icon-light">' + ICON_SUN + '</div>'
    + '<div class="svg-icn dark-mode-icon-dark">' + ICON_MOON + '</div>'
    + '</button>'
    + '</div>';

  // The skip link is first in the DOM so it is the first thing Tab reaches.
  var headerHtml = '<header class="site-header">'
    + '<a class="skip-link" href="#main">Skip to content</a>'
    + '<div class="site-header-inner">' + headerStart + headerEnd + '</div>'
    + '</header>';

  // ── Build sidebar HTML (if needed) ──
  var sidebarHtml = '';
  if (hasSidebar) {
    // A <dialog>, not an <aside>. Above the mobile breakpoint the CSS
    // overrides the UA's display:none and this behaves as an ordinary in-flow
    // sidebar; below it, dialog.js opens it with showModal(), which is what
    // actually removes its ~130 links from the accessibility tree rather than
    // just moving them off-screen.
    sidebarHtml = '<dialog id="site-nav-drawer" class="site-sidebar drawer" data-placement="start" aria-label="Site navigation">'
      + '<div class="site-sidebar-header">'
      + '<button class="site-sidebar-toggle" aria-label="Collapse sidebar" type="button">'
      + '<div class="svg-icn sidebar-icon-open">' + ICON_COLLAPSE + '</div>'
      + '<div class="svg-icn sidebar-icon-close">' + ICON_EXPAND + '</div>'
      + '</button>'
      // Mobile only: closing by backdrop tap works but is not discoverable,
      // and there is no Escape key on a touch device. data-drawer-close is
      // dialog.js's own attribute, so this needs no extra wiring.
      + '<button type="button" class="button close-btn site-sidebar-close" data-icon-only data-size="small" data-drawer-close aria-label="Close navigation">'
      + '<div class="svg-icn">' + ICON_CLOSE + '</div>'
      + '</button>'
      + '</div>'
      + '<div class="site-sidebar-content">'
      + '<a href="${siteHref('/index.html')}" class="sidebar-nav-link sidebar-nav-home" data-access="team" aria-label="Home" data-tooltip="Home" data-tooltip-position="right">'
      + '<div class="svg-icn">' + ICON_HOME + '</div>'
      + '<span>Home</span>'
      + '</a>'
      + \`${esc(navSectionsHtml)}\`
      + '</div>'
      + '</dialog>';
  }

  // ── Inject into page ──
  // The mount (#site-nav) already contains <main class="docs-main-area"> from
  // the template. Use insertAdjacentHTML to prepend the header + sidebar
  // BEFORE the existing <main>, preserving it in place as a grid sibling.
  mount.insertAdjacentHTML('afterbegin', headerHtml + sidebarHtml);

  // Give the skip link something to land on. Done here rather than in the
  // page template because hand-written pages (the tool apps) use the same
  // mount without coming from that template — this covers both.
  var mainEl = mount.querySelector('.docs-main-area');
  if (mainEl && !mainEl.id) mainEl.id = 'main';

  // Sidebar nav links are emitted as absolute paths so they resolve correctly
  // regardless of the current page's depth — no runtime fixup needed.

  // ── Active link detection ──
  // Exposed as window.refreshNavActive so a client-side router can re-run it
  // after each page swap (the nav itself stays put outside the swapped DOM).
  if (hasSidebar) {
    // Normalize: treat /path/ and /path/index.html as equal
    function normPath(p) {
      return p.replace(/\\/index\\.html$/, '/').replace(/\\/$/, '');
    }

    function setActiveLink() {
      var navLinks = mount.querySelectorAll('.sidebar-nav-link');
      var currentNorm = normPath(window.location.pathname);

      // Clear previous active state (idempotent — safe to call repeatedly)
      for (var k = 0; k < navLinks.length; k++) {
        navLinks[k].classList.remove('sidebar-nav-link-active');
        navLinks[k].removeAttribute('aria-current');
      }

      for (var j = 0; j < navLinks.length; j++) {
        var link = navLinks[j];
        // Resolve the link href to an absolute path (handles ../ prefixes correctly)
        var resolvedPath = new URL(link.href, window.location.href).pathname;
        var resolvedNorm = normPath(resolvedPath);

        if (currentNorm === resolvedNorm) {
          link.classList.add('sidebar-nav-link-active');
          link.setAttribute('aria-current', 'page');
          // Open parent details section and subsection dropdown
          var parentDetails = link.closest('.sidebar-nav-section');
          if (parentDetails) {
            parentDetails.setAttribute('open', '');
          }
          var parentSubsection = link.closest('.sidebar-nav-subsection');
          if (parentSubsection) {
            parentSubsection.setAttribute('open', '');
          }
        }
      }
    }

    setActiveLink();
    window.refreshNavActive = setActiveLink;
  }

  // ── Body class management ──
  if (!hasSidebar) {
    document.body.classList.add('no-sidebar');
  }

  // ── Sidebar collapse toggle (desktop) ──
  var SIDEBAR_KEY = 'docs-sidebar-collapsed';

  if (hasSidebar) {
    var sidebarToggle = mount.querySelector('.site-sidebar-toggle');

    // Restore saved state (respect page-level default when no user preference saved)
    var savedCollapsed = localStorage.getItem(SIDEBAR_KEY);
    var defaultCollapsed = mount.getAttribute('data-sidebar-default') === 'collapsed';
    if (savedCollapsed === 'true' || (savedCollapsed === null && defaultCollapsed)) {
      document.body.classList.add('sidebar-collapsed');
      if (sidebarToggle) sidebarToggle.setAttribute('aria-label', 'Expand sidebar');
    }

    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function() {
        var isCollapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_KEY, isCollapsed);
        this.setAttribute('aria-label', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
      });
    }

    // Esc dismisses the collapsed-sidebar tooltips (WCAG 1.4.13); moving the
    // pointer to another row or shifting focus re-arms them.
    var sidebarEl = mount.querySelector('.site-sidebar');

    function dismissSidebarTooltips(e) {
      if (e.key === 'Escape' && document.body.classList.contains('sidebar-collapsed')) {
        document.body.classList.add('sidebar-tooltips-dismissed');
      }
    }

    function rearmSidebarTooltips() {
      document.body.classList.remove('sidebar-tooltips-dismissed');
    }

    document.addEventListener('keydown', dismissSidebarTooltips);
    if (sidebarEl) {
      sidebarEl.addEventListener('mouseover', rearmSidebarTooltips);
      sidebarEl.addEventListener('focusin', rearmSidebarTooltips);
    }
  }

  // ── Section toggle clicks: delegated guard on the sidebar ──
  // Delegated (not per-summary) so it survives theme-loader.js rebuilding
  // the nav for brand users. stopPropagation would hide the click from
  // document-level router listeners; preventDefault stops the details
  // toggle / native follow while the event keeps bubbling so navigation
  // still happens.
  if (hasSidebar) {
    var sidebarClickRoot = mount.querySelector('.site-sidebar');

    function guardSummaryClick(e) {
      if (!e.target.closest || !e.target.closest('.sidebar-nav-section-toggle')) return;
      if (e.target.closest('.sidebar-nav-section-icon')) {
        e.preventDefault();
        return;
      }
      // Collapsed strip (desktop only — the class persists on mobile,
      // where the overlay still needs toggling): the list is hidden, so
      // toggling would only flip aria-expanded with nothing revealed.
      // Negated max-width matches the CSS breakpoint exactly, including
      // fractional viewport widths between 768 and 769px.
      if (document.body.classList.contains('sidebar-collapsed')
          && !window.matchMedia('(max-width: 768px)').matches) {
        e.preventDefault();
      }
    }

    if (sidebarClickRoot) {
      sidebarClickRoot.addEventListener('click', guardSummaryClick);
    }
  }

  // ── Mobile nav drawer ──
  // Opening, closing, Escape, the focus trap, focus return and scroll lock
  // all come from dialog.js via the button's data-drawer-open attribute.
  // What is left here is the part dialog.js cannot know about: this element
  // is only a drawer below the breakpoint, so a viewport that grows while it
  // is open would strand an open modal styled as an in-flow sidebar.
  if (hasSidebar) {
    var navDrawer = document.getElementById('site-nav-drawer');
    var menuBtn = mount.querySelector('.header-menu-btn');
    var desktopQuery = window.matchMedia('(min-width: 769px)');

    function closeDrawerOnDesktop(e) {
      if (e.matches && navDrawer && navDrawer.open) {
        window.bdRequestClose(navDrawer, 'resize');
      }
    }

    desktopQuery.addEventListener('change', closeDrawerOnDesktop);

    // aria-expanded is the button's own state and dialog.js does not own it.
    // Driven off the dialog's real open/close events so the two cannot drift.
    if (menuBtn && navDrawer) {
      function syncMenuBtn() {
        var isOpen = navDrawer.open;
        menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        menuBtn.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
      }

      menuBtn.addEventListener('click', function() {
        // The dialog opens on the same click; read state on the next frame.
        window.requestAnimationFrame(syncMenuBtn);
      });
      navDrawer.addEventListener('close', syncMenuBtn);
    }
  }

  // ── Dark mode toggle ──
  // Three states on <html>: no data-theme = follow the OS (the
  // prefers-color-scheme fallback), "light"/"dark" = explicit choice.
  // Never remove the attribute — absence re-arms the fallback, so an
  // OS-dark visitor could never reach light mode.
  var DARK_KEY = 'dark-mode';
  var darkToggle = mount.querySelector('.dark-mode-toggle');

  function isDarkNow() {
    var choice = document.documentElement.getAttribute('data-theme');
    if (choice) return choice === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Apply saved preference; without one the attribute stays unset and the
  // OS preference drives the theme
  var savedDark = null;
  try { savedDark = localStorage.getItem(DARK_KEY); } catch (e) { /* storage unavailable */ }
  if (savedDark !== null) {
    document.documentElement.setAttribute('data-theme', savedDark === 'true' ? 'dark' : 'light');
  }

  if (darkToggle) {
    darkToggle.setAttribute('aria-pressed', String(isDarkNow()));
    darkToggle.addEventListener('click', function toggleDarkMode() {
      var next = isDarkNow() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      darkToggle.setAttribute('aria-pressed', String(next === 'dark'));
      try { localStorage.setItem(DARK_KEY, next === 'dark'); } catch (e) { /* theme still applies for this page */ }
    });
    // A held Enter re-fires click on native buttons — suppress the repeats
    // so the page can't strobe between themes (WCAG 2.3.1)
    darkToggle.addEventListener('keydown', function suppressHeldEnter(event) {
      if (event.repeat) event.preventDefault();
    });
    // With no explicit choice the OS drives the theme — keep the reported
    // state in sync when it changes mid-session
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function syncTogglePressed() {
      if (!document.documentElement.hasAttribute('data-theme')) {
        darkToggle.setAttribute('aria-pressed', String(isDarkNow()));
      }
    });
  }

  // Header dropdown toggles handled by dropdown.js

  // Signal that nav is ready
  document.body.classList.add('nav-ready');
})();
`;

  return script;
}

/**
 * Build nav sections HTML string for embedding in nav.js
 *
 * Takes no order map: nav links number themselves as they are emitted, which is
 * what keeps them in step with buildSidebarOrderMap. The map was only ever read
 * by the removed Tools `Guides` block.
 */
function buildNavSectionsHtml(filesBySection) {
  let html = '';

  // Shared chevron for section and subsection toggles
  const navChevron = `<span class="sidebar-nav-toggle-icon">
          <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
            <path d="M3.58943 3L1.28943 0.7L1.98943 0L4.98943 3L1.98943 6L1.28943 5.3L3.58943 3Z" fill="currentColor"/>
          </svg>
        </span>`;

  // Section icons (config: sectionIcons — section label → icon key)
  const sectionIconMap = {};
  for (const [sectionName, iconKey] of Object.entries(CONFIG.sectionIcons)) {
    sectionIconMap[sectionName] = { icon: getRawIcon(iconKey) };
  }

  // Root-level links above the section list (config: rootLinks — array of
  // { title, href, icon, access? }). Each renders as a single nav link in the
  // same shape as the Home link, never as a one-item collapsible section.
  // For root pages that belong to no section (e.g. the Glossary).
  for (const link of CONFIG.rootLinks || []) {
    // Fail loudly on a bad entry — a silent skip here would ship a nav with a
    // missing or dead root link and nothing in the build output to say why.
    if (!link.title || !link.href) {
      console.error(`❌ rootLinks entry needs both title and href: ${JSON.stringify(link)}`);
      process.exit(1);
    }
    if (link.icon && !ICON_MAP[link.icon]) {
      console.error(`❌ rootLinks icon not in the registry: "${link.icon}" (${link.title})`);
      process.exit(1);
    }
    const rootIconHtml = link.icon ? `<div class="svg-icn">${getRawIcon(link.icon)}</div>` : '';
    html += `<a href="${siteHref(link.href)}" class="sidebar-nav-link sidebar-nav-root-link" data-access="${escapeAttr(link.access || 'team')}" aria-label="${escapeAttr(link.title)}" data-tooltip="${escapeAttr(link.title)}" data-tooltip-position="right">${rootIconHtml}<span>${escapeAttr(link.title)}</span></a>`;
  }

  // Read ordering from _defaults.md (configurable per directory)
  const defaults = loadDefaults(DOCS_DIR);
  const sectionOrder = parseList(defaults['section-order'], DEFAULT_SECTION_ORDER);
  const sortedSections = Object.keys(filesBySection)
    .sort((a, b) => {
      const indexA = sectionOrder.indexOf(a);
      const indexB = sectionOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });

  for (const section of sortedSections) {
    const files = [...filesBySection[section]];
    const subsectionOrder = getSubsectionOrder(defaults, section);

    files.sort((a, b) => {
      const orderA = a.frontmatter.order || 999;
      const orderB = b.frontmatter.order || 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.title.localeCompare(b.title);
    });

    const sectionLabel = section.charAt(0).toUpperCase() + section.slice(1);

    const sectionIcon = sectionIconMap[section];
    const sectionFolder = SECTION_FOLDERS[section];
    // Absolute URLs (leading `/`) so links resolve from any page depth and survive
    // Barba transitions that don't update the surrounding chrome's data-base.
    const sectionIndexHref = sectionFolder ? siteHref('/' + sectionFolder + '/index.html') : '';
    // Slug used by Phase 3 directional transitions to detect same/different section
    const sectionSlug = slugifySection(section);
    const iconHtml = sectionIcon
      ? `<a href="${sectionIndexHref}" class="sidebar-nav-section-icon" data-section="${sectionSlug}" aria-label="${escapeAttr(sectionLabel)}"><div class="svg-icn">${sectionIcon.icon}</div></a>`
      : '';

    html += `<details class="sidebar-nav-section">
      <summary class="sidebar-nav-section-toggle" aria-label="${escapeAttr(sectionLabel)}" data-tooltip="${escapeAttr(sectionLabel)}" data-tooltip-position="right">
        ${iconHtml}<span>${sectionLabel}</span>
        ${navChevron}
      </summary>
      <ul class="sidebar-nav-list">`;

    // Overview link (first item in every section, only when the section has a
    // folder and therefore an index page). data-order="0" so direction
    // detection always treats it as the lowest-order page in the section.
    if (sectionIndexHref) {
      html += `<li><a href="${sectionIndexHref}" class="sidebar-nav-link" data-section="${sectionSlug}" data-order="0" data-access="team"><span>Overview</span></a></li>`;
    }

    // Sequential counter mirrors buildSidebarOrderMap — same walk order, so the
    // data-order on each sidebar-nav-link matches the data-order on its destination
    // page's container. Resets per section, starts at 1 (0 is Overview).
    let navPos = 1;

    // Group files by subsection
    const ungrouped = files.filter(f => !f.frontmatter.subsection);
    const grouped = {};
    for (const file of files) {
      const sub = file.frontmatter.subsection;
      if (sub) {
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(file);
      }
    }

    // Render ungrouped files first
    for (const file of ungrouped) {
      // For Tools section: link to actual tool app, use actionAccess for visibility.
      // All hrefs are emitted as absolute paths (`/section/file.html`).
      let linkHref = siteHref('/' + file.htmlPath);
      let linkAccess = deriveDataAccess(file.frontmatter);
      const navActionUrl = file.frontmatter.actionUrl || file.frontmatter.toolUrl;
      if (section === 'Tools' && navActionUrl) {
        // actionUrl is relative to the tool docs page (e.g. "./cpm-calculator.html").
        // Resolve to an absolute site path.
        const fileName = navActionUrl.replace(/^(\.\.?\/)+/, '');
        const sectionFolder = SECTION_FOLDERS[section] || 'tools';
        linkHref = siteHref('/' + sectionFolder + '/' + fileName);
        linkAccess = file.frontmatter.actionAccess || file.frontmatter.toolAccess || 'brand';
      }
      html += `<li><a href="${linkHref}" class="sidebar-nav-link" data-section="${sectionSlug}" data-order="${navPos}" data-access="${linkAccess}"><span>${file.title}</span></a></li>`;
      navPos++;
    }

    // A Tools entry above points at the tool app, not at the tool's guide page.
    // The guides used to be listed here too, under a `Guides` disclosure — but
    // every entry in it repeated a label from the list directly above, so the
    // sidebar showed each tool's name twice with nothing to say which was
    // which, and the guides went unread behind a collapsed group.
    //
    // They are still generated, and each one still links out to its tool. But
    // nothing links *in*: no tool app references its guide, and the section
    // index points only at the apps, so the guides are now reachable by URL or
    // by pager-walking the chain from the LLM Reference. That is the accepted
    // cost of removing the duplicate rows, and it is temporary — the intended
    // home for this content is a dialog opened from inside the tool, which is
    // the edge that has always been missing. See ROADMAP.
    //
    // A Tools page with no `actionUrl` is a guide with no app (the LLM
    // Reference), so it falls through the branch above and lists normally.

    // Render subsections in order
    const subsections = Object.keys(grouped).sort((a, b) => {
      const idxA = subsectionOrder.indexOf(a);
      const idxB = subsectionOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    // Each subsection is its own collapsed dropdown so long sections (Design
    // System, Brand Book) stay scannable. setActiveLink opens the active one.
    for (const sub of subsections) {
      html += `<li><details class="sidebar-nav-subsection">
        <summary class="sidebar-nav-subsection-toggle"><span>${sub}</span>${navChevron}</summary>
        <ul class="sidebar-nav-sublist">`;
      for (const file of grouped[sub]) {
        const linkAccess = deriveDataAccess(file.frontmatter);
        html += `<li><a href="${siteHref('/' + file.htmlPath)}" class="sidebar-nav-link" data-section="${sectionSlug}" data-order="${navPos}" data-access="${linkAccess}"><span>${file.title}</span></a></li>`;
        navPos++;
      }
      html += `</ul></details></li>`;
    }

    html += `</ul></details>`;
  }

  return html;
}

/**
 * Recursively copy a directory and all its contents.
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy brand assets from cms/brands/{brandKey}/assets/ to {OUTPUT_DIR}/{brandKey}/assets/.
 * Recursively copies all subdirectories (logos/, fonts/, etc.).
 * Runs before page generation so CSS, logos, and fonts are available.
 */
//------- Brand manifests (cms/brands/<brand>/brand.json) -------//
//
// The manifest is the single seam between brand settings and the build: a
// future CMS swaps this file read for an API read and nothing downstream
// changes. Presence of brand.json is the brand allowlist — a folder without
// one is skipped. The generator emits assets/js/theme-config.js wholesale
// from these manifests plus the pages it generates; nothing regex-rewrites
// the live JS file anymore.

/**
 * Read and validate one brand manifest by path. Returns null if the file does
 * not exist (not a brand space); throws on malformed JSON or a missing name
 * so a broken manifest fails the build instead of shipping a half-built brand.
 * Hoisted — the config head calls it for the root manifest.
 */
function readManifestFile(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${err.message}`);
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error(`${manifestPath} is missing the required "name" field`);
  }
  return manifest;
}

function loadBrandManifest(brandKey) {
  if (!BRANDS_DIR) return null;
  return readManifestFile(path.join(BRANDS_DIR, brandKey, 'brand.json'));
}

/**
 * Scan cms/brands/ and build the in-memory theme registry from manifests.
 * Shape matches the runtime THEME_CONFIG contract (label/css/fonts/pages);
 * css is convention (<brand>/assets/theme.css), never configured. The raw
 * manifest rides along for build-time use and is stripped before emit.
 */
function loadBrandThemes() {
  const brandsDir = BRANDS_DIR;
  if (!brandsDir || !fs.existsSync(brandsDir)) return {};
  const themes = {};
  // Sorted so the emitted registry is deterministic across filesystems
  for (const dir of fs.readdirSync(brandsDir).sort()) {
    if (!fs.statSync(path.join(brandsDir, dir)).isDirectory()) continue;
    // Instance 0 is the root site, not a switchable brand space: its theme
    // loads as a static link on every root page, and "clear preview" IS the
    // return to By Default. Listing it in the registry would spawn a
    // duplicate /bydefault/ shell and a switcher entry that unloads itself.
    if (dir === ROOT_BRAND_KEY) continue;
    const manifest = loadBrandManifest(dir);
    if (!manifest) continue;
    // Only brands with a theme stylesheet are switchable instances.
    if (!fs.existsSync(path.join(brandsDir, dir, 'assets', 'theme.css'))) continue;
    themes[dir] = {
      label: manifest.name,
      description: manifest.description || '',
      css: `${dir}/assets/theme.css`,
      fonts: manifest.googleFontsUrl || null,
      pages: [{ title: 'Home', href: `/${dir}/index.html` }],
      manifest,
    };
  }
  return themes;
}

/**
 * Resolve the favicon/OG chrome slots for a page. Brand manifests provide
 * absolute site paths; pages without a brand (or manifests without the keys)
 * fall back to the site defaults, resolved against the page's nav base.
 * Fallback favicon links are emitted only when the files actually exist in
 * the output — a project without favicons gets no dead links.
 */
function brandChromeSlots(manifest, base) {
  const m = manifest || {};
  const svg = siteHref(m.faviconSvg)
    || (fs.existsSync(path.join(OUTPUT_DIR, 'assets', 'icons', 'favicon.svg')) ? `${base}assets/icons/favicon.svg` : null);
  const ico = siteHref(m.faviconIco)
    || (fs.existsSync(path.join(OUTPUT_DIR, 'assets', 'icons', 'favicon.ico')) ? `${base}assets/icons/favicon.ico` : null);
  const links = [];
  if (svg) links.push(`<link rel="icon" type="image/svg+xml" href="${svg}">`);
  if (ico) links.push(`<link rel="icon" type="image/x-icon" href="${ico}">`);
  return {
    faviconLinks: links.length
      ? `<!-- Favicon (per-brand via brand.json, site default otherwise) -->\n    ${links.join('\n    ')}`
      : '',
    ogImage: siteHref(m.ogImage) || `${base}assets/images/og/og-default.jpg`,
  };
}

/**
 * Serialize the theme registry to assets/js/theme-config.js in one write.
 * JSON.stringify handles all quoting, so the regex-rewrite escaping bugs
 * this replaced can't recur.
 */
function writeThemeConfig(themes) {
  const emitted = {};
  for (const [key, t] of Object.entries(themes)) {
    emitted[key] = {
      label: t.label,
      description: t.description,
      css: t.css,
      fonts: t.fonts,
      // Page hrefs are site-absolute in the in-memory registry; root them
      // under basePath at the emit boundary, like every other output href.
      pages: t.pages.map(pg => ({ ...pg, href: siteHref(pg.href) })),
    };
  }
  const payload = { themes: emitted };
  // Instance-0 signature settings ride along so the Email Signature tool's
  // output reads from the manifest, never from literals (rework §3.4).
  if (ROOT_MANIFEST && ROOT_MANIFEST.emailSignature) {
    payload.emailSignature = ROOT_MANIFEST.emailSignature;
  }
  const banner = `/**
 * Theme Configuration (GENERATED FILE, do not edit)
 *
 * Built from cms/brands/<brand>/brand.json manifests by
 * cms/generator/generate-docs.js. Edit a manifest (or the brand's markdown),
 * then re-run: cd cms/generator && npm run docgen
 *
 * Tool access is managed via frontmatter in cms/*.md files (toolAccess field),
 * NOT here. See cms/access-control.md.
 *
 * @version 4.0.0
 */

`;
  const js = banner + 'var THEME_CONFIG = ' + JSON.stringify(payload, null, 2) + ';\n';
  const themeConfigPath = path.join(OUTPUT_DIR, 'assets', 'js', 'theme-config.js');
  fs.mkdirSync(path.dirname(themeConfigPath), { recursive: true });
  fs.writeFileSync(themeConfigPath, js);
  console.log('📄 Generated: assets/js/theme-config.js');
}

function copyBrandAssets(brandKey) {
  if (!BRANDS_DIR) return;
  const srcDir = path.join(BRANDS_DIR, brandKey, 'assets');
  if (!fs.existsSync(srcDir)) return;
  copyDirRecursive(srcDir, path.join(OUTPUT_DIR, brandKey, 'assets'));
}

/**
 * Generate brand doc pages from markdown files in cms/brands/{brandFolder}/
 *
 * Frontmatter fields:
 *   title    — page title (required)
 *   section  — sidebar section label (optional, pages without one become top-level)
 *   order    — sort order within section (optional, default 99)
 *
 * Output: {brandFolder}/{sectionSlug}/{filename}.html
 * Appends each generated page to themes[brandKey].pages (emitted by writeThemeConfig).
 */
function generateBrandDocs(template, themes) {
  const brandsDir = BRANDS_DIR;
  if (!brandsDir || !fs.existsSync(brandsDir)) return;

  const brandDirs = fs.readdirSync(brandsDir).filter(dir => {
    return fs.statSync(path.join(brandsDir, dir)).isDirectory() && themes[dir];
  });

  for (const brandKey of brandDirs) {
    // Copy brand assets (theme CSS, logos) to output
    copyBrandAssets(brandKey);

    const brandDocsPath = path.join(brandsDir, brandKey);
    const mdFiles = fs.readdirSync(brandDocsPath)
      .filter(f => f.endsWith('.md') && !f.startsWith('README') && !f.startsWith('_'));

    if (mdFiles.length === 0) continue;

    const theme = themes[brandKey];
    const space = brandSpace(brandKey, theme);
    const pages = [];
    const brandFiles = [];

    // Load folder defaults for this brand directory
    const brandDefaults = loadDefaults(brandDocsPath);

    for (const filename of mdFiles) {
      const filePath = path.join(brandDocsPath, filename);
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseFrontmatter(raw);
      // Merge folder defaults — page frontmatter wins
      const frontmatter = { ...brandDefaults, ...parsed.frontmatter };
      const content = parsed.content;

      // Skip draft pages
      if (frontmatter.status === 'draft') {
        console.log(`⏭️  Skipped (draft): ${brandKey}/${filename}`);
        continue;
      }

      const title = frontmatter.title || filename.replace('.md', '');
      const htmlName = filename.replace('.md', '.html');
      let htmlContent = markdownToHtml(content);

      // Apply drop cap to first paragraph if enabled in frontmatter
      if (frontmatter.dropcap === 'true') {
        htmlContent = htmlContent.replace(/<p>/, '<p class="drop-cap">');
      }

      const tableOfContents = generateTableOfContents(htmlContent);
      const order = parseInt(frontmatter.order, 10) || 99;

      // Derive section subfolder for nested brand output
      const sectionSlug = frontmatter.section ? frontmatter.section.toLowerCase().replace(/\s+/g, '-') : '';
      const navBase = sectionSlug ? '../../' : '../';

      // Full-width page header (lives outside the content grid)
      const brandActionUrl = frontmatter.actionUrl || frontmatter.toolUrl;
      const brandActionLabel = frontmatter.actionLabel || frontmatter.toolLabel || 'Open';
      const brandActionHtml = brandActionUrl
        ? `<a href="${siteHref(brandActionUrl)}" class="button page-action-link" data-size="small">${brandActionLabel}</a>`
        : '';
      pageHeader = buildPageHeaderHtml({
        title,
        subtitle: frontmatter.subtitle,
        actions: brandActionHtml,
        flipId: flipIdFromHref(htmlName),
      });

      // Build sticky sub-header bar (breadcrumb + markdown dropdown)
      let pageSubbar = '';
      if (title && frontmatter.section) {
        const sectionLabel = frontmatter.section;
        // Absolute href so the link resolves correctly from any page depth
        // (e.g. surviving Barba transitions where chrome data-base goes stale).
        const overviewHref = siteHref(sectionSlug
          ? `/${brandKey}/${sectionSlug}/index.html`
          : `/${brandKey}/index.html`);
        pageSubbar = buildBar({
          sectionHref: overviewHref,
          sectionLabel,
          title,
          mdHref: `${navBase}${BRANDS_REL}/${brandKey}/${filename}`,
        });
      }

      // {{PAGE_NAV}} is deliberately left unfilled — prev/next needs the whole
      // brand's page order, which pass 2 below supplies.
      const html = renderPage(template, {
        space,
        navBase,
        brandRelBase: sectionSlug ? '../' : '',
        title: `${theme.label} - ${title}`,
        description: frontmatter.description || '',
        header: pageHeader,
        stickyBar: pageSubbar,
        content: htmlContent,
        toc: tableOfContents,
        pageNav: '{{PAGE_NAV}}',
        access: deriveDataAccess(frontmatter),
        scripts: buildPageScripts(frontmatter.section || '', frontmatter, navBase),
        sectionSlug: `${brandKey}-${slugifySection(frontmatter.section)}`,
        pageSection: `${brandKey}-${slugifySection(frontmatter.section)}`,
        order: parseInt(frontmatter.order, 10) || 999,
        level: 2,
      });

      // Derive output path
      const dir = sectionSlug
        ? path.join(OUTPUT_DIR, brandKey, sectionSlug)
        : path.join(OUTPUT_DIR, brandKey);
      const outputRelPath = sectionSlug ? `${brandKey}/${sectionSlug}/${htmlName}` : `${brandKey}/${htmlName}`;
      const htmlFolder = sectionSlug ? `${brandKey}/${sectionSlug}` : brandKey;

      // Collect for two-pass rendering (nav needs full page order)
      brandFiles.push({
        filename,
        title,
        section: frontmatter.section || '',
        htmlFolder,
        htmlName,
        htmlPath: outputRelPath,
        subtitle: frontmatter.subtitle || '',
        author: frontmatter.author || '',
        order,
        html,
        dir
      });
    }

    // Sort by order for prev/next navigation
    brandFiles.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title);
    });

    // Pass 2: Inject prev/next nav and write files
    for (const file of brandFiles) {
      const pageNav = generatePageNav(file, brandFiles);
      // Function replacer, like every substitution in renderPage: a plain
      // string replacement treats `$&`, `` $` ``, `$'` and `$$` in the
      // *replacement* as patterns, and this one carries neighbouring page
      // titles straight from brand frontmatter.
      const finalHtml = file.html.replace('{{PAGE_NAV}}', () => pageNav);

      fs.mkdirSync(file.dir, { recursive: true });
      fs.writeFileSync(path.join(file.dir, file.htmlName), finalHtml);
      console.log(`📄 Generated: ${file.htmlPath}`);

      pages.push({
        title: file.title,
        subtitle: file.subtitle,
        author: file.author,
        // Absolute href so theme-loader.js can use the value directly without
        // a per-page basePath prefix (which would go stale across Barba transitions).
        href: '/' + file.htmlPath,
        section: file.section || null,
        order: file.order
      });
    }

    // Sort pages and append to the in-memory registry for the theme-config emit
    pages.sort((a, b) => a.order - b.order);
    for (const { title, subtitle, author, href, section } of pages) {
      const entry = { title, href };
      if (subtitle) entry.subtitle = subtitle;
      if (author) entry.author = author;
      if (section) entry.section = section;
      theme.pages.push(entry);
    }
  }
}

/**
 * Generate the tool app pages from cms/apps/.
 *
 * Each tool is a pair: `<slug>.md` carrying only frontmatter, and `<slug>.html`
 * carrying the body that goes between <main> and </main>. Two files rather than
 * one because the body cannot go through markdownToHtml — its post-passes
 * rewrite <table> into .table-scroll > table.table, inject copy buttons into
 * <pre><code> and chipify inline <code>, all of which are right for prose and
 * wrong for an application's markup. cpm-calculator has a <table> that would be
 * silently rewritten.
 *
 * These pages deliberately do NOT join filesBySection. The sidebar and the
 * Tools index already link to them through their doc page's `actionUrl`; adding
 * them again would list every tool twice.
 *
 * Output paths are unchanged from when these were hand-written (tools/<slug>.html)
 * because those URLs are public and the doc pages point at them.
 */
/**
 * Fill in the destination for a close link that does not name one.
 *
 * `<a data-page-close>` with no href gets the section index — the same place a
 * doc page's close goes, so the default is "up one level" without every tool
 * having to repeat the path. An author-supplied href is left alone, which is
 * how a tool that should close somewhere else says so.
 */
function fillPageClose(body, sectionHref) {
  return body.replace(/<a\s([^>]*\bdata-page-close(?![-\w])[^>]*)>/g, (match, attrs) => {
    // `(?![-\w])` so data-page-close-target and friends are not mistaken for
    // the attribute itself — \b alone treats the hyphen as a boundary and
    // would silently rewrite an unrelated anchor's href.
    //
    // `\bhref` alone also matches data-href and xlink:href, which would read
    // as author-supplied and leave the link inert. Require a real href.
    if (/(^|\s)href\s*=/.test(attrs)) return match;
    return `<a href="${sectionHref}" ${attrs}>`;
  });
}

/**
 * Strip HTML comments before scanning a body for the close.
 *
 * Without this a commented-out close satisfies the gate, and fillPageClose
 * cheerfully injects an href inside the comment — the page ships with no way
 * out, which is the one thing the gate exists to prevent.
 */
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Generate pages from a standalone source directory under cms/.
 *
 * Two directories use this: `cms/apps/` (the tools) and `cms/examples/` (one
 * live specimen per page type). Both hold pages that join no section — the
 * sidebar and the section indexes never list them, because both are reached
 * from somewhere specific: a tool from its doc page's action button, an
 * example from the page-layouts reference.
 *
 * A page is a `<slug>.md` carrying frontmatter. Types whose body is HTML
 * (`tool`, `page`) take theirs from a sibling `<slug>.html`, verbatim; types
 * whose body is markdown take it from the .md itself. That split is what stops
 * an application's markup going through markdownToHtml, whose post-passes
 * rewrite tables, code blocks and inline code.
 *
 * @param {object}  opts.dirName       directory under cms/
 * @param {string}  opts.outputFolder  fixed output folder, or null to derive
 *                                     it from the page's section
 * @param {string}  opts.defaultSection section when frontmatter omits one
 * @param {boolean} opts.toolHook      emit data-tool="<slug>" on the container
 * @param {string}  opts.closeHref     where a close goes, and the breadcrumb's
 *                                     first crumb. Defaults to the output
 *                                     folder's index, which is right for a tool
 *                                     but wrong for a directory that has none
 * @param {string}  opts.closeLabel    the crumb's text
 */
function generateSourceDirPages(template, {
  dirName,
  outputFolder = null,
  defaultSection = 'Tools',
  toolHook = false,
  closeHref = null,
  closeLabel = null,
}) {
  const srcDir = path.join(DOCS_DIR, dirName);
  if (!fs.existsSync(srcDir)) return [];

  const mdFiles = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('README') && !f.startsWith('_'))
    .sort();

  const closeErrors = [];
  const generated = [];

  for (const filename of mdFiles) {
    const slug = filename.replace(/\.md$/, '');
    const bodyPath = path.join(srcDir, `${slug}.html`);

    const parsed = parseFrontmatter(fs.readFileSync(path.join(srcDir, filename), 'utf8'));
    const frontmatter = parsed.frontmatter;

    if (frontmatter.status === 'draft') {
      console.log(`⏭️  Skipped (draft): ${dirName}/${filename}`);
      continue;
    }

    const type = resolvePageType(frontmatter);
    if (!type) {
      closeErrors.push(`  ${dirName}/${slug}.md — invalid type "${frontmatter.type}" (valid: ${Object.keys(PAGE_TYPES).join(', ')})`);
      continue;
    }

    // An HTML-bodied type needs its sibling; a markdown-bodied one must not
    // have one, or the .md's own content would be silently ignored.
    let body;
    if (type.body === 'html') {
      if (!fs.existsSync(bodyPath)) {
        throw new Error(`cms/${dirName}/${filename} declares type "${type.name}", which needs a ${slug}.html body`);
      }
      body = fs.readFileSync(bodyPath, 'utf8').trimEnd();
    } else {
      if (fs.existsSync(bodyPath)) {
        throw new Error(`cms/${dirName}/${slug}.html is ignored — type "${type.name}" takes its body from the markdown`);
      }
      body = markdownToHtml(parsed.content);
    }

    const section = frontmatter.section || defaultSection;
    const folder = outputFolder || SECTION_FOLDERS[section] || section.toLowerCase();
    const navBase = '../';
    const upHref = siteHref(closeHref || `/${folder}/index.html`);
    const upLabel = closeLabel || section;

    // The close contract, enforced only where the type makes it: a `tool` owns
    // its whole layout, so the generator cannot place a close for it — but it
    // can refuse to ship one the reader cannot leave.
    //
    // Scanned with comments stripped: a commented-out close would otherwise
    // satisfy the gate and ship a page with no way out.
    const needsClose = type.name === 'tool' && !type.stickyBar;
    if (needsClose) {
      const scannable = stripHtmlComments(body);
      if ((scannable.match(/\sdata-page-close(?![-\w])/g) || []).length === 0) {
        closeErrors.push(`  ${dirName}/${slug}.html — no element carries data-page-close`);
        continue;
      }
    }

    // {{icon:name}} works in an HTML body the same way it works in markdown.
    // That body skips markdownToHtml, which is where the expansion normally
    // happens, so it is done here — otherwise every tool would have to paste
    // raw SVG, which is how these files accumulated it in the first place.
    let content = fillPageClose(body, upHref);
    if (type.body === 'html') {
      content = content.replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name));
      // {{icon-manifest}} resolves only in an HTML body like this one; in
      // markdown it warns instead (markdownToHtml). Line-anchored like
      // {{icon-registry}}, so an inline mention survives as text, and not
      // global: one page holds one manifest, and a second copy would
      // duplicate its id.
      content = content.replace(/^[^\S\n]*\{\{icon-manifest\}\}[^\S\n]*$/m, renderIconManifest);
    }

    // Assert the close came out navigable. The check above proves the attribute
    // is there; this proves fillPageClose actually resolved it. Nothing in the
    // JS reads data-page-close — it is a build-time marker, not a behaviour —
    // so the close has to be a real <a> with a real href. A <button> carrying
    // the attribute is inert, and would otherwise pass a gate whose whole job
    // is to prevent exactly that.
    if (needsClose) {
      const resolved = (stripHtmlComments(content).match(/<a\s[^>]*\bdata-page-close(?![-\w])[^>]*>/g) || [])
        .filter(tag => /(^|\s)href\s*=\s*["'][^"']+["']/.test(tag)).length;
      if (resolved === 0) {
        closeErrors.push(`  ${dirName}/${slug}.html — data-page-close is not on a link with a destination (an <a>; a <button> does nothing)`);
        continue;
      }
    }

    const html = renderPage(template, {
      space: ROOT_SPACE,
      navBase,
      title: frontmatter.title || slug,
      description: frontmatter.description || '',
      header: type.header
        ? buildPageHeaderHtml({ title: frontmatter.title, subtitle: frontmatter.subtitle })
        : '',
      content,
      toc: type.toc ? generateTableOfContents(content) : '',
      frame: type.frame,
      stickyBar: type.stickyBar
        ? buildBar({
            sectionHref: upHref,
            sectionLabel: upLabel,
            title: frontmatter.title || slug,
            // A framed tool's bar lines up with the tool column; a full-bleed
            // one (bar-width: "full") spans, matching the canvas below it.
            width: frontmatter['bar-width'] === 'full' ? null : 'tool',
          })
        : '',
      access: deriveDataAccess(frontmatter),
      sectionSlug: slug,
      pageSection: slugifySection(section),
      order: parseInt(frontmatter.order, 10) || 999,
      level: type.level,
      chrome: type.chrome,
      sidebar: frontmatter.sidebar || null,
      // A stable root hook for the tool's own module, named after the page.
      // email-signature.js already scopes every one of its queries to
      // [data-tool="email-signature"] and returns early without it, so the
      // tool goes silently dead if this is missing.
      containerExtra: toolHook ? ` data-tool="${escapeAttr(slug)}"` : '',
    });

    const dir = path.join(OUTPUT_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.html`), html);
    console.log(`📄 Generated: ${folder}/${slug}.html`);
    generated.push(`${folder}/${slug}.html`);
  }

  if (closeErrors.length > 0) {
    console.error(`\n❌ cms/${dirName} — a \`tool\` page must give the reader a way out:`);
    console.error(closeErrors.join('\n'));
    console.error('\nPut data-page-close on an <a> anywhere the layout suits — the');
    console.error('bar\'s trailing cluster, a corner of the canvas. Leave the href');
    console.error('off and the section index is filled in. It must be a link, not a');
    console.error('button: nothing reads the attribute at runtime. See cms/page-types.md.\n');
    process.exit(1);
  }

  return generated;
}

/**
 * Build tool registry from markdown frontmatter (single source of truth).
 * Returns an object keyed by tool slug with { title, subtitle, toolAccess, actionUrl }.
 */
function buildToolRegistryFromFrontmatter() {
  const toolFiles = fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('README'));
  const tools = {};
  for (const filename of toolFiles) {
    const raw = fs.readFileSync(path.join(DOCS_DIR, filename), 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    const toolActionUrl = frontmatter.actionUrl || frontmatter.toolUrl;
    if (frontmatter.section === 'Tools' && toolActionUrl) {
      // Derive tool slug from actionUrl (e.g. "./cpm-calculator.html" → "cpm-calculator")
      const slug = path.basename(toolActionUrl, '.html');
      tools[slug] = {
        title: frontmatter.title || slug,
        subtitle: frontmatter.subtitle || '',
        author: frontmatter.author || '',
        toolAccess: frontmatter.actionAccess || frontmatter.toolAccess || 'brand',
        actionUrl: toolActionUrl
      };
    }
  }
  return tools;
}

/**
 * Check if a brand has access to a tool based on its toolAccess frontmatter value.
 */
function brandHasToolAccess(toolAccess, brandKey) {
  if (!toolAccess) return false;
  // "public" or "brand" (any brand) → grant
  if (toolAccess === 'public' || toolAccess === 'brand') return true;
  // "team" or "admin" → brands don't get access
  if (toolAccess === 'team' || toolAccess === 'admin') return false;
  // "brand:acme,acme" → check if brandKey is in the list
  if (toolAccess.startsWith('brand:')) {
    const allowed = toolAccess.substring('brand:'.length).split(',').map(s => s.trim());
    return allowed.includes(brandKey);
  }
  return false;
}

/**
 * Generate section overview pages for each brand (docs-overview, tools-overview).
 * Also appends the overview/tool entries to themes[brandKey].pages in memory.
 */
function generateBrandSectionOverviews(template, themes) {
  const toolRegistry = buildToolRegistryFromFrontmatter();

  for (const [brandKey, theme] of Object.entries(themes)) {
    const brandLabel = theme.label || brandKey;
    const space = brandSpace(brandKey, theme);
    const navBase = '../';

    const dir = path.join(OUTPUT_DIR, brandKey);
    fs.mkdirSync(dir, { recursive: true });

    // Helper to build a brand overview page
    function buildOverviewPage(title, cardsHtml, overrideNavBase) {
      const base = overrideNavBase || navBase;
      // Per-brand section order — used by the level-based directional
      // transitions for L1 → L1 sibling navigation within a brand space.
      // Docs comes first, then Tools, matching their order in the brand
      // sidebar. New brand sections would extend this map.
      const brandSectionOrder = { 'Docs': 0, 'Tools': 1, 'Brand Book': 2 };
      const overviewOrder = brandSectionOrder[title] !== undefined ? brandSectionOrder[title] : 999;
      return renderPage(template, {
        space,
        navBase: base,
        // Overviews in a section subfolder sit one level below the brand root
        brandRelBase: base === '../../' ? '../' : '',
        title: `${brandLabel} - ${title}`,
        description: `${title} overview for ${brandLabel}.`,
        header: buildPageHeaderHtml({ title }),
        content: cardsHtml,
        access: deriveDataAccess(loadDefaults(space.defaultsDir())),
        sectionSlug: `${brandKey}-${slugifySection(title)}-overview`,
        pageSection: `${brandKey}-${slugifySection(title)}`,
        order: overviewOrder,
        level: 1,
      });
    }

    // Docs overview — the section's contents list.
    //
    // book-contents, not book-shelf: the book metaphor puts covers on the shelf
    // (L0) and a contents list inside a book (L1), and the root section indexes
    // have always followed it. The brand spaces used covers at both levels, so
    // a brand instance taught a different structure from the site it lives in.
    const docsPages = (theme.pages || []).filter(p => p.section === 'Docs' && p.title !== 'Overview');
    if (docsPages.length > 0) {
      let cards = '<div class="docs-section"><div class="book-contents">';
      for (const page of docsPages) {
        // page.href is already absolute (`/<brand>/docs/<file>.html`).
        cards += renderBookContentsItem({
          headingLevel: 2,
          href: page.href,
          title: page.title,
          subtitle: page.subtitle,
        });
      }
      cards += '</div></div>';
      const docsDir = path.join(dir, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'index.html'), buildOverviewPage('Docs', cards, '../../'));
      console.log(`📄 Generated: ${brandKey}/docs/index.html`);
    }

    // Tools overview — cards for tools this brand has access to (from frontmatter)
    const brandToolKeys = Object.keys(toolRegistry).filter(slug => brandHasToolAccess(toolRegistry[slug].toolAccess, brandKey));
    if (brandToolKeys.length > 0) {
      let cards = '<div class="docs-section"><div class="book-contents">';
      for (const toolKey of brandToolKeys) {
        const tool = toolRegistry[toolKey];
        cards += renderBookContentsItem({
          headingLevel: 2,
          href: `/tools/${toolKey}.html`,
          title: tool.title,
          subtitle: tool.subtitle,
        });
      }
      cards += '</div></div>';
      const toolsDir = path.join(dir, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      fs.writeFileSync(path.join(toolsDir, 'index.html'), buildOverviewPage('Tools', cards, '../../'));
      console.log(`📄 Generated: ${brandKey}/tools/index.html`);
    }
  }

  // Append overview + tool entries to the in-memory registry (emitted later)
  for (const [brandKey, theme] of Object.entries(themes)) {
    const hasDocsOverview = theme.pages.some(p => p.section === 'Docs');
    const brandToolKeys = Object.keys(toolRegistry).filter(slug => brandHasToolAccess(toolRegistry[slug].toolAccess, brandKey));

    if (hasDocsOverview && !theme.pages.some(p => p.href === `/${brandKey}/docs/index.html`)) {
      theme.pages.push({ title: 'Overview', href: `/${brandKey}/docs/index.html`, section: 'Docs' });
    }
    if (brandToolKeys.length > 0 && !theme.pages.some(p => p.href === `/${brandKey}/tools/index.html`)) {
      theme.pages.push({ title: 'Overview', href: `/${brandKey}/tools/index.html`, section: 'Tools' });
    }
    for (const slug of brandToolKeys) {
      if (!theme.pages.some(p => p.href === `/tools/${slug}.html`)) {
        theme.pages.push({ title: toolRegistry[slug].title, href: `/tools/${slug}.html`, section: 'Tools' });
      }
    }
  }
}

/**
 * Generate brand-book.html for each brand.
 *
 * Scans cms/brands/{brandKey}/assets/logos/ for .svg files and builds a
 * logo gallery page with light + dark previews, copy-SVG and download buttons.
 * An optional cms/brands/{brandKey}/brand-book.md provides custom intro
 * content and frontmatter overrides (title, subtitle, description, access).
 */
function generateBrandBook(template, themes) {
  const brandsDir = BRANDS_DIR;
  if (!brandsDir || !fs.existsSync(brandsDir)) return;

  const brandDirs = fs.readdirSync(brandsDir).filter(dir => {
    return fs.statSync(path.join(brandsDir, dir)).isDirectory() && themes[dir];
  });

  for (const brandKey of brandDirs) {
    const theme = themes[brandKey];
    const brandLabel = theme.label || brandKey;

    // Scan for logo SVG files
    const logosDir = path.join(brandsDir, brandKey, 'assets', 'logos');
    if (!fs.existsSync(logosDir)) {
      console.log(`⚠️  No logos/ folder for brand '${brandKey}', skipping brand book`);
      continue;
    }

    const svgFiles = fs.readdirSync(logosDir).filter(f => f.endsWith('.svg'));
    if (svgFiles.length === 0) {
      console.log(`⚠️  No SVG files in logos/ for brand '${brandKey}', skipping brand book`);
      continue;
    }

    // Load optional brand-book.md for intro content and frontmatter
    const brandBookMdPath = path.join(brandsDir, brandKey, 'brand-book.md');
    let frontmatter = {};
    let introHtml = '';

    if (fs.existsSync(brandBookMdPath)) {
      const raw = fs.readFileSync(brandBookMdPath, 'utf8');
      const parsed = parseFrontmatter(raw);
      // Merge folder defaults — brand-book frontmatter wins
      const brandDefaults = loadDefaults(path.join(brandsDir, brandKey));
      frontmatter = { ...brandDefaults, ...parsed.frontmatter };
      if (parsed.content) {
        introHtml = markdownToHtml(parsed.content);
      }
    } else {
      // Fall back to folder defaults only
      frontmatter = loadDefaults(path.join(brandsDir, brandKey));
    }

    const pageTitle = frontmatter.title || 'Brand Book';
    const pageSubtitle = frontmatter.subtitle || 'Logo, colour, typography, and interface elements styled with your brand tokens';
    const pageDescription = frontmatter.description || `${brandLabel} brand book.`;

    // Build the full-width page header (slots into PAGE_HEADER, outside the content grid)
    const brandBookPageHeader = buildPageHeaderHtml({
      title: pageTitle,
      subtitle: pageSubtitle,
      eyebrow: brandLabel,
      flipId: 'brand-book',
    });

    // Build page content
    let contentHtml = '';

    // Custom intro from brand-book.md
    if (introHtml) {
      contentHtml += `<div class="block gap-l">${introHtml}</div>`;
    }

    // ─────────────────────────────────────────────────────────
    // PART 1 — PRIMITIVES
    // The raw building blocks: logos, colours, fonts.
    // Compact, scannable, copy-friendly. No editorial content.
    // ─────────────────────────────────────────────────────────

    // ─── LOGOS ───────────────────────────────────────────────
    // Logos follow the convention: logo_brand-{type}-{light|dark}.svg
    // Group by type, sort by canonical order, render light + dark side by side.
    const logoTypeOrder = ['primary', 'wordmark', 'avatar', 'horizontal'];
    const logoTypeTitles = {
      'primary': 'Primary Logo',
      'wordmark': 'Wordmark',
      'avatar': 'Avatar Logo',
      'horizontal': 'Horizontal Logo',
    };

    // Parse files: extract base type + variant
    // e.g. "logo_brand-wordmark-light.svg" → { type: 'wordmark', variant: 'light', file: '...' }
    const logoEntries = svgFiles
      .map(f => {
        const m = f.match(/^logo_brand-(.+?)-(light|dark)\.svg$/i);
        if (!m) return null;
        return { type: m[1], variant: m[2], file: f };
      })
      .filter(Boolean);

    // Group by type
    const logoGroups = {};
    for (const entry of logoEntries) {
      if (!logoGroups[entry.type]) logoGroups[entry.type] = {};
      logoGroups[entry.type][entry.variant] = entry.file;
    }

    // Sort group keys by canonical order
    const sortedGroupKeys = Object.keys(logoGroups).sort((a, b) => {
      const aIdx = logoTypeOrder.indexOf(a);
      const bIdx = logoTypeOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    // Render the logos section only if we have at least one matching file
    if (sortedGroupKeys.length > 0) {
      contentHtml += `<section class="brand-book-section block gap-2xl">
        <h2>Logos</h2>`;

      for (const typeKey of sortedGroupKeys) {
        const group = logoGroups[typeKey];
        const title = logoTypeTitles[typeKey] || (typeKey.charAt(0).toUpperCase() + typeKey.slice(1) + ' Logo');

        contentHtml += `<div class="block gap-m">
          <h3>${title}</h3>
          <div class="grid cols-2 gap-l">`;

        // Render light then dark variants if they exist
        for (const variant of ['light', 'dark']) {
          const file = group[variant];
          if (!file) continue;

          let svgContent = fs.readFileSync(path.join(logosDir, file), 'utf8')
            .replace(/\n\s*/g, '')
            .trim();

          // Add data-logo attribute to the <svg> element
          svgContent = svgContent.replace(/<svg([^>]*)>/, `<svg data-logo="${typeKey}-${variant}"$1>`);

          // Escape for data-copy attribute
          const svgEscapedAttr = svgContent
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

          const previewClass = variant === 'dark' ? 'asset-card-preview--dark' : 'asset-card-preview--light';
          const downloadHref = `assets/logos/${file}`;
          const variantLabel = variant.charAt(0).toUpperCase() + variant.slice(1);

          contentHtml += `<div class="asset-card">
            <div class="asset-card-preview ${previewClass}">
              <div class="svg-logo" style="max-width: 240px; max-height: 120px;">${svgContent}</div>
            </div>
            <div class="asset-card-footer">
              <p class="asset-card-title">${variantLabel}</p>
              <div class="asset-card-actions">
                <button class="button copy-btn is-icon-only" data-size="small" type="button" data-copy="${svgEscapedAttr}" data-tooltip="Copy SVG" aria-label="Copy SVG">
                  <span class="copy-btn-default">${getIcon('copy')}</span>
                  <span class="copy-btn-copied">${getIcon('check')}</span>
                </button>
                <a class="button" data-size="small" href="${downloadHref}" download="${file}" data-tooltip="Download" aria-label="Download SVG">
                  ${getIcon('download')}
                </a>
              </div>
            </div>
          </div>`;
        }

        contentHtml += `</div>
        </div>`;
      }

      contentHtml += `</section>`;
    }

    // ─── COLOURS ─────────────────────────────────────────────
    // Read brand primitives from this brand's theme.css.
    // If none defined, fall back to the project semantic palette tokens.
    const themeCssPath = path.join(brandsDir, brandKey, 'assets', 'theme.css');
    let brandColorTokens = [];
    if (fs.existsSync(themeCssPath)) {
      const themeCssRaw = fs.readFileSync(themeCssPath, 'utf8');
      const brandTokenRegex = /^\s*(--brand-[a-z0-9-]+)\s*:\s*([^;]+);/gm;
      let m;
      while ((m = brandTokenRegex.exec(themeCssRaw)) !== null) {
        brandColorTokens.push({ token: m[1] });
      }
    }

    // Fallback: use semantic tokens if no brand primitives are defined
    if (brandColorTokens.length === 0) {
      brandColorTokens = [
        { token: '--background-primary' },
        { token: '--background-secondary' },
        { token: '--text-primary' },
        { token: '--text-secondary' },
        { token: '--button-primary' },
        { token: '--button-secondary' },
        { token: '--text-accent' },
        { token: '--border-secondary' },
      ];
    }

    // Split into two columns
    const half = Math.ceil(brandColorTokens.length / 2);
    const colorColLeft = brandColorTokens.slice(0, half);
    const colorColRight = brandColorTokens.slice(half);

    // Click the row → copies the var(--token) reference. Hover reveals the
    // ::after copy icon defined in docs-site.css. Check icon swap on .is-copied.
    const renderColorRow = (c) => `<button class="color-row copy-btn" type="button" style="background-color: var(${c.token});" data-copy="var(${c.token})" aria-label="Copy var(${c.token})">
      <span class="color-row-name">var(${c.token})</span>
    </button>`;

    contentHtml += `<section class="brand-book-section block gap-l">
      <h2>Colours</h2>
      <div class="grid cols-2 gap-l">
        <div class="color-list border border-faded">${colorColLeft.map(renderColorRow).join('')}</div>
        <div class="color-list border border-faded">${colorColRight.map(renderColorRow).join('')}</div>
      </div>
    </section>`;

    // ─── BACKGROUNDS ─────────────────────────────────────────
    // Solid colour background tokens — useful for hero blocks, callouts,
    // ad units, marketing surfaces. Each maps to a brand primitive (or
    // falls back to the design system default).
    const backgroundTokens = [
      { token: '--background-accent' },
      { token: '--background-black'  },
      { token: '--background-white'  },
      { token: '--background-blue'   },
      { token: '--background-red'    },
      { token: '--background-green'  },
    ];

    const bgHalf = Math.ceil(backgroundTokens.length / 2);
    const bgColLeft = backgroundTokens.slice(0, bgHalf);
    const bgColRight = backgroundTokens.slice(bgHalf);

    contentHtml += `<section class="brand-book-section block gap-l">
      <h2>Backgrounds</h2>
      <div class="grid cols-2 gap-l">
        <div class="color-list border border-faded">${bgColLeft.map(renderColorRow).join('')}</div>
        <div class="color-list border border-faded">${bgColRight.map(renderColorRow).join('')}</div>
      </div>
    </section>`;

    // ─── FONTS ───────────────────────────────────────────────
    // Show every distinct brand font as a specimen card.
    // Dedupe by family value — if --font-primary and --font-secondary share the
    // same value, only one card is rendered.
    const fontTokenSpecs = [
      { token: '--font-primary',    fallback: 'Primary' },
      { token: '--font-secondary',  fallback: 'Secondary' },
      { token: '--font-tertiary',   fallback: 'Tertiary' },
      { token: '--font-quaternary', fallback: 'Quaternary' },
    ];

    let fontTokens = [];
    if (fs.existsSync(themeCssPath)) {
      const themeCssRaw = fs.readFileSync(themeCssPath, 'utf8');
      // Build a map of token → first family name from theme.css
      const themeFontMap = {};
      const fontTokenRegex = /^\s*(--font-(?:primary|secondary|tertiary|quaternary))\s*:\s*([^;]+);/gm;
      let m;
      while ((m = fontTokenRegex.exec(themeCssRaw)) !== null) {
        if (themeFontMap[m[1]]) continue; // first definition wins
        themeFontMap[m[1]] = m[2].split(',')[0].trim().replace(/^["']|["']$/g, '');
      }

      // Walk in canonical order, dedupe by family value
      const seenFamilies = new Set();
      for (const spec of fontTokenSpecs) {
        const family = themeFontMap[spec.token];
        if (!family || seenFamilies.has(family)) continue;
        seenFamilies.add(family);
        fontTokens.push({ token: spec.token, family });
      }
    }
    if (fontTokens.length === 0) {
      fontTokens = [
        { token: '--font-primary',    family: 'Primary' },
        { token: '--font-secondary',  family: 'Secondary' },
        { token: '--font-tertiary',   family: 'Tertiary' },
        { token: '--font-quaternary', family: 'Quaternary' },
      ];
    }

    contentHtml += `<section class="brand-book-section block gap-l">
      <h2>Fonts</h2>
      <div class="grid cols-${Math.min(fontTokens.length, 3)} gap-l">`;
    for (const f of fontTokens) {
      contentHtml += `<div class="asset-card">
        <div class="asset-card-preview asset-card-preview--light" style="text-align: center;">
          <div style="font-family: var(${f.token});">
            <p style="font-size: var(--font-9xl); margin: 0; line-height: 1;">Aa</p>
            <p style="font-size: var(--font-s); margin: var(--space-l) 0 0; line-height: 1.5;">ABCDEFGHIJKLM<br>abcdefghijklm<br>0123456789</p>
          </div>
        </div>
        <div class="asset-card-footer">
          <p class="asset-card-title">${f.family}</p>
        </div>
      </div>`;
    }
    contentHtml += `</div>
    </section>`;

    // ─────────────────────────────────────────────────────────
    // PART 2 — IN USE
    // The brand applied across real scenarios — an article, a callout,
    // a card grid, and a contact form. Each scenario stitches multiple
    // elements together so the brand can be seen in context.
    // ─────────────────────────────────────────────────────────

    // ─── SCENARIO 1: Article ─────────────────────────────────
    // Demonstrates: H1, H2, H3, eyebrow, lead paragraph, body, inline styling,
    // internal + external links, unordered + ordered lists, blockquote, small print.
    // Sits on the page, not in a bordered box.
    // Header is a block composition (gap-driven); the article itself is NOT a
    // block — prose flows on element margins, matching how markdown-generated
    // pages render, so the specimen stays representative.
    contentHtml += `<section class="brand-book-section block gap-l">
      <header class="block gap-m">
        <p class="eyebrow">Field notes</p>
        <h1>Your Primary Headline, Big, Bold, and Unmissable</h1>
        <p class="text-size-xlarge">This lead paragraph demonstrates how introductory body text will look across your layout, used to set the tone for the body that follows and draw the reader in.</p>
      </header>
      <article>
        <p>This paragraph demonstrates how body text will look across your layout. <strong>Bold text</strong> adds emphasis, while <em>italics</em> offer a subtle highlight. You can also use <s>strikethrough</s> to show edits, or <code>inline code</code> for technical terms. For further information, check out <a href="#">this internal link</a>, or visit our <a href="https://example.com" target="_blank" rel="noopener noreferrer">external site</a>.</p>

        <h2>Type with Purpose, Design with Intent</h2>

        <p>This extended paragraph serves to demonstrate how substantial blocks of body text will behave across your layout, giving you a realistic sense of how readers will experience longer-form content. <strong>Strategic use of bold text</strong> helps break up visual monotony, while <em>italicised phrases introduce subtle emphasis</em>. As you work through multiple lines, you'll notice how spacing, line height, and text density all contribute to overall readability.</p>

        <h3>What good typography does</h3>

        <ul>
          <li>Establishes a clear visual hierarchy</li>
          <li>Improves readability over long passages</li>
          <li>Carries the brand voice consistently
            <ul>
              <li>Across digital and print</li>
              <li>Across light and dark surfaces</li>
            </ul>
          </li>
          <li>Communicates without shouting</li>
        </ul>

        <h3>How we use it</h3>

        <ol>
          <li>Discovery and brief</li>
          <li>Strategy and positioning</li>
          <li>Design and prototyping
            <ol>
              <li>Visual exploration</li>
              <li>Refinement</li>
            </ol>
          </li>
          <li>Build and handover</li>
        </ol>

        <blockquote><p>Words matter, but how those words are presented matters just as much. Typography transforms content from mundane to magical, from ordinary to extraordinary.</p></blockquote>

        <p class="text-size-small">Terms and conditions apply. Prices are subject to change without notice. See site for complete details.</p>
      </article>
    </section>`;

    // ─── SCENARIO 2: Card grid ───────────────────────────────
    // Demonstrates: book-cover, card-title, card-description, grid layout.
    contentHtml += `<section class="brand-book-section block gap-l">
      <h2>Three things worth your time</h2>
      <div class="book-shelf" data-cols="3">
        ${renderBookCover({ href: '#', title: 'Catchy article title example', subtitle: 'A short preview of the article content, crafted to grab attention and spark curiosity. Just enough to tempt the reader to click.' })}
        ${renderBookCover({ href: '#', title: 'Bold title for a blog post', subtitle: 'A few compelling lines that hint at the story within. Use this space to draw the reader in with tone, intrigue, or a bold statement.' })}
        ${renderBookCover({ href: '#', title: 'Short and scroll-stopping', subtitle: 'Bold insights, fresh thinking, and a reason to scroll. This placeholder shows how a post excerpt will look in your feed layout.' })}
      </div>
    </section>`;

    // ─── SCENARIO 3: Contact form ────────────────────────────
    // One of each form element: text input, textarea, radio, toggle, button.
    contentHtml += `<section class="brand-book-section block gap-l">
      <h2>Get in touch</h2>
      <div class="block gap-l">
        <div class="block gap-xs">
          <label for="bb-name"><strong>Name</strong></label>
          <input type="text" id="bb-name" placeholder="Your name">
        </div>
        <div class="block gap-xs">
          <label for="bb-message"><strong>Message</strong></label>
          <textarea id="bb-message" rows="4" placeholder="Tell us a little about your project..."></textarea>
        </div>
        <div class="form-check">
          <input type="radio" id="bb-radio" name="bb-radio" checked>
          <label for="bb-radio">Subscribe me to updates</label>
        </div>
        <div class="form-toggle">
          <input type="checkbox" id="bb-toggle" checked>
          <label for="bb-toggle">Email notifications</label>
        </div>
        <div class="button-group">
          <button class="button" type="button">Send message</button>
        </div>
      </div>
    </section>`;

    // Build page from template (same pattern as generateBrandIndexPages)
    const navBase = '../';

    // Brand book uses the standard .copy-btn pattern (handled by copy-button.js)
    // and native <a download> for downloads — no inline script needed.

    const html = renderPage(template, {
      space: brandSpace(brandKey, theme),
      navBase,
      brandRelBase: '',
      title: `${brandLabel} - ${pageTitle}`,
      description: pageDescription,
      header: brandBookPageHeader,
      content: contentHtml,
      access: deriveDataAccess(frontmatter),
      sectionSlug: `${brandKey}-brand-book`,
      pageSection: `${brandKey}-brand-book`,
      // Brand book is at order 2 in the per-brand section ordering
      // (Docs=0, Tools=1, Brand Book=2) — see buildOverviewPage above.
      order: 2,
      level: 1,
    });

    // Write to brand folder
    const dir = path.join(OUTPUT_DIR, brandKey);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'brand-book.html'), html);
    console.log(`📄 Generated: ${brandKey}/brand-book.html`);
  }
}

function generateBrandIndexPages(template, themes) {
  const toolRegistry = buildToolRegistryFromFrontmatter();

  for (const [brandKey, theme] of Object.entries(themes)) {
    let contentHtml = '';

    // Both feed the page header, which is emitted into {{PAGE_HEADER}} below.
    const brandLabel = theme.label || brandKey;
    const brandDesc = theme.description || `Brand guidelines and tools for ${brandLabel}.`;

    // Brand pages grouped by section (exclude index.html and Tools pages — tools handled separately)
    const brandPages = (theme.pages || []).filter(p => !p.href.endsWith('/index.html') && p.section !== 'Tools');
    const sectionGroups = {};
    const sectionOrder = [];
    for (const page of brandPages) {
      const section = page.section || brandLabel;
      if (!sectionGroups[section]) {
        sectionGroups[section] = [];
        sectionOrder.push(section);
      }
      sectionGroups[section].push(page);
    }

    for (const section of sectionOrder) {
      // Sort so Overview is always first
      sectionGroups[section].sort((a, b) => {
        if (a.title === 'Overview') return -1;
        if (b.title === 'Overview') return 1;
        return 0;
      });

      contentHtml += `<div class="docs-section">
      <h2 class="book-shelf-title">${section}</h2>
      <div class="book-shelf">`;
      for (const page of sectionGroups[section]) {
        // page.href is absolute (`/<brand>/<section>/<file>.html`) — use as-is.
        contentHtml += renderBookCover({
          href: page.href,
          title: page.title,
          subtitle: page.subtitle,
          author: page.author,
        });
      }
      contentHtml += `</div></div>`;
    }

    // Tools section — derived from frontmatter toolAccess
    const brandToolKeys = Object.keys(toolRegistry).filter(slug => brandHasToolAccess(toolRegistry[slug].toolAccess, brandKey));
    if (brandToolKeys.length > 0) {
      contentHtml += `<div class="docs-section">
      <h2 class="book-shelf-title">Tools</h2>
      <div class="book-shelf">`;
      // Tools overview card first
      const toolsOverviewPage = (theme.pages || []).find(p => p.section === 'Tools' && p.title === 'Overview');
      if (toolsOverviewPage) {
        contentHtml += renderBookCover({
          href: toolsOverviewPage.href,
          title: 'Overview',
          subtitle: 'All available tools and utilities',
        });
      }
      for (const toolKey of brandToolKeys) {
        const tool = toolRegistry[toolKey];
        contentHtml += renderBookCover({
          href: `/tools/${toolKey}.html`,
          title: tool.title,
          subtitle: tool.subtitle,
          author: tool.author,
        });
      }
      contentHtml += `</div></div>`;
    }

    // Build page from template
    const navBase = '../';
    const html = renderPage(template, {
      space: brandSpace(brandKey, theme),
      navBase,
      brandRelBase: '',
      title: `${brandLabel} - Brand Guidelines`,
      description: brandDesc,
      header: buildPageHeaderHtml({ title: brandLabel, subtitle: brandDesc }),
      content: contentHtml,
      access: deriveDataAccess(loadDefaults(path.join(DOCS_DIR, 'brands', brandKey))),
      sectionSlug: `${brandKey}-home`,
      pageSection: `${brandKey}-home`,
      order: 0,
      level: 0,
    });

    // Write to brand folder
    const dir = path.join(OUTPUT_DIR, brandKey);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    console.log(`📄 Generated: ${brandKey}/index.html`);
  }
}

/**
 * Copy a bundled docs-kit asset into the output. Bundled assets exist only in
 * the shipped package; running from source with the defaults unset warns and
 * skips rather than failing the whole build.
 */
function copyKitAsset(rel, dest) {
  const src = path.join(KIT_ASSETS, rel);
  if (!fs.existsSync(src)) {
    console.warn(`⚠️  Bundled asset missing: ${src} — set docsCss/uiScripts in docs.config.js or reinstall the docs-kit package`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * Apply project chrome to the raw template: docs CSS, extra stylesheets and
 * scripts, head/body extensions, and wrapper/container attributes — the whole
 * extension surface. Injected strings may themselves carry template
 * placeholders ({{NAV_BASE}}, {{PAGE_ACCESS}}, {{SECTION_SLUG}}, ...):
 * injection happens before the per-page pass, so they resolve exactly like
 * native template text. Function replacers keep `$` sequences in injected
 * HTML literal.
 */
function applyTemplateChrome(rawTemplate) {
  // Zero-config framework CSS: ship the packaged design-system.css into the output
  if (USE_PACKAGED_DS) {
    const dest = path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'design-system.css');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(PACKAGED_DS_CSS, dest);
  }

  // Brand CSS: copy the configured stylesheet into the output at the same
  // relative path the pages link, so a standalone-served site keeps its
  // brand. Pages reference it after the framework CSS, preserving the
  // cascade. Skipped silently when unset; external URLs and site-absolute
  // hrefs have no project-root source file to copy. Projects that generate
  // in place (outputDir '.') already serve the source file — the guard
  // stops the copy landing on itself.
  if (CONFIG.brandCssPath && !/^(https?:)?\/\//.test(CONFIG.brandCssPath) && !CONFIG.brandCssPath.startsWith('/')) {
    const src = path.resolve(ROOT, CONFIG.brandCssPath);
    const dest = path.join(OUTPUT_DIR, CONFIG.brandCssPath);
    if (!fs.existsSync(src)) {
      console.warn(`⚠️  brandCssPath not found: ${src} — pages will link it, but the file is missing from the output`);
    } else if (src !== dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Docs chrome CSS: project-provided path, or the kit-bundled stylesheet
  // copied into the output
  let docsCssHref;
  if (CONFIG.docsCss) {
    docsCssHref = prefixHref('{{NAV_BASE}}', CONFIG.docsCss);
  } else {
    docsCssHref = '{{NAV_BASE}}assets/docs-kit/docs.css';
    copyKitAsset('docs.css', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'docs.css'));
  }

  // Docs UI scripts (copy buttons, dropdowns): project-provided list, or the
  // kit-bundled pair copied into the output
  let uiScripts = CONFIG.uiScripts;
  if (uiScripts === null) {
    uiScripts = ['assets/docs-kit/copy-button.js', 'assets/docs-kit/docs-copy-chrome.js', 'assets/docs-kit/dropdown.js'];
    copyKitAsset('js/copy-button.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'copy-button.js'));
    copyKitAsset('js/docs-copy-chrome.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'docs-copy-chrome.js'));
    copyKitAsset('js/dropdown.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'dropdown.js'));
  }

  // All configured paths are site-root-relative; the {{NAV_BASE}} prefix
  // resolves them per page depth. Absolute URLs pass through untouched.
  const nav = (p) => prefixHref('{{NAV_BASE}}', p);
  let styleLinks = CONFIG.extraStylesheets.map(href => `<link rel="stylesheet" href="${nav(href)}">`).join('\n    ');
  const uiScriptTags = uiScripts.map(src => `<script src="${nav(src)}" defer></script>`).join('\n    ');
  let extraScriptTags = CONFIG.extraScripts.map(src => `<script src="${nav(src)}" defer></script>`).join('\n    ');
  const highlightTag = `<script src="${nav(CONFIG.highlightJs)}"></script>`;

  // Page transitions (opt-in): ship the kit-bundled Barba assets and wire the
  // markup the resolver needs. A config whose wrapperAttrs/containerAttrs
  // already carry a data-barba attribute owns its Barba wiring outright — the
  // flag is then skipped entirely (assets, tags, and attrs), because loading
  // the kit's barba.min.js next to a site's own copy reassigns window.barba
  // and boots a second router that intercepts every click twice.
  let wrapperAttrs = CONFIG.wrapperAttrs;
  let containerAttrs = CONFIG.containerAttrs;
  const manualBarbaWiring = /data-barba\s*=/.test(wrapperAttrs + containerAttrs);
  if (CONFIG.pageTransitions && manualBarbaWiring) {
    console.warn('⚠️  pageTransitions: true ignored — wrapperAttrs/containerAttrs already carry data-barba markup, so this config owns its own Barba wiring (vendor script, init script, transition CSS). Remove the manual attrs to use the kit-bundled transitions.');
  }
  if (CONFIG.pageTransitions && !manualBarbaWiring) {
    // The opt-in must not half-ship: pages linking scripts that 404 fail
    // silently in the browser, so a missing bundled asset fails the build.
    const barbaAssets = ['barba-transitions.css', 'js/barba-docs.js', 'js/vendor/barba.min.js', 'js/vendor/barba-LICENSE.txt'];
    for (const rel of barbaAssets) {
      if (!fs.existsSync(path.join(KIT_ASSETS, rel))) {
        console.error(`❌ pageTransitions is on but a bundled asset is missing: ${path.join(KIT_ASSETS, rel)} — reinstall the docs-kit package.`);
        process.exit(1);
      }
    }
    copyKitAsset('barba-transitions.css', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'barba-transitions.css'));
    copyKitAsset('js/vendor/barba.min.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'vendor', 'barba.min.js'));
    copyKitAsset('js/vendor/barba-LICENSE.txt', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'vendor', 'barba-LICENSE.txt'));
    copyKitAsset('js/barba-docs.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'barba-docs.js'));

    // Before extraStylesheets so a consumer stylesheet can override; after
    // extraScripts so consumer modules (window.bdBarbaOptions, bd:after-nav
    // handlers) are in document order before the router boots.
    const barbaStyleLink = `<link rel="stylesheet" href="${nav('assets/docs-kit/barba-transitions.css')}">`;
    styleLinks = styleLinks ? `${barbaStyleLink}\n    ${styleLinks}` : barbaStyleLink;
    const barbaScriptTags =
      `<script src="${nav('assets/docs-kit/vendor/barba.min.js')}" defer></script>\n    ` +
      `<script src="${nav('assets/docs-kit/barba-docs.js')}" defer></script>`;
    extraScriptTags = extraScriptTags ? `${extraScriptTags}\n    ${barbaScriptTags}` : barbaScriptTags;

    wrapperAttrs += ' data-barba="wrapper"';
    containerAttrs += ' data-barba="container" data-barba-namespace="{{SECTION_SLUG}}" data-section="{{PAGE_SECTION}}" data-order="{{PAGE_ORDER}}" data-level="{{PAGE_LEVEL}}"';
  }

  return rawTemplate
    .replaceAll('{{CONFIG_PATH}}', `${path.basename(DOCS_DIR)}/docs.config.js`)
    .replace('{{DOCS_CSS}}', () => `<link rel="stylesheet" href="${docsCssHref}">`)
    .replace('{{EXTRA_STYLESHEETS}}', () => styleLinks)
    .replace('{{EXTRA_HEAD}}', () => CONFIG.extraHeadHtml.trimEnd())
    .replace('{{BODY_ATTRS}}', () => CONFIG.bodyAttrs)
    .replace('{{WRAPPER_ATTRS}}', () => wrapperAttrs)
    // {{CONTAINER_EXTRA}} rides along after the configured container attrs so
    // a page can add its own without every consumer config having to declare
    // the slot. renderPage fills it; it is empty on all but tool pages.
    .replace('{{CONTAINER_ATTRS}}', () => containerAttrs + '{{CONTAINER_EXTRA}}')
    // {{EXTRA_CONTENT}} is not filled here — it is part of {{PAGE_CHROME}},
    // which renderPage fills per page so a page type can omit it.
    .replace('{{HIGHLIGHT_JS}}', () => highlightTag)
    .replace('{{UI_SCRIPTS}}', () => uiScriptTags)
    .replace('{{EXTRA_SCRIPTS}}', () => extraScriptTags)
    .replace('{{EXTRA_BODY_END}}', () => CONFIG.extraBodyEndHtml.trimEnd());
}

/**
 * Parse CLI arguments for single-file generation.
 * Accepts filenames with or without .md extension, e.g.:
 *   node generate-docs.js color
 *   node generate-docs.js color.md typography spacing
 *
 * Returns null for full build, or a Set of normalised .md filenames.
 */
function parseCliFilter() {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;

  const filter = new Set();
  for (const arg of args) {
    const name = arg.endsWith('.md') ? arg : arg + '.md';
    // Verify file exists
    const filePath = path.join(DOCS_DIR, name);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${path.basename(DOCS_DIR)}/${name}`);
      process.exit(1);
    }
    filter.add(name);
  }
  return filter;
}

/**
 * Main generation function
 */
async function generateDocs() {
  const filter = parseCliFilter();
  const isSingleFile = filter !== null;

  if (isSingleFile) {
    console.log(`🎯 Generating: ${[...filter].join(', ')}`);
  } else {
    console.log('🚀 Starting full documentation generation...');
  }

  // Build icon map from SVG files
  buildIconMap();
  warnBrandRegistryGaps();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load template, apply project chrome (the config extension surface), then
  // resolve the site name — every page (root and brand) carries the suffix
  let template = applyTemplateChrome(fs.readFileSync(TEMPLATE_FILE, 'utf8'))
    .replaceAll('{{SITE_NAME}}', SITE.name);

  // Pre-process template icon placeholders
  template = template.replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name));

  console.log('✅ Template loaded');

  // Find all markdown files (exclude generator folder and README files)
  // We always parse ALL files to build navigation, even for single-file mode
  const markdownFiles = fs.readdirSync(DOCS_DIR)
    .filter(file => {
      const filePath = path.join(DOCS_DIR, file);
      // Skip directories and non-markdown files
      if (!fs.statSync(filePath).isFile() || !file.endsWith('.md')) {
        return false;
      }
      // Skip README and _defaults files
      if (file.startsWith('README') || file.startsWith('_')) {
        return false;
      }
      return true;
    });

  console.log(`📁 Found ${markdownFiles.length} markdown files`);

  // Parse files and organize by section
  const filesBySection = {};
  const allFiles = [];

  // Load folder defaults for the cms/ directory
  const cmsDefaults = loadDefaults(DOCS_DIR);

  // Layer validation (config: validateLayers — see CLAUDE.md §17, Layer
  // Discipline). When enabled, every published *.md file must declare which
  // layer it belongs to. Drives docs-site index filtering and llms.txt scope.
  const VALID_LAYERS = new Set(['foundation', 'core', 'docs-site', 'app']);
  // 'expanded' is the default and a no-op; it is accepted so a page can say so
  // out loud rather than relying on the absence of a field.
  const VALID_SIDEBAR = new Set(['collapsed', 'expanded']);
  const layerErrors = [];
  const typeErrors = [];
  // Every portable Website page owes the styleguide an entry (see the gate below).
  const styleguideExpected = [];
  // Every page the build actually produces, by output slug. The gate's stale
  // check reads this rather than the required set, so that showing something
  // extra stays legal and only a slug matching no page at all is an error.
  const styleguideKnown = new Set();

  for (const filename of markdownFiles) {
    const filePath = path.join(DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(content);
    // Merge folder defaults — page frontmatter wins
    const frontmatter = { ...cmsDefaults, ...parsed.frontmatter };
    const markdownContent = parsed.content;

    // Skip draft pages
    if (frontmatter.status === 'draft') {
      console.log(`⏭️  Skipped (draft): ${filename}`);
      continue;
    }

    // Validate layer (config: validateLayers)
    if (CONFIG.validateLayers) {
      if (!frontmatter.layer) {
        layerErrors.push(`  ${filename} — missing 'layer:' field`);
      } else if (!VALID_LAYERS.has(frontmatter.layer)) {
        layerErrors.push(`  ${filename} — invalid layer "${frontmatter.layer}" (must be one of: foundation, core, docs-site, app)`);
      }
    }

    // Validate page type. Unlike layer, `type:` is optional — an absent type
    // means `doc`, which is what nearly every page is. Only a value that is
    // present and unrecognised fails, because that is a typo silently getting
    // doc chrome rather than the chrome the author asked for.
    // The styleguide shows the system in one scroll, so every portable
    // Website page has to appear on it. Collected here, checked after the
    // loop — `styleguide-exempt` opts out a page with nothing to specimen.
    // Keyed on the output folder, not the section label: renaming the section
    // in config would silently empty this set and disable the gate forever,
    // which is the exact failure §17 Rule 5 records for the index filter.
    const out = deriveOutputPath(filename, frontmatter.section);
    const outPath = out.folder ? `${out.folder}/${out.htmlName}` : out.htmlName;
    styleguideKnown.add(styleguideSlug(outPath));

    if (SECTION_FOLDERS[frontmatter.section] === 'website'
        && (frontmatter.layer === 'foundation' || frontmatter.layer === 'core')
        && String(frontmatter['styleguide-exempt']) !== 'true') {
      styleguideExpected.push({
        filename,
        title: frontmatter.title || filename,
        htmlPath: outPath,
      });
    }

    if (frontmatter.type && !Object.prototype.hasOwnProperty.call(PAGE_TYPES, frontmatter.type)) {
      typeErrors.push(`  ${filename} — invalid type "${frontmatter.type}"`);
    }

    // nav.js matches the literal 'collapsed' and nothing else, so any other
    // value emits an attribute that does nothing. Validated because that is
    // precisely the failure this field already had once: `sidebar:` was read
    // by no renderer at all on this path, and the page still built.
    if (frontmatter.sidebar && !VALID_SIDEBAR.has(frontmatter.sidebar)) {
      typeErrors.push(`  ${filename} — invalid sidebar "${frontmatter.sidebar}" (must be one of: collapsed, expanded)`);
    }

    // `tool` and `bare` are not producible from a cms/*.md file. A tool is a
    // source pair in cms/apps/ (its body is raw HTML that must skip the
    // markdown pipeline, and it has a close to enforce); a bare page has no
    // sidebar and no Barba container, which this template cannot emit at all.
    // Both would otherwise render as a half-formed doc with no error.
    if (frontmatter.type === 'tool') {
      typeErrors.push(`  ${filename} — type "tool" belongs in cms/apps/ as a <slug>.md + <slug>.html pair`);
    }
    if (frontmatter.type === 'bare') {
      typeErrors.push(`  ${filename} — type "bare" is hand-authored, not generated (start from templates/page-template.html)`);
    }

    const title = frontmatter.title || filename.replace('.md', '');
    const section = frontmatter.section || 'uncategorized';

    // Derive output folder and filename
    const { folder, htmlName } = deriveOutputPath(filename, section);
    const htmlPath = folder ? folder + '/' + htmlName : htmlName;
    const markdownPath = filename;

    const file = {
      filename,
      title,
      section,
      htmlPath,
      htmlFolder: folder,
      htmlName,
      markdownPath,
      frontmatter,
      content: markdownContent
    };

    // Root pages (an explicit filenameOverrides entry with folder: '') are
    // standalone: the page is generated, but it joins no section — no nav
    // group, no section index card, no prev/next chain. Nav presence comes
    // from rootLinks, which renders a single link instead of a one-item
    // collapsible section. Keyed on the override, not the derived folder: a
    // missing sectionFolders entry also yields folder '', and those pages
    // must stay visible in the nav so the misconfiguration gets noticed.
    const isRootPage = FILENAME_OVERRIDES[filename] && FILENAME_OVERRIDES[filename].folder === '';
    if (!isRootPage) {
      if (!filesBySection[section]) {
        filesBySection[section] = [];
      }
      filesBySection[section].push(file);
    }
    allFiles.push(file);
  }

  console.log(`📂 Found sections: ${Object.keys(filesBySection).join(', ')}`);

  // Fail the build if any file is missing a valid layer (see CLAUDE.md §17)
  if (layerErrors.length > 0) {
    console.error('\n❌ Layer Discipline violation — every cms/*.md file must declare a valid layer:');
    console.error(layerErrors.join('\n'));
    console.error('\nValid layers: foundation, core, docs-site, app');
    console.error('See CLAUDE.md §17 (Layer Discipline) for details.\n');
    process.exit(1);
  }

  // Fail the build on an unrecognised page type (see cms/page-types.md)
  if (typeErrors.length > 0) {
    console.error('\n❌ Unknown page type:');
    console.error(typeErrors.join('\n'));
    console.error(`\nValid types: ${Object.keys(PAGE_TYPES).join(', ')}`);
    console.error('Omit `type:` entirely for an ordinary documentation page.\n');
    process.exit(1);
  }

  // Fail the build when the styleguide has fallen behind the system it shows.
  //
  // A hand-authored digest drifts the first time a component is added, and a
  // styleguide missing a component is worse than none — it reads as complete.
  // Keyed on the `data-component` each section carries, which is also its CSS
  // and JS hook, so there is no separate convention to keep in step. Skipped
  // entirely where the page does not exist, which is every consumer of the
  // docs kit.
  if (fs.existsSync(path.join(DOCS_DIR, STYLEGUIDE_SOURCE)) && styleguideExpected.length === 0) {
    console.error('\n❌ The styleguide gate matched no pages at all.');
    console.error('   Nothing maps to the "website" output folder, so the gate is inert.');
    console.error('   Check sectionFolders in docs.config.js.\n');
    process.exit(1);
  }

  // The gate keys on output basenames, so two expected pages sharing one would
  // let a single section satisfy both. Nothing in deriveOutputPath prevents it
  // (see styleguideSlug), so it is asserted rather than trusted.
  const slugOwners = new Map();
  for (const page of styleguideExpected) {
    const slug = styleguideSlug(page.htmlPath);
    if (slugOwners.has(slug)) {
      console.error(`\n❌ Two styleguide pages share the slug "${slug}":`);
      console.error(`  cms/${slugOwners.get(slug)} and cms/${page.filename}`);
      console.error('\nThe coverage gate cannot tell them apart. Rename one, or give it a');
      console.error('distinct filenameOverrides entry in cms/docs.config.js.\n');
      process.exit(1);
    }
    slugOwners.set(slug, page.filename);
  }

  const { missing, stale, empty } = validateStyleguideCoverage(styleguideExpected, styleguideKnown);
  if (empty) {
    console.error(`\n❌ cms/${STYLEGUIDE_SOURCE} declares no components at all.`);
    console.error('   Every section needs data-component="<slug>". With none, the gate');
    console.error('   has nothing to reconcile and would pass an empty page.\n');
    process.exit(1);
  }
  if (missing.length > 0 || stale.length > 0) {
    if (missing.length > 0) {
      console.error(`\n❌ The styleguide is missing ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'}:`);
      console.error(missing.join('\n'));
      console.error(`\nAdd a section to cms/${STYLEGUIDE_SOURCE} carrying data-component="<slug>",`);
      console.error('or set `styleguide-exempt: "true"` in its frontmatter when it is prose');
      console.error('with nothing to specimen.');
    }
    if (stale.length > 0) {
      console.error(`\n❌ The styleguide declares ${stale.length} component(s) that no longer exist:`);
      console.error(stale.join('\n'));
      console.error(`\nRemove the section from cms/${STYLEGUIDE_SOURCE}.`);
    }
    console.error('');
    process.exit(1);
  }

  // Build ordered page list for prev/next navigation
  const pageOrder = buildPageOrder(filesBySection);

  // Build sidebar position map: htmlPath → integer position within its section.
  // Used by Phase 3 directional transitions to compare clicked link order
  // against current page order. Position 0 = section overview ("Overview" link).
  // Re-uses the exact rendering order produced by buildNavSectionsHtml.
  const sidebarOrderMap = buildSidebarOrderMap(filesBySection);

  // Determine which files to write
  const filesToWrite = isSingleFile
    ? allFiles.filter(f => filter.has(f.filename))
    : allFiles;

  // Generate index and section pages only during full build
  if (!isSingleFile) {
    const indexContent = generateIndexPage(template, filesBySection);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), indexContent);
    console.log('📄 Generated: index.html');
  }

  // Generate HTML for target files
  for (const file of filesToWrite) {
    const pageContent = generatePage(file, template, pageOrder, sidebarOrderMap);

    // Ensure output directory exists
    if (file.htmlFolder) {
      const dir = path.join(OUTPUT_DIR, file.htmlFolder);
      fs.mkdirSync(dir, { recursive: true });
    }

    const outputPath = path.join(OUTPUT_DIR, file.htmlPath);
    fs.writeFileSync(outputPath, pageContent);
    console.log(`📄 Generated: ${file.htmlPath}`);
  }

  // Section index pages — only during full build
  if (!isSingleFile) {
    for (const section of Object.keys(filesBySection)) {
      const sectionFolder = SECTION_FOLDERS[section];
      if (!sectionFolder) continue;
      const sectionIndexHtml = generateSectionIndexPage(section, template, filesBySection[section], filesBySection);
      if (sectionIndexHtml) {
        const dir = path.join(OUTPUT_DIR, sectionFolder);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), sectionIndexHtml);
        console.log(`📄 Generated: ${sectionFolder}/index.html`);
      }
    }
  }

  // Standalone source directories — only during full build. Both join no
  // section, so nothing above depends on them and nothing below reads them.
  if (!isSingleFile) {
    generateSourceDirPages(template, { dirName: 'apps', toolHook: true });
    // The examples have no index of their own — the page-layouts reference is
    // their contents page, so that is where they close to.
    generateSourceDirPages(template, {
      dirName: 'examples',
      outputFolder: 'examples',
      defaultSection: 'Docs',
      closeHref: '/docs/page-layouts.html',
      closeLabel: 'Page Layouts',
    });
  }

  // Always regenerate nav.js (sidebar needs to stay current)
  const navJs = generateNavJs(filesBySection);
  const navJsPath = path.join(OUTPUT_DIR, 'assets', 'js', 'nav.js');
  fs.mkdirSync(path.dirname(navJsPath), { recursive: true });
  fs.writeFileSync(navJsPath, navJs);
  console.log('📄 Generated: assets/js/nav.js');

  // Brand docs (config: brandsDir) — only during full build. Manifests in,
  // one theme-config out: the in-memory registry is populated by the brand
  // generators, then serialized once. Nothing reads or rewrites the live JS
  // file mid-build.
  if (!isSingleFile && BRANDS_DIR) {
    const themes = loadBrandThemes();
    // The root brand's theme ships to output for the root pages' static link
    if (ROOT_BRAND_KEY) copyBrandAssets(ROOT_BRAND_KEY);
    generateBrandDocs(template, themes);
    generateBrandBook(template, themes);
    generateBrandSectionOverviews(template, themes);
    generateBrandIndexPages(template, themes);
    writeThemeConfig(themes);
  }

  if (isSingleFile) {
    console.log(`✅ Done — regenerated ${filesToWrite.length} page(s) + nav.js`);
  } else {
    console.log('✅ Documentation generation complete!');
    console.log(`📊 Generated ${allFiles.length + 1} HTML pages + nav.js`);
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);
  }
}

// Run the generator — fail the build on error so a broken run can't deploy stale HTML
if (require.main === module) {
  generateDocs().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// watch-docs.js shares the project discovery
module.exports = { locateProject };
