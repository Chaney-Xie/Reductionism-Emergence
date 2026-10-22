const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const navigationSort = require('../public/navigationSort');
const workspaceStateModel = require('../public/workspaceState');
const {
  migrateVaultWorkspaceStateNavigationSort,
  migrateVaultWorkspaceStateLastOpenedPage,
  migrateVaultWorkspaceStateStructuredTextFrames,
  readVaultWorkspaceState,
  removePageViewStateFromVaultWorkspaceState,
  updateVaultWorkspaceState,
  writeVaultWorkspaceState
} = require('../server/vaultWorkspaceState');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('workspace fields normalize independently without discarding valid neighbouring state', () => {
  const normalized = workspaceStateModel.normalizeWorkspaceState({
    lastOpenedPageId: 'page_good',
    leftSidebarOpen: false,
    rightSidebarOpen: 'invalid',
    leftSidebarWidth: 412,
    rightSidebarWidth: Number.NaN,
    searchPanelOpen: true,
    searchText: 'mitochondria',
    categoryFilterPanelOpen: true,
    selectedCategoryFilterIds: ['cat_a', '', 'cat_a', 5, 'cat_b'],
    collapsedCategoryFilterGroupIds: ['group_a'],
    navigationSortMode: 'created_desc',
    externalLinkTargetMode: 'file',
    rightSidebarView: 'resources',
    rightSectionHeights: {
      maintenance: 210,
      'external-links': 0,
      relations: Number.NaN,
      obsolete: 500
    },
    collapsedRightSectionIds: ['maintenance', 'obsolete', 'relations']
  });

  assert.equal(Object.hasOwn(normalized, 'lastOpenedPageId'), false);
  assert.equal(normalized.leftSidebarOpen, false);
  assert.equal(normalized.rightSidebarOpen, true);
  assert.equal(normalized.leftSidebarWidth, 412);
  assert.equal(normalized.rightSidebarWidth, 220);
  assert.equal(normalized.searchPanelOpen, true);
  assert.equal(normalized.searchText, 'mitochondria');
  assert.deepEqual(normalized.selectedCategoryFilterIds, ['cat_a', 'cat_b']);
  assert.deepEqual(normalized.collapsedCategoryFilterGroupIds, ['group_a']);
  assert.equal(Object.hasOwn(normalized, 'navigationSortMode'), false);
  assert.equal(normalized.externalLinkTargetMode, 'file');
  assert.equal(normalized.rightSidebarView, 'resources');
  assert.deepEqual(normalized.rightSectionHeights, {
    maintenance: 210,
    'external-links': 64
  });
  assert.deepEqual(normalized.collapsedRightSectionIds, ['maintenance', 'relations']);

  const fallback = workspaceStateModel.normalizeWorkspaceState({
    rightSidebarView: 'obsolete',
    rightSectionHeights: 'invalid'
  });
  assert.equal(fallback.rightSidebarView, 'relations');
  assert.deepEqual(fallback.rightSectionHeights, {});
});

test('workspace Page view folding state normalizes, deduplicates, clones, and caps descriptors', () => {
  const source = [
    { kind: 'heading', physicalLineId: 'heading-one', lineIndex: 1, depth: 1 },
    { kind: 'heading', physicalLineId: 'heading-one', lineIndex: 17, depth: 3 },
    { kind: 'list', physicalLineId: null, lineIndex: 4, depth: 2 },
    { kind: 'list', lineIndex: 4, depth: 2 },
    { kind: 'list', physicalLineId: null, lineIndex: 4, depth: 3 },
    { kind: 'heading', physicalLineId: '', lineIndex: 8, depth: 2 },
    { kind: 'paragraph', physicalLineId: 'invalid-kind', lineIndex: 2, depth: 1 },
    { kind: 'list', physicalLineId: 'invalid-line', lineIndex: 1.5, depth: 1 },
    { kind: 'heading', physicalLineId: 'invalid-depth', lineIndex: 9, depth: -1 }
  ];
  const normalized = workspaceStateModel.normalizePageViewState({
    markdownStructuralFolds: source
  });

  assert.deepEqual(normalized.markdownStructuralFolds, [
    { kind: 'heading', physicalLineId: 'heading-one', lineIndex: 1, depth: 1 },
    { kind: 'list', physicalLineId: null, lineIndex: 4, depth: 2 },
    { kind: 'list', physicalLineId: null, lineIndex: 4, depth: 3 },
    { kind: 'heading', physicalLineId: null, lineIndex: 8, depth: 2 }
  ]);
  assert.notEqual(normalized.markdownStructuralFolds, source);
  assert.notEqual(normalized.markdownStructuralFolds[0], source[0]);
  source[0].depth = 7;
  assert.equal(normalized.markdownStructuralFolds[0].depth, 1);
  assert.deepEqual(
    workspaceStateModel.normalizePageViewState({}).markdownStructuralFolds,
    []
  );

  const oversized = Array.from({ length: 2005 }, (_, lineIndex) => ({
    kind: lineIndex % 2 ? 'list' : 'heading',
    physicalLineId: null,
    lineIndex,
    depth: 1
  }));
  const capped = workspaceStateModel.normalizePageViewState({
    markdownStructuralFolds: oversized
  }).markdownStructuralFolds;
  assert.equal(capped.length, 2000);
  assert.equal(capped[0].lineIndex, 0);
  assert.equal(capped[1999].lineIndex, 1999);
});

