#!/usr/bin/env node
/**
 * bd-sync — pull design system artefacts into a consuming project.
 *
 * Replaces the hand-copied scripts/sync-design-system.js each consuming repo
 * used to carry. Same default destinations as those scripts, so adopting this
 * is a script swap with no path churn:
 *
 *   design-system.css -> assets/css/design-system.css
 *   icons.svg         -> assets/icons/icons.svg
 *   DESIGN.md         -> DESIGN.md
 *   js modules        -> assets/js/design-system/
 *
 * Override any destination with a "bdSync" object in the consumer's
 * package.json: { css, icons, designMd, js, componentCss } — all optional,
 * each a path inside the project.
 *
 * If the consumer has an icons.manifest.json, icons go through bd-sprite
 * instead: a project-sized sprite rather than the full master set. The
 * manifest's own "output" then decides where the sprite lands, taking
 * precedence over bdSync.icons.
 *
 * Directory destinations are overlaid, not replaced: a file this project put
 * in assets/js/design-system/ survives a sync. The trade is that a module
 * dropped upstream lingers until someone deletes it.
 *
 *   npx bd-sync                    sync from the installed package
 *   npx bd-sync --local            sync from ../Design System (built first)
 *   npx bd-sync --local <path>     sync from a design system checkout
 *
 * No dependencies, Node 18+.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_NAME = '@bydefaultstudio/design-system';
const DEFAULT_LOCAL_REPO = path.join('..', 'Design System');
const MANIFEST_NAME = 'icons.manifest.json';

// Matches the destinations the per-repo sync scripts already used.
const DEFAULT_DESTS = {
  css: path.join('assets', 'css', 'design-system.css'),
  icons: path.join('assets', 'icons', 'icons.svg'),
  designMd: 'DESIGN.md',
  js: path.join('assets', 'js', 'design-system'),
  componentCss: path.join('assets', 'css', 'design-system'),
};

const USAGE = `bd-sync — pull ${PACKAGE_NAME} artefacts into this project

  --local [path]   sync from a design system working tree instead of the
                   installed package (default "${DEFAULT_LOCAL_REPO}"); the
                   tree is rebuilt first
  --help           show this message

Destinations come from the "bdSync" object in package.json:
  ${Object.entries(DEFAULT_DESTS).map(([k, v]) => `${k}: "${v}"`).join('\n  ')}`;

// ── source resolution ─────────────────────────────────────────────────────

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

function readVersion(distDir, fallbackDir) {
  const stamp = path.join(distDir, 'version.json');
  if (fs.existsSync(stamp)) {
    try {
      const version = JSON.parse(fs.readFileSync(stamp, 'utf8')).version;
      if (version) return version;
    } catch {
      // fall through to package.json
    }
  }
  const manifest = path.join(fallbackDir, 'package.json');
  if (fs.existsSync(manifest)) {
    try {
      return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Both modes end at the same place: a built dist directory. Local mode just
 * builds it first, so there is one copy path rather than two.
 * @returns {{distDir: string, repoRoot: string|null, label: string, version: string|null}}
 */
function resolveSource({ local, localPath, cwd }) {
  if (local) {
    const repoRoot = path.resolve(cwd, localPath || DEFAULT_LOCAL_REPO);
    const builder = path.join(repoRoot, 'scripts', 'build-package.js');
    if (!fs.existsSync(builder)) {
      throw new Error(
        `no design system checkout at ${repoRoot} (expected scripts/build-package.js)\n` +
          `Point at one with --local <path>.`
      );
    }
    console.log(`bd-sync: building ${repoRoot}\n`);
    const build = spawnSync(process.execPath, ['scripts/build-package.js'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (build.error) throw new Error(`build failed to start: ${build.error.message}`);
    if (build.signal) throw new Error(`build in ${repoRoot} was killed by ${build.signal}`);
    if (build.status !== 0) throw new Error(`build failed in ${repoRoot} (exit ${build.status})`);
    const distDir = path.join(repoRoot, 'dist');
    return {
      distDir,
      repoRoot,
      label: 'local working tree',
      version: readVersion(distDir, repoRoot),
    };
  }

  const packageDir = resolvePackageDir(cwd);
  if (!packageDir) {
    throw new Error(
      `${PACKAGE_NAME} is not installed here — run npm install, or use --local <path> ` +
        `to sync from a design system checkout`
    );
  }
  const distDir = path.join(packageDir, 'dist');
  return { distDir, repoRoot: null, label: 'package', version: readVersion(distDir, packageDir) };
}

// ── destinations ──────────────────────────────────────────────────────────

function readDests(cwdInput) {
  const cwd = path.resolve(cwdInput);
  const manifest = path.join(cwd, 'package.json');
  if (!fs.existsSync(manifest)) return { ...DEFAULT_DESTS };
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (err) {
    throw new Error(`could not parse ${manifest}: ${err.message}`);
  }
  const overrides = pkg.bdSync;
  if (overrides === undefined) return { ...DEFAULT_DESTS };
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('package.json: "bdSync" must be an object');
  }
  const dests = { ...DEFAULT_DESTS };
  for (const [key, value] of Object.entries(overrides)) {
    // hasOwn, not `in`: `in` walks the prototype chain, so "toString" and
    // friends would slip past the typo check.
    if (!Object.hasOwn(DEFAULT_DESTS, key)) {
      throw new Error(
        `package.json: unknown "bdSync" key "${key}" — expected one of ${Object.keys(DEFAULT_DESTS).join(', ')}`
      );
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`package.json: "bdSync.${key}" must be a non-empty string`);
    }
    // Web habits make "/assets/..." a likely typo, and it would resolve to the
    // filesystem root while the summary still printed the string as written.
    if (path.isAbsolute(value)) {
      throw new Error(
        `package.json: "bdSync.${key}" must be relative to the project — got "${value}"`
      );
    }
    const resolved = path.resolve(cwd, value);
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
      throw new Error(
        `package.json: "bdSync.${key}" resolves outside the project — got "${value}"`
      );
    }
    dests[key] = value;
  }
  return dests;
}

