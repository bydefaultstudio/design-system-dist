---
title: "People"
subtitle: "Who can sign in, what they are, and what a guest's groups open"
description: "How access works in {{brand:siteName}}: the five roles on people, the five levels on pages, internal and external groups, demo accounts, expiry, and the People page that manages all of it."
author: "Studio"
section: "Settings"
layer: "app"
order: 11
status: "published"
access: "admin"
brand: "internal"
actionUrl: "./people.html"
actionLabel: "Open Tool"
---

On [People](people.html), an admin decides who signs in and what each person opens, from a desk, or from a phone in the middle of a call. Three words carry it, each used once: a **level** is on a page, a **role** is on a person, and a **group** is a bundle of extra pages a person belongs to.

The tool opens from the button above, from **People** in the Settings sidebar, and from **People** in the account menu (your avatar, top right), which an admin or owner sees on every page.

---

## Every page is a team page until it says otherwise

Every page declares one in its frontmatter, as `access:`. The build compiles them into a map the Worker reads; nothing is decided at request time by reading a page.

| Level | Who opens it |
|---|---|
| `public` | Anyone, signed in or not. The front door and the demo surface |
| `community` | {{brand:communityLabel}} members, the team, admins and owners, and a guest whose external groups grant it. What the community signs in for |
| `team` | The team, admins and owners. Internal: no external group opens one. **The default** - a page that says nothing is a team page |
| `admin` | Admins and owners. This page and People |
| `owner` | Owners only. Setup, Brand Setup and Folder Structure: the pages that run the engine and the deployment, closed to a client's own admin |

A missing field takes its section's default, when the deployment sets one (`sectionAccess` in `docs.config.js`, keyed by output folder, for example `{ social: 'admin' }`), and is `team` otherwise. A page's own field always wins. A value that is not one of the five fails the build, and every level that came from a section default is listed at the end of the build, so a default that opens a section is never silent. The section's contents page takes the same default, so an admin section's index is closed to the team like its pages; a public section's index still needs a sign-in. Search never carries a page above team, nor the card for one on a page it does carry, such as a team index listing an admin page.

---

## One role per person

Each person has exactly one. It is set when they are added and can be changed from their row.

| Role | What it opens | What it can do |
|---|---|---|
| **Owner** | Everything | Manage everyone, admins and other owners included |
| **Admin** | Everything but owner pages | Manage team members, guests, other admins and groups. Sees an owner's row, read only |
| **Team** | Every public, community and team page, and the admin pages their internal groups grant | Read |
| **{{brand:communityLabel}}** | Public and community pages, the home and section indexes. **The default for a new person**, unless the deployment sets another | Read |
| **Guest** | Public pages, the home and section indexes, and the {{brand:communityLabel}} pages their external groups grant | Read |

The same word names the page and the reader who may open it: a team page is for the team, a community page for the community. The community role's name is the deployment's own (`access.communityLabel` in `brand.json`, "Community" when left out); the stored value is always `community`. A community member may join external groups, which add nothing yet since they already open every community page, and search is closed to them, as to a guest, while the search index holds team pages. Under `accessNav: 'earned'` they have a search index of their own, public and {{brand:communityLabel}} pages only, so search opens for them. Public has no role, because it is the signed-out reader, and guest has no level, because guests are defined by their groups.

The Add person form starts on the role `access.defaultRole` names in `brand.json`: community, team or guest, community when left out. On this site it starts on {{brand:defaultRole}}. A deployment whose people are mostly its own team sets team. Admin and owner are refused as defaults, and a request that names no role is still stored as community, the outside role, so a slip never opens team pages.

An owner is the studio that runs the deployment, never a client or a member of their team. The owner named in the deployment's config is an owner whatever their row says, and the row is set to match the next time they sign in. A deployment cannot refuse the person who runs it, and the first owner needs no SQL to become one. Set `ACCESS_OWNER` on every deployment: without it nobody can become an owner, because only an owner makes one, and the owner pages stay shut to everyone. Changing it later leaves the previous owner an owner on the list; demote them on this page if that is not meant. The owner's own row never carries an end date or the demo switch.