test('workspace state is persisted inside and isolated by each stable Vault root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-vaults-'));
  const vaultAPath = path.join(root, 'vault_a');
  const vaultBPath = path.join(root, 'vault_b');
  await writeVaultWorkspaceState(vaultAPath, {
    lastOpenedPageId: 'page_a',
    workspaceState: {
    lastOpenedPageId: 'page_a',
    leftSidebarOpen: false,
    leftSidebarWidth: 360,
    searchText: 'alpha',
    selectedCategoryFilterIds: ['cat_a'],
    navigationSortMode: 'name_desc',
    pageViewStates: {
      page_a: {
        markdownStructuralFolds: [{
          kind: 'heading', physicalLineId: 'vault-a-heading', lineIndex: 2, depth: 1
        }]
      }
    }
    }
  });
  await writeVaultWorkspaceState(vaultBPath, {
    lastOpenedPageId: 'page_b',
    workspaceState: {
    lastOpenedPageId: 'page_b',
    rightSidebarOpen: false,
    rightSidebarWidth: 440,
    searchText: 'beta',
    navigationSortMode: 'modified_asc',
    pageViewStates: {
      page_b: {
        markdownStructuralFolds: [{
          kind: 'list', physicalLineId: 'vault-b-list', lineIndex: 5, depth: 2
        }]
      }
    }
    }
  });

  const vaultARecord = await readVaultWorkspaceState(vaultAPath);
  const vaultBRecord = await readVaultWorkspaceState(vaultBPath);
  const vaultA = workspaceStateModel.normalizeWorkspaceState(vaultARecord.workspaceState);
  const vaultB = workspaceStateModel.normalizeWorkspaceState(vaultBRecord.workspaceState);
  assert.equal(vaultARecord.lastOpenedPageId, 'page_a');
  assert.equal(vaultBRecord.lastOpenedPageId, 'page_b');
  assert.equal(Object.hasOwn(vaultA, 'lastOpenedPageId'), false);
  assert.equal(Object.hasOwn(vaultB, 'lastOpenedPageId'), false);
  assert.equal(vaultA.leftSidebarOpen, false);
  assert.equal(vaultA.leftSidebarWidth, 360);
  assert.equal(vaultA.searchText, 'alpha');
  assert.deepEqual(vaultA.selectedCategoryFilterIds, ['cat_a']);
  assert.equal(vaultB.rightSidebarOpen, false);
  assert.equal(vaultB.rightSidebarWidth, 440);
  assert.equal(vaultB.searchText, 'beta');
  assert.equal(Object.hasOwn(vaultA, 'navigationSortMode'), false);
  assert.equal(Object.hasOwn(vaultB, 'navigationSortMode'), false);
  assert.deepEqual(vaultA.pageViewStates.page_a.markdownStructuralFolds, [{
    kind: 'heading', physicalLineId: 'vault-a-heading', lineIndex: 2, depth: 1
  }]);
  assert.equal(Object.hasOwn(vaultA.pageViewStates, 'page_b'), false);
  assert.deepEqual(vaultB.pageViewStates.page_b.markdownStructuralFolds, [{
    kind: 'list', physicalLineId: 'vault-b-list', lineIndex: 5, depth: 2
  }]);
  assert.equal(Object.hasOwn(vaultB.pageViewStates, 'page_a'), false);
});

