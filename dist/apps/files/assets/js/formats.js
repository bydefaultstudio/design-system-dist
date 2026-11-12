/**
 * formats.js — the Format Library (handovers/HANDOVER-format-library.md).
 *
 * Every platform format in one grid, narrowed by search and by three chip
 * groups (Platform, Ratio, Type). Opening a format draws it through
 * layer-stack.js in the preview, with the end dock beside it: Layers, one
 * switch per layer group in the format's spec, and Spec, the registry's
 * values with where each is published; Download PNG and Copy link pinned
 * under them. The data is the registry (assets/data/formats/), inlined on
 * the page by the generator ({{format-manifest}}, cms/generator/formats.js)
 * and read once at init. Nothing is fetched.
 *
 * The search, the filters and the open format live in the URL (q,
 * platform, ratio, type, format), written with replaceState, as the Asset
 * Library does: a view is a link, and Barba keeps its own history entries.
 *
 * Lifecycle: the Asset Library's. One init per root, guarded by
 * dataset.formatsInit; the bd:after-nav arrival is deferred one frame so
 * building the tiles never holds the Barba transition open; release()
 * drops the previous page's observer on the next arrival.
 *
 * 1.1.0: the Layers panel lists the top of the stack first, Artwork last
 * (owner, 2026-11-09); the registry keeps the draw order.
 *
 * @version 1.4.0
 */
