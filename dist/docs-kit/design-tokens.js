/**
 * design-tokens.js — read the design system's tokens and classes from its CSS.
 *
 * Walks design-system.css line by line, tracking the numbered section banner so
 * every name carries the section it was declared under. Two banner styles are
 * in use and both must match: the single-line
 * `/* ------ 36. DROP CAP ------ *\/` and the docblock opener
 * `/* ------ 37. BOOK ------` whose closer is many lines below. Requiring the
 * closer on the same line silently mislabels everything after the first
 * docblock banner, so `assertBannersMatched` fails the build if any line that
 * opens like a banner did not parse as one.
 *
 * Every custom-property declaration counts as a token — :root system tokens and
 * component-scoped ones alike (`.dialog { --dialog-max-width: … }`), since both
 * are documented, and declarations sharing a line with their selector
 * (`[data-color="blue"] { --color-tint: …; --color-base: …; }`) count too. The
 * first declaration wins: dark-mode and state blocks redefine the same names
 * further down and are not the default.
 *
 * Class names are collected from the whole selector, not just its first token,
 * so documented state classes (`.is-active`) and element-qualified components
 * (`progress.progress-bar`) are not lost.
 *
 * The label a symbol carries is the nearest sub-heading, falling back to the
 * section banner. Both are maintainer comments, and the two are cleaned
 * differently because they are written differently — see `cleanBanner` and
 * `cleanSubsection`. A sub-heading that does not read as a name is rejected
 * rather than shipped: search results were reading "State: copied" and
 * "Structure", which are notes to whoever edits the stylesheet next.
 *
 * Consumers: tools/build-search.js (the symbol index). ROADMAP wants
 * cms/tokens.md generated from the same data rather than hand-maintained; this
 * module is where that generator would start.
 */

'use strict';

// Leading section numbering: `2.`, `2b.`, `39B.`. Both banner and sub-heading
// strip it — the reader of a search result has no use for the maintainer's
// ordering. The letter suffix is case-insensitive because `39B.` exists and an
// `[a-z]`-only class silently left it in the label.
const NUMBERING_RE = /^[0-9]+[a-zA-Z]?\.\s*/;

// A banner line opens with a comment and a run of dashes; the closer is
// optional because half of them sit at the end of a docblock.
const BANNER_OPEN_RE = /^\/\* -{3,}/;
const BANNER_RE = /^\/\* -{3,}\s*(.+?)\s*(?:-{3,}\s*\*\/)?$/;
// The finer label inside a section: `/* -- Text color utilities -- */`. A
// section banner is often too coarse to describe what sits under it — section
// 10 is "Background utilities" and `.text-primary` lives in it under exactly
// this sub-heading. generate-llms-txt.js reads the same convention for tokens.
const SUBSECTION_RE = /^\/\*\s*-{2,}\s*(.+?)\s*-{2,}\s*\*\/$/;
// The terminator is a lookahead: consuming it would eat the `;` that the next
// declaration on the same line needs as its own opening delimiter.
const DECL_RE = /(?:^|[{;])\s*(--[a-z0-9-]+)\s*:\s*([^;}]+?)\s*(?=[;}])/g;
const CLASS_RE = /\.([a-z][a-z0-9-]*)/g;

// A trailing parenthetical annotates the sub-heading for a maintainer and is
// noise in a result row: `Base font sizes (rem-based, progressive step scale:
// +2px body…)` is a good label with it removed and unreadable with it kept.
const TRAILING_PAREN_RE = /\s*\([^()]*\)\s*$/;
// The same annotation written with a spaced dash instead of brackets: `Solid
// colour backgrounds — for hero blocks, callouts, ad units, etc.`. Em and en
// only, and only when spaced, so a hyphenated name (`Color-mix`, `Safe-area`)
// is never cut in half.
const TRAILING_DASH_NOTE_RE = /\s+[—–]\s+.*$/;
// Three sub-headings are written in Title Case where the rest of the file is
// sentence case. Casing is otherwise left alone — lowercasing wholesale is what
// turned `(CUBE pattern)` into `(cube pattern)` and would flatten `L0` — so
// this fires only on the Title Case shape: a plainly capitalised word somewhere
// after the first. `[A-Z][a-z]+` cannot match an all-caps acronym or a token
// carrying a digit, so `CUBE` and `L0` are never touched by the replacement
// even when it does fire.
const TITLE_CASE_WORD_RE = /\b[A-Z][a-z]+\b/g;
// A structural word that is true of half the stylesheet: on its own it names
// the kind of rule, not the thing the rule is for, and the section banner says
// more. End-anchored — `Layout modifiers` and `Size exceptions` do name their
// subject and are better labels than the banner they would fall back to.
//
// `States` is deliberately absent, and the reason is a fault in the stylesheet
// rather than in this rule. The button block has no banner of its own (it sits
// under `9. TYPOGRAPHY UTILITIES`), so rejecting the `/* -- States -- */` above
// `.is-disabled` and `.is-loading` labels them "Typography utilities" — which
// is wrong, where "States" is merely vague. Vague beats wrong. Give the button
// block a banner and `States` can join the set.
const STRUCTURAL_OPENER_RE = /^(?:Variants?|Structure|Modifiers?|Size|Layout)$/i;
// `State: copied`, `Table modifier: full width`. At most two plain words before
// the colon, so a descriptive heading that happens to contain one further along
// — `…progressive step scale: +2px body` — is not caught by it.
const LABELLED_PREFIX_RE = /^[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)?:\s/;
// A mid-string sentence break means prose, not a label.
const SENTENCE_RE = /\.\s+\S/;
const MAX_LABEL_WORDS = 6;

