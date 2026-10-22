const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createNavigationModel } = require('../server/navigationModel');

const model = createNavigationModel({
  pagesDir: path.join(__dirname, 'unused-binding-pages'),
  pageDateStamp: () => '20260824'
});

function pageIndex(ids = ['page_a', 'page_b', 'page_c', 'page_d', 'page_e', 'page_f']) {
  return {
    pages: ids.map((id) => ({
      id,
      title: id,
      path: `pages/${id}.json`,
      categories: ['category_none']
    }))
  };
}

function manualFolder(id, pageIds = []) {
  return {
    id,
    label: id,
    type: 'manual',
    collapsed: false,
    source: { kind: 'manual', pageIds },
    children: []
  };
}

function dynamicFolder(
  categoryId = 'category_dynamic',
  projectedPageIds = []
) {
  return {
    id: 'folder_dynamic',
    label: 'Dynamic',
    type: 'system',
    excludeFromRoot: true,
    source: { kind: 'categoryAny', categoryIds: [categoryId] },
    projectedPageIds,
    children: []
  };
}

function folderById(navigation, id) {
  return model.findFolderLocation(navigation.folders, id)?.folder || null;
}

test('Binding normalization deterministically repairs malformed membership and placement', () => {
  const index = pageIndex();
  const normalized = model.normalizeNavigation({
    version: 2,
    folders: [manualFolder('folder_one', ['page_a', 'page_b', 'page_c'])],
    items: ['page_b', 'page_d', 'page_e', 'page_f'],
    bindings: [
      {
        id: 'binding_one',
        leaderPageId: 'page_a',
        followerPageIds: ['page_c', 'page_b', 'page_b', 'page_a', 'page_missing']
      },
      {
        id: 'binding_one',
        leaderPageId: 'page_d',
        followerPageIds: ['page_e']
      },
      {
        id: 'binding_missing_leader',
        leaderPageId: 'page_missing',
        followerPageIds: ['page_f']
      },
      {
        id: 'binding_empty',
        leaderPageId: 'page_f',
        followerPageIds: ['page_f', 'page_missing']
      }
    ]
  }, index);

  assert.equal(normalized.version, 3);
  assert.deepEqual(normalized.bindings, [
    {
      id: 'binding_one',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b', 'page_c']
    },
    {
      id: 'binding_page_d',
      leaderPageId: 'page_d',
      followerPageIds: ['page_e']
    }
  ]);
  assert.deepEqual(folderById(normalized, 'folder_one').source.pageIds, ['page_a']);
  assert.equal(normalized.items.includes('page_b'), false);
  assert.equal(normalized.items.includes('page_c'), false);
  assert.equal(normalized.items.includes('page_e'), false);
  assert.equal(normalized.items.includes('page_d'), true);
  assert.equal(normalized.items.includes('page_f'), true);
  assert.deepEqual(model.normalizeNavigation(normalized, index), normalized);
});

test('normalization conservatively discards every group in a cross-group ownership conflict', () => {
  const index = pageIndex([
    'page_a', 'page_b', 'page_c',
    'page_d', 'page_e', 'page_f',
    'page_g', 'page_h', 'page_i'
  ]);
  const normalized = model.normalizeNavigation({
    folders: [],
    items: [],
    bindings: [
      // Duplicate Leader: both candidates are discarded.
      { id: 'binding_a1', leaderPageId: 'page_a', followerPageIds: ['page_b'] },
      { id: 'binding_a2', leaderPageId: 'page_a', followerPageIds: ['page_c'] },
      // One Follower claimed by two groups: both candidates are discarded.
      { id: 'binding_d', leaderPageId: 'page_d', followerPageIds: ['page_e'] },
      { id: 'binding_f', leaderPageId: 'page_f', followerPageIds: ['page_e'] },
      // A Leader in one group is a Follower in another: both are discarded.
      { id: 'binding_g', leaderPageId: 'page_g', followerPageIds: ['page_h'] },
      { id: 'binding_i', leaderPageId: 'page_i', followerPageIds: ['page_g'] }
    ]
  }, index);

  assert.deepEqual(normalized.bindings, []);
  assert.deepEqual(new Set(normalized.items), new Set(index.pages.map((page) => page.id)));
});

