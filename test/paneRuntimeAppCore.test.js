'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createPaneRuntimeHarness,
  deferred
} = require('./helpers/paneRuntimeHarness');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) => fs.readFile(path.join(ROOT, relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function compileSource(source, startMarker, endMarker, dependencies, returnExpression) {
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return new Function(
    ...names,
    `${sourceBetween(source, startMarker, endMarker)}\nreturn ${returnExpression};`
  )(...values);
}

function canvasPage(id) {
  return {
    id,
    code: id,
    name: id,
    title: id,
    type: 'canvas',
    objects: [],
    blocks: [],
    highlightGroups: []
  };
}

function switchRuntimeToPage(runtime, page) {
  const tab = runtime.session.createTab(page.id);
  runtime.currentPage = page;
  runtime.currentPageEntry = { id: page.id, title: page.title };
  runtime.pageLoadSequence += 1;
  runtime.loadGeneration = runtime.pageLoadSequence;
  runtime.mounted = {
    tabId: tab.id,
    pageId: page.id,
    kind: page.type,
    generation: (runtime.mounted?.generation || 0) + 1
  };
  return tab;
}

function loadPageOwner(app, harness, request, calls = []) {
  const dependencies = {
    runtimeIsLive: harness.runtimeIsLive,
    activePaneRuntime: harness.activePaneRuntime,
    commitFocusedMarkdownEditor: () => calls.push(['commit-focused-editor']),
    resetRightRelationFilters: () => calls.push(['reset-right-filters']),
    activeTab: (runtime) => runtime.session.activeTab(),
    updatePageHistoryButtons: (runtime) => calls.push(['history-buttons', runtime]),
    globalThis: {},
    closePageMetaModal: () => {},
    closePageContextMenu: () => {},
    closeFolderContextMenu: () => {},
    closeRelationContextMenu: () => {},
    closeResourceContextMenu: () => {},
    prepareInfoPanelsForRuntimeContextChange: () => {},
    closeAddLinkPopover: () => {},
    setEditMenuOpen: () => {},
    setHighlightMenuOpen: () => {},
    cancelBlockEdits: () => {},
    cancelPageEdits: () => {},
    cancelHighlightEdits: () => {},
    saveActiveTabViewState: (runtime) => calls.push(['save-view', runtime]),
    captureRuntimeOperation: harness.captureRuntimeOperation,
    runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
    showRuntimeStatus: (runtime, ...detail) => calls.push(['status', runtime, ...detail]),
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request,
    canonicalPages: harness.context.canonicalPages,
    commitCanonicalPage(page, { originRuntime } = {}) {
      calls.push(['canonical', originRuntime, page]);
      harness.context.canonicalPages.set(page.id, page);
      return page;
    },
    prepareActiveTabHighlightState: (runtime) => calls.push(['highlight', runtime]),
    renderPage(runtime, page) {
      calls.push(['render', runtime, page]);
      runtime.mounted = {
        tabId: runtime.session.activeTab()?.id || null,
        pageId: page.id,
        kind: page.type,
        generation: (runtime.mounted?.generation || 0) + 1
      };
    },
    restoreActiveTabViewState: (runtime) => calls.push(['restore-view', runtime]),
    persistLastOpenedPage: async (pageId) => calls.push(['last-opened', pageId]),
    scheduleWorkspaceStateSave: () => calls.push(['workspace-save']),
    scheduleHnSessionReferenceReconcile: () => {},
    renderTabStrip: () => {}
  };
  return compileSource(
    app,
    'const PAGE_HISTORY_MODES',
    'function capturePageHistoryTraversalOwner',
    dependencies,
    '{ loadPage, completePageOpen, commitPageHistoryOpen }'
  );
}

test('runtime-first Markdown callbacks reject crossed Pane/Page owners and accept the exact owner', async () => {
  const app = await read('public/app.js');
  const markdownA = { ...canvasPage('markdown-a'), type: 'markdown', markdownBody: 'before' };
  const markdownB = { ...canvasPage('markdown-b'), type: 'markdown', markdownBody: 'other' };
  const harness = await createPaneRuntimeHarness({ leftPage: markdownA, rightPage: markdownB });
  const syncs = [];
  const refreshes = [];
  const timers = [];
  const canonicalPages = new Map([[markdownA.id, markdownA], [markdownB.id, markdownB]]);
  const updateMarkdownBodyFromView = compileSource(
    app,
    'function updateMarkdownBodyFromView',
    'async function flushMarkdownBodyPageNow',
    {
      runtimeIsLive: harness.runtimeIsLive,
      markdownPageMutationLocks: new Set(),
      canonicalPages,
      markdownPageModel: {
        PAGE_TYPES: { MARKDOWN: 'markdown' },
        normalizePageType: (type) => type
      },
      syncMarkdownDraftToOtherPanes: (...args) => syncs.push(args),
      activePaneRuntime: harness.activePaneRuntime,
      refreshMarkdownControlStrip: (runtime) => refreshes.push(runtime),
      markdownBodySaveStates: new Map(),
      window: {
        clearTimeout() {},
        setTimeout(callback, delay) {
          timers.push({ callback, delay });
          return timers.length;
        }
      },
      persistMarkdownBody: () => {}
    },
    'updateMarkdownBodyFromView'
  );

  assert.equal(updateMarkdownBodyFromView(harness.left.runtime, {
    paneId: harness.right.runtime.paneId,
    pageId: markdownA.id,
    markdownBody: 'crossed Pane'
  }), false);
  assert.equal(updateMarkdownBodyFromView(harness.left.runtime, {
    paneId: harness.left.runtime.paneId,
    pageId: markdownB.id,
    markdownBody: 'crossed Page'
  }), false);
  assert.equal(canonicalPages.get(markdownA.id).markdownBody, 'before');

  assert.equal(updateMarkdownBodyFromView(harness.left.runtime, {
    paneId: harness.left.runtime.paneId,
    pageId: markdownA.id,
    markdownBody: 'exact owner draft',
    commit: true
  }), true);
  assert.equal(canonicalPages.get(markdownA.id).markdownBody, 'exact owner draft');
  assert.equal(harness.left.runtime.currentPage.markdownBody, 'exact owner draft');
  assert.deepEqual(syncs, [[markdownA.id, harness.left.runtime]]);
  assert.deepEqual(refreshes, [harness.left.runtime]);
  assert.equal(timers.at(-1).delay, 0);
  assert.equal(harness.right.runtime.currentPage.markdownBody, 'other');
});

test('HN session errors render only in matching living Pane runtimes', async () => {
  const app = await read('public/app.js');
  const pageA = { ...canvasPage('cne-error-a'), type: 'cne-text' };
  const pageB = { ...canvasPage('cne-error-b'), type: 'cne-text' };
  const harness = await createPaneRuntimeHarness({ leftPage: pageA, rightPage: pageB });
  const statuses = [];
  const refreshed = [];
  const handleHnSessionError = compileSource(
    app,
    'function handleHnSessionError',
    'function hnSessionRegistry',
    {
      globalThis: {
        hnTextPageView: {
          refreshPageSessionState: (pageId) => refreshed.push(pageId)
        }
      },
      runtimeIsLive: harness.runtimeIsLive,
      livingPaneRuntimes: harness.livingPaneRuntimes,
      showRuntimeStatus: (runtime, message, isError, clearAfter) => {
        statuses.push({ runtime, message, isError, clearAfter });
      }
    },
    'handleHnSessionError'
  );

  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  handleHnSessionError({ pageId: pageA.id, message: 'Page A failed' });
  assert.deepEqual(statuses.map(({ runtime }) => runtime), [harness.left.runtime]);
  assert.equal(statuses[0].message, 'Page A failed');
  assert.equal(statuses[0].isError, true);
  assert.equal(statuses[0].clearAfter, 4000);

  statuses.length = 0;
  switchRuntimeToPage(harness.right.runtime, pageA);
  handleHnSessionError({ pageId: pageA.id, code: 'STALE_CNE_REVISION' });
  assert.deepEqual(
    statuses.map(({ runtime }) => runtime),
    [harness.left.runtime, harness.right.runtime],
    'a shared Page-scoped session reports deterministically to every visible matching runtime'
  );
  assert.equal(statuses.every(({ clearAfter }) => clearAfter === 0), true);

  statuses.length = 0;
  handleHnSessionError({ pageId: pageA.id, message: 'origin failure' }, harness.left.runtime);
  assert.deepEqual(statuses.map(({ runtime }) => runtime), [harness.left.runtime],
    'an explicit live initiating runtime remains the sole presentation owner');

  statuses.length = 0;
  harness.disposeRuntime(harness.left.runtime);
  switchRuntimeToPage(harness.right.runtime, pageB);
  handleHnSessionError({ pageId: pageA.id, message: 'detached failure' }, harness.left.runtime);
  assert.deepEqual(statuses, [], 'a disposed owner cannot write into detached or unrelated Pane DOM');
  assert.deepEqual(refreshed, [pageA.id, pageA.id, pageA.id, pageA.id]);
});

test('Pane activation closes global editors through the previous runtime and binds chrome to target', async () => {
  const app = await read('public/app.js');
  const harness = await createPaneRuntimeHarness();
  const calls = [];
  const workspace = {
    state: {
      panes: [harness.left.pane, harness.right.pane],
      activePaneId: harness.left.pane.id
    },
    activatePane(paneId) {
      this.state.activePaneId = paneId;
      harness.setActiveWorkspacePane(paneId);
      return harness.panes.get(paneId);
    }
  };
  const setActiveWorkspacePane = compileSource(
    app,
    'function setActiveWorkspacePane',
    'function resetWorkspacePanes',
    {
      initializeWorkspacePaneModel: () => harness.left.pane,
      getWorkspacePane: (paneId) => harness.panes.get(paneId) || null,
      getActivePane: () => harness.panes.get(workspace.state.activePaneId) || null,
      runtimeForPane: (pane) => pane?.viewContext || null,
      globalThis: {},
      commitFocusedMarkdownEditor: () => calls.push(['commit-focused']),
      prepareInfoPanelsForRuntimeContextChange: (runtime) => calls.push(['prepare-info', runtime]),
      cancelBlockEdits: (runtime) => calls.push(['cancel-block', runtime]),
      cancelPageEdits: (runtime) => calls.push(['cancel-page', runtime]),
      cancelHighlightEdits: (runtime) => calls.push(['cancel-highlight', runtime]),
      closeAddLinkPopover: (runtime) => calls.push(['close-add-link', runtime]),
      closeSidebarExternalLinkEditor: (runtime) => calls.push(['close-sidebar-link', runtime]),
      closeBlockLinkChoicePopover: () => calls.push(['close-link-choice']),
      saveActiveTabViewState: (runtime) => calls.push(['save-view', runtime]),
      workspace,
      renderTabStrip: (...args) => calls.push(['render-tabs', ...args]),
      refreshActivePaneWindowChrome: (runtime) => calls.push(['refresh-chrome', runtime])
    },
    'setActiveWorkspacePane'
  );

  harness.left.runtime.addLinkTarget = { blockId: 'left-block' };
  harness.left.runtime.externalLinkEditorContext = { pageId: 'page-left' };
  assert.equal(setActiveWorkspacePane(harness.right.pane.id), true);
  assert.equal(workspace.state.activePaneId, harness.right.pane.id);
  assert.equal(harness.activePaneRuntime(), harness.right.runtime);
  assert.equal(
    calls.filter(([kind]) => kind === 'close-add-link').length,
    1
  );
  assert.strictEqual(calls.find(([kind]) => kind === 'close-add-link')[1], harness.left.runtime);
  assert.equal(
    calls.filter(([kind]) => kind === 'close-sidebar-link').length,
    1
  );
  assert.strictEqual(
    calls.find(([kind]) => kind === 'close-sidebar-link')[1],
    harness.left.runtime
  );
  assert.strictEqual(calls.find(([kind]) => kind === 'refresh-chrome')[1], harness.right.runtime);
});

test('a Pane title blur saves its stable owner without reactivating it', async () => {
  const bootstrap = await read('public/js/appBootstrap.js');
  const harness = await createPaneRuntimeHarness();
  const saves = [];
  const runtimeForPane = (paneOrId) => {
    const pane = typeof paneOrId === 'string' ? harness.panes.get(paneOrId) : paneOrId;
    return pane?.viewContext || null;
  };
  const installToolbar = (runtime) => {
    const region = harness.document.createElement('div');
    region.dataset.workspacePaneId = runtime.paneId;
    const pageTitle = harness.document.createElement('input');
    runtime.dom = { toolbarRegion: region, pageTitle };
    return { region, pageTitle };
  };
  const toolbarA = installToolbar(harness.left.runtime);
  const toolbarB = installToolbar(harness.right.runtime);
  const bindPaneToolbarInteractions = compileSource(
    bootstrap,
    'function bindPaneToolbarInteractions',
    'function bindWorkspacePaneInteractions',
    {
      runtimeForPane,
      runtimeIsLive: harness.runtimeIsLive,
      activePaneRuntime: harness.activePaneRuntime,
      setActiveWorkspacePane: harness.setActiveWorkspacePane,
      saveTitle: (runtime) => saves.push(runtime)
    },
    'bindPaneToolbarInteractions'
  );
  bindPaneToolbarInteractions(harness.left.pane);
  bindPaneToolbarInteractions(harness.right.pane);

  toolbarA.pageTitle.focus();
  await toolbarB.region.dispatch('pointerdown');
  assert.strictEqual(harness.activePaneRuntime(), harness.right.runtime);
  await toolbarA.pageTitle.dispatch('blur');
  assert.deepEqual(saves, [harness.left.runtime]);
  assert.strictEqual(harness.activePaneRuntime(), harness.right.runtime,
    'the old title blur must not steal activation back from Pane B');

  harness.setActiveWorkspacePane(harness.left.runtime.paneId);
  toolbarA.pageTitle.blur = () => toolbarA.pageTitle.dispatch('blur');
  await toolbarA.pageTitle.dispatch('keydown', { key: 'Enter', isComposing: false, keyCode: 13 });
  await Promise.resolve();
  assert.deepEqual(saves, [harness.left.runtime, harness.left.runtime]);
  assert.strictEqual(harness.activePaneRuntime(), harness.left.runtime);

  const titleBlur = sourceBetween(
    bootstrap,
    "dom.pageTitle?.addEventListener('blur'",
    "dom.pageTitle?.addEventListener('input'"
  );
  assert.match(titleBlur, /const runtime = resolveRuntime\(\)/);
  assert.doesNotMatch(titleBlur, /activatePane\(\)/);
});

test('a stale Sidebar External Link save commits Page A without disturbing Page B editor intent', async () => {
  const externalLinks = await read('public/js/externalLinks.js');
  const pageA = canvasPage('external-link-save-a');
  const pageB = canvasPage('external-link-save-b');
  const savedA = {
    ...pageA,
    externalLinks: [{ id: 'saved-link', displayName: 'Saved', url: 'https://example.test' }]
  };
  const response = deferred();
  const calls = [];
  const commits = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  const contextA = {
    kind: 'sidebar',
    pageId: pageA.id,
    externalLinkId: null,
    sourceBlockId: null
  };
  const controllerA = {
    getValidation: () => ({
      valid: true,
      value: { displayName: 'Saved', url: 'https://example.test' }
    })
  };
  const confirmButton = { disabled: false };
  runtime.externalLinkEditorContext = contextA;
  runtime.externalLinkEditorController = controllerA;
  const saveSidebarExternalLink = compileSource(
    externalLinks,
    'async function saveSidebarExternalLink',
    'async function deleteExternalLink',
    {
      activePaneRuntime: harness.activePaneRuntime,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      externalLinkSidebarConfirm: confirmButton,
      request: () => response.promise,
      pageApiUrl: (pageId, suffix = '') => `/api/pages/${pageId}${suffix}`,
      commitCanonicalPage(page, options = {}) {
        commits.push({ page, options });
        harness.context.canonicalPages.set(page.id, page);
        return page;
      },
      closeSidebarExternalLinkEditor: (owner) => calls.push(['close', owner]),
      renderExternalLinks: (...args) => calls.push(['render-links', ...args]),
      renderBlockOverlays: (...args) => calls.push(['render-blocks', ...args])
    },
    'saveSidebarExternalLink'
  );

  const saving = saveSidebarExternalLink(runtime);
  assert.equal(confirmButton.disabled, true);
  await Promise.resolve();

  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  const contextB = {
    kind: 'sidebar',
    pageId: pageB.id,
    externalLinkId: 'new-editor-link',
    sourceBlockId: null
  };
  const controllerB = {
    getValidation: () => ({ valid: false }),
    setError: (message) => calls.push(['b-error', message])
  };
  runtime.externalLinkEditorContext = contextB;
  runtime.externalLinkEditorController = controllerB;
  confirmButton.disabled = false;
  response.resolve({ page: savedA });
  await saving;

  assert.strictEqual(harness.context.canonicalPages.get(pageA.id), savedA,
    'the persisted Page remains a canonical global result');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.originRuntime, null,
    'the stale A editor cannot be used as the presentation origin');
  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.strictEqual(runtime.externalLinkEditorContext, contextB);
  assert.strictEqual(runtime.externalLinkEditorController, controllerB);
  assert.equal(confirmButton.disabled, false);
  assert.deepEqual(calls, [], 'the stale response cannot close, render, or error the B editor');
});

test('an External Link file drop applies only to its exact editor intent', async () => {
  const externalLinks = await read('public/js/externalLinks.js');
  const page = canvasPage('external-link-drop-page');
  const targetResponse = deferred();
  const calls = [];
  const listeners = {};
  const element = {
    classList: { add() {}, remove() {} },
    addEventListener(type, listener) { listeners[type] = listener; },
    contains: () => false
  };
  const harness = await createPaneRuntimeHarness({ leftPage: page });
  const runtime = harness.left.runtime;
  const contextA = { kind: 'sidebar', pageId: page.id };
  const controllerA = { applyDroppedTarget: (target) => calls.push(['apply-a', target]) };
  const contextB = { kind: 'sidebar', pageId: page.id };
  const controllerB = { applyDroppedTarget: (target) => calls.push(['apply-b', target]) };
  runtime.externalLinkEditorContext = contextA;
  runtime.externalLinkEditorController = controllerA;
  const bindExternalLinkDropTarget = compileSource(
    externalLinks,
    'function bindExternalLinkDropTarget',
    'function activateBlockExternalLinkEditor',
    {
      externalLinkDropCandidate: () => ({
        targetKind: 'file', files: [{ name: 'reference.pdf' }]
      }),
      externalLinkDragMayContainTarget: () => true,
      activePaneRuntime: harness.activePaneRuntime,
      externalLinkSidebarPopover: element,
      addLinkPopover: { hidden: false },
      clearExternalLinkDropFeedback: () => calls.push(['clear-feedback']),
      captureRuntimeOperation: harness.captureRuntimeOperation,
      resolveExternalLinkDrop: () => targetResponse.promise,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      activateBlockExternalLinkEditor: () => calls.push(['activate-block']),
      openSidebarExternalLinkEditor: () => calls.push(['open-sidebar'])
    },
    'bindExternalLinkDropTarget'
  );
  bindExternalLinkDropTarget(element, 'sidebar');
  const event = {
    dataTransfer: {},
    preventDefault: () => calls.push(['prevent-default']),
    stopPropagation: () => calls.push(['stop-propagation'])
  };

  const dropping = listeners.drop(event);
  await Promise.resolve();
  runtime.externalLinkEditorContext = contextB;
  runtime.externalLinkEditorController = controllerB;
  targetResponse.resolve({ targetKind: 'file', displayName: 'Reference', fileName: 'reference.pdf' });
  await dropping;

  assert.strictEqual(runtime.externalLinkEditorContext, contextB);
  assert.strictEqual(runtime.externalLinkEditorController, controllerB);
  assert.equal(calls.some(([kind]) => kind === 'apply-a' || kind === 'apply-b'), false);
  assert.equal(calls.some(([kind]) => kind === 'open-sidebar'), false);
  assert.deepEqual(calls.slice(0, 3).map(([kind]) => kind), [
    'prevent-default', 'stop-propagation', 'clear-feedback'
  ]);
  assert.match(
    sourceBetween(externalLinks, 'function bindExternalLinkDropTarget', 'function activateBlockExternalLinkEditor'),
    /runtime\.externalLinkEditorContext !== editorContext[\s\S]*?runtime\.externalLinkEditorController !== editorController/
  );
});

test('External Link chooser and description completions reject replaced editor controllers', async () => {
  const externalLinks = await read('public/js/externalLinks.js');
  const externalLinksModel = require('../public/externalLinks');
  const page = canvasPage('external-link-editor-async');
  const harness = await createPaneRuntimeHarness({ leftPage: page });
  const runtime = harness.left.runtime;

  function compileEditor(bridge) {
    return compileSource(
      externalLinks,
      'function createExternalLinkEditor',
      'function externalLinksForPage',
      {
        externalLinkEditorId: 0,
        externalLinkTargetMode: 'url',
        externalLinksModel,
        document: harness.document,
        runtimeIsLive: harness.runtimeIsLive,
        captureRuntimeOperation: harness.captureRuntimeOperation,
        runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
        desktopExternalLinksAvailable: () => true,
        window: { cneDesktop: bridge, innerWidth: 1280, innerHeight: 800 },
        requestAnimationFrame: (callback) => callback(),
        scheduleWorkspaceStateSave: () => {}
      },
      'createExternalLinkEditor'
    );
  }

  const chooserResponse = deferred();
  const chooserContainer = harness.document.createElement('div');
  const chooserContext = { kind: 'sidebar', pageId: page.id };
  runtime.externalLinkEditorContext = chooserContext;
  const chooserEditor = compileEditor({
    selectExternalLinkFile: () => chooserResponse.promise,
    openExternalLinkTarget() {}
  });
  const chooserController = chooserEditor(runtime, chooserContainer, { initialMode: 'file' });
  runtime.externalLinkEditorController = chooserController;
  const chooseButton = chooserContainer.querySelector('.external-link-file-path');
  const choosing = chooseButton.dispatch('click');
  await Promise.resolve();
  const replacementContext = { kind: 'sidebar', pageId: page.id };
  const replacementController = { marker: 'replacement-controller' };
  runtime.externalLinkEditorContext = replacementContext;
  runtime.externalLinkEditorController = replacementController;
  chooserResponse.resolve({
    ok: true,
    fileRef: { locationId: 'resources', relativePath: 'new.pdf' },
    displayPath: 'Resources/new.pdf',
    fileName: 'new.pdf'
  });
  await choosing;
  assert.deepEqual(chooserController.getDraft(), {
    displayName: '', targetKind: 'file', url: null, fileRef: null
  });
  assert.strictEqual(runtime.externalLinkEditorContext, replacementContext);
  assert.strictEqual(runtime.externalLinkEditorController, replacementController);

  const descriptionResponse = deferred();
  const descriptionContainer = harness.document.createElement('div');
  const fileRef = { locationId: 'resources', relativePath: 'existing.pdf' };
  const descriptionContext = { kind: 'sidebar', pageId: page.id };
  runtime.externalLinkEditorContext = descriptionContext;
  const descriptionEditor = compileEditor({
    selectExternalLinkFile: async () => ({ cancelled: true }),
    openExternalLinkTarget() {},
    describeExternalLinkFile: () => descriptionResponse.promise
  });
  const descriptionController = descriptionEditor(runtime, descriptionContainer, {
    initial: {
      displayName: 'Existing',
      targetKind: 'file',
      fileRef,
      displayPath: 'Old path',
      fileName: 'existing.pdf'
    }
  });
  runtime.externalLinkEditorController = descriptionController;
  const descriptionButton = descriptionContainer.querySelector('.external-link-file-path');
  assert.equal(descriptionButton.textContent, 'Old path');
  const laterContext = { kind: 'sidebar', pageId: page.id };
  const laterController = { marker: 'later-controller' };
  runtime.externalLinkEditorContext = laterContext;
  runtime.externalLinkEditorController = laterController;
  descriptionResponse.resolve({
    ok: true,
    displayPath: 'New asynchronous path',
    fileName: 'renamed.pdf'
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(descriptionButton.textContent, 'Old path');
  assert.strictEqual(runtime.externalLinkEditorContext, laterContext);
  assert.strictEqual(runtime.externalLinkEditorController, laterController);

  const editorSource = sourceBetween(
    externalLinks, 'function createExternalLinkEditor', 'function externalLinksForPage'
  );
  assert.match(editorSource, /let destroyed = false;[\s\S]*?const editorIsCurrent = \(\) => !destroyed/);
  assert.match(editorSource, /runtime\.externalLinkEditorContext === editorContext[\s\S]*?runtime\.externalLinkEditorController === controller/);
  assert.match(editorSource, /runtimeOperationIsCurrent\(operation\) \|\| !editorIsCurrent\(\)/);
});

test('a Descriptor save cannot close a newer modal opened by the same runtime and Page', async () => {
  const descriptorModal = await read('public/js/descriptorModal.js');
  const page = canvasPage('descriptor-modal-owner');
  const savedPage = { ...page, descriptors: { group: ['saved'] } };
  const response = deferred();
  const closes = [];
  const commits = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: page });
  const runtime = harness.left.runtime;
  const modalA = { type: 'descriptor', runtime };
  const owner = compileSource(
    descriptorModal,
    'async function savePageMetaModal',
    'function openPageMetaModal',
    {
      pageMetaModal: modalA,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      transactionalValuesEqual: () => true,
      originalDescriptorGroupsConfig: {},
      descriptorGroupsConfig: {},
      descriptorDraft: { group: ['draft'] },
      ignoredDescriptorDraft: {},
      ignoredManualEntryIdsDraft: [],
      emptyDescriptorDraft: () => ({}),
      emptyDescriptorIdDraft: () => [],
      request: () => response.promise,
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      commitCanonicalPage(canonical, options = {}) {
        commits.push({ canonical, options });
        return canonical;
      },
      closePageMetaModal: (...args) => closes.push(args),
      showRuntimeStatus: (_owner, message) => statuses.push(message),
      categoryBatch: { instructionPayload: () => ({}) },
      adoptCategoryCommandPages: () => {},
      navigation: {},
      renderPageList: () => {},
      selectedCategoryIdsFromModal: () => []
    },
    `({
      savePageMetaModal,
      replaceModal(value) { pageMetaModal = value; },
      currentModal() { return pageMetaModal; }
    })`
  );

  const saving = owner.savePageMetaModal();
  assert.deepEqual(statuses, ['Saving…']);
  await Promise.resolve();
  const modalB = { type: 'descriptor', runtime };
  owner.replaceModal(modalB);
  response.resolve(savedPage);
  await saving;

  assert.strictEqual(owner.currentModal(), modalB);
  assert.deepEqual(closes, [], 'the completed A request cannot close modal B');
  assert.deepEqual(commits, [{ canonical: savedPage, options: { originRuntime: runtime } }]);
  assert.deepEqual(statuses, ['Saving…']);
  assert.match(
    sourceBetween(descriptorModal, 'async function savePageMetaModal', 'function openPageMetaModal'),
    /const modalOwner = pageMetaModal;[\s\S]*?pageMetaModal === modalOwner/
  );
});

test('ignored Descriptor restore cannot mutate a replacement modal after its refresh awaits', async () => {
  const descriptorModal = await read('public/js/descriptorModal.js');
  const page = canvasPage('descriptor-restore-owner');
  const refresh = deferred();
  const calls = [];
  const harness = await createPaneRuntimeHarness({ leftPage: page });
  const runtime = harness.left.runtime;
  const modalA = { type: 'descriptor', runtime };
  const owner = compileSource(
    descriptorModal,
    'async function restoreIgnoredDescriptor',
    'function moveDescriptorDraftChip',
    {
      pageMetaModal: modalA,
      cloneDescriptorUndoSnapshot: () => ({ before: true }),
      ignoredDescriptorHadManualState: () => false,
      staleIgnoredDescriptorKeys: null,
      refreshStaleIgnoredDescriptors: () => refresh.promise,
      ignoredDescriptorIsInactive: () => false,
      descriptorMutation: { restoreSource: () => 'manual' },
      removeIgnoredDescriptor: (...args) => calls.push(['remove', ...args]),
      descriptorDraft: { group: [] },
      descriptorChipKey: () => '',
      descriptorDraftDirty: false,
      rerenderDescriptorEditor: (...args) => calls.push(['render', ...args]),
      recordDescriptorChange: (...args) => calls.push(['record', ...args]),
      Date
    },
    `({
      restoreIgnoredDescriptor,
      replaceModal(value) { pageMetaModal = value; },
      currentModal() { return pageMetaModal; }
    })`
  );

  const restoring = owner.restoreIgnoredDescriptor('group', {
    entryId: 'ignored-entry',
    display: 'Ignored',
    vocabularyEntryId: 'vocabulary-entry'
  });
  await Promise.resolve();
  const modalB = { type: 'descriptor', runtime };
  owner.replaceModal(modalB);
  refresh.resolve(true);
  await restoring;

  assert.strictEqual(owner.currentModal(), modalB);
  assert.deepEqual(calls, [], 'the old refresh completion cannot mutate modal B drafts or DOM');
  assert.match(
    sourceBetween(descriptorModal, 'async function restoreIgnoredDescriptor', 'function moveDescriptorDraftChip'),
    /const modalOwner = pageMetaModal;[\s\S]*?await refreshStaleIgnoredDescriptors\(\);\s*if \(pageMetaModal !== modalOwner\) return;/
  );
});

test('Add Link Page actions preserve the shared B popover while inactive A settles', async () => {
  const app = await read('public/app.js');

  async function runNewPage({ activeOwner = false, navigationResult = true } = {}) {
    const pageA = canvasPage('add-link-new-a');
    const pageB = canvasPage('add-link-new-b');
    const createdPage = canvasPage('add-link-created');
    const response = deferred();
    const calls = [];
    const statuses = [];
    const harness = await createPaneRuntimeHarness({ leftPage: pageA, rightPage: pageB });
    const runtime = harness.left.runtime;
    const other = harness.right.runtime;
    const targetA = { blockId: 'block-a' };
    const targetB = { blockId: 'block-b' };
    runtime.addLinkTarget = targetA;
    runtime.addLinkSelection = 'new-page';
    other.addLinkTarget = targetB;
    other.addLinkSelection = 'existing-page';
    const addLinkPopover = { hidden: false };
    const confirmAddLinkNewPage = compileSource(
      app,
      'async function confirmAddLinkNewPage',
      'async function confirmAddLinkExistingPage',
      {
        runtimeIsLive: harness.runtimeIsLive,
        pageMetaModal: null,
        closePageMetaModal: () => calls.push(['close-meta']),
        addLinkConfirmButton: { disabled: false },
        addLinkNewPageButton: { disabled: false },
        showRuntimeStatus(owner, message) {
          statuses.push({ owner, message });
        },
        captureRuntimeOperation: harness.captureRuntimeOperation,
        pageApiUrl: (pageId, suffix = '') => `/api/pages/${pageId}${suffix}`,
        addLinkTypeSelect: { value: '' },
        defaultLinkTypeId: () => 'default-link',
        request: () => response.promise,
        project: {},
        pageIndex: { pages: [] },
        navigation: {},
        renderPageList: () => calls.push(['render-list']),
        runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
        activePaneRuntime: harness.activePaneRuntime,
        closeAddLinkPopover(owner, options = {}) {
          calls.push(['close-popover', owner, options]);
          owner.addLinkTarget = null;
          if (options.sharedPresentation !== false) addLinkPopover.hidden = true;
        },
        async navigateCurrentTabToPage(owner, pageId, options) {
          calls.push(['navigate', owner, pageId, options]);
          if (!navigationResult) return false;
          owner.session.navigateActive(pageId, { mode: 'preserve' });
          owner.currentPage = createdPage;
          owner.currentPageEntry = options.resolvedPageEntry;
          owner.pageLoadSequence += 1;
          owner.mounted = {
            tabId: owner.session.activeTab().id,
            pageId,
            kind: createdPage.type,
            generation: owner.mounted.generation + 1
          };
          return true;
        },
        beginNewPageTitleEditor: (...args) => calls.push(['title', ...args]),
        runtimeOperationOwnerIsCurrent: harness.runtimeOperationOwnerIsCurrent,
        addLinkPopover,
        setAddLinkSelection: (...args) => calls.push(['selection', ...args])
      },
      'confirmAddLinkNewPage'
    );

    const saving = confirmAddLinkNewPage(runtime);
    await Promise.resolve();
    if (!activeOwner) harness.setActiveWorkspacePane(other.paneId);
    response.resolve({
      project: { id: 'project-after' },
      pageIndex: { pages: [{ id: createdPage.id, title: createdPage.title }] },
      navigation: { root: [] },
      page: createdPage,
      pageEntry: { id: createdPage.id, title: createdPage.title }
    });
    await saving;
    return { runtime, other, targetB, calls, statuses, addLinkPopover };
  }

  const inactive = await runNewPage();
  assert.equal(inactive.calls.filter(([kind]) => kind === 'navigate').length, 1,
    'an unchanged inactive A owner may still navigate its own Tab');
  assert.deepEqual(
    inactive.calls.find(([kind]) => kind === 'close-popover')[2],
    { sharedPresentation: false },
    'inactive A clears only its local intent, not the shared B presentation'
  );
  assert.strictEqual(inactive.other.addLinkTarget, inactive.targetB);
  assert.equal(inactive.other.addLinkSelection, 'existing-page');
  assert.equal(inactive.addLinkPopover.hidden, false);
  assert.equal(inactive.calls.some(([kind]) => kind === 'title'), false);
  assert.equal(inactive.statuses.some(({ message }) => message === 'Linked page created'), false);

  const active = await runNewPage({ activeOwner: true });
  assert.deepEqual(
    active.calls.find(([kind]) => kind === 'close-popover')[2],
    { sharedPresentation: true }
  );
  assert.equal(active.addLinkPopover.hidden, true);
  assert.equal(active.calls.filter(([kind]) => kind === 'title').length, 1);
  assert.equal(active.statuses.some(({ message }) => message === 'Linked page created'), true);

  const failedNavigation = await runNewPage({ activeOwner: true, navigationResult: false });
  assert.equal(failedNavigation.calls.some(([kind]) => kind === 'title'), false,
    'a failed navigation cannot focus the title editor');
  assert.equal(
    failedNavigation.statuses.some(({ message }) => message === 'Linked page created'),
    false
  );
});

test('Add Link existing-Page save commits A without closing the active B popover', async () => {
  const app = await read('public/app.js');
  const pageA = canvasPage('add-link-existing-a');
  const pageB = canvasPage('add-link-existing-b');
  const savedA = { ...pageA, blocks: [{ id: 'block-a', links: [] }] };
  const response = deferred();
  const calls = [];
  const commits = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA, rightPage: pageB });
  const runtime = harness.left.runtime;
  const other = harness.right.runtime;
  const targetA = { blockId: 'block-a' };
  const targetB = { blockId: 'block-b' };
  const pickA = { selectedTargetPageId: 'target-page' };
  const pickB = { selectedTargetPageId: 'other-target-page' };
  runtime.addLinkTarget = targetA;
  runtime.addLinkSelection = 'existing-page';
  runtime.linkPickMode = pickA;
  other.addLinkTarget = targetB;
  other.addLinkSelection = 'new-page';
  other.linkPickMode = pickB;
  const addLinkPopover = { hidden: false };
  const confirmAddLinkExistingPage = compileSource(
    app,
    'async function confirmAddLinkExistingPage',
    'function confirmAddLink(runtime)',
    {
      runtimeIsLive: harness.runtimeIsLive,
      showRuntimeStatus: (...args) => calls.push(['status', ...args]),
      pageMetaModal: null,
      closePageMetaModal: () => calls.push(['close-meta']),
      addLinkConfirmButton: { disabled: false },
      addLinkExistingPageButton: { disabled: false },
      addLinkNewPageButton: { disabled: false },
      captureRuntimeOperation: harness.captureRuntimeOperation,
      pageApiUrl: (pageId, suffix = '') => `/api/pages/${pageId}${suffix}`,
      addLinkTypeSelect: { value: '' },
      defaultLinkTypeId: () => 'default-link',
      request: () => response.promise,
      pageIndex: { pages: [] },
      commitCanonicalPage(page, options = {}) {
        commits.push({ page, options });
        harness.context.canonicalPages.set(page.id, page);
        return page;
      },
      navigation: {},
      renderPageList: () => calls.push(['render-list']),
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      activePaneRuntime: harness.activePaneRuntime,
      closeAddLinkPopover(owner, options = {}) {
        calls.push(['close-popover', owner, options]);
        owner.addLinkTarget = null;
        if (options.sharedPresentation !== false) addLinkPopover.hidden = true;
      },
      renderBlockOverlays: (...args) => calls.push(['blocks', ...args]),
      renderRelations: (...args) => calls.push(['relations', ...args]),
      runtimeOperationOwnerIsCurrent: harness.runtimeOperationOwnerIsCurrent,
      addLinkPopover,
      setAddLinkSelection: (...args) => calls.push(['selection', ...args]),
      renderAddLinkExistingTarget: (...args) => calls.push(['target', ...args])
    },
    'confirmAddLinkExistingPage'
  );

  const saving = confirmAddLinkExistingPage(runtime);
  await Promise.resolve();
  harness.setActiveWorkspacePane(other.paneId);
  response.resolve({
    page: savedA,
    pageIndex: { pages: [{ id: pageA.id, title: pageA.title }] },
    navigation: { root: [] }
  });
  await saving;

  assert.deepEqual(commits, [{ page: savedA, options: { originRuntime: runtime } }]);
  assert.deepEqual(
    calls.find(([kind]) => kind === 'close-popover')[2],
    { sharedPresentation: false }
  );
  assert.strictEqual(other.addLinkTarget, targetB);
  assert.strictEqual(other.linkPickMode, pickB);
  assert.equal(other.addLinkSelection, 'new-page');
  assert.equal(addLinkPopover.hidden, false);
  assert.equal(calls.some(([kind, owner]) => kind === 'status' && owner === other), false);
});

