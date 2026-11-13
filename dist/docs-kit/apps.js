/**
 * apps.js - the apps a site installs (engine parity phase B, D2, D14, D15).
 *
 * Every app ships in the package: its manifest and page body
 * (<slug>.md, <slug>.html), and the scripts and styles it names. A site
 * says which packages it has in docs.config.js (`install`), and only those
 * apps get pages and files. An app's files land at the same path on every
 * site, so an app installed on two sites behaves the same on both (D1).
 *
 * The manifest is the app's own frontmatter (flat `key: value`, lists
 * comma-separated):
 *   version   the app's version, which /os.json reports (phase F)
 *   status    stable · beta · draft. A draft installs only with allowDraft
 *   package   core · brand · web · formats · utilities · internal
 *   needs     shared libraries (libraries.json), loaded once, before it
 *   scripts   its own scripts, styles its own stylesheets
 *   files     files it loads itself at runtime: shipped, never tagged
 *   gate      "true" when it needs the access gate (People)
 *   embed     a page other sites frame, public and embeddable while the app
 *             is installed (the gate reads it from page-access.mjs APPS)
 *   guide     its guide page's source, a cms/*.md file name. It ships with
 *             the app, and a site's own file of that name replaces it (PB-3)
 *
 * A site's own cms/apps/<slug>.md or .html replaces the package's copy, as
 * a deliberate override, and the build says so.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// The packages a site switches on (D15), and the one it can't: internal
// apps are By Default OS's own plumbing (D2), never installable elsewhere.
const PACKAGES = {
  core: { always: true },
  brand: {},
  web: {},
  formats: { needs: ['brand'] },
  utilities: {},
  internal: { home: true },
};
const STATUSES = ['stable', 'beta', 'draft'];
// The sections a package brings, by output folder (D14). A section whose
// package is off generates no pages, no index and no home card; any other
// section is the site's own and always builds. The web package's section
// is Components since 2026-11-12 (mediasystem.md decision 44); `web` stays
// so a site that still builds a Web section keeps it package-gated.
const SECTION_PACKAGES = { brand: 'brand', components: 'web', web: 'web', formats: 'formats' };

/**
 * The engine's fixed addresses (worker/engine-paths.mjs, PD-2), the one
 * module the gate reads too. It sits beside the docs kit in the package
 * (dist/worker/) and two folders up in the engine's repo. An ES module,
 * required here, which Node supports from 20.19 and 22.12.
 */
