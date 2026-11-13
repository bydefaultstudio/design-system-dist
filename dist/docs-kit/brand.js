/**
 * brand.js - the brand settings file (engine parity phase 0, D17).
 *
 * One file per site, brand.json, holds every brand value the engine reads.
 * This module is the only code that reads it. It:
 *   - upgrades an older shape in memory, or says what a person must change
 *   - validates the file, failing the build with the field, the value and
 *     the fix
 *   - turns it into the two runtime files the tools load: theme-config.js
 *     (window.THEME_CONFIG) and logo-manifest.js (window.LogoManifest)
 *
 * The engine only ever READS the file (failure scenario 1). The one writer
 * is `bd-brand upgrade` (scripts/brand-upgrade.js), which a person runs.
 *
 * The plan, field by field: engine-parity-phase-0.md.
 */
const fs = require('fs');
const path = require('path');
const measure = require('./svg-measure');
const { LOCALES } = require('./locale');

// The newest shape this engine reads. Bump it only when a field is renamed,
// moved or removed; an added optional field doesn't bump it. Each bump adds
// one step to UPGRADES and a CHANGELOG entry with an Action line.
const BRAND_VERSION = 1;

// The engine's name, for build messages only; the engine's one credit line on
// a client site (P0-3); and the slug of the site that is the engine's own
// home, which shows none. The wording checks admit exactly the credit text.
// Its wording is Erlen's to confirm.
const ENGINE_NAME = 'By Default';
const ENGINE_CREDIT = `Built on ${ENGINE_NAME} OS`;
const ENGINE_HOME_SLUG = 'bydefault';

// The four steps of a hue, darkest first (color-core.js STEPS).
const HUE_STEPS = ['-dark', '', '-light', '-lighter'];
// The off tones every colour grid carries beside the hues (color-core.js EXTRAS).
const GRID_EXTRAS = ['off-black', 'off-white'];
const NAMED_GROUPS = ['primary', 'secondary'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
// The icon the page bar's close and the feedback dialog's close draw when
// brand.json's icons.close leaves it out.
const DEFAULT_CLOSE_ICON = 'close-large';

/** The site's name is always "<name> OS" (D9). Never stored. */
function siteName(brand) {
  return `${brand.name} OS`;
}

/** The close icon's name: the brand's icons.close, else the engine's. */
function closeIcon(brand) {
  return (brand && brand.icons && brand.icons.close) || DEFAULT_CLOSE_ICON;
}

/**
 * The icon names a site's pages can draw, for validate's opts.icons: each
 * SVG in iconsDir by its key, less drafts (_-prefixed) and deprecated
 * aliases, the set the generator's icon map keeps. null when the folder
 * isn't there, so the check is skipped rather than refusing every name (the
 * build already warns about a missing icons folder). Quiet on a broken alias
 * file: the generator warns about that once.
 */
function iconSet(iconsDir, rootDir) {
  if (!iconsDir || !fs.existsSync(iconsDir)) return null;
  const { readIconAliases } = require('./icon-aliases');
  const aliases = readIconAliases({ rootDir, iconsDir, warn: () => {} });
  return new Set(fs.readdirSync(iconsDir)
    .filter((f) => f.endsWith('.svg') && !f.startsWith('_'))
    .map((f) => f.replace(/\.svg$/i, '').toLowerCase().replace(/\s+/g, '-'))
    .filter((key) => !aliases.has(key)));
}

// ── Reading and upgrading ────────────────────────────────────────────────

class BrandError extends Error {
  constructor(file, problems) {
    const list = problems.map((p) => `  - ${p}`).join('\n');
    super(`${file} is not a valid brand settings file:\n${list}\n` +
      'The fields are described in the docs kit README, under "brand.json".');
    this.name = 'BrandError';
    this.problems = problems;
  }
}

/**
 * Version 0 is every brand.json written before phase 0: no "version" key,
 * a flat shape. The step moves what can be moved without a person, and
 * lists what a person must add or decide.
 */
function upgradeFrom0(v0) {
  const v1 = { version: 1 };
  const needs = [];
  const copy = (from, to = from) => { if (v0[from] !== undefined) v1[to] = v0[from]; };

  copy('name');
  if (v0.siteName !== undefined && typeof v0.name === 'string' && v0.siteName !== `${v0.name} OS`) {
    needs.push(`"siteName" is "${v0.siteName}", but a site's name is always "<name> OS" (D9), which would be "${v0.name} OS". ` +
      'Change "name" so that is right, then delete "siteName".');
  }
  for (const key of ['slug', 'url', 'description', 'footerText', 'ogImage', 'emailSignature']) copy(key);

  if (v0.googleFontsUrl !== undefined || v0.typekitId !== undefined || v0.fontPreload !== undefined) {
    v1.fonts = {};
    if (v0.googleFontsUrl !== undefined) v1.fonts.googleFontsUrl = v0.googleFontsUrl;
    if (v0.typekitId !== undefined) v1.fonts.typekitId = v0.typekitId;
    if (v0.fontPreload !== undefined) v1.fonts.preload = v0.fontPreload;
  }
  if (v0.faviconSvg !== undefined || v0.faviconIco !== undefined) {
    v1.favicons = {};
    if (v0.faviconSvg !== undefined) v1.favicons.svg = v0.faviconSvg;
    if (v0.faviconIco !== undefined) v1.favicons.ico = v0.faviconIco;
  }
  if (v0.colorPairings !== undefined || v0.toolPairings !== undefined) {
    v1.colours = {};
    if (v0.colorPairings !== undefined) v1.colours.pairings = v0.colorPairings;
    if (v0.toolPairings !== undefined) v1.colours.toolPairings = v0.toolPairings;
  }

  const moved = new Set(['name', 'siteName', 'slug', 'url', 'description', 'footerText', 'ogImage',
    'emailSignature', 'googleFontsUrl', 'typekitId', 'fontPreload', 'faviconSvg', 'faviconIco',
    'colorPairings', 'toolPairings']);
  for (const key of Object.keys(v0)) {
    if (!moved.has(key)) v1[key] = v0[key];
  }
  return { data: v1, needs };
}

const UPGRADES = { 0: upgradeFrom0 };

/**
 * Bring raw file data up to BRAND_VERSION. Returns the upgraded data, the
 * version it started at, and what a person must do (empty when the upgrade
 * was mechanical). Throws on a version this engine doesn't know.
 */
function upgrade(raw, file = 'brand.json') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BrandError(file, ['The file must hold one JSON object.']);
  }
  const from = raw.version === undefined ? 0 : raw.version;
  if (!Number.isInteger(from) || from < 0) {
    throw new BrandError(file, [`"version" is ${JSON.stringify(raw.version)}. It must be a whole number.`]);
  }
  if (from > BRAND_VERSION) {
    throw new BrandError(file, [`This engine reads brand.json up to version ${BRAND_VERSION}. ` +
      `Your file is version ${from}: update the engine.`]);
  }
  let data = raw;
  const needs = [];
  for (let v = from; v < BRAND_VERSION; v++) {
    const step = UPGRADES[v](data);
    data = step.data;
    needs.push(...step.needs);
  }
  return { data, from, needs };
}

