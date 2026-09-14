/* @bydefaultstudio/design-system v4.8.0 */
/**
 * Chip component
 * Adds clear-on-reclick to .chip-group[data-clearable].
 *
 * A chip group needs no script to work: it is native radios in labels, so the
 * browser handles selection, arrow keys and the posted value. The one thing
 * radios cannot do is deselect — clicking the checked radio re-checks it — and
 * that is all this module adds. Groups without [data-clearable] are ignored, so
 * a page that never needs clearing never needs this file.
 *
 * @version 1.0.1
 */
(function () {
  var VERSION = '1.0.1';

  function initChip(scopeOrEl) {
    var root = scopeOrEl || document;
    var bound = 0;

    // Accepts a scope to search, or the .chip-group itself — an element cannot
    // match its own querySelectorAll, so a caller holding one group would
    // otherwise have to pass the parent and catch its siblings too. The node
    // handed in JOINS the set rather than replacing it, exactly as the five
    // per-element modules do: replacing it would leave a clearable group
    // nested inside the one handed in silently unbound.
    var groups = root.querySelectorAll('.chip-group[data-clearable]');
    if (root.matches && root.matches('.chip-group[data-clearable]')) {
      groups = [root].concat(Array.from(groups));
    }

    groups.forEach(function (group) {
      if (group.dataset.chipBound) return;
      group.dataset.chipBound = 'true';
      bound++;

      // Which radio was checked when the press started. Read on pointerdown
      // because by click time the browser has already checked the target, so
      // there is no way to tell a re-click from a first click after the fact.
      var wasChecked = null;

      group.addEventListener('pointerdown', function (e) {
        var input = inputFor(e.target);
        wasChecked = input && input.checked ? input : null;
      });

      // Touch-scrolling off a pressed chip fires pointercancel and no click,
      // which would otherwise leave that chip armed indefinitely.
      group.addEventListener('pointercancel', function () {
        wasChecked = null;
      });

      // Delete and Backspace clear the focused answer. Arrow keys must NOT:
      // arrow-key radio selection dispatches a synthetic click in Chromium and
      // Firefox, so without the reset below a chip would clear itself the
      // instant you arrowed onto it. Not Escape either — it bubbles into
      // dialog.js and drawer.js and would close the container the chip sits in.
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          var focused = document.activeElement;
          var input = inputFor(focused);
          if (input && input === focused && input.checked && !input.disabled) {
            e.preventDefault();
            clear(input);
            wasChecked = null;
            return;
          }
        }
        wasChecked = null;
      });

      // wasChecked is valid only for the click that immediately follows its
      // pointerdown, so EVERY click consumes it — including a click on a
      // different chip. Without that, a press dragged off the chip produces no
      // click at all and leaves that chip armed; a later click arriving with no
      // pointerdown of its own (script .click(), a dispatched event, an
      // assistive-tech activation) would then clear the very answer it was
      // meant to select, leaving the group with nothing chosen.
      //
      // Deliberately NOT reset on pointerup: pointerup fires BEFORE click, so
      // disarming there would break every genuine re-click.
      group.addEventListener('click', function (e) {
        var was = wasChecked;
        wasChecked = null;
        var input = inputFor(e.target);
        if (!input || input !== was) return;
        if (input.disabled) return;
        clear(input);
      });
    });

    if (bound) console.log('[chip] v' + VERSION + ' — init (' + bound + ')');
  }

  function clear(input) {
    // Idempotent: an already-cleared answer fires nothing, so no consumer sees
    // a change event for a change that did not happen.
    if (!input.checked) return;
    input.checked = false;

    // Programmatic changes fire nothing, and a consumer reading the group
    // through change events would never learn the answer was cleared. Note
    // these are DOM events: assistive tech does not listen to them, so a
    // consumer wanting the clear announced pairs it with a role="status"
    // region — the pattern documented on cms/cell-input.md.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function inputFor(target) {
    if (!target || !target.closest) return null;
    var chip = target.closest('.chip');
    return chip ? chip.querySelector('input[type="radio"]') : null;
  }

  window.initChip = initChip;

  //
  //------- Initialize -------//
  //

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initChip(); });
  } else {
    initChip();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initChip(event.detail && event.detail.container);
  });
})();
