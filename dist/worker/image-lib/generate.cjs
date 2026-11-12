/* @bydefaultstudio/design-system v8.1.1 */
/**
 * generate.js — Pure function: validated params (+ optional prepared logo) -> SVG string.
 *
 * generate(params, logo): `logo` is the result of lib/logo.js prepareLogo, or
 * null/undefined for no logo. The function never fetches anything, so it runs
 * unchanged in the Worker and in test/placeholder-run.js.
 *
 * Layout follows the Figma "Image Placeholders" frame: the logo is 24.5% of
 * the image width (147px at 600), capped at 18% of the height so a wide banner
 * keeps a small mark; text is 6% of the shorter side (24px at 600×400) and
 * sits one text-size below the logo; the stack is centred. No crosshair.
 */

var LOGO_WIDTH_RATIO = 0.245;
var LOGO_MAX_HEIGHT_RATIO = 0.18;
var LOGO_MIN_WIDTH = 16;   // below this the mark is a smudge, so it is left out
var FONT_RATIO = 0.06;
var FONT_MIN = 12;
var FONT_MAX = 48;
var LINE_HEIGHT = 1.4;
var FONT_WEIGHT = 400;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places) {
  var factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function generate(params, logo) {
  var width = params.width;
  var height = params.height;
  var bg = params.bg;
  var fg = params.fg;
  var text = params.text || '';

  var cx = width / 2;

  var defs = '';
  var background = '';

  if (bg === 'transparent') {
    defs =
      '<defs>' +
        '<pattern id="checker" width="20" height="20" patternUnits="userSpaceOnUse">' +
          '<rect width="20" height="20" fill="#eeeeee"/>' +
          '<rect width="10" height="10" fill="#cccccc"/>' +
          '<rect x="10" y="10" width="10" height="10" fill="#cccccc"/>' +
        '</pattern>' +
      '</defs>';
    background = '<rect width="' + width + '" height="' + height + '" fill="url(#checker)"/>';
  } else {
    background = '<rect width="' + width + '" height="' + height + '" fill="#' + bg + '"/>';
  }

  // A transparent ink has always drawn black text; the logo takes the same ink.
  var ink = fg === 'transparent' ? '000000' : fg;

  var logoBox = null;
  if (params.logo !== false && logo && logo.markup && logo.width > 0 && logo.height > 0) {
    var aspect = logo.width / logo.height;
    var logoW = Math.min(width * LOGO_WIDTH_RATIO, height * LOGO_MAX_HEIGHT_RATIO * aspect);
    if (logoW >= LOGO_MIN_WIDTH) {
      logoBox = { w: logoW, h: logoW / aspect, s: logoW / logo.width };
    }
  }

  var lines = text ? text.split('\n') : [];
  var fontSize = clamp(Math.round(Math.min(width, height) * FONT_RATIO), FONT_MIN, FONT_MAX);
  var lineHeight = Math.round(fontSize * LINE_HEIGHT);
  var textHeight = lines.length ? fontSize + (lines.length - 1) * lineHeight : 0;

  var gap = (logoBox && lines.length) ? fontSize : 0;
  var stackHeight = (logoBox ? logoBox.h : 0) + gap + textHeight;
  var top = (height - stackHeight) / 2;

  var logoEl = '';
  if (logoBox) {
    var tx = round(cx - logoBox.w / 2 - logo.minX * logoBox.s, 2);
    var ty = round(top - logo.minY * logoBox.s, 2);
    logoEl =
      '<g fill="#' + ink + '" transform="translate(' + tx + ' ' + ty + ') scale(' + round(logoBox.s, 4) + ')">' +
        logo.markup +
      '</g>';
  }

  var textEl = '';
  if (lines.length) {
    var textTop = top + (logoBox ? logoBox.h : 0) + gap;
    var tspans = '';
    for (var i = 0; i < lines.length; i++) {
      var dy = i === 0 ? 0 : lineHeight;
      tspans += '<tspan x="' + cx + '" dy="' + dy + '">' + lines[i] + '</tspan>';
    }
    textEl =
      '<text ' +
        'font-family="system-ui, sans-serif" font-size="' + fontSize + '" font-weight="' + FONT_WEIGHT + '" ' +
        'fill="#' + ink + '" text-anchor="middle" dominant-baseline="central" ' +
        'y="' + round(textTop + fontSize / 2, 2) + '">' +
        tspans +
      '</text>';
  }

  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" ' +
      'width="' + width + '" height="' + height + '" ' +
      'viewBox="0 0 ' + width + ' ' + height + '">' +
      defs +
      background +
      logoEl +
      textEl +
    '</svg>';

  return svg;
}

module.exports = generate;
