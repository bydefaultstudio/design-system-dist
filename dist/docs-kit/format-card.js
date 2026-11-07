/**
 * format-card.js — the format card on the build side (cms/format-card.md).
 *
 * Two jobs, both reading the format registry (cms/generator/formats.js):
 *
 *   {{format: <id> show="…" on="…"}}  a line in any cms/*.md page. It
 *       becomes a card shell: the format as JSON, its icons in a <template>
 *       and the artwork as a plain <img>, which assets/js/format-card.js
 *       turns into the live card. Data goes in at build time; the page
 *       fetches nothing. A bad tag fails the build and names the page.
 *
 *   tools/formats-embed.html  the public embed: one card filling the frame,
 *       no site chrome, the whole registry inlined, the format and its
 *       switches read from the URL by assets/js/formats-embed.js.
 *
 * resolveLayers() holds the same rules as FormatCard.resolveLayers in the
 * browser; scripts/verify-formats.js runs both on the same cases so they
 * cannot drift.
 */

'use strict';

const { SWITCHES: LAYERS, RENAMED } = require('./formats.js');

/* Ids before 2 November (decision 24): an old tag or embed URL keeps
   working. A renamed id becomes its new name, and is then checked like any
   other, so a format without that layer still stops the build. A removed
   id (null) is dropped. */
function renameList(list) {
  if (!list) return list;
  const out = [];
  let dropped = false;
  list.forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(RENAMED, id)) return out.push(id);
    if (RENAMED[id]) out.push(RENAMED[id]);
    else dropped = true;
  });
  // Every name was a removed one: show nothing, or start as the registry does.
  return out.length || !dropped ? out : 'emptied';
}
const TAG_PARAMS = ['show', 'on'];
const EMBED_PATH = 'tools/formats-embed.html';

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** JSON safe inside a <script> block: no "</script>", no "<!--". */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function parseList(value) {
  if (value === null || value === undefined) return null;
  return String(value).split(/[\s,]+/).filter(Boolean);
}

function formatLayers(format) {
  return (format.spec.layers || []).filter((entry) => entry.type === 'group').map((entry) => entry.id);
}

/** { show, on } or { error }: the browser's rules, word for word. */
function resolveLayers(format, showList, onList) {
  const has = formatLayers(format);
  showList = renameList(showList);
  onList = renameList(onList);
  if (showList === 'emptied') showList = ['none'];
  if (onList === 'emptied') onList = null;
  if (showList && !showList.length) return { error: 'show is empty. Write show="none" for no switches, or leave it out for every switch.' };
  if (onList && !onList.length) return { error: 'on is empty. Leave it out for the registry\'s starting state.' };
  // "none none" is still none; "none" beside a layer name is a mistake.
  const none = !!showList && showList.every((id) => id === 'none');
  if (showList && !none && showList.includes('none')) return { error: 'show="none" cannot be combined with layer names.' };
  if (none && onList) return { error: `on="${onList.join(' ')}" names a switch that show leaves out.` };
  let show = none ? [] : (showList || has.slice());
  const named = show.concat(onList || []);
  for (const id of named) {
    if (!LAYERS.includes(id)) return { error: `"${id}" is not a layer. The layers are ${LAYERS.join(', ')}.` };
    if (!has.includes(id)) return { error: `The ${format.name} has no "${id}" layer. It has ${has.join(', ')}.` };
  }
  if (onList) {
    for (const id of onList) {
      if (!show.includes(id)) return { error: `on="${id}" names a switch that show leaves out.` };
    }
  }
  show = has.filter((id) => show.includes(id));
  return { show, on: onList };
}

/** Every format by id, with its platform's label. */
function indexFormats(platforms) {
  const byId = new Map();
  platforms.forEach((platform) => {
    platform.formats.forEach((format) => byId.set(format.id, { format, platform: platform.label }));
  });
  return byId;
}

/**
 * The card's shell, which format-card.js builds the card inside.
 * @param {object} opts { format, platform, show, on, getIcon, external }
 *   show/on are lists (null for the defaults); external opens the tool in a
 *   new tab, for a card framed on someone else's page.
 */
function renderShell(opts) {
  const { format, platform, show, on, getIcon } = opts;
  const attrs = [
    'class="format-card"',
    'data-format-card',
    show ? `data-show="${escapeHtml(show.length ? show.join(' ') : 'none')}"` : '',
    on ? `data-on="${escapeHtml(on.join(' '))}"` : '',
    opts.external ? 'data-format-card-external' : '',
  ].filter(Boolean).join(' ');
  // One line, no blank lines: marked keeps an HTML block whole only until
  // the first blank line.
  return `<div ${attrs}>`
    + `<script type="application/json" data-format-card-data>${scriptJson({ platform, format })}</script>`
    + `<template data-format-card-icons>${getIcon('download')}${getIcon('arrow-up-right')}${getIcon('info-circled')}</template>`
    + `<img class="format-card-fallback" src="${escapeHtml(format.artwork.src)}" alt="${escapeHtml(format.artwork.alt)}" width="${format.canvas.w}" height="${format.canvas.h}" loading="lazy">`
    + '</div>';
}

/**
 * One {{format: …}} line to its shell. Throws with the page named.
 * @param {string} line the whole line
 * @param {Map} byId indexFormats()
 * @param {string} source the page, for the error
 */
