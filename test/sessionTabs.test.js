const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  createTabSession,
  normalizeMarkdownStructuralFolds
} = require('../public/sessionTabs');
const tabStripLayout = require('../public/tabStripLayout');
const tabPagePreview = require('../public/tabPagePreview');

const read = (file) => fs.readFile(path.join(__dirname, '..', file), 'utf8');

function session() {
  let next = 0;
  return createTabSession({ createId: () => `tab_${++next}` });
}

test('Tabs own independent branching histories', () => {
  const tabs = session();
  const first = tabs.reset('A');
  tabs.navigateActive('B', { mode: 'push' });
  const second = tabs.createTab('C');
  tabs.navigateActive('D', { mode: 'push' });
  tabs.activateTab(first.id);
  const back = tabs.historyTarget(-1, () => true);
  tabs.navigateActive(back.pageId, { mode: 'back-forward', historyIndex: back.index });
  tabs.navigateActive('E', { mode: 'push' });
  assert.deepEqual(tabs.tabById(first.id).history, ['A', 'E']);
  assert.deepEqual(tabs.tabById(second.id).history, ['C', 'D']);
});

test('ordinary Page reuse chooses the most recently active duplicate Tab', () => {
  const tabs = session();
  const first = tabs.reset('same');
  tabs.createTab('other');
  const duplicate = tabs.createTab('same');
  tabs.activateTab(first.id);
  tabs.activateTab(duplicate.id);
  assert.equal(tabs.mostRecentTabForPage('same').id, duplicate.id);
  assert.equal(tabs.tabs().length, 3);
});

test('replacing the active Tab Page keeps its identity and creates a clean history root', () => {
  const tabs = session();
  const tab = tabs.reset('A');
  tabs.saveViewState(tab.id, {
    panX: 44, panY: 55, zoom: 2.4, viewportInitialized: true,
    activeHighlightGroupId: 'old-highlight',
    highlightDisplayState: { enabled: true, dimmed: true }
  });
  tabs.navigateActive('B', { mode: 'push' });
  tabs.saveViewState(tab.id, {
    panX: 66, panY: 77, zoom: 3.1, viewportInitialized: true,
    activeHighlightGroupId: 'other-highlight',
    highlightDisplayState: { enabled: true, dimmed: false }
  });
  tabs.navigateActive('C', { mode: 'push' });

  tabs.navigateActive('A', { mode: 'replace' });

  assert.equal(tabs.activeTab().id, tab.id);
  assert.equal(tabs.tabs().length, 1);
  assert.equal(tabs.activeTab().currentPageId, 'A');
  assert.deepEqual(tabs.activeTab().history, ['A']);
  assert.equal(tabs.activeTab().historyIndex, 0);
  assert.equal(tabs.activeTab().viewState.zoom, 1);
  assert.equal(tabs.activeTab().viewState.viewportInitialized, false);
  assert.equal(tabs.activeTab().viewState.activeHighlightGroupId, null);
  assert.deepEqual(tabs.activeTab().pageViewStates, {});
  assert.equal(tabs.historyTarget(-1, () => true), null);
  assert.equal(tabs.historyTarget(1, () => true), null);
});

test('closing a Tab destroys its view instance without affecting a duplicate Tab', () => {
  const tabs = session();
  const closing = tabs.reset('A');
  tabs.saveViewState(closing.id, {
    panX: 10, panY: 20, zoom: 2, viewportInitialized: true,
    activeHighlightGroupId: 'closing-highlight',
    highlightDisplayState: { enabled: true, dimmed: true }
  });
  const survivor = tabs.createTab('A');
  tabs.saveViewState(survivor.id, {
    panX: 90, panY: 80, zoom: 3, viewportInitialized: true,
    activeHighlightGroupId: 'surviving-highlight',
    highlightDisplayState: { enabled: true, dimmed: false }
  });

  tabs.closeTab(closing.id);

  assert.equal(tabs.tabById(closing.id), null);
  assert.equal(tabs.tabById(survivor.id).viewState.zoom, 3);
  assert.equal(tabs.tabById(survivor.id).viewState.activeHighlightGroupId, 'surviving-highlight');

  tabs.closeTab(survivor.id);
  const fresh = tabs.activeTab();
  tabs.navigateActive('A', { mode: 'replace' });
  assert.notEqual(fresh.id, closing.id);
  assert.notEqual(fresh.id, survivor.id);
  assert.deepEqual(fresh.history, ['A']);
  assert.equal(fresh.viewState.zoom, 1);
  assert.equal(fresh.viewState.activeHighlightGroupId, null);
});

test('Tab view state retains camera per Page while retiring legacy frame ownership', () => {
  const tabs = session();
  const first = tabs.reset('A');
  tabs.saveViewState(first.id, {
    panX: 10, panY: 20, zoom: 2, viewportInitialized: true,
    markdownFrameOffsetX: 84,
    markdownFrameWidth: 560,
    markdownFramePreferredWidth: 612,
    markdownFrameConstraintSide: 'right',
    activeHighlightGroupId: 'alpha', highlightDisplayState: { enabled: true, dimmed: true }
  });
  tabs.navigateActive('B', { mode: 'push' });
  tabs.saveViewState(first.id, {
    panX: 50, panY: 60, zoom: 3, viewportInitialized: true,
    activeHighlightGroupId: 'beta', highlightDisplayState: { enabled: true, dimmed: false }
  });
  tabs.navigateActive('A', { mode: 'back-forward', historyIndex: 0 });
  assert.equal(tabs.activeTab().viewState.zoom, 2);
  assert.equal(tabs.activeTab().viewState.panX, 178);
  for (const field of [
    'markdownFrameOffsetX',
    'markdownFrameWidth',
    'markdownFramePreferredWidth',
    'markdownFrameConstraintSide'
  ]) {
    assert.equal(Object.hasOwn(tabs.activeTab().viewState, field), false);
  }
  assert.equal(tabs.activeTab().viewState.activeHighlightGroupId, 'alpha');

  const duplicate = tabs.createTab('A');
  assert.equal(duplicate.viewState.zoom, 1);
  assert.equal(duplicate.viewState.panX, 0);
  assert.equal(Object.hasOwn(duplicate.viewState, 'markdownFrameOffsetX'), false);
  assert.equal(Object.hasOwn(duplicate.viewState, 'markdownFrameWidth'), false);
  assert.equal(Object.hasOwn(duplicate.viewState, 'markdownFramePreferredWidth'), false);
  assert.equal(Object.hasOwn(duplicate.viewState, 'markdownFrameConstraintSide'), false);
  assert.equal(duplicate.viewState.activeHighlightGroupId, null);
});

test('Markdown structural folds normalize, deduplicate, clone, and cap descriptors', () => {
  const source = [
    { kind: 'heading', physicalLineId: 'line-heading', lineIndex: 2, depth: 2 },
    { kind: 'heading', physicalLineId: 'line-heading', lineIndex: 99, depth: 4 },
    { kind: 'list', physicalLineId: null, lineIndex: 5, depth: 1 },
    { kind: 'list', lineIndex: 5, depth: 1 },
    { kind: 'list', physicalLineId: null, lineIndex: 5, depth: 2 },
    { kind: 'list', physicalLineId: 'line-heading', lineIndex: 6, depth: 1 },
    { kind: 'heading', physicalLineId: '', lineIndex: 7, depth: 1 },
    { kind: 'quote', physicalLineId: 'line-invalid-kind', lineIndex: 8, depth: 1 },
    { kind: 'heading', physicalLineId: 'line-invalid-index', lineIndex: -1, depth: 1 },
    { kind: 'heading', physicalLineId: 'line-invalid-depth', lineIndex: 9, depth: 0 },
    null
  ];

  const normalized = normalizeMarkdownStructuralFolds(source);
  assert.deepEqual(normalized, [
    { kind: 'heading', physicalLineId: 'line-heading', lineIndex: 2, depth: 2 },
    { kind: 'list', physicalLineId: null, lineIndex: 5, depth: 1 },
    { kind: 'list', physicalLineId: null, lineIndex: 5, depth: 2 },
    { kind: 'list', physicalLineId: 'line-heading', lineIndex: 6, depth: 1 },
    { kind: 'heading', physicalLineId: null, lineIndex: 7, depth: 1 }
  ]);
  assert.notEqual(normalized[0], source[0]);
  source[0].depth = 42;
  assert.equal(normalized[0].depth, 2);
  assert.deepEqual(normalizeMarkdownStructuralFolds('invalid'), []);

  const oversized = Array.from({ length: 2005 }, (_, lineIndex) => ({
    kind: lineIndex % 2 ? 'list' : 'heading',
    physicalLineId: null,
    lineIndex,
    depth: 1
  }));
  const capped = normalizeMarkdownStructuralFolds(oversized);
  assert.equal(capped.length, 2000);
  assert.equal(capped[0].lineIndex, 0);
  assert.equal(capped[1999].lineIndex, 1999);
});

