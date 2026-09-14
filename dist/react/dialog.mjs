'use client';
/* @bydefaultstudio/design-system v4.8.0 */
/**
 * <Dialog> — React adapter over the Dialog markup contract (cms/dialog.md).
 *
 * Renders the documented markup exactly; behaviour beyond the native
 * <dialog> element (backdrop light-dismiss, the close-button hook, the
 * dialog-hide guard) comes from dialog.js, which is delegation-based and
 * needs no re-initialisation under React.
 *
 * React owns visibility through the `open` prop; every user-driven close
 * (Escape, backdrop, close button) surfaces as `onClose` so state can
 * follow. Closing by setting `open` to false is a programmatic close and
 * deliberately bypasses the dialog-hide guard — React already decided.
 * The dialog also closes before unmounting, per cms/react.md.
 */
import * as React from 'react';
import { cx, warnOnce, closeButton } from './internal.mjs';

var h = React.createElement;

export var Dialog = React.forwardRef(function Dialog(props, forwardedRef) {
  var open = props.open || false;
  var onClose = props.onClose;
  var onHide = props.onHide;
  var title = props.title;
  var footer = props.footer;
  var headingLevel = props.headingLevel || 2;
  var isStatic = props.static || false;
  var id = props.id;
  var className = props.className;
  var ariaLabel = props['aria-label'];
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

  // Visibility follows the prop. showModal() throws if already open and
  // close() on a closed dialog is a no-op, so both sides are guarded.
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

  // Every close path ends in the native `close` event — module-driven,
  // Escape, or programmatic — so one listener keeps React state honest.
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

  // The cancellable guard from dialog.js, exposed as a plain prop.
  React.useEffect(
    function () {
      var el = innerRef.current;
      if (!el || !onHide) return;
      el.addEventListener('dialog-hide', onHide);
      return function () {
        el.removeEventListener('dialog-hide', onHide);
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

  // The close button and backdrop dismissal are dialog.js behaviour; say
  // so once rather than shipping a dead control silently.
  React.useEffect(function () {
    if (typeof window !== 'undefined' && typeof window.bdRequestClose !== 'function') {
      warnOnce(
        'Dialog: dialog.js is not loaded — the close button and backdrop dismissal will not respond. Load the module (see cms/react.md).'
      );
    }
  }, []);

  if (title == null && !ariaLabel) {
    warnOnce('Dialog: provide `title` or `aria-label` — a dialog must be named.');
  }

  var dialogProps = {
    ref: setRef,
    id: id,
    className: cx('dialog', className),
    'aria-labelledby': titleId,
    'aria-label': title == null ? ariaLabel : undefined,
  };
  if (isStatic) dialogProps['data-static'] = '';

  return h(
    'dialog',
    dialogProps,
    title != null
      ? h(
          'div',
          { className: 'dialog-header' },
          h('h' + headingLevel, { className: 'dialog-title', id: titleId }, title),
          closeButton('data-dialog-close')
        )
      : null,
    h('div', { className: 'dialog-body' }, children),
    footer != null ? h('div', { className: 'dialog-footer' }, footer) : null
  );
});
