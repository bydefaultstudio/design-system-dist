#!/usr/bin/env node
/**
 * bd-sprite — build a project icon sprite from a manifest.
 *
 * The design system ships every icon as an individual source file alongside
 * one master sprite. Most projects reference a handful, so shipping every
 * symbol to every site is waste. This assembles a sprite from a named
 * subset plus any site-local SVGs the project owns:
 *
 *   {
 *     "output": "assets/icons/icons.svg",
 *     "icons": ["arrow-right", "close"],
 *     "local": ["assets/icons/local"]
 *   }
 *
 * `icons` are design system icon names (no .svg suffix), `local` is an
 * optional list of directories holding the project's own SVGs. Every path
 * resolves relative to the manifest's own directory.
 *
 * Symbol assembly (viewBox fallback, id namespacing, fill="none") is shared
 * with the design system's own sprite build, so a subset sprite and the
 * master sprite render identically.
 *
 *   npx bd-sprite [--manifest <path>] [--source <dir>]
 *
 * No dependencies, Node 18+.
 */
const fs = require('fs');
const path = require('path');
const { extractInner, extractViewBox, namespaceIds } = require('./build-icon-sprite.js');

const PACKAGE_NAME = '@bydefaultstudio/design-system';
const DEFAULT_MANIFEST = 'icons.manifest.json';
const DEFAULT_OUTPUT = path.join('assets', 'icons', 'icons.svg');

const USAGE = `bd-sprite — build an icon sprite from ${DEFAULT_MANIFEST}

  --manifest <path>   manifest to read (default ./${DEFAULT_MANIFEST})
  --source <dir>      design system icon sources (default: the installed
                      ${PACKAGE_NAME} package)
  --help              show this message`;

// ── icon sources ──────────────────────────────────────────────────────────

