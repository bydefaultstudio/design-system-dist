---
name: By Default
description: 'Neutral engine defaults for the By Default design system. Brand values arrive through each project''s theme.css, loaded after the framework CSS.'
colors:
  text-primary: '#1f1f1f'
  text-secondary: '#474747'
  text-faded: '#00000099'
  text-accent: '#2563EB'
  text-inverted: '#fafafa'
  background-primary: '#ffffff'
  background-secondary: '#e5e5e5'
  background-faded: '#0000000d'
  border-primary: '#1f1f1f'
  border-secondary: '#a3a3a3'
  border-faded: '#00000026'
  status-info: '#2563EB'
  status-success: '#16A34A'
  status-warning: '#78350F'
  status-danger: '#DC2626'
typography:
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: '3.5rem'
    fontWeight: 400
    lineHeight: 1
    letterSpacing: '-0.04em'
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: '2.5rem'
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: '-0.04em'
  subline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: '1.5rem'
    fontWeight: 300
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1
    letterSpacing: '0.06em'
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: '0em'
spacing:
  none: 0
  2xs: '0.125rem'
  xs: '0.25rem'
  s: '0.5rem'
  m: '0.75rem'
  l: '1rem'
  xl: '1.5rem'
  2xl: '2rem'
  3xl: '2.5rem'
  4xl: '3rem'
  5xl: '3.5rem'
  6xl: '4rem'
  7xl: '4.5rem'
  8xl: '5rem'
  9xl: '5.5rem'
  10xl: '6rem'
  11xl: '6.5rem'
  12xl: '7rem'
  13xl: '7.5rem'
  14xl: '10rem'
rounded:
  2xs: '2px'
  xs: '4px'
  s: '6px'
  m: '10px'
  l: '16px'
  xl: '24px'
  pill: '999px'
---

# By Default Design System

## Overview

This design system is a neutral engine: one framework CSS file (`design-system.css`) plus an icon sprite (`icons.svg`), shipping working defaults on real token names. Brand identity does not live in the engine. Each project loads its own `theme.css` after the framework and overrides the brand primitives there (typefaces, palette); the semantic token layer resolves through those primitives, so a theme never restates component CSS. The token values in this file's front matter are the neutral engine defaults, not a brand. Expect the project's `theme.css` to repaint them, and never edit brand values into the engine file: they are lost on the next upgrade.

Write HTML and CSS against the system's classes and tokens, never against raw values. A page written correctly needs no new CSS at all. Only write new CSS when the system genuinely cannot express the requirement.

## Colors

Colour tokens come in two layers: primitives (`--neutral-800`, `--green`, `--off-white`) and semantics (`--text-primary`, `--background-faded`, `--border-faded`). Only the semantic layer is API. Use `var(--text-primary)`, never `var(--neutral-800)`. If a primitive seems like the only way to get a colour, the semantic layer is missing a token; stop and flag it rather than reaching past it.

The semantic roles:

- **Text**: `--text-primary` ({colors.text-primary}) for headings and body, `--text-secondary` ({colors.text-secondary}) for supporting copy, `--text-faded` ({colors.text-faded}) for meta text (held at WCAG AA contrast), `--text-accent` ({colors.text-accent}) and its alias `--text-link` for links and accents, `--text-inverted` ({colors.text-inverted}) on dark fills.
- **Backgrounds**: `--background-primary` ({colors.background-primary}) is the page, `--background-secondary` ({colors.background-secondary}) for panels, `--background-faded` ({colors.background-faded}) for subtle fills and hover states.
- **Borders**: `--border-primary` ({colors.border-primary}), `--border-secondary` ({colors.border-secondary}) and `--border-faded` ({colors.border-faded}), in falling emphasis. Hairline dividers use `--border-faded`.
- **Status**: `--status-info` ({colors.status-info}), `--status-success` ({colors.status-success}), `--status-warning` ({colors.status-warning}), `--status-danger` ({colors.status-danger}), each with a `-bg` pair for filled treatments.

