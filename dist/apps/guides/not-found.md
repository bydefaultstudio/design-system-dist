---
title: "Not found"
description: "The page a signed-in reader sees at an address the site has no page for, served at that address with a 404."
author: "Studio"
layer: "docs-site"
type: "page"
header: "false"
bar: "false"
pagination: "false"
chrome: "false"
search: "false"
status: "published"
access: "team"
---
<!--
  The not-found page. It ships with the engine and a site's own
  cms/not-found.md replaces it. The Worker serves this body, with 404, at an
  address the site has no page for, and only to a signed-in reader: a
  signed-out visitor meets the sign-in page at every gated address, so they
  never learn whether a path exists (access-plan.md §12.7). A root page with
  site-absolute links, because it is served at any depth.
-->
<div class="locked-panel block gap-l align-center" data-not-found>
  <div class="locked-panel-icon" aria-hidden="true">{{icon:info-circled}}</div>
  <h1 class="locked-panel-title" data-text-wrap="balance">There's no page at this address.</h1>
  <p class="locked-panel-description">It may have moved or been renamed. The home page lists every section of {{brand:siteName}}.</p>
  <div class="button-group justify-center">
    <a class="button" href="/index.html">Go to the home page</a>
  </div>
</div>