test('Create Page installs global results but fences Tab, load, title, and stale-error work', async () => {
  const app = await read('public/app.js');

  async function runCreate({ switchDuringMotion = false, completeResult = true } = {}) {
    const pageA = canvasPage('create-owner-a');
    const pageB = canvasPage('create-owner-b');
    const createdPage = { ...canvasPage('created-page'), type: 'markdown' };
    const motion = deferred();
    const calls = [];
    const statuses = [];
    const harness = await createPaneRuntimeHarness({ leftPage: pageA });
    const runtime = harness.left.runtime;
    const newPageButton = { disabled: false };
    const owner = compileSource(
      app,
      'async function createNewPage',
      'async function createNewFolder',
      {
        runtimeIsLive: harness.runtimeIsLive,
        newPageButton,
        activeTab: (candidate) => candidate.session.activeTab(),
        closePageMetaModal: () => calls.push(['close-meta']),
        closeAddLinkPopover: (...args) => calls.push(['close-link', ...args]),
        closePageContextMenu: () => calls.push(['close-page-menu']),
        setEditMenuOpen: (...args) => calls.push(['edit-menu', ...args]),
        cancelBlockEdits: (...args) => calls.push(['cancel-block', ...args]),
        cancelPageEdits: (...args) => calls.push(['cancel-page', ...args]),
        cancelHighlightEdits: (...args) => calls.push(['cancel-highlight', ...args]),
        showRuntimeStatus(candidate, message) {
          statuses.push({ candidate, pageId: candidate.currentPage?.id || null, message });
        },
        request: async () => ({
          project: { id: 'created-project-state' },
          pageIndex: { pages: [{ id: createdPage.id, title: createdPage.title }] },
          navigation: { root: [{ type: 'page', id: createdPage.id }] },
          page: createdPage,
          pageEntry: { id: createdPage.id, title: createdPage.title }
        }),
        project: { id: 'before-project' },
        pageIndex: { pages: [] },
        navigation: { root: [] },
        captureSidebarNavigationMutation: (detail) => {
          calls.push(['capture-motion', detail]);
          return detail;
        },
        playSidebarNavigationMutation: (detail) => {
          calls.push(['play-motion', detail]);
          return switchDuringMotion ? motion.promise : Promise.resolve();
        },
        saveActiveTabViewState: (...args) => calls.push(['save-view', ...args]),
        animateTabStripLayoutChange: (callback) => {
          calls.push(['create-tab']);
          return callback();
        },
        renderTabStrip: (...args) => calls.push(['render-tabs', ...args]),
        async completePageOpen(candidate, entry, page, options) {
          calls.push(['complete-open', candidate, entry, page, options]);
          if (!completeResult) return false;
          candidate.currentPage = page;
          candidate.currentPageEntry = entry;
          candidate.mounted = {
            tabId: candidate.session.activeTab().id,
            pageId: page.id,
            kind: page.type,
            generation: candidate.mounted.generation + 1
          };
          return true;
        },
        activePaneRuntime: harness.activePaneRuntime,
        beginNewPageTitleEditor: (...args) => calls.push(['title', ...args])
      },
      `({
        createNewPage,
        projectValue() { return project; },
        pageIndexValue() { return pageIndex; },
        navigationValue() { return navigation; }
      })`
    );

    const creating = owner.createNewPage({ runtime, parentFolderId: 'folder-a' });
    if (switchDuringMotion) {
      for (let pass = 0; pass < 4 && !calls.some(([kind]) => kind === 'play-motion'); pass += 1) {
        await Promise.resolve();
      }
      switchRuntimeToPage(runtime, pageB);
      motion.resolve();
    }
    await creating;
    return { owner, harness, runtime, pageA, pageB, createdPage, calls, statuses, newPageButton };
  }

  const switched = await runCreate({ switchDuringMotion: true });
  assert.equal(switched.owner.projectValue().id, 'created-project-state');
  assert.equal(switched.owner.pageIndexValue().pages[0].id, switched.createdPage.id);
  assert.equal(switched.owner.navigationValue().root[0].id, switched.createdPage.id);
  assert.equal(switched.calls.filter(([kind]) => kind === 'capture-motion').length, 1);
  assert.equal(switched.calls.filter(([kind]) => kind === 'play-motion').length, 1);
  assert.equal(switched.calls.some(([kind]) => kind === 'save-view'), false);
  assert.equal(switched.calls.some(([kind]) => kind === 'create-tab'), false);
  assert.equal(switched.calls.some(([kind]) => kind === 'complete-open'), false);
  assert.equal(switched.calls.some(([kind]) => kind === 'title'), false);
  assert.strictEqual(switched.runtime.currentPage, switched.pageB);
  assert.equal(switched.statuses.some(({ pageId, message }) => (
    pageId === switched.pageB.id && message
  )), false);
  assert.equal(switched.newPageButton.disabled, false);

  const failedOpen = await runCreate({ completeResult: false });
  assert.equal(failedOpen.calls.filter(([kind]) => kind === 'complete-open').length, 1);
  assert.equal(failedOpen.calls.some(([kind]) => kind === 'title'), false,
    'a failed Page open cannot focus the title editor');

  const exactOwner = await runCreate();
  assert.equal(exactOwner.calls.filter(([kind]) => kind === 'complete-open').length, 1);
  assert.equal(exactOwner.calls.filter(([kind]) => kind === 'title').length, 1,
    'only the exact active owner focuses the new title');

  const errorPageA = canvasPage('create-error-a');
  const errorPageB = canvasPage('create-error-b');
  const errorResponse = deferred();
  const errorStatuses = [];
  const errorHarness = await createPaneRuntimeHarness({ leftPage: errorPageA });
  const errorRuntime = errorHarness.left.runtime;
  const createWithError = compileSource(
    app,
    'async function createNewPage',
    'async function createNewFolder',
    {
      runtimeIsLive: errorHarness.runtimeIsLive,
      newPageButton: { disabled: false },
      activeTab: (candidate) => candidate.session.activeTab(),
      closePageMetaModal: () => {},
      closeAddLinkPopover: () => {},
      closePageContextMenu: () => {},
      setEditMenuOpen: () => {},
      cancelBlockEdits: () => {},
      cancelPageEdits: () => {},
      cancelHighlightEdits: () => {},
      showRuntimeStatus: (candidate, message) => errorStatuses.push({
        pageId: candidate.currentPage?.id || null,
        message
      }),
      request: () => errorResponse.promise,
      project: {},
      pageIndex: {},
      navigation: {},
      captureSidebarNavigationMutation: () => null,
      playSidebarNavigationMutation: async () => {},
      saveActiveTabViewState: () => {},
      animateTabStripLayoutChange: (callback) => callback(),
      renderTabStrip: () => {},
      completePageOpen: async () => true,
      activePaneRuntime: errorHarness.activePaneRuntime,
      beginNewPageTitleEditor: () => {}
    },
    'createNewPage'
  );
  const failing = createWithError({ runtime: errorRuntime });
  switchRuntimeToPage(errorRuntime, errorPageB);
  errorResponse.reject(new Error('stale create failed'));
  await failing;
  assert.equal(errorStatuses.some(({ message }) => message === 'stale create failed'), false,
    'a stale request failure cannot paint status into Page B');
});

