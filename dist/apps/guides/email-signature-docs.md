---
title: "Email Signature"
subtitle: "Build a consistent {{brand:organisation}} email signature"
description: "Enter your details, toggle the links you want, and copy a ready-to-paste {{brand:organisation}} email signature for Gmail, Outlook, or Apple Mail."
author: "Studio"
section: "Tools"
layer: "app"
subsection: ""
order: 13
status: "published"
access: "team"
brand: "internal"
actionUrl: "./email-signature.html"
actionLabel: "Open Tool"
---

Enter your name, role, and email, switch on the links you want, and copy a consistent {{brand:organisation}} signature straight into your mail client. The output is plain HTML tables with inline styles, the only format email clients render reliably. The channel standards this tool bakes in live on the [Email Signature channel page](/formats/email-signature.html).

---

## How It Works

1. Fill in **Name**, **Role**, and **Email** in the Details section. These always appear.
2. In the Links section, switch **Website**, **LinkedIn**, and **Instagram** on or off; each one's field sits under its switch. Website is on by default; LinkedIn and Instagram are off until you need them. The section's reset puts the switches back without touching what you typed.
3. Switch the **confidentiality disclaimer** on or off.
4. Check the preview, pick the format in **Export**, then copy from the foot of the panel. **Reset all** in the ⋯ menu clears every field.

---

## Copying It In

The format in Export decides what the copy button gives you, and the preview shows whichever is chosen.

- As **Signature**, **Copy signature** writes the rendered signature to the clipboard. Paste it into Gmail's signature box (Settings → See all settings → Signature) or Apple Mail and the formatting comes with it.
- As **HTML**, **Copy HTML** copies the raw source, which the preview shows. Use this for Outlook, which installs signatures from an HTML file rather than a paste.

After pasting, send yourself a test email and confirm the logo and icons load. If images are blocked, choose "Display images" so recipients see the full signature.

---

## Why Tables and Inline Styles

Email clients strip `<style>` blocks and ignore modern CSS layout. The signature is built from `<table>` elements with every style inline so it renders the same in Gmail, Outlook (Word engine), and Apple Mail.

---

## Image Hosting

Mail clients fetch signature images over the public internet each time the email is opened, so every image is an absolute HTTPS URL on this site's own domain. The logo and icons are hosted here and referenced directly. There is nothing to upload per person.

---

## Notes

- The signature card is fixed to the {{brand:name}} brand. Only the personal fields and link switches change.
- `border-radius` is ignored by Outlook, so the card renders with square corners there. This is expected and acceptable.
- Keep the role short; long roles wrap and unbalance the card.
