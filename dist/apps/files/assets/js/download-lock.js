/**
 * download-lock.js — the tools' one download lock
 *
 * A tool page's container carries data-download-access, the level its
 * downloads need: the app's `downloadAccess:` frontmatter, or its `access:`
 * when it says nothing (cms/generator/generate-docs.js). Every control in it
 * marked data-download (each tool's Download verb) or data-download-lock (the
 * Copy that puts the same file on the clipboard, community-access-plan.md
 * D12: a marker of its own, because copy-button.js treats data-download as
 * a download) is locked for a reader who
 * cannot reach that level: .is-locked, the lock icon in the download icon's
 * place, the reason as its tooltip and its description, and a press opens
 * one shared dialog instead of the tool's handler (community-access-plan.md
 * D14). The lock is an invitation, not secrecy: "Make this tool your own",
 * Book a walkthrough first, then the reader's own way in (Sign in for a
 * signed-out reader, Ask for access for a guest). A team member before an
 * admin level gets the reason and nothing to sell.
 *
 * A locked control stays operable, never aria-disabled: it does something
 * (opens the dialog), so it says so. aria-haspopup="dialog" announces what a
 * press opens, the description carries the reason, and Enter, Space and a
 * click all reach it as a button. aria-disabled on a control that still acts
 * would tell a screen reader the press does nothing.
 *
 * The rule mirrors authorise() in worker/gate.mjs, as nav.js's canOpen does,
 * with one difference: a public level opens for a signed-out reader here,
 * since a public tool's own file is the point of its being public. The
 * Worker still gates /files/; for a tool that makes its file in the browser
 * this is the only check, which is why the press is caught in capture, on
 * the document, before the tool's own handler can run.
 *
 * aria-disabled stays the tool's own (the Asset Library's "nothing chosen"):
 * a control the tool has disabled answers a press with nothing, locked or
 * not, and never opens the dialog.
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
 * and on bd:after-nav, scoped to the arriving container, and on
 * bd:download-lock, which a tool sends after it changes a control's level.
 *
 * A control may carry its own data-download-access, over its container's:
 * the Asset Library sets each file's level on its Download (D13). Or it names
 * the asset it takes (data-download-asset), and the container's
 * data-asset-access, from the app's `assetAccess:` frontmatter, gives that
 * asset's level: the Logo Tool's variants and the Icon Library's icons.
 * window.bdDownloadLock.canDownload(level) answers the same question for a
 * tool that needs it for something other than a control (a thumbnail).
 *
 * @version 1.6.0
 */
