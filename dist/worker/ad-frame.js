/* @bydefaultstudio/design-system v8.8.0 */
/**
 * ad-frame.js — the sandbox Ad Preview runs a pasted ad tag in, /ad-frame.
 *
 * The tag is third-party code, so it never runs as this site. This response
 * carries an enforced `sandbox` CSP, which gives the document an opaque
 * origin however it is opened: the site's cookies, storage and the tool page
 * are out of its reach. The tool also frames it with the same `sandbox`
 * attribute. srcdoc was the other way in and is the wrong one: a srcdoc
 * document inherits the site's own CSP, whose `script-src` will block every
 * tag once the policy is enforced (it is report-only today, _headers).
 *
 * Public, ahead of the gate, while Ad Preview is installed (gate-entry.mjs).
 * The page holds no secrets, and a sandboxed frame's own load may not carry
 * the session cookie in every browser, which would put the login page in the
 * ad slot. What stops it being used as a page of its own:
 *   - only an iframe load is answered (Sec-Fetch-Dest), only GET and HEAD;
 *   - `frame-ancestors 'self'`: only this site may frame it;
 *   - the shim does nothing when it is the top window.
 *
 * The tag arrives in the URL fragment, which never reaches a server or a log:
 * /ad-frame#run=<token>&tag=<encodeURIComponent(tag)>. The shim reads it,
 * strips it from the address (a tag that reports location.href must not send
 * itself on), and writes the tag into the page while it is still parsing, so a
 * document.write tag behaves as it would on a publisher's page. What the tag
 * does is posted to the tool page, which checks each message (ad-preview.js).
 *
 * The shim is a string, not a function's source: wrangler bundles with
 * keepNames, which puts calls to a helper the frame does not have into any
 * function body it is asked to print.
 */

export const AD_FRAME_PATH = '/ad-frame';

// Popups stay so a click-through can be tested, but they stay sandboxed: an
// escaped popup could navigate the tool's own tab through its opener to a
// look-alike sign-in page (reverse tabnabbing), and sandbox flags are what
// stop that, in every browser, however the tool page was reached. The cost:
// some landing pages misbehave in a sandboxed tab. The click is logged with
// its address, so it can be opened fresh. No allow-same-origin (that would
// hand the tag this site), no top navigation, forms or modals.
export const AD_FRAME_SANDBOX = 'allow-scripts allow-popups';

// No default-src: it would say "anything", which is what the tag needs and
// what no directive already means. No report-uri: tags would flood the
// report endpoint. No base-uri: it protects nothing in an opaque origin and
// breaks creatives that set <base href>.
export const AD_FRAME_CSP = `sandbox ${AD_FRAME_SANDBOX}; frame-ancestors 'self'`;

// On a site of its own (worker/ad-frame-entry.js), the frame keeps that
// site's origin, so a tag that writes into a frame of its own works as on a
// publisher's page. allow-same-origin is safe there and only there: the
// origin is not the tool's, so the tag cannot lift the sandbox or reach the
// tool (brand.js adFrameOriginProblem refuses an address on the tool's site).
//
// No popups there: a popup on the frame's origin would outlive its run and
// could reach the next run's frame through its opener, reading or rewriting
// the next tag. Clicks are logged with their address instead, to open fresh.
export const AD_FRAME_SANDBOX_SEPARATE = 'allow-scripts allow-same-origin';

export function adFrameCsp(parentOrigins) {
  if (!parentOrigins) return AD_FRAME_CSP;
  return `sandbox ${AD_FRAME_SANDBOX_SEPARATE}; frame-ancestors ${parentOrigins.join(' ')}`;
}