test('page deletion removes its persisted view state without mutating the canonical owner', async () => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-delete-'));
  await writeVaultWorkspaceState(vaultPath, {
    lastOpenedPageId: 'page_kept',
    workspaceState: {
      lastOpenedPageId: 'page_deleted',
      pageViewStates: {
        page_deleted: { panX: 10 },
        page_kept: { panX: 20 }
      }
    }
  });

  const updated = await removePageViewStateFromVaultWorkspaceState(vaultPath, 'page_deleted');

  assert.equal(updated.lastOpenedPageId, 'page_kept');
  assert.equal(Object.hasOwn(updated.workspaceState, 'lastOpenedPageId'), false);
  assert.equal(Object.hasOwn(updated.workspaceState.pageViewStates, 'page_deleted'), false);
  assert.equal(updated.workspaceState.pageViewStates.page_kept.panX, 20);
});

test('legacy nested last-opened values migrate once into the valid canonical top-level owner', async () => {
  const cases = [
    ['copies agree', 'page_a', 'page_a', 'page_a'],
    ['copies disagree', 'page_b', 'page_a', 'page_b'],
    ['top-level missing', undefined, 'page_a', 'page_a'],
    ['top-level malformed', 'bad id', 'page_a', 'page_a'],
    ['top-level page missing', 'page_missing', 'page_a', 'page_a'],
    ['legacy malformed', undefined, 'bad id', null],
    ['both pages missing', 'page_missing', 'page_other_missing', null],
    ['empty Vault', undefined, undefined, null]
  ];
  const validPageIds = new Set(['page_a', 'page_b']);

  for (const [label, topLevel, nested, expected] of cases) {
    const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-last-opened-migration-'));
    const raw = {
      schemaVersion: 1,
      ...(topLevel === undefined ? {} : { lastOpenedPageId: topLevel }),
      workspaceState: {
        searchText: label,
        ...(nested === undefined ? {} : { lastOpenedPageId: nested })
      }
    };
    await fs.writeFile(
      path.join(vaultPath, 'workspaceState.json'),
      `${JSON.stringify(raw, null, 2)}\n`,
      'utf8'
    );

    const migrated = await migrateVaultWorkspaceStateLastOpenedPage(vaultPath, validPageIds);
    assert.equal(migrated.lastOpenedPageId, expected, label);
    assert.equal(Object.hasOwn(migrated.workspaceState, 'lastOpenedPageId'), false, label);
    assert.equal(migrated.workspaceState.searchText, label, label);
    const firstWrite = await fs.readFile(path.join(vaultPath, 'workspaceState.json'), 'utf8');
    const persisted = JSON.parse(firstWrite);
    assert.equal(persisted.lastOpenedPageId, expected, label);
    assert.equal(Object.hasOwn(persisted.workspaceState, 'lastOpenedPageId'), false, label);

    await migrateVaultWorkspaceStateLastOpenedPage(vaultPath, validPageIds);
    assert.equal(
      await fs.readFile(path.join(vaultPath, 'workspaceState.json'), 'utf8'),
      firstWrite,
      `${label}: canonical state is stable after one-time migration`
    );
  }
});

test('legacy nested navigation Sort is inspected and removed without changing neighbouring workspace state', async () => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-sort-migration-'));
  await fs.writeFile(path.join(vaultPath, 'workspaceState.json'), `${JSON.stringify({
    schemaVersion: 1,
    lastOpenedPageId: 'page_a',
    workspaceState: {
      searchText: 'preserved',
      navigationSortMode: 'modified_desc'
    }
  }, null, 2)}\n`, 'utf8');

  const inspected = await migrateVaultWorkspaceStateNavigationSort(vaultPath, {
    removeLegacyOwner: false
  });
  assert.equal(inspected.legacyNavigationSortMode, 'modified_desc');
  assert.equal(inspected.hasLegacyOwner, true);
  assert.equal(inspected.removedLegacyOwner, false);
  assert.match(
    await fs.readFile(path.join(vaultPath, 'workspaceState.json'), 'utf8'),
    /navigationSortMode/
  );

  const migrated = await migrateVaultWorkspaceStateNavigationSort(vaultPath);
  assert.equal(migrated.legacyNavigationSortMode, 'modified_desc');
  assert.equal(migrated.removedLegacyOwner, true);
  assert.equal(migrated.state.workspaceState.searchText, 'preserved');
  assert.equal(Object.hasOwn(migrated.state.workspaceState, 'navigationSortMode'), false);
});

