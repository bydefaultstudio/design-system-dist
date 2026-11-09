/**
 * Portable-content predicate — the single place that decides which cms pages
 * describe portable design-system components (CLAUDE.md §17 Rule 6).
 *
 * `layer: core` alone is not enough: brand-*.md and
 * formats-*.md are core-layer content, but they describe one brand's
 * identity and channels, not portable components. Both generate-docs.js
 * (the "Use in another product" appendix) and tools/generate-llms-txt.js
 * (component discovery) must apply the same exclusion — this module exists
 * so the excluded-prefix list can never drift between the two again.
 */

// Filename prefixes for brand/channel content pages. If a restructure renames
// these files, update this array and worker/moved.mjs (it redirects to the
// brand-<name> paths); docgen fails if a core page in a brand section or in
// Foundations › Identity loses its prefix.
// formats-docs.md matches too; it is layer app, so never portable anyway.
// A future core page named formats-*.md outside the Formats section would
// be treated as brand content: name it for what it is instead.
const BRAND_CONTENT_PREFIXES = ['brand-', 'formats-'];

// Brand/channel content: core-layer pages about one brand, not the engine
function isBrandContent(filename) {
  return BRAND_CONTENT_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

// A portable component page is core-layer and not brand content.
// `filename` is the bare markdown filename (e.g. "button.md").
function isPortableComponentPage(filename, frontmatter) {
  return frontmatter.layer === 'core' && !isBrandContent(filename);
}

module.exports = { isBrandContent, isPortableComponentPage };
