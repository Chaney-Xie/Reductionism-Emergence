'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const appearanceSettingsModel = require('../../public/appearanceSettings');
const imageResolutionModel = require('../../public/imageResolution');
const pageObjectsModel = require('../../public/pageObjects');
const pageTypesModel = require('../../public/pageTypes');
const resourceLocationsModel = require('../../public/resourceLocations');
const zoomControls = require('../../public/zoomControls');
const {
  CanvasFakeDocument,
  createUndoHarness,
  pointerEvent
} = require('./colourfulCanvasHarness');

const ROOT = path.join(__dirname, '..', '..');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function defaultPage(id) {
  return {
    id,
    code: id,
    name: id,
    type: 'canvas',
    objects: [],
    blocks: [],
    highlightGroups: []
  };
}

function createSession({ paneId, page, viewState = {} }) {
  const tab = {
    id: `tab-${paneId}`,
    currentPageId: page.id,
    history: [page.id],
    historyIndex: 0,
    pageViewStates: {},
    viewState: {
      panX: 0,
      panY: 0,
      zoom: 1,
      viewportInitialized: true,
      infoPanels: [],
      infoPanelZCounter: 0,
      checkedHighlightGroupIds: [],
      ...clone(viewState)
    }
  };
  const tabs = [tab];
  let activeTabId = tab.id;
  return {
    activeTab: () => tabs.find((candidate) => candidate.id === activeTabId) || null,
    tabById: (tabId) => tabs.find((candidate) => candidate.id === tabId) || null,
    tabs: () => tabs,
    navigateActive(pageId, { mode, historyIndex = null } = {}) {
      const active = tabs.find((candidate) => candidate.id === activeTabId) || null;
      if (!active) return null;
      if (mode === 'push') {
        active.history = active.history.slice(0, active.historyIndex + 1);
        if (active.history.at(-1) !== pageId) active.history.push(pageId);
        active.historyIndex = active.history.length - 1;
      } else if (mode === 'back-forward') {
        if (!Number.isInteger(historyIndex) || active.history[historyIndex] !== pageId) return null;
        active.historyIndex = historyIndex;
      } else if (mode === 'replace') {
        active.history = [pageId];
        active.historyIndex = 0;
      } else if (mode !== 'preserve') {
        return null;
      }
      active.currentPageId = pageId;
      return active;
    },
    createTab(pageId = null) {
      const created = {
        id: `tab-${paneId}-${tabs.length + 1}`,
        currentPageId: pageId,
        history: pageId ? [pageId] : [],
        historyIndex: pageId ? 0 : -1,
        pageViewStates: {},
        viewState: {
          panX: 0,
          panY: 0,
          zoom: 1,
          viewportInitialized: false,
          infoPanels: [],
          infoPanelZCounter: 0,
          checkedHighlightGroupIds: []
        }
      };
      tabs.push(created);
      activeTabId = created.id;
      return created;
    },
    activateTab(tabId) {
      const target = tabs.find((candidate) => candidate.id === tabId);
      if (!target) return null;
      activeTabId = tabId;
      return target;
    },
    closeTab(tabId) {
      const index = tabs.findIndex((candidate) => candidate.id === tabId);
      if (index < 0) return null;
      const wasActive = activeTabId === tabId;
      tabs.splice(index, 1);
      if (!tabs.length) {
        return this.createTab(null);
      }
      if (wasActive) activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
      return this.activeTab();
    },
    saveViewState(tabId, nextViewState) {
      const target = tabs.find((candidate) => candidate.id === tabId);
      if (!target) return false;
      target.viewState = clone(nextViewState);
      return true;
    }
  };
}

function createRuntimeDom(document, paneId, {
  left = 0,
  top = 0,
  width = 800,
  height = 600
} = {}) {
  const paneElement = document.createElement('section');
  paneElement.className = 'workspace-pane';
  paneElement.dataset.workspacePaneId = paneId;
  const canvasArea = document.createElement('div');
  canvasArea.className = 'canvas-area';
  canvasArea.clientWidth = width;
  canvasArea.clientHeight = height;
  canvasArea._rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
  const canvasStage = document.createElement('div');
  canvasStage.className = 'canvas-stage';
  const emptyCanvas = document.createElement('p');
  emptyCanvas.className = 'canvas-empty';
  canvasArea.append(canvasStage, emptyCanvas);
  paneElement.append(canvasArea);
  document.body.append(paneElement);
  return {
    paneElement,
    canvasArea,
    canvasStage,
    emptyCanvas,
    editBlockButton: document.createElement('button'),
    editPageButton: document.createElement('button'),
    blockHighlightButton: document.createElement('button'),
    highlightGroupButton: document.createElement('button'),
    highlightGroupMenu: document.createElement('div'),
    editMenu: document.createElement('div'),
    pageTitle: document.createElement('div'),
    infoPanelLayer: null
  };
}

