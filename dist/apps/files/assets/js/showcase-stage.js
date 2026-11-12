/**
 * Script Purpose: Showcase stage — put one asset on a social frame, scaled up, with its layers
 * Author: By Default Studio
 * Version: 1.1.0
 * Last Updated: 2026-10-13
 */

(function () {
  'use strict';

  var VERSION = '1.1.0';
  console.log('[showcase-stage] v' + VERSION + ' loaded');

  /**
   * The stage is the one renderer every Showcase page shares: the public feed,
   * a post page, the edit view and the export script's render view. Each of
   * them hands it an asset (the JSON docgen inlines from cms/showcase/) and it
   * builds the same frame, so what the editor previews is what the feed shows
   * and what the export captures.
   *
   * Two scales, never confused:
   *   - the ARTWORK scale enlarges the component inside the frame. It is part
   *     of the asset, and the export keeps it.
   *   - the VIEW scale fits the whole frame into the space the page gives it.
   *     It is never exported: the render view runs at view scale 1.
   * Both are CSS transforms. The Phase 0 spike (handovers/HANDOVER-showcase.md)
   * confirmed a transformed dropdown keeps its menu attached and rasterises
   * crisp, because the menu is positioned by CSS inside the component.
   *
   * Every getBoundingClientRect inside the frame is in SCREEN pixels. Anything
   * placed in frame coordinates (annotations, the cursor) divides by the view
   * scale — see frameBox().
   *
   * The markup is the asset's own, from the repo. Overrides from the edit view
   * (worker/showcase.js) change settings only, never markup, so nothing
   * user-supplied is ever written as HTML here.
   *
   * Layer: app (CLAUDE.md §17).
   */

  // Component modules that bind per element rather than by delegation. Each
  // is called on the artwork after every mount; each guards against binding
  // twice. Dropdown, copy buttons and the rest delegate from document and need
  // nothing.
  var COMPONENT_INITS = [
    'initTabs',
    'initAccordion',
    'initChip',
    'initRating',
    'initField',
    'initDialog',
    'initDatePicker',
    'initPasswordToggle',
    'initCellInput',
  ];

  var ANNOTATIONS_LAYER = 'annotations';
  // A Layout Spec's layers join the asset's switches under this prefix
  // (cms/generator/showcase.js, specToggles).
  var SPEC_PREFIX = 'spec-';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * The frames and grounds, from the page's #showcase-config block. Docgen
   * writes it from cms/generator/showcase.js, which is the one copy.
   */
  function readConfig() {
    var node = document.getElementById('showcase-config');
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (err) {
      console.error('[showcase-stage] #showcase-config is not valid JSON', err);
      return null;
    }
  }

  /**
   * An inline icon the page carries in #showcase-icons, cloned. Brand icons
   * only (CLAUDE.md §3); docgen expands them, so the script never holds SVG.
   */
  function icon(name) {
    var holder = document.getElementById('showcase-icons');
    var source = holder && holder.content
      ? holder.content.querySelector('[data-icon="' + name + '"]')
      : null;
    return source ? source.cloneNode(true) : null;
  }

  // The drawn cursor's shapes (assets/images/cursors/), in the same template
  // as the icons, cloned by data-cursor. Fixed artwork, not a brand icon.
  var CURSOR_SHAPES = ['arrow', 'pointer'];

  function cursorArt(name) {
    var holder = document.getElementById('showcase-icons');
    var source = holder && holder.content
      ? holder.content.querySelector('[data-cursor="' + name + '"]')
      : null;
    return source ? source.cloneNode(true) : null;
  }

  // What a real pointer turns into over a part: the hand over anything that
  // takes a click, the arrow elsewhere. Only the artwork counts, so a part
  // never inherits the hand from something around the frame.
  var POINTER_TARGETS = 'a[href], button, summary, label, input, select, textarea, '
    + '[role="button"], [role="option"], [role="tab"], [role="switch"], [role="menuitem"], '
    + '[role="menuitemradio"], [role="menuitemcheckbox"], [tabindex]:not([tabindex="-1"])';

  function cursorShape(target, within) {
    var hit = target.closest(POINTER_TARGETS);
    return hit && within.contains(hit) ? 'pointer' : 'arrow';
  }

  /** A CSS time ("200ms", ".2s") as a number of ms. */
  function durationMs(value) {
    var text = String(value || '').trim();
    var number = parseFloat(text) || 0;
    return text.indexOf('ms') > -1 ? number : number * 1000;
  }

  function humanise(id) {
    var words = id.replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Build a stage for one asset inside `host`.
   *
   * @param {HTMLElement} host
   * @param {object} asset     the inlined asset: settings plus `html`
   * @param {object} config    { frames, backgrounds }
   * @param {object} [options]
   * @param {string} [options.frame]       which of the asset's frames to show
   * @param {boolean} [options.fitHeight]  also fit the frame to the host's
   *                                       height (the edit view's preview)
   * @param {boolean} [options.fixed]      view scale 1, no fitting (export)
   * @returns {object} the stage
   */
  function mount(host, asset, config, options) {
    options = options || {};
    var settings = clone(asset);
    var frameName = options.frame && settings.frames.indexOf(options.frame) > -1
      ? options.frame
      : settings.frames[0];

    var viewport = document.createElement('div');
    viewport.className = 'showcase-viewport';

    var frame = document.createElement('div');
    frame.className = 'showcase-frame';
    // A picture of a component, as a group. The components inside stay
    // reachable, because the feed and post pages let people use them. On
    // those pages the card is already named by the title (its heading), so
    // the group is named for its job rather than saying the title twice;
    // the edit view and the render view have no card, and take the title.
    frame.setAttribute('role', 'group');
    frame.setAttribute('aria-label', host.closest('.showcase-post') ? 'Live component' : settings.title);

    var safe = document.createElement('div');
    safe.className = 'showcase-safe';

    var art = document.createElement('div');
    art.className = 'showcase-art';
    safe.appendChild(art);

    // The Layout Spec overlay (Phase 9): the rules a frame lives by, such as
    // the platform interface that will cover it, drawn by LayerStack over
    // the artwork and under the annotations. Read only: layers are made in
    // Layout Specs (handovers/HANDOVER-showcase.md, D10).
    var specSvg = document.createElementNS(SVG_NS, 'svg');
    specSvg.setAttribute('class', 'showcase-spec');
    specSvg.setAttribute('aria-hidden', 'true');
    specSvg.setAttribute('focusable', 'false');

    // The notes carry text that says something ("Header", "Active tab"),
    // so they stay in the accessibility tree while shown; hidden, they are
    // gone from it with the layer.
    var notes = document.createElement('div');
    notes.className = 'showcase-notes';
    notes.setAttribute('data-layer', ANNOTATIONS_LAYER);

    // While the auto-play runs the artwork is inert (showcase-player.js), so
    // a screen reader finds the group empty; this says why, and how to get
    // the component back. Shown only while playing.
    var cue = document.createElement('p');
    cue.className = 'visually-hidden';
    cue.textContent = 'The demo is playing. Pause it to use the component.';
    cue.hidden = true;

    // The drawn cursor holds both drawings (assets/images/svg-cursors/,
    // inlined by the generator next to the icons); data-cursor on it says
    // which shows: the arrow, or the hand when the part it glides to is one
    // a real pointer turns into a hand over. The shape is set as the glide
    // starts, so the tip's offset and the position change together.
    var cursor = document.createElement('div');
    cursor.className = 'showcase-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.setAttribute('data-cursor', 'arrow');
    CURSOR_SHAPES.forEach(function addShape(name) {
      var art = cursorArt(name);
      if (art) cursor.appendChild(art);
    });
    var pressTimer = null;

    frame.appendChild(cue);
    frame.appendChild(safe);
    frame.appendChild(specSvg);
    frame.appendChild(notes);
    frame.appendChild(cursor);
    viewport.appendChild(frame);
    host.appendChild(viewport);

    var stage = {
      host: host,
      asset: asset,
      settings: settings,
      config: config,
      frameName: frameName,
      viewScale: 1,
      artScale: 1,
      el: { viewport: viewport, frame: frame, safe: safe, art: art, spec: specSvg, notes: notes, cursor: cursor, cue: cue },
    };

    // Parsed specs by frame, made once: LayerStack repairs a stored spec on
    // the way in and visibility is set on the parsed copy.
    var specs = {};

    var resizeObserver = null;
    var artObserver = null;
    var noteFrame = null;

    /** A part of the artwork by its data-part name. */
    stage.part = function part(name) {
      return art.querySelector('[data-part="' + name + '"]');
    };

    /**
     * A box in FRAME pixels: the element's screen box, made relative to the
     * frame and divided by the view scale.
     */
    stage.frameBox = function frameBox(el) {
      var box = el.getBoundingClientRect();
      var origin = frame.getBoundingClientRect();
      var s = stage.viewScale || 1;
      return {
        x: (box.left - origin.left) / s,
        y: (box.top - origin.top) / s,
        width: box.width / s,
        height: box.height / s,
      };
    };

    function applyFrame() {
      var spec = config.frames[stage.frameName];
      frame.setAttribute('data-frame', stage.frameName);
      frame.style.setProperty('--showcase-frame-width', spec.width + 'px');
      frame.style.setProperty('--showcase-frame-height', spec.height + 'px');
      frame.style.setProperty('--showcase-safe-top', spec.safe.top + 'px');
      frame.style.setProperty('--showcase-safe-right', spec.safe.right + 'px');
      frame.style.setProperty('--showcase-safe-bottom', spec.safe.bottom + 'px');
      frame.style.setProperty('--showcase-safe-left', spec.safe.left + 'px');
    }

    function applyLook() {
      frame.setAttribute('data-theme', settings.theme);
      // A token name, checked against the allowed list at build and on save,
      // so this only ever points at a semantic background token.
      frame.style.setProperty('--showcase-ground', 'var(--' + settings.background + ')');
      if (settings.width) {
        art.style.setProperty('--showcase-art-width', settings.width + 'px');
      } else {
        art.style.removeProperty('--showcase-art-width');
      }
      if (settings.height) {
        art.style.setProperty('--showcase-art-height', settings.height + 'px');
      } else {
        art.style.removeProperty('--showcase-art-height');
      }
    }

    function applyProps() {
      var roots = art.querySelectorAll('[data-showcase-root]');
      Array.prototype.forEach.call(roots, function applyTo(root) {
        Object.keys(settings.props).forEach(function setProp(key) {
          var value = settings.props[key];
          if (value === '') {
            root.removeAttribute(key);
          } else {
            root.setAttribute(key, value);
          }
        });
      });
    }

    function applyLayers() {
      var layers = settings.layers || {};
      Array.prototype.forEach.call(frame.querySelectorAll('[data-layer]'), function toggle(el) {
        var id = el.getAttribute('data-layer');
        // The attribute, not the property: an SVG element has no `hidden`.
        el.toggleAttribute('hidden', layers[id] === false);
      });
    }

    /** The current frame's spec, parsed, or null. */
    function currentSpec() {
      var data = settings.specData && settings.specData[stage.frameName];
      if (!data || !window.LayerStack) return null;
      if (!specs[stage.frameName]) {
        try {
          specs[stage.frameName] = window.LayerStack.parseSpec(data);
        } catch (err) {
          console.error('[showcase-stage] the ' + stage.frameName + ' spec of ' + settings.slug + ' cannot be read', err);
          return null;
        }
      }
      return specs[stage.frameName];
    }

    /**
     * Draw the spec over the frame. A spec layer shows only when the asset or
     * the edit view switches it on: an interface overlay is for checking the
     * layout, and must never reach an export by default.
     */
    function drawSpec() {
      var spec = currentSpec();
      if (!spec) {
        specSvg.textContent = '';
        // SVGElement has no `hidden` property; the attribute is what CSS reads.
        specSvg.setAttribute('hidden', '');
        return;
      }
      window.LayerStack.toggles(spec).forEach(function apply(toggle) {
        window.LayerStack.setVisible(spec, toggle.id, settings.layers[SPEC_PREFIX + toggle.id] === true);
      });
      specSvg.removeAttribute('hidden');
      window.LayerStack.render(specSvg, spec, { overlayOnly: true, scope: frame });
    }

    function initComponents() {
      COMPONENT_INITS.forEach(function run(name) {
        if (typeof window[name] === 'function') {
          try {
            window[name](art);
          } catch (err) {
            console.error('[showcase-stage] ' + name + ' failed on ' + settings.slug, err);
          }
        }
      });
    }

    /**
     * Fit the artwork to the safe area. Natural size is read from the layout
     * box, which a transform does not change, so this is stable however many
     * times it runs. Computed on mount and when the frame, width or props
     * change, never on a step: an accordion opening must not shrink the
     * component mid-animation.
     */
    function fitArt() {
      var spec = config.frames[stage.frameName];
      var room = {
        width: spec.width - spec.safe.left - spec.safe.right,
        height: spec.height - spec.safe.top - spec.safe.bottom,
      };
      var natural = { width: art.offsetWidth, height: art.offsetHeight };
      var scale = typeof settings.scale === 'number' ? settings.scale : 1;
      if (settings.scale === 'fit' && natural.width > 0 && natural.height > 0) {
        scale = Math.min(room.width / natural.width, room.height / natural.height);
        scale = Math.floor(scale * 100) / 100;
      }
      stage.artScale = scale;
      art.style.setProperty('--showcase-art-scale', String(scale));
    }

    /** Fit the frame to the host: by width, and by height in the edit view. */
    function fitView() {
      var spec = config.frames[stage.frameName];
      if (options.fixed) {
        stage.viewScale = 1;
      } else {
        var width = host.clientWidth;
        var scale = width / spec.width;
        if (options.fitHeight && host.clientHeight > 0) {
          scale = Math.min(scale, host.clientHeight / spec.height);
        }
        stage.viewScale = scale > 0 ? scale : 1;
      }
      viewport.style.setProperty('--showcase-view-scale', String(stage.viewScale));
      viewport.style.setProperty('--showcase-view-width', spec.width * stage.viewScale + 'px');
      viewport.style.setProperty('--showcase-view-height', spec.height * stage.viewScale + 'px');
    }

    /**
     * Place each annotation at the edge of its target, in frame pixels. A
     * target that is hidden (a closed menu's item) draws nothing.
     */
    stage.drawNotes = function drawNotes() {
      notes.textContent = '';
      (settings.annotations || []).forEach(function draw(note) {
        var target = stage.part(note.target);
        if (!target || target.offsetParent === null) return;
        var box = stage.frameBox(target);
        if (box.width === 0 && box.height === 0) return;
        var anchor = {
          top: { x: box.x + box.width / 2, y: box.y },
          right: { x: box.x + box.width, y: box.y + box.height / 2 },
          bottom: { x: box.x + box.width / 2, y: box.y + box.height },
          left: { x: box.x, y: box.y + box.height / 2 },
        }[note.side];

        var el = document.createElement('div');
        el.className = 'showcase-note';
        el.setAttribute('data-side', note.side);
        el.style.setProperty('--showcase-note-x', anchor.x + 'px');
        el.style.setProperty('--showcase-note-y', anchor.y + 'px');
        var label = document.createElement('span');
        label.className = 'showcase-note-label';
        label.textContent = note.text;
        var line = document.createElement('span');
        line.className = 'showcase-note-line';
        el.appendChild(label);
        el.appendChild(line);
        notes.appendChild(el);
      });
    };

    /** Redraw on the next frame, collapsing bursts into one draw. */
    stage.scheduleNotes = function scheduleNotes() {
      if (noteFrame) return;
      noteFrame = window.requestAnimationFrame(function drawLater() {
        noteFrame = null;
        stage.drawNotes();
      });
    };

    /**
     * Glide the drawn cursor to a part's centre, in frame pixels, in the
     * shape a real pointer has there: the hand over anything clickable.
     */
    stage.moveCursor = function moveCursor(name) {
      var target = stage.part(name);
      if (!target) return;
      var box = stage.frameBox(target);
      cursor.style.setProperty('--showcase-cursor-x', box.x + box.width / 2 + 'px');
      cursor.style.setProperty('--showcase-cursor-y', box.y + box.height / 2 + 'px');
      cursor.setAttribute('data-cursor', cursorShape(target, art));
      cursor.classList.add('is-active');
    };

    /**
     * A press: the cursor dips for the moment a click takes (the duration is
     * the stylesheet's, read from --showcase-cursor-press). Nothing happens
     * unless the cursor is showing; a click with no cursor step before it is
     * the component changing on its own.
     */
    stage.pressCursor = function pressCursor() {
      if (!cursor.classList.contains('is-active')) return;
      if (pressTimer) window.clearTimeout(pressTimer);
      cursor.classList.add('is-pressing');
      pressTimer = window.setTimeout(function release() {
        pressTimer = null;
        cursor.classList.remove('is-pressing');
      }, durationMs(window.getComputedStyle(cursor).getPropertyValue('--showcase-cursor-press')));
    };

    stage.hideCursor = function hideCursor() {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      cursor.classList.remove('is-pressing');
      cursor.classList.remove('is-active');
      cursor.setAttribute('data-cursor', 'arrow');
    };

    /**
     * Put the markup back as the repo has it: every menu closed, every class a
     * step added gone, focus released. The player runs this before each pass,
     * so a loop never inherits the last pass's state.
     */
    stage.reset = function reset() {
      if (art.contains(document.activeElement)) document.activeElement.blur();
      art.innerHTML = settings.html;
      applyProps();
      applyLayers();
      initComponents();
      stage.hideCursor();
      stage.scheduleNotes();
    };

    /** Re-fit everything: after a frame, width, scale or props change. */
    stage.refresh = function refresh() {
      applyFrame();
      applyLook();
      fitView();
      fitArt();
      applyLayers();
      drawSpec();
      stage.scheduleNotes();
    };

    stage.setFrame = function setFrame(name) {
      if (settings.frames.indexOf(name) === -1 && !config.frames[name]) return;
      stage.frameName = name;
      stage.refresh();
    };

    /**
     * Apply a set of changed settings (the edit view's controls and its
     * saved overrides). Only the keys an override may carry are read.
     */
    stage.update = function update(changes) {
      if (changes.background) settings.background = changes.background;
      if (changes.theme) settings.theme = changes.theme;
      if (changes.scale) settings.scale = changes.scale;
      if (changes.props) settings.props = Object.assign({}, settings.props, changes.props);
      if (changes.layers) settings.layers = Object.assign({}, settings.layers, changes.layers);
      applyLook();
      if (changes.props) applyProps();
      stage.refresh();
    };

    /**
     * Every switchable layer: the markup's own data-layer elements, then the
     * annotations when the asset has any. Labels come from data-layer-label,
     * or the id made readable.
     */
    stage.layers = function layers() {
      var seen = {};
      var list = [];
      Array.prototype.forEach.call(art.querySelectorAll('[data-layer]'), function collect(el) {
        var id = el.getAttribute('data-layer');
        if (seen[id]) return;
        seen[id] = true;
        list.push({
          id: id,
          label: el.getAttribute('data-layer-label') || humanise(id),
          visible: settings.layers[id] !== false,
        });
      });
      if ((settings.annotations || []).length > 0) {
        list.push({ id: ANNOTATIONS_LAYER, label: 'Annotations', visible: settings.layers[ANNOTATIONS_LAYER] !== false });
      }
      var spec = currentSpec();
      if (spec) {
        window.LayerStack.toggles(spec).forEach(function addSpec(toggle) {
          var id = SPEC_PREFIX + toggle.id;
          list.push({ id: id, label: toggle.label, visible: settings.layers[id] === true, spec: true });
        });
      }
      return list;
    };

    stage.setLayer = function setLayer(id, visible) {
      settings.layers[id] = Boolean(visible);
      if (id.indexOf(SPEC_PREFIX) === 0) {
        drawSpec();
        return;
      }
      applyLayers();
      stage.scheduleNotes();
    };

    /**
     * Let go of everything that watches the page: observers, the pending
     * notes frame, the press timer. The frame stays drawn, so a page leaving
     * under a transition (Barba's before-nav) keeps its picture to the end.
     */
    stage.disconnect = function disconnect() {
      if (resizeObserver) resizeObserver.disconnect();
      if (artObserver) artObserver.disconnect();
      if (noteFrame) window.cancelAnimationFrame(noteFrame);
      if (pressTimer) window.clearTimeout(pressTimer);
      resizeObserver = null;
      artObserver = null;
      noteFrame = null;
      pressTimer = null;
      art.removeEventListener('transitionend', stage.scheduleNotes);
    };

    stage.destroy = function destroy() {
      stage.disconnect();
      host.removeChild(viewport);
    };

    // First paint.
    applyFrame();
    applyLook();
    art.innerHTML = settings.html;
    applyProps();
    applyLayers();
    initComponents();
    fitView();
    fitArt();
    drawSpec();
    stage.drawNotes();

    // Fonts change the artwork's natural size, so fit again once they load.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function refit() {
        if (viewport.isConnected) stage.refresh();
      });
    }

    if (!options.fixed && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(function onResize() {
        fitView();
        stage.scheduleNotes();
      });
      resizeObserver.observe(host);
    }
    // A part that moves without the artwork resizing (a menu opening, a tab
    // indicator sliding) ends a transition; the notes follow it.
    art.addEventListener('transitionend', stage.scheduleNotes);
    if ('ResizeObserver' in window) {
      artObserver = new ResizeObserver(stage.scheduleNotes);
      artObserver.observe(art);
    }

    return stage;
  }

  window.ShowcaseStage = {
    version: VERSION,
    mount: mount,
    readConfig: readConfig,
    icon: icon,
    ANNOTATIONS_LAYER: ANNOTATIONS_LAYER,
  };
})();
