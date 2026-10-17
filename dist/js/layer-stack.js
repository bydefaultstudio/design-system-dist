/* @bydefaultstudio/design-system v7.0.0 */
/**
 * layer-stack.js — the engine behind Layout Spec: a canvas, the specimen on
 * it, and an ordered stack of rules drawn over (or under) it.
 *
 * A library. It binds nothing, owns no page and has no init, so it is loaded
 * on every page (extraScripts) and survives a Barba swap untouched. Its
 * consumers are the Layout Specs tool (layout-specs.js), the Icon
 * Library's Guides switch and the Logo Tool's Safe zone switch.
 *
 * The model is Layout Spec version 2 (format-system.md §0, decided
 * 2026-10-04). A spec records the rules artwork lives by, not the artwork:
 * what sits on the canvas is a specimen, a stand-in to test the rules
 * against.
 *
 *   spec
 *     version      2 (a version 1 spec is converted on the way in: parseSpec)
 *     canvas       the root, never a layer
 *       w, h       the box the specimen is placed in, in canvas units (px for
 *                  a social format, the viewBox for an icon)
 *       fit        how the specimen meets it:
 *                    fit-artwork  the canvas IS the specimen's own box
 *                                 (Hug: w/h follow it)
 *                    contain      the specimen fits inside
 *                    cover        the specimen fills it, cropped at its edge
 *       shape      rectangle · circle · rounded (radius, % of the shorter
 *                  side) · app-icon. One per canvas: it replaces every v1
 *                  mask. It clips the reference (the specimen, the
 *                  background, an image under the specimen), never the rules
 *       shapeShow  any of outside (shade what the shape cuts away), inside
 *                  (shade what stays), outline
 *       background a colour or a colour token; empty is transparent. It
 *                  replaces the v1 fill under the artwork
 *     reference    { w, h }: the canvas size px lengths were written for
 *     specimen     { kind, key, src }: what is placed: an icon key, a logo
 *                  variant id, an SVG's own markup, an image, or none. An
 *                  image is { kind: 'image', name } alone: the picture stays
 *                  in the browser that picked it, to check the rules
 *                  against, and never enters the spec or an exported file
 *     layers       [ layer | group ]  bottom to top. Exactly one is the
 *                  specimen layer, always at this top level, so an image
 *                  can sit under it (a reference) or over it (a rule, such as
 *                  a platform's interface) by its place here.
 *
 *   group          optional, one level deep: never a group in a group, never
 *                  the specimen in a group (2026-10-02)
 *     id, label, visible            as a layer; a hidden group hides every
 *                                   layer in it without touching their own
 *                                   visible, so they come back as they were
 *     type         'group'
 *     layers       [ layer ]        bottom to top, as above
 *
 *   layer          one structure for every type (§0.8)
 *     envelope     id (unique), type, preset (a name, not a contract),
 *                  label, visible; and, all optional: source (platform ·
 *                  technology · directory · measured: who set the rule),
 *                  verified (the date it was last checked), approximate
 *                  (a measured estimate: drawn finer, so it never claims
 *                  more precision than it has), locked (a platform rule no
 *                  brand edits)
 *     settings     the geometry the type takes and the shared appearance:
 *                  draw (outline · fill · both), lineWeight, lineStyle
 *                  (solid · dashed), and two paints, each its own colour
 *                  and opacity: outlineColour, outlineOpacity for the
 *                  lines, fillColour, fillOpacity for the areas (TYPES
 *                  below). A measure has lines only: colour, opacity.
 *
 *   types          specimen · zone · shape · guide · grid · measure · note · image
 *     zone         derived: a box (canvas or specimen), an edge (inside or
 *                  outside), an amount; display ring or area
 *     shape        placed: x, y, w, h, a form
 *     guide, grid  a pattern over a box
 *     measure      dimension lines with their values
 *     note, image  placed: a note at x, y; an image in x, y, w, h
 *
 * Every length is { value, unit } — or a bare number, read as px (as %
 * where a type says so). Units:
 *   px  canvas units
 *   %   of the reference box: per axis for a grid (so ten columns are ten
 *       columns on a 98px canvas), of the shorter side for an inset
 *   X   the specimen's own unit (for a logo, the glyph width its manifest
 *       names), scaled to the canvas
 * A value may be a token instead of a number — { token: '--artwork-icon-padding',
 * unit: 'px' } — read from the document at render, so a token change
 * redraws every layer bound to it. Lengths in px are in the canvas the spec
 * was written for; a spec applied to a canvas of the same ratio at another
 * size scales them (scaleFactor), and one of another ratio is flagged, not
 * stretched.
 *
 * The bleed is the canvas and every zone and shape together, hidden ones
 * too (hiding a layer never moves another, format-system.md §5), and never
 * the specimen's drawing, so a rule's stated size never changes with the
 * sample loaded (N6). A guide's straight lines can run out to it (bleed),
 * placed where they were; a measure can measure it (target 'all'). Nothing
 * is positioned from it. The view still grows to show the whole specimen.
 *
 * Geometry is computed, never stored: the stored spec is the inputs, and
 * compute() turns them into boxes and shapes on every render.
 *
 * Paint: each layer draws inside <g class="layer-stack-layer" data-type
 * data-layer-id data-line> with its paints on its style: the outline's
 * colour and opacity, the fill's, and the line weight (a measure, a
 * specimen and an image: one colour and opacity). Every part the engine draws is
 * .layer-stack-fill (an area), .layer-stack-edge (a line) or both; a layer's
 * draw keeps the parts it asks for, so the stylesheet (tools.css, Layer
 * stack) paints two classes, not one rule per type. A colour is any CSS
 * colour — the defaults are the --overlay-* tokens, so the category colour,
 * the line weight and the dash are token edits.
 *
 * The specimen is fitted, sized (Size: a share of the fit, or a width in
 * px) and centred, then moved by its Offset. All of that reads its box
 * less its Overshoot (2026-10-04): how far, on each edge, the drawing's
 * round forms and strokes reach past the shape the rules are built on — an
 * o below the baseline, a b above the cap height. The box is trimmed by
 * it; the drawing never is. It draws whole, past the trimmed box and past
 * the canvas when it hugs, and every layer measured from the specimen
 * reads the trimmed box. Overshoot is in the specimen's own units (its
 * viewBox), % of its width or height, or X. A zone's offset split four
 * ways is deliberately absent: the owner parked it on 2026-10-02, so an
 * inset is one amount on every side.
 *
 * Export: exportSvg() turns a render into a file of its own — every layer a
 * group named as the layer is, every part inside it named for what it is
 * (data-part, set where it is drawn), groups kept as groups, each layer's
 * labels inside it as SVG text, the paint the stylesheet gave it written in,
 * and the spec inside <metadata>, so readSpecFromSvg() can bring it back in
 * to edit. A design tool shows each id as a layer name.
 *
 * 3.0.0 (format version 3): the outline and the fill are two paints. A
 * zone, shape, guide or grid has outlineColour, outlineOpacity, fillColour
 * and fillOpacity in place of one colour and opacity. A version 2 spec is
 * converted on the way in (splitPaint) and draws as it did: a zone's or a
 * shape's outline keeps the 2.5× strength the stylesheet used to give it.
 *
 * @version 3.0.0
 */
