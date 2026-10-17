/**
 * Breadcrumb overflow
 * A breadcrumb (design-system.css §18) stays on one line. When its labels no
 * longer fit, the crumbs between the first and the last move into a ⋯ menu at
 * position two, nearest the root first; only once every middle crumb is in
 * the menu does the current page truncate. The first crumb never moves.
 *
 * Opt-in by markup: only a breadcrumb that carries a
 * `li.breadcrumb-overflow` (hidden, holding a .dropdown with an empty menu)
 * is managed. The item is authored, not built here, so the icon comes from
 * the brand set and a trail renders correctly before this script runs.
 *
 * Fit is measured on the labels, not the list: the component lets every
 * label but the first shrink with an ellipsis, so the list itself never
 * overflows. A trail fits when no label is clipped.
 *
 * Open/close, focus return and dismissal belong to dropdown.js, which
 * delegates on document; nothing here binds the trigger. The menu is a
 * disclosure of links (cms/dropdown.md → Links between sibling pages), so
 * its items are plain links in trail order.
 *
 * @version 1.0.0
 */
(function () {
  var VERSION = '1.0.0';

  //------- Measure -------//

  // A label is every child of an item except the separator; the overflow
  // item has none, and the first crumb never shrinks, so it cannot clip.
  // Clipped means its text runs past its box by more than a pixel: both
  // widths are rounded integers, and an ellipsis box of fractional width can
  // report one pixel over with nothing hidden.
  function isClipped(nav) {
    return Array.from(nav.querySelectorAll('.breadcrumb-item:not(:first-child, .breadcrumb-overflow, [hidden]) > :not(.breadcrumb-separator)'))
      .some(function (label) { return label.scrollWidth - label.clientWidth > 1; });
  }

  // The crumbs that may collapse: everything between the first and the last,
  // except the overflow item itself, in trail order.
  function middleItems(nav) {
    var items = Array.from(nav.querySelectorAll('.breadcrumb-item:not(.breadcrumb-overflow)'));
    return items.slice(1, -1);
  }

  // One menu entry per hidden crumb: a link where the crumb links, plain text
  // where it does not (a level with nowhere to land).
  function menuEntry(item) {
    var label = item.querySelector(':scope > :not(.breadcrumb-separator)');
    var text = label ? label.textContent : '';
    var entry;
    if (label && label.tagName === 'A') {
      entry = document.createElement('a');
      entry.href = label.getAttribute('href');
    } else {
      entry = document.createElement('span');
    }
    entry.className = 'dropdown-item';
    entry.textContent = text;
    return entry;
  }

  /**
   * Restores every crumb, then moves middle crumbs into the menu, nearest the
   * root first, until no label is clipped or none is left to move.
   */
  function measure(nav) {
    if (!nav.isConnected) return;
    var overflow = nav.querySelector('.breadcrumb-overflow');
    var menu = overflow && overflow.querySelector('.dropdown-menu');
    if (!menu) return;

    // A crumb that holds focus can be the one this pass hides (a keyboard
    // user zooming in), and the trigger can be hidden in turn when the trail
    // fits again. Note it now; put focus somewhere visible afterwards.
    var focused = nav.contains(document.activeElement) ? document.activeElement : null;

    // A resize can land while the menu is open. Its entries are rebuilt
    // below, so an open menu would hold stale links and focus would fall to
    // body — close it first, returning focus to the trigger if it was inside.
    var dropdown = overflow.querySelector('.dropdown');
    if (dropdown && dropdown.classList.contains('is-open') && typeof window.closeDropdown === 'function') {
      window.closeDropdown(dropdown, dropdown.contains(document.activeElement));
    }

    var middle = middleItems(nav);
    middle.forEach(function (item) { item.hidden = false; });
    overflow.hidden = true;
    menu.textContent = '';

    var hidden = [];
    for (var i = 0; i < middle.length && isClipped(nav); i++) {
      if (i === 0) overflow.hidden = false;
      middle[i].hidden = true;
      hidden.push(middle[i]);
    }
    hidden.forEach(function (item) { menu.appendChild(menuEntry(item)); });

    // closeDropdown above may have moved focus to the trigger, so read the
    // live element, not the one noted on entry.
    var current = nav.contains(document.activeElement) ? document.activeElement : focused;
    if (current && !current.getClientRects().length) {
      var target = !overflow.hidden
        ? overflow.querySelector('.dropdown-trigger')
        : middle.length && middle[0].querySelector('a');
      if (target) target.focus();
    }
  }

  //------- Bind -------//

  function setupBreadcrumb(nav) {
    if (nav.dataset.breadcrumbBound) return;
    nav.dataset.breadcrumbBound = 'true';

    // Watch the box that bounds the trail as well as the trail. The nav can
    // be sized by its content, so a collapsed trail would never see the room
    // its container gives back; and the container can keep its width while
    // a neighbour (a bar group moving into the bar's overflow) changes the
    // nav's share of it. Width-gated per box, because hiding crumbs changes
    // nothing that should trigger another pass, and measure() gives the same
    // answer for the same widths. Self-cleaning: when Barba removes the
    // container, the next callback sees a disconnected nav and lets go.
    var lastWidths = new Map();
    var observer = new ResizeObserver(function (entries) {
      if (!nav.isConnected) { observer.disconnect(); return; }
      var changed = false;
      entries.forEach(function (entry) {
        var width = entry.contentRect.width;
        if (lastWidths.get(entry.target) !== width) {
          lastWidths.set(entry.target, width);
          changed = true;
        }
      });
      if (changed) window.requestAnimationFrame(function () { measure(nav); });
    });
    if (nav.parentElement) observer.observe(nav.parentElement);
    observer.observe(nav);

    // A web font arriving after the first pass changes every label's width.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { measure(nav); });
    }

    measure(nav);
  }

  function initBreadcrumb(scopeOrEl) {
    var root = scopeOrEl || document;
    // Accepts a scope to search, or the .breadcrumb itself — see tabs.js.
    var navs = Array.from(root.querySelectorAll('.breadcrumb'));
    if (root.matches && root.matches('.breadcrumb')) navs.unshift(root);
    var managed = 0;

    navs.forEach(function (nav) {
      // Count real binds only: on a hard load this runs twice (DOMContentLoaded,
      // then Barba's once() afterEnter), and the second pass binds nothing.
      if (nav.querySelector('.breadcrumb-overflow') && !nav.dataset.breadcrumbBound) {
        setupBreadcrumb(nav);
        managed++;
      }
    });

    if (managed) console.log('[breadcrumb] v' + VERSION + ' — init (' + managed + ')');
  }

  //------- Initialize -------//

  window.initBreadcrumb = initBreadcrumb;

  // Both fire on a hard load (DOMContentLoaded, then Barba's once() hook
  // dispatches bd:after-nav); the dataset guard makes the second a no-op.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initBreadcrumb(); });
  } else {
    initBreadcrumb();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initBreadcrumb(event.detail && event.detail.container);
  });
})();
