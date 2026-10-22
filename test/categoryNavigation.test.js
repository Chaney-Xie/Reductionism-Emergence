const test = require('node:test');
const assert = require('node:assert/strict');
const categoryNavigation = require('../public/categoryNavigation');
const { createNavigationModel } = require('../server/navigationModel');
const navigationProjection = require('../server/navigationProjection');

function categoryConfig() {
  return {
    groups: [{
      id: 'level', label: 'Level', children: [
        { type: 'item', id: 'single', label: 'SingleProcess' },
        { type: 'item', id: 'terminal', label: 'Terminal' }
      ]
    }],
    navigation: {
      enabledCategoryIds: ['terminal', 'missing', 'single'],
      collapseUncategorisedPages: false,
      quantityStatistics: true
    }
  };
}

test('Category navigation settings validate IDs and retain hierarchy order', () => {
  const normalized = categoryNavigation.normalizeCategoryConfiguration(categoryConfig());
  assert.deepEqual(normalized.navigation, {
    enabledCategoryIds: ['single', 'terminal'],
    collapseUncategorisedPages: false,
    quantityStatistics: true
  });
  assert.deepEqual(categoryNavigation.normalizeCategoryConfiguration({ groups: categoryConfig().groups }).navigation, {
    enabledCategoryIds: [],
    collapseUncategorisedPages: true,
    quantityStatistics: false
  });
});

test('materialized Category folders follow configured order, preserve disclosure, and preserve manual membership', () => {
  const navigation = {
    version: 2,
    folders: [
      {
        id: 'folder_uncategorised', label: 'Old label', type: 'system', collapsed: false,
        source: { kind: 'missingCategories' }, children: []
      },
      {
        id: 'folder_category_single', label: 'Stale', type: 'system', collapsed: false,
        source: { kind: 'categoryAny', categoryIds: ['single'] }, children: []
      },
      {
        id: 'folder_manual', label: 'Manual', type: 'manual', collapsed: false,
        source: { kind: 'manual', pageIds: ['page_both'] }, children: []
      }
    ],
    items: ['page_root']
  };
  const synced = navigationProjection.rebuild({
    navigation,
    categoryConfig: categoryConfig(),
    pageIndex: { pages: [] }
  }).navigation;
  assert.deepEqual(synced.folders.map((folder) => folder.id), [
    'folder_uncategorised', 'folder_category_single', 'folder_category_terminal', 'folder_manual'
  ]);
  assert.equal(synced.folders[0].label, 'Uncategory');
  assert.equal(synced.folders[0].collapsed, false);
  assert.equal(synced.folders[1].collapsed, false);
  assert.equal(synced.folders[2].collapsed, true);
  assert.equal(synced.folders[0].excludeFromRoot, false);
  assert.equal(synced.folders[1].excludeFromRoot, true);
  assert.deepEqual(synced.folders[0].projectedPageIds, []);
  assert.deepEqual(synced.folders[1].projectedPageIds, []);
  assert.deepEqual(synced.folders[3].source.pageIds, ['page_both']);

  const disabled = navigationProjection.rebuild({
    navigation: synced,
    categoryConfig: {
      ...categoryConfig(), navigation: { enabledCategoryIds: ['single'] }
    },
    pageIndex: { pages: [] }
  }).navigation;
  assert.equal(disabled.folders.some((folder) => folder.id === 'folder_category_terminal'), false);
  assert.deepEqual(disabled.folders.at(-1).source.pageIds, ['page_both']);
  assert.deepEqual(disabled.dynamicProjection.folderPresentation['category:terminal'], {
    id: 'folder_category_terminal', collapsed: true
  });
});

