/* @bydefaultstudio/design-system v2.2.1 */
/**
 * Script Purpose: Configurable video player — play/pause, scrubber, mute, fullscreen, keyboard shortcuts, timed cues
 * Author: By Default
 * Created: 2026-04-12
 * Version: 0.7.0
 * Last Updated: 2026-07-30
 *
 * 0.7.0 — promoted into the design system; cue label configurable; canonical
 *         bd:after-nav
 *
 * Reusable video component for the By Default site. Targets every element with
 * .bd-video-player and initialises each independently with its own config.
 *
 * Scope: this is the FULL player with controls. For other video treatments see:
 *   - Decorative autoplay loops (article bodies, section backgrounds)
 *     → plain <video class="bg-video" autoplay muted loop playsinline>,
 *       emitted by the {{bg-video}} markdown shortcode. No JS.
 *
 * Configuration via data attributes on .bd-video container:
 *   data-bd-scrubber       — enable scrubber + time display
 *   data-bd-mute           — enable mute/unmute button
 *   data-bd-fullscreen     — enable fullscreen button
 *   data-bd-unmute-prompt  — show large unmute prompt (for autoplay muted)
 *   data-bd-cues           — enable timed link cards via inline JSON data block
 *
 * Configuration via window.bdVideoConfig, defined BEFORE this script loads.
 * Every key is optional; defaults reproduce the original Studio build:
 *
 *   window.bdVideoConfig = {
 *     // Float-cursor label shown over a timed cue card (badge cursor only).
 *     cueLabel: "View case study"
 *   };
 *
 * Always-on features:
 *   - Large centered play/pause button with tooltip
 *   - Tap/click video to toggle play/pause
 *   - Controls auto-hide after 3s idle, reappear on hover/tap
 *   - Center button stays visible while paused
 *   - Reduced motion: video does not autoplay, poster shows
 *   - Global keyboard shortcuts (Space/K, M, F, arrows)
 *   - ARIA labels update dynamically with state
 *   - Timestamped link cards via data-bd-cues + inline JSON data block
 *
 * Sustainability roadmap (priority-ordered, NOT built yet):
 *   1. [CRITICAL] Captions / subtitles — <track kind="subtitles"> + data-bd-captions
 *                  CC toggle. WCAG 1.2.2 Level A.
 *   2. Loading state class (.is-loading on `waiting`, removed on `canplay`) —
 *                  avoids the "is it frozen?" problem on slow connections.
 *   3. Error state class (.is-error on `error`) — prevents silent broken state
 *                  when a source fails (e.g. expired URLs).
 *   4. Public custom events — partially implemented (cue events only:
 *                  bd-video:cue-enter, bd-video:cue-exit). Remaining:
 *                  bd-video:play / pause / ended / error / waiting still pending.
 *   5. Visibility-based pause (data-bd-pause-offscreen) — IntersectionObserver.
 *                  Saves CPU/battery on long pages with multiple videos.
 *   6. Lazy preload upgrade — preload="none" default, upgrade to "metadata" on
 *                  near-viewport, "auto" on first play(). Bandwidth win.
 *   7. Volume slider (data-bd-volume) — finer control than just mute/unmute.
 *   8. Playback rate menu (data-bd-rate) — 0.5×/1×/1.5×/2× for long-form.
 *   9. Download prevention — controlsList="nodownload" + context-menu off.
 *                  Deters casual scraping of client work.
 *   10. Transcript toggle — sibling <details>, WCAG 1.2.3 alternative.
 *   11. Cross-video exclusivity (data-bd-exclusive) — pause others on play.
 *   12. <source> format fallback — already works, document AV1/WebM/MP4 chain.
 *
 * TODO (accessibility, not blocking V1):
 *   - Below-video text list of cues as WCAG 1.2.3 media alternative
 */

// BD Video v0.7.0

