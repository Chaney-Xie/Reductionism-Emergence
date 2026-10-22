const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const {
  buildNativeContextMenuTemplate,
  validContextMenuRequest
} = require('../desktop/nativeContextMenu');

function template(context) {
  const commands = [];
  const items = buildNativeContextMenuTemplate(context, (commandId) => commands.push(commandId));
  return { items, commands };
}

function visibleLabels(items) {
  return items.filter((item) => item.visible !== false).map((item) => (
    item.type === 'separator' ? '---' : item.label
  ));
}

function itemByLabel(items, label) {
  return items.find((item) => item.label === label);
}

function submenuLabels(items, label) {
  return visibleLabels(itemByLabel(items, label)?.submenu || []);
}

test('native context requests accept only fixed context types and bounded structured state', () => {
  assert.equal(validContextMenuRequest(null), null);
  assert.equal(validContextMenuRequest({ type: 'arbitrary', targetId: 'x' }), null);
  assert.equal(validContextMenuRequest({ type: 'block', targetId: '' }), null);
  assert.equal(validContextMenuRequest({ type: 'block', targetId: 'block_1' })?.type, 'block');
  assert.deepEqual(validContextMenuRequest({
    type: 'block-colour-preset',
    targetId: '  preset_stable_1  ',
    template: [{ label: 'Injected', click: 'code' }]
  }), {
    type: 'block-colour-preset',
    targetId: 'preset_stable_1',
    selectedCount: 1,
    selectedPageCount: 1,
    canSetDefault: false,
    isDefault: false,
    isPinned: false,
    synthetic: false,
    bindingRole: 'unbound',
    canBindToLeader: false,
    canStopBinding: false,
    canSetBindingLeader: false,
    canMoveNavigation: true,
    canStickNavigation: true,
    canOpen: false,
    canToggleVisibility: false,
    isVisible: true,
    relationCount: 1,
    dictionaryAvailable: true,
    isAlias: false,
    canMove: false,
    deleteEnabled: true,
    canBringForward: false,
    canBringToFront: false,
    canSendBackward: false,
    canSendToBack: false
  });
  const request = validContextMenuRequest({
    type: 'navigation-page', targetId: 'page_1', selectedCount: 4, selectedPageCount: 3,
    canSetDefault: true, isDefault: true, isPinned: true,
    template: [{ label: 'Injected', click: 'code' }]
  });
  assert.deepEqual(request, {
    type: 'navigation-page', targetId: 'page_1', selectedCount: 4, selectedPageCount: 3,
    canSetDefault: true, isDefault: true, isPinned: true,
    synthetic: false, bindingRole: 'unbound', canBindToLeader: false,
    canStopBinding: false, canSetBindingLeader: false, canMoveNavigation: true,
    canStickNavigation: true,
    canOpen: false, canToggleVisibility: false, isVisible: true,
    relationCount: 1, dictionaryAvailable: true, isAlias: false, canMove: false,
    deleteEnabled: true, canBringForward: false, canBringToFront: false,
    canSendBackward: false, canSendToBack: false
  });
  assert.equal('template' in request, false);

  assert.deepEqual(validContextMenuRequest({
    type: 'tab-list',
    targetId: 'main-tab-strip',
    activeTabId: 'tab_2',
    tabs: [
      { id: 'tab_1', title: 'TCA' },
      { id: 'tab_2', title: '' },
      { id: '', title: 'Invalid' }
    ],
    template: [{ label: 'Injected' }]
  }), {
    type: 'tab-list',
    targetId: 'main-tab-strip',
    activeTabId: 'tab_2',
    tabs: [
      { id: 'tab_1', title: 'TCA' },
      { id: 'tab_2', title: 'New Tab' }
    ]
  });

  assert.deepEqual(validContextMenuRequest({
    type: 'vault-switcher',
    targetId: 'vault_2',
    vaults: [
      { vaultId: 'vault_1', displayName: 'Biochemistry' },
      { vaultId: 'vault_2', displayName: 'Protein Atlas' },
      { vaultId: '', displayName: 'Invalid' }
    ]
  }), {
    type: 'vault-switcher',
    targetId: 'vault_2',
    currentVaultId: 'vault_2',
    vaults: [
      { vaultId: 'vault_1', displayName: 'Biochemistry', open: false },
      { vaultId: 'vault_2', displayName: 'Protein Atlas', open: false }
    ]
  });

  assert.deepEqual(validContextMenuRequest({
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:2:1',
    isHeader: true,
    isFirstColumn: true,
    isTopLeft: true,
    canMoveRowUp: true,
    canMoveRowDown: true,
    canMoveColumnLeft: true,
    canMoveColumnRight: false,
    template: [{ label: 'Injected' }]
  }), {
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:2:1',
    isHeader: true,
    isFirstColumn: true,
    isTopLeft: true,
    canMoveRowUp: false,
    canMoveRowDown: false,
    canMoveColumnLeft: true,
    canMoveColumnRight: false
  });

  assert.deepEqual(validContextMenuRequest({
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:0:2',
    isHeader: false,
    isFirstColumn: false,
    isTopLeft: true
  }), {
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:0:2',
    isHeader: false,
    isFirstColumn: false,
    isTopLeft: false,
    canMoveRowUp: false,
    canMoveRowDown: false,
    canMoveColumnLeft: false,
    canMoveColumnRight: false
  }, 'top-left state cannot survive inconsistent header/first-column coordinates');
});

