/* @bydefaultstudio/design-system v4.5.0 */
/**
 * Bar overflow
 * The bar (design-system.css §41) is always one row: items that do not fit
 * move into the overflow menu instead of wrapping or scrolling out of reach.
 * This module is that move.
 *
 * Only bars that carry a .bar-overflow trigger are managed — a bar without
 * one (the doc page sub-header, whose breadcrumb truncates rather than
 * collapses) costs nothing here.
 *
 * Priority comes from the markup, not from measurement order:
 *   data-priority="pinned"  never leaves the bar
 *   (no attribute)          collapses into the menu when space runs out
 *   data-priority="menu"    always in the menu, whatever the space
 *
 * Demoted ("menu") items sit in a stable block at the top of the panel with a
 * separator below them; overflowed items append underneath. That split is why
 * the panel has two mount points — an item you deliberately demoted must not
 * change position every time the window resizes.
 *
 * WCAG 1.4.10: the menu is what keeps every control reachable at 400% zoom.
 * Reflow asks for content to be available, not simultaneously visible, and a
 * disclosure satisfies it. (The bar wrapped instead until 2026-08-14; one row
 * is what makes the stretched close cell safe.)
 *
 * Open/close, focus and dismissal belong to dropdown.js, which delegates on
 * document — nothing here binds the trigger.
 *
 * @version 1.0.1
 */
(function () {
  var VERSION = '1.0.1';

  /**
   * One managed bar. Restores everything to the bar, measures, then moves
   * trailing collapsible items to the menu until the content region fits.
   */
  function measure(bar) {
    if (!bar.isConnected) return;

    var content = bar.querySelector('.bar-content');
    var overflow = bar.querySelector('.bar-overflow');
    if (!content || !overflow) return;

    var spill = overflow.querySelector('[data-bar-spill]');
    var demoted = overflow.querySelector('[data-bar-demoted]');
    var separator = overflow.querySelector('[data-bar-separator]');
    if (!spill) return;

    // A resize can land while the panel is open. Moving a node that holds
    // focus blurs it to body, and hiding a still-open dropdown would leave
    // aria-expanded lying over nothing — so note the state up front and
    // settle both after the moves.
    var wasOpen = overflow.classList.contains('is-open');
    var hadFocus = overflow.contains(document.activeElement);

    // Restore before measuring, in recorded order, so the measurement always
    // starts from the same state and a widened window gets its items back.
    Array.from(spill.children)
      .sort(function (a, b) { return (+a.dataset.barIndex || 0) - (+b.dataset.barIndex || 0); })
      .forEach(function (item) {
        var index = +item.dataset.barIndex || 0;
        var anchor = null;
        Array.from(content.children).some(function (child) {
          if ((+child.dataset.barIndex || 0) > index) { anchor = child; return true; }
          return false;
        });
        content.insertBefore(item, anchor);
      });

    // Move the trailing collapsible item until nothing is clipped. Bounded by
    // the item count, so a bar that can never fit (all pinned) exits cleanly.
    var guard = content.children.length;
    while (guard-- > 0 && content.scrollWidth > content.clientWidth) {
      var items = Array.from(content.children);
      var candidate = null;
      for (var i = items.length - 1; i >= 0; i--) {
        if (items[i].dataset.priority !== 'pinned') { candidate = items[i]; break; }
      }
      if (!candidate) break;
      spill.appendChild(candidate);
    }

    var hasSpill = spill.children.length > 0;
    var hasDemoted = !!(demoted && demoted.children.length > 0);
    overflow.hidden = !hasSpill && !hasDemoted;
    if (separator) separator.hidden = !(hasSpill && hasDemoted);

    // Close an open panel whose contents just moved out from under the user —
    // either it emptied and hid, or it held focus that the move blurred. The
    // state is dropdown.js's, restated here because its handlers are private
    // and delegated; the shape matches its closeDropdown. A panel open under
    // the pointer with focus elsewhere stays open — its content reflows but
    // nothing is lost.
    if (wasOpen && (overflow.hidden || hadFocus)) {
      overflow.classList.remove('is-open');
      overflow.removeAttribute('data-resolved-placement');
      var trigger = overflow.querySelector('.dropdown-trigger');
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        if (hadFocus && !overflow.hidden) trigger.focus();
      }
    }
  }

  function setupBar(bar) {
    if (bar.dataset.barInit) return;
    bar.dataset.barInit = 'true';

    var content = bar.querySelector('.bar-content');
    var overflow = bar.querySelector('.bar-overflow');
    if (!content || !overflow) return;

    var menu = overflow.querySelector('.dropdown-menu');
    if (!menu) return;

    // The panel's two mount points: demoted block first, separator, then the
    // spill. Built here rather than authored, so the markup an author writes
    // is only the trigger and an empty menu.
    var demoted = document.createElement('div');
    demoted.setAttribute('data-bar-demoted', '');
    var separator = document.createElement('div');
    separator.className = 'dropdown-divider';
    separator.setAttribute('role', 'separator');
    separator.setAttribute('data-bar-separator', '');
    separator.hidden = true;
    var spill = document.createElement('div');
    spill.setAttribute('data-bar-spill', '');
    menu.appendChild(demoted);
    menu.appendChild(separator);
    menu.appendChild(spill);

    // Stamp every managed item with its home position, then bank the
    // always-menu items once. Dividers are managed like their neighbours and
    // hidden inside the panel by CSS — moving them keeps the sequence intact.
    Array.from(content.children).forEach(function (item, index) {
      item.dataset.barIndex = String(index);
      if (item.dataset.priority === 'menu') demoted.appendChild(item);
    });

    // Self-cleaning: when Barba removes the container, the next callback sees
    // a disconnected bar and lets go. No before-leave hook to keep in sync.
    // Width-gated because measure() mutates the container's children, which
    // re-fires the observer with a changed HEIGHT — collapse only depends on
    // width, so re-measuring on height is a feedback loop that converges but
    // spams "undelivered notifications" warnings on the way.
    var lastWidth = -1;
    var observer = new ResizeObserver(function (entries) {
      if (!bar.isConnected) { observer.disconnect(); return; }
      var width = entries[entries.length - 1].contentRect.width;
      if (width === lastWidth) return;
      lastWidth = width;
      window.requestAnimationFrame(function () { measure(bar); });
    });
    observer.observe(bar.querySelector('.bar-container') || bar);

    measure(bar);
  }

  function initBar(scope) {
    var root = scope || document;
    var bars = root.querySelectorAll('.bar');
    var managed = 0;

    bars.forEach(function (bar) {
      if (bar.querySelector('.bar-overflow')) {
        setupBar(bar);
        managed++;
      }
    });

    if (managed) console.log('[bar] v' + VERSION + ' — init (' + managed + ')');
  }

  window.initBar = initBar;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initBar(); });
  } else {
    initBar();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initBar(event.detail && event.detail.container);
  });
})();
