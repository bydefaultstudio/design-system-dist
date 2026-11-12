/* @bydefaultstudio/design-system v8.1.1 */
/**
 * Toast component
 * Call window.showToast(message, type, duration) to display a notification.
 * Types: 'default', 'success', 'warning', 'danger', 'info'
 *
 * @version 1.4.0
 */
(function () {
  'use strict';

  var FALLBACK_EXIT_MS = 300;

  // The toasts showToast made and has not yet removed. A page's own static
  // toast markup (a demo) is not in here, and a page transition leaves it be.
  var live = new Set();

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
    if (c.parentNode !== home) moveContainer(c, home);
    return c;
  }

  // Moving the container re-inserts the toasts already in it, and a
  // re-inserted toast would play its entrance again from @starting-style.
  // .is-moving holds every transition off for one forced style pass, which
  // gives the moved toasts their resting style; taken off at once, so an
  // exit or entrance that follows in the same task still plays.
  function moveContainer(container, home) {
    container.classList.add('is-moving');
    home.appendChild(container);
    void container.offsetWidth;
    container.classList.remove('is-moving');
  }

  // The exit length lives in CSS (--toast-exit-duration, on .is-closing);
  // read the computed value once the class is on, so the removal delay can
  // never drift from it. Several properties transition, so the list is
  // read and the longest wins.
  function exitDuration(toast) {
    var raw = getComputedStyle(toast).transitionDuration.split(',');
    var longest = raw.reduce(function toMs(max, part) {
      var value = parseFloat(part) * (part.indexOf('ms') > -1 ? 1 : 1000);
      return isNaN(value) ? max : Math.max(max, value);
    }, -1);
    return longest < 0 ? FALLBACK_EXIT_MS : longest;
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
    toast.classList.add('is-closing');
    setTimeout(function () {
      live.delete(toast);
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
      '<button class="button close-btn" type="button" data-icon-only data-size="small" aria-label="Dismiss"><span class="svg-icn" data-icon="close"><svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.4 18L6 16.6L9.18579 13.4142C9.96684 12.6332 9.96684 11.3668 9.18579 10.5858L6 7.4L7.4 6L10.5858 9.18579C11.3668 9.96684 12.6332 9.96684 13.4142 9.18579L16.6 6L18 7.4L14.8142 10.5858C14.0332 11.3668 14.0332 12.6332 14.8142 13.4142L18 16.6L16.6 18L13.4142 14.8142C12.6332 14.0332 11.3668 14.0332 10.5858 14.8142L7.4 18Z" fill="currentColor"/></svg></span></button>';

    container.appendChild(toast);
    live.add(toast);

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

  // A toast is about the page it came from: a page transition sends every
  // one still showing out through its own exit as the leave begins. The
  // container stays, since it is the live region.
  function dismissAllOnLeave() {
    // Home first: a container inside a modal on the leaving page would go
    // with the page, and the next page's first toast would land in a live
    // region nobody had registered.
    var container = document.querySelector('.toast-container[aria-live]');
    if (container && live.size && container.parentNode !== document.body) moveContainer(container, document.body);
    live.forEach(dismiss);
  }

  // Create the live region at init: assistive tech must register the region
  // before its first mutation, or the first toast is announced by nobody.
  function initToast() {
    if (!document.body) return;
    getContainer();
  }
  document.addEventListener('bd:before-nav', dismissAllOnLeave);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToast);
  } else {
    initToast();
  }

  console.log('[toast] v1.4.0 — init');
})();
