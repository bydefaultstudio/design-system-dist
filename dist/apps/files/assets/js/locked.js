/**
 * locked.js - the locked page's one action (cms/locked.md). v1.2.1
 *
 * "Ask for access" posts the Ask for access form, the one on the engine's
 * support page, with the reader's address and the page's URL filled in, so
 * a signed-in request needs nothing typed. The form service sends it on, to
 * the site's own inbox on a client site. The address comes from the page's
 * one session check (header-account.js, window.bdSession); until that has
 * landed, or if it never does, the button goes to the Ask for access page
 * with this page filled in instead, so there is always a way to ask.
 *
 * Where a reader asks is the engine's, the same on every site
 * (window.bdPaths.support, written by nav.js; phase D, PD-4), and that
 * fixed address when a page has no nav.js.
 *
 * The page is always a full navigation (the Worker serves it with 403), so
 * DOMContentLoaded is the whole lifecycle; bd:after-nav is registered too, per
 * the house rule, and the init guard makes a second run a no-op.
 */
(function () {
  'use strict';

  var VERSION = '1.2.2';
  var SUBMIT_URL = '/api/submit-form';

  var COPY = {
    sent: function (email) { return 'Request sent. The answer comes to ' + email + '.'; },
    failed: 'The request did not send. ',
    askElsewhere: 'Ask through the contact form',
    busy: 'Sending\u2026',
    done: 'Request sent'
  };

  var busy = false;

  // The engine's Ask for access page. A page without nav.js still has the
  // engine's fixed address (PD-2), so the button is never a silent one
  var ENGINE_SUPPORT = '/support.html';
  function supportPath() {
    return (window.bdPaths && window.bdPaths.support) || ENGINE_SUPPORT;
  }

  function supportHref() {
    return supportPath() + '?from=' + encodeURIComponent(window.location.href);
  }

  function today() {
    return new Date().toISOString().split('T')[0];
  }

  function ask(button, status) {
    if (busy || button.getAttribute('aria-disabled') === 'true') return;
    var session = window.bdSession;
    if (!session || !session.signedIn || !session.email) {
      window.location.assign(supportHref());
      return;
    }
    busy = true;
    var label = button.textContent;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.textContent = COPY.busy;
    status.textContent = '';

    fetch(SUBMIT_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'access-support',
        data: {
          'Name': session.name || session.email,
          'Email': session.email,
          'Request Type': 'Access Request',
          'Message': 'Access to ' + window.location.href,
          'Page or Section': window.location.href,
          'Submitted Date': today()
        },
        hp: ''
      })
    })
      .then(function (response) {
        if (!response.ok) throw new Error('submit ' + response.status);
        status.textContent = COPY.sent(session.email);
        button.textContent = COPY.done;
        // Not `disabled`: that drops focus to <body>. The request is sent once.
        button.setAttribute('aria-disabled', 'true');
      })
      .catch(function () {
        status.replaceChildren(document.createTextNode(COPY.failed));
        var link = document.createElement('a');
        link.href = supportHref();
        link.textContent = COPY.askElsewhere;
        status.appendChild(link);
        button.textContent = label;
      })
      .then(function () {
        busy = false;
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
      });
  }

  function initLocked() {
    var panel = document.querySelector('[data-locked]');
    if (!panel || panel.dataset.lockedInit) return;
    var button = panel.querySelector('#locked-ask');
    var status = panel.querySelector('#locked-status');
    if (!button || !status) return;
    panel.dataset.lockedInit = 'true';
    button.addEventListener('click', function () { ask(button, status); });
    console.log('locked.js v' + VERSION + ' initialised');
  }

  document.addEventListener('DOMContentLoaded', initLocked);
  document.addEventListener('bd:after-nav', initLocked);
})();
