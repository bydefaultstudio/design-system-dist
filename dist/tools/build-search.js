#!/usr/bin/env node
/**
 * build-search.js — Build the site search indexes from the assembled site.
 *
 * Runs as the LAST build:site step, after tools/build-site.js has copied the
 * public allowlist into _site/. It reads ONLY that directory and writes ONLY
 * <site>/search-index/ and <site>/pagefind/, so it can index nothing the site
 * does not already ship — the allowlist is what keeps CLAUDE.md, handovers/
 * and ROADMAP.md off the site, and an indexer pointed at the repo root would
 * fold them into a greppable JSON file.
 *
 * Neither index lives under assets/. worker/gate.mjs serves /assets/ to
 * anyone, signed in or not, and these files hold the text of every gated
 * page. At the site root they are gated exactly like the pages they describe,
 * and pagefind/ is where Pagefind's client expects its own bundle, so it
 * derives the site root unaided. refusePublicOut() asks the gate before a
 * byte is written, so a public prefix added later cannot quietly expose them.
 *
 * Two indexes, one UI:
 *   search-index/symbols.json   names people search for exactly — tokens,
 *                               classes, icons, glossary terms, page titles.
 *                               Small, matched client-side by prefix, on
 *                               screen from the first keystroke.
 *   pagefind/                   full-text over page body copy with
 *                               per-heading sub-results. Built by Pagefind
 *                               (decided 2026-09-08, PROJECT_PROGRESS.md).
 *
 * What is indexed is decided by the generator, not here. A page is in when its
 * <main> carries data-pagefind-body (engine pages; brand instances, examples/
 * and `search: "false"` pages do not get it) and chrome inside it is marked
 * data-pagefind-ignore. Pagefind reads those same attributes, so the two
 * indexes cannot disagree about what a page is.
 *
 * Usage:
 *   node tools/build-search.js                        # _site → _site/{search-index,pagefind}
 *   node tools/build-search.js --out /path/elsewhere  # both dirs under elsewhere, still reads _site
 *
 * There is deliberately no way to point --site at the repo root. Assemble the
 * site first (npm run build:site); the allowlist is what makes the output safe.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { JSDOM } = require('jsdom');
// Run from this repo (tools/build-search.js) or from the package as
// `npx bd-search` (dist/tools/build-search.js, engine parity C1). The
// generator's modules sit in cms/generator/ here and in docs-kit/ there, and
// a site's files are under the directory the command runs in.
const IN_REPO = fs.existsSync(path.join(__dirname, '..', 'cms', 'generator', 'design-tokens.js'));
const GENERATOR = IN_REPO ? path.join(__dirname, '..', 'cms', 'generator') : path.join(__dirname, '..', 'docs-kit');
const { extractTokensAndClasses, assertBannersMatched } = require(path.join(GENERATOR, 'design-tokens'));
const { readIconAliases } = require(path.join(GENERATOR, 'icon-aliases'));
const { loadFormats } = require(path.join(GENERATOR, 'formats'));

const ROOT = IN_REPO ? path.join(__dirname, '..') : process.cwd();

/* ------ Arguments ------ */

