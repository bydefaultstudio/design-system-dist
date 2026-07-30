/* @bydefaultstudio/design-system v2.1.1 */
/**
 * BD Cursor — desktop custom cursor (native / label / badge / graphic / halo)
 * ONE overlay element (.cursor-overlay) becomes every author-driven render.
 * Terminology — NATIVE (the OS pointer, nothing custom) · LABEL (text in an
 * accent box, native stays) · BADGE (icon in an accent circle) · GRAPHIC
 * (a two-colour cursor graphic from the cursor sprite — always replaces the
 * pointer) · HALO (click-feedback ring).
 *
 * Configure through window.bdCursorConfig, defined BEFORE this script loads.
 * Every key is optional; defaults reproduce the original Studio build:
 *
 *   window.bdCursorConfig = {
 *     // Badge/label glyphs — recolourable currentColor icon sprite.
 *     spritePath: "/assets/images/svg-icons/_sprite.svg",
 *     // GRAPHIC glyphs — two-colour cursor sprite with authored fills,
 *     // kept apart from the recolourable icon sprite. Both sprites must be
 *     // same-origin: <use href> does not load cross-origin.
 *     cursorSpritePath: "/assets/images/svg-cursors/_sprite.svg",
 *     // Inject the overlay + halo markup when the page doesn't carry it.
 *     autoInjectMarkup: false,
 *     // Skip target re-resolution on scroll while <body> carries this class
 *     // (a router's programmatic scroll during a transition). null disables.
 *     suppressScrollBodyClass: "is-animating",
 *     // "hide" keeps the overlay DOM (re-initable); "remove" strips it.
 *     reducedMotion: "hide"
 *   };
 *
 * Lifecycle: initBdCursor() runs automatically and is idempotent;
 * destroyBdCursor() detaches everything so a client-side app can re-init.
 * Reset signal: dispatch "bd:before-nav" (or legacy "studio:before-nav")
 * before swapping page content so a riding badge/graphic can't linger.
 * Content refresh: dispatch "bd-cursor:refresh" after mutating a hovered
 * element's data-cursor-* attributes (bd-video does this on play/pause).
 *
 * @version 6.0.0
 */
