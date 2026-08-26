/* @bydefaultstudio/design-system v4.7.0 */
/**
 * Shared internals for the React adapters — class joining, one-shot
 * warnings, and the inline icon markup the components reproduce from
 * their documented contracts. Not part of the public surface: import
 * from '@bydefaultstudio/design-system/react' instead.
 */
import * as React from 'react';

const h = React.createElement;

/** Join class names, skipping empties, without a dependency. */
export function cx() {
  var out = '';
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i]) out += (out ? ' ' : '') + arguments[i];
  }
  return out;
}

var warned = {};

/** Console-warn once per message per page — module-missing advisories fire
 * from effects, which re-run, and a repeating warning is noise.
 *
 * Browser only, deliberately. The map is module scope, so on a long-lived SSR
 * server the first render to hit a problem would swallow the warning for every
 * later request — "once per page" is only true where the module is reloaded
 * per page, and that is the client. */
export function warnOnce(message) {
  if (typeof window === 'undefined') return;
  if (warned[message]) return;
  warned[message] = true;
  if (typeof console !== 'undefined' && console.warn) console.warn(message);
}

/** The close glyph, exactly as the Dialog/Drawer/Toast contracts inline it. */
export function closeIcon() {
  return h(
    'div',
    { className: 'svg-icn', 'data-icon': 'close' },
    h(
      'svg',
      { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
      h('path', {
        d: 'M6.4 19L5 17.6L9.18579 13.4142C9.96684 12.6332 9.96684 11.3668 9.18579 10.5858L5 6.4L6.4 5L10.5858 9.18579C11.3668 9.96684 12.6332 9.96684 13.4142 9.18579L17.6 5L19 6.4L14.8142 10.5858C14.0332 11.3668 14.0332 12.6332 14.8142 13.4142L19 17.6L17.6 19L13.4142 14.8142C12.6332 14.0332 11.3668 14.0332 10.5858 14.8142L6.4 19Z',
        fill: 'currentColor',
      })
    )
  );
}

/** The star glyph from the Rating contract — bare SVG, no .svg-icn wrapper. */
export function starIcon() {
  return h(
    'svg',
    { viewBox: '0 0 24 24', fill: 'currentColor', width: '100%', height: '100%', 'aria-hidden': 'true' },
    h('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z' })
  );
}

/** The check glyph the Dropdown checkable-item contract inlines. */
export function checkIcon() {
  return h(
    'div',
    { className: 'svg-icn', 'data-icon': 'check' },
    h(
      'svg',
      { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
      h('path', { d: 'M9.55 17.6L4 12.05L5.4 10.65L9.55 14.8L18.6 5.75L20 7.15L9.55 17.6Z', fill: 'currentColor' })
    )
  );
}

/** The shared .close-btn role-class button (Button doc), as Dialog and
 * Drawer render it. `closeAttr` is the module hook: 'data-dialog-close'
 * or 'data-drawer-close'. */
export function closeButton(closeAttr) {
  var props = {
    className: 'button close-btn',
    type: 'button',
    'data-icon-only': '',
    'data-size': 'small',
    'aria-label': 'Close',
  };
  props[closeAttr] = '';
  return h('button', props, closeIcon());
}
