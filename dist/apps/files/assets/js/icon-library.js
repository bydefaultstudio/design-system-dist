/**
 * icon-library.js — Icon Library (browse, recolour, resize and export the icon set)
 *
 * Global page module, loaded once on every page like the other tool modules.
 * It self-registers for the initial load and for Barba's bd:after-nav event,
 * scoped to the incoming container, and bails at once when the container is
 * not the tool — so it is a no-op everywhere else. Every listener is bound to
 * an element inside the container, so a page swap discards all of them; the
 * things that outlive the DOM (the ResizeObservers on the preview and the
 * category row) are released on the next arrival.
 *
 * On the tool canvas, built from docks (cms/tool-canvas.md): the selected
 * icon is always in the preview — the first icon, or the one the URL's
 * ?icon= names, is selected at init — the search and the category chips sit
 * over the grid in the Icons panel, docked under the preview, and colour
 * (Style), format, size and the filename (Export) and the two verbs are the
 * settings dock on the right.
 *
 * MUST STAY OUTSIDE [data-barba="container"]: inside it, barba-docs.js would
 * re-execute this file on every arrival and spawn a second IIFE (see the
 * same note in logo-tool.js).
 *
 * Everything the tool renders comes from the page's own #icon-manifest JSON
 * block, which the doc generator inlines from assets/images/svg-icons/ and
 * cms/brand-iconography.md at build time. No fetches, no global data. Barba
 * leaves that block alone on arrival (reExecuteContainerScripts re-runs
 * JavaScript types only), so the read below works after navigation too.
 *
 * SVG processing comes from the shared engine in
 * assets/js/vendor/svg-cleaner-core.js (window.SvgCleaner). Never add
 * processing logic here — it belongs in the package repo.
 *
 * 1.3.0: the size moved from Style into Export, beside the format it
 * matters to, and gained presets (the tools' shared size control,
 * tools.css); the Style reset is the colour alone. The Colour control is
 * the tools' shared one (tool-colour.js), so its palette, chips, picker,
 * hex field and error are no longer this file's.
 *
 * 1.4.0: Export as is a segmented control, as in every tool, and the
 * preview's Fill switch is Fill screen.
 *
 * 1.5.0: the grid's keys come from tool-grid.js, shared with the Asset
 * Library, and selection follows them: the arrows change the preview, not
 * only the focus. A click focuses the tile, so the arrows carry on from it.
 * @version 1.6.3
 */
