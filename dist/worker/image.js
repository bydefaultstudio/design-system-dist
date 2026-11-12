/* @bydefaultstudio/design-system v8.0.0 */
/**
 * image.js — Image placeholder generator, /image/*.
 *
 * Ported from the Netlify function of the same name (tag `netlify-2.1.1`).
 * lib/validate.js and lib/generate.js are pure and shared with
 * test/placeholder-run.js; lib/logo.js prepares the brand mark that
 * generate() places. The mark itself is fetched here, once per isolate, from
 * the ASSETS binding — the only I/O in the pipeline, and the only step that
 * knows the file exists.
 *
 * lib/parse.js is NOT reused: it was shaped by the Netlify request model rather
 * than app logic — it relies on the caller having already URL-decoded the query
 * string — and it stays only for test/placeholder-run.js.
 * The equivalent is re-derived below against the Workers URL API.
 */
import validate from './image-lib/validate.cjs';
import generate from './image-lib/generate.cjs';
import logoLib from './image-lib/logo.cjs';

/**
 * Extract placeholder params from a Workers URL.
 * Path shapes: /image/400x300, /image/600x400/orange/white, /image/300
 * Query: ?text= (absent = no text, blank = the dimensions), ?logo=0 hides the mark.
 */
function parseImageUrl(url) {
  const cleaned = url.pathname
    .replace(/^\/image\/?/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const segments = cleaned ? cleaned.split('/') : [];
  const dims = segments[0] || '';
  const bg = segments[1] || '';
  const fg = segments[2] || '';

  let width;
  let height;
  if (dims.includes('x')) {
    const parts = dims.split('x');
    width = parseInt(parts[0], 10) || 0;
    height = parseInt(parts[1], 10) || 0;
  } else {
    width = parseInt(dims, 10) || 0;
    height = width;
  }

  // searchParams.get() returns an already-decoded value, matching Netlify's
  // queryStringParameters. Decoding again would throw URIError on a lone '%'
  // and corrupt literal percent-sequences.
  const rawText = url.searchParams.get('text');
  const text = rawText === null ? null : rawText.replace(/\\n/g, '\n');

  return { width, height, bg, fg, text, logo: logoLib.parseLogoFlag(url.searchParams.get('logo')) };
}

// One fetch per isolate, shared by every request that arrives while it is in
// flight. A successful result lives as long as the isolate does — the asset
// only changes on deploy, which recycles isolates. A failure clears the slot
// and opens a retry window, so a transient miss is retried and a permanent
// one (a deployment without the file) costs one subrequest and one warning
// per window rather than per request.
const LOGO_RETRY_MS = 60 * 1000;
let logoPromise = null;
let logoRetryAt = 0;
let logoFor = null;

async function loadLogo(env, origin, logoPath) {
  if (!env || !env.ASSETS) { return null; }
  const response = await env.ASSETS.fetch(new URL(logoPath, origin));
  if (!response.ok) {
    console.warn('Image placeholder: logo asset returned ' + response.status);
    return null;
  }
  return logoLib.prepareLogo(await response.text());
}

function getLogo(env, origin, logoPath) {
  if (!logoPath) { return Promise.resolve(null); }
  // One logo per isolate; a different path (another gate in the same
  // isolate, as in a test) starts afresh
  if (logoFor !== logoPath) { logoPromise = null; logoRetryAt = 0; logoFor = logoPath; }
  if (logoPromise) { return logoPromise; }
  if (Date.now() < logoRetryAt) { return Promise.resolve(null); }
  logoPromise = loadLogo(env, origin, logoPath)
    .catch((err) => {
      console.warn('Image placeholder: logo unavailable', err);
      return null;
    })
    .then((logo) => {
      if (!logo) {
        logoPromise = null;
        logoRetryAt = Date.now() + LOGO_RETRY_MS;
      }
      return logo;
    });
  return logoPromise;
}

/**
 * @param {{ logoPath?: string|null }} [options] the brand's primary logo, a
 *   site path the asset layer serves (page-access.mjs APPS.imageLogo). With
 *   none, every image draws without a mark.
 */
export async function handleImage(url, env, options = {}) {
  const logoPath = options.logoPath || null;
  try {
    const params = validate(parseImageUrl(url));
    const logo = params.logo ? await getLogo(env, url.origin, logoPath) : null;
    const svg = generate(params, logo);
    // A logo the URL asked for but the isolate could not load is a fallback,
    // not the image — a browser must not keep it for a day.
    const cacheControl = params.logo && logoPath && !logo ? 'no-store' : 'public, max-age=86400';
    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Image placeholder error:', err);
    return new Response('Bad request. Try /image/400x300 or /image/600x400/orange/white', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
