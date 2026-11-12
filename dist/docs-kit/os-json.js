/**
 * os-json.js - /os.json, what a site runs (engine parity phase F, D6).
 *
 * Every full build writes it (generate-docs.js writeOsJson), and a site's
 * Worker sends it to the fleet service once per deployment (the gate's
 * `report` option). The service checks it again before storing it, with this
 * same file, so the build and the service can never disagree about the shape.
 *
 *   engine    the engine's version, the package's own
 *   site      { name, slug, url } from brand.json, or { name } without one
 *   brand     brand.json's version as the file is written, before any
 *             in-memory upgrade, or null with no brand.json
 *   packages  the packages the site installs, or null for a site not on
 *             `install` yet
 *   apps      each installed app's { slug, version, status, package }, or
 *             null for a site not on `install` yet
 *
 * No build time and no deploy time: two builds of the same tree are
 * byte-identical. The deploy time travels beside the file in the report.
 *
 * Forward compatible: a field this check doesn't know is accepted and left
 * alone, so a site on a newer engine that adds one still reports to a service
 * that hasn't learnt it yet. Only the known fields are checked or read.
 *
 * os.schema.json is the same shape for editors and other tools; this file is
 * the authority, and scripts/verify-os-json.js checks the two agree.
 *
 * Plain CommonJS with no imports: the generator requires it, and By Default
 * OS's Worker bundles it (worker/fleet.js).
 */
'use strict';

const SEMVER = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = ['stable', 'beta', 'draft'];
const LIMITS = { name: 200, id: 64, url: 200, packages: 16, apps: 100, version: 40 };
const KEYS = ['engine', 'site', 'brand', 'packages', 'apps'];

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isId(value) {
  return typeof value === 'string' && value.length <= LIMITS.id && ID.test(value);
}

function isVersion(value) {
  return typeof value === 'string' && value.length <= LIMITS.version && SEMVER.test(value);
}

/** An https address with a host and nothing after it, or a path at most. */
function isSiteUrl(value) {
  if (typeof value !== 'string' || value.length > LIMITS.url || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/**
 * The problems with an os.json value, each a sentence naming the field.
 * Empty when it is good.
 */
function validate(os) {
  const problems = [];
  if (!isObject(os)) return ['os.json must be an object.'];
  for (const key of KEYS) if (!(key in os)) problems.push(`"${key}" is missing.`);

  if ('engine' in os && !isVersion(os.engine)) problems.push('"engine" must be a version like 7.5.2.');

  if ('site' in os) {
    const site = os.site;
    if (!isObject(site)) {
      problems.push('"site" must be an object.');
    } else {
      if (typeof site.name !== 'string' || !site.name.trim() || site.name.length > LIMITS.name) {
        problems.push(`"site.name" must be text of 1 to ${LIMITS.name} characters.`);
      }
      if ('slug' in site && !isId(site.slug)) problems.push('"site.slug" must be lowercase letters, digits and inner hyphens.');
      if ('url' in site && !isSiteUrl(site.url)) problems.push('"site.url" must be an https address.');
    }
  }

  if ('brand' in os && os.brand !== null && !(Number.isInteger(os.brand) && os.brand >= 0 && os.brand <= 1000)) {
    problems.push('"brand" must be a whole number, or null.');
  }

  if ('packages' in os && os.packages !== null) {
    if (!Array.isArray(os.packages) || os.packages.length > LIMITS.packages) {
      problems.push(`"packages" must be a list of at most ${LIMITS.packages} package names, or null.`);
    } else {
      if (!os.packages.every(isId)) problems.push('"packages" holds a name that isn\'t lowercase letters, digits and hyphens.');
      if (new Set(os.packages).size !== os.packages.length) problems.push('"packages" names a package twice.');
    }
  }

  if ('apps' in os && os.apps !== null) {
    if (!Array.isArray(os.apps) || os.apps.length > LIMITS.apps) {
      problems.push(`"apps" must be a list of at most ${LIMITS.apps} apps, or null.`);
    } else {
      const seen = new Set();
      os.apps.forEach((app, i) => {
        const at = `"apps[${i}]"`;
        if (!isObject(app)) { problems.push(`${at} must be an object.`); return; }
        if (!isId(app.slug)) problems.push(`${at}.slug must be lowercase letters, digits and inner hyphens.`);
        else if (seen.has(app.slug)) problems.push(`${at} lists ${app.slug} twice.`);
        else seen.add(app.slug);
        if (!('version' in app) || (app.version !== null && !isVersion(app.version))) problems.push(`${at}.version must be a version like 1.2.0, or null.`);
        // stable, beta or draft today; a newer engine's status is taken, and shown as it is
        if (!isId(app.status)) problems.push(`${at}.status must be a status like stable, beta or draft.`);
        if (!isId(app.package)) problems.push(`${at}.package must be a package name.`);
      });
    }
  }
  if ((os.apps === null) !== (os.packages === null) && 'apps' in os && 'packages' in os) {
    problems.push('"apps" and "packages" are both lists or both null: a site is on `install` or it isn\'t.');
  }
  return problems;
}

/**
 * What a build writes: the payload, from what the generator already knows.
 *   engine         the package's version
 *   brand          the brand.json object (upgraded), or null
 *   brandVersion   the version brand.json is written at, or null
 *   brandSiteName  the brand's "<name> OS" (brand.js siteName), passed in
 *                  so this file needs nothing of brand.js
 *   siteName       the site's name when there is no brand.json
 *   install        apps.js resolveInstall()'s result
 *   manifests      slug → the app's manifest ({ version, status, package })
 */
function payload({ engine, brand, brandVersion, brandSiteName, siteName, install, manifests }) {
  const legacy = !install || install.legacy;
  return {
    engine,
    site: brand ? { name: brandSiteName, slug: brand.slug, url: brand.url } : { name: siteName },
    brand: brand && Number.isInteger(brandVersion) ? brandVersion : null,
    // core first, then the order docs.config.js lists them in
    packages: legacy ? null : [...install.packages],
    apps: legacy ? null : install.installed.map((slug) => {
      const m = manifests.get(slug);
      return { slug, version: m.version || null, status: m.status, package: m.package };
    }),
  };
}

/** The parts of a version, for comparing: [major, minor, patch, prerelease or null]. */
function versionParts(version) {
  const m = SEMVER.exec(String(version));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || null] : null;
}

/**
 * -1, 0 or 1 as `a` is older than, the same as, or newer than `b`, by
 * semver's order (a prerelease sorts before its release). null when either
 * is not a version.
 */
function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (x[3] === null) return 1;
  if (y[3] === null) return -1;
  const p = x[3].split('.');
  const q = y[3].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const pn = /^\d+$/.test(p[i]);
    const qn = /^\d+$/.test(q[i]);
    if (pn && qn && Number(p[i]) !== Number(q[i])) return Number(p[i]) < Number(q[i]) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

module.exports = { STATUSES, LIMITS, validate, payload, compareVersions, isVersion, isId };