function createPaneRuntime({
  document,
  paneId,
  runtimeId,
  page = defaultPage(`page-${paneId}`),
  viewState = {},
  dom = {}
}) {
  const session = createSession({ paneId, page, viewState });
  const runtimeDom = {
    ...createRuntimeDom(document, paneId, dom),
    ...(dom.fields || {})
  };
  const runtime = {
    paneId,
    runtimeId,
    lifecycleEpoch: 1,
    disposed: false,
    session,
    dom: runtimeDom,
    mounted: {
      tabId: session.activeTab().id,
      pageId: page.id,
      kind: page.type,
      generation: 1
    },
    currentPage: page,
    currentPageEntry: null,
    pageLoadSequence: 0,
    loadGeneration: 0,
    canvasObjects: [],
    canvasBounds: null,
    canvasView: { scale: 1, offsetX: 0, offsetY: 0 },
    canvasImageSessionPageId: null,
    canvasImageSessionGeneration: 0,
    canvasImageVariantStates: new Map(),
    canvasImageResolutionTimer: null,
    blockEditMode: false,
    blockVisualMode: 'normal',
    originalBlocks: [],
    draftBlocks: [],
    blockDrawing: null,
    blockPreview: null,
    selectedBlockId: null,
    blockTransform: null,
    blockSaveInProgress: false,
    pageEditMode: false,
    originalPageObjects: [],
    originalPageBlocks: [],
    originalPageTextFrame: null,
    draftPageObjects: [],
    draftPageBlocks: [],
    draftPageTextFrame: null,
    selectedPageObjectId: null,
    pageObjectDrag: null,
    pageEditSaveInProgress: false,
    hoveredCanvasBlockId: null,
    activeHighlightGroupId: null,
    activeHighlightBlockIds: new Set(),
    selectedHighlightBlockIds: new Set(),
    highlightEditDraft: null,
    blockStateRequests: new WeakMap(),
    addLinkTarget: null,
    linkPickMode: null,
    addLinkInProgress: false,
    quickColour: {
      blockId: null,
      pageId: null,
      overlayHost: null,
      resizeObserver: null,
      manualPosition: null,
      drag: null,
      suppressClickTimer: null,
      suppressNextClick: false,
      generation: 0
    },
    infoPanelsSuspended: false,
    suspendedInfoPanelEditor: null,
    temporaryInfoBlockId: null,
    infoPanelEditor: null,
    infoPanelEditorRevision: 0,
    infoPanelGeometryGesture: null,
    infoPanelFocusFrame: null
  };
  const pane = {
    id: paneId,
    element: runtimeDom.paneElement,
    session,
    viewContext: runtime
  };
  return { pane, runtime };
}

