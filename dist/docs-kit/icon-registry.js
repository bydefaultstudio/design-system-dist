/**
 * icon-registry.js — one way to find the icon registry in iconography.md.
 *
 * The "## Registry" section is the one place the icon set is grouped and
 * named. Three readers need it: the docs generator (the Icon Library's
 * categories), tools/generate-llms-txt.js (which trims its tables) and
 * scripts/verify-spec.js (which checks the spec and the page agree). Each used
 * to search for the heading itself, so renaming it in one would have left the
 * others finding nothing, quietly. Same argument as portable.js: one rule,
 * several consumers.
 *
 * The search does not skip code fences, so keep "## " headings out of fenced
 * examples above or inside the section.
 */

'use strict';

const HEADING = /^## Registry[ \t]*$/m;

/**
 * Where the Registry section sits in a markdown string.
 * @param {string} markdown
 * @returns {{ heading: number, start: number, end: number } | null}
 *   heading: index of the "## Registry" line; start: first character after
 *   that line; end: start of the next "## " heading, or the string's length.
 *   null when there is no Registry heading.
 */
function registryBounds(markdown) {
  const match = HEADING.exec(markdown);
  if (!match) return null;
  const lineEnd = markdown.indexOf('\n', match.index);
  const start = lineEnd === -1 ? markdown.length : lineEnd + 1;
  const next = markdown.slice(start).search(/^## /m);
  return { heading: match.index, start, end: next === -1 ? markdown.length : start + next };
}

/**
 * The Registry section's body (everything under the heading, up to the next
 * "## " heading), or null when there is none.
 * @param {string} markdown
 * @returns {string|null}
 */
function registrySection(markdown) {
  const bounds = registryBounds(markdown);
  return bounds ? markdown.slice(bounds.start, bounds.end) : null;
}

module.exports = { registryBounds, registrySection };
