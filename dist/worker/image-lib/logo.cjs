/* @bydefaultstudio/design-system v8.0.0 */
/**
 * logo.js — Prepare a brand logo SVG for embedding in a placeholder image.
 *
 * Pure and Node-testable: the Worker fetches the file (worker/image.js), this
 * module turns its text into a fill-less fragment plus its viewBox, and
 * lib/generate.js positions it. The file is a shipped brand asset, not user
 * input; what is checked here is the handful of shapes that would break the
 * image (no viewBox, nothing drawn, a script, a fill that would resist the
 * recolour), and the answer for any of them is null — the image renders
 * without a logo, never a 500. A style block or an inline style is not
 * rewritten: keep the mark as plain filled paths.
 *
 * LOGO_ASSET_PATH is By Default's mark, for test/placeholder-run.js only. The
 * Worker draws the brand's primary logo, from page-access.mjs APPS.imageLogo
 * (engine parity B4).
 */

var LOGO_ASSET_PATH = '/assets/images/logos/bydefault/logo_bydefault-primary-centered.svg';

// ?logo= spellings that hide the logo. Anything else — absent, empty, `1`,
// `yes`, a typo — shows it, so the default cannot be lost to a bad value.
var LOGO_OFF_VALUES = ['0', 'false', 'no', 'off'];

function parseLogoFlag(raw) {
  if (raw == null) { return true; }
  return LOGO_OFF_VALUES.indexOf(String(raw).trim().toLowerCase()) === -1;
}

/**
 * svgText -> { markup, width, height, minX, minY } | null
 *
 * Strips the prolog, comments and metadata, and every BLACK fill — the source
 * file paints its marks #000000 and the placeholder recolours them through a
 * parent <g fill>. Only black is stripped: a deliberate fill="none" on a
 * future file has to survive, or a cut-out would fill in.
 */
function prepareLogo(svgText) {
  if (typeof svgText !== 'string') { return null; }

  var open = svgText.match(/<svg\b[^>]*>/i);
  if (!open) { return null; }

  var viewBox = open[0].match(
    /\bviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i
  );
  if (!viewBox) { return null; }

  var width = parseFloat(viewBox[3]);
  var height = parseFloat(viewBox[4]);
  if (!(width > 0) || !(height > 0)) { return null; }

  var start = open.index + open[0].length;
  var end = svgText.lastIndexOf('</svg>');
  if (end < start) { return null; }

  var markup = svgText.slice(start, end)
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+fill\s*=\s*["'](#000000|#000|black)["']/gi, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();

  if (!markup) { return null; }
  if (/<script\b/i.test(markup)) { return null; }
  if (!/<(path|g|rect|circle|ellipse|polygon|polyline|line)\b/i.test(markup)) { return null; }

  return {
    markup: markup,
    width: width,
    height: height,
    minX: parseFloat(viewBox[1]) || 0,
    minY: parseFloat(viewBox[2]) || 0,
  };
}

module.exports = {
  LOGO_ASSET_PATH: LOGO_ASSET_PATH,
  LOGO_OFF_VALUES: LOGO_OFF_VALUES,
  parseLogoFlag: parseLogoFlag,
  prepareLogo: prepareLogo,
};
