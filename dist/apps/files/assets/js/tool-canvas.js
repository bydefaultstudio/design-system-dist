/**
 * Tool canvas — keyboard access to a scrolling panel
 * Makes a .tool-panel-body focusable while it actually overflows.
 *
 * From 960×760 the canvas is the window and each panel body scrolls on its
 * own (assets/css/tools.css, Fixed mode). A scroll container is not in the
 * tab order in every browser — Safari never focuses one — so the keyboard
 * could not reach a body whose contents hold nothing focusable (WCAG 2.1.1).
 * This gives an overflowing body tabindex="0", role="group" and the panel
 * title as its name, and takes all three away again once it fits, so a
 * panel that never scrolls adds no tab stop. group, not region: a region is
 * a landmark, and one named after the section it sits in lists the same
 * name twice in a rotor. A role of some kind is required — ARIA forbids a
 * name on a plain div, and the name is what makes the stop make sense.
 *
 * It also marks a panel .is-scrolled while content is passing under its
 * header — a body scrolled off its top in Band, a section's content under its
 * stuck header in an end dock — and the CSS draws the header's rule
 * from that (tools.css, Panels).
 *
 * In an end dock's accordion column the bodies never scroll; the column
 * does, and gets the same tab stop while it overflows. A
 * section with data-pinned is the exception: wide, it sticks to the
 * column's top and its own body scrolls (tools.css, Pinned section), so
 * its body is measured and marked as Band's are, and its height is written
 * to --tool-panels-pinned-size on the column while it sticks, for the
 * headers under it to stick below it. A bottom dock's panel bodies scroll
 * as Band's do, and a .tool-dock-toggle puts .is-collapsed on the dock its
 * aria-controls names, with aria-expanded on the toggle.
 *
 * A .tool-panel-action[data-reset] in a panel's header is carried to the tool as a
 * tool:panel-reset event on the button, its data-reset naming the section;
 * the tool resets that section and disables the button once it is back at
 * its defaults. A disabled button drops focus, so focus moves to the
 * section's heading button.
 *
 * Also exposes window.ToolPreview.syncInk, the ink for a preview band with
 * readouts in its corners (tools.css, Preview corners), shared by the tools
 * that draw one.
 *
 * Self-registered (cms/js-code-structure.md): binds on load and on
 * bd:after-nav, scoped to the incoming container. The observers check the
 * canvas is still in the document and let go when it is not, so nothing
 * needs a before-leave hook.
 *
 * @version 2.0.0
 */
