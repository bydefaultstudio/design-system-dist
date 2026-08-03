/* @bydefaultstudio/design-system v2.2.0 */
/**
 * Dropdown component — WAI-ARIA menu button pattern
 *
 * Auto-initialises every .dropdown on the page. All listeners are delegated
 * from document, so dropdowns rendered after load (CMS render, client app,
 * Barba container swap) work without re-init.
 *
 * Structure:
 *   <div class="dropdown">
 *     <button class="dropdown-trigger" type="button"
 *             aria-haspopup="true" aria-expanded="false">…</button>
 *     <div class="dropdown-menu" role="menu">
 *       <button class="dropdown-item" role="menuitem" type="button">…</button>
 *     </div>
 *   </div>
 *
 * The menu carries role="menu", so it may only own menuitem,
 * menuitemcheckbox, menuitemradio, group and separator. Non-interactive
 * content (section labels, a user identity row) must sit inside a
 * .dropdown-group or outside the role="menu" element entirely — see
 * cms/dropdown.md.
 *
 * ARIA wiring is applied here rather than authored: aria-controls on the
 * trigger, aria-labelledby on the menu, and tabindex="-1" on every item.
 * Roving tabindex only has to hold while the menu is open, because a closed
 * .dropdown-menu is display:none and its items are not focusable at all.
 *
 * Checkable items:
 *   <button class="dropdown-item" role="menuitemcheckbox" type="button"
 *           data-value="grid" aria-checked="false">…</button>
 *   Toggling one keeps the menu open. Activating a plain menuitem closes it.
 *
 * Disabled items use aria-disabled="true", NOT the disabled attribute: they
 * stay in the arrow cycle so a keyboard user discovers the same options a
 * mouse user can see, and activation is blocked here instead.
 *
 * Events:
 *   dropdown-select — bubbling, fired on the .dropdown after an item is
 *     activated. detail: { value, item, checked }. `checked` is null for
 *     plain items.
 */
