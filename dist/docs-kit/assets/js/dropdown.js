// Dropdown component — auto-initialises all .dropdown elements
(function () {
  function closeAll(except) {
    document.querySelectorAll('.dropdown.is-open').forEach(function (d) {
      if (d !== except) {
        d.classList.remove('is-open');
        var t = d.querySelector('.dropdown-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('.dropdown-trigger');
    var dropdown = trigger ? trigger.closest('.dropdown') : null;

    if (dropdown) {
      var wasOpen = dropdown.classList.contains('is-open');
      closeAll();
      if (!wasOpen) {
        dropdown.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    } else if (!e.target.closest('.dropdown-menu')) {
      closeAll();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = document.querySelector('.dropdown.is-open');
      if (open) {
        open.classList.remove('is-open');
        var t = open.querySelector('.dropdown-trigger');
        if (t) { t.setAttribute('aria-expanded', 'false'); t.focus(); }
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var menu = document.querySelector('.dropdown.is-open .dropdown-menu');
      if (!menu) return;
      var items = Array.from(menu.querySelectorAll('.dropdown-item:not(.is-disabled)'));
      var current = document.activeElement;
      var idx = items.indexOf(current);
      if (e.key === 'ArrowDown') items[Math.min(idx + 1, items.length - 1)].focus();
      if (e.key === 'ArrowUp') items[Math.max(idx - 1, 0)].focus();
      e.preventDefault();
    }
  });
})();
