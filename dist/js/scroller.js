/* @bydefaultstudio/design-system v7.0.0 */
/**
 * Scroller component
 * One line of chips or tags that scrolls sideways (.scroller, design-system.css
 * §28): fades whichever edge has more past it, and turns a vertical mouse
 * wheel into sideways scrolling.
 *
 * The row works without this file: it scrolls by touch, trackpad and keyboard
 * (focus moves along it). What the script adds is the edge fade, which tells a
 * reader there is more, and the wheel, since the scrollbar is hidden and
 * shift+wheel is folklore.
 *
 * The fade is re-read on scroll and whenever the row or its content changes
 * size: the panel resizing, the font loading, chips written in later by a
 * page's own script. A pixel of slack absorbs sub-pixel scroll positions.
 *
 * Lifecycle: binds every .scroller on load and after each Barba navigation
 * (bd:after-nav), once per element. The observers of rows inside the leaving
 * container are released on bd:before-nav.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  // Rows bound in this document, each with its observer, for release.
  var bound = [];

  // Sync Edges
  function syncEdges(scroller) {
    var max = scroller.scrollWidth - scroller.clientWidth;

    scroller.classList.toggle('is-overflow-start', scroller.scrollLeft > 1);
    scroller.classList.toggle('is-overflow-end', scroller.scrollLeft < max - 1);
  }

  // Handle Scroll
  function handleScroll(event) {
    syncEdges(event.currentTarget);
  }

  // Handle Wheel
  // Vertical intent becomes sideways scroll while the row has somewhere to
  // go; a trackpad's own sideways gesture, a pinch (ctrlKey), and a wheel at
  // either end pass through, so the page still scrolls past the row.
  function handleWheel(event) {
    var scroller = event.currentTarget;
    var max = scroller.scrollWidth - scroller.clientWidth;

    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || max <= 0) {
      return;
    }

    if ((event.deltaY < 0 && scroller.scrollLeft <= 0) || (event.deltaY > 0 && scroller.scrollLeft >= max - 1)) {
      return;
    }

    event.preventDefault();
    scroller.scrollLeft += event.deltaY;
  }

  // Bind
  function bind(scroller) {
    if (scroller.dataset.scrollerBound) {
      return;
    }

    scroller.dataset.scrollerBound = 'true';
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    scroller.addEventListener('wheel', handleWheel, { passive: false });

    var observer = null;

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(function onResize() {
        syncEdges(scroller);
      });
      observer.observe(scroller);

      // The row's own box does not change when chips are written into it,
      // its content's does.
      if (scroller.firstElementChild) {
        observer.observe(scroller.firstElementChild);
      }
    }

    bound.push({ el: scroller, observer: observer });
    syncEdges(scroller);
  }

  // Init Scroller
  // Takes a scope to search, or a .scroller itself.
  function initScroller(scopeOrEl) {
    var root = scopeOrEl || document;
    var rows = Array.prototype.slice.call(root.querySelectorAll('.scroller'));

    if (root.matches && root.matches('.scroller')) {
      rows.unshift(root);
    }

    rows.forEach(bind);
  }

  // Release
  // Rows inside the leaving container stop being observed.
  function release(container) {
    bound = bound.filter(function keep(entry) {
      if (container && !container.contains(entry.el)) {
        return true;
      }

      if (entry.observer) {
        entry.observer.disconnect();
      }

      return false;
    });
  }

  window.initScroller = initScroller;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function onReady() {
      initScroller();
    });
  } else {
    initScroller();
  }

  document.addEventListener('bd:after-nav', function onAfterNav(event) {
    initScroller(event.detail && event.detail.container);
  });

  document.addEventListener('bd:before-nav', function onBeforeNav(event) {
    release(event.detail && event.detail.container);
  });

  console.log('[scroller] v' + VERSION + ' — init');
})();
