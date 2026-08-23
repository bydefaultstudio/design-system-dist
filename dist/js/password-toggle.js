/* @bydefaultstudio/design-system v4.2.0 */
/**
 * Script Purpose: Password show/hide toggle for auth forms
 * Author: By Default Studio
 * Version: 1.1.0
 * Last Updated: 2026-08-09
 */

(function () {
  'use strict';

  var VERSION = '1.1.0';

  /**
   * One delegated listener rather than a listener per button.
   *
   * The previous version queried every .password-toggle at load and bound each
   * one directly, which meant a toggle only worked if its markup happened to
   * be in the document when the script ran. On this site it never is after the
   * first navigation — Barba swaps the container without re-running head
   * scripts, so arriving at a page by clicking a link left every toggle on it
   * inert. Delegation removes the question entirely: markup rendered at load,
   * swapped in by Barba, or injected later all work, and there is nothing to
   * re-initialise.
   */
  function handleClick(event) {
    if (!(event.target instanceof Element)) return;

    var btn = event.target.closest('.password-toggle');
    if (!btn) return;

    var field = btn.closest('.password-field');
    if (!field) return;

    var input = field.querySelector('input');
    if (!input) return;

    var isShowing = input.type === 'text';
    input.type = isShowing ? 'password' : 'text';
    btn.setAttribute('aria-pressed', String(!isShowing));
    btn.setAttribute('aria-label', isShowing ? 'Show password' : 'Hide password');
  }

  function initPasswordToggle() {
    if (window.__passwordToggleInit) return;
    window.__passwordToggleInit = true;

    document.addEventListener('click', handleClick);

    console.log('[password-toggle] v' + VERSION + ' — init');
  }

  window.initPasswordToggle = initPasswordToggle;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasswordToggle);
  } else {
    initPasswordToggle();
  }
})();
