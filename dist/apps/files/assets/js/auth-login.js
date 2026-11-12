/**
 * auth-login.js — the sign-in page (cms/auth-login.md, /auth/login.html)
 *
 * Two panes: an email address, then the one-time code that address received.
 * Talks to Better Auth at /api/auth (worker/auth.js). The engine's sign-in
 * page is a bare page, outside the page transitions, so DOMContentLoaded is
 * the whole lifecycle and nothing re-initialises. The build checks the page
 * carries every id this file reads (generate-docs.js checkDoorPages).
 *
 * `?next=` is honoured only when it is a same-origin path (bdSafeRedirect,
 * proven by scripts/verify-safe-redirect.js); anything else lands on /. A
 * deep link keeps its #fragment: the gate's redirect cannot carry it in
 * `next` (the server never sees it), but the browser keeps it on the login
 * page's own address, so it is added back when `next` has none.
 *
 * @version 1.6.2
 * @author By Default
 */
(function () {
  'use strict';

  console.log('auth-login.js v1.6.1 loaded');

  //
  //------- Configuration -------//
  //

  const AUTH_BASE = '/api/auth';
  const SEND_URL = AUTH_BASE + '/email-otp/send-verification-otp';
  const VERIFY_URL = AUTH_BASE + '/sign-in/email-otp';
  const SESSION_URL = AUTH_BASE + '/get-session';
  const DEFAULT_DESTINATION = '/';
  const CODE_LENGTH = 6;

  // Every message names what happened and what to do next, in as few words
  // as carry both. None blames the reader, and none says whether an address
  // is on the list — the server answers the same way either way, so the page
  // has nothing to add. Errors are read under the field; confirmations at
  // the top of the card.
  const COPY = {
    needEmail: 'Enter your email address.',
    badEmail: 'Enter a full email address, like name@company.com.',
    sent: 'Code sent. Check your email.',
    // A resend sends the live code again (worker/auth.js, resendStrategy:
    // 'reuse'), so nothing is said about an old one: there isn't one.
    resent: 'Code sent again. Check your email.',
    // A demo account (worker/auth.js): no email goes out and any six digits
    // sign it in. Said plainly, because the pane otherwise promises a code.
    demo: 'No code needed. Enter any six digits.',
    needCode: 'Enter the 6-digit code.',
    wrongCode: 'Incorrect or expired code. Try again, or send a new one.',
    offline: 'No connection. Try again.',
    failed: 'Something went wrong on our side. Try again.'
  };

  //
  //------- Redirect safety -------//
  //

  // Same-origin paths only. Resolving against the origin and comparing catches
  // the tricks a string check misses ("//evil.com" becomes a different
  // origin); the regex catches the ones the URL parser would normalise INTO a
  // cross-origin hop ("/\evil.com", "/\t/evil.com"). Leading slashes are then
  // collapsed, because "/./../..//foo" resolves to a pathname of "//foo", and
  // location.assign("//foo") is protocol-relative — the one gap the origin
  // check cannot see, since the compared URL was same-origin.
  // Two prefixes are refused even though they are ours: landing back on
  // /auth/ after signing in is a dead hop, and an /api/ endpoint is not a page.
  const NEVER_A_DESTINATION = /^\/(auth|api)(\/|$)/;

  function safeRedirect(raw, origin) {
    if (typeof raw !== 'string' || raw.charAt(0) !== '/' || /[\\\u0000-\u001f]/.test(raw)) {
      return DEFAULT_DESTINATION;
    }
    try {
      const url = new URL(raw, origin);
      if (url.origin !== origin) return DEFAULT_DESTINATION;
      const pathname = url.pathname.replace(/^\/{2,}/, '/');
      if (NEVER_A_DESTINATION.test(pathname)) return DEFAULT_DESTINATION;
      return pathname + url.search + url.hash;
    } catch (error) {
      return DEFAULT_DESTINATION;
    }
  }

  window.bdSafeRedirect = safeRedirect;

  // The fragment the reader arrived with, before anything on this page (the
  // skip link) can change it. A link to /web/button.html#variants reaches
  // the gate without its fragment and is sent here with ?next=, and the
  // browser keeps #variants on this page's address across the redirect.
  const ARRIVED_HASH = window.location.hash;

  // `next` and the fragment carried over, when `next` has none of its own.
  // Same-origin by construction: a fragment never changes the path.
  function withArrivedHash(target, hash) {
    if (!hash || hash === '#' || target.indexOf('#') !== -1 || /[\u0000-\u001f]/.test(hash)) return target;
    return target + hash;
  }

  window.bdWithArrivedHash = withArrivedHash;

  //
  //------- State -------//
  //

  const state = {
    email: '',
    busy: false,
    // Once the reader has typed, the already-signed-in check must not yank
    // the page away mid-entry.
    interacted: false
  };

  let elements = {};

  //
  //------- Utilities -------//
  //

  // The pre-paint hint for the locked sidebar on public pages, owned by
  // header-account.js. Written on the way out so a sign-in that returns to a
  // public page does not paint it locked first.
  function setSessionHint(value) {
    try { localStorage.setItem('bd-session-hint', value); } catch (e) { /* storage blocked: the hint is a nicety */ }
  }

  function destination() {
    const params = new URLSearchParams(window.location.search);
    return withArrivedHash(safeRedirect(params.get('next'), window.location.origin), ARRIVED_HASH);
  }

  function setStatus(element, text) {
    if (element) element.textContent = text || '';
  }

  // A lead-in and an optional detail on its own line. Text nodes, never
  // innerHTML: the detail is the address the reader typed.
  function setSubtitle(text, detail) {
    if (!elements.subtitle) return;
    elements.subtitle.replaceChildren(document.createTextNode(text));
    if (!detail) return;
    elements.subtitle.appendChild(document.createElement('br'));
    elements.subtitle.appendChild(document.createTextNode(detail));
  }

  function clearStatuses() {
    setStatus(elements.success, '');
    setInvalid(elements.emailInput, false);
    setInvalid(elements.codeInput, false);
  }

  // The error line under a field is the one place errors are read. Empty at
  // rest; icon + words together, never the icon alone, so the field's
  // description is never stale and the live region only ever announces a
  // sentence. The pane decides which line: whichever field the reader is at.
  function setFieldError(input, message) {
    var line = input === elements.emailInput ? elements.emailError : elements.codeError;
    if (!line) return;
    if (!message) { line.replaceChildren(); return; }
    var icon = elements.fieldIcon ? elements.fieldIcon.content.cloneNode(true) : null;
    // Hidden from the accessibility tree, whatever the template carries:
    // the words are the description, and the icon must not join them
    if (icon && icon.firstElementChild) icon.firstElementChild.setAttribute('aria-hidden', 'true');
    line.replaceChildren();
    if (icon) line.appendChild(icon);
    line.appendChild(document.createTextNode(message));
  }

  // Errors go under the field of the pane that is showing.
  function showError(message) {
    setFieldError(elements.codeForm.classList.contains('is-hidden') ? elements.emailInput : elements.codeInput, message);
  }

  // A cell input repaints from EVENTS only (cell-input.js listens on 'input'
  // and 'change'), so assigning .value alone is silent: the input empties while
  // the cells keep showing the old code. Every programmatic clear goes through
  // here. Dispatching also resets the component's internal lastValue, so a
  // later cell-input:complete still fires.
  function clearCode() {
    if (!elements.codeInput) return;
    elements.codeInput.value = '';
    elements.codeInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // The field and the message are marked together (cms/login.md): the field
  // carries the state, its error line carries the words and announces them.
  function setInvalid(input, invalid, message) {
    if (!input) return;
    // aria-invalid always rides the input — it is the control, and the only
    // thing a screen reader announces. The paint goes wherever the component
    // looks for it: a cell input colours its cells from .is-error on the BLOCK,
    // because the input itself is invisible and stretched over the cells
    // (cms/cell-input.md → Verdicts). A plain field paints on itself.
    var painted = input.closest('.cell-input') || input;
    painted.classList.toggle('is-error', invalid);
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    setFieldError(input, invalid ? message : '');
  }

  // Never `disabled`: disabling the focused button drops focus to <body>.
  // The visual state is .is-loading, the semantic one aria-disabled, and
  // state.busy is what actually stops a second submit.
  function setBusy(busy) {
    state.busy = busy;
    [elements.sendButton, elements.verifyButton, elements.resendButton].forEach(function (button) {
      if (!button) return;
      button.classList.toggle('is-loading', busy);
      button.setAttribute('aria-disabled', busy ? 'true' : 'false');
      if (busy) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    });
  }

  function limitedCopy(retryAfterSeconds) {
    const seconds = parseInt(retryAfterSeconds, 10);
    if (!seconds || seconds < 1) return 'Too many requests. Try again in a few minutes.';
    const minutes = Math.ceil(seconds / 60);
    return 'Too many requests. Try again in ' + minutes + (minutes === 1 ? ' minute.' : ' minutes.');
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.text().then(function (text) {
        let data = null;
        try { data = JSON.parse(text); } catch (error) { data = null; }
        // The Worker's send limit says Retry-After; Better Auth's own limiter
        // on the verify route says X-Retry-After.
        var retryAfter = response.headers.get('Retry-After') || response.headers.get('X-Retry-After');
        return { status: response.status, data: data, retryAfter: retryAfter };
      });
    });
  }

  function showPane(pane) {
    const emailPane = pane === 'email';
    elements.emailForm.classList.toggle('is-hidden', !emailPane);
    elements.codeForm.classList.toggle('is-hidden', emailPane);
    setStatus(elements.title, emailPane ? 'Sign in' : 'Verify it’s you');
    if (emailPane) setSubtitle('A one-time code goes to your email.');
    else setSubtitle('We sent a code to', state.email);
    (emailPane ? elements.emailInput : elements.codeInput).focus();
  }

  //
  //------- Send -------//
  //

  function sendCode(isResend) {
    if (state.busy) return;
    clearStatuses();
    setBusy(true);
    postJson(SEND_URL, { email: state.email, type: 'sign-in' })
      .then(function (result) {
        if (result.status === 200) {
          if (!isResend) showPane('code');
          var demo = !!(result.data && result.data.demo);
          if (demo) setSubtitle('Demo account', state.email);
          // No code goes out for a demo account, so "Send again" would
          // promise one; the line is hidden with the account's own answer.
          if (elements.resendLine) elements.resendLine.classList.toggle('is-hidden', demo);
          setStatus(elements.success, demo ? COPY.demo : (isResend ? COPY.resent : COPY.sent));
          return;
        }
        // Focus stays where it is on a form-level error: the address is
        // still in the field, so the field or the button the reader is on IS
        // the retry point. Pane 2 differs because it empties its field.
        if (result.status === 429) showError(limitedCopy(result.retryAfter));
        else if (result.status === 400) {
          // The service refused the address the reader typed: never empty here
          setInvalid(elements.emailInput, true, COPY.badEmail);
          elements.emailInput.focus();
        } else showError(COPY.failed);
      })
      .catch(function () {
        showError(COPY.offline);
      })
      .then(function () {
        setBusy(false);
      });
  }

  function handleSendSubmit(event) {
    event.preventDefault();
    if (state.busy) return; // before state.email moves — a second Enter mid-flight must not retarget the code
    state.interacted = true;
    const email = elements.emailInput.value.trim().toLowerCase();
    if (!email || elements.emailInput.validity.typeMismatch || email.indexOf('@') < 1) {
      // Nothing typed, or something that isn't an address yet: say which
      setInvalid(elements.emailInput, true, email ? COPY.badEmail : COPY.needEmail);
      elements.emailInput.focus();
      return;
    }
    state.email = email;
    sendCode(false);
  }

  // aria-disabled does not stop a click, so every action guards on busy itself.
  function handleResend() {
    if (state.busy) return;
    clearCode();
    sendCode(true);
  }

  function handleChangeEmail() {
    if (state.busy) return;
    clearStatuses();
    clearCode();
    showPane('email');
  }

  //
  //------- Verify -------//
  //

  function handleVerifySubmit(event) {
    event.preventDefault();
    if (state.busy) return;
    clearStatuses();
    const code = elements.codeInput.value.replace(/\D/g, '');
    if (code.length !== CODE_LENGTH) {
      setInvalid(elements.codeInput, true, COPY.needCode);
      elements.codeInput.focus();
      return;
    }
    setBusy(true);
    postJson(VERIFY_URL, { email: state.email, otp: code })
      .then(function (result) {
        if (result.status === 200 && result.data && result.data.user) {
          // Full navigation on purpose: the next page loads with the session
          // cookie in place and every module initialises from scratch. The
          // hint carries the role the record holds, so the next page hides
          // admin links before paint for everyone but admins; 'in' when the
          // answer has none, which nav.js treats as signed in, role unknown.
          var role = result.data.user && result.data.user.role;
          setSessionHint(role === 'owner' || role === 'admin' || role === 'team' || role === 'guest' ? role : 'in');
          window.location.assign(destination());
          return;
        }
        setBusy(false);
        // Cleared BEFORE the verdict is painted, not after. clearCode() fires
        // cell-input:change, and the listener in initLogin strips the invalid
        // state on that event — so painted first, the red cells and the field
        // error were added and removed in the same task and never reached the
        // screen. Not .select(): the selection is invisible on an opacity:0
        // input, and leaving the rejected code in the cells says 'typing
        // appends' when the next keystroke would replace it.
        clearCode();
        // One message for wrong, expired and locked codes: the Worker answers
        // all three identically (worker/gate.mjs REJECTED_CODE), because
        // telling them apart would say which addresses are on the list.
        if (result.status === 429) showError(limitedCopy(result.retryAfter));
        else if (result.status === 400) setInvalid(elements.codeInput, true, COPY.wrongCode);
        else showError(COPY.failed);
        elements.codeInput.focus();
      })
      .catch(function () {
        showError(COPY.offline);
        setBusy(false);
      });
  }

  //
  //------- Already signed in -------//
  //

  function redirectIfSignedIn() {
    fetch(SESSION_URL, { credentials: 'same-origin' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (data && data.session && !state.interacted) {
          setSessionHint('in');
          window.location.replace(destination());
        }
      })
      .catch(function () { /* not signed in, or offline — the form is the answer either way */ });
  }

  function markInteracted() {
    state.interacted = true;
  }

  //
  //------- Initialize -------//
  //

  function initLogin() {
    elements = {
      title: document.getElementById('login-title'),
      subtitle: document.getElementById('login-subtitle'),
      emailForm: document.getElementById('login-email-form'),
      emailInput: document.getElementById('login-email'),
      emailError: document.getElementById('login-email-error'),
      sendButton: document.getElementById('login-send-btn'),
      codeForm: document.getElementById('login-code-form'),
      codeInput: document.getElementById('login-code'),
      codeError: document.getElementById('login-code-error'),
      fieldIcon: document.getElementById('login-field-icon'),
      success: document.getElementById('login-success'),
      verifyButton: document.getElementById('login-verify-btn'),
      resendButton: document.getElementById('login-resend-btn'),
      resendLine: document.getElementById('login-resend-btn') ? document.getElementById('login-resend-btn').closest('.login-hint') : null,
      changeButton: document.getElementById('login-change-btn')
    };
    if (!elements.emailForm || !elements.codeForm) return;

    elements.emailForm.addEventListener('submit', handleSendSubmit);
    elements.codeForm.addEventListener('submit', handleVerifySubmit);
    elements.resendButton.addEventListener('click', handleResend);
    elements.changeButton.addEventListener('click', handleChangeEmail);
    elements.emailInput.addEventListener('input', markInteracted, { once: true });
    // A fresh entry is not the rejected one — the same rule the cell input
    // gets below, for the plain field.
    elements.emailInput.addEventListener('input', function () {
      setInvalid(elements.emailInput, false);
    });
    // A fresh entry is not the rejected one, so the red cells and aria-invalid
    // must not survive it. cell-input:change fires on the block, including from
    // clearCode() above.
    const codeBlock = elements.codeInput.closest('.cell-input');
    if (codeBlock) {
      codeBlock.addEventListener('cell-input:change', function () {
        setInvalid(elements.codeInput, false);
      });
    }

    redirectIfSignedIn();
  }

  // Back to this page from the one a sign-in led to: the browser restores it
  // from its back-forward cache as it was left, busy, with every submit
  // refused. Clear that, and send a reader who is signed in on again.
  function handlePageShow(event) {
    if (!event.persisted || !elements) return;
    setBusy(false);
    state.interacted = false;
    redirectIfSignedIn();
  }

  document.addEventListener('DOMContentLoaded', initLogin);
  window.addEventListener('pageshow', handlePageShow);
})();
