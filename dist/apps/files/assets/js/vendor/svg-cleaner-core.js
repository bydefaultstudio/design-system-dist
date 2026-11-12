/**
 * Script Purpose: SVG Cleaner core — shared processing engine for CLI and browser
 * Author: By Default Studio
 * Created: 2026-07-23
 * Version: 1.2.0
 *
 * Single source of truth for SVG cleaning. Consumed by:
 *   - bin/svg-cleaner.js (Node CLI, via require)
 *   - web/index.html and any browser UI (via <script>, exposes window.SvgCleaner)
 *
 * Dependency-free. The cleaning passes are regex-based, which suits the
 * trusted "designer pastes an SVG" workflow. The sanitise pass is not: it
 * tokenises tags the way a browser does and keeps only SVG elements (see
 * "Sanitise" below). It is still not a full XML parser, so treat it as one
 * layer of defence, not the only one, for SVG from hostile sources.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SvgCleaner = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.2.0';

  // Refuse pathological inputs — protects the caller's own process/tab
  var MAX_INPUT_BYTES = 2 * 1024 * 1024;

  // Wrapper conventions — overridable per project via options
  var DEFAULTS = {
    iconClass: 'svg-icn',
    iconAttr: 'data-icon',
    logoClass: 'svg-logo',
    logoAttr: 'data-logo',
  };

  //
  //------- Utility Functions -------//
  //

  // Strip XML/HTML Comments
  function stripComments(svg) {
    return svg.replace(/<!--[\s\S]*?-->/g, '');
  }

  // Strip Editor Metadata (data-* attributes, Illustrator class names)
  function stripMetadata(svg) {
    var result = svg;
    result = result.replace(/\s+data-name="[^"]*"/g, '');
    result = result.replace(/\s+data-id="[^"]*"/g, '');
    result = result.replace(/\s+class="(?:cls|st)-?\d+"/g, '');
    return result;
  }

  // Round Decimal Values to N Places
  function roundDecimals(svg, precision) {
    return svg.replace(/(\d+\.\d+)/g, function (_match, num) {
      return parseFloat(parseFloat(num).toFixed(precision)).toString();
    });
  }

  // Optimise Path Data (remove unnecessary spaces and commas)
  function optimisePathData(svg) {
    return svg.replace(/\s+d="([^"]*)"/g, function (_match, pathData) {
      var optimised = pathData;
      optimised = optimised.replace(/,/g, ' ');
      optimised = optimised.replace(/\s{2,}/g, ' ');
      optimised = optimised.replace(/([A-Za-z])\s+/g, '$1');
      optimised = optimised.replace(/\s+(-)/g, '$1');
      return ' d="' + optimised.trim() + '"';
    });
  }

  // Minify SVG to Single Line
  function minifySVG(svg) {
    var result = optimisePathData(svg);
    result = result.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').trim();
    return result;
  }

  // Extract a Unitless Number From a Dimension Value (accepts "24", "24px";
  // rejects "%", "em" etc — CSS aspect-ratio takes unitless numbers only)
  function cssDimension(value) {
    var m = /^\s*([0-9]*\.?[0-9]+)\s*(?:px)?\s*$/i.exec(value || '');
    return m ? m[1] : null;
  }

  // Sanitise Name (replace spaces and special characters with hyphens)
  function sanitiseName(name) {
    return String(name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');
  }

  //
  //------- Sanitise (security pass) -------//
  //

  // The sanitise pass reads markup the way a browser does: one tag at a time,
  // attributes split on HTML's rules (quoted, unquoted, valueless, "/" as a
  // separator), never a regex over the whole string. Every tag it keeps is
  // written back in one canonical form: double or single quotes round every
  // value, "<" and ">" escaped inside values, comments and CDATA neutralised.
  // That is what makes the output safe in both places it ends up. An HTML page
  // and an XML .svg file can only disagree about input that is not written
  // like this, so an attribute value or a comment cannot hide a tag from one
  // parser and show it to the other.

  // Labels reported for each kind of removal, in report order.
  var SANITISE_LABELS = [
    'script blocks',
    'foreignObject blocks',
    'non-SVG elements',
    'event handler attributes',
    'javascript/data-html links',
    'XHTML namespace declarations',
    'DOCTYPE entity declarations and processing instructions',
    'malformed attributes',
    'content outside the root svg',
    'elements inside title or desc',
  ];

  function toSet(list) {
    var set = {};
    list.forEach(function (name) { set[name] = true; });
    return set;
  }

  // Elements an SVG editor exports. Anything else is dropped with its content.
  // HTML names are absent on purpose: in a page, an <img>, <p> or <font> inside
  // <svg> breaks out of SVG parsing into live HTML. Stored lowercase.
  var SVG_ELEMENTS = toSet([
    'a', 'altglyph', 'altglyphdef', 'altglyphitem', 'animate', 'animatecolor',
    'animatemotion', 'animatetransform', 'circle', 'clippath', 'color-profile',
    'cursor', 'defs', 'desc', 'discard', 'ellipse', 'feblend', 'fecolormatrix',
    'fecomponenttransfer', 'fecomposite', 'feconvolvematrix', 'fediffuselighting',
    'fedisplacementmap', 'fedistantlight', 'fedropshadow', 'feflood', 'fefunca',
    'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge',
    'femergenode', 'femorphology', 'feoffset', 'fepointlight',
    'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence', 'filter',
    'font-face', 'font-face-format', 'font-face-name', 'font-face-src',
    'font-face-uri', 'g', 'glyph', 'glyphref', 'hatch', 'hatchpath', 'hkern',
    'image', 'line', 'lineargradient', 'marker', 'mask', 'mesh', 'meshgradient',
    'meshpatch', 'meshrow', 'metadata', 'missing-glyph', 'mpath', 'path',
    'pattern', 'polygon', 'polyline', 'radialgradient', 'rect', 'set',
    'solidcolor', 'stop', 'style', 'svg', 'switch', 'symbol', 'text', 'textpath',
    'title', 'tref', 'tspan', 'use', 'view', 'vkern',
  ]);

  // Matched on the local name, so a prefixed <svg:script> goes too.
  var SCRIPT_ELEMENTS = toSet(['script', 'handler', 'listener']);

  // Enough named entities to unmask a hidden scheme ("java&Tab;script&colon;").
  // Lookup is case-insensitive: this only feeds detection, never output.
  var NAMED_ENTITIES = {
    amp: '&', apos: "'", colon: ':', comma: ',', gt: '>', lpar: '(', lt: '<',
    nbsp: '\u00a0', newline: '\n', period: '.', quot: '"', rpar: ')', semi: ';',
    sol: '/', tab: '\t',
  };

  function decodeEntities(value) {
    return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]*));?/gi, function (match, hex, dec, name) {
      if (hex || dec) {
        var code = parseInt(hex || dec, hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      var named = NAMED_ENTITIES[name.toLowerCase()];
      return named === undefined ? match : named;
    });
  }

  // Strip what a URL parser ignores (whitespace, control and invisible
  // characters) so "java\tscript:" and "&#x6A;avascript:" read as written.
  function normaliseValue(value) {
    return decodeEntities(value)
      .replace(/[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028\u2029\u205f\u3000\ufeff]/g, '')
      .toLowerCase();
  }

  // Anywhere in the value, not only at the start: SMIL's values="a;b;c" lists
  // several URLs, and <set to="javascript:..."> animates a link into one.
  var SCRIPT_URL = /(?:java|vb)script:|data:text\/html|data:(?:text|application)\/(?:x-)?(?:java|ecma)script/;

  // Attributes that take a URL, so a data: value there loads a document
  var URL_ATTRS = toSet(['href', 'src', 'to', 'from', 'by', 'values']);

  // An "&" that does not start an entity: legal in HTML, fatal in XML
  var BARE_AMP = /&(?!(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi;

  var ATTR_NAME = /^[a-z_][a-z0-9_.:-]*$/i;
  var ELEMENT_NAME = /^[a-z_][a-z0-9_.-]*(?::[a-z_][a-z0-9_.-]*)?$/i;
  var WHITESPACE = /[\t\n\f\r ]/;

  // Read one start or end tag at `start` (the "<") using HTML's tokenizer
  // rules. Returns null when the input ends inside the tag.
  function readTag(svg, start) {
    var n = svg.length;
    var j = start + 1;
    var isEnd = svg.charAt(j) === '/';
    if (isEnd) j++;

    var nameStart = j;
    while (j < n && !WHITESPACE.test(svg.charAt(j)) && svg.charAt(j) !== '/' && svg.charAt(j) !== '>') j++;
    var tag = { isEnd: isEnd, name: svg.slice(nameStart, j), attrs: [], selfClosing: false, tail: '', end: -1 };

    var sep = '';
    while (j < n) {
      var c = svg.charAt(j);
      if (WHITESPACE.test(c)) { sep += c; j++; continue; }
      if (c === '/') {
        if (svg.charAt(j + 1) === '>') { tag.selfClosing = true; tag.tail = sep; tag.end = j + 2; return tag; }
        sep += ' '; j++; continue; // a stray "/" separates attributes in HTML
      }
      if (c === '>') { tag.tail = sep; tag.end = j + 1; return tag; }

      // Attribute name: an "=" can open it (HTML keeps it as part of the name)
      var attrStart = j;
      j++;
      while (j < n && !WHITESPACE.test(svg.charAt(j)) && '/>='.indexOf(svg.charAt(j)) === -1) j++;
      var attr = { sep: sep, name: svg.slice(attrStart, j), value: '', quote: null, hasValue: false };
      sep = '';

      var k = j;
      while (k < n && WHITESPACE.test(svg.charAt(k))) k++;
      if (svg.charAt(k) === '=') {
        k++;
        while (k < n && WHITESPACE.test(svg.charAt(k))) k++;
        var q = svg.charAt(k);
        attr.hasValue = true;
        if (q === '"' || q === "'") {
          var close = svg.indexOf(q, k + 1);
          if (close === -1) return null;
          attr.quote = q;
          attr.value = svg.slice(k + 1, close);
          j = close + 1;
        } else {
          var vStart = k;
          while (k < n && !WHITESPACE.test(svg.charAt(k)) && svg.charAt(k) !== '>') k++;
          attr.value = svg.slice(vStart, k);
          j = k;
        }
      }
      tag.attrs.push(attr);
    }
    return null;
  }

  // Write an attribute back in canonical form: always quoted, and no "<" or
  // ">" left in the value for an HTML raw-text element to end early on.
  function writeAttr(attr) {
    // A form feed separates attributes in HTML and is illegal in XML
    var sep = attr.sep === '' ? ' ' : attr.sep.replace(/\f/g, ' ');
    if (!attr.hasValue) return sep + attr.name + '=""';
    var quote = attr.quote || '"';
    var value = attr.value.replace(BARE_AMP, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (quote === '"') value = value.replace(/"/g, '&quot;');
    return sep + attr.name + '=' + quote + value + quote;
  }

  // A comment both parsers agree on: no "--", no "<" or ">", and no leading
  // ">" or trailing "-" for HTML's "<!-->" and "--->" shortcuts to bite on.
  function writeComment(body) {
    var safe = body.replace(/[<>]/g, ' ').replace(/-(?=-)/g, '- ');
    if (safe.charAt(safe.length - 1) === '-') safe += ' ';
    return '<!--' + safe + '-->';
  }

  // Filter one kept element's attributes, flagging what goes.
  function cleanAttrs(localName, attrs, flag) {
    return attrs.filter(function (attr) {
      if (!ATTR_NAME.test(attr.name)) { flag(7); return false; }
      var lower = attr.name.toLowerCase();
      var local = lower.slice(lower.lastIndexOf(':') + 1);
      if (local.indexOf('on') === 0) { flag(3); return false; }

      var value = normaliseValue(attr.value);
      if ((lower === 'xmlns' || lower.indexOf('xmlns:') === 0)
        && (value.indexOf('1999/xhtml') !== -1 || value.indexOf('1998/math/mathml') !== -1)) {
        flag(5); return false;
      }
      if (SCRIPT_URL.test(value)) { flag(4); return false; }
      // A data: URL is a whole document (a link, a <use>, a SMIL value can
      // all load one). Only an image's own source may be one, and only an
      // image, which the browser renders with scripts off.
      if (URL_ATTRS[local] && value.indexOf('data:') !== -1
        && !((localName === 'image' || localName === 'feimage') && local === 'href' && value.indexOf('data:image/') === 0)) {
        flag(4); return false;
      }
      // Browsers refuse to animate a handler today; do not rely on it
      if (local === 'attributename' && value.slice(value.lastIndexOf(':') + 1).indexOf('on') === 0) {
        flag(3); return false;
      }
      return true;
    });
  }

  // Run the sanitise pass. Returns the cleaned markup and the labels of what
  // it removed, so sanitiseSVG and sanitiseReport cannot drift apart.
  function runSanitise(svg) {
    var found = [];
    function flag(index) { found[index] = true; }

    var out = '';
    var n = svg.length;
    var i = 0;
    var skipName = null; // lowercase name of an element being dropped whole
    var skipDepth = 0;

    // One root <svg>, nothing beside it. Inline in a page, anything outside
    // the root is parsed as HTML, so an <a> or <image> there becomes a live
    // HTML element (DOM clobbering: <image name="cookie"> shadows
    // document.cookie). Same for <title> and <desc>: HTML parses their
    // children as HTML, so they keep text only.
    var root = 'before'; // 'before' | 'inside' | 'after'
    var svgDepth = 0;
    var textOnlyDepth = 0; // open <title>/<desc> elements

    function emit(text) { if (skipName === null) out += text; }

    function emitText(text) {
      if (skipName !== null || text === '') return;
      if (root !== 'inside') {
        if (/\S/.test(text)) flag(8);
        else out += text; // whitespace, such as a file's final newline, is harmless
        return;
      }
      // A form feed is whitespace in HTML and illegal anywhere in XML
      out += text.replace(BARE_AMP, '&amp;').replace(/\f/g, ' ');
    }

    function skip(tag, lowerName) {
      if (!tag.selfClosing) { skipName = lowerName; skipDepth = 1; }
    }

    while (i < n) {
      var lt = svg.indexOf('<', i);
      if (lt === -1) { emitText(svg.slice(i)); break; }
      emitText(svg.slice(i, lt));
      i = lt;

      // Comment
      if (svg.substr(i, 4) === '<!--') {
        var cEnd = svg.indexOf('-->', i + 4);
        if (root !== 'after') emit(writeComment(svg.slice(i + 4, cEnd === -1 ? n : cEnd)));
        i = cEnd === -1 ? n : cEnd + 3;
        continue;
      }

      // CDATA: kept as escaped text, which reads the same in HTML and XML
      if (svg.substr(i, 9).toUpperCase() === '<![CDATA[') {
        var dEnd = svg.indexOf(']]>', i + 9);
        var cdata = svg.slice(i + 9, dEnd === -1 ? n : dEnd);
        if (root === 'inside') emit(cdata.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        else if (skipName === null && /\S/.test(cdata)) flag(8);
        i = dEnd === -1 ? n : dEnd + 3;
        continue;
      }

      // DOCTYPE or other declaration: dropped. An internal subset can declare
      // entities that expand to markup when the file is parsed as XML.
      if (svg.charAt(i + 1) === '!') {
        var gt = svg.indexOf('>', i);
        // Look for "[" only up to the ">": a search to the end of the input
        // for every declaration is quadratic on "<!a><!a>..."
        var bracket = svg.slice(i, gt === -1 ? n : gt).indexOf('[');
        if (bracket !== -1) bracket += i;
        if (bracket !== -1) {
          var subsetEnd = /\][\t\n\f\r ]*>/g;
          subsetEnd.lastIndex = bracket;
          var sm = subsetEnd.exec(svg);
          if (skipName === null) flag(6);
          i = sm ? sm.index + sm[0].length : n;
        } else {
          i = gt === -1 ? n : gt + 1;
        }
        continue;
      }

      // Processing instruction: only a leading XML declaration survives
      if (svg.charAt(i + 1) === '?') {
        var pEnd = svg.indexOf('?>', i + 2);
        var pi = svg.slice(i, pEnd === -1 ? n : pEnd + 2);
        i = pEnd === -1 ? n : pEnd + 2;
        if (/^<\?xml[\t\n\r ][^<>]*\?>$/.test(pi) && root === 'before' && out.trim() === '') emit(pi);
        else if (skipName === null) flag(6);
        continue;
      }

      // Anything but "<letter" or "</letter" is text
      var next = svg.charAt(i + 1) === '/' ? svg.charAt(i + 2) : svg.charAt(i + 1);
      if (!/[a-z]/i.test(next)) {
        if (svg.charAt(i + 1) === '/') {
          // "</" + non-letter is a bogus comment in HTML: drop it to the ">"
          var bEnd = svg.indexOf('>', i);
          i = bEnd === -1 ? n : bEnd + 1;
        } else {
          if (root === 'inside') emit('&lt;');
          else emitText('<');
          i++;
        }
        continue;
      }

      var tag = readTag(svg, i);
      if (!tag) break; // input ends inside a tag: a browser drops it too
      i = tag.end;

      var lowerName = tag.name.toLowerCase();
      var localName = lowerName.slice(lowerName.lastIndexOf(':') + 1);

      // Inside a dropped element: only track nesting of the same name
      if (skipName !== null) {
        if (lowerName === skipName) {
          if (tag.isEnd) skipDepth--;
          else if (!tag.selfClosing) skipDepth++;
          if (skipDepth === 0) skipName = null;
        }
        continue;
      }

      var allowed = ELEMENT_NAME.test(tag.name)
        && !SCRIPT_ELEMENTS[localName]
        && localName !== 'foreignobject'
        // A prefixed name is editor metadata (sodipodi:, inkscape:, rdf:)
        && (lowerName.indexOf(':') !== -1 || SVG_ELEMENTS[lowerName] === true);

      var isTextOnly = lowerName === 'title' || lowerName === 'desc';

      if (tag.isEnd) {
        // A stray end tag, or one for a dropped element, goes silently
        if (root !== 'inside' || !allowed) continue;
        if (textOnlyDepth > 0) {
          if (!isTextOnly) continue;
          textOnlyDepth--;
        }
        out += '</' + tag.name + '>';
        if (lowerName === 'svg' && --svgDepth === 0) root = 'after';
        continue;
      }

      if (!allowed) {
        if (SCRIPT_ELEMENTS[localName]) flag(0);
        else if (localName === 'foreignobject') flag(1);
        else flag(2);
        skip(tag, lowerName);
        continue;
      }

      if (root !== 'inside' && !(root === 'before' && lowerName === 'svg')) { flag(8); skip(tag, lowerName); continue; }
      if (textOnlyDepth > 0) { flag(9); skip(tag, lowerName); continue; }

      var attrs = cleanAttrs(localName, tag.attrs, flag);
      out += '<' + tag.name + attrs.map(writeAttr).join('') + tag.tail.replace(/\f/g, ' ') + (tag.selfClosing ? '/>' : '>');

      if (lowerName === 'svg') {
        root = 'inside';
        if (tag.selfClosing) { if (svgDepth === 0) root = 'after'; } else svgDepth++;
      } else if (isTextOnly && !tag.selfClosing) {
        textOnlyDepth++;
      }
    }

    var removed = [];
    SANITISE_LABELS.forEach(function (label, index) { if (found[index]) removed.push(label); });
    return { output: out, removed: removed };
  }

  // Strip Active Content (scripts, event handlers, script URLs, foreignObject,
  // non-SVG elements). Leaves <style>, CSS keyframes and SMIL <animate>
  // untouched — declarative animation survives; only script vectors go.
  function sanitiseSVG(svg) {
    return runSanitise(svg).output;
  }

  // Report What the Sanitise Pass Would Remove (for caller warnings)
  function sanitiseReport(svg) {
    return runSanitise(svg).removed;
  }

  //
  //------- SVG-to-CSS -------//
  //

  function svgToDataURI(svg) {
    var encoded = svg.replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/[\t\n\r]/gm, '')
      .replace(/\s\s+/g, ' ').replace(/'/g, '"').replace(/> </g, '><');
    return "url('data:image/svg+xml," + encoded + "')";
  }

  function wrapCSSHelper(dataURI, format) {
    switch (format) {
      case 'basic':
        return 'background-image: ' + dataURI + ';';
      case 'advanced':
        return '/* background-color: #FFFFFF; */\n'
          + 'background-image: ' + dataURI + ';\n'
          + '/* background-attachment: fixed | scroll; */\n'
          + '/* background-size: auto | cover | contain | 500px 250px; */\n'
          + '/* background-position: center | right 30px bottom 15px; */\n'
          + '/* background-repeat: no-repeat | repeat | repeat-x; */\n'
          + '/* background-origin: border-box | padding-box | content-box; */\n'
          + '/* background-clip: border-box | padding-box | content-box; */\n'
          + '/* background-blend-mode: multiply | screen | overlay; */';
      case 'bullets':
        return 'li {\n  list-style-image: ' + dataURI + ';\n}\nli::marker {\n  font-size: 1.5em;\n  line-height: 0.1em;\n}';
      case 'class':
        return '.your-class {\n  background-image: ' + dataURI + ';\n}';
      default:
        return dataURI;
    }
  }

  //
  //------- Core Processing -------//
  //

  /**
   * Process SVG code.
   *
   * options:
   *   sanitise      bool  strip scripts/handlers/js-links/foreignObject (recommended: true)
   *   currentColor  bool  set all shape fills to currentColor
   *   size          bool  force width="100%" height="100%" (icon/logo imply this)
   *   standalone    bool  re-add xmlns + XML declaration, for .svg files
   *   icon          bool  wrap in icon div; iconName adds the icon attribute
   *   logo          bool  wrap in logo div with aspect-ratio; logoName names it
   *   css           bool  output as CSS data-URI; cssFormat picks the wrapper
   *   stripComments, stripMetadata, minify  bool
   *   precision     number|null  round decimals to N places
   *   iconClass, iconAttr, logoClass, logoAttr  string  wrapper conventions
   */
  function processSVG(svgCode, options) {
    var opts = options || {};
    var iconClass = opts.iconClass || DEFAULTS.iconClass;
    var iconAttr = opts.iconAttr || DEFAULTS.iconAttr;
    var logoClass = opts.logoClass || DEFAULTS.logoClass;
    var logoAttr = opts.logoAttr || DEFAULTS.logoAttr;

    var code = svgCode;

    // Strip wrapping elements (e.g. pasted from HTML with icon/logo wrappers)
    var svgMatch = code.match(/<svg[\s\S]*<\/svg>/i);
    if (svgMatch) code = svgMatch[0];

    // Security pass first — nothing downstream should see active content
    if (opts.sanitise) code = sanitiseSVG(code);

    // Extract original dimensions before modifying (needed for logo aspect-ratio)
    var origW = null, origH = null;
    if (opts.logo) {
      var wm = code.match(/<svg[^>]*?\s+width=["']([^"']*?)["']/i);
      var hm = code.match(/<svg[^>]*?\s+height=["']([^"']*?)["']/i);
      origW = wm ? cssDimension(wm[1]) : null;
      origH = hm ? cssDimension(hm[1]) : null;

      // Fall back to viewBox when width/height are missing or not usable in
      // CSS aspect-ratio (percentages, units) — viewBox is always unitless
      if (!origW || !origH) {
        var vbm = code.match(/<svg[^>]*?\s+viewBox=["']([^"']*?)["']/i);
        if (vbm) {
          var vbParts = vbm[1].split(/[\s,]+/);
          if (vbParts.length >= 4) {
            origW = cssDimension(vbParts[2]);
            origH = cssDimension(vbParts[3]);
          }
        }
      }
    }

    // Remove xmlns attributes from root svg tag (run twice: xmlns + xmlns:xlink)
    code = code.replace(/<svg([^>]*?)\s+xmlns(?::xlink)?=(?:"[^"]*"|'[^']*')([^>]*?)>/g, '<svg$1$2>');
    code = code.replace(/<svg([^>]*?)\s+xmlns(?::xlink)?=(?:"[^"]*"|'[^']*')([^>]*?)>/g, '<svg$1$2>');

    // Tidy root <svg> attributes — icon/logo imply 100% sizing (SVG fills wrapper)
    var applySize = opts.size || opts.logo || opts.icon;
    code = code.replace(/<svg([^>]*?)>/, function (_m, attrs) {
      var a = attrs;
      if (applySize) {
        a = a.replace(/\s+width=(?:"[^"]*"|'[^']*')/gi, '').replace(/\s+height=(?:"[^"]*"|'[^']*')/gi, '');
        a += ' width="100%" height="100%"';
      } else {
        // Set explicit width/height from viewBox when missing
        var vbm = a.match(/viewBox=["']([^"']*?)["']/i);
        if (vbm) {
          var parts = vbm[1].split(/[\s,]+/);
          if (parts.length >= 4) {
            if (!/\s+width="/i.test(a)) a += ' width="' + parts[2] + '"';
            if (!/\s+height="/i.test(a)) a += ' height="' + parts[3] + '"';
          }
        }
      }
      // Standalone files and CSS data-URIs are parsed as XML — namespace required
      if (opts.standalone || opts.css) a += ' xmlns="http://www.w3.org/2000/svg"';
      return '<svg' + a + '>';
    });

    // Set fill to currentColor on all shape elements (attribute + inline style)
    if (opts.currentColor) {
      // Lookahead keeps the "line" alternative from matching <linearGradient>
      code = code.replace(/<(path|rect|circle|ellipse|polygon|polyline|line)(?=[\s/>])([^>]*?)(\/?)\s*>/g, function (_m, tag, attrs, selfClose) {
        if (attrs.includes('fill=')) attrs = attrs.replace(/fill=(?:"[^"]*"|'[^']*')/g, 'fill="currentColor"');
        else attrs += ' fill="currentColor"';
        if (attrs.includes('style=')) {
          attrs = attrs.replace(/style="([^"]*?)"/g, function (_sm, s) {
            var ns = s.replace(/fill\s*:\s*[^;]+/g, 'fill: currentColor');
            if (!s.includes('fill:')) return 'style="' + s + '; fill: currentColor"';
            return 'style="' + ns + '"';
          });
        }
        return '<' + tag + attrs + selfClose + '>';
      });
    }

    if (opts.stripComments) code = stripComments(code);
    if (opts.stripMetadata) code = stripMetadata(code);
    if (typeof opts.precision === 'number' && !isNaN(opts.precision)) {
      // toFixed throws outside [0, 100]
      code = roundDecimals(code, Math.min(100, Math.max(0, Math.floor(opts.precision))));
    }
    if (opts.minify) code = minifySVG(code);

    var result = code.trim();
    if (opts.standalone) result = '<?xml version="1.0" encoding="UTF-8"?>\n' + result;

    // Wrap in logo block (takes precedence over icon)
    if (opts.logo) {
      var ln = sanitiseName(opts.logoName || 'default');
      var as = (origW && origH) ? ' style="aspect-ratio: ' + origW + ' / ' + origH + '"' : '';
      result = result.replace(/<svg([^>]*)>/, '<svg ' + logoAttr + '="' + ln + '"$1>');
      result = '<div class="' + logoClass + '"' + as + '>\n  ' + result + '\n</div>';
    }

    // Wrap in icon block
    if (opts.icon && !opts.logo) {
      if (opts.iconName) {
        var icn = sanitiseName(opts.iconName);
        result = result.replace(/<svg([^>]*)>/, '<svg ' + iconAttr + '="' + icn + '"$1>');
      }
      result = '<div class="' + iconClass + '">\n  ' + result + '\n</div>';
    }

    // CSS output mode (modes are mutually exclusive — UI/CLI enforce that)
    if (opts.css) {
      var uri = svgToDataURI(result);
      result = wrapCSSHelper(uri, opts.cssFormat);
    }

    return result;
  }

  //
  //------- Exports -------//
  //

  return {
    VERSION: VERSION,
    MAX_INPUT_BYTES: MAX_INPUT_BYTES,
    DEFAULTS: DEFAULTS,
    processSVG: processSVG,
    sanitiseSVG: sanitiseSVG,
    sanitiseReport: sanitiseReport,
    sanitiseName: sanitiseName,
    svgToDataURI: svgToDataURI,
    wrapCSSHelper: wrapCSSHelper,
  };
});
