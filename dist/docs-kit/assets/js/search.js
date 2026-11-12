/**
 * search.js — Site search. v1.5.1
 *
 * Two indexes behind one field, because a design system is searched by *name*
 * more often than by sentence. Typing `--text-primary`, `.gap-m` or
 * `arrow-right` should answer instantly; asking "how do page transitions work"
 * is a different question with a different engine behind it.
 *
 *   symbols.json  tokens, classes, icons, glossary terms and page titles.
 *                 ~17 KB gzipped, matched here by prefix. On screen from the
 *                 first keystroke, before the prose engine has finished loading.
 *   pagefind      full text, with <mark>ed excerpts. Loaded lazily and searched
 *                 in a worker. A row opens at the page's best-matching section
 *                 and quotes that section, so the highlighted text is at the
 *                 destination — see bestSubResult.
 *
 * The markup is emitted by the generator into nav.js — a <dialog> beside the
 * header, outside the Barba container — so icons come from the icon registry,
 * the markup ships even if this file does not, and a page transition can never
 * tear the dialog down. This file is behaviour only and builds no chrome.
 *
 * Escape, the focus trap, focus return and the scroll lock are dialog.js's,
 * from the attributes in that markup. Binding Escape here as well would fire
 * twice and close the dialog from under a filter clear.
 *
 * TWO LIFETIMES, KEPT APART. The indexes are fetched once per document and
 * shared (`index` below): one JSON fetch, one WebAssembly init, however many
 * search surfaces are on the page. Everything describing what is on screen —
 * the query, the type, the result list, the active row, the timers — belongs to
 * one surface and lives inside `createSearch(host)`. The dialog is one such
 * surface; /search.html is another, and the two can coexist in one document
 * because neither can reach the other's state.
 */

