/* @bydefaultstudio/design-system v2.2.0 */
// Rating component — interactive star ratings
(function () {
  document.querySelectorAll('.rating:not(.is-readonly)').forEach(function (rating) {
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
})();
