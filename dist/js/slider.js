/* @bydefaultstudio/design-system v8.2.0 */
/**
 * Slider component — keeps the painted fill, the readout and the stops in
 * step with a native range input.
 *
 * Markup: .slider > .slider-header (label + span.slider-value) +
 * .slider-control > input.slider-input, with an optional .slider-scale.
 *
 * - The fill is painted in CSS from --slider-value (0 to 1), set here.
 * - .slider-value shows the value plus data-unit. With a unit or with
 *   data-values, the same text goes to aria-valuetext, so a screen reader
 *   hears "60%" or "512", not the raw number.
 * - data-values="128,256,512" maps an index range (min 0, step 1) to the
 *   values the readout shows: for presets that are not evenly spaced.
 * - data-stops draws one dot per value the thumb can land on. Empty, the
 *   count comes from min, max and step; a number of 2 or more sets it.
 * - A labelled scale (.slider-scale[data-variant="labels"]) is hidden from
 *   assistive tech, so when the thumb sits on a tick whose label says more
 *   than the value ("Medium" over 1), aria-valuetext takes the label. An
 *   aria-valuetext in the markup that this script did not write (no
 *   data-slider-valuetext) is the author's and is never changed.
 *
 * Code that changes input.value itself calls window.syncSlider(input)
 * afterwards: setting .value fires no event. A form's reset is picked up.
 *
 * @version 1.2.0
 */
