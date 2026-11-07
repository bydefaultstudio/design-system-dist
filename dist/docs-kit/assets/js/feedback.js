/**
 * feedback.js — Page feedback: the footer's "Was this helpful?" and the
 * feedback dialog every page can open.
 *
 * Entry points (spec: agency internal/bydefault-os/feedback-form-spec.md):
 *   - Footer Yes   records a thumbs up at once, then offers "Tell us more".
 *   - Footer No    opens the dialog. Closed without sending, it still records
 *                  one "Not helpful", so every Yes and No is counted once.
 *   - [data-feedback-open="more"|"share"|"problem"]  opens the dialog: Tell
 *                  us more (topic "I like it"), and the Share feedback and
 *                  Report a problem items in a bar's menu.
 *
 * The dialog (cms/chrome/feedback-dialog.html) is one per page, outside the
 * Barba container; the footer block is inside it and swaps with the page. So
 * every listener is delegated from the document and attached once, and moving
 * a menu item into a bar's overflow panel (bar.js) changes nothing here.
 *
 * This module opens and closes the dialog itself; it reads no
 * data-dialog-open / data-dialog-close. dialog.js still owns the backdrop and
 * Escape because the dialog carries .dialog. Hub and Email are never sent from
 * here: the server writes them (worker/notion-config.js).
 *
 * @version 3.1.0
 * @author By Default
 */