test('Markdown structural folds remain independent per Page and duplicate Tab', () => {
  const tabs = session();
  const first = tabs.reset('A');
  assert.deepEqual(first.viewState.markdownStructuralFolds, []);

  const pageAFolds = [
    { kind: 'heading', physicalLineId: 'a-heading', lineIndex: 1, depth: 1 },
    { kind: 'list', physicalLineId: 'a-list', lineIndex: 4, depth: 2 }
  ];
  tabs.saveViewState(first.id, { markdownStructuralFolds: pageAFolds });
  const firstAfterSave = tabs.tabById(first.id);
  assert.deepEqual(firstAfterSave.viewState.markdownStructuralFolds, pageAFolds);
  assert.deepEqual(firstAfterSave.pageViewStates.A.markdownStructuralFolds, pageAFolds);
  assert.notEqual(
    firstAfterSave.viewState.markdownStructuralFolds,
    firstAfterSave.pageViewStates.A.markdownStructuralFolds
  );
  assert.notEqual(
    firstAfterSave.viewState.markdownStructuralFolds[0],
    firstAfterSave.pageViewStates.A.markdownStructuralFolds[0]
  );

  pageAFolds[0].depth = 99;
  pageAFolds.push({ kind: 'heading', physicalLineId: 'late-mutation', lineIndex: 20, depth: 1 });
  assert.equal(firstAfterSave.viewState.markdownStructuralFolds[0].depth, 1);
  assert.equal(firstAfterSave.viewState.markdownStructuralFolds.length, 2);

  firstAfterSave.viewState.markdownStructuralFolds[0].depth = 3;
  firstAfterSave.viewState.markdownStructuralFolds.push({
    kind: 'list', physicalLineId: 'view-only', lineIndex: 9, depth: 1
  });
  assert.equal(firstAfterSave.pageViewStates.A.markdownStructuralFolds[0].depth, 1);
  assert.equal(firstAfterSave.pageViewStates.A.markdownStructuralFolds.length, 2);

  tabs.navigateActive('B', { mode: 'push' });
  tabs.saveViewState(first.id, {
    markdownStructuralFolds: [
      { kind: 'list', physicalLineId: 'b-list', lineIndex: 3, depth: 1 }
    ]
  });
  tabs.navigateActive('A', { mode: 'back-forward', historyIndex: 0 });
  assert.deepEqual(tabs.activeTab().viewState.markdownStructuralFolds, [
    { kind: 'heading', physicalLineId: 'a-heading', lineIndex: 1, depth: 1 },
    { kind: 'list', physicalLineId: 'a-list', lineIndex: 4, depth: 2 }
  ]);

  const duplicate = tabs.createTab('A');
  assert.deepEqual(duplicate.viewState.markdownStructuralFolds, []);
  tabs.saveViewState(duplicate.id, {
    markdownStructuralFolds: [
      { kind: 'heading', physicalLineId: 'duplicate-heading', lineIndex: 0, depth: 1 }
    ]
  });
  assert.deepEqual(tabs.tabById(first.id).pageViewStates.A.markdownStructuralFolds, [
    { kind: 'heading', physicalLineId: 'a-heading', lineIndex: 1, depth: 1 },
    { kind: 'list', physicalLineId: 'a-list', lineIndex: 4, depth: 2 }
  ]);
  assert.deepEqual(tabs.tabById(duplicate.id).viewState.markdownStructuralFolds, [
    { kind: 'heading', physicalLineId: 'duplicate-heading', lineIndex: 0, depth: 1 }
  ]);
});

test('checked Highlight Groups are independent per Tab and per Page view', () => {
  const tabs = session();
  const first = tabs.reset('A');
  tabs.saveViewState(first.id, {
    checkedHighlightGroupIds: ['group_a', 'group_b'],
    activeHighlightGroupId: 'group_a',
    highlightDisplayState: { enabled: true, dimmed: true }
  });
  tabs.navigateActive('B', { mode: 'push' });
  tabs.saveViewState(first.id, { checkedHighlightGroupIds: ['group_c'] });
  tabs.navigateActive('A', { mode: 'back-forward', historyIndex: 0 });
  assert.deepEqual(tabs.activeTab().viewState.checkedHighlightGroupIds, ['group_a', 'group_b']);

  const duplicate = tabs.createTab('A');
  assert.deepEqual(duplicate.viewState.checkedHighlightGroupIds, []);
  tabs.saveViewState(duplicate.id, { checkedHighlightGroupIds: ['group_b'] });
  assert.deepEqual(tabs.tabById(first.id).viewState.checkedHighlightGroupIds, ['group_a', 'group_b']);
  assert.deepEqual(tabs.tabById(duplicate.id).viewState.checkedHighlightGroupIds, ['group_b']);
});

test('closing prefers the left Tab and leaves one empty Tab after the last close', () => {
  const tabs = session();
  const first = tabs.reset('A');
  const second = tabs.createTab('B');
  const third = tabs.createTab('C');
  assert.equal(tabs.closeTab(third.id).id, second.id);
  assert.equal(tabs.closeTab(second.id).id, first.id);
  const empty = tabs.closeTab(first.id);
  assert.equal(empty.currentPageId, null);
  assert.deepEqual(empty.history, []);
  assert.equal(empty.historyIndex, -1);
});

test('a Pane owner may close its final Tab without creating a replacement shell', () => {
  const tabs = session();
  const only = tabs.reset('A');

  assert.equal(tabs.closeTab(only.id, { ensureEmptyTab: false }), null);
  assert.deepEqual(tabs.tabs(), []);
  assert.equal(tabs.activeTab(), null);
});

test('same-strip reorder moves one stable Tab object without changing active or view state', () => {
  const tabs = session();
  const first = tabs.reset('A');
  const second = tabs.createTab('B');
  const third = tabs.createTab('C');
  tabs.saveViewState(second.id, {
    panX: 30, panY: 40, zoom: 2.5, viewportInitialized: true,
    activeHighlightGroupId: 'group_b', highlightDisplayState: { enabled: true, dimmed: true }
  });
  tabs.activateTab(first.id);
  const secondReference = tabs.tabById(second.id);

  assert.equal(tabs.reorderTab(second.id, 2), true);
  assert.deepEqual(tabs.tabs().map((tab) => tab.id), [first.id, third.id, second.id]);
  assert.equal(tabs.tabById(second.id), secondReference);
  assert.equal(tabs.tabById(second.id).viewState.zoom, 2.5);
  assert.equal(tabs.tabById(second.id).viewState.activeHighlightGroupId, 'group_b');
  assert.equal(tabs.activeTab().id, first.id);
  assert.equal(tabs.reorderTab(second.id, 2), false);
});

test('transferring a Tab preserves its stable object and leaves an empty source shell', () => {
  const source = createTabSession({ createId: (() => {
    let id = 0;
    return () => `source-${++id}`;
  })() });
  const target = createTabSession();
  const tab = source.reset('page-a');
  source.navigateActive('page-b', { mode: 'push' });
  source.saveViewState(tab.id, { panX: 73, panY: 12, zoom: 1.8 });

  const extracted = source.extractTab(tab.id);
  assert.equal(extracted, tab);
  assert.equal(source.tabs().length, 1);
  assert.equal(source.activeTab().currentPageId, null);
  assert.equal(target.insertTab(extracted), tab);
  assert.equal(target.activeTab(), tab);
  assert.deepEqual(tab.history, ['page-a', 'page-b']);
  assert.equal(tab.historyIndex, 1);
  assert.equal(tab.viewState.panX, 73);
  assert.equal(tab.viewState.zoom, 1.8);
});

test('explicit Page insertion creates one clean-history Tab at the requested gap', () => {
  const tabs = session();
  const first = tabs.reset('A');
  const third = tabs.createTab('C');
  const second = tabs.createTab('B', { insertionIndex: 1 });
  assert.deepEqual(tabs.tabs().map((tab) => tab.id), [first.id, second.id, third.id]);
  assert.equal(tabs.activeTab().id, second.id);
  assert.deepEqual(second.history, ['B']);
  assert.equal(second.historyIndex, 0);
});

