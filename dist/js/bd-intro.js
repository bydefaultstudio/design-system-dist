/* @bydefaultstudio/design-system v7.0.0 */
/**
 * BD Intro
 * The first-load curtain. Plays on every real document load and never on a
 * page swap, because a swap never re-runs a page's scripts. Covers the page
 * with an inverted surface while the wordmark drops into place, holds until
 * the page says it is ready (bd:ready, from bd-animate.js), then fades.
 *
 * The wordmark is the page's, not this file's: the markup carries one
 * <svg class="bd-intro-piece" viewBox="…"> per piece inside the stage, and
 * the script reads each piece's bounds from its viewBox. A deployment
 * supplies its own pieces; leaving the markup out is the opt-out.
 *
 *   <div class="bd-intro" id="bd-intro-curtain" role="status">
 *     <span class="visually-hidden" data-bd-intro-ready="Ready">Loading</span>
 *     <div class="bd-intro-stage" aria-hidden="true">
 *       <svg class="bd-intro-piece" viewBox="350 267 700 238"
 *            data-bd-intro-rotation="2.2" data-bd-intro-damping="1">…</svg>
 *     </div>
 *   </div>
 *
 * The pieces share one coordinate space (the full wordmark's), so the
 * viewBoxes place them relative to each other; the whole mark is scaled to
 * fit and centred.
 *
 * While it is up: body is scroll-locked, every sibling of the curtain is
 * inert, focus is captured and restored only if it was somewhere real.
 * Events: bd:intro-leaving before the fade (held reveals play through it),
 * bd:intro-complete once the curtain is gone. Reduced motion skips the
 * curtain and still fires both, on the next frame. The hold is capped from
 * navigation start, so the lock releases by 4.5s however late the script
 * ran, ahead of the head script's 5s hide; the moving part (the drop, then
 * the fade) is well inside WCAG 2.2.2's five-second exemption on its own.
 *
 * Configuration, set before this script loads:
 *   window.bdIntroConfig = { size, maxWidth, rotation, overshoot, bounce,
 *                            friction, staggerSteps, verticalBias,
 *                            verticalBiasMax, manual }
 *
 * Pairs with bd-animate.js, which holds its reveals until bd:intro-leaving
 * and fires the bd:ready this waits on; without it the curtain lifts as
 * soon as the drop lands.
 *
 * @version 1.0.2
 */
