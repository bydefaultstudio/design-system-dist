'use client';
/* @bydefaultstudio/design-system v4.7.0 */
/**
 * <Rating> — React adapter over the Rating markup contract (cms/rating.md).
 *
 * Two renders, matching the contract's two modes. Read-only is pure
 * markup: spans with hand-set is-filled, no module involved. Interactive
 * renders the star buttons and hands them to rating.js, which owns
 * hover preview, click and arrow-key selection, and data-value — so the
 * interactive form is uncontrolled (`defaultValue`), with the module's
 * `rating-change` event bridged to `onChange`. A React-owned value would
 * fight the module for data-value; for display of app state, use
 * `readOnly`.
 */
import * as React from 'react';
import { cx, warnOnce, starIcon } from './internal.mjs';

var h = React.createElement;

export function Rating(props) {
  var label = props.label;
  var readOnly = props.readOnly;
  var value = props.value;
  var defaultValue = props.defaultValue || 0;
  var max = props.max === undefined ? 5 : props.max;
  var size = props.size; // 'sm' | 'lg'
  var onChange = props.onChange;
  var id = props.id;
  var className = props.className;

  var ref = React.useRef(null);
  var seededValue = React.useRef(defaultValue);

  if (seededValue.current !== defaultValue) {
    warnOnce(
      'Rating: `defaultValue` seeds the first render only — rating.js owns the value afterwards, and changing it now rewrites the stars underneath the module. Render `readOnly` to display an app-owned value.'
    );
  }
  if (!(max >= 1)) {
    warnOnce('Rating: `max` must be at least 1 — falling back to 5.');
    max = 5;
  }
  if (defaultValue < 0 || defaultValue > max) {
    warnOnce('Rating: `defaultValue` must be between 0 and `max` — the module clamps its arrows to the star count, so an out-of-range seed leaves the control unresponsive until it catches up.');
  }

  if (max > 5) {
    warnOnce("Rating: don't use more than 5 stars (cms/rating.md).");
  }

  if (!label) {
    warnOnce('Rating: provide `label` — the rating group needs an aria-label describing the context. On a read-only rating the label is the only thing conveying the score, so name it the way the contract does: "Rating: 4 out of 5".');
  }

  if (!readOnly && value !== undefined) {
    warnOnce('Rating: `value` applies to `readOnly` ratings only — an interactive rating is seeded by `defaultValue` and owned by rating.js afterwards.');
  }

  React.useEffect(
    function () {
      if (readOnly) return;
      var el = ref.current;
      if (!el) return;
      // Late-mounted ratings self-register through the module's public
      // init; the bind guard makes a duplicate call a no-op.
      if (typeof window !== 'undefined') {
        if (typeof window.initRating === 'function') {
          if (!el.dataset.ratingBound) window.initRating(el.parentNode || undefined);
        } else {
          warnOnce(
            'Rating: rating.js is not loaded — the stars will not respond. Load the module (see cms/react.md), or render `readOnly` for a display-only rating.'
          );
        }
      }
      if (!onChange) return;
      function handleChange(event) {
        onChange(event.detail.value);
      }
      el.addEventListener('rating-change', handleChange);
      return function () {
        el.removeEventListener('rating-change', handleChange);
      };
    },
    [readOnly, onChange]
  );

  var sizeClass = size === 'sm' ? 'rating--sm' : size === 'lg' ? 'rating--lg' : null;
  var stars = [];
  var i;

  // The module's bind guard lives on this node, so a readOnly flip has to be
  // a new node or the module can never re-bind it.
  var modeKey = readOnly ? 'readonly' : 'interactive';

  if (readOnly) {
    var filled = value || 0;
    for (i = 0; i < max; i++) {
      stars.push(h('span', { key: i, className: i < filled ? 'rating-star is-filled' : 'rating-star' }, starIcon()));
    }
    return h(
      'div',
      {
        key: modeKey,
        id: id,
        className: cx('rating', sizeClass, 'is-readonly', className),
        'data-value': String(filled),
        'aria-label': label,
      },
      stars
    );
  }

  for (i = 0; i < max; i++) {
    stars.push(
      h(
        'button',
        {
          key: i,
          // The module repaints on init, but the contract shows the filled
          // stars in the markup — so first paint (and a page with the module
          // missing) has to be right on its own.
          className: i < defaultValue ? 'rating-star is-filled' : 'rating-star',
          'aria-label': i + 1 + (i === 0 ? ' star' : ' stars'),
          type: 'button',
        },
        starIcon()
      )
    );
  }
  return h(
    'div',
    {
      key: modeKey,
      ref: ref,
      id: id,
      className: cx('rating', sizeClass, className),
      'data-value': String(defaultValue),
      'aria-label': label,
    },
    stars
  );
}
