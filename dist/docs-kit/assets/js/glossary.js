/**
 * Component Purpose: The glossary index — search and topic-filter the term
 * cards, keep the A–Z rail honest about which letters remain, and open each
 * term in a reading drawer.
 * Author: By Default
 * Created: 2026-08-20
 * Version: 2.3
 *
 * The cards are generated from cms/glossary/ (cms/generator/glossary.js);
 * nothing here builds them. Each card is a whole-card link to the term's own
 * page, so with no JS the glossary is a list of links and nothing is lost.
 *
 * Filtering. Search matches term name + short definition, whitespace-
 * separated words ANDed, so a second word always narrows — ORing would widen
 * the results, which reads as the search being broken. The topic chips are
 * native radios (chip.md); a card stays when it matches the words AND carries
 * the chosen topic in data-topics. Only .is-hidden is toggled.
 *
 * Two debounces, deliberately different:
 *   filter  100ms — below the ~150ms where typing feels disconnected.
 *   count   500ms — the count element is an aria-live region, and updating
 *           it per keystroke burst queues a backlog of stale announcements
 *           in screen readers; one announcement per pause is the contract.
 *
 * The reading drawer. One <dialog class="drawer"> is appended to <body>,
 * outside the Barba container (drawer.md): dialog.js gives it Escape, the
 * backdrop, drag to dismiss and the focus trap, and Barba's beforeLeave
 * closes it through bdCloseOpenDialogs(). A plain left click on a card opens
 * it at once with the card's own title and definition, then fetches the
 * entry page and lifts its <article> in, so the sheet is never empty. A
 * modified click (new tab, new window) falls through to the link. The entry
 * page stays the share, search, crawl and no-JS target; the drawer carries
 * everything on it, so it offers no link out to it.
 *
 * Art strip. A term with a drawing carries its hue on the card
 * (data-glossary-art). The drawer paints its strip in that hue as it opens,
 * so the height is held from the first frame, and the drawing arrives with
 * the article, lifted from the entry page's own .glossary-art. A term with
 * no drawing keeps the strip hidden, and the drawer is as it was.
 *
 * URL. ?topic= and ?term= are written with replaceState, never pushState,
 * handing history.state straight back: Barba keeps its whole history model
 * there (search.js writeUrlQuery records why). So Back leaves the page rather
 * than closing the drawer, which is the accepted trade.
 *
 * Lifecycle: bd-site-init.js calls window.initGlossary(container) on initial
 * load (no container) and after every Barba transition (the arriving one). Each arrival is a fresh container, so
 * elements are re-cached and re-bound; on pages without the glossary root
 * the module removes its drawer, hands the rail's observers back via
 * azIndex.reset() and bails.
 *
 * Uses az-index.js, dialog.js and scroller.js when they load first; each is
 * optional (no rail, a plain modal, no edge fade).
 */