---

## Lock what a reader could earn; hide what is internal

This is `accessNav: 'earned'`, the mode this site runs (community-access-plan.md D11):

| | Public page | Community page | Team page | Admin page | Owner page | Home and section indexes | People |
|---|---|---|---|---|---|---|---|
| Signed out | Open | **Locked: a click goes to sign in** | Hidden | Hidden | Hidden | Sign-in page | Hidden |
| Guest | Open | **Granted: open. Otherwise locked, with Ask for access** | Hidden | Hidden | Hidden | Open, internal cards cut | Hidden |
| {{brand:communityLabel}} | Open | Open | **Hidden** | Hidden | Hidden | Open, internal cards cut | Hidden |
| Team | Open | Open | Open | **Granted by an internal group: open. Otherwise hidden** | Hidden | Open | Hidden |
| Admin | Open | Open | Open | Open | **Hidden** | Open | Open |
| Owner | Open | Open | Open | Open | Open | Open | Open |

A section with no page a reader can see, open or locked, leaves their sidebar and their home page, and its contents page is hidden with it. Reached by its address, a hidden page answers exactly as a page that does not exist: the not-found page, with 404, so an address cannot be used to learn whether an internal page is there. A locked community page tells a signed-out reader to sign in to read it (the address sends them to sign in), and a guest to ask for access (the locked page, with 403).

The engine's other two modes, for other deployments:

- **`'locked'`**, the engine's default: every reader sees every title, and anything they cannot open is locked. A guest sees team pages locked, a {{brand:communityLabel}} member team pages locked and admin and owner pages hidden.
- **`'hidden'`**: a reader sees only what they can open.

*Locked* means visible with a lock and a reason, and the locked page if reached by its address. *Hidden* means absent from the sidebar, the cards and search, and the locked page if reached. A guest sees team pages locked rather than hidden because a prospect looking at the Tools should see that the system is bigger than the Tools. A team member does not see admin pages because they are operational documents, and noise; an admin does not see owner pages for the same reason. Admin and owner pages are also left out of search, because the search index is one file every team reader can fetch.

Under `'locked'`, a deployment can hide instead of lock (`accessNav: 'hidden'` in `docs.config.js`). Then a reader never meets a page they cannot open: the server takes it out of the sidebar, the section indexes, the next and previous links, the links in page text and the locked page before the page leaves, so its title never reaches them at all. A page whose own text links to a page above its level fails the build under hidden, with the links listed: a reader who may open the page could never open the link. A signed-out visitor sees the public pages only. A demo deployment locks, because the locks show a prospect that the system is bigger than what they can open; a client's hub hides, because a client's own people should see their pages and nothing else. Hiding needs the deployment's Worker to do the cut; the docs kit alone only moves the list into each page. `'earned'` cuts the same way but keeps community pages, locked, for a reader who could earn them: a body link from a page to a team, admin or owner page fails its build, while one to a community page passes, because every reader of the page sees that one at least locked.

---

A tool's downloads can sit a level above its page (`downloadAccess:` in the tool's frontmatter), and an Asset Library file can set its own level in the catalog (`access`). A tool can also give each of its assets a level (`assetAccess:`). Below that level the Download verb, and the Copy that exports the same file, are locked, not hidden: the lock takes the download icon's place, the tooltip says why, and a press opens the lock's dialog, "Make this tool your own", with Book a walkthrough and the reader's own way in.

## Groups decide what a guest opens

A guest has no pages of their own. They belong to zero or more groups, and the groups hold the grants: whole sections, or single pages. Grants are additive. If a demo should see the Tools except one, the group names the tools wanted rather than the section - there is no "except".

A group is **external** or **internal**, chosen when it is made and fixed after. An external group is for guests and {{brand:communityLabel}} members and opens public and {{brand:communityLabel}} pages only, so a team page stays internal whatever an outsider's groups say. An internal group is for team members and admins only, and is how one team member opens an admin page without being made an admin. The role is read again at every request, so a person moved out of the team loses an internal group's pages at once. No group ever grants an owner page.