function parseArgs(argv) {
  const args = { site: '_site', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--site' || a === '--out') {
      const value = argv[++i];
      if (!value) {
        console.error(`${a} needs a path`);
        process.exit(2);
      }
      args[a === '--site' ? 'site' : 'out'] = value;
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  args.site = path.resolve(ROOT, args.site);
  // The site root: the bundle lands at /pagefind/, where Pagefind's client
  // expects it, and neither index sits under the public /assets/ prefix.
  args.out = args.out ? path.resolve(ROOT, args.out) : args.site;
  return args;
}

/* ------ Guards ------ */

// The one way to leak internal docs is to point --site at the repo root.
// CLAUDE.md never ships, so its presence in the source dir is the tell. There
// is no override: a root walk also sweeps node_modules/, templates/ and a
// stale _site/ copy, so nothing it produced would resemble production anyway.
function refuseRepoRoot(site) {
  if (fs.existsSync(path.join(site, 'CLAUDE.md'))) {
    console.error(
      `\n  ${path.relative(ROOT, site) || '.'} contains CLAUDE.md, so it is the repo root,` +
      `\n  not an assembled site. Refusing to index it. Run npm run build:site first.\n`
    );
    process.exit(1);
  }
}

// The indexes carry the text of every gated page, so they must land on a
// path the gate protects. Ask the gate itself rather than restating its list:
// worker/gate.mjs is pure and importable from node, so a public prefix added
// there later is caught here, at build time, before anything is written.
// Only meaningful when the output sits inside the site; --out elsewhere is
// for inspection and is never served.
async function refusePublicOut(site, out) {
  const rel = path.relative(site, out);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return;
  const { isPublicPath } = await import('../worker/gate.mjs');
  // Judged with this site's public lists, as the deployed Worker judges them:
  // the gate alone knows only the engine's own. A site's worker/site-config.mjs
  // configures itself (configureThisSite) or exports its options; a site with
  // neither is judged on the engine's lists, which already keep these paths
  // gated.
  const siteConfig = path.join(ROOT, 'worker', 'site-config.mjs');
  if (fs.existsSync(siteConfig)) {
    const config = await import(require('url').pathToFileURL(siteConfig).href);
    if (typeof config.configureThisSite === 'function') config.configureThisSite();
    else if (config.SITE_OPTIONS) (await import('../worker/site.mjs')).configureSite(config.SITE_OPTIONS);
    else {
      console.error(`\n  ${path.relative(ROOT, siteConfig)} exports neither configureThisSite nor SITE_OPTIONS, so the` +
        `\n  indexes can't be checked against the site's public paths. Refusing.\n`);
      process.exit(1);
    }
  } else {
    console.warn('  No worker/site-config.mjs here: the indexes are checked against the engine\'s public paths only.' +
      '\n  Run bd-search from the site root, and keep /pagefind/ and /search-index/ out of the site\'s public lists.');
  }
  const base = rel ? '/' + rel.split(path.sep).join('/') : '';
  for (const url of [`${base}/${SYMBOLS_DIR}/symbols.json`, `${base}/${PAGEFIND_DIR}/pagefind.js`]) {
    if (!isPublicPath(url)) continue;
    console.error(
      `\n  ${url} is public (worker/gate.mjs). The search indexes hold the text of` +
      `\n  every gated page, so they are written only where the gate applies. Refusing.\n`
    );
    process.exit(1);
  }
}

/* ------ Site walk ------ */

// Where each index lands, relative to --out. Named once so the guard above,
// the walk below and the two writers cannot drift apart.
const SYMBOLS_DIR = 'search-index';
const PAGEFIND_DIR = 'pagefind';

// Directories that hold no pages. Not an exclusion policy — that is the
// data-pagefind-body attribute — just parse time saved on images and bundles.
// The two index dirs are this script's own output from an earlier run.
const NON_PAGE_DIRS = new Set(['assets', 'cdn', SYMBOLS_DIR, PAGEFIND_DIR]);

function walkHtml(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === base && NON_PAGE_DIRS.has(entry.name)) continue;
      walkHtml(abs, base, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

/* ------ Page extraction ------ */

// The three forms a name is written in across the docs, measured on the built
// site: `<code>var(--x)</code>` (1099), `<code>--x</code>` (577),
// `<code>.x</code>` (1261). Colour rows carry theirs as `data-token="--x"`
// (103) instead, which is why mentions are gathered before chrome is stripped.
const SYMBOL_RE = /^(?:var\(\s*(--[a-z0-9-]+)\s*\)|(--[a-z0-9-]+)|(\.[a-z][a-z0-9-]*))$/;

function symbolInText(text) {
  const m = text.match(SYMBOL_RE);
  return m ? (m[1] || m[2] || m[3]) : null;
}

function normaliseSpace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Directory indexes are addressed as directories, matching what Pagefind
// emits and what clean URLs will make canonical (cms-plan.md decision 26).
function canonicalUrl(rel) {
  return '/' + rel.replace(/(^|\/)index\.html$/, '$1');
}

/**
 * Read one page. Returns null when the page is not marked for search.
 * `mentions` is filled with every <code> holding exactly one token or class
 * name, keyed by name, with the id of the nearest heading above it — the
 * reverse index that tells a symbol where it is documented.
 */
function extractPage(site, rel, mentions) {
  const html = fs.readFileSync(path.join(site, rel), 'utf8');
  // Cheap string test before the expensive parse: 27 of 151 files are not
  // marked for search, and parsing them only to discard them is wasted work.
  if (!html.includes('data-pagefind-body')) return null;

  const { document } = new JSDOM(html).window;
  const { NodeFilter } = document.defaultView;

  const body = document.querySelector('[data-pagefind-body]');
  if (!body) return null;
  // A page above team never enters an index every team reader can fetch
  // (security audit, 2026-11-08, finding 2). The generator already leaves
  // the attribute off; this refuses the build if anything puts it back.
  const pageAccess = document.body && document.body.getAttribute('data-access');
  if (pageAccess === 'admin' || pageAccess === 'owner') {
    throw new Error(`${rel} is an ${pageAccess} page marked for search; its text would reach every team reader`);
  }

  const container = document.querySelector('[data-barba="container"]');
  const sectionMeta = document.querySelector('meta[data-pagefind-filter^="section"]');
  const titleEl = document.querySelector('title');
  const descEl = document.querySelector('meta[name="description"]');
  const url = canonicalUrl(rel);
  const level = container ? parseInt(container.getAttribute('data-level'), 10) : 2;

  // One walk: element ids (so symbol anchors can be verified before they ship)
  // and symbol mentions tagged with the heading above them. Prose is Pagefind's
  // job — this walk exists only to learn where each name is documented.
  //
  // Mentions are read from the whole page including regions marked
  // data-pagefind-ignore, because a colour swatch list is chrome to a prose
  // index and is exactly where colour tokens are documented. Navigation is the
  // one exclusion: a table of contents repeats a heading, it does not document it.
  const ids = new Set();
  let anchor = '';
  let heading = '';
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walk.nextNode())) {
    if (node.id) ids.add(node.id);
    if (/^H[1-4]$/.test(node.tagName) && node.id) {
      anchor = node.id;
      heading = normaliseSpace(node.textContent);
    }

    let name = null;
    if (node.tagName === 'CODE' && node.children.length === 0) name = symbolInText(normaliseSpace(node.textContent));
    else if (node.hasAttribute('data-token')) name = symbolInText(node.getAttribute('data-token').trim());
    if (!name || node.closest('nav')) continue;

    if (!mentions.has(name)) mentions.set(name, []);
    mentions.get(name).push({ url, anchor, heading, level, inHeading: !!node.closest('h1, h2, h3, h4') });
  }

  return {
    url,
    title: titleEl ? normaliseSpace(titleEl.textContent) : rel,
    description: descEl ? normaliseSpace(descEl.getAttribute('content') || '') : '',
    // The human label the generator wrote for Pagefind's filter; '' on root pages.
    section: sectionMeta ? normaliseSpace(sectionMeta.getAttribute('content') || '') : '',
    level,
    // Emitted on every generated page (docs.config.js bodyAttrs). Carried so
    // the public index can be filtered to the public subset once sections are
    // gated (cms-plan.md conflict 15) without changing the index shape.
    access: document.body.getAttribute('data-access') || '',
    ids,
  };
}

