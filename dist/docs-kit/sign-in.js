/**
 * The sign-in page's background (engine, every site): the slot beside the
 * sign-in strip, filled by the site's `signIn` config in docs.config.js.
 *
 *   signIn: {
 *     background: 'none' | 'slideshow' | 'custom',   // 'none' when left out
 *     slides: [{ src, poster, title, text }],          // slideshow only
 *     scripts: ['assets/js/x.js'],                     // the site's own, after the page's
 *     styles: ['assets/css/x.css'],
 *   }
 *
 * none       a plain panel in --background-secondary (no band on a phone)
 * slideshow  the site's images or videos, a caption and a pause control,
 *            driven by assets/js/login-slideshow.js
 * custom     an empty mount, #login-background, that the site's own script
 *            fills (By Default's hero). The contract is in the docs kit
 *            README (scripts/docs-kit-readme.md), Access gate
 *
 * Every path is a site path from the output root, as extraScripts are. The
 * door check (checkDoorPages) then proves each file is in the output and
 * public at the gate, so a slide behind the sign-in fails the build rather
 * than showing a signed-out reader a broken image.
 */

const MODES = ['none', 'slideshow', 'custom'];
const KEYS = ['background', 'slides', 'scripts', 'styles'];
const SLIDE_KEYS = ['src', 'poster', 'title', 'text'];
const VIDEO = /\.(mp4|webm|m4v|mov|ogv)$/i;
// A site path, never an address: no scheme, no host, nothing to escape out of
const SITE_PATH = /^\/?(?!\/)[^\s"'<>\\:?#]+$/;

/** A site path as the config writes it, without its leading slash. */
function sitePath(value) {
  return String(value).replace(/^\//, '');
}

/**
 * The config, checked and filled with its defaults. Each problem is a
 * sentence naming the key, so the build can stop on the first run.
 */
function normalise(raw) {
  const problems = [];
  const config = { background: 'none', slides: [], scripts: [], styles: [] };
  if (raw === undefined || raw === null) return { config, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('signIn must be an object, such as { background: "slideshow", slides: [...] }.');
    return { config, problems };
  }
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) problems.push(`signIn.${key} isn't a setting (known: ${KEYS.join(', ')}).`);
  }
  if (raw.background !== undefined) {
    if (MODES.includes(raw.background)) config.background = raw.background;
    else problems.push(`signIn.background is ${JSON.stringify(raw.background)}. It is one of ${MODES.map((m) => `"${m}"`).join(', ')}.`);
  }
  for (const key of ['scripts', 'styles']) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key])) { problems.push(`signIn.${key} must be a list of site paths.`); continue; }
    raw[key].forEach((p, i) => {
      if (typeof p === 'string' && SITE_PATH.test(p)) config[key].push(sitePath(p));
      else problems.push(`signIn.${key}[${i}] is ${JSON.stringify(p)}. It must be a site path, such as "assets/${key === 'scripts' ? 'js/hero.js' : 'css/hero.css'}".`);
    });
  }
  if (raw.slides !== undefined) {
    if (!Array.isArray(raw.slides)) problems.push('signIn.slides must be a list of slides.');
    else {
      raw.slides.forEach((slide, i) => {
        const at = `signIn.slides[${i}]`;
        if (!slide || typeof slide !== 'object' || Array.isArray(slide)) { problems.push(`${at} must be an object with a src.`); return; }
        for (const key of Object.keys(slide)) {
          if (!SLIDE_KEYS.includes(key)) problems.push(`${at}.${key} isn't a slide setting (known: ${SLIDE_KEYS.join(', ')}).`);
        }
        if (typeof slide.src !== 'string' || !SITE_PATH.test(slide.src)) {
          problems.push(`${at}.src is ${JSON.stringify(slide.src)}. It must be a site path to an image or a video, such as "assets/images/sign-in/one.jpg".`);
          return;
        }
        if (slide.poster !== undefined && (typeof slide.poster !== 'string' || !SITE_PATH.test(slide.poster))) {
          problems.push(`${at}.poster must be a site path to an image.`);
        } else if (slide.poster !== undefined && !VIDEO.test(slide.src)) {
          problems.push(`${at}.poster is set, but ${slide.src} is an image: a poster is the picture a video shows before it plays.`);
        }
        for (const key of ['title', 'text']) {
          if (slide[key] !== undefined && typeof slide[key] !== 'string') problems.push(`${at}.${key} must be text.`);
        }
        config.slides.push({
          src: sitePath(slide.src),
          poster: typeof slide.poster === 'string' ? sitePath(slide.poster) : null,
          video: VIDEO.test(slide.src),
          title: typeof slide.title === 'string' ? slide.title.trim() : '',
          text: typeof slide.text === 'string' ? slide.text.trim() : '',
        });
      });
    }
  }
  if (config.background === 'slideshow' && !config.slides.length && !problems.length) {
    problems.push('signIn.background is "slideshow" but signIn.slides is empty. Add a slide, or leave background out for the plain panel.');
  }
  if (config.background !== 'slideshow' && config.slides.length) {
    problems.push(`signIn.slides is set, but signIn.background is "${config.background}", so no slide would show. Set background to "slideshow", or remove the slides.`);
  }
  return { config, problems };
}

