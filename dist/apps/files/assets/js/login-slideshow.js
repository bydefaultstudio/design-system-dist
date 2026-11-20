/**
 * login-slideshow.js — the sign-in page's slideshow background
 *
 * Drives the slides the build draws from signIn.slides (docs.config.js,
 * cms/generator/sign-in.js) on /auth/login.html. On every site's sign-in
 * page; with no [data-login-slideshow] on the page it does nothing.
 *
 * The clock is the active progress bar's own CSS animation, which runs for
 * --login-slide-duration: its animationend moves to the next slide, and
 * pausing pauses the animation (animation-play-state), so the bar and the
 * slide can never drift apart and there is no timer to clear.
 *
 * - Autoplay is off under prefers-reduced-motion: the first slide sits still
 *   and the button offers Play. Pressing it is the reader's own choice.
 * - The button is the one thing a screen reader meets (WCAG 2.2.2); the
 *   slides, the caption and the bars are aria-hidden decoration.
 * - Videos are muted, inline and silent decoration: only the active one
 *   plays, and only while the slideshow does.
 * - The caption panel sits on the image on a wide screen, in the dark
 *   theme so it reads on any picture. On a phone only its controls show,
 *   as a row on the page in the page's theme. The panel draws only once
 *   this script has set it up, so neither theme flashes before it.
 * - A bar that ends almost at once (a stylesheet that cuts animations to
 *   nothing, a theme that sets the duration to 0) is ignored, so the show
 *   stands still rather than flashing through its slides.
 *
 * A bare page: no page transitions, so DOMContentLoaded is the whole
 * lifecycle and nothing re-initialises.
 *
 * @version 1.0.0
 * @author By Default
 */
(function () {
  'use strict';

  console.log('login-slideshow.js v1.0.0 loaded');

  //
  //------- Configuration -------//
  //

  // The width at which the sign-in page splits into background and strip
  // (docs-site.css, Login Page); the caption sits on the image from here up
  const WIDE_QUERY = '(min-width: 960px)';
  const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
  // The shortest run that counts as a slide's time, in seconds: anything
  // quicker was cut short by a stylesheet, not timed (WCAG 2.3.1)
  const MIN_SLIDE_SECONDS = 1;
  const LABEL_PAUSE = 'Pause slideshow';
  const LABEL_PLAY = 'Play slideshow';

  //
  //------- Utility Functions -------//
  //

  // Restarts a bar's fill animation from zero: drop the class, force a
  // style recalculation, put it back
  function restartBar(bar) {
    bar.classList.remove('is-active');
    void bar.offsetWidth;
    bar.classList.add('is-active');
  }

  // Safari before 14 has addListener only
  function listenToQuery(query, handler) {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handler);
    else if (typeof query.addListener === 'function') query.addListener(handler);
  }

  // A play() refused by the browser (power saving, a policy) leaves the
  // poster showing, which is all decoration needs
  function playVideo(video) {
    const result = video.play();
    if (result && typeof result.catch === 'function') result.catch(function ignoreRefusal() {});
  }

  //
  //------- Main Functions -------//
  //

  function createSlideshow(root) {
    const slides = Array.from(root.querySelectorAll('.login-slide'));
    const bars = Array.from(root.querySelectorAll('.login-slideshow-bar'));
    const panel = root.querySelector('.login-slideshow-panel');
    const toggle = root.querySelector('.login-slideshow-toggle');
    const title = root.querySelector('.login-slideshow-title');
    const text = root.querySelector('.login-slideshow-text');
    const wide = window.matchMedia(WIDE_QUERY);
    const reduced = window.matchMedia(REDUCED_QUERY);
    const state = {
      index: 0,
      playing: !reduced.matches
    };

    function activeVideo() {
      const slide = slides[state.index];
      return slide ? slide.querySelector('video') : null;
    }

    function syncVideos() {
      slides.forEach(function pauseOthers(slide, i) {
        const video = slide.querySelector('video');
        if (video && i !== state.index) video.pause();
      });
      const video = activeVideo();
      if (!video) return;
      if (state.playing) playVideo(video);
      else video.pause();
    }

    function syncCaption() {
      const slide = slides[state.index];
      if (title) title.textContent = slide.getAttribute('data-title') || '';
      if (text) text.textContent = slide.getAttribute('data-text') || '';
    }

    function syncBars() {
      bars.forEach(function markBar(bar, i) {
        bar.classList.toggle('is-done', i < state.index);
        if (i === state.index) restartBar(bar);
        else bar.classList.remove('is-active');
      });
    }

    function syncToggle() {
      root.classList.toggle('is-paused', !state.playing);
      if (toggle) toggle.setAttribute('aria-label', state.playing ? LABEL_PAUSE : LABEL_PLAY);
    }

    function showSlide(index) {
      const previous = activeVideo();
      state.index = (index + slides.length) % slides.length;
      slides.forEach(function markSlide(slide, i) {
        slide.classList.toggle('is-active', i === state.index);
      });
      // The next video starts from its first frame, not where it last stopped
      const next = activeVideo();
      if (next && next !== previous) next.currentTime = 0;
      syncCaption();
      syncBars();
      syncVideos();
    }

    function handleBarEnd(event) {
      if (!state.playing || event.target !== bars[state.index]) return;
      // Cut short: stand still, and say so, so the button reads Play and a
      // looping video stops with the slides
      if (event.elapsedTime < MIN_SLIDE_SECONDS) {
        state.playing = false;
        syncToggle();
        syncVideos();
        return;
      }
      showSlide(state.index + 1);
    }

    // Reduced motion switched on mid-visit stops the show; switched off,
    // it stays as the reader left it
    function handleReducedChange() {
      if (!reduced.matches || !state.playing) return;
      state.playing = false;
      syncToggle();
      syncVideos();
    }

    function handleToggle() {
      state.playing = !state.playing;
      syncToggle();
      syncVideos();
    }

    function syncPanelTheme() {
      if (!panel) return;
      if (wide.matches) panel.setAttribute('data-theme', 'dark');
      else panel.removeAttribute('data-theme');
    }

    bars.forEach(function listenToBar(bar) {
      bar.addEventListener('animationend', handleBarEnd);
    });
    if (toggle) toggle.addEventListener('click', handleToggle);
    listenToQuery(wide, syncPanelTheme);
    listenToQuery(reduced, handleReducedChange);

    syncPanelTheme();
    syncToggle();
    showSlide(0);
    root.classList.add('is-ready');
  }

  //
  //------- Initialize -------//
  //

  function initLoginSlideshow() {
    const roots = document.querySelectorAll('[data-login-slideshow]');
    roots.forEach(function startSlideshow(root) {
      if (root.classList.contains('is-ready')) return;
      if (!root.querySelector('.login-slide')) return;
      createSlideshow(root);
    });
    if (roots.length) console.log('login-slideshow.js initialised');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginSlideshow);
  } else {
    initLoginSlideshow();
  }
})();