(function () {
  'use strict';

  var VERSION = '1.4.0';

  // Who a reader tells when something breaks, and who adds the files: the
  // brand's organisation (brand.json wording.organisation, else its name),
  // never a name written here. A site with no brand config falls back to
  // plain words.
  function organisation() {
    var w = typeof THEME_CONFIG !== 'undefined' && THEME_CONFIG ? THEME_CONFIG.wording : null;
    return w && w.organisation ? w.organisation : '';
  }

  function tellWho() {
    return organisation() || 'your admin';
  }
  console.log('[formats] v' + VERSION + ' loaded');

  var ROOT_SELECTOR = '[data-tool="formats"]';
  var PAGE_PATH = '/tools/formats.html';
  var FILTER_DEBOUNCE_MS = 100;
  var COUNT_DEBOUNCE_MS = 500;
  var CATEGORIES = ['platform', 'ratio', 'type'];
  /* The views a crop belongs to, by the switch that shows it. */
  var VIEW_LABELS = { 'app-screen': 'App screen', 'profile-grid': 'Profile grid', profile: 'Profile' };

  // Each reads after "From" and on its own (Size set by). A platform rule
  // names the platform itself (sourceText).
  var SOURCE_LABEL = {
    platform: 'the platform',
    technology: 'the technology that renders it',
    directory: 'the directory it is listed in',
    measured: 'a measurement in the app'
  };

  var el = null;
  var manifest = null;
  var formats = [];
  var byId = {};
  var visible = [];
  var params = null;
  var current = null; // { format, spec }
  var gridNav = null;
  var resizeObserver = null;
  var canvasObserver = null;
  var filterTimer = 0;
  var countTimer = 0;

  function emptyParams() {
    return { query: '', platform: '', ratio: '', type: '', format: '' };
  }

  //
  //------- DATA -------//
  //

  function readManifest(root) {
    var node = root.querySelector('#format-manifest') || document.getElementById('format-manifest');
    if (!node) return null;
    try {
      var data = JSON.parse(node.textContent);
      return data && Array.isArray(data.platforms) ? data : null;
    } catch (error) {
      console.error('[formats] the manifest is not JSON', error);
      return null;
    }
  }

  function ratioValue(ratio) {
    var parts = String(ratio).split(':');
    return Number(parts[0]) / Number(parts[1]);
  }

  function sizeText(canvas) {
    return window.FormatCard.sizeText(canvas);
  }


  function indexFormats(data) {
    formats = [];
    byId = {};
    data.platforms.forEach(function addPlatform(platform) {
      platform.formats.forEach(function addFormat(format) {
        var typeLabel = (data.types && data.types[format.type]) || format.type;
        var item = {
          id: format.id,
          data: format,
          platform: platform.platform,
          platformLabel: platform.label,
          ruleOwner: platform.ruleOwner || '',
          guide: platform.guide ? platform.guide + '#' + format.id.split('/')[1] : '',
          ratio: format.canvas.ratio,
          type: format.type,
          typeLabel: typeLabel,
          text: [format.name, platform.label, format.canvas.ratio, typeLabel, format.id,
            format.canvas.w + 'x' + format.canvas.h, format.canvas.w + ' × ' + format.canvas.h].join(' ').toLowerCase(),
          tile: null
        };
        formats.push(item);
        byId[item.id] = item;
      });
    });
  }

  function options(kind) {
    var seen = {};
    var list = [];
    formats.forEach(function collect(item) {
      if (seen[item[kind]]) return;
      seen[item[kind]] = true;
      list.push({ value: item[kind], label: kind === 'platform' ? item.platformLabel : kind === 'type' ? item.typeLabel : item.ratio });
    });
    if (kind === 'ratio') {
      // Tall to wide, the way the formats themselves run.
      list.sort(function byRatio(a, b) { return ratioValue(a.value) - ratioValue(b.value); });
    } else if (kind === 'type') {
      var order = Object.keys(manifest.types || {});
      list.sort(function byType(a, b) { return order.indexOf(a.value) - order.indexOf(b.value); });
    } else {
      list.sort(function byLabel(a, b) { return a.label.localeCompare(b.label); });
    }
    return list;
  }

  //
  //------- BROWSE -------//
  //

  function buildChips() {
    CATEGORIES.forEach(function buildRow(kind) {
      var group = el.chips[kind];
      group.textContent = '';
      var list = [{ value: '', label: 'All' }].concat(options(kind));
      if (params[kind] && !list.some(function has(o) { return o.value === params[kind]; })) params[kind] = '';
      list.forEach(function addChip(option) {
        var label = document.createElement('label');
        label.className = 'chip';
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'fm-' + kind;
        input.value = option.value;
        input.checked = option.value === params[kind];
        var text = document.createElement('span');
        text.textContent = option.label;
        label.appendChild(input);
        label.appendChild(text);
        group.appendChild(label);
      });
    });
  }

  function syncChips() {
    CATEGORIES.forEach(function syncRow(kind) {
      Array.prototype.forEach.call(el.chips[kind].querySelectorAll('input'), function check(input) {
        input.checked = input.value === params[kind];
      });
    });
  }

  /* Each tile is the format card's tile variant (format-card.js), so the
     grid and the cards on the pages share one markup and one stylesheet. */
  function renderGrid() {
    el.grid.textContent = '';
    formats.forEach(function addTile(item) {
      var tile = window.FormatCard.createTile(item.data, item.platformLabel);
      tile.tabIndex = -1;
      tile.dataset.id = item.id;
      item.tile = tile;
      el.grid.appendChild(tile);
    });
  }

  function matches(item) {
    if (params.platform && item.platform !== params.platform) return false;
    if (params.ratio && item.ratio !== params.ratio) return false;
    if (params.type && item.type !== params.type) return false;
    var words = params.query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every(function inText(word) { return item.text.indexOf(word) !== -1; });
  }

  function isFiltered() {
    return !!(params.query || params.platform || params.ratio || params.type);
  }

  function applyFilter() {
    visible = formats.filter(matches);
    formats.forEach(function show(item) { item.tile.hidden = visible.indexOf(item) === -1; });
    el.noMatch.classList.toggle('is-hidden', visible.length > 0);
    el.grid.hidden = visible.length === 0;
    if (gridNav) gridNav.repair();
    window.clearTimeout(countTimer);
    countTimer = window.setTimeout(writeCount, COUNT_DEBOUNCE_MS);
    if (current) renderPosition();
  }

  function writeCount() {
    var total = formats.length;
    var noun = function noun(n) { return n === 1 ? 'format' : 'formats'; };
    el.count.textContent = isFiltered() ? visible.length + ' of ' + total + ' ' + noun(total) : total + ' ' + noun(total);
  }

  function filterAfterTyping() {
    filterTimer = 0;
    params.query = el.search.value.trim();
    applyFilter();
    writeUrl();
  }

  function handleSearchInput() {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(filterAfterTyping, FILTER_DEBOUNCE_MS);
  }

  /* A filter still waiting on its debounce applies now: a click on a tile
     within it would otherwise open a format counted against the old set. */
  function flushFilter() {
    if (!filterTimer) return;
    window.clearTimeout(filterTimer);
    filterAfterTyping();
  }

  function handleChipChange(event) {
    var input = event.target;
    if (!input || input.type !== 'radio') return;
    var kind = input.name.replace(/^fm-/, '');
    if (CATEGORIES.indexOf(kind) === -1) return;
    params[kind] = input.value;
    applyFilter();
    writeUrl();
  }

  function clearSearchAndFilters() {
    params.query = '';
    CATEGORIES.forEach(function clear(kind) { params[kind] = ''; });
    el.search.value = '';
    // field.js paints the clear button from the input event.
    el.search.dispatchEvent(new Event('input', { bubbles: true }));
    window.clearTimeout(filterTimer);
    syncChips();
    applyFilter();
    writeUrl();
  }

  // A tile is a <button>, so Enter and Space arrive here as a click.
  // The button that was pressed hides with the message, so focus goes to
  // the search rather than falling to the page.
  function handleNoMatchClear() {
    clearSearchAndFilters();
    el.search.focus();
  }

  function handleGridClick(event) {
    var tile = event.target.closest('.format-card');
    if (!tile || !el.grid.contains(tile)) return;
    flushFilter();
    gridNav.focus(tile, { preventScroll: true });
    openFormat(tile.dataset.id, { focus: true });
  }

  //
  //------- A FORMAT -------//
  //

  /* The canvas is placed (the dock beside the work) from 960px of content,
     where tools.css makes it a grid; below that it stacks. Read from the
     stylesheet, so the two cannot disagree. Not the Asset Library's test
     (an "end" grid area): this tool's dock is hidden while browsing, which
     takes the end area away at every width. */
  function isWide() {
    return window.getComputedStyle(el.canvas).display === 'grid';
  }

  /* Where Layers and Spec go: the dock beside the viewer when wide, the
     viewer's own closed bars when narrow. Only one host is filled at a
     time, so no id is ever on the page twice. */
  function hosts() {
    return current && current.narrow
      ? { layers: el.viewLayers, meta: el.viewMetaList, notes: el.viewNotes }
      : { layers: el.layers, meta: el.meta, notes: el.notes };
  }

  function clearHosts() {
    [el.layers, el.viewLayers, el.meta, el.viewMetaList].forEach(function empty(node) { node.textContent = ''; });
    el.notes.hidden = true;
    el.viewNotes.hidden = true;
  }

  function openFormat(id, opts) {
    var item = byId[id];
    if (!item || !window.LayerStack || typeof el.viewer.show !== 'function') return false;
    var spec;
    try {
      spec = window.LayerStack.parseSpec(item.data.spec);
    } catch (error) {
      console.error('[formats] cannot read the spec for ' + id, error);
      return false;
    }
    var narrow = !isWide();
    var wasOpen = !!current;
    current = { item: item, spec: spec, narrow: narrow };
    params.format = id;
    if (item.tile && !item.tile.hidden) gridNav.setTabStop(item.tile);

    el.viewer.toggleAttribute('data-narrow', narrow);
    el.viewerPanels.hidden = !narrow;
    el.dockToggle.hidden = narrow;
    // Wide, the dock is the viewer's details; narrow, the viewer carries
    // them and the dock stays hidden under it.
    el.dock.classList.toggle('is-hidden', narrow);
    if (!wasOpen) {
      // The viewer covers the filters and the grid on every layout; narrow
      // it fills the window, so the bar goes too (the dock is hidden).
      el.region.inert = true;
      el.filters.inert = true;
      el.bar.inert = narrow;
      try {
        el.viewer.show();
      } catch (error) {
        el.viewer.setAttribute('open', '');
      }
    }

    el.viewTitle.textContent = item.data.name;
    el.svgName.textContent = item.data.name + ', ' + sizeText(item.data.canvas) + ': ' + item.data.artwork.alt;
    showError('');
    clearHosts();
    buildLayers();
    renderSpecPanel(item);
    renderActions(item);
    renderPosition();
    draw();
    writeUrl();
    if (opts && opts.focus) el.viewerClose.focus();
    return true;
  }

  /* "N of M" over the formats the filters show, and the arrows' ends. A
     format opened by a link that the filters hide has no place: no count,
     and both arrows off. */
  function renderPosition() {
    var item = current.item;
    var index = visible.indexOf(item);
    var meta = item.platformLabel + ' · ' + sizeText(item.data.canvas) + ' · ' + item.data.canvas.ratio;
    el.viewPosition.textContent = (index === -1 ? '' : (index + 1) + ' of ' + visible.length + ' · ') + meta;
    el.viewerPrev.setAttribute('aria-disabled', index <= 0 ? 'true' : 'false');
    el.viewerNext.setAttribute('aria-disabled', index === -1 || index >= visible.length - 1 ? 'true' : 'false');
  }

  function closeFormat(restoreFocus) {
    if (!current) return;
    var item = current.item;
    current = null;
    params.format = '';
    if (el.viewer.open) el.viewer.close();
    else el.viewer.removeAttribute('open');
    el.region.inert = false;
    el.filters.inert = false;
    el.bar.inert = false;
    el.dock.classList.add('is-hidden');
    clearHosts();
    writeUrl();
    if (restoreFocus === false) return;
    gridNav.repair();
    var tile = item && item.tile && !item.tile.hidden ? item.tile : gridNav.tabStop();
    if (tile && !tile.hidden) {
      if (tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest' });
      gridNav.focus(tile);
    } else {
      el.search.focus();
    }
  }

  function moveFormat(direction) {
    if (!current) return;
    var index = visible.indexOf(current.item);
    var next = index + direction;
    if (index === -1 || next < 0 || next >= visible.length) return;
    var target = visible[next];
    openFormat(target.id);
    // A move rebuilds the panels; focus on a switch or a source link there
    // would fall to the page, out of reach of the arrow keys. It lands on
    // the arrow that matches the move, or the other one at an end.
    if (!el.viewer.contains(document.activeElement)) {
      var arrow = direction > 0 ? el.viewerNext : el.viewerPrev;
      if (arrow.getAttribute('aria-disabled') === 'true') arrow = direction > 0 ? el.viewerPrev : el.viewerNext;
      arrow.focus();
    }
    announce(target.data.name + ', ' + (next + 1) + ' of ' + visible.length);
  }

  // A disabled end keeps focus (aria-disabled, never disabled), so a press
  // on it is ignored here.
  function handleViewerNav(event) {
    var button = event.currentTarget;
    if (button.getAttribute('aria-disabled') === 'true') return;
    moveFormat(parseInt(button.getAttribute('data-direction'), 10) || 1);
  }

  function handleViewerClose() {
    closeFormat(true);
  }

  // The arrow keys move through the formats, except where a control uses
  // them: a switch, a field.
  function handleViewerKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    var inField = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (inField) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFormat(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFormat(-1);
    }
  }

  // Escape on a non-modal dialog fires cancel in some browsers; the
  // document's keydown below covers the rest.
  function handleViewerCancel(event) {
    event.preventDefault();
    closeFormat(true);
  }

  /* The layout can cross 960px with a format open (a rotated tablet, a
     resized window). Where the details live was decided for the other
     layout, so the viewer closes rather than stand wrong, as the Asset
     Library's does. */
  function observeCanvas() {
    if (!window.ResizeObserver) return;
    var wide = isWide();
    canvasObserver = new ResizeObserver(function onCanvasResize() {
      var next = isWide();
      if (next === wide) return;
      wide = next;
      if (current) closeFormat(true);
    });
    canvasObserver.observe(el.canvas);
  }

  /* One switch per layer group, listed as a layers panel lists a stack:
     the top layer first, Artwork last (owner, 2026-11-09). The registry
     holds the draw order, bottom to top, so the list is reversed here and
     nowhere else. Each starts as the spec says. */
  function buildLayers() {
    var host = hosts().layers;
    current.defaults = {};
    var groups = current.spec.layers.filter(function isGroup(entry) { return entry.type === 'group'; });
    groups.slice().reverse().forEach(function addSwitch(entry) {
      current.defaults[entry.id] = entry.visible !== false;
      var row = document.createElement('div');
      row.className = 'form-toggle';
      row.setAttribute('data-variant', 'mono');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.id = 'fm-layer-' + entry.id;
      input.value = entry.id;
      input.checked = entry.visible !== false;
      var label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = entry.label;
      // Name, its info button, then the switch, in reading and tab order.
      var info = window.FormatCard.layerInfo(entry.id, entry.label, infoIcon());
      row.appendChild(label);
      if (info) row.appendChild(info);
      row.appendChild(input);
      host.appendChild(row);
    });
    window.FormatCard.syncSwitches(host, current.spec);
    syncLayersReset();
  }

  /* The info-circled icon, from the page's own template. */
  function infoIcon() {
    var found = el.icons && el.icons.content.querySelector('[data-icon="info-circled"]');
    return found ? found.cloneNode(true) : null;
  }

  function handleLayerChange(event) {
    var input = event.target;
    if (!current || !input || input.type !== 'checkbox') return;
    window.LayerStack.setVisible(current.spec, input.value, input.checked);
    var changes = window.FormatCard.syncSwitches(hosts().layers, current.spec, input);
    if (changes.length) announce(changes.join('. '));
    syncLayersReset();
    draw();
  }

  function syncLayersReset() {
    var changed = current && current.spec.layers.some(function differs(entry) {
      return entry.type === 'group' && (entry.visible !== false) !== current.defaults[entry.id];
    });
    el.layersReset.disabled = !changed;
    el.viewLayersReset.disabled = !changed;
  }

  function handleLayersReset() {
    if (!current) return;
    var host = hosts().layers;
    Object.keys(current.defaults).forEach(function restore(id) {
      window.LayerStack.setVisible(current.spec, id, current.defaults[id]);
    });
    window.FormatCard.syncSwitches(host, current.spec);
    syncLayersReset();
    draw();
    // The button disables itself (either one); focus would fall to the body.
    var first = host.querySelector('input:not(:disabled)');
    if (first) first.focus();
    announce('Layers reset');
  }

  function draw() {
    if (!current) return;
    try {
      current.result = window.FormatCard.draw(el.svg, el.labels, current.spec, el.stage);
    } catch (error) {
      console.error('[formats] render failed', error);
      showError('This format could not be drawn. Reload the page, and tell ' + tellWho() + ' if it happens again.');
      return;
    }
    fitStage();
  }

  function fitStage() {
    if (!current) return;
    window.FormatCard.fit(el.stage, el.stageArea, current.result);
  }

  /* The dock's error line is hidden under a narrow viewer, so a failure
     there is written to the viewer's foot as well, as the Asset Library
     does. Both are role="alert"; only the one showing is announced. An
     empty message clears both. */
  function showError(message) {
    el.error.textContent = message;
    el.viewError.textContent = current && current.narrow ? message : '';
    el.viewError.hidden = !(current && current.narrow && message);
  }

  function addRow(host, term, value) {
    if (value === null || value === undefined || value === '') return null;
    var row = document.createElement('div');
    var dt = document.createElement('dt');
    dt.textContent = term;
    var dd = document.createElement('dd');
    if (typeof value === 'string') dd.textContent = value;
    else dd.appendChild(value);
    row.appendChild(dt);
    row.appendChild(dd);
    host.appendChild(row);
    return dd;
  }

  function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function sourceText(source, item) {
    return source === 'platform' ? item.platformLabel : SOURCE_LABEL[source] || source;
  }

  /* Only what deserves less trust is marked (owner's brief, 2 November):
     a number the platform publishes names who publishes it, an estimate
     says so. Measured, calculated and house figures go unmarked. */
  function trustText(source, item) {
    if (source === 'estimated') return ' (estimated)';
    if (source === 'platform-rule') return ' (' + (item.ruleOwner || item.platformLabel) + ')';
    return '';
  }

  function safeAreaText(f, item) {
    var s = f.safeArea;
    var numbers = Object.keys(s).map(function value(key) { return s[key]; }).filter(function isNumber(n) { return n && typeof n === 'object'; });
    var estimated = numbers.some(function isEstimate(n) { return n.source === 'estimated'; });
    var published = numbers.length && numbers.every(function isRule(n) { return n.source === 'platform-rule'; });
    var trust = estimated ? trustText('estimated', item) : published ? trustText('platform-rule', item) : '';
    if (s.shape === 'circle') return s.d.value + ' px circle, centred' + trust;
    var text = s.w.value + ' × ' + s.h.value + ' px';
    return (f.safeAreaCentre ? text + ', centred at ' + f.safeAreaCentre.x + ', ' + f.safeAreaCentre.y : text + ', centred') + trust;
  }

  function list(lines) {
    var ul = document.createElement('ul');
    ul.className = 'tool-format-list';
    lines.forEach(function addLine(line) {
      var li = document.createElement('li');
      if (typeof line === 'string') li.textContent = line;
      else li.appendChild(line);
      ul.appendChild(li);
    });
    return ul;
  }

  function renderSpecPanel(item) {
    var f = item.data;
    var target = hosts();
    var host = target.meta;
    addRow(host, 'Platform', item.platformLabel);
    addRow(host, 'Size', sizeText(f.canvas) + ' px');
    addRow(host, 'Ratio', f.canvas.ratio);
    if (f.renders) addRow(host, 'Shown at', f.renders.w + ' × ' + f.renders.h + ' px' + (f.renders.note ? ', ' + f.renders.note : ''));
    addRow(host, 'File', f.file.types.map(function upper(t) { return t.toUpperCase(); }).join(', ') + (f.file.constraint ? ', ' + f.file.constraint : ''));
    if (f.weight) addRow(host, 'Weight', f.weight.max ? f.weight.max + ' ' + f.weight.unit.toUpperCase() + ' (' + sourceText(f.weight.source, item) + ')' : 'Not published');
    if (f.safeArea) addRow(host, 'Safe area', safeAreaText(f, item));
    if (f.keepClear && f.keepClear.length) {
      addRow(host, 'Keep clear', list(f.keepClear.map(function keepClear(k) {
        var where = k.side === 'all' ? 'Inside the circle' : capitalise(k.side);
        return where + ' ' + k.value + ' px' + trustText(k.source, item);
      })));
    }
    if (f.croppedArea && f.croppedArea.length) {
      // Each crop belongs to a view, and shows when that view's switch is on.
      addRow(host, 'Crops', list(f.croppedArea.map(function cropped(c) {
        var view = VIEW_LABELS[c.view] ? VIEW_LABELS[c.view] + ': ' : '';
        var what = c.shape === 'circle' ? 'shown as a ' + c.d + ' px circle' : c.side + ' ' + c.value + ' px';
        return view + what + trustText(c.source, item) + (c.note ? '. ' + c.note : '');
      })));
    }
    if (f.measured) addRow(host, 'Measured on', f.measured.device.value + ', ' + f.measured.on);
    addRow(host, 'Checked', f.figma ? f.figma.exportedOn : f.verified);
    if (item.guide) {
      var guide = document.createElement('a');
      guide.href = item.guide;
      guide.textContent = 'Read the guide, with the official sources';
      addRow(host, 'Guide', guide);
    } else if (f.references && f.references.length) {
      // A platform with no guide page yet keeps its sources here.
      addRow(host, 'Sources', list(f.references.map(function reference(ref) {
        var a = document.createElement('a');
        a.href = ref.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = ref.label;
        var hint = document.createElement('span');
        hint.className = 'visually-hidden';
        hint.textContent = ' (opens in a new tab)';
        a.appendChild(hint);
        return a;
      })));
    }
    target.notes.textContent = f.notes || '';
    target.notes.hidden = !f.notes;
  }

  /* The dock's verbs (wide) and the viewer's foot (narrow) say the same;
     only the side showing has them. */
  function renderActions(item) {
    var f = item.data;
    var canDownload = f.artwork.download === true;
    var narrow = current.narrow;
    var link = window.location.origin + PAGE_PATH + '?format=' + encodeURIComponent(item.id);
    el.download.hidden = !canDownload;
    el.open.hidden = canDownload || !f.artwork.link;
    el.viewDownload.hidden = !narrow || !canDownload;
    el.viewOpen.hidden = !narrow || canDownload || !f.artwork.link;
    el.viewCopy.hidden = !narrow;
    if (canDownload) {
      var ext = (f.artwork.src.match(/\.(\w+)$/) || [])[1] || 'png';
      var name = item.id.replace('/', '-') + '-' + f.canvas.w + 'x' + f.canvas.h + '.' + ext;
      [el.download, el.viewDownload].forEach(function point(a) {
        a.href = f.artwork.src;
        a.setAttribute('download', name);
      });
    } else if (f.artwork.link) {
      el.open.href = f.artwork.link.href;
      el.openLabel.textContent = f.artwork.link.label;
      el.viewOpen.href = f.artwork.link.href;
      el.viewOpenLabel.textContent = f.artwork.link.label;
    }
    el.copyLink.setAttribute('data-copy', link);
    el.viewCopy.setAttribute('data-copy', link);
  }

  /* Escape closes the open format from anywhere in the tool (the viewer,
     the dock's switches and verbs) or with nothing focused (a deep link).
     Bound on the document once, so a page load with focus on <body> hears
     it; an open menu or another dialog keeps its own Escape. */
  function handleDocumentKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!el || !current || !el.root.isConnected) return;
    var target = event.target;
    var inTool = target === document.body || target === document.documentElement || el.root.contains(target);
    if (!inTool || !target.closest) return;
    var owner = target.closest('.dropdown.is-open, dialog');
    if (owner && owner !== el.viewer) return;
    event.preventDefault();
    closeFormat(true);
  }

  //
  //------- URL -------//
  //

  function readUrl() {
    var url = new URL(window.location.href);
    params.query = (url.searchParams.get('q') || '').slice(0, 100);
    CATEGORIES.forEach(function read(kind) { params[kind] = url.searchParams.get(kind) || ''; });
    var id = url.searchParams.get('format') || '';
    return byId[id] ? id : '';
  }

  // history.state is carried through: Barba keeps its history payload
  // there, and replacing it with null breaks Forward after the next Back.
  function writeUrl() {
    if (!window.URL || !history.replaceState) return;
    var next = new URL(window.location.href);
    function set(key, value) {
      if (value) next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    }
    set('q', params.query);
    CATEGORIES.forEach(function write(kind) { set(kind, params[kind]); });
    set('format', params.format);
    if (next.href === window.location.href) return;
    try {
      history.replaceState(history.state, '', next.href);
    } catch (error) {
      console.warn('[formats] the browser refused a history write; the URL is stale', error);
    }
  }

  //
  //------- RESET AND STATUS -------//
  //

  function announce(text) {
    el.status.textContent = '';
    window.setTimeout(function write() { if (el) el.status.textContent = text; }, 50);
  }

  // The count is the announcement: it changes when a filter clears.
  function handleReset() {
    if (current) closeFormat(false);
    clearSearchAndFilters();
  }

  function showEmptyState(title, message) {
    el.filters.hidden = true;
    el.grid.hidden = true;
    el.empty.hidden = false;
    el.empty.querySelector('[data-empty-title]').textContent = title;
    el.empty.querySelector('[data-empty-message]').textContent = message;
    el.region.classList.add('is-empty');
  }

  //
  //------- LIFECYCLE -------//
  //

  function resolveElements(root) {
    var q = function q(selector) { return root.querySelector(selector); };
    el = {
      root: root,
      canvas: q('.tool-canvas'),
      filters: q('#fm-filters'),
      search: q('#fm-search'),
      chips: { platform: q('#fm-platform'), ratio: q('#fm-ratio'), type: q('#fm-type') },
      region: q('#fm-region'),
      count: q('#fm-count'),
      noMatch: q('#fm-no-match'),
      noMatchAction: q('#fm-no-match-action'),
      grid: q('#fm-grid'),
      empty: q('#fm-empty'),
      bar: q('.bar'),
      viewer: q('#fm-viewer'),
      viewTitle: q('#fm-view-title'),
      viewPosition: q('#fm-view-position'),
      viewerClose: q('#fm-viewer-close'),
      viewerPrev: q('#fm-viewer-prev'),
      viewerNext: q('#fm-viewer-next'),
      viewerPanels: q('#fm-viewer-panels'),
      viewLayers: q('#fm-view-layers'),
      viewMetaList: q('#fm-view-meta'),
      viewNotes: q('#fm-view-notes'),
      viewDownload: q('#fm-view-download'),
      viewCopy: q('#fm-view-copy'),
      viewOpen: q('#fm-view-open'),
      viewOpenLabel: q('#fm-view-open-label'),
      viewError: q('#fm-view-error'),
      viewLayersReset: q('#fm-view-layers-reset'),
      dockToggle: q('#fm-dock-toggle'),
      stageArea: q('#fm-stage-area'),
      stage: q('#fm-stage'),
      svg: q('#fm-svg'),
      svgName: q('#fm-svg-name'),
      labels: q('#fm-labels'),
      status: q('#fm-status'),
      dock: q('#fm-dock'),
      layers: q('#fm-layers'),
      layersReset: q('#fm-layers-reset'),
      meta: q('#fm-meta'),
      notes: q('#fm-notes'),
      icons: q('#fm-icons'),
      error: q('#fm-error'),
      download: q('#fm-download'),
      open: q('#fm-open'),
      openLabel: q('#fm-open-label'),
      copyLink: q('#fm-copy-link'),
      reset: q('#fm-reset')
    };
  }

  function release() {
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (canvasObserver) canvasObserver.disconnect();
    canvasObserver = null;
    window.clearTimeout(filterTimer);
    window.clearTimeout(countTimer);
    current = null;
    gridNav = null;
    el = null;
    manifest = null;
    formats = [];
    byId = {};
    visible = [];
  }

  function wireControls() {
    el.search.addEventListener('input', handleSearchInput);
    CATEGORIES.forEach(function wire(kind) { el.chips[kind].addEventListener('change', handleChipChange); });
    el.noMatchAction.addEventListener('click', handleNoMatchClear);
    el.grid.addEventListener('click', handleGridClick);
    el.viewerClose.addEventListener('click', handleViewerClose);
    el.viewerPrev.addEventListener('click', handleViewerNav);
    el.viewerNext.addEventListener('click', handleViewerNav);
    el.viewer.addEventListener('keydown', handleViewerKeydown);
    el.viewer.addEventListener('cancel', handleViewerCancel);
    el.viewLayers.addEventListener('change', handleLayerChange);
    el.layers.addEventListener('change', handleLayerChange);
    el.layersReset.addEventListener('click', handleLayersReset);
    el.viewLayersReset.addEventListener('click', handleLayersReset);
    el.reset.addEventListener('click', handleReset);
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(fitStage);
      resizeObserver.observe(el.stageArea);
    }
    observeCanvas();
  }

  function initFormats(scope) {
    var base = scope || document;
    var root = base.matches && base.matches(ROOT_SELECTOR) ? base : base.querySelector(ROOT_SELECTOR);
    if (!root) {
      release();
      return;
    }
    if (root.dataset.formatsInit) return;
    root.dataset.formatsInit = 'true';

    release();
    resolveElements(root);
    var missing = Object.keys(el).filter(function absent(name) { return !el[name]; });
    CATEGORIES.forEach(function chipsPresent(kind) { if (!el.chips[kind]) missing.push('fm-' + kind); });
    if (missing.length) {
      console.error('[formats] markup is missing: ' + missing.join(', '));
      return;
    }

    params = emptyParams();
    manifest = readManifest(root);
    if (!manifest || !window.LayerStack || !window.ToolGrid || !window.FormatCard) {
      showEmptyState('The formats didn’t load', 'Reload the page. If it fails again, tell ' + tellWho() + ' and name this page.');
      return;
    }
    indexFormats(manifest);
    if (!formats.length) {
      showEmptyState('No formats here yet', (organisation() || 'The team') + ' adds each platform’s formats as its artwork is approved.');
      return;
    }

    try {
      var named = readUrl();
      buildChips();
      renderGrid();
      gridNav = window.ToolGrid.create(el.grid, {
        tiles: function shownTiles() { return visible.map(function tileOf(item) { return item.tile; }); },
        preferred: function preferredTile() { return params.format && byId[params.format] ? byId[params.format].tile : null; },
        onMove: function moved() {}
      });
      el.search.value = params.query;
      if (params.query) el.search.dispatchEvent(new Event('input', { bubbles: true }));
      wireControls();
      applyFilter();
      window.clearTimeout(countTimer);
      writeCount();
      // Live only from here: the count written at load is the page's
      // content, not news, so it is not announced.
      el.count.setAttribute('aria-live', 'polite');
      if (!named || !openFormat(named)) writeUrl();
    } catch (error) {
      console.error('[formats] init failed', error);
      release();
      resolveElements(root);
      showEmptyState('Something went wrong', 'The Format Library hit an error while starting. Reload the page, and tell ' + tellWho() + ' if it keeps happening.');
      return;
    }
    console.log('[formats] init');
  }

  window.initFormats = initFormats;

  //
  //------- INITIALIZE -------//
  //

  function handleDomReady() {
    initFormats();
  }

  function handleAfterNav(event) {
    var container = event.detail && event.detail.container;
    window.requestAnimationFrame(function initAfterPaint() {
      if (container && !container.isConnected) return;
      initFormats(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    initFormats();
  }

  // Leaving: the tool is taken down as the leave begins. Narrow, an open
  // viewer is fixed to the window inside the container, and the transformed
  // container would carry it across the slide, so it closes, visually only:
  // closeFormat writes the URL, and Barba has already written the next one.
  // release() then stops the observers and timers, so a resize during the
  // leave (the sidebar opening) or a pending search cannot close the format
  // the long way and write this page's params onto the next one's URL.
  function handleBeforeNav() {
    if (!el) return;
    if (el.viewer && el.viewer.open) el.viewer.close();
    release();
  }

  document.addEventListener('bd:after-nav', handleAfterNav);
  document.addEventListener('bd:before-nav', handleBeforeNav);
  document.addEventListener('keydown', handleDocumentKeydown);
})();
