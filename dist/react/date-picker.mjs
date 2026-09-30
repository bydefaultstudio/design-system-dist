'use client';
/* @bydefaultstudio/design-system v5.1.0 */
/**
 * <DatePicker> — React adapter over the Date Picker markup contract
 * (cms/date-picker.md).
 *
 * Renders the root, the field(s) with their native <input type="date">,
 * the calendar trigger and the empty panel; date-picker.js builds the grid
 * and writes the inputs, and dropdown.js opens and closes the panel. The
 * inputs are uncontrolled (`defaultValue`, or `defaultFrom` and `defaultTo`
 * in range mode): the module owns the value afterwards and a React-owned
 * value would fight it. `date-picker-change` surfaces as `onChange(detail)`.
 *
 * Mode, month count and the disabled rules (`min`, `max`, `disabledDates`,
 * `disabledDays`) are read once at bind, so the adapter keys itself on all
 * of them — changing any remounts a fresh block that then self-registers
 * (the re-key rule from cms/react.md, handled for you). A remount re-seeds
 * the inputs from the defaults, so change the rules before the reader
 * types, not after.
 *
 * The two nav-icon templates render inside the root, so every instance
 * carries its own glyphs and the host page needs none.
 */
import * as React from 'react';
import { cx, warnOnce, calendarIcon, chevronLeftIconHtml, chevronRightIconHtml } from './internal.mjs';

var h = React.createElement;

function trigger(label) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dropdown-trigger',
      'aria-label': label,
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    },
    calendarIcon()
  );
}

function field(props) {
  return h(
    'div',
    { className: 'form-group' },
    h('label', { htmlFor: props.id }, props.label),
    h(
      'div',
      { className: 'field' },
      h('input', {
        type: 'date',
        id: props.id,
        name: props.name,
        defaultValue: props.defaultValue,
        min: props.min,
        max: props.max,
        disabled: props.disabled || undefined,
        required: props.required || undefined,
      }),
      props.trigger
    )
  );
}

export function DatePicker(props) {
  var mode = props.mode === 'range' ? 'range' : 'single';
  var months = props.months === 2 ? 2 : 1;
  var label = props.label;
  var fromLabel = props.fromLabel || label;
  var toLabel = props.toLabel;
  var name = props.name;
  var defaultValue = props.defaultValue;
  var defaultFrom = props.defaultFrom;
  var defaultTo = props.defaultTo;
  var min = props.min;
  var max = props.max;
  var disabledDates = props.disabledDates;
  var disabledDays = props.disabledDays;
  var placement = props.placement;
  var disabled = props.disabled;
  var required = props.required;
  var onChange = props.onChange;
  var id = props.id;
  var className = props.className;

  var autoId = React.useId();
  var baseId = id || autoId;
  var ref = React.useRef(null);
  // Everything the module reads once at bind. A change remounts the root.
  var bindKey = [
    mode,
    months,
    min || '',
    max || '',
    (disabledDates || []).join(' '),
    (disabledDays || []).join(' '),
  ].join('|');
  var seedKey = bindKey + '|' + [defaultValue, defaultFrom, defaultTo].join('|');
  var seeded = React.useRef(seedKey);

  // A new bindKey remounts and genuinely re-seeds; only a seed change on its
  // own goes nowhere
  if (seeded.current !== seedKey) {
    if (seeded.current.split('|').slice(0, 6).join('|') === bindKey) {
      warnOnce(
        'DatePicker: `defaultValue`, `defaultFrom` and `defaultTo` seed the first render only — date-picker.js owns the inputs afterwards, and changing them now rewrites nothing the reader has typed. Set the input value and dispatch `change` on it, or remount with a new key.'
      );
    }
    seeded.current = seedKey;
  }
  if (mode === 'single' && !label) {
    warnOnce('DatePicker: provide `label` — the native input needs a visible label.');
  }
  if (mode === 'range' && !(fromLabel && toLabel)) {
    warnOnce('DatePicker: a range needs `fromLabel` and `toLabel` — each native input carries its own visible label.');
  }
  if (mode === 'single' && (defaultFrom !== undefined || defaultTo !== undefined)) {
    warnOnce('DatePicker: `defaultFrom` and `defaultTo` apply to `mode="range"` — a single picker seeds from `defaultValue`.');
  }

  React.useEffect(
    function () {
      var el = ref.current;
      if (!el) return;
      // The module binds on load and on bd:after-nav; a picker that arrives
      // between those moments registers itself here. The bind guard absorbs
      // duplicates.
      if (typeof window !== 'undefined') {
        if (typeof window.initDatePicker === 'function') {
          if (!el.dataset.datePickerBound) window.initDatePicker(el);
        } else {
          warnOnce(
            'DatePicker: date-picker.js is not loaded — the calendar will not open, though the native input still works. Load the module and dropdown.js (see cms/react.md).'
          );
        }
      }
      if (!onChange) return;
      function handleChange(event) {
        // A nested picker's event bubbles through; only this root's counts
        if (event.target !== el) return;
        onChange(event.detail);
      }
      el.addEventListener('date-picker-change', handleChange);
      return function () {
        el.removeEventListener('date-picker-change', handleChange);
      };
    },
    [bindKey, onChange]
  );

  var rootProps = {
    // Mode, months and the rules are read once at bind (cms/date-picker.md);
    // a new shape must be a new block, so the key remounts it.
    key: bindKey,
    ref: ref,
    className: cx('dropdown', 'date-picker', className),
  };
  if (mode === 'range') rootProps['data-mode'] = 'range';
  if (months === 2) rootProps['data-months'] = '2';
  if (disabledDays && disabledDays.length) rootProps['data-disabled-days'] = disabledDays.join(' ');
  if (disabledDates && disabledDates.length) rootProps['data-disabled-dates'] = disabledDates.join(' ');
  if (placement) rootProps['data-placement'] = placement;

  var templates = [
    h('template', { key: 'prev', 'data-date-picker-icon': 'prev', dangerouslySetInnerHTML: { __html: chevronLeftIconHtml() } }),
    h('template', { key: 'next', 'data-date-picker-icon': 'next', dangerouslySetInnerHTML: { __html: chevronRightIconHtml() } }),
  ];
  var panel = h('div', { key: 'panel', className: 'dropdown-menu date-picker-panel' });

  if (mode === 'range') {
    return h(
      'div',
      rootProps,
      templates,
      h(field, {
        key: 'from',
        id: baseId + '-from',
        name: props.fromName || (name ? name + '-from' : undefined),
        label: fromLabel,
        defaultValue: defaultFrom,
        min: min,
        max: max,
        disabled: disabled,
        required: required,
      }),
      h(field, {
        key: 'to',
        id: baseId + '-to',
        name: props.toName || (name ? name + '-to' : undefined),
        label: toLabel,
        defaultValue: defaultTo,
        min: min,
        max: max,
        disabled: disabled,
        required: required,
        trigger: trigger('Choose dates'),
      }),
      panel
    );
  }

  return h(
    'div',
    rootProps,
    templates,
    h(field, {
      key: 'single',
      id: baseId,
      name: name,
      label: label,
      defaultValue: defaultValue,
      min: min,
      max: max,
      disabled: disabled,
      required: required,
      trigger: trigger('Choose date'),
    }),
    panel
  );
}
