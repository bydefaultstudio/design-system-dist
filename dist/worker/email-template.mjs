/* @bydefaultstudio/design-system v8.7.0 */
/**
 * email-template.mjs — the sign-in code email (access-plan.md §4.4).
 *
 * Pure: string functions and nothing else, so it can be rendered in plain
 * node (hence .mjs — the package is "type": "commonjs"). worker/auth.js calls
 * renderOtpEmail() from Better Auth's sendVerificationOTP hook and hands the
 * result to env.EMAIL.send().
 *
 * Why hand-rolled HTML with inline styles: mail clients strip <style> and
 * ignore external CSS, so this is the one place in the repo where inline
 * styles are the correct tool. The colour scheme is pinned to light so no
 * client auto-inverts the card.
 *
 * One look for every brand (Erlen, 2026-11-23): colours, type, spacing and
 * the icons are the engine's. A brand supplies content only, through
 * SITE.email: its company name, its logo and how it writes a date. The only
 * images are that logo and three icons, PNGs on public /assets/ paths, at 2x
 * with their display size stated twice. What survives an inbox, and why, is
 * cms/email-template.md.
 *
 * The plain-text twin is mandatory. Some clients show only that, and a
 * message with no text part scores worse with spam filters.
 */

import { SITE } from './site.mjs';

/**
 * The design system's tokens, copied as literal values: an inbox has no
 * runtime to resolve a custom property, and Gmail strips <style>. This is a
 * deliberate copy, and the only one. When a token named here changes in
 * assets/css/design-system.css or bydefault/assets/theme.css, change it here
 * too (cms/email-template.md, "Keeping it in step"). Every colour is a solid
 * six-digit hex: the Gmail app repaints see-through colours unpredictably.
 */
export const EMAIL_TOKENS = Object.freeze({
  // Colours, light scheme, flattened onto white where the token is an alpha
  page: '#fafafa',     // --off-white (--neutral-50)
  surface: '#ffffff',  // --background-primary
  panel: '#f2f2f2',    // --background-faded (--black-alpha-5 on white)
  ink: '#1f1f1f',      // --text-primary (--off-black)
  faded: '#666666',    // --text-faded (--black-alpha-60 on white)
  rule: '#d9d9d9',     // --border-faded (--black-alpha-15 on white)
  inverse: '#fafafa',  // --text-inverted (--off-white)
  // Type. The brand face leads; it renders only where the reader has it
  // installed, because no web font loads in Gmail or Outlook. The rest is the
  // fallback every client can reach.
  // Single quotes inside: these land in style="...", where a double quote
  // would end the attribute.
  font: "'Zalando Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", // --font-primary
  mono: "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace", // --font-quaternary
  size2xs: '12px',     // --font-2xs
  sizeXs: '14px',      // --font-xs
  sizeS: '16px',       // --font-s
  sizeXl: '22px',      // --font-xl
  size4xl: '32px',     // --font-4xl
  leadingS: '1',       // --line-height-s
  leadingM: '1.2',     // --line-height-m
  leadingL: '1.4',     // --line-height-l
  weightMedium: '500', // --font-weight-medium
  trackingL: '0.12em', // --letter-spacing-l
  // Space
  spaceS: '8px',       // --space-s
  spaceM: '12px',      // --space-m
  spaceL: '16px',      // --space-l
  spaceXl: '24px',     // --space-xl
  space2xl: '32px',    // --space-2xl
  space3xl: '40px',    // --space-3xl
  // Corners: the engine's --radius-scale is 0, so every role is square
  radius: '0',         // --radius-surface, --radius-control
  border: '1px',       // --border-s
});

const T = EMAIL_TOKENS;

/** Where every site serves the engine's email icons (the kit copies them there; /assets/ is public). */
export const EMAIL_ICON_PATH = '/assets/docs-kit/email/';

