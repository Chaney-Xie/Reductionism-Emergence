const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

let testRuntimeSequence = 0;

function installTestRuntime(pane, page = pane?.viewContext?.currentPage || null) {
  const runtime = pane.viewContext || {};
  Object.assign(runtime, {
    paneId: pane.id,
    runtimeId: `test-info-runtime-${++testRuntimeSequence}`,
    lifecycleEpoch: 1,
    disposed: false,
    session: pane.session,
    currentPage: page,
    mounted: {
      tabId: pane.session?.activeTab?.()?.id || null,
      pageId: page?.id || null,
      generation: 1
    },
    infoPanelsSuspended: runtime.infoPanelsSuspended === true,
    suspendedInfoPanelEditor: runtime.suspendedInfoPanelEditor || null,
    temporaryInfoBlockId: runtime.temporaryInfoBlockId || null,
    infoPanelEditor: runtime.infoPanelEditor || null,
    infoPanelEditorRevision: Number.isInteger(runtime.infoPanelEditorRevision)
      ? runtime.infoPanelEditorRevision
      : 0,
    infoPanelGeometryGesture: runtime.infoPanelGeometryGesture || null,
    infoPanelFocusFrame: runtime.infoPanelFocusFrame || null
  });
  pane.viewContext = runtime;
  return runtime;
}

function installTestRuntimeOwners(context, panes, activeRuntime = panes[0]?.viewContext || null) {
  context.workspace = { state: { panes } };
  context.getWorkspacePane = (paneId) => panes.find((pane) => pane.id === paneId) || null;
  context.runtimeIsLive = (runtime) => Boolean(runtime && !runtime.disposed
    && context.getWorkspacePane(runtime.paneId)?.viewContext === runtime);
  context.livingPaneRuntimes = () => panes.map((pane) => pane.viewContext)
    .filter(context.runtimeIsLive);
  context.activePaneRuntime = () => activeRuntime;
  context.showRuntimeStatus = () => {};
}

const INFO_EDITOR_TEST_HELPER = `
  function installTestInfoEditor(runtime, editor) {
    const revision = advanceInfoPanelEditorRevision(runtime);
    const runtimeToken = infoPanelRuntimeToken(runtime, {
      kind: editor.kind,
      ownerId: editor.ownerId,
      revision,
      includeMount: true
    });
    runtime.infoPanelEditor = {
      ...editor,
      runtime,
      runtimeId: runtime.runtimeId,
      lifecycleEpoch: runtime.lifecycleEpoch,
      session: runtime.session,
      paneId: runtime.paneId,
      revision,
      runtimeToken
    };
    return runtime.infoPanelEditor;
  }
`;

test('Info panel layout is cloned as independent Tab/Page view state', () => {
  const { createTabSession } = require('../public/sessionTabs');
  const session = createTabSession({ createId: (() => {
    let id = 0;
    return () => `tab_${++id}`;
  })() });
  const first = session.createTab('page_a');
  first.viewState.infoPanels = [{
    kind: 'block', ownerId: 'block_a', x: 22, y: 35,
    width: 340, height: 240, z: 4, minimized: false, autoPositioned: false
  }];
  first.viewState.infoPanelZCounter = 4;
  session.saveViewState(first.id, first.viewState);

  const second = session.createTab('page_a');
  assert.deepEqual(second.viewState.infoPanels, []);
  second.viewState.infoPanels.push({
    kind: 'highlight', ownerId: 'group_a', x: 16, y: 16,
    width: 320, height: 220, z: 1, minimized: true, autoPositioned: true
  });
  session.saveViewState(second.id, second.viewState);

  assert.equal(first.viewState.infoPanels.length, 1);
  assert.equal(first.viewState.infoPanels[0].ownerId, 'block_a');
  assert.equal(second.viewState.infoPanels[0].minimized, true);
});

test('Block and Highlight Group Info use one Pane-local plain-text panel controller', async () => {
  const [app, canvas, panels, styles, index] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/infoPanels.js'),
    read('public/styles.css'),
    read('public/index.html')
  ]);

  assert.match(index, /js\/canvasBlocks\.js[^]*?js\/infoPanels\.js[^]*?js\/appBootstrap\.js/);
  assert.match(app, /\['rename', 'Rename'\][^]*?\['adjust', 'Adjust'\][^]*?\['edit-info', 'Edit Info'\][^]*?\['delete', 'Delete'\]/);
  assert.match(app, /openHighlightGroupInfoEditor\(runtime, group\.id\)/);
  assert.match(canvas, /event\.shiftKey[^]*?openBlockInfoEditor\(runtime, target\.block\.id\)/);
  assert.match(canvas, /showTemporaryBlockInfo\(runtime, target\.block\)/);
  assert.match(panels, /function infoPanelReadModeAvailable\(runtime\)[^]*?!runtime\.blockEditMode[^]*?!runtime\.pageEditMode[^]*?!runtime\.highlightEditDraft/);
  assert.match(panels, /textarea\.addEventListener\('keydown'[^]*?event\.key === 'Enter' && event\.shiftKey/);
  assert.match(panels, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(panels, /function syncInfoPanelEntriesForRuntime[^]*?checked\.has\(group\.id\)[^]*?ensureInfoPanelEntry\(runtime,/);
  assert.match(
    panels,
    /function queueInfoTextSave[^]*?commitCanonicalPage\(saved, \{[^}]*originRuntime: runtime,[^}]*preserveDocumentBody: true[^}]*\}\)/
  );
  assert.doesNotMatch(panels, /markdown|latex/i);
  assert.match(styles, /\.info-panel-layer \{[^}]*position: absolute;[^}]*overflow: hidden;[^}]*pointer-events: none;/);
  assert.match(styles, /\.info-panel\.is-fixed \{[^}]*pointer-events: auto;/);
  assert.match(styles, /\.info-panel\.is-temporary \{[^}]*pointer-events: auto;/);
  assert.match(styles, /\.info-panel-content,[^]*\.info-panel-editor \{[^}]*white-space: pre-wrap;/);
});

