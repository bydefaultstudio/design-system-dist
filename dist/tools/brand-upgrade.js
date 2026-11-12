#!/usr/bin/env node
/**
 * brand-upgrade.js - `npx bd-brand upgrade [file]`: rewrites a site's
 * brand.json in the newest shape this engine reads (cms/generator/brand.js).
 *
 * The build already upgrades an older file in memory, so this is never
 * urgent. It is the ONE writer of brand data the engine has, and it runs only
 * when a person runs it: an engine update never writes a brand's file by
 * itself (engine-parity-plan.md, failure scenario 1).
 *
 * The file defaults to docs.config.js's brandManifest, else cms/brand.json.
 * The original is kept beside it as brand.json.bak (never overwritten: a
 * second run writes .bak.2). A decision only a person can make stops it
 * before it writes; what is still to add is listed after, and the command
 * exits 1 until there is nothing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// The brand module ships in the docs kit; this script runs from the package
// (dist/tools) or from the engine repo (scripts).
function loadBrandModule() {
  for (const rel of ['../docs-kit/brand.js', '../cms/generator/brand.js']) {
    const abs = path.join(__dirname, rel);
    if (fs.existsSync(abs)) return require(abs);
  }
  console.error('bd-brand: the brand module is missing from the package. Reinstall it.');
  process.exit(1);
}

function defaultFile() {
  const config = path.resolve('cms', 'docs.config.js');
  if (fs.existsSync(config)) {
    try {
      const manifest = require(config).brandManifest;
      if (manifest) return path.resolve(manifest);
    } catch (err) {
      console.warn(`bd-brand: couldn't read cms/docs.config.js (${err.message}). Using cms/brand.json.`);
    }
  }
  return path.resolve('cms', 'brand.json');
}

function main() {
  const [command, fileArg] = process.argv.slice(2);
  if (command !== 'upgrade') {
    console.log('Usage: npx bd-brand upgrade [path/to/brand.json]');
    process.exit(command ? 1 : 0);
  }
  const B = loadBrandModule();
  const file = fileArg ? path.resolve(fileArg) : defaultFile();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`bd-brand: can't read ${file}: ${err.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = B.upgrade(raw, file);
  } catch (err) {
    console.error(`bd-brand: ${err.message}`);
    process.exit(1);
  }

  // A decision the upgrade can't make (a siteName that isn't "<name> OS")
  // stops it before anything is written: rewritten, the old value would
  // survive only in the backup, and the next run would report nothing.
  if (result.needs.length) {
    console.log(`${path.relative(process.cwd(), file)} is version ${result.from}. Decide these first; nothing was written:`);
    for (const p of result.needs) console.log(`  - ${p}`);
    process.exit(1);
  }

  if (result.from === B.BRAND_VERSION) {
    console.log(`${path.relative(process.cwd(), file)} is already version ${B.BRAND_VERSION}.`);
  } else {
    const backup = freeBackupPath(file);
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, JSON.stringify(result.data, null, 2) + '\n');
    console.log(`Rewrote ${path.relative(process.cwd(), file)} from version ${result.from} to ${B.BRAND_VERSION}. The original is beside it as ${path.basename(backup)}.`);
  }

  // What the new version requires, checked as the build checks it
  const problems = B.validate(result.data, { root: process.cwd(), tokens: siteTokens(B) });
  if (problems.length) {
    console.log('\nStill to do by hand, before the site builds:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log(result.from === B.BRAND_VERSION ? 'It passes.' : 'It passes. Commit it, and delete the backup.');
}

// brand.json.bak, or .bak.2, .bak.3 when one is already there: a second run
// never overwrites the first backup.
function freeBackupPath(file) {
  let candidate = `${file}.bak`;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${file}.bak.${n}`;
  return candidate;
}

// The custom properties the site's stylesheets define, as the build reads
// them, so a hue or a named colour the theme lacks is reported here too.
function siteTokens(B) {
  const config = path.resolve('cms', 'docs.config.js');
  let ds = 'assets/css/design-system.css';
  let brandCss = null;
  if (fs.existsSync(config)) {
    try {
      const c = require(config);
      if (c.designSystemPath) ds = c.designSystemPath;
      if (c.brandCssPath && !/^(https?:)?\/\//.test(c.brandCssPath) && !c.brandCssPath.startsWith('/')) brandCss = c.brandCssPath;
    } catch (err) { /* reported by defaultFile already */ }
  }
  const files = [ds, brandCss].filter(Boolean).map((f) => path.resolve(f)).filter((f) => fs.existsSync(f));
  return files.length ? B.definedTokens(files) : undefined;
}

main();