// Locate the installed package. require.resolve honours the consumer's own
// module layout (workspaces, pnpm, hoisting); the manual walk is the fallback
// for the cases it can't see — notably when this file has been copied out of
// node_modules, so its own resolution paths point somewhere unhelpful.
function resolvePackageDir(fromDir) {
  try {
    return path.dirname(
      require.resolve(`${PACKAGE_NAME}/package.json`, { paths: [fromDir, __dirname] })
    );
  } catch {
    let dir = path.resolve(fromDir);
    for (;;) {
      const candidate = path.join(dir, 'node_modules', ...PACKAGE_NAME.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

// --source wins, then the installed package, then this repo's own sources
// (the path that exists only when the script runs from a design system
// checkout rather than from dist/tools).
function assertDirectory(dir, label) {
  if (!fs.existsSync(dir)) throw new Error(`${label} directory not found: ${dir}`);
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${label} is not a directory: ${dir}`);
  return dir;
}

function resolveIconSource(sourceFlag, cwd) {
  if (sourceFlag) {
    return assertDirectory(path.resolve(cwd, sourceFlag), '--source');
  }
  const packageDir = resolvePackageDir(cwd);
  if (packageDir) {
    const dir = path.join(packageDir, 'dist', 'icons', 'src');
    if (fs.existsSync(dir)) return dir;
    // The package is here but predates the icon sources, so there is nothing
    // to subset. Say that rather than "not installed".
    throw new Error(
      `${PACKAGE_NAME} is installed but ships no icon sources — upgrade to v2.1.0 or later, ` +
        `or pass --source <dir>`
    );
  }
  const repoDir = path.resolve(__dirname, '..', 'assets', 'images', 'svg-icons');
  if (fs.existsSync(repoDir)) return repoDir;
  throw new Error(
    `no design system icon sources found — install ${PACKAGE_NAME} or pass --source <dir>`
  );
}

// The stamp reports which release the symbols came from, so a stale sprite is
// visible in a diff. Walk up from the source dir: dist/icons/src resolves to
// the installed package, assets/images/svg-icons to this repo. The name check
// matters for --source, which can point anywhere — stamping a sprite with the
// consuming project's version would defeat the whole point of the stamp.
function nearestPackageVersion(fromDir) {
  let dir = path.resolve(fromDir);
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
      } catch {
        // unreadable package.json — keep walking rather than fail the build
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── manifest ──────────────────────────────────────────────────────────────

// A symbol id becomes an XML attribute value and a `<use href="#name">`
// fragment. Design system icons are curated kebab-case, but `local` points at
// consumer directories where "Frame 1 & 2.svg" is an ordinary Figma export —
// interpolated raw, that yields a sprite no browser can parse, with no error.
// Enforce the same kebab-case the design system uses.
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readSvgDir(dir) {
  const icons = new Map();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.svg') || file.startsWith('_')) continue;
    icons.set(path.basename(file, '.svg'), path.join(dir, file));
  }
  return icons;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`could not parse ${manifestPath}: ${err.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${manifestPath}: expected a JSON object`);
  }
  // A typo'd key ("iocns") would otherwise build a sprite missing every icon
  // the project asked for, and say nothing.
  const KEYS = ['output', 'icons', 'local'];
  const unknown = Object.keys(manifest).filter((k) => !KEYS.includes(k));
  if (unknown.length > 0) {
    throw new Error(
      `${manifestPath}: unknown key${unknown.length === 1 ? '' : 's'} ${unknown.map((k) => `"${k}"`).join(', ')} — expected ${KEYS.join(', ')}`
    );
  }
  for (const key of ['icons', 'local']) {
    const value = manifest[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
      throw new Error(`${manifestPath}: "${key}" must be an array of non-empty strings`);
    }
  }
  if (manifest.output !== undefined && (typeof manifest.output !== 'string' || !manifest.output.trim())) {
    throw new Error(`${manifestPath}: "output" must be a non-empty string`);
  }
  return manifest;
}

// ── build ─────────────────────────────────────────────────────────────────

function listErrors(heading, lines) {
  return [heading, ...lines.map((line) => `  - ${line}`)].join('\n');
}

/**
 * Assemble the sprite described by a manifest.
 * Throws on any misconfiguration; the CLI turns that into exit 1.
 * @returns {{output: string, names: string[], version: string|null}}
 */
function buildSprite({ manifestPath, sourceDir, defaultOutput } = {}) {
  if (typeof sourceDir !== 'string' || !sourceDir.trim()) {
    throw new Error('buildSprite: sourceDir is required');
  }
  const resolvedManifest = path.resolve(manifestPath || DEFAULT_MANIFEST);
  const manifest = readManifest(resolvedManifest);
  const manifestDir = path.dirname(resolvedManifest);
  const manifestLabel = path.basename(resolvedManifest);
  const source = assertDirectory(path.resolve(sourceDir), 'icon source');
  const available = readSvgDir(source);

  // requested design system icons
  const requested = manifest.icons || [];
  const missing = requested.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(
      listErrors(
        `${manifestLabel}: ${missing.length} icon${missing.length === 1 ? '' : 's'} not found in the design system icon set (${source}):`,
        missing
      )
    );
  }
  const entries = new Map();
  for (const name of requested) entries.set(name, available.get(name));

  // site-local icons
  const collisions = [];
  const badNames = [];
  const emptyDirs = [];
  const localOrigin = new Map();
  const seenDirs = new Set();
  for (const rel of manifest.local || []) {
    const dir = path.resolve(manifestDir, rel);
    assertDirectory(dir, `${manifestLabel}: local icon directory`);
    // Two spellings of one directory ("icons" and "./icons") would otherwise
    // report every icon in it as a duplicate of itself.
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    const found = readSvgDir(dir);
    // A renamed or moved folder still resolves; without this it would ship a
    // sprite silently missing every local symbol.
    if (found.size === 0) {
      emptyDirs.push(rel);
      continue;
    }
    for (const [name, file] of found) {
      if (!NAME_RE.test(name)) {
        badNames.push(`${name}.svg (${rel})`);
        continue;
      }
      if (available.has(name)) {
        collisions.push(`${name}.svg (${rel}) shadows design system icon "${name}"`);
        continue;
      }
      if (localOrigin.has(name)) {
        collisions.push(`${name}.svg (${rel}) duplicates ${name}.svg (${localOrigin.get(name)})`);
        continue;
      }
      localOrigin.set(name, rel);
      entries.set(name, file);
    }
  }
  if (emptyDirs.length > 0) {
    throw new Error(
      listErrors(`${manifestLabel}: local icon directories contain no .svg files:`, emptyDirs)
    );
  }
  if (badNames.length > 0) {
    throw new Error(
      listErrors(
        `${manifestLabel}: local icon names must be kebab-case (a-z, 0-9, hyphens) — a symbol id ` +
          `is an XML attribute and a "#name" reference, so rename these:`,
        badNames
      )
    );
  }
  if (collisions.length > 0) {
    throw new Error(
      listErrors(`${manifestLabel}: local icon names conflict — rename them:`, collisions)
    );
  }

  if (entries.size === 0) {
    throw new Error(`${manifestLabel}: no icons selected — nothing to build`);
  }

  const names = [...entries.keys()].sort();
  const symbols = names.map((name) => {
    const svg = fs.readFileSync(entries.get(name), 'utf8');
    const viewBox = extractViewBox(svg);
    const inner = namespaceIds(extractInner(svg), name);
    // fill="none" reproduces the source icons' root <svg fill="none">
    // context: painted paths carry explicit fill="currentColor", but
    // stroke-only shapes would otherwise default to a black fill.
    return `  <symbol id="${name}" viewBox="${viewBox}" fill="none">${inner}</symbol>`;
  });

  const version = nearestPackageVersion(source);
  const output = path.resolve(manifestDir, manifest.output || defaultOutput || DEFAULT_OUTPUT);
  const sprite = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- Generated by ${PACKAGE_NAME} bd-sprite from ${manifestLabel}. Do not edit. -->`,
    ...(version ? [`<!-- ${PACKAGE_NAME} v${version} -->`] : []),
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">`,
    ...symbols,
    `</svg>`,
    ``,
  ].join('\n');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, sprite);
  return { output, names, version };
}

// ── cli ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--manifest' || arg === '--source') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(USAGE);
      return;
    }
    const cwd = process.cwd();
    const manifestPath = path.resolve(cwd, options.manifest || DEFAULT_MANIFEST);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `manifest not found: ${manifestPath}\n\nCreate one, or point at it with --manifest <path>:\n` +
          `  {\n    "output": "${DEFAULT_OUTPUT}",\n    "icons": ["arrow-right", "close"]\n  }`
      );
    }
    const sourceDir = resolveIconSource(options.source, cwd);
    const { output, names, version } = buildSprite({ manifestPath, sourceDir });
    const stamp = version ? ` from ${PACKAGE_NAME} v${version}` : '';
    const count = `${names.length} symbol${names.length === 1 ? '' : 's'}`;
    console.log(`bd-sprite: wrote ${count}${stamp} -> ${path.relative(cwd, output)}`);
  } catch (err) {
    console.error(`bd-sprite: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildSprite, resolveIconSource, resolvePackageDir, nearestPackageVersion, main };
