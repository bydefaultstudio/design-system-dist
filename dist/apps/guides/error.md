---
title: "Something went wrong"
description: "The page anyone sees when the site fails to answer a request, served at the address they asked for with a 500."
author: "Studio"
layer: "docs-site"
type: "bare"
status: "published"
access: "public"
---
<!--
  The error page. It ships with the engine and a site's own cms/error.md
  replaces it. The Worker serves this body, with 500 and no caching, at the
  address the reader asked for when answering it threw (gate-entry.mjs). It
  is public because the failure can come before the reader is known, and it
  says nothing about the request: the cause is in the Worker's log, not on
  the page. Try again is a plain link to the same address, so it works with
  no script running.
-->
<section class="top-small">
  <div class="padding-global">
    <div class="container-s">
      <div class="locked-panel block gap-l align-center" data-error-page>
        <div class="locked-panel-icon" aria-hidden="true">{{icon:warning}}</div>
        <h1 class="locked-panel-title" data-text-wrap="balance">Something went wrong on our side.</h1>
        <p class="locked-panel-description">This page didn't load. Nothing you did caused it. Try again in a moment, and if it keeps happening, tell the {{brand:siteName}} team which page you were opening.</p>
        <div class="button-group justify-center">
          <a class="button" href="" data-error-retry>Try again</a>
          <a class="button" data-variant="text" href="/index.html">Go to the home page</a>
        </div>
      </div>
    </div>
  </div>
</section>
