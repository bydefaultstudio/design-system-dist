/* @bydefaultstudio/design-system v4.7.0 */
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
 *     <div class="drawer-handle" aria-hidden="true"></div>
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
 * Markup:
 *   <div class="drawer-handle">  — drawer only. Its presence enables drag to
 *     dismiss; there is no attribute, so the affordance and the gesture cannot
 *     desync. Decorative, so mark it aria-hidden="true". The gesture is a
 *     redundant pointer shortcut: the close button (or a live backdrop) is
 *     the single-pointer non-dragging alternative WCAG 2.5.7 requires, and
 *     Escape covers the keyboard separately. It must never be the only way
 *     out.
 *
 * The open/close attribute pairs are deliberate aliases: the JS treats them
 * identically and each component's doc shows only its own name, so nobody has
 * to write data-dialog-open on a drawer.
 *
 * Events:
 *   dialog-hide / drawer-hide — bubbling, CANCELLABLE. Fired before closing,
 *     with detail.source of "close-button" | "backdrop" | "escape" | "drag".
 *     preventDefault() keeps the surface open and pulses it — a refused drag
 *     also slides back to its edge.
 *
 *     "drag" is drawer-only and fires when a handle drag passes its dismiss
 *     threshold. data-static does NOT suppress it: that attribute guards
 *     against an accidental backdrop press, and a deliberate drag past half
 *     the panel is not accidental.
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
 *   close paths rather than bypassing it.
 *   Pressing the backdrop closes the surface unless it carries data-static.
 *   A drawer with a .drawer-handle can be dragged off its own edge; release
 *   dismisses it past half its extent or on a fast enough flick, and otherwise
 *   returns it home.
 *
 * All listeners are delegated from document, so surfaces injected after load
 * (CMS render, client app, Barba container swap) work without re-init.
 */