(function () {
  'use strict';

  var VERSION = '1.0.2';

  var DEFAULTS = {
    size: 0.42,          // mark width as a fraction of the viewport
    maxWidth: 300,       // cap on the mark's width in px
    rotation: 1,         // multiplier on each piece's starting rotation
    overshoot: 10,       // px, first-bounce amplitude
    bounce: 1,           // pace multiplier
    friction: 5,         // damping rate
    staggerSteps: 8,     // stagger between pieces, in stagger-token steps
    verticalBias: -0.02, // optical centre: fraction of the height, negative is up
    verticalBiasMax: 20  // px cap on that shift
  };
  var cfg = Object.assign({}, DEFAULTS, window.bdIntroConfig);

  var CURTAIN_ID = 'bd-intro-curtain';
  var FALL_RATIO = 0.55;
  var SPRING_SAMPLES = 30;
  var REF_OSCILLATIONS = 2.5;
  var PIECE_ROTATION_DEFAULT = 2;
  var PIECE_DAMPING_DEFAULT = 1;

  // Failsafes, not motion. Measured from navigation start, not from boot:
  // the head script hides the curtain at 5s on the same clock, and a cap
  // on a later clock would leave the page visible but still locked.
  var TOTAL_CAP_MS = 4500;

  console.log('[BD Intro] v' + VERSION);

  //
  //------- UTILITIES -------//
  //

  // bdAnimateConfig.reducedMotion is the engine's test switch; honouring it
  // here means a test page walks the whole reduced path, curtain included.
  function prefersReducedMotion() {
    if (window.bdAnimateConfig && window.bdAnimateConfig.reducedMotion === true) return true;
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // html carries scroll-behavior: smooth, so a plain scroll glides; the
  // override turns it off for one call where behavior: 'instant' is not
  // understood (Safari before 15.4).
  function withInstantScroll(scroll) {
    var root = document.documentElement;
    var previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    try {
      scroll();
    } finally {
      root.style.scrollBehavior = previous;
    }
  }

  function scrollInstant(top) {
    try {
      window.scrollTo({ top: top, left: 0, behavior: 'instant' });
    } catch (err) {
      withInstantScroll(function fallback() { window.scrollTo(0, top); });
    }
  }

  function readToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function tokenMs(name, fallback) {
    var match = readToken(name).match(/^(-?[\d.]+)\s*(ms|s)?$/);
    if (!match) return fallback;
    var value = parseFloat(match[1]);
    if (!isFinite(value)) return fallback;
    return match[2] === 's' ? value * 1000 : value;
  }

  function sinceNavigation() {
    return window.performance && typeof performance.now === 'function' ? performance.now() : 0;
  }

  function nextFrame() {
    return new Promise(function wait(resolve) { requestAnimationFrame(resolve); });
  }

  // The leaving latch is set here as well as by the engine, so the head
  // script's 5s failsafe stands down whether or not the engine is loaded.
  function dispatch(name) {
    if (name === 'bd:intro-leaving') document.documentElement.setAttribute('data-bd-intro-left', '');
    document.dispatchEvent(new CustomEvent(name));
  }

  //
  //------- LOCK AND INERT -------//
  //

  var INERT_STAMP = 'data-bd-intro-inert';
  var savedScrollY = 0;
  var previouslyFocused = null;

  // Siblings already inert belong to someone else and are left alone; the
  // ones set here are stamped so only they are released.
  function lockPage(curtain) {
    previouslyFocused = document.activeElement;
    savedScrollY = window.scrollY || 0;
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.classList.add('is-intro-loading');
    Array.prototype.forEach.call(document.body.children, function each(el) {
      if (el.contains(curtain) || el.tagName === 'SCRIPT' || el.hasAttribute('inert')) return;
      el.setAttribute('inert', '');
      el.setAttribute(INERT_STAMP, '');
    });
  }

  function landOnHash(curtain) {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return false;
    var id = hash.slice(1);
    var target = null;
    try { target = document.getElementById(decodeURIComponent(id)); } catch (err) { target = null; }
    target = target || document.getElementById(id);
    if (!target || (curtain && curtain.contains(target))) return false;
    try {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    } catch (err) {
      withInstantScroll(function fallback() { target.scrollIntoView({ block: 'start' }); });
    }
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    return true;
  }

  // Clears the lock's residue: the class, the offset, the inert this set.
  // Idempotent, so it also tidies after a crashed run or a bfcache return.
  function clearLock() {
    document.body.classList.remove('is-intro-loading');
    document.body.style.top = '';
    Array.prototype.forEach.call(document.body.querySelectorAll(':scope > [' + INERT_STAMP + ']'), function release(el) {
      el.removeAttribute('inert');
      el.removeAttribute(INERT_STAMP);
    });
  }

  // Lifts the lock and puts the reader back: runs before the fade so the
  // page beneath is already in place.
  function unlockPage(curtain) {
    clearLock();

    // Focus goes back only to somewhere real. On a plain load it was the
    // body, and moving it anywhere would discard the reader's starting point.
    var target = previouslyFocused;
    previouslyFocused = null;
    if (target && target !== document.body && document.contains(target) && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); } catch (err) { /* not focusable any more */ }
    }

    // The browser's own fragment scroll happened under a fixed body, if at
    // all, so a deep link lands here; otherwise the saved position returns,
    // instantly, because html carries scroll-behavior: smooth.
    var top = savedScrollY;
    savedScrollY = 0;
    if (!landOnHash(curtain) && top > 0) scrollInstant(top);
  }

  // A history navigation while the curtain is up (links are inert, popstate
  // is not) swaps the page beneath it: the saved position and focus belong
  // to the page that left.
  document.addEventListener('bd:before-nav', function onBeforeNav() {
    savedScrollY = 0;
    previouslyFocused = null;
  });

  //
  //------- PIECES -------//
  //

  function readPieces(stage) {
    return Array.prototype.map.call(stage.querySelectorAll('.bd-intro-piece'), function read(el) {
      var box = (el.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
      if (box.length !== 4 || box.some(function bad(n) { return !isFinite(n); })) return null;
      var rotation = parseFloat(el.getAttribute('data-bd-intro-rotation'));
      var damping = parseFloat(el.getAttribute('data-bd-intro-damping'));
      return {
        el: el,
        x: box[0], y: box[1], w: box[2], h: box[3],
        rotation: isFinite(rotation) ? rotation : PIECE_ROTATION_DEFAULT,
        damping: isFinite(damping) ? damping : PIECE_DAMPING_DEFAULT
      };
    }).filter(Boolean);
  }

  function sizeFraction(stageW) {
    if (stageW >= 720) return cfg.size;
    var t = Math.max(0, Math.min(1, (cfg.size - 0.18) / (0.85 - 0.18)));
    return 0.32 + (0.95 - 0.32) * t;
  }

  // Lays the pieces out in the stage: the union of their viewBoxes is the
  // mark, scaled to fit and centred with the optical bias.
  function placePieces(stage, pieces) {
    var rect = stage.getBoundingClientRect();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pieces.forEach(function bounds(p) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
    });
    var markW = maxX - minX;
    var markH = maxY - minY;
    var logoW = Math.min(rect.width * sizeFraction(rect.width), cfg.maxWidth);
    var scale = logoW / markW;
    var logoH = markH * scale;
    var originX = (rect.width - logoW) / 2;
    var biasPx = Math.min(cfg.verticalBiasMax, rect.height * Math.abs(cfg.verticalBias));
    var originY = (rect.height - logoH) / 2 + (cfg.verticalBias < 0 ? -biasPx : biasPx);

    pieces.forEach(function place(p) {
      var w = p.w * scale;
      var h = p.h * scale;
      p.el.setAttribute('width', w);
      p.el.setAttribute('height', h);
      p.finalX = originX + (p.x - minX) * scale;
      p.finalY = originY + (p.y - minY) * scale;
      p.startY = -h - 80;
      p.el.style.transform = 'translate(' + p.finalX + 'px, ' + p.startY + 'px) rotate(' + (p.rotation * cfg.rotation) + 'deg)';
    });
  }

  // The fall is the intro easing token; the settle after it is a spring
  // sampled into linear keyframes, which no bezier describes.
  function keyframesFor(p, fallEasing) {
    var rotStart = p.rotation * cfg.rotation;
    var amp = cfg.overshoot * p.damping;
    var oscillations = ((1 - FALL_RATIO) / FALL_RATIO) * REF_OSCILLATIONS * cfg.bounce;
    var frames = [{
      offset: 0,
      transform: 'translate(' + p.finalX + 'px, ' + p.startY + 'px) rotate(' + rotStart + 'deg)',
      easing: fallEasing
    }, {
      offset: FALL_RATIO,
      transform: 'translate(' + p.finalX + 'px, ' + (p.finalY + amp) + 'px) rotate(0deg)',
      easing: 'linear'
    }];
    for (var i = 1; i <= SPRING_SAMPLES; i++) {
      var t = i / SPRING_SAMPLES;
      var y = amp * Math.cos(2 * Math.PI * oscillations * t) * Math.exp(-cfg.friction * t);
      frames.push({
        offset: Math.min(0.9999, FALL_RATIO + (1 - FALL_RATIO) * t),
        transform: 'translate(' + p.finalX + 'px, ' + (p.finalY + y) + 'px) rotate(0deg)',
        easing: 'linear'
      });
    }
    frames.push({ offset: 1, transform: 'translate(' + p.finalX + 'px, ' + p.finalY + 'px) rotate(0deg)' });
    return frames;
  }

  function runDrop(curtain, stage, pieces) {
    curtain.classList.add('is-active');
    placePieces(stage, pieces);

    var speed = tokenMs('--motion-page-intro-duration', 1500);
    var stagger = tokenMs('--motion-element-stagger-duration', 30) * cfg.staggerSteps;
    var fallEasing = readToken('--motion-page-intro-easing') || 'cubic-bezier(0.4, 0, 1, 1)';

    return nextFrame().then(nextFrame).then(function drop() {
      return Promise.all(pieces.map(function each(p, i) {
        return new Promise(function one(resolve) {
          setTimeout(function start() {
            // A bad easing string throws here, inside a timer: caught, or
            // the drop would never resolve and the reader would wait out
            // the cap in front of a still curtain.
            try {
              var anim = p.el.animate(keyframesFor(p, fallEasing), { duration: speed, fill: 'forwards' });
              anim.onfinish = resolve;
              anim.oncancel = resolve;
            } catch (err) {
              console.warn('[BD Intro] piece could not animate', err);
              p.el.style.transform = 'translate(' + p.finalX + 'px, ' + p.finalY + 'px)';
              resolve();
            }
          }, i * stagger);
        });
      }));
    });
  }

  //
  //------- DISMISS -------//
  //

  function fadeOut(curtain) {
    var fade = tokenMs('--motion-page-fade-duration', 600);
    return new Promise(function run(resolve) {
      var done = false;
      function cleanup() {
        if (done) return;
        done = true;
        if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
        resolve();
      }
      curtain.classList.add('is-leaving');
      curtain.addEventListener('transitionend', function onEnd(event) {
        if (event.target === curtain) cleanup();
      });
      setTimeout(cleanup, fade + 200);
    });
  }

  // The status label was there at first render, which no screen reader
  // treats as an update; swapping its text is one, so the ready message is
  // queued before the element goes. Focus is not moved.
  function announceReady(curtain) {
    var label = curtain.querySelector('[data-bd-intro-ready]');
    if (label) label.textContent = label.getAttribute('data-bd-intro-ready');
  }

  //
  //------- READY SIGNAL -------//
  //

  // With no engine on the page nothing will ever say ready, so the drop
  // alone decides. Scripts are deferred in order, so the engine, when
  // present, has already run by now.
  var readyPromise = new Promise(function wait(resolve) {
    if (document.documentElement.hasAttribute('data-bd-ready') || typeof window.bdAnimateInit !== 'function') {
      resolve();
      return;
    }
    document.addEventListener('bd:ready', resolve, { once: true });
  });

  //
  //------- BOOT -------//
  //

  function skip(curtain) {
    if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
    requestAnimationFrame(function fire() {
      dispatch('bd:intro-leaving');
      dispatch('bd:intro-complete');
    });
  }

  function recover(curtain) {
    if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
    clearLock();
    dispatch('bd:intro-leaving');
    dispatch('bd:intro-complete');
  }

  var running = null;

  function boot(curtain) {
    // One run at a time: a second call while the first is up would unlock
    // the page under the second curtain, so a second curtain is dropped.
    if (running) {
      if (curtain && curtain.parentNode) curtain.parentNode.removeChild(curtain);
      return running;
    }
    curtain = curtain || document.getElementById(CURTAIN_ID);
    if (!curtain) return Promise.resolve();
    clearLock();

    // Nothing to drop, motion is off, the head script has already hidden
    // the curtain (this ran after its 5s), or the browser cannot animate:
    // the curtain is the opt-out and the page is never locked behind an
    // invisible overlay.
    var stage = curtain.querySelector('.bd-intro-stage');
    var pieces = stage ? readPieces(stage) : [];
    if (
      !pieces.length ||
      prefersReducedMotion() ||
      document.documentElement.classList.contains('bd-intro-off') ||
      typeof curtain.animate !== 'function'
    ) {
      skip(curtain);
      return Promise.resolve();
    }

    lockPage(curtain);

    var dropped;
    try {
      dropped = runDrop(curtain, stage, pieces);
    } catch (err) {
      console.error('[BD Intro] drop failed, restoring the page', err);
      recover(curtain);
      return Promise.resolve();
    }
    var ready = Promise.all([dropped, readyPromise]).then(nextFrame);
    var capped = new Promise(function cap(resolve) {
      setTimeout(resolve, Math.max(0, TOTAL_CAP_MS - sinceNavigation()));
    });

    // A bfcache return mid-run removes the curtain and releases the page
    // itself; the chain that resumes afterwards must not do it all again.
    running = Promise.race([ready, capped]).then(function leave() {
      if (!curtain.isConnected) return;
      announceReady(curtain);
      dispatch('bd:intro-leaving');
      unlockPage(curtain);
      return fadeOut(curtain).then(function complete() {
        dispatch('bd:intro-complete');
      });
    }).catch(function failed(err) {
      console.error('[BD Intro] dismiss failed, restoring the page', err);
      recover(curtain);
    }).then(function done() {
      running = null;
    });
    return running;
  }

  // Exposed for a page that mounts its own curtain on demand; the automatic
  // boot calls it with the curtain in the markup.
  window.bdIntroPlay = boot;

  // Back into a page frozen mid-curtain: the page's scripts do not re-run,
  // so recover here.
  window.addEventListener('pageshow', function onPageShow(event) {
    if (!event.persisted || !document.body.classList.contains('is-intro-loading')) return;
    var curtain = document.getElementById(CURTAIN_ID);
    if (curtain && curtain.parentNode) curtain.parentNode.removeChild(curtain);
    running = null;
    unlockPage(curtain);
    dispatch('bd:intro-leaving');
    dispatch('bd:intro-complete');
  });

  //
  //------- INITIALIZE -------//
  //

  // A deferred script runs once the DOM is parsed, so the direct branch is
  // the usual path; the listener covers a script loaded earlier.
  if (!(window.bdIntroConfig && window.bdIntroConfig.manual)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onReady() { boot(); });
    } else {
      boot();
    }
  }
})();
