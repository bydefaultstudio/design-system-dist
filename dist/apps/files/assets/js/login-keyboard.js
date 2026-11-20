/**
 * login-keyboard.js — keeps the sign-in field above a phone's keyboard
 *
 * On a phone the sign-in page is one screen tall: the header, the
 * background band and the form fit with nothing to scroll. When a field
 * gains focus, the on-screen keyboard covers the bottom of the screen, and
 * iPhone Safari's own scroll-into-view often has no room to move on the
 * first focus, so the email field stays behind the keyboard (found
 * 2026-11-20 on an iPhone; later focuses worked once the address bar had
 * resized).
 *
 * The fix, on touch screens only:
 * - while a field in the strip has focus, the page gains bottom padding the
 *   height of the keyboard (--login-keyboard on .login-page), so there is
 *   always room to scroll;
 * - on focus, when the keyboard resizes, and when an error line appears, a
 *   field's group (label, input and error line) that sits under the
 *   keyboard is scrolled up until it clears it, with --space-l of room,
 *   but never so far that the label goes under the header (a phone in
 *   landscape has little height left). It does not follow the reader's own
 *   panning, so VoiceOver and touch scrolling are never pulled back;
 * - the padding goes only once the keyboard has closed, not when focus
 *   leaves, so the page never jumps while the keyboard slides away.
 *
 * Android Chrome shrinks the layout viewport with the keyboard, so the
 * measured keyboard is about 0 there and the script does nothing; Chrome
 * scrolls the field itself. That is intended. A pinch-zoomed page is left
 * alone too: the reader is placing the screen themselves.
 *
 * It reads only the visual viewport and the focused field. It never moves
 * focus, never changes the form, and never runs on a desktop pointer.
 * auth-login.js is untouched.
 *
 * A bare page: no page transitions, so DOMContentLoaded is the whole
 * lifecycle and nothing re-initialises.
 *
 * @version 1.0.0
 * @author By Default
 */
(function () {
  'use strict';

  console.log('login-keyboard.js v1.0.0 loaded');

  //
  //------- Configuration -------//
  //

  const FIELD_SELECTOR = '.login-strip input, .login-strip textarea';
  // Below this many pixels of covered screen, the keyboard counts as closed
  // (an iPhone's shortcut bar alone is about 50px).
  const KEYBOARD_THRESHOLD = 100;

  //
  //------- Keyboard -------//
  //

  function createKeyboardWatch(page, viewport) {
    let field = null;
    let frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // The covered part of the screen: the layout viewport minus what the
    // visual viewport still shows.
    function keyboardHeight() {
      return Math.max(0, Math.round(window.innerHeight - viewport.height));
    }

    // --space-l in pixels. The token is written in rem, so it is resolved
    // against the root font size rather than read as a bare number.
    function clearance() {
      const raw = getComputedStyle(page).getPropertyValue('--space-l').trim();
      const value = parseFloat(raw);
      if (!Number.isFinite(value)) return 0;
      if (raw.endsWith('rem')) return value * parseFloat(getComputedStyle(document.documentElement).fontSize);
      return value;
    }

    function setRoom(height) {
      if (height >= KEYBOARD_THRESHOLD) {
        page.style.setProperty('--login-keyboard', height + 'px');
      } else {
        page.style.removeProperty('--login-keyboard');
      }
    }

    // Scrolls the window by exactly what the field needs to clear the top
    // of the keyboard. The field's box is measured against the layout
    // viewport; the visible part of it starts at viewport.offsetTop.
    // The bottom of the sticky header, or the top of the visible area when
    // the header scrolls away (from 960px up it is not sticky).
    function visibleTop() {
      const header = document.querySelector('.site-header');
      const top = viewport.offsetTop;
      if (!header || getComputedStyle(header).position !== 'sticky') return top;
      return Math.max(top, header.getBoundingClientRect().bottom);
    }

    function revealField() {
      frame = 0;
      if (viewport.scale > 1.01) return;
      const height = keyboardHeight();
      // Room is added while a field has focus and taken away only once the
      // keyboard has gone, which a resize always reports.
      if (height < KEYBOARD_THRESHOLD) setRoom(0);
      else if (field) setRoom(height);
      if (!field || height < KEYBOARD_THRESHOLD) return;
      // The whole group, so an error line under the input is seen too
      const box = (field.closest('.form-group') || field).getBoundingClientRect();
      const visibleBottom = viewport.offsetTop + viewport.height;
      const overlap = box.bottom + clearance() - visibleBottom;
      const headroom = box.top - (visibleTop() + clearance());
      const distance = Math.min(overlap, headroom);
      if (distance > 0) {
        window.scrollBy({ top: distance, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      }
    }

    function scheduleReveal() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(revealField);
    }

    function handleFocusIn(event) {
      if (!event.target.matches(FIELD_SELECTOR)) return;
      field = event.target;
      scheduleReveal();
    }

    function handleFocusOut(event) {
      if (event.target === field) field = null;
      scheduleReveal();
    }

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    viewport.addEventListener('resize', scheduleReveal);

    // auth-login.js writes errors into the .form-error lines and refocuses
    // a field that already has focus, which fires no focusin.
    const errors = new MutationObserver(scheduleReveal);
    page.querySelectorAll('.login-strip .form-error').forEach(function observeError(line) {
      errors.observe(line, { childList: true, characterData: true, subtree: true });
    });
  }

  //
  //------- Initialize -------//
  //

  function initLoginKeyboard() {
    const page = document.querySelector('.login-page');
    if (!page || !window.visualViewport) return;
    // An on-screen keyboard comes with a touch screen; a desktop pointer
    // never needs this.
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    createKeyboardWatch(page, window.visualViewport);
    console.log('login-keyboard.js initialised');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginKeyboard);
  } else {
    initLoginKeyboard();
  }
})();
