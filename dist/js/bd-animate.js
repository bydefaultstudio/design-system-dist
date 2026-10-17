/* @bydefaultstudio/design-system v7.0.0 */
/**
 * BD Animate
 * Entrances, scroll reveals and split-text staggers, driven by data-bd-*
 * attributes and GSAP. One gsap.context per page container; reverting it is
 * the whole teardown. Every duration, ease and stagger step comes from the
 * element-level motion tokens (design-system.css §4), read once at first init.
 *
 * Attributes the engine reads, all data-bd-*:
 *
 *   data-bd-enter="fade|slide-up|slide-down|slide-left|slide-right|scale|
 *                  blur-in|lines|words|chars|none"
 *       plays once when the page arrives (hard load, Barba enter, or the
 *       curtain lifting).
 *   data-bd-animate="fade|slide-up|slide-down|slide-left|slide-right|
 *                    scale-in|scale-up|blur-in|in-view|none"
 *       reveals when scrolled into view; above the fold it plays at once.
 *   "none" on either is the opt-out: shown at once, no motion. It is how
 *       an element keeps still under a generator or a parent that would
 *       otherwise animate it.
 *   data-bd-text="chars|words|lines|list"
 *       a split-text (or list-item) stagger, revealed like data-bd-animate.
 *       chars is for headings; on anything else it is read as words.
 *   data-bd-leave="fade|slide-up|slide-down|scale|blur"
 *       plays before the page leaves (bdAnimateOut).
 *   data-bd-stagger[="<multiplier>"]  on a parent: its direct children that
 *       carry any of the above are sequenced, step × multiplier apart.
 *   data-bd-delay="<ms>", data-bd-scrub[="<n>"] (media only, never on an
 *   element with text), data-bd-scrub-group + data-bd-scrub-stagger,
 *   data-bd-faded, data-bd-from-x/y/scale (in-view),
 *   data-bd-parallax[="<0-2>"] (+ data-bd-parallax-image), data-bd-refresh,
 *   data-bd-replay="<state>" or "!<state>" (descendants' entrances play
 *   when .is-<state> is added, or removed for the ! form; once per page),
 *   data-bd-chrome (persistent chrome, revealed once per document, never on
 *   a page swap).
 *
 * Every element that has played is stamped data-bd-revealed, which releases
 * it from the CSS guard (bd-animate.css) for good.
 *
 * Direction words name the direction of travel: slide-up rises from below,
 * slide-left arrives from the right.
 *
 * Every from-state is opacity + transform + filter. Never visibility: a held
 * heading or nav link stays in the accessibility tree and in find-in-page.
 * Every finished tween clears transform and filter, so nothing animated is
 * left as a containing block or on a compositing layer. Focus landing inside
 * anything still pending completes it at once.
 *
 * Lifecycle, called by the router (assets/js/barba-init.js):
 *   bdAnimateFreeze(current)   beforeLeave: triggers on the leaving page stop
 *   bdAnimateOut(current)      leave, first thing: exits play in place
 *   bdAnimateIn(next, opts)    enter: the entrance cascade, during the slide;
 *                              { arriving, offset } joins on-screen reveals to it
 *                              and starts it offset seconds into the slide
 *   bdAnimateCleanup()         after: the old context and the entrances of
 *                              any container no longer in the document go
 *   bdAnimateInit(next)        after: scroll reveals on the landed page
 *   bdAnimateReveal(scope)     any time: reveals for nodes added later
 *   bdAnimateChromeIn(scope)   once per document: persistent chrome
 *   bdAnimateShow(scope)       last resort: everything shown, no motion
 *
 * Events: dispatches bd:ready (latched on html[data-bd-ready]) after the
 * first init. While a curtain (#bd-intro-curtain, bd-intro.js) is in the
 * document and has not fired bd:intro-leaving, every reveal that would play
 * now is created paused and plays on that event; bd:intro-complete, with
 * the page unlocked, triggers one more measurement.
 *
 * Configuration, set before this script loads:
 *   window.bdAnimateConfig = { stagger: { chars, words, lines, list, group },
 *                              spreadSteps, manual, reducedMotion }
 *
 * @version 1.2.1
 */
