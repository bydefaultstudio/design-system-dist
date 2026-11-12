/**
 * layout-specs.js — Layout Specs, the editor for a Layout Spec: the rules
 * artwork lives by, tested against a specimen and written out as a spec.
 * Called Artwork Layers until 2026-10-04.
 *
 * Global page module, loaded once on every page like the other tool modules.
 * It self-registers for the initial load and for Barba's bd:after-nav event,
 * scoped to the incoming container, and bails at once when the container is
 * not the tool. Every listener is bound to an element inside the container,
 * so a page swap discards them; the ResizeObserver, the one thing that
 * outlives the DOM, is released on the next arrival.
 *
 * MUST STAY OUTSIDE [data-barba="container"] (see the same note in
 * icon-library.js).
 *
 * The geometry, the presets and the spec format are the engine's
 * (assets/js/layer-stack.js, window.LayerStack; Layout Spec version 4,
 * format-system.md §0). This module is the editor: the canvas panel, the
 * layer list, the selected layer's settings, the export (the spec as JSON,
 * or an SVG of the rules with the spec inside), and the spec's other ways in
 * and out (import of either file, the link, and the last spec kept in this
 * browser). A version 1 spec from any of them is converted by the engine,
 * and what changed is shown in the canvas settings.
 *
 * The specimen is the specimen layer's Source (2026-10-03): an asset — an
 * icon from the page's own #icon-manifest or a logo from window.LogoManifest
 * — or an image the person picks (SVG, PNG, JPG), which stays in this
 * browser tab to check the rules against and never enters the spec or an
 * export. The tool builds rules, not pictures. A spec from before that may
 * still carry its own SVG (kind 'svg'), sanitised through the shared
 * SvgCleaner engine; it is drawn and exported as it was.
 *
 * The canvas is a row of its own at the foot of the layer list (2026-10-03):
 * the frame every layer sits on. It stands for the spec's canvas and is
 * never one of its layers — it cannot move, hide or go — and selecting it
 * shows the frame's settings: its size, or Hug specimen, where the specimen
 * sets it and W and H read it out (2026-10-04); its one shape and how it
 * shows; its background. How the specimen sits in a canvas with a size of
 * its own — Fit or Fill — is the specimen layer's Placement.
 *
 * Layers can sit in groups, one level deep (2026-10-02): a group's eye
 * hides its layers together, and its layers list indented under it. The
 * specimen is never in one.
 *
 * @version 3.1.0
 */