function expandTag(line, byId, getIcon, source) {
  const fail = (reason) => {
    throw new Error(`{{format}} in ${source}: ${reason}\n  ${line}`);
  };
  const match = /^\{\{format:\s*([a-z0-9-]+\/[a-z0-9-]+)((?:\s+[a-z]+="[^"]*")*)\s*\}\}[^\S\n]*$/.exec(line);
  if (!match) fail('write it as {{format: <platform>/<format> show="…" on="…"}}, the whole line, with straight double quotes');
  const entry = byId.get(match[1]);
  if (!entry) fail(`no format "${match[1]}" in assets/data/formats/ (there are ${[...byId.keys()].join(', ')})`);
  const attrs = Object.create(null);
  const pair = /([a-z]+)="([^"]*)"/g;
  let p;
  while ((p = pair.exec(match[2]))) {
    if (!TAG_PARAMS.includes(p[1])) fail(`unknown parameter "${p[1]}" — expected ${TAG_PARAMS.join(' or ')}`);
    if (attrs[p[1]] !== undefined) fail(`duplicate parameter "${p[1]}"`);
    attrs[p[1]] = p[2];
  }
  const resolved = resolveLayers(entry.format, parseList(attrs.show), parseList(attrs.on));
  if (resolved.error) fail(resolved.error);
  return renderShell({
    format: entry.format,
    platform: entry.platform,
    show: attrs.show === undefined ? null : resolved.show,
    on: attrs.on === undefined ? null : resolved.on,
    getIcon,
  });
}

/** Text safe in a markdown table cell and a link label: no pipe, no bracket. */
function cell(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/[|[\]]/g, (c) => '\\' + c);
}

/** A number as the guide prints it: no trailing zeros. */
function num(n) {
  return String(Math.round(n * 100) / 100);
}

/**
 * {{format-table: <platform>}}: every format at a glance, as markdown table
 * lines, from the registry, so the platform page's numbers cannot drift
 * from the tool's. Each row links to the format's section (#<format>).
 * Only what deserves less trust is marked (owner's brief, 2 November): a
 * safe area the platform publishes names its owner and links the source,
 * (the reference marked safeArea), and one with an estimated number
 * carries an "estimated" badge, so a guess
 * never reads as a spec. Keep-clear distances live on the drawing
 * (Measurements) and in the downloads, not here. A platform with no such
 * file, or a format with no imported rule, stops the build.
 */
function expandTable(line, platforms, source) {
  const fail = (reason) => {
    throw new Error(`{{format-table}} in ${source}: ${reason}\n  ${line}`);
  };
  const match = /^\{\{format-table:\s*([a-z0-9-]+)\s*\}\}[^\S\n]*$/.exec(line);
  if (!match) fail('write it as {{format-table: <platform>}}, the whole line');
  const platform = platforms.find((p) => p.platform === match[1]);
  if (!platform) fail(`no platform "${match[1]}" in assets/data/formats/`);
  const rows = platform.formats.map((f) => {
    if (!f.safeArea || !f.shows) fail(`${f.id} has no imported safe area or shows: run node scripts/import-formats.js`);
    const anchor = f.id.split('/')[1];
    const sa = f.safeArea;
    const numbers = Object.values(sa).filter((n) => n && typeof n === 'object');
    let safe = sa.shape === 'circle' ? `${num(sa.d.value)} circle` : `${num(sa.w.value)} × ${num(sa.h.value)}`;
    if (numbers.some((n) => n.source === 'estimated')) {
      safe += ' <span class="badge" data-color="warning">estimated</span>';
    } else if (platform.ruleOwner && numbers.every((n) => n.source === 'platform-rule')) {
      const owner = cell(platform.ruleOwner);
      const ref = (f.references || []).find((r) => r.safeArea);
      safe += ref ? `, from [${owner}](${ref.url})` : `, from ${owner}`;
    }
    return `| [${cell(f.name)}](#${anchor}) | ${f.canvas.w} × ${f.canvas.h} | ${safe} | ${cell(f.shows)} |`;
  });
  return ['| Format | Size | Safe area | Shows in |', '|---|---|---|---|'].concat(rows).join('\n');
}

/**
 * The public embed page. Standalone: no Barba, no sidebar, no site header,
 * the brand's tokens and the card's stylesheet, the registry inlined.
 */
function renderEmbedPage({ platforms, getIcon, themeLink }) {
  const manifest = scriptJson({ platforms: platforms.map((p) => ({ label: p.label, formats: p.formats })) });
  return `<!DOCTYPE html>
<!-- GENERATED by cms/generator/format-card.js (renderEmbedPage). Edit there, then run docgen. -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Format</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="stylesheet" href="/assets/css/design-system.css">
  <link rel="stylesheet" href="/assets/css/docs-site.css">
  ${themeLink || ''}
</head>
<body class="format-embed">
  <!-- One card filling the frame, built from the URL by formats-embed.js:
       ?format=<platform>/<format>&show=…&on=…, the same settings as the
       {{format:}} tag (cms/format-card.md). A bad address shows the message
       below instead of an empty frame. -->
  <main class="format-embed-frame" id="format-embed">
    <div class="callout" data-type="warning" id="format-embed-error" hidden>
      <p class="callout-title">This format can’t be shown</p>
      <p class="callout-description" id="format-embed-reason"></p>
    </div>
  </main>
  <template id="format-embed-icons">${getIcon('download')}${getIcon('arrow-up-right')}${getIcon('info-circled')}</template>
  <script type="application/json" id="format-manifest">${manifest}</script>
  <script src="/assets/js/layer-stack.js"></script>
  <script src="/assets/js/format-card.js"></script>
  <script src="/assets/js/formats-embed.js"></script>
</body>
</html>
`;
}

module.exports = { LAYERS, EMBED_PATH, parseList, resolveLayers, indexFormats, renderShell, expandTag, expandTable, renderEmbedPage };
