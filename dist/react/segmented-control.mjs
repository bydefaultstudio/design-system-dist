'use client';
/* @bydefaultstudio/design-system v4.7.0 */
/**
 * <SegmentedControl> — React adapter over both segmented contracts
 * (cms/form.md): the flat button group and the thumb variant's
 * radio-backed markup, switched by `variant="thumb"`.
 *
 * The flat form has no design-system module — the contract says its
 * is-active / aria-pressed pair is the consumer's script to keep in step —
 * so this adapter owns that state natively: controlled through `value` +
 * `onChange`, or uncontrolled through `defaultValue`. The thumb form is
 * native radios and needs no script at all; the adapter just renders the
 * contract and lets the browser carry the radiogroup.
 *
 * One value API across both forms, so switching variant is one prop.
 */
import * as React from 'react';
import { cx, warnOnce } from './internal.mjs';

var h = React.createElement;

export function SegmentedControl(props) {
  var variant = props.variant;
  var label = props.label;
  var options = (props.options || []).filter(Boolean);
  var value = props.value;
  var defaultValue = props.defaultValue;
  var onChange = props.onChange;
  var name = props.name;
  var id = props.id;
  var className = props.className;

  var autoId = React.useId();
  var controlled = value !== undefined;

  if (!label) {
    warnOnce('SegmentedControl: provide `label` — the group needs an aria-label of its own.');
  }
  var wasControlled = React.useRef(controlled);
  if (wasControlled.current !== controlled) {
    warnOnce(
      'SegmentedControl: `value` switched between defined and undefined, flipping the control between controlled and uncontrolled. Pass a value from the first render (use `defaultValue` for an uncontrolled control), or the DOM and React can disagree about what is selected.'
    );
    wasControlled.current = controlled;
  }
  var seenValues = {};
  for (var vi = 0; vi < options.length; vi++) {
    if (seenValues[options[vi].value]) {
      warnOnce('SegmentedControl: two options share the value "' + options[vi].value + '" — they collide as React keys, and in the thumb variant as radios sharing a name and a value.');
      break;
    }
    seenValues[options[vi].value] = true;
  }
  for (var oi = 0; oi < options.length; oi++) {
    if (options[oi].icon && !options[oi].label) {
      warnOnce('SegmentedControl: an icon option needs `label` — it becomes the segment\'s aria-label, and without it the button has no accessible name.');
      break;
    }
  }
  var state = React.useState(defaultValue);
  var internal = state[0];
  var setInternal = state[1];
  var selected = controlled ? value : internal;

  function select(next) {
    if (!controlled) setInternal(next);
    if (onChange) onChange(next);
  }

  if (variant === 'thumb') {
    if (options.length < 2 || options.length > 5) {
      warnOnce(
        'SegmentedControl: the thumb variant supports two to five segments — a sixth renders flat by design (cms/form.md). Use the flat form or a dropdown.'
      );
    }
    var groupName = name || autoId + '-segmented';
    return h(
      'div',
      {
        id: id,
        className: cx('segmented-control', className),
        'data-variant': 'thumb',
        role: 'radiogroup',
        'aria-label': label,
      },
      options.map(function (opt) {
        var inputProps = {
          type: 'radio',
          name: groupName,
          value: opt.value,
          disabled: opt.disabled || undefined,
        };
        if (controlled) {
          inputProps.checked = selected === opt.value;
          inputProps.onChange = function () {
            select(opt.value);
          };
        } else {
          inputProps.defaultChecked = defaultValue === opt.value;
          if (onChange) {
            inputProps.onChange = function () {
              select(opt.value);
            };
          }
        }
        return h(
          'label',
          { key: opt.value, className: 'segmented-control-option' },
          h('input', inputProps),
          h('span', null, opt.label)
        );
      })
    );
  }

  return h(
    'div',
    { id: id, className: cx('segmented-control', className), role: 'group', 'aria-label': label },
    options.map(function (opt) {
      var active = selected === opt.value;
      return h(
        'button',
        {
          key: opt.value,
          className: cx('segmented-control-btn', opt.icon && 'is-icon', active && 'is-active'),
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
          'aria-label': opt.icon ? opt.label : undefined,
          disabled: opt.disabled || undefined,
          onClick: function () {
            select(opt.value);
          },
        },
        opt.icon || opt.label
      );
    })
  );
}
