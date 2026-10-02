/* @bydefaultstudio/design-system v6.0.1 */
/**
 * Date Picker component — a calendar panel over the native date input
 * Initialises every .date-picker: a .dropdown whose trigger opens a month
 * grid this script builds inside .date-picker-panel.
 *
 * The native <input type="date"> stays the field, the value and the
 * validation. Choosing a day writes it and dispatches `input` then `change`
 * on it, so form code sees a user edit; typing into the input while the panel
 * is open moves the calendar to the typed month. Without this script the
 * browser's own picker still works.
 *
 * dropdown.js owns open, close, placement, Escape, outside click and focus
 * return — the panel is a .dropdown-menu without role="menu", so it gets
 * exactly that and nothing else. This file owns the grid and its keyboard.
 *
 * Mode, month count, locale and the disabled rules are read once at bind
 * time: changing them afterwards means clearing data-date-picker-bound and
 * re-running initDatePicker on the block.
 *
 * @version 1.0.0
 */
(function () {
  var VERSION = '1.0.0';
  var SELECTOR = '.date-picker';
  var DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var OPEN_KEYS = ['Enter', ' ', 'ArrowDown', 'ArrowUp'];
  var WEEK_LENGTH = 7;
  // Always six rows, so paging between a five-row and a six-row month does
  // not change the panel's height under the pointer or the placement flip.
  var ROWS = 6;
  var MONTHS_IN_YEAR = 12;
  var idCounter = 0;
  var warnedIcons = {};
  // The five strings the script writes. Everything else follows the page's
  // lang through Intl; these are read from data-label-* on the root so a
  // deployment in another language can hand its own in.
  var DEFAULT_LABELS = {
    dialog: 'Choose date',
    previous: 'Previous month',
    next: 'Next month',
    today: 'Today',
    clear: 'Clear',
    selected: 'selected'
  };

  //
  //------- Utility: dates -------//
  //
  // Every date here is a local midnight built with new Date(y, m, d). Never
  // new Date("YYYY-MM-DD") — that parses as UTC and lands a day early west
  // of Greenwich.

  function pad(number) {
    return number < 10 ? '0' + number : String(number);
  }

  function toISO(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseISO(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    // A rolled-over date (2026-02-31 becomes 3 March) is not the string it came from
    return toISO(date) === match[0] ? date : null;
  }

  function today() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function addDays(date, count) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // Clamps the day so 31 January + 1 month is 28 February, not 3 March
  function addMonths(date, count) {
    var year = date.getFullYear();
    var month = date.getMonth() + count;
    var day = Math.min(date.getDate(), daysInMonth(year, month));
    return new Date(year, month, day);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function isSameDay(a, b) {
    return Boolean(a && b) && toISO(a) === toISO(b);
  }

  function clampToRange(date, min, max) {
    if (min && date < min) return min;
    if (max && date > max) return max;
    return date;
  }

  function isOutOfBounds(date, rules) {
    return Boolean((rules.min && date < rules.min) || (rules.max && date > rules.max));
  }

  function isDisabled(date, rules) {
    return isOutOfBounds(date, rules) || rules.dates[toISO(date)] === true || rules.days[date.getDay()] === true;
  }

  // Days since the start of the week the date falls in
  function weekdayOffset(date, firstDay) {
    return (date.getDay() - firstDay + WEEK_LENGTH) % WEEK_LENGTH;
  }

  //
  //------- Utility: locale -------//
  //

  // An unknown tag would make every Intl call throw; fall back to the
  // browser default rather than to nothing.
  function resolveLocale(tag) {
    try {
      new Intl.DateTimeFormat(tag);
      return tag || undefined;
    } catch (err) {
      return undefined;
    }
  }

  // Intl.Locale week info: firstDay is 1 (Monday) to 7 (Sunday). Chromium and
  // Safari expose it; Firefox does not yet, and jsdom never — Monday then.
  function resolveFirstDay(locale) {
    try {
      var info = new Intl.Locale(locale || navigator.language);
      var week = typeof info.getWeekInfo === 'function' ? info.getWeekInfo() : info.weekInfo;
      if (week && week.firstDay) return week.firstDay % WEEK_LENGTH;
    } catch (err) {
      // No Intl.Locale, or a tag it will not take
    }
    return 1;
  }

  function monthTitle(date, locale) {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
  }

  // "October – November 2026" where the browser can, both titles joined where it cannot
  function monthsTitle(first, last, locale) {
    var format = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    if (typeof format.formatRange === 'function') return format.formatRange(first, last);
    return format.format(first) + ' – ' + format.format(last);
  }

  function weekdayLabels(locale, firstDay) {
    var short = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    var long = new Intl.DateTimeFormat(locale, { weekday: 'long' });
    var labels = [];
    // 1 January 2023 was a Sunday; walk from it in the week's own order
    for (var i = 0; i < WEEK_LENGTH; i++) {
      var date = new Date(2023, 0, 1 + ((firstDay + i) % WEEK_LENGTH));
      labels.push({ short: short.format(date), long: long.format(date) });
    }
    return labels;
  }

  function dayLabel(date, locale) {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
  }

  //
  //------- Utility: DOM -------//
  //

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
      });
    }
    if (children) {
      children.forEach(function (child) {
        if (!child) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
    }
    return node;
  }

  // The nav glyphs come from <template data-date-picker-icon="prev|next">,
  // written once per page with the brand icon — this script invents no glyph.
  // Parsed HTML and innerHTML both fill a template's .content; a DOM built by
  // hand may leave the children on the element, so both are read.
  function iconFrom(root, name) {
    var selector = 'template[data-date-picker-icon="' + name + '"]';
    var template = root.querySelector(selector) || document.querySelector(selector);
    if (!template) {
      if (!warnedIcons[name]) {
        warnedIcons[name] = true;
        console.warn('[date-picker] no <template data-date-picker-icon="' + name + '"> on the page — the ' + name + ' button shows its label as text');
      }
      return null;
    }
    var source = template.content && template.content.childNodes.length ? template.content : template;
    var fragment = document.createDocumentFragment();
    Array.prototype.forEach.call(source.childNodes, function (node) {
      fragment.appendChild(node.cloneNode(true));
    });
    return fragment;
  }

  function readLabels(root) {
    var labels = {};
    Object.keys(DEFAULT_LABELS).forEach(function (key) {
      labels[key] = root.getAttribute('data-label-' + key) || DEFAULT_LABELS[key];
    });
    return labels;
  }

  // The disabled rules: min is the latest of the inputs' own min attributes,
  // max the earliest, so a range cannot start before or end after either
  // field allows. Specific dates and weekdays come from the root.
  function readRules(root, inputs) {
    var mins = [];
    var maxs = [];
    inputs.forEach(function (input) {
      var min = parseISO(input.getAttribute('min'));
      var max = parseISO(input.getAttribute('max'));
      if (min) mins.push(min);
      if (max) maxs.push(max);
    });
    var dates = {};
    var days = {};
    String(root.getAttribute('data-disabled-dates') || '').split(/\s+/).forEach(function (iso) {
      if (parseISO(iso)) dates[iso] = true;
    });
    String(root.getAttribute('data-disabled-days') || '').toLowerCase().split(/\s+/).forEach(function (name) {
      var index = DAY_NAMES.indexOf(name);
      if (index > -1) days[index] = true;
    });
    return {
      min: mins.length ? new Date(Math.max.apply(null, mins)) : null,
      max: maxs.length ? new Date(Math.min.apply(null, maxs)) : null,
      dates: dates,
      days: days
    };
  }

  //
  //------- Main: build -------//
  //

  function makeNavButton(state, name, label) {
    var button = el('button', {
      type: 'button',
      class: 'button date-picker-' + name,
      'data-variant': 'text',
      'data-size': 'small',
      'aria-label': label
    });
    var icon = iconFrom(state.root, name);
    if (icon) {
      button.setAttribute('data-icon-only', '');
      button.appendChild(icon);
    } else {
      button.textContent = label;
    }
    return button;
  }

  function makeActionButton(action, label) {
    return el('button', {
      type: 'button',
      class: 'button',
      'data-variant': 'text',
      'data-size': 'small',
      'data-date-picker-action': action
    }, [label]);
  }

  function makeGrid(state, index) {
    var captionId = state.baseId + '-month-' + index;
    var caption = el('div', { class: 'visually-hidden date-picker-caption', id: captionId });
    var header = el('div', { role: 'rowgroup' }, [
      el('div', { role: 'row', class: 'date-picker-row' }, state.weekdays.map(function (label) {
        return el('div', {
          role: 'columnheader',
          class: 'date-picker-weekday',
          'aria-label': label.long
        }, [label.short]);
      }))
    ]);
    var body = el('div', { role: 'rowgroup', class: 'date-picker-body' });
    var grid = el('div', {
      role: 'grid',
      class: 'date-picker-grid',
      tabindex: '-1',
      'aria-labelledby': captionId
    }, [header, body]);
    return el('div', { class: 'date-picker-month' }, [caption, grid]);
  }

  function buildPanel(state) {
    var panel = state.panel;
    state.baseId = 'date-picker-' + (++idCounter);
    state.title = el('p', { class: 'date-picker-title', id: state.baseId + '-title' });
    state.live = el('div', { class: 'visually-hidden', 'aria-live': 'polite' });
    state.months = [];
    var months = el('div', { class: 'date-picker-months' });
    for (var i = 0; i < state.monthCount; i++) {
      var month = makeGrid(state, i);
      state.months.push(month);
      months.appendChild(month);
    }
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', state.trigger.getAttribute('aria-label') || state.labels.dialog);
    // Focusable, so a click on the title or the padding parks focus on the
    // panel rather than the body — dropdown.js reads a focusout to the body
    // as leaving, and would close the panel under the pointer.
    panel.setAttribute('tabindex', '-1');
    panel.replaceChildren(
      el('div', { class: 'date-picker-nav' }, [
        makeNavButton(state, 'prev', state.labels.previous),
        state.title,
        makeNavButton(state, 'next', state.labels.next)
      ]),
      state.live,
      months,
      el('div', { class: 'date-picker-footer' }, [
        makeActionButton('today', state.labels.today),
        makeActionButton('clear', state.labels.clear)
      ])
    );
  }

  //
  //------- Main: render -------//
  //

  function renderDay(state, date) {
    var button = el('button', {
      type: 'button',
      class: 'date-picker-day',
      'data-date': toISO(date),
      tabindex: '-1',
      'aria-label': dayLabel(date, state.locale)
    }, [String(date.getDate())]);
    if (isSameDay(date, state.today)) button.setAttribute('aria-current', 'date');
    if (isDisabled(date, state.rules)) button.setAttribute('aria-disabled', 'true');
    return el('div', { role: 'gridcell', class: 'date-picker-cell' }, [button]);
  }

  // Rebuilds one month. Days outside the month are empty cells, not muted
  // duplicates — with two months side by side a duplicated day would carry
  // its selected state twice.
  function renderMonth(state, month, monthDate) {
    var body = month.querySelector('.date-picker-body');
    month.querySelector('.date-picker-caption').textContent = monthTitle(monthDate, state.locale);

    // Removing the focused node can fire focusout with no relatedTarget, which
    // dropdown.js reads as focus leaving — and closes the panel mid-navigation.
    // Park focus on the panel for the swap.
    if (body.contains(document.activeElement)) state.panel.focus();

    var first = startOfMonth(monthDate);
    var lead = weekdayOffset(first, state.firstDay);
    var count = daysInMonth(first.getFullYear(), first.getMonth());
    var rows = [];
    for (var row = 0; row < ROWS; row++) {
      var cells = [];
      for (var column = 0; column < WEEK_LENGTH; column++) {
        var dayNumber = row * WEEK_LENGTH + column - lead + 1;
        if (dayNumber < 1 || dayNumber > count) {
          cells.push(el('div', { role: 'gridcell', class: 'date-picker-cell is-empty' }));
        } else {
          cells.push(renderDay(state, new Date(first.getFullYear(), first.getMonth(), dayNumber)));
        }
      }
      rows.push(el('div', { role: 'row', class: 'date-picker-row' }, cells));
    }
    body.replaceChildren.apply(body, rows);
  }

  function focusInGrid(state) {
    return state.months.some(function (month) {
      return month.querySelector('.date-picker-body').contains(document.activeElement);
    });
  }

  function renderMonths(state) {
    var last = addMonths(state.view, state.monthCount - 1);
    var titleText = state.monthCount > 1
      ? monthsTitle(state.view, last, state.locale)
      : monthTitle(state.view, state.locale);
    var changed = state.title.textContent !== titleText;
    var hadFocus = focusInGrid(state);
    state.title.textContent = titleText;
    // Only a change announces, and only when focus is not in the grid: the
    // first render would otherwise read the month out before the user has
    // done anything, and a keyboard move already lands on a day whose name
    // carries the month.
    if (changed && state.rendered && !hadFocus) state.live.textContent = titleText;
    state.rendered = true;

    state.months.forEach(function (month, index) {
      renderMonth(state, month, addMonths(state.view, index));
    });
    paintStates(state);
    setRoving(state);
    if (hadFocus) focusDay(state);
  }

  function forEachDay(state, callback) {
    Array.prototype.forEach.call(state.panel.querySelectorAll('.date-picker-day'), function (button) {
      callback(button, parseISO(button.getAttribute('data-date')));
    });
  }

  function findDay(state, date) {
    return date ? state.panel.querySelector('.date-picker-day[data-date="' + toISO(date) + '"]') : null;
  }

  // Selection and range classes are toggled on the rendered buttons, so a
  // hover preview repaints without rebuilding the grid.
  function paintStates(state) {
    var range = state.mode === 'range';
    var from = state.values.from;
    var to = state.values.to;
    var previewEnd = range && state.stage === 'picking-end' && state.hoverDate && from && state.hoverDate >= from
      ? state.hoverDate
      : null;
    forEachDay(state, function (button, date) {
      var isFrom = isSameDay(date, from);
      var isTo = range && isSameDay(date, to);
      var selected = isFrom || isTo;
      // aria-selected lives on the cell, which a screen reader in focus mode
      // never reaches — the button's name carries the state as well
      button.setAttribute('aria-label', selected ? dayLabel(date, state.locale) + ', ' + state.labels.selected : dayLabel(date, state.locale));
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-range-start', range && isFrom && Boolean(to || previewEnd));
      button.classList.toggle('is-range-end', isTo);
      button.classList.toggle('is-range-inner', range && Boolean(from && to) && date > from && date < to);
      button.classList.toggle('is-range-preview', Boolean(previewEnd) && date > from && date <= previewEnd);
      button.parentNode.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  // One day in the tab order: the focused day, or the first day the rules
  // allow when it is not on screen.
  function setRoving(state) {
    var target = findDay(state, state.focusDate);
    if (!target) {
      target = state.panel.querySelector('.date-picker-day:not([aria-disabled="true"])')
        || state.panel.querySelector('.date-picker-day');
      if (target) state.focusDate = parseISO(target.getAttribute('data-date'));
    }
    forEachDay(state, function (button) {
      button.setAttribute('tabindex', button === target ? '0' : '-1');
    });
  }

  function focusDay(state) {
    var button = findDay(state, state.focusDate);
    if (button) button.focus();
  }

  // The first visible month for a date to be on screen: the date's own
  // month, unless it already sits in a later visible month.
  function viewFor(state, date) {
    var first = startOfMonth(date);
    var lastVisible = addMonths(state.view, state.monthCount - 1);
    if (first < state.view || first > lastVisible) {
      return first > lastVisible ? addMonths(first, 1 - state.monthCount) : first;
    }
    return state.view;
  }

  //
  //------- Main: state -------//
  //

  // Re-reads the native inputs. Returns whether anything changed — our own
  // writes update state first, so the events they fire find nothing to do.
  function readValues(state) {
    var changed = false;
    ['from', 'to'].forEach(function (key) {
      var input = state.inputs[key];
      if (!input) return;
      var date = parseISO(input.value);
      if (!isSameDay(date, state.values[key]) && (date || state.values[key])) {
        state.values[key] = date;
        changed = true;
      }
    });
    if (changed && state.mode === 'range' && !state.values.from) state.stage = 'idle';
    return changed;
  }

  // What the panel shows on open: the chosen date, else today, both held
  // inside min and max. A half-picked range from a closed panel is dropped.
  function chooseView(state) {
    readValues(state);
    // Read on every open: a page left open across midnight would otherwise
    // mark yesterday as today until it reloaded
    state.today = today();
    state.stage = 'idle';
    state.hoverDate = null;
    var anchor = state.values.from || state.today;
    state.focusDate = clampToRange(anchor, state.rules.min, state.rules.max);
    state.view = startOfMonth(state.focusDate);
  }

  function isOpen(state) {
    return state.root.classList.contains('is-open');
  }

  function closePanel(state, returnFocus) {
    if (typeof window.closeDropdown === 'function') {
      window.closeDropdown(state.root, returnFocus);
      return;
    }
    // dropdown.js missing: the panel can still be shut, just without its bookkeeping
    state.root.classList.remove('is-open');
    state.trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) state.trigger.focus();
  }

  function moveFocus(state, date) {
    state.focusDate = clampToRange(date, state.rules.min, state.rules.max);
    if (!findDay(state, state.focusDate)) {
      state.view = viewFor(state, state.focusDate);
      renderMonths(state);
    }
    setRoving(state);
    focusDay(state);
  }

  function pageMonths(state, count) {
    state.view = addMonths(state.view, count);
    // The focused day keeps step, so the arrows continue from where the eye is
    state.focusDate = clampToRange(addMonths(state.focusDate, count), state.rules.min, state.rules.max);
    // A clamp means the page went past min or max: pull the view back so the
    // day focus landed on is the one on screen
    state.view = viewFor(state, state.focusDate);
    renderMonths(state);
  }

  function writeValue(state, key, date) {
    var input = state.inputs[key];
    if (!input) return;
    state.values[key] = date;
    var iso = date ? toISO(date) : '';
    if (input.value === iso) return;
    input.value = iso;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function emitChange(state) {
    var from = state.values.from ? toISO(state.values.from) : '';
    var to = state.values.to ? toISO(state.values.to) : '';
    var value = state.mode === 'range' ? (from && to ? from + '/' + to : '') : from;
    state.root.dispatchEvent(new CustomEvent('date-picker-change', {
      bubbles: true,
      detail: { value: value, from: from, to: to }
    }));
  }

  function selectDate(state, date) {
    state.focusDate = date;
    if (state.mode === 'single') {
      writeValue(state, 'from', date);
      paintStates(state);
      emitChange(state);
      closePanel(state, true);
      return;
    }
    var from = state.values.from;
    if (state.stage !== 'picking-end' || !from || date < from) {
      // First pick, or an end before the start: this day starts a new range.
      // A silent swap would commit a range the user never aimed at.
      writeValue(state, 'from', date);
      writeValue(state, 'to', null);
      state.stage = 'picking-end';
      state.hoverDate = null;
      paintStates(state);
      emitChange(state);
      return;
    }
    writeValue(state, 'to', date);
    state.stage = 'idle';
    state.hoverDate = null;
    paintStates(state);
    emitChange(state);
    closePanel(state, true);
  }

  function clearValues(state) {
    writeValue(state, 'from', null);
    writeValue(state, 'to', null);
    state.stage = 'idle';
    state.hoverDate = null;
    paintStates(state);
    emitChange(state);
  }

  //
  //------- Event Listeners -------//
  //

  // Runs before dropdown.js's document-level handler opens the panel, so the
  // month is rendered before placement measures it.
  function handleTriggerClick(state) {
    if (isOpen(state)) return;
    chooseView(state);
    renderMonths(state);
  }

  // The keyboard open is ours: preventDefault makes dropdown.js ignore the
  // key, the synthetic click takes it through dropdown.js's normal open, and
  // the focus lands on the roving day once the panel has a box.
  function handleTriggerKeydown(state, event) {
    if (OPEN_KEYS.indexOf(event.key) === -1) return;
    event.preventDefault();
    if (isOpen(state)) {
      // Enter and Space toggle; an arrow on an open panel steps into the grid
      if (event.key === 'Enter' || event.key === ' ') closePanel(state, true);
      else focusDay(state);
      return;
    }
    state.trigger.click();
    if (isOpen(state)) focusDay(state);
  }

  function handlePanelClick(state, event) {
    var day = event.target.closest('.date-picker-day');
    if (day) {
      if (day.getAttribute('aria-disabled') === 'true') return;
      selectDate(state, parseISO(day.getAttribute('data-date')));
      return;
    }
    if (event.target.closest('.date-picker-prev')) {
      pageMonths(state, -1);
      return;
    }
    if (event.target.closest('.date-picker-next')) {
      pageMonths(state, 1);
      return;
    }
    var action = event.target.closest('[data-date-picker-action]');
    if (!action) return;
    if (action.getAttribute('data-date-picker-action') === 'today') moveFocus(state, state.today);
    if (action.getAttribute('data-date-picker-action') === 'clear') clearValues(state);
  }

  function handleGridKeydown(state, event) {
    var day = event.target.closest('.date-picker-day');
    var fromDay = Boolean(day);
    // A click on the panel padding or an empty cell parks focus on the panel
    // or the grid; the arrows then continue from the roving day rather than
    // going dead until the next Tab
    if (!day && (event.target === state.panel || event.target.classList.contains('date-picker-grid'))) {
      day = findDay(state, state.focusDate);
    }
    if (!day) return;
    var date = parseISO(day.getAttribute('data-date'));
    if (!date) return;
    // Selection is handled here rather than left to the button's native
    // activation, as the APG grid pattern has it — one path for the pointer
    // and the keyboard, and Space cannot scroll the page on the way.
    if (event.key === 'Enter' || event.key === ' ') {
      if (!fromDay) return;
      event.preventDefault();
      if (day.getAttribute('aria-disabled') !== 'true') selectDate(state, date);
      return;
    }
    var next;
    switch (event.key) {
      case 'ArrowLeft': next = addDays(date, -1); break;
      case 'ArrowRight': next = addDays(date, 1); break;
      case 'ArrowUp': next = addDays(date, -WEEK_LENGTH); break;
      case 'ArrowDown': next = addDays(date, WEEK_LENGTH); break;
      case 'Home': next = addDays(date, -weekdayOffset(date, state.firstDay)); break;
      case 'End': next = addDays(date, WEEK_LENGTH - 1 - weekdayOffset(date, state.firstDay)); break;
      case 'PageUp': next = addMonths(date, event.shiftKey ? -MONTHS_IN_YEAR : -1); break;
      case 'PageDown': next = addMonths(date, event.shiftKey ? MONTHS_IN_YEAR : 1); break;
      default: return;
    }
    event.preventDefault();
    moveFocus(state, next);
    // The keyboard gets the same preview the pointer does
    if (state.stage === 'picking-end') {
      state.hoverDate = state.focusDate;
      paintStates(state);
    }
  }

  function handleGridPointerOver(state, event) {
    if (state.stage !== 'picking-end') return;
    var day = event.target.closest('.date-picker-day');
    if (!day) return;
    state.hoverDate = parseISO(day.getAttribute('data-date'));
    paintStates(state);
  }

  function handleGridPointerLeave(state) {
    if (state.stage !== 'picking-end' || !state.hoverDate) return;
    state.hoverDate = null;
    paintStates(state);
  }

  // Typing while the panel is open moves the calendar to the typed month
  function handleInput(state) {
    if (!readValues(state)) return;
    if (!isOpen(state)) return;
    var anchor = state.values.from || state.values.to;
    if (anchor) {
      state.focusDate = clampToRange(anchor, state.rules.min, state.rules.max);
      state.view = viewFor(state, state.focusDate);
    }
    renderMonths(state);
  }

  //
  //------- Initialize -------//
  //

  function bindDatePicker(root) {
    var trigger = root.querySelector('.dropdown-trigger');
    var panel = root.querySelector(':scope > .date-picker-panel');
    var inputs = Array.prototype.slice.call(root.querySelectorAll('input[type="date"]'));
    var mode = root.getAttribute('data-mode') === 'range' ? 'range' : 'single';
    // Binding hides the browser's calendar button and shows ours; with no
    // dropdown.js ours would open nothing, so the native one stays in charge
    if (typeof window.closeDropdown !== 'function') {
      console.warn('[date-picker] dropdown.js is not loaded — load it before date-picker.js. The native date input keeps its own picker', root);
      return false;
    }
    if (!trigger || !panel || !inputs.length || (mode === 'range' && inputs.length < 2)) {
      console.warn('[date-picker] needs a .dropdown-trigger, a .date-picker-panel child and ' +
        (mode === 'range' ? 'two' : 'one') + ' input[type="date"] — not initialised', root);
      return false;
    }

    // The dropdown hangs its panel off the root's start edge, but a range
    // picker's trigger sits in the LAST field. Anchor the panel to the end
    // edge instead so it opens under the button that was pressed — an
    // author's own data-placement still wins.
    if (mode === 'range' && !root.hasAttribute('data-placement')) {
      root.setAttribute('data-placement', 'bottom-end');
    }

    var locale = resolveLocale(document.documentElement.lang || navigator.language);
    var firstDay = resolveFirstDay(locale);
    var state = {
      root: root,
      trigger: trigger,
      panel: panel,
      mode: mode,
      monthCount: root.getAttribute('data-months') === '2' ? 2 : 1,
      locale: locale,
      firstDay: firstDay,
      weekdays: weekdayLabels(locale, firstDay),
      today: today(),
      labels: readLabels(root),
      inputs: { from: inputs[0], to: mode === 'range' ? inputs[1] : null },
      values: { from: null, to: null },
      stage: 'idle',
      hoverDate: null,
      rendered: false
    };
    state.rules = readRules(root, mode === 'range' ? inputs.slice(0, 2) : inputs.slice(0, 1));

    buildPanel(state);
    // Rendered now as well as on open, so a panel held open in markup shows a
    // calendar rather than an empty box
    chooseView(state);
    renderMonths(state);

    trigger.addEventListener('click', function () { handleTriggerClick(state); });
    trigger.addEventListener('keydown', function (event) { handleTriggerKeydown(state, event); });
    panel.addEventListener('click', function (event) { handlePanelClick(state, event); });
    panel.addEventListener('keydown', function (event) { handleGridKeydown(state, event); });
    state.months.forEach(function (month) {
      var grid = month.querySelector('.date-picker-grid');
      grid.addEventListener('pointerover', function (event) { handleGridPointerOver(state, event); });
      grid.addEventListener('pointerleave', function () { handleGridPointerLeave(state); });
    });
    ['from', 'to'].forEach(function (key) {
      var input = state.inputs[key];
      if (!input) return;
      input.addEventListener('input', function () { handleInput(state); });
      input.addEventListener('change', function () { handleInput(state); });
    });
    return true;
  }

  function initDatePicker(scopeOrEl) {
    var root = scopeOrEl || document;
    var bound = 0;

    // Accepts a scope to search, or the .date-picker itself — see tabs.js.
    var pickers = Array.prototype.slice.call(root.querySelectorAll(SELECTOR));
    if (root.matches && root.matches(SELECTOR)) pickers = [root].concat(pickers);

    pickers.forEach(function (picker) {
      if (picker.dataset.datePickerBound) return;
      // Set before binding: the attribute is the CSS hook that swaps the
      // browser's calendar button for ours, and it must never sit on a picker
      // this script gave up on
      picker.dataset.datePickerBound = 'true';
      if (bindDatePicker(picker)) {
        bound++;
      } else {
        delete picker.dataset.datePickerBound;
      }
    });

    // Only when something was actually wired — most pages have no date picker.
    if (bound) console.log('[date-picker] v' + VERSION + ' — init (' + bound + ')');
  }

  // Exposed for late-mounted pickers (the React adapter); the after-nav
  // listener below is the caller that matters.
  window.initDatePicker = initDatePicker;

  // Registered twice: once for the initial load, once for Barba's after-nav
  // event. DOMContentLoaded never re-fires after a container swap, so without
  // the second listener every picker goes inert on the first navigation.
  // Both fire on a hard load; the dataset guard makes that harmless.
  // See cms/js-code-structure.md.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initDatePicker(); });
  } else {
    initDatePicker();
  }

  document.addEventListener('bd:after-nav', function (event) {
    initDatePicker(event.detail && event.detail.container);
  });
})();
