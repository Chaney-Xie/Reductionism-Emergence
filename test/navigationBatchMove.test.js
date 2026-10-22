const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createNavigationModel } = require('../server/navigationModel');

const model = createNavigationModel({
  pagesDir: path.join(__dirname, 'unused-pages'),
  pageDateStamp: () => '20260717'
});

function pageIndex() {
  return {
    pages: ['page_1', 'page_2', 'page_3', 'page_4', 'page_5', 'page_6']
      .map((id) => ({ id, title: id, path: `pages/${id}.json`, categories: ['category_1'] }))
  };
}

function folder(id, pageIds = [], children = []) {
  return {
    id,
    label: id,
    type: 'manual',
    collapsed: false,
    source: { kind: 'manual', pageIds },
    children
  };
}

function navigation() {
  return model.normalizeNavigation({
    version: 2,
    folders: [
      folder('folder_a', ['page_1', 'page_2'], [folder('folder_b', ['page_3'])]),
      folder('folder_c', ['page_4']),
      folder('folder_d')
    ],
    items: ['page_5', 'page_6']
  }, pageIndex());
}

function findFolder(tree, id) {
  return model.findFolderLocation(tree.folders, id)?.folder || null;
}

test('navigation selection supports page, folder, and mixed batches while normalizing descendants', () => {
  const tree = navigation();
  const pages = model.normalizeNavigationMoveSelection(tree, pageIndex(), [
    { type: 'page', id: 'page_1' },
    { type: 'page', id: 'page_2' }
  ]);
  assert.deepEqual(pages.items.map((item) => item.id), ['page_1', 'page_2']);

  const folders = model.normalizeNavigationMoveSelection(tree, pageIndex(), [
    { type: 'folder', id: 'folder_c' },
    { type: 'folder', id: 'folder_d' }
  ]);
  assert.deepEqual(folders.items.map((item) => item.id), ['folder_c', 'folder_d']);

  const mixed = model.normalizeNavigationMoveSelection(tree, pageIndex(), [
    { type: 'page', id: 'page_4' },
    { type: 'folder', id: 'folder_d' }
  ]);
  assert.deepEqual(mixed.items, [
    { type: 'page', id: 'page_4' },
    { type: 'folder', id: 'folder_d' }
  ]);

  const parentAndDescendants = model.normalizeNavigationMoveSelection(tree, pageIndex(), [
    { type: 'page', id: 'page_3' },
    { type: 'folder', id: 'folder_b' },
    { type: 'folder', id: 'folder_a' }
  ]);
  assert.deepEqual(parentAndDescendants.items, [{ type: 'folder', id: 'folder_a' }]);
});

test('batch move preserves visible order and IDs without mutating the source tree', () => {
  const source = navigation();
  const before = JSON.stringify(source);
  const moved = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'page', id: 'page_2' },
    { type: 'page', id: 'page_1' },
    { type: 'folder', id: 'folder_d' }
  ], { parentFolderId: 'folder_c' });

  assert.equal(moved.error, null);
  assert.equal(moved.changed, true);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(findFolder(moved.navigation, 'folder_c').source.pageIds, [
    'page_4', 'page_1', 'page_2'
  ]);
  assert.deepEqual(findFolder(moved.navigation, 'folder_c').children.map((item) => item.id), [
    'folder_d'
  ]);
  assert.ok(findFolder(moved.navigation, 'folder_d'));
});

test('invalid descendant destination rejects the complete batch atomically', () => {
  const source = navigation();
  const before = JSON.stringify(source);
  const moved = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'folder', id: 'folder_a' },
    { type: 'page', id: 'page_4' }
  ], { parentFolderId: 'folder_b' });
  assert.match(moved.error, /descendant/);
  assert.equal(moved.changed, false);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(moved.navigation, source);
});

test('root batch move works and menu/drag destinations produce the same tree', () => {
  const source = navigation();
  const items = [
    { type: 'page', id: 'page_1' },
    { type: 'folder', id: 'folder_b' }
  ];
  const menu = model.moveNavigationSelection(source, pageIndex(), items, {
    parentFolderId: 'folder_d'
  });
  const drag = model.moveNavigationSelection(source, pageIndex(), items, {
    parentFolderId: 'folder_d', index: null
  });
  assert.deepEqual(drag.navigation, menu.navigation);

  const root = model.moveNavigationSelection(menu.navigation, pageIndex(), items, {
    parentFolderId: null
  });
  assert.equal(root.error, null);
  assert.ok(root.navigation.items.includes('page_1'));
  assert.ok(root.navigation.folders.some((item) => item.id === 'folder_b'));

  const rootFolderNoOp = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'folder', id: 'folder_a' }
  ], { parentFolderId: null });
  assert.equal(rootFolderNoOp.changed, false);
  assert.deepEqual(rootFolderNoOp.navigation, source);
});

