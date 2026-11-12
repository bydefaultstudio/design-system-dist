---
title: "Search"
subtitle: "Every name in the system, and the pages behind them"
description: "Search the whole system by name — every token, class, icon and glossary term — or search the prose behind them. Narrow to one type, then open any result."
author: "Studio"
type: "page"
layer: "docs-site"
search: "false"
chrome: "false"
status: "published"
access: "team"
---
<!-- type: "page": this body is raw HTML, injected verbatim. No markdown
     pipeline; the {{icon:name}} shorthand still expands.

     The page type releases the docs measure, so the body brings its own:
     one .container-m around everything, per the layout hierarchy.

     WHY THIS PAGE EXISTS. The dialog shows five rows per group and its only
     route to the rest was a footer link that `@media (max-width: 768px)`
     hides — so on every phone and most tablets there was no route at all.
     This is that route, and it is also where a ?q= link lands.

     `search: "false"` keeps the page out of its own results.

     `chrome: "false"` drops the feedback block and footer. "Was this page
     helpful? We use this feedback to improve our documentation" under a list
     of results — or under "Nothing matches" — asks the reader to grade a
     page nobody wrote, about documentation this is not.

     THE PARTS ARE THE DIALOG'S. Same class names, same behaviour, same
     module: assets/js/search.js builds one surface per host, and this is a
     host. What it does NOT have is the dialog's close button (nothing to
     close), its key-hint footer (nothing to hint) and its "See all results"
     row (this is it). It also fetches deeper and caps nothing.
     See cms/search-dialog.md, added in Phase 5.

     Ids differ from the dialog's on purpose. Both surfaces are in this
     document at once — the header trigger still opens the dialog here — so
     `site-search-input` and `search-page-input` must not collide, and the
     module namespaces its generated row ids the same way.

     NO SITE-ABSOLUTE URLS IN HERE. An HTML body skips siteHref, so a path
     written `/search-index/...` would ignore basePath while the generated dialog
     honoured it. The form therefore carries no action (a form without one
     submits to the current URL, which is exactly right), and the module
     reads the index URLs from the generated dialog rather than from here. -->
<div class="container-m">
<div class="search-page block gap-l" id="search-page">

  <!-- Without JS this submits to itself with ?q=, which renders nothing but
       is honest: the field keeps working and the URL is shareable. With JS
       the module takes the submit and answers in place.

       No role on the <form>: <search> already has an implicit role="search",
       and the pair nested one inside the other put two unnamed search
       landmarks on the page whose whole purpose is search. -->
  <form method="get">
    <search class="search-field" aria-label="Search the system">
      <span class="svg-icn search-field-icon">{{icon:search}}</span>
      <!-- type="text", not "search": role="combobox" already overrides the
           implicit role, the base input rules name both types in one selector
           list so the styling is identical, and the only live effect of the
           search type was Chrome's native clear swallowing the first Escape. -->
      <input type="text" class="search-input" id="search-page-input" name="q"
             role="combobox" aria-expanded="false" aria-controls="search-page-results"
             aria-autocomplete="list" autocomplete="off" autocapitalize="none"
             spellcheck="false" enterkeyhint="search"
             placeholder="Search the system"
             aria-label="Search the system">
    </search>
  </form>

  <!-- The Segmented control's flat form; search.js fills it with one
       aria-pressed button per result type the query found, plus All. -->
  <div class="search-filters segmented-control" role="group" aria-label="Filter results by type" hidden></div>

  <!-- In the DOM from first render and never display:none — a live region
       revealed at announce time is not reliably announced (cms/login.md). -->
  <p class="search-status text-size-s text-faded" aria-live="polite"></p>

  <!-- role="listbox" may own only options and groups. The listbox therefore
       takes result rows and nothing else; the panel beside it takes every
       other state — the idle content, the callouts, the loading skeleton.
       .search-results stays the scroll container and the styling hook.

       The id moves onto the listbox and keeps its value, so aria-controls is
       unchanged and still correct: it must name the popup element itself, and
       .search-results is a roleless wrapper. -->
  <div class="search-results">
    <div class="search-listbox" id="search-page-results" role="listbox" aria-label="Search results"></div>
    <div class="search-panel"></div>
  </div>

</div>
</div>
