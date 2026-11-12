/**
 * header-account.js — the header's account menu. v1.4.0
 *
 * Fills the avatar and the identity row from the session, and signs out. The
 * markup is emitted by nav.js beside the site header, `hidden` until a
 * session is confirmed: the public pages (login, support, access denied)
 * render the same header signed out and must show no avatar, and a gated
 * page must not flash an empty circle while the session is fetched.
 *
 * Runs once per document. The header sits outside the Barba container, so
 * nothing here is torn down on a page swap and there is nothing to re-init
 * on bd:after-nav. The deferred nav.js has already injected the header by
 * the time DOMContentLoaded fires.
 *
 * Sign-out posts Better Auth's route and, once it answers, sends the reader
 * to the login page. A page that wants a plain link signs out with the
 * engine's GET link instead (window.bdPaths.signOut), which needs no script.
 * The addresses are the engine's, from window.bdPaths (nav.js), the same on
 * every site.
 *
 * It is also the page's one session check, so it publishes the answer rather
 * than letting a second module ask again — every call costs a rate-limit
 * read and write in D1, signed in or not. On a 200 it sets window.bdSession
 * - { signedIn, role, scopes, email, name }, the role resolved by the Worker
 * (admin, team or guest) and the scopes a guest's groups grant - dispatches
 * `bd:session` with the same, and leaves a one-word hint in localStorage
 * (the role, or `out`) that the template's pre-paint script reads on the
 * next page, so a signed-in reader is not shown the locked sidebar while
 * this fetch is out and admin links are hidden before paint for everyone
 * else. nav.js is the consumer. A failed check publishes nothing: whatever
 * the page started as, it stays.
 */
