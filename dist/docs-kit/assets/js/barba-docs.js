/**
 * barba-docs.js — the page router for every docs-kit site
 *
 * Always on: the generator emits it, the vendored @barba/core and
 * barba-transitions.css on every site, and stamps the wrapper and container
 * attributes the resolver reads (engine parity C3, D5). There is one router.
 * A site changes what it does through window.bdBarbaOptions and the
 * `transitions` key in docs.config.js, never by shipping its own.
 *
 * Architecture:
 *
 *   1. Resolver — resolveScenario(fromEl, toEl) → "open" | "close" | "swap" | "swap-back" | "fade"
 *      Answers "what's happening?" from data-level, data-section and data-order.
 *
 *   2. Map — TRANSITION_MAP { open: "slide-up", close: "slide-down", ... }
 *      Answers "which animation runs for this scenario?" A site picks one per
 *      scenario with `transitions` in docs.config.js (the generator stamps it
 *      on the wrapper as data-bd-transitions) or bdBarbaOptions.transitionMap.
 *
 *   3. Library — TRANSITIONS { "slide-up": { leave(), enter() }, ... }
 *      Named animations using WAAPI. New ones join the kit here, and reach
 *      every site by version bump. TRANSITION_NAMES in generate-docs.js lists
 *      the same names, so a config naming one that doesn't exist fails the
 *      build; the router check (bd-verify-router) keeps the two lists equal.
 *
 *   4. Motion tokens — MOTION { pageOpen, pageClose, pageSwap, pageFade, pageReduced }
 *      Read once from --motion-page-* custom properties, with fallbacks so a
 *      page without the tokens still transitions.
 *
 *   5. Scroll compensation — scroll-then-animate
 *      scrollTo(0,0) runs in leave() BEFORE the animation starts. The leaving
 *      container receives a negative translateY offset so it visually stays
 *      put. Sticky elements are pinned separately ("Sticky compensation").
 *
 * Built in, on every site:
 *   - an open <dialog> closes before the leave (window.bdCloseOpenDialogs)
 *   - Barba's aria-live="polite" comes off the wrapper, which would make the
 *     whole page one live region; focus moving to the arriving <main> is the
 *     arrival cue instead
 *   - focus moves to the arriving page's <main>, or to the heading a
 *     fragment names
 *   - the login page's folder (Worker routes, sign-out among them), /api/,
 *     Ask for access and every bare page (none has a container) always load
 *     in full, read from window.bdPaths, which nav.js sets first
 *   - the leaving page is inert for its slide, out of the accessibility tree
 *     and the tab order
 *   - <main> is named after the page's heading, so the focus move announces
 *     the page
 *   - reduced motion swaps every transition for a short crossfade
 *
 * Consumer contract (docs-kit README, "Page transitions"):
 *   - Every page loads the full script and style set: head scripts and
 *     stylesheets are never synced across a navigation.
 *   - Page modules start on BOTH DOMContentLoaded and "bd:after-nav", are
 *     idempotent, scope queries to event.detail.container, and tear down on
 *     "bd:before-nav". No module is on a list in this file.
 *
 * Options — set window.bdBarbaOptions in any script loaded BEFORE this one
 * (all keys optional; read once when this file loads):
 *   preventPaths     RegExp[]  extra URL patterns the router must not intercept
 *   preventWhen      function  () => boolean, extra prevent guard
 *   libraryPatterns  RegExp[]  appended to the load-once library patterns
 *   metaSelectors    string[]  appended to the head-meta sync selectors
 *   transitionMap    object    partial scenario → animation name, applied
 *                              after the config's `transitions`
 *   motion           object    element motion, played at the moments the
 *                              layout each step needs is true (bd-animate.js
 *                              registers it):
 *     reducedMotion() → boolean   an extra reduced-motion switch
 *     freeze(container)           beforeLeave: stop the leaving page's triggers
 *     out(container) → Promise    leave, before the slide: exits play in place
 *     in(container, { arriving, offset })
 *                                 enter, before the slide in: the entrance
 *                                 cascade, offset in seconds into the slide
 *     show(container)             last resort when in or land throws
 *     land(container) → boolean   after, once the old page is gone; true when
 *                                 the page has scroll triggers, so a fragment
 *                                 lands instantly rather than gliding
 *   onBeforeLeave    function  (data) — runs in beforeLeave, after bd:before-nav
 *   onAfterNav       function  (container) — runs just before bd:after-nav
 *   onNextDocument   function  (doc) — parsed next page, for outside-container carry
 *   timeout          number    barba.init request timeout in ms (default 5000)
 *   cacheIgnore      boolean   barba cache control (default false)
 *   prefetchIgnore   boolean   barba hover-prefetch control (default true)
 *
 * Events dispatched on document:
 *   "bd:before-nav"  { detail: { container } }  the leaving page, before the leave
 *   "bd:after-nav"   { detail: { container } }  the arriving page, in `after`:
 *                    the old page is gone, is-animating is off, layout is final
 *
 * @version 5.2.0
 */
