/**
 * cpm-calculator.js — CPM Calculator
 *
 * Plans a campaign from a spend or an impressions goal at a CPM, with
 * optional creative and ad hosting fees, a partner's share, and a monthly
 * breakdown. The dock holds the controls and, in a custom plan, the months;
 * the preview shows the figures and, while the breakdown is on, the month
 * table. Copy table copies that table, or the campaign statement the
 * figures show while it is off.
 *
 * One computation, three readers. computePlan(state) is pure (no DOM) and
 * returns the rows and totals the preview, the figures and the copied table
 * all read, so they cannot disagree. Money is integer pence throughout and
 * impressions are whole numbers wherever they are typed, so an even split
 * always sums to its total exactly.
 *
 * State lives in the URL (debounced history.replaceState) and in saved plans
 * (localStorage), both through toParams / fromParams. fromParams reads the
 * 2.x parameters too: a link or a save made before the breakdown switch
 * existed opens as the plan it described.
 *
 * Self-registered: inits on DOMContentLoaded and on bd:after-nav, scoped to
 * the incoming container. The root is the last [data-tool="cpm-calculator"]
 * in scope and carries a dataset guard, so two containers alive at once
 * never wire the outgoing one. Every lookup goes through the root.
 *
 * Exposes window.CpmCalculator (the pure functions) for
 * scripts/verify-cpm-calculator.js and window.initCpmCalculator.
 *
 * @version 3.1.0
 */

