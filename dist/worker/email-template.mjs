/* @bydefaultstudio/design-system v8.2.0 */
/**
 * email-template.mjs — the sign-in code email (access-plan.md §4.4).
 *
 * Pure: two string functions and nothing else, so it can be rendered in plain
 * node (hence .mjs — the package is "type": "commonjs"). worker/auth.js calls
 * renderOtpEmail() from Better Auth's sendVerificationOTP hook and hands the
 * result to env.EMAIL.send().
 *
 * Why hand-rolled HTML with inline styles: mail clients strip <style> and
 * ignore external CSS, so this is the one place in the repo where inline
 * styles are the correct tool. The colour scheme is pinned to light so no
 * client auto-inverts the card. Keep it to text: no images, so nothing
 * depends on a public route or on the recipient's client loading remote
 * content. What survives an inbox, and why, is cms/email-template.md.
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
 * too (cms/email-template.md, "Keeping it in step").
 */
export const EMAIL_TOKENS = Object.freeze({
  // Colours, light scheme, flattened onto white where the token is an alpha
  page: '#fafafa',     // --off-white (--neutral-50)
  surface: '#ffffff',  // --background-primary
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
  leadingM: '1.2',     // --line-height-m
  leadingL: '1.4',     // --line-height-l
  weightMedium: '500', // --font-weight-medium
  trackingM: '0.06em', // --letter-spacing-m
  trackingL: '0.12em', // --letter-spacing-l
  // Space
  spaceS: '8px',       // --space-s
  spaceM: '12px',      // --space-m
  spaceL: '16px',      // --space-l
  spaceXl: '24px',     // --space-xl
  space2xl: '32px',    // --space-2xl
  space3xl: '40px',    // --space-3xl
  // Corners: the brand's --radius-scale is 0, so every role is square
  radius: '0',         // --radius-surface, --radius-control
  border: '1px',       // --border-s
});

// Each token as the site sets it (createGate emailTokens), else the default
// above. Read at render time, so a site's values reach every email.
// (The proxy's target is a plain object: a frozen target may not report a
// value other than its own. T is read by property only; spreading it or
// listing its keys gives nothing.)
const T = new Proxy({}, {
  get(target, key) {
    return Object.prototype.hasOwnProperty.call(SITE.emailTokens, key) ? SITE.emailTokens[key] : EMAIL_TOKENS[key];
  },
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Groups "123456" as "123 456" — easier to read off a phone screen. */
function spaceCode(otp) {
  const digits = String(otp);
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** A row of body copy inside the card. `html` is already escaped. */
function bodyRow(html, { color = T.ink, size = T.sizeS, bottom = T.spaceS } = {}) {
  return `<tr><td style="padding:0 ${T.space2xl} ${bottom};font-size:${size};line-height:${T.leadingL};color:${color};">${html}</td></tr>`;
}

/**
 * The frame both emails share: page, card, brand eyebrow, headline, then the
 * caller's rows, then the site link. `title`, `preheader` and `headline` are
 * plain text; `rows` is markup the caller built from escaped values.
 */
function renderShell({ title, preheader, headline, rows, site, host }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${T.page};font-family:${T.font};color:${T.ink};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.page};">
    <tr>
      <td align="center" style="padding:${T.space3xl} ${T.spaceL};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:${T.surface};border:${T.border} solid ${T.rule};border-radius:${T.radius};">
          <tr>
            <td style="padding:${T.space2xl} ${T.space2xl} ${T.spaceS};font-size:${T.size2xs};letter-spacing:${T.trackingM};text-transform:uppercase;color:${T.faded};">${escapeHtml(SITE.name)}</td>
          </tr>
          <tr>
            <td style="padding:0 ${T.space2xl} ${T.spaceL};font-size:${T.sizeXl};line-height:${T.leadingM};font-weight:${T.weightMedium};">${escapeHtml(headline)}</td>
          </tr>
          ${rows}
          <tr>
            <td style="padding:${T.spaceL} ${T.space2xl} ${T.spaceXl};border-top:${T.border} solid ${T.rule};font-size:${T.size2xs};line-height:${T.leadingL};color:${T.faded};"><a href="${site}" style="color:${T.faded};">${host}</a></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export function otpSubject(otp) {
  return `${otp} is your ${SITE.name} sign-in code`;
}

/**
 * @param {{ otp: string, expiresInMinutes: number, origin: string }} input
 */
export function renderOtpEmail({ otp, expiresInMinutes, origin }) {
  const code = escapeHtml(spaceCode(otp));
  const minutes = Number(expiresInMinutes);
  const site = escapeHtml(origin);
  const rows = `<tr>
            <td style="padding:0 ${T.space2xl} ${T.spaceXl};">
              <div style="display:inline-block;padding:${T.spaceL} ${T.spaceXl};border:${T.border} solid ${T.rule};border-radius:${T.radius};font-family:${T.mono};font-size:${T.size4xl};letter-spacing:${T.trackingL};font-weight:${T.weightMedium};">${code}</div>
            </td>
          </tr>
          ${bodyRow(`Enter it on the sign-in page. It expires in ${minutes} minutes and works once.`)}
          ${bodyRow('If you did not request this code, nothing happens — no one can sign in without it. You can ignore this email.', { color: T.faded, size: T.sizeXs, bottom: T.space2xl })}`;
  return renderShell({
    title: otpSubject(otp),
    preheader: `Your sign-in code is ${spaceCode(otp)}. It expires in ${minutes} minutes.`,
    headline: 'Your sign-in code',
    rows,
    site,
    host: site.replace(/^https?:\/\//, ''),
  });
}

export function renderOtpText({ otp, expiresInMinutes, origin }) {
  return [
    `${SITE.name} — your sign-in code`,
    '',
    spaceCode(otp),
    '',
    `Enter it on the sign-in page. It expires in ${Number(expiresInMinutes)} minutes and works once.`,
    '',
    'If you did not request this code, nothing happens — no one can sign in without it. You can ignore this email.',
    '',
    String(origin).replace(/^https?:\/\//, ''),
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
  const host = site.replace(/^https?:\/\//, '');
  const line = (text) => bodyRow(escapeHtml(text));
  const by = invitedBy ? line(`Invited by ${invitedBy}.`) : '';
  const ends = expiryLine(expiresAt);
  const endsRow = ends ? line(ends) : '';
  const rows = `${bodyRow(`Sign in with <strong>${escapeHtml(email)}</strong>. Each time, a one-time code comes to this inbox, no password.`)}
          ${line(opensLine(role, opens))}${by}${endsRow}
          <tr>
            <td style="padding:${T.spaceL} ${T.space2xl} ${T.spaceXl};">
              <a href="${site}${SITE.loginPath}" style="display:inline-block;padding:${T.spaceM} ${T.spaceXl};background:${T.ink};color:${T.inverse};text-decoration:none;border-radius:${T.radius};font-size:${T.sizeS};font-weight:${T.weightMedium};">Sign in</a>
            </td>
          </tr>`;
  return renderShell({
    title: inviteSubject(),
    preheader: `Sign in at ${String(origin).replace(/^https?:\/\//, '')} with this address.`,
    headline: `You have access to ${SITE.name}`,
    rows,
    site,
    host,
  });
}

export function renderInviteText({ origin, email, invitedBy, expiresAt, role, opens }) {
  const host = String(origin).replace(/^https?:\/\//, '');
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