(function () {
  'use strict';

  var VERSION = '5.2.0';

  if (typeof barba === 'undefined') {
    console.warn('[barba-docs] Barba core not loaded — page transitions disabled');
    return;
  }

  // A second router on the same document doubles every navigation. Bail if
  // this file (or another Barba bootstrap using the same sentinel) ran already.
  if (window.__bdBarbaDocs) {
    console.warn('[barba-docs] already initialized — skipping duplicate init');
    return;
  }
  window.__bdBarbaDocs = true;

  var OPTIONS = window.bdBarbaOptions || {};
  var MOTION_HOOKS = OPTIONS.motion && typeof OPTIONS.motion === 'object' ? OPTIONS.motion : {};

  function optionFn(name) {
    return typeof OPTIONS[name] === 'function' ? OPTIONS[name] : null;
  }

  function motionFn(name) {
    return typeof MOTION_HOOKS[name] === 'function' ? MOTION_HOOKS[name] : null;
  }

  console.log('[barba-docs] v' + VERSION + ' init');

  // ── Utilities ──

  // The motion option's switch (bd-animate's test switch) counts as well as
  // the system setting, so the router and the element motion agree.
  function prefersReducedMotion() {
    var extra = motionFn('reducedMotion');
    if (extra) {
      try {
        if (extra() === true) return true;
      } catch (e) {
        console.warn('[barba-docs] motion.reducedMotion error:', e);
      }
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── Landing on a fragment ──

  // The element a fragment names, or null. Decoded first so a percent-encoded
  // id resolves, then raw, for an id that merely looks encoded.
  function findHashTarget(hash) {
    if (!hash || hash.length < 2) return null;
    var id = hash.slice(1);
    var target = null;
    try {
      target = document.getElementById(decodeURIComponent(id));
    } catch (err) {
      target = null;
    }
    return target || document.getElementById(id);
  }

  // Scroll the target into view and move focus to it (the skip-link
  // pattern the TOC uses). scroll-margin-top keeps it clear of sticky
  // chrome. Smooth only when asked and motion is allowed; preventScroll so
  // focus never fights the scroll.
  function landOn(target, smooth) {
    target.scrollIntoView({
      block: 'start',
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'instant'
    });
    focusLandingPoint(target);
  }

  // Focus an element that is not a control, for the moment of arrival only.
  // The tabindex the router adds (marked data-bd-landing) goes again once
  // focus really leaves, so a later click on plain text never makes it the
  // active element. A window blur (Alt-Tab, the address bar) leaves it the
  // active element and is ignored, so focus can come back to it. A tabindex
  // the page wrote, before or since, is never touched.
  function focusLandingPoint(el) {
    var added = !el.hasAttribute('tabindex');
    if (added) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-bd-landing', '');
    }
    el.focus({ preventScroll: true });
    if (!added) return;
    // Focus didn't take (the target is hidden or inert): undo at once
    if (document.activeElement !== el) {
      releaseLandingPoint(el);
      return;
    }
    el.addEventListener('blur', function dropLanding() {
      if (document.activeElement === el) return;
      el.removeEventListener('blur', dropLanding);
      releaseLandingPoint(el);
    });
  }

  function releaseLandingPoint(el) {
    if (!el.hasAttribute('data-bd-landing')) return;
    el.removeAttribute('data-bd-landing');
    if (el.getAttribute('tabindex') === '-1') el.removeAttribute('tabindex');
  }

  // An unnamed main is announced as "main" alone, so it is named after the
  // page's heading ("Button, main"), on a hard load and on every arrival
  // alike. A name the page gives it wins, and a heading's own aria-label
  // (SplitText sets one on text it splits) wins over its text.
  function nameMain(container) {
    var main = container ? container.querySelector('main') : null;
    if (!main || main.hasAttribute('aria-label') || main.hasAttribute('aria-labelledby')) return main;
    var heading = main.querySelector('.page-header-title') || main.querySelector('h1');
    // innerText, not textContent: a heading can hold alternatives hidden
    // with display:none (locked.html's three role lines), which textContent
    // reads all of. textContent where nothing is rendered (a test DOM).
    var text = heading ? (typeof heading.innerText === 'string' && heading.innerText ? heading.innerText : heading.textContent) : '';
    var name = heading ? (heading.getAttribute('aria-label') || text || '').replace(/\s+/g, ' ').trim() : '';
    if (name) main.setAttribute('aria-label', name);
    return main;
  }

  // After a swap focus would sit on <body>: a keyboard reader would Tab from
  // the top of the header again, and a screen reader announces nothing. The
  // arriving <main> takes it, named after the page (nameMain). Not the
  // heading itself: its entrance may still be finishing, and focus completes
  // a pending entrance at once (bd-animate.js onFocusIn), which would snap
  // it. A module that has already placed focus in the arriving page (an
  // autofocused field) keeps it. preventScroll keeps the page at the top.
  function focusArrival(container) {
    if (!container) return;
    if (document.activeElement && document.activeElement !== document.body
      && container.contains(document.activeElement)) return;
    var main = nameMain(container);
    if (main) focusLandingPoint(main);
  }

  // @barba/core sets aria-live="polite" on the wrapper in init(), which makes
  // every page one live region: each tool readout, every "Copied!" and the
  // whole arriving page get queued for announcement. The focus move above
  // is the arrival cue.
  function quietWrapper() {
    var wrapper = document.querySelector('[data-barba="wrapper"]');
    if (wrapper) wrapper.removeAttribute('aria-live');
  }

  // /docs/ and /docs/index.html are the same page on most hosts, but Barba
  // compares raw URLs.
  function normPath(path) {
    return path.replace(/\/index\.html$/, '/');
  }

  // A link to the page already on screen, by path and query. Barba's click
  // handler does not look at defaultPrevented, so shouldPrevent asks this too.
  function isSamePageLink(link) {
    if (!link || !link.pathname) return false;
    if (link.origin !== window.location.origin) return false;
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) === '#') return false;
    return normPath(link.pathname) === normPath(window.location.pathname)
      && link.search === window.location.search;
  }

  function readNumberAttr(el, attr) {
    if (!el) return NaN;
    var raw = el.getAttribute(attr);
    if (raw === null || raw === '') return NaN;
    var n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : NaN;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Reduced motion is decided by transitionFor (a crossfade instead of the
  // travel), so this plays whatever it is given.
  function animate(el, keyframes, options) {
    return new Promise(function (resolve) {
      if (!el) {
        resolve();
        return;
      }
      var anim = el.animate(keyframes, options);
      anim.onfinish = resolve;
      anim.oncancel = resolve;
    });
  }

  // ── Routes the router must NOT intercept ──

  // Built in on every site, from the addresses nav.js writes before the
  // router loads (window.bdPaths, already under any basePath). The login
  // page's folder is Worker routes as well as pages: fetched by the router
  // (x-barba: yes) sign-out is not a navigation, so the Worker declines it
  // and the reader stays signed in. /api/ is the Worker's, never a page.
  // Ask for access and every other bare page has no container, and a swap
  // that finds none reloads the page it left.
  // Without bdPaths (a page with no nav.js), path segments cover the engine's
  // fixed /auth/, /api/ and /support.html, under a basePath too. The other
  // bare pages are named only in bdPaths, so this fallback misses them.
  var FALLBACK_PREVENT = [/(?:^|\/)auth\//, /(?:^|\/)api\//, /(?:^|\/)support\.html$/];

  // The folder a path sits in, with its trailing slash: /auth/login.html
  // gives /auth/. A path at the root gives null, which would match the site.
  function folderOf(p) {
    var cut = typeof p === 'string' ? p.lastIndexOf('/') : -1;
    return cut > 0 ? p.slice(0, cut + 1) : null;
  }

  // The leading part of the login page's path before the engine's own /auth/
  // segment: the basePath, '' on a site at the root
  function basePathOf(login) {
    var at = typeof login === 'string' ? login.lastIndexOf('/auth/') : -1;
    return at > -1 ? login.slice(0, at) : '';
  }

  function builtInPrevent() {
    var paths = window.bdPaths;
    if (!paths || typeof paths.login !== 'string') return null;
    var exact = {};
    // Sign-out sits in the login page's folder today; named as well, so a
    // move of either still leaves it to the browser
    var named = [paths.support, paths.signOut].concat(Array.isArray(paths.bare) ? paths.bare : []);
    for (var i = 0; i < named.length; i++) {
      if (typeof named[i] === 'string') exact[normPath(named[i])] = true;
    }
    return {
      prefixes: [folderOf(paths.login), basePathOf(paths.login) + '/api/'].filter(Boolean),
      exact: exact
    };
  }

  // Read once, when the router loads: nav.js runs before it
  var BUILT_IN = builtInPrevent();

  function isBuiltInPrevented(pathname) {
    if (!BUILT_IN) {
      for (var b = 0; b < FALLBACK_PREVENT.length; b++) {
        if (FALLBACK_PREVENT[b].test(pathname)) return true;
      }
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(BUILT_IN.exact, normPath(pathname))) return true;
    for (var p = 0; p < BUILT_IN.prefixes.length; p++) {
      if (pathname.indexOf(BUILT_IN.prefixes[p]) === 0) return true;
    }
    return false;
  }

  var PREVENT_PATHS = Array.isArray(OPTIONS.preventPaths) ? OPTIONS.preventPaths : [];
  var preventWhen = optionFn('preventWhen');

  // The path a link resolves to on this site, or null for another origin.
  function sitePath(url) {
    try {
      var resolved = new URL(url, window.location.href);
      return resolved.origin === window.location.origin ? resolved.pathname : null;
    } catch (e) {
      return null;
    }
  }

  function shouldPrevent(opts) {
    if (preventWhen && preventWhen()) return true;

    var el = opts && opts.el;
    if (el) {
      if (el.hasAttribute && el.hasAttribute('data-barba-prevent')) return true;
      // A locked link (see nav.js applyAccess) neither navigates nor
      // prefetches once a session answer has landed - signed out, a guest
      // beyond their grants, a team member beside an admin page. nav.js
      // stops the native follow; this stops the router, which does not look
      // at defaultPrevented. aria-disabled is the mark on every locked
      // element, sidebar item, card or pager link alike.
      // The nearest lockable item decides, as nav.js guardLockedClick does: an
      // open section-index link inside a locked section summary is not
      // locked, so an ancestor's mark must not refuse it.
      var lockItem = window.bdSession && el.closest
        && el.closest('.site-sidebar a[href], .page-nav-link, .book-contents-item, .book-cover');
      if (lockItem && lockItem.getAttribute('aria-disabled') === 'true') return true;
      if (el.hasAttribute && el.hasAttribute('download')) return true;
      if (el.target === '_blank') return true;
      if (isSamePageLink(el)) return true;

      var href = el.getAttribute && el.getAttribute('href');
      if (href) {
        if (href.charAt(0) === '#') return true;
        if (href.indexOf('mailto:') === 0) return true;
        if (href.indexOf('tel:') === 0) return true;
      }
    }

    var url = opts && opts.href;
    if (url) {
      var pathname = sitePath(url);
      if (pathname !== null && isBuiltInPrevented(pathname)) return true;
      for (var i = 0; i < PREVENT_PATHS.length; i++) {
        if (PREVENT_PATHS[i].test(url)) return true;
      }
    }

    return false;
  }

  // For a script that navigates with barba.go(), which never asks
  // shouldPrevent: true when a full load is the right one (bd-video.js cues)
  window.bdRouterPrevents = function bdRouterPrevents(href) {
    return shouldPrevent({ href: href });
  };

  // Clicking a link to the page already on screen: Barba's built-in sameUrl
  // check bails WITHOUT preventDefault, so the browser hard-reloads the page.
  // Intercept at capture phase instead. With a fragment the click lands on
  // the target in place, replacing the history entry; without one it does
  // nothing. Bare `#x` links stay native (shouldPrevent), as do modified
  // clicks and new-tab targets.
  function interceptSameUrlClick(e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    if (link.hasAttribute('data-barba-prevent')) return;
    if (!isSamePageLink(link)) return;

    if (!link.hash) {
      e.preventDefault();
      return;
    }
    // Always handled here: shouldPrevent has already taken the link away
    // from Barba, so falling through would let the browser reload the page.
    e.preventDefault();
    history.replaceState(history.state, '', link.hash);
    // Keep Barba's own record of the entry in step with the address bar
    // (the pattern search.js follows).
    if (window.barba && barba.history && typeof barba.history.update === 'function') {
      barba.history.update({ url: window.location.href });
    }
    var target = findHashTarget(link.hash);
    if (target) landOn(target, true);
  }

  document.addEventListener('click', interceptSameUrlClick, true);

  // ── Head meta updater ──
  // Syncs meta/link values only. Scripts and stylesheets are deliberately
  // never synced — every page must load the full set (see consumer contract).

  var META_SELECTORS = [
    'meta[name="description"]',
    'meta[name="theme-color"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:image"]',
    'meta[property="og:url"]',
    'meta[property="og:type"]',
    'meta[name="twitter:card"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
    'meta[name="twitter:image"]',
    'link[rel="canonical"]'
  ].concat(Array.isArray(OPTIONS.metaSelectors) ? OPTIONS.metaSelectors : []);

  // Parse the incoming page once. Things outside the Barba container — the
  // <head>, the nav mount — are never swapped by a navigation and have to be
  // lifted out of the fetched HTML by hand.
  function parseNextDocument(nextHtml) {
    if (!nextHtml) return null;
    try {
      return new DOMParser().parseFromString(nextHtml, 'text/html');
    } catch (e) {
      return null;
    }
  }

  /**
   * Carry the sidebar's page-level default across a navigation.
   *
   * `data-sidebar-default` sits on #site-nav, an ancestor of the Barba wrapper,
   * so it survives every swap untouched. nav.js reads it once at init, so
   * without this a page asking for a collapsed sidebar gets it only on a hard
   * load — and once collapsed it would stay collapsed everywhere, because
   * nothing ever lifts it again.
   *
   * A saved preference always wins. A page may propose a starting state; it
   * may not overrule a choice the reader has made.
   */
  function applySidebarDefault(doc) {
    var mount = document.getElementById('site-nav');
    if (!doc || !mount || mount.getAttribute('data-sidebar') === 'false') return;

    var next = doc.getElementById('site-nav');
    var wanted = !!next && next.getAttribute('data-sidebar-default') === 'collapsed';

    // Keep the live mount's attribute honest — it is what any later read sees.
    if (next && next.hasAttribute('data-sidebar-default')) {
      mount.setAttribute('data-sidebar-default', next.getAttribute('data-sidebar-default'));
    } else {
      mount.removeAttribute('data-sidebar-default');
    }

    // A locked sidebar (signed out, see nav.js applyAccess) keeps the
    // state it has: it painted collapsed, and anything since is the reader's
    // own toggling. This hook also runs on the first load, so without the
    // guard it would open the rail a signed-out reader is meant to start on.
    if (document.body.classList.contains('is-signed-out')) return;

    var saved = null;
    try {
      saved = localStorage.getItem('docs-sidebar-collapsed');
    } catch (e) {
      return;
    }
    if (saved !== null) return;

    document.body.classList.toggle('sidebar-collapsed', wanted);
    var toggle = mount.querySelector('.site-sidebar-toggle');
    if (toggle) {
      var label = wanted ? 'Expand sidebar' : 'Collapse sidebar';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('data-tooltip', label);
    }
  }

  function updateHeadMeta(doc) {
    if (!doc || !doc.head) return;

    if (doc.title) document.title = doc.title;

    META_SELECTORS.forEach(function (sel) {
      var nextEl = doc.head.querySelector(sel);
      var currentEl = document.head.querySelector(sel);
      if (nextEl && currentEl) {
        for (var i = 0; i < nextEl.attributes.length; i++) {
          var attr = nextEl.attributes[i];
          currentEl.setAttribute(attr.name, attr.value);
        }
      } else if (nextEl && !currentEl) {
        document.head.appendChild(nextEl.cloneNode(true));
      }
    });
  }

  // ── Per-page <script> re-execution ──

  var LIBRARY_PATTERNS = [
    /\/vendor\//,
    /cdn\.jsdelivr\.net/,
    /cdnjs\.cloudflare\.com/,
    /unpkg\.com/,
    /splidejs/,
    /highlight\.js/
  ].concat(Array.isArray(OPTIONS.libraryPatterns) ? OPTIONS.libraryPatterns : []);
  var loadedLibSrcs = new Set();

  function isLibraryScript(src) {
    if (!src) return false;
    for (var i = 0; i < LIBRARY_PATTERNS.length; i++) {
      if (LIBRARY_PATTERNS[i].test(src)) return true;
    }
    return false;
  }

  function seedLoadedLibraries() {
    document.querySelectorAll('script[src]').forEach(function (s) {
      if (isLibraryScript(s.src)) loadedLibSrcs.add(s.src);
    });
  }

  // Re-executes <script> tags found INSIDE data-barba="container" on every
  // arrival — a fetched page's scripts never run by themselves. Library
  // scripts matching LIBRARY_PATTERNS are loaded once and skipped after.
  // Modules load at the end of <body>, outside the container, and start
  // themselves on bd:after-nav, so this is for inline scripts that belong to
  // one page only.
  function reExecuteContainerScripts(container) {
    if (!container) return;
    var scripts = container.querySelectorAll('script');
    scripts.forEach(function (oldScript) {
      // A data block (type="application/json", an icon manifest) has nothing
      // to execute: cloning it re-copies its text for no effect and drops any
      // node reference held across the swap. Only JavaScript types re-run.
      var type = (oldScript.getAttribute('type') || '').trim().toLowerCase();
      if (type && type !== 'module' && !/javascript|ecmascript/.test(type)) return;

      if (oldScript.src && isLibraryScript(oldScript.src)) {
        if (loadedLibSrcs.has(oldScript.src)) return;
        loadedLibSrcs.add(oldScript.src);
      }

      var newScript = document.createElement('script');
      for (var i = 0; i < oldScript.attributes.length; i++) {
        var attr = oldScript.attributes[i];
        newScript.setAttribute(attr.name, attr.value);
      }
      newScript.async = false;
      if (!oldScript.src) {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  // ── Element motion (bdBarbaOptions.motion) ──
  //
  // Element motion is played from the hooks rather than from bd:after-nav,
  // because each step needs a particular layout to be true:
  //
  //   beforeLeave  freeze(current)   triggers on the leaving page stop before
  //                leave() scrolls to 0 under it, or a non-once trigger would
  //                rewind. Never a revert here: the page is on screen for the
  //                whole slide.
  //   leave        out(current)      first, while the page is still in flow
  //                and scrolled. After the scroll reset the container sits at
  //                top: 0 with no transform until the leave's first keyframe,
  //                so an exit there would play on the wrong part of the page.
  //   enter        in(next, opts)    the entrance cascade starts
  //                --motion-page-content-offset into the slide, so content
  //                settles with the page. arriving: before the slide, so the
  //                container is laid out where it will land and not moving.
  //   after        land(next)        the old container is out of the
  //                document and the new one is in flow with no transform, so
  //                scroll reveals measure the real layout.
  //
  // A hard load is the motion module's own: Barba's once path never runs
  // leave, enter or after. Every call is guarded, so a page without the
  // module (scripts blocked, a site that leaves it out) keeps its transitions.

  // Set in beforeLeave for the transition about to run, so leave and enter
  // read the same scenario and enter waits on the exit whichever of the two
  // Barba invokes first (their order is positional in the vendor; a global
  // leave or enter hook registered later would swap it).
  var pendingScenario = 'fade';
  // The incoming page, parsed once in beforeEnter, read by enter's arrive()
  // for the sidebar's page default and by afterEnter for the head. The
  // default is applied in arrive(), after the exit has held the sticky
  // elements, so its 400ms toggle plays under the page's own slide and has
  // settled by the time the landed page measures its reveals; applied in
  // afterEnter it moved as a second motion of its own, and applied in
  // beforeEnter the leaving page rewrapped under its own slide.
  var arrivingDoc = null;
  var exitDone = null;
  var resolveExit = null;

  function motionFreeze(container) {
    var freeze = motionFn('freeze');
    if (!freeze) return;
    try {
      freeze(container);
    } catch (e) {
      console.warn('[barba-docs] motion.freeze error:', e);
    }
  }

  function motionShow(container) {
    var show = motionFn('show');
    if (!show) return;
    try {
      show(container);
    } catch (e) {
      console.warn('[barba-docs] motion.show error:', e);
    }
  }

  function motionOut(container) {
    var out = motionFn('out');
    if (!out) return Promise.resolve();
    try {
      return Promise.resolve(out(container)).catch(function (e) {
        console.warn('[barba-docs] motion.out error:', e);
      });
    } catch (e) {
      console.warn('[barba-docs] motion.out error:', e);
      return Promise.resolve();
    }
  }

  // arriving: reveals already on screen join the entrance cascade rather than
  // playing again once the page lands. Not for a fragment link: after()
  // scrolls the page away from where it was measured. offsetMs: the cascade
  // starts that far into the transition.
  function motionIn(container, arriving, offsetMs) {
    var enter = motionFn('in');
    if (!enter) return;
    try {
      enter(container, { arriving: arriving, offset: (offsetMs || 0) / 1000 });
    } catch (e) {
      console.warn('[barba-docs] motion.in error:', e);
      motionShow(container);
    }
  }

  function motionLand(container) {
    var land = motionFn('land');
    if (!land) return false;
    try {
      return land(container) === true;
    } catch (e) {
      console.warn('[barba-docs] motion.land error:', e);
      motionShow(container);
      return false;
    }
  }

  // ── Post-navigation re-init ──
  // Runs from barba.hooks.after — the leaving container is gone, is-animating
  // is off, and scroll is settled, so inits see a clean single-container DOM.

  function refreshPageInit(container) {
    try {
      // Kit chrome re-inits — each guard no-ops when the script isn't loaded.
      if (typeof window.bdInitHighlight === 'function') window.bdInitHighlight(container);
      if (typeof window.bdInitTOCActiveState === 'function') window.bdInitTOCActiveState();
      if (typeof window.bdInitTableScroll === 'function') window.bdInitTableScroll();
      if (typeof window.refreshNavActive === 'function') window.refreshNavActive();
      if (typeof window.bdInitCopyButtons === 'function') window.bdInitCopyButtons();
      if (typeof window.bdInitDocsCopyChrome === 'function') window.bdInitDocsCopyChrome();
    } catch (e) {
      console.warn('[barba-docs] chrome re-init error:', e);
    }

    // A throw here must not stop bd:after-nav or the motion landing after it,
    // which would leave held elements hidden.
    try {
      reExecuteContainerScripts(container);
    } catch (e) {
      console.warn('[barba-docs] container script re-run error:', e);
    }

    var onAfterNav = optionFn('onAfterNav');
    if (onAfterNav) {
      try {
        onAfterNav(container);
      } catch (e) {
        console.warn('[barba-docs] onAfterNav error:', e);
      }
    }

    // Notify page modules that the new container is settled in the DOM.
    // Every module subscribes to this itself and starts on the new container.
    document.dispatchEvent(new CustomEvent('bd:after-nav', {
      detail: { container: container }
    }));
  }

  // ── Scenario resolver ──
  //
  // Reads data-level and data-section from both containers and returns a
  // semantic scenario name. The generator emits these attributes on every
  // container. The hierarchy for docs is:
  //   L0 = home             (data-level="0")
  //   L1 = section index    (data-level="1")
  //   L2 = doc page or tool (data-level="2")
  //
  // Scenario rules:
  //   deeper (L0 → L1, L1 → L2) → "open"      (drilling in)
  //   shallower                 → "close"     (backing out)
  //   L2 → L2 (same section)    → "swap"      (sibling nav, forward in reading order)
  //                             → "swap-back" (sibling nav, backward — lower data-order)
  //   L2 → L2 (diff section)    → "open"      (cross-book jump)
  //   L1 → L1                   → "swap"      (section-to-section)
  //   anything else / NaN       → "fade"      (fallback — pages without data-level)

  function resolveScenario(fromEl, toEl) {
    var fromLevel = readNumberAttr(fromEl, 'data-level');
    var toLevel = readNumberAttr(toEl, 'data-level');

    if (!Number.isFinite(fromLevel) || !Number.isFinite(toLevel)) return 'fade';

    var fromSection = (fromEl.getAttribute('data-section') || '');
    var toSection = (toEl.getAttribute('data-section') || '');
    var sameSection = fromSection === toSection && fromSection !== '';

    // Drilling deeper (index → doc page)
    if (toLevel > fromLevel) return 'open';

    // Backing out (doc page → index)
    if (toLevel < fromLevel) return 'close';

    // Same level — sibling or cross-section
    if (fromLevel === 2 && !sameSection) return 'open';

    // L2 sibling within a section: direction from reading order.
    // data-order is per-section, monotonic, Overview=0 (see generate-docs.js).
    // Going backward (lower order) mirrors the swap into a rightward slide.
    if (fromLevel === 2 && sameSection) {
      var fromOrder = readNumberAttr(fromEl, 'data-order');
      var toOrder = readNumberAttr(toEl, 'data-order');
      if (Number.isFinite(fromOrder) && Number.isFinite(toOrder) && toOrder < fromOrder) {
        return 'swap-back';
      }
      return 'swap';
    }

    if (fromLevel >= 1) return 'swap';

    return 'fade';
  }

  // ── Motion tokens ──
  // Read from --motion-page-* custom properties (design-system.css), cached
  // once at init. The literal fallbacks are the tokens' own values
  // (cms/motion.md), so a site without the tokens gets the documented motion.
  // Durations are read in milliseconds, as the tokens are written.

  function readToken(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  function readMotion(scope, fallbackMs) {
    return {
      duration: parseInt(readToken('--motion-page-' + scope + '-duration'), 10) || fallbackMs,
      easing:   readToken('--motion-page-' + scope + '-easing') || 'cubic-bezier(0.65, 0, 0.35, 1)'
    };
  }

  var MOTION = {
    pageOpen:  readMotion('open', 1200),
    pageClose: readMotion('close', 1200),
    pageSwap:  readMotion('swap', 1200),
    pageFade:  readMotion('fade', 600),
    // Reduced motion swaps every transition for this crossfade: the reader
    // still sees the page change, with no travel and no scale.
    pageReduced: readMotion('reduced', 200)
  };

  // How far into a page transition the arriving content starts, as a share
  // of the scenario's duration, so page and content land as one gesture.
  var CONTENT_OFFSET = (function readOffset() {
    var value = parseFloat(readToken('--motion-page-content-offset'));
    return isFinite(value) && value >= 0 && value < 1 ? value : 0;
  })();

  // ── Animation library ──
  //
  // Named animations using WAAPI. Each has leave(el, motion, opts) and
  // enter(el, motion, opts). They receive:
  //   el     — the Barba container to animate
  //   motion — { duration, easing } from the scenario's motion token
  //   opts   — { scrollOffset } (leave only — for scroll compensation)
  //
  // Scroll compensation: scrollTo(0,0) runs in leave() BEFORE any animation.
  // The leave container receives translateY(scrollOffset) (a negative value)
  // so it visually stays put. Enter animations use natural positions
  // (translateY(0) at rest), so WAAPI fill:forwards only persists identity
  // transforms — no cleanup issues.
  //
  // A new transition joins here and in TRANSITION_NAMES (generate-docs.js).

  // How much the index recedes during a page open (stylistic, not a token)
  var INDEX_SCALE_DOWN = 0.96;
  var INDEX_DIM_OPACITY = 0.7;
  var INDEX_TRANSFORM_ORIGIN = '50% 0%';

  var TRANSITIONS = {

    // -- slide-up --
    // Default for "open". New page rises from below; index (the leaving
    // container) scales down slightly and dims — selling the layered depth
    // of the page model.
    'slide-up': {
      leave: function slideUpLeave(el, motion, opts) {
        var offset = (opts && opts.scrollOffset) || 0;
        var startY = offset + 'px';
        // Scale around the top of the viewport, not the top of the container
        // (scrollY above it), or the visible page drifts up as it recedes.
        el.style.transformOrigin = '50% ' + (-offset) + 'px';
        return animate(el,
          [
            { transform: 'translateY(' + startY + ') scale(1)',                                opacity: 1 },
            { transform: 'translateY(' + startY + ') scale(' + INDEX_SCALE_DOWN + ')', opacity: INDEX_DIM_OPACITY }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      },
      enter: function slideUpEnter(el, motion) {
        return animate(el,
          [
            { transform: 'translateY(100%)', opacity: 1 },
            { transform: 'translateY(0)',    opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      }
    },

    // -- slide-down --
    // Default for "close". Leaving page falls off the bottom; index (the
    // entering container) scales back up from INDEX_SCALE_DOWN → 1 and
    // brightens — the inverse of slide-up's leaving animation.
    'slide-down': {
      leave: function slideDownLeave(el, motion, opts) {
        var offset = (opts && opts.scrollOffset) || 0;
        var startY = offset + 'px';
        return animate(el,
          [
            { transform: 'translateY(' + startY + ')',                  opacity: 1 },
            { transform: 'translateY(calc(' + startY + ' + 100%))', opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      },
      enter: function slideDownEnter(el, motion) {
        el.style.transformOrigin = INDEX_TRANSFORM_ORIGIN;
        return animate(el,
          [
            { transform: 'scale(' + INDEX_SCALE_DOWN + ')', opacity: INDEX_DIM_OPACITY },
            { transform: 'scale(1)',                         opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      }
    },

    // -- slide-left --
    // Default for "swap". Leaving page exits left while entering page arrives
    // from the right — forward sibling navigation.
    'slide-left': {
      leave: function slideLeftLeave(el, motion, opts) {
        var offset = (opts && opts.scrollOffset) || 0;
        var startY = offset + 'px';
        return animate(el,
          [
            { transform: 'translateY(' + startY + ') translateX(0)',     opacity: 1 },
            { transform: 'translateY(' + startY + ') translateX(-100%)', opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      },
      enter: function slideLeftEnter(el, motion) {
        return animate(el,
          [
            { transform: 'translateX(100%)', opacity: 1 },
            { transform: 'translateX(0)',    opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      }
    },

    // -- slide-right --
    // Reverse of slide-left. Leaving page exits right, entering arrives
    // from the left — backward sibling navigation.
    'slide-right': {
      leave: function slideRightLeave(el, motion, opts) {
        var offset = (opts && opts.scrollOffset) || 0;
        var startY = offset + 'px';
        return animate(el,
          [
            { transform: 'translateY(' + startY + ') translateX(0)',    opacity: 1 },
            { transform: 'translateY(' + startY + ') translateX(100%)', opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      },
      enter: function slideRightEnter(el, motion) {
        return animate(el,
          [
            { transform: 'translateX(-100%)', opacity: 1 },
            { transform: 'translateX(0)',     opacity: 1 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      }
    },

    // -- fade --
    // Crossfade fallback for unknown or same-page navigations.
    'fade': {
      leave: function fadeLeave(el, motion, opts) {
        var offset = (opts && opts.scrollOffset) || 0;
        var startY = offset + 'px';
        return animate(el,
          [
            { transform: 'translateY(' + startY + ')', opacity: 1 },
            { transform: 'translateY(' + startY + ')', opacity: 0 }
          ],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      },
      enter: function fadeEnter(el, motion) {
        return animate(el,
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
        );
      }
    }
  };

  // Reduced motion: the leaving page holds still at the reader's position and
  // the arriving one fades in over it, so contrast never dips the way two
  // layers fading against each other would. No travel, no scale.
  var REDUCED_TRANSITION = {
    leave: function reducedLeave(el, motion, opts) {
      var startY = ((opts && opts.scrollOffset) || 0) + 'px';
      return animate(el,
        [{ transform: 'translateY(' + startY + ')' }, { transform: 'translateY(' + startY + ')' }],
        { duration: motion.duration, fill: 'forwards' }
      );
    },
    enter: function reducedEnter(el, motion) {
      return animate(el,
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: motion.duration, easing: motion.easing, fill: 'forwards' }
      );
    }
  };

  // ── Transition map ──
  // Maps each scenario (what's happening) to an animation name (what it looks
  // like). The site's config (data-bd-transitions on the wrapper, from
  // `transitions` in docs.config.js) applies first, then
  // bdBarbaOptions.transitionMap. The animation always receives the
  // *scenario's* motion token, so timing still matches intent even if the
  // visual changes.

  var TRANSITION_MAP = {
    open:        'slide-up',
    close:       'slide-down',
    swap:        'slide-left',
    'swap-back': 'slide-right',
    fade:        'fade'
  };

  function applyTransitionChoices(choices, source) {
    if (!choices || typeof choices !== 'object') return;
    Object.keys(choices).forEach(function (scenario) {
      var name = choices[scenario];
      if (!Object.prototype.hasOwnProperty.call(TRANSITION_MAP, scenario)) {
        console.warn('[barba-docs] ' + source + ': no scenario called "' + scenario + '"');
        return;
      }
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(TRANSITIONS, name)) {
        console.warn('[barba-docs] ' + source + ': no transition called "' + name + '" (scenario "' + scenario + '" keeps "' + TRANSITION_MAP[scenario] + '")');
        return;
      }
      TRANSITION_MAP[scenario] = name;
    });
  }

  function readConfigTransitions() {
    var wrapper = document.querySelector('[data-barba="wrapper"]');
    var raw = wrapper && wrapper.getAttribute('data-bd-transitions');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[barba-docs] data-bd-transitions is not JSON:', e);
      return null;
    }
  }

  // ── Runners ──
  // Look up the animation for a scenario and run it. The animation always
  // receives the scenario's motion token, so timing follows intent even if
  // you remap which animation a scenario uses.

  // Motion token for a scenario. A "-back" scenario (e.g. swap-back) is the
  // same motion event as its forward form, mirrored — so it reuses the same
  // token (swap-back → pageSwap). Strip the suffix before lookup.
  function motionFor(scenario) {
    var base = scenario.replace(/-back$/, '');
    return MOTION['page' + capitalize(base)] || MOTION.pageFade;
  }

  // The animation and motion a scenario plays: its own, or under reduced
  // motion the short crossfade, read at call time so a preference changed
  // mid-session applies to the next navigation.
  function transitionFor(scenario) {
    if (prefersReducedMotion()) return { transition: REDUCED_TRANSITION, motion: MOTION.pageReduced };
    var animationName = TRANSITION_MAP[scenario] || 'fade';
    return { transition: TRANSITIONS[animationName] || TRANSITIONS.fade, motion: motionFor(scenario) };
  }

  function runLeave(el, scenario, scrollOffset) {
    var t = transitionFor(scenario);
    return t.transition.leave(el, t.motion, { scrollOffset: scrollOffset });
  }

  function runEnter(el, scenario) {
    var t = transitionFor(scenario);
    return t.transition.enter(el, t.motion, {});
  }

  // ── Sticky compensation ──
  // leave() resets scroll to 0, so a bar or TOC that was stuck in the leaving
  // page unsticks — it drops back to its in-flow position and rides the
  // container's -scrollY offset off screen. Record where each sits on screen
  // before is-animating goes on, then translate it back afterwards. The
  // leaving container is discarded, so the inline `translate` needs no
  // cleanup. It composes with a transform but replaces any stylesheet
  // `translate` — no sticky element sets one today.

  function measureStickyElements(container) {
    var stuck = [];
    var nodes = container.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (getComputedStyle(el).position !== 'sticky') continue;
      if (!el.getClientRects().length) continue;
      if (isCoveredDockedHeader(el)) continue;
      stuck.push({ el: el, top: el.getBoundingClientRect().top });
    }
    return stuck;
  }

  // A docked page header (docs.css) stays stuck for the whole page while the
  // content scrolls up over it, so once the reader is past it, it is on
  // screen in geometry only. Holding it pinned the header, art and all, at
  // the top of the viewport for the length of the transition, hidden only by
  // the content painted over it, and content in a container sliding under a
  // composited transform is not always painted in time: wherever it lagged,
  // the header showed through. Left unheld, it drops back into flow above the
  // wrapper's clipped edge and leaves with the container, out of view from
  // the first frame. Hidden means behind the cover, or behind the opaque bar
  // once it has docked at the header's top, so a docked bar moves the visible
  // edge down to its bottom. A header still partly in view is held as before.
  // A page without a docked header never matches.
  function isCoveredDockedHeader(el) {
    if (!el.matches('main > .page-header')) return false;
    var cover = el.parentElement.querySelector(':scope > .page-header ~ .docs-content-grid');
    if (!cover) return false;
    var edge = el.getBoundingClientRect().top;
    var bar = el.parentElement.querySelector(':scope > .bar');
    if (bar) {
      var barRect = bar.getBoundingClientRect();
      if (barRect.top <= edge + 0.5) edge = Math.max(edge, barRect.bottom);
    }
    return cover.getBoundingClientRect().top <= edge;
  }

  // Call after is-animating and the scroll reset, before the leave animation
  // applies scrollOffset — the delta accounts for that offset arithmetically.
  // Read and write stay interleaved on purpose: a sticky element nested in
  // another is measured after its parent has moved, so it corrects only the
  // remainder. Batching all reads first would correct it twice.
  function holdStickyElements(stuck, scrollOffset) {
    for (var i = 0; i < stuck.length; i++) {
      var item = stuck[i];
      var delta = item.top - item.el.getBoundingClientRect().top - scrollOffset;
      if (Math.abs(delta) < 0.5) continue;
      item.el.style.translate = '0 ' + delta + 'px';
    }
  }

  // ── Barba transition ──

  var bdTransition = {
    name: 'bd-directional',
    sync: true,
    leave: function bdLeave(data) {
      var current = data.current.container;
      var scenario = pendingScenario;

      // Mark scenario + role on both containers for the CSS z-index rules.
      // Under reduced motion the arriving page fades in on top whatever the
      // scenario, so the layers take the fade order (barba-transitions.css).
      // The enter role also keeps the arriving container hidden while an
      // exit plays (barba-transitions.css), until is-animating goes on.
      var layer = prefersReducedMotion() ? 'fade' : scenario;
      current.setAttribute('data-bd-scenario', layer);
      current.setAttribute('data-bd-role', 'leave');
      data.next.container.setAttribute('data-bd-scenario', layer);
      data.next.container.setAttribute('data-bd-role', 'enter');

      // Exits first, in place (see "Element motion"). With nothing to exit
      // the promise is already resolved, so the slide below starts on the
      // next microtask, before any frame is painted.
      var exit = motionOut(current);
      // Registered before the release below, so the entrance cascade in
      // enter() can never run ahead of is-animating.
      var slide = exit.then(function slide() {
        // Scroll compensation: capture scroll FIRST, then add is-animating.
        // is-animating switches containers to position:absolute, which can
        // collapse the wrapper's layout row and clamp scroll to 0 — so scrollY
        // must be read before the class is added.
        var scrollY = window.scrollY || 0;
        var stuck = scrollY > 0 ? measureStickyElements(current) : [];
        document.body.classList.add('is-animating');
        // From here the leaving page is no longer the page: inert takes it out
        // of the accessibility tree and the tab order for the slide, so a
        // screen reader's cursor can't wander into it. Set with is-animating,
        // whose pointer-events: none already ends hover and clicks, so the
        // only visible change is a focus ring on the clicked link going a
        // moment before the page does.
        current.inert = true;
        if (scrollY > 0) {
          // instant: a site may set scroll-behavior:smooth on html
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        }
        var scrollOffset = -scrollY;
        holdStickyElements(stuck, scrollOffset);

        return runLeave(current, scenario, scrollOffset);
      });
      if (resolveExit) exit.then(resolveExit, resolveExit);
      return slide;
    },
    enter: function bdEnter(data) {
      var next = data.next.container;
      var scenario = pendingScenario;
      // Waits on the exit, which resolves only after leave() has put
      // is-animating on and reset the scroll, so neither animation's first
      // frame can come before that.
      var arriving = !(data.next.url && data.next.url.hash);
      return (exitDone || Promise.resolve()).then(function arrive() {
        // The sidebar's page default, once the exit has run and the sticky
        // elements are held: the column moves under the page's slide, and
        // has settled before the landed page measures (see beforeEnter).
        if (arrivingDoc) applySidebarDefault(arrivingDoc);
        motionIn(next, arriving, transitionFor(scenario).motion.duration * CONTENT_OFFSET);
        return runEnter(next, scenario);
      });
    }
  };

  // ── Init ──

  function init() {
    seedLoadedLibraries();
    applyTransitionChoices(readConfigTransitions(), 'docs.config.js transitions');
    applyTransitionChoices(OPTIONS.transitionMap, 'bdBarbaOptions.transitionMap');

    barba.init({
      transitions: [bdTransition],
      prevent: shouldPrevent,
      // A second click mid-transition is ignored rather than hard-reloading.
      preventRunning: true,
      prefetchIgnore: OPTIONS.prefetchIgnore !== undefined ? OPTIONS.prefetchIgnore : true,
      cacheIgnore: OPTIONS.cacheIgnore !== undefined ? OPTIONS.cacheIgnore : false,
      // Barba's own default is 2000ms, which aborts slow fetches and falls
      // back to a hard navigation — invisible locally, flaky on slow hosts.
      timeout: Number.isFinite(OPTIONS.timeout) ? OPTIONS.timeout : 5000,
      debug: false
    });

    // barba.init has just set it; nothing sets it again.
    quietWrapper();
    nameMain(document.querySelector('[data-barba="container"]'));

    // A page the browser kept in its back-forward cache in the middle of a
    // transition (a prevented link or a forced load left it then) comes back
    // with both containers, the leaving one inert. Load it afresh instead.
    window.addEventListener('pageshow', function reloadIfMidTransition(event) {
      if (event.persisted && document.body.classList.contains('is-animating')) window.location.reload();
    });

    var onBeforeLeave = optionFn('onBeforeLeave');

    barba.hooks.beforeLeave(function (data) {
      arrivingDoc = null;
      var current = data && data.current ? data.current.container : null;
      var next = data && data.next ? data.next.container : null;
      pendingScenario = current && next ? resolveScenario(current, next) : 'fade';
      exitDone = new Promise(function (resolve) { resolveExit = resolve; });
      motionFreeze(current);
      // Teardown moment: the current container is still live and about to
      // leave. Page modules remove listeners/observers/timers here.
      document.dispatchEvent(new CustomEvent('bd:before-nav', {
        detail: { container: current }
      }));
      // A modal open across the swap would keep the entire next page inert
      // (showModal top-layer), or strand focus if its dialog is destroyed.
      // dialog.js defines it; a site that does not load dialog.js has no
      // modal to close.
      if (typeof window.bdCloseOpenDialogs === 'function') window.bdCloseOpenDialogs();

      if (onBeforeLeave) {
        try {
          onBeforeLeave(data);
        } catch (e) {
          console.warn('[barba-docs] onBeforeLeave error:', e);
        }
      }
    });

    // The arriving container is marked for the reader before it animates in
    // (nav.js applyAccess): under accessNav 'hidden' the index headings whose
    // cards the Worker cut go, and the pager and cards the reader cannot open
    // are locked from the first frame, not after the enter animation. Both
    // come from the generated nav.js; each is a no-op until there is a
    // session answer or nothing to prune.

    barba.hooks.beforeEnter(function (data) {
      var next = data && data.next ? data.next.container : null;
      if (!next) return;
      if (typeof window.bdPruneEmptyCardSections === 'function') window.bdPruneEmptyCardSections(next);
      if (typeof window.bdRelockSwapped === 'function') window.bdRelockSwapped(next);
      // Not on the first load, which has no leaving page (see afterEnter).
      if (!data.current || !data.current.container) return;
      arrivingDoc = parseNextDocument(data.next.html);
    });

    var onNextDocument = optionFn('onNextDocument');

    barba.hooks.afterEnter(function (data) {
      // The initial-load `once` flow fires global afterEnter too (with an
      // empty data.current). There is nothing to sync at first load, and a
      // site's onNextDocument must not fire with the page's own document.
      if (!data || !data.current || !data.current.container) return;

      var nextDoc = arrivingDoc || parseNextDocument(data.next.html);
      arrivingDoc = null;
      updateHeadMeta(nextDoc);
      if (onNextDocument && nextDoc) {
        try {
          onNextDocument(nextDoc);
        } catch (e) {
          console.warn('[barba-docs] onNextDocument error:', e);
        }
      }
    });

    barba.hooks.after(function (data) {
      document.body.classList.remove('is-animating');
      exitDone = null;
      resolveExit = null;

      var next = data && data.next ? data.next.container : null;

      // Clean up role/scenario attributes + inline styles left by animations
      if (next) {
        next.removeAttribute('data-bd-role');
        next.removeAttribute('data-bd-scenario');
        next.style.transform = '';
        next.style.transformOrigin = '';
        next.style.opacity = '';

        // fill:'forwards' effects are not inline styles — left in the effect
        // stack they keep the container permanently transformed, which makes
        // it a containing block for position:fixed descendants and a stacking
        // context. Enter animations end at identity, so cancelling is
        // visually a no-op.
        if (typeof next.getAnimations === 'function') {
          next.getAnimations().forEach(function (a) { a.cancel(); });
        }
      }

      if (!next) return;

      // Re-inits and bd:after-nav run here rather than afterEnter: the
      // leaving container is out of the DOM and layout is settled, so inits
      // can never bind to (or measure) the departing page.
      refreshPageInit(next);

      // Element motion lands after the modules have built the page, so its
      // reveals see what they added (see "Element motion").
      var hasTriggers = motionLand(next);

      // Land where the URL says: a pushState navigation gets no native
      // fragment scroll. After the inits, so a smooth scroll aims at the
      // final layout and no init's focus or scroll restore overrides it.
      // Read the hash off `location`: by now the URL has been pushed, so it
      // is right for a popstate as well as a click. A click arrives at the
      // top, then glides to the target; Back and Forward jump (data.trigger
      // is a string for those), and so does a page with scroll triggers,
      // whose refresh restores the scroll with scroll-behavior: auto and
      // would cut the glide short.
      // A fragment that names something outside the arriving page (#main, the
      // skip link's persistent target) is no landing point for it.
      var anchorTarget = findHashTarget(window.location.hash);
      if (anchorTarget && !next.contains(anchorTarget)) anchorTarget = null;
      if (anchorTarget) {
        var clicked = !!(data.trigger && data.trigger.nodeType === 1);
        landOn(anchorTarget, clicked && !hasTriggers);
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        focusArrival(next);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
