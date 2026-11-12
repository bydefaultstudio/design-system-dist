/**
 * color-core.js — Shared colour reading and WCAG 2 contrast maths
 * The palette's token names, a parser that reads any colour the browser
 * accepts, and the contrast arithmetic. No DOM binding and no init: the
 * Colour Pairing and Colour Palette tools both read through it, so the token
 * list and the fragile canvas parser live in one place. Exposes window.bdColor.
 * @version 1.1.0
 */

(function () {
  'use strict';

  var VERSION = '1.0.0';
  console.log('[Colour Core] v' + VERSION + ' loaded');

  //
  //------- TOKENS — the palette, in palette order -------//
  //

  // Nine hues, the order the Figma palette and the Image Placeholder presets
  // share. Four steps each, darkest first. Names are token names without the
  // leading dashes.
  var ENGINE_HUES = ['green', 'aqua', 'blue', 'purple', 'pink', 'red', 'peach', 'yellow', 'brown'];
  // The brand's own hues, in grid order, when its brand.json names them
  // (colours.hues, generated into THEME_CONFIG.hues; theme-config.js loads
  // first). The engine's nine otherwise. The build checks every one has all
  // four steps.
  var brandConfig = typeof THEME_CONFIG !== 'undefined' ? THEME_CONFIG : null;
  var HUES = brandConfig && Array.isArray(brandConfig.hues) && brandConfig.hues.length
    ? brandConfig.hues.slice()
    : ENGINE_HUES;
  var STEPS = ['-dark', '', '-light', '-lighter'];
  var EXTRAS = ['off-black', 'off-white'];
  var NEUTRALS = ['neutral-50', 'neutral-100', 'neutral-150', 'neutral-200', 'neutral-300',
    'neutral-400', 'neutral-500', 'neutral-600', 'neutral-700', 'neutral-800',
    'neutral-900', 'neutral-950', 'neutral-990'];

  // Hue by hue, darkest first: the order both tools put in the DOM.
  function hueTokens() {
    var names = [];
    HUES.forEach(function (hue) {
      STEPS.forEach(function (step) { names.push(hue + step); });
    });
    return names;
  }

  // "green-dark" → "Green Dark", "off-white" → "Off White", "neutral-50" →
  // "Neutral 50". Display only; the token name stays the identifier.
  function tokenLabel(name) {
    return String(name).split('-').map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  // WCAG 2 thresholds. Normal text AA is 4.5, AAA is 7; large text AA and
  // non-text (1.4.11) share 3, large text AAA is 4.5.
  var AA = 4.5;
  var AAA = 7;
  var LARGE = 3;

  // Every comparison and the display share one tolerance, so a ratio that is
  // 4.5 in arithmetic but a hair under in floating point passes AND prints
  // 4.50, never one without the other.
  var EPSILON = 1e-7;

  // Painted to prove the canvas gives back what it was given.
  var PROBE_RGB = [10, 200, 30];

  //
  //------- PARSE — by painting, never by regex -------//
  //

  var canvasCtx;   // undefined = not asked yet, null = refused, else a 2d context

  // A 1x1 canvas turns any colour syntax the browser accepts into channels.
  // Reading the string was wrong: getComputedStyle hands back the token
  // stream with var() substituted but color-mix() unevaluated, and a regex
  // over that reads a mix as near-black.
  function getContext() {
    if (canvasCtx !== undefined) return canvasCtx;
    var canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvasCtx = canvas.getContext('2d', { willReadFrequently: true }) || null;
    return canvasCtx;
  }

  function toHex(rgb) {
    return '#' + [rgb[0], rgb[1], rgb[2]].map(function (v) {
      var h = Math.round(v).toString(16).toUpperCase();
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  // Returns [r, g, b, a] or null. Assigning an unparseable colour to
  // fillStyle is a silent no-op, so the value is assigned against two
  // sentinels: a colour the parser accepts lands on the same value from both
  // starting points, one it rejects keeps whichever sentinel it began with.
  // An opaque colour serialises as #rrggbb, and the pixel read back must
  // match it exactly: a browser that perturbs readback (Brave's shields flip
  // the low bit) would otherwise put every ratio a hair off, enough to flip
  // a pair sitting on 4.50. The check is gated on that serialisation: a
  // colour outside 8-bit sRGB comes back as color(...) and skips it, so a
  // theme in display-p3 or oklch is trusted on isCanvasTrustworthy() alone.
  function parseColor(value) {
    var ctx = getContext();
    if (!value || !ctx) return null;
    try {
      ctx.fillStyle = '#000000';
      ctx.fillStyle = value;
      var fromBlack = ctx.fillStyle;
      ctx.fillStyle = '#ffffff';
      ctx.fillStyle = value;
      if (ctx.fillStyle !== fromBlack) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      var d = ctx.getImageData(0, 0, 1, 1).data;
      var rgb = [d[0], d[1], d[2], d[3] / 255];
      if (/^#[0-9a-f]{6}$/i.test(fromBlack) && toHex(rgb).toLowerCase() !== fromBlack.toLowerCase()) return null;
      return rgb;
    } catch (error) {
      // Readback can throw under fingerprinting protection rather than
      // returning noise; either way the answer is "cannot measure".
      return null;
    }
  }

  // Firefox with privacy.resistFingerprinting does not fail getContext; it
  // returns a blocked readback, so a page would report confident nonsense.
  // Paint a known colour and refuse to measure if it does not survive. The
  // context is dropped first, so a permission changed between visits is
  // asked again rather than remembered.
  function isCanvasTrustworthy() {
    canvasCtx = undefined;
    var probe = parseColor('rgb(' + PROBE_RGB.join(', ') + ')');
    return !!probe && PROBE_RGB.every(function (channel, i) { return probe[i] === channel; });
  }

  //
  //------- MEASURE — WCAG 2 -------//
  //

  // WCAG 2 relative luminance. logo-tool.js still carries its own copy over
  // hex strings; moving it onto this module is in ROADMAP.md (Tools).
  function luminance(rgb) {
    var channels = [rgb[0], rgb[1], rgb[2]].map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  // Takes two measured colours (anything with a lum).
  function contrastRatio(a, b) {
    var hi = Math.max(a.lum, b.lum);
    var lo = Math.min(a.lum, b.lum);
    return (hi + 0.05) / (lo + 0.05);
  }

  function clears(ratio, min) {
    return ratio + EPSILON >= min;
  }

  // Cut, never rounded: 4.499 must read 4.49, because it fails.
  function truncate2(ratio) {
    return (Math.floor((ratio + EPSILON) * 100) / 100).toFixed(2);
  }

  // One opaque colour value → { rgb, hex, lum }, or null when it cannot be
  // read or carries alpha (which reads differently over every surface).
  function measure(value) {
    var rgb = parseColor(value);
    if (!rgb || rgb[3] < 1) return null;
    return { rgb: rgb, hex: toHex(rgb), lum: luminance(rgb) };
  }

  // Reads every named token from the computed style of root, so a brand
  // theme, a scoped override or a dark-mode block all count. A token the
  // brand leaves undefined is counted apart from one that resolves but cannot
  // be measured; each caller words the two causes itself.
  function readTokens(root, names) {
    var styles = getComputedStyle(root);
    // A null-prototype map, so a token name can never find Object's members.
    var scan = { map: Object.create(null), undefined: [], unmeasured: [] };
    names.forEach(function (name) {
      var raw = styles.getPropertyValue('--' + name).trim();
      if (!raw) {
        scan.undefined.push(name);
        return;
      }
      var measured = measure(raw);
      if (!measured) {
        scan.unmeasured.push(name);
        return;
      }
      scan.map[name] = {
        name: name,
        token: '--' + name,
        css: 'var(--' + name + ')',
        label: tokenLabel(name),
        hex: measured.hex,
        lum: measured.lum
      };
    });
    return scan;
  }

  window.bdColor = {
    HUES: HUES,
    STEPS: STEPS,
    EXTRAS: EXTRAS,
    NEUTRALS: NEUTRALS,
    AA: AA,
    AAA: AAA,
    LARGE: LARGE,
    hueTokens: hueTokens,
    tokenLabel: tokenLabel,
    toHex: toHex,
    parseColor: parseColor,
    isCanvasTrustworthy: isCanvasTrustworthy,
    luminance: luminance,
    contrastRatio: contrastRatio,
    clears: clears,
    truncate2: truncate2,
    measure: measure,
    readTokens: readTokens
  };
})();