// ── Validation ───────────────────────────────────────────────────────────

/** Every custom property a stylesheet defines, by name without the dashes. */
function definedTokens(cssFiles) {
  const tokens = new Set();
  for (const file of cssFiles) {
    if (!file || !fs.existsSync(file)) continue;
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/(?:^|[;{\s])--([a-zA-Z0-9-]+)\s*:/g)) tokens.add(match[1]);
  }
  return tokens;
}

/** A logo file's markup as the tools embed it: no prolog, no comments, no whitespace between tags. */
function readSvg(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .replace(/>\s+</g, '><');
}

/**
 * A brand logo as markup to inline in a page (the sign-in page's
 * {{logo:primary}}). `sanitise` is the svg-cleaner core's sanitiseSVG, which
 * tokenises tags the way a browser does and drops scripts, every on* handler
 * quoted or not, javascript: and data: links, foreignObject and non-SVG
 * elements. Inline, an SVG is part of the page, and the sign-in page is the
 * one a signed-out reader loads, so the mark must load nothing at all:
 * anything that would (an @import, a url() or image-set() to anywhere but
 * the file's own #fragment, an <image>, <use> or <a> href that isn't one, an
 * animation that rewrites a link, a CSS escape that could spell any of
 * those) stops the build with InlineLogoError rather than being stripped,
 * because a stripped logo would look broken with no error. A self-closed
 * root is refused too: in HTML an unclosed <svg> swallows the form after it.
 * Every paint but `none` becomes currentColor, so the mark takes the text
 * colour in light and dark, and the root sizes to its wrapper, out of the
 * accessibility tree (the element around it names it).
 */
class InlineLogoError extends Error {}

