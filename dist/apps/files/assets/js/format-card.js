/**
 * format-card.js — the format card (cms/format-card.md).
 *
 * One format from the registry (assets/data/formats/), drawn live through
 * layer-stack.js: the drawing, its layer switches, its size and ratio,
 * Download PNG and Open in the Format Library. Three hosts, one renderer:
 *
 *   - a page's {{format: <id>}} tag: the generator writes a shell, a
 *     [data-format-card] element holding the format as JSON, its icons in a
 *     <template> and the artwork as a plain <img> for a reader without
 *     scripts; initFormatCards() builds the card inside it;
 *   - the public embed (tools/formats-embed.html): formats-embed.js builds
 *     the same shell from the URL and calls initFormatCards();
 *   - the Format Library's grid: createTile() makes the card's tile variant,
 *     a <button> with the artwork as a still picture, so the tool's tiles
 *     and the cards share one markup and one stylesheet (docs-site.css,
 *     Format card).
 *
 * Every card keeps its own state: its own parsed spec, ids from a counter,
 * its own ResizeObserver. Nothing is shared between two cards on a page.
 * Released on bd:before-nav for the outgoing container, as
 * cms/js-code-structure.md asks.
 *
 * The shell's attributes:
 *   data-show  the switches shown, space separated; "none" for no switches;
 *              absent for every layer the format has
 *   data-on    which shown switches start on; absent for the registry's
 *              own starting state (Artwork and App screen)
 *
 * @version 1.3.1
 */