test('race A: an inactive Page load completes only in its originating live runtime', async () => {
  const app = await read('public/app.js');
  const target = canvasPage('target-a');
  const response = deferred();
  const calls = [];
  const harness = await createPaneRuntimeHarness({
    leftPage: canvasPage('left-before'),
    rightPage: canvasPage('right-before')
  });
  const { loadPage } = loadPageOwner(app, harness, () => response.promise, calls);

  const pending = loadPage(harness.left.runtime, { id: target.id, title: target.title }, {
    historyMode: 'push'
  });
  await Promise.resolve();
  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  response.resolve(target);

  assert.equal(await pending, true);
  assert.equal(harness.left.runtime.currentPage.id, target.id);
  assert.equal(harness.left.runtime.session.activeTab().currentPageId, target.id);
  assert.equal(harness.right.runtime.currentPage.id, 'right-before');
  assert.equal(harness.right.runtime.session.activeTab().currentPageId, 'right-before');
  assert.equal(harness.activePaneRuntime(), harness.right.runtime);
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'render').map(([, runtime, page]) => [runtime, page.id]),
    [[harness.left.runtime, target.id]]
  );
  assert.deepEqual(calls.filter(([kind]) => kind === 'last-opened'), [],
    'an inactive completion does not steal the Vault last-opened owner');
});

