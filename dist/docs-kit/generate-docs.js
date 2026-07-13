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
  markdownSourceBase: userConfig.markdownSourceBase || null,
  validateLayers: userConfig.validateLayers === true,
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

// Prefix a page-relative base onto a path unless it is already absolute
function prefixHref(base, p) {
  return /^(https?:)?\/\//.test(p) || p.startsWith('/') ? p : base + p;
}

// Build Brand CSS HTML snippet
const BRAND_CSS_HTML = PROJECT_CONFIG.brandCssPath
  ? `<link rel="stylesheet" href="${PROJECT_CONFIG.brandCssPath}">`
  : '';

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
  const map = {};
  const seen = {};

  for (const file of files) {
    const key = file.replace(/\.svg$/i, '').toLowerCase().replace(/\s+/g, '-');

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

    // Normalise: replace fixed width/height with 100%
    svg = svg.replace(/(<svg[^>]*)\s+width=["']\d+["']/i, '$1 width="100%"');
    svg = svg.replace(/(<svg[^>]*)\s+height=["']\d+["']/i, '$1 height="100%"');

    // Add aria-hidden if not present
    if (!svg.includes('aria-hidden')) {
      svg = svg.replace(/<svg/, '<svg aria-hidden="true"');
    }

    // Add data-icon on the <svg> element for CSS targeting
    svg = svg.replace(/<svg/, `<svg data-icon="${key}"`);

    map[key] = { svg: svg, file: file };
  }

  ICON_MAP = map;
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
 * @returns {string} HTML string
 */
function renderBookCover(opts) {
  const author = opts.author || 'Studio';
  const accessAttr = opts.access ? ` data-access="${opts.access}"` : '';
  const description = opts.subtitle
    ? `<p class="book-cover-description" data-text-wrap="pretty">${opts.subtitle}</p>`
    : '';
  const flipId = flipIdFromHref(opts.href);
  const flipAttr = flipId ? ` data-flip-id="${flipId}"` : '';
  return `<a href="${opts.href}" class="book-cover"${accessAttr}>
        <header class="book-cover-header">${getIcon('open-full')}</header>
        <div class="book-cover-content">
          <h3 class="book-cover-title"${flipAttr}>${opts.title}</h3>
          ${description}
        </div>
        <footer class="book-cover-footer">
          <span class="book-cover-author"><em>by</em> ${author}</span>
        </footer>
      </a>`;
}

/**
 * Render a book-page row for L1 section index pages.
 * Wide horizontal row — title + description left-aligned,
 * icon on the right (revealed on hover).
 * @param {Object} opts - { href, title, subtitle, author, access }
 * @returns {string} HTML string
 */
function renderBookPage(opts) {
  const accessAttr = opts.access ? ` data-access="${opts.access}"` : '';
  const description = opts.subtitle
    ? `<p class="book-page-description" data-text-wrap="pretty">${opts.subtitle}</p>`
    : '';
  const flipId = flipIdFromHref(opts.href);
  const flipAttr = flipId ? ` data-flip-id="${flipId}"` : '';
  return `<a href="${opts.href}" class="book-page"${accessAttr}>
        <div class="book-page-content">
          <h3 class="book-page-title"${flipAttr}>${opts.title}</h3>
          ${description}
        </div>
        <div class="book-page-action">${getIcon('open-full')}</div>
      </a>`;
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

  if (headings.length === 0) {
    return '<div class="toc-empty">No headings found</div>';
  }

  let toc = '<nav class="toc"><ul class="toc-list">';

  headings.forEach((heading) => {
    const { level, id, text } = heading;
    toc += `<li class="toc-item toc-level-${level}"><a href="#${id}" class="toc-link">${text}</a></li>`;
  });

  toc += '</ul></nav>';
  return toc;
}

/**
 * Generate index page HTML
 */
function generateIndexPage(template, filesBySection) {
  let cards = '';

  if (CONFIG.indexCards) {
    // Curated index (config: indexCards): one card per entry in a 2-column grid
    cards = `<div class="docs-section">
      <div class="grid cols-2 gap-xl">`;

    for (const card of CONFIG.indexCards) {
      cards += `
        ${renderBookCover(card)}`;
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
      <h2 class="eyebrow">${section}</h2>
      <div class="grid cols-2 gap-xl">`;
      for (const file of files) {
        cards += `
        ${renderBookCover({ href: file.htmlPath, title: file.title, subtitle: file.frontmatter.subtitle })}`;
      }
      cards += `
      </div>
    </div>`;
    }
  }

  const indexContent = `
    <div class="docs-hero">
      <h1 class="docs-hero-title">${SITE.name}</h1>
      <p class="docs-hero-description" data-text-wrap="balance">${SITE.description}</p>
    </div>
    ${cards}
  `;

  const access = deriveDataAccess(loadDefaults(DOCS_DIR));

  return template
    .replaceAll('{{PAGE_TITLE}}', 'Home')
    .replaceAll('{{META_DESCRIPTION}}', SITE.description)
    .replace('{{PAGE_HEADER}}', '') // Index page doesn't need a header
    .replace('{{PAGE_STICKY_BAR}}', '')
    .replace('{{PAGE_CONTENT}}', indexContent)
    .replace('{{TOC_SECTION}}', '')
    .replace('{{DESIGN_SYSTEM_PATH}}', PROJECT_CONFIG.designSystemPath)
    .replace('{{BRAND_CSS}}', BRAND_CSS_HTML)
    .replace('{{BRAND_THEME_CSS}}', rootThemeCss(''))
    .replace('{{BRAND_THEME_ATTR}}', '')
    .replace('{{FONT_HEAD}}', fontHeadHtml(ROOT_MANIFEST, './'))
    .replace('{{PAGE_NAV}}', '')
    .replace('{{FOOTER_TEXT}}', SITE.footerText)
    .replace('{{FAVICON_SVG}}', brandChromeSlots(null, '').faviconSvg)
    .replace('{{FAVICON_ICO}}', brandChromeSlots(null, '').faviconIco)
    .replace('{{OG_IMAGE}}', brandChromeSlots(null, '').ogImage)
    .replace('{{PAGE_ACCESS}}', access)
    .replace('{{SECTION_SLUG}}', 'home')
    .replace('{{PAGE_SECTION}}', 'home')
    .replace('{{PAGE_ORDER}}', '0')
    .replace('{{PAGE_LEVEL}}', '0')
    .replace('{{PAGE_SCRIPTS}}', '')
    // Home lives at the repo root, so its NAV_BASE is the current directory.
    // It must be './' not '' — an empty base turns the GoTrue dynamic
    // import('{{NAV_BASE}}assets/...') into a bare module specifier, which
    // throws "Failed to resolve module specifier" and breaks auth (the home
    // page is data-access="team"), causing a login redirect loop.
    .replaceAll('{{NAV_BASE}}', './');
}

/**
 * Generate a section overview page with card grid
 */
function generateSectionIndexPage(section, template, files, filesBySection) {
  const sectionFolder = SECTION_FOLDERS[section];
  if (!sectionFolder) return null;

  // Layer Discipline (CLAUDE.md §17): the Design System index lists only
  // foundation + core layer pages. Docs-site components like asset-card,
  // book-cover, dont-card etc. still get standalone pages but are hidden
  // from the index so the design system surface stays portable.
  if (section === 'Design System') {
    files = files.filter(f => {
      const layer = f.frontmatter.layer;
      return layer === 'foundation' || layer === 'core';
    });
  }

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
    cards += `<div class="docs-section"><div class="book-page-list">`;
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
      cards += renderBookPage({
        href: cardHref,
        title: file.title,
        subtitle: file.frontmatter.subtitle,
        author: file.frontmatter.author,
        access: cardAccess,
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
    cards += `<div class="docs-section"><h2 class="eyebrow">${sub}</h2><div class="book-page-list">`;
    for (const file of grouped[sub]) {
      cards += renderBookPage({
        href: '/' + file.htmlPath,
        title: file.title,
        subtitle: file.frontmatter.subtitle,
        author: file.frontmatter.author,
        access: deriveDataAccess(file.frontmatter),
      });
    }
    cards += `</div></div>`;
  }

  const pageContent = `<div class="docs-hero"><h1 class="docs-hero-title">${section}</h1></div>${cards}`;
  const navBase = '../';

  // Section's index in the global sectionOrder — used by the level-based
  // transition system to resolve L1 → L1 sibling navigation (e.g. clicking
  // Design System overview while on Brand Book overview slides forward).
  // Mirrors the same default chain buildPageOrder uses (line ~790).
  const sectionDefaults = loadDefaults(DOCS_DIR);
  const globalSectionOrder = parseList(sectionDefaults['section-order'], DEFAULT_SECTION_ORDER);
  const sectionIndex = globalSectionOrder.indexOf(section);
  const sectionOrderValue = sectionIndex === -1 ? 999 : sectionIndex;

  return template
    .replaceAll('{{PAGE_TITLE}}', `${section} - Overview`)
    .replaceAll('{{META_DESCRIPTION}}', `Overview of all ${section} pages.`)
    .replace('{{PAGE_HEADER}}', '')
    .replace('{{PAGE_STICKY_BAR}}', '')
    .replace('{{PAGE_CONTENT}}', pageContent)
    .replace('{{TOC_SECTION}}', '')
    .replace('{{DESIGN_SYSTEM_PATH}}', navBase + PROJECT_CONFIG.designSystemPath)
    .replace('{{BRAND_CSS}}', BRAND_CSS_HTML ? BRAND_CSS_HTML.replace(/href="(?!http)/g, `href="${navBase}`) : '')
    .replace('{{BRAND_THEME_CSS}}', rootThemeCss(navBase))
    .replace('{{BRAND_THEME_ATTR}}', '')
    .replace('{{FONT_HEAD}}', fontHeadHtml(ROOT_MANIFEST, navBase))
    .replace('{{PAGE_NAV}}', '')
    .replace('{{FOOTER_TEXT}}', SITE.footerText)
    .replace('{{FAVICON_SVG}}', brandChromeSlots(null, navBase).faviconSvg)
    .replace('{{FAVICON_ICO}}', brandChromeSlots(null, navBase).faviconIco)
    .replace('{{OG_IMAGE}}', brandChromeSlots(null, navBase).ogImage)
    .replace('{{PAGE_ACCESS}}', deriveDataAccess(loadDefaults(DOCS_DIR)))
    .replace('{{SECTION_SLUG}}', `${slugifySection(section)}-overview`)
    .replace('{{PAGE_SECTION}}', slugifySection(section))
    .replace('{{PAGE_ORDER}}', String(sectionOrderValue))
    .replace('{{PAGE_LEVEL}}', '1')
    .replace('{{PAGE_SCRIPTS}}', '')
    .replaceAll('{{NAV_BASE}}', navBase);
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

  const arrowLeft = `<div class="svg-icn page-nav-arrow">${getRawIcon('chevron-left-large')}</div>`;
  const arrowRight = `<div class="svg-icn page-nav-arrow">${getRawIcon('chevron-right-large')}</div>`;

  let html = '<nav class="page-nav" aria-label="Page navigation"><div class="page-nav-inner padding-global">';

  if (prev) {
    const sectionLabel = prev.section !== file.section ? `<span class="page-nav-section">${prev.section}</span>` : '';
    html += `<a href="${relativeHref(prev)}" class="page-nav-link page-nav-prev" rel="prev">
      ${arrowLeft}
      <span class="page-nav-text">
        <span class="page-nav-label">Previous</span>
        ${sectionLabel}
        <h3 class="page-nav-title">${prev.title}</h3>
      </span>
    </a>`;
  } else {
    html += '<span class="page-nav-link page-nav-placeholder"></span>';
  }

  if (next) {
    const sectionLabel = next.section !== file.section ? `<span class="page-nav-section">${next.section}</span>` : '';
    html += `<a href="${relativeHref(next)}" class="page-nav-link page-nav-next" rel="next">
      <span class="page-nav-text">
        <span class="page-nav-label">Next</span>
        ${sectionLabel}
        <h3 class="page-nav-title">${next.title}</h3>
      </span>
      ${arrowRight}
    </a>`;
  } else {
    html += '<span class="page-nav-link page-nav-placeholder"></span>';
  }

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
function generatePage(file, template, pageOrder, sidebarOrderMap = {}) {
  const { frontmatter, content } = file;
  let htmlContent = markdownToHtml(content);

  // Apply drop cap to first paragraph if enabled in frontmatter
  if (frontmatter.dropcap === 'true') {
    htmlContent = htmlContent.replace(/<p>/, '<p class="drop-cap">');
  }

  // Opt-out flags. Frontmatter values are strings — compare against 'false'.
  // Defaults are preserved: only an explicit `<flag>: false` suppresses output.
  const tocEnabled = frontmatter.toc !== 'false';
  const stickyBarEnabled = frontmatter['sticky-bar'] !== 'false';
  const paginationEnabled = frontmatter.pagination !== 'false';

  const tableOfContents = tocEnabled ? generateTableOfContents(htmlContent) : '';
  const access = deriveDataAccess(frontmatter);

  // Generate full-width page header (lives outside the content grid)
  let pageHeader = '';
  const actionUrl = frontmatter.actionUrl || frontmatter.toolUrl;
  const actionLabel = frontmatter.actionLabel || frontmatter.toolLabel || 'Open';
  const actionLinkHtml = actionUrl
    ? `<div class="button-group justify-center">
        <a href="${actionUrl}" class="button page-action-link" data-size="small">${actionLabel}</a>
      </div>`
    : '';
  if (frontmatter.title) {
    const pageFlipId = flipIdFromHref(file.htmlName);
    const pageFlipAttr = pageFlipId ? ` data-flip-id="${pageFlipId}"` : '';
    pageHeader = `<div class="page-header">
      <div class="container-s">
        <h1${pageFlipAttr}>${frontmatter.title}</h1>
        ${frontmatter.subtitle ? `<p class="page-subtitle" data-text-wrap="pretty">${frontmatter.subtitle}</p>` : ''}
        ${actionLinkHtml}
      </div>
    </div>`;
  }

  // Page depth drives every relative href; folderless pages sit at output root
  const navBase = file.htmlFolder ? '../' : './';

  // Generate sticky sub-header bar (breadcrumb + markdown dropdown)
  let pageSubbar = '';
  if (stickyBarEnabled && frontmatter.title && file.htmlFolder) {
    const sectionLabel = file.section || file.htmlFolder.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    // Markdown-source items only when the .md files are reachable from the
    // served site (config: markdownSourceBase)
    const mdHref = CONFIG.markdownSourceBase ? `${navBase}${CONFIG.markdownSourceBase}/${file.markdownPath}` : null;
    const mdSourceItems = mdHref ? `<div data-auth-role="team">
                <div class="dropdown-divider"></div>
                <a href="${mdHref}" class="dropdown-item js-md-download" download>
                  ${getIcon('download')}
                  <span>Download .md file</span>
                </a>
                <div class="dropdown-divider"></div>
                <a href="${mdHref}" class="dropdown-item js-md-open" target="_blank" rel="noopener noreferrer">
                  ${getIcon('open-full')}
                  <span>Open .md in new tab</span>
                </a>
              </div>` : '';
    pageSubbar = `<div class="sticky-bar sticky-bar-page">
      <div class="sticky-bar-container">
        <div class="sticky-bar-content">
          <nav class="sticky-bar-breadcrumbs" aria-label="Breadcrumb">
            <a href="/${file.htmlFolder}/index.html">${sectionLabel}</a>
            <span class="breadcrumb-separator">/</span>
            <span>${frontmatter.title}</span>
          </nav>
        </div>
        <div class="sticky-bar-actions">
          <div class="dropdown">
            <button class="dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Markdown source options">
              ${getIcon('more-horizontal')}
            </button>
            <div class="dropdown-menu is-right">
              <button type="button" class="dropdown-item js-copy-url" aria-label="Copy page link to clipboard">
                ${getIcon('link')}
                <span>Copy link</span>
              </button>
              ${mdSourceItems}
            </div>
          </div>
          <a href="/${file.htmlFolder}/index.html" class="sticky-bar-close" aria-label="Close ${frontmatter.title}">
            ${getIcon('close-large')}
          </a>
        </div>
      </div>
    </div>`;
  }

  // Build page scripts based on section and frontmatter
  const pageScripts = buildPageScripts(file.section, frontmatter, navBase);

  return template
    .replaceAll('{{PAGE_TITLE}}', frontmatter.title || 'Untitled')
    .replaceAll('{{META_DESCRIPTION}}', frontmatter.description || '')
    .replace('{{PAGE_HEADER}}', pageHeader)
    .replace('{{PAGE_STICKY_BAR}}', pageSubbar)
    .replace('{{PAGE_CONTENT}}', htmlContent)
    .replace('{{TOC_SECTION}}', tocEnabled
      ? `<aside class="docs-toc">
      <span class="toc-header">On this page</span>
      <div class="toc-wrapper">${tableOfContents}</div>
    </aside>`
      : '')
    .replace('{{DESIGN_SYSTEM_PATH}}', prefixHref(navBase, PROJECT_CONFIG.designSystemPath))
    .replace('{{BRAND_CSS}}', BRAND_CSS_HTML ? `<link rel="stylesheet" href="${prefixHref(navBase, PROJECT_CONFIG.brandCssPath)}">` : '')
    .replace('{{BRAND_THEME_CSS}}', rootThemeCss(navBase))
    .replace('{{BRAND_THEME_ATTR}}', '')
    .replace('{{FONT_HEAD}}', fontHeadHtml(ROOT_MANIFEST, navBase))
    .replace('{{PAGE_NAV}}', paginationEnabled ? generatePageNav(file, pageOrder) : '')
    .replace('{{FOOTER_TEXT}}', SITE.footerText)
    .replace('{{FAVICON_SVG}}', brandChromeSlots(null, navBase).faviconSvg)
    .replace('{{FAVICON_ICO}}', brandChromeSlots(null, navBase).faviconIco)
    .replace('{{OG_IMAGE}}', brandChromeSlots(null, navBase).ogImage)
    .replace('{{PAGE_ACCESS}}', access)
    .replace('{{PAGE_SCRIPTS}}', pageScripts)
    .replace('{{SECTION_SLUG}}', slugifySection(file.section))
    .replace('{{PAGE_SECTION}}', slugifySection(file.section))
    // Per-section sidebar position (matches the data-order on the matching
    // sidebar nav-link). Falls back to 999 for files not in any sidebar.
    .replace('{{PAGE_ORDER}}', String(sidebarOrderMap[file.htmlPath] || 999))
    .replace('{{PAGE_LEVEL}}', '2')
    .replaceAll('{{NAV_BASE}}', navBase);
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
function generateNavJs(filesBySection, sidebarOrderMap) {
  // Build navigation HTML (no active page — active detection is done at runtime)
  const navSectionsHtml = buildNavSectionsHtml(filesBySection, sidebarOrderMap);

  // Escape backticks and backslashes for embedding in a JS template literal
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/'/g, "\\'");

  // Top-nav logo (config: logoHtml) — plain site name when not configured
  const logoHtml = CONFIG.logoHtml || `<span class="top-nav-logo-text">${SITE.name}</span>`;

  // Contact link (config: contactHref / contactLabel) — omitted when unset
  const contactNavJs = CONFIG.contactHref ? `
    + '<a href="${CONFIG.contactHref}" class="top-nav-link top-nav-contact-link" aria-label="${CONFIG.contactLabel}">'
    + '<div class="svg-icn">' + ICON_MAIL + '</div>'
    + '<span class="top-nav-link-label">${CONFIG.contactLabel}</span>'
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
  var ICON_SUN = '${esc(getRawIcon('sun-1'))}';
  var ICON_MOON = '${esc(getRawIcon('moon'))}';
  var ICON_MAIL = '${esc(getRawIcon('mail'))}';

  // ── Build top nav HTML ──
  var headerLeft = '<div class="top-nav-left">';

  if (hasSidebar) {
    // Hamburger for mobile sidebar
    headerLeft += '<div class="top-nav-link top-nav-hamburger" role="button" tabindex="0" aria-label="Open navigation">'
      + '<div class="svg-icn hamburger-icon-open">' + ICON_HAMBURGER + '</div>'
      + '<div class="svg-icn hamburger-icon-close">' + ICON_CLOSE + '</div>'
      + '</div>';
  }

  headerLeft += '<a href="/index.html" class="top-nav-logo-link">'
    + '${esc(logoHtml)}'
    + '</a></div>';

  var ICON_CHEVRON_DOWN = '${esc(getRawIcon('chevron-down'))}';

  var headerRight = '<div class="top-nav-right">'${contactNavJs}
    + '<div class="top-nav-auth-container"></div>'
    + '<div class="top-nav-link dark-mode-toggle" role="button" tabindex="0" aria-label="Toggle dark mode">'
    + '<div class="svg-icn dark-mode-icon-light">' + ICON_SUN + '</div>'
    + '<div class="svg-icn dark-mode-icon-dark">' + ICON_MOON + '</div>'
    + '</div>'
    + '</div>';

  var headerHtml = '<header class="top-nav">' + headerLeft + headerRight + '</header>';

  // ── Build sidebar HTML (if needed) ──
  var sidebarHtml = '';
  if (hasSidebar) {
    sidebarHtml = '<aside class="site-sidebar" role="navigation" aria-label="Site navigation">'
      + '<div class="site-sidebar-header">'
      + '<button class="site-sidebar-toggle" aria-label="Collapse sidebar" type="button">'
      + '<div class="svg-icn sidebar-icon-open">' + ICON_COLLAPSE + '</div>'
      + '<div class="svg-icn sidebar-icon-close">' + ICON_EXPAND + '</div>'
      + '</button>'
      + '</div>'
      + '<div class="site-sidebar-content">'
      + '<a href="/index.html" class="nav-link nav-home" data-access="team">'
      + '<div class="svg-icn">' + ICON_HOME + '</div>'
      + '<span>Home</span>'
      + '</a>'
      + \`${esc(navSectionsHtml)}\`
      + '</div>'
      + ''
      + '</aside>'
      + '<div class="site-sidebar-backdrop"></div>';
  }

  // ── Inject into page ──
  // The mount (#site-nav) already contains <main class="docs-main-area"> from
  // the template. Use insertAdjacentHTML to prepend the header + sidebar
  // BEFORE the existing <main>, preserving it in place as a grid sibling.
  mount.insertAdjacentHTML('afterbegin', headerHtml + sidebarHtml);

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
      var navLinks = mount.querySelectorAll('.nav-link');
      var currentNorm = normPath(window.location.pathname);

      // Clear previous active state (idempotent — safe to call repeatedly)
      for (var k = 0; k < navLinks.length; k++) {
        navLinks[k].classList.remove('nav-link-active');
        navLinks[k].removeAttribute('aria-current');
      }

      for (var j = 0; j < navLinks.length; j++) {
        var link = navLinks[j];
        // Resolve the link href to an absolute path (handles ../ prefixes correctly)
        var resolvedPath = new URL(link.href, window.location.href).pathname;
        var resolvedNorm = normPath(resolvedPath);

        if (currentNorm === resolvedNorm) {
          link.classList.add('nav-link-active');
          link.setAttribute('aria-current', 'page');
          // Open parent details section and subsection dropdown
          var parentDetails = link.closest('.nav-section');
          if (parentDetails) {
            parentDetails.setAttribute('open', '');
          }
          var parentSubsection = link.closest('.nav-subsection');
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
  }

  // ── Section icon links: prevent details toggle without swallowing clicks ──
  // These <a> tags live inside <summary>. stopPropagation would prevent the
  // click from reaching any document-level router listener. Instead we
  // intercept on the <summary> itself and preventDefault when the click
  // originated from an icon link, which stops the toggle but lets the
  // event keep bubbling so navigation still happens.
  if (hasSidebar) {
    var summaries = mount.querySelectorAll('.nav-section-toggle');
    for (var s = 0; s < summaries.length; s++) {
      summaries[s].addEventListener('click', function(e) {
        if (e.target.closest && e.target.closest('.nav-section-icon')) {
          e.preventDefault();
        }
      });
    }
  }

  // ── Mobile hamburger toggle ──
  if (hasSidebar) {
    var hamburger = mount.querySelector('.top-nav-hamburger');
    var backdrop = mount.querySelector('.site-sidebar-backdrop');

    function closeMobileNav() {
      document.body.classList.remove('mobile-nav-open');
      if (hamburger) hamburger.setAttribute('aria-label', 'Open navigation');
    }

    function openMobileNav() {
      document.body.classList.add('mobile-nav-open');
      if (hamburger) hamburger.setAttribute('aria-label', 'Close navigation');
    }

    if (hamburger) {
      hamburger.addEventListener('click', function() {
        if (document.body.classList.contains('mobile-nav-open')) {
          closeMobileNav();
        } else {
          openMobileNav();
        }
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', closeMobileNav);
    }
  }

  // ── Dark mode toggle ──
  var DARK_KEY = 'dark-mode';
  var darkToggle = mount.querySelector('.dark-mode-toggle');

  // Apply saved preference or system default
  var savedDark = localStorage.getItem(DARK_KEY);
  if (savedDark === 'true' || (savedDark === null && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  if (darkToggle) {
    darkToggle.addEventListener('click', function toggleDarkMode() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
      localStorage.setItem(DARK_KEY, !isDark);
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
 */
function buildNavSectionsHtml(filesBySection, sidebarOrderMap = {}) {
  let html = '';

  // Shared chevron for section and subsection toggles
  const navChevron = `<span class="nav-toggle-icon">
          <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
            <path d="M3.58943 3L1.28943 0.7L1.98943 0L4.98943 3L1.98943 6L1.28943 5.3L3.58943 3Z" fill="currentColor"/>
          </svg>
        </span>`;

  // Section icons (config: sectionIcons — section label → icon key)
  const sectionIconMap = {};
  for (const [sectionName, iconKey] of Object.entries(CONFIG.sectionIcons)) {
    sectionIconMap[sectionName] = { icon: getRawIcon(iconKey) };
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
    const sectionIndexHref = sectionFolder ? '/' + sectionFolder + '/index.html' : '';
    // Slug used by Phase 3 directional transitions to detect same/different section
    const sectionSlug = slugifySection(section);
    const iconHtml = sectionIcon
      ? `<a href="${sectionIndexHref}" class="nav-section-icon" data-section="${sectionSlug}"><div class="svg-icn">${sectionIcon.icon}</div></a>`
      : '';

    html += `<details class="nav-section">
      <summary class="nav-section-toggle">
        ${iconHtml}<span>${sectionLabel}</span>
        ${navChevron}
      </summary>
      <ul class="nav-list">`;

    // Overview link (first item in every section, only when the section has a
    // folder and therefore an index page). data-order="0" so direction
    // detection always treats it as the lowest-order page in the section.
    if (sectionIndexHref) {
      html += `<li><a href="${sectionIndexHref}" class="nav-link" data-section="${sectionSlug}" data-order="0" data-access="team"><span>Overview</span></a></li>`;
    }

    // Sequential counter mirrors buildSidebarOrderMap — same walk order, so the
    // data-order on each nav-link matches the data-order on its destination
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
      let linkHref = '/' + file.htmlPath;
      let linkAccess = deriveDataAccess(file.frontmatter);
      const navActionUrl = file.frontmatter.actionUrl || file.frontmatter.toolUrl;
      if (section === 'Tools' && !navActionUrl) {
        // Pure guide pages (no tool app) render under the Guides label below.
        continue;
      }
      if (section === 'Tools' && navActionUrl) {
        // actionUrl is relative to the tool docs page (e.g. "./cpm-calculator.html").
        // Resolve to an absolute site path.
        const fileName = navActionUrl.replace(/^(\.\.?\/)+/, '');
        const sectionFolder = SECTION_FOLDERS[section] || 'tools';
        linkHref = '/' + sectionFolder + '/' + fileName;
        linkAccess = file.frontmatter.actionAccess || file.frontmatter.toolAccess || 'brand';
      }
      html += `<li><a href="${linkHref}" class="nav-link" data-section="${sectionSlug}" data-order="${navPos}" data-access="${linkAccess}"><span>${file.title}</span></a></li>`;
      navPos++;
    }

    // Tools-only: the entries above point at the tool apps (actionUrl), which
    // would leave the usage docs unreachable from any nav. List every tool's
    // doc page under a Guides label, ordered by the sidebar order map — the
    // same pattern the Docs section used before the docs consolidation.
    if (section === 'Tools') {
      html += `<li><details class="nav-subsection">
        <summary class="nav-subsection-toggle"><span>Guides</span>${navChevron}</summary>
        <ul class="nav-sublist">`;
      for (const file of files) {
        const guideAccess = deriveDataAccess(file.frontmatter);
        const guidePos = sidebarOrderMap[file.htmlPath] || 999;
        html += `<li><a href="/${file.htmlPath}" class="nav-link" data-section="${sectionSlug}" data-order="${guidePos}" data-access="${guideAccess}"><span>${file.title}</span></a></li>`;
      }
      html += `</ul></details></li>`;
    }

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
      html += `<li><details class="nav-subsection">
        <summary class="nav-subsection-toggle"><span>${sub}</span>${navChevron}</summary>
        <ul class="nav-sublist">`;
      for (const file of grouped[sub]) {
        const linkAccess = deriveDataAccess(file.frontmatter);
        html += `<li><a href="/${file.htmlPath}" class="nav-link" data-section="${sectionSlug}" data-order="${navPos}" data-access="${linkAccess}"><span>${file.title}</span></a></li>`;
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
 */
function brandChromeSlots(manifest, base) {
  const m = manifest || {};
  return {
    faviconSvg: m.faviconSvg || `${base}assets/icons/favicon.svg`,
    faviconIco: m.faviconIco || `${base}assets/icons/favicon.ico`,
    ogImage: m.ogImage || `${base}assets/images/og/og-default.jpg`,
  };
}

/**
 * Serialize the theme registry to assets/js/theme-config.js in one write.
 * JSON.stringify handles all quoting — the regex-rewrite escaping bugs
 * (CODE-AUDIT BUILD-6/7/8) can't recur.
 */
function writeThemeConfig(themes) {
  const emitted = {};
  for (const [key, t] of Object.entries(themes)) {
    emitted[key] = {
      label: t.label,
      description: t.description,
      css: t.css,
      fonts: t.fonts,
      pages: t.pages,
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
      let pageHeader = '';
      const brandActionUrl = frontmatter.actionUrl || frontmatter.toolUrl;
      const brandActionLabel = frontmatter.actionLabel || frontmatter.toolLabel || 'Open';
      const brandActionHtml = brandActionUrl
        ? `<div class="button-group justify-center">
            <a href="${brandActionUrl}" class="button page-action-link" data-size="small">${brandActionLabel}</a>
          </div>`
        : '';
      if (title) {
        const brandPageFlipId = flipIdFromHref(htmlName);
        const brandPageFlipAttr = brandPageFlipId ? ` data-flip-id="${brandPageFlipId}"` : '';
        pageHeader = `<div class="page-header">
          <div class="container-s">
            <h1${brandPageFlipAttr}>${title}</h1>
            ${frontmatter.subtitle ? `<p class="page-subtitle" data-text-wrap="pretty">${frontmatter.subtitle}</p>` : ''}
            ${brandActionHtml}
          </div>
        </div>`;
      }

      // Build sticky sub-header bar (breadcrumb + markdown dropdown)
      let pageSubbar = '';
      if (title && frontmatter.section) {
        const sectionLabel = frontmatter.section;
        // Absolute href so the link resolves correctly from any page depth
        // (e.g. surviving Barba transitions where chrome data-base goes stale).
        const overviewHref = sectionSlug
          ? `/${brandKey}/${sectionSlug}/index.html`
          : `/${brandKey}/index.html`;
        const mdPath = `${navBase}${BRANDS_REL}/${brandKey}/${filename}`;
        pageSubbar = `<div class="sticky-bar sticky-bar-page">
          <div class="sticky-bar-container">
            <div class="sticky-bar-content">
              <nav class="sticky-bar-breadcrumbs" aria-label="Breadcrumb">
                <a href="${overviewHref}">${sectionLabel}</a>
                <span class="breadcrumb-separator">/</span>
                <span>${title}</span>
              </nav>
            </div>
            <div class="sticky-bar-actions">
              <div class="dropdown">
                <button class="dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Markdown source options">
                  ${getIcon('more-horizontal')}
                </button>
                <div class="dropdown-menu is-right">
                  <button type="button" class="dropdown-item js-copy-url" aria-label="Copy page link to clipboard">
                    ${getIcon('link')}
                    <span>Copy link</span>
                  </button>
                  <div data-auth-role="team">
                    <div class="dropdown-divider"></div>
                    <a href="${mdPath}" class="dropdown-item js-md-download" download>
                      ${getIcon('download')}
                      <span>Download .md file</span>
                    </a>
                    <div class="dropdown-divider"></div>
                    <a href="${mdPath}" class="dropdown-item js-md-open" target="_blank" rel="noopener noreferrer">
                      ${getIcon('open-full')}
                      <span>Open .md in new tab</span>
                    </a>
                  </div>
                </div>
              </div>
              <a href="${overviewHref}" class="sticky-bar-close" aria-label="Close ${title}">
                ${getIcon('close-large')}
              </a>
            </div>
          </div>
        </div>`;
      }

      // Build brand-specific template
      const brandCss = PROJECT_CONFIG.brandCssPath
        ? `<link rel="stylesheet" href="${navBase}${PROJECT_CONFIG.brandCssPath}">`
        : '';
      const brandThemeCss = `<!-- Brand Theme Override (must load last to override base styles) -->\n    <link rel="stylesheet" href="${sectionSlug ? '../' : ''}assets/theme.css">`;

      let html = template
        .replaceAll('{{PAGE_TITLE}}', `${theme.label} - ${title}`)
        .replaceAll('{{META_DESCRIPTION}}', frontmatter.description || '')
        .replace('{{PAGE_HEADER}}', pageHeader)
        .replace('{{PAGE_STICKY_BAR}}', pageSubbar)
        .replace('{{PAGE_CONTENT}}', htmlContent)
        .replace('{{TOC_SECTION}}', tableOfContents
          ? `<aside class="docs-toc"><span class="toc-header">On this page</span><div class="toc-wrapper">${tableOfContents}</div></aside>`
          : '')
        .replace('{{DESIGN_SYSTEM_PATH}}', navBase + PROJECT_CONFIG.designSystemPath)
        .replace('{{BRAND_CSS}}', brandCss)
        .replace('{{BRAND_THEME_CSS}}', brandThemeCss)
        .replace('{{BRAND_THEME_ATTR}}', `data-brand-theme="${brandKey}"`)
        .replace('{{FONT_HEAD}}', fontHeadHtml(theme.manifest, navBase))
        .replace('{{PAGE_SCRIPTS}}', buildPageScripts(frontmatter.section || '', frontmatter, navBase))
        .replace('{{FOOTER_TEXT}}', buildFooterHtml(theme.manifest.footerText))
        .replace('{{FAVICON_SVG}}', brandChromeSlots(theme.manifest, navBase).faviconSvg)
        .replace('{{FAVICON_ICO}}', brandChromeSlots(theme.manifest, navBase).faviconIco)
        .replace('{{OG_IMAGE}}', brandChromeSlots(theme.manifest, navBase).ogImage)
        .replace('{{PAGE_ACCESS}}', deriveDataAccess(frontmatter))
        .replace('{{SECTION_SLUG}}', `${brandKey}-${slugifySection(frontmatter.section)}`)
        .replace('{{PAGE_SECTION}}', `${brandKey}-${slugifySection(frontmatter.section)}`)
        .replace('{{PAGE_ORDER}}', String(parseInt(frontmatter.order, 10) || 999))
        .replace('{{PAGE_LEVEL}}', '2')
        .replaceAll('{{NAV_BASE}}', navBase);

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
      const finalHtml = file.html.replace('{{PAGE_NAV}}', pageNav);

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
    const navBase = '../';
    const brandCss = PROJECT_CONFIG.brandCssPath
      ? `<link rel="stylesheet" href="${navBase}${PROJECT_CONFIG.brandCssPath}">`
      : '';
    const brandThemeCss = `<!-- Brand Theme Override (must load last to override base styles) -->\n    <link rel="stylesheet" href="assets/theme.css">`;

    const dir = path.join(OUTPUT_DIR, brandKey);
    fs.mkdirSync(dir, { recursive: true });

    // Helper to build a brand overview page
    function buildOverviewPage(title, cardsHtml, overrideNavBase) {
      const base = overrideNavBase || navBase;
      const content = `<div class="docs-hero"><h1 class="docs-hero-title">${title}</h1></div>${cardsHtml}`;
      // Per-brand section order — used by the level-based directional
      // transitions for L1 → L1 sibling navigation within a brand space.
      // Docs comes first, then Tools, matching their order in the brand
      // sidebar. New brand sections would extend this map.
      const brandSectionOrder = { 'Docs': 0, 'Tools': 1, 'Brand Book': 2 };
      const overviewOrder = brandSectionOrder[title] !== undefined ? brandSectionOrder[title] : 999;
      return template
        .replace(/\{\{PAGE_TITLE\}\}/g, `${brandLabel} - ${title}`)
        .replace(/\{\{META_DESCRIPTION\}\}/g, `${title} overview for ${brandLabel}.`)
        .replace(/\{\{NAV_BASE\}\}/g, base)
        .replace(/\{\{PAGE_ACCESS\}\}/g, deriveDataAccess(loadDefaults(path.join(DOCS_DIR, 'brands', brandKey))))
        .replace('{{PAGE_HEADER}}', '')
        .replace('{{PAGE_STICKY_BAR}}', '')
        .replace('{{PAGE_CONTENT}}', content)
        .replace('{{TOC_SECTION}}', '')
        .replace('{{PAGE_NAV}}', '')
        .replace('{{FOOTER_TEXT}}', buildFooterHtml(theme.manifest.footerText))
        .replace('{{FAVICON_SVG}}', brandChromeSlots(theme.manifest, base).faviconSvg)
        .replace('{{FAVICON_ICO}}', brandChromeSlots(theme.manifest, base).faviconIco)
        .replace('{{OG_IMAGE}}', brandChromeSlots(theme.manifest, base).ogImage)
        .replace('{{DESIGN_SYSTEM_PATH}}', base + PROJECT_CONFIG.designSystemPath)
        .replace('{{BRAND_CSS}}', PROJECT_CONFIG.brandCssPath ? `<link rel="stylesheet" href="${base}${PROJECT_CONFIG.brandCssPath}">` : '')
        .replace('{{BRAND_THEME_CSS}}', `<!-- Brand Theme Override (must load last to override base styles) -->\n    <link rel="stylesheet" href="${base === '../../' ? '../' : ''}assets/theme.css">`)
        .replace('{{BRAND_THEME_ATTR}}', `data-brand-theme="${brandKey}"`)
        .replace('{{FONT_HEAD}}', fontHeadHtml(theme.manifest, base))
        .replace('{{SECTION_SLUG}}', `${brandKey}-${slugifySection(title)}-overview`)
        .replace('{{PAGE_SECTION}}', `${brandKey}-${slugifySection(title)}`)
        .replace('{{PAGE_ORDER}}', String(overviewOrder))
        .replace('{{PAGE_LEVEL}}', '1')
        .replace('{{PAGE_SCRIPTS}}', '');
    }

    // Docs overview — cards for all pages in the Docs section
    const docsPages = (theme.pages || []).filter(p => p.section === 'Docs' && p.title !== 'Overview');
    if (docsPages.length > 0) {
      let cards = '<div class="docs-section"><div class="grid cols-2 gap-xl">';
      for (const page of docsPages) {
        // page.href is already absolute (`/<brand>/docs/<file>.html`).
        cards += renderBookCover({
          href: page.href,
          title: page.title,
          subtitle: page.subtitle,
          author: page.author,
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
      let cards = '<div class="docs-section"><div class="grid cols-2 gap-xl">';
      for (const toolKey of brandToolKeys) {
        const tool = toolRegistry[toolKey];
        cards += renderBookCover({
          href: `/tools/${toolKey}.html`,
          title: tool.title,
          subtitle: tool.subtitle,
          author: tool.author,
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
    const brandBookPageHeader = `<div class="page-header">
      <div class="container-s">
        <p class="eyebrow">${brandLabel}</p>
        <h1 data-flip-id="brand-book">${pageTitle}</h1>
        <p class="page-subtitle" data-text-wrap="pretty">${pageSubtitle}</p>
      </div>
    </div>`;

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
          <h3 style="margin: 0;">${title}</h3>
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
    contentHtml += `<section class="brand-book-section block gap-l">
      <article class="block gap-l">
        <header class="block gap-m">
          <p class="eyebrow" style="margin: 0;">Field notes</p>
          <h1 style="margin: 0;">Your Primary Headline, Big, Bold, and Unmissable</h1>
          <p class="text-size-xlarge" style="margin: 0;">This lead paragraph demonstrates how introductory body text will look across your layout, used to set the tone for the body that follows and draw the reader in.</p>
        </header>

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
      <div class="grid cols-3 gap-l">
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
    const brandCss = PROJECT_CONFIG.brandCssPath
      ? `<link rel="stylesheet" href="${navBase}${PROJECT_CONFIG.brandCssPath}">`
      : '';
    const brandThemeCss = `<!-- Brand Theme Override (must load last to override base styles) -->\n    <link rel="stylesheet" href="assets/theme.css">`;

    // Brand book uses the standard .copy-btn pattern (handled by copy-button.js)
    // and native <a download> for downloads — no inline script needed.

    let html = template
      .replace(/\{\{PAGE_TITLE\}\}/g, `${brandLabel} - ${pageTitle}`)
      .replace(/\{\{META_DESCRIPTION\}\}/g, pageDescription)
      .replace(/\{\{NAV_BASE\}\}/g, navBase)
      .replace(/\{\{PAGE_ACCESS\}\}/g, deriveDataAccess(frontmatter))
      .replace('{{PAGE_HEADER}}', brandBookPageHeader)
      .replace('{{PAGE_STICKY_BAR}}', '')
      .replace('{{PAGE_CONTENT}}', contentHtml)
      .replace('{{TOC_SECTION}}', '')
      .replace('{{PAGE_NAV}}', '')
      .replace('{{FOOTER_TEXT}}', buildFooterHtml(theme.manifest.footerText))
      .replace('{{FAVICON_SVG}}', brandChromeSlots(theme.manifest, navBase).faviconSvg)
      .replace('{{FAVICON_ICO}}', brandChromeSlots(theme.manifest, navBase).faviconIco)
      .replace('{{OG_IMAGE}}', brandChromeSlots(theme.manifest, navBase).ogImage)
      .replace('{{DESIGN_SYSTEM_PATH}}', navBase + PROJECT_CONFIG.designSystemPath)
      .replace('{{BRAND_CSS}}', brandCss)
      .replace('{{BRAND_THEME_CSS}}', brandThemeCss)
      .replace('{{BRAND_THEME_ATTR}}', `data-brand-theme="${brandKey}"`)
      .replace('{{FONT_HEAD}}', fontHeadHtml(theme.manifest, navBase))
      .replace('{{PAGE_SCRIPTS}}', '')
      .replace('{{SECTION_SLUG}}', `${brandKey}-brand-book`)
      .replace('{{PAGE_SECTION}}', `${brandKey}-brand-book`)
      // Brand book is at order 2 in the per-brand section ordering
      // (Docs=0, Tools=1, Brand Book=2) — see buildOverviewPage above.
      .replace('{{PAGE_ORDER}}', '2')
      .replace('{{PAGE_LEVEL}}', '1');

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

    // Hero section
    const brandLabel = theme.label || brandKey;
    const brandDesc = theme.description || `Brand guidelines and tools for ${brandLabel}.`;
    contentHtml += `<div class="docs-hero">
      <h1 class="docs-hero-title">${brandLabel}</h1>
      <p class="docs-hero-description" data-text-wrap="balance">${brandDesc}</p>
    </div>`;

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
      <h2 class="eyebrow">${section}</h2>
      <div class="grid cols-2 gap-xl">`;
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
      <h2 class="eyebrow">Tools</h2>
      <div class="grid cols-2 gap-xl">`;
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
    const dsPath = navBase + PROJECT_CONFIG.designSystemPath;
    const brandCss = PROJECT_CONFIG.brandCssPath
      ? `<link rel="stylesheet" href="${navBase}${PROJECT_CONFIG.brandCssPath}">`
      : '';
    const brandThemeCss = `<!-- Brand Theme Override (must load last to override base styles) -->\n    <link rel="stylesheet" href="assets/theme.css">`;

    let html = template
      .replace(/\{\{PAGE_TITLE\}\}/g, `${brandLabel} - Brand Guidelines`)
      .replace(/\{\{META_DESCRIPTION\}\}/g, brandDesc)
      .replace(/\{\{NAV_BASE\}\}/g, navBase)
      .replace(/\{\{PAGE_ACCESS\}\}/g, deriveDataAccess(loadDefaults(path.join(DOCS_DIR, 'brands', brandKey))))
      .replace('{{PAGE_HEADER}}', '')
      .replace('{{PAGE_STICKY_BAR}}', '')
      .replace('{{PAGE_CONTENT}}', contentHtml)
      .replace('{{TOC_SECTION}}', '')
      .replace('{{PAGE_NAV}}', '')
      .replace('{{FOOTER_TEXT}}', buildFooterHtml(theme.manifest.footerText))
      .replace('{{FAVICON_SVG}}', brandChromeSlots(theme.manifest, navBase).faviconSvg)
      .replace('{{FAVICON_ICO}}', brandChromeSlots(theme.manifest, navBase).faviconIco)
      .replace('{{OG_IMAGE}}', brandChromeSlots(theme.manifest, navBase).ogImage)
      .replace(`<link rel="stylesheet" href="${dsPath}" id="design-system-css"`, `<link rel="stylesheet" href="${navBase}${PROJECT_CONFIG.designSystemPath}" id="design-system-css"`)
      .replace('{{BRAND_CSS}}', brandCss)
      .replace('{{BRAND_THEME_CSS}}', brandThemeCss)
      .replace('{{BRAND_THEME_ATTR}}', `data-brand-theme="${brandKey}"`)
      .replace('{{FONT_HEAD}}', fontHeadHtml(theme.manifest, navBase))
      .replace('{{SECTION_SLUG}}', `${brandKey}-home`)
      .replace('{{PAGE_SECTION}}', `${brandKey}-home`)
      .replace('{{PAGE_ORDER}}', '0')
      .replace('{{PAGE_LEVEL}}', '0')
      .replace('{{PAGE_SCRIPTS}}', '');

    // Replace design system path placeholder
    html = html.replace('{{DESIGN_SYSTEM_PATH}}', navBase + PROJECT_CONFIG.designSystemPath);

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
    uiScripts = ['assets/docs-kit/copy-button.js', 'assets/docs-kit/dropdown.js'];
    copyKitAsset('js/copy-button.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'copy-button.js'));
    copyKitAsset('js/dropdown.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'dropdown.js'));
  }

  // All configured paths are site-root-relative; the {{NAV_BASE}} prefix
  // resolves them per page depth. Absolute URLs pass through untouched.
  const nav = (p) => prefixHref('{{NAV_BASE}}', p);
  const styleLinks = CONFIG.extraStylesheets.map(href => `<link rel="stylesheet" href="${nav(href)}">`).join('\n    ');
  const uiScriptTags = uiScripts.map(src => `<script src="${nav(src)}" defer></script>`).join('\n    ');
  const extraScriptTags = CONFIG.extraScripts.map(src => `<script src="${nav(src)}" defer></script>`).join('\n    ');
  const highlightTag = `<script src="${nav(CONFIG.highlightJs)}"></script>`;

  return rawTemplate
    .replaceAll('{{CONFIG_PATH}}', `${path.basename(DOCS_DIR)}/docs.config.js`)
    .replace('{{DOCS_CSS}}', () => `<link rel="stylesheet" href="${docsCssHref}">`)
    .replace('{{EXTRA_STYLESHEETS}}', () => styleLinks)
    .replace('{{EXTRA_HEAD}}', () => CONFIG.extraHeadHtml.trimEnd())
    .replace('{{BODY_ATTRS}}', () => CONFIG.bodyAttrs)
    .replace('{{WRAPPER_ATTRS}}', () => CONFIG.wrapperAttrs)
    .replace('{{CONTAINER_ATTRS}}', () => CONFIG.containerAttrs)
    .replace('{{EXTRA_CONTENT}}', () => CONFIG.extraContentHtml.trimEnd())
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
  const layerErrors = [];

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

    if (!filesBySection[section]) {
      filesBySection[section] = [];
    }
    filesBySection[section].push(file);
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

  // Always regenerate nav.js (sidebar needs to stay current)
  const navJs = generateNavJs(filesBySection, sidebarOrderMap);
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