(function () {
  'use strict';

  // The engine's words in this site's locale: bd-locale.js, which the docs
  // kit writes and loads first on a site that isn't en-GB. Without it, the
  // words as written.
  function L(text) { return window.bdLocale ? window.bdLocale.text(text) : text; }

  var VERSION = '1.3.1';
  console.log('[format-card] v' + VERSION + ' loaded');

  var SELECTOR = '[data-format-card]';
  var TOOL_PATH = '/tools/formats.html';
  var LAYERS = ['artwork', 'safe-area', 'app-screen', 'profile-grid', 'profile', 'measurements'];
  /* Ids no longer drawn (decision 24): an old tag or embed URL keeps
     working. A renamed id becomes its new name, and is then checked like
     any other; a removed one (null) is dropped. Cropped area went on
     10 November, when each view took its own crop (decision 37). */
  var RENAMED = { 'cut-off': null, 'cropped-area': null, 'app-interface': 'app-screen', guides: null };

  /* A list with old ids brought forward; null stays null. 'emptied' when
     every name was an old one that is gone. */
  function renameList(list) {
    if (!list) return list;
    var out = [];
    var dropped = false;
    list.forEach(function bringForward(id) {
      if (!Object.prototype.hasOwnProperty.call(RENAMED, id)) { out.push(id); return; }
      if (RENAMED[id]) out.push(RENAMED[id]);
      else dropped = true;
    });
    return out.length || !dropped ? out : 'emptied';
  }

  var counter = 0;
  var instances = [];

  //
  //------- DATA -------//
  //

  function sizeText(canvas) {
    var size = canvas.w + ' × ' + canvas.h;
    if (canvas.kind === 'min') return 'at least ' + size;
    if (canvas.kind === 'range' && canvas.maxW && canvas.maxH) return size + ' to ' + canvas.maxW + ' × ' + canvas.maxH;
    return size;
  }

  /* "artwork, safe-area", "artwork safe-area" or "artwork,safe-area": a
     list either way, so the tag and a URL read the same. */
  function parseList(value) {
    if (value === null || value === undefined) return null;
    return String(value).split(/[\s,]+/).filter(Boolean);
  }

  /* What each layer shows, one line each (format-guide.md, owner's brief of
     2 November). Opened by an info button beside the switch, as the Colour
     Pairing tool's checks are: a note in place, not a tooltip, because
     tooltips do not open on touch and partners check specs on phones. */
  var LAYER_INFO = {
    artwork: 'Your artwork, as it downloads. Export with every other layer off: they are a guide, not part of the file you post.',
    'safe-area': L('Where text and logos are seen in every view. Green is fine. A green cross marks its middle when it sits off-centre: centre a logo on the cross, not on the file. It is off in the Profile grid view, where the grid crops the file anyway.'),
    'app-screen': 'What the app shows on top while the post plays or opens: names, buttons, captions, the reply bar. Anything the screen trims away is masked out.',
    'profile-grid': 'How the file looks as a tile on a profile: the pin, Reel or carousel icon, the view count. The tile is cropped as the grid crops it, so Safe area is off in this view.',
    profile: 'How the file looks in its circle: the corners are masked out, as the app shows it.',
    measurements: 'How far from each edge to keep clear, in pixels, for anyone working without the template.'
  };

  /* A switch's note behind its info button: a Dropdown content panel
     (cms/dropdown.md, Content panel) that opens under the button and floats
     over what is below, so the switches never move (owner, 2026-11-09,
     Experiment C option B). dropdown.js opens, places and closes it: a
     click outside, Escape or focus leaving closes it. The panel is not a
     menu, so it has no role and the trigger no aria-haspopup. iconNode is
     the info-circled icon, or null to fall back to a lettered button.
     Returns the .dropdown to append to the switch's row, or null. */
  function layerInfo(id, label, iconNode) {
    if (!LAYER_INFO[id]) return null;
    var dropdown = document.createElement('div');
    dropdown.className = 'dropdown format-layer-info';
    dropdown.setAttribute('data-placement', 'bottom-end');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'dropdown-trigger button';
    button.setAttribute('data-variant', 'transparent');
    button.setAttribute('data-icon-only', '');
    button.setAttribute('data-size', 'xsmall');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'About ' + label);
    if (iconNode) button.appendChild(iconNode);
    else button.textContent = 'i';
    var panel = document.createElement('div');
    panel.className = 'dropdown-menu';
    panel.setAttribute('data-variant', 'panel');
    panel.tabIndex = -1;
    var note = document.createElement('p');
    note.className = 'text-size-s';
    note.textContent = LAYER_INFO[id];
    panel.appendChild(note);
    dropdown.appendChild(button);
    dropdown.appendChild(panel);
    return dropdown;
  }

  /* The switch ids a format's spec has, bottom to top. */
  function formatLayers(format) {
    return (format.spec && format.spec.layers || [])
      .filter(function isGroup(entry) { return entry.type === 'group'; })
      .map(function idOf(entry) { return entry.id; });
  }

  /* What a card will show, or why it cannot: the same rules the generator
     holds for the tag (cms/generator/format-card.js). Returns
     { show, on } or { error }. */
  function resolveLayers(format, showList, onList) {
    var has = formatLayers(format);
    showList = renameList(showList);
    onList = renameList(onList);
    if (showList === 'emptied') showList = ['none'];
    if (onList === 'emptied') onList = null;
    if (showList && !showList.length) return { error: 'show is empty. Write show="none" for no switches, or leave it out for every switch.' };
    if (onList && !onList.length) return { error: 'on is empty. Leave it out for the registry\'s starting state.' };
    // "none none" is still none; "none" beside a layer name is a mistake.
    var none = !!showList && showList.every(function isNone(id) { return id === 'none'; });
    if (showList && !none && showList.indexOf('none') !== -1) return { error: 'show="none" cannot be combined with layer names.' };
    if (none && onList) return { error: 'on="' + onList.join(' ') + '" names a switch that show leaves out.' };
    var show = none ? [] : (showList || has.slice());
    var named = show.concat(onList || []);
    for (var i = 0; i < named.length; i += 1) {
      if (LAYERS.indexOf(named[i]) === -1) return { error: '"' + named[i] + '" is not a layer. The layers are ' + LAYERS.join(', ') + '.' };
      if (has.indexOf(named[i]) === -1) return { error: 'The ' + format.name + ' has no "' + named[i] + '" layer. It has ' + has.join(', ') + '.' };
    }
    if (onList) {
      for (var j = 0; j < onList.length; j += 1) {
        if (show.indexOf(onList[j]) === -1) return { error: 'on="' + onList[j] + '" names a switch that show leaves out.' };
      }
      // Views show one at a time, so on can start one of them, not two.
      var views = (format.spec.layers || []).filter(function startsView(g) { return g.type === 'group' && g.view && onList.indexOf(g.id) !== -1; });
      var clash = views.some(function twice(g, i) { return views.some(function earlier(o, k) { return k < i && o.view === g.view; }); });
      if (clash) return { error: 'on names two views (' + views.map(function idOf(g) { return g.id; }).join(', ') + '); they show one at a time, so start one.' };
    }
    // Keep the registry's order whatever order the list was written in.
    show = has.filter(function shown(id) { return show.indexOf(id) !== -1; });
    return { show: show, on: onList };
  }

  //
  //------- DRAWING -------//
  //

  /* Draw a parsed spec into an <svg>, put its labels over it, and keep the
     <title> the render removes. Shared with the Format Library. */
  function draw(svg, labels, spec, scope) {
    var title = svg.querySelector('title');
    var result = window.LayerStack.render(svg, spec, { scope: scope });
    if (title) svg.insertBefore(title, svg.firstChild);
    window.LayerStack.placeLabels(labels, result, 'layer-stack-label');
    return result;
  }

  /* Size the stage to the largest box of the view's ratio that fits its
     area, in px, as Layout Specs does. */
  function fit(stage, area, result) {
    if (!result) return;
    var view = result.view;
    var style = window.getComputedStyle(area);
    var aw = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    var ah = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (!(aw > 0) || !(ah > 0) || !(view.w > 0) || !(view.h > 0)) return;
    var k = Math.min(aw / view.w, ah / view.h);
    stage.style.width = Math.floor(view.w * k) + 'px';
    stage.style.height = Math.floor(view.h * k) + 'px';
  }

  //
  //------- THE TILE -------//
  //

  /* The card's tile variant for the Format Library's grid: a <button>, so it
     holds no controls of its own; the artwork as a still picture, so a grid
     of a hundred formats draws nothing until one is opened. */
  function createTile(format, platformLabel) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'format-card';
    tile.setAttribute('data-variant', 'tile');
    // The name first: in DOM order the ratio badge would lead it.
    tile.setAttribute('aria-label', format.name + ', ' + platformLabel + ', ' + sizeText(format.canvas) + ', ' + format.canvas.ratio);

    var preview = document.createElement('span');
    preview.className = 'format-card-preview';
    // The tools' fixed light ground (tools.css, Grounds): artwork is shown
    // as it will be posted, whatever the site theme.
    preview.setAttribute('data-ground', 'light');
    var img = document.createElement('img');
    img.className = 'format-card-picture';
    img.src = format.artwork.src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = format.canvas.w;
    img.height = format.canvas.h;
    // A mark linked rather than downloaded (a logo from the logo kit) is
    // drawn small on its canvas, as the spec places it.
    if (!format.artwork.download) img.setAttribute('data-inset', '');
    preview.appendChild(img);
    preview.appendChild(ratioBadge(format));

    var body = document.createElement('span');
    body.className = 'format-card-body';
    body.appendChild(textNode('span', 'format-card-title', format.name));
    body.appendChild(textNode('span', 'format-card-meta', platformLabel + ' · ' + sizeText(format.canvas)));

    tile.appendChild(preview);
    tile.appendChild(body);
    return tile;
  }

  function textNode(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  /* The tile's ratio, in the picture's corner. The card shows it as a spec
     row instead. */
  function ratioBadge(format) {
    return textNode('span', 'badge format-card-ratio', format.canvas.ratio);
  }

  /* The facts as label and value rows: a dl of div rows, as the Format
     Library's Spec reads. */
  function specList(rows) {
    var list = document.createElement('dl');
    list.className = 'format-card-specs';
    rows.forEach(function addRow(row) {
      var item = document.createElement('div');
      item.appendChild(textNode('dt', '', row[0]));
      item.appendChild(textNode('dd', '', row[1]));
      list.appendChild(item);
    });
    return list;
  }

  //
  //------- THE CARD -------//
  //

  function readData(card) {
    var node = card.querySelector('script[data-format-card-data]');
    if (!node) return null;
    try {
      var data = JSON.parse(node.textContent);
      return data && data.format && data.format.spec ? data : null;
    } catch (error) {
      console.error('[format-card] the card data is not JSON', error);
      return null;
    }
  }

  function icon(card, name) {
    var template = card.querySelector('template[data-format-card-icons]');
    var found = template && template.content.querySelector('[data-icon="' + name + '"]');
    return found ? found.cloneNode(true) : null;
  }

  function linkButton(card, opts) {
    var a = document.createElement('a');
    a.className = 'button';
    a.setAttribute('data-size', 'small');
    if (opts.variant) a.setAttribute('data-variant', opts.variant);
    a.href = opts.href;
    if (opts.download) {
      a.setAttribute('download', opts.download);
      // A file, not a page: Barba must not try to load it.
      a.setAttribute('data-barba-prevent', '');
    }
    if (opts.target) {
      a.target = opts.target;
      a.rel = 'noopener';
    }
    var glyph = icon(card, opts.icon);
    if (glyph) a.appendChild(glyph);
    a.appendChild(textNode('span', '', opts.label));
    if (opts.hidden) a.appendChild(textNode('span', 'visually-hidden', opts.hidden));
    if (opts.target) a.appendChild(textNode('span', 'visually-hidden', ' (opens in a new tab)'));
    return a;
  }

  /* The drawing's name: the artwork's own description, and which layers
     are drawn over it, so a reader who cannot see it hears what a sighted
     reader sees. */
  function describe(instance) {
    var shown = window.LayerStack.toggles(instance.spec)
      .filter(function drawn(t) { return t.group && t.visible && !t.disabled; }).reverse();
    var on = shown.map(function label(t) { return t.label; });
    var cropped = instance.spec.layers.filter(function crops(entry) {
      return entry.type === 'group' && entry.visible !== false && entry.crop;
    }).map(function cropText(entry) { return ' Cropped as ' + entry.label + ' shows it.'; }).join('');
    instance.title.textContent = instance.format.name + ', ' + sizeText(instance.format.canvas) + '. ' +
      instance.format.artwork.alt + '. ' + (on.length ? 'Layers shown: ' + on.join(', ') + '.' : 'No layers shown.') + cropped;
  }

  function build(card, data) {
    var format = data.format;
    var resolved = resolveLayers(format, parseList(card.getAttribute('data-show')), parseList(card.getAttribute('data-on')));
    if (resolved.error) {
      console.error('[format-card] ' + format.id + ': ' + resolved.error);
      return null;
    }
    var spec;
    try {
      spec = window.LayerStack.parseSpec(format.spec);
    } catch (error) {
      console.error('[format-card] cannot read the spec for ' + format.id, error);
      return null;
    }
    if (resolved.on) {
      resolved.show.forEach(function setStart(id) {
        window.LayerStack.setVisible(spec, id, resolved.on.indexOf(id) !== -1);
      });
    }
    // A view with no switch on this card must not switch off one that has:
    // the reader would see a dead switch with nothing to undo it.
    spec.layers.forEach(function hiddenBlocker(entry) {
      if (entry.type !== 'group' || entry.visible === false || resolved.show.indexOf(entry.id) !== -1) return;
      var blocksShown = (entry.disables || []).some(function shown(id) { return resolved.show.indexOf(id) !== -1; });
      if (blocksShown) window.LayerStack.setVisible(spec, entry.id, false);
    });

    counter += 1;
    var uid = 'fc' + counter;

    var preview = document.createElement('div');
    preview.className = 'format-card-preview';
    var stage = document.createElement('div');
    stage.className = 'format-card-stage';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'format-card-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', uid + '-title');
    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.id = uid + '-title';
    svg.appendChild(title);
    var labels = document.createElement('div');
    labels.className = 'format-card-labels';
    labels.setAttribute('aria-hidden', 'true');
    stage.appendChild(svg);
    stage.appendChild(labels);
    preview.appendChild(stage);

    var body = document.createElement('div');
    body.className = 'format-card-body';
    body.appendChild(textNode('p', 'format-card-title', format.name));
    body.appendChild(specList([
      ['Platform', data.platform],
      ['Size', sizeText(format.canvas) + ' px'],
      ['Ratio', format.canvas.ratio]
    ]));

    if (resolved.show.length) {
      var fieldset = document.createElement('fieldset');
      fieldset.className = 'format-card-layers';
      fieldset.setAttribute('data-variant', 'bare');
      fieldset.appendChild(textNode('legend', 'visually-hidden', 'Layers on the ' + format.name));
      // Listed as a layers panel lists a stack: the top layer first,
      // Artwork last. show keeps the registry's draw order (bottom to top),
      // so it is reversed here (owner, 2026-11-09).
      resolved.show.slice().reverse().forEach(function addSwitch(id) {
        var entry = spec.layers.filter(function match(item) { return item.id === id; })[0];
        var row = document.createElement('div');
        row.className = 'form-toggle';
        row.setAttribute('data-variant', 'mono');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('role', 'switch');
        input.id = uid + '-' + id;
        input.value = id;
        input.checked = entry.visible !== false;
        var label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = entry.label;
        // Name, its info button, then the switch: the order a reader tabs
        // through is the order the row reads in (owner, 2026-11-09).
        var info = layerInfo(id, entry.label, icon(card, 'info-circled'));
        row.appendChild(label);
        if (info) row.appendChild(info);
        row.appendChild(input);
        fieldset.appendChild(row);
      });
      // Says what else a switch changed: a view turns the others off.
      var status = document.createElement('p');
      status.className = 'visually-hidden';
      status.setAttribute('role', 'status');
      fieldset.appendChild(status);
      body.appendChild(fieldset);
    }

    var actions = document.createElement('div');
    actions.className = 'button-group format-card-actions';
    if (format.artwork.download) {
      var ext = (format.artwork.src.match(/\.(\w+)$/) || [])[1] || 'png';
      actions.appendChild(linkButton(card, {
        href: format.artwork.src, icon: 'download', label: 'Download',
        // Named in full for a screen reader's links list, where several
        // cards would otherwise read as several identical "Download"s.
        hidden: ' ' + format.name + ', ' + ext.toUpperCase(),
        download: format.id.replace('/', '-') + '-' + format.canvas.w + 'x' + format.canvas.h + '.' + ext
      }));
    }
    actions.appendChild(linkButton(card, {
      href: TOOL_PATH + '?format=' + encodeURIComponent(format.id), icon: 'arrow-up-right', label: 'Open in the Format Library',
      variant: 'outline', target: card.hasAttribute('data-format-card-external') ? '_blank' : ''
    }));
    body.appendChild(actions);

    // The shell's fallback picture goes; the drawing takes its place.
    Array.prototype.forEach.call(card.querySelectorAll('.format-card-fallback'), function drop(node) { node.remove(); });
    // One wrapper for the two, so the card can lay them side by side from
    // its own width: a container query styles a container's descendants,
    // never the container (docs-site.css, Format Card).
    var layout = document.createElement('div');
    layout.className = 'format-card-layout';
    layout.appendChild(preview);
    layout.appendChild(body);
    card.appendChild(layout);
    card.setAttribute('data-shape', format.canvas.h > format.canvas.w ? 'tall' : format.canvas.h < format.canvas.w ? 'wide' : 'square');
    card.setAttribute('aria-label', format.name + ', ' + data.platform);
    card.setAttribute('role', 'group');

    return { card: card, format: format, spec: spec, status: status || null, preview: preview, stage: stage, svg: svg, title: title, labels: labels, result: null, observer: null };
  }

  function redraw(instance) {
    try {
      instance.result = draw(instance.svg, instance.labels, instance.spec, instance.stage);
    } catch (error) {
      console.error('[format-card] render failed for ' + instance.format.id, error);
      return;
    }
    describe(instance);
    fit(instance.stage, instance.preview, instance.result);
  }

  /* Bring a set of switches in line with the spec after any change: a view
     turned on turns the others of its name off, and a view can switch a
     layer off while it shows (Profile grid hides Safe area). A blocked
     switch reads off, since its layer is not drawn, with a hint under its
     row saying why; the choice itself stays in the spec and comes back
     when the view closes. Returns what changed beyond the switch the
     reader touched, for the caller to announce. The tool and the card both
     call this, so they cannot drift apart. */
  function syncSwitches(host, spec, touched) {
    var state = {};
    var changes = [];
    window.LayerStack.toggles(spec).forEach(function keep(t) { state[t.id] = t; });
    Array.prototype.forEach.call(host.querySelectorAll('input[type="checkbox"]'), function sync(input) {
      var t = state[input.value];
      if (!t) return;
      var checked = t.visible && !t.disabled;
      var blockedBy = t.disabled ? blockerLabel(spec, t.id) : '';
      if (input !== touched) {
        if (t.disabled && !input.disabled) changes.push(t.label + ' unavailable in ' + blockedBy);
        else if (!t.disabled && input.disabled) changes.push(t.label + ' available');
        else if (checked !== input.checked) changes.push(t.label + (checked ? ' on' : ' off'));
      }
      input.checked = checked;
      input.disabled = t.disabled;
      setHint(input, t.disabled ? 'Off in ' + blockedBy : '');
    });
    return changes;
  }

  /* The label of the showing view that switches a layer off. */
  function blockerLabel(spec, id) {
    var by = spec.layers.filter(function blocks(entry) {
      return entry.type === 'group' && entry.visible !== false && Array.isArray(entry.disables) && entry.disables.indexOf(id) !== -1;
    })[0];
    return by ? by.label : 'this view';
  }

  /* A line under a switch's row, tied to the switch, or none. */
  function setHint(input, text) {
    var row = input.closest('.form-toggle') || input.parentNode;
    var id = input.id + '-hint';
    var hint = row.nextElementSibling && row.nextElementSibling.id === id ? row.nextElementSibling : null;
    if (!text) {
      if (hint) hint.remove();
      input.removeAttribute('aria-describedby');
      return;
    }
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'form-hint';
      hint.id = id;
      row.parentNode.insertBefore(hint, row.nextSibling);
    }
    hint.textContent = text;
    input.setAttribute('aria-describedby', id);
  }

  /* Say it, politely: clear first so the same words are read again. */
  function announceIn(region, text) {
    if (!region || !text) return;
    region.textContent = '';
    window.setTimeout(function write() { region.textContent = text; }, 50);
  }

  function handleChange(event) {
    var input = event.target;
    if (!input || input.type !== 'checkbox') return;
    var card = input.closest(SELECTOR);
    var instance = instances.filter(function mine(item) { return item.card === card; })[0];
    if (!instance) return;
    window.LayerStack.setVisible(instance.spec, input.value, input.checked);
    announceIn(instance.status, syncSwitches(instance.card, instance.spec, input).join('. '));
    redraw(instance);
  }

  function mount(card) {
    if (card.dataset.formatCardInit) return;
    card.dataset.formatCardInit = 'true';
    var data = readData(card);
    if (!data) return;
    var instance = build(card, data);
    if (!instance) {
      card.setAttribute('data-state', 'error');
      return;
    }
    syncSwitches(card, instance.spec);
    card.addEventListener('change', handleChange);
    if (window.ResizeObserver) {
      instance.observer = new ResizeObserver(function refit() { fit(instance.stage, instance.preview, instance.result); });
      instance.observer.observe(instance.preview);
    }
    instances.push(instance);
    redraw(instance);
  }

  function subjects(scope) {
    var root = scope || document;
    return root.matches && root.matches(SELECTOR) ? [root] : Array.prototype.slice.call(root.querySelectorAll(SELECTOR));
  }

  function initFormatCards(scope) {
    if (!window.LayerStack) return;
    subjects(scope).forEach(mount);
  }

  /* Observers and listeners only: the cards stay on screen through the
     leave animation, so nothing visual changes here. */
  function releaseFormatCards(scope) {
    var root = scope || document;
    instances = instances.filter(function keep(instance) {
      var inside = root === instance.card || (root.contains && root.contains(instance.card));
      if (!inside) return true;
      if (instance.observer) instance.observer.disconnect();
      instance.card.removeEventListener('change', handleChange);
      return false;
    });
  }

  window.FormatCard = {
    LAYERS: LAYERS,
    RENAMED: RENAMED,
    layerInfo: layerInfo,
    syncSwitches: syncSwitches,
    announceIn: announceIn,
    sizeText: sizeText,
    parseList: parseList,
    resolveLayers: resolveLayers,
    draw: draw,
    fit: fit,
    createTile: createTile,
    init: initFormatCards,
    release: releaseFormatCards
  };

  //
  //------- INITIALIZE -------//
  //

  function handleDomReady() {
    initFormatCards();
  }

  function handleAfterNav(event) {
    initFormatCards(event.detail && event.detail.container);
  }

  function handleBeforeNav(event) {
    releaseFormatCards(event.detail && event.detail.container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    initFormatCards();
  }

  document.addEventListener('bd:after-nav', handleAfterNav);
  document.addEventListener('bd:before-nav', handleBeforeNav);
})();
