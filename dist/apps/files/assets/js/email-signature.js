/**
 * email-signature.js — Email Signature Generator browser UI
 * Loaded globally; starts itself on initial load and after every Barba
 * navigation, and exposes window.initEmailSignature.
 *
 * Builds an inbox-safe (table + inline-styles) HTML email signature from the
 * team member's details. Two copy paths behind one button, chosen by the
 * format in Export:
 *   - Signature — "Copy signature" writes text/html to the clipboard so
 *     Gmail / Apple Mail inherit the rendered markup when pasted into the
 *     signature box.
 *   - HTML — "Copy HTML" copies the raw source for Outlook / admin setup.
 *
 * On the tool canvas, built from docks (cms/tool-canvas.md, Docks): the
 * signature or its source in the preview, Details and Links sections (Links
 * with its own reset, for the switches), the format in Export, and the one
 * verb at the dock's foot.
 *
 * 2.0.0: onto docks. The format is a radio group, Reset all joins the bar's
 * menu, and ids take the tool's full slug.
 * @version 2.2.0
 */
(function () {
  'use strict';

  console.log('[Email Signature] v2.2.0 loaded');

  //
  //------- Brand settings -------//
  // The signature's brand values (hosted asset URLs, card colour, disclaimer)
  // come from the brand manifest via the generated THEME_CONFIG.emailSignature
  // block — the output reads from the brand's settings, never from literals,
  // so the signature can't drift from the brand.
  //
  // BASE is a PERMANENT URL CONTRACT: it points at assets.bydefault.studio, a
  // host that exists so these URLs can outlive any restructure of the docs site
  // (source: github.com/bydefaultstudio/assets). The bytes at a published path
  // never change — a redesigned asset gets a new filename. Never change the
  // manifest's base once signatures are in the wild: a signature already in
  // someone's sent folder cannot be edited, so its image URLs are forever.
  //
  // The PREVIEW renders from the local committed copies (previewBase) so it
  // shows immediately in dev before deploy — the swap is a literal prefix
  // substitution on BASE, which is why base must keep its trailing slash.
  // Icons are 48px (-2x) shown at 24px for retina sharpness.
  //

  var BASE, PREVIEW_BASE, ASSETS, CARD_BG, DISCLAIMER, BRAND_NAME, WEBSITE_HOST;

  function applyBrandConfig() {
    var es = (typeof THEME_CONFIG !== 'undefined' && THEME_CONFIG.emailSignature) || null;
    if (!es || !es.icons) return false;
    BASE = es.base;
    PREVIEW_BASE = es.previewBase;
    ASSETS = {
      logo: BASE + es.logo,
      logoWidth: es.logoWidth,
      logoHeight: es.logoHeight,
      iconEmail: BASE + es.icons.email,
      iconWeb: BASE + es.icons.web,
      iconLinkedin: BASE + es.icons.linkedin,
      iconInstagram: BASE + es.icons.instagram
    };
    CARD_BG = es.cardBackground;
    DISCLAIMER = es.disclaimer;
    // The logo's alt text and the website example are the brand's own
    // (brand.json name and wording.website), never a name written here.
    BRAND_NAME = THEME_CONFIG.brand && THEME_CONFIG.brand.name ? THEME_CONFIG.brand.name : '';
    var website = THEME_CONFIG.wording && THEME_CONFIG.wording.website ? THEME_CONFIG.wording.website : '';
    WEBSITE_HOST = website.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return true;
  }

  //
  //------- Helpers -------//
  //

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normaliseUrl(value) {
    var trimmed = String(value).trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed.replace(/^\/+/, '');
  }

  // Strip protocol/www/trailing slash for a clean visible label.
  function prettyUrl(value) {
    return String(value).trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '');
  }

  // Resolve a social field that may be a full URL or a bare handle.
  // Returns { url, label } where url always points at the real profile and
  // label is the "@handle" form. domain e.g. "linkedin.com", path e.g. "in/".
  function resolveSocial(value, domain, path) {
    var raw = String(value).trim().replace(/^@+/, '');
    // Treat as a full URL only on a clear signal — a protocol, a path slash, or
    // the platform's own domain. A bare token (even a dotted one like an
    // Instagram handle "studio.name") is treated as a handle, not a domain.
    var looksLikeUrl = /^https?:\/\//i.test(raw) || raw.indexOf('/') !== -1 || raw.toLowerCase().indexOf(domain) !== -1;
    var url, handle;
    if (looksLikeUrl) {
      url = normaliseUrl(raw);
      handle = prettyUrl(url)
        .replace(new RegExp('^' + domain.replace('.', '\\.') + '/', 'i'), '')
        .replace(new RegExp('^' + path, 'i'), '')
        .replace(/\/+$/, '');
    } else {
      handle = raw;
      url = 'https://www.' + domain + '/' + path + raw;
    }
    return { url: url, label: handle ? '@' + handle : prettyUrl(url) };
  }

  //
  //------- Validation (non-blocking — warns, never prevents copying) -------//
  //

  function emailError(value) {
    var t = String(value).trim();
    if (!t) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? '' : 'Enter a valid email address';
  }

  function websiteError(value) {
    var t = String(value).trim();
    if (!t) return '';
    if (/\s/.test(t)) return 'Remove the spaces from the website';
    var host = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    return host.indexOf('.') === -1 ? 'Enter a valid website' + (WEBSITE_HOST ? ', like ' + WEBSITE_HOST : '') : '';
  }

  // The field expects a username only (the URL base is shown as a prefix). If a
  // full link is pasted, nudge the user — the output still resolves correctly.
  function handleError(value, platform) {
    var t = String(value).trim().replace(/^@+/, '');
    if (!t) return '';
    if (/^https?:\/\//i.test(t) || t.indexOf('/') !== -1 || /(linkedin|instagram)\.com/i.test(t)) {
      return 'Enter just your username, not the full link';
    }
    if (/\s/.test(t)) return 'Remove the spaces from your username';
    if (!/^[A-Za-z0-9._-]+$/.test(t)) return 'Enter a valid ' + platform + ' username';
    return '';
  }

  //
  //------- Signature builder -------//
  //

  function buildRow(iconSrc, iconAlt, href, label, title) {
    return ''
      + '<tr style="line-height:25px;">'
      + '<td width="25"><img style="display:block;" src="' + iconSrc + '" alt="' + escapeHtml(iconAlt) + '" width="24" height="24"></td>'
      + '<td colspan="2"><a href="' + escapeHtml(href) + '" target="_blank" title="' + escapeHtml(title) + '" style="text-decoration:none;color:#000000;">' + escapeHtml(label) + '</a></td>'
      + '</tr>';
  }

  function buildSignature(data) {
    var rows = '';

    if (data.email.value) {
      rows += buildRow(
        ASSETS.iconEmail, 'Email',
        'mailto:' + data.email.value,
        data.email.value, 'Email'
      );
    }

    if (data.linkedin.on && data.linkedin.value) {
      var li = resolveSocial(data.linkedin.value, 'linkedin.com', 'in/');
      rows += buildRow(ASSETS.iconLinkedin, 'LinkedIn', li.url, li.label, 'LinkedIn');
    }

    if (data.instagram.on && data.instagram.value) {
      var ig = resolveSocial(data.instagram.value, 'instagram.com', '');
      rows += buildRow(ASSETS.iconInstagram, 'Instagram', ig.url, ig.label, 'Instagram');
    }

    if (data.website.on && data.website.value) {
      var webUrl = normaliseUrl(data.website.value);
      rows += buildRow(ASSETS.iconWeb, 'Website', webUrl, prettyUrl(webUrl), 'Website');
    }

    var card = ''
      + '<table role="presentation" style="text-align:left;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#000000;background-color:' + CARD_BG + ';border-radius:10px;max-width:950px;padding:20px;vertical-align:top;" border="0" cellpadding="0" cellspacing="0" bgcolor="' + CARD_BG + '">'
      + '<tbody>'
      + '<tr><td style="font-size:large;vertical-align:top;padding-bottom:12px;" colspan="2" height="40"><img style="display:block;" src="' + ASSETS.logo + '" alt="' + escapeHtml(BRAND_NAME) + '" width="' + ASSETS.logoWidth + '" height="' + ASSETS.logoHeight + '"></td></tr>'
      + '<tr><td style="font-size:large;" colspan="2"><strong>' + escapeHtml(data.name) + '</strong></td></tr>'
      + '<tr style="line-height:25px;"><td colspan="2">' + escapeHtml(data.role) + '</td></tr>'
      + rows
      + '</tbody></table>';

    if (!data.disclaimer) return card;

    var disclaimer = ''
      + '<table role="presentation" style="text-align:left;font-family:Helvetica,Arial,sans-serif;font-size:9px;max-width:950px;text-decoration:none;" border="0" cellpadding="0" cellspacing="0">'
      + '<tbody><tr><td><br>' + DISCLAIMER + '</td></tr></tbody></table>';

    return card + disclaimer;
  }

  //
  //------- UI wiring -------//
  //

  function readData(els) {
    return {
      name: els.name.value.trim() || 'Your Name',
      role: els.role.value.trim() || 'Role',
      email: { value: els.email.value.trim() },
      website: { on: els.websiteToggle.checked, value: els.website.value.trim() },
      linkedin: { on: els.linkedinToggle.checked, value: els.linkedin.value.trim() },
      instagram: { on: els.instagramToggle.checked, value: els.instagram.value.trim() },
      disclaimer: els.disclaimerToggle.checked
    };
  }

  function copyRichHtml(html) {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      var item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' })
      });
      return navigator.clipboard.write([item]);
    }
    // Fallback: select a contenteditable copy of the rendered node.
    return new Promise(function (resolve, reject) {
      var holder = document.createElement('div');
      holder.setAttribute('contenteditable', 'true');
      holder.style.position = 'fixed';
      holder.style.opacity = '0';
      holder.innerHTML = html;
      document.body.appendChild(holder);
      var range = document.createRange();
      range.selectNodeContents(holder);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = document.execCommand('copy');
      sel.removeAllRanges();
      document.body.removeChild(holder);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function copyPlainText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  // A second click inside the two seconds re-arms the revert rather than
  // letting the first one cut the second flash short (copy-button.js does
  // the same).
  function flashCopied(btn) {
    btn.classList.add('is-copied');
    clearTimeout(btn.esCopyRevertTimer);
    btn.esCopyRevertTimer = setTimeout(function () { btn.classList.remove('is-copied'); }, 2000);
  }

  // Cleared first and written on the next frame, so the same sentence twice
  // in a row is still a change the live region announces (copy-button.js
  // does the same).
  function announce(statusEl, message) {
    if (!statusEl) return;
    statusEl.textContent = '';
    window.requestAnimationFrame(function speak() { statusEl.textContent = message; });
  }

  // Reveal/hide the field tagged with a given data-opt based on its switch.
  function setOptVisible(root, opt, on) {
    var els = root.querySelectorAll('[data-opt="' + opt + '"]');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle('is-hidden', !on);
    }
  }

  function initEmailSignature() {
    // Barba appends the incoming container after the outgoing one, so the
    // last match is the page being entered.
    var roots = document.querySelectorAll('[data-tool="email-signature"]');
    var root = roots[roots.length - 1];
    if (!root) return;
    if (root.dataset.initialised === 'true') return;
    if (!applyBrandConfig()) {
      console.error('[Email Signature] THEME_CONFIG.emailSignature missing — the generator did not emit the brand signature settings');
      var preview = root.querySelector('#email-signature-rendered');
      if (preview) {
        preview.textContent = 'The signature settings are missing from this site’s brand.json. Ask whoever runs the site to add them.';
      }
      return;
    }
    root.dataset.initialised = 'true';

    var els = {
      name: root.querySelector('#email-signature-name'),
      role: root.querySelector('#email-signature-role'),
      email: root.querySelector('#email-signature-email'),
      website: root.querySelector('#email-signature-website'),
      linkedin: root.querySelector('#email-signature-linkedin'),
      instagram: root.querySelector('#email-signature-instagram'),
      websiteToggle: root.querySelector('#email-signature-website-toggle'),
      linkedinToggle: root.querySelector('#email-signature-linkedin-toggle'),
      instagramToggle: root.querySelector('#email-signature-instagram-toggle'),
      disclaimerToggle: root.querySelector('#email-signature-disclaimer-toggle'),
      preview: root.querySelector('#email-signature-rendered'),
      htmlOutput: root.querySelector('#email-signature-source'),
      copyStatus: root.querySelector('#email-signature-status'),
      copyBtn: root.querySelector('#email-signature-copy'),
      copyFormat: root.querySelector('#email-signature-copy-format'),
      format: root.querySelector('#email-signature-format'),
      resetAll: root.querySelector('#email-signature-reset'),
      linksReset: root.querySelector('#email-signature-links-reset'),
      emailError: root.querySelector('#email-signature-email-error'),
      websiteError: root.querySelector('#email-signature-website-error'),
      linkedinError: root.querySelector('#email-signature-linkedin-error'),
      instagramError: root.querySelector('#email-signature-instagram-error')
    };

    // Show/clear a field's warning. Toggle the `hidden` property (the <p> ships
    // with the hidden attribute, which an empty inline display would not clear).
    // .is-error is the system's error state and paints the border and the focus
    // ring; aria-invalid is the half a screen reader hears. This file used to
    // set only aria-invalid and style off the attribute, so an invalid field
    // here showed a red border with the ordinary blue focus ring where every
    // other form in the repo shows a red one.
    // The line is a role="alert" that tools.css clips while empty (never
    // hidden, or a message written after blur is never announced); only the
    // text moves.
    function setError(input, errEl, message) {
      input.classList.toggle('is-error', !!message);
      errEl.textContent = message || '';
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }

    // Switch the preview between the rendered signature and the raw HTML
    // source, and the copy button with it: the format names what the copy
    // gives. .is-hidden rather than the [hidden] attribute: the global
    // `textarea { display: block }` rule outranks [hidden], and .is-hidden is
    // display:none !important, so it wins. The format is the radio-backed
    // segmented control in Export, so its state is the component's.
    var currentView = 'preview';
    function setView(view) {
      currentView = view;
      els.preview.classList.toggle('is-hidden', view !== 'preview');
      els.htmlOutput.classList.toggle('is-hidden', view !== 'html');
      els.copyFormat.textContent = view === 'html' ? 'HTML' : 'signature';
      var input = els.format.querySelector('input[value="' + view + '"]');
      if (input) input.checked = true;
    }

    function readView() {
      var checked = els.format.querySelector('input:checked');
      return checked && checked.value === 'html' ? 'html' : 'preview';
    }

    function render() {
      var html = buildSignature(readData(els));
      // Copied output keeps absolute URLs (for email clients); the preview swaps
      // them for the local committed copies so it renders before deploy.
      els.htmlOutput.value = html;
      els.preview.innerHTML = html.split(BASE).join(PREVIEW_BASE);
      // The rendered card's links are the signature's, not the tool's: out
      // of the tab order so a keyboard walk from the bar reaches the
      // controls without stepping through four new-window links. The copied
      // HTML is read from htmlOutput and is untouched.
      var links = els.preview.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) links[i].setAttribute('tabindex', '-1');
    }

    var inputs = [els.name, els.role, els.email, els.website, els.linkedin, els.instagram];
    inputs.forEach(function (input) {
      input.addEventListener('input', render);
    });

    // Non-blocking validation. Each field warns but never stops the copy.
    var validated = [
      { input: els.email, err: els.emailError, opt: null, fn: function (v) { return emailError(v); } },
      { input: els.website, err: els.websiteError, opt: 'website', fn: function (v) { return websiteError(v); } },
      { input: els.linkedin, err: els.linkedinError, opt: 'linkedin', fn: function (v) { return handleError(v, 'LinkedIn'); } },
      { input: els.instagram, err: els.instagramError, opt: 'instagram', fn: function (v) { return handleError(v, 'Instagram'); } }
    ];

    // toggle === the matching toggle element for an opt, or null for always-on.
    function validate(f, clearOnly) {
      var toggle = f.opt ? root.querySelector('#email-signature-' + f.opt + '-toggle') : null;
      var msg = (toggle && !toggle.checked) ? '' : f.fn(f.input.value);
      // On live input only clear a resolved error — don't nag mid-typing.
      if (clearOnly && msg) return;
      setError(f.input, f.err, msg);
    }

    validated.forEach(function (f) {
      f.input.addEventListener('blur', function () { validate(f, false); });
      f.input.addEventListener('input', function () { validate(f, true); });
      validate(f, false);
    });

    function validateOpt(opt) {
      for (var i = 0; i < validated.length; i++) {
        if (validated[i].opt === opt) { validate(validated[i], false); return; }
      }
    }

    var optionalToggles = [
      { toggle: els.websiteToggle, opt: 'website' },
      { toggle: els.linkedinToggle, opt: 'linkedin' },
      { toggle: els.instagramToggle, opt: 'instagram' }
    ];
    optionalToggles.forEach(function (pair) {
      pair.toggle.addEventListener('change', function () {
        setOptVisible(root, pair.opt, pair.toggle.checked);
        validateOpt(pair.opt);
        render();
        syncResets();
      });
      setOptVisible(root, pair.opt, pair.toggle.checked);
    });
    els.disclaimerToggle.addEventListener('change', function () {
      render();
      syncResets();
    });

    // The Links reset: the four switches back to the markup's defaults; what
    // was typed into the fields stays. Always there, disabled at the
    // defaults (cms/tool-canvas.md, Section reset); tool-canvas.js moves the
    // focus off the button once it disables itself.
    var switches = [els.websiteToggle, els.linkedinToggle, els.instagramToggle, els.disclaimerToggle];

    function isLinksDefault() {
      return switches.every(function (toggle) { return toggle.checked === toggle.defaultChecked; });
    }

    function syncResets() {
      els.linksReset.disabled = isLinksDefault();
    }

    function applyLinksDefaults() {
      switches.forEach(function (toggle) { toggle.checked = toggle.defaultChecked; });
      optionalToggles.forEach(function (pair) {
        setOptVisible(root, pair.opt, pair.toggle.checked);
        validateOpt(pair.opt);
      });
    }

    els.linksReset.addEventListener('tool:panel-reset', function () {
      applyLinksDefaults();
      render();
      syncResets();
      announce(els.copyStatus, 'Links reset: website and the disclaimer on, LinkedIn and Instagram off.');
    });

    // Reset all: every field and switch back to the markup's values, the
    // warnings cleared, the Signature format, as at page load.
    els.resetAll.addEventListener('click', function () {
      inputs.forEach(function (input) { input.value = input.defaultValue; });
      applyLinksDefaults();
      validated.forEach(function (f) { setError(f.input, f.err, ''); });
      setView('preview');
      render();
      syncResets();
      announce(els.copyStatus, 'Everything reset.');
    });

    // The format swaps the preview and renames the verb, both away from the
    // focus, so the status line says what the verb is now.
    els.format.addEventListener('change', function () {
      var view = readView();
      setView(view);
      announce(els.copyStatus, (view === 'html' ? 'HTML' : 'Signature') + '. Copy ' + els.copyFormat.textContent + ' at the foot of the panel.');
    });
    setView('preview');
    syncResets();

    function copySource() {
      return copyPlainText(els.htmlOutput.value).then(function () {
        flashCopied(els.copyBtn);
        announce(els.copyStatus, 'Signature HTML copied to clipboard');
      });
    }

    function copyRendered() {
      return copyRichHtml(els.htmlOutput.value).then(function () {
        flashCopied(els.copyBtn);
        announce(els.copyStatus, 'Signature copied to clipboard');
      }).catch(function (err) {
        console.error('[Email Signature] rich copy failed:', err);
        // Last resort: copy the source as plain text so nothing is lost.
        return copyPlainText(els.htmlOutput.value).then(function () {
          flashCopied(els.copyBtn);
          announce(els.copyStatus, 'Signature HTML copied as text');
        });
      });
    }

    els.copyBtn.addEventListener('click', function () {
      var copy = currentView === 'html' ? copySource() : copyRendered();
      copy.catch(function (err) {
        console.error('[Email Signature] copy failed:', err);
        var message = currentView === 'html'
          ? 'Couldn’t copy. Select the source and copy it yourself.'
          : 'Couldn’t copy. Switch to HTML and copy the source yourself.';
        // The tools' one failure report (copy-button.js): a danger toast and
        // the error sound. The status line only where that is missing.
        if (typeof window.showToast === 'function') {
          window.showToast(message, 'danger');
        } else {
          announce(els.copyStatus, message);
        }
        if (window.bdAudio && typeof window.bdAudio.playSound === 'function') { window.bdAudio.playSound('error'); }
      });
    });

    render();
  }

  window.initEmailSignature = initEmailSignature;

  // Starts itself (engine parity B1): on a hard load and after every page
  // transition (bd:after-nav), as every app does, so no site keeps a list of
  // inits. initEmailSignature bails when its markup is absent.
  function startEmailSignature() {
    initEmailSignature();
  }

  // The transition listener first, so a start that throws on a hard load
  // can't leave the tool dead after the next navigation.
  document.addEventListener('bd:after-nav', startEmailSignature);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEmailSignature);
  } else {
    startEmailSignature();
  }
})();
