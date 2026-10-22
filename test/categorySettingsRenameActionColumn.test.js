const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('Vault Category Rename uses the shared secondary action and one fixed action-column contract', async () => {
  const root = path.join(__dirname, '..');
  const [settings, css, sharedControls, html, server] = await Promise.all([
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/sharedControls.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'server/appServer.js'), 'utf8')
  ]);

  assert.match(css, /\.vault-settings-category\s*\{[^}]*--vault-category-action-column-width:\s*calc\(/);
  assert.match(
    css,
    /\.vault-category-group-header,\s*\.vault-category-item\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^}]*minmax\(0,\s*1fr\)[^}]*var\(--vault-category-action-column-width\)[^}]*var\(--vault-category-action-column-width\)/
  );
  assert.match(css, /\.vault-category-rename-action\s*\{[^}]*grid-column:\s*3/);
  assert.match(css, /\.vault-category-add-action\s*\{[^}]*grid-column:\s*2/);
  const renameLayout = css.match(/\.vault-category-rename-action\s*\{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(renameLayout, /background|border|color|font/);
  assert.match(
    sharedControls,
    /:not\(\.right-section-action\):not\(\.filter-clear-button\):is\(\.ui-outline-action, \.ui-cancel-action\)\s*\{[^}]*background:\s*var\(--control-surface\)/
  );

  assert.match(settings, /vaultCategoryRenameButton\('group', group\)/);
  assert.match(settings, /vaultCategoryRenameButton\('item', item\)/);
  assert.match(settings, /header\.append\(headerMain, addButton, vaultCategoryRenameButton\('group', group\)\)/);
  assert.match(settings, /row\.append\(rowMain, vaultCategoryRenameButton\('item', item\)\)/);
  assert.match(settings, /vaultCategoryActionButton\('New Group'/);
  assert.match(settings, /'ui-outline-action neutral-control'/);
  assert.match(settings, /categoryId:\s*node\.id/);
  assert.match(settings, /method:\s*'PATCH'[\s\S]*body:\s*JSON\.stringify\(\{ label: name \}\)/);
  assert.match(settings, /refreshOpenCategoryEditor\(\);/);
  assert.match(html, /id="vault-name-field-label">Vault name</);

  assert.match(server, /app\.patch\('\/api\/categories\/items\/:categoryId'/);
  assert.match(server, /app\.patch\('\/api\/categories\/groups\/:groupId'/);
  assert.match(server, /node\.label = label;/);
  assert.doesNotMatch(
    server.match(/async function renameCategoryDefinition[\s\S]*?\n\}/)?.[0] || '',
    /deleteCategoryDefinition|uniqueCategoryNodeId|pageRecords|writePage/
  );
});
