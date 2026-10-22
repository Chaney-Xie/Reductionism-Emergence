const test = require('node:test');
const assert = require('node:assert/strict');
const projection = require('../server/navigationProjection');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function categoryConfig({
  enabled = ['category_a', 'category_b'],
  collapseUncategorisedPages = true,
  labels = {}
} = {}) {
  return {
    groups: [{
      id: 'categories',
      label: 'Categories',
      children: [
        { type: 'item', id: 'category_a', label: labels.category_a || 'Category A' },
        { type: 'item', id: 'category_b', label: labels.category_b || 'Category B' },
        { type: 'item', id: 'category_c', label: labels.category_c || 'Category C' }
      ]
    }],
    navigation: {
      enabledCategoryIds: enabled,
      collapseUncategorisedPages,
      quantityStatistics: false
    }
  };
}

function page(id, title, categories, extra = {}) {
  return { id, title, categories, ...extra };
}

function manualFolder(id, pageIds, extra = {}) {
  return {
    id,
    label: `Manual ${id}`,
    type: 'manual',
    pinned: false,
    collapsed: false,
    defaultPageId: pageIds[0] || null,
    stickOnTop: true,
    pinnedPageIds: [...pageIds],
    pageOrder: [...pageIds],
    source: { kind: 'manual', pageIds: [...pageIds] },
    children: [],
    ...extra
  };
}

function folderBySemanticKey(navigation, semanticKey) {
  if (semanticKey === projection.UNCATEGORY_SEMANTIC_KEY) {
    return navigation.folders.find((folder) => folder.source?.kind === 'missingCategories');
  }
  const categoryId = semanticKey.slice(projection.CATEGORY_SEMANTIC_PREFIX.length);
  return navigation.folders.find((folder) => (
    ['categoryAny', 'categoryAll'].includes(folder.source?.kind)
    && folder.source?.categoryIds?.length === 1
    && folder.source.categoryIds[0] === categoryId
  ));
}

