/* @bydefaultstudio/design-system v8.7.0 */
/**
 * site.mjs - what the access gate needs to know about the site it guards
 * (levels-groups-plan.md Phase 3, D21).
 *
 * The gate is engine code: it ships in @bydefaultstudio/design-system/worker
 * and runs one brand per deployment. Everything that differs between
 * deployments lives here, set once by createGate() (worker/gate-entry.mjs)
 * from the options the site passes, and read by the engine modules at call
 * time. Nothing in the engine imports a site's own files.
 *
 * The values start empty and closed: no page is known (every path is a team
 * page), no host is trusted (sign-in answers 404), nothing extra is public.
 * A site that forgets a setting is refused, never opened.
 */
import { LEVELS } from './auth-schema.mjs';
import { ENGINE_PATHS } from './engine-paths.mjs';

// The engine's fixed addresses (engine-paths.mjs, PD-2): the login page, the
// locked page, Ask for access, the sign-out link and the engine's own pages.
export { ENGINE_PATHS };

/** The locales a brand may write in (cms/generator/locale.js LOCALES), and each one's default zone for the sign-in email's time. */
const EMAIL_LOCALES = Object.freeze({ 'en-GB': 'Europe/London', 'en-US': 'America/New_York' });

export const SITE = {
  /** The product's name, in emails and as the sign-in app's name. */
  name: 'Docs',
  /** Every generated page by URL: { level, section, type, title } (page-access.mjs PAGE_ACCESS). */
  pages: new Map(),
  /** Output folder → section label, the sections a group can be granted (page-access.mjs SECTIONS). */
  sections: Object.freeze({}),
  /** Published markdown source → the page it is the source of (page-access.mjs SOURCE_PAGES). */
  sources: new Map(),
  /**
   * 'locked', 'hidden' (D19) or 'earned' (community-access-plan.md D11), from
   * docs.config.js accessNav (page-access.mjs ACCESS_NAV).
   */
  accessNav: 'locked',
  /** What this deployment calls the community role (brand.json access.communityLabel, page-access.mjs COMMUNITY_LABEL). The stored value is always `community`. */
  communityLabel: 'Community',
  /** Protected section → the lowest level a setting may give it or its pages (page-access.mjs PROTECTED_SECTIONS). */
  sectionFloors: new Map(),
  /** Domains sign-in answers on, each with its subdomains. localhost always. */
  hosts: [],
  /** Paths this site opens to everyone, beyond the engine's own (robots.txt, the login page). */
  publicPaths: new Set(),
  /** Path prefixes this site opens to everyone, beyond the engine's own (/assets/, /api/auth/). */
  publicPrefixes: [],
  /** Paths other sites may frame (the site-wide X-Frame-Options is lifted for them). */
  embeddablePaths: new Set(),
  /** The page a signed-out visitor to the home is shown instead of the login, or null. */
  landingPath: null,
  /** Where a signed-out reader is sent to sign in. Always public. The engine's, on every site (PD-2). */
  loginPath: ENGINE_PATHS.login,
  /** The page served, at the requested URL with 403, to a reader a page refuses. The engine's (PD-2). */
  lockedPath: ENGINE_PATHS.locked,
  /** The address of each app this site doesn't install, to its name (page-access.mjs NOT_INSTALLED). */
  notInstalled: new Map(),
  /** The page served, at such an address with 404, naming the app (PB-4). */
  notInstalledPath: ENGINE_PATHS.notInstalled,
  /** The apps the site installs (page-access.mjs APPS), whose Worker routes the gate mounts (B4). */
  apps: Object.freeze({ installed: [], imageLogo: null, embeds: [] }),
  /** The Asset Library's download map (library-index.mjs), when it is installed. */
  library: null,
  /** Where the docs kit publishes markdown sources; one it does not map is admin only. */
  sourcePrefix: '/cms/',
  /**
   * What the sign-in emails say about the brand (page-access.mjs EMAIL, from
   * brand.json): its company name, its logo { src, width, height } as a 2x
   * PNG under /assets/ or null, and the locale and zone its dates use. The
   * look is the engine's, the same for every brand.
   */
  email: Object.freeze({ company: 'Docs', logo: null, locale: 'en-GB', timeZone: 'Europe/London' }),
  /**
   * The level settings the LAST build baked in (page-access.mjs APPLIED_LEVELS):
   * { pages: Map<path, level>, sections: Map<folder, level> } (D27). The Levels
   * API compares the applied D1 rows against these to tell which changes still
   * wait for a build. The gate never reads them: it reads the baked levels.
   */
  appliedLevels: Object.freeze({ pages: new Map(), sections: new Map() }),
  /** When the last build read the level settings from D1 (unix seconds), 0 when it read none. */
  levelsReadAt: 0,
};

