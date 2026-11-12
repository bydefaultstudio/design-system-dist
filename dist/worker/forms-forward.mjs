/* @bydefaultstudio/design-system v8.1.1 */
/**
 * forms-forward.mjs - the site's half of the form service
 * (engine-parity-phase-c.md, C2). Engine code: ships with createGate().
 *
 * A site that passes `forms: { relay: 'https://…/api/forms/relay' }` to
 * createGate() gets POST /api/submit-form, where the kit's feedback.js and
 * access-support-form.js post. This route never stores anything and holds
 * no Notion key, Turnstile secret or form schema. It checks what only the
 * site can check, then forwards the form to the relay, signed with the
 * site's key (the SITE_KEY secret):
 *
 *   - the body cap (read with a hard limit), and an origin on the site's
 *     own domains
 *   - feedback: this origin exactly, and a live session. The reader's
 *     email comes from the session, never from the body
 *   - any other form: the reader too when a live session from this origin
 *     came with it, so a signed-in reader skips the spam check
 *
 * The relay checks the form's fields, Turnstile and the rate limit. It stores
 * feedback without the reader's email or a follow-up, and emails an access
 * request to the site's own inbox (its access_inbox) rather than keeping it.
 * The reader forwarded here only lets the relay skip the spam check.
 */
import { readCappedText } from './body-cap.mjs';
import { hasSessionCookie, isAllowedHost, isSameOrigin } from './gate.mjs';
import { requireSession } from './session.js';

export const SUBMIT_FORM_PATH = '/api/submit-form';

// Real forms are a few KB of text, with no file upload; the relay holds the same cap.
const MAX_BODY_BYTES = 50000;
const RELAY_TIMEOUT_MS = 10000;
const MAX_PAGE_LENGTH = 2000;
// The forms that ride the session cookie, and so need one.
const SESSION_FORMS = new Set(['feedback']);

/**
 * The `forms` option, checked: { relay } with an https URL, or null when the
 * site has none. A malformed one stops createGate(), so a typo never ships a
 * form that posts nowhere.
 */
export function formsOption(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('createGate: `forms` must be an object: { relay: \'https://…/api/forms/relay\' }');
  let relay;
  try {
    relay = new URL(value.relay);
  } catch {
    throw new Error('createGate: `forms.relay` must be the form service\'s full https address');
  }
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash) {
    throw new Error('createGate: `forms.relay` must be a plain https address, with no credentials, query or fragment');
  }
  return Object.freeze({ relay: relay.href });
}

function json(status, payload, setCookies = []) {
  const response = new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
  for (const cookie of setCookies) response.headers.append('Set-Cookie', cookie);
  return response;
}

/** Whether the post comes from a page on one of the site's domains. */
function fromThisSite(headers) {
  const source = headers.get('origin') || headers.get('referer');
  if (!source) return false;
  try {
    return isAllowedHost(new URL(source).hostname);
  } catch {
    return false;
  }
}