function createRafController() {
  let sequence = 0;
  const pending = new Map();
  return {
    request(callback) {
      const id = ++sequence;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    flush(limit = 100) {
      let executed = 0;
      while (pending.size && executed < limit) {
        const entries = [...pending.entries()];
        pending.clear();
        for (const [, callback] of entries) {
          callback(Date.now());
          executed += 1;
          if (executed >= limit) break;
        }
      }
      return executed;
    },
    pendingCount: () => pending.size
  };
}

async function createPaneRuntimeHarness({
  leftPage = defaultPage('page-left'),
  rightPage = defaultPage('page-right'),
  leftViewState = {},
  rightViewState = {},
  globals = {}
} = {}) {
  const document = new CanvasFakeDocument();
  const left = createPaneRuntime({
    document,
    paneId: 'pane-left',
    runtimeId: 'runtime-left-1',
    page: leftPage,
    viewState: leftViewState,
    dom: { left: 20, top: 40, width: 620, height: 480 }
  });
  const right = createPaneRuntime({
    document,
    paneId: 'pane-right',
    runtimeId: 'runtime-right-1',
    page: rightPage,
    viewState: rightViewState,
    dom: { left: 660, top: 40, width: 620, height: 480 }
  });
  const panes = new Map([
    [left.pane.id, left.pane],
    [right.pane.id, right.pane]
  ]);
  let activePaneId = left.pane.id;
  const raf = createRafController();
  const windowListeners = new Map();

  const livingPaneRuntimes = () => [...panes.values()]
    .map((pane) => pane.viewContext)
    .filter((runtime) => runtime && runtime.disposed !== true);
  const runtimeIsLive = (runtime) => Boolean(runtime
    && runtime.disposed !== true
    && panes.get(runtime.paneId)?.viewContext === runtime);
  const activePaneRuntime = () => panes.get(activePaneId)?.viewContext || null;
  const captureRuntimeOperation = (runtime, detail = {}) => {
    const tab = runtime?.session?.activeTab?.();
    return {
      ...detail,
      runtime,
      runtimeId: runtime?.runtimeId,
      lifecycleEpoch: runtime?.lifecycleEpoch,
      session: runtime?.session,
      tab: tab || null,
      tabId: tab?.id || null,
      pageId: detail.pageId ?? tab?.currentPageId ?? runtime?.currentPage?.id ?? null,
      pageLoadGeneration: runtime?.pageLoadSequence,
      mountGeneration: runtime?.mounted?.generation ?? null,
      requireTab: detail.requireTab ?? true,
      requirePage: detail.requirePage ?? true,
      requirePageLoad: detail.requirePageLoad ?? true,
      requireMount: detail.requireMount ?? true
    };
  };
  const runtimeOperationOwnerIsCurrent = (operation) => {
    const runtime = operation?.runtime;
    return Boolean(runtimeIsLive(runtime)
      && runtime.runtimeId === operation?.runtimeId
      && runtime.lifecycleEpoch === operation?.lifecycleEpoch
      && runtime.session === operation?.session);
  };
  const runtimeOperationIsCurrent = (operation) => {
    const runtime = operation?.runtime;
    if (!runtimeOperationOwnerIsCurrent(operation)) return false;
    if (operation.requirePageLoad
      && runtime.pageLoadSequence !== operation.pageLoadGeneration) return false;
    if (operation.requireMount
      && (runtime.mounted?.generation ?? 0) !== operation.mountGeneration) return false;
    const tab = runtime.session?.activeTab?.() || null;
    if (operation.requireTab
      && (tab !== operation.tab || (tab?.id || null) !== operation.tabId)) return false;
    return !operation.requirePage || operation.pageId === null
      || (tab?.currentPageId || runtime.currentPage?.id || null) === operation.pageId;
  };
  const setActiveWorkspacePane = (paneId) => {
    if (!panes.has(paneId)) return null;
    activePaneId = paneId;
    return panes.get(paneId);
  };

  const environment = {
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    document,
    CSS: { escape: (value) => String(value) },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MIN_CANVAS_SCALE: 0.1,
    MAX_CANVAS_SCALE: 6,
    CANVAS_FIT_PADDING: 32,
    MIN_BLOCK_SIZE: 8,
    BLOCK_MOVE_THRESHOLD: 3,
    BLOCK_STATE: Object.freeze({ HIDDEN: 0, DEFAULT: 1, HIGHLIGHTED: 2, ACTIVE: 3 }),
    BLOCK_MODE: Object.freeze({
      NORMAL: 'normal',
      BLOCK_EDIT: 'block-edit',
      HIGHLIGHT_VIEW: 'highlight-view',
      HIGHLIGHT_EDIT: 'highlight-edit'
    }),
    appearanceSettingsModel,
    appearanceSettings: appearanceSettingsModel.normalizeAppearanceSettings(null),
    imageResolutionModel,
    pageObjectsModel,
    pageTypesModel,
    resourceLocationsModel,
    zoomControls,
    zoomSensitivity: 1,
    undoManager: createUndoHarness(),
    activePaneRuntime,
    livingPaneRuntimes,
    runtimeIsLive,
    captureRuntimeOperation,
    runtimeOperationOwnerIsCurrent,
    runtimeOperationIsCurrent,
    getWorkspacePane: (paneId) => panes.get(paneId) || null,
    setActiveWorkspacePane,
    pageForWorkspacePane: (pane) => pane?.viewContext?.currentPage || null,
    checkedHighlightGroupIdsForViewState: (viewState) => (
      Array.isArray(viewState?.checkedHighlightGroupIds)
        ? viewState.checkedHighlightGroupIds
        : []
    ),
    pageMetaModal: null,
    pageDeleteInProgress: false,
    canonicalPages: new Map([
      [leftPage.id, leftPage],
      [rightPage.id, rightPage]
    ]),
    markdownPageMutationLocks: new Set(),
    vaultPreferences: { lastMarkdownMode: 'reading', cneTextMode: 'reading' },
    renderRelations() {},
    refreshMarkdownControlStrip() {},
    refreshHnTextControlStrip() {},
    scheduleWorkspaceStateSave() {},
    showRuntimeStatus() {},
    showStatus() {},
    setEditMenuOpen() {},
    setHighlightMenuOpen() {},
    updateEditAvailability() {},
    pageIsMarkdown: () => false,
    pageIsHnText: () => false,
    blockIsInteractive: () => true,
    clickableBlockTargets: () => [],
    pageLinks: () => [],
    closeAddLinkPopover() {},
    cacheBustedSrc: (_runtime, object) => object?.src || '',
    destroyMarkdownPageLayer() {},
    destroyHnTextPageLayer() {},
    requestAnimationFrame: (callback) => raf.request(callback),
    cancelAnimationFrame: (id) => raf.cancel(id),
    devicePixelRatio: 1,
    screenX: 0,
    outerWidth: 1280,
    innerWidth: 1280,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
    ...globals
  };
  environment.window = environment;
  const context = vm.createContext(environment);

  function disposeRuntime(runtime) {
    if (!runtimeIsLive(runtime)) return false;
    runtime.disposed = true;
    runtime.lifecycleEpoch += 1;
    panes.delete(runtime.paneId);
    if (activePaneId === runtime.paneId) activePaneId = panes.keys().next().value || null;
    return true;
  }

  function addPaneRuntime({
    paneId,
    runtimeId = `runtime-${paneId}-1`,
    page = defaultPage(`page-${paneId}`),
    viewState = {},
    dom = {}
  }) {
    if (!paneId || panes.has(paneId)) return null;
    const added = createPaneRuntime({ document, paneId, runtimeId, page, viewState, dom });
    panes.set(paneId, added.pane);
    environment.canonicalPages.set(page.id, page);
    return added;
  }

  function replaceRuntimeWithSamePaneId(runtime, { page = defaultPage('page-replacement') } = {}) {
    const paneId = runtime.paneId;
    const wasActive = activePaneId === paneId;
    disposeRuntime(runtime);
    const replacement = createPaneRuntime({
      document,
      paneId,
      runtimeId: `${runtime.runtimeId}-replacement`,
      page
    });
    panes.set(paneId, replacement.pane);
    if (wasActive) activePaneId = paneId;
    return replacement;
  }

  async function loadLeaf(file, exportedNames) {
    const relativePath = path.join('public', 'js', file);
    const source = await fs.readFile(path.join(ROOT, relativePath), 'utf8');
    const apiName = `__${file.replace(/\W/g, '_')}PaneRuntimeTest`;
    const exportsSource = exportedNames.map((name) => `${JSON.stringify(name)}: ${name}`)
      .join(',\n');
    new vm.Script(`${source}\n;globalThis[${JSON.stringify(apiName)}] = {\n${exportsSource}\n};`, {
      filename: relativePath
    }).runInContext(context);
    return { source, api: context[apiName] };
  }

  return {
    context,
    document,
    panes,
    left,
    right,
    raf,
    activePaneRuntime,
    setActiveWorkspacePane,
    livingPaneRuntimes,
    runtimeIsLive,
    captureRuntimeOperation,
    runtimeOperationOwnerIsCurrent,
    runtimeOperationIsCurrent,
    addPaneRuntime,
    disposeRuntime,
    replaceRuntimeWithSamePaneId,
    loadLeaf,
    pointer: (runtime, options = {}) => pointerEvent({
      target: runtime.dom.canvasArea,
      ...options
    })
  };
}

module.exports = {
  createPaneRuntime,
  createPaneRuntimeHarness,
  deferred
};
