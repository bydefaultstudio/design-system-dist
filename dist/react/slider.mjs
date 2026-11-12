'use client';
/* @bydefaultstudio/design-system v8.1.0 */
/**
 * <Slider> — React adapter over the Slider markup contract (cms/slider.md).
 *
 * The control is a native range input, so React can own its value: pass
 * `value` + `onChange` for a controlled slider, or `defaultValue` for an
 * uncontrolled one. slider.js paints the fill, the readout and the stops
 * from the input; React writes `value` without firing an input event, so the
 * adapter calls window.syncSlider after every render, and once more after a
 * change the parent did not take (a clamp or a rejected value leaves React
 * with nothing to re-render). First paint is right without the module: the
 * readout and --slider-value are rendered into the markup.
 *
 * With `values`, the input works in indexes (min 0, step 1): `value`,
 * `defaultValue` and `onChange` are indexes, and the readout shows
 * values[index].
 */
import * as React from 'react';
import { cx, warnOnce } from './internal.mjs';

var h = React.createElement;

// The label of the tick at `fraction`, or '' (slider.js getTickLabel): the
// scale spaces its labels evenly, so label i sits at i / (n - 1).
function tickLabelAt(labels, fraction) {
  if (!labels || labels.length < 2) return '';
  for (var i = 0; i < labels.length; i++) {
    if (Math.abs(i / (labels.length - 1) - fraction) < 1e-6) {
      var label = labels[i];
      return typeof label === 'string' || typeof label === 'number' ? String(label).trim() : '';
    }
  }
  return '';
}

// A label that only restates the value adds nothing (slider.js restatesValue).
function restatesValue(label, shown) {
  if (label === String(shown)) return true;
  var a = Number(label);
  var b = Number(shown);
  return label !== '' && isFinite(a) && isFinite(b) && a === b;
}

// What the input says (slider.js getSpokenText).
function spokenText(labels, label, shown, readout, min, max, step, shaped) {
  if (label && !restatesValue(label, shown)) {
    var span = max - min;
    var reachable = step > 0 && span > 0 ? Math.floor(span / step + 1e-6) + 1 : 0;
    return !shaped && reachable === labels.length ? label : label + ', ' + readout;
  }
  return shaped || (labels && labels.length >= 2) ? readout : undefined;
}

