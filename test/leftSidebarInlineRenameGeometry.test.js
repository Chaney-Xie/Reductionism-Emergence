const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('Page, manual Folder, and Dynamic Folder rows share the File-row outer geometry', async () => {
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
  const page = rule(css, '.page-link');
  const folder = rule(css, '.nav-folder-button');
  const manual = rule(css, '.nav-folder-manual-button');
  const dynamic = rule(css, '.nav-folder-dynamic-button');

  assert.match(page, /width: 100%/);
  assert.match(folder, /width: 100%/);
  assert.match(page, /padding: var\(--font-file-row-padding-block\) 0\.7rem/);
  assert.match(manual, /padding-block: var\(--font-file-row-padding-block\)/);
  assert.match(dynamic, /padding: var\(--font-file-row-padding-block\) 0\.7rem/);
  for (const row of [page, manual, dynamic]) {
    assert.match(row, /line-height: var\(--font-file-row-line-height\)/);
  }
  assert.doesNotMatch(dynamic, /0\.5em|0\.55rem/);
});

test('rename rows use paint-only emphasis and inputs exactly inherit the normal name slot', async () => {
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
  const renameState = css.match(/\.page-link\.nav-page-renaming,[\s\S]*?\.nav-folder-button\.nav-folder-renaming\s*\{[^}]*\}/)?.[0] || '';
  const input = css.match(/\.nav-folder-rename-input,[\s\S]*?\.nav-page-rename-input\s*\{[^}]*\}/)?.[0] || '';

  assert.match(renameState, /background: var\(--surface-guide-section\)/);
  assert.match(renameState, /box-shadow: inset 0 0 0 2px var\(--border-guide\)/);
  assert.doesNotMatch(renameState, /(?:^|[;{]\s*)border\s*:/);
  assert.match(input, /flex: 1 1 auto/);
  assert.match(input, /min-width: 0/);
  assert.match(input, /width: auto/);
  assert.match(input, /height: var\(--font-file-row-line-height\)/);
  assert.match(input, /padding: 0/);
  assert.match(input, /border: 0/);
  assert.match(input, /background: transparent/);
  assert.match(input, /font: inherit/);
  assert.match(input, /line-height: inherit/);
});

test('rename lifecycle preserves row DOM and replaces only each existing name slot', async () => {
  const source = await fs.readFile(path.join(root, 'public/js/navigation.js'), 'utf8');

  assert.match(source, /editorRow\.append\(\.\.\.\[\.\.\.sourceRow\.children\]\);[\s\S]*?editorLabel\.replaceWith\(input\);[\s\S]*?syncNavigationPageTypeBadge\(editorRow, page\)/);
  assert.match(source, /editorRow\.append\(\.\.\.\[\.\.\.sourceRow\.children\]\);[\s\S]*?editorNameButton\.replaceWith\(input\)/);
  assert.match(source, /folderButton\.append\(disclosureButton, createNavigationRenameInput\('folder', folder\)\)/);
  assert.match(source, /if \(renaming\) \{[\s\S]*?button\.append\(createNavigationRenameInput\('page', page\)\);[\s\S]*?syncNavigationPageTypeBadge\(button, page\);[\s\S]*?if \(renaming\) return button;/);
  assert.match(source, /if \(navigationRenameSession \|\| folderRenameState \|\| pageRenameState\) \{[\s\S]*?refreshMountedNavigationPageTypeBadges\(\);[\s\S]*?return;/);
});
