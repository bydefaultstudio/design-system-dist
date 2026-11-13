/**
 * access-support-form.js — Access & Support request form
 * Fixed-field form that submits to Notion via /api/submit-form.
 * Reads ?from= query parameter to capture page context.
 *
 * The container may preset the form for one job (book-a-demo does):
 *   data-request-type   preselects that Request Type option
 *   data-message-label  replaces the message field's label
 *   data-message-hint   replaces the message field's hint
 *   data-message-error  replaces the message field's "empty" error
 *   data-submit-label   replaces the submit button's text
 *   data-success-title  replaces the confirmation's heading
 *   data-success        replaces the confirmation's line; {email} in it
 *                       becomes the address the reader gave
 *   data-success-link   a link the confirmation offers, as "label|href"
 *   data-error          replaces the error message, e.g. with an address
 *                       to write to instead
 *   data-support-email  the site's support address (brand.json
 *                       wording.supportEmail), named in the error message
 *                       when there is no data-error. Empty means none
 *   data-turnstile-sitekey  shows the Turnstile check and sends its token
 *                       (the site key is public; the Worker holds the secret)
 * An unknown data-request-type is ignored, so the select falls back to its
 * placeholder rather than sending a value the Worker would refuse.
 *
 * The confirmation replaces the form, and the page's own [data-hide-on-success]
 * elements (its heading and lead) step aside, so it stands alone on the page.
 * Icons come from <template data-icon="warning|check-circled"> inside the
 * container, read before the form is built: the page renders them from the
 * brand's icon set, and without them the messages show with no icon.
 *
 * @version 1.5.0
 * @author By Default
 */