test('structured-frame cold migration folds Page-relative offsets and preserves other migration owners', async () => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-frame-state-migration-'));
  const filePath = path.join(vaultPath, 'workspaceState.json');
  await fs.writeFile(filePath, `${JSON.stringify({
    schemaVersion: 1,
    lastOpenedPageId: 'page_a',
    workspaceState: {
      lastOpenedPageId: 'page_legacy_owner',
      navigationSortMode: 'modified_desc',
      searchText: 'preserve exactly',
      pageViewStates: {
        page_a: {
          panX: 10,
          panY: 20,
          zoom: 2,
          markdownFrameOffsetX: 130,
          markdownFrameWidth: 500,
          markdownFramePreferredWidth: 760,
          markdownFrameConstraintSide: 'left'
        },
        page_b: {
          panX: 40,
          zoom: 0.5,
          markdownFrameWidth: 420,
          markdownFrameConstraintSide: 'right'
        }
      }
    }
  }, null, 2)}\n`, 'utf8');

  const migrated = await migrateVaultWorkspaceStateStructuredTextFrames(vaultPath, {
    framesByPageId: new Map([
      ['page_a', { centerWorldX: 100, preferredWidth: 900 }],
      ['page_b', { centerWorldX: -50, preferredWidth: 800 }]
    ])
  });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.migratedViewStateCount, 2);
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(raw.workspaceState.navigationSortMode, 'modified_desc');
  assert.equal(raw.workspaceState.lastOpenedPageId, 'page_legacy_owner');
  assert.equal(raw.workspaceState.searchText, 'preserve exactly');
  assert.equal(raw.workspaceState.pageViewStates.page_a.panX, 70);
  assert.equal(raw.workspaceState.pageViewStates.page_a.panY, 20);
  assert.equal(raw.workspaceState.pageViewStates.page_b.panX, 40);
  for (const viewState of Object.values(raw.workspaceState.pageViewStates)) {
    for (const field of [
      'markdownFrameOffsetX',
      'markdownFrameWidth',
      'markdownFramePreferredWidth',
      'markdownFrameConstraintSide'
    ]) {
      assert.equal(Object.hasOwn(viewState, field), false);
    }
  }

  const firstWrite = await fs.readFile(filePath, 'utf8');
  const repeated = await migrateVaultWorkspaceStateStructuredTextFrames(vaultPath, {
    framesByPageId: { page_a: { centerWorldX: 100, preferredWidth: 900 } }
  });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.migratedViewStateCount, 0);
  assert.equal(await fs.readFile(filePath, 'utf8'), firstWrite);
});

test('canonical Page updates serialize ahead of an immediate workspace snapshot flush', async () => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-last-opened-queue-'));
  await writeVaultWorkspaceState(vaultPath, {
    lastOpenedPageId: 'page_a',
    workspaceState: { searchText: 'before' }
  });
  let releaseFirstRead;
  let markFirstReadStarted;
  const firstReadStarted = new Promise((resolve) => { markFirstReadStarted = resolve; });
  const holdFirstRead = new Promise((resolve) => { releaseFirstRead = resolve; });
  let readCount = 0;
  const fsImpl = {
    ...fs,
    async readFile(...args) {
      readCount += 1;
      if (readCount === 1) {
        markFirstReadStarted();
        await holdFirstRead;
      }
      return fs.readFile(...args);
    }
  };

  const openPage = updateVaultWorkspaceState(vaultPath, (state) => ({
    ...state,
    lastOpenedPageId: 'page_b'
  }), { fsImpl });
  await firstReadStarted;
  const flushWorkspace = updateVaultWorkspaceState(vaultPath, (state) => ({
    ...state,
    workspaceState: { ...state.workspaceState, searchText: 'after' }
  }), { fsImpl });
  releaseFirstRead();
  await Promise.all([openPage, flushWorkspace]);

  const persisted = await readVaultWorkspaceState(vaultPath);
  assert.equal(persisted.lastOpenedPageId, 'page_b');
  assert.equal(persisted.workspaceState.searchText, 'after');
  assert.equal(Object.hasOwn(persisted.workspaceState, 'lastOpenedPageId'), false);
});