test('Markdown Table ordinary body-cell menu is cell-relative with exact boundary disabling', () => {
  const menu = template({
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:0:2',
    isFirstColumn: false,
    canMoveRowUp: false,
    canMoveRowDown: true,
    canMoveColumnLeft: true,
    canMoveColumnRight: false
  });
  assert.deepEqual(visibleLabels(menu.items), [
    'Align',
    '---',
    'Insert row above', 'Insert row below', 'Insert column left', 'Insert column right',
    '---',
    'Move row up', 'Move row down', 'Move column left', 'Move column right'
  ]);
  assert.deepEqual(submenuLabels(menu.items, 'Align'), ['Left', 'Centre', 'Right']);
  assert.equal(menu.items[7].enabled, false);
  assert.equal(menu.items[8].enabled, true);
  assert.equal(menu.items[9].enabled, true);
  assert.equal(menu.items[10].enabled, false);
  assert.equal(visibleLabels(menu.items).some((label) => /sort/i.test(label)), false);

  itemByLabel(menu.items, 'Align').submenu[0].click();
  itemByLabel(menu.items, 'Insert row above').click();
  itemByLabel(menu.items, 'Insert column right').click();
  itemByLabel(menu.items, 'Move row down').click();
  itemByLabel(menu.items, 'Move column left').click();
  assert.deepEqual(menu.commands, [
    'align-table-column-left',
    'insert-table-row-above',
    'insert-table-column-right',
    'move-table-row-down',
    'move-table-column-left'
  ]);
});

test('Markdown Table first-column body cell adds only the explicit row-keyed column sorts', () => {
  const menu = template({
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:2:0',
    isFirstColumn: true,
    canMoveRowUp: true,
    canMoveRowDown: false,
    canMoveColumnLeft: false,
    canMoveColumnRight: true
  });
  assert.deepEqual(visibleLabels(menu.items), [
    'Align',
    '---',
    'Insert row above', 'Insert row below', 'Insert column left', 'Insert column right',
    '---',
    'Move row up', 'Move row down', 'Move column left', 'Move column right',
    '---',
    'Sort columns by this row'
  ]);
  assert.equal(itemByLabel(menu.items, 'Move row up').enabled, true);
  assert.equal(itemByLabel(menu.items, 'Move row down').enabled, false);
  assert.equal(itemByLabel(menu.items, 'Move column left').enabled, false);
  assert.equal(itemByLabel(menu.items, 'Move column right').enabled, true);
  assert.deepEqual(submenuLabels(menu.items, 'Sort columns by this row'), [
    'Alphabetical A → Z',
    'Alphabetical Z → A',
    'Numeric ascending',
    'Numeric descending'
  ]);

  itemByLabel(menu.items, 'Sort columns by this row').submenu.forEach((item) => item.click());
  assert.deepEqual(menu.commands, [
    'sort-table-columns-alpha-asc',
    'sort-table-columns-alpha-desc',
    'sort-table-columns-numeric-asc',
    'sort-table-columns-numeric-desc'
  ]);
});