test('one Page may appear once in multiple dynamic groups without leaving its manual folder', () => {
  const model = createNavigationModel({ pagesDir: '/tmp/viewer-category-navigation-pages', pageDateStamp: () => '20260720' });
  const pageIndex = {
    pages: [
      { id: 'page_both', categories: ['single', 'terminal'] },
      { id: 'page_single', categories: ['single'] },
      { id: 'page_other', categories: ['other'] },
      { id: 'page_none', categories: [] }
    ]
  };
  const navigation = navigationProjection.rebuild({
    navigation: {
      version: 2,
      folders: [{
        id: 'folder_manual', label: 'Manual', type: 'manual',
        source: { kind: 'manual', pageIds: ['page_both'] }, children: []
      }],
      items: ['page_both', 'page_single', 'page_other', 'page_none']
    },
    categoryConfig: categoryConfig(),
    pageIndex
  }).navigation;
  const singleFolder = navigation.folders.find((folder) => folder.source?.categoryIds?.[0] === 'single');
  const terminalFolder = navigation.folders.find((folder) => folder.source?.categoryIds?.[0] === 'terminal');
  const manualFolder = navigation.folders.find((folder) => folder.id === 'folder_manual');
  assert.deepEqual(model.resolveFolderPageIds(singleFolder, pageIndex), ['page_both', 'page_single']);
  assert.deepEqual(model.resolveFolderPageIds(terminalFolder, pageIndex), ['page_both']);
  assert.deepEqual(model.resolveFolderPageIds(manualFolder, pageIndex), ['page_both']);
  const normalized = model.normalizeNavigation(navigation, pageIndex);
  assert.deepEqual(normalized.items, ['page_other', 'page_none']);
  assert.deepEqual(
    model.resolveFolderPageIds(
      normalized.folders.find((folder) => folder.id === 'folder_uncategorised'),
      pageIndex
    ),
    ['page_none']
  );
});

test('Uncategory folding is independent from enabled Category group folding', () => {
  const model = createNavigationModel({
    pagesDir: '/tmp/viewer-category-navigation-pages', pageDateStamp: () => '20260724'
  });
  const pageIndex = {
    pages: [
      { id: 'page_none', categoryIds: [] },
      { id: 'page_terminal', categoryIds: ['terminal'] },
      { id: 'page_disabled', categoryIds: ['other'] },
      { id: 'page_both', categoryIds: ['single', 'terminal'] }
    ]
  };
  const baseNavigation = {
    version: 2,
    folders: [{
      id: 'folder_uncategorised', label: 'Uncategory', type: 'system', collapsed: false,
      excludeFromRoot: true, source: { kind: 'missingCategories' }, children: []
    }],
    items: pageIndex.pages.map((page) => page.id)
  };
  const configOff = {
    ...categoryConfig(),
    navigation: {
      ...categoryConfig().navigation,
      enabledCategoryIds: ['single', 'terminal'],
      collapseUncategorisedPages: false
    }
  };
  const off = model.normalizeNavigation(navigationProjection.rebuild({
    navigation: baseNavigation, categoryConfig: configOff, pageIndex
  }).navigation, pageIndex);
  assert.deepEqual(off.items, ['page_none', 'page_disabled']);
  const offUncategory = off.folders.find((folder) => folder.id === 'folder_uncategorised');
  assert.equal(offUncategory.excludeFromRoot, false);
  assert.equal(offUncategory.collapsed, false);
  assert.deepEqual(model.resolveFolderPageIds(offUncategory, pageIndex), ['page_none']);
  assert.deepEqual(
    model.resolveFolderPageIds(
      off.folders.find((folder) => folder.source?.categoryIds?.[0] === 'terminal'),
      pageIndex
    ),
    ['page_terminal', 'page_both']
  );
  assert.deepEqual(
    model.resolveFolderPageIds(
      off.folders.find((folder) => folder.source?.categoryIds?.[0] === 'single'),
      pageIndex
    ),
    ['page_both']
  );

  const configOn = {
    ...configOff,
    navigation: { ...configOff.navigation, collapseUncategorisedPages: true }
  };
  const on = model.normalizeNavigation(navigationProjection.rebuild({
    navigation: off, categoryConfig: configOn, pageIndex
  }).navigation, pageIndex);
  assert.deepEqual(on.items, ['page_disabled']);
  assert.equal(on.folders[0].excludeFromRoot, true);
  assert.equal(on.folders[0].collapsed, false, 'the persisted disclosure state is independent');

  const offAgain = model.normalizeNavigation(navigationProjection.rebuild({
    navigation: on, categoryConfig: configOff, pageIndex
  }).navigation, pageIndex);
  assert.deepEqual(offAgain.items, ['page_disabled', 'page_none']);
  assert.equal(offAgain.folders[0].collapsed, false);
});
