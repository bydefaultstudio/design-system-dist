/**
 * asset-library.js — the Asset Library's catalog, read and checked in one place.
 *
 * Three consumers share this module, and each would otherwise re-derive the
 * rules (the icon-aliases.js argument):
 *
 *   generate-docs.js            — {{asset-manifest}} on the tool page, and the
 *                                 generated worker/library-index.mjs
 *   scripts/asset-library/      — the build script validates before it touches
 *                                 a file or the bucket
 *   scripts/verify-asset-library.mjs — the gate in npm test and build:site
 *
 * Two files under cms/asset-library/ (asset-library-plan.md §4.2):
 *
 *   catalog.json — authored. Vocabularies (kits, tag groups) and assets, one
 *                  file each, or a link and its cover. Shape in catalog.schema.json.
 *   lock.json    — written by the build script only. Per-file facts: sha256,
 *                  size, mime, kind, dimensions, ground, thumbnail, fallback
 *                  reason, and whether the objects are in R2.
 *
 * The schema says what a field may hold; this module says what the files must
 * agree on. Anything in `errors` fails the docs build, the same way an
 * invalid `layer:` does: the tool page is generated from this data, and a
 * catalog that names a file the bucket does not hold would ship a Download
 * that 404s.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LIBRARY_DIR = path.join('cms', 'asset-library');
const PIPELINE_VERSION = 1;

/** File kinds the build script sniffs. Never authored — derived from bytes. */
const KINDS = ['raster', 'svg', 'pdf', 'font', 'video', 'archive', 'office', 'other'];
/** Kinds whose thumbnail is a picture of the content, so the asset needs alt text. */
const IMAGE_KINDS = new Set(['raster', 'svg', 'pdf', 'video']);
const THUMB_WIDTHS = [320, 640];

/** Inlined manifest budget (plan §3): past the warning, think about fetching it. */
const MANIFEST_WARN_BYTES = 400 * 1024;
const MANIFEST_FAIL_BYTES = 700 * 1024;

const SHA_PATTERN = /^[0-9a-f]{64}$/;
const FILES_PREFIX = '/files/';

/** The Type filter's values, as the schema's enum. */
const TYPES = ['logo', 'icon', 'image', 'video', 'font', 'document', 'presentation', 'prototype', 'design'];
/** The authored tag groups, in the order the tool lists them. */
const TAG_GROUPS = [
  { id: 'variant', label: 'Variant' },
  { id: 'use', label: 'Use' },
  { id: 'subject', label: 'Subject' },
  { id: 'style', label: 'Style' },
];
/** Generated from a file's dimensions, never authored: declaring one fails. */
const ORIENTATIONS = ['landscape', 'portrait', 'square'];
/** Within this of 1:1 a file is square. */
const SQUARE_TOLERANCE = 0.05;
/** Where a link asset lives, as the dock's Format row names it. */
const LINK_SOURCES = { figma: 'Figma', 'figma-slides': 'Figma Slides', 'google-slides': 'Google Slides', website: 'Website' };

function libraryPaths(rootDir) {
  const dir = path.join(rootDir, LIBRARY_DIR);
  return {
    dir,
    catalog: path.join(dir, 'catalog.json'),
    lock: path.join(dir, 'lock.json'),
    schema: path.join(dir, 'catalog.schema.json'),
  };
}

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`${label}: cannot read ${file} (${error.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: ${file} is not valid JSON (${error.message})`);
  }
}

function emptyLock() {
  return { pipelineVersion: PIPELINE_VERSION, files: {} };
}

/**
 * Read catalog, lock and schema. A repo with no catalog has no library: the
 * tool page renders its empty state and nothing fails — the engine ships
 * without one and a deployment adds files when it has some.
 * @param {string} rootDir repo root
 * @returns {{ catalog: object|null, lock: object, paths: object }}
 */
function loadLibrary(rootDir) {
  const paths = libraryPaths(rootDir);
  if (!fs.existsSync(paths.catalog)) return { catalog: null, lock: emptyLock(), paths };
  const catalog = readJson(paths.catalog, 'asset library');
  const lock = fs.existsSync(paths.lock) ? readJson(paths.lock, 'asset library') : emptyLock();
  return { catalog, lock, paths };
}

let compiledSchema = null;
function schemaValidator(rootDir) {
  if (!compiledSchema) {
    const schema = readJson(libraryPaths(rootDir).schema, 'asset library');
    // Required here, not at the top: the docs kit ships this module to
    // consumers whose package depends on marked alone, and only a project
    // with a catalog reaches this line.
    const Ajv2020 = require('ajv/dist/2020');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    compiledSchema = ajv.compile(schema);
  }
  return compiledSchema;
}

