const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createNavigationModel } = require('../server/navigationModel');
const navigationSort = require('../public/navigationSort');

const model = createNavigationModel({
  pagesDir: path.join(__dirname, 'fixtures/pages'),
  pageDateStamp: () => '20260717'
});

function pageIndex() {
  return {
    pages: [
      { id: 'page_1', title: 'Page 1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'page_2', title: 'Page 2', updatedAt: '2026-03-01T00:00:00.000Z' },
      { id: 'page_3', title: 'Page 3', updatedAt: '2026-02-01T00:00:00.000Z' }
    ]
  };
}

function folder(id, pageIds = [], extra = {}) {
  return {
    id,
    label: id,
    type: 'manual',
    collapsed: false,
    source: { kind: 'manual', pageIds },
    children: [],
    ...extra
  };
}

test('navigation normalization owns one valid default and independent folder/page pin states', () => {
  const normalized = model.normalizeNavigation({
    version: 2,
    folders: [
      folder('folder_a', ['page_1', 'page_2'], {
        defaultPageId: 'page_1',
        stickOnTop: true
      }),
      folder('folder_legacy', ['page_3']),
      {
        id: 'folder_dynamic',
        label: 'Dynamic',
        type: 'system',
        stickOnTop: true,
        defaultPageId: 'page_2',
        source: { kind: 'categoryAny', categoryIds: ['category_1'] },
        projectedPageIds: ['page_2'],
        children: []
      }
    ],
    items: [],
    pageStates: {
      page_1: { stickOnTop: true },
      page_2: { stickOnTop: false },
      missing_page: { stickOnTop: true }
    }
  }, pageIndex());
  const manual = model.findFolderLocation(normalized.folders, 'folder_a').folder;
  const legacy = model.findFolderLocation(normalized.folders, 'folder_legacy').folder;
  const dynamic = model.findFolderLocation(normalized.folders, 'folder_dynamic').folder;
  assert.equal(manual.defaultPageId, 'page_1');
  assert.equal(manual.stickOnTop, true);
  assert.equal(legacy.defaultPageId, null);
  assert.equal(legacy.stickOnTop, false);
  assert.equal(dynamic.defaultPageId, null);
  assert.equal(dynamic.stickOnTop, false);
  assert.deepEqual(normalized.pageStates, { page_1: { stickOnTop: true } });

  manual.defaultPageId = 'page_3';
  assert.equal(
    model.findFolderLocation(model.normalizeNavigation(normalized, pageIndex()).folders, 'folder_a')
      .folder.defaultPageId,
    null
  );
});

test('default, pinned, and ordinary tiers retain folder-first sorting inside each tier', () => {
  const folders = [
    { id: 'folder_z', label: 'Zulu', type: 'manual', stickOnTop: true },
    { id: 'folder_a', label: 'Alpha', type: 'manual', stickOnTop: true },
    { id: 'folder_m', label: 'Middle', type: 'manual', stickOnTop: false }
  ];
  const pages = pageIndex().pages;
  const pinned = new Set(['page_1', 'page_2']);
  const entries = navigationSort.tierNavigationEntries({
    folders,
    pages,
    mode: 'modified_desc',
    defaultPageId: 'page_1',
    isFolderPinned: (item) => item.stickOnTop,
    isPagePinned: (item) => pinned.has(item.id)
  });
  assert.deepEqual(entries.map((entry) => entry.folder?.id || entry.page?.id), [
    'page_1',
    'folder_a', 'folder_z',
    'page_2',
    'folder_m',
    'page_3'
  ]);
  assert.equal(entries.filter((entry) => entry.page?.id === 'page_1').length, 1);

  const root = navigationSort.tierNavigationEntries({
    folders: [
      { id: 'folder_system', label: 'Uncategorised', type: 'system', pinned: true },
      ...folders
    ],
    pages,
    mode: 'name_desc',
    fixedFoldersFirst: true,
    isFolderPinned: (item) => item.stickOnTop,
    isPagePinned: (item) => item.id === 'page_2'
  });
  assert.deepEqual(root.map((entry) => entry.folder?.id || entry.page?.id), [
    'folder_system', 'folder_z', 'folder_a', 'page_2', 'folder_m', 'page_3', 'page_1'
  ]);
});

test('moving a default page clears only its old default while preserving page and folder pin identity', () => {
  const source = model.normalizeNavigation({
    version: 2,
    folders: [
      folder('folder_source', ['page_1', 'page_2'], { defaultPageId: 'page_1' }),
      folder('folder_target', ['page_3']),
      folder('folder_pinned', [], { stickOnTop: true })
    ],
    items: [],
    pageStates: { page_1: { stickOnTop: true } }
  }, pageIndex());
  const moved = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'page', id: 'page_1' },
    { type: 'folder', id: 'folder_pinned' }
  ], { parentFolderId: 'folder_target' });
  assert.equal(moved.error, null);
  assert.equal(model.findFolderLocation(moved.navigation.folders, 'folder_source').folder.defaultPageId, null);
  assert.equal(model.findFolderLocation(moved.navigation.folders, 'folder_target').folder.defaultPageId, null);
  assert.equal(model.findFolderLocation(moved.navigation.folders, 'folder_target').folder.source.pageIds.includes('page_1'), true);
  assert.equal(model.pageStickOnTop(moved.navigation, 'page_1'), true);
  assert.equal(model.findFolderLocation(moved.navigation.folders, 'folder_pinned').folder.stickOnTop, true);

  const sameParent = model.moveNavigationSelection(source, pageIndex(), [
    { type: 'page', id: 'page_1' }
  ], { parentFolderId: 'folder_source' });
  assert.equal(model.findFolderLocation(sameParent.navigation.folders, 'folder_source').folder.defaultPageId, 'page_1');
});

test('removing a direct child clears its default without changing page pin state', () => {
  const navigation = model.normalizeNavigation({
    folders: [folder('folder_source', ['page_1'], { defaultPageId: 'page_1' })],
    items: [],
    pageStates: { page_1: { stickOnTop: true } }
  }, pageIndex());
  model.removePageFromManualFolders(navigation.folders, 'page_1');
  assert.equal(model.findFolderLocation(navigation.folders, 'folder_source').folder.defaultPageId, null);
  assert.equal(model.pageStickOnTop(navigation, 'page_1'), true);
});
