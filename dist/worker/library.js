/* @bydefaultstudio/design-system v8.0.0 */
/**
 * library.js — the Asset Library's files, streamed from R2 at /files/
 * (asset-library-plan.md §4.5).
 *
 * Runs AFTER the gate, mounted by createGate() when the site installs the
 * Asset Library (engine parity B4): /files/ is in no public list, so by
 * the time a request lands here it carries a session, and every answer below
 * is private. Two kinds of path, decided by library-core.mjs:
 *
 *   thumbnails  /files/_t/<sha>…   straight to the bucket by content hash,
 *                                   cached privately for a year
 *   originals   /files/<id>/<name>  through LIBRARY_INDEX — a generated map
 *                                   of what the catalog offers. A path not in
 *                                   it is a 404 whatever the bucket holds, so
 *                                   removing an asset from the catalog revokes
 *                                   its download on the next deploy.
 *
 * GET and HEAD only. Range requests are honoured one range at a time with the
 * arithmetic done here (the size is known from the index), conditional
 * requests are handed to R2's onlyIf. `?view=1` serves inline instead of as a
 * download — how the page opens a PDF in a tab.
 */
import { contentDisposition, fileHeaders, mayDownload, parseFilesPath, parseRange, thumbHeaders } from './library-core.mjs';

function plain(status, text, setCookies = []) {
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' });
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie);
  return new Response(text, { status, headers });
}

/**
 * @param {{ index: Map, downloadAccess: string }} library the site's generated
 *   worker/library-index.mjs (LIBRARY_INDEX, LIBRARY_DOWNLOAD_ACCESS), passed
 *   to createGate({ library }): the engine never imports a site's file.
 */
export async function handleLibrary(request, env, url, setCookies = [], reader = null, library = null) {
  // A caller from before B4 passes no index: unavailable, never a 500
  if (!library || !(library.index instanceof Map)) return plain(503, UNAVAILABLE, setCookies);
  const LIBRARY_INDEX = library.index;
  const LIBRARY_DOWNLOAD_ACCESS = library.downloadAccess;
  const { method } = request;
  if (method !== 'GET' && method !== 'HEAD') {
    const response = plain(405, 'Method not allowed', setCookies);
    response.headers.set('Allow', 'GET, HEAD');
    return response;
  }
  const target = parseFilesPath(url.pathname);
  if (!target) return plain(404, 'Not found', setCookies);
  if (target.kind !== 'thumb' && !mayDownload(reader, LIBRARY_DOWNLOAD_ACCESS)) return plain(403, 'Downloads are for admins.', setCookies);
  if (!env.LIBRARY) return plain(503, UNAVAILABLE, setCookies);

  // R2 can throw on a transient fault or an offset past the object's end;
  // without this the visitor would see a bare 500 with no private headers.
  try {
    return await serve(request, env, url, target, setCookies);
  } catch (error) {
    console.error(JSON.stringify({ event: 'library.error', path: url.pathname, message: error && error.message }));
    return plain(503, UNAVAILABLE, setCookies);
  }
}

const UNAVAILABLE = 'The file store is not available right now. Try again in a minute.';

async function serve(request, env, url, target, setCookies) {
  const { method } = request;

  if (target.kind === 'thumb') {
    const object = method === 'HEAD' ? await env.LIBRARY.head(target.key) : await env.LIBRARY.get(target.key);
    if (!object) return plain(404, 'Not found', setCookies);
    const headers = thumbHeaders({ contentType: target.contentType, size: object.size, etag: object.httpEtag, setCookies });
    return new Response(method === 'HEAD' ? null : object.body, { status: 200, headers });
  }

  const hit = LIBRARY_INDEX.get(target.lookup);
  if (!hit) return plain(404, 'Not found', setCookies);
  const [key, mime, size] = hit;
  const inline = url.searchParams.get('view') === '1';

  if (method === 'HEAD') {
    const object = await env.LIBRARY.head(key);
    if (!object) return plain(404, 'Not found', setCookies);
    return new Response(null, { status: 200, headers: fileHeaders({ mime, size: object.size, etag: object.httpEtag, name: target.name, inline, setCookies }) });
  }

  let range = parseRange(request.headers.get('Range'), size);
  if (range === 'unsatisfiable') {
    const response = plain(416, 'Range not satisfiable', setCookies);
    response.headers.set('Content-Range', `bytes */${size}`);
    return response;
  }

  // R2 honours every conditional header except If-Range, so a resumed
  // download is checked here: if the ETag the client resumes against is not
  // the current object's, the range is dropped and the whole file is sent,
  // as RFC 9110 §13.1.5 says — never a slice of a different file.
  const ifRange = request.headers.get('If-Range');
  if (range && ifRange) {
    const current = await env.LIBRARY.head(key);
    if (!current) return plain(404, 'Not found', setCookies);
    if (ifRange.trim() !== current.httpEtag) range = null;
  }

  const options = { onlyIf: request.headers };
  if (range) options.range = { offset: range.offset, length: range.length };
  const object = await env.LIBRARY.get(key, options);
  if (!object) return plain(404, 'Not found', setCookies);

  // R2 returns the metadata with no body when a precondition fails. If-Match
  // is evaluated before If-None-Match (RFC 9110 §13.2.2), so a failing
  // If-Match is a 412 even when an If-None-Match rides along.
  if (!object.body) {
    const notModified = !request.headers.has('If-Match')
      && (request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since'));
    const headers = fileHeaders({ mime, size: null, etag: object.httpEtag, name: target.name, inline, setCookies });
    headers.delete('Content-Length');
    return new Response(null, { status: notModified ? 304 : 412, headers });
  }

  // Content-Range and Content-Length come from what R2 actually returned
  // (its `range` is clamped to the real object), not from the index.
  const served = range && object.range && typeof object.range.offset === 'number'
    ? { offset: object.range.offset, length: object.range.length }
    : range;
  const headers = fileHeaders({ mime, size: object.size, etag: object.httpEtag, name: target.name, inline, range: served, setCookies });
  return new Response(object.body, { status: served ? 206 : 200, headers });
}

export { contentDisposition };