// ── copying ───────────────────────────────────────────────────────────────

function copyFileTo(src, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(src, destAbs);
}

// Flat copy — every dist directory this ships is flat. Anything nested is
// counted and surfaced rather than dropped, so a future artefact that grows
// subdirectories can't be reported as fully synced when it wasn't.
function copyDirInto(srcDir, destDirAbs) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const skipped = entries.filter((e) => !e.isFile()).map((e) => e.name);
  if (files.length > 0) {
    fs.mkdirSync(destDirAbs, { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(srcDir, f), path.join(destDirAbs, f));
  }
  return { count: files.length, skipped };
}

// The stamp is the first line of the delivered CSS. Reading it back from the
// destination (not the source) is the point: it proves what actually landed,
// so a half-finished or stale sync is visible at every install.
function readStamp(cssDestAbs) {
  if (!fs.existsSync(cssDestAbs)) return null;
  const firstLine = fs.readFileSync(cssDestAbs, 'utf8').split('\n', 1)[0];
  const match = firstLine.match(/@bydefaultstudio\/design-system v\S+/);
  return match ? match[0] : null;
}

function resolveSpriteBuilder(distDir, repoRoot) {
  const packaged = path.join(distDir, 'tools', 'sprite-builder.js');
  if (fs.existsSync(packaged)) return packaged;
  if (repoRoot) {
    const local = path.join(repoRoot, 'scripts', 'sprite-builder.js');
    if (fs.existsSync(local)) return local;
  }
  return null;
}

function resolveIconSources(distDir, repoRoot) {
  const packaged = path.join(distDir, 'icons', 'src');
  if (fs.existsSync(packaged)) return packaged;
  if (repoRoot) {
    const local = path.join(repoRoot, 'assets', 'images', 'svg-icons');
    if (fs.existsSync(local)) return local;
  }
  return null;
}

// Rows are pushed as copying happens and owned by the caller, so a failure
// part-way through can still report which files already changed on disk.
function copied(rows, label, dest) {
  rows.push({ label, dest });
}
function skipped(rows, label, why) {
  rows.push({ label, note: why });
}