test('create and add follower mutations are immutable, atomic, and retain stable group identity', () => {
  const index = pageIndex();
  const input = model.normalizeNavigation({
    folders: [manualFolder('folder_group', ['page_a', 'page_b'])],
    items: ['page_c', 'page_d', 'page_e', 'page_f']
  }, index);
  const before = JSON.stringify(input);
  const created = model.createBinding(input, index, ['page_b', 'page_c'], 'page_a');

  assert.equal(created.error, null);
  assert.equal(created.changed, true);
  assert.match(created.binding.id, /^binding_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(created.binding.followerPageIds, ['page_b', 'page_c']);
  assert.deepEqual(folderById(created.navigation, 'folder_group').source.pageIds, ['page_a']);
  assert.equal(created.navigation.items.includes('page_c'), false);
  assert.equal(model.bindingRole(created.navigation, 'page_a'), 'leader');
  assert.equal(model.bindingRole(created.navigation, 'page_b'), 'follower');
  assert.equal(model.bindingRole(created.navigation, 'page_d'), null);

  const stableId = created.binding.id;
  const added = model.addFollowers(created.navigation, index, 'page_a', ['page_d']);
  assert.equal(added.error, null);
  assert.equal(added.binding.id, stableId);
  assert.deepEqual(added.binding.followerPageIds, ['page_b', 'page_c', 'page_d']);
  assert.equal(added.navigation.items.includes('page_d'), false);
  assert.equal(model.normalizeNavigation(added.navigation, index).bindings[0].id, stableId);

  const rejected = model.createBinding(added.navigation, index, ['page_e'], 'page_b');
  assert.match(rejected.error, /unbound Pages/);
  assert.equal(rejected.changed, false);
  assert.deepEqual(rejected.navigation, added.navigation);

  const mixedSourceRejected = model.addFollowers(
    added.navigation, index, 'page_a', ['page_e', 'page_b']
  );
  assert.match(mixedSourceRejected.error, /unbound Pages/);
  assert.equal(mixedSourceRejected.changed, false);
  assert.deepEqual(mixedSourceRejected.navigation, added.navigation);
});

test('a dynamic-only occurrence cannot become a canonical Leader target', () => {
  const index = pageIndex(['page_a', 'page_b']);
  index.pages.find((page) => page.id === 'page_a').categories = ['category_dynamic'];
  const source = model.normalizeNavigation({
    folders: [{
      id: 'folder_dynamic',
      label: 'Dynamic',
      type: 'system',
      excludeFromRoot: true,
      source: { kind: 'categoryAny', categoryIds: ['category_dynamic'] },
      projectedPageIds: ['page_a'],
      children: []
    }],
    items: ['page_a', 'page_b']
  }, index);

  assert.equal(source.items.includes('page_a'), false);
  const result = model.createBinding(source, index, ['page_b'], 'page_a');
  assert.match(result.error, /no canonical root\/manual/);
  assert.equal(result.changed, false);
});

test('Set as Leader swaps the exact placement owner and Stop Binding releases in that container', () => {
  const index = pageIndex(['page_before', 'page_a', 'page_b', 'page_c', 'page_after']);
  const source = model.normalizeNavigation({
    folders: [manualFolder('folder_group', ['page_before', 'page_a', 'page_after'])],
    items: ['page_b', 'page_c'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b', 'page_c']
    }]
  }, index);

  const promoted = model.setBindingLeader(source, index, 'page_b');
  assert.equal(promoted.error, null);
  assert.equal(promoted.binding.id, 'binding_group');
  assert.equal(promoted.binding.leaderPageId, 'page_b');
  assert.deepEqual(promoted.binding.followerPageIds, ['page_a', 'page_c']);
  assert.deepEqual(folderById(promoted.navigation, 'folder_group').source.pageIds, [
    'page_before', 'page_b', 'page_after'
  ]);
  assert.equal(promoted.navigation.items.includes('page_a'), false);

  const stopped = model.removeFollower(promoted.navigation, index, 'page_a');
  assert.equal(stopped.error, null);
  assert.deepEqual(stopped.releasedPageIds, ['page_a']);
  assert.deepEqual(folderById(stopped.navigation, 'folder_group').source.pageIds, [
    'page_before', 'page_b', 'page_a', 'page_after'
  ]);
  assert.equal(model.bindingRole(stopped.navigation, 'page_a'), null);
  assert.equal(model.bindingRole(stopped.navigation, 'page_c'), 'follower');
});

