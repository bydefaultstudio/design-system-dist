/* @bydefaultstudio/design-system v7.5.1 */
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

/**
 * The tokens worker/email-template.mjs reads, by name. Listed here rather
 * than imported: the template imports this file, and the names change only
 * when the template does (scripts/verify-auth-gate.mjs checks they agree).
 */
export const EMAIL_TOKEN_NAMES = Object.freeze([
  'page', 'surface', 'ink', 'faded', 'rule', 'inverse', 'font', 'mono',
  'size2xs', 'sizeXs', 'sizeS', 'sizeXl', 'size4xl', 'leadingM', 'leadingL',
  'weightMedium', 'trackingM', 'trackingL', 'spaceS', 'spaceM', 'spaceL',
  'spaceXl', 'space2xl', 'space3xl', 'radius', 'border',
]);

export const SITE = {
  /** The product's name, in emails and as the sign-in app's name. */
  name: 'Docs',
  /** Every generated page by URL: { level, section, type, title } (page-access.mjs PAGE_ACCESS). */
  pages: new Map(),
  /** Output folder → section label, the sections a group can be granted (page-access.mjs SECTIONS). */
  sections: Object.freeze({}),
  /** Published markdown source → the page it is the source of (page-access.mjs SOURCE_PAGES). */
  sources: new Map(),
  /** 'locked' or 'hidden' (D19), from docs.config.js accessNav (page-access.mjs ACCESS_NAV). */
  accessNav: 'locked',
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
  /** Where a signed-out reader is sent to sign in. Always public. */
  loginPath: '/auth/login.html',
  /** The page served, at the requested URL with 403, to a reader a page refuses. */
  lockedPath: '/locked.html',
  /** Where the docs kit publishes markdown sources; one it does not map is admin only. */
  sourcePrefix: '/cms/',
  /** Overrides for the sign-in emails' literal tokens (email-template.mjs EMAIL_TOKENS): a client's own type and colour. */
  emailTokens: Object.freeze({}),
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
 * Email token overrides land in style="..." attributes in every sign-in
 * email. A value may not carry a quote or an angle bracket (it would close
 * the attribute and write markup into a message we send), nor `;`, `(`,
 * `\` or `&` (a second declaration such as a background url() would make
 * the email fetch remote content). Names must be real tokens, so a typo
 * fails rather than being ignored.
 */
function emailTokenMap(value, known) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('`emailTokens` must be an object of token names and values');
  for (const [key, token] of Object.entries(value)) {
    if (!known.includes(key)) fail(`\`emailTokens.${key}\` is not an email token (known: ${known.join(', ')})`);
    if (typeof token !== 'string' || /["<>;(\\&]/.test(token)) fail(`\`emailTokens.${key}\` must be a plain value with no quotes, brackets, semicolons, parentheses, backslashes or ampersands`);
  }
  return Object.freeze({ ...value });
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
  if (options.accessNav !== undefined && options.accessNav !== 'locked' && options.accessNav !== 'hidden') fail("`accessNav` must be 'locked' or 'hidden'");
  const hosts = hostList(options.hosts);
  const publicPaths = pathList(options.publicPaths, 'publicPaths');
  const publicPrefixes = pathList(options.publicPrefixes, 'publicPrefixes', { prefix: true });
  const embeddablePaths = pathList(options.embeddablePaths, 'embeddablePaths');
  if (options.landingPath !== undefined && options.landingPath !== null && (typeof options.landingPath !== 'string' || !options.landingPath.startsWith('/'))) fail('`landingPath` must be a path starting with /');
  const loginPath = onePath(options.loginPath, 'loginPath', '/auth/login.html');
  const lockedPath = onePath(options.lockedPath, 'lockedPath', '/locked.html');
  const sourcePrefix = onePath(options.sourcePrefix, 'sourcePrefix', '/cms/');
  if (!sourcePrefix.endsWith('/')) fail('`sourcePrefix` must end with /');
  const emailTokens = emailTokenMap(options.emailTokens, EMAIL_TOKEN_NAMES);

  SITE.name = typeof options.name === 'string' && options.name.trim() ? options.name.trim() : SITE.name;
  SITE.pages = options.pages;
  SITE.sections = options.sections;
  SITE.sources = options.sources || new Map();
  SITE.accessNav = options.accessNav || 'locked';
  SITE.hosts = hosts;
  SITE.publicPaths = new Set(publicPaths);
  SITE.publicPrefixes = [...publicPrefixes];
  SITE.embeddablePaths = new Set(embeddablePaths);
  SITE.landingPath = typeof options.landingPath === 'string' ? options.landingPath : null;
  SITE.loginPath = loginPath;
  SITE.lockedPath = lockedPath;
  SITE.sourcePrefix = sourcePrefix;
  SITE.emailTokens = emailTokens;
  return SITE;
}