test('Info panel pointer ownership and geometry gestures use one captured pointer', async () => {
  const [bootstrap, canvas, panels, styles] = await Promise.all([
    read('public/js/appBootstrap.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/infoPanels.js'),
    read('public/styles.css')
  ]);

  assert.match(panels, /let infoPanelGestureOwnerRuntime = null;/);
  assert.match(panels, /runtime\.infoPanelGeometryGesture = gesture/);
  assert.doesNotMatch(panels, /let activeInfoPanel(?:Drag|Resize)Gesture/);
  assert.match(panels, /setPointerCapture\(event\.pointerId\)/);
  assert.match(panels, /hasPointerCapture\?\.\(gesture\.pointerId\)[^]*releasePointerCapture\(gesture\.pointerId\)/);
  assert.match(panels, /pointermove[^]*pointerup[^]*pointercancel[^]*lostpointercapture/);
  assert.match(panels, /window\.requestAnimationFrame\(\(\) => applyInfoPanelGeometryFrame\(gesture\)\)/);
  assert.match(panels, /startClientX: event\.clientX[^]*startClientY: event\.clientY[^]*startRect:/);
  assert.match(panels, /translate3d\(\$\{dx\}px, \$\{dy\}px, 0\)/);
  assert.match(panels, /commitInfoPanelGeometryToViewState\(\s*runtime, gesture\.identity, finalRect/);
  assert.match(panels, /if \(persist && committed\)[^]*saveViewState\(committed\.tab\.id, \{ \.\.\.committed\.viewState \}\)/);
  assert.match(panels, /function temporaryInfoHoverOwnsPoint[^]*relatedPanel[^]*resolveCanvasPointer/);
  assert.match(panels, /function textOffsetAtPoint[^]*caretPositionFromPoint[^]*caretRangeFromPoint/);
  assert.match(panels, /promoteTemporaryBlockInfoPanel[^]*selectionOffset: textOffsetAtPoint/);
  assert.match(canvas, /pointerIsOverTemporaryInfoPanel\(runtime,[^]*\) \{\s*return;\s*\}/);
  assert.match(bootstrap, /pointerleave[^]*temporaryInfoHoverOwnsPoint/);
  assert.match(styles, /\.info-panel\.is-temporary \{[^}]*pointer-events: auto;/);
  assert.match(styles, /\.info-panel-titlebar \{[^}]*touch-action: none;/);
  assert.match(styles, /\.info-panel-resize-handle \{[^}]*touch-action: none;/);
});

test('Page schema normalises and preserves Info text through partial layout saves', async () => {
  const server = await read('server/appServer.js');
  assert.match(server, /page\.blocks = page\.blocks\.map\([^]*?info: typeof block\?\.info === 'string' \? block\.info : ''/);
  assert.match(server, /page\.highlightGroups = page\.highlightGroups\.map\([^]*?info: typeof group\?\.info === 'string' \? group\.info : ''/);
  assert.match(server, /const existingBlocks = new Map[^]*?info: typeof block\.info === 'string'[^]*?existingBlock\?\.info/);
  assert.match(server, /const existingGroupsById = new Map[^]*?info: typeof group\.info === 'string'[^]*?existingGroup\?\.info/);
});

test('shutdown Info flush saves the active draft after all previously queued writes', async () => {
  const source = await read('public/js/infoPanels.js');
  const page = {
    id: 'page_a',
    blocks: [{ id: 'block_a', info: 'Original info' }],
    highlightGroups: []
  };
  const canonicalPages = new Map([[page.id, page]]);
  const tab = {
    id: 'tab_a',
    currentPageId: page.id,
    viewState: {
      infoPanels: [{
        kind: 'block', ownerId: 'block_a', x: 16, y: 16,
        width: 320, height: 220, z: 1, minimized: false, autoPositioned: true
      }],
      checkedHighlightGroupIds: []
    }
  };
  const pane = {
    id: 'pane_a',
    viewContext: { currentPage: page },
    session: {
      activeTab: () => tab,
      tabById: (tabId) => tabId === tab.id ? tab : null,
      tabs: () => [tab],
      saveViewState: () => true
    }
  };
  const runtime = installTestRuntime(pane, page);
  const requests = [];
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: page,
    workspace: { state: { panes: [pane] } },
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    checkedHighlightGroupIdsForViewState: () => [],
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: (url, options) => new Promise((resolve) => {
      requests.push({ url, body: JSON.parse(options.body), resolve });
    }),
    commitCanonicalPage: (saved) => {
      canonicalPages.set(saved.id, saved);
      runtime.currentPage = saved;
      return saved;
    },
    showStatus() {},
    showRuntimeStatus() {}
  };
  installTestRuntimeOwners(context, [pane], runtime);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;renderInfoPanelsForPage = () => {};\n`
    + 'globalThis.infoFlushTest = {\n'
    + '  queue: queueInfoTextSave, flush: flushInfoPanelSavesNow,\n'
    + '  setEditor: installTestInfoEditor,\n'
    + '  hasEditor: (runtime) => Boolean(runtime.infoPanelEditor)\n'
    + '};', context);
  const api = context.globalThis.infoFlushTest;

  api.queue({ runtime, pageId: page.id, kind: 'block', ownerId: 'block_a' },
    'Earlier queued info', 'Original info');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.blocks[0].info, 'Earlier queued info');

  api.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_a',
    originalText: 'Earlier queued info',
    draftText: 'Final active draft',
    textarea: { value: 'Final active draft' }
  });
  let flushSettled = false;
  const flushing = api.flush().then(() => { flushSettled = true; });
  await Promise.resolve();
  assert.equal(api.hasEditor(runtime), false);
  assert.equal(flushSettled, false);
  assert.equal(requests.length, 1);

  requests[0].resolve({ ...page, blocks: requests[0].body.blocks });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.blocks[0].info, 'Final active draft');
  assert.equal(flushSettled, false);

  requests[1].resolve({ ...page, blocks: requests[1].body.blocks });
  await flushing;
  assert.equal(flushSettled, true);
  assert.equal(canonicalPages.get(page.id).blocks[0].info, 'Final active draft');
});

test('shutdown Info flush saves a draft parked by strong edit-mode suspension', async () => {
  const source = await read('public/js/infoPanels.js');
  const page = {
    id: 'page_suspended',
    blocks: [{ id: 'block_suspended', info: 'Persisted before suspension' }],
    highlightGroups: []
  };
  const canonicalPages = new Map([[page.id, page]]);
  const tab = {
    id: 'tab_suspended',
    currentPageId: page.id,
    viewState: {
      infoPanels: [{
        kind: 'block', ownerId: 'block_suspended', x: 44, y: 38,
        width: 390, height: 275, z: 3, minimized: false, autoPositioned: false
      }],
      checkedHighlightGroupIds: []
    }
  };
  const pane = {
    id: 'pane_suspended',
    viewContext: { currentPage: page, infoPanelsSuspended: false },
    session: {
      activeTab: () => tab,
      tabById: (tabId) => tabId === tab.id ? tab : null,
      tabs: () => [tab],
      saveViewState: () => true
    }
  };
  const runtime = installTestRuntime(pane, page);
  const requests = [];
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: page,
    workspace: { state: { panes: [pane] } },
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    pageForWorkspacePane: (ownerPane) => ownerPane.viewContext.currentPage,
    checkedHighlightGroupIdsForViewState: () => [],
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ...page, blocks: JSON.parse(options.body).blocks };
    },
    commitCanonicalPage: (saved) => {
      canonicalPages.set(saved.id, saved);
      runtime.currentPage = saved;
      return saved;
    },
    showStatus() {},
    showRuntimeStatus() {}
  };
  installTestRuntimeOwners(context, [pane], runtime);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;renderInfoPanelsForPage = () => {};\n`
    + 'setInfoPanelLayerSuspended = () => {};\n'
    + 'cancelInfoPanelGeometryGesture = () => false;\n'
    + 'hideTemporaryBlockInfo = () => false;\n'
    + 'globalThis.infoSuspendedFlushTest = {\n'
    + '  suspend: suspendInfoPanelsForRuntime, flush: flushInfoPanelSavesNow,\n'
    + '  setEditor: installTestInfoEditor,\n'
    + '  editor: (runtime) => runtime.infoPanelEditor\n'
    + '};', context);
  const api = context.globalThis.infoSuspendedFlushTest;
  api.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_suspended',
    originalText: 'Persisted before suspension',
    draftText: 'Stale input event value',
    textarea: {
      value: 'Unsaved draft at shutdown',
      selectionStart: 9,
      selectionEnd: 14,
      selectionDirection: 'forward'
    }
  });

  assert.equal(api.suspend(runtime), true);
  assert.equal(api.editor(runtime), null);
  assert.equal(runtime.suspendedInfoPanelEditor.draftText,
    'Unsaved draft at shutdown');

  const flushed = await api.flush();
  assert.equal(flushed.ok, true);
  assert.equal(runtime.suspendedInfoPanelEditor, null);
  assert.equal(api.editor(runtime), null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.blocks[0].info, 'Unsaved draft at shutdown');
  assert.equal(canonicalPages.get(page.id).blocks[0].info, 'Unsaved draft at shutdown');
});