test('only a Leader may move canonical placement while a Follower move is rejected', () => {
  const index = pageIndex(['page_a', 'page_b']);
  const source = model.normalizeNavigation({
    folders: [manualFolder('folder_target')],
    items: ['page_a'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b']
    }]
  }, index);

  const followerMove = model.moveNavigationSelection(source, index, [
    { type: 'page', id: 'page_b' }
  ], { parentFolderId: 'folder_target' });
  assert.match(followerMove.error, /bound Follower/);
  assert.equal(followerMove.changed, false);
  assert.deepEqual(followerMove.navigation, source);

  const mixedFollowerMove = model.moveNavigationSelection(source, index, [
    { type: 'folder', id: 'folder_target' },
    { type: 'page', id: 'page_b' }
  ], { parentFolderId: null });
  assert.match(mixedFollowerMove.error, /bound Follower/);
  assert.equal(mixedFollowerMove.changed, false);
  assert.deepEqual(mixedFollowerMove.navigation, source);

  const leaderMove = model.moveNavigationSelection(source, index, [
    { type: 'page', id: 'page_a' }
  ], { parentFolderId: 'folder_target' });
  assert.equal(leaderMove.error, null);
  assert.deepEqual(folderById(leaderMove.navigation, 'folder_target').source.pageIds, ['page_a']);
  assert.equal(leaderMove.navigation.items.includes('page_b'), false);
  assert.equal(model.bindingRole(leaderMove.navigation, 'page_b'), 'follower');
});

test('dissolve and delete cleanup release only surviving Pages into the Leader container', () => {
  const index = pageIndex(['page_before', 'page_a', 'page_b', 'page_c', 'page_after']);
  const bindingNavigation = () => model.normalizeNavigation({
    folders: [manualFolder('folder_group', ['page_before', 'page_a', 'page_after'])],
    items: [],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b', 'page_c']
    }]
  }, index);

  const dissolved = model.dissolveBinding(bindingNavigation(), index, 'binding_group');
  assert.equal(dissolved.error, null);
  assert.deepEqual(dissolved.navigation.bindings, []);
  assert.deepEqual(folderById(dissolved.navigation, 'folder_group').source.pageIds, [
    'page_before', 'page_a', 'page_b', 'page_c', 'page_after'
  ]);

  const followerDeleted = model.cleanupBindingForDeletedPage(bindingNavigation(), index, 'page_b');
  assert.equal(followerDeleted.error, null);
  assert.deepEqual(followerDeleted.navigation.bindings[0].followerPageIds, ['page_c']);
  assert.equal(folderById(followerDeleted.navigation, 'folder_group').source.pageIds.includes('page_b'), false);
  assert.equal(followerDeleted.navigation.items.includes('page_b'), false);

  const leaderDeleted = model.cleanupBindingForDeletedPage(bindingNavigation(), index, 'page_a');
  assert.equal(leaderDeleted.error, null);
  assert.deepEqual(leaderDeleted.releasedPageIds, ['page_b', 'page_c']);
  assert.deepEqual(leaderDeleted.navigation.bindings, []);
  assert.deepEqual(folderById(leaderDeleted.navigation, 'folder_group').source.pageIds, [
    'page_before', 'page_b', 'page_c', 'page_after'
  ]);
  assert.equal(leaderDeleted.navigation.items.includes('page_a'), false);
});

