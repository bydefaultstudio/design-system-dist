/**
 * color-pairing.js — Colour Pairing Tool Page Controller
 * Reads the palette from the live theme through color-core.js, measures the
 * chosen pair against the WCAG 2 thresholds, and paints the preview's four
 * cells, the Contrast section's ratio and checks, the two colour grids and
 * the brand's recommended pairs in the Style section, and the CSS readout in
 * Export. A colour outside the palette can be set per side for the session;
 * it travels in the URL hash and is never stored. Loaded globally;
 * self-registers on DOMContentLoaded and bd:after-nav, scoped to the incoming
 * container, and exposes window.initColorPairing for a console or a host that
 * holds a container of its own.
 * @version 3.3.1
 */

(function () {
  'use strict';

  // The engine's words in this site's locale: bd-locale.js, which the docs
  // kit writes and loads first on a site that isn't en-GB. Without it, the
  // words as written.
  function L(text) { return window.bdLocale ? window.bdLocale.text(text) : text; }

  var VERSION = '3.3.1';
  console.log('[Colour Pairing] v' + VERSION + ' loaded');

  //
  //------- CONSTANTS -------//
  //

  var SIDES = ['fg', 'bg'];

  // grade is not written any more; it is still read, so a link from before
  // the filter was removed counts as this tool's hash and opens its pair.
  var HASH_KEYS = ['fg', 'bg', 'grade'];

  // Links shared before the neutrals left the grids: the two that have an
  // equivalent keep their meaning, every other neutral falls to the default.
  var ALIASES = {
    'white': 'off-white', 'neutral-50': 'off-white',
    'black': 'off-black', 'neutral-900': 'off-black'
  };

  var CUSTOM = 'custom';
  var HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

  var TOOL_SELECTOR = '[data-tool="color-pairing"]';

  // One per row of the checks table.
  var STAMP_COUNT = 5;

  // The dock toggle is set in the pair while the pair clears AA. Below that
  // it takes whichever off tone reads better on the cell under it, and pure
  // white or black where neither off tone clears AA either, so a failing
  // pair never hides the way back to the dock.
  var VERDICT_INKS = [['off-white', 'off-black'], ['white', 'black']];

  // Both long enough to swallow a held arrow key, short enough that a single
  // deliberate choice lands promptly. The announcement waits longer than the
  // URL write because it queues behind the radio's own focus announcement,
  // and arriving on top of that is how a live region gets talked over.
  var HASH_DELAY = 250;
  var STATUS_DELAY = 400;

  // The large glyph in the preview's inverted cell cycles through these, one
  // every GLYPH_INTERVAL, in the brand's tertiary face. The first is the one
  // in the markup, and the one that stays when the reader asks for reduced
  // motion. A content change, not an animation, so no motion token applies.
  var GLYPHS = ['&', '@', '?', '!', '#', '%', '*', '$'];
  var GLYPH_INTERVAL = 3000;
  var REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

  //
  //------- MODULE STATE -------//
  //

  // Per container: reset by initColorPairing, dropped by release().
  var state = null;     // { fg, bg } — a token name, or CUSTOM
  var customs = null;   // side -> colour | null
  var palette = null;   // name -> colour (see bdColor.readTokens)
  var inks = null;      // name -> colour, the verdict's fallback inks
  var pairings = null;  // [{ fg, bg }] that resolve in this palette
  var cells = null;     // side -> name -> { root, input, swatch, name }
  var pairCells = null; // [{ input, root, pair }]
  var el = null;        // resolved elements, el.root is the container
  var hashTimer = null;    // trailing write; see updateHash
  var statusTimer = null;  // trailing announcement; see announce
  var glyphTimer = null;   // the glyph's interval; see startGlyphs
  var glyphIndex = 0;

  // Per page, deliberately not reset: the hashchange listener is bound once
  // for the document's life, and the sequence has to keep climbing so two
  // containers alive at once never share a radio group name.
  var hashListenerBound = false;
  var groupSeq = 0;

  // The brand's first recommended pairing opens the tool; with none, the two
  // off tones, which every theme defines. The engine carries no pair of its own.
  var FALLBACK_PAIR = { fg: 'off-black', bg: 'off-white' };

  function defaultState() {
    var first = pairings && pairings[0];
    return first ? { fg: first.fg, bg: first.bg } : { fg: FALLBACK_PAIR.fg, bg: FALLBACK_PAIR.bg };
  }

  // The tokens the grids offer: nine hues at four steps, then the two
  // off tones. Neutrals are the Colour Palette's, not a pairing choice.
  function gridTokens() {
    return window.bdColor.hueTokens().concat(window.bdColor.EXTRAS);
  }

  //
  //------- COLOURS — palette tokens and the session's custom ones -------//
  //

  // "1a2b3c", "#1A2B3C" or "abc" → a measured colour, or null.
  function customColour(value) {
    var match = HEX_PATTERN.exec(String(value).trim());
    if (!match) return null;
    var digits = match[1];
    if (digits.length === 3) {
      digits = digits.split('').map(function (c) { return c + c; }).join('');
    }
    var measured = window.bdColor.measure('#' + digits);
    if (!measured) return null;
    return {
      name: CUSTOM,
      css: measured.hex,
      label: 'Custom ' + measured.hex,
      hex: measured.hex,
      lum: measured.lum
    };
  }

  // palette and ALIASES are plain objects, so a name such as "constructor"
  // would otherwise find Object's own members.
  function has(map, name) {
    return Object.prototype.hasOwnProperty.call(map, name);
  }

  function colourOf(side) {
    return state[side] === CUSTOM ? customs[side] : palette[state[side]];
  }

  // A hash value is a token name first, then a hex; no palette token reads
  // as hex, and checking the palette first keeps it that way if one ever did.
  function resolveValue(target, side, value) {
    var name = has(ALIASES, value) ? ALIASES[value] : value;
    if (has(palette, name)) {
      target.state[side] = name;
      return;
    }
    var custom = customColour(value);
    if (custom) {
      target.customs[side] = custom;
      target.state[side] = CUSTOM;
    }
  }

  // The defaults name tokens every brand is expected to define, but a brand
  // can still drop one, and a link can name a token this brand lacks; fall
  // back to the default for that side, then to the first colours that do
  // exist, rather than measure nothing. The same colour on both sides is
  // allowed: 1.00:1 is a legitimate thing to show. A custom colour stays in
  // its chip after the reader picks another, so it can be compared back;
  // only Reset and a new hash clear it. The hash carries only the chosen.
  function ensureState() {
    var names = Object.keys(palette);
    var defaults = defaultState();
    SIDES.forEach(function (side) {
      if (state[side] === CUSTOM && customs[side]) return;
      if (has(palette, state[side])) return;
      if (has(palette, defaults[side])) {
        state[side] = defaults[side];
        return;
      }
      var other = state[side === 'fg' ? 'bg' : 'fg'];
      state[side] = names[names[0] === other && names.length > 1 ? 1 : 0];
    });
  }

  // Brand-curated, from brand.json by way of theme-config.js: the tools'
  // pairs (toolPairings), the list every tool's Pairs row offers, or the
  // brand's whole colorPairings where it sets none, as tool-colour.js does.
  // The first is the pair the tool opens on. A pair naming a token this
  // palette lacks is dropped rather than drawn half-empty.
  function readPairings() {
    var config = typeof THEME_CONFIG !== 'undefined' ? THEME_CONFIG : null;
    var list = !config ? []
      : Array.isArray(config.toolPairings) && config.toolPairings.length ? config.toolPairings
      : Array.isArray(config.colorPairings) ? config.colorPairings : [];
    return list.filter(function (pair) {
      return pair && has(palette, pair.fg) && has(palette, pair.bg);
    });
  }

  //
  //------- HASH — the pair travels in the URL -------//
  //

  function hashValue(side) {
    return state[side] === CUSTOM ? customs[side].hex.slice(1).toLowerCase() : state[side];
  }

  // Key=value pairs never coincide with an element id, so a hard load with
  // the hash set scrolls nowhere.
  function stateToHash() {
    var params = new URLSearchParams();
    params.set('fg', hashValue('fg'));
    params.set('bg', hashValue('bg'));
    return params.toString();
  }

  // Reads over the defaults; ensureState() then throws out anything the
  // palette does not know. A hash that carries none of the tool's keys is
  // not the tool's: the shell's skip link writes #main, and that must leave
  // the pair alone. Parsed into a copy and committed only when it names a
  // different pair, so a Back that lands on the same pair keeps the custom
  // colours the reader has built up. Returns whether the pair changed.
  function hashToState() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    var known = HASH_KEYS.filter(function (key) { return params.has(key); });
    if (!known.length) return false;
    var before = state && customs ? stateToHash() : null;
    var previous = { state: state, customs: customs };
    var next = { state: defaultState(), customs: { fg: null, bg: null } };
    SIDES.forEach(function (side) {
      if (params.has(side)) resolveValue(next, side, String(params.get(side)).toLowerCase());
    });
    state = next.state;
    customs = next.customs;
    ensureState();
    if (before !== null && stateToHash() === before) {
      state = previous.state;
      customs = previous.customs;
      return false;
    }
    return true;
  }

  // Written on every render, the first included, so Copy link always carries
  // the pair on screen. history.state is carried through: Barba keeps its
  // history payload there, and replacing it with null turns the next Back
  // into a pushState inside popstate, which kills Forward.
  // Coalesced on a trailing timeout: a held arrow key fires the change handler
  // about thirty times a second, and Safari throws a SecurityError past ~100
  // replaceState calls in 30 seconds. The throw is caught as well as avoided.
  function writeHash() {
    hashTimer = null;
    // Both callers check first; this keeps the write safe on its own.
    if (!el || !isOwnPage(el.root)) return;
    var next = '#' + stateToHash();
    if (window.location.hash === next) return;
    try {
      history.replaceState(history.state, '', next);
    } catch (error) {
      console.warn('[Colour Pairing] the browser refused a history write; the URL is stale', error);
    }
  }

  // Barba pushes the destination URL synchronously inside go(), well before
  // the transition ends and release() clears this timer, so a write armed in
  // the last quarter-second on the tool would resolve its relative hash
  // against the page the reader has just moved to. The path is stamped at
  // wire time, not when the write is scheduled: keyboard input stays live on
  // the leaving container for the whole transition, and a write armed then
  // would stamp the destination and pass its own check.
  // The query is stamped too: Barba fetches before the router marks the
  // leaving container data-bd-role="leave", so a link to this same page with a
  // new query moves the address while the container is still unmarked.
  function isOwnPage(root) {
    return !!el && el.root === root && window.location.pathname === el.ownPath
      && window.location.search === el.ownSearch
      && !root.closest('[data-bd-role="leave"]');
  }

  function updateHash() {
    var root = el.root;
    if (hashTimer) clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      if (isOwnPage(root)) writeHash();
      else hashTimer = null;
    }, HASH_DELAY);
  }

  // Copy link reads location.href, so the coalesced write has to land first.
  // Always written, not only when a write is pending: after the skip link
  // sets #main the URL has lost the pair with nothing scheduled to restore it.
  function flushHash() {
    if (hashTimer) clearTimeout(hashTimer);
    hashTimer = null;
    if (isOwnPage(el.root)) writeHash();
  }

  // One sentence, written after the movement stops, so arrowing through a
  // grid or dragging the picker does not queue dozens of announcements.
  function announce(sentence) {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      statusTimer = null;
      // release() nulls el, and a leaving container stays keyboard-live for
      // the whole transition, so this can outlive what armed it.
      if (el && el.root.isConnected) el.status.textContent = sentence;
    }, STATUS_DELAY);
  }

  // Bound once on window for the life of the page. replaceState never fires
  // this, so it only sees Back and Forward across hash-only entries, and
  // only acts while the tool's container is the live one.
  function handleHashChange() {
    if (!el || !el.root.isConnected || !palette) return;
    if (!hashToState()) return;
    announce(render());
    // A navigation supersedes half-typed input: left in the field, it would
    // commit on blur over the pair Back has just restored.
    SIDES.forEach(function (side) { seedCustomField(side, true); });
    updateHash();
  }

  //
  //------- DOM — build once, then only update -------//
  //

  // Every element the markup promises. A missing one is a build fault,
  // reported before the container is marked wired so nothing runs half-bound.
  function resolveElements(root) {
    var ids = {
      empty: 'color-pairing-empty', emptyWrap: 'color-pairing-empty-wrap',
      status: 'color-pairing-status', preview: 'color-pairing-preview',
      dock: 'color-pairing-dock', glyph: 'color-pairing-glyph', ratio: 'color-pairing-ratio',
      ratioSpoken: 'color-pairing-ratio-spoken', checks: 'color-pairing-checks',
      colours: 'color-pairing-colours', swap: 'color-pairing-swap',
      css: 'color-pairing-css', reset: 'color-pairing-reset',
      fgGrid: 'color-pairing-fg-grid', bgGrid: 'color-pairing-bg-grid',
      pairs: 'color-pairing-pairs', pairsNone: 'color-pairing-pairs-none',
      skipped: 'color-pairing-skipped'
    };
    var found = { root: root, customFields: {} };
    var missing = [];
    Object.keys(ids).forEach(function (key) {
      found[key] = root.querySelector('#' + ids[key]);
      if (!found[key]) missing.push('#' + ids[key]);
    });
    found.stamps = found.checks ? found.checks.querySelectorAll('.tool-stamp[data-min]') : [];
    if (found.stamps.length !== STAMP_COUNT) missing.push('#color-pairing-checks .tool-stamp[data-min] x' + STAMP_COUNT);
    // The chips' tooltips are clipped by the section, and its sticky header
    // covers its top while it scrolls: both bound placeTooltip.
    var section = found.colours && found.colours.closest('.tool-panel');
    found.clip = found.colours && found.colours.closest('.accordion-inner');
    found.styleHeader = section && section.querySelector('.tool-panel-header');
    if (!found.clip || !found.styleHeader) missing.push('the Style section around #color-pairing-colours');
    SIDES.forEach(function (side) {
      var custom = root.querySelector('.tool-custom[data-side="' + side + '"]');
      var parts = custom && {
        root: custom,
        picker: custom.querySelector('.tool-custom-picker'),
        hex: custom.querySelector('.tool-custom-hex'),
        error: custom.querySelector('.form-error')
      };
      if (!parts || !parts.picker || !parts.hex || !parts.error) {
        missing.push('.tool-custom[data-side="' + side + '"] and its field');
        return;
      }
      found.customFields[side] = parts;
    });
    return missing.length ? { missing: missing } : found;
  }

  function makeSpan(className, text) {
    var span = document.createElement('span');
    if (className) span.className = className;
    if (text) span.textContent = text;
    return span;
  }

  // The system's colour chip: a label wrapping a covered radio, the paint on
  // .chip-swatch, the name moved to .visually-hidden. See cms/chip.md.
  function makeChip(groupName, side, value, fill) {
    var label = document.createElement('label');
    label.className = 'chip tool-chip';
    label.setAttribute('data-variant', 'colour');
    label.style.setProperty('--chip-fill', fill);

    var input = document.createElement('input');
    input.type = 'radio';
    // The name is document-global for radios outside a form, and with a
    // synchronous Barba transition both containers are in the document at
    // once, so the sequence keeps the two groups apart.
    input.name = groupName;
    input.value = value;
    input.dataset.side = side;

    var swatch = makeSpan('chip-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    var name = makeSpan('visually-hidden');

    label.appendChild(input);
    label.appendChild(swatch);
    label.appendChild(name);
    return { root: label, input: input, swatch: swatch, name: name };
  }

  // One chip per token per side, hue by hue in the DOM so the arrow keys
  // walk one hue before the next; --hue and --step place each in a column
  // per hue and a row per step. The off tones and the custom chip share the
  // row after, placed by --pos. Built once per init.
  function buildGrid(side) {
    var grid = side === 'fg' ? el.fgGrid : el.bgGrid;
    var groupName = 'color-pairing-' + side + '-' + groupSeq;
    var hues = window.bdColor.HUES;
    var steps = window.bdColor.STEPS;
    var extraPos = 0;
    cells[side] = {};
    grid.textContent = '';

    hues.forEach(function (hue, h) {
      steps.forEach(function (step, s) {
        var name = hue + step;
        if (!palette[name]) return;
        var cell = makeChip(groupName, side, name, palette[name].css);
        cell.root.setAttribute('data-tooltip', palette[name].label);
        cell.root.style.setProperty('--hue', String(h + 1));
        cell.root.style.setProperty('--step', String(s + 1));
        grid.appendChild(cell.root);
        cells[side][name] = cell;
      });
    });

    window.bdColor.EXTRAS.forEach(function (name) {
      if (!palette[name]) return;
      extraPos += 1;
      var cell = makeChip(groupName, side, name, palette[name].css);
      cell.root.setAttribute('data-tooltip', palette[name].label);
      cell.root.setAttribute('data-row', 'extra');
      cell.root.style.setProperty('--pos', String(extraPos));
      grid.appendChild(cell.root);
      cells[side][name] = cell;
    });

    // The custom chip exists from the start and is hidden until a colour is
    // set, so setting one never rebuilds the group under the reader's focus.
    var custom = makeChip(groupName, side, CUSTOM, 'transparent');
    custom.root.setAttribute('data-row', 'extra');
    custom.root.style.setProperty('--pos', String(extraPos + 1));
    custom.root.classList.add('is-hidden');
    grid.appendChild(custom.root);
    cells[side][CUSTOM] = custom;
  }

  // Split chips, one radio per recommended pair; choosing one sets both
  // sides. The chip shows the pair in its own order, text on the start half
  // and background on the end, so it reads the way its name does and a pair
  // and its reverse look different. The selected ring is set apart from that
  // order: --chip-ring takes the darker colour (light theme), --chip-ring-dark
  // the lighter (dark theme). A tie in luminance goes to the text.
  function buildPairings() {
    var groupName = 'color-pairing-pairs-' + groupSeq;
    el.pairs.textContent = '';
    pairCells = [];
    pairings.forEach(function (pair, index) {
      var fg = palette[pair.fg];
      var bg = palette[pair.bg];
      var darker = fg.lum <= bg.lum ? fg : bg;
      var lighter = darker === fg ? bg : fg;
      var cell = makeChip(groupName, 'pair', String(index), fg.css);
      cell.root.setAttribute('data-split', '');
      cell.root.style.setProperty('--chip-fill-end', bg.css);
      cell.root.style.setProperty('--chip-ring', darker.css);
      cell.root.style.setProperty('--chip-ring-dark', lighter.css);
      cell.root.setAttribute('data-tooltip', fg.label + ' on ' + bg.label);
      var ratio = window.bdColor.contrastRatio(fg, bg);
      cell.name.textContent = fg.label + ' on ' + bg.label + ', ' + window.bdColor.truncate2(ratio) + ' to 1';
      el.pairs.appendChild(cell.root);
      pairCells.push({ input: cell.input, root: cell.root, pair: pair });
    });
    el.pairs.classList.toggle('is-hidden', !pairings.length);
    el.pairsNone.classList.toggle('is-hidden', pairings.length > 0);
  }

  // The custom chip for a side follows customs[side]: painted, named and
  // shown when there is one, hidden when there is not.
  function renderCustom(side) {
    var cell = cells[side][CUSTOM];
    var colour = customs[side];
    cell.root.classList.toggle('is-hidden', !colour);
    cell.root.style.setProperty('--chip-fill', colour ? colour.css : 'transparent');
    if (colour) cell.root.setAttribute('data-tooltip', colour.label);
    else cell.root.removeAttribute('data-tooltip');
  }

  // The picker and the hex field always show the side's colour. A field the
  // reader is in is left alone — the picker while it is dragged, the hex
  // while it is typed in — so a render never rewrites what is under the
  // hand, unless force says the value is committed or superseded. A hex field
  // rewritten with a valid colour sheds any error it was showing.
  function seedCustomField(side, force) {
    var field = el.customFields[side];
    var hex = colourOf(side).hex;
    if (force || document.activeElement !== field.picker) field.picker.value = hex.toLowerCase();
    if (force || document.activeElement !== field.hex) {
      field.hex.value = hex.toUpperCase();
      if (field.hex.hasAttribute('aria-invalid')) showCustomError(side, false);
    }
  }

  // The verdict ink: the text colour while the pair clears AA, otherwise
  // the best-reading fallback on the ground. The ratio is the same either
  // way round, so one ratio serves both the pair and its inversion.
  function verdictInk(text, ground, ratio) {
    var bdColor = window.bdColor;
    if (bdColor.clears(ratio, bdColor.AA)) return text;
    var best = null;
    var bestRatio = -1;
    for (var i = 0; i < VERDICT_INKS.length; i++) {
      VERDICT_INKS[i].forEach(function (name) {
        var ink = inks[name];
        if (!ink) return;
        var r = bdColor.contrastRatio(ink, ground);
        if (r > bestRatio) { best = ink; bestRatio = r; }
      });
      if (best && bdColor.clears(bestRatio, bdColor.AA)) break;
    }
    return best || text;
  }

  // The pair's colours are set once on the container, so the four cells
  // and the stamps inherit them; each cell picks its ink and ground from
  // them (color-pairing.css, Bento). The two verdict inks are the dock
  // toggle's, over a plain cell and over an inverted one.
  function renderPair(fg, bg, ratio) {
    var bdColor = window.bdColor;
    el.root.style.setProperty('--color-pairing-fg', fg.css);
    el.root.style.setProperty('--color-pairing-bg', bg.css);
    el.root.style.setProperty('--color-pairing-verdict-ink', verdictInk(fg, bg, ratio).css);
    el.root.style.setProperty('--color-pairing-verdict-ink-inverted', verdictInk(bg, fg, ratio).css);
    el.css.value = 'color: ' + fg.css + ';\nbackground-color: ' + bg.css + ';';

    var shown = bdColor.truncate2(ratio);
    el.ratio.textContent = shown + ':1';
    // "4.83:1" is read as "4.83 colon 1"; the spoken copy says what it means,
    // after the "Ratio" caption beside it.
    el.ratioSpoken.textContent = shown + ' to 1';

    Array.prototype.forEach.call(el.stamps, function (stamp) {
      var pass = bdColor.clears(ratio, parseFloat(stamp.getAttribute('data-min')));
      stamp.setAttribute('data-result', pass ? 'pass' : 'fail');
      stamp.querySelector('.tool-stamp-text').textContent = pass ? 'Pass' : 'Fail';
    });

    var verdict = bdColor.clears(ratio, bdColor.AAA) ? 'passes normal text AAA'
      : bdColor.clears(ratio, bdColor.AA) ? 'passes normal text AA'
      : bdColor.clears(ratio, bdColor.LARGE) ? 'passes large text and graphics only'
      : 'fails every check';
    return fg.label + ' on ' + bg.label + ', ' + shown + ' to 1, ' + verdict + '.';
  }

  // One side's chips, each measured against the colour held on the other
  // side. Only the chosen chip draws a mark, so the verdict is never
  // grid-wide noise: a tick when the pair clears 3:1, a cross when it
  // misses every bar, and the same said in the chip's name, because no mask
  // reaches an assistive technology.
  function renderGrid(side, fg, bg) {
    var isText = side === 'fg';
    var held = isText ? bg : fg;
    Object.keys(cells[side]).forEach(function (name) {
      var cell = cells[side][name];
      var candidate = name === CUSTOM ? customs[side] : palette[name];
      var selected = state[side] === name;
      cell.input.checked = selected;
      cell.root.classList.toggle('is-selected', selected);
      if (!candidate) return;
      var ratio = window.bdColor.contrastRatio(candidate, held);
      var failed = !window.bdColor.clears(ratio, window.bdColor.LARGE);
      if (failed) cell.root.setAttribute('data-contrast', 'fail');
      else cell.root.removeAttribute('data-contrast');
      var wanted = failed
        ? candidate.label + ', fails contrast, ' + window.bdColor.truncate2(ratio) + ' to 1'
        : candidate.label;
      if (cell.name.textContent !== wanted) cell.name.textContent = wanted;
    });
  }

  // A pair reads as chosen only while both sides still match it.
  function renderPairings() {
    pairCells.forEach(function (cell) {
      var selected = state.fg === cell.pair.fg && state.bg === cell.pair.bg;
      cell.input.checked = selected;
      cell.root.classList.toggle('is-selected', selected);
    });
  }

  // Returns the sentence describing the pair, so the caller decides whether
  // to announce it.
  function render() {
    var fg = colourOf('fg');
    var bg = colourOf('bg');
    SIDES.forEach(renderCustom);
    var sentence = renderPair(fg, bg, window.bdColor.contrastRatio(fg, bg));
    renderGrid('fg', fg, bg);
    renderGrid('bg', fg, bg);
    renderPairings();
    SIDES.forEach(seedCustomField);
    return sentence;
  }

  // Nothing can be measured: the message takes the preview's place, and the
  // preview and the dock go with everything in them. The message is rebuilt
  // rather than appended to, so the markup's own link survives.
  function showEmpty(message, link) {
    if (message) {
      el.empty.textContent = message;
      if (link) {
        el.empty.appendChild(document.createTextNode(' ' + link.before));
        var anchor = document.createElement('a');
        anchor.href = link.href;
        anchor.textContent = link.text;
        el.empty.appendChild(anchor);
        el.empty.appendChild(document.createTextNode(link.after));
      }
    }
    el.emptyWrap.classList.remove('is-hidden');
    el.preview.classList.add('is-hidden');
    el.dock.classList.add('is-hidden');
    el.reset.disabled = true;
  }

  function countSentence(n, noun) {
    return n + ' ' + noun + (n === 1 ? '' : 's');
  }

  function renderSkipped(scan) {
    var parts = [];
    var undefinedCount = scan.undefined.length;
    var unmeasuredCount = scan.unmeasured.length;
    if (undefinedCount) {
      parts.push('The grids leave out ' + countSentence(undefinedCount, 'palette token') + ' this brand does not set.');
    }
    if (unmeasuredCount) {
      parts.push((undefinedCount ? 'They also leave out ' : 'The grids leave out ')
        + countSentence(unmeasuredCount, 'palette token') + (unmeasuredCount === 1 ? ' that carries' : ' that carry')
        + ' transparency, or a value the tool cannot read, so one number would be wrong over most surfaces.');
    }
    el.skipped.textContent = parts.join(' ');
    el.skipped.classList.toggle('is-hidden', !parts.length);
  }

  //
  //------- CUSTOM COLOUR — the picker and hex field under each grid -------//
  //

  // The error is on the hex field, where the value was typed: the picker
  // only ever holds a valid colour. Empty while silent, so the canvas clips
  // it (tools.css, Actions), and rewritten a frame later when shown, so a
  // second mistake is announced like the first rather than met with
  // silence. The field is described by the error only while there is one.
  function showCustomError(side, show) {
    var field = el.customFields[side];
    // A hide that lands before the frame would otherwise be undone by it.
    if (field.errorFrame) window.cancelAnimationFrame(field.errorFrame);
    field.errorFrame = 0;
    field.error.textContent = '';
    if (show) {
      var message = field.error.getAttribute('data-message');
      field.errorFrame = window.requestAnimationFrame(function () {
        field.errorFrame = 0;
        field.error.textContent = message;
      });
      field.hex.setAttribute('aria-invalid', 'true');
      field.hex.setAttribute('aria-describedby', field.error.id);
    } else {
      field.hex.removeAttribute('aria-invalid');
      field.hex.removeAttribute('aria-describedby');
    }
    field.hex.classList.toggle('is-error', show);
  }

  // A colour from either control becomes that side's custom chip and is
  // chosen. Focus stays where the reader is: a field applied by leaving it
  // must not pull focus back.
  function applyCustom(side, colour) {
    showCustomError(side, false);
    customs[side] = colour;
    state[side] = CUSTOM;
    announce(render());
    updateHash();
  }

  //
  //------- GLYPH — the inverted cell's display character -------//
  //

  // One step through GLYPHS. A hidden tab skips its ticks, and a reader who
  // turns on reduced motion mid-visit is answered on the next one: the
  // glyph goes back to the first and stays.
  function nextGlyph() {
    if (!el || !el.root.isConnected) return;
    if (document.hidden) return;
    if (window.matchMedia(REDUCED_MOTION).matches) {
      glyphIndex = 0;
    } else {
      glyphIndex = (glyphIndex + 1) % GLYPHS.length;
    }
    el.glyph.textContent = GLYPHS[glyphIndex];
  }

  function startGlyphs() {
    glyphIndex = 0;
    el.glyph.textContent = GLYPHS[0];
    glyphTimer = setInterval(nextGlyph, GLYPH_INTERVAL);
  }

  //
  //------- EVENTS — delegated on the tool's container -------//
  //

  // Guards every delegated handler: during a synchronous transition both
  // containers are in the document and the leaving one is still interactive,
  // so an event has to prove it belongs to the wired container before it can
  // touch shared state.
  function isLive(event) {
    return !!el && !!state && !!palette
      && event.target instanceof Node && el.root.contains(event.target);
  }

  function sideOfCustom(target) {
    var custom = target.closest('.tool-custom');
    var side = custom && custom.getAttribute('data-side');
    return SIDES.indexOf(side) === -1 ? null : side;
  }

  function swapSides() {
    var fg = state.fg;
    state.fg = state.bg;
    state.bg = fg;
    var customFg = customs.fg;
    customs.fg = customs.bg;
    customs.bg = customFg;
  }

  function handleRootClick(event) {
    if (!isLive(event)) return;
    var target = event.target;
    if (!(target instanceof Element)) return;
    // Copy link reads location.href, and the hash write is coalesced, so it
    // has to land before the copy chrome's own document-level handler runs.
    if (target.closest('.js-copy-url')) { flushHash(); return; }
    if (el.swap.contains(target)) {
      swapSides();
      announce(render());
      updateHash();
      return;
    }
    if (el.reset.contains(target)) {
      state = defaultState();
      customs = { fg: null, bg: null };
      ensureState();
      SIDES.forEach(function (side) { showCustomError(side, false); });
      announce('Reset. ' + render());
      updateHash();
    }
  }

  // Radios, and the hex field once it is left or Enter is pressed.
  function handleChange(event) {
    if (!isLive(event)) return;
    var input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    if (input.type === 'radio') {
      var side = input.dataset.side;
      if (side === 'pair') {
        var cell = pairCells[parseInt(input.value, 10)];
        if (!cell) return;
        state.fg = cell.pair.fg;
        state.bg = cell.pair.bg;
        ensureState();
      } else if (SIDES.indexOf(side) !== -1) {
        if (input.value === CUSTOM ? !customs[side] : !has(palette, input.value)) return;
        state[side] = input.value;
        ensureState();
      } else {
        return;
      }
      announce(render());
      updateHash();
      return;
    }

    var customSide = sideOfCustom(input);
    if (customSide && input === el.customFields[customSide].hex) {
      var colour = customColour(input.value);
      if (!colour) {
        showCustomError(customSide, true);
        return;
      }
      // The same colour typed back changes nothing, and keeps a palette
      // token from turning into a custom chip of itself.
      if (colour.hex !== colourOf(customSide).hex) applyCustom(customSide, colour);
      // Committed, so no longer under the hand: the field shows the colour
      // as the tool spells it, #1A2B3C for 1a2b3c or abc.
      seedCustomField(customSide, true);
    }
  }

  // The picker applies as it moves. Typing in the hex field is the fix
  // under way, so an error waits for the next commit.
  function handleInput(event) {
    if (!isLive(event)) return;
    var target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    var side = sideOfCustom(target);
    if (!side) return;
    var field = el.customFields[side];
    if (target === field.picker) {
      var colour = customColour(field.picker.value);
      // The same colour dragged back changes nothing, and keeps a palette
      // token from turning into a custom chip of itself.
      if (colour && colour.hex !== colourOf(side).hex) applyCustom(side, colour);
      field.hex.value = field.picker.value.toUpperCase();
    } else if (target === field.hex && field.hex.hasAttribute('aria-invalid')) {
      showCustomError(side, false);
    }
  }

  // A chip's tooltip sits centred above it, and the Style section clips
  // anything that leaves it (.accordion-inner), while its sticky header
  // covers its top as it scrolls. On hover or keyboard focus the bubble is
  // measured where it would open: turned to the side with room at either end
  // of a row, else under the chip when there is no room above it, using the
  // tooltip's own positions (cms/tooltip.md) — tool-colour.js's pattern,
  // bounded by the section rather than the screen.
  function placeTooltip(event) {
    if (!isLive(event) || !(event.target instanceof Element)) return;
    var chip = event.target.closest('.tool-chip[data-tooltip]');
    if (!chip || !el.colours.contains(chip)) return;
    chip.removeAttribute('data-tooltip-position');
    var bubble = window.getComputedStyle(chip, '::before');
    var width = parseFloat(bubble.width) || 0;
    var height = parseFloat(bubble.height) || 0;
    var box = chip.getBoundingClientRect();
    var bounds = el.clip.getBoundingClientRect();
    var top = Math.max(bounds.top, el.styleHeader.getBoundingClientRect().bottom);
    var centre = box.left + box.width / 2;
    // A side position sits beside the chip, clear of the top, so the ends of
    // a row turn first; only a chip with room on neither side opens below.
    if (centre + width / 2 > bounds.right && box.left - width >= bounds.left) {
      chip.setAttribute('data-tooltip-position', 'left');
    } else if (centre - width / 2 < bounds.left && box.right + width <= bounds.right) {
      chip.setAttribute('data-tooltip-position', 'right');
    } else if (box.top - height - box.height / 2 < top) {
      chip.setAttribute('data-tooltip-position', 'bottom');
    }
  }

  function setupEventListeners(root) {
    root.addEventListener('pointerover', placeTooltip);
    root.addEventListener('focusin', placeTooltip);
    root.addEventListener('click', handleRootClick);
    root.addEventListener('change', handleChange);
    root.addEventListener('input', handleInput);
  }

  //
  //------- INIT — on load and after every Barba navigation -------//
  //

  // A pending write belongs to the container that scheduled it. If it
  // survives into the next one it announces a sentence about colours nobody
  // chose, or writes a hash from state that has just been reset.
  function clearTimers() {
    if (hashTimer) { clearTimeout(hashTimer); hashTimer = null; }
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (glyphTimer) { clearInterval(glyphTimer); glyphTimer = null; }
  }

  // Drop every reference to a container that has left, so the detached tree
  // and its listeners can go with it.
  function release() {
    clearTimers();
    state = null;
    customs = null;
    palette = null;
    inks = null;
    pairings = null;
    cells = null;
    pairCells = null;
    el = null;
  }

  // The scope is the incoming Barba container when there is one. With
  // synchronous transitions the outgoing container is still in the document
  // when bd:after-nav fires, and a document-wide first match would find that
  // one, already wired, and leave the new one dead.
  function initColorPairing(scope) {
    var host = scope || document;
    var root = host.matches && host.matches(TOOL_SELECTOR) ? host : host.querySelector(TOOL_SELECTOR);
    if (el && !el.root.isConnected) release();   // ours has left the document
    if (!root) {
      if (el) release();   // a navigation away from the tool
      return;
    }
    if (root.dataset.colorPairingInit) return;   // already wired this container
    // One container at a time: whatever the module still holds belongs to
    // the one before, so it goes before anything new is read.
    if (el) release();

    if (!window.bdColor) {
      console.error('[Colour Pairing] color-core.js is not loaded; not wired');
      root.dataset.colorPairingInit = 'failed';
      return;
    }

    var found = resolveElements(root);
    if (found.missing) {
      console.error('[Colour Pairing] markup is missing ' + found.missing.join(', ') + '; not wired');
      // Marked, so the failure is readable from the DOM and is not re-logged
      // on the next arrival; released, so a fault on the incoming container
      // cannot leave the module holding the outgoing one.
      root.dataset.colorPairingInit = 'failed';
      release();
      return;
    }
    root.dataset.colorPairingInit = 'true';
    // A column per hue the brand offers (color-pairing.css)
    root.style.setProperty('--color-pairing-hues', String(window.bdColor.HUES.length));
    root.style.setProperty('--color-pairing-narrow-rows', String(window.bdColor.HUES.length + 1));

    // Fresh entry: the container arrives in its default markup, so module
    // state is reset to match.
    state = defaultState();
    customs = { fg: null, bg: null };
    palette = null;
    cells = {};
    pairCells = [];
    el = found;
    el.ownPath = window.location.pathname;
    el.ownSearch = window.location.search;
    groupSeq += 1;

    if (!window.bdColor.isCanvasTrustworthy()) {
      showEmpty();
      console.warn('[Colour Pairing] init: canvas readback blocked, nothing measured');
      return;
    }

    // palette stays null until there is something to pair, so the once-only
    // hash listener's guard holds in both empty states.
    var scan = window.bdColor.readTokens(root, gridTokens());
    if (Object.keys(scan.map).length < 2) {
      showEmpty(
        'This brand defines fewer than two of the palette tokens, so there is nothing to pair. Set the palette in the brand theme, then reload this page.',
        { before: L('Every colour it does define is on the'), href: '/tools/color-palette.html', text: L('Colour Palette'), after: '.' });
      console.warn('[Colour Pairing] init: fewer than two palette tokens resolved');
      return;
    }
    palette = scan.map;
    inks = window.bdColor.readTokens(root, ['off-white', 'off-black', 'white', 'black']).map;
    pairings = readPairings();

    // Fresh state has nothing to keep, so the hash is read over it outright.
    state = null;
    customs = null;
    if (!hashToState()) {
      state = defaultState();
      customs = { fg: null, bg: null };
    }
    ensureState();
    SIDES.forEach(buildGrid);
    buildPairings();
    setupEventListeners(root);
    if (!hashListenerBound) {
      window.addEventListener('hashchange', handleHashChange);
      hashListenerBound = true;
    }
    render();
    updateHash();
    renderSkipped(scan);
    startGlyphs();

    console.log('[Colour Pairing] init');
  }

  window.initColorPairing = initColorPairing;

  //
  //------- Initialize -------//
  //

  // On a hard load only the first of these runs: bd:after-nav is dispatched
  // from barba's afterEnter, which is not part of the once lifecycle. The
  // dataset guard is there for the other overlap — a document-wide call and a
  // container-scoped one landing on the same root, and two containers alive
  // at once under a synchronous transition. See cms/js-code-structure.md.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initColorPairing(); });
  } else {
    initColorPairing();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initColorPairing(event.detail && event.detail.container);
  });
})();