function inlineLogoSvg(markup, sanitise) {
  const clean = sanitise(String(markup)).replace(/^\s*<\?xml[^>]*\?>\s*/i, '').trim();
  const root = /^<svg\b[^>]*>/i.exec(clean);
  if (!root) throw new InlineLogoError('it has no <svg> root once its active content is removed');
  if (/\/>$/.test(root[0]) || !/<\/svg\s*>$/i.test(clean)) throw new InlineLogoError('its <svg> root is self-closed or never closed, which would swallow the page after it');
  // The sanitiser writes every attribute quoted, so these read its output
  const problems = [];
  const css = [...clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1])
    .concat([...clean.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]));
  for (const text of css) {
    if (text.includes('\\')) problems.push('a CSS escape in its styles');
    if (/@import/i.test(text)) problems.push('an @import in its styles');
    if (/image-set\s*\(/i.test(text)) problems.push('an image-set() in its styles');
  }
  for (const m of clean.matchAll(/url\(\s*["']?([^"')\s]*)/gi)) {
    if (!m[1].startsWith('#')) problems.push(`url(${m[1]})`);
  }
  for (const m of clean.matchAll(/\s(?:xlink:)?href=(?:"([^"]*)"|'([^']*)')/gi)) {
    const ref = (m[1] ?? m[2]).trim();
    if (!ref.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp)[;,]/i.test(ref)) problems.push(`a link to ${ref || 'nothing'}`);
  }
  if (/\sattributeName=["'](?:xlink:)?href["']/i.test(clean)) problems.push('an animation that rewrites a link');
  if (problems.length) throw new InlineLogoError(`it loads or links outside itself (${[...new Set(problems)].join(', ')}). Clean it with npx svg-cleaner and remove those`);
  const svg = clean
    .replace(/\s(?:xmlns|xmlns:[a-z]+)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(fill|stroke)\s*=\s*(["'])(?!none\2)[^"']*\2/gi, ' $1="currentColor"')
    .replace(/\b(fill|stroke)\s*:\s*(?!none\b)[^;"'}]+/gi, '$1:currentColor');
  return svg.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
    const kept = attrs.replace(/\s(?:width|height|aria-hidden|focusable|role)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return `<svg${kept} width="100%" height="100%" aria-hidden="true" focusable="false">`;
  });
}

/** The viewBox of an SVG's root element, as four numbers, or null. */
function viewBoxOf(markup) {
  const root = markup.match(/<svg\b[^>]*>/);
  if (!root) return null;
  const vb = root[0].match(/\bviewBox\s*=\s*["']([^"']+)["']/);
  if (!vb) return null;
  const nums = vb[1].trim().split(/[\s,]+/).map(Number);
  return nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
}

const KNOWN = {
  root: ['$schema', 'version', 'name', 'slug', 'url', 'description', 'footerText', 'fonts', 'favicons',
    'ogImage', 'colours', 'logos', 'icons', 'wording', 'access', 'emailSignature', 'email', 'switches'],
  fonts: ['googleFontsUrl', 'typekitId', 'preload'],
  icons: ['close'],
  favicons: ['svg', 'ico'],
  colours: ['hues', 'named', 'pairings', 'toolPairings'],
  named: ['id', 'label', 'token', 'group'],
  logos: ['clearSpaceGlyph', 'primary', 'spec', 'variants', 'colourways'],
  glyph: ['label', 'file'],
  variant: ['id', 'label', 'shortLabel', 'file', 'minWidth', 'rotate', 'clearSpace', 'spec'],
  clearSpace: ['paths', 'label'],
  colourway: ['id', 'label', 'value', 'bg', 'variants'],
  wording: ['organisation', 'website', 'supportEmail', 'locale'],
  // requestRoute is no longer read (phase D): Ask for access is the engine's
  // /support.html on every site. Still accepted, so no old file breaks; the
  // generator warns until it is deleted.
  access: ['requestRoute', 'turnstileSiteKey'],
  emailSignature: ['base', 'previewBase', 'logo', 'logoWidth', 'logoHeight', 'icons', 'cardBackground', 'disclaimer'],
  email: ['tokens', 'headerLogo', 'footer', 'securityNotes'],
};

/**
 * The fields that reach every page as text: the site name and page titles
 * (from name), the meta and home description, the footer, and the
 * organisation app copy names. Each is plain text, at most this long: never
 * < or > (no markup), " (it would close an attribute the value sits in, and
 * escaped it reads as &quot; wherever a page escapes it again), nor a
 * control character (no line break, tab or NUL).
 * The generator escapes them too; this keeps a merged brand.json from ever
 * proposing markup (engine-parity-d18.md, review finding 1).
 */
const PLAIN_TEXT_LIMITS = { name: 60, description: 300, footerText: 200, 'wording.organisation': 100 };
const NOT_PLAIN = /[<>"\u0000-\u001f\u007f]/;

/** Why `value` is not plain text within `max` characters, or null. */
function plainTextProblem(field, value, max) {
  if (NOT_PLAIN.test(value)) return `"${field}" can't hold <, >, a straight double quote (use “ ” instead) or a control character such as a line break: it's shown as plain text on every page.`;
  if (value.length > max) return `"${field}" is ${value.length} characters. Keep it to ${max} at most.`;
  return null;
}

/**
 * A plain same-site path for a link the site's scripts follow: a path
 * starting with one /, with no backslash (a browser reads /\host as
 * //host, another site), query, fragment, whitespace or control character.
 * The same rule as the gate's own onePath (worker/site.mjs).
 */
function isSitePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value !== '/'
    && !/[\\?#\s\u0000-\u001f\u007f]/.test(value) && value.length <= 200;
}

/**
 * Check a version-current brand object. Returns a list of problems, each
 * naming the field, the value and the fix; empty means valid.
 *
 * opts.root      project root, for logo and font paths
 * opts.tokens    Set of defined custom-property names, for colour checks
 *                (skipped when not given)
 * opts.icons     Set of the site's icon names (iconSet()), for icons.close
 *                (skipped when not given or null)
 */
function validate(brand, opts = {}) {
  const root = opts.root || process.cwd();
  const tokens = opts.tokens || null;
  const icons = opts.icons || null;
  const problems = [];
  const fail = (msg) => problems.push(msg);

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => typeof v === 'string' && v.trim() !== '';
  const unknown = (obj, allowed, where) => {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) fail(`${where}"${key}" isn't a brand.json field. Check its spelling, or remove it.`);
    }
  };
  const https = (v) => str(v) && /^https:\/\/[^\s/]+/.test(v);

  if (!isObj(brand)) return ['The file must hold one JSON object.'];
  unknown(brand, KNOWN.root, '');
  if (brand.version !== BRAND_VERSION) fail(`"version" must be ${BRAND_VERSION}.`);

  // Identity
  if (!str(brand.name)) fail('"name" is required: the brand\'s name, such as "BlackDoctor". The site is called "<name> OS".');
  else if (/\bOS$/.test(brand.name.trim())) fail(`"name" is "${brand.name}". Leave "OS" off: the engine adds it (D9).`);
  if (!str(brand.slug) || !SLUG.test(brand.slug)) {
    fail(`"slug" is ${brand.slug === undefined ? 'missing' : JSON.stringify(brand.slug)}. It must be lower-case letters, numbers and single hyphens, such as "blackdoctor": it names the sender address and the subdomain.`);
  }
  if (!https(brand.url) || /\/$/.test(brand.url)) {
    fail(`"url" is ${brand.url === undefined ? 'missing' : JSON.stringify(brand.url)}. It must be the site's https address with no trailing slash, such as "https://blackdoctor.design".`);
  }
  if (!str(brand.description)) fail('"description" is required: one sentence describing the site.');
  if (!str(brand.footerText)) fail('"footerText" is required, such as "© 2026 BlackDoctor".');
  for (const field of ['name', 'description', 'footerText']) {
    const problem = str(brand[field]) ? plainTextProblem(field, brand[field], PLAIN_TEXT_LIMITS[field]) : null;
    if (problem) fail(problem);
  }
  if (brand.ogImage !== undefined && !https(brand.ogImage)) {
    fail(`"ogImage" is ${JSON.stringify(brand.ogImage)}. It must be an absolute https address: social sites can't resolve a relative one.`);
  }

  if (brand.fonts !== undefined) {
    if (!isObj(brand.fonts)) fail('"fonts" must be an object.');
    else {
      unknown(brand.fonts, KNOWN.fonts, 'fonts.');
      const f = brand.fonts;
      if (f.googleFontsUrl != null && !https(f.googleFontsUrl)) fail('"fonts.googleFontsUrl" must be an https address or null.');
      if (f.typekitId != null && !(str(f.typekitId) && /^[a-z0-9]+$/.test(f.typekitId))) fail('"fonts.typekitId" must be a Typekit kit id, such as "wgr3lwl", or null.');
      if (f.preload !== undefined) {
        if (!Array.isArray(f.preload) || !f.preload.every(str)) fail('"fonts.preload" must be a list of font file paths.');
        else for (const p of f.preload) {
          if (!fs.existsSync(path.resolve(root, p))) fail(`"fonts.preload" names "${p}", which doesn't exist.`);
        }
      }
    }
  }
  if (brand.favicons !== undefined) {
    if (!isObj(brand.favicons)) fail('"favicons" must be an object with "svg" and "ico" paths.');
    else {
      unknown(brand.favicons, KNOWN.favicons, 'favicons.');
      for (const k of ['svg', 'ico']) {
        if (brand.favicons[k] !== undefined && !(str(brand.favicons[k]) && brand.favicons[k].startsWith('/'))) {
          fail(`"favicons.${k}" must be a site path starting with "/".`);
        }
      }
    }
  }

  // Colour
  const grid = new Set(GRID_EXTRAS);
  if (!isObj(brand.colours)) {
    fail('"colours" is required. It needs "hues": the hues the colour tools offer, in grid order, such as ["yellow", "green", "blue"].');
  } else {
    const c = brand.colours;
    unknown(c, KNOWN.colours, 'colours.');
    if (!Array.isArray(c.hues) || c.hues.length === 0 || !c.hues.every(str)) {
      fail('"colours.hues" is required: a list of hue names, such as ["yellow", "green", "blue"].');
    } else if (c.hues.length < 2 || c.hues.length > 9) {
      fail(`"colours.hues" lists ${c.hues.length}. The colour grids are drawn for two to nine hues.`);
    } else {
      const seen = new Set();
      for (const hue of c.hues) {
        if (seen.has(hue)) fail(`"colours.hues" lists "${hue}" twice.`);
        seen.add(hue);
        for (const step of HUE_STEPS) {
          grid.add(hue + step);
          if (tokens && !tokens.has(hue + step)) {
            fail(`"colours.hues" lists "${hue}", but no stylesheet defines --${hue}${step}. Every hue needs all four steps: -dark, base, -light and -lighter.`);
          }
        }
      }
    }
    if (c.named !== undefined) {
      if (!Array.isArray(c.named) || c.named.length === 0) {
        fail('"colours.named" must be a list of the brand\'s colours, or left out.');
      } else {
        const ids = new Set();
        c.named.forEach((n, i) => {
          const at = `"colours.named" entry ${i + 1}`;
          if (!isObj(n)) { fail(`${at} must be an object.`); return; }
          unknown(n, KNOWN.named, `colours.named[${i}].`);
          if (!str(n.id) || !ID.test(n.id)) fail(`${at} has id ${JSON.stringify(n.id)}. It must be lower-case and hyphenated, such as "gold": it names exported files.`);
          else if (ids.has(n.id)) fail(`${at} repeats the id "${n.id}".`);
          else ids.add(n.id);
          if (!str(n.label)) fail(`${at} needs a "label": the colour's name in Figma, such as "Gold".`);
          if (!str(n.token)) fail(`${at} needs a "token": the custom property that holds the colour, without the dashes.`);
          else if (tokens && !tokens.has(n.token)) fail(`${at} names the token "${n.token}", which no stylesheet defines.`);
          if (!NAMED_GROUPS.includes(n.group)) fail(`${at} has group ${JSON.stringify(n.group)}. It must be "primary" or "secondary".`);
        });
        if (!c.named.some((n) => n && n.group === 'primary')) fail('"colours.named" needs at least one colour in the "primary" group.');
      }
    }
    for (const key of ['pairings', 'toolPairings']) {
      if (c[key] === undefined) continue;
      if (!Array.isArray(c[key])) { fail(`"colours.${key}" must be a list of { "fg": "<token>", "bg": "<token>" }.`); continue; }
      const seen = new Set();
      c[key].forEach((pair, i) => {
        if (!isObj(pair) || !str(pair.fg) || !str(pair.bg) || Object.keys(pair).some((k) => k !== 'fg' && k !== 'bg')) {
          fail(`"colours.${key}" entry ${i + 1} must be exactly { "fg": "<token>", "bg": "<token>" }.`);
          return;
        }
        const id = `${pair.fg}|${pair.bg}`;
        if (seen.has(id)) fail(`"colours.${key}" lists ${pair.fg} on ${pair.bg} twice.`);
        seen.add(id);
        if (Array.isArray(c.hues)) {
          for (const t of [pair.fg, pair.bg]) {
            if (!grid.has(t)) fail(`"colours.${key}" names "${t}", which isn't in the colour grid (the hue steps, off-black and off-white). The tools would drop the pair.`);
          }
        }
      });
    }
  }

  // Logos and the required clear space
  validateLogos(brand.logos, root, fail, isObj, str, unknown);

  // Icons the chrome draws: a name from the site's icon set
  if (brand.icons !== undefined) {
    if (!isObj(brand.icons)) fail('"icons" must be an object.');
    else {
      unknown(brand.icons, KNOWN.icons, 'icons.');
      const close = brand.icons.close;
      if (close !== undefined) {
        if (!str(close) || !ID.test(close)) {
          fail(`"icons.close" is ${JSON.stringify(close)}. It must be an icon's name, lower-case and hyphenated, such as "close", or left out to use "${DEFAULT_CLOSE_ICON}".`);
        } else if (icons && !icons.has(close)) {
          fail(`"icons.close" is "${close}", which isn't in the site's icon set (the icons folder, docs.config.js iconsDir). Name an icon that is, or leave it out to use "${DEFAULT_CLOSE_ICON}".`);
        }
      }
    }
  }

  // Wording
  if (brand.wording !== undefined) {
    if (!isObj(brand.wording)) fail('"wording" must be an object.');
    else {
      unknown(brand.wording, KNOWN.wording, 'wording.');
      if (brand.wording.organisation !== undefined && !str(brand.wording.organisation)) fail('"wording.organisation" must be text, or left out to use "name".');
      else if (brand.wording.organisation !== undefined) {
        const problem = plainTextProblem('wording.organisation', brand.wording.organisation, PLAIN_TEXT_LIMITS['wording.organisation']);
        if (problem) fail(problem);
      }
      if (brand.wording.website !== undefined && !(https(brand.wording.website) && !/\/$/.test(brand.wording.website))) {
        fail('"wording.website" must be the organisation\'s own https address with no trailing slash, or left out to use "url".');
      }
      // Shown to a reader whose form failed to send: one plain address
      const support = brand.wording.supportEmail;
      if (support !== undefined && !(str(support) && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(support))) {
        fail(`"wording.supportEmail" is ${JSON.stringify(support)}. It must be one plain address, such as "support@example.com", or left out.`);
      }
      // The spelling of the engine's own words (locale.js); a site's own pages keep theirs
      const locale = brand.wording.locale;
      if (locale !== undefined && !LOCALES.includes(locale)) {
        fail(`"wording.locale" is ${JSON.stringify(locale)}. It must be ${LOCALES.map((l) => `"${l}"`).join(' or ')}, written exactly so, or left out for "${LOCALES[0]}".`);
      }
    }
  }
  if (brand.access !== undefined) {
    if (!isObj(brand.access)) fail('"access" must be an object.');
    else {
      unknown(brand.access, KNOWN.access, 'access.');
      const r = brand.access.requestRoute;
      if (r !== undefined && r !== null && !isSitePath(r)) {
        fail(`"access.requestRoute" is ${JSON.stringify(r)}. It is no longer read (Ask for access is /support.html on every site), and a malformed one still fails: delete it.`);
      }
      // Public by design (it sits in the page), so only its shape is checked
      const key = brand.access.turnstileSiteKey;
      if (key !== undefined && key !== null && !(typeof key === 'string' && /^[0-9A-Za-z_-]{10,100}$/.test(key))) {
        fail(`"access.turnstileSiteKey" is ${JSON.stringify(key)}. It must be the spam check's site key, letters, digits, - and _ only, or left out.`);
      }
    }
  }

  // Email signature: a permanent URL contract (sent signatures fetch these forever)
  if (brand.emailSignature !== undefined) {
    const es = brand.emailSignature;
    if (!isObj(es)) fail('"emailSignature" must be an object.');
    else {
      unknown(es, KNOWN.emailSignature, 'emailSignature.');
      if (!https(es.base) || !es.base.endsWith('/')) fail('"emailSignature.base" must be an https address ending in "/". Sent signatures fetch their images from it forever: never change it once used.');
      if (!str(es.previewBase) || !es.previewBase.endsWith('/')) fail('"emailSignature.previewBase" must be a site path ending in "/".');
      if (!str(es.logo)) fail('"emailSignature.logo" is required: the logo image\'s file name.');
      for (const k of ['logoWidth', 'logoHeight']) if (!(Number.isFinite(es[k]) && es[k] > 0)) fail(`"emailSignature.${k}" must be a positive number of pixels.`);
      if (!isObj(es.icons) || !['email', 'web', 'linkedin', 'instagram'].every((k) => str(es.icons[k]))) {
        fail('"emailSignature.icons" must map email, web, linkedin and instagram to file names.');
      }
      if (!HEX.test(es.cardBackground || '')) fail('"emailSignature.cardBackground" must be a six-digit hex colour.');
      if (!str(es.disclaimer)) fail('"emailSignature.disclaimer" is required.');
    }
  }

  // Reserved for later phases: accepted, shape-checked only
  if (brand.email !== undefined) {
    if (!isObj(brand.email)) fail('"email" must be an object.');
    else unknown(brand.email, KNOWN.email, 'email.');
  }
  if (brand.switches !== undefined && !isObj(brand.switches)) fail('"switches" must be an object.');

  return problems;
}

/** A Layout Spec as the Layout Specs tool exports it (layer-stack.js parses the rest). */
function isLayoutSpec(spec) {
  return !!spec && typeof spec === 'object' && !Array.isArray(spec)
    && Number.isInteger(spec.version) && spec.version > 0 && Array.isArray(spec.layers)
    && !!spec.canvas && spec.canvas.w > 0 && spec.canvas.h > 0;
}

/**
 * X for one logo: the width of the glyph's paths in the logo's own viewBox,
 * calculated from their geometry (svg-measure.js), to two decimals. The
 * clear space is calculation, never a hand-typed number (Erlen, 2026-11-10).
 */
function measuredX(markup, pathNumbers) {
  return measure.round2(measure.measurePaths(markup, pathNumbers.map((n) => n - 1)).w);
}

/**
 * The logos, and the clear space as a build failure (Erlen, 2026-11-10):
 * the rule is stated on the primary logo, X is measured off the artwork,
 * the glyph X comes from has a viewBox that is its whole box, and every
 * mark carries its own X (P0-2: no opt-out).
 */
function validateLogos(logos, root, fail, isObj, str, unknown) {
  if (!isObj(logos)) {
    fail('"logos" is required: the clear-space glyph, the primary logo\'s id, the variants and the colourways.');
    return;
  }
  unknown(logos, KNOWN.logos, 'logos.');

  const svgFile = (rel, where) => {
    if (!str(rel)) { fail(`${where} needs a "file": the SVG's path from the project root.`); return null; }
    if (!/\.svg$/i.test(rel)) { fail(`${where} names "${rel}", which isn't an .svg file.`); return null; }
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) { fail(`${where} names "${rel}", which doesn't exist.`); return null; }
    const markup = readSvg(abs);
    if (!/^<svg\b/.test(markup)) { fail(`${where}: "${rel}" doesn't start with an <svg> element.`); return null; }
    const vb = viewBoxOf(markup);
    if (!vb) { fail(`${where}: "${rel}" has no viewBox. Export it with one: the clear space is measured in its units.`); return null; }
    if (/<script\b|\son[a-z]+\s*=|javascript:/i.test(markup)) { fail(`${where}: "${rel}" carries script. Clean it with npx svg-cleaner first.`); return null; }
    return { markup, vb };
  };

  // The glyph X is measured from
  let glyphWidth = null;
  const g = logos.clearSpaceGlyph;
  if (!isObj(g)) {
    fail('"logos.clearSpaceGlyph" is required: the glyph X is measured from, such as the B of the wordmark, with { "label", "file" }.');
  } else {
    unknown(g, KNOWN.glyph, 'logos.clearSpaceGlyph.');
    if (!str(g.label)) fail('"logos.clearSpaceGlyph.label" is required: the glyph\'s name, such as "B".');
    const svg = svgFile(g.file, '"logos.clearSpaceGlyph"');
    if (svg && !(svg.vb[0] === 0 && svg.vb[2] > 0 && svg.vb[3] > 0)) {
      fail(`"logos.clearSpaceGlyph": the viewBox of "${g.file}" is "${svg.vb.join(' ')}". It must be the glyph's own box, starting at x 0, so its width is X.`);
    } else if (svg) {
      // The glyph's drawn width, measured as every X is, so side bearings in
      // the file can't make a correct artwork fail
      try {
        glyphWidth = measure.measurePaths(svg.markup, measure.svgPaths(svg.markup).map((_, n) => n)).w;
      } catch (err) {
        fail(`"logos.clearSpaceGlyph": "${g.file}" can't be measured: ${err.message}.`);
      }
    }
  }
  if (logos.spec !== undefined && !isLayoutSpec(logos.spec)) {
    fail('"logos.spec" must be a Layout Spec, exported from the Layout Specs tool: the clear-space rule every logo is drawn with.');
  }

  // The variants, each with its own X
  if (!Array.isArray(logos.variants) || logos.variants.length === 0) {
    fail('"logos.variants" is required: at least the primary logo.');
    return;
  }
  const ids = new Set();
  logos.variants.forEach((v, i) => {
    const at = `"logos.variants" entry ${i + 1}${v && str(v.id) ? ` ("${v.id}")` : ''}`;
    if (!isObj(v)) { fail(`${at} must be an object.`); return; }
    unknown(v, KNOWN.variant, `logos.variants[${i}].`);
    if (!str(v.id) || !ID.test(v.id)) fail(`${at} has id ${JSON.stringify(v.id)}. It must be lower-case and hyphenated.`);
    else if (ids.has(v.id)) fail(`${at} repeats the id "${v.id}".`);
    else ids.add(v.id);
    if (!str(v.label)) fail(`${at} needs a "label".`);
    if (v.shortLabel !== undefined && !str(v.shortLabel)) fail(`${at}: "shortLabel" must be text, or left out.`);
    if (!(Number.isFinite(v.minWidth) && v.minWidth > 0)) fail(`${at} needs a "minWidth": the smallest width in pixels the logo may be used at.`);
    if (v.rotate !== undefined && ![90, -90, 180].includes(v.rotate)) fail(`${at}: "rotate" must be 90, -90 or 180.`);
    if (v.spec !== undefined && !isLayoutSpec(v.spec)) {
      fail(`${at}: "spec" must be a Layout Spec, exported from the Layout Specs tool.`);
    }
    const svg = svgFile(v.file, at);
    const cs = v.clearSpace;
    if (!isObj(cs) || !Array.isArray(cs.paths) || cs.paths.length === 0) {
      fail(`${at} has no clear space. Every mark needs X: add "clearSpace": { "paths": [<the glyph's path numbers in this file, from 1>], "label": "<what X is>" }, and the build measures X off them.`);
    } else {
      unknown(cs, KNOWN.clearSpace, `logos.variants[${i}].clearSpace.`);
      if (!str(cs.label)) fail(`${at}: "clearSpace.label" is required, such as "the B's width".`);
      if (!cs.paths.every((n) => Number.isInteger(n) && n > 0)) {
        fail(`${at}: "clearSpace.paths" must list path numbers from 1, in the order the file draws them.`);
      } else if (svg) {
        let units = null;
        try {
          units = measuredX(svg.markup, cs.paths);
        } catch (err) {
          fail(`${at}: X can't be measured from "${v.file}": ${err.message}.`);
        }
        if (units !== null && !(units > 0)) fail(`${at}: the paths "clearSpace.paths" names measure 0 wide.`);
        else if (units !== null && units > svg.vb[2]) fail(`${at}: X measures ${units}, wider than the logo itself (${svg.vb[2]} units). Check "clearSpace.paths" names the glyph.`);
        // The glyph is the primary's own: its width is the primary's X
        else if (units !== null && v.id === logos.primary && glyphWidth !== null && Math.abs(units - measure.round2(glyphWidth)) > 0.01) {
          fail(`${at}: X measures ${units} off the primary, but the clear-space glyph is ${measure.round2(glyphWidth)} wide. The glyph must be the one the primary's X is measured from.`);
        }
      }
    }
  });

  if (!str(logos.primary)) fail('"logos.primary" is required: the id of the variant the clear-space rule is stated on.');
  else if (!ids.has(logos.primary)) fail(`"logos.primary" is "${logos.primary}", but no variant has that id.`);
  else if (logos.variants[0] && logos.variants[0].id !== logos.primary) {
    fail(`"logos.primary" is "${logos.primary}", but the first variant is "${logos.variants[0].id}". List the primary first: the Logo Tool opens on it.`);
  }

  // Colourways stay hex: an exported file can't resolve a custom property
  if (!Array.isArray(logos.colourways) || logos.colourways.length === 0) {
    fail('"logos.colourways" is required: at least one logo colour, with the background it was designed for.');
    return;
  }
  const cwIds = new Set();
  logos.colourways.forEach((c, i) => {
    const at = `"logos.colourways" entry ${i + 1}`;
    if (!isObj(c)) { fail(`${at} must be an object.`); return; }
    unknown(c, KNOWN.colourway, `logos.colourways[${i}].`);
    if (!str(c.id) || !ID.test(c.id)) fail(`${at} has id ${JSON.stringify(c.id)}. It must be lower-case and hyphenated.`);
    else if (cwIds.has(c.id)) fail(`${at} repeats the id "${c.id}".`);
    else cwIds.add(c.id);
    if (!str(c.label)) fail(`${at} needs a "label".`);
    if (!HEX.test(c.value || '')) fail(`${at}: "value" must be a six-digit hex colour.`);
    if (!isObj(c.bg) || !str(c.bg.id) || !HEX.test(c.bg.value || '')) fail(`${at}: "bg" must be { "id": "<name>", "value": "<six-digit hex>" }.`);
    if (c.variants !== undefined) {
      if (!Array.isArray(c.variants) || !c.variants.every((id) => ids.has(id))) fail(`${at}: "variants" must list variant ids that exist.`);
    }
  });
}

/**
 * Read, upgrade and validate a brand file. Throws a BrandError listing
 * every problem; returns { brand, from, file } when it passes. A mechanical
 * upgrade passes with `from` below BRAND_VERSION, so the caller can warn.
 */
function loadBrand(file, opts = {}) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BrandError(file, [err.code === 'ENOENT' ? 'The file doesn\'t exist.' : `It isn't valid JSON: ${err.message}`]);
  }
  const { data, from, needs } = upgrade(raw, file);
  const problems = [...needs, ...validate(data, opts)];
  if (problems.length) throw new BrandError(file, problems);
  return { brand: data, from, file };
}

// ── By Default wording on a client site (failure scenario 11) ────────────

const ENGINE_WORDING = /By Default|bydefault\.(?:studio|design)/g;

/**
 * Every By Default mention a reader would see in a built page: text and
 * attributes, after comments, scripts and styles are removed, and after the
 * engine's own credit line. Returns [{ line, match, text }].
 */
function findEngineWording(html) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, blank)
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, blank)
    .split(ENGINE_CREDIT).join(' '.repeat(ENGINE_CREDIT.length));
  const hits = [];
  visible.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(ENGINE_WORDING)) hits.push({ line: i + 1, match: m[0], text: text.trim() });
  });
  return hits;
}