test('Page context change drains a draft parked by strong edit-mode suspension', async () => {
  const source = await read('public/js/infoPanels.js');
  const page = {
    id: 'page_context_source',
    blocks: [{ id: 'block_context', info: 'Persisted before context change' }],
    highlightGroups: []
  };
  const canonicalPages = new Map([[page.id, page]]);
  const tab = {
    id: 'tab_context',
    currentPageId: page.id,
    viewState: {
      infoPanels: [{
        kind: 'block', ownerId: 'block_context', x: 20, y: 24,
        width: 320, height: 220, z: 1, minimized: false, autoPositioned: false
      }],
      checkedHighlightGroupIds: []
    }
  };
  const pane = {
    id: 'pane_context',
    viewContext: { currentPage: page, infoPanelsSuspended: false },
    session: {
      activeTab: () => tab,
      tabById: (tabId) => tabId === tab.id ? tab : null,
      tabs: () => [tab],
      saveViewState: () => true
    }
  };
  const runtime = installTestRuntime(pane, page);
  const requests = [];
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: page,
    workspace: { state: { panes: [pane] } },
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    pageForWorkspacePane: (ownerPane) => ownerPane.viewContext.currentPage,
    checkedHighlightGroupIdsForViewState: () => [],
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ...page, blocks: JSON.parse(options.body).blocks };
    },
    commitCanonicalPage: (saved) => {
      canonicalPages.set(saved.id, saved);
      runtime.currentPage = saved;
      return saved;
    },
    showStatus() {},
    showRuntimeStatus() {}
  };
  installTestRuntimeOwners(context, [pane], runtime);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;renderInfoPanelsForPage = () => {};\n`
    + 'setInfoPanelLayerSuspended = () => {};\n'
    + 'cancelInfoPanelGeometryGesture = () => false;\n'
    + 'hideTemporaryBlockInfo = () => false;\n'
    + 'hideAllTemporaryInfoPanels = () => {};\n'
    + 'globalThis.infoContextChangeTest = {\n'
    + '  suspend: suspendInfoPanelsForRuntime, prepare: prepareInfoPanelsForRuntimeContextChange,\n'
    + '  flush: flushInfoPanelSavesNow,\n'
    + '  setEditor: installTestInfoEditor,\n'
    + '  editor: (runtime) => runtime.infoPanelEditor\n'
    + '};', context);
  const api = context.globalThis.infoContextChangeTest;
  api.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_context',
    originalText: 'Persisted before context change',
    draftText: 'Stale input event draft',
    textarea: {
      value: 'Unsaved draft before Page switch',
      selectionStart: 12,
      selectionEnd: 12,
      selectionDirection: 'none'
    }
  });

  assert.equal(api.suspend(runtime), true);
  assert.equal(api.editor(runtime), null);
  assert.equal(runtime.suspendedInfoPanelEditor.draftText,
    'Unsaved draft before Page switch');

  api.prepare(runtime);
  assert.equal(runtime.suspendedInfoPanelEditor, null);
  assert.equal(api.editor(runtime), null);
  assert.equal(canonicalPages.get(page.id).blocks[0].info,
    'Unsaved draft before Page switch');

  tab.currentPageId = 'page_context_target';
  runtime.currentPage = { id: 'page_context_target', blocks: [], highlightGroups: [] };
  await api.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/pages/page_context_source');
  assert.equal(requests[0].body.blocks[0].info, 'Unsaved draft before Page switch');
  assert.equal(api.editor(runtime), null);
});

test('failed shutdown Info flush remains retryable and reports failure until persistence succeeds', async () => {
  const source = await read('public/js/infoPanels.js');
  const page = {
    id: 'page_retry',
    blocks: [{ id: 'block_retry', info: 'Persisted info' }],
    highlightGroups: []
  };
  const canonicalPages = new Map([[page.id, page]]);
  let shouldFail = true;
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: page,
    runtimeIsLive: () => false,
    livingPaneRuntimes: () => [],
    getWorkspacePane: () => null,
    activePaneRuntime: () => null,
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: async (_url, options) => {
      if (shouldFail) throw new Error('simulated EACCES');
      return { ...page, blocks: JSON.parse(options.body).blocks };
    },
    commitCanonicalPage: (saved) => {
      canonicalPages.set(saved.id, saved);
      context.currentPage = saved;
      return saved;
    },
    showStatus() {},
    showRuntimeStatus() {}
  };
  vm.runInNewContext(`${source}\n;renderInfoPanelsForPage = () => {};\n`
    + 'globalThis.infoRetryTest = { queue: queueInfoTextSave, flush: flushInfoPanelSavesNow, '
    + 'discard: discardInfoPanelSavesForPage };',
  context);

  context.globalThis.infoRetryTest.queue({
    runtime: null,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_retry'
  }, 'Latest intended info', 'Persisted info');
  const failed = await context.globalThis.infoRetryTest.flush();
  assert.equal(failed.ok, false);
  assert.match(failed.error, /EACCES/);
  assert.equal(canonicalPages.get(page.id).blocks[0].info, 'Persisted info');

  shouldFail = false;
  const retried = await context.globalThis.infoRetryTest.flush();
  assert.equal(retried.ok, true);
  assert.equal(canonicalPages.get(page.id).blocks[0].info, 'Latest intended info');

  shouldFail = true;
  context.globalThis.infoRetryTest.queue({
    runtime: null,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_retry'
  }, 'Draft for a deleted Page', 'Latest intended info');
  assert.equal((await context.globalThis.infoRetryTest.flush()).ok, false);
  assert.equal(context.globalThis.infoRetryTest.discard(page.id), 1);
  assert.equal((await context.globalThis.infoRetryTest.flush()).ok, true);
});

test('failed active Info flush restores the exact visible draft and cursor for retry', async () => {
  const source = await read('public/js/infoPanels.js');
  const page = {
    id: 'page_visible_retry',
    blocks: [{ id: 'block_visible_retry', info: 'Persisted info' }],
    highlightGroups: []
  };
  const canonicalPages = new Map([[page.id, page]]);
  const tab = {
    id: 'tab_visible_retry',
    currentPageId: page.id,
    viewState: {
      infoPanels: [{
        kind: 'block', ownerId: 'block_visible_retry', x: 16, y: 16,
        width: 320, height: 220, z: 1, minimized: false, autoPositioned: true
      }],
      checkedHighlightGroupIds: []
    }
  };
  const pane = {
    id: 'pane_visible_retry',
    viewContext: { currentPage: page },
    session: {
      activeTab: () => tab,
      tabById: (tabId) => tabId === tab.id ? tab : null,
      saveViewState: () => true
    }
  };
  const runtime = installTestRuntime(pane, page);
  let shouldFail = true;
  let requestCount = 0;
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: page,
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    checkedHighlightGroupIdsForViewState: () => [],
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: async (_url, options) => {
      requestCount += 1;
      if (shouldFail) throw new Error('simulated EACCES');
      return { ...page, blocks: JSON.parse(options.body).blocks };
    },
    commitCanonicalPage: (saved) => {
      canonicalPages.set(saved.id, saved);
      runtime.currentPage = saved;
      return saved;
    },
    showStatus() {},
    showRuntimeStatus() {},
    paneRenderCount: 0
  };
  installTestRuntimeOwners(context, [pane], runtime);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;renderInfoPanelsForPage = () => { paneRenderCount += 1; };\n`
    + 'globalThis.infoVisibleRetryTest = {\n'
    + '  flush: flushInfoPanelSavesNow,\n'
    + '  cancel: cancelInfoPanelEditor,\n'
    + '  setEditor: installTestInfoEditor,\n'
    + '  editor: (runtime) => runtime.infoPanelEditor\n'
    + '};', context);
  const api = context.globalThis.infoVisibleRetryTest;
  api.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_visible_retry',
    originalText: 'Persisted info',
    draftText: '  Exact unsaved draft  ',
    textarea: { value: '  Exact unsaved draft  ', selectionStart: 7 }
  });

  const failed = await api.flush();
  assert.equal(failed.ok, false);
  assert.equal(canonicalPages.get(page.id).blocks[0].info, 'Persisted info');
  assert.deepEqual(
    {
      paneId: api.editor(runtime)?.paneId,
      tabId: api.editor(runtime)?.tabId,
      pageId: api.editor(runtime)?.pageId,
      kind: api.editor(runtime)?.kind,
      ownerId: api.editor(runtime)?.ownerId,
      originalText: api.editor(runtime)?.originalText,
      draftText: api.editor(runtime)?.draftText,
      selectionOffset: api.editor(runtime)?.selectionOffset,
      textarea: api.editor(runtime)?.textarea
    },
    {
      paneId: pane.id,
      tabId: tab.id,
      pageId: page.id,
      kind: 'block',
      ownerId: 'block_visible_retry',
      originalText: 'Persisted info',
      draftText: '  Exact unsaved draft  ',
      selectionOffset: 7,
      textarea: null
    }
  );
  assert.ok(context.paneRenderCount > 0);

  shouldFail = false;
  const retried = await api.flush();
  assert.equal(retried.ok, true);
  assert.equal(api.editor(runtime), null);
  assert.equal(canonicalPages.get(page.id).blocks[0].info, '  Exact unsaved draft  ');

  Object.assign(tab.viewState.infoPanels[0], {
    x: 91.5,
    y: 73.25,
    width: 386.25,
    height: 274.75,
    autoPositioned: false
  });
  shouldFail = true;
  api.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: page.id,
    kind: 'block',
    ownerId: 'block_visible_retry',
    originalText: '  Exact unsaved draft  ',
    draftText: '',
    textarea: { value: '', selectionStart: 0 }
  });
  assert.equal((await api.flush()).ok, false);
  assert.equal(api.editor(runtime)?.draftText, '');
  assert.equal(tab.viewState.infoPanels.length, 1);
  assert.deepEqual(
    {
      x: tab.viewState.infoPanels[0].x,
      y: tab.viewState.infoPanels[0].y,
      width: tab.viewState.infoPanels[0].width,
      height: tab.viewState.infoPanels[0].height,
      autoPositioned: tab.viewState.infoPanels[0].autoPositioned
    },
    { x: 91.5, y: 73.25, width: 386.25, height: 274.75, autoPositioned: false }
  );
  const requestsBeforeCancel = requestCount;
  assert.equal(api.cancel(runtime), true);
  shouldFail = false;
  assert.equal((await api.flush()).ok, true);
  assert.equal(requestCount, requestsBeforeCancel);
  assert.equal(canonicalPages.get(page.id).blocks[0].info, '  Exact unsaved draft  ');
});

