/* @bydefaultstudio/design-system v2.2.1 */
/**
 * Dialog + Drawer component
 * Opens and closes native <dialog> elements declaratively.
 *
 * One module serves both components because they are the same machinery: a
 * modal <dialog> opened with showModal(), with native Escape and native focus
 * trapping. A drawer is that dialog docked to an edge (see design-system.css
 * section 30). Splitting them would duplicate the backdrop latch, the close
 * guard and the router teardown for no gain.
 *
 * Usage — dialog:
 *   <button class="button" type="button" data-dialog-open="my-dialog">Open</button>
 *
 *   <dialog id="my-dialog" class="dialog" aria-labelledby="my-dialog-title">
 *     <div class="dialog-header">
 *       <h2 class="dialog-title" id="my-dialog-title">Title</h2>
 *       <button class="button close-btn" type="button" data-icon-only
 *               data-size="small" data-dialog-close aria-label="Close">…</button>
 *     </div>
 *     <div class="dialog-body">…</div>
 *     <div class="dialog-footer">
 *       <button class="button" type="button" autofocus>Confirm</button>
 *     </div>
 *   </dialog>
 *
 * Usage — drawer:
 *   <button class="button" type="button" data-drawer-open="nav-drawer">Menu</button>
 *
 *   <dialog id="nav-drawer" class="drawer" data-placement="start"
 *           aria-labelledby="nav-drawer-title">
 *     <div class="drawer-header">
 *       <h2 class="drawer-title" id="nav-drawer-title">Navigation</h2>
 *       <button class="button close-btn" type="button" data-icon-only
 *               data-size="small" data-drawer-close aria-label="Close">…</button>
 *     </div>
 *     <div class="drawer-body">…</div>
 *   </dialog>
 *
 * Put autofocus on the primary action — without it showModal() focuses the
 * first focusable element, which is the header Close button. On a
 * destructive dialog put autofocus on Cancel instead (see cms/dialog.md).
 *
 * Attributes:
 *   data-dialog-open="id"        — on a trigger, opens that dialog
 *   data-drawer-open="id"        — the same, named for drawers
 *   data-dialog-close            — inside a surface, closes it
 *   data-drawer-close            — the same, named for drawers
 *   data-placement="start|end|top|bottom"  — drawer only, CSS-only, default end
 *   data-static                  — opt out of closing on a backdrop press
 *
 * The open/close attribute pairs are deliberate aliases: the JS treats them
 * identically and each component's doc shows only its own name, so nobody has
 * to write data-dialog-open on a drawer.
 *
 * Events:
 *   dialog-hide / drawer-hide — bubbling, CANCELLABLE. Fired before closing,
 *     with detail.source of "close-button" | "backdrop" | "escape".
 *     preventDefault() keeps the surface open and pulses it.
 *
 *     Programmatic .close() is NOT guarded — the native method cannot be
 *     intercepted without patching HTMLDialogElement. Call requestClose via
 *     window.bdRequestClose(el, "programmatic") if you want the guard to run.
 *
 *     Escape has a spec-mandated escape hatch: two close requests in a row
 *     with no interaction between them always close, because the second is
 *     not cancellable. The guard is a safety net, not a lock.
 *
 * Behaviour:
 *   Escape and focus trapping are native to <dialog> + showModal(). The native
 *   Escape close is intercepted so it runs through the same guard as the other
 *   two close paths rather than bypassing it.
 *   Pressing the backdrop closes the surface unless it carries data-static.
 *
 * All listeners are delegated from document, so surfaces injected after load
 * (CMS render, client app, Barba container swap) work without re-init.
 */