function basenameOf(file) {
  return file.slice(file.lastIndexOf('/') + 1);
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * A download filename the Worker can put in Content-Disposition and a URL
 * path segment can carry: printable, no quotes or backslashes (they end the
 * quoted-string), no slashes, not a dotfile, not `..`.
 */
function isSafeFilename(name) {
  if (!name || name === '.' || name === '..' || name.startsWith('.')) return false;
  if (/[\u0000-\u001f\u007f"\\/]/.test(name)) return false;
  if (name !== name.trim()) return false;
  return true;
}

function isLinkOnlyFont(asset) {
  return asset.type === 'font' && asset.licence === 'link-only';
}

/**
 * An asset whose file is never offered: a link-only font (the licence
 * forbids it) or a link asset (its file is the cover). The build uploads its
 * thumbnails and no original, and the Worker index leaves it out.
 */
function isThumbOnly(asset) {
  return isLinkOnlyFont(asset) || Boolean(asset.link);
}

/** landscape, portrait or square from a file's dimensions; null without them. */
function orientationOf(width, height) {
  if (!width || !height) return null;
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return 'square';
  return ratio > 1 ? 'landscape' : 'portrait';
}

/**
 * Everything the schema cannot say. Returns errors (fail the build) and
 * warnings (printed). `lock` is required for the agreement checks; the build
 * script passes `requireLock: false` on its first pass, before it has written
 * one, and gets only the catalog's own problems back.
 * @param {object} catalog
 * @param {object} lock
 * @param {{ rootDir: string, requireLock?: boolean }} options
 */
function validateCatalog(catalog, lock, options) {
  const errors = [];
  const warnings = [];
  const requireLock = options.requireLock !== false;
  const where = (asset) => `asset "${asset && asset.id ? asset.id : '?'}"`;

  const validate = schemaValidator(options.rootDir);
  if (!validate(catalog)) {
    for (const problem of validate.errors) {
      errors.push(`catalog.json ${problem.instancePath || '/'} ${problem.message}`);
    }
    // Shape errors make the checks below meaningless; report them alone.
    return { errors, warnings };
  }

  const kitIds = new Set();
  for (const kit of catalog.kits) {
    if (kitIds.has(kit.id)) errors.push(`kit "${kit.id}" is declared twice`);
    kitIds.add(kit.id);
  }
  // One id, one group: a filter tag must mean one thing wherever it shows.
  // Nor may it be a type's word or a kit's id: typed into search, a tag wins,
  // and would silently take over the Type chip or the kit.
  const typeWords = new Set(TYPES.flatMap((t) => [t, `${t}s`]));
  const tagIds = new Set();
  for (const group of TAG_GROUPS) {
    for (const tag of catalog.tags[group.id]) {
      if (ORIENTATIONS.includes(tag)) errors.push(`tag "${tag}" is generated from a file's dimensions; remove it from tags.${group.id}`);
      // The For group is the exception by design: "presentation" is a use,
      // and the type answers to "presentations" and "deck".
      else if (group.id !== 'use' && typeWords.has(tag)) errors.push(`tag "${tag}" is a type's name; typed into search it would shadow the Type chip`);
      else if (kitIds.has(tag)) errors.push(`tag "${tag}" is also a kit's id`);
      else if (tagIds.has(tag)) errors.push(`tag "${tag}" is declared in two groups`);
      tagIds.add(tag);
    }
  }

  const lockFiles = (lock && lock.files) || {};
  const lockCurrent = lock && lock.pipelineVersion === PIPELINE_VERSION;
  if (requireLock && lock && lock.pipelineVersion !== undefined && !lockCurrent) {
    errors.push(`lock.json is pipelineVersion ${lock.pipelineVersion}; this engine writes ${PIPELINE_VERSION} — run \`npm run asset-library:build\``);
  }

  const assetIds = new Set();
  const seenFiles = new Map(); // file path → asset id, across the catalog
  for (const asset of catalog.assets) {
    if (assetIds.has(asset.id)) errors.push(`${where(asset)} is declared twice`);
    assetIds.add(asset.id);

    for (const kit of asset.kits || []) {
      if (!kitIds.has(kit)) errors.push(`${where(asset)} names kit "${kit}", which kits[] does not declare`);
    }
    for (const tag of asset.tags || []) {
      if (!tagIds.has(tag)) errors.push(`${where(asset)} carries tag "${tag}", which no tag group declares — add it to the vocabulary or drop it`);
    }
    if (!asset.description) warnings.push(`${where(asset)} has no description`);
    if (!asset.tags || !asset.tags.length) warnings.push(`${where(asset)} has no tags`);

    const names = new Set();
    let hasImage = false;
    for (const rendition of asset.files) {
      const name = basenameOf(rendition.file);
      if (!isSafeFilename(name)) errors.push(`${where(asset)} file "${rendition.file}" has a name the Worker cannot serve (quotes, backslashes, control characters, a leading dot)`);
      if (names.has(name)) errors.push(`${where(asset)} lists "${name}" twice — two renditions cannot share a filename, it is the download URL`);
      names.add(name);
      const owner = seenFiles.get(rendition.file);
      if (owner) errors.push(`file "${rendition.file}" belongs to both "${owner}" and "${asset.id}"`);
      seenFiles.set(rendition.file, asset.id);

      if (!requireLock) continue;
      const entry = lockFiles[rendition.file];
      if (!entry) {
        errors.push(`${where(asset)} file "${rendition.file}" has no lock entry — run \`npm run asset-library:build\``);
        continue;
      }
      if (!SHA_PATTERN.test(entry.sha || '')) errors.push(`lock: "${rendition.file}" has no sha256`);
      if (!KINDS.includes(entry.kind)) errors.push(`lock: "${rendition.file}" has kind "${entry.kind}", not one of ${KINDS.join(', ')}`);
      if (entry.pipelineVersion !== PIPELINE_VERSION) errors.push(`lock: "${rendition.file}" was built by pipeline ${entry.pipelineVersion}; run \`npm run asset-library:build\``);
      if (entry.uploaded !== true) errors.push(`lock: "${rendition.file}" is not uploaded — run \`npm run asset-library:build\` on a machine that holds library/`);
      if (!entry.thumb && !entry.fallback) errors.push(`lock: "${rendition.file}" has neither a thumbnail nor a fallback reason`);
      if (isThumbOnly(asset)) {
        if (entry.original !== null) errors.push(`lock: "${rendition.file}" is ${asset.link ? 'a link asset\'s cover' : 'a link-only font'} but its original is in the bucket — the build must not upload it`);
        if (asset.link && (!entry.thumb || !['raster', 'svg'].includes(entry.kind))) errors.push(`${where(asset)} is a link asset whose cover "${rendition.file}" is a ${entry.kind}, not an image — a cover must be a raster or an SVG`);
        if (asset.link && rendition.label) warnings.push(`${where(asset)} labels its cover "${rendition.label}", which the tool never shows — a link's Format is its source`);
      } else if (entry.original !== `o/${entry.sha}`) {
        errors.push(`lock: "${rendition.file}" original key is "${entry.original}", expected "o/${entry.sha}"`);
      }
      if (IMAGE_KINDS.has(entry.kind)) hasImage = true;
    }
    if (requireLock && hasImage && !asset.alt) {
      errors.push(`${where(asset)} shows an image but has no alt text`);
    }
  }

  if (requireLock) {
    for (const file of Object.keys(lockFiles)) {
      if (!seenFiles.has(file)) warnings.push(`lock: "${file}" is in the lock but no asset lists it (the build script's --prune removes its objects)`);
    }
  }

  return { errors, warnings };
}

function thumbFor(entry) {
  if (!entry || !entry.thumb) return null;
  const size = { width: entry.thumb.width || null, height: entry.thumb.height || null };
  if (entry.thumb.kind === 'svg') {
    return Object.assign({ kind: 'svg', src: `${FILES_PREFIX}_t/${entry.sha}.svg` }, size);
  }
  return Object.assign({
    kind: 'webp',
    src: THUMB_WIDTHS.map((w) => `${FILES_PREFIX}_t/${entry.sha}-${w}.webp`),
    widths: THUMB_WIDTHS,
    hash: entry.thumb.hash || null,
  }, size);
}

/**
 * The data the tool page inlines (plan §1.9, §3). Everything the grid, the
 * search and the dock read; nothing the Worker needs. Assets sort newest
 * first, ties by title, so the page's default order is in the data.
 */
function buildManifest(catalog, lock) {
  const lockFiles = (lock && lock.files) || {};
  const kits = catalog ? catalog.kits.map((k) => ({ id: k.id, title: k.title, client: k.client || null })) : [];
  // Orientation joins the authored groups, holding only what the files have.
  const orientations = new Set();
  const assets = (catalog ? catalog.assets : []).map((asset) => {
    const files = asset.files.map((rendition) => {
      const entry = lockFiles[rendition.file] || {};
      const name = basenameOf(rendition.file);
      const ext = extensionOf(name);
      return {
        name,
        label: asset.link ? LINK_SOURCES[asset.link.source] : rendition.label || ext.toUpperCase(),
        format: asset.link ? asset.link.source : ext,
        kind: entry.kind || 'other',
        mime: entry.mime || 'application/octet-stream',
        size: entry.size || 0,
        width: entry.width || null,
        height: entry.height || null,
        alpha: entry.alpha === true,
        ground: rendition.ground || entry.ground || 'light',
        meta: entry.meta || null,
        fallback: entry.fallback || null,
        thumb: thumbFor(entry),
        url: isThumbOnly(asset) ? null : `${FILES_PREFIX}${asset.id}/${name}`,
      };
    });
    // A link's cover is a picture of the thing, not the thing: no orientation.
    const orientation = asset.link ? null : orientationOf(files[0].width, files[0].height);
    if (orientation) orientations.add(orientation);
    return {
      id: asset.id,
      title: asset.title,
      type: asset.type,
      kits: asset.kits || [],
      tags: asset.tags || [],
      orientation,
      link: asset.link ? { url: asset.link.url, source: asset.link.source } : null,
      description: asset.description || '',
      alt: asset.alt || '',
      added: asset.added,
      licence: asset.licence || null,
      licenceUrl: asset.licenceUrl || null,
      licenceFoundry: asset.licenceFoundry || null,
      related: asset.related ? asset.related.tool : null,
      files,
    };
  }).sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1
    : a.title.localeCompare(b.title, 'en') || (a.id < b.id ? -1 : 1)));
  const tagGroups = TAG_GROUPS.map((g) => ({ id: g.id, label: g.label, tags: catalog ? catalog.tags[g.id].slice() : [] }));
  tagGroups.push({ id: 'orientation', label: 'Orientation', tags: ORIENTATIONS.filter((o) => orientations.has(o)) });
  return { kits, tagGroups, assets };
}

/**
 * The Worker's lookup: "<asset id>/<filename>" → [object key, mime, size].
 * Link-only fonts and link covers have no entry, so their bytes are unreachable even if
 * someone guesses the URL. Sorted, so two builds of one tree are identical.
 */
function buildIndex(catalog, lock) {
  const lockFiles = (lock && lock.files) || {};
  const entries = [];
  for (const asset of catalog ? catalog.assets : []) {
    if (isThumbOnly(asset)) continue;
    for (const rendition of asset.files) {
      const entry = lockFiles[rendition.file];
      // Fail closed per file: an entry whose objects are not confirmed in the
      // bucket is not offered, whatever else the catalog says.
      if (!entry || !entry.original || entry.uploaded !== true) continue;
      entries.push([`${asset.id}/${basenameOf(rendition.file)}`, [entry.original, entry.mime || 'application/octet-stream', entry.size || 0]]);
    }
  }
  return entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function renderLibraryIndex(entries) {
  const banner = `/**
 * library-index.mjs — GENERATED by cms/generator/generate-docs.js, do not edit.
 *
 * Every downloadable file in the Asset Library (cms/asset-library/catalog.json
 * + lock.json), as "<asset id>/<filename>" → [R2 object key, mime, size].
 * worker/library.js answers /files/<id>/<filename> from this map and nothing
 * else: a path not here is a 404 whatever the bucket holds, so removing an
 * asset from the catalog revokes its download on the next deploy. Link-only
 * fonts and link assets' covers are deliberately absent. To change it, edit the catalog and re-run:
 * cd cms/generator && npm run docgen.
 */
`;
  const body = entries.length
    ? `export const LIBRARY_INDEX = new Map([\n${entries.map(([k, v]) => `  [${JSON.stringify(k)}, ${JSON.stringify(v)}],`).join('\n')}\n]);\n`
    : 'export const LIBRARY_INDEX = new Map();\n';
  return banner + body;
}

/** JSON for a <script type="application/json"> block: no "</script>", no "<!--". */
function manifestJson(manifest) {
  return JSON.stringify(manifest).replace(/</g, '\\u003c');
}

module.exports = {
  LIBRARY_DIR,
  PIPELINE_VERSION,
  KINDS,
  IMAGE_KINDS,
  THUMB_WIDTHS,
  MANIFEST_WARN_BYTES,
  MANIFEST_FAIL_BYTES,
  FILES_PREFIX,
  libraryPaths,
  loadLibrary,
  validateCatalog,
  buildManifest,
  buildIndex,
  renderLibraryIndex,
  manifestJson,
  isSafeFilename,
  isLinkOnlyFont,
  isThumbOnly,
  orientationOf,
  TYPES,
  TAG_GROUPS,
  ORIENTATIONS,
  LINK_SOURCES,
  basenameOf,
  extensionOf,
};
