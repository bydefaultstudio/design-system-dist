/* @bydefaultstudio/design-system v2.1.1 */
/**
 * Dialog component
 * Opens and closes native <dialog> elements declaratively.
 *
 * Usage:
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
 * Put autofocus on the primary action — without it showModal() focuses the
 * first focusable element, which is the header Close button. On a
 * destructive dialog put autofocus on Cancel instead (see cms/dialog.md).
 *
 * Attributes:
 *   data-dialog-open="id" — on a trigger, opens that dialog via showModal()
 *   data-dialog-close     — inside a dialog, closes it
 *
 * Behaviour:
 *   Escape and focus trapping are native to <dialog> + showModal().
 *   Clicking the backdrop closes the dialog.
 *
 * All listeners are delegated from document, so dialogs injected after load
 * (CMS render, client app, Barba container swap) work without re-init.
 */
(function () {
  "use strict";

  var VERSION = "2.0.0";
  var DIALOG_SELECTOR = "dialog.dialog";
  var CLOSE_SELECTOR = "[data-dialog-close], .dialog-close";

  /**
   * Latched on pointerdown, read on click. Without it, a drag that starts on
   * text inside the dialog and releases on the backdrop dispatches a click at
   * the common ancestor (the dialog) and discards whatever the user typed.
   */
  var pointerDownOnBackdrop = false;

  function isDialogSurface(node) {
    return node instanceof Element && node.matches(DIALOG_SELECTOR);
  }

  /**
   * True when the point falls outside the dialog's border box.
   *
   * The pointerdown latch is what makes this keyboard-safe: Enter/Space
   * activation dispatches a click with no preceding pointerdown, so the
   * latch stays false and this test is never reached. Keyboard clicks
   * report clientX/clientY of 0 — which reads as "outside" for every
   * centred dialog — so do NOT remove the latch and rely on coordinates.
   */
  function isOutsideDialogBox(dialog, event) {
    var rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }

  function openDialog(id) {
    var dialog = document.getElementById(id);
    if (!dialog || dialog.tagName !== "DIALOG") return;
    // showModal() throws InvalidStateError on an already-open dialog. A
    // dialog rendered inline with the `open` attribute is open but
    // NON-modal — no backdrop, no focus containment — so restart that one
    // as a real modal instead of leaving an untrapped pseudo-dialog.
    if (dialog.open) {
      if (dialog.matches(":modal")) return;
      dialog.close();
    }
    dialog.showModal();
  }

  /**
   * Close every open dialog. Client-side routers must call this before
   * swapping page content: a modal that survives the swap keeps the entire
   * new page inert, and one destroyed while open strands focus with no
   * announcement.
   */
  function closeOpenDialogs() {
    document.querySelectorAll(DIALOG_SELECTOR + "[open]").forEach(function (d) {
      d.close();
    });
  }

  function handlePointerDown(event) {
    pointerDownOnBackdrop =
      event.button === 0 &&
      isDialogSurface(event.target) &&
      isOutsideDialogBox(event.target, event);
  }

  function clearBackdropLatch() {
    pointerDownOnBackdrop = false;
  }

  function handleClick(event) {
    var wasBackdropPress = pointerDownOnBackdrop;
    pointerDownOnBackdrop = false;

    if (!(event.target instanceof Element)) return;

    var openTrigger = event.target.closest("[data-dialog-open]");
    if (openTrigger) {
      openDialog(openTrigger.getAttribute("data-dialog-open"));
      // A control carrying both open and close attributes must not fall
      // through: the close branch would close the origin dialog and yank
      // focus out of the one just opened.
      return;
    }

    var closeTrigger = event.target.closest(CLOSE_SELECTOR);
    if (closeTrigger) {
      var owner = closeTrigger.closest("dialog");
      if (owner) owner.close();
      return;
    }

    if (!wasBackdropPress) return;
    if (!isDialogSurface(event.target)) return;
    if (isOutsideDialogBox(event.target, event)) event.target.close();
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

    console.log("[dialog] v" + VERSION + " — init");
  }

  // Exposed for parity with the other modules; delegation means calling it
  // again after a container swap is a no-op rather than a requirement.
  window.initDialog = initDialog;
  window.bdCloseOpenDialogs = closeOpenDialogs;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDialog);
  } else {
    initDialog();
  }
})();
