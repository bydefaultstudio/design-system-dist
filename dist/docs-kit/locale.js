/**
 * locale.js - the engine's own words in the brand's locale.
 *
 * The engine is written in British English. A brand that sets
 * `wording.locale: "en-US"` in brand.json gets the engine's human-visible
 * words in US spelling: its guides, its app pages, and the strings its tool
 * scripts show. Nothing else changes: a site's own cms/ pages and overrides
 * stay as written, and identifiers never change (tokens, classes, ids,
 * attribute values, file names, JSON keys, URLs, heading anchors).
 *
 * One curated word list (WORDS), converted whole-word and case-preserving
 * (colour, Colour, COLOUR). A word joined by single hyphens is prose
 * (off-centre becomes off-center); anything shaped like an identifier is
 * left alone (see isIdentifier).
 *
 * Two uses, one source:
 *   - build time: generate-docs.js converts engine-owned page sources
 *     (markdown(), html(), frontmatter())
 *   - run time: runtimeSource() writes assets/js/bd-locale.js, which sets
 *     window.bdLocale = { tag, text, html } for the tool scripts' L() helper
 *
 * createLocale is self-contained (no outer references): runtimeSource()
 * ships its source text to the browser as it stands.
 */
'use strict';

// ── The word list ──
//
// Stems expand to their forms below. Every form is a whole word: a listed
// word inside a longer one (ToolColour, colourHex) never matches.

// -ise verbs: -ise, -ises, -ised, -ising, -isation(s), -iser(s) become -ize
const ISE_STEMS = [
  'apolog', 'author', 'capital', 'categor', 'central', 'character', 'critic', 'custom',
  'emphas', 'familiar', 'final', 'harmon', 'initial', 'internal', 'internation', 'legal',
  'local', 'maxim', 'memor', 'minim', 'modern', 'neutral', 'normal', 'optim', 'organ',
  'parameter', 'personal', 'prior', 'random', 'raster', 'real', 'recogn', 'sanit',
  'serial', 'special', 'standard', 'summar', 'symbol', 'synchron', 'token', 'util',
  'visual', 'vector', 'stabil', 'general', 'material', 'deserial',
];
const ISE_SUFFIXES = [['ise', 'ize'], ['ises', 'izes'], ['ised', 'ized'], ['ising', 'izing'],
  ['isation', 'ization'], ['isations', 'izations'], ['iser', 'izer'], ['isers', 'izers']];

// -our nouns: -our and its forms become -or
const OUR_STEMS = [
  'ardour', 'armour', 'behaviour', 'candour', 'clamour', 'colour', 'endeavour', 'favour',
  'fervour', 'flavour', 'harbour', 'honour', 'humour', 'labour', 'neighbour', 'odour',
  'parlour', 'rigour', 'rumour', 'savour', 'splendour', 'tumour', 'valour', 'vapour', 'vigour',
];
const OUR_SUFFIXES = ['', 's', 'ed', 'ing', 'ful', 'less', 'way', 'ways', 'al', 'ally', 'ite', 'ites',
  'able', 'ably', 'er', 'ers'];

// Explicit pairs: -re, -ll-, -yse and the single words
const PAIRS = {
  // -re
  centre: 'center', centres: 'centers', centred: 'centered', centring: 'centering',
  metre: 'meter', metres: 'meters', fibre: 'fiber', fibres: 'fibers', litre: 'liter', litres: 'liters',
  theatre: 'theater', theatres: 'theaters', calibre: 'caliber', lustre: 'luster', sombre: 'somber',
  spectre: 'specter', meagre: 'meager',
  // -ll-
  labelled: 'labeled', labelling: 'labeling', unlabelled: 'unlabeled', cancelled: 'canceled', cancelling: 'canceling',
  modelled: 'modeled', modelling: 'modeling', modeller: 'modeler', modellers: 'modelers',
  travelled: 'traveled', travelling: 'traveling', traveller: 'traveler', travellers: 'travelers',
  levelled: 'leveled', levelling: 'leveling', signalled: 'signaled', signalling: 'signaling',
  channelled: 'channeled', channelling: 'channeling', fuelled: 'fueled', fuelling: 'fueling',
  totalled: 'totaled', totalling: 'totaling', tunnelled: 'tunneled', dialled: 'dialed', dialling: 'dialing',
  marshalled: 'marshaled', counselled: 'counseled', panelled: 'paneled', jewellery: 'jewelry',
  // -yse
  analyse: 'analyze', analysed: 'analyzed', analysing: 'analyzing',
  paralyse: 'paralyze', paralysed: 'paralyzed', catalyse: 'catalyze',
  // singles
  grey: 'gray', greys: 'grays', greyed: 'grayed', greying: 'graying', greyish: 'grayish',
  greyscale: 'grayscale', greyscales: 'grayscales',
  licence: 'license', licences: 'licenses', licenced: 'licensed',
  artefact: 'artifact', artefacts: 'artifacts',
  catalogue: 'catalog', catalogues: 'catalogs', catalogued: 'cataloged', cataloguing: 'cataloging',
  programme: 'program', programmes: 'programs',
  judgement: 'judgment', judgements: 'judgments',
  acknowledgement: 'acknowledgment', acknowledgements: 'acknowledgments',
  ageing: 'aging',
  enrol: 'enroll', enrols: 'enrolls', enrolment: 'enrollment', enrolments: 'enrollments',
  fulfil: 'fulfill', fulfils: 'fulfills', fulfilment: 'fulfillment',
  defence: 'defense', defences: 'defenses', offence: 'offense', offences: 'offenses',
  pretence: 'pretense', manoeuvre: 'maneuver', manoeuvres: 'maneuvers',
  sceptical: 'skeptical', plough: 'plow', anticlockwise: 'counterclockwise',
};