(function () {
  'use strict';

  var VERSION = '1.2.1';

  var ATTR = {
    enter: 'data-bd-enter',
    animate: 'data-bd-animate',
    text: 'data-bd-text',
    leave: 'data-bd-leave',
    stagger: 'data-bd-stagger',
    delay: 'data-bd-delay',
    scrub: 'data-bd-scrub',
    scrubGroup: 'data-bd-scrub-group',
    scrubStagger: 'data-bd-scrub-stagger',
    faded: 'data-bd-faded',
    parallax: 'data-bd-parallax',
    parallaxImage: 'data-bd-parallax-image',
    refresh: 'data-bd-refresh',
    replay: 'data-bd-replay',
    revealed: 'data-bd-revealed',
    chrome: 'data-bd-chrome'
  };

  var ANIMATED = '[data-bd-enter], [data-bd-animate], [data-bd-text]';
  var SPLIT_ENTER = { lines: true, words: true, chars: true };

  // Failsafes and thresholds, not motion. Motion is the tokens.
  var FONT_WAIT_MS = 2500;      // longest the first reveal waits for fonts;
                                // under the head script's 3000ms guard release
  var OUT_PAD_MS = 200;         // slack on the exit race before Barba moves on
  var SCRUB_MIN_WIDTH = 768;    // below this a scrubbed reveal plays once;
                                // mirrors the CSS collapse point (max-width: 768px)
  var VISIBLE_FRACTION = 0.02;  // how much of an element counts as on screen
  var FADED_FROM = 0.2;         // data-bd-faded: ghosted, not hidden
  var REVEAL_START = 'top 95%'; // --motion-element-reveal-start; anything on screen is already playing
  // Distances, scale and blur are motion tokens too (design-system.css §4),
  // read once at the first init; these are the fallbacks for a page
  // without them.
  var SLIDE_PX = 40;
  var SCALE_FROM = 0.9;
  var BLUR_PX = 10;
  var SPLIT_Y_PX = 16;

  var config = window.bdAnimateConfig || {};
  var STAGGER = Object.assign({ chars: 1, words: 2, lines: 3, list: 2, group: 2 }, config.stagger);
  // A group's spread is capped at this many steps; later items share the
  // last delay, so a long list does not take seconds to finish.
  var SPREAD_STEPS = typeof config.spreadSteps === 'number' ? config.spreadSteps : 12;

  //
  //------- UTILITIES -------//
  //

  // bdAnimateConfig.reducedMotion is read live, so a test page can walk the
  // reduced path without changing a system setting.
  function prefersReducedMotion() {
    if (window.bdAnimateConfig && window.bdAnimateConfig.reducedMotion === true) return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function toArray(list) {
    return Array.prototype.slice.call(list);
  }

  function query(scope, selector) {
    var found = toArray(scope.querySelectorAll(selector));
    if (scope.matches && scope.matches(selector)) found.unshift(scope);
    return found;
  }

  function markRevealed(el) {
    el.setAttribute(ATTR.revealed, '');
    pending.delete(el);
  }

  // Neither played nor on its way in: an arriving reveal started as an
  // entrance is the entrance cascade's, not the reveal pass's.
  function isUnplayed(el) {
    var entry = pending.get(el);
    return !el.hasAttribute(ATTR.revealed) && !(entry && entry.started);
  }

  function showElements(elements) {
    elements.forEach(function show(el) {
      gsap.set(el, { opacity: 1, clearProps: 'transform,filter,willChange' });
      markRevealed(el);
    });
  }

  // The no-engine path: whatever the CSS guard is holding, let go of it.
  function forceShowAll(scope) {
    if (!scope) return;
    query(scope, ANIMATED).forEach(function show(el) {
      el.style.opacity = '1';
      el.style.transform = '';
      el.style.filter = '';
      el.setAttribute(ATTR.revealed, '');
    });
  }

  var warned = {};

  function warnOnce(key, message, el) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[BD Animate] ' + message, el || '');
  }

  //
  //------- STATE -------//
  //

  var ctx = null;
  var currentContainer = null;
  var frozen = false;          // the current container is leaving
  var enterTweens = [];        // { tween, owner }: entrance tweens, outside the
                               // context, owned by the scope they played in
  var enterSplits = [];        // { split, owner }: entrance SplitText instances
  var held = [];               // paused tweens waiting for the curtain
  var refreshTimer = null;     // data-bd-refresh debounce, cleared with its observer
  var observers = [];          // ResizeObserver / MutationObserver instances
  var pending = new WeakMap(); // element → { tween, trigger } not yet revealed
  var outTimeline = null;      // the last exit, for bfcache recovery
  var lastWidth = window.innerWidth;
  var resizeBound = false;

  if (typeof gsap === 'undefined') {
    console.warn('[BD Animate] GSAP not loaded, showing every animated element');
    forceShowAll(document.body);
    return;
  }

  console.log('[BD Animate] v' + VERSION);

  var plugins = [];
  if (typeof ScrollTrigger !== 'undefined') plugins.push(ScrollTrigger);
  if (typeof SplitText !== 'undefined') plugins.push(SplitText);
  if (typeof CustomEase !== 'undefined') plugins.push(CustomEase);
  gsap.registerPlugin.apply(gsap, plugins);
  var hasScrollTrigger = typeof ScrollTrigger !== 'undefined';
  var hasSplitText = typeof SplitText !== 'undefined';

  // Mobile browsers fire resize when the URL bar shows or hides; refreshing
  // every trigger on each one is the main mobile scroll jank. Width and
  // orientation changes still refresh.
  if (hasScrollTrigger) ScrollTrigger.config({ ignoreMobileResize: true });

  //
  //------- TOKENS -------//
  //

  function readToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // "600ms" or "0.6s" to seconds, which is what GSAP counts in. parseInt
  // would read "0.6s" as 0.
  function tokenSeconds(name, fallbackMs) {
    var raw = readToken(name);
    var match = raw.match(/^(-?[\d.]+)\s*(ms|s)?$/);
    if (!match) return fallbackMs / 1000;
    var value = parseFloat(match[1]);
    if (!isFinite(value)) return fallbackMs / 1000;
    return match[2] === 's' ? value : value / 1000;
  }

  // CustomEase takes the four numbers, not the cubic-bezier() string: the
  // "c" in the keyword sends the string to its SVG path parser, which throws.
  function tokenEase(name, id, fallback) {
    var raw = readToken(name);
    var numbers = raw.match(/-?\d*\.?\d+/g);
    if (typeof CustomEase === 'undefined') {
      warnOnce('customease', 'CustomEase not loaded, easing falls back to ' + fallback);
      return fallback;
    }
    if (!numbers || numbers.length !== 4) {
      warnOnce('ease-' + name, name + ' is not a cubic-bezier, easing falls back to ' + fallback);
      return fallback;
    }
    try {
      CustomEase.create(id, numbers.join(','));
      return id;
    } catch (err) {
      warnOnce('ease-' + name, name + ' could not be registered, easing falls back to ' + fallback);
      return fallback;
    }
  }

  var motion = null;

  // A number token: unitless, px, or rem/em (spacing tokens are rem), in px.
  function tokenNumber(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var value = parseFloat(raw);
    if (!isFinite(value)) {
      if (raw) warnOnce('token-' + name, name + ' is not a plain number or length, using ' + fallback);
      return fallback;
    }
    if (/r?em$/.test(raw)) value *= parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return value;
  }

  function readMotion() {
    if (motion) return motion;
    var revealAt = tokenNumber('--motion-element-reveal-start', 95);
    if (revealAt > 0 && revealAt <= 100) REVEAL_START = 'top ' + revealAt + '%';
    SLIDE_PX = tokenNumber('--motion-element-enter-distance', SLIDE_PX);
    SPLIT_Y_PX = tokenNumber('--motion-element-text-distance', SPLIT_Y_PX);
    SCALE_FROM = tokenNumber('--motion-element-scale-from', SCALE_FROM);
    BLUR_PX = tokenNumber('--motion-element-blur-from', BLUR_PX);
    motion = {
      enter: tokenSeconds('--motion-element-enter-duration', 1000),
      enterEase: tokenEase('--motion-element-enter-easing', 'bd-enter', 'power2.out'),
      exit: tokenSeconds('--motion-element-exit-duration', 400),
      exitEase: tokenEase('--motion-element-exit-easing', 'bd-exit', 'power2.in'),
      fadeEase: tokenEase('--motion-element-fade-easing', 'bd-fade', 'power2.inOut'),
      step: tokenSeconds('--motion-element-stagger-duration', 30)
    };
    return motion;
  }

  //
  //------- GEOMETRY AND ATTRIBUTES -------//
  //

  function isInViewport(el) {
    var rect = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
    var visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
    if (visibleH <= 0 || visibleW <= 0) return false;
    var area = rect.height * rect.width;
    if (!area) return true;
    return (visibleH * visibleW) / area >= VISIBLE_FRACTION;
  }

  function delayOf(el) {
    var raw = parseFloat(el.getAttribute(ATTR.delay));
    return isFinite(raw) && raw > 0 ? raw / 1000 : 0;
  }

  function fromOpacity(el) {
    return el.hasAttribute(ATTR.faded) ? FADED_FROM : 0;
  }

  // Scrub ties opacity to scroll position, so text held at a fraction fails
  // contrast for as long as the reader stops there: media only.
  function scrubOf(el) {
    if (!el.hasAttribute(ATTR.scrub)) return undefined;
    if (window.innerWidth < SCRUB_MIN_WIDTH) return undefined;
    // Text, or a control, at an opacity the scroll position decides fails
    // contrast for as long as the reader pauses: media only.
    if (el.textContent.trim() || el.querySelector('a, button, input, select, textarea, [tabindex]')) {
      warnOnce('scrub-text', 'data-bd-scrub on an element with text or a control is ignored; it plays once', el);
      return undefined;
    }
    var raw = el.getAttribute(ATTR.scrub);
    if (!raw || raw.toLowerCase() === 'true') return true;
    var n = parseFloat(raw);
    return isFinite(n) && n > 0 ? Math.max(n, 0.1) : undefined;
  }

  function hasFocusWithin(el) {
    var active = document.activeElement;
    return !!active && active !== document.body && el.contains(active);
  }

  // Gated while the curtain is in the document (its markup lands before any
  // script, so this holds on the very first init) or its lock is on, until
  // it has said it is leaving. html.bd-intro-off is the head script hiding
  // a curtain whose script never ran: nothing will ever say leaving, so
  // nothing is held.
  function isGated() {
    var root = document.documentElement;
    if (root.hasAttribute('data-bd-intro-left') || root.classList.contains('bd-intro-off')) return false;
    return !!document.getElementById('bd-intro-curtain') || document.body.classList.contains('is-intro-loading');
  }

  // Only the gate holds a tween. A held tween is paused and played on
  // bd:intro-leaving.
  function holdOrPlay(tween) {
    if (isGated()) {
      tween.pause();
      held.push(tween);
    }
    return tween;
  }

  function releaseHeld() {
    var tweens = held;
    held = [];
    tweens.forEach(function play(t) { if (t.progress() < 1) t.play(); });
  }

  document.addEventListener('bd:intro-leaving', function onIntroLeaving() {
    document.documentElement.setAttribute('data-bd-intro-left', '');
    releaseHeld();
  });

  // The first init measured under the curtain's scroll lock (a fixed body:
  // no scroll height, scrollY 0, often no scrollbar gutter). Once the
  // curtain is gone the page has reflowed and scrolled back, so measure
  // again, a frame after the reflow has settled.
  document.addEventListener('bd:intro-complete', function onIntroComplete() {
    requestAnimationFrame(function settle() { requestAnimationFrame(guardedRefresh); });
  });

  //
  //------- FROM AND TO -------//
  //

  function fromFor(type, el) {
    switch (type) {
      case 'slide-up':    return { opacity: fromOpacity(el), y: SLIDE_PX };
      case 'slide-down':  return { opacity: fromOpacity(el), y: -SLIDE_PX };
      case 'slide-left':  return { opacity: fromOpacity(el), x: SLIDE_PX };
      case 'slide-right': return { opacity: fromOpacity(el), x: -SLIDE_PX };
      case 'scale':
      case 'scale-in':    return { opacity: fromOpacity(el), scale: SCALE_FROM };
      case 'scale-up':    return { opacity: 1, scale: SCALE_FROM };
      case 'blur-in':     return { opacity: fromOpacity(el), filter: 'blur(' + BLUR_PX + 'px)' };
      case 'in-view':
        return {
          opacity: fromOpacity(el),
          x: parseFloat(el.getAttribute('data-bd-from-x')) || 0,
          y: parseFloat(el.getAttribute('data-bd-from-y')) || 0,
          scale: parseFloat(el.getAttribute('data-bd-from-scale')) || 1
        };
      case 'fade':
      default:
        return { opacity: fromOpacity(el) };
    }
  }

  // Rest, for everything. Transform and filter are cleared on completion so
  // nothing stays a containing block or on a compositing layer; opacity
  // stays, it is what overrides the CSS guard until the stamp lands.
  function restProps(from, extra) {
    var to = { opacity: 1, clearProps: 'transform,filter,willChange' };
    if ('x' in from) to.x = 0;
    if ('y' in from) to.y = 0;
    if ('scale' in from) to.scale = 1;
    if ('filter' in from) to.filter = 'blur(0px)';
    return Object.assign(to, extra);
  }

  // Runs one element's pass; a bad node shows itself and warns instead of
  // leaving the page half hidden.
  function safely(elements, fn) {
    try {
      fn();
    } catch (err) {
      console.warn('[BD Animate] could not animate, showing instead', elements, err);
      showElements(elements);
    }
  }

  //
  //------- STAGGER GROUPS -------//
  //

  // Members of a [data-bd-stagger] parent: its direct animated children, in
  // DOM order.
  function staggerGroups(scope) {
    var groups = [];
    query(scope, '[' + ATTR.stagger + ']').forEach(function collect(parent) {
      var multiplier = parseFloat(parent.getAttribute(ATTR.stagger));
      if (!isFinite(multiplier) || multiplier < 0) multiplier = STAGGER.group;
      var members = toArray(parent.children).filter(function animated(child) {
        return child.matches(ANIMATED) && child.getAttribute(ATTR.animate) !== 'none' && child.getAttribute(ATTR.enter) !== 'none';
      });
      if (!members.length) return;
      groups.push({ parent: parent, step: readMotion().step * multiplier, members: members });
    });
    return groups;
  }

  // A split's per-unit stagger, capped so a long heading or paragraph never
  // spreads past MAX_SPLIT_SPREAD seconds (WCAG 2.2.2: motion that starts by
  // itself ends within five seconds, enter duration and offset included).
  var MAX_SPLIT_SPREAD = 2;
  function splitStagger(step, count) {
    return count > 1 ? { each: Math.min(step, MAX_SPLIT_SPREAD / (count - 1)) } : step;
  }

  function groupDelay(step, index) {
    return Math.min(index, SPREAD_STEPS) * step;
  }

  //
  //------- SPLIT TEXT -------//
  //

  function isHeading(el) {
    return /^H[1-6]$/.test(el.tagName);
  }

  // chars on anything but a heading would read letter by letter in
  // VoiceOver; it becomes words.
  function splitType(type, el) {
    if (type === 'chars' && !isHeading(el)) {
      warnOnce('chars-heading', 'data-bd-text="chars" is for headings; read as words', el);
      return 'words';
    }
    return type;
  }

  function splitOptions(type, el) {
    return {
      type: type,
      tag: 'span',
      // An aria-label on a paragraph is naming-prohibited, so only a heading
      // split into chars keeps SplitText's label-and-hide treatment.
      aria: type === 'chars' ? 'auto' : 'none',
      // Re-splits when fonts finish loading and when the width changes, so
      // lines measured against a fallback font are redrawn, not stranded.
      autoSplit: true
    };
  }

  function splitUnits(split, type) {
    return type === 'chars' ? split.chars : type === 'words' ? split.words : split.lines;
  }

  // A span is inline, and a transform on an inline box is ignored; SplitText
  // leaves display alone when the tag is span, so it is set here. clearProps
  // never touches it.
  function splitFrom(type, start, rise) {
    var from = { opacity: start, display: type === 'lines' ? 'block' : 'inline-block' };
    if (rise) from.y = SPLIT_Y_PX;
    return from;
  }

  function splitStep(type) {
    return readMotion().step * STAGGER[type];
  }

  //
  //------- ENTRANCES -------//
  //

  function enterTween(el, type, delay, onDone) {
    var m = readMotion();
    var from = fromFor(type, el);
    gsap.set(el, from);
    return gsap.to(el, restProps(from, {
      duration: m.enter,
      ease: m.enterEase,
      delay: delay,
      onComplete: onDone
    }));
  }

  // A split entrance: the wrapper shows at once, the units rise and fade in
  // sequence. autoSplit asks onSplit to return the animation so a re-split
  // rebuilds it; the rebuilt tween is registered again so a hold, the focus
  // escape and cleanup all see the live one.
  function enterSplit(el, type, delay, onDone, owner) {
    var m = readMotion();
    type = splitType(type, el);
    var step = splitStep(type);
    var options = splitOptions(type, el);
    gsap.set(el, { opacity: 1 });
    options.onSplit = function onSplit(self) {
      var units = splitUnits(self, type);
      var from = splitFrom(type, 0, type !== 'chars');
      gsap.set(units, from);
      var tween = gsap.to(units, restProps(from, {
        duration: m.enter,
        ease: type === 'chars' ? m.fadeEase : m.enterEase,
        delay: delay,
        stagger: splitStagger(step, units.length),
        onComplete: onDone
      }));
      pending.set(el, { tween: tween, started: true });
      holdOrPlay(tween);
      enterTweens.push({ tween: tween, owner: owner });
      return tween;
    };
    enterSplits.push({ split: SplitText.create(el, options), owner: owner });
  }

  // `owner` is the scope whose removal from the document retires the
  // entrance (a page container, a replay parent); null for persistent
  // chrome, retired only when everything is.
  function runEnter(el, delay, owner, asType) {
    if (el.hasAttribute(ATTR.revealed)) return;
    // Already on its way in, or already split (autoSplit can defer the split
    // to fonts.ready). A chrome scope that also holds the page container
    // (the docs layout) must not enter the page's elements twice.
    var entry = pending.get(el);
    if (entry && (entry.tween || entry.started)) return;
    var type = asType || el.getAttribute(ATTR.enter) || 'fade';
    if (!asType && el.hasAttribute(ATTR.animate)) {
      warnOnce('both', 'an element carries both data-bd-enter and data-bd-animate; enter wins', el);
    }
    if (type === 'none') {
      showElements([el]);
      return;
    }
    // Focus is already here: the reader is on it, show it now.
    if (hasFocusWithin(el)) {
      showElements([el]);
      return;
    }
    safely([el], function run() {
      var done = function done() { markRevealed(el); };
      if (SPLIT_ENTER[type] && hasSplitText) {
        pending.set(el, { started: true });
        enterSplit(el, type, delay, done, owner);
        return;
      }
      var tween = enterTween(el, type, delay, done);
      pending.set(el, { tween: tween, started: true });
      holdOrPlay(tween);
      enterTweens.push({ tween: tween, owner: owner });
    });
  }

  // The replay parent that owns an element, if any. Elements inside one are
  // the replay's to play, except when that parent is the scope itself.
  function replayOwner(el) {
    return el.parentElement ? el.parentElement.closest('[' + ATTR.replay + ']') : null;
  }

  // Entrance delays: a group member takes its index among its group's
  // entrance members; a lone element takes only its own data-bd-delay.
  function enterPass(scope, owner, offset) {
    var elements = query(scope, '[' + ATTR.enter + ']').filter(function mine(el) {
      var owner = replayOwner(el);
      return !owner || owner === scope;
    });
    if (!elements.length) return;

    if (prefersReducedMotion()) {
      showElements(elements);
      return;
    }

    var delayByElement = new Map();
    staggerGroups(scope).forEach(function assign(group) {
      var index = 0;
      group.members.forEach(function member(el) {
        if (!el.hasAttribute(ATTR.enter)) return;
        delayByElement.set(el, groupDelay(group.step, index));
        index++;
      });
    });

    elements.forEach(function each(el) {
      runEnter(el, (offset || 0) + (delayByElement.get(el) || 0) + delayOf(el), owner);
    });
  }

  // Reveals already on screen where an arriving page will land play as
  // entrances, in the same cascade and at the same offset, instead of being
  // held for the whole transition and played once it has landed. A reveal
  // that scrubs at this width, or sits in a scrub group, is left to its own
  // pass: its position is its state. Its group index counts from 0 among the
  // arriving members; a group mixing entrances and reveals can share a delay.
  function arrivingPass(scope, owner, offset) {
    var onScreen = query(scope, '[' + ATTR.animate + '], [' + ATTR.text + ']').filter(function visible(el) {
      return isUnplayed(el) && !el.hasAttribute(ATTR.enter)
        && scrubOf(el) === undefined && !el.closest('[' + ATTR.scrubGroup + ']')
        && isInViewport(el);
    });
    // Split text travels in place with its page: its reveal path (opacity
    // floor, rise, curve) differs from an entrance's, and running it as one
    // would make the same heading look different by route.
    showElements(onScreen.filter(function isText(el) { return el.hasAttribute(ATTR.text); }));
    var elements = onScreen.filter(function notText(el) { return !el.hasAttribute(ATTR.text); });
    if (!elements.length) return;
    if (prefersReducedMotion()) {
      showElements(elements);
      return;
    }
    var delayByElement = new Map();
    staggerGroups(scope).forEach(function assign(group) {
      var index = 0;
      group.members.forEach(function member(el) {
        if (elements.indexOf(el) === -1) return;
        delayByElement.set(el, groupDelay(group.step, index));
        index++;
      });
    });
    elements.forEach(function each(el) {
      runEnter(el, (offset || 0) + (delayByElement.get(el) || 0) + delayOf(el), owner, el.getAttribute(ATTR.animate) || 'fade');
    });
  }

  //
  //------- SCROLL REVEALS -------//
  //

  function revealTween(el, from, delay, extra) {
    var m = readMotion();
    return gsap.to(el, restProps(from, Object.assign({
      duration: m.enter,
      ease: m.enterEase,
      delay: delay,
      onComplete: function done() { markRevealed(el); }
    }, extra)));
  }

  // One element, revealed when it arrives on screen. Above the fold and not
  // scrubbed it plays at once (held by the gate if there is one).
  function reveal(el, type, delay) {
    if (hasFocusWithin(el)) {
      showElements([el]);
      return;
    }
    var from = fromFor(type, el);
    var scrub = scrubOf(el);
    gsap.set(el, from);

    if (scrub === undefined && isInViewport(el)) {
      var tween = revealTween(el, from, delay, {});
      pending.set(el, { tween: tween });
      holdOrPlay(tween);
      return;
    }

    if (!hasScrollTrigger) {
      showElements([el]);
      return;
    }

    var trigger = {
      trigger: el,
      start: REVEAL_START,
      end: window.innerWidth < SCRUB_MIN_WIDTH ? 'top 60%' : 'bottom 75%'
    };
    if (scrub !== undefined) trigger.scrub = scrub; else trigger.once = true;
    // A scrubbed tween's delay would scrub too, as a dead zone at the start
    // of the range; the scroll position is its timing.
    var scrolled = revealTween(el, from, scrub !== undefined ? 0 : delay, { scrollTrigger: trigger });
    pending.set(el, { tween: scrolled, trigger: scrolled.scrollTrigger });
  }

  // A batch of group members below the fold: only the ones entering together
  // are offset against each other, so row four of a shelf never waits on
  // rows one to three.
  function revealBatch(members, step) {
    if (!hasScrollTrigger) {
      showElements(members);
      return;
    }
    var m = readMotion();
    members.forEach(function set(el) {
      gsap.set(el, fromFor(el.getAttribute(ATTR.animate) || 'fade', el));
      pending.set(el, {});
    });
    var withBlur = members.filter(function blur(el) { return /blur/.test(el.getAttribute(ATTR.animate) || ''); });
    var plain = members.filter(function noBlur(el) { return withBlur.indexOf(el) === -1; });
    [plain, withBlur].forEach(function batch(list) {
      if (!list.length) return;
      var rest = list === withBlur ? { x: 0, y: 0, scale: 1, filter: '' } : { x: 0, y: 0, scale: 1 };
      var triggers = ScrollTrigger.batch(list, {
        start: REVEAL_START,
        once: true,
        onEnter: function onEnter(entering) {
          // The spread is capped as it is above the fold: a batch of forty
          // rows arriving together (a tall viewport, an End key, a deep
          // link) would otherwise run seconds past the last one (WCAG 2.2.2).
          gsap.to(entering, restProps(rest, {
            duration: m.enter,
            ease: m.enterEase,
            stagger: function spread(i) { return groupDelay(step, i); },
            onComplete: function done() { entering.forEach(markRevealed); }
          }));
        }
      });
      list.forEach(function record(el, i) {
        pending.set(el, { trigger: triggers[i] });
      });
    });
  }

  function textReveal(el, type, groupOffset) {
    if (hasFocusWithin(el)) {
      showElements([el]);
      return;
    }
    var m = readMotion();
    var start = fromOpacity(el);
    var delay = (groupOffset || 0) + delayOf(el);
    var playNow = isInViewport(el);
    if (el.hasAttribute(ATTR.scrub)) {
      warnOnce('text-scrub', 'data-bd-text never scrubs: ghosted text held by scroll position fails contrast', el);
    }

    function animate(units, step, from) {
      gsap.set(units, from);
      var vars = restProps(from, {
        duration: m.enter,
        ease: m.fadeEase,
        stagger: splitStagger(step, units.length),
        delay: delay,
        onComplete: function done() { markRevealed(el); }
      });
      if (!playNow && hasScrollTrigger) {
        vars.scrollTrigger = { trigger: el, start: el.hasAttribute(ATTR.faded) ? 'top 85%' : REVEAL_START, once: true };
      }
      var tween = gsap.to(units, vars);
      pending.set(el, { tween: tween, trigger: tween.scrollTrigger });
      if (playNow) holdOrPlay(tween);
      return tween;
    }

    gsap.set(el, { opacity: 1 });

    if (type === 'list') {
      var items = toArray(el.querySelectorAll('li'));
      if (!items.length) {
        showElements([el]);
        return;
      }
      animate(items, splitStep('list'), { opacity: start });
      return;
    }
    if (!hasSplitText) {
      showElements([el]);
      return;
    }
    type = splitType(type, el);
    var options = splitOptions(type, el);
    options.onSplit = function onSplit(self) {
      return animate(splitUnits(self, type), splitStep(type), splitFrom(type, start, false));
    };
    SplitText.create(el, options);
  }

  // Scrub groups: one trigger on the parent, every child on a shared
  // timeline, positioned index × stagger, so aligned siblings reveal in
  // sequence as the parent scrolls through its range.
  function scrubGroupPass(scope, handled) {
    if (!hasScrollTrigger) return;
    query(scope, '[' + ATTR.scrubGroup + ']').forEach(function group(parent) {
      var children = toArray(parent.querySelectorAll('[' + ATTR.animate + ']'));
      if (!children.length) return;
      var m = readMotion();
      // Milliseconds in the attribute, like data-bd-delay; seconds to GSAP.
      var stagger = parseFloat(parent.getAttribute(ATTR.scrubStagger)) / 1000;
      if (!isFinite(stagger) || stagger < 0) stagger = m.step * STAGGER.group;
      var scrub = window.innerWidth >= SCRUB_MIN_WIDTH;
      var tl = gsap.timeline({
        scrollTrigger: {
          trigger: parent,
          start: REVEAL_START,
          end: scrub ? 'bottom 75%' : 'top 60%',
          scrub: scrub,
          once: !scrub,
          invalidateOnRefresh: true
        },
        onComplete: function done() { children.forEach(markRevealed); }
      });
      children.forEach(function child(el, index) {
        var from = fromFor(el.getAttribute(ATTR.animate) || 'fade', el);
        gsap.set(el, from);
        tl.to(el, restProps(from, { duration: scrub ? 1 : m.enter, ease: m.enterEase }), index * stagger);
        pending.set(el, { tween: tl, trigger: tl.scrollTrigger });
        handled.add(el);
      });
    });
  }

  function isStill(el) {
    return el.getAttribute(ATTR.animate) === 'none';
  }

  function revealPass(scope) {
    var fresh = query(scope, '[' + ATTR.animate + ']').filter(isUnplayed);
    showElements(fresh.filter(isStill));
    var animated = fresh.filter(function moving(el) { return !isStill(el); });
    var texts = query(scope, '[' + ATTR.text + ']').filter(isUnplayed);
    if (!animated.length && !texts.length) return;

    if (prefersReducedMotion()) {
      showElements(animated.concat(texts));
      return;
    }

    var handled = new Set();
    scrubGroupPass(scope, handled);

    var delayByElement = new Map();
    staggerGroups(scope).forEach(function assign(group) {
      var reveals = group.members.filter(function scrollable(el) {
        return (el.hasAttribute(ATTR.animate) || el.hasAttribute(ATTR.text))
          && !el.hasAttribute(ATTR.enter) && isUnplayed(el) && !handled.has(el);
      });
      var above = reveals.filter(isInViewport);
      var below = reveals.filter(function notAbove(el) { return above.indexOf(el) === -1; });
      above.forEach(function assignDelay(el, index) {
        delayByElement.set(el, groupDelay(group.step, index));
      });
      var belowAnimate = below.filter(function plain(el) { return el.hasAttribute(ATTR.animate) && !el.hasAttribute(ATTR.text); });
      if (belowAnimate.length) {
        safely(belowAnimate, function run() { revealBatch(belowAnimate, group.step); });
        belowAnimate.forEach(function mark(el) { handled.add(el); });
      }
    });

    animated.forEach(function each(el) {
      if (handled.has(el)) return;
      if (el.hasAttribute(ATTR.enter)) return; // enter wins, warned in runEnter
      if (el.hasAttribute(ATTR.text)) return;  // the text pass owns it
      safely([el], function run() {
        reveal(el, el.getAttribute(ATTR.animate) || 'fade', (delayByElement.get(el) || 0) + delayOf(el));
      });
    });

    texts.forEach(function each(el) {
      if (el.hasAttribute(ATTR.enter)) return;
      safely([el], function run() { textReveal(el, el.getAttribute(ATTR.text) || 'words', delayByElement.get(el) || 0); });
    });
  }

  //
  //------- PARALLAX, REFRESH, REPLAY -------//
  //

  function parallaxPass(scope, context) {
    if (!hasScrollTrigger || prefersReducedMotion()) return;
    query(scope, '[' + ATTR.parallax + ']').forEach(function mask(el) {
      var image = el.querySelector('[' + ATTR.parallaxImage + ']') || el.querySelector('img');
      if (!image) return;
      var raw = el.getAttribute(ATTR.parallax);
      var intensity = 1;
      if (raw && raw.toLowerCase() !== 'auto') {
        var n = parseFloat(raw);
        if (isFinite(n)) intensity = Math.max(0, Math.min(2, n));
      }
      function slack() { return Math.max(0, image.offsetHeight - el.offsetHeight); }
      var tween = gsap.fromTo(image,
        { y: function () { return -(slack() / 2) * intensity; } },
        {
          y: function () { return (slack() / 2) * intensity; },
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 1, invalidateOnRefresh: true }
        });
      if (image.tagName === 'IMG' && !image.complete) {
        context.add(function bindLoad() {
          function onLoad() { if (tween.scrollTrigger) tween.scrollTrigger.refresh(); }
          image.addEventListener('load', onLoad, { once: true });
          return function unbind() { image.removeEventListener('load', onLoad); };
        });
      }
    });
  }

  // Never on a page with no triggers: there is nothing to measure, and a
  // refresh briefly forces scroll-behavior: auto on the root and records and
  // restores the scroll position around its measurements.
  function guardedRefresh() {
    if (hasScrollTrigger && ScrollTrigger.getAll().length) ScrollTrigger.refresh();
  }

  // The data-bd-refresh and data-bd-replay observers, and the refresh they
  // may still owe: a debounced refresh must not land under a page slide.
  function stopObservers() {
    observers.forEach(function stop(o) { o.disconnect(); });
    observers = [];
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function refreshPass(scope) {
    if (!hasScrollTrigger) return;
    var targets = query(scope, '[' + ATTR.refresh + ']');
    if (!targets.length) return;
    var observer = new ResizeObserver(function onResize() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(guardedRefresh, 200);
    });
    targets.forEach(function observe(el) { observer.observe(el); });
    observers.push(observer);
  }

  // [data-bd-replay="<state>"]: the entrances inside play when .is-<state>
  // is added; "!<state>" plays when it is removed (a dock that opens by
  // dropping .is-collapsed). Once per page; later openings show at once.
  function replayPass(scope, context) {
    query(scope, '[' + ATTR.replay + ']').forEach(function parent(el) {
      var raw = el.getAttribute(ATTR.replay) || '';
      var inverted = raw.charAt(0) === '!';
      var state = inverted ? raw.slice(1) : raw;
      if (!state) return;
      var stateClass = 'is-' + state;
      var children = toArray(el.querySelectorAll('[' + ATTR.enter + ']')).filter(function fresh(child) {
        return !child.hasAttribute(ATTR.revealed);
      });
      showElements(children.filter(function still(child) { return child.getAttribute(ATTR.enter) === 'none'; }));
      children = children.filter(function moving(child) { return child.getAttribute(ATTR.enter) !== 'none'; });
      if (!children.length) return;

      if (prefersReducedMotion()) {
        showElements(children);
        return;
      }

      var played = false;
      function isOn() {
        var has = el.classList.contains(stateClass);
        return inverted ? !has : has;
      }
      function fire() {
        if (played) {
          showElements(children);
          return;
        }
        played = true;
        context.add(function run() { enterPass(el, el); });
      }

      children.forEach(function set(child) {
        gsap.set(child, fromFor(child.getAttribute(ATTR.enter) || 'fade', child));
        pending.set(child, {});
      });
      var on = isOn();
      if (on) fire();
      var observer = new MutationObserver(function onClass() {
        var now = isOn();
        if (now === on) return;
        on = now;
        if (on) fire();
      });
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
      observers.push(observer);
    });
  }

  //
  //------- FOCUS ESCAPE -------//
  //

  // Focus landing inside something still hidden completes it at once, so a
  // Tab into the TOC mid-stagger or a link below the fold is never invisible.
  // One listener for the document, bound at load, so it is live before any
  // init, including the entrance cascade that starts during a page slide.
  // Held by the stylesheet alone, with no tween yet (a swap's slide before
  // init, the font wait with no curtain), is held all the same: the reader
  // landed on it, so it shows.
  function completePending(el) {
    var entry = pending.get(el);
    if (!entry) {
      if (!el.hasAttribute(ATTR.revealed)) showElements([el]);
      return;
    }
    if (entry.tween) entry.tween.progress(1);
    if (entry.trigger && entry.trigger.kill) entry.trigger.kill();
    showElements([el]);
  }

  function onFocusIn(event) {
    var node = event.target;
    while (node && node.nodeType === 1) {
      if (node.matches(ANIMATED)) completePending(node);
      node = node.parentElement;
    }
  }

  document.addEventListener('focusin', onFocusIn, true);

  //
  //------- LIFECYCLE API -------//
  //

  // Reverts the context and what hangs off it. Entrance tweens and their
  // holds are left alone: a rebuild on resize must not stop a cascade or
  // drop a hold; a page swap kills them in bdAnimateCleanup.
  function revertContext() {
    stopObservers();
    held = held.filter(function entrance(t) { return isEntrance(t); });
    if (ctx) {
      ctx.revert();
      ctx = null;
    }
  }

  function isEntrance(tween) {
    return enterTweens.some(function same(e) { return e.tween === tween; });
  }

  // Retires the entrances of every owner that has left the document, or of
  // everything, chrome (owner null) included. Never everything on a page
  // swap: the router cleans up in `after`, when the arriving page's own
  // cascade (started in `enter`) is still playing, and a transition shorter
  // than the cascade would otherwise cut it off with elements stuck at
  // their from-state.
  function clearEntrances(all) {
    function gone(entry) { return all || (!!entry.owner && !entry.owner.isConnected); }
    var killed = [];
    enterTweens = enterTweens.filter(function keep(e) {
      if (!gone(e)) return true;
      e.tween.kill();
      killed.push(e.tween);
      return false;
    });
    enterSplits = enterSplits.filter(function keep(e) {
      if (!gone(e)) return true;
      e.split.revert();
      return false;
    });
    held = held.filter(function live(t) { return killed.indexOf(t) === -1; });
  }

  window.bdAnimateInit = function bdAnimateInit(container) {
    revertContext();
    currentContainer = container || document.body;
    frozen = false;
    lastWidth = window.innerWidth;
    readMotion();
    if (hasScrollTrigger) ScrollTrigger.clearScrollMemory();

    // gsap.context runs this before it returns the context, so the context
    // comes in as the argument; one bad pass must not escape, or the context
    // is never recorded and never reverted.
    ctx = gsap.context(function build(self) {
      ctx = self;
      [
        function () { revealPass(currentContainer); },
        function () { parallaxPass(currentContainer, self); },
        function () { refreshPass(currentContainer); },
        function () { replayPass(currentContainer, self); }
      ].forEach(function run(pass) {
        try {
          pass();
        } catch (err) {
          console.warn('[BD Animate] a pass failed', err);
        }
      });
    }, currentContainer);

    bindResize();
  };

  // Reveals for nodes added after init (a grid that fills in later). Runs
  // inside the live context so they are torn down with the page.
  // Only once the page has landed and only inside it: bd:after-nav fires
  // before the router has inited the arriving page, when the context still
  // belongs to the one leaving, so a call from there is ignored.
  window.bdAnimateReveal = function bdAnimateReveal(scope) {
    if (!ctx || !scope || frozen) return;
    if (!currentContainer || !currentContainer.contains(scope)) return;
    ctx.add(function add() {
      revealPass(scope);
      replayPass(scope, ctx);
    });
  };

  // Stops every trigger on a leaving page so nothing rewinds when the router
  // scrolls to the top under it. The context is reverted later, in `after`,
  // when the container is already out of the document.
  window.bdAnimateFreeze = function bdAnimateFreeze(container) {
    frozen = true;
    // Entrances still playing on the leaving page finish now, before the
    // router measures and pins its sticky elements: a tween ending during the
    // transition clears transform, and with it the inline translate that
    // holds a docked bar in place, so the bar would jump off with the page.
    if (container) {
      enterTweens.forEach(function finish(entry) {
        if (entry.owner && (entry.owner === container || container.contains(entry.owner))) {
          entry.tween.progress(1);
        }
      });
    }
    if (hasScrollTrigger && container) {
      ScrollTrigger.getAll().forEach(function freeze(st) {
        if (st.trigger && container.contains(st.trigger)) st.disable(false);
      });
    }
    stopObservers();
  };

  window.bdAnimateCleanup = function bdAnimateCleanup() {
    frozen = false;
    clearEntrances(false);
    if (outTimeline) {
      outTimeline.revert();
      outTimeline = null;
    }
    revertContext();
    currentContainer = null;
  };

  // options.arriving: the container is coming in on a page transition, laid
  // out where it will land and not yet moving, so reveals already on screen
  // there join the entrance cascade (arrivingPass). options.offset, in
  // seconds: how far into the transition the cascade starts, so the content
  // settles with the page instead of landing before it has moved.
  window.bdAnimateIn = function bdAnimateIn(container, options) {
    if (!container) return;
    var offset = options && options.offset > 0 ? options.offset : 0;
    enterPass(container, container, offset);
    if (options && options.arriving) arrivingPass(container, container, offset);
  };

  // Persistent chrome: outside the context, so a page swap never reverts it,
  // and only elements not yet revealed, so a second call animates only what
  // is new.
  window.bdAnimateChromeIn = function bdAnimateChromeIn(scope) {
    if (!scope) return;
    enterPass(scope, null);
  };

  // Everything in a scope shown at once and marked revealed: the router's
  // last resort when a hook throws, so a page is never left hidden.
  window.bdAnimateShow = function bdAnimateShow(scope) {
    showElements(query(scope || document.body, ANIMATED));
  };

  window.bdAnimateOut = function bdAnimateOut(container) {
    var elements = container ? query(container, '[' + ATTR.leave + ']') : [];
    if (!elements.length || prefersReducedMotion()) return Promise.resolve();
    var m = readMotion();
    var tl = gsap.timeline();
    elements.forEach(function leave(el) {
      var type = el.getAttribute(ATTR.leave) || 'fade';
      var to = { opacity: 0, duration: m.exit, ease: m.exitEase, delay: delayOf(el) };
      if (type === 'slide-down') to.y = SLIDE_PX;
      if (type === 'slide-up') to.y = -SLIDE_PX;
      if (type === 'scale') to.scale = SCALE_FROM;
      if (type === 'blur') to.filter = 'blur(' + BLUR_PX + 'px)';
      tl.to(el, to, 0);
    });
    outTimeline = tl;
    return Promise.race([
      tl.then(),
      new Promise(function cap(resolve) { setTimeout(resolve, tl.totalDuration() * 1000 + OUT_PAD_MS); })
    ]);
  };

  //
  //------- RESIZE AND PREFERENCE CHANGES -------//
  //

  // A width change moves the fold and the scrub breakpoint, so the reveals
  // are rebuilt; a height-only change (a mobile URL bar) is ignored, and so
  // is a page that is on its way out.
  function onResize() {
    if (!ctx || !currentContainer || frozen) return;
    var width = window.innerWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    window.bdAnimateInit(currentContainer);
  }

  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    var timer;
    window.addEventListener('resize', function debounced() {
      clearTimeout(timer);
      timer = setTimeout(onResize, 150);
    });
  }

  // Chrome entrances are tracked nowhere (bdAnimateChromeIn), so their
  // tweens are killed by target, or one would finish its slide after the
  // reader asked for none.
  function showEverything() {
    window.bdAnimateCleanup();
    clearEntrances(true);
    var all = query(document.body, ANIMATED);
    gsap.killTweensOf(all);
    showElements(all);
  }

  var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typeof reducedQuery.addEventListener === 'function') {
    reducedQuery.addEventListener('change', function onPreference(event) {
      if (event.matches) showEverything();
    });
  }

  //
  //------- INITIALIZE -------//
  //

  function signalReady() {
    document.documentElement.setAttribute('data-bd-ready', '');
    document.dispatchEvent(new CustomEvent('bd:ready'));
  }

  // The container is taken now, not after the font wait: a click before the
  // fonts resolve would otherwise re-init the page that replaced it. If the
  // router did get there first, only the chrome and the ready signal remain.
  var firstContainer = document.querySelector('[data-barba="container"]') || document.body;

  function firstLoad() {
    // The head script has already released the guard: the reader is
    // reading, so nothing is taken away and re-animated. Behind a curtain
    // nobody is reading yet, so the guard goes back on and the cascade is
    // held for the lift as on a fast load.
    if (document.documentElement.classList.contains('bd-animate-off')) {
      // The engine is here now, so the guard is safe again for pages that
      // arrive by the router; left off, every later arrival would show,
      // hide and reveal.
      document.documentElement.classList.remove('bd-animate-off');
      if (!isGated()) {
        showElements(query(document.body, ANIMATED));
        signalReady();
        return;
      }
    }
    if (!ctx && firstContainer.isConnected) {
      window.bdAnimateInit(firstContainer);
      window.bdAnimateIn(firstContainer);
    }
    query(document.body, '[' + ATTR.chrome + ']').forEach(window.bdAnimateChromeIn);
    guardedRefresh();
    signalReady();
  }

  if (!config.manual) {
    Promise.race([
      document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
      new Promise(function cap(resolve) { setTimeout(resolve, FONT_WAIT_MS); })
    ]).then(firstLoad, firstLoad);
  }

  window.addEventListener('pageshow', function onPageShow(event) {
    if (!event.persisted || !currentContainer) return;
    var container = currentContainer;
    window.bdAnimateCleanup();
    window.bdAnimateInit(container);
    guardedRefresh();
  });
})();