test('rebuild materializes presentation and memberships while preserving canonical navigation owners', () => {
  const manual = manualFolder('folder_manual', ['page_manual'], { customManualState: 'keep' });
  const legacyMultiCategory = {
    id: 'folder_multi',
    label: 'Legacy multi-category projection',
    type: 'system',
    pinned: false,
    collapsed: false,
    source: { kind: 'categoryAll', categoryIds: ['category_a', 'category_b'] },
    projectedPageIds: ['page_legacy'],
    children: [],
    customSystemState: 'keep'
  };
  const navigation = {
    version: 3,
    items: [
      'page_invalid',
      'page_follower',
      'page_manual',
      'page_leader',
      'page_both',
      'page_disabled',
      'page_a',
      'page_legacy'
    ],
    folders: [
      {
        id: 'folder_uncategorised',
        label: 'Old Uncategory',
        type: 'system',
        collapsed: false,
        source: { kind: 'missingCategories' },
        projectedPageIds: ['stale'],
        children: []
      },
      {
        id: 'category-a-stable-folder-id',
        label: 'Old label',
        type: 'system',
        collapsed: false,
        source: { kind: 'categoryAny', categoryIds: ['category_a'] },
        projectedPageIds: ['stale'],
        children: []
      },
      manual,
      legacyMultiCategory
    ],
    bindings: [{
      id: 'binding_1',
      leaderPageId: 'page_leader',
      followerPageIds: ['page_follower']
    }],
    pageStates: {
      page_a: { rootPlacement: true, stickOnTop: true },
      page_follower: { rootPlacement: true },
      page_manual: { rootPlacement: true }
    },
    unrelatedTopLevelState: { keep: true }
  };
  const pageIndex = {
    pages: [
      page('page_a', 'A', ['category_a']),
      page('page_both', 'Both', ['category_a', 'category_b']),
      page('page_none', 'None', []),
      page('page_disabled', 'Disabled category', ['category_c']),
      page('page_leader', 'Leader', ['category_b']),
      page('page_follower', 'Follower', ['category_b']),
      page('page_manual', 'Manual', ['category_a']),
      page('page_legacy', 'Legacy projected', ['category_c']),
      page('page_new_root', 'New root', ['category_c']),
      page('page_a', 'Ignored duplicate', ['category_b'])
    ]
  };
  const navigationBefore = clone(navigation);

  const result = projection.rebuild({
    navigation,
    categoryConfig: categoryConfig(),
    pageIndex
  });

  assert.equal(result.mode, 'rebuild');
  assert.equal(result.changed, true);
  assert.deepEqual(navigation, navigationBefore, 'the pure projector must not mutate its input');
  assert.deepEqual(result.navigation.bindings, navigation.bindings);
  assert.deepEqual(result.navigation.pageStates, navigation.pageStates);
  assert.deepEqual(result.navigation.unrelatedTopLevelState, { keep: true });
  assert.deepEqual(result.navigation.folders.at(-2), manual);
  assert.deepEqual(result.navigation.folders.at(-1), legacyMultiCategory);
  assert.deepEqual(result.navigation.folders.map((folder) => folder.id), [
    'folder_uncategorised',
    'category-a-stable-folder-id',
    'folder_category_category_b',
    'folder_manual',
    'folder_multi'
  ], 'all non-projector root folders retain their exact interleaved relative order');

  assert.deepEqual(
    folderBySemanticKey(result.navigation, projection.UNCATEGORY_SEMANTIC_KEY).projectedPageIds,
    ['page_none']
  );
  assert.deepEqual(
    folderBySemanticKey(result.navigation, projection.categorySemanticKey('category_a')).projectedPageIds,
    ['page_a', 'page_both', 'page_manual']
  );
  assert.deepEqual(
    folderBySemanticKey(result.navigation, projection.categorySemanticKey('category_b')).projectedPageIds,
    ['page_both', 'page_leader', 'page_follower']
  );
  assert.deepEqual(result.navigation.items, [
    'page_leader',
    'page_disabled',
    'page_a',
    'page_new_root'
  ], 'root precedence and existing relative order are preserved');

  assert.deepEqual(Object.keys(result.navigation.dynamicProjection), [
    'version', 'pages', 'folderPresentation'
  ]);
  assert.equal(result.navigation.dynamicProjection.version, 1);
  assert.deepEqual(result.navigation.dynamicProjection.pages.page_a, { id: 'page_a', title: 'A' });
  assert.equal(result.navigation.dynamicProjection.pages.page_invalid, undefined);
  assert.equal(result.navigation.dynamicProjection.pages.page_a.title, 'A', 'first duplicate Page wins');
  assert.deepEqual(
    result.navigation.dynamicProjection.folderPresentation['category:category_a'],
    { id: 'category-a-stable-folder-id', collapsed: false }
  );
  assert.deepEqual(
    result.navigation.dynamicProjection.folderPresentation.uncategory,
    { id: 'folder_uncategorised', collapsed: false }
  );
});

test('root placement precedence excludes invalid, manual, and Binding follower Pages before overrides', () => {
  const navigation = {
    items: ['invalid', 'follower', 'manual', 'captured', 'leader', 'explicit', 'free_existing'],
    folders: [manualFolder('manual_folder', ['manual'])],
    bindings: [{ id: 'binding', leaderPageId: 'leader', followerPageIds: ['follower'] }],
    pageStates: {
      follower: { rootPlacement: true },
      manual: { rootPlacement: true },
      explicit: { rootPlacement: true }
    }
  };
  const pageIndex = {
    pages: [
      page('captured', 'Captured', ['category_a']),
      page('free_new', 'Free new', ['category_c']),
      page('leader', 'Leader', ['category_a']),
      page('explicit', 'Explicit', ['category_a']),
      page('free_existing', 'Free existing', ['category_c']),
      page('manual', 'Manual', ['category_c']),
      page('follower', 'Follower', ['category_c'])
    ]
  };

  const result = projection.rebuild({
    navigation,
    categoryConfig: categoryConfig({ enabled: ['category_a'] }),
    pageIndex
  });

  assert.deepEqual(result.navigation.items, [
    'leader', 'explicit', 'free_existing', 'free_new'
  ]);
});

