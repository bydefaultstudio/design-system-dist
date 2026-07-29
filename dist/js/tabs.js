/* @bydefaultstudio/design-system v2.1.0 */
/**
 * Tabs component
 * Initialises all .tabs[role="tablist"] on the page.
 * Supports click activation and arrow key navigation.
 *
 * @version 1.0.0
 */
(function () {
  function initTabs() {
    document.querySelectorAll('[role="tablist"]').forEach(function (tablist) {
      var tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          activateTab(tabs, tab);
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

    console.log('[tabs] v1.0.0 — init');
  }

  function activateTab(tabs, activeTab) {
    tabs.forEach(function (t) {
      t.classList.remove('is-active');
      t.setAttribute('aria-selected', 'false');
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.classList.add('is-hidden');
    });

    activeTab.classList.add('is-active');
    activeTab.setAttribute('aria-selected', 'true');
    var activePanel = document.getElementById(activeTab.getAttribute('aria-controls'));
    if (activePanel) activePanel.classList.remove('is-hidden');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabs);
  } else {
    initTabs();
  }
})();