test('two concurrent Page loads settle into their respective Pane runtimes', async () => {
  const app = await read('public/app.js');
  const targetA = canvasPage('concurrent-a');
  const targetB = canvasPage('concurrent-b');
  const pendingByUrl = new Map();
  const harness = await createPaneRuntimeHarness({
    leftPage: canvasPage('left-origin'),
    rightPage: canvasPage('right-origin')
  });
  const { loadPage } = loadPageOwner(app, harness, (url) => {
    const response = deferred();
    pendingByUrl.set(url, response);
    return response.promise;
  });

  const loadingA = loadPage(harness.left.runtime, { id: targetA.id }, { historyMode: 'push' });
  const loadingB = loadPage(harness.right.runtime, { id: targetB.id }, { historyMode: 'push' });
  await Promise.resolve();
  pendingByUrl.get(`/api/pages/${targetB.id}`).resolve(targetB);
  assert.equal(await loadingB, true);
  assert.equal(harness.right.runtime.currentPage.id, targetB.id);
  assert.equal(harness.left.runtime.currentPage.id, 'left-origin');

  pendingByUrl.get(`/api/pages/${targetA.id}`).resolve(targetA);
  assert.equal(await loadingA, true);
  assert.equal(harness.left.runtime.currentPage.id, targetA.id);
  assert.equal(harness.right.runtime.currentPage.id, targetB.id);
  assert.notEqual(harness.left.runtime.mounted, harness.right.runtime.mounted);
});