test('rebuild canonicalizes duplicates, avoids ID collisions, and retains dormant Category presentation', () => {
  const multiCategory = {
    id: 'folder_category_category_b',
    label: 'Another system owns this ID',
    type: 'system',
    collapsed: false,
    source: { kind: 'categoryAll', categoryIds: ['category_a', 'category_b'] },
    projectedPageIds: ['page_legacy'],
    children: [],
    owner: 'legacy'
  };
  const manualCollision = manualFolder('folder_category_category_c', ['page_manual']);
  const navigation = {
    items: ['page_legacy', 'page_free'],
    folders: [
      {
        id: 'legacy-uncategory-id', label: 'Uncategory old', type: 'system', collapsed: false,
        source: { kind: 'missingCategories' }, projectedPageIds: [], children: []
      },
      {
        id: 'duplicate-uncategory', label: 'Duplicate', type: 'system', collapsed: true,
        source: { kind: 'missingCategories' }, projectedPageIds: [], children: []
      },
      {
        id: 'stable-category-a', label: 'A old', type: 'system', collapsed: false,
        source: { kind: 'categoryAny', categoryIds: ['category_a'] }, projectedPageIds: [], children: []
      },
      {
        id: 'duplicate-category-a', label: 'A duplicate', type: 'system', collapsed: true,
        source: { kind: 'categoryAll', categoryIds: ['category_a'] }, projectedPageIds: [], children: []
      },
      multiCategory,
      manualCollision
    ]
  };
  const pageIndex = {
    pages: [
      page('page_legacy', 'Legacy', ['category_c']),
      page('page_free', 'Free', ['category_c']),
      page('page_manual', 'Manual', ['category_c'])
    ]
  };

  const first = projection.rebuild({
    navigation,
    categoryConfig: categoryConfig({ enabled: ['category_a'] }),
    pageIndex
  }).navigation;

  assert.equal(first.folders.filter((folder) => folder.source?.kind === 'missingCategories').length, 1);
  assert.equal(folderBySemanticKey(first, 'category:category_a').id, 'stable-category-a');
  assert.equal(folderBySemanticKey(first, 'category:category_a').collapsed, false);
  assert.equal(first.folders.some((folder) => folder.id === 'duplicate-category-a'), false);
  assert.deepEqual(first.folders.find((folder) => folder.owner === 'legacy'), multiCategory);
  assert.deepEqual(first.folders.find((folder) => folder.id === manualCollision.id), manualCollision);
  assert.equal(first.dynamicProjection.folderPresentation['category:category_b'].id,
    'folder_category_category_b_2');
  assert.equal(first.dynamicProjection.folderPresentation['category:category_c'].id,
    'folder_category_category_c_2');
  assert.equal(first.items.includes('page_legacy'), false,
    'preserved multi-category projections still own root exclusion');
  assert.equal(first.items.includes('page_free'), true);

  const disabled = projection.rebuild({
    navigation: first,
    categoryConfig: categoryConfig({ enabled: [] }),
    pageIndex
  }).navigation;
  assert.equal(folderBySemanticKey(disabled, 'category:category_a'), undefined);
  assert.deepEqual(disabled.dynamicProjection.folderPresentation['category:category_a'], {
    id: 'stable-category-a', collapsed: false
  });

  const reenabled = projection.rebuild({
    navigation: disabled,
    categoryConfig: categoryConfig({
      enabled: ['category_a'],
      labels: { category_a: 'Renamed A' }
    }),
    pageIndex
  }).navigation;
  assert.equal(folderBySemanticKey(reenabled, 'category:category_a').id, 'stable-category-a');
  assert.equal(folderBySemanticKey(reenabled, 'category:category_a').collapsed, false);
  assert.equal(folderBySemanticKey(reenabled, 'category:category_a').label, 'Renamed A');
});

