#!/usr/bin/env node
/**
 * copy-migrations.js - `npx bd-migrations [dir]`: copies the access gate's
 * D1 migrations from the package into a site's migrations folder
 * (levels-groups-plan.md Phase 3). Wrangler applies migrations only from the
 * site's own folder (wrangler.jsonc migrations_dir), so a site copies them
 * there and applies them with `wrangler d1 migrations apply <db>`.
 *
 * Idempotent. A file already there with the same content is skipped; one
 * with the same name and different content stops the copy, because two
 * migrations under one number means a database that matches neither.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'worker', 'migrations');
const target = path.resolve(process.argv[2] || path.join('worker', 'migrations'));

function main() {
  if (!fs.existsSync(source)) {
    console.error(`bd-migrations: no migrations in the package at ${source}`);
    process.exit(1);
  }
  fs.mkdirSync(target, { recursive: true });
  const files = fs.readdirSync(source).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  let copied = 0;
  for (const file of files) {
    const from = path.join(source, file);
    const to = path.join(target, file);
    const contents = fs.readFileSync(from, 'utf8');
    if (fs.existsSync(to)) {
      if (fs.readFileSync(to, 'utf8') === contents) continue;
      console.error(`bd-migrations: ${to} exists with different content. Nothing after it was copied.`);
      console.error('  Two migrations under one number leave a database that matches neither. Rename yours, or compare the two.');
      process.exit(1);
    }
    fs.writeFileSync(to, contents);
    copied++;
    console.log(`  copied ${file}`);
  }
  console.log(`bd-migrations: ${copied} copied, ${files.length - copied} already there, into ${target}`);
  console.log('  Apply with: npx wrangler d1 migrations apply <database> (add --remote for production)');
}

main();