(function () {
  'use strict';

  var VERSION = '3.1.0';
  var TOOL_SELECTOR = '[data-tool="cpm-calculator"]';
  var STORAGE_KEY = 'cpm-calculator-saves';
  var URL_DELAY = 250;
  var MAX_LENGTH = 24;
  // Spend above this loses pence precision in a double; nobody plans it.
  var MAX_SPEND = 1e12;
  var MAX_IMPRESSIONS = 1e15;
  // A start month outside these years is a broken link, not a plan.
  var MIN_YEAR = 1970;
  var MAX_YEAR = 2200;

  console.log('[CPM Calculator] v' + VERSION + ' loaded');

  var DEFAULTS = {
    by: 'spend',
    spend: 300000,
    impressions: 20000000,
    cpm: 15,
    currency: 'GBP',
    length: 12,
    spread: 'even',
    feeCpm: 1,
    share: 70
  };

  var CURRENCIES = {
    GBP: { code: 'GBP', symbol: '£', locale: 'en-GB' },
    USD: { code: 'USD', symbol: '$', locale: 'en-US' }
  };

  var MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  var MINUS = '−';

  //
  //------- Numbers -------//
  //

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // A field's value as a number, or null while it is empty or not a number.
  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = parseFloat(value);
    return isFinite(n) ? n : null;
  }

  function sum(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total;
  }

  // Integer units split across n months: the first (total mod n) months take
  // one unit more, so the parts always sum to the total.
  function splitEven(total, n) {
    var out = [];
    if (n < 1) return out;
    var base = Math.floor(total / n);
    var extra = total - base * n;
    for (var i = 0; i < n; i++) out.push(base + (i < extra ? 1 : 0));
    return out;
  }

  // Exact amounts rounded to integers as a column: the total is rounded
  // once, each row takes its floor, and the units left over go to the rows
  // with the largest fractions (the largest-remainder method), earliest
  // first on a tie. The parts always sum to the rounded total.
  function apportion(exacts) {
    var floors = exacts.map(Math.floor);
    var left = Math.round(sum(exacts)) - sum(floors);
    var order = exacts.map(function index(v, i) { return i; }).sort(function byFraction(a, b) {
      return (exacts[b] - floors[b]) - (exacts[a] - floors[a]) || a - b;
    });
    for (var i = 0; i < left && i < order.length; i++) floors[order[i]] += 1;
    return floors;
  }

  //
  //------- Months -------//
  //

  function monthKey(year, monthIndex) {
    return year + '-' + (monthIndex < 9 ? '0' : '') + (monthIndex + 1);
  }

  function thisMonth(now) {
    var d = now || new Date();
    return monthKey(d.getFullYear(), d.getMonth());
  }

  function parseMonthKey(key) {
    var match = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!match) return null;
    var month = parseInt(match[2], 10) - 1;
    var year = parseInt(match[1], 10);
    if (month < 0 || month > 11 || year < MIN_YEAR || year > MAX_YEAR) return null;
    return { year: year, month: month };
  }

  function addMonths(key, n) {
    var p = parseMonthKey(key);
    var index = p.year * 12 + p.month + n;
    return monthKey(Math.floor(index / 12), index % 12);
  }

  // 'short' Oct 2026 · 'long' October 2026
  function monthLabel(key, style) {
    var p = parseMonthKey(key);
    if (!p) return '';
    return (style === 'long' ? MONTHS_LONG : MONTHS_SHORT)[p.month] + ' ' + p.year;
  }

  //
  //------- State -------//
  //

  function defaultState(now) {
    return {
      by: DEFAULTS.by,
      spend: DEFAULTS.spend,
      impressions: DEFAULTS.impressions,
      cpm: DEFAULTS.cpm,
      currency: DEFAULTS.currency,
      monthly: { on: false, start: thisMonth(now), length: DEFAULTS.length, spread: DEFAULTS.spread, values: [] },
      fees: {
        creative: { on: false, cpm: DEFAULTS.feeCpm },
        hosting: { on: false, cpm: DEFAULTS.feeCpm }
      },
      partner: { on: false, name: '', share: DEFAULTS.share }
    };
  }

  // The values typed month by month, fitted to the plan's length.
  function fitValues(values, length) {
    var out = [];
    for (var i = 0; i < length; i++) {
      var v = values && values[i];
      out.push(typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : 0);
    }
    return out;
  }

  // The planned quantity's total in integer units: pence when planning by
  // spend, whole impressions when planning by impressions.
  function typedTotalUnits(state) {
    if (state.by === 'impressions') return Math.round(clamp(state.impressions || 0, 0, MAX_IMPRESSIONS));
    return Math.round(clamp(state.spend || 0, 0, MAX_SPEND) * 100);
  }

  //
  //------- Plan -------//
  //

  function partnerLabel(state) {
    var name = (state.partner.name || '').trim();
    return name || 'Partner';
  }

  function computePlan(state) {
    var cpm = state.cpm > 0 ? state.cpm : 0;
    var valid = cpm > 0;
    var bySpend = state.by !== 'impressions';
    var creativeOn = state.fees.creative.on;
    var hostingOn = state.fees.hosting.on;
    var partnerOn = state.partner.on;
    var creativeCpm = creativeOn ? Math.max(0, state.fees.creative.cpm || 0) : 0;
    var hostingCpm = hostingOn ? Math.max(0, state.fees.hosting.cpm || 0) : 0;
    var share = partnerOn ? clamp(state.partner.share || 0, 0, 100) : 0;

    var monthly = state.monthly.on;
    var length = clamp(Math.round(state.monthly.length) || DEFAULTS.length, 1, MAX_LENGTH);
    var start = parseMonthKey(state.monthly.start) ? state.monthly.start : thisMonth();
    var custom = monthly && state.monthly.spread === 'custom';

    // The units of each row: the months, or the whole campaign as one row.
    // Units are pence when planning by spend, impressions otherwise.
    var units = !monthly
      ? [typedTotalUnits(state)]
      : custom ? fitValues(state.monthly.values, length) : splitEven(typedTotalUnits(state), length);

    // Every amount is worked out exactly, then rounded to the penny as a
    // column: the column's exact total is rounded once and the rows share it
    // (apportion), so six months of a £20,000 fee are £20,000, not
    // 6 × £3,333.33. A total is always the sum of its rows.
    var impressions = units.map(function rowImpressions(u) {
      if (!bySpend) return u;
      return valid ? u / 100 / cpm * 1000 : 0;
    });
    var spend = bySpend ? units.slice() : apportion(impressions.map(function exactSpend(imp) {
      return valid ? imp * cpm / 10 : 0;
    }));
    // impressions ÷ 1000 × fee CPM, in pence
    var creative = apportion(impressions.map(function exactCreative(imp) { return imp * creativeCpm / 10; }));
    var hosting = apportion(impressions.map(function exactHosting(imp) { return imp * hostingCpm / 10; }));
    var netSpend = spend.map(function rowNetSpend(sp, i) { return sp - creative[i] - hosting[i]; });
    var partner = partnerOn
      ? apportion(netSpend.map(function exactPartner(ns) { return ns * share / 100; }))
      : netSpend.map(function noPartner() { return 0; });
    // Impressions worked out from a spend are fractional; the fees read the
    // exact figure, and what is shown is apportioned like money, so the
    // column adds up to its total.
    var shown = bySpend ? apportion(impressions) : impressions;

    var rows = units.map(function buildRow(u, i) {
      return {
        key: monthly ? addMonths(start, i) : null,
        units: u,
        spend: spend[i],
        impressions: impressions[i],
        shown: shown[i],
        creative: creative[i],
        hosting: hosting[i],
        netSpend: netSpend[i],
        partner: partner[i],
        net: netSpend[i] - partner[i]
      };
    });
    var totals = { units: 0, spend: 0, impressions: 0, shown: 0, creative: 0, hosting: 0, netSpend: 0, partner: 0, net: 0 };
    rows.forEach(function addRow(r) {
      Object.keys(totals).forEach(function addField(field) { totals[field] += r[field]; });
    });
    if (!monthly) rows = [];

    var errors = {};
    if (!valid) {
      errors.cpm = 'Enter a CPM above 0.';
    } else if (creativeCpm + hostingCpm > cpm) {
      errors.fees = 'Fees add up to ' + formatRate(creativeCpm + hostingCpm, state.currency) +
        ' CPM, more than the ' + formatRate(cpm, state.currency) +
        ' campaign CPM, so net spend is negative.';
    }

    return {
      valid: valid,
      bySpend: bySpend,
      currency: CURRENCIES[state.currency] ? state.currency : DEFAULTS.currency,
      monthly: monthly,
      custom: custom,
      start: start,
      length: length,
      end: monthly ? addMonths(start, length - 1) : null,
      rows: rows,
      totals: totals,
      creativeOn: creativeOn,
      hostingOn: hostingOn,
      partnerOn: partnerOn,
      creativeCpm: creativeCpm,
      hostingCpm: hostingCpm,
      share: share,
      partnerLabel: partnerLabel(state),
      split: computeSplit(totals, valid, creativeOn, hostingOn, partnerOn, partnerLabel(state)),
      errors: errors
    };
  }

  // Where the spend goes: the parts always sum to the spend, so each is a
  // share of it. Shown only with two parts or more, all of them positive.
  function computeSplit(totals, valid, creativeOn, hostingOn, partnerOn, partnerName) {
    var parts = [];
    if (creativeOn) parts.push({ key: 'creative', label: 'Creative fee', value: totals.creative });
    if (hostingOn) parts.push({ key: 'hosting', label: 'Ad hosting', value: totals.hosting });
    if (partnerOn) parts.push({ key: 'partner', label: partnerName, value: totals.partner });
    parts.push({ key: 'net', label: 'Net', value: totals.net });
    var show = valid && parts.length > 1 && totals.spend > 0 &&
      parts.every(function isPositive(p) { return p.value >= 0; });
    parts.forEach(function percent(p) {
      p.percent = totals.spend > 0 ? p.value / totals.spend * 100 : 0;
    });
    return { show: show, parts: parts };
  }

  //
  //------- Formatting -------//
  //

  var formatters = {};

  function formatter(currency, kind) {
    var key = currency + kind;
    if (!formatters[key]) {
      var config = CURRENCIES[currency] || CURRENCIES.GBP;
      formatters[key] = kind === 'money'
        ? new Intl.NumberFormat(config.locale, { style: 'currency', currency: config.code, minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : kind === 'rate'
          ? new Intl.NumberFormat(config.locale, { style: 'currency', currency: config.code, minimumFractionDigits: 0, maximumFractionDigits: 2 })
          : new Intl.NumberFormat(config.locale, { maximumFractionDigits: 0 });
    }
    return formatters[key];
  }

  function withMinus(text) {
    return text.replace(/^-/, MINUS);
  }

  function formatMoney(pence, currency) {
    return withMinus(formatter(currency, 'money').format(pence / 100));
  }

  function formatRate(value, currency) {
    return formatter(currency, 'rate').format(value);
  }

  function formatCount(value, currency) {
    return formatter(currency, 'count').format(Math.round(value));
  }

  function formatPercent(value) {
    return (Math.round(value * 10) / 10).toFixed(1) + '%';
  }

  function formatShare(value) {
    return String(Math.round(value * 100) / 100) + '%';
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  //
  //------- The table, as data -------//
  //

  // The one table the preview shows, as rows of cells. Each cell carries the
  // text the preview prints and the raw number a spreadsheet should get, so
  // the preview and Copy table read the same thing.
  //   { text, number, kind: 'label'|'money'|'count', negative }
  function moneyCell(pence, plan, sign) {
    if (!plan.valid) return { text: '–', number: null, kind: 'money' };
    var value = (sign || 1) * pence;
    // A deduction prints with a minus but is not a fault: only an amount
    // that is itself below zero (net spend under the fees) takes the error
    // ink.
    return { text: formatMoney(value, plan.currency), number: value / 100, kind: 'money', negative: pence < 0 };
  }

  function countCell(value, plan) {
    if (!plan.valid) return { text: '–', number: null, kind: 'count' };
    return { text: formatCount(value, plan.currency), number: Math.round(value), kind: 'count' };
  }

  // The typed quantity is never a dash: it is what the reader entered.
  function typedMoneyCell(pence, plan) {
    return { text: formatMoney(pence, plan.currency), number: pence / 100, kind: 'money' };
  }

  function typedCountCell(value, plan) {
    return { text: formatCount(value, plan.currency), number: Math.round(value), kind: 'count' };
  }

  function spendCell(r, plan) {
    return plan.bySpend ? typedMoneyCell(r.spend, plan) : moneyCell(r.spend, plan);
  }

  function impressionsCell(r, plan) {
    return plan.bySpend ? countCell(r.shown, plan) : typedCountCell(r.shown, plan);
  }

  function monthColumns(plan) {
    var cols = [
      { key: 'spend', label: 'Spend', money: true },
      { key: 'impressions', label: 'Impressions', money: false }
    ];
    if (plan.creativeOn) cols.push({ key: 'creative', label: 'Creative fee', money: true });
    if (plan.hostingOn) cols.push({ key: 'hosting', label: 'Ad hosting', money: true });
    if (plan.partnerOn) cols.push({ key: 'partner', label: plan.partnerLabel, money: true });
    cols.push({ key: 'net', label: 'Net', money: true, emphasis: true });
    return cols;
  }

  function monthCell(r, col, plan) {
    if (col.key === 'spend') return spendCell(r, plan);
    if (col.key === 'impressions') return impressionsCell(r, plan);
    return moneyCell(r[col.key], plan);
  }

  // { kind: 'months'|'statement', caption, head:[], body:[[cell]], foot:[[cell]] }
  function tableData(plan) {
    if (plan.monthly) {
      var cols = monthColumns(plan);
      return {
        kind: 'months',
        caption: 'Monthly breakdown, ' + monthLabel(plan.start, 'long') + ' to ' + monthLabel(plan.end, 'long'),
        columns: cols,
        head: ['Month'].concat(cols.map(function colLabel(c) { return c.label; })),
        body: plan.rows.map(function monthRow(r) {
          return [{ text: monthLabel(r.key, 'short'), kind: 'label', long: monthLabel(r.key, 'long') }]
            .concat(cols.map(function cell(c) { return monthCell(r, c, plan); }));
        }),
        foot: [[{ text: 'Total', kind: 'label' }].concat(cols.map(function totalCell(c) { return monthCell(plan.totals, c, plan); }))]
      };
    }

    var t = plan.totals;
    var body = [
      [{ text: 'Campaign spend', kind: 'label' }, spendCell(t, plan)],
      [{ text: 'Impressions', kind: 'label' }, impressionsCell(t, plan)]
    ];
    if (plan.creativeOn) body.push([{ text: 'Creative fee (' + formatRate(plan.creativeCpm, plan.currency) + ' CPM)', kind: 'label' }, moneyCell(t.creative, plan, -1)]);
    if (plan.hostingOn) body.push([{ text: 'Ad hosting (' + formatRate(plan.hostingCpm, plan.currency) + ' CPM)', kind: 'label' }, moneyCell(t.hosting, plan, -1)]);
    if (plan.creativeOn || plan.hostingOn) body.push([{ text: 'Net spend', kind: 'label' }, moneyCell(t.netSpend, plan)]);
    if (plan.partnerOn) body.push([{ text: plan.partnerLabel + ' (' + formatShare(plan.share) + ')', kind: 'label' }, moneyCell(t.partner, plan, -1)]);
    var netLabel = plan.partnerOn ? 'Net (' + formatShare(100 - plan.share) + ')' : 'Net';
    return {
      kind: 'statement',
      caption: 'Campaign total',
      head: ['Item', 'Amount'],
      body: body,
      foot: [[{ text: netLabel, kind: 'label' }, moneyCell(t.net, plan)]]
    };
  }

  //
  //------- Copy table -------//
  //

  // A spreadsheet reads a cell that starts with = + - @ as a formula. A label
  // is text the reader typed (the partner's name), so it is defused; numbers
  // are written raw and never start with anything but a digit or a minus.
  function safeText(text) {
    var clean = String(text).replace(/[\t\r\n]+/g, ' ');
    return /^[=+\-@]/.test(clean) ? "'" + clean : clean;
  }

  function headWithCurrency(data, plan) {
    var code = plan.currency;
    if (data.kind === 'statement') return ['Item', 'Value (' + code + ')'];
    return data.head.map(function label(text, i) {
      var col = data.columns[i - 1];
      return col && col.money ? text + ' (' + code + ')' : text;
    });
  }

  function tsvCell(cell) {
    if (cell.kind === 'label') return safeText(cell.text);
    if (cell.number === null) return '';
    return cell.kind === 'money' ? cell.number.toFixed(2) : String(cell.number);
  }

  function toTsv(plan) {
    var data = tableData(plan);
    var lines = [headWithCurrency(data, plan).map(safeText).join('\t')];
    data.body.concat(data.foot).forEach(function line(cells) {
      lines.push(cells.map(tsvCell).join('\t'));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // For a document the table carries its formatted text. Two spreadsheet
  // hints ride along so a sheet still gets a number, not "£300,000.00" as
  // text: data-sheets-value (Google Sheets' own clipboard markup) and x:num
  // (Excel's). A document ignores both.
  // A label is defused as in the TSV, since a sheet reads a pasted table's
  // text as it reads typed text; a number's minus is the plain one a sheet
  // parses, not the typographic one the preview prints.
  function htmlCell(cell, tag) {
    var style = cell.kind === 'label' ? 'text-align:left;' : 'text-align:right;';
    var attrs = '';
    var text = cell.kind === 'label' ? safeText(cell.text) : cell.text.replace(MINUS, '-');
    if (cell.kind !== 'label' && cell.number !== null) {
      attrs = ' data-sheets-value="' + escapeHTML(JSON.stringify({ 1: 3, 3: cell.number })) + '" x:num="' + cell.number + '"';
    }
    return '<' + tag + ' style="' + style + 'padding:4px 12px;"' + attrs + '>' + escapeHTML(text) + '</' + tag + '>';
  }

  function toHtml(plan) {
    var data = tableData(plan);
    var head = data.head.map(function headCell(text, i) {
      return '<th style="text-align:' + (i === 0 ? 'left' : 'right') + ';padding:4px 12px;">' + escapeHTML(safeText(text)) + '</th>';
    }).join('');
    var body = data.body.map(function bodyRow(cells) {
      return '<tr>' + cells.map(function cell(c) { return htmlCell(c, 'td'); }).join('') + '</tr>';
    }).join('');
    var foot = data.foot.map(function footRow(cells) {
      return '<tr style="font-weight:bold;">' + cells.map(function cell(c) { return htmlCell(c, 'td'); }).join('') + '</tr>';
    }).join('');
    // Excel honours x:num only where its namespace is declared.
    return '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body>' +
      '<table style="border-collapse:collapse;"><thead><tr style="font-weight:bold;">' + head +
      '</tr></thead><tbody>' + body + foot + '</tbody></table></body></html>';
  }

  //
  //------- Params: the URL and saved plans -------//
  //

  function moneyParam(value) {
    return String(Math.round(value * 100) / 100);
  }

  // Defaults are left out to keep a link short, except start: the default
  // start is this month, so a link that left it out would open on a
  // different month next month.
  function toParams(state) {
    var p = {};
    if (state.by === 'impressions') {
      p.by = 'imp';
      p.imp = String(Math.round(state.impressions || 0));
    } else if (state.spend !== DEFAULTS.spend) {
      p.spend = moneyParam(state.spend || 0);
    }
    if (state.cpm !== DEFAULTS.cpm) p.cpm = String(state.cpm === null ? 0 : state.cpm);
    if (state.currency !== DEFAULTS.currency) p.cur = state.currency;
    if (state.fees.creative.on) {
      p.af = '1';
      if (state.fees.creative.cpm !== DEFAULTS.feeCpm) p.afcpm = String(state.fees.creative.cpm || 0);
    }
    if (state.fees.hosting.on) {
      p.ah = '1';
      if (state.fees.hosting.cpm !== DEFAULTS.feeCpm) p.ahcpm = String(state.fees.hosting.cpm || 0);
    }
    if (state.partner.on) {
      p.pf = '1';
      if (state.partner.name.trim()) p.pname = state.partner.name.trim();
      if (state.partner.share !== DEFAULTS.share) p.pshare = String(state.partner.share || 0);
    }
    if (state.monthly.on) {
      p.mb = '1';
      p.start = state.monthly.start;
      if (state.monthly.length !== DEFAULTS.length) p.len = String(state.monthly.length);
      if (state.monthly.spread === 'custom') {
        p.spread = 'custom';
        fitValues(state.monthly.values, state.monthly.length).forEach(function month(units, i) {
          if (units > 0) p['m' + i] = state.by === 'impressions' ? String(units) : moneyParam(units / 100);
        });
      }
    }
    return p;
  }

  // get(key) returns the value or null, from URLSearchParams or a saved
  // object alike. Reads the 2.x parameters: with no mb, month values m0–m11
  // were January to December of a year nobody recorded, so they open as a
  // custom breakdown from January this year; without them the plan was its
  // total alone, as 2.x's overview showed it.
  function fromParams(get, now) {
    var s = defaultState(now);
    function num(key, fallback) {
      var n = toNumber(get(key));
      return n === null ? fallback : n;
    }

    s.by = get('by') === 'imp' ? 'impressions' : 'spend';
    s.spend = clamp(num('spend', DEFAULTS.spend), 0, MAX_SPEND);
    s.impressions = Math.round(clamp(num('imp', DEFAULTS.impressions), 0, MAX_IMPRESSIONS));
    s.cpm = Math.max(0, num('cpm', DEFAULTS.cpm));
    if (CURRENCIES[get('cur')]) s.currency = get('cur');

    s.fees.creative.on = get('af') === '1';
    s.fees.creative.cpm = Math.max(0, num('afcpm', DEFAULTS.feeCpm));
    s.fees.hosting.on = get('ah') === '1';
    s.fees.hosting.cpm = Math.max(0, num('ahcpm', DEFAULTS.feeCpm));
    s.partner.on = get('pf') === '1';
    s.partner.name = get('pname') || '';
    s.partner.share = clamp(num('pshare', DEFAULTS.share), 0, 100);

    var unitsOf = s.by === 'impressions'
      ? function impressionsUnits(v) { return Math.round(clamp(v, 0, MAX_IMPRESSIONS)); }
      : function penceUnits(v) { return Math.round(clamp(v, 0, MAX_SPEND) * 100); };

    if (get('mb') === '1') {
      s.monthly.on = true;
      if (parseMonthKey(get('start'))) s.monthly.start = get('start');
      s.monthly.length = clamp(Math.round(num('len', DEFAULTS.length)), 1, MAX_LENGTH);
      if (get('spread') === 'custom') {
        s.monthly.spread = 'custom';
        for (var i = 0; i < s.monthly.length; i++) s.monthly.values.push(unitsOf(num('m' + i, 0)));
      }
    } else if (get('mb') === null) {
      var legacy = [];
      for (var m = 0; m < 12; m++) legacy.push(Math.max(0, num('m' + m, 0)));
      if (sum(legacy) > 0) {
        var year = (now || new Date()).getFullYear();
        s.by = 'spend';
        s.monthly.on = true;
        s.monthly.start = monthKey(year, 0);
        s.monthly.length = 12;
        s.monthly.spread = 'custom';
        s.monthly.values = legacy.map(function legacyPence(v) { return Math.round(clamp(v, 0, MAX_SPEND) * 100); });
      }
    }
    return s;
  }

  function getterFromSearch(search) {
    var params = new URLSearchParams(search);
    return function getParam(key) { return params.get(key); };
  }

  function getterFromObject(obj) {
    return function getKey(key) {
      return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== null && obj[key] !== undefined
        ? String(obj[key])
        : null;
    };
  }

  window.CpmCalculator = {
    VERSION: VERSION,
    computePlan: computePlan,
    splitEven: splitEven,
    tableData: tableData,
    toTsv: toTsv,
    toHtml: toHtml,
    toParams: toParams,
    fromParams: fromParams,
    getterFromObject: getterFromObject,
    defaultState: defaultState
  };

  //
  //------- Elements -------//
  //

  var IDS = {
    resetAll: 'cpm-calculator-reset',
    sheet: 'cpm-calculator-sheet',
    heading: 'cpm-calculator-heading',
    figures: 'cpm-calculator-figures',
    split: 'cpm-calculator-split',
    splitBar: 'cpm-calculator-split-bar',
    splitLegend: 'cpm-calculator-split-legend',
    tableWrap: 'cpm-calculator-table-wrap',
    table: 'cpm-calculator-table',
    planError: 'cpm-calculator-plan-error',
    status: 'cpm-calculator-status',
    by: 'cpm-calculator-by',
    spendField: 'cpm-calculator-spend-field',
    spend: 'cpm-calculator-spend',
    spendHint: 'cpm-calculator-spend-hint',
    impressionsField: 'cpm-calculator-impressions-field',
    impressions: 'cpm-calculator-impressions',
    impressionsHint: 'cpm-calculator-impressions-hint',
    cpm: 'cpm-calculator-cpm',
    cpmError: 'cpm-calculator-cpm-error',
    currency: 'cpm-calculator-currency',
    monthly: 'cpm-calculator-monthly',
    monthsFields: 'cpm-calculator-months-fields',
    start: 'cpm-calculator-start',
    length: 'cpm-calculator-length',
    spread: 'cpm-calculator-spread',
    monthValuesBlock: 'cpm-calculator-month-values-block',
    monthValues: 'cpm-calculator-month-values',
    monthsError: 'cpm-calculator-months-error',
    creative: 'cpm-calculator-creative',
    creativeField: 'cpm-calculator-creative-field',
    creativeCpm: 'cpm-calculator-creative-cpm',
    hosting: 'cpm-calculator-hosting',
    hostingField: 'cpm-calculator-hosting-field',
    hostingCpm: 'cpm-calculator-hosting-cpm',
    feesError: 'cpm-calculator-fees-error',
    partner: 'cpm-calculator-partner',
    partnerFields: 'cpm-calculator-partner-fields',
    partnerName: 'cpm-calculator-partner-name',
    share: 'cpm-calculator-share',
    netShare: 'cpm-calculator-net-share',
    campaignReset: 'cpm-calculator-campaign-reset',
    monthsReset: 'cpm-calculator-months-reset',
    saveName: 'cpm-calculator-save-name',
    save: 'cpm-calculator-save',
    saveError: 'cpm-calculator-save-error',
    confirm: 'cpm-calculator-confirm',
    confirmText: 'cpm-calculator-confirm-text',
    confirmReplace: 'cpm-calculator-confirm-replace',
    confirmCancel: 'cpm-calculator-confirm-cancel',
    savesEmpty: 'cpm-calculator-saves-empty',
    saves: 'cpm-calculator-saves',
    copy: 'cpm-calculator-copy',
    copyError: 'cpm-calculator-copy-error'
  };

  function resolveElements(root) {
    var els = {};
    var missing = [];
    Object.keys(IDS).forEach(function find(key) {
      els[key] = root.querySelector('#' + IDS[key]);
      if (!els[key]) missing.push('#' + IDS[key]);
    });
    return { els: els, missing: missing };
  }

  function checkedValue(group) {
    var checked = group.querySelector('input:checked');
    return checked ? checked.value : null;
  }

  function setChecked(group, value) {
    group.querySelectorAll('input[type="radio"]').forEach(function check(input) {
      input.checked = input.value === value;
    });
  }

  function show(el, shown) {
    el.classList.toggle('is-hidden', !shown);
  }

  // Written only when it changes: a role="alert" line re-announces on every
  // write, and these are recomputed on every keystroke.
  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setInvalid(input, invalid) {
    input.classList.toggle('is-error', invalid);
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function setFieldError(input, errorEl, message) {
    setText(errorEl, message || '');
    setInvalid(input, !!message);
  }

  // A description that applies only in one state is pointed to only then:
  // aria-describedby reads a hidden element all the same.
  function setDescribedBy(input, ids) {
    var list = ids.filter(Boolean).join(' ');
    if (list) input.setAttribute('aria-describedby', list);
    else input.removeAttribute('aria-describedby');
  }

  // While a number is being typed an error is only ever cleared, never
  // raised: clearing the field to retype it, or passing through "1" on the
  // way to "15", is not a mistake. The message is written when the field
  // is left (change), as Email Signature does. aria-invalid and the
  // preview follow every keystroke.
  function errorText(displayed, next, typing) {
    if (!typing) return next || '';
    return next ? displayed : '';
  }

  // Cleared first and written on the next frame, so the same sentence twice
  // in a row is still a change the live region announces.
  function announce(ctx, message) {
    var status = ctx.els.status;
    status.textContent = '';
    window.requestAnimationFrame(function speak() { status.textContent = message; });
  }

  function toast(ctx, message) {
    if (typeof window.showToast === 'function') window.showToast(message);
    else announce(ctx, message);
  }

  function inputMoney(pence) {
    return String(Math.round(pence) / 100);
  }

  //
  //------- Controls -------//
  //

  // The months the Start month list offers: January last year to December
  // the year after next, widened to take a start from a link or a save.
  function buildStartOptions(ctx) {
    var select = ctx.els.start;
    var year = new Date().getFullYear();
    var first = monthKey(year - 1, 0);
    var last = monthKey(year + 2, 11);
    var start = ctx.state.monthly.start;
    if (start < first) first = start;
    if (start > last) last = start;
    var html = '';
    for (var key = first; key <= last; key = addMonths(key, 1)) {
      html += '<option value="' + key + '">' + monthLabel(key, 'long') + '</option>';
    }
    select.innerHTML = html;
  }

  // Every control from the state: at init, after a reset, after a load.
  function writeControls(ctx) {
    var s = ctx.state;
    var els = ctx.els;
    // A load or a reset can land on months of the same shape whose fields
    // hold the old plan's values: always rebuild after one.
    ctx.monthShape = '';
    setChecked(els.by, s.by);
    els.spend.value = s.spend === null ? '' : String(s.spend);
    els.impressions.value = s.impressions === null ? '' : String(s.impressions);
    els.cpm.value = s.cpm === null ? '' : String(s.cpm);
    setChecked(els.currency, s.currency);
    els.monthly.checked = s.monthly.on;
    if (!els.start.querySelector('option[value="' + s.monthly.start + '"]')) buildStartOptions(ctx);
    els.start.value = s.monthly.start;
    els.length.value = String(s.monthly.length);
    setChecked(els.spread, s.monthly.spread);
    els.creative.checked = s.fees.creative.on;
    els.creativeCpm.value = String(s.fees.creative.cpm);
    els.hosting.checked = s.fees.hosting.on;
    els.hostingCpm.value = String(s.fees.hosting.cpm);
    els.partner.checked = s.partner.on;
    els.partnerName.value = s.partner.name;
    els.share.value = String(s.partner.share);
  }

  // What follows the state on every change: which fields show, the derived
  // total in a custom plan, the symbols, the Net readout.
  function syncControls(ctx, typing) {
    var s = ctx.state;
    var plan = ctx.plan;
    var els = ctx.els;
    var bySpend = s.by !== 'impressions';

    show(els.spendField, bySpend);
    show(els.impressionsField, !bySpend);
    show(els.monthsFields, s.monthly.on);
    show(els.creativeField, s.fees.creative.on);
    show(els.hostingField, s.fees.hosting.on);
    show(els.partnerFields, s.partner.on);
    renderMonthInputs(ctx);

    // In a custom plan the total is the sum of the months: the field shows
    // it, read-only, so it stays in the tab order with its hint.
    var derived = plan.custom;
    els.spend.readOnly = derived && bySpend;
    els.impressions.readOnly = derived && !bySpend;
    show(els.spendHint, derived && bySpend);
    show(els.impressionsHint, derived && !bySpend);
    setDescribedBy(els.spend, [derived && bySpend ? IDS.spendHint : '']);
    setDescribedBy(els.impressions, [derived && !bySpend ? IDS.impressionsHint : '']);
    if (derived && bySpend) els.spend.value = inputMoney(plan.totals.spend);
    if (derived && !bySpend) els.impressions.value = String(plan.totals.units);

    var symbol = CURRENCIES[plan.currency].symbol;
    // Queried each time: the month fields carry the symbol too, and they
    // are rebuilt.
    ctx.root.querySelectorAll('[data-role="symbol"]').forEach(function setSymbol(el) { setText(el, symbol); });
    setText(els.netShare, 'Net ' + formatShare(100 - clamp(s.partner.share || 0, 0, 100)));

    setInvalid(els.cpm, !!plan.errors.cpm);
    setText(els.cpmError, errorText(els.cpmError.textContent, plan.errors.cpm, typing));
    setDescribedBy(els.cpm, [IDS.cpmError, plan.errors.fees ? IDS.feesError : '']);

    // The fee error is caused as often from Campaign (a lower CPM) as from
    // Fees, and a folded section is inert, so its live line is in the
    // preview; the line in Fees is the fields' description.
    var feesText = errorText(els.feesError.textContent, plan.errors.fees, typing);
    setText(els.feesError, feesText);
    show(els.feesError, !!feesText);
    setText(els.planError, feesText);
    setInvalid(els.creativeCpm, !!plan.errors.fees);
    setInvalid(els.hostingCpm, !!plan.errors.fees);
  }

  // The months of a custom plan, a field each, two to a row as other pairs
  // are. Rebuilt only when their shape changes, so a field being typed in
  // keeps its focus and caret; their values change only by typing.
  function renderMonthInputs(ctx) {
    var plan = ctx.plan;
    show(ctx.els.monthValuesBlock, plan.custom);
    if (!plan.custom) {
      ctx.monthShape = '';
      return;
    }
    var shape = [plan.bySpend, plan.start, plan.length].join('|');
    if (shape === ctx.monthShape) return;
    ctx.monthShape = shape;
    var symbol = escapeHTML(CURRENCIES[plan.currency].symbol);
    ctx.els.monthValues.innerHTML = plan.rows.map(function monthField(r, i) {
      var id = 'cpm-calculator-month-' + i;
      var input = '<input type="number" id="' + id + '" data-month="' + i + '" min="0" ' +
        (plan.bySpend ? 'step="any" inputmode="decimal"' : 'step="1" inputmode="numeric"') +
        ' value="' + (plan.bySpend ? inputMoney(r.units) : String(r.units)) + '"' +
        ' aria-describedby="' + IDS.monthsError + '">';
      return '<div class="block gap-s">' +
        '<label data-variant="caption" for="' + id + '">' + escapeHTML(monthLabel(r.key, 'long')) + '</label>' +
        (plan.bySpend ? '<div class="field"><span class="field-affix" data-role="symbol" aria-hidden="true">' + symbol + '</span>' + input + '</div>' : input) +
        '</div>';
    }).join('');
    // The rebuilt fields hold no error, so neither does the line.
    setText(ctx.els.monthsError, '');
  }

  function isDirty(ctx, section) {
    var s = ctx.state;
    if (section === 'campaign') {
      // In a custom plan the total is the months', not this section's. The
      // partner's name is the reader's work, so it is not a setting.
      var custom = ctx.plan && ctx.plan.custom;
      return s.by !== DEFAULTS.by || (!custom && s.spend !== DEFAULTS.spend) ||
        s.cpm !== DEFAULTS.cpm || s.currency !== DEFAULTS.currency ||
        s.fees.creative.on || s.fees.hosting.on ||
        s.fees.creative.cpm !== DEFAULTS.feeCpm || s.fees.hosting.cpm !== DEFAULTS.feeCpm ||
        s.partner.on || s.partner.share !== DEFAULTS.share;
    }
    return s.monthly.on || s.monthly.start !== thisMonth() || s.monthly.length !== DEFAULTS.length || s.monthly.spread !== DEFAULTS.spread;
  }

  function syncResets(ctx) {
    ctx.els.campaignReset.disabled = !isDirty(ctx, 'campaign');
    ctx.els.monthsReset.disabled = !isDirty(ctx, 'months');
  }

  //
  //------- Preview -------//
  //

  function renderHeading(ctx) {
    var plan = ctx.plan;
    var parts = [];
    if (plan.monthly) {
      parts.push(monthLabel(plan.start, 'short') + (plan.length > 1 ? ' – ' + monthLabel(plan.end, 'short') : ''));
      parts.push(plan.length + (plan.length === 1 ? ' month' : ' months'));
    } else {
      parts.push('Campaign total');
    }
    parts.push(plan.currency);
    if (plan.partnerOn && ctx.state.partner.name.trim()) parts.push(ctx.state.partner.name.trim());
    setText(ctx.els.heading, parts.join(' · '));
  }

  // Each part of the spend has its own hue, the engine's data-color, so a
  // card, its slice of the split bar and its legend key read as one thing.
  // Net is the accent and needs none.
  var PART_COLORS = { creative: 'purple', hosting: 'aqua', partner: 'pink' };

  function partKey(part) {
    return '<span class="tool-split-key" data-part="' + part + '"' +
      (PART_COLORS[part] ? ' data-color="' + PART_COLORS[part] + '"' : '') + ' aria-hidden="true"></span>';
  }

  // A figure is a card, as the World Clock's are: the label and a quiet
  // fact on one line, the value large and light under them. A part of the
  // spend carries its key before the label.
  function figure(label, meta, cell, emphasis, part) {
    return '<div class="tool-figure"' + (emphasis ? ' data-emphasis' : '') + '>' +
      '<dt><span class="tool-figure-label">' + (part ? partKey(part) : '') + escapeHTML(label) + '</span>' +
      (meta ? '<span class="tool-figure-meta">' + escapeHTML(meta) + '</span>' : '') + '</dt>' +
      '<dd' + (cell.negative ? ' class="is-negative"' : '') + '>' + escapeHTML(cell.text) + '</dd>' +
      '</div>';
  }

  function shareOfSpend(pence, plan) {
    return plan.valid && plan.totals.spend > 0 ? formatPercent(pence / plan.totals.spend * 100) : '';
  }

  function renderFigures(ctx) {
    var plan = ctx.plan;
    var t = plan.totals;
    var rate = plan.valid ? formatRate(ctx.state.cpm, plan.currency) + ' CPM' : '';
    var span = plan.monthly ? plan.length + (plan.length === 1 ? ' month' : ' months') : plan.currency;
    // The three answers every plan has come first, a row of their own at
    // three across; the fees and the partner, when on, start the next.
    var html = figure('Spend', span, spendCell(t, plan)) + figure('Impressions', rate, impressionsCell(t, plan)) +
      figure('Net', shareOfSpend(t.net, plan), moneyCell(t.net, plan), true, plan.split.show ? 'net' : '');
    if (plan.creativeOn) html += figure('Creative fee', formatRate(plan.creativeCpm, plan.currency) + ' CPM', moneyCell(t.creative, plan), false, 'creative');
    if (plan.hostingOn) html += figure('Ad hosting fee', formatRate(plan.hostingCpm, plan.currency) + ' CPM', moneyCell(t.hosting, plan), false, 'hosting');
    if (plan.partnerOn) html += figure(plan.partnerLabel, formatShare(plan.share), moneyCell(t.partner, plan), false, 'partner');
    ctx.els.figures.innerHTML = html;
    var widest = 0;
    ctx.els.figures.querySelectorAll('dd').forEach(function measure(dd) {
      widest = Math.max(widest, textEms(dd.textContent));
    });
    ctx.els.figures.style.setProperty('--figure-ems', widest.toFixed(2));
  }

  // A value's width in ems at the figures' light weight, near enough to size
  // them by: digits and symbols are about 0.6em, separators about 0.3em,
  // plus a little for the tracking and the card's breathing room.
  function textEms(text) {
    var ems = 0.4;
    for (var i = 0; i < text.length; i++) ems += /[.,:]/.test(text[i]) ? 0.3 : 0.6;
    return ems;
  }

  function renderSplit(ctx) {
    var split = ctx.plan.split;
    show(ctx.els.split, split.show);
    if (!split.show) return;
    ctx.els.splitBar.innerHTML = split.parts.map(function segment(p) {
      return '<span class="tool-split-part" data-part="' + p.key + '"' +
        (PART_COLORS[p.key] ? ' data-color="' + PART_COLORS[p.key] + '"' : '') + ' style="flex-grow:' + p.value + '"></span>';
    }).join('');
    ctx.els.splitLegend.innerHTML = split.parts.map(function legend(p) {
      return '<li>' + partKey(p.key) +
        '<span>' + escapeHTML(p.label) + '</span> <span class="tool-split-percent">' + formatPercent(p.percent) + '</span></li>';
    }).join('');
  }

  // The month table, shown only while the breakdown is on: off, the figures
  // are the statement. Rebuilt only when its shape changes; otherwise its
  // cells are rewritten in place.
  function tableShape(data) {
    return [data.kind, data.head.join('\u0001'), data.body.length].join('|');
  }

  function cellHtml(cell, tag) {
    if (cell.kind === 'label') return '<th scope="row">' + escapeHTML(cell.text) + '</th>';
    var classes = 'tool-num' + (cell.negative ? ' is-negative' : '');
    return '<' + tag + ' class="' + classes + '">' + escapeHTML(cell.text) + '</' + tag + '>';
  }

  function buildTable(ctx, data) {
    var html = '<caption class="visually-hidden">' + escapeHTML(data.caption) + '</caption><thead><tr>' +
      data.head.map(function headCell(text, i) {
        return '<th scope="col"' + (i > 0 ? ' class="tool-num"' : '') + '>' + escapeHTML(text) + '</th>';
      }).join('') + '</tr></thead><tbody>';
    data.body.forEach(function bodyRow(cells) {
      html += '<tr>' + cells.map(function bodyCell(cell) { return cellHtml(cell, 'td'); }).join('') + '</tr>';
    });
    html += '</tbody><tfoot>';
    data.foot.forEach(function footRow(cells) {
      html += '<tr>' + cells.map(function footCell(cell) { return cellHtml(cell, 'td'); }).join('') + '</tr>';
    });
    html += '</tfoot>';
    ctx.els.table.innerHTML = html;
  }

  function updateTable(ctx, data) {
    var sections = [ctx.els.table.tBodies[0], ctx.els.table.tFoot];
    var rowsData = [data.body, data.foot];
    sections.forEach(function updateSection(section, s) {
      Array.prototype.forEach.call(section.rows, function updateRow(tr, r) {
        var cells = rowsData[s][r];
        Array.prototype.forEach.call(tr.cells, function updateCell(td, i) {
          setText(td, cells[i].text);
          td.classList.toggle('is-negative', !!cells[i].negative);
        });
      });
    });
  }

  function renderTable(ctx) {
    var on = ctx.plan.monthly;
    show(ctx.els.tableWrap, on);
    if (!on) {
      ctx.tableShape = '';
      return;
    }
    var data = tableData(ctx.plan);
    var shape = tableShape(data);
    if (shape !== ctx.tableShape) {
      buildTable(ctx, data);
      ctx.tableShape = shape;
    } else {
      updateTable(ctx, data);
    }
  }

  // A scroller is a tab stop, a named region, while it overflows (WCAG
  // 2.1.1: Safari never puts a scroll container in the tab order). The
  // name rides in data-scroll-label, since a plain div may not carry one.
  function measureScroller(el) {
    var style = window.getComputedStyle(el);
    var scrolls = /auto|scroll/.test(style.overflowY + style.overflowX);
    var overflowing = scrolls && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    if (overflowing) {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', el.getAttribute('data-scroll-label'));
      return;
    }
    if (document.activeElement === el) return;
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }

  function measureScrollers(ctx) {
    if (!ctx.root.isConnected) {
      if (ctx.observer) ctx.observer.disconnect();
      return;
    }
    measureScroller(ctx.els.sheet);
    measureScroller(ctx.els.tableWrap);
  }

  //
  //------- Render -------//
  //

  function writeURL(ctx) {
    clearTimeout(ctx.urlTimer);
    // A write after the reader has left would stamp this plan on the next
    // page's address.
    if (!ctx.root.isConnected || window.location.pathname !== ctx.path) return;
    var query = new URLSearchParams(toParams(ctx.state)).toString();
    history.replaceState(history.state, '', ctx.path + (query ? '?' + query : '') + window.location.hash);
  }

  // Debounced: Safari throws past 100 replaceState calls in 30 seconds.
  function scheduleURL(ctx) {
    clearTimeout(ctx.urlTimer);
    ctx.urlTimer = setTimeout(function writeLater() { writeURL(ctx); }, URL_DELAY);
  }

  // typing: the change is a keystroke in a number field (see errorText).
  function render(ctx, typing) {
    ctx.plan = computePlan(ctx.state);
    syncControls(ctx, typing === true);
    renderHeading(ctx);
    renderFigures(ctx);
    renderSplit(ctx);
    renderTable(ctx);
    syncResets(ctx);
    scheduleURL(ctx);
    measureScrollers(ctx);
  }

  //
  //------- Changes -------//
  //

  function unitName(state) {
    return state.by === 'impressions' ? 'Impressions' : 'Spend';
  }

  // The plan's total becomes the typed total: leaving a custom plan keeps
  // what the months added up to.
  function adoptPlanTotal(ctx) {
    var plan = ctx.plan;
    if (ctx.state.by === 'impressions') {
      ctx.state.impressions = plan.totals.units;
      ctx.els.impressions.value = String(plan.totals.units);
    } else {
      ctx.state.spend = plan.totals.units / 100;
      ctx.els.spend.value = inputMoney(plan.totals.units);
    }
  }

  // Switching what is planned keeps the plan: the other quantity's current
  // figure becomes the typed one, month by month in a custom plan. With no
  // CPM there is nothing to convert, so the other field keeps its value.
  function setBy(ctx, by) {
    var s = ctx.state;
    var plan = ctx.plan;
    if (by === s.by) return;
    var cpm = s.cpm > 0 ? s.cpm : 0;
    if (plan.valid) {
      if (by === 'impressions') s.impressions = plan.totals.shown;
      else s.spend = plan.totals.spend / 100;
    }
    // Month values are kept while the breakdown is off, so they convert
    // whether or not it shows; with no CPM there is no converting them.
    if (s.monthly.spread === 'custom' && s.monthly.values.length) {
      if (cpm) {
        s.monthly.values = s.monthly.values.map(function convert(v) {
          return by === 'impressions'
            ? Math.round(clamp(v / 100 / cpm * 1000, 0, MAX_IMPRESSIONS))
            : Math.round(clamp(v * cpm / 10, 0, MAX_SPEND * 100));
        });
      } else {
        s.monthly.values = [];
        s.monthly.spread = 'even';
        setChecked(ctx.els.spread, 'even');
      }
    }
    s.by = by;
    ctx.els.spend.value = String(s.spend);
    ctx.els.impressions.value = String(s.impressions);
  }

  function setSpread(ctx, spread) {
    var s = ctx.state;
    if (spread === s.monthly.spread) return;
    if (spread === 'custom') {
      s.monthly.values = ctx.plan.rows.map(function rowUnits(r) { return r.units; });
    } else {
      adoptPlanTotal(ctx);
      announce(ctx, unitName(s) + ' spread evenly across ' + ctx.plan.length + (ctx.plan.length === 1 ? ' month.' : ' months.'));
    }
    s.monthly.spread = spread;
  }

  function setMonthly(ctx, on) {
    var s = ctx.state;
    if (on === s.monthly.on) return;
    if (!on && ctx.plan.custom) adoptPlanTotal(ctx);
    // Values typed before the breakdown went off come back with it. Only a
    // custom plan with none to come back to is seeded from the total.
    if (on && s.monthly.spread === 'custom' && !s.monthly.values.length) {
      s.monthly.values = splitEven(typedTotalUnits(s), s.monthly.length);
    }
    s.monthly.on = on;
  }

  // The months past the length are kept, not cut: typing 12 over 6 passes
  // through 1, and a plan shortened and lengthened again gets its months
  // back. Only the plan, the link and the copy read the first `length`.
  function setLength(ctx, value) {
    ctx.state.monthly.length = clamp(Math.round(value), 1, MAX_LENGTH);
  }

  // A month typed in the dock. Empty is 0 while typing; a negative value
  // counts as 0 and says so.
  function setMonthValue(ctx, input) {
    var index = parseInt(input.getAttribute('data-month'), 10);
    var n = toNumber(input.value);
    var negative = n !== null && n < 0;
    var units = n === null || negative ? 0 : (ctx.state.by === 'impressions'
      ? Math.round(clamp(n, 0, MAX_IMPRESSIONS))
      : Math.round(clamp(n, 0, MAX_SPEND) * 100));
    var values = fitValues(ctx.state.monthly.values, MAX_LENGTH);
    values[index] = units;
    ctx.state.monthly.values = values;
    setInvalid(input, negative);
    var anyNegative = ctx.els.monthValues.querySelector('[data-month].is-error');
    setText(ctx.els.monthsError, anyNegative ? 'A month cannot be negative, so it counts as 0.' : '');
  }

  //
  //------- Resets -------//
  //

  function resetCampaign(ctx) {
    setBy(ctx, 'spend');
    var s = ctx.state;
    s.spend = DEFAULTS.spend;
    s.impressions = DEFAULTS.impressions;
    s.cpm = DEFAULTS.cpm;
    s.currency = DEFAULTS.currency;
    s.fees = defaultState().fees;
    // The name is the reader's work and stays.
    s.partner.on = false;
    s.partner.share = DEFAULTS.share;
    writeControls(ctx);
    render(ctx);
    toast(ctx, 'Campaign reset to its defaults. The partner name stays.');
  }

  function resetMonths(ctx) {
    if (ctx.plan.custom) adoptPlanTotal(ctx);
    ctx.state.monthly = defaultState().monthly;
    clearMonthErrors(ctx);
    writeControls(ctx);
    render(ctx);
    toast(ctx, 'Months reset: no monthly breakdown.');
  }

  function clearMonthErrors(ctx) {
    setText(ctx.els.monthsError, '');
  }

  function resetAll(ctx) {
    ctx.state = defaultState();
    clearMonthErrors(ctx);
    setText(ctx.els.saveError, '');
    setText(ctx.els.copyError, '');
    writeControls(ctx);
    render(ctx);
    announce(ctx, 'Everything reset.');
  }

  //
  //------- Saved plans -------//
  //

  function readSaves() {
    try {
      var data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data)
        ? data.filter(function isSave(entry) { return entry && typeof entry.name === 'string' && entry.state && typeof entry.state === 'object'; })
        : [];
    } catch (e) {
      return [];
    }
  }

  function writeSaves(saves) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
      return true;
    } catch (e) {
      console.error('[CPM Calculator] could not save:', e);
      return false;
    }
  }

  var DELETE_ICON = '<span class="svg-icn" data-icon="close"><svg viewBox="0 0 24 24" fill="none" width="100%" height="100%" aria-hidden="true"><path d="M7.4 18L6 16.6L9.18579 13.4142C9.96684 12.6332 9.96684 11.3668 9.18579 10.5858L6 7.4L7.4 6L10.5858 9.18579C11.3668 9.96684 12.6332 9.96684 13.4142 9.18579L16.6 6L18 7.4L14.8142 10.5858C14.0332 11.3668 14.0332 12.6332 14.8142 13.4142L18 16.6L16.6 18L13.4142 14.8142C12.6332 14.0332 11.3668 14.0332 10.5858 14.8142L7.4 18Z" fill="currentColor"/></svg></span>';

  function renderSaves(ctx) {
    var saves = readSaves();
    show(ctx.els.savesEmpty, !saves.length);
    show(ctx.els.saves, saves.length > 0);
    ctx.els.saves.innerHTML = saves.map(function saveRow(entry, i) {
      var name = escapeHTML(entry.name);
      return '<li class="tool-save">' +
        '<button type="button" class="tool-save-load" data-index="' + i + '" data-name="' + name + '">' +
          '<span class="visually-hidden">Load </span>' + name + '</button>' +
        '<button type="button" class="button" data-role="delete" data-variant="transparent" data-icon-only data-index="' + i + '" data-name="' + name + '" aria-label="Delete ' + name + '">' + DELETE_ICON + '</button>' +
        '</li>';
    }).join('');
  }

  // The row's index, checked against what is stored now: another tab may
  // have changed the list since it was drawn, and a stale index would load
  // or delete a different plan than the row names. -1 when it no longer
  // matches, after redrawing the list.
  function currentIndex(ctx, button) {
    var index = parseInt(button.getAttribute('data-index'), 10);
    var entry = readSaves()[index];
    if (entry && entry.name === button.getAttribute('data-name')) return index;
    renderSaves(ctx);
    setText(ctx.els.saveError, 'The saved plans changed in another tab, so the list is redrawn. Choose the plan again.');
    return -1;
  }

  // One inline confirmation, for Replace and Delete: the question, a verb
  // named for what it does, and Cancel. Focus goes to the verb, which reads
  // the question as its description; Cancel or Escape returns it.
  function askConfirm(ctx, pending) {
    ctx.pending = pending;
    setText(ctx.els.confirmText, pending.question);
    setText(ctx.els.confirmReplace, pending.verb);
    show(ctx.els.confirm, true);
    ctx.els.confirmReplace.focus();
  }

  function hideConfirm(ctx) {
    show(ctx.els.confirm, false);
    ctx.pending = null;
  }

  function cancelConfirm(ctx) {
    var back = ctx.pending && ctx.pending.returnTo;
    hideConfirm(ctx);
    (back && back.isConnected ? back : ctx.els.saveName).focus();
  }

  function storeSave(ctx, name, replaceIndex) {
    var saves = readSaves();
    var entry = { name: name, timestamp: Date.now(), state: toParams(ctx.state) };
    if (replaceIndex >= 0) saves[replaceIndex] = entry;
    else saves.push(entry);
    if (!writeSaves(saves)) {
      setText(ctx.els.saveError, 'This browser blocked saving, so the plan was not saved.');
      return;
    }
    setFieldError(ctx.els.saveName, ctx.els.saveError, '');
    ctx.els.saveName.value = '';
    renderSaves(ctx);
    announce(ctx, 'Plan saved as ' + name + '.');
  }

  function findSave(name) {
    var lower = name.toLowerCase();
    var saves = readSaves();
    for (var i = 0; i < saves.length; i++) {
      if (saves[i].name.toLowerCase() === lower) return i;
    }
    return -1;
  }

  function handleSave(ctx) {
    var name = ctx.els.saveName.value.trim();
    if (!name) {
      setFieldError(ctx.els.saveName, ctx.els.saveError, 'Name the plan to save it.');
      ctx.els.saveName.focus();
      return;
    }
    setFieldError(ctx.els.saveName, ctx.els.saveError, '');
    if (findSave(name) >= 0) {
      askConfirm(ctx, {
        verb: 'Replace',
        question: 'Replace the saved plan \u201c' + name + '\u201d?',
        returnTo: ctx.els.saveName,
        run: function replace() {
          storeSave(ctx, name, findSave(name));
          ctx.els.saveName.focus();
        }
      });
      return;
    }
    storeSave(ctx, name, -1);
  }

  function loadSave(ctx, button) {
    var index = currentIndex(ctx, button);
    if (index < 0) return;
    var entry = readSaves()[index];
    ctx.state = fromParams(getterFromObject(entry.state));
    clearMonthErrors(ctx);
    writeControls(ctx);
    render(ctx);
    announce(ctx, 'Loaded ' + entry.name + '.');
  }

  function askDelete(ctx, button) {
    var index = currentIndex(ctx, button);
    if (index < 0) return;
    var name = readSaves()[index].name;
    askConfirm(ctx, {
      verb: 'Delete',
      question: 'Delete the saved plan \u201c' + name + '\u201d? This cannot be undone.',
      returnTo: button,
      run: function remove() { deleteSave(ctx, index, name); }
    });
  }

  function deleteSave(ctx, index, name) {
    var saves = readSaves();
    if (!saves[index] || saves[index].name !== name) {
      renderSaves(ctx);
      setText(ctx.els.saveError, 'The saved plans changed in another tab, so nothing was deleted.');
      ctx.els.saveName.focus();
      return;
    }
    saves.splice(index, 1);
    if (!writeSaves(saves)) {
      setText(ctx.els.saveError, 'This browser blocked the change, so the plan was not deleted.');
      ctx.els.saveName.focus();
      return;
    }
    renderSaves(ctx);
    // Focus goes to the row that took this one's place, or the name field.
    var next = ctx.els.saves.querySelectorAll('.tool-save-load')[Math.min(index, saves.length - 1)];
    (next || ctx.els.saveName).focus();
    announce(ctx, 'Deleted ' + name + '.');
  }

  //
  //------- Copy table -------//
  //

  // copy-button.js owns the copied state and how long it stays.
  function flashCopied(btn) {
    if (window.bdCopyButton) window.bdCopyButton.flash(btn);
  }

  function writeClipboard(tsv, html) {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      var item = new window.ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      });
      return navigator.clipboard.write([item]).catch(function plainOnly() {
        return navigator.clipboard.writeText(tsv);
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(tsv);
    return Promise.reject(new Error('no clipboard'));
  }

  function copyTable(ctx) {
    writeClipboard(toTsv(ctx.plan), toHtml(ctx.plan)).then(function copied() {
      setText(ctx.els.copyError, '');
      flashCopied(ctx.els.copy);
      announce(ctx, 'Table copied.');
    }).catch(function failed(err) {
      console.error('[CPM Calculator] copy failed:', err);
      setText(ctx.els.copyError, ctx.plan.monthly
        ? 'The table could not be copied: the browser blocked the clipboard. Select the table and copy it instead.'
        : 'The plan could not be copied: the browser blocked the clipboard. Allow clipboard access for this site and try again.');
    });
  }

  //
  //------- Events -------//
  //

  function bind(ctx) {
    var els = ctx.els;
    var s = function current() { return ctx.state; };

    function onInput(el, handler) {
      el.addEventListener('input', handler);
    }

    els.by.addEventListener('change', function handleBy() {
      setBy(ctx, checkedValue(els.by));
      render(ctx);
    });
    onInput(els.spend, function handleSpend() {
      var n = toNumber(els.spend.value);
      s().spend = n === null ? null : clamp(n, 0, MAX_SPEND);
      render(ctx);
    });
    onInput(els.impressions, function handleImpressions() {
      var n = toNumber(els.impressions.value);
      s().impressions = n === null ? null : Math.round(clamp(n, 0, MAX_SPEND * 1000));
      render(ctx);
    });
    onInput(els.cpm, function handleCpm() {
      var n = toNumber(els.cpm.value);
      s().cpm = n === null ? null : Math.max(0, n);
      render(ctx, true);
    });
    // Leaving a number field writes any error the keystrokes held back.
    [els.cpm, els.creativeCpm, els.hostingCpm].forEach(function settleErrors(input) {
      input.addEventListener('change', function handleSettle() { render(ctx); });
    });
    els.currency.addEventListener('change', function handleCurrency() {
      s().currency = checkedValue(els.currency);
      render(ctx);
    });

    els.monthly.addEventListener('change', function handleMonthly() {
      setMonthly(ctx, els.monthly.checked);
      render(ctx);
    });
    els.start.addEventListener('change', function handleStart() {
      s().monthly.start = els.start.value;
      render(ctx);
    });
    onInput(els.length, function handleLength() {
      var n = toNumber(els.length.value);
      if (n === null) return;
      setLength(ctx, n);
      render(ctx);
    });
    // On leaving the field, it shows the length in use.
    els.length.addEventListener('change', function settleLength() {
      els.length.value = String(s().monthly.length);
    });
    els.spread.addEventListener('change', function handleSpread() {
      setSpread(ctx, checkedValue(els.spread));
      clearMonthErrors(ctx);
      render(ctx);
    });

    els.creative.addEventListener('change', function handleCreative() {
      s().fees.creative.on = els.creative.checked;
      render(ctx);
    });
    onInput(els.creativeCpm, function handleCreativeCpm() {
      s().fees.creative.cpm = Math.max(0, toNumber(els.creativeCpm.value) || 0);
      render(ctx, true);
    });
    els.creativeCpm.addEventListener('change', function settleCreativeCpm() {
      els.creativeCpm.value = String(s().fees.creative.cpm);
    });
    els.hosting.addEventListener('change', function handleHosting() {
      s().fees.hosting.on = els.hosting.checked;
      render(ctx);
    });
    onInput(els.hostingCpm, function handleHostingCpm() {
      s().fees.hosting.cpm = Math.max(0, toNumber(els.hostingCpm.value) || 0);
      render(ctx, true);
    });
    els.hostingCpm.addEventListener('change', function settleHostingCpm() {
      els.hostingCpm.value = String(s().fees.hosting.cpm);
    });

    els.partner.addEventListener('change', function handlePartner() {
      s().partner.on = els.partner.checked;
      render(ctx);
    });
    onInput(els.partnerName, function handlePartnerName() {
      s().partner.name = els.partnerName.value;
      render(ctx);
    });
    onInput(els.share, function handleShare() {
      s().partner.share = clamp(toNumber(els.share.value) || 0, 0, 100);
      render(ctx);
    });
    els.share.addEventListener('change', function settleShare() {
      var typed = toNumber(els.share.value);
      els.share.value = String(s().partner.share);
      if (typed !== null && (typed > 100 || typed < 0)) announce(ctx, 'Partner share set to ' + formatShare(s().partner.share) + ', the nearest it can be.');
    });

    els.monthValues.addEventListener('input', function handleMonthInput(event) {
      if (!event.target.hasAttribute('data-month')) return;
      setMonthValue(ctx, event.target);
      render(ctx);
    });
    // On leaving a month, it shows the value in use: 0 for an empty or
    // negative one, the clamped figure for one past the maximum.
    els.monthValues.addEventListener('change', function settleMonth(event) {
      var input = event.target;
      if (!input.hasAttribute('data-month')) return;
      if (input.classList.contains('is-error')) return;
      var units = ctx.plan.rows[parseInt(input.getAttribute('data-month'), 10)].units;
      input.value = ctx.plan.bySpend ? inputMoney(units) : String(units);
    });

    els.campaignReset.addEventListener('tool:panel-reset', function handleCampaignReset() { resetCampaign(ctx); });
    els.monthsReset.addEventListener('tool:panel-reset', function handleMonthsReset() { resetMonths(ctx); });
    els.resetAll.addEventListener('click', function handleResetAll() { resetAll(ctx); });

    els.save.addEventListener('click', function handleSaveClick() { handleSave(ctx); });
    els.saveName.addEventListener('keydown', function handleSaveKey(event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      handleSave(ctx);
    });
    els.saveName.addEventListener('input', function handleSaveNameInput() {
      // A different name is a different question: the Replace prompt goes.
      if (ctx.pending && ctx.pending.verb === 'Replace') hideConfirm(ctx);
      if (els.saveName.value.trim()) setFieldError(els.saveName, els.saveError, '');
    });
    els.confirmReplace.addEventListener('click', function handleConfirm() {
      var pending = ctx.pending;
      hideConfirm(ctx);
      if (pending) pending.run();
    });
    els.confirmCancel.addEventListener('click', function handleCancel() { cancelConfirm(ctx); });
    els.confirm.addEventListener('keydown', function handleConfirmKey(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelConfirm(ctx);
    });
    els.saves.addEventListener('click', function handleSavesClick(event) {
      var del = event.target.closest('[data-role="delete"]');
      if (del) {
        askDelete(ctx, del);
        return;
      }
      var load = event.target.closest('.tool-save-load');
      if (load) loadSave(ctx, load);
    });

    // Copy link copies the address as it stands; the debounced write may
    // not have landed yet, so it lands now. Capture, so it runs before the
    // copy handler on the document.
    ctx.root.addEventListener('click', function flushBeforeCopyLink(event) {
      if (event.target.closest('.js-copy-url')) writeURL(ctx);
    }, true);

    els.copy.addEventListener('click', function handleCopy() { copyTable(ctx); });

    if (window.ResizeObserver) {
      ctx.observer = new ResizeObserver(function handleResize() { measureScrollers(ctx); });
      ctx.observer.observe(els.sheet);
      ctx.observer.observe(els.tableWrap);
      ctx.observer.observe(els.table);
    }
  }

  //
  //------- Initialize -------//
  //

  function initCpmCalculator(scope) {
    var host = scope || document;
    var roots = host.matches && host.matches(TOOL_SELECTOR) ? [host] : host.querySelectorAll(TOOL_SELECTOR);
    // Barba appends the incoming container after the outgoing one, so the
    // last match is the page being entered.
    var root = roots[roots.length - 1];
    if (!root || root.dataset.cpmCalculatorInit) return;

    var found = resolveElements(root);
    if (found.missing.length) {
      console.error('[CPM Calculator] markup is missing ' + found.missing.join(', ') + '; not wired');
      root.dataset.cpmCalculatorInit = 'failed';
      return;
    }
    root.dataset.cpmCalculatorInit = 'true';

    var ctx = {
      root: root,
      els: found.els,
      path: window.location.pathname,
      state: fromParams(getterFromSearch(window.location.search)),
      plan: null,
      tableShape: '',
      monthShape: '',
      urlTimer: 0,
      observer: null,
      pending: null
    };

    buildStartOptions(ctx);
    writeControls(ctx);
    renderSaves(ctx);
    bind(ctx);
    // The first render rewrites the address in the current shape, so a 2.x
    // link reads as what it opened as.
    render(ctx);

    console.log('[CPM Calculator] init');
  }

  window.initCpmCalculator = initCpmCalculator;

  // The dataset guard covers a document-wide call and a container-scoped one
  // landing on the same root, and two containers alive at once under a
  // synchronous transition. See cms/js-code-structure.md.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function initOnLoad() { initCpmCalculator(); });
  } else {
    initCpmCalculator();
  }

  document.addEventListener('bd:after-nav', function initOnArrival(event) {
    initCpmCalculator(event.detail && event.detail.container);
  });
})();
