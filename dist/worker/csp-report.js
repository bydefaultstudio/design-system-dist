/* @bydefaultstudio/design-system v8.0.0 */
/**
 * csp-report.js - where browsers send Content-Security-Policy violations.
 *
 * POST /api/csp-report
 *
 * createGate() answers it for every site (turn it off with cspReport: false).
 * A site's _headers points its policy's report-uri here; under a report-only
 * policy nothing is blocked, and every violation a browser sees is written to
 * Workers Logs as one `csp.report` line, so the policy can be tightened from
 * what pages really load before it is enforced.
 *
 * Public, before the gate: a signed-out visitor on the login page reports too.
 * It writes nothing but a log line, so an open door costs only log volume.
 * Anything not sent as a report type is answered 204 unread, a body is cut off
 * past 16 KB however it arrives, and at most five reports a post are logged.
 * Takes both shapes browsers send: the older `report-uri` body
 * (application/csp-report, one object under "csp-report") and the Reporting
 * API's (application/reports+json, an array of { type, body }). Query strings
 * and fragments are cut from every URL before logging: a page address can
 * carry a sign-in link's token or an email address.
 */

// One report is a few hundred bytes; a Reporting API batch a few KB.
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS = 5;
const MAX_FIELD_LENGTH = 300;
const REPORT_TYPES = ['application/csp-report', 'application/reports+json'];
// Browser extensions inject what the page never asked for: most of the noise.
const EXTENSION_SCHEME = /^(chrome|moz|safari-web|ms-browser)-extension:/;

// The engine answers it for every site (gate-entry.mjs, createGate); a
// site's _headers points its policy's report-uri / report-to here.
export const CSP_REPORT_PATH = '/api/csp-report';

export async function handleCspReport(request) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  // Anything that is not a report is answered without being read.
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!REPORT_TYPES.includes(type)) return new Response(null, { status: 204 });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const text = await readCapped(request);
  if (text === null) return new Response(null, { status: 413 });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  for (const report of readReports(parsed).slice(0, MAX_REPORTS)) {
    console.warn(JSON.stringify({ event: 'csp.report', ...report }));
  }
  return new Response(null, { status: 204 });
}

/**
 * The body as text, read a chunk at a time and abandoned past the cap, so a
 * chunked request with no Content-Length is never buffered whole. Null when
 * it is over the cap or the stream fails.
 */
async function readCapped(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Normalise either body shape to the few fields worth reading, extension noise dropped. */
export function readReports(parsed) {
  return collect(parsed).filter((r) => !EXTENSION_SCHEME.test(r.blocked || '') && !EXTENSION_SCHEME.test(r.source || ''));
}

function collect(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed['csp-report'] && typeof parsed['csp-report'] === 'object') {
    const r = parsed['csp-report'];
    return [summarise(r['document-uri'], r['effective-directive'] || r['violated-directive'], r['blocked-uri'], r['source-file'], r['line-number'], r.disposition)];
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry) => entry && entry.type === 'csp-violation' && entry.body && typeof entry.body === 'object')
      .map(({ body: b }) => summarise(b.documentURL, b.effectiveDirective, b.blockedURL, b.sourceFile, b.lineNumber, b.disposition));
  }
  return [];
}

function summarise(page, directive, blocked, source, line, disposition) {
  return {
    page: stripUrl(page),
    directive: clip(directive),
    blocked: stripUrl(blocked),
    source: stripUrl(source),
    line: line === null || line === undefined || line === '' || !Number.isFinite(Number(line)) ? null : Number(line),
    disposition: clip(disposition),
  };
}

/** A URL without its query or fragment; a keyword ("inline", "eval") as it is. */
export function stripUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  const cut = value.split(/[?#]/)[0];
  return clip(cut);
}

function clip(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}
