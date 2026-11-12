/* @bydefaultstudio/design-system v8.1.0 */
/**
 * body-cap.mjs - a request body read with a hard byte limit. Engine code:
 * ships with createGate().
 *
 * The declared Content-Length is checked first, then the body is read a
 * chunk at a time and abandoned the moment it passes the cap, so a chunked
 * request with no Content-Length, or a false one, is never buffered whole.
 * Used by the forms forward and By Default OS's own form doors, the way
 * csp-report.js reads its own.
 */

/**
 * The body as text: { text }, or { tooLarge: true } past `maxBytes`, or
 * { failed: true } when the stream breaks.
 */
export async function readCappedText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { failed: true };
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}
