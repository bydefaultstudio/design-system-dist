/* @bydefaultstudio/design-system v2.2.1 */
// Copy button — unified handler for all .copy-btn variants
// Supports data-copy (static value), data-clipboard-target (element text
// content) and data-download (fetch-free file download via a temporary link).
// Docs-site copy chrome (token chips, icon tables, palette buttons) lives
// in assets/js/docs-copy-chrome.js — this module is the portable component.
//
// Optional config, defined before this script loads:
//   window.bdCopyButtonConfig = {
//     // When set, feedback icons render as <use> refs into this sprite
//     // (which must contain a #check symbol, same-origin). Default: inline
//     // path data, keeping the module dependency-free.
//     spritePath: "/assets/images/svg-icons/_sprite.svg"
//   };
(function () {
  'use strict';

  var FEEDBACK_DURATION = 2000;

  var ICON_CHECK_INLINE = '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M9.54998 18L3.84998 12.3L5.27498 10.875L8.13576 13.7358C8.91681 14.5168 10.1831 14.5168 10.9642 13.7358L18.725 5.97501L20.15 7.40001L9.54998 18Z" fill="currentColor"/>'
    + '</svg>';

  // Config is read at render time, not at script load, so it works however
  // the config block and this script are ordered.
  function iconCheck() {
    var config = window.bdCopyButtonConfig;
    if (config && config.spritePath) {
      return '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
        + '<use href="' + config.spritePath + '#check"/></svg>';
    }
    return ICON_CHECK_INLINE;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts. execCommand reports failure via its
    // return value or by throwing — both must reject, or the caller shows
    // "Copied!" for a copy that never happened.
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      var copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (err) {
        document.body.removeChild(textarea);
        reject(err);
        return;
      }
      document.body.removeChild(textarea);
      if (copied) resolve();
      else reject(new Error('execCommand copy returned false'));
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-btn');
    if (!btn) return;
    // Download buttons are handled by their own listener below — never let
    // one button copy and download on the same click.
    if (btn.hasAttribute('data-download')) return;

    var text;

    // Static value from data-copy attribute
    if (btn.hasAttribute('data-copy')) {
      text = btn.getAttribute('data-copy');
    }

    // Target element text content from data-clipboard-target
    if (!text && btn.hasAttribute('data-clipboard-target')) {
      var target = document.querySelector(btn.getAttribute('data-clipboard-target'));
      if (target) text = target.value || target.textContent;
    }

    if (!text) return;

    copyToClipboard(text).then(function () {
      btn.classList.add('is-copied');

      // Swap tooltip text if present. The original is captured once, in its
      // own attribute — a second click inside the feedback window would
      // otherwise capture "Copied!" as the original and leave it stuck.
      if (btn.hasAttribute('data-tooltip') && !btn.hasAttribute('data-tooltip-original')) {
        btn.setAttribute('data-tooltip-original', btn.getAttribute('data-tooltip'));
      }
      if (btn.hasAttribute('data-tooltip-original')) {
        btn.setAttribute('data-tooltip', 'Copied!');
      }

      clearTimeout(btn.bdCopyRevertTimer);
      btn.bdCopyRevertTimer = setTimeout(function () {
        btn.classList.remove('is-copied');
        if (btn.hasAttribute('data-tooltip-original')) {
          btn.setAttribute('data-tooltip', btn.getAttribute('data-tooltip-original'));
          btn.removeAttribute('data-tooltip-original');
        }
      }, FEEDBACK_DURATION);
    }).catch(function (err) {
      // No false success state; the button stays as it was.
      console.warn('[copy-button] copy failed:', err);
    });
  });

  // Download variant — .copy-btn[data-download] downloads a same-origin file
  // through a temporary anchor. Composes with the same styling; a download
  // button carries no data-copy / data-clipboard-target, so the copy handler
  // above ignores it.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-btn[data-download]');
    if (!btn) return;

    var url = btn.getAttribute('data-download');
    if (!url) return;

    var a = document.createElement('a');
    a.href = url;
    a.download = btn.getAttribute('data-download-name') || '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // Auto-enhance any .copy-btn that lacks the two-span structure.
  // Wraps existing content into .copy-btn-default / .copy-btn-copied
  // so the CSS state swap (is-copied) shows a check icon + "Copied".
  function initCopyButtons() {
    var buttons = document.querySelectorAll('.copy-btn');
    buttons.forEach(function (btn) {
      if (btn.querySelector('.copy-btn-default')) return;
      if (btn.classList.contains('color-row')) return;
      var content = btn.innerHTML;
      btn.innerHTML = '<span class="copy-btn-default">' + content + '</span>'
        + '<span class="copy-btn-copied"><div class="svg-icn">' + iconCheck() + '</div> Copied</span>';
    });
  }

  // Expose for re-init after client-side page swaps
  window.bdInitCopyButtons = initCopyButtons;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCopyButtons);
  } else {
    initCopyButtons();
  }
})();
