// Number input — stepper buttons for .number-input elements
(function () {
  document.addEventListener('click', function (e) {
    var inc = e.target.closest('[data-number-increment]');
    var dec = e.target.closest('[data-number-decrement]');
    var btn = inc || dec;
    if (!btn) return;
    var wrapper = btn.closest('.number-input');
    var input = wrapper && wrapper.querySelector('input[type="number"]');
    if (!input) return;
    var val = parseInt(input.value, 10) || 0;
    var min = input.min !== '' ? parseInt(input.min, 10) : -Infinity;
    var max = input.max !== '' ? parseInt(input.max, 10) : Infinity;
    var step = input.step !== '' ? parseInt(input.step, 10) : 1;
    if (inc) input.value = Math.min(val + step, max);
    if (dec) input.value = Math.max(val - step, min);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
})();
