/**
 * activity.js - the Activity page (/settings/activity.html, cms/apps/activity.html). v1.0.0
 *
 * Fills the People table and the Log from /api/activity
 * (worker/activity.mjs): who signed in, which gated pages they opened and
 * which Asset Library files they downloaded. Read only. The filters ask the
 * Worker again; "Show older" asks for the page before the oldest row shown.
 *
 * Scoped to the tool's container ([data-tool="activity"], written by the
 * generator) and idempotent: initActivity runs on load and after every page
 * transition (it starts itself: startActivity), and bails when the page is
 * not this one or is already bound. Rows are built with DOM calls, never
 * innerHTML: a name and a path are data, not markup.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var API = '/api/activity';
  var LOAD_TIMEOUT_MS = 15000;

  var KINDS = {
    'sign-in': { label: 'Signed in', colour: 'info' },
    page: { label: 'Page', colour: null },
    download: { label: 'Download', colour: 'success' }
  };

  var COPY = {
    loadFailed: 'The activity log could not be loaded. Press Reload to try again.',
    forbidden: 'This page is for the owner.',
    offline: 'No connection. Check it, then press Reload.',
    slow: 'The log took too long to answer. Press Reload to try again.',
    never: 'Never',
    loading: 'Loading the activity log.',
    loaded: function (count) { return count === 1 ? '1 entry loaded.' : count + ' entries loaded.'; },
    months: function (days) {
      var months = Math.round(days / 30.4);
      if (months >= 2) return months + ' months';
      return days === 1 ? '1 day' : days + ' days';
    }
  };

  // `loads` numbers each request, so only the newest one's answer is drawn:
  // a filter changed twice, or an answer arriving after the page was left.
  var state = { root: null, loads: 0, controller: null, oldest: null };

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

  // Dates in the site's locale (bd-locale.js), en-GB without it
  var dateFormat = new Intl.DateTimeFormat((window.bdLocale && window.bdLocale.tag) || 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  /** Unix seconds as a <time>, or the fallback as text. */
  function timeNode(seconds, fallback) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return document.createTextNode(fallback);
    var date = new Date(seconds * 1000);
    return el('time', { datetime: date.toISOString(), text: dateFormat.format(date) });
  }

  function badge(kind) {
    var meta = KINDS[kind] || { label: kind, colour: null };
    var attrs = { class: 'badge', text: meta.label, 'data-case': 'none' };
    if (meta.colour) attrs['data-color'] = meta.colour;
    return el('span', attrs);
  }

  /** A person as their name with the email beneath, or the email alone. */
  function personNode(name, email) {
    if (!name) return document.createTextNode(email);
    return el('div', { class: 'block gap-none' }, [
      el('span', { text: name }),
      el('span', { class: 'text-size-s text-secondary', text: email })
    ]);
  }

  /** What a row points at: a page as a link, a download as its file name. */
  function targetNode(event) {
    if (event.kind === 'sign-in' || !event.path) return document.createTextNode('');
    if (event.kind === 'download') {
      var name = event.path.split('/').pop();
      try { name = decodeURIComponent(name); } catch (e) { /* keep it encoded */ }
      return el('span', { text: name, title: event.path });
    }
    // Linked only as a path on this site: one leading slash, never "//host"
    if (!/^\/(?!\/)/.test(event.path)) return el('span', { text: event.path });
    return el('a', { href: event.path, text: event.path });
  }

  /* ------ Render ------ */

  function renderPeople(people) {
    var rows = byId('activity-people');
    var select = byId('activity-person');
    var chosen = select.value;
    rows.replaceChildren();
    byId('activity-people-empty').hidden = people.length > 0;
    // The person filter lists exactly the people in the log
    select.replaceChildren(el('option', { value: '', text: 'Everyone' }));
    people.forEach(function (person) {
      rows.appendChild(el('tr', null, [
        el('td', null, [personNode(person.name, person.email)]),
        el('td', null, [timeNode(person.lastSignInAt, COPY.never)]),
        el('td', null, [timeNode(person.lastSeenAt, COPY.never)]),
        el('td', { text: String(person.signIns) }),
        el('td', { text: String(person.pages) }),
        el('td', { text: String(person.downloads) })
      ]));
      select.appendChild(el('option', { value: person.email, text: person.name ? person.name + ' (' + person.email + ')' : person.email }));
    });
    // A person no longer in the summary (their rows swept) stays chosen, so
    // the filter and the rows drawn under it agree
    if (chosen && !people.some(function (p) { return p.email === chosen; })) {
      select.appendChild(el('option', { value: chosen, text: (state.names && state.names[chosen]) || chosen }));
    }
    select.value = chosen;
  }

  function renderEvents(events, append) {
    var rows = byId('activity-rows');
    if (!append) rows.replaceChildren();
    var names = state.names || {};
    events.forEach(function (event) {
      rows.appendChild(el('tr', null, [
        el('td', null, [timeNode(event.at, '')]),
        el('td', null, [personNode(names[event.email] || '', event.email)]),
        el('td', null, [badge(event.kind)]),
        el('td', null, [targetNode(event)])
      ]));
    });
    byId('activity-log-empty').hidden = rows.children.length > 0;
  }

  /* ------ Load ------ */

  /**
   * A first page that failed: the rows shown no longer match the filters,
   * so they go, and "Show older" with them, or it would page from them.
   */
  function clearLog() {
    byId('activity-rows').replaceChildren();
    byId('activity-more').hidden = true;
    byId('activity-log-empty').hidden = true;
    state.oldest = null;
  }

  function showError(message) {
    byId('activity-load-error').textContent = message;
  }

  function busy(on) {
    ['activity-reload', 'activity-more'].forEach(function (id) {
      var button = byId(id);
      if (on) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    });
  }

  /** Ask for the log: the first page (with the People summary), or the page before `before`. */
  function load(before) {
    var root = state.root;
    if (!root) return;
    var ticket = ++state.loads;
    var current = function () { return state.root === root && state.loads === ticket; };
    if (state.controller) state.controller.abort();
    state.controller = null;

    var params = new URLSearchParams();
    var person = byId('activity-person').value;
    var kind = byId('activity-kind').value;
    if (person) params.set('person', person);
    if (kind) params.set('kind', kind);
    if (before) params.set('before', String(before));
    var query = params.toString();

    showError('');
    byId('activity-status').textContent = COPY.loading;
    busy(true);

    var options = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    // A load that never answers must not leave the buttons locked
    var timer = null;
    if (typeof AbortController === 'function') {
      var controller = new AbortController();
      state.controller = controller;
      options.signal = controller.signal;
      timer = setTimeout(function abortLoad() { controller.abort(); }, LOAD_TIMEOUT_MS);
    }
    var settled = function () { clearTimeout(timer); };

    fetch(API + (query ? '?' + query : ''), options)
      .then(function (response) {
        return response.text().then(function (text) {
          settled();
          if (!current()) return;
          busy(false);
          var data = null;
          try { data = JSON.parse(text); } catch (e) { data = null; }
          if (!response.ok || !data || !Array.isArray(data.events)) {
            if (!before) clearLog();
            byId('activity-status').textContent = '';
            showError(response.status === 403 ? COPY.forbidden : (data && data.error) || COPY.loadFailed);
            return;
          }
          try {
            if (typeof data.retentionDays === 'number') byId('activity-retention').textContent = COPY.months(data.retentionDays);
            if (Array.isArray(data.people)) {
              state.names = {};
              data.people.forEach(function (p) { state.names[p.email] = p.name; });
              renderPeople(data.people);
            }
            renderEvents(data.events, Boolean(before));
            state.oldest = data.events.length ? data.events[data.events.length - 1].id : state.oldest;
            byId('activity-more').hidden = !data.more;
            byId('activity-status').textContent = COPY.loaded(byId('activity-rows').children.length);
          } catch (err) {
            console.error('activity: could not draw the log', err);
            showError(COPY.loadFailed);
          }
        });
      })
      .catch(function (err) {
        settled();
        if (!current()) return;
        busy(false);
        if (!before) clearLog();
        byId('activity-status').textContent = '';
        // Aborted here only by the timeout: leaving the page also aborts, but
        // that load is no longer current
        showError(err && err.name === 'AbortError' ? COPY.slow : COPY.offline);
      });
  }

  function onClick(event) {
    var button = event.target.closest('#activity-reload, #activity-more');
    // aria-disabled, not disabled, so focus stays on the button mid-load
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    if (button.id === 'activity-more') load(state.oldest);
    else load();
  }

  function onChange(event) {
    if (event.target.id === 'activity-person' || event.target.id === 'activity-kind') load();
  }

  /* ------ Initialize ------ */

  function initActivity(scope) {
    var root = (scope || document).querySelector('[data-tool="activity"] #activity');
    if (!root || root.dataset.activityInit) return;
    root.dataset.activityInit = 'true';
    state.root = root;
    state.oldest = null;
    state.names = {};
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    load();
    console.log('activity.js v' + VERSION + ' initialised');
  }

  window.initActivity = initActivity;

  // Starts itself, as every app does: on a hard load and after every page
  // transition (bd:after-nav). initActivity bails when its markup is absent.
  function startActivity(event) {
    initActivity(event && event.detail && event.detail.container);
  }

  // Leaving the page: a load still out is cancelled and can no longer count
  // as current, so nothing is written into the page on its way out.
  function leaveActivity() {
    if (!state.root) return;
    if (state.controller) state.controller.abort();
    state.controller = null;
    state.loads++;
    state.root = null;
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the page dead after the next navigation.
  document.addEventListener('bd:after-nav', startActivity);
  document.addEventListener('bd:before-nav', leaveActivity);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startActivity);
  } else {
    startActivity();
  }
})();