(function () {
  'use strict';

  console.log('access-support-form.js v1.5.0 loaded');

  //
  //------- Configuration -------//
  //

  var API_BASE = '/api';
  var FORM_TYPE = 'access-support';
  // Every message says what happened and what to do next, and none blames
  // the reader. The field errors name the action, not the rule broken.
  var COPY = {
    needName: 'Enter your name.',
    needEmail: 'Enter your email address.',
    badEmail: 'Enter a full email address, like name@company.com.',
    needType: 'Choose what you need help with.',
    needMessage: 'Tell us what\u2019s happening.',
    sending: 'Sending\u2026',
    failed: 'The request did not send. Try again in a minute.',
    failedWithEmail: 'The request did not send. Try again, or email ',
    successTitle: 'Request sent.',
    success: 'The answer comes to {email}.'
  };

  // Mirrored in worker/notion-config.js FORMS options, which refuses any
  // other value. Change both together.
  var REQUEST_TYPE_OPTIONS = [
    'Access Request',
    'Permission Issue',
    'Account Problem',
    'General Support',
    'Other'
  ];

  // Offered only when the container presets them (book-a-demo.html), so the
  // general support form, reached from locked pages, carries no sales option.
  // Also mirrored in worker/notion-config.js.
  var PRESET_ONLY_OPTIONS = ['Book a walkthrough'];

  var TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var TURNSTILE_WAIT = 'The spam check is still running. Wait a moment, then send.';

  // The widget's state: its id once rendered, and the token it last gave.
  var turnstile = { id: null, token: '' };

  //
  //------- Utilities -------//
  //

  // The container's own error message (data-error), else one naming the
  // site's support address (data-support-email), else the default.
  function errorMessageFor(node) {
    var container = node && node.closest ? node.closest('.access-support-form') : null;
    if (container && container.dataset.error) return container.dataset.error;
    var email = container && container.dataset.supportEmail ? container.dataset.supportEmail.trim() : '';
    if (email) return COPY.failedWithEmail + email + '.';
    return COPY.failed;
  }

  function getTodayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function getFromParam() {
    var params = new URLSearchParams(window.location.search);
    return params.get('from') || window.location.href;
  }

  //
  //------- Form Builder -------//
  //

  // The page's icon templates, kept before the container is emptied.
  var icons = {};

  function readIcons(container) {
    container.querySelectorAll('template[data-icon]').forEach(function (template) {
      icons[template.dataset.icon] = template;
    });
  }

  // A fresh copy of an icon, hidden from the accessibility tree: the words
  // beside it carry the meaning. Null when the page gave none.
  function iconFor(name) {
    var template = icons[name];
    if (!template || !template.content.firstElementChild) return null;
    var icon = template.content.firstElementChild.cloneNode(true);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  // A message line with the warning icon before it, the field-error pattern.
  function fillMessage(element, message) {
    element.replaceChildren();
    var icon = iconFor('warning');
    if (icon) element.appendChild(icon);
    element.appendChild(document.createTextNode(message));
  }

  function renderForm(container) {
    var preset = container.dataset;
    readIcons(container);
    container.innerHTML = '';

    var form = document.createElement('form');
    form.className = 'access-support-form-element';
    form.noValidate = true;

    // Name field
    var nameGroup = createTextInput('name', 'Your name', 'text', true, 'name');
    form.appendChild(nameGroup);

    // Email field
    var emailGroup = createTextInput('email', 'Your email address', 'email', true, 'email');
    form.appendChild(emailGroup);

    // Request Type select
    var options = REQUEST_TYPE_OPTIONS.slice();
    if (PRESET_ONLY_OPTIONS.indexOf(preset.requestType) !== -1) {
      options.splice(options.length - 1, 0, preset.requestType);
    }
    var selectGroup = createSelect('request-type', 'What do you need help with?', options, true);
    if (preset.requestType && options.indexOf(preset.requestType) !== -1) {
      selectGroup.querySelector('select').value = preset.requestType;
    }
    form.appendChild(selectGroup);

    // Message textarea
    var messageGroup = createTextarea(
      'message',
      preset.messageLabel || 'Tell us what\u2019s happening',
      preset.messageHint || 'The more detail you give us, the faster we can help.',
      true
    );
    form.appendChild(messageGroup);

    // Honeypot (spam trap) — hidden field that humans never see or fill.
    form.appendChild(createHoneypot());

    // Turnstile check, when the page carries a site key.
    if (preset.turnstileSitekey) {
      var check = document.createElement('div');
      check.className = 'form-group access-support-check';
      form.appendChild(check);
      renderTurnstile(check, preset.turnstileSitekey);
    }

    // Submit button
    var submitGroup = document.createElement('div');
    submitGroup.className = 'form-group';
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'button';
    submitBtn.textContent = preset.submitLabel || 'Send request';
    submitGroup.appendChild(submitBtn);
    form.appendChild(submitGroup);

    container.appendChild(form);

    setupSubmitHandler(form, container);
  }

  function createTextInput(id, labelText, inputType, required, autocomplete) {
    var group = document.createElement('div');
    group.className = 'form-group';

    var label = document.createElement('label');
    label.setAttribute('for', 'support-' + id);
    label.textContent = labelText + (required ? ' *' : '');

    var input = document.createElement('input');
    input.type = inputType;
    input.id = 'support-' + id;
    input.name = id;
    if (autocomplete) input.autocomplete = autocomplete;
    if (required) input.required = true;

    group.appendChild(label);
    group.appendChild(input);
    return group;
  }

  function createSelect(id, labelText, options, required) {
    var group = document.createElement('div');
    group.className = 'form-group';

    var label = document.createElement('label');
    label.setAttribute('for', 'support-' + id);
    label.textContent = labelText + (required ? ' *' : '');

    var select = document.createElement('select');
    select.id = 'support-' + id;
    select.name = id;
    if (required) select.required = true;

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose one';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    options.forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });

    group.appendChild(label);
    group.appendChild(select);
    return group;
  }

  function createTextarea(id, labelText, hintText, required) {
    var group = document.createElement('div');
    group.className = 'form-group';

    var label = document.createElement('label');
    label.setAttribute('for', 'support-' + id);
    label.textContent = labelText + (required ? ' *' : '');

    var textarea = document.createElement('textarea');
    textarea.id = 'support-' + id;
    textarea.name = id;
    textarea.rows = 5;
    if (required) textarea.required = true;

    group.appendChild(label);
    group.appendChild(textarea);

    if (hintText) {
      var hint = document.createElement('p');
      hint.className = 'form-hint';
      hint.id = 'support-' + id + '-hint';
      hint.textContent = hintText;
      textarea.setAttribute('aria-describedby', hint.id);
      group.appendChild(hint);
    }

    return group;
  }

  function createHoneypot() {
    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'hp';
    input.className = 'hp-field';
    input.tabIndex = -1;
    input.autocomplete = 'off';
    input.setAttribute('aria-hidden', 'true');
    return input;
  }

  //
  //------- Validation -------//
  //

  function validateForm(form) {
    var errors = [];

    // Clear previous errors
    form.querySelectorAll('.is-error').forEach(function (el) {
      el.classList.remove('is-error');
      el.removeAttribute('aria-invalid');
      var describedBy = (el.getAttribute('aria-describedby') || '')
        .split(' ')
        .filter(function (id) { return id && id !== el.id + '-error'; })
        .join(' ');
      if (describedBy) el.setAttribute('aria-describedby', describedBy);
      else el.removeAttribute('aria-describedby');
    });
    // Field errors only: the form-level line (a send failure naming the
    // support address) is showError's and clearError's to manage.
    form.querySelectorAll('.form-error:not(.access-support-error)').forEach(function (el) {
      el.remove();
    });

    var container = form.closest('.access-support-form');
    var messageError = (container && container.dataset.messageError) || COPY.needMessage;
    var fields = [
      { name: 'name', empty: COPY.needName },
      { name: 'email', empty: COPY.needEmail },
      { name: 'request-type', empty: COPY.needType },
      { name: 'message', empty: messageError }
    ];

    fields.forEach(function (field) {
      var input = form.querySelector('[name="' + field.name + '"]');
      if (!input) return;

      var value = input.value ? input.value.trim() : '';
      var message = '';
      if (!value) message = field.empty;
      // The form is novalidate, so the browser's own check is read here:
      // "lena@" passes a non-empty test and would otherwise reach the Worker.
      else if (input.type === 'email' && input.validity.typeMismatch) message = COPY.badEmail;
      if (message) {
        errors.push(field.name);
        input.classList.add('is-error');
        addFieldError(input, message);
      }
    });

    // Move focus to the first field that needs attention, so its label and
    // error are read out rather than leaving focus on the submit button.
    var firstInvalid = form.querySelector('.is-error');
    if (firstInvalid) firstInvalid.focus();

    return errors;
  }

  function addFieldError(element, message) {
    var error = document.createElement('div');
    error.className = 'form-error';
    error.id = element.id + '-error';
    fillMessage(error, message);
    element.parentNode.appendChild(error);
    element.setAttribute('aria-invalid', 'true');
    var describedBy = element.getAttribute('aria-describedby');
    element.setAttribute('aria-describedby', describedBy ? describedBy + ' ' + error.id : error.id);
  }

  //
  //------- Turnstile -------//
  //

  function loadTurnstile(onReady) {
    if (window.turnstile) { onReady(); return; }
    var existing = document.querySelector('script[data-turnstile]');
    if (existing) { existing.addEventListener('load', onReady); return; }
    var script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.setAttribute('data-turnstile', '');
    script.addEventListener('load', onReady);
    // Blocked or offline: the form still sends, and the Worker's refusal
    // shows the usual error with the support address.
    script.addEventListener('error', function onTurnstileError() {
      console.error('[Access Support] Turnstile did not load');
    });
    document.head.appendChild(script);
  }

  function renderTurnstile(target, sitekey) {
    loadTurnstile(function onTurnstileReady() {
      turnstile.id = window.turnstile.render(target, {
        sitekey: sitekey,
        size: 'flexible',
        callback: function onToken(token) {
          turnstile.token = token;
          clearError(target.closest('form'));
        },
        'expired-callback': function onExpired() { turnstile.token = ''; },
        // The check cannot finish: say so, with the address to write to,
        // rather than leave the reader waiting on it.
        'error-callback': function onTurnstileFail() {
          turnstile.token = '';
          showError(target.closest('form'), errorMessageFor(target));
        }
      });
    });
  }

  // The success state replaces the form; the widget goes first, or Turnstile
  // keeps refreshing a token for an element that no longer exists.
  function removeTurnstile() {
    if (window.turnstile && turnstile.id !== null) window.turnstile.remove(turnstile.id);
    turnstile.id = null;
    turnstile.token = '';
  }

  function resetTurnstile() {
    turnstile.token = '';
    if (window.turnstile && turnstile.id !== null) window.turnstile.reset(turnstile.id);
  }

  //
  //------- Submission -------//
  //

  function submitForm(formData) {
    var data = {
      'Name': formData.name,
      'Email': formData.email,
      'Request Type': formData.requestType,
      'Message': formData.message,
      'Page or Section': getFromParam(),
      'Submitted Date': getTodayISO()
    };

    return fetch(API_BASE + '/submit-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType: FORM_TYPE, data: data, hp: formData.hp || '', turnstile: turnstile.token })
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (err) {
          throw new Error(err.error || COPY.failed);
        });
      }
      return response.json();
    });
  }

  //
  //------- Submit Handler -------//
  //

  function setupSubmitHandler(form, container) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var errors = validateForm(form);
      if (errors.length > 0) return;

      // The widget rendered but has not given a token yet.
      if (turnstile.id !== null && !turnstile.token) {
        showError(form, TURNSTILE_WAIT);
        return;
      }

      // Never `disabled`: disabling the focused button drops focus to
      // <body>, and after a failed send the next Tab would start from the
      // top. aria-disabled says it; the busy flag stops a second send.
      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn.getAttribute('aria-busy') === 'true') return;
      var originalText = submitBtn.textContent;
      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.textContent = COPY.sending;

      var hpField = form.querySelector('[name="hp"]');
      var formData = {
        name: form.querySelector('[name="name"]').value.trim(),
        email: form.querySelector('[name="email"]').value.trim(),
        requestType: form.querySelector('[name="request-type"]').value,
        message: form.querySelector('[name="message"]').value.trim(),
        hp: hpField ? hpField.value : ''
      };

      submitForm(formData).then(function () {
        removeTurnstile();
        renderSuccess(container, formData.email);
      }).catch(function (err) {
        console.error('[Access Support] Submit error:', err);
        submitBtn.removeAttribute('aria-disabled');
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = originalText;

        // A token is single-use: the next send needs a fresh one.
        resetTurnstile();
        showError(form, errorMessageFor(form));
      });
    });
  }

  function clearError(form) {
    var existing = form && form.querySelector('.access-support-error');
    if (existing) existing.remove();
  }

  function showError(form, message) {
    if (!form) return;
    clearError(form);

    var errorEl = document.createElement('div');
    errorEl.className = 'form-error access-support-error';
    errorEl.setAttribute('role', 'alert');
    fillMessage(errorEl, message);
    form.appendChild(errorEl);
  }

  //
  //------- Success State -------//
  //

  // The confirmation stands alone: it replaces the form, and the page's
  // heading and lead step aside (data-hide-on-success), so the reader meets
  // one answer, not a form page with a line at the bottom.
  function renderSuccess(container, email) {
    var preset = container.dataset;
    var scope = container.closest('section') || document;
    scope.querySelectorAll('[data-hide-on-success]').forEach(function (el) {
      el.classList.add('is-hidden');
    });
    container.innerHTML = '';

    // No live region: focus moves to the heading below, which reads the
    // confirmation once. A region that arrives already filled is announced
    // unreliably, and with focus as well it is often read twice.
    var success = document.createElement('div');
    success.className = 'access-support-success';

    var icon = iconFor('check-circled');
    if (icon) {
      icon.classList.add('access-support-success-icon');
      success.appendChild(icon);
    }

    // The page's own h1 has stepped aside, so this is the page's heading now,
    // as on the stop pages it copies.
    var title = document.createElement('h1');
    title.className = 'access-support-success-title';
    title.tabIndex = -1;
    title.textContent = preset.successTitle || COPY.successTitle;
    success.appendChild(title);

    var text = document.createElement('p');
    // split/join, not replace: a $ in the address must stay literal
    text.textContent = (preset.success || COPY.success).split('{email}').join(email);
    success.appendChild(text);

    // "label|href", split at the first bar. Only a site path, an anchor,
    // https: or mailto: is linked, so the attribute can never carry script.
    var linkSpec = preset.successLink || '';
    var bar = linkSpec.indexOf('|');
    var linkLabel = bar > 0 ? linkSpec.slice(0, bar).trim() : '';
    var linkHref = bar > 0 ? linkSpec.slice(bar + 1).trim() : '';
    if (linkLabel && /^(\/|#|https:|mailto:)/i.test(linkHref)) {
      var a = document.createElement('a');
      a.className = 'button';
      a.setAttribute('data-variant', 'text');
      a.href = linkHref;
      a.textContent = linkLabel;
      success.appendChild(a);
    }

    container.appendChild(success);
    // The form that held focus is gone; put focus on the heading so it is not
    // dropped to <body>, and the confirmation is read from its start.
    title.focus();
  }

  //
  //------- Initialize -------//
  //

  function init() {
    var container = document.querySelector('.access-support-form');
    if (!container) return;

    renderForm(container);
    console.log('[Access Support] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
