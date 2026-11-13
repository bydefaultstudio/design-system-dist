/**
 * World Clock Core — shared rendering logic
 * Loaded only by the standalone embed page; the tool page shows that page in
 * an iframe as its preview.
 * Version: 1.1.0
 */

var WorldClockCore = (function () {
  'use strict';

  var VERSION = '1.1.1';
  var intervalId = null;
  var rootEl = null;
  var currentOptions = null;

  console.log('[WorldClockCore] v' + VERSION);

  /* ---- Utility Functions ---- */

  function getCityName(timezone) {
    var parts = timezone.split('/');
    return parts[parts.length - 1].replace(/_/g, ' ');
  }

  function getTimezoneAbbr(date, timezone) {
    try {
      var formatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
      var parts = formatter.formatToParts(date);
      var tzPart = parts.find(function (p) { return p.type === 'timeZoneName'; });
      return tzPart ? tzPart.value : '';
    } catch (e) {
      return '';
    }
  }

  function formatTime(date, timezone, showSeconds) {
    try {
      // A 24-hour clock in every locale: hourCycle, not hour12, which en-US
      // reads as h24 and shows midnight as 24:00
      var opts = {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      };
      if (showSeconds) { opts.second = '2-digit'; }
      // The site's locale (bd-locale.js), en-GB without it
      var tag = (window.bdLocale && window.bdLocale.tag) || 'en-GB';
      return new Intl.DateTimeFormat(tag, opts).format(date);
    } catch (e) {
      return showSeconds ? '--:--:--' : '--:--';
    }
  }

  /* ---- DOM Creation ---- */

  /* City and timezone share a header row above the time — city left,
     timezone right. The row is left out when both are switched off. */
  function createClockColumn(timezone, options) {
    var now = new Date();
    var column = document.createElement('div');
    column.className = 'clock-column';
    column.setAttribute('data-timezone', timezone);

    var showCity = options.showCity !== false;
    var showTimezone = options.showTimezone !== false;

    if (showCity || showTimezone) {
      var header = document.createElement('div');
      header.className = 'clock-header';

      var cityEl = document.createElement('div');
      cityEl.className = 'clock-city';
      cityEl.textContent = showCity ? getCityName(timezone) : '';
      header.appendChild(cityEl);

      if (showTimezone) {
        var tzEl = document.createElement('div');
        tzEl.className = 'clock-timezone';
        tzEl.textContent = getTimezoneAbbr(now, timezone);
        header.appendChild(tzEl);
      }

      column.appendChild(header);
    }

    var timeEl = document.createElement('time');
    timeEl.className = 'clock-time';
    timeEl.setAttribute('datetime', now.toISOString());
    timeEl.textContent = formatTime(now, timezone, options.showSeconds);
    column.appendChild(timeEl);

    return column;
  }

  /* ---- Update Loop ---- */

  function updateClockTimes() {
    if (!rootEl || !currentOptions) return;
    var now = new Date();
    var columns = rootEl.querySelectorAll('.clock-column');

    columns.forEach(function (col) {
      var tz = col.getAttribute('data-timezone');
      var timeEl = col.querySelector('.clock-time');
      if (timeEl && tz) {
        timeEl.textContent = formatTime(now, tz, currentOptions.showSeconds);
        timeEl.setAttribute('datetime', now.toISOString());
      }
      var tzEl = col.querySelector('.clock-timezone');
      if (tzEl && tz) {
        tzEl.textContent = getTimezoneAbbr(now, tz);
      }
    });
  }

  /* ---- Public API ---- */

  /* The embed is public and takes its options from a URL anyone can edit, so
     both are bounded: a dozen clocks is more than one row can show, and an
     interval outside 1s–1h (negative, or past setInterval's 2^31 ms limit)
     would spin a tight loop inside the host page. */
  var MAX_CITIES = 12;
  var MIN_INTERVAL_MS = 1000;
  var MAX_INTERVAL_MS = 3600000;

  function init(el, options) {
    rootEl = el;
    currentOptions = options || {};

    var cities = (currentOptions.cities || ['Europe/London']).slice(0, MAX_CITIES);
    var defaultInterval = currentOptions.showSeconds ? 1000 : 60000;
    var requested = currentOptions.interval;
    var interval = Number.isFinite(requested) && requested >= MIN_INTERVAL_MS && requested <= MAX_INTERVAL_MS
      ? requested
      : defaultInterval;

    /* Build DOM */
    var container = document.createElement('div');
    container.className = 'clock-container';

    var row = document.createElement('div');
    row.className = 'clock-row';

    cities.forEach(function (tz) {
      try {
        /* Validate timezone by attempting to format */
        new Intl.DateTimeFormat('en', { timeZone: tz });
        row.appendChild(createClockColumn(tz, currentOptions));
      } catch (e) {
        console.warn('[WorldClockCore] Invalid timezone, skipping:', tz);
      }
    });

    /* A link whose every zone is invalid would otherwise render an empty,
       transparent frame. Say what is wrong instead. */
    if (!row.children.length) {
      var empty = document.createElement('p');
      empty.className = 'clock-empty';
      empty.textContent = 'This clock link has no valid time zones. Make a new one in the World Clock tool.';
      row.appendChild(empty);
    }

    /* Inputs to the time's fit-the-row size in the embed's CSS */
    row.style.setProperty('--clock-count', String(Math.max(row.children.length, 1)));
    row.style.setProperty('--clock-ems', currentOptions.showSeconds ? '4.5' : '2.9');

    container.appendChild(row);
    rootEl.innerHTML = '';
    rootEl.appendChild(container);

    /* Start update loop */
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(updateClockTimes, interval);

    console.log('[WorldClockCore] Initialized with', row.querySelectorAll('.clock-column').length, 'cities');
  }

  function destroy() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (rootEl) {
      rootEl.innerHTML = '';
      rootEl = null;
    }
    currentOptions = null;
  }

  function update(options) {
    if (!rootEl) return;
    destroy();
    var el = rootEl || document.getElementById('clock-root');
    init(el, options);
  }

  return {
    init: init,
    destroy: destroy,
    update: update
  };

})();