test('Markdown Table non-axis Header cell permits row insertion below and row sorting only', () => {
  const menu = template({
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:header:2',
    isHeader: true,
    isFirstColumn: false,
    isTopLeft: false,
    canMoveRowUp: true,
    canMoveRowDown: true,
    canMoveColumnLeft: true,
    canMoveColumnRight: false
  });
  assert.deepEqual(visibleLabels(menu.items), [
    'Align',
    '---',
    'Insert row below', 'Insert column left', 'Insert column right',
    '---',
    'Move column left', 'Move column right',
    '---',
    'Sort rows by this column'
  ]);
  assert.equal(itemByLabel(menu.items, 'Move column left').enabled, true);
  assert.equal(itemByLabel(menu.items, 'Move column right').enabled, false);
  assert.equal(itemByLabel(menu.items, 'Insert row above'), undefined);
  assert.equal(itemByLabel(menu.items, 'Move row up'), undefined);
  assert.equal(itemByLabel(menu.items, 'Move row down'), undefined);
  assert.equal(itemByLabel(menu.items, 'Sort columns by Header row'), undefined);
  assert.deepEqual(submenuLabels(menu.items, 'Sort rows by this column'), [
    'Alphabetical A → Z',
    'Alphabetical Z → A',
    'Numeric ascending',
    'Numeric descending'
  ]);

  itemByLabel(menu.items, 'Align').submenu[1].click();
  itemByLabel(menu.items, 'Insert row below').click();
  itemByLabel(menu.items, 'Insert column left').click();
  itemByLabel(menu.items, 'Move column right').click();
  itemByLabel(menu.items, 'Sort rows by this column').submenu.forEach((item) => item.click());
  assert.deepEqual(menu.commands, [
    'align-table-column-centre',
    'insert-table-row-below',
    'insert-table-column-left',
    'move-table-column-right',
    'sort-table-rows-alpha-asc',
    'sort-table-rows-alpha-desc',
    'sort-table-rows-numeric-asc',
    'sort-table-rows-numeric-desc'
  ]);
});

test('Markdown Table top-left Header cell exposes both explicitly named axis sorts', () => {
  const menu = template({
    type: 'markdown-table-cell',
    targetId: 'pane_1:page_1:120:header:0',
    isHeader: true,
    isFirstColumn: true,
    isTopLeft: true,
    canMoveColumnLeft: false,
    canMoveColumnRight: true
  });
  assert.deepEqual(visibleLabels(menu.items), [
    'Align',
    '---',
    'Insert row below', 'Insert column left', 'Insert column right',
    '---',
    'Move column left', 'Move column right',
    '---',
    'Sort rows by first column',
    'Sort columns by Header row'
  ]);
  assert.equal(itemByLabel(menu.items, 'Insert row above'), undefined);
  assert.equal(itemByLabel(menu.items, 'Move row up'), undefined);
  assert.deepEqual(submenuLabels(menu.items, 'Sort rows by first column'), [
    'Alphabetical A → Z',
    'Alphabetical Z → A',
    'Numeric ascending',
    'Numeric descending'
  ]);
  assert.deepEqual(
    submenuLabels(menu.items, 'Sort columns by Header row'),
    submenuLabels(menu.items, 'Sort rows by first column')
  );

  itemByLabel(menu.items, 'Sort rows by first column').submenu[0].click();
  itemByLabel(menu.items, 'Sort columns by Header row').submenu[3].click();
  assert.deepEqual(menu.commands, [
    'sort-table-rows-alpha-asc',
    'sort-table-columns-numeric-desc'
  ]);
});

