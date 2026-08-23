/**
 * barba-docs.js — Page transitions for docs-kit sites
 *
 * The portable core of the docs-kit's optional page-transition feature,
 * enabled with `pageTransitions: true` in docs.config.js. Derived from the
 * BrandOS site's assets/js/barba-init.js — that file is this one's sibling,
 * not its consumer: the two are maintained separately, so a fix made here
 * may need mirroring there and vice versa.
 *
 * Architecture:
 *
 *   1. Resolver — resolveScenario(fromEl, toEl) → "open" | "close" | "swap" | "swap-back" | "fade"
 *      Answers "what's happening?" based on data-level and data-section attributes.
 *
 *   2. Map — TRANSITION_MAP { open: "slide-up", close: "slide-down", ... }
 *      Answers "which animation runs for this scenario?"
 *      Override per scenario via bdBarbaOptions.transitionMap.
 *
 *   3. Library — TRANSITIONS { "slide-up": { leave(), enter() }, ... }
 *      Named animations using WAAPI. Each receives the scenario's motion token.
 *
 *   4. Motion tokens — MOTION { pageOpen, pageClose, pageSwap, pageFade }
 *      Read once from --motion-page-* CSS custom properties, with hard
 *      fallbacks so a page without the tokens still transitions.
 *
 *   5. Scroll compensation — scroll-then-animate
 *      scrollTo(0,0) runs synchronously in leave() BEFORE the animation starts.
 *      The leaving container receives a negative translateY offset so it
 *      visually stays put at the reader's prior scroll position.
 *
 * Consumer contract (see the docs-kit README, "Page transitions"):
 *   - Every page must load the full script/style set — head scripts and
 *     stylesheets are never synced across a navigation.
 *   - Page modules register their init on BOTH DOMContentLoaded and
 *     "bd:after-nav", are idempotent, scope queries to event.detail.container,
 *     and tear down on "bd:before-nav".
 *
 * Options — set window.bdBarbaOptions in any script loaded BEFORE this one
 * (all keys optional):
 *   preventPaths     RegExp[]  extra URL patterns Barba must not intercept
 *   preventWhen      function  () => boolean, extra prevent guard
 *   libraryPatterns  RegExp[]  appended to the load-once library patterns
 *   metaSelectors    string[]  appended to the head-meta sync selectors
 *   transitionMap    object    partial scenario → animation overrides
 *   onBeforeLeave    function  (data) — teardown hook, runs in beforeLeave
 *   onAfterNav       function  (container) — re-init hook, runs before bd:after-nav
 *   onNextDocument   function  (doc) — parsed next page, for outside-container carry
 *   timeout          number    barba.init request timeout in ms (default 5000)
 *   cacheIgnore      boolean   barba cache control (default false)
 *   prefetchIgnore   boolean   barba hover-prefetch control (default true)
 *
 * Events dispatched on document:
 *   "bd:before-nav"  { detail: { container } }  before the leave animation
 *   "bd:after-nav"   { detail: { container } }  after the swap fully settles
 */