test('explicit multi-Page Tab drop reuses stable Tabs and inserts one contiguous visible-order run', async () => {
  const tabs = session();
  const alpha = tabs.reset('alpha');
  const outside = tabs.createTab('outside');
  const gamma = tabs.createTab('gamma');
  const tail = tabs.createTab('tail');
  tabs.saveViewState(alpha.id, { panX: 14, panY: 9, zoom: 1.7 });
  tabs.saveViewState(gamma.id, { panX: 31, panY: 12, zoom: 2.1 });
  const alphaReference = tabs.tabById(alpha.id);
  const gammaReference = tabs.tabById(gamma.id);
  const placement = tabs.placePagesContiguously(
    ['alpha', 'beta', 'gamma', 'alpha'],
    { insertionIndex: 2, activePageId: 'gamma' }
  );

  assert.deepEqual(tabs.tabs().map((tab) => tab.currentPageId), [
    'outside', 'alpha', 'beta', 'gamma', 'tail'
  ]);
  assert.deepEqual(placement.placedTabs.map((tab) => tab.currentPageId), [
    'alpha', 'beta', 'gamma'
  ]);
  assert.equal(placement.createdTabIds.length, 1);
  assert.equal(tabs.tabById(placement.createdTabIds[0]).currentPageId, 'beta');
  assert.equal(tabs.tabById(alpha.id), alphaReference);
  assert.equal(tabs.tabById(gamma.id), gammaReference);
  assert.equal(tabs.tabById(alpha.id).viewState.zoom, 1.7);
  assert.equal(tabs.tabById(gamma.id).viewState.zoom, 2.1);
  assert.equal(placement.activeTab, gammaReference);
  assert.equal(tabs.activeTab().currentPageId, 'gamma');
  assert.equal(tabs.tabs().filter((tab) => tab.currentPageId === 'alpha').length, 1);
  assert.equal(tabs.tabs().filter((tab) => tab.currentPageId === 'gamma').length, 1);

  const app = await read('public/app.js');
  const commit = app.slice(
    app.indexOf('async function commitSidebarPageBatchTabDrop'),
    app.indexOf('function finishSharedPageDragForPaneCommit')
  );
  assert.match(commit, /descriptor\?\.explicitMultiSelection/);
  assert.match(commit, /descriptor\?\.tabPageIds/);
  assert.match(commit, /session\.placePagesContiguously\(pageIds, \{/);
  assert.match(commit, /insertionIndex: target\.insertionIndex/);
  assert.match(commit, /activePageId: descriptor\.primaryPageId/);
  assert.match(commit, /enteringTabIds: placement\.createdTabIds/);
});

test('Viewer centralizes same-Tab Page navigation while sidebar activation stays in the active Pane', async () => {
  const [app, navigation, menu, rightSidebar, externalLinks] = await Promise.all([
    read('public/app.js'),
    read('public/js/navigation.js'),
    read('desktop/nativeContextMenu.js'),
    read('public/js/rightSidebar.js'),
    read('public/js/externalLinks.js')
  ]);
  const ownerStart = app.indexOf('async function navigateCurrentTabToPage');
  const ownerEnd = app.indexOf('async function switchToTab', ownerStart);
  assert.ok(ownerStart >= 0 && ownerEnd > ownerStart);
  const navigationOwner = app.slice(ownerStart, ownerEnd);
  assert.match(navigationOwner, /navigationKind === 'history-traversal'[\s\S]*?historyMode: 'back-forward'/);
  assert.match(navigationOwner, /navigationKind === 'normal'[\s\S]*?historyMode: 'push'/);
  assert.match(navigationOwner, /loadPage\(runtime, targetPageEntry, \{[\s\S]*?\.\.\.historyOptions/);
  assert.match(navigationOwner, /resolvedPage\?\.id === targetPageId \? \{ resolvedPage \} : \{\}/);
  assert.doesNotMatch(navigationOwner, /completePageOpen\(/);
  assert.doesNotMatch(app.slice(0, ownerStart) + app.slice(ownerEnd), /historyMode: 'push'/);
  assert.doesNotMatch(app, /navigateToPageId/);
  const sidebarOpen = app.match(/function openPageFromSidebar\(pageId\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sidebarOpen, /if \(!active\)[\s\S]*?runtime\.session\.createTab\(null\)[\s\S]*?active = activeTab\(runtime\)/);
  assert.match(sidebarOpen, /workspaceTabForPage\(pageId\)[\s\S]*?activateWorkspaceTab\(existing\)/);
  assert.ok(
    sidebarOpen.indexOf('workspaceTabForPage(pageId)')
      < sidebarOpen.indexOf('active?.currentPageId === null'),
    'existing-Tab activation must win before an empty Tab is populated'
  );
  assert.match(sidebarOpen, /active\?\.currentPageId === null[\s\S]*?populateActiveEmptyTab\(runtime, pageId\)/);
  assert.match(sidebarOpen, /navigateCurrentTabToPage\(runtime, pageId, \{[\s\S]*?preferCanonical: true/);
  assert.doesNotMatch(sidebarOpen, /historyMode:|loadPage\(|openPageInNewTab/);
  assert.match(app, /function workspaceTabForPageInPane\(paneId, pageId\)[\s\S]*?getWorkspacePane\(paneId\)[\s\S]*?session\?\.mostRecentTabForPage\(pageId\)/);
  assert.match(app, /function workspaceTabForPage\(pageId\) \{[\s\S]*?workspaceTabForPageInPane\(getActivePane\(\)\?\.id, pageId\)/);
  assert.doesNotMatch(app.match(/function workspaceTabForPage\(pageId\) \{[\s\S]*?\n\}/)?.[0] || '', /workspace\.state\.panes/);
  assert.match(app, /function activateWorkspaceTab[\s\S]*?getWorkspacePane\(target\.paneId\)[\s\S]*?setActiveWorkspacePane\(target\.paneId\)[\s\S]*?switchToTab\(target\.tab\.id, target\.paneId\)/);
  assert.match(navigation, /openPageFromSidebar\(page\.id\)/);
  assert.doesNotMatch(navigation, /else loadPage\(page\)/);
  assert.match(app, /target\.kind === 'page'\) navigateCurrentTabToPage\(runtime, target\.link\.targetPageId\)/);
  assert.match(externalLinks, /target\.kind === 'page'\) navigateCurrentTabToPage\(runtime, target\.link\.targetPageId\)/);
  assert.match(rightSidebar, /navigateCurrentTabToPage\(runtime, row\.pageId\)/);
  assert.match(menu, /Open in New Tab[\s\S]*?open-page-in-new-tab/);
  assert.match(app, /const canonicalPages = new Map\(\)/);
  assert.match(app, /function commitCanonicalPage[\s\S]*?canonicalPages\.set\(page\.id, page\)/);
});

test('Tab strip connects the active Canvas tab with shoulders and scoped whole-tab hover', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /\.top-tab-area \{[^}]*padding-top: 0[^}]*background: var\(--surface-tool\)/);
  assert.match(css, /\.viewer-tab-strip \{[^}]*padding-left: calc\(var\(--viewer-tab-start-inset\) - var\(--viewer-tab-shoulder-size\)\)[^}]*background-color: var\(--surface-tool\)[^}]*background-image: linear-gradient\([\s\S]*?var\(--border-tool\) calc\(100% - 1px\)/);
  assert.match(css, /\.viewer-tab-list \{[^}]*align-self: stretch[^}]*height: 100%[^}]*padding-left: var\(--viewer-tab-shoulder-size\)[^}]*padding-right: var\(--viewer-tab-shoulder-size\)/);
  assert.match(css, /\.viewer-tab \{[^}]*align-self: flex-end[^}]*height: calc\(var\(--chrome-row-one-height\) - var\(--tab-title-strip-height\)\)[^}]*background: transparent[^}]*border: 0/);
  assert.match(css, /\.viewer-tab:not\(\[data-active='true'\]\)::after \{[^}]*top: 17%[^}]*bottom: 17%[^}]*background: var\(--border-tool\)/);
  assert.match(css, /--viewer-tab-preferred-width: 180px;/);
  assert.equal(tabStripLayout.MINIMUM_INACTIVE_TAB_WIDTH, 34);
  assert.match(css, /\.viewer-tab \{[^}]*flex: 0 0 var\(--viewer-tab-inactive-width\)[^}]*min-width: var\(--viewer-tab-inactive-width\)[^}]*max-width: var\(--viewer-tab-inactive-width\)/);
  assert.match(css, /--viewer-tab-shoulder-size: 8px/);
  assert.match(css, /\.viewer-tab\[data-active='true'\] \{[^}]*border: 1px solid var\(--border-tool\)[^}]*border-bottom: 0[^}]*border-radius: 5px 5px 0 0[^}]*background: var\(--viewer-active-tab-surface\)/);
  assert.match(css, /\.viewer-tab\[data-active='true'\]::before,[\s\S]*?\.viewer-tab\[data-active='true'\]::after \{[^}]*bottom: 0[^}]*--viewer-tab-shoulder-size/);
  assert.match(css, /radial-gradient\([\s\S]*?var\(--border-tool\)[\s\S]*?var\(--viewer-active-tab-surface\)/);
  assert.match(css, /\.viewer-tab:not\(\[data-active='true'\]\):hover,[\s\S]*?background: var\(--accent-strong\)/);
  assert.doesNotMatch(css, /\.viewer-tab\[data-active='true'\]:hover[^}]*background/);
  assert.match(css, /\.viewer-tab-title,[\s\S]*?\.viewer-tab-add,[\s\S]*?\.viewer-tab-menu \{[^}]*border: 0;[^}]*background: transparent/);
  assert.match(css, /\.viewer-tab-add \{[^}]*align-self: center[^}]*height: 30px[^}]*padding: 0;[^}]*font-size:/);
  assert.doesNotMatch(css.match(/\.viewer-tab-add \{[^}]*padding: 0;[^}]*\}/)?.[0] || '', /border-right:/);
  assert.match(css, /\.viewer-tab-close \{[^}]*opacity: 0;[^}]*pointer-events: none/);
  assert.match(css, /\.viewer-tab\[data-active='true'\] \.viewer-tab-close,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto/);
  assert.match(css, /\.viewer-tab\[data-close-on-hover='true'\]:not\(\[data-active='true'\]\):hover \.viewer-tab-close/);
  assert.match(css, /\.viewer-tab-close:hover,[\s\S]*?color: var\(--system-text-colour\);[^}]*background: transparent/);
  assert.match(css, /\.viewer-tab-add::before \{[^}]*width: 30px[^}]*height: 30px[^}]*border-radius: 5px[^}]*background: transparent/);
  assert.match(css, /\.viewer-tab-add:hover::before,[\s\S]*?background: var\(--accent-strong\)/);
  assert.match(css, /\.viewer-tab-title \{[^}]*font-family: var\(--font-system-family\)[^}]*font-size: 14px[^}]*font-weight: 400/);
  assert.match(css, /\.left-top-toolbar \{[^}]*border-right: 1px solid var\(--border-tool\)/);
  assert.match(css, /\.workspace-sidebar-toggle-cell \{[^}]*flex: 0 0 36px/);
  assert.match(css, /body\.left-sidebar-collapsed \{[^}]*--viewer-tab-start-inset: var\(--viewer-tab-shoulder-size\)/);
  assert.match(css, /\.viewer-tab-strip \{[\s\S]*?-webkit-app-region: drag/);
  assert.match(css, /\.viewer-tab-list \{[\s\S]*?-webkit-app-region: drag/);
  assert.match(css, /\.viewer-tab \{[^}]*-webkit-app-region: no-drag/);
  assert.match(css, /\.viewer-tab-title,[\s\S]*?\.viewer-tab-add,[\s\S]*?\.viewer-tab-menu \{[^}]*-webkit-app-region: no-drag/);
});

