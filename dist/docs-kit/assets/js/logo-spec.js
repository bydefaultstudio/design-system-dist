/**
 * logo-spec.js - a brand logo drawn with its Layout Spec, for a guide page.
 *
 * The Brand Book's clear-space figures come from the same data as the Logo
 * Tool (Erlen, 2026-11-10): the logo's artwork and measured X from the logo
 * manifest (generated from brand.json), drawn with its Layout Spec by the
 * shared layer engine (layer-stack.js). A guide can't disagree with the tool,
 * because neither holds a number of its own.
 *
 * Markup, written by the docs kit from {{logo-spec:<variant id>}}:
 *   <figure class="logo-spec" data-logo-spec="primary">
 *     <div class="logo-spec-stage"></div>
 *     <figcaption class="logo-spec-caption">…</figcaption>
 *   </figure>
 *
 * The spec is the logo's own, else the brand's (logos.spec, clearSpaceSpec),
 * else a plain ring of the clear space, drawn as the Logo Tool's Clear space
 * switch draws one. Needs layer-stack.js and
 * the logo manifest on the page; without them the figure says what is missing.
 * Self-registers on DOMContentLoaded and bd:after-nav; a figure is drawn once.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var FIGURE = '[data-logo-spec]';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function variantFor(manifest, id) {
    var list = manifest && Array.isArray(manifest.variants) ? manifest.variants : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  // The figure draws exactly what the Logo Tool's Clear space switch draws
  // (logo-tool.js, safeZoneSpecFor and renderSafeZone), so the two can't
  // disagree. Kept in step with it by hand: the opacities, the recolour and
  // the plain ring a brand with no spec gets.
  var ZONE_OPACITY = 0.08;
  var ZONE_OUTLINE_OPACITY = 0.2;
  var MARKER_OPACITY = 0.1;
  var TWO_PAINT = ['zone', 'shape', 'guide', 'grid'];

  // Every guide in the logo's own colour, as the Logo Tool draws it
  function inLogoColour(LS, spec) {
    LS.flatLayers(spec).forEach(function recolour(layer) {
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

  function plainRing(LS) {
    var spec = LS.createSpec('blank');
    spec.canvas.fit = 'fit-artwork';
    spec.layers.push(LS.createLayer('zone.clear-space', {
      settings: { outlineColour: 'currentColor', outlineOpacity: ZONE_OUTLINE_OPACITY, fillColour: 'currentColor', fillOpacity: ZONE_OPACITY, markerOpacity: MARKER_OPACITY, lineStyle: 'dashed' }
    }));
    return spec;
  }

  // The spec this logo is drawn with: its own, else the brand's, else the
  // plain ring, sized to its own artwork unless it is the logo's own.
  function specFor(LS, manifest, variant, artwork) {
    var own = variant.safeZone;
    var source = own || manifest.clearSpaceSpec;
    var spec = source ? inLogoColour(LS, LS.parseSpec(source)) : plainRing(LS);
    if (!own) {
      spec.reference = { w: artwork.viewBox.w, h: artwork.viewBox.h };
      spec.specimen = { kind: 'logo', key: variant.id };
    }
    return spec;
  }

  // Every fill and stroke to currentColor, as the Logo Tool normalises a
  // logo, so the figure takes the text colour in light and dark: attributes
  // in either quote, and the same two in a style attribute. A logo file is
  // paths only (the build refuses masks), so no knockout is lost.
  function inTextColour(markup) {
    return String(markup)
      .replace(/\s(fill|stroke)=("|')(?!none\2)[^"']*\2/gi, ' $1="currentColor"')
      .replace(/(\b(?:fill|stroke)\s*:\s*)(?!none\b)[^;"']+/gi, '$1currentColor');
  }

  function multiple() {
    var n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--artwork-logo-clear-space'));
    return n > 0 ? n : 1;
  }

  function trim(n) {
    return String(Math.round(n * 100) / 100);
  }

  function fail(figure, message) {
    var caption = figure.querySelector('.logo-spec-caption');
    if (caption) caption.textContent = message;
    figure.setAttribute('data-logo-spec-state', 'failed');
  }

  function draw(figure) {
    if (figure.getAttribute('data-logo-spec-state')) return;
    var id = figure.getAttribute('data-logo-spec');
    var LS = window.LayerStack;
    var manifest = window.LogoManifest;
    if (!LS || !manifest) {
      fail(figure, 'This figure needs the logo manifest and layer-stack.js on the page.');
      console.warn('[logo-spec] ' + (!LS ? 'layer-stack.js' : 'the logo manifest') + ' is not loaded');
      return;
    }
    var variant = variantFor(manifest, id);
    if (!variant) {
      fail(figure, 'There is no logo "' + id + '" in this brand.');
      return;
    }
    var units = variant.clearSpace && variant.clearSpace.units > 0 ? variant.clearSpace.units : 0;
    var glyph = manifest.clearSpaceGlyph ? manifest.clearSpaceGlyph.markup : null;
    var artwork = LS.readArtwork(inTextColour(variant.markup), units, glyph);
    if (!artwork) {
      fail(figure, 'The ' + variant.label + ' artwork could not be read.');
      return;
    }
    var spec;
    try {
      spec = specFor(LS, manifest, variant, artwork);
    } catch (err) {
      fail(figure, 'The ' + variant.label + ' Layout Spec does not parse: ' + err.message);
      return;
    }

    var stage = figure.querySelector('.logo-spec-stage');
    if (!stage) {
      fail(figure, 'This figure is missing its drawing area. Rebuild the page.');
      return;
    }
    var brandName = manifest.brand && manifest.brand.name ? manifest.brand.name + ' ' : '';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', brandName + variant.label + ', with its clear space');
    stage.textContent = '';
    stage.appendChild(svg);
    try {
      // render() sets the svg's viewBox to everything it draws
      LS.render(svg, spec, { artwork: artwork, scope: figure });
    } catch (err) {
      stage.textContent = '';
      fail(figure, 'The ' + variant.label + ' clear space could not be drawn: ' + err.message);
      console.error('[logo-spec] ' + variant.id + ': ' + err.message);
      return;
    }

    var caption = figure.querySelector('.logo-spec-caption');
    if (caption && !caption.textContent.trim() && units) {
      var label = variant.clearSpace.label || 'X';
      // A logo's own spec states its own rule; only the shared one is N X round
      caption.textContent = variant.label + '. X is ' + label + ', ' + trim(units) + ' units in this logo. '
        + (variant.safeZone ? 'Drawn with this logo\'s own Layout Spec.' : 'The clear space is ' + trim(multiple()) + ' X on every side.');
    }
    figure.setAttribute('data-logo-spec-state', 'drawn');
  }

  function initLogoSpecs(scope) {
    var root = scope && scope.querySelectorAll ? scope : document;
    var figures = root.querySelectorAll(FIGURE);
    for (var i = 0; i < figures.length; i++) draw(figures[i]);
  }

  function onAfterNav(event) {
    initLogoSpecs(event && event.detail && event.detail.container ? event.detail.container : document);
  }

  console.log('[logo-spec] v' + VERSION + ' loaded');
  document.addEventListener('DOMContentLoaded', function onReady() { initLogoSpecs(document); });
  document.addEventListener('bd:after-nav', onAfterNav);
  window.initLogoSpecs = initLogoSpecs;
})();
