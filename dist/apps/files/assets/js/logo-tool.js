/**
 * logo-tool.js — Logo Tool (self-serve logo exporter with the brand rules built in)
 *
 * Global page module. Loaded once on every page (same as calculator.js, svg-cleaner.js,
 * etc.) and started by itself on initial load AND after every Barba navigation via
 * the bd:after-nav event (startLogoTool, at the end). initLogoTool() bails early when the tool's markup is absent, so
 * it is a no-op everywhere else, and guards against re-binding within one container.
 *
 * MUST STAY OUTSIDE [data-barba="container"]. This file and logo-manifest.js match no
 * entry in LIBRARY_PATTERNS (barba-docs.js), so if either were moved inside the container
 * reExecuteContainerScripts would re-run it on every arrival: the manifest would be
 * rebuilt from scratch each navigation, and this file would spawn a second IIFE whose
 * observer outlives a closure the dataset guard then refuses to re-initialise.
 *
 * The brand is data: everything the tool renders comes from window.LogoManifest
 * (assets/js/logo-manifest.js). New brand = new manifest, zero code changes. A manifest
 * that is missing or malformed produces an empty state naming the problem, never a throw
 * — a throw would leave the tool dead with nothing on the page to say why.
 *
 * SVG processing comes from the shared engine in assets/js/vendor/svg-cleaner-core.js
 * (window.SvgCleaner), a synced copy of @bydefaultstudio/svg-cleaner. Never add
 * processing logic here — it belongs in the package repo. The one exception is the
 * flatten pass below, which the package does not carry yet.
 *
 * Fully client-side: no uploads, no network calls, no dependencies. Raster export is
 * SVG string -> Image -> canvas -> toBlob() at the exact export pixels; the source is
 * always a string we built, so the canvas can never taint.
 *
 * Copy puts the same artefact on the clipboard. SVG goes as text through
 * copy-button.js (data-copy, refreshed on every render); PNG and JPG go through
 * handleCopy() as a PNG blob, because the clipboard API has no JPEG type.
 *
 * The page is a tool canvas (cms/tool-canvas.md): the preview band is the stage,
 * with the Preview group (Transparent, Safe zone) beside the logo — switches that
 * change only what the preview shows. The choices are visible options in three
 * sections: Settings, the variation chips, built here from the manifest; Style,
 * the tools' shared colour control (tool-colour.js); Export, the format, the
 * width with its presets (the tools' shared size control, tools.css), the
 * filename and flatten. The two
 * verbs, whose labels follow the format, are pinned under them.
 * 3.1.0: the tools' shared Settings / Style / Export split — colour moved into
 * its own Style section with its own reset, the width into Export.
 * 3.2.0: colour is Foreground / Background on the shared control, with the
 * manifest's colourways as its Pairs row. Background defaults to None.
 * 3.3.0: the background colours the preview; Export's Include background
 * decides whether it goes into the file. Transparent is preview-only and
 * always available.
 *
 * @version 3.8.0
 */
