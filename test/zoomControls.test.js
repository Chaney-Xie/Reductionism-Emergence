const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const vm = require('node:vm');
const zoomControls = require('../public/zoomControls');

test('zoom controls validate defaults and multiply continuous wheel/gesture response', () => {
  assert.equal(zoomControls.normalizeZoomSensitivity(undefined), 1);
  assert.equal(zoomControls.normalizeZoomSensitivity('2'), 1);
  assert.equal(zoomControls.normalizeZoomSensitivity(0.49), 1);
  assert.equal(zoomControls.normalizeZoomSensitivity(5.01), 1);
  assert.equal(zoomControls.formatZoomSensitivity(1), '1.0×');

  const normal = zoomControls.wheelZoomFactor(-100, 1, 1);
  const high = zoomControls.wheelZoomFactor(-100, 1, 4);
  assert.ok(high > normal);
  assert.ok(normal > 1);
  assert.equal(zoomControls.gestureZoomFactor(1.2, 1), 1.2);
  assert.ok(zoomControls.gestureZoomFactor(1.2, 4) > 1.2);
});

async function canvasHarness() {
  const source = await fs.readFile(path.join(__dirname, '../public/js/canvasBlocks.js'), 'utf8');
  const markdownUpdates = [];
  const canvasArea = {
    clientHeight: 600,
    dataset: {},
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 })
  };
  const canvasStage = { style: {} };
  const runtime = {
    paneId: 'pane_zoom',
    runtimeId: 'runtime_zoom',
    lifecycleEpoch: 1,
    disposed: false,
    currentPage: { id: 'page_zoom', type: 'canvas', blocks: [], objects: [{}] },
    canvasObjects: [{}],
    canvasBounds: null,
    canvasView: { scale: 1, offsetX: 0, offsetY: 0 },
    canvasImageResolutionTimer: null,
    dom: { canvasArea, canvasStage },
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
    }
  };
  const context = {
    MIN_CANVAS_SCALE: 0.1,
    MAX_CANVAS_SCALE: 6,
    zoomControls,
    zoomSensitivity: 1,
    runtime,
    runtimeIsLive: (candidate) => candidate === runtime && !runtime.disposed,
    activePaneRuntime: () => runtime,
    livingPaneRuntimes: () => [runtime],
    refreshMarkdownControlStrip: () => {},
    refreshHnTextControlStrip: () => {},
    updateMarkdownPageLayer: (stage, patch) => markdownUpdates.push({ stage, patch })
  };
  vm.runInNewContext(`${source}\nglobalThis.zoomTestApi = {
    clampCanvasScale,
    handleCanvasWheel,
    zoomAtPoint
  };`, context);
  return { context, source, api: context.zoomTestApi, markdownUpdates, runtime };
}

function wheelEvent(overrides = {}) {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    clientX: 300,
    clientY: 250,
    preventDefault() {},
    ...overrides
  };
}

test('canvas sensitivity changes zoom only while preserving pan, pointer anchoring, and bounds', async () => {
  const { context, api, source, markdownUpdates, runtime } = await canvasHarness();

  context.zoomSensitivity = 1;
  api.handleCanvasWheel(runtime, wheelEvent({ deltaY: -100, ctrlKey: true }));
  const normalScale = runtime.canvasView.scale;
  runtime.canvasView = { scale: 1, offsetX: 0, offsetY: 0 };
  context.zoomSensitivity = 4;
  api.handleCanvasWheel(runtime, wheelEvent({ deltaY: -100, ctrlKey: true }));
  assert.ok(runtime.canvasView.scale > normalScale);

  runtime.canvasView = { scale: 1, offsetX: 50, offsetY: 60 };
  context.zoomSensitivity = 0.5;
  api.handleCanvasWheel(runtime, wheelEvent({ deltaX: 5, deltaY: 7 }));
  const lowPan = { ...runtime.canvasView };
  runtime.canvasView = { scale: 1, offsetX: 50, offsetY: 60 };
  context.zoomSensitivity = 5;
  api.handleCanvasWheel(runtime, wheelEvent({ deltaX: 5, deltaY: 7 }));
  assert.deepEqual({ ...runtime.canvasView }, lowPan);
  assert.deepEqual(lowPan, { scale: 1, offsetX: 45, offsetY: 53 });

  runtime.canvasView = { scale: 2, offsetX: 10, offsetY: 20 };
  const pointX = 300 - 100;
  const pointY = 250 - 50;
  const worldBefore = {
    x: (pointX - runtime.canvasView.offsetX) / runtime.canvasView.scale,
    y: (pointY - runtime.canvasView.offsetY) / runtime.canvasView.scale
  };
  api.zoomAtPoint(runtime, 300, 250, 4);
  const worldAfter = {
    x: (pointX - runtime.canvasView.offsetX) / runtime.canvasView.scale,
    y: (pointY - runtime.canvasView.offsetY) / runtime.canvasView.scale
  };
  assert.deepEqual(worldAfter, worldBefore);
  assert.equal(markdownUpdates.at(-1).stage, runtime.dom.canvasStage);
  assert.equal(markdownUpdates.at(-1).patch.zoom, runtime.canvasView.scale);
  assert.equal(markdownUpdates.at(-1).patch.cameraOffsetX, runtime.canvasView.offsetX);
  assert.equal(markdownUpdates.at(-1).patch.cameraOffsetY, runtime.canvasView.offsetY);
  assert.equal(api.clampCanvasScale(100), 6);
  assert.equal(api.clampCanvasScale(0.001), 0.1);
  assert.match(source, /zoomControls\.wheelZoomFactor/);
});

test('every continuous Page zoom frame immediately updates the Markdown presentation camera', async () => {
  const { api, markdownUpdates, runtime } = await canvasHarness();
  const pointer = { clientX: 420, clientY: 310, ctrlKey: true };

  for (const deltaY of [-17, -29, 11, -43, 7]) {
    const callsBefore = markdownUpdates.length;
    api.handleCanvasWheel(runtime, wheelEvent({ ...pointer, deltaY }));
    assert.equal(markdownUpdates.length, callsBefore + 1);
    assert.equal(markdownUpdates.at(-1).stage, runtime.dom.canvasStage);
    assert.equal(markdownUpdates.at(-1).patch.zoom, runtime.canvasView.scale);
    assert.equal(markdownUpdates.at(-1).patch.cameraOffsetX, runtime.canvasView.offsetX);
    assert.equal(markdownUpdates.at(-1).patch.cameraOffsetY, runtime.canvasView.offsetY);
  }
});