(function () {
  'use strict';

  var VERSION = '1.6.3';
  console.log('[icon-library] v' + VERSION + ' loaded');

  var ROOT_SELECTOR = '[data-tool="icon-library"]';

  // Fallbacks only: the limits are read from the number field at init, so
  // the steppers (which follow the attributes) and the clamp cannot disagree.
  var SIZE_MIN = 16;
  var SIZE_MAX = 512;
  var SIZE_DEFAULT = 24;

  // Two debounces, deliberately different (the glossary's reasoning): the
  // filter follows typing closely; the count is a live region, and a region
  // rewritten on every keystroke is read on every keystroke.
  var COPY_FEEDBACK_MS = 2000;  // copy-button.js's own feedback window
  var FILTER_DEBOUNCE_MS = 100;
  // An arrow held down repeats about thirty times a second; the URL is
  // written once it settles, under the browsers' replaceState throttle.
  var URL_DEBOUNCE_MS = 300;
  var COUNT_DEBOUNCE_MS = 500;

  // The brand's ink: --text-primary resolves to --off-black, so an export
  // defaults to the colour an inline icon would have inherited. Named, not
  // positional, so reordering the swatches cannot move the default; falls
  // back to the first swatch when an instance does not define it.
  var DEFAULT_COLOUR_ID = 'off-black';

  //
  //------- STATE -------//
  //

  var S = null;           // window.SvgCleaner
  var el = {};            // elements, resolved per container
  var icons = [];         // every icon, sorted by key
  var iconsByKey = {};
  var visibleIcons = [];  // the current filter result, in grid order
  var palette = [];       // the tools' palette, resolved: { id, label, value }
  var colourCtl = null;   // the Colour control's handle (tool-colour.js)
  var gridNav = null;     // the grid's keys and tab stop (tool-grid.js)
  var sizeMin = SIZE_MIN;
  var sizeMax = SIZE_MAX;
  var previewObserver = null;
  var filterTimer = null;
  var urlTimer = null;
  var pointerTile = null;    // the tile a pointer went down on, until its click
  var countTimer = null;
  var statusTimer = null;
  var errorTimer = null;
  var pngExporting = false;  // the Download PNG gate, held across re-renders
  var exportSeq = 0;         // only the newest render may release it or save
  var session = {};          // identity of this page's instance; release() replaces it
  var brandId = '';          // from the manifest; names the export files

  // The icon template's layers, made once. Its two groups are the preview's two
  // switches: Grids and Guides (layer-stack.js, the icon template).
  var guidesSpec = null;

  var params = {
    query: '',
    category: 'all',
    selected: null,
    colourId: null,
    colour: '#000000',
    size: SIZE_DEFAULT,
    format: 'svg',
    ground: 'light',       // derived from the export colour, never chosen
    transparent: false,    // preview only: the checkerboard instead of the ground
    guides: false,         // preview only: the icon spec's guides over the icon
    grids: false,          // preview only: the icon spec's grid over the icon
    fill: false            // preview only: the icon as large as the stage allows
  };

  //
  //------- UTILITIES -------//
  //

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Accepts what getComputedStyle hands back for a colour token — #rgb,
  // #rrggbb or rgb(r, g, b) — and returns lowercase #rrggbb, which is the one
  // form input[type="color"] accepts. Anything else (a gradient, color-mix,
  // an empty string for a token the theme does not define) is null and the
  // swatch is skipped rather than drawn wrong.
  function normaliseHex(value) {
    var text = String(value || '').trim().toLowerCase();
    var short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if (short) return '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
    if (/^#[0-9a-f]{6}$/.test(text)) return text;
    var rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rgb) {
      return '#' + [rgb[1], rgb[2], rgb[3]].map(function (channel) {
        return ('0' + clamp(parseInt(channel, 10), 0, 255).toString(16)).slice(-2);
      }).join('');
    }
    return null;
  }

  // The manifest carries each file's own markup, so a fixed width="24" comes
  // through as written. On the page the wrapper owns the size, so the root
  // gets the same 100% the {{icon:}} shorthand gets at build time.
  function displaySvg(svg) {
    return svg
      .replace(/(<svg[^>]*?)\s+width\s*=\s*["'][^"']*["']/i, '$1 width="100%"')
      .replace(/(<svg[^>]*?)\s+height\s*=\s*["'][^"']*["']/i, '$1 height="100%"');
  }

  // Ids are already namespaced per icon at build time, which keeps the grid
  // clean. The panel then inlines the selected icon three more times, so each
  // of those copies takes a further suffix. Same three rewrites as the
  // generator's namespaceIds.
  function localiseIds(svg, suffix) {
    var ids = [];
    var idRe = /\sid="([^"]+)"/g;
    var match;
    while ((match = idRe.exec(svg))) ids.push(match[1]);
    var out = svg;
    ids.forEach(function (id) {
      var safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var next = id + '-' + suffix;
      // Function replacers: a string replacement would read "$&" in an id
      // as a substitution pattern (the generator's namespaceIds, same reason).
      out = out
        .replace(new RegExp('id="' + safe + '"', 'g'), function () { return 'id="' + next + '"'; })
        .replace(new RegExp('url\\(#' + safe + '\\)', 'g'), function () { return 'url(#' + next + ')'; })
        .replace(new RegExp('href="#' + safe + '"', 'g'), function () { return 'href="#' + next + '"'; });
    });
    return out;
  }

  //
  //------- MANIFEST -------//
  //

  function readManifest(root) {
    var block = root.querySelector('#icon-manifest');
    if (!block) return null;
    var data;
    try {
      data = JSON.parse(block.textContent);
    } catch (error) {
      return null;
    }
    if (!data || !Array.isArray(data.icons) || !Array.isArray(data.categories)) return null;
    return data;
  }

  function isIconEntry(entry) {
    return entry && typeof entry.key === 'string' && /^[a-z0-9-]+$/.test(entry.key)
      && typeof entry.raw === 'string' && entry.raw.indexOf('<svg') !== -1;
  }

  function byKey(a, b) {
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  }

  // Name, key, category and the key with its hyphens as spaces, so "arrow
  // up", "arrow-up" and "Arrows" all find the same icon.
  function indexIcons(manifest) {
    icons = manifest.icons.filter(isIconEntry).map(function (entry) {
      var name = typeof entry.name === 'string' && entry.name ? entry.name : entry.key;
      var category = typeof entry.category === 'string' && entry.category ? entry.category : 'Other';
      return {
        key: entry.key,
        name: name,
        category: category,
        svg: entry.raw,
        searchText: [entry.key, name, category, entry.key.replace(/-/g, ' ')].join(' ').toLowerCase(),
        tile: null
      };
    }).sort(byKey);

    // A key listed twice would bind two icon objects to one tile; the
    // generator never emits one, but the block is data and is not trusted.
    iconsByKey = {};
    icons = icons.filter(function (icon) {
      if (iconsByKey[icon.key]) {
        console.warn('[icon-library] duplicate icon key in the manifest: ' + icon.key);
        return false;
      }
      iconsByKey[icon.key] = icon;
      return true;
    });
  }

  //
  //------- GRID -------//
  //

  // The tile is the icon and nothing else: at 175 tiles the captions were
  // more page than the drawings, and the grid is for recognising a shape.
  // The name still has to exist for anyone not looking at it, so it is the
  // button's aria-label — the display name, not the key, because the band and
  // the selection announcement both say the display name and one icon should
  // not have two nouns. It is also the tooltip, which is what gives a sighted
  // reader the name back on hover (cms/tooltip.md). The key is a click away
  // in the filename and Copy data-icon, and search still matches it.
  function renderGrid() {
    el.grid.innerHTML = icons.map(function (icon) {
      var name = escapeHtml(icon.name);
      return '<button type="button" class="tool-tile" data-variant="bare" data-shape="square" data-icon-key="' + escapeHtml(icon.key) + '"'
        + ' aria-label="' + name + '" data-tooltip="' + name + '" data-tooltip-position="bottom" tabindex="-1">'
        + '<span class="svg-icn" data-icon="' + escapeHtml(icon.key) + '" aria-hidden="true">' + displaySvg(icon.svg) + '</span>'
        + '</button>';
    }).join('');

    Array.prototype.forEach.call(el.grid.children, function (tile, index) {
      icons[index].tile = tile;
    });
  }

  // Every word must match somewhere — ORing would widen the results, which
  // reads as the search being broken.
  function matchesQuery(searchText) {
    if (!params.query) return true;
    var terms = params.query.split(/\s+/);
    for (var i = 0; i < terms.length; i++) {
      if (terms[i] && searchText.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  function applyFilter() {
    // Read before anything changes. Hiding the focused tile and then writing
    // tabindex on it (the tab-stop repair) makes Chrome blur it to <body> at
    // once, so a read after the repair finds nothing to put right.
    var active = document.activeElement;
    visibleIcons = [];
    icons.forEach(function (icon) {
      var show = (params.category === 'all' || icon.category === params.category) && matchesQuery(icon.searchText);
      icon.tile.classList.toggle('is-hidden', !show);
      if (show) visibleIcons.push(icon);
    });
    el.noMatch.classList.toggle('is-hidden', visibleIcons.length > 0);
    if (!visibleIcons.length) writeNoMatch();
    gridNav.repair();
    // The debounced filter can hide the tile focus was on; moving the tab
    // stop alone would leave focus on <body> with the arrows dead.
    if (active && el.grid.contains(active) && active.classList.contains('is-hidden')) {
      var stop = gridNav.tabStop();
      if (stop) stop.focus();
      else el.search.focus();
    }
    scheduleCountUpdate(visibleIcons.length);
  }

  // The title carries the whole failure, the query and the category it was
  // scoped to, so the description is nothing but the way back and never
  // restates the title.
  // The way back out of a dead end. The count borrows this so a screen
  // reader hears it too, which is why the coaching sentence is not part of
  // it: spoken, it would bury the one action in a count line.
  function recoveryLine() {
    return params.category !== 'all'
      ? 'Choose All to search every category, or clear the search.'
      : 'Clear the search to see the whole set.';
  }

  function writeNoMatch() {
    var scoped = params.category !== 'all';
    el.noMatchTitle.textContent = 'No icon'
      + (scoped ? ' in ' + params.category : '')
      + (params.query ? ' matches \u201c' + params.query + '\u201d' : '');
    el.noMatchText.textContent = (scoped ? '' : 'Icons are named for what they are: try arrow, check or user. ')
      + recoveryLine();
  }

  // The status region is cleared and written a tick apart: both in one task
  // and a screen reader may coalesce them into no change at all, so the same
  // icon selected twice would go silent. Not requestAnimationFrame, which
  // does not run while the tab is hidden and would drop the message rather
  // than delay it. The node is captured because el is emptied on the next
  // Barba arrival. Two calls inside one task drop the first message: the
  // current callers cannot fire together, so mind this before adding a third.
  function announce(message) {
    if (!el.status) return;
    var status = el.status;
    window.clearTimeout(statusTimer);
    status.textContent = '';
    statusTimer = window.setTimeout(function writeStatus() {
      status.textContent = message;
    }, 0);
  }

  function scheduleCountUpdate(visibleCount) {
    window.clearTimeout(countTimer);
    countTimer = window.setTimeout(function updateCount() {
      writeCount(visibleCount);
    }, COUNT_DEBOUNCE_MS);
  }

  // The eye gets the bare figures, "47 of 217": the chosen chip and the
  // search field already show what is narrowing the set. A screen reader
  // hears this region without either in view, so the noun, the category and
  // the way out of a dead end ride along visually hidden.
  function writeCount(visibleCount) {
    if (!el.count) return;
    var noun = icons.length === 1 ? ' icon' : ' icons';
    if (visibleCount === icons.length) {
      el.count.textContent = icons.length + noun;
      return;
    }
    var spoken = visibleCount === 1 ? ' icon' : ' icons';
    if (params.category !== 'all') spoken += ' in ' + params.category;
    // The callout is not a live region, so at zero results the way back is
    // the one thing a screen reader never hears. It rides this region rather
    // than announcing separately, which would race it.
    if (!visibleCount) spoken += '. ' + recoveryLine();
    el.count.innerHTML = visibleCount + ' of ' + icons.length
      + '<span class="visually-hidden">' + escapeHtml(spoken) + '</span>';
  }

  // -- The grid's keys --
  // One tab stop for the whole grid, the arrows inside it, and selection
  // following them, from tool-grid.js. Without the one tab stop 175 buttons
  // stand between the search and what follows for a keyboard user.

  function visibleTiles() {
    return visibleIcons.map(function (icon) { return icon.tile; });
  }

  function selectedTile() {
    var icon = params.selected && iconsByKey[params.selected];
    return icon ? icon.tile : null;
  }

  // Arrowing selects as it goes, so the preview follows the arrows. Focus
  // stays on the tile: the reader is still browsing, and the tile's name is
  // what a screen reader reads on the move.
  function handleGridMove(tile) {
    selectIcon(tile.getAttribute('data-icon-key'), false, false, true);
  }

  // Keyboard activation moves focus into the panel so the name is read and
  // the controls are the next Tab; a pointer click leaves focus where it is,
  // so browsing by mouse never jumps the page. detail is 0 for Enter and
  // Space; :focus-visible catches assistive tech whose activations arrive
  // as pointer-shaped clicks on a focused tile (a reader who Tabbed into the
  // grid and then clicks lands on the title too, which is harmless). A touch
  // screen does not take the focus path: the settings dock sits above the
  // grid on a phone, so focusing the name would scroll every tap back to
  // the top of the page. A touch screen reader's double-tap is a plain tap
  // on a tile that never held focus, so the pointer path's announcement is
  // what gives it its cue. A pointer click then focuses the tile, without
  // scrolling, so the arrows carry on from it: Safari never focuses a
  // button on click, and the arrows would otherwise do nothing there.
  // A pointer that went down on the tile is a pointer click even when the
  // tile already shows a focus ring: after the arrows it does, and clicking
  // the tile the arrows reached must not send focus to the panel.
  function handleGridPointerDown(event) {
    pointerTile = event.target.closest('.tool-tile');
  }

  function handleGridClick(event) {
    var tile = event.target.closest('.tool-tile');
    var pointer = pointerTile !== null && pointerTile === tile;
    pointerTile = null;
    if (!tile || !el.grid.contains(tile)) return;
    var byKeyboard = event.detail === 0 || (!pointer && tile.matches(':focus-visible'));
    selectIcon(tile.getAttribute('data-icon-key'), byKeyboard);
    if (!byKeyboard) gridNav.focus(tile, { preventScroll: true });
  }

  //
  //------- SELECTION AND PANEL -------//
  //

  // silent is the initial selection: the page opening on an icon is not an
  // event to announce. quiet is an arrow move: the URL follows, but focus
  // already says the name, so there is nothing to announce.
  function selectIcon(key, focusPanel, silent, quiet) {
    var icon = iconsByKey[key];
    if (!icon) return;

    var previous = params.selected && iconsByKey[params.selected];
    if (previous && previous.tile) previous.tile.removeAttribute('aria-current');

    params.selected = key;
    icon.tile.setAttribute('aria-current', 'true');
    gridNav.setTabStop(icon.tile);

    renderPanel();
    if (silent) return;
    window.clearTimeout(urlTimer);
    if (quiet) {
      // The path is checked first: Barba pushes the next page's address
      // while this grid is still attached, and ?icon= must not land on it.
      var path = window.location.pathname;
      urlTimer = window.setTimeout(function writeSettledUrl() {
        if (window.location.pathname === path && el.grid && el.grid.isConnected) writeUrl(params.selected);
      }, URL_DEBOUNCE_MS);
      return;
    }
    writeUrl(key);
    if (focusPanel) {
      el.detailTitle.focus();
    } else {
      // Assistive tech whose activations arrive as clicks gets a cue here;
      // the tile keeps focus, so nothing else would be read. A touch screen
      // reader's double-tap lands here too.
      announce(icon.name + ' selected');
    }
  }

  // The selection goes into ?icon= so Copy link carries it and a reload
  // keeps it; the doc promises exactly that link. history.state is carried
  // through: Barba keeps its history payload there, and replacing it with
  // null breaks Forward after the next Back. One write per selection; arrow
  // moves are written once they settle (URL_DEBOUNCE_MS), and replaceState
  // adds no history entry, so arrowing leaves nothing to step back through.
  function writeUrl(key) {
    if (!window.URL || !history.replaceState) return;
    var next = new URL(window.location.href);
    next.searchParams.set('icon', key);
    if (next.href === window.location.href) return;
    try {
      history.replaceState(history.state, '', next.href);
    } catch (error) {
      console.warn('[icon-library] the browser refused a history write; the URL is stale', error);
    }
  }

  function readableLabel(label) {
    var words = String(label).replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function findSwatch(id) {
    return palette.filter(function (entry) { return entry.id === id; })[0] || null;
  }

  // Named the way the logo tool names its exports: underscores between the
  // fields, hyphens inside them. Both the key and the colour id carry
  // hyphens, so a single-hyphen join has no readable boundary
  // (sidebar-left-open-brown-lighter-512 does not parse). Type, brand, key,
  // colour, size: nobody has to open the file to find out which colour it
  // carries or whose set it came from. A hand-picked colour is named hex-<hex>,
  // the value itself. The brand field is dropped, not defaulted, when the manifest
  // carries none: a literal "bydefault" here would be instance data inside
  // the engine.
  function buildFilename(extension) {
    var icon = iconsByKey[params.selected];
    if (!icon) return '';
    var colour = params.colourId === 'custom' ? 'hex-' + params.colour.replace('#', '') : params.colourId;
    var fields = ['icon', brandId, icon.key];
    // A name states what the file carries. The HTML snippet carries neither
    // the colour nor the size, so naming it after them would be a lie the
    // reader only finds out about after opening it.
    if (currentFormat().baked) fields = fields.concat([colour, params.size]);
    return fields.filter(function (piece) {
      return piece !== '';
    }).map(function (piece) {
      return S.sanitiseName(String(piece));
    }).join('_') + '.' + extension;
  }

  // Two passes. Selection builds the markup and the two exports that depend
  // on the icon alone (the HTML snippet and the data-icon value); colour and
  // size touch custom properties, the label, the filename, the note and the
  // two baked exports, so a slider drag rebuilds two strings per frame, not
  // four.
  function renderPanel() {
    var icon = iconsByKey[params.selected];
    if (!icon) return;

    showError('');
    el.detailTitle.textContent = icon.name;
    el.detailCategory.textContent = icon.category;

    el.preview.innerHTML = '<span class="svg-icn" data-icon="' + escapeHtml(icon.key) + '">'
      + localiseIds(displaySvg(icon.svg), 'preview') + '</span>';
    clearCopiedState();
    syncPreview();
  }

  function syncPreview() {
    syncStyleReset();
    var icon = iconsByKey[params.selected];
    if (!icon) return;
    el.preview.style.setProperty('--il-size', params.size + 'px');
    el.preview.style.setProperty('--il-colour', params.colour);
    if (params.fill) el.preview.setAttribute('data-scale', 'fill');
    else el.preview.removeAttribute('data-scale');
    params.ground = pickGround();
    // The ground is the band's: the canvas's checkerboard, light and dark.
    el.previewBand.setAttribute('data-ground', params.ground === 'transparent' ? 'checker' : params.ground);
    // The band's text and switch take the ink that reads on that ground — dark on
    // the checkerboard and the light ground, light on the dark one — or the icon's
    // own colour wherever it clears AA there (tool-canvas.js).
    el.previewBand.setAttribute('data-preview-ink', params.ground === 'dark' ? 'light' : 'dark');
    if (window.ToolPreview) window.ToolPreview.syncInk(el.previewBand, params.colour);
    // Spoken, so "pixels" rather than "px", and a custom colour is named by
    // its hex rather than the bare word the visible line pairs with one.
    var swatch = findSwatch(params.colourId);
    var spokenColour = swatch ? swatch.label : 'custom ' + params.colour.toUpperCase();
    el.preview.setAttribute('aria-label', icon.name + ', ' + params.size + ' pixels, ' + spokenColour);
    // The Details corner: what the file is. The size is one unbroken run, so a
    // narrow corner never splits "24 × 24 px".
    // Some palette labels are token names ("off-black"); the line reads them as
    // words ("Off black"), the way the Logo Tool names its colours.
    el.detailColour.textContent = swatch ? readableLabel(swatch.label) : params.colour.toUpperCase();
    el.detailSize.textContent = params.size + '\u00a0×\u00a0' + params.size + '\u00a0px';
    renderGuides(icon);
    updateScaleNote();
    updateExportStrings();
  }

  // The icon spec over the icon: assets/js/layer-stack.js's icon template,
  // drawn in the icon's own viewBox inside its wrapper, so it scales with
  // the drawing. Preview only — every export reads icon.svg, never the DOM.
  function renderGuides(icon) {
    var holder = el.preview.firstElementChild;
    if (!holder) return;
    var existing = holder.querySelector('.tool-guides');
    if (!(params.guides || params.grids) || !window.LayerStack) {
      if (existing) existing.remove();
      return;
    }
    var overlay = existing || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'tool-guides');
    overlay.setAttribute('aria-hidden', 'true');
    if (!existing) holder.appendChild(overlay);
    if (!guidesSpec) guidesSpec = window.LayerStack.createSpec('icon');
    guidesSpec.layers.forEach(function (entry) {
      if (entry.type !== 'group') return;
      if (entry.label === 'Guides') entry.visible = params.guides;
      if (entry.label === 'Grids') entry.visible = params.grids;
    });
    var artwork = window.LayerStack.readArtwork(icon.svg, 0);
    window.LayerStack.render(overlay, guidesSpec, { artwork: artwork, overlayOnly: true, scope: el.preview });
  }

  // The band draws the icon at no less than 8rem and no more than its own
  // height, so a 24 px icon shows larger than it exports and a 512 px one
  // smaller. Say so either way, and say when it is the real size, the way the
  // Logo Tool does, so the preview
  // never quietly misleads about size. Not a live region — rewritten on
  // every render.
  function updateScaleNote() {
    if (!el.scaleNote || !el.preview) return;
    var holder = el.preview.firstElementChild;
    if (!holder) {
      el.scaleNote.textContent = '';
      el.preview.removeAttribute('aria-describedby');
      return;
    }
    var shown = Math.round(holder.getBoundingClientRect().width);
    var scaled = shown > 0 && shown !== params.size;
    // The export size is in the Details corner, so the note says only the scale.
    var next = !shown ? '' : scaled
      ? 'Shown at ' + Math.round((shown / params.size) * 100) + '%'
      : 'Shown at actual size';
    // Only on a real change: a write that changes nothing still counts as
    // a mutation for the observer chain.
    if (el.scaleNote.textContent !== next) el.scaleNote.textContent = next;
    // A screen reader landing on the image hears that it is shown scaled.
    if (scaled) el.preview.setAttribute('aria-describedby', 'il-scale-note');
    else el.preview.removeAttribute('aria-describedby');
  }

  //
  //------- GROUND -------//
  //

  // Relative luminance and contrast, the WCAG formulas. Here they answer one
  // question: can the reader see the icon on the stage it is drawn on.
  function luminance(hex) {
    var channels = [1, 3, 5].map(function (index) {
      var value = parseInt(hex.substr(index, 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  }

  function contrast(a, b) {
    var one = luminance(a);
    var two = luminance(b);
    return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
  }

  // The stage follows the colour rather than asking about it: whichever of
  // the canvas's two grounds the colour contrasts with better, so a pale icon
  // is never invisible on it. Transparent swaps in the checkerboard — what an
  // SVG or PNG export really is — and stays on whatever the colour, the way
  // the Logo Tool's does: it previews the file, so a pale icon on it shows
  // exactly how faint the file would be on white.
  function pickGround() {
    if (params.transparent) return 'transparent';
    // Measured against the grounds the canvas actually paints —
    // --background-white and --background-black, read from the stylesheet at
    // init — not the brand's off-white and off-black swatches, which sit a
    // few steps inside them.
    return contrast(params.colour, grounds.dark) >= contrast(params.colour, grounds.light) ? 'dark' : 'light';
  }

  // The literals are the tokens' own defaults, for a stylesheet that lost one.
  var grounds = { light: '#ffffff', dark: '#000000' };

  function resolveGrounds() {
    var styles = getComputedStyle(document.documentElement);
    var light = normaliseHex(styles.getPropertyValue('--background-white'));
    var dark = normaliseHex(styles.getPropertyValue('--background-black'));
    if (light) grounds.light = light;
    if (dark) grounds.dark = dark;
  }

  // The stage's height drives the scale note, and that height changes with
  // the viewport, not with the selection, which is the one event the
  // selection-driven calls never see.
  function observePreview() {
    if (typeof ResizeObserver === 'undefined' || !el.preview) return;
    previewObserver = new ResizeObserver(function onResize() {
      updateScaleNote();
    });
    previewObserver.observe(el.preview);
  }

  //
  //------- EXPORTS -------//
  //
  // The SVG string is the single artefact: downloaded as-is for SVG,
  // rasterised for PNG. It is always a string we built, so the canvas never
  // taints. Every build step runs through the shared engine (window.SvgCleaner);
  // nothing here parses or optimises SVG itself.

  function sourceSvg() {
    var icon = iconsByKey[params.selected];
    return icon ? icon.svg : '';
  }

  // Root width and height at the export size, currentColor replaced by the
  // export hex — the buildSvgString sequence in logo-tool.js.
  function colouredSizedSvg() {
    var svg = sourceSvg()
      .replace(/(<svg[^>]*?)\s+width\s*=\s*["'][^"']*["']/i, '$1')
      .replace(/(<svg[^>]*?)\s+height\s*=\s*["'][^"']*["']/i, '$1')
      .replace(/<svg/i, '<svg width="' + params.size + '" height="' + params.size + '"');
    // Case-insensitive: currentcolor is valid and renders, and a split on one
    // spelling would export it black with no error.
    return svg.replace(/currentcolor/gi, function () { return params.colour; });
  }

  // Standalone: xmlns and the XML declaration restored, so the file opens in
  // Finder, in an <img>, anywhere.
  function buildStandaloneSvg() {
    return S.processSVG(colouredSizedSvg(), { sanitise: true, standalone: true, stripComments: true });
  }

  // The design-system form, what the SVG Cleaner's Icon mode emits: the
  // .svg-icn wrapper, data-icon on the svg, currentColor, 100% sizing. Built
  // from the file's own markup, which is why the manifest carries it. Plus
  // aria-hidden, which the engine has no option for (ROADMAP, SVG Cleaner)
  // and the generator adds to every icon the site renders: the snippet is a
  // decorative icon and should read as one.
  function buildHtmlSnippet() {
    var snippet = S.processSVG(sourceSvg(), {
      sanitise: true, icon: true, iconName: params.selected, currentColor: true, stripComments: true
    });
    return snippet.replace(/<svg(?![^>]*\saria-hidden=)/i, function () { return '<svg aria-hidden="true"'; });
  }

  // A background-image value. A data URI cannot inherit currentColor, so the
  // export colour is the only sensible fill.
  function buildCssDataUri() {
    return S.processSVG(colouredSizedSvg(), { sanitise: true, css: true, cssFormat: 'url', stripComments: true });
  }

  // One format at a time. Each names what it produces, which extension it
  // lands as, and whether the export colour and size are baked in — the HTML
  // snippet is the odd one out, because an inline icon inherits both from
  // the page and a baked value would break that the moment it was pasted.
  var FORMATS = {
    svg: { ext: 'svg', word: 'SVG', mime: 'image/svg+xml', baked: true, build: function () { return buildStandaloneSvg(); } },
    png: { ext: 'png', word: 'PNG', mime: 'image/png', baked: true, build: null },
    html: { ext: 'html', word: 'HTML', mime: 'text/html', baked: false, build: function () { return buildHtmlSnippet(); } },
    // Copy hands over the bare value, which is what you paste into a rule.
    // A downloaded .css is a stylesheet, and a bare value in one is a parse
    // error, so the file gets a real rule around it named after the icon.
    css: {
      ext: 'css', word: 'CSS', mime: 'text/css', baked: true,
      build: function () { return buildCssDataUri(); },
      file: function () {
        return '.icon-' + params.selected + ' {\n  background-image: ' + buildCssDataUri() + ';\n}\n';
      }
    }
  };

  function currentFormat() {
    return FORMATS[params.format] || FORMATS.svg;
  }

  // One answer, two writers: updateExportStrings on every colour, size,
  // selection and format change, and releaseExport when a PNG render
  // settles. Without the shared answer a render that finished after a
  // switch to a format with no file would hand the button back enabled.
  function canDownload() {
    return Boolean(iconsByKey[params.selected]) && !pngExporting;
  }

  // PNG is the one format with no text to hand the clipboard, so its
  // data-copy stays empty and copy-button.js leaves the button alone —
  // handleCopy takes the image path instead.
  function updateExportStrings() {
    var ready = Boolean(iconsByKey[params.selected]);
    var format = currentFormat();
    // The buttons name the format they make: "Download SVG", "Copy CSS".
    el.copyFormat.textContent = format.word;
    el.downloadFormat.textContent = format.word;
    el.copy.setAttribute('data-copy', ready && format.build ? format.build() : '');
    el.copy.disabled = !ready;
    el.download.disabled = !canDownload();
    // The field says what you are about to get: the file's name.
    el.filename.value = ready ? buildFilename(format.ext) : '';
  }

  // copy-button.js swaps the tooltip to "Copied!" for the formats it handles,
  // and the PNG path never reaches it. Both places this file drives the copied
  // state have to keep that contract, or the bubble contradicts the check icon
  // beside it. Same attribute protocol as the module: the original is parked
  // once and restored once, so a second copy inside the feedback window cannot
  // capture "Copied!" as the thing to go back to.
  function setCopiedTooltip(button) {
    if (!button.hasAttribute('data-tooltip')) return;
    if (!button.hasAttribute('data-tooltip-original')) {
      button.setAttribute('data-tooltip-original', button.getAttribute('data-tooltip'));
    }
    button.setAttribute('data-tooltip', 'Copied!');
  }

  // Safe to call on a button that never swapped: the parked attribute is the
  // only thing it reads. That is also what makes it safe to run ahead of
  // copy-button.js's own revert timer — that timer finds nothing parked and
  // leaves the restored tooltip alone.
  function restoreTooltip(button) {
    if (!button.hasAttribute('data-tooltip-original')) return;
    button.setAttribute('data-tooltip', button.getAttribute('data-tooltip-original'));
    button.removeAttribute('data-tooltip-original');
  }

  // A "Copied!" describes one format of one icon. Changing either makes it a
  // claim about something the clipboard does not hold — the tooltip included,
  // which outlived the class before it was cleared here too.
  function clearCopiedState() {
    el.copy.classList.remove('is-copied');
    restoreTooltip(el.copy);
  }

  // SVG string -> Image -> canvas at the EXACT export pixels. No
  // devicePixelRatio: the reader asked for absolute pixels, unlike a screen
  // canvas. Copied from logo-tool.js; the third consumer lifts both into a
  // shared helper (ROADMAP, Logo Tool).
  function rasterise(svgString, width, height, mimeType, background) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }));
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          if (background) {
            context.fillStyle = background;
            context.fillRect(0, 0, width, height);
          }
          context.drawImage(image, 0, 0, width, height);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('toBlob returned null'));
          }, mimeType, 0.92);
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('SVG decode failed'));
      };
      image.src = url;
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Deferred — a synchronous revoke can cancel the download before it starts.
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Cleared and written a tick apart, for the reason announce() is: the same
  // message twice in one task is no net mutation, and a role="alert" that
  // does not change does not speak. An empty message clears immediately —
  // there is nothing to announce.
  function showError(message) {
    if (!el.error) return;
    var region = el.error;
    window.clearTimeout(errorTimer);
    region.textContent = '';
    if (!message) return;
    errorTimer = window.setTimeout(function writeError() {
      region.textContent = message;
    }, 0);
  }

  // One button, one format. A text format is a Blob; PNG goes through the
  // canvas, which is async and needs the gate below.
  function handleDownload() {
    if (!canDownload()) return;
    var format = currentFormat();
    showError('');
    if (format.build) {
      var text = format.file ? format.file() : format.build();
      saveBlob(new Blob([text], { type: format.mime }), buildFilename(format.ext));
      return;
    }
    downloadPng();
  }

  // Copy: the text formats are copy-button.js's job through data-copy, and
  // it bails on an empty one, so only PNG lands here. An image on the
  // clipboard needs ClipboardItem, which not every browser has.
  function handleCopy() {
    // Cleared before the guard: a PNG failure must not still be on screen
    // under a later, successful copy of another format.
    showError('');
    if (params.format !== 'png' || !iconsByKey[params.selected]) return;
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      showError('This browser cannot copy an image. Download the PNG instead.');
      return;
    }
    var button = el.copy;
    var mySession = session;
    rasterise(buildStandaloneSvg(), params.size, params.size, 'image/png', null)
      .then(function (blob) {
        return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      })
      .then(function () {
        if (mySession !== session) return;
        button.classList.add('is-copied');
        setCopiedTooltip(button);
        // copy-button.js announces its own copies through its live region;
        // this path bypasses the module, so the success is spoken here or it
        // is silent for a screen reader (WCAG 4.1.3). The failure path already
        // lands in the alert.
        announce('Copied PNG');
        // The shared handle, not a private timer: copy-button.js clears this
        // one on its own copies, so the two paths cannot strip each other's
        // "Copied!" early. Taking the handle also takes the revert, which is
        // why this one has to restore the tooltip as well — the module's
        // timer is the only other code that would have.
        window.clearTimeout(button.bdCopyRevertTimer);
        button.bdCopyRevertTimer = window.setTimeout(function revert() {
          button.classList.remove('is-copied');
          restoreTooltip(button);
        }, COPY_FEEDBACK_MS);
      })
      .catch(function () {
        if (mySession !== session) return;
        showError('Couldn\u2019t copy the PNG in this browser. Download it instead.');
      });
  }

  // The raster path is async: without a gate a double-click launches two
  // canvas chains and two downloads of the same filename. The flag is the
  // gate, not the disabled attribute: updateExportStrings rewrites disabled
  // on every colour or size change and would reopen it mid-render.
  function downloadPng() {
    if (pngExporting) return;
    var svgString = buildStandaloneSvg();
    var filename = buildFilename('png');
    // Captured: el is emptied on the next Barba arrival, and a render that
    // settles after a departure must not throw out of the promise.
    var button = el.download;
    var hadFocus = document.activeElement === button;
    // A render still in flight when the reader navigates away resolves on
    // whatever page they are on now: it must not save a file they have left
    // behind, and it must not open the gate a later export is holding.
    var token = ++exportSeq;
    var mySession = session;
    pngExporting = true;
    button.disabled = true;

    function isCurrent() {
      return token === exportSeq && mySession === session;
    }

    function releaseExport() {
      if (!isCurrent()) return;
      pngExporting = false;
      button.disabled = !canDownload();
      // Disabling the focused button blurred a keyboard user to <body>; hand
      // focus back to the reader who had it, and only when it actually fell
      // there. A mouse user in Safari never focused the button at all.
      if (hadFocus && document.activeElement === document.body) button.focus();
    }

    rasterise(svgString, params.size, params.size, 'image/png', null)
      .then(function (blob) {
        if (!isCurrent()) return;
        releaseExport();
        saveBlob(blob, filename);
      })
      .catch(function () {
        if (!isCurrent()) return;
        releaseExport();
        showError('Couldn\u2019t render the PNG in this browser. Download the SVG, and tell the studio if it keeps happening.');
      });
  }

  // The checked segment's value; SVG before any is checked.
  function checkedFormat() {
    var radio = el.format.querySelector('input[name="il-format"]:checked');
    return radio ? radio.value : 'svg';
  }

  function handleFormatChange(event) {
    if (event.target.name !== 'il-format') return;
    showError('');
    params.format = checkedFormat();
    clearCopiedState();
    updateExportStrings();
  }

  //
  //------- COLOUR -------//
  //

  // The tools' one palette (tool-colour.js), the same in every tool and
  // read from the brand's tokens, so a brand that re-points them re-skins
  // the swatches with no code change. Values lower-cased: they are export
  // data, and the file names and the markup have always written them so.
  function resolvePalette() {
    palette = window.ToolColour.readPalette().map(function (entry) {
      return { id: entry.id, label: entry.label, value: entry.value.toLowerCase() };
    });
  }

  // The Colour control: the palette as colour chips, the picker and the hex
  // field (tool-colour.js; cms/tool-canvas.md, Colour). A custom colour
  // matches no chip and leaves every radio unchecked.
  function buildColourControl() {
    colourCtl = window.ToolColour.create(el.colourMount, {
      id: 'il-colour',
      label: 'Colour',
      value: params.colour,
      onChange: handleColourChange
    });
    // A rejected hex fires no onChange, but it is still a change Style's
    // reset clears; the field's own change event bubbles here.
    el.colourMount.addEventListener('change', syncStyleReset);
  }

  function syncColour() {
    if (colourCtl) colourCtl.set(params.colour);
  }

  function handleColourChange(state) {
    params.colourId = state.id;
    params.colour = state.value.toLowerCase();
    syncPreview();
  }

  //
  //------- SIZE -------//
  //

  // The number field is skipped when it is the source of the change: writing
  // "24" back over a typed "024" or "24.5" moves the caret to the end
  // mid-edit. handleSizeChange writes it on blur, when editing is over.
  function syncSize(source) {
    if (source !== el.sizeNumber) el.sizeNumber.value = String(params.size);
    syncSizePresets();
  }

  // The preset that matches the size is checked; a size between presets
  // leaves none checked, so the control never claims a size it is not.
  function syncSizePresets() {
    if (!el.sizePresets) return;
    el.sizePresets.querySelectorAll('input[type="radio"]').forEach(function (radio) {
      radio.checked = parseInt(radio.value, 10) === params.size;
    });
  }

  function handleSizePreset(event) {
    var value = parseInt(event.target.value, 10);
    if (isNaN(value)) return;
    params.size = clamp(value, sizeMin, sizeMax);
    syncSize();
    syncPreview();
  }

  // The number field's handler: number-input.js
  // dispatches input after stepping, so the steppers land here too. A field
  // mid-edit ("5" on the way to "512") is NaN or out of range and is left
  // alone; the clamp lands on change, when the reader has finished.
  // valueAsNumber, not parseInt: "1e3" is a valid number-field value and
  // parseInt would read it as 1.
  function handleSizeInput(event) {
    var value = Math.round(event.target.valueAsNumber);
    if (isNaN(value)) return;
    if (event.target === el.sizeNumber && (value < sizeMin || value > sizeMax)) return;
    params.size = clamp(value, sizeMin, sizeMax);
    syncSize(event.target);
    syncPreview();
  }

  // syncSize writes the field back either way, so every branch that changes
  // what the reader typed says so: a clamp and a revert are both silent
  // corrections otherwise, and the field just reads back a number they did
  // not enter.
  // Reachable after release(): Barba removes the outgoing container after
  // afterEnter, so a focused dirty number field is detached then, which fires
  // change into an emptied el. Back and swipe-back are the paths that get
  // there without blurring the field first.
  function handleSizeChange() {
    if (!el.sizeNumber) return;
    var value = Math.round(el.sizeNumber.valueAsNumber);
    if (isNaN(value)) {
      announce('Size returned to ' + params.size + ' pixels');
    } else {
      params.size = clamp(value, sizeMin, sizeMax);
      // clamp runs in both directions: "limited to 16" for a value that went
      // up is a lie the reader cannot check.
      if (params.size !== value) {
        announce(value < sizeMin
          ? 'Size raised to ' + sizeMin + ' pixels, the smallest export'
          : 'Size limited to ' + sizeMax + ' pixels, the largest export');
      }
    }
    syncSize();
    syncPreview();
  }

  // Back to the defaults the page opens with: the brand's ink, the authoring
  // grid's size, and the transparent stage. The selection is not a setting
  // and is left alone — a reader resetting the export has not stopped
  // looking at the icon they picked.
  function handleReset() {
    var preferred = findSwatch(DEFAULT_COLOUR_ID) || palette[0];
    if (preferred) {
      params.colourId = preferred.id;
      params.colour = preferred.value;
    }
    params.size = SIZE_DEFAULT;
    params.transparent = false;
    el.transparent.checked = false;
    params.guides = false;
    el.guides.checked = false;
    params.grids = false;
    el.grids.checked = false;
    params.fill = false;
    el.fill.checked = false;
    syncColour();
    syncSize();
    syncPreview();
    announce('All settings reset');
  }

  // The Style section's default: the brand's ink. The size is the export's
  // and sits in Export, which has no reset; Reset all puts it back.
  function styleDefault() {
    return findSwatch(DEFAULT_COLOUR_ID) || palette[0];
  }

  // The section's reset is there always and live only while the colour
  // differs from its default (tool-canvas.js, Section reset). Every colour
  // change ends in syncPreview, which calls this.
  function syncStyleReset() {
    if (!el.styleReset) return;
    var preferred = styleDefault();
    var colourAtDefault = !preferred || (params.colourId === preferred.id && params.colour === preferred.value);
    // A bad hex typed over the default is a change the reset clears
    el.styleReset.disabled = colourAtDefault && !(colourCtl && colourCtl.isDirty());
  }

  // Style only: the colour back; the selection, the export and the preview
  // switches stay.
  function handleStyleReset() {
    var preferred = styleDefault();
    if (preferred) {
      params.colourId = preferred.id;
      params.colour = preferred.value;
    }
    syncColour();
    syncPreview();
    announce('Style reset to its defaults');
  }

  // Preview only: the checkerboard instead of the ground. Nothing in any file
  // changes, so nothing past the band is redrawn.
  function handleTransparentChange() {
    params.transparent = el.transparent.checked;
    syncPreview();
  }

  function handleGuidesChange() {
    params.guides = el.guides.checked;
    syncPreview();
  }

  // Preview only, like the switches beside it: the export size is untouched,
  // and the scale note, re-read in syncPreview, says how far it is enlarged.
  function handleFillChange() {
    params.fill = el.fill.checked;
    syncPreview();
  }

  function handleGridsChange() {
    params.grids = el.grids.checked;
    syncPreview();
  }

  //
  //------- SEARCH AND CATEGORY -------//
  //

  function applySearch() {
    var next = el.search.value.trim().toLowerCase();
    // Whitespace-only edits and repeated keystrokes inside a debounce window
    // both land here with nothing actually changed.
    if (next === params.query) return;
    params.query = next;
    applyFilter();
  }

  // Bound to 'input' rather than 'keyup': paste, dictation and the field's
  // native clear button all fire input without a key.
  function handleSearchInput() {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(applySearch, FILTER_DEBOUNCE_MS);
  }

  // Blink and WebKit clear a type="search" field natively on Escape and fire
  // 'search' rather than 'input' in some paths; applying immediately keeps
  // the grid in step with the field everywhere.
  function handleSearchEvent() {
    window.clearTimeout(filterTimer);
    applySearch();
  }

  // Escape clears the field and the query — done here so it is the same in
  // every browser. Focus stays in the field: the reader pressed Escape to
  // type something else.
  function handleSearchKeydown(event) {
    if (event.key !== 'Escape' || !el.search.value) return;
    el.search.value = '';
    // A script write fires no event; this one lets field.js hide the clear.
    el.search.dispatchEvent(new Event('input', { bubbles: true }));
    window.clearTimeout(filterTimer);
    applySearch();
  }

  // One chip per category the set actually uses, in the Brand Book's order,
  // "All" first. No counts on the chips: the count beside the panel title
  // already says how many are showing, category included. Native radios: the browser supplies the radiogroup, the
  // single tab stop and the arrow keys, and a keypress that moves the choice
  // fires change like a click.
  function buildCategoryChips(manifest) {
    var counts = {};
    icons.forEach(function (icon) { counts[icon.category] = (counts[icon.category] || 0) + 1; });
    var chips = [categoryChip('all', 'All')];
    manifest.categories.forEach(function (category) {
      if (typeof category !== 'string' || !counts[category]) return;
      chips.push(categoryChip(category, category));
    });
    el.category.innerHTML = chips.join('');
  }

  function categoryChip(value, label) {
    var checked = value === params.category ? ' checked' : '';
    return '<label class="chip"><input type="radio" name="il-category" value="' + escapeHtml(value) + '"' + checked + '>'
      + '<span>' + escapeHtml(label) + '</span></label>';
  }

  function handleCategoryChange(event) {
    var input = event.target;
    if (!input || input.name !== 'il-category') return;
    params.category = input.value || 'all';
    applyFilter();
  }

  // ?icon=<key> opens the page on that icon; anything that is not a key in
  // the set is ignored.
  function iconFromUrl() {
    if (!window.URLSearchParams) return null;
    var key = new URLSearchParams(window.location.search).get('icon');
    return key && iconsByKey[key] ? iconsByKey[key] : null;
  }

  //
  //------- STATES -------//
  //

  function showEmptyState(message) {
    if (el.empty) {
      el.empty.hidden = false;
      var text = el.empty.querySelector('[data-empty-message]');
      if (text) text.textContent = message;
    }
    if (el.layout) el.layout.classList.add('is-empty');
  }

  //
  //------- INIT -------//
  //

  function resolveElements(root) {
    el = {
      root: root,
      layout: root.querySelector('#icon-library'),
      search: root.querySelector('#il-search'),
      category: root.querySelector('#il-category'),
      categoryScroll: root.querySelector('#il-category-scroll'),
      count: root.querySelector('#il-count'),
      noMatch: root.querySelector('#il-no-match'),
      noMatchTitle: root.querySelector('#il-no-match-title'),
      noMatchText: root.querySelector('#il-no-match-text'),
      status: root.querySelector('#il-status'),
      grid: root.querySelector('#il-grid'),
      empty: root.querySelector('#il-empty'),
      detailTitle: root.querySelector('#il-detail-title'),
      detailCategory: root.querySelector('#il-detail-category'),
      detailColour: root.querySelector('#il-detail-colour'),
      detailSize: root.querySelector('#il-detail-size'),
      transparent: root.querySelector('#il-transparent'),
      guides: root.querySelector('#il-guides'),
      grids: root.querySelector('#il-grids'),
      fill: root.querySelector('#il-fill'),
      previewBand: root.querySelector('.tool-preview'),
      preview: root.querySelector('#il-preview'),
      scaleNote: root.querySelector('#il-scale-note'),
      colourMount: root.querySelector('#il-colour'),
      sizeNumber: root.querySelector('#il-size'),
      sizePresets: root.querySelector('#il-sizes'),
      reset: root.querySelector('#il-reset'),
      styleReset: root.querySelector('#il-style-reset'),
      format: root.querySelector('#il-format'),
      copyFormat: root.querySelector('#il-copy-format'),
      downloadFormat: root.querySelector('#il-download-format'),
      copy: root.querySelector('#il-copy'),
      download: root.querySelector('#il-download'),
      filename: root.querySelector('#il-filename'),
      error: root.querySelector('#il-error')
    };
  }

  function wireControls() {
    el.grid.addEventListener('pointerdown', handleGridPointerDown);
    el.grid.addEventListener('click', handleGridClick);
    gridNav = window.ToolGrid.create(el.grid, { tiles: visibleTiles, preferred: selectedTile, onMove: handleGridMove });
    el.reset.addEventListener('click', handleReset);
    if (el.styleReset) el.styleReset.addEventListener('tool:panel-reset', handleStyleReset);
    el.transparent.addEventListener('change', handleTransparentChange);
    el.guides.addEventListener('change', handleGuidesChange);
    el.grids.addEventListener('change', handleGridsChange);
    el.fill.addEventListener('change', handleFillChange);
    el.sizeNumber.addEventListener('input', handleSizeInput);
    el.sizeNumber.addEventListener('change', handleSizeChange);
    if (el.sizePresets) el.sizePresets.addEventListener('change', handleSizePreset);
    el.search.addEventListener('input', handleSearchInput);
    el.search.addEventListener('search', handleSearchEvent);
    el.search.addEventListener('keydown', handleSearchKeydown);
    el.category.addEventListener('change', handleCategoryChange);
    el.format.addEventListener('change', handleFormatChange);
    el.copy.addEventListener('click', handleCopy);
    el.download.addEventListener('click', handleDownload);
  }

  // Everything bound to elements dies with the container. What does not is
  // released here, on the next arrival — the timers and the observer.
  function release() {
    session = {};
    window.clearTimeout(filterTimer);
    window.clearTimeout(urlTimer);
    pointerTile = null;
    window.clearTimeout(countTimer);
    window.clearTimeout(statusTimer);
    window.clearTimeout(errorTimer);
    pngExporting = false;
    exportSeq += 1;  // orphans any render still in flight from the old page
    brandId = '';
    if (previewObserver) previewObserver.disconnect();
    previewObserver = null;
    el = {};
    icons = [];
    iconsByKey = {};
    visibleIcons = [];
    gridNav = null;
    params.selected = null;
    params.query = '';
    params.category = 'all';
    params.ground = 'light';
    params.transparent = false;
    params.guides = false;
    params.grids = false;
    params.fill = false;
    params.format = 'svg';
    params.colourId = null;
    params.colour = '#000000';
    colourCtl = null;
    params.size = SIZE_DEFAULT;
  }

  // Resolves the tool root from the scope handed in: the container itself
  // when it IS the tool (an element cannot match its own querySelector),
  // otherwise a search inside it.
  function resolveRoot(scope) {
    var root = scope || document;
    if (root.matches && root.matches(ROOT_SELECTOR)) return root;
    return root.querySelector(ROOT_SELECTOR);
  }

  // Called from the listeners below on every arrival, so nothing in here may
  // throw: a partially wired container would be left behind with no message,
  // and the console would carry the only trace.
  function initIconLibrary(scope) {
    var root = resolveRoot(scope);
    if (!root) {
      release();
      return;
    }
    if (root.dataset.iconLibraryInit) return;
    root.dataset.iconLibraryInit = 'true';

    release();
    resolveElements(root);

    var required = ['layout', 'search', 'category', 'categoryScroll', 'count', 'noMatch', 'noMatchTitle', 'noMatchText',
      'grid', 'detailTitle', 'detailCategory', 'detailColour', 'detailSize', 'transparent', 'guides', 'grids', 'fill', 'previewBand', 'preview',
      'colourMount', 'sizeNumber', 'reset', 'filename',
      'format', 'copyFormat', 'download', 'downloadFormat', 'copy', 'error'];
    var missing = required.filter(function (name) { return !el[name]; });
    if (missing.length) {
      console.error('[icon-library] markup is missing: ' + missing.join(', '));
      showEmptyState('The icon library is missing part of this page, so it cannot start. Tell the studio \u2014 this needs a rebuild, not a reload.');
      return;
    }

    S = window.SvgCleaner || null;
    if (!S) {
      console.error('[icon-library] engine missing — assets/js/vendor/svg-cleaner-core.js must load before icon-library.js');
      showEmptyState('The SVG engine did not load. Reload the page, and if it keeps happening tell the studio.');
      return;
    }

    var manifest = readManifest(root);
    if (!manifest) {
      console.warn('[icon-library] no #icon-manifest on this page — run the doc generator');
      showEmptyState('The icon set did not load. Reload the page, and if it keeps happening tell the studio.');
      return;
    }

    try {
      brandId = typeof manifest.brand === 'string' && /^[a-z0-9-]+$/.test(manifest.brand) ? manifest.brand : '';
      indexIcons(manifest);
      if (!icons.length) {
        showEmptyState('The icon set is empty. Add icons to assets/images/svg-icons/ and run the doc generator.');
        return;
      }
      buildCategoryChips(manifest);
      resolvePalette();
      resolveGrounds();
      var preferred = findSwatch(DEFAULT_COLOUR_ID) || palette[0];
      if (preferred) {
        params.colourId = preferred.id;
        params.colour = preferred.value;
      } else {
        params.colourId = 'custom';
        params.colour = '#000000';
      }
      buildColourControl();
      sizeMin = parseInt(el.sizeNumber.min, 10) || SIZE_MIN;
      sizeMax = parseInt(el.sizeNumber.max, 10) || SIZE_MAX;
      params.size = SIZE_DEFAULT;
      renderGrid();
      wireControls();
      observePreview();
      // The category row is the engine's scroller (scroller.js): its edge
      // fades and wheel. Bound once whoever gets there first.
      if (window.initScroller) window.initScroller(el.categoryScroll);
      params.format = checkedFormat();
      syncColour();
      syncSize();
      applyFilter();
      // Straight write, not the debounce: nothing has been announced yet.
      window.clearTimeout(countTimer);
      writeCount(visibleIcons.length);
      // The preview is never empty: the icon the URL names, or the first.
      var named = iconFromUrl();
      var initial = named || visibleIcons[0];
      if (initial) selectIcon(initial.key, false, true);
      // A deep link can name a tile thirty rows down; in fixed mode the grid
      // scrolls inside its panel, so bring the selected tile into view or
      // the preview shows an icon the grid does not.
      if (named && named.tile.scrollIntoView) named.tile.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      console.error('[icon-library] init failed', error);
      // Nothing half-built survives: the observer goes, the elements are
      // re-resolved for the empty state alone.
      release();
      resolveElements(root);
      // Not the markup message: the page can be complete and something threw.
      showEmptyState('The icon library hit an error while starting. Reload the page, and tell the studio if it keeps happening.');
      return;
    }

    console.log('[icon-library] init');
  }

  window.initIconLibrary = initIconLibrary;

  //
  //------- Initialize -------//
  //

  function handleDomReady() {
    initIconLibrary();
  }

  // Deferred a frame: Barba awaits its afterEnter hooks, so parsing a 127 KB
  // manifest and rendering 175 tiles inline would hold the transition's
  // critical section open with the containers still absolutely positioned.
  // The isConnected guard drops the work when a second navigation overtakes
  // this one, which resolveRoot's matches() would otherwise accept.
  function handleAfterNav(event) {
    var container = event.detail && event.detail.container;
    window.requestAnimationFrame(function initAfterPaint() {
      if (container && !container.isConnected) return;
      initIconLibrary(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    initIconLibrary();
  }

  document.addEventListener('bd:after-nav', handleAfterNav);
})();