test('Category changes retain Leader root ownership while dynamic occurrences use own metadata', () => {
  const index = pageIndex(['page_a', 'page_b', 'page_c']);
  index.pages.find((page) => page.id === 'page_a').categories = ['category_dynamic'];
  index.pages.find((page) => page.id === 'page_b').categories = ['category_other'];
  index.pages.find((page) => page.id === 'page_c').categories = ['category_dynamic'];
  const navigation = model.normalizeNavigation({
    folders: [{
      id: 'folder_dynamic',
      label: 'Dynamic',
      type: 'system',
      excludeFromRoot: true,
      source: { kind: 'categoryAny', categoryIds: ['category_dynamic'] },
      projectedPageIds: ['page_a', 'page_c'],
      children: []
    }],
    items: ['page_a'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b']
    }]
  }, index);

  assert.equal(navigation.items.includes('page_a'), true);
  assert.equal(navigation.items.includes('page_b'), false);
  assert.deepEqual(
    model.resolveFolderPageIds(folderById(navigation, 'folder_dynamic'), index),
    ['page_a', 'page_c']
  );
});

test('categorized Followers stopped from a root Binding retain that root placement after restart', () => {
  const index = pageIndex(['page_before', 'page_a', 'page_b', 'page_after']);
  for (const page of index.pages) {
    page.categories = ['page_a', 'page_b'].includes(page.id)
      ? ['category_dynamic']
      : ['category_other'];
  }
  const source = model.normalizeNavigation({
    folders: [dynamicFolder('category_dynamic', ['page_a', 'page_b'])],
    items: ['page_before', 'page_a', 'page_after'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b']
    }]
  }, index);

  assert.deepEqual(source.items, ['page_before', 'page_a', 'page_after']);
  assert.deepEqual(source.pageStates.page_a, { rootPlacement: true });
  assert.equal(source.pageStates.page_b, undefined);

  const stopped = model.removeFollower(source, index, 'page_b');
  assert.equal(stopped.error, null);
  assert.deepEqual(stopped.navigation.bindings, []);
  assert.deepEqual(stopped.navigation.items, ['page_before', 'page_a', 'page_b', 'page_after']);
  assert.deepEqual(stopped.navigation.pageStates.page_a, { rootPlacement: true });
  assert.deepEqual(stopped.navigation.pageStates.page_b, { rootPlacement: true });
  assert.deepEqual(
    model.resolveFolderPageIds(folderById(stopped.navigation, 'folder_dynamic'), index),
    ['page_a', 'page_b']
  );
  assert.deepEqual(model.normalizeNavigation(stopped.navigation, index), stopped.navigation);
});

test('dissolving a categorized root Binding durably releases every Follower at root', () => {
  const index = pageIndex(['page_a', 'page_b', 'page_c']);
  for (const page of index.pages) page.categories = ['category_dynamic'];
  const source = model.normalizeNavigation({
    folders: [dynamicFolder('category_dynamic', ['page_a', 'page_b', 'page_c'])],
    items: ['page_a'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b', 'page_c']
    }]
  }, index);

  const dissolved = model.dissolveBinding(source, index, 'binding_group');
  assert.equal(dissolved.error, null);
  assert.deepEqual(dissolved.navigation.items, ['page_a', 'page_b', 'page_c']);
  assert.deepEqual(dissolved.navigation.pageStates, {
    page_a: { rootPlacement: true },
    page_b: { rootPlacement: true },
    page_c: { rootPlacement: true }
  });
  assert.deepEqual(model.normalizeNavigation(dissolved.navigation, index), dissolved.navigation);
});

test('deleting a categorized root Leader releases survivors at root and drops stale state', () => {
  const index = pageIndex(['page_before', 'page_a', 'page_b', 'page_c', 'page_after']);
  for (const page of index.pages) {
    page.categories = ['page_a', 'page_b', 'page_c'].includes(page.id)
      ? ['category_dynamic']
      : ['category_other'];
  }
  const source = model.normalizeNavigation({
    folders: [dynamicFolder('category_dynamic', ['page_a', 'page_b', 'page_c'])],
    items: ['page_before', 'page_a', 'page_after'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b', 'page_c']
    }]
  }, index);

  const deleted = model.cleanupBindingForDeletedPage(source, index, 'page_a');
  const indexAfterDelete = {
    ...index,
    pages: index.pages.filter((page) => page.id !== 'page_a')
  };
  assert.equal(deleted.error, null);
  assert.deepEqual(deleted.navigation.bindings, []);
  assert.deepEqual(deleted.navigation.items, ['page_before', 'page_b', 'page_c', 'page_after']);
  assert.equal(deleted.navigation.pageStates.page_a, undefined);
  assert.deepEqual(deleted.navigation.pageStates.page_b, { rootPlacement: true });
  assert.deepEqual(deleted.navigation.pageStates.page_c, { rootPlacement: true });
  assert.deepEqual(
    model.normalizeNavigation(deleted.navigation, indexAfterDelete),
    deleted.navigation
  );
});

