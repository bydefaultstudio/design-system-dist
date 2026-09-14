'use client';
/* @bydefaultstudio/design-system v4.8.0 */
/**
 * <Tabs> — React adapter over the Tabs markup contract (cms/tabs.md).
 *
 * Uncontrolled by design: tabs.js owns switching (click activation,
 * roving arrow-key focus, is-active / aria-selected / is-hidden), and its
 * class toggles survive React re-renders because the rendered props never
 * change. A controlled tab set would fight the module for the same
 * attributes — if the app must own the active tab, drive it with app
 * state and plain buttons instead.
 *
 * `defaultActive` picks the initial tab; `onChange` reports activations
 * (every activation is a click per the contract, so a click listener
 * catches keyboard activation too).
 */
import * as React from 'react';
import { cx, warnOnce } from './internal.mjs';

var h = React.createElement;

export function Tabs(props) {
  var label = props.label;
  var items = (props.items || []).filter(Boolean);
  var defaultActive = props.defaultActive || 0;
  var onChange = props.onChange;
  var id = props.id;
  var className = props.className;

  var autoId = React.useId();
  var baseId = id || autoId;
  var listRef = React.useRef(null);
  var seededActive = React.useRef(defaultActive);

  if (seededActive.current !== defaultActive) {
    warnOnce(
      'Tabs: `defaultActive` seeds the first render only — tabs.js owns the active tab afterwards, and changing it now fights the module. Drive a controlled tab set with app state and plain buttons instead.'
    );
  }

  if (!label) {
    warnOnce('Tabs: provide `label` — the tablist needs an aria-label naming the section.');
  }
  if (items.length > 0 && !(defaultActive >= 0 && defaultActive < items.length)) {
    warnOnce(
      'Tabs: `defaultActive` is outside the item range — no tab renders active and every panel renders hidden, so the content area is blank until someone clicks.'
    );
  }
  var seenIds = {};
  for (var di = 0; di < items.length; di++) {
    var candidate = items[di] && items[di].id;
    if (!candidate) continue;
    if (seenIds[candidate]) {
      warnOnce('Tabs: two items share the id "' + candidate + '" — that duplicates DOM ids and makes aria-controls ambiguous.');
      break;
    }
    seenIds[candidate] = true;
  }

  // tabs.js is per-element: it binds what exists when it runs. A tablist
  // mounted later (streamed, conditional) self-registers here through the
  // module's public init, handing it this element and nothing else; the bind
  // guard makes a duplicate call a no-op.
  React.useEffect(function () {
    var el = listRef.current;
    if (!el) return;
    if (typeof window !== 'undefined') {
      if (typeof window.initTabs === 'function') {
        if (!el.dataset.tabsBound) window.initTabs(el);
      } else {
        warnOnce('Tabs: tabs.js is not loaded — the tabs will not switch. Load the module (see cms/react.md).');
      }
    }
  }, []);

  function tabId(item, i) {
    return item.id || baseId + '-tab-' + (i + 1);
  }
  function panelId(item, i) {
    if (item.panelId) return item.panelId;
    return item.id ? item.id + '-panel' : baseId + '-panel-' + (i + 1);
  }

  return h(
    React.Fragment,
    null,
    h(
      'div',
      { ref: listRef, id: id, className: cx('tabs', className), role: 'tablist', 'aria-label': label },
      items.map(function (item, i) {
        return h(
          'button',
          {
            key: tabId(item, i),
            className: i === defaultActive ? 'tab is-active' : 'tab',
            type: 'button',
            role: 'tab',
            'aria-selected': i === defaultActive ? 'true' : 'false',
            'aria-controls': panelId(item, i),
            id: tabId(item, i),
            onClick: onChange
              ? function () {
                  onChange(i, item);
                }
              : undefined,
          },
          item.label
        );
      })
    ),
    items.map(function (item, i) {
      return h(
        'div',
        {
          key: panelId(item, i),
          className: i === defaultActive ? 'tab-panel' : 'tab-panel is-hidden',
          id: panelId(item, i),
          role: 'tabpanel',
          'aria-labelledby': tabId(item, i),
        },
        item.content
      );
    })
  );
}
