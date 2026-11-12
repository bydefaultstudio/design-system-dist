/**
 * QR Code Generator — Tool Page Controller
 * Renders a QR matrix to the preview canvas as the options change, and
 * exports it as PNG or SVG. Depends on the vendored qrcode-generator library
 * (assets/js/vendor/qrcode-generator.min.js), which must load first.
 * Loaded globally; starts itself on initial load and after every Barba
 * navigation, and exposes window.initQrCode.
 *
 * Lived inline in tools/qr-code.html until 2026-09-13, when the page became a
 * cms/apps source pair. 1.3.0 added the URL / Text mode, 1.4.0 the centre
 * logo (the brand avatar from window.LogoManifest, in the fill colour) and
 * the scan check, which reads each code back with jsQR
 * (assets/js/vendor/jsqr.min.js, loaded here on first use, not site-wide).
 * 1.5.0 drew the field's data-sample while it is empty; 1.6.0 fixed the
 * logo at 22% and locked error correction while it is on.
 * 2.0.0 moves the tool onto the canvas's docks (cms/tool-canvas.md): the
 * code fills the preview with its details in a corner, the controls sit in
 * three sections on the right — Settings, Style, Export — and Download
 * and Copy are pinned under them. Copy now takes PNG as well as SVG. The
 * preview's two switches, Transparent and Fill, only change what the band
 * shows. Ids take the full slug, qr-code-.
 * @version 2.2.1
 */