(function () {
  "use strict";

  var VERSION = "2.0.0";
  var ITEM_SELECTOR =
    '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
  var TYPEAHEAD_RESET_MS = 500;

  var typeaheadBuffer = "";
  var typeaheadTimer = null;
  var idCounter = 0;
  var repositionFrame = null;

  function getTrigger(dropdown) {
    return dropdown.querySelector(".dropdown-trigger");
  }

  function getMenu(dropdown) {
    return dropdown.querySelector(".dropdown-menu");
  }

  /**
   * The element carrying role="menu". Usually .dropdown-menu itself, but a
   * panel that also holds non-menu content (an identity row) puts the role on
   * an inner .dropdown-group instead, because role="menu" restricts what it
   * may own. Returns null when the panel is not a menu at all.
   */
  function getMenuRoleEl(dropdown) {
    var menu = getMenu(dropdown);
    if (!menu) return null;
    if (menu.getAttribute("role") === "menu") return menu;
    return menu.querySelector('[role="menu"]');
  }

  function getItems(dropdown) {
    var menu = getMenu(dropdown);
    if (!menu) return [];
    return Array.prototype.filter.call(
      menu.querySelectorAll(ITEM_SELECTOR),
      function isReachable(item) {
        // focus() on a display:none element is a silent no-op — it neither
        // moves focus nor throws. An unfiltered hidden item therefore
        // dead-ends arrow navigation and typeahead with nothing to debug
        // from. Menus whose items are toggled per mode rely on this.
        return item.getClientRects().length > 0;
      }
    );
  }

  function isDisabled(item) {
    return (
      item.getAttribute("aria-disabled") === "true" ||
      item.hasAttribute("disabled") ||
      item.classList.contains("is-disabled")
    );
  }

  function nextId(prefix) {
    idCounter += 1;
    return prefix + "-" + idCounter;
  }

  /** Names the menu and links it to its trigger, once per dropdown. */
  function wireRelationship(dropdown) {
    if (dropdown.__ddWired) return;
    dropdown.__ddWired = true;

    var trigger = getTrigger(dropdown);
    var menu = getMenu(dropdown);
    if (!trigger || !menu) return;

    if (!trigger.id) trigger.id = nextId("dropdown-trigger");
    if (!menu.id) menu.id = nextId("dropdown-menu");

    // aria-controls points at the panel, since that is what is shown and
    // hidden; the accessible name goes on whatever carries role="menu".
    trigger.setAttribute("aria-controls", menu.id);
    if (!trigger.hasAttribute("aria-expanded")) {
      trigger.setAttribute("aria-expanded", "false");
    }

    var menuRoleEl = getMenuRoleEl(dropdown);

    // aria-haspopup="true" is an alias for "menu" — it promises menu semantics
    // and the menu keyboard contract. Only claim it when the panel actually
    // is one, or a plain disclosure panel lies to assistive tech.
    if (menuRoleEl && !trigger.hasAttribute("aria-haspopup")) {
      trigger.setAttribute("aria-haspopup", "true");
    }

    if (
      menuRoleEl &&
      !menuRoleEl.hasAttribute("aria-label") &&
      !menuRoleEl.hasAttribute("aria-labelledby")
    ) {
      menuRoleEl.setAttribute("aria-labelledby", trigger.id);
    }
  }

  /**
   * Decide where the menu actually opens and record it on the dropdown.
   *
   * Runs after .is-open so the menu has real dimensions to measure — a
   * display:none panel reports a zero box and every test below would pass.
   * Each axis flips only when the requested side overflows AND the opposite
   * side has more room, so a menu taller than the viewport stays put rather
   * than flipping into an equally bad position.
   */
  function resolvePlacement(dropdown) {
    var menu = getMenu(dropdown);
    var trigger = getTrigger(dropdown);
    if (!menu || !trigger) return;

    var requested = dropdown.getAttribute("data-placement");
    if (!requested) {
      requested = menu.classList.contains("is-right") ? "bottom-end" : "bottom-start";
    }

    var block = requested.indexOf("top") === 0 ? "top" : "bottom";
    var inline = requested.indexOf("-end") > -1 ? "end" : "start";

    var triggerBox = trigger.getBoundingClientRect();
    var menuBox = menu.getBoundingClientRect();
    var viewportW = document.documentElement.clientWidth;
    var viewportH = document.documentElement.clientHeight;

    var roomBelow = viewportH - triggerBox.bottom;
    var roomAbove = triggerBox.top;
    if (block === "bottom" && menuBox.height > roomBelow && roomAbove > roomBelow) {
      block = "top";
    } else if (block === "top" && menuBox.height > roomAbove && roomBelow > roomAbove) {
      block = "bottom";
    }

    // Inline overflow is measured from the edge the menu is anchored to:
    // a start-aligned menu grows rightward from the trigger's left edge, an
    // end-aligned one grows leftward from its right edge.
    var roomRight = viewportW - triggerBox.left;
    var roomLeft = triggerBox.right;
    if (inline === "start" && menuBox.width > roomRight && roomLeft > roomRight) {
      inline = "end";
    } else if (inline === "end" && menuBox.width > roomLeft && roomRight > roomLeft) {
      inline = "start";
    }

    dropdown.setAttribute("data-resolved-placement", block + "-" + inline);
  }

  /**
   * Re-resolve every open menu. Placement decided once at open time goes stale
   * the moment the page scrolls or the window resizes — a menu that had room
   * below when it opened can be against the bottom edge a moment later.
   * resolvePlacement always re-reads the authored intent rather than the
   * previously resolved value, so running it repeatedly is idempotent.
   */
  function repositionOpen() {
    if (repositionFrame) return;
    repositionFrame = window.requestAnimationFrame(function reposition() {
      repositionFrame = null;
      var open = document.querySelectorAll(".dropdown.is-open");
      Array.prototype.forEach.call(open, resolvePlacement);
    });
  }

  function focusItem(item) {
    if (!item) return;
    // Applied here as well as on open, so an item rendered into an already
    // open menu cannot sit in the tab order without a roving counterpart.
    item.setAttribute("tabindex", "-1");
    item.focus();
  }

  /**
   * @param {'first'|'last'|null} focusTarget where to place focus on open.
   *   null leaves focus on the trigger, which is what a mouse open wants.
   */
  function openDropdown(dropdown, focusTarget) {
    wireRelationship(dropdown);
    closeAll(dropdown);

    dropdown.classList.add("is-open");
    var trigger = getTrigger(dropdown);
    if (trigger) trigger.setAttribute("aria-expanded", "true");

    // Must follow .is-open: the menu needs a real box to measure.
    resolvePlacement(dropdown);

    var items = getItems(dropdown);
    items.forEach(function applyRovingTabindex(item) {
      item.setAttribute("tabindex", "-1");
    });

    if (focusTarget === "first") focusItem(items[0]);
    if (focusTarget === "last") focusItem(items[items.length - 1]);
  }

  function closeDropdown(dropdown, returnFocus) {
    // Deliberately not an early return when the class is already gone.
    // Consumers that bind their own handler to the menu element run first —
    // the event reaches them before it bubbles to document — and some strip
    // .is-open themselves. Bailing here would leave aria-expanded reading
    // "true" over a menu that is visibly shut.
    var wasOpen = dropdown.classList.contains("is-open");

    dropdown.classList.remove("is-open");
    // Cleared so the next open measures fresh rather than inheriting a flip
    // decided at a different scroll position or viewport size.
    dropdown.removeAttribute("data-resolved-placement");
    var trigger = getTrigger(dropdown);
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      // Only pull focus for a menu that was genuinely open, so normalising a
      // already-closed dropdown cannot yank focus out from under the user.
      if (returnFocus && wasOpen) trigger.focus();
    }
    resetTypeahead();
  }

  function closeAll(except) {
    var open = document.querySelectorAll(".dropdown.is-open");
    Array.prototype.forEach.call(open, function closeOne(dropdown) {
      if (dropdown !== except) closeDropdown(dropdown, false);
    });
  }

  /** The open dropdown that currently contains focus, if any. */
  function activeDropdown() {
    var active = document.activeElement;
    if (!active || !active.closest) return null;
    return active.closest(".dropdown.is-open");
  }

  function moveFocusBy(dropdown, delta) {
    var items = getItems(dropdown);
    if (!items.length) return;

    var index = items.indexOf(document.activeElement);
    // Wrapping is required by the menu pattern: from the last item ArrowDown
    // returns to the first. -1 (focus still on the trigger) enters at the top
    // for ArrowDown and at the bottom for ArrowUp.
    var next;
    if (index === -1) {
      next = delta > 0 ? 0 : items.length - 1;
    } else {
      next = (index + delta + items.length) % items.length;
    }
    focusItem(items[next]);
  }

  function moveFocusEdge(dropdown, edge) {
    var items = getItems(dropdown);
    if (!items.length) return;
    focusItem(edge === "first" ? items[0] : items[items.length - 1]);
  }

  function resetTypeahead() {
    typeaheadBuffer = "";
    if (typeaheadTimer) {
      window.clearTimeout(typeaheadTimer);
      typeaheadTimer = null;
    }
  }

  function itemLabel(item) {
    return (item.textContent || "").trim().toLowerCase();
  }

  /**
   * Focus the next item whose label starts with the buffer, searching from
   * after the current item and wrapping. Repeating a single character cycles
   * through the items starting with it, which is what the pattern expects.
   */
  function runTypeahead(dropdown, character) {
    var items = getItems(dropdown);
    if (!items.length) return;

    typeaheadBuffer += character.toLowerCase();
    if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
    typeaheadTimer = window.setTimeout(resetTypeahead, TYPEAHEAD_RESET_MS);

    var repeatedChar =
      typeaheadBuffer.length > 1 &&
      typeaheadBuffer.split("").every(function same(c) {
        return c === typeaheadBuffer[0];
      });
    var needle = repeatedChar ? typeaheadBuffer[0] : typeaheadBuffer;

    var start = items.indexOf(document.activeElement);
    // A fresh buffer searches from the next item so a repeat advances; a
    // growing buffer re-tests the current item so "de" can stay on "Delete".
    var offset = typeaheadBuffer.length === 1 || repeatedChar ? 1 : 0;

    for (var step = 0; step < items.length; step += 1) {
      var candidate = items[(start + offset + step + items.length) % items.length];
      if (itemLabel(candidate).indexOf(needle) === 0) {
        focusItem(candidate);
        return;
      }
    }
  }

  /**
   * Activate an item. Checkable items toggle and keep the menu open, because
   * a multi-select menu the user has to reopen per choice is unusable. Plain
   * items close and hand focus back to the trigger.
   */
  function activateItem(item) {
    var dropdown = item.closest(".dropdown");
    if (!dropdown) return;

    var role = item.getAttribute("role");
    var checkable = role === "menuitemcheckbox" || role === "menuitemradio";
    var checked = null;

    if (checkable) {
      if (role === "menuitemradio") {
        // Radios are one-of-N within their owning group, so clear the rest
        // before setting this one.
        var scope = item.closest('[role="group"]') || getMenu(dropdown);
        var siblings = scope
          ? scope.querySelectorAll('[role="menuitemradio"]')
          : [];
        Array.prototype.forEach.call(siblings, function clear(sibling) {
          sibling.setAttribute("aria-checked", "false");
          sibling.classList.remove("is-selected");
        });
        checked = true;
      } else {
        checked = item.getAttribute("aria-checked") !== "true";
      }
      item.setAttribute("aria-checked", String(checked));
      item.classList.toggle("is-selected", checked);
    }

    dropdown.dispatchEvent(
      new CustomEvent("dropdown-select", {
        bubbles: true,
        detail: {
          value: item.getAttribute("data-value"),
          item: item,
          checked: checked
        }
      })
    );

    // Only a checkbox keeps the menu open — the user may want several. A radio
    // is a single choice, so it closes like any other item; leaving it open
    // would strand the user in a menu whose question they have answered.
    if (role !== "menuitemcheckbox") closeDropdown(dropdown, true);
  }

  function handleClick(event) {
    if (!(event.target instanceof Element)) return;

    var trigger = event.target.closest(".dropdown-trigger");
    if (trigger) {
      var dropdown = trigger.closest(".dropdown");
      // .dropdown-trigger is sometimes borrowed for its styling by a plain
      // button that opens nothing (a toolbar Reset, for instance). Returning
      // here would let that click pass without dismissing an open menu,
      // leaving the page with a menu nobody can explain.
      if (!dropdown) {
        closeAll(null);
        return;
      }
      if (dropdown.classList.contains("is-open")) {
        closeDropdown(dropdown, false);
      } else {
        // Pointer opens leave focus on the trigger — jumping into the menu
        // would fight the pointer the user is already aiming with. WebKit
        // does not focus a button on click, so anchor focus explicitly or
        // every menu key afterwards has nothing to resolve against and the
        // keyboard is dead until the user Tabs back in.
        openDropdown(dropdown, null);
        if (document.activeElement !== trigger) trigger.focus();
      }
      return;
    }

    var item = event.target.closest(ITEM_SELECTOR);
    if (item && item.closest(".dropdown-menu")) {
      if (isDisabled(item)) {
        // aria-disabled items stay focusable and clickable at the DOM level,
        // so the activation has to be refused here.
        event.preventDefault();
        return;
      }
      activateItem(item);
      return;
    }

    if (!event.target.closest(".dropdown-menu")) closeAll(null);
  }

  function handleTriggerKeydown(event, dropdown) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDropdown(dropdown, "first");
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openDropdown(dropdown, "last");
      return true;
    }
    return false;
  }

  function handleMenuKeydown(event, dropdown) {
    // A .dropdown whose panel is not a menu — a form panel, a settings sheet —
    // gets Escape and outside-click only. Running the menu keys over it would
    // strand its content: there are no items for the arrows to find, and Tab
    // would close the panel before focus ever reached what is inside it.
    if (!getMenuRoleEl(dropdown)) return false;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocusBy(dropdown, 1);
        return true;
      case "ArrowUp":
        event.preventDefault();
        moveFocusBy(dropdown, -1);
        return true;
      case "Home":
        event.preventDefault();
        moveFocusEdge(dropdown, "first");
        return true;
      case "End":
        event.preventDefault();
        moveFocusEdge(dropdown, "last");
        return true;
      case "Enter":
      case " ":
        var item = event.target.closest(ITEM_SELECTOR);
        if (!item) return false;
        event.preventDefault();
        if (isDisabled(item)) return true;
        // Dispatch a real click rather than calling activateItem directly.
        // preventDefault above has already suppressed the native activation,
        // so without this an <a> item stops navigating and every consumer
        // still bound to click — which is all of them predating
        // dropdown-select — goes keyboard-dead. The delegated click handler
        // turns this back into exactly one activateItem call.
        item.click();
        return true;
      case "Tab":
        // Tab leaves the menu. Close it and hand focus to the trigger, then
        // let the default run so the browser continues from there — forwards
        // to whatever follows the trigger, backwards to whatever precedes it.
        closeDropdown(dropdown, true);
        return false;
      default:
        return false;
    }
  }

  function handleKeydown(event) {
    if (event.defaultPrevented) return;

    if (event.key === "Escape") {
      var focusedIn = activeDropdown();
      var openDropdownEl = focusedIn || document.querySelector(".dropdown.is-open");
      if (!openDropdownEl) return;
      // Only pull focus back to the trigger when focus was ours to move, and
      // only swallow the key when it was. A menu left open behind an
      // unrelated focused field must not hijack that field's Escape.
      closeDropdown(openDropdownEl, Boolean(focusedIn));
      if (!focusedIn) return;
      // Escape dismisses the innermost layer only. Without this, a dropdown
      // inside a dialog closes the dialog with it on the same press. Engines
      // that route their dialog close request around keydown will still close
      // both — the pre-existing behaviour, not a regression from here.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!(event.target instanceof Element)) return;

    var trigger = event.target.closest(".dropdown-trigger");
    if (trigger) {
      var triggerDropdown = trigger.closest(".dropdown");
      if (triggerDropdown && !triggerDropdown.classList.contains("is-open")) {
        if (handleTriggerKeydown(event, triggerDropdown)) return;
      }
    }

    var dropdown = activeDropdown();
    if (!dropdown) return;

    if (handleMenuKeydown(event, dropdown)) return;

    // Typeahead last, so it never shadows a navigation key. Modifier combos
    // belong to the browser, not to us.
    if (
      getMenuRoleEl(dropdown) &&
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      runTypeahead(dropdown, event.key);
    }
  }

  /** Tabbing or clicking away leaves an open menu claiming to be expanded. */
  function handleFocusOut(event) {
    var dropdown = event.target.closest && event.target.closest(".dropdown.is-open");
    if (!dropdown) return;
    var next = event.relatedTarget;
    if (next && dropdown.contains(next)) return;
    closeDropdown(dropdown, false);
  }

  function initDropdown() {
    if (window.__dropdownInit) return;
    window.__dropdownInit = true;

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("focusout", handleFocusOut);
    // Capture phase on scroll: scroll does not bubble, and the menu may sit
    // inside a scrolling panel rather than the page itself.
    window.addEventListener("resize", repositionOpen);
    window.addEventListener("scroll", repositionOpen, true);

    console.log("[dropdown] v" + VERSION + " — init");
  }

  window.initDropdown = initDropdown;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDropdown);
  } else {
    initDropdown();
  }
})();
