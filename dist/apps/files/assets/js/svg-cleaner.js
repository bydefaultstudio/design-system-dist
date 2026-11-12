/**
 * svg-cleaner.js — SVG Cleaner browser UI
 * Loaded globally; starts itself on initial load and after every Barba
 * navigation, and exposes window.initSvgCleaner.
 *
 * UI wiring only — all SVG processing comes from the shared engine in
 * assets/js/vendor/svg-cleaner-core.js (window.SvgCleaner), a synced copy
 * of @bydefaultstudio/svg-cleaner refreshed on npm install. Never add
 * processing logic here; it belongs in the package repo.
 *
 * On the tool canvas (cms/tool-canvas.md, Docks): the cleaned SVG drawn in
 * the preview as an <img> from a Blob URL with the byte readout in its
 * Details corner; the pasted code, the format with its name field and CSS
 * shape, and the options in Settings; the result in Export; and the verbs
 * at the dock's foot. Every change cleans again, in every format — Image
 * included, whose Download then writes the result that is already showing.
 *
 * 5.0.0: onto docks. The format is a radio group in Export, with SVG — the
 * plain clean — as a segment of its own in place of the bar's deselectable
 * mode; Settings carries its own reset, which leaves the pasted code alone.
 * 5.1.0: the band starts on the light ground, with a Preview group of two
 * switches — Transparent (the checkerboard) and Artboard (the SVG's own box
 * as a dotted line). The frame is sized to that box so the line sits on it.
 * 5.2.0: the format moves to the top of Settings, above the options it
 * locks (owner, 2026-10-05), and the Settings reset puts it back to SVG
 * with the CSS shape; the safe zone switch is gone (owner: not needed).
 * 5.3.0: Fill screen joins the Preview group, as in the QR Code Generator,
 * Icon Library and Logo Tool: off, the drawing is shown at its own size
 * (its width, or its viewBox's), scaled down to fit; on, as large as the
 * stage allows. A scale note at the band's foot says which.
 * @version 5.4.0
 */