test('Tab sizing keeps a preferred active width, compresses inactive Tabs equally, then scrolls', () => {
  assert.deepEqual(tabStripLayout.calculateTabSizing({
    availableWidth: 600,
    tabCount: 3
  }), {
    activeWidth: 180,
    inactiveWidth: 180,
    inactiveCount: 2,
    scrolling: false
  });

  assert.deepEqual(tabStripLayout.calculateTabSizing({
    availableWidth: 400,
    tabCount: 3
  }), {
    activeWidth: 180,
    inactiveWidth: 110,
    inactiveCount: 2,
    scrolling: false
  });

  assert.deepEqual(tabStripLayout.calculateTabSizing({
    availableWidth: 200,
    tabCount: 4
  }), {
    activeWidth: 180,
    inactiveWidth: 34,
    inactiveCount: 3,
    scrolling: true
  });
});

test('minimum Tab labels preserve the first complete Unicode grapheme', () => {
  assert.equal(tabStripLayout.firstGrapheme('Name'), 'N');
  assert.equal(tabStripLayout.firstGrapheme('e\u0301lan'), 'e\u0301');
  assert.equal(tabStripLayout.firstGrapheme('👩‍🔬 Lab'), '👩‍🔬');
  assert.equal(tabStripLayout.firstGraphemes('👩‍🔬Name', 3), '👩‍🔬Na');
});

test('reorder geometry uses the dragged leading edge, provisional slots, and hysteresis', () => {
  const equalSlots = [
    { id: 'A', left: 0, width: 100, center: 50 },
    { id: 'B', left: 100, width: 100, center: 150 },
    { id: 'C', left: 200, width: 100, center: 250 }
  ];
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots: equalSlots,
    draggedId: 'A',
    insertionIndex: 0,
    draggedLeft: 51,
    previousDraggedLeft: 50
  }), 0);
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots: equalSlots,
    draggedId: 'A',
    insertionIndex: 0,
    draggedLeft: 52,
    previousDraggedLeft: 51
  }), 1);
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots: equalSlots,
    draggedId: 'A',
    insertionIndex: 1,
    draggedLeft: 51,
    previousDraggedLeft: 52
  }), 1);
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots: equalSlots,
    draggedId: 'A',
    insertionIndex: 1,
    draggedLeft: 48,
    previousDraggedLeft: 51
  }), 0);
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots: equalSlots,
    draggedId: 'A',
    insertionIndex: 0,
    draggedLeft: 200,
    previousDraggedLeft: 0
  }), 2);
  assert.deepEqual(
    Object.fromEntries(tabStripLayout.provisionalSlotRects(equalSlots, 'A', 1)),
    {
      B: { left: 0, right: 100, width: 100, center: 50 },
      A: { left: 100, right: 200, width: 100, center: 150 },
      C: { left: 200, right: 300, width: 100, center: 250 }
    }
  );

  const slots = [
    { id: 'A', left: 0, width: 180, center: 90 },
    { id: 'B', left: 180, width: 100, center: 230 },
    { id: 'C', left: 280, width: 100, center: 330 },
    { id: 'D', left: 380, width: 100, center: 430 }
  ];
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots,
    draggedId: 'A',
    insertionIndex: 0,
    draggedLeft: 51,
    previousDraggedLeft: 50
  }), 0);
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots,
    draggedId: 'A',
    insertionIndex: 0,
    draggedLeft: 52,
    previousDraggedLeft: 51
  }), 1);
  assert.equal(tabStripLayout.nextInsertionIndex({
    slots,
    draggedId: 'A',
    insertionIndex: 1,
    draggedLeft: 152,
    previousDraggedLeft: 52
  }), 2);
  assert.deepEqual(tabStripLayout.reorderSequence(['A', 'B', 'C', 'D'], 0, 2), ['B', 'C', 'A', 'D']);
  assert.deepEqual(
    Object.fromEntries(tabStripLayout.targetOffsets(slots, 'A', 2)),
    { B: -180, C: -180, A: 200, D: 0 }
  );

  assert.deepEqual(
    Object.fromEntries(tabStripLayout.targetOffsets(slots, 'D', 2)),
    { A: 0, B: 0, D: -100, C: 100 }
  );
  const firstSlotDisplacement = [
    { id: 'A', left: 0, width: 100 },
    { id: 'B', left: 100, width: 180 },
    { id: 'C', left: 280, width: 100 }
  ];
  const firstGapRects = tabStripLayout.provisionalSlotRects(firstSlotDisplacement, 'B', 0);
  const firstGapOffsets = tabStripLayout.targetOffsets(firstSlotDisplacement, 'B', 0);
  assert.equal(firstGapRects.get('A').left, 180);
  assert.equal(firstGapOffsets.get('A'), 180);
  for (const slot of firstSlotDisplacement) {
    assert.equal(firstGapOffsets.get(slot.id), firstGapRects.get(slot.id).left - slot.left);
  }
  assert.deepEqual(
    Object.fromEntries(tabStripLayout.detachedOffsets(slots, 'B')),
    { A: 0, B: 0, C: -100, D: -100 }
  );
});

test('detached Page preview uses the canonical first-screen fit without mutating Page geometry', () => {
  assert.deepEqual(tabPagePreview.calculatePreviewSize({
    viewportWidth: 1000,
    viewportHeight: 500,
    windowWidth: 1200,
    windowHeight: 900
  }), { width: 240, height: 120 });
  assert.deepEqual(tabPagePreview.calculatePreviewSize({
    viewportWidth: 600,
    viewportHeight: 900,
    windowWidth: 900,
    windowHeight: 520
  }), { width: 210, height: 315 });

  const objects = [
    { id: 'lower', type: 'image', x: 100, y: 50, width: 400, height: 200 },
    { id: 'hidden', type: 'image', x: -1000, y: -1000, width: 20, height: 20, visible: false }
  ];
  const fit = tabPagePreview.calculateInitialFit(objects, {
    viewportWidth: 1000,
    viewportHeight: 500,
    padding: 32
  });
  assert.equal(fit.scale, 2.18);
  assert.ok(Math.abs(fit.offsetX + 154) < 1e-9);
  assert.ok(Math.abs(fit.offsetY + 77) < 1e-9);
  assert.deepEqual(
    tabPagePreview.previewObjectRects(objects, {
      viewportWidth: 1000,
      viewportHeight: 500,
      previewWidth: 320,
      previewHeight: 160,
      padding: 32
    }).map(({ object, ...rect }) => ({
      id: object.id,
      ...Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Number(value.toFixed(2))]))
    })),
    [{ id: 'lower', left: 20.48, top: 10.24, width: 279.04, height: 139.52 }]
  );
  assert.deepEqual(objects[0], {
    id: 'lower', type: 'image', x: 100, y: 50, width: 400, height: 200
  });
});

