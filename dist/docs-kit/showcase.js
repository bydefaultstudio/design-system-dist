/**
 * Showcase assets — load and check the source pairs in cms/showcase/.
 *
 * An asset is two files: `<slug>.json` (its settings) and `<slug>.html` (the
 * component markup it presents). This module reads every pair, checks it
 * against the contract in assets/data/showcase-asset.schema.json, and returns
 * the assets for generate-docs.js to emit as the public feed, the post pages
 * and the edit view's inlined manifest.
 *
 * The checks are written out here rather than run through a JSON Schema
 * library: the generator installs only `marked` (cms/generator/package.json),
 * and a build that resolves a validator from the repo root breaks the day the
 * root install is skipped. scripts/verify-showcase.mjs runs the same assets
 * through the schema itself with ajv in `npm test`, so the two cannot drift
 * apart unnoticed.
 *
 * Everything that can be wrong fails the build, with every problem listed at
 * once: a post that ships broken is a broken post on Instagram.
 *
 * Layer: app (CLAUDE.md §17).
 */

const fs = require('fs');
const path = require('path');

// The two frames, at the pixel size the export writes. `safe` is the inset the
// artwork is fitted inside: even on a post, and on a story clear of the
// platform's own interface top and bottom.
const FRAMES = {
  'post-4-5': { label: 'Post 4:5', width: 1080, height: 1350, safe: { top: 96, right: 96, bottom: 96, left: 96 } },
  'story-9-16': { label: 'Story 9:16', width: 1080, height: 1920, safe: { top: 250, right: 96, bottom: 340, left: 96 } },
};

// The grounds an asset may sit on: semantic background tokens only, never a
// hex, so a brand re-skins every asset through its theme (CLAUDE.md §17
// Rule 3). Chrome tokens (sidebar, top nav, modal scrim) are left out on
// purpose. Each must exist in design-system.css, which loadShowcase checks.
const BACKGROUNDS = [
  'background-primary',
  'background-secondary',
  'background-plain',
  'background-faded',
  'background-darker',
  'background-accent',
  'background-black',
  'background-white',
  'background-blue',
  'background-red',
  'background-green',
];

const THEMES = ['light', 'dark'];

// The grounds that keep their colour whatever the theme, and the one theme
// whose text reads on each. A dark theme's light text on background-white
// is unreadable, and the theme would not save it.
const FIXED_GROUNDS = {
  'background-white': 'light',
  'background-black': 'dark',
  'background-blue': 'dark',
  'background-red': 'dark',
  'background-green': 'dark',
};
const SIDES = ['top', 'right', 'bottom', 'left'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLASS_NAME = /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/;
const DATA_ATTR = /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARIA_OR_DATA = /^(?:aria|data)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The name the stage reserves for its own annotations layer.
const ANNOTATIONS_LAYER = 'annotations';

// A Layout Spec's switchable layers join the asset's as "spec-<layer id>".
const SPEC_LAYER_PREFIX = 'spec-';

/**
 * The switches a Layout Spec offers: each group and each layer outside one,
 * never the specimen. The same reading as LayerStack.toggles
 * (assets/js/layer-stack.js), so the ids the build accepts are the ids the
 * stage shows.
 */
function specToggles(spec) {
  return (spec.layers || [])
    .filter((entry) => entry && entry.type !== 'specimen' && typeof entry.id === 'string')
    .map((entry) => ({ id: `${SPEC_LAYER_PREFIX}${entry.id}`, label: entry.label || entry.id }));
}

/**
 * Every Layout Spec in cms/showcase/specs/, saved from the Layout Specs tool
 * (its .layout-spec.json export). Showcase reads them and never writes one:
 * layers are made in Layout Specs only (handovers/HANDOVER-showcase.md, D10).
 */
function loadSpecs(dir, errors) {
  const specs = {};
  if (!fs.existsSync(dir)) return specs;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.layout-spec.json')).sort()) {
    const name = file.replace(/\.layout-spec\.json$/, '');
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      errors.push(`  showcase/specs/${file} — not valid JSON: ${err.message}`);
      continue;
    }
    const canvas = spec && spec.canvas;
    if (!Number.isInteger(spec.version) || !canvas || !(canvas.w > 0) || !(canvas.h > 0) || !Array.isArray(spec.layers)) {
      errors.push(`  showcase/specs/${file} — not a Layout Spec: it needs a version, a canvas with w and h, and layers. Save it again from the Layout Specs tool`);
      continue;
    }
    specs[name] = spec;
  }
  return specs;
}

