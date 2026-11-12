/**
 * image-placeholder.js — Image Placeholder Tool UI
 * Loaded globally; starts itself on initial load and after every Barba
 * navigation, and exposes window.initImagePlaceholder.
 *
 * The preview is the served image: the preview's <img> points at the real
 * /image/... URL, so there is one renderer (the Worker) and the tool cannot
 * drift from it. Every change writes a URL; the URL is the state.
 *
 * Text and colour have no switches (they did, in the bar, until the tool
 * moved onto the tool canvas): an empty text field is no text, and the
 * Default pair — the one the Worker renders when the URL carries no
 * colour — is no colour.
 * 2.2: the colours are the tools' shared control (tool-colour.js): the
 * presets are its Pairs row, then Foreground and Background, each the brand
 * palette, a picker and a hex field; Background's None writes transparent.
 * Hex only — CSS colour names left the fields.
 * 3.0.0: onto docks (cms/tool-canvas.md, Docks). The size is a pair of
 * steppers in Settings, the URL a read-only field in Export that the two
 * verbs at the dock's foot copy and open, and Settings and Style carry
 * their own resets; ids take the tool's full slug.
 * @version 3.1.0
 */

(function () {
  'use strict';

  console.log('[Image Placeholder] v3.1.0 loaded');

  var BASE_URL = '/image/';

  // Must equal DEFAULT_BG / DEFAULT_FG in lib/validate.js — the Worker is the
  // authority. The client only needs them to know what a URL can leave out.
  var DEFAULT_BG = 'e5e5e5';
  var DEFAULT_FG = '5c5c5c';

  var DIM_MIN = 10;
  var DIM_MAX = 4000;
  var RENDER_DEBOUNCE_MS = 150;
  var STATUS_DELAY_MS = 50;

  // The brand presets, read by name at init rather than hard-coded as hex, so
  // a brand instance that re-points the tokens re-skins the chips with no code
  // change. The resolved values are URL data: a URL cannot resolve a custom
  // property, so each entry carries the engine's own value as a fallback for a
  // token the theme does not define. Default is not a token — it is the pair
  // the Worker renders when the URL carries no colour, so it is written from
  // the two literals above and emits no colour segments.
  var PRESET_TOKENS = [
    { id: 'green',  label: 'Green',  bg: { token: '--green-lighter',  fallback: 'dcfce7' }, fg: { token: '--green',  fallback: '16a34a' } },
    { id: 'aqua',   label: 'Aqua',   bg: { token: '--aqua-lighter',   fallback: 'ccfbf1' }, fg: { token: '--aqua',   fallback: '5eead4' } },
    { id: 'blue',   label: 'Blue',   bg: { token: '--blue-lighter',   fallback: 'dbeafe' }, fg: { token: '--blue',   fallback: '2563eb' } },
    { id: 'purple', label: 'Purple', bg: { token: '--purple-lighter', fallback: 'f3e8ff' }, fg: { token: '--purple', fallback: '9333ea' } },
    { id: 'pink',   label: 'Pink',   bg: { token: '--pink-lighter',   fallback: 'fce7f3' }, fg: { token: '--pink',   fallback: 'f9a8d4' } },
    { id: 'red',    label: 'Red',    bg: { token: '--red-lighter',    fallback: 'fee2e2' }, fg: { token: '--red',    fallback: 'dc2626' } },
    { id: 'peach',  label: 'Peach',  bg: { token: '--peach-light',    fallback: 'fed7aa' }, fg: { token: '--peach',  fallback: 'fdba74' } },
    { id: 'yellow', label: 'Yellow', bg: { token: '--yellow-lighter', fallback: 'fef3c7' }, fg: { token: '--yellow', fallback: 'd97706' } },
    { id: 'brown',  label: 'Brown',  bg: { token: '--brown-lighter',  fallback: 'e5e5e5' }, fg: { token: '--brown',  fallback: '737373' } }
  ];

  // 3:1 — WCAG's large-text and non-text bar, and the same line Colour Pairing
  // calls 'Fail', so the two tools cannot disagree about one pair. It is the
  // right bar for this image: the wordmark is a graphic and the text is 6% of
  // the shorter side, both large. At 4.5 this also flagged brown (4.31:1), a
  // near-miss the owner has not called a problem; the four it flags now are the
  // four low-contrast pairs already accepted verbatim (PROJECT_PROGRESS
  // 2026-09-23) — aqua 1.39, peach 1.56, yellow 1.58, pink 1.72.
  var CONTRAST_MIN = 3;

  var DIM_LIMITS = {
    width:  { max: 'widest', min: 'narrowest' },
    height: { max: 'tallest', min: 'shortest' }
  };

  var el = {};
  var presets = [];
  // The colour controls' handles (tool-colour.js), per container: a second
  // init against the same container finds them rather than rebuilding.
  var colour = {};
  var controlsByRoot = new WeakMap();
  var renderTimer = null;
  var statusTimer = null;
  var lastPath = '';

  // ---- colour helpers -------------------------------------------------------

  // A computed custom property -> 6-digit lowercase hex without '#', or null.
  // Accepts #rgb, #rrggbb and rgb(r, g, b); anything else (a gradient, an empty
  // string for a token the theme does not define) is null.
  function normaliseHex(value) {
    var text = String(value || '').trim().toLowerCase();
    var short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if (short) { return short[1] + short[1] + short[2] + short[2] + short[3] + short[3]; }
    if (/^#[0-9a-f]{6}$/.test(text)) { return text.slice(1); }
    var rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rgb) {
      return [rgb[1], rgb[2], rgb[3]].map(function (channel) {
        return ('0' + clamp(parseInt(channel, 10), 0, 255).toString(16)).slice(-2);
      }).join('');
    }
    return null;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function readToken(styles, spec) {
    var hex = normaliseHex(styles.getPropertyValue(spec.token));
    if (!hex) {
      console.warn('[Image Placeholder] ' + spec.token + ' did not resolve to a colour; using the engine value');
    }
    return hex || spec.fallback;
  }

  function resolvePresets() {
    var styles = window.getComputedStyle(document.documentElement);
    var brand = PRESET_TOKENS.map(function (entry) {
      return { id: entry.id, label: entry.label, bg: readToken(styles, entry.bg), fg: readToken(styles, entry.fg) };
    });
    return [{ id: 'default', label: 'Default', bg: DEFAULT_BG, fg: DEFAULT_FG }].concat(brand);
  }

  // ---- colour ---------------------------------------------------------------

  // The tools' one colour control (tool-colour.js; cms/tool-canvas.md,
  // Colour): the presets as the Pairs row, then Foreground — the logo and
  // the text — and Background, each the brand palette with a picker and a
  // hex field. Background's None is the URL's transparent. The controls
  // hold only valid colours, so the URL and the preview never carry junk.
  // Hex only, the same as every tool: the Worker still reads a CSS name in
  // a hand-written URL, but the tool writes hex.
  function buildColourControls() {
    colour.pairs = window.ToolColour.pairs(el.pairsMount, {
      id: 'image-placeholder-pair',
      label: 'Pairs',
      min: CONTRAST_MIN,
      pairs: presets.map(function (preset) {
        return { id: preset.id, label: preset.label, fg: '#' + preset.fg, bg: '#' + preset.bg };
      }),
      onChoose: handlePairChoose
    });
    colour.fg = window.ToolColour.create(el.fgMount, {
      id: 'image-placeholder-fg', label: 'Foreground', value: '#' + DEFAULT_FG, onChange: handleColourChange
    });
    colour.bg = window.ToolColour.create(el.bgMount, {
      id: 'image-placeholder-bg', label: 'Background', value: '#' + DEFAULT_BG, none: true, onChange: handleColourChange
    });
  }

  // ---- section resets -------------------------------------------------------

  // Settings is at its defaults when the size and the logo are as the markup
  // shipped them; the text is content, not a setting, so it does not count.
  function isSettingsDefault() {
    return el.width.value === el.width.defaultValue
      && el.height.value === el.height.defaultValue
      && el.optLogo.checked === el.optLogo.defaultChecked;
  }

  // The control hands back upper-case hex; the Worker's defaults are
  // written lower-case, so the comparison cases both.
  function isStyleDefault() {
    return urlColour(colour.fg.get()) === DEFAULT_FG
      && urlColour(colour.bg.get()) === DEFAULT_BG
      // A bad hex typed over a default colour is a change the reset clears
      && !colour.fg.isDirty()
      && !colour.bg.isDirty();
  }

  // Always there, disabled at the defaults (cms/tool-canvas.md, Section
  // reset). A disabled button drops focus; tool-canvas.js moves it to the
  // section's heading.
  function syncResets() {
    if (!colour.fg) { return; }
    el.settingsReset.disabled = isSettingsDefault();
    el.styleReset.disabled = isStyleDefault();
  }

  function handleSettingsReset() {
    [el.width, el.height].forEach(function resetField(field) {
      field.value = field.defaultValue;
    });
    el.optLogo.checked = el.optLogo.defaultChecked;
    renderNow();
    announce('Settings reset. ' + describe(readState()).replace(/^Placeholder, /, '') + '.');
  }

  function handleStyleReset() {
    colour.fg.set('#' + DEFAULT_FG);
    colour.bg.set('#' + DEFAULT_BG);
    syncColourExtras();
    renderNow();
    announce('Style reset to the Default pair.');
  }

  // The pair the two colours make, checked if it is one; the contrast line
  // measures them. None has nothing to measure.
  function syncColourExtras() {
    var fg = colour.fg.get().value;
    var bg = colour.bg.get().value;
    colour.pairs.sync(fg, bg);
    window.ToolColour.contrast(el.contrast, fg, bg, CONTRAST_MIN);
  }

  // The picker fires on every move of a drag, so changes are debounced.
  function handleColourChange() {
    syncColourExtras();
    scheduleRender();
  }

  function handlePairChoose(pair) {
    colour.fg.set(pair.fg);
    colour.bg.set(pair.bg);
    syncColourExtras();
    renderNow();
  }

  // A control's hex as the URL carries it: six lowercase digits, no "#";
  // None is transparent.
  function urlColour(state) {
    return state.value === null ? 'transparent' : state.value.slice(1).toLowerCase();
  }

  // ---- dimensions -----------------------------------------------------------

  function readDim(input) {
    var n = parseInt(input.value, 10);
    return isNaN(n) ? null : clamp(n, DIM_MIN, DIM_MAX);
  }

  // Commit on blur or change: the field takes the value the image will use,
  // and says so when that differs from what was typed. Never on input — a
  // status line that speaks on every keystroke is noise.
  function commitDim(input, name) {
    var raw = input.value.trim();
    var n = parseInt(raw, 10);
    var fallback = parseInt(input.defaultValue, 10);
    var limits = DIM_LIMITS[name.toLowerCase()];
    var message = '';

    if (raw === '' || isNaN(n)) {
      n = fallback;
      message = name + ' needs a number. Back to ' + fallback + '.';
    } else if (n > DIM_MAX) {
      n = DIM_MAX;
      message = DIM_MAX + ' is the ' + limits.max + '. ' + name + ' set to ' + DIM_MAX + '.';
    } else if (n < DIM_MIN) {
      n = DIM_MIN;
      message = DIM_MIN + ' is the ' + limits.min + '. ' + name + ' set to ' + DIM_MIN + '.';
    }

    if (String(n) !== input.value) { input.value = n; }
    if (message) { announce(message); }
    renderNow();
  }

  function handleWidthCommit() { commitDim(el.width, 'Width'); }
  function handleHeightCommit() { commitDim(el.height, 'Height'); }

  // ---- state -> URL -> preview ----------------------------------------------

  // Text is on when there is any; whitespace alone is not text, and the
  // edges are trimmed so the URL, the alt and the render agree. The colours
  // are always a valid pair — the controls hold nothing else — and the
  // Default pair is the Worker's own defaults, which buildPath leaves out.
  function readState() {
    var text = el.text.value.trim();
    return {
      width: readDim(el.width),
      height: readDim(el.height),
      logo: el.optLogo.checked,
      textOn: text.trim() !== '',
      text: text,
      bg: urlColour(colour.bg.get()),
      fg: urlColour(colour.fg.get())
    };
  }

  function buildPath(state) {
    var path = BASE_URL + state.width + 'x' + state.height;

    if (state.bg !== DEFAULT_BG || state.fg !== DEFAULT_FG) {
      path += '/' + state.bg;
      if (state.fg !== DEFAULT_FG) {
        path += '/' + state.fg;
      }
    }

    var query = [];
    if (state.textOn) {
      query.push('text=' + encodeURIComponent(state.text.replace(/\n/g, '\\n')));
    }
    if (!state.logo) {
      query.push('logo=0');
    }
    if (query.length) {
      path += '?' + query.join('&');
    }

    return path;
  }

  // The accessible name says what the image actually shows, not just its size.
  function describe(state) {
    var parts = [];
    if (state.logo) { parts.push('logo'); }
    if (state.textOn) { parts.push('\u201c' + state.text.trim() + '\u201d'); }
    var content = parts.length === 0 ? 'blank' : parts.length === 1 && state.logo ? 'logo only' : parts.join(' and ');
    return 'Placeholder, ' + state.width + ' \u00d7 ' + state.height + ', ' + content;
  }

  // The URL field and the Open link carry the absolute URL, the one a reader
  // pastes elsewhere; the preview loads the path, so it stays on this host.
  function render() {
    if (!el.preview || !el.preview.isConnected) { return; }
    syncResets();
    var state = readState();
    if (state.width === null || state.height === null) { return; }

    var path = buildPath(state);
    if (path === lastPath) { return; }
    lastPath = path;

    var fullUrl = window.location.origin + path;
    // The server draws the image, so the band shows it is waiting (tools.css,
    // Busy preview) until the new picture lands or fails. aria-busy goes on
    // the picture, not the band, which holds the status region.
    setBusy(true);
    el.preview.src = path;
    el.preview.alt = describe(state);
    el.url.value = fullUrl;
    el.open.href = fullUrl;
  }

  function setBusy(busy) {
    var band = el.preview && el.preview.parentNode;
    if (!band) { return; }
    band.toggleAttribute('data-loading', busy);
    if (busy) { el.preview.setAttribute('aria-busy', 'true'); }
    else { el.preview.removeAttribute('aria-busy'); }
  }

  function handlePreviewSettled() {
    setBusy(false);
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, RENDER_DEBOUNCE_MS);
  }

  function renderNow() {
    window.clearTimeout(renderTimer);
    render();
  }

  // Cleared before it is written, on a delay, so the same sentence twice in a
  // row is still announced.
  function announce(message) {
    window.clearTimeout(statusTimer);
    el.status.textContent = '';
    statusTimer = window.setTimeout(function speak() {
      if (el.status) { el.status.textContent = message; }
    }, STATUS_DELAY_MS);
  }

  // ---- reset all ------------------------------------------------------------

  // Reset all: every control back to the value it shipped with in the
  // markup, the text included. defaultValue / defaultChecked read the HTML
  // attributes, so the defaults live in one place — the page.
  function handleResetAll() {
    [el.width, el.height, el.text].forEach(function resetField(field) {
      field.value = field.defaultValue;
    });
    el.optLogo.checked = el.optLogo.defaultChecked;
    colour.fg.set('#' + DEFAULT_FG);
    colour.bg.set('#' + DEFAULT_BG);
    syncColourExtras();
    renderNow();
    announce('Everything reset. ' + describe(readState()).replace(/^Placeholder, /, '') + '.');
  }

  // ---- lifecycle ------------------------------------------------------------

  // Everything bound to elements dies with the Barba container. What does not
  // is released here, on the next arrival — the timers and the references.
  function release() {
    window.clearTimeout(renderTimer);
    window.clearTimeout(statusTimer);
    renderTimer = null;
    statusTimer = null;
    el = {};
    presets = [];
    colour = {};
    lastPath = '';
  }

  function bindElements(root) {
    el.root = root;
    el.preview = root.querySelector('#image-placeholder-image');
    el.width = root.querySelector('#image-placeholder-width');
    el.height = root.querySelector('#image-placeholder-height');
    el.optLogo = root.querySelector('#image-placeholder-logo');
    el.text = root.querySelector('#image-placeholder-text');
    el.pairsMount = root.querySelector('#image-placeholder-pairs');
    el.fgMount = root.querySelector('#image-placeholder-fg');
    el.bgMount = root.querySelector('#image-placeholder-bg');
    el.contrast = root.querySelector('#image-placeholder-contrast');
    el.url = root.querySelector('#image-placeholder-url');
    el.open = root.querySelector('#image-placeholder-open');
    el.status = root.querySelector('#image-placeholder-status');
    el.reset = root.querySelector('#image-placeholder-reset');
    el.settingsReset = root.querySelector('#image-placeholder-settings-reset');
    el.styleReset = root.querySelector('#image-placeholder-style-reset');
  }

  function bindEvents() {
    el.preview.addEventListener('load', handlePreviewSettled);
    el.preview.addEventListener('error', handlePreviewSettled);
    el.width.addEventListener('input', scheduleRender);
    el.height.addEventListener('input', scheduleRender);
    el.width.addEventListener('change', handleWidthCommit);
    el.height.addEventListener('change', handleHeightCommit);
    el.width.addEventListener('blur', handleWidthCommit);
    el.height.addEventListener('blur', handleHeightCommit);

    el.text.addEventListener('input', scheduleRender);
    el.text.addEventListener('change', renderNow);

    el.optLogo.addEventListener('change', renderNow);

    // A hex typed but not yet applied is a change the Style reset clears;
    // onChange never fires for it, so the mounts' own change does.
    el.fgMount.addEventListener('change', syncResets);
    el.bgMount.addEventListener('change', syncResets);

    el.reset.addEventListener('click', handleResetAll);
    // The section resets' clicks arrive as tool:panel-reset (tool-canvas.js).
    el.settingsReset.addEventListener('tool:panel-reset', handleSettingsReset);
    el.styleReset.addEventListener('tool:panel-reset', handleStyleReset);
  }

  function initImagePlaceholder() {
    release();

    // Barba appends the incoming container after the outgoing one, so the last
    // match is the page being entered.
    var roots = document.querySelectorAll('[data-tool="image-placeholder"]');
    var root = roots[roots.length - 1];
    if (!root || !root.querySelector('#image-placeholder-image')) { return; }

    bindElements(root);
    if (!window.ToolColour) {
      console.error('[Image Placeholder] tool-colour.js not loaded');
      return;
    }

    // The listeners live on the container's elements and die with it; the
    // guard only stops a second call against the same container binding twice.
    presets = resolvePresets();
    if (!root.dataset.imagePlaceholderInit) {
      root.dataset.imagePlaceholderInit = 'true';
      buildColourControls();
      controlsByRoot.set(root, colour);
      bindEvents();
    } else {
      colour = controlsByRoot.get(root) || colour;
      if (!colour.fg) {
        buildColourControls();
        controlsByRoot.set(root, colour);
      }
    }

    syncColourExtras();
    renderNow();

    console.log('[Image Placeholder] init');
  }

  window.initImagePlaceholder = initImagePlaceholder;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initImagePlaceholder bails when its markup is absent.
  function startImagePlaceholder() {
    initImagePlaceholder();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startImagePlaceholder);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startImagePlaceholder);
  } else {
    startImagePlaceholder();
  }
})();