test('a failed deferred new-Tab load cannot close or reactivate after the user switches Tabs', async () => {
  const app = await read('public/app.js');
  const target = canvasPage('new-tab-y');
  const loadResult = deferred();
  const harness = await createPaneRuntimeHarness({ leftPage: canvasPage('tab-x') });
  const runtime = harness.left.runtime;
  const openPageInNewTab = compileSource(
    app,
    'async function openPageInNewTab',
    'function workspaceTabForPageInPane',
    {
      runtimeIsLive: harness.runtimeIsLive,
      pageIndex: { pages: [{ id: target.id, title: target.title }] },
      prepareInfoPanelsForRuntimeContextChange: () => {},
      saveActiveTabViewState: () => {},
      cancelBlockEdits: () => {},
      cancelPageEdits: () => {},
      cancelHighlightEdits: () => {},
      closePageMetaModal: () => {},
      globalThis: {},
      activeTab: (owner) => owner.session.activeTab(),
      animateTabStripLayoutChange: (callback) => callback(),
      renderTabStrip: () => {},
      activePaneTabStrip: () => null,
      CSS: { escape: String },
      applyTabTitlePresentation: () => {},
      loadPage: () => loadResult.promise
    },
    'openPageInNewTab'
  );

  const originalTab = runtime.session.activeTab();
  const opening = openPageInNewTab(runtime, target.id);
  const createdTab = runtime.session.activeTab();
  assert.notEqual(createdTab, originalTab);
  assert.equal(createdTab.currentPageId, target.id);
  const laterTab = runtime.session.createTab('tab-z');
  assert.equal(runtime.session.activeTab(), laterTab);

  loadResult.resolve(false);
  assert.equal(await opening, false);
  assert.equal(runtime.session.tabById(createdTab.id), createdTab,
    'a superseded failed load cannot delete its no-longer-active Tab');
  assert.equal(runtime.session.activeTab(), laterTab,
    'a superseded failure cannot reactivate the pre-load Tab');
  assert.equal(runtime.session.tabById(originalTab.id), originalTab);
});

test('Page conversion commits its response but cannot replace a newer Tab in the same Pane', async () => {
  const app = await read('public/app.js');
  const pageA = canvasPage('conversion-a');
  const pageB = canvasPage('conversion-b');
  const savedA = { ...pageA, type: 'markdown', markdownBody: '' };
  const response = deferred();
  const commits = [];
  const renders = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  const canonicalPages = harness.context.canonicalPages;
  canonicalPages.set(pageB.id, pageB);
  const convertCurrentPageType = compileSource(
    app,
    'async function convertCurrentPageType',
    'async function createNewPage',
    {
      runtimeIsLive: harness.runtimeIsLive,
      pageIsSupported: () => true,
      getWorkspacePane: (paneId) => harness.panes.get(paneId) || null,
      activeTab: (owner) => owner.session.activeTab(),
      markdownPageMutationLocks: new Set(),
      captureRuntimeOperation: harness.captureRuntimeOperation,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      livingPaneRuntimes: harness.livingPaneRuntimes,
      pageTypesModel: {
        PAGE_TYPES: { HN_TEXT: 'cne-text', MARKDOWN: 'markdown' },
        normalizePageType: (type) => type,
        conversionEligibility: () => ({ allowed: true, reasons: [] }),
        pageTypeLabel: (type) => type
      },
      markdownPageModel: { PAGE_TYPES: { MARKDOWN: 'markdown' } },
      setPageTypeSubmenuOpen: () => {},
      setEditMenuOpen: () => {},
      showRuntimeStatus: (owner, message, ...detail) => statuses.push({ owner, message, detail }),
      commitFocusedMarkdownEditor: () => {},
      prepareInfoPanelsForRuntimeContextChange: () => {},
      saveActiveTabViewState: () => {},
      refreshMarkdownPageViews: () => {},
      setMarkdownPageConversionReadOnly: () => {},
      pageTitleSaveQueues: new Map(),
      flushMarkdownBodyPageNow: async () => true,
      globalThis: {},
      lockAndFlushHnPageDocumentSessionForConversion: async () => ({ ok: true, session: null }),
      unlockHnPageDocumentSessionAfterFailedConversion: () => {},
      discardHnPageDocumentSessionAfterConversion: async () => {},
      handleHnSessionError: () => {},
      canonicalPages,
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      request: (url) => url === '/api/page-index'
        ? Promise.resolve({ pages: [{ id: pageA.id }, { id: pageB.id }] })
        : response.promise,
      markdownBodySaveStates: new Map(),
      window: { clearTimeout() {} },
      commitCanonicalPage(saved, options = {}) {
        commits.push({ saved, options });
        canonicalPages.set(saved.id, saved);
        for (const owner of harness.livingPaneRuntimes()) {
          if (owner.session.activeTab()?.currentPageId === saved.id) owner.currentPage = saved;
        }
        return saved;
      },
      pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
      renderPage: (...args) => renders.push(args),
      restoreActiveTabViewState: () => {},
      renderPageList: () => {},
      scheduleHnSessionReferenceReconcile: () => {},
      scheduleWorkspaceStateSave: () => {}
    },
    'convertCurrentPageType'
  );

  const converting = convertCurrentPageType(runtime, 'markdown');
  await Promise.resolve();
  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  response.resolve(savedA);

  assert.equal(await converting, true);
  assert.strictEqual(canonicalPages.get(pageA.id), savedA);
  assert.equal(commits.length, 1);
  assert.strictEqual(commits[0].options.originRuntime, null);
  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.deepEqual(renders, []);
  assert.equal(statuses.some(({ message }) => message === 'Page Type: markdown.'), false);
});

test('resource visibility response updates canonical A without rendering over same-Pane B', async () => {
  const app = await read('public/app.js');
  const object = { id: 'resource-a', type: 'image', visible: true };
  const pageA = { ...canvasPage('resource-page-a'), objects: [object] };
  const pageB = canvasPage('resource-page-b');
  const savedA = { ...pageA, objects: [{ ...object, visible: false }] };
  const response = deferred();
  const commits = [];
  const renders = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  harness.context.canonicalPages.set(pageB.id, pageB);
  const target = {
    runtime,
    resource: object,
    token: harness.captureRuntimeOperation(runtime, {
      scope: 'resource-context', pageId: pageA.id
    })
  };
  const toggleResourceVisibility = compileSource(
    app,
    'function resourceContextForRuntime',
    'function isDesktopResourceActionAvailable',
    {
      resourceContextTarget: target,
      runtimeIsLive: harness.runtimeIsLive,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      isDisplayableObject: () => true,
      isVisibleObject: (resource) => resource.visible !== false,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      closeResourceContextMenu: () => {},
      showRuntimeStatus: (owner, message, ...detail) => statuses.push({ owner, message, detail }),
      request: () => response.promise,
      pageApiUrl: (pageId, suffix = '') => `/api/pages/${pageId}${suffix}`,
      commitCanonicalPage(saved, options = {}) {
        commits.push({ saved, options });
        harness.context.canonicalPages.set(saved.id, saved);
        if (runtime.session.activeTab()?.currentPageId === saved.id) runtime.currentPage = saved;
        return saved;
      },
      pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
      renderPageList: () => {},
      renderPage: (...args) => renders.push(args)
    },
    'toggleResourceVisibility'
  );

  const toggling = toggleResourceVisibility(runtime);
  await Promise.resolve();
  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  response.resolve({
    page: savedA,
    pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] }
  });
  await toggling;

  assert.strictEqual(harness.context.canonicalPages.get(pageA.id), savedA);
  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.originRuntime, null);
  assert.deepEqual(renders, []);
  assert.equal(statuses.some(({ message }) => message === 'Saved'), false);
});

test('resource deletion response updates canonical A without rendering over same-Pane B', async () => {
  const app = await read('public/app.js');
  const object = { id: 'delete-resource-a', type: 'image', visible: true };
  const pageA = { ...canvasPage('delete-page-a'), objects: [object] };
  const pageB = canvasPage('delete-page-b');
  const savedA = { ...pageA, objects: [] };
  const response = deferred();
  const commits = [];
  const renders = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  harness.context.canonicalPages.set(pageB.id, pageB);
  const deleteContextResource = compileSource(
    app,
    'async function deleteContextResource',
    'async function deleteContextPage',
    {
      resourceContextForRuntime: (owner) => owner === runtime ? object : null,
      resourceDeleteInProgress: false,
      isDisplayableObject: () => true,
      getBlockLinks: () => [],
      window: { confirm: () => true },
      itemLabel: () => 'resource',
      plural: (count, label) => `${count} ${label}`,
      closeResourceContextMenu: () => {},
      captureRuntimeOperation: harness.captureRuntimeOperation,
      showRuntimeStatus: (owner, message, ...detail) => statuses.push({ owner, message, detail }),
      request: () => response.promise,
      pageApiUrl: (pageId, suffix = '') => `/api/pages/${pageId}${suffix}`,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      commitCanonicalPage(saved, options = {}) {
        commits.push({ saved, options });
        harness.context.canonicalPages.set(saved.id, saved);
        if (runtime.session.activeTab()?.currentPageId === saved.id) runtime.currentPage = saved;
        return saved;
      },
      pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
      navigation: {},
      renderPageList: () => {},
      renderPage: (...args) => renders.push(args),
      renderBlockOverlays: (...args) => renders.push(['blocks', ...args])
    },
    'deleteContextResource'
  );

  const deleting = deleteContextResource(runtime);
  await Promise.resolve();
  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  response.resolve({
    page: savedA,
    pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
    navigation: {},
    deletedKind: 'object',
    warnings: []
  });
  await deleting;

  assert.strictEqual(harness.context.canonicalPages.get(pageA.id), savedA);
  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.originRuntime, null);
  assert.deepEqual(renders, []);
  assert.equal(statuses.some(({ message }) => message === 'Deleted'), false);
});

test('desktop resource failure cannot paint status into a newer same-Pane Tab', async () => {
  const app = await read('public/app.js');
  const pageA = canvasPage('desktop-resource-a');
  const pageB = canvasPage('desktop-resource-b');
  const response = deferred();
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  const runDesktopResourceAction = compileSource(
    app,
    'async function runDesktopResourceAction',
    'function openContextResourceInDesktop',
    {
      runtimeIsLive: harness.runtimeIsLive,
      isDesktopResourceActionAvailable: () => true,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      closeResourceContextMenu: () => {},
      desktopResourceClient: {
        open: () => response.promise,
        reveal: () => response.promise
      },
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      applyManagedResourceRelocationToCurrentPage: () => {
        throw new Error('stale action must not relocate Page B');
      },
      showRuntimeStatus: (owner, message, ...detail) => statuses.push({ owner, message, detail })
    },
    'runDesktopResourceAction'
  );

  const opening = runDesktopResourceAction(runtime, 'open', { id: 'resource-a' });
  await Promise.resolve();
  switchRuntimeToPage(runtime, pageB);
  response.reject(new Error('simulated desktop failure'));
  await opening;

  assert.strictEqual(runtime.currentPage, pageB);
  assert.deepEqual(statuses, []);
});

