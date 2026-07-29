/* @bydefaultstudio/design-system v2.0.1 */
/**
 * Toast component
 * Call window.showToast(message, type, duration) to display a notification.
 * Types: 'default', 'success', 'warning', 'danger', 'info'
 *
 * @version 1.1.0
 */
(function () {
  'use strict';

  var FALLBACK_EXIT_MS = 300;

  function getContainer() {
    var c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      // The container is the single live region; toasts themselves carry no
      // role by default. Nesting role="alert" inside an aria-live container
      // double-announces in JAWS and contradicts the polite setting.
      c.setAttribute('aria-live', 'polite');
      c.setAttribute('aria-atomic', 'true');
      document.body.appendChild(c);
    }
    // A showModal() dialog sits in the top layer and makes the rest of the
    // document inert — a body-level toast would be invisible to everyone and
    // pruned from the accessibility tree. Reparent into the open modal.
    var modal = document.querySelector('dialog:modal');
    var home = modal || document.body;
    if (c.parentNode !== home) home.appendChild(c);
    return c;
  }

  // The fade length lives in CSS (--toast-exit-duration, shortened under
  // prefers-reduced-motion); read the computed value so the removal delay
  // can never drift from it.
  function exitDuration(toast) {
    var raw = getComputedStyle(toast).transitionDuration;
    var ms = parseFloat(raw) * (raw.indexOf('ms') > -1 ? 1 : 1000);
    return isNaN(ms) ? FALLBACK_EXIT_MS : ms;
  }

  function dismiss(toast) {
    if (toast.bdDismissed) return;
    toast.bdDismissed = true;
    clearTimeout(toast.bdDismissTimer);
    // Removing the node while the dismiss button holds focus would drop
    // focus silently; release it to the body first.
    if (toast.contains(document.activeElement) && document.activeElement.blur) {
      document.activeElement.blur();
    }
    toast.style.opacity = '0';
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, exitDuration(toast));
  }

  window.showToast = function (message, type, duration) {
    type = type || 'default';
    duration = duration || 4000;

    var container = getContainer();
    var toast = document.createElement('div');
    toast.className = 'toast';
    if (type !== 'default') toast.dataset.type = type;
    // Urgent failures may interrupt; everything else announces politely
    // through the container.
    if (type === 'danger') toast.setAttribute('role', 'alert');
    toast.innerHTML =
      '<span class="toast-message">' + escapeHTML(message) + '</span>' +
      '<button class="button close-btn" type="button" data-icon-only data-size="small" aria-label="Dismiss"><div class="svg-icn" data-icon="close"><svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.4 19L5 17.6L9.18579 13.4142C9.96684 12.6332 9.96684 11.3668 9.18579 10.5858L5 6.4L6.4 5L10.5858 9.18579C11.3668 9.96684 12.6332 9.96684 13.4142 9.18579L17.6 5L19 6.4L14.8142 10.5858C14.0332 11.3668 14.0332 12.6332 14.8142 13.4142L19 17.6L17.6 19L13.4142 14.8142C12.6332 14.0332 11.3668 14.0332 10.5858 14.8142L6.4 19Z" fill="currentColor"/></svg></div></button>';

    container.appendChild(toast);

    toast.querySelector('.close-btn').addEventListener('click', function () {
      dismiss(toast);
    });

    // Auto-dismiss pauses while the pointer or keyboard focus is on the
    // toast — a timed removal under an engaged user fails 2.2.1 and yanks
    // focus out from under them.
    function pause() {
      clearTimeout(toast.bdDismissTimer);
    }
    function resume() {
      if (toast.contains(document.activeElement)) return;
      pause();
      toast.bdDismissTimer = setTimeout(function () { dismiss(toast); }, duration);
    }
    toast.addEventListener('pointerenter', pause);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('pointerleave', resume);
    toast.addEventListener('focusout', function (e) {
      if (!toast.contains(e.relatedTarget)) resume();
    });
    resume();
  };

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Create the live region at init: assistive tech must register the region
  // before its first mutation, or the first toast is announced by nobody.
  function initToast() {
    if (!document.body) return;
    getContainer();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToast);
  } else {
    initToast();
  }

  console.log('[toast] v1.1.0 — init');
})();