// ── Runtime files ────────────────────────────────────────────────────────

/** The keys the docs chrome reads for fonts, favicons and the OG image. */
function chromeManifest(brand) {
  const f = brand.fonts || {};
  const fav = brand.favicons || {};
  return {
    name: brand.name,
    siteName: siteName(brand),
    description: brand.description,
    footerText: brand.footerText,
    googleFontsUrl: f.googleFontsUrl || null,
    typekitId: f.typekitId || null,
    fontPreload: f.preload || [],
    faviconSvg: fav.svg,
    faviconIco: fav.ico,
    ogImage: brand.ogImage,
  };
}

/**
 * The organisation named in app copy (who a reader tells when something
 * breaks, who a licence names), and its own public website, which can differ
 * from the site's address (By Default OS is bydefault.design; By Default is
 * bydefault.studio).
 */
function wording(brand) {
  const w = brand.wording || {};
  return {
    organisation: w.organisation || brand.name,
    website: w.website || brand.url,
    // The spelling of the engine's own words (locale.js): en-GB, as written
    locale: w.locale || LOCALES[0],
  };
}

/**
 * The wording THEME_CONFIG carries: the locale only when it isn't the
 * engine's own, so an en-GB site's theme-config.js is the file it always was.
 */
function runtimeWording(brand) {
  const { locale, ...w } = wording(brand);
  return locale === LOCALES[0] ? w : { ...w, locale };
}