test('Markdown title save cannot paint completion status into a newer same-Pane Tab', async () => {
  const app = await read('public/app.js');
  const pageA = { ...canvasPage('markdown-title-a'), type: 'markdown', title: 'Before' };
  const pageB = { ...canvasPage('markdown-title-b'), type: 'markdown', title: 'Other' };
  const response = deferred();
  const statuses = [];
  const recorded = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  const canonicalPages = new Map([[pageA.id, pageA], [pageB.id, pageB]]);
  const saveMarkdownDocumentTitle = compileSource(
    app,
    'async function saveMarkdownDocumentTitle',
    'function commitFocusedPageTitleEditor',
    {
      runtimeIsLive: harness.runtimeIsLive,
      canonicalPages,
      markdownPageMutationLocks: new Set(),
      captureRuntimeOperation: harness.captureRuntimeOperation,
      activePaneRuntime: harness.activePaneRuntime,
      showRuntimeStatus: (owner, message, ...detail) => statuses.push({ owner, message, detail }),
      persistPageTitle: () => response.promise,
      recordCommittedPageTitleChange: (change) => recorded.push(change),
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent
    },
    'saveMarkdownDocumentTitle'
  );

  const saving = saveMarkdownDocumentTitle(runtime, {
    pageId: pageA.id,
    title: 'After',
    previousTitle: 'Before'
  });
  await Promise.resolve();
  assert.equal(statuses.at(-1).message, 'Saving…');
  switchRuntimeToPage(runtime, pageB);
  response.resolve({ ...pageA, title: 'After' });

  assert.equal(await saving, 'After');
  assert.deepEqual(recorded, [{
    paneId: runtime.paneId,
    pageId: pageA.id,
    beforeTitle: 'Before',
    afterTitle: 'After'
  }]);
  assert.strictEqual(runtime.currentPage, pageB);
  assert.equal(statuses.some(({ message }) => message === 'Saved'), false);
});

test('Add Files adopts persisted Page A after a Tab switch while stale Page Edit imports are discarded', async () => {
  const app = await read('public/app.js');

  async function runScenario({ pageEditMode }) {
    const pageA = canvasPage(pageEditMode ? 'stage-add-a' : 'persist-add-a');
    const pageB = canvasPage(pageEditMode ? 'stage-add-b' : 'persist-add-b');
    const savedA = {
      ...pageA,
      objects: [{ id: 'added-image', type: 'image', visible: true }]
    };
    const response = deferred();
    const bridgeCalls = [];
    const commits = [];
    const renders = [];
    const statuses = [];
    const listRenders = [];
    const stagedChanges = [];
    const harness = await createPaneRuntimeHarness({ leftPage: pageA, rightPage: pageA });
    const runtime = harness.left.runtime;
    const siblingRuntime = harness.right.runtime;
    runtime.pageEditMode = pageEditMode;
    runtime.draftPageObjects = [];
    harness.context.canonicalPages.set(pageB.id, pageB);
    const addFileButton = { disabled: false };
    const addFilesToCurrentPage = compileSource(
      app,
      'async function addFilesToCurrentPage',
      'function droppedFiles',
      {
        runtimeIsLive: harness.runtimeIsLive,
        pageTypesModel: {
          pageTypeSupports: () => true
        },
        addFileInProgress: false,
        desktopAddFileAvailable: () => true,
        desktopFileDropAvailable: () => true,
        closePageMetaModal: () => {},
        closeResourceContextMenu: () => {},
        cancelBlockEdits: () => {},
        cancelHighlightEdits: () => {},
        isDisplayableObject: () => true,
        isVisibleObject: () => true,
        screenToWorld: (_owner, x, y) => ({ x, y }),
        markdownPageModel: {
          PAGE_TYPES: { MARKDOWN: 'markdown' },
          normalizePageType: (type) => type
        },
        addFileButton,
        showRuntimeStatus(owner, message, ...detail) {
          statuses.push({ owner, pageId: owner.currentPage?.id || null, message, detail });
        },
        captureRuntimeOperation: harness.captureRuntimeOperation,
        runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
        window: {
          cneDesktop: {
            addFiles(pageId, options) {
              bridgeCalls.push({ pageId, options });
              return response.promise;
            },
            addDroppedFiles() {
              throw new Error('picker scenario must not use dropped-file bridge');
            }
          }
        },
        clonePageEditSnapshot: (owner) => ({ objects: [...owner.draftPageObjects] }),
        renderCanvas: (...args) => renders.push(args),
        setSelectedPageObject: () => {},
        recordPageEditChange: (...args) => stagedChanges.push(args),
        commitCanonicalPage(saved, options = {}) {
          commits.push({ saved, options });
          harness.context.canonicalPages.set(saved.id, saved);
          for (const owner of harness.livingPaneRuntimes()) {
            if (owner.session.activeTab()?.currentPageId === saved.id) owner.currentPage = saved;
          }
          return saved;
        },
        renderPageList: () => listRenders.push(true),
        renderPage: (...args) => renders.push(args),
        enterPageEditMode: (...args) => stagedChanges.push(['enter', ...args]),
        activePaneRuntime: harness.activePaneRuntime,
        console
      },
      'addFilesToCurrentPage'
    );

    const adding = addFilesToCurrentPage(runtime);
    await Promise.resolve();
    switchRuntimeToPage(runtime, pageB);
    const mountB = runtime.mounted;
    response.resolve({
      ok: true,
      page: savedA,
      pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
      linked: [{ item: savedA.objects[0] }]
    });
    await adding;
    return {
      pageA,
      pageB,
      savedA,
      runtime,
      siblingRuntime,
      mountB,
      bridgeCalls,
      commits,
      renders,
      statuses,
      listRenders,
      stagedChanges,
      canonicalPages: harness.context.canonicalPages
    };
  }

  const persisted = await runScenario({ pageEditMode: false });
  assert.equal(persisted.bridgeCalls.length, 1);
  assert.equal(persisted.bridgeCalls[0].pageId, persisted.pageA.id);
  assert.equal(persisted.bridgeCalls[0].options.stageOnly, false);
  assert.ok(Number.isFinite(persisted.bridgeCalls[0].options.placementCenter.x));
  assert.ok(Number.isFinite(persisted.bridgeCalls[0].options.placementCenter.y));
  assert.strictEqual(persisted.canonicalPages.get(persisted.pageA.id), persisted.savedA);
  assert.strictEqual(persisted.siblingRuntime.currentPage, persisted.savedA,
    'other runtimes showing A receive the canonical persisted result');
  assert.strictEqual(persisted.runtime.currentPage, persisted.pageB);
  assert.strictEqual(persisted.runtime.mounted, persisted.mountB);
  assert.equal(persisted.commits.length, 1);
  assert.equal(persisted.commits[0].options.originRuntime, null);
  assert.deepEqual(persisted.listRenders, [true]);
  assert.deepEqual(persisted.renders, []);
  assert.equal(persisted.statuses.some(({ pageId }) => pageId === persisted.pageB.id), false);

  const staged = await runScenario({ pageEditMode: true });
  assert.equal(staged.bridgeCalls[0].options.stageOnly, true);
  assert.strictEqual(staged.runtime.currentPage, staged.pageB);
  assert.strictEqual(staged.runtime.mounted, staged.mountB);
  assert.deepEqual(staged.runtime.draftPageObjects, []);
  assert.deepEqual(staged.commits, []);
  assert.deepEqual(staged.listRenders, []);
  assert.deepEqual(staged.renders, []);
  assert.deepEqual(staged.stagedChanges, []);
  assert.equal(staged.statuses.some(({ pageId }) => pageId === staged.pageB.id), false);
});

test('Page deletion adopts the global result after same-Pane navigation without touching Page B', async () => {
  const app = await read('public/app.js');
  const pageA = canvasPage('delete-race-a');
  const pageB = canvasPage('delete-race-b');
  const preflight = deferred();
  const calls = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA, rightPage: pageB });
  const runtime = harness.left.runtime;
  const pageIndex = { pages: [
    { id: pageA.id, title: pageA.title },
    { id: pageB.id, title: pageB.title }
  ] };
  const deleteContextPage = compileSource(
    app,
    'async function deleteContextPage',
    'async function deleteContextFolder',
    {
      runtimeIsLive: harness.runtimeIsLive,
      pageContextTarget: null,
      pageIndex,
      navigationFolderById: () => null,
      pageDeleteInProgress: false,
      folderDeleteInProgress: false,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      request(url, options = {}) {
        calls.push(['request', url, options.method || 'GET']);
        if (options.method !== 'DELETE') return preflight.promise;
        return Promise.resolve({
          project: { lastOpenedPageId: pageB.id },
          pageIndex: { pages: [{ id: pageB.id, title: pageB.title }] },
          navigation: { root: [] },
          deletedPageId: pageA.id,
          fallbackPageId: pageB.id
        });
      },
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      pageDeleteCounts: () => ({ objects: 0, blocks: 0, relatedLinks: 0 }),
      closePageContextMenu: () => calls.push(['close-page-menu']),
      closeFolderContextMenu: () => calls.push(['close-folder-menu']),
      plural: (count, noun) => `${count} ${noun}`,
      deleteConfirmationMessage: () => 'delete?',
      hasDeletableContent: () => false,
      window: { confirm: () => true },
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      cancelBlockEdits: (owner) => calls.push(['cancel-block', owner.currentPage?.id]),
      cancelPageEdits: (owner) => calls.push(['cancel-page', owner.currentPage?.id]),
      cancelHighlightEdits: (owner) => calls.push(['cancel-highlight', owner.currentPage?.id]),
      pageMetaModal: { runtime },
      closePageMetaModal: () => calls.push(['close-page-meta']),
      showRuntimeStatus(owner, message) {
        statuses.push({ pageId: owner.currentPage?.id || null, message });
      },
      project: {},
      navigation: {},
      captureSidebarNavigationMutation: (detail) => {
        calls.push(['capture-motion', detail]);
        return detail;
      },
      livingPaneRuntimes: harness.livingPaneRuntimes,
      updatePageHistoryButtons: (owner) => calls.push(['history', owner]),
      clearNavigationSelection: () => calls.push(['clear-selection']),
      playSidebarNavigationMutation: async (motion) => calls.push(['play-motion', motion]),
      navigateCurrentTabToPage: (...args) => calls.push(['navigate', ...args]),
      loadPage: (...args) => calls.push(['load', ...args]),
      renderNoPage: (...args) => calls.push(['no-page', ...args])
    },
    'deleteContextPage'
  );

  runtime.blockEditMode = true;
  const deleting = deleteContextPage(runtime, { pageIds: [pageA.id] });
  await Promise.resolve();
  assert.equal(calls.some((call) => call[0] === 'request' && call[2] === 'GET'), true);
  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  preflight.resolve(pageA);
  await deleting;

  assert.equal(calls.some((call) => call[0] === 'request' && call[2] === 'DELETE'), true);
  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.equal(calls.some((call) => call[0] === 'capture-motion'), true,
    'the global navigation result is still presented');
  assert.equal(calls.some((call) => call[0] === 'clear-selection'), true);
  assert.equal(calls.some((call) => ['navigate', 'load', 'no-page'].includes(call[0])), false);
  assert.equal(calls.some((call) => call[0].startsWith('cancel-')), false);
  assert.equal(calls.some((call) => call[0] === 'close-page-meta'), false);
  assert.equal(statuses.some(({ pageId }) => pageId === pageB.id), false);
  assert.match(
    sourceBetween(app, 'async function deleteContextPage', 'async function deleteContextFolder'),
    /if \(pageMetaModal\?\.runtime === runtime\) closePageMetaModal\(\)/
  );
});

