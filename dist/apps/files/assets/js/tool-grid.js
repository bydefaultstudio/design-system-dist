/**
 * tool-grid.js — The tools' one browsing grid
 * Every tool that lays its items out as a grid of tiles (the Icon Library,
 * the Asset Library) moves through them here, so the keys work the same in
 * each (cms/tool-canvas.md, Grid):
 *
 *   - a roving tab stop: the whole grid is one Tab stop, the tile last
 *     chosen or the first one shown, so a keyboard reader never Tabs past
 *     every tile to reach what follows.
 *   - the arrows move between tiles, Up and Down by a row as the grid lays
 *     it out at the moment, Home and End to the first and last.
 *   - selection follows focus: every move hands the tile to the tool, which
 *     selects it, so the preview or the panel changes as the arrows go.
 *
 * Only the tiles the tool says are showing count, in the order it gives, so
 * a search that hides or reorders tiles never strands the arrows. Alt, Ctrl
 * and Cmd with an arrow are left alone: they are history and text keys.
 *
 * A library: binds one keydown listener on the grid it is handed, which dies
 * with the grid on a page swap, and has no init. Exposes window.ToolGrid.
 * @version 1.0.0
 */

(function () {
  'use strict';

  var VERSION = '1.0.0';
  console.log('[Tool Grid] v' + VERSION + ' loaded');

  // auto-fill resolves to explicit tracks in the computed value, one per
  // column, so the count is the track count. A list view that is not a grid
  // reads 'none' and moves by one.
  function columnCount(grid) {
    var tracks = getComputedStyle(grid).gridTemplateColumns;
    if (!tracks || tracks === 'none' || tracks.indexOf('repeat(') !== -1) return 1;
    return tracks.trim().split(/\s+/).length;
  }

  // options.tiles()    the tiles showing, in grid order (required)
  // options.preferred() the tile that should hold the tab stop when the
  //                    current one leaves the set, usually the selected one
  // options.onMove(tile) the reader arrowed onto tile; the tool selects it
  function create(grid, options) {
    var tiles = options.tiles;
    var preferred = options.preferred || function nonePreferred() { return null; };
    var onMove = options.onMove || function noMove() {};
    var stop = null;

    function setTabStop(tile) {
      if (stop && stop !== tile) stop.setAttribute('tabindex', '-1');
      stop = tile || null;
      if (stop) stop.setAttribute('tabindex', '0');
    }

    // The tab stop must be a showing tile, or the grid drops out of the tab
    // order the moment a search hides it. The preferred tile takes it when it
    // is still shown; otherwise the first.
    function repair() {
      var shown = tiles();
      if (stop && shown.indexOf(stop) !== -1) return;
      var wanted = preferred();
      setTabStop(wanted && shown.indexOf(wanted) !== -1 ? wanted : shown[0] || null);
    }

    // focusOptions passes through: a pointer click focuses with
    // { preventScroll: true }, so a click never moves the page.
    function focus(tile, focusOptions) {
      if (!tile) return;
      setTabStop(tile);
      tile.focus(focusOptions);
    }

    function handleKeydown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      var shown = tiles();
      var index = shown.indexOf(event.target);
      if (index === -1) return;

      var next;
      switch (event.key) {
        case 'ArrowRight': next = index + 1; break;
        case 'ArrowLeft': next = index - 1; break;
        case 'ArrowDown': next = index + columnCount(grid); break;
        case 'ArrowUp': next = index - columnCount(grid); break;
        case 'Home': next = 0; break;
        case 'End': next = shown.length - 1; break;
        default: return;
      }

      event.preventDefault();
      if (next < 0 || next >= shown.length || next === index) return;
      // Select first, then focus: a screen reader reads the tile as focus
      // lands, and a state set after that (aria-current) is not announced.
      onMove(shown[next]);
      focus(shown[next]);
    }

    grid.addEventListener('keydown', handleKeydown);

    return {
      setTabStop: setTabStop,
      tabStop: function tabStop() { return stop; },
      repair: repair,
      focus: focus
    };
  }

  window.ToolGrid = { create: create };
})();