/** The logo's display height; the PNG is twice this. */
const LOGO_HEIGHT = 32;
/** The card's inner width (480 less 32 each side): a very wide logo shrinks to fit, since Outlook ignores max-width. */
const LOGO_MAX_WIDTH = 416;
const ICON_SIZE = 16;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hostOf(origin) {
  return String(origin).replace(/^https?:\/\//, '');
}

/**
 * An image at 2x: Outlook on Windows reads only the attributes, other
 * clients only the style, so the display size is stated in both.
 */
function image(src, width, height, alt) {
  return `<img src="${escapeHtml(src)}" width="${width}" height="${height}" alt="${escapeHtml(alt)}" style="display:block;border:0;width:${width}px;height:${height}px;">`;
}

/** A table cell with a background: `bgcolor` for the clients that drop CSS backgrounds (the Gmail app did), the style for the rest. */
function filled(colour) {
  return `bgcolor="${colour}" style="background-color:${colour};`;
}

/** A row of body copy inside the card. `html` is already escaped. */
function bodyRow(html, { color = T.ink, size = T.sizeS, bottom = T.spaceS } = {}) {
  return `<tr><td style="padding:0 ${T.space2xl} ${bottom};font-size:${size};line-height:${T.leadingL};color:${color};">${html}</td></tr>`;
}

/** The brand's logo, or its company name set as text where it has no logo. */
function logoRow(origin) {
  const { company, logo } = SITE.email;
  const width = logo ? Math.min(Math.round((logo.width / logo.height) * LOGO_HEIGHT), LOGO_MAX_WIDTH) : 0;
  const mark = logo
    ? image(`${origin}${logo.src}`, width, Math.round((width * logo.height) / logo.width), company)
    : `<span style="font-size:${T.sizeS};line-height:${T.leadingM};font-weight:${T.weightMedium};color:${T.ink};">${escapeHtml(company)}</span>`;
  return `<tr>
            <td style="padding:${T.space2xl} ${T.space2xl} ${T.spaceXl};">${mark}</td>
          </tr>`;
}

/**
 * The frame both emails share: page, card, logo, headline, then the caller's
 * rows, then the site link and any footer lines. `title`, `preheader` and
 * `headline` are plain text; `rows` and `footer` are markup the caller built
 * from escaped values.
 */
function renderShell({ title, preheader, headline, rows, footer = '', origin }) {
  const site = escapeHtml(origin);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(SITE.email.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<!--[if mso]><style>body,table,td,div,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body ${filled(T.page)}margin:0;padding:0;font-family:${T.font};color:${T.ink};">
  <div lang="${escapeHtml(SITE.email.locale)}" dir="ltr">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${filled(T.page)}">
    <tr>
      <td align="center" ${filled(T.page)}padding:${T.space3xl} ${T.spaceL};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${filled(T.surface)}max-width:480px;border:${T.border} solid ${T.rule};border-radius:${T.radius};">
          ${logoRow(origin)}
          <tr>
            <td style="padding:0 ${T.space2xl} ${T.spaceS};"><h1 style="margin:0;font-size:${T.sizeXl};line-height:${T.leadingM};font-weight:${T.weightMedium};color:${T.ink};">${escapeHtml(headline)}</h1></td>
          </tr>
          ${rows}
          <tr>
            <td style="padding:${T.spaceL} ${T.space2xl} ${T.spaceXl};border-top:${T.border} solid ${T.rule};font-size:${T.size2xs};line-height:${T.leadingL};color:${T.faded};"><a href="${site}" style="color:${T.faded};text-decoration:none;">${escapeHtml(hostOf(origin))}</a>${footer}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  </div>
</body>
</html>
`;
}

/* ------ What the sign-in email says about the request ------ */

/**
 * When the code was asked for, in the brand's date format and zone:
 * "23 November 2026, 17:30 GMT", "November 23, 2026, 12:30 PM EST".
 */
export function requestTime(date, locale = SITE.email.locale, timeZone = SITE.email.timeZone) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short',
  }).format(date).replace(' at ', ', ');
}

/**
 * "Safari on a Mac", from a User-Agent, or null when either half is not
 * recognised: the From row never shows a guess. Order matters: an iPhone's
 * agent also says Mac OS X, and Chrome's and Edge's also say Safari.
 */
export function deviceFrom(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg(e|iOS|A)?\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Version\/[\d.]+.*Safari\//.test(ua) ? 'Safari'
    : null;
  const device = /iPhone/.test(ua) ? 'an iPhone'
    : /iPad/.test(ua) ? 'an iPad'
    : /Android/.test(ua) ? 'an Android device'
    : /CrOS/.test(ua) ? 'a Chromebook'
    : /Macintosh|Mac OS X/.test(ua) ? 'a Mac'
    : /Windows/.test(ua) ? 'a Windows PC'
    : /Linux/.test(ua) ? 'a Linux computer'
    : null;
  return browser && device ? `${browser} on ${device}` : null;
}

// The short forms the approved design uses; every other country by its name
const SHORT_COUNTRY = { GB: 'UK', US: 'US' };

/**
 * "Birmingham, UK", from Cloudflare's request.cf: city and country only,
 * never the address. Null without a city: a country alone is too vague to
 * help, and the row never guesses.
 */
export function placeFrom(cf, locale = SITE.email.locale) {
  const city = cf && typeof cf.city === 'string' ? cf.city.trim() : '';
  const code = cf && typeof cf.country === 'string' ? cf.country.toUpperCase() : '';
  if (!city || !/^[A-Z]{2}$/.test(code) || code === 'XX') return null;
  if (SHORT_COUNTRY[code]) return `${city}, ${SHORT_COUNTRY[code]}`;
  let country;
  try { country = new Intl.DisplayNames([locale], { type: 'region' }).of(code); } catch { return null; }
  // Intl hands back the code itself for a region it has no name for
  return country && country !== code ? `${city}, ${country}` : null;
}

/** The From row's value, or null to drop the row. */
function fromLine(device, place) {
  if (device && place) return `${device}, near ${place}`;
  if (device) return device;
  if (place) return `Near ${place}`;
  return null;
}

/** One line of the details panel: icon, then label over value. */
function detail(origin, icon, label, value, last) {
  return `<tr>
                  <td width="${ICON_SIZE}" valign="top" style="padding:0 ${T.spaceM} ${last ? '0' : T.spaceM} 0;">${image(`${origin}${EMAIL_ICON_PATH}${icon}.png`, ICON_SIZE, ICON_SIZE, '')}</td>
                  <td valign="top" style="padding:0 0 ${last ? '0' : T.spaceM};line-height:${T.leadingS};mso-line-height-rule:exactly;">
                    <div style="font-size:${T.size2xs};color:${T.faded};">${escapeHtml(label)}</div>
                    <div style="font-size:${T.sizeXs};color:${T.ink};">${escapeHtml(value)}</div>
                  </td>
                </tr>`;
}

/* ------ The sign-in code ------ */

export function otpSubject(otp) {
  return `${otp} is your ${SITE.name} sign-in code`;
}

function reassurance() {
  return "Didn't ask for this code? Ignore this email. No one can sign in without the code, so your account is safe.";
}

function sentBy(origin) {
  // A site with no company of its own would otherwise read "Sent by Docs, from Docs."
  const from = SITE.email.company === SITE.name ? '' : `, from ${SITE.email.company}`;
  return `Sent by ${SITE.name}${from}. You got this email because someone asked to sign in to ${hostOf(origin)} with this address.`;
}

/**
 * The code as six digits with nothing inside them, so Gmail's Copy code and
 * Apple's AutoFill can read it: the gap on screen is letter-spacing only.
 *
 * @param {{ otp: string, expiresInMinutes: number, origin: string, email: string,
 *   requestedAt?: Date, device?: string|null, place?: string|null }} input
 */
export function renderOtpEmail({ otp, expiresInMinutes, origin, email, requestedAt = new Date(), device = null, place = null }) {
  const minutes = Number(expiresInMinutes);
  const from = fromLine(device, place);
  const lines = [
    ['mail', 'Sent to', email],
    ['clock', 'Requested', requestTime(requestedAt)],
    ...(from ? [['pin', 'From', from]] : []),
  ];
  const rows = `${bodyRow(escapeHtml(`Enter this code to sign in to ${SITE.name}:`), { bottom: '0' })}
          <tr>
            <td style="padding:${T.spaceS} ${T.space2xl} ${T.spaceXl};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:${T.spaceL} ${T.spaceXl};border:${T.border} solid ${T.rule};border-radius:${T.radius};font-family:${T.mono};font-size:${T.size4xl};line-height:${T.leadingS};letter-spacing:${T.trackingL};font-weight:${T.weightMedium};color:${T.ink};">${escapeHtml(otp)}</td>
                </tr>
              </table>
            </td>
          </tr>
          ${bodyRow(escapeHtml(`It expires in ${minutes} minutes and works once.`), { bottom: T.spaceM })}
          <tr>
            <td style="padding:0 ${T.space2xl} ${T.spaceXl};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${filled(T.panel)}">
                <tr>
                  <td ${filled(T.panel)}padding:${T.spaceL};">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                ${lines.map(([icon, label, value], i) => detail(origin, icon, label, value, i === lines.length - 1)).join('\n                ')}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${bodyRow(escapeHtml(reassurance()), { color: T.faded, size: T.sizeXs, bottom: T.spaceXl })}`;
  return renderShell({
    title: otpSubject(otp),
    preheader: `Your ${SITE.name} sign-in code is ${otp}.`,
    headline: 'Your sign-in code',
    rows,
    footer: `<div style="padding-top:${T.spaceS};">${escapeHtml(sentBy(origin))}</div>`,
    origin,
  });
}

export function renderOtpText({ otp, expiresInMinutes, origin, email, requestedAt = new Date(), device = null, place = null }) {
  const from = fromLine(device, place);
  return [
    `Enter this code to sign in to ${SITE.name}:`,
    '',
    String(otp),
    '',
    `It expires in ${Number(expiresInMinutes)} minutes and works once.`,
    '',
    `Sent to: ${email}`,
    `Requested: ${requestTime(requestedAt)}`,
    ...(from ? [`From: ${from}`] : []),
    '',
    reassurance(),
    '',
    hostOf(origin),
    sentBy(origin),
    '',
  ].join('\n');
}

/* ------ The invite (permissions-plan.md §4.8) ------ */

export function inviteSubject() {
  return `You have access to ${SITE.name}`;
}

function expiryLine(expiresAt) {
  if (!expiresAt) return '';
  const date = new Date(Number(expiresAt) * 1000);
  const text = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `Your access ends on ${text}.`;
}

/** What the invitee can open, in one line, by role - the invite is not the same email for everyone. */
function opensLine(role, opens) {
  if (role === 'owner') return 'You can open everything, and manage who signs in, admins included.';
  if (role === 'admin') return 'You can open every page but the owner pages, and manage who signs in.';
  if (role === 'community') return `You can open the public pages and every ${SITE.communityLabel} page.`;
  if (role === 'guest') {
    return opens && opens.length ? `You can open ${opens.join(', ')}.` : 'You can open the pages your groups grant.';
  }
  return 'You can open every team page.';
}

/**
 * The step access-plan.md §12.5 says is forgotten on someone's first morning:
 * the person learns they are in, which address to use, and what it opens.
 *
 * @param {{ origin: string, email: string, invitedBy?: string, expiresAt?: number|null, role?: string, opens?: string[] }} input
 */
export function renderInviteEmail({ origin, email, invitedBy, expiresAt, role, opens }) {
  const site = escapeHtml(origin);
  const line = (text) => bodyRow(escapeHtml(text));
  const by = invitedBy ? line(`Invited by ${invitedBy}.`) : '';
  const ends = expiryLine(expiresAt);
  const endsRow = ends ? line(ends) : '';
  // The button's colour sits on a cell, which takes bgcolor; a link cannot
  const rows = `${bodyRow(`Sign in with <strong>${escapeHtml(email)}</strong>. Each time, a one-time code comes to this inbox, no password.`)}
          ${line(opensLine(role, opens))}${by}${endsRow}
          <tr>
            <td style="padding:${T.spaceL} ${T.space2xl} ${T.spaceXl};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td ${filled(T.ink)}border-radius:${T.radius};"><a href="${site}${SITE.loginPath}" style="display:inline-block;padding:${T.spaceM} ${T.spaceXl};color:${T.inverse};text-decoration:none;font-size:${T.sizeS};font-weight:${T.weightMedium};">Sign in</a></td>
                </tr>
              </table>
            </td>
          </tr>`;
  return renderShell({
    title: inviteSubject(),
    preheader: `Sign in at ${hostOf(origin)} with this address.`,
    headline: `You have access to ${SITE.name}`,
    rows,
    origin,
  });
}

export function renderInviteText({ origin, email, invitedBy, expiresAt, role, opens }) {
  const host = hostOf(origin);
  const lines = [
    `${SITE.name} - you have access`,
    '',
    `Sign in with ${email}. Each time, a one-time code comes to this inbox, no password.`,
    '',
    opensLine(role, opens),
  ];
  if (invitedBy) lines.push('', `Invited by ${invitedBy}.`);
  const ends = expiryLine(expiresAt);
  if (ends) lines.push('', ends);
  lines.push('', `${origin}${SITE.loginPath}`, '', host, '');
  return lines.join('\n');
}