export const AD_FRAME_SHIM = `(function () {
  'use strict';
  if (window.top === window) return;

  var raw = location.hash.slice(1);
  try { history.replaceState(null, '', location.pathname); } catch (e) {}

  var params = {};
  raw.split('&').forEach(function (pair) {
    var i = pair.indexOf('=');
    if (i < 1) return;
    try { params[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1)); } catch (e) { params.broken = true; }
  });
  var run = params.run || '';

  // The tool page stops reading after 500 rows. This cap only spares it work
  // (a tag can post to it directly); the tool enforces its own. Sizes and
  // clicks are rare and always wanted, so they are outside the cap.
  var sent = 0;
  function post(message) {
    message.bd = 'ad-frame';
    message.run = run;
    try { parent.postMessage(message, '*'); } catch (e) {}
  }
  function send(message) {
    if (message.kind === 'request' || message.kind === 'error') {
      sent += 1;
      if (sent === 601) post({ kind: 'error', message: 'The tag did more than the preview lists. Later activity is not shown.' });
      if (sent > 600) return;
    }
    post(message);
  }
  function clip(value, max) {
    var text = String(value);
    return text.length > max ? text.slice(0, max) : text;
  }
  function describe(value) {
    try {
      if (value && value.message) return String(value.message);
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch (e) {
      return 'an object that could not be read';
    }
  }
  function sendError(message) { send({ kind: 'error', message: clip(message, 500) }); }
  function absolute(url) {
    try { return new URL(String(url), document.baseURI).href; } catch (e) { return String(url); }
  }

  // Sealed: this site's own sandbox, with an opaque origin. On the frame
  // Worker's own site the frame keeps a real origin (ad-frame-entry.js).
  var sealed = window.origin === 'null';

  // An opaque origin has no cookies or storage, and reading them throws. A
  // tag that touches them unguarded would die here and live on a publisher's
  // page, so each gets an in-memory stand-in that lasts for this run.
  function memoryStorage() {
    var data = {};
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  }
  var cookies = {};
  if (sealed) try {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () {
        return Object.keys(cookies).map(function (k) { return k + '=' + cookies[k]; }).join('; ');
      },
      set: function (value) {
        var parts = String(value).split(';');
        var i = parts[0].indexOf('=');
        if (i < 1) return;
        var name = parts[0].slice(0, i).trim();
        // A test cookie set and then expired is a common check: honour the expiry.
        var gone = parts.slice(1).some(function (attr) {
          var a = attr.trim().toLowerCase();
          if (a.indexOf('max-age=') === 0) return parseInt(a.slice(8), 10) <= 0;
          if (a.indexOf('expires=') === 0) return Date.parse(attr.trim().slice(8)) <= Date.now();
          return false;
        });
        if (gone) delete cookies[name];
        else cookies[name] = parts[0].slice(i + 1).trim();
      }
    });
  } catch (e) {}
  if (sealed) ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch (e) {}
  });

  // ── What the tag does ──

  // Requests, from the browser's own resource timeline: images, scripts,
  // fetch and XHR, styles, frames. Beacons are logged when sent instead
  // (below), since one fired as the frame is replaced never completes.
  function watchRequests(win, offset) {
    try {
      new win.PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (entry.initiatorType === 'beacon') return;
          send({
            kind: 'request',
            type: entry.initiatorType || 'other',
            url: clip(entry.name, 8000),
            start: Math.max(0, entry.startTime + offset),
            duration: Math.max(0, entry.duration)
          });
        });
      }).observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }
  watchRequests(window, 0);

  var sendBeacon = navigator.sendBeacon;
  if (sendBeacon) {
    navigator.sendBeacon = function (url) {
      send({ kind: 'request', type: 'beacon', url: clip(absolute(url), 8000), start: performance.now(), duration: 0 });
      return sendBeacon.apply(navigator, arguments);
    };
  }

  // A fetch that fails (blocked, offline, refused) leaves no timeline entry.
  // Each failure is reported once: here, not again as an unhandled rejection.
  var reported = typeof WeakSet === 'function' ? new WeakSet() : null;
  var fetchNative = window.fetch;
  if (fetchNative) {
    window.fetch = function (input) {
      var url = input && input.url ? input.url : input;
      return fetchNative.apply(window, arguments).catch(function (error) {
        if (!(error && error.name === 'AbortError')) {
          sendError('Request failed: ' + clip(absolute(url), 2000));
          if (reported && error && typeof error === 'object') reported.add(error);
        }
        throw error;
      });
    };
  }

  // Load failures (an image, script or frame that didn't arrive) and script
  // errors. A script from another site reports only "Script error.".
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      sendError('Failed to load: ' + clip(target.src || target.href, 2000));
    } else {
      sendError(event.message || 'Script error.');
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    if (reported && event.reason && typeof event.reason === 'object' && reported.has(event.reason)) return;
    sendError('Unhandled promise rejection: ' + describe(event.reason));
  });
  var consoleError = console.error;
  console.error = function () {
    sendError(Array.prototype.map.call(arguments, describe).join(' '));
    return consoleError.apply(console, arguments);
  };

  // Clicks. Popups stay sandboxed (AD_FRAME_SANDBOX); each is logged with
  // its address, which the tool lets the reader open fresh.
  var openNative = window.open;
  window.open = function (url) {
    send({ kind: 'click', url: clip(url ? absolute(url) : 'a blank window', 8000) });
    return openNative.apply(window, arguments);
  };
  function linkOf(event) {
    var link = event.target && event.target.closest && event.target.closest('a[href], area[href]');
    return link && typeof link.href === 'string' ? link : null;
  }
  document.addEventListener('click', function (event) {
    var link = linkOf(event);
    if (link) send({ kind: 'click', url: clip(link.href, 8000) });
  }, true);
  // After the tag has had its say: a real address that would replace this
  // page, or the page above it (which the sandbox refuses), opens in a new
  // tab instead, so the ad stays. "#", javascript: and the like are left to
  // the creative's own handler, whose window.open needs the click.
  window.addEventListener('click', function (event) {
    var link = linkOf(event);
    if (!link || event.defaultPrevented || !/^https?:$/.test(link.protocol)) return;
    if (link.href.split('#')[0] === location.href.split('#')[0]) return;
    var target = (link.getAttribute('target') || '').toLowerCase();
    if (target !== '' && target !== '_self' && target !== '_top' && target !== '_parent') return;
    event.preventDefault();
    openNative.call(window, link.href, '_blank', 'noopener');
  });

  // The size the creative draws, so the tool can say when it is bigger than
  // the slot it was given. Throttled, so a creative that keeps changing still
  // reports.
  var lastSize = '';
  var sizeTimer = null;
  function sendSize() {
    sizeTimer = null;
    var root = document.documentElement;
    var width = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
    var height = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (width + 'x' + height === lastSize) return;
    lastSize = width + 'x' + height;
    send({ kind: 'size', width: width, height: height });
  }
  function soonSize() {
    if (sizeTimer === null) sizeTimer = setTimeout(sendSize, 150);
  }

  // A frame the tag makes for itself (about:blank, srcdoc). On the frame
  // Worker's own site it shares this origin, so its requests are watched too,
  // once per document. Sealed, the sandbox gives it an origin of its own: its
  // requests and clicks can't be seen, and a tag that writes into it fails
  // here though it works on a publisher's page. Said once, so a clean list
  // isn't mistaken for a clean tag.
  var watched = typeof WeakSet === 'function' ? new WeakSet() : null;
  function watchFrame(frame) {
    try {
      var win = frame.contentWindow;
      var doc = win && win.document;
      if (!doc || !watched || watched.has(doc)) return;
      watched.add(doc);
      watchRequests(win, win.performance.timeOrigin - performance.timeOrigin);
    } catch (e) {}
  }
  var toldFrames = false;
  function ownFrame(frame) {
    var src = frame.getAttribute('src');
    if (src && src !== 'about:blank' && !frame.hasAttribute('srcdoc')) return;
    if (!sealed) {
      watchFrame(frame);
      frame.addEventListener('load', function () { watchFrame(frame); });
    } else if (!toldFrames) {
      toldFrames = true;
      sendError('The tag made a frame of its own. The preview\u2019s sandbox seals it off, so what happens inside it isn\u2019t listed, and a tag that writes into it may fail here.');
    }
  }
  new MutationObserver(function (changes) {
    soonSize();
    changes.forEach(function (change) {
      Array.prototype.forEach.call(change.addedNodes, function (node) {
        if (!node.querySelectorAll) return;
        Array.prototype.forEach.call(node.tagName === 'IFRAME' ? [node] : node.querySelectorAll('iframe'), ownFrame);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // document.write or document.open after the page has loaded would wipe the
  // ad and this shim with it. Each is logged and ignored instead.
  document.addEventListener('DOMContentLoaded', function () {
    document.open = document.write = document.writeln = function () {
      sendError('The tag rewrote the page after it loaded. A publisher page would have been wiped; it was ignored here.');
      return document;
    };
    if (window.ResizeObserver && document.body) new ResizeObserver(soonSize).observe(document.body);
  });
  window.addEventListener('load', sendSize);

  send({ kind: 'ready' });
  if (params.broken) sendError('The tag could not be read. Paste it again.');
  else if (params.tag) document.write(params.tag);
})();`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ad</title>
<style>html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; } img, iframe, ins, object, embed, video, canvas, svg { vertical-align: top; }</style>
<script>${AD_FRAME_SHIM}</script>
</head>
<body></body>
</html>
`;

export function adFrameHeaders(parentOrigins) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': adFrameCsp(parentOrigins),
    'Referrer-Policy': 'no-referrer',
    // no-transform: Cloudflare's analytics beacon must not be injected here,
    // or every run would log the site's own beacon as one of the tag's calls.
    'Cache-Control': 'no-store, no-transform',
    'X-Content-Type-Options': 'nosniff',
    // On its own site the origin keeps storage between runs; each run starts
    // clean, so one vendor's tag never reads what the last one left.
    ...(parentOrigins ? { 'Clear-Site-Data': '"cookies", "storage"' } : {}),
  };
}

/**
 * The frame page. With no parentOrigins it is this site's sealed sandbox;
 * with them, the frame Worker on a site of its own, framed only by those.
 */
export function handleAdFrame(request, { parentOrigins = null } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
  }
  // Only an iframe load. A tab, a link or curl gets nothing, so the address
  // can't be sent round as a page of its own.
  if (request.headers.get('sec-fetch-dest') !== 'iframe') {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return new Response(request.method === 'HEAD' ? null : PAGE, { status: 200, headers: adFrameHeaders(parentOrigins) });
}
