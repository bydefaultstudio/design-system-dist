'use client';
/* @bydefaultstudio/design-system v4.8.0 */
/**
 * <CellInput> — React adapter over the Cell Input markup contract
 * (cms/cell-input.md).
 *
 * Renders the block, the aria-hidden cells label and the single real
 * <input>; cell-input.js builds and paints the cells and owns the value.
 * The module reads data-format and the input wiring once at bind, so the
 * adapter keys itself on format + mode — changing either remounts a
 * fresh block, which then self-registers (the re-key rule from
 * cms/react.md, handled for you). `cell-input:change` and
 * `cell-input:complete` surface as `onChange` and `onComplete`.
 *
 * `static` renders the display-only variant — hand-authored cells
 * generated from `value`, no input, no module: `-` and `/` close a word
 * as separator cells, spaces break words, other punctuation stays an
 * in-word separator, matching the format grammar.
 */
import * as React from 'react';
import { cx, warnOnce } from './internal.mjs';

var h = React.createElement;

// Mirrors cell-input.js: accents are folded to their base letter before the
// character class is applied, so "café" is four letter cells, not three and a
// stray separator.
function fold(ch) {
  return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function staticCells(value) {
  var words = [];
  var current = [];
  var chars = String(value == null ? '' : value).split('');
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    if (ch === ' ') {
      if (current.length) words.push(current);
      current = [];
    } else if (ch === '-' || ch === '/') {
      current.push({ ch: ch, cell: 'separator' });
      words.push(current);
      current = [];
    } else if (/[a-z0-9]/i.test(fold(ch))) {
      current.push({ ch: fold(ch), cell: 'letter' });
    } else {
      current.push({ ch: ch, cell: 'separator' });
    }
  }
  if (current.length) words.push(current);
  return words.map(function (word, w) {
    return h(
      'span',
      { key: w, className: 'cell-input-word' },
      word.map(function (c, j) {
        return h('span', { key: j, className: 'cell-input-cell', 'data-cell': c.cell }, c.ch);
      })
    );
  });
}

export function CellInput(props) {
  var format = props.format;
  var mode = props.mode; // 'letters' | 'digits' | 'any' (omit for any)
  var label = props.label;
  var mask = props.mask;
  var size = props.size; // 'small'
  var verdict = props.verdict; // 'success' | 'danger'
  var isStatic = props.static;
  var value = props.value; // static display only
  var password = props.password;
  var autoComplete = props.autoComplete || 'off';
  var disabled = props.disabled;
  var error = props.error;
  var onChange = props.onChange;
  var onComplete = props.onComplete;
  var describedBy = props['aria-describedby'];
  var id = props.id;
  var className = props.className;

  var autoId = React.useId();
  var inputId = id || autoId + '-input';
  var blockRef = React.useRef(null);

  if (isStatic && (value === undefined || value === null || String(value) === '')) {
    warnOnce('CellInput: a static cell input needs a `value` — the characters are the content, and without them it renders an empty row.');
  }
  if (!isStatic && !format) {
    warnOnce('CellInput: `format` is required — cell-input.js binds only .cell-input[data-format], so the block stays inert without it.');
  }
  if (!isStatic && !label) {
    warnOnce('CellInput: provide `label` — the input carries the accessible name, and the generated fallback describes shape only (cms/cell-input.md).');
  }

  React.useEffect(
    function () {
      if (isStatic) return;
      var block = blockRef.current;
      if (!block) return;
      // The module binds on load and on bd:after-nav; a block that arrives
      // between those moments (streamed, conditional, or re-keyed by a
      // format change) registers itself here. The bind guard absorbs
      // duplicates.
      if (typeof window !== 'undefined') {
        if (typeof window.initCellInput === 'function') {
          if (!block.dataset.cellInputBound) window.initCellInput(block);
        } else {
          warnOnce(
            'CellInput: cell-input.js is not loaded — the cells will not build. Load the module (see cms/react.md).'
          );
        }
      }
      function handleChange(event) {
        if (onChange) onChange(event.detail.value, event.detail.complete);
      }
      function handleComplete(event) {
        if (onComplete) onComplete(event.detail.value);
      }
      block.addEventListener('cell-input:change', handleChange);
      block.addEventListener('cell-input:complete', handleComplete);
      return function () {
        block.removeEventListener('cell-input:change', handleChange);
        block.removeEventListener('cell-input:complete', handleComplete);
      };
    },
    [isStatic, format, mode, mask, onChange, onComplete]
  );

  if (isStatic) {
    var staticProps = {
      id: id,
      className: cx('cell-input', className),
      'data-static': '',
    };
    if (size) staticProps['data-size'] = size;
    if (verdict) staticProps['data-type'] = verdict;
    if (error) staticProps.className = cx(staticProps.className, 'is-error');
    // Static cells are the content — no aria-hidden, span not label.
    return h('div', staticProps, h('span', { className: 'cell-input-cells' }, staticCells(value)));
  }

  var blockProps = {
    // Format and wiring are read once at bind (cms/cell-input.md); a new
    // shape must be a new block, so the key remounts it.
    key: (format || '') + '|' + (mode || '') + '|' + (mask ? 'masked' : ''),
    ref: blockRef,
    className: cx('cell-input', error && 'is-error', disabled && 'is-disabled', className),
    'data-format': format,
  };
  if (mode) blockProps['data-mode'] = mode;
  if (mask) blockProps['data-mask'] = '';
  if (size) blockProps['data-size'] = size;
  if (verdict) blockProps['data-type'] = verdict;

  return h(
    'div',
    blockProps,
    h('label', { className: 'cell-input-cells', htmlFor: inputId, 'aria-hidden': 'true' }),
    h('input', {
      type: password ? 'password' : 'text',
      id: inputId,
      'aria-label': label,
      'aria-invalid': verdict === 'danger' || error ? 'true' : undefined,
      'aria-describedby': describedBy,
      autoComplete: autoComplete,
      autoCorrect: 'off',
      autoCapitalize: 'off',
      spellCheck: 'false',
      disabled: disabled || undefined,
    })
  );
}
