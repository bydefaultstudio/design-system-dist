/* @bydefaultstudio/design-system v4.6.0 */
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
 * @version 1.2.0
 */
(function () {
  function initAccordion(scope) {
    var root = scope || document;
    var bound = 0;

    root.querySelectorAll(".accordion").forEach(function (accordion) {
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

        trigger.addEventListener("click", function () {
          var wasOpen = item.classList.contains("is-open");

          if (mode === "single") {
            items.forEach(function (other) {
              other.classList.remove("is-open");
              var t = other.querySelector(".accordion-header");
              if (t) t.setAttribute("aria-expanded", "false");
            });
          }

          if (!wasOpen) {
            item.classList.add("is-open");
            trigger.setAttribute("aria-expanded", "true");
          } else {
            item.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
          }
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
    if (bound) console.log("[accordion] v1.2.0 — init (" + bound + ")");
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
