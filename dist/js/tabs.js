/* @bydefaultstudio/design-system v4.0.0 */
/**
 * Tabs component
 * Initialises all .tabs[role="tablist"] on the page.
 * Supports click activation and arrow key navigation.
 *
 * @version 1.1.0
 */
(function () {
  function initTabs(scope) {
    var root = scope || document;
    var bound = 0;

    root.querySelectorAll('[role="tablist"]').forEach(function (tablist) {
      if (tablist.dataset.tabsBound) return;
      tablist.dataset.tabsBound = 'true';
      bound++;

      var tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          activateTab(tabs, tab, tablist);
        });

        tab.addEventListener('keydown', function (e) {
          var idx = tabs.indexOf(tab);

          if (e.key === 'ArrowRight') {
            e.preventDefault();
            tabs[(idx + 1) % tabs.length].focus();
          }

          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            tabs[(idx - 1 + tabs.length) % tabs.length].focus();
          }

          if (e.key === 'Home') {
            e.preventDefault();
            tabs[0].focus();
          }

          if (e.key === 'End') {
            e.preventDefault();
            tabs[tabs.length - 1].focus();
          }
        });
      });
    });

    if (bound) console.log('[tabs] v1.1.0 — init (' + bound + ')');
  }

  // Panel ids are only unique within a page, and during a transition the
  // outgoing container is still in the document — website/tabs.html and
  // website/accordion.html both use demo-panel-1..3. Resolve within the tablist's
  // own container so a click mid-swap cannot toggle the leaving page's panel.
  function panelFor(tab, tablist) {
    var scope = tablist.closest('[data-barba="container"]') || document;
    return scope.querySelector('#' + CSS.escape(tab.getAttribute('aria-controls')));
  }

  function activateTab(tabs, activeTab, tablist) {
    tabs.forEach(function (t) {
      t.classList.remove('is-active');
      t.setAttribute('aria-selected', 'false');
      var panel = panelFor(t, tablist);
      if (panel) panel.classList.add('is-hidden');
    });

    activeTab.classList.add('is-active');
    activeTab.setAttribute('aria-selected', 'true');
    var activePanel = panelFor(activeTab, tablist);
    if (activePanel) activePanel.classList.remove('is-hidden');
  }

  // Exposed for parity with the other components; the after-nav listener below
  // is the caller that matters.
  window.initTabs = initTabs;

  //
  //------- Initialize -------//
  //
  // Registered twice: once for the initial load, once for Barba's after-nav
  // event. DOMContentLoaded never re-fires after a container swap, so without
  // the second listener every tablist goes inert on the first navigation.
  // See cms/js-code-structure.md.
  //
  // Both fire on a hard load — Barba's once() runs the global afterEnter hook
  // even with no transition registered — so initTabs runs twice before any
  // navigation happens. The dataset guard is what makes that harmless, on every
  // page view rather than only after a swap.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initTabs(); });
  } else {
    initTabs();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initTabs(event.detail && event.detail.container);
  });
})();