test('Tab DOM keeps the plus in the flowing list and reserves a fixed native-menu control', async () => {
  const [html, css, app] = await Promise.all([
    read('public/index.html'), read('public/styles.css'), read('public/app.js')
  ]);
  assert.match(html, /tabStripLayout\.js\?v=tab-strip-layout-v03/);
  assert.match(css, /\.app-topbar \{[^}]*grid-template-columns: var\(--active-left-header-width\) minmax\(0, 1fr\) var\(--active-right-sidebar-width\)/);
  assert.match(css, /\.viewer-tab-list \{[^}]*flex: 0 0 var\(--viewer-tab-list-width, 0px\)[^}]*max-width: calc\(100% - var\(--viewer-tab-menu-area-width\)\)[^}]*overflow-x: auto[^}]*overflow-y: hidden/);
  assert.match(css, /\.viewer-tab-add \{[^}]*flex: 0 0 43px[^}]*width: 43px/);
  assert.match(css, /\.viewer-tab-menu \{[^}]*flex: 0 0 30px[^}]*width: 30px[^}]*min-width: 30px[^}]*margin-inline: 3px/);
  assert.match(css, /\.viewer-tab-menu-chevron \{[^}]*z-index: 1;[^}]*pointer-events: none;/);
  assert.doesNotMatch(css, /\.viewer-tab-menu-chevron \{[^}]*transform:/);
  assert.match(app, /createViewerChromeIcon\('tab-menu', 'viewer-tab-menu-chevron'\)/);
  assert.match(app, /TAB_TITLE_TOOLTIP_DELAY = 500/);
  assert.match(app, /new ResizeObserver\([\s\S]*?scheduleTabStripLayout\(\{ ensureActiveVisible: true \}\)/);
  assert.match(app, /function ensureActiveTabVisible[\s\S]*?const plus = list\.querySelector\('\.viewer-tab-add'\)[\s\S]*?active\.nextElementSibling === plus \? plus : active[\s\S]*?trailingElement\.offsetLeft \+ trailingElement\.offsetWidth/);
  assert.match(app, /function settleTabStripGeometry[\s\S]*?if \(list\.isConnected\) ensureActiveTabVisible\(list\);/);
  assert.match(app, /menuOuterWidth = \(menu\?\.offsetWidth \|\| 0\)[\s\S]*?menuStyle\?\.marginLeft[\s\S]*?menuStyle\?\.marginRight[\s\S]*?maximumListWidth[\s\S]*?strip\.clientWidth - stripHorizontalPadding - menuOuterWidth/);
  assert.match(app, /maximumTabsWidth[\s\S]*?maximumListWidth - listHorizontalPadding - \(plus\?\.offsetWidth \|\| 0\)/);
  assert.match(app, /list\.append\(plus\);[\s\S]*?strip\.append\(menu\)/);
  assert.match(app, /bounds: list\.getBoundingClientRect\(\)/);
  assert.match(app, /function openTabListMenu[\s\S]*?type: 'tab-list'[\s\S]*?tabs: tabs\.map[\s\S]*?activateWorkspaceTab/);
  assert.match(app, /async function closeAllTabs\(runtime = activePaneRuntime\(\)\)[\s\S]*?runtime\.session\.reset\(null\)[\s\S]*?renderEmptyTab\(runtime\)/);
  assert.match(app, /list\.addEventListener\('wheel', clearTabTitleTooltip/);
  assert.match(app, /title\.removeAttribute\('title'\)/);
  assert.match(app, /function inactiveTabCanRevealClose[\s\S]*?restingThreshold[\s\S]*?hoveredThreshold/);
  assert.match(app, /element\.dataset\.closeOnHover = String\(closeOnHover\)/);
  assert.match(css, /\.viewer-tab\[data-close-on-hover='true'\]:not\(\[data-active='true'\]\):hover \.viewer-tab-title,[\s\S]*?padding-right: 36px/);
  assert.match(css, /\.viewer-tab-tooltip \{[^}]*position: fixed[^}]*pointer-events: none/);
});

test('Tab add, close, and activation share one stable-id FLIP layout transition', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'), read('public/styles.css')
  ]);
  const transition = app.slice(
    app.indexOf('function animateTabStripLayoutChange'),
    app.indexOf('function settleCommittedTabReorder')
  );
  assert.match(transition, /const before = captureTabStripLayoutState\(\)/);
  assert.match(transition, /const result = change\(\);[\s\S]*?renderTabStrip\(\{ ensureActiveVisible \}\)/);
  assert.match(transition, /finalIds[\s\S]*?enteringTabIds[\s\S]*?exitingTabs/);
  assert.match(transition, /settleTabStripGeometry\(oldRects, \{[\s\S]*?oldPlusRect: before\.plusRect/);
  assert.doesNotMatch(transition, /viewer-tab-menu/);

  const creation = app.slice(
    app.indexOf('function createEmptyTab'),
    app.indexOf('async function openPageInNewTab')
  );
  assert.match(creation, /tabReorderState \|\| sidebarPageDragState/);
  assert.match(creation, /animateTabStripLayoutChange\(\(\) => runtime\.session\.createTab\(null\)\)/);
  assert.doesNotMatch(creation, /viewer-tab-menu|getBoundingClientRect\(\)[\s\S]*?viewer-tab-menu/);

  const pageCreation = app.slice(
    app.indexOf('async function openPageInNewTab'),
    app.indexOf('function workspaceTabForPage')
  );
  assert.match(pageCreation, /usesDragSettlement = typeof onTabRendered === 'function'/);
  assert.match(pageCreation, /usesDragSettlement[\s\S]*?createTab\(\)[\s\S]*?: animateTabStripLayoutChange\(createTab\)/);
  assert.match(pageCreation, /if \(usesDragSettlement\) renderTabStrip/);

  const switching = app.slice(
    app.indexOf('async function switchToTab'),
    app.indexOf('function createEmptyTab')
  );
  assert.match(switching, /animateTabStripLayoutChange\(\(\) => runtime\.session\.activateTab\(tabId\)\)/);
  const closing = app.slice(
    app.indexOf('async function closeTab'),
    app.indexOf('async function openTabListMenu')
  );
  assert.match(closing, /animateTabStripLayoutChange\(\(\) => runtime\.session\.closeTab\(tabId\)\)/);
  assert.match(closing, /animateTabStripLayoutChange\(\(\) => runtime\.session\.reset\(null\)\)/);

  const settle = app.slice(
    app.indexOf('function settleTabStripGeometry'),
    app.indexOf('function settleCommittedTabReorder')
  );
  assert.match(settle, /const finalPlusRect = plus\?\.getBoundingClientRect\(\) \|\| null[\s\S]*?oldPlusRect\.left - finalPlusRect\.left/);
  assert.match(settle, /plus\.classList\.add\('is-tab-layout-transitioning'\)[\s\S]*?plus\.style\.left/);
  assert.match(settle, /window\.getComputedStyle\(plus\)\.transform[\s\S]*?requestAnimationFrame/);
  assert.match(settle, /is-tab-layout-transitioning', 'is-tab-reorder-settling'[\s\S]*?plus\.style\.left = ''/);
  assert.match(settle, /enteringTabIds = \[\][\s\S]*?enteringFromRect = null[\s\S]*?exitingTabs = \[\]/);
  assert.match(settle, /enteringElements\.has\(element\)[\s\S]*?is-tab-inserting[\s\S]*?setTabSettleWidth\(element, 0\)/);
  assert.match(settle, /enteringElements\.has\(element\)[\s\S]*?enteringFromRect\.left - initial\.left/);
  assert.match(settle, /exitingTabs\.map\(createClosingTabVisual\)/);
  assert.match(settle, /tabReorderSettleFrame = window\.requestAnimationFrame/);
  assert.match(settle, /is-tab-inserting', 'is-tab-reorder-settling'[\s\S]*?TAB_REORDER_SETTLE_DURATION/);
  assert.doesNotMatch(settle, /viewer-tab-menu/);

  assert.match(css, /\.viewer-tab\.is-tab-inserting \{[^}]*overflow: hidden[^}]*opacity: 0\.25/);
  assert.match(css, /\.viewer-tab\.is-tab-reorder-settling \{[^}]*opacity 140ms ease/);
  assert.match(css, /\.viewer-tab\.is-tab-inserting\.is-tab-reorder-settling \{[^}]*opacity: 1/);
  assert.match(css, /\.viewer-tab\.is-tab-closing-visual \{[^}]*position: fixed[^}]*pointer-events: none/);
  assert.match(css, /\.viewer-tab\.is-tab-closing-visual\.is-tab-reorder-settling \{[^}]*opacity: 0[^}]*clip-path: inset\(0 50% 0 50%\)/);
  assert.match(css, /\.viewer-tab-add\.is-tab-layout-transitioning \{[^}]*position: absolute[^}]*pointer-events: none/);
  assert.match(css, /\.viewer-tab-add\.is-tab-reorder-settling \{[^}]*transition: transform 140ms ease/);
});