test('unindexed membership moves are stationary inside the current container', async () => {
  const source = navigation();
  const cases = [
    {
      label: 'root Page',
      items: [{ type: 'page', id: 'page_5' }],
      destination: { parentFolderId: null }
    },
    {
      label: 'Page in manual Folder',
      items: [{ type: 'page', id: 'page_1' }],
      destination: { parentFolderId: 'folder_a' }
    },
    {
      label: 'root Folder',
      items: [{ type: 'folder', id: 'folder_a' }],
      destination: { parentFolderId: null }
    },
    {
      label: 'nested Folder in its parent',
      items: [{ type: 'folder', id: 'folder_b' }],
      destination: { parentFolderId: 'folder_a' }
    }
  ];

  for (const { label, items, destination } of cases) {
    const moved = model.moveNavigationSelection(source, pageIndex(), items, destination);
    assert.equal(moved.error, null, label);
    assert.equal(moved.changed, false, label);
    assert.deepEqual(moved.items, [], label);
    assert.deepEqual(moved.navigation, source, label);
  }

  let writes = 0;
  const persisted = await model.persistNavigationMove(
    source,
    pageIndex(),
    [{ type: 'page', id: 'page_5' }],
    { parentFolderId: null },
    async (next) => { writes += 1; return next; }
  );
  assert.equal(persisted.changed, false);
  assert.deepEqual(persisted.items, []);
  assert.equal(writes, 0);
  assert.deepEqual(persisted.navigation, source);
});

test('mixed membership moves leave stationary selections in place', () => {
  const source = navigation();
  const moved = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'page', id: 'page_5' },
    { type: 'page', id: 'page_1' }
  ], { parentFolderId: null });

  assert.equal(moved.error, null);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.items, [{ type: 'page', id: 'page_1' }]);
  assert.deepEqual(moved.navigation.items, ['page_5', 'page_6', 'page_1']);
  assert.deepEqual(findFolder(moved.navigation, 'folder_a').source.pageIds, ['page_2']);
  assert.deepEqual(source.items, ['page_5', 'page_6']);
  assert.deepEqual(findFolder(source, 'folder_a').source.pageIds, ['page_1', 'page_2']);
});

test('membership move preserves a collapsed destination and Binding ownership metadata', () => {
  const source = model.normalizeNavigation({
    version: 3,
    folders: [
      { ...folder('folder_a', ['page_1', 'page_2']), collapsed: false },
      { ...folder('folder_c', ['page_4']), collapsed: true }
    ],
    items: ['page_5', 'page_6'],
    bindings: [{
      id: 'binding_1',
      leaderPageId: 'page_1',
      followerPageIds: ['page_2']
    }]
  }, pageIndex());
  const before = JSON.stringify(source);

  const moved = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'page', id: 'page_1' }
  ], { parentFolderId: 'folder_c' });

  assert.equal(moved.error, null);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.items, [{ type: 'page', id: 'page_1' }]);
  assert.equal(findFolder(moved.navigation, 'folder_c').collapsed, true);
  assert.deepEqual(findFolder(moved.navigation, 'folder_c').source.pageIds, [
    'page_4', 'page_1'
  ]);
  assert.deepEqual(moved.navigation.bindings, source.bindings);
  assert.equal(JSON.stringify(source), before, 'presentation and commit keep the source snapshot immutable');
});

test('an explicit index retains the generic backend sibling-order primitive', () => {
  const source = navigation();
  const moved = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'page', id: 'page_1' }
  ], {
    parentFolderId: 'folder_a',
    area: 'pages',
    index: 2
  });

  assert.equal(moved.error, null);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.items, [{ type: 'page', id: 'page_1' }]);
  assert.deepEqual(findFolder(moved.navigation, 'folder_a').source.pageIds, [
    'page_2', 'page_1'
  ]);
  assert.deepEqual(findFolder(source, 'folder_a').source.pageIds, ['page_1', 'page_2']);
});

test('batch persistence writes once and injected failure leaves the original recoverable', async () => {
  const source = navigation();
  const before = JSON.stringify(source);
  let writes = 0;
  const moved = await model.persistNavigationMove(
    source,
    pageIndex(),
    [{ type: 'page', id: 'page_1' }, { type: 'page', id: 'page_2' }],
    { parentFolderId: 'folder_c' },
    async (next) => { writes += 1; return next; }
  );
  assert.equal(moved.changed, true);
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(source), before);

  await assert.rejects(model.persistNavigationMove(
    source,
    pageIndex(),
    [{ type: 'page', id: 'page_1' }],
    { parentFolderId: 'folder_c' },
    async () => { throw new Error('injected navigation write failure'); }
  ), /injected navigation write failure/);
  assert.equal(JSON.stringify(source), before);
});
