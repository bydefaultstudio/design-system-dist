/**
 * Home greeting
 * Fills the discovery home page's greeting (.home-greeting, docs-site.css):
 * the time of day, the reader's first name when the session gives one, and
 * today's date in the site's locale (window.bdLocale, en-GB by default, as
 * the other scripts that format dates read it).
 *
 * The page works without this file: the markup already says "Welcome" and
 * the date line holds its height empty, so filling it moves nothing. A name is only ever the one the session
 * returned (window.bdSession, set by header-account.js, which also fires
 * bd:session when the answer lands).
 *
 * Lifecycle: runs on load and when the session arrives. On a Barba
 * navigation it fills the arriving container at beforeEnter, before it is
 * shown, so the transition never shows the fallback and then swaps it;
 * bd:after-nav fills it again as a backstop.
 *
 * @version 1.1.0
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';

  // Part Of Day
  function partOfDay(hour) {
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // First Name
  function firstName() {
    var session = window.bdSession;
    var name = session && session.name ? String(session.name).trim() : '';
    return name ? name.split(/\s+/)[0] : '';
  }

  // Format Date
  function formatDate(now) {
    var locale = (window.bdLocale && window.bdLocale.tag) || 'en-GB';
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    } catch (err) {
      return now.toDateString();
    }
  }

  // Fill Greeting
  function fillGreeting(root) {
    var scope = root && root.querySelector ? root : document;
    var title = scope.querySelector('[data-home-greeting]');
    var date = scope.querySelector('[data-home-date]');
    if (!title && !date) return;

    var now = new Date();
    var name = firstName();

    if (title) title.textContent = partOfDay(now.getHours()) + (name ? ', ' + name : '');
    if (date) date.textContent = formatDate(now);
  }

  // Fill Arriving
  function fillArriving(data) {
    var next = data && data.next ? data.next.container : null;
    if (next) fillGreeting(next);
  }

  // Fill Document
  function fillDocument() {
    fillGreeting(document);
  }

  // Hook Router
  // A page without the router skips it.
  function hookRouter() {
    var barba = window.barba;
    if (barba && barba.hooks && typeof barba.hooks.beforeEnter === 'function') {
      barba.hooks.beforeEnter(fillArriving);
    }
  }

  // Init Home Greeting
  function initHomeGreeting() {
    fillDocument();
    // barba.min.js is a later deferred script, so the hook waits for
    // DOMContentLoaded, which fires after every deferred script has run.
    if (document.readyState === 'complete') {
      hookRouter();
    } else {
      document.addEventListener('DOMContentLoaded', hookRouter);
    }
    document.addEventListener('bd:after-nav', fillDocument);
    document.addEventListener('bd:session', fillDocument);
    console.log('Home greeting v' + VERSION + ' ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHomeGreeting);
  } else {
    initHomeGreeting();
  }
})();
