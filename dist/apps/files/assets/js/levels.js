/**
 * levels.js - the Page levels list on the People page (levels-groups-plan.md
 * D27, cms/apps/people.html #levels). v1.0.0
 *
 * A change moves Staged -> Applied -> Live. Picking a level stages it: only
 * this reader sees it, and nothing anyone can open changes. "Review and
 * apply" opens a dialog that says what each change does to who can open the
 * page; applying it asks for a build, and the change is live once that build
 * is deployed. The page never decides access: worker/levels-api.js checks
 * every request, and the gate only ever reads built levels.
 *
 * Rows are built with DOM calls, never innerHTML: a page title is the
 * reader's content, not markup. A re-render keeps focus on the control the
 * reader used, or the section's expand button when that control is gone.
 *
 * Scoped to [data-tool="people"] #levels and idempotent: initLevels runs on
 * load and after every Barba navigation, and bails when the page is not this
 * one or is already bound.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = '/api/people/levels';

  var LEVELS = ['public', 'team', 'admin', 'owner'];
  var LEVEL_RANK = { public: 0, team: 1, admin: 2, owner: 3 };
  var LEVEL_LABELS = { public: 'Public', team: 'Team', admin: 'Admin', owner: 'Owner' };

  // Who can open a page at each level, said as the outcome.
  var AUDIENCE = {
    public: 'Anyone with the link can open it.',
    team: 'Anyone signed in can open it.',
    admin: 'Only admins and owners can open it.',
    owner: 'Only owners can open it.'
  };

  var COPY = {
    loadFailed: 'The levels could not be loaded. Reload the page to try again.',
    offline: 'No connection. Nothing was changed. Try again.',
    failed: 'Something went wrong on our side. Nothing was changed. Try again.',
    staged: function (n) { return (n === 1 ? '1 change staged.' : n + ' changes staged.') + ' Nobody\u2019s access changes until you apply it.'; },
    waitingDeploy: function (n) { return (n === 1 ? '1 applied change goes' : n + ' applied changes go') + ' live at the next deploy of the site.'; },
    waitingBuild: function (n, at) { return (n === 1 ? '1 applied change goes' : n + ' applied changes go') + ' live when the build asked for at ' + at + ' finishes.'; },
    notReading: 'The live build did not read these settings, so applied changes are not on the site, raises included. A developer needs to rebuild with LEVELS_FROM_D1=1.',
    waitingAsk: function (n) { return (n === 1 ? '1 applied change waits' : n + ' applied changes wait') + ' for a build.'; },
    whenBuild: 'They go live when the build this asks for finishes. Until then everyone keeps their current access.',
    whenDeploy: 'They go live at the next deploy of the site. Until then everyone keeps their current access.',
    applied: function (n) { return n === 1 ? 'Applied. It goes live with the next build.' : 'Applied ' + n + ' changes. They go live with the next build.'; },
    discarded: 'Staged changes discarded.',
    buildAsked: 'A build has been asked for.',
    ownerPages: function (n) { return n === 1 ? '1 owner page, not shown' : n + ' owner pages, not shown'; },
    pages: function (n) { return n === 1 ? '1 page' : n + ' pages'; },
    ownerFloor: 'This section holds an owner page. Only an owner lowers it.'
  };

  var state = { root: null, data: null, busy: false, expanded: {} };

  /* ------ Utilities ------ */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function setAttr(key) {
        var value = attrs[key];
        if (value === null || value === undefined) return;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = value;
        else node.setAttribute(key, value);
      });
    }
    (children || []).forEach(function addChild(child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function cssEscape(value) {
    return window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(value) : String(value).replace(/["\\#.:]/g, '\\$&');
  }

  // Looked up inside this People page, not the document: during a page change
  // the leaving and arriving pages both hold these ids for a moment.
  function byId(id) {
    var tool = state.root ? state.root.closest('[data-tool="people"]') : null;
    return tool ? tool.querySelector('#' + cssEscape(id)) : null;
  }

  // Errors are seen (a toast); successes are heard (the status region), since
  // the list itself already shows what changed. One channel each, so nothing
  // is announced twice.
  function toastError(message) {
    if (typeof window.showToast === 'function') window.showToast(message, 'error');
    else console.warn('levels.js: ' + message);
  }

  function announce(message) {
    var status = byId('levels-status');
    if (!status) return;
    status.textContent = '';
    window.setTimeout(function speak() { status.textContent = message; }, 50);
  }

  function request(path, body) {
    var options = { credentials: 'same-origin', headers: {} };
    if (body) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(API + path, options).then(function readResponse(response) {
      return response.text().then(function parse(text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function errorOf(result) {
    return result && result.data && result.data.error ? result.data.error : COPY.failed;
  }

  function isOwnerView() {
    return !!(state.data && state.data.viewer && state.data.viewer.owner);
  }

  function clockTime(seconds) {
    var d = new Date(seconds * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ------ Render ------ */

  // The levels a reader may pick: at or above the target's floor, never Owner
  // for an admin, and never below `lowest` (an admin on an owner-bearing
  // section). Levels a reader cannot choose are left out, not disabled, so
  // every button in the group does something.
  function choices(min, lowest) {
    return LEVELS.filter(function allowed(level) {
      if (LEVEL_RANK[level] < LEVEL_RANK[min]) return false;
      if (lowest && LEVEL_RANK[level] < LEVEL_RANK[lowest]) return false;
      return level !== 'owner' || isOwnerView();
    });
  }

  function segmented(label, key, current, levels, describedBy, onPick) {
    var group = el('div', { class: 'segmented-control', role: 'group', 'aria-label': label, 'aria-describedby': describedBy || null });
    levels.forEach(function addSegment(level) {
      var active = level === current;
      var btn = el('button', {
        type: 'button',
        class: 'segmented-control-btn' + (active ? ' is-active' : ''),
        'aria-pressed': active ? 'true' : 'false',
        'data-focus-key': key + '|' + level,
        text: LEVEL_LABELS[level]
      });
      if (!active) btn.addEventListener('click', function pick() { onPick(level); });
      group.appendChild(btn);
    });
    return group;
  }

  function stateBadge(itemState, id) {
    if (itemState === 'staged') return el('span', { class: 'badge', 'data-color': 'info', 'data-case': 'none', id: id, text: 'Staged' });
    if (itemState === 'waiting') return el('span', { class: 'badge', 'data-color': 'warning', 'data-case': 'none', id: id, text: 'Waits for build' });
    return null;
  }

  function textButton(label, key, onClick) {
    var btn = el('button', { type: 'button', class: 'button', 'data-variant': 'faded', 'data-size': 'small', 'data-focus-key': key, text: label });
    btn.addEventListener('click', onClick);
    return btn;
  }

  function pageRow(sec, page) {
    var key = 'page|' + sec.folder + '|' + page.path;
    var badgeId = 'levels-state-' + sec.folder + '-' + page.path.replace(/[^a-z0-9]+/g, '-');
    var row = el('div', { class: 'levels-row' });
    row.appendChild(el('div', { class: 'levels-row-title' }, [el('span', { text: page.title }), stateBadge(page.state, badgeId)]));

    var control = el('div', { class: 'levels-control' });
    var label = 'Level for ' + page.title + ' in ' + sec.label;
    control.appendChild(segmented(label, key, page.level, choices(page.minLevel), page.state ? badgeId : null, function pickPage(level) {
      stage('page', page.path, level, page.title + ' staged at ' + LEVEL_LABELS[level] + '.');
    }));
    if (page.state === 'staged') {
      control.appendChild(textButton('Undo', key + '|undo', function undoPage() { discardOne('page', page.path, page.title); }));
    } else if (!page.follows) {
      control.appendChild(textButton('Back to section', key + '|reset', function resetPage() {
        stage('page', page.path, null, page.title + ' staged back to its section.');
      }));
    }
    row.appendChild(control);
    return row;
  }

  // The caret is the brand chevron, cloned from the page's <template> (the
  // generator inlines the icon there), so no icon markup lives in this script.
  function caret() {
    var tpl = byId('levels-caret');
    var span = tpl && tpl.content.firstElementChild ? tpl.content.firstElementChild.cloneNode(true) : el('span');
    span.classList.add('levels-caret');
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function sectionBlock(sec) {
    var open = !!state.expanded[sec.folder];
    var bodyId = 'levels-body-' + sec.folder;
    var badgeId = 'levels-state-' + sec.folder;
    var key = 'section|' + sec.folder;
    var wrap = el('div', { class: 'levels-section border-bottom' });

    var header = el('div', { class: 'levels-row' });
    var expand = el('button', {
      type: 'button',
      class: 'button levels-expand',
      'data-variant': 'text',
      'data-size': 'small',
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': bodyId,
      'aria-label': sec.label + ', ' + COPY.pages(sec.pagesCount),
      'data-focus-key': 'expand|' + sec.folder
    }, [caret(), el('span', { class: 'levels-section-name', text: sec.label }), el('span', { class: 'text-size-s text-secondary', text: COPY.pages(sec.pagesCount) })]);
    expand.addEventListener('click', function onExpand() { toggleSection(sec.folder, expand); });
    header.appendChild(el('h3', { class: 'levels-heading' }, [expand]));

    var control = el('div', { class: 'levels-control' });
    var lowest = !isOwnerView() && sec.ownerInside ? sec.appliedLevel : null;
    var options = choices('public', lowest);
    if (options.length > 1 || (options.length === 1 && options[0] !== sec.level)) {
      control.appendChild(segmented('Floor for ' + sec.label, key, sec.level, options, sec.state ? badgeId : null, function pickFloor(level) {
        stage('section', sec.folder, level, 'The ' + sec.label + ' floor staged at ' + LEVEL_LABELS[level] + '.');
      }));
    } else {
      control.appendChild(el('span', { class: 'text-size-s text-secondary', text: LEVEL_LABELS[sec.level] + '. Only an owner changes it.' }));
    }
    var badge = stateBadge(sec.state, badgeId);
    if (badge) control.appendChild(badge);
    if (sec.state === 'staged') {
      control.appendChild(textButton('Undo', key + '|undo', function undoSection() { discardOne('section', sec.folder, 'The ' + sec.label + ' floor'); }));
    } else if (sec.setBy === 'settings' && !lowest) {
      control.appendChild(textButton('Back to code', key + '|reset', function resetSection() {
        stage('section', sec.folder, null, 'The ' + sec.label + ' floor staged back to code.');
      }));
    }
    header.appendChild(control);
    wrap.appendChild(header);

    var body = el('div', { class: 'levels-section-body', id: bodyId });
    body.hidden = !open;
    if (lowest) body.appendChild(el('p', { class: 'text-size-s text-secondary', text: COPY.ownerFloor }));
    sec.pages.forEach(function addPage(page) { body.appendChild(pageRow(sec, page)); });
    if (sec.ownerPages > 0) body.appendChild(el('p', { class: 'text-size-s text-secondary', text: COPY.ownerPages(sec.ownerPages) }));
    wrap.appendChild(body);
    return wrap;
  }

  function renderBars() {
    var data = state.data;
    var staged = byId('levels-staged');
    staged.hidden = !data.staged;
    if (data.staged) byId('levels-staged-text').textContent = COPY.staged(data.staged);

    var pending = byId('levels-pending');
    var retry = byId('levels-build-now');
    var build = data.build || {};
    pending.hidden = !data.waiting;
    retry.hidden = !(data.waiting && build.configured && build.canRetry);
    if (!data.waiting) return;
    // A build asked for since the live one read D1 is news first; then a live
    // build that never read the settings, which a developer has to fix.
    var text = build.configured && build.askedAt ? COPY.waitingBuild(data.waiting, clockTime(build.askedAt))
      : build.readsSettings === false ? COPY.notReading
        : !build.configured ? COPY.waitingDeploy(data.waiting)
          : COPY.waitingAsk(data.waiting);
    byId('levels-pending-text').textContent = text;
  }

  function render() {
    var host = byId('levels-sections');
    if (!state.data || !Array.isArray(state.data.sections)) return;
    var active = state.root.ownerDocument.activeElement;
    var focused = active && host.contains(active) ? active.getAttribute('data-focus-key') : null;
    host.replaceChildren();
    byId('levels-empty').hidden = state.data.sections.length > 0;
    state.data.sections.forEach(function addSection(sec) { host.appendChild(sectionBlock(sec)); });
    renderBars();
    restoreFocus(host, focused);
  }

  // A re-render replaces every row, so the control the reader used would drop
  // focus to <body>. Put it back on the same control, else on the section's
  // expand button (a key's second part is always the folder).
  function restoreFocus(host, key) {
    if (!key) return;
    var target = host.querySelector('[data-focus-key="' + cssEscape(key) + '"]');
    if (!target) target = host.querySelector('[data-focus-key="' + cssEscape('expand|' + key.split('|')[1]) + '"]');
    if (target) target.focus();
  }

  /* ------ Actions ------ */

  // Expanding flips the body and the button only, no re-render, so focus and
  // scroll stay where they are.
  function toggleSection(folder, button) {
    var open = !state.expanded[folder];
    state.expanded[folder] = open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    var body = byId(button.getAttribute('aria-controls'));
    if (body) body.hidden = !open;
  }

  function setBusy(busy) {
    state.busy = busy;
    byId('levels-sections').setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  // One request at a time; the list reloads after each so it always shows
  // what the server holds.
  function send(path, body, onOk) {
    if (state.busy) return Promise.resolve(null);
    setBusy(true);
    return request(path, body).then(function handle(result) {
      if (!result.ok) { toastError(errorOf(result)); return load().then(function after() { return result; }); }
      if (onOk) onOk(result);
      return load().then(function after() { return result; });
    }).catch(function offline() {
      toastError(COPY.offline);
      return null;
    }).then(function done(result) {
      setBusy(false);
      return result;
    });
  }

  function stage(kind, target, level, message) {
    send('/stage', { kind: kind, target: target, level: level }, function staged() { announce(message); });
  }

  function discardOne(kind, target, name) {
    send('/discard', { kind: kind, target: target }, function undone() { announce(name + ': staged change undone.'); });
  }

  function discardAll() {
    send('/discard', {}, function discarded() { announce(COPY.discarded); });
  }

  /* ------ Apply ------ */

  function stagedItems() {
    var items = [];
    state.data.sections.forEach(function collect(sec) {
      if (sec.state === 'staged') {
        items.push({
          name: sec.label + ' (section floor)',
          change: LEVEL_LABELS[sec.appliedLevel] + ' \u2192 ' + LEVEL_LABELS[sec.level] + '.',
          outcome: sec.level === 'public' ? 'Each page in it opens at its own level.' : 'Every page in it opens at ' + LEVEL_LABELS[sec.level] + ' or higher.'
        });
      }
      sec.pages.forEach(function collectPage(page) {
        if (page.state !== 'staged') return;
        items.push({
          name: sec.label + ' \u203a ' + page.title,
          change: LEVEL_LABELS[page.live] + ' \u2192 ' + LEVEL_LABELS[page.level] + '.',
          outcome: page.level === page.live ? 'Who can open it does not change.' : AUDIENCE[page.level]
        });
      });
    });
    return items;
  }

  function openApply() {
    var dialog = byId('levels-apply');
    var list = byId('levels-apply-list');
    var items = stagedItems();
    list.replaceChildren();
    items.forEach(function addItem(item) {
      list.appendChild(el('li', null, [el('strong', { text: item.name }), ' ' + item.change + ' ' + item.outcome]));
    });
    byId('levels-apply-error').textContent = '';
    byId('levels-apply-when').textContent = state.data.build && state.data.build.configured ? COPY.whenBuild : COPY.whenDeploy;
    byId('levels-apply-go').textContent = items.length === 1 ? 'Apply 1 change' : 'Apply ' + items.length + ' changes';
    if (typeof window.bdOpenSurface === 'function') window.bdOpenSurface(dialog);
    else if (!dialog.open) dialog.showModal();
  }

  function closeApply() {
    var dialog = byId('levels-apply');
    if (!dialog || !dialog.open) return;
    if (typeof window.bdRequestClose === 'function') window.bdRequestClose(dialog, 'programmatic');
    else dialog.close();
  }

  function applyNow() {
    if (state.busy) return;
    var go = byId('levels-apply-go');
    go.classList.add('is-loading');
    go.setAttribute('aria-disabled', 'true');
    setBusy(true);
    request('/apply', {}).then(function handle(result) {
      if (!result.ok) {
        // Shown in the dialog, where the reader is; the list reloads so a
        // moved change shows as it is now.
        byId('levels-apply-error').textContent = errorOf(result);
        return load();
      }
      closeApply();
      announce(COPY.applied(result.data.applied));
      return load();
    }).catch(function offline() {
      byId('levels-apply-error').textContent = COPY.offline;
    }).then(function done() {
      go.classList.remove('is-loading');
      go.removeAttribute('aria-disabled');
      setBusy(false);
    });
  }

  // The dialog gives focus back to Review and apply, which is gone once
  // nothing is staged; the section's heading takes it instead. Runs on the
  // dialog's own close event, after dialog.js has finished its exit.
  function focusAfterApply() {
    var opener = byId('levels-apply-open');
    if (opener && !byId('levels-staged').hidden) return;
    var heading = byId('levels-heading');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }

    function tryAgain() {
    var btn = byId('levels-build-now');
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-disabled', 'true');
    request('/build', {}).then(function handle(result) {
      if (!result.ok) toastError(errorOf(result));
      else announce(COPY.buildAsked);
      return load();
    }).catch(function offline() { toastError(COPY.offline); }).then(function done() {
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-disabled');
    });
  }

  /* ------ Load ------ */

  function load() {
    var error = byId('levels-load-error');
    return request('', null).then(function handle(result) {
      if (!result.ok || !result.data) { error.textContent = result.data && result.data.error ? result.data.error : COPY.loadFailed; return; }
      error.textContent = '';
      state.data = result.data;
      render();
    }).catch(function failed(err) {
      console.error('levels.js: the list could not load', err);
      error.textContent = COPY.loadFailed;
    }).then(function settle() {
      if (!state.busy) byId('levels-sections').setAttribute('aria-busy', 'false');
    });
  }

  /* ------ Initialize ------ */

  function initLevels() {
    var root = document.querySelector('[data-tool="people"] #levels');
    if (!root || root.dataset.levelsInit) return;
    root.dataset.levelsInit = 'true';
    state = { root: root, data: null, busy: false, expanded: {} };
    byId('levels-build-now').addEventListener('click', tryAgain);
    byId('levels-discard').addEventListener('click', discardAll);
    byId('levels-apply-open').addEventListener('click', openApply);
    byId('levels-apply-go').addEventListener('click', applyNow);
    byId('levels-apply').addEventListener('close', focusAfterApply);
    load();
    console.log('levels.js v' + VERSION + ' initialised');
  }

  window.initLevels = initLevels;

  function startLevels() {
    initLevels();
  }

  document.addEventListener('bd:after-nav', startLevels);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLevels);
  } else {
    startLevels();
  }
})();