(function () {
  "use strict";

  var VERSION = "6.0.0";

  var DEFAULTS = {
    spritePath: "/assets/images/svg-icons/_sprite.svg",
    cursorSpritePath: "/assets/images/svg-cursors/_sprite.svg",
    autoInjectMarkup: false,
    suppressScrollBodyClass: "is-animating",
    reducedMotion: "hide"
  };

  var ICON_ATTR = "data-cursor-icon";
  var BADGE_ATTR = "data-cursor-badge";
  var GRAPHIC_ATTR = "data-cursor-graphic";
  var REPLACE_ATTR = "data-cursor-replace";
  var NATIVE_ATTR = "data-cursor-native";

  // Motion tuning. The overlay eases toward the pointer; native cursors stay
  // pixel-locked.
  var LABEL_LERP = 0.75;
  var HALO_LERP = 0.2;
  var SNAP_THRESHOLD = 0.5;
  var LABEL_OFFSET_Y = 20; // px below the cursor in float modes

  // Holds everything destroy() needs to unpick. null = not initialised.
  var live = null;

  function resolveConfig() {
    var user = window.bdCursorConfig || {};
    var config = {};
    for (var key in DEFAULTS) {
      config[key] = Object.prototype.hasOwnProperty.call(user, key)
        ? user[key]
        : DEFAULTS[key];
    }
    return config;
  }

  function injectMarkup() {
    var overlay = document.createElement("div");
    overlay.className = "cursor-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<div class="cursor-overlay-icon cursor-overlay-icon-lead"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="100%" height="100%"><use href=""/></svg></div>' +
      '<span class="cursor-overlay-text"></span>' +
      '<div class="cursor-overlay-icon cursor-overlay-icon-end"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="100%" height="100%"><use href=""/></svg></div>';
    var halo = document.createElement("div");
    halo.className = "cursor-halo";
    halo.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
    document.body.appendChild(halo);
  }

  function initBdCursor() {
    if (live) return;
    // Cross-execution guard: `live` is closure-private (destroy needs its
    // handles), so a re-injected copy of this script gets a fresh closure
    // where `live` is null. The window flag is what stops that second copy
    // attaching a duplicate, undetachable listener set. Set only after every
    // bail-out below, so a skipped init (reduced motion, missing DOM) stays
    // re-initable.
    if (window.__bdCursorInited) return;

    var config = resolveConfig();

    var overlay = document.querySelector(".cursor-overlay");
    var halo = document.querySelector(".cursor-halo");

    if ((!overlay || !halo) && config.autoInjectMarkup) {
      injectMarkup();
      overlay = document.querySelector(".cursor-overlay");
      halo = document.querySelector(".cursor-halo");
    }

    if (!overlay || !halo) {
      console.warn("[bd-cursor] skipped — .cursor-overlay or .cursor-halo not found (set autoInjectMarkup to create them).");
      return;
    }

    // Reduced-motion users get the OS cursor. "hide" keeps the nodes so a
    // later init (after the preference changes) can recover; "remove" strips
    // them, matching the old destructive behaviour.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (config.reducedMotion === "remove") {
        overlay.remove();
        halo.remove();
      } else {
        overlay.hidden = true;
        halo.hidden = true;
      }
      return;
    }
    overlay.hidden = false;
    halo.hidden = false;

    var text = overlay.querySelector(".cursor-overlay-text");
    var leadIcon = overlay.querySelector(".cursor-overlay-icon-lead");
    var endIcon = overlay.querySelector(".cursor-overlay-icon-end");
    var leadUse = leadIcon && leadIcon.querySelector("use");
    var endUse = endIcon && endIcon.querySelector("use");

    if (!text || !leadIcon || !endIcon || !leadUse || !endUse) {
      console.warn("[bd-cursor] skipped — .cursor-overlay internal structure malformed.");
      return;
    }

    // Cursor is confirmed live (not reduced-motion, DOM + structure valid).
    // Only now may CSS hide the native cursor over replace elements.
    document.documentElement.classList.add("bd-cursor-ready");

    // Must match the .cursor-overlay `transition: opacity` duration — both
    // read the same component token, so they can't drift. Falls back through
    // the system token to the token's current value.
    var rootStyle = getComputedStyle(document.documentElement);
    var FADE_MS =
      parseInt(rootStyle.getPropertyValue("--bd-cursor-duration-fade"), 10) ||
      parseInt(rootStyle.getPropertyValue("--duration-2xs"), 10) ||
      100;

    // ------- State ------- //

    var mouseX = 0, mouseY = 0;
    var overlayX = 0, overlayY = 0;
    var haloX = 0, haloY = 0;
    var rafId = null;
    var lastTime = 0;
    var firstMove = true;

    var activeTarget = null;
    var phase = "idle"; // 'idle' | 'visible' | 'fading-out'
    var fadeTimeoutId = null;
    var replaceActive = false;

    // Single source of truth for the overlay transform so the two write sites
    // (animate + the firstMove snap) can never desync the offset.
    function overlayTransform(x, y) {
      var yPart = replaceActive
        ? "calc(" + y + "px - 50%)"
        : "calc(" + y + "px + " + LABEL_OFFSET_Y + "px)";
      return "translate3d(calc(" + x + "px - 50%), " + yPart + ", 0)";
    }

    function getCursorTargetAtPoint(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el) return null;
      // elementFromPoint is unaffected by cursor:none — hit-testing ignores
      // it, so replace targets keep resolving with the native cursor hidden.
      return el.closest(
        "[data-cursor-label], [" + ICON_ATTR + "], [data-cursor-icon-end], " +
        "[" + BADGE_ATTR + "], [" + GRAPHIC_ATTR + "], " +
        "[" + REPLACE_ATTR + "], [" + NATIVE_ATTR + "]"
      );
    }

    // Writes the overlay's shape + content for a (non-native) target. Returns
    // true when the overlay has something to show, false for degenerate/empty
    // authoring so the caller keeps it hidden instead of riding a blank pill.
    function applyContent(target) {
      var hasBadge = target.hasAttribute(BADGE_ATTR);
      var hasGraphic = target.hasAttribute(GRAPHIC_ATTR);
      // GRAPHIC is a cursor graphic, so it ALWAYS replaces the OS pointer.
      var replace = target.hasAttribute(REPLACE_ATTR) || hasGraphic;

      replaceActive = replace;
      document.documentElement.classList.toggle("bd-cursor-replacing", replace);

      overlay.classList.toggle("is-circle", hasBadge);
      overlay.classList.toggle("is-graphic", hasGraphic);

      if (hasBadge || hasGraphic) {
        // Badge/graphic carry a single glyph. Glyph from the atom value,
        // falling back to data-cursor-icon for the boolean form (bd-video's
        // hero uses the boolean badge + data-cursor-icon=play/pause).
        var iconName =
          target.getAttribute(hasBadge ? BADGE_ATTR : GRAPHIC_ATTR) ||
          target.getAttribute(ICON_ATTR) ||
          "";

        text.textContent = "";
        endIcon.classList.remove("has-glyph");

        if (iconName) {
          // Graphic glyphs live in the cursor sprite; badge glyphs in the
          // icon sprite.
          var spritePath = hasGraphic ? config.cursorSpritePath : config.spritePath;
          leadUse.setAttribute("href", spritePath + "#" + iconName);
          leadIcon.classList.add("has-glyph");
        } else {
          leadIcon.classList.remove("has-glyph");
        }

        return hasBadge || Boolean(iconName);
      }

      // LABEL mode — text + lead/end glyphs.
      var labelText = target.getAttribute("data-cursor-label") || "";
      var iconLead = target.getAttribute(ICON_ATTR) || "";
      var iconEnd = target.getAttribute("data-cursor-icon-end") || "";

      text.textContent = labelText;

      if (iconLead) {
        leadUse.setAttribute("href", config.spritePath + "#" + iconLead);
        leadIcon.classList.add("has-glyph");
      } else {
        leadIcon.classList.remove("has-glyph");
      }

      if (iconEnd) {
        endUse.setAttribute("href", config.spritePath + "#" + iconEnd);
        endIcon.classList.add("has-glyph");
      } else {
        endIcon.classList.remove("has-glyph");
      }

      return Boolean(labelText || iconLead || iconEnd);
    }

    // Precedence: native → replace/atom → float → label. A native target
    // renders nothing so the OS pointer shows.
    function showActiveTarget() {
      if (activeTarget && !activeTarget.hasAttribute(NATIVE_ATTR)) {
        if (applyContent(activeTarget)) {
          overlay.classList.add("is-visible");
          phase = "visible";
          return;
        }
        // Replace with nothing to show would leave a cursorless region —
        // authoring error; warn so it's caught in dev.
        if (activeTarget.hasAttribute(REPLACE_ATTR)) {
          console.warn(
            "[bd-cursor] data-cursor-replace with no resolvable glyph/label — add a badge/graphic icon or label text.",
            activeTarget
          );
        }
      }
      replaceActive = false;
      document.documentElement.classList.remove("bd-cursor-replacing");
      phase = "idle";
    }

    function completeFadeOutThenIn() {
      fadeTimeoutId = null;
      showActiveTarget();
    }

    function transitionTo(newTarget) {
      if (newTarget === activeTarget) return;
      activeTarget = newTarget;

      if (phase === "fading-out") {
        if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
        fadeTimeoutId = setTimeout(completeFadeOutThenIn, FADE_MS);
        return;
      }

      if (phase === "idle") {
        showActiveTarget();
        return;
      }

      overlay.classList.remove("is-visible");
      phase = "fading-out";
      if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
      fadeTimeoutId = setTimeout(completeFadeOutThenIn, FADE_MS);
    }

    // ------- Animation loop ------- //

    function animate(time) {
      if (!lastTime) lastTime = time;
      var dt = (time - lastTime) / (1000 / 60);
      lastTime = time;

      var labelFactor = 1 - Math.pow(1 - LABEL_LERP, dt);
      var haloFactor = 1 - Math.pow(1 - HALO_LERP, dt);

      overlayX += (mouseX - overlayX) * labelFactor;
      overlayY += (mouseY - overlayY) * labelFactor;
      haloX += (mouseX - haloX) * haloFactor;
      haloY += (mouseY - haloY) * haloFactor;

      var overlayDist = Math.abs(mouseX - overlayX) + Math.abs(mouseY - overlayY);
      var haloDist = Math.abs(mouseX - haloX) + Math.abs(mouseY - haloY);

      if (overlayDist < SNAP_THRESHOLD) { overlayX = mouseX; overlayY = mouseY; }
      if (haloDist < SNAP_THRESHOLD) { haloX = mouseX; haloY = mouseY; }

      overlay.style.transform = overlayTransform(overlayX, overlayY);
      halo.style.transform = "translate3d(calc(" + haloX + "px - 50%), calc(" + haloY + "px - 50%), 0)";

      if (overlayDist >= SNAP_THRESHOLD || haloDist >= SNAP_THRESHOLD) {
        rafId = requestAnimationFrame(animate);
      } else {
        rafId = null;
        lastTime = 0;
      }
    }

    function startAnimation() {
      if (!rafId) {
        lastTime = 0;
        rafId = requestAnimationFrame(animate);
      }
    }

    // ------- Handlers (named, so destroy can detach them) ------- //

    function onMouseMove(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;

      // Resolve target/mode FIRST so the firstMove snap uses the right offset.
      transitionTo(getCursorTargetAtPoint(mouseX, mouseY));

      if (firstMove) {
        overlayX = mouseX; overlayY = mouseY;
        haloX = mouseX; haloY = mouseY;
        overlay.style.transform = overlayTransform(overlayX, overlayY);
        halo.style.transform = "translate3d(calc(" + haloX + "px - 50%), calc(" + haloY + "px - 50%), 0)";
        firstMove = false;
      }

      startAnimation();
    }

    function onMouseDown() { halo.classList.add("cursor-pressed"); }
    function onMouseUp() { halo.classList.remove("cursor-pressed"); }

    // Scroll keeps target in sync when the mouse is still but elements move
    // beneath it. Skipped while the router's transition class is on <body> —
    // a programmatic scrollTo fires while both containers are in the DOM.
    function onScroll() {
      if (firstMove) return;
      if (
        config.suppressScrollBodyClass &&
        document.body.classList.contains(config.suppressScrollBodyClass)
      ) return;
      transitionTo(getCursorTargetAtPoint(mouseX, mouseY));
    }

    // Lets a hovered element mutate its own data-cursor-* at runtime (bd-video
    // swapping play↔pause) and have the cursor update WITHOUT the pointer
    // leaving the element. Guarded to a visible overlay.
    function onRefresh() {
      if (activeTarget && phase === "visible") applyContent(activeTarget);
    }

    // Router teardown — the native-cursor hide is pure CSS scoped to the
    // leaving element, so it self-heals on swap. But a riding badge/graphic is
    // JS state that only updates on the next mousemove/scroll, so clear it on
    // the pre-navigation signal.
    function resetCursorState() {
      activeTarget = null;
      replaceActive = false;
      phase = "idle";
      if (fadeTimeoutId) {
        clearTimeout(fadeTimeoutId);
        fadeTimeoutId = null;
      }
      overlay.classList.remove("is-visible", "is-circle", "is-graphic");
      document.documentElement.classList.remove("bd-cursor-replacing");
    }

    window.__bdCursorInited = true;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("bd-cursor:refresh", onRefresh);
    document.addEventListener("bd:before-nav", resetCursorState);
    // Legacy alias kept while Studio migrates its event vocabulary.
    document.addEventListener("studio:before-nav", resetCursorState);

    live = {
      overlay: overlay,
      halo: halo,
      reset: resetCursorState,
      detach: function () {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("scroll", onScroll);
        document.removeEventListener("bd-cursor:refresh", onRefresh);
        document.removeEventListener("bd:before-nav", resetCursorState);
        document.removeEventListener("studio:before-nav", resetCursorState);
        if (rafId) cancelAnimationFrame(rafId);
        if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
      }
    };

    console.log("[bd-cursor] v" + VERSION + " — init");
  }

  // Detach every listener and root flag so a client-side app can re-init
  // after replacing the overlay DOM. The overlay/halo nodes are left in place.
  function destroyBdCursor() {
    if (!live) return;
    live.reset();
    live.detach();
    document.documentElement.classList.remove("bd-cursor-ready");
    live = null;
    window.__bdCursorInited = false;
  }

  window.initBdCursor = initBdCursor;
  window.destroyBdCursor = destroyBdCursor;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBdCursor);
  } else {
    initBdCursor();
  }
})();