test('Vault switcher is a native stable-ID menu with management actions below the Vault list', () => {
  const menu = template({
    type: 'vault-switcher',
    targetId: 'vault_2',
    vaults: [
      { vaultId: 'vault_1', displayName: 'Biochemistry', open: true },
      { vaultId: 'vault_2', displayName: 'Protein Atlas', open: true }
    ]
  });
  assert.deepEqual(visibleLabels(menu.items), [
    'Biochemistry', 'Protein Atlas', '---', '+ Add New Vault', 'Vault Settings…'
  ]);
  assert.equal(menu.items[0].type, 'radio');
  assert.equal(menu.items[0].checked, false);
  assert.equal(menu.items[0].sublabel, 'Open');
  assert.equal(menu.items[1].checked, true);
  menu.items[0].click();
  menu.items[3].click();
  menu.items[4].click();
  assert.deepEqual(menu.commands, [
    'switch-vault:vault_1', 'add-new-vault', 'open-vault-settings'
  ]);
});

test('Tab-list menu uses native radio state and stable Tab commands in displayed order', () => {
  const menu = template({
    type: 'tab-list',
    targetId: 'main-tab-strip',
    activeTabId: 'tab_2',
    tabs: [
      { id: 'tab_1', title: 'D-Glucose' },
      { id: 'tab_2', title: 'D-Glucose' },
      { id: 'tab_3', title: 'New Tab' }
    ]
  });
  assert.deepEqual(visibleLabels(menu.items), [
    'Close All Tabs', '---', 'D-Glucose', 'D-Glucose', 'New Tab'
  ]);
  assert.equal(menu.items[2].type, 'radio');
  assert.equal(menu.items[2].checked, false);
  assert.equal(menu.items[3].checked, true);
  menu.items[0].click();
  menu.items[4].click();
  assert.deepEqual(menu.commands, ['close-all-tabs', 'activate-tab:tab_3']);
});

test('navigation Page, Folder, and batch menus retain commands and native checked state', () => {
  const background = template({ type: 'navigation-background', targetId: 'navigation-root' });
  assert.deepEqual(visibleLabels(background.items), ['New Page', 'New Folder']);
  background.items[0].click();
  background.items[1].click();
  assert.deepEqual(background.commands, ['new-page', 'new-folder']);

  const page = template({
    type: 'navigation-page', targetId: 'page_1', selectedCount: 3, selectedPageCount: 3,
    canSetDefault: true, isDefault: true, isPinned: true
  });
  assert.deepEqual(visibleLabels(page.items), [
    'Open in New Tab', '---', 'Edit Category', 'Set as default',
    'Stick on top', 'Move…', 'Delete'
  ]);
  assert.equal(page.items[4].type, 'checkbox');
  assert.equal(page.items[4].checked, true);
  assert.equal(page.items[5].type, 'checkbox');
  itemByLabel(page.items, 'Move…').click();
  assert.deepEqual(page.commands, ['move-navigation']);

  const synthetic = template({ type: 'navigation-page', targetId: 'page_2', synthetic: true });
  assert.deepEqual(visibleLabels(synthetic.items), ['Open in New Tab', '---', 'Move…', 'Delete']);

  const mixedSelection = template({
    type: 'navigation-page', targetId: 'page_1', selectedCount: 4, selectedPageCount: 2
  });
  assert.equal(visibleLabels(mixedSelection.items).includes('Rename'), false);
  assert.equal(visibleLabels(mixedSelection.items).includes('Edit Category'), true);
  const onePageSelection = template({
    type: 'navigation-page', targetId: 'page_1', selectedCount: 4, selectedPageCount: 1
  });
  assert.equal(visibleLabels(onePageSelection.items).includes('Edit Category'), false);
  assert.equal(visibleLabels(onePageSelection.items).includes('Rename'), false);

  const oneSelectedItem = template({
    type: 'navigation-page', targetId: 'page_1', selectedCount: 1, selectedPageCount: 1
  });
  assert.equal(visibleLabels(oneSelectedItem.items).includes('Rename'), true);

  const folder = template({ type: 'navigation-folder', targetId: 'folder_1', isPinned: true });
  assert.deepEqual(visibleLabels(folder.items), [
    'New Folder', 'New Page', '---', 'Rename', 'Stick on top', 'Move…', 'Delete'
  ]);
  assert.equal(folder.items[4].checked, true);

  const selectedFolderBatch = template({
    type: 'navigation-folder', targetId: 'folder_1', selectedCount: 3, isPinned: false
  });
  assert.equal(visibleLabels(selectedFolderBatch.items).includes('Rename'), false);
});