function fail(message) {
  throw new Error(`createGate: ${message}`);
}

/**
 * A list of site paths, or nothing. A bare string is refused: spread, it
 * would split into characters, and a prefix of '/' opens the whole site.
 */
function pathList(value, name, { prefix = false } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`\`${name}\` must be an array of paths`);
  for (const item of value) {
    if (typeof item !== 'string' || !item.startsWith('/')) fail(`every \`${name}\` entry must be a path starting with /, got ${JSON.stringify(item)}`);
    if (prefix && item === '/') fail(`\`${name}\` cannot be '/': that would open every path`);
  }
  return value;
}

/** One path setting: a path starting with /, or the default when absent. */
function onePath(value, name, fallback) {
  if (value === undefined || value === null) return fallback;
  // Never '//' (a protocol-relative URL leaves the site in a redirect), a
  // query, a fragment or a backslash: a page path and nothing else.
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' || value.startsWith('//') || /[?#\\]/.test(value)) fail(`\`${name}\` must be a plain path starting with /`);
  return value;
}

/**
 * A path setting the engine fixed in phase D (PD-2): the sign-in and locked
 * pages are generated at the engine's addresses on every site. A site that
 * still names another is honoured for now, and told at start-up, because the
 * page it points at is no longer one the build makes. The settings go at the
 * next major.
 */
const warnedPaths = new Set();
function deprecatedPath(value, name, enginePath) {
  const chosen = onePath(value, name, enginePath);
  // Once per setting and value: createGate() can configure twice on start-up
  if (chosen !== enginePath && !warnedPaths.has(`${name} ${chosen}`)) {
    warnedPaths.add(`${name} ${chosen}`);
    console.warn(`createGate: \`${name}\` is deprecated. The engine builds this page at ${enginePath} on every site, so ${chosen} is a page the build no longer makes. Remove the setting; it goes at the next major.`);
  }
  return chosen;
}

/**
 * The brand's email content. Every value lands in the email escaped, so the
 * checks are about what works: the logo must be a PNG under /assets/ (public
 * on every site, so a mail client with no session can load it; Gmail drops
 * SVG) with its real pixel size, and the zone must be one Intl knows.
 */
function emailContent(value, name) {
  const given = value === undefined ? {} : value;
  if (!given || typeof given !== 'object' || Array.isArray(given)) fail('`email` must be the EMAIL object from page-access.mjs');
  const locale = given.locale === undefined ? 'en-GB' : given.locale;
  if (!Object.hasOwn(EMAIL_LOCALES, locale)) fail(`\`email.locale\` must be ${Object.keys(EMAIL_LOCALES).join(' or ')}`);
  const timeZone = given.timeZone === undefined ? EMAIL_LOCALES[locale] : given.timeZone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    fail(`\`email.timeZone\` must be a time zone such as Europe/London, got ${JSON.stringify(timeZone)}`);
  }
  let logo = null;
  if (given.logo !== undefined && given.logo !== null) {
    const { src, width, height } = given.logo;
    if (typeof src !== 'string' || !src.startsWith('/assets/') || !src.toLowerCase().endsWith('.png') || !/^[a-z0-9._/-]+$/i.test(src) || src.split('/').includes('..')) fail('`email.logo.src` must be a .png path under /assets/, in letters, digits, dots, hyphens and underscores (an @ makes the server redirect)');
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) fail('`email.logo` needs the PNG\'s width and height in pixels');
    logo = Object.freeze({ src, width, height });
  }
  const company = typeof given.company === 'string' && given.company.trim() ? given.company.trim() : name;
  return Object.freeze({ company, logo, locale, timeZone });
}