(function () {
  'use strict';

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

  function optionFn(name) {
    return typeof OPTIONS[name] === 'function' ? OPTIONS[name] : null;
  }

  console.log('[barba-docs] init');

  // ── Utilities ──

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  function animate(el, keyframes, options) {
    return new Promise(function (resolve) {
      if (!el || prefersReducedMotion()) {
        resolve();
        return;
      }
      var anim = el.animate(keyframes, options);
      anim.onfinish = resolve;
      anim.oncancel = resolve;
    });
  }

  // ── Routes Barba must NOT intercept ──

  var PREVENT_PATHS = Array.isArray(OPTIONS.preventPaths) ? OPTIONS.preventPaths : [];
  var preventWhen = optionFn('preventWhen');

  function shouldPrevent(opts) {
    if (preventWhen && preventWhen()) return true;

    var el = opts && opts.el;
    if (el) {
      if (el.hasAttribute && el.hasAttribute('data-barba-prevent')) return true;
      if (el.hasAttribute && el.hasAttribute('download')) return true;
      if (el.target === '_blank') return true;

      var href = el.getAttribute && el.getAttribute('href');
      if (href) {
        if (href.charAt(0) === '#') return true;
        if (href.indexOf('mailto:') === 0) return true;
        if (href.indexOf('tel:') === 0) return true;
      }
    }

    var url = opts && opts.href;
    if (url) {
      for (var i = 0; i < PREVENT_PATHS.length; i++) {
        if (PREVENT_PATHS[i].test(url)) return true;
      }
    }

    return false;
  }

  // Clicking a link to the page already on screen: Barba's built-in sameUrl
  // check bails WITHOUT preventDefault, so the browser hard-reloads the page.
  // Intercept at capture phase and swallow the click instead. Hash links stay
  // native (the anchor jump must work), as do modified clicks and new-tab
  // targets.
  function interceptSameUrlClick(e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    if (link.hash || link.target === '_blank' || link.hasAttribute('download')) return;
    if (link.origin !== window.location.origin) return;

    if (link.pathname === window.location.pathname &&
        link.search === window.location.search) {
      e.preventDefault();
    }
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

    var saved = null;
    try {
      saved = localStorage.getItem('docs-sidebar-collapsed');
    } catch (e) {
      return;
    }
    if (saved !== null) return;

    document.body.classList.toggle('sidebar-collapsed', wanted);
    var toggle = mount.querySelector('.site-sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-label', wanted ? 'Expand sidebar' : 'Collapse sidebar');
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
    /unpkg\.com/
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
  function reExecuteContainerScripts(container) {
    if (!container) return;
    var scripts = container.querySelectorAll('script');
    scripts.forEach(function (oldScript) {
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

    reExecuteContainerScripts(container);

    var onAfterNav = optionFn('onAfterNav');
    if (onAfterNav) {
      try {
        onAfterNav(container);
      } catch (e) {
        console.warn('[barba-docs] onAfterNav error:', e);
      }
    }

    // Notify page modules that the new container is settled in the DOM.
    document.dispatchEvent(new CustomEvent('bd:after-nav', {
      detail: { container: container }
    }));
  }

  // ── Scenario resolver ──
  //
  // Reads data-level and data-section from both containers and returns a
  // semantic scenario name. The generator emits these attributes when
  // pageTransitions is on. The hierarchy for docs is:
  //   L1 = section index    (data-level="1")
  //   L2 = doc page         (data-level="2")
  //
  // Scenario rules:
  //   L1 → L2 (same section)    → "open"      (drilling into a doc)
  //   L2 → L1 (same section)    → "close"     (backing out to index)
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
  // once at init. The literal fallbacks keep transitions working when a
  // consumer's CSS doesn't define the tokens.

  function readToken(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  function readMotion(scope) {
    return {
      duration: parseInt(readToken('--motion-page-' + scope + '-duration'), 10) || 600,
      easing:   readToken('--motion-page-' + scope + '-easing') || 'ease-in-out'
    };
  }

  var MOTION = {
    pageOpen:  readMotion('open'),
    pageClose: readMotion('close'),
    pageSwap:  readMotion('swap'),
    pageFade:  readMotion('fade')
  };

  // ── Transition map ──
  // Maps each scenario (what's happening) to an animation name (what it looks
  // like). bdBarbaOptions.transitionMap overrides per scenario; the animation
  // always receives the *scenario's* motion token, so timing still matches
  // intent even if the visual changes.

  var TRANSITION_MAP = {
    open:        'slide-up',
    close:       'slide-down',
    swap:        'slide-left',
    'swap-back': 'slide-right',
    fade:        'fade'
  };

  if (OPTIONS.transitionMap && typeof OPTIONS.transitionMap === 'object') {
    Object.keys(TRANSITION_MAP).forEach(function (scenario) {
      if (typeof OPTIONS.transitionMap[scenario] === 'string') {
        TRANSITION_MAP[scenario] = OPTIONS.transitionMap[scenario];
      }
    });
  }

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
        el.style.transformOrigin = INDEX_TRANSFORM_ORIGIN;
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
      leave: function fadeLeave(el, motion) {
        return animate(el,
          [{ opacity: 1 }, { opacity: 0 }],
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

  function runLeave(el, scenario, scrollOffset) {
    var animationName = TRANSITION_MAP[scenario] || 'fade';
    var transition = TRANSITIONS[animationName] || TRANSITIONS['fade'];
    return transition.leave(el, motionFor(scenario), { scrollOffset: scrollOffset });
  }

  function runEnter(el, scenario) {
    var animationName = TRANSITION_MAP[scenario] || 'fade';
    var transition = TRANSITIONS[animationName] || TRANSITIONS['fade'];
    return transition.enter(el, motionFor(scenario), {});
  }

  // ── Barba transition ──

  var bdTransition = {
    name: 'bd-directional',
    sync: true,
    leave: function bdLeave(data) {
      var scenario = resolveScenario(data.current.container, data.next.container);

      // Mark scenario + role on both containers for CSS z-index rules
      data.current.container.setAttribute('data-bd-scenario', scenario);
      data.current.container.setAttribute('data-bd-role', 'leave');
      data.next.container.setAttribute('data-bd-scenario', scenario);
      data.next.container.setAttribute('data-bd-role', 'enter');

      // Scroll compensation: capture scroll FIRST, then add is-animating.
      // is-animating switches containers to position:absolute, which can
      // collapse the wrapper's layout row and clamp scroll to 0 — so scrollY
      // must be read before the class is added.
      var scrollY = window.scrollY || 0;
      document.body.classList.add('is-animating');
      if (scrollY > 0) {
        window.scrollTo(0, 0);
      }
      var scrollOffset = -scrollY;

      return runLeave(data.current.container, scenario, scrollOffset);
    },
    enter: function bdEnter(data) {
      var scenario = data.next.container.getAttribute('data-bd-scenario') || 'fade';
      return runEnter(data.next.container, scenario);
    }
  };

  // ── Init ──

  function init() {
    seedLoadedLibraries();

    barba.init({
      transitions: [bdTransition],
      prevent: shouldPrevent,
      prefetchIgnore: OPTIONS.prefetchIgnore !== undefined ? OPTIONS.prefetchIgnore : true,
      cacheIgnore: OPTIONS.cacheIgnore !== undefined ? OPTIONS.cacheIgnore : false,
      // Barba's own default is 2000ms, which aborts slow fetches and falls
      // back to a hard navigation — invisible locally, flaky on slow hosts.
      timeout: Number.isFinite(OPTIONS.timeout) ? OPTIONS.timeout : 5000,
      debug: false
    });

    var onBeforeLeave = optionFn('onBeforeLeave');

    barba.hooks.beforeLeave(function (data) {
      // Teardown moment: the current container is still live and about to
      // leave. Page modules remove listeners/observers/timers here.
      document.dispatchEvent(new CustomEvent('bd:before-nav', {
        detail: { container: data && data.current ? data.current.container : null }
      }));

      if (onBeforeLeave) {
        try {
          onBeforeLeave(data);
        } catch (e) {
          console.warn('[barba-docs] onBeforeLeave error:', e);
        }
      }
    });

    var onNextDocument = optionFn('onNextDocument');

    barba.hooks.afterEnter(function (data) {
      // The initial-load `once` flow fires global afterEnter too (with an
      // empty data.current). There is nothing to sync at first load, and a
      // consumer's onNextDocument must not fire with the page's own document.
      if (!data || !data.current || !data.current.container) return;

      var nextDoc = parseNextDocument(data.next.html);
      updateHeadMeta(nextDoc);
      applySidebarDefault(nextDoc);
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

      // Clean up role/scenario attributes + inline styles left by animations
      if (data && data.next && data.next.container) {
        data.next.container.removeAttribute('data-bd-role');
        data.next.container.removeAttribute('data-bd-scenario');
        data.next.container.style.transform = '';
        data.next.container.style.transformOrigin = '';
        data.next.container.style.opacity = '';

        // fill:'forwards' effects are not inline styles — left in the effect
        // stack they keep the container permanently transformed, which makes
        // it a containing block for position:fixed descendants and a stacking
        // context. Enter animations end at identity, so cancelling is
        // visually a no-op.
        if (typeof data.next.container.getAnimations === 'function') {
          data.next.container.getAnimations().forEach(function (a) { a.cancel(); });
        }
      }

      window.scrollTo(0, 0);

      // Re-inits run last, from here rather than afterEnter: the leaving
      // container is out of the DOM and layout is settled, so inits can
      // never bind to (or measure) the departing page.
      if (data && data.next && data.next.container) {
        refreshPageInit(data.next.container);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