test('rebuild removes nested projector duplicates while preserving their manual descendants', () => {
  const nestedManual = manualFolder('folder_nested_manual', ['page_manual'], {
    customManualState: 'preserve'
  });
  const navigation = {
    items: ['page_a'],
    folders: [{
      ...manualFolder('folder_outer_manual', []),
      children: [{
        id: 'nested-category-a-stable-id',
        label: 'Stale nested Category A',
        type: 'system',
        collapsed: false,
        source: { kind: 'categoryAny', categoryIds: ['category_a'] },
        projectedPageIds: ['stale'],
        children: [nestedManual]
      }]
    }]
  };
  const pageIndex = {
    pages: [
      page('page_a', 'A', ['category_a']),
      page('page_manual', 'Manual', [])
    ]
  };

  const rebuilt = projection.rebuild({
    navigation,
    categoryConfig: categoryConfig({ enabled: ['category_a'] }),
    pageIndex
  }).navigation;
  const semanticFolders = [];
  const visit = (folders) => {
    for (const folder of folders || []) {
      if (folder?.source?.kind === 'missingCategories'
        || (['categoryAny', 'categoryAll'].includes(folder?.source?.kind)
          && folder.source.categoryIds?.length === 1)) {
        semanticFolders.push(folder);
      }
      visit(folder.children);
    }
  };
  visit(rebuilt.folders);

  assert.equal(semanticFolders.filter((folder) => (
    folder.source?.categoryIds?.[0] === 'category_a'
  )).length, 1, 'one logical Category produces one materialized folder');
  assert.equal(folderBySemanticKey(rebuilt, 'category:category_a').id,
    'nested-category-a-stable-id');
  assert.equal(folderBySemanticKey(rebuilt, 'category:category_a').collapsed, false);
  const outerManual = rebuilt.folders.find((folder) => folder.id === 'folder_outer_manual');
  assert.deepEqual(outerManual.children, [nestedManual],
    'removing a corrupt projector wrapper must not discard manual navigation below it');
});

test('updatePages changes only Page presentation for a title-only mutation', () => {
  const beforePageIndex = {
    pages: [page('page_a', 'Old title', ['category_a']), page('page_none', 'None', [])]
  };
  const base = projection.rebuild({
    navigation: { items: ['page_a', 'page_none'], folders: [] },
    categoryConfig: categoryConfig({ enabled: ['category_a'] }),
    pageIndex: beforePageIndex
  }).navigation;
  const baseBefore = clone(base);
  const afterPageIndex = {
    pages: [page('page_a', 'New title', ['category_a']), page('page_none', 'None', [])]
  };

  const result = projection.updatePages({
    navigation: base,
    categoryConfig: categoryConfig({ enabled: ['category_a'] }),
    previousPageIndex: beforePageIndex,
    pageIndex: afterPageIndex,
    changes: [{
      id: 'page_a',
      before: beforePageIndex.pages[0],
      after: afterPageIndex.pages[0]
    }]
  });

  assert.equal(result.mode, 'incremental');
  assert.equal(result.changed, true);
  assert.deepEqual(base, baseBefore, 'incremental updates are pure');
  assert.deepEqual(result.navigation.folders, base.folders);
  assert.deepEqual(result.navigation.items, base.items);
  assert.deepEqual(result.navigation.dynamicProjection.pages.page_a, {
    id: 'page_a', title: 'New title'
  });
  assert.equal(result.stats.membershipChangeCount, 0);
  assert.equal(result.stats.presentationChangeCount, 1);
});

