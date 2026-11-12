/* @bydefaultstudio/design-system v8.1.1 */
/**
 * engine-paths.mjs - the engine's fixed addresses, the same on every site
 * (engine-parity-phase-d.md, PD-2).
 *
 * The gate (site.mjs, gate.mjs), the docs generator (apps.js, which reads
 * this module with require(), so the kit needs Node 20.19 or later) and,
 * through window.bdPaths in the generated nav.js, every browser script read
 * them here, so nothing names one of its own. A plain module with no
 * imports: it runs unbundled in workerd and in Node alike.
 *
 * Never moved per site: invite emails already sent link to the login page,
 * and the Worker serves the locked page at any address it refuses.
 */
export const ENGINE_PATHS = Object.freeze({
  login: '/auth/login.html',
  locked: '/locked.html',
  support: '/support.html',
  signOut: '/auth/sign-out',
  notInstalled: '/not-installed.html',
  search: '/search.html',
});
