---
title: "Locked"
description: "The page a signed-in reader sees when their account cannot open the page they asked for, served at that page's own address."
author: "Studio"
section: "Docs"
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
  The locked page (permissions-plan.md §4.6). It ships with the engine and
  builds at /locked.html on every site with the access gate (phase D); a
  site's own cms/locked.md replaces it. The Worker serves this body at the
  URL the reader asked for, with 403, when authorise() says no, so the
  sidebar highlights the section they were in and a reload after access is
  granted lands on the page itself. Pinned at the root with `base: '/'`
  (apps.js ENGINE_PAGES) so every href is site-absolute: served under /docs/
  or /tools/ a depth-relative asset path would resolve under the wrong folder.

  data-locked-level is the one thing the Worker fills in (worker/session.js,
  denyLocked): the level that refused the reader. The h1 and the description
  hold every wording; the Worker keeps only the matching one (gate.mjs
  lockedFor), and the CSS shows it should a span ever arrive unstripped.
  An owner page offers no Ask for access: nobody can grant it.

  The button posts the Ask for access form (the one on /support.html) with
  the reader's email and the page's URL, so a signed-in request needs
  nothing typed. The form service sends it on: to the site's own inbox on a
  client site (PC-8). locked.js owns it.
-->
<div class="locked-panel block gap-l align-center" data-locked-level="" data-locked>
  <div class="locked-panel-icon" aria-hidden="true">{{icon:lock}}</div>
  <h1 class="locked-panel-title" data-text-wrap="balance"><span data-for="team">This page is for the team.</span><span data-for="admin">This page is for admins.</span><span data-for="owner">This page is for the owner.</span></h1>
  <p class="locked-panel-description" id="locked-panel-description"><span data-for="team">An admin can open it for your account.</span><span data-for="admin">An admin can open it for your account.</span><span data-for="owner">It runs the system itself, so only an owner opens it.</span></p>
  <div class="button-group justify-center">
    <button type="button" class="button" id="locked-ask" aria-describedby="locked-panel-description">Ask for access</button>
    <a class="button" data-variant="text" href="/index.html">Go to the home page</a>
  </div>
  <p class="locked-panel-status" id="locked-status" role="status" aria-live="polite"></p>
</div>