test('explicit Page deltas do not scan unrelated Page metadata', () => {
  const base = projection.rebuild({
    navigation: { items: [], folders: [] },
    categoryConfig: categoryConfig({ enabled: ['category_a', 'category_b'] }),
    pageIndex: { pages: [page('page_a', 'A', ['category_a'])] }
  }).navigation;
  const unreadablePageIndex = {};
  Object.defineProperty(unreadablePageIndex, 'pages', {
    get() {
      throw new Error('unrelated Page metadata was scanned');
    }
  });

  const renamedPage = { id: 'page_a', title: 'A renamed' };
  Object.defineProperty(renamedPage, 'categories', {
    get() {
      throw new Error('title-only update inspected Category membership');
    }
  });
  const titleOnly = projection.updatePages({
    navigation: base,
    previousPageIndex: unreadablePageIndex,
    pageIndex: unreadablePageIndex,
    changes: [{
      id: 'page_a',
      before: page('page_a', 'A', ['category_a']),
      after: renamedPage,
      membershipChanged: false
    }]
  });
  assert.equal(titleOnly.navigation.dynamicProjection.pages.page_a.title, 'A renamed');

  const categoryMove = projection.updatePages({
    navigation: titleOnly.navigation,
    previousPageIndex: unreadablePageIndex,
    pageIndex: unreadablePageIndex,
    changes: [{
      id: 'page_a',
      before: page('page_a', 'A renamed', ['category_a']),
      after: page('page_a', 'A renamed', ['category_b']),
      membershipChanged: true
    }]
  });
  assert.deepEqual(folderBySemanticKey(
    categoryMove.navigation,
    'category:category_a'
  ).projectedPageIds, []);
  assert.deepEqual(folderBySemanticKey(
    categoryMove.navigation,
    'category:category_b'
  ).projectedPageIds, ['page_a']);
});

test('updatePages incrementally applies category, create, delete, and batch mutations', () => {
  const manual = manualFolder('manual_folder', ['page_b']);
  const beforePageIndex = {
    pages: [
      page('page_a', 'A', ['category_a']),
      page('page_b', 'B', ['category_b']),
      page('page_none', 'None', []),
      page('page_gone', 'Gone', ['category_a']),
      page('page_free', 'Free', ['category_c'])
    ]
  };
  const base = projection.rebuild({
    navigation: { items: beforePageIndex.pages.map((entry) => entry.id), folders: [manual] },
    categoryConfig: categoryConfig(),
    pageIndex: beforePageIndex
  }).navigation;
  const afterPageIndex = {
    pages: [
      page('page_b', 'B', []),
      page('page_a', 'A renamed', ['category_b']),
      page('page_none', 'None', ['category_a']),
      page('page_fresh', 'Fresh', []),
      page('page_free', 'Free', ['category_c'])
    ]
  };
  const afterById = new Map(afterPageIndex.pages.map((entry) => [entry.id, entry]));
  const beforeById = new Map(beforePageIndex.pages.map((entry) => [entry.id, entry]));
  const changedIds = ['page_a', 'page_b', 'page_none', 'page_fresh', 'page_gone'];

  const result = projection.updatePages({
    navigation: base,
    categoryConfig: categoryConfig(),
    previousPageIndex: beforePageIndex,
    pageIndex: afterPageIndex,
    changes: changedIds.map((id) => ({
      id,
      before: beforeById.get(id) || null,
      after: afterById.get(id) || null
    }))
  });

  assert.equal(result.mode, 'incremental');
  assert.deepEqual(
    folderBySemanticKey(result.navigation, 'uncategory').projectedPageIds,
    ['page_b', 'page_fresh']
  );
  assert.deepEqual(
    folderBySemanticKey(result.navigation, 'category:category_a').projectedPageIds,
    ['page_none']
  );
  assert.deepEqual(
    folderBySemanticKey(result.navigation, 'category:category_b').projectedPageIds,
    ['page_a']
  );
  assert.deepEqual(result.navigation.dynamicProjection.pages.page_a, {
    id: 'page_a', title: 'A renamed'
  });
  assert.equal(result.navigation.dynamicProjection.pages.page_gone, undefined);
  assert.deepEqual(result.navigation.items, ['page_free']);
  assert.deepEqual(result.navigation.folders.at(-1), manual);
  assert.equal(result.stats.membershipChangeCount, 5);
  assert.deepEqual(new Set(result.stats.changedPageIds), new Set(changedIds));
});