/** One slide's media: decorative, so no alt text and no controls. */
function slideMedia(slide, href, escape, first) {
  if (slide.video) {
    // muted + playsinline: the only video a browser lets a script start, and
    // one that never takes over a phone's screen. No autoplay attribute:
    // login-slideshow.js starts it, so reduced motion and pause are honoured
    // before a frame moves.
    const poster = slide.poster ? ` poster="${escape(href(slide.poster))}"` : '';
    return `<video src="${escape(href(slide.src))}"${poster} muted playsinline loop preload="${first ? 'auto' : 'metadata'}" tabindex="-1"></video>`;
  }
  return `<img src="${escape(href(slide.src))}" alt="" decoding="async"${first ? '' : ' loading="lazy"'}>`;
}

/**
 * The background's markup, in place of the page's placeholder. `href` makes
 * a site path relative to the page; `escape` is the generator's attribute
 * escape, used for text as well (it escapes &, ", < and >); `icon` draws a
 * brand icon by name. Substituted after the body's own expansion, so a
 * slide's words are never read as {{...}} shorthand.
 */
function renderBackground(config, { href, escape, icon }) {
  if (config.background === 'custom') {
    // Empty on purpose: the site's script owns everything inside, its
    // semantics included. Never aria-hidden from here: a background can
    // hold a control that must stay reachable (By Default's hero has a
    // colour switch), so the site marks its own decoration, gives anything
    // that moves for over five seconds a pause control, and reads reduced
    // motion and pointer type with matchMedia itself
    return '<div class="login-backdrop" data-background="custom" id="login-background"></div>';
  }
  if (config.background !== 'slideshow') {
    return '<div class="login-backdrop" data-background="none" aria-hidden="true"></div>';
  }
  const slides = config.slides;
  const first = slides[0];
  // A control only when something can move: two slides, or a video
  const moves = slides.length > 1 || slides.some((s) => s.video);
  const slideHtml = slides.map((slide, i) => `<div class="login-slide${i === 0 ? ' is-active' : ''}" data-title="${escape(slide.title)}" data-text="${escape(slide.text)}">${slideMedia(slide, href, escape, i === 0)}</div>`).join('\n        ');
  const bars = slides.length > 1
    ? `<div class="login-slideshow-progress" aria-hidden="true">${slides.map((s, i) => `<span class="login-slideshow-bar${i === 0 ? ' is-active' : ''}"></span>`).join('')}</div>`
    : '';
  const caption = (first.title || first.text || slides.some((s) => s.title || s.text))
    ? `<div class="login-slideshow-caption" aria-hidden="true"><p class="login-slideshow-title">${escape(first.title)}</p><p class="login-slideshow-text">${escape(first.text)}</p></div>`
    : '';
  const toggle = moves
    ? `<button type="button" class="button login-slideshow-toggle" data-variant="transparent" data-icon-only aria-label="Pause slideshow">${icon('pause')}${icon('play')}</button>`
    : '';
  // No words on any slide: the panel is only the controls, which a wide
  // screen draws as a slim row rather than a caption-sized box
  const variant = caption ? '' : ' data-variant="controls"';
  const panel = (caption || bars || toggle)
    ? `\n      <div class="login-slideshow-panel"${variant}>${caption}${(bars || toggle) ? `<div class="login-slideshow-controls">${bars}${toggle}</div>` : ''}</div>`
    : '';
  return `<div class="login-backdrop" data-background="slideshow">
    <div class="login-slideshow" data-login-slideshow>
      <div class="login-slides" aria-hidden="true">
        ${slideHtml}
      </div>${panel}
    </div>
  </div>`;
}

module.exports = { MODES, normalise, renderBackground };