test('navigation Page menu exposes only the v1 Binding commands allowed by role facts', () => {
  const unbound = template({
    type: 'navigation-page', targetId: 'page_unbound', canBindToLeader: true
  });
  assert.equal(visibleLabels(unbound.items).includes('Bind to Leader'), true);
  assert.equal(visibleLabels(unbound.items).includes('Stop Binding'), false);
  itemByLabel(unbound.items, 'Bind to Leader').click();
  assert.deepEqual(unbound.commands, ['bind-to-leader']);

  const follower = template({
    type: 'navigation-page', targetId: 'page_follower', bindingRole: 'follower',
    canStopBinding: true, canSetBindingLeader: true, canMoveNavigation: false,
    canStickNavigation: false
  });
  assert.equal(visibleLabels(follower.items).includes('Bind to Leader'), false);
  assert.equal(visibleLabels(follower.items).includes('Stop Binding'), true);
  assert.equal(visibleLabels(follower.items).includes('Set as Leader'), true);
  assert.equal(visibleLabels(follower.items).includes('Move…'), false);
  assert.equal(visibleLabels(follower.items).includes('Stick on top'), false);
  itemByLabel(follower.items, 'Stop Binding').click();
  itemByLabel(follower.items, 'Set as Leader').click();
  assert.deepEqual(follower.commands, ['stop-binding', 'set-binding-leader']);

  const leader = template({
    type: 'navigation-page', targetId: 'page_leader', bindingRole: 'leader'
  });
  assert.equal(visibleLabels(leader.items).includes('Bind to Leader'), false);
  assert.equal(visibleLabels(leader.items).includes('Stop Binding'), false);
  assert.equal(visibleLabels(leader.items).includes('Set as Leader'), false);
  assert.equal(visibleLabels(leader.items).includes('Move…'), true);

  const mixedFolderSelection = template({
    type: 'navigation-folder', targetId: 'folder_1', selectedCount: 2,
    canMoveNavigation: false, canStickNavigation: false
  });
  assert.equal(visibleLabels(mixedFolderSelection.items).includes('Move…'), false);
  assert.equal(visibleLabels(mixedFolderSelection.items).includes('Stick on top'), false);
});

test('normal Block context menu exposes only the existing Add Link flow', () => {
  const block = template({ type: 'block', targetId: 'block_1' });
  assert.deepEqual(visibleLabels(block.items), ['Add Link']);
  block.items[0].click();
  assert.deepEqual(block.commands, ['add-block-link']);
});

test('Block colour preset menu exposes only Delete Colour and Preview for its stable preset ID', () => {
  const preset = template({ type: 'block-colour-preset', targetId: 'preset_stable_1' });
  assert.deepEqual(visibleLabels(preset.items), ['Delete Colour', 'Preview']);
  preset.items[0].click();
  preset.items[1].click();
  assert.deepEqual(preset.commands, ['delete-colour', 'preview-colour']);
});

