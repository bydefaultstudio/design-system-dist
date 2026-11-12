/**
 * asset-library.js — the Asset Library tool (asset-library-plan.md §1–§2).
 *
 * Find a brand file and take it: a grid of every asset the catalog offers,
 * narrowed by search, whose recognised words become filters, and by four
 * categories under it (Type, Format, Project, Tag), each a row of filter
 * tags with how many files each would show; the chosen
 * asset's details, rendition and verbs in the pinned end dock; a preview
 * overlay over the grid alone. The data is the manifest the generator
 * inlines on the page ({{asset-manifest}}, cms/generator/asset-library.js),
 * read once at init. Files come from the Worker's gated /files/ route; the
 * script never fetches a list.
 *
 * Lifecycle: the Icon Library's. One init per root, guarded by
 * dataset.assetLibraryInit; the bd:after-nav arrival is deferred one frame
 * so parsing the manifest and building the tiles never holds the Barba
 * transition open; release() drops the previous page's timers on the next
 * arrival. The whole module is a closure over `el` and `params`, re-resolved
 * on every arrival.
 *
 * Selection and the preview are two states on purpose: `params.selected`
 * is the one key the dock shows; the preview is that selection shown large,
 * and moving it with the arrows moves the selection. The arrows in the
 * grid move it too (tool-grid.js, shared with the Icon Library).
 *
 * @version 3.7.0
 */