(function () {
  'use strict';

  console.log('feedback.js v3.1.0 loaded');

  //
  //------- Configuration -------//
  //

  var API_URL = '/api/submit-form';
  var FORM_TYPE = 'feedback';
  var TOPIC_BROKEN = "Something's not working";
  var TOPIC_LIKE = 'I like it';
  var MAX_TEXT = 2000;

  // What each entry point opens with. Source values match the pinned list in
  // worker/notion-config.js.
  var ENTRY_POINTS = {
    no: { source: 'Footer', topic: null, helpful: 'No', fromFooter: true },
    more: { source: 'Footer', topic: TOPIC_LIKE, helpful: null, fromFooter: true },
    share: { source: 'Bar menu: Share feedback', topic: null, helpful: null, fromFooter: false },
    problem: { source: 'Bar menu: Report a problem', topic: TOPIC_BROKEN, helpful: null, fromFooter: false }
  };

  // The message field's words follow the topic.
  var MESSAGE_COPY = {
    "Something's not working": { label: 'What happened?', placeholder: 'What you did, and what you expected', required: true },
    'An idea': { label: "What's your idea?", placeholder: 'What would make this better for you?', required: true },
    'Content is wrong': { label: 'What needs fixing?', placeholder: "What's wrong or missing on this page?", required: true },
    'I like it': { label: "What's working for you? (optional)", placeholder: "Tell us what you'd keep", required: false }
  };
  var MESSAGE_DEFAULT = { label: 'Your message', placeholder: 'Pick a topic, then tell us more', required: true };

  var COPY = {
    thanksYes: 'Thank you. Glad it helped.',
    thanksSent: "Thank you. That's with the team now.",
    thanksNo: 'Thank you for telling us.',
    hintOff: "Turn this on if you'd like a reply.",
    hintOn: "We'll reply to the email you signed in with.",
    needTopic: 'Pick what this is about.',
    needMessage: 'Tell us a little about it.',
    sendFailed: "That didn't send. Your message is still here, so try again.",
    yesFailed: "That didn't send. Try again in a moment.",
    sending: 'Sending…'
  };

  //
  //------- Context (what we capture without asking) -------//
  //

  function getDevice() {
    var w = window.innerWidth;
    if (w < 768) return 'Mobile';
    if (w < 1024) return 'Tablet';
    return 'Desktop';
  }

  // A short summary, never the raw user agent.
  function getBrowser() {
    var ua = navigator.userAgent;
    var browser = 'Other';
    var match;
    if ((match = ua.match(/Edg\/(\d+)/))) browser = 'Edge ' + match[1];
    else if ((match = ua.match(/Firefox\/(\d+)/))) browser = 'Firefox ' + match[1];
    else if ((match = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) browser = 'Chrome ' + match[1];
    else if ((match = ua.match(/Version\/(\d+).*Safari/))) browser = 'Safari ' + match[1];

    var os = 'Other';
    if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Linux/.test(ua)) os = 'Linux';

    return browser + ' · ' + os;
  }

  // Three states on <html> (nav.js): an explicit choice, or none = the OS.
  function getTheme() {
    var choice = document.documentElement.getAttribute('data-theme');
    if (choice === 'dark') return 'Dark';
    if (choice === 'light') return 'Light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light';
  }

  function getPageTitle() {
    var h1 = document.querySelector('[data-barba="container"] h1') || document.querySelector('h1');
    var text = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
    return (text || document.title || '').slice(0, 200);
  }

  function getContext(source) {
    return {
      'Page': window.location.href.slice(0, MAX_TEXT),
      'Page title': getPageTitle(),
      'Source': source,
      'Device': getDevice(),
      'Browser': getBrowser(),
      'Viewport': window.innerWidth + ' × ' + window.innerHeight,
      'Theme': getTheme(),
      'Submitted Date': new Date().toISOString().split('T')[0]
    };
  }

  //
  //------- Submission -------//
  //

  function submit(fields, hp) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ formType: FORM_TYPE, data: fields, hp: hp || '' })
    }).then(function (response) {
      if (response.ok) return response.json();
      return response.json().catch(function () { return {}; }).then(function (err) {
        var error = new Error(err.error || 'Submission failed');
        error.status = response.status;
        throw error;
      });
    });
  }

  // A thumbs up or down with no dialog: one entry, titled as the old form did.
  function submitVerdict(helpful) {
    var fields = getContext('Footer');
    fields['Feedback'] = helpful === 'Yes' ? 'Helpful' : 'Not helpful';
    fields['Helpful'] = helpful;
    return submit(fields, '');
  }

  //
  //------- Footer block -------//
  //

  function getFooter() {
    var sections = document.querySelectorAll('.page-feedback');
    // During a Barba swap two containers can be in the document; the last one
    // is the arriving page.
    return sections.length ? sections[sections.length - 1] : null;
  }

  // Write a line so a screen reader hears it, even when it repeats: cleared
  // first, set on the next frame.
  function announce(el, message) {
    if (!el) return;
    el.textContent = '';
    window.requestAnimationFrame(function () { el.textContent = message; });
  }

  function showFooterThanks(section, message, offerMore) {
    if (!section) return;
    // Was focus in the block (on the button about to hide) or lost to <body>?
    // Then it moves to what replaces it, never into nowhere.
    var active = document.activeElement;
    var moveFocus = !active || active === document.body || section.contains(active);

    var title = section.querySelector('.page-feedback-success-title');
    var more = section.querySelector('[data-feedback-open="more"]');
    var error = section.querySelector('.page-feedback-error');
    if (title) title.textContent = message;
    if (more) more.hidden = !offerMore;
    if (error) { error.textContent = ''; error.hidden = true; }
    section.classList.add('is-submitted');
    announce(section.querySelector('.page-feedback-status'), message);

    if (moveFocus) {
      var target = offerMore && more ? more : title;
      if (target) target.focus();
    }
  }

  function showFooterError(section, message) {
    var error = section && section.querySelector('.page-feedback-error');
    if (!error) return;
    error.hidden = false;
    announce(error, message);
  }

  // aria-disabled plus a busy flag, not `disabled`: disabling the focused
  // button would drop keyboard focus to <body>.
  function setBusy(list, busy) {
    Array.prototype.forEach.call(list, function (el) {
      if (busy) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    });
  }

  function handleYes(button) {
    var section = button.closest('.page-feedback');
    if (!section || section.dataset.feedbackBusy === '1') return;
    var buttons = section.querySelectorAll('[data-feedback]');
    section.dataset.feedbackBusy = '1';
    setBusy(buttons, true);

    submitVerdict('Yes').then(function () {
      showFooterThanks(section, COPY.thanksYes, true);
    }).catch(function (err) {
      console.error('[Feedback] Yes not recorded:', err);
      setBusy(buttons, false);
      showFooterError(section, COPY.yesFailed);
    }).then(function () {
      delete section.dataset.feedbackBusy;
    });
  }

  //
  //------- Dialog -------//
  //

  var dialog = null;
  var form = null;
  var state = null;
  var honeypot = null;

  function q(selector) {
    return dialog.querySelector(selector);
  }

  function getTopic() {
    var checked = form.querySelector('input[name="topic"]:checked');
    return checked ? checked.value : null;
  }

  function setRadio(name, value) {
    Array.prototype.forEach.call(form.querySelectorAll('input[name="' + name + '"]'), function (input) {
      input.checked = value !== null && input.value === value;
    });
  }

  function updateForTopic() {
    var topic = getTopic();
    var copy = (topic && MESSAGE_COPY[topic]) || MESSAGE_DEFAULT;
    q('.feedback-message-label').textContent = copy.label;
    q('.feedback-textarea').placeholder = copy.placeholder;
    q('.feedback-textarea').required = copy.required;
    q('.feedback-impact').hidden = topic !== TOPIC_BROKEN;
  }

  function updateFollowUpHint() {
    q('#feedback-follow-up-hint').textContent = q('#feedback-follow-up').checked ? COPY.hintOn : COPY.hintOff;
  }

  // The controls an error can be about, so it is tied to the one that failed
  // (cms/chip.md: .is-error and aria-invalid together, pointing at the message).
  function fieldControls(field) {
    if (field === 'topic') return form.querySelectorAll('input[name="topic"]');
    if (field === 'message') return [q('.feedback-textarea')];
    return [];
  }

  function markInvalid(field, invalid) {
    Array.prototype.forEach.call(fieldControls(field), function (control) {
      if (invalid) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', 'feedback-error');
      } else {
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby');
      }
    });
    if (field === 'topic') q('.chip-group').classList.toggle('is-error', invalid);
    if (field === 'message') q('.feedback-textarea').classList.toggle('is-error', invalid);
  }

  function showError(message, field, focusTarget) {
    clearError();
    if (field) markInvalid(field, true);
    var error = q('#feedback-error');
    error.hidden = false;
    announce(error, message);
    if (focusTarget) focusTarget.focus();
  }

  function clearError() {
    var error = q('#feedback-error');
    error.textContent = '';
    error.hidden = true;
    markInvalid('topic', false);
    markInvalid('message', false);
  }

  function openDialog(entry, sourceSection) {
    if (!dialog) return;
    var config = ENTRY_POINTS[entry];
    if (!config) return;

    state = {
      source: config.source,
      helpful: config.helpful,
      fromFooter: config.fromFooter,
      section: config.fromFooter ? (sourceSection || getFooter()) : null,
      sent: false
    };

    form.reset();
    honeypot.value = '';
    setRadio('topic', config.topic);
    clearError();
    updateForTopic();
    updateFollowUpHint();

    var submitBtn = dialog.querySelector('button[type="submit"]');
    submitBtn.removeAttribute('aria-disabled');
    submitBtn.textContent = 'Send feedback';

    if (typeof dialog.showModal === 'function') dialog.showModal();

    // Focus the first thing to answer: the topic, or the message when the
    // entry point already picked one.
    var first = config.topic ? q('.feedback-textarea') : form.querySelector('input[name="topic"]');
    if (first) first.focus();
  }

  function validate() {
    var topic = getTopic();
    if (!topic) return { message: COPY.needTopic, field: 'topic', target: form.querySelector('input[name="topic"]') };
    var text = q('.feedback-textarea').value.trim();
    var copy = MESSAGE_COPY[topic] || MESSAGE_DEFAULT;
    if (copy.required && !text) return { message: COPY.needMessage, field: 'message', target: q('.feedback-textarea') };
    return null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!state || state.busy) return;

    var problem = validate();
    if (problem) {
      showError(problem.message, problem.field, problem.target);
      return;
    }
    clearError();

    var topic = getTopic();
    var text = q('.feedback-textarea').value.trim().slice(0, MAX_TEXT);
    var fields = getContext(state.source);
    fields['Feedback'] = text || topic;
    fields['Topic'] = topic;
    // The optional "stopping me working" switch, for a bug only (a checkbox in Notion).
    if (topic === TOPIC_BROKEN) fields['Impact'] = q('#feedback-impact').checked;
    fields['Follow-up'] = q('#feedback-follow-up').checked;
    if (state.helpful) fields['Helpful'] = state.helpful;

    // aria-disabled and a busy flag, so a focused Send keeps focus.
    var submitBtn = dialog.querySelector('button[type="submit"]');
    submitBtn.setAttribute('aria-disabled', 'true');
    submitBtn.textContent = COPY.sending;
    var sending = state;
    sending.busy = true;

    submit(fields, honeypot.value).then(function () {
      sending.sent = true;
      dialog.close();
      if (sending.fromFooter) {
        showFooterThanks(sending.section, COPY.thanksSent, false);
      } else if (typeof window.showToast === 'function') {
        // A bar menu has no block of its own to thank the reader in.
        window.showToast(COPY.thanksSent, 'success');
      }
    }).catch(function (err) {
      console.error('[Feedback] Submit error:', err);
      sending.busy = false;
      submitBtn.removeAttribute('aria-disabled');
      submitBtn.textContent = 'Send feedback';
      // The server's words where they help the reader act (signed out, too
      // many sends); the general line otherwise.
      var message = (err.status === 401 || err.status === 429) && err.message ? err.message : COPY.sendFailed;
      showError(message, null, null);
    });
  }

  // A No closed without sending still counts once.
  function handleClose() {
    var closing = state;
    state = null;
    if (!closing || closing.sent || closing.helpful !== 'No') return;
    submitVerdict('No').then(function () {
      showFooterThanks(closing.section, COPY.thanksNo, false);
    }).catch(function (err) {
      console.error('[Feedback] No not recorded:', err);
    });
  }

  //
  //------- Event Listeners -------//
  //

  function handleDocumentClick(e) {
    var verdict = e.target.closest('.page-feedback [data-feedback]');
    if (verdict) {
      if (verdict.getAttribute('data-feedback') === 'yes') {
        handleYes(verdict);
      } else {
        openDialog('no', verdict.closest('.page-feedback'));
      }
      return;
    }

    var opener = e.target.closest('[data-feedback-open]');
    if (opener) {
      openDialog(opener.getAttribute('data-feedback-open'), opener.closest('.page-feedback'));
    }
  }

  //
  //------- Init -------//
  //

  function initDialog() {
    dialog = document.querySelector('.feedback-modal');
    if (!dialog) {
      console.warn('[Feedback] No .feedback-modal on this page; the dialog cannot open.');
      return;
    }
    form = dialog.querySelector('.feedback-form');

    // Honeypot (spam trap): a field no human sees or fills.
    honeypot = document.createElement('input');
    honeypot.type = 'text';
    honeypot.name = 'hp';
    honeypot.className = 'hp-field';
    honeypot.tabIndex = -1;
    honeypot.autocomplete = 'off';
    honeypot.setAttribute('aria-hidden', 'true');
    // Beside the form, not in it: the form is a flex stack, and even an
    // invisible item takes a gap.
    form.parentNode.appendChild(honeypot);

    q('.feedback-textarea').maxLength = MAX_TEXT;

    form.addEventListener('change', function (e) {
      if (e.target.name === 'topic') {
        updateForTopic();
        clearError();
      } else if (e.target.id === 'feedback-follow-up') {
        updateFollowUpHint();
      }
    });
    form.addEventListener('submit', handleSubmit);
    // The header's X and the footer's Cancel both close it.
    Array.prototype.forEach.call(dialog.querySelectorAll('.feedback-modal-close'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    dialog.addEventListener('close', handleClose);
  }

  function initFeedback() {
    if (document.documentElement.dataset.feedbackInit === '1') return;
    document.documentElement.dataset.feedbackInit = '1';
    initDialog();
    document.addEventListener('click', handleDocumentClick);
    console.log('[Feedback] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeedback);
  } else {
    initFeedback();
  }

  // barba-init.js calls this after every page swap. Everything is delegated
  // from the document, so there is nothing per page to bind; it stays as the
  // documented hook.
  window.bdInitFeedback = initFeedback;
})();