test('Folder deletion remains global after its confirmation owner switches Tabs', async () => {
  const app = await read('public/app.js');
  const pageA = canvasPage('folder-race-a');
  const pageB = canvasPage('folder-race-b');
  const decision = deferred();
  const calls = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  harness.context.canonicalPages.set(pageB.id, pageB);
  const folder = { id: 'folder-race', children: [] };
  const deleteContextFolder = compileSource(
    app,
    'async function deleteContextFolder',
    'async function deleteContextRelation',
    {
      folderContextTarget: folder,
      folderDeleteInProgress: false,
      activePaneRuntime: harness.activePaneRuntime,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      closeFolderContextMenu: () => calls.push(['close-folder-menu']),
      confirmFolderDelete: () => decision.promise,
      collectFolderPageIds: () => [],
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      showRuntimeStatus(owner, message) {
        statuses.push({ pageId: owner.currentPage?.id || null, message });
      },
      request: async (url, options = {}) => {
        calls.push(['request', url, options.method || 'GET']);
        return { navigation: { root: [] } };
      },
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      project: {},
      pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
      navigation: {},
      clearNavigationSelection: () => calls.push(['clear-selection']),
      livingPaneRuntimes: harness.livingPaneRuntimes,
      updatePageHistoryButtons: () => calls.push(['history']),
      captureSidebarNavigationMutation: (detail) => {
        calls.push(['capture-motion', detail]);
        return detail;
      },
      playSidebarNavigationMutation: async (motion) => calls.push(['play-motion', motion]),
      navigateCurrentTabToPage: (...args) => calls.push(['navigate', ...args]),
      renderNoPage: (...args) => calls.push(['no-page', ...args]),
      renderPage: (...args) => calls.push(['render', ...args]),
      renderBlockOverlays: (...args) => calls.push(['blocks', ...args])
    },
    'deleteContextFolder'
  );

  const deleting = deleteContextFolder();
  await Promise.resolve();
  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  decision.resolve({ confirmed: true, deletePages: false });
  await deleting;

  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.equal(calls.some((call) => call[0] === 'request'
    && call[1].includes('/api/navigation/folders/folder-race') && call[2] === 'DELETE'), true);
  assert.equal(calls.some((call) => call[0] === 'capture-motion'), true);
  assert.equal(calls.some((call) => call[0] === 'clear-selection'), true);
  assert.equal(calls.some((call) => ['navigate', 'no-page', 'render', 'blocks'].includes(call[0])), false);
  assert.equal(statuses.some(({ pageId }) => pageId === pageB.id), false);
});

test('Relation deletion refreshes global navigation but cannot render or status a newer Tab', async () => {
  const app = await read('public/app.js');
  const pageA = canvasPage('relation-race-a');
  const pageB = canvasPage('relation-race-b');
  const response = deferred();
  const calls = [];
  const statuses = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  const token = harness.captureRuntimeOperation(runtime, { scope: 'relation-delete' });
  const relation = {
    sourcePageId: pageA.id,
    sourceBlockId: 'block-a',
    sourceLinkId: 'link-a'
  };
  const deleteContextRelation = compileSource(
    `${app}\n/* pane-runtime-relation-test-end */`,
    'async function deleteContextRelation',
    '/* pane-runtime-relation-test-end */',
    {
      relationContextTarget: { runtime, token, relation },
      runtimeIsLive: harness.runtimeIsLive,
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      relationDeleteInProgress: false,
      closeRelationContextMenu: () => calls.push(['close-menu']),
      setRelationHoverBlocks: (...args) => calls.push(['hover', ...args]),
      showRuntimeStatus(owner, message) {
        statuses.push({ pageId: owner.currentPage?.id || null, message });
      },
      request: () => response.promise,
      pageApiUrl: (pageId, suffix = '') => `/api/pages/${pageId}${suffix}`,
      pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
      navigation: {},
      renderPageList: () => calls.push(['render-list']),
      renderPage: (...args) => calls.push(['render', ...args]),
      renderBlockOverlays: (...args) => calls.push(['blocks', ...args])
    },
    'deleteContextRelation'
  );

  const deleting = deleteContextRelation(runtime);
  await Promise.resolve();
  switchRuntimeToPage(runtime, pageB);
  const mountB = runtime.mounted;
  response.resolve({
    page: pageA,
    pageIndex: { pages: [{ id: pageA.id }, { id: pageB.id }] },
    navigation: { root: [] }
  });
  await deleting;

  assert.strictEqual(runtime.currentPage, pageB);
  assert.strictEqual(runtime.mounted, mountB);
  assert.equal(calls.some((call) => call[0] === 'render-list'), true);
  assert.equal(calls.some((call) => call[0] === 'render' || call[0] === 'blocks'), false);
  assert.equal(statuses.some(({ pageId }) => pageId === pageB.id), false);
});

test('a remounted same runtime receives title fanout without inheriting the stale save interaction', async () => {
  const app = await read('public/app.js');
  const pageA = { ...canvasPage('title-remount-a'), type: 'markdown', title: 'Before' };
  const pageB = { ...canvasPage('title-remount-b'), type: 'markdown', title: 'Other' };
  const savedA = { ...pageA, title: 'After', updatedAt: 'later' };
  const response = deferred();
  const commits = [];
  const statuses = [];
  const pendingPageTitleSaves = new Map();
  const pageTitleSaveQueues = new Map();
  const harness = await createPaneRuntimeHarness({ leftPage: pageA, rightPage: pageB });
  const runtime = harness.left.runtime;
  runtime.dom.pageTitleDisplay = harness.document.createElement('span');
  runtime.dom.pageTitle = harness.document.createElement('input');
  runtime.dom.pageTitleDisplay.textContent = pageA.title;
  runtime.dom.pageTitle.value = pageA.title;
  const titleOwners = compileSource(
    app,
    'function updatePageIndexFromSavedTitle',
    'function commitFocusedPageTitleEditor',
    {
      pageIndex: { pages: [
        { id: pageA.id, title: pageA.title },
        { id: pageB.id, title: pageB.title }
      ] },
      canonicalPages: harness.context.canonicalPages,
      commitCanonicalPage(page, options = {}) {
        commits.push({ page, options });
        harness.context.canonicalPages.set(page.id, page);
        return page;
      },
      globalThis: { structuredTextPageShell: { updateBoundTitles() {} } },
      livingPaneRuntimes: harness.livingPaneRuntimes,
      updatePaneToolbarPresentation: () => {},
      getWorkspacePane: (paneId) => harness.panes.get(paneId) || null,
      markdownPageModel: {
        PAGE_TYPES: { MARKDOWN: 'markdown' },
        normalizePageType: (type) => type
      },
      window: { markdownPageView: { updateMarkdownPageLayer() {} } },
      activePaneRuntime: harness.activePaneRuntime,
      refreshMarkdownControlStrip: () => {},
      renderPageList: () => {},
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      markdownPageMutationLocks: new Set(),
      makeUniquePageTitle: (title) => title,
      request: () => response.promise,
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      pageTitleSaveQueues,
      pendingPageTitleSaves,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      markdownBodySaveStates: new Map(),
      retainedHnSessionReferences: new Map(),
      hnPageDocumentSessionRegistry: null,
      scheduleHnSessionReferenceReconcile: () => {},
      undoManager: { beginContext() {}, record: () => true },
      getActivePane: () => harness.panes.get(harness.activePaneRuntime()?.paneId) || null,
      showRuntimeStatus(owner, message) {
        statuses.push({ pageId: owner.currentPage?.id || null, message });
      },
      runtimeIsLive: harness.runtimeIsLive
    },
    '{ persistPageTitle, saveMarkdownDocumentTitle }'
  );

  const originalTab = runtime.session.activeTab();
  const saving = titleOwners.saveMarkdownDocumentTitle(runtime, {
    pageId: pageA.id,
    title: savedA.title,
    previousTitle: pageA.title
  });
  for (let pass = 0; pass < 4 && !pendingPageTitleSaves.has(pageA.id); pass += 1) {
    await Promise.resolve();
  }
  assert.strictEqual(pendingPageTitleSaves.get(pageA.id)?.runtime, runtime);
  assert.strictEqual(pendingPageTitleSaves.get(pageA.id)?.operation?.runtime, runtime);

  switchRuntimeToPage(runtime, pageB);
  runtime.session.activateTab(originalTab.id);
  runtime.currentPage = pageA;
  runtime.currentPageEntry = { id: pageA.id, title: pageA.title };
  runtime.pageLoadSequence += 1;
  runtime.loadGeneration = runtime.pageLoadSequence;
  runtime.mounted = {
    tabId: originalTab.id,
    pageId: pageA.id,
    kind: pageA.type,
    generation: runtime.mounted.generation + 1
  };
  response.resolve(savedA);

  assert.equal(await saving, savedA.title);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.originRuntime, null,
    'an A→B→A remount is not the old interaction owner');
  assert.equal(runtime.currentPage.title, savedA.title,
    'canonical title still fans out to the remounted A view');
  assert.equal(runtime.dom.pageTitleDisplay.textContent, savedA.title);
  assert.equal(runtime.dom.pageTitle.value, savedA.title);
  assert.deepEqual(statuses, [{ pageId: pageA.id, message: 'Saving…' }]);
});

test('a disposed Pane id replacement cannot become the origin of an older title request', async () => {
  const app = await read('public/app.js');
  const pageA = { ...canvasPage('title-reused-pane'), type: 'markdown', title: 'Before' };
  const savedA = { ...pageA, title: 'After' };
  const response = deferred();
  const requests = [];
  const commits = [];
  const pendingPageTitleSaves = new Map();
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const oldRuntime = harness.left.runtime;
  const persistPageTitle = compileSource(
    app,
    'function updatePageIndexFromSavedTitle',
    'function runCommittedPageTitleHistoryMutation',
    {
      pageIndex: { pages: [{ id: pageA.id, title: pageA.title }] },
      canonicalPages: harness.context.canonicalPages,
      commitCanonicalPage(page, options = {}) {
        commits.push({ page, options });
        harness.context.canonicalPages.set(page.id, page);
        return page;
      },
      globalThis: { structuredTextPageShell: { updateBoundTitles() {} } },
      livingPaneRuntimes: harness.livingPaneRuntimes,
      updatePaneToolbarPresentation: () => {},
      getWorkspacePane: (paneId) => harness.panes.get(paneId) || null,
      markdownPageModel: {
        PAGE_TYPES: { MARKDOWN: 'markdown' },
        normalizePageType: (type) => type
      },
      window: { markdownPageView: { updateMarkdownPageLayer() {} } },
      activePaneRuntime: harness.activePaneRuntime,
      refreshMarkdownControlStrip: () => {},
      renderPageList: () => {},
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      markdownPageMutationLocks: new Set(),
      makeUniquePageTitle: (title) => title,
      request: (...args) => {
        requests.push(args);
        return response.promise;
      },
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      pageTitleSaveQueues: new Map(),
      pendingPageTitleSaves,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      markdownBodySaveStates: new Map(),
      retainedHnSessionReferences: new Map(),
      hnPageDocumentSessionRegistry: null,
      scheduleHnSessionReferenceReconcile: () => {}
    },
    'persistPageTitle'
  );

  const saving = persistPageTitle({ runtime: oldRuntime, pageId: pageA.id, title: savedA.title });
  for (let pass = 0; pass < 4 && !requests.length; pass += 1) await Promise.resolve();
  assert.strictEqual(pendingPageTitleSaves.get(pageA.id)?.runtime, oldRuntime);
  assert.strictEqual(pendingPageTitleSaves.get(pageA.id)?.operation?.runtime, oldRuntime);
  const replacement = harness.replaceRuntimeWithSamePaneId(oldRuntime, { page: pageA }).runtime;
  replacement.dom.pageTitleDisplay = harness.document.createElement('span');
  replacement.dom.pageTitle = harness.document.createElement('input');
  response.resolve(savedA);
  const savedResult = await saving;
  assert.equal(savedResult.id, savedA.id);
  assert.equal(savedResult.title, savedA.title);

  assert.equal(oldRuntime.disposed, true);
  assert.equal(replacement.paneId, oldRuntime.paneId);
  assert.notEqual(replacement.runtimeId, oldRuntime.runtimeId);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.originRuntime, null);
  assert.equal(replacement.currentPage.title, savedA.title);
  assert.equal(replacement.dom.pageTitleDisplay.textContent, savedA.title);
});