(function () {
  'use strict';

  var VERSION = '2.0.0';
  var CANVAS = '.tool-canvas';
  var BODY = '.tool-panel-body';
  var TITLE = '.tool-panel-title';
  var PANEL = '.tool-panel';
  var TOGGLE = '.tool-dock-toggle';
  var PINNED_ACTIONS = '.tool-dock[data-actions="pinned"] > .tool-actions';
  var RESET = '.tool-panel-action[data-reset]';
  var PINNED = ':scope > .tool-panel[data-pinned]';
  // The columns that scroll as one: each end dock's sections. Their bodies never scroll on their own.
  var COLUMNS = ':scope > .tool-dock > .tool-panels.accordion';

  console.log('[Tool Canvas] v' + VERSION + ' loaded');

  /* ---- Measure ---- */

  function titleId(body) {
    var panel = body.closest('.tool-panel');
    var title = panel ? panel.querySelector(TITLE) : null;
    return title && title.id ? title.id : '';
  }

  // A body only scrolls in fixed mode, where the CSS gives it overflow-y.
  // Below that a popover inside it can still inflate scrollHeight, and a
  // body that cannot scroll must not become a tab stop.
  function scrolls(body) {
    return /auto|scroll/.test(window.getComputedStyle(body).overflowY);
  }

  function overflows(node) {
    return scrolls(node) && node.scrollHeight > node.clientHeight + 1;
  }

  function measureBody(body) {
    if (overflows(body)) {
      body.setAttribute('tabindex', '0');
      body.setAttribute('role', 'group');
      var id = titleId(body);
      if (id) body.setAttribute('aria-labelledby', id);
      return;
    }
    // Focus is not taken away from a body that stopped overflowing while it
    // held focus — that would drop the keyboard user on the page.
    if (document.activeElement === body) return;
    body.removeAttribute('tabindex');
    body.removeAttribute('role');
    body.removeAttribute('aria-labelledby');
  }

  // An end dock's sections column scrolls as one, so it is the scroller that
  // needs the tab stop. It carries role="group" and its aria-label in the
  // markup for good — it is the tool's controls whether or not it scrolls —
  // so only the tab stop comes and goes.
  function measureColumn(column) {
    if (overflows(column)) {
      column.setAttribute('tabindex', '0');
      return;
    }
    if (document.activeElement === column) return;
    column.removeAttribute('tabindex');
  }

  function columns(canvas) {
    return Array.prototype.slice.call(canvas.querySelectorAll(COLUMNS));
  }

  // A body inside a column is the column's to measure and mark, unless it
  // is a pinned section's, which scrolls on its own.
  function looseBodies(canvas) {
    return Array.prototype.filter.call(canvas.querySelectorAll(BODY), function isLoose(body) {
      return !body.closest('.tool-panels.accordion') || isPinnedBody(body);
    });
  }

  // A pinned section's body, while the section sticks and the body scrolls.
  function isPinnedBody(body) {
    var panel = body.closest('.tool-panel[data-pinned]');
    return !!panel && window.getComputedStyle(panel).position === 'sticky';
  }

  // The pinned section's height while it sticks (wide); none while it sits
  // in the column's flow (narrow), where the headers stick at the top.
  function pinnedSize(column) {
    var pinned = column.querySelector(PINNED);
    if (!pinned || window.getComputedStyle(pinned).position !== 'sticky') return 0;
    return pinned.offsetHeight;
  }

  function measurePinned(column) {
    var size = pinnedSize(column);
    if (size) {
      column.style.setProperty('--tool-panels-pinned-size', size + 'px');
    } else {
      column.style.removeProperty('--tool-panels-pinned-size');
    }
  }

  /* ---- Scrolled headers ---- */

  // Band: a panel is scrolled once its own body has left its top.
  // A closed section keeps its body's scrollTop, but nothing shows under
  // its header, so it draws no rule. A plain panel, not an accordion
  // section, is always open (the Asset Library's File details, the Icon
  // Library's Icons).
  function markBody(body) {
    var panel = body.closest(PANEL);
    if (!panel) return;
    var open = !panel.classList.contains('accordion-item') || panel.classList.contains('is-open');
    panel.classList.toggle('is-scrolled', open && scrolls(body) && body.scrollTop > 0);
  }

  // Sidebar: the headers stick to the column's top, so a section is scrolled
  // while its top has passed the column's and some of it still shows under
  // its header. Sub-pixel slack, or a rounding at rest would draw the rule.
  // Under a pinned section the headers stick at its foot, so that is the
  // top they are measured from. A pinned section that sticks is marked by
  // its body; one in the column's flow (narrow) is a section like any other.
  function markColumn(column) {
    var pinned = pinnedSize(column);
    var top = column.getBoundingClientRect().top + pinned;
    var sections = ':scope > ' + PANEL + (pinned ? ':not([data-pinned])' : '');
    column.querySelectorAll(sections).forEach(function mark(panel) {
      var box = panel.getBoundingClientRect();
      var header = panel.querySelector(':scope > .tool-panel-header');
      var headerHeight = header ? header.offsetHeight : 0;
      panel.classList.toggle('is-scrolled', box.top < top - 0.5 && box.bottom > top + headerHeight + 0.5);
    });
  }

  function markCanvas(canvas) {
    columns(canvas).forEach(markColumn);
    looseBodies(canvas).forEach(markBody);
  }

  // The script's own .is-scrolled flip is a class change the column's
  // observer sees; it changes no overflow, so it is not worth a measure.
  function isScrolledFlip(record) {
    if (record.type !== 'attributes' || record.attributeName !== 'class') return false;
    var before = (record.oldValue || '').split(/\s+/).filter(notScrolled).sort().join(' ');
    var after = Array.prototype.filter.call(record.target.classList, notScrolled).sort().join(' ');
    return before === after;
  }

  function notScrolled(name) {
    return name && name !== 'is-scrolled';
  }

  // A dock whose verbs stick to the window's foot (data-actions="pinned",
  // while stacked and tall enough): their height, so the dock's controls
  // scroll into view clear of them (tools.css, Docks). None while they
  // sit in the flow.
  function measureActions(canvas) {
    canvas.querySelectorAll(PINNED_ACTIONS).forEach(function measure(actions) {
      var dock = actions.parentElement;
      if (window.getComputedStyle(actions).position === 'sticky') {
        dock.style.setProperty('--tool-actions-size', actions.offsetHeight + 'px');
      } else {
        dock.style.removeProperty('--tool-actions-size');
      }
    });
  }

  function measureCanvas(canvas) {
    measureActions(canvas);
    looseBodies(canvas).forEach(measureBody);
    columns(canvas).forEach(measurePinned);
    columns(canvas).forEach(measureColumn);
    markCanvas(canvas);
  }

  /* ---- Pinned focus ---- */

  // The column's scroll padding keeps a control clear of the stuck section
  // and the header under it — which puts the stuck section itself inside
  // the padding, so focus landing in it scrolls the column back up for
  // nothing: the section never moves. Its body scrolls the control into
  // view; the column goes back where it was. Chrome scrolls before focusin
  // fires, so "where it was" is the position the column's last scroll
  // event saw (its scroll events are dispatched a frame later), kept on
  // the column, and it is put back in the same task, before any paint.
  function holdColumn(event) {
    var column = event.currentTarget;
    var pinned = column.querySelector(PINNED);
    if (!pinned || !pinned.contains(event.target) || !pinnedSize(column)) return;
    var top = column.toolCanvasScrollTop;
    if (typeof top === 'number' && column.scrollTop !== top) column.scrollTop = top;
  }

  function recordColumnScroll(event) {
    event.currentTarget.toolCanvasScrollTop = event.currentTarget.scrollTop;
  }

  /* ---- Dock toggle ---- */

  // What the toggle folds: the dock its aria-controls names, looked up
  // inside its own canvas.
  function controlledBy(canvas, toggle) {
    return (toggle.getAttribute('aria-controls') || '').split(/\s+/)
      .filter(Boolean)
      .map(function byId(id) { return canvas.querySelector('#' + CSS.escape(id)); })
      .filter(Boolean);
  }

  // The label stays put ("Controls"); aria-expanded alone carries the state,
  // so it is announced once. Focus inside what is about to hide moves to the
  // toggle first, or the keyboard user would be left on nothing — a
  // collapsed bottom dock keeps only its headers, which hold no control.
  function setPanelsShown(canvas, toggle, shown) {
    var targets = controlledBy(canvas, toggle);
    var state = 'is-collapsed';
    if (!shown && targets.some(function holdsFocus(t) { return t.contains(document.activeElement); })) {
      toggle.focus();
    }
    targets.forEach(function apply(t) { t.classList.toggle(state, !shown); });
    toggle.setAttribute('aria-expanded', shown ? 'true' : 'false');
  }

  /* ---- Section reset ---- */

  // The tool does the resetting; this only hands it the click and looks
  // after focus. The event is dispatched and handled synchronously, so by
  // the time it returns the tool has already disabled the button if the
  // section is back at its defaults.
  function resetPanel(button) {
    if (button.disabled) return;
    var panel = button.closest(PANEL);
    var hadFocus = document.activeElement === button;
    button.dispatchEvent(new CustomEvent('tool:panel-reset', {
      bubbles: true,
      detail: { section: button.getAttribute('data-reset') || '', panel: panel }
    }));
    if (!hadFocus || !button.disabled || !panel) return;
    var heading = panel.querySelector('.accordion-header');
    if (heading) heading.focus();
  }

  function handleCanvasClick(event) {
    var canvas = event.currentTarget;
    var reset = event.target.closest(RESET);
    if (reset && reset.closest(CANVAS) === canvas) {
      resetPanel(reset);
      return;
    }
    var toggle = event.target.closest(TOGGLE);
    // closest, not contains: a click bubbles through every canvas around the
    // toggle, and only its own may act on it.
    if (!toggle || toggle.closest(CANVAS) !== canvas) return;
    setPanelsShown(canvas, toggle, toggle.getAttribute('aria-expanded') === 'false');
  }

  /* ---- Bind ---- */

  function bindCanvas(canvas) {
    if (canvas.dataset.toolCanvasInit) return;
    canvas.dataset.toolCanvasInit = 'true';

    var frame = 0;
    function schedule() {
      if (!canvas.isConnected) {
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        return;
      }
      if (frame) return;
      frame = window.requestAnimationFrame(function measure() {
        frame = 0;
        measureCanvas(canvas);
      });
    }

    // Size changes come from the window; content changes come from the
    // tool adding rows, showing or hiding one, or opening a disclosure.
    // Both change whether a body overflows. A measure deferred because
    // the body held focus runs once focus leaves it, and the web font
    // arriving after the first measure reflows the text, so that is a
    // measure too.
    var resizeObserver = new ResizeObserver(schedule);
    var mutationObserver = new MutationObserver(function handleMutations(records) {
      if (!records.every(isScrolledFlip)) schedule();
    });
    canvas.querySelectorAll(BODY).forEach(function observe(body) {
      resizeObserver.observe(body);
      mutationObserver.observe(body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'open'] });
    });
    // A column: a section opening or closing is a class change on its
    // accordion item, which the bodies' observers cannot see.
    // Pinned verbs wrap to a second row or gain an error line.
    canvas.querySelectorAll(PINNED_ACTIONS).forEach(function observeActions(actions) {
      resizeObserver.observe(actions);
    });
    columns(canvas).forEach(function observeColumn(column) {
      resizeObserver.observe(column);
      var pinned = column.querySelector(PINNED);
      if (pinned) {
        resizeObserver.observe(pinned);
        column.toolCanvasScrollTop = column.scrollTop;
        column.addEventListener('scroll', recordColumnScroll, { passive: true });
        column.addEventListener('focusin', holdColumn);
      }
      mutationObserver.observe(column, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden'] });
      // The class flips before the open/close transition runs, so the
      // measure that follows it sees the old height. Its end bubbles up
      // from .accordion-content; measure again then.
      column.addEventListener('transitionend', schedule);
    });
    canvas.addEventListener('focusout', schedule);
    // Scroll does not bubble, so it is caught on the way down. Only the
    // rules are redrawn per frame; overflow is measured by the observers.
    var scrollFrame = 0;
    canvas.addEventListener('scroll', function handleScroll() {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(function markScrolled() {
        scrollFrame = 0;
        if (canvas.isConnected) markCanvas(canvas);
      });
    }, { capture: true, passive: true });
    canvas.addEventListener('click', handleCanvasClick);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

    measureCanvas(canvas);
  }

  function initToolCanvas(scope) {
    var root = scope || document;
    var canvases = root.matches && root.matches(CANVAS) ? [root] : root.querySelectorAll(CANVAS);
    canvases.forEach(bindCanvas);
  }

  window.initToolCanvas = initToolCanvas;

  /* ---- Preview ink ---- */

  // A computed rgb()/rgba() colour as #rrggbb, or null when it is not opaque —
  // a ground that is not a single opaque colour has nothing to measure against.
  function rgbToHex(value) {
    var m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value || '');
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < 1)) return null;
    return '#' + [m[1], m[2], m[3]].map(function toPair(n) {
      return ('0' + parseInt(n, 10).toString(16)).slice(-2);
    }).join('');
  }

  // The checkerboard's darker tile (tools.css, Grounds).
  var CHECKER_DARK_TILE = '#e0e0e0';

  // Relative luminance and contrast, the WCAG formulas, on #rrggbb.
  function luminance(hex) {
    var channels = [1, 3, 5].map(function toLinear(i) {
      var v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(a, b) {
    var l1 = luminance(a);
    var l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // The colour a at opacity t over b, as #rrggbb.
  function blendHex(a, b, t) {
    return '#' + [1, 3, 5].map(function toMixed(i) {
      var mixed = Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t));
      return ('0' + mixed.toString(16)).slice(-2);
    }).join('');
  }

  // Everything on the band speaks in the artwork's colour — its text and the
  // mono toggles' ink, with the ground as their paper — wherever that colour
  // reads as text on the ground actually showing (4.5:1). Otherwise the band
  // keeps the plain ink its data-preview-ink chose, which the caller sets
  // first. The ground is read from the computed style, so the CSS stays the
  // one place the grounds are written; the checkerboard measures as its white.
  // Then the captions' fade, measured the same way: the ink they end up with,
  // blended over the ground at the fade, still has to clear 4.5:1, or they
  // stay unfaded (data-caption-fade). Colour Pairing gates its captions on
  // the same test.
  function syncInk(band, hex) {
    if (!band) return;
    var colour = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : null;
    // The checkerboard's computed colour is its white tile, but text crosses
    // both, so it is measured against the darker one (tools.css, Grounds):
    // a fill can clear 4.5:1 on white and fail on the grey.
    var ground = band.getAttribute('data-ground') === 'checker'
      ? CHECKER_DARK_TILE
      : rgbToHex(window.getComputedStyle(band).backgroundColor);
    if (colour && ground && contrastRatio(colour, ground) >= 4.5) {
      band.style.setProperty('--tool-preview-ink', colour);
      band.style.setProperty('--tool-preview-paper', ground);
    } else {
      band.style.removeProperty('--tool-preview-ink');
      band.style.removeProperty('--tool-preview-paper');
    }

    var caption = band.querySelector('.tool-caption');
    var styles = caption && window.getComputedStyle(caption);
    var ink = styles && rgbToHex(styles.color);
    var fade = styles && parseFloat(styles.getPropertyValue('--tool-preview-caption-fade'));
    var fades = !!(ground && ink && fade > 0 && contrastRatio(blendHex(ink, ground, fade), ground) >= 4.5);
    band.toggleAttribute('data-caption-fade', fades);
  }

  window.ToolPreview = { syncInk: syncInk };

  /* ---- Initialize ---- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function onReady() {
      initToolCanvas();
    });
  } else {
    initToolCanvas();
  }

  document.addEventListener('bd:after-nav', function onAfterNav(event) {
    initToolCanvas(event.detail && event.detail.container);
  });
})();
