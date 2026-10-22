'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const structuredTextFrameModel = require('../public/structuredTextFrame');
const { createTabSession, defaultViewState } = require('../public/sessionTabs');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

async function structuredTextViewportHarness() {
  const canvas = await read('public/js/canvasBlocks.js');
  const runtimeSource = sourceBetween(
    canvas,
    'function structuredTextViewportRect(area)',
    'function fitStructuredTextCameraToFrame(frame, area, view)'
  );
  const stage = {};
  const areaGeometry = { left: 0, width: 1000 };
  const area = {
    isConnected: true,
    clientWidth: 1000,
    getBoundingClientRect: () => ({ ...areaGeometry })
  };
  let activeTab = {
    id: 'tab_a',
    currentPageId: 'page_shared',
    viewState: { panX: 0, panY: 0, zoom: 1, viewportInitialized: true }
  };
  const saves = [];
  const session = {
    activeTab: () => activeTab,
    saveViewState: (tabId, viewState) => saves.push({ tabId, viewState })
  };
  const runtime = {
    paneId: 'pane_a',
    runtimeId: 'runtime_pane_a',
    lifecycleEpoch: 1,
    disposed: false,
    session,
    canvasView: { offsetX: 0, offsetY: 0, scale: 1 },
    currentPage: {
      id: 'page_shared',
      textFrame: { centerWorldX: 500, preferredWidth: 600 }
    },
    pageEditMode: false,
    draftPageTextFrame: null,
    dom: { canvasStage: stage, canvasArea: area },
    mounted: { tabId: 'tab_a', pageId: 'page_shared', generation: 1 }
  };
  const pane = { id: 'pane_a', viewContext: runtime, session };
  const animationFrames = new Map();
  let nextAnimationFrame = 0;
  const context = vm.createContext({
    console,
    screenX: 0,
    outerWidth: 1200,
    innerWidth: 1000,
    structuredTextFrameModel,
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    runtimeIsLive: (candidate) => candidate === runtime && !candidate.disposed
      && pane.viewContext === candidate,
    captureRuntimeOperation: (candidate, detail = {}) => ({
      runtime: candidate,
      runtimeId: candidate.runtimeId,
      lifecycleEpoch: candidate.lifecycleEpoch,
      session: candidate.session,
      tab: candidate.session.activeTab(),
      tabId: candidate.session.activeTab()?.id || null,
      pageId: detail.pageId ?? candidate.currentPage?.id ?? null,
      mountGeneration: candidate.mounted?.generation ?? null,
      ...detail
    }),
    runtimeOperationIsCurrent: (operation) => operation?.runtime === runtime
      && pane.viewContext === runtime
      && !runtime.disposed
      && operation.runtimeId === runtime.runtimeId
      && operation.lifecycleEpoch === runtime.lifecycleEpoch
      && operation.session === runtime.session
      && operation.tab === runtime.session.activeTab()
      && operation.tabId === runtime.session.activeTab()?.id
      && operation.pageId === runtime.currentPage?.id
      && operation.mountGeneration === runtime.mounted?.generation,
    scheduleWorkspaceStateSave: () => {},
    writeCanvasTransformFor: () => {},
    requestAnimationFrame: (callback) => {
      nextAnimationFrame += 1;
      animationFrames.set(nextAnimationFrame, callback);
      return nextAnimationFrame;
    },
    cancelAnimationFrame: (frameId) => animationFrames.delete(frameId),
    ResizeObserver: class ResizeObserver {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() {}
    }
  });
  vm.runInContext(`
    const structuredTextViewportStates = new WeakMap();
    const liveStructuredTextViewportStates = new Set();
    let structuredTextViewportMoveFrame = null;
    const STRUCTURED_TEXT_VIEWPORT_EDGE_EPSILON = 0.5;
    const STRUCTURED_TEXT_WINDOW_MOVE_CONFIRMATION_FRAMES = 3;
    ${runtimeSource}
    globalThis.viewportTestApi = {
      applyStructuredTextViewportResize,
      observeStructuredTextViewport,
      synchronizeStructuredTextViewportWindowPosition,
      stateFor: (area) => structuredTextViewportStates.get(area)
    };
  `, context);
  return {
    api: context.viewportTestApi,
    area,
    areaGeometry,
    context,
    pane,
    runtime,
    saves,
    stage,
    setActiveTab(tab) {
      activeTab = tab;
      runtime.mounted = {
        tabId: tab.id,
        pageId: tab.currentPageId,
        generation: runtime.mounted.generation + 1
      };
    }
  };
}

