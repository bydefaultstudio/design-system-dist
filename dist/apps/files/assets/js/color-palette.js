/**
 * color-palette.js — Colour Palette Tool Page Controller
 * Reads the palette from the live theme through color-core.js and lays it
 * out as tiles: the nine hues at four steps, the two off tones, the neutral
 * ramp. Each tile names its colour, shows its hex, and copies the hex or the
 * token. A segmented control in the bar narrows the page to the brand's
 * primary colours, its tints and shades, or the neutral ramp, and the view rides
 * in the address hash. Loaded globally; self-registers on DOMContentLoaded and
 * bd:after-nav, scoped to the incoming container, and exposes
 * window.initColorPalette for a console or a host with a container of its own.
 * @version 1.4.0
 */

(function () {
  'use strict';

  var VERSION = '1.3.0';
  console.log('[Colour Palette] v' + VERSION + ' loaded');

  var TOOL_SELECTOR = '[data-tool="color-palette"]';

  // Per container; dropped when the container leaves.
  var el = null;

  //
  //------- VIEWS -------//
  //

  // Every view reads the engine's own lists in color-core.js, so a brand's
  // colours show in each without the tool knowing them. Primary is every
  // hue at its base step, then the off tones light first; Tints & Shades
  // every hue step; Neutrals every neutral step. A token the brand does not
  // define is left out.
  var PRIMARY_TONES = ['off-white', 'off-black'];
  var VIEWS = ['all', 'primary', 'tints', 'neutrals'];
  var DEFAULT_VIEW = 'all';
  var VIEW_KEY = 'view';

  // Per page, deliberately not reset: the hashchange listener is bound once
  // for the document's life and acts only while a palette is on screen.
  var hashListenerBound = false;

  //
  //------- INK — the tile's text colour, chosen by measuring -------//
  //

  // A hue's tiles take their text from the far end of their own ramp — the
  // lightest step on the dark tiles, the darkest on the light ones — so the
  // palette reads as colour on colour, the way the brand sets it. That holds
  // only while the ramp's own end clears AA against the tile; below that, and
  // for the off tones and the neutrals, the text is off-black or off-white.
  var OFF_TONES = ['off-white', 'off-black'];

  function hueOf(name) {
    return window.bdColor.HUES.filter(function (h) {
      return name === h || name.indexOf(h + '-') === 0;
    })[0] || null;
  }

  function inkCandidates(name) {
    var hue = hueOf(name);
    return hue ? [hue + '-lighter', hue + '-dark'].concat(OFF_TONES) : OFF_TONES;
  }

  // The candidate in the list that measures highest against the tile.
  function bestOf(candidates, tile, colours) {
    var best = null;
    var bestRatio = -1;
    candidates.forEach(function (candidate) {
      var ink = colours[candidate];
      if (!ink) return;
      var ratio = window.bdColor.contrastRatio(tile, ink);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = candidate;
      }
    });
    return best ? { name: best, ratio: bestRatio } : null;
  }

  function chooseInk(name, colours) {
    var tile = colours[name];
    if (!tile) return null;
    var hue = hueOf(name);
    if (hue) {
      var own = bestOf([hue + '-lighter', hue + '-dark'].filter(function (n) { return n !== name; }), tile, colours);
      if (own && window.bdColor.clears(own.ratio, window.bdColor.AA)) return own.name;
    }
    var fallback = bestOf(OFF_TONES.filter(function (n) { return n !== name; }), tile, colours);
    return fallback ? fallback.name : null;
  }

  // Without canvas readback nothing can be measured, so the ink follows the
  // step instead: dark tiles take the light end of their ramp, light and
  // lighter tiles the dark end. A base step could be either — yellow is light,
  // blue is dark — so it, like the off tones and neutrals, takes off-white
  // or off-black by where it sits on the ramp.
  function guessInk(name, defined) {
    var hue = hueOf(name);
    var candidates;
    if (hue && /-dark$/.test(name)) candidates = [hue + '-lighter', 'off-white'];
    else if (hue && /-light(er)?$/.test(name)) candidates = [hue + '-dark', 'off-black'];
    else {
      var darkTile = name === 'off-black' || /^neutral-([5-9]\d\d)$/.test(name);
      candidates = hue ? ['off-white', 'off-black'] : [darkTile ? 'off-white' : 'off-black'];
    }
    return candidates.filter(function (candidate) {
      return defined[candidate] && candidate !== name;
    })[0] || null;
  }

  //
  //------- DOM -------//
  //

  function resolveElements(root) {
    var ids = {
      emptyWrap: 'palette-empty-wrap', hues: 'palette-hues', extras: 'palette-extras',
      neutrals: 'palette-neutrals', skipped: 'palette-skipped',
      skippedWrap: 'palette-skipped-wrap', template: 'palette-tile-template',
      primary: 'palette-primary', primaryTones: 'palette-primary-tones',
      tints: 'palette-tints', ramp: 'palette-ramp',
      viewControl: 'palette-view'
    };
    var found = { root: root };
    var missing = [];
    Object.keys(ids).forEach(function (key) {
      found[key] = root.querySelector('#' + ids[key]);
      if (!found[key]) missing.push('#' + ids[key]);
    });
    return missing.length ? { missing: missing } : found;
  }

  // In the ramp, "neutral-50" shows as "50": the ramp is labelled by its
  // step, the way the scale is spoken. "Neutral" is still said, hidden, so a
  // tile heard on its own is not a bare number. Outside the ramp a neutral
  // has no neighbours to read the step against, so it keeps its full name.
  var NEUTRAL_STEP = /^neutral-(\d+)$/;

  // A swatch (cms/swatch.md) the tool fills itself: the fill and the ink
  // inline, the hex it measured, and the variant its list asks for.
  function buildTile(name, hex, ink, list) {
    var fragment = el.template.content.cloneNode(true);
    var tile = fragment.querySelector('.swatch');
    // A named brand colour keeps its Figma name (brand.json colours.named)
    var named = list.labels ? list.labels.filter(function (c) { return c.token === name; })[0] : null;
    var label = named ? named.label : window.bdColor.tokenLabel(name);
    var step = list.steps ? NEUTRAL_STEP.exec(name) : null;
    if (list.variant) tile.setAttribute('data-variant', list.variant);
    tile.setAttribute('data-token', '--' + name);
    tile.style.setProperty('--swatch-fill', 'var(--' + name + ')');
    if (ink) tile.style.setProperty('--swatch-ink', 'var(--' + ink + ')');
    tile.querySelector('[data-palette-part="kind"]').textContent = step ? 'Neutral ' : '';
    tile.querySelector('[data-palette-part="label"]').textContent = step ? step[1] : label;

    var hexNode = tile.querySelector('.swatch-value');
    var hexButton = tile.querySelector('.swatch-copy[data-format="hex"]');
    var cssButton = tile.querySelector('.swatch-copy[data-format="css"]');
    if (hex) {
      hexNode.textContent = hex;
      hexButton.setAttribute('data-copy', hex);
      hexButton.hidden = false;
      hexButton.querySelector('[data-palette-part="copy-context"]').textContent = ' of ' + label + ', ' + hex;
    } else {
      hexNode.remove();
      hexButton.remove();
    }
    cssButton.setAttribute('data-copy', 'var(--' + name + ')');
    cssButton.querySelector('[data-palette-part="copy-context"]').textContent = ' variable of ' + label;
    return fragment;
  }

  // Each tile carries its place, so a step a brand leaves out leaves a gap
  // in its column instead of shifting every later hue up a row. --col and
  // --row are the tile's hue and step in the hue grid, its index elsewhere.
  function tilePlace(name, index) {
    var hue = hueOf(name);
    if (!hue) return { col: index + 1, row: 1 };
    var step = window.bdColor.STEPS.indexOf(name.slice(hue.length));
    return { col: window.bdColor.HUES.indexOf(hue) + 1, row: step + 1 };
  }

  function fillList(list, colours, defined, measured) {
    var node = el[list.key];
    node.textContent = '';
    list.names.forEach(function (name, index) {
      if (!defined[name]) return;
      var ink = measured ? chooseInk(name, colours) : guessInk(name, defined);
      var hex = measured && colours[name] ? colours[name].hex : null;
      var fragment = buildTile(name, hex, ink, list);
      var tile = fragment.querySelector('.swatch');
      var place = list.indexed ? { col: index + 1, row: 1 } : tilePlace(name, index);
      tile.style.setProperty('--col', String(place.col));
      tile.style.setProperty('--row', String(place.row));
      node.appendChild(fragment);
    });
    // The swatches actually shown, so a brand with fewer steps still fills
    // the window; never 0, which would divide by it.
    node.style.setProperty('--palette-count', String(node.children.length || 1));
    // A set can hold more than one list (Primary has two), so it hides only
    // when none of them has a swatch.
    var set = node.closest('.palette-set');
    set.classList.toggle('is-hidden', !set.querySelector('.swatch'));
  }

  // Every list on the page, one row each: the element it fills, the tokens
  // it shows, the swatch variant it uses, and whether neutrals are labelled
  // by step. The grid each sits in is in the markup (data-layout), and its
  // height in color-palette.css (data-palette-set). A view is the lists its section
  // holds.
  function paletteLists(bdColor) {
    var hues = bdColor.hueTokens();
    // The brand's named colours, when brand.json sets them (colours.named),
    // replace every hue at its base step: a hue's base step can be a text
    // ink rather than the brand colour (BlackDoctor's green, blue and red).
    var brand = brandPrimary();
    if (brand) {
      return [
        { key: 'hues', names: hues, variant: null, steps: false },
        { key: 'extras', names: bdColor.EXTRAS, variant: null, steps: false },
        { key: 'neutrals', names: bdColor.NEUTRALS, variant: null, steps: true },
        { key: 'primary', names: tokensOf(brand.primary), labels: brand.primary, variant: 'column', steps: false, indexed: true },
        { key: 'primaryTones', names: tokensOf(brand.secondary), labels: brand.secondary, variant: 'column', steps: false, indexed: true, layout: 'row' },
        { key: 'tints', names: hues, variant: null, steps: false },
        { key: 'ramp', names: bdColor.NEUTRALS, variant: 'strip', steps: true }
      ];
    }
    return [
      { key: 'hues', names: hues, variant: null, steps: false },
      { key: 'extras', names: bdColor.EXTRAS, variant: null, steps: false },
      { key: 'neutrals', names: bdColor.NEUTRALS, variant: null, steps: true },
      { key: 'primary', names: bdColor.HUES, variant: 'column', steps: false },
      { key: 'primaryTones', names: PRIMARY_TONES, variant: 'band', steps: false },
      { key: 'tints', names: hues, variant: null, steps: false },
      { key: 'ramp', names: bdColor.NEUTRALS, variant: 'strip', steps: true }
    ];
  }

  // THEME_CONFIG.palettePrimary, generated from brand.json's colours.named
  function brandPrimary() {
    var config = typeof THEME_CONFIG !== 'undefined' && THEME_CONFIG ? THEME_CONFIG.palettePrimary : null;
    return config && Array.isArray(config.primary) && config.primary.length && Array.isArray(config.secondary) ? config : null;
  }

  function tokensOf(colours) {
    return colours.map(function (c) { return c.token; });
  }

  function countSentence(n, noun) {
    return n + ' ' + noun + (n === 1 ? '' : 's');
  }

  function renderSkipped(undefinedCount, unmeasuredCount) {
    var parts = [];
    if (undefinedCount) {
      parts.push('The palette leaves out ' + countSentence(undefinedCount, 'token') + ' this brand does not set.');
    }
    if (unmeasuredCount) {
      parts.push(countSentence(unmeasuredCount, 'token') + (unmeasuredCount === 1 ? ' carries' : ' carry')
        + ' transparency, or a value the tool cannot read, so ' + (unmeasuredCount === 1 ? 'its' : 'their') + ' hex is not shown.');
    }
    el.skipped.textContent = parts.join(' ');
    el.skippedWrap.classList.toggle('is-hidden', !parts.length);
  }

  //
  //------- VIEW — the segmented control and the address hash -------//
  //

  // A hash without the view key is not the tool's (the skip link writes
  // #main), and an unknown value falls back to All.
  function viewFromHash() {
    var value = new URLSearchParams(window.location.hash.slice(1)).get(VIEW_KEY);
    return VIEWS.indexOf(value) === -1 ? DEFAULT_VIEW : availableView(value);
  }

  // Selection is the checked radio; the root carries the view for the CSS.
  function applyView(view) {
    el.root.setAttribute('data-palette-view', view);
    Array.prototype.forEach.call(el.viewControl.querySelectorAll('input[type="radio"]'), function (radio) {
      radio.checked = radio.value === view;
    });
  }

  // Replaced, not pushed: a view is a setting, not a page, so Back still
  // leaves the tool. All is the default and writes no hash at all.
  // history.state is carried through, because Barba keeps its payload there.
  function writeViewHash(view) {
    var next = view === DEFAULT_VIEW
      ? window.location.pathname + window.location.search
      : '#' + VIEW_KEY + '=' + view;
    try {
      history.replaceState(history.state, '', next);
    } catch (error) {
      console.warn('[Colour Palette] the browser refused a history write; the URL is stale', error);
    }
  }

  // A hand-edited hash or an in-page link to #view=… switches the view
  // without a reload. A hash without the key (the skip link's #main) is not
  // the tool's and leaves the view alone.
  function handleHashChange() {
    if (!el || !el.root.isConnected) return;
    if (!new URLSearchParams(window.location.hash.slice(1)).has(VIEW_KEY)) return;
    applyView(viewFromHash());
  }

  // A view whose colours this brand does not define would open on a blank
  // canvas, so its segment is not offered, and a link to it lands on All.
  // The list each narrowed view shows.
  function viewList(view) {
    return { primary: el.primary, tints: el.tints, neutrals: el.ramp }[view] || null;
  }

  function hideEmptyViews() {
    VIEWS.forEach(function (view) {
      var list = viewList(view);
      if (!list) return;
      var empty = !list.children.length;
      var radio = el.viewControl.querySelector('input[value="' + view + '"]');
      if (radio) radio.closest('label').classList.toggle('is-hidden', empty);
    });
  }

  function availableView(view) {
    var list = viewList(view);
    return list && !list.children.length ? DEFAULT_VIEW : view;
  }

  // Delegated from the tool's root, so the control still answers after
  // bar.js moves it into the overflow menu.
  function handleViewChange(event) {
    if (!el) return;
    var radio = event.target;
    if (!radio.matches || !radio.matches('#palette-view input[type="radio"]') || !el.root.contains(radio)) return;
    var view = radio.value;
    if (VIEWS.indexOf(view) === -1) return;
    applyView(view);
    writeViewHash(view);
  }

  //
  //------- INIT — on load and after every Barba navigation -------//
  //

  function release() {
    el = null;
  }

  function initColorPalette(scope) {
    var host = scope || document;
    var root = host.matches && host.matches(TOOL_SELECTOR) ? host : host.querySelector(TOOL_SELECTOR);
    if (el && !el.root.isConnected) release();
    if (!root) {
      if (el) release();
      return;
    }
    if (root.dataset.colorPaletteInit) return;   // already wired this container
    // One container at a time, as in Colour Pairing: drop the one before
    // before anything can fail on this one.
    if (el) release();

    if (!window.bdColor) {
      console.error('[Colour Palette] color-core.js is not loaded; not wired');
      root.dataset.colorPaletteInit = 'failed';
      return;
    }

    var found = resolveElements(root);
    if (found.missing) {
      console.error('[Colour Palette] markup is missing ' + found.missing.join(', ') + '; not wired');
      root.dataset.colorPaletteInit = 'failed';
      return;
    }
    root.dataset.colorPaletteInit = 'true';
    el = found;

    var bdColor = window.bdColor;
    var lists = paletteLists(bdColor);
    // Every token the page shows, once: the lists overlap.
    var all = bdColor.hueTokens().concat(bdColor.EXTRAS, bdColor.NEUTRALS);
    // A named colour can sit outside those, such as a neutral used as paper
    lists.forEach(function (list) {
      list.names.forEach(function (name) { if (all.indexOf(name) === -1) all.push(name); });
      if (list.layout) el[list.key].setAttribute('data-layout', list.layout);
    });
    // The hue grid has a column per hue the brand offers (color-palette.css)
    root.style.setProperty('--palette-hues', String(bdColor.HUES.length));

    // Defined is decided by the computed style alone, so a tile still paints
    // (and still copies its token) when its value cannot be measured.
    var styles = getComputedStyle(root);
    var defined = {};
    all.forEach(function (name) {
      if (styles.getPropertyValue('--' + name).trim()) defined[name] = true;
    });

    var measured = bdColor.isCanvasTrustworthy();
    var scan = measured ? bdColor.readTokens(root, all) : { map: {}, undefined: [], unmeasured: [] };
    el.emptyWrap.classList.toggle('is-hidden', measured);

    lists.forEach(function (list) {
      fillList(list, scan.map, defined, measured);
    });

    hideEmptyViews();
    applyView(viewFromHash());
    root.addEventListener('change', handleViewChange);
    if (!hashListenerBound) {
      window.addEventListener('hashchange', handleHashChange);
      hashListenerBound = true;
    }

    var undefinedCount = all.filter(function (name) { return !defined[name]; }).length;
    renderSkipped(undefinedCount, measured ? scan.unmeasured.length : 0);

    console.log('[Colour Palette] init');
  }

  window.initColorPalette = initColorPalette;

  //
  //------- Initialize -------//
  //

  // The dataset guard covers a document-wide call and a container-scoped one
  // landing on the same root, and two containers alive at once under a
  // synchronous transition. See cms/js-code-structure.md.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initColorPalette(); });
  } else {
    initColorPalette();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initColorPalette(event.detail && event.detail.container);
  });
})();