/** Every UK form the engine converts, lower case, to its US form. */
function buildWords() {
  const words = {};
  for (const stem of ISE_STEMS) {
    for (const [uk, us] of ISE_SUFFIXES) words[stem + uk] = stem + us;
  }
  for (const stem of OUR_STEMS) {
    const us = stem.replace(/our$/, 'or');
    for (const suffix of OUR_SUFFIXES) words[stem + suffix] = us + suffix;
  }
  Object.assign(words, PAIRS);
  return Object.freeze(words);
}
const WORDS = buildWords();

// ── The converter ──
//
// Self-contained: runtimeSource() writes its source into bd-locale.js.

function createLocale(words) {
  var keys = Object.keys(words).sort(function (a, b) { return b.length - a.length; });
  var WORD = new RegExp('\\b(' + keys.join('|') + ')\\b', 'gi');
  // Attributes a reader sees or hears; every other attribute is an identifier
  var ATTRS = { 'aria-label': 1, 'aria-description': 1, title: 1, alt: 1, placeholder: 1,
    'data-tooltip': 1, 'data-message': 1 };
  // Elements whose content is code, raw text or never shown as written:
  // their own tag's allowlisted attributes still convert (a textarea's
  // placeholder), their content never does
  var SKIP = { script: 1, style: 1, code: 1, pre: 1, kbd: 1, samp: 1, textarea: 1, template: 1 };
  // Raw text: the content is not markup, so it runs to the closing tag
  var RAW = { script: 1, style: 1, textarea: 1 };
  // Prefixes and parts that make a hyphenated word a name: a class, an
  // attribute, a token or a library (tool-colour, is-colour, chip-colour)
  var NAME_PARTS = { is: 1, has: 1, data: 1, aria: 1, tool: 1, bd: 1, chip: 1, layer: 1, stack: 1,
    background: 1, border: 1, text: 1, font: 1, fill: 1, outline: 1, marker: 1, il: 1, lt: 1, al: 1,
    js: 1, css: 1, btn: 1, button: 1, icon: 1, color: 1, swatch: 1, palette: 1, picker: 1, field: 1 };
  // A tag: its name, then attributes whose quoted values may hold > or <.
  // A < that starts no such tag is text (a<b)
  var TAG_SOURCE = '<\\/[a-zA-Z][\\w:-]*\\s*>'
    + '|<[a-zA-Z][\\w:-]*(?:\\s+[^\\s"\'<>\\/=]+(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'<>=`]+))?)*\\s*\\/?>';
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1,
    source: 1, track: 1, wbr: 1 };

  /** One word in the case it came in: colour, Colour, COLOUR. Mixed case stays. */
  function convertWord(word) {
    var lower = word.toLowerCase();
    var us = words[lower];
    if (!us) return word;
    if (word === lower) return us;
    if (word.length > 1 && word === word.toUpperCase()) return us.toUpperCase();
    if (word === word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) {
      return us.charAt(0).toUpperCase() + us.slice(1);
    }
    return word;
  }

  /**
   * A run of non-space text shaped like an identifier, never prose: a path
   * or address (/ . :// ), a custom property or flag (--), a snake_case
   * name, an anchor (#), an assignment (=), a file name (.ext), a class
   * (.name) or a call (name()).
   */
  function isIdentifier(chunk) {
    if (/[\/#=]|--|[A-Za-z0-9]_[A-Za-z0-9]|\(\)/.test(chunk)
      || /[A-Za-z0-9]\.[A-Za-z][A-Za-z0-9]{0,5}(?![A-Za-z0-9])/.test(chunk)
      || /(^|[(\[{'"`])\.[A-Za-z_-]/.test(chunk)) return true;
    // A hyphenated name: two hyphens or more (data-field-colour), a CSS
    // property (background-colour:), or a part that names code (tool-colour,
    // is-colour). One hyphen between words otherwise is prose (off-centre).
    var word = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+:?/.exec(chunk);
    if (!word) return false;
    var parts = word[0].replace(/:$/, '').split('-');
    if (parts.length > 2 || /:$/.test(word[0])) return true;
    return parts.some(function (part) { return NAME_PARTS[part.toLowerCase()] === 1; });
  }

  /** Plain text: every listed word outside {{shortcodes}} and identifiers. */
  function text(value) {
    var s = String(value);
    if (!WORD.test(s)) { WORD.lastIndex = 0; return s; }
    WORD.lastIndex = 0;
    return s.split(/(\{\{[\s\S]*?\}\})/).map(function (part, i) {
      if (i % 2) return part;
      return part.split(/(\s+)/).map(function (chunk, j) {
        if (j % 2 || !chunk || isIdentifier(chunk)) return chunk;
        return chunk.replace(WORD, convertWord);
      }).join('');
    }).join('');
  }

  /** The value of an opening tag's attribute, or null. */
  function attr(tag, name) {
    var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
  }

  /** An opening tag with its allowlisted attributes' values converted. */
  function convertTag(tag) {
    return tag.replace(/(\s)([a-zA-Z][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*')/g, function (m, space, name, eq, quoted) {
      if (!ATTRS[name.toLowerCase()]) return m;
      return space + name + eq + quoted.charAt(0) + text(quoted.slice(1, -1)) + quoted.charAt(0);
    });
  }

  /**
   * Markup: the text between tags and the allowlisted attributes. Comments,
   * code, scripts and styles stay as written, and so does everything inside
   * an element marked translate="no" or data-locale="off". `convertText`
   * converts a text run (markdown passes its own, which guards code spans
   * and links).
   */
  function html(value, convertText) {
    var s = String(value);
    var convert = convertText || text;
    var TOKEN = new RegExp('<!--[\\s\\S]*?(?:-->|$)|' + TAG_SOURCE, 'g');
    var out = '';
    var last = 0;
    var skipName = null; // the element being skipped
    var depth = 0; // nesting of skipName inside itself
    var svg = 0; // inside an <svg>: its text and titles are the drawing's
    var m;
    while ((m = TOKEN.exec(s)) !== null) {
      var before = s.slice(last, m.index);
      out += skipName || svg ? before : convert(before);
      last = TOKEN.lastIndex;
      var tag = m[0];
      if (tag.charAt(1) === '!') { out += tag; continue; }
      var close = tag.charAt(1) === '/';
      var nameMatch = /^<\/?([a-zA-Z][\w-]*)/.exec(tag);
      var name = nameMatch ? nameMatch[1].toLowerCase() : '';
      if (skipName) {
        if (name === skipName && !VOID[name] && !/\/>$/.test(tag)) depth += close ? -1 : 1;
        if (depth === 0) skipName = null;
        out += tag;
        // Script and style content is raw text: jump to the closing tag
        continue;
      }
      var selfClosing = /\/>$/.test(tag);
      if (name === 'svg' && !selfClosing) svg += close ? -1 : 1;
      if (svg < 0) svg = 0;
      if (close) { out += tag; continue; }
      if (svg && name !== 'svg') { out += tag; continue; }
      var off = attr(tag, 'translate') === 'no' || attr(tag, 'data-locale') === 'off';
      if (SKIP[name] || off) {
        out += off ? tag : convertTag(tag);
        if (!VOID[name] && !/\/>$/.test(tag)) {
          if (RAW[name]) {
            var end = s.toLowerCase().indexOf('</' + name, last);
            if (end === -1) end = s.length;
            out += s.slice(last, end);
            last = end;
            TOKEN.lastIndex = end;
          } else {
            skipName = name;
            depth = 1;
          }
        }
        continue;
      }
      out += convertTag(tag);
    }
    var rest = s.slice(last);
    return out + (skipName || svg ? rest : convert(rest));
  }

  return { words: words, convertWord: convertWord, isIdentifier: isIdentifier, text: text, html: html };
}