// Titles are "<Page> - <Site name>". The site name is whichever " - <tail>"
// most titles share, so no brand string is hardcoded here. The home page's
// title is the bare site name, which is why this is a vote, not a common suffix.
function commonTitleSuffix(titles) {
  const votes = new Map();
  for (const t of titles) {
    const m = t.match(/\s[-|–—]\s[^-|–—]+$/);
    if (m) votes.set(m[0], (votes.get(m[0]) || 0) + 1);
  }
  let best = '';
  for (const [tail, n] of votes) if (n > (votes.get(best) || 0)) best = tail;
  return (votes.get(best) || 0) > titles.length / 2 ? best : '';
}

/* ------ Where a symbol is documented ------ */

// How many distinct symbols each page writes. A reference page names hundreds;
// a page quoting one in passing names a handful. This is what separates
// "documented here" from "mentioned here", with no list of privileged pages.
function referenceDensity(mentions) {
  const density = new Map();
  for (const list of mentions.values()) {
    for (const url of new Set(list.map((m) => m.url))) {
      density.set(url, (density.get(url) || 0) + 1);
    }
  }
  return density;
}

// Where a name is documented, decided by the pages themselves. Ranked by how
// often the page writes it, then whether it writes it in a heading, then how
// many other symbols that page documents, then leaf-over-index, and finally by
// url so the result is reproducible across filesystems rather than settled by
// directory walk order.
//
// The density term is what sends `--green` to tokens.html rather than to the
// glossary, which quotes it twice inside a definition of the word "token".
// Words a symbol name and a heading share. `--text-primary` under "Text
// Colors" shares "text"; under "Form" it shares nothing. Sections often tie on
// mention count — both write `var(--text-primary)` three times — and this is
// the difference between landing on the section that explains the token and one
// that merely uses it.
function nameOverlap(name, heading) {
  if (!heading) return 0;
  const parts = new Set(name.replace(/^--|^\./, '').split('-').filter((w) => w.length > 2));
  const words = new Set(heading.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let shared = 0;
  for (const p of parts) if (words.has(p) || words.has(p + 's')) shared += 1;
  return shared;
}

function documentedAt(name, mentions, density) {
  const list = mentions.get(name);
  if (!list) return null;
  const byUrl = new Map();
  for (const m of list) {
    const e = byUrl.get(m.url) || { url: m.url, level: m.level, count: 0, heading: false, anchors: new Map() };
    e.count += 1;
    if (m.inHeading) e.heading = true;
    // Count mentions per section, not just the first: a token named once in
    // passing under one heading and six times under another is documented
    // under the second. Taking the first anchor sent --radius-xs to #skeleton.
    if (m.anchor) {
      const weight = (m.inHeading ? 2 : 1) + nameOverlap(name, m.heading);
      e.anchors.set(m.anchor, (e.anchors.get(m.anchor) || 0) + weight);
    }
    byUrl.set(m.url, e);
  }
  for (const e of byUrl.values()) {
    e.anchor = [...e.anchors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a)[0] || '';
  }
  const best = [...byUrl.values()].sort((a, b) =>
    b.count - a.count ||
    (b.heading ? 1 : 0) - (a.heading ? 1 : 0) ||
    (density.get(b.url) || 0) - (density.get(a.url) || 0) ||
    b.level - a.level ||
    a.url.localeCompare(b.url)
  )[0];
  return best.anchor ? `${best.url}#${best.anchor}` : best.url;
}

// A name no page writes in a <code> still has to land somewhere. Two fallbacks,
// in order of how much they actually know:
//
//   1. Its family. `--headline-weight` is undocumented but `--headline-size` is
//      on typography.html, so the family has a home and the sibling inherits it.
//      This is inference from the docs, not from a hand-written rule, so it
//      cannot drift as pages move.
//   2. Its component page, if one exists by name (`--dialog-*` → dialog.html).
//
// Anything left over goes to the index page for its kind. The build reports
// how many needed each, which is the signal that a token is undocumented.
function familyOf(name) {
  const parts = name.replace(/^--|^\./, '').split('-');
  return parts.length > 1 ? parts[0] : null;
}

// family → the page most of its documented members live on.
function buildFamilyMap(entries, mentions, density, resolve) {
  const votes = new Map();
  for (const e of entries) {
    const url = resolve(e.n, mentions, density);
    const family = familyOf(e.n);
    if (!url || !family) continue;
    if (!votes.has(family)) votes.set(family, new Map());
    const byUrl = votes.get(family);
    const bare = url.split('#')[0];
    byUrl.set(bare, (byUrl.get(bare) || 0) + 1);
  }
  const map = new Map();
  for (const [family, byUrl] of votes) {
    map.set(family, [...byUrl.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return map;
}

function componentPage(name, pages) {
  const parts = name.replace(/^--|^\./, '').split('-');
  for (const len of [2, 1]) {
    if (parts.length < len) continue;
    // A name's page is a component (components/, web/ before 2026-11-12) or,
    // since the 2026-10-08 restructure, a foundation (foundations/): border,
    // motion, spacing.
    for (const folder of ['components', 'web', 'foundations']) {
      const url = `/${folder}/${parts.slice(0, len).join('-')}.html`;
      if (pages.has(url)) return url;
    }
  }
  return null;
}

function fallbackUrl(name, pages, familyMap, indexPage) {
  return familyMap.get(familyOf(name)) || componentPage(name, pages) || indexPage;
}

/* ------ Icons and glossary terms ------ */

function extractIcons(site) {
  const dir = path.join(site, 'assets', 'images', 'svg-icons');
  if (!fs.existsSync(dir)) return [];
  const hidden = readIconAliases({ rootDir: ROOT, iconsDir: dir, surface: 'site search' });
  return fs.readdirSync(dir)
    // Underscore-prefixed files are drafts: the sprite skips them and the
    // registry hides them, so search must not offer them either.
    .filter((f) => f.endsWith('.svg') && !f.startsWith('_'))
    .map((f) => f.replace(/\.svg$/, ''))
    .filter((n) => !hidden.has(n.toLowerCase()))
    .sort()
    .map((n) => ({ n }));
}

// Each glossary card is a whole-card link to its entry page, written
// root-relative by the generator; a relative href is made root-relative in
// case a kit consumer builds with a different base.
function entryUrl(el) {
  const href = el.getAttribute('href');
  if (!href) return null;
  return href.startsWith('/') ? href : `/${href}`;
}

function extractTerms(site) {
  const file = path.join(site, 'glossary.html');
  if (!fs.existsSync(file)) return [];
  const { document } = new JSDOM(fs.readFileSync(file, 'utf8')).window;
  return [...document.querySelectorAll('[data-glossary-term][id]')].map((el) => {
    const title = el.querySelector('.book-contents-item-title');
    const desc = el.querySelector('.book-contents-item-description');
    return {
      n: title ? normaliseSpace(title.textContent) : el.id,
      d: desc ? normaliseSpace(desc.textContent) : '',
      // A term with its own entry page links there; the card anchor is the
      // fallback for a term the index carries without one.
      u: entryUrl(el) || `/glossary.html#${el.id}`,
    };
  });
}

/* ------ Assembly ------ */

// Every format in the registry, opened in the Format Library by its address
// (decision 6: /tools/formats.html?format=<platform>/<id>). Named with the
// platform, so "story" finds Instagram's and TikTok's alike, and "instagram"
// lists every one. The meta line is the size and ratio a reader checks.
function extractFormats() {
  const { platforms, errors } = loadFormats(ROOT);
  if (errors.length) throw new Error(`build-search: the format registry is invalid — ${errors[0]}`);
  return platforms.flatMap((platform) => platform.formats.map((format) => ({
    n: `${platform.label} ${format.name}`,
    d: `${format.canvas.w} × ${format.canvas.h} px, ${format.canvas.ratio}`,
    u: `/tools/formats.html?format=${format.id}`,
  })));
}

function withVerifiedAnchor(url, pagesByUrl) {
  const [pathPart, anchor] = url.split('#');
  if (!anchor) return url;
  const page = pagesByUrl.get(pathPart);
  return page && page.ids.has(anchor) ? url : pathPart;
}

function kb(str) {
  return `${(Buffer.byteLength(str) / 1024).toFixed(0)} KB raw, ${(zlib.gzipSync(str).length / 1024).toFixed(0)} KB gzip`;
}

function buildSymbols(site, out) {
  const mentions = new Map();
  const pages = walkHtml(site).map((rel) => extractPage(site, rel, mentions)).filter(Boolean);
  const pagesByUrl = new Map(pages.map((p) => [p.url, p]));
  const suffix = commonTitleSuffix(pages.map((p) => p.title));
  pages.forEach((p) => { p.title = suffix && p.title.endsWith(suffix) ? p.title.slice(0, -suffix.length) : p.title; });

  const cssPath = path.join(site, 'assets', 'css', 'design-system.css');
  const parsed = extractTokensAndClasses(fs.readFileSync(cssPath, 'utf8'));
  // A banner that stops parsing hands its section label to every symbol below
  // it, and nothing downstream would notice. Fail the build instead.
  assertBannersMatched(parsed, path.relative(ROOT, cssPath));
  const { tokens, classes } = parsed;

  // Tokens and classes vote separately: `--font-code` must not inherit the page
  // that `.font-*` classes live on. Same family name, different kind of thing.
  const density = referenceDensity(mentions);
  const familyMaps = {
    token: buildFamilyMap(tokens, mentions, density, documentedAt),
    class: buildFamilyMap(classes, mentions, density, documentedAt),
  };
  const undocumented = { token: [], class: [] };
  const link = (entry, type, indexPage) => {
    const found = documentedAt(entry.n, mentions, density);
    if (found) return found;
    undocumented[type].push(entry.n);
    return fallbackUrl(entry.n, pagesByUrl, familyMaps[type], indexPage);
  };

  // A reference page the site lacks (a client has no foundations/) sends the
  // reader to the search page for that name instead of to a 404
  const orSearch = (url, name) => (pagesByUrl.has(url.split('#')[0]) ? url : `/search.html?q=${encodeURIComponent(name)}`);
  const registryPage = '/foundations/iconography.html#registry';
  const registryUrl = (name) => orSearch(withVerifiedAnchor(registryPage, pagesByUrl), name);

  // No token value is shipped: design-system.css holds engine defaults and the
  // instance's theme.css overrides them. The UI resolves the live value with
  // getComputedStyle at render time, which is always the instance's.
  const symbols = [
    ...tokens.map((t) => ({ t: 'token', n: t.n, d: t.d, u: orSearch(link(t, 'token', '/foundations/tokens.html'), t.n) })),
    ...classes.map((c) => ({ t: 'class', n: c.n, d: c.d, u: orSearch(link(c, 'class', '/foundations/classes.html'), c.n) })),
    ...extractIcons(site).map((i) => ({ t: 'icon', n: i.n, u: registryUrl(i.n) })),
    ...extractTerms(site).map((g) => ({ t: 'term', n: g.n, d: g.d, u: withVerifiedAnchor(g.u, pagesByUrl) })),
    ...extractFormats().map((f) => ({ t: 'format', n: f.n, d: f.d, u: f.u })),
    ...pages.map((p) => ({ t: 'page', n: p.title, d: p.description, u: p.url, s: p.section, l: p.level, a: p.access })),
  ];

  const dir = path.join(out, SYMBOLS_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(symbols);
  fs.writeFileSync(path.join(dir, 'symbols.json'), json);

  const counts = symbols.reduce((acc, s) => ((acc[s.t] = (acc[s.t] || 0) + 1), acc), {});
  console.log(`symbols.json  ${kb(json)}`);
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  sections: ${[...new Set(pages.map((p) => p.section))].filter(Boolean).join(', ')}`);
  const undoc = undocumented.token.length + undocumented.class.length;
  if (undoc) {
    console.log(`  ${undocumented.token.length} tokens and ${undocumented.class.length} classes are mentioned in no <code> on any page — linked by fallback:`);
    console.log(`    ${[...undocumented.token, ...undocumented.class].slice(0, 12).join(' ')}${undoc > 12 ? ' …' : ''}`);
  }
  return new Set(pages.map((p) => p.url));
}

/* ------ Prose index: Pagefind ------ */

async function buildPagefind(site, out) {
  const pagefind = await import('pagefind');
  // forceLanguage keeps every page in one index rather than splitting by a
  // per-page lang attribute. It does not drop the `unknown` WASM bundle from
  // the output — that ships either way and is only fetched by a client that
  // needs it.
  const { index, errors } = await pagefind.createIndex({ forceLanguage: 'en' });
  if (!index) throw new Error(`Pagefind could not start: ${(errors || []).join('; ')}`);
  const added = await index.addDirectory({ path: site });
  if (added.errors && added.errors.length) throw new Error(`Pagefind: ${added.errors.join('; ')}`);
  const outDir = path.join(out, PAGEFIND_DIR);

  // The data and the client runtime are written in the same call, and only the
  // data is checked further down. Pagefind has twice written every fragment,
  // every index shard and wasm.en correctly while emitting the ENTIRE client
  // runtime at zero bytes — and reported success both times. Intermittent:
  // roughly two full `build:site` runs in six on 2026-09-13, never once when
  // this script is run on its own, cause not found.
  //
  // Nothing downstream noticed, because the agreement check below reads
  // fragments and the fragments were intact. In the browser, importing an
  // empty module yields no exports, `mod.init` is undefined, the TypeError
  // is swallowed by search.js's own catch, and prose search is silently gone
  // for the whole visit with nothing in the console. A broken deploy that
  // looks exactly like a clean build.
  //
  // So: verify what the page actually loads, retry once, then fail loudly.
  const RUNTIME_FILES = ['pagefind.js', 'pagefind-worker.js', 'pagefind-entry.json', 'wasm.en.pagefind'];

  function emptyRuntimeFile() {
    for (const name of RUNTIME_FILES) {
      const file = path.join(outDir, name);
      if (!fs.existsSync(file)) return `${name} was not written`;
      if (fs.statSync(file).size === 0) return `${name} was written at 0 bytes`;
    }
    return null;
  }

  let bad = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Clear first: writeFiles adds to whatever is already there, so a re-run
    // over a warm _site would count a deleted page's leftover fragment and
    // fail the agreement check below, blaming the indexes for a stale file.
    fs.rmSync(outDir, { recursive: true, force: true });
    const written = await index.writeFiles({ outputPath: outDir });
    if (written.errors && written.errors.length) throw new Error(`Pagefind: ${written.errors.join('; ')}`);
    bad = emptyRuntimeFile();
    if (!bad) break;
    if (attempt === 1) console.warn(`⚠️  Pagefind: ${bad} — rewriting the bundle once before failing`);
  }
  await pagefind.close();
  if (bad) {
    throw new Error(`Pagefind: ${bad}, twice. The index data is fine; the client bundle is not, `
      + 'and an empty bundle fails silently in the browser rather than erroring. Re-run the build.');
  }

  // page_count counts files walked, not pages kept — a page without
  // data-pagefind-body is walked and skipped. The fragments are the pages.
  const urls = new Set();
  for (const f of fs.readdirSync(path.join(outDir, 'fragment'))) {
    const raw = fs.readFileSync(path.join(outDir, 'fragment', f));
    let text;
    try { text = zlib.gunzipSync(raw).toString(); } catch { text = raw.toString(); }
    const m = text.match(/"url":"([^"]+)"/);
    if (m) urls.add(m[1]);
  }
  console.log(`pagefind/     ${urls.size} pages indexed of ${added.page_count} walked → ${path.relative(ROOT, outDir)}`);
  return urls;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  refuseRepoRoot(args.site);
  await refusePublicOut(args.site, args.out);

  const symbolUrls = buildSymbols(args.site, args.out);
  const proseUrls = await buildPagefind(args.site, args.out);

  // Both indexes key on data-pagefind-body, so they must see the same pages.
  // A mismatch is a real defect and stops the deploy — but it has to name the
  // pages, or whoever hits it is left diffing two numbers.
  const onlySymbol = [...symbolUrls].filter((u) => !proseUrls.has(u));
  const onlyProse = [...proseUrls].filter((u) => !symbolUrls.has(u));
  if (onlySymbol.length || onlyProse.length) {
    console.error(`\n  The two search indexes disagree about which pages exist.`);
    if (onlySymbol.length) console.error(`  In the symbol index only: ${onlySymbol.join(', ')}`);
    if (onlyProse.length) console.error(`  In the prose index only:  ${onlyProse.join(', ')}`);
    console.error('');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  build-search failed: ${err.message}\n`);
  process.exit(1);
});
