/**
 * formats.js — the format registry, read and checked in one place.
 *
 * assets/data/formats/<platform>.json holds one platform's formats
 * (format-system.md §6, decision D1), each with its size, its rules and
 * their provenance, its default artwork and the Layout Spec whose top-level
 * groups are the Format Library's layer switches. Two readers share this
 * module, so they can never disagree about what a valid file is:
 *
 *   cms/generator/generate-docs.js — inlines the registry on the Formats
 *                                    tool page ({{format-manifest}}) and
 *                                    stops the build on a bad file
 *   scripts/verify-formats.js      — the same checks, plus every spec read
 *                                    through layer-stack.js, in npm test
 *
 * The schema (assets/data/format.schema.json) covers the shape. What it
 * cannot say is here: the file is named for its platform, ids are unique
 * and carry the platform, the ratio matches the size, the spec draws the
 * canvas it describes, every file it names exists, and the switches are
 * Artwork then the Figma overlays, bottom to top (Safe area, Cropped area,
 * App screen, Profile grid, Measurements), with Artwork and App screen on
 * (format library handover, decision 20). A format carries only the
 * switches it uses.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FORMATS_DIR = path.join('assets', 'data', 'formats');
const SCHEMA_FILE = path.join('assets', 'data', 'format.schema.json');
const SPEC_SCHEMA_FILE = path.join('assets', 'data', 'layout-spec.schema.json');

/** The layer switches, in the order the tool lists them, and which start on. */
const SWITCHES = ['artwork', 'safe-area', 'app-screen', 'profile-grid', 'profile', 'measurements'];
const ON_BY_DEFAULT = ['artwork', 'app-screen'];

/** Layer ids no longer drawn, kept working in old {{format:}} tags and embed
    URLs (decision 24). null: the layer is gone, and the id is dropped. Cropped
    area went on 10 November: each view now carries its own crop (decision 37). */
const RENAMED = { 'cut-off': null, 'cropped-area': null, 'app-interface': 'app-screen', guides: null };

/** The Type filter's values, as the schema's enum, with their labels. */
const TYPE_LABELS = { post: 'Post', story: 'Story', video: 'Video', banner: 'Banner', profile: 'Profile', ad: 'Ad' };

function ratioValue(ratio) {
  const [a, b] = String(ratio).split(':').map(Number);
  return a > 0 && b > 0 ? a / b : NaN;
}

/** Every file a spec draws: image layers' sources. */
function specImages(spec) {
  const out = [];
  (spec.layers || []).forEach((entry) => {
    const list = entry.type === 'group' ? entry.layers || [] : [entry];
    list.forEach((layer) => {
      if (layer.type === 'image' && layer.settings && layer.settings.src) out.push(layer.settings.src);
    });
  });
  return out;
}

/**
 * Read and check every registry file.
 * @param {string} root the repo root
 * @returns {{platforms: object[], errors: string[]}}
 */
function loadFormats(root) {
  const errors = [];
  const platforms = [];
  const dir = path.join(root, FORMATS_DIR);
  if (!fs.existsSync(dir)) return { platforms, errors };

  const Ajv2020 = require('ajv/dist/2020');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(root, SPEC_SCHEMA_FILE), 'utf8')));
  const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, SCHEMA_FILE), 'utf8')));

  const seen = new Set();
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  files.forEach((name) => {
    const where = path.join(FORMATS_DIR, name);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (error) {
      errors.push(`${where}: not JSON — ${error.message}`);
      return;
    }
    if (!validate(data)) {
      validate.errors.slice(0, 8).forEach((e) => errors.push(`${where}${e.instancePath || ''}: ${e.message}`));
      return;
    }
    if (name !== data.platform + '.json') errors.push(`${where}: platform "${data.platform}" must match the file name`);

    data.formats.forEach((format) => {
      const at = `${where} ${format.id}`;
      if (seen.has(format.id)) errors.push(`${at}: id is used twice`);
      seen.add(format.id);
      if (format.id.split('/')[0] !== data.platform) errors.push(`${at}: id must start with "${data.platform}/"`);

      const { w, h, ratio } = format.canvas;
      if (Math.abs(w / h - ratioValue(ratio)) / ratioValue(ratio) > 0.01) errors.push(`${at}: ratio ${ratio} does not match ${w} × ${h}`);
      if (format.spec.canvas.w !== w || format.spec.canvas.h !== h) errors.push(`${at}: the spec's canvas is not ${w} × ${h}`);

      [format.artwork.src].concat(specImages(format.spec)).forEach((src) => {
        if (!fs.existsSync(path.join(root, src.replace(/^\//, '')))) errors.push(`${at}: ${src} does not exist`);
      });

      // The switches: every top-level entry but the specimen is a group,
      // from the agreed set, in order, Artwork first, the right ones on.
      const groups = format.spec.layers.filter((entry) => entry.type !== 'specimen');
      const ids = groups.map((entry) => entry.id);
      groups.forEach((entry) => {
        if (entry.type !== 'group') errors.push(`${at}: "${entry.id}" must be a group, so it is one switch`);
        if (!SWITCHES.includes(entry.id)) errors.push(`${at}: "${entry.id}" is not a layer switch (${SWITCHES.join(', ')})`);
        const on = entry.visible !== false;
        if (on !== ON_BY_DEFAULT.includes(entry.id)) errors.push(`${at}: "${entry.id}" must start ${ON_BY_DEFAULT.includes(entry.id) ? 'on' : 'off'}`);
      });
      const ordered = ids.filter((id) => SWITCHES.includes(id));
      if (ordered.join() !== SWITCHES.filter((id) => ordered.includes(id)).join()) errors.push(`${at}: switches out of order (${ids.join(', ')})`);
      if (ids[0] !== 'artwork') errors.push(`${at}: Artwork must be the first switch`);
    });
    platforms.push(data);
  });
  return { platforms, errors };
}

/** The page's data: every platform, in label order. */
function manifestJson(platforms) {
  const sorted = platforms.slice().sort((a, b) => a.label.localeCompare(b.label));
  return JSON.stringify({ types: TYPE_LABELS, platforms: sorted }).replace(/</g, '\\u003c');
}

module.exports = { FORMATS_DIR, SWITCHES, ON_BY_DEFAULT, RENAMED, TYPE_LABELS, loadFormats, manifestJson, specImages };