(function () {
  'use strict';

  var VERSION = '1.4.0';

  var SESSION_URL = '/api/auth/get-session';
  var SIGN_OUT_URL = '/api/auth/sign-out';
  // Read by the inline script in cms/generator/template.html, and also
  // written by auth-login.js, which runs on a page without this module —
  // keep all three in step.
  var HINT_KEY = 'bd-session-hint';

  // The engine's login page (window.bdPaths, written first by nav.js)
  function loginPath() {
    return window.bdPaths && window.bdPaths.login;
  }

  var COPY = {
    busy: 'Signing out\u2026',
    offline: 'Could not reach the server. Check your connection and try again.',
    failed: 'Sign-out did not complete. Try again in a moment.'
  };

  /* ------ Identity ------ */

  // The first character as a whole: charAt(0) on a name that starts outside
  // the BMP — an emoji, a rare CJK letter — returns half a surrogate pair,
  // which paints as U+FFFD.
  function firstChar(text) {
    var code = text.charCodeAt(0);
    return code >= 0xD800 && code <= 0xDBFF ? text.slice(0, 2) : text.charAt(0);
  }

  // One or two letters: the first letters of the first two words of the name,
  // or the first letter of the email when there is no name — every account
  // signed up by email code has an empty name until someone sets one. Capped
  // after upper-casing, since a few letters grow ("\u00df" becomes "SS").
  function initials(name, email) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    var letters = words.length
      ? words.slice(0, 2).map(firstChar).join('')
      : firstChar(String(email || ''));
    return letters.toUpperCase().slice(0, 2);
  }

  function fill(root, user) {
    var name = String(user.name || '').trim();
    var email = String(user.email || '').trim();
    var label = name || email;
    // Nothing to show is nothing to reveal: an empty circle labelled
    // "Account, " would be worse than no slot.
    if (!label) return;
    var avatars = root.querySelectorAll('.avatar');
    for (var i = 0; i < avatars.length; i++) avatars[i].textContent = initials(name, email);

    root.querySelector('.header-account-name').textContent = label;
    // With no name the email is the label; a second line saying it again
    // would read as two people.
    var emailLine = root.querySelector('.header-account-email');
    if (emailLine) {
      if (name && email) emailLine.textContent = email;
      else emailLine.parentNode.removeChild(emailLine);
    }

    var trigger = root.querySelector('.dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-label', 'Account, ' + label);
    root.removeAttribute('hidden');
  }

  // The account menu's admin items (People) show for an admin or an owner
  // only. Showing them is convenience, not access: the Worker refuses the
  // pages to anyone else.
  function showAdminItems(root, role) {
    var admin = role === 'admin' || role === 'owner';
    var items = root.querySelectorAll('[data-account-people]');
    for (var i = 0; i < items.length; i++) items[i].hidden = !admin;
  }

  /* ------ Session ------ */

  // The role the Worker resolved (it applies the owner floor; user.role alone
  // does not), else the record's own; anything unknown is a guest, the least
  // access, never the most. Fail closed, like worker/gate.mjs.
  function roleOf(data) {
    var role = data.role || (data.user && data.user.role);
    return role === 'owner' || role === 'admin' || role === 'team' || role === 'guest' ? role : 'guest';
  }

  function publishSession(data) {
    var signedIn = !!(data && data.session && data.user);
    var session = {
      signedIn: signedIn,
      role: signedIn ? roleOf(data) : null,
      scopes: signedIn && Array.isArray(data.scopes) ? data.scopes : [],
      email: signedIn ? String(data.user.email || '').trim().toLowerCase() : '',
      name: signedIn ? String(data.user.name || '').trim() : ''
    };
    window.bdSession = session;
    try { localStorage.setItem(HINT_KEY, signedIn ? session.role : 'out'); } catch (e) { /* storage blocked: the hint is a nicety */ }
    document.dispatchEvent(new CustomEvent('bd:session', { detail: session }));
  }

  function loadSession(root) {
    fetch(SESSION_URL, { credentials: 'same-origin' })
      .then(function (response) {
        // Only a 200 says anything about the session. Anything else — an
        // outage, a page served without the Worker — leaves the slot empty.
        if (!response.ok) throw new Error('session ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var signedIn = !!(data && data.session && data.user);
        publishSession(data);
        if (signedIn) fill(root, data.user);
        // A page restored from the back-forward cache after a sign-out asks
        // again and gets nothing: the avatar it was showing goes.
        else root.setAttribute('hidden', '');
        showAdminItems(root, signedIn ? roleOf(data) : null);
      })
      .catch(function () {
        // Signed-out and unreachable look the same from here: no avatar.
        // Nothing is published, so a public page that painted locked keeps
        // the look; nav.js blocks locked links only once a check has said
        // signed out, so a signed-in reader here is not trapped.
      });
  }

  /* ------ Sign out ------ */

  var busy = false;

  function setBusy(item, on) {
    busy = on;
    // Not `disabled`: that drops focus to <body>. aria-disabled keeps focus
    // where it is, and dropdown.js will not activate a disabled item — see
    // onAccountClick for why that matters. The label says what is happening;
    // .is-loading has no rule on a menu item, so the words are the state.
    item.setAttribute('aria-disabled', on ? 'true' : 'false');
    var label = item.querySelector('span:not(.svg-icn)');
    if (label) label.textContent = on ? COPY.busy : item.getAttribute('data-label');
  }

  function signOut(item) {
    if (busy) return;
    if (!item.getAttribute('data-label')) item.setAttribute('data-label', (item.querySelector('span:not(.svg-icn)') || item).textContent);
    setBusy(item, true);
    fetch(SIGN_OUT_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('sign-out ' + response.status);
        // Full navigation so nothing on the next page still holds the session.
        // The login page never loads this module, so the hint is set here.
        try { localStorage.setItem(HINT_KEY, 'out'); } catch (e) { /* storage blocked */ }
        // With no nav.js on the page there is no address to go to: a reload
        // shows the page signed out instead
        if (loginPath()) window.location.assign(loginPath());
        else window.location.reload();
      })
      .catch(function (error) {
        // A network failure rejects fetch with a TypeError in every browser;
        // the message text differs per browser, so the type is what to check.
        var message = error instanceof TypeError ? COPY.offline : COPY.failed;
        if (typeof window.showToast === 'function') window.showToast(message, 'danger');
        else console.warn('header-account.js: ' + message);
        setBusy(item, false);
      });
  }

  /* ------ Init ------ */

  // Bound on the dropdown, so it runs before dropdown.js's document-level
  // click. That order is the point: the item is marked aria-disabled here,
  // and dropdown.js then declines to activate it — its documented rule for
  // disabled items — so the menu stays OPEN while the request is out, with
  // focus on "Signing out…". On failure the item re-enables in place and the
  // reader can try again without reopening; on success the navigation ends
  // the page. Close the menu here and the state would vanish with it.
  function onAccountClick(event) {
    var item = event.target.closest('[data-account-sign-out]');
    if (item) signOut(item);
  }

  // Back after a successful sign-out can restore this page from the
  // back-forward cache with the busy item and the old avatar intact.
  function onPageShow(event) {
    if (!event.persisted) return;
    var root = document.querySelector('#site-nav .header-account');
    if (!root) return;
    var item = root.querySelector('[data-account-sign-out]');
    if (item && busy) setBusy(item, false);
    loadSession(root);
  }

  function initHeaderAccount() {
    var root = document.querySelector('#site-nav .header-account');
    if (!root || root.dataset.accountInit) return;
    root.dataset.accountInit = 'true';
    // Opening, closing and focus are dropdown.js's, delegated from document.
    // Only the sign-out item is this module's.
    root.addEventListener('click', onAccountClick);
    window.addEventListener('pageshow', onPageShow);
    loadSession(root);
    console.log('header-account.js v' + VERSION + ' initialised');
  }

  document.addEventListener('DOMContentLoaded', initHeaderAccount);
})();
