/* @bydefaultstudio/design-system v4.4.0 */
/**
 * Cell Input component — fixed-shape text entry rendered as per-character cells
 * Initialises all .cell-input elements that have a data-format and an <input>.
 *
 * The input is the single source of truth: it carries focus, value and the
 * accessible name. Cells are built from data-format and painted from the
 * value on every input event — separators are pre-revealed, never typed.
 * Typing dispatches a bubbling `cell-input:change`; filling the last cell
 * dispatches `cell-input:complete`.
 *
 * Format and wiring are read once at bind time: changing data-format or
 * replacing the input afterwards requires clearing data-cell-input-bound
 * and re-running initCellInput on the block.
 *
 * @version 1.0.0
 */
(function () {
  var MASK_CHAR = '•';

  /* Format grammar: digits = typeable cell count, space = word break,
     "-" and "/" = separator cell plus a soft wrap point, any other
     character = inline separator (apostrophes, dots). */
  function parseFormat(format) {
    var groups = [[]];
    var length = 0;
    var tokens = String(format).match(/\d+|\s+|./g) || [];
    tokens.forEach(function (token) {
      var group = groups[groups.length - 1];
      if (/^\d+$/.test(token)) {
        for (var i = 0; i < Number(token); i++) {
          group.push({ typeable: true });
          length++;
        }
      } else if (/^\s+$/.test(token)) {
        if (group.length) groups.push([]);
      } else {
        group.push({ typeable: false, char: token });
        if (token === '-' || token === '/') groups.push([]);
      }
    });
    groups = groups.filter(function (group) { return group.length > 0; });
    return { groups: groups, length: length };
  }

  function buildCells(pattern) {
    return pattern.groups.map(function (group) {
      return '<span class="cell-input-word">' + group.map(function (cell) {
        if (cell.typeable) return '<span class="cell-input-cell" data-cell="letter"></span>';
        var char = String(cell.char).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return '<span class="cell-input-cell" data-cell="separator">' + char + '</span>';
      }).join('') + '</span>';
    }).join('');
  }

  /* Shape-only fallback name — authors should write their own aria-label */
  function describePattern(pattern, unit) {
    var counts = pattern.groups.map(function (group) {
      return group.filter(function (cell) { return cell.typeable; }).length;
    }).filter(function (count) { return count > 0; });
    if (counts.length === 1) return counts[0] + ' ' + unit;
    // Digit formats split on separators, not spaces — "groups", not "words"
    var noun = unit === 'digits' ? 'groups' : 'words';
    return counts.length + ' ' + noun + ': ' + counts.slice(0, -1).join(', ') +
      ' and ' + counts[counts.length - 1] + ' ' + unit;
  }

  /* What lands in the cells: accents folded, everything outside the mode's
     character set dropped — so a pasted "Tinker Bell" keeps all ten letters. */
  function makeFilter(mode) {
    var keep = mode === 'digits' ? /[^0-9]/g : mode === 'letters' ? /[^a-zA-Z]/g : /[^a-zA-Z0-9]/g;
    return function (raw) {
      return String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(keep, '');
    };
  }

  function initCellInput(scope) {
    var root = scope || document;
    var bound = 0;

    root.querySelectorAll('.cell-input[data-format]').forEach(function (block) {
      if (block.dataset.cellInputBound) return;
      var input = block.querySelector('input');
      var cellsEl = block.querySelector('.cell-input-cells');
      if (!input || !cellsEl) return;
      block.dataset.cellInputBound = 'true';

      var pattern = parseFormat(block.getAttribute('data-format'));
      // A format with no typeable cells is an authoring error — leave the
      // block inert and say so, rather than binding a nonsense state
      if (!pattern.length) {
        console.warn('[cell-input] data-format "' + block.getAttribute('data-format') + '" has no typeable cells — not initialised', block);
        return;
      }
      bound++;

      var mode = block.getAttribute('data-mode') || 'any';
      var masked = block.hasAttribute('data-mask');
      var filter = makeFilter(mode);
      var wasComplete = false;

      cellsEl.innerHTML = buildCells(pattern);
      // The cells are decoration mirroring the input — enforce their removal
      // from the accessibility tree rather than trusting the markup
      cellsEl.setAttribute('aria-hidden', 'true');
      var letterCells = cellsEl.querySelectorAll('[data-cell="letter"]');

      if (mode === 'digits') input.setAttribute('inputmode', 'numeric');
      if (!input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) {
        input.setAttribute('aria-label', describePattern(pattern, mode === 'digits' ? 'digits' : 'characters'));
      }
      // One-time snapshot — toggling disabled later means toggling both
      // the attribute and the class (see the CSS section comment)
      block.classList.toggle('is-disabled', input.disabled);

      function paint() {
        var value = filter(input.value);
        letterCells.forEach(function (cell, i) {
          cell.textContent = value[i] ? (masked ? MASK_CHAR : value[i]) : '';
          cell.classList.toggle('is-filled', Boolean(value[i]));
          // The caret cell doubles as the focus indicator, so a full row
          // keeps it on the last cell instead of losing it
          cell.classList.toggle('is-active', i === Math.min(value.length, letterCells.length - 1));
        });
      }

      var lastValue = null;

      function handleInput(event) {
        // Mid-composition text would be stripped and the reassignment below
        // would cancel the IME session — wait for the composition to settle
        if (event && event.isComposing) return;
        var clean = filter(input.value).slice(0, pattern.length);
        // Assigning back does not re-fire 'input'
        if (clean !== input.value) input.value = clean;
        paint();
        // A rejected keystroke or a blur-fired 'change' leaves the value as
        // it was — no event for consumers in that case
        if (clean === lastValue) return;
        lastValue = clean;
        var complete = clean.length === pattern.length;
        block.dispatchEvent(new CustomEvent('cell-input:change', {
          detail: { value: clean, complete: complete }, bubbles: true
        }));
        if (complete && !wasComplete) {
          block.dispatchEvent(new CustomEvent('cell-input:complete', {
            detail: { value: clean }, bubbles: true
          }));
        }
        wasComplete = complete;
      }

      input.addEventListener('input', handleInput);
      // 'change' catches value setters that announce themselves (a bare
      // input.value = x fires nothing — dispatch input or change after it)
      input.addEventListener('change', handleInput);

      // Clamp and paint any pre-filled value (back-navigation restore,
      // autofill) so the stored value is never dirtier than the cells show
      input.value = filter(input.value).slice(0, pattern.length);
      lastValue = input.value;
      paint();
      wasComplete = input.value.length === pattern.length;
    });

    // Only when something was actually wired — most pages have no cell input.
    if (bound) console.log('[cell-input] v1.0.0 — init (' + bound + ')');
  }

  // Exposed for parity with the other components; the after-nav listener below
  // is the caller that matters.
  window.initCellInput = initCellInput;

  //
  //------- Initialize -------//
  //
  // Registered twice: once for the initial load, once for Barba's after-nav
  // event. DOMContentLoaded never re-fires after a container swap, so without
  // the second listener every cell input goes inert on the first navigation.
  // Both fire on a hard load; the dataset guard makes that harmless.
  // See cms/js-code-structure.md.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initCellInput(); });
  } else {
    initCellInput();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initCellInput(event.detail && event.detail.container);
  });
})();