test('root placement state composes with pin state and is removed from Followers/manual Pages', () => {
  const index = pageIndex(['page_a', 'page_b', 'page_c']);
  const navigation = model.normalizeNavigation({
    folders: [manualFolder('folder_manual', ['page_a'])],
    items: ['page_c'],
    pageStates: {
      page_a: { stickOnTop: true, rootPlacement: true },
      page_b: { stickOnTop: true, rootPlacement: true },
      page_c: { rootPlacement: true }
    },
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_c',
      followerPageIds: ['page_b']
    }]
  }, index);

  assert.deepEqual(navigation.pageStates.page_a, { stickOnTop: true });
  assert.deepEqual(navigation.pageStates.page_b, { stickOnTop: true });
  assert.deepEqual(navigation.pageStates.page_c, { rootPlacement: true });
  model.setPageStickOnTop(navigation, 'page_c', true);
  assert.deepEqual(navigation.pageStates.page_c, { rootPlacement: true, stickOnTop: true });
  model.setPageStickOnTop(navigation, 'page_c', false);
  assert.deepEqual(navigation.pageStates.page_c, { rootPlacement: true });
});

test('root moves preserve explicit/Leader placement without promoting ordinary dynamic Pages', () => {
  const index = pageIndex(['page_before', 'page_a', 'page_b', 'page_dynamic', 'page_after']);
  for (const page of index.pages) {
    page.categories = ['page_a', 'page_b', 'page_dynamic'].includes(page.id)
      ? ['category_dynamic']
      : ['category_other'];
  }
  const source = model.normalizeNavigation({
    folders: [
      dynamicFolder('category_dynamic', ['page_a', 'page_b', 'page_dynamic']),
      manualFolder('folder_group', ['page_a'])
    ],
    items: ['page_before', 'page_after'],
    bindings: [{
      id: 'binding_group',
      leaderPageId: 'page_a',
      followerPageIds: ['page_b']
    }]
  }, index);

  const leaderMoved = model.moveNavigationSelection(source, index, [
    { type: 'page', id: 'page_a' }
  ], { parentFolderId: null, area: 'pages', index: 1 });
  assert.equal(leaderMoved.error, null);
  assert.deepEqual(leaderMoved.navigation.items, ['page_before', 'page_a', 'page_after']);
  assert.deepEqual(leaderMoved.navigation.pageStates.page_a, { rootPlacement: true });

  const ordinaryMove = model.moveNavigationSelection(leaderMoved.navigation, index, [
    { type: 'page', id: 'page_dynamic' }
  ], { parentFolderId: null, area: 'pages', index: 1 });
  assert.equal(ordinaryMove.error, null);
  assert.equal(ordinaryMove.changed, false);
  assert.equal(ordinaryMove.navigation.items.includes('page_dynamic'), false);
  assert.equal(ordinaryMove.navigation.pageStates.page_dynamic, undefined);

  const dissolved = model.dissolveBinding(leaderMoved.navigation, index, 'binding_group');
  const explicitMoved = model.moveNavigationSelection(dissolved.navigation, index, [
    { type: 'page', id: 'page_b' }
  ], { parentFolderId: null, area: 'pages', index: 4 });
  assert.equal(explicitMoved.error, null);
  assert.deepEqual(explicitMoved.navigation.items, [
    'page_before', 'page_a', 'page_after', 'page_b'
  ]);
  assert.deepEqual(explicitMoved.navigation.pageStates.page_b, { rootPlacement: true });
});