(function () {
  'use strict';

  console.log('[SVG Cleaner] v5.4.0 loaded');

  // The frame's ratio when the SVG declares no box: a browser draws such an
  // image at 300 × 150.
  var DEFAULT_RATIO = 2;
  var DEFAULT_WIDTH = 300;

  var STATUS_DELAY_MS = 50;
  // The readout after typing waits for the typing to stop; a status line
  // that speaks on every keystroke is noise.
  var READOUT_DEBOUNCE_MS = 800;
  // The CLI's own ceiling, so the browser refuses the same paste it does.
  var MAX_INPUT_BYTES = (typeof SvgCleaner !== 'undefined' && SvgCleaner.MAX_INPUT_BYTES) || 2 * 1024 * 1024;

  var EMPTY_TEXT = 'Paste SVG code to see it here.';
  var UNDRAWN_TEXT = 'That did not draw as an SVG. The result is still in Export.';
  var NOTHING_TEXT = 'Nothing cleaned yet.';

  // What each format decides for the user, shown under the options it locks.
  var LOCK_HINTS = {
    icon: 'Icon sets size, currentColor and comments.',
    logo: 'Logo sets size, currentColor and comments.',
    image: 'Image sets size and currentColor.',
    css: 'CSS sets currentColor.'
  };

  // What each format gives, under the format control.
  var FORMAT_NOTES = {
    svg: 'The cleaned code, with the options as set.',
    icon: 'The code inside the .svg-icn wrapper the design system’s icons use.',
    logo: 'The code inside the .svg-icn wrapper, named as a logo.',
    image: 'A standalone .svg file with its namespace, for an <img> or a download.',
    css: 'A data URI in the CSS shape chosen below.'
  };

  var el = {};
  var previewUrl = null;
  var statusTimer = null;
  var readoutTimer = null;
  var stageObserver = null;
  // Preview only: what the band shows, never what the result holds.
  var preview = { transparent: false, artboard: false, fill: false };

  //
  //------- Format -------//
  //

  // The engine's modes, or null for the plain clean: SVG is the format that
  // sets no mode.
  function getActiveMode() {
    var checked = el.root.querySelector('input[name="svg-cleaner-format"]:checked');
    var value = checked ? checked.value : 'svg';
    return value === 'svg' ? null : value;
  }

  function setMode(mode) {
    var input = el.root.querySelector('input[name="svg-cleaner-format"][value="' + (mode || 'svg') + '"]');
    if (input) input.checked = true;
  }

  function formatLabel(mode) {
    var checked = el.root.querySelector('input[name="svg-cleaner-format"][value="' + (mode || 'svg') + '"]');
    var label = checked && checked.closest('label');
    return label ? label.textContent.trim() : 'SVG';
  }

  function updateContext() {
    var mode = getActiveMode();
    el.groupIconName.classList.toggle('is-hidden', mode !== 'icon');
    el.groupLogoName.classList.toggle('is-hidden', mode !== 'logo');
    el.groupImageFilename.classList.toggle('is-hidden', mode !== 'image');
    el.cssShape.classList.toggle('is-hidden', mode !== 'css');
    el.formatNote.textContent = FORMAT_NOTES[mode || 'svg'];
  }

  // Names a hint in the control's own aria-describedby while on, and drops
  // it while off. The fieldset carries the hint as well, but VoiceOver often
  // skips a fieldset's description when focus lands on a control.
  function describe(input, id, on) {
    var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (x) { return x && x !== id; });
    if (on) ids.push(id);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }

  // An option a format locked goes back to its default when the lock
  // lifts: the locked value was the format's, not the reader's, and left in
  // place it read as a change the Settings reset could undo.
  function unlock(input) {
    if (input.disabled) input.checked = input.defaultChecked;
    input.disabled = false;
  }

  // Native disabled only: the system styles a disabled toggle, and a
  // disabled input is already out of the tab order and the pointer's reach.
  function applyLocks() {
    var mode = getActiveMode();
    var size = el.optSize;
    var color = el.optCurrentColor;
    var comments = el.optStripComments;

    unlock(size); unlock(color); unlock(comments);

    if (mode === 'icon' || mode === 'logo') {
      size.checked = true; size.disabled = true;
      color.checked = true; color.disabled = true;
      comments.checked = true; comments.disabled = true;
    } else if (mode === 'image') {
      color.checked = false; color.disabled = true;
      size.checked = false; size.disabled = true;
    } else if (mode === 'css') {
      color.checked = false; color.disabled = true;
    }

    el.lockHint.textContent = LOCK_HINTS[mode] || '';
    el.lockHint.classList.toggle('is-hidden', !LOCK_HINTS[mode]);
    [size, color, comments].forEach(function (input) {
      describe(input, el.lockHint.id, input.disabled);
    });
  }

  // The verbs follow the format: Copy with the format's noun, and in Image
  // mode Download beside it, because that format makes a file.
  function updateActions() {
    var mode = getActiveMode();
    el.downloadBtn.classList.toggle('is-hidden', mode !== 'image');
    el.copyFormat.textContent = mode === 'css' ? 'CSS' : 'SVG';
  }

  //
  //------- Section reset -------//
  //

  function options() {
    return [el.optSize, el.optCurrentColor, el.optMinify, el.optStripComments, el.optStripMetadata, el.optRoundDecimals];
  }

  function cssShapes() {
    return [].slice.call(el.root.querySelectorAll('input[name="svg-cleaner-css-format"]'));
  }

  // Settings is at its defaults with the SVG format, the first CSS shape and
  // every option as the markup shipped it. A locked option is the format's,
  // not the reader's, so it does not count as a change the reset could undo;
  // the pasted code and the names are content, so they do not count either.
  function isSettingsDefault() {
    return getActiveMode() === null
      && cssShapes().every(function atDefault(input) { return input.checked === input.defaultChecked; })
      && options().every(function atDefault(input) {
        return input.disabled || input.checked === input.defaultChecked;
      });
  }

  function syncResets() {
    el.settingsReset.disabled = isSettingsDefault();
  }

  function handleSettingsReset() {
    setMode(null);
    cssShapes().concat(options()).forEach(function resetInput(input) {
      input.checked = input.defaultChecked;
    });
    updateContext();
    applyLocks();
    updateActions();
    clean();
    announce('Settings reset: SVG, with the default options.');
  }

  //
  //------- Clean -------//
  //

  function readOptions(mode) {
    var fmt = el.root.querySelector('input[name="svg-cleaner-css-format"]:checked');
    return {
      sanitise: true,
      currentColor: el.optCurrentColor.checked,
      icon: mode === 'icon',
      iconName: el.optIconName.value.trim() || null,
      logo: mode === 'logo',
      logoName: el.optLogoName.value.trim() || null,
      size: el.optSize.checked,
      standalone: mode === 'image',
      css: mode === 'css',
      cssFormat: fmt ? fmt.value : 'url',
      stripComments: el.optStripComments.checked,
      stripMetadata: el.optStripMetadata.checked,
      precision: el.optRoundDecimals.checked ? 2 : null,
      minify: el.optMinify.checked
    };
  }

  // What the preview draws: the SVG itself, cleaned with the format's options
  // but as a standalone document — an <img> needs the namespace, CSS mode's
  // result is a stylesheet, and Icon and Logo mode's result is the SVG
  // inside its .svg-icn wrapper, none of which is an image.
  function previewSource(input, mode) {
    var options = readOptions(mode);
    options.css = false;
    options.icon = false;
    options.logo = false;
    options.standalone = true;
    var svg = SvgCleaner.processSVG(input, options);
    // Render glue, not processing: the engine drops xmlns:xlink and keeps
    // xlink:href, and an undeclared prefix is a fatal XML error in an <img>
    // — most Figma and Illustrator exports would draw nothing. The
    // declaration goes back on for the drawing only; the engine fix is
    // logged in ROADMAP against @bydefaultstudio/svg-cleaner.
    if (svg.indexOf('xlink:') !== -1 && svg.indexOf('xmlns:xlink') === -1) {
      svg = svg.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }
    return svg;
  }

  function bytes(text) {
    return new Blob([text]).size;
  }

  function formatBytes(n) {
    return n.toLocaleString() + (n === 1 ? ' byte' : ' bytes');
  }

  // The image shows when it has loaded, not when its src is set: what the
  // engine passes through is not always something a browser can draw, and
  // the empty line says so instead.
  function clearPreview(message) {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    el.preview.removeAttribute('src');
    el.frame.hidden = true;
    el.scaleNote.textContent = '';
    el.previewEmpty.textContent = message || EMPTY_TEXT;
    el.previewEmpty.hidden = false;
  }

  // The frame takes the SVG's own box — its viewBox, or its width and
  // height — read from the markup by the layer engine's parser (parsed,
  // never inserted: the drawing itself only ever runs as an <img>), so the
  // artboard drawn over it lines up with the drawing.
  function showPreview(svg) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    var artwork = window.LayerStack ? window.LayerStack.readArtwork(svg, 0) : null;
    var ratio = artwork ? artwork.viewBox.w / artwork.viewBox.h : DEFAULT_RATIO;
    // A zero-height viewBox would write Infinity, which no var() fallback catches.
    if (!isFinite(ratio) || ratio <= 0) ratio = DEFAULT_RATIO;
    el.frame.style.setProperty('--tool-artwork-ratio', String(ratio));
    el.frame.style.setProperty('--tool-artwork-width', ownWidth(artwork) + 'px');
    el.preview.src = previewUrl;
  }

  // The drawing's own size: a width in pixels where the SVG declares one,
  // else its viewBox's width, else the browser's 300px for an unsized image.
  // A percentage or an em width is relative to a page the SVG is not in.
  function ownWidth(artwork) {
    if (!artwork) return DEFAULT_WIDTH;
    var declared = artwork.svg.getAttribute('width') || '';
    if (/^\s*\d*\.?\d+\s*(px)?\s*$/.test(declared) && parseFloat(declared) > 0) return parseFloat(declared);
    // With no viewBox, the parser builds one from the width as written, so
    // "2em" or "100%" would come back as 2 or 100: no own size to read.
    if (!artwork.svg.hasAttribute('viewBox')) return DEFAULT_WIDTH;
    return artwork.viewBox.w > 0 ? artwork.viewBox.w : DEFAULT_WIDTH;
  }

  function handlePreviewLoad() {
    el.frame.hidden = false;
    el.previewEmpty.hidden = true;
    updateScaleNote();
  }

  // At what scale the drawing is shown, the way the other previews say it,
  // so the band never quietly misleads about size. Not a live region:
  // rewritten on every change, and read from the frame as laid out.
  function updateScaleNote() {
    if (!el.frame || !el.scaleNote) return;
    var own = parseFloat(el.frame.style.getPropertyValue('--tool-artwork-width'));
    // The laid-out width, not the bounding box: a Barba arrival scales the
    // container, and a transform fires no resize to correct the note after.
    var shown = el.frame.hidden ? 0 : parseFloat(window.getComputedStyle(el.frame).width);
    if (!(own > 0) || !(shown > 0)) { el.scaleNote.textContent = ''; return; }
    var pct = Math.round((shown / own) * 100);
    el.scaleNote.textContent = pct === 100 ? 'Shown at actual size' : 'Shown at ' + pct + '%';
  }

  // The stage's size changes with the window and the dock's toggle, not
  // with any control, which is the one change the switches never see.
  function observeStage() {
    if (stageObserver) stageObserver.disconnect();
    stageObserver = null;
    if (typeof ResizeObserver === 'undefined') return;
    stageObserver = new ResizeObserver(updateScaleNote);
    stageObserver.observe(el.previewBand);
  }

  //
  //------- Preview switches -------//
  //

  // The ground: the light one, or the checkerboard while Transparent is on.
  // Both are light, so the ink stays; syncInk only re-measures whether the
  // captions may fade on it (tool-canvas.js).
  function applyGround() {
    el.previewBand.setAttribute('data-ground', preview.transparent ? 'checker' : 'light');
    if (window.ToolPreview) window.ToolPreview.syncInk(el.previewBand);
  }

  function applyArtboard() {
    el.frame.toggleAttribute('data-artboard', preview.artboard);
  }

  // Fill screen: the frame as large as the stage allows (svg-cleaner.css).
  function applyFill() {
    el.frame.toggleAttribute('data-fill', preview.fill);
    updateScaleNote();
  }

  function handleFillChange() {
    preview.fill = el.fill.checked;
    applyFill();
  }

  function handleTransparentChange() {
    preview.transparent = el.transparent.checked;
    applyGround();
  }

  function handleArtboardChange() {
    preview.artboard = el.artboard.checked;
    applyArtboard();
  }

  function applyPreviewSwitches() {
    el.transparent.checked = preview.transparent;
    el.artboard.checked = preview.artboard;
    el.fill.checked = preview.fill;
    applyGround();
    applyArtboard();
    applyFill();
  }

  // Said as well as shown: the status line has just reported the clean as
  // a success, and the drawing failing is the correction.
  function handlePreviewError() {
    clearPreview(UNDRAWN_TEXT);
    announce(UNDRAWN_TEXT);
  }

  // The readout is the outcome of the clean, so it is spoken too: at once
  // for a paste, a switch or a format, and once the typing stops otherwise.
  function readout(text, typed) {
    el.size.textContent = text;
    window.clearTimeout(readoutTimer);
    if (typed) {
      readoutTimer = window.setTimeout(function speak() { announce(text); }, READOUT_DEBOUNCE_MS);
    } else {
      announce(text);
    }
  }

  function clearResult() {
    el.output.value = '';
    el.copyBtn.disabled = true;
    el.downloadBtn.disabled = true;
  }

  function clean(event) {
    if (!el.root) return;
    syncResets();
    var mode = getActiveMode();
    var input = el.input.value;
    var typed = !!event && event.type === 'input' && event.inputType !== 'insertFromPaste';

    if (!input.trim()) {
      clearResult();
      readout(NOTHING_TEXT, typed);
      clearPreview();
      return;
    }

    var before = bytes(input);
    if (before > MAX_INPUT_BYTES) {
      clearResult();
      readout('Too big to clean here: ' + formatBytes(before) + '. The limit is ' + formatBytes(MAX_INPUT_BYTES) + '.', typed);
      clearPreview();
      return;
    }

    var result = SvgCleaner.processSVG(input, readOptions(mode));
    el.output.value = result;
    el.copyBtn.disabled = false;
    el.downloadBtn.disabled = false;

    var after = bytes(result);
    var saved = Math.round((1 - after / before) * 100);
    readout(formatBytes(before) + ' → ' + formatBytes(after)
      + (saved > 0 ? ' (−' + saved + '%)' : ''), typed);

    showPreview(previewSource(input, mode));
  }

  //
  //------- Actions -------//
  //

  // Download writes the result already showing; Image mode's result is the
  // standalone file.
  function handleSaveImage() {
    if (!el.root) return;
    var result = el.output.value;
    if (!result) return;

    var fn = SvgCleaner.sanitiseName(el.optImageFilename.value.trim() || 'image');
    var blob = new Blob([result], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fn + '.svg'; a.click();
    URL.revokeObjectURL(url);
    announce('Downloaded ' + fn + '.svg');
  }

  // A format changes which fields show, which options are locked and which
  // verbs sit at the dock's foot, away from the focus; the status line says
  // what the verbs are now.
  function handleFormatChange() {
    if (!el.root) return;
    var mode = getActiveMode();
    updateContext();
    applyLocks();
    updateActions();
    clean();
    announce(formatLabel(mode) + '. ' + (mode === 'image' ? 'Download SVG and Copy SVG' : 'Copy ' + el.copyFormat.textContent) + ' at the foot of the panel.');
  }

  // Reset all: every control back to the value it shipped with in the
  // markup, the code cleared, the plain SVG format and the preview switches
  // off, as at page load.
  function handleReset() {
    if (!el.root) return;
    el.input.value = '';
    preview = { transparent: false, artboard: false, fill: false };
    applyPreviewSwitches();
    [el.optIconName, el.optLogoName, el.optImageFilename].forEach(function resetField(field) {
      field.value = field.defaultValue;
    });
    el.root.querySelectorAll('.form-toggle input[type="checkbox"], input[name="svg-cleaner-css-format"]').forEach(function resetInput(input) {
      input.checked = input.defaultChecked;
    });
    setMode(null);
    updateContext();
    applyLocks();
    updateActions();
    clean();
    announce('Everything reset.');
  }

  // Cleared before it is written, on a delay, so the same sentence twice in a
  // row is still announced.
  function announce(message) {
    if (!el.status) return;
    window.clearTimeout(statusTimer);
    el.status.textContent = '';
    statusTimer = window.setTimeout(function speak() {
      if (el.status) el.status.textContent = message;
    }, STATUS_DELAY_MS);
  }

  //
  //------- Init -------//
  //

  // Everything bound to elements dies with the Barba container. What does
  // not is released here, on the next arrival — the Blob URL, the timer and
  // the references.
  function release() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (stageObserver) { stageObserver.disconnect(); stageObserver = null; }
    window.clearTimeout(statusTimer);
    window.clearTimeout(readoutTimer);
    statusTimer = null;
    readoutTimer = null;
    preview = { transparent: false, artboard: false, fill: false };
    el = {};
  }

  function bindElements(root) {
    el.root = root;
    el.format = root.querySelector('#svg-cleaner-format');
    el.formatNote = root.querySelector('#svg-cleaner-format-note');
    el.input = root.querySelector('#svg-cleaner-input');
    el.output = root.querySelector('#svg-cleaner-output');
    el.copyBtn = root.querySelector('#svg-cleaner-copy');
    el.copyFormat = root.querySelector('#svg-cleaner-copy-format');
    el.downloadBtn = root.querySelector('#svg-cleaner-download');
    el.reset = root.querySelector('#svg-cleaner-reset');
    el.settingsReset = root.querySelector('#svg-cleaner-settings-reset');
    el.previewBand = root.querySelector('#svg-cleaner-preview');
    el.frame = root.querySelector('#svg-cleaner-frame');
    el.preview = root.querySelector('#svg-cleaner-drawing');
    el.transparent = root.querySelector('#svg-cleaner-transparent');
    el.artboard = root.querySelector('#svg-cleaner-artboard');
    el.fill = root.querySelector('#svg-cleaner-fill');
    el.scaleNote = root.querySelector('#svg-cleaner-scale-note');
    el.previewEmpty = root.querySelector('#svg-cleaner-empty');
    el.size = root.querySelector('#svg-cleaner-size');
    el.status = root.querySelector('#svg-cleaner-status');
    el.groupIconName = root.querySelector('#svg-cleaner-group-icon-name');
    el.groupLogoName = root.querySelector('#svg-cleaner-group-logo-name');
    el.groupImageFilename = root.querySelector('#svg-cleaner-group-image-filename');
    el.optIconName = root.querySelector('#svg-cleaner-icon-name');
    el.optLogoName = root.querySelector('#svg-cleaner-logo-name');
    el.optImageFilename = root.querySelector('#svg-cleaner-image-filename');
    el.cssShape = root.querySelector('#svg-cleaner-css-shape');
    el.lockHint = root.querySelector('#svg-cleaner-lock-hint');
    el.optSize = root.querySelector('#svg-cleaner-opt-size');
    el.optCurrentColor = root.querySelector('#svg-cleaner-opt-current-color');
    el.optMinify = root.querySelector('#svg-cleaner-opt-minify');
    el.optStripComments = root.querySelector('#svg-cleaner-opt-strip-comments');
    el.optStripMetadata = root.querySelector('#svg-cleaner-opt-strip-metadata');
    el.optRoundDecimals = root.querySelector('#svg-cleaner-opt-round-decimals');
  }

  function bindEvents() {
    el.format.addEventListener('change', handleFormatChange);
    el.input.addEventListener('input', clean);
    el.root.querySelectorAll('.form-toggle input[type="checkbox"], input[name="svg-cleaner-css-format"]').forEach(function bindOption(input) {
      input.addEventListener('change', clean);
    });
    [el.optIconName, el.optLogoName].forEach(function bindName(field) {
      field.addEventListener('input', clean);
    });
    el.preview.addEventListener('load', handlePreviewLoad);
    el.preview.addEventListener('error', handlePreviewError);
    el.transparent.addEventListener('change', handleTransparentChange);
    el.artboard.addEventListener('change', handleArtboardChange);
    el.fill.addEventListener('change', handleFillChange);
    el.downloadBtn.addEventListener('click', handleSaveImage);
    el.reset.addEventListener('click', handleReset);
    // The section reset's click arrives as tool:panel-reset (tool-canvas.js).
    el.settingsReset.addEventListener('tool:panel-reset', handleSettingsReset);
  }

  function initSvgCleaner() {
    release();

    // Barba appends the incoming container after the outgoing one, so the last
    // match is the page being entered.
    var roots = document.querySelectorAll('[data-tool="svg-cleaner"]');
    var root = roots[roots.length - 1];
    if (!root || !root.querySelector('#svg-cleaner-format')) return;

    if (typeof window.SvgCleaner === 'undefined') {
      console.error('[SVG Cleaner] engine missing — assets/js/vendor/svg-cleaner-core.js must load before svg-cleaner.js');
      return;
    }

    bindElements(root);

    // The listeners live on the container's elements and die with it; the
    // guard only stops a second call against the same container binding twice.
    if (!root.dataset.svgCleanerInit) {
      root.dataset.svgCleanerInit = 'true';
      bindEvents();
    }

    updateContext();
    applyLocks();
    updateActions();
    // A restored page can bring the switches back changed without a change event
    preview.transparent = el.transparent.checked;
    preview.artboard = el.artboard.checked;
    preview.fill = el.fill.checked;
    applyPreviewSwitches();
    observeStage();
    clean();

    console.log('[SVG Cleaner] init');
  }

  window.initSvgCleaner = initSvgCleaner;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initSvgCleaner bails when its markup is absent.
  function startSvgCleaner() {
    initSvgCleaner();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startSvgCleaner);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSvgCleaner);
  } else {
    startSvgCleaner();
  }
})();
