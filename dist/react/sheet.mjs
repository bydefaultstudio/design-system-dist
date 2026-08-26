'use client';
/* @bydefaultstudio/design-system v4.7.0 */
/**
 * <Sheet> — React adapter over the Drawer markup contract (cms/drawer.md).
 *
 * A Sheet is a drawer: a modal panel docked to an edge, `bottom` by
 * default — the mobile action-sheet shape. Same machinery as <Dialog>
 * (dialog.js serves both), with the drawer's own hooks: `data-placement`,
 * the drag handle, `--drawer-size`, and the `drawer-hide` guard whose
 * `detail.source` includes "drag".
 *
 * The handle defaults on for `bottom` placement — the gesture is what
 * people reach for first on a sheet — and off elsewhere. Pass
 * `handle={false}` (or `true`) to override.
 */
import * as React from 'react';
import { cx, warnOnce, closeButton } from './internal.mjs';

var h = React.createElement;

export var Sheet = React.forwardRef(function Sheet(props, forwardedRef) {
  var open = props.open || false;
  var onClose = props.onClose;
  var onHide = props.onHide;
  var title = props.title;
  var footer = props.footer;
  var headerActions = props.headerActions;
  var headingLevel = props.headingLevel || 2;
  var placement = props.placement || 'bottom';
  var handle = props.handle != null ? props.handle : placement === 'bottom';
  var size = props.size;
  var isStatic = props.static || false;
  var id = props.id;
  var className = props.className;
  var ariaLabel = props['aria-label'];
  var style = props.style;
  var children = props.children;

  var autoId = React.useId();
  var titleId = title != null ? (id || autoId) + '-title' : undefined;
  var innerRef = React.useRef(null);
  // Set immediately before any close() this component performs. The native
  // close event is queued, so the handler below is the next thing to read it.
  var selfClosing = React.useRef(false);

  var setRef = React.useCallback(
    function (node) {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );

  React.useEffect(
    function () {
      var el = innerRef.current;
      if (!el) return;
      if (open && !el.open && el.isConnected) {
        el.showModal();
        // React's autoFocus cannot do this: it fires at mount, before the
        // dialog opens, and React never writes the attribute client-side.
        // data-autofocus is the adapter's hook — without it the browser
        // takes the first focusable, which on a destructive dialog is the
        // destructive action.
        var target = el.querySelector('[data-autofocus]');
        if (target) target.focus();
      } else if (!open && el.open) {
        selfClosing.current = true;
        el.close();
      }
    },
    [open]
  );

  React.useEffect(
    function () {
      var el = innerRef.current;
      if (!el || !onClose) return;
      function handleClose() {
        // A close this component asked for is not news to the consumer — it
        // already moved the state. Reporting it would double-fire onClose and,
        // under StrictMode's double-invoke, drive `open` back to false on mount.
        if (selfClosing.current) {
          selfClosing.current = false;
          return;
        }
        onClose();
      }
      el.addEventListener('close', handleClose);
      return function () {
        el.removeEventListener('close', handleClose);
      };
    },
    [onClose]
  );

  React.useEffect(
    function () {
      var el = innerRef.current;
      if (!el || !onHide) return;
      el.addEventListener('drawer-hide', onHide);
      return function () {
        el.removeEventListener('drawer-hide', onHide);
      };
    },
    [onHide]
  );

  // Close before unmount — from a LAYOUT effect. A passive cleanup runs
  // after React has detached the ref and removed the node, so it reads null
  // and closes nothing, and the dialog's contents leave the document without
  // the browser ever restoring focus. Verified in Chromium: passive strands
  // focus on <body>, layout returns it to the trigger.
  React.useLayoutEffect(function () {
    var el = innerRef.current;
    return function () {
      if (el && el.open) {
        selfClosing.current = true;
        el.close();
      }
    };
  }, []);

  React.useEffect(function () {
    if (typeof window !== 'undefined' && typeof window.bdRequestClose !== 'function') {
      warnOnce(
        'Sheet: dialog.js is not loaded — the close button, backdrop dismissal and drag handle will not respond. Load the module (see cms/react.md).'
      );
    }
  }, []);

  if (title == null && !ariaLabel) {
    warnOnce('Sheet: provide `title` or `aria-label` — a drawer must be named.');
  }

  // --drawer-size is the documented per-instance knob; a custom property
  // on the element is how the contract itself parameterises it.
  var mergedStyle = style;
  if (size != null) {
    mergedStyle = { '--drawer-size': size };
    if (style) {
      var styleKeys = Object.keys(style);
      for (var k = 0; k < styleKeys.length; k++) mergedStyle[styleKeys[k]] = style[styleKeys[k]];
    }
  }

  var drawerProps = {
    ref: setRef,
    id: id,
    className: cx('drawer', className),
    'data-placement': placement,
    'aria-labelledby': titleId,
    'aria-label': title == null ? ariaLabel : undefined,
    style: mergedStyle,
  };
  if (isStatic) drawerProps['data-static'] = '';

  var header = null;
  if (title != null) {
    var closeBtn = closeButton('data-drawer-close');
    header = h(
      'div',
      { className: 'drawer-header' },
      h('h' + headingLevel, { className: 'drawer-title', id: titleId }, title),
      headerActions != null
        ? h('div', { className: 'drawer-header-actions' }, headerActions, closeBtn)
        : closeBtn
    );
  }

  return h(
    'dialog',
    drawerProps,
    handle ? h('div', { className: 'drawer-handle', 'aria-hidden': 'true' }) : null,
    header,
    h('div', { className: 'drawer-body' }, children),
    footer != null ? h('div', { className: 'drawer-footer' }, footer) : null
  );
});

// The component is the Drawer (cms/drawer.md, `.drawer`, `drawer-hide`);
// `Sheet` is the app-facing name for its most common shape. Both point at
// the same component so either doc leads somewhere.
export { Sheet as Drawer };
