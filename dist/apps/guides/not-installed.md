---
title: "Not installed"
description: "The page a reader sees at the address of an app this site doesn't install, served at that address with a 404."
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
  The not-installed page (engine parity phase B, PB-4). It ships with the
  engine, and a site's own cms/not-installed.md replaces it. The Worker
  serves this body, with 404 so nothing indexes it, at the address of an app
  the site doesn't install, or of that app's guide: an old bookmark, or a
  link copied from another site on the engine. A root page with site-absolute
  links, because it is served at /tools/ or /settings/.

  data-not-installed-app is the one thing the Worker fills in (gate.mjs
  notInstalledFor): the app's name, from page-access.mjs NOT_INSTALLED. The
  words around it invite the reader to ask for the app, never apologise.
-->
<div class="locked-panel block gap-l align-center" data-not-installed>
  <div class="locked-panel-icon" aria-hidden="true">{{icon:info-circled}}</div>
  <h1 class="locked-panel-title" data-text-wrap="balance"><span data-not-installed-app>This tool</span> isn't part of {{brand:siteName}} yet.</h1>
  <p class="locked-panel-description">Ask your {{brand:siteName}} owner about adding it.</p>
  <div class="button-group justify-center">
    <a class="button" data-variant="text" href="/index.html">Go to the home page</a>
  </div>
</div>
