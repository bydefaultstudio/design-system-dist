/* @bydefaultstudio/design-system v8.2.0 */
/**
 * library-core.mjs — the pure half of the Asset Library route: path parsing,
 * Range arithmetic and the download headers. No Workers APIs and no I/O, so
 * scripts/verify-asset-library.mjs runs it in plain node (the gate.mjs
 * argument, and the same reason it is .mjs). worker/library.js is the half
 * that talks to R2.
 *
 * URL shapes (asset-library-plan.md §4.5):
 *   /files/_t/<sha256>-320.webp, -640.webp, .svg   thumbnails, content-addressed
 *   /files/<asset id>/<filename>                     an original, by the catalog's name
 */

export const FILES_PREFIX = '/files/';
export const THUMB_CACHE_CONTROL = 'private, max-age=31536000, immutable';
export const FILE_CACHE_CONTROL = 'private, no-cache';
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const THUMB_PATTERN = /^_t\/([0-9a-f]{64})(?:-(320|640)\.webp|\.svg)$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[\u0000-\u001f\u007f"\\/]/;

/**
 * What a /files/ path asks for, or null when it asks for nothing we serve.
 * Thumbnail paths are matched raw (hex and a fixed suffix, nothing to decode).
 * File paths are percent-decoded once, then every segment is checked, so
 * `%2e%2e`, `%2f`, an empty segment and a dotfile all land on null — a 404,
 * never a lookup.
 * @returns {{kind:'thumb',key:string,contentType:string}|{kind:'file',id:string,name:string,lookup:string}|null}
 */
export function parseFilesPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(FILES_PREFIX)) return null;
  const rest = pathname.slice(FILES_PREFIX.length);
  if (!rest) return null;

  const thumb = THUMB_PATTERN.exec(rest);
  if (thumb) {
    return thumb[2]
      ? { kind: 'thumb', key: `t/${thumb[1]}-${thumb[2]}.webp`, contentType: 'image/webp' }
      : { kind: 'thumb', key: `t/${thumb[1]}.svg`, contentType: 'image/svg+xml' };
  }
  if (rest.startsWith('_')) return null; // _t, _p, _m are the Worker's own; nothing else starts with one

  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  const segments = decoded.split('/');
  if (segments.length !== 2) return null;
  const [id, name] = segments;
  if (!ID_PATTERN.test(id)) return null;
  if (!name || name === '.' || name === '..' || name.startsWith('.') || UNSAFE_NAME.test(name) || name !== name.trim()) return null;
  return { kind: 'file', id, name, lookup: `${id}/${name}` };
}

function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `attachment; filename="ascii"; filename*=UTF-8''pct` (RFC 6266 / 5987).
 * The plain filename is the ASCII fallback old clients read; quotes,
 * backslashes and anything outside printable ASCII become underscores there
 * so the quoted-string cannot be broken out of. The starred form carries the
 * real name. `type` is 'attachment' or 'inline' (the ?view=1 case).
 */
export function contentDisposition(type, name) {
  const kind = type === 'inline' ? 'inline' : 'attachment';
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRFC5987(String(name))}`;
}

/**
 * One byte range against a known size (RFC 9110 §14). Returns null for no
 * header or one we do not honour (multiple ranges, another unit, garbage —
 * all served whole, which is what the spec allows), 'unsatisfiable' for a
 * range past the end, else { offset, length } with the end clamped to size.
 */
export function parseRange(header, size) {
  if (!header || typeof header !== 'string') return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;
  if (!Number.isFinite(size) || size <= 0) return 'unsatisfiable';
  if (startText === '') {
    const suffix = Number(endText);
    if (suffix === 0) return 'unsatisfiable';
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(startText);
  if (start >= size) return 'unsatisfiable';
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}

/**
 * Headers for an original. Every response is private and revalidates: the
 * URL is stable while the bytes may change (a re-exported logo keeps its
 * name), so the browser asks and the ETag answers. An SVG original gets the
 * same sandbox CSP as its thumbnail: ?view=1 opens it as a document on this
 * origin, where a <script> in a supplier's file would otherwise run as the
 * signed-in viewer. PDFs are left alone — a sandboxed document cannot host
 * the browser's PDF viewer.
 */
export function fileHeaders({ mime, size, etag, name, inline, range, setCookies = [] }) {
  const headers = new Headers();
  headers.set('Content-Type', mime || 'application/octet-stream');
  headers.set('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', name));
  headers.set('Cache-Control', FILE_CACHE_CONTROL);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.append('Vary', 'Cookie');
  if (mime === 'image/svg+xml') headers.set('Content-Security-Policy', SVG_CSP);
  if (etag) headers.set('ETag', etag);
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set('Content-Length', String(range.length));
  } else if (Number.isFinite(size)) {
    headers.set('Content-Length', String(size));
  }
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie);
  return headers;
}

/**
 * Headers for a thumbnail. Content-addressed, so it can be cached for a year
 * — privately: a deliberate exception to privateHeaders()' no-store, paid for
 * by `Clear-Site-Data: "cache"` on sign-out (worker/auth.js). An SVG also
 * gets a CSP that sandboxes it and refuses every script and fetch, in case it
 * is ever opened as a document rather than drawn in an <img>.
 */
export function thumbHeaders({ contentType, size, etag, setCookies = [] }) {
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', THUMB_CACHE_CONTROL);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.append('Vary', 'Cookie');
  if (etag) headers.set('ETag', etag);
  if (Number.isFinite(size)) headers.set('Content-Length', String(size));
  if (contentType === 'image/svg+xml') headers.set('Content-Security-Policy', SVG_CSP);
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie);
  return headers;
}

/**
 * Whether a reader may take an original at the library's download level
 * (LIBRARY_DOWNLOAD_ACCESS in library-index.mjs). The gate has already let
 * them in, so a guest never gets here (no grant reaches /files/); what is
 * left is an admin level above a team member. download-lock.js shows the
 * same answer as a locked Download.
 */
export function mayDownload(reader, level) {
  if (level === 'public') return true;
  if (!reader) return false;
  if (level === 'owner') return reader.role === 'owner';
  if (level === 'admin') return reader.role === 'admin' || reader.role === 'owner';
  return true;
}