test('Block Edit native menu exposes local layer commands and Delete', () => {
  const block = template({
    type: 'block-edit', targetId: 'block_1',
    canBringForward: false, canBringToFront: false,
    canSendBackward: true, canSendToBack: true
  });
  assert.deepEqual(visibleLabels(block.items), [
    'Bring Forward', 'Bring to Front', 'Send Backward', 'Send to Back', '---', 'Delete'
  ]);
  assert.equal(block.items[0].enabled, false);
  assert.equal(block.items[2].enabled, true);
  block.items[3].click();
  block.items[5].click();
  assert.deepEqual(block.commands, ['send-to-back', 'delete-block']);
});

test('Page Object context menu exposes fixed layer commands with boundary disabling', () => {
  const object = template({
    type: 'page-object', targetId: 'object_1',
    canBringForward: true, canBringToFront: true,
    canSendBackward: false, canSendToBack: false
  });
  assert.deepEqual(visibleLabels(object.items), [
    'Bring Forward', 'Bring to Front', 'Send Backward', 'Send to Back'
  ]);
  assert.equal(object.items[0].enabled, true);
  assert.equal(object.items[2].enabled, false);
  object.items[1].click();
  assert.deepEqual(object.commands, ['bring-to-front']);
});

test('Maintenance, Relation, Descriptor, and Dictionary use fixed native templates', () => {
  const resource = template({
    type: 'maintenance-resource', targetId: 'resource_1',
    canOpen: true, canToggleVisibility: true, isVisible: false
  });
  assert.deepEqual(visibleLabels(resource.items), [
    'Open', 'Reveal in Finder', '---', 'Show', 'Delete'
  ]);
  assert.equal(resource.items[3].enabled, true);

  assert.deepEqual(visibleLabels(template({
    type: 'external-link', targetId: 'external_1'
  }).items), ['Open', 'Edit', '---', 'Delete']);

  assert.deepEqual(visibleLabels(template({
    type: 'relation', targetId: 'relation_1', relationCount: 3
  }).items), ['Delete all 3 links']);

  const descriptor = template({
    type: 'descriptor-entry', targetId: 'descriptor_1', dictionaryAvailable: false
  });
  assert.deepEqual(visibleLabels(descriptor.items), [
    'Rename', 'Delete', 'Link to existing word', 'Move'
  ]);
  assert.equal(descriptor.items[0].enabled, false);
  assert.deepEqual(visibleLabels(template({
    type: 'descriptor-exclude', targetId: 'descriptor_1'
  }).items), ['Exclude from this class']);
  assert.deepEqual(visibleLabels(template({
    type: 'descriptor-group', targetId: 'group_1'
  }).items), ['Rename', 'Move', 'Delete']);

  const alias = template({
    type: 'dictionary-entry', targetId: 'word_1', isAlias: true, canMove: true
  });
  assert.deepEqual(visibleLabels(alias.items), [
    'Rename', 'Set as display word', 'Set as another word', 'Move to...', 'Delete alias'
  ]);
});

test('Electron owns menu construction, popup, and command return through one narrow bridge', async () => {
  const root = path.join(__dirname, '..');
  const [main, preload, index, vocabulary, styles, vocabularyStyles, rendererBridge] = await Promise.all([
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/vocabulary.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/vocabulary.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/nativeContextMenu.js'), 'utf8')
  ]);
  assert.match(main, /Menu\.buildFromTemplate\(template\)/);
  assert.match(main, /menu\.popup\(\{ window, callback:/);
  assert.match(preload, /showContextMenu: \(context\) => ipcRenderer\.invoke\('cne-desktop:show-context-menu', context\)/);
  assert.match(rendererBridge, /cneDesktop\?\.showContextMenu/);
  assert.doesNotMatch(index, /id="(?:page|folder|relation|resource|descriptor)-context-menu"/);
  assert.doesNotMatch(vocabulary, /id="alias-context-menu"/);
  assert.doesNotMatch(styles, /\.(?:page|resource|descriptor)-context-menu/);
  assert.doesNotMatch(vocabularyStyles, /\.alias-context-menu/);
});
