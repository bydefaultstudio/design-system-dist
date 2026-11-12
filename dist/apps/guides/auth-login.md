---
title: "Sign in"
description: "Sign in to {{brand:siteName}} with a one-time code sent to your email."
author: "Studio"
layer: "docs-site"
type: "bare"
search: "false"
status: "published"
access: "public"
scripts: "cell-input.js, auth-login.js"
---
<!--
  The sign-in page (engine-parity-phase-d.md, D26). It ships with the engine
  and builds at /auth/login.html on every site with the access gate, in the
  site's own brand: the logo is the brand's primary from brand.json, the
  name in the title and description is the site's. A site's own
  cms/auth-login.md replaces it, and the build then checks the replacement
  still carries every id auth-login.js reads, because a sign-in page whose
  script finds nothing is a door that doesn't open.

  Every file this page loads must be public at the gate (the build checks
  that too): a signed-out reader is the only one who sees it.
-->
<div class="login-page">
  <div class="card login">
    <!-- Notifications have dedicated places. Confirmations ("Code sent")
         live here, at the top of the card, as a banner over the whole screen.
         Errors live under the field they concern (every one, including
         offline and rate-limit, because that is where the reader is), in each
         pane's .form-error line, which is its own live region. Nothing is
         said twice. This region is shared by both panes and sits outside
         them on purpose: a region inside a hidden pane is revealed from
         display:none, and a polite region revealed that way is not reliably
         announced. Rendered from first paint; only ever changes text. -->
    <p class="login-status" id="login-success" data-type="success" role="status" aria-live="polite"></p>

    <div class="login-header">
      <div class="login-logo" role="img" aria-label="{{brand:name}} logo">{{logo:primary}}</div>
      <h1 class="login-title" id="login-title">Sign in</h1>
      <p class="login-subtitle" id="login-subtitle">A one-time code goes to your email.</p>
    </div>

    <!-- Pane 1: email. Named people only: the address is the whole credential. -->
    <form class="login-form" id="login-email-form" autocomplete="on" novalidate>
      <div class="form-group">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required aria-required="true" placeholder="you@company.com" aria-describedby="login-email-error">
        <!-- The pane's error line: the field's description AND the live
             region that announces it. Rendered from first paint and empty at
             rest (design-system.css §46 says why not hidden), and TRULY
             empty: no whitespace between the tags, or :empty stops matching
             and the group gap reopens. auth-login.js fills it with the icon
             from #login-field-icon plus the message, and empties it again;
             the icon is never in the DOM without a message, so nothing stale
             is ever described. -->
        <p class="form-error" id="login-email-error" role="alert" aria-live="assertive"></p>
      </div>
      <button type="submit" class="button" data-full-width id="login-send-btn">Send code</button>
    </form>

    <!-- Pane 2: the code. inputmode + autocomplete let the keyboard and the
         browser hand the code over from the email that delivered it. -->
    <form class="login-form is-hidden" id="login-code-form" autocomplete="on" novalidate>
      <div class="form-group">
        <label for="login-code">Enter the 6-digit code</label>
        <!-- Cell input: one cell per digit, so the shape is visible before a
             character is typed (cms/cell-input.md). ONE real input keeps the
             caret, the soft keyboard and iOS SMS autofill working, never one
             input per cell. The input lies over the cells and takes the tap,
             so a long-press offers Paste; the cells row is aria-hidden
             decoration.
             aria-label carries the accessible name and BEGINS WITH the visible
             label's words (WCAG 2.5.3), so speech input can say what it sees. -->
        <div class="cell-input" data-format="6" data-mode="digits" data-full-width>
          <label class="cell-input-cells" for="login-code" aria-hidden="true"></label>
          <input type="text" id="login-code" name="code" aria-label="Enter the 6-digit code" inputmode="numeric"
                 autocomplete="one-time-code" autocorrect="off" autocapitalize="none" spellcheck="false"
                 required aria-required="true" aria-describedby="login-subtitle login-code-error">
        </div>
        <p class="form-error" id="login-code-error" role="alert" aria-live="assertive"></p>
      </div>
      <button type="submit" class="button" data-full-width id="login-verify-btn">Verify</button>
      <div class="login-footer">
        <p class="login-hint">Didn’t get the code? <button type="button" class="button" data-variant="text" data-color="accent" id="login-resend-btn">Send again</button></p>
        <button type="button" class="button" data-variant="text" data-color="accent" id="login-change-btn">Use a different email</button>
      </div>
    </form>
  </div>

  <!-- The error line's icon, cloned in by auth-login.js, which marks the
       clone aria-hidden: that is what keeps it out of the field's
       description (accname excludes a hidden descendant of a visible
       referenced node), and the text node beside it carries the meaning. -->
  <template id="login-field-icon">{{icon:warning}}</template>
</div>
