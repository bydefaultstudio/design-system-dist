/**
 * The glossary: one markdown file per term in cms/glossary/, plus
 * cms/glossary/_tags.json for the two-level tag vocabulary.
 *
 * This module is the data half: it loads and validates the entries and
 * renders the markup that is pure string work (the index list, the feed). The
 * page half (entry pages) lives in generate-docs.js beside the other emitters,
 * because it needs renderPage and markdownToHtml.
 *
 * Publishing is decided by category, not per file: an entry is published when
 * any of its tags files under a category marked `published` in _tags.json,
 * unless its own frontmatter says `status: "draft"`. Unpublished entries stay
 * in the repo and are never emitted: no page, no index row, no feed line, no
 * search entry. Publishing a whole category later is one word in _tags.json.
 *
 * Entry frontmatter (flat `key: "value"` lines, lists comma-separated):
 *   title    the term, real capitalisation          required
 *   short    one sentence, no trailing full stop    required
 *   tags     subtag slugs from _tags.json           required, at least one
 *   related  slugs of other entries                 optional
 *   source   one authoritative https link           optional
 *   aliases  former slugs, for redirects            optional
 *   status   "draft" holds a published-category entry back
 */

const fs = require('fs');
const path = require('path');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function list(value) {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Load and validate every entry. Returns null when the directory does not
 * exist (a consumer of the docs kit has no glossary). Throws with every
 * problem listed at once, so one build run shows the whole repair.
 */
function loadGlossary(docsDir, parseFrontmatter) {
  const dir = path.join(docsDir, 'glossary');
  if (!fs.existsSync(dir)) return null;

  const vocabPath = path.join(dir, '_tags.json');
  let vocab;
  try {
    vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
  } catch (err) {
    throw new Error(`cms/glossary/_tags.json could not be read: ${err.message}`);
  }
  if (!Array.isArray(vocab.categories) || !Array.isArray(vocab.tags)) {
    throw new Error('cms/glossary/_tags.json needs a "categories" array and a "tags" array');
  }
  const categories = new Map(vocab.categories.map(c => [c.slug, c]));
  const tags = new Map(vocab.tags.map(t => [t.slug, t]));
  const errors = [];

  for (const t of vocab.tags) {
    if (!categories.has(t.category)) errors.push(`  _tags.json - tag "${t.slug}" files under unknown category "${t.category}"`);
  }

  const entries = [];
  for (const filename of fs.readdirSync(dir).sort()) {
    if (!filename.endsWith('.md') || filename.startsWith('_') || filename.startsWith('README')) continue;
    const slug = filename.replace(/\.md$/, '');
    const { frontmatter, content } = parseFrontmatter(fs.readFileSync(path.join(dir, filename), 'utf8'));
    const where = `  glossary/${filename}`;

    if (!SLUG_RE.test(slug)) errors.push(`${where} - filename is not a lowercase-hyphenated slug`);
    if (!frontmatter.title || !frontmatter.title.trim()) errors.push(`${where} - missing title`);
    if (frontmatter.status && !['draft', 'published'].includes(frontmatter.status)) {
      errors.push(`${where} - status "${frontmatter.status}" (must be draft or published, or absent)`);
    }
    // Rendered as a live link, so a scheme other than https, or anything that
    // would break out of the href, is refused here rather than shipped.
    if (frontmatter.source && !/^https:\/\/[^\s"'<>()]+$/.test(frontmatter.source)) {
      errors.push(`${where} - source must be one https URL`);
    }
    if (!frontmatter.short) errors.push(`${where} - missing short`);
    if (frontmatter.short && /\.$/.test(frontmatter.short)) errors.push(`${where} - short ends with a full stop`);
    if (!content.trim()) errors.push(`${where} - no body`);

    const entryTags = list(frontmatter.tags);
    if (entryTags.length === 0) errors.push(`${where} - no tags`);
    for (const t of entryTags) {
      if (!tags.has(t) && !categories.has(t)) errors.push(`${where} - unknown tag "${t}" (not in _tags.json)`);
    }

    // A tag may be a category itself (erlens-words has no subtags).
    const entryCategories = new Set(entryTags.map(t => (tags.has(t) ? tags.get(t).category : t)));
    const inPublishedCategory = [...entryCategories].some(c => categories.has(c) && categories.get(c).published);

    entries.push({
      slug,
      title: frontmatter.title || slug,
      short: frontmatter.short || '',
      tags: entryTags,
      categories: [...entryCategories],
      related: list(frontmatter.related),
      source: frontmatter.source || '',
      aliases: list(frontmatter.aliases),
      body: content,
      published: inPublishedCategory && frontmatter.status !== 'draft',
    });
  }

  const bySlug = new Map(entries.map(e => [e.slug, e]));
  const aliasOwners = new Map();
  for (const e of entries) {
    for (const r of e.related) {
      if (!bySlug.has(r)) errors.push(`  glossary/${e.slug}.md - related "${r}" is not an entry`);
      if (r === e.slug) errors.push(`  glossary/${e.slug}.md - relates to itself`);
    }
    for (const a of e.aliases) {
      if (!SLUG_RE.test(a)) errors.push(`  glossary/${e.slug}.md - alias "${a}" is not a lowercase-hyphenated slug`);
      if (bySlug.has(a)) errors.push(`  glossary/${e.slug}.md - alias "${a}" is also a live entry's slug`);
      if (aliasOwners.has(a)) errors.push(`  glossary/${e.slug}.md - alias "${a}" is already claimed by ${aliasOwners.get(a)}`);
      aliasOwners.set(a, e.slug);
    }
  }

  if (errors.length) {
    throw new Error(`cms/glossary has ${errors.length} problem(s):\n${errors.join('\n')}`);
  }

  // Sort by the name a reader scans, not the slug: "UI Cards" files under U
  // even though its slug is cards.
  entries.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  const published = entries.filter(e => e.published);
  return { entries, published, bySlug, categories, tags };
}

function letterOf(title) {
  // Decomposed first, so Über files under U beside the other U terms.
  const first = title.trim().normalize('NFD')[0].toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

/**
 * The topics a reader can filter by: every tag filed under a published
 * category that at least one published entry carries, most used first. A tag
 * under an unpublished category is never offered, even when a published entry
 * carries it, because choosing it would narrow to terms filed elsewhere.
 */
function publishedTopics(glossary) {
  const counts = new Map();
  for (const e of glossary.published) {
    for (const t of e.tags) {
      const tag = glossary.tags.get(t);
      if (!tag || !glossary.categories.get(tag.category).published) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, name: glossary.tags.get(slug).name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'));
}

/**
 * The index list: letter groups of term cards, each a whole-card link to the
 * entry page (card.md, .card--interactive) showing the term and its short
 * definition. glossary.js filters them and opens each in the reading drawer;
 * without JS the link is the whole feature. The long text never goes inline,
 * which keeps the index light.
 *
 * data-barba-prevent: glossary.js takes a plain click to open the drawer, and
 * Barba ignores defaultPrevented, so without it Barba would navigate as well.
 * A modified click still opens the entry page, as a full page load.
 */
function renderGlossaryList(glossary, entryHref) {
  const topicSlugs = new Set(publishedTopics(glossary).map(t => t.slug));
  const groups = new Map();
  for (const e of glossary.published) {
    const letter = letterOf(e.title);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(e);
  }

  // A term starting with a digit files under '#', which az-index.js places
  // after Z; the list follows the rail so the jump order and reading order
  // agree.
  const letters = [...groups.keys()].sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b));

  const out = [];
  for (const letter of letters) {
    const entries = groups.get(letter);
    const id = letter === '#' ? 'letter-num' : `letter-${letter.toLowerCase()}`;
    out.push(`    <section class="az-group block gap-s" id="${id}" data-letter="${letter}">`);
    out.push(`      <h3 class="book-contents-title">${letter}</h3>`);
    out.push('      <div class="glossary-grid">');
    for (const e of entries) {
      const topics = e.tags.filter(t => topicSlugs.has(t)).join(' ');
      out.push(`        <a class="card card--interactive glossary-card" id="term-${e.slug}" href="${entryHref(e.slug)}" data-glossary-term="${e.slug}" data-letter="${letter}" data-topics="${topics}" data-barba-prevent>`);
      out.push(`          <h4 class="book-contents-item-title">${escapeHtml(e.title)}</h4>`);
      out.push(`          <p class="book-contents-item-description">${escapeHtml(e.short)}.</p>`);
      out.push('        </a>');
    }
    out.push('      </div>');
    out.push('    </section>');
  }
  return out.join('\n');
}

/**
 * The topic filter: one chip per published topic, All first and checked. A
 * chip group is native radios (chip.md), so the choice works and is announced
 * with no script; glossary.js only narrows the cards to it.
 */
function renderTopicChips(glossary) {
  const out = [
    '    <div class="scroller">',
    '    <div class="chip-group" role="radiogroup" aria-labelledby="glossary-topics-label" data-glossary-topics>',
    '      <label class="chip"><input type="radio" name="glossary-topic" value="" checked><span>All topics</span></label>',
  ];
  for (const t of publishedTopics(glossary)) {
    out.push(`      <label class="chip"><input type="radio" name="glossary-topic" value="${t.slug}"><span>${escapeHtml(t.name)}</span></label>`);
  }
  out.push('    </div>');
  out.push('    </div>');
  return out.join('\n');
}

/**
 * The markup appended to an entry's body on its page, and so in the reading
 * drawer, which lifts the page's <article>: the entry's topics, related terms
 * that are published (an unpublished one would be a link to nothing) with
 * their short definitions, and the source. Appended before markdownToHtml so
 * the headings reach the TOC. Every link is root-relative, because the drawer
 * shows this markup on /glossary.html, one folder up from where it was built.
 *
 * Raw HTML rather than markdown links, so a title holding ] or * cannot break
 * or restyle the link.
 */
function entryAppendix(entry, glossary, entryHref, topicHref) {
  const parts = [];
  const topicNames = new Map(publishedTopics(glossary).map(t => [t.slug, t.name]));
  const topics = entry.tags.filter(t => topicNames.has(t));
  if (topics.length) {
    parts.push(
      '## Topics',
      '',
      '<div class="tag-group glossary-topics">',
      ...topics.map(t => `<a class="tag" data-case="none" href="${topicHref(t)}">${escapeHtml(topicNames.get(t))}</a>`),
      '</div>',
      ''
    );
  }
  const related = entry.related
    .map(slug => glossary.bySlug.get(slug))
    .filter(r => r && r.published);
  if (related.length) {
    parts.push(
      '## Related terms',
      '',
      '<dl class="glossary-related">',
      ...related.map(r => `<div><dt><a href="${entryHref(r.slug)}" data-glossary-related="${r.slug}">${escapeHtml(r.title)}</a></dt><dd>${escapeHtml(r.short)}.</dd></div>`),
      '</dl>',
      ''
    );
  }
  if (entry.source) {
    let label = entry.source;
    try {
      label = new URL(entry.source).hostname.replace(/^www\./, '');
    } catch (err) {
      // Not a URL the parser accepts; show it as written.
    }
    parts.push('## Source', '', `<p><a href="${escapeHtml(entry.source)}">${escapeHtml(label)}</a></p>`, '');
  }
  return parts.length ? `\n\n${parts.join('\n')}` : '';
}

/**
 * The machine-readable feed: every published entry, for anything outside this
 * site that reads the glossary (the capture tool, another app). Static, so it
 * costs nothing to serve and cannot go down separately from the pages.
 */
function glossaryFeed(glossary, entryUrl) {
  return {
    count: glossary.published.length,
    entries: glossary.published.map(e => ({
      slug: e.slug,
      title: e.title,
      short: e.short,
      tags: e.tags,
      related: e.related.filter(r => glossary.bySlug.get(r).published),
      url: entryUrl(e.slug),
    })),
  };
}

module.exports = { loadGlossary, renderGlossaryList, renderTopicChips, entryAppendix, glossaryFeed, escapeHtml };