(function () {
  'use strict';

  var VERSION = '1.6.0';
  var CONTROL = '[data-download], [data-download-lock]';
  var LOCKED = '[data-download].is-locked, [data-download-lock].is-locked';
  var CONTAINER = '[data-download-access]';
  // Each locked control's own description, a visually hidden span beside it
  // (download-lock-note-<n>), so two controls at different levels never
  // share a reason.
  var NOTE_PREFIX = 'download-lock-note-';
  var noteCount = 0;
  var GUESTS_NONE = '[data-download-guests="none"]';
  var DIALOG_ID = 'download-lock-dialog';
  // The booking page is By Default OS's own (a bare page, not the engine's):
  // where it is built, the dialog sells the walkthrough; elsewhere it offers
  // the reader's way in and nothing more.
  var DEMO_PATH = '/book-a-demo.html';
  // The way in, the engine's on every site: the login page for a signed-out
  // reader, Ask for access for a guest (window.bdPaths, written by nav.js).
  // Read at the press, not at load. A page without nav.js still has the
  // engine's fixed addresses (PD-2), so a locked control is never a dead one.
  var ENGINE_PATHS = { login: '/auth/login.html', support: '/support.html' };
  function paths() {
    var own = window.bdPaths || {};
    var bare = Array.isArray(own.bare) ? own.bare : [];
    return {
      login: own.login || ENGINE_PATHS.login,
      support: own.support || ENGINE_PATHS.support,
      demo: bare.indexOf(DEMO_PATH) !== -1 ? DEMO_PATH : ''
    };
  }
  // The reason, the tooltip and the description alike, built from the
  // control's own resolved level and its verb, never from the reader's role
  // alone (a11y review, 2026-11-21): a community reader before an admin
  // asset hears "for admins", not "for the team". Then the reader's way in:
  // Sign in when signed out; Ask for access for a guest only where a group
  // could grant the level (community, D9) and the part takes guests at all.
  function verbOf(control) {
    return control.hasAttribute('data-download-lock') ? 'Copying and downloading' : 'Downloading';
  }
  function reasonFor(control, role, level, guestsAllowed) {
    var verb = verbOf(control);
    var base = verb + ' ' + (verb === 'Downloading' ? 'is' : 'are') + ' for ' + whoFor(level);
    if (role === 'out') return base + '. Sign in';
    if (role !== 'out' && !access().isInternal(role) && guestsAllowed && access().isExternal(level)) return base + '. Ask for access';
    return base;
  }

  console.log('[download-lock] v' + VERSION + ' loaded');

  // The site's roles and the gate's rule (window.bdAccess, written by nav.js,
  // which loads first). Read at the call, never cached: nav.js may land later
  // on a page this script was loaded into by hand.
  // Without nav.js (a page that loads this alone, or a browser still holding
  // an older nav.js) the lock fails closed: only public opens, and the owner.
  var CLOSED = {
    opens: function () { return false; },
    byRank: function (role, level) { return level === 'public' || role === 'owner'; },
    isExternal: function (level) { return level === 'public' || level === 'community'; },
    isInternal: function (key) { return key === 'owner' || key === 'admin' || key === 'team'; },
    isLevel: function () { return true; },
    label: function (key) { return key ? key.charAt(0).toUpperCase() + key.slice(1) : ''; },
    defaultLevel: 'team',
    lowestRole: 'guest',
    normaliseRole: function (role) { return typeof role === 'string' && role ? role : 'guest'; }
  };
  function access() {
    return window.bdAccess || CLOSED;
  }

  // The reader: 'out' or one of the site's roles, with their groups' scopes.
  // Before the session answer, the pre-paint hint, which knows the role but
  // not a guest's scopes; with no hint at all, nothing is painted (null).
  function readerState() {
    var s = window.bdSession;
    if (s) {
      if (!s.signedIn) return { role: 'out', scopes: [] };
      return { role: access().normaliseRole(s.role), scopes: Array.isArray(s.scopes) ? s.scopes : [] };
    }
    var body = document.body;
    if (!body) return null;
    if (body.classList.contains('is-signed-out')) return { role: 'out', scopes: [] };
    var hinted = body.getAttribute('data-role');
    // A hinted guest is locked with no scopes until the answer says what
    // their groups grant: a file a guest should not have must not slip
    // out in the round trip, or for good when the answer never comes.
    if (hinted && access().normaliseRole(hinted) === hinted) return { role: hinted, scopes: [] };
    return null;
  }

  // The second question, as the Worker asks it, for a file rather than a
  // page: public is for everyone, signed in or not; a reader takes what
  // their role reaches; an outsider also takes what their groups grant at an
  // external level. Internal downloads are the role's alone: the Worker's
  // mayDownload reads no grant, so a grant must not look like it opens one
  // (community-access-plan.md D-l, D9).
  function canDownload(reader, level, p) {
    if (level === 'public') return true;
    if (reader.role === 'out') return false;
    if (access().byRank(reader.role, level)) return true;
    if (level === 'owner' || access().isInternal(level) || access().isInternal(reader.role)) return false;
    return access().opens(reader.role, reader.scopes, level, p);
  }

  // The control's own visually hidden description, beside it in the DOM
  // (outside it, so it is the description and not part of the name).
  function noteFor(control) {
    var id = control.getAttribute('data-lock-note');
    var note = id ? document.getElementById(id) : null;
    if (!note) {
      id = NOTE_PREFIX + (++noteCount);
      note = document.createElement('span');
      note.id = id;
      note.className = 'visually-hidden';
      note.setAttribute('data-download-lock-note', '');
      control.parentNode.insertBefore(note, control.nextSibling);
      control.setAttribute('data-lock-note', id);
    }
    return note;
  }

  function describedBy(control, noteId) {
    var ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (id) { return id && id.indexOf(NOTE_PREFIX) !== 0; });
    if (noteId) ids.push(noteId);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
  }

  // ", locked" after the visible text, inside the name (WCAG 2.5.3: the
  // visible label still starts the name), so the state is heard with it.
  function lockedSuffix(control, on) {
    var suffix = control.querySelector('[data-download-lock-suffix]');
    if (!on) {
      if (suffix) suffix.parentNode.removeChild(suffix);
      return;
    }
    if (suffix) return;
    suffix = document.createElement('span');
    suffix.className = 'visually-hidden';
    suffix.setAttribute('data-download-lock-suffix', '');
    suffix.textContent = ', locked';
    (control.querySelector('.copy-btn-default') || control).appendChild(suffix);
  }

  // A control its tool has disabled (nothing chosen) opens nothing, so it
  // must not announce a dialog: it keeps the reason and loses the popup.
  function toolDisabled(control) {
    return control.getAttribute('aria-disabled') === 'true' || control.disabled === true;
  }

  function lock(control, role, level, guestsAllowed) {
    var reason = reasonFor(control, role, level, guestsAllowed);
    control.classList.add('is-locked');
    control.setAttribute('data-locked-for', role);
    control.setAttribute('data-locked-level', level);
    // The original is parked so an unlock restores it exactly, and a second
    // lock does not park the locked words.
    if (!control.hasAttribute('data-tooltip-default')) control.setAttribute('data-tooltip-default', control.getAttribute('data-tooltip') || '');
    control.setAttribute('data-tooltip', reason);
    if (toolDisabled(control)) control.removeAttribute('aria-haspopup');
    else control.setAttribute('aria-haspopup', 'dialog');
    var note = noteFor(control);
    note.textContent = reason + '.';
    describedBy(control, note.id);
    lockedSuffix(control, true);
  }

  function unlock(control) {
    if (!control.classList.contains('is-locked')) return;
    control.classList.remove('is-locked');
    control.removeAttribute('data-locked-for');
    control.removeAttribute('data-locked-level');
    var parked = control.getAttribute('data-tooltip-default');
    if (parked) control.setAttribute('data-tooltip', parked);
    else control.removeAttribute('data-tooltip');
    control.removeAttribute('data-tooltip-default');
    control.removeAttribute('aria-haspopup');
    var id = control.getAttribute('data-lock-note');
    var note = id && document.getElementById(id);
    if (note) note.parentNode.removeChild(note);
    control.removeAttribute('data-lock-note');
    describedBy(control, '');
    lockedSuffix(control, false);
  }

  // The level the container's assetAccess map gives the asset this control
  // takes, or '' for none. A map that is there but broken, or a level that
  // is not one, fails closed to admin: the build validates the map, so
  // this only happens when the page was tampered with.
  function assetLevel(container, control) {
    var asset = control.getAttribute('data-download-asset');
    var raw = container.getAttribute('data-asset-access');
    if (!asset || !raw) return '';
    var map;
    try { map = JSON.parse(raw); } catch (err) { return 'admin'; }
    if (!map || typeof map !== 'object') return 'admin';
    if (!Object.prototype.hasOwnProperty.call(map, asset)) return '';
    return access().isLevel(map[asset]) ? map[asset] : 'admin';
  }

  function apply(scope) {
    var reader = readerState();
    if (!reader) return;
    var root = scope && scope.querySelectorAll ? scope : document;
    var containers = root.matches && root.matches(CONTAINER) ? [root] : root.querySelectorAll(CONTAINER);
    var here = window.location.pathname;
    Array.prototype.forEach.call(containers, function (container) {
      var level = container.getAttribute('data-download-access') || access().defaultLevel;
      // A part marked for no guests is closed to the lowest role (guest on By Default)
      var noGuests = reader.role === access().lowestRole && (container.matches(GUESTS_NONE) || !!container.querySelector(GUESTS_NONE));
      var controls = container.querySelectorAll(CONTROL);
      if (!controls.length) return;
      Array.prototype.forEach.call(controls, function (control) {
        var own = control.getAttribute('data-download-access') || assetLevel(container, control) || level;
        if (noGuests || !canDownload(reader, own, here)) lock(control, reader.role, own, !noGuests);
        else unlock(control);
      });
    });
  }

  // Capture, on the document: the press never reaches the tool's handler,
  // and opens the dialog instead. A control its tool has disabled (nothing
  // chosen) answers with nothing, as it would unlocked.
  function handleClick(event) {
    var target = event.target;
    var control = target && target.closest ? target.closest(LOCKED) : null;
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (control.getAttribute('aria-disabled') === 'true') return;
    openDialog(control);
  }

  // Who the locked level is for, in the reader's words.
  function whoFor(level) {
    if (level === 'owner') return 'owners';
    if (level === 'admin') return 'admins';
    if (level === 'team') return 'the team';
    if (access().isExternal(level)) return access().label(level) + ' members';
    return 'the ' + access().label(level) + ' role';
  }

  function closeIcon() {
    var icons = window.bdIcons || {};
    return icons.close || '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  // One dialog for the page, on the body, outside the router's container,
  // so a page swap never takes it mid-open. Built once, refilled per press.
  function dialogEl() {
    var dialog = document.getElementById(DIALOG_ID);
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', DIALOG_ID + '-title');
    dialog.setAttribute('aria-describedby', DIALOG_ID + '-body');
    dialog.innerHTML =
      '<div class="dialog-header">' +
        '<h2 class="dialog-title" id="' + DIALOG_ID + '-title"></h2>' +
        '<button class="button close-btn" type="button" data-icon-only data-size="small" data-dialog-close aria-label="Close">' +
          '<span class="svg-icn" data-icon="close">' + closeIcon() + '</span></button>' +
      '</div>' +
      '<div class="dialog-body" id="' + DIALOG_ID + '-body"></div>' +
      '<div class="dialog-footer"></div>';
    // Close is dialog.js's job where it is loaded (data-dialog-close); a page
    // without it still closes its own dialog.
    dialog.addEventListener('click', function handleCloseFallback(event) {
      if (typeof window.bdOpenSurface === 'function') return;
      if (event.target.closest && event.target.closest('[data-dialog-close]')) dialog.close();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function linkButton(label, href, primary) {
    var a = document.createElement('a');
    a.className = 'button';
    if (!primary) a.setAttribute('data-variant', 'outline');
    a.href = href;
    a.textContent = label;
    return a;
  }

  // The words and the ways in, for this reader and this control.
  function dialogContent(control) {
    var role = control.getAttribute('data-locked-for');
    var level = control.getAttribute('data-locked-level') || access().defaultLevel;
    var container = control.closest(CONTAINER);
    var tool = (container && container.getAttribute('data-tool-name')) || 'tool';
    var verb = control.hasAttribute('data-download-lock') ? 'Copying and downloading' : 'Downloading';
    var way = paths();
    // A team member before an admin file: the reason, and nothing to sell.
    if (access().isInternal(role)) {
      return { title: 'This one is for ' + whoFor(level), body: [verb + ' this in the ' + tool + ' is for ' + whoFor(level) + '.'], actions: [] };
    }
    var body = [verb + ' in the ' + tool + ' ' + (verb === 'Downloading' ? 'is' : 'are') + ' for ' + whoFor(level) + '.'];
    var actions = [];
    if (way.demo) {
      body.push('Your brand can have its own ' + tool + ', with your logos, icons and rules built in.');
      actions.push(linkButton('Book a walkthrough', way.demo + '?from=' + encodeURIComponent(window.location.pathname), true));
    }
    if (role === 'out') {
      actions.push(linkButton('Sign in', way.login + '?next=' + encodeURIComponent(window.location.pathname + window.location.search), !way.demo));
    } else if (role === access().lowestRole || access().isExternal(level)) {
      // A guest, or an outsider below an external level a group could grant
      actions.push(linkButton('Ask for access', way.support + '?from=' + encodeURIComponent(window.location.pathname), !way.demo));
    }
    return { title: way.demo ? 'Make this tool your own' : 'This is locked', body: body, actions: actions };
  }

  function openDialog(control) {
    var dialog = dialogEl();
    var content = dialogContent(control);
    dialog.querySelector('.dialog-title').textContent = content.title;
    var body = dialog.querySelector('.dialog-body');
    body.textContent = '';
    content.body.forEach(function (text) {
      var p = document.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    });
    var footer = dialog.querySelector('.dialog-footer');
    footer.textContent = '';
    content.actions.forEach(function (action) { footer.appendChild(action); });
    footer.hidden = content.actions.length === 0;
    // Focus lands on the first way in, or on Close when there is none.
    var first = footer.querySelector('a') || dialog.querySelector('[data-dialog-close]');
    Array.prototype.forEach.call(dialog.querySelectorAll('[autofocus]'), function (el) { el.removeAttribute('autofocus'); });
    first.setAttribute('autofocus', '');
    // showModal() records the control and close() gives focus back to it;
    // the close listener below covers a browser or a test that does not.
    dialog.__bdReturn = control;
    if (typeof window.bdOpenSurface === 'function') window.bdOpenSurface(dialog);
    else if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (document.activeElement !== first) first.focus();
  }

  function handleDialogClose(event) {
    var dialog = event.target;
    if (!dialog || dialog.id !== DIALOG_ID) return;
    var back = dialog.__bdReturn;
    dialog.__bdReturn = null;
    if (back && back.isConnected && document.activeElement !== back) back.focus();
  }

  // The other ways a link gets followed: middle-click, a drag to the
  // desktop, the context menu's Save link as.
  function handleBypass(event) {
    var target = event.target;
    if (target && target.closest && target.closest(LOCKED)) event.preventDefault();
  }

  function handleSession() {
    apply();
  }

  // A page swap with the dialog open (Back) leaves it naming the last tool:
  // it closes with the page that opened it.
  function handleAfterNav(event) {
    var dialog = document.getElementById(DIALOG_ID);
    if (dialog && dialog.hasAttribute('open')) {
      if (typeof window.bdCloseSurface === 'function') window.bdCloseSurface(dialog);
      else dialog.close();
    }
    apply(event.detail && event.detail.container);
  }

  function handleDomReady() {
    apply();
  }

  document.addEventListener('click', handleClick, true);
  document.addEventListener('close', handleDialogClose, true);
  document.addEventListener('auxclick', handleBypass, true);
  document.addEventListener('dragstart', handleBypass, true);
  document.addEventListener('contextmenu', handleBypass, true);
  document.addEventListener('bd:session', handleSession);
  document.addEventListener('bd:after-nav', handleAfterNav);
  document.addEventListener('bd:download-lock', handleSession);
  // For a tool's other uses of the same answer. null reader (no session
  // answer and no hint yet) answers true: the Worker refuses what it must,
  // and a thumbnail held back for everyone until the answer would flash.
  window.bdDownloadLock = {
    canDownload: function (level) {
      var reader = readerState();
      return !reader || canDownload(reader, level, window.location.pathname);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    apply();
  }
})();