(function () {
  'use strict';

  var VERSION = '1.5.1';

  // Long enough that a fast typist issues one search per word, short enough
  // that a pause feels answered. glossary.js uses 100 for a substring scan over
  // live DOM; this does more work per keystroke.
  var QUERY_DEBOUNCE_MS = 150;
  // The count is announced on a slower clock than it is rendered: at typing
  // speed a polite region queues every intermediate value and reads them all
  // out, several words behind. Same reasoning as glossary.js's 500.
  var ANNOUNCE_DEBOUNCE_MS = 500;
  var GROUP_LIMIT = 5;
  var RECENTS_KEY = 'bd-search-recents';
  var RECENTS_MAX = 5;
  // One character matches most of the corpus. Prefix-matching a name is the
  // exception — `--` or `.` is already an unambiguous intent.
  var MIN_QUERY = 2;
  // How many prose hits to fetch data for. Each is a separate fragment request,
  // and nobody reads past the first handful; the count above the list is taken
  // from the full result set, not from this.
  var PROSE_FETCH = 20;
  // The results page has to answer for the number the dialog sent the reader
  // here with. At the dialog's 20 it would show "Pages 20 of 48" — stating the
  // shortfall it exists to close, with nothing past it.
  var PROSE_FETCH_PAGE = 100;

  // One entry per result type, in display order. It is also the filter row:
  // `slug` is what `?type=` carries on /search.html; `noun` and `one` are how
  // the status line and the empty state name the type ("8 classes for gap",
  // "No glossary terms match").
  // Pages first, by the owner's call (2026-09-30): a page is the answer most
  // readers came for, and a name is the specialist's.
  var GROUPS = [
    { key: 'page', label: 'Pages', slug: 'pages', noun: 'pages', one: 'page' },
    // Formats second (2026-11-09, Format Library list row 17): someone
    // searching "reel cover" wants the format itself, opened in the tool.
    { key: 'format', label: 'Formats', slug: 'formats', noun: 'formats', one: 'format' },
    { key: 'icon', label: 'Icons', slug: 'icons', noun: 'icons', one: 'icon' },
    { key: 'token', label: 'Tokens', slug: 'tokens', noun: 'tokens', one: 'token' },
    { key: 'class', label: 'Classes', slug: 'classes', noun: 'classes', one: 'class' },
    { key: 'term', label: 'Glossary', slug: 'glossary', noun: 'glossary terms', one: 'glossary term' }
  ];

  function groupFor(key) {
    for (var g = 0; g < GROUPS.length; g++) if (GROUPS[g].key === key) return GROUPS[g];
    return null;
  }

  // `?type=` arrives from outside — a hand-edited link, a stale bookmark.
  // Without this the value is taken at its word and minted into a pressed
  // button named after a type that does not exist, above results that ignore
  // it. Unknown gives '', which is All.
  function typeFromSlug(slug) {
    for (var g = 0; g < GROUPS.length; g++) if (GROUPS[g].slug === slug) return GROUPS[g].key;
    return '';
  }

  // Where to send someone who has opened search with nothing in mind: the
  // Website for the team, the Brand Book for partners and prospects, the
  // glossary for the vocabulary they share. Resolved against the symbol index
  // so a renamed or removed page drops out rather than shipping a dead link.
  // `n` overrides the index title where that title carries its own numbering
  // or framing ("Brand Book - Overview", "About Components") and would read
  // oddly in a list of plain names. Directory indexes are keyed by their
  // directory — `/brand/`, never `/brand/index.html`.
  var START_HERE = [
    { u: '/foundations/color.html' },
    { u: '/foundations/spacing.html' },
    { u: '/foundations/typography.html' },
    { u: '/web/components.html', n: 'Components' },
    { u: '/brand/', n: 'Brand Book' },
    { u: '/glossary.html' }
  ];

  // Document-wide, not per-surface: fetched once and read by every surface.
  // `pagefindLoading` holds the in-flight import so two surfaces typing at the
  // same time share one WebAssembly init rather than racing two.
  var index = {
    symbols: null,
    symbolsFailed: false,
    pagefind: null,
    pagefindFailed: false,
    pagefindLoading: null
  };

  /* ------ Utilities ------ */

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // A name is matched with its sigil optional: someone who types `text-primary`
  // means `--text-primary`, and someone who types `gap-m` means `.gap-m`.
  function bare(name) {
    return name.replace(/^--/, '').replace(/^\./, '').toLowerCase();
  }

  /* ------ Index loading ------ */

  // The URLs belong with the indexes, not with a surface: the fetch and the
  // WebAssembly init happen once per document, so asking each host for its own
  // copy invited two answers to a one-answer question. Worse, the failed flags
  // below are per-engine — a host pointing at the wrong URL would mark the
  // engine dead for every other surface on the page, including a correct one,
  // with no retry and nothing in the console.
  //
  // So they are read once from whichever element carries both, which in
  // practice is the generated dialog. That also keeps them correct under
  // `basePath`: the generator runs every href through siteHref, and an
  // authored HTML body — /search.html's, for one — cannot.
  var indexUrls;

  function urls() {
    if (indexUrls === undefined) {
      var src = document.querySelector('[data-symbols][data-pagefind]');
      indexUrls = src ? {
        symbols: src.getAttribute('data-symbols'),
        pagefind: src.getAttribute('data-pagefind')
      } : null;
    }
    return indexUrls;
  }

  // Where the site is rooted. The generator runs the dialog's data-symbols
  // through siteHref, so stripping the known tail leaves exactly basePath — ''
  // at the site root, '/sub/path' under one. Pagefind does the same to its own
  // bundle URL, and for the same reason: an authored HTML body cannot call
  // siteHref, so the generated dialog is the only element on the page that
  // knows this.
  // match, not replace: a replace that finds nothing hands back the whole URL,
  // and `if (base)` then treats that as a base. Rename or version-stamp the
  // index in the generator without touching this line and every row becomes
  // `/search-index/symbols-v2.json/foundations/color.html` — at the site root,
  // where this is otherwise a no-op, with no console error and no failed fetch.
  // Failing to '' fails closed, to exactly the behaviour before basePath was
  // handled at all.
  function indexBase() {
    var u = urls();
    if (!u) return '';
    var m = u.symbols.match(/^(.*)\/search-index\/symbols\.json$/);
    return m ? m[1] : '';
  }

  /* ------ Icons ------ */

  // Brand icons for what this module draws, always the registry's own files:
  //   - a control's icon (the recent-search ×) comes from the <template> the
  //     generator emits inside the dialog, so it ships with the markup;
  //   - an Icons result previews the icon it names, fetched from the public
  //     svg-icons folder when the row is drawn — five at most per render,
  //     cached for the document — rather than carrying every SVG in the gated
  //     index. The row used to ship an empty .svg-icn: a blank box.
  var iconFetches = {};

  // A missing template leaves the control named (aria-label) but blank to the
  // eye, so it says so rather than shipping an invisible button.
  function templateIcon(name) {
    var tpl = document.getElementById('site-search-icons');
    var el = tpl && tpl.content.querySelector('[data-icon="' + name + '"]');
    if (el) return el.innerHTML;
    console.warn('search.js: icon "' + name + '" missing from #site-search-icons');
    return '&times;';
  }

  function fetchIcon(name) {
    if (!iconFetches[name]) {
      iconFetches[name] = fetch(indexBase() + '/assets/images/svg-icons/' + encodeURIComponent(name) + '.svg')
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(parseIcon)
        .catch(function () { return null; })
        .then(function (svg) {
          // A failure is not remembered: a lapsed session or a dropped
          // connection would otherwise blank this icon until a reload.
          if (!svg) delete iconFetches[name];
          return svg;
        });
    }
    return iconFetches[name];
  }

  // Parsed rather than assigned as a string: the file's own width and height
  // would override the .svg-icn wrapper, and a response that is not an SVG —
  // an error page, a sign-in redirect — must not be inserted at all.
  //
  // As HTML, not as image/svg+xml. The registry's files carry no xmlns (house
  // rule), and the XML parser puts an <svg> without one in the null namespace:
  // it inserts, passes a nodeName check, and paints nothing. The HTML parser
  // puts <svg> in the SVG namespace by itself, which is how inline icons
  // everywhere else on the site get there.
  function parseIcon(text) {
    if (!text) return null;
    var svg = new DOMParser().parseFromString(text, 'text/html').body.firstElementChild;
    if (!svg || svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') return null;
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return svg;
  }

  function fillIcons(container) {
    var slots = container.querySelectorAll('.search-result-icon[data-icon]:empty');
    for (var i = 0; i < slots.length; i++) fillIcon(slots[i]);
  }

  function fillIcon(slot) {
    fetchIcon(slot.getAttribute('data-icon')).then(function (svg) {
      // The list may have been repainted while the file was on its way.
      if (svg && slot.isConnected && !slot.firstChild) slot.appendChild(document.importNode(svg, true));
    });
  }

  function loadSymbols() {
    if (index.symbols || index.symbolsFailed) return Promise.resolve();
    var u = urls();
    if (!u) { index.symbolsFailed = true; return Promise.resolve(); }
    return fetch(u.symbols)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        // Valid JSON of the wrong shape is the dangerous case, because it does
        // not throw on its own. An object gives `.length === undefined`, every
        // loop is a no-op and nothing ever fails — search just answers
        // "Nothing matches" to every query, for ever, with no unavailable
        // state. A string gives a character count and throws deep inside
        // matchSymbols instead. Fail here, where the failure is visible.
        if (!Array.isArray(data)) throw new Error('symbols.json is not an array');
        // symbols.json is built by walking files under _site, so its URLs are
        // site-root-relative with no basePath on them — while Pagefind's come
        // back already carrying it, because its client derives its root from
        // the siteHref'd URL it was imported from. Under a basePath deploy the
        // two halves of search would
        // then disagree: every symbol row 404s, and the dedupe compares
        // `/sub/x.html` against `/x.html`, never matches, and lists every page
        // hit by name AND by prose twice.
        //
        // Rebase once, here, so everything downstream — the row href, the
        // dedupe, startHere — speaks one coordinate system. A no-op at the site
        // root, which is the only reason this was invisible.
        // Root-relative only, and never protocol-relative — mirroring siteHref,
        // which excludes `//` for the same reason: `/sub` + `//cdn/x` is not a
        // path on this site.
        //
        // Do NOT add an "already rebased?" test here. It reads as the obvious
        // hardening and it is wrong: under `basePath: '/website'` every URL in
        // the index already starts with the base, so the guard would skip them
        // all and break the exact deploy this exists for. What makes the rebase
        // safe is that `index.symbols` is assigned in this same `.then` and
        // never reset, so the array is rebased once and only once.
        var base = indexBase();
        if (base) {
          for (var i = 0; i < data.length; i++) {
            var u = data[i].u;
            if (u && u.charAt(0) === '/' && u.charAt(1) !== '/') data[i].u = base + u;
          }
        }
        index.symbols = data;
      })
      .catch(function () { index.symbolsFailed = true; });
  }

  // A dynamic import of an ES module from a classic script, which is allowed.
  // It pulls WebAssembly and a worker, so it is deliberately not fetched until
  // someone actually types.
  function loadPagefind() {
    if (index.pagefind || index.pagefindFailed) return Promise.resolve();
    if (index.pagefindLoading) return index.pagefindLoading;
    var u = urls();
    if (!u) { index.pagefindFailed = true; return Promise.resolve(); }
    // No options: the bundle sits at <base>/pagefind/, Pagefind's own layout,
    // so its client derives basePath and baseUrl from import.meta.url — and a
    // site basePath rides along, because the generator siteHref'd the import
    // URL. Move the bundle and every prose result 404s; see build-search.js.
    index.pagefindLoading = import(u.pagefind)
      .then(function (mod) {
        return Promise.resolve(mod.init())
          .then(function () { index.pagefind = mod; });
      })
      .catch(function () { index.pagefindFailed = true; });
    return index.pagefindLoading;
  }

  // Which part of a page a prose hit should open at.
  //
  // Pagefind returns one sub-result per matching section in PAGE order, not
  // score order, and the first is a pseudo-section covering everything above
  // the first heading — it carries the page's own URL and no anchor. So "the
  // first one" is never the answer, and "the first anchored one" is worse than
  // it looks. The highest-scoring one is: when the page-level section wins, its
  // URL *is* the page URL, which is the right destination for a query that
  // matched the page rather than a part of it.
  //
  // Measured against the live index, 2026-09-14: "motion" picks the bare
  // /foundations/motion.html; "reduced motion" picks #reduced-motion on the same
  // page; "barba" picks the exact section on each of its three hits. Taking the
  // first anchored sub-result would have sent "reduced motion" to
  // #easing-primitives, which is the section it matched least.
  //
  // 115 of the 124 indexed pages carry anchors; the nine that do not are
  // section indexes and two hand-authored pages, and they fall back to the page
  // URL through the same path as a preamble win.
  //
  // ONE TRAP, invisible from here. Pagefind builds a sub-result's URL from
  // `fragment.meta.url || fragment.url` — the raw meta value, not the resolved
  // one. The generator emits `data-pagefind-meta` (currently only `section`),
  // so adding a `url` key to it would detach every sub-result URL from `d.url`:
  // wrong destination, and a dedupe that silently stops firing because it
  // compares against `d.url`. Nothing would fail; rows would just double.
  function bestSubResult(d) {
    var subs = d && d.sub_results;
    if (!subs || !subs.length) return null;
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < subs.length; i++) {
      var locations = subs[i].weighted_locations || [];
      var score = 0;
      for (var j = 0; j < locations.length; j++) score += locations[j].balanced_score || 0;
      // `best === null` rather than a sentinel score, so the "nothing chosen
      // yet" test never doubles as a score floor. Strict `>` keeps the earlier
      // section on a tie, and page order puts the preamble first — so an
      // all-zero page falls back to the top rather than to a heading picked at
      // random.
      if (best === null || score > bestScore) { bestScore = score; best = subs[i]; }
    }
    return best;
  }

  // The results page, with the current question in the URL so the link is
  // worth sharing and the page can answer it on arrival. `base` is the
  // generator's own siteHref'd path, off the dialog.
  //
  // `keep` is the search string and hash already on the address bar when this
  // is rewriting the current URL rather than building a link. Only `q` and
  // `type` belong to this feature; rebuilding the query from scratch threw
  // away everything else the reader arrived with — a utm parameter, anything a
  // future feature adds — and dropped the fragment, on arrival, before a key
  // was pressed. `section` was this feature's until 1.4.0 and is dropped
  // rather than kept: a bookmark carrying it would otherwise pass it on for ever.
  //
  // `type` is the GROUPS key; the URL carries the slug.
  function searchPageUrl(base, query, type, keep) {
    var params;
    try {
      params = new URLSearchParams(keep && keep.search ? keep.search : '');
    } catch (err) {
      params = new URLSearchParams('');
    }
    if (query) params.set('q', query); else params.delete('q');
    var group = type && groupFor(type);
    if (group) params.set('type', group.slug); else params.delete('type');
    params.delete('section');
    var qs = params.toString();
    return base + (qs ? '?' + qs : '') + ((keep && keep.hash) || '');
  }

  /* ------ Matching ------ */

  function matchSymbols(query) {
    if (!index.symbols) return [];
    var q = bare(query);
    // indexOf('') is 0, so an empty query would "match" the whole index.
    if (!q) return [];
    var out = [];
    for (var i = 0; i < index.symbols.length; i++) {
      var s = index.symbols[i];
      var name = bare(s.n);
      var at = name.indexOf(q);
      if (at === -1) continue;
      // A prefix match is what the typist is steering towards; an interior
      // match is a coincidence of spelling. Rank accordingly, then by brevity,
      // so `--text-primary` beats `--text-primary-inverse` for "text-primary".
      out.push({ item: s, rank: (at === 0 ? 0 : 1000) + name.length });
    }
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out.map(function (r) { return r.item; });
  }

  function startHere() {
    if (!index.symbols) return [];
    // The START_HERE urls above are lookup KEYS, written against the index as
    // the build emits it — site-root-relative, never base-prefixed. loadSymbols
    // has since rebased the index, so the key has to be rebased to match. They
    // are not hrefs and must never be treated as any: the row's href comes from
    // the index entry the lookup finds.
    var base = indexBase();
    var byUrl = {};
    for (var i = 0; i < index.symbols.length; i++) {
      if (index.symbols[i].t === 'page') byUrl[index.symbols[i].u] = index.symbols[i];
    }
    return START_HERE.map(function (entry) {
      var page = byUrl[base + entry.u];
      if (!page) return null;
      return entry.n ? { u: page.u, n: entry.n } : page;
    }).filter(Boolean);
  }

  /* ------ Recents ------ */

  // One list per reader, not per surface: a query typed in the dialog is still
  // a recent query on the results page.

  function readRecents() {
    try {
      var raw = localStorage.getItem(RECENTS_KEY);
      return raw ? JSON.parse(raw).slice(0, RECENTS_MAX) : [];
    } catch (err) {
      // Private windows and blocked site data throw on access, not on read.
      return [];
    }
  }

  function writeRecents(list) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))); } catch (err) { /* not worth a message */ }
  }

  function rememberQuery(q) {
    q = q.trim();
    if (q.length < MIN_QUERY) return;
    var list = readRecents().filter(function (item) { return item !== q; });
    list.unshift(q);
    writeRecents(list);
  }

  /* ------ Row markup ------ */

  // Engine defaults live in design-system.css; the brand's theme.css overrides
  // them. Reading the computed value is the only way to show what this instance
  // actually renders — shipping the declared value would show a client their
  // engine defaults and call them their brand.
  function liveValue(name) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || '';
    } catch (err) {
      return '';
    }
  }

  var COLOUR_RE = /^(#|rgb|hsl|color-mix|oklch)/i;

  function rowHtml(item, id) {
    // The meta line is built first because the accessible name needs it. It is
    // still rendered in its own span below — this only decides the string.
    var meta = '';
    if (item.t === 'token') meta = liveValue(item.n) || item.d || '';
    else if (item.t === 'page') meta = item.s || '';
    else meta = item.d || '';
    // A prose row that opens partway down a page says where. Three rows named
    // Motion, Dialog and Button, each reading "Website", give a reader nothing
    // to choose between; the heading is the answer and it costs a string.
    //
    // Section first: it is where the page lives, and the only thing that tells
    // two pages of the same name apart now that nothing above the list filters
    // by section. A middle dot, not the breadcrumb slash: these are two
    // coordinate facts, and a slash would claim the heading sits under the
    // section rather than inside the page.
    if (item.sub) meta = meta ? meta + ' · ' + item.sub : item.sub;

    // The option's accessible name is what it is and where it lives, and stops.
    // Without aria-label the name is computed from the row's contents, and that
    // includes the excerpt: -webkit-line-clamp hides two thirds of a long one
    // from the eye but not from the accessibility tree, so arrowing down the
    // list read 80-plus characters before saying what the next row was.
    //
    // The excerpt is not discarded — it becomes the description, announced
    // after the name and skippable. What survives is the sentence, which is the
    // row's evidence about the destination; what does NOT survive is the
    // highlight. <mark> has no text alternative, so accname flattens it into
    // the surrounding text, and the element itself is pruned from the tree by
    // the option's presentational children. The marking is visual only, in
    // every engine. That is an acceptable loss — the reader typed the query a
    // moment ago, so which word matched is the low-information half.
    //
    // INVARIANT: aria-label must be present whenever aria-describedby is. Both
    // come off the same `item` in one expression below, so it holds today. Make
    // the label conditional and the excerpt is pulled back into the name by
    // name-from-content *as well as* the description — the exact bug this
    // removed, silently reintroduced.
    var label = meta ? item.n + ', ' + meta : item.n;
    var excerptId = id + '-excerpt';

    var parts = ['<a class="search-result" role="option" id="' + id + '" aria-selected="false"' +
      ' aria-label="' + escapeHtml(label) + '"' +
      (item.excerpt ? ' aria-describedby="' + excerptId + '"' : '') +
      ' data-type="' + item.t + '" href="' + escapeHtml(item.u) + '" tabindex="-1">'];

    if (item.t === 'icon') {
      parts.push('<span class="search-result-icon svg-icn" data-icon="' + escapeHtml(item.n) + '"></span>');
    } else if (item.t === 'token') {
      var value = liveValue(item.n);
      if (COLOUR_RE.test(value)) {
        parts.push('<span class="search-result-swatch" style="background:' + escapeHtml(value) + '"></span>');
      }
    }

    parts.push('<span class="search-result-text">');
    parts.push('<span class="search-result-name">' + escapeHtml(item.n) + '</span>');

    if (meta) parts.push('<span class="search-result-meta">' + escapeHtml(meta) + '</span>');

    // Pagefind guarantees escaped text with <mark> around the match; it is the
    // one string here that is inserted as HTML, and it never contains user input.
    if (item.excerpt) parts.push('<span class="search-result-excerpt" id="' + excerptId + '">' + item.excerpt + '</span>');
    parts.push('</span>');

    parts.push('</a>');
    return parts.join('');
  }

  // `idPrefix` is the surface's own: two surfaces in one document must not both
  // emit `#sr-0`, or aria-activedescendant on one points into the other and
  // every querySelector('#sr-0') answers with whichever came first in the DOM.
  function groupHtml(label, items, startIndex, total, idPrefix) {
    // aria-hidden on the label: the group below carries the same words as its
    // aria-label, so leaving this in the tree spoke the group name twice on
    // entry. It stays on screen, where it is the only copy.
    var head = '<p class="search-group-label" role="presentation" aria-hidden="true">' + escapeHtml(label) +
      (total > items.length ? ' <span class="search-group-count">' + items.length + ' of ' + total + '</span>' : '') +
      '</p>';
    var rows = items.map(function (item, i) { return rowHtml(item, idPrefix + (startIndex + i)); });
    // The cap goes into the group's name only while it applies — "Tokens, 5 of
    // 12" — because the heading that shows it is aria-hidden. Under a pressed
    // type nothing is cut and the name is plain: no "of" is the statement
    // that everything is here.
    var name = total > items.length ? label + ', ' + items.length + ' of ' + total : label;
    return '<div class="search-group" role="group" aria-label="' + escapeHtml(name) + '">' + head + rows.join('') + '</div>';
  }

  function calloutHtml(type, title, body) {
    return '<div class="callout search-empty" data-type="' + type + '">' +
      '<p class="callout-title">' + escapeHtml(title) + '</p>' +
      '<p class="callout-description">' + body + '</p>' +
      '</div>';
  }

  /* ------ A search surface ------ */

  /**
   * One field, one result list, one type filter, one live region.
   *
   * `host` contains the parts: the field, the type filter, the live region, and a
   * results area split in two — a listbox that may hold only option rows, and
   * a panel beside it for every state that is not a row. It does NOT carry the
   * index URLs — those are the document's, resolved by urls() above.
   *
   * options:
   *   idPrefix   namespaces the row ids, so two
   *              surfaces in one document cannot collide. **It is concatenated
   *              into `querySelector('#' + id)` and into an attribute
   *              selector, so it must be a legal CSS identifier start: a
   *              letter, then letters, digits, `-` or `_`.** A prefix opening
   *              with a digit, a slash or a space makes every setActive throw.
   *   onSelect   runs when a row is chosen — the dialog closes itself, a page
   *              host does nothing.
   *   onQuery    optional, called with (query, type) each time a query is
   *              issued. The dialog rewrites its "see all" links from it; the
   *              page writes the URL.
   *   seeAllBase optional path to the results page. Given one, a surface that
   *              is showing fewer rows than it found ends the list with a row
   *              leading to the rest.
   *   groupLimit rows per group under All, default GROUP_LIMIT. The dialog
   *              caps because it is a peek; the results page does not, because
   *              it is the place the cap sends you. The heading names the real
   *              total either way. A pressed type lifts the cap on every host —
   *              the filter is how a reader sees more without leaving.
   *   proseFetch how many prose hits to fetch data for, default PROSE_FETCH.
   *   enterOpensFirst  Enter in the field opens row 0 when no row has been
   *              arrowed to. The dialog passes true — it is a palette, and a
   *              palette answers Enter. A page host does not: Enter there
   *              submits nothing and the results are already on screen. No
   *              host pre-selects a row; see the Accessibility notes.
   *
   * Returns null when the host is not fully built — a caller that gets null
   * must not mark the host as initialised.
   */
  function createSearch(host, options) {
    var els = {
      input: host.querySelector('.search-input'),
      // The scroll container and the click delegate. It owns both halves below,
      // so one listener still catches every row, callout and recent-query
      // control wherever the current state put it.
      results: host.querySelector('.search-results'),
      // role="listbox" may own only options and groups, so the two halves are
      // separate elements: rows go in the listbox, everything else beside it.
      list: host.querySelector('.search-listbox'),
      panel: host.querySelector('.search-panel'),
      status: host.querySelector('.search-status'),
      filters: host.querySelector('.search-filters')
    };
    if (!els.input || !els.results || !els.list || !els.panel || !els.status || !els.filters) return null;

    var idPrefix = options.idPrefix;
    var onSelect = options.onSelect;
    var onQuery = options.onQuery;
    var seeAllBase = options.seeAllBase;
    var groupLimit = options.groupLimit || GROUP_LIMIT;
    var proseFetch = options.proseFetch || PROSE_FETCH;
    var enterOpensFirst = options.enterOpensFirst === true;

    var state = {
      query: '',
      // A GROUPS key, or '' for All.
      type: '',
      results: [],
      prose: [],
      proseTotal: 0,
      // The query the prose above answers, and whether a newer one is still out.
      proseQuery: '',
      proseInFlight: false,
      activeId: '',
      requestId: 0,
      queryTimer: null,
      announceTimer: null
    };

    function debounce(fn, ms, key) {
      if (state[key]) clearTimeout(state[key]);
      state[key] = setTimeout(fn, ms);
    }

    /* -- Prose -- */

    function searchProse(query, requestId) {
      if (!index.pagefind) return Promise.resolve([]);
      // No Pagefind filter: the type filter is applied after grouping, on the
      // whole result set, so the row above the list is built from what the
      // query found and not from what the pressed button let through.
      return index.pagefind.search(query)
        .then(function (search) {
          // A newer keystroke has already been issued; this answer is for a
          // question nobody is asking any more.
          if (requestId !== state.requestId) return null;
          // Only the first page of results is worth fetching data for, but the
          // count reported to the reader has to be the real one — announcing the
          // size of a slice as if it were the total is a silent cap.
          state.proseTotal = search.results.length;
          // One dropped fragment costs one row, not the whole group. Pagefind
          // keeps a failed fragment as a rejected promise for the life of the
          // document, so without this a single miss — a session that lapsed
          // mid-visit answers every index fetch with a 401 — would empty the
          // Pages group for every later query and say "Nothing matches" about
          // words that are on the page.
          return Promise.all(search.results.slice(0, proseFetch).map(function (r) {
            return r.data().catch(function () { return null; });
          })).then(function (rows) { return rows.filter(Boolean); });
        })
        // A rejected search is not a dead engine either. `pagefindFailed` is
        // document-wide and never retried, so latching it here would let one
        // flaky query in the dialog put every surface on the page into the
        // unavailable state for the rest of the visit. Whether the engine
        // loaded at all is loadPagefind's question, and only its.
        .catch(function () { return []; });
    }

    /* -- Rendering -- */

    // Every state writes both halves, always. Painting only the half a state
    // cares about is how the previous state's other half survives underneath it
    // — an idle Start-here list sitting below a set of results, or a stale "no
    // results" callout under the rows that just arrived.
    //
    // Pass '' for an empty half, never whitespace: the gap between the two is
    // `.search-listbox:not(:empty) + .search-panel`, and a single space is a
    // text node that defeats :empty.
    function paint(listHtml, panelHtml) {
      els.list.innerHTML = listHtml;
      els.panel.innerHTML = panelHtml;
      fillIcons(els.list);
    }

    function render() {
      var q = state.query.trim();

      if (index.symbolsFailed && index.pagefindFailed) return renderUnavailable();
      // MIN_QUERY alone decides. There used to be a carve-out here letting a
      // leading `--` or `.` through below it, on the reasoning that a sigil is
      // already an unambiguous intent — but `--` is two characters and clears
      // MIN_QUERY on length anyway, so the only input it ever admitted was a
      // bare `.`, which bare() strips to '' and matchSymbols answers with [].
      // It bought nothing and paid for a Pagefind WASM load to search a full
      // stop.
      if (!q || q.length < MIN_QUERY) return renderIdle();

      var groups = groupResults();
      var flat = [];
      var html = [];
      var panel = [];
      var idx = 0;
      var total = 0;
      // A pressed type shows all of it: the cap is for the peek at everything.
      var limit = state.type ? Infinity : groupLimit;

      for (var g = 0; g < GROUPS.length; g++) {
        var key = GROUPS[g].key;
        if (state.type && key !== state.type) continue;
        var items = groups[key];
        if (!items || !items.length) continue;
        // Pages are capped twice: PROSE_FETCH when fetched, and `limit` when
        // shown. The heading has to name the real total, not either cap.
        var groupTotal = groupCount(groups, key);
        total += groupTotal;
        var shown = items.slice(0, limit);
        html.push(groupHtml(GROUPS[g].label, shown, idx, groupTotal, idPrefix));
        flat = flat.concat(shown);
        idx += shown.length;
      }

      // The prose engine's state only bears on a list that would show pages.
      // Under Tokens there is nothing loading and nothing missing, whatever
      // Pagefind is doing — a skeleton or a warning there would describe rows
      // this view never shows.
      var proseShown = !state.type || state.type === 'page';
      // The prose engine is still loading: keep the names on screen and hold the
      // space the pages will occupy, rather than showing an empty box that fills
      // in a moment and moves everything.
      // Pending while the engine loads AND while this query's search is out:
      // once the engine is warm a new query used to paint the previous one's
      // pages under it for the round trip, and under Pages that read as "no
      // pages match" for a moment before flipping to a list.
      var prosePending = proseShown && ((!index.pagefind && !index.pagefindFailed) || state.proseInFlight);
      // Half of search can die on its own. renderUnavailable only fires when
      // BOTH engines are gone, so a failed prose engine beside a working symbol
      // index used to show no Pages group, no skeleton and no message — the
      // reader searches "color", gets tokens and classes, and concludes the
      // system has no pages about colour. Say it instead.
      // Both go in the panel: neither is a result. The panel sits below the
      // rows in the DOM, but Pages is the first group, so the CSS orders the
      // panel above the rows while it holds the skeleton — the placeholder is
      // where the pages will land. They are mutually exclusive — prose is
      // either still loading or already failed.
      var proseDead = proseShown && index.pagefindFailed && !index.symbolsFailed;
      if (proseDead) {
        panel.push(calloutHtml('warning', 'Page text is not searchable right now',
          'These are name matches only. Reload to search the pages as well.'));
      }
      if (prosePending) {
        panel.push('<div class="search-group" aria-hidden="true"><p class="search-group-label" role="presentation">Pages</p>' +
          '<div class="search-result search-skeleton"><span class="skeleton-line"></span></div>'.repeat(3) + '</div>');
      }

      if (!flat.length && !prosePending) {
        state.results = [];
        // The prose-failed callout is replaced here rather than stacked, because
        // "these are name matches only" describes a list that is not on screen.
        // The *fact* still has to survive: this is the one state where a dead
        // prose engine changes the answer from "here is some of it" to a flat
        // denial, and a reader told "nothing matches" about words that are in
        // three pages has been misinformed, not helped.
        paint('', state.type ? emptyInType(q, groups, proseDead) : emptyHtml(q, proseDead));
        setExpanded(false);
        // The callout sits outside the input's aria-controls, so the live
        // region says what it says: the denial AND the count that makes the
        // Show-all button worth looking for.
        var elsewhere = state.type ? countElsewhere(groups) : 0;
        announce((state.type ? 'No ' + groupFor(state.type).noun + ' match ' + q +
            (elsewhere ? '. ' + elsewhere + ' result' + (elsewhere === 1 ? '' : 's') + ' of other types' : '') : 'No results for ' + q) +
          (proseDead ? '. Page text is not searchable right now, so this covers names only' : ''), false);
        return;
      }

      // The way to the rest, as the last row of the list rather than a link in
      // the footer: the footer is display:none under 768px, so on every phone
      // and most tablets it is not a route at all. A row is, at every width.
      // It joins the flat list so the arrow keys reach it like any other row.
      if (seeAllBase && total > flat.length) {
        html.push('<a class="search-result search-see-all" role="option" aria-selected="false" tabindex="-1"' +
          ' id="' + idPrefix + flat.length + '"' +
          ' href="' + escapeHtml(searchPageUrl(seeAllBase, q, state.type)) + '">' +
          '<span class="search-result-text"><span class="search-result-name">See all ' + total + ' results</span></span></a>');
        flat = flat.concat([{ t: 'see-all' }]);
      }

      state.results = flat;
      paint(html.join(''), panel.join(''));
      // True exactly when the listbox has rows in it, which is what the popup
      // being "expanded" means. It used to be able to say collapsed with rows
      // on screen, because the idle and callout states shared this element.
      setExpanded(flat.length > 0);
      // The ids are rebuilt, so whatever was active no longer exists, and
      // nothing is selected until the reader arrows down. Row 0 used to be
      // pre-selected in the dialog so Enter had a target; that painted an
      // outlined row on every keystroke, on a row nobody had chosen. Enter
      // still opens row 0 — see onKeydown — it just does not say so in advance.
      setActive('');
      // The count is what matched, not what fitted: each group shows five and
      // says so, and announcing 15 when 48 matched would be wrong out loud.
      //
      // The live region is the only channel guaranteed to reach a screen-reader
      // user: the panel is outside the input's aria-controls, so a reader
      // driving the combobox never traverses into the callout sitting there.
      // If prose is dead, the count is names only and has to say so.
      // Under a pressed type the count names the type — "8 classes for gap" —
      // so the status line corroborates the button above it.
      var group = state.type ? groupFor(state.type) : { noun: 'results', one: 'result' };
      var unit = total === 1 ? group.one : group.noun;
      if (!prosePending) {
        announce(total + ' ' + unit + ' for ' + q +
          (proseDead ? '. Page text is not searchable right now, so these are name matches only' : ''), true);
      }
    }

    // Everything the query found, by type, before the type filter is applied.
    // The filter row is built from this, so it lists what there is to choose
    // between rather than what the current choice lets through.
    function groupResults() {
      var out = {};
      var symbolMatches = matchSymbols(state.query.trim());
      for (var i = 0; i < symbolMatches.length; i++) {
        var s = symbolMatches[i];
        if (!out[s.t]) out[s.t] = [];
        out[s.t].push(s);
      }
      if (state.prose && state.prose.length) {
        out.page = (out.page || []).concat(state.prose);
      }
      return out;
    }

    // The real count of a group, which for pages is Pagefind's total rather
    // than the slice that was fetched.
    function groupCount(groups, key) {
      var n = groups[key] ? groups[key].length : 0;
      return (key === 'page' && state.proseTotal > n) ? state.proseTotal : n;
    }

    // `proseDead` narrows the claim rather than decorating it. "Nothing matches"
    // is a statement about the whole system; with the prose engine down it is
    // only true of names, and saying it flatly tells the reader the system has
    // nothing on a subject it has three pages about.
    function emptyHtml(q, proseDead) {
      // No links of its own: every site has search, not every site has a
      // Tokens or Classes page (engine parity C1)
      return calloutHtml('info',
        (proseDead ? 'No name matches “' : 'Nothing matches “') + q + '”',
        'Try a token name like <code>--text-primary</code>, a class like <code>.gap-m</code>, or a page title.' +
        (proseDead ? ' Page text is not searchable right now — reload to search the pages as well.' : ''));
    }

    // Reachable only by typing on after pressing a type, or by a `?type=` link:
    // a button is only offered for a type that has results, but the pressed
    // one stays in the row when its results go, so there is a way back. Names
    // the type the way the button does, and counts what the other types hold
    // so the button below is a promise and not a guess.
    function countElsewhere(groups) {
      var n = 0;
      for (var g = 0; g < GROUPS.length; g++) {
        if (GROUPS[g].key !== state.type) n += groupCount(groups, GROUPS[g].key);
      }
      return n;
    }

    function emptyInType(q, groups, proseDead) {
      var elsewhere = countElsewhere(groups);
      // Named by its count so it is a promise, and so it cannot be confused
      // with the footer's "See all results", which leaves the dialog. With
      // nothing elsewhere it only clears the filter, and says so.
      var showAll = '<button type="button" class="button" data-variant="faded" data-size="small" data-search-show-all>' +
        (elsewhere ? 'Show all ' + elsewhere + ' results' : 'Search all types') + '</button>';
      // `proseDead` is only ever true under Pages here (render gates it on
      // proseShown), and there it is the whole story: the names did not match,
      // and the text that might have was never searched. Same words as emptyHtml.
      return calloutHtml('info',
        (proseDead ? 'No page name matches “' : 'No ' + groupFor(state.type).noun + ' match “') + q + '”',
        (elsewhere ? elsewhere + ' result' + (elsewhere === 1 ? '' : 's') + ' of other types. ' : '') +
        (proseDead ? 'Page text is not searchable right now — reload to search the pages as well. ' : '') + showAll);
    }

    // Names what happened, not just the symptom, and points at something the
    // reader can see: on a phone the dialog fills the viewport and there is no
    // sidebar on screen to send them to.
    function renderUnavailable() {
      state.results = [];
      setExpanded(false);
      paint('', calloutHtml('warning', 'Search is unavailable',
        'The index did not load. Reload to try again — every page is still reachable from the navigation.'));
      announce('Search is unavailable', false);
    }

    function renderIdle() {
      state.results = [];
      setExpanded(false);
      var html = [];

      var recents = readRecents();
      if (recents.length) {
        // role="group" with a name, matching groupHtml. Before the split these
        // rows sat inside the element labelled "Search results"; the panel is a
        // bare div, so without this the visible "Recent" heading is aria-hidden
        // with no named ancestor to carry it and a screen reader is read a list
        // of past queries with nothing saying what they are.
        html.push('<div class="search-group" role="group" aria-label="Recent searches">' +
          '<p class="search-group-label" role="presentation" aria-hidden="true">Recent</p>');
        for (var i = 0; i < recents.length; i++) {
          // Two sibling buttons, not a span nested inside one. The remove
          // affordance used to be an aria-hidden span inside the row button:
          // no tab stop, no role, no name, and invalid to fix in place because
          // a button cannot contain a button. A keyboard or screen-reader user
          // had no way to delete a recent query at all.
          var recent = escapeHtml(recents[i]);
          html.push('<div class="search-recent">' +
            '<button type="button" class="search-result" data-type="recent" data-recent="' + recent + '">' +
            '<span class="search-result-text"><span class="search-result-name">' + recent + '</span></span>' +
            '</button>' +
            '<button type="button" class="button close-btn search-result-remove" data-icon-only data-size="small"' +
            ' data-recent-remove="' + recent + '"' +
            ' aria-label="Remove “' + recent + '” from recent searches">' +
            '<span class="svg-icn" data-icon="close">' + templateIcon('close') + '</span></button>' +
            '</div>');
        }
        html.push('</div>');
      }

      var starts = startHere();
      if (starts.length) {
        // aria-hidden on the label, unlike before: the group now carries the
        // name, and leaving the text exposed as well says "Start here" twice.
        html.push('<div class="search-group" role="group" aria-label="Start here">' +
          '<p class="search-group-label" role="presentation" aria-hidden="true">Start here</p>');
        for (var j = 0; j < starts.length; j++) {
          html.push('<a class="search-result" data-type="page" href="' + escapeHtml(starts[j].u) + '">' +
            '<span class="search-result-text"><span class="search-result-name">' + escapeHtml(starts[j].n) + '</span></span></a>');
        }
        html.push('</div>');
      }

      // Recent queries and Start here are buttons and links, not options — the
      // listbox stays empty, which is also why setExpanded(false) above is now
      // true to the screen rather than contradicting it.
      paint('', html.join(''));
      announce('', true);
    }

    /* -- Filters -- */

    // One button per result type the query found, plus All — the same words as
    // the group headings below, in the same order, so a button and a heading
    // are the same thing said twice. Built from the whole result set, never
    // from the filtered one: the row that showed only the pressed choice and
    // All was how the section filter (1.0–1.3) lost its other options on
    // every press.
    function renderFilters() {
      var q = state.query.trim();
      // An empty query matches every name, so an idle surface would offer a full
      // set of types that filter nothing. There is no result set to narrow yet.
      //
      // An ARMED filter is the exception, and it has to be, or deleting back to
      // one character takes the row away while `state.type` stays set: the
      // filter is still on, there is no control to turn it off, and it silently
      // reapplies as soon as the query gets long enough again. Same state is
      // reachable straight from `/search.html?type=tokens` with no `q`.
      if (!index.symbols || (q.length < MIN_QUERY && !state.type)) return hideFilters();
      var groups = groupResults();
      var types = [];
      for (var g = 0; g < GROUPS.length; g++) {
        // The pressed type stays in the row even once nothing matches it, or
        // there is no way back to All and no sign that anything was filtered.
        if (groupCount(groups, GROUPS[g].key) || GROUPS[g].key === state.type) types.push(GROUPS[g]);
      }
      // One type is not a filter, it is a label. Show the row only when there is
      // a choice to make — or when a choice has already been made.
      if (types.length < 2 && !state.type) return hideFilters();
      // The Segmented control's flat form (cms/form.md): toggle buttons, one
      // pressed.
      var html = [filterButton('', 'All', !state.type)];
      for (var j = 0; j < types.length; j++) {
        html.push(filterButton(types[j].key, types[j].label, state.type === types[j].key));
      }
      // Every query rebuilds this row — twice, when page text arrives after
      // the names — which destroys whatever was focused inside it. Put focus
      // back on the same button, not on the pressed one: each button is its
      // own Tab stop, and someone who tabbed on to the next type while
      // results loaded would otherwise be pulled back.
      var focused = els.filters.contains(document.activeElement) ? document.activeElement.getAttribute('data-filter') : null;
      els.filters.innerHTML = html.join('');
      els.filters.hidden = false;
      if (focused !== null) {
        var target = null;
        var buttons = els.filters.querySelectorAll('[data-filter]');
        for (var k = 0; k < buttons.length; k++) {
          if (buttons[k].getAttribute('data-filter') === focused) target = buttons[k];
        }
        (target || els.filters.querySelector('.is-active') || els.input).focus();
      }
    }

    // Every way the row leaves goes through here: emptying it under a focused
    // button would drop focus to <body> inside the modal — pressing All with
    // the query deleted to one character did exactly that. Hand focus to the
    // field, which is where typing goes.
    function hideFilters() {
      if (els.filters.contains(document.activeElement)) els.input.focus();
      els.filters.hidden = true;
      els.filters.innerHTML = '';
    }

    // aria-pressed and .is-active move together — the component's own rule.
    // `data-filter`, not `data-type`: result rows carry data-type for the CSS,
    // and the two must not answer the same selector.
    function filterButton(value, label, on) {
      return '<button type="button" class="segmented-control-btn' + (on ? ' is-active' : '') + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '" data-filter="' + escapeHtml(value) + '">' +
        escapeHtml(label) + '</button>';
    }

    /* -- Combobox state -- */

    function setExpanded(open) {
      els.input.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) {
        els.input.removeAttribute('aria-activedescendant');
        state.activeId = '';
      }
    }

    // Scoped to the listbox, not the whole results area: an option is the only
    // thing aria-activedescendant may name, and the listbox is the only place
    // an option can now be.
    function setActive(id) {
      // Resolve before mutating anything. The old order deselected the previous
      // row and moved state.activeId, then bailed if the new row was not found
      // — leaving aria-activedescendant naming a row that is no longer selected
      // and state disagreeing with the attribute. Unreachable while the listbox
      // and state.results are painted together, which is exactly why it should
      // not be left to a later change to discover.
      var next = id ? els.list.querySelector('#' + id) : null;
      if (id && !next) return;
      var previous = state.activeId && els.list.querySelector('#' + state.activeId);
      if (previous) previous.setAttribute('aria-selected', 'false');
      state.activeId = id;
      if (!id) {
        els.input.removeAttribute('aria-activedescendant');
        return;
      }
      next.setAttribute('aria-selected', 'true');
      els.input.setAttribute('aria-activedescendant', id);
      // block:'nearest' keeps the list still when the active row is already
      // visible; anything else scrolls on every arrow press.
      next.scrollIntoView({ block: 'nearest' });
    }

    function moveActive(delta) {
      if (!state.results.length) return;
      var ids = state.results.map(function (_, i) { return idPrefix + i; });
      var at = ids.indexOf(state.activeId);
      // Wrap: a list this short is faster to cycle than to reverse out of.
      var next = at === -1 ? (delta > 0 ? 0 : ids.length - 1) : (at + delta + ids.length) % ids.length;
      setActive(ids[next]);
    }

    // The status line is the live region and it is also visible text, so in the
    // states that paint a callout it would say on screen what the callout already
    // says — "No results for zzqqxx" above a callout titled "Nothing matches
    // zzqqxx". Pass visible:false there: the region keeps announcing and stops
    // showing, so the callout is the only visible statement and a screen reader
    // still hears the outcome.
    //
    // .visually-hidden, never display:none. A live region revealed at announce
    // time is not reliably announced (cms/login.md) — clipping keeps it rendered
    // and in the accessibility tree throughout.
    //
    // The two halves move at different times on purpose. Hiding takes effect at
    // once, because the text being hidden is the *previous* state's and has just
    // stopped being true. Revealing waits for the debounce, so it lands with the
    // text it belongs to — reveal early and the stale message is on screen for
    // half a second, which is how "No results for zzqqxx" ends up sitting above
    // a list of matching tokens.
    function announce(text, visible) {
      if (visible === false) els.status.classList.add('visually-hidden');
      debounce(function () {
        // Replacing a text node with equal text is still a change to a live
        // region, and some readers say it again. Under a pressed type the
        // render after prose lands carries the same count as the one before.
        if (els.status.textContent !== text) els.status.textContent = text;
        els.status.classList.toggle('visually-hidden', visible === false);
      }, ANNOUNCE_DEBOUNCE_MS, 'announceTimer');
    }

    /* -- Query pipeline -- */

    function runQuery() {
      var q = state.query.trim();
      state.requestId += 1;
      var requestId = state.requestId;

      // A new question drops the old answer. Not on every runQuery — a filter
      // press re-runs the same query and must keep its pages on screen.
      // Before the paint, or the old pages go up once more under the new query.
      if (q !== state.proseQuery) {
        state.proseQuery = q;
        state.prose = [];
        state.proseTotal = 0;
        state.proseInFlight = q.length >= MIN_QUERY;
      }
      if (onQuery) onQuery(q, state.type);
      renderFilters();
      render();

      if (q.length < MIN_QUERY) return;

      loadPagefind().then(function () {
        if (requestId !== state.requestId) return;
        return searchProse(q, requestId).then(function (rows) {
          if (rows === null || requestId !== state.requestId) return;
          state.proseInFlight = false;
          state.prose = rows.map(function (d) {
            var best = bestSubResult(d);
            return {
              t: 'page',
              n: d.meta && d.meta.title ? d.meta.title : d.url,
              // Where the row opens: the best-matching section of the page,
              // which is the page itself when the page is what matched.
              // `best && best.url`, not just `best`: the excerpt below already
              // guards its field, and the URL is the load-bearing one. A missing
              // url would not give href="" but href="undefined" — a relative
              // link to a file that does not exist.
              u: best && best.url ? best.url : d.url,
              // The page URL on its own, kept for the dedupe below. Once `u`
              // can carry an anchor it stops being the thing to compare, and
              // comparing it anyway silently stops the dedupe firing — which
              // lists every page matching by name AND by prose twice.
              page: d.url,
              s: d.filters && d.filters.section ? d.filters.section[0] : '',
              // The heading the row opens at, for the meta line. Guarded on the
              // URL differing, not on the title existing: when the preamble
              // section wins, Pagefind gives it the page's own title, and a row
              // named Motion reading "Website · Motion" says nothing twice.
              sub: best && best.url !== d.url ? best.title : '',
              // The winning section's own excerpt, not the page's. A row that
              // opens at a heading and quotes text from further down sends the
              // reader to a place that does not contain what was highlighted.
              excerpt: best && best.excerpt ? best.excerpt : d.excerpt
            };
          }).filter(function (row) {
            // The symbol index already lists every page by title; a prose hit on
            // the same page would be the same row twice. Compare on `page`: the
            // symbol index holds bare page URLs and `u` may now be anchored.
            return !matchSymbols(state.query.trim()).some(function (s) { return s.t === 'page' && s.u === row.page; });
          });
          renderFilters();
          render();
        });
      });
    }

    /* -- Events -- */

    function onInput() {
      state.query = els.input.value;
      debounce(runQuery, QUERY_DEBOUNCE_MS, 'queryTimer');
    }

    function onKeydown(event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return; }
      // Alt+Home / Alt+End, not bare Home / End. In an editable combobox the
      // unmodified keys belong to the caret — taking them meant someone who had
      // typed `--text-primry` could not jump to the start to fix it, and had to
      // hold ArrowLeft instead. The APG gives the modified pair to the list.
      if (event.altKey && event.key === 'Home' && state.results.length) { event.preventDefault(); setActive(idPrefix + '0'); return; }
      if (event.altKey && event.key === 'End' && state.results.length) { event.preventDefault(); setActive(idPrefix + (state.results.length - 1)); return; }
      if (event.key === 'Enter') {
        var active = state.activeId ? els.list.querySelector('#' + state.activeId) : null;
        // No row chosen: a palette opens its first result, a page does nothing.
        if (!active && enterOpensFirst && state.results.length) active = els.list.querySelector('#' + idPrefix + '0');
        if (!active) return;
        event.preventDefault();
        rememberQuery(state.query);
        if (event.metaKey || event.ctrlKey) {
          window.open(active.href, '_blank', 'noopener');
          return;
        }
        onSelect();
        // Let the site's own router take the navigation, so a page transition
        // still runs and prefetch still applies.
        active.click();
      }
      // Escape is deliberately not handled: dialog.js owns it through the native
      // cancel event, and a second handler here would close the dialog twice.
    }

    function onResultsClick(event) {
      var showAll = event.target.closest('[data-search-show-all]');
      if (showAll) {
        event.preventDefault();
        state.type = '';
        runQuery();
        els.input.focus();
        return;
      }
      var remove = event.target.closest('[data-recent-remove]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        var value = remove.getAttribute('data-recent-remove');
        var removes = els.panel.querySelectorAll('[data-recent-remove]');
        var position = Array.prototype.indexOf.call(removes, remove);
        writeRecents(readRecents().filter(function (item) { return item !== value; }));
        renderIdle();
        // The repaint destroyed the focused button. Land on the one that took
        // its place, or the one before it, or the field once none are left.
        removes = els.panel.querySelectorAll('[data-recent-remove]');
        (removes[Math.min(position, removes.length - 1)] || els.input).focus();
        return;
      }
      var recent = event.target.closest('[data-recent]');
      if (recent) {
        els.input.value = recent.getAttribute('data-recent');
        state.query = els.input.value;
        runQuery();
        els.input.focus();
        return;
      }
      var row = event.target.closest('a.search-result');
      if (row) {
        rememberQuery(state.query);
        onSelect();
      }
    }

    // Focus is deliberately NOT moved to the field here: someone stepping
    // through types with Tab and Space would be thrown back to the input on
    // every press. Focus stays on the button — renderFilters puts it back on
    // the pressed one after the rebuild.
    function onFilterClick(event) {
      var button = event.target.closest('[data-filter]');
      if (!button || !els.filters.contains(button)) return;
      state.type = button.getAttribute('data-filter');
      runQuery();
    }

    els.input.addEventListener('input', onInput);
    els.input.addEventListener('keydown', onKeydown);
    els.results.addEventListener('click', onResultsClick);
    els.filters.addEventListener('click', onFilterClick);

    return {
      // Load the symbol index, then paint. Called whenever the surface becomes
      // visible; loadSymbols is idempotent, so repeat calls cost nothing.
      activate: function () {
        return loadSymbols().then(function () {
          if (index.symbolsFailed && !state.query) return renderUnavailable();
          renderFilters();
          render();
        });
      },
      // Put a question to this surface from outside it — a ?q= on arrival, or
      // the back button. Goes through the same runQuery as a keystroke, so
      // there is one path and not two.
      // `type` is the URL's slug. Omit it to keep whichever type is pressed;
      // pass '' to clear it. An unrecognised slug is dropped rather than shown
      // — see typeFromSlug.
      ask: function (query, type) {
        state.query = query || '';
        if (type !== undefined) state.type = typeFromSlug(type);
        els.input.value = state.query;
        runQuery();
      },
      focus: function () { els.input.focus(); },
      select: function () { els.input.select(); },
      collapse: function () { setExpanded(false); },
      // Cancel the debounced work. A surface inside the Barba container is
      // detached on navigation while its timers are still pending; they would
      // otherwise wake up and write to nodes nobody can see.
      stop: function () {
        clearTimeout(state.queryTimer);
        clearTimeout(state.announceTimer);
      }
    };
  }

  /* ------ The dialog surface ------ */

  var dialogSearch = null;
  var dialogEl = null;

  function closeDialog() {
    if (window.bdRequestClose) window.bdRequestClose(dialogEl, 'result');
    else if (dialogEl.open) dialogEl.close();
  }

  // Search is closed to a guest (permissions-plan.md §4.7): the indexes carry
  // every team page's text, so the Worker refuses them and the trigger is
  // hidden (docs-site.css, body[data-role="guest"]). The shortcut has no
  // trigger to hide, so it is refused here.
  function searchClosed() {
    if (window.bdSession) return window.bdSession.role === 'guest';
    return document.body.getAttribute('data-role') === 'guest';
  }

  function openDialog() {
    if (dialogEl.open || searchClosed()) return;
    // data-dialog-open on the header button is dialog.js's own contract; this
    // path exists for the keyboard shortcut, which has no trigger element.
    dialogEl.showModal();
    dialogSearch.focus();
    dialogSearch.select();
    // activate() runs from the attribute observer, which also covers the
    // header button's path through dialog.js.
  }

  // Cmd/Ctrl+K from anywhere, and `/` when the caret is not already in a field.
  // Neither is bound anywhere else on the site (verified against dropdown.js,
  // glossary.js and nav.js, which bind only within their own subtrees).
  function onGlobalKeydown(event) {
    var isK = (event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'k' || event.key === 'K');
    var isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (!isK && !isSlash) return;
    if (searchClosed()) return;

    if (isSlash) {
      var target = event.target;
      if (target && (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      // Another modal is open and owns the keyboard.
      if (document.querySelector('dialog[open]') && !dialogEl.open) return;
    }

    event.preventDefault();
    if (dialogEl.open) dialogSearch.select();
    else openDialog();
  }

  /* ------ The page surface ------ */

  // /search.html. Unlike the dialog this sits INSIDE the Barba container, so
  // it arrives and leaves with the page: a fresh host on every navigation to
  // it, and the previous one detached with its timers still pending.
  var pageSearch = null;

  function readUrlQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      return { q: params.get('q') || '', type: params.get('type') || '' };
    } catch (err) {
      return { q: '', type: '' };
    }
  }

  // replaceState, not pushState: typing is not six visits to six URLs, and a
  // reader who presses back wants the page they came from, not their own
  // third keystroke. The address bar stays worth copying either way.
  //
  // Nothing here listens for popstate, and there is nothing for it to do:
  // replaceState leaves no same-document entry to come back to. Arriving at
  // this page at all — first load, or back to it through Barba — runs
  // initSearchPage, and that reads the URL. One restore path, not two.
  //
  // **The state object is Barba's and must be handed straight back.** Barba
  // keeps its entire history model in `history.state` — `{from, index,
  // states:[…]}` — and on popstate reads `state.index` and `state.states` to
  // work out direction and restore its stack. Writing our own object over it
  // left `index` undefined, so the first Back press after any keystroke threw
  // inside the router, left the previous page's DOM on screen under the new
  // URL, and killed Barba for the rest of the visit. Only the URL changes here.
  function writeUrlQuery(query, type) {
    try {
      var url = searchPageUrl(window.location.pathname, query, type, window.location);
      if (url === window.location.pathname + window.location.search + window.location.hash) return;
      window.history.replaceState(window.history.state, '', url);
      // Barba's own record of this entry keeps the pre-edit URL otherwise, and
      // that is what it restores from on a later popstate.
      if (window.barba && window.barba.history && window.barba.history.update) {
        window.barba.history.update({ url: url });
      }
    } catch (err) {
      // A browser that refuses history writes still has a working search.
    }
  }

  function initSearchPage() {
    var host = document.getElementById('search-page');
    // Whatever happens next, the surface from the previous page is finished
    // with. Stop it first, and stop it even when the new host is missing or
    // malformed — a bail that skipped this left the old one running.
    if (pageSearch) { pageSearch.stop(); pageSearch = null; }
    if (!host || host.dataset.searchInit) return;

    // The page this surface belongs to. Everything async it does is checked
    // against this rather than against the live URL, which Barba moves on
    // before the container it belongs to is taken away.
    var pagePath = window.location.pathname;

    var surface = createSearch(host, {
      idPrefix: 'pr-',
      // Nothing to close: the results are the page.
      onSelect: function () {},
      // Only while the address bar still says this page. The 150ms debounce
      // and the symbol fetch both outlive a navigation away, and this writes
      // to `window.location` — a surface finishing its work after the reader
      // had moved on was rewriting the URL of the page they moved to.
      //
      // `host.isConnected` is NOT sufficient and was the first attempt:
      // Barba pushes the new URL at the start of a transition and removes the
      // old container at the end, so for most of a swap the old host is still
      // attached while the URL has already changed. Pin to the path instead.
      onQuery: function (query, type) {
        if (window.location.pathname === pagePath) writeUrlQuery(query, type);
      },
      // No cap and no see-all row. This is where "see all" leads — so it also
      // fetches deeper than the dialog, which only ever shows five.
      groupLimit: Infinity,
      proseFetch: PROSE_FETCH_PAGE
      // No enterOpensFirst: a page is read, not just typed into, and the form
      // submit already re-asks the question.
    });
    if (!surface) return;
    host.dataset.searchInit = 'true';

    pageSearch = surface;

    // With JS the form never submits — the answer is already on screen, and a
    // round trip would throw it away. Without JS it submits to itself, which is
    // why the field carries name="q" and the form carries no action.
    var form = host.querySelector('form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        surface.ask(host.querySelector('.search-input').value);
      });
    }

    var from = readUrlQuery();
    surface.activate().then(function () {
      // The symbol fetch is not cancellable and outlives a navigation away —
      // on a cold cache by seconds. stop() cannot reach a pending promise, so
      // the check is here: nobody is reading a page they have left.
      if (window.location.pathname !== pagePath) return;
      if (from.q || from.type) surface.ask(from.q, from.type);
    });

    console.log('search.js v' + VERSION + ' page surface initialised');
  }

  /* ------ Init ------ */

  function initSearch() {
    initSearchPage();

    var dialog = document.getElementById('site-search');
    // No dialog means search is off for this build (docs.config.js `search`),
    // or this page is outside the docs shell. Either way there is nothing to do.
    if (!dialog || dialog.dataset.searchInit) return;

    // Emitted by the generator, so it is siteHref'd and honours basePath.
    var pageBase = dialog.getAttribute('data-search-page') || '';

    var surface = createSearch(dialog, {
      idPrefix: 'sr-',
      onSelect: closeDialog,
      // The footer link and the last row both lead to the results page and
      // both carry the live question. The footer link sits outside
      // .search-results, so the click delegate never sees it and render()
      // cannot reach it — it is updated here instead. Until now it was emitted
      // once and never touched, so "Open full search" handed over an empty
      // page and the reader typed the query again.
      onQuery: function (query, type) {
        var all = dialog.querySelector('.search-all');
        if (all) all.setAttribute('href', searchPageUrl(pageBase, query, type));
      },
      seeAllBase: pageBase,
      enterOpensFirst: true
    });
    // A half-built host is a build fault, not a permanent state. Stamping before
    // this bail marked it initialised for the life of the page, so the retry on
    // the next bd:after-nav could never run.
    if (!surface) return;
    dialog.dataset.searchInit = 'true';

    dialogEl = dialog;
    dialogSearch = surface;

    // dialog.js dispatches only hide events, and the dialog can be opened three
    // ways (the header button through dialog.js, the keyboard shortcut, a link
    // to it). Watching the `open` attribute catches all of them without
    // reaching into dialog.js or duplicating its trigger handling.
    new MutationObserver(function () {
      if (dialog.open) surface.activate();
      else surface.collapse();
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

    document.addEventListener('keydown', onGlobalKeydown);

    console.log('search.js v' + VERSION + ' initialised');
  }

  window.initSearch = initSearch;

  // Registered twice, per the project's Barba contract: once for a full load,
  // once for every subsequent page arrival. initSearch is idempotent. The
  // dialog lives outside the Barba container and survives the swap; the page
  // surface lives inside it and is rebuilt on every arrival.
  document.addEventListener('DOMContentLoaded', initSearch);
  document.addEventListener('bd:after-nav', initSearch);
})();