const TOP_LEVEL_KEYS = new Set([
  'version', 'title', 'description', 'component', 'date', 'published', 'author', 'frames',
  'background', 'theme', 'scale', 'width', 'height', 'props', 'choices', 'specs', 'layers', 'annotations',
  'steps', 'loop',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

const AUTHOR_KEYS = new Set(['name', 'initials', 'avatar']);
const INITIALS = /^[A-Za-z0-9]{1,3}$/;
const AVATAR_PATH = /^assets\/images\/avatars\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|jpeg|webp|svg)$/;

/**
 * cms/showcase/authors.json: who a post can be credited to. "default" is the
 * brand's own handle, used by every post that names no author; its name may
 * be left out, and the generator then shows the deployment's name, so another
 * brand's deployment credits itself without editing this file. An avatar is
 * a path under assets/images/avatars/, or "" to show the initials until the
 * image exists.
 *
 * @returns {{ defaultHandle: string|null, byHandle: object }}
 */
function loadAuthors(dir, errors, rootDir) {
  const file = path.join(dir, 'authors.json');
  const out = { defaultHandle: null, byHandle: {} };
  if (!fs.existsSync(file)) {
    errors.push('  showcase/authors.json — missing: it names the default author and anyone else a post may credit');
    return out;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    errors.push(`  showcase/authors.json — not valid JSON: ${err.message}`);
    return out;
  }
  if (!isObject(data) || !isObject(data.authors)) {
    errors.push('  showcase/authors.json — needs "default" (a handle) and "authors" (handle → { name, initials, avatar })');
    return out;
  }
  for (const [handle, author] of Object.entries(data.authors)) {
    const where = `  showcase/authors.json — authors.${handle}`;
    if (!SLUG.test(handle)) errors.push(`${where}: a handle is kebab-case`);
    if (!isObject(author)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    for (const key of Object.keys(author)) if (!AUTHOR_KEYS.has(key)) errors.push(`${where}: unknown key "${key}"`);
    if ('name' in author && !isString(author.name, 60)) errors.push(`${where}.name, when set, is up to 60 characters`);
    if (!(typeof author.initials === 'string' && INITIALS.test(author.initials))) errors.push(`${where}.initials is 1 to 3 letters or digits, shown until the avatar image exists`);
    if (typeof author.avatar !== 'string') {
      errors.push(`${where}.avatar is a path under assets/images/avatars/, or "" until the image exists`);
    } else if (author.avatar !== '') {
      if (!AVATAR_PATH.test(author.avatar)) errors.push(`${where}.avatar must be assets/images/avatars/<name>.png|jpg|jpeg|webp|svg`);
      else if (!fs.existsSync(path.join(rootDir, author.avatar))) errors.push(`${where}.avatar: no file at ${author.avatar}`);
    }
    out.byHandle[handle] = {
      handle,
      name: typeof author.name === 'string' ? author.name : '',
      initials: String(author.initials || ''),
      avatar: typeof author.avatar === 'string' ? author.avatar : '',
    };
  }
  if (typeof data.default === 'string' && out.byHandle[data.default]) {
    out.defaultHandle = data.default;
  } else {
    errors.push('  showcase/authors.json — "default" must name one of its authors');
  }
  // Only the brand's own entry may leave its name to the deployment; anyone
  // else credited by name needs one, or the card would call them the brand.
  for (const [handle, author] of Object.entries(out.byHandle)) {
    if (handle !== out.defaultHandle && !author.name) errors.push(`  showcase/authors.json — authors.${handle}.name is required (only "${out.defaultHandle || 'default'}" may leave it out)`);
  }
  return out;
}

/**
 * Every value a data-part / data-layer attribute takes in the markup.
 * HTML comments are stripped first, so a commented-out part cannot satisfy a
 * step that points at it.
 */
function attributeValues(html, name) {
  const scannable = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'g');
  const values = [];
  let match;
  while ((match = re.exec(scannable))) values.push(match[1]);
  return values;
}

/**
 * Check one step. Returns a problem string, or null.
 */
function checkStep(step, index, parts) {
  const where = `steps[${index}]`;
  if (!isObject(step)) return `${where} must be an object`;
  const keys = Object.keys(step);
  const target = (name) => (parts.has(step[name]) ? null : `${where}.${name} "${step[name]}" matches no data-part in the markup`);

  if ('wait' in step) {
    if (keys.length !== 1) return `${where}: "wait" takes no other keys`;
    return Number.isInteger(step.wait) && step.wait >= 50 && step.wait <= 10000 ? null : `${where}.wait must be a whole number of ms, 50 to 10000`;
  }
  for (const verb of ['click', 'focus', 'cursor']) {
    if (verb in step) {
      if (keys.length !== 1) return `${where}: "${verb}" takes no other keys`;
      return target(verb);
    }
  }
  if ('blur' in step) {
    if (keys.length !== 1 || step.blur !== true) return `${where}: "blur" is { "blur": true }`;
    return null;
  }
  if ('add' in step || 'remove' in step) {
    const verb = 'add' in step ? 'add' : 'remove';
    if (keys.length !== 2 || !('class' in step)) return `${where}: "${verb}" is { "${verb}": "<part>", "class": "<state class>" }`;
    if (!CLASS_NAME.test(step.class)) return `${where}.class "${step.class}" is not a class name`;
    return target(verb);
  }
  if ('set' in step) {
    if (keys.length !== 3 || !('attr' in step) || !('value' in step)) return `${where}: "set" is { "set": "<part>", "attr": "<aria-* or data-*>", "value": "<text>" }`;
    if (!ARIA_OR_DATA.test(step.attr)) return `${where}.attr "${step.attr}" must be an aria-* or data-* attribute`;
    if (typeof step.value !== 'string') return `${where}.value must be a string`;
    return target('set');
  }
  return `${where} has no known action (wait, click, focus, blur, cursor, add, remove, set)`;
}

/**
 * Check one asset against the contract. Returns a list of problems.
 */
function checkAsset(slug, data, html, knownTokens, specs = {}, authors = null) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!SLUG.test(slug)) fail(`file name "${slug}" must be kebab-case`);
  if (!isObject(data)) return ['settings must be a JSON object'];

  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_KEYS.has(key)) fail(`unknown key "${key}"`);
  }

  if (data.version !== 1) fail('version must be 1');
  if (!isString(data.title, 80)) fail('title is required, up to 80 characters');
  if (!isString(data.description, 200)) fail('description is required, up to 200 characters: it is the caption and the page description');
  if (!(typeof data.component === 'string' && SLUG.test(data.component))) fail('component must be the component\'s doc slug, e.g. "dropdown"');
  if (!(typeof data.date === 'string' && DATE.test(data.date) && !Number.isNaN(Date.parse(data.date)))) fail('date must be YYYY-MM-DD');
  if (typeof data.published !== 'boolean') fail('published must be true or false');
  // author: optional, a handle in authors.json. Left out, the post is the
  // brand's own.
  if ('author' in data) {
    if (!(typeof data.author === 'string' && SLUG.test(data.author))) fail('author, when set, is a handle from showcase/authors.json');
    else if (authors && !authors.byHandle[data.author]) fail(`author "${data.author}" is not in showcase/authors.json`);
  }

  if (!Array.isArray(data.frames) || data.frames.length === 0) {
    fail(`frames must list at least one of: ${Object.keys(FRAMES).join(', ')}`);
  } else {
    for (const frame of data.frames) if (!FRAMES[frame]) fail(`frames: unknown frame "${frame}"`);
    if (new Set(data.frames).size !== data.frames.length) fail('frames lists a frame twice');
  }

  if (!BACKGROUNDS.includes(data.background)) {
    fail(`background must be one of: ${BACKGROUNDS.join(', ')}`);
  } else if (knownTokens && !knownTokens.has(`--${data.background}`)) {
    fail(`background "${data.background}" is not defined in design-system.css`);
  }
  if (!THEMES.includes(data.theme)) fail(`theme must be ${THEMES.join(' or ')}`);
  if (FIXED_GROUNDS[data.background] && THEMES.includes(data.theme) && FIXED_GROUNDS[data.background] !== data.theme) {
    fail(`background "${data.background}" keeps its colour in both themes, and only the ${FIXED_GROUNDS[data.background]} theme's text reads on it`);
  }

  if (!(data.scale === 'fit' || (typeof data.scale === 'number' && data.scale >= 1 && data.scale <= 6))) {
    fail('scale must be "fit" or a number from 1 to 6');
  }
  if ('width' in data && !(Number.isInteger(data.width) && data.width >= 120 && data.width <= 1080)) {
    fail('width, when set, is the artwork\'s natural width in px, 120 to 1080');
  }
  // A menu or popover is laid out outside its trigger's box, so the artwork
  // reserves the height the open state needs, or it is fitted to the closed
  // trigger and the open menu runs off the frame.
  if ('height' in data && !(Number.isInteger(data.height) && data.height >= 40 && data.height <= 1920)) {
    fail('height, when set, is the artwork\'s natural minimum height in px, 40 to 1920');
  }

  if (!isObject(data.props)) {
    fail('props must be an object (use {} for none)');
  } else {
    for (const [key, value] of Object.entries(data.props)) {
      if (!DATA_ATTR.test(key)) fail(`props: "${key}" must be a data-* attribute`);
      if (typeof value !== 'string') fail(`props.${key} must be a string`);
    }
  }

  // choices: the values the edit view offers for a prop, as a select.
  // Optional; a prop without choices is a text field.
  if ('choices' in data) {
    if (!isObject(data.choices)) {
      fail('choices, when set, maps a prop to the values the edit view offers');
    } else {
      for (const [key, list] of Object.entries(data.choices)) {
        if (!isObject(data.props) || !(key in data.props)) fail(`choices: "${key}" is not one of the asset's props`);
        if (!Array.isArray(list) || list.length < 2 || !list.every((v) => typeof v === 'string')) {
          fail(`choices.${key} must list at least two string values ("" removes the attribute)`);
        } else if (isObject(data.props) && !list.includes(data.props[key])) {
          fail(`choices.${key} must include the prop's current value "${data.props[key]}"`);
        }
      }
    }
  }

  // specs: a Layout Spec per frame, drawn over the frame as switchable
  // layers. The spec's canvas must be the frame's shape, or its rules land
  // in the wrong place.
  const specLayers = [];
  if ('specs' in data) {
    if (!isObject(data.specs)) {
      fail('specs, when set, maps a frame to a Layout Spec in cms/showcase/specs/');
    } else {
      for (const [frame, name] of Object.entries(data.specs)) {
        if (!Array.isArray(data.frames) || !data.frames.includes(frame)) fail(`specs: "${frame}" is not one of the asset's frames`);
        const spec = specs[name];
        if (!spec) {
          fail(`specs.${frame}: no spec "${name}" in cms/showcase/specs/ (save it from Layout Specs as ${name}.layout-spec.json)`);
          continue;
        }
        const f = FRAMES[frame];
        if (f && Math.abs(spec.canvas.w / spec.canvas.h - f.width / f.height) > 0.001) {
          fail(`specs.${frame}: "${name}" is ${spec.canvas.w} × ${spec.canvas.h}, not the frame's ${f.width} × ${f.height} shape`);
        }
        specLayers.push(...specToggles(spec).map((t) => t.id));
      }
    }
  }

  const parts = new Set(attributeValues(html, 'data-part'));
  const layers = attributeValues(html, 'data-layer');
  for (const part of parts) if (!PART.test(part)) fail(`markup: data-part "${part}" must be kebab-case`);
  const seenParts = attributeValues(html, 'data-part');
  if (seenParts.length !== parts.size) fail('markup: a data-part value is used twice; each part names one element');
  for (const layer of layers) {
    if (!PART.test(layer)) fail(`markup: data-layer "${layer}" must be kebab-case`);
    if (layer === ANNOTATIONS_LAYER) fail(`markup: data-layer "${ANNOTATIONS_LAYER}" is reserved for the stage`);
  }
  if (!/\sdata-showcase-root(?:[\s>=])/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) {
    fail('markup: one element must carry data-showcase-root (props apply to it)');
  }
  // Ids must carry the asset's slug: the feed puts every asset on one page,
  // and two assets each with id="panel-1" would point one tab at the other's
  // panel.
  for (const id of attributeValues(html, 'id')) {
    if (!id.startsWith(`${slug}-`)) fail(`markup: id "${id}" must start with "${slug}-", so it stays unique on the feed`);
  }
  if (/<script[\s>]/i.test(html)) fail('markup: no <script>. Behaviour is the component\'s own JS, or a step');
  if (/\sstyle\s*=/.test(html)) fail('markup: no inline styles (CLAUDE.md §3). Use the component\'s data-* variation');

  const annotations = Array.isArray(data.annotations) ? data.annotations : null;
  if (!annotations) {
    fail('annotations must be a list (use [] for none)');
  } else {
    annotations.forEach((note, i) => {
      if (!isObject(note)) { fail(`annotations[${i}] must be an object`); return; }
      if (!parts.has(note.target)) fail(`annotations[${i}].target "${note.target}" matches no data-part in the markup`);
      if (!isString(note.text, 60)) fail(`annotations[${i}].text is required, up to 60 characters`);
      if (!SIDES.includes(note.side)) fail(`annotations[${i}].side must be one of: ${SIDES.join(', ')}`);
      for (const key of Object.keys(note)) if (!['target', 'text', 'side'].includes(key)) fail(`annotations[${i}]: unknown key "${key}"`);
    });
  }

  if (!isObject(data.layers)) {
    fail('layers must be an object of default visibility (use {} for none)');
  } else {
    const known = new Set([...layers, ANNOTATIONS_LAYER, ...specLayers]);
    for (const [key, value] of Object.entries(data.layers)) {
      if (!known.has(key)) fail(`layers: "${key}" matches no data-layer in the markup, no layer of its specs, and is not "${ANNOTATIONS_LAYER}"`);
      if (typeof value !== 'boolean') fail(`layers.${key} must be true or false`);
    }
  }

  if (!Array.isArray(data.steps)) {
    fail('steps must be a list (use [] for a still asset)');
  } else {
    data.steps.forEach((step, i) => {
      const problem = checkStep(step, i, parts);
      if (problem) fail(problem);
    });
    if (data.steps.length > 0 && !data.steps.some((step) => 'wait' in step)) {
      fail('steps: a sequence with no "wait" plays faster than anyone can see');
    }
  }
  if (typeof data.loop !== 'boolean') fail('loop must be true or false');

  return problems;
}