(function () {
  'use strict';

  var VERSION = '3.1.0';
  console.log('[layout-specs] v' + VERSION + ' loaded');

  var ROOT_SELECTOR = '[data-tool="layout-specs"]';
  // The icon a spec opens on when it names none (owner, 2026-10-05): the
  // engine's templates carry no brand asset, so the host chooses. A brand
  // without it gets its first icon.
  var STARTING_ICON = 'bullseye';
  var STORAGE_KEY = 'layout-specs:spec';
  // Where the tool kept the spec while it was called Artwork Layers: read
  // once, written under the new key, then let go, so no browser loses its
  // last spec to the rename (2026-10-04).
  var LEGACY_STORAGE_KEY = 'artwork-layers:spec';
  var DEFAULT_TEMPLATE = 'blank';
  // The canvas row's id. Never a layer id: the colon is outside what the
  // engine keeps of an imported one (layer-stack.js, cleanId).
  var CANVAS_ID = ':canvas';
  var STATUS_CLEAR_MS = 4000;

  /* Common canvases, the Size menu's entries. A size typed by hand reads
     Custom. */
  var SIZE_PRESETS = [
    { label: 'Icon, 24 × 24', w: 24, h: 24 },
    { label: 'Post, 1:1', w: 1080, h: 1080 },
    { label: 'Post, 4:5', w: 1080, h: 1350 },
    { label: 'Story, 9:16', w: 1080, h: 1920 },
    { label: 'Video, 16:9', w: 1920, h: 1080 },
    { label: 'Link, 1.91:1', w: 1200, h: 628 }
  ];

  /* The specimen layer's Placement: its words, and the canvas fit each one
     writes in the spec (layer-stack.js, canvas.fit). The third fit,
     fit-artwork, is the canvas's Size: Hug specimen. */
  var PLACEMENTS = [['fit', 'contain', 'Fit'], ['fill', 'cover', 'Fill']];
  var PLACEMENT_HINT = 'Fit: the specimen fits inside the canvas. Fill: the specimen covers it, cropped at the edge.';
  var HUG = 'hug';
  var SOURCE_HINT = 'Asset: a logo or an icon from the library, kept in the export. Image: a file from this computer, shown here only and never in the export.';
  var IMAGE_MAX_BYTES = 8 * 1024 * 1024;

  /* The palette's mid steps, which read on the light and the dark ground.
     The first entry is the layer type's own token. The brand's hues
     (bdColor.HUES, from brand.json colours.hues), in this order where the
     engine has them, then any of the brand's own; the warm grey sits out.
     Read when a colour list is built, so color-core has loaded. */
  var ENGINE_HUE_ORDER = ['red', 'blue', 'purple', 'green', 'aqua', 'pink', 'peach', 'yellow'];

  function layerHues() {
    var hues = window.bdColor && Array.isArray(window.bdColor.HUES) ? window.bdColor.HUES : ENGINE_HUE_ORDER;
    var ordered = ENGINE_HUE_ORDER.filter(function (hue) { return hues.indexOf(hue) !== -1; });
    hues.forEach(function (hue) {
      if (hue !== 'brown' && ordered.indexOf(hue) === -1) ordered.push(hue);
    });
    return ordered;
  }

  /* A measure's and a note's colours: the Figma Annotation kit's six
     (design-system.css, --annotation-*), after Auto, the ground's ink. */
  var KIT_COLOURS = [['ink', 'Ink'], ['white', 'White'], ['red', 'Red'], ['blue', 'Blue'], ['pink', 'Pink'], ['green', 'Green']];

  /* Labels for settings, by field name. Short, as a design tool's are:
     what a label leaves out is in its hint, behind the ⓘ beside it. */
  var FIELD_LABELS = {
    display: 'Display', edge: 'Edge', reference: 'Measured from', amount: 'Inset',
    draw: 'Draw', lineStyle: 'Line', lineWeight: 'Weight', bleed: 'Bleed', form: 'Form',
    overshootTop: 'Overshoot top', overshootBottom: 'Overshoot bottom', overshootLeft: 'Overshoot left', overshootRight: 'Overshoot right', colour: 'Colour', opacity: 'Opacity',
    outlineColour: 'Outline colour', outlineOpacity: 'Outline opacity', fillColour: 'Fill colour', fillOpacity: 'Fill opacity',
    kind: 'Kind', size: 'Size', cell: 'Cell', align: 'Align', target: 'Measure', zone: 'Which zone',
    text: 'Text', x: 'Left', y: 'Top', w: 'Width', h: 'Height',
    radius: 'Corner', src: 'Image', fit: 'Fit',
    marker: 'Marker', markerText: 'Marker text', markerSrc: 'Marker file', markerRotate: 'Rotation',
    markerOrient: 'Direction', markerRepeat: 'Repeat', markerColour: 'Marker colour', markerOpacity: 'Marker opacity',
    offsetX: 'Offset across', offsetY: 'Offset down', count: 'Count', margin: 'Margin', gutter: 'Gutter',
    axis: 'Direction', position: 'Position', ratio: 'Height',
    colourHex: 'Hex', background: 'Background', shape: 'Shape', shapeShow: 'Show'
  };

  /* Labels that differ by type. */
  var TYPE_FIELD_LABELS = { 'specimen.size': 'Size', 'measure.axis': 'Direction', 'measure.edge': 'Line at', 'measure.at': 'Line at', 'measure.from': 'From', 'measure.to': 'To', 'measure.value': 'Value', 'measure.valueStyle': 'Value style' };

  var FIELD_HINTS = {
    marker: 'A graphic in the band, as wide as the band is deep: a letter, an SVG, an image, or the specimen\'s own X glyph (a logo\'s d).',
    markerRotate: 'In degrees. -90 turns it left, so a d lies with its ascender on the ground.',
    markerOrient: 'Turns: the marker turns with each edge, keeping its ground on the zone\'s outer edge all the way round. Fixed: the same on every edge.',
    markerRepeat: 'One marker on each edge, or repeated along it.',
    overshootTop: 'How far the drawing reaches past the shape the rules are built on, on each edge: an o below the baseline, a b above the cap height. Layers measured from the specimen read the box without it; the drawing is never cut. In the specimen\'s own units, % of its width or height, or X.',
    bleed: 'Runs the lines off the canvas, out to the edge of the zones and shapes, hidden ones too. Never out to the specimen, so the bleed stays the same whatever sample is loaded. Where the lines sit does not change.',
    cell: 'In % the count is exact on any size: 10% is ten columns on a 98px canvas. In px or X the cell keeps its size; align it from the centre to split the remainder evenly.',
    align: 'Where the cells start counting: the top left, or the centre, which splits the remainder evenly.',
    amount: 'In % it is a share of the shorter side. X is the specimen\'s own unit: for a logo, the glyph width its manifest names.',
    offsetX: 'The specimen is centred, then moved by this much. Negative moves it left or up. In % it is a share of the canvas.',
    count: 'How many columns or rows. They stretch to fill the space between the margins.',
    margin: 'Space before the first and after the last, measured from the edge of the box.',
    position: 'From the left for a vertical line, from the top for a horizontal one.',
    reference: 'What it is measured from: the canvas\'s edge or the specimen\'s.',
    edge: 'Inside or outside the edge of what it is measured from.',
    radius: 'In % of the shorter side.',
    x: 'From the left and the top of the canvas. Below 0 or past 100% sits outside it, in the margin.',
    w: 'In % of the canvas, in px, or in X.',
    fit: 'Fit: the whole image inside its box. Fill: covers the box and crops.',
    draw: 'Outline draws the edges, Fill shades the area, Both does both.',
    lineWeight: 'In screen pixels: a line keeps its weight at any zoom. Follows --overlay-line-weight until you type a number.'
  };

  /* Hints that differ by type. */
  var TYPE_FIELD_HINTS = {
    'zone.display': 'Ring: the band between the edge and the inset. Area: the box inside the inset.',
    'measure.target': 'Inset: how deep a zone\'s band is. Area: the box inside it. + Bleed measures the canvas and its bleed as one: a logo and the clear space around it. Span: from one point to another along the axis, at a position across it; its length is the value.',
    'measure.at': 'Where the line sits across the axis: from the top for a width, from the left for a height.',
    'shape.draw': 'Outline draws the edge, Fill shades the shape, Both does both. Outside outlines the shape and shades everything beyond it, out to the canvas edge: a safe area.',
    'note.anchor': 'Centre puts the note\'s middle on the point. Top left hangs it from the point by its corner, so it sits inside a corner whatever it says.',
    'measure.axis': 'One line per measure. Add a second set to the other for both sides.',
    'measure.edge': 'Where the line sits across what it measures. Beside a box it stands off it; on a zone it lies on the zone.',
    'measure.value': 'On the line, or beside it. Beside, the value grows away from the line.',
    'measure.size': 'Large doubles the lines, the ticks and the value, for a diagram seen small.',
    'measure.valueStyle': 'Filled is a pill in the measure\'s colour. Text is the number in that colour, on the ground.',
    'note.colour': 'Auto is text on the ground. A colour makes the note a pill.',
    'guide.size': 'A circle\'s diameter, in % of the shorter side; a rectangle\'s width, in % of the width, so 100% spans it.',
    'guide.ratio': 'In % of the width. 100 is a square, 125 is 4:5 portrait, 80 is 5:4 landscape, 56.25 is 16:9.',
    'guide.draw': 'A keyline drawn as an outline, a filled shape, or both.',
    'grid.draw': 'Outline draws the edges of each column or row; Fill shades them.',
    'specimen.size': 'In % it is a share of the placement: 100% fills the canvas as Placement sets it. In px it is the specimen\'s width.'
  };

  /* Option names for a segmented control, where the engine's own are
     sentences (layer-stack.js, CHOICES). What they explained moves to the
     setting's hint. */
  var SHORT_CHOICES = {
    'zone.display': { ring: 'Ring', area: 'Area' },
    'zone.edge': { inside: 'Inside', outside: 'Outside' },
    'zone.marker': { none: 'None', glyph: 'Glyph', text: 'Text', svg: 'SVG', image: 'Image' },
    'zone.markerOrient': { follow: 'Turns', fixed: 'Fixed' },
    'zone.markerRepeat': { edges: 'Each edge', tile: 'Tiled' },
    'shape.form': { rectangle: 'Rectangle', circle: 'Circle', rounded: 'Rounded' },
    'measure.target': { canvas: 'Canvas', specimen: 'Specimen', 'zone-inset': 'Inset', 'zone-area': 'Area', all: '+ Bleed', span: 'Span' },
    'measure.value': { 'on-line': 'On line' },
    'shape.draw': { outline: 'Outline', fill: 'Fill', both: 'Both', outside: 'Outside' },
    'note.anchor': { centre: 'Centre', start: 'Top left' },
    'image.fit': { contain: 'Fit', cover: 'Fill' },
    'canvas.shape': { rectangle: 'Rectangle', circle: 'Circle', rounded: 'Rounded', 'app-icon': 'App icon' },
    align: { start: 'Top left', centre: 'Centre' }
  };

  /* Each layer type's icon, at the head of its row in the list (Figma, By
     Default | Website, node 18824:146895). The icon is also the row's grip
     for a finger (handleGripDown). The specimen and the shape are not in
     that frame: shapes and circle are stand-ins until they are drawn, and
     so is the canvas's square until a frame is. */
  var TYPE_ICONS = {
    canvas: 'square', specimen: 'shapes', zone: 'square-dashed', shape: 'circle', guide: 'line', grid: 'grid',
    measure: 'open-full', note: 'file-doc', image: 'photo', group: 'folder'
  };

  /* Each template's tile icon in New spec's picker: its specimen where it
     has one, else the format it is cut for. A template missing here gets
     the canvas's square. */
  var TEMPLATE_ICONS = {
    icon: 'bullseye', logo: 'square-dashed', avatar: 'user', reels: 'mobile-video', story: 'mobile',
    square: 'square', portrait: 'photo', landscape: 'video', blank: 'page'
  };

  /* A segmented control holds five at most (cms/form.md, Segmented
     Control); a longer list stays a menu. */
  var SEGMENT_MAX = 5;

  /* The letter inside a field before its number, as a design tool marks
     position and size. By type and field, then by field. */
  var PREFIXES = { 'specimen.size': 'W', offsetX: 'X', offsetY: 'Y',
    overshootTop: 'T', overshootBottom: 'B', overshootLeft: 'L', overshootRight: 'R', x: 'X', y: 'Y', w: 'W', h: 'H', radius: 'R', from: 'F', to: 'T' };

  /* The unit after a plain number, inside its field. */
  var SUFFIXES = { radius: '%', ratio: '%', markerRotate: '°' };

  /* The appearance every drawn type shares (layer-stack.js, APPEARANCE),
     laid out once: what is drawn, then the outline — its line, weight,
     strength and colour — then the fill's strength and colour, each paint
     its own (kindVisibility shows the ones the draw uses). A measure has
     nothing to fill, so it has no Draw and one colour. */
  var LOOK = ['draw', 'lineStyle', ['lineWeight', 'outlineOpacity'], 'outlineColour', 'fillOpacity', 'fillColour'];
  var OUTLINE_FIELDS = ['lineStyle', 'lineWeight', 'outlineOpacity', 'outlineColour'];
  var FILL_FIELDS = ['fillOpacity', 'fillColour'];

  /* The order a type's settings are laid out in, by row: a name is a row
     of its own; two names share a row, each with its label; a label and
     two names share a row and that label, the letter inside each field
     telling them apart (X and Y). Every field in TYPES appears once; one
     left out is added at the end (renderSettings). */
  var LAYOUT = {
    specimen: [['size', 'opacity'], { label: 'Offset', fields: ['offsetX', 'offsetY'] },
      { label: 'Overshoot', fields: ['overshootTop', 'overshootBottom', 'overshootLeft', 'overshootRight'] }],
    zone: ['display', 'edge', 'reference', 'amount'].concat(LOOK,
      ['marker', 'markerText', 'markerSrc', ['markerRotate', 'markerOpacity'], 'markerOrient', 'markerRepeat', 'markerColour']),
    shape: ['form', 'radius', { label: 'Position', fields: ['x', 'y'] }, { label: 'Size', fields: ['w', 'h'] }].concat(LOOK),
    guide: ['kind', 'axis', 'reference', 'bleed', 'position', ['size', 'ratio'], 'radius'].concat(LOOK),
    grid: ['kind', 'reference', ['cell', 'align'], ['count', 'gutter'], 'margin'].concat(LOOK),
    measure: ['target', 'zone', 'axis', { label: 'Span', fields: ['from', 'to'] }, 'at', 'edge', 'value', ['size', 'valueStyle'], 'lineStyle', ['lineWeight', 'opacity'], 'colour'],
    note: ['text', 'colour', { label: 'Position', fields: ['x', 'y'] }, 'anchor'],
    image: ['src', { label: 'Position', fields: ['x', 'y'] }, { label: 'Size', fields: ['w', 'h'] }, ['fit', 'opacity']]
  };

  /* Settings that take a length, with the units each offers. */
  var LENGTH_FIELDS = {
    amount: ['px', '%', 'X'], size: ['px', '%', 'X'], cell: ['px', '%', 'X'],
    offsetX: ['px', '%', 'X'], offsetY: ['px', '%', 'X'],
    overshootTop: ['px', '%', 'X'], overshootBottom: ['px', '%', 'X'], overshootLeft: ['px', '%', 'X'], overshootRight: ['px', '%', 'X'], margin: ['px', '%', 'X'], gutter: ['px', '%', 'X'], position: ['px', '%', 'X'],
    x: ['%', 'px', 'X'], y: ['%', 'px', 'X'], w: ['%', 'px', 'X'], h: ['%', 'px', 'X'], lineWeight: ['px'],
    from: ['%', 'px', 'X'], to: ['%', 'px', 'X'], at: ['%', 'px', 'X']
  };

  /* Lengths that may be negative: an offset, and a position outside the
     canvas (a span can start or sit in the margin too). */
  var SIGNED_FIELDS = ['offsetX', 'offsetY', 'x', 'y', 'from', 'to', 'at'];

  /* The types Add layer offers, in the picker's order, each with its
     presets. A preset is a layer of its type with settings filled in —
     padding, live area and clear space are all one zone — so the type names
     what it is and the preset what it starts as. Picking a type adds its
     first preset; Start from, in its settings, offers the rest. Safe area is
     left out (it is Padding at a percentage) and the unit and percent grids
     are one Cell grid; the templates still use the named ones. */
  var ADD_MENU = [
    ['zone', ['zone.padding', 'zone.live-area', 'zone.clear-space']],
    ['shape', ['shape.tap-area', 'shape.area']],
    ['guide', ['guide.centre', 'guide.diagonal', 'guide.thirds', 'guide.line', 'guide.keyline', 'guide.rectangle']],
    ['grid', ['grid.cells', 'grid.x', 'grid.columns', 'grid.rows']],
    ['image', ['image.ui', 'image.instagram-reels']],
    ['measure', ['measure.canvas', 'measure.specimen', 'measure.zone-inset', 'measure.zone-area']],
    ['note', ['note']]
  ];

  var DEFAULT_COLOUR = {
    zone: 'var(--overlay-zone)', shape: 'var(--overlay-zone)', guide: 'var(--overlay-guide)', grid: 'var(--overlay-grid)'
  };

  var state = null;
  var el = null;
  var resizeObserver = null;
  var statusTimer = null;
  var linkedImages = [];
  var deleteDialog = null;
  var pendingDeleteId = null;
  var deleteTrigger = null;
  var saveTimer = null;
  var SAVE_DELAY_MS = 400;
  var drag = null;
  var justDragged = false;
  // A press on a row is a click until the pointer travels this far.
  var DRAG_THRESHOLD = 4;
  // A drag held within this many px of the list's scrolling edge scrolls
  // it, faster the deeper in, up to EDGE_SPEED px a frame.
  var EDGE_ZONE = 40;
  var EDGE_SPEED = 12;
  var fieldCounter = 0;
  var templateDialog = null;
  var templateTrigger = null;
  var addDialog = null;
  // The canvas settings' controls while they are shown, else null.
  var canvasEl = null;

  //
  //------- Artwork sources -------//
  //

  function readIconManifest(root) {
    var node = root.querySelector('#icon-manifest') || document.getElementById('icon-manifest');
    if (!node) { return []; }
    try {
      var data = JSON.parse(node.textContent);
      return Array.isArray(data.icons) ? data.icons : [];
    } catch (error) {
      console.error('[layout-specs] icon manifest unreadable', error);
      return [];
    }
  }

  function logoVariants() {
    var manifest = window.LogoManifest;
    return manifest && Array.isArray(manifest.variants) ? manifest.variants : [];
  }

  function sanitise(markup) {
    var cleaner = window.SvgCleaner;
    if (!cleaner || typeof cleaner.sanitiseSVG !== 'function') { return null; }
    return cleaner.sanitiseSVG(String(markup));
  }

  /* The current spec's artwork, parsed, with its unit X. Cached by source
     so a settings change never re-parses. */
  function currentArtwork() {
    var art = state.spec.specimen || { kind: 'none' };
    var cacheKey = art.kind === 'svg' ? 'svg:' + (art.unit || 0) + ':' + (art.src || '')
      : art.kind === 'image' ? 'image:' + (localImageFor(art) ? state.localImage.id : 0)
        : art.kind + ':' + (art.key || '');
    if (state.artworkKey === cacheKey) { return state.artwork; }
    var parsed = null;
    if (art.kind === 'icon') {
      var icon = state.icons.filter(function (entry) { return entry.key === art.key; })[0];
      parsed = icon ? window.LayerStack.readArtwork(icon.raw, 0) : null;
    } else if (art.kind === 'logo') {
      var variant = logoVariants().filter(function (entry) { return entry.id === art.key; })[0];
      parsed = variant ? window.LayerStack.readArtwork(inkMarkup(variant.markup), variant.clearSpace && variant.clearSpace.units, logoGlyph()) : null;
    } else if (art.kind === 'svg' && art.src) {
      parsed = window.LayerStack.readArtwork(art.src, Number(art.unit) || 0);
    } else if (art.kind === 'image' && localImageFor(art)) {
      // A picture, drawn as an <image> (layer-stack.js, placeArtwork).
      var image = state.localImage;
      parsed = { href: image.href, viewBox: { x: 0, y: 0, w: image.w, h: image.h }, unit: 0, glyph: null };
    }
    state.artworkKey = cacheKey;
    state.artwork = parsed;
    return parsed;
  }

  /* The image picked in this tab, when it is the one the spec names: a
     spec imported or restored with another image's name asks for that one
     instead of drawing this. */
  function localImageFor(art) {
    return state.localImage && art && art.kind === 'image' && state.localImage.name === art.name ? state.localImage : null;
  }

  /* A picture's object URL is let go when it is replaced or the tool
     leaves; an SVG's data URL holds nothing. */
  function dropLocalImage() {
    if (state && state.localImage && /^blob:/.test(state.localImage.href)) { URL.revokeObjectURL(state.localImage.href); }
    if (state) { state.localImage = null; }
  }

  /* A template names a kind of artwork, not a brand's asset; the host picks
     one: the starting icon, the first logo, or the first square logo when the
     template prefers one. An unknown key falls back the same way. */
  function resolveArtwork(spec) {
    var art = spec.specimen || { kind: 'none' };
    if (art.kind === 'icon' && !state.icons.some(function (entry) { return entry.key === art.key; })) {
      spec.specimen = startingIcon() || { kind: 'none' };
    } else if (art.kind === 'logo' && !logoVariants().some(function (entry) { return entry.id === art.key; })) {
      var variants = logoVariants();
      var pick = variants[0];
      if (art.prefer === 'square') {
        pick = variants.filter(function (variant) {
          var parsed = window.LayerStack.readArtwork(variant.markup, 0);
          return parsed && Math.abs(parsed.viewBox.w - parsed.viewBox.h) < 0.5;
        })[0] || pick;
      }
      spec.specimen = pick ? { kind: 'logo', key: pick.id } : { kind: 'none' };
    } else if (art.kind === 'svg' && !art.src) {
      spec.specimen = { kind: 'none' };
    }
    return spec;
  }

  /* A logo's manifest markup carries its own fill (black). Every fill goes
     to currentColor through the shared engine, as the Logo Tool does, so
     the logo takes the stage's ink and reads on the dark ground too. */
  function inkMarkup(markup) {
    var cleaner = window.SvgCleaner;
    if (!cleaner || typeof cleaner.processSVG !== 'function') { return markup; }
    return cleaner.processSVG(markup, { sanitise: true, currentColor: true });
  }

  /* X's own glyph, when the manifest has one: the By Default d. */
  function logoGlyph() {
    var manifest = window.LogoManifest;
    return manifest && manifest.clearSpaceGlyph && manifest.clearSpaceGlyph.markup ? manifest.clearSpaceGlyph.markup : null;
  }

  function artworkName() {
    var art = state.spec.specimen || { kind: 'none' };
    if (art.kind === 'icon') {
      var icon = state.icons.filter(function (entry) { return entry.key === art.key; })[0];
      return icon ? 'Icon: ' + (icon.name || icon.key) : 'Icon';
    }
    if (art.kind === 'logo') {
      var variant = logoVariants().filter(function (entry) { return entry.id === art.key; })[0];
      return variant ? 'Logo: ' + variant.label : 'Logo';
    }
    if (art.kind === 'svg') { return art.name ? 'SVG: ' + art.name : 'Your SVG'; }
    if (art.kind === 'image') { return localImageFor(art) ? 'Image: ' + art.name : 'No image yet'; }
    return 'No specimen';
  }

  //
  //------- Rendering -------//
  //

  function render() {
    var spec = state.spec;
    var artwork = currentArtwork();
    // A canvas that follows its artwork is written at the artwork's size,
    // less its overshoot.
    if (spec.canvas.fit === 'fit-artwork' && artwork) {
      var hugged = window.LayerStack.trimmedSize(spec, artwork, el.stage);
      spec.canvas.w = hugged.w;
      spec.canvas.h = hugged.h;
      spec.reference = { w: hugged.w, h: hugged.h };
    }
    var result;
    try {
      result = window.LayerStack.render(el.svg, spec, { artwork: artwork, scope: el.stage });
    } catch (error) {
      console.error('[layout-specs] render failed', error);
      showError('The canvas could not be drawn: ' + error.message);
      return;
    }
    state.lastResult = result;
    restoreTitle(result);
    window.LayerStack.placeLabels(el.labelHost, el.labels.checked ? result : { labels: [], view: result.view }, 'layer-stack-label');
    fitStage();
    renderDetails(result);
    syncExport();
    loadImages();
    saveLocal();
  }

  /* The images the drawing links to — image layers and image markers —
     loaded in the background while the person works, so an exported SVG
     can carry them (layer-stack.js, exportSvg): an SVG as its markup, to be
     drawn in as vectors, anything else as a data URL. A data URL already
     travels with the file; an SVG one is decoded so it comes in as vectors
     too. One that cannot be loaded stays a link. */
  function imageSources() {
    var sources = [];
    window.LayerStack.flatLayers(state.spec).forEach(function (layer) {
      if (layer.type === 'image' && layer.settings.src) { sources.push(layer.settings.src); }
      if (layer.type === 'zone' && layer.settings.marker === 'image' && layer.settings.markerSrc) { sources.push(layer.settings.markerSrc); }
    });
    return sources;
  }

  function loadImages() {
    var owner = state;
    var sources = imageSources();
    // Images no layer uses any more are let go.
    Object.keys(state.images).forEach(function (src) { if (sources.indexOf(src) === -1) { delete state.images[src]; } });
    sources.forEach(function (src) {
      if (state.images[src]) { return; }
      if (/^data:image\/svg\+xml/i.test(src)) {
        var markup = decodeSvgDataUrl(src);
        state.images[src] = markup ? svgEntry(markup) : { failed: true };
        return;
      }
      if (/^data:/i.test(src)) { state.images[src] = { failed: true }; return; }
      state.images[src] = { pending: true };
      var isSvg = /\.svg(\?|#|$)/i.test(src);
      window.fetch(src, { credentials: 'same-origin' }).then(function loaded(response) {
        var type = response.headers.get('content-type') || '';
        // A redirect or a page in place of a picture is the sign-in screen
        // or an error page, never the image.
        if (!response.ok || response.redirected || (type && !/^image\//i.test(type))) { throw new Error('not an image'); }
        return isSvg || /svg/i.test(type) ? response.text().then(svgEntry) : response.blob().then(blobToDataUrl);
      }).then(function store(entry) {
        if (state === owner) { state.images[src] = entry; }
      }).catch(function failed() {
        if (state === owner) { state.images[src] = { failed: true }; }
      });
    });
  }

  /* An SVG for the file. One painted by a <style> sheet comes in as a
     picture, because the vector path takes style sheets out (they would
     restyle the page); one painted by attributes comes in as vectors. */
  function svgEntry(text) {
    var clean = sanitise(text) || text;
    if (/<style[\s>]/i.test(clean)) { return { dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(clean) }; }
    return { markup: clean };
  }

  /* A base64 body is UTF-8 bytes; atob alone reads them as Latin-1. */
  function decodeSvgDataUrl(src) {
    var comma = src.indexOf(',');
    var body = src.slice(comma + 1);
    try {
      if (/;base64/i.test(src.slice(0, comma))) {
        var bytes = Uint8Array.from(window.atob(body), function byte(c) { return c.charCodeAt(0); });
        return new TextDecoder().decode(bytes);
      }
      return decodeURIComponent(body);
    } catch (error) {
      return '';
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function read(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function done() { resolve({ dataUrl: String(reader.result) }); };
      reader.onerror = function failed() { reject(new Error('unreadable')); };
      reader.readAsDataURL(blob);
    });
  }

  function loadedImages() {
    var ready = {};
    Object.keys(state.images).forEach(function (src) {
      var entry = state.images[src];
      if (entry.markup || entry.dataUrl) { ready[src] = entry; }
    });
    return ready;
  }

  /* The engine clears the <svg>; its accessible name is put back. */
  function restoreTitle(result) {
    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.id = 'al-svg-name';
    var shown = shownCount();
    // Each value with its layer's name: a measure is one line now, so the
    // name is what tells a width from a height.
    var labelText = el.labels.checked ? result.labels.filter(function (label) { return !label.hint; }).map(function (label) {
      var layer = layerById(label.layerId);
      return layer && layer.type === 'measure' ? layer.label + ' ' + label.text : label.text;
    }).join(', ') : '';
    title.textContent = 'Canvas ' + fmt(result.canvas.w) + ' by ' + fmt(result.canvas.h) + ', ' + artworkName() + ', ' + shown + (shown === 1 ? ' layer' : ' layers') + ' shown' + (labelText ? '. Labels: ' + labelText : '');
    el.svg.insertBefore(title, el.svg.firstChild);
  }

  /* Layers drawn: a layer counts when its own eye and its group's are on. */
  function shownCount() {
    var count = 0;
    state.spec.layers.forEach(function (entry) {
      if (entry.type === 'group') {
        if (entry.visible) { count += entry.layers.filter(function (layer) { return layer.visible; }).length; }
      } else if (entry.visible && entry.type !== 'specimen') {
        count += 1;
      }
    });
    return count;
  }

  /* The stage takes the largest box of the view's ratio that fits the
     preview's stage area. Sized in px from a measurement, because a box
     bound by both its width and its height cannot be expressed with
     aspect-ratio alone. */
  function fitStage() {
    if (!state || !el || !state.lastResult) { return; }
    var view = state.lastResult.view;
    // Layout boxes, not the transformed rect: the preview scales in as the
    // page arrives (bd-animate), and a rect read mid-entrance comes out small.
    var area = el.stage.parentElement;
    var padding = getComputedStyle(area);
    var aw = area.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
    var ah = area.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
    if (!(aw > 0) || !(ah > 0) || !(view.w > 0) || !(view.h > 0)) { return; }
    var k = Math.min(aw / view.w, ah / view.h);
    el.stage.style.width = Math.floor(view.w * k) + 'px';
    el.stage.style.height = Math.floor(view.h * k) + 'px';
  }

  function renderDetails(result) {
    var spec = state.spec;
    el.detailSize.textContent = fmt(result.canvas.w) + ' × ' + fmt(result.canvas.h);
    el.detailRatio.textContent = 'Ratio ' + window.LayerStack.ratioOf(result.canvas.w, result.canvas.h);
    el.detailArtwork.textContent = artworkName();
    var warning = result.warnings[0] || '';
    el.warning.textContent = warning;
    el.warning.classList.toggle('is-hidden', !warning);
    // Said once when it appears or changes, not on every render.
    if (warning && warning !== state.lastWarning) { announce(warning); }
    state.lastWarning = warning;
    var canvasType = el.list.querySelector('[data-id="' + CANVAS_ID + '"] .tool-layer-type');
    if (canvasType) { canvasType.textContent = fmt(result.canvas.w) + ' × ' + fmt(result.canvas.h); }
    // The size's hint and its button exist only while the canvas is
    // selected.
    if (!canvasEl || !canvasEl.sizeHint) { return; }
    var ref = spec.reference;
    var scaled = ref && (ref.w !== result.canvas.w || ref.h !== result.canvas.h);
    canvasEl.sizeHint.textContent = hugs()
      ? 'The specimen sets the size while Size is Hug specimen.'
      : scaled
        ? 'Written at ' + fmt(ref.w) + ' × ' + fmt(ref.h) + ', drawn at ' + fmt(result.canvas.w) + ' × ' + fmt(result.canvas.h) + '. Lengths in px scale with the width.'
        : '';
    canvasEl.makeReference.classList.toggle('is-hidden', !scaled);
  }

  function fmt(n) {
    return String(Math.round(n * 100) / 100);
  }

  //
  //------- Canvas settings -------//
  //

  /* True while the artwork sets the canvas: Placement on Hug, and an
     artwork to hug. */
  function hugs() {
    return state.spec.canvas.fit === 'fit-artwork' && !!currentArtwork();
  }

  /* Nothing chosen yet: no artwork and no layer but the artwork's. The
     template row shows only then; New spec on the bar works
     either way. */
  function isUnchosen() {
    return state.spec.specimen.kind === 'none' && window.LayerStack.flatLayers(state.spec).every(function (layer) { return layer.type === 'specimen'; });
  }

  /* The canvas's settings, built when its row is selected: the template
     while nothing is chosen, then the size — a preset, a typed W and H, or
     Hug specimen, where the specimen sets it and W and H read it out — then
     its shape, how the shape shows, and its background. */
  function canvasRows() {
    var rows = [];
    canvasEl = { unchosen: isUnchosen(), hasArtwork: !!currentArtwork() };
    if (canvasEl.unchosen) { rows.push(templateRow()); }
    rows.push(sizeRow());
    rows.push(dimensionsRow());
    canvasShapeRows().forEach(function (row) { rows.push(row); });
    var note = document.createElement('p');
    note.className = 'form-hint';
    note.textContent = 'The canvas is the frame every layer sits on, and the box the specimen is placed in. Its shape clips the specimen, the background and any image under the specimen; the rules stay visible past it.';
    rows.push(note);
    if (state.conversionNotes) {
      var converted = document.createElement('p');
      converted.className = 'form-hint';
      converted.dataset.field = 'converted';
      converted.textContent = withNotes('', state.conversionNotes);
      rows.unshift(converted);
    }
    return rows;
  }

  /* The canvas as a layer the shared fields can edit: its background is
     their colour. */
  function canvasProxy() {
    var canvas = state.spec.canvas;
    return {
      type: 'canvas',
      settings: {
        get colour() { return canvas.background; },
        set colour(value) { canvas.background = value; }
      }
    };
  }

  /* Shape (one per canvas), its corner when rounded, how it shows, and the
     background under everything. */
  function canvasShapeRows() {
    var canvas = state.spec.canvas;
    var rows = [];
    var shapes = window.LayerStack.CHOICES['canvas.shape'].map(function (choice) { return [choice[0], SHORT_CHOICES['canvas.shape'][choice[0]] || choice[1]]; });
    rows.push(choiceRow('shape', FIELD_LABELS.shape, shapes, canvas.shape, 'One outline for the piece: a circle avatar is a circle. It clips the specimen, the background and images under the specimen; the rules are never clipped.', handleCanvasShape));
    if (canvas.shape === 'rounded') { rows.push(canvasRadiusRow()); }
    if (canvas.shape !== 'rectangle') { rows.push(shapeShowRow()); }
    // The palette leads with the tools' None chip (tool-colour.js): no
    // background, a transparent canvas.
    var colour = swatchField(canvasProxy(), { label: FIELD_LABELS.background, none: true });
    colour.dataset.field = 'colour';
    rows.push(colour);
    var hex = hexField(canvasProxy());
    hex.dataset.field = 'colourHex';
    rows.push(hex);
    return rows;
  }

  function canvasRadiusRow() {
    var id = fieldId('radius');
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.min = '0';
    input.max = '50';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.value = fmt(state.spec.canvas.radius);
    var box = document.createElement('div');
    box.className = 'field';
    box.appendChild(affix('R'));
    box.appendChild(input);
    box.appendChild(affix('%'));
    var error = errorLine(id);
    input.addEventListener('input', function handleCanvasRadius() {
      var n = Number(input.value);
      if (input.value === '' || !(n >= 0 && n <= 50)) {
        setInvalid(input, error);
        showFieldError(error, 'Use a number from 0 to 50.');
        return;
      }
      setInvalid(input, null);
      showFieldError(error, '');
      state.spec.canvas.radius = n;
      render();
    });
    var block = wrap(FIELD_LABELS.radius, box, FIELD_HINTS.radius, id);
    block.appendChild(error);
    block.dataset.field = 'radius';
    return block;
  }

  /* Show: any of three, so three switches rather than one choice. */
  function shapeShowRow() {
    var id = fieldId('shapeShow');
    var block = document.createElement('div');
    block.className = 'block gap-s';
    block.dataset.field = 'shapeShow';
    block.setAttribute('role', 'group');
    block.setAttribute('aria-labelledby', id + '-caption');
    block.appendChild(labelRow(FIELD_LABELS.shapeShow, '', id, true));
    var show = state.spec.canvas.shapeShow;
    [['outside', 'Shade what it cuts away'], ['inside', 'Shade what stays'], ['outline', 'Outline']].forEach(function (option) {
      var switchId = fieldId('show-' + option[0]);
      var row = document.createElement('div');
      row.className = 'form-toggle';
      row.setAttribute('data-variant', 'mono');
      row.innerHTML = '<input type="checkbox" role="switch" id="' + switchId + '"' + (show.indexOf(option[0]) !== -1 ? ' checked' : '') + '><label for="' + switchId + '"></label>';
      row.querySelector('label').textContent = option[1];
      row.querySelector('input').addEventListener('change', function handleShapeShow(event) {
        var list = state.spec.canvas.shapeShow.filter(function (value) { return value !== option[0]; });
        if (event.target.checked) { list.push(option[0]); }
        // Kept in the engine's order, so the spec reads the same however it
        // was set.
        state.spec.canvas.shapeShow = ['outside', 'inside', 'outline'].filter(function (value) { return list.indexOf(value) !== -1; });
        render();
      });
      block.appendChild(row);
    });
    return block;
  }

  function handleCanvasShape(value) {
    state.spec.canvas.shape = value;
    // A shape with nothing to show it would clip silently: the outline
    // comes on with the first shape.
    if (value !== 'rectangle' && !state.spec.canvas.shapeShow.length) { state.spec.canvas.shapeShow = ['outline']; }
    render();
    renderSettings();
    var again = el.settings.querySelector('[data-field="shape"] input:checked');
    if (again) { again.focus(); }
    announce('Canvas shape ' + (SHORT_CHOICES['canvas.shape'][value] || value).toLowerCase() + '. ' + shownFieldsMessage());
  }

  /* A first step, not a setting: applied by its button, not on change —
     a template replaces the whole spec, and arrowing through a select
     fires change on every step in some browsers. */
  function templateRow() {
    var id = fieldId('template');
    var row = document.createElement('div');
    row.className = 'tool-add';
    var select = document.createElement('select');
    select.id = id;
    fillTemplates(select);
    var apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'button';
    apply.setAttribute('data-variant', 'outline');
    apply.textContent = 'Start';
    apply.addEventListener('click', handleTemplateChange);
    row.appendChild(select);
    row.appendChild(apply);
    canvasEl.template = select;
    var block = wrap('Template', row, '', id);
    block.dataset.field = 'template';
    return block;
  }

  /* Hug artwork, the presets, then Custom: a typed size is one, and reads
     as one. Hug needs an artwork to hug; without one it is offered but
     cannot be chosen, and the hint says why. */
  function sizeRow() {
    var id = fieldId('size');
    var select = document.createElement('select');
    select.id = id;
    var hug = new Option(canvasEl.hasArtwork ? 'Hug specimen' : 'Hug specimen (no specimen yet)', HUG);
    hug.disabled = !canvasEl.hasArtwork;
    select.appendChild(hug);
    SIZE_PRESETS.forEach(function (preset, index) { select.appendChild(new Option(preset.label, String(index))); });
    select.appendChild(new Option('Custom', 'custom'));
    select.addEventListener('change', handleSizeSelect);
    canvasEl.size = select;
    var block = wrap('Size', select, 'Hug specimen: the canvas takes the specimen\'s own size, so an icon\'s canvas is its 24 × 24 frame. Choose one on the Specimen layer to use it.', id);
    block.dataset.field = 'size';
    return block;
  }

  function dimensionsRow() {
    var id = fieldId('dimensions');
    var block = document.createElement('div');
    block.className = 'block gap-s';
    block.setAttribute('role', 'group');
    block.setAttribute('aria-labelledby', id + '-caption');
    block.dataset.field = 'dimensions';
    block.appendChild(labelRow('Dimensions', '', id, true));
    var pair = document.createElement('div');
    pair.className = 'tool-pair';
    [['width', 'W'], ['height', 'H']].forEach(function (side) {
      var field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<span class="field-affix" aria-hidden="true">' + side[1] + '</span>' +
        '<input type="number" min="1" max="10000" step="1" inputmode="numeric">' +
        '<span class="field-affix" aria-hidden="true">px</span>';
      var input = field.querySelector('input');
      input.id = fieldId(side[0]);
      input.setAttribute('aria-label', 'Canvas ' + side[0] + ' (' + side[1] + '), px');
      // The hint says why the size is read-only, or how it scales.
      input.setAttribute('aria-describedby', id + '-hint');
      input.addEventListener('change', handleSizeInput);
      canvasEl[side[0]] = input;
      pair.appendChild(field);
    });
    block.appendChild(pair);
    var error = document.createElement('p');
    error.className = 'form-error';
    error.id = id + '-error';
    error.setAttribute('role', 'alert');
    var hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.id = id + '-hint';
    var makeReference = document.createElement('button');
    makeReference.type = 'button';
    makeReference.className = 'button is-hidden';
    makeReference.setAttribute('data-variant', 'outline');
    makeReference.setAttribute('data-size', 'small');
    makeReference.textContent = 'Write the spec at this size';
    makeReference.addEventListener('click', handleMakeReference);
    block.appendChild(error);
    block.appendChild(hint);
    block.appendChild(makeReference);
    canvasEl.sizeError = error;
    canvasEl.sizeHint = hint;
    canvasEl.makeReference = makeReference;
    return block;
  }

  /* Brings the canvas settings up to date. A change that adds or drops a
     row (the template going) or makes Hug possible or not rebuilds them.
     While the canvas hugs, W and H are read-only: the artwork's size. */
  function syncCanvasPanel() {
    if (!canvasEl || state.selectedId !== CANVAS_ID) { return; }
    if (canvasEl.unchosen !== isUnchosen() || canvasEl.hasArtwork !== !!currentArtwork()) { renderSettings(); return; }
    var spec = state.spec;
    var hug = hugs();
    [canvasEl.width, canvasEl.height].forEach(function (input) { input.readOnly = hug; });
    // Not while the person is typing in it: the value would jump under them.
    if (document.activeElement !== canvasEl.width || hug) { canvasEl.width.value = fmt(spec.canvas.w); }
    if (document.activeElement !== canvasEl.height || hug) { canvasEl.height.value = fmt(spec.canvas.h); }
    var preset = SIZE_PRESETS.map(function (entry) { return entry.w === spec.canvas.w && entry.h === spec.canvas.h; }).indexOf(true);
    canvasEl.size.value = hug ? HUG : preset === -1 ? 'custom' : String(preset);
  }

  function handleTemplateChange() {
    // A spec with something in it is replaced only after asking.
    if (!isUnchosen()) { handleNewFromTemplate(); return; }
    var id = canvasEl && canvasEl.template ? canvasEl.template.value : '';
    if (!id) {
      announce('Choose a template first.');
      if (canvasEl && canvasEl.template) { canvasEl.template.focus(); }
      return;
    }
    loadSpec(window.LayerStack.createSpec(id), 'Started from ' + window.LayerStack.TEMPLATES[id].label + '.');
    // The row that held the button hides with a chosen spec.
    focusAfterTemplate();
  }

  /* After a template, focus goes to the selected row, the canvas's;
     failing that, the list. Never to the page. */
  function focusAfterTemplate() {
    var target = el.list.querySelector('.tool-layer.is-active .tool-layer-name') || el.root.querySelector('#al-layers-heading');
    if (target) { target.focus({ preventScroll: true }); }
  }

  /* New spec, on the bar. Always the dialog, so the button behaves the
     same whatever the spec holds: a tile per template, as Add layer has a
     tile per type, and the tile picked starts the spec — no second step.
     The warning shows only when there is something to replace. Built once
     and appended to <body>, outside the Barba container; release()
     removes it. */
  function handleNewFromTemplate() {
    var dialog = templateDialogElement();
    templateTrigger = el.newTemplate;
    var unchosen = isUnchosen();
    dialog.querySelector('#al-template-dialog-text').classList.toggle('is-hidden', unchosen);
    // A hidden warning is not read either.
    if (unchosen) { dialog.removeAttribute('aria-describedby'); } else { dialog.setAttribute('aria-describedby', 'al-template-dialog-text'); }
    dialog.showModal();
  }

  function templateDialogElement() {
    if (templateDialog && templateDialog.isConnected) { return templateDialog; }
    var dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.id = 'al-template-dialog';
    dialog.setAttribute('aria-labelledby', 'al-template-dialog-title');
    dialog.innerHTML =
      '<div class="dialog-header">' +
        '<h2 class="dialog-title" id="al-template-dialog-title">New spec</h2>' +
        '<button class="button close-btn" type="button" data-icon-only data-size="small" data-dialog-close aria-label="Close">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="dialog-body block gap-s">' +
        '<p id="al-template-dialog-text">A template replaces the canvas, the specimen and every layer. There is no undo; a spec you downloaded keeps its copy.</p>' +
        '<div class="tool-types" data-columns="3"></div>' +
      '</div>';
    var grid = dialog.querySelector('.tool-types');
    Object.keys(window.LayerStack.TEMPLATES).forEach(function (id, index) {
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tool-tile';
      tile.dataset.template = id;
      // The first tile, not the close button: picking is the task.
      if (index === 0) { tile.autofocus = true; }
      tile.innerHTML = '<span class="tool-type-icon" aria-hidden="true">' + icon(TEMPLATE_ICONS[id] || 'square') + '</span><span></span>';
      tile.lastChild.textContent = window.LayerStack.TEMPLATES[id].label;
      grid.appendChild(tile);
    });
    grid.addEventListener('click', handleTemplatePick);
    dialog.addEventListener('close', handleTemplateDialogClose);
    document.body.appendChild(dialog);
    templateDialog = dialog;
    return dialog;
  }

  function handleTemplatePick(event) {
    var tile = event.target.closest('.tool-tile');
    if (!tile) { return; }
    var id = tile.dataset.template;
    // The spec it opened from is gone; focus goes to the layer list.
    templateTrigger = null;
    templateDialog.close();
    if (!state || !window.LayerStack.TEMPLATES[id]) { return; }
    loadSpec(window.LayerStack.createSpec(id), 'Started from ' + window.LayerStack.TEMPLATES[id].label + '.');
    focusAfterTemplate();
  }

  function handleTemplateDialogClose() {
    if (templateTrigger && templateTrigger.isConnected && el && el.root && el.root.isConnected && !document.body.classList.contains('is-animating')) {
      templateTrigger.focus({ preventScroll: true });
    }
    templateTrigger = null;
  }

  function fillTemplates(select) {
    select.innerHTML = '';
    select.appendChild(new Option('Choose a template', ''));
    Object.keys(window.LayerStack.TEMPLATES).forEach(function (id) {
      select.appendChild(new Option(window.LayerStack.TEMPLATES[id].label, id));
    });
  }

  /* An alert line, which is never display:none: tools.css clips it while it
     is empty, so it stays in the accessibility tree and announces when the
     text arrives. Emptied first and written a frame later, so the same
     message twice is read twice. Cleared with '', never ' ' (:empty). */
  function writeAlert(node, message) {
    if (!node) { return; }
    // A write still waiting for its frame is cancelled, so a clear that
    // follows a show in the same frame wins.
    if (node.alAlertFrame) { window.cancelAnimationFrame(node.alAlertFrame); node.alAlertFrame = null; }
    node.textContent = '';
    if (message) {
      node.alAlertFrame = window.requestAnimationFrame(function writeAlertText() { node.alAlertFrame = null; node.textContent = message; });
    }
  }

  /* A field's own error line: an alert is written in place; a plain line,
     read through aria-describedby, is shown with text and hidden without. */
  function showFieldError(node, message) {
    if (!node) { return; }
    if (node.getAttribute('role') === 'alert') { writeAlert(node, message); return; }
    node.textContent = message;
    node.classList.toggle('is-hidden', !message);
  }

  /* Mark an input invalid and point it at the error that says why, or
     clear both. Keeps any hint the input already described. */
  function setInvalid(input, errorNode) {
    var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    var errorId = errorNode ? errorNode.id : null;
    ids = ids.filter(function (id) { return !/-error$/.test(id); });
    if (errorId) {
      // aria-invalid is for form controls; a button (a file picker) carries
      // the error by its description alone.
      if (input.tagName !== 'BUTTON') { input.setAttribute('aria-invalid', 'true'); }
      ids.push(errorId);
    } else {
      input.removeAttribute('aria-invalid');
    }
    if (ids.length) { input.setAttribute('aria-describedby', ids.join(' ')); } else { input.removeAttribute('aria-describedby'); }
  }

  function handleSizeInput() {
    var w = Number(canvasEl.width.value);
    var h = Number(canvasEl.height.value);
    var bad = [];
    if (!(w >= 1 && w <= 10000)) { bad.push(canvasEl.width); }
    if (!(h >= 1 && h <= 10000)) { bad.push(canvasEl.height); }
    [canvasEl.width, canvasEl.height].forEach(function (input) { setInvalid(input, bad.indexOf(input) !== -1 ? canvasEl.sizeError : null); });
    if (bad.length) {
      showFieldError(canvasEl.sizeError, 'Width and height run from 1 to 10000.');
      return;
    }
    showFieldError(canvasEl.sizeError, '');
    state.spec.canvas.w = w;
    state.spec.canvas.h = h;
    render();
    syncCanvasPanel();
  }

  /* The Size menu. Hug artwork hands the size to the artwork, and the
     placement it had comes back when the canvas takes a size again. Custom
     changes no number: they are the person's to type, and come next in the
     tab order. Focus stays put — some browsers fire change on every arrow
     through the menu. */
  function handleSizeSelect() {
    var value = canvasEl.size.value;
    var canvas = state.spec.canvas;
    if (value === HUG) {
      if (!currentArtwork()) { return; }
      if (canvas.fit !== 'fit-artwork') { state.placementBeforeHug = canvas.fit; }
      canvas.fit = 'fit-artwork';
      setInvalid(canvasEl.width, null);
      setInvalid(canvasEl.height, null);
      showFieldError(canvasEl.sizeError, '');
      render();
      syncCanvasPanel();
      announce('The canvas hugs the specimen, at ' + fmt(canvas.w) + ' by ' + fmt(canvas.h) + '.');
      return;
    }
    if (canvas.fit === 'fit-artwork') { canvas.fit = state.placementBeforeHug || 'contain'; }
    var preset = SIZE_PRESETS[Number(value)];
    if (!preset) {
      // Custom: the hugged size stays, now the person's to change.
      render();
      syncCanvasPanel();
      return;
    }
    state.spec.canvas.w = preset.w;
    state.spec.canvas.h = preset.h;
    setInvalid(canvasEl.width, null);
    setInvalid(canvasEl.height, null);
    showFieldError(canvasEl.sizeError, '');
    render();
    syncCanvasPanel();
  }

  /* Write the spec at the size it is drawn: px lengths stop scaling. */
  function handleMakeReference() {
    var spec = state.spec;
    var k = spec.canvas.w / spec.reference.w;
    // Every px length is written at the new size. One bound to a token is
    // unbound at its scaled value: the token is in the old size's units,
    // and following it on would change the drawing.
    window.LayerStack.flatLayers(spec).forEach(function (layer) {
      // A locked platform rule keeps its lengths as published.
      if (layer.locked) { return; }
      Object.keys(LENGTH_FIELDS).forEach(function (key) {
        // Overshoot is in the specimen's own units, not the canvas's, and a
        // line weight is screen pixels: neither scales with the canvas.
        if (key.indexOf('overshoot') === 0 || key === 'lineWeight') { return; }
        var length = layer.settings[key];
        if (typeof length === 'number') {
          layer.settings[key] = { value: Math.round(length * k * 100) / 100, unit: 'px' };
          return;
        }
        if (!length || typeof length !== 'object' || (length.unit || 'px') !== 'px') { return; }
        var resolved = window.LayerStack.resolveLength(length, 'px', el.stage);
        layer.settings[key] = { value: Math.round(resolved.number * k * 100) / 100, unit: 'px' };
      });
    });
    spec.reference = { w: spec.canvas.w, h: spec.canvas.h };
    render();
    // A layer's px lengths were rewritten; the canvas's own settings are
    // brought up to date by render, and keep the focus moved below.
    if (state.selectedId && state.selectedId !== CANVAS_ID) { renderSettings(); }
    // The button leaves with the scaling it offered to fix; focus goes to the
    // size it wrote the spec at, not to the page.
    if (canvasEl && canvasEl.width) { canvasEl.width.focus(); }
    announce('The spec is now written at ' + fmt(spec.canvas.w) + ' by ' + fmt(spec.canvas.h) + '.');
  }

  //
  //------- Layer list -------//
  //

  function icon(name) {
    var source = el.icons.content.querySelector('[data-icon-name="' + name + '"]');
    return source ? source.innerHTML : '';
  }

  /* Where an id sits: the entry, the array holding it, its index there and
     its group (null at the top level). Groups are one level deep. */
  function locate(id) {
    var top = state.spec.layers;
    for (var i = 0; i < top.length; i += 1) {
      if (top[i].id === id) { return { entry: top[i], list: top, index: i, group: null }; }
      if (top[i].type === 'group') {
        var inner = top[i].layers;
        for (var j = 0; j < inner.length; j += 1) {
          if (inner[j].id === id) { return { entry: inner[j], list: inner, index: j, group: top[i] }; }
        }
      }
    }
    return null;
  }

  /* A layer or a group, by id. */
  function layerById(id) {
    var at = id ? locate(id) : null;
    return at ? at.entry : null;
  }

  function layerCount(n) {
    return n + (n === 1 ? ' layer' : ' layers');
  }

  function typeLabel(layer) {
    if (layer.type === 'canvas') { return fmt(state.spec.canvas.w) + ' × ' + fmt(state.spec.canvas.h); }
    if (layer.type === 'group') { return 'Group · ' + layerCount(layer.layers.length); }
    return window.LayerStack.TYPES[layer.type].label;
  }

  /* Top of the list is the top of the drawing, so the stack is listed in
     reverse. */
  /* A group is a list item holding its header row and a list of its own
     layers, so the nesting is real to a screen reader, not only indented.
     A layer in a group can always move: past the group's edge it steps out. */
  function renderList(focusId, focusRole) {
    var layers = state.spec.layers;
    // A row about to take focus is never left inside a folded group: a
    // layer moved into one, or chosen. (The selection alone is not enough:
    // a fold made with the selection inside moves it to the group.)
    var focusAt = focusId ? locate(focusId) : null;
    if (focusAt && focusAt.group) { delete state.folded[focusAt.group.id]; }
    el.list.innerHTML = '';
    for (var i = layers.length - 1; i >= 0; i -= 1) {
      el.list.appendChild(layers[i].type === 'group' ? groupItem(layers[i]) : listItem(layers[i], {}));
    }
    el.list.appendChild(canvasItem());
    if (focusId) {
      var row = el.list.querySelector('.tool-layer[data-id="' + focusId + '"]');
      var target = row ? row.querySelector('[data-role="' + (focusRole || 'select') + '"]') : null;
      // The artwork's delete and the canvas's eye are disabled: the name
      // takes focus instead.
      if (target && target.disabled) { target = row.querySelector('[data-role="select"]'); }
      if (target) { target.focus(); }
    }
  }

  /* The pinned list scrolls inside its section (tools.css, Pinned section),
     so a row that changes without taking focus — a layer just added — is
     scrolled into the list's view by hand, clear of the add row stuck over
     it. Only the list moves: scrollIntoView would scroll the column and
     the page as well. Nothing to do while the section does not scroll. */
  function revealRow(id) {
    var row = id ? el.list.querySelector('.tool-layer[data-id="' + id + '"]') : null;
    var scroller = el.list.closest('.tool-panel-body');
    if (!row || !scroller || !/auto|scroll/.test(window.getComputedStyle(scroller).overflowY)) { return; }
    var pad = parseFloat(window.getComputedStyle(scroller).scrollPaddingBlockStart) || 0;
    var box = row.getBoundingClientRect();
    var view = scroller.getBoundingClientRect();
    if (box.top < view.top + pad) {
      scroller.scrollTop -= view.top + pad - box.top;
    } else if (box.bottom > view.bottom) {
      scroller.scrollTop += box.bottom - view.bottom;
    }
  }

  function groupItem(group) {
    var li = document.createElement('li');
    li.className = 'tool-layer-group';
    li.dataset.groupId = group.id;
    li.appendChild(listItem(group, {}, 'div'));
    var list = document.createElement('ol');
    list.className = 'tool-layers tool-layer-children';
    list.id = 'al-children-' + group.id;
    list.hidden = !!state.folded[group.id];
    list.setAttribute('aria-labelledby', 'al-name-' + group.id);
    for (var i = group.layers.length - 1; i >= 0; i -= 1) {
      list.appendChild(listItem(group.layers[i], { groupHidden: !group.visible }));
    }
    if (!group.layers.length) {
      var empty = document.createElement('li');
      empty.className = 'tool-layers-empty form-hint';
      empty.textContent = 'Empty. Select the group and add a layer, or move one in with its arrows.';
      list.appendChild(empty);
    }
    li.appendChild(list);
    return li;
  }

  /* The canvas: always the bottom row, the ground under the stack. Its
     eye and delete are spacers that keep the columns lined up, and it does
     not move. */
  function canvasItem() {
    var li = listItem({ id: CANVAS_ID, type: 'canvas', label: 'Canvas', visible: true }, { fixed: true });
    li.querySelector('[data-role="eye"]').disabled = true;
    li.querySelector('[data-role="delete"]').disabled = true;
    return li;
  }

  function listItem(layer, opts, tag) {
    var li = document.createElement(tag || 'li');
    li.className = 'tool-layer';
    li.dataset.id = layer.id;
    li.dataset.type = layer.type;
    if (layer.id === state.selectedId) { li.classList.add('is-active'); }
    li.innerHTML =
      (layer.type === 'group'
        // A group's icon is its fold: an open folder while its layers show,
        // a closed one while they are folded away. The row's xsmall icon
        // button, like the eye beside it, so it reads as one and washes on
        // hover. A finger still drags the group by it, as by any row's grip.
        ? '<button type="button" class="button tool-layer-grip" data-variant="transparent" data-size="xsmall" data-icon-only data-role="fold" aria-controls="al-children-' + layer.id + '"></button>'
        : '<span class="tool-layer-grip" data-role="grip" aria-hidden="true">' + icon(TYPE_ICONS[layer.type] || 'menu') + '</span>') +
      '<button type="button" class="tool-layer-name" data-role="select"' + (opts.fixed ? '' : ' aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-describedby="al-list-hint"') + (layer.id === state.selectedId ? ' aria-current="true"' : '') + '>' +
        '<span class="tool-layer-label"></span><span class="visually-hidden">, </span><span class="tool-layer-type"></span>' +
        // Its own eye stays as set; the group's eye is what hides it.
        (opts.groupHidden ? '<span class="visually-hidden">, hidden with its group</span>' : '') +
        (layer.locked ? '<span class="visually-hidden">, locked</span>' : '') +
      '</button>' +
      '<button type="button" class="button" data-variant="transparent" data-size="xsmall" data-icon-only data-role="eye" aria-pressed="' + (layer.visible ? 'true' : 'false') + '"></button>' +
      // The artwork is always one layer: its delete is a hidden spacer that
      // keeps the column lined up (tools: visibility hidden, out of the
      // tab order and the accessibility tree).
      '<button type="button" class="button" data-variant="transparent" data-size="xsmall" data-icon-only data-role="delete"' + (layer.type === 'specimen' || layer.locked ? ' disabled' : '') + '></button>';
    var eye = li.querySelector('[data-role="eye"]');
    eye.innerHTML = icon(layer.visible ? 'eye' : 'eye-off');
    eye.setAttribute('aria-label', 'Show ' + layer.label);
    li.querySelector('.tool-layer-label').textContent = layer.label;
    // A group's name labels the list of its layers.
    if (layer.type === 'group') { li.querySelector('.tool-layer-label').id = 'al-name-' + layer.id; }
    li.querySelector('.tool-layer-type').textContent = typeLabel(layer);
    var remove = li.querySelector('[data-role="delete"]');
    remove.innerHTML = icon('trash');
    remove.setAttribute('aria-label', 'Delete ' + layer.label);
    var fold = li.querySelector('[data-role="fold"]');
    if (fold) { syncFold(fold, layer); }
    return li;
  }

  /* Folding is the list's own view, not the spec: nothing redraws, and the
     group stays as selected as it was — unless the selected layer is one
     it folds away, when the group takes the selection, so what Settings
     shows is still a row in view. Reached from the button's click (the
     keyboard) and from a press on it that never became a drag (endDrag):
     the row holds the pointer, so a mouse's click lands on the row. */
  function toggleFold(id) {
    var group = layerById(id);
    if (!group || group.type !== 'group') { return; }
    state.folded[id] = !state.folded[id];
    var held = state.folded[id] && group.layers.some(function (child) { return child.id === state.selectedId; });
    if (held) {
      state.selectedId = id;
      renderList(id, 'fold');
      renderSettings();
      return;
    }
    var children = el.list.querySelector('#al-children-' + id);
    if (children) { children.hidden = !!state.folded[id]; }
    var button = el.list.querySelector('.tool-layer[data-id="' + id + '"] [data-role="fold"]');
    if (button) { syncFold(button, group); }
  }

  /* The name stays put and aria-expanded says which way it is, so the
     state is announced once (the Controls toggle does the same). */
  function syncFold(button, group) {
    var open = !state.folded[group.id];
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', 'Layers in ' + group.label);
    button.innerHTML = icon(open ? 'folder-open' : 'folder');
  }

  function handleListClick(event) {
    // The click that ends a drag is not a choice.
    if (justDragged) { return; }
    var button = event.target.closest('button[data-role]');
    // The row is the drag handle, so a press on its edge or its grip
    // selects it, as a press on its name does.
    if (!button) {
      var row = event.target.closest('.tool-layer');
      if (row) { select(row.dataset.id); }
      return;
    }
    if (button.disabled) { return; }
    var item = button.closest('.tool-layer');
    var id = item.dataset.id;
    var role = button.dataset.role;
    if (id === CANVAS_ID) {
      if (role === 'select') { select(id); }
      return;
    }
    var layer = layerById(id);
    if (!layer) { return; }
    if (role === 'eye') {
      layer.visible = !layer.visible;
      render();
      // A group's layers say whether it hides them: redrawn, focus kept.
      if (layer.type === 'group') { renderList(id, 'eye'); return; }
      // Updated in place: the pressed state is the announcement.
      button.setAttribute('aria-pressed', layer.visible ? 'true' : 'false');
      button.innerHTML = icon(layer.visible ? 'eye' : 'eye-off');
    } else if (role === 'fold') {
      toggleFold(id);
    } else if (role === 'select') {
      select(id);
    } else if (role === 'delete') {
      confirmDelete(id, button);
    }
  }

  function handleListKeydown(event) {
    // A press still pending on a row owns the list until it is released:
    // redrawing under it would strand its pointer capture.
    if (drag) { return; }
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) { return; }
    var item = event.target.closest('.tool-layer');
    if (!item) { return; }
    event.preventDefault();
    if (item.dataset.id === CANVAS_ID) {
      announce('The canvas stays at the bottom, under every layer.');
      return;
    }
    moveLayer(item.dataset.id, event.key === 'ArrowUp' ? 1 : -1, event.target.dataset.role || 'select');
  }

  /* direction is in stack terms: +1 is towards the top of the drawing. One
     step at a time: a layer in a group moves within it and, past its edge,
     steps out beside it; a layer at the top level meeting a group steps
     into it at that edge. A group, and the artwork, move past a group whole. */
  function moveLayer(id, direction, focusRole) {
    var at = locate(id);
    if (!at) { return; }
    var top = state.spec.layers;
    var entry = at.entry;
    var message;
    if (at.group) {
      var to = at.index + direction;
      at.list.splice(at.index, 1);
      if (to >= 0 && to <= at.list.length) {
        at.list.splice(to, 0, entry);
        message = entry.label + ' moved to ' + placeText(entry.id) + '.';
      } else {
        var g = top.indexOf(at.group);
        top.splice(direction > 0 ? g + 1 : g, 0, entry);
        message = entry.label + ' moved out of ' + at.group.label + ', to ' + placeText(entry.id) + '.';
      }
    } else {
      var n = at.index + direction;
      if (n < 0 || n >= top.length) {
        announce(entry.label + ' is already at the ' + (n < 0 ? 'bottom.' : 'top.'));
        return;
      }
      var neighbour = top[n];
      top.splice(at.index, 1);
      if (neighbour.type === 'group' && entry.type !== 'group' && entry.type !== 'specimen') {
        if (direction > 0) { neighbour.layers.unshift(entry); } else { neighbour.layers.push(entry); }
        message = entry.label + ' moved into ' + neighbour.label + ', ' + placeText(entry.id, true) + '.';
      } else {
        top.splice(n, 0, entry);
        message = entry.label + ' moved to ' + placeText(entry.id) + '.';
      }
    }
    render();
    renderList(id, focusRole);
    announce(message);
  }

  /* Where an entry now sits, as the list reads: top first. */
  function placeText(id, bare) {
    var at = locate(id);
    if (!at) { return ''; }
    var place = 'position ' + (at.list.length - at.index) + ' of ' + at.list.length;
    return at.group && !bare ? place + ' in ' + at.group.label : place;
  }

  //
  //------- Drag -------//
  //

  /* The World Clock's drag (world-clock.js): nothing lifts until the
     pointer travels DRAG_THRESHOLD; the row then follows it, held inside the
     list, and the rows it passes step aside to show where it will land. The
     stack changes once, on release; Escape or a lost pointer puts it back.

     A layer can land anywhere, a group's layers included. At a group's
     open end — under its last layer — the pointer's sideways travel picks
     in or out, and the row shows its indent as it goes. A group moves whole
     and the artwork never enters one, so both step among the top-level
     items only. Geometry is measured once, at the press.

     Held near the edge of whatever scrolls the list — the pinned section's
     body when wide, the column on a phone — the drag scrolls it, so a row
     can reach any place however long the list. Positions are worked in the
     list's own coordinates: the scroll travelled since the press is added to
     the pointer's, so the geometry measured at the press still holds. */
  /* The whole row lifts, bar its eye and delete. With a finger or a pen
     only the grip does: anywhere else a swipe over the list has to scroll
     the column, and the grip alone sets touch-action none
     (layout-specs.css). */
  function handleGripDown(event) {
    var row = event.target.closest('.tool-layer');
    if (!row || event.button !== 0 || drag) { return; }
    if (event.target.closest('[data-role="eye"], [data-role="delete"]')) { return; }
    if (event.pointerType !== 'mouse' && !event.target.closest('[data-role="grip"], [data-role="fold"]')) { return; }
    // The row holds the capture, so the drag outlives the name button
    // under the pointer.
    var handle = row;
    var at = locate(row.dataset.id);
    if (!at) { return; }
    event.preventDefault();
    var nested = at.entry.type !== 'group' && at.entry.type !== 'specimen';
    var unit = at.entry.type === 'group' ? row.parentElement : row;
    var canvasRow = el.list.querySelector('.tool-layer[data-id="' + CANVAS_ID + '"]');
    var nodes = (nested
      ? Array.prototype.slice.call(el.list.querySelectorAll('.tool-layer'))
      : Array.prototype.slice.call(el.list.children)).filter(function (node) { return node !== canvasRow && !node.closest('[hidden]'); });
    var scroller = listScroller();
    var box = unit.getBoundingClientRect();
    var centre = box.top + box.height / 2;
    var units = nodes.filter(function (node) { return node !== unit; }).map(function (node) {
      var id = node.dataset.id || node.dataset.groupId;
      var place = locate(id);
      var rect = node.getBoundingClientRect();
      return {
        node: node,
        id: id,
        centre: rect.top + rect.height / 2,
        // The group a row is in, or heads.
        group: place && place.group ? place.group.id : null,
        header: place && place.entry.type === 'group' ? place.entry.id : null
      };
    });
    var from = units.filter(function (u) { return u.centre < centre; }).length;
    // Rows differ in height (a group is several), so a row is passed when
    // the leading edge crosses its middle, not the dragged centre.
    var listBox = el.list.getBoundingClientRect();
    var children = el.list.querySelector('.tool-layer-children');
    var indent = 0;
    if (children) {
      var cs = window.getComputedStyle(children);
      indent = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) || 0;
    }
    drag = {
      pointerId: event.pointerId,
      handle: handle,
      id: at.entry.id,
      unit: unit,
      nested: nested,
      active: false,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      foldPress: !!event.target.closest('[data-role="fold"]'),
      scroller: scroller,
      startScroll: scroller ? scroller.scrollTop : 0,
      autoFrame: 0,
      minY: listBox.top - box.top,
      // Never below the canvas: it is the ground.
      maxY: (canvasRow ? canvasRow.getBoundingClientRect().top : listBox.bottom) - box.bottom,
      // The gap of the list it leaves (layout-specs.css, Layer list).
      pitch: box.height + (parseFloat(window.getComputedStyle(unit.parentElement).rowGap) || 0),
      top: box.top,
      bottom: box.bottom,
      units: units,
      from: from,
      to: from,
      startDepth: at.group ? 1 : 0,
      depth: at.group ? 1 : 0,
      indent: indent
    };
    handle.setPointerCapture(event.pointerId);
    // A wheel scroll mid-drag moves the list under a still pointer.
    if (scroller) { scrollTarget(scroller).addEventListener('scroll', handleDragScroll, { passive: true }); }
    handle.addEventListener('pointermove', handleGripMove);
    handle.addEventListener('pointerup', handleGripUp);
    handle.addEventListener('pointercancel', handleGripCancel);
    handle.addEventListener('lostpointercapture', handleGripCancel);
  }

  /* Which group a drop at gap `to` goes into: between a group's rows it is
     in that group; under a group's last row (its open end) it may be in or
     out; anywhere else it is at the top level. */
  function dropPlace(d, to) {
    var above = d.units[to - 1];
    var below = d.units[to];
    if (below && below.group) { return { group: below.group, choice: false }; }
    // A folded group has no open end: a row dropped under it stays out.
    var openEnd = above ? (above.header || above.group) : null;
    if (openEnd && state.folded[openEnd]) { openEnd = null; }
    if (openEnd) { return { group: openEnd, choice: true }; }
    return { group: null, choice: false };
  }

  /* The nearest ancestor that scrolls the list now, or none. Inside the
     stuck Layers section that is its body or nothing: the column scrolling
     under it does not move the list, so it must never be the one scrolled. */
  function listScroller() {
    var pinned = el.list.closest('.tool-panel[data-pinned]');
    if (pinned && window.getComputedStyle(pinned).position === 'sticky') {
      var body = el.list.closest('.tool-panel-body');
      return body && body.scrollHeight > body.clientHeight + 1 ? body : null;
    }
    for (var node = el.list.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/auto|scroll/.test(window.getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) { return node; }
    }
    // Stacked under the preview (a phone), the page itself scrolls the list.
    var page = document.scrollingElement;
    return page && page.scrollHeight > page.clientHeight + 1 ? page : null;
  }

  // The page's scroll events fire on the window, not the root element.
  function scrollTarget(scroller) {
    return scroller === document.scrollingElement ? window : scroller;
  }

  /* The box the list scrolls in, on screen. The page's runs from under the
     stuck bar to the window's foot, or to the dock's verbs while they stick
     there (tools.css, data-actions="pinned"). */
  function scrollView(scroller) {
    if (scroller !== document.scrollingElement) { return scroller.getBoundingClientRect(); }
    var bar = el.root.querySelector('.bar');
    var actions = el.list.closest('.tool-dock') && el.list.closest('.tool-dock').querySelector('.tool-actions');
    var stuck = actions && window.getComputedStyle(actions).position === 'sticky';
    return {
      top: bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0,
      bottom: stuck ? actions.getBoundingClientRect().top : window.innerHeight
    };
  }

  function handleDragScroll() {
    if (drag && drag.active) { positionDrag(); }
  }

  function scrolledSince(d) {
    return d.scroller ? d.scroller.scrollTop - d.startScroll : 0;
  }

  function handleGripMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) { return; }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active) {
      if (Math.abs(drag.y - drag.startY) < DRAG_THRESHOLD && Math.abs(drag.x - drag.startX) < DRAG_THRESHOLD) { return; }
      drag.active = true;
      drag.unit.classList.add('is-dragging');
      el.list.classList.add('is-sorting');
      window.addEventListener('keydown', handleDragKeydown, true);
    }
    positionDrag();
    autoScroll();
  }

  /* How fast to scroll for where the pointer is: negative up, 0 outside
     the edge zones. The top zone starts under the add row stuck over the
     list (its scroll padding). */
  function edgeSpeed(d) {
    if (!d.scroller || !d.active) { return 0; }
    var view = scrollView(d.scroller);
    var top = view.top + (d.scroller === document.scrollingElement ? 0 : parseFloat(window.getComputedStyle(d.scroller).scrollPaddingBlockStart) || 0);
    var depth = 0;
    if (d.y < top + EDGE_ZONE) { depth = -(top + EDGE_ZONE - d.y); }
    if (d.y > view.bottom - EDGE_ZONE) { depth = d.y - (view.bottom - EDGE_ZONE); }
    if (!depth) { return 0; }
    var speed = Math.ceil(EDGE_SPEED * Math.min(1, Math.abs(depth) / EDGE_ZONE));
    return depth < 0 ? -speed : speed;
  }

  /* While the pointer rests in an edge zone, scroll a step a frame and
     place the row again; it stops when the pointer leaves the zone, the
     list reaches its end, or the drag ends. */
  function autoScroll() {
    if (!drag || drag.autoFrame || !edgeSpeed(drag)) { return; }
    drag.autoFrame = window.requestAnimationFrame(function stepAutoScroll() {
      if (!drag) { return; }
      drag.autoFrame = 0;
      var speed = edgeSpeed(drag);
      if (!speed) { return; }
      var before = drag.scroller.scrollTop;
      drag.scroller.scrollTop = before + speed;
      if (drag.scroller.scrollTop === before) { return; }
      positionDrag();
      autoScroll();
    });
  }

  function positionDrag() {
    var dx = drag.x - drag.startX;
    var dy = drag.y - drag.startY + scrolledSince(drag);
    dy = Math.max(drag.minY, Math.min(drag.maxY, dy));
    var edge = (dy < 0 ? drag.top : drag.bottom) + dy;
    var to = drag.units.filter(function (u) { return u.centre < edge; }).length;
    drag.to = to;
    if (drag.nested) {
      var place = dropPlace(drag, to);
      drag.depth = !place.group ? 0 : !place.choice ? 1 : (drag.startDepth * drag.indent + dx > drag.indent / 2 ? 1 : 0);
    }
    var shiftX = (drag.depth - drag.startDepth) * drag.indent;
    drag.unit.style.transform = 'translate(' + shiftX + 'px, ' + dy + 'px)';
    drag.units.forEach(function (u, i) {
      var shift = 0;
      if (i >= to && i < drag.from) { shift = drag.pitch; }
      if (i >= drag.from && i < to) { shift = -drag.pitch; }
      u.node.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  /* While a row is lifted every key waits, and Escape puts it back. */
  function handleDragKeydown(event) {
    if (!drag || !drag.active) { return; }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { endDrag(false); }
  }

  function handleGripUp(event) {
    if (drag && event.pointerId === drag.pointerId) { endDrag(true); }
  }

  function handleGripCancel(event) {
    if (drag && event.pointerId === drag.pointerId) { endDrag(false); }
  }

  /* commit null is a teardown (release): listeners off, nothing redrawn. */
  function endDrag(commit) {
    var state0 = drag;
    drag = null;
    var handle = state0.handle;
    handle.removeEventListener('pointermove', handleGripMove);
    handle.removeEventListener('pointerup', handleGripUp);
    handle.removeEventListener('pointercancel', handleGripCancel);
    handle.removeEventListener('lostpointercapture', handleGripCancel);
    window.removeEventListener('keydown', handleDragKeydown, true);
    if (state0.autoFrame) { window.cancelAnimationFrame(state0.autoFrame); }
    if (state0.scroller) { scrollTarget(state0.scroller).removeEventListener('scroll', handleDragScroll); }
    if (handle.hasPointerCapture && handle.hasPointerCapture(state0.pointerId)) { handle.releasePointerCapture(state0.pointerId); }
    if (!el || commit === null) { return; }
    el.list.classList.remove('is-sorting');
    state0.unit.classList.remove('is-dragging');
    state0.unit.style.transform = '';
    state0.units.forEach(function (u) { u.node.style.transform = ''; });
    // A press on a group's fold that never lifted is a press of the fold.
    // The click that follows is let pass, as after a drag.
    if (!state0.active && commit && state0.foldPress) {
      justDragged = true;
      window.setTimeout(function clearJustDragged() { justDragged = false; }, 0);
      toggleFold(state0.id);
      var fold = el.list.querySelector('.tool-layer[data-id="' + state0.id + '"] [data-role="fold"]');
      // The press held off the button's own focus (preventDefault); it
      // takes it now, without a ring, as a clicked button does.
      if (fold) { fold.focus({ focusVisible: false }); }
      return;
    }
    if (!state0.active) { return; }
    // Lifting ends in a click on whatever is under the release; it waits
    // a turn so handleListClick can see it and let it pass.
    justDragged = true;
    window.setTimeout(function clearJustDragged() { justDragged = false; }, 0);
    var moved = commit && (state0.to !== state0.from || state0.depth !== state0.startDepth) && dropEntry(state0);
    // The row the drag lifted keeps focus, wherever it landed.
    renderList(state0.id);
    if (moved) {
      render();
      var layer = layerById(state0.id);
      announce(layer.label + ' moved to ' + placeText(state0.id) + '.');
    }
  }

  /* Takes the dragged entry out and puts it in at the gap it was dropped
     on: above the row below that gap, or at the bottom of a group. */
  function dropEntry(d) {
    var at = locate(d.id);
    if (!at) { return false; }
    var below = d.units[d.to];
    var top = state.spec.layers;
    var group = null;
    if (d.nested) {
      var place = dropPlace(d, d.to);
      group = place.group && (!place.choice || d.depth === 1) ? layerById(place.group) : null;
    }
    at.list.splice(at.index, 1);
    if (group) {
      var inGroup = below && below.group === group.id ? group.layers.indexOf(layerById(below.id)) + 1 : 0;
      group.layers.splice(inGroup, 0, at.entry);
    } else {
      var belowEntry = below ? layerById(below.id) : null;
      top.splice(belowEntry ? top.indexOf(belowEntry) + 1 : 0, 0, at.entry);
    }
    return true;
  }

  //
  //------- Adding, selecting, removing -------//
  //

  /* Add layer asks for a type in a dialog, and the tile picked adds the
     layer: no second step. Built once and appended to <body>, outside the
     Barba container (dialog.md → Placement); release() removes it. */
  function handleAddClick() {
    addDialogElement().showModal();
  }

  function addDialogElement() {
    if (addDialog && addDialog.isConnected) { return addDialog; }
    var dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.id = 'al-add-dialog';
    dialog.setAttribute('aria-labelledby', 'al-add-dialog-title');
    dialog.innerHTML =
      '<div class="dialog-header">' +
        '<h2 class="dialog-title" id="al-add-dialog-title">Add layer</h2>' +
        '<button class="button close-btn" type="button" data-icon-only data-size="small" data-dialog-close aria-label="Close">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="dialog-body"><div class="tool-types"></div></div>';
    var grid = dialog.querySelector('.tool-types');
    ADD_MENU.forEach(function (entry, index) {
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tool-tile';
      tile.dataset.type = entry[0];
      // The first tile, not the close button: picking is the task.
      if (index === 0) { tile.autofocus = true; }
      tile.innerHTML = '<span class="tool-type-icon" aria-hidden="true">' + icon(TYPE_ICONS[entry[0]]) + '</span><span></span>';
      tile.lastChild.textContent = window.LayerStack.TYPES[entry[0]].label;
      grid.appendChild(tile);
    });
    grid.addEventListener('click', handleTypePick);
    dialog.addEventListener('close', handleAddDialogClose);
    document.body.appendChild(dialog);
    addDialog = dialog;
    return dialog;
  }

  function handleTypePick(event) {
    var tile = event.target.closest('.tool-tile');
    if (!tile) { return; }
    var entry = ADD_MENU.filter(function (item) { return item[0] === tile.dataset.type; })[0];
    addDialog.close();
    if (state && entry) { addLayer(entry[1][0]); }
  }

  /* Picked or cancelled, focus goes back to Add layer, ready for the next.
     Safari does not focus a button on click, so the browser cannot be left
     to do it. */
  function handleAddDialogClose() {
    if (el && el.add && el.add.isConnected && !document.body.classList.contains('is-animating')) {
      el.add.focus({ preventScroll: true });
    }
  }

  /* The first of a type's presets, or one Start from chose: this type's
     presets offered in Add layer, plus the one the layer came from when a
     template used a preset the menu leaves out. */
  function presetsFor(layer) {
    var entry = ADD_MENU.filter(function (item) { return item[0] === layer.type; })[0];
    var ids = entry ? entry[1].slice() : [];
    if (layer.preset && ids.indexOf(layer.preset) === -1 && window.LayerStack.PRESETS[layer.preset]) { ids.unshift(layer.preset); }
    return ids.filter(function (id) { return window.LayerStack.PRESETS[id]; });
  }

  function addLayer(presetId) {
    var layer = window.LayerStack.createLayer(presetId);
    if (layer.type === 'measure' && measuresZone(layer)) { layer.settings.zone = firstZoneId(); }
    var at = locate(state.selectedId);
    var message;
    if (at && at.entry.type === 'group') {
      // A selected group takes it on top of its layers; a layer in a group
      // takes it just above.
      at.entry.layers.push(layer);
      message = layer.label + ' added to ' + at.entry.label + '.';
    } else if (at && at.group) {
      at.list.splice(at.index + 1, 0, layer);
      message = layer.label + ' added to ' + at.group.label + ', above ' + at.entry.label + '.';
    } else {
      state.spec.layers.push(layer);
      message = layer.label + ' added on top.';
    }
    state.selectedId = layer.id;
    render();
    // No row takes focus: the dialog's close hands it to Add layer. The
    // new row is scrolled into the pinned list's view instead, its group
    // opened first if it was folded.
    var home = locate(layer.id).group;
    if (home) { delete state.folded[home.id]; }
    renderList();
    revealRow(layer.id);
    renderSettings();
    openSettings();
    announce(message);
  }

  /* A new group sits at the top level just above what is selected (above
     its group, for a layer in one), named the first free Group n. */
  function handleAddGroup() {
    var top = state.spec.layers;
    var names = top.map(function (entry) { return entry.label; });
    var n = 1;
    while (names.indexOf('Group ' + n) !== -1) { n += 1; }
    var group = window.LayerStack.createGroup('Group ' + n);
    var at = locate(state.selectedId);
    var index = at ? top.indexOf(at.group || at.entry) + 1 : top.length;
    top.splice(index, 0, group);
    state.selectedId = group.id;
    render();
    renderList(group.id);
    renderSettings();
    announce(group.label + ' added. Layers you add while it is selected go into it.');
  }

  /* Its layers return to the top level in its place, looking as they did:
     a hidden group's layers come out hidden. */
  function ungroup(id) {
    var at = locate(id);
    if (!at || at.entry.type !== 'group') { return; }
    var group = at.entry;
    if (!group.visible) { group.layers.forEach(function (layer) { layer.visible = false; }); }
    Array.prototype.splice.apply(at.list, [at.index, 1].concat(group.layers));
    var first = group.layers[group.layers.length - 1] || at.list[Math.min(at.index, at.list.length - 1)];
    state.selectedId = first ? first.id : null;
    render();
    renderList(state.selectedId);
    renderSettings();
    announce(group.label + ' ungrouped.' + (group.layers.length ? ' Its ' + layerCount(group.layers.length) + ' are back at the top level.' : ''));
  }

  function select(id) {
    state.selectedId = id;
    renderList(id);
    renderSettings();
    openSettings();
  }

  /* Choosing a layer is asking for its settings, so a closed Settings
     section opens. accordion.js has no API to open a section, so its own
     header is pressed — the one path that keeps its state and ARIA right. */
  function openSettings() {
    if (el.settingsHeading.getAttribute('aria-expanded') !== 'true') { el.settingsHeading.click(); }
  }

  function handleDuplicate() {
    var layer = layerById(state.selectedId);
    if (!layer || layer.type === 'specimen') { return; }
    var copy = window.LayerStack.duplicateLayer(layer);
    // A copy is the brand's own: it is not the platform's lock.
    delete copy.locked;
    if (copy.type === 'group') { copy.layers.forEach(function (child) { delete child.locked; }); }
    var at = locate(layer.id);
    at.list.splice(at.index + 1, 0, copy);
    state.selectedId = copy.id;
    render();
    renderList(copy.id);
    renderSettings();
    announce(copy.label + ' added above ' + layer.label + '.');
  }

  /* Deleting asks first, in a dialog. It is built once and appended to
     <body>, outside the Barba container (dialog.md → Placement), and
     removed again by release(). */
  function confirmDelete(id, trigger) {
    var layer = layerById(id);
    if (!layer || layer.type === 'specimen') { return; }
    if (layer.locked) { announce(layer.label + ' is locked: a platform rule, so it stays. Hide it with its eye instead.'); return; }
    if (layer.type === 'group' && layer.layers.some(function (child) { return child.locked; })) {
      announce(layer.label + ' holds a locked platform rule, so it stays. Ungroup it to delete the other layers.');
      return;
    }
    var dialog = deleteDialogElement();
    pendingDeleteId = id;
    deleteTrigger = trigger || null;
    var group = layer.type === 'group';
    var count = group ? layer.layers.length : 0;
    dialog.querySelector('.dialog-title').textContent = 'Delete ' + layer.label + (count ? ' and its ' + layerCount(count) : '') + '?';
    dialog.querySelector('#al-delete-text').textContent = group && count
      ? 'The group and its layers leave the stack and the spec. To keep the layers, ungroup it instead. There is no undo; a spec you downloaded keeps its copy.'
      : (group ? 'The group' : 'The layer') + ' leaves the stack and the spec. There is no undo; a spec you downloaded keeps its copy.';
    dialog.showModal();
  }

  function deleteDialogElement() {
    if (deleteDialog && deleteDialog.isConnected) { return deleteDialog; }
    var dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.id = 'al-delete-dialog';
    dialog.setAttribute('aria-labelledby', 'al-delete-title');
    dialog.setAttribute('aria-describedby', 'al-delete-text');
    dialog.innerHTML =
      '<div class="dialog-header">' +
        '<h2 class="dialog-title" id="al-delete-title"></h2>' +
        '<button class="button close-btn" type="button" data-icon-only data-size="small" data-dialog-close aria-label="Close">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="dialog-body"><p id="al-delete-text">The layer leaves the stack and the spec. There is no undo; a spec you downloaded keeps its copy.</p></div>' +
      '<div class="dialog-footer">' +
        '<button class="button" data-variant="faded" type="button" data-dialog-close autofocus>Cancel</button>' +
        '<button class="button" type="button" data-color="danger" data-role="confirm-delete">Delete</button>' +
      '</div>';
    dialog.querySelector('[data-role="confirm-delete"]').addEventListener('click', handleConfirmDelete);
    dialog.addEventListener('close', handleDeleteDialogClose);
    document.body.appendChild(dialog);
    deleteDialog = dialog;
    return dialog;
  }

  function handleConfirmDelete() {
    var id = pendingDeleteId;
    pendingDeleteId = null;
    // The trigger goes with the layer, so nothing to hand focus back to:
    // deleteLayer moves it to the row that takes the deleted one's place.
    deleteTrigger = null;
    deleteDialog.close();
    if (state && id) { deleteLayer(id); }
  }

  /* Cancelled: focus goes back to the button that asked. Safari does not
     focus a button on click, so the browser cannot be left to do it. */
  function handleDeleteDialogClose() {
    pendingDeleteId = null;
    // Not while a navigation closes it: the page is leaving.
    if (deleteTrigger && deleteTrigger.isConnected && el && el.root && el.root.isConnected && !document.body.classList.contains('is-animating')) {
      deleteTrigger.focus({ preventScroll: true });
    }
    deleteTrigger = null;
  }

  function deleteLayer(id) {
    var layer = layerById(id);
    if (!layer || layer.type === 'specimen') { return; }
    var at = locate(layer.id);
    at.list.splice(at.index, 1);
    var gone = (layer.type === 'group' ? layer.layers : [layer]).map(function (entry) { return entry.id; });
    window.LayerStack.flatLayers(state.spec).forEach(function (entry) {
      if (entry.type === 'measure' && gone.indexOf(entry.settings.zone) !== -1) { entry.settings.zone = ''; }
    });
    // The row that takes its place, else its group, else the top level's.
    var next = at.list[Math.min(at.index, at.list.length - 1)] || at.group || state.spec.layers[state.spec.layers.length - 1];
    state.selectedId = next ? next.id : null;
    render();
    renderList(state.selectedId);
    renderSettings();
    announce(layer.label + ' deleted.');
  }

  //
  //------- Settings form -------//
  //

  function fieldId(name) {
    fieldCounter += 1;
    return 'al-f-' + name + '-' + fieldCounter;
  }

  function renderSettings() {
    canvasEl = null;
    el.settings.innerHTML = '';
    if (state.selectedId === CANVAS_ID) {
      canvasRows().forEach(function (row) { el.settings.appendChild(row); });
      syncCanvasPanel();
      if (state.lastResult) { renderDetails(state.lastResult); }
      return;
    }
    var layer = layerById(state.selectedId);
    if (!layer) {
      var empty = document.createElement('p');
      empty.className = 'text-secondary';
      empty.textContent = 'Pick a layer in the list to change it.';
      el.settings.appendChild(empty);
      return;
    }
    el.settings.appendChild(nameField(layer));
    if (layer.type === 'group') {
      var about = document.createElement('p');
      about.className = 'form-hint';
      about.textContent = 'Its eye shows or hides its ' + layerCount(layer.layers.length) + ' together, and a tool built on the spec offers it as one switch. Layers you add while it, or a layer in it, is selected go into it.';
      el.settings.appendChild(about);
      var groupActions = document.createElement('div');
      groupActions.className = 'button-group';
      groupActions.innerHTML =
        '<button type="button" class="button" data-variant="outline" data-role="ungroup">' + icon('folder-open') + '<span>Ungroup</span></button>' +
        '<button type="button" class="button" data-variant="outline" data-role="duplicate">' + icon('copy') + '<span>Duplicate</span></button>' +
        '<button type="button" class="button" data-variant="outline" data-role="delete">' + icon('trash') + '<span>Delete</span></button>';
      el.settings.appendChild(groupActions);
      return;
    }
    // The artwork's own rows lead: what it is, then how it sits. Its size
    // and offset follow only when there is an artwork to size.
    if (presetsFor(layer).length > 1) { el.settings.appendChild(startFromField(layer)); }
    if (layer.type === 'specimen') { artworkRows().forEach(function (row) { el.settings.appendChild(row); }); }
    if (layer.type !== 'specimen' || currentArtwork()) {
      layoutFor(layer.type).forEach(function (row) {
        var built = buildRow(layer, row);
        if (built) { el.settings.appendChild(built); }
      });
    }
    if (layer.type !== 'specimen') {
      var actions = document.createElement('div');
      actions.className = 'button-group';
      actions.innerHTML =
        '<button type="button" class="button" data-variant="outline" data-role="duplicate">' + icon('copy') + '<span>Duplicate</span></button>' +
        '<button type="button" class="button" data-variant="outline" data-role="delete">' + icon('trash') + '<span>Delete</span></button>';
      el.settings.appendChild(actions);
      var provenance = provenanceNote(layer);
      if (provenance) { el.settings.insertBefore(provenance, el.settings.children[1] || null); }
      if (layer.locked) {
        lockSettings();
        // Duplicate is the one control left; it says why.
        var duplicate = actions.querySelector('[data-role="duplicate"]');
        if (provenance && duplicate) { duplicate.setAttribute('aria-describedby', provenance.id); }
      }
    } else {
      var note = document.createElement('p');
      note.className = 'form-hint';
      note.textContent = 'The specimen is always one layer: a stand-in to test the rules against, never part of them. It is centred in the canvas, then sized and moved by the settings above. Move it in the list to put images under or over it.';
      el.settings.appendChild(note);
    }
  }

  /* Who set a rule and how sure it is (layer-stack.js, the envelope), in
     a line under its name: only for a layer that says. */
  var SOURCE_WORDS = { platform: 'the platform', technology: 'the technology', directory: 'a directory', measured: 'measurement' };

  function provenanceNote(layer) {
    var parts = [];
    if (layer.source) { parts.push('Set by ' + SOURCE_WORDS[layer.source] + '.'); }
    if (layer.verified) { parts.push('Checked ' + layer.verified + '.'); }
    if (layer.approximate) { parts.push('Approximate: a measured estimate, drawn with a finer line.'); }
    if (layer.locked) { parts.push('Locked: a platform rule, so it cannot be changed here. Duplicate it to make your own.'); }
    if (!parts.length) { return null; }
    var note = document.createElement('p');
    note.className = 'form-hint';
    note.id = fieldId('provenance');
    note.textContent = parts.join(' ');
    return note;
  }

  /* A locked rule shows its settings and changes none: every control but
     the hints and Duplicate is disabled. A duplicate is unlocked, so it is
     the way to a version of one's own. */
  function lockSettings() {
    Array.prototype.forEach.call(el.settings.querySelectorAll('input, select, textarea, button'), function (control) {
      if (control.classList.contains('tool-info') || control.dataset.role === 'duplicate') { return; }
      control.disabled = true;
    });
  }

  function errorLine(id) {
    var p = document.createElement('p');
    p.className = 'form-error is-hidden';
    p.id = id + '-error';
    return p;
  }

  /* A setting: its label row, then its control. A hint is not printed
     under it: it is the note behind an ⓘ beside the label, and the control's
     description, so a screen reader hears it on focus. captionOnly makes the label a <p> for a group to
     point at (aria-labelledby) rather than a <label for>. */
  function wrap(labelText, control, hint, id, captionOnly) {
    var block = document.createElement('div');
    block.className = 'block gap-s';
    var head = labelRow(labelText, hint, id, captionOnly);
    block.appendChild(head);
    block.appendChild(control);
    if (hint) {
      var p = infoNote(id, hint);
      block.appendChild(p);
      // A group (a segmented control) is described as a whole.
      var described = captionOnly || control.matches('input, select') ? control : control.querySelector('input, select');
      if (described) { described.setAttribute('aria-describedby', p.id); }
      linkNote(head, p);
    }
    return block;
  }

  function labelRow(labelText, hint, id, captionOnly) {
    var head = document.createElement('div');
    head.className = 'tool-label-row';
    var label = document.createElement(captionOnly ? 'p' : 'label');
    label.setAttribute('data-variant', 'caption');
    if (captionOnly) { label.id = id + '-caption'; } else { label.htmlFor = id; }
    label.textContent = labelText;
    head.appendChild(label);
    if (hint) { head.appendChild(infoButton(labelText)); }
    return head;
  }

  /* The ⓘ: a disclosure that opens the setting's note in place, drawn as
     the Colour Pairing tool's info panel. In place, not a popover: a
     dock's section clips anything that floats (tools.css), and the column
     is too narrow for a panel beside the button. Named for what it is
     about; linkNote() points it at its note. */
  function infoButton(labelText) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'button tool-info';
    button.setAttribute('data-variant', 'transparent');
    button.setAttribute('data-size', 'xsmall');
    button.setAttribute('data-icon-only', '');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'About ' + labelText.toLowerCase());
    button.innerHTML = icon('info-circled');
    return button;
  }

  /* The note behind an ⓘ: shut until the button opens it, and the
     control's description either way (a description is read when hidden). */
  function infoNote(id, hint) {
    var p = document.createElement('p');
    p.className = 'form-hint tool-info-note';
    p.id = id + '-hint';
    p.hidden = true;
    p.textContent = hint;
    return p;
  }

  function linkNote(head, p) {
    var button = head.querySelector('.tool-info');
    button.setAttribute('aria-describedby', p.id);
    button.setAttribute('aria-controls', p.id);
  }

  /* Any ⓘ in the tool, the page's and the built settings' alike. */
  function handleInfoToggle(event) {
    var button = event.target.closest('.tool-info');
    if (!button) { return; }
    var target = button.getAttribute('aria-controls');
    var note = target ? el.root.querySelector('#' + CSS.escape(target)) : null;
    if (!note) { return; }
    var open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    note.hidden = !open;
  }

  /* -- Rows -- */

  function layoutFor(type) {
    var rows = (LAYOUT[type] || []).slice();
    var placed = [];
    rows.forEach(function (row) {
      placed = placed.concat(typeof row === 'string' ? [row] : (row.fields || row));
    });
    window.LayerStack.TYPES[type].fields.forEach(function (name) {
      if (placed.indexOf(name) === -1) { rows.push(name); }
    });
    return rows;
  }

  /* A row: one setting; two, each labelled, side by side; or two under one
     label, told apart by the letter inside each field. A row whose
     settings are all hidden hides with them (layout-specs.css). */
  function buildRow(layer, row) {
    if (typeof row === 'string') { return buildFieldTagged(layer, row); }
    var names = row.fields || row;
    var cells = names.map(function (name) { return buildFieldTagged(layer, name); }).filter(Boolean);
    if (!cells.length) { return null; }
    var pair = document.createElement('div');
    pair.className = 'tool-pair';
    cells.forEach(function (cell) { pair.appendChild(cell); });
    if (!row.label) { return pair; }
    // A labelled row whose fields are all hidden for this kind (a span's
    // From and To on a canvas measure) hides as one, caption included.
    var allHidden = cells.every(function (cell) { return cell.classList.contains('is-hidden'); });
    // One label for both: each half keeps its own as its name, hidden, and
    // gives up its ⓘ; the first half's hint is the row's.
    var id = fieldId('row');
    var hint = hintFor(layer, names[0]);
    cells.forEach(function (cell) {
      cell.querySelector('.tool-label-row').classList.add('visually-hidden');
      var info = cell.querySelector('.tool-info');
      if (info) { info.remove(); }
    });
    var block = document.createElement('div');
    block.className = 'block gap-s';
    if (allHidden) { block.classList.add('is-hidden'); }
    block.setAttribute('role', 'group');
    var head = labelRow(row.label, hint, id, true);
    block.appendChild(head);
    block.setAttribute('aria-labelledby', id + '-caption');
    block.appendChild(pair);
    if (hint) {
      var p = infoNote(id, hint);
      block.appendChild(p);
      linkNote(head, p);
      // Every field in the row hears the row's hint, not only the first:
      // each cell's own copy goes, and its controls point at the row's.
      cells.forEach(function (cell) {
        Array.prototype.forEach.call(cell.querySelectorAll('p.tool-info-note'), function (own) { own.remove(); });
        Array.prototype.forEach.call(cell.querySelectorAll('input, select'), function (control) {
          var ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (ref) { return ref && !/-hint$/.test(ref); });
          if (control.tagName === 'INPUT') { ids.unshift(p.id); }
          if (ids.length) { control.setAttribute('aria-describedby', ids.join(' ')); } else { control.removeAttribute('aria-describedby'); }
        });
      });
    }
    return block;
  }

  function nameField(layer) {
    var id = fieldId('label');
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.value = layer.label;
    input.maxLength = 60;
    input.addEventListener('input', function handleNameInput() {
      layer.label = input.value || (layer.type === 'group' ? 'Group' : typeLabel(layer));
      updateListLabel(layer);
      saveLocal();
    });
    return wrap('Name', input, '', id);
  }

  /* Start from: the presets of the layer's type, the one it came from
     chosen. Applied by its button, not on change, as the template is:
     arrowing through a select fires change on every step in some browsers,
     and each step would replace the layer's settings. A menu, not a
     segmented control: the names are too long to sit side by side. */
  function startFromField(layer) {
    var id = fieldId('preset');
    var row = document.createElement('div');
    row.className = 'tool-add';
    var select = document.createElement('select');
    select.id = id;
    var ids = presetsFor(layer);
    if (ids.indexOf(layer.preset) === -1) { select.appendChild(new Option('Choose a preset', '', true, true)); select.options[0].disabled = true; }
    ids.forEach(function (presetId) { select.appendChild(new Option(window.LayerStack.PRESETS[presetId].label, presetId, false, presetId === layer.preset)); });
    var apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'button';
    apply.setAttribute('data-variant', 'outline');
    apply.textContent = 'Apply';
    apply.addEventListener('click', function handleStartFrom() {
      if (select.value && select.value !== layer.preset) { applyPreset(layer, select.value); }
    });
    row.appendChild(select);
    row.appendChild(apply);
    var block = wrap('Start from', row, 'A preset fills in this layer\'s settings. Applying one replaces any you have changed, but keeps a file or text you added.', id);
    block.dataset.field = 'preset';
    return block;
  }

  function applyPreset(layer, presetId) {
    var fresh = window.LayerStack.createLayer(presetId);
    var previous = window.LayerStack.PRESETS[layer.preset];
    if (layer.label === (previous ? previous.label : typeLabel(layer))) {
      layer.label = fresh.label;
      updateListLabel(layer);
    }
    // What the person added — an image, a marker's file or text — is
    // theirs, not the preset's: it stays unless it is the old preset's own.
    var before = previous ? window.LayerStack.createLayer(layer.preset).settings : {};
    ['src', 'markerSrc', 'markerText'].forEach(function (name) {
      if (layer.settings[name] && layer.settings[name] !== before[name]) { fresh.settings[name] = layer.settings[name]; }
    });
    var keptZone = layer.settings.zone;
    layer.preset = presetId;
    layer.settings = fresh.settings;
    // Inset to Area on the same zone is the expected move: the zone stays.
    if (layer.type === 'measure' && measuresZone(layer)) { layer.settings.zone = keptZone && layerById(keptZone) ? keptZone : firstZoneId(); }
    render();
    renderSettings();
    var again = el.settings.querySelector('[data-field="preset"] select');
    if (again) { again.focus(); }
    announce(layer.label + ' starts from ' + fresh.label + '.');
  }

  function updateListLabel(layer) {
    var item = el.list.querySelector('[data-id="' + layer.id + '"]');
    if (!item) { return; }
    item.querySelector('.tool-layer-label').textContent = layer.label;
    item.querySelector('[data-role="eye"]').setAttribute('aria-label', 'Show ' + layer.label);
    if (layer.type !== 'specimen') { item.querySelector('[data-role="delete"]').setAttribute('aria-label', 'Delete ' + layer.label); }
  }

  /* A measure that reads a zone: its inset or the area inside it. */
  function measuresZone(layer) {
    return layer.type === 'measure' && (layer.settings.target === 'zone-inset' || layer.settings.target === 'zone-area');
  }

  /* A measure's edge is named for its axis: a width's line sits at the
     top or bottom, a height's at the left or right. */
  function shortNames(layer, name) {
    if (layer.type === 'measure' && name === 'edge') {
      return layer.settings.axis === 'height' ? { start: 'Left', centre: 'Centre', end: 'Right' } : { start: 'Top', centre: 'Centre', end: 'Bottom' };
    }
    return SHORT_CHOICES[layer.type + '.' + name] || SHORT_CHOICES[name] || {};
  }

  function choicesFor(layer, name) {
    var C = window.LayerStack.CHOICES;
    return C[layer.type + '.' + name] || C[name] || null;
  }

  /* A zone's marker settings show only while it has a marker, and the
     text and file only for the kind that uses them. */
  function markerVisibility(layer, name, block) {
    if (!block || layer.type !== 'zone' || name.indexOf('marker') !== 0) { return block; }
    if (name === 'marker') {
      block.classList.toggle('is-hidden', layer.settings.display === 'area');
      return block;
    }
    var kind = layer.settings.marker || 'none';
    var hide = kind === 'none' || layer.settings.display === 'area' ||
      (name === 'markerText' && kind !== 'text') ||
      (name === 'markerSrc' && kind !== 'svg' && kind !== 'image');
    block.classList.toggle('is-hidden', hide);
    return block;
  }

  function labelFor(layer, name) {
    return TYPE_FIELD_LABELS[layer.type + '.' + name] || FIELD_LABELS[name] || name;
  }

  function hintFor(layer, name) {
    return TYPE_FIELD_HINTS[layer.type + '.' + name] || FIELD_HINTS[name] || '';
  }

  var KEYLINES = ['circle', 'square'];

  /* A guide's and a grid's settings show only for the kinds that use them:
     a single line has a direction and a position, a keyline a size and a
     ratio and corner (a rectangle), and only straight lines bleed; cells
     have a cell and an alignment, columns and rows a count, margin and
     gutter. Draw shows only where there is an area to fill (a keyline, a
     track, a zone, a shape). The outline's settings go when the draw is a
     fill alone, and the fill's when it is an outline alone or there is no
     area to fill. */
  function kindVisibility(layer, name, block) {
    if (!block) { return block; }
    var kind = layer.settings.kind;
    var hide = false;
    var noLine = layer.settings.draw === 'fill';
    var noFill = layer.settings.draw === 'outline';
    if (layer.type === 'guide') {
      if (name === 'axis' || name === 'position') { hide = kind !== 'line'; }
      if (name === 'size') { hide = KEYLINES.indexOf(kind) === -1; }
      if (name === 'bleed') { hide = ['centre', 'line', 'thirds'].indexOf(kind) === -1; }
      if (name === 'ratio' || name === 'radius') { hide = kind !== 'square'; }
      if (name === 'draw') { hide = KEYLINES.indexOf(kind) === -1; }
      noLine = noLine && KEYLINES.indexOf(kind) !== -1;
      noFill = noFill || KEYLINES.indexOf(kind) === -1;
    }
    if (layer.type === 'grid') {
      var tracks = kind === 'columns' || kind === 'rows';
      if (name === 'cell' || name === 'align') { hide = tracks; }
      if (['count', 'margin', 'gutter', 'draw'].indexOf(name) !== -1) { hide = !tracks; }
      noLine = noLine && tracks;
      noFill = noFill || !tracks;
    }
    if (layer.type === 'shape' && name === 'radius') { hide = layer.settings.form !== 'rounded'; }
    if (OUTLINE_FIELDS.indexOf(name) !== -1 && noLine) { hide = true; }
    if (FILL_FIELDS.indexOf(name) !== -1 && noFill) { hide = true; }
    if (layer.type === 'measure' && name === 'zone') { hide = !measuresZone(layer); }
    // A span has its own ends and position; the other targets have an edge.
    if (layer.type === 'measure' && ['from', 'to', 'at'].indexOf(name) !== -1) { hide = layer.settings.target !== 'span'; }
    if (layer.type === 'measure' && name === 'edge') { hide = layer.settings.target === 'span'; }
    if (hide) { block.classList.add('is-hidden'); }
    return block;
  }

  function buildField(layer, name) {
    var value = layer.settings[name];
    var choices = choicesFor(layer, name);
    if (choices) {
      var control = choices.length <= SEGMENT_MAX ? segmentedField(layer, name, choices) : selectField(layer, name, choices);
      return markerVisibility(layer, name, control);
    }
    if (Object.prototype.hasOwnProperty.call(LENGTH_FIELDS, name)) {
      var units = layer.type === 'specimen' && name === 'size' ? ['%', 'px'] : LENGTH_FIELDS[name];
      return lengthField(layer, name, { units: units, signed: SIGNED_FIELDS.indexOf(name) !== -1, positive: layer.type === 'specimen' && name === 'size' });
    }
    if (name === 'count') { return numberField(layer, name, value); }
    if (['colour', 'outlineColour', 'fillColour', 'markerColour'].indexOf(name) !== -1) { return markerVisibility(layer, name, colourField(layer, name)); }
    if (['opacity', 'outlineOpacity', 'fillOpacity', 'markerOpacity'].indexOf(name) !== -1) { return markerVisibility(layer, name, percentField(layer, name)); }
    if (name === 'markerText') { return markerVisibility(layer, name, textField(layer, name)); }
    if (name === 'markerSrc') { return markerVisibility(layer, name, markerSrcField(layer)); }
    if (name === 'markerRotate') { return markerVisibility(layer, name, numberField(layer, name, value)); }
    if (name === 'zone') { return zoneField(layer); }
    if (name === 'bleed') { return switchField(layer, name); }
    if (name === 'text') { return textField(layer, name); }
    if (name === 'src') { return imageField(layer); }
    if (name === 'radius' || name === 'ratio') { return numberField(layer, name, value); }
    return null;
  }

  function buildFieldTagged(layer, name) {
    var block = kindVisibility(layer, name, buildField(layer, name));
    if (block) { block.dataset.field = name; }
    // A zone's marker settings are a group of their own, ruled off.
    if (block && layer.type === 'zone' && name === 'marker') { block.classList.add('tool-group-start'); }
    return block;
  }

  function changed() {
    render();
  }

  function selectField(layer, name, choices) {
    var id = fieldId(name);
    var select = document.createElement('select');
    select.id = id;
    choices.forEach(function (choice) { select.appendChild(new Option(choice[1], choice[0], false, choice[0] === layer.settings[name])); });
    select.addEventListener('change', function handleSelectChange() {
      layer.settings[name] = select.value;
      changed();
    });
    return wrap(labelFor(layer, name), select, hintFor(layer, name), id);
  }

  /* Five options or fewer: all in view at once, as a segmented control
     (cms/form.md, faded variant — native radios, so the arrow keys and one
     tab stop come with it). Its options take their short names. */
  function segmentedField(layer, name, choices) {
    var id = fieldId(name);
    var names = shortNames(layer, name);
    var group = segmentedGroup(id, choices.map(function (choice) { return [choice[0], names[choice[0]] || choice[1]]; }), layer.settings[name]);
    // A short name that leans on a sign ("+ Bleed") is named in full for a
    // screen reader, which may not read the sign.
    Array.prototype.forEach.call(group.querySelectorAll('input'), function nameInFull(radio) {
      if (/^\W/.test(names[radio.value] || '')) {
        radio.setAttribute('aria-label', choices.filter(function (choice) { return choice[0] === radio.value; })[0][1]);
      }
    });
    group.setAttribute('aria-labelledby', id + '-caption');
    group.addEventListener('change', function handleSegmentChange(event) {
      if (event.target.name !== id) { return; }
      layer.settings[name] = event.target.value;
      changed();
    });
    return wrap(labelFor(layer, name), group, hintFor(layer, name), id, true);
  }

  /* The control itself: [value, text] pairs as radios, the one matching
     value checked. The caller names it and listens. */
  function segmentedGroup(id, choices, value) {
    var group = document.createElement('div');
    group.className = 'segmented-control tool-segmented';
    group.setAttribute('data-variant', 'faded');
    group.setAttribute('role', 'radiogroup');
    choices.forEach(function (choice) {
      var option = document.createElement('label');
      option.className = 'segmented-control-option';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = id;
      radio.value = choice[0];
      radio.checked = choice[0] === value;
      var text = document.createElement('span');
      text.textContent = choice[1];
      option.appendChild(radio);
      option.appendChild(text);
      group.appendChild(option);
    });
    return group;
  }

  /* A length: a number and its unit. A token-bound length shows the token
     and a switch to follow it; typing a number unbinds it. options.units
     narrows the units offered; options.signed allows a negative number (an
     offset, a margin that reaches past the edge). */
  function lengthField(layer, name, options) {
    var opts = options || {};
    var units = opts.units || window.LayerStack.CHOICES.units;
    var id = fieldId(name);
    var resolved = window.LayerStack.resolveLength(layer.settings[name], 'px', el.stage);
    var row = document.createElement('div');
    row.className = 'field';
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.step = 'any';
    if (!opts.signed) { input.min = '0'; }
    input.inputMode = opts.signed ? 'text' : 'decimal';
    input.value = fmt(resolved.number);
    var lengthError = errorLine(id);
    var unit = document.createElement('select');
    unit.setAttribute('aria-label', labelFor(layer, name) + ' unit');
    units.forEach(function (u) { unit.appendChild(new Option(u, u, false, u === resolved.unit)); });
    if (unit.selectedIndex === -1 || unit.value !== resolved.unit) { unit.value = units[0]; }
    appendPrefix(row, layer, name);
    row.appendChild(input);
    row.appendChild(unit);

    var tokenRow = null;
    if (layer.settings[name] && layer.settings[name].token) {
      tokenRow = document.createElement('div');
      tokenRow.className = 'form-toggle';
      tokenRow.setAttribute('data-variant', 'mono');
      tokenRow.setAttribute('data-size', 'small');
      var tokenId = fieldId(name + '-token');
      tokenRow.innerHTML = '<input type="checkbox" role="switch" checked id="' + tokenId + '"><label for="' + tokenId + '"></label>';
      tokenRow.querySelector('label').textContent = 'Follow ' + layer.settings[name].token;
      tokenRow.querySelector('input').addEventListener('change', function handleTokenSwitch(event) {
        if (!event.target.checked) {
          layer.settings[name] = { value: Number(input.value) || 0, unit: unit.value };
          changed();
          renderSettings();
          focusField(name);
        }
      });
    }

    function usable(value) {
      var number = Number(value);
      if (value === '' || !isFinite(number)) { return false; }
      if (opts.positive) { return number > 0; }
      return opts.signed || number >= 0;
    }

    function commit() {
      var number = Number(input.value);
      if (!usable(input.value)) {
        setInvalid(input, lengthError);
        showFieldError(lengthError, opts.positive ? 'Use a size above 0.' : opts.signed ? 'Use a number. A negative one moves the other way.' : 'Use a number of 0 or more.');
        return;
      }
      setInvalid(input, null);
      showFieldError(lengthError, '');
      layer.settings[name] = { value: number, unit: unit.value };
      changed();
      if (tokenRow) { tokenRow.remove(); tokenRow = null; }
    }

    // A lone minus sign is a number half typed: wait for the next key
    // rather than call it an error. Leaving the field checks it.
    input.addEventListener('input', function handleLengthInput() {
      if (opts.signed && input.validity.badInput) { return; }
      commit();
    });
    input.addEventListener('change', commit);
    unit.addEventListener('change', function handleUnitChange() {
      if (layer.settings[name] && layer.settings[name].token) {
        layer.settings[name] = { token: layer.settings[name].token, unit: unit.value };
        changed();
      } else if (!usable(input.value)) {
        // No number to commit: keep the stored one and say so in the field.
        input.value = fmt(resolved.number);
        commit();
      } else {
        commit();
      }
    });

    var block = wrap(labelFor(layer, name), row, hintFor(layer, name), id);
    block.appendChild(lengthError);
    if (tokenRow) { block.appendChild(tokenRow); }
    return block;
  }

  /* The letter before a value inside its field (PREFIXES), and the unit
     after a plain number (SUFFIXES): .field-affix, decoration — the input
     keeps its label (cms/field.md, Affix and unit). */
  function affix(text) {
    var span = document.createElement('span');
    span.className = 'field-affix';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = text;
    return span;
  }

  function appendPrefix(box, layer, name) {
    var letter = PREFIXES[layer.type + '.' + name] || PREFIXES[name];
    if (letter) { box.appendChild(affix(letter)); }
  }

  function focusField(name) {
    var block = el.settings.querySelector('[data-field="' + name + '"] input[type="number"]');
    if (block) { block.focus(); }
  }

  /* The canvas background: the palette as colour chips, darkest step
     first, and any hex typed in beside them. */
  var HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

  function swatchField(layer, options) {
    var opts = options || {};
    var id = fieldId('colour');
    // A native radio group named by its legend (a bare fieldset,
    // design-system.css Form).
    var block = document.createElement('fieldset');
    block.setAttribute('data-variant', 'bare');
    var caption = document.createElement('legend');
    caption.setAttribute('data-variant', 'caption');
    caption.textContent = opts.label || FIELD_LABELS.colour;
    var core = window.bdColor;
    var names = core ? core.EXTRAS.concat(core.hueTokens(), core.NEUTRALS) : ['off-white', 'off-black'];
    var entries = names.map(function (name) {
      return { value: 'var(--' + name + ')', label: core ? core.tokenLabel(name) : name };
    });
    // A value from an imported spec that is neither a palette token nor a
    // hex gets a chip of its own, so it shows as chosen.
    var current = layer.settings.colour || '';
    var known = entries.some(function (entry) { return entry.value === current; });
    if (current && !known && !HEX.test(current)) { entries.push({ value: current, label: current }); }
    // None is the empty value, the same checkerboard chip as the other
    // tools' None (tools.css, .chip[data-none]).
    if (opts.none) { entries.unshift({ value: '', label: 'None (transparent)', none: true }); }
    var group = swatchGroup(id, entries, current);
    group.addEventListener('change', function handleSwatchChange(event) {
      if (event.target.name !== id) { return; }
      layer.settings.colour = event.target.value;
      // A chip chosen empties the hex beside it (hexField).
      var hex = el.settings.querySelector('[data-field="colourHex"] input');
      if (hex) {
        hex.value = '';
        setInvalid(hex, null);
        showFieldError(el.settings.querySelector('[data-field="colourHex"] .form-error'), '');
      }
      changed();
    });

    block.appendChild(caption);
    block.appendChild(group);
    return block;
  }

  /* The background's own hex: shows the colour when it is not a palette
     chip, and typing a whole one unchecks the chips. */
  function hexField(layer) {
    var id = fieldId('colourHex');
    var current = layer.settings.colour || '';
    var box = document.createElement('div');
    box.className = 'field';
    box.appendChild(affix('#'));
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.maxLength = 9;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = '1a54d6';
    input.value = HEX.test(current) ? current.replace(/^#/, '') : '';
    box.appendChild(input);
    var error = errorLine(id);

    function typed() {
      var value = input.value.trim();
      return value.charAt(0) === '#' ? value : '#' + value;
    }

    function commitHex(value) {
      setInvalid(input, null);
      showFieldError(error, '');
      Array.prototype.forEach.call(el.settings.querySelectorAll('[data-field="colour"] input'), function (radio) { radio.checked = false; });
      layer.settings.colour = value;
      changed();
    }

    // While typing, only a whole six- or eight-digit hex applies: "fff" on
    // the way to "fff8e1" is not a colour anyone chose. Three digits apply
    // on leaving the field.
    input.addEventListener('input', function handleHexInput() {
      var value = typed();
      if (HEX.test(value) && (value.length === 7 || value.length === 9)) { commitHex(value); }
    });
    input.addEventListener('change', function handleHexChange() {
      if (input.value.trim() === '') {
        setInvalid(input, null);
        showFieldError(error, '');
        return;
      }
      if (HEX.test(typed())) {
        if (typed() !== layer.settings.colour) { commitHex(typed()); }
        return;
      }
      setInvalid(input, error);
      showFieldError(error, 'Use a hex such as 1a54d6.');
    });
    var block = wrap(FIELD_LABELS.colourHex, box, '', id);
    block.appendChild(error);
    return block;
  }

  /* A row of colour chips as a radio group (cms/chip.md, colour variant):
     each entry a value, the fill its chip shows (the value by default) and
     its name for a screen reader. */
  function swatchGroup(name, entries, current) {
    var group = document.createElement('div');
    group.className = 'chip-group tool-swatches';
    entries.forEach(function (entry) {
      var chip = document.createElement('label');
      chip.className = 'chip';
      if (entry.none) { chip.setAttribute('data-none', ''); }
      chip.setAttribute('data-variant', 'colour');
      // The name on hover too, as tool-colour.js's chips carry it.
      chip.setAttribute('data-tooltip', entry.label);
      // None paints itself; an empty fill would only clear the property
      // anyway.
      if (!entry.none) { chip.style.setProperty('--chip-fill', entry.fill || entry.value); }
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = entry.value;
      radio.checked = current === entry.value;
      var swatch = document.createElement('span');
      swatch.className = 'chip-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      var hidden = document.createElement('span');
      hidden.className = 'visually-hidden';
      hidden.textContent = entry.label;
      chip.appendChild(radio);
      chip.appendChild(swatch);
      chip.appendChild(hidden);
      group.appendChild(chip);
    });
    return group;
  }

  /* A layer's outline or fill colour, a measure's colour, or a zone's
     marker colour: its default first, then the hues. The default is what
     the layer draws in with nothing chosen — the type's token, the ground's
     ink for a measure, the zone's outline colour for its marker — so its
     chip shows that. A value from an imported spec
     that is none of these gets a chip of its own, so it shows as chosen. */
  function colourField(layer, key) {
    key = key || 'colour';
    var id = fieldId(key);
    var current = layer.settings[key] || '';
    var entries;
    if (layer.type === 'measure' || layer.type === 'note') {
      // The ink as the stage resolves it now: currentColor on the chip would
      // follow the chip's own text, which inverts when it is checked. Then
      // the kit's six, not the hues: measures and notes are annotation.
      entries = [{ value: '', fill: window.getComputedStyle(el.stage).color, label: 'Auto: the ground\'s ink' }];
      KIT_COLOURS.forEach(function (colour) {
        entries.push({ value: 'var(--annotation-' + colour[0] + ')', label: colour[1] });
      });
    } else if (key === 'markerColour') {
      // The outline's colour, or the fill's when the zone is a fill alone
      // (layer-stack.js, computeMarkers).
      var follows = layer.settings.draw === 'fill' ? 'fillColour' : 'outlineColour';
      entries = [{ value: '', fill: layer.settings[follows] || DEFAULT_COLOUR.zone, label: follows === 'fillColour' ? 'The fill\'s colour' : 'The outline\'s colour' }];
    } else {
      var fallback = DEFAULT_COLOUR[layer.type] || 'currentColor';
      entries = [{ value: fallback, label: 'Default (' + fallback.replace(/^var\(|\)$/g, '') + ')' }];
      // Nothing set draws in the default, so the default shows as chosen.
      current = current || fallback;
    }
    if (layer.type !== 'measure' && layer.type !== 'note') {
      layerHues().forEach(function (hue) {
        entries.push({ value: 'var(--' + hue + ')', label: '--' + hue });
      });
    }
    var known = entries.some(function (entry) { return entry.value === current; });
    if (current && !known) { entries.push({ value: current, label: current }); }
    var block = document.createElement('fieldset');
    block.setAttribute('data-variant', 'bare');
    var caption = document.createElement('legend');
    caption.setAttribute('data-variant', 'caption');
    caption.textContent = labelFor(layer, key);
    var group = swatchGroup(id, entries, current);
    group.addEventListener('change', function handleColourChange(event) {
      if (event.target.name !== id) { return; }
      layer.settings[key] = event.target.value;
      // The marker's default chip shows the paint it follows.
      if (layer.type === 'zone' && key === (layer.settings.draw === 'fill' ? 'fillColour' : 'outlineColour')) {
        var markerDefault = el.settings.querySelector('[data-field="markerColour"] .chip');
        if (markerDefault) { markerDefault.style.setProperty('--chip-fill', event.target.value); }
      }
      changed();
    });
    block.appendChild(caption);
    block.appendChild(group);
    // A hint here is the rule a choice brings (a coloured note is a pill),
    // so it shows, under the chips, rather than behind an info button a
    // legend cannot hold.
    var hint = hintFor(layer, key);
    if (hint) {
      var note = document.createElement('p');
      note.className = 'form-hint';
      note.id = id + '-hint';
      note.textContent = hint;
      group.setAttribute('aria-describedby', note.id);
      block.appendChild(note);
    }
    return block;
  }

  /* An opacity, as a design tool shows one: a percentage in a field. The
     spec keeps 0 to 1. A token-bound opacity shows its value and says, in
     its hint, that it follows the token until changed. */
  function percentField(layer, key) {
    var id = fieldId(key);
    var setting = layer.settings[key];
    // The fallback the engine draws with when a token cannot be read: opaque.
    var current = window.LayerStack.resolveNumber(setting, 1, el.stage);
    var box = document.createElement('div');
    box.className = 'field';
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.inputMode = 'numeric';
    input.value = String(Math.round(current * 100));
    box.appendChild(input);
    box.appendChild(affix('%'));
    var percentError = errorLine(id);
    var hint = setting && setting.token ? 'Follows ' + setting.token + ' until you change it.' : '';
    var block = wrap(FIELD_LABELS[key], box, hint, id);
    block.appendChild(percentError);
    input.addEventListener('input', function handlePercentInput() {
      var n = Number(input.value);
      if (input.value === '' || !isFinite(n) || n < 0 || n > 100) {
        setInvalid(input, percentError);
        showFieldError(percentError, 'Use a number from 0 to 100.');
        return;
      }
      setInvalid(input, null);
      showFieldError(percentError, '');
      layer.settings[key] = n / 100;
      // No longer the token's: its hint goes with it.
      var info = block.querySelector('.tool-info');
      if (info) {
        info.remove();
        var p = block.querySelector('#' + CSS.escape(id + '-hint'));
        if (p) { p.remove(); }
        input.removeAttribute('aria-describedby');
      }
      changed();
    });
    return block;
  }

  /* The zone a measure reads, among the stack's zones. */
  function zoneField(layer) {
    var id = fieldId('zone');
    var select = document.createElement('select');
    select.id = id;
    var zones = window.LayerStack.flatLayers(state.spec).filter(function (entry) { return entry.type === 'zone'; });
    // Nothing chosen (its zone was deleted, or an old spec named none) shows
    // as nothing chosen, so picking the first zone is a real change.
    if (!zones.length) {
      select.appendChild(new Option('Add a zone first', '', false, true));
    } else if (!layerById(layer.settings.zone)) {
      select.appendChild(new Option('Pick a zone', '', false, true));
    }
    zones.forEach(function (zone) { select.appendChild(new Option(zone.label, zone.id, false, zone.id === layer.settings.zone)); });
    select.addEventListener('change', function handleZoneChange() {
      layer.settings.zone = select.value;
      changed();
    });
    return wrap(FIELD_LABELS.zone, select, '', id);
  }

  function firstZoneId() {
    var zone = window.LayerStack.flatLayers(state.spec).filter(function (entry) { return entry.type === 'zone'; })[0];
    return zone ? zone.id : '';
  }

  function switchField(layer, name) {
    var id = fieldId(name);
    var row = document.createElement('div');
    row.className = 'form-toggle';
    row.setAttribute('data-variant', 'mono');
    row.innerHTML = '<input type="checkbox" role="switch" id="' + id + '"' + (layer.settings[name] ? ' checked' : '') + '><label for="' + id + '"></label>';
    row.querySelector('label').textContent = FIELD_LABELS[name] || name;
    row.querySelector('input').addEventListener('change', function handleSwitch(event) {
      layer.settings[name] = event.target.checked;
      changed();
    });
    var hint = hintFor(layer, name);
    if (!hint) { return row; }
    // A hint is the ⓘ beside the switch and its description, as Include
    // artwork's is in the Export section.
    var head = document.createElement('div');
    head.className = 'tool-label-row';
    head.appendChild(row);
    head.appendChild(infoButton(FIELD_LABELS[name] || name));
    var p = infoNote(id, hint);
    head.appendChild(p);
    row.querySelector('input').setAttribute('aria-describedby', p.id);
    linkNote(head, p);
    return head;
  }

  function textField(layer, name) {
    var id = fieldId(name);
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.value = layer.settings[name] || '';
    input.maxLength = name === 'markerText' ? 12 : 120;
    input.addEventListener('input', function handleTextInput() {
      layer.settings[name] = input.value;
      changed();
    });
    var block = wrap(FIELD_LABELS[name] || name, input, '', id);
    return block;
  }

  function numberField(layer, name, value) {
    var id = fieldId(name);
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.step = 'any';
    input.inputMode = 'decimal';
    input.value = fmt(Number(value) || 0);
    if (name === 'radius') { input.min = '0'; input.max = '50'; }
    if (name === 'count') { input.min = '1'; input.max = '100'; input.step = '1'; input.inputMode = 'numeric'; }
    if (name === 'ratio') { input.min = '1'; input.max = '1000'; }
    var box = document.createElement('div');
    box.className = 'field';
    appendPrefix(box, layer, name);
    box.appendChild(input);
    if (SUFFIXES[name]) { box.appendChild(affix(SUFFIXES[name])); }
    var numberError = errorLine(id);
    input.addEventListener('input', function handleNumberInput() {
      if (input.value === '' || isNaN(Number(input.value))) {
        setInvalid(input, numberError);
        showFieldError(numberError, 'Use a number.');
        return;
      }
      if (name === 'ratio' && !(Number(input.value) >= 1 && Number(input.value) <= 1000)) {
        setInvalid(input, numberError);
        showFieldError(numberError, 'Use a number from 1 to 1000. 100 is a square.');
        return;
      }
      if (name === 'count' && !(Number(input.value) >= 1 && Number(input.value) <= 100 && Number(input.value) % 1 === 0)) {
        setInvalid(input, numberError);
        showFieldError(numberError, 'Use a whole number from 1 to 100.');
        return;
      }
      setInvalid(input, null);
      showFieldError(numberError, '');
      layer.settings[name] = Number(input.value);
      changed();
    });
    var block = wrap(labelFor(layer, name), box, hintFor(layer, name), id);
    block.appendChild(numberError);
    return block;
  }

  /* An image is a file the person picks (kept as data, so it travels in a
     downloaded spec but not in a link) or a web address. */
  function imageField(layer) {
    var id = fieldId('src');
    var group = document.createElement('div');
    group.className = 'block gap-s';
    var url = document.createElement('input');
    url.type = 'url';
    url.placeholder = 'Or a web address: https://…';
    url.setAttribute('aria-label', 'Image address');
    url.value = /^data:/.test(layer.settings.src || '') ? '' : (layer.settings.src || '');
    // The browser's own file input is hidden behind a button of the
    // system's (filePicker).
    var picker = filePicker(id, 'Choose an image', 'image/png,image/jpeg,image/webp,image/svg+xml');
    var file = picker.file;
    var error = errorLine(id);
    error.setAttribute('role', 'alert');
    error.classList.remove('is-hidden');
    var fileHint = document.createElement('p');
    fileHint.className = 'form-hint';
    fileHint.id = id + '-file-hint';
    fileHint.textContent = 'A picked file travels in a downloaded spec, not in a link.';
    picker.button.setAttribute('aria-describedby', fileHint.id);
    group.appendChild(picker.button);
    group.appendChild(file);
    group.appendChild(url);
    group.appendChild(fileHint);
    group.appendChild(error);

    function fail(message, input) {
      setInvalid(input || url, error);
      writeAlert(error, message);
    }

    function clear() {
      setInvalid(url, null);
      setInvalid(picker.button, null);
      writeAlert(error, '');
    }

    url.addEventListener('change', function handleImageUrl() {
      var value = url.value.trim();
      if (value && !/^https?:\/\//i.test(value)) { fail('Use a web address that starts with https://.', url); return; }
      clear();
      layer.settings.src = value;
      changed();
    });
    file.addEventListener('change', function handleImageFile() {
      var picked = file.files && file.files[0];
      if (!picked) { return; }
      if (picked.size > 8 * 1024 * 1024) { fail(picked.name + ' is over 8 MB. Export a smaller image and pick it again.', picker.button); return; }
      var owner = state;
      var reader = new FileReader();
      reader.onload = function handleImageRead() {
        if (state !== owner) { return; }
        if (!/^data:image\//.test(reader.result)) { fail(picked.name + ' is not an image this tool can draw.', picker.button); return; }
        clear();
        layer.settings.src = reader.result;
        url.value = '';
        changed();
        announce(picked.name + ' placed in ' + layer.label + '.');
      };
      reader.onerror = function handleImageError() { if (state === owner) { fail(picked.name + ' could not be read.', picker.button); } };
      reader.readAsDataURL(picked);
    });
    return wrapPicker(FIELD_LABELS.src, group, picker.button, id);
  }

  /* The marker's file: an SVG (sanitised, kept as markup) or an image
     (kept as data, or a web address). Which, follows the marker kind. */
  function markerSrcField(layer) {
    var id = fieldId('markerSrc');
    var group = document.createElement('div');
    group.className = 'block gap-s';
    var isSvg = layer.settings.marker === 'svg';
    var picker = filePicker(id, isSvg ? 'Choose an SVG' : 'Choose an image', isSvg ? '.svg,image/svg+xml' : 'image/png,image/jpeg,image/webp,image/svg+xml');
    var file = picker.file;
    var error = errorLine(id);
    error.setAttribute('role', 'alert');
    error.classList.remove('is-hidden');
    var status = document.createElement('p');
    status.className = 'form-hint';
    status.id = id + '-state';
    status.textContent = layer.settings.markerSrc ? 'A file is in use. Pick another to replace it.' : 'No file yet.';
    picker.button.setAttribute('aria-describedby', status.id);
    group.appendChild(picker.button);
    group.appendChild(file);
    group.appendChild(status);
    group.appendChild(error);

    function fail(message) {
      setInvalid(picker.button, error);
      writeAlert(error, message);
    }

    file.addEventListener('change', function handleMarkerFile() {
      var picked = file.files && file.files[0];
      if (!picked) { return; }
      if (picked.size > 2 * 1024 * 1024) { fail(picked.name + ' is over 2 MB. A marker is small; export a smaller file.'); return; }
      var owner = state;
      var reader = new FileReader();
      reader.onload = function handleMarkerRead() {
        if (state !== owner) { return; }
        var value = reader.result;
        if (isSvg) {
          value = sanitise(value);
          // Its colours to currentColor, so the marker colour applies.
          if (value) { value = inkMarkup(value); }
          if (!value || !window.LayerStack.readArtwork(value, 0)) { fail(picked.name + ' has no <svg> with a size this tool can read.'); return; }
        } else if (!/^data:image\//.test(value)) {
          fail(picked.name + ' is not an image this tool can draw.');
          return;
        }
        setInvalid(picker.button, null);
        writeAlert(error, '');
        layer.settings.markerSrc = value;
        status.textContent = picked.name + ' is in use.';
        changed();
        announce(picked.name + ' is the marker for ' + layer.label + '.');
      };
      reader.onerror = function handleMarkerError() { if (state === owner) { fail(picked.name + ' could not be read.'); } };
      if (isSvg) { reader.readAsText(picked); } else { reader.readAsDataURL(picked); }
    });
    return wrapPicker(FIELD_LABELS.markerSrc, group, picker.button, id);
  }

  /* A file input behind an outline button: the button carries the id the
     setting's label points at and opens the browser's picker; the input
     stays in the DOM, hidden, to read the file. */
  function filePicker(id, text, accept) {
    var button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'button';
    button.setAttribute('data-variant', 'outline');
    button.textContent = text;
    var file = document.createElement('input');
    file.type = 'file';
    file.accept = accept;
    file.className = 'is-hidden';
    file.tabIndex = -1;
    file.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', function openPicker() { file.click(); });
    return { button: button, file: file };
  }

  /* A picker's setting: its label a caption, so the button is named by
     both — "Image, Choose an image" — rather than the label alone. */
  function wrapPicker(labelText, group, button, id) {
    var block = wrap(labelText, group, '', id, true);
    button.setAttribute('aria-labelledby', id + '-caption ' + id);
    return block;
  }

  /* -- The artwork layer's own rows -- */

  function artworkSource() {
    var kind = state.spec.specimen.kind;
    if (kind === 'icon' || kind === 'logo') { return 'asset'; }
    if (kind === 'image' || kind === 'svg') { return 'image'; }
    return 'none';
  }

  /* Source, then what it asks for (the library, or a file), then Placement
     once there is an artwork to place. */
  function artworkRows() {
    var source = artworkSource();
    var rows = [choiceRow('source', 'Source', [['none', 'None'], ['asset', 'Asset'], ['image', 'Image']], source, SOURCE_HINT, handleSourceChange)];
    if (source === 'asset') { rows.push(assetField()); }
    if (source === 'image') { rows.push(artworkImageField()); }
    if (currentArtwork() && hugs()) {
      var hugNote = document.createElement('p');
      hugNote.className = 'form-hint';
      hugNote.dataset.field = 'placement';
      hugNote.textContent = 'The canvas hugs the specimen, so it fills it exactly. Give the canvas a size of its own to fit or fill it.';
      rows.push(hugNote);
    } else if (currentArtwork()) {
      var placement = PLACEMENTS.filter(function (entry) { return entry[1] === state.spec.canvas.fit; })[0] || PLACEMENTS[0];
      rows.push(choiceRow('placement', 'Placement', PLACEMENTS.map(function (entry) { return [entry[0], entry[2]]; }), placement[0], PLACEMENT_HINT, handlePlacementChange));
    }
    return rows;
  }

  /* A segmented row that is not a layer setting: the artwork's source and
     placement live in the spec's artwork and canvas. */
  function choiceRow(name, labelText, choices, value, hint, onChoose) {
    var id = fieldId(name);
    var group = segmentedGroup(id, choices, value);
    group.setAttribute('aria-labelledby', id + '-caption');
    group.addEventListener('change', function handleChoice(event) {
      if (event.target.name === id && event.target.checked) { onChoose(event.target.value); }
    });
    var block = wrap(labelText, group, hint, id, true);
    block.dataset.field = name;
    return block;
  }

  /* The settings rebuilt, focus back on the row the person was in. */
  function rebuildArtworkSettings(field) {
    renderSettings();
    // The checked radio first: the row's ⓘ comes before it in the page, and
    // focus there would throw the next arrow key out of the group.
    var again = el.settings.querySelector('[data-field="' + field + '"] input:checked') ||
      el.settings.querySelector('[data-field="' + field + '"] button:not(.tool-info)');
    if (again) { again.focus(); }
  }

  /* The first of a library, else the first of the other: a page with
     logos and no icons still has assets. */
  /* STARTING_ICON when the brand has it, else its first icon. */
  function startingIcon() {
    if (!state.icons.length) return null;
    var match = state.icons.some(function (entry) { return entry.key === STARTING_ICON; });
    return { kind: 'icon', key: match ? STARTING_ICON : state.icons[0].key };
  }

  function firstAsset(library) {
    var logo = logoVariants().length ? { kind: 'logo', key: logoVariants()[0].id } : null;
    var iconAsset = startingIcon();
    return (library === 'logo' ? logo || iconAsset : iconAsset || logo) || { kind: 'none' };
  }

  function handleSourceChange(source) {
    var art = state.spec.specimen;
    // A spec's own SVG is kept aside while another source is tried, so
    // coming back to Image does not lose it.
    if (art.kind === 'svg') { state.legacySvg = art; }
    if (source === 'none') { state.spec.specimen = { kind: 'none' }; }
    if (source === 'asset') {
      state.spec.specimen = art.kind === 'icon' || art.kind === 'logo' ? art : firstAsset('icon');
      if (state.spec.specimen.kind === 'none') { announce('The library is empty on this page, so there is no asset to place.'); }
    }
    // An image picked earlier in this tab comes back with the source; else
    // the spec's own SVG, if it had one.
    if (source === 'image' && art.kind !== 'image' && art.kind !== 'svg') {
      state.spec.specimen = state.localImage ? { kind: 'image', name: state.localImage.name } : state.legacySvg || { kind: 'image', name: '' };
    }
    state.artworkKey = null;
    if (!currentArtwork() && state.spec.canvas.fit === 'fit-artwork') { state.spec.canvas.fit = state.placementBeforeHug || 'contain'; }
    render();
    syncCanvasPanel();
    rebuildArtworkSettings('source');
    announce(artworkName() + '.' + (currentArtwork() ? '' : source === 'image' ? ' Choose an image to place it.' : ''));
  }

  function handlePlacementChange(value) {
    var placement = PLACEMENTS.filter(function (entry) { return entry[0] === value; })[0];
    if (!placement) { return; }
    state.spec.canvas.fit = placement[1];
    render();
    syncCanvasPanel();
    announce('Placement ' + placement[2] + '.');
  }

  /* The library: icons or logos, a search, and a grid of the assets as
     radios — one tab stop, the arrow keys move through the ones shown. */
  function assetField() {
    var art = state.spec.specimen;
    var library = art.kind === 'logo' ? 'logo' : 'icon';
    var id = fieldId('asset');
    var block = document.createElement('div');
    block.className = 'block gap-s';
    block.dataset.field = 'asset';
    block.setAttribute('role', 'group');
    block.setAttribute('aria-labelledby', id + '-caption');
    block.appendChild(labelRow('Asset', '', id, true));

    if (logoVariants().length) {
      var libraryId = fieldId('library');
      var libraries = segmentedGroup(libraryId, [['icon', 'Icons'], ['logo', 'Logos']], library);
      libraries.setAttribute('aria-label', 'Library');
      libraries.addEventListener('change', function handleLibraryChange(event) {
        if (event.target.name !== libraryId || !event.target.checked) { return; }
        state.spec.specimen = firstAsset(event.target.value);
        state.artworkKey = null;
        render();
        syncCanvasPanel();
        renderSettings();
        var back = el.settings.querySelector('[data-field="asset"] .segmented-control input:checked');
        if (back) { back.focus(); }
        announce(artworkName() + '.');
      });
      block.appendChild(libraries);
    }

    var noun = library === 'logo' ? 'logos' : 'icons';
    var search = document.createElement('search');
    // Named, as the site's own search is the page's other one.
    search.setAttribute('aria-label', library === 'logo' ? 'Logos' : 'Icons');
    var searchLabel = document.createElement('label');
    searchLabel.className = 'visually-hidden';
    searchLabel.htmlFor = id + '-search';
    searchLabel.textContent = 'Search the ' + noun;
    var box = document.createElement('div');
    box.className = 'field';
    box.innerHTML = '<div class="field-icon">' + icon('search') + '</div>';
    var input = document.createElement('input');
    input.type = 'search';
    input.id = id + '-search';
    input.placeholder = 'Search the ' + noun;
    input.autocomplete = 'off';
    input.spellcheck = false;
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'field-clear';
    clear.setAttribute('aria-label', 'Clear search');
    clear.innerHTML = icon('close');
    box.appendChild(input);
    box.appendChild(clear);
    search.appendChild(searchLabel);
    search.appendChild(box);
    block.appendChild(search);

    var grid = document.createElement('div');
    grid.className = 'tool-assets';
    grid.dataset.library = library;
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', library === 'logo' ? 'Logos' : 'Icons');
    var entries = library === 'logo'
      ? logoVariants().map(function (variant) { return { key: variant.id, name: variant.label, markup: inkMarkup(variant.markup) }; })
      : state.icons.map(function (entry) { return { key: entry.key, name: entry.name || entry.key, markup: entry.raw }; });
    var checked = null;
    entries.forEach(function (entry) {
      var tile = document.createElement('label');
      tile.className = 'tool-tile';
      tile.dataset.shape = 'square';
      // The name for the eye; the hidden span below stays the radio's name,
      // and the tooltip's empty alt text keeps it from being read twice.
      tile.dataset.tooltip = entry.name;
      tile.dataset.search = (entry.name + ' ' + entry.key).toLowerCase();
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = id;
      radio.value = entry.key;
      radio.checked = entry.key === art.key;
      if (radio.checked) { checked = tile; }
      var picture = document.createElement('span');
      picture.className = 'tool-asset-icon';
      picture.setAttribute('aria-hidden', 'true');
      picture.innerHTML = thumbnail(entry.markup, id + '-' + grid.children.length + '-');
      var name = document.createElement('span');
      name.className = 'visually-hidden';
      name.textContent = entry.name;
      tile.appendChild(radio);
      tile.appendChild(picture);
      tile.appendChild(name);
      grid.appendChild(tile);
    });
    grid.addEventListener('pointerover', placeAssetTooltip);
    grid.addEventListener('focusin', placeAssetTooltip);
    block.appendChild(grid);

    var none = document.createElement('p');
    none.className = 'form-hint is-hidden';
    block.appendChild(none);
    var searchTimer = null;

    grid.addEventListener('change', function handleAssetChoose(event) {
      if (event.target.name !== id || !event.target.checked) { return; }
      state.spec.specimen = { kind: library, key: event.target.value };
      state.artworkKey = null;
      render();
      syncCanvasPanel();
      if (hugs()) { announce('Canvas ' + fmt(state.spec.canvas.w) + ' by ' + fmt(state.spec.canvas.h) + '.'); }
    });
    input.addEventListener('input', function handleAssetSearch() {
      var query = input.value.trim().toLowerCase();
      var shown = 0;
      Array.prototype.forEach.call(grid.children, function (tile) {
        // The chosen tile stays: hidden, it would leave the group no tab
        // stop, and it is the answer already given.
        var match = !query || tile.querySelector('input').checked || tile.dataset.search.indexOf(query) !== -1;
        tile.classList.toggle('is-hidden', !match);
        if (match) { shown += 1; }
      });
      var others = Array.prototype.filter.call(grid.children, function (tile) {
        return !tile.classList.contains('is-hidden') && !tile.querySelector('input').checked;
      }).length;
      var message = !query ? '' : others ? others + ' ' + (others === 1 ? noun.slice(0, -1) : noun) + ' match.' : 'No ' + noun.slice(0, -1) + ' matches “' + input.value.trim() + '”.';
      none.textContent = query && !others ? message : '';
      none.classList.toggle('is-hidden', !(query && !others));
      // Said once the typing settles, not on every key.
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function sayResults() { if (state && message) { announce(message); } }, 400);
    });
    // The chosen one scrolled into the grid's view, not the page's.
    if (checked) {
      window.requestAnimationFrame(function revealChosen() {
        if (checked.isConnected) { grid.scrollTop = checked.offsetTop - (grid.clientHeight - checked.offsetHeight) / 2; }
      });
    }
    return block;
  }

  /* A tile's tooltip opens above it, but the grid scrolls, so it clips
     whatever crosses its edge: the top row, and the end columns. On hover
     or keyboard focus the bubble is measured against the grid's visible box
     and placed where it fits whole: above, below, then to either side.
     A bubble that fits nowhere stays above. The tools' chip pattern
     (tool-colour.js, placeTooltip), with the vertical edge added. The
     settings' colour chips use the same placement against the settings
     box, so a name at either end of a row turns inward. */
  function placeAssetTooltip(event) {
    placeTooltipIn(event, '.tool-tile[data-tooltip]');
  }

  function placeChipTooltip(event) {
    placeTooltipIn(event, '.chip[data-tooltip]');
  }

  function placeTooltipIn(event, selector) {
    if (!(event.target instanceof Element)) { return; }
    var tile = event.target.closest(selector);
    var grid = event.currentTarget;
    if (!tile || !grid.contains(tile)) { return; }
    tile.removeAttribute('data-tooltip-position');
    var style = window.getComputedStyle(tile, '::before');
    var w = parseFloat(style.width) || 0;
    var h = parseFloat(style.height) || 0;
    // The bubble's bottom sits at 100% plus the gap, so the gap is the rest.
    var gap = Math.max(0, (parseFloat(style.bottom) || 0) - tile.offsetHeight);
    var box = tile.getBoundingClientRect();
    var view = grid.getBoundingClientRect();
    var centre = box.left + box.width / 2;
    var middle = box.top + box.height / 2;
    var fitsAcross = centre - w / 2 >= view.left && centre + w / 2 <= view.right;
    var fitsDown = middle - h / 2 >= view.top && middle + h / 2 <= view.bottom;
    var place = [
      ['', fitsAcross && box.top - gap - h >= view.top],
      ['bottom', fitsAcross && box.bottom + gap + h <= view.bottom],
      ['left', fitsDown && box.left - gap - w >= view.left],
      ['right', fitsDown && box.right + gap + w <= view.right]
    ].filter(function fits(option) { return option[1]; })[0];
    if (place && place[0]) { tile.setAttribute('data-tooltip-position', place[0]); }
  }

  /* An asset's markup at the tile's size: the <svg>'s own width and height
     give way to the box. Markup from the page's manifests, never a
     person's file. */
  function thumbnail(markup, prefix) {
    var sized = String(markup || '').replace(/<svg\b([^>]*)>/i, function size(match, attrs) {
      return '<svg' + attrs.replace(/\s(width|height)="[^"]*"/gi, '') + ' width="100%" height="100%" aria-hidden="true" focusable="false">';
    });
    // Ids made unique per tile (a clip0_… in two icons is two ids on one
    // page), with every reference to them.
    return sized.replace(/\bid="([^"]+)"/g, 'id="' + prefix + '$1"')
      .replace(/url\(#([^)]+)\)/g, 'url(#' + prefix + '$1)')
      .replace(/href="#([^"]+)"/g, 'href="#' + prefix + '$1"');
  }

  /* The image source: a file from this computer, read here and kept in
     this tab alone. An SVG is cleaned first and measured by its viewBox;
     a picture by its pixels. A spec from before carries its own SVG
     (kind svg), which still travels with it. */
  function artworkImageField() {
    var art = state.spec.specimen;
    var id = fieldId('image');
    var group = document.createElement('div');
    group.className = 'block gap-s';
    var local = localImageFor(art);
    var picker = filePicker(id, local || art.kind === 'svg' ? 'Choose another image' : 'Choose an image', 'image/png,image/jpeg,image/webp,image/svg+xml');
    var status = document.createElement('p');
    status.className = 'form-hint';
    status.id = id + '-state';
    status.textContent = art.kind === 'svg'
      ? (art.name || 'The spec\'s own SVG') + ' came with the spec, and goes with it. A new image stays in this tab.'
      : local
        ? local.name + ' is shown here only: the export holds the layers, not the image.'
        : art.name
          ? 'Choose ' + art.name + ' again: an image stays in the tab it was picked in.'
          : 'SVG, PNG or JPG. Shown here only: the export holds the layers, not the image.';
    picker.button.setAttribute('aria-describedby', status.id);
    var error = errorLine(id);
    error.setAttribute('role', 'alert');
    error.classList.remove('is-hidden');
    group.appendChild(picker.button);
    group.appendChild(picker.file);
    group.appendChild(status);
    group.appendChild(error);

    function fail(message) {
      setInvalid(picker.button, error);
      writeAlert(error, message);
    }

    picker.file.addEventListener('change', function handleArtworkImage() {
      var picked = picker.file.files && picker.file.files[0];
      picker.file.value = '';
      if (!picked) { return; }
      if (picked.size > IMAGE_MAX_BYTES) { fail(picked.name + ' is over 8 MB. Export a smaller image and pick it again.'); return; }
      var owner = state;
      var isSvg = /svg/i.test(picked.type) || /\.svg$/i.test(picked.name);
      if (!isSvg) {
        // A picture is drawn from an object URL, not read into a data URL
        // that every render would hand the <image> again.
        var url = URL.createObjectURL(picked);
        var probe = new Image();
        probe.onload = function measured() {
          if (state !== owner) { URL.revokeObjectURL(url); return; }
          if (!(probe.naturalWidth > 0) || !(probe.naturalHeight > 0)) { URL.revokeObjectURL(url); fail(picked.name + ' has no size this tool can read.'); return; }
          placeImage(picked.name, url, probe.naturalWidth, probe.naturalHeight);
        };
        probe.onerror = function unreadable() {
          URL.revokeObjectURL(url);
          if (state === owner) { fail(picked.name + ' is not an image this tool can draw.'); }
        };
        probe.src = url;
        return;
      }
      var reader = new FileReader();
      reader.onload = function handleImageRead() {
        if (state !== owner) { return; }
        var clean = sanitise(reader.result);
        if (clean === null) { fail('The SVG engine did not load, so the file cannot be checked. Reload the page and try again.'); return; }
        var parsed = window.LayerStack.readArtwork(clean, 0);
        if (!parsed) { fail(picked.name + ' has no <svg> with a size this tool can read. Give it a viewBox, or a width and height.'); return; }
        // Through an <image>, an SVG with no viewBox draws at its own size
        // and ignores the box; one written in makes it scale like the rest.
        var vb = parsed.viewBox;
        parsed.svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].join(' '));
        var markup = new XMLSerializer().serializeToString(parsed.svg);
        placeImage(picked.name, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup), vb.w, vb.h);
      };
      reader.onerror = function handleImageError() { if (state === owner) { fail(picked.name + ' could not be read. Try saving it again, or pick another file.'); } };
      reader.readAsText(picked);
    });
    var block = wrapPicker('Image', group, picker.button, id);
    block.dataset.field = 'image';
    return block;
  }

  function placeImage(name, href, w, h) {
    dropLocalImage();
    state.localImageCount += 1;
    state.localImage = { id: state.localImageCount, name: name, href: href, w: w, h: h };
    state.spec.specimen = { kind: 'image', name: name };
    state.artworkKey = null;
    render();
    syncCanvasPanel();
    rebuildArtworkSettings('image');
    announce(name + ' placed on the canvas, in this tab only.');
  }

  /* A marker file that does not suit the new kind (SVG markup for an
     image marker, an image for an SVG one) is dropped rather than kept
     unseen and still reported as in use. */
  function dropUnsuitedMarkerFile(layer) {
    var src = layer.settings.markerSrc || '';
    var suits = (layer.settings.marker === 'svg' && /^\s*</.test(src)) ||
      (layer.settings.marker === 'image' && /^(https?:\/\/|data:image\/)/i.test(src));
    if (src && !suits) { layer.settings.markerSrc = ''; render(); }
  }

  function handleSettingsClick(event) {
    var button = event.target.closest('button[data-role]');
    if (!button) { return; }
    if (button.dataset.role === 'duplicate') { handleDuplicate(); }
    if (button.dataset.role === 'ungroup') { ungroup(state.selectedId); }
    if (button.dataset.role === 'delete') { confirmDelete(state.selectedId, button); }
  }

  /* Some fields only apply to one kind or form: what a measure reads, a
     guide's or a grid's kind, a zone's display and marker, a shape's form
     and any layer's draw rebuild the form, and focus returns to the
     control. A measure switched to a zone starts on the first one rather
     than on nothing. */
  function handleSettingsChange(event) {
    var layer = layerById(state.selectedId);
    var block = event.target.closest('[data-field]');
    // A menu or a segmented control; a colour chip is a radio too, but no
    // colour rebuilds the form.
    if (!layer || !block || (event.target.tagName !== 'SELECT' && event.target.type !== 'radio')) { return; }
    var field = block.dataset.field;
    if (layer.type === 'zone' && field === 'marker') { dropUnsuitedMarkerFile(layer); }
    if (layer.type === 'measure' && field === 'target' && measuresZone(layer) && !layerById(layer.settings.zone)) {
      layer.settings.zone = firstZoneId();
      render();
    }
    // Turning a measure keeps its value where it was relative to the box:
    // below a width is right of a height.
    var turnNote = '';
    if (layer.type === 'measure' && field === 'axis') {
      // Every side turns with it, so the value keeps its place against
      // the box: below a width is right of a height, before its start is
      // above a height's.
      var turned = { top: 'left', left: 'top', bottom: 'right', right: 'bottom' }[layer.settings.value];
      if (turned) {
        layer.settings.value = turned;
        render();
        turnNote = ' Value moved to ' + turned.charAt(0).toUpperCase() + turned.slice(1) + '.';
      }
      // A span's line sits at a length, not an edge, so it has nothing to name.
      if (layer.settings.target !== 'span') {
        var edges = shortNames(layer, 'edge');
        turnNote = ' Line at: ' + [edges.start, edges.centre, edges.end].join(', ') + '.' + turnNote;
      }
    }
    if ((layer.type === 'measure' && (field === 'target' || field === 'axis')) || (layer.type === 'zone' && (field === 'marker' || field === 'display')) || (layer.type === 'shape' && field === 'form') ||
      (layer.type === 'guide' && field === 'kind') || (layer.type === 'grid' && field === 'kind') || field === 'draw') {
      renderSettings();
      var again = el.settings.querySelector('[data-field="' + field + '"] select, [data-field="' + field + '"] input:checked');
      if (again) { again.focus(); }
      if (layer.type === 'guide' || layer.type === 'grid' || layer.type === 'measure' || field === 'draw') { announce(shownFieldsMessage(field === 'draw') + turnNote); }
    }
  }

  /* After a rebuild, the settings the form now shows, for a screen reader. */
  /* The paints are left out, as colour and opacity always were, except
     after a change of draw, which is what brings them and takes them. */
  function shownFieldsMessage(withPaint) {
    var quiet = ['kind', 'draw', 'colour', 'opacity'].concat(withPaint ? [] : ['outlineColour', 'outlineOpacity', 'fillColour', 'fillOpacity']);
    var names = Array.prototype.filter.call(el.settings.querySelectorAll('[data-field]'), function (block) {
      return !block.classList.contains('is-hidden') && quiet.indexOf(block.dataset.field) === -1;
    }).map(function (block) {
      var label = block.querySelector('[data-variant="caption"]');
      return label ? label.textContent.toLowerCase() : '';
    }).filter(Boolean);
    return names.length ? 'Settings: ' + names.join(', ') + '.' : '';
  }

  //
  //------- The spec in and out -------//
  //

  function loadSpec(spec, message, notes) {
    // What converting it changed, shown in the canvas settings until the
    // next spec, and said once.
    state.conversionNotes = notes && notes.length ? notes.slice() : null;
    // A new spec's own SVG is its own; an older one kept aside is not.
    state.legacySvg = null;
    // A placement remembered from the last spec is not this one's.
    state.placementBeforeHug = null;
    state.folded = {};
    state.spec = resolveArtwork(spec);
    state.artworkKey = null;
    if (!currentArtwork() && state.spec.canvas.fit === 'fit-artwork') { state.spec.canvas.fit = 'contain'; }
    // The canvas first: what a new spec is drawn on.
    state.selectedId = CANVAS_ID;
    hideError();
    render();
    syncCanvasPanel();
    renderList();
    renderSettings();
    if (message) { announce(message); }
  }

  /* Kept in this browser a moment after the last change, not on every
     keystroke. If the spec is too large (a picked image), it is kept
     without its pictures; if even that fails, nothing stale is left. */
  function saveLocal() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(writeLocal, SAVE_DELAY_MS);
  }

  function writeLocal() {
    if (!state) { return; }
    try {
      window.localStorage.setItem(STORAGE_KEY, window.LayerStack.serializeSpec(state.spec));
    } catch (error) {
      try {
        window.localStorage.setItem(STORAGE_KEY, window.LayerStack.serializeSpec(state.spec, { includeImages: false }));
      } catch (again) {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (ignored) { /* storage unavailable */ }
      }
    }
  }

  /* The spec kept in this browser, with what converting it from an older
     version changed. */
  function readLocal() {
    try {
      var text = window.localStorage.getItem(STORAGE_KEY);
      var legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!text && legacy) { text = legacy; }
      // The old key goes either way: the spec is open, and the next save
      // writes it under the new key (without its images if it is too large).
      // Copied first in a try of its own, so a full storage never loses it.
      if (legacy) {
        if (text === legacy) {
          try { window.localStorage.setItem(STORAGE_KEY, legacy); } catch (full) { /* saved again on the next change */ }
        }
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      var notes = [];
      return text ? { spec: cleanSpec(window.LayerStack.parseSpec(text, notes)), notes: notes } : null;
    } catch (error) {
      return null;
    }
  }

  /* What a conversion changed, as one message after the one given. */
  function withNotes(message, notes) {
    if (!notes || !notes.length) { return message; }
    return (message ? message + ' ' : '') + 'Converted from an earlier Layout Spec: ' + notes.join(' ');
  }

  /* A spec from outside — a file, a link, storage — has its artwork run
     through the sanitiser and its image sources limited to images. */
  /* An image layer's source: a web address, an image's data, or a file in
     this site's own images (the platform interfaces), with no way out of
     that folder. */
  var IMAGE_SRC = /^(https?:\/\/|data:image\/|\/assets\/images\/[\w-]+(\/[\w-]+)*\.(svg|png|jpe?g|webp)$)/i;

  function cleanSpec(spec) {
    if (spec.specimen.kind === 'svg') {
      var clean = spec.specimen.src ? sanitise(spec.specimen.src) : '';
      spec.specimen = clean ? { kind: 'svg', name: spec.specimen.name || '', src: clean, unit: Number(spec.specimen.unit) || 0 } : { kind: 'none' };
    }
    window.LayerStack.flatLayers(spec).forEach(function (layer) {
      if (layer.type === 'image' && layer.settings.src && !IMAGE_SRC.test(layer.settings.src)) { layer.settings.src = ''; }
      if (layer.type === 'zone' && layer.settings.markerSrc) {
        var src = layer.settings.markerSrc;
        if (layer.settings.marker === 'svg') { layer.settings.markerSrc = sanitise(src) || ''; }
        else if (!/^(https?:\/\/|data:image\/)/i.test(src)) { layer.settings.markerSrc = ''; }
      }
    });
    return spec;
  }

  function encodeSpec(spec) {
    var text = window.LayerStack.serializeSpec(spec, { includeImages: false });
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeSpec(param) {
    var base = param.replace(/-/g, '+').replace(/_/g, '/');
    var binary = atob(base + '==='.slice((base.length + 3) % 4));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
    return new TextDecoder().decode(bytes);
  }

  /* The link's spec, read once: the parameter is then taken out of the
     address, so a reload keeps the edits made since rather than reapplying
     the link over them. */
  function readLinkSpec() {
    var param = new URLSearchParams(window.location.search).get('spec');
    if (!param) { return { spec: null, error: '' }; }
    dropLinkParam();
    try {
      var notes = [];
      var spec = cleanSpec(window.LayerStack.parseSpec(decodeSpec(param), notes));
      return { spec: spec, notes: notes, error: '' };
    } catch (error) {
      return { spec: null, error: 'The link\'s spec could not be read (' + error.message + '). Your last spec is open instead.' };
    }
  }

  function dropLinkParam() {
    var url = new URL(window.location.href);
    if (!url.searchParams.has('spec')) { return; }
    url.searchParams.delete('spec');
    window.history.replaceState(window.history.state, '', url.toString());
  }

  //
  //------- Export -------//
  //

  var EXPORT_FAILED = 'The SVG could not be made. Export as Spec (JSON) instead: it keeps everything.';

  var FORMATS = {
    svg: { word: 'SVG', extension: '.layout-spec.svg', type: 'image/svg+xml' },
    json: { word: 'spec', extension: '.layout-spec.json', type: 'application/json' }
  };

  function format() {
    var checked = el.format.querySelector('input:checked');
    return checked && FORMATS[checked.value] ? checked.value : 'svg';
  }

  function fileName() {
    var spec = state.spec;
    var base = (spec.template || 'layout-spec') + '-' + fmt(spec.canvas.w) + 'x' + fmt(spec.canvas.h);
    return base.replace(/[^a-z0-9.-]+/gi, '-') + FORMATS[format()].extension;
  }

  /* What the Export panel says the file will be, rewritten with the spec. */
  function syncExport() {
    var chosen = FORMATS[format()];
    el.filename.value = fileName();
    el.downloadFormat.textContent = chosen.word;
    el.copyFormat.textContent = chosen.word;
    el.includeArtworkRow.classList.toggle('is-hidden', format() !== 'svg');
  }

  function handleFormatChange() {
    syncExport();
  }

  /* The file's text. The SVG is read from the drawing as it stands, so it
     is made when asked for, never on every render. */
  function exportText() {
    linkedImages = [];
    if (format() === 'json') { return window.LayerStack.serializeSpec(state.spec, { pretty: true }); }
    if (!state.lastResult) { throw new Error('the canvas has not been drawn'); }
    return window.LayerStack.exportSvg(el.svg, state.lastResult, state.spec, {
      artwork: el.includeArtwork.checked,
      labels: el.labels.checked,
      images: loadedImages(),
      onLinked: function noteLinked(linked) { linkedImages = linked; },
      title: 'Layout spec — ' + fileName()
    });
  }

  function handleDownload() {
    hideError();
    var text;
    try {
      text = exportText();
    } catch (error) {
      console.error('[layout-specs] export failed', error);
      showError(EXPORT_FAILED);
      return;
    }
    var blob = new Blob([text], { type: FORMATS[format()].type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function revoke() { URL.revokeObjectURL(url); }, 1000);
    announce(fileName() + ' downloaded.');
    noteLinkedImages();
  }

  /* An image the file could not carry stays a link, which shows only
     where this site can be reached. Said, not hidden, and the ones that
     failed are tried again for the next export. */
  function noteLinkedImages() {
    if (!linkedImages.length) { return; }
    linkedImages.forEach(function (src) { if (state.images[src] && state.images[src].failed) { delete state.images[src]; } });
    loadImages();
    var count = linkedImages.length;
    showError((count === 1 ? 'One image could not be loaded into the file, so it stays a link and shows' : count + ' images could not be loaded into the file, so they stay links and show') + ' only where this site opens. Export again in a moment to try once more.');
  }

  function copyText(text, done) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showError('This browser does not allow copying from the page. Download the spec instead.');
      return;
    }
    var owner = state;
    navigator.clipboard.writeText(text).then(function copied() {
      if (state === owner) { announce(done); }
    }, function refused() {
      if (state === owner) { showError('The browser refused the copy. Download the spec instead.'); }
    });
  }

  /* Runs before copy-button.js, which listens on the document and copies
     data-copy: the text is put there at the moment of the click. */
  function handleCopy() {
    hideError();
    try {
      el.copy.setAttribute('data-copy', exportText());
      noteLinkedImages();
    } catch (error) {
      el.copy.setAttribute('data-copy', '');
      console.error('[layout-specs] export failed', error);
      showError(EXPORT_FAILED);
    }
  }

  function handleCopyLink() {
    hideError();
    var url = new URL(window.location.href);
    url.searchParams.set('spec', encodeSpec(state.spec));
    var dropped = state.spec.specimen.kind === 'svg' || state.spec.specimen.kind === 'image' || window.LayerStack.flatLayers(state.spec).some(function (layer) {
      return (layer.type === 'image' && /^data:/.test(layer.settings.src || '')) || (layer.type === 'zone' && /^(data:|\s*<)/.test(layer.settings.markerSrc || ''));
    });
    copyText(url.toString(), dropped ? 'Link copied. Your own SVG, picked images and marker files stay out of a link; download the spec to keep what it can carry.' : 'Link copied.');
  }

  function handleImportClick() {
    hideError();
    el.importFile.click();
  }

  function handleImportFile() {
    var file = el.importFile.files && el.importFile.files[0];
    if (!file) { return; }
    var owner = state;
    var reader = new FileReader();
    reader.onload = function handleSpecRead() {
      if (state !== owner) { return; }
      var text = String(reader.result || '');
      // An SVG made here carries its spec; one made anywhere else does not,
      // and can only come in as artwork.
      if (/^\s*</.test(text)) {
        text = window.LayerStack.readSpecFromSvg(text);
        if (!text) {
          showError(file.name + ' carries no spec. An SVG made elsewhere goes on the canvas as a specimen: select the Specimen layer and set its Source to Image.');
          return;
        }
      }
      try {
        var notes = [];
        var spec = cleanSpec(window.LayerStack.parseSpec(text, notes));
        loadSpec(spec, withNotes(file.name + ' imported.', notes), notes);
      } catch (error) {
        showError(file.name + ' is not a spec this tool can read: ' + error.message);
      }
    };
    reader.onerror = function handleSpecError() { if (state === owner) { showError(file.name + ' could not be read.'); } };
    reader.readAsText(file);
    el.importFile.value = '';
  }

  function handleReset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) { /* nothing kept */ }
    dropLinkParam();
    dropLocalImage();
    state.legacySvg = null;
    loadSpec(window.LayerStack.createSpec(DEFAULT_TEMPLATE), 'Reset to a blank canvas. Choose a template in the canvas settings, or add layers.');
  }

  //
  //------- Preview options -------//
  //

  function syncGround() {
    var dark = el.dark.checked;
    el.previewBand.setAttribute('data-ground', dark ? 'dark' : 'light');
    el.previewBand.setAttribute('data-preview-ink', dark ? 'light' : 'dark');
    el.stage.setAttribute('data-ground', dark ? 'dark' : 'light');
  }

  function handleDark() {
    syncGround();
    render();
  }

  function handleLabels() {
    render();
  }

  //
  //------- Messages -------//
  //

  function announce(message) {
    if (!el) { return; }
    window.clearTimeout(statusTimer);
    // Emptied first and written a frame later, so the same message twice is
    // read twice.
    el.status.textContent = '';
    window.requestAnimationFrame(function writeStatus() { if (el) { el.status.textContent = message; } });
    statusTimer = window.setTimeout(function clearStatus() { if (el) { el.status.textContent = ''; } }, STATUS_CLEAR_MS);
  }

  /* The error line sits over the verbs, which the Controls toggle folds
     away with the dock; a failure from the bar's menu unfolds it again, so it
     is seen where the docs say it is. The line stays in the accessibility
     tree while empty (tools.css, The actions), so the text is announced. */
  function showError(message) {
    if (el.dock && el.dock.classList.contains('is-collapsed') && el.dockToggle) { el.dockToggle.click(); }
    el.error.textContent = '';
    window.requestAnimationFrame(function writeError() { if (el) { el.error.textContent = message; } });
  }

  function hideError() {
    el.error.textContent = '';
  }

  //
  //------- Setup -------//
  //

  function resolveRoot(scope) {
    var root = scope || document;
    if (root.matches && root.matches(ROOT_SELECTOR)) { return root; }
    return root.querySelector ? root.querySelector(ROOT_SELECTOR) : null;
  }

  function resolveElements(root) {
    return {
      root: root,
      previewBand: root.querySelector('.tool-preview'),
      stage: root.querySelector('#al-stage'),
      labelHost: root.querySelector('#al-labels-host'),
      svg: root.querySelector('#al-svg'),
      detailSize: root.querySelector('#al-detail-size'),
      detailRatio: root.querySelector('#al-detail-ratio'),
      detailArtwork: root.querySelector('#al-detail-artwork'),
      warning: root.querySelector('#al-warning'),
      dark: root.querySelector('#al-dark'),
      labels: root.querySelector('#al-labels'),
      newTemplate: root.querySelector('#al-new'),
      add: root.querySelector('#al-add'),
      addGroup: root.querySelector('#al-add-group'),
      list: root.querySelector('#al-list'),
      settings: root.querySelector('#al-settings'),
      settingsHeading: root.querySelector('#al-settings-heading'),
      format: root.querySelector('#al-format'),
      filename: root.querySelector('#al-filename'),
      includeArtwork: root.querySelector('#al-include-artwork'),
      includeArtworkRow: root.querySelector('#al-include-artwork-row'),
      download: root.querySelector('#al-download'),
      downloadFormat: root.querySelector('#al-download-format'),
      copy: root.querySelector('#al-copy'),
      copyFormat: root.querySelector('#al-copy-format'),
      copyLink: root.querySelector('#al-copy-link'),
      importButton: root.querySelector('#al-import'),
      importFile: root.querySelector('#al-import-file'),
      reset: root.querySelector('#al-reset'),
      status: root.querySelector('#al-status'),
      dock: root.querySelector('#al-dock'),
      dockToggle: root.querySelector('.tool-dock-toggle'),
      error: root.querySelector('#al-error'),
      icons: root.querySelector('#al-icons')
    };
  }

  function wireControls() {
    el.newTemplate.addEventListener('click', handleNewFromTemplate);
    el.add.addEventListener('click', handleAddClick);
    el.addGroup.addEventListener('click', handleAddGroup);
    el.list.addEventListener('click', handleListClick);
    el.list.addEventListener('keydown', handleListKeydown);
    el.list.addEventListener('pointerdown', handleGripDown);
    el.settings.addEventListener('click', handleSettingsClick);
    el.root.addEventListener('click', handleInfoToggle);
    el.settings.addEventListener('change', handleSettingsChange);
    el.settings.addEventListener('pointerover', placeChipTooltip);
    el.settings.addEventListener('focusin', placeChipTooltip);
    el.format.addEventListener('change', handleFormatChange);
    el.download.addEventListener('click', handleDownload);
    el.copy.addEventListener('click', handleCopy);
    el.copyLink.addEventListener('click', handleCopyLink);
    el.importButton.addEventListener('click', handleImportClick);
    el.importFile.addEventListener('change', handleImportFile);
    el.reset.addEventListener('click', handleReset);
    el.dark.addEventListener('change', handleDark);
    el.labels.addEventListener('change', handleLabels);
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(fitStage);
      resizeObserver.observe(el.stage.parentElement);
    }
  }

  function release() {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    window.clearTimeout(statusTimer);
    statusTimer = null;
    if (saveTimer) { window.clearTimeout(saveTimer); writeLocal(); saveTimer = null; }
    if (drag) { endDrag(null); }
    if (deleteDialog) {
      if (deleteDialog.open) { deleteDialog.close(); }
      deleteDialog.remove();
      deleteDialog = null;
    }
    pendingDeleteId = null;
    deleteTrigger = null;
    if (templateDialog) {
      if (templateDialog.open) { templateDialog.close(); }
      templateDialog.remove();
      templateDialog = null;
    }
    templateTrigger = null;
    if (addDialog) {
      if (addDialog.open) { addDialog.close(); }
      addDialog.remove();
      addDialog = null;
    }
    canvasEl = null;
    dropLocalImage();
    state = null;
    el = null;
  }

  function initLayoutSpecs(scope) {
    var root = resolveRoot(scope);
    if (!root) { release(); return; }
    if (root.dataset.layoutSpecsInit) { return; }
    root.dataset.layoutSpecsInit = 'true';
    release();
    el = resolveElements(root);
    var missing = Object.keys(el).filter(function (key) { return !el[key]; });
    if (missing.length || !window.LayerStack) {
      console.error('[layout-specs] missing: ' + (missing.join(', ') || 'LayerStack engine'));
      if (el.error) { el.error.textContent = 'The tool could not start: part of the page or its engine did not load. Reload to try again.'; }
      return;
    }
    state = { conversionNotes: null, spec: null, selectedId: null, icons: readIconManifest(root), artwork: null, artworkKey: null, lastResult: null, images: {}, localImage: null, localImageCount: 0, legacySvg: null, placementBeforeHug: null, folded: {} };
    wireControls();
    syncGround();
    var link = readLinkSpec();
    var kept = link.spec ? null : readLocal();
    var opened = link.spec ? { spec: link.spec, notes: link.notes } : kept || { spec: window.LayerStack.createSpec(DEFAULT_TEMPLATE), notes: [] };
    loadSpec(opened.spec, '', opened.notes);
    // Said after the page has settled: a live region inserted by a page
    // swap misses its first update in some screen readers.
    if (opened.notes.length) {
      window.setTimeout(function sayConverted() { if (state) { announce(withNotes('', opened.notes)); } }, 1000);
    }
    if (link.error) { showError(link.error); }
    console.log('[layout-specs] init');
  }

  window.initLayoutSpecs = initLayoutSpecs;

  //
  //------- Initialize -------//
  //

  function handleDomReady() {
    initLayoutSpecs();
  }

  function handleAfterNav(event) {
    var container = event.detail && event.detail.container;
    window.requestAnimationFrame(function initAfterPaint() {
      if (container && !container.isConnected) { return; }
      initLayoutSpecs(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady);
  } else {
    initLayoutSpecs();
  }

  document.addEventListener('bd:after-nav', handleAfterNav);
})();