async function rendererHarness() {
  const source = await read('public/js/workspaceState.js');
  const restoredWidths = [];
  const savedSnapshots = [];
  const context = {
    console,
    window: {
      cneDesktop: {
        isDesktop: true,
        getWorkspaceState: async () => ({ ok: true, exists: false }),
        setWorkspaceState: async (snapshot) => {
          savedSnapshots.push(snapshot);
          return { ok: true, exists: true, workspaceState: snapshot };
        }
      }
    },
    workspaceStateModel,
    navigationSort,
    navigationSortMode: 'name_asc',
    externalLinkTargetMode: 'url',
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    leftSidebarExpandedWidth: 220,
    rightSidebarExpandedWidth: 220,
    descriptorSearchOpen: false,
    descriptorSearchText: '',
    filterPanelOpen: false,
    selectedCategoryFilterIds: new Set(),
    collapsedCategoryFilterGroupIds: new Set(),
    categoryFilterGroupsInitialized: false,
    collapsedRightSectionIds: new Set(['maintenance', 'category', 'descriptor']),
    rightSidebarView: 'relations',
    rightSectionHeights: new Map([
      ['maintenance', 80], ['category', 100], ['descriptor', 120],
      ['relations', 180], ['external-links', 160]
    ]),
    currentPage: { id: 'page_current' },
    project: { lastOpenedPageId: 'page_old' },
    pageIndex: { pages: [{ id: 'page_current' }, { id: 'page_kept' }] },
    categoryRoots: () => [{
      id: 'group_valid',
      children: [
        { type: 'item', id: 'cat_valid' },
        { type: 'group', children: [{ type: 'item', id: 'cat_nested' }] }
      ]
    }],
    restoreSidebarExpandedWidth: (side) => restoredWidths.push(side),
    showStatus() {},
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(`${source}\nglobalThis.workspaceStateTestApi = {
    applyRestoredPageViewState,
    collectWorkspaceState,
    enableWorkspaceStatePersistence,
    flushWorkspaceStateNow,
    restoreWorkspaceState,
    scheduleWorkspaceStateSave
  };`, context);
  return { api: context.workspaceStateTestApi, context, restoredWidths, savedSnapshots };
}

test('renderer restoration ignores stale IDs while restoring every stable browsing field', async () => {
  const harness = await rendererHarness();
  harness.context.navigationSortMode = 'created_asc';
  const state = harness.api.restoreWorkspaceState({
    exists: true,
    workspaceState: {
      lastOpenedPageId: 'page_saved',
      leftSidebarOpen: false,
      rightSidebarOpen: true,
      leftSidebarWidth: 410,
      rightSidebarWidth: 390,
      searchPanelOpen: true,
      searchText: 'saved query',
      categoryFilterPanelOpen: true,
      selectedCategoryFilterIds: ['cat_valid', 'cat_missing', 'cat_nested'],
      collapsedCategoryFilterGroupIds: ['group_valid', 'group_missing'],
      navigationSortMode: 'modified_desc',
      externalLinkTargetMode: 'file',
      rightSidebarView: 'resources',
      rightSectionHeights: {
        maintenance: 240,
        'external-links': 190,
        obsolete: 999
      },
      collapsedRightSectionIds: ['category', 'relations'],
      pageViewStates: {
        page_saved: {
          checkedHighlightGroupIds: ['highlight_a'],
          markdownStructuralFolds: [{
            kind: 'heading', physicalLineId: 'saved-heading', lineIndex: 3, depth: 2
          }],
          infoPanels: [{
            kind: 'block', ownerId: 'block_a', x: 31, y: 42,
            width: 355, height: 244, z: 3, autoPositioned: false
          }]
        }
      }
    }
  });

  assert.equal(Object.hasOwn(state, 'lastOpenedPageId'), false);
  assert.equal(harness.context.leftSidebarOpen, false);
  assert.equal(harness.context.rightSidebarOpen, true);
  assert.equal(harness.context.leftSidebarExpandedWidth, 410);
  assert.equal(harness.context.rightSidebarExpandedWidth, 390);
  assert.equal(harness.context.descriptorSearchOpen, true);
  assert.equal(harness.context.descriptorSearchText, 'saved query');
  assert.equal(harness.context.filterPanelOpen, true);
  assert.deepEqual([...harness.context.selectedCategoryFilterIds], ['cat_valid', 'cat_nested']);
  assert.deepEqual([...harness.context.collapsedCategoryFilterGroupIds], ['group_valid']);
  assert.equal(harness.context.categoryFilterGroupsInitialized, true);
  assert.equal(harness.context.navigationSortMode, 'created_asc');
  assert.equal(harness.context.externalLinkTargetMode, 'file');
  assert.equal(harness.context.rightSidebarView, 'resources');
  assert.equal(harness.context.rightSectionHeights.get('maintenance'), 240);
  assert.equal(harness.context.rightSectionHeights.get('external-links'), 190);
  assert.equal(harness.context.rightSectionHeights.has('obsolete'), false);
  assert.deepEqual([...harness.context.collapsedRightSectionIds], ['category', 'relations']);
  const tab = { currentPageId: 'page_saved', pageViewStates: {}, viewState: {} };
  assert.equal(harness.api.applyRestoredPageViewState(tab, 'page_saved'), true);
  assert.deepEqual(tab.pageViewStates.page_saved.checkedHighlightGroupIds, ['highlight_a']);
  assert.deepEqual(tab.viewState.checkedHighlightGroupIds, ['highlight_a']);
  assert.deepEqual(tab.pageViewStates.page_saved.markdownStructuralFolds, [{
    kind: 'heading', physicalLineId: 'saved-heading', lineIndex: 3, depth: 2
  }]);
  assert.deepEqual(tab.viewState.markdownStructuralFolds, [{
    kind: 'heading', physicalLineId: 'saved-heading', lineIndex: 3, depth: 2
  }]);
  assert.deepEqual(tab.pageViewStates.page_saved.infoPanels[0], {
    kind: 'block', ownerId: 'block_a', x: 31, y: 42,
    width: 355, height: 244, z: 3, minimized: false, autoPositioned: false
  });
  assert.deepEqual(harness.restoredWidths, ['left', 'right']);
});

test('a persisted Page view folds legacy frame position into camera once and does not leak', async () => {
  const harness = await rendererHarness();
  harness.api.restoreWorkspaceState({
    exists: true,
    workspaceState: {
      lastOpenedPageId: 'page_saved',
      pageViewStates: {
        page_saved: {
          panX: 500,
          panY: -120,
          zoom: 1.4,
          viewportInitialized: true,
          markdownFrameOffsetX: 65,
          markdownFrameWidth: 730,
          markdownFramePreferredWidth: 730,
          markdownStructuralFolds: [{
            kind: 'list', physicalLineId: 'startup-list', lineIndex: 6, depth: 2
          }]
        }
      }
    }
  });

  const startupTab = { currentPageId: 'page_saved', pageViewStates: {}, viewState: {} };
  assert.equal(harness.api.applyRestoredPageViewState(startupTab, 'page_saved'), true);
  assert.equal(startupTab.viewState.panX, 591);
  assert.equal(Object.hasOwn(startupTab.viewState, 'markdownFrameOffsetX'), false);
  assert.equal(Object.hasOwn(startupTab.viewState, 'markdownFrameWidth'), false);
  assert.equal(Object.hasOwn(startupTab.viewState, 'markdownFramePreferredWidth'), false);
  assert.deepEqual(startupTab.viewState.markdownStructuralFolds, [{
    kind: 'list', physicalLineId: 'startup-list', lineIndex: 6, depth: 2
  }]);

  const freshTab = { currentPageId: 'page_saved', pageViewStates: {}, viewState: {} };
  assert.equal(harness.api.applyRestoredPageViewState(freshTab, 'page_saved'), false);
  assert.deepEqual(freshTab.pageViewStates, {});
  assert.deepEqual(freshTab.viewState, {});
});

test('collected and flushed workspace state excludes every transient interaction state', async () => {
  const harness = await rendererHarness();
  harness.context.workspace = {
    state: {
      panes: [{
        session: {
          tabs: () => [{
            currentPageId: 'page_current',
            viewState: {
              panX: 5,
              markdownStructuralFolds: [{
                kind: 'heading', physicalLineId: 'current-heading', lineIndex: 1, depth: 1
              }]
            },
            pageViewStates: {
              page_kept: {
                panX: 10,
                markdownStructuralFolds: [{
                  kind: 'list', physicalLineId: null, lineIndex: 4, depth: 2
                }]
              },
              page_deleted: { panX: 20 }
            }
          }]
        }
      }]
    }
  };
  harness.context.getActivePane = () => harness.context.workspace.state.panes[0];
  harness.api.enableWorkspaceStatePersistence();
  const snapshot = harness.api.collectWorkspaceState();
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'categoryFilterPanelOpen',
    'collapsedCategoryFilterGroupIds',
    'collapsedRightSectionIds',
    'externalLinkTargetMode',
    'leftSidebarOpen',
    'leftSidebarWidth',
    'pageViewStates',
    'rightSectionHeights',
    'rightSidebarOpen',
    'rightSidebarView',
    'rightSidebarWidth',
    'searchPanelOpen',
    'searchText',
    'selectedCategoryFilterIds',
    'version'
  ]);
  for (const transient of [
    'contextMenu', 'drag', 'rename', 'selection', 'linkPickMode', 'modal', 'draft', 'editMode', 'focus'
  ]) {
    assert.equal(Object.hasOwn(snapshot, transient), false);
  }
  assert.deepEqual(Object.keys(snapshot.pageViewStates).sort(), ['page_current', 'page_kept']);
  assert.deepEqual(snapshot.pageViewStates.page_current.markdownStructuralFolds, [{
    kind: 'heading', physicalLineId: 'current-heading', lineIndex: 1, depth: 1
  }]);
  assert.deepEqual(snapshot.pageViewStates.page_kept.markdownStructuralFolds, [{
    kind: 'list', physicalLineId: null, lineIndex: 4, depth: 2
  }]);

  await harness.api.flushWorkspaceStateNow();
  assert.equal(harness.savedSnapshots.length, 1);
  assert.equal(Object.hasOwn(harness.savedSnapshots[0], 'lastOpenedPageId'), false);
});