/** A domain sign-in answers on: a bare name with at least one dot, no scheme, no path. */
function hostList(value) {
  if (!Array.isArray(value) || value.length === 0) fail('`hosts` must name at least one domain sign-in answers on');
  return value.map((host) => {
    const name = String(host).trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) fail(`\`hosts\` entries are bare domains like example.com, got ${JSON.stringify(host)}`);
    return name;
  });
}

/**
 * Set the site's values. Validated hard: a gate built on a malformed map
 * would fail open or closed in ways nobody chose, so it refuses to start.
 */
export function configureSite(options = {}) {
  if (!(options.pages instanceof Map)) fail('`pages` must be the PAGE_ACCESS Map from the generated page-access.mjs');
  for (const [path, entry] of options.pages) {
    if (!entry || !LEVELS.includes(entry.level)) fail(`page ${path} has no valid level`);
  }
  if (!options.sections || typeof options.sections !== 'object') fail('`sections` must be the SECTIONS object from page-access.mjs');
  if (options.sources !== undefined && !(options.sources instanceof Map)) fail('`sources` must be the SOURCE_PAGES Map from page-access.mjs');
  if (options.accessNav !== undefined && !['locked', 'hidden', 'earned'].includes(options.accessNav)) fail("`accessNav` must be 'locked', 'hidden' or 'earned'");
  const floors = options.protectedSections === undefined ? {} : options.protectedSections;
  if (!floors || typeof floors !== 'object' || Array.isArray(floors) || !Object.entries(floors).every(([f, l]) => /^[a-z0-9-]+$/.test(f) && LEVELS.includes(l))) fail('`protectedSections` must be the PROTECTED_SECTIONS object from page-access.mjs: section folder → lowest level');
  const hosts = hostList(options.hosts);
  const publicPaths = pathList(options.publicPaths, 'publicPaths');
  const publicPrefixes = pathList(options.publicPrefixes, 'publicPrefixes', { prefix: true });
  const embeddablePaths = pathList(options.embeddablePaths, 'embeddablePaths');
  if (options.landingPath !== undefined && options.landingPath !== null && (typeof options.landingPath !== 'string' || !options.landingPath.startsWith('/'))) fail('`landingPath` must be a path starting with /');
  const loginPath = deprecatedPath(options.loginPath, 'loginPath', ENGINE_PATHS.login);
  const lockedPath = deprecatedPath(options.lockedPath, 'lockedPath', ENGINE_PATHS.locked);
  if (options.notInstalled !== undefined && !(options.notInstalled instanceof Map)) fail('`notInstalled` must be the NOT_INSTALLED Map from page-access.mjs');
  const notInstalledPath = onePath(options.notInstalledPath, 'notInstalledPath', ENGINE_PATHS.notInstalled);
  const apps = options.apps === undefined ? { installed: [], imageLogo: null, embeds: [] } : options.apps;
  if (!apps || !Array.isArray(apps.installed)) fail('`apps` must be the APPS object from page-access.mjs');
  // An installed app's embed is public and frameable, like a site's own entry
  const embeds = pathList(apps.embeds, 'apps.embeds');
  if (apps.imageLogo !== null && apps.imageLogo !== undefined && (typeof apps.imageLogo !== 'string' || !apps.imageLogo.startsWith('/'))) fail('`apps.imageLogo` must be a site path starting with /');
  const library = options.library === undefined ? null : options.library;
  if (apps.installed.includes('asset-library') && !(library && library.index instanceof Map && typeof library.downloadAccess === 'string')) {
    fail('the Asset Library is installed: pass `library: { index: LIBRARY_INDEX, downloadAccess: LIBRARY_DOWNLOAD_ACCESS, thumbs: LIBRARY_THUMBS }` from library-index.mjs');
  }
  if (library && library.thumbs !== undefined && !(library.thumbs instanceof Map)) {
    fail('`library.thumbs` is LIBRARY_THUMBS from library-index.mjs, a Map');
  }
  const sourcePrefix = onePath(options.sourcePrefix, 'sourcePrefix', '/cms/');
  if (!sourcePrefix.endsWith('/')) fail('`sourcePrefix` must end with /');
  // One engine look for every brand since 8.7.0: a site's email colours and type no longer apply
  if (options.emailTokens !== undefined && !warnedPaths.has('emailTokens')) {
    warnedPaths.add('emailTokens');
    console.warn('createGate: `emailTokens` is ignored. The sign-in emails use the engine\'s look on every site; a brand sets its content with `email` (brand.json email). Remove the setting.');
  }
  const name = typeof options.name === 'string' && options.name.trim() ? options.name.trim() : SITE.name;
  const email = emailContent(options.email, name);
  const appliedLevels = normaliseApplied(options.appliedLevels);

  SITE.name = name;
  SITE.pages = options.pages;
  SITE.sections = options.sections;
  SITE.sources = options.sources || new Map();
  SITE.accessNav = options.accessNav || 'locked';
  SITE.sectionFloors = new Map(Object.entries(floors));
  SITE.communityLabel = typeof options.communityLabel === 'string' && options.communityLabel.trim() ? options.communityLabel.trim() : 'Community';
  SITE.hosts = hosts;
  SITE.publicPaths = new Set([...publicPaths, ...embeds]);
  SITE.publicPrefixes = [...publicPrefixes];
  SITE.embeddablePaths = new Set([...embeddablePaths, ...embeds]);
  SITE.landingPath = typeof options.landingPath === 'string' ? options.landingPath : null;
  SITE.loginPath = loginPath;
  SITE.lockedPath = lockedPath;
  SITE.notInstalled = options.notInstalled || new Map();
  SITE.notInstalledPath = notInstalledPath;
  SITE.apps = Object.freeze({ installed: [...apps.installed], imageLogo: apps.imageLogo || null, embeds });
  SITE.library = library;
  SITE.sourcePrefix = sourcePrefix;
  SITE.email = email;
  SITE.appliedLevels = appliedLevels;
  SITE.levelsReadAt = Number.isFinite(options.levelsReadAt) && options.levelsReadAt > 0 ? Math.floor(options.levelsReadAt) : 0;
  return SITE;
}

/**
 * The baked level settings as two Maps. page-access.mjs writes APPLIED_LEVELS
 * as `{ pages: {...}, sections: {...} }` (plain objects, so the generated file
 * stays data); a site with no settings source writes empty objects. Anything
 * malformed collapses to empty rather than failing the gate - a wrong applied
 * snapshot only mislabels pending in the UI, never opens a page.
 */
function normaliseApplied(value) {
  const pages = new Map();
  const sections = new Map();
  if (value && typeof value === 'object') {
    const src = value;
    if (src.pages instanceof Map) for (const [k, v] of src.pages) pages.set(k, v);
    else if (src.pages && typeof src.pages === 'object') for (const [k, v] of Object.entries(src.pages)) pages.set(k, v);
    if (src.sections instanceof Map) for (const [k, v] of src.sections) sections.set(k, v);
    else if (src.sections && typeof src.sections === 'object') for (const [k, v] of Object.entries(src.sections)) sections.set(k, v);
  }
  return Object.freeze({ pages, sections });
}