(function () {

//
//------- Page config -------//
//
// Same optional-config pattern as the other bd-* modules: window.bdVideoConfig
// is read at init, every key optional, missing keys fall back to DEFAULTS.

var CONFIG_DEFAULTS = {
  cueLabel: "View case study"
};

// Resolved in initBdVideo(); seeded with the defaults so a player is never
// left reading an unresolved config.
var moduleConfig = CONFIG_DEFAULTS;

function resolveConfig() {
  var user = window.bdVideoConfig || {};
  var resolved = {};
  for (var key in CONFIG_DEFAULTS) {
    resolved[key] = Object.prototype.hasOwnProperty.call(user, key)
      ? user[key]
      : CONFIG_DEFAULTS[key];
  }
  return resolved;
}

//
//------- Icon SVGs -------//
//
// The player carries its own scoped sprite so it works in any page without a
// dependency on the studio-wide icon sprite. Symbol IDs are namespaced as
// #bd-video-* so they can't clash with a host page's main sprite.
// The sprite host is injected into <body> on first init via ensureBdVideoSprite().

var BD_VIDEO_SPRITE_HOST_ID = "bd-video-sprite-host";
var BD_VIDEO_SPRITE = ''
  + '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">'
  +   '<symbol id="bd-video-play" viewBox="0 0 24 24"><path d="M19 11.1357V12.8643L7.50391 20L6 19V5L7.50391 4L19 11.1357Z" fill="currentColor"/></symbol>'
  +   '<symbol id="bd-video-pause" viewBox="0 0 24 24"><path d="M13 19V5H19V19H13ZM5 19V5H11V19H5ZM15 16C15 16.5523 15.4477 17 16 17C16.5523 17 17 16.5523 17 16V8C17 7.44772 16.5523 7 16 7C15.4477 7 15 7.44772 15 8V16ZM7 16C7 16.5523 7.44772 17 8 17C8.55228 17 9 16.5523 9 16V8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8V16Z" fill="currentColor"/></symbol>'
  +   '<symbol id="bd-video-sound-on" viewBox="0 0 24 24"><path d="M14 2.98535C17.7763 4.24145 20.5 7.80184 20.5 12C20.5 16.1981 17.7761 19.7575 14 21.0137V18.873C16.6483 17.7155 18.5 15.0751 18.5 12C18.5 8.92479 16.6485 6.28347 14 5.12598V2.98535Z" fill="currentColor"/><path d="M14 7.39062C15.5048 8.37203 16.5 10.0694 16.5 12C16.5 13.9304 15.5046 15.627 14 16.6084V7.39062Z" fill="currentColor"/><path d="M12 20L6.66699 16H3V8H6.66699L12 4V20ZM7.33301 10H6C5.44772 10 5 10.4477 5 11V13C5 13.5523 5.44772 14 6 14H7.33301L9.20002 15.4001C9.52965 15.6473 10 15.4121 10 15.0001V8.99924C10 8.58718 9.52954 8.352 9.19993 8.5993L7.33301 10Z" fill="currentColor"/></symbol>'
  +   '<symbol id="bd-video-sound-off" viewBox="0 0 24 24"><path fill-rule="evenodd" clip-rule="evenodd" d="M21.7031 21.2969L20.293 22.707L16.9707 19.3848C16.0951 20.0931 15.0921 20.6504 14 21.0137V18.873C14.5538 18.631 15.0714 18.3222 15.5459 17.96L12 14.4141V20L6.66699 16H3V8H5.58594L1.29297 3.70703L2.70312 2.29688L21.7031 21.2969ZM6 10C5.44772 10 5 10.4477 5 11V13C5 13.5523 5.44772 14 6 14H7.33301L9.2002 15.4004C9.52981 15.6473 10 15.4119 10 15V12.4141L7.58594 10H6Z" fill="currentColor"/><path d="M14 2.98535C17.7763 4.24145 20.5 7.80184 20.5 12C20.5 13.5314 20.1356 14.9766 19.4912 16.2568L17.9795 14.7451C18.315 13.8952 18.5 12.9695 18.5 12C18.5 8.92479 16.6485 6.28347 14 5.12598V2.98535Z" fill="currentColor"/><path d="M14 7.39062C15.5048 8.37203 16.5 10.0694 16.5 12C16.5 12.3925 16.4564 12.7747 16.3779 13.1436L14 10.7656V7.39062Z" fill="currentColor"/><path d="M12 8.76562L9.27637 6.04199L12 4V8.76562Z" fill="currentColor"/></symbol>'
  +   '<symbol id="bd-video-fullscreen-enter" viewBox="0 0 24 24"><path d="M9.70703 15.707L6.26762 19.1464C5.95263 19.4614 6.17572 20 6.62117 20H9V22H2V15H4V17.3788C4 17.8243 4.53857 18.0474 4.85355 17.7324L8.29297 14.293L9.70703 15.707ZM19.1464 17.7324C19.4614 18.0474 20 17.8243 20 17.3788V15H22V22H15V20H17.3788C17.8243 20 18.0474 19.4614 17.7324 19.1464L14.293 15.707L15.707 14.293L19.1464 17.7324ZM9 2V4H6.62117C6.17572 4 5.95263 4.53857 6.26762 4.85355L9.70703 8.29297L8.29297 9.70703L4.85355 6.26762C4.53857 5.95263 4 6.17572 4 6.62117V9H2V2H9ZM22 9H20V6.62117C20 6.17572 19.4614 5.95263 19.1464 6.26762L15.707 9.70703L14.293 8.29297L17.7324 4.85355C18.0474 4.53857 17.8243 4 17.3788 4H15V2H22V9Z" fill="currentColor"/></symbol>'
  +   '<symbol id="bd-video-fullscreen-exit" viewBox="0 0 24 24"><path d="M14.293 8.29297L17.7324 4.85355C18.0474 4.53857 17.8243 4 17.3788 4H15V2H22V9H20V6.62117C20 6.17572 19.4614 5.95263 19.1464 6.26762L15.707 9.70703L14.293 8.29297ZM4.85355 6.26762C4.53857 5.95263 4 6.17572 4 6.62117V9H2V2H9V4H6.62117C6.17572 4 5.95263 4.53857 6.26762 4.85355L9.70703 8.29297L8.29297 9.70703L4.85355 6.26762ZM8.29297 14.293L4.85355 17.7324C4.53857 18.0474 4 17.8243 4 17.3788V15H2V22H9V20H6.62117C6.17572 20 5.95263 19.4614 6.26762 19.1464L9.70703 15.707L8.29297 14.293ZM15.707 14.293L19.1464 17.7324C19.4614 18.0474 20 17.8243 20 17.3788V15H22V22H15V20H17.3788C17.8243 20 18.0474 19.4614 17.7324 19.1464L14.293 15.707L15.707 14.293Z" fill="currentColor"/></symbol>'
  + '</svg>';

function ensureBdVideoSprite() {
  if (document.getElementById(BD_VIDEO_SPRITE_HOST_ID)) return;
  var host = document.createElement("div");
  host.id = BD_VIDEO_SPRITE_HOST_ID;
  host.style.display = "none";
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = BD_VIDEO_SPRITE;
  if (document.body) {
    document.body.prepend(host);
  } else {
    document.documentElement.appendChild(host);
  }
}

function bdVideoIcon(name, dataIconName) {
  return ''
    + '<div class="svg-icn">'
    +   '<svg data-icon="' + dataIconName + '" width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    +     '<use href="#bd-video-' + name + '"/>'
    +   '</svg>'
    + '</div>';
}

var ICON_PLAY = bdVideoIcon("play", "play");
var ICON_PAUSE = bdVideoIcon("pause", "pause");
var ICON_SOUND_ON = bdVideoIcon("sound-on", "sound-on");
var ICON_SOUND_OFF = bdVideoIcon("sound-off", "sound-off");
var ICON_FS_ENTER = bdVideoIcon("fullscreen-enter", "fullscreen-enter");
var ICON_FS_EXIT = bdVideoIcon("fullscreen-exit", "fullscreen-exit");

//
//------- Constants -------//
//

var HIDE_DELAY = 3000;
var SEEK_STEP = 5;
var SEEK_PAGE_PERCENT = 0.1;

// Live viewport observers, one per opted-in player instance (data-bd-pause-offscreen).
// window.cleanupBdVideo() disconnects them on Barba nav-away so no stray callbacks fire
// against a detaching container and observers don't accumulate across navigations.
var instanceObservers = [];

// document-/window-level listeners registered per player instance (they close over
// that instance's nodes). Barba never replaces `document`, so without teardown each
// visited page's players leave their listeners bound forever — retaining detached
// DOM and firing N stale copies (e.g. the sidebar sound toggle updating N dead mute
// buttons). cleanupBdVideo() removes them on nav-away, symmetric with re-init on the
// entering container. Player-root listeners are NOT tracked here — they die with the
// swapped container.
var instanceListeners = [];
function addInstanceListener(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  instanceListeners.push({ target: target, type: type, handler: handler, opts: opts });
}

//
//------- Utility Functions -------//
//

function formatTimeText(seconds) {
  var mins = Math.floor(seconds / 60);
  var secs = Math.floor(seconds % 60);
  if (mins === 0) return secs + " second" + (secs !== 1 ? "s" : "");
  return mins + " minute" + (mins !== 1 ? "s" : "") + " " + secs + " second" + (secs !== 1 ? "s" : "");
}

function formatTimeDisplay(seconds) {
  var mins = Math.floor(seconds / 60);
  var secs = Math.floor(seconds % 60);
  return mins + ":" + (secs < 10 ? "0" : "") + secs;
}

function dispatch(root, name, detail) {
  root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
}

//
//------- Player Instance -------//
//

function initPlayerInstance(video) {
  var root = video.closest(".bd-video");
  if (!root) return;
  if (root.hasAttribute("data-bd-init")) return;
  root.setAttribute("data-bd-init", "");

  // Read config from data attributes
  var config = {
    scrubber: root.hasAttribute("data-bd-scrubber"),
    mute: root.hasAttribute("data-bd-mute"),
    fullscreen: root.hasAttribute("data-bd-fullscreen"),
    unmutePrompt: root.hasAttribute("data-bd-unmute-prompt"),
    cues: root.hasAttribute("data-bd-cues"),
    pauseOffscreen: root.hasAttribute("data-bd-pause-offscreen")
  };

  // Whether this player rides the custom badge cursor (the home hero). Controls
  // only mirror it when the root opts in; plain native-cursor videos (case-study
  // pages, no data-cursor-* on the root) stay untouched.
  var badgeCursor = root.hasAttribute("data-cursor-badge");

  // Per-instance state
  var hideTimer = null;
  var isScrubbing = false;
  // On a Barba return, studio-barba.js's beforeEnter hook has already stripped the
  // `autoplay` attribute and left a data-bd-deferred-autoplay marker (resumed on
  // bd:after-nav by the Barba sync block below). Treat that marker as equivalent
  // to live autoplay so the muted preview state restores on every arrival, not just
  // cold load. NOTE: this relies on afterEnter running initBdVideo before it dispatches
  // bd:after-nav — keep that order.
  var isPreview = video.muted && (video.autoplay || video.hasAttribute("data-bd-deferred-autoplay"));
  var previewExitAt = 0;
  // Viewport auto-pause: true only while WE soft-paused an offscreen video, so the
  // resume-on-reenter below never plays a video the user deliberately paused, and never
  // fights the deferred-autoplay / intro-sync first play(). Cleared on any user toggle.
  var resumeOnReenter = false;

  // Element references (set conditionally below)
  var muteBtn = null;
  var fsBtn = null;
  var scrubber = null;
  var scrubberFill = null;
  var timeDisplay = null;
  var unmutePrompt = null;

  //
  // -- Controls auto-hide --
  //

  function showControls() {
    root.classList.remove("is-controls-hidden");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function autoHide() {
      if (!video.paused && !root.contains(document.activeElement)) {
        root.classList.add("is-controls-hidden");
      }
    }, HIDE_DELAY);
  }

  //
  // -- Center play/pause button (always on) --
  //

  var centerBtn = document.createElement("button");
  centerBtn.type = "button";
  centerBtn.className = "bd-video-center-play";
  root.appendChild(centerBtn);

  // In preview mode, show play icon (invitation to start); otherwise pause
  if (isPreview) {
    root.classList.add("is-preview");
    centerBtn.innerHTML = ICON_PLAY;
    centerBtn.setAttribute("aria-label", "Play");
    centerBtn.setAttribute("data-tooltip", "Play");
  } else {
    centerBtn.innerHTML = ICON_PAUSE;
    centerBtn.setAttribute("aria-label", "Pause");
    centerBtn.setAttribute("data-tooltip", "Pause");
  }

  // Remove any old inline play button from the controls bar
  // Legacy data-hv-* hooks (data-hv-play / data-hv-mute / data-hv-fs) are rename candidates for the next major.
  var oldPlayBtn = root.querySelector("[data-hv-play]");
  if (oldPlayBtn) oldPlayBtn.remove();

  // Initial cursor/state, matching the center button just set above.
  syncCursor();

  function syncPausedState() {
    root.classList.toggle("is-paused", video.paused);
  }

  // Publish the playback state for adapters: a portable data-bd-state + bubbling
  // bd-video:statechange event (the standalone-player contract), and — only when the
  // host opted into the custom cursor by authoring data-cursor-icon — the matching
  // cursor icon/label, refreshed instantly via bd-cursor:refresh. preview/paused → play,
  // playing → pause. ONLY call this from paths that also (re)assert the center button's
  // aria-label, so the visual cursor never diverges from the SR-exposed state; never
  // from the offscreen soft-pause path, which intentionally freezes the chrome.
  function syncCursor() {
    var state = isPreview ? "preview" : (video.paused ? "paused" : "playing");
    root.setAttribute("data-bd-state", state);
    dispatch(root, "bd-video:statechange", { state: state });
    if (root.hasAttribute("data-cursor-icon")) {
      root.setAttribute("data-cursor-icon", state === "playing" ? "pause" : "play");
      root.setAttribute(
        "data-cursor-label",
        state === "preview" ? "Play Reel" : (state === "playing" ? "Pause" : "Play")
      );
      document.dispatchEvent(new CustomEvent("bd-cursor:refresh"));
    }
  }

  // Keep the mute button's riding cursor icon in step with mute state — sound-off
  // when muted, sound-on when audible. bd-cursor:refresh re-reads the hovered
  // target live (no-op when the button isn't under the pointer). Badge cursor only.
  function syncMuteCursor() {
    if (!badgeCursor || !muteBtn) return;
    muteBtn.setAttribute("data-cursor-badge", video.muted ? "sound-off" : "sound-on");
    document.dispatchEvent(new CustomEvent("bd-cursor:refresh"));
  }

  // Exit preview mode — restart from 0, unmute, transition to active playback
  function exitPreview() {
    if (!isPreview) return;
    isPreview = false;
    resumeOnReenter = false; // user took control — cancel any pending viewport auto-resume
    previewExitAt = Date.now();
    root.classList.remove("is-preview");
    video.currentTime = 0;
    video.muted = false;
    root.classList.add("is-unmuted");
    video.play();
    centerBtn.innerHTML = ICON_PAUSE;
    centerBtn.setAttribute("aria-label", "Pause");
    centerBtn.setAttribute("data-tooltip", "Pause");
    if (muteBtn) {
      muteBtn.classList.remove("is-mute-hidden");
      muteBtn.innerHTML = ICON_SOUND_ON;
      muteBtn.setAttribute("aria-label", "Mute");
      muteBtn.setAttribute("data-tooltip", "Mute");
    }
    syncMuteCursor();
    syncPausedState();
    showControls();
    syncCursor();
  }

  function togglePlay() {
    // In preview mode, clicking play exits preview instead of toggling
    if (isPreview) {
      exitPreview();
      return;
    }
    resumeOnReenter = false; // explicit user toggle wins over viewport auto-resume
    if (video.paused) {
      video.play();
      centerBtn.innerHTML = ICON_PAUSE;
      centerBtn.setAttribute("aria-label", "Pause");
      centerBtn.setAttribute("data-tooltip", "Pause");
      showControls();
    } else {
      video.pause();
      centerBtn.innerHTML = ICON_PLAY;
      centerBtn.setAttribute("aria-label", "Play");
      centerBtn.setAttribute("data-tooltip", "Play");
      root.classList.remove("is-controls-hidden");
      clearTimeout(hideTimer);
    }
    syncPausedState();
    syncCursor();
  }

  centerBtn.addEventListener("click", togglePlay);
  video.addEventListener("click", togglePlay);

  //
  // -- Unmute prompt (config: unmutePrompt) --
  //

  function handleUnmute() {
    // In preview mode, unmuting exits preview (restarts + unmutes)
    if (isPreview) {
      exitPreview();
      return;
    }
    video.muted = false;
    root.classList.add("is-unmuted");
    if (muteBtn) {
      muteBtn.classList.remove("is-mute-hidden");
      muteBtn.innerHTML = ICON_SOUND_ON;
      muteBtn.setAttribute("aria-label", "Mute");
      muteBtn.setAttribute("data-tooltip", "Mute");
    }
    syncMuteCursor();
  }

  if (config.unmutePrompt && video.muted) {
    unmutePrompt = document.createElement("button");
    unmutePrompt.type = "button";
    unmutePrompt.className = "bd-video-unmute-prompt";
    unmutePrompt.setAttribute("aria-label", "Unmute");
    unmutePrompt.innerHTML = ICON_SOUND_OFF + "<span>Unmute</span>";
    root.appendChild(unmutePrompt);
    unmutePrompt.addEventListener("click", handleUnmute);
  }

  //
  // -- Controls bar (ensure it exists for mute/fullscreen/scrubber) --
  //

  var controlsBar = root.querySelector(".bd-video-controls");
  if (!controlsBar && (config.mute || config.fullscreen || config.scrubber)) {
    controlsBar = document.createElement("div");
    controlsBar.className = "bd-video-controls";
    root.appendChild(controlsBar);
  }

  //
  // -- Mute button (config: mute) --
  //

  if (config.mute) {
    muteBtn = root.querySelector("[data-hv-mute]");
    if (!muteBtn && controlsBar) {
      muteBtn = document.createElement("button");
      muteBtn.type = "button";
      muteBtn.className = "bd-video-btn";
      muteBtn.setAttribute("data-hv-mute", "");
      muteBtn.setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
      muteBtn.setAttribute("data-tooltip", video.muted ? "Unmute" : "Mute");
      muteBtn.innerHTML = video.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
      controlsBar.appendChild(muteBtn);
    }
    if (muteBtn) {
      // Badge cursor rides the pointer over this button (native hidden); the glyph
      // stays in sync with mute state via syncMuteCursor.
      if (badgeCursor) muteBtn.setAttribute("data-cursor-replace", "");
      // When unmute prompt is active, hide the control bar mute button initially
      if (config.unmutePrompt && video.muted) {
        muteBtn.classList.add("is-mute-hidden");
      }
      muteBtn.addEventListener("click", function handleMuteClick() {
        if (!video.muted) {
          video.muted = true;
          muteBtn.innerHTML = ICON_SOUND_OFF;
          muteBtn.setAttribute("aria-label", "Unmute");
          muteBtn.setAttribute("data-tooltip", "Unmute");
          syncMuteCursor();
        } else {
          handleUnmute();
        }
      });
      // Initial riding-cursor icon, matching the button icon set above.
      syncMuteCursor();
    }
  }

  //
  // -- Fullscreen button (config: fullscreen) --
  //

  if (config.fullscreen) {
    fsBtn = root.querySelector("[data-hv-fs]");
    if (!fsBtn && controlsBar) {
      fsBtn = document.createElement("button");
      fsBtn.type = "button";
      fsBtn.className = "bd-video-btn";
      fsBtn.setAttribute("data-hv-fs", "");
      fsBtn.setAttribute("aria-label", "Fullscreen");
      fsBtn.setAttribute("data-tooltip", "Fullscreen");
      fsBtn.innerHTML = ICON_FS_ENTER;
      controlsBar.appendChild(fsBtn);
    }
    if (fsBtn) {
      // Riding cursor over the fullscreen button — static; the global sprite has
      // no clean "exit fullscreen" glyph, so it isn't state-aware like mute.
      if (badgeCursor) {
        fsBtn.setAttribute("data-cursor-badge", "full-screen");
        fsBtn.setAttribute("data-cursor-replace", "");
      }
      fsBtn.addEventListener("click", function handleFullscreen() {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (root.requestFullscreen) {
          root.requestFullscreen();
        }
      });

      addInstanceListener(document, "fullscreenchange", function handleFsChange() {
        if (!fsBtn) return;
        if (document.fullscreenElement === root) {
          fsBtn.innerHTML = ICON_FS_EXIT;
          fsBtn.setAttribute("aria-label", "Exit fullscreen");
          fsBtn.setAttribute("data-tooltip", "Exit fullscreen");
        } else {
          fsBtn.innerHTML = ICON_FS_ENTER;
          fsBtn.setAttribute("aria-label", "Fullscreen");
          fsBtn.setAttribute("data-tooltip", "Fullscreen");
        }
      });
    }
  }

  //
  // -- Scrubber + time display (config: scrubber) --
  //

  if (config.scrubber) {
    // Create scrubber
    scrubber = document.createElement("div");
    scrubber.className = "bd-video-scrubber";
    // Suppress the riding play/pause cursor here — seeking needs the native
    // pointer. data-cursor-native carves the scrubber out of the badge region and
    // restores the OS pointer (bd-cursor.css re-asserts cursor:auto; bd-video.css
    // upgrades it to a pointer). Badge cursor only.
    if (badgeCursor) scrubber.setAttribute("data-cursor-native", "");
    scrubber.setAttribute("role", "slider");
    scrubber.setAttribute("tabindex", "0");
    scrubber.setAttribute("aria-label", "Seek");
    scrubber.setAttribute("aria-valuemin", "0");
    scrubber.setAttribute("aria-valuemax", "0");
    scrubber.setAttribute("aria-valuenow", "0");
    scrubber.setAttribute("aria-valuetext", "0 seconds of 0 seconds");

    scrubberFill = document.createElement("div");
    scrubberFill.className = "bd-video-scrubber-fill";
    scrubber.appendChild(scrubberFill);
    root.appendChild(scrubber);

    // Create seek tooltip (sibling of scrubber, inside root to avoid overflow clip)
    var seekTooltip = document.createElement("div");
    seekTooltip.className = "bd-video-seek-tooltip";
    seekTooltip.setAttribute("aria-hidden", "true");
    seekTooltip.textContent = "0:00";
    root.appendChild(seekTooltip);

    // Group existing buttons into left/right layout
    if (controlsBar) {
      // Wrap existing children (mute, fullscreen buttons) into a right group
      var rightGroup = document.createElement("div");
      rightGroup.className = "bd-video-controls-right";
      while (controlsBar.firstChild) {
        rightGroup.appendChild(controlsBar.firstChild);
      }
      controlsBar.appendChild(rightGroup);

      // Insert time display as the left element
      timeDisplay = document.createElement("span");
      timeDisplay.className = "bd-video-time";
      timeDisplay.setAttribute("aria-hidden", "true");
      timeDisplay.textContent = "0:00 / 0:00";
      controlsBar.insertBefore(timeDisplay, rightGroup);
    }

    // Set duration when metadata loads
    video.addEventListener("loadedmetadata", function setDuration() {
      scrubber.setAttribute("aria-valuemax", String(Math.round(video.duration)));
      if (timeDisplay) {
        timeDisplay.textContent = formatTimeDisplay(video.currentTime) + " / " + formatTimeDisplay(video.duration);
      }
    });

    // Update scrubber on playback
    video.addEventListener("timeupdate", function updateScrubber() {
      if (isScrubbing) return;
      var pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
      scrubberFill.style.width = pct + "%";
      scrubber.setAttribute("aria-valuenow", String(Math.round(video.currentTime)));
      scrubber.setAttribute("aria-valuetext",
        formatTimeText(video.currentTime) + " of " + formatTimeText(video.duration)
      );
      if (timeDisplay) {
        timeDisplay.textContent = formatTimeDisplay(video.currentTime) + " / " + formatTimeDisplay(video.duration);
      }
    });

    // Click to seek
    function seekToPosition(clientX) {
      var rect = scrubber.getBoundingClientRect();
      var x = clientX - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      video.currentTime = pct * video.duration;
    }

    scrubber.addEventListener("click", function handleScrubberClick(e) {
      seekToPosition(e.clientX);
    });

    // Seek tooltip — follows cursor along the scrubber
    function updateSeekTooltip(clientX) {
      var rect = scrubber.getBoundingClientRect();
      var x = clientX - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      var time = pct * (video.duration || 0);
      seekTooltip.textContent = formatTimeDisplay(time);
      // Position relative to the scrubber's left edge within root
      var rootRect = root.getBoundingClientRect();
      var left = clientX - rootRect.left;
      // Clamp so tooltip doesn't overflow the container edges
      var tooltipWidth = seekTooltip.offsetWidth / 2;
      left = Math.max(tooltipWidth, Math.min(rootRect.width - tooltipWidth, left));
      seekTooltip.style.left = left + "px";
    }

    scrubber.addEventListener("mousemove", function handleScrubberHover(e) {
      if (!video.duration) return;
      seekTooltip.classList.add("is-visible");
      updateSeekTooltip(e.clientX);
    });

    scrubber.addEventListener("mouseleave", function handleScrubberLeave() {
      if (!isScrubbing) {
        seekTooltip.classList.remove("is-visible");
      }
    });

    // Mouse drag
    function startScrub(e) {
      isScrubbing = true;
      scrubber.classList.add("is-scrubbing");
      seekTooltip.classList.add("is-visible");
      seekToPosition(e.clientX);
      updateSeekTooltip(e.clientX);
      document.addEventListener("mousemove", doScrub);
      document.addEventListener("mouseup", stopScrub);
    }

    function doScrub(e) {
      if (!isScrubbing) return;
      showControls();
      var rect = scrubber.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      scrubberFill.style.width = (pct * 100) + "%";
      video.currentTime = pct * video.duration;
      updateSeekTooltip(e.clientX);
    }

    function stopScrub() {
      isScrubbing = false;
      scrubber.classList.remove("is-scrubbing");
      seekTooltip.classList.remove("is-visible");
      document.removeEventListener("mousemove", doScrub);
      document.removeEventListener("mouseup", stopScrub);
    }

    scrubber.addEventListener("mousedown", function handleMouseDown(e) {
      e.preventDefault();
      startScrub(e);
    });

    // Touch drag
    function startTouchScrub(e) {
      isScrubbing = true;
      scrubber.classList.add("is-scrubbing");
      doTouchScrub(e);
      document.addEventListener("touchmove", doTouchScrub, { passive: false });
      document.addEventListener("touchend", stopTouchScrub);
    }

    function doTouchScrub(e) {
      if (!isScrubbing) return;
      e.preventDefault();
      showControls();
      var touch = e.touches[0];
      var rect = scrubber.getBoundingClientRect();
      var x = touch.clientX - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      scrubberFill.style.width = (pct * 100) + "%";
      video.currentTime = pct * video.duration;
    }

    function stopTouchScrub() {
      isScrubbing = false;
      scrubber.classList.remove("is-scrubbing");
      document.removeEventListener("touchmove", doTouchScrub);
      document.removeEventListener("touchend", stopTouchScrub);
    }

    scrubber.addEventListener("touchstart", startTouchScrub, { passive: false });

    // Keyboard navigation on scrubber
    scrubber.addEventListener("keydown", function handleScrubberKeys(e) {
      var dur = video.duration || 0;
      if (!dur) return;

      var handled = true;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          video.currentTime = Math.min(dur, video.currentTime + SEEK_STEP);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          video.currentTime = Math.max(0, video.currentTime - SEEK_STEP);
          break;
        case "PageUp":
          video.currentTime = Math.min(dur, video.currentTime + dur * SEEK_PAGE_PERCENT);
          break;
        case "PageDown":
          video.currentTime = Math.max(0, video.currentTime - dur * SEEK_PAGE_PERCENT);
          break;
        case "Home":
          video.currentTime = 0;
          break;
        case "End":
          video.currentTime = dur;
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
        showControls();
      }
    });
  }

  //
  // -- Timed cue cards (config: cues) --
  //

  if (config.cues) {
    // 1. Parse inline JSON
    var cueDataEl = root.querySelector('script[data-bd-cues-data]');
    var cues = [];
    if (cueDataEl) {
      try {
        cues = JSON.parse(cueDataEl.textContent);
      } catch (err) {
        console.warn("BD Video cues: invalid JSON", err);
      }
    }

    if (cues.length > 0) {
      // 2. Validate entries — drop invalid, keep valid
      cues = cues.filter(function validateCue(c, i) {
        if (typeof c.start !== "number" || typeof c.end !== "number" ||
            !c.title || !c.href || !c.image) {
          console.warn("BD Video cues: invalid entry at index " + i, c);
          return false;
        }
        if (c.end <= c.start) {
          console.warn("BD Video cues: end <= start at index " + i, c);
          return false;
        }
        return true;
      });

      // 3. Sort by start ascending (idempotent)
      cues.sort(function sortByStart(a, b) { return a.start - b.start; });

      // 4. Preload thumbnails
      cues.forEach(function preloadThumb(c) { (new Image()).src = c.image; });

      // 5. Build cue slot DOM
      var cueRegion = document.createElement("div");
      cueRegion.className = "bd-video-cue-region";
      cueRegion.setAttribute("aria-live", "polite");

      var cueSlot = document.createElement("a");
      cueSlot.className = "bd-video-cue-slot";
      // Over a cue card the riding play/pause icon gives way to a float label
      // (native pointer stays) — window.bdVideoConfig.cueLabel, defaulting to
      // "View case study". Badge cursor only.
      if (badgeCursor) {
        cueSlot.setAttribute("data-cursor-icon", "arrow-top-right");
        cueSlot.setAttribute("data-cursor-label", moduleConfig.cueLabel);
      }

      var cueThumb = document.createElement("img");
      cueThumb.className = "bd-video-cue-thumb";
      cueThumb.loading = "eager";
      cueThumb.alt = "";
      cueSlot.appendChild(cueThumb);

      var cueTextWrap = document.createElement("span");
      cueTextWrap.className = "bd-video-cue-text";

      var cueTitle = document.createElement("span");
      cueTitle.className = "bd-video-cue-title";
      cueTextWrap.appendChild(cueTitle);

      var cueExcerpt = document.createElement("span");
      cueExcerpt.className = "bd-video-cue-excerpt";
      cueTextWrap.appendChild(cueExcerpt);

      cueSlot.appendChild(cueTextWrap);
      cueRegion.appendChild(cueSlot);
      root.appendChild(cueRegion);

      // 6. State
      var currentCueIndex = -1;
      var announcedCues = {};
      var hoverHolding = false;
      var hoverHoldTimer = null;

      // 7. Resolve active cue from current time
      function resolveActiveCue(t) {
        // Suppress during preview
        if (isPreview) return -1;
        // Suppress during scrubbing
        if (isScrubbing) return -1;
        // Suppress briefly after preview exit
        if (previewExitAt > 0 && Date.now() - previewExitAt < 800) return -1;

        for (var i = 0; i < cues.length; i++) {
          if (t >= cues[i].start && t < cues[i].end) return i;
        }
        return -1;
      }

      // 8. Show a cue
      function showCue(index) {
        var c = cues[index];
        cueThumb.src = c.image;
        cueTitle.textContent = c.title;
        cueExcerpt.textContent = c.excerpt || "";
        cueSlot.href = c.href;
        root.classList.add("is-cue-visible");

        // Only update live region text on first announcement per cue.
        // Changing textContent in a persistent aria-live region triggers SR.
        // On subsequent loops, text is unchanged so SR stays silent.
        if (!announcedCues[index]) {
          cueRegion.setAttribute("aria-label", c.title + " — " + (c.excerpt || ""));
          announcedCues[index] = true;
        }

        dispatch(root, "bd-video:cue-enter", {
          cue: { start: c.start, end: c.end, title: c.title, href: c.href, index: index }
        });
      }

      // 9. Hide the active cue
      function hideCue(reason) {
        var outgoing = cues[currentCueIndex];

        // Focus management — move focus before hiding.
        // Only focus centerBtn if it's visible (paused or controls shown).
        if (document.activeElement === cueSlot) {
          if (!root.classList.contains("is-controls-hidden") || video.paused) {
            centerBtn.focus();
          } else {
            cueSlot.blur();
          }
        }

        root.classList.remove("is-cue-visible");

        if (outgoing) {
          dispatch(root, "bd-video:cue-exit", {
            cue: { start: outgoing.start, end: outgoing.end, title: outgoing.title, href: outgoing.href, index: currentCueIndex },
            reason: reason || "time"
          });
        }
      }

      // 10. Evaluate on each tick
      function handleCueTick() {
        var resolved = resolveActiveCue(video.currentTime);

        if (resolved === currentCueIndex) return;

        // Hover hold — if user is hovering, defer hide until mouseleave.
        // Timeout fallback prevents :hover sticking on touch devices.
        if (currentCueIndex !== -1 && resolved !== currentCueIndex) {
          if (cueSlot.matches(":hover")) {
            hoverHolding = true;
            clearTimeout(hoverHoldTimer);
            hoverHoldTimer = setTimeout(function forceReleaseHold() {
              if (!hoverHolding) return;
              hoverHolding = false;
              var fresh = resolveActiveCue(video.currentTime);
              if (fresh !== currentCueIndex) {
                hideCue("time");
                if (fresh !== -1) showCue(fresh);
                currentCueIndex = fresh;
              }
            }, 3000);
            return;
          }
          hideCue("time");
        }

        if (resolved !== -1) {
          showCue(resolved);
        }

        currentCueIndex = resolved;
      }

      // 11. Click handler — pause + navigate (fullscreen-aware)
      cueSlot.addEventListener("click", function handleCueClick(e) {
        e.preventDefault();
        var href = cueSlot.href;

        if (document.fullscreenElement) {
          // Exit fullscreen first, then navigate
          document.addEventListener("fullscreenchange", function onFsExit() {
            video.pause();
            if (typeof barba !== "undefined" && barba.go) {
              barba.go(href);
            } else {
              window.location.href = href;
            }
          }, { once: true });
          document.exitFullscreen();
        } else {
          video.pause();
          if (typeof barba !== "undefined" && barba.go) {
            barba.go(href);
          } else {
            window.location.href = href;
          }
        }
      });

      // 12. Hover hold — release on mouseleave
      cueSlot.addEventListener("mouseleave", function handleCueMouseLeave() {
        if (!hoverHolding) return;
        hoverHolding = false;
        clearTimeout(hoverHoldTimer);
        // Re-evaluate — the cue time window may have passed
        var resolved = resolveActiveCue(video.currentTime);
        if (resolved !== currentCueIndex) {
          hideCue("time");
          if (resolved !== -1) {
            showCue(resolved);
          }
          currentCueIndex = resolved;
        }
      });

      // 13. Attach listeners
      video.addEventListener("timeupdate", handleCueTick);
      video.addEventListener("seeked", handleCueTick);
      video.addEventListener("ended", function handleCueEnded() {
        if (currentCueIndex !== -1) {
          hideCue("ended");
          currentCueIndex = -1;
        }
      });
    }
  }

  //
  // -- Reduced motion --
  //

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    // Drop the deferred-autoplay marker too — otherwise the Barba transition
    // sync block below would play() on bd:after-nav, overriding the
    // reduced-motion intent.
    video.removeAttribute("data-bd-deferred-autoplay");
    video.pause();
    centerBtn.innerHTML = ICON_PLAY;
    centerBtn.setAttribute("aria-label", "Play");
    centerBtn.setAttribute("data-tooltip", "Play");
    syncCursor();
  }

  //
  // -- Intro wipe sync --
  //
  // Defer autoplay until the intro curtain (bd-intro.js) is gone, so the
  // video appears to start in sync with the reveal. No-op when bd-intro
  // isn't running — i.e. any page without an intro, or Barba return to home
  // where body.is-intro-loading is absent.

  if (video.autoplay && document.body.classList.contains("is-intro-loading")) {
    video.pause();
    try { video.currentTime = 0; } catch (e) {}

    var introWatchdog = setTimeout(function fallback() {
      video.play().catch(function () {});
      syncPausedState();
    }, 4000);

    document.addEventListener("bd:intro-complete", function startWithReveal() {
      clearTimeout(introWatchdog);
      video.play().catch(function () {});
      syncPausedState();
    }, { once: true });
  }

  //
  // -- Barba transition sync --
  //
  // Symmetric to the intro-sync block above. The beforeEnter hook in
  // studio-barba.js stripped `autoplay` and marked the element so the browser
  // can't play mid-transition. bd:after-nav (legacy alias studio:after-nav) is
  // dispatched in afterEnter right after initBdVideo runs, i.e. once the GSAP
  // transition timeline has completed — the exact "transition finished" beat
  // that the page animations also key off.

  if (video.hasAttribute("data-bd-deferred-autoplay")) {
    var transitionWatchdog = setTimeout(function fallback() {
      video.removeAttribute("data-bd-deferred-autoplay");
      video.play().catch(function () {});
      syncPausedState();
    }, 4000);

    // bd:after-nav is the canonical name; studio:after-nav stays bound as a
    // legacy alias. The handler unbinds both, so a router that dispatches both
    // (or dispatches twice) can't double-play — hence explicit removal rather
    // than two independent { once: true } registrations.
    function playOnTransitionComplete() {
      clearTimeout(transitionWatchdog);
      document.removeEventListener("bd:after-nav", playOnTransitionComplete);
      document.removeEventListener("studio:after-nav", playOnTransitionComplete);
      video.removeAttribute("data-bd-deferred-autoplay");
      video.play().catch(function () {});
      syncPausedState();
    }

    document.addEventListener("bd:after-nav", playOnTransitionComplete);
    document.addEventListener("studio:after-nav", playOnTransitionComplete);
  }

  //
  // -- Viewport auto-pause (config: pauseOffscreen) --
  //
  // Spare the browser when the player scrolls fully out of view. This is a "soft" pause:
  // it stops the media but deliberately leaves all chrome (center button, is-paused,
  // is-preview, cues) untouched, so the UI keeps representing the pre-scroll state and
  // reconciles the instant the player returns. Resume fires ONLY for a video WE paused
  // (resumeOnReenter, cleared on any user toggle), so it never overrides a deliberate
  // pause and the initial intersect is a no-op — leaving the deferred-autoplay / intro
  // blocks above as the sole owners of the first play(). Skipped under reduced motion,
  // where the video never autoplays so there is nothing to pause or resume.

  if (
    config.pauseOffscreen &&
    "IntersectionObserver" in window &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    var offscreenObserver = new IntersectionObserver(function handleViewport(entries) {
      var entry = entries[entries.length - 1];
      if (!entry) return;
      if (entry.isIntersecting) {
        if (resumeOnReenter) {
          resumeOnReenter = false;
          video.play().catch(function () {});
        }
      } else if (!video.paused) {
        resumeOnReenter = true;
        video.pause();
      }
    }, { threshold: 0 });

    instanceObservers.push(offscreenObserver);

    // Defer observe() one frame so a post-Barba stage transform + scrollTo has settled
    // before the first (async) callback measures intersection. Bail if a fast nav-away
    // already disconnected us (cleanupBdVideo removed this observer from the registry).
    requestAnimationFrame(function startObserving() {
      if (instanceObservers.indexOf(offscreenObserver) === -1) return;
      offscreenObserver.observe(video);
    });
  }

  syncPausedState();

  //
  // -- Global keyboard shortcuts --
  //

  root.addEventListener("keydown", function handlePlayerKeys(e) {
    // Don't capture if the scrubber has focus (it has its own handler)
    if (scrubber && e.target === scrubber) return;

    var handled = true;
    switch (e.key) {
      case " ":
      case "k":
        togglePlay();
        break;
      case "m":
        if (config.mute && muteBtn) muteBtn.click();
        break;
      case "f":
        if (config.fullscreen && fsBtn) fsBtn.click();
        break;
      case "ArrowLeft":
        video.currentTime = Math.max(0, video.currentTime - SEEK_STEP);
        break;
      case "ArrowRight":
        video.currentTime = Math.min(video.duration || 0, video.currentTime + SEEK_STEP);
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      showControls();
    }
  });

  //
  // -- Sound --
  //
  // Video audio is deliberately INDEPENDENT of the site's UI-sound toggle (studio.js): the player
  // has its own mute / volume controls, so it does NOT follow the sidebar sound switch. (Earlier the
  // sidebar toggle muted every video via a studio:sound-changed listener here — that coupling was
  // removed so turning UI sounds on/off never touches a video's audio.)

  //
  // -- Controls auto-hide — start on init --
  //

  root.addEventListener("mousemove", function handleMouseMove() { showControls(); });
  root.addEventListener("touchstart", function handleTouchStart() { showControls(); }, { passive: true });
  showControls();
}