(function () {
  'use strict';

  var VERSION = '3.7.0';

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
  console.log('[asset-library] v' + VERSION + ' loaded');

  var ROOT_SELECTOR = '[data-tool="asset-library"]';
  var PAGE_PATH = '/tools/asset-library.html';

  // Two debounces, deliberately different (the Icon Library's reasoning):
  // the filter follows typing closely; the count is a live region, and a
  // region rewritten on every keystroke is read on every keystroke.
  var FILTER_DEBOUNCE_MS = 100;
  // An arrow held down in the grid repeats about thirty times a second; the
  // URL is written once it settles, under the browsers' replaceState throttle.
  var URL_DEBOUNCE_MS = 300;
  var COUNT_DEBOUNCE_MS = 500;
  var ERROR_MS = 6000;

  var TYPE_ORDER = ['logo', 'icon', 'image', 'video', 'font', 'document', 'presentation', 'prototype', 'design', 'other'];
  var TYPE_LABEL = {
    logo: 'Logos', icon: 'Icons', image: 'Images', video: 'Video', font: 'Fonts', document: 'Documents',
    presentation: 'Presentations', prototype: 'Prototypes', design: 'Design files', other: 'Other',
  };
  function isType(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TYPE_LABEL, value);
  }

  var TYPE_SINGULAR = {
    logo: 'Logo', icon: 'Icon', image: 'Image', video: 'Video', font: 'Font', document: 'Document',
    presentation: 'Presentation', prototype: 'Prototype', design: 'Design file', other: 'File',
  };
  // The words that, typed into search, press a Type option rather than match
  // text. Singular and plural, and the teams' own names for each.
  var TYPE_WORDS = {
    logo: 'logo', logos: 'logo', wordmark: 'logo', lockup: 'logo',
    icon: 'icon', icons: 'icon',
    image: 'image', images: 'image', photo: 'image', photos: 'image', picture: 'image', photography: 'image', artwork: 'image',
    video: 'video', videos: 'video',
    font: 'font', fonts: 'font', typeface: 'font',
    document: 'document', documents: 'document', doc: 'document', docs: 'document',
    presentation: 'presentation', presentations: 'presentation', deck: 'presentation', decks: 'presentation',
    prototype: 'prototype', prototypes: 'prototype',
  };
  var FORMAT_ALIASES = { jpeg: 'jpg' };
  var KIND_ICON = {
    raster: 'file-image', svg: 'file-image', pdf: 'file-pdf', font: 'file-font',
    video: 'file-video', archive: 'folder-zip', office: 'file-doc', other: 'file',
  };
  // The four filter categories, in the order their tabs read. Each is a row
  // of filter tags; any option in a row matches, and every row must. A
  // tag's group is its own row within Tag: any tag in a group matches.
  var CATEGORIES = [
    { kind: 'type', label: 'Type' },
    { kind: 'format', label: 'Format' },
    { kind: 'project', label: 'Project' },
    { kind: 'tag', label: 'Tag' },
  ];
  // What a reader might type for what the catalog calls it. Each row is one
  // family: a query word in it matches any member.
  var SYNONYMS = [
    ['logo', 'logotype', 'mark', 'wordmark', 'lockup'],
    ['icon', 'glyph'],
    ['font', 'typeface', 'type'],
    ['photo', 'image', 'photography', 'picture', 'artwork', 'graphic', 'banner'],
    ['pdf', 'document'],
    ['presentation', 'deck', 'slides'],
    ['headshot', 'portrait', 'team'],
  ];

  var el = {};
  var assets = [];
  var assetsById = Object.create(null); // a plain object would answer ?asset=constructor
  var visible = [];
  var reordered = false; // the grid's DOM order is relevance, not the manifest's

  // The two views are the design system's own book surfaces: the grid a
  // shelf of media covers (.book-cover[data-variant="media"]), the list a
  // contents (.book-contents, .book-contents-item). The tile's own classes
  // stay; the component family swaps with the view.
  var TILE_CLASSES = {
    grid: { tile: 'book-cover', body: 'book-cover-body', title: 'book-cover-title', meta: 'book-cover-description' },
    list: { tile: 'book-contents-item', body: 'book-contents-item-body', title: 'book-contents-item-title', meta: 'book-contents-item-description' },
  };
  var currentView = 'grid';
  var resetNote = false; // the next count write also says the filters were reset
  var filterNotes = []; // ...and what filters came or went, which a bare total does not say
  var canvasObserver = null;
  var manifestData = null;
  // What is on, by category, and the order it was turned on in (the search
  // field lists them in that order, and Backspace takes the last). Within a
  // category any value matches, within Tag any tag in one group; across
  // categories and groups every one must (asset-library-plan.md §10).
  var params = { query: '', filters: emptyFilters(), order: [], selected: null, rendition: 0 };
  // Built from the manifest at init: what each recognisable word means, and
  // the options each category's row offers.
  var vocab = emptyVocab();
  var gridNav = null;  // the grid's keys and tab stop (tool-grid.js)
  var filterTimer = null;
  var urlTimer = null;
  var countTimer = null;
  var statusTimer = null;
  var errorTimer = null;
  var previewOpen = false;
  var lastPreviewedId = null;
  var iconMarkup = {};

  //
  //------- UTILITIES -------//
  //

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function emptyFilters() {
    return { type: [], format: [], project: [], tag: [] };
  }

  // Maps without a prototype: a word typed, or a value in the URL, is looked
  // up in them, and "constructor" must not find one.
  function emptyVocab() {
    return { tagGroup: Object.create(null), groups: [], types: [], formats: Object.create(null), formatKind: Object.create(null), projects: Object.create(null) };
  }

  function humanSize(bytes) {
    if (!bytes) return '';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  function humanDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(m[3], 10) + ' ' + months[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  function extensionOf(name) {
    var dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toUpperCase();
  }

  function fileIcon(kind) {
    return iconMarkup[KIND_ICON[kind] || 'file'] || iconMarkup.file || '';
  }

  function isWide() {
    // The canvas is placed (dock beside the grid) when its grid has an "end"
    // area — the same test the stylesheet makes, so the two cannot disagree.
    var areas = getComputedStyle(el.canvas).gridTemplateAreas || '';
    return areas.indexOf('end') !== -1;
  }

  //
  //------- MANIFEST -------//
  //

  function readManifest(root) {
    var node = root.querySelector('#asset-manifest') || document.getElementById('asset-manifest');
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      console.error('[asset-library] the manifest is not valid JSON', error);
      return null;
    }
  }

  function readIcons(root) {
    iconMarkup = {};
    var template = root.querySelector('#al-icons');
    if (!template || !template.content) return;
    // The generator expands {{icon:x}} into a .svg-icn wrapper; the tile and
    // the dock wrap it again, so only the <svg> itself is kept.
    // Direct children only: the wrapper and the <svg> inside carry data-icon
    // too, and the innermost would win a querySelectorAll.
    Array.prototype.forEach.call(template.content.children, function (span) {
      if (!span.hasAttribute('data-icon')) return;
      var svg = span.querySelector('svg');
      iconMarkup[span.getAttribute('data-icon')] = svg ? svg.outerHTML : span.innerHTML;
    });
  }

  function stemWords(name) {
    return name.replace(/\.[^.]+$/, '').replace(/[_@-]+/g, ' ');
  }

  // Search fields in rank order; the index of the first field a term hits
  // is the asset's relevance. Project titles and clients come from the
  // manifest's own list of kits, so "film festival" or "blackdoctor" finds
  // the project.
  function indexAssets(manifest) {
    var kitWords = {};
    (manifest.kits || []).forEach(function (k) { kitWords[k.id] = (k.title + ' ' + (k.client || '')).trim(); });
    assets = (manifest.assets || []).filter(function (a) {
      return a && typeof a.id === 'string' && Array.isArray(a.files) && a.files.length;
    }).map(function (a) {
      var formats = a.files.map(function (f) { return f.label + ' ' + (f.format || extensionOf(f.name)); }).join(' ');
      var stems = a.files.map(function (f) { return stemWords(f.name); }).join(' ');
      var kits = Array.isArray(a.kits) ? a.kits : [];
      return {
        id: a.id,
        title: a.title || a.id,
        type: isType(a.type) ? a.type : 'other',
        kits: kits,
        tags: Array.isArray(a.tags) ? a.tags : [],
        orientation: a.orientation || null,
        link: a.link && a.link.url ? a.link : null,
        format: (a.files[0].format || extensionOf(a.files[0].name)).toLowerCase(),
        description: a.description || '',
        alt: a.alt || '',
        added: a.added || '',
        licence: a.licence || null,
        licenceUrl: a.licenceUrl || null,
        licenceFoundry: a.licenceFoundry || null,
        openLicence: a.openLicence === true,
        files: a.files,
        fields: [
          (a.title || a.id).toLowerCase(),
          kits.map(function (k) { return kitWords[k] || k; }).join(' ').toLowerCase(),
          (a.tags || []).join(' ').replace(/-/g, ' ').toLowerCase(),
          (TYPE_LABEL[a.type] || 'Other').toLowerCase() + ' ' + (a.type || ''),
          formats.toLowerCase(),
          stems.toLowerCase(),
        ],
        tile: null,
        placeholder: null,
      };
    });
    assetsById = Object.create(null);
    assets = assets.filter(function (a) {
      if (assetsById[a.id]) {
        console.warn('[asset-library] duplicate asset id in the manifest: ' + a.id);
        return false;
      }
      assetsById[a.id] = a;
      return true;
    });
    buildVocab(manifest);
  }

  // Only what some file carries is recognised or offered: a word for a tag
  // no file has would turn into a filter that empties the grid, and an
  // option no file has would be a row of dead ends. Use (social, print) is
  // a tag group like the others since the categories replaced the For row.
  function buildVocab(manifest) {
    var carried = {};
    var typesHeld = {};
    assets.forEach(function (a) {
      a.tags.forEach(function (t) { carried[t] = true; });
      if (a.orientation) carried[a.orientation] = true;
      typesHeld[a.type] = true;
    });
    vocab = emptyVocab();
    vocab.types = TYPE_ORDER.filter(function (t) { return typesHeld[t]; });
    (manifest.tagGroups || []).forEach(function (group) {
      var tags = (group.tags || []).filter(function (t) { return carried[t]; });
      if (!tags.length) return;
      vocab.groups.push({ id: group.id, label: group.label, tags: tags });
      tags.forEach(function (t) { vocab.tagGroup[t] = group.id; });
    });
    assets.forEach(function (a) {
      vocab.formats[a.format] = a.link ? a.files[0].label : a.format.toUpperCase();
      vocab.formatKind[a.format] = a.link ? 'link' : a.files[0].kind || 'other';
    });
    (manifest.kits || []).forEach(function (k) {
      if (assets.some(function (a) { return a.kits.indexOf(k.id) !== -1; })) vocab.projects[k.id] = k;
    });
  }

  //
  //------- GRID -------//
  //

  function thumbSrcset(thumb) {
    if (!thumb || thumb.kind !== 'webp' || !thumb.src) return null;
    return thumb.src.map(function (src, i) { return src + ' ' + thumb.widths[i] + 'w'; }).join(', ');
  }

  function placeholderFor(asset) {
    var cover = asset.files[0];
    var hash = cover && cover.thumb && cover.thumb.hash;
    if (!hash || !window.ThumbHash) return null;
    if (asset.placeholder) return asset.placeholder;
    try {
      var bytes = Uint8Array.from(atob(hash), function (c) { return c.charCodeAt(0); });
      asset.placeholder = window.ThumbHash.thumbHashToDataURL(bytes);
    } catch (error) {
      asset.placeholder = null;
    }
    return asset.placeholder;
  }

  // A file's extension; a link's source, since its file is only the cover.
  function badgeFor(asset, file) {
    return asset.link ? file.label : extensionOf(file.name);
  }

  function thumbMarkup(asset, file, eager) {
    var thumb = file.thumb;
    var ground = file.ground || 'light';
    var open = '<span class="tool-thumb" data-ground="' + escapeHtml(ground) + '"' + (file.alpha ? ' data-alpha' : '') + '>';
    if (!thumb) {
      return open + '<span class="svg-icn" data-icon="' + escapeHtml(KIND_ICON[file.kind] || 'file') + '" aria-hidden="true">' + fileIcon(file.kind) + '</span>'
        + '<span class="badge tool-thumb-badge" aria-hidden="true">' + escapeHtml(badgeFor(asset, file)) + '</span></span>';
    }
    var src = thumb.kind === 'svg' ? thumb.src : thumb.src[0];
    var srcset = thumbSrcset(thumb);
    var size = thumb.width && thumb.height ? ' width="' + thumb.width + '" height="' + thumb.height + '"' : '';
    return open + '<img src="' + escapeHtml(src) + '"' + (srcset ? ' srcset="' + escapeHtml(srcset) + '" sizes="(min-width: 960px) 14rem, 45vw"' : '')
      + size + ' alt="" ' + (eager ? 'fetchpriority="high"' : 'loading="lazy"') + ' decoding="async"></span>';
  }

  function tileMarkup(asset, index) {
    var cover = asset.files[0];
    var family = TILE_CLASSES[currentView];
    return '<button type="button" class="tool-file ' + family.tile + '"' + (currentView === 'grid' ? ' data-variant="media"' : '') + ' data-asset-id="' + escapeHtml(asset.id) + '" tabindex="-1">'
      + thumbMarkup(asset, cover, index < 6)
      + '<span class="tool-file-body ' + family.body + '">'
      + '<span class="tool-file-title ' + family.title + '">' + escapeHtml(asset.title) + '</span>'
      + '<span class="tool-file-meta ' + family.meta + '">' + escapeHtml(TYPE_SINGULAR[asset.type] + (asset.link ? ' · ' + cover.label : '')) + '</span>'
      + '<span class="svg-icn tool-file-open" data-icon="open-full" aria-hidden="true">' + (iconMarkup['open-full'] || '') + '</span>'
      + '</span></button>';
  }

  function renderGrid() {
    el.grid.innerHTML = assets.map(tileMarkup).join('');
    Array.prototype.forEach.call(el.grid.children, function (tile, index) {
      var asset = assets[index];
      asset.tile = tile;
      var placeholder = placeholderFor(asset);
      if (placeholder) {
        var thumb = tile.querySelector('.tool-thumb');
        thumb.style.setProperty('--al-placeholder', 'url("' + placeholder + '")');
      }
    });
  }

  // A thumbnail that fails to load swaps to the type icon: never a broken
  // image glyph. Delegated through the capture phase, since error does not
  // bubble.
  function handleImageError(event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG' || !el.grid.contains(img)) return;
    var thumb = img.parentNode;
    var tile = img.closest('.tool-file');
    var asset = tile && assetsById[tile.getAttribute('data-asset-id')];
    var cover = asset && asset.files[0];
    var kind = cover ? cover.kind : 'other';
    thumb.innerHTML = '<span class="svg-icn" data-icon="' + escapeHtml(KIND_ICON[kind] || 'file') + '" aria-hidden="true">' + fileIcon(kind) + '</span>'
      + '<span class="badge tool-thumb-badge" aria-hidden="true">' + escapeHtml(cover ? badgeFor(asset, cover) : '') + '</span>';
    thumb.style.removeProperty('--al-placeholder');
  }

  // Once the WebP has landed the placeholder has done its job; clearing it
  // keeps the hash from showing round a picture that does not fill the box.
  function handleImageLoad(event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG' || !el.grid.contains(img)) return;
    img.parentNode.style.removeProperty('--al-placeholder');
  }

  //
  //------- SEARCH, FILTER, COUNT -------//
  //

  function expandTerm(term) {
    for (var i = 0; i < SYNONYMS.length; i++) {
      if (SYNONYMS[i].indexOf(term) !== -1) return SYNONYMS[i];
    }
    return [term];
  }

  // Every word must match somewhere; a word matches if any of its family
  // is a substring of any field. The rank is the best field any word hits.
  function matchRank(asset, terms) {
    var best = -1;
    for (var t = 0; t < terms.length; t++) {
      var family = expandTerm(terms[t]);
      var hit = -1;
      for (var f = 0; f < asset.fields.length && hit === -1; f++) {
        for (var s = 0; s < family.length; s++) {
          if (asset.fields[f].indexOf(family[s]) !== -1) { hit = f; break; }
        }
      }
      if (hit === -1) return -1;
      if (best === -1 || hit < best) best = hit;
    }
    return best === -1 ? 0 : best;
  }

  function hasTag(asset, tag) {
    return asset.tags.indexOf(tag) !== -1 || asset.orientation === tag;
  }

  // Does the asset hold this one option?
  function holds(asset, kind, value) {
    if (kind === 'type') return asset.type === value;
    if (kind === 'format') return asset.format === value;
    if (kind === 'project') return asset.kits.indexOf(value) !== -1;
    return hasTag(asset, value);
  }

  // Within a category any value matches, within Tag any tag of one group;
  // across categories and groups every one must. `except` leaves one
  // category, or one tag group, out: what a row's counts are taken against,
  // since an option joins the others in its own row rather than narrowing
  // them.
  function matchesFilters(asset, except) {
    for (var c = 0; c < CATEGORIES.length; c++) {
      var kind = CATEGORIES[c].kind;
      var on = params.filters[kind];
      if (!on.length || kind === 'tag') continue;
      if (except && except.kind === kind) continue;
      if (!on.some(function (v) { return holds(asset, kind, v); })) return false;
    }
    var byGroup = {};
    params.filters.tag.forEach(function (t) {
      var g = vocab.tagGroup[t];
      if (except && except.kind === 'tag' && except.group === g) return;
      (byGroup[g] = byGroup[g] || []).push(t);
    });
    for (var g in byGroup) {
      if (!byGroup[g].some(function (t) { return hasTag(asset, t); })) return false;
    }
    return true;
  }

  function applyFilter() {
    // Read before anything changes (the Icon Library's finding): hiding the
    // focused tile and then writing tabindex on it blurs it to <body>.
    var active = document.activeElement;
    var terms = params.query ? params.query.split(/\s+/).filter(Boolean) : [];
    var ranked = [];
    assets.forEach(function (asset) {
      // The text match is kept apart from the filters: a row's counts are
      // the text match and every other category.
      var rank = terms.length ? matchRank(asset, terms) : 0;
      asset.queryHit = rank !== -1;
      var show = asset.queryHit && matchesFilters(asset);
      asset.tile.classList.toggle('is-hidden', !show);
      if (show) ranked.push({ asset: asset, rank: rank });
    });
    if (terms.length) {
      // Relevance when there is a query; the manifest's newest-first order
      // breaks ties, and the DOM is reordered to match.
      ranked.sort(function (a, b) { return a.rank - b.rank || assets.indexOf(a.asset) - assets.indexOf(b.asset); });
    }
    visible = ranked.map(function (r) { return r.asset; });
    if (terms.length) {
      var fragment = document.createDocumentFragment();
      visible.forEach(function (asset) { fragment.appendChild(asset.tile); });
      el.grid.appendChild(fragment);
      reordered = true;
    } else if (reordered) {
      var ordered = document.createDocumentFragment();
      assets.forEach(function (asset) { ordered.appendChild(asset.tile); });
      el.grid.appendChild(ordered);
      reordered = false;
    }

    el.noMatch.classList.toggle('is-hidden', visible.length > 0);
    el.grid.classList.toggle('is-hidden', visible.length === 0);
    if (!visible.length) writeNoMatch();
    gridNav.repair();
    if (active && el.grid.contains(active) && active.classList.contains('is-hidden')) {
      var stop = gridNav.tabStop();
      if (stop) stop.focus();
      else el.search.focus();
    }
    if (previewOpen) closePreview(false);
    syncRows();
    scheduleCountUpdate();
  }

  function tagLabel(id) {
    return id.replace(/-/g, ' ');
  }

  // A filter's name as the reader sees it, and with its category for the
  // places a name alone could be either (a project named like a tag).
  function filterLabel(kind, value) {
    if (kind === 'type') return TYPE_LABEL[value] || value;
    if (kind === 'format') return vocab.formats[value] || value.toUpperCase();
    if (kind === 'project') return vocab.projects[value] ? vocab.projects[value].title : value;
    return tagLabel(value);
  }

  function filterName(kind, value) {
    return filterLabel(kind, value) + ' ' + kind;
  }

  // What is showing, in words: "logos or icons in BDFF 2026 tagged dark, as
  // SVG". The no-match title and the count's spoken half share it.
  function scopePhrase() {
    var f = params.filters;
    var parts = [];
    parts.push(f.type.length ? f.type.map(function (t) { return TYPE_LABEL[t].toLowerCase(); }).join(' or ') : 'files');
    if (f.project.length) parts.push('in ' + f.project.map(function (k) { return filterLabel('project', k); }).join(' or '));
    if (f.tag.length) {
      // Either-or within a group, both across groups: "social or print and light".
      var byGroup = {};
      var groupOrder = [];
      f.tag.forEach(function (t) {
        var g = vocab.tagGroup[t];
        if (!byGroup[g]) { byGroup[g] = []; groupOrder.push(g); }
        byGroup[g].push(tagLabel(t));
      });
      parts.push('tagged ' + groupOrder.map(function (g) { return byGroup[g].join(' or '); }).join(' and '));
    }
    if (f.format.length) parts.push('as ' + f.format.map(function (v) { return filterLabel('format', v); }).join(' or '));
    return parts.join(' ');
  }

  function filterCount() {
    return params.order.length;
  }

  function isNarrowed() {
    return filterCount() > 0;
  }

  // Built from what is on, so it never names a step that would not help.
  // Every filter that is on sits in the search field, so that is where to
  // send the reader.
  function recoveryLine() {
    var orClear = params.query ? ', or clear the search.' : '.';
    var filters = filterCount();
    if (filters > 1) return 'Search all files to drop the filters' + orClear;
    if (filters) return 'Remove the filter in the search field to see every file' + orClear;
    return 'Clear the search to see every file.';
  }

  function writeNoMatch() {
    var scope = scopePhrase();
    var title;
    if (params.query) title = isNarrowed() ? 'No ' + scope + ' match “' + params.query + '”' : 'No file matches “' + params.query + '”';
    else title = 'No ' + scope + ' yet';
    el.noMatchTitle.textContent = title;
    el.noMatchText.textContent = isNarrowed()
      ? recoveryLine()
      : 'Search looks at titles, projects and tags. Try one word, such as banner or logo.';
    el.noMatchAction.textContent = isNarrowed() ? 'Search all files' : 'Clear search';
  }

  function clearFilters() {
    params.filters = emptyFilters();
    params.order = [];
    renderApplied();
  }

  function handleNoMatchAction() {
    if (isNarrowed()) {
      clearFilters();
    } else {
      el.search.value = '';
      el.search.dispatchEvent(new Event('input', { bubbles: true }));
      params.query = '';
    }
    applyFilter();
    writeUrl();
    el.search.focus();
  }

  function announce(message) {
    if (!el.status) return;
    var status = el.status;
    window.clearTimeout(statusTimer);
    status.textContent = '';
    statusTimer = window.setTimeout(function writeStatus() {
      status.textContent = message;
    }, 0);
  }

  function scheduleCountUpdate() {
    window.clearTimeout(countTimer);
    countTimer = window.setTimeout(writeCount, COUNT_DEBOUNCE_MS);
  }

  function writeCount() {
    if (!el.count) return;
    var total = assets.length;
    var shown = visible.length;
    var narrowed = shown !== total;
    var visibleText = narrowed ? shown + ' of ' + total + ' files' : total + (total === 1 ? ' file' : ' files');
    var spoken = '';
    if (narrowed) {
      spoken = (isNarrowed() ? ': ' + scopePhrase() : '') + (params.query ? ' matching “' + params.query + '”' : '');
      if (!shown) spoken += '. ' + recoveryLine();
    }
    if (resetNote) {
      spoken += '. Filters reset.';
      resetNote = false;
    } else if (filterNotes.length) {
      spoken = spoken.replace(/\.$/, '') + '. ' + filterNotes.join('. ') + '.';
    }
    filterNotes = [];
    el.count.innerHTML = escapeHtml(visibleText) + (spoken ? '<span class="visually-hidden">' + escapeHtml(spoken) + '</span>' : '');
  }

  // -- Search: free text, and words that become filters --

  // A word the library recognises (a tag, a format, a type) turns into a
  // filter once it is finished (a space, or Enter), so typing "dar" never
  // jumps. The filter presses its option in its row and joins the others at
  // the end of the field. A tag is tried first, so "presentation", a use
  // and a type, means the use; then a type word beats a format, so "doc"
  // means Documents, never the DOC format. Two words can name one tag ("case study").
  // Returns the words left over as text.
  function takeFilters(words) {
    var left = [];
    left.taken = 0;
    for (var i = 0; i < words.length; i++) {
      var word = words[i].toLowerCase();
      var pair = i + 1 < words.length ? word + '-' + words[i + 1].toLowerCase() : null;
      if (pair && vocab.tagGroup[pair]) {
        addFilter('tag', pair, true);
        left.taken++;
        i++;
        continue;
      }
      var format = FORMAT_ALIASES[word] || word;
      var type = TYPE_WORDS[word];
      left.taken++;
      if (vocab.tagGroup[word]) addFilter('tag', word, true);
      else if (type && vocab.types.indexOf(type) !== -1) addFilter('type', type, true);
      else if (vocab.formats[format]) addFilter('format', format, true);
      else {
        left.taken--;
        left.push(words[i]);
      }
    }
    return left;
  }

  // finish: the last word counts as finished too (Enter, or the search event).
  function applyRecognised(finish) {
    var raw = el.search.value;
    // Mid-word edits keep their caret: only text ending at the caret is
    // rewritten, so a correction inside the query never jumps to the end.
    if (el.search.selectionStart !== null && el.search.selectionStart < raw.length) return false;
    var words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    var trailing = /\s$/.test(raw);
    var last = finish || trailing ? null : words.pop();
    var left = takeFilters(words);
    // A word is taken out of the text whenever it was recognised, even if
    // its filter was already on: it must not linger as a text query too.
    if (!left.taken) return false;
    if (last !== null) left.push(last);
    el.search.value = left.join(' ') + (left.length && trailing && !finish ? ' ' : '');
    // field.js keeps the clear button's state from the input event.
    el.search.dispatchEvent(new Event('input', { bubbles: true }));
    renderApplied();
    return true;
  }

  function applySearch(finish) {
    var changed = applyRecognised(finish);
    var next = el.search.value.trim().toLowerCase();
    if (next === params.query && !changed) return;
    params.query = next;
    applyFilter();
    writeUrl();
  }

  function handleSearchInput(event) {
    // An IME is still composing: the text is not the reader's yet.
    if (event && event.isComposing) return;
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(applySearch, FILTER_DEBOUNCE_MS);
  }

  function handleSearchEvent() {
    window.clearTimeout(filterTimer);
    applySearch(true);
  }

  function handleSearchKeydown(event) {
    if (event.key === 'Enter') {
      if (event.isComposing) return;
      window.clearTimeout(filterTimer);
      applySearch(true);
      return;
    }
    // Backspace in an empty field takes the last filter turned on back off.
    // Never on a held key's repeat, or clearing the text would strip them all.
    if (event.key === 'Backspace' && !event.repeat && !el.search.value && params.order.length) {
      event.preventDefault();
      var last = params.order[params.order.length - 1];
      removeFilter(last.kind, last.value);
      return;
    }
    if (event.key !== 'Escape' || !el.search.value) return;
    el.search.value = '';
    el.search.dispatchEvent(new Event('input', { bubbles: true }));
    window.clearTimeout(filterTimer);
    applySearch();
  }

  // -- The categories: Type, Format, Project, Tag --

  // A category's options in a fixed order, so a row never reshuffles under
  // the pointer: types as the library lists them, formats and projects by
  // name, tags by group.
  function optionsFor(kind) {
    if (kind === 'type') return vocab.types.slice();
    if (kind === 'format') {
      return Object.keys(vocab.formats).sort(function (x, y) { return vocab.formats[x].localeCompare(vocab.formats[y], 'en'); });
    }
    if (kind === 'project') {
      return Object.keys(vocab.projects).sort(function (x, y) { return vocab.projects[x].title.localeCompare(vocab.projects[y].title, 'en'); });
    }
    return vocab.groups.reduce(function (all, g) { return all.concat(g.tags); }, []);
  }

  // The category's mark on a filter tag: a format's kind, a project's
  // folder, the tag glyph. A type's own word is its mark, so it has none.
  // Decorative: the category is always in the tag's name too.
  function filterIcon(kind, value) {
    var name = null;
    if (kind === 'format') name = vocab.formatKind[value] === 'link' ? 'external-link' : KIND_ICON[vocab.formatKind[value]] || 'file';
    else if (kind === 'project') name = 'folder';
    else if (kind === 'tag') name = 'tag';
    if (!name || !iconMarkup[name]) return '';
    return '<span class="svg-icn" data-icon="' + name + '" aria-hidden="true">' + iconMarkup[name] + '</span>';
  }

  // Its name and pressed state are written by syncRows, with its count.
  function optionMarkup(kind, value) {
    return '<button type="button" class="tag" data-case="none" data-kind="' + kind + '" data-value="' + escapeHtml(value) + '" aria-pressed="false">'
      + filterIcon(kind, value) + escapeHtml(filterLabel(kind, value))
      + '<span class="tag-count" aria-hidden="true"></span></button>';
  }

  // Built once per arrival. A category with nothing to offer gets no tab and
  // keeps its panel hidden; the first that has one opens. The tabs exist
  // only from here, so tabs.js, which binds every tablist at load, binds
  // this one when it is handed it, with the tabs it really has. The name
  // comes with the role: a plain div may not carry one.
  function buildCategories() {
    var tabs = [];
    var opened = false;
    CATEGORIES.forEach(function (c) {
      var options = optionsFor(c.kind);
      var panel = el.panels[c.kind];
      el.rows[c.kind].innerHTML = options.map(function (v) { return optionMarkup(c.kind, v); }).join('');
      panel.hidden = !options.length;
      if (!options.length) return;
      var open = !opened;
      opened = true;
      // tabs.js shows and hides panels with the state class.
      panel.classList.toggle('is-hidden', !open);
      tabs.push('<button class="tool-category' + (open ? ' is-active' : '') + '" type="button" role="tab" id="al-tab-' + c.kind + '"'
        + ' aria-controls="al-panel-' + c.kind + '" aria-selected="' + open + '">' + c.label + '</button>');
    });
    el.categories.innerHTML = tabs.join('');
    el.categories.setAttribute('role', 'tablist');
    el.categories.setAttribute('aria-label', 'Filter by');
    if (window.initTabs) window.initTabs(el.categories);
    else console.warn('[asset-library] tabs.js is not on this page; the categories will not switch');
  }

  // Each option's pressed state and count, in place: nothing is rebuilt, so
  // focus never moves and the pressed change is the one thing announced.
  // The count is how many files the option would show with everything else
  // that is on, its own row (or its own tag group) left out, since an option
  // joins those rather than narrowing them. One name shape in both states.
  function syncRows() {
    CATEGORIES.forEach(function (c) {
      var buttons = el.rows[c.kind].querySelectorAll('button[data-kind]');
      Array.prototype.forEach.call(buttons, function (button) {
        var value = button.getAttribute('data-value');
        var except = c.kind === 'tag' ? { kind: 'tag', group: vocab.tagGroup[value] } : { kind: c.kind };
        var count = 0;
        assets.forEach(function (a) {
          if (a.queryHit !== false && holds(a, c.kind, value) && matchesFilters(a, except)) count++;
        });
        button.setAttribute('aria-pressed', String(isOn(c.kind, value)));
        button.setAttribute('aria-label', filterLabel(c.kind, value) + ', ' + count + (count === 1 ? ' file' : ' files'));
        button.querySelector('.tag-count').textContent = String(count);
      });
    });
  }

  // Pressing an option that is on turns it off, as aria-pressed promises.
  // No spoken note: the pressed change is announced on the button itself,
  // and the count sentence that follows says what is showing.
  function handleRowClick(event) {
    var button = event.target.closest('button[data-kind]');
    if (!button) return;
    toggleFilter(button.getAttribute('data-kind'), button.getAttribute('data-value'), false);
    renderApplied();
    applyFilter();
    writeUrl();
  }

  //
  //------- THE GRID'S KEYS -------//
  //

  // One tab stop, the arrows, Home and End, from tool-grid.js. Arrowing
  // selects as it goes, so the dock follows the arrows the way it follows
  // them in the preview; focus stays on the tile, which says the title.

  function visibleTiles() {
    return visible.map(function (asset) { return asset.tile; });
  }

  function selectedTile() {
    var asset = currentAsset();
    return asset ? asset.tile : null;
  }

  function handleGridMove(tile) {
    selectAsset(tile.getAttribute('data-asset-id'), { announce: false, settle: true });
  }

  //
  //------- FILTER TAGS -------//
  //

  // Every filter that is on, whichever way it came (a word typed, an option
  // pressed, a tag in the dock), sits at the end of the search field as a
  // removable tag, in the order it was turned on (the Tag doc's
  // active-filter pattern).

  function isOn(kind, value) {
    return params.filters[kind].indexOf(value) !== -1;
  }

  // say: queue a note for the count, so a change the reader did not see
  // happen (a word that left the field, a tag in the dock) is heard as the
  // filter it became (the count reads it with the total).
  function addFilter(kind, value, say) {
    if (isOn(kind, value)) return;
    params.filters[kind].push(value);
    params.order.push({ kind: kind, value: value });
    if (say) filterNotes.push(filterName(kind, value) + ' added as a filter');
  }

  function dropFilter(kind, value, say) {
    var at = params.filters[kind].indexOf(value);
    if (at === -1) return false;
    params.filters[kind].splice(at, 1);
    params.order = params.order.filter(function (f) { return f.kind !== kind || f.value !== value; });
    if (say) filterNotes.push(filterName(kind, value) + ' filter off');
    return true;
  }

  function toggleFilter(kind, value, say) {
    if (!dropFilter(kind, value, say)) addFilter(kind, value, say);
  }

  function appliedMarkup(kind, value) {
    return '<span class="tag" data-case="none" data-kind="' + kind + '" data-value="' + escapeHtml(value) + '">'
      + filterIcon(kind, value) + escapeHtml(filterLabel(kind, value))
      + '<button type="button" class="tag-remove" aria-label="Remove the ' + escapeHtml(filterName(kind, value)) + ' filter">'
      + '<span class="svg-icn" data-icon="close" aria-hidden="true">' + (iconMarkup.close || '') + '</span></button></span>';
  }

  function renderApplied() {
    var order = params.order;
    el.applied.innerHTML = order.map(function (f) { return appliedMarkup(f.kind, f.value); }).join('');
    el.applied.hidden = !order.length;
    // The input's description: focus lands back here after a filter comes
    // or goes, and an empty field would otherwise sound like no filters.
    // It names the one Backspace takes, which sits after the caret.
    var last = order[order.length - 1];
    el.appliedSummary.textContent = last
      ? 'Filters: ' + order.map(function (f) { return filterName(f.kind, f.value); }).join(', ') + '. Backspace removes ' + filterLabel(last.kind, last.value) + '.'
      : '';
    syncDockTags();
  }

  // A click anywhere on an applied tag takes it off (the owner's Figma);
  // the remove button is the named control a keyboard reaches. Focus stays
  // in the field the tag sat in. preventDefault tells the site template's
  // delegated .tag-remove listener the tag is handled here.
  function handleAppliedClick(event) {
    var tag = event.target.closest('.tag[data-kind]');
    if (!tag || !el.applied.contains(tag)) return;
    event.preventDefault();
    removeFilter(tag.getAttribute('data-kind'), tag.getAttribute('data-value'));
  }

  function removeFilter(kind, value) {
    if (!dropFilter(kind, value, true)) return;
    renderApplied();
    applyFilter();
    writeUrl();
    el.search.focus();
  }

  // -- The dock's tags: the same filters, pressed --

  function dockTagMarkup(id) {
    var label = escapeHtml(tagLabel(id));
    return '<button type="button" class="tag" data-case="none" data-tag="' + escapeHtml(id) + '"'
      + ' aria-pressed="' + isOn('tag', id) + '"'
      + ' aria-label="Show files tagged ' + label + '">' + label + '</button>';
  }

  function syncDockTags() {
    var buttons = el.tags.querySelectorAll('button[data-tag]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(isOn('tag', buttons[i].getAttribute('data-tag'))));
    }
  }

  // Pressing a tag that is on turns it off, as aria-pressed promises. The
  // Tag row is out of sight from here, so the change is spoken.
  function handleDockTagClick(event) {
    var button = event.target.closest('button[data-tag]');
    if (!button) return;
    var id = button.getAttribute('data-tag');
    if (!vocab.tagGroup[id]) return;
    toggleFilter('tag', id, true);
    renderApplied();
    applyFilter();
    writeUrl();
  }

  //
  //------- SELECTION AND THE DOCK -------//
  //

  function currentAsset() {
    return params.selected ? assetsById[params.selected] : null;
  }

  function currentFile() {
    var asset = currentAsset();
    if (!asset) return null;
    return asset.files[params.rendition] || asset.files[0];
  }

  function handleGridClick(event) {
    var tile = event.target.closest('.tool-file');
    if (!tile || !el.grid.contains(tile)) return;
    var asset = assetsById[tile.getAttribute('data-asset-id')];
    if (!asset) return;
    // A mouse click selects and the dock beside the grid fills; a
    // double-click opens the preview (handleGridDblClick, and the second
    // click here as a fallback). Enter or Space (a click with no detail)
    // opens it at once, since a keyboard has no double-click and the dock
    // has no Preview button. A tap opens it too, on any layout: touch
    // browsers do not promise a dblclick, and narrow the dock is off-screen
    // while the preview carries the verbs.
    // The open-full hint in the caption opens it on one click too: it
    // promises that, and it is part of the tile, not a control of its own.
    var keyboard = event.detail === 0;
    var touch = event.pointerType === 'touch' || event.pointerType === 'pen';
    var hint = !!event.target.closest('.tool-file-open');
    if (keyboard || touch || hint || event.detail >= 2 || !isWide()) {
      selectAsset(asset.id, { announce: false });
      openPreview();
      return;
    }
    selectAsset(asset.id, { announce: true });
    // The arrows carry on from the tile clicked: Safari never focuses a
    // button on click, so they would otherwise do nothing there.
    gridNav.focus(tile, { preventScroll: true });
  }

  // The second click of a double-click has usually opened the preview
  // already (detail 2, above); this catches a browser that skips it.
  function handleGridDblClick(event) {
    if (previewOpen) return;
    var tile = event.target.closest('.tool-file');
    if (!tile || !el.grid.contains(tile) || !isWide()) return;
    var asset = assetsById[tile.getAttribute('data-asset-id')];
    if (!asset) return;
    selectAsset(asset.id, { announce: false });
    openPreview();
  }

  // A no-op when the key is already selected: a double-click fires two
  // clicks first, and the arrows in the preview and a deep link can land on
  // the current file.
  function selectAsset(id, options) {
    var asset = assetsById[id];
    if (!asset) return;
    var changed = params.selected !== id;
    if (changed) {
      var previous = currentAsset();
      if (previous && previous.tile) previous.tile.removeAttribute('aria-current');
      params.selected = id;
      params.rendition = 0;
      asset.tile.setAttribute('aria-current', 'true');
      gridNav.setTabStop(asset.tile);
    }
    renderDock();
    if (changed) {
      window.clearTimeout(urlTimer);
      if (options && options.settle) settleUrl();
      else writeUrl();
      if (options && options.announce) announce(asset.title + ' selected');
    }
    if (previewOpen) renderPreview();
  }

  // Barba pushes the next page's address while this grid is still
  // attached, so a write still waiting checks the path has not moved.
  function settleUrl() {
    var path = window.location.pathname;
    urlTimer = window.setTimeout(function writeSettledUrl() {
      if (window.location.pathname === path && el.grid && el.grid.isConnected) writeUrl();
    }, URL_DEBOUNCE_MS);
  }

  function manifestKit(id) {
    return (manifestData.kits || []).filter(function (k) { return k.id === id; })[0] || null;
  }

  /** The paid-font dialog says whose font it is and where to license it, if anywhere. */
  function renderLicenceDialog(asset) {
    el.licenceDialogTitle.textContent = asset.title + ' is a paid font';
    var hasUrl = !!asset.licenceUrl;
    // The schema pairs a URL with a foundry; a foundry can stand alone.
    el.licenceDialogNext.textContent = asset.licenceFoundry
      ? 'To use it on other work, license it from ' + asset.licenceFoundry + '.'
      : 'To use it on other work, ask the brand team first.';
    el.licenceDialogLink.hidden = !hasUrl;
    if (hasUrl) el.licenceDialogLink.href = asset.licenceUrl;
    else el.licenceDialogLink.removeAttribute('href');
    el.licenceDialogFoundry.textContent = asset.licenceFoundry || '';
  }

  // aria-disabled on Download is shared with the tools' download lock
  // (download-lock.js): the lock sets it for a reader below the level and
  // marks that it did; this tool sets it for "nothing to give". Set here,
  // it is this tool's, so the mark comes off and an unlock leaves it; and
  // while locked it is never taken away, whatever is chosen.
  function setDownloadDisabled(disabled) {
    if (disabled) {
      el.download.setAttribute('aria-disabled', 'true');
      el.download.removeAttribute('data-locked-disabled');
    } else if (!el.download.classList.contains('is-locked')) {
      el.download.removeAttribute('aria-disabled');
    } else {
      // Locked: aria-disabled stays, but it is the lock's now, not this
      // tool's, so the unlock takes it away and Download works again.
      el.download.setAttribute('data-locked-disabled', '1');
    }
  }

  // A licensed file's link must not be taken round the notice: a
  // middle-click, a drag or the context menu's Save link as would fetch it
  // without Accept. The link keeps its href (it stays a focusable link for
  // the keyboard and a screen reader); these three are refused instead.
  function handleLicenceBypass(event) {
    var link = event.currentTarget;
    if (needsLicence(currentAsset()) && link.dataset.licence !== '1') event.preventDefault();
  }

  function renderDock() {
    var asset = currentAsset();
    if (!asset) {
      el.nothing.hidden = false;
      el.detail.hidden = true;
      el.description.hidden = true;
      el.licence.hidden = true;
      el.detailTitle.textContent = 'Details';
      setDownloadDisabled(true);
      el.download.removeAttribute('href');
      el.download.hidden = false;
      el.open.hidden = true;
      el.licenceLink.hidden = true;
      el.licenceAbout.hidden = true;
      el.copyLink.disabled = true;
      el.copyLink.setAttribute('data-copy', '');
      return;
    }
    var file = currentFile();
    el.nothing.hidden = true;
    el.detail.hidden = false;
    // The details pane scrolls on its own; a new file starts at its top.
    if (el.factsBody) el.factsBody.scrollTop = 0;
    el.detailTitle.textContent = asset.title;

    el.typeLine.textContent = TYPE_SINGULAR[asset.type] || 'Other';
    el.formatLine.textContent = file.label || extensionOf(file.name);
    // A link's file is its cover: its size and dimensions are not the thing's.
    el.sizeRow.hidden = !file.size || !!asset.link;
    el.size.textContent = file.size ? humanSize(file.size) : '';
    var hasDimensions = !!(file.width && file.height);
    el.dimensionsRow.hidden = !hasDimensions || !!asset.link;
    el.dimensions.textContent = hasDimensions ? file.width + ' × ' + file.height + (file.kind === 'pdf' ? ' pt' : '') : '';
    var pages = file.meta && file.meta.pages;
    el.pagesRow.hidden = !pages;
    el.pages.textContent = pages ? String(pages) : '';
    var family = file.meta && file.meta.family;
    el.familyRow.hidden = !family;
    // A family pack carries a count of styles in place of one file's style.
    el.family.textContent = family ? family + (file.meta.style ? ' ' + file.meta.style : '') + (file.meta.styles ? ', ' + file.meta.styles + (file.meta.styles === 1 ? ' style' : ' styles') : '') + (file.meta.variable ? ', variable' : '') : '';
    el.description.textContent = asset.description;
    el.description.hidden = !asset.description;
    var projects = asset.kits.map(function (id) {
      var kit = manifestKit(id);
      return kit ? kit.title + (kit.client ? ', for ' + kit.client : '') : id;
    });
    el.projectsRow.hidden = !projects.length;
    el.projectsLine.textContent = projects.join('; ');
    el.tagsRow.hidden = !asset.tags.length;
    el.tags.innerHTML = asset.tags.map(dockTagMarkup).join('');
    el.added.textContent = humanDate(asset.added);

    // An open font links straight to where it lives; a paid one explains
    // its licence in the dialog. Neither offers its file.
    var openFont = asset.licence === 'open';
    var paidFont = asset.licence === 'link-only';
    var linkOnly = openFont || paidFont;
    el.licence.hidden = !linkOnly;
    el.licence.textContent = openFont ? 'Free under an open font licence.' : paidFont ? 'A paid font, so the file is not offered here.' : '';
    el.licenceLink.hidden = !openFont;
    if (!el.licenceLink.hidden) el.licenceLink.href = asset.licenceUrl;
    else el.licenceLink.removeAttribute('href');
    el.licenceFoundry.textContent = openFont ? asset.licenceFoundry || '' : '';
    el.licenceAbout.hidden = !paidFont;
    if (paidFont) renderLicenceDialog(asset);
    // A link asset opens where it lives; its file is only the cover.
    el.open.hidden = !asset.link;
    if (asset.link) {
      el.open.href = asset.link.url;
      el.openSource.textContent = file.label;
    } else {
      el.open.removeAttribute('href');
    }
    el.download.hidden = linkOnly || !!asset.link;
    // An <a> with no href has no link role; aria-disabled carries the state
    // and the Button paints it.
    if (linkOnly || !file.url) {
      setDownloadDisabled(true);
      el.download.removeAttribute('href');
    } else {
      setDownloadDisabled(false);
      el.download.href = file.url;
      el.download.setAttribute('download', file.name);
    }
    var pageLink = window.location.origin + PAGE_PATH + '?asset=' + encodeURIComponent(asset.id);
    el.copyLink.disabled = false;
    el.copyLink.setAttribute('data-copy', pageLink);
  }

  // Grid or list. Remembered per browser, not in the URL: a link carries
  // what is shown, not how the reader likes to see it.
  var VIEW_KEY = 'asset-library-view';


  function readView() {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch (error) {
      return 'grid';
    }
  }

  function applyView(view) {
    var from = TILE_CLASSES[currentView];
    var to = TILE_CLASSES[view];
    currentView = view;
    el.grid.setAttribute('data-view', view);
    el.grid.classList.toggle('book-contents', view === 'list');
    Array.prototype.forEach.call(el.grid.children, function swapTileClasses(tile) {
      tile.classList.replace(from.tile, to.tile);
      if (view === 'grid') tile.setAttribute('data-variant', 'media');
      else tile.removeAttribute('data-variant');
      var body = tile.querySelector('.tool-file-body');
      if (body) body.classList.replace(from.body, to.body);
      var title = tile.querySelector('.tool-file-title');
      if (title) title.classList.replace(from.title, to.title);
      var meta = tile.querySelector('.tool-file-meta');
      if (meta) meta.classList.replace(from.meta, to.meta);
    });
    var input = el.view.querySelector('input[value="' + view + '"]');
    if (input) input.checked = true;
  }

  function handleViewChange(event) {
    var input = event.target;
    if (!input || input.name !== 'al-view') return;
    var view = input.value === 'list' ? 'list' : 'grid';
    applyView(view);
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch (error) { /* storage blocked: the view still changes for this page */ }
  }

  // The Download link asks the Worker first: an expired session would
  // otherwise save the login page as the file. A HEAD from fetch is told
  // apart from a navigation by the gate and answers 401, which sends the
  // reader to sign in with the way back; anything else lets the click run.
  var DOWNLOAD_FAILED = 'That download didn’t start. Try again, or copy the file link and open it in a new tab.';

  // Types whose Download opens the licence notice first. The dialog's words
  // are generic, so widening this is a one-word change (owner, 2026-10-27:
  // fonts now, the brand's other licensed files when their words are set).
  var LICENCE_TYPES = ['font'];
  var licencePending = null; // the Download that opened the notice

  // A file under an open licence (openLicence in the catalogue, such as a
  // font on the Open Font Licence) is free to share, so it skips the notice.
  function needsLicence(asset) {
    return !!asset && LICENCE_TYPES.indexOf(asset.type) !== -1 && !asset.openLicence;
  }

  // Accept re-sends the click it held, marked so the notice does not open
  // again; Cancel, Escape and the close button drop it (the dialog's close
  // event, which every way out fires).
  function handleLicenceAccept() {
    var link = licencePending;
    licencePending = null;
    // Locked while the notice was open (the session answer landed as a
    // guest): the press would be caught and the acceptance would hang on
    // the link for a later, unlocked click.
    if (!link || !link.isConnected || link.classList.contains('is-locked')) return;
    link.dataset.licence = '1';
    link.click();
  }

  function handleLicenceClose() {
    licencePending = null;
  }

  function handleDownloadClick(event) {
    var link = event.currentTarget;
    if (link.getAttribute('aria-disabled') === 'true' || !link.href) {
      event.preventDefault();
      delete link.dataset.verified;
      delete link.dataset.licence;
      return;
    }
    if (link.dataset.verified === '1') {
      delete link.dataset.verified;
      return;
    }
    if (link.dataset.licence === '1') {
      delete link.dataset.licence;
    } else if (needsLicence(currentAsset())) {
      event.preventDefault();
      licencePending = link;
      window.bdOpenSurface(el.licenceAcceptDialog);
      return;
    }
    event.preventDefault();
    if (link.dataset.pending === '1') return; // one HEAD, one download
    var href = link.href;
    var fromPreview = link === el.previewDownload;
    link.dataset.pending = '1';
    fetch(href, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      delete link.dataset.pending;
      // A navigation since, or a new selection: this answer is for a file
      // the reader is no longer asking for.
      if (!link.isConnected || link.href !== href) return;
      // Signed out since the page loaded: the engine's login page
      // (window.bdPaths, written by nav.js), then back here
      if ((response.status === 401 || response.redirected) && window.bdPaths && window.bdPaths.login) {
        window.location.assign(window.bdPaths.login + '?next=' + encodeURIComponent(window.location.pathname + window.location.search));
        return;
      }
      if (!response.ok) {
        showError(DOWNLOAD_FAILED, fromPreview);
        return;
      }
      link.dataset.verified = '1';
      link.click();
    }).catch(function () {
      delete link.dataset.pending;
      if (link.isConnected) showError(DOWNLOAD_FAILED, fromPreview);
    });
  }

  // The dock's error line is off-screen and inert while the preview is open
  // on a phone, so a failure from the preview's own Download is written to
  // the preview's line as well, and spoken through the status region.
  function showError(message, inPreview) {
    var lines = [el.error];
    if (inPreview && el.previewError) lines.push(el.previewError);
    window.clearTimeout(errorTimer);
    lines.forEach(function (line) {
      if (!line) return;
      line.textContent = message;
      line.hidden = false;
    });
    if (inPreview) announce(message);
    errorTimer = window.setTimeout(function clearError() {
      lines.forEach(function (line) {
        if (!line) return;
        line.textContent = '';
        if (line === el.previewError) line.hidden = true;
      });
    }, ERROR_MS);
  }

  //
  //------- PREVIEW -------//
  //

  function openPreview() {
    var asset = currentAsset();
    if (!asset || !el.preview || typeof el.preview.show !== 'function') return;
    var narrow = !isWide();
    el.preview.toggleAttribute('data-narrow', narrow);
    renderPreview();
    if (!previewOpen) {
      // The overlay covers the filter row and the grid on every layout;
      // narrow it fills the window, so the bar and the dock go too.
      el.region.inert = true;
      el.filters.inert = true;
      el.dock.inert = narrow;
      el.bar.inert = narrow;
      try {
        el.preview.show();
      } catch (error) {
        el.preview.setAttribute('open', '');
      }
      previewOpen = true;
    }
    lastPreviewedId = asset.id;
    el.previewClose.focus();
    var at = visible.indexOf(asset);
    announce(asset.title + ' preview' + (at === -1 ? '' : ', ' + (at + 1) + ' of ' + visible.length));
  }

  // The preview's picture swaps to the type icon when its file fails to
  // load, as the tiles do.
  function handlePreviewImageError(event) {
    var img = event.target;
    var file = currentFile();
    var kind = file ? file.kind : 'other';
    img.hidden = true;
    img.removeAttribute('src');
    el.previewFallback.querySelector('.svg-icn').innerHTML = fileIcon(kind);
    el.previewFallback.querySelector('.svg-icn').setAttribute('data-icon', KIND_ICON[kind] || 'file');
    el.previewFallback.hidden = false;
  }

  // The layout can cross 960px with the preview open — a rotated tablet, a
  // resized window. The overlay's position and the inert set were decided
  // for the other layout, so it closes rather than stand wrong.
  function observeCanvas() {
    if (!window.ResizeObserver) return;
    var wide = isWide();
    canvasObserver = new ResizeObserver(function onCanvasResize() {
      var next = isWide();
      if (next === wide) return;
      wide = next;
      if (previewOpen) closePreview(true);
    });
    canvasObserver.observe(el.canvas);
  }

  function closePreview(restoreFocus) {
    if (!previewOpen) return;
    previewOpen = false;
    el.preview.close();
    el.region.inert = false;
    el.filters.inert = false;
    el.dock.inert = false;
    el.bar.inert = false;
    if (restoreFocus === false) return;
    var asset = (lastPreviewedId && assetsById[lastPreviewedId]) || currentAsset();
    if (asset && asset.tile && visible.indexOf(asset) !== -1) {
      if (asset.tile.scrollIntoView) asset.tile.scrollIntoView({ block: 'nearest' });
      gridNav.focus(asset.tile);
    } else {
      el.search.focus();
    }
  }

  function renderPreview() {
    var asset = currentAsset();
    var file = currentFile();
    if (!asset || !file) return;
    var index = visible.indexOf(asset);
    var total = visible.length;
    el.previewTitle.textContent = asset.title;
    el.previewPosition.textContent = index === -1 ? '' : (index + 1) + ' of ' + total;
    el.previewImg.setAttribute('data-ground', file.ground || 'light');
    el.previewImg.toggleAttribute('data-alpha', !!file.alpha);
    if (file.thumb) {
      el.previewImg.src = file.thumb.kind === 'svg' ? file.thumb.src : file.thumb.src[file.thumb.src.length - 1];
      el.previewImg.alt = file.kind === 'pdf' ? 'First page of ' + asset.title : (asset.alt || asset.title);
      el.previewImg.hidden = false;
      el.previewFallback.hidden = true;
    } else {
      el.previewImg.removeAttribute('src');
      el.previewImg.hidden = true;
      el.previewFallback.querySelector('.svg-icn').innerHTML = fileIcon(file.kind);
      el.previewFallback.querySelector('.svg-icn').setAttribute('data-icon', KIND_ICON[file.kind] || 'file');
      el.previewFallback.hidden = false;
    }
    var inlineable = file.url && (file.kind === 'pdf' || file.kind === 'video');
    el.previewOpen.hidden = !inlineable && !asset.link;
    if (asset.link) {
      el.previewOpen.href = asset.link.url;
      el.previewOpenFormat.textContent = 'in ' + file.label;
    } else if (inlineable) {
      el.previewOpen.href = file.url + '?view=1';
      el.previewOpenFormat.textContent = file.kind === 'pdf' ? 'PDF' : 'video';
    }
    var narrow = el.preview.hasAttribute('data-narrow');
    var openFont = asset.licence === 'open';
    var paidFont = asset.licence === 'link-only';
    el.previewDownload.hidden = !narrow || openFont || paidFont || !file.url;
    el.previewLicenceLink.hidden = !narrow || !openFont;
    if (openFont) el.previewLicenceLink.href = asset.licenceUrl;
    else el.previewLicenceLink.removeAttribute('href');
    el.previewLicenceFoundry.textContent = openFont ? asset.licenceFoundry : '';
    el.previewLicenceAbout.hidden = !narrow || !paidFont;
    if (paidFont) renderLicenceDialog(asset);
    if (file.url) {
      el.previewDownload.href = file.url;
      el.previewDownload.setAttribute('download', file.name);
    }
    el.previewCopy.hidden = !narrow;
    el.previewCopy.setAttribute('data-copy', window.location.origin + PAGE_PATH + '?asset=' + encodeURIComponent(asset.id));
    el.previewPrev.setAttribute('aria-disabled', index <= 0 ? 'true' : 'false');
    el.previewNext.setAttribute('aria-disabled', index === -1 || index >= total - 1 ? 'true' : 'false');
  }

  function movePreview(direction) {
    var asset = currentAsset();
    var index = visible.indexOf(asset);
    var next = index + direction;
    if (index === -1 || next < 0 || next >= visible.length) return;
    var target = visible[next];
    selectAsset(target.id, { announce: false });
    lastPreviewedId = target.id;
    announce(target.title + ', ' + (next + 1) + ' of ' + visible.length);
  }

  function handlePreviewNav(event) {
    var button = event.currentTarget;
    if (button.getAttribute('aria-disabled') === 'true') return;
    movePreview(parseInt(button.getAttribute('data-direction'), 10) || 1);
  }

  function handlePreviewKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var inField = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === 'Escape') {
      event.preventDefault();
      closePreview(true);
    } else if (!inField && event.key === 'ArrowRight') {
      event.preventDefault();
      movePreview(1);
    } else if (!inField && event.key === 'ArrowLeft') {
      event.preventDefault();
      movePreview(-1);
    }
  }

  // Escape on a non-modal dialog fires cancel in some browsers and nothing
  // in others; the keydown above covers it. A click on the stage around
  // the picture does nothing: the preview is a view, not an overlay, and
  // only Back to files or Escape leaves it (owner, 2026-10-07).
  function handlePreviewCancel(event) {
    event.preventDefault();
    closePreview(true);
  }

  // Wide, the dock beside the open preview is live: a reader who tabbed
  // to Download can still press Escape there, not only inside the dialog.
  // A field keeps its own Escape (the search clears on it).
  function handleCanvasKeydown(event) {
    if (!previewOpen || event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (el.preview.contains(event.target)) return;
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    event.preventDefault();
    closePreview(true);
  }

  //
  //------- URL -------//
  //

  function listParam(url, key) {
    var value = url.searchParams.get(key);
    return value ? value.split(',').map(function (v) { return v.trim().toLowerCase(); }).filter(Boolean) : [];
  }

  // Does the library offer this option? An unknown value in the URL would
  // open on an empty grid, so it drops.
  function offers(kind, value) {
    if (kind === 'type') return vocab.types.indexOf(value) !== -1;
    if (kind === 'format') return !!vocab.formats[value];
    if (kind === 'project') return !!vocab.projects[value];
    return !!vocab.tagGroup[value];
  }

  function readUrl() {
    var url = new URL(window.location.href);
    var q = url.searchParams.get('q');
    var asset = url.searchParams.get('asset');
    params.query = q ? q.trim().toLowerCase() : '';
    params.filters = emptyFilters();
    params.order = [];
    // `for` and `kit` are the names Phase 1.2 wrote: a link copied then still
    // opens on the same files, and the next write drops them.
    var wanted = {
      type: listParam(url, 'type'),
      format: listParam(url, 'format').map(function (f) { return FORMAT_ALIASES[f] || f; }),
      project: listParam(url, 'project').concat(listParam(url, 'kit')),
      tag: listParam(url, 'tags').concat(listParam(url, 'for')),
    };
    CATEGORIES.forEach(function (c) {
      wanted[c.kind].forEach(function (v) {
        if (offers(c.kind, v)) addFilter(c.kind, v, false);
      });
    });
    return asset && assetsById[asset] ? assetsById[asset] : null;
  }

  // history.state is carried through: Barba keeps its history payload
  // there, and replacing it with null breaks Forward after the next Back.
  function writeUrl() {
    if (!window.URL || !history.replaceState) return;
    var next = new URL(window.location.href);
    var set = function (key, value) {
      if (value) next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    };
    set('q', params.query);
    set('type', params.filters.type.join(','));
    set('format', params.filters.format.join(','));
    set('project', params.filters.project.join(','));
    set('tags', params.filters.tag.join(','));
    set('for', '');
    set('kit', '');
    set('asset', params.selected);
    if (next.href === window.location.href) return;
    try {
      history.replaceState(history.state, '', next.href);
    } catch (error) {
      console.warn('[asset-library] the browser refused a history write; the URL is stale', error);
    }
  }

  //
  //------- RESET -------//
  //

  function handleReset() {
    params.query = '';
    clearFilters();
    el.search.value = '';
    el.search.dispatchEvent(new Event('input', { bubbles: true }));
    resetNote = true; // the count's next write carries it: one announcement, not two
    applyFilter();
    if (visible[0]) selectAsset(visible[0].id, { announce: false });
    writeUrl();
  }

  //
  //------- EMPTY STATE -------//
  //

  function showEmptyState(title, message) {
    if (!el.region) return;
    el.region.classList.add('is-empty');
    if (el.empty) {
      el.empty.hidden = false;
      var t = el.empty.querySelector('[data-empty-title]');
      var m = el.empty.querySelector('[data-empty-message]');
      if (t) t.textContent = title;
      if (m) m.textContent = message;
    }
  }

  //
  //------- WIRING -------//
  //

  function resolveElements(root) {
    el = {
      root: root,
      canvas: root.querySelector('.tool-canvas'),
      bar: root.querySelector('.bar'),
      filters: root.querySelector('.tool-filters'),
      search: root.querySelector('#al-search'),
      applied: root.querySelector('#al-applied'),
      appliedSummary: root.querySelector('#al-applied-summary'),
      categories: root.querySelector('#al-categories'),
      panels: {},
      rows: {},
      count: root.querySelector('#al-count'),
      region: root.querySelector('#al-region'),
      grid: root.querySelector('#al-grid'),
      noMatch: root.querySelector('#al-no-match'),
      noMatchTitle: root.querySelector('#al-no-match-title'),
      noMatchText: root.querySelector('#al-no-match-text'),
      noMatchAction: root.querySelector('#al-no-match-action'),
      empty: root.querySelector('#al-empty'),
      status: root.querySelector('#al-status'),
      dock: root.querySelector('.tool-dock[data-edge="end"]'),
      detailTitle: root.querySelector('#al-detail-title'),
      nothing: root.querySelector('#al-nothing'),
      detail: root.querySelector('#al-detail'),
      factsBody: root.querySelector('#al-detail .tool-panel-body'),
      view: root.querySelector('#al-view'),
      typeLine: root.querySelector('#al-type-line'),
      formatLine: root.querySelector('#al-format-line'),
      sizeRow: root.querySelector('#al-size-row'),
      size: root.querySelector('#al-size'),
      dimensionsRow: root.querySelector('#al-dimensions-row'),
      dimensions: root.querySelector('#al-dimensions'),
      pagesRow: root.querySelector('#al-pages-row'),
      pages: root.querySelector('#al-pages'),
      familyRow: root.querySelector('#al-family-row'),
      family: root.querySelector('#al-family'),
      description: root.querySelector('#al-description'),
      projectsRow: root.querySelector('#al-projects-row'),
      projectsLine: root.querySelector('#al-projects-line'),
      tagsRow: root.querySelector('#al-tags-row'),
      tags: root.querySelector('#al-tags'),
      added: root.querySelector('#al-added'),
      licence: root.querySelector('#al-licence'),
      licenceAbout: root.querySelector('#al-licence-about'),
      licenceDialogTitle: root.querySelector('#al-licence-dialog-title'),
      licenceDialogNext: root.querySelector('#al-licence-dialog-next'),
      licenceDialogLink: root.querySelector('#al-licence-dialog-link'),
      licenceDialogFoundry: root.querySelector('#al-licence-dialog-foundry'),
      error: root.querySelector('#al-error'),
      download: root.querySelector('#al-download'),
      licenceAcceptDialog: root.querySelector('#al-licence-accept-dialog'),
      licenceAccept: root.querySelector('#al-licence-accept'),
      open: root.querySelector('#al-open'),
      openSource: root.querySelector('#al-open-source'),
      licenceLink: root.querySelector('#al-licence-link'),
      licenceFoundry: root.querySelector('#al-licence-foundry'),
      copyLink: root.querySelector('#al-copy-link'),
      reset: root.querySelector('#al-reset'),
      preview: root.querySelector('#al-preview'),
      previewTitle: root.querySelector('#al-preview-title'),
      previewPosition: root.querySelector('#al-preview-position'),
      previewClose: root.querySelector('#al-preview-close'),
      previewStage: root.querySelector('#al-preview-stage'),
      previewImg: root.querySelector('#al-preview-img'),
      previewFallback: root.querySelector('#al-preview-fallback'),
      previewPrev: root.querySelector('#al-preview-prev'),
      previewNext: root.querySelector('#al-preview-next'),
      previewOpen: root.querySelector('#al-preview-open'),
      previewOpenFormat: root.querySelector('#al-preview-open-format'),
      previewDownload: root.querySelector('#al-preview-download'),
      previewCopy: root.querySelector('#al-preview-copy'),
      previewLicenceLink: root.querySelector('#al-preview-licence-link'),
      previewLicenceFoundry: root.querySelector('#al-preview-licence-foundry'),
      previewLicenceAbout: root.querySelector('#al-preview-licence-about'),
      previewError: root.querySelector('#al-preview-error'),
    };
    CATEGORIES.forEach(function (c) {
      el.panels[c.kind] = root.querySelector('#al-panel-' + c.kind);
      el.rows[c.kind] = root.querySelector('#al-row-' + c.kind);
    });
  }

  function wireControls() {
    el.search.addEventListener('input', handleSearchInput);
    el.search.addEventListener('search', handleSearchEvent);
    el.search.addEventListener('keydown', handleSearchKeydown);
    el.applied.addEventListener('click', handleAppliedClick);
    CATEGORIES.forEach(function (c) { el.rows[c.kind].addEventListener('click', handleRowClick); });
    el.noMatchAction.addEventListener('click', handleNoMatchAction);
    el.tags.addEventListener('click', handleDockTagClick);
    el.grid.addEventListener('click', handleGridClick);
    el.grid.addEventListener('dblclick', handleGridDblClick);
    gridNav = window.ToolGrid.create(el.grid, { tiles: visibleTiles, preferred: selectedTile, onMove: handleGridMove });
    el.grid.addEventListener('error', handleImageError, true);
    el.grid.addEventListener('load', handleImageLoad, true);
    el.previewImg.addEventListener('error', handlePreviewImageError);
    el.view.addEventListener('change', handleViewChange);
    el.download.addEventListener('click', handleDownloadClick);
    el.previewDownload.addEventListener('click', handleDownloadClick);
    ['auxclick', 'dragstart', 'contextmenu'].forEach(function (type) {
      el.download.addEventListener(type, handleLicenceBypass);
      el.previewDownload.addEventListener(type, handleLicenceBypass);
    });
    el.licenceAccept.addEventListener('click', handleLicenceAccept);
    el.licenceAcceptDialog.addEventListener('close', handleLicenceClose);
    el.previewClose.addEventListener('click', function () { closePreview(true); });
    el.previewPrev.addEventListener('click', handlePreviewNav);
    el.previewNext.addEventListener('click', handlePreviewNav);
    el.preview.addEventListener('keydown', handlePreviewKeydown);
    el.preview.addEventListener('cancel', handlePreviewCancel);
    el.canvas.addEventListener('keydown', handleCanvasKeydown);
    if (el.reset) el.reset.addEventListener('click', handleReset);
  }

  function release() {
    window.clearTimeout(filterTimer);
    window.clearTimeout(urlTimer);
    window.clearTimeout(countTimer);
    window.clearTimeout(statusTimer);
    window.clearTimeout(errorTimer);
    if (canvasObserver) canvasObserver.disconnect();
    canvasObserver = null;
    reordered = false;
    resetNote = false;
    filterNotes = [];
    currentView = 'grid';
    el = {};
    assets = [];
    assetsById = Object.create(null);
    visible = [];
    manifestData = null;
    iconMarkup = {};
    gridNav = null;
    previewOpen = false;
    lastPreviewedId = null;
    params.query = '';
    params.filters = emptyFilters();
    params.order = [];
    params.selected = null;
    vocab = emptyVocab();
    params.rendition = 0;
  }

  function resolveRoot(scope) {
    var root = scope || document;
    if (root.matches && root.matches(ROOT_SELECTOR)) return root;
    return root.querySelector(ROOT_SELECTOR);
  }

  function initAssetLibrary(scope) {
    var root = resolveRoot(scope);
    if (!root) {
      release();
      return;
    }
    if (root.dataset.assetLibraryInit) return;
    root.dataset.assetLibraryInit = 'true';

    release();
    resolveElements(root);

    var required = ['canvas', 'bar', 'filters', 'search', 'applied', 'appliedSummary', 'categories', 'count', 'region', 'grid', 'noMatch',
      'noMatchTitle', 'noMatchText', 'noMatchAction', 'empty', 'status', 'dock', 'detailTitle', 'nothing', 'detail', 'view', 'typeLine', 'formatLine', 'sizeRow', 'size',
      'dimensionsRow', 'dimensions', 'pagesRow', 'pages', 'familyRow', 'family', 'description', 'projectsRow', 'projectsLine', 'tagsRow', 'tags', 'added',
      'licence', 'licenceAbout', 'licenceDialogTitle', 'licenceDialogNext', 'licenceDialogLink', 'licenceDialogFoundry',
      'licenceAcceptDialog', 'licenceAccept', 'error',
      'download', 'open', 'openSource', 'licenceLink', 'licenceFoundry', 'copyLink', 'preview', 'previewTitle',
      'previewPosition', 'previewClose', 'previewStage', 'previewImg', 'previewFallback', 'previewPrev', 'previewNext',
      'previewOpen', 'previewOpenFormat', 'previewDownload', 'previewCopy', 'previewLicenceLink', 'previewLicenceFoundry', 'previewLicenceAbout', 'previewError'];
    var missing = required.filter(function (name) { return !el[name]; });
    CATEGORIES.forEach(function (c) {
      if (!el.panels[c.kind]) missing.push('al-panel-' + c.kind);
      if (!el.rows[c.kind]) missing.push('al-row-' + c.kind);
    });
    if (missing.length) {
      console.error('[asset-library] markup is missing: ' + missing.join(', '));
      showEmptyState('This page is incomplete', 'The Asset Library is missing part of this page, so it cannot start. Tell ' + tellWho() + ' — this needs a rebuild, not a reload.');
      return;
    }

    readIcons(root);
    manifestData = readManifest(root);
    if (!manifestData) {
      console.warn('[asset-library] no #asset-manifest on this page — run the doc generator');
      showEmptyState('The file list didn’t load', 'Reload the page. If it fails again, tell ' + tellWho() + ' and name this page.');
      return;
    }

    try {
      indexAssets(manifestData);
      if (!assets.length) {
        showEmptyState('No files here yet', (organisation() || 'The team') + ' adds approved brand files as each project signs off.');
        return;
      }
      var named = readUrl();
      // A deep link whose filters would hide the asset drops the conflicting
      // filters and shows it.
      // Options in one row (or one tag group) are either-or, so a row goes
      // only when the asset holds none of its options.
      if (named) {
        var rows = {};
        params.order.forEach(function (f) {
          var key = f.kind === 'tag' ? 'tag:' + vocab.tagGroup[f.value] : f.kind;
          (rows[key] = rows[key] || []).push(f);
        });
        Object.keys(rows).forEach(function (key) {
          var row = rows[key];
          if (row.some(function (f) { return holds(named, f.kind, f.value); })) return;
          row.forEach(function (f) { dropFilter(f.kind, f.value, false); });
        });
      }
      buildCategories();
      renderApplied();
      el.search.value = params.query;
      // field.js paints the clear button from the input event.
      if (params.query) el.search.dispatchEvent(new Event('input', { bubbles: true }));
      renderGrid();
      applyView(readView());
      wireControls();
      observeCanvas();
      applyFilter();
      window.clearTimeout(countTimer);
      writeCount();
      if (named && visible.indexOf(named) === -1) {
        params.query = '';
        el.search.value = '';
        // field.js hides the clear button from the input event.
        el.search.dispatchEvent(new Event('input', { bubbles: true }));
        applyFilter();
        window.clearTimeout(countTimer);
        writeCount();
      }
      if (named) {
        selectAsset(named.id, { announce: false });
        if (named.tile.scrollIntoView) named.tile.scrollIntoView({ block: 'nearest' });
      } else {
        renderDock();
        gridNav.repair();
      }
      writeUrl();
    } catch (error) {
      console.error('[asset-library] init failed', error);
      release();
      resolveElements(root);
      showEmptyState('Something went wrong', 'The Asset Library hit an error while starting. Reload the page, and tell ' + tellWho() + ' if it keeps happening.');
      return;
    }

    console.log('[asset-library] init');
  }

  window.initAssetLibrary = initAssetLibrary;

  //
  //------- Initialize -------//
  //

  function handleDomReady() {
    initAssetLibrary();
  }

  // Deferred a frame: Barba awaits its afterEnter hooks, and building the
  // tiles inline would hold the transition's critical section open. The
  // isConnected guard drops the work when a second navigation overtakes.
  function handleAfterNav(event) {
    var container = event.detail && event.detail.container;
    window.requestAnimationFrame(function initAfterPaint() {
      if (container && !container.isConnected) return;
      initAssetLibrary(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    initAssetLibrary();
  }

  document.addEventListener('bd:after-nav', handleAfterNav);
})();