test('workspace shutdown flush waits for Info saves before serializing state', async () => {
  const harness = await rendererHarness();
  const sequence = [];
  let releaseInfoSave;
  const infoSave = new Promise((resolve) => { releaseInfoSave = resolve; });
  harness.context.flushInfoPanelSavesNow = async () => {
    sequence.push('info-start');
    await infoSave;
    sequence.push('info-finished');
  };
  harness.context.window.cneDesktop.setWorkspaceState = async (snapshot) => {
    sequence.push('workspace-saved');
    harness.savedSnapshots.push(snapshot);
    return { ok: true, exists: true, workspaceState: snapshot };
  };
  harness.api.enableWorkspaceStatePersistence();

  let flushSettled = false;
  const flushing = harness.api.flushWorkspaceStateNow().then(() => { flushSettled = true; });
  await Promise.resolve();
  assert.deepEqual(sequence, ['info-start']);
  assert.equal(harness.savedSnapshots.length, 0);
  assert.equal(flushSettled, false);

  releaseInfoSave();
  await flushing;
  assert.deepEqual(sequence, ['info-start', 'info-finished', 'workspace-saved']);
  assert.equal(harness.savedSnapshots.length, 1);
  assert.equal(flushSettled, true);
});

test('workspace shutdown waits for the single Vault Appearance store tail', async () => {
  const harness = await rendererHarness();
  const sequence = [];
  let releaseAppearanceSave;
  const appearanceSave = new Promise((resolve) => { releaseAppearanceSave = resolve; });
  harness.context.flushVaultAppearanceSavesNow = async () => {
    sequence.push('appearance-start');
    await appearanceSave;
    sequence.push('appearance-finished');
  };
  harness.context.window.cneDesktop.setWorkspaceState = async (snapshot) => {
    sequence.push('workspace-saved');
    harness.savedSnapshots.push(snapshot);
    return { ok: true, exists: true, workspaceState: snapshot };
  };
  harness.api.enableWorkspaceStatePersistence();

  let flushSettled = false;
  const flushing = harness.api.flushWorkspaceStateNow().then(() => { flushSettled = true; });
  await Promise.resolve();
  assert.deepEqual(sequence, ['appearance-start']);
  assert.equal(harness.savedSnapshots.length, 0);
  assert.equal(flushSettled, false);

  releaseAppearanceSave();
  await flushing;
  assert.deepEqual(sequence, [
    'appearance-start',
    'appearance-finished',
    'workspace-saved'
  ]);
  assert.equal(harness.savedSnapshots.length, 1);
  assert.equal(flushSettled, true);
});