//
//------- Init -------//
//

function initBdVideo(scope) {
  var root = scope || document;
  var players = root.querySelectorAll(".bd-video-player");
  if (players.length === 0) return;
  // Re-read the page config on every init, so a client-side app can change it
  // between navigations.
  moduleConfig = resolveConfig();
  // Inject the icon sprite into <body> so the players' <use> refs resolve.
  // Idempotent — no-op if already present.
  ensureBdVideoSprite();
  players.forEach(initPlayerInstance);
}

// Expose for studio-barba.js to call after each navigation
window.initBdVideo = initBdVideo;

// Disconnect every live viewport observer before a Barba nav-away, so they don't fire
// against a detaching container or accumulate across navigations. Called from the Barba
// `before` hook in studio-barba.js, beside cleanupThumbHover(). Idempotent.
// Invariant: this disconnects ALL instances, relying on every pause-offscreen player
// living inside the swapped Barba container (so it's torn down and re-created together).
// The only consumer today (home hero) is inside page-wrapper, which Barba swaps. If a
// pause-offscreen player is ever placed in persistent chrome, it would lose its observer
// here and never get a new one (initBdVideo only runs on the entering container) — at
// that point, scope teardown to detached instances instead.
function cleanupBdVideo() {
  for (var i = 0; i < instanceObservers.length; i++) {
    instanceObservers[i].disconnect();
  }
  instanceObservers.length = 0;
  for (var j = 0; j < instanceListeners.length; j++) {
    var L = instanceListeners[j];
    L.target.removeEventListener(L.type, L.handler, L.opts);
  }
  instanceListeners.length = 0;
}
window.cleanupBdVideo = cleanupBdVideo;

// Wait for DOM before initializing
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBdVideo);
} else {
  initBdVideo();
}

})();
