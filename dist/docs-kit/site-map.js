/**
 * site-map.js — every page of the site as data: where it sits, what template
 * it uses, what level opens it, and whether it exists yet.
 *
 * Two consumers, so the walk lives in one place (the icon-aliases.js argument):
 *
 *   generate-docs.js          — writes experiments/site-map-data.js on every
 *                               full build, the data behind the site-map
 *                               experiment (handovers/HANDOVER-ia-map.md)
 *   the IA map (Phase 6)      — the same nodes as tree text, committed as
 *                               ia-map.txt and embedded on /docs/ia-map.html
 *
 * The nodes come from objects the generator already builds — a page's
 * frontmatter merged with cms/_defaults.md, and the output path it derived —
 * so nothing here is a second opinion about where a page is. The only
 * hand-made part is cms/generator/ia-planned.json: pages and sections that do
 * not exist yet, each a name and a reference to the document that decided it,
 * never prose (a hand-maintained map is what repo-map.md was before it rotted).
 *
 * Like its siblings this module computes and returns; generate-docs.js owns
 * the write. The data file lives under experiments/, which is tracked, served
 * raw by Live Server, copied for `npm run dev`, and never deployed. It must
 * not move under /assets/: a list of every gated URL is exactly what the gate
 * keeps off the wire (access-plan.md §12.7).
 *
 * Deterministic: sorted by the site's own section and subsection order, then
 * the same comparator the section indexes use, then id; collation pinned to
 * one locale; no timestamps. Two builds of the same tree write the same
 * bytes, so `git diff` on the file is a diff of the IA.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('experiments', 'site-map-data.js');
const PLANNED_FILE = path.join(__dirname, 'ia-planned.json');

/** Levels a page can declare (permissions-plan.md §3.1). Anything else is team. */
const LEVELS = ['public', 'team', 'admin'];
const DEFAULT_LEVEL = 'team';

/** Pinned so two machines with different process locales sort ties alike. */
const COLLATION = 'en';

/** Pages that have no cms/ source. Read from the files themselves. */
const HAND_AUTHORED = [
  { file: 'index.html', kind: 'index', type: 'shelf' },
  { file: 'support.html', kind: 'hand-authored', type: 'bare' },
  { file: 'auth/login.html', kind: 'hand-authored', type: 'bare' },
  // Its body says data-access="public", but the gate serves it to signed-in
  // readers only, of any role (gate.mjs SIGNED_IN_EXACT)
  { file: 'auth/account.html', kind: 'hand-authored', type: 'bare', access: 'signed-in' },
];

/**
 * The level the gate will read for a page: `public`, `team` or `admin`, with
 * a missing, unknown or legacy value (`brand`, `brand:x`) falling to team —
 * the same rule permissions-plan.md §3.1 sets for the level map.
 */
function normaliseLevel(access) {
  const value = String(access || '').trim().toLowerCase();
  return LEVELS.includes(value) ? value : DEFAULT_LEVEL;
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), COLLATION);
}

/** The section indexes' comparator: order ascending (missing → 999), then title. */
function comparePages(a, b) {
  const orderA = Number(a.order) || 999;
  const orderB = Number(b.order) || 999;
  if (orderA !== orderB) return orderA - orderB;
  return compareText(a.title, b.title) || compareText(a.id, b.id);
}

function readTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  if (!match) return '';
  // "Home - By Default OS" → "Home"; the suffix is the site name, not the page's.
  return match[1].replace(/\s+[-—–]\s+[^-—–]+$/, '').trim();
}

function readBodyAccess(html) {
  const match = html.match(/<body[^>]*\sdata-access="([^"]*)"/i);
  return match ? match[1] : '';
}

/**
 * One node per page.
 *
 * @param {object} input
 * @param {string} input.root            project root
 * @param {string} input.docsDir         cms/ directory
 * @param {Array}  input.allFiles        the generator's file objects (every cms/*.md)
 * @param {string[]} input.sectionOrder  parsed `section-order`
 * @param {(section: string) => string[]} input.subsectionOrder
 * @param {object} input.sectionFolders  label → output folder
 * @param {(text: string) => {frontmatter: object, content: string}} input.parseFrontmatter
 */
