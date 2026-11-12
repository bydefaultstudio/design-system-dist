/* @bydefaultstudio/design-system v8.1.0 */
/**
 * validate.js — Sanitise and resolve all placeholder params. Never throws.
 */

var COLORS = require('./colors.cjs');

var MIN = 10;
var MAX = 4000;

// The colours a URL with no colour segments renders. The tool's client
// (assets/js/image-placeholder.js) carries the same two values so it can leave
// them out of the URLs it writes; this file is the authority — change both.
var DEFAULT_BG = 'e5e5e5';
var DEFAULT_FG = '5c5c5c';

function resolveColor(raw) {
  if (raw == null || raw === '') { return null; }
  var val = String(raw).toLowerCase().trim();

  if (COLORS[val] !== undefined) { return COLORS[val]; }

  var hex = val.replace(/^#/, '');

  if (/^[0-9a-f]{3}$/.test(hex)) {
    return hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  if (/^[0-9a-f]{6}$/.test(hex)) {
    return hex;
  }

  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

var TEXT_MAX = 100;

function escapeText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validate(params) {
  var width = clamp(params.width || MIN, MIN, MAX);
  var height = clamp(params.height || MIN, MIN, MAX);
  var bg = resolveColor(params.bg) || DEFAULT_BG;
  var fg = resolveColor(params.fg) || DEFAULT_FG;

  // Three text states, carried by one param: absent (null) draws no text at
  // all; present but blank draws the dimensions; anything else is the text.
  // Whitespace counts as blank — an invisible glyph would still reserve a
  // line under the logo. The whole string is cut at TEXT_MAX before it is
  // split and escaped: per-line cutting left the line count unbounded, and
  // truncating after escaping can slice an entity in half (e.g. "&quo") and
  // produce invalid, unrenderable XML.
  var text;
  if (params.text == null) {
    text = '';
  } else if (String(params.text).trim() === '') {
    text = width + ' × ' + height;
  } else {
    var raw = String(params.text);
    if (raw.length > TEXT_MAX) { raw = raw.substring(0, TEXT_MAX); }
    text = raw
      .split('\n')
      .map(escapeText)
      .join('\n');
  }

  return {
    width: width,
    height: height,
    bg: bg,
    fg: fg,
    text: text,
    logo: params.logo !== false,
  };
}

validate.DEFAULT_BG = DEFAULT_BG;
validate.DEFAULT_FG = DEFAULT_FG;

module.exports = validate;