test('ordinary workspace flush waits for the Sort queue and never serializes its runtime projection', async () => {
  const harness = await rendererHarness();
  const sequence = [];
  let releaseSortSave;
  const sortSave = new Promise((resolve) => { releaseSortSave = resolve; });
  harness.context.navigationSortMode = 'created_desc';
  harness.context.flushNavigationSortModeSavesNow = async () => {
    sequence.push('sort-start');
    await sortSave;
    sequence.push('sort-finished');
    return { ok: true };
  };
  harness.context.window.cneDesktop.setWorkspaceState = async (snapshot) => {
    sequence.push('workspace-saved');
    harness.savedSnapshots.push(snapshot);
    return { ok: true, exists: true, workspaceState: snapshot };
  };
  harness.api.enableWorkspaceStatePersistence();

  let flushSettled = false;
  const flushing = harness.api.flushWorkspaceStateNow().then((result) => {
    flushSettled = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(sequence, ['sort-start']);
  assert.equal(flushSettled, false);
  assert.equal(harness.savedSnapshots.length, 0);

  releaseSortSave();
  assert.equal((await flushing).ok, true);
  assert.deepEqual(sequence, ['sort-start', 'sort-finished', 'workspace-saved']);
  assert.equal(harness.savedSnapshots.length, 1);
  assert.equal(Object.hasOwn(harness.savedSnapshots[0], 'navigationSortMode'), false);
  assert.equal(harness.context.navigationSortMode, 'created_desc');
});

test('workspace shutdown reports a failed content flush and does not serialize state', async () => {
  const harness = await rendererHarness();
  let workspaceWrites = 0;
  harness.context.flushInfoPanelSavesNow = async () => ({
    ok: false,
    error: 'simulated Info write failure'
  });
  harness.context.window.cneDesktop.setWorkspaceState = async () => {
    workspaceWrites += 1;
    return { ok: true };
  };

  harness.api.enableWorkspaceStatePersistence();
  const result = await harness.api.flushWorkspaceStateNow();
  assert.equal(result.ok, false);
  assert.match(result.error, /simulated Info write failure/);
  assert.equal(workspaceWrites, 0);
});

test('startup, mutation wiring, and shutdown flush form one workspace restoration lifecycle', async () => {
  const [html, preload, main, app, bootstrap, navigation, sidebar, rightSidebar, workspaceUi] = await Promise.all([
    read('public/index.html'),
    read('desktop/preload.js'),
    read('desktop/main.js'),
    read('public/app.js'),
    read('public/js/appBootstrap.js'),
    read('public/js/navigation.js'),
    read('public/js/sidebarResize.js'),
    read('public/js/rightSidebar.js'),
    read('public/js/workspaceState.js')
  ]);

  assert.match(html, /workspaceState\.js[\s\S]*?app\.js[\s\S]*?js\/workspaceState\.js[\s\S]*?js\/appBootstrap\.js/);
  assert.match(preload, /getWorkspaceState:[\s\S]*?cne-desktop:get-workspace-state/);
  assert.match(preload, /setWorkspaceState:[\s\S]*?cne-desktop:set-workspace-state/);
  assert.match(main, /migrateVaultWorkspaceStateNavigationSort\([\s\S]*runtime\.vaultInfo\.vaultRoot/);
  assert.match(main, /updateVaultWorkspaceState\(runtime\.vaultInfo\.vaultRoot/);
  assert.match(main, /app\.on\('before-quit',[\s\S]*?flushRendererWorkspaceState\(runtime\.window/);
  assert.match(main, /window\.on\('close',[\s\S]*?flushRendererWorkspaceState\(window/);
  assert.match(main, /async function flushRendererWorkspaceState[\s\S]*?document\.activeElement\?\.blur[\s\S]*?root\.inert = true[\s\S]*?holdInteraction/);
  assert.match(main, /window\.on\('close',[\s\S]*?holdInteraction: true[\s\S]*?\.catch\(\(error\) =>/);
  assert.match(main, /let quitFlushPending = false[\s\S]*?if \(quitFlushPending\) return[\s\S]*?quittingForServerClose = true[\s\S]*?app\.quit\(\)/);
  assert.match(bootstrap, /loadWorkspaceState\(\)[\s\S]*?restoreWorkspaceState\(savedWorkspaceState\)[\s\S]*?renderPageList\(\)/);
  assert.match(bootstrap, /const preferredPageId = project\.lastOpenedPageId/);
  assert.doesNotMatch(bootstrap, /restoredWorkspaceState\?\.lastOpenedPageId/);
  assert.doesNotMatch(workspaceUi, /lastOpenedPageId/);
  assert.match(app, /async function persistLastOpenedPage[\s\S]*?PATCH[\s\S]*?lastOpenedPageId/);
  assert.match(app, /renderPage\(runtime, runtime\.currentPage, \{ installCanonical: false \}\);[\s\S]*?await persistLastOpenedPage\(page\.id\)/);
  assert.match(app, /setLeftSidebarOpen[\s\S]*?scheduleWorkspaceStateSave\(\)/);
  assert.match(app, /descriptorSearchText = input\.value;[\s\S]*?scheduleWorkspaceStateSave\(\)/);
  assert.doesNotMatch(navigation, /if \(persist && typeof scheduleWorkspaceStateSave/);
  assert.match(sidebar, /setSidebarRememberedWidth[\s\S]*?scheduleWorkspaceStateSave\(\)/);
  assert.match(rightSidebar, /collapsedRightSectionIds[\s\S]*?updateRightSidebarLayout\(\);[\s\S]*?scheduleWorkspaceStateSave\(\)/);
  assert.doesNotMatch(workspaceUi, /selectedNavigationItems|folderRenameState|pageMetaModal|blockEditMode|linkPickMode/);
});