test('an older failed Info request cannot replace a newer saved editor interaction', async () => {
  const source = await read('public/js/infoPanels.js');
  const page = {
    id: 'page_info_race',
    blocks: [
      { id: 'block_a', info: 'A persisted' },
      { id: 'block_b', info: 'B persisted' }
    ],
    highlightGroups: []
  };
  const canonicalPages = new Map([[page.id, page]]);
  const tab = {
    id: 'tab_info_race',
    currentPageId: page.id,
    viewState: {
      infoPanels: [
        { kind: 'block', ownerId: 'block_a', x: 16, y: 16, width: 320, height: 220 },
        { kind: 'block', ownerId: 'block_b', x: 16, y: 50, width: 320, height: 220 }
      ],
      checkedHighlightGroupIds: []
    }
  };
  const pane = {
    id: 'pane_info_race',
    viewContext: { currentPage: page },
    session: {
      activeTab: () => tab,
      tabById: (tabId) => tabId === tab.id ? tab : null,
      saveViewState: () => true
    }
  };
  const runtime = installTestRuntime(pane, page);
  const requests = [];
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: page,
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    checkedHighlightGroupIdsForViewState: () => [],
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: (_url, options) => new Promise((resolve, reject) => {
      requests.push({ body: JSON.parse(options.body), resolve, reject });
    }),
    commitCanonicalPage: (saved) => {
      canonicalPages.set(saved.id, saved);
      runtime.currentPage = saved;
      context.currentPage = saved;
      return saved;
    },
    showStatus() {},
    showRuntimeStatus() {}
  };
  installTestRuntimeOwners(context, [pane], runtime);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;renderInfoPanelsForPage = () => {};\n`
    + 'renderInfoPanelsForRuntime = () => {};\n'
    + 'globalThis.infoRaceTest = {\n'
    + '  save: saveInfoPanelEditor,\n'
    + '  discard: discardInfoPanelSavesForPage,\n'
    + '  setEditor: installTestInfoEditor,\n'
    + '  editor: (runtime) => runtime.infoPanelEditor\n'
    + '};', context);
  const api = context.globalThis.infoRaceTest;
  const editor = (ownerId, originalText, draftText) => ({
    paneId: pane.id,
    tabId: tab.id,
    pageId: page.id,
    kind: 'block',
    ownerId,
    originalText,
    draftText,
    textarea: { value: draftText, selectionStart: draftText.length }
  });

  api.setEditor(runtime, editor('block_a', 'A persisted', 'A intended'));
  const savingA = api.save(runtime);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);

  api.setEditor(runtime, editor('block_b', 'B persisted', 'B intended'));
  const savingB = api.save(runtime);
  requests[0].reject(new Error('older A failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(api.editor(runtime), null);

  requests[1].resolve({ ...page, blocks: requests[1].body.blocks });
  assert.equal((await savingA).ok, false);
  assert.equal((await savingB).ok, true);
  assert.equal(api.editor(runtime), null);
  assert.equal(canonicalPages.get(page.id).blocks.find((block) => block.id === 'block_b').info,
    'B intended');

  api.setEditor(runtime, editor('block_b', 'B intended', 'discarded in flight'));
  const savingDiscarded = api.save(runtime);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 3);
  assert.ok(api.discard(page.id) >= 1);
  requests[2].reject(new Error('discarded request failed later'));
  assert.equal((await savingDiscarded).ok, false);
  assert.equal(api.editor(runtime), null);
});

test('Info geometry commits to the live stable-identity entry before content save rerenders', async () => {
  const { createTabSession } = require('../public/sessionTabs');
  const source = await read('public/js/infoPanels.js');
  const canonicalPages = new Map([['page_a', {
    id: 'page_a',
    blocks: [{ id: 'block_a', info: 'Original info' }],
    highlightGroups: []
  }]]);
  const session = createTabSession({ createId: () => 'tab_a' });
  const tab = session.createTab('page_a');
  const staleEntry = {
    kind: 'block', ownerId: 'block_a', x: 16, y: 16,
    width: 320, height: 220, z: 1, minimized: false, autoPositioned: true
  };
  tab.viewState.infoPanels = [staleEntry];
  // A prior persisted interaction replaces viewState while the existing DOM closure remains alive.
  session.saveViewState(tab.id, tab.viewState);
  const pane = {
    id: 'pane_a',
    session,
    viewContext: { currentPage: canonicalPages.get('page_a') }
  };
  const runtime = installTestRuntime(pane, canonicalPages.get('page_a'));
  const renderedGeometries = [];
  const context = {
    globalThis: {},
    canonicalPages,
    currentPage: canonicalPages.get('page_a'),
    checkedHighlightGroupIdsForViewState: () => [],
    commitCanonicalPage: (page) => {
      canonicalPages.set(page.id, page);
      context.currentPage = page;
      runtime.currentPage = page;
      return page;
    },
    testRenderInfoPanelsForPage: () => {
      const entry = pane.session.activeTab().viewState.infoPanels[0];
      renderedGeometries.push([entry.x, entry.y, entry.width, entry.height]);
    },
    showRuntimeStatus() {}
  };
  installTestRuntimeOwners(context, [pane], runtime);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;globalThis.infoGeometryTest = {\n`
    + 'infoPanelIdentityForRuntime, infoPanelEntryForIdentity, '
    + 'commitInfoPanelGeometryToViewState, '
    + 'setEditor: installTestInfoEditor, '
    + 'saveEditor: saveInfoPanelEditor\n};\n'
    + 'queueInfoTextSave = () => Promise.resolve(null);\n'
    + 'renderInfoPanelsForPage = testRenderInfoPanelsForPage;', context);
  const geometry = context.globalThis.infoGeometryTest;
  const identity = geometry.infoPanelIdentityForRuntime(runtime, 'block', 'block_a');
  assert.notEqual(geometry.infoPanelEntryForIdentity(runtime, identity), staleEntry);

  const dragged = geometry.commitInfoPanelGeometryToViewState(runtime, identity, {
    left: 91.5, top: 73.25, width: 320, height: 220
  });
  session.saveViewState(dragged.tab.id, { ...dragged.viewState });
  const liveAfterDrag = geometry.infoPanelEntryForIdentity(runtime, identity);
  geometry.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: 'page_a',
    kind: 'block',
    ownerId: 'block_a',
    originalText: 'Original info',
    draftText: 'Saved after drag',
    textarea: { value: 'Saved after drag' }
  });
  await geometry.saveEditor(runtime);
  let rendered = geometry.infoPanelEntryForIdentity(runtime, identity);
  assert.equal(rendered, liveAfterDrag);
  assert.deepEqual(
    [rendered.x, rendered.y, rendered.width, rendered.height, rendered.autoPositioned],
    [91.5, 73.25, 320, 220, false]
  );
  assert.deepEqual([staleEntry.x, staleEntry.y], [16, 16]);

  const resized = geometry.commitInfoPanelGeometryToViewState(runtime, identity, {
    left: 77.75, top: 61.5, width: 386.25, height: 274.75
  });
  session.saveViewState(resized.tab.id, { ...resized.viewState });
  const liveAfterResize = geometry.infoPanelEntryForIdentity(runtime, identity);
  geometry.setEditor(runtime, {
    paneId: pane.id,
    tabId: tab.id,
    pageId: 'page_a',
    kind: 'block',
    ownerId: 'block_a',
    originalText: 'Saved after drag',
    draftText: 'Saved after resize',
    textarea: { value: 'Saved after resize' }
  });
  await geometry.saveEditor(runtime);
  rendered = geometry.infoPanelEntryForIdentity(runtime, identity);
  assert.equal(rendered, liveAfterResize);
  assert.deepEqual(
    [rendered.x, rendered.y, rendered.width, rendered.height],
    [77.75, 61.5, 386.25, 274.75]
  );
  assert.deepEqual(renderedGeometries, [
    [91.5, 73.25, 320, 220],
    [77.75, 61.5, 386.25, 274.75]
  ]);
});