(function () {
  'use strict';

  var VERSION = '3.0.0';
  console.log('[layer-stack] v' + VERSION + ' loaded');

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SPEC_VERSION = 3;

  //
  //------- Types -------//
  //

  /* What each type is and which settings it takes. The tool builds its
     settings form from `fields`, so a new setting is one entry here and one
     line in compute(). */
  var APPEARANCE = ['draw', 'lineWeight', 'lineStyle', 'outlineColour', 'outlineOpacity', 'fillColour', 'fillOpacity'];

  /* The types drawn in two paints, an outline and a fill. */
  var TWO_PAINT = ['zone', 'shape', 'guide', 'grid'];

  var TYPES = {
    specimen: {
      label: 'Specimen',
      single: true,
      fields: ['size', 'offsetX', 'offsetY', 'overshootTop', 'overshootRight', 'overshootBottom', 'overshootLeft', 'opacity']
    },
    zone: {
      label: 'Zone',
      fields: ['display', 'edge', 'reference', 'amount'].concat(APPEARANCE,
        ['marker', 'markerText', 'markerSrc', 'markerRotate', 'markerOrient', 'markerRepeat', 'markerColour', 'markerOpacity'])
    },
    shape: {
      label: 'Shape',
      fields: ['form', 'radius', 'x', 'y', 'w', 'h'].concat(APPEARANCE)
    },
    guide: {
      label: 'Guide',
      fields: ['kind', 'axis', 'reference', 'bleed', 'position', 'size', 'ratio', 'radius'].concat(APPEARANCE)
    },
    grid: {
      label: 'Grid',
      fields: ['kind', 'reference', 'cell', 'align', 'count', 'margin', 'gutter'].concat(APPEARANCE)
    },
    // A measure is lines and numbers: nothing to fill.
    measure: {
      label: 'Measure',
      fields: ['target', 'zone', 'lineWeight', 'lineStyle', 'colour', 'opacity']
    },
    note: {
      label: 'Note',
      fields: ['text', 'x', 'y']
    },
    image: {
      label: 'Image',
      fields: ['src', 'x', 'y', 'w', 'h', 'fit', 'opacity']
    }
  };

  /* The choices a select-type setting offers, per type where they differ. */
  var CHOICES = {
    'zone.display': [['ring', 'Ring — the band between edge and inset'], ['area', 'Area — the box inside the inset']],
    'zone.edge': [['inside', 'Inside the reference'], ['outside', 'Outside the reference']],
    'zone.marker': [['none', 'None'], ['glyph', 'The specimen\'s X glyph'], ['text', 'Text'], ['svg', 'An SVG'], ['image', 'An image']],
    'zone.markerOrient': [['follow', 'Turns with each edge'], ['fixed', 'The same on every edge']],
    'zone.markerRepeat': [['edges', 'One on each edge'], ['tile', 'Repeated along each edge']],
    'shape.form': [['rectangle', 'Rectangle'], ['circle', 'Circle'], ['rounded', 'Rounded rectangle']],
    'guide.kind': [['centre', 'Centre lines'], ['diagonal', 'Diagonals'], ['circle', 'Keyline circle'], ['square', 'Keyline rectangle'], ['thirds', 'Thirds'], ['line', 'Single line']],
    'guide.axis': [['vertical', 'Vertical'], ['horizontal', 'Horizontal']],
    'grid.kind': [['cells', 'Cells'], ['columns', 'Columns'], ['rows', 'Rows']],
    'measure.target': [['canvas', 'The canvas'], ['specimen', 'The specimen'], ['zone', 'A zone'], ['all', 'Canvas + bleed']],
    'image.fit': [['contain', 'Fit inside'], ['cover', 'Fill and crop']],
    'canvas.shape': [['rectangle', 'Rectangle'], ['circle', 'Circle'], ['rounded', 'Rounded'], ['app-icon', 'App icon']],
    'canvas.shapeShow': [['outside', 'Shade outside: what the shape cuts away'], ['inside', 'Shade inside: what stays'], ['outline', 'Outline']],
    reference: [['canvas', 'Canvas'], ['specimen', 'Specimen']],
    align: [['start', 'From the top left'], ['centre', 'From the centre']],
    draw: [['outline', 'Outline'], ['fill', 'Fill'], ['both', 'Both']],
    lineStyle: [['solid', 'Solid'], ['dashed', 'Dashed']],
    source: [['platform', 'Platform'], ['technology', 'Technology'], ['directory', 'Directory'], ['measured', 'Measured']],
    units: ['px', '%', 'X']
  };

  /* Settings whose choices are the same on every type that takes them. */
  var SHARED_CHOICES = ['reference', 'align', 'draw', 'lineStyle'];

  //
  //------- Presets -------//
  //

  /* Presets are named starting points. The ids are the vocabulary from the
     owner's terminology note, with grid as its own category (owner,
     2026-10-02). A preset is copied into a layer; the layer never refers
     back to it, so editing a preset never moves a saved spec. */
  var PRESETS = {
    'specimen':             { type: 'specimen',   label: 'Specimen',       settings: { opacity: 1 } },
    'zone.padding':         { type: 'zone',       label: 'Padding',        settings: { display: 'ring', edge: 'inside', reference: 'canvas', amount: { token: '--artwork-icon-padding', unit: 'px' } } },
    'zone.live-area':       { type: 'zone',       label: 'Live area',      settings: { display: 'area', edge: 'inside', reference: 'canvas', amount: { token: '--artwork-icon-padding', unit: 'px' }, lineStyle: 'dashed' } },
    'zone.clear-space':     { type: 'zone',       label: 'Clear space',    settings: { display: 'ring', edge: 'outside', reference: 'specimen', amount: { token: '--artwork-logo-clear-space', unit: 'X' }, marker: 'glyph' } },
    'zone.safe-area':       { type: 'zone',       label: 'Safe area',      settings: { display: 'ring', edge: 'inside', reference: 'canvas', amount: { value: 8, unit: '%' } } },
    // A tap target or the slot an object sits in: an outline. A coloured
    // area (what a v1 fill over the artwork becomes): a fill.
    'shape.tap-area':       { type: 'shape',      label: 'Tap area',       settings: { form: 'rectangle', x: { value: 40, unit: '%' }, y: { value: 40, unit: '%' }, w: { value: 20, unit: '%' }, h: { value: 20, unit: '%' }, draw: 'outline', lineStyle: 'dashed' } },
    'shape.area':           { type: 'shape',      label: 'Coloured area',  settings: { form: 'rectangle', draw: 'fill', fillColour: 'var(--neutral-600)', fillOpacity: 1 } },
    'guide.centre':         { type: 'guide',      label: 'Centre lines',   settings: { kind: 'centre', reference: 'canvas' } },
    'guide.diagonal':       { type: 'guide',      label: 'Diagonals',      settings: { kind: 'diagonal', reference: 'canvas' } },
    'guide.keyline':        { type: 'guide',      label: 'Keyline circle', settings: { kind: 'circle', reference: 'canvas', size: { value: 20, unit: 'px' } } },
    'guide.thirds':         { type: 'guide',      label: 'Thirds',         settings: { kind: 'thirds', reference: 'canvas' } },
    'guide.line':           { type: 'guide',      label: 'Guide line',     settings: { kind: 'line', axis: 'vertical', reference: 'canvas', position: { value: 50, unit: '%' } } },
    'guide.rectangle':      { type: 'guide',      label: 'Keyline rectangle', settings: { kind: 'square', reference: 'canvas', size: { value: 80, unit: '%' }, ratio: 100 } },
    'grid.unit':            { type: 'grid',       label: 'Unit grid',      settings: { reference: 'canvas', cell: { token: '--artwork-icon-grid', unit: 'px' }, align: 'start' } },
    'grid.percent':         { type: 'grid',       label: 'Percent grid',   settings: { reference: 'canvas', cell: { value: 10, unit: '%' }, align: 'start' } },
    'grid.cells':           { type: 'grid',       label: 'Cell grid',      settings: { kind: 'cells', reference: 'canvas', cell: { value: 10, unit: '%' }, align: 'start' } },
    'grid.x':               { type: 'grid',       label: 'X grid',         settings: { reference: 'specimen', cell: { value: 1, unit: 'X' }, align: 'start' } },
    'grid.columns':         { type: 'grid',       label: 'Columns',        settings: { kind: 'columns', reference: 'canvas', count: 2 } },
    'grid.rows':            { type: 'grid',       label: 'Rows',           settings: { kind: 'rows', reference: 'canvas', count: 2 } },
    'measure.canvas':       { type: 'measure',    label: 'Canvas size',    settings: { target: 'canvas' } },
    'measure.specimen':     { type: 'measure',    label: 'Specimen size',  settings: { target: 'specimen' } },
    'measure.zone':         { type: 'measure',    label: 'Zone size',      settings: { target: 'zone' } },
    'note':                 { type: 'note',       label: 'Note',           settings: { text: 'Note' } },
    'image.ui':             { type: 'image',      label: 'Platform UI',    settings: { src: '', fit: 'contain', opacity: 1 } },
    // A platform's own interface, drawn over the frame at full size. The
    // file is a flat outline export (assets/images/platform-ui/), not brand
    // data: every brand's Reels show the same interface.
    'image.instagram-reels': { type: 'image',     label: 'Instagram Reels UI', settings: { src: '/assets/images/platform-ui/instagram-reels.svg', fit: 'contain', opacity: 1 } }
  };

  /* Preset ids that were renamed, read as they are now. */
  var PRESET_RENAMES = { 'artwork': 'specimen', 'measure.artwork': 'measure.specimen' };

  function pct(value) {
    return { value: value, unit: '%' };
  }

  /* Defaults every layer of a type starts with, under its preset's own. */
  var TYPE_DEFAULTS = {
    // Size 100% is the fit, offset 0 is centred: a spec without them draws
    // as it always did.
    specimen: { size: pct(100), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 0, unit: 'px' },
      overshootTop: { value: 0, unit: 'px' }, overshootRight: { value: 0, unit: 'px' }, overshootBottom: { value: 0, unit: 'px' }, overshootLeft: { value: 0, unit: 'px' }, opacity: 1 },
    zone: {
      display: 'ring', edge: 'inside', reference: 'canvas', amount: { value: 2, unit: 'px' },
      draw: 'both', lineWeight: { token: '--overlay-line-weight', unit: 'px' }, lineStyle: 'solid',
      outlineColour: 'var(--overlay-zone)', outlineOpacity: { token: '--overlay-zone-outline-opacity' },
      fillColour: 'var(--overlay-zone)', fillOpacity: { token: '--overlay-zone-opacity' },
      // The marker: a graphic in the band, as wide as the band is deep.
      // Rotated -90° (left) by default, so a glyph's ascender lies on the
      // ground; "follow" turns it with each edge so that ground is always
      // the zone's outer edge. An empty colour is the zone's outline's.
      marker: 'none', markerText: 'x', markerSrc: '', markerRotate: -90, markerOrient: 'follow',
      markerRepeat: 'edges', markerColour: '', markerOpacity: 0.6
    },
    // A shape is a rule, so it takes the zone's hue; % of the canvas per axis.
    // Its outline is solid; its fill, when drawn, the zone's faint area.
    shape: { form: 'rectangle', radius: 12, x: pct(0), y: pct(0), w: pct(100), h: pct(100),
      draw: 'outline', lineWeight: { token: '--overlay-line-weight', unit: 'px' }, lineStyle: 'solid',
      outlineColour: 'var(--overlay-zone)', outlineOpacity: 1,
      fillColour: 'var(--overlay-zone)', fillOpacity: { token: '--overlay-zone-opacity' } },
    // A keyline rectangle is size wide (in %, of the reference's width) and
    // ratio % of that tall, with square corners unless radius rounds them.
    guide: { kind: 'centre', axis: 'vertical', position: pct(50), reference: 'canvas', size: pct(50), ratio: 100, radius: 0, bleed: false,
      draw: 'outline', lineWeight: { token: '--overlay-line-weight', unit: 'px' }, lineStyle: 'solid',
      outlineColour: 'var(--overlay-guide)', outlineOpacity: { token: '--overlay-guide-opacity' },
      fillColour: 'var(--overlay-guide)', fillOpacity: { token: '--overlay-guide-opacity' } },
    grid: { kind: 'cells', reference: 'canvas', cell: { value: 1, unit: 'px' }, align: 'start', count: 2, margin: { value: 0, unit: 'px' }, gutter: { value: 0, unit: 'px' },
      draw: 'outline', lineWeight: { token: '--overlay-line-weight', unit: 'px' }, lineStyle: 'solid',
      outlineColour: 'var(--overlay-grid)', outlineOpacity: { token: '--overlay-grid-opacity' },
      fillColour: 'var(--overlay-grid)', fillOpacity: { token: '--overlay-grid-opacity' } },
    // A measure's lines take the ground's ink unless given a colour; its
    // numbers always do, so they read on any ground.
    measure: { target: 'canvas', zone: '', lineWeight: { token: '--overlay-line-weight', unit: 'px' }, lineStyle: 'solid', colour: '', opacity: 1 },
    note: { text: 'Note', x: pct(50), y: pct(50) },
    image: { src: '', x: pct(0), y: pct(0), w: pct(100), h: pct(100), fit: 'contain', opacity: 1 }
  };

  /* The canvas fields a spec may leave out. */
  var CANVAS_DEFAULTS = { fit: 'contain', shape: 'rectangle', radius: 22, shapeShow: [], background: '' };

  //
  //------- Templates -------//
  //

  /* Starting specs. A template is a function so each call gets fresh ids.
     Templates name a KIND of specimen, never a brand's asset: the host picks
     the asset (the first icon, the first logo, a square one for the
     avatar), so the engine carries no brand data.
     Formats that share a ratio share a template: an Instagram story and a
     TikTok video both start from the 9:16 one and differ by the layers added
     on top (an image layer of each platform's interface). */
  var TEMPLATES = {
    icon: {
      label: 'Icon, 24 × 24',
      canvas: { w: 24, h: 24, fit: 'fit-artwork' },
      specimen: { kind: 'icon' },
      // Two groups, so a host can offer two switches: the grid under the
      // specimen (where the engine draws it; an overlayOnly host lays both
      // over its own), and the guides over it — the padding and live area, the
      // centre lines, diagonals and keylines (owner, 2026-10-04). The guides
      // are drawn in the zone's hue at 40%, the padding's area at 10% and its
      // edge at 25%, so the lines read under the icon without competing.
      layers: function () {
        var guide = { outlineColour: 'var(--overlay-zone)', outlineOpacity: 0.4, fillColour: 'var(--overlay-zone)', fillOpacity: 0.4 };
        var grids = createGroup('Grids');
        grids.layers = [createLayer('grid.unit', { label: 'Grid' })];
        var guides = createGroup('Guides');
        guides.layers = [
          createLayer('zone.padding', { settings: { fillOpacity: 0.1, outlineOpacity: 0.25 } }),
          createLayer('zone.live-area', { visible: false }),
          createLayer('guide.centre', { settings: guide }),
          createLayer('guide.diagonal', { settings: guide }),
          createLayer('guide.keyline', { label: 'Keyline 20', settings: merge(guide, { size: { value: 20, unit: 'px' } }) }),
          createLayer('guide.keyline', { label: 'Keyline 10', settings: merge(guide, { size: { value: 10, unit: 'px' } }) })
        ];
        return [grids, createLayer('specimen'), guides];
      }
    },
    logo: {
      label: 'Logo with clear space',
      canvas: { w: 1000, h: 500, fit: 'fit-artwork' },
      specimen: { kind: 'logo' },
      layers: function () {
        var clear = createLayer('zone.clear-space');
        return [
          clear,
          createLayer('grid.x', { visible: false }),
          createLayer('specimen'),
          createLayer('guide.centre', { settings: { reference: 'specimen', bleed: true } }),
          createLayer('measure.zone', { visible: false, settings: { zone: clear.id } })
        ];
      }
    },
    avatar: {
      label: 'Avatar, circle',
      canvas: { w: 400, h: 400, fit: 'contain', shape: 'circle', shapeShow: ['outside', 'outline'] },
      specimen: { kind: 'logo', prefer: 'square' },
      layers: function () {
        return [
          createLayer('specimen'),
          createLayer('zone.safe-area', { label: 'Safe area', settings: { amount: pct(15) } }),
          createLayer('guide.centre')
        ];
      }
    },
    reels: {
      label: 'Instagram Reels, 9:16',
      // The interface is white, as on a phone: a grey background stands in
      // for the video so it reads before any specimen is placed.
      canvas: { w: 1080, h: 1920, fit: 'contain', background: 'var(--neutral-600)' },
      specimen: { kind: 'none' },
      layers: function () {
        return [
          createLayer('specimen'),
          createLayer('guide.centre', { visible: false }),
          createLayer('measure.canvas', { visible: false }),
          createLayer('image.instagram-reels')
        ];
      }
    },
    story: {
      label: 'Story, 9:16',
      canvas: { w: 1080, h: 1920, fit: 'contain' },
      specimen: { kind: 'none' },
      layers: function () {
        return [
          createLayer('specimen'),
          createLayer('zone.safe-area', { settings: { amount: pct(14) } }),
          createLayer('grid.percent', { visible: false }),
          createLayer('guide.thirds', { visible: false }),
          createLayer('guide.centre'),
          createLayer('measure.canvas'),
          createLayer('image.ui', { visible: false })
        ];
      }
    },
    square: {
      label: 'Post, 1:1',
      canvas: { w: 1080, h: 1080, fit: 'contain' },
      specimen: { kind: 'none' },
      layers: function () {
        return [
          createLayer('specimen'),
          createLayer('zone.safe-area', { settings: { amount: pct(6) } }),
          createLayer('guide.centre'),
          createLayer('measure.canvas')
        ];
      }
    },
    portrait: {
      label: 'Post, 4:5',
      canvas: { w: 1080, h: 1350, fit: 'contain' },
      specimen: { kind: 'none' },
      layers: function () {
        return [
          createLayer('specimen'),
          createLayer('zone.safe-area', { settings: { amount: pct(6) } }),
          createLayer('guide.centre'),
          createLayer('measure.canvas')
        ];
      }
    },
    landscape: {
      label: 'Video, 16:9',
      canvas: { w: 1920, h: 1080, fit: 'contain' },
      specimen: { kind: 'none' },
      layers: function () {
        return [
          createLayer('specimen'),
          createLayer('zone.safe-area', { label: 'Title safe', settings: { amount: pct(10) } }),
          createLayer('zone.safe-area', { label: 'Action safe', settings: { amount: pct(5), display: 'area', lineStyle: 'dashed' } }),
          createLayer('guide.centre'),
          createLayer('measure.canvas')
        ];
      }
    },
    blank: {
      label: 'Blank',
      canvas: { w: 1000, h: 1000, fit: 'contain' },
      specimen: { kind: 'none' },
      layers: function () {
        return [createLayer('specimen')];
      }
    }
  };

  //
  //------- Building specs -------//
  //

  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }

  var idCounter = 0;

  function newId() {
    idCounter += 1;
    return 'l' + Date.now().toString(36) + idCounter.toString(36);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function merge(base, extra) {
    var out = clone(base) || {};
    Object.keys(extra || {}).forEach(function (key) { out[key] = clone(extra[key]); });
    return out;
  }

  /* A layer from a preset id, or from a bare type, with overrides on top.
     Override settings in the v1 vocabulary (a zone's shape, a line) are
     read as they are now, so a host written against v1 keeps working. */
  function createLayer(presetOrType, overrides) {
    var key = has(PRESET_RENAMES, presetOrType) ? PRESET_RENAMES[presetOrType] : presetOrType === 'artwork' ? 'specimen' : presetOrType;
    var preset = has(PRESETS, key) ? PRESETS[key] : { type: key, label: has(TYPES, key) ? TYPES[key].label : String(key), settings: {} };
    if (!has(TYPES, preset.type)) { throw new Error('Unknown layer type: ' + preset.type); }
    var extra = overrides || {};
    return {
      id: newId(),
      type: preset.type,
      preset: has(PRESETS, key) ? key : '',
      label: extra.label || preset.label,
      visible: extra.visible !== false,
      settings: merge(merge(TYPE_DEFAULTS[preset.type], preset.settings), upgradeSettings(preset.type, extra.settings))
    };
  }

  function createSpec(templateId) {
    var template = has(TEMPLATES, templateId) ? TEMPLATES[templateId] : TEMPLATES.blank;
    return {
      version: SPEC_VERSION,
      template: has(TEMPLATES, templateId) ? templateId : 'blank',
      canvas: merge(CANVAS_DEFAULTS, template.canvas),
      reference: { w: template.canvas.w, h: template.canvas.h },
      specimen: clone(template.specimen),
      layers: template.layers()
    };
  }

  function createGroup(label) {
    return { id: newId(), type: 'group', label: label || 'Group', visible: true, layers: [] };
  }

  /* A copy with new ids, a group's layers included; a measure in a copied
     group follows the copy's own zone, not the original's. */
  function duplicateLayer(layer) {
    var copy = clone(layer);
    copy.id = newId();
    copy.label = layer.label + ' copy';
    if (copy.type === 'group') {
      var renamed = {};
      copy.layers.forEach(function (child) {
        var id = newId();
        renamed[child.id] = id;
        child.id = id;
      });
      copy.layers.forEach(function (child) {
        if (child.type === 'measure' && has(renamed, child.settings.zone)) { child.settings.zone = renamed[child.settings.zone]; }
      });
    }
    return copy;
  }

  function isGroup(entry) {
    return Boolean(entry) && entry.type === 'group';
  }

  /* Every layer in drawing order, groups opened in place. The layers
     themselves, not copies, so a caller can read or change them. */
  function flatLayers(spec) {
    var out = [];
    (spec.layers || []).forEach(function (entry) {
      if (isGroup(entry)) { out.push.apply(out, entry.layers || []); } else if (entry) { out.push(entry); }
    });
    return out;
  }

  /* Each layer with whether it shows: its own eye and its group's. */
  function drawList(spec) {
    var out = [];
    (spec.layers || []).forEach(function (entry) {
      if (isGroup(entry)) {
        (entry.layers || []).forEach(function (layer) { out.push({ layer: layer, shown: entry.visible !== false && layer.visible }); });
      } else if (entry) {
        out.push({ layer: entry, shown: entry.visible });
      }
    });
    return out;
  }

  /* What a tool offers as switches: each group and each layer outside one,
     top first as a list reads. Never the specimen — the tools draw their own. */
  function toggles(spec) {
    return (spec.layers || []).filter(function (entry) { return entry && entry.type !== 'specimen'; }).map(function (entry) {
      return { id: entry.id, label: entry.label, visible: entry.visible !== false, group: isGroup(entry) };
    }).reverse();
  }

  /* Show or hide a group or a layer by id, wherever it sits. */
  function setVisible(spec, id, visible) {
    (spec.layers || []).concat(flatLayers(spec)).forEach(function (entry) {
      if (entry && entry.id === id) { entry.visible = Boolean(visible); }
    });
  }

  /* Parse and repair a stored spec. Anything unusable throws with a message
     a person can act on; anything merely missing is filled in. A version 1
     spec is converted (convertV1); pass an array as notes to hear what the
     conversion changed, in words a person can read. */
  function parseSpec(input, notes) {
    var spec = typeof input === 'string' ? JSON.parse(input) : clone(input);
    if (!spec || typeof spec !== 'object') { throw new Error('The spec is not an object.'); }
    if ([1, 2, SPEC_VERSION].indexOf(spec.version) === -1) { throw new Error('This spec is version ' + spec.version + '; this tool reads versions 1 to ' + SPEC_VERSION + '.'); }
    if (!spec.canvas || typeof spec.canvas !== 'object') { throw new Error('The spec has no canvas size.'); }
    if (!Array.isArray(spec.layers)) { throw new Error('The spec has no layers.'); }
    var fromVersion = spec.version;
    if (spec.version === 1) { convertV1(spec, Array.isArray(notes) ? notes : []); }
    spec.canvas = cleanCanvas(spec.canvas);
    if (!(spec.canvas.w > 0) || !(spec.canvas.h > 0) || spec.canvas.w > 100000 || spec.canvas.h > 100000) { throw new Error('The spec has no usable canvas size.'); }
    var ref = spec.reference && typeof spec.reference === 'object' ? { w: Number(spec.reference.w), h: Number(spec.reference.h) } : null;
    spec.reference = ref && ref.w > 0 && ref.h > 0 ? ref : { w: spec.canvas.w, h: spec.canvas.h };
    spec.template = has(TEMPLATES, spec.template) ? spec.template : '';
    spec.specimen = cleanSource(spec.specimen);
    var seen = {};
    function cleanId(id) {
      var clean = typeof id === 'string' && /^[\w-]{1,64}$/.test(id) && !seen[id] ? id : newId();
      seen[clean] = true;
      return clean;
    }
    function cleanLayer(layer) {
      var out = {
        id: cleanId(layer.id),
        type: layer.type,
        preset: typeof layer.preset === 'string' ? layer.preset.slice(0, 64) : '',
        label: String(layer.label || TYPES[layer.type].label).slice(0, 200),
        visible: layer.visible !== false
      };
      cleanEnvelope(layer, out);
      out.settings = cleanSettings(layer.type, merge(TYPE_DEFAULTS[layer.type], migrateSettings(layer.type, layer.settings, fromVersion)));
      return out;
    }
    function usable(layer) {
      return layer && typeof layer === 'object' && has(TYPES, layer.type);
    }
    // A group's own layers, with any group inside it opened in place: one
    // level deep is the whole model.
    function groupContents(list) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (entry) {
        if (isGroup(entry)) { out.push.apply(out, groupContents(entry.layers)); } else { out.push(entry); }
      });
      return out;
    }
    var top = [];
    spec.layers.forEach(function (entry) {
      if (!isGroup(entry)) {
        if (usable(entry)) { top.push(cleanLayer(entry)); }
        return;
      }
      var children = groupContents(entry.layers).filter(usable);
      var group = {
        id: cleanId(entry.id),
        type: 'group',
        label: String(entry.label || 'Group').slice(0, 200),
        visible: entry.visible !== false,
        layers: children.filter(function (layer) { return layer.type !== 'specimen'; }).map(cleanLayer)
      };
      top.push(group);
      // The specimen is never in a group: lifted out, just above it.
      children.filter(function (layer) { return layer.type === 'specimen'; }).forEach(function (layer) { top.push(cleanLayer(layer)); });
    });
    spec.layers = top;
    var specimens = spec.layers.filter(function (layer) { return layer.type === 'specimen'; });
    if (specimens.length === 0) { spec.layers.unshift(createLayer('specimen')); }
    if (specimens.length > 1) {
      var kept = false;
      spec.layers = spec.layers.filter(function (layer) {
        if (layer.type !== 'specimen') { return true; }
        if (kept) { return false; }
        kept = true;
        return true;
      });
    }
    spec.version = SPEC_VERSION;
    return spec;
  }

  /* The canvas with every field it may leave out filled in. */
  function cleanCanvas(raw) {
    var c = merge(CANVAS_DEFAULTS, raw);
    var out = { w: Number(c.w), h: Number(c.h) };
    out.fit = ['fit-artwork', 'contain', 'cover'].indexOf(c.fit) !== -1 ? c.fit : 'contain';
    out.shape = choiceOf('canvas.shape', c.shape) ? c.shape : 'rectangle';
    out.radius = Math.max(0, Math.min(50, Number(c.radius) || 0));
    var show = Array.isArray(c.shapeShow) ? c.shapeShow : [];
    out.shapeShow = CHOICES['canvas.shapeShow'].map(function (choice) { return choice[0]; }).filter(function (value) { return show.indexOf(value) !== -1; });
    out.background = cleanColour(c.background) || '';
    return out;
  }

  /* What the specimen is: an asset, an SVG, an image's name, or none. */
  function cleanSource(raw) {
    var art = raw && typeof raw === 'object' ? raw : {};
    if (['icon', 'logo', 'svg'].indexOf(art.kind) !== -1) {
      return { kind: art.kind, key: typeof art.key === 'string' ? art.key : '', name: typeof art.name === 'string' ? art.name : '', src: typeof art.src === 'string' ? art.src : '', unit: Number(art.unit) || 0 };
    }
    if (art.kind === 'image') { return { kind: 'image', name: typeof art.name === 'string' ? art.name.slice(0, 200) : '' }; }
    return { kind: 'none' };
  }

  /* The envelope fields a layer may carry, kept only when they say
     something: an absent field is the default (brand-authored, unverified,
     exact, editable). */
  function cleanEnvelope(layer, out) {
    if (choiceOf('source', layer.source)) { out.source = layer.source; }
    if (typeof layer.verified === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(layer.verified)) { out.verified = layer.verified; }
    if (layer.approximate === true) { out.approximate = true; }
    if (layer.locked === true) { out.locked = true; }
  }

  function choiceOf(key, value) {
    return (CHOICES[key] || []).some(function (choice) { return choice[0] === value; });
  }

  /* A colour as the spec holds one: any CSS colour or var(), short and
     plain, or nothing. */
  function cleanColour(value) {
    return typeof value === 'string' && value !== '' && /^[#\w\s(),.%-]{1,64}$/.test(value) ? value : null;
  }

  /* Settings in the v1 vocabulary, read as they are now: a zone's shape is
     its display, a line is a lineStyle, a grid's show is its draw. Used on
     every v1 layer and on a host's createLayer overrides. */
  function upgradeSettings(type, raw) {
    if (!raw || typeof raw !== 'object') { return raw; }
    var settings = clone(raw);
    if (settings.line !== undefined) {
      if (settings.lineStyle === undefined) { settings.lineStyle = settings.line; }
      delete settings.line;
    }
    if (type === 'zone' && settings.shape !== undefined) {
      if (settings.display === undefined) { settings.display = settings.shape; }
      delete settings.shape;
    }
    if (type === 'grid' && settings.show !== undefined) {
      if (settings.draw === undefined) { settings.draw = settings.show === 'fill' ? 'fill' : 'outline'; }
      delete settings.show;
    }
    if (settings.reference === 'artwork') { settings.reference = 'specimen'; }
    if (type === 'measure' && settings.target === 'artwork') { settings.target = 'specimen'; }
    return splitPaint(type, settings);
  }

  /* One colour and opacity (format version 2) as the two paints. Both take
     the colour; the fill keeps the opacity, and so does the outline, except
     a zone's or a shape's, which the stylesheet stroked 2.5 times stronger
     than its area: it keeps that strength, so a converted spec draws as it
     did. A token-bound zone opacity takes the outline's own token. Keyed on
     the old fields being there, so it runs on a v2 spec, a v1 one after
     convertV1, and a host's createLayer overrides written against v2;
     settings already in two paints keep theirs. */
  function splitPaint(type, settings) {
    if (TWO_PAINT.indexOf(type) === -1 || !settings) { return settings; }
    var hasColour = settings.colour !== undefined;
    var hasOpacity = settings.opacity !== undefined;
    if (hasColour) {
      if (settings.outlineColour === undefined) { settings.outlineColour = settings.colour; }
      if (settings.fillColour === undefined) { settings.fillColour = settings.colour; }
    }
    if (hasOpacity) {
      if (settings.fillOpacity === undefined) { settings.fillOpacity = clone(settings.opacity); }
      if (settings.outlineOpacity === undefined) {
        settings.outlineOpacity = type === 'zone' || type === 'shape' ? strongerEdge(settings.opacity) : clone(settings.opacity);
      }
    }
    delete settings.colour;
    delete settings.opacity;
    return settings;
  }

  function strongerEdge(opacity) {
    if (typeof opacity === 'number') { return Math.min(1, Math.round(opacity * 2.5 * 1000) / 1000); }
    if (opacity && opacity.token === '--overlay-zone-opacity') { return { token: '--overlay-zone-outline-opacity' }; }
    return clone(opacity);
  }

  var V1_SHAPES = { circle: 'circle', squircle: 'app-icon', rounded: 'rounded' };

  /* A version 1 spec in place as version 2 (format-system.md §0.11). Every
     change a person would notice goes into notes. */
  function convertV1(spec, notes) {
    spec.specimen = spec.artwork;
    delete spec.artwork;
    var canvas = spec.canvas;
    // Old layer types first, so what follows reads one vocabulary; a group
    // in a group (never valid, but possible in a hand-written file) is
    // opened in place.
    function contents(list) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (entry) {
        if (isGroup(entry)) { out.push.apply(out, contents(entry.layers)); } else { out.push(migrateLayer(entry)); }
      });
      return out;
    }
    spec.layers = spec.layers.map(function (entry) {
      if (isGroup(entry)) {
        var copy = clone(entry);
        copy.layers = contents(entry.layers);
        return copy;
      }
      return migrateLayer(entry);
    });
    // The fill directly under the artwork is the canvas background, when it
    // drew as one: shown and opaque. Otherwise it is a shape like any other.
    var artIndex = -1;
    spec.layers.forEach(function (entry, i) { if (entry && entry.type === 'artwork' && artIndex === -1) { artIndex = i; } });
    var under = artIndex > 0 ? spec.layers[artIndex - 1] : null;
    var underOpacity = under && under.settings && typeof under.settings.opacity === 'number' ? under.settings.opacity : 1;
    if (under && under.type === 'fill' && under.visible !== false && underOpacity >= 1) {
      var colour = under.settings && cleanColour(under.settings.colour);
      canvas.background = colour || 'var(--off-white)';
      spec.layers.splice(artIndex - 1, 1);
      notes.push('The fill under the artwork is now the canvas background.');
    }
    var masks = [];
    var hiddenMasks = 0;
    var fills = 0;
    var clippedFills = 0;
    // A v1 mask clipped and shaded only while its own eye and its group's
    // were on; a hidden one did nothing, so it becomes nothing.
    function convertLayer(layer, groupShown) {
      if (!layer || typeof layer !== 'object') { return null; }
      var s = layer.settings && typeof layer.settings === 'object' ? layer.settings : {};
      if (layer.type === 'mask') {
        if (layer.visible !== false && groupShown !== false) { masks.push(s); } else { hiddenMasks += 1; }
        return null;
      }
      var out = clone(layer);
      if (layer.type === 'artwork') { out.type = 'specimen'; }
      if (layer.type === 'fill') {
        fills += 1;
        if (s.clip !== false) { clippedFills += 1; }
        out.type = 'shape';
        out.preset = '';
        out.settings = { form: 'rectangle', x: pct(0), y: pct(0), w: pct(100), h: pct(100), draw: 'fill', fillColour: cleanColour(s.colour) || 'var(--off-white)', fillOpacity: s.opacity === undefined ? 1 : s.opacity };
        return out;
      }
      out.settings = upgradeSettings(out.type, s);
      if (out.preset && has(PRESET_RENAMES, out.preset)) { out.preset = PRESET_RENAMES[out.preset]; }
      if (out.type === 'note' || out.type === 'image') {
        ['x', 'y', 'w', 'h'].forEach(function (key) {
          if (typeof out.settings[key] === 'number') { out.settings[key] = pct(out.settings[key]); }
        });
      }
      return out;
    }
    spec.layers = spec.layers.map(function (entry) {
      if (!isGroup(entry)) { return convertLayer(entry, true); }
      var group = clone(entry);
      group.layers = (entry.layers || []).map(function (layer) { return convertLayer(layer, entry.visible !== false); }).filter(Boolean);
      // A group that held only masks has nothing left to switch.
      return group.layers.length || !(entry.layers || []).length ? group : null;
    }).filter(Boolean);
    if (masks.length) {
      // The lowest mask names the shape; every mask's shade and outline
      // become ways of showing it.
      var first = masks[0];
      canvas.shape = V1_SHAPES[first.shape] || 'circle';
      canvas.radius = Number(first.radius) || 22;
      var show = [];
      masks.forEach(function (m) {
        if ((m.shade === 'outside' || m.shade === 'inside') && show.indexOf(m.shade) === -1) { show.push(m.shade); }
        if (m.outline !== false && show.indexOf('outline') === -1) { show.push('outline'); }
      });
      canvas.shapeShow = show;
      var differ = masks.some(function (m) { return (V1_SHAPES[m.shape] || 'circle') !== canvas.shape; });
      notes.push(differ
        ? 'The masks are now the canvas shape. They were different shapes; the canvas takes the lowest, ' + canvas.shape + '.'
        : 'The ' + (masks.length > 1 ? 'masks are' : 'mask is') + ' now the canvas shape, ' + canvas.shape + '.');
    }
    if (hiddenMasks) { notes.push(hiddenMasks === 1 ? 'A hidden mask drew nothing, so it was left out.' : hiddenMasks + ' hidden masks drew nothing, so they were left out.'); }
    if (fills) { notes.push(fills === 1 ? 'A fill is now a filled shape covering the canvas.' : fills + ' fills are now filled shapes covering the canvas.'); }
    if (clippedFills && masks.length) { notes.push('A shape is never clipped to the canvas shape, so a fill that was cut to the mask now covers the whole canvas.'); }
    spec.version = SPEC_VERSION;
  }

  /* Settings that have gone or changed, read as they are now. A zone's or
     a keyline's overflow (overshoot, briefly) is dropped: overshoot is the
     specimen's own now (2026-10-04), not a band drawn on a guide. A guide
     measured from All (2026-10-03, never released) is measured from the
     canvas with its lines bleeding out. */
  function migrateSettings(type, raw, fromVersion) {
    var settings = raw && typeof raw === 'object' ? clone(raw) : {};
    // A shape's opacity defaulted to 1 before version 3, so a hand-written
    // one that left it out painted an opaque area; it keeps doing so rather
    // than taking the faint fill a new shape starts with.
    if (fromVersion < 3 && type === 'shape' && settings.opacity === undefined && settings.fillOpacity === undefined) { settings.opacity = 1; }
    if (type === 'zone' || type === 'guide') {
      delete settings.overflow;
      delete settings.overshoot;
    }
    if (type === 'guide' && settings.reference === 'all') {
      settings.reference = 'canvas';
      settings.bleed = true;
    }
    return splitPaint(type, settings);
  }

  /* An annotation layer (before 2026-10-02) was three things behind one
     kind; each is its own type now. The canvas and zone kinds become a
     measure, the note a note. */
  function migrateLayer(layer) {
    if (!layer || typeof layer !== 'object' || layer.type !== 'annotation') { return layer; }
    var old = layer.settings && typeof layer.settings === 'object' ? layer.settings : {};
    var copy = clone(layer);
    if (old.kind === 'canvas') {
      copy.type = 'measure';
      copy.settings = { target: 'canvas' };
    } else if (old.kind === 'measure') {
      copy.type = 'measure';
      copy.settings = { target: 'zone', zone: typeof old.target === 'string' ? old.target : '' };
    } else {
      copy.type = 'note';
      copy.settings = {};
      ['text', 'x', 'y'].forEach(function (key) { if (old[key] !== undefined) { copy.settings[key] = old[key]; } });
    }
    return copy;
  }

  var LENGTH_KEYS = ['amount', 'size', 'position', 'cell', 'margin', 'gutter', 'x', 'y', 'w', 'h', 'lineWeight',
    'offsetX', 'offsetY', 'overshootTop', 'overshootRight', 'overshootBottom', 'overshootLeft'];

  /* A length as the spec holds one: { value, unit } or { token, unit }. A
     bare number is read in the type's own unit for it. */
  function cleanLength(value, fallback) {
    if (typeof value === 'number' && isFinite(value)) { return { value: value, unit: fallback.unit || 'px' }; }
    if (!value || typeof value !== 'object') { return clone(fallback); }
    var unit = CHOICES.units.indexOf(value.unit) !== -1 ? value.unit : (fallback.unit || 'px');
    if (typeof value.token === 'string' && /^--[\w-]{1,64}$/.test(value.token)) {
      var bound = { token: value.token, unit: unit };
      if (typeof value.value === 'number' && isFinite(value.value)) { bound.value = value.value; }
      return bound;
    }
    return { value: Number(value.value) || 0, unit: unit };
  }

  /* Settings from outside are checked against their choices: an unknown
     choice falls back to the type's default, so a control never shows a
     value the spec does not hold. */
  function cleanSettings(type, settings) {
    // Keyline portrait and landscape were a fixed 4:5 and 5:4 (before
    // 2026-10-02); they are a rectangle with a ratio now. Portrait's size was
    // its height, so its width is four fifths of it.
    if (type === 'guide' && (settings.kind === 'portrait' || settings.kind === 'landscape')) {
      if (settings.kind === 'portrait' && typeof settings.size === 'number') {
        settings.size = { value: Math.round(settings.size * 0.8 * 100) / 100, unit: 'px' };
      } else if (settings.kind === 'portrait' && settings.size && typeof settings.size.value === 'number' && !settings.size.token) {
        settings.size = { value: Math.round(settings.size.value * 0.8 * 100) / 100, unit: settings.size.unit };
      }
      settings.ratio = settings.kind === 'portrait' ? 125 : 80;
      settings.kind = 'square';
    }
    var defaults = TYPE_DEFAULTS[type];
    // Only the type's own settings stay: a key from another type or another
    // version would ride along unseen and fail the schema.
    Object.keys(settings).forEach(function (key) {
      if (TYPES[type].fields.indexOf(key) === -1) { delete settings[key]; }
    });
    Object.keys(settings).forEach(function (key) {
      var choices = CHOICES[type + '.' + key] || (SHARED_CHOICES.indexOf(key) !== -1 ? CHOICES[key] : null);
      if (choices && !choices.some(function (choice) { return choice[0] === settings[key]; })) {
        settings[key] = defaults[key];
      }
      if (LENGTH_KEYS.indexOf(key) !== -1 && defaults[key] && typeof defaults[key] === 'object') {
        settings[key] = cleanLength(settings[key], defaults[key]);
      }
    });
    ['colour', 'outlineColour', 'fillColour', 'markerColour'].forEach(function (key) {
      if (typeof settings[key] === 'string' && settings[key] !== '' && !cleanColour(settings[key])) {
        settings[key] = defaults[key];
      }
    });
    if (settings.markerSrc !== undefined && typeof settings.markerSrc !== 'string') { settings.markerSrc = ''; }
    // The specimen's size is a share of the fit or a width: no X.
    if (type === 'specimen' && ['%', 'px'].indexOf(settings.size.unit) === -1) {
      settings.size = clone(defaults.size);
    }
    // A line weight is screen pixels: the strokes do not scale.
    if (settings.lineWeight) { settings.lineWeight.unit = 'px'; }
    // A keyline's ratio and corner, as computeGuide draws them.
    if (type === 'guide') {
      settings.bleed = settings.bleed === true;
      settings.ratio = Math.max(1, Math.min(1000, Number(settings.ratio) || 100));
      settings.radius = Math.max(0, Math.min(50, Number(settings.radius) || 0));
    }
    if (type === 'shape') { settings.radius = Math.max(0, Math.min(50, Number(settings.radius) || 0)); }
    // A count is a whole number of columns or rows, as computeTracks draws it.
    if (type === 'grid') { settings.count = Math.max(1, Math.min(MAX_TRACKS, Math.round(Number(settings.count)) || 1)); }
    return settings;
  }

  /* The spec as text. includeImages false drops image data URLs, which do
     not belong in a link. */
  function serializeSpec(spec, options) {
    var copy = clone(spec);
    if (options && options.includeImages === false) {
      flatLayers(copy).forEach(function (layer) {
        if (layer.type === 'image' && /^data:/.test(layer.settings.src || '')) { layer.settings.src = ''; }
        // A marker file (an SVG's markup or an image's data) stays out too.
        if (layer.type === 'zone' && /^(data:|\s*<)/.test(layer.settings.markerSrc || '')) { layer.settings.markerSrc = ''; }
      });
      if (copy.specimen && copy.specimen.kind === 'svg') { copy.specimen = { kind: 'none' }; }
    }
    return JSON.stringify(copy, null, options && options.pretty ? 2 : 0);
  }

  //
  //------- Values -------//
  //

  function readToken(name, scope) {
    var el = scope && scope.nodeType === 1 ? scope : document.documentElement;
    var value = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return isNaN(value) ? null : value;
  }

  /* A setting as { number, unit }, resolving a token binding. */
  function resolveLength(setting, fallbackUnit, scope) {
    if (setting === null || setting === undefined) { return { number: 0, unit: fallbackUnit || 'px' }; }
    if (typeof setting === 'number') { return { number: setting, unit: fallbackUnit || 'px' }; }
    var unit = setting.unit || fallbackUnit || 'px';
    if (setting.token) {
      var tokenValue = readToken(setting.token, scope);
      return { number: tokenValue === null ? (setting.value || 0) : tokenValue, unit: unit, token: setting.token };
    }
    return { number: Number(setting.value) || 0, unit: unit };
  }

  function resolveNumber(setting, fallback, scope) {
    if (typeof setting === 'number') { return setting; }
    if (setting && setting.token) {
      var value = readToken(setting.token, scope);
      return value === null ? fallback : value;
    }
    if (setting && typeof setting.value === 'number') { return setting.value; }
    return fallback;
  }

  /* A length in canvas units. axis is 'x', 'y' or 'min'. */
  function toCanvas(length, ctx, box, axis) {
    var n = length.number;
    if (length.unit === '%') {
      var side = axis === 'x' ? box.w : axis === 'y' ? box.h : Math.min(box.w, box.h);
      return side * n / 100;
    }
    if (length.unit === 'X') { return n * ctx.unitX; }
    return n * ctx.scale;
  }

  //
  //------- Ratio -------//
  //

  function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
  }

  /* "9:16" for whole numbers, "1.05:1" when they do not reduce cleanly. */
  function ratioOf(w, h) {
    if (!(w > 0) || !(h > 0)) { return ''; }
    if (Math.round(w) === w && Math.round(h) === h) {
      var d = gcd(w, h);
      if (w / d <= 64 && h / d <= 64) { return (w / d) + ':' + (h / d); }
    }
    return (Math.round(w / h * 100) / 100) + ':1';
  }

  function sameRatio(a, b) {
    return Math.abs(a.w / a.h - b.w / b.h) < 0.005;
  }

  //
  //------- Layout -------//
  //

  /* Where everything sits, in canvas units. art is the artwork's own box
     after fitting (it can be larger than the canvas under cover). scale is
     canvas units per reference px, so a spec written at 1080 wide draws
     the same at 720 wide. unitX is one X in canvas units. */
  /* The artwork's overshoot on each edge, in its own units (its viewBox):
     px as drawn, % of its width (left, right) or height (top, bottom), X
     its unit. Never below 0, and never so much that the trimmed box is
     less than a tenth of the drawing on either axis. */
  function artworkOvershoot(spec, artwork, scope) {
    var none = { top: 0, right: 0, bottom: 0, left: 0, any: false, needsUnit: false };
    var vb = artwork && artwork.viewBox;
    if (!vb) { return none; }
    var placed = artworkSettings(spec);
    var out = { any: false, needsUnit: false };
    [['top', 'overshootTop', vb.h], ['right', 'overshootRight', vb.w], ['bottom', 'overshootBottom', vb.h], ['left', 'overshootLeft', vb.w]].forEach(function (edge) {
      var length = resolveLength(placed[edge[1]], 'px', scope);
      var n = Math.max(0, length.number || 0);
      if (length.unit === '%') { n = edge[2] * n / 100; }
      if (length.unit === 'X') {
        if (n > 0 && !(artwork.unit > 0)) { out.needsUnit = true; }
        n = artwork.unit > 0 ? n * artwork.unit : 0;
      }
      out[edge[0]] = n;
    });
    var shrink = function (a, b, side) {
      var room = side * 0.9;
      var k = a + b > room ? room / (a + b) : 1;
      return [a * k, b * k];
    };
    var x = shrink(out.left, out.right, vb.w);
    var y = shrink(out.top, out.bottom, vb.h);
    out.left = x[0]; out.right = x[1]; out.top = y[0]; out.bottom = y[1];
    out.any = out.top > 0 || out.right > 0 || out.bottom > 0 || out.left > 0;
    return out;
  }

  /* The artwork's trimmed size in its own units: what a canvas that hugs
     it is drawn at. */
  function trimmedSize(spec, artwork, scope) {
    var vb = artwork && artwork.viewBox;
    if (!vb) { return null; }
    var o = artworkOvershoot(spec, artwork, scope);
    return { w: vb.w - o.left - o.right, h: vb.h - o.top - o.bottom };
  }

  function layout(spec, artwork, scope) {
    var canvas = { x: 0, y: 0, w: spec.canvas.w, h: spec.canvas.h };
    var warnings = [];
    var vb = artwork && artwork.viewBox;
    var o = artworkOvershoot(spec, artwork, scope);
    // The box the artwork is fitted, centred and measured by: its drawing
    // less its overshoot.
    var tw = vb ? vb.w - o.left - o.right : 0;
    var th = vb ? vb.h - o.top - o.bottom : 0;
    if (o.needsUnit) { warnings.push('An overshoot in X needs a specimen with a unit; this one has none, so it is not trimmed there.'); }
    if (spec.canvas.fit === 'fit-artwork' && vb) {
      canvas.w = tw;
      canvas.h = th;
    }
    var reference = spec.reference || { w: canvas.w, h: canvas.h };
    if (!sameRatio(reference, canvas)) {
      warnings.push('This spec was written for ' + ratioOf(reference.w, reference.h) + '; the canvas is ' + ratioOf(canvas.w, canvas.h) + '. Lengths in px follow the width, so check every layer.');
    }
    var scale = canvas.w / reference.w;
    var art = { x: 0, y: 0, w: canvas.w, h: canvas.h, k: 1 };
    var trim = art;
    var unitX = 0;
    if (vb) {
      var k = spec.canvas.fit === 'cover' ? Math.max(canvas.w / tw, canvas.h / th) : Math.min(canvas.w / tw, canvas.h / th);
      if (spec.canvas.fit === 'fit-artwork') { k = canvas.w / tw; }
      var placed = artworkSettings(spec);
      // Size: a share of the fit, or the artwork's width in px. Anything
      // unusable (zero, negative, X) leaves the fit as it is.
      var size = resolveLength(placed.size, '%', scope);
      if (size.number > 0 && size.unit === '%') { k *= size.number / 100; }
      if (size.number > 0 && size.unit === 'px') { k = size.number * scale / tw; }
      unitX = artwork.unit > 0 ? artwork.unit * k : 0;
      // The trimmed box centred, then moved by the offset (% is of the
      // canvas on that axis); the drawing around it, overshoot and all.
      var offsetCtx = { scale: scale, unitX: unitX };
      trim = { w: tw * k, h: th * k, k: k };
      trim.x = (canvas.w - trim.w) / 2 + toCanvas(resolveLength(placed.offsetX, 'px', scope), offsetCtx, canvas, 'x');
      trim.y = (canvas.h - trim.h) / 2 + toCanvas(resolveLength(placed.offsetY, 'px', scope), offsetCtx, canvas, 'y');
      art = { x: trim.x - o.left * k, y: trim.y - o.top * k, w: vb.w * k, h: vb.h * k, k: k };
      if (!(unitX > 0) && [placed.offsetX, placed.offsetY].some(function (o) { return o && o.unit === 'X' && o.value; })) {
        warnings.push('An offset in X needs a specimen with a unit; this one has none, so it is not moved.');
      }
      if (!intersect(trim, canvas).w || !intersect(trim, canvas).h) {
        warnings.push('The specimen is off the canvas. Bring its offset back toward 0.');
      }
    }
    // Cropped when the trimmed box reaches past the canvas (Fill, or sized
    // or moved over an edge). Overshoot alone never crops: it is meant to
    // cross the line.
    return { canvas: canvas, art: art, trim: trim, overshoot: o, scale: scale, unitX: unitX, hasArtwork: !!vb, cropped: !!vb && overhangs(trim, canvas), glyph: artwork && artwork.glyph ? artwork.glyph : null, warnings: warnings };
  }

  /* True when the artwork reaches past the canvas: under cover, or sized or
     moved over an edge. The canvas crops it there. */
  function overhangs(art, canvas) {
    var e = 1e-6 * Math.max(canvas.w, canvas.h);
    return art.x < canvas.x - e || art.y < canvas.y - e || art.x + art.w > canvas.x + canvas.w + e || art.y + art.h > canvas.y + canvas.h + e;
  }

  /* The specimen layer's placement settings, or the defaults when the spec
     has none (the Icon Library and Logo Tool draw overlays only). */
  function artworkSettings(spec) {
    var layer = (spec.layers || []).filter(function (item) { return item && item.type === 'specimen'; })[0];
    return layer && layer.settings ? layer.settings : TYPE_DEFAULTS.specimen;
  }

  /* The artwork's box as far as layers are concerned: its trimmed box,
     less its overshoot; under cover cropped by the canvas (and so when
     sized or moved over an edge), so a layer measured from it never
     reaches into the part that is cut away. */
  function referenceBox(name, ctx) {
    if (name === 'all') { return ctx.all || ctx.canvas; }
    if (name !== 'specimen' || !ctx.hasArtwork) { return ctx.canvas; }
    var trim = ctx.trim || ctx.art;
    return ctx.cropped ? intersect(trim, ctx.canvas) : trim;
  }

  /* What the drawing covers on the page: all of it, overshoot included,
     unless the canvas crops it. */
  function drawnBox(ctx) {
    return ctx.cropped ? intersect(ctx.art, ctx.canvas) : ctx.art;
  }

  function intersect(a, b) {
    var x = Math.max(a.x, b.x);
    var y = Math.max(a.y, b.y);
    return { x: x, y: y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y), k: a.k };
  }

  function inset(box, d) {
    // An inset larger than half a side meets in the middle rather than
    // walking the box off-centre.
    if (d > 0) { d = Math.min(d, box.w / 2, box.h / 2); }
    return { x: box.x + d, y: box.y + d, w: Math.max(0, box.w - 2 * d), h: Math.max(0, box.h - 2 * d) };
  }

  function union(a, b) {
    var x = Math.min(a.x, b.x);
    var y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  //
  //------- SVG helpers -------//
  //

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      if (attrs[key] !== undefined && attrs[key] !== null) { node.setAttribute(key, attrs[key]); }
    });
    return node;
  }

  function stroked(node) {
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    return node;
  }

  /* What a drawn part is called in an exported file (exportSvg turns it
     into the id a design tool shows as the layer's name). */
  function part(node, name) {
    node.setAttribute('data-part', name);
    return node;
  }

  function line(x1, y1, x2, y2) {
    return stroked(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'layer-stack-edge' }));
  }

  function rect(box, extra) {
    var attrs = { x: box.x, y: box.y, width: box.w, height: box.h };
    Object.keys(extra || {}).forEach(function (key) { attrs[key] = extra[key]; });
    return stroked(el('rect', attrs));
  }

  function boxPath(box) {
    return 'M' + box.x + ' ' + box.y + 'h' + box.w + 'v' + box.h + 'h' + (-box.w) + 'Z';
  }

  function ring(outer, inner) {
    return el('path', { d: boxPath(outer) + boxPath(inner), 'fill-rule': 'evenodd', class: 'layer-stack-fill' });
  }

  function dimension(x1, y1, x2, y2, tick) {
    var g = el('g', { class: 'layer-stack-dimension' });
    g.appendChild(part(line(x1, y1, x2, y2), 'Line'));
    if (x1 === x2) {
      g.appendChild(part(line(x1 - tick, y1, x1 + tick, y1), 'Start tick'));
      g.appendChild(part(line(x2 - tick, y2, x2 + tick, y2), 'End tick'));
    } else {
      g.appendChild(part(line(x1, y1 - tick, x1, y1 + tick), 'Start tick'));
      g.appendChild(part(line(x2, y2 - tick, x2, y2 + tick), 'End tick'));
    }
    return g;
  }

  /* A superellipse: the app-icon silhouette, close to the iOS shape. */
  function squirclePath(box) {
    var n = 5;
    var steps = 96;
    var cx = box.x + box.w / 2;
    var cy = box.y + box.h / 2;
    var rx = box.w / 2;
    var ry = box.h / 2;
    var d = '';
    for (var i = 0; i < steps; i += 1) {
      var t = i / steps * Math.PI * 2;
      var c = Math.cos(t);
      var s = Math.sin(t);
      var x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      var y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      d += (i === 0 ? 'M' : 'L') + round(x) + ' ' + round(y);
    }
    return d + 'Z';
  }

  function round(n) {
    return Math.round(n * 1000) / 1000;
  }

  function format(n) {
    return String(Math.round(n * 100) / 100);
  }

  function unitLabel(length) {
    return format(length.number) + (length.unit === 'px' ? '' : length.unit === '%' ? '%' : 'X');
  }

  //
  //------- Geometry per type -------//
  //

  /* Each returns { shapes, labels, extent, clip, boxes }:
       shapes  SVG nodes for the layer's <g>
       labels  { text, x, y, anchor } in canvas units, drawn as HTML
       extent  the box it reaches, so the view can grow to show it
       clip    for a mask: a path d the artwork is clipped to
       boxes   named boxes other layers can read (a measure reading
               a zone reads its outer and inner box) */

  function computeZone(layer, ctx, scope) {
    var s = layer.settings;
    var ref = referenceBox(s.reference, ctx);
    var amount = resolveLength(s.amount, 'px', scope);
    var d = Math.max(0, toCanvas(amount, ctx, ref, 'min'));
    var outer = s.edge === 'outside' ? inset(ref, -d) : ref;
    var inner = s.edge === 'outside' ? ref : inset(ref, d);
    var shapes = [];
    if (s.display === 'area') {
      shapes.push(part(rect(inner, { class: 'layer-stack-fill layer-stack-edge' }), 'Area'));
    } else {
      shapes.push(part(ring(outer, inner), 'Band'));
      shapes.push(part(rect(outer, { class: 'layer-stack-edge' }), 'Outer edge'));
      shapes.push(part(rect(inner, { class: 'layer-stack-edge' }), 'Inner edge'));
    }
    var labels = [];
    // The band's real depth: an inside inset meets in the middle, so the
    // marker is sized to what is there, not to the amount asked for.
    var depth = Math.min(d, inner.x - outer.x, inner.y - outer.y);
    if (s.display !== 'area' && s.marker && s.marker !== 'none' && depth > 0) {
      var markers = computeMarkers(s, ctx, outer, inner, depth, labels, scope);
      if (markers) { shapes.push(markers); }
    }
    return { shapes: shapes, labels: labels, extent: outer, boxes: { outer: outer, inner: inner, amount: amount, d: d } };
  }

  //
  //------- Markers -------//
  //

  /* The marker's own drawing, centred on 0,0, as wide as the band (d)
     before rotation. Returns { node, w, h } or null when there is nothing
     to draw. */
  function markerContent(s, ctx, d) {
    if (s.marker === 'text') {
      var text = String(s.markerText || '').slice(0, 12);
      if (!text) { return null; }
      var t = el('text', { x: 0, y: 0, 'font-size': d, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'layer-stack-marker-text' });
      // A word is squeezed to the band's width, like a single glyph is.
      if (text.length > 1) {
        t.setAttribute('font-size', d / Math.max(1, text.length * 0.6));
        t.setAttribute('textLength', d);
        t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
      t.textContent = text;
      return { node: t, w: d, h: d };
    }
    var drawing = null;
    if (s.marker === 'glyph') { drawing = ctx.glyph; }
    if (s.marker === 'svg' && s.markerSrc) { drawing = readDrawing(s.markerSrc); }
    if (drawing) {
      var h = d * drawing.viewBox.h / drawing.viewBox.w;
      var svg = drawing.svg.cloneNode(true);
      svg.removeAttribute('style');
      svg.setAttribute('x', -d / 2);
      svg.setAttribute('y', -h / 2);
      svg.setAttribute('width', d);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', [drawing.viewBox.x, drawing.viewBox.y, drawing.viewBox.w, drawing.viewBox.h].join(' '));
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('overflow', 'visible');
      return { node: svg, w: d, h: h };
    }
    if (s.marker === 'image' && /^(https?:\/\/|data:image\/)/i.test(s.markerSrc || '')) {
      var image = el('image', { x: -d / 2, y: -d / 2, width: d, height: d, preserveAspectRatio: 'xMidYMid meet' });
      image.setAttribute('href', s.markerSrc);
      return { node: image, w: d, h: d };
    }
    return null;
  }

  var MAX_MARKERS_PER_EDGE = 60;

  /* The four bands of a ring, each with the rotation its marker takes
     when it turns with the edge: the bottom band takes the setting as is,
     and each band round from there a quarter turn more, so the marker's
     ground is always the zone's outer edge. */
  function bands(outer, inner) {
    return [
      { side: 'bottom', turn: 0, x: inner.x, y: inner.y + inner.h, w: inner.w, h: outer.y + outer.h - inner.y - inner.h, along: 'x' },
      { side: 'left', turn: 90, x: outer.x, y: inner.y, w: inner.x - outer.x, h: inner.h, along: 'y' },
      { side: 'top', turn: 180, x: inner.x, y: outer.y, w: inner.w, h: inner.y - outer.y, along: 'x' },
      { side: 'right', turn: 270, x: inner.x + inner.w, y: inner.y, w: outer.x + outer.w - inner.x - inner.w, h: inner.h, along: 'y' }
    ];
  }

  function computeMarkers(s, ctx, outer, inner, d, labels, scope) {
    var content = markerContent(s, ctx, d);
    if (!content) {
      if (s.marker === 'glyph') {
        labels.push({ hint: true, text: 'This specimen has no X glyph', x: outer.x + outer.w / 2, y: outer.y + d / 2, anchor: 'centre' });
      }
      return null;
    }
    var group = part(el('g', { class: 'layer-stack-marker' }), 'Markers');
    // With no colour of its own the marker takes the outline's, or the
    // fill's when the zone is drawn as a fill alone and shows no outline.
    if (s.markerColour) { group.style.setProperty('--layer-stack-marker-colour-set', String(s.markerColour)); } else if (s.draw === 'fill') { group.style.setProperty('--layer-stack-marker-colour-set', 'var(--layer-stack-fill-colour)'); }
    var opacity = resolveNumber(s.markerOpacity, NaN, scope);
    if (!isNaN(opacity)) { group.style.setProperty('--layer-stack-marker-opacity-set', String(Math.max(0, Math.min(1, opacity)))); }
    var base = Number(s.markerRotate) || 0;
    var placed = 0;
    bands(outer, inner).forEach(function (band) {
      if (!(band.w > 0) || !(band.h > 0)) { return; }
      var angle = base + (s.markerOrient === 'fixed' ? 0 : band.turn);
      var rad = angle * Math.PI / 180;
      var c = Math.abs(Math.cos(rad));
      var sn = Math.abs(Math.sin(rad));
      // The marker's footprint once turned, along and across its band.
      var spanX = content.w * c + content.h * sn;
      var spanY = content.w * sn + content.h * c;
      var length = band.along === 'x' ? spanX : spanY;
      var room = band.along === 'x' ? band.w : band.h;
      var positions = [0.5];
      if (s.markerRepeat === 'tile' && length > 0) {
        // Capped before centring, so a capped row is still centred.
        var step = length * 1.25;
        var count = Math.min(MAX_MARKERS_PER_EDGE, Math.max(1, Math.floor(room / step)));
        step = Math.max(step, room / count);
        var start = (room - count * step) / 2 + step / 2;
        positions = [];
        for (var i = 0; i < count; i += 1) { positions.push((start + i * step) / room); }
      }
      positions.forEach(function (at) {
        var cx = band.along === 'x' ? band.x + band.w * at : band.x + band.w / 2;
        var cy = band.along === 'x' ? band.y + band.h / 2 : band.y + band.h * at;
        placed += 1;
        var holder = part(el('g', { transform: 'translate(' + round(cx) + ' ' + round(cy) + ') rotate(' + round(angle) + ')' }), 'Marker ' + placed);
        holder.appendChild(content.node.cloneNode(true));
        group.appendChild(holder);
      });
    });
    return group;
  }

  /* An SVG for a marker, parsed once per source, its ids prefixed once
     per source so two different marker SVGs never resolve each other's
     url(#…). Its clones repeat only identical content. */
  var drawingCache = {};
  var drawingSeq = 0;

  function readDrawing(markup) {
    var key = String(markup);
    if (!has(drawingCache, key)) {
      var keys = Object.keys(drawingCache);
      if (keys.length > 20) { delete drawingCache[keys[0]]; }
      var parsed = readArtwork(markup, 0);
      if (parsed) {
        drawingSeq += 1;
        parsed.svg = uniqueCopy(parsed.svg, 'mk' + drawingSeq) || parsed.svg;
      }
      drawingCache[key] = parsed;
    }
    return drawingCache[key];
  }

  /* A keyline box centred on the reference: width w, height h. */
  function keylineBox(ref, w, h) {
    var cx = ref.x + ref.w / 2;
    var cy = ref.y + ref.h / 2;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }

  function computeGuide(layer, ctx, scope) {
    var s = layer.settings;
    var ref = referenceBox(s.reference, ctx);
    var cx = ref.x + ref.w / 2;
    var cy = ref.y + ref.h / 2;
    var shapes = [];
    var extent = ref;
    // Straight lines are placed from the reference but run edge to edge of
    // the canvas — or, with bleed, of the bleed: a line under a scaled-down
    // logo's baseline still crosses the whole frame, and out across its
    // clear space. Diagonals and keylines describe their box and stay on it.
    var span = union(ref, s.bleed ? referenceBox('all', ctx) : ctx.canvas);
    if (s.kind === 'centre' || s.kind === 'line' || s.kind === 'thirds') { extent = span; }
    if (s.kind === 'centre') {
      shapes.push(part(line(cx, span.y, cx, span.y + span.h), 'Vertical'), part(line(span.x, cy, span.x + span.w, cy), 'Horizontal'));
    } else if (s.kind === 'diagonal') {
      shapes.push(part(line(ref.x, ref.y, ref.x + ref.w, ref.y + ref.h), 'Diagonal down'), part(line(ref.x + ref.w, ref.y, ref.x, ref.y + ref.h), 'Diagonal up'));
    } else if (s.kind === 'line') {
      // One line across the canvas, its position from the left (vertical)
      // or the top (horizontal) of the reference box.
      if (s.position && s.position.unit === 'X' && !(ctx.unitX > 0)) {
        return { shapes: shapes, labels: [{ hint: true, text: 'A line in X needs a specimen with a unit', x: cx, y: cy, anchor: 'centre' }], extent: extent };
      }
      if (s.axis === 'horizontal') {
        var y = ref.y + toCanvas(resolveLength(s.position, 'px', scope), ctx, ref, 'y');
        shapes.push(part(line(span.x, y, span.x + span.w, y), 'Horizontal'));
      } else {
        var x = ref.x + toCanvas(resolveLength(s.position, 'px', scope), ctx, ref, 'x');
        shapes.push(part(line(x, span.y, x, span.y + span.h), 'Vertical'));
      }
    } else if (s.kind === 'thirds') {
      [1, 2].forEach(function (i) {
        shapes.push(part(line(ref.x + ref.w * i / 3, span.y, ref.x + ref.w * i / 3, span.y + span.h), 'Vertical ' + i + '/3'));
        shapes.push(part(line(span.x, ref.y + ref.h * i / 3, span.x + span.w, ref.y + ref.h * i / 3), 'Horizontal ' + i + '/3'));
      });
    } else {
      // A circle's size is its diameter, of the shorter side; a rectangle's
      // is its width, of the width, so 100% always spans the box.
      var size = Math.max(0, toCanvas(resolveLength(s.size, 'px', scope), ctx, ref, s.kind === 'circle' ? 'min' : 'x'));
      var ratio = Math.max(1, Math.min(1000, Number(s.ratio) || 100));
      var box = s.kind === 'circle' ? keylineBox(ref, size, size) : keylineBox(ref, size, size * ratio / 100);
      if (s.kind === 'circle') {
        shapes.push(part(stroked(el('circle', { cx: cx, cy: cy, r: size / 2, class: 'layer-stack-edge layer-stack-fill' })), 'Circle'));
      } else {
        var radius = Math.min(box.w, box.h) * Math.max(0, Math.min(50, Number(s.radius) || 0)) / 100;
        shapes.push(part(rect(box, { rx: radius, class: 'layer-stack-edge layer-stack-fill' }), 'Rectangle'));
      }
      extent = union(ref, box);
    }
    return { shapes: shapes, labels: [], extent: extent };
  }

  /* Grid lines across a box. A % cell is per axis, so the count is exact on
     any size (10% is ten columns on 98px and on 1080). A px or X cell keeps
     its size and, aligned from the centre, splits the remainder evenly
     between both edges instead of leaving it all at the far one. */
  function computeGrid(layer, ctx, scope) {
    var s = layer.settings;
    var ref = referenceBox(s.reference, ctx);
    if (s.kind === 'columns' || s.kind === 'rows') { return computeTracks(s, ctx, ref, scope); }
    var cell = resolveLength(s.cell, 'px', scope);
    var stepX = toCanvas(cell, ctx, ref, 'x');
    var stepY = toCanvas(cell, ctx, ref, 'y');
    var shapes = [];
    var labels = [];
    var limit = 400;
    if (cell.unit === 'X' && !(ctx.unitX > 0)) {
      labels.push({ hint: true, text: 'A grid in X needs a specimen with a unit', x: ref.x + ref.w / 2, y: ref.y + ref.h / 2, anchor: 'centre' });
      return { shapes: shapes, labels: labels, extent: ref };
    }
    if (!(stepX > 0) || !(stepY > 0) || ref.w / stepX > limit || ref.h / stepY > limit) {
      labels.push({ hint: true, text: 'Grid too fine to draw', x: ref.x + ref.w / 2, y: ref.y + ref.h / 2, anchor: 'centre' });
      return { shapes: shapes, labels: labels, extent: ref };
    }
    var originX = s.align === 'centre' ? ref.x + ref.w / 2 : ref.x;
    var originY = s.align === 'centre' ? ref.y + ref.h / 2 : ref.y;
    var eps = Math.min(stepX, stepY) * 1e-6;
    var columns = 0;
    var rows = 0;
    var x = originX - Math.floor((originX - ref.x) / stepX + eps) * stepX;
    for (; x <= ref.x + ref.w + eps; x += stepX) {
      if (x > ref.x + eps && x < ref.x + ref.w - eps) { columns += 1; shapes.push(part(line(x, ref.y, x, ref.y + ref.h), 'Column line ' + columns)); }
    }
    var y = originY - Math.floor((originY - ref.y) / stepY + eps) * stepY;
    for (; y <= ref.y + ref.h + eps; y += stepY) {
      if (y > ref.y + eps && y < ref.y + ref.h - eps) { rows += 1; shapes.push(part(line(ref.x, y, ref.x + ref.w, y), 'Row line ' + rows)); }
    }
    return { shapes: shapes, labels: labels, extent: ref };
  }

  /* Columns or rows that stretch across a box: count tracks, a margin at
     both ends and a gutter between. The outline is each track's edges, once,
     leaving out any on the canvas edge; the fill paints each track. Both are
     drawn here and the layer's draw keeps what it asks for. Placed
     from the reference box, they run the full canvas the other way. So
     one column with a 50 margin on 260 is two lines, at 50 and 210, and
     one column measured from the artwork marks the artwork's sides top to
     bottom of the frame. */
  var MAX_TRACKS = 100;

  function computeTracks(s, ctx, ref, scope) {
    var across = s.kind === 'columns';
    var axis = across ? 'x' : 'y';
    var start = across ? ref.x : ref.y;
    var side = across ? ref.w : ref.h;
    var count = Math.max(1, Math.min(MAX_TRACKS, Math.round(Number(s.count)) || 1));
    var margin = toCanvas(resolveLength(s.margin, 'px', scope), ctx, ref, axis);
    var gutter = Math.max(0, toCanvas(resolveLength(s.gutter, 'px', scope), ctx, ref, axis));
    var track = (side - 2 * margin - (count - 1) * gutter) / count;
    var shapes = [];
    var labels = [];
    if (!(track > 0)) {
      labels.push({ hint: true, text: 'The ' + s.kind + ' do not fit', x: ref.x + ref.w / 2, y: ref.y + ref.h / 2, anchor: 'centre' });
      return { shapes: shapes, labels: labels, extent: ref };
    }
    var eps = side * 1e-6;
    var span = union(ref, ctx.canvas);
    var canvasStart = across ? ctx.canvas.x : ctx.canvas.y;
    var canvasEnd = canvasStart + (across ? ctx.canvas.w : ctx.canvas.h);
    var edges = [];
    for (var i = 0; i < count; i += 1) {
      var from = start + margin + i * (track + gutter);
      shapes.push(part(rect(across ? { x: from, y: span.y, w: track, h: span.h } : { x: span.x, y: from, w: span.w, h: track }, { class: 'layer-stack-fill' }), (across ? 'Column ' : 'Row ') + (i + 1)));
      [from, from + track].forEach(function (at) {
        var onEdge = Math.abs(at - canvasStart) < eps || Math.abs(at - canvasEnd) < eps;
        var seen = edges.some(function (done) { return Math.abs(done - at) < eps; });
        if (!onEdge && !seen) { edges.push(at); }
      });
    }
    edges.forEach(function (at, n) {
      shapes.push(part(across ? line(at, span.y, at, span.y + span.h) : line(span.x, at, span.x + span.w, at), (across ? 'Column edge ' : 'Row edge ') + (n + 1)));
    });
    return { shapes: shapes, labels: labels, extent: span };
  }

  /* Dimension lines with their numbers: a box's width below it and its
     height to its right, or a zone's inset and the area inside it. */
  function computeMeasure(layer, ctx, scope, results) {
    var s = layer.settings;
    var shapes = [];
    var labels = [];
    var canvas = ctx.canvas;
    var tick = Math.min(canvas.w, canvas.h) * 0.015;
    var centre = { x: canvas.x + canvas.w / 2, y: canvas.y + canvas.h / 2 };
    if (s.target === 'zone') {
      var target = results[s.zone];
      if (!target || !target.boxes || target.boxes.d === undefined) {
        labels.push({ hint: true, text: 'Pick the zone to measure', x: centre.x, y: centre.y, anchor: 'centre' });
        return { shapes: shapes, labels: labels, extent: canvas };
      }
      if (!(target.boxes.d > 0)) { return { shapes: shapes, labels: labels, extent: canvas }; }
      var outer = target.boxes.outer;
      var inner = target.boxes.inner;
      var my = inner.y + inner.h / 2;
      var mx = inner.x + inner.w / 2;
      shapes.push(part(dimension(outer.x, my, inner.x, my, tick), 'Left inset'));
      shapes.push(part(dimension(mx, inner.y + inner.h, mx, outer.y + outer.h, tick), 'Bottom inset'));
      labels.push({ text: unitLabel(target.boxes.amount), x: (outer.x + inner.x) / 2, y: my, anchor: 'above' });
      labels.push({ text: format(inner.w) + ' × ' + format(inner.h), x: mx, y: inner.y + inner.h, anchor: 'above' });
      return { shapes: shapes, labels: labels, extent: outer };
    }
    if (s.target === 'specimen' && !ctx.hasArtwork) {
      labels.push({ hint: true, text: 'No specimen to measure', x: centre.x, y: centre.y, anchor: 'centre' });
      return { shapes: shapes, labels: labels, extent: canvas };
    }
    var box = s.target === 'specimen' || s.target === 'all' ? referenceBox(s.target, ctx) : canvas;
    var by = box.y + box.h + tick * 3;
    var rx = box.x + box.w + tick * 3;
    shapes.push(part(dimension(box.x, by, box.x + box.w, by, tick), 'Width'));
    shapes.push(part(dimension(rx, box.y, rx, box.y + box.h, tick), 'Height'));
    labels.push({ text: format(box.w), x: box.x + box.w / 2, y: by, anchor: 'below' });
    labels.push({ text: format(box.h), x: rx, y: box.y + box.h / 2, anchor: 'right' });
    return { shapes: shapes, labels: labels, extent: union(canvas, { x: box.x, y: box.y, w: box.w + tick * 4, h: box.h + tick * 4 }) };
  }

  /* A point on the canvas from two lengths: % of the canvas on that axis,
     px in canvas units, X in the specimen's unit. */
  function placeOnCanvas(xSetting, ySetting, ctx, scope) {
    var c = ctx.canvas;
    return {
      x: c.x + toCanvas(resolveLength(xSetting, '%', scope), ctx, c, 'x'),
      y: c.y + toCanvas(resolveLength(ySetting, '%', scope), ctx, c, 'y')
    };
  }

  /* A placed box: x, y, w, h as lengths on the canvas. */
  function placedBox(s, ctx, scope) {
    var c = ctx.canvas;
    var at = placeOnCanvas(s.x, s.y, ctx, scope);
    return {
      x: at.x,
      y: at.y,
      w: Math.max(0, toCanvas(resolveLength(s.w, '%', scope), ctx, c, 'x')),
      h: Math.max(0, toCanvas(resolveLength(s.h, '%', scope), ctx, c, 'y'))
    };
  }

  /* A line of text, placed on the canvas. Below 0 or past 100% puts it in
     the margin, and the view grows to its point (the label itself is
     measured where it is placed: placeLabels, exportSvg). */
  function computeNote(layer, ctx, scope) {
    var s = layer.settings;
    var canvas = ctx.canvas;
    var labels = [];
    var extent = canvas;
    if (s.text) {
      var at = placeOnCanvas(s.x, s.y, ctx, scope);
      labels.push({ text: String(s.text), x: at.x, y: at.y, anchor: 'centre' });
      extent = union(canvas, { x: at.x, y: at.y, w: 0, h: 0 });
    }
    return { shapes: [], labels: labels, extent: extent };
  }

  /* A shape: placed, so it follows nothing. A tap area, the slot an object
     sits in, a coloured area. */
  function computeShape(layer, ctx, scope) {
    var s = layer.settings;
    var box = placedBox(s, ctx, scope);
    var node;
    if (s.form === 'circle') {
      node = stroked(el('ellipse', { cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 }));
    } else {
      var radius = s.form === 'rounded' ? Math.min(box.w, box.h) * Math.max(0, Math.min(50, Number(s.radius) || 0)) / 100 : 0;
      node = rect(box, radius ? { rx: radius } : null);
    }
    node.setAttribute('class', 'layer-stack-fill layer-stack-edge');
    return { shapes: [part(node, 'Shape')], labels: [], extent: box, boxes: { outer: box } };
  }

  /* The canvas shape's outline as a path d, or null for a plain rectangle
     (the canvas edge already draws it, and nothing is clipped). */
  function canvasShapePath(spec, box) {
    var shape = spec.canvas && spec.canvas.shape;
    if (shape === 'circle') {
      var r = Math.min(box.w, box.h) / 2;
      var cx = box.x + box.w / 2;
      var cy = box.y + box.h / 2;
      return 'M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0Z';
    }
    if (shape === 'app-icon') { return squirclePath(box); }
    if (shape === 'rounded') {
      return roundedPath(box, Math.min(box.w, box.h) * Math.max(0, Math.min(50, Number(spec.canvas.radius) || 0)) / 100);
    }
    return null;
  }

  /* How the canvas shape shows: the canvas around it shaded (even-odd
     cuts the shape out of the canvas), the shape itself shaded, its
     outline. One group, drawn just above the specimen. */
  function canvasShapeDisplay(spec, ctx, d) {
    var show = (spec.canvas && spec.canvas.shapeShow) || [];
    var box = ctx.canvas;
    var g = el('g', { class: 'layer-stack-canvas-shape' });
    if (show.indexOf('outside') !== -1) { g.appendChild(part(el('path', { d: boxPath(box) + d, 'fill-rule': 'evenodd', class: 'layer-stack-shade' }), 'Cut-away shade')); }
    if (show.indexOf('inside') !== -1) { g.appendChild(part(el('path', { d: d, class: 'layer-stack-shade' }), 'Shape shade')); }
    if (show.indexOf('outline') !== -1) { g.appendChild(part(stroked(el('path', { d: d, class: 'layer-stack-edge' })), 'Shape outline')); }
    return g.firstChild ? g : null;
  }

  function roundedPath(box, r) {
    var x = box.x;
    var y = box.y;
    var w = box.w;
    var h = box.h;
    return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) +
      'H' + (x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) +
      'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
  }

  function computeImage(layer, ctx, scope) {
    var s = layer.settings;
    var box = placedBox(s, ctx, scope);
    var shapes = [];
    var labels = [];
    if (s.src) {
      var image = el('image', {
        x: box.x, y: box.y, width: box.w, height: box.h,
        preserveAspectRatio: s.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
      });
      image.setAttribute('href', s.src);
      shapes.push(part(image, 'Image'));
    } else {
      shapes.push(rect(box, { class: 'layer-stack-placeholder' }));
      labels.push({ hint: true, text: layer.label + ': no image yet', x: box.x + box.w / 2, y: box.y + box.h / 2, anchor: 'centre' });
    }
    return { shapes: shapes, labels: labels, extent: box };
  }

  var COMPUTE = {
    zone: computeZone,
    shape: computeShape,
    guide: computeGuide,
    grid: computeGrid,
    measure: computeMeasure,
    note: computeNote,
    image: computeImage
  };

  /* The rules that make up the bleed (N6): zones and shapes. Never the
     specimen's drawing, so a rule's stated size never changes with the
     sample loaded; never construction (guide, grid), which is measured from
     a box, or annotation (measure, note), which describes one. */
  var BLEED_TYPES = ['zone', 'shape'];

  /* Every layer's geometry in three passes: the specimen and the rules, so
     the bleed is known; then guides, grids, notes and images, whose lines
     may run out to it; then measures, which read zones and the bleed.
     Hidden layers are computed too — toggling must not re-measure
     (format-system.md §5) — and count toward the bleed, but contribute
     nothing to the view. */
  function compute(spec, ctx, scope) {
    var results = {};
    var layers = flatLayers(spec);
    var first = layers.filter(function (l) { return l.type === 'specimen' || BLEED_TYPES.indexOf(l.type) !== -1; });
    var measures = layers.filter(function (l) { return l.type === 'measure'; });
    var rest = layers.filter(function (l) { return first.indexOf(l) === -1 && measures.indexOf(l) === -1; });
    var all = ctx.canvas;
    first.forEach(function (layer) {
      if (layer.type === 'specimen') {
        // The drawing, overshoot and all, so the view shows what crosses
        // the canvas edge; the bleed never reads it.
        results[layer.id] = { shapes: [], labels: [], extent: ctx.hasArtwork ? union(ctx.canvas, drawnBox(ctx)) : ctx.canvas };
        return;
      }
      var result = COMPUTE[layer.type](layer, ctx, scope, results);
      results[layer.id] = result;
      // A zone counts by its edge, not the reach of its overflowing lines.
      var box = result.boxes ? result.boxes.outer : result.extent;
      if (box) { all = union(all, box); }
    });
    ctx.all = all;
    rest.concat(measures).forEach(function (layer) {
      results[layer.id] = COMPUTE[layer.type](layer, ctx, scope, results);
    });
    return results;
  }

  //
  //------- Artwork -------//
  //

  /* Read an SVG string into what layout needs: the parsed root, its viewBox
     and the unit X (in viewBox units) when the caller knows it. */
  function readArtwork(markup, unit, glyphMarkup) {
    if (!markup) { return null; }
    var svg = parseSvg(markup);
    if (!svg) { return null; }
    var parts = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(isNaN) || !(parts[2] > 0) || !(parts[3] > 0)) {
      var w = parseFloat(svg.getAttribute('width'));
      var h = parseFloat(svg.getAttribute('height'));
      if (!(w > 0) || !(h > 0)) { return null; }
      parts = [0, 0, w, h];
    }
    var glyph = glyphMarkup ? readArtwork(glyphMarkup, 0) : null;
    return { svg: svg, viewBox: { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }, unit: unit > 0 ? unit : 0, glyph: glyph };
  }

  //
  //------- Render -------//
  //

  var renderCount = 0;

  /* Draw a spec into an <svg> the caller owns. Returns the view box, the
     labels (for the caller to place as HTML) and any warnings.

     options:
       artwork       readArtwork() result, or null
       scope         element tokens are read from (default: the document)
       overlayOnly   draw the layers but not the artwork, over artwork the
                     caller already shows (the Icon Library, the Logo Tool) */
  /* The box a render draws: the canvas, grown to take in every shown
     layer's extent (a clear space outside a canvas that hugs the artwork,
     artwork overshooting it). A host that places its own artwork over an
     overlayOnly render sizes its frame to this so the two line up. */
  function viewOf(spec, artwork, scope) {
    var ctx = layout(spec, artwork, scope);
    var results = compute(spec, ctx, scope);
    var view = { x: ctx.canvas.x, y: ctx.canvas.y, w: ctx.canvas.w, h: ctx.canvas.h };
    drawList(spec).forEach(function (item) {
      var result = results[item.layer.id];
      if (item.shown && result && result.extent) { view = union(view, result.extent); }
    });
    return { view: view, ctx: ctx, results: results };
  }

  function render(svgRoot, spec, options) {
    var opts = options || {};
    var drawing = viewOf(spec, opts.artwork, opts.scope);
    var ctx = drawing.ctx;
    var results = drawing.results;
    var view = drawing.view;
    renderCount += 1;
    var uid = 'ls' + renderCount;

    while (svgRoot.firstChild) { svgRoot.removeChild(svgRoot.firstChild); }
    var defs = el('defs');
    svgRoot.appendChild(defs);

    // A layer shows when its own eye and its group's are both on.
    var drawn = drawList(spec);

    // The canvas shape: one clip for the reference (the background, the
    // specimen, any image under the specimen), never for the rules.
    var shapeD = canvasShapePath(spec, ctx.canvas);
    var clipId = null;
    if (shapeD) {
      clipId = uid + '--shape';
      var clip = el('clipPath', { id: clipId });
      clip.appendChild(el('path', { d: shapeD }));
      defs.appendChild(clip);
    }

    // The background, under everything; over a specimen the host already
    // shows, it would bury it.
    var background = spec.canvas && spec.canvas.background;
    if (background && !opts.overlayOnly) {
      var ground = el('g', { class: 'layer-stack-background' });
      ground.style.setProperty('--layer-stack-colour-set', String(background));
      ground.appendChild(clipped(part(el('rect', { x: ctx.canvas.x, y: ctx.canvas.y, width: ctx.canvas.w, height: ctx.canvas.h, class: 'layer-stack-fill' }), 'Colour'), clipId));
      svgRoot.appendChild(ground);
    }

    var specimenAt = -1;
    drawn.forEach(function (item, i) { if (item.layer.type === 'specimen') { specimenAt = i; } });

    var labels = [];
    drawn.forEach(function (item, i) {
      var layer = item.layer;
      var g = el('g', {
        class: 'layer-stack-layer' + (item.shown ? '' : ' is-hidden'),
        'data-type': layer.type,
        'data-layer-id': layer.id,
        'data-line': layer.settings.lineStyle === 'dashed' ? 'dashed' : null,
        'data-approximate': layer.approximate ? 'true' : null
      });
      paint(g, layer, opts.scope);
      if (layer.type === 'specimen') {
        if (!opts.overlayOnly && opts.artwork) { g.appendChild(placeArtwork(opts.artwork, ctx, uid, clipId)); }
        // With overshoot, the trimmed box is outlined as the canvas edge
        // is, so what crosses it reads as overshoot. A canvas that hugs the
        // specimen is that box, and its own edge says so.
        if (!opts.overlayOnly && opts.artwork && ctx.overshoot && ctx.overshoot.any && spec.canvas.fit !== 'fit-artwork') {
          g.appendChild(rect(ctx.trim, { class: 'layer-stack-canvas-edge layer-stack-trim-edge' }));
        }
        if (!opts.overlayOnly && ctx.cropped && opts.artwork) {
          var coverClip = el('clipPath', { id: uid + '--canvas' });
          coverClip.appendChild(el('rect', { x: ctx.canvas.x, y: ctx.canvas.y, width: ctx.canvas.w, height: ctx.canvas.h }));
          defs.appendChild(coverClip);
          g.setAttribute('clip-path', 'url(#' + uid + '--canvas)');
        }
        svgRoot.appendChild(g);
        // How the canvas shape shows sits on the specimen, under the rules.
        var display = shapeD ? canvasShapeDisplay(spec, ctx, shapeD) : null;
        // Over a host's own artwork, the shape takes the host's ink, as the
        // rest of its overlay does (the Logo Tool draws in the logo's colour).
        if (display && opts.overlayOnly) { display.setAttribute('data-ink', 'host'); }
        if (display) { svgRoot.appendChild(display); }
        return;
      }
      // An image under the specimen is a reference, clipped to the shape;
      // over it, a rule such as a platform's interface, and not clipped.
      var reference = layer.type === 'image' && i < specimenAt;
      keepDrawn(results[layer.id].shapes, layer.settings.draw).forEach(function (shape) {
        g.appendChild(reference ? clipped(shape, clipId) : shape);
      });
      if (item.shown) {
        results[layer.id].labels.forEach(function (label) { labels.push({ layerId: layer.id, text: label.text, x: label.x, y: label.y, anchor: label.anchor, hint: !!label.hint }); });
      }
      svgRoot.appendChild(g);
    });

    var edge = part(rect(ctx.canvas, { class: 'layer-stack-canvas-edge' }), 'Edge');
    svgRoot.appendChild(edge);

    svgRoot.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
    svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    return { view: view, canvas: ctx.canvas, art: ctx.art, labels: labels, warnings: ctx.warnings, ctx: ctx, results: results };
  }

  /* A layer's parts as its draw asks: outline keeps the edges, fill the
     areas, both everything. A part that is both an area and an edge loses
     the half it is not asked for. A layer with nothing of the kind asked
     for (fill on a line) keeps what it has, so it never vanishes. */
  function keepDrawn(shapes, draw) {
    if (draw !== 'outline' && draw !== 'fill') { return shapes; }
    var keep = draw === 'outline' ? 'layer-stack-edge' : 'layer-stack-fill';
    var drop = draw === 'outline' ? 'layer-stack-fill' : 'layer-stack-edge';
    var nodes = [];
    shapes.forEach(function (shape) {
      nodes.push(shape);
      Array.prototype.push.apply(nodes, shape.querySelectorAll('.' + keep + ', .' + drop));
    });
    var wanted = nodes.some(function (node) { return node.classList && node.classList.contains(keep); });
    if (!wanted) { return shapes; }
    nodes.forEach(function (node) {
      if (!node.classList || !node.classList.contains(drop)) { return; }
      if (node.classList.contains(keep)) { node.classList.remove(drop); } else if (node.parentNode) { node.parentNode.removeChild(node); } else { node.setAttribute('data-dropped', 'true'); }
    });
    return shapes.filter(function (shape) { return shape.getAttribute('data-dropped') !== 'true'; });
  }

  /* The specimen as a nested <svg>, sized to its fitted box. A clone, so the
     caller's parsed artwork is never moved or edited. A picture (an image
     specimen: { href, viewBox }, no svg) is an <image> in the same box. */
  function placeArtwork(artwork, ctx, uid, clipId) {
    if (!artwork.svg && artwork.href) {
      return clipped(part(el('image', {
        href: artwork.href, x: ctx.art.x, y: ctx.art.y, width: ctx.art.w, height: ctx.art.h,
        preserveAspectRatio: 'xMidYMid meet', class: 'layer-stack-artwork'
      }), 'Drawing'), clipId);
    }
    var svg = uniqueCopy(artwork.svg, uid);
    svg.removeAttribute('style');
    svg.setAttribute('x', ctx.art.x);
    svg.setAttribute('y', ctx.art.y);
    svg.setAttribute('width', ctx.art.w);
    svg.setAttribute('height', ctx.art.h);
    svg.setAttribute('viewBox', [artwork.viewBox.x, artwork.viewBox.y, artwork.viewBox.w, artwork.viewBox.h].join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('overflow', 'visible');
    svg.setAttribute('class', 'layer-stack-artwork');
    return clipped(part(svg, 'Drawing'), clipId);
  }

  /* A node inside the canvas shape's clip, or the node as it is when the
     canvas is a plain rectangle. */
  function clipped(node, clipId) {
    if (!clipId) { return node; }
    var g = part(el('g', { 'clip-path': 'url(#' + clipId + ')' }), 'Shape clip');
    g.appendChild(node);
    return g;
  }

  /* A copy of the artwork whose ids are prefixed, with every reference to
     them rewritten, so two renders on one page never share an id. Done on
     the markup, before parsing, because a reference can sit in any
     attribute (url(#…), href="#…", xlink:href="#…"). */
  function uniqueCopy(source, uid) {
    var markup = source.outerHTML;
    var ids = [];
    markup.replace(/\sid="([^"]+)"/g, function (match, id) { ids.push(id); return match; });
    ids.forEach(function (id) {
      var safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      markup = markup
        .replace(new RegExp('\\sid="' + safe + '"', 'g'), ' id="' + uid + '-' + id + '"')
        .replace(new RegExp('url\\(#' + safe + '\\)', 'g'), 'url(#' + uid + '-' + id + ')')
        .replace(new RegExp('"#' + safe + '"', 'g'), '"#' + uid + '-' + id + '"');
    });
    return parseSvg(markup);
  }

  /* Parse inside a <template>: its content is inert, so nothing in the
     markup runs or loads while it is read. Callers run untrusted markup
     through the shared SvgCleaner engine first; this is the second line,
     because that engine works by pattern and misses unquoted handlers
     (ROADMAP → Known debt). Before the node can go live, everything that
     could act is taken out: scripts, foreign content, style sheets (which
     would restyle the whole page), animation that sets a link, every on*
     attribute, and any link that is not to a fragment inside the drawing.
     Nothing that draws is touched. */
  var ACTIVE_ELEMENTS = 'script, foreignObject, style, iframe, object, embed, link, meta';

  function parseSvg(markup) {
    var template = document.createElement('template');
    template.innerHTML = String(markup || '').replace(/<\?xml[^>]*\?>\s*/i, '');
    var svg = template.content.querySelector('svg');
    if (!svg) { return null; }
    Array.prototype.forEach.call(svg.querySelectorAll(ACTIVE_ELEMENTS), function (node) { node.remove(); });
    Array.prototype.forEach.call(svg.querySelectorAll('animate, set, animateTransform, animateMotion'), function (node) {
      var target = (node.getAttribute('attributeName') || '').toLowerCase();
      if (target === 'href' || target === 'xlink:href' || target.indexOf('on') === 0) { node.remove(); }
    });
    [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*'))).forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (name.indexOf('on') === 0) { node.removeAttribute(attr.name); return; }
        if ((name === 'href' || name === 'xlink:href') && attr.value.trim().charAt(0) !== '#') { node.removeAttribute(attr.name); }
      });
    });
    return document.importNode(svg, true);
  }

  /* The layer's paint, as custom properties the stylesheet reads. Set
     through setProperty, which takes one value and nothing more, and as
     the -set variables, so the stylesheet decides what wins (forced colours
     override them; tools.css, Layer stack). */
  function paint(g, layer, scope) {
    var s = layer.settings;
    function setColour(name, value) {
      if (value) { g.style.setProperty(name, String(value)); }
    }
    function setOpacity(name, value) {
      if (value !== undefined) { g.style.setProperty(name, String(Math.max(0, Math.min(1, resolveNumber(value, 1, scope))))); }
    }
    if (TWO_PAINT.indexOf(layer.type) !== -1) {
      setColour('--layer-stack-outline-colour-set', s.outlineColour);
      setOpacity('--layer-stack-outline-opacity-set', s.outlineOpacity);
      setColour('--layer-stack-fill-colour-set', s.fillColour);
      setOpacity('--layer-stack-fill-opacity-set', s.fillOpacity);
    } else if (layer.type !== 'note') {
      if (layer.type === 'measure') { setColour('--layer-stack-colour-set', s.colour); }
      setOpacity('--layer-stack-opacity-set', s.opacity);
    }
    // A line weight bound to the token is left to the stylesheet, so a
    // theme's --overlay-line-weight wins; a number is the layer's own.
    if (typeof s.lineWeight === 'number' || (s.lineWeight && !s.lineWeight.token)) {
      var weight = Math.max(0, Math.min(64, Number(typeof s.lineWeight === 'number' ? s.lineWeight : s.lineWeight.value) || 0));
      g.style.setProperty('--layer-stack-line-weight-set', weight + 'px');
    }
  }

  /* Place the labels a render returned as HTML inside host, positioned by
     percentage of the view so they keep their size at any scale. */
  function placeLabels(host, result, className) {
    Array.prototype.forEach.call(host.querySelectorAll('.' + (className || 'layer-stack-label')), function (node) { node.remove(); });
    result.labels.forEach(function (label) {
      var span = document.createElement('span');
      span.className = className || 'layer-stack-label';
      span.dataset.anchor = label.anchor || 'centre';
      span.dataset.layerId = label.layerId;
      span.style.left = ((label.x - result.view.x) / result.view.w * 100) + '%';
      span.style.top = ((label.y - result.view.y) / result.view.h * 100) + '%';
      span.textContent = label.text;
      host.appendChild(span);
    });
  }

  //
  //------- Export -------//
  //

  var SPEC_METADATA_ID = 'layer-stack-spec';
  var PAINTED = { path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, text: 1, tspan: 1, use: 1 };

  /* A render as a standalone SVG file. Reads the live <svg> a render drew,
     after the stylesheet has painted it, because the paint lives in CSS
     (custom properties and classes) that a file on its own cannot resolve.

     Strokes are drawn at a screen width in the preview (non-scaling-stroke),
     which design tools ignore, so widths, dashes and the labels' size are
     written in canvas units at the scale the preview showed: the file looks
     like the preview did, wherever it opens.

     options:
       artwork   false leaves out the specimen and the canvas background,
                 so the rules can be laid over artwork elsewhere (default
                 true)
       labels    false leaves out the labels
       images    { src: { markup } | { dataUrl } } — what the caller has
                 already loaded for an image layer or an image marker. An
                 SVG is drawn into the file as vectors, anything else is
                 embedded; a src not here stays a link, made absolute
       onLinked  called with the srcs that stayed links, so the caller can
                 say so
       title     the file's <title>
       name      the outer frame's name; by default the template and the
                 canvas size ("Logo with clear space · 1000 × 500")

     A design tool shows each id as a layer's name, so every layer, group
     and part is named for what it is, and each layer's labels sit inside
     its group. That puts a label under any opaque layer drawn after its
     own, where the preview draws every label on top. */
  function exportSvg(svgRoot, result, spec, options) {
    var opts = options || {};
    var withArtwork = opts.artwork !== false;
    var box = svgRoot.getBoundingClientRect();
    // A preview with no size (hidden, collapsed) is read as 600 wide.
    var k = box.width > 0 && box.height > 0 ? Math.max(result.view.w / box.width, result.view.h / box.height) : result.view.w / 600;
    var labelStyle = readLabelStyle(svgRoot, k);
    // Groups opened in place: a layer shows when its own eye and its
    // group's are both on, as in the preview.
    var drawn = drawList(spec);
    var layersById = {};
    var shownById = {};
    drawn.forEach(function (item) { layersById[item.layer.id] = item.layer; shownById[item.layer.id] = item.shown; });
    // An image specimen is for checking the rules by, in the browser; it
    // never goes in the file, whatever the artwork option says.
    var imageArtwork = !!(spec.specimen && spec.specimen.kind === 'image');
    function exported(layer) {
      if (layer && layer.type === 'specimen' && imageArtwork) { return false; }
      return layer && shownById[layer.id] && (withArtwork || layer.type !== 'specimen');
    }
    // The editor's own hints ("no image yet") are for the person editing,
    // never the file.
    var shown = opts.labels === false ? [] : result.labels.filter(function (label) {
      return !label.hint && exported(layersById[label.layerId]);
    });
    // In the preview a label outside the drawing hangs in the band around
    // it; in a file it has to be inside the view box.
    // Without the specimen, its overshoot past the canvas is not in the
    // file either: the view is the canvas and the layers that go in.
    var base = result.view;
    if (!withArtwork && result.results) {
      base = { x: result.canvas.x, y: result.canvas.y, w: result.canvas.w, h: result.canvas.h };
      drawn.forEach(function (item) {
        var computed = result.results[item.layer.id];
        if (exported(item.layer) && computed && computed.extent) { base = union(base, computed.extent); }
      });
    }
    var view = shown.reduce(function (grown, label) { return union(grown, labelBox(label, labelStyle)); }, base);

    var clone = svgRoot.cloneNode(true);
    var live = svgRoot.querySelectorAll('*');
    var copies = clone.querySelectorAll('*');
    for (var i = 0; i < live.length; i++) { inlinePaint(live[i], copies[i], svgRoot, k); }
    // The editor's marks stay out of the file: a missing image's
    // placeholder, and the outline of the artwork's trimmed box.
    Array.prototype.forEach.call(clone.querySelectorAll('.layer-stack-placeholder, .layer-stack-trim-edge'), function (node) { node.remove(); });

    var out = document.createElementNS(SVG_NS, 'svg');
    out.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(round).join(' '));
    out.setAttribute('width', round(view.w));
    out.setAttribute('height', round(view.h));
    var title = el('title');
    title.textContent = cleanText(opts.title || 'Layout spec');
    out.appendChild(title);
    var metadata = el('metadata', { id: SPEC_METADATA_ID, 'data-spec-version': SPEC_VERSION });
    metadata.textContent = serializeSpec(spec, { pretty: true });
    out.appendChild(metadata);

    // Every id already in the drawing is taken, so a layer named after one
    // cannot collide with it.
    var names = Object.create(null);
    Array.prototype.forEach.call(clone.querySelectorAll('[id]'), function (node) { names[stableIds(node.getAttribute('id'))] = true; });
    names[SPEC_METADATA_ID] = true;

    // The outer frame, named for what it is. A design tool calls the pasted
    // frame by its id.
    out.setAttribute('id', uniqueName(opts.name || exportName(spec, result.canvas), names));

    // Each exported layer's group, by layer id. Anything else in the drawing
    // (its defs) goes in first; the canvas edge goes on top, as it is drawn.
    var layerNodes = {};
    var canvasNode = null;
    var backgroundNode = null;
    var shapeNode = null;
    Array.prototype.slice.call(clone.childNodes).forEach(function (node) {
      if (node.nodeType !== 1 || node.nodeName.toLowerCase() === 'title') { return; }
      var layerId = node.getAttribute('data-layer-id');
      var kind = node.getAttribute('class');
      if (layerId) {
        if (exported(layersById[layerId])) { layerNodes[layerId] = node; }
      } else if (kind === 'layer-stack-canvas-edge') {
        canvasNode = node;
      } else if (kind === 'layer-stack-background') {
        if (withArtwork) { backgroundNode = node; }
      } else if (kind === 'layer-stack-canvas-shape') {
        shapeNode = node;
      } else {
        out.appendChild(node);
      }
    });

    // Names in order of weight, so a layer or a group keeps the name it was
    // given and a part inside one takes the number: layers, then groups,
    // then the canvas, then every part.
    drawn.forEach(function (item) {
      var node = layerNodes[item.layer.id];
      if (node) { node.setAttribute('id', uniqueName(item.layer.label, names, TYPES[item.layer.type].label)); }
    });
    var groupNodes = {};
    (spec.layers || []).forEach(function (entry) {
      if (!isGroup(entry)) { return; }
      var kept = (entry.layers || []).filter(function (layer) { return layerNodes[layer.id]; });
      if (kept.length) { groupNodes[entry.id] = el('g', { id: uniqueName(entry.label, names, 'Group') }); }
    });
    if (canvasNode) {
      var edgeGroup = el('g', { id: uniqueName('Canvas', names) });
      edgeGroup.appendChild(canvasNode);
      canvasNode = edgeGroup;
    }
    if (backgroundNode) { backgroundNode.setAttribute('id', uniqueName('Background', names)); }
    if (shapeNode) { shapeNode.setAttribute('id', uniqueName('Canvas shape', names)); }

    // Inside a layer, its parts and labels are named apart from each other
    // but may repeat another layer's (each keyline has its Circle). They
    // never take a name already used above or in the drawing, so nothing
    // the drawing points at is shadowed.
    var scopes = {};
    function scopeOf(key) {
      if (!scopes[key]) { scopes[key] = Object.create(names); }
      return scopes[key];
    }

    // Each layer's labels inside its own group, on top of what it draws, so
    // hiding or deleting the layer in a design tool takes its labels too.
    drawn.forEach(function (item) {
      var node = layerNodes[item.layer.id];
      if (!node) { return; }
      shown.filter(function (label) { return label.layerId === item.layer.id; }).forEach(function (label) {
        labelNodes(label, labelStyle, scopeOf(item.layer.id)).forEach(function (text) { node.appendChild(text); });
      });
    });

    // Every part the engine named, outside the artwork's own drawing. A
    // named part's own parts are named within it (each dimension of a
    // measure has its Line and its ticks).
    function nameParts(node, scope) {
      Array.prototype.forEach.call(node.children, function (child) {
        if (child.nodeName.toLowerCase() === 'svg' && !child.hasAttribute('data-part')) { return; }
        var inner = scope;
        if (child.hasAttribute('data-part')) {
          child.setAttribute('id', uniqueName(child.getAttribute('data-part'), scope));
          inner = Object.create(scope);
        }
        if (child.nodeName.toLowerCase() !== 'svg') { nameParts(child, inner); }
      });
    }
    Object.keys(layerNodes).forEach(function (id) { nameParts(layerNodes[id], scopeOf(id)); });
    if (canvasNode) { nameParts(canvasNode, scopeOf(':canvas')); }
    if (backgroundNode) { nameParts(backgroundNode, scopeOf(':background')); }
    if (shapeNode) { nameParts(shapeNode, scopeOf(':shape')); }

    // A layer that drew nothing (no artwork loaded, a note with no text)
    // stays out, rather than arriving as an empty group.
    Object.keys(layerNodes).forEach(function (id) {
      if (!layerNodes[id].firstElementChild) { delete layerNodes[id]; }
    });

    // The background first, then groups stay groups, in the stack's order,
    // with the canvas shape's display just above the specimen.
    if (backgroundNode) { out.appendChild(backgroundNode); }
    (spec.layers || []).forEach(function (entry) {
      if (entry && entry.type === 'specimen') {
        if (layerNodes[entry.id]) { out.appendChild(layerNodes[entry.id]); }
        if (shapeNode) { out.appendChild(shapeNode); shapeNode = null; }
        return;
      }
      if (isGroup(entry)) {
        var group = groupNodes[entry.id];
        if (!group) { return; }
        (entry.layers || []).forEach(function (layer) { if (layerNodes[layer.id]) { group.appendChild(layerNodes[layer.id]); } });
        if (group.firstElementChild) { out.appendChild(group); }
      } else if (layerNodes[entry.id]) {
        out.appendChild(layerNodes[entry.id]);
      }
    });
    if (shapeNode) { out.appendChild(shapeNode); }
    if (canvasNode) { out.appendChild(canvasNode); }

    // The engine's hooks come off; the artwork's own markup inside its
    // nested <svg> keeps its style (a gradient stop's colour can live there).
    // Render ids (ls12-, mk3-, ls12--clip0) become stable, so two exports of
    // one spec name the same things the same way. Only ids and references to
    // them are touched: never a link, a name or the spec's text.
    Array.prototype.forEach.call(out.querySelectorAll('*'), function (node) {
      var parent = node.parentNode;
      var own = !(parent && parent !== out && parent.closest && parent.closest('svg') !== out);
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        var name = attr.name;
        if (own && (name === 'class' || name === 'style' || (name.indexOf('data-') === 0 && node !== metadata))) {
          node.removeAttribute(name);
          return;
        }
        var value = attr.value;
        var stable = value;
        if (name === 'id') { stable = stableIds(value); }
        else if ((name === 'href' || name === 'xlink:href') && value.charAt(0) === '#') { stable = '#' + stableIds(value.slice(1)); }
        else if (value.indexOf('url(#') !== -1) { stable = value.replace(/url\(#([^)]+)\)/g, function (match, id) { return 'url(#' + stableIds(id) + ')'; }); }
        if (stable !== value) { node.setAttribute(name, stable); }
      });
    });
    var defs = out.querySelector('defs') || out.insertBefore(el('defs'), metadata.nextSibling);
    var linked = embedImages(out, defs, opts.images);
    if (opts.onLinked) { opts.onLinked(linked); }

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out) + '\n';
  }

  /* An image in a file has to arrive with it: the site is behind sign-in
     and a design tool cannot follow a link there. What the caller loaded
     comes in, an SVG as vectors (so it stays editable), anything else as a
     data URL; what it did not stays a link, made whole.

     A zone's image marker is drawn once per place, up to 240 times, so an
     image that recurs is drawn once in <defs> and each place is a <use> of
     it; one that appears once is drawn where it is. Returns the srcs that
     stay links. */
  function embedImages(out, defs, images) {
    var nodes = Array.prototype.filter.call(out.querySelectorAll('image'), function (node) {
      var parent = node.parentNode;
      return !(parent && parent !== out && parent.closest && parent.closest('svg') !== out);
    });
    var keyOf = function (node) {
      return ['href', 'x', 'y', 'width', 'height', 'preserveAspectRatio'].map(function (name) { return node.getAttribute(name) || ''; }).join('|');
    };
    var counts = {};
    nodes.forEach(function (node) { var key = keyOf(node); counts[key] = (counts[key] || 0) + 1; });
    var shared = {};
    var linked = {};
    var made = 0;
    nodes.forEach(function (node) {
      var src = node.getAttribute('href') || '';
      var key = keyOf(node);
      if (counts[key] > 1) {
        if (!shared[key]) {
          // The shared source is unnamed: each <use> carries its place's name.
          var bare = node.cloneNode(false);
          bare.removeAttribute('id');
          var source = embeddedImage(bare, images, 'image' + (made += 1));
          if (!source.drawn) { linked[src] = true; }
          source.node.removeAttribute('opacity');
          shared[key] = 'image-' + made;
          source.node.setAttribute('id', shared[key]);
          defs.appendChild(source.node);
        }
        var use = el('use', { href: '#' + shared[key] });
        if (node.hasAttribute('id')) { use.setAttribute('id', node.getAttribute('id')); }
        if (node.hasAttribute('opacity')) { use.setAttribute('opacity', node.getAttribute('opacity')); }
        node.parentNode.replaceChild(use, node);
        return;
      }
      var single = embeddedImage(node, images, 'image' + (made += 1));
      if (!single.drawn) { linked[src] = true; }
      if (single.node !== node) { node.parentNode.replaceChild(single.node, node); }
    });
    return Object.keys(linked).filter(Boolean);
  }

  /* One image as the file carries it: { node, drawn }. */
  function embeddedImage(node, images, prefix) {
    var src = node.getAttribute('href') || '';
    var loaded = images && images[src];
    if (loaded && loaded.markup) {
      var drawing = readArtwork(loaded.markup, 0);
      if (drawing) {
        var svg = uniqueCopy(drawing.svg, prefix);
        svg.removeAttribute('style');
        ['x', 'y', 'width', 'height', 'preserveAspectRatio', 'opacity'].forEach(function (name) {
          if (node.hasAttribute(name)) { svg.setAttribute(name, node.getAttribute(name)); }
        });
        svg.setAttribute('viewBox', [drawing.viewBox.x, drawing.viewBox.y, drawing.viewBox.w, drawing.viewBox.h].join(' '));
        // The image's name stays on what replaces it; the drawing keeps its
        // own root id, which its insides may point at.
        if (node.hasAttribute('id')) {
          var named = el('g', { id: node.getAttribute('id') });
          named.appendChild(svg);
          return { node: named, drawn: true };
        }
        return { node: svg, drawn: true };
      }
    }
    if (loaded && loaded.dataUrl) {
      node.setAttribute('href', loaded.dataUrl);
      return { node: node, drawn: true };
    }
    if (/^data:/i.test(src)) { return { node: node, drawn: true }; }
    if (src && !/^https?:/i.test(src)) {
      try { node.setAttribute('href', new URL(src, window.location.href).href); } catch (error) { node.removeAttribute('href'); }
    }
    return { node: node, drawn: false };
  }

  /* A colour as every design tool reads it: rgb() and an opacity. The
     browser reports some colours (color-mix, oklch tokens) as color(srgb …)
     or oklch(…), which older tools read as black, so anything that is not
     plain rgb() is drawn once on a 1px canvas and read back. */
  var colourCache = {};
  var colourContext = null;

  function plainColour(value) {
    var text = String(value || '').trim();
    if (!text || text === 'none' || /^url\(/i.test(text)) { return { colour: text || 'none', alpha: 1 }; }
    if (/^transparent$/i.test(text)) { return { colour: 'rgb(0, 0, 0)', alpha: 0 }; }
    if (colourCache[text]) { return colourCache[text]; }
    var rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text);
    var read;
    if (rgb) {
      var a = rgb[4] === undefined ? 1 : (/%$/.test(rgb[4]) ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]));
      read = { colour: 'rgb(' + Math.round(rgb[1]) + ', ' + Math.round(rgb[2]) + ', ' + Math.round(rgb[3]) + ')', alpha: a };
    } else {
      if (!colourContext) {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        colourContext = canvas.getContext('2d', { willReadFrequently: true });
      }
      // No canvas (blocked by the browser): the value is kept as it came.
      if (!colourContext) { return { colour: text, alpha: 1 }; }
      colourContext.clearRect(0, 0, 1, 1);
      colourContext.fillStyle = '#000';
      colourContext.fillStyle = text;
      colourContext.fillRect(0, 0, 1, 1);
      var px = colourContext.getImageData(0, 0, 1, 1).data;
      read = { colour: 'rgb(' + px[0] + ', ' + px[1] + ', ' + px[2] + ')', alpha: round(px[3] / 255) };
    }
    colourCache[text] = read;
    return read;
  }

  /* A colour as one value, where no opacity attribute can carry its alpha
     (a color attribute, a value inside an artwork's markup, a label). */
  function cssColour(value) {
    var paint = plainColour(value);
    if (paint.alpha >= 1 || paint.colour === 'none') { return paint.colour; }
    return paint.colour.replace(/^rgb\((.*)\)$/, 'rgba($1, ' + round(paint.alpha) + ')');
  }

  /* Write a paint and its opacity: a colour's own alpha folds into the
     *-opacity attribute, which every tool reads. */
  function setPaint(node, name, value, opacity) {
    var paint = plainColour(value);
    node.setAttribute(name, paint.colour);
    var total = (opacity === undefined ? 1 : parseFloat(opacity)) * paint.alpha;
    if (paint.colour !== 'none' && total < 1) { node.setAttribute(name + '-opacity', round(total)); }
  }

  /* A render's id as the file names it: the engine's own (ls12--clip0) as
     layer-stack-clip0, the artwork's (ls12-grad) as art-grad, a marker
     source's (mk3-grad) as marker3-grad. Three families, so none can take
     another's name. */
  function stableIds(id) {
    return String(id).replace(/^ls\d+--/, 'layer-stack-').replace(/^ls\d+-/, 'art-').replace(/^mk(\d+)-/, 'marker$1-');
  }

  /* Text as XML can hold it: control characters a paste can carry would
     make the file unreadable. */
  function cleanText(text) {
    return String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
  }

  /* Copy what the stylesheet painted onto the element itself. */
  function inlinePaint(liveNode, copy, svgRoot, k) {
    if (liveNode.closest('defs, title, metadata')) { return; }
    var name = liveNode.nodeName.toLowerCase();
    var style = window.getComputedStyle(liveNode);
    // Inside an artwork or a marker drawing, the markup paints itself; the
    // one thing it takes from outside is currentColor. Only that is written
    // in, as the colour it resolves to, because design tools read a bare
    // currentColor as black. Writing all computed paint there would break
    // gradients and <use>.
    if (liveNode.parentNode && liveNode.parentNode.closest && liveNode.parentNode.closest('svg') !== svgRoot) {
      ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'style'].forEach(function (attr) {
        var value = copy.getAttribute(attr);
        if (value && /currentcolor/i.test(value)) { copy.setAttribute(attr, value.replace(/currentcolor/gi, cssColour(style.color))); }
      });
      return;
    }
    var scaled = liveNode.getAttribute('vector-effect') === 'non-scaling-stroke';
    if (style.opacity !== '1') { copy.setAttribute('opacity', style.opacity); }
    // An artwork's own currentColor, wherever its markup keeps it.
    if (name === 'svg') { copy.setAttribute('color', cssColour(style.color)); }
    if (!PAINTED[name]) { return; }
    setPaint(copy, 'fill', style.fill, style.fillOpacity);
    setPaint(copy, 'stroke', style.stroke, style.strokeOpacity);
    if (style.stroke !== 'none') {
      var width = parseFloat(style.strokeWidth);
      copy.setAttribute('stroke-width', round((width >= 0 ? width : 1) * (scaled ? k : 1)));
      if (style.strokeDasharray && style.strokeDasharray !== 'none') {
        copy.setAttribute('stroke-dasharray', style.strokeDasharray.split(/[\s,]+/).map(function (part) {
          return round(parseFloat(part) * (scaled ? k : 1));
        }).join(' '));
      }
      if (style.strokeLinecap !== 'butt') { copy.setAttribute('stroke-linecap', style.strokeLinecap); }
    }
    if (name === 'text') {
      copy.setAttribute('font-family', firstFamily(style.fontFamily));
      copy.setAttribute('font-weight', style.fontWeight);
      // Not every tool reads dominant-baseline; a marker's centring is
      // written into its position instead (0.35em is the x-height's middle).
      if (copy.getAttribute('dominant-baseline') === 'central') {
        var size = parseFloat(copy.getAttribute('font-size')) || parseFloat(style.fontSize) || 0;
        copy.setAttribute('y', round((parseFloat(copy.getAttribute('y')) || 0) + size * 0.35));
        copy.removeAttribute('dominant-baseline');
      }
    }
    if (scaled) { copy.removeAttribute('vector-effect'); }
  }

  /* The labels' type and colours, read from a label the stylesheet styles
     where the tool's labels sit, so a dark ground's ink comes with it. */
  function readLabelStyle(svgRoot, k) {
    var probe = document.createElement('span');
    probe.className = 'layer-stack-label';
    probe.textContent = 'X';
    (svgRoot.parentNode || document.body).appendChild(probe);
    var style = window.getComputedStyle(probe);
    var size = (parseFloat(style.fontSize) || 11) * k;
    var read = { family: firstFamily(style.fontFamily), size: size, ink: cssColour(style.color), paper: cssColour(style.backgroundColor) };
    probe.remove();
    return read;
  }

  /* Where a label's text sits: the HTML labels' transforms (tools.css), in
     em of the label size, with the baseline as y. */
  function labelPlace(label, style) {
    var anchor = label.anchor || 'centre';
    var place = { x: label.x, y: label.y + style.size * 0.35, textAnchor: 'middle' };
    if (anchor === 'above') { place.y = label.y - style.size * 0.55; }
    if (anchor === 'below') { place.y = label.y + style.size * 1.15; }
    if (anchor === 'right') { place.x = label.x + style.size * 0.7; place.textAnchor = 'start'; }
    return place;
  }

  /* A label's box, near enough to keep it inside the view: the label face
     is monospaced, so a character is about 0.6em; the halo adds a little. */
  function labelBox(label, style) {
    var place = labelPlace(label, style);
    var w = String(label.text).length * style.size * 0.62 + style.size * 0.4;
    var x = place.textAnchor === 'start' ? place.x - style.size * 0.2 : place.x - w / 2;
    return { x: x, y: place.y - style.size * 1.05, w: w, h: style.size * 1.4 };
  }

  /* The first family of a CSS font stack, unquoted. Design tools match a
     font-family attribute as one name: Figma reads a whole stack
     ("IBM Plex Mono", monospace) as no font and falls back to its own. */
  function firstFamily(stack) {
    return String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '') || 'sans-serif';
  }

  /* One label as SVG text, twice: a paper halo under the ink, because not
     every design tool reads paint-order. Each is named by its text, as a
     design tool names a text layer, the halo as its outline. */
  function labelNodes(label, style, names) {
    var place = labelPlace(label, style);
    var common = { x: round(place.x), y: round(place.y), 'text-anchor': place.textAnchor, 'font-family': style.family, 'font-size': round(style.size) };
    var text = cleanText(label.text);
    var halo = el('text', Object.assign({ fill: 'none', stroke: style.paper, 'stroke-width': round(style.size * 0.3), 'stroke-linejoin': 'round' }, common));
    var ink = el('text', Object.assign({ fill: style.ink }, common));
    halo.setAttribute('id', uniqueName(text.trim() ? text + ' outline' : '', names, 'Label outline'));
    ink.setAttribute('id', uniqueName(text, names, 'Label'));
    halo.textContent = text;
    ink.textContent = text;
    return [halo, ink];
  }

  /* An id a design tool shows as the layer's name: the label as written,
     on one line, numbered when the name is taken. A name is taken in the
     form the file will carry too: the last pass rewrites render ids
     (stableIds), so a label that looks like one must not land on one. */
  function uniqueName(label, names, fallback) {
    var base = cleanText(label === undefined || label === null ? '' : label).replace(/\s+/g, ' ').trim() || fallback || 'Layer';
    var name = base;
    var n = 2;
    while (names[name] || names[stableIds(name)]) { name = base + ' ' + n; n += 1; }
    names[name] = true;
    return name;
  }

  /* The outer frame's name: the template the spec started from and the
     canvas as drawn (a hugging canvas is the specimen's size), as a
     designer would name the frame. A template that names its own size
     ("Icon, 24 × 24") gives it once. */
  function exportName(spec, canvas) {
    var template = has(TEMPLATES, spec.template) && spec.template !== 'blank' ? TEMPLATES[spec.template].label : 'Layout Spec';
    template = template.replace(/,\s*[\d.]+\s*×\s*[\d.]+$/, '');
    return canvas && canvas.w && canvas.h ? template + ' · ' + format(canvas.w) + ' × ' + format(canvas.h) : template;
  }

  /* The spec an exported SVG carries, as text for parseSpec, or null when
     the SVG was not made here. */
  function readSpecFromSvg(markup) {
    var doc = new DOMParser().parseFromString(String(markup || ''), 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) { return null; }
    var metadata = doc.querySelector('metadata#' + SPEC_METADATA_ID);
    var text = metadata ? metadata.textContent.trim() : '';
    return text || null;
  }

  window.LayerStack = {
    VERSION: VERSION,
    SPEC_VERSION: SPEC_VERSION,
    TYPES: TYPES,
    CHOICES: CHOICES,
    PRESETS: PRESETS,
    TEMPLATES: TEMPLATES,
    createLayer: createLayer,
    createGroup: createGroup,
    createSpec: createSpec,
    duplicateLayer: duplicateLayer,
    flatLayers: flatLayers,
    toggles: toggles,
    setVisible: setVisible,
    parseSpec: parseSpec,
    serializeSpec: serializeSpec,
    resolveLength: resolveLength,
    resolveNumber: resolveNumber,
    readArtwork: readArtwork,
    trimmedSize: trimmedSize,
    layout: layout,
    compute: compute,
    viewOf: viewOf,
    render: render,
    placeLabels: placeLabels,
    exportSvg: exportSvg,
    readSpecFromSvg: readSpecFromSvg,
    ratioOf: ratioOf,
    sameRatio: sameRatio
  };
})();