async function readBody(request) {
  const read = await readCappedText(request, MAX_BODY_BYTES);
  if (read.tooLarge) return { refusal: json(413, { error: 'Request too large' }) };
  if (read.failed) return { refusal: json(400, { error: 'Invalid JSON body' }) };
  let body;
  try {
    body = JSON.parse(read.text);
  } catch {
    return { refusal: json(400, { error: 'Invalid JSON body' }) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { refusal: json(400, { error: 'Invalid JSON body' }) };
  return { body };
}

/**
 * The reader behind a live session from this origin exactly, or null. With
 * `required`, a missing one is the answer to send instead.
 */
async function sessionReader(request, env, url, required) {
  if (!required && (!hasSessionCookie(request.headers.get('cookie')) || !isSameOrigin(request.headers, url.origin, request.method))) {
    return { reader: null, setCookies: [] };
  }
  // null: any signed-in reader, guests included. The page check would judge
  // /api/submit-form as a team page, which no guest grant reaches.
  const gate = await requireSession(request, env, url, null);
  if (gate.deny) {
    const cleared = gate.deny.headers.getSetCookie();
    gate.deny.body?.cancel();
    if (required) return { refusal: json(401, { error: 'Sign in to send feedback.' }, cleared) };
    return { reader: null, setCookies: cleared };
  }
  return { reader: gate.reader, setCookies: gate.setCookies };
}

/** A Referer as origin and path only, or '' when it is not a URL. */
function pageWithoutQuery(referer) {
  if (!referer) return '';
  try {
    const page = new URL(referer);
    return `${page.origin}${page.pathname}`;
  } catch {
    return '';
  }
}

/** POST /api/submit-form: check, then forward to the relay. */
export async function handleFormsForward(request, env, url, forms, fetchImpl = fetch) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!env.SITE_KEY) {
    console.error('forms: the SITE_KEY secret is not set, so no form can be sent. Ask for this site\'s key and set it with `wrangler secret put SITE_KEY`.');
    return json(503, { error: 'Forms are not set up on this site yet: its site key is missing.' });
  }
  if (!fromThisSite(request.headers)) return json(403, { error: 'Forbidden' });

  const read = await readBody(request);
  if (read.refusal) return read.refusal;
  const body = read.body;
  if (typeof body.formType !== 'string' || !body.formType || !body.data) return json(400, { error: 'Missing formType or data' });

  const needsSession = SESSION_FORMS.has(body.formType);
  // A form that rides the session cookie takes this origin exactly: the
  // cookie is SameSite=Lax, so a page on a sibling subdomain sends it too.
  if (needsSession && !isSameOrigin(request.headers, url.origin, request.method)) return json(403, { error: 'Forbidden' });
  const session = await sessionReader(request, env, url, needsSession);
  if (session.refusal) return session.refusal;
  const setCookies = session.setCookies;

  // The page, without its query or fragment: a token or search in the
  // address is not the form service's to keep.
  const referer = pageWithoutQuery(request.headers.get('referer'));
  const forwarded = {
    formType: body.formType,
    data: body.data,
    // Only ever the session's: an email in the body is never forwarded as the reader's.
    reader: session.reader && typeof session.reader.email === 'string' ? { email: session.reader.email } : null,
    turnstile: typeof body.turnstile === 'string' ? body.turnstile : '',
    ip: request.headers.get('cf-connecting-ip') || '',
    // The host the form was posted to: the relay checks the Turnstile token
    // was minted on it. A fully qualified host (example.com.) is the same site.
    host: url.hostname.replace(/\.$/, ''),
    page: referer ? referer.slice(0, MAX_PAGE_LENGTH) : '',
    hp: typeof body.hp === 'string' ? body.hp : '',
  };

  let res;
  try {
    res = await fetchImpl(forms.relay, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SITE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(forwarded),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      // Never follow: a redirect would carry the form, and on some runtimes
      // the key, to an address the site never configured.
      redirect: 'manual',
    });
  } catch (err) {
    console.error('forms: the form service did not answer', err);
    return json(502, { error: 'The form could not be sent. Try again in a minute.' }, setCookies);
  }

  if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
    res.body?.cancel();
    console.error(`forms: the form service answered with a redirect (${res.status}). Check \`forms.relay\`.`);
    return json(502, { error: 'The form could not be sent. Try again in a minute.' }, setCookies);
  }

  // 401 from the relay is always this site's key, never the reader.
  if (res.status === 401) {
    res.body?.cancel();
    console.error('forms: the form service refused this site\'s key. Check the SITE_KEY secret.');
    return json(503, { error: 'This form is unavailable right now. Try again later.' }, setCookies);
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') {
    return json(502, { error: 'The form could not be sent. Try again in a minute.' }, setCookies);
  }
  // Only the two keys the browser half reads.
  const answer = res.ok ? { success: true } : { error: typeof payload.error === 'string' ? payload.error : 'The form could not be sent.' };
  return json(res.ok ? 200 : res.status, answer, setCookies);
}
