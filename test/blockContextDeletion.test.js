const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('Block context click selects first and uses separate native Edit and normal menus', async () => {
  const source = await fs.readFile(path.join(__dirname, '../public/app.js'), 'utf8');
  const handler = source.match(
    /async function handleBlockContextMenu\(runtime, event, blockId\) \{[\s\S]*?\n\}\n\nfunction pageHasBlockEditTarget/
  )?.[0] || '';

  assert.match(handler, /if \(runtime\.blockEditMode\) \{[\s\S]*?if \(runtime\.blockSaveInProgress\) return;/);
  assert.match(handler, /event\.preventDefault\(\);/);
  assert.match(handler, /event\.stopPropagation\(\);/);
  assert.match(handler, /setSelectedBlock\(runtime, blockId\);[\s\S]*?type: 'block-edit'/);
  assert.match(handler, /canBringForward:[\s\S]*?canSendToBack:/);
  assert.match(handler, /command === 'delete-block'\) deleteDraftBlock\(runtime, blockId\)/);
  assert.match(handler, /applyBlockLayerCommand\(runtime, blockId, command\)/);
  assert.match(handler, /type: 'block',[\s\S]*?targetId: blockId/);
  assert.match(handler, /command !== 'add-block-link'/);
  assert.match(handler, /openAddLinkPopover\([\s\S]*?runtime,[\s\S]*?freshBlock,/);
});

test('Block target choice combines current Page titles and External Link display names', async () => {
  const [app, externalLinks, server] = await Promise.all([
    fs.readFile(path.join(__dirname, '../public/app.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../public/js/externalLinks.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../server/appServer.js'), 'utf8')
  ]);

  assert.match(externalLinks, /function clickableBlockTargets\(runtime, block\)[\s\S]*?getBlockLinks\(block\)/);
  assert.match(externalLinks, /pageIndex\?\.pages\?\.find\(\(page\) => page\.id === link\.targetPageId\)\?\.title/);
  assert.match(externalLinks, /externalLinksForBlock\(runtime, block\.id\)[\s\S]*?label: link\.displayName/);
  assert.match(app, /if \(targets\.length === 1\)[\s\S]*?openMultiLinkMenu\(runtime, block, event\.currentTarget\)/);
  assert.doesNotMatch(server, /if \(block\.links\.length\) \{\s*return res\.status\(409\)\.json\(\{ error: 'This block already has a link\.'/);
});

test('Descriptor group rename uses Tool colours and suppresses row state colour until editing ends', async () => {
  const [source, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, '../public/js/descriptorModal.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8')
  ]);

  assert.match(
    source,
    /row\.classList\.toggle\('is-renaming', descriptorGroupRename\?\.groupId === groupId\);/
  );
  assert.match(
    styles,
    /\.descriptor-group-rename-input \{[^}]*--input-border-colour: var\(--border-tool\);[^}]*border: 1px solid var\(--input-border-colour\);[^}]*background: var\(--surface-tool\);/
  );
  assert.match(
    styles,
    /\.descriptor-group-row\.is-renaming,[\s\S]*?\.descriptor-group-row\.is-renaming:hover \{\s*background: transparent;/
  );
});
