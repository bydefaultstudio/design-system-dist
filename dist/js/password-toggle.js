/* @bydefaultstudio/design-system v2.2.0 */
/**
 * Script Purpose: Password show/hide toggle for auth forms
 * Author: By Default Studio
 * Version: 1.0.0
 * Last Updated: 2026-04-07
 */

(function () {
  'use strict';

  function initPasswordToggles() {
    var toggles = document.querySelectorAll('.password-toggle');
    if (!toggles.length) return;

    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.closest('.password-field');
        if (!field) return;

        var input = field.querySelector('input');
        if (!input) return;

        var isShowing = input.type === 'text';
        input.type = isShowing ? 'password' : 'text';
        btn.setAttribute('aria-pressed', String(!isShowing));
        btn.setAttribute('aria-label', isShowing ? 'Show password' : 'Hide password');
      });
    });

    console.log('[Password Toggle] v1.0.0 — ' + toggles.length + ' toggle(s) initialised');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasswordToggles);
  } else {
    initPasswordToggles();
  }
})();