test('changedPageIds and deletedPageIds drive incremental changes without an expanded change list', () => {
  const beforePageIndex = {
    pages: [page('page_a', 'A', ['category_a']), page('page_b', 'B', ['category_b'])]
  };
  const base = projection.rebuild({
    navigation: { items: [], folders: [] },
    categoryConfig: categoryConfig(),
    pageIndex: beforePageIndex
  }).navigation;
  const afterPageIndex = {
    pages: [page('page_a', 'A2', ['category_b']), page('page_c', 'C', ['category_a'])]
  };
  const result = projection.updatePages({
    navigation: base,
    categoryConfig: categoryConfig(),
    previousPageIndex: beforePageIndex,
    pageIndex: afterPageIndex,
    changedPageIds: ['page_a', 'page_c'],
    deletedPageIds: ['page_b']
  });

  assert.deepEqual(folderBySemanticKey(result.navigation, 'category:category_a').projectedPageIds,
    ['page_c']);
  assert.deepEqual(folderBySemanticKey(result.navigation, 'category:category_b').projectedPageIds,
    ['page_a']);
  assert.deepEqual(Object.keys(result.navigation.dynamicProjection.pages).sort(), ['page_a', 'page_c']);
});

test('apply, migration, idempotence, and integrity expose one deterministic projection engine', () => {
  const navigation = { version: 3, items: ['page_a'], folders: [] };
  const pageIndex = { pages: [page('page_a', 'A', ['category_a'])] };
  const config = categoryConfig({ enabled: ['category_a'] });

  assert.equal(projection.needsMigration(navigation), true);
  assert.equal(projection.needsMigration({ dynamicProjection: { version: 0 } }), true);
  const first = projection.apply({ navigation, categoryConfig: config, pageIndex });
  assert.equal(first.mode, 'rebuild');
  assert.equal(projection.needsMigration(first.navigation), false);

  const idempotent = projection.rebuild({
    navigation: first.navigation,
    categoryConfig: config,
    pageIndex
  });
  assert.equal(idempotent.changed, false);
  assert.deepEqual(idempotent.navigation, first.navigation);
  assert.deepEqual(projection.checkIntegrity({
    navigation: first.navigation,
    categoryConfig: config,
    pageIndex
  }), {
    ok: true,
    drift: false,
    expectedNavigation: first.navigation
  });

  const corrupt = clone(first.navigation);
  folderBySemanticKey(corrupt, 'category:category_a').projectedPageIds.push('not-a-page');
  const corruptBefore = clone(corrupt);
  const integrity = projection.checkIntegrity({
    navigation: corrupt,
    categoryConfig: config,
    pageIndex
  });
  assert.equal(projection.needsMigration(corrupt), false,
    'current-schema integrity drift is not mislabeled as a schema migration');
  assert.equal(integrity.ok, false);
  assert.equal(integrity.drift, true);
  assert.deepEqual(corrupt, corruptBefore, 'integrity checks are read-only');
  assert.deepEqual(integrity.expectedNavigation, first.navigation);

  const categoryChanged = projection.apply({
    navigation: first.navigation,
    categoryConfig: categoryConfig({ enabled: ['category_a', 'category_b'] }),
    pageIndex,
    changeSet: { categoryConfigurationChanged: true }
  });
  assert.equal(categoryChanged.mode, 'rebuild');
  assert.ok(folderBySemanticKey(categoryChanged.navigation, 'category:category_b'));
});