(function () {
  'use strict';

  console.log('[logo-tool] v3.6.1 loaded');

  //
  //------- FLATTEN — upstream candidate for @bydefaultstudio/svg-cleaner -------//
  //
  // "Flatten" merges every <path>'s d into ONE multi-subpath <path>. For separated,
  // non-overlapping artwork (letterforms) the render is identical to a boolean union;
  // counters and holes survive because they are already subpaths. It is a merge, not
  // geometry — canMerge refuses anything that would change how the artwork resolves.
  //
  // This lives here rather than in the vendor core because that file is a synced copy
  // regenerated on npm install and must never be hand-edited (CLAUDE.md §15). Move it
  // into the package and delete this block when the package gains the capability.

  function canMerge(svg) {
    // Anything beyond plain filled <path> elements needs geometry we do not do.
    if (/\stransform="/i.test(svg)) return false;
    if (/<(use|image|linearGradient|radialGradient|pattern|style|clipPath|mask|filter)\b/i.test(svg)) return false;
    if (/<(rect|circle|ellipse|polygon|polyline|line)\b/i.test(svg)) return false;
    if (/<g\s+[^>]/i.test(svg)) return false; // attributed groups could carry paint/opacity

    var paths = svg.match(/<path\b[^>]*>/gi) || [];
    if (paths.length < 2) return false; // nothing to merge

    var firstFill = null;
    var firstRule = null;
    for (var i = 0; i < paths.length; i++) {
      // Per-path paint/opacity would be lost in a merge.
      if (/\s(?:opacity|fill-opacity|stroke|stroke-width)="/i.test(paths[i])) return false;

      var fillMatch = paths[i].match(/\sfill="([^"]*)"/i);
      var fill = fillMatch ? fillMatch[1] : null;
      if (fill === 'none') return false;              // unfilled path would gain a fill
      if (i === 0) firstFill = fill;
      else if (fill !== firstFill) return false;      // mixed fills cannot share one path

      var ruleMatch = paths[i].match(/\sfill-rule="([^"]*)"/i);
      var rule = ruleMatch ? ruleMatch[1] : 'nonzero';
      if (i === 0) firstRule = rule;
      else if (rule !== firstRule) return false;      // mixed rules resolve holes differently
    }
    return true;
  }

  function mergePaths(svg) {
    if (!canMerge(svg)) return svg;

    var pathTags = svg.match(/<path\b[^>]*>/gi);
    var ds = [];
    for (var i = 0; i < pathTags.length; i++) {
      var dMatch = pathTags[i].match(/\sd="([^"]*)"/i);
      if (dMatch) ds.push(dMatch[1]);
    }
    if (ds.length < 2) return svg;

    // canMerge guarantees fill + fill-rule are uniform — read them off the first path.
    var fillMatch = pathTags[0].match(/\sfill="([^"]*)"/i);
    var ruleMatch = pathTags[0].match(/\sfill-rule="([^"]*)"/i);
    var fill = fillMatch ? ' fill="' + fillMatch[1] + '"' : '';
    var rule = ruleMatch ? ' fill-rule="' + ruleMatch[1] + '"' : '';
    var merged = '<path' + fill + rule + ' d="' + ds.join(' ') + '"/>';

    var result = svg.replace(/<path\b[^>]*>/gi, '').replace(/<\/path>/gi, '');
    return result.replace(/<\/svg>/i, merged + '</svg>');
  }

  //
  //------- STATE -------//
  //

  // Raster ceiling. Beyond this canvas.toBlob starts failing anyway, and nobody needs a
  // 60k-px logo. SVG is vector, but the cap stays universal to keep WYSIWYG simple.
  var MAX_WIDTH = 4096;

  // Bumped by every render. An image copy that resolves after a later render keeps
  // its clipboard contents but not its "Copied!" — see handleCopy.
  var copySession = 0;

  // Normalise once per variant: inline sizing, every fill to currentColor. From there,
  // logo colour is one CSS `color` on the frame — the currentColor pass IS the recolour
  // mechanism. sanitise strips any active content before the markup reaches the DOM.
  var CLEAN_OPTIONS = {
    sanitise: true,
    size: true,
    currentColor: true,
    stripComments: true,
    stripMetadata: true,
    precision: 2
  };

  // The format word each verb carries. JPG copies "as PNG": the clipboard has no
  // JPEG type, so the button says what actually lands there.
  var FORMAT_WORDS = {
    svg: { download: 'SVG', copy: 'SVG' },
    png: { download: 'PNG', copy: 'PNG' },
    jpeg: { download: 'JPG', copy: 'as PNG' }
  };

  var DEFAULTS = {
    variant: null,      // filled from the manifest at init
    width: 300,         // a preset, so the width segment shows a selection on load
    fg: null,           // '#RRGGBB', filled from the manifest at init
    bg: null,           // '#RRGGBB', or null for None: the preview's ground
    exportBg: false,    // Include background: bg goes into the file (JPG always)
    // Preview only. false = the ground is the background, or follows the
    // colour under None; true = the checkerboard. The Transparent switch in
    // the Preview group is this flag. No export reads it.
    transparent: false,
    safeZone: false,    // preview only: Clear space, draws the brand's clear-space rule round the logo
    // Preview only: Fill screen, the logo as large as the stage allows. On when the
    // tool opens, so the drawing is seen whole; choosing a width turns it off
    // (leaveFill), because a chosen size is what the reader then wants to see.
    fill: true,
    format: 'svg',      // svg | png | jpeg
    flatten: true       // svg only: merge all letter paths into one on export
  };

  var params = {};
  var M = null;
  var S = null;
  var stageObserver = null;

  // Whether the preview last fitted the stage. null = not measured yet, which is what
  // suppresses the toast on the first pass. Reset on every entry so a Barba round-trip
  // starts silent rather than toasting off the previous page's state.
  var fitState = null;

  // DOM handles, re-resolved on every entry (Barba hands us a fresh container).
  var el = {};
  // The shared colour control's handles (tool-colour.js): pairs, fg, bg.
  var colour = {};

  //
  //------- MANIFEST VALIDATION -------//
  //
  // The manifest is authored per brand, so an incomplete one is an expected failure
  // rather than an exotic one. Every field the code dereferences unconditionally is
  // checked here, and the message names what is wrong — a brand author reading it should
  // know which key to fix without opening the source.

  function isHex6(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  // The clear-space rule every hub carries (logo-tool-docs.md, "Every hub
  // defines its clear space"): the first variation, the brand's primary, has a
  // clearSpace, and a brand with any clearSpace supplies the glyph X is
  // measured from. A gap is a console warning for whoever sets the hub up,
  // never an empty state: the logo still exports without it.
  function warnClearSpaceGaps() {
    var primary = M.variants[0];
    var anyRule = M.variants.some(function (v) { return v.clearSpace && v.clearSpace.units > 0; });
    if (!(primary.clearSpace && primary.clearSpace.units > 0)) {
      console.warn('[logo-tool] the ' + primary.id + ' variation has no clearSpace: every hub defines its clear space on its primary logo');
    }
    if (anyRule && !(M.clearSpaceGlyph && M.clearSpaceGlyph.markup)) {
      console.warn('[logo-tool] the manifest has no clearSpaceGlyph: every hub supplies the graphic X is measured from');
    }
  }

  function manifestProblem() {
    if (!M || !M.brand || !M.brand.id || !M.brand.name) {
      return 'This brand has not published a logo manifest yet. Add one to turn on self-serve logo exports.';
    }
    if (!M.variants || !M.variants.length || !M.colours || !M.colours.length) {
      return 'This brand’s logo manifest has no variations or no colours yet.';
    }
    var badVariant = M.variants.filter(function (v) { return !v || !v.id || !v.markup; })[0];
    if (badVariant) {
      return 'A logo variation in this brand’s manifest is missing its id or its artwork.';
    }
    // minWidth is dereferenced unguarded downstream (Math.max against it, el.width.min,
    // the announce strings) — an omitted value propagates NaN into params.width and from
    // there into the filename, so it fails here with a name instead.
    var badMinWidth = M.variants.filter(function (v) {
      return typeof v.minWidth !== 'number' || !(v.minWidth > 0);
    })[0];
    if (badMinWidth) {
      return 'A logo variation in this brand’s manifest needs a numeric minWidth.';
    }
    // luminance() parses six-digit hex only; three- or eight-digit would silently produce
    // NaN and surface as a "NaN:1" contrast readout rather than an error.
    var badColour = M.colours.filter(function (c) {
      return !c || !c.id || !isHex6(c.value) || !c.bg || !isHex6(c.bg.value);
    })[0];
    if (badColour) {
      return 'A colour in this brand’s manifest needs a six-digit hex value and a background colour in the same form.';
    }
    return null;
  }

  //
  //------- MANIFEST PREP -------//
  //

  function prepareManifest() {
    M.variants.forEach(function (v) {
      if (v.artwork) return; // memoised: the manifest object survives Barba navigations

      v.artwork = S.processSVG(v.markup, CLEAN_OPTIONS); // as authored (horizontal)

      var vb = v.markup.match(/viewBox="([^"]*)"/i);
      var parts = vb ? vb[1].split(/[\s,]+/) : [];
      v.srcW = parseFloat(parts[2]) || 1;
      v.srcH = parseFloat(parts[3]) || 1;

      // Mergeability is judged on the unrotated artwork — the rotation wrapper is ours,
      // added after any merge, so it never blocks flattening.
      v.mergeable = canMerge(v.artwork);

      // Rotated variants (page-position placements) wrap in a rotate <g> and swap the
      // axes; all geometry downstream reads vbW/vbH.
      v.display = v.rotate ? rotateMarkup(v.artwork, v.rotate, v.srcW, v.srcH) : v.artwork;
      v.vbW = v.rotate ? v.srcH : v.srcW;
      v.vbH = v.rotate ? v.srcW : v.srcH;
    });

    M.colours.forEach(function (c) {
      if (typeof c.ratio === 'number') return;
      c.ratio = contrastRatio(c.value, c.bg.value);
      // Authoring guardrail — 3:1 is the WCAG non-text bar that applies to a logo mark.
      if (c.ratio < 3) {
        console.warn('[logo-tool] colour "' + c.label + '" is below 3:1 on its background (' + c.ratio.toFixed(1) + ':1)');
      }
    });
  }

  // Wrap the artwork in a rotated group and swap the viewBox axes. 90 = clockwise (the
  // top edge faces right, reads top-to-bottom), -90 = anticlockwise. Pure string
  // composition — the path data is never touched, so the rotation survives identically
  // in the preview, the SVG export and the raster export.
  function rotateMarkup(svg, degrees, srcW, srcH) {
    var transform = degrees === 90
      ? 'translate(' + srcH + ' 0) rotate(90)'
      : 'translate(0 ' + srcW + ') rotate(-90)';
    return svg
      .replace(/viewBox="[^"]*"/i, 'viewBox="0 0 ' + srcH + ' ' + srcW + '"')
      .replace(/(<svg[^>]*>)/i, '$1<g transform="' + transform + '">')
      .replace(/<\/svg>\s*$/i, '</g></svg>');
  }

  function currentVariant() {
    return M.variants.filter(function (v) { return v.id === params.variant; })[0] || M.variants[0];
  }

  /* A colour's name for the file and the readout: the manifest's own where
     the hex is one of its logo colours or their backgrounds, then the tools'
     palette, then hex-<hex>, so a hand-picked colour says it is a raw value. So an approved colourway keeps the name it
     always had — off-black, yellow-light — whichever way it was chosen. */
  function colourName(hex) {
    var lower = String(hex).toLowerCase();
    var named = null;
    M.colours.forEach(function (c) {
      if (named) return;
      if (c.value.toLowerCase() === lower) named = { id: c.id, label: c.label || c.id };
      else if (c.bg.value.toLowerCase() === lower) named = { id: c.bg.id, label: c.bg.label || c.bg.id.charAt(0).toUpperCase() + c.bg.id.slice(1) };
    });
    if (named) return named;
    var entry = (colour.palette || []).filter(function (e) { return e.value.toLowerCase() === lower; })[0];
    if (entry) return { id: entry.id, label: entry.label };
    return { id: 'hex-' + lower.replace('#', ''), label: String(hex).toUpperCase() };
  }

  // The colour as a name: "Off black", or "Off white on black" when bg is
  // given — the file's background for the readout and the file name, the
  // preview's ground for the preview's own name.
  function colourLabel(bg) {
    var label = colourName(params.fg).label;
    return bg ? label + ' on ' + colourName(bg).label.toLowerCase() : label;
  }

  // Whether Style's background goes into the file: when Include background
  // is on, and always under JPG, which has no alpha.
  function exportsBackground() {
    return !!params.bg && (params.exportBg || params.format === 'jpeg');
  }

  // The FILE's background: the chosen one when it is included, white under a
  // JPG with None, else none.
  function fileBackground() {
    if (exportsBackground()) return params.bg;
    return params.format === 'jpeg' ? '#FFFFFF' : null;
  }

  // The preview's ground: Style's background whether or not the file takes
  // it, then JPG's white. Null lets the ground follow the logo colour.
  function previewGround() {
    return params.bg || (params.format === 'jpeg' ? '#FFFFFF' : null);
  }

  // The Transparent switch is preview-only: the checkerboard, whatever the
  // background and the format. What the file holds is Include background's.
  function effectiveTransparent() {
    return params.transparent;
  }

  // The safe zone is the brand's clear-space rule (the manifest's clearSpace), drawn
  // round the logo in the preview to show how much room it needs. It applies only where
  // the brand defines the rule: a lockup with no clearSpace gets the switch disabled
  // rather than an invented value. It never changes an export.
  // The brand's clear space in X (--artwork-logo-clear-space, design-system.css §1), so the frame
  // and the drawn zone read the same rule: change the token and both move.
  function clearSpaceMultiple() {
    var n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--artwork-logo-clear-space'));
    return n > 0 ? n : 1;
  }

  function safeZoneUnits() {
    var cs = currentVariant().clearSpace;
    return cs && typeof cs.units === 'number' ? cs.units : 0;
  }

  // A variant whose rule is a placement rather than a ring (the avatar: a canvas,
  // a mask, margins) carries it as an Artwork Layers spec in the manifest's
  // safeZone, drawn in place of the ring. Parsed once; null when it has none or
  // it does not parse, so a bad spec falls back to the ring, not to nothing.
  // Every guide is drawn in the logo's own colour (the frame's currentColor), so it
  // follows the colour swatches and reads wherever the logo does. A spec keeps its
  // geometry, lines and switches; its colours are the Logo Tool's: the outline and
  // the fill both. A zone keeps the opacities the spec gives as numbers (the
  // brand's own strength for that lockup); otherwise it takes the ring's, the area
  // at ZONE_OPACITY and the edge 2.5 times that. Markers are the zone's colour at
  // one strength on every lockup, whatever a spec says (owner, 2026-10-04).
  var ZONE_OPACITY = 0.08;
  var ZONE_OUTLINE_OPACITY = 0.2;
  var MARKER_OPACITY = 0.1;
  var TWO_PAINT = ['zone', 'shape', 'guide', 'grid'];

  function inLogoColour(spec) {
    window.LayerStack.flatLayers(spec).forEach(function (layer) {
      if (!layer.settings || TWO_PAINT.indexOf(layer.type) === -1) return;
      layer.settings.outlineColour = 'currentColor';
      layer.settings.fillColour = 'currentColor';
      if (layer.type === 'zone') {
        if (typeof layer.settings.fillOpacity !== 'number') layer.settings.fillOpacity = ZONE_OPACITY;
        if (typeof layer.settings.outlineOpacity !== 'number') layer.settings.outlineOpacity = ZONE_OUTLINE_OPACITY;
        layer.settings.markerColour = '';
        layer.settings.markerOpacity = MARKER_OPACITY;
      }
    });
    return spec;
  }

  // A logo's own spec, else the brand's clear-space spec (brand.json
  // logos.spec, the manifest's clearSpaceSpec), drawn round every logo that
  // has none of its own and sized to that logo. Neither: the ring below.
  function safeZoneSpecFor(v) {
    var brandSpec = window.LogoManifest && window.LogoManifest.clearSpaceSpec;
    var source = v.safeZone || brandSpec;
    if (!source || !window.LayerStack) return null;
    if (v.parsedSafeZone === undefined) {
      try {
        v.parsedSafeZone = inLogoColour(window.LayerStack.parseSpec(source));
        if (!v.safeZone) {
          var art = zoneArtwork(v);
          if (art) v.parsedSafeZone.reference = { w: art.viewBox.w, h: art.viewBox.h };
          v.parsedSafeZone.specimen = { kind: 'logo', key: v.id };
        }
      } catch (err) {
        console.warn('[logo-tool] the ' + v.id + ' safe zone does not parse: ' + err.message);
        v.parsedSafeZone = null;
      }
    }
    return v.parsedSafeZone;
  }

  // The artwork as the zone reads it — the rotated markup the preview shows, its X,
  // and X's glyph. One read per variant, shared by the holder's placement and the
  // drawn zone, so the two are laid out from the same numbers and cannot drift.
  function zoneArtwork(v) {
    if (!window.LayerStack) return null;
    if (v.zoneArtwork === undefined) {
      var glyph = window.LogoManifest && window.LogoManifest.clearSpaceGlyph ? window.LogoManifest.clearSpaceGlyph.markup : null;
      var units = v.clearSpace && typeof v.clearSpace.units === 'number' ? v.clearSpace.units : 0;
      v.zoneArtwork = window.LayerStack.readArtwork(v.display, units, glyph);
    }
    return v.zoneArtwork;
  }

  function hasSafeZone(v) {
    return !!safeZoneSpecFor(v) || !!(v.clearSpace && v.clearSpace.units > 0);
  }

  //
  //------- CONTRAST — WCAG 2 relative luminance, no dependency -------//
  //

  // Expects six-digit #rrggbb, enforced by manifestProblem() before this ever runs.
  function luminance(hex) {
    var channels = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(a, b) {
    var l1 = luminance(a);
    var l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  //
  //------- GEOMETRY -------//
  //
  // One function owns the export maths, so the filename, the SVG string and the raster
  // canvas all read the same numbers and cannot disagree. The user's Width is the
  // logo's width, and the file is exactly the logo: the safe zone is preview only.

  function exportDims() {
    var v = currentVariant();
    var scale = params.width / v.vbW; // px per viewBox unit
    return {
      fileW: Math.round(params.width),
      fileH: Math.round(v.vbH * scale),
      viewBox: '0 0 ' + v.vbW + ' ' + v.vbH
    };
  }

  // The box the preview draws: the logo, grown by the safe zone on every side while it
  // is shown — or, for a variant with its own spec, that spec's canvas with the logo
  // where the spec places it. w and h in viewBox units; the frame scales them to
  // pixels. holder is the logo's box as fractions of the frame, null with no zone.
  function previewDims() {
    var v = currentVariant();
    var scale = params.width / v.vbW;
    var spec = params.safeZone ? safeZoneSpecFor(v) : null;
    var artwork = spec ? zoneArtwork(v) : null;
    if (spec && artwork) {
      // The frame is everything the spec draws — its canvas, plus a zone or
      // overshoot past it — with the logo placed on its drawn box inside.
      var drawing = window.LayerStack.viewOf(spec, artwork, el.frame);
      var view = drawing.view;
      var art = drawing.ctx.art;
      var k = v.vbW / art.w; // viewBox units per canvas unit
      return {
        w: view.w * k,
        h: view.h * k,
        pxW: Math.round(view.w * k * scale),
        spec: spec,
        holder: { x: (art.x - view.x) / view.w, y: (art.y - view.y) / view.h, w: art.w / view.w }
      };
    }
    var pad = params.safeZone ? safeZoneUnits() * clearSpaceMultiple() : 0;
    var w = v.vbW + 2 * pad;
    var h = v.vbH + 2 * pad;
    return {
      w: w,
      h: h,
      pxW: Math.round(w * scale),
      spec: null,
      holder: pad > 0 ? { x: pad / w, y: pad / h, w: v.vbW / w } : null
    };
  }

  function buildFilename() {
    var ext = params.format === 'jpeg' ? 'jpg' : params.format;
    // The width in the name is the file's width, which is the logo's: the safe
    // zone never reaches the file.
    // The colour piece names the foreground, and the background after "-on-"
    // when the file has one: off-black, off-black-on-white.
    var colourPiece = colourName(params.fg).id + (exportsBackground() ? '-on-' + colourName(params.bg).id : '');
    var stem = ['logo', M.brand.id, params.variant, colourPiece, exportDims().fileW]
      .map(function (piece) { return S.sanitiseName(String(piece)); })
      .join('_');
    return stem + '.' + ext;
  }

  //
  //------- EXPORT -------//
  //
  // The SVG string is the single artefact: downloaded as-is for SVG, rasterised for
  // PNG/JPG. It is always a string we built, so the canvas never taints.

  // Standalone, fully baked SVG: xmlns restored, explicit pixel dimensions, the logo's own
  // viewBox, colours as hex rather than currentColor — so the file renders correctly in
  // Finder, in an <img>, anywhere. Transparent unless the background is included
  // (Include background, or JPG), as a rect; JPG with None gets white at raster time.
  function buildSvgString() {
    var v = currentVariant();
    var dims = exportDims();

    // Merge first (on the unrotated artwork), then apply the rotation wrapper — a
    // flattened rotated export is one path inside one group. Gated to SVG: the
    // raster path consumes the same string but a merge changes nothing in its
    // pixels, and the UI hides the Flatten row for PNG/JPG — the code and the
    // row agree that the concept is SVG-only.
    var svg = (params.format === 'svg' && params.flatten && v.mergeable) ? mergePaths(v.artwork) : v.artwork;
    if (v.rotate) svg = rotateMarkup(svg, v.rotate, v.srcW, v.srcH);

    svg = svg
      .replace(/\s+width="[^"]*"/i, '')   // first match is the root's 100%
      .replace(/\s+height="[^"]*"/i, '')
      .replace(/viewBox="[^"]*"/i, 'viewBox="' + dims.viewBox + '"')
      .replace(/<svg/i, '<svg width="' + dims.fileW + '" height="' + dims.fileH + '"');

    // Case-insensitive: CSS keywords are, so a `currentcolor` fill is the same paint
    // and would otherwise export black with no error.
    svg = svg.replace(/currentcolor/gi, params.fg);

    // An included background is part of the file: a rect under the logo, the
    // size of the view box. Otherwise the file is transparent; a JPG under
    // None gets its white at raster time.
    if (exportsBackground()) {
      var vb = dims.viewBox.split(/\s+/);
      svg = svg.replace(/(<svg[^>]*>)/i, '$1<rect x="' + vb[0] + '" y="' + vb[1] + '" width="' + vb[2] + '" height="' + vb[3] + '" fill="' + params.bg + '"/>');
    }

    // Final pass through the shared engine: standalone re-adds xmlns + the XML
    // declaration, minify collapses whitespace. Width/height are already explicit here,
    // so processSVG leaves them alone.
    return S.processSVG(svg, { standalone: true, minify: true });
  }

  // SVG string -> Image -> canvas at the EXACT export pixels. No devicePixelRatio: the
  // user asked for absolute pixels, unlike a screen canvas.
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
          // JPG belt-and-braces: fill guarantees no alpha edge survives the flatten.
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

  // The rasterise path is async and slow at 4096px: without a gate a double-click
  // launches two canvas chains, two downloads of the same filename or two clipboard
  // writes. The button is held busy (design-system.css, Busy): the ring replaces its
  // label after a moment, aria-busy says so, and a second press waits. Not disabled,
  // because disabling the focused button blurred a keyboard user to <body>. Returns
  // the release.
  function holdButton(button) {
    if (!button) return function () {};
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    return function release() {
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    };
  }

  function isHeld(button) {
    return !!button && (button.disabled || button.classList.contains('is-loading'));
  }

  // The raster's ground: the included background, which the SVG already
  // carries, or white under a JPG with None, because a JPG has no alpha.
  function rasterBackground() {
    return fileBackground();
  }

  function handleExport() {
    if (isHeld(el.exportBtn)) return;
    showError('');

    // Everything derived from params sits inside one guard — exportDims() and
    // buildFilename() share buildSvgString()'s failure modes (bad manifest
    // numbers), and a throw outside the try used to reach the user as nothing
    // at all: no file, no message.
    var svgString, dims, filename;
    try {
      svgString = buildSvgString();
      dims = exportDims();
      filename = buildFilename();
    } catch (error) {
      showError('Couldn’t build that export. Try a different variation.');
      return;
    }

    if (params.format === 'svg') {
      saveBlob(new Blob([svgString], { type: 'image/svg+xml' }), filename);
      return;
    }

    var mimeType = params.format === 'png' ? 'image/png' : 'image/jpeg';
    var release = holdButton(el.exportBtn);

    rasterise(svgString, dims.fileW, dims.fileH, mimeType, rasterBackground())
      .then(function (blob) { release(); saveBlob(blob, filename); })
      .catch(function () { release(); showError('Couldn’t render that export. Try SVG, which always works.'); });
  }

  // Copy. SVG is copy-button.js's job: it reads data-copy synchronously on the same
  // click (syncCopyPayload keeps it filled), so this handler's only SVG duty is to
  // report a payload that failed to build — copy-button.js bails on an empty value
  // and would otherwise leave the click silent.
  //
  // PNG and JPG are rasterised to a PNG blob. The clipboard API has no JPEG type, so
  // JPG copies as a PNG of the same pixels — the background baked in, as the file has it.
  function handleCopy() {
    var button = el.copyBtn;
    if (!button || isHeld(button)) return;
    showError('');

    if (params.format === 'svg') {
      if (!button.getAttribute('data-copy')) showError('Couldn’t build that export. Try a different variation.');
      return;
    }

    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      showError('This browser can’t copy an image. Download it instead.');
      return;
    }

    var svgString, dims;
    try {
      svgString = buildSvgString();
      dims = exportDims();
    } catch (error) {
      showError('Couldn’t build that export. Try a different variation.');
      return;
    }

    var release = holdButton(button);
    var session = copySession;
    var png = rasterise(svgString, dims.fileW, dims.fileH, 'image/png', rasterBackground());

    // The blob goes into ClipboardItem as a promise, not after it resolves: WebKit only
    // honours a write that starts inside the click's activation, and a 4096px raster
    // does not finish inside one. Older Chromium took only a Blob there and throws on
    // a promise synchronously — for it, resolve first, which is all it ever needed.
    var write;
    try {
      write = writeImage(png);
    } catch (error) {
      write = png.then(writeImage);
    }

    write
      .then(function () {
        release();
        // "Copied!" describes the artefact as it was at the click. If a render has
        // landed since, the stage no longer shows what the clipboard holds — the
        // clipboard keeps the copy, the button keeps quiet.
        if (session !== copySession) return;
        // The module's feedback and its one revert timer, so the two copy paths
        // cannot strip each other's "Copied!" early.
        if (window.bdCopyButton) window.bdCopyButton.flash(button);
        announceImageCopied();
      })
      .catch(function () {
        release();
        showError('Couldn’t copy that image in this browser. Download it instead.');
      });
  }

  function writeImage(blobOrPromise) {
    return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blobOrPromise })]);
  }

  // copy-button.js owns the page's one copy live region and announces its own text
  // copies; the image path has to speak for itself or a screen reader hears nothing
  // (WCAG 4.1.3). Same clear-then-set as copy-button.js: writing an identical string
  // is not a mutation, so a second copy in a row would otherwise announce nothing.
  function announceImageCopied() {
    var region = document.getElementById('bd-copy-live');
    if (!region) return;
    region.textContent = '';
    requestAnimationFrame(function () { region.textContent = 'Copied'; });
  }

  //
  //------- CONTROL SURFACES BUILT FROM THE MANIFEST -------//
  //

  // Variation chips: native radios in labels (cms/chip.md), so the group name,
  // the arrow keys and the focus ring come from the component.
  function buildVariantChips() {
    if (!el.variants) return;
    el.variants.innerHTML = M.variants.map(function (v) {
      return '<label class="chip"><input type="radio" name="lt-variant" value="' + escapeHtml(v.id) + '">' +
        '<span>' + escapeHtml(v.shortLabel || v.label || v.id) + '</span></label>';
    }).join('');
  }

  // The tools' one colour control (tool-colour.js; cms/tool-canvas.md,
  // Colour): the brand's approved colourways as the Pairs row — each logo
  // colour on the background it was designed for — then Foreground and
  // Background, each the brand palette with a picker and a hex field.
  // Background is the preview's ground; Include background takes it into the file.
  function buildColourControls() {
    if (!el.pairsMount || !window.ToolColour) return;
    // Read once: colourName() runs several times a render, and every read
    // walks the tokens through getComputedStyle.
    colour.palette = window.ToolColour.readPalette();
    colour.pairs = window.ToolColour.pairs(el.pairsMount, {
      id: 'lt-pair',
      label: 'Pairs',
      min: 3,
      pairs: M.colours.map(function (c) {
        return {
          id: c.id,
          label: (c.label || c.id) + ' on ' + colourName(c.bg.value).label.toLowerCase(),
          fg: c.value,
          bg: c.bg.value
        };
      }),
      onChoose: function handlePair(pair) {
        params.fg = pair.fg;
        params.bg = pair.bg;
        syncColourControls();
        syncExportBackground();
        render();
      }
    });
    colour.fg = window.ToolColour.create(el.fgMount, {
      id: 'lt-fg', label: 'Foreground', value: params.fg, onChange: handleColourChange
    });
    colour.bg = window.ToolColour.create(el.bgMount, {
      id: 'lt-bg', label: 'Background', value: params.bg, none: true, onChange: handleColourChange
    });
    // A rejected hex fires no onChange, but it is still a change Style's
    // reset clears; the field's own change event bubbles here.
    el.fgMount.addEventListener('change', syncSectionResets);
    el.bgMount.addEventListener('change', syncSectionResets);
  }

  // Background decides whether Include background can be on, so a colour
  // change re-syncs that switch and nothing else.
  function handleColourChange() {
    params.fg = colour.fg.get().value;
    params.bg = colour.bg.get().value;
    syncExportBackground();
    render();
  }

  // Controls from params, after a pair, a reset or init.
  function syncColourControls() {
    if (!colour.fg) return;
    colour.fg.set(params.fg);
    colour.bg.set(params.bg);
  }

  // Check the radio whose value matches; uncheck the rest. A value matching none
  // (a custom width) leaves the whole group unchecked, which is the answer.
  function checkRadio(group, value) {
    if (!group) return;
    group.querySelectorAll('input[type="radio"]').forEach(function (radio) {
      radio.checked = radio.value === String(value);
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  //
  //------- CONTROL WIRING -------//
  //

  function wireControls() {
    if (el.variants) {
      el.variants.addEventListener('change', function (event) {
        if (event.target.name !== 'lt-variant') return;
        params.variant = event.target.value;
        injectVariant();
        syncControlState();
        render();
      });
    }

    if (el.width) {
      // Live typing keeps the preview moving without fighting the keystroke. Values
      // outside the allowed range are ignored rather than clamped here — typing "40"
      // on the way to "400" leaves the preview on the last valid width instead of
      // snapping to the minimum — and the change handler reconciles on commit.
      el.width.addEventListener('input', function () {
        var n = parseInt(el.width.value, 10);
        if (isNaN(n) || n < currentVariant().minWidth || n > MAX_WIDTH) return;
        params.width = n;
        leaveFill();
        render();
      });

      // Commit (blur / enter / stepper): reconcile the field and say why.
      el.width.addEventListener('change', function () {
        var v = currentVariant();
        var n = parseInt(el.width.value, 10);
        if (isNaN(n)) {
          el.width.value = params.width; // emptied field — restore the last valid width
          announce('');
        } else if (n < v.minWidth) {
          params.width = v.minWidth;
          el.width.value = v.minWidth;
          announce('Minimum width for the ' + v.label + ' logo is ' + v.minWidth + ' px.');
        } else if (n > MAX_WIDTH) {
          params.width = MAX_WIDTH;
          el.width.value = MAX_WIDTH;
          announce('Maximum export width is ' + MAX_WIDTH + ' px.');
        } else {
          params.width = n;
          announce('');
        }
        // An emptied field restores the last width: no size was chosen.
        if (!isNaN(n)) leaveFill();
        render();
      });
    }

    // A preset is always within range: syncControlState disables any under the
    // variation's minimum, so a checked one needs no clamp.
    if (el.widths) {
      el.widths.addEventListener('change', function (event) {
        if (event.target.name !== 'lt-width-preset') return;
        params.width = parseInt(event.target.value, 10);
        if (el.width) el.width.value = params.width;
        announce('');
        leaveFill();
        render();
      });
    }

    if (el.format) {
      el.format.addEventListener('change', function (event) {
        if (event.target.name !== 'lt-format') return;
        params.format = event.target.value;
        /* A copy error is about the format it was raised for ("this browser
           can't copy an image"); a new format makes it stale, so it goes. */
        showError('');
        syncControlState();
        render();
      });
    }

    bindToggle(el.safeZone, 'safeZone');
    bindToggle(el.flatten, 'flatten');

    bindToggle(el.transparent, 'transparent');
    bindToggle(el.fill, 'fill');
    bindToggle(el.exportBg, 'exportBg');

    if (el.exportBtn) el.exportBtn.addEventListener('click', handleExport);
    if (el.copyBtn) el.copyBtn.addEventListener('click', handleCopy);
    if (el.resetBtn) el.resetBtn.addEventListener('click', handleReset);
    if (el.settingsReset) el.settingsReset.addEventListener('tool:panel-reset', handleSettingsReset);
    if (el.styleReset) el.styleReset.addEventListener('tool:panel-reset', handleStyleReset);
  }

  // Choosing a size ends Fill screen: the preview then shows that size, as
  // large as it fits, and the switch reads off so the reader can see why.
  function leaveFill() {
    if (!params.fill) return;
    params.fill = false;
    if (el.fill) el.fill.checked = false;
  }

  function bindToggle(input, key) {
    if (!input) return;
    input.addEventListener('change', function () {
      params[key] = input.checked;
      render();
    });
  }

  function handleReset() {
    params = Object.assign({}, DEFAULTS, {
      variant: M.variants[0].id,
      fg: M.colours[0].value,
      bg: null
    });
    if (el.width) el.width.value = params.width;
    announce('');
    showError('');
    injectVariant();
    syncControlsFromParams();
    syncColourControls();
    syncControlState();
    render();
  }

  // Re-apply params onto every control after a programmatic change.
  function syncControlsFromParams() {
    checkRadio(el.variants, params.variant);
    if (el.safeZone) el.safeZone.checked = params.safeZone;
    if (el.transparent) el.transparent.checked = params.transparent;
    if (el.fill) el.fill.checked = params.fill;
    if (el.flatten) el.flatten.checked = params.flatten;
    syncExportBackground();
    syncFormat();
  }

  // The segmented control states its own answer; the two verbs repeat it, so
  // a reader never has to look back up the panel to know what a click makes.
  function syncFormat() {
    checkRadio(el.format, params.format);
    var words = FORMAT_WORDS[params.format] || FORMAT_WORDS.svg;
    if (el.exportFormat) el.exportFormat.textContent = words.download;
    if (el.copyFormat) el.copyFormat.textContent = words.copy;
  }

  // Gate contextual controls off the current state. Disable when the concept applies but
  // cannot be used (include background x JPG or None, safe zone x avatar); hide when the concept is
  // genuinely irrelevant (flatten off the SVG format, a colour the variation does not
  // allow). Every disabled state carries a note saying why.
  //
  // FOCUS INVARIANT: this function disables and hides controls, so it must never run
  // while focus is inside one of them. It is reachable from the variation chips, the
  // format control, Reset, the Settings section's reset and init (a section
  // reset's own button holds focus, and tool-canvas.js moves it once disabled). A variation chip and a format option keep focus on
  // themselves, and neither is ever hidden here; Reset lives in the bar's menu. The
  // colour controls call syncExportBackground() alone: the Pairs row thins only on a
  // variation change, so nothing here hides a chip under a live cursor.
  function syncControlState() {
    var v = currentVariant();

    // The floor, said before anyone hits it. A status left over from an earlier
    // clamp is cleared unless this pass clamps again, so it never describes a
    // variation that is no longer chosen.
    if (el.width) {
      el.width.min = v.minWidth;
      if (params.width < v.minWidth) {
        params.width = v.minWidth;
        el.width.value = v.minWidth;
        announce('Minimum width for the ' + v.label + ' logo is ' + v.minWidth + ' px.');
      } else {
        announce('');
      }
    }
    setNote(el.widthHint, 'At least ' + v.minWidth + ' px wide for the ' + (v.label || v.id) + ' logo.');

    // A preset under the floor is disabled rather than clamped after the fact, so
    // the arrow keys skip it and no radio is checked and then unchecked under focus.
    if (el.widths) {
      el.widths.querySelectorAll('input[name="lt-width-preset"]').forEach(function (radio) {
        radio.disabled = parseInt(radio.value, 10) < v.minWidth;
      });
    }

    // The safe zone only where the brand defines the rule. params.safeZone keeps the
    // user's real choice — the same preservation Include background gets below — so
    // Primary → Avatar → Primary does not silently lose it. previewDims() reads an
    // effective zero for a variant with no rule, so the kept flag draws nothing.
    var zoned = hasSafeZone(v);
    if (el.safeZone) {
      el.safeZone.disabled = !zoned;
      el.safeZone.checked = zoned ? params.safeZone : false;
    }
    setNote(el.safeZoneNote, zoned ? '' : 'No clear space is defined for the ' + v.label + ' yet.');

    syncExportBackground();

    // Flatten is an SVG-only concern, and some artwork cannot be merged safely.
    if (el.flattenRow) el.flattenRow.hidden = params.format !== 'svg';
    // Off as well as disabled where the artwork cannot be merged, so the switch never
    // reports a flatten the export will not do. params.flatten keeps the real choice.
    if (el.flatten) {
      el.flatten.disabled = !v.mergeable;
      el.flatten.checked = v.mergeable && params.flatten;
    }
    setNote(el.flattenNote, v.mergeable ? '' : 'This artwork can’t be flattened safely, so it exports as drawn.');

    // Optional per-colour allow-list: a colourway the brand does not approve
    // on this artwork leaves the Pairs row. The colours themselves stay free —
    // Foreground and Background take the whole palette and any hex.
    if (colour.pairs) {
      colour.pairs.available(function (pair) {
        var c = M.colours.filter(function (entry) { return entry.id === pair.id; })[0];
        return !c || !c.variants || c.variants.indexOf(params.variant) !== -1;
      });
    }

    syncFormat();
  }

  // Include background: disabled where it cannot choose — under JPG, which
  // always carries a background (on), and under None, which has none to
  // carry (off) — with the reason in its note. params.exportBg keeps the
  // reader's real choice and returns with SVG or PNG and a colour. Its own
  // function because a colour change needs this and nothing else in
  // syncControlState; the switch is in Export, never under the cursor of a
  // colour control or the format control that changes it.
  function syncExportBackground() {
    if (!el.exportBg) return;
    var isJpeg = params.format === 'jpeg';
    el.exportBg.disabled = isJpeg || !params.bg;
    el.exportBg.checked = exportsBackground();
    setNote(el.exportBgNote, isJpeg
      ? 'JPG has no transparency, so the background is always in the file' + (params.bg ? '.' : ', white under None.')
      : !params.bg ? 'Choose a background in Style to include it.' : '');
  }

  // These notes are aria-describedby targets, not live regions. An element that is
  // hidden when its text is written cannot announce as one, and describedby reads
  // directly-referenced hidden nodes — so the description is the reliable channel.
  function setNote(node, message) {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  // The single polite status region. Written only on committed changes — never on a
  // keystroke — so it does not queue an announcement per character typed.
  function announce(message) {
    writeLive(el.sizeNote, message);
  }

  // The error line sits over the verbs, in the dock: a folded dock is
  // display: none, where an alert is never announced, so it unfolds first.
  function showError(message) {
    if (message && el.dock && el.dock.classList.contains('is-collapsed') && el.dockToggle) { el.dockToggle.click(); }
    writeLive(el.error, message);
  }

  // Clear, then set on the next frame: writing the text a region already holds is
  // not a mutation, so the same message twice in a row — a second clamp, an error
  // raised again — would otherwise announce nothing. A pending write is cancelled
  // first, so a clear that lands in the same frame wins. Empty is '' and never ' ',
  // which the CSS :empty collapse depends on.
  function writeLive(node, message) {
    if (!node) return;
    if (node.bdLiveFrame) cancelAnimationFrame(node.bdLiveFrame);
    node.bdLiveFrame = 0;
    node.textContent = '';
    if (!message) return;
    node.bdLiveFrame = requestAnimationFrame(function () {
      node.bdLiveFrame = 0;
      node.textContent = message;
    });
  }

  //
  //------- STAGE -------//
  //
  // WYSIWYG render. The SVG is injected once per variant switch; colour, size,
  // background and safe zone are pure CSS after that.

  function injectVariant() {
    var v = currentVariant();
    el.holder.innerHTML = v.display;
    el.holder.style.aspectRatio = v.vbW + ' / ' + v.vbH;
    describeHolder();
  }

  // The preview shows variation, colour and safe zone; the accessible name should say
  // the same, since none of it is conveyed by the injected artwork itself.
  function describeHolder() {
    if (!el.holder) return;
    var v = currentVariant();
    var parts = [M.brand.name + ' logo', v.label || v.id, colourLabel(effectiveTransparent() ? null : params.bg)];
    if (effectiveTransparent()) parts.push('on a transparent background');
    if (params.safeZone && hasSafeZone(v)) parts.push('with its clear space shown');
    el.holder.setAttribute('aria-label', parts.join(' — '));
  }

  // The clear-space rule drawn by the shared engine (assets/js/layer-stack.js):
  // a zone outside the logo by --artwork-logo-clear-space X, in the logo's own colour,
  // over a frame the same size as the zone's outer edge. Preview only: no file
  // carries it.
  var safeZoneSpec = null;

  function renderSafeZone(v, box) {
    var existing = el.frame.querySelector('.tool-guides');
    if (!box.holder || !window.LayerStack) {
      if (existing) existing.remove();
      return;
    }
    var overlay = existing || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'tool-guides');
    overlay.setAttribute('aria-hidden', 'true');
    if (!existing) el.frame.appendChild(overlay);
    if (!safeZoneSpec) {
      var LS = window.LayerStack;
      safeZoneSpec = LS.createSpec('blank');
      safeZoneSpec.canvas.fit = 'fit-artwork';
      safeZoneSpec.layers.push(LS.createLayer('zone.clear-space', {
        settings: { outlineColour: 'currentColor', outlineOpacity: ZONE_OUTLINE_OPACITY, fillColour: 'currentColor', fillOpacity: ZONE_OPACITY, markerOpacity: MARKER_OPACITY, lineStyle: 'dashed' }
      }));
    }
    var artwork = zoneArtwork(v);
    if (!artwork) { overlay.remove(); return; }
    // A variant's own spec keeps its own reference; the ring is sized to the logo.
    if (!box.spec) safeZoneSpec.reference = { w: artwork.viewBox.w, h: artwork.viewBox.h };
    window.LayerStack.render(overlay, box.spec || safeZoneSpec, { artwork: artwork, overlayOnly: true, scope: el.frame });
  }

  function render() {
    var v = currentVariant();
    var box = previewDims();
    var transparent = effectiveTransparent();
    var ground = previewGround();

    // Logo colour on the frame — the inline SVG (currentColor) and the safe-zone
    // guides both inherit it.
    el.frame.style.color = params.fg;

    // The ground. Three cases, one at a time:
    //  - Transparent on: the canvas's checkerboard, whatever the colour.
    //  - A background (chosen in Style, or JPG's white): painted inline,
    //    because it is the reader's value rather than a token. Shown whether
    //    or not Include background puts it in the file.
    //  - Otherwise the ground follows the foreground: the dark preview ground
    //    behind a light logo, the light one behind the rest (data-logo-ground,
    //    painted in logo-tool.css). 0.1791 is where white and black text
    //    contrast equally against a colour.
    var light;
    if (transparent) {
      el.stage.setAttribute('data-ground', 'checker');
      el.stage.removeAttribute('data-logo-ground');
      el.stage.style.backgroundColor = '';
    } else if (ground) {
      el.stage.removeAttribute('data-ground');
      el.stage.removeAttribute('data-logo-ground');
      el.stage.style.backgroundColor = ground;
      light = luminance(ground) > 0.1791;
    } else {
      el.stage.removeAttribute('data-ground');
      light = luminance(params.fg) <= 0.1791;
      el.stage.setAttribute('data-logo-ground', light ? 'light' : 'dark');
      el.stage.style.backgroundColor = '';
    }
    // The corners have no surface of their own, so they take the ink that reads on
    // the ground: dark on the checkerboard and on light grounds, light on dark ones.
    el.stage.setAttribute('data-preview-ink', transparent || light ? 'dark' : 'light');
    // The band's text and switches take the logo's colour wherever it reads as text
    // on this ground (tool-canvas.js); a light logo on the checkerboard does not,
    // and keeps the plain ink.
    if (window.ToolPreview) window.ToolPreview.syncInk(el.stage, params.fg);

    // The frame is the logo at true pixel size — plus its safe zone while that is
    // shown — scaled down to fit the stage on both axes by CSS (see the note on
    // .tool-artwork). The script gives only the true width and the ratio. Safe
    // zone: the holder is placed on the logo's box within the zone — pure
    // percentages, so CSS scaling cannot drift.
    el.frame.style.setProperty('--tool-artwork-width', box.pxW + 'px');
    el.frame.style.setProperty('--tool-artwork-ratio', String(box.w / box.h));
    // Fill screen: the frame takes the stage's full size instead (logo-tool.css).
    el.frame.toggleAttribute('data-fill', !!params.fill);
    var placed = box.holder;
    el.holder.style.width = placed ? (placed.w * 100) + '%' : '100%';
    el.holder.style.left = placed ? (placed.x * 100) + '%' : '';
    el.holder.style.top = placed ? (placed.y * 100) + '%' : '';
    el.holder.toggleAttribute('data-placed', !!placed);
    renderSafeZone(v, box);

    if (el.filename) el.filename.value = buildFilename();
    // The readout's first lines: which logo, in which colour. The full names — the
    // chips carry the short ones, and this corner names the file.
    if (el.readVariant) el.readVariant.textContent = v.label || v.id;
    // The file's colour: the background is named only when the file has it.
    if (el.readColour) el.readColour.textContent = colourLabel(exportsBackground() ? params.bg : null);

    describeHolder();
    if (colour.pairs) colour.pairs.sync(params.fg, params.bg);
    // Against the ground the logo is shown on, so JPG's white counts; None on
    // SVG or PNG has none and the line stays empty.
    if (window.ToolColour) window.ToolColour.contrast(el.contrast, params.fg, ground, 3);
    checkRadio(el.widths, params.width);
    syncSectionResets();
    syncCopyPayload();
    announceFit(updateStageMetrics());
  }

  // The two shaping sections' defaults. Settings is which logo: the
  // manifest's first variation. Style is how it looks: the manifest's first
  // logo colour on no background, a transparent file. The width is the
  // export's size and sits in Export, which has no reset (tool-canvas.md,
  // Section reset); Reset all puts it back.
  function settingsDefault() {
    return M.variants[0].id;
  }

  // The variation's allow-list only thins the Pairs row; Foreground and
  // Background stay free, so the default is the same for every variation.
  function styleDefault() {
    return { fg: M.colours[0].value, bg: null };
  }

  // Each section's reset is there always and live only while something in
  // it differs from its default (tool-canvas.js, Section reset).
  function syncSectionResets() {
    if (el.settingsReset) el.settingsReset.disabled = params.variant === settingsDefault();
    if (el.styleReset) {
      var style = styleDefault();
      el.styleReset.disabled = params.fg.toLowerCase() === style.fg.toLowerCase()
        && params.bg === style.bg
        // A bad hex typed over the default is a change the reset clears.
        && !(colour.fg && (colour.fg.isDirty() || colour.bg.isDirty()));
    }
  }

  // Settings only: the variation back to the default. A width under its
  // floor rises to it; the colour, the format, the preview switches and the
  // export's own choices stay.
  function handleSettingsReset() {
    params.variant = settingsDefault();
    showError('');
    injectVariant();
    syncControlsFromParams();
    syncControlState();
    render();
    // Said in a toast, not the width's status line, where it would linger
    // after the next change. The toast also announces, politely.
    if (typeof window.showToast === 'function') window.showToast('Settings reset to their defaults.');
  }

  // Style only: Foreground and Background back to the default. Background
  // decides whether Include background can be on, so that switch re-syncs too.
  function handleStyleReset() {
    var style = styleDefault();
    params.fg = style.fg;
    params.bg = style.bg;
    showError('');
    syncColourControls();
    syncExportBackground();
    render();
    if (typeof window.showToast === 'function') window.showToast('Style reset to its defaults.');
  }

  // Copy's SVG path runs through copy-button.js, which reads data-copy synchronously at
  // click time — so the attribute is refreshed on every render rather than built on
  // demand. Empty for PNG/JPG: copy-button.js bails on an empty value and handleCopy
  // takes the image path instead (the same split the Icon Library strip uses). A
  // build failure leaves it empty too, which handleCopy turns into a message. Any
  // "Copied!" still showing is cleared: after a change it describes something the
  // clipboard no longer holds.
  function syncCopyPayload() {
    copySession++;
    if (!el.copyBtn) return;
    var payload = '';
    if (params.format === 'svg') {
      try { payload = buildSvgString(); } catch (error) { payload = ''; }
    }
    el.copyBtn.setAttribute('data-copy', payload);
    if (window.bdCopyButton) window.bdCopyButton.reset(el.copyBtn);
  }

  // Reads the RENDERED frame size (after the CSS fit-scaling) so the honesty note and
  // the safe-zone ring thickness stay correct, and reports whether the preview is at
  // true size. Read-only with respect to layout — it never sizes the frame, which is
  // what keeps it safe to call from a ResizeObserver. Driven by an observer on the stage
  // rather than a window resize listener, because the stage also changes width when the
  // docs sidebar collapses — a grid-template change that fires no resize event.
  //
  // Returns null when it could not measure, so a caller cannot mistake "not measured"
  // for "does not fit".
  function updateStageMetrics() {
    if (!M || !el.frame) return null;   // M can be null on a later empty-state entry
    // The laid-out width, not the bounding box: a Barba arrival scales the
    // container, and a transform fires no resize to correct the note after.
    var rect = { width: parseFloat(window.getComputedStyle(el.frame).width) || 0 };
    if (!rect.width) return null;       // detached or not yet laid out

    var dims = exportDims();
    var box = previewDims();
    // The scale is the LOGO's, measured off the frame: with the safe zone shown the
    // frame is wider than the logo by the zone on each side, and the export is the
    // logo alone. Integer percent drives both the wording and the toast, so the note
    // can never read "Shown at 100% · exports at ..." — one number, one decision.
    var logoPx = rect.width * (currentVariant().vbW / box.w);
    var pct = Math.round(logoPx / dims.fileW * 100);
    var fits = pct >= 100;

    // The readout's last line, the file's size, and the scale note at the band's foot,
    // whether the frame shows it at that size. The size is one unbroken run (no-break spaces), so a narrow
    // corner never splits "300 × 144 px".
    if (el.readSize) el.readSize.textContent = dims.fileW + '\u00a0×\u00a0' + dims.fileH + '\u00a0px';
    // Fill screen enlarges past 100%, so the note says by how much, as QR's does.
    // Rounding can read 101 at true size, so actual size is fits without Fill.
    if (el.scaleNote) el.scaleNote.textContent = (!params.fill && fits) || pct === 100 ? 'Shown at actual size' : 'Shown at ' + pct + '%';

    return fits;
  }

  // One toast on the way out of fitting, and nothing until it fits again. The note above
  // is the always-on readout; this is only the moment of crossing, because the width
  // field renders on every keystroke and a toast per render would fire four times while
  // someone types "4096". The first pass after init records the state without speaking:
  // a toast on page load is noise, and the note already says the same thing.
  //
  // Deliberately carries no dimensions. A toast lives ~4s while the width field keeps
  // rendering, so a size baked into it is stale the moment the next digit lands — the
  // first build read "the file is still 400 × 757 px" beside a note reading 4096 × 7749.
  // The note is the live figure; this only says the threshold was crossed.
  //
  // Called from render() only, never from the resize path. A person changing the
  // variation or the width wants telling; someone dragging a window edge across the
  // boundary does not, and the observer's first delivery lands after the initial render
  // with a possibly different measurement — which would toast on page load.
  // null (not measured) is not a crossing, so it records and stays quiet.
  function announceFit(fits) {
    if (fits === null) return;
    if (fitState === true && fits === false && typeof window.showToast === 'function') {
      window.showToast('Preview scaled down to fit. The exported file is unaffected.', 'info');
    }
    fitState = fits;
  }

  // Observing the box the frame fits in, rather than the window, covers every way its
  // size can change: window resize, sidebar collapse, browser zoom, and on a phone the
  // corner under it wrapping onto another line — which shrinks the box without the
  // preview changing size at all. It also stops firing on its own once the container leaves the
  // DOM, which a window listener never does. Disconnecting first means a Barba
  // round-trip cannot accumulate observers.
  function observeStage() {
    if (stageObserver) {
      stageObserver.disconnect();
      stageObserver = null;
    }
    if (typeof ResizeObserver !== 'function' || !el.viewport) return;
    stageObserver = new ResizeObserver(function () { updateStageMetrics(); });
    stageObserver.observe(el.viewport);
  }

  //
  //------- INIT -------//
  //

  function resolveElements(root) {
    el = {
      root: root,
      viewport: root.querySelector('#lt-viewport'),
      frame: root.querySelector('#lt-frame'),
      holder: root.querySelector('#lt-holder'),
      scaleNote: root.querySelector('#lt-scale-note'),
      readVariant: root.querySelector('#lt-readout-variant'),
      readColour: root.querySelector('#lt-readout-colour'),
      readSize: root.querySelector('#lt-readout-size'),
      sizeNote: root.querySelector('#lt-size-note'),
      filename: root.querySelector('#lt-filename'),
      error: root.querySelector('#lt-error'),
      empty: root.querySelector('#lt-empty'),
      dock: root.querySelector('#lt-dock'),
      dockToggle: root.querySelector('.tool-dock-toggle'),
      stage: root.querySelector('#lt-stage'),
      variants: root.querySelector('#lt-variants'),
      width: root.querySelector('#lt-width'),
      widthHint: root.querySelector('#lt-width-hint'),
      widths: root.querySelector('#lt-widths'),
      pairsMount: root.querySelector('#lt-pairs'),
      fgMount: root.querySelector('#lt-fg'),
      bgMount: root.querySelector('#lt-bg'),
      contrast: root.querySelector('#lt-contrast'),
      safeZone: root.querySelector('#lt-safezone'),
      fill: root.querySelector('#lt-fill'),
      safeZoneNote: root.querySelector('#lt-safezone-note'),
      transparent: root.querySelector('#lt-transparent'),
      exportBg: root.querySelector('#lt-export-bg'),
      exportBgNote: root.querySelector('#lt-export-bg-note'),
      flatten: root.querySelector('#lt-flatten'),
      flattenRow: root.querySelector('#lt-flatten-row'),
      flattenNote: root.querySelector('#lt-flatten-note'),
      format: root.querySelector('#lt-format'),
      copyBtn: root.querySelector('#lt-copy'),
      copyFormat: root.querySelector('#lt-copy-format'),
      exportBtn: root.querySelector('#lt-export'),
      exportFormat: root.querySelector('#lt-export-format'),
      resetBtn: root.querySelector('#lt-reset'),
      settingsReset: root.querySelector('#lt-settings-reset'),
      styleReset: root.querySelector('#lt-style-reset')
    };
  }

  // A state class rather than [hidden] on the flex children: init runs inside Barba's
  // afterEnter, and toggling an in-flow element's display while a transition is settling
  // is the reflow-flash pattern this repo avoids.
  function showEmptyState(message) {
    if (el.root) el.root.classList.add('is-empty');
    // The canvas frees the dock's column only for .is-hidden on the dock
    // (tools.css, Docks); the empty state then takes the whole width.
    if (el.dock) el.dock.classList.add('is-hidden');
    if (!el.empty) return;
    el.empty.hidden = false;
    var body = el.empty.querySelector('[data-empty-message]');
    if (body) body.textContent = message;
  }

  // Called on every bd:after-nav, including arrivals at pages with no logo tool — which
  // is what releases the observer after the user navigates away.
  function releaseStage() {
    if (stageObserver) {
      stageObserver.disconnect();
      stageObserver = null;
    }
    el = {};
    colour = {};
    M = null;
    fitState = null;
  }

  function initLogoTool() {
    var root = document.getElementById('logo-tool');
    if (!root) { releaseStage(); return; }     // tool not on this page
    if (root.dataset.logoToolInit) return;     // already wired this container
    root.dataset.logoToolInit = 'true';

    resolveElements(root);

    S = window.SvgCleaner;
    M = window.LogoManifest;

    if (!S) {
      M = null;
      showEmptyState('The SVG engine did not load. Reload the page, and if it keeps happening tell the studio.');
      return;
    }

    var problem = manifestProblem();
    if (problem) {
      M = null;
      showEmptyState(problem);
      return;
    }
    warnClearSpaceGaps();

    if (!el.viewport || !el.frame || !el.holder || !el.stage) {
      M = null;
      showEmptyState('The logo tool could not start — its markup is incomplete on this page.');
      return;
    }

    // Authored manifest data is the realistic source of a surprise, and the empty
    // state is a better outcome than a dead tool.
    try {
      prepareManifest();

      params = Object.assign({}, DEFAULTS, {
        variant: M.variants[0].id,
        fg: M.colours[0].value,
        bg: null
      });

      // A browser can restore the field's last value on reload; the field
      // shows what the file will be, so it starts from the param.
      if (el.width) el.width.value = params.width;
      buildVariantChips();
      buildColourControls();
      wireControls();
      syncControlsFromParams();
      syncControlState();
      injectVariant();
      render();
      observeStage();
    } catch (error) {
      console.error('[logo-tool] init failed', error);
      M = null;
      releaseStage();
      resolveElements(root);
      showEmptyState('This brand’s logo manifest could not be read. Check its variations and colours.');
      return;
    }

    console.log('[logo-tool] init');
  }

  window.initLogoTool = initLogoTool;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initLogoTool bails when its markup is absent.
  function startLogoTool() {
    initLogoTool();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startLogoTool);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLogoTool);
  } else {
    startLogoTool();
  }
})();