const CORE = createLocale(WORDS);

// ── Build time: markdown and frontmatter ──

const PROTECT_START = '\uE000';
const PROTECT_END = '\uE001';

/**
 * Markdown prose outside code: fenced and indented code blocks, code spans,
 * link and image targets, reference labels and definitions, autolinks,
 * {{shortcodes}}, and the markup html() leaves alone.
 *
 * Returns the converted text and `headingIds`: every heading in document
 * order (ATX, setext, and raw <h1>-<h6> written in the markdown) as
 * [converted text, original text], so the generator gives each the id of
 * its original text and every link to it holds. Unchanged headings are in
 * the list too: matched in order, two headings that differ only by spelling
 * can never take each other's id.
 */
function markdown(source) {
  const lines = String(source).split('\n');
  // Reference definitions anywhere in the page: a [label] naming one is a
  // link, and its label must match the definition as written
  const labels = new Set();
  for (const line of lines) {
    const def = /^ {0,3}\[([^\]\n]+)\]:/.exec(line);
    if (def) labels.add(normaliseLabel(def[1]));
  }
  const out = [];
  const code = []; // per line: true when the line is code, never converted
  let block = [];
  let fence = null;
  let inList = false;
  let indented = false;
  let previousBlank = true;
  const flush = () => {
    if (block.length) out.push(...markdownBlock(block.join('\n'), labels).split('\n'));
    block = [];
  };
  for (const line of lines) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    const blank = /^\s*$/.test(line);
    if (fence) {
      out.push(line);
      code.push(true);
      if (opener && opener[1].charAt(0) === fence.charAt(0) && opener[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (opener) {
      flush();
      fence = opener[1];
      out.push(line);
      code.push(true);
      continue;
    }
    // An indented code block: four spaces or a tab, after a blank line,
    // outside a list (where the indent is the item's continuation)
    const deep = /^(?: {4}|\t)/.test(line);
    if (indented && (deep || blank)) {
      out.push(line);
      code.push(!blank);
      previousBlank = blank;
      continue;
    }
    indented = false;
    if (deep && !blank && previousBlank && !inList) {
      flush();
      indented = true;
      out.push(line);
      code.push(true);
      previousBlank = false;
      continue;
    }
    if (!blank) {
      if (/^ {0,3}(?:[-*+]|\d+[.)])\s/.test(line)) inList = true;
      else if (!/^\s/.test(line)) inList = false;
    }
    previousBlank = blank;
    block.push(line);
    code.push(false);
  }
  flush();
  const content = out.join('\n');
  return { content, headingIds: headings(lines, content.split('\n'), code) };
}

