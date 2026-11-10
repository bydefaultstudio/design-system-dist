/**
 * glossary-init.js - starts the glossary reading drawer on docs-kit sites
 *
 * glossary.js exports window.initGlossary and starts nothing itself: on the
 * By Default OS site, bd-site-init.js calls it. A docs-kit site has no
 * bd-site-init.js, so the generator ships this file beside glossary.js
 * whenever cms/glossary/ exists (unless the site sets glossaryDrawer: false
 * and wires its own) and loads it straight after.
 *
 * It calls initGlossary on a hard load and again after every page transition
 * (bd:after-nav, dispatched by the kit's barba-docs.js after each swap), with
 * the arriving container. initGlossary binds its listeners afresh on every
 * call, so a second call that would find the same glossary list as the last
 * one (a duplicate bd:after-nav) is skipped. A
 * page without the list is always passed through, which is how glossary.js
 * removes its drawer when a reader navigates away.
 *
 * @version 1.0.0
 * @author By Default
 */

(function () {
  'use strict';

  var VERSION = '1.0.0';
  var lastRoot;

  function startGlossary(container) {
    if (typeof window.initGlossary !== 'function') return;

    var root = (container || document).querySelector('[data-glossary-terms]');
    if (root && root === lastRoot) return;

    lastRoot = root;
    window.initGlossary(container);
  }

  function onReady() {
    startGlossary();
  }

  function onAfterNav(event) {
    startGlossary(event.detail && event.detail.container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  document.addEventListener('bd:after-nav', onAfterNav);

  console.log('glossary-init.js v' + VERSION + ' loaded');
})();