A new site starts with no groups. [Groups](groups.html) walks through making one, and [Inviting people](inviting-people.html) through adding the guests; [Signing in](signing-in.html) is the page to send a team member who cannot get in on a new device.

---

## Adding someone sends their invite

**Add people** takes one address or several, the role, the groups of that role's kind, an optional end date and a note. Each address gets an email saying they have access and which address to sign in with; until they do, their row says *Invited*, and **Resend invite** is in their row's Edit dialog.

**Access ends** switches a person off on the day you pick: after it they are refused like someone removed, and their row says *Expired*. A client demo that ends on the 14th is open on the 14th. Leave it empty for no end.

**Demo account** is for walking the system in a call. No email is sent, and any six digits sign it in. Anyone who knows the address can sign in as it, so a demo account is a team member, a community member or a guest, never an admin or an owner, and it is set when the person is added, never switched on later. Make one for a demo and remove it after, or give it an end date when you make it. Unticking Demo in Edit ends it and signs out everyone using it.

---

## Every change lands within five minutes

Everything a row carries is in its **Edit** dialog: role, groups, end date, demo, note. A promotion takes effect within five minutes - the session cookie is trusted for that long before it is re-read, the same tail as revocation. A demotion signs the person out now; they sign in again with the new role. Nobody changes their own role: another admin or an owner does. Only an owner makes someone an owner.

**Locked out** on a row means the address had ten wrong sign-in codes in the last day, and sign-in is refused for it until the day moves on; sessions it already holds stand. **Lift lockout** in its Edit dialog clears the count and any code it was sent, so the person can ask for a new one at once. An admin cannot lift an owner.

**Remove** takes the person off the list and ends every session they hold. A browser they are already signed in on keeps working for up to five minutes, until the session cookie is next re-read, the same tail as a promotion; after that every page sends them to sign in. They can be added again later. The last owner cannot be removed or demoted, nor can the last person who manages the list; the owner named in the deployment's config cannot be removed at all. An admin cannot edit, remove or resend for an owner.

---

## Page levels decide who opens what

**Page levels**, under the groups, lists every section and its pages with the level each one opens at: Public, Team, Admin or Owner. A section's level is a floor: every page in it opens at that level or higher, and a page already above it stays where it is. A page's own setting beats its section's. **Back to code** and **Back to section** remove a setting, so the target opens at the level its source declares again. Settings is never in the list. A section the deployment protects (`protectedSections` in `docs.config.js`) carries a floor: no page in it can be set below that level: a private Internal set to team can go to team, still internal, but never to community or public.

A change goes through three steps, and nobody's access moves until the last:

1. **Staged.** Picking a level stages it. Only you see it, marked **Staged**, and **Undo** takes it back. **Discard** drops every change you have staged.
2. **Applied.** **Review and apply** lists each change with who can open the page afterwards. Applying it asks for a build of the site; the change shows **Waits for build** until that build is live.
3. **Live.** The build bakes the new level into the page, the sidebar and search at once, so they never disagree. Everyone keeps their current access until then.

When the site has a build trigger set up, the notice above the sections says when the build was asked for, and **Try again** asks for another if one did not finish. Without a trigger, applied changes go live at the next deploy. A page that has to close at once is a code change for a developer, not a Settings change.

If someone else changed the same page after you staged yours, applying stops and says so, and nothing is overwritten: stage it again from what the list shows now.

An admin changes levels between Public, Team and Admin. An admin never sets Owner, never changes a page that is or will be at Owner, and never lowers or resets a section that holds an owner page; an owner page shows only as a count. Only the pages of the listed sections can change: the sign-in, Ask for access and locked pages, the home page, search and everything under Settings are fixed.

---

## One table admits everyone

The list is the `allowed_email` table in the deployment's D1 database: the row admits a person, says what they are, how long for, and whether they are a demo account. Groups are three small tables beside it. A person's role is copied onto their user record at every sign-in and re-read from the list at every cookie rebuild, so the two cannot drift for longer than five minutes. The People page is the only thing that writes any of it.
