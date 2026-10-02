/* @bydefaultstudio/design-system v6.0.0 */
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

function brandIcon(name, d) {
  return h(
    'div',
    { className: 'svg-icn', 'data-icon': name },
    h(
      'svg',
      { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
      h('path', { d: d, fill: 'currentColor' })
    )
  );
}

/** The calendar glyph on the Date Picker trigger (assets/images/svg-icons/calendar.svg). */
export function calendarIcon() {
  return brandIcon(
    'calendar',
    'M11.0184 14V12H13.0184V14H11.0184ZM7.01843 14V12H9.01843V14H7.01843ZM15.0184 14V12H17.0184V14H15.0184ZM11.0184 18V16H13.0184V18H11.0184ZM7.01843 18V16H9.01843V18H7.01843ZM15.0184 18V16H17.0184V18H15.0184ZM3.01843 22V4H5.01843C5.57072 4 6.01843 3.55228 6.01843 3V2H8.01843V3C8.01843 3.55228 8.46615 4 9.01843 4H15.0184C15.5707 4 16.0184 3.55228 16.0184 3V2H18.0184V3C18.0184 3.55228 18.4661 4 19.0184 4H21.0184V22H3.01843ZM5.01843 19C5.01843 19.5523 5.46615 20 6.01843 20H18.0184C18.5707 20 19.0184 19.5523 19.0184 19V11C19.0184 10.4477 18.5707 10 18.0184 10H6.01843C5.46615 10 5.01843 10.4477 5.01843 11V19ZM5.01843 7C5.01843 7.55228 5.46615 8 6.01843 8H18.0184C18.5707 8 19.0184 7.55228 19.0184 7C19.0184 6.44772 18.5707 6 18.0184 6H6.01843C5.46615 6 5.01843 6.44772 5.01843 7Z'
  );
}

/** The month-paging chevrons the Date Picker clones from its <template>s, as
 * HTML strings: a template's children have to land in its .content, which
 * innerHTML does and React children do not — hydration would then look for
 * children the parsed markup already moved. */
function brandIconHtml(name, d) {
  return (
    '<div class="svg-icn" data-icon="' + name + '">' +
    '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="' + d + '" fill="currentColor"></path></svg></div>'
  );
}

export function chevronLeftIconHtml() {
  return brandIconHtml(
    'chevron-left',
    'M7.6 12L13.6 6L15 7.4L11.8142 10.5858C11.0332 11.3668 11.0332 12.6332 11.8142 13.4142L15 16.6L13.6 18L7.6 12Z'
  );
}

export function chevronRightIconHtml() {
  return brandIconHtml(
    'chevron-right',
    'M16.4 12L10.4 18L9 16.6L12.1858 13.4142C12.9668 12.6332 12.9668 11.3668 12.1858 10.5858L9 7.4L10.4 6L16.4 12Z'
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
