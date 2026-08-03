/* @bydefaultstudio/design-system v2.2.1 */
/**
 * BD Audio — UI sound-feedback engine
 * Plays short micro-sounds (click / hover / success / error / bump) as
 * interaction feedback. Headless: it owns no toggle UI, and it never looks
 * up a site global by name — the mute switch arrives as an injected
 * predicate via config.
 *
 * Configure through window.bdAudioConfig, defined BEFORE this script loads.
 * Every key is optional; the defaults reproduce the original Studio build:
 *
 *   window.bdAudioConfig = {
 *     basePath: "/assets/audio/",
 *     // Replaces the default registry WHOLESALE — list only the sounds the
 *     // site ships. A file starting with "/" ignores basePath.
 *     sounds: {
 *       success: { file: "success.mp3", volume: 0.08 },
 *       error:   { file: "error.mp3",   volume: 0.14 }
 *     },
 *     masterVolume: 1,
 *     // Injected mute predicate; return true to silence. null = never
 *     // muted (standalone pages, the tuning playground).
 *     isMuted: function () { return window.mySiteIsSoundOff(); },
 *     // The gate covers the delegated data-bd-audio triggers only; set
 *     // gateProgrammatic to also gate window.bdAudio.playSound() calls.
 *     gateProgrammatic: false,
 *     attributeApi: true,
 *     hoverDebounceDelay: 120
 *   };
 *
 * Usage — attribute API:
 *   <button data-bd-audio="click">…</button>       plays on click
 *   <a data-bd-audio="hover">…</a>                  plays on mouseenter (throttled)
 *   <button data-bd-audio="click hover">…</button>  both
 * Programmatic (form results etc.):
 *   window.bdAudio.playSound('success' | 'error' | 'bump')
 *
 * Notes:
 *   - Audio elements are created lazily on first play, so registered-but-
 *     never-played sounds cost no network requests.
 *   - No dependencies. Listeners are delegated on document, so triggers
 *     stamped after load (CMS render, Barba container swaps) just work.
 *
 * @version 4.0.0
 */
(function () {
  "use strict";

  var VERSION = "4.0.0";

  var DEFAULT_SOUNDS = {
    // Per-sound base volumes (0–1). Deliberately quiet — UI feedback should
    // sit under content. Tuned in the bd-audio playground; adjust there and
    // bake the chosen values back here.
    click: { file: "click.mp3", volume: 0.05 },
    hover: { file: "hover.mp3", volume: 0.01 },
    success: { file: "success.mp3", volume: 0.08 },
    error: { file: "error.mp3", volume: 0.14 },
    bump: { file: "bump.mp3", volume: 0.09 }
  };

  var DEFAULTS = {
    basePath: "/assets/audio/",
    sounds: DEFAULT_SOUNDS,
    masterVolume: 1,
    isMuted: null,
    gateProgrammatic: false,
    attributeApi: true,
    hoverDebounceDelay: 120
  };

  function resolveConfig() {
    var user = window.bdAudioConfig || {};
    var config = {};
    for (var key in DEFAULTS) {
      config[key] = Object.prototype.hasOwnProperty.call(user, key)
        ? user[key]
        : DEFAULTS[key];
    }
    return config;
  }

  class AudioSystem {
    constructor(config) {
      this.config = config;
      this.audioCache = new Map();
      this.lastHoverTime = 0;
      this.masterVolume = config.masterVolume;
      if (config.attributeApi) this.setupEventListeners();
    }

    // The injected predicate is read at PLAY time, never captured at init —
    // load order between this module and the site's sound switch must stay
    // irrelevant.
    isMutedNow() {
      return typeof this.config.isMuted === "function" && this.config.isMuted() === true;
    }

    soundSrc(name) {
      var entry = this.config.sounds[name];
      if (!entry || !entry.file) return null;
      return entry.file.charAt(0) === "/" ? entry.file : this.config.basePath + entry.file;
    }

    setupEventListeners() {
      var self = this;
      // Click — delegated on document so it survives container swaps.
      // data-bd-audio is a space-separated list, so ~="click" matches
      // "click" and "click hover".
      document.addEventListener("click", function (e) {
        if (!e.target || e.target.nodeType !== Node.ELEMENT_NODE) return;
        var el = e.target.closest('[data-bd-audio~="click"]');
        if (el && !self.isMutedNow()) self.playSound("click");
      });

      // Hover — capture phase because mouseenter doesn't bubble. Sparing by
      // design: throttled, and only when entering the element that actually
      // carries the attribute (not a descendant).
      document.addEventListener("mouseenter", function (e) {
        if (!e.target || e.target.nodeType !== Node.ELEMENT_NODE) return;
        var el = e.target.closest('[data-bd-audio~="hover"]');
        if (!el || e.target !== el) return;
        var now = (window.performance && performance.now) ? performance.now() : 0;
        if (now && now - self.lastHoverTime < self.config.hoverDebounceDelay) return;
        if (!self.isMutedNow()) {
          self.lastHoverTime = now;
          self.playSound("hover");
        }
      }, true);
    }

    // Play a sound by name. The mute gate covers the delegated attribute
    // triggers; programmatic calls play regardless unless the site opts in
    // with gateProgrammatic — flipping that default would silently mute
    // form feedback on sites that gate at the call site instead.
    async playSound(sound) {
      if (this.config.gateProgrammatic && this.isMutedNow()) return;
      var src = this.soundSrc(sound);
      if (!src) return;
      try {
        var audio = this.getAudio(src);
        if (!audio) return;
        audio.currentTime = 0;
        var entry = this.config.sounds[sound];
        var base = entry.volume != null ? entry.volume : 0.2;
        audio.volume = Math.max(0, Math.min(1, base * this.masterVolume));
        await audio.play();
      } catch (error) {
        // Browser autoplay policy can reject before the first user gesture,
        // and rapid re-plays abort the previous one — both are harmless.
      }
    }

    // One cached HTMLAudioElement per source, created lazily on first play.
    getAudio(src) {
      if (this.audioCache.has(src)) return this.audioCache.get(src);
      var audio = new Audio(src);
      audio.preload = "auto";
      this.audioCache.set(src, audio);
      return audio;
    }

    // Tuning API — used by the bd-audio playground configurator.
    setMasterVolume(volume) {
      this.masterVolume = Math.max(0, Math.min(1, Number(volume)));
    }

    setSoundVolume(sound, volume) {
      var entry = this.config.sounds[sound];
      if (entry) entry.volume = Math.max(0, Math.min(1, Number(volume)));
    }

    getAllSoundVolumes() {
      var out = {};
      for (var name in this.config.sounds) out[name] = this.config.sounds[name].volume;
      return out;
    }
  }

  // Singleton: the engine attaches its document-level listeners exactly
  // once, no matter how often page scripts re-run.
  function initBdAudio() {
    if (window.bdAudio) return;
    window.bdAudio = new AudioSystem(resolveConfig());
    console.log("[bd-audio] v" + VERSION + " — init");
  }

  window.initBdAudio = initBdAudio;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBdAudio);
  } else {
    initBdAudio();
  }

  // Export for module usage / tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = AudioSystem;
  }
})();
