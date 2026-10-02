/* @bydefaultstudio/design-system v6.0.1 */
/**
 * Accordion component
 * Initialises all .accordion containers on the page.
 * Supports single-open and multi-open modes via data-accordion attribute.
 *
 * Usage:
 *   <div class="accordion" data-accordion="single|multi">
 *     <div class="accordion-item">
 *       <button class="accordion-header" aria-expanded="false" aria-controls="panel-id">
 *         <span class="accordion-title">Heading</span>
 *         <div class="svg-icn"><svg data-icon="add" aria-hidden="true">…</svg></div>
 *       </button>
 *       <div class="accordion-content" id="panel-id" role="region">
 *         <div class="accordion-inner">
 *           <div class="accordion-body">Content</div>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Modes:
 *   data-accordion="single" — opening one item closes siblings
 *   data-accordion="multi"  — each item toggles independently (default)
 *
 * Keyboard:
 *   ArrowDown — focus next header (wraps)
 *   ArrowUp   — focus previous header (wraps)
 *   Home      — focus first header
 *   End       — focus last header
 *   Enter/Space — toggle panel (native button behaviour)
 *
 * @version 1.4.0
 */
(function () {
  // One item's state, in all three places it lives: the class the CSS
  // animates on, the header's aria-expanded, and whether the content can be
  // reached. A closed panel collapses to a zero-height row but its controls
  // stay in the DOM, so without `inert` Tab walks into fields nobody can
  // see (WCAG 2.4.3, 2.4.7). inert rather than CSS visibility: a nested
  // accordion's open panel would set visibility back to visible inside a
  // closed outer one, and inert on the outer content holds for everything
  // under it. It also leaves the visuals alone, so the close still animates.
  function setOpen(item, open) {
    var trigger = item.querySelector(".accordion-header");
    var content = item.querySelector(":scope > .accordion-content");
    item.classList.toggle("is-open", open);
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (content) content.inert = !open;
  }

  function initAccordion(scopeOrEl) {
    var root = scopeOrEl || document;
    var bound = 0;

    // Accepts a scope to search, or the .accordion itself — see tabs.js. The
    // node handed in JOINS the set rather than replacing it, which matters
    // most here: nested accordions are a documented pattern, and an inner one
    // would go inert if handing in the outer replaced the search. The
    // per-header guard makes the overlap a no-op, and `:scope > .accordion-item`
    // below keeps each level's items to itself.
    var accordions = root.querySelectorAll(".accordion");
    if (root.matches && root.matches(".accordion")) {
      accordions = [root].concat(Array.from(accordions));
    }

    accordions.forEach(function (accordion) {
      var mode = accordion.getAttribute("data-accordion") || "multi";
      var items = Array.from(accordion.querySelectorAll(":scope > .accordion-item"));

      var headers = items
        .map(function (i) { return i.querySelector(".accordion-header"); })
        .filter(Boolean);

      items.forEach(function (item) {
        var trigger = item.querySelector(".accordion-header");
        if (!trigger || trigger.dataset.accordionBound) return;
        trigger.dataset.accordionBound = "true";
        bound++;

        // The markup's own state, so a panel authored open (.is-open) or
        // closed starts with its content in or out of reach to match.
        setOpen(item, item.classList.contains("is-open"));

        trigger.addEventListener("click", function () {
          var wasOpen = item.classList.contains("is-open");

          if (mode === "single") {
            items.forEach(function (other) { setOpen(other, false); });
          }

          setOpen(item, !wasOpen);
        });

        trigger.addEventListener("keydown", function (e) {
          var idx = headers.indexOf(trigger);
          var next;

          switch (e.key) {
            case "ArrowDown":
              e.preventDefault();
              next = headers[(idx + 1) % headers.length];
              break;
            case "ArrowUp":
              e.preventDefault();
              next = headers[(idx - 1 + headers.length) % headers.length];
              break;
            case "Home":
              e.preventDefault();
              next = headers[0];
              break;
            case "End":
              e.preventDefault();
              next = headers[headers.length - 1];
              break;
          }

          if (next) next.focus();
        });
      });
    });

    // Only when something was actually wired. This runs on every arrival and on
    // hard load, and most pages have no accordion at all.
    if (bound) console.log("[accordion] v1.4.0 — init (" + bound + ")");
  }

  // Exposed for parity with the other components; the after-nav listener below
  // is the caller that matters.
  window.initAccordion = initAccordion;

  //
  //------- Initialize -------//
  //
  // Registered twice: once for the initial load, once for Barba's after-nav
  // event. DOMContentLoaded never re-fires after a container swap, so without
  // the second listener every accordion goes inert on the first navigation.
  // See cms/js-code-structure.md.
  //
  // Both fire on a hard load — Barba's once() runs the global afterEnter hook
  // even with no transition registered — so initAccordion runs twice before any
  // navigation happens. The dataset guard is what makes that harmless, on every
  // page view rather than only after a swap.

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { initAccordion(); });
  } else {
    initAccordion();
  }

  document.addEventListener("bd:after-nav", function (event) {
    initAccordion(event.detail && event.detail.container);
  });
})();