(function () {
  'use strict';

  var VERSION = '2.3.0';

  var FILTER_DEBOUNCE_MS = 100;

  var COUNT_DEBOUNCE_MS = 500;

  var DRAWER_ID = 'glossary-drawer';

  var els = {};

  var items = [];

  var topicNames = {};

  var query = '';

  var topic = '';

  var filterTimer = null;

  var countTimer = null;

  // Entries already fetched this visit, by slug: { article, art }, each a
  // fragment (art null for a term with no drawing). A related-term hop back
  // to a term already read swaps in at once.
  var entryCache = new Map();

  // The card the drawer was opened from, for focus return on close.
  var opener = null;

  // What the close should do instead of returning focus to the opener (a
  // topic tag shows the chosen topic). Run once by handleDrawerClose.
  var afterClose = null;

  // True from bd:before-nav until the next init. Barba closes the drawer on
  // its way out while the leaving container is still attached and the URL is
  // already the next page's, so isConnected cannot tell; this can.
  var leaving = false;

  // Bumped on every load, so a slow fetch that lands after the reader has
  // moved to another term cannot overwrite it.
  var loadToken = 0;

  //
  //------- Element lookup -------//
  //

  // Cache Elements
  // Scoped to the arriving container when bd-site-init passes one: after a
  // Barba navigation the leaving page is still in the DOM, and a document-
  // wide lookup would find the glossary being left.
  function cacheElements(container) {
    els = {};
    els.root = (container || document).querySelector('[data-glossary-terms]');

    if (!els.root) {
      return false;
    }

    els.search = els.root.querySelector('[data-glossary-search]');
    els.count = els.root.querySelector('[data-glossary-count]');
    els.noMatch = els.root.querySelector('[data-glossary-no-match]');
    els.noMatchTitle = els.root.querySelector('[data-glossary-no-match-title]');
    els.noMatchHint = els.root.querySelector('[data-glossary-no-match-hint]');
    els.list = els.root.querySelector('[data-glossary-list]');
    els.rail = els.root.querySelector('[data-az-index]');
    els.topicFilter = els.root.querySelector('[data-glossary-topic-filter]');
    els.topics = els.root.querySelector('[data-glossary-topics]');

    return Boolean(els.search && els.list);
  }

  // Index Items
  // The haystack is built once per arrival, not lowercased again on every
  // keystroke.
  function indexItems() {
    var cards = els.list.querySelectorAll('[data-glossary-term]');
    var i;

    items = [];

    for (i = 0; i < cards.length; i += 1) {
      var title = cards[i].querySelector('.book-contents-item-title');
      var description = cards[i].querySelector('.book-contents-item-description');
      var text = (title ? title.textContent : '') + ' ' + (description ? description.textContent : '');
      var topics = cards[i].getAttribute('data-topics');

      items.push({
        el: cards[i],
        slug: cards[i].getAttribute('data-glossary-term'),
        searchText: text.toLowerCase(),
        topics: topics ? topics.split(' ') : []
      });
    }
  }

  // Index Topics
  // Chip value → visible name, for the no-match message.
  function indexTopics() {
    var radios = els.topics ? els.topics.querySelectorAll('input[type="radio"]') : [];
    var i;

    topicNames = {};

    for (i = 0; i < radios.length; i += 1) {
      var label = radios[i].closest('label');

      topicNames[radios[i].value] = label ? label.textContent.trim() : radios[i].value;
    }
  }

  // Find Item
  function findItem(slug) {
    var i;

    for (i = 0; i < items.length; i += 1) {
      if (items[i].slug === slug) {
        return items[i];
      }
    }

    return null;
  }

  //
  //------- URL -------//
  //

  // Read Url Param
  function readUrlParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (err) {
      return '';
    }
  }

  // Write Url Param
  // An empty value removes the parameter. The state object is Barba's and is
  // handed straight back; only the URL changes (see the header).
  function writeUrlParam(name, value) {
    try {
      var url = new URL(window.location.href);

      if (value) {
        url.searchParams.set(name, value);
      } else {
        url.searchParams.delete(name);
      }

      var next = url.pathname + url.search + url.hash;

      if (next === window.location.pathname + window.location.search + window.location.hash) {
        return;
      }

      window.history.replaceState(window.history.state, '', next);

      // A full URL, as barba-init.js passes it.
      if (window.barba && window.barba.history && window.barba.history.update) {
        window.barba.history.update({ url: window.location.href });
      }
    } catch (err) {
      // A browser that refuses history writes still has a working glossary.
    }
  }

  //
  //------- Filtering -------//
  //

  // Matches Query
  function matchesQuery(searchText) {
    if (!query) {
      return true;
    }

    var words = query.split(/\s+/);
    var i;

    for (i = 0; i < words.length; i += 1) {
      if (words[i] && searchText.indexOf(words[i]) === -1) {
        return false;
      }
    }

    return true;
  }

  // Matches Topic
  function matchesTopic(item) {
    return !topic || item.topics.indexOf(topic) !== -1;
  }

  // Apply Filter
  function applyFilter() {
    var visibleCount = 0;
    var groups = els.list.querySelectorAll('.az-group');
    var i;

    for (i = 0; i < items.length; i += 1) {
      var matches = matchesQuery(items[i].searchText) && matchesTopic(items[i]);

      items[i].el.classList.toggle('is-hidden', !matches);

      if (matches) {
        visibleCount += 1;
      }
    }

    // A group whose cards are all hidden keeps its letter label otherwise:
    // a heading with nothing under it.
    for (i = 0; i < groups.length; i += 1) {
      var hasVisible = groups[i].querySelector('[data-glossary-term]:not(.is-hidden)') !== null;

      groups[i].classList.toggle('is-hidden', !hasVisible);
    }

    if (visibleCount === 0) {
      els.list.classList.add('is-hidden');
      if (els.rail) {
        els.rail.classList.add('is-hidden');
      }
      updateNoMatchMessage();
      if (els.noMatch) {
        els.noMatch.classList.remove('is-hidden');
      }
    } else {
      els.list.classList.remove('is-hidden');
      if (els.noMatch) {
        els.noMatch.classList.add('is-hidden');
      }
      if (els.rail && window.azIndex) {
        els.rail.classList.remove('is-hidden');
        window.azIndex.build(els.rail);
      }
    }

    scheduleCountUpdate(visibleCount);
  }

  // Update No Match Message
  // textContent, never innerHTML — the title echoes whatever was typed.
  function updateNoMatchMessage() {
    if (!els.noMatchTitle) {
      return;
    }

    var where = topic ? ' in ' + (topicNames[topic] || topic) : '';

    els.noMatchTitle.textContent = 'Nothing' + where + ' matches “' + query + '”';

    // With a topic on, clearing the search shows that topic, not every term.
    if (els.noMatchHint) {
      els.noMatchHint.textContent = topic
        ? 'Try a word from a definition, or search all topics.'
        : 'Try a word from a definition, or clear the search to see every term.';
    }
  }

  //
  //------- Count -------//
  //

  // Schedule Count Update
  function scheduleCountUpdate(visibleCount) {
    window.clearTimeout(countTimer);
    countTimer = window.setTimeout(function updateCount() {
      if (!els.count) {
        return;
      }

      if (visibleCount === items.length) {
        els.count.textContent = items.length + ' terms';
      } else {
        els.count.textContent = visibleCount + ' of ' + items.length + ' terms';
      }
    }, COUNT_DEBOUNCE_MS);
  }

  //
  //------- Search handlers -------//
  //

  // Apply Search
  function applySearch() {
    var next = els.search.value.trim().toLowerCase();

    // Whitespace-only edits and repeated keystrokes inside a debounce window
    // both land here with nothing actually changed.
    if (next === query) {
      return;
    }

    query = next;
    applyFilter();
  }

  // Handle Search Input
  // Bound to 'input' rather than 'keyup': paste, dictation and the field's
  // native clear button all fire input without a key.
  function handleSearchInput() {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(applySearch, FILTER_DEBOUNCE_MS);
  }

  // Handle Search Event
  // Blink and WebKit clear a type="search" field natively on Escape and fire
  // 'search' rather than 'input' in some paths; applying immediately keeps
  // the list in step with the field everywhere.
  function handleSearchEvent() {
    window.clearTimeout(filterTimer);
    applySearch();
  }

  // Handle Search Keydown
  // Escape clears the field and the query, the same in every browser. Focus
  // stays in the field: the reader pressed Escape to type something else.
  function handleSearchKeydown(event) {
    if (event.key !== 'Escape' || !els.search.value) {
      return;
    }

    els.search.value = '';
    // A script write fires no event; this one lets field.js hide the clear.
    els.search.dispatchEvent(new Event('input', { bubbles: true }));
    window.clearTimeout(filterTimer);
    applySearch();
  }

  //
  //------- Topic handlers -------//
  //

  // Select Topic
  // Checks the matching chip as well, so a topic set from the URL or from a
  // tag in the drawer shows as chosen. A slug with no chip falls back to All.
  function selectTopic(slug) {
    var radio = els.topics
      ? els.topics.querySelector('input[type="radio"][value="' + cssEscape(slug) + '"]')
      : null;

    if (!radio) {
      slug = '';
      radio = els.topics ? els.topics.querySelector('input[type="radio"][value=""]') : null;
    }

    if (radio) {
      radio.checked = true;
    }

    topic = slug;
    writeUrlParam('topic', topic);
    applyFilter();
  }

  // Handle Topic Change
  function handleTopicChange(event) {
    if (event.target.name !== 'glossary-topic') {
      return;
    }

    selectTopic(event.target.value);
  }

  // Css Escape
  function cssEscape(value) {
    return window.CSS && window.CSS.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
  }

  //
  //------- Drawer -------//
  //

  // Build Drawer
  // The close icon is cloned from the search field's clear button, so the
  // drawer carries the registry glyph without a second copy of its markup.
  function buildDrawer() {
    var drawer = document.createElement('dialog');
    var closeIcon = els.root.querySelector('.field-clear .svg-icn');

    drawer.id = DRAWER_ID;
    drawer.className = 'drawer glossary-drawer';
    drawer.setAttribute('data-placement', 'bottom');
    drawer.setAttribute('aria-labelledby', DRAWER_ID + '-title');
    // The header holds the term's topics (in a Scroller, one line that
    // scrolls sideways) and the close button and stays put;
    // the title and definition lead the scrolling body and leave with the
    // text. The handle is kept for the pull-down gesture; its pill is not
    // drawn (docs-site.css).
    drawer.innerHTML =
      '<div class="drawer-handle" aria-hidden="true"></div>' +
      '<div class="drawer-header">' +
        '<div class="scroller glossary-topics-scroller">' +
          '<div class="tag-group glossary-topics" data-glossary-drawer-topics></div>' +
        '</div>' +
        '<button class="button close-btn" type="button" data-icon-only data-drawer-close aria-label="Close the entry"></button>' +
      '</div>' +
      '<div class="drawer-body">' +
        '<div class="glossary-art" data-glossary-drawer-art data-os-illustration-loop hidden></div>' +
        '<div class="glossary-drawer-heading">' +
          '<h2 class="drawer-title glossary-drawer-title" id="' + DRAWER_ID + '-title" tabindex="-1" autofocus></h2>' +
          '<p class="glossary-drawer-lede" data-glossary-drawer-lede></p>' +
        '</div>' +
        '<p class="visually-hidden" role="status" data-glossary-drawer-status></p>' +
        '<div class="glossary-drawer-content" data-glossary-drawer-content></div>' +
      '</div>';

    if (closeIcon) {
      drawer.querySelector('.close-btn').appendChild(closeIcon.cloneNode(true));
    }

    drawer.addEventListener('click', handleDrawerClick);
    drawer.addEventListener('close', handleDrawerClose);
    document.body.appendChild(drawer);

    // The topics scroll sideways on one line rather than wrapping out of the
    // bar on a phone. The drawer is written after scroller.js has bound the
    // page, so bind its row here; the script watches the row's size, so the
    // tags showTopics writes later still set the edge fade.
    if (window.initScroller) {
      window.initScroller(drawer);
    }

    els.drawer = drawer;
    els.drawerTitle = drawer.querySelector('.glossary-drawer-title');
    els.drawerLede = drawer.querySelector('[data-glossary-drawer-lede]');
    els.drawerContent = drawer.querySelector('[data-glossary-drawer-content]');
    els.drawerStatus = drawer.querySelector('[data-glossary-drawer-status]');
    els.drawerBody = drawer.querySelector('.drawer-body');
    els.drawerTopics = drawer.querySelector('[data-glossary-drawer-topics]');
    els.drawerArt = drawer.querySelector('[data-glossary-drawer-art]');
  }

  // Remove Drawer
  function removeDrawer() {
    var stale = document.getElementById(DRAWER_ID);

    if (stale) {
      if (stale.open) {
        stale.close();
      }
      stale.remove();
    }

    els.drawer = null;
    opener = null;
    afterClose = null;
  }

  // Set Drawer Message
  // The text shows in the sheet and goes to the status region, which is the
  // only thing announced: the article itself is never a live region, or a
  // screen reader would queue the whole entry after the title it focused.
  // An optional next step follows the text: a link (sign in) or a button
  // that runs again (try again).
  function setDrawerMessage(text, isError, next) {
    var p = document.createElement('p');

    p.className = isError ? 'glossary-drawer-message is-error' : 'glossary-drawer-message';
    p.textContent = text;
    els.drawerContent.replaceChildren(p);

    if (next && next.href) {
      var a = document.createElement('a');

      a.className = 'text-link';
      a.href = next.href;
      a.textContent = next.text;
      p.appendChild(document.createTextNode(' '));
      p.appendChild(a);
    } else if (next && next.retry) {
      var button = document.createElement('button');

      button.className = 'button';
      button.type = 'button';
      button.setAttribute('data-variant', 'outline');
      button.textContent = next.text;
      button.addEventListener('click', next.retry);
      els.drawerContent.appendChild(button);
    }

    announce(text);
  }

  // Announce
  function announce(text) {
    if (els.drawerStatus) {
      els.drawerStatus.textContent = text;
    }
  }

  // Failure Message
  // The gate answers a fetch with 401 when the session has gone and 403 when
  // the entry is not shared with the account; each needs its own next step.
  // Signing in comes back to this term, open in the drawer.
  function failureMessage(status, slug, href) {
    if (status === 401) {
      return {
        text: 'Your session has ended, so the entry did not load.',
        next: {
          href: '/auth/login.html?next=' + encodeURIComponent(window.location.pathname + '?term=' + slug),
          text: 'Sign in again'
        }
      };
    }

    if (status === 403) {
      return { text: 'This entry is not shared with your account.', next: null };
    }

    return {
      text: 'The full entry did not load. Check your connection and try again.',
      next: {
        text: 'Try again',
        // The button is about to be replaced by the loading line, so focus
        // moves to the title first rather than dropping out of the drawer.
        retry: function retryEntry() {
          els.drawerTitle.focus({ preventScroll: true });
          loadEntry(slug, href);
        }
      }
    };
  }

  // Open Term
  // Fills the header from the card at once, then loads the article. Works for
  // a term whose card is filtered away too (a related-term hop, a shared
  // ?term= link).
  function openTerm(slug) {
    var item = findItem(slug);

    if (!item || !els.drawer) {
      return false;
    }

    var title = item.el.querySelector('.book-contents-item-title');
    var description = item.el.querySelector('.book-contents-item-description');
    var href = item.el.getAttribute('href');

    els.drawer.setAttribute('data-term', slug);
    els.drawerTitle.textContent = title ? title.textContent : slug;
    els.drawerLede.textContent = description ? description.textContent : '';
    showTopics(item.topics);
    showArt(item.el.getAttribute('data-glossary-art'));
    els.drawerBody.scrollTop = 0;

    afterClose = null;

    if (!els.drawer.open || els.drawer.classList.contains('is-closing')) {
      // Through dialog.js when it is there, so a term opened while the sheet
      // is still leaving (a related link or a shared ?term= arriving; the
      // cards behind it are inert) brings it back rather than letting it close.
      if (window.bdOpenSurface) {
        window.bdOpenSurface(els.drawer);
      } else {
        els.drawer.showModal();
      }
    } else {
      // A hop inside an open drawer: put focus back on the new title, so a
      // screen reader announces the term that replaced the old one.
      els.drawerTitle.focus();
    }

    writeUrlParam('term', slug);
    loadEntry(slug, href);

    return true;
  }

  // Show Topics
  // The term's topics as link tags, from the card at once rather than the
  // fetched entry. Each filters the index; handleDrawerClick takes the
  // click over, so it carries data-barba-prevent as the cards do.
  function showTopics(slugs) {
    var i;

    els.drawerTopics.replaceChildren();

    for (i = 0; i < slugs.length; i += 1) {
      var tag = document.createElement('a');

      tag.className = 'tag';
      tag.setAttribute('data-case', 'none');
      tag.setAttribute('data-barba-prevent', '');
      tag.href = window.location.pathname + '?topic=' + encodeURIComponent(slugs[i]);
      tag.textContent = topicNames[slugs[i]] || slugs[i];
      els.drawerTopics.appendChild(tag);
    }
  }

  // Show Art
  // The strip in the term's hue, emptied until its drawing arrives with the
  // entry (showEntry), so the height is held and nothing jumps when it lands.
  // No hue, no strip.
  function showArt(hue) {
    // Release the outgoing drawing before it is removed, so os-illustration.js
    // stops observing it now rather than at the next init.
    if (window.bdOsIllustrationLeave) {
      window.bdOsIllustrationLeave(els.drawerArt);
    }
    els.drawerArt.replaceChildren();

    if (hue) {
      els.drawerArt.setAttribute('data-color', hue);
      els.drawerArt.hidden = false;
    } else {
      els.drawerArt.removeAttribute('data-color');
      els.drawerArt.hidden = true;
    }
  }

  // Load Entry
  function loadEntry(slug, href) {
    var token = (loadToken += 1);

    if (entryCache.has(slug)) {
      showEntry(entryCache.get(slug));
      return;
    }

    els.drawerContent.setAttribute('aria-busy', 'true');
    setDrawerMessage('Loading the full entry…', false);

    fetch(href, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function readEntry(response) {
        if (!response.ok) {
          var error = new Error('HTTP ' + response.status);

          error.status = response.status;
          throw error;
        }
        return response.text();
      })
      .then(function parseEntry(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var article = doc.querySelector('main article');

        if (!article) {
          throw new Error('no article');
        }

        var entry = {
          article: prepareArticle(article, new URL(href, window.location.href)),
          art: liftArt(doc.querySelector('main .glossary-art'))
        };

        entryCache.set(slug, entry);

        if (token === loadToken) {
          showEntry(entry);
        }
      })
      .catch(function failEntry(error) {
        if (token !== loadToken) {
          return;
        }

        var message = failureMessage(error && error.status, slug, href);

        // No entry, no drawing: an empty coloured band above the message
        // would read as something still loading.
        showArt('');
        els.drawerContent.removeAttribute('aria-busy');
        setDrawerMessage(message.text, true, message.next);
      });
  }

  // Prepare Article
  // Copies the article's children into a fragment kept for the cache. Ids are
  // dropped: they would duplicate the page's own (related-terms, source) and
  // the TOC links that pointed at them are not in the drawer. Any relative
  // link is resolved against the entry page, where it was written.
  function prepareArticle(article, base) {
    var fragment = document.createDocumentFragment();
    var withIds = article.querySelectorAll('[id]');
    var links = article.querySelectorAll('a[href]');
    var i;

    // A copy button names its code block by id. Those ids are renamed into
    // the drawer, so the button still finds its block; every other id goes.
    var copyButtons = article.querySelectorAll('[data-clipboard-target^="#"]');
    var kept = {};

    for (i = 0; i < copyButtons.length; i += 1) {
      var targetId = copyButtons[i].getAttribute('data-clipboard-target').slice(1);

      kept[targetId] = DRAWER_ID + '-' + targetId;
      copyButtons[i].setAttribute('data-clipboard-target', '#' + kept[targetId]);
    }

    for (i = 0; i < withIds.length; i += 1) {
      var id = withIds[i].id;

      if (Object.prototype.hasOwnProperty.call(kept, id)) {
        withIds[i].id = kept[id];
      } else {
        withIds[i].removeAttribute('id');
      }
    }

    // The entry's own Topics section: the drawer shows the topics in its
    // header, so the copy in the text goes, with its heading.
    var topicsBlock = article.querySelector('.glossary-topics');

    if (topicsBlock) {
      var heading = topicsBlock.previousElementSibling;

      if (heading && heading.tagName === 'H2') {
        heading.remove();
      }
      topicsBlock.remove();
    }

    // The links handleDrawerClick takes over. Barba ignores defaultPrevented,
    // so without this it would navigate as well, as it would for the cards.
    var takenOver = article.querySelectorAll('a[data-glossary-related], .glossary-topics a[href]');

    for (i = 0; i < takenOver.length; i += 1) {
      takenOver[i].setAttribute('data-barba-prevent', '');
    }

    for (i = 0; i < links.length; i += 1) {
      var raw = links[i].getAttribute('href');

      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(raw)) {
        continue;
      }

      var resolved = new URL(raw, base);

      links[i].setAttribute('href', resolved.pathname + resolved.search + resolved.hash);
    }

    while (article.firstChild) {
      fragment.appendChild(document.importNode(article.firstChild, true));
      article.removeChild(article.firstChild);
    }

    return fragment;
  }

  // Lift Art
  // The drawing (and an animated one's pause button) from the entry page's
  // strip, or null when the page has none.
  function liftArt(strip) {
    if (!strip) {
      return null;
    }

    var fragment = document.createDocumentFragment();

    while (strip.firstChild) {
      fragment.appendChild(document.importNode(strip.firstChild, true));
      strip.removeChild(strip.firstChild);
    }

    return fragment;
  }

  // Show Entry
  // The cached fragments are cloned, never moved, so they survive the next
  // swap. The drawing only fills a strip openTerm has shown: the card is the
  // one that says whether the term has art. An animated drawing is handed to
  // os-illustration.js, which loops it while on screen beside its pause.
  function showEntry(entry) {
    els.drawerContent.replaceChildren(entry.article.cloneNode(true));
    els.drawerContent.removeAttribute('aria-busy');

    if (entry.art && !els.drawerArt.hidden) {
      els.drawerArt.replaceChildren(entry.art.cloneNode(true));

      if (window.initOsIllustration) {
        window.initOsIllustration(els.drawerArt);
      }
    } else if (!entry.art) {
      // The card promised a drawing the page doesn't carry (an older cached
      // page, say): drop the band rather than leave it empty.
      showArt('');
    }

    announce('');
  }

  // Handle Drawer Click
  // Two kinds of link are taken over inside the sheet: a related term swaps
  // the drawer to it, and a topic tag closes the drawer and filters the
  // index. Every other link navigates as normal; Barba closes the drawer.
  function handleDrawerClick(event) {
    if (!isPlainClick(event)) {
      return;
    }

    var related = event.target.closest('a[data-glossary-related]');

    if (related && openTerm(related.getAttribute('data-glossary-related'))) {
      event.preventDefault();
      return;
    }

    var tag = event.target.closest('.glossary-topics a[href]');

    if (tag) {
      var slug = new URL(tag.href).searchParams.get('topic') || '';

      event.preventDefault();
      // The list filters behind the sheet as it leaves; focus and the scroll
      // wait for the close (showChosenTopic). Closed through dialog.js so the
      // exit plays, rather than a bare close() that skips it.
      selectTopic(slug);
      opener = null;
      afterClose = showChosenTopic;

      if (window.bdRequestClose) {
        // A drawer-hide guard can refuse; then nothing is waiting to run.
        if (!window.bdRequestClose(els.drawer, 'topic')) {
          afterClose = null;
        }
      } else {
        els.drawer.close();
      }
    }

    // Any other link leaves the glossary through Barba. Barba records the
    // visit after this listener (it listens on document), so clearing ?term=
    // now means Back returns to the index, not to a drawer reopening in the
    // middle of the arrival animation.
    if (!event.defaultPrevented && event.target.closest('a[href]')) {
      writeUrlParam('term', '');
    }
  }

  // Show Chosen Topic
  // Focus on the chip just chosen rather than on a card the filter may have
  // hidden, and the list from the start: the chosen chip, the count and the
  // first cards, not the spot far down where the card that was opened sat.
  // Smooth or instant per the page's scroll-behavior, which honours reduced
  // motion.
  function showChosenTopic() {
    var chip = els.topics ? els.topics.querySelector('input[name="glossary-topic"]:checked') : null;

    if (chip) {
      chip.focus({ preventScroll: true });
    }

    (els.topicFilter || els.list).scrollIntoView({ block: 'start' });
  }

  // Handle Drawer Close
  // Native <dialog> returns focus to whatever was focused at showModal(), and
  // after an in-place hop or a filter that is no longer the right place.
  function handleDrawerClose(event) {
    // close fires a task after close(), so a drawer removed by a later init
    // reports in when els already belongs to the next page.
    if (event.currentTarget !== els.drawer) {
      return;
    }

    loadToken += 1;
    els.drawer.removeAttribute('data-term');

    // Barba closes the drawer on its way out; by then the URL is the next
    // page's and the page is animating away, so neither the URL nor focus
    // is this module's to touch.
    if (leaving || !els.root || !els.root.isConnected) {
      opener = null;
      afterClose = null;
      return;
    }

    writeUrlParam('term', '');

    if (afterClose) {
      var next = afterClose;

      afterClose = null;
      opener = null;
      next();
      return;
    }

    // The card it opened from, unless the filter has hidden it (a shared
    // ?term= link under a ?topic=); then the search field, never <body>.
    var target = opener && opener.isConnected && !opener.closest('.is-hidden') ? opener : els.search;

    opener = null;

    var active = document.activeElement;

    if (target && active !== target && !(active && active.closest('[data-glossary-topics]'))) {
      target.focus({ preventScroll: true });
    }
  }

  // Is Plain Click
  function isPlainClick(event) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  // Handle Card Click
  function handleCardClick(event) {
    var card = event.target.closest('[data-glossary-term]');

    if (!card || !isPlainClick(event)) {
      return;
    }

    event.preventDefault();
    opener = card;
    openTerm(card.getAttribute('data-glossary-term'));
  }

  //
  //------- Initialize -------//
  //

  // Handle Before Nav
  function handleBeforeNav() {
    leaving = true;
  }

  function initGlossary(container) {
    leaving = false;

    if (!window.__glossaryNavBound) {
      window.__glossaryNavBound = true;
      document.addEventListener('bd:before-nav', handleBeforeNav);
    }

    window.clearTimeout(filterTimer);
    window.clearTimeout(countTimer);
    loadToken += 1;

    // A drawer from an earlier visit to the glossary is rebuilt fresh, so it
    // never points at cards from a container that has gone.
    removeDrawer();

    if (!cacheElements(container)) {
      // A page without the glossary: hand back the rail's observers so a
      // Barba departure does not leave them firing against detached DOM.
      if (window.azIndex) {
        window.azIndex.reset();
      }
      return;
    }

    query = '';
    topic = '';
    indexItems();
    indexTopics();
    buildDrawer();

    els.search.addEventListener('input', handleSearchInput);
    els.search.addEventListener('search', handleSearchEvent);
    els.search.addEventListener('keydown', handleSearchKeydown);
    els.list.addEventListener('click', handleCardClick);

    if (els.topics) {
      els.topics.addEventListener('change', handleTopicChange);
    }

    // The controls ship hidden so a page without JS never offers a dead
    // search field, a filter that filters nothing, or an empty rail stripe.
    (els.search.closest('.field') || els.search).classList.remove('is-hidden');

    if (els.topicFilter) {
      els.topicFilter.classList.remove('is-hidden');
    }

    // Topic from the URL first (a shared link, a tag on an entry page). This
    // runs the first filter pass, which builds the rail and syncs the count.
    selectTopic(readUrlParam('topic'));

    // Sync the count at once, a straight write rather than the debounce:
    // nothing has been announced yet.
    window.clearTimeout(countTimer);
    if (els.count) {
      var visible = els.list.querySelectorAll('[data-glossary-term]:not(.is-hidden)').length;

      els.count.textContent = visible === items.length
        ? items.length + ' terms'
        : visible + ' of ' + items.length + ' terms';
    }

    var term = readUrlParam('term');
    var termItem = term ? findItem(term) : null;

    // Arriving on a shared link, the card is where focus belongs on close.
    opener = termItem ? termItem.el : null;

    if (term && !openTerm(term)) {
      // A term that is not in the index (unpublished, renamed) leaves no
      // stale parameter behind.
      writeUrlParam('term', '');
    }

    console.log('glossary.js v' + VERSION + ' initialised');
  }

  window.initGlossary = initGlossary;
})();
