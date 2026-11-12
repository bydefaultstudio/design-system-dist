/**
 * people.js - the People page (/docs/people.html, cms/apps/people.html). v1.1.0
 *
 * Fills the two tables from /api/people/ and owns the dialogs: Add people,
 * Edit person (role, groups, expiry, demo, note, Resend invite, Lift lockout,
 * Remove),
 * Add or edit a group, and one confirmation for the destructive actions.
 * Every write goes to worker/people.js; the page never decides anything
 * about access, it shows the list and sends what the admin asked for.
 *
 * Scoped to the tool's container ([data-tool="people"], written by the
 * generator) and idempotent: initPeople runs on load and after every Barba
 * navigation (it starts itself: startPeople), and bails when the page is not this one or
 * is already bound. Rows are built with DOM calls, never innerHTML - an
 * email address or a note is the reader's text, not markup.
 */
(function () {
  'use strict';

  var VERSION = '1.2.0';
  var API = '/api/people/';

  var ROLE_LABELS = { owner: 'Owner', admin: 'Admin', team: 'Team', guest: 'Guest' };
  var STATUS_COLOURS = { invited: 'info', active: 'success', expiring: 'warning', expired: 'danger' };

  var COPY = {
    loading: 'Loading the people who can sign in.',
    loadFailed: 'The list could not be loaded. Reload the page to try again.',
    forbidden: 'This page is for admins.',
    readOnly: 'Only an owner edits this row',
    offline: 'No connection. Try again.',
    failed: 'Something went wrong on our side. Try again.',
    saved: 'Saved. The change takes effect within five minutes.',
    savedSignedOut: 'Saved. They are signed out and sign in again with the new role.',
    removed: 'Removed. Their access ends now.',
    resent: 'Invite sent again.',
    unlocked: 'Lockout lifted. They can ask for a new code now.',
    groupSaved: 'Group saved. Its guests see the change within five minutes.',
    groupRemoved: 'Group deleted.',
    never: 'Never',
    none: '-',
    noGroups: 'No groups yet. Without one, a guest opens only the public pages and the indexes.',
    confirmRemove: function (email) { return email + ' comes off the list and is signed out everywhere. You can add them again later.'; },
    confirmGroup: function (name, members) {
      return 'The ' + name + ' group goes' + (members ? ', and its ' + members + (members === 1 ? ' member loses' : ' members lose') + ' the pages it opens' : '') + '.';
    }
  };

  // `data` starts as an empty answer rather than null, so a dialog opened
  // before the list has loaded, or after it failed, renders empty lists
  // instead of throwing in a click handler.
  var EMPTY = { viewer: { email: '' }, people: [], groups: [], sections: [], pages: [] };
  var state = { root: null, data: EMPTY, editing: null, editingGroup: null, busy: false, confirm: null };

  /* ------ Utilities ------ */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key];
        else if (key === 'class') node.className = attrs[key];
        else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function byId(id) {
    return state.root.querySelector('#' + id);
  }

  var dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function formatDate(ms) {
    return dateFormat.format(new Date(ms));
  }

  // The <input type="date"> value for a unix timestamp, the UTC day, which
  // is how the API reads one back (the end of that day, UTC).
  function isoDay(unixSeconds) {
    return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : '';
  }

  function firstChar(text) {
    var code = text.charCodeAt(0);
    return code >= 0xD800 && code <= 0xDBFF ? text.slice(0, 2) : text.charAt(0);
  }

  // The same rule header-account.js uses for the header's avatar.
  function initials(name, email) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    var letters = words.length ? words.slice(0, 2).map(firstChar).join('') : firstChar(String(email || ''));
    return letters.toUpperCase().slice(0, 2);
  }

  function toast(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type || 'default');
    else console.log('people.js: ' + message);
  }

  function request(path, body) {
    var options = { credentials: 'same-origin', headers: {} };
    if (body) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(API + path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function errorMessage(result) {
    if (result.data && result.data.error) return result.data.error;
    return COPY.failed;
  }

  // The error line carries the words; the field it is about carries the
  // state and is described by the line, as the login page does.
  function markInvalid(field, errorEl, invalid) {
    if (!field) return;
    if (invalid) {
      field.classList.add('is-error');
      field.setAttribute('aria-invalid', 'true');
      var described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (described.indexOf(errorEl.id) === -1) described.push(errorEl.id);
      field.setAttribute('aria-describedby', described.join(' '));
    } else {
      field.classList.remove('is-error');
      field.removeAttribute('aria-invalid');
    }
  }

  function setBusy(button, busy) {
    state.busy = busy;
    if (!button) return;
    button.classList.toggle('is-loading', busy);
    if (busy) {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-busy', 'true');
    } else {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-busy');
    }
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    if (typeof window.bdRequestClose === 'function') window.bdRequestClose(dialog, 'programmatic');
    else dialog.close();
  }

  // Through dialog.js when it is there, so a dialog reopened while its exit
  // still plays comes back instead of finishing its close.
  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof window.bdOpenSurface === 'function') window.bdOpenSurface(dialog);
    else if (!dialog.open) dialog.showModal();
  }

  // A close plays its exit first, so the dialog is still open for a moment
  // after closeDialog. A dialog opened from it must wait for the close, or it
  // stacks over the closing one and focus returns into a closed dialog.
  function afterClosed(dialog, next) {
    if (!dialog || !dialog.open) {
      next();
      return;
    }
    dialog.addEventListener('close', next, { once: true });
  }

  function groupName(id) {
    var group = (state.data.groups || []).find(function (g) { return g.id === id; });
    return group ? group.name : id;
  }

  function sectionLabel(folder) {
    var section = (state.data.sections || []).find(function (s) { return s.folder === folder; });
    return section ? section.label : folder;
  }

  function pageTitle(path) {
    var page = (state.data.pages || []).find(function (p) { return p.path === path; });
    return page ? page.title : path;
  }

  /* ------ Render ------ */

  function badge(label, colour) {
    var attrs = { class: 'badge', text: label, 'data-case': 'none' };
    if (colour) attrs['data-color'] = colour;
    return el('span', attrs);
  }

  function renderPeople() {
    var rows = byId('people-rows');
    var empty = byId('people-empty');
    var people = state.data.people || [];
    rows.replaceChildren();
    empty.hidden = people.length > 0;

    people.forEach(function (person) {
      var badges = [];
      if (person.demo) badges.push(badge('Demo', 'warning'));
      if (person.locked) badges.push(badge('Locked out', 'danger'));
      var personCell = el('div', { class: 'people-person' }, [
        el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(person.name, person.email) }),
        el('div', { class: 'people-person-text' }, [
          person.name ? el('span', { class: 'people-person-name', text: person.name }) : null,
          el('span', { class: person.name ? 'people-person-email text-size-s text-secondary' : 'people-person-name', text: person.email }),
          badges.length ? el('span', { class: 'people-badges' }, badges) : null
        ])
      ]);
      var groups = (person.groups || []).map(groupName).join(', ') || COPY.none;
      // The owner named in wrangler.jsonc is an owner whatever the row says.
      var role = person.owner ? ROLE_LABELS.owner : (ROLE_LABELS[person.role] || person.role);
      // An admin sees an owner's row read-only (levels-groups-plan.md D24):
      // no Edit, so no dialog whose every save would be refused.
      var action = person.editable === false
        ? el('span', { class: 'text-size-s text-secondary', text: COPY.readOnly })
        : el('button', { type: 'button', class: 'button', 'data-variant': 'outline', 'data-size': 'small', 'data-edit': person.email, 'aria-label': 'Edit ' + person.email, text: 'Edit' });
      var row = el('tr', null, [
        el('td', null, [personCell]),
        el('td', { text: role }),
        el('td', { text: groups }),
        el('td', null, [badge(person.status.label, STATUS_COLOURS[person.status.key])]),
        el('td', { text: person.lastSignIn ? formatDate(person.lastSignIn) : COPY.never }),
        el('td', null, [action])
      ]);
      rows.appendChild(row);
    });
  }

  function grantText(group) {
    var sections = [];
    var pages = [];
    (group.grants || []).forEach(function (scope) {
      if (scope.indexOf('section:') === 0) sections.push(sectionLabel(scope.slice(8)));
      else if (scope.indexOf('page:') === 0) pages.push(pageTitle(scope.slice(5)));
    });
    var parts = [];
    if (sections.length) parts.push(sections.join(', '));
    if (pages.length) parts.push(pages.join(', '));
    return parts.length ? parts.join(' · ') : 'Nothing yet';
  }

  function renderGroups() {
    var rows = byId('people-group-rows');
    var empty = byId('people-groups-empty');
    var groups = state.data.groups || [];
    rows.replaceChildren();
    empty.hidden = groups.length > 0;

    groups.forEach(function (group) {
      var row = el('tr', null, [
        el('td', null, [
          el('div', { class: 'people-person-text' }, [
            el('span', { class: 'people-person-name', text: group.name }),
            group.note ? el('span', { class: 'text-size-s text-secondary', text: group.note }) : null
          ])
        ]),
        el('td', { text: grantText(group) }),
        el('td', { text: String(group.members || 0) }),
        el('td', null, [
          el('button', { type: 'button', class: 'button', 'data-variant': 'outline', 'data-size': 'small', 'data-edit-group': group.id, 'aria-label': 'Edit the ' + group.name + ' group', text: 'Edit' })
        ])
      ]);
      rows.appendChild(row);
    });
  }

  function renderCheckList(container, items, name, selected) {
    container.replaceChildren();
    if (!items.length) {
      container.appendChild(el('p', { class: 'form-hint', text: name === 'groups' ? COPY.noGroups : 'None yet.' }));
      return;
    }
    items.forEach(function (item) {
      var id = container.id + '-' + name + '-' + item.value;
      var input = el('input', { type: 'checkbox', id: id, name: name, value: item.value });
      input.checked = selected.indexOf(item.value) !== -1;
      container.appendChild(el('div', { class: 'form-check' }, [input, el('label', { for: id, text: item.label })]));
    });
  }

  function renderGroupChecks(fieldset, selected) {
    var list = fieldset.querySelector('[data-groups-list]');
    list.id = list.id || (fieldset.closest('dialog').id + '-groups');
    renderCheckList(list, (state.data.groups || []).map(function (g) { return { value: g.id, label: g.name }; }), 'groups', selected);
  }

  function renderPagesSelect(select, selected) {
    select.replaceChildren();
    var bySection = {};
    (state.data.pages || []).forEach(function (page) {
      var key = page.section || '';
      if (!bySection[key]) bySection[key] = [];
      bySection[key].push(page);
    });
    Object.keys(bySection).sort().forEach(function (folder) {
      var group = el('optgroup', { label: folder ? sectionLabel(folder) : 'Other pages' });
      bySection[folder].forEach(function (page) {
        var option = el('option', { value: 'page:' + page.path, text: page.title });
        option.selected = selected.indexOf('page:' + page.path) !== -1;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
  }

  function toggleGroupsField(form) {
    var fieldset = form.querySelector('[data-groups-field]');
    var role = form.querySelector('select[name="role"]').value;
    fieldset.hidden = role !== 'guest';
  }

  function checkedValues(container, name) {
    return Array.prototype.map.call(container.querySelectorAll('input[name="' + name + '"]:checked'), function (input) { return input.value; });
  }

  // The rows are rebuilt on every load, which detaches whatever Edit button
  // had focus. The same row's button takes it back; a row that is gone hands
  // it to its section's Add button, so focus never falls to <body>.
  function focusKey() {
    var active = document.activeElement;
    if (!active || !state.root.contains(active)) return null;
    if (active.hasAttribute('data-edit')) return { attr: 'data-edit', value: active.getAttribute('data-edit'), fallback: '[data-dialog-open="people-add"]' };
    if (active.hasAttribute('data-edit-group')) return { attr: 'data-edit-group', value: active.getAttribute('data-edit-group'), fallback: '#people-group-add' };
    return null;
  }

  function restoreFocus(key) {
    if (!key) return;
    var buttons = state.root.querySelectorAll('[' + key.attr + ']');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute(key.attr) === key.value) { buttons[i].focus(); return; }
    }
    var fallback = state.root.querySelector(key.fallback);
    if (fallback) fallback.focus();
  }

  function render() {
    var key = focusKey();
    renderPeople();
    renderGroups();
    if (typeof window.bdInitTableScroll === 'function') window.bdInitTableScroll();
    restoreFocus(key);
  }

  // Only an owner makes an owner (D16): the option exists for them alone.
  function offerOwner(isOwner) {
    var options = state.root.querySelectorAll('select[name="role"] option[value="owner"]');
    for (var i = 0; i < options.length; i++) {
      options[i].hidden = !isOwner;
      options[i].disabled = !isOwner;
    }
  }

  /* ------ Load ------ */

  // Both lists say they are waiting while the people load (tools.css, Busy
  // preview): the ring over each, aria-busy on each, and the words in the
  // status region, since aria-busy alone is not reliably announced. Only the
  // first load speaks; a reload after a change has the busy button already.
  function setListsBusy(busy) {
    var lists = state.root.querySelectorAll('.table-scroll');
    for (var i = 0; i < lists.length; i++) {
      lists[i].toggleAttribute('data-loading', busy);
      if (busy) lists[i].setAttribute('aria-busy', 'true');
      else lists[i].removeAttribute('aria-busy');
    }
  }

  function load() {
    var loadError = byId('people-load-error');
    var status = byId('people-status');
    var first = !state.data;
    loadError.textContent = '';
    setListsBusy(true);
    if (first && status) status.textContent = COPY.loading;
    var settle = function () {
      setListsBusy(false);
      if (status) status.textContent = '';
    };
    return request('')
      .then(function (result) {
        settle();
        if (!result.ok || !result.data) {
          loadError.textContent = result.status === 403 ? COPY.forbidden : COPY.loadFailed;
          return;
        }
        state.data = result.data;
        offerOwner(!!(state.data.viewer && state.data.viewer.owner));
        render();
      })
      .catch(function () {
        settle();
        loadError.textContent = COPY.offline;
      });
  }

  /* ------ Add people ------ */

  function resetAddForm() {
    var form = byId('people-add-form');
    form.reset();
    byId('people-add-error').textContent = '';
    renderGroupChecks(form.querySelector('[data-groups-field]'), []);
    toggleGroupsField(form);
  }

  function submitAdd(event) {
    event.preventDefault();
    if (state.busy) return;
    var form = event.target;
    var error = byId('people-add-error');
    var button = byId('people-add-submit');
    error.textContent = '';
    var body = {
      emails: form.elements.emails.value,
      role: form.elements.role.value,
      groups: form.elements.role.value === 'guest' ? checkedValues(form, 'groups') : [],
      expiresAt: form.elements.expiresAt.value || null,
      demo: form.elements.demo.checked,
      note: form.elements.note.value
    };
    markInvalid(form.elements.emails, error, false);
    setBusy(button, true);
    request('invite', body)
      .then(function (result) {
        if (!result.ok) {
          error.textContent = errorMessage(result);
          markInvalid(form.elements.emails, error, result.status === 400 || result.status === 409);
          return;
        }
        var added = result.data && result.data.added ? result.data.added.length : 0;
        var unsent = result.data && result.data.unsent ? result.data.unsent.length : 0;
        var message = added + (added === 1 ? ' person added' : ' people added') + (body.demo ? (added === 1 ? ', as a demo account.' : ', as demo accounts.') : '.');
        if (unsent) message += ' ' + unsent + (unsent === 1 ? ' invite did not send' : ' invites did not send') + ' - resend from Edit.';
        // The dialog closes before the toast shows: toast.js parents its
        // region into an open modal, which would take the toast down with it.
        closeDialog(byId('people-add'));
        toast(message, unsent ? 'warning' : 'success');
        return load();
      })
      .catch(function () { error.textContent = COPY.offline; })
      .then(function () { setBusy(button, false); });
  }

  /* ------ Edit person ------ */

  function openEdit(email) {
    var person = (state.data.people || []).find(function (p) { return p.email === email; });
    if (!person) return;
    state.editing = person;
    var form = byId('people-edit-form');
    form.reset();
    byId('people-edit-error').textContent = '';
    byId('people-edit-email').textContent = person.email;
    byId('people-edit-status').textContent = person.status.label + (person.invitedBy ? ' · added by ' + person.invitedBy : '');
    // Nobody changes their own level (D16): the select shows it, and says why it is fixed.
    // On the viewer's own row the role is a sentence, not a disabled select
    // a keyboard cannot reach: the reason is read where the field would be,
    // and the dialog opens on the first field they can change.
    var own = person.email === state.data.viewer.email;
    var roleLabel = ROLE_LABELS[person.owner ? 'owner' : person.role] || person.role;
    form.elements.role.value = person.owner ? 'owner' : person.role;
    byId('people-edit-role-field').hidden = own;
    byId('people-edit-role-own').hidden = !own;
    byId('people-edit-role-own').textContent = own ? 'Your role: ' + roleLabel + '. Another admin or an owner changes it, and your end date.' : '';
    form.elements.role.toggleAttribute('autofocus', !own);
    // Nor their own end date: an end date is a removal on a timer.
    form.elements.expiresAt.closest('.form-group').hidden = own;
    form.elements.note.toggleAttribute('autofocus', own);
    form.elements.expiresAt.value = isoDay(person.expiresAt);
    form.elements.note.value = person.note || '';
    form.elements.demo.checked = !!person.demo;
    // Demo is set at invite only (the API refuses it later): the edit dialog
    // offers the switch only to end one.
    byId('people-edit-demo-field').hidden = !person.demo;
    renderGroupChecks(form.querySelector('[data-groups-field]'), person.groups || []);
    toggleGroupsField(form);
    // Resend is for an invite that has not been taken up; a demo account
    // gets no email. Remove is never offered on the viewer's own row - the
    // API refuses it, and a button that always fails is noise.
    byId('people-edit-resend').hidden = person.demo || person.signedUp;
    // Lift is offered only while the day's failed-code cap holds the address.
    byId('people-edit-unlock').hidden = !person.locked;
    // An owner may remove another owner; nobody removes themselves or the
    // deployment's own owner (the API refuses both).
    byId('people-edit-remove').hidden = own || person.floor;
    openDialog(byId('people-edit'));
  }

  function submitEdit(event) {
    event.preventDefault();
    if (state.busy || !state.editing) return;
    var form = event.target;
    var error = byId('people-edit-error');
    var button = byId('people-edit-submit');
    error.textContent = '';
    var body = {
      email: state.editing.email,
      role: form.elements.role.value,
      groups: form.elements.role.value === 'guest' ? checkedValues(form, 'groups') : [],
      expiresAt: form.elements.expiresAt.value || null,
      demo: form.elements.demo.checked,
      note: form.elements.note.value
    };
    setBusy(button, true);
    request('update', body)
      .then(function (result) {
        if (!result.ok) {
          error.textContent = errorMessage(result);
          return;
        }
        closeDialog(byId('people-edit'));
        toast(result.data && result.data.signedOut ? COPY.savedSignedOut : COPY.saved, 'success');
        return load();
      })
      .catch(function () { error.textContent = COPY.offline; })
      .then(function () { setBusy(button, false); });
  }

  function resendInvite() {
    if (state.busy || !state.editing) return;
    var error = byId('people-edit-error');
    var button = byId('people-edit-resend');
    error.textContent = '';
    setBusy(button, true);
    request('resend', { email: state.editing.email })
      .then(function (result) {
        if (!result.ok) {
          error.textContent = errorMessage(result);
          return;
        }
        toast(COPY.resent, 'success');
      })
      .catch(function () { error.textContent = COPY.offline; })
      .then(function () { setBusy(button, false); });
  }

  function liftLockout() {
    if (state.busy || !state.editing) return;
    var error = byId('people-edit-error');
    var button = byId('people-edit-unlock');
    error.textContent = '';
    setBusy(button, true);
    request('unlock', { email: state.editing.email })
      .then(function (result) {
        if (!result.ok) {
          error.textContent = errorMessage(result);
          return;
        }
        // Move focus off the button before it hides, or it falls to <body>.
        byId('people-edit-submit').focus();
        button.hidden = true;
        toast(COPY.unlocked, 'success');
        return load();
      })
      .catch(function () { error.textContent = COPY.offline; })
      .then(function () { setBusy(button, false); });
  }

  /* ------ Confirm ------ */

  function confirmAction(title, text, button, go) {
    state.confirm = go;
    byId('people-confirm-title').textContent = title;
    byId('people-confirm-text').textContent = text;
    byId('people-confirm-error').textContent = '';
    byId('people-confirm-go').textContent = button;
    openDialog(byId('people-confirm'));
  }

  function runConfirm() {
    if (state.busy || typeof state.confirm !== 'function') return;
    var error = byId('people-confirm-error');
    var button = byId('people-confirm-go');
    error.textContent = '';
    setBusy(button, true);
    state.confirm()
      .then(function (result) {
        if (!result.ok) {
          error.textContent = errorMessage(result);
          return;
        }
        closeDialog(byId('people-confirm'));
        toast(result.message, 'success');
        return load();
      })
      .catch(function () { error.textContent = COPY.offline; })
      .then(function () { setBusy(button, false); });
  }

  function removePerson() {
    if (!state.editing) return;
    var email = state.editing.email;
    var edit = byId('people-edit');
    closeDialog(edit);
    afterClosed(edit, function confirmRemove() {
      confirmAction('Remove this person?', COPY.confirmRemove(email), 'Remove', function () {
        return request('remove', { email: email }).then(function (result) {
          return { ok: result.ok, data: result.data, message: COPY.removed };
        });
      });
    });
  }

  /* ------ Groups ------ */

  function openGroup(id) {
    var group = id ? (state.data.groups || []).find(function (g) { return g.id === id; }) : null;
    state.editingGroup = group;
    var form = byId('people-group-form');
    form.reset();
    byId('people-group-error').textContent = '';
    byId('people-group-title').textContent = group ? 'Edit group' : 'Add group';
    byId('people-group-id').value = group ? group.id : '';
    form.elements.name.value = group ? group.name : '';
    form.elements.note.value = group ? group.note : '';
    var grants = group ? group.grants : [];
    var sections = byId('people-group-sections');
    renderCheckList(sections, (state.data.sections || []).map(function (s) { return { value: 'section:' + s.folder, label: s.label }; }), 'sections', grants);
    renderPagesSelect(byId('people-group-pages'), grants);
    byId('people-group-remove').hidden = !group;
    openDialog(byId('people-group'));
  }

  function submitGroup(event) {
    event.preventDefault();
    if (state.busy) return;
    var form = event.target;
    var error = byId('people-group-error');
    var button = byId('people-group-submit');
    error.textContent = '';
    var pages = Array.prototype.map.call(byId('people-group-pages').selectedOptions, function (option) { return option.value; });
    var body = {
      id: form.elements.id.value || undefined,
      name: form.elements.name.value,
      note: form.elements.note.value,
      grants: checkedValues(form, 'sections').concat(pages)
    };
    markInvalid(form.elements.name, error, false);
    setBusy(button, true);
    request('groups/save', body)
      .then(function (result) {
        if (!result.ok) {
          error.textContent = errorMessage(result);
          markInvalid(form.elements.name, error, result.status === 400 || result.status === 409);
          return;
        }
        closeDialog(byId('people-group'));
        toast(COPY.groupSaved, 'success');
        return load();
      })
      .catch(function () { error.textContent = COPY.offline; })
      .then(function () { setBusy(button, false); });
  }

  function removeGroup() {
    if (!state.editingGroup) return;
    var group = state.editingGroup;
    var editor = byId('people-group');
    closeDialog(editor);
    afterClosed(editor, function confirmRemoveGroup() {
      confirmAction('Delete this group?', COPY.confirmGroup(group.name, group.members), 'Delete', function () {
        return request('groups/remove', { id: group.id }).then(function (result) {
          return { ok: result.ok, data: result.data, message: COPY.groupRemoved };
        });
      });
    });
  }

  /* ------ Events ------ */

  function onClick(event) {
    var target = event.target.closest ? event.target : null;
    if (!target) return;
    var edit = target.closest('[data-edit]');
    if (edit) { openEdit(edit.getAttribute('data-edit')); return; }
    var editGroup = target.closest('[data-edit-group]');
    if (editGroup) { openGroup(editGroup.getAttribute('data-edit-group')); return; }
    if (target.closest('[data-dialog-open="people-add"]')) { resetAddForm(); return; }
    if (target.closest('#people-group-add')) { event.preventDefault(); openGroup(null); return; }
    if (target.closest('#people-edit-resend')) { resendInvite(); return; }
    if (target.closest('#people-edit-unlock')) { liftLockout(); return; }
    if (target.closest('#people-edit-remove')) { removePerson(); return; }
    if (target.closest('#people-group-remove')) { removeGroup(); return; }
    if (target.closest('#people-confirm-go')) { runConfirm(); }
  }

  function onChange(event) {
    var select = event.target;
    if (select.matches && select.matches('select[name="role"]')) toggleGroupsField(select.form);
  }

  /* ------ Initialize ------ */

  function initPeople() {
    var root = document.querySelector('[data-tool="people"] #people');
    if (!root || root.dataset.peopleInit) return;
    root.dataset.peopleInit = 'true';
    state.root = root;
    // The group dialog has its own opener handler (it fills the form from
    // state), so the trigger loses dialog.js's attribute before the delegated
    // document listener sees the click.
    byId('people-group-add').removeAttribute('data-dialog-open');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    byId('people-add-form').addEventListener('submit', submitAdd);
    byId('people-edit-form').addEventListener('submit', submitEdit);
    byId('people-group-form').addEventListener('submit', submitGroup);
    load();
    console.log('people.js v' + VERSION + ' initialised');
  }

  window.initPeople = initPeople;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initPeople bails when its markup is absent.
  function startPeople() {
    initPeople();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startPeople);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPeople);
  } else {
    startPeople();
  }
})();