function sync({ cwd, local, localPath, rows }) {
  const source = resolveSource({ local, localPath, cwd });
  const { distDir, repoRoot } = source;
  if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) {
    throw new Error(
      repoRoot
        ? `the build produced no artefacts at ${distDir}`
        : `no built artefacts at ${distDir} — the release is missing its dist directory`
    );
  }
  const dests = readDests(cwd);

  // Resolve everything the icon step needs before writing a single file. It
  // is the most failure-prone step (one typo in the manifest and it throws),
  // and discovering that after four files have landed leaves a half-synced
  // project for no reason.
  const manifestPath = path.join(cwd, MANIFEST_NAME);
  const useManifest = fs.existsSync(manifestPath);
  let builderPath = null;
  let iconSources = null;
  if (useManifest) {
    builderPath = resolveSpriteBuilder(distDir, repoRoot);
    iconSources = resolveIconSources(distDir, repoRoot);
    if (!builderPath || !iconSources) {
      throw new Error(
        `${MANIFEST_NAME} found, but this release ships no icon sources — ` +
          `upgrade ${PACKAGE_NAME} to v2.1.0 or later, or delete ${MANIFEST_NAME} to take the full sprite`
      );
    }
  }

  // design-system.css is the reason this tool exists; anything else missing
  // is reported as skipped so an older or newer release still syncs.
  const cssSrc = path.join(distDir, 'design-system.css');
  if (!fs.existsSync(cssSrc)) {
    throw new Error(`design-system.css missing from ${distDir} — nothing to sync`);
  }
  const cssDest = path.resolve(cwd, dests.css);
  copyFileTo(cssSrc, cssDest);
  copied(rows, 'design-system.css', dests.css);

  const designMdSrc = path.join(distDir, 'DESIGN.md');
  if (fs.existsSync(designMdSrc)) {
    copyFileTo(designMdSrc, path.resolve(cwd, dests.designMd));
    copied(rows, 'DESIGN.md', dests.designMd);
  } else {
    skipped(rows, 'DESIGN.md', 'not in this release');
  }

  syncDir(rows, path.join(distDir, 'js'), cwd, dests.js, 'js', 'module');

  // Component companion CSS lands in v2.1.0; sync it the moment it appears
  // rather than needing a tool update to pick it up.
  if (fs.existsSync(path.join(distDir, 'css'))) {
    syncDir(rows, path.join(distDir, 'css'), cwd, dests.componentCss, 'css', 'file');
  }

  // Icons: a manifest means the project wants a subset sprite, so build one
  // from the release's icon sources. Without a manifest, ship the master.
  let iconsDest = dests.icons;
  if (useManifest) {
    let buildSprite;
    try {
      ({ buildSprite } = require(builderPath));
    } catch (err) {
      throw new Error(`could not load the sprite builder at ${builderPath}: ${err.message}`);
    }
    const built = buildSprite({ manifestPath, sourceDir: iconSources, defaultOutput: dests.icons });
    // The manifest's "output" wins over bdSync.icons, so anything placed
    // "next to the icons" has to follow the sprite, not the default.
    iconsDest = path.relative(cwd, built.output);
    const n = built.names.length;
    copied(rows, `sprite (${n} icon${n === 1 ? '' : 's'} from ${MANIFEST_NAME})`, iconsDest);
  } else {
    const iconsSrc = path.join(distDir, 'icons.svg');
    if (fs.existsSync(iconsSrc)) {
      copyFileTo(iconsSrc, path.resolve(cwd, dests.icons));
      copied(rows, 'icons.svg', dests.icons);
    } else {
      skipped(rows, 'icons.svg', 'not in this release');
    }
  }

  const cursorsSrc = path.join(distDir, 'cursors.svg');
  if (fs.existsSync(cursorsSrc)) {
    const cursorsDest = path.join(path.dirname(iconsDest), 'cursors.svg');
    copyFileTo(cursorsSrc, path.resolve(cwd, cursorsDest));
    copied(rows, 'cursors.svg', cursorsDest);
  }

  return { source, stamp: readStamp(cssDest) };
}

function syncDir(rows, srcDir, cwd, dest, label, noun) {
  if (!fs.existsSync(srcDir)) {
    skipped(rows, label, 'not in this release');
    return;
  }
  const { count, skipped: nested } = copyDirInto(srcDir, path.resolve(cwd, dest));
  if (count === 0) {
    skipped(rows, label, 'empty in this release');
  } else {
    copied(rows, `${label} (${count} ${noun}${count === 1 ? '' : 's'})`, dest);
  }
  if (nested.length > 0) {
    skipped(rows, `${label} subdirectories`, `not copied: ${nested.join(', ')}`);
  }
}

// ── output ────────────────────────────────────────────────────────────────

function printRows(rows, write = console.log) {
  const width = Math.max(...rows.map((r) => r.label.length));
  for (const row of rows) {
    // An arrow means a file landed there. Skipped rows get no arrow, so the
    // destination column never points at something that isn't a path.
    write(
      row.note
        ? `  ${row.label.padEnd(width)}      ${row.note}`
        : `  ${row.label.padEnd(width)}  ->  ${row.dest}`
    );
  }
}

function printSummary({ source, rows, stamp }) {
  const version = source.version ? ` v${source.version}` : '';
  const where = source.repoRoot ? ` (${source.repoRoot})` : '';
  console.log(`\n${PACKAGE_NAME} — synced`);
  console.log(`\n  source  ${source.label}${version}${where}`);
  console.log(`  stamp   ${stamp || 'none found in the delivered CSS'}\n`);
  printRows(rows);
  console.log('');
  // A stamp that disagrees with the source version means the CSS on disk is
  // not the one this release built — surface it rather than let it rot.
  if (source.version && stamp && !stamp.endsWith(`v${source.version}`)) {
    console.warn(`bd-sync: warning — delivered CSS is stamped "${stamp}", expected v${source.version}\n`);
  }
}

// ── cli ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--local') {
      options.local = true;
      const value = argv[i + 1];
      // --local takes an optional path; a following flag is not one. Check for
      // a single leading "-" so "--local -h" prints usage rather than looking
      // for a checkout named "-h".
      if (value && !value.startsWith('-')) {
        options.localPath = value;
        i += 1;
      }
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const rows = [];
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(USAGE);
      return;
    }
    const result = sync({
      cwd: process.cwd(),
      local: options.local,
      localPath: options.localPath,
      rows,
    });
    printSummary({ ...result, rows });
  } catch (err) {
    console.error(`\nbd-sync: ${err.message}`);
    // A copy that fails part-way leaves real files changed. Say which, so the
    // project isn't left in a state nobody knows about.
    if (rows.length > 0) {
      console.error('\nAlready written before the failure:');
      printRows(rows, console.error);
    }
    console.error('');
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { sync, resolveSource, resolvePackageDir, readDests, parseArgs, main };