(function () {
  "use strict";

  var VERSION = "2.2.0";
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

    // A close can arrive mid-drag from another path entirely — Escape, a
    // second finger on the close button. Release the gesture first, or the
    // surface closes while .is-dragging still suspends its exit transition
    // and it vanishes instead of sliding out. No recursion: a drag-driven
    // dismissal nulls `drag` before calling in here.
    if (drag && drag.surface === surface) finishDrag(false);

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

  /* ── Drag to dismiss ─────────────────────────────────────────────────────
   * A drawer containing a .drawer-handle can be dragged off its own edge.
   * The handle's presence IS the opt-in — there is no attribute, so a drawer
   * can never advertise a gesture it does not have (see design-system.css
   * section 30).
   *
   * Dismissal routes through requestClose like every other close path, with
   * detail.source of "drag", so a drawer-hide guard sees it and can refuse it.
   * data-static is orthogonal and does NOT disable the gesture: it exists to
   * stop an accidental backdrop press, and a drag past half the panel is not
   * accidental. A drawer holding unsaved work guards drawer-hide instead.
   */

  /* Dismiss on either test independently: dragged more than half the drawer's
     own extent, or flicked hard enough. The flick also has to have travelled a
     minimum distance, so a jittery tap on the handle cannot read as a fling. */
  var DRAG_DISMISS_RATIO = 0.5;
  var DRAG_FLING_VELOCITY = 0.5; /* px per ms */
  var DRAG_FLING_MIN_DISTANCE = 24; /* px */
  /* Velocity is measured against an anchor at least this old, not against the
     previous frame — a single frame's delta is noise, and coalesced pointer
     events make it noisier. */
  var DRAG_SAMPLE_MS = 50;

  /** The gesture in progress, or null. Only one pointer drags at a time. */
  var drag = null;

  /**
   * Which way this drawer closes: the axis it travels on, and the sign that
   * turns "movement toward the docked edge" into a positive number.
   *
   * Inline placements follow the writing direction, and an unrecognised value
   * lands on `end` — the same degradation the CSS placement rules are written
   * to give it, so a typo cannot produce a drawer whose gesture fights its
   * own slide.
   */
  function dragVectorFor(surface) {
    var placement = surface.getAttribute("data-placement");
    if (placement === "top") return { axis: "y", sign: -1 };
    if (placement === "bottom") return { axis: "y", sign: 1 };

    // :dir() rather than computed direction, because that is the signal the
    // stylesheet's slide-flip rules read (design-system.css section 30). The
    // two can disagree when direction comes from CSS alone — :dir() matches
    // element directionality, not the computed property — and if that edge is
    // ever hit, gesture and slide must at least be wrong TOGETHER.
    // try/catch: matches() throws SyntaxError on an unsupported selector, and
    // :dir() landed in Chromium three versions after the drawer's own
    // baseline (@starting-style, 117) — in that window the drawer works and
    // this call alone would kill the gesture. Default LTR, matching the
    // stylesheet, whose unsupported :dir(rtl) rules simply never match.
    var rtl = false;
    try {
      rtl = surface.matches(":dir(rtl)");
    } catch (dirError) {
      /* pre-:dir engine — LTR */
    }
    if (placement === "start") return { axis: "x", sign: rtl ? 1 : -1 };
    return { axis: "x", sign: rtl ? -1 : 1 };
  }

  /** Returns true when a drag actually started, so the caller can stand down. */
  function startDrag(event) {
    // One gesture at a time. A second pointer going down mid-drag — a mouse
    // press during a touch drag is isPrimary for its own pointer type — must
    // not overwrite the live gesture and orphan its capture and state class.
    if (drag) return false;
    if (!event.isPrimary || event.button !== 0) return false;
    if (!(event.target instanceof Element)) return false;

    var handle = event.target.closest(".drawer-handle");
    if (!handle) return false;

    var surface = handle.closest("dialog.drawer");
    if (!surface || !surface.open) return false;

    // WCAG 2.5.7: the gesture needs a single-pointer, non-dragging
    // alternative, and that alternative is a close control or a live
    // backdrop — Escape is keyboard and does not count. Warn rather than
    // refuse: the gesture still works, but the author has shipped a drawer
    // some pointer users cannot leave.
    if (
      !surface.__bdWarnedDragOnly &&
      !surface.querySelector(CLOSE_SELECTOR) &&
      !allowsLightDismiss(surface)
    ) {
      surface.__bdWarnedDragOnly = true;
      console.warn(
        "[dialog/drawer] drag handle is the only pointer close path — add a " +
          "close button or remove data-static (WCAG 2.5.7)",
        surface
      );
    }

    var rect = surface.getBoundingClientRect();
    var vector = dragVectorFor(surface);
    var extent = vector.axis === "x" ? rect.width : rect.height;
    // A zero extent would make the distance threshold zero too, so the first
    // pixel of movement would dismiss. Refuse the gesture instead.
    if (extent <= 0) return false;

    drag = {
      surface: surface,
      handle: handle,
      pointerId: event.pointerId,
      axis: vector.axis,
      sign: vector.sign,
      extent: extent,
      start: vector.axis === "x" ? event.clientX : event.clientY,
      anchorOffset: 0,
      anchorTime: event.timeStamp,
      sampleOffset: 0,
      sampleTime: event.timeStamp
    };

    // Capture guarantees the move and up events arrive even when the pointer
    // leaves the drawer, the window, or the document entirely — without it a
    // drag released off-screen strands the drawer mid-slide. try/catch, not
    // just existence: the spec lets this throw for an inactive pointer, and
    // an unguarded throw here would abort AFTER `drag` was set but BEFORE the
    // listeners below were added — no pointerup could ever reach finishDrag,
    // and the `if (drag)` guard would refuse every drag from then on. Capture
    // is an enhancement; the document-level listeners work without it.
    try {
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    } catch (captureError) {
      /* proceed uncaptured */
    }

    surface.classList.add("is-dragging");
    document.addEventListener("pointermove", handleDragMove);
    document.addEventListener("pointerup", handleDragEnd);
    document.addEventListener("pointercancel", handleDragCancel);
    return true;
  }

  function handleDragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    var position = drag.axis === "x" ? event.clientX : event.clientY;
    // Multiplying by the sign makes "toward the docked edge" positive whatever
    // the placement, so one clamp and one threshold serve all four.
    var offset = (position - drag.start) * drag.sign;
    // Pulling the other way clamps rather than rubber-bands: a drawer stretched
    // past its own edge has nowhere to go and nothing to reveal.
    if (offset < 0) offset = 0;

    if (event.timeStamp - drag.sampleTime >= DRAG_SAMPLE_MS) {
      drag.anchorOffset = drag.sampleOffset;
      drag.anchorTime = drag.sampleTime;
      drag.sampleOffset = offset;
      drag.sampleTime = event.timeStamp;
    }

    var travel = offset * drag.sign;
    drag.surface.style.translate =
      drag.axis === "x" ? travel + "px 0" : "0 " + travel + "px";
  }

  /**
   * Release the gesture, then either let the drawer home or ask it to close.
   *
   * Clearing the inline translate hands the element back to the stylesheet:
   * still open, it transitions home on the entrance tokens; closing, it
   * continues off its edge on the exit tokens. The two lines must stay
   * adjacent — anything that reads layout between them flushes the cleared
   * value, and the drawer snaps home before it leaves. (A drawer-hide listener
   * that reads layout can still cause that; it is the consumer's call, and the
   * result is cosmetic.)
   */
  function finishDrag(dismiss) {
    if (!drag) return;

    var surface = drag.surface;
    var handle = drag.handle;
    var pointerId = drag.pointerId;

    document.removeEventListener("pointermove", handleDragMove);
    document.removeEventListener("pointerup", handleDragEnd);
    document.removeEventListener("pointercancel", handleDragCancel);
    if (handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    surface.classList.remove("is-dragging");
    drag = null;

    surface.style.removeProperty("translate");
    if (dismiss) requestClose(surface, "drag");
  }

  function handleDragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    // The up event carries the final position — fold it in rather than
    // deciding on the last pointermove, whose coalesced tail may be stale.
    var position = drag.axis === "x" ? event.clientX : event.clientY;
    var offset = (position - drag.start) * drag.sign;
    if (offset < 0) offset = 0;

    // Re-measure rather than trusting the extent captured at pointerdown: a
    // rotation or resize mid-gesture — likeliest on the mobile sheet this
    // feature targets — would otherwise skew the halfway threshold. The rect
    // is taken mid-translate, but width and height are invariant under a
    // pure translation, and those are the only fields read.
    var rect = drag.surface.getBoundingClientRect();
    var extent = drag.axis === "x" ? rect.width : rect.height;
    if (extent <= 0) extent = drag.extent;

    var elapsed = event.timeStamp - drag.anchorTime;
    var velocity = elapsed > 0 ? (offset - drag.anchorOffset) / elapsed : 0;
    var dragged = offset >= extent * DRAG_DISMISS_RATIO;
    var flung =
      velocity >= DRAG_FLING_VELOCITY && offset >= DRAG_FLING_MIN_DISTANCE;

    finishDrag(dragged || flung);
  }

  function handleDragCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    finishDrag(false);
  }

  /**
   * A drawer can close out from under a live gesture — a router teardown via
   * bdCloseOpenDialogs, or application code calling .close() directly. Abandon
   * the drag and strip any inline translate it left behind, or the drawer
   * reopens parked at the position the finger abandoned it in.
   *
   * close does not bubble, hence the capture phase — the same reason handleCancel
   * uses it.
   */
  function handleClose(event) {
    if (!isSurface(event.target)) return;
    if (drag && drag.surface === event.target) finishDrag(false);
    event.target.style.removeProperty("translate");
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
    // Abandon any live drag first: the close event that would do it arrives a
    // task late, and in the gap the drawer would close with .is-dragging
    // suspending its exit transition, frozen at the finger's last position.
    // finishDrag no-ops when nothing is in flight.
    finishDrag(false);
    document.querySelectorAll(SURFACE_SELECTOR).forEach(function (surface) {
      if (surface.open) surface.close();
    });
  }

  function handlePointerDown(event) {
    // A press on a drawer handle is a gesture, never a backdrop press: the
    // handle sits inside the surface, so the latch below would read false
    // anyway, but returning early keeps the two paths from ever interleaving.
    if (startDrag(event)) {
      pointerDownOnBackdrop = false;
      return;
    }

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
    document.addEventListener("close", handleClose, true);

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
