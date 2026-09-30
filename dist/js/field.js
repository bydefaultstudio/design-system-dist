/* @bydefaultstudio/design-system v5.1.1 */
/**
 * Field — the controls inside a text input
 * Gives every .field its .is-filled state and makes its clear button work.
 *
 * A .field is a box around one input with an icon, a clear or a toggle
 * beside it (cms/field.md). The script keeps `.is-filled` on the box in
 * step with the input's value — the CSS shows the clear only then — and a
 * click on .field-clear empties the input, dispatches `input` then `change`
 * so form code sees a user edit, and hands focus back to the input. A click
 * on the box itself, or on a decorative icon in it, focuses the input too.
 *
 * Delegated: one set of document listeners, so markup rendered at load,
 * swapped in by Barba or added later all work. `initField(scopeOrEl)` only
 * repaints .is-filled for values that arrived without an input event — a
 * prefilled form, autofill, a form reset, or a value set from script. A
 * script that writes `input.value` calls it afterwards, or the clear shows
 * for a value that is no longer there.
 *
 * The password toggle is password-toggle.js; this file does not touch it.
 *
 * @version 1.1.0
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var SELECTOR = '.field';
  // The input the field is about. A leading colour swatch is an input too,
  // but it only mirrors the hex beside it: it never counts as the value,
  // never takes the focus a click on the box forwards, and never fills it.
  var INPUT = '.field > input:not([type="color"])';

  // React replaces the instance `value` setter with a tracker, so a plain
  // `input.value = ''` is recorded as the current value and the `input`
  // event that follows looks like no change — onChange never fires. The
  // prototype setter bypasses the tracker, so a React-controlled input sees
  // the clear like any keystroke.
  var nativeValueSetter = (function () {
    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    return descriptor && descriptor.set ? descriptor.set : null;
  })();

  //
  //------- Utility -------//
  //

  function fieldInput(field) {
    return field.querySelector(':scope > input:not([type="color"])');
  }

  function paintFilled(field, input) {
    field.classList.toggle('is-filled', input.value !== '');
  }

  function clearField(field, input) {
    if (nativeValueSetter) {
      nativeValueSetter.call(input, '');
    } else {
      input.value = '';
    }
    paintFilled(field, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }

  //
  //------- Event Listeners -------//
  //

  function handleClick(event) {
    if (!(event.target instanceof Element)) return;

    var button = event.target.closest('.field-clear');
    if (button) {
      var field = button.closest(SELECTOR);
      var input = field && fieldInput(field);
      // The CSS hides the clear on a disabled or read-only input; a click
      // that arrives anyway (a stale render, a script) still does nothing
      if (!input || input.disabled || input.readOnly) return;
      clearField(field, input);
      return;
    }

    // Focus forwarding: the box's edge and its decorative icon are not the
    // input, and a reader who taps them meant the input. Anything that is
    // itself a control keeps its own click.
    var box = event.target.closest(SELECTOR);
    if (!box || event.target.closest('input, button, a, select, textarea, label')) return;
    var target = fieldInput(box);
    if (target && !target.disabled) target.focus();
  }

  // `change` as well as `input`: autofill announces itself with `change` in
  // some engines and with nothing at all in others — initField covers those
  function handleInput(event) {
    var input = event.target;
    if (!(input instanceof Element) || !input.matches(INPUT)) return;
    paintFilled(input.parentElement, input);
  }

  // A reset restores the defaults after the event, so the repaint waits a tick
  function handleReset(event) {
    var form = event.target;
    if (!(form instanceof Element)) return;
    window.setTimeout(function repaintAfterReset() { initField(form); }, 0);
  }

  //
  //------- Initialize -------//
  //

  // Accepts a scope to search, or the .field itself — see tabs.js. Only
  // repaints .is-filled; the listeners are bound once, on the document.
  function initField(scopeOrEl) {
    var root = scopeOrEl || document;
    var fields = Array.prototype.slice.call(root.querySelectorAll(SELECTOR));
    if (root.matches && root.matches(SELECTOR)) fields = [root].concat(fields);
    fields.forEach(function paintOne(field) {
      var input = fieldInput(field);
      if (input) paintFilled(field, input);
    });
  }

  function bindDocument() {
    if (window.__fieldInit) return;
    window.__fieldInit = true;
    document.addEventListener('click', handleClick);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleInput);
    document.addEventListener('reset', handleReset);
    console.log('[field] v' + VERSION + ' — init');
  }

  window.initField = initField;
  bindDocument();

  // The repaint runs on load and again after each Barba swap, since a
  // container that arrives with values in it fires no input event.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initField(); });
  } else {
    initField();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initField(event.detail && event.detail.container);
  });
})();
