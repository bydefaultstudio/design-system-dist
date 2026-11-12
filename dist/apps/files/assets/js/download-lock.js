/**
 * download-lock.js — the tools' one download lock
 *
 * A tool page's container carries data-download-access, the level its
 * downloads need: the app's `downloadAccess:` frontmatter, or its `access:`
 * when it says nothing (cms/generator/generate-docs.js). Every control in it
 * marked data-download (each tool's Download verb) is locked for a reader who
 * cannot reach that level: .is-locked, aria-disabled, the lock icon in the
 * download icon's place, the reason as its tooltip and its description, and
 * a press goes to the way in instead of the tool's handler - the login for a
 * signed-out reader, Ask for access for a guest. A team member before an
 * admin level gets the words and nothing else.
 *
 * The rule mirrors authorise() in worker/gate.mjs, as nav.js's canOpen does,
 * with one difference: a public level opens for a signed-out reader here,
 * since a public tool's own file is the point of its being public. The
 * Worker still gates /files/; for a tool that makes its file in the browser
 * this is the only check, which is why the press is caught in capture, on
 * the document, before the tool's own handler can run.
 *
 * aria-disabled is shared with a tool that manages it on its own Download
 * (the Asset Library): the lock sets it only where the tool has not, and
 * marks that it did (data-locked-disabled), so an unlock takes back only its
 * own; a tool that sets it for its own reason clears the mark, and never
 * takes it away while .is-locked (asset-library.js, setDownloadDisabled).
 *
 * A file the Worker serves (the Asset Library's /files/) is never a
 * guest's: no grant reaches /files/, so a container part that says
 * data-download-guests="none" locks a guest whatever their scopes, and the
 * lock matches the 403 they would get. A locked link keeps its href, so it
 * stays focusable and announced as a link, but a middle-click, a drag and
 * the context menu (Save link as) are refused on it, so none of them takes
 * the file round the lock.
 *
 * The reader comes from header-account.js: body.is-signed-out and
 * body[data-role] before paint, window.bdSession and bd:session once the
 * answer lands. Delegated listeners; the locks are re-applied on bd:session
 * and on bd:after-nav, scoped to the arriving container.
 *
 * @version 1.3.1
 */