(function () {
  const SELECTOR = '.slider';
  // More stops than this stop reading as steps and start reading as texture.
  const MAX_STOPS = 21;
  const EPSILON = 1e-6;

  //
  //------- Utility -------//
  //

  // The range the browser itself uses: a missing or unreadable min is 0, max
  // 100; "any" or a step of 0 or less means no fixed step.
  function readRange(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const step = parseFloat(input.step);
    const range = {
      min: isNaN(min) ? 0 : min,
      max: isNaN(max) ? 100 : max,
      step: input.step === 'any' ? null : (step > 0 ? step : 1),
    };
    if (range.max < range.min) range.max = range.min;
    return range;
  }

  function getFraction(input, range) {
    const value = parseFloat(input.value);
    if (!(range.max > range.min) || isNaN(value)) return 0;
    return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
  }

  function getValues(slider) {
    const attr = slider.dataset.values;
    return attr ? attr.split(',').map(function trimValue(v) { return v.trim(); }) : null;
  }

  // Where each stop sits on the thumb's path, 0 to 1. Empty data-stops follows
  // the input's own steps, so a step that does not divide the range stops at
  // the last value the thumb can reach, not at max.
  function getStopPositions(slider, range) {
    const attr = slider.dataset.stops;
    if (attr === undefined) return [];
    const span = range.max - range.min;
    const positions = [];
    if (attr.trim() === '') {
      if (!range.step || !(span > 0)) return [];
      const count = Math.floor(span / range.step + EPSILON) + 1;
      if (count < 2 || count > MAX_STOPS) return [];
      for (let i = 0; i < count; i++) positions.push((i * range.step) / span);
      return positions;
    }
    const count = parseInt(attr, 10);
    if (!(count >= 2) || count > MAX_STOPS) return [];
    for (let i = 0; i < count; i++) positions.push(i / (count - 1));
    return positions;
  }

  // The words under each tick of a labelled scale, or null without one.
  function getTickLabels(slider) {
    const scale = slider.querySelector('.slider-scale[data-variant="labels"]');
    if (!scale) return null;
    const labels = Array.from(scale.children).map(function readLabel(el) { return el.textContent.trim(); });
    return labels.length >= 2 ? labels : null;
  }

  // The label of the tick the thumb sits on, if it has one. The scale spaces
  // its labels evenly from end to end, so label i sits at i / (n - 1).
  function getTickLabel(labels, fraction) {
    if (!labels || labels.length < 2) return '';
    for (let i = 0; i < labels.length; i++) {
      if (Math.abs(i / (labels.length - 1) - fraction) < EPSILON) return labels[i];
    }
    return '';
  }

  // A label that only restates the value ("2" or "2.0" over 2) adds nothing.
  function restatesValue(label, shown) {
    if (label === String(shown)) return true;
    const a = Number(label);
    const b = Number(shown);
    return label !== '' && isFinite(a) && isFinite(b) && a === b;
  }

  // What the input says. On a labelled tick: the label alone when every
  // value the thumb can reach has one and nothing else shapes the readout
  // ("Medium"); otherwise the label and the readout ("Medium, 24 px"), so
  // the number a sighted reader sees is never lost. Off a tick, the readout
  // when a unit, presets or a labelled scale shape it; else nothing, and the
  // native value is read.
  function getSpokenText(labels, label, shown, text, range, shaped) {
    if (label && !restatesValue(label, shown)) {
      const span = range.max - range.min;
      const reachable = range.step && span > 0 ? Math.floor(span / range.step + EPSILON) + 1 : 0;
      return !shaped && reachable === labels.length ? label : label + ', ' + text;
    }
    return shaped || labels ? text : '';
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  //
  //------- Main -------//
  //

  function buildStops(slider, positions) {
    const control = slider.querySelector('.slider-control');
    if (!control) return;
    const existing = control.querySelector('.slider-stops');
    if (existing) existing.remove();
    if (!positions.length) return;

    const stops = document.createElement('span');
    stops.className = 'slider-stops';
    stops.setAttribute('aria-hidden', 'true');
    positions.forEach(function addStop(at) {
      const stop = document.createElement('span');
      stop.className = 'slider-stop';
      stop.style.setProperty('--slider-stop-at', String(at));
      stop.dataset.at = String(at);
      stops.appendChild(stop);
    });
    control.appendChild(stops);
  }

  function syncSlider(input) {
    const slider = input && input.closest(SELECTOR);
    if (!slider) return;

    const range = readRange(input);
    const fraction = getFraction(input, range);
    slider.style.setProperty('--slider-value', String(fraction));

    // Readout: the value, or the mapped preset, plus the unit.
    const values = getValues(slider);
    const unit = slider.dataset.unit || '';
    let shown = input.value;
    if (values) {
      const index = Math.round(parseFloat(input.value) - range.min);
      shown = values[Math.min(values.length - 1, Math.max(0, index))] || input.value;
    }
    const text = shown + unit;
    setText(slider.querySelector('.slider-value'), text);

    // Spoken text: the tick's label when it names more than the value, else
    // the readout when a unit or presets shape it. An aria-valuetext this
    // script did not write is the author's, and is left alone.
    const authored = input.hasAttribute('aria-valuetext') && !input.dataset.sliderValuetext;
    if (!authored) {
      const labels = getTickLabels(slider);
      const spoken = getSpokenText(labels, getTickLabel(labels, fraction), shown, text, range, Boolean(unit || values));
      if (spoken) {
        if (input.getAttribute('aria-valuetext') !== spoken) input.setAttribute('aria-valuetext', spoken);
        input.dataset.sliderValuetext = 'true';
      } else if (input.dataset.sliderValuetext) {
        // Nothing shapes the value any more: drop the text this script wrote.
        input.removeAttribute('aria-valuetext');
        delete input.dataset.sliderValuetext;
      }
    }

    const positions = getStopPositions(slider, range);
    // Stops: redrawn only when what they are drawn from has changed.
    const key = positions.join(',');
    if (slider.dataset.sliderStops !== key) {
      slider.dataset.sliderStops = key;
      buildStops(slider, positions);
    }
    slider.querySelectorAll('.slider-stop').forEach(function markStop(stop) {
      const at = parseFloat(stop.dataset.at);
      stop.classList.toggle('is-active', Math.abs(at - fraction) < EPSILON);
      stop.classList.toggle('is-filled', at < fraction - EPSILON);
    });
  }

  //
  //------- Event Listeners -------//
  //

  function handleInput(event) {
    syncSlider(event.currentTarget);
  }

  // A form's reset event fires before the values reset, so wait a frame.
  // One listener for the document's life, not one per slider.
  function handleFormReset(event) {
    const form = event.target;
    if (!form || !form.querySelectorAll) return;
    requestAnimationFrame(function resyncForm() {
      form.querySelectorAll('.slider .slider-input').forEach(syncSlider);
    });
  }

  //
  //------- Initialize -------//
  //

  function initSlider(scopeOrEl) {
    const root = scopeOrEl || document;
    let sliders = Array.from(root.querySelectorAll(SELECTOR));
    if (root.matches && root.matches(SELECTOR)) sliders = [root].concat(sliders);

    let bound = 0;
    sliders.forEach(function bindSlider(slider) {
      if (slider.dataset.sliderBound) return;
      const input = slider.querySelector('.slider-input');
      if (!input) return;
      slider.dataset.sliderBound = 'true';
      bound++;
      syncSlider(input);
      input.addEventListener('input', handleInput);
    });

    if (bound) console.log('[slider] v1.2.0 — init (' + bound + ')');
  }

  window.initSlider = initSlider;
  window.syncSlider = syncSlider;

  document.addEventListener('reset', handleFormReset);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function handleReady() { initSlider(); });
  } else {
    initSlider();
  }

  document.addEventListener('bd:after-nav', function handleAfterNav(event) {
    initSlider(event.detail && event.detail.container);
  });
})();
