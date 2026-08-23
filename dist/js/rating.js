/* @bydefaultstudio/design-system v4.2.0 */
/**
 * Rating component — interactive star ratings
 * Initialises all .rating elements that are not .is-readonly.
 *
 * Click or ArrowLeft/ArrowRight sets the value; hovering previews it.
 * Selecting a value dispatches a bubbling `rating-change` event.
 *
 * @version 1.1.0
 */
(function () {
  function initRating(scope) {
    var root = scope || document;
    var bound = 0;

    root.querySelectorAll('.rating:not(.is-readonly)').forEach(function (rating) {
      if (rating.dataset.ratingBound) return;
      rating.dataset.ratingBound = 'true';
      bound++;

      var stars = Array.from(rating.querySelectorAll('.rating-star'));
      var current = parseInt(rating.getAttribute('data-value') || '0', 10);

      function render(hovered) {
        var val = hovered !== undefined ? hovered : current;
        stars.forEach(function (star, i) {
          star.classList.toggle('is-filled', i < val);
          star.classList.toggle('is-hovered', hovered !== undefined && i < hovered);
        });
      }

      stars.forEach(function (star, i) {
        star.addEventListener('mouseenter', function () { render(i + 1); });
        star.addEventListener('mouseleave', function () { render(); });
        star.addEventListener('click', function () {
          current = i + 1;
          rating.setAttribute('data-value', current);
          rating.dispatchEvent(new CustomEvent('rating-change', { detail: { value: current }, bubbles: true }));
          render();
        });
        star.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' && current < stars.length) { current++; render(); }
          if (e.key === 'ArrowLeft' && current > 0) { current--; render(); }
          rating.setAttribute('data-value', current);
        });
      });

      render();
    });

    // Only when something was actually wired. This runs on every arrival and on
    // hard load, and most pages have no rating at all.
    if (bound) console.log('[rating] v1.1.0 — init (' + bound + ')');
  }

  // Exposed for parity with the other components; the after-nav listener below
  // is the caller that matters.
  window.initRating = initRating;

  //
  //------- Initialize -------//
  //
  // Registered twice: once for the initial load, once for Barba's after-nav
  // event. DOMContentLoaded never re-fires after a container swap, so without
  // the second listener every star goes inert on the first navigation.
  // See cms/js-code-structure.md.
  //
  // Both fire on a hard load — Barba's once() runs the global afterEnter hook
  // even with no transition registered — so initRating runs twice before any
  // navigation happens. The dataset guard is what makes that harmless, on every
  // page view rather than only after a swap.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initRating(); });
  } else {
    initRating();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initRating(event.detail && event.detail.container);
  });
})();