(function () {
  'use strict';

  var VERSION = '1.3.1';
  var CONTROL = '[data-download]';
  var CONTAINER = '[data-download-access]';
  var NOTE_ID = 'download-lock-note';
  var GUESTS_NONE = '[data-download-guests="none"]';
  // The way in, the engine's on every site: the login page for a signed-out
  // reader, Ask for access for a guest (window.bdPaths, written by nav.js).
  // Read at the press, not at load. A page without nav.js still has the
  // engine's fixed addresses (PD-2), so a locked control is never a dead one.
  var ENGINE_PATHS = { login: '/auth/login.html', support: '/support.html' };
  function paths() {
    var own = window.bdPaths || {};
    return { login: own.login || ENGINE_PATHS.login, support: own.support || ENGINE_PATHS.support };
  }
  // One line each, the tooltip and the description: what stands between
  // the reader and the file, and where a press goes.
  var REASONS = {
    out: 'Log in to download',
    guest: 'Downloads are for the team. Ask for access',
    team: 'Downloads are for admins'
  };

  console.log('[download-lock] v' + VERSION + ' loaded');

  // The reader: 'out', 'guest', 'team', 'admin' or 'owner' with a guest's scopes.
  // Before the session answer, the pre-paint hint, which knows the role but
  // not a guest's scopes; with no hint at all, nothing is painted (null).
  function readerState() {
    var s = window.bdSession;
    if (s) {
      if (!s.signedIn) return { role: 'out', scopes: [] };
      var role = s.role === 'owner' || s.role === 'admin' || s.role === 'team' || s.role === 'guest' ? s.role : 'guest';
      return { role: role, scopes: Array.isArray(s.scopes) ? s.scopes : [] };
    }
    var body = document.body;
    if (!body) return null;
    if (body.classList.contains('is-signed-out')) return { role: 'out', scopes: [] };
    var hinted = body.getAttribute('data-role');
    // A hinted guest is locked with no scopes until the answer says what
    // their groups grant: a file a guest should not have must not slip
    // out in the round trip, or for good when the answer never comes.
    if (hinted === 'owner' || hinted === 'admin' || hinted === 'team' || hinted === 'guest') return { role: hinted, scopes: [] };
    return null;
  }

  function folderOf(p) {
    var m = /^\/([a-z0-9-]+)\/[^/]+$/.exec(p);
    return m ? m[1] : '';
  }

  // The second question, as the Worker asks it, for a file rather than a
  // page: public is for everyone, signed in or not; an admin takes
  // everything; an admin level is for no one else; the team takes the
  // rest; a guest takes what their groups grant, the page or its section.
  function canDownload(reader, level, p) {
    if (level === 'public') return true;
    if (reader.role === 'out') return false;
    if (reader.role === 'owner') return true;
    if (level === 'owner') return false;
    if (reader.role === 'admin') return true;
    if (level === 'admin') return false;
    if (reader.role === 'team') return true;
    var folder = folderOf(p);
    for (var i = 0; i < reader.scopes.length; i++) {
      if (reader.scopes[i] === 'page:' + p) return true;
      if (folder && reader.scopes[i] === 'section:' + folder) return true;
    }
    return false;
  }

  // One visually hidden note per container, the description every locked
  // control in it points at, so a screen reader hears the reason.
  function noteFor(container) {
    var note = container.querySelector('#' + NOTE_ID);
    if (!note) {
      note = document.createElement('span');
      note.id = NOTE_ID;
      note.className = 'visually-hidden';
      container.appendChild(note);
    }
    return note;
  }

  function describedBy(control, add) {
    var ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (id) { return id && id !== NOTE_ID; });
    if (add) ids.push(NOTE_ID);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
  }

  function lock(control, role) {
    control.classList.add('is-locked');
    control.setAttribute('data-locked-for', role);
    // The original is parked so an unlock restores it exactly, and a second
    // lock does not park the locked words.
    if (!control.hasAttribute('data-tooltip-default')) control.setAttribute('data-tooltip-default', control.getAttribute('data-tooltip') || '');
    control.setAttribute('data-tooltip', REASONS[role]);
    // aria-disabled is set only where the tool has not: the Asset Library
    // owns it for "nothing chosen", and an unlock must not take that away.
    if (control.getAttribute('aria-disabled') !== 'true') {
      control.setAttribute('aria-disabled', 'true');
      control.setAttribute('data-locked-disabled', '1');
    }
    describedBy(control, true);
  }

  function unlock(control) {
    if (!control.classList.contains('is-locked')) return;
    control.classList.remove('is-locked');
    control.removeAttribute('data-locked-for');
    var parked = control.getAttribute('data-tooltip-default');
    if (parked) control.setAttribute('data-tooltip', parked);
    else control.removeAttribute('data-tooltip');
    control.removeAttribute('data-tooltip-default');
    if (control.getAttribute('data-locked-disabled') === '1') {
      control.removeAttribute('aria-disabled');
      control.removeAttribute('data-locked-disabled');
    }
    describedBy(control, false);
  }

  function apply(scope) {
    var reader = readerState();
    if (!reader) return;
    var root = scope && scope.querySelectorAll ? scope : document;
    var containers = root.matches && root.matches(CONTAINER) ? [root] : root.querySelectorAll(CONTAINER);
    var here = window.location.pathname;
    Array.prototype.forEach.call(containers, function (container) {
      var level = container.getAttribute('data-download-access') || 'team';
      var noGuests = reader.role === 'guest' && (container.matches(GUESTS_NONE) || !!container.querySelector(GUESTS_NONE));
      var locked = noGuests || !canDownload(reader, level, here);
      var controls = container.querySelectorAll(CONTROL);
      if (!controls.length) return;
      noteFor(container).textContent = locked ? REASONS[reader.role] + '.' : '';
      Array.prototype.forEach.call(controls, function (control) {
        if (locked) lock(control, reader.role);
        else unlock(control);
      });
    });
  }

  // Capture, on the document: the press never reaches the tool's handler,
  // and goes to the way in instead.
  function handleClick(event) {
    var target = event.target;
    var control = target && target.closest ? target.closest(CONTROL + '.is-locked') : null;
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var role = control.getAttribute('data-locked-for');
    var way = paths();
    if (role === 'out') {
      window.location.assign(way.login + '?next=' + encodeURIComponent(window.location.pathname + window.location.search));
    } else if (role === 'guest') {
      window.location.assign(way.support + '?from=' + encodeURIComponent(window.location.pathname));
    }
  }

  // The other ways a link gets followed: middle-click, a drag to the
  // desktop, the context menu's Save link as.
  function handleBypass(event) {
    var target = event.target;
    if (target && target.closest && target.closest(CONTROL + '.is-locked')) event.preventDefault();
  }

  function handleSession() {
    apply();
  }

  function handleAfterNav(event) {
    apply(event.detail && event.detail.container);
  }

  function handleDomReady() {
    apply();
  }

  document.addEventListener('click', handleClick, true);
  document.addEventListener('auxclick', handleBypass, true);
  document.addEventListener('dragstart', handleBypass, true);
  document.addEventListener('contextmenu', handleBypass, true);
  document.addEventListener('bd:session', handleSession);
  document.addEventListener('bd:after-nav', handleAfterNav);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    apply();
  }
})();