function collectSiteMap(input) {
  const nodes = [];

  for (const file of input.allFiles) {
    const fm = file.frontmatter || {};
    const isRoot = !file.htmlFolder;
    const isToolGuide = !!fm.actionUrl;
    // actionUrl is written relative to the guide ("./logo-tool.html"); the
    // board links by site URL, so resolve it against the guide's own folder.
    const toolUrl = isToolGuide
      ? (fm.actionUrl.startsWith('/') ? fm.actionUrl : `/${file.htmlFolder}/${fm.actionUrl.replace(/^\.\//, '')}`)
      : undefined;
    nodes.push({
      id: `cms/${file.filename}`,
      title: file.title,
      url: '/' + file.htmlPath,
      section: isRoot ? '' : file.section,
      subsection: fm.subsection || '',
      order: fm.order === undefined ? null : Number(fm.order),
      type: fm.type || 'doc',
      access: file.ownAccess || '',
      level: normaliseLevel(file.ownAccess),
      layer: fm.layer || '',
      medium: fm.medium || '',
      kind: isRoot ? 'root' : isToolGuide ? 'tool-guide' : 'doc',
      tool: toolUrl,
      status: 'existing',
    });
  }

  const appsDir = path.join(input.docsDir, 'apps');
  if (fs.existsSync(appsDir)) {
    const appFiles = fs.readdirSync(appsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('README') && !f.startsWith('_'))
      .sort();
    for (const filename of appFiles) {
      const parsed = input.parseFrontmatter(fs.readFileSync(path.join(appsDir, filename), 'utf8'));
      const fm = parsed.frontmatter || {};
      if (fm.status === 'draft') continue;
      const slug = filename.replace(/\.md$/, '');
      const section = fm.section || 'Tools';
      const folder = input.sectionFolders[section] || section.toLowerCase();
      nodes.push({
        id: `cms/apps/${filename}`,
        title: fm.title || slug,
        url: `/${folder}/${slug}.html`,
        section,
        subsection: fm.subsection || '',
        order: fm.order === undefined ? null : Number(fm.order),
        type: fm.type || 'tool',
        access: fm.access || '',
        level: normaliseLevel(fm.access),
        layer: fm.layer || '',
        medium: fm.medium || '',
        kind: 'tool',
        status: 'existing',
      });
    }
  }

  for (const entry of HAND_AUTHORED) {
    const filePath = path.join(input.root, entry.file);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const access = entry.access || readBodyAccess(html);
    nodes.push({
      id: entry.file,
      title: readTitle(html) || entry.file,
      url: '/' + entry.file,
      section: '',
      subsection: '',
      order: null,
      type: entry.type,
      access,
      level: normaliseLevel(access),
      layer: '',
      medium: '',
      kind: entry.kind,
      status: 'existing',
    });
  }

  for (const node of readPlanned()) nodes.push(node);

  // The board and the IA map index by id; two nodes sharing one would
  // silently collapse into a single card. Name the clash at build time, where
  // ia-planned.json's other mistakes already surface.
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.id)) throw new Error(`site-map: two pages share the id "${node.id}"`);
    seen.add(node.id);
  }

  const sectionRank = rankBy(input.sectionOrder);
  const subsectionRanks = {};
  function subsectionRank(section) {
    if (!subsectionRanks[section]) subsectionRanks[section] = rankBy(input.subsectionOrder(section));
    return subsectionRanks[section];
  }

  nodes.sort((a, b) => {
    // Root and hand-authored pages (section '') lead; unknown sections follow
    // the configured ones alphabetically, so a typo is visible, not hidden.
    const bySection = sectionRank(a.section) - sectionRank(b.section)
      || compareText(a.section, b.section);
    if (bySection !== 0) return bySection;
    const ranks = subsectionRank(a.section);
    const bySub = ranks(a.subsection) - ranks(b.subsection)
      || compareText(a.subsection, b.subsection);
    if (bySub !== 0) return bySub;
    return comparePages(a, b);
  });

  return nodes;
}

/** A ranking function over an ordered list: listed → its index, '' → -1, unlisted → list length. */
function rankBy(list) {
  const index = new Map(list.map((label, i) => [label, i]));
  return (label) => {
    if (label === '') return -1;
    return index.has(label) ? index.get(label) : list.length;
  };
}

/**
 * cms/generator/ia-planned.json — pages and sections that do not exist yet.
 * Each node is a name and a `ref` to the document that decided it, no prose.
 * A planned page ships at the default level unless the file says otherwise:
 * "no level" is not a fourth level (permissions-plan.md §3.1).
 * Missing file → no planned nodes, not an error: a project may have none.
 */
function readPlanned() {
  if (!fs.existsSync(PLANNED_FILE)) return [];
  const planned = JSON.parse(fs.readFileSync(PLANNED_FILE, 'utf8'));
  const nodes = [];
  for (const group of planned.groups || []) {
    for (const item of group.nodes || []) {
      if (!item.title) throw new Error(`ia-planned.json: a node in "${group.name}" has no title`);
      const ref = item.ref || group.ref;
      if (!ref) throw new Error(`ia-planned.json: "${item.title}" has no ref and its group "${group.name}" has none`);
      nodes.push({
        id: `planned:${slug(group.name)}/${slug(item.title)}`,
        title: item.title,
        url: null,
        section: item.section || '',
        subsection: item.subsection || '',
        order: item.order === undefined ? null : Number(item.order),
        type: item.kind === 'page' ? (item.type || 'doc') : item.kind || 'page',
        access: item.level || '',
        level: normaliseLevel(item.level),
        layer: '',
        medium: '',
        kind: 'planned',
        planned: { group: group.name, ref },
        status: 'planned',
      });
    }
  }
  return nodes;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The text of experiments/site-map-data.js. The payload carries the
 * vocabularies the board needs for its controls beside the nodes, so the page
 * has no second copy of them to drift.
 *
 * @param {object} input  collectSiteMap's input plus `pageTypes: string[]`
 * @returns {{ js: string, nodes: Array }}
 */
function renderSiteMapData(input) {
  const nodes = collectSiteMap(input);
  const subsectionOrder = {};
  for (const section of input.sectionOrder) subsectionOrder[section] = input.subsectionOrder(section);
  const payload = {
    version: 1,
    sections: input.sectionOrder,
    subsectionOrder,
    types: input.pageTypes,
    levels: LEVELS,
    defaultLevel: DEFAULT_LEVEL,
    nodes,
  };
  const banner = `/**
 * site-map-data.js — GENERATED by cms/generator/generate-docs.js, do not edit.
 *
 * Every page of the site as data, for experiments/site-map.html. Sections and
 * subsections in the site's own order (cms/_defaults.md), each page with its
 * template, place, level and status, plus the planned nodes from
 * cms/generator/ia-planned.json. Sorted and timestamp-free, so a diff of this
 * file is a diff of the IA. Lives under experiments/ on purpose: never deploy
 * a list of every gated URL (access-plan.md §12.7).
 */
`;
  return { js: banner + 'var SITE_MAP = ' + JSON.stringify(payload, null, 2) + ';\n', nodes };
}

module.exports = {
  DATA_FILE,
  LEVELS,
  DEFAULT_LEVEL,
  normaliseLevel,
  comparePages,
  collectSiteMap,
  renderSiteMapData,
};
