/* @bydefaultstudio/design-system v6.0.0 */
/**
 * Swatch component
 * Reads each swatch's live fill and writes what depends on it: the hex in
 * .swatch-value, the value the Hex action copies, the token the CSS action
 * copies, the colour's name in each action's accessible name, and — unless
 * the markup chose one — the ink that reads on it.
 *
 * A swatch works without this file: it paints its fill, and a CSS action
 * that ships its own data-copy still copies. What the script adds is the
 * part that changes with the theme. A semantic token is one colour in light
 * and another in dark, so the hex is read from the page, never written into
 * the markup, and read again whenever the theme can have changed.
 *
 * Bind a swatch after it is in the document: a detached element has no
 * computed colour. A swatch whose value another script measures (the Colour
 * Palette tool) carries data-swatch-managed="false" and is never read.
 *
 * Copying itself is copy-button.js: every action is a .copy-btn.
 *
 * @version 1.2.0
 */
(function () {
  'use strict';

  var VERSION = '1.2.0';
  var SELECTOR = '.swatch';

  // WCAG 2.1 1.4.3 for the name, value and actions, which are all small text.
  var AA = 4.5;

  //
  //------- PARSE — the computed colour, no canvas -------//
  //

  // getComputedStyle serialises a resolved colour as rgb()/rgba(), or as
  // color(srgb r g b / a) for a colour that came out of color-mix(). A
  // custom property comes back as written, so a hex is read too. Anything
  // else (a theme in oklch or display-p3) returns null, and the swatch shows
  // no hex rather than a wrong one.
  var NUM = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)';
  var ALPHA = '(?:\\s*[,/]\\s*' + NUM + '(%?))?';
  var RGB = new RegExp('^rgba?\\(\\s*' + NUM + '[\\s,]+' + NUM + '[\\s,]+' + NUM + ALPHA + '\\s*\\)$');
  var SRGB = new RegExp('^color\\(\\s*srgb\\s+' + NUM + '\\s+' + NUM + '\\s+' + NUM + ALPHA + '\\s*\\)$');
  var HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

  function parseColor(value) {
    if (!value) return null;
    var text = String(value).trim().toLowerCase();
    if (text === 'transparent') return [0, 0, 0, 0];

    var c = null;
    var m;
    if ((m = HEX.exec(text))) c = fromHex(m[1]);
    else if ((m = RGB.exec(text))) c = [Number(m[1]), Number(m[2]), Number(m[3]), alphaOf(m[4], m[5])];
    else if ((m = SRGB.exec(text))) c = [channel(m[1]), channel(m[2]), channel(m[3]), alphaOf(m[4], m[5])];

    return c && c.every(isFinite) ? c : null;
  }

  function fromHex(h) {
    if (h.length <= 4) h = h.split('').map(function (d) { return d + d; }).join('');
    var a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
  }

  // color(srgb) channels run 0 to 1; out-of-gamut values are clamped.
  function channel(v) {
    return Math.round(Math.min(1, Math.max(0, Number(v))) * 255);
  }

  function alphaOf(v, percent) {
    if (v === undefined) return 1;
    var n = percent ? Number(v) / 100 : Number(v);
    return Math.min(1, Math.max(0, n));
  }

  function pad(n) {
    var h = Math.round(n).toString(16).toUpperCase();
    return h.length === 1 ? '0' + h : h;
  }

  // #RRGGBB for an opaque colour, #RRGGBBAA when it carries alpha, null
  // when it is fully transparent: there is no colour to name.
  function toHex(c) {
    if (!c || c[3] === 0) return null;
    var hex = '#' + pad(c[0]) + pad(c[1]) + pad(c[2]);
    return c[3] < 1 ? hex + pad(c[3] * 255) : hex;
  }

  //
  //------- INK — whichever side of the pair contrasts more -------//
  //

  // WCAG 2 relative luminance.
  function luminance(c) {
    var lin = [c[0], c[1], c[2]].map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  var WHITE = [255, 255, 255, 1];
  var BLACK = [0, 0, 0, 1];

  // The pair is read from the swatch — the same tokens the CSS paints — so a
  // brand that re-points them is measured, not assumed. Pure white or black
  // always clears 4.5:1 on one side or the other (the worst fill gives
  // 4.58), so when the brand's pair cannot, the swatch takes the pure one
  // and says so in the console. Returns { side, floor } where floor is the
  // pure colour to paint, or null when the pair itself is enough.
  function chooseInk(styles, fill) {
    var light = parseColor(styles.getPropertyValue('--swatch-ink-light')) || WHITE;
    var dark = parseColor(styles.getPropertyValue('--swatch-ink-dark')) || BLACK;
    var onLight = contrast(fill, light);
    var onDark = contrast(fill, dark);
    var side = onLight >= onDark ? 'light' : 'dark';
    if (Math.max(onLight, onDark) >= AA) return { side: side, floor: null };
    var pure = contrast(fill, WHITE) >= contrast(fill, BLACK) ? 'light' : 'dark';
    return { side: pure, floor: pure === 'light' ? '#FFFFFF' : '#000000' };
  }

  // A translucent fill is seen over whatever is behind it, so the ink is
  // chosen for the colour that shows: the fill blended over the nearest
  // ancestor with a solid background, or white when none has one. That
  // makes a token like --text-faded, translucent in both themes, read in
  // both.
  function backingOf(el) {
    for (var node = el.parentElement; node; node = node.parentElement) {
      var bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] === 1) return bg;
    }
    return WHITE;
  }

  function composite(fill, backing) {
    var a = fill[3];
    return [0, 1, 2].map(function (i) {
      return fill[i] * a + backing[i] * (1 - a);
    }).concat(1);
  }

  //
  //------- PARTS — the swatch's own, never a nested swatch's -------//
  //

  function part(el, selector) {
    return el.querySelector(':scope > ' + selector);
  }

  function valueOf(el) { return part(el, '.swatch-text > .swatch-value'); }
  function nameOf(el) { return part(el, '.swatch-text > .swatch-name'); }
  function hexButton(el) { return part(el, '.swatch-actions > .swatch-copy[data-format="hex"]'); }
  function cssButton(el) { return part(el, '.swatch-actions > .swatch-copy[data-format="css"]'); }

  function setAttr(el, name, value) {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  }

  //
  //------- READ, then WRITE -------//
  //

  // Every computed value is read before anything is written: a write to
  // data-ink invalidates style, and interleaving the two would recalculate
  // the page once per swatch.
  function measure(el) {
    var styles = getComputedStyle(el);
    var fill = parseColor(styles.backgroundColor);
    var ink = null;
    if (el.dataset.swatchInk === 'auto' && fill && fill[3] > 0) {
      var seen = fill[3] === 1 ? fill : composite(fill, backingOf(el));
      ink = chooseInk(styles, seen);
    }
    return { el: el, hex: toHex(fill), fill: fill, ink: ink };
  }

  function apply(reading) {
    var el = reading.el;
    var hex = reading.hex;

    var value = valueOf(el);
    if (value && value.textContent !== (hex || '')) value.textContent = hex || '';

    var hexBtn = hexButton(el);
    if (hexBtn) {
      setAttr(hexBtn, 'data-copy', hex);
      if (hexBtn.hidden !== !hex) hexBtn.hidden = !hex;
    }

    // A fully transparent or unreadable fill has no colour to read against,
    // so it keeps the page's text.
    if (el.dataset.swatchInk !== 'auto') return;
    var ink = reading.ink;
    setAttr(el, 'data-ink', ink ? ink.side : null);
    if (ink && ink.floor) {
      if (el.style.getPropertyValue('--swatch-ink') !== ink.floor) {
        el.style.setProperty('--swatch-ink', ink.floor);
        console.warn('[swatch] the ink pair cannot reach ' + AA + ':1 on ' + hex + '; using ' + ink.floor);
      }
    } else if (el.style.getPropertyValue('--swatch-ink')) {
      el.style.removeProperty('--swatch-ink');
    }
  }

  function refresh(list) {
    list.map(measure).forEach(apply);
  }

  //
  //------- BIND -------//
  //

  // "Hex" alone, forty times over, is a list of identical buttons to a
  // screen reader. The action is named in full — "Copy Hex of Blue" — with
  // the verb and the colour hidden around the visible word, so the spoken
  // name still contains what is on screen (2.5.3). A button that already
  // carries hidden context is the author's and left alone.
  function hiddenText(text) {
    var span = document.createElement('span');
    span.className = 'visually-hidden';
    span.textContent = text;
    return span;
  }

  function nameAction(btn, colour) {
    if (!btn || !colour || btn.querySelector('.visually-hidden')) return;
    var label = btn.querySelector('.copy-btn-default > span') || btn.querySelector('.copy-btn-default') || btn;
    label.insertBefore(hiddenText('Copy '), label.firstChild);
    label.appendChild(hiddenText(' of ' + colour));
  }

  function tokenRef(token) {
    var t = String(token).trim();
    return 'var(' + (t.indexOf('--') === 0 ? t : '--' + t) + ')';
  }

  // Decided once, at bind: whether the script owns this swatch's value and
  // its ink. Deciding again on a theme change would read the script's own
  // earlier writes as the author's.
  function bindSwatch(el) {
    if (el.dataset.swatchBound) return false;
    el.dataset.swatchBound = 'true';

    var token = el.getAttribute('data-token');
    var css = cssButton(el);
    if (token && css && !css.hasAttribute('data-copy')) css.setAttribute('data-copy', tokenRef(token));

    var name = nameOf(el);
    var colour = name && name.textContent.trim();
    nameAction(hexButton(el), colour);
    nameAction(css, colour);

    if (!el.hasAttribute('data-swatch-managed')) {
      var value = valueOf(el);
      el.dataset.swatchManaged = value && value.textContent.trim() ? 'false' : 'true';
    }

    // An ink set anywhere — inline, a class, an ancestor — is the author's.
    // .swatch itself never declares --swatch-ink, so any value is theirs.
    var authoredInk = getComputedStyle(el).getPropertyValue('--swatch-ink').trim();
    if (!el.hasAttribute('data-ink') && !authoredInk) el.dataset.swatchInk = 'auto';
    return true;
  }

  function isManaged(el) {
    return el.dataset.swatchManaged === 'true';
  }

  // Accepts a scope to search or the .swatch itself. A swatch built later
  // by a script is bound when that script calls initSwatch on it.
  function initSwatch(scopeOrEl) {
    var root = scopeOrEl || document;
    var swatches = Array.prototype.slice.call(root.querySelectorAll(SELECTOR));
    if (root.matches && root.matches(SELECTOR)) swatches.unshift(root);

    var fresh = swatches.filter(bindSwatch);
    refresh(fresh.filter(isManaged));
    if (fresh.length) console.log('[swatch] v' + VERSION + ' — init (' + fresh.length + ')');
    return fresh.length;
  }

  // Every managed swatch on the page, read again. The query is the
  // document's, so a swatch that left with its container is not touched.
  function refreshAll() {
    var managed = document.querySelectorAll(SELECTOR + '[data-swatch-managed="true"]');
    refresh(Array.prototype.slice.call(managed));
  }

  //
  //------- THEME — read again when the colours can have changed -------//
  //

  // The theme toggle writes data-theme on <html> and fires no event. A
  // brand theme writes data-brand-theme the moment it adds its stylesheet,
  // before the sheet has loaded, so a stylesheet finishing loading is a
  // change too (load does not bubble, hence the capture). One observer and
  // two listeners for the document's life; each refresh queries the page.
  function handleSheetLoad(event) {
    var target = event.target;
    if (target && target.tagName === 'LINK' && /stylesheet/i.test(target.rel)) refreshAll();
  }

  function watchTheme() {
    if (typeof MutationObserver === 'function') {
      new MutationObserver(refreshAll).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-brand-theme']
      });
    }
    document.addEventListener('load', handleSheetLoad, true);
    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-color-scheme: dark)');
      if (query.addEventListener) query.addEventListener('change', refreshAll);
      else if (query.addListener) query.addListener(refreshAll);
    }
  }

  window.initSwatch = initSwatch;
  window.bdSwatch = { parseColor: parseColor, toHex: toHex, refresh: refreshAll };

  //
  //------- Initialize -------//
  //

  watchTheme();

  function handleReady() {
    initSwatch();
  }

  // Scoped to the incoming container, so the outgoing one is never matched.
  function handleAfterNav(event) {
    initSwatch(event.detail && event.detail.container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleReady);
  } else {
    handleReady();
  }

  document.addEventListener('bd:after-nav', handleAfterNav);
})();