/**
 * The values {{brand:key}} fills in an app page's body. Plain text; the
 * generator escapes each for the attribute or text it lands in.
 */
function brandTokens(brand) {
  const w = wording(brand);
  const access = brand.access || {};
  return {
    name: brand.name,
    siteName: siteName(brand),
    slug: brand.slug,
    url: brand.url,
    organisation: w.organisation,
    website: w.website,
    websiteHost: w.website.replace(/^https:\/\//, ''),
    // Empty when the brand has none: the Ask for access form reads an empty
    // attribute as "not set" (phase D)
    supportEmail: (brand.wording && brand.wording.supportEmail) || '',
    turnstileSiteKey: access.turnstileSiteKey || '',
  };
}

/**
 * window.THEME_CONFIG's brand keys. The runtime names are the ones the tools
 * already read (hues, palettePrimary, colorPairings, toolPairings,
 * emailSignature), so a tool needs no second contract.
 */
function themeConfigPayload(brand) {
  const c = brand.colours;
  const payload = {
    brand: { name: brand.name, siteName: siteName(brand), slug: brand.slug, url: brand.url },
    wording: runtimeWording(brand),
    hues: c.hues.slice(),
  };
  if (c.named) {
    payload.palettePrimary = {};
    for (const group of NAMED_GROUPS) {
      payload.palettePrimary[group] = c.named
        .filter((n) => n.group === group)
        .map((n) => ({ token: n.token, id: n.id, label: n.label }));
    }
  }
  const pairs = (list) => list.map((p) => ({ fg: p.fg, bg: p.bg }));
  if (c.pairings) payload.colorPairings = pairs(c.pairings);
  if (c.toolPairings || c.pairings) payload.toolPairings = pairs(c.toolPairings || c.pairings);
  if (brand.emailSignature) payload.emailSignature = brand.emailSignature;
  return payload;
}

/** window.LogoManifest, with each file's markup inlined (a string the page owns never taints a canvas). */
function logoManifestPayload(brand, root) {
  const L = brand.logos;
  const markup = (rel) => readSvg(path.resolve(root, rel));
  return {
    brand: { id: brand.slug, name: brand.name },
    clearSpaceGlyph: { label: L.clearSpaceGlyph.label, markup: markup(L.clearSpaceGlyph.file) },
    ...(L.spec ? { clearSpaceSpec: L.spec } : {}),
    // The validator keeps the primary first: the Logo Tool opens on variants[0]
    variants: L.variants.map((v) => {
      const out = { id: v.id, label: v.label };
      if (v.shortLabel) out.shortLabel = v.shortLabel;
      if (v.rotate !== undefined) out.rotate = v.rotate;
      out.minWidth = v.minWidth;
      const art = markup(v.file);
      out.clearSpace = { units: measuredX(art, v.clearSpace.paths), label: v.clearSpace.label };
      // The Logo Tool draws a logo's own spec; without one, the brand's
      // (clearSpaceSpec below); without that, the engine's Logo template.
      if (v.spec) out.safeZone = v.spec;
      out.markup = art;
      return out;
    }),
    colours: L.colourways.map((c) => {
      const out = { id: c.id, label: c.label, value: c.value, bg: { id: c.bg.id, value: c.bg.value } };
      if (c.variants) out.variants = c.variants.slice();
      return out;
    }),
  };
}

function banner(what, version) {
  return `/**
 * ${what} (GENERATED FILE, do not edit)
 *
 * Built from the site's brand.json by the docs kit (cms/generator/brand.js).
 * Edit brand.json, then rebuild.
 *
 * @version ${version}
 */

`;
}

function themeConfigJs(payload, engineVersion) {
  return banner('Theme Configuration', engineVersion) +
    'var THEME_CONFIG = ' + JSON.stringify(payload, null, 2) + ';\n';
}

function logoManifestJs(payload, engineVersion) {
  return banner('Logo Manifest', engineVersion) +
    'window.LogoManifest = ' + JSON.stringify(payload, null, 2) + ';\n';
}

module.exports = {
  BRAND_VERSION,
  ENGINE_NAME,
  ENGINE_CREDIT,
  ENGINE_HOME_SLUG,
  DEFAULT_CLOSE_ICON,
  BrandError,
  siteName,
  closeIcon,
  iconSet,
  upgrade,
  validate,
  loadBrand,
  definedTokens,
  readSvg,
  inlineLogoSvg,
  InlineLogoError,
  viewBoxOf,
  measuredX,
  chromeManifest,
  wording,
  brandTokens,
  findEngineWording,
  themeConfigPayload,
  logoManifestPayload,
  themeConfigJs,
  logoManifestJs,
};