/**
 * Every custom property declared in design-system.css, so a background can be
 * checked against tokens that exist rather than a list that could go stale.
 */
function readTokenNames(cssPath) {
  if (!fs.existsSync(cssPath)) return null;
  const css = fs.readFileSync(cssPath, 'utf8');
  const names = new Set();
  const re = /(--[a-z0-9-]+)\s*:/g;
  let match;
  while ((match = re.exec(css))) names.add(match[1]);
  return names;
}

/**
 * Read and check every asset in a directory.
 *
 * @param {string} dir           cms/showcase
 * @param {string} designCssPath assets/css/design-system.css
 * @param {string} [rootDir]     the repo root, where an avatar path resolves;
 *   two levels up from `dir` unless said otherwise
 * @returns {{ assets: object[], errors: string[], authors: object }} assets
 *   newest first, each `{ slug, data, html, specData, author }`; errors already
 *   prefixed with the file they are in
 */
function loadShowcase(dir, designCssPath, rootDir = path.resolve(dir, '..', '..')) {
  if (!fs.existsSync(dir)) return { assets: [], errors: [], authors: { defaultHandle: null, byHandle: {} } };
  const knownTokens = readTokenNames(designCssPath);
  const files = fs.readdirSync(dir);
  const assets = [];
  const errors = [];
  const specs = loadSpecs(path.join(dir, 'specs'), errors);
  const authors = loadAuthors(dir, errors, rootDir);

  // Every .json is an asset's settings, bar the authors list.
  for (const file of files.filter((f) => f.endsWith('.json') && f !== 'authors.json').sort()) {
    const slug = file.replace(/\.json$/, '');
    const htmlPath = path.join(dir, `${slug}.html`);
    if (!fs.existsSync(htmlPath)) {
      errors.push(`  showcase/${file} — needs its markup, ${slug}.html`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      errors.push(`  showcase/${file} — not valid JSON: ${err.message}`);
      continue;
    }
    const html = fs.readFileSync(htmlPath, 'utf8').trim();
    const problems = checkAsset(slug, data, html, knownTokens, specs, authors);
    if (problems.length > 0) {
      for (const problem of problems) errors.push(`  showcase/${slug} — ${problem}`);
      continue;
    }
    // The specs an asset names, by frame, carried with it so a page inlines
    // only what it shows.
    const specData = {};
    for (const [frame, name] of Object.entries(data.specs || {})) specData[frame] = specs[name];
    // Who the post credits, resolved here so the pages never look a handle up.
    const author = authors.byHandle[data.author || authors.defaultHandle] || null;
    assets.push({ slug, data, html, specData, author });
  }

  // A markup file with no settings is a half-made asset nobody will see.
  for (const file of files.filter((f) => f.endsWith('.html'))) {
    const slug = file.replace(/\.html$/, '');
    if (!files.includes(`${slug}.json`)) errors.push(`  showcase/${file} — needs its settings, ${slug}.json`);
  }

  // Newest first, then by title, so the feed order is stable between builds.
  assets.sort((a, b) => (a.data.date === b.data.date
    ? a.data.title.localeCompare(b.data.title)
    : b.data.date.localeCompare(a.data.date)));
  return { assets, errors, authors };
}

/**
 * One asset as the JSON a page inlines for showcase-stage.js. `<` keeps
 * a "</script>" inside the markup from closing the block early.
 */
function serialiseAsset(asset) {
  const out = { slug: asset.slug, ...asset.data, html: asset.html };
  if (asset.specData && Object.keys(asset.specData).length > 0) out.specData = asset.specData;
  return JSON.stringify(out).replace(/</g, '\\u003c');
}

module.exports = {
  FRAMES,
  BACKGROUNDS,
  FIXED_GROUNDS,
  THEMES,
  ANNOTATIONS_LAYER,
  SPEC_LAYER_PREFIX,
  specToggles,
  loadSpecs,
  loadAuthors,
  checkAsset,
  loadShowcase,
  serialiseAsset,
};
