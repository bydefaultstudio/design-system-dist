/* @bydefaultstudio/design-system v7.5.0 */
/**
 * hidden-nav.mjs - per-reader navigation for `accessNav: 'hidden'`
 * (levels-groups-plan.md D19, §3.3).
 *
 * Under 'locked' (By Default OS) every reader gets the same page and nav.js
 * paints locks. Under 'hidden' a page a reader cannot open must not reach
 * them at all, not even its title, so the list cannot sit in one static file
 * every reader downloads. The generator moves the sidebar list into each
 * page (#site-nav-source) and marks every link and card with the level of
 * the page it points at (`data-access`). This removes, on the way out, every
 * marked element the reader may not open: sidebar links, index cards and the
 * pager. nav.js then drops the list items and sections left empty.
 *
 * Presentation of the verdict only. The gate still refuses the page itself;
 * this keeps its title out of the reader's hands.
 */
import { navVisible } from './gate.mjs';

// Elements that carry data-access for their own sake, not for a link: the
// page's own level sits on <body>, and is never removed.
const OWN_LEVEL_TAGS = new Set(['html', 'body', 'main']);

// Resolved against the page's own URL, not the origin: the pager's links are
// page-relative (`components.html` on /web/button.html is /web/components.html).
function hrefPath(href, base) {
  try {
    return new URL(href, base).pathname;
  } catch {
    return '';
  }
}

/**
 * The element handler, apart from HTMLRewriter, so scripts/verify-hidden-nav.mjs
 * can drive it with any rewriter. `reader` is { role, scopes } or null.
 */
export function hidingHandler(reader, base) {
  const role = reader ? reader.role : null;
  const scopes = reader && Array.isArray(reader.scopes) ? reader.scopes : [];
  return {
    element(el) {
      if (OWN_LEVEL_TAGS.has(el.tagName)) return;
      const level = el.getAttribute('data-access') || 'team';
      // Every marked element is the link itself: a sidebar link, a card or
      // the pager. Its href names the page whose level it carries.
      const href = el.getAttribute('href') || '';
      if (!navVisible(role, scopes, level, hrefPath(href, base))) el.remove();
    },
  };
}

/**
 * A wrapper that holds links - a sidebar section or subsection, an index
 * group - carries them all as `level:path` in data-access-any. It stays when
 * the reader may open any one of them, and goes, label and all, when none:
 * the rewriter streams and cannot look ahead at children.
 */
export function wrapperHandler(reader, base) {
  const role = reader ? reader.role : null;
  const scopes = reader && Array.isArray(reader.scopes) ? reader.scopes : [];
  return {
    element(el) {
      const entries = (el.getAttribute('data-access-any') || '').split(/\s+/).filter(Boolean);
      const open = entries.some((entry) => {
        const at = entry.indexOf(':');
        return at > 0 && navVisible(role, scopes, entry.slice(0, at), hrefPath(entry.slice(at + 1), base));
      });
      if (open) el.removeAttribute('data-access-any');
      else el.remove();
    },
  };
}

/** Whether a response is a page this pass applies to: any HTML, a 404 or 403 page included. */
export function isHtml(response) {
  const type = response.headers.get('content-type') || '';
  return type.toLowerCase().includes('text/html');
}

/**
 * The response with every link, card and wrapper above the reader removed.
 * `base` is the URL of the page being served. The ETag goes: readers who see
 * different HTML must not share one validator.
 */
export function hideForReader(response, reader, base) {
  if (!isHtml(response)) return response;
  const role = reader ? reader.role : 'out';
  const out = new Response(response.body, response);
  out.headers.delete('ETag');
  return new HTMLRewriter()
    .on('[data-access-any]', wrapperHandler(reader, base))
    .on('[data-access]', hidingHandler(reader, base))
    // nav.js compares this with the session answer and reloads a sidebar
    // cut for a role the reader no longer has.
    .on('#site-nav-source', { element(el) { el.setAttribute('data-cut-for', role); } })
    .transform(out);
}
