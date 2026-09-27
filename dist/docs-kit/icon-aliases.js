/**
 * icon-aliases.js — one reader for icons.aliases.json.
 *
 * Deprecated icon names are kept as byte-identical source files so consumer
 * manifests keep resolving, but they must stay out of every browsable surface
 * — the registry, llms.txt, the search index — or one glyph shows two names.
 * Four build scripts need that list; before this module each parsed the file
 * itself, and the newest copy was the weakest (no try/catch, no lowercase).
 * Same argument portable.js makes: one predicate, several consumers.
 *
 * Two readers with two contracts, on purpose:
 *   readIconAliases()   → Set of deprecated names. Warns and returns an empty
 *                         set on a bad file, because a docs build should still
 *                         produce pages when the alias file is broken.
 *   readIconAliasMap()  → the raw { old: { renamedTo, since } } object. Throws
 *                         on a bad file, because the sprite build verifies
 *                         alias pairs and must fail loudly rather than ship a
 *                         stale glyph to the legacy consumers the alias protects.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve the alias file. Beside the icons first — that's where the package
 * puts it for consumers building against dist/icons/src — then the project
 * root, for this repo.
 * @param {{ rootDir: string, iconsDir?: string }} opts
 * @returns {string|null}
 */
function resolveAliasFile({ rootDir, iconsDir }) {
  const candidates = [];
  if (iconsDir) candidates.push(path.join(iconsDir, '..', 'aliases.json'));
  candidates.push(path.join(rootDir, 'icons.aliases.json'));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * @param {{ rootDir: string, iconsDir?: string }} opts
 * @returns {Record<string, { renamedTo: string, since?: string }>}
 */
function readIconAliasMap(opts) {
  const file = resolveAliasFile(opts);
  if (!file) return {};
  const aliases = JSON.parse(fs.readFileSync(file, 'utf8')).aliases;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new Error(`${path.basename(file)} has no "aliases" object`);
  }
  return aliases;
}

/**
 * @param {{ rootDir: string, iconsDir?: string, surface?: string, warn?: (msg: string) => void }} opts
 *   surface names what leaks when this fails — "the registry", "llms.txt",
 *   "site search" — so an operator can tell which output to distrust.
 * @returns {Set<string>} deprecated icon keys, lowercased
 */
function readIconAliases(opts) {
  const warn = opts.warn || ((msg) => console.warn(`⚠️  ${msg}`));
  const surface = opts.surface || 'this output';
  const file = resolveAliasFile(opts);
  if (!file) return new Set();

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    warn(`${path.basename(file)} is unreadable (${err.message}) — deprecated icon names will show in ${surface}`);
    return new Set();
  }
  // Distinct from unreadable: the file parses, it just says nothing about
  // aliases. Reporting that as "unreadable" sends the reader to the wrong fix.
  const aliases = parsed.aliases;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    warn(`${path.basename(file)} has no "aliases" object — deprecated icon names will show in ${surface}`);
    return new Set();
  }
  return new Set(Object.keys(aliases).map((k) => k.toLowerCase()));
}

module.exports = { readIconAliases, readIconAliasMap, resolveAliasFile };