test('ordinary title save clears only its living runtime flag after a same-Pane Tab switch', async () => {
  const app = await read('public/app.js');
  const pageA = { ...canvasPage('title-flag-a'), title: 'Before' };
  const pageB = { ...canvasPage('title-flag-b'), title: 'Other' };
  const response = deferred();
  const statuses = [];
  const changes = [];
  const harness = await createPaneRuntimeHarness({ leftPage: pageA });
  const runtime = harness.left.runtime;
  runtime.dom.pageTitleDisplay = harness.document.createElement('span');
  runtime.dom.pageTitle = harness.document.createElement('input');
  runtime.dom.pageTitle.value = 'After';
  const saveTitle = compileSource(
    app,
    'async function saveTitle(runtime)',
    'async function convertCurrentPageType',
    {
      runtimeIsLive: harness.runtimeIsLive,
      pageIsSupported: () => true,
      markdownPageMutationLocks: new Set(),
      getWorkspacePane: (paneId) => harness.panes.get(paneId) || null,
      makeUniquePageTitle: (title) => title,
      captureRuntimeOperation: harness.captureRuntimeOperation,
      showRuntimeStatus(owner, message) {
        statuses.push({ pageId: owner.currentPage?.id || null, message });
      },
      closeTitleEditor: () => {},
      persistPageTitle: () => response.promise,
      recordCommittedPageTitleChange: (change) => changes.push(change),
      runtimeOperationIsCurrent: harness.runtimeOperationIsCurrent,
      canonicalPages: harness.context.canonicalPages,
      runtimeOperationOwnerIsCurrent: harness.runtimeOperationOwnerIsCurrent
    },
    'saveTitle'
  );

  const saving = saveTitle(runtime);
  assert.equal(runtime.titleSaveInProgress, true);
  switchRuntimeToPage(runtime, pageB);
  response.resolve({ ...pageA, title: 'After' });
  assert.equal(await saving, true);

  assert.equal(runtime.titleSaveInProgress, false,
    'the exact living runtime owns its in-flight flag across Tab changes');
  assert.strictEqual(runtime.currentPage, pageB);
  assert.deepEqual(changes, [{
    paneId: runtime.paneId,
    pageId: pageA.id,
    beforeTitle: pageA.title,
    afterTitle: 'After'
  }]);
  assert.deepEqual(statuses, [{ pageId: pageA.id, message: 'Saving…' }]);
});

test('race C: metadata-style canonical fanout preserves active Markdown DOM and live draft', async () => {
  const app = await read('public/app.js');
  const previous = {
    ...canvasPage('metadata-markdown'),
    type: 'markdown',
    title: 'Before',
    markdownBody: 'live local body'
  };
  const incoming = {
    ...previous,
    title: 'After',
    markdownBody: 'stale response body'
  };
  const harness = await createPaneRuntimeHarness({ leftPage: previous, rightPage: previous });
  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  const editorLayer = harness.document.createElement('div');
  editorLayer.className = 'markdown-page-layer';
  const editor = harness.document.createElement('textarea');
  editor.value = 'live unsaved editor text';
  editor.setSelectionRange(5, 14, 'backward');
  editor.dataset.compositionActive = 'true';
  editorLayer.append(editor);
  harness.right.runtime.dom.canvasStage.append(editorLayer);
  editor.focus();
  const canonicalPages = new Map([[previous.id, previous]]);
  const updates = [];
  const fullRenders = [];
  const commitCanonicalPage = compileSource(
    app,
    'function commitCanonicalPage',
    'function highlightBlockIds',
    {
      canonicalPages,
      pageIsHnText: () => false,
      markdownBodySaveStates: new Map(),
      markdownPageModel: {
        PAGE_TYPES: { MARKDOWN: 'markdown' },
        normalizePageType: (type) => type
      },
      hnPageDocumentSessionRegistry: null,
      structuredTextFrameOnlyPageChange: () => false,
      runDescriptorMetadataPresentation: (callback) => callback(),
      renderTabStrip: () => {},
      livingPaneRuntimes: harness.livingPaneRuntimes,
      pageIndex: { pages: [{ id: previous.id, title: 'After' }] },
      updateStructuredTextPageLayerForRuntime(runtime, page) {
        updates.push({ runtime, page });
        return true;
      },
      setPaneInfoPanelsAvailable: () => {},
      updatePaneToolbarPresentation: () => {},
      getWorkspacePane: (paneId) => harness.panes.get(paneId) || null,
      activePaneRuntime: harness.activePaneRuntime,
      refreshActivePaneWindowChrome: () => {},
      renderPageContent: (...args) => fullRenders.push(args),
      pageSupportsCanvas: () => false,
      prepareActiveTabHighlightState: () => {},
      renderBlockOverlays: () => {},
      pruneInfoPanelsForDeletedOwner: () => {}
    },
    'commitCanonicalPage'
  );

  const canonical = commitCanonicalPage(incoming, {
    originRuntime: harness.left.runtime,
    preserveDocumentBody: true,
    presentationErrorsAreNonFatal: true
  });

  assert.equal(canonical.title, 'After');
  assert.equal(canonical.markdownBody, 'live local body');
  assert.strictEqual(canonicalPages.get(previous.id), canonical);
  assert.strictEqual(harness.right.runtime.currentPage, canonical);
  assert.deepEqual(updates.map(({ runtime }) => runtime), [harness.right.runtime]);
  assert.deepEqual(fullRenders, []);
  assert.strictEqual(
    harness.right.runtime.dom.canvasStage.querySelector('.markdown-page-layer'),
    editorLayer
  );
  assert.strictEqual(editorLayer.querySelector('textarea'), editor);
  assert.strictEqual(harness.document.activeElement, editor);
  assert.equal(editor.value, 'live unsaved editor text');
  assert.equal(editor.selectionStart, 5);
  assert.equal(editor.selectionEnd, 14);
  assert.equal(editor.selectionDirection, 'backward');
  assert.equal(editor.dataset.compositionActive, 'true');
});

test('remote canonical deletion closes inactive Tabs without remount and displays a live fallback', async () => {
  const app = await read('public/app.js');
  const harness = await createPaneRuntimeHarness({ leftPage: canvasPage('visible-a') });
  const runtime = harness.left.runtime;
  const fallback = canvasPage('fallback-b');
  const renders = [];
  const loads = [];
  const owners = compileSource(
    app,
    'function fenceRuntimeForCanonicalPageDeletion',
    'function handleCanonicalPageDeleted',
    {
      runtimeIsLive: harness.runtimeIsLive,
      pageIndex: { pages: [{ id: fallback.id, title: fallback.title }] },
      loadPage: async (owner, entry, options) => {
        loads.push({ owner, entry, options });
        owner.currentPage = fallback;
        owner.currentPageEntry = entry;
        return true;
      },
      renderEmptyTab: (...args) => renders.push(args)
    },
    '{ fenceRuntimeForCanonicalPageDeletion, settleRuntimeAfterCanonicalPageDeletion }'
  );

  const visibleTab = runtime.session.activeTab();
  const deletedInactiveTab = runtime.session.createTab('deleted-inactive');
  runtime.session.activateTab(visibleTab.id);
  runtime.currentPage = canvasPage('visible-a');
  const generationBefore = runtime.mounted.generation;
  const loadBefore = runtime.pageLoadSequence;
  assert.equal(await owners.settleRuntimeAfterCanonicalPageDeletion(
    runtime, 'deleted-inactive'
  ), true);
  assert.equal(runtime.session.tabById(deletedInactiveTab.id), null);
  assert.equal(runtime.session.activeTab(), visibleTab);
  assert.equal(runtime.mounted.generation, generationBefore);
  assert.equal(runtime.pageLoadSequence, loadBefore);
  assert.deepEqual(loads, []);
  assert.deepEqual(renders, []);

  const deletedDisplayedTab = runtime.session.createTab('deleted-displayed');
  runtime.session.createTab(fallback.id);
  runtime.session.activateTab(deletedDisplayedTab.id);
  runtime.currentPage = canvasPage('deleted-displayed');
  runtime.mounted = {
    tabId: deletedDisplayedTab.id,
    pageId: 'deleted-displayed',
    kind: 'canvas',
    generation: generationBefore + 1
  };
  const displayedGeneration = runtime.mounted.generation;
  const displayedLoadSequence = runtime.pageLoadSequence;

  assert.equal(await owners.settleRuntimeAfterCanonicalPageDeletion(
    runtime, 'deleted-displayed'
  ), true);
  assert.equal(runtime.session.tabById(deletedDisplayedTab.id), null);
  assert.equal(runtime.currentPage, fallback);
  assert.equal(runtime.pageLoadSequence, displayedLoadSequence + 1);
  assert.equal(runtime.mounted.generation, displayedGeneration + 1);
  assert.equal(loads.length, 1);
  assert.strictEqual(loads[0].owner, runtime);
  assert.equal(loads[0].entry.id, fallback.id);
  assert.deepEqual(loads[0].options, {
    historyMode: 'preserve',
    preferCanonical: true,
    saveCurrentView: false
  });
  assert.deepEqual(renders, []);
});

test('Sidebar/window width choreography preserves exact PaneRuntime and editor identities', async () => {
  const app = await read('public/app.js');
  const harness = await createPaneRuntimeHarness();
  const leftRuntime = harness.left.runtime;
  const rightRuntime = harness.right.runtime;
  harness.left.pane.width = 620;
  harness.left.pane.mode = 'expanded';
  harness.right.pane.width = 620;
  harness.right.pane.mode = 'expanded';
  const editor = harness.document.createElement('textarea');
  editor.value = 'durable editor';
  editor.setSelectionRange(2, 9, 'forward');
  leftRuntime.dom.canvasStage.append(editor);
  editor.focus();
  const workspace = {
    state: {
      panes: [harness.left.pane, harness.right.pane],
      activePaneId: harness.left.pane.id
    },
    fitToWidth(width) {
      this.state.panes[0].width = width * 0.45;
      this.state.panes[1].width = width * 0.55;
    }
  };
  const geometry = compileSource(
    app,
    'function applyWorkspacePaneGeometry',
    'function initializeWorkspacePaneStackLayout',
    {
      workspace,
      paneToolbarRegion: () => null,
      paneTabRegion: () => null,
      workspacePaneRoot: {
        getBoundingClientRect: () => ({ left: 0, width: 1000 }),
        children: [],
        style: { setProperty() {} }
      },
      topTabArea: null,
      workspacePanesInRenderOrder: () => workspace.state.panes,
      paneReorderState: null,
      renderPaneToolbarCollection: () => {},
      renderTabStrip: () => {},
      scheduleWorkspacePaneChromeLayout: () => {},
      paneDividerDragState: null
    },
    '{ fitWorkspacePanesToAvailableWidth, applyWorkspacePaneGeometry }'
  );

  assert.equal(geometry.fitWorkspacePanesToAvailableWidth(), true);
  assert.strictEqual(harness.left.pane.viewContext, leftRuntime);
  assert.strictEqual(harness.right.pane.viewContext, rightRuntime);
  assert.strictEqual(leftRuntime.dom.canvasStage.querySelector('textarea'), editor);
  assert.strictEqual(harness.document.activeElement, editor);
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 9);
  assert.equal(editor.selectionDirection, 'forward');
  assert.equal(harness.left.pane.width, 450);
  assert.equal(harness.right.pane.width, 550);
});
