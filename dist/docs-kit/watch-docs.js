#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { locateProject } = require('./generate-docs.js');

const PROJECT = locateProject();
const DOCS_DIR = PROJECT.contentDir;

console.log('👀 Watching for changes in documentation files...');
console.log('📁 Watching directory:', DOCS_DIR);
console.log('🔄 Auto-regenerating HTML when files change...\n');

function regenerateDocs() {
  console.log('🔄 File changed, regenerating documentation...');
  // cwd stays the caller's project so the generator rediscovers the same config
  exec(`node ${JSON.stringify(path.join(__dirname, 'generate-docs.js'))}`, { cwd: process.cwd() }, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Error regenerating docs:', error);
      return;
    }
    if (stderr) {
      console.error('⚠️  Warning:', stderr);
    }
    console.log('✅ Documentation regenerated successfully');
  });
}

// Watch for changes to markdown files
fs.watch(DOCS_DIR, { recursive: false }, (eventType, filename) => {
  if (filename && filename.endsWith('.md')) {
    console.log(`📝 ${eventType}: ${filename}`);
    regenerateDocs();
  }
});

// Watch for changes to template
fs.watchFile(path.join(__dirname, 'template.html'), (curr, prev) => {
  console.log('🔧 Template updated, regenerating...');
  regenerateDocs();
});

// Watch for changes to generator script
fs.watchFile(path.join(__dirname, 'generate-docs.js'), (curr, prev) => {
  console.log('🔧 Generator script updated, reloading...');
  regenerateDocs();
});

console.log('✅ File watcher started successfully!');
console.log('💡 Tip: Keep this running while editing documentation');
console.log('🛑 Press Ctrl+C to stop watching\n');

process.on('SIGINT', () => {
  console.log('\n👋 Stopping file watcher...');
  process.exit(0);
});