// Section banners are written in caps by convention, so they are lowercased and
// sentence-cased. The spaced hyphen in `SYSTEM TOKENS - COLORS` stays a hyphen:
// substituting an em dash dressed a maintainer's separator up as product copy.
function cleanBanner(text) {
  const lower = text.replace(/\s*-+\s*$/, '').replace(NUMBERING_RE, '').trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Clean a sub-heading, or reject it.
 *
 * Sub-headings are written in sentence case for a maintainer reading the
 * stylesheet, and only some of them read as a label in a search result. Casing
 * is left alone — lowercasing these the way banners are lowercased flattened
 * `Book cover (L0 tile)` and every CUBE attribute and acronym with it.
 *
 * Three shapes are rejected, and the caller falls back to the section banner:
 * a bare structural word (`Structure`, `States`), a short labelled prefix
 * (`State: copied` — which shipped as the entire label for `.is-copied`, with
 * nothing saying "copy button"), and prose too long or too sentence-shaped to
 * be a name.
 *
 * @param {string} text  the captured sub-heading
 * @returns {string}  the label, or '' to fall back to the banner
 */
function cleanSubsection(text) {
  // Dash note before parenthetical: both are anchored to the end, so a heading
  // carrying an annotation of each — `Book cover (L0 tile) — the shelf too` —
  // only loses the parenthetical if the note is stripped first.
  let stripped = text
    .replace(/\s*-+\s*$/, '')
    .replace(NUMBERING_RE, '')
    .replace(TRAILING_DASH_NOTE_RE, '')
    .replace(TRAILING_PAREN_RE, '')
    .trim();
  if (!stripped) return '';
  if (STRUCTURAL_OPENER_RE.test(stripped)) return '';
  if (LABELLED_PREFIX_RE.test(stripped)) return '';
  if (SENTENCE_RE.test(stripped)) return '';
  if (stripped.split(/\s+/).length > MAX_LABEL_WORDS) return '';

  TITLE_CASE_WORD_RE.lastIndex = 0;
  let capital;
  let titleCase = false;
  while ((capital = TITLE_CASE_WORD_RE.exec(stripped)) !== null) {
    if (capital.index > 0) { titleCase = true; break; }
  }
  if (titleCase) stripped = stripped.replace(TITLE_CASE_WORD_RE, (w) => w.toLowerCase());

  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * @param {string} css  the stylesheet text
 * @returns {{ tokens: Array<{n: string, v: string, d: string}>, classes: Array<{n: string, d: string}>,
 *            bannerLines: number, bannersMatched: number, unmatchedBanners: string[] }}
 *   n = name (`--x` or `.x`), v = declared value, d = section banner it sits under
 */
function extractTokensAndClasses(css) {
  const tokens = new Map();
  const classes = new Map();
  const unmatchedBanners = [];
  let banner = '';
  let subsection = '';
  let bannerLines = 0;
  let bannersMatched = 0;

  css.split('\n').forEach((raw, i) => {
    const line = raw.trim();

    if (BANNER_OPEN_RE.test(line)) {
      bannerLines += 1;
      const b = line.match(BANNER_RE);
      if (b && b[1]) {
        bannersMatched += 1;
        banner = cleanBanner(b[1]);
        subsection = '';
      } else {
        unmatchedBanners.push(`${i + 1}: ${line}`);
      }
      return;
    }

    // A rejected sub-heading clears the previous one rather than leaving it
    // standing: symbols under an unlabellable heading belong to the section,
    // not to whatever heading happened to come before it.
    const sub = line.match(SUBSECTION_RE);
    if (sub && sub[1]) {
      subsection = cleanSubsection(sub[1]);
      return;
    }

    // Declarations first: a line can carry both a selector and its properties.
    let m;
    DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(line)) !== null) {
      if (!tokens.has(m[1])) tokens.set(m[1], { n: m[1], v: m[2].trim(), d: subsection || banner });
    }

    // Selector lines only — the part before `{`, so a class named inside a
    // declaration value (a url, a content string) is not mistaken for a rule.
    // No need to exclude custom properties here: they start with `--`, which
    // CLASS_RE cannot match. Excluding lines containing `--` would drop the
    // BEM-style rules the system still has (`.card--flush`, `.divider--vertical`).
    const brace = line.indexOf('{');
    const selector = brace === -1 ? (line.endsWith(',') ? line : '') : line.slice(0, brace);
    if (!selector) return;
    CLASS_RE.lastIndex = 0;
    while ((m = CLASS_RE.exec(selector)) !== null) {
      if (!classes.has(m[1])) classes.set(m[1], { n: '.' + m[1], d: subsection || banner });
    }
  });

  return {
    tokens: [...tokens.values()],
    classes: [...classes.values()],
    bannerLines,
    bannersMatched,
    unmatchedBanners,
  };
}

/**
 * Fail loudly when the banner format drifts. A banner that stops matching does
 * not error on its own — it silently hands its section label to every symbol
 * below it, which is how 236 of 891 symbols came to be labelled "Drop cap".
 * @param {ReturnType<typeof extractTokensAndClasses>} result
 * @param {string} label  the file, for the message
 */
function assertBannersMatched(result, label) {
  if (!result.unmatchedBanners.length) return;
  throw new Error(
    `${label}: ${result.unmatchedBanners.length} of ${result.bannerLines} section banners did not parse, ` +
    `so every token and class below them inherits the wrong section:\n  ` +
    result.unmatchedBanners.join('\n  ')
  );
}

module.exports = { extractTokensAndClasses, assertBannersMatched };
