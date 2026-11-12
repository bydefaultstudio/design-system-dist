/**
 * World Clock — Tool Page Controller
 * Handles city search, config UI, preview iframe, and embed URL/iframe generation.
 * Loaded globally; starts itself on initial load and after every Barba
 * navigation (startWorldClock, at the end), and exposes window.initWorldClock.
 *
 * On the tool canvas, built from docks (cms/tool-canvas.md, Docks): the
 * clock in the preview, the cities and presets in a Cities section, the
 * switches and the theme in Style with its own reset, the embed URL and the
 * iframe snippet as read-only fields in Export, and the two copy verbs at
 * the dock's foot — copy-button.js's, reading those fields.
 *
 * 2.0.0: onto docks. The theme is a radio group, the embed code a readout
 * copy-button.js copies rather than a menu item with its own clipboard
 * code, and ids take the tool's full slug.
 * @version 2.2.0
 */

(function () {
  'use strict';

  var VERSION = '2.2.0';
  console.log('[WorldClock Tool] v' + VERSION + ' loaded');

  /* ---- IANA Timezone Database ---- */

  var TIMEZONE_LIST = [
    { city: 'London', tz: 'Europe/London' },
    { city: 'Paris', tz: 'Europe/Paris' },
    { city: 'Berlin', tz: 'Europe/Berlin' },
    { city: 'Madrid', tz: 'Europe/Madrid' },
    { city: 'Rome', tz: 'Europe/Rome' },
    { city: 'Amsterdam', tz: 'Europe/Amsterdam' },
    { city: 'Brussels', tz: 'Europe/Brussels' },
    { city: 'Vienna', tz: 'Europe/Vienna' },
    { city: 'Zurich', tz: 'Europe/Zurich' },
    { city: 'Stockholm', tz: 'Europe/Stockholm' },
    { city: 'Oslo', tz: 'Europe/Oslo' },
    { city: 'Copenhagen', tz: 'Europe/Copenhagen' },
    { city: 'Helsinki', tz: 'Europe/Helsinki' },
    { city: 'Warsaw', tz: 'Europe/Warsaw' },
    { city: 'Prague', tz: 'Europe/Prague' },
    { city: 'Budapest', tz: 'Europe/Budapest' },
    { city: 'Bucharest', tz: 'Europe/Bucharest' },
    { city: 'Athens', tz: 'Europe/Athens' },
    { city: 'Istanbul', tz: 'Europe/Istanbul' },
    { city: 'Moscow', tz: 'Europe/Moscow' },
    { city: 'Dublin', tz: 'Europe/Dublin' },
    { city: 'Lisbon', tz: 'Europe/Lisbon' },
    { city: 'Edinburgh', tz: 'Europe/London' },
    { city: 'New York', tz: 'America/New_York' },
    { city: 'Chicago', tz: 'America/Chicago' },
    { city: 'Denver', tz: 'America/Denver' },
    { city: 'Los Angeles', tz: 'America/Los_Angeles' },
    { city: 'San Francisco', tz: 'America/Los_Angeles' },
    { city: 'Seattle', tz: 'America/Los_Angeles' },
    { city: 'Phoenix', tz: 'America/Phoenix' },
    { city: 'Toronto', tz: 'America/Toronto' },
    { city: 'Vancouver', tz: 'America/Vancouver' },
    { city: 'Montreal', tz: 'America/Toronto' },
    { city: 'Mexico City', tz: 'America/Mexico_City' },
    { city: 'Bogota', tz: 'America/Bogota' },
    { city: 'Lima', tz: 'America/Lima' },
    { city: 'Santiago', tz: 'America/Santiago' },
    { city: 'Buenos Aires', tz: 'America/Argentina/Buenos_Aires' },
    { city: 'Sao Paulo', tz: 'America/Sao_Paulo' },
    { city: 'Anchorage', tz: 'America/Anchorage' },
    { city: 'Honolulu', tz: 'Pacific/Honolulu' },
    { city: 'Tokyo', tz: 'Asia/Tokyo' },
    { city: 'Shanghai', tz: 'Asia/Shanghai' },
    { city: 'Beijing', tz: 'Asia/Shanghai' },
    { city: 'Hong Kong', tz: 'Asia/Hong_Kong' },
    { city: 'Singapore', tz: 'Asia/Singapore' },
    { city: 'Seoul', tz: 'Asia/Seoul' },
    { city: 'Taipei', tz: 'Asia/Taipei' },
    { city: 'Bangkok', tz: 'Asia/Bangkok' },
    { city: 'Jakarta', tz: 'Asia/Jakarta' },
    { city: 'Manila', tz: 'Asia/Manila' },
    { city: 'Kuala Lumpur', tz: 'Asia/Kuala_Lumpur' },
    { city: 'Ho Chi Minh', tz: 'Asia/Ho_Chi_Minh' },
    { city: 'Dubai', tz: 'Asia/Dubai' },
    { city: 'Abu Dhabi', tz: 'Asia/Dubai' },
    { city: 'Riyadh', tz: 'Asia/Riyadh' },
    { city: 'Doha', tz: 'Asia/Qatar' },
    { city: 'Mumbai', tz: 'Asia/Kolkata' },
    { city: 'Delhi', tz: 'Asia/Kolkata' },
    { city: 'Bangalore', tz: 'Asia/Kolkata' },
    { city: 'Kolkata', tz: 'Asia/Kolkata' },
    { city: 'Karachi', tz: 'Asia/Karachi' },
    { city: 'Dhaka', tz: 'Asia/Dhaka' },
    { city: 'Colombo', tz: 'Asia/Colombo' },
    { city: 'Kathmandu', tz: 'Asia/Kathmandu' },
    { city: 'Tehran', tz: 'Asia/Tehran' },
    { city: 'Tel Aviv', tz: 'Asia/Jerusalem' },
    { city: 'Yangon', tz: 'Asia/Yangon' },
    { city: 'Sydney', tz: 'Australia/Sydney' },
    { city: 'Melbourne', tz: 'Australia/Melbourne' },
    { city: 'Brisbane', tz: 'Australia/Brisbane' },
    { city: 'Perth', tz: 'Australia/Perth' },
    { city: 'Adelaide', tz: 'Australia/Adelaide' },
    { city: 'Auckland', tz: 'Pacific/Auckland' },
    { city: 'Fiji', tz: 'Pacific/Fiji' },
    { city: 'Cairo', tz: 'Africa/Cairo' },
    { city: 'Lagos', tz: 'Africa/Lagos' },
    { city: 'Nairobi', tz: 'Africa/Nairobi' },
    { city: 'Johannesburg', tz: 'Africa/Johannesburg' },
    { city: 'Cape Town', tz: 'Africa/Johannesburg' },
    { city: 'Casablanca', tz: 'Africa/Casablanca' },
    { city: 'Accra', tz: 'Africa/Accra' },
    { city: 'Addis Ababa', tz: 'Africa/Addis_Ababa' },
    { city: 'Reykjavik', tz: 'Atlantic/Reykjavik' }
  ];

  /* ---- Preset Groups ---- */

  var PRESETS = [
    { label: 'UK + US East', cities: ['Europe/London', 'America/New_York'] },
    { label: 'US Coasts', cities: ['America/New_York', 'America/Los_Angeles'] },
    { label: 'Europe', cities: ['Europe/London', 'Europe/Paris', 'Europe/Berlin'] },
    { label: 'Global', cities: ['Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney'] },
    { label: 'Asia Pacific', cities: ['Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney'] }
  ];

  /* ---- State ---- */

  var DEFAULT_CITIES = ['Europe/London', 'America/New_York', 'Asia/Tokyo'];
  var ANNOUNCE_DEBOUNCE_MS = 400;
  var PREVIEW_DEBOUNCE_MS = 300;

  var selectedCities = DEFAULT_CITIES.slice();
  var highlightIndex = -1;
  var filteredResults = [];
  var previewTimer = null;
  var announceTimer = null;
  var currentUrl = '';
  var drag = null;
  var suppressGripClick = false;
  var DRAG_THRESHOLD = 4;

  /* ---- DOM References ---- */

  var searchInput;
  var searchWrapper;
  var searchResults;
  var searchHint;
  var statusRegion;
  var tagContainer;
  var cityEmpty;
  var presetContainer;
  var previewStage;
  var previewIframe;
  var urlOutput;
  var embedOutput;
  var styleReset;
  var optShowCity;
  var optShowTz;
  var optShowSeconds;
  var themeControl;

  /* ---- Announcements ----
     One polite region for everything the tool says. Debounced, so typing a
     query that matches nothing says so once rather than once per letter, and
     an unchanged message is not written again — some readers repeat it. */

  function announce(text, repeat) {
    if (!statusRegion) return;
    clearTimeout(announceTimer);
    // A deliberate repeat (a second copy) clears first, so the same words
    // count as a change and are read again.
    if (repeat) statusRegion.textContent = '';
    announceTimer = setTimeout(function () {
      if (statusRegion.textContent !== text) statusRegion.textContent = text;
    }, ANNOUNCE_DEBOUNCE_MS);
  }

  /* ---- City Search ----
     A combobox on the search.js model: focus stays in the input, the active
     row is named through aria-activedescendant, and the rows are options
     carrying aria-selected — never focusable buttons of their own. */

  function getTimezoneOffset(tz) {
    try {
      var formatter = new Intl.DateTimeFormat('en', {
        timeZone: tz,
        timeZoneName: 'short'
      });
      var parts = formatter.formatToParts(new Date());
      var tzPart = parts.find(function (p) { return p.type === 'timeZoneName'; });
      return tzPart ? tzPart.value : '';
    } catch (e) {
      return '';
    }
  }

  function matchCities(query) {
    var q = query.toLowerCase().trim();
    if (!q) return [];
    return TIMEZONE_LIST.filter(function (item) {
      return item.city.toLowerCase().indexOf(q) !== -1;
    });
  }

  function availableCities(matches) {
    return matches.filter(function (item) {
      return selectedCities.indexOf(item.tz) === -1;
    });
  }

  function setOpen(open) {
    searchResults.classList.toggle('is-open', open);
    searchInput.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) setActive(-1);
  }

  function setActive(index) {
    var options = searchResults.querySelectorAll('.tool-result');
    highlightIndex = index;
    Array.prototype.forEach.call(options, function (option, i) {
      option.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    var active = options[index];
    if (active) {
      searchInput.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else {
      searchInput.removeAttribute('aria-activedescendant');
    }
  }

  /* The visible line under the field. It is not the live region — a region
     shown at the moment it is written is often not read — so each message is
     also announced through the status region. Recomputed whenever the query
     or the chosen cities change, so it never states something stale. */
  function updateHint() {
    if (!searchHint) return;
    var trimmed = searchInput.value.trim();
    var matches = matchCities(trimmed);
    var message = '';

    if (trimmed && !matches.length) {
      message = 'No city in the list matches “' + trimmed + '”. Try a nearby city in the same timezone.';
    } else if (trimmed && !availableCities(matches).length) {
      message = 'Every city matching “' + trimmed + '” is already on the clock.';
    }

    searchHint.textContent = message;
    searchHint.classList.toggle('is-hidden', !message);
    if (message) announce(message);
  }

  function renderSearchResults() {
    var results = availableCities(matchCities(searchInput.value)).slice(0, 10);

    filteredResults = results;
    searchResults.innerHTML = '';

    results.forEach(function (item, i) {
      var offset = getTimezoneOffset(item.tz);
      var option = document.createElement('div');
      option.className = 'tool-result';
      option.id = 'world-clock-opt-' + i;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.setAttribute('data-index', i);
      // Named explicitly: the two spans only read as separate words because
      // flex layout blockifies them, and the comma gives a pause before "PDT".
      option.setAttribute('aria-label', offset ? item.city + ', ' + offset : item.city);

      var nameSpan = document.createElement('span');
      nameSpan.textContent = item.city;

      var tzSpan = document.createElement('span');
      tzSpan.className = 'tool-result-meta';
      tzSpan.textContent = offset;

      option.appendChild(nameSpan);
      option.appendChild(tzSpan);
      searchResults.appendChild(option);
    });

    // New rows, so no row is active yet — a stale index would name a row
    // that no longer exists.
    setActive(-1);
    setOpen(results.length > 0);
    updateHint();
  }

  function handleResultClick(e) {
    var option = e.target.closest('.tool-result');
    if (!option) return;
    var item = filteredResults[Number(option.getAttribute('data-index'))];
    if (item) handleAddCity(item);
  }

  /* Keep focus in the input when a row is pressed, so the click lands on
     the option and the combobox never loses its caret. */
  function handleResultMousedown(e) {
    e.preventDefault();
  }

  /* Tabbing on from the field closes the list — left open, it covers the
     tags and presets that Tab reaches next. */
  function handleSearchFocusout(e) {
    if (!searchWrapper.contains(e.relatedTarget)) setOpen(false);
  }

  function handleSearchKeydown(e) {
    if (e.isComposing) return;
    var isOpen = searchResults.classList.contains('is-open');
    var count = filteredResults.length;

    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        if (!searchInput.value.trim()) return;
        renderSearchResults();
        if (!filteredResults.length) return;
        e.preventDefault();
        setActive(0);
        return;
      }
      e.preventDefault();
      setActive(Math.min(highlightIndex + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) return;
      e.preventDefault();
      setActive(highlightIndex <= 0 ? count - 1 : highlightIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && highlightIndex >= 0 && filteredResults[highlightIndex]) {
        handleAddCity(filteredResults[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  /* ---- City Management ---- */

  function getCityLabel(tz) {
    var match = TIMEZONE_LIST.find(function (item) { return item.tz === tz; });
    if (match) return match.city;
    var parts = tz.split('/');
    return parts[parts.length - 1].replace(/_/g, ' ');
  }

  function listLabels(cities) {
    return cities.map(getCityLabel).join(', ');
  }

  // Named for what the clock will show, not what was picked: cities that
  // share a zone share a label in the embed (ROADMAP → World Clock).
  function handleAddCity(item) {
    if (selectedCities.indexOf(item.tz) !== -1) return;
    selectedCities.push(item.tz);
    searchInput.value = '';
    // Through the input event, so the results close and field.js hides the
    // clear in one pass — a script write fires nothing on its own.
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    renderTags();
    scheduleUpdate();
    searchInput.focus();
    announce(getCityLabel(item.tz) + ' added to the clock');
  }

  /* The remove button that had focus is destroyed by the re-render, so focus
     moves to the button now at the same position, else the one before it,
     else the search field once the clock is empty. */
  function handleRemoveCity(tz) {
    var index = selectedCities.indexOf(tz);
    selectedCities = selectedCities.filter(function (c) { return c !== tz; });
    renderTags();
    scheduleUpdate();
    updateHint();

    var buttons = tagContainer.querySelectorAll('[data-role="remove"]');
    var next = buttons[Math.min(index, buttons.length - 1)];
    (next || searchInput).focus();
    announce('Removed ' + getCityLabel(tz));
  }

  function handleTagClick(e) {
    var btn = e.target.closest('[data-role="remove"]');
    if (!btn || !tagContainer.contains(btn)) return;
    handleRemoveCity(btn.getAttribute('data-tz'));
  }

  var GRIP_ICON = '<span class="svg-icn" data-icon="menu"><svg viewBox="0 0 24 24" fill="none" width="100%" height="100%" aria-hidden="true"><path d="M3 18V16H21V18H3ZM3 13V11H21V13H3ZM3 8V6H21V8H3Z" fill="currentColor"/></svg></span>';

  var REMOVE_ICON = '<span class="svg-icn" data-icon="close"><svg viewBox="0 0 24 24" fill="none" width="100%" height="100%" aria-hidden="true"><path d="M7.4 18L6 16.6L9.18579 13.4142C9.96684 12.6332 9.96684 11.3668 9.18579 10.5858L6 7.4L7.4 6L10.5858 9.18579C11.3668 9.96684 12.6332 9.96684 13.4142 9.18579L16.6 6L18 7.4L14.8142 10.5858C14.0332 11.3668 14.0332 12.6332 14.8142 13.4142L18 16.6L16.6 18L13.4142 14.8142C12.6332 14.0332 11.3668 14.0332 10.5858 14.8142L7.4 18Z" fill="currentColor"/></svg></span>';

  var MOVES = [
    { move: 'up', label: 'Move up' },
    { move: 'down', label: 'Move down' },
    { move: 'top', label: 'Move to top' },
    { move: 'bottom', label: 'Move to bottom' }
  ];

  /* The grip is three ways into one action. A pointer drags it; focused, the
     arrow keys, Home and End move the city; clicked, tapped or pressed with
     Enter it opens a menu of the same moves (dropdown.js), which is the path
     for screen readers — their browse mode takes the arrow keys — and for
     anyone who cannot drag. Disabled while there is nothing to reorder. */
  function buildGrip(label, index, canReorder) {
    var last = selectedCities.length - 1;
    var dropdown = document.createElement('div');
    dropdown.className = 'dropdown';

    var grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'button dropdown-trigger tool-grip';
    grip.setAttribute('data-variant', 'transparent');
    grip.setAttribute('data-size', 'small');
    grip.setAttribute('data-icon-only', '');
    grip.setAttribute('aria-label', 'Move ' + label);
    grip.setAttribute('aria-haspopup', 'menu');
    grip.setAttribute('aria-expanded', 'false');
    if (canReorder) grip.setAttribute('aria-describedby', 'world-clock-reorder-help');
    grip.disabled = !canReorder;
    grip.innerHTML = GRIP_ICON;
    dropdown.appendChild(grip);

    if (canReorder) {
      var menu = document.createElement('div');
      menu.className = 'dropdown-menu';
      menu.setAttribute('role', 'menu');
      MOVES.forEach(function (option) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item';
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('data-move', option.move);
        btn.textContent = option.label;
        var atTop = index === 0 && (option.move === 'up' || option.move === 'top');
        var atEnd = index === last && (option.move === 'down' || option.move === 'bottom');
        if (atTop || atEnd) btn.setAttribute('aria-disabled', 'true');
        menu.appendChild(btn);
      });
      dropdown.appendChild(menu);
    }

    return dropdown;
  }

  /* One row per city: a grip to reorder it, name, offset, and an icon button
     to take it off. The list order is the clock's order. */
  function renderTags() {
    tagContainer.innerHTML = '';
    var canReorder = selectedCities.length > 1;

    selectedCities.forEach(function (tz, index) {
      var label = getCityLabel(tz);
      var item = document.createElement('li');
      item.className = 'tool-row';

      item.appendChild(buildGrip(label, index, canReorder));

      var name = document.createElement('span');
      name.className = 'tool-row-name';
      name.textContent = label;
      item.appendChild(name);

      var offset = document.createElement('span');
      offset.className = 'tool-row-meta';
      offset.textContent = getTimezoneOffset(tz);
      item.appendChild(offset);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'button';
      removeBtn.setAttribute('data-role', 'remove');
      removeBtn.setAttribute('data-variant', 'transparent');
      removeBtn.setAttribute('data-size', 'small');
      removeBtn.setAttribute('data-icon-only', '');
      removeBtn.setAttribute('data-tz', tz);
      removeBtn.setAttribute('aria-label', 'Remove ' + label);
      removeBtn.innerHTML = REMOVE_ICON;
      item.appendChild(removeBtn);

      tagContainer.appendChild(item);
    });

    // An empty list says what to do next rather than showing nothing.
    tagContainer.classList.toggle('is-hidden', !selectedCities.length);
    if (cityEmpty) cityEmpty.classList.toggle('is-hidden', selectedCities.length > 0);
  }

  /* ---- Reorder ----
     Two ways to move a city, one outcome: the list is re-rendered in the new
     order and the preview and outputs follow through scheduleUpdate. Pointer
     events, not HTML drag and drop, which touch screens do not reliably
     support. The keyboard path is the grip's arrow keys. */

  function focusGrip(index) {
    var grips = tagContainer.querySelectorAll('.tool-grip');
    if (grips[index]) grips[index].focus();
  }

  /* Clamps the target, so a move past either end says so rather than doing
     nothing in silence. repeat: moving down and back again lands on words
     the region already holds, which would otherwise not be read. */
  function moveCity(from, to) {
    var last = selectedCities.length - 1;
    var label = getCityLabel(selectedCities[from]);
    to = Math.max(0, Math.min(last, to));
    if (to === from) {
      announce(label + (from === 0 ? ' is already first' : ' is already last'), true);
      return;
    }
    var tz = selectedCities.splice(from, 1)[0];
    selectedCities.splice(to, 0, tz);
    renderTags();
    scheduleUpdate();
    focusGrip(to);
    announce(label + ' moved to position ' + (to + 1) + ' of ' + selectedCities.length, true);
  }

  /* A choice from a grip's menu. Deferred a turn, so dropdown.js finishes
     closing its menu and returning focus before the row it lives in is
     re-rendered. */
  function handleMoveSelect(e) {
    var item = e.detail && e.detail.item;
    var move = item && item.getAttribute('data-move');
    if (!move) return;
    var from = gripIndex(e.target.querySelector('.tool-grip'));
    var last = selectedCities.length - 1;
    var to = move === 'up' ? from - 1 : move === 'down' ? from + 1 : move === 'top' ? 0 : last;
    setTimeout(function () { moveCity(from, to); }, 0);
  }

  function gripIndex(grip) {
    var item = grip.closest('.tool-row');
    return Array.prototype.indexOf.call(tagContainer.children, item);
  }

  /* Runs before dropdown.js, which skips a key already handled: on the grip
     the arrows move the city and Enter opens the menu; inside the menu the
     target is an item, so this steps aside. During a drag every key waits,
     and Escape cancels — a move mid-drag would re-render the rows the drag
     is measuring. */
  function handleGripKeydown(e) {
    if (drag) {
      e.preventDefault();
      if (e.key === 'Escape') endDrag(false);
      return;
    }
    if (!e.target.classList.contains('tool-grip') || !tagContainer.contains(e.target)) return;
    // With its menu open, the arrows belong to the menu.
    if (e.target.closest('.dropdown.is-open')) return;
    var from = gripIndex(e.target);
    var to = e.key === 'ArrowUp' ? from - 1
      : e.key === 'ArrowDown' ? from + 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? selectedCities.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    moveCity(from, to);
  }

  function handleGripPointerDown(e) {
    var grip = e.target.closest('.tool-grip');
    if (!grip || grip.disabled || !tagContainer.contains(grip)) return;
    if (e.button !== 0 || drag) return;
    e.preventDefault();

    var items = Array.prototype.slice.call(tagContainer.children);
    var from = gripIndex(grip);
    var first = items[0].getBoundingClientRect();
    var second = items[1].getBoundingClientRect();

    drag = {
      pointerId: e.pointerId,
      grip: grip,
      items: items,
      item: items[from],
      from: from,
      to: from,
      startY: e.clientY,
      // Nothing lifts until the pointer travels DRAG_THRESHOLD, so a click
      // or tap stays a click and opens the menu.
      active: false,
      // Distance from one row to the next, gap included.
      pitch: second.top - first.top
    };

    grip.setPointerCapture(e.pointerId);
    grip.focus();
  }

  /* The dragged row follows the pointer, held inside the list; the rows it
     passes step aside by one pitch to show where it will land. */
  function handleGripPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.active = true;
      drag.item.classList.add('is-dragging');
      tagContainer.classList.add('is-sorting');
    }
    var min = -drag.from * drag.pitch;
    var max = (drag.items.length - 1 - drag.from) * drag.pitch;
    var dy = Math.max(min, Math.min(max, e.clientY - drag.startY));
    drag.item.style.transform = 'translateY(' + dy + 'px)';

    var to = drag.from + Math.round(dy / drag.pitch);
    if (to === drag.to) return;
    drag.to = to;
    drag.items.forEach(function (el, i) {
      if (el === drag.item) return;
      var shift = 0;
      if (drag.from < to && i > drag.from && i <= to) shift = -drag.pitch;
      if (drag.from > to && i >= to && i < drag.from) shift = drag.pitch;
      el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  function endDrag(commit) {
    if (!drag) return;
    var state = drag;
    drag = null;
    tagContainer.classList.remove('is-sorting');
    state.items.forEach(function (el) { el.style.transform = ''; });
    state.item.classList.remove('is-dragging');
    if (!state.active) return;
    // A real drag ends in a click, and it must not open the menu. Held until
    // the pointer is released — an Escape cancel comes before that — and
    // cleared a turn after release, once the click has been and gone.
    suppressGripClick = true;
    if (commit && state.to !== state.from) {
      moveCity(state.from, state.to);
    } else {
      state.grip.focus();
    }
  }

  function handleGripPointerUp(e) {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
    if (suppressGripClick) setTimeout(function () { suppressGripClick = false; }, 0);
  }

  function handleGripPointerCancel(e) {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  }

  // Capture lost any other way — the grip removed, the window blurred —
  // cancels. After a normal pointerup drag is already null, so this is inert.
  function handleGripLostCapture(e) {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  }

  // Capture phase on the list, so it runs before dropdown.js's document
  // listener sees the click.
  function handleGripClickCapture(e) {
    if (!suppressGripClick) return;
    suppressGripClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  /* ---- Presets ---- */

  function handlePresetClick(e) {
    var btn = e.target.closest('[data-preset]');
    if (!btn || !presetContainer.contains(btn)) return;
    var preset = PRESETS[Number(btn.getAttribute('data-preset'))];
    if (!preset) return;
    selectedCities = preset.cities.slice();
    renderTags();
    scheduleUpdate();
    updateHint();
    announce(preset.label + ': ' + listLabels(selectedCities));
  }

  // Emptied first: init can run twice on one container on a hard load.
  function renderPresets() {
    presetContainer.innerHTML = '';
    PRESETS.forEach(function (preset, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button';
      btn.setAttribute('data-variant', 'outline-faded');
      btn.setAttribute('data-full-width', '');
      btn.setAttribute('data-preset', i);
      btn.textContent = preset.label;
      presetContainer.appendChild(btn);
    });
  }

  /* ---- Options ---- */

  /* The theme is the radio-backed segmented control in Style, so the state
     and the arrow keys are the component's. */
  function getTheme() {
    if (!themeControl) return 'light';
    var checked = themeControl.querySelector('input[name="world-clock-theme"]:checked');
    return (checked && checked.value) || 'light';
  }

  function setTheme(value) {
    if (!themeControl) return;
    var input = themeControl.querySelector('input[name="world-clock-theme"][value="' + value + '"]');
    if (input) input.checked = true;
  }

  /* ---- Style reset ----
     Always there, disabled at the defaults (cms/tool-canvas.md, Section
     reset). A disabled button drops focus; tool-canvas.js moves it to the
     section's heading. */

  function isStyleDefault() {
    return (!optShowCity || optShowCity.checked === optShowCity.defaultChecked)
      && (!optShowTz || optShowTz.checked === optShowTz.defaultChecked)
      && (!optShowSeconds || optShowSeconds.checked === optShowSeconds.defaultChecked)
      && getTheme() === 'light';
  }

  function syncResets() {
    if (styleReset) styleReset.disabled = isStyleDefault();
  }

  function applyStyleDefaults() {
    if (optShowCity) optShowCity.checked = optShowCity.defaultChecked;
    if (optShowTz) optShowTz.checked = optShowTz.defaultChecked;
    if (optShowSeconds) optShowSeconds.checked = optShowSeconds.defaultChecked;
    setTheme('light');
  }

  function handleStyleReset() {
    applyStyleDefaults();
    scheduleUpdate();
    announce('Style reset: city and timezone shown, no seconds, light theme.');
  }

  function getOptions() {
    return {
      cities: selectedCities,
      showCity: optShowCity ? optShowCity.checked : true,
      showTz: optShowTz ? optShowTz.checked : true,
      showSeconds: optShowSeconds ? optShowSeconds.checked : false,
      theme: getTheme()
    };
  }

  /* ---- Preview & Output ---- */

  function buildEmbedUrl(opts) {
    /* The embed sits beside the tool page, so derive its URL from the
       page's own directory — right on the Worker, under Live Server, and on
       any other host a deployment uses. */
    var dir = window.location.pathname.replace(/[^/]*$/, '');
    var base = window.location.origin + dir + 'world-clock-embed.html';
    var params = [];

    if (opts.cities.length > 0) {
      params.push('cities=' + encodeURIComponent(opts.cities.join(',')));
    }
    if (!opts.showCity) params.push('showCity=false');
    if (!opts.showTz) params.push('showTz=false');
    if (opts.showSeconds) params.push('showSeconds=true');
    if (opts.theme === 'dark') params.push('theme=dark');

    return base + (params.length ? '?' + params.join('&') : '');
  }

  /* color-scheme: light matches the embed document, which declares none. A
     host page in dark mode would otherwise hand the iframe a dark scheme, and
     the mismatch makes the browser paint an opaque canvas behind the clock. */
  function buildIframeSnippet(url) {
    return '<iframe src="' + url + '" width="100%" height="140" frameborder="0" style="border:none;color-scheme:light;"></iframe>';
  }

  /* The outputs update at once, so a copy made straight after a change never
     takes the previous settings; only the iframe reload is debounced. */
  function updateOutputs() {
    var opts = getOptions();
    currentUrl = buildEmbedUrl(opts);

    /* The preview is the surface the clock sits on — dark clock, dark ground
       (tools.css, Grounds) */
    if (previewStage) {
      previewStage.dataset.ground = opts.theme === 'dark' ? 'dark' : 'light';
    }

    /* The two Export readouts are what the verbs copy (copy-button.js reads
       a target's value). */
    if (urlOutput) urlOutput.value = currentUrl;
    if (embedOutput) embedOutput.value = buildIframeSnippet(currentUrl);
    syncResets();
    return currentUrl;
  }

  function reloadPreview() {
    previewTimer = null;
    if (previewIframe && currentUrl) previewIframe.src = currentUrl;
  }

  function scheduleUpdate() {
    updateOutputs();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(reloadPreview, PREVIEW_DEBOUNCE_MS);
  }

  /* ---- Reset all ---- */

  function handleResetAll() {
    selectedCities = DEFAULT_CITIES.slice();
    applyStyleDefaults();
    renderTags();
    scheduleUpdate();
    updateHint();
    announce('Everything reset: ' + listLabels(selectedCities));
  }

  /* ---- Close search on outside click ---- */

  function handleDocumentClick(e) {
    // Bound to the document, so it outlives the page — do nothing once the
    // tool has been navigated away from.
    if (!searchInput || !searchInput.isConnected) return;
    if (!searchWrapper.contains(e.target)) setOpen(false);
  }

  /* ---- Initialization ---- */

  function initWorldClock() {
    /* Bind DOM — bail if this page isn't the world-clock tool */
    searchInput = document.getElementById('world-clock-search');
    if (!searchInput) return;

    searchWrapper = searchInput.closest('[data-role="search"]');
    searchResults = document.getElementById('world-clock-search-results');
    searchHint = document.getElementById('world-clock-search-hint');
    statusRegion = document.getElementById('world-clock-status');
    tagContainer = document.getElementById('world-clock-cities');
    cityEmpty = document.getElementById('world-clock-empty');
    presetContainer = document.getElementById('world-clock-presets');
    previewStage = document.querySelector('[data-tool="world-clock"] .tool-preview');
    previewIframe = document.getElementById('world-clock-frame');
    urlOutput = document.getElementById('world-clock-url');
    embedOutput = document.getElementById('world-clock-embed-code');
    styleReset = document.getElementById('world-clock-style-reset');
    optShowCity = document.getElementById('world-clock-show-city');
    optShowTz = document.getElementById('world-clock-show-tz');
    optShowSeconds = document.getElementById('world-clock-show-seconds');
    themeControl = document.getElementById('world-clock-theme');

    /* Reset state for fresh container — Barba arrival means new DOM */
    selectedCities = DEFAULT_CITIES.slice();
    highlightIndex = -1;
    filteredResults = [];
    clearTimeout(previewTimer);
    clearTimeout(announceTimer);
    previewTimer = null;
    currentUrl = '';
    drag = null;
    suppressGripClick = false;

    /* Search. Named handlers, so a second init on the same nodes adds nothing. */
    searchInput.addEventListener('input', renderSearchResults);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    searchWrapper.addEventListener('focusout', handleSearchFocusout);
    searchResults.addEventListener('click', handleResultClick);
    searchResults.addEventListener('mousedown', handleResultMousedown);
    tagContainer.addEventListener('click', handleTagClick);
    tagContainer.addEventListener('keydown', handleGripKeydown);
    tagContainer.addEventListener('pointerdown', handleGripPointerDown);
    tagContainer.addEventListener('pointermove', handleGripPointerMove);
    tagContainer.addEventListener('pointerup', handleGripPointerUp);
    tagContainer.addEventListener('pointercancel', handleGripPointerCancel);
    tagContainer.addEventListener('lostpointercapture', handleGripLostCapture);
    tagContainer.addEventListener('click', handleGripClickCapture, true);
    tagContainer.addEventListener('dropdown-select', handleMoveSelect);

    /* Options */
    [optShowCity, optShowTz, optShowSeconds].forEach(function (el) {
      if (el) el.addEventListener('change', scheduleUpdate);
    });

    /* The radios' change bubbles to the group. */
    if (themeControl) themeControl.addEventListener('change', scheduleUpdate);

    /* The section reset's click arrives as tool:panel-reset (tool-canvas.js). */
    if (styleReset) styleReset.addEventListener('tool:panel-reset', handleStyleReset);

    /* Menu item — bar.js moves the node into the overflow panel, so it is
       found by id wherever it sits. */
    var resetBtn = document.getElementById('world-clock-reset');
    if (resetBtn) resetBtn.addEventListener('click', handleResetAll);

    /* Outside click. handleDocumentClick is one module-scope function, and
       addEventListener ignores an identical (target, type, listener) pair, so
       Barba round-trips cannot stack it — keep it a named declaration, never
       a closure, or that stops being true. */
    document.addEventListener('click', handleDocumentClick);

    /* Presets */
    if (presetContainer) {
      renderPresets();
      presetContainer.addEventListener('click', handlePresetClick);
    }

    /* Initial render */
    renderTags();
    updateOutputs();
    reloadPreview();

    console.log('[WorldClock Tool] init');
  }

  window.initWorldClock = initWorldClock;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initWorldClock bails when its markup is absent.
  function startWorldClock() {
    initWorldClock();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startWorldClock);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWorldClock);
  } else {
    startWorldClock();
  }

})();
