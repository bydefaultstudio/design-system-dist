'use client';
/* @bydefaultstudio/design-system v4.8.0 */
/**
 * <ChipGroup> — React adapter over the chip contract (cms/chip.md).
 *
 * A one-of-N control whose options wrap. Native radios inside labels, so the
 * browser carries radiogroup semantics, roving arrow keys and the posted
 * value — the adapter renders the contract and gets out of the way.
 *
 * `clearable` is the one behaviour that needs the module: native radios cannot
 * be unchecked by clicking the checked one. The adapter marks the group
 * [data-clearable] and self-registers with chip.js, then listens for the
 * change the module fires so React learns the answer was cleared. A group
 * without `clearable` needs no script at all.
 *
 * Controlled through `value` + `onChange`, or uncontrolled through
 * `defaultValue`. An uncontrolled group with `clearable` still needs onChange
 * to hear about a clear, exactly as it does to hear about a selection.
 */
import * as React from 'react';
import { cx, warnOnce } from './internal.mjs';

var h = React.createElement;

export function ChipGroup(props) {
  var label = props.label;
  var labelledBy = props.labelledBy;
  var options = (props.options || []).filter(Boolean);
  var value = props.value;
  var defaultValue = props.defaultValue;
  var onChange = props.onChange;
  var clearable = props.clearable;
  var layout = props.layout;
  var error = props.error;
  var describedBy = props['aria-describedby'];
  var name = props.name;
  var id = props.id;
  var className = props.className;

  var autoId = React.useId();
  var groupRef = React.useRef(null);
  var controlled = value !== undefined;

  if (!label && !labelledBy) {
    warnOnce(
      'ChipGroup: provide `label`, or `labelledBy` pointing at the question that names this group — a radiogroup with no accessible name is announced as an unlabelled set of options.'
    );
  }

  var wasControlled = React.useRef(controlled);
  if (wasControlled.current !== controlled) {
    warnOnce(
      'ChipGroup: `value` switched between defined and undefined, flipping the group between controlled and uncontrolled. Pass a value from the first render (use `defaultValue` for an uncontrolled group), or the DOM and React can disagree about what is selected.'
    );
    wasControlled.current = controlled;
  }

  // Object.create(null), not {} — a bare object inherits Object.prototype,
  // so an option valued 'toString', 'constructor' or 'valueOf' would report
  // a duplicate on its first appearance.
  var seen = Object.create(null);
  for (var i = 0; i < options.length; i++) {
    if (seen[options[i].value]) {
      warnOnce(
        'ChipGroup: two options share the value "' + options[i].value + '" — they collide as React keys, and as radios sharing a name and a value.'
      );
      break;
    }
    seen[options[i].value] = true;
  }

  var state = React.useState(defaultValue);
  var internal = state[0];
  var setInternal = state[1];
  var selected = controlled ? value : internal;

  function select(next) {
    if (!controlled) setInternal(next);
    if (onChange) onChange(next);
  }

  // Only a clearable group needs the module. Late-mounted groups self-register
  // here through the module's public init, handed this element and nothing
  // else; the bind guard makes a duplicate call a no-op.
  React.useEffect(
    function () {
      if (!clearable) return;
      var el = groupRef.current;
      if (!el) return;
      if (typeof window !== 'undefined') {
        if (typeof window.initChip === 'function') {
          if (!el.dataset.chipBound) window.initChip(el);
        } else {
          warnOnce(
            'ChipGroup: chip.js is not loaded — `clearable` will not clear. Load the module (see cms/react.md), or drop the prop.'
          );
        }
      }

      // The module unchecks the radio directly and fires change on it. React
      // never saw a user event, so without this the DOM would sit cleared
      // while React still believed a value was selected.
      function onCleared(e) {
        var input = e.target;
        if (!input || input.type !== 'radio' || input.checked) return;
        select(undefined);
      }

      el.addEventListener('change', onCleared);
      return function () {
        el.removeEventListener('change', onCleared);
      };
    },
    [clearable, controlled, onChange]
  );

  // chip.js unchecks the radio directly, and React's event system never sees
  // it — for radios React listens on click, not on a dispatched change — so
  // React's record of the DOM drifts from the DOM itself. If a controlled
  // parent then declines the cleared value (`setValue(v ?? prev)`, or a
  // required-string form field), React re-renders with the same props it last
  // wrote, skips the DOM write as a no-op, and the group sits visibly empty
  // while React and any submit still say selected — with no later render able
  // to correct it. Reassert the DOM against `selected` after every render.
  React.useEffect(function () {
    if (!controlled) return;
    var el = groupRef.current;
    if (!el) return;
    var inputs = el.querySelectorAll('input[type="radio"]');
    for (var n = 0; n < inputs.length; n++) {
      var want = inputs[n].value === selected;
      if (inputs[n].checked !== want) inputs[n].checked = want;
    }
  });

  var groupName = name || autoId + '-chip';

  return h(
    'div',
    {
      id: id,
      ref: groupRef,
      className: cx('chip-group', error && 'is-error', className),
      'data-layout': layout === 'scale' ? 'scale' : undefined,
      'data-clearable': clearable ? '' : undefined,
      role: 'radiogroup',
      'aria-label': labelledBy ? undefined : label,
      'aria-labelledby': labelledBy,
      // The class paints the border; the attribute is what assistive tech
      // reads. One without the other is a half-reported error — the rule is
      // stated at cms/login.md and cell-input already follows it.
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy,
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
        { key: opt.value, className: 'chip' },
        h('input', inputProps),
        h('span', null, opt.label)
      );
    })
  );
}
