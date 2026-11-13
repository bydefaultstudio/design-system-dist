/**
 * tool-colour.js — The tools' one colour control
 * Every tool that colours its output builds its colour controls here, so they
 * look and behave the same everywhere (cms/tool-canvas.md, Colour):
 *
 *   - one control per colour ROLE — Colour when a tool has one, Foreground and
 *     Background when it has two — each the brand palette as colour chips,
 *     then a picker and a hex field that always show the chosen value, the
 *     field carrying a copy button for the hex (cms/field.md, Colour). Picking
 *     a chip fills the field; a hex that is not a palette colour checks none.
 *   - an optional None chip, first, where a file can have no background.
 *   - an optional Pairs row above a two-colour tool's controls: one chip sets
 *     both roles. The tool's own pairs, then the brand's toolPairings.
 *   - every chip shows its name as a tooltip.
 *   - a contrast line under a pair.
 *
 * One palette for every tool, read from the brand's tokens when a control is
 * built, so a brand that re-points them re-skins every tool at once. Reading
 * and contrast maths are color-core.js's (window.bdColor), which must load
 * first. A library: binds nothing, has no init. Exposes window.ToolColour.
 * @version 1.9.0
 */

(function () {
  'use strict';

  // The engine's words in this site's locale: bd-locale.js, which the docs
  // kit writes and loads first on a site that isn't en-GB. Without it, the
  // words as written.
  function L(text) { return window.bdLocale ? window.bdLocale.text(text) : text; }

  var VERSION = '1.9.0';
  console.log('[Tool Colour] v' + VERSION + ' loaded');

  /* The tools' palette, in this order: the two neutrals, the brown ramp, then
     one step of every hue. Token names without the dashes; the label is the
     name read as words. First set by the Icon Library, 2026-09.

     The hues are the brand's (bdColor.HUES, from brand.json colours.hues), in
     the engine's order where the engine has them, then any of the brand's own.
     A brand that names its colours (colours.named, THEME_CONFIG.palettePrimary)
     gets exactly those instead: a hue's base step can be a text ink rather
     than the brand colour. Read at call time, so a palette built before
     color-core loads still sees the brand's list. */
  var PALETTE_BASE = [
    'off-black', 'off-white',
    'brown-lighter', 'brown-light', 'brown', 'brown-dark'
  ];
  var ENGINE_HUE_ORDER = ['red', 'blue', 'yellow', 'green', 'purple', 'aqua', 'pink', 'peach'];

  function brandColours() {
    var config = typeof THEME_CONFIG !== 'undefined' && THEME_CONFIG ? THEME_CONFIG.palettePrimary : null;
    if (!config || !Array.isArray(config.primary) || !config.primary.length || !Array.isArray(config.secondary)) return null;
    return config.primary.concat(config.secondary);
  }

  function brandEntry(name) {
    var brand = brandColours();
    return brand ? brand.filter(function (c) { return c.token === name; })[0] || null : null;
  }

  function paletteNames() {
    var brand = brandColours();
    if (brand) return brand.map(function (c) { return c.token; });
    var hues = window.bdColor && Array.isArray(window.bdColor.HUES) ? window.bdColor.HUES : ENGINE_HUE_ORDER;
    var ordered = ENGINE_HUE_ORDER.filter(function (hue) { return hues.indexOf(hue) !== -1; });
    hues.forEach(function (hue) {
      if (hue !== 'brown' && ordered.indexOf(hue) === -1) ordered.push(hue);
    });
    // The brown ramp only for a brand that offers brown: the engine's brown
    // steps are neutral aliases, so a brand without it would see four greys.
    var base = hues.indexOf('brown') !== -1 ? PALETTE_BASE
      : PALETTE_BASE.filter(function (name) { return name.indexOf('brown') !== 0; });
    return base.concat(ordered);
  }

  var ERROR_MESSAGE = L('Use a hex colour, like 1F1F1F or #1F1F1F.');

  // The brand copy and check icons, inline: the hex field's copy button is
  // built here, after docgen has expanded the page's {{icon:…}} tokens.
  var ICON_COPY = '<span class="svg-icn" data-icon="copy"><svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M8 14C8 15.1046 8.89543 16 10 16H18C19.1046 16 20 15.1046 20 14V6C20 4.89543 19.1046 4 18 4H10C8.89543 4 8 4.89543 8 6V14ZM6 18V2H22V18H6ZM2 22V6H4V20H18V22H2Z" fill="currentColor"/>'
    + '</svg></span>';

  var ICON_CHECK = '<span class="svg-icn" data-icon="check"><svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M9.54998 18L3.84998 12.3L5.27498 10.875L8.13576 13.7358C8.91681 14.5168 10.1831 14.5168 10.9642 13.7358L18.725 5.97501L20.15 7.40001L9.54998 18Z" fill="currentColor"/>'
    + '</svg></span>';

  //
  //------- UTILITIES -------//
  //

  // "#1f1f1f", "1F1F1F", " #1F1F1F " → "#1F1F1F"; anything else → null.
  function normaliseHex(raw) {
    var h = String(raw == null ? '' : raw).trim();
    if (h.charAt(0) !== '#') h = '#' + h;
    return /^#[0-9A-Fa-f]{6}$/.test(h) ? h.toUpperCase() : null;
  }

  // "off-black" → "Off black": sentence case, the way the tools name colours.
  function readable(name) {
    var words = String(name).split('-');
    return words.map(function (word, index) {
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    }).join(' ');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The palette as { id, label, value }, resolved now: a theme loaded since
     the last control was built is the one read. A token the brand leaves
     undefined is skipped with a warning rather than drawn as a blank chip. */
  function readPalette() {
    if (!window.bdColor) {
      console.warn('[Tool Colour] color-core.js not loaded; the palette is empty');
      return [];
    }
    var names = paletteNames();
    var scan = window.bdColor.readTokens(document.documentElement, names);
    scan.undefined.concat(scan.unmeasured).forEach(function (name) {
      console.warn('[Tool Colour] palette token --' + name + ' skipped');
    });
    return names.filter(function (name) { return scan.map[name]; }).map(function (name) {
      // A named colour keeps its Figma name, and its id names exported files
      // (gold, black), so the token (yellow, off-black) stays CSS-only.
      var named = brandEntry(name);
      return {
        id: named && named.id ? named.id : name,
        label: named && named.label ? named.label : readable(name),
        value: normaliseHex(scan.map[name].hex)
      };
    });
  }

  function contrastRatio(a, b) {
    var bd = window.bdColor;
    var one = bd && bd.measure(a);
    var two = bd && bd.measure(b);
    return one && two ? bd.contrastRatio(one, two) : null;
  }

  /* A chip's tooltip sits centred above it, and at either end of a row it
     would run past the panel, which clips it. On hover or keyboard focus the
     bubble is measured where it would open and turned to the side with room,
     with the tooltip's own left and right positions — the Colour Pairing
     tool's pattern, bounded by the control rather than the screen. */
  function placeTooltip(event) {
    if (!(event.target instanceof Element)) return;
    var chip = event.target.closest('.chip[data-tooltip]');
    var mount = event.currentTarget;
    if (!chip || !mount.contains(chip)) return;
    chip.removeAttribute('data-tooltip-position');
    var bubble = parseFloat(window.getComputedStyle(chip, '::before').width) || 0;
    var box = chip.getBoundingClientRect();
    var bounds = mount.getBoundingClientRect();
    var centre = box.left + box.width / 2;
    // Turned only where the side has room; a bubble too long for either
    // stays centred.
    if (centre + bubble / 2 > bounds.right) {
      if (box.left - bubble >= bounds.left) chip.setAttribute('data-tooltip-position', 'left');
    } else if (centre - bubble / 2 < bounds.left) {
      if (box.right + bubble <= bounds.right) chip.setAttribute('data-tooltip-position', 'right');
    }
  }

  function bindTooltips(mount) {
    mount.addEventListener('pointerover', placeTooltip);
    mount.addEventListener('focusin', placeTooltip);
  }

  //
  //------- ONE ROLE -------//
  //

  /* Builds a role's control into mount (an empty element, usually a
     div.tool-colour) and returns its handle.
       opts.id        prefix for ids and the radio name: "qr-code-fg"
       opts.label     the caption: "Colour", "Foreground", "Background"
       opts.value     the starting hex, or null for None
       opts.none      true to offer a None chip, first
       opts.onChange  called with get() after the READER changes it — never
                      after set(), so a tool can set it from its own state
     handle.get()     { id, value, label }: id is a palette name, "custom" or
                      "none"; value is "#RRGGBB" or null for None
     handle.set(v)    "#RRGGBB" or null; checks the matching chip, if any */
  function create(mount, opts) {
    var palette = readPalette();
    var id = opts.id;
    var label = opts.label;
    var allowsNone = !!opts.none;
    var labelId = id + '-label';
    var errorId = id + '-error';
    var state = { id: 'custom', value: null };

    var chips = palette.map(function (entry) {
      // The tooltip shows the name for the eye; the tooltip component gives
      // its text empty alt, so the chip's name is still read once.
      return '<label class="chip" data-variant="colour" data-tooltip="' + escapeHtml(entry.label) + '" style="--chip-fill: ' + entry.value + '">'
        + '<input type="radio" name="' + id + '" value="' + escapeHtml(entry.id) + '">'
        + '<span class="chip-swatch" aria-hidden="true"></span>'
        + '<span class="visually-hidden">' + escapeHtml(entry.label) + '</span></label>';
    }).join('');
    if (allowsNone) {
      chips = '<label class="chip" data-variant="colour" data-none data-tooltip="None">'
        + '<input type="radio" name="' + id + '" value="none">'
        + '<span class="chip-swatch" aria-hidden="true"></span>'
        + '<span class="visually-hidden">None</span></label>' + chips;
    }

    // The swatches are a native radio group named by its legend (a bare
    // fieldset, design-system.css Form); the picker and the field name
    // their own role, so the group stops at the swatches.
    mount.classList.add('tool-colour');
    mount.innerHTML = ''
      + '<fieldset data-variant="bare">'
      +   '<legend data-variant="caption" id="' + labelId + '">' + escapeHtml(label) + '</legend>'
      +   '<div class="chip-group">' + chips + '</div>'
      + '</fieldset>'
      + '<div class="field">'
      +   '<input type="color" aria-label="' + escapeHtml(label) + ' picker">'
      +   '<input type="text" id="' + id + '-hex" maxlength="7" size="7" autocomplete="off" spellcheck="false"'
      +     ' aria-label="' + escapeHtml(label) + ' hex">'
      +   '<button type="button" class="field-action copy-btn" data-clipboard-target="#' + id + '-hex">'
      +     '<span class="copy-btn-default">' + ICON_COPY + '<span class="visually-hidden">Copy ' + escapeHtml(label.toLowerCase()) + ' hex</span></span>'
      +     '<span class="copy-btn-copied">' + ICON_CHECK + '<span class="visually-hidden">Copied!</span></span>'
      +   '</button>'
      + '</div>'
      + '<p class="form-error is-hidden" role="alert" id="' + errorId + '"></p>';

    var group = mount.querySelector('.chip-group');
    var picker = mount.querySelector('input[type="color"]');
    var text = mount.querySelector('input[type="text"]');
    var copy = mount.querySelector('.field-action');
    var error = mount.querySelector('.form-error');

    function find(hex) {
      return palette.filter(function (entry) { return entry.value === hex; })[0] || null;
    }

    function current() {
      if (state.id === 'none') return { id: 'none', value: null, label: 'None' };
      var entry = find(state.value);
      return { id: entry ? entry.id : 'custom', value: state.value, label: entry ? entry.label : state.value };
    }

    // The error is on the hex field, where the value was typed: the picker
    // only ever holds a valid colour. Rewritten a frame later, so a second
    // bad value still announces — an alert whose text does not change says
    // nothing. The field describes itself by the error only while there is
    // one; a description reads hidden text, so a valid field would otherwise
    // be read the error on every visit.
    function showError(show) {
      text.classList.toggle('is-error', show);
      if (show) {
        text.setAttribute('aria-invalid', 'true');
        text.setAttribute('aria-describedby', errorId);
      } else {
        text.removeAttribute('aria-invalid');
        text.removeAttribute('aria-describedby');
      }
      error.classList.toggle('is-hidden', !show);
      error.textContent = '';
      if (show) window.requestAnimationFrame(function () { error.textContent = ERROR_MESSAGE; });
    }

    /* Paints the state onto the chips, the picker and the field. None
       disables the field and the picker: there is no colour to edit, and
       both leave the tab order. The last colour stays in them, so turning
       None off by picking a chip or typing loses nothing. */
    function render(skipText) {
      var isNone = state.id === 'none';
      var entry = isNone ? null : find(state.value);
      group.querySelectorAll('input[type="radio"]').forEach(function (radio) {
        radio.checked = isNone ? radio.value === 'none' : !!entry && radio.value === entry.id;
      });
      picker.disabled = isNone;
      text.disabled = isNone;
      copy.disabled = isNone;
      if (state.value) {
        picker.value = state.value.toLowerCase();
        if (!skipText) text.value = state.value;
      }
      if (isNone) showError(false);
    }

    function changed() {
      if (typeof opts.onChange === 'function') opts.onChange(current());
    }

    function handleChip(event) {
      var radio = event.target;
      if (radio.value === 'none') {
        state.id = 'none';
      } else {
        var entry = palette.filter(function (e) { return e.id === radio.value; })[0];
        if (!entry) return;
        state.id = entry.id;
        state.value = entry.value;
        showError(false);
      }
      render();
      changed();
    }

    function handlePicker() {
      state.id = 'custom';
      state.value = normaliseHex(picker.value);
      showError(false);
      render();
      changed();
    }

    // The field applies when it is left or Enter is pressed (change); a
    // value that is not six hex digits shows the error and changes nothing.
    function handleText() {
      var hex = normaliseHex(text.value);
      if (!hex) {
        showError(true);
        return;
      }
      state.id = 'custom';
      state.value = hex;
      showError(false);
      render();
      changed();
    }

    // Typing again is the fix under way: the error waits for the next commit.
    function handleTextInput() {
      if (!error.classList.contains('is-hidden')) showError(false);
    }

    group.addEventListener('change', handleChip);
    bindTooltips(mount);
    picker.addEventListener('input', handlePicker);
    text.addEventListener('change', handleText);
    text.addEventListener('input', handleTextInput);

    function set(value) {
      if (value === null && allowsNone) {
        state.id = 'none';
      } else {
        var hex = normaliseHex(value);
        if (!hex) return;
        state.id = 'custom';
        state.value = hex;
      }
      showError(false);
      render();
    }

    set(opts.value === undefined ? palette.length && palette[0].value : opts.value);
    // A None start still needs a colour behind it for the field to show
    if (state.value === null) {
      state.value = palette.length ? palette[0].value : '#000000';
      render();
    }

    return {
      element: mount,
      get: current,
      set: set,
      // A typed value not yet committed, or one that failed: the section
      // reset counts it as a change it can clear.
      isDirty: function () {
        return normaliseHex(text.value) !== state.value && !text.disabled;
      }
    };
  }

  //
  //------- PAIRS -------//
  //

  /* A pair list from the brand manifest — brand.json, emitted into
     THEME_CONFIG — resolved against the live tokens. A pair naming a token
     the theme does not define is left out. */
  function resolvePairs(key) {
    var config = typeof THEME_CONFIG !== 'undefined' ? THEME_CONFIG : null;
    var list = config && Array.isArray(config[key]) ? config[key] : [];
    if (!list.length || !window.bdColor) return [];
    var names = [];
    list.forEach(function (pair) {
      if (!pair) return;
      if (names.indexOf(pair.fg) === -1) names.push(pair.fg);
      if (names.indexOf(pair.bg) === -1) names.push(pair.bg);
    });
    var scan = window.bdColor.readTokens(document.documentElement, names);
    return list.filter(function (pair) {
      return pair && scan.map[pair.fg] && scan.map[pair.bg];
    }).map(function (pair) {
      return {
        id: 'brand-' + pair.fg + '-on-' + pair.bg,
        label: readable(pair.fg) + ' on ' + readable(pair.bg).toLowerCase(),
        fg: scan.map[pair.fg].hex,
        bg: scan.map[pair.bg].hex
      };
    });
  }

  /* The brand's recommended pairings, colorPairings: the list the Colour
     Pairing tool offers. */
  function brandPairs() {
    return resolvePairs('colorPairings');
  }

  /* The brand pairs a tool's Pairs row offers: toolPairings, a shorter list
     of pairs to start an asset from, or colorPairings when the brand sets
     none. lightOnDark false keeps only the dark-on-light ones (a QR code
     reads dark on light only). The owner's picks, 2026-10-05. */
  function toolPairs(lightOnDark) {
    var config = typeof THEME_CONFIG !== 'undefined' ? THEME_CONFIG : null;
    var list = config && Array.isArray(config.toolPairings) ? resolvePairs('toolPairings') : brandPairs();
    if (lightOnDark !== false) return list;
    return list.filter(function (pair) {
      return contrastRatio(pair.fg, '#000000') < contrastRatio(pair.bg, '#000000');
    });
  }

  /* A row of pair chips above a two-colour tool's roles; choosing one sets
     both. The tool's own pairs come first, then the brand's tool pairs
     (toolPairs), less any the tool already has. Each chip is
     split in the pair's own order — foreground on the start half, background
     on the end — so it reads the way its name does, and a pair and its
     reverse look different. The selected ring is set apart from that order:
     --chip-ring takes the darker of the two (light theme) and --chip-ring-dark
     the lighter (dark theme). Each chip names its pair in words, with the
     verdict when the pair fails, and shows the name as a tooltip.
       opts.id, opts.label  as create()
       opts.pairs     [{ id, label, fg: "#RRGGBB", bg: "#RRGGBB" }]
       opts.min       the contrast a pair must clear (3 or 4.5)
       opts.lightOnDark  false drops the brand's light-on-dark pairs
       opts.onChoose  called with the pair after the reader picks one
     handle.sync(fg, bg)  checks the pair that matches both, or none
     handle.available(fn) hides the pairs fn rejects */
  function pairs(mount, opts) {
    var labelId = opts.id + '-label';
    var own = opts.pairs.map(function (pair) {
      return normaliseHex(pair.fg) + normaliseHex(pair.bg);
    });
    // Deduped against each other as well: two pairings resolving to the
    // same colours would be two chips with one meaning.
    var extra = toolPairs(opts.lightOnDark).filter(function (pair) {
      var key = normaliseHex(pair.fg) + normaliseHex(pair.bg);
      if (own.indexOf(key) !== -1) return false;
      own.push(key);
      return true;
    });
    var list = opts.pairs.concat(extra).map(function (pair) {
      var fg = normaliseHex(pair.fg);
      var bg = normaliseHex(pair.bg);
      var ratio = fg && bg ? contrastRatio(fg, bg) : null;
      return { id: pair.id, label: pair.label, fg: fg, bg: bg, fails: ratio !== null && !window.bdColor.clears(ratio, opts.min || 3), ratio: ratio };
    }).filter(function (pair) { return pair.fg && pair.bg; });

    // A native radio group named by its legend (a bare fieldset).
    mount.classList.add('tool-colour');
    mount.innerHTML = ''
      + '<fieldset data-variant="bare">'
      + '<legend data-variant="caption" id="' + labelId + '">' + escapeHtml(opts.label || 'Pairs') + '</legend>'
      + '<div class="chip-group">'
      + list.map(function (pair) {
        // Darker against black means closer to it. A tie goes to fg, which
        // only decides which ring a pair of equal luminance draws.
        var fgDarker = contrastRatio(pair.fg, '#000000') <= contrastRatio(pair.bg, '#000000');
        var darker = fgDarker ? pair.fg : pair.bg;
        var lighter = fgDarker ? pair.bg : pair.fg;
        return '<label class="chip" data-variant="colour" data-split data-tooltip="' + escapeHtml(pair.label) + '" style="--chip-fill: ' + pair.fg + '; --chip-fill-end: ' + pair.bg + '; --chip-ring: ' + darker + '; --chip-ring-dark: ' + lighter + '">'
          + '<input type="radio" name="' + opts.id + '" value="' + escapeHtml(pair.id) + '">'
          + '<span class="chip-swatch" aria-hidden="true"></span>'
          + '<span class="visually-hidden">' + escapeHtml(pair.label)
          + (pair.fails ? ', low contrast, ' + window.bdColor.truncate2(pair.ratio) + ' to 1' : '')
          + '</span></label>';
      }).join('')
      + '</div></fieldset>';

    var group = mount.querySelector('.chip-group');
    bindTooltips(mount);
    group.addEventListener('change', function handlePair(event) {
      var pair = list.filter(function (p) { return p.id === event.target.value; })[0];
      if (pair && typeof opts.onChoose === 'function') opts.onChoose(pair);
    });

    return {
      element: mount,
      pairs: list,
      // Hides the pairs the predicate rejects — a colourway the brand does
      // not approve on the artwork on show — and unchecks a hidden one. Focus
      // on a pair being hidden moves to the first one left, and a row with
      // none left hides whole rather than leave an empty caption.
      available: function (predicate) {
        var radios = Array.prototype.slice.call(group.querySelectorAll('input[type="radio"]'));
        var hadFocus = null;
        radios.forEach(function (radio) {
          var pair = list.filter(function (p) { return p.id === radio.value; })[0];
          var shown = !pair || !!predicate(pair);
          if (!shown && radio === document.activeElement) hadFocus = radio;
          radio.closest('.chip').classList.toggle('is-hidden', !shown);
          if (!shown) radio.checked = false;
        });
        var visible = radios.filter(function (radio) {
          return !radio.closest('.chip').classList.contains('is-hidden');
        });
        mount.classList.toggle('is-hidden', !visible.length);
        if (hadFocus && visible.length) visible[0].focus();
      },
      sync: function (fg, bg) {
        var f = normaliseHex(fg);
        var b = bg === null ? null : normaliseHex(bg);
        group.querySelectorAll('input[type="radio"]').forEach(function (radio) {
          var pair = list.filter(function (p) { return p.id === radio.value; })[0];
          var hidden = radio.closest('.chip').classList.contains('is-hidden');
          radio.checked = !!pair && !hidden && pair.fg === f && pair.bg === b;
        });
      }
    };
  }

  //
  //------- CONTRAST -------//
  //

  /* The pair's verdict, under the two roles: "Contrast 16.10:1, passes".
     Empty while there is no background to measure against. Not a live
     region — rewritten on every change. */
  function contrast(node, fg, bg, min) {
    if (!node) return;
    var ratio = fg && bg ? contrastRatio(fg, bg) : null;
    var floor = min || 3;
    var passes = ratio !== null && window.bdColor.clears(ratio, floor);
    var text = ratio === null ? ''
      : 'Contrast ' + window.bdColor.truncate2(ratio) + ':1, '
        + (passes ? 'passes' : 'below ' + floor + ':1');
    if (node.textContent !== text) node.textContent = text;
    node.toggleAttribute('data-fails', ratio !== null && !passes);
  }

  window.ToolColour = {
    paletteNames: paletteNames,
    readPalette: readPalette,
    normaliseHex: normaliseHex,
    contrastRatio: contrastRatio,
    create: create,
    pairs: pairs,
    brandPairs: brandPairs,
    toolPairs: toolPairs,
    contrast: contrast
  };
})();