test('strong Page edit modes suspend and restore only the owning Pane Info layer', async () => {
  const [source, canvas] = await Promise.all([
    read('public/js/infoPanels.js'),
    read('public/js/canvasBlocks.js')
  ]);
  const counters = { save: 0, cancel: 0, hide: 0, render: 0 };
  const createLayer = () => {
    const classes = new Set();
    return {
      hidden: false,
      classList: {
        toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name)
      }
    };
  };
  const layers = new Map([['pane_a', createLayer()], ['pane_b', createLayer()]]);
  const fixedPanels = [{
    kind: 'block', ownerId: 'block_a', x: 84, y: 63,
    width: 375, height: 268, z: 7, minimized: false, autoPositioned: false
  }, {
    kind: 'highlight', ownerId: 'group_a', x: 28, y: 18,
    width: 320, height: 220, z: 4, minimized: true, autoPositioned: false
  }];
  const pageA = {
    id: 'page_a',
    blocks: [{ id: 'block_a', info: 'Saved text' }],
    highlightGroups: [{ id: 'group_a', info: 'Highlight text' }]
  };
  const tabA = { id: 'tab_a', currentPageId: pageA.id };
  const paneA = {
    id: 'pane_a',
    viewContext: { infoPanelsSuspended: false, temporaryInfoBlockId: 'block_hover' },
    session: {
      activeTab: () => tabA,
      tabById: (tabId) => tabId === tabA.id ? tabA : null,
      saveViewState: () => true
    },
    fixedPanels
  };
  tabA.viewState = { infoPanels: fixedPanels, checkedHighlightGroupIds: [] };
  const paneB = {
    id: 'pane_b',
    viewContext: { infoPanelsSuspended: false, temporaryInfoBlockId: null },
    session: {
      activeTab: () => null,
      tabById: () => null,
      saveViewState: () => true
    }
  };
  const runtimeA = installTestRuntime(paneA, pageA);
  const runtimeB = installTestRuntime(paneB, null);
  runtimeA.temporaryInfoBlockId = 'block_hover';
  const context = {
    globalThis: {},
    canonicalPages: new Map([[pageA.id, pageA]]),
    testInfoLayer: (runtime) => layers.get(runtime.paneId),
    testSaveInfoEditor: () => { counters.save += 1; },
    testCancelInfoGesture: () => { counters.cancel += 1; },
    testHideTemporaryInfo: (runtime) => {
      counters.hide += 1;
      runtime.temporaryInfoBlockId = null;
      return true;
    },
    testRenderInfoRuntime: () => { counters.render += 1; },
    showRuntimeStatus() {}
  };
  installTestRuntimeOwners(context, [paneA, paneB], runtimeA);
  vm.runInNewContext(`${source}\n${INFO_EDITOR_TEST_HELPER}\n;globalThis.infoSuspensionTest = {\n`
    + 'suspendInfoPanelsForRuntime, resumeInfoPanelsForRuntime, infoPanelsSuspendedForRuntime, '
    + 'setEditor: installTestInfoEditor, '
    + 'editor: (runtime) => runtime.infoPanelEditor\n};\n'
    + 'infoPanelLayerForRuntime = testInfoLayer;\n'
    + 'saveInfoPanelEditor = (runtime) => { testSaveInfoEditor(); '
    + 'runtime.infoPanelEditor = null; return Promise.resolve(true); };\n'
    + 'cancelInfoPanelGeometryGesture = () => { testCancelInfoGesture(); return true; };\n'
    + 'hideTemporaryBlockInfo = testHideTemporaryInfo;\n'
    + 'renderInfoPanelsForRuntime = testRenderInfoRuntime;', context);
  const suspension = context.globalThis.infoSuspensionTest;
  const before = JSON.stringify(fixedPanels);
  const liveTextarea = {
    value: 'Unsaved suspended draft',
    selectionStart: 8,
    selectionEnd: 17,
    selectionDirection: 'forward'
  };
  suspension.setEditor(runtimeA, {
    paneId: paneA.id,
    tabId: tabA.id,
    pageId: pageA.id,
    kind: 'block',
    ownerId: 'block_a',
    originalText: 'Saved text',
    draftText: 'Older input event draft',
    textarea: liveTextarea
  });

  assert.equal(suspension.suspendInfoPanelsForRuntime(runtimeA), true);
  assert.equal(suspension.infoPanelsSuspendedForRuntime(runtimeA), true);
  assert.equal(layers.get('pane_a').hidden, true);
  assert.equal(layers.get('pane_a').classList.contains('is-suspended'), true);
  assert.equal(runtimeA.temporaryInfoBlockId, null);
  assert.deepEqual(counters, { save: 0, cancel: 1, hide: 1, render: 0 });
  assert.equal(suspension.editor(runtimeA), null);
  assert.equal(runtimeA.suspendedInfoPanelEditor.draftText,
    'Unsaved suspended draft');
  assert.equal(runtimeA.suspendedInfoPanelEditor.selectionOffset, 8);
  assert.equal(runtimeA.suspendedInfoPanelEditor.selectionEnd, 17);
  assert.equal(runtimeA.suspendedInfoPanelEditor.selectionDirection, 'forward');
  assert.equal(JSON.stringify(fixedPanels), before);
  assert.equal(suspension.infoPanelsSuspendedForRuntime(runtimeB), false);
  assert.equal(layers.get('pane_b').hidden, false);

  assert.equal(suspension.suspendInfoPanelsForRuntime(runtimeA), true);
  assert.deepEqual(counters, { save: 0, cancel: 1, hide: 1, render: 0 });

  assert.equal(suspension.resumeInfoPanelsForRuntime(runtimeA), true);
  assert.equal(suspension.infoPanelsSuspendedForRuntime(runtimeA), false);
  assert.equal(layers.get('pane_a').hidden, false);
  assert.equal(layers.get('pane_a').classList.contains('is-suspended'), false);
  assert.equal(counters.render, 1);
  assert.equal(runtimeA.suspendedInfoPanelEditor, null);
  assert.equal(suspension.editor(runtimeA).draftText, 'Unsaved suspended draft');
  assert.equal(suspension.editor(runtimeA).selectionOffset, 8);
  assert.equal(suspension.editor(runtimeA).selectionEnd, 17);
  assert.equal(suspension.editor(runtimeA).textarea, null);
  assert.equal(JSON.stringify(fixedPanels), before);

  suspension.setEditor(runtimeA, {
    paneId: paneA.id,
    tabId: tabA.id,
    pageId: pageA.id,
    kind: 'block',
    ownerId: 'block_a',
    originalText: 'Saved text',
    draftText: 'Must not resurrect',
    textarea: { value: 'Must not resurrect', selectionStart: 4, selectionEnd: 4 }
  });
  assert.equal(suspension.suspendInfoPanelsForRuntime(runtimeA), true);
  pageA.blocks = [];
  assert.equal(suspension.resumeInfoPanelsForRuntime(runtimeA), true);
  assert.equal(suspension.editor(runtimeA), null);
  assert.equal(runtimeA.suspendedInfoPanelEditor, null);
  assert.deepEqual(counters, { save: 0, cancel: 2, hide: 2, render: 2 });

  assert.match(canvas, /function setBlockEditMode\(runtime, active\)[^]*suspendInfoPanelsForRuntime\(runtime\)[^]*resumeInfoPanelsForRuntime\(runtime\)/);
  assert.match(canvas, /function setPageEditMode\(runtime, active\)[^]*suspendInfoPanelsForRuntime\(runtime\)[^]*resumeInfoPanelsForRuntime\(runtime\)/);
  assert.match(source, /function renderInfoPanelsForRuntime\(runtime\)[^]*if \(suspended\) \{[^]*layer\.hidden = true;[^]*return;/);
});