The dark mode contract: light is the default, always. Dark mode is opt-in by setting `data-theme="dark"` on a container (usually `<html>`, but any wrapper scopes it). Every semantic token re-resolves through the cascade, so components never carry their own dark CSS. This is exactly why values must never be hardcoded: the system holds two colour value sets, and writing either one into a rule (`#1a1a1a` or `#ffffff`) breaks the other theme. Always `background: var(--background-primary)`; never a hex value. If a design screenshot looks dark, ask which theme is intended; do not infer it.

## Typography

Four type roles compose the primitives into building blocks. Each role carries its own size, weight, leading and tracking tokens, and consuming code reads the role, never the raw scale:

- **Headline** (`--headline-size`, `--headline-weight`, `--headline-leading`, `--headline-tracking`): the biggest thing on a page, one per page, the `h1`.
- **Title** (`--title-size` and siblings): section heads and recurring in-page headings, the `h2`.
- **Label** (`--label-size` and siblings): eyebrows, captions, meta rows. Small, weighted, letter-spaced.
- **Body** (`--body-size` and siblings): running text.

Sizes are stepped rem values, never viewport-relative, so browser zoom and user font-size preferences keep working (WCAG 1.4.4). The heading roles step down automatically at 1439px and 959px inside the engine; never write your own breakpoint typography. Body copy holds {typography.body.fontSize} at every width.

Font families are role slots, not faces: `--font-primary` carries the interface, `--font-secondary` the editorial voice, `--font-code` monospace contexts. The engine ships neutral system stacks in these slots; the brand's licensed faces arrive through `theme.css`. Reference the slots, never a family name.

Text measure is capped with line-length tokens (`--line-length-body`, 55ch, and `--line-length-headline`, 22ch) rather than pixel widths.

## Layout

Every page section follows one hierarchy. Skipping a level is a bug:

```
section > .padding-global > .container-* > .block
```

- `<section>` owns macro vertical spacing via `.top-*` / `.bottom-*` classes.
- `.padding-global` owns horizontal padding. Never put padding on the section or the container.
- `.container-*` (`xs` to `xl`) owns width and centring. Nothing else.
- `.block` owns internal spacing via `.gap-*`, which maps to the spacing scale. Never put margins on its children.

The canonical skeleton:

```html
<section class="top-large bottom-large">
  <div class="padding-global">
    <div class="container-m">
      <div class="block gap-m">
        <h2>Heading</h2>
        <p>Body text</p>
      </div>
    </div>
  </div>
</section>
```

All spacing comes from the token scale in the front matter ({spacing.s}, {spacing.l}, {spacing.xl} and so on), consumed through the `.gap-*`, `.padding-*`, `.top-*` and `.bottom-*` utilities. No margins inside blocks, no spacer divs, no ad-hoc pixel gaps.

The complete utility vocabulary, generated from the CSS. These are the only legal names. The families deliberately use different suffix conventions (`.top-large` but `.gap-l`), so never guess a name that is not in these lists:

- **Block gaps**: `.gap-none`, `.gap-xs`, `.gap-s`, `.gap-m`, `.gap-l`, `.gap-xl`, `.gap-2xl`, `.gap-3xl`
- **Section spacing (top)**: `.top-small`, `.top-medium`, `.top-large`, `.top-xl`
- **Section spacing (bottom)**: `.bottom-small`, `.bottom-medium`, `.bottom-large`, `.bottom-xl`
- **Padding**: `.padding-global`, `.padding-s`, `.padding-m`, `.padding-l`, `.padding-xl`, `.padding-2xl`, `.padding-3xl`, `.padding-section`
- **Containers**: `.container-xs`, `.container-s`, `.container-m`, `.container-l`, `.container-xl`
- **Max-widths**: `.max-width-xs`, `.max-width-s`, `.max-width-m`, `.max-width-l`, `.max-width-xl`, `.max-width-full`
- **Text sizes**: `.text-size-xl`, `.text-size-l`, `.text-size-m`, `.text-size-s`, `.text-size-xs`
- **Borders**: `.border`, `.border-top`, `.border-bottom`, `.border-left`, `.border-right`, `.border-s`, `.border-m`, `.border-l`, `.border-solid`, `.border-dashed`, `.border-dotted`, `.border-primary`, `.border-secondary`, `.border-faded`