test('Tab reorder uses leading-edge provisional slots, animated slot wrappers, and one commit', async () => {
  const [css, app, sessionSource] = await Promise.all([
    read('public/styles.css'), read('public/app.js'), read('public/sessionTabs.js')
  ]);
  assert.match(sessionSource, /function reorderTab\(tabId, insertionIndex\)[\s\S]*?tabs\.splice\(toIndex, 0, tab\)/);
  assert.match(app, /TAB_REORDER_DRAG_THRESHOLD = 5/);
  assert.match(app, /function handleTabReorderPointerDown[\s\S]*?addTabReorderPointerListeners\(\)/);
  assert.match(app, /setPointerCapture\?\.\(state\.pointerId\)/);
  assert.match(app, /requestAnimationFrame\(applyTabReorderVisuals\)/);
  assert.match(app, /nextInsertionIndex\([\s\S]*?provisionalSlotRects\([\s\S]*?targetOffsets\(/);
  assert.doesNotMatch(app, /insertionIndexForCenter\(/);
  assert.match(app, /shellPeelY = state\.previewTabActive \? 0 : peelY[\s\S]*?translate3d\(\$\{dragX\}px, \$\{shellPeelY\}px, 0\)/);
  assert.match(app, /for \(const slot of state\.stationaryTabs\) slot\.element\.classList\.add\('is-tab-reorder-displaced'\)/);
  assert.match(app, /offsets\.get\(slot\.id\) \|\| 0[\s\S]*?: 'translate3d\(0, 0, 0\)'/);
  assert.match(app, /function updateTabReorderDividerOwnership[\s\S]*?dataset\.reorderDivider = String\(visible\)/);
  assert.match(app, /function syncTabReorderDividerOverlays[\s\S]*?tab-reorder-divider-overlay[\s\S]*?targetLeft - slot\.left/);
  assert.match(app, /function commitTabReorder[\s\S]*?clearTabReorderDividerOverlays\(state\)[\s\S]*?runtime\.session\.reorderTab/);
  assert.match(app, /const visible = slot\.element\.dataset\.active !== 'true'/);
  assert.match(app, /function commitTabReorder[\s\S]*?runtime\.session\.reorderTab\(state\.tabId, state\.provisionalIndex\);[\s\S]*?renderTabStrip\(\{ preserveDragState: true \}\)/);
  assert.match(app, /event\.key !== 'Escape'[\s\S]*?cancelTabReorder/);
  assert.match(app, /close\.addEventListener\('pointerdown', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(css, /\.viewer-tab\.is-tab-reorder-dragging \{[^}]*z-index: 30[^}]*transition: none !important[^}]*will-change: transform/);
  assert.match(css, /\.viewer-tab\.is-tab-reorder-displaced \{[^}]*transition: transform 140ms ease/);
  assert.match(css, /\.viewer-tab-strip\.is-tab-reordering \.viewer-tab\.is-tab-reorder-dragging:not\(\[data-active='true'\]\) \{[^}]*background: var\(--accent-strong\)/);
  assert.match(css, /\.viewer-tab-strip\.is-tab-reordering \.viewer-tab\[data-reorder-divider='true'\]:not\(\[data-active='true'\]\)::after \{[^}]*display: block/);
  assert.match(css, /\.tab-reorder-divider-layer \{[^}]*z-index: 131[^}]*pointer-events: none/);
  assert.match(css, /\.tab-reorder-divider-overlay \{[^}]*background: var\(--border-tool\)[^}]*transition: transform 140ms ease/);
  assert.doesNotMatch(css, /\.viewer-tab:last-child:not\(\[data-active='true'\]\)::after\s*\{[^}]*display: none/);
  const reorderSource = app.slice(
    app.indexOf('function clearTabReorderSettleAnimation'),
    app.indexOf("document.addEventListener('keydown', handleTabReorderKeyDown, true)")
  );
  assert.doesNotMatch(reorderSource, /dragstart|dataTransfer/);
});

test('Tab reorder pointerup uses the final detach phase as the release-validity boundary', async () => {
  const app = await read('public/app.js');
  const decision = app.slice(
    app.indexOf('function tabReorderCommitDecision'),
    app.indexOf('function handleTabReorderPointerMove')
  );
  assert.match(decision, /state\?\.phase !== 'reordering'[\s\S]*?reason: 'not-reordering'/);
  assert.match(decision, /candidate\.stripId === state\.currentTargetStripId[\s\S]*?candidate\.element === state\.strip[\s\S]*?candidate\.list === state\.list/);
  assert.match(decision, /Number\.isInteger\(state\.provisionalIndex\)[\s\S]*?state\.provisionalIndex > maximumIndex/);
  assert.match(decision, /canCommit: true,[\s\S]*?reason: 'valid-reorder-state'/);
  assert.doesNotMatch(decision, /reorderReleaseValid|outside-viewer-window|pointIsInsideViewerWindow/);

  const pointerUp = app.slice(
    app.indexOf('function handleTabReorderPointerUp'),
    app.indexOf('function handleTabReorderPointerCancel')
  );
  assert.match(pointerUp, /state\.phase === 'reordering'[\s\S]*?updateTabGestureIntent\(state\)[\s\S]*?pointerExceedsTabDetachThreshold\(state\)[\s\S]*?detachTabReorder\(state\)[\s\S]*?tabReorderCommitDecision\(state\)/);
  assert.match(pointerUp, /tabReorderCommitDecision\(state\)[\s\S]*?decision\.canCommit[\s\S]*?commitSharedPageDrag\(state, decision\.target\)/);
  assert.match(pointerUp, /else \{\s*beginTabReorderReturn\(state\)/);
  assert.doesNotMatch(pointerUp, /hitTestTabStrip\(event\.clientX, event\.clientY\)/);
  assert.doesNotMatch(pointerUp, /event\.target|elementFromPoint|pointIsInsideViewerWindow|reorderReleaseValid/);
  assert.doesNotMatch(app, /reorderReleaseValid|pointIsInsideViewerWindow|outside-viewer-window/);
});

test('Tab strip entry performs one absolute placement before incremental hysteresis', async () => {
  const app = await read('public/app.js');
  const reentry = app.slice(
    app.indexOf('function enterTabStripFromPreview'),
    app.indexOf('function currentStationaryTabSlotGeometry')
  );
  assert.match(reentry, /state\.lastDraggedLeft = nextLeft/);
  assert.match(reentry, /state\.needsInitialPlacement = true/);
  assert.match(reentry, /state\.forceTabLayout = true/);
  assert.doesNotMatch(reentry, /nextLeft - 1|nextLeft \+ 1/);

  const sorting = app.slice(
    app.indexOf('function applySharedTabSortingVisuals'),
    app.indexOf('function applySharedTabSortingPreview')
  );
  assert.match(sorting, /state\.needsInitialPlacement[\s\S]*?insertionIndexAtPoint\([\s\S]*?currentStationaryTabSlotGeometry\(state\),[\s\S]*?pointerContentX/);
  assert.match(sorting, /: tabStripLayoutModel\.nextInsertionIndex\(/);
  assert.match(sorting, /state\.lastDraggedLeft = draggedLeft[\s\S]*?state\.needsInitialPlacement = false/);

  const sidebarEntry = app.slice(
    app.indexOf('function beginSidebarTabStripEntry'),
    app.indexOf('function clearSidebarTabLayoutParticipation')
  );
  assert.match(sidebarEntry, /state\.needsInitialPlacement = true[\s\S]*?state\.forceTabLayout = true/);
});

test('Tab detach locks direction, peels downward, morphs its preview, and preserves re-entry', async () => {
  const [html, css, app] = await Promise.all([
    read('public/index.html'), read('public/styles.css'), read('public/app.js')
  ]);
  assert.match(html, /tabPagePreview\.js\?v=tab-page-preview-v02/);
  assert.match(app, /phase: 'pressing'/);
  assert.match(app, /gestureIntent: 'undecided'/);
  assert.match(app, /state\.phase = 'reordering'/);
  assert.match(app, /state\.phase = 'detached-preview'/);
  assert.match(app, /state\.phase = 'returning'/);
  assert.match(app, /function getRegisteredTabStrips[\s\S]*?workspace\.state\.panes[\s\S]*?ownerPaneId: pane\.id[\s\S]*?function hitTestTabStrip/);
  assert.match(app, /function updateTabGestureIntent[\s\S]*?dy > directIntentDistance[\s\S]*?dy > Math\.abs\(dx\) \* 1\.3[\s\S]*?horizontal-reorder/);
  assert.match(app, /function pointerExceedsTabDetachThreshold[\s\S]*?lastClientY <= state\.startClientY\) return false/);
  assert.match(app, /directDetachDistance = Math\.max\(14, rect\.height \* 0\.35\)/);
  assert.match(app, /reorderDetachDistance = Math\.max\(28, rect\.height \* 0\.75\)/);
  assert.match(app, /function tabPeelTarget[\s\S]*?Math\.min\(12, downwardDistance \* 0\.45\)[\s\S]*?Math\.min\(7, downwardDistance \* 0\.18\)/);
  assert.match(app, /function prepareSharedPagePreview[\s\S]*?renderTabPagePreview\(runtime, tab, state\.pageTitle\)/);
  assert.match(app, /function prepareSharedPageDragPreview[\s\S]*?prepareSharedPagePreview\(state/);
  assert.match(app, /function beginSharedPageDrag[\s\S]*?dragState\.preparePreview !== false[\s\S]*?prepareSharedPageDragPreview\(dragState\)/);
  assert.match(app, /function handleTabReorderPointerDown[\s\S]*?beginSharedPageDrag\(\{[\s\S]*?type: 'tab'/);
  const previewRendererRegistry = app.slice(
    app.indexOf('const tabPagePreviewRenderers'),
    app.indexOf('function tabPagePreviewRenderer')
  );
  for (const rendererId of ['canvas', 'markdown', 'cne-text']) {
    assert.match(previewRendererRegistry, new RegExp(`['"]${rendererId}['"]`));
  }
  assert.doesNotMatch(previewRendererRegistry, /['"]unsupported['"]/);
  const previewRendererEntries = Object.fromEntries([...previewRendererRegistry.matchAll(
    /\[\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\]/g
  )].map((match) => [match[1], match[2]]));
  assert.notEqual(previewRendererEntries['cne-text'], previewRendererEntries.canvas);
  assert.doesNotMatch(previewRendererRegistry, /['"]image-canvas['"]/);

  const previewRendererSelector = app.slice(
    app.indexOf('function tabPagePreviewRenderer'),
    app.indexOf('function sharedPagePreviewViewportSize')
  );
  assert.match(previewRendererSelector, /pageTypesModel\.pageTypeRendererId\(page\?\.type\)/);
  assert.match(previewRendererSelector, /throw new Error\(`Unsupported Page Type/);
  assert.doesNotMatch(previewRendererSelector, /PAGE_TYPES\.MARKDOWN|normalizePageType/);
  assert.doesNotMatch(previewRendererSelector, /tabPagePreviewRenderers\.get\(['"]canvas['"]\)/);

  const renderPreview = app.slice(
    app.indexOf('function renderTabPagePreview'),
    app.indexOf('function tabPagePreviewSurface')
  );
  assert.match(renderPreview, /tabPagePreviewRenderer\(canonicalPage\)/);
  assert.match(renderPreview, /tabPagePreviewRenderer\(page\)/);
  assert.doesNotMatch(renderPreview, /canvasRenderer|image-canvas/);
  const markdownPreviewRenderer = app.slice(
    app.indexOf('function renderMarkdownTabPagePreview'),
    app.indexOf('const tabPagePreviewRenderers')
  );
  assert.match(markdownPreviewRenderer, /renderImageTabPagePreview\(preview, tab, page, geometry\)/);
  assert.match(markdownPreviewRenderer, /body\.innerHTML = markdownPageModel\.renderMarkdown\(page\.markdownBody \|\| ''\)/);
  assert.doesNotMatch(markdownPreviewRenderer, /markdownPageModel\.readableText/);
  assert.match(css, /\.tab-page-preview-markdown \{[^}]*position: relative[^}]*z-index: 1/);
  assert.match(app, /function applyDetachedSourceGap[\s\S]*?detachedOffsets\(state\.slots, state\.tabId\)/);
  assert.match(app, /function detachTabReorder[\s\S]*?liveTabRect[\s\S]*?showSharedPagePreviewInPageMode\(state, liveTabRect\)/);
  assert.match(app, /function enterTabStripFromPreview[\s\S]*?previewReentryArmed[\s\S]*?showSharedPagePreviewInTabMode[\s\S]*?applyTabReorderVisuals\(\)/);
  assert.match(app, /function beginTabReorderReturn[\s\S]*?resolveSharedPageDragReturnTarget\(state\)[\s\S]*?animateSharedPagePreviewReturn/);
  assert.match(app, /cancelTabReorder\(\{ suppressClick: true, immediate: false \}\)/);
  assert.match(css, /\.tab-page-preview \{[^}]*position: fixed[^}]*z-index: 120[^}]*will-change: transform, opacity[^}]*contain: layout style/);
  assert.match(css, /\.tab-page-preview-surface \{[^}]*background: var\(--surface-canvas\)[^}]*will-change: transform, opacity[^}]*contain: layout paint style/);
  assert.match(css, /\.tab-page-preview\.is-returning \{[^}]*box-shadow: none[^}]*outline: none[^}]*transition:[^}]*transform var\(--preview-return-duration\) var\(--preview-return-easing\),[^}]*opacity var\(--preview-return-duration\) linear/);
  assert.match(css, /\.tab-page-preview\.is-returning::after \{[^}]*box-shadow: none[^}]*opacity: 0[^}]*transition: none/);
  assert.match(app, /function animateSharedPagePreviewReturn[\s\S]*?event\.target !== preview \|\| event\.propertyName !== 'transform'[\s\S]*?preview\.addEventListener\('transitionend'/);
  assert.match(app, /function finishTabReorderReturn[\s\S]*?clearSharedPagePreviewReturnCompletion\(state\)[\s\S]*?clearTabReorderTransforms\(state\)/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode \{[^}]*background: transparent[^}]*transition: none/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode \.tab-page-preview-tab-body \{[^}]*display: block[^}]*background: var\(--accent-strong\)/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode\.is-mode-changing \{[^}]*transform 170ms cubic-bezier\(0\.2, 0\.75, 0\.25, 1\)/);
  assert.doesNotMatch(app, /entering-tab-strip|finishTabStripEntry|positionEnteringTabPreview/);
  assert.doesNotMatch(css, /is-entering-tab-strip/);
  assert.match(css, /\.tab-page-preview\.is-unfolding::after \{[^}]*transition: opacity 160ms ease-out/);
  assert.match(css, /\.viewer-tab\.is-tab-detached-source \{[^}]*opacity: 0[^}]*pointer-events: none/);
});

test('active Tab damping separates horizontal shell motion from its anchored shoulders and moving body', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'), read('public/styles.css')
  ]);
  assert.match(app, /tabBody\.className = 'tab-page-preview-tab-body'[\s\S]*?tabBody\.append\(title\)[\s\S]*?tabConnector\.className = 'tab-page-preview-tab-connector'[\s\S]*?preview\.append\([\s\S]*?surface,[\s\S]*?tabBody,[\s\S]*?tabConnector,[\s\S]*?leftShoulder,[\s\S]*?rightShoulder/);
  assert.match(app, /function updateActiveTabDampingPresentation[\s\S]*?state\?\.previewTabActive[\s\S]*?state\.phase === 'reordering'[\s\S]*?state\.mode === 'tab'/);
  assert.match(app, /function updateActiveTabDampingPresentation[\s\S]*?previewElement\.style\.setProperty\('--tab-damped-y', `\$\{dampedY\}px`\)/);
  assert.match(app, /function clearActiveTabDampingPresentation[\s\S]*?previewElement\?\.style\.removeProperty\('--tab-damped-y'\)/);
  assert.match(app, /function applySharedTabSortingVisuals[\s\S]*?shellPeelY = state\.previewTabActive \? 0 : peelY[\s\S]*?translate3d\(\$\{dragX\}px, \$\{shellPeelY\}px, 0\)/);
  assert.match(app, /function applySharedTabSortingPreview[\s\S]*?updateActiveTabDampingPresentation\(state, peelY\)[\s\S]*?positionSharedTabModePreview/);
  assert.match(app, /function detachTabReorder[\s\S]*?activeTabBody\?\.getBoundingClientRect\(\)[\s\S]*?clearActiveTabDampingPresentation\(state\)[\s\S]*?showSharedPagePreviewInPageMode/);
  assert.match(app, /function clearTabReorderSlotPresentation\(state\) \{[\s\S]*?clearActiveTabDampingPresentation\(state\)/);
  assert.match(app, /function destroySharedPagePreview\(state\) \{[\s\S]*?clearActiveTabDampingPresentation\(state\)/);
  assert.match(css, /\.tab-page-preview-tab-body \{[^}]*position: absolute[^}]*transform: translate3d\(0, var\(--tab-damped-y, 0px\), 0\)[^}]*will-change: transform/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode\[data-active='true'\] \.tab-page-preview-tab-body \{[^}]*border: 1px solid var\(--border-tool\)[^}]*border-bottom: 0[^}]*background: var\(--drag-preview-active-surface\)/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode\[data-active='true'\]\.has-active-tab-body-damping[\s\S]*?\.tab-page-preview-tab-connector \{[^}]*top: 100%[^}]*height: var\(--tab-damped-y, 0px\)[^}]*border: 0[^}]*background: var\(--drag-preview-active-surface\)[^}]*pointer-events: none/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode\[data-active='true'\] \.tab-page-preview-shoulder \{[^}]*bottom: 0[^}]*display: block/);
  assert.doesNotMatch(css, /active-tab-damping-underlay|has-active-tab-damping-bridge|tab-page-preview-active-damping-bridge/);
  assert.match(app, /function showActiveTabReturnContinuity[\s\S]*?source\?\.type !== 'tab'[\s\S]*?previewTabActive[\s\S]*?classList\.add\('is-tab-return-continuity'\)/);
  assert.match(app, /function beginTabReorderReturn[\s\S]*?showActiveTabReturnContinuity\(state\)[\s\S]*?animateSharedPagePreviewReturn/);
  assert.match(css, /\.viewer-tab\[data-active='true'\]\.is-tab-return-continuity \{[^}]*opacity: 1[^}]*pointer-events: none/);
  assert.match(app, /function detachTabReorder[\s\S]*?detachDampedY = activeTabBodyRect && previewRect[\s\S]*?activeTabBodyRect\.top - previewRect\.top/);
  assert.match(app, /function animateSharedPagePreviewReturn[\s\S]*?activeTabReconnectY[\s\S]*?flightTarget[\s\S]*?beginActiveTabReturnReconnect/);
  assert.match(app, /function beginActiveTabReturnReconnect[\s\S]*?state\.mode = 'tab'[\s\S]*?'is-tab-reconnect'[\s\S]*?'has-active-tab-body-damping'[\s\S]*?style\.setProperty\('--tab-damped-y', `\$\{dampedY\}px`\)[\s\S]*?style\.setProperty\('--tab-damped-y', '0px'\)/);
  assert.match(app, /function clearSharedPagePreviewReturnCompletion[\s\S]*?tabBody\.removeEventListener\('transitionend'[\s\S]*?previewReturnTabBodyComplete = false/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode\.is-returning \.tab-page-preview-tab-body \{[^}]*transition: transform var\(--preview-return-duration\) var\(--preview-return-easing\)/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode\.is-returning \.tab-page-preview-tab-connector \{[^}]*transition: height var\(--preview-return-duration\) var\(--preview-return-easing\)/);
  assert.match(css, /\.tab-page-preview\.is-returning\.is-tab-reconnect \{[^}]*transition: none/);
  assert.match(app, /function clearTabReorderSlotPresentation[\s\S]*?'is-tab-return-continuity'/);
});

test('Tab and sidebar origins keep one shared Preview identity through mode changes', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'), read('public/styles.css')
  ]);
  assert.match(app, /function beginSharedPageDrag\(\{ event, pageId, source, state = \{\} \}\)/);
  assert.match(app, /function beginSidebarPageDrag[\s\S]*?beginSharedPageDrag\(\{[\s\S]*?type: 'sidebar-page'/);
  assert.match(app, /function handleTabReorderPointerDown[\s\S]*?beginSharedPageDrag\(\{[\s\S]*?type: 'tab'/);
  assert.match(app, /function createTabPreviewContractTarget[\s\S]*?is-tab-preview-contract-target[\s\S]*?document\.body\.append\(element\)/);
  assert.match(app, /function beginSidebarTabStripEntry[\s\S]*?createTabPreviewContractTarget[\s\S]*?state\.element = contractTarget[\s\S]*?showSharedPagePreviewInTabMode\(state, contractTarget\.getBoundingClientRect\(\)\)[\s\S]*?handoffSidebarPageDragToTabReorder[\s\S]*?applyTabReorderVisuals\(\)/);
  assert.match(app, /function enterTabStripFromPreview[\s\S]*?showSharedPagePreviewInTabMode[\s\S]*?applyTabReorderVisuals\(\)/);
  assert.match(app, /function applyTabReorderVisuals[\s\S]*?applySharedTabSortingPreview\(state, state\.peelY\)/);
  const sidebarVisuals = app.slice(
    app.indexOf('function applySidebarPageDragVisuals'),
    app.indexOf('function scheduleSidebarPageDragVisuals')
  );
  assert.doesNotMatch(sidebarVisuals, /tab-preview|applySharedTabSortingPreview|showSharedPagePreviewInPageMode/);
  assert.match(app, /function destroySharedPagePreview[\s\S]*?state\.previewElement\?\.remove\(\)/);
  const sidebarEntry = app.slice(
    app.indexOf('function beginSidebarTabStripEntry'),
    app.indexOf('function clearSidebarTabLayoutParticipation')
  );
  assert.doesNotMatch(sidebarEntry, /fixedPreview|state\.element = state\.previewElement/);
  assert.doesNotMatch(app, /sidebar-tab-preview|is-sidebar-tab-preview/);
  assert.match(css, /\.drag-preview-title \{[^}]*display: flex[^}]*opacity: 0[^}]*visibility: hidden/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode \.drag-preview-title \{[^}]*opacity: 1[^}]*visibility: visible/);
});

test('shared Preview title has one canonical payload, one permanent node, and mode-safe visibility', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'), read('public/styles.css')
  ]);
  assert.match(app, /function canonicalDragPageTitle\(pageId\)[\s\S]*?canonicalPages\.get\(pageId\)\?\.title[\s\S]*?pageIndex\?\.pages\?\.find/);
  assert.match(app, /function beginSharedPageDrag[\s\S]*?pageTitle: canonicalDragPageTitle\(pageId\)[\s\S]*?mode: 'page'/);
  assert.match(app, /function renderTabPagePreview\(runtime, tab, pageTitle\)[\s\S]*?className = 'drag-preview-title page-title-typography'[\s\S]*?title\.textContent = pageTitle[\s\S]*?tabBody\.append\(title\)[\s\S]*?preview\.append\([\s\S]*?surface,[\s\S]*?tabBody,[\s\S]*?tabConnector,/);
  assert.match(app, /function showSharedPagePreviewInTabMode[\s\S]*?title\.textContent = state\.pageTitle[\s\S]*?style\.width[\s\S]*?state\.mode = 'tab'[\s\S]*?classList\.add\('is-tab-mode'/);
  assert.match(app, /expectedModeToken = \+\+state\.previewModeToken[\s\S]*?state\.mode !== 'tab' \|\| state\.previewModeToken !== expectedModeToken/);
  assert.match(app, /function showSharedPagePreviewInPageMode[\s\S]*?state\.mode = 'page'[\s\S]*?state\.previewModeToken \+= 1/);
  assert.match(app, /async function commitSidebarTabReorder[\s\S]*?\{ pageId, pageTitle: draggedPageTitle \} = state[\s\S]*?openPageInNewTab\(activePaneRuntime\(\), pageId, \{[\s\S]*?pageTitle: draggedPageTitle/);
  assert.match(app, /async function commitSidebarTabReorder[\s\S]*?workspaceTabForPageInPane\(getActivePane\(\)\?\.id, pageId\)[\s\S]*?activateWorkspaceTab\(existing\)[\s\S]*?openPageInNewTab\(activePaneRuntime\(\), pageId/);
  assert.match(app, /async function openPageInNewTab\(runtime, pageId,[\s\S]*?applyTabTitlePresentation\(tabElement, requestedPageTitle\)/);
  assert.match(app, /function clearTabReorderSlotPresentation[\s\S]*?is-tab-preview-contract-target[\s\S]*?function commitTabReorder[\s\S]*?clearTabReorderSlotPresentation\(state\)[\s\S]*?renderTabStrip\(\{ preserveDragState: true \}\)[\s\S]*?applyTabTitlePresentation\(tabElement, draggedPageTitle\)[\s\S]*?destroySharedPagePreview\(state\)[\s\S]*?tabReorderState = null/);
  assert.match(app, /function renderTabStrip\(\{[\s\S]*?ensureActiveVisible = false,[\s\S]*?preserveDragState = false,[\s\S]*?preserveLayoutTransition = false[\s\S]*?tabReorderState && !preserveDragState/);
  assert.match(css, /\.tab-page-preview\.is-page-mode \.drag-preview-title \{[^}]*opacity: 0[^}]*visibility: hidden/);
  assert.match(css, /\.tab-page-preview\.is-tab-mode \.drag-preview-title \{[^}]*opacity: 1[^}]*visibility: visible/);
  assert.doesNotMatch(css, /drag-preview-title[^}]*display:\s*none/);
  const sortingSource = app.slice(
    app.indexOf('function applySharedTabSortingVisuals'),
    app.indexOf('function applyTabReorderVisuals')
  );
  assert.doesNotMatch(sortingSource, /textContent|innerHTML|replaceChildren|cloneNode/);
});
