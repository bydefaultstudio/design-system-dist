'use client';
/* @bydefaultstudio/design-system v4.8.0 */
/**
 * Dropdown — React adapters over the Dropdown markup contract
 * (cms/dropdown.md), as a composition: the contract is rich (icons,
 * shortcuts, descriptions, groups, headers, checkable items), and a
 * data-driven prop API would flatten exactly the structure the markup
 * exists to express.
 *
 * dropdown.js is delegation-based and owns the behaviour — open/close,
 * placement resolution, the full menu-button keyboard pattern, and the
 * ARIA plumbing (aria-controls, aria-labelledby, item tabindex). These
 * components render the roles; the module wires the rest, and its
 * attribute writes survive React re-renders because the rendered props
 * never change. <Dropdown> bridges the module's `dropdown-select` event
 * to `onSelect(detail)`.
 */
import * as React from 'react';
import { cx, warnOnce, checkIcon } from './internal.mjs';

var h = React.createElement;

export function Dropdown(props) {
  var placement = props.placement;
  var onSelect = props.onSelect;
  var id = props.id;
  var className = props.className;
  var children = props.children;
  var ref = React.useRef(null);

  React.useEffect(
    function () {
      var el = ref.current;
      if (!el || !onSelect) return;
      function handleSelect(event) {
        // Nested dropdowns are supported by the module and the event bubbles,
        // so an outer menu would otherwise receive the inner menu's selections
        // with no way to tell them apart from detail alone.
        if (event.target !== el) return;
        onSelect(event.detail);
      }
      el.addEventListener('dropdown-select', handleSelect);
      return function () {
        el.removeEventListener('dropdown-select', handleSelect);
      };
    },
    [onSelect]
  );

  React.useEffect(function () {
    if (typeof window !== 'undefined' && typeof window.initDropdown !== 'function') {
      warnOnce(
        'Dropdown: dropdown.js is not loaded — the menu will not open. Load the module (see cms/react.md).'
      );
    }
  }, []);

  return h(
    'div',
    { ref: ref, id: id, className: cx('dropdown', className), 'data-placement': placement },
    children
  );
}

export function DropdownTrigger(props) {
  var button = props.button;
  var variant = props.variant;
  var className = props.className;
  var children = props.children;
  var ariaLabel = props['aria-label'];
  // dropdown.js sets aria-haspopup only when the panel really carries a menu
  // role, because a settings panel that claims menu semantics promises a
  // keyboard contract the module refuses to provide. Mirror that: pass
  // haspopup={false} alongside <DropdownMenu role={null}>.
  var haspopup = props.haspopup === undefined ? true : props.haspopup;

  return h(
    'button',
    {
      className: cx('dropdown-trigger', button && 'button', className),
      'data-variant': variant,
      type: 'button',
      'aria-haspopup': haspopup ? 'true' : undefined,
      'aria-expanded': 'false',
      'aria-label': ariaLabel,
    },
    children
  );
}

export function DropdownMenu(props) {
  // role defaults to "menu". Pass role={null} for the header pattern,
  // where the role moves inward onto a <DropdownGroup menu> so the menu
  // owns only real items (see the avatar pattern in cms/dropdown.md).
  var role = props.role === undefined ? 'menu' : props.role;
  return h(
    'div',
    { className: cx('dropdown-menu', props.className), role: role || undefined },
    props.children
  );
}

export function DropdownItem(props) {
  var itemRef = React.useRef(null);
  var danger = props.danger;
  var disabled = props.disabled;
  var checked = props.checked; // true/false makes the item checkable
  var radio = props.radio; // with checked: menuitemradio inside a group
  var value = props.value;
  var onClick = props.onClick;
  var className = props.className;
  var children = props.children;

  var checkable = checked !== undefined;
  var role = checkable ? (radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem';

  // The module toggles aria-checked and .is-selected in the DOM on activation.
  // When `checked` is supplied it is the source of truth, so re-assert it after
  // every render — otherwise a change the consumer declines sticks visually,
  // and a radio activation that cleared its siblings never restores them.
  React.useLayoutEffect(function () {
    var el = itemRef.current;
    if (!el || !checkable) return;
    el.setAttribute('aria-checked', checked ? 'true' : 'false');
    el.classList.toggle('is-selected', !!checked);
  });

  return h(
    'button',
    {
      ref: itemRef,
      className: cx('dropdown-item', danger && 'dropdown-item--danger', checkable && checked && 'is-selected', className),
      role: role,
      type: 'button',
      'data-value': value,
      'aria-checked': checkable ? (checked ? 'true' : 'false') : undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      // Not merely cosmetic: dropdown.js blocks its own activation from a
      // document-level listener, which React's root-level handler beats.
      // Without this an aria-disabled item announces disabled and acts.
      onClick: disabled ? undefined : onClick,
    },
    checkable ? h('span', { className: 'dropdown-checkmark' }, checkIcon()) : null,
    children
  );
}

export function DropdownItemEnd(props) {
  return h('span', { className: cx('dropdown-item-end', props.className) }, props.children);
}

export function DropdownDesc(props) {
  return h('div', { className: cx('dropdown-desc', props.className), id: props.id }, props.children);
}

export function DropdownLabel(props) {
  return h('div', { className: cx('dropdown-label', props.className), id: props.id }, props.children);
}

export function DropdownGroup(props) {
  // A labelled section: role="group" with aria-labelledby pointing at the
  // generated label. `menu` makes it the inner role="menu" wrapper the
  // header pattern needs instead.
  var label = props.label;
  var menu = props.menu;
  var labelledBy = props['aria-labelledby'];
  var autoId = React.useId();
  var labelId = label != null ? props.labelId || autoId + '-label' : undefined;

  return h(
    'div',
    {
      className: cx('dropdown-group', props.className),
      role: menu ? 'menu' : 'group',
      'aria-labelledby': labelledBy || labelId,
    },
    label != null ? h(DropdownLabel, { id: labelId }, label) : null,
    props.children
  );
}

export function DropdownHeader(props) {
  return h('div', { className: cx('dropdown-header', props.className) }, props.children);
}

export function DropdownDivider() {
  return h('div', { className: 'dropdown-divider', role: 'separator' });
}