(function () {
  'use strict';

  var VERSION = '2.2.1';
  console.log('[QR Code Tool] v' + VERSION + ' loaded');

  /* Where this file was served from, so the decoder loads beside it at any
     page depth. document.currentScript exists only while the file first
     runs, so it is read here, not at init. */
  var SCRIPT_BASE = (document.currentScript && document.currentScript.src)
    ? document.currentScript.src.replace(/[^\/]*$/, '')
    : '/assets/js/';

  /* A logo needs room: a version 1 or 2 code is 21 or 25 modules across,
     too few to clear a centre square and still keep the finder patterns'
     format strips (rows and columns 0-8) untouched. Version 3 is 29. */
  var LOGO_MIN_TYPE = 3;

  /* The logo's share of the code's width. Fixed rather than a setting: 22%
     is the largest that leaves H's recovery margin for print (see
     cms/qr-code-docs.md — Logo), and the largest reads best. */
  var LOGO_RATIO = 0.22;

  /* The scan check renders at a whole number of pixels per module, so no
     module edge is anti-aliased into grey. */
  var CHECK_CELL_PX = 6;

  var SIZE_MIN = 128;
  var SIZE_MAX = 2048;
  var SIZE_DEFAULT = 512;
  var SIZE_STEP = 64;

  var COPY_FEEDBACK_MS = 2000;  // copy-button.js's own feedback window

  /* What each section's reset puts back. The content and its mode are the
     reader's work, not settings, so only Reset all clears them. */
  var SETTINGS_DEFAULTS = {
    ec: 'H',
    radius: 0,
    quietZone: 2
  };

  var STYLE_DEFAULTS = {
    fill: '#000000',
    bg: '#FFFFFF',
    logo: false
  };

  /* The Pairs row (tool-colour.js): one chip sets both colours. Dark on
     light only — a light code on a dark ground fails many scanners even at
     high contrast. Palette values are read by token when the row is built. */
  var PAIRS = [
    { id: 'black-on-white', label: 'Black on white', fg: '#000000', bg: '#FFFFFF' },
    { id: 'off-black-on-off-white', label: 'Off black on off white', fg: 'off-black', bg: 'off-white' },
    { id: 'blue-on-white', label: 'Blue on white', fg: 'blue', bg: '#FFFFFF' },
    { id: 'brown-dark-on-brown-lighter', label: 'Brown dark on brown lighter', fg: 'brown-dark', bg: 'brown-lighter' }
  ];

  /* A scanner needs a clear step from fill to background; text contrast's
     4.5:1 is the line the contrast note holds it to. */
  var CONTRAST_MIN = 4.5;

  var EC_NOTE = 'How much damage it survives: L 7%, M 15%, Q 25%, H 30%.';
  var EC_LOCK_NOTE = 'The logo locks this to H. Turn it off to choose.';

  var MODE_COPY = {
    url: { label: 'URL', placeholder: 'Type your URL', note: 'https:// is added when you leave it off.', inputmode: 'url', spellcheck: 'false' },
    text: { label: 'Text', placeholder: 'Type your text', note: 'Encoded exactly as typed.', inputmode: 'text', spellcheck: 'true' }
  };

  /* ---- State ---- */

  var el = {};
  var currentMatrix = null;
  var currentModuleCount = 0;
  var debounceTimer = null;
  var logoArt = null;
  var decoderLoading = false;
  var checkCanvas = null;
  var exportReady = false;
  var stageObserver = null;
  /* The colour controls' handles (tool-colour.js), built at init. */
  var colour = {};
  /* Bumped on every render, so a PNG copy that resolves after the code has
     changed does not claim "Copied!" for a code no longer on screen. */
  var renderSession = 0;

  /* The literals are the tokens' own defaults, for a stylesheet that lost one. */
  var grounds = { light: '#ffffff', dark: '#000000' };

  /* ---- Utilities ---- */

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  function isValidHex(hex) {
    return /^#[0-9A-Fa-f]{6}$/.test(hex);
  }

  function normaliseHex(raw) {
    var h = (raw || '').trim();
    if (h.charAt(0) !== '#') h = '#' + h;
    return h.toUpperCase();
  }

  // Scoped to the tool, so a second container mid-transition is never read.
  function checkedValue(name) {
    var input = el.root && el.root.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : null;
  }

  function setChecked(name, value) {
    var input = el.root && el.root.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (input) input.checked = true;
  }

  function setText(node, text) {
    // Only on a real change: a write that changes nothing still counts as a
    // mutation for tool-canvas.js's observers.
    if (node && node.textContent !== text) node.textContent = text;
  }

  /* ---- QR generation ---- */

  /* The library's default encoder keeps the low byte of each character, so
     anything above U+00FF (an em dash, curly quotes, CJK, emoji) became a
     different byte and scanned as the wrong text. Only that text switches to
     UTF-8: text within Latin-1 keeps the bytes it always had, so a code
     already printed from it still matches a fresh one. */
  var BEYOND_LATIN1 = /[^\u0000-\u00ff]/;

  function selectEncoder(text) {
    qrcode.stringToBytes = BEYOND_LATIN1.test(text)
      ? qrcode.stringToBytesFuncs['UTF-8']
      : qrcode.stringToBytesFuncs['default'];
  }

  /* minType raises the version for short content, so a logo always has a
     grid big enough to sit in. Auto-sizing runs first: longer content
     already lands above the floor. */
  function generateQRMatrix(text, ecLevel, minType) {
    selectEncoder(text);
    var qr = qrcode(0, ecLevel);
    qr.addData(text);
    qr.make();
    if (minType && qr.getModuleCount() < 17 + 4 * minType) {
      qr = qrcode(minType, ecLevel);
      qr.addData(text);
      qr.make();
    }

    var count = qr.getModuleCount();
    var matrix = [];
    for (var row = 0; row < count; row++) {
      matrix[row] = [];
      for (var col = 0; col < count; col++) {
        matrix[row][col] = qr.isDark(row, col);
      }
    }

    currentMatrix = matrix;
    currentModuleCount = count;
    return { matrix: matrix, moduleCount: count };
  }

  /* ---- Logo ---- */

  /* The avatar is read from the Logo Tool's brand manifest, so a brand's own
     deployment gets its own mark with no change here. Only path data is
     kept: the logo is redrawn in the fill colour, and a string we own never
     taints the canvas the way a fetched image could. Returns null when the
     manifest has no usable avatar, and the logo control is then disabled. */
  function loadLogoArt() {
    var manifest = window.LogoManifest;
    if (!manifest || !manifest.variants || typeof DOMParser !== 'function' || typeof Path2D !== 'function') return null;

    var variant = null;
    manifest.variants.forEach(function (v) { if (v.id === 'avatar') variant = v; });
    if (!variant || !variant.markup) return null;

    var svg = new DOMParser().parseFromString(variant.markup, 'image/svg+xml').documentElement;
    if (!svg || svg.nodeName !== 'svg') return null;

    var vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(isNaN) || vb[2] <= 0 || vb[3] <= 0) return null;

    var paths = [];
    Array.prototype.forEach.call(svg.querySelectorAll('path'), function (node) {
      var d = node.getAttribute('d');
      if (d) paths.push({ d: d, rule: node.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero', path: new Path2D(d) });
    });
    if (!paths.length) return null;

    return { x: vb[0], y: vb[1], w: vb[2], h: vb[3], paths: paths };
  }

  /* The cleared square, in modules. The logo is the nearest odd number of
     modules to the chosen share of the width, never under 3, so it centres
     exactly on the odd-sized grid with no half-cut modules at its edge; one
     empty module surrounds it so it never touches the code's own dots. */
  function getLogoBox(moduleCount, ratio) {
    if (!ratio || !logoArt) return null;
    var logoSize = Math.max(3, 2 * Math.round((moduleCount * ratio - 1) / 2) + 1);
    var start = (moduleCount - logoSize - 2) / 2;
    return { start: start, end: start + logoSize + 2, logoStart: start + 1, logoSize: logoSize };
  }

  function isCleared(box, row, col) {
    return !!box && row >= box.start && row < box.end && col >= box.start && col < box.end;
  }

  /* Fit the artwork's viewBox into the logo square, centred on its long
     side. Shared by the canvas and the SVG export so the two never differ. */
  function getLogoTransform(box, quietZone, cellSize) {
    var px = box.logoSize * cellSize;
    var scale = px / Math.max(logoArt.w, logoArt.h);
    var origin = (box.logoStart + quietZone) * cellSize;
    return {
      x: origin + (px - logoArt.w * scale) / 2 - logoArt.x * scale,
      y: origin + (px - logoArt.h * scale) / 2 - logoArt.y * scale,
      scale: scale
    };
  }

  /* ---- Canvas rendering ---- */

  function drawRoundedRect(ctx, x, y, w, h, r) {
    if (r <= 0) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function renderToCanvas(canvas, matrix, moduleCount, options) {
    var size = options.size;
    var quietZone = options.quietZone;
    var totalModules = moduleCount + quietZone * 2;
    var cellSize = size / totalModules;
    var cornerRadius = cellSize * options.moduleRadius;

    canvas.width = size;
    canvas.height = size;

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    if (!options.transparentBg) {
      ctx.fillStyle = options.bgColor;
      ctx.fillRect(0, 0, size, size);
    }

    ctx.fillStyle = options.fillColor;
    var box = getLogoBox(moduleCount, options.logoRatio);

    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        if (matrix[row][col] && !isCleared(box, row, col)) {
          var x = (col + quietZone) * cellSize;
          var y = (row + quietZone) * cellSize;
          drawRoundedRect(ctx, x, y, cellSize, cellSize, cornerRadius);
        }
      }
    }

    if (box) {
      var t = getLogoTransform(box, quietZone, cellSize);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);
      logoArt.paths.forEach(function (p) { ctx.fill(p.path, p.rule); });
      ctx.restore();
    }
  }

  function clearCanvas(canvas, options) {
    var ctx = canvas.getContext('2d');
    canvas.width = options.size;
    canvas.height = options.size;
    ctx.clearRect(0, 0, options.size, options.size);
    if (!options.transparentBg) {
      ctx.fillStyle = options.bgColor;
      ctx.fillRect(0, 0, options.size, options.size);
    }
  }

  /* ---- SVG generation ---- */

  function generateSVGString(matrix, moduleCount, options) {
    var size = options.size;
    var quietZone = options.quietZone;
    var totalModules = moduleCount + quietZone * 2;
    var cellSize = size / totalModules;
    var cornerRadius = cellSize * options.moduleRadius;
    var rx = cornerRadius > 0 ? ' rx="' + cornerRadius.toFixed(2) + '" ry="' + cornerRadius.toFixed(2) + '"' : '';

    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">');

    if (!options.transparentBg) {
      parts.push('  <rect width="100%" height="100%" fill="' + options.bgColor + '"/>');
    }

    var box = getLogoBox(moduleCount, options.logoRatio);

    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        if (matrix[row][col] && !isCleared(box, row, col)) {
          var x = ((col + quietZone) * cellSize).toFixed(2);
          var y = ((row + quietZone) * cellSize).toFixed(2);
          var w = cellSize.toFixed(2);
          parts.push('  <rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + w + '" fill="' + options.fillColor + '"' + rx + '/>');
        }
      }
    }

    if (box) {
      var t = getLogoTransform(box, quietZone, cellSize);
      parts.push('  <g fill="' + options.fillColor + '" transform="translate(' + t.x.toFixed(2) + ' ' + t.y.toFixed(2) + ') scale(' + t.scale.toFixed(4) + ')">');
      logoArt.paths.forEach(function (p) {
        parts.push('    <path d="' + p.d.replace(/"/g, '&quot;') + '"' + (p.rule === 'evenodd' ? ' fill-rule="evenodd"' : '') + '/>');
      });
      parts.push('  </g>');
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  /* ---- Reading the controls ---- */

  function getFormat() {
    return checkedValue('qr-code-format') || 'png';
  }

  function getMode() {
    return checkedValue('qr-code-mode') || 'url';
  }

  function isLogoOn() {
    return !!(el.logo && el.logo.checked && logoArt);
  }

  /* A logo locks the level to H; the radios show it, and this enforces it
     even if the markup and the state ever disagree. */
  function getEC() {
    if (isLogoOn()) return 'H';
    return checkedValue('qr-code-ec') || 'H';
  }

  /* Clamped to the range and snapped to its 64px step, as the field's note
     says, so 1000 exports at 1024 rather than at a size no preset makes. */
  function getSize() {
    var value = clamp(parseInt(el.size.value, 10) || SIZE_DEFAULT, SIZE_MIN, SIZE_MAX);
    return SIZE_MIN + Math.round((value - SIZE_MIN) / SIZE_STEP) * SIZE_STEP;
  }

  /* What the code actually carries. In URL mode a bare address gains
     https://, so "example.com" scans as a link rather than as text; any
     scheme already typed (http:, mailto:, tel:) is left alone. A host and
     port ("localhost:3000", "example.com:8080") looks like a scheme to the
     last test, so it is caught first; the host needs a dot or to be
     localhost, which keeps "tel:0123456" a scheme. */
  function getPayload() {
    var value = el.input.value.trim();
    if (!value || getMode() !== 'url') return value;
    if (/^\/\//.test(value)) return 'https:' + value;
    if (/^(localhost|[^\s\/:@]+\.[^\s\/:@]+):\d+(?:[\/?#]|$)/i.test(value)) return 'https://' + value;
    return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value;
  }

  function getOptions() {
    // The controls hold the last valid colour only, so a bad hex typed in a
    // field changes nothing until it is fixed. A null background is None.
    var fillHex = colour.fg ? colour.fg.get().value : STYLE_DEFAULTS.fill;
    var bgHex = colour.bg ? colour.bg.get().value : STYLE_DEFAULTS.bg;

    return {
      size: getSize(),
      moduleRadius: (parseInt(el.radius.value, 10) || 0) / 100,
      quietZone: parseInt(el.quietZone.value, 10) || 0,
      fillColor: fillHex,
      bgColor: bgHex || STYLE_DEFAULTS.bg,
      transparentBg: bgHex === null,
      logoRatio: isLogoOn() ? LOGO_RATIO : 0
    };
  }

  function buildFilename() {
    return 'qr-code-' + getSize() + 'px.' + getFormat();
  }

  /* ---- Preview: ground, ink, details, scale ---- */

  // Relative luminance and contrast, the WCAG formulas. Here they answer one
  // question: does the code's edge show on the ground it is drawn on.
  function luminance(hex) {
    var channels = [1, 3, 5].map(function (index) {
      var value = parseInt(hex.substr(index, 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  }

  function contrast(a, b) {
    var one = luminance(a);
    var two = luminance(b);
    return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
  }

  function resolveGrounds() {
    var styles = getComputedStyle(document.documentElement);
    var light = normaliseHex(styles.getPropertyValue('--background-white'));
    var dark = normaliseHex(styles.getPropertyValue('--background-black'));
    if (isValidHex(light)) grounds.light = light;
    if (isValidHex(dark)) grounds.dark = dark;
  }

  /* The preview area starts on the light ground, the brand's off-white, as
     the Logo Tool's and the Icon Library's do (qr-code.css), and stays on
     it while the code has a background: the code is its own square there,
     its fill measured against its own background. Only a code with no
     background follows its fill to whichever ground that stands out on, or
     a pale code would vanish. Transparent swaps in the checkerboard, which
     shows exactly where the file is empty. */
  function pickGround(options) {
    if (el.transparent.checked) return 'checker';
    if (!options.transparentBg) return 'light';
    return contrast(options.fillColor, grounds.dark) > contrast(options.fillColor, grounds.light) ? 'dark' : 'light';
  }

  function syncGround(options) {
    var ground = pickGround(options);
    el.preview.setAttribute('data-ground', ground);
    // The band's text and switches take the ink that reads on the ground,
    // or the code's own fill wherever it clears AA there (tool-canvas.js).
    el.preview.setAttribute('data-preview-ink', ground === 'dark' ? 'light' : 'dark');
    if (window.ToolPreview) window.ToolPreview.syncInk(el.preview, options.fillColor);
  }

  /* Drawn at the export size and scaled down to fit, or as large as the
     stage allows while Fill is on; the CSS reads both (qr-code.css). */
  function syncScale(options) {
    el.canvas.style.setProperty('--tool-artwork-width', options.size + 'px');
    el.canvas.toggleAttribute('data-fill', el.fill.checked);
    updateScaleNote();
  }

  /* Say at what scale the code is shown, and when it is the real size, the
     way the Logo Tool and the Icon Library do, so the preview never quietly
     misleads about size. Not a live region — rewritten on every render. */
  function updateScaleNote() {
    if (!el.canvas) return;
    // Layout width, not the transformed rect: the preview scales in as the
    // page arrives (bd-animate), and a rect read mid-entrance misreports.
    var shown = el.canvas.offsetWidth;
    var size = getSize();
    var scaled = shown > 0 && shown !== size;
    el.canvas.toggleAttribute('data-enlarged', shown > size);
    setText(el.scaleNote, !shown ? '' : scaled
      ? 'Shown at ' + Math.round((shown / size) * 100) + '%'
      : 'Shown at actual size');
    if (scaled) el.canvas.setAttribute('aria-describedby', 'qr-code-scale-note');
    else el.canvas.removeAttribute('aria-describedby');
  }

  /* The Details corner: what the file is. Each size is one unbroken run,
     so a narrow corner never splits "512 × 512 px". */
  /* The canvas's name carries what it encodes, cut to a phrase: the full
     text is in the field, and a long one read out in browse mode is noise. */
  var NAME_MAX = 80;

  function canvasName(options, state) {
    if (state === 'sample') return 'Sample QR code';
    if (state === 'error') return 'No QR code: the content is too long';
    var payload = getPayload().replace(/\s+/g, ' ');
    if (payload.length > NAME_MAX) payload = payload.slice(0, NAME_MAX) + '\u2026';
    return 'QR code for ' + payload + ', ' + options.size + ' pixels';
  }

  function syncDetails(options, state) {
    var isSample = state === 'sample';
    setText(el.detailContent, isSample ? 'Sample' : MODE_COPY[getMode()].label);
    setText(el.detailSize, options.size + ' × ' + options.size + ' px');
    setText(el.detailGrid, currentModuleCount
      ? currentModuleCount + ' × ' + currentModuleCount + ' modules'
      : '');
    setText(el.detailEc, 'Error correction ' + getEC());
    el.canvas.setAttribute('aria-label', canvasName(options, state));
  }

  /* ---- Export strings and state ---- */

  /* Download and Copy both need a matrix, so they gate together. */
  function setExportEnabled(enabled) {
    exportReady = enabled;
    el.download.disabled = !enabled;
    el.copy.disabled = !enabled;
    syncExportStrings();
  }

  function syncExportStrings() {
    var format = getFormat();
    var label = format.toUpperCase();
    setText(el.downloadFormat, label);
    setText(el.copyFormat, label);
    if (el.filename.value !== buildFilename()) el.filename.value = buildFilename();
  }

  function showError(msg) {
    setText(el.error, msg || '');
    if (msg) el.input.setAttribute('aria-invalid', 'true');
    else el.input.removeAttribute('aria-invalid');
  }

  /* Cleared, then written a frame later: the same failure twice in a row is
     otherwise no change to the alert, and says nothing the second time. */
  function showExportError(msg) {
    setText(el.exportError, '');
    if (msg) window.requestAnimationFrame(function () { setText(el.exportError, msg); });
  }

  /* ---- Scan check ---- */

  /* jsQR is 130 KB, needed on this page only, so it loads on first use
     rather than riding the site-wide script list. It defines window.jsQR;
     once it is there, later arrivals skip the request. */
  function loadDecoder() {
    if (typeof window.jsQR === 'function' || decoderLoading) return;
    decoderLoading = true;
    var script = document.createElement('script');
    script.src = SCRIPT_BASE + 'vendor/jsqr.min.js';
    script.onload = function () {
      if (document.getElementById('qr-code-input')) updatePreview();
    };
    script.onerror = function () {
      decoderLoading = false;
      console.warn('[QR Code Tool] scan check unavailable: decoder failed to load');
    };
    document.head.appendChild(script);
  }

  var SCAN_STATES = {
    pass: { color: 'success', label: 'Scans', hint: '' },
    fail: { color: 'danger', label: 'Doesn’t scan', hint: 'Try stronger contrast, a wider quiet zone or no logo.' },
    mismatch: { color: 'warning', label: 'Reads back wrong', hint: 'Some characters don’t survive encoding. Type them rather than pasting.' }
  };

  function setScanStatus(state) {
    var s = state ? SCAN_STATES[state] : null;
    el.scanBadge.classList.toggle('is-hidden', !s);
    el.scanHint.classList.toggle('is-hidden', !s || !s.hint);
    // Blanked when hidden, so the next result is a text change the status
    // region announces, not only a display change
    if (!s) {
      setText(el.scanBadge, '');
      setText(el.scanHint, '');
      return;
    }
    el.scanBadge.setAttribute('data-color', s.color);
    setText(el.scanBadge, s.label);
    setText(el.scanHint, s.hint);
  }

  /* Reads the code back the way a scanner would, from a fresh render of the
     export at a small, whole-pixel scale. A code with no background is
     checked on white, the surface it most often lands on. The render is
     clean and digital, so a pass here is necessary, not sufficient: print,
     glare and distance take more margin, which is why the logo stops at 22%. */
  function checkScan(payload, options) {
    if (typeof window.jsQR !== 'function' || !currentMatrix) {
      setScanStatus(null);
      return;
    }
    var total = currentModuleCount + options.quietZone * 2;
    var size = total * CHECK_CELL_PX;
    // The first getContext call fixes the context's settings, so the
    // read-back hint goes on at creation, before renderToCanvas asks for it.
    if (!checkCanvas) {
      checkCanvas = document.createElement('canvas');
      checkCanvas.getContext('2d', { willReadFrequently: true });
    }

    renderToCanvas(checkCanvas, currentMatrix, currentModuleCount, {
      size: size,
      moduleRadius: options.moduleRadius,
      quietZone: options.quietZone,
      fillColor: options.fillColor,
      bgColor: options.transparentBg ? '#FFFFFF' : options.bgColor,
      transparentBg: false,
      logoRatio: options.logoRatio
    });

    var data = checkCanvas.getContext('2d').getImageData(0, 0, size, size);
    var result = window.jsQR(data.data, size, size, { inversionAttempts: 'attemptBoth' });
    if (!result) setScanStatus('fail');
    else setScanStatus(result.data === payload ? 'pass' : 'mismatch');
  }

  /* ---- Render ---- */

  /* The empty state: the field's data-sample, drawn with the current
     settings so colour, shape and logo read before anything is typed. It is
     a picture only — the matrix is dropped straight after, so nothing can
     export or scan-check it — but its module count stays for the details. */
  function renderSample(options) {
    var sample = el.input.getAttribute('data-sample');
    currentMatrix = null;
    currentModuleCount = 0;
    if (sample) {
      try {
        var result = generateQRMatrix(sample, getEC(), options.logoRatio ? LOGO_MIN_TYPE : 0);
        renderToCanvas(el.canvas, result.matrix, result.moduleCount, options);
      } catch (e) {
        currentModuleCount = 0;
        clearCanvas(el.canvas, options);
      }
    } else {
      clearCanvas(el.canvas, options);
    }
    currentMatrix = null;
  }

  function updatePreview() {
    // Called straight by the resets and the decoder too: a timer still
    // pending would render a second time.
    clearTimeout(debounceTimer);
    debounceTimer = null;
    // A pending timer can fire after a Barba swap to another page
    if (!el.input || !el.input.isConnected) return;
    renderSession++;
    var payload = getPayload();
    var options = getOptions();

    syncResets();
    syncGround(options);
    syncScale(options);

    if (!payload) {
      renderSample(options);
      syncDetails(options, 'sample');
      setExportEnabled(false);
      setScanStatus(null);
      showError(null);
      return;
    }

    try {
      var result = generateQRMatrix(payload, getEC(), options.logoRatio ? LOGO_MIN_TYPE : 0);
      renderToCanvas(el.canvas, result.matrix, result.moduleCount, options);
      syncDetails(options, 'code');
      setExportEnabled(true);
      showError(null);
    } catch (e) {
      currentMatrix = null;
      currentModuleCount = 0;
      clearCanvas(el.canvas, { size: options.size, transparentBg: true });
      syncDetails(options, 'error');
      setExportEnabled(false);
      setScanStatus(null);
      showError(isLogoOn()
        ? MODE_COPY[getMode()].label + ' too long to carry a logo. Turn the logo off or shorten it.'
        : MODE_COPY[getMode()].label + ' too long for this error correction level. Try a lower level or shorten it.');
      return;
    }

    // Outside the try: a check that throws must not read as a failed encode
    try {
      checkScan(payload, options);
    } catch (e) {
      setScanStatus(null);
      console.warn('[QR Code Tool] scan check failed', e);
    }
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updatePreview, 150);
  }

  /* A render still waiting on the debounce means the matrix is older than
     the settings, and exporting would pair the two — a logo cleared from a
     grid built without one. Run it now so the file matches the preview. */
  function flushPending() {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    updatePreview();
  }

  /* ---- Export ---- */

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Deferred — a synchronous revoke can cancel the download before it starts.
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function canvasToPng() {
    return new Promise(function (resolve, reject) {
      el.canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned nothing'));
      }, 'image/png');
    });
  }

  function handleDownload() {
    flushPending();
    showExportError('');
    if (!getPayload() || !currentMatrix) return;

    var filename = buildFilename();
    if (getFormat() === 'svg') {
      downloadBlob(new Blob([generateSVGString(currentMatrix, currentModuleCount, getOptions())], { type: 'image/svg+xml' }), filename);
      return;
    }
    canvasToPng()
      .then(function (blob) { downloadBlob(blob, filename); })
      .catch(function () { showExportError('Couldn’t build that PNG. Try a smaller size or SVG.'); });
  }

  /* Copy: SVG is copy-button.js's job through data-copy, so only PNG lands
     here. An image on the clipboard needs ClipboardItem, which not every
     browser has. The blob goes in as a promise, not after it resolves:
     WebKit only honours a write that starts inside the click's activation.
     Older Chromium took only a Blob there and throws on a promise
     synchronously — for it, resolve first. */
  /* The SVG markup is written to data-copy here, at the click, after any
     pending render: this listener is on the button, so it runs before
     copy-button.js's document listener reads the attribute. Built only on
     a click — at 2048px it is a megabyte. For PNG it stays empty, the shared
     handler bails, and the image goes on the clipboard below. */
  function handleCopy() {
    showExportError('');
    flushPending();
    var ready = !!(getPayload() && currentMatrix);
    if (getFormat() === 'svg') {
      el.copy.setAttribute('data-copy', ready ? generateSVGString(currentMatrix, currentModuleCount, getOptions()) : '');
      return;
    }
    el.copy.setAttribute('data-copy', '');
    if (!ready) return;
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      showExportError('This browser can’t copy an image. Download the PNG instead.');
      return;
    }

    var button = el.copy;
    var session = renderSession;
    var png = canvasToPng();
    var write;
    try {
      write = writeImage(png);
    } catch (error) {
      write = png.then(writeImage);
    }

    write
      .then(function () {
        // "Copied!" describes the code as it was at the click; if a render
        // has landed since, the clipboard keeps the copy and the button
        // keeps quiet.
        if (session !== renderSession) return;
        button.classList.add('is-copied');
        announceImageCopied();
        // The shared handle, not a private timer: copy-button.js clears this
        // one on its own copies, so the two paths cannot strip each other's
        // "Copied!" early.
        window.clearTimeout(button.bdCopyRevertTimer);
        button.bdCopyRevertTimer = window.setTimeout(function () {
          button.classList.remove('is-copied');
        }, COPY_FEEDBACK_MS);
      })
      .catch(function () {
        showExportError('Couldn’t copy that image in this browser. Download it instead.');
      });
  }

  function writeImage(blobOrPromise) {
    return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blobOrPromise })]);
  }

  // copy-button.js owns the page's one copy live region and announces its
  // own text copies; the image path has to speak for itself or a screen
  // reader hears nothing (WCAG 4.1.3). Clear-then-set: an identical string
  // is not a mutation.
  function announceImageCopied() {
    var region = document.getElementById('bd-copy-live');
    if (!region) return;
    region.textContent = '';
    window.requestAnimationFrame(function () { region.textContent = 'Copied'; });
  }

  /* ---- Settings: logo lock, mode, reset ---- */

  /* The logo locks error correction to H: H is checked and every level is
     disabled, so the lock reads as a lock, and the note under the levels
     says why in place of what they mean. Turning the logo off frees the
     levels and leaves H checked. */
  // While the logo locks the levels, each one names the note that says why
  // in its own aria-describedby: the fieldset carries it too, but VoiceOver
  // often skips a fieldset's description when focus lands on a control.
  function syncLogoLock() {
    var on = isLogoOn();
    el.ecInputs.forEach(function (input) {
      input.disabled = on;
      if (on && input.value === 'H') input.checked = true;
      if (on) input.setAttribute('aria-describedby', el.ecNote.id);
      else input.removeAttribute('aria-describedby');
    });
    setText(el.ecNote, on ? EC_LOCK_NOTE : EC_NOTE);
  }

  /* The field follows the mode: its caption, placeholder and note, a URL
     keyboard for URL, spellcheck back on for prose. The value is kept. */
  function syncMode() {
    var copy = MODE_COPY[getMode()];
    setText(el.inputLabel, copy.label);
    setText(el.inputNote, copy.note);
    el.input.setAttribute('placeholder', copy.placeholder);
    el.input.setAttribute('inputmode', copy.inputmode);
    el.input.setAttribute('spellcheck', copy.spellcheck);
  }

  function isSettingsDefault() {
    var d = SETTINGS_DEFAULTS;
    return (checkedValue('qr-code-ec') || 'H') === d.ec
      && parseInt(el.radius.value, 10) === d.radius
      && parseInt(el.quietZone.value, 10) === d.quietZone;
  }

  function isStyleDefault() {
    var d = STYLE_DEFAULTS;
    return colour.fg.get().value === d.fill
      && colour.bg.get().value === d.bg
      // A bad hex typed over a default colour is a change the reset clears
      && !colour.fg.isDirty()
      && !colour.bg.isDirty()
      && el.logo.checked === d.logo;
  }

  /* Always there, disabled at the defaults (cms/tool-canvas.md, Section
     reset). A disabled button drops focus; tool-canvas.js moves it to the
     section's heading. */
  function syncResets() {
    if (el.settingsReset) el.settingsReset.disabled = isSettingsDefault();
    if (el.styleReset) el.styleReset.disabled = isStyleDefault();
  }

  function applySettingsDefaults() {
    var d = SETTINGS_DEFAULTS;
    // The logo's lock wins over the default level: with it on, H stays
    setChecked('qr-code-ec', d.ec);
    el.radius.value = d.radius;
    el.quietZone.value = d.quietZone;
    syncSliderValues();
    syncLogoLock();
  }

  function applyStyleDefaults() {
    var d = STYLE_DEFAULTS;
    colour.fg.set(d.fill);
    colour.bg.set(d.bg);
    el.logo.checked = d.logo;
    syncLogoLock();
    syncColourExtras();
  }

  /* The Pairs row checks the pair the two colours make, if any, and the
     contrast line measures them; None has no contrast to measure. */
  function syncColourExtras() {
    var fg = colour.fg.get().value;
    var bg = colour.bg.get().value;
    colour.pairs.sync(fg, bg);
    window.ToolColour.contrast(el.contrast, fg, bg, CONTRAST_MIN);
  }

  function handleColourChange() {
    syncColourExtras();
    scheduleSettingsUpdate();
  }

  function handlePairChoose(pair) {
    colour.fg.set(pair.fg);
    colour.bg.set(pair.bg);
    handleColourChange();
  }

  /* Builds the three colour controls into their mounts. The pairs name
     palette colours by token, resolved here against the palette the controls
     read, so a brand's own theme re-points them too. */
  function buildColourControls() {
    var palette = window.ToolColour.readPalette();
    function resolve(value) {
      var entry = palette.filter(function (p) { return p.id === value; })[0];
      return entry ? entry.value : value;
    }
    colour.pairs = window.ToolColour.pairs(el.pairsMount, {
      id: 'qr-code-pair',
      label: 'Pairs',
      min: CONTRAST_MIN,
      lightOnDark: false,
      pairs: PAIRS.map(function (pair) {
        return { id: pair.id, label: pair.label, fg: resolve(pair.fg), bg: resolve(pair.bg) };
      }),
      onChoose: handlePairChoose
    });
    colour.fg = window.ToolColour.create(el.fgMount, {
      id: 'qr-code-fg', label: 'Foreground', value: STYLE_DEFAULTS.fill, onChange: handleColourChange
    });
    colour.bg = window.ToolColour.create(el.bgMount, {
      id: 'qr-code-bg', label: 'Background', value: STYLE_DEFAULTS.bg, none: true, onChange: handleColourChange
    });
    // A rejected hex fires no onChange, but it is still a change Style's
    // reset clears; the field's own change event bubbles here.
    el.fgMount.addEventListener('change', syncResets);
    el.bgMount.addEventListener('change', syncResets);
  }

  function handleSettingsReset() {
    applySettingsDefaults();
    updatePreview();
    if (typeof window.showToast === 'function') window.showToast('Settings reset to their defaults.');
  }

  function handleStyleReset() {
    applyStyleDefaults();
    updatePreview();
    if (typeof window.showToast === 'function') window.showToast('Style reset to its defaults.');
  }

  /* Reset all: every section, and everything else the reader set — the
     content, its mode, the format and the preview's switches. */
  function handleResetAll() {
    applyStyleDefaults();
    applySettingsDefaults();
    setChecked('qr-code-mode', 'url');
    el.input.value = '';
    setChecked('qr-code-format', 'png');
    el.size.value = SIZE_DEFAULT;
    syncSizePresets();
    el.transparent.checked = false;
    el.fill.checked = false;
    showExportError('');
    syncMode();
    updatePreview();
    if (typeof window.showToast === 'function') window.showToast('Everything reset to the defaults.');
  }

  /* ---- Handlers ---- */

  // slider.js writes the readouts and aria-valuetext on input; a reset sets
  // .value directly, which fires no event, so it is told here.
  function syncSliderValues() {
    if (typeof window.syncSlider !== 'function') return;
    window.syncSlider(el.radius);
    window.syncSlider(el.quietZone);
  }

  /* A settings change: the reset follows it at once, not after the
     debounce, so it is never disabled under a change already made. */
  function scheduleSettingsUpdate() {
    syncResets();
    scheduleUpdate();
  }

  function handleSliderInput() {
    scheduleSettingsUpdate();
  }

  function handleModeChange() {
    syncMode();
    scheduleUpdate();
  }

  function handleLogoChange() {
    syncLogoLock();
    scheduleSettingsUpdate();
  }

  // Format and the preview's switches change no code, so they render at
  // once rather than waiting on the debounce.
  function handleFormatChange() {
    showExportError('');
    flushPending();
    syncExportStrings();
  }

  function handlePreviewSwitch() {
    var options = getOptions();
    syncGround(options);
    syncScale(options);
  }

  /* The field shows what will be exported. getSize already clamps, but
     silently; writing the clamped value back when the field is left keeps
     the two from disagreeing — 5000 becomes 2048, blank becomes 512. */
  function handleSizeChange() {
    el.size.value = getSize();
    syncSizePresets();
    syncExportStrings();
    scheduleUpdate();
  }

  // The preset that matches the committed size is checked; a size between
  // presets leaves none checked, so the control never claims a size it is not.
  function syncSizePresets() {
    var size = getSize();
    el.sizePresets.querySelectorAll('input[type="radio"]').forEach(function (radio) {
      radio.checked = parseInt(radio.value, 10) === size;
    });
  }

  function handleSizePreset(event) {
    el.size.value = event.target.value;
    handleSizeChange();
  }

  /* ---- Initialization ---- */

  function bindElements(root) {
    function q(id) { return root.querySelector('#' + id); }
    el = {
      root: root,
      preview: q('qr-code-preview'),
      canvas: q('qr-code-canvas'),
      stage: root.querySelector('.tool-stage'),
      detailContent: q('qr-code-detail-content'),
      detailSize: q('qr-code-detail-size'),
      detailGrid: q('qr-code-detail-grid'),
      detailEc: q('qr-code-detail-ec'),
      scanBadge: q('qr-code-scan-badge'),
      scanHint: q('qr-code-scan-hint'),
      scaleNote: q('qr-code-scale-note'),
      transparent: q('qr-code-transparent'),
      fill: q('qr-code-fill'),
      input: q('qr-code-input'),
      inputLabel: q('qr-code-input-label'),
      inputNote: q('qr-code-input-note'),
      error: q('qr-code-error'),
      logo: q('qr-code-logo'),
      logoNote: q('qr-code-logo-note'),
      ec: q('qr-code-ec'),
      ecNote: q('qr-code-ec-note'),
      radius: q('qr-code-radius'),
      quietZone: q('qr-code-quiet-zone'),
      pairsMount: q('qr-code-pairs'),
      fgMount: q('qr-code-fg'),
      bgMount: q('qr-code-bg'),
      contrast: q('qr-code-contrast'),
      mode: q('qr-code-mode'),
      format: q('qr-code-format'),
      size: q('qr-code-size'),
      filename: q('qr-code-filename'),
      download: q('qr-code-download'),
      downloadFormat: q('qr-code-download-format'),
      copy: q('qr-code-copy'),
      copyFormat: q('qr-code-copy-format'),
      exportError: q('qr-code-export-error'),
      settingsReset: q('qr-code-settings-reset'),
      styleReset: q('qr-code-style-reset'),
      sizePresets: q('qr-code-sizes'),
      resetAll: document.getElementById('qr-code-reset')
    };
    el.ecInputs = Array.prototype.slice.call(el.ec.querySelectorAll('input[type="radio"]'));
    return Object.keys(el).every(function (key) { return !!el[key]; });
  }

  /* The stage's size changes with the window and the dock's toggle, not
     with any control, which is the one change the render never sees. */
  function observeStage() {
    if (stageObserver) stageObserver.disconnect();
    stageObserver = null;
    if (typeof ResizeObserver === 'undefined') return;
    stageObserver = new ResizeObserver(updateScaleNote);
    stageObserver.observe(el.stage);
  }

  function initQrCode() {
    /* Bind DOM — bail if this page isn't the QR Code tool */
    var root = document.getElementById('qr-code');
    if (!root || !root.querySelector('#qr-code-input')) {
      if (stageObserver) { stageObserver.disconnect(); stageObserver = null; }
      return;
    }

    if (typeof qrcode !== 'function') {
      console.error('[QR Code Tool] qrcode-generator not loaded');
      return;
    }

    // Both the first load and an after-nav event can reach the same DOM
    if (root.dataset.qrCodeInit) return;

    if (!bindElements(root)) {
      console.error('[QR Code Tool] markup is missing an element; not initialised');
      return;
    }
    root.dataset.qrCodeInit = 'true';

    /* Reset state for a fresh container — Barba arrival means new DOM */
    currentMatrix = null;
    currentModuleCount = 0;
    exportReady = false;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }

    resolveGrounds();

    if (!window.ToolColour) {
      console.error('[QR Code Tool] tool-colour.js not loaded');
      return;
    }
    buildColourControls();

    // Parsed once and kept: the manifest does not change between pages
    if (!logoArt) logoArt = loadLogoArt();
    if (!logoArt) {
      el.logo.checked = false;
      el.logo.disabled = true;
      setText(el.logoNote, 'This brand has no avatar to place.');
    }

    el.mode.addEventListener('change', handleModeChange);
    el.input.addEventListener('input', scheduleUpdate);
    el.logo.addEventListener('change', handleLogoChange);
    el.ec.addEventListener('change', scheduleSettingsUpdate);
    el.radius.addEventListener('input', handleSliderInput);
    el.quietZone.addEventListener('input', handleSliderInput);
    el.format.addEventListener('change', handleFormatChange);
    el.size.addEventListener('input', scheduleUpdate);
    el.sizePresets.addEventListener('change', handleSizePreset);
    el.size.addEventListener('change', handleSizeChange);
    el.transparent.addEventListener('change', handlePreviewSwitch);
    el.fill.addEventListener('change', handlePreviewSwitch);
    el.download.addEventListener('click', handleDownload);
    el.copy.addEventListener('click', handleCopy);
    el.settingsReset.addEventListener('tool:panel-reset', handleSettingsReset);
    el.styleReset.addEventListener('tool:panel-reset', handleStyleReset);
    el.resetAll.addEventListener('click', handleResetAll);

    // A restored page can bring controls back changed without a change event
    syncMode();
    syncSliderValues();
    // A browser can restore an off-step size on reload; snap it as a commit would
    el.size.value = getSize();
    syncSizePresets();
    syncLogoLock();
    syncColourExtras();
    observeStage();
    loadDecoder();
    updatePreview();

    console.log('[QR Code Tool] init');
  }

  window.initQrCode = initQrCode;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initQrCode bails when its markup is absent.
  function startQrCode() {
    initQrCode();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startQrCode);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startQrCode);
  } else {
    startQrCode();
  }

})();