function toFraction(value, min, max) {
  if (!(max > min) || typeof value !== 'number' || isNaN(value)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function Slider(props) {
  var label = props.label;
  var values = props.values;
  var min = values ? 0 : props.min === undefined ? 0 : props.min;
  var max = values ? values.length - 1 : props.max === undefined ? 100 : props.max;
  var step = values ? 1 : props.step === undefined ? 1 : props.step;
  var value = props.value;
  var defaultValue = props.defaultValue === undefined ? min : props.defaultValue;
  var onChange = props.onChange;
  var unit = props.unit || '';
  var variant = props.variant; // 'pill' | 'square' | 'needle'; unset: the house style
  var layout = props.layout; // 'default' | 'compact'
  var stops = props.stops; // true (one per step) | a number of 2 or more
  var ends = props.ends; // [start, end] end labels
  var tickLabels = props.tickLabels; // one label per stop
  var disabled = props.disabled;
  var name = props.name;
  var describedBy = props.describedBy;
  var className = props.className;

  var autoId = React.useId();
  var id = props.id || 'slider-' + autoId.replace(/[^a-zA-Z0-9_-]/g, '');
  var inputRef = React.useRef(null);
  var controlled = value !== undefined;
  var current = controlled ? value : defaultValue;

  if (!label) {
    warnOnce('Slider: provide `label` — the input is named by its visible label (cms/slider.md).');
  }
  if (controlled && !onChange) {
    warnOnce('Slider: `value` without `onChange` makes a slider that cannot move. Pass `onChange`, or use `defaultValue`.');
  }
  if (layout === 'compact' && stops) {
    warnOnce('Slider: Compact with stops crowds the words on the track — use the default layout for stepped values (cms/slider.md).');
  }
  if (tickLabels && !stops) {
    warnOnce('Slider: `tickLabels` name the stops — turn `stops` on, or use `ends` for a free scale.');
  }

  React.useEffect(function () {
    var el = inputRef.current;
    if (!el || typeof window === 'undefined') return;
    var slider = el.closest('.slider');
    if (typeof window.initSlider === 'function') {
      if (slider && !slider.dataset.sliderBound) window.initSlider(slider);
      if (typeof window.syncSlider === 'function') window.syncSlider(el);
    } else {
      warnOnce('Slider: slider.js is not loaded — the fill and readout will not follow the thumb. Load the module (see cms/react.md).');
    }
  });

  function handleChange(event) {
    var el = event.target;
    if (onChange) onChange(parseFloat(el.value));
    if (!controlled || typeof window === 'undefined') return;
    // React restores a controlled value it was not given after this handler;
    // if the parent kept the old value there is no render to resync from.
    window.requestAnimationFrame(function () {
      if (typeof window.syncSlider === 'function') window.syncSlider(el);
    });
  }

  var stopsAttr;
  if (stops === true) stopsAttr = '';
  else if (typeof stops === 'number' && stops >= 2) stopsAttr = String(stops);

  var index = Math.round(current - min);
  var shown = values ? values[Math.min(values.length - 1, Math.max(0, index))] : current;
  var readout = String(shown) + unit;

  // The scale is aria-hidden, so a tick's label that says more than the
  // value is spoken instead of it, as slider.js does after every change.
  var tickLabel = tickLabelAt(tickLabels, toFraction(current, min, max));
  var spoken = spokenText(tickLabels, tickLabel, shown, readout, min, max, step, Boolean(unit || values));

  // End labels are the only statement of what each end means, and the scale
  // is aria-hidden, so the input is described by a hidden sentence too.
  var endsId = ends && ends.length === 2 ? id + '-ends' : null;
  var describedByAll = [describedBy, endsId].filter(Boolean).join(' ') || undefined;

  var inputProps = {
    ref: inputRef,
    className: 'slider-input',
    type: 'range',
    id: id,
    name: name,
    min: min,
    max: max,
    step: step,
    disabled: disabled,
    'aria-describedby': describedByAll,
    'aria-valuetext': spoken,
    // Marks the text as the slider's own, so slider.js keeps it in step.
    // This relies on spokenText and slider.js getSpokenText agreeing on
    // when there is nothing to say: if slider.js removed the mark while
    // React still rendered text, the input would read as the author's.
    'data-slider-valuetext': spoken ? 'true' : undefined,
    onChange: handleChange,
  };
  if (controlled) inputProps.value = value;
  else inputProps.defaultValue = defaultValue;

  var scale = null;
  if (tickLabels && tickLabels.length) {
    scale = h(
      'div',
      { className: 'slider-scale', 'data-variant': 'labels', 'aria-hidden': 'true' },
      tickLabels.map(function (text, i) { return h('span', { key: i }, text); })
    );
  } else if (endsId) {
    scale = h(
      'div',
      { className: 'slider-scale', 'aria-hidden': 'true' },
      h('span', { className: 'slider-end' }, ends[0]),
      h('span', { className: 'slider-ticks' }),
      h('span', { className: 'slider-end' }, ends[1])
    );
  }

  var startValue = values ? values[0] : min;
  var endValue = values ? values[values.length - 1] : max;

  return h(
    'div',
    {
      className: cx('slider', className),
      'data-variant': variant || undefined,
      'data-layout': layout === 'compact' ? 'compact' : undefined,
      'data-stops': stopsAttr,
      'data-unit': unit || undefined,
      'data-values': values ? values.join(',') : undefined,
      style: { '--slider-value': String(toFraction(current, min, max)) },
    },
    h(
      'div',
      { className: 'slider-header' },
      h('label', { className: 'slider-label', htmlFor: id }, label),
      h('span', { className: 'slider-value' }, readout)
    ),
    h('div', { className: 'slider-control' }, h('input', inputProps)),
    scale,
    endsId
      ? h('span', { className: 'visually-hidden', id: endsId }, ends[0] + ' at ' + startValue + unit + ', ' + ends[1] + ' at ' + endValue + unit)
      : null
  );
}