/** A reference label as markdown matches it: case and spacing folded. */
function normaliseLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Every heading, in order, as [converted text, original text]. */
function headings(before, after, code) {
  const list = [];
  const ATX = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t\r]*$/;
  const SETEXT = /^ {0,3}(?:=+|-+)[ \t\r]*$/;
  const RAW = /<h([1-6])>([^<]+)<\/h\1>/g;
  for (let i = 0; i < before.length; i++) {
    if (code[i]) continue;
    const was = ATX.exec(before[i]);
    const now = ATX.exec(after[i]);
    if (was && now) list.push([now[1], was[1]]);
    else if (i + 1 < before.length && !code[i + 1] && SETEXT.test(before[i + 1]) && !/^\s*$/.test(before[i])
      && !/^ {0,3}(?:[-*+]|\d+[.)])\s|^ {0,3}[-=]+\s*$/.test(before[i])) {
      list.push([after[i].trim(), before[i].trim()]);
    }
    const rawWas = [...before[i].matchAll(RAW)];
    const rawNow = [...after[i].matchAll(RAW)];
    if (rawWas.length === rawNow.length) rawWas.forEach((m, j) => list.push([rawNow[j][2], m[2]]));
  }
  return list;
}

/** One run of markdown outside code blocks. */
function markdownBlock(block, labels) {
  const kept = [];
  const keep = (match) => {
    kept.push(match);
    return `${PROTECT_START}${kept.length - 1}${PROTECT_END}`;
  };
  const guarded = block
    // Reference definitions: [label]: url "title"
    .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm, keep)
    // Code spans, any number of backticks
    .replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)|(`+)[^`\n]\2(?!`)/g, keep)
    // {{shortcodes}}, {{brand:key}} included: a value the site fills
    .replace(/\{\{[\s\S]*?\}\}/g, keep)
    // A collapsed or shortcut reference, [label][] or [label], whose text
    // is its label: kept whole when a definition names it
    .replace(/!?\[([^\[\]\n]+)\](?=\[\]|[^\[(]|$)/g, (match, label) => (labels.has(normaliseLabel(label)) ? keep(match) : match))
    // Link and image targets: ](url "title")
    .replace(/\]\((?:[^()\s]|\([^()]*\))*(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, keep)
    // A full reference's label: [text][label]
    .replace(/(?<=\])\[[^\]\n]*\]/g, keep)
    // Autolinks
    .replace(/<(?:https?|mailto|ftp):[^>\s]*>/gi, keep);
  const converted = CORE.html(guarded, CORE.text);
  return converted.replace(new RegExp(`${PROTECT_START}(\\d+)${PROTECT_END}`, 'g'), (m, i) => kept[Number(i)]);
}

// The frontmatter fields a reader sees: the page title, its subtitle and
// description, and the labels a doc page's tool link carries
const FRONTMATTER_KEYS = ['title', 'subtitle', 'description', 'actionLabel', 'toolLabel'];
// The page types whose body is raw HTML, never markdown (generate-docs.js
// PAGE_TYPES, body: 'html')
const HTML_BODY_TYPES = ['page', 'bare', 'tool'];

/**
 * A page source split at its frontmatter: { head, body, type }, the head
 * with its visible fields converted. No frontmatter, and the head is empty.
 * Line endings stay as written (\n or \r\n).
 */
function frontmatter(source) {
  const s = String(source);
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  if (!match) return { head: '', body: s, type: null };
  let type = null;
  const lines = match[1].split('\n').map((line) => {
    const m = /^([A-Za-z][\w-]*)(\s*:[ \t]*)(.*?)(\r?)$/.exec(line);
    if (!m) return line;
    if (m[1] === 'type') type = m[3].trim().replace(/^["']|["']$/g, '');
    if (!FRONTMATTER_KEYS.includes(m[1])) return line;
    return m[1] + m[2] + CORE.text(m[3]) + m[4];
  });
  const head = match[0].replace(match[1], () => lines.join('\n'));
  return { head, body: s.slice(match[0].length), type };
}

/**
 * A whole page source, by kind: a markdown page (frontmatter and body), or
 * an HTML body. A markdown page whose type takes a raw HTML body (page,
 * bare) converts its body as markup. Returns { content, headingIds }; an
 * HTML body's headings carry their own ids, if any, which never change.
 */
function page(source, kind) {
  if (kind === 'html') return { content: CORE.html(source), headingIds: [] };
  const { head, body, type } = frontmatter(source);
  if (HTML_BODY_TYPES.includes(type)) return { content: head + CORE.html(body), headingIds: [] };
  const md = markdown(body);
  return { content: head + md.content, headingIds: md.headingIds };
}

// ── Run time ──

// The runtime file's first line, which the generator also reads to know a
// copy it may remove (a site moved back to en-GB)
const RUNTIME_BANNER = '/**\n * bd-locale.js (GENERATED FILE, do not edit)';

/**
 * assets/js/bd-locale.js for a site in `tag`: the converter and the word
 * list, setting window.bdLocale = { tag, text, html }. The tool scripts'
 * L() helpers read it; without it they show the engine's words as
 * written.
 */
function runtimeSource(tag, version) {
  return `${RUNTIME_BANNER}
 *
 * The engine's words in this site's locale, ${tag}, for the tool scripts'
 * L() helpers. Built from brand.json (wording.locale) by the docs
 * kit (cms/generator/locale.js).
 *${version ? `\n * @version ${version}\n *` : ''}
 */
(function () {
  'use strict';
  var core = (${createLocale.toString()})(${JSON.stringify(WORDS)});
  window.bdLocale = Object.freeze({ tag: ${JSON.stringify(tag)}, text: core.text, html: core.html });
})();
`;
}

const LOCALES = Object.freeze(['en-GB', 'en-US']);

module.exports = {
  LOCALES,
  WORDS,
  FRONTMATTER_KEYS,
  createLocale,
  text: CORE.text,
  html: CORE.html,
  isIdentifier: CORE.isIdentifier,
  markdown,
  frontmatter,
  page,
  runtimeSource,
  RUNTIME_BANNER,
};
