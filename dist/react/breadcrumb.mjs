'use client';
/* @bydefaultstudio/design-system v7.0.0 */
/**
 * <Breadcrumb> — React adapter over the Breadcrumb markup contract
 * (cms/breadcrumb.md).
 *
 * Renders the trail as the contract's list, current page last. A trail with
 * a middle crumb also renders the hidden overflow item, which breadcrumb.js
 * fills and reveals when the labels no longer fit — the module owns the
 * collapse, the way rating.js owns its stars. The nav is keyed on the trail,
 * so a new trail is a new node the module binds afresh rather than one it
 * has already measured.
 */
import * as React from 'react';
import { cx, warnOnce, ellipsisIcon } from './internal.mjs';

var h = React.createElement;

function separator() {
  return h('span', { className: 'breadcrumb-separator', 'aria-hidden': 'true' }, '/');
}

export function Breadcrumb(props) {
  var items = props.items || [];
  var label = props.label || 'Breadcrumb';
  var className = props.className;
  var ref = React.useRef(null);

  if (items.length < 2) {
    warnOnce('Breadcrumb: a trail needs at least two items — one that names only the current page links nowhere. Render nothing instead.');
  }

  var trailKey = items.map(function (item) { return item.label + '|' + (item.href || ''); }).join('/');

  React.useEffect(
    function () {
      var el = ref.current;
      if (!el || items.length < 3 || typeof window === 'undefined') return;
      if (typeof window.initBreadcrumb === 'function') {
        if (!el.dataset.breadcrumbBound) window.initBreadcrumb(el);
      } else {
        warnOnce('Breadcrumb: breadcrumb.js is not loaded — a long trail will clip instead of collapsing into the ⋯ menu. Load the module (see cms/react.md).');
      }
      if (typeof window.closeDropdown !== 'function') {
        warnOnce('Breadcrumb: dropdown.js is not loaded — the ⋯ trigger will show but never open. Load it alongside breadcrumb.js.');
      }
    },
    [trailKey]
  );

  var crumbs = items.map(function (item, i) {
    if (i === items.length - 1) {
      return h('li', { key: i, className: 'breadcrumb-item' }, h('span', { 'aria-current': 'page' }, item.label));
    }
    var crumb = item.href ? h('a', { href: item.href }, item.label) : h('span', null, item.label);
    return h('li', { key: i, className: 'breadcrumb-item' }, crumb, separator());
  });

  if (items.length > 2) {
    crumbs.splice(
      1,
      0,
      h(
        'li',
        { key: 'overflow', className: 'breadcrumb-item breadcrumb-overflow', hidden: true },
        h(
          'div',
          { className: 'dropdown' },
          h(
            'button',
            { className: 'dropdown-trigger', type: 'button', 'aria-expanded': 'false', 'aria-label': 'More levels' },
            ellipsisIcon()
          ),
          h('div', { className: 'dropdown-menu' })
        ),
        separator()
      )
    );
  }

  return h(
    'nav',
    { key: trailKey, ref: ref, className: cx('breadcrumb', className), 'aria-label': label },
    h('ol', { className: 'breadcrumb-list' }, crumbs)
  );
}