## Shapes

Corner radius comes from a seven-step token scale, `--radius-2xs` ({rounded.2xs}) through `--radius-xl` ({rounded.xl}), plus `--radius-pill` ({rounded.pill}) for fully rounded chips and pills. Interactive surfaces (buttons, inputs) sit in the middle of the scale; cards and dialogs sit higher. Never hardcode a radius.

## Components

Use existing components and utilities first: `.button`, `.card`, `.callout`, `.badge`, the disclosure/accordion, tabs, dialog, dropdown, form controls. New CSS is the last resort, only when the system cannot express the requirement.

Conventions shared by every component:

- Base class is `.component-name`. Variation rides on `data-*` attributes (`data-variant`, `data-size`, `data-color`), state on shared `.is-*` classes (`.is-active`, `.is-open`, `.is-selected`, `.is-disabled`, `.is-loading`, `.is-error`). Never invent a new naming pattern.
- The bare `<button>` element is a minimal reset only. Styled buttons always take `class="button"`.
- `<button>` for actions, `<a href>` for navigation. Never the reverse, never `<div onclick>`. Icon-only buttons need an `aria-label`.
- Icons come from the shipped sprite only, always inside the wrapper. Never a bare `<svg>`, never an external icon library. Valid `data-icon` names are the `<symbol>` ids in the shipped `icons.svg`; list them from that file rather than guessing:

```html
<div class="svg-icn" data-icon="arrow-right">
  <svg fill="none" width="100%" height="100%" aria-hidden="true">
    <use href="/assets/icons/icons.svg#arrow-right"></use>
  </svg>
</div>
```

- Motion reads the semantic motion tokens (`--motion-*`), which compose the easing and duration primitives (`--ease-out`, `--duration-s`). Never hardcode a duration or easing in a transition or animation.

Button variation accepts only these values, generated from the CSS; omitting an attribute gives the default solid button:

- `data-variant`: `outline` | `faded` | `outline-faded` | `transparent` | `text`
- `data-size`: `small` | `xsmall`
- `data-icon-only` (boolean flag)
- `data-full-width` (boolean flag)
- `data-color`: `danger` | `red` | `success` | `green`
- `data-tooltip`: free text (the value is displayed)

The semantic motion token set:

`--motion-page-open-duration`, `--motion-page-open-easing`, `--motion-page-close-duration`, `--motion-page-close-easing`, `--motion-page-swap-duration`, `--motion-page-swap-easing`, `--motion-page-fade-duration`, `--motion-page-fade-easing`

## Do's and Don'ts

Do:

- Follow the layout hierarchy on every section, top to bottom.
- Use semantic tokens for every visual value: colour, spacing, type, borders, radii, motion.
- Reach for an existing component or utility before writing CSS.
- Keep brand values in `theme.css`; treat the engine CSS as read-only.

Don't:

- Apply dark mode by default, or infer a theme from a screenshot.
- Hardcode hex, pixel, duration or font values that should come from tokens.
- Use primitive colour tokens (`--green`, `--neutral-800`, `--off-white`) in page or component code.
- Use inline styles.
- Use external icon libraries (Font Awesome, Material, Heroicons); brand sprite icons only.
- Add margins inside blocks, spacing on containers or sections, or spacer divs.
- Invent class naming patterns or write component-level dark mode CSS.

---

The values above are the engine's neutral defaults; the loaded `theme.css` defines the real brand. The full component-by-component reference, including every token table, component doc and utility class, ships with this package as `llms-full.txt` in the same `dist/` folder as this file, and it matches the installed version exactly. Read it whenever you need detail beyond these rules; this file is the persistent contract. The reference for the latest release also lives at https://bydefault.design/llms-full.txt.