test('Markdown and HN expose one shared Page-frame edit path', async () => {
  const [pageTypes, app, canvas, shell, markdownView, hnView] = await Promise.all([
    read('public/pageTypes.js'),
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/structuredTextPageShell.js'),
    read('public/js/markdownPageView.js'),
    read('public/js/hnTextPageView.js')
  ]);

  const hnRegistration = sourceBetween(
    pageTypes,
    'id: PAGE_TYPES.HN_TEXT',
    'return Object.freeze({'
  );
  assert.match(hnRegistration, /capabilities:\s*\[[^\]]*'page-edit'[^\]]*\]/);

  const updateAvailability = sourceBetween(
    app,
    'function updateEditAvailability(runtime)',
    'function syncMarkdownDraftToOtherPanes'
  );
  const updateToolbar = sourceBetween(
    app,
    'function updatePaneToolbarPresentation(pane)',
    'function renderPaneToolbarCollection'
  );
  for (const implementationGate of [updateAvailability, updateToolbar]) {
    assert.match(implementationGate, /PAGE_TYPES\.HN_TEXT|structured-text|structuredText/);
  }

  const enterPageEdit = sourceBetween(
    canvas,
    'function enterPageEditMode(',
    'function cancelPageEdits('
  );
  assert.match(enterPageEdit, /HN_TEXT|pageIsHnText|structured-text|structuredText/);
  assert.match(enterPageEdit, /beginBoundaryDrag|textFrame/);

  const markdownMount = sourceBetween(
    canvas,
    "if (rendersMarkdown && typeof renderMarkdownPageLayer === 'function')",
    "if (rendersHnText && typeof renderHnTextPageLayer === 'function')"
  );
  const hnMount = sourceBetween(
    canvas,
    "if (rendersHnText && typeof renderHnTextPageLayer === 'function')",
    'canvasStage.style.width'
  );
  for (const mount of [markdownMount, hnMount]) {
    assert.match(mount, /pageEditMode/);
    assert.match(mount, /onTextFrameInput/);
    assert.match(mount, /onTextFrameCommit/);
  }
  assert.match(
    hnMount,
    /mode:\s*hnTextModel\.normalizeHnTextMode\(vaultPreferences\.cneTextMode\)/
  );

  assert.match(shell, /frameModel\.beginBoundaryDrag\(/);
  assert.match(shell, /frameModel\.updateBoundaryDrag\(/);

  for (const view of [markdownView, hnView]) {
    assert.match(view, /pageEditMode/);
    assert.match(view, /onTextFrameInput/);
    assert.match(view, /onTextFrameCommit/);
  }
  assert.match(markdownView, /structuredTextShell\.createFrameBoundary\(/);
  assert.match(markdownView, /frameEditor/);
  assert.match(hnView, /shell\.mount\(/);
});

test('boundary drag clamps crossing and maximum width without moving the fixed edge', () => {
  const baseline = structuredTextFrameModel.normalizeTextFrame({
    centerWorldX: 100,
    preferredWidth: 800
  });
  const baselineEdges = structuredTextFrameModel.edgesForFrame(baseline);

  const leftDrag = structuredTextFrameModel.beginBoundaryDrag(baseline, 'left');
  const leftCrossed = structuredTextFrameModel.edgesForFrame(
    structuredTextFrameModel.updateBoundaryDrag(leftDrag, baselineEdges.rightWorld + 1000)
  );
  assert.equal(leftCrossed.rightWorld, baselineEdges.rightWorld);
  assert.equal(leftCrossed.worldWidth, structuredTextFrameModel.MIN_FRAME_WIDTH);
  const leftOverMaximum = structuredTextFrameModel.edgesForFrame(
    structuredTextFrameModel.updateBoundaryDrag(leftDrag, baselineEdges.rightWorld - 100000)
  );
  assert.equal(leftOverMaximum.rightWorld, baselineEdges.rightWorld);
  assert.equal(leftOverMaximum.worldWidth, structuredTextFrameModel.MAX_FRAME_WIDTH);

  const rightDrag = structuredTextFrameModel.beginBoundaryDrag(baseline, 'right');
  const rightCrossed = structuredTextFrameModel.edgesForFrame(
    structuredTextFrameModel.updateBoundaryDrag(rightDrag, baselineEdges.leftWorld - 1000)
  );
  assert.equal(rightCrossed.leftWorld, baselineEdges.leftWorld);
  assert.equal(rightCrossed.worldWidth, structuredTextFrameModel.MIN_FRAME_WIDTH);
  const rightOverMaximum = structuredTextFrameModel.edgesForFrame(
    structuredTextFrameModel.updateBoundaryDrag(rightDrag, baselineEdges.leftWorld + 100000)
  );
  assert.equal(rightOverMaximum.leftWorld, baselineEdges.leftWorld);
  assert.equal(rightOverMaximum.worldWidth, structuredTextFrameModel.MAX_FRAME_WIDTH);
});

test('legacy Tab-owned frame geometry and Markdown-only pane-resize latch are retired', async () => {
  const files = await Promise.all([
    'public/sessionTabs.js',
    'public/workspaceState.js',
    'public/js/workspaceState.js',
    'public/app.js',
    'public/js/canvasBlocks.js',
    'public/js/markdownPageView.js',
    'public/js/structuredTextPageShell.js'
  ].map(async (relativePath) => ({ relativePath, source: await read(relativePath) })));

  const legacyFrameState = /markdownFrame(?:OffsetX|Width|PreferredWidth|ConstraintSide)/;
  for (const { relativePath, source } of files) {
    assert.doesNotMatch(source, legacyFrameState, `${relativePath} retains legacy frame state`);
  }

  const app = files.find(({ relativePath }) => relativePath === 'public/app.js').source;
  const markdownView = files.find(
    ({ relativePath }) => relativePath === 'public/js/markdownPageView.js'
  ).source;
  assert.doesNotMatch(app, /beginPaneDividerMarkdownResize|endPaneDividerMarkdownResize|markdownResizeStages/);
  assert.doesNotMatch(markdownView, /beginMarkdownPaneResize|endMarkdownPaneResize|paneResizeOriginLeft/);
});

test('fresh structured-text fit derives camera X from the canonical Page-frame centre', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  const fitOwner = sourceBetween(
    canvas,
    'function fitStructuredTextCameraToFrame(frame, area, view)',
    'function writeCanvasTransform(runtime)'
  );
  const renderCanvas = sourceBetween(canvas, 'function renderCanvas(', 'function screenToWorld(');

  assert.match(fitOwner, /structuredTextFrameModel\??\.(?:normalizeTextFrame|edgesForFrame)/);
  assert.match(fitOwner, /centerWorldX/);
  assert.match(fitOwner, /view\.offsetX\s*=\s*[^;]*area\.clientWidth\s*\/\s*2[^;]*-[^;]*centerWorldX[^;]*view\.scale/);
  assert.match(renderCanvas, /fitStructuredTextCameraToFrame\(/);

  const frame = structuredTextFrameModel.normalizeTextFrame({
    centerWorldX: 135,
    preferredWidth: 900
  });
  const zoom = 1;
  const viewportWidth = 1200;
  const cameraX = (viewportWidth / 2) - (frame.centerWorldX * zoom);
  const projected = structuredTextFrameModel.projectFrame(frame, { cameraX, zoom });
  assert.equal((projected.leftScreen + projected.rightScreen) / 2, viewportWidth / 2);
});

test('one viewport policy adjusts only the existing Pane camera and uses its writer', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  const policyOwner = sourceBetween(
    canvas,
    'function applyStructuredTextViewportResize(runtime, state, nextViewport)',
    'function observeStructuredTextViewport(runtime,'
  );
  const observerOwner = sourceBetween(
    canvas,
    'function observeStructuredTextViewport(runtime,',
    'function fitStructuredTextCameraToFrame('
  );

  assert.match(policyOwner, /(?:structuredTextFrameModel|model)\.resolveViewportResize\(/);
  assert.match(policyOwner, /requestedScreenShiftX/);
  assert.match(policyOwner, /view\.offsetX\s*[+-]?=/);
  assert.doesNotMatch(policyOwner, /view\.(?:offsetY|scale)\s*=/);
  assert.match(policyOwner, /writeCanvasTransformFor\(/);
  assert.match(observerOwner, /applyStructuredTextViewportResize\(/);

  const result = structuredTextFrameModel.resolveViewportResize({
    oldViewport: { left: 0, right: 1000 },
    newViewport: { left: 0, right: 850 },
    projectedFrame: { left: 100, right: 900 },
    movingEdge: 'right'
  });
  assert.equal(result.applicable, true);
  assert.equal(result.requestedScreenShiftX, -50);
});

test('viewport bridge applies exact origin compensation and cannot cross a Tab owner', async () => {
  const harness = await structuredTextViewportHarness();
  const { api, area, areaGeometry, pane, runtime, saves, stage } = harness;
  let state = api.observeStructuredTextViewport(runtime, {
    stage,
    area,
    page: pane.viewContext.currentPage
  });

  area.clientWidth = 700;
  areaGeometry.width = 700;
  assert.equal(api.applyStructuredTextViewportResize(runtime, state, {
    left: 0,
    right: 700,
    localLeft: 0,
    localRight: 700,
    screenX: 0,
    windowOuterWidth: 900,
    windowInnerWidth: 700
  }), true);
  assert.equal(pane.viewContext.canvasView.offsetX, -100,
    'right shrink applies only the pure policy correction');
  assert.equal(saves.at(-1).tabId, 'tab_a');

  pane.viewContext.canvasView.offsetX = 0;
  area.clientWidth = 1000;
  areaGeometry.left = 0;
  areaGeometry.width = 1000;
  state.viewport = {
    left: 0,
    right: 1000,
    localLeft: 0,
    localRight: 1000,
    screenX: 0,
    windowOuterWidth: 1200,
    windowInnerWidth: 1000
  };
  area.clientWidth = 700;
  areaGeometry.left = 300;
  areaGeometry.width = 700;
  assert.equal(api.applyStructuredTextViewportResize(runtime, state, {
    left: 300,
    right: 1000,
    localLeft: 300,
    localRight: 1000,
    screenX: 0,
    windowOuterWidth: 900,
    windowInnerWidth: 700
  }), true);
  assert.equal(pane.viewContext.canvasView.offsetX, -200,
    'left shrink combines -300px origin compensation with +100px policy shift');

  const destinationTab = {
    id: 'tab_b',
    currentPageId: 'page_shared',
    viewState: { panX: 444, panY: 0, zoom: 1, viewportInitialized: true }
  };
  harness.setActiveTab(destinationTab);
  pane.viewContext.canvasView.offsetX = 444;
  const saveCount = saves.length;
  assert.equal(api.applyStructuredTextViewportResize(runtime, state, {
    left: 300,
    right: 900,
    localLeft: 300,
    localRight: 900,
    screenX: 0,
    windowOuterWidth: 800,
    windowInnerWidth: 600
  }), false);
  assert.equal(pane.viewContext.canvasView.offsetX, 444);
  assert.equal(saves.length, saveCount,
    'an old observer cannot persist its camera into the newly active Tab');
  state = api.observeStructuredTextViewport(runtime, {
    stage,
    area,
    page: pane.viewContext.currentPage
  });
  assert.equal(state.tabId, 'tab_b');
});

test('pure native-window movement rebases the snapshot before the next one-edge resize', async () => {
  const harness = await structuredTextViewportHarness();
  const { api, area, areaGeometry, context, pane, runtime, saves, stage } = harness;
  const state = api.observeStructuredTextViewport(runtime, {
    stage,
    area,
    page: pane.viewContext.currentPage
  });
  state.viewport = {
    left: 100,
    right: 1100,
    localLeft: 0,
    localRight: 1000,
    screenX: 100,
    windowOuterWidth: 1200,
    windowInnerWidth: 1000
  };
  context.screenX = 400;
  api.synchronizeStructuredTextViewportWindowPosition();
  api.synchronizeStructuredTextViewportWindowPosition();
  assert.equal(state.viewport.screenX, 100,
    'a move candidate cannot rebase before stable confirmation');
  api.synchronizeStructuredTextViewportWindowPosition();
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.viewport)),
    {
      left: 400,
      right: 1400,
      localLeft: 0,
      localRight: 1000,
      screenX: 400,
      windowOuterWidth: 1200,
      windowInnerWidth: 1000
    }
  );
  assert.equal(pane.viewContext.canvasView.offsetX, 0,
    'window movement changes neither camera nor Page frame');
  assert.equal(saves.length, 0);

  area.clientWidth = 700;
  areaGeometry.width = 700;
  context.outerWidth = 900;
  context.innerWidth = 700;
  assert.equal(api.applyStructuredTextViewportResize(runtime, state, {
    left: 400,
    right: 1100,
    localLeft: 0,
    localRight: 700,
    screenX: 400,
    windowOuterWidth: 900,
    windowInnerWidth: 700
  }), true);
  assert.equal(pane.viewContext.canvasView.offsetX, -100,
    'the first resize after movement is classified from the rebased right edge');
});

test('split screen-position then width delivery remains a left-edge resize', async () => {
  const harness = await structuredTextViewportHarness();
  const { api, area, areaGeometry, context, pane, runtime, saves, stage } = harness;
  const state = api.observeStructuredTextViewport(runtime, {
    stage,
    area,
    page: pane.viewContext.currentPage
  });
  state.viewport = {
    left: 100,
    right: 1100,
    localLeft: 0,
    localRight: 1000,
    screenX: 100,
    windowOuterWidth: 1200,
    windowInnerWidth: 1000
  };

  context.screenX = 200;
  api.synchronizeStructuredTextViewportWindowPosition();
  api.synchronizeStructuredTextViewportWindowPosition();
  assert.equal(state.viewport.screenX, 100,
    'screen position alone stays a cancellable move candidate');

  context.outerWidth = 1100;
  context.innerWidth = 900;
  area.clientWidth = 900;
  areaGeometry.width = 900;
  assert.equal(api.applyStructuredTextViewportResize(runtime, state, {
    left: 200,
    right: 1100,
    localLeft: 0,
    localRight: 900,
    screenX: 200,
    windowOuterWidth: 1100,
    windowInnerWidth: 900
  }), true);
  assert.equal(pane.viewContext.canvasView.offsetX, -100,
    'delayed width delivery is classified from the original left edge');
  assert.equal(saves.length, 1);
  assert.equal(state.pendingWindowMove, null,
    'the real resize cancels the pending pure-move candidate');
});

test('two Tabs for one Page retain independent camera state and no frame copy', () => {
  let nextId = 0;
  const session = createTabSession({ createId: () => `tab_${++nextId}` });
  const first = session.reset('page-shared');
  session.saveViewState(first.id, {
    ...defaultViewState(),
    panX: 120,
    panY: -35,
    zoom: 0.67,
    viewportInitialized: true
  });
  const second = session.createTab('page-shared');
  session.saveViewState(second.id, {
    ...defaultViewState(),
    panX: -420,
    panY: 88,
    zoom: 3,
    viewportInitialized: true
  });

  assert.deepEqual(
    {
      panX: session.tabById(first.id).viewState.panX,
      panY: session.tabById(first.id).viewState.panY,
      zoom: session.tabById(first.id).viewState.zoom
    },
    { panX: 120, panY: -35, zoom: 0.67 }
  );
  assert.deepEqual(
    {
      panX: session.tabById(second.id).viewState.panX,
      panY: session.tabById(second.id).viewState.panY,
      zoom: session.tabById(second.id).viewState.zoom
    },
    { panX: -420, panY: 88, zoom: 3 }
  );
  for (const tab of [session.tabById(first.id), session.tabById(second.id)]) {
    assert.deepEqual(
      Object.keys(tab.viewState).filter((key) => key.startsWith('markdownFrame')),
      []
    );
  }
});

test('Markdown and HN conversion preserves Tab camera state and never fits an inactive Pane', async () => {
  const app = await read('public/app.js');
  const conversion = sourceBetween(
    app,
    'async function convertCurrentPageType(runtime, targetType)',
    'async function createNewPage('
  );
  const captureIndex = conversion.indexOf('saveActiveTabViewState(runtime)');
  const activeRenderIndex = conversion.indexOf('renderPage(runtime, canonical');
  const restoreIndex = conversion.indexOf(
    'restoreActiveTabViewState(runtime)', activeRenderIndex
  );

  assert.ok(captureIndex >= 0 && captureIndex < activeRenderIndex);
  assert.ok(activeRenderIndex >= 0 && restoreIndex > activeRenderIndex);
  assert.match(conversion, /const ownerCurrent = runtimeOperationIsCurrent\(operation\);[^]*?commitCanonicalPage\(savedPage, \{\s*originRuntime: ownerCurrent \? runtime : null\s*\}\)/);
  assert.match(
    conversion,
    /if \(runtimeOperationIsCurrent\(operation\)\) \{[^]*?renderPage\(runtime, canonical, \{ installCanonical: false \}\)[^]*?restoreActiveTabViewState\(runtime\)/
  );
  assert.doesNotMatch(conversion, /renderPageIntoInactivePane/);
  assert.doesNotMatch(conversion, /fit:\s*true/);
  for (const cameraField of ['viewportInitialized', 'panX', 'panY', 'zoom']) {
    assert.doesNotMatch(
      conversion,
      new RegExp(`${cameraField}\\s*[:=]`),
      `conversion must not reset ${cameraField}`
    );
  }
  assert.doesNotMatch(conversion, /defaultViewState\(/);
});