(function () {
  "use strict";

  var VERSION = "2.1.0";
  var SURFACE_SELECTOR = "dialog.dialog, dialog.drawer";
  var OPEN_SELECTOR = "[data-dialog-open], [data-drawer-open]";
  var CLOSE_SELECTOR = "[data-dialog-close], [data-drawer-close], .dialog-close";

  /* Outlives the pulse animation so a class left behind by an interrupted
     animation cannot persist. Deliberately not keyed to animationend: on
     .dialog there is no pulse animation to end, and under reduced motion the
     drawer's own animation is replaced by a backdrop one. */
  var PULSE_MS = 400;

  /**
   * Latched on pointerdown, read on click. Without it, a drag that starts on
   * text inside the surface and releases on the backdrop dispatches a click at
   * the common ancestor (the dialog) and discards whatever the user typed.
   */
  var pointerDownOnBackdrop = false;

  function isSurface(node) {
    return node instanceof Element && node.matches(SURFACE_SELECTOR);
  }

  /**
   * True when the point falls outside the surface's border box.
   *
   * The pointerdown latch is what makes this keyboard-safe: Enter/Space
   * activation dispatches a click with no preceding pointerdown, so the
   * latch stays false and this test is never reached. Keyboard clicks
   * report clientX/clientY of 0 — which reads as "outside" for every
   * centred dialog — so do NOT remove the latch and rely on coordinates.
   */
  function isOutsideBox(surface, event) {
    var rect = surface.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }

  /* Presence-means-on, matching data-icon-only and data-full-width. A valued
     opt-out (data-light-dismiss="false") would fail unsafe: any typo in the
     value — "off", "no", an empty string, the bare attribute — would read as
     "not false" and leave light dismiss ENABLED on the very surface someone
     was trying to protect. */
  function allowsLightDismiss(surface) {
    return !surface.hasAttribute("data-static");
  }

  function hideEventName(surface) {
    return surface.classList.contains("drawer") ? "drawer-hide" : "dialog-hide";
  }

  /** Visible acknowledgement that a close was heard and refused. */
  function pulse(surface) {
    surface.classList.remove("is-pulsing");
    // Reading layout between remove and add restarts the animation, so a
    // second blocked close pulses again instead of sitting inert.
    void surface.offsetWidth;
    surface.classList.add("is-pulsing");

    window.clearTimeout(surface.__bdPulseTimer);
    surface.__bdPulseTimer = window.setTimeout(function clearPulse() {
      surface.classList.remove("is-pulsing");
    }, PULSE_MS);
  }

  /**
   * Ask to close. Returns true when the surface actually closed.
   * Every user-driven close path routes through here so the guard and the
   * reported source stay consistent.
   */
  function requestClose(surface, source) {
    if (!isSurface(surface)) return false;

    var allowed = surface.dispatchEvent(
      new CustomEvent(hideEventName(surface), {
        bubbles: true,
        cancelable: true,
        detail: { source: source }
      })
    );

    if (!allowed) {
      pulse(surface);
      return false;
    }

    surface.close();
    return true;
  }

  function openSurface(id) {
    var surface = document.getElementById(id);
    if (!surface || surface.tagName !== "DIALOG") return;
    // showModal() throws InvalidStateError on an already-open dialog. A
    // dialog rendered inline with the `open` attribute is open but
    // NON-modal — no backdrop, no focus containment — so restart that one
    // as a real modal instead of leaving an untrapped pseudo-dialog.
    if (surface.open) {
      if (surface.matches(":modal")) return;
      surface.close();
    }
    surface.showModal();
  }

  /**
   * Close every open surface, bypassing the guard. Client-side routers must
   * call this before swapping page content: a modal that survives the swap
   * keeps the entire new page inert, and one destroyed while open strands
   * focus with no announcement. The guard is skipped deliberately — an
   * unsaved-changes prompt must not be able to outlive its own page.
   */
  function closeOpenSurfaces() {
    document.querySelectorAll(SURFACE_SELECTOR).forEach(function (surface) {
      if (surface.open) surface.close();
    });
  }

  function handlePointerDown(event) {
    pointerDownOnBackdrop =
      event.button === 0 &&
      isSurface(event.target) &&
      isOutsideBox(event.target, event);
  }

  function clearBackdropLatch() {
    pointerDownOnBackdrop = false;
  }

  function handleClick(event) {
    var wasBackdropPress = pointerDownOnBackdrop;
    pointerDownOnBackdrop = false;

    if (!(event.target instanceof Element)) return;

    var openTrigger = event.target.closest(OPEN_SELECTOR);
    if (openTrigger) {
      openSurface(
        openTrigger.getAttribute("data-dialog-open") ||
          openTrigger.getAttribute("data-drawer-open")
      );
      // A control carrying both open and close attributes must not fall
      // through: the close branch would close the origin surface and yank
      // focus out of the one just opened.
      return;
    }

    var closeTrigger = event.target.closest(CLOSE_SELECTOR);
    if (closeTrigger) {
      var owner = closeTrigger.closest("dialog");
      if (owner) requestClose(owner, "close-button");
      return;
    }

    if (!wasBackdropPress) return;
    if (!isSurface(event.target)) return;
    if (!allowsLightDismiss(event.target)) return;
    if (isOutsideBox(event.target, event)) requestClose(event.target, "backdrop");
  }

  /**
   * Escape. The native cancel event would close the surface on its own and
   * skip the guard entirely, so take it over and re-enter through
   * requestClose. cancel does not bubble, hence the capture phase — capture
   * reaches every target regardless of the event's bubbles flag.
   */
  function handleCancel(event) {
    if (!isSurface(event.target)) return;
    // A close request is only cancellable while the page holds transient user
    // activation, and cancelling one consumes it — so a second Escape with no
    // intervening interaction is NOT cancellable and the UA closes regardless.
    // Bail rather than run the guard: preventDefault would be a no-op, the
    // surface would close anyway, and a listener that called preventDefault
    // would be told it had blocked a close that actually went through.
    if (!event.cancelable) return;
    event.preventDefault();
    requestClose(event.target, "escape");
  }

  function initDialog() {
    if (window.__dialogInit) return;
    window.__dialogInit = true;

    // Capture phase so the latch is set even when a component stops
    // propagation of pointerdown on its own controls. pointercancel clears
    // a latch whose gesture will never produce a click (drag out of the
    // window, scroll takeover) so it cannot leak into a later click.
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointercancel", clearBackdropLatch, true);
    document.addEventListener("click", handleClick);
    document.addEventListener("cancel", handleCancel, true);

    console.log("[dialog/drawer] v" + VERSION + " — init");
  }

  // Exposed for parity with the other modules; delegation means calling it
  // again after a container swap is a no-op rather than a requirement.
  window.initDialog = initDialog;
  window.bdCloseOpenDialogs = closeOpenSurfaces;
  // Lets application code close a surface through the guard, which plain
  // .close() cannot do.
  window.bdRequestClose = requestClose;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDialog);
  } else {
    initDialog();
  }
})();