function loadEnginePaths() {
  const candidates = [
    path.join(__dirname, '..', 'worker', 'engine-paths.mjs'),
    path.join(__dirname, '..', '..', 'worker', 'engine-paths.mjs'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`The engine's addresses are missing (looked for ${candidates.join(' and ')}). Reinstall the package.`);
  try {
    return require(file).ENGINE_PATHS;
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ESM') throw new Error(`The docs kit needs Node 20.19 or later on 20, or 22.12 or later, which can load ${path.basename(file)}. This is Node ${process.versions.node}.`);
    throw err;
  }
}
const ENGINE_PATHS = loadEnginePaths();

/** A site address as the generator's filenameOverrides write it: one folder at most. */
function addressOf(sitePath) {
  const match = /^\/(?:([a-z0-9-]+)\/)?([a-z0-9-]+\.html)$/.exec(sitePath);
  if (!match) throw new Error(`engine-paths.mjs: ${sitePath} isn't a page address the generator can build.`);
  return { folder: match[1] || '', name: match[2] };
}

// The engine's own pages, which ship beside the guides and build on every
// site that installs; a site's own file of the name replaces one. Each
// carries the address it is built at, the same on every site, and is a page
// of no section (standalone).
//   not-installed.md  an app a site doesn't install (PB-4)
//   search.md         every search result, and where a ?q= link lands (C1)
//   auth-login.md     the sign-in page, a bare page (phase D, D26)
//   support.md        Ask for access, a bare page anyone can reach (PD-4)
//   locked.md         what a signed-in reader meets at a page their account
//                     can't open, served by the Worker at that page's address
//   not-found.md      what a signed-in reader meets at an address with no page
//   error.md          what anyone meets when the Worker fails to answer
// The last five are served by the access gate's Worker, built only where it is on
// (`gate`). Pages the Worker serves at other pages' addresses take
// site-absolute links (`base`).
const NOT_INSTALLED_PAGE = 'not-installed.md';
const ENGINE_PAGES = {
  [NOT_INSTALLED_PAGE]: { ...addressOf(ENGINE_PATHS.notInstalled), base: '/', standalone: true },
  'search.md': { ...addressOf(ENGINE_PATHS.search), standalone: true },
  'auth-login.md': { ...addressOf(ENGINE_PATHS.login), standalone: true, gate: true },
  'support.md': { ...addressOf(ENGINE_PATHS.support), standalone: true, gate: true },
  'locked.md': { ...addressOf(ENGINE_PATHS.locked), base: '/', standalone: true, gate: true },
  'not-found.md': { ...addressOf(ENGINE_PATHS.notFound), base: '/', standalone: true, gate: true },
  'error.md': { ...addressOf(ENGINE_PATHS.error), base: '/', standalone: true, gate: true },
};

/**
 * The access gate's own files (phase D), installed wherever accessGate is
 * on, at the same paths on every site, the way an app's files are: copied
 * from the package, and a site's own different copy at one of these paths
 * stops the build. `everyPage` load on every page of the docs layout (the
 * session check and account menu, and the locked page's Ask for access,
 * which the Worker serves at any address); `pages` are loaded only by the
 * engine pages that name them in their `scripts:` (the sign-in page, the
 * Ask for access form).
 */
const GATE_FILES = Object.freeze({
  everyPage: Object.freeze(['assets/js/header-account.js', 'assets/js/locked.js']),
  pages: Object.freeze(['assets/js/auth-login.js', 'assets/js/access-support-form.js']),
});
const LIST_KEYS = ['needs', 'scripts', 'styles', 'files'];

/**
 * The frontmatter's flat `key: value` lines, as the generator reads them
 * (generate-docs.js parseFrontmatter), so a test can load the registry
 * without the generator.
 */
function readFrontmatter(content) {
  const match = String(content).match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const frontmatter = {};
  if (!match) return { frontmatter };
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { frontmatter };
}

/** "a, b" → ["a", "b"]; an absent key is an empty list. */
function list(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Where the package keeps its apps and their files. Run from the engine's
 * repo, that is cms/apps and the repo itself; run from the installed
 * package, dist/apps and dist/apps/files.
 */
function packageDirs(generatorDir) {
  const appsDir = path.join(generatorDir, '..', 'apps');
  const shipped = path.join(appsDir, 'files');
  return {
    appsDir,
    filesRoot: fs.existsSync(shipped) ? shipped : path.join(generatorDir, '..', '..'),
    librariesFile: path.join(appsDir, 'libraries.json'),
    // Guides sit with the docs in the repo, beside the apps in the package
    guidesDir: fs.existsSync(shipped) ? path.join(appsDir, 'guides') : path.join(generatorDir, '..'),
  };
}

/**
 * Every app the package ships and every app the site writes, by slug. A
 * site file replaces the package's for that one file (.md or .html).
 */
function loadApps({ generatorDir, siteAppsDir, parseFrontmatter = readFrontmatter }) {
  const dirs = packageDirs(generatorDir);
  const apps = new Map();
  const add = (dir, origin) => {
    if (!dir || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.md') || name.startsWith('README') || name.startsWith('_')) continue;
      const slug = name.replace(/\.md$/, '');
      const entry = apps.get(slug) || { slug, md: null, html: null, overrides: [], fromSite: false, packageMd: null };
      if (origin === 'package') entry.packageMd = path.join(dir, name);
      if (origin === 'site') entry.fromSite = true;
      const md = path.join(dir, name);
      const html = path.join(dir, `${slug}.html`);
      if (entry.md && origin === 'site' && path.resolve(entry.md) !== path.resolve(md)) entry.overrides.push('manifest');
      entry.md = md;
      if (fs.existsSync(html)) {
        if (entry.html && origin === 'site' && path.resolve(entry.html) !== path.resolve(html)) entry.overrides.push('body');
        entry.html = html;
      }
      apps.set(slug, entry);
    }
  };
  add(dirs.appsDir, 'package');
  add(siteAppsDir, 'site');
  for (const entry of apps.values()) {
    const fm = parseFrontmatter(fs.readFileSync(entry.md, 'utf8')).frontmatter;
    entry.frontmatter = fm;
    entry.manifest = {
      version: fm.version || null,
      status: fm.status || null,
      package: fm.package || null,
      gate: fm.gate === 'true',
      embed: fm.embed || null,
      // A site's own manifest written before guides shipped keeps the package's
      guide: fm.guide || (entry.packageMd && entry.packageMd !== entry.md
        ? parseFrontmatter(fs.readFileSync(entry.packageMd, 'utf8')).frontmatter.guide || null
        : null),
    };
    for (const key of LIST_KEYS) entry.manifest[key] = list(fm[key]);
  }
  const libraries = fs.existsSync(dirs.librariesFile)
    ? JSON.parse(fs.readFileSync(dirs.librariesFile, 'utf8'))
    : {};
  delete libraries.$comment;
  return { apps, libraries, filesRoot: dirs.filesRoot, guidesDir: dirs.guidesDir };
}

/**
 * The installed apps, and the scripts, styles and files they need, in load
 * order: libraries first, each after the ones it needs, then the apps. A
 * site with no `install` keeps every app it has, as before phase B, and
 * gets no app files from the engine (`legacy`).
 */
function resolveInstall(registry, install, { engineHome, accessGate, allowDraft = false }) {
  const errors = [];
  if (install === undefined || install === null) {
    // Only the apps the site writes itself: a site with no install list never
    // gets the package's apps by surprise
    const own = [...registry.apps.values()].filter((app) => app.fromSite).map((app) => app.slug);
    return { legacy: true, installed: own, packages: new Set(), scripts: [], styles: [], files: [], errors };
  }
  if (typeof install !== 'object' || Array.isArray(install)) {
    return { legacy: false, installed: [], packages: new Set(['core']), scripts: [], styles: [], files: [], errors: ['`install` must be { packages: [...], off: [...] }.'] };
  }
  const packages = new Set(['core']);
  for (const name of install.packages || []) {
    if (!PACKAGES[name]) errors.push(`\`install.packages\` names "${name}", which isn't a package (${Object.keys(PACKAGES).join(', ')}).`);
    else if (PACKAGES[name].home && !engineHome) errors.push(`The "${name}" package is the engine home's own and installs nowhere else.`);
    else packages.add(name);
  }
  for (const name of packages) {
    for (const need of (PACKAGES[name] && PACKAGES[name].needs) || []) {
      if (!packages.has(need)) errors.push(`The "${name}" package needs "${need}": add it to \`install.packages\`.`);
    }
  }
  const off = new Set(install.off || []);
  for (const slug of off) {
    if (!registry.apps.has(slug)) errors.push(`\`install.off\` names "${slug}", which isn't an app.`);
  }

  const installed = [];
  for (const [slug, app] of registry.apps) {
    const m = app.manifest;
    if (!PACKAGES[m.package]) {
      errors.push(`${slug}: its manifest's package is ${JSON.stringify(m.package)}. It must be one of ${Object.keys(PACKAGES).join(', ')}.`);
      continue;
    }
    if (!STATUSES.includes(m.status)) {
      errors.push(`${slug}: its manifest's status is ${JSON.stringify(m.status)}. It must be stable, beta or draft.`);
      continue;
    }
    if (!packages.has(m.package) || off.has(slug)) continue;
    if (m.status === 'draft' && !allowDraft) continue;
    if (m.gate && !accessGate) {
      errors.push(`${slug} needs the access gate (accessGate: true), or switch it off in \`install.off\`.`);
      continue;
    }
    if (!app.html) {
      errors.push(`${slug}: there is no ${slug}.html page body.`);
      continue;
    }
    installed.push(slug);
  }

  // The gate's own files first (GATE_FILES), then the libraries in
  // dependency order, each once, then each app's own files
  const scripts = [];
  const styles = [];
  const files = [];
  const done = new Set();
  const visiting = new Set();
  const take = (items, into) => { for (const item of items) if (!into.includes(item)) into.push(item); };
  if (accessGate) {
    take(GATE_FILES.everyPage, scripts);
    take(GATE_FILES.pages, files);
  }
  const library = (name, by) => {
    if (done.has(name)) return;
    const lib = registry.libraries[name];
    if (!lib) { errors.push(`${by} needs "${name}", which isn't a library in libraries.json.`); return; }
    if (visiting.has(name)) { errors.push(`The libraries "${name}" and ${by} need each other.`); return; }
    visiting.add(name);
    for (const need of lib.needs || []) library(need, `the "${name}" library`);
    visiting.delete(name);
    done.add(name);
    take(lib.scripts || [], scripts);
    take(lib.styles || [], styles);
    take(lib.files || [], files);
  };
  for (const slug of installed) {
    for (const need of registry.apps.get(slug).manifest.needs) library(need, slug);
  }
  for (const slug of installed) {
    const m = registry.apps.get(slug).manifest;
    take(m.scripts, scripts);
    take(m.styles, styles);
    take(m.files, files);
  }
  for (const rel of [...scripts, ...styles, ...files]) {
    if (!fs.existsSync(path.join(registry.filesRoot, rel))) errors.push(`An installed app's file "${rel}" isn't in the package.`);
  }
  return { legacy: false, installed, packages, scripts, styles, files, gate: !!accessGate, errors };
}

/** Whether a site that installs leaves the section in this output folder off (D14). */
function sectionOff(install, folder) {
  if (install.legacy) return false;
  const pkg = SECTION_PACKAGES[folder];
  return !!pkg && !install.packages.has(pkg);
}

/**
 * Where each app guide's source comes from, and which guides the build
 * leaves out (PB-3), with the not-installed page (PB-4) on a site that
 * installs. An installed app's guide is the site's own file when it
 * has one, else the package's. An app that isn't installed has no guide, so
 * its guide is skipped even where the site keeps the file. A site with no
 * install list (legacy) builds every file it has, as before.
 * @returns {{ sources: Map<string, string>, skip: Set<string>, overridden: string[], errors: string[] }}
 */
function resolveGuides(registry, install, docsDir) {
  const sources = new Map();
  const skip = new Set();
  const overridden = [];
  const errors = [];
  if (install.legacy) return { sources, skip, overridden, errors };
  for (const [page, address] of Object.entries(ENGINE_PAGES)) {
    const shippedPage = path.join(registry.guidesDir, page);
    // The door pages only where the gate is on
    if (address.gate && !install.gate) continue;
    if (!fs.existsSync(path.join(docsDir, page)) && fs.existsSync(shippedPage)) sources.set(page, shippedPage);
  }
  for (const [slug, app] of registry.apps) {
    const guide = app.manifest.guide;
    if (!guide) continue;
    if (!/^[a-z0-9-]+\.md$/.test(guide)) {
      errors.push(`${slug}: its manifest's guide is ${JSON.stringify(guide)}. It must be a file name like ${slug}-docs.md.`);
      continue;
    }
    const own = path.join(docsDir, guide);
    const shipped = path.join(registry.guidesDir, guide);
    const siteHasOne = fs.existsSync(own);
    if (!install.installed.includes(slug)) {
      if (siteHasOne) skip.add(guide);
      continue;
    }
    if (siteHasOne) {
      if (path.resolve(own) !== path.resolve(shipped) && fs.existsSync(shipped)) overridden.push(guide);
    } else if (fs.existsSync(shipped)) {
      sources.set(guide, shipped);
    } else {
      errors.push(`${slug}: its guide ${guide} isn't in the package.`);
    }
  }
  return { sources, skip, overridden, errors };
}

module.exports = { PACKAGES, STATUSES, NOT_INSTALLED_PAGE, ENGINE_PATHS, ENGINE_PAGES, GATE_FILES, SECTION_PACKAGES, sectionOff, list, readFrontmatter, packageDirs, loadApps, resolveInstall, resolveGuides };
