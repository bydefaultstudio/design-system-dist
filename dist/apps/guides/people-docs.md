---
title: "People"
subtitle: "Who can sign in, what they are, and what a guest's groups open"
description: "How access works in {{brand:siteName}}: the four roles on people, the four levels on pages, groups for guests, demo accounts, expiry, and the People page that manages all of it."
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

On [People](people.html), an admin decides who signs in and what each person opens, from a desk, or from a phone in the middle of a call. Three words carry it, each used once: a **level** is on a page, a **role** is on a person, and a **group** is the bundle of pages a guest belongs to.

The tool opens from the button above, from **People** in the Settings sidebar, and from **People** in the account menu (your avatar, top right), which an admin or owner sees on every page.

---

## Every page is a team page until it says otherwise

Every page declares one in its frontmatter, as `access:`. The build compiles them into a map the Worker reads; nothing is decided at request time by reading a page.

| Level | Who opens it |
|---|---|
| `public` | Anyone, signed in or not. The front door and the demo surface |
| `team` | Everyone signed in as team, admin or owner, and a guest whose groups grant it. **The default** - a page that says nothing is a team page |
| `admin` | Admins and owners. This page and People |
| `owner` | Owners only. Setup, Brand Setup and Folder Structure: the pages that run the engine and the deployment, closed to a client's own admin |

A missing field takes its section's default, when the deployment sets one (`sectionAccess` in `docs.config.js`, keyed by output folder, for example `{ social: 'admin' }`), and is `team` otherwise. A page's own field always wins. A value that is not one of the four fails the build, and every level that came from a section default is listed at the end of the build, so a default that opens a section is never silent. The section's contents page takes the same default, so an admin section's index is closed to the team like its pages; a public section's index still needs a sign-in. Search never carries a page above team, nor the card for one on a page it does carry, such as a team index listing an admin page.

---

## One role per person

Each person has exactly one. It is set when they are added and can be changed from their row.

| Role | What it opens | What it can do |
|---|---|---|
| **Owner** | Everything | Manage everyone, admins and other owners included |
| **Admin** | Everything but owner pages | Manage team members, guests, other admins and groups. Sees an owner's row, read only |
| **Team** | Every public and team page | Read |
| **Guest** | Public pages, the home and section indexes, and whatever their groups grant | Read |

The same word names the page and the reader who may open it: a team page is for the team. Public has no role, because it is the signed-out reader, and guest has no level, because guests are defined by their groups.

An owner is the studio that runs the deployment, never a client or a member of their team. The owner named in the deployment's config is an owner whatever their row says, and the row is set to match the next time they sign in. A deployment cannot refuse the person who runs it, and the first owner needs no SQL to become one. Set `ACCESS_OWNER` on every deployment: without it nobody can become an owner, because only an owner makes one, and the owner pages stay shut to everyone. Changing it later leaves the previous owner an owner on the list; demote them on this page if that is not meant. The owner's own row never carries an end date or the demo switch.

---

## Guests see the locks; nobody sees the pages above their role

| | Public page | Team page | Admin page | Owner page | Home and section indexes | People |
|---|---|---|---|---|---|---|
| Signed out | Open | Sign-in page | Sign-in page | Sign-in page | Sign-in page | Sign-in page |
| Guest | Open | **Granted: open. Otherwise locked** | Locked | Locked | Open, cards locked by grant | Locked |
| Team | Open | Open | **Hidden** | **Hidden** | Open | Hidden |
| Admin | Open | Open | Open | **Hidden** | Open | Open |
| Owner | Open | Open | Open | Open | Open | Open |

*Locked* means visible with a lock and a reason, and the locked page if reached by its address. *Hidden* means absent from the sidebar, the cards and search, and the locked page if reached. A guest sees team pages locked rather than hidden because a prospect looking at the Tools should see that the system is bigger than the Tools. A team member does not see admin pages because they are operational documents, and noise; an admin does not see owner pages for the same reason. Admin and owner pages are also left out of search, because the search index is one file every team reader can fetch.

A deployment can hide instead of lock (`accessNav: 'hidden'` in `docs.config.js`). Then a reader never meets a page they cannot open: the server takes it out of the sidebar, the section indexes, the next and previous links, the links in page text and the locked page before the page leaves, so its title never reaches them at all. A page whose own text links to a page above its level fails the build under hidden, with the links listed: a reader who may open the page could never open the link. A signed-out visitor sees the public pages only. A demo deployment locks, because the locks show a prospect that the system is bigger than what they can open; a client's hub hides, because a client's own people should see their pages and nothing else. Hiding needs the deployment's Worker to do the cut; the docs kit alone only moves the list into each page.

---

A tool's downloads can sit a level above its page (`downloadAccess:` in the tool's frontmatter). Below that level the Download verb is locked, not hidden: the lock takes the download icon's place, the tooltip says why, and a press goes to the login, or for a guest to the support form.

## Groups decide what a guest opens

A guest has no pages of their own. They belong to zero or more groups, and the groups hold the grants: whole sections, or single pages. Grants are additive. If a demo should see the Tools except one, the group names the tools wanted rather than the section - there is no "except". A group can never grant an admin or an owner page.

A new site starts with no groups. [Groups](groups.html) walks through making one, and [Inviting people](inviting-people.html) through adding the guests; [Signing in](signing-in.html) is the page to send a team member who cannot get in on a new device.

---

## Adding someone sends their invite

**Add people** takes one address or several, the role, the groups when the role is guest, an optional end date and a note. Each address gets an email saying they have access and which address to sign in with; until they do, their row says *Invited*, and **Resend invite** is in their row's Edit dialog.

**Access ends** switches a person off on the day you pick: after it they are refused like someone removed, and their row says *Expired*. A client demo that ends on the 14th is open on the 14th. Leave it empty for no end.

**Demo account** is for walking the system in a call. No email is sent, and any six digits sign it in. Anyone who knows the address can sign in as it, so a demo account is a team member or a guest, never an admin or an owner, and it is set when the person is added, never switched on later. Make one for a demo and remove it after, or give it an end date when you make it. Unticking Demo in Edit ends it and signs out everyone using it.

---

## Every change lands within five minutes

Everything a row carries is in its **Edit** dialog: role, groups, end date, demo, note. A promotion takes effect within five minutes - the session cookie is trusted for that long before it is re-read, the same tail as revocation. A demotion signs the person out now; they sign in again with the new role. Nobody changes their own role: another admin or an owner does. Only an owner makes someone an owner.

**Locked out** on a row means the address had ten wrong sign-in codes in the last day, and sign-in is refused for it until the day moves on; sessions it already holds stand. **Lift lockout** in its Edit dialog clears the count and any code it was sent, so the person can ask for a new one at once. An admin cannot lift an owner.

**Remove** takes the person off the list and ends every session they hold. A browser they are already signed in on keeps working for up to five minutes, until the session cookie is next re-read, the same tail as a promotion; after that every page sends them to sign in. They can be added again later. The last owner cannot be removed or demoted, nor can the last person who manages the list; the owner named in the deployment's config cannot be removed at all. An admin cannot edit, remove or resend for an owner.

---

## One table admits everyone

The list is the `allowed_email` table in the deployment's D1 database: the row admits a person, says what they are, how long for, and whether they are a demo account. Groups are three small tables beside it. A person's role is copied onto their user record at every sign-in and re-read from the list at every cookie rebuild, so the two cannot drift for longer than five minutes. The People page is the only thing that writes any of it.
