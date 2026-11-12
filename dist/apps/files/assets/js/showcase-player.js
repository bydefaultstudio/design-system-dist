/**
 * Script Purpose: Showcase player — run an asset's step list on its stage
 * Author: By Default Studio
 * Version: 1.1.0
 * Last Updated: 2026-10-13
 */

(function () {
  'use strict';

  var VERSION = '1.1.0';
  console.log('[showcase-player] v' + VERSION + ' loaded');

  /**
   * An asset's auto-play is data, not code (handovers/HANDOVER-showcase.md,
   * D9): a list of steps docgen has already checked against the markup. This
   * file is the one interpreter for every asset.
   *
   *   { "click": "<part>" }                     a real click: the component's
   *                                             own JS runs, so the demo is
   *                                             the real behaviour
   *   { "focus": "<part>" } / { "blur": true }
   *   { "cursor": "<part>" }                    glide the drawn cursor there
   *   { "add": "<part>", "class": "is-hover" }  a state class on, or off with
   *   { "remove": "<part>", "class": "…" }      "remove"
   *   { "set": "<part>", "attr": "aria-…", "value": "…" }
   *   { "wait": 800 }                           ms
   *
   * Deterministic on purpose: the export script records one pass, so the same
   * steps must give the same frames. Every pass starts from stage.reset().
   *
   * Pausing stops at the next step boundary and playing again starts a fresh
   * pass, rather than resuming mid-sequence: a half-open menu left by a pause
   * is a state the asset never describes.
   *
   * Focus: while a pass plays, the artwork is inert. A step's click still
   * runs the component's handler (a scripted click is not blocked by inert),
   * but the focus() calls those handlers make are refused, so the demo never
   * pulls the reader's focus or scrolls the page to it. As a second line, a
   * step that moves focus into the artwork anyway gives it back.
   *
   * Motion: nothing here starts on its own. The pages decide when to play, and
   * they never autoplay under prefers-reduced-motion (WCAG 2.2.2 is met with
   * the visible pause control every page gives a playing asset).
   *
   * Layer: app (CLAUDE.md §17).
   */

  // How long the drawn cursor takes to arrive, read from its own transition
  // so the wait matches the CSS (motion tokens, never a number here).
  function transitionMs(el) {
    var value = window.getComputedStyle(el).transitionDuration || '0s';
    var first = value.split(',')[0].trim();
    var number = parseFloat(first) || 0;
    return first.indexOf('ms') > -1 ? number : number * 1000;
  }

  /**
   * @param {object} stage    from ShowcaseStage.mount
   * @param {object} [hooks]
   * @param {function} [hooks.onChange]  called with true / false as play state changes
   * @returns {object} player
   */
  function create(stage, hooks) {
    hooks = hooks || {};
    var steps = stage.settings.steps || [];
    var run = 0;          // bumped to cancel the pass in flight
    var timer = null;
    var wake = null;

    var player = {
      playing: false,
      hasSteps: steps.length > 0,
    };

    function setPlaying(value) {
      if (player.playing === value) return;
      player.playing = value;
      stage.el.art.inert = value;
      // Inert takes the component out of the accessibility tree, so the
      // stage's cue says why it is gone and how to get it back.
      if (stage.el.cue) stage.el.cue.hidden = !value;
      if (typeof hooks.onChange === 'function') hooks.onChange(value);
    }

    /** A wait the pause can cut short. Resolves false when cancelled. */
    function sleep(ms, token) {
      return new Promise(function waitFor(resolve) {
        wake = function cancelled() { resolve(false); };
        timer = window.setTimeout(function done() {
          timer = null;
          wake = null;
          resolve(token === run);
        }, ms);
      });
    }

    function nextFrame() {
      return new Promise(function onFrame(resolve) {
        window.requestAnimationFrame(function after() { resolve(); });
      });
    }

    function perform(step, token) {
      var target;
      if ('wait' in step) return sleep(step.wait, token);
      if ('cursor' in step) {
        stage.moveCursor(step.cursor);
        return sleep(transitionMs(stage.el.cursor), token);
      }
      if ('click' in step) {
        target = stage.part(step.click);
        if (target) {
          // The drawn cursor, when it is already on the part, dips as a real
          // one would under a press. It never waits: the click lands now.
          if (typeof stage.pressCursor === 'function') stage.pressCursor();
          var before = document.activeElement;
          target.click();
          var after = document.activeElement;
          if (after !== before && stage.el.art.contains(after) && before && !stage.el.art.contains(before) && typeof before.focus === 'function') {
            before.focus({ preventScroll: true });
          }
        }
      } else if ('focus' in step) {
        target = stage.part(step.focus);
        if (target) target.focus({ preventScroll: true });
      } else if ('blur' in step) {
        if (stage.el.art.contains(document.activeElement)) document.activeElement.blur();
      } else if ('add' in step) {
        target = stage.part(step.add);
        if (target) target.classList.add(step.class);
      } else if ('remove' in step) {
        target = stage.part(step.remove);
        if (target) target.classList.remove(step.class);
      } else if ('set' in step) {
        target = stage.part(step.set);
        if (target) target.setAttribute(step.attr, step.value);
      }
      return Promise.resolve(token === run);
    }

    /** One pass from a reset stage. Resolves true when it ran to the end. */
    function pass(token) {
      stage.reset();
      var index = 0;
      function next() {
        if (token !== run) return Promise.resolve(false);
        if (index >= steps.length) return Promise.resolve(true);
        var step = steps[index];
        index += 1;
        return perform(step, token).then(function settled(alive) {
          if (!alive) return false;
          return nextFrame().then(function redraw() {
            stage.drawNotes();
            return next();
          });
        });
      }
      return next();
    }

    function cancel() {
      run += 1;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (wake) {
        var resolveWait = wake;
        wake = null;
        resolveWait();
      }
    }

    /** Play, looping when the asset asks to, until paused. */
    player.play = function play() {
      if (!player.hasSteps) return;
      cancel();
      var token = run;
      setPlaying(true);
      function loop() {
        return pass(token).then(function ended(finished) {
          if (!finished || token !== run) return;
          if (stage.settings.loop) {
            loop();
          } else {
            setPlaying(false);
          }
        });
      }
      loop();
    };

    /** Stop at the next step boundary. The state on screen stays. */
    player.pause = function pause() {
      cancel();
      setPlaying(false);
    };

    /** Stop and put the markup back. */
    player.stop = function stop() {
      cancel();
      setPlaying(false);
      stage.reset();
    };

    player.toggle = function toggle() {
      if (player.playing) {
        player.pause();
      } else {
        player.play();
      }
    };

    /**
     * One pass, never looping: what the export script records. Resolves when
     * the last step has run.
     */
    player.once = function once() {
      cancel();
      var token = run;
      setPlaying(true);
      return pass(token).then(function ended(finished) {
        if (token === run) setPlaying(false);
        return finished;
      });
    };

    return player;
  }

  window.ShowcasePlayer = {
    version: VERSION,
    create: create,
  };
})();
