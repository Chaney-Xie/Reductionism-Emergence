const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const sidebarResizeModel = require('../public/sidebarResize');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.capturedPointer = null;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
  hasPointerCapture(pointerId) { return this.capturedPointer === pointerId; }
  releasePointerCapture(pointerId) {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }
  dispatch(type, values = {}) {
    const event = {
      button: 0,
      clientX: 0,
      pointerId: 1,
      preventDefault() {},
      currentTarget: this,
      ...values
    };
    this.listeners.get(type)?.(event);
    return event;
  }
}

async function resizeHarness() {
  const source = await read('public/js/sidebarResize.js');
  const leftHandle = new FakeTarget();
  const rightHandle = new FakeTarget();
  const body = { classList: new FakeClassList(), dataset: {} };
  const rootStyle = new Map();
  const documentElement = {
    clientWidth: 1200,
    style: { setProperty: (name, value) => rootStyle.set(name, value) }
  };
  const windowTarget = new FakeTarget();
  windowTarget.innerWidth = 1200;
  let leftCloseCount = 0;
  let rightCloseCount = 0;
  const context = {
    sidebarResizeModel,
    document: {
      body,
      documentElement,
      querySelector(selector) {
        if (selector === '#left-sidebar-resize-handle') return leftHandle;
        if (selector === '#right-sidebar-resize-handle') return rightHandle;
        return null;
      }
    },
    window: windowTarget,
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    leftSidebarExpandedWidth: sidebarResizeModel.DEFAULT_EXPANDED_WIDTH,
    rightSidebarExpandedWidth: sidebarResizeModel.DEFAULT_EXPANDED_WIDTH,
    setLeftSidebarOpen(open) {
      context.leftSidebarOpen = open;
      if (!open) leftCloseCount += 1;
    },
    setRightSidebarOpen(open) {
      context.rightSidebarOpen = open;
      if (!open) rightCloseCount += 1;
    }
  };

  vm.runInNewContext(`${source}\nglobalThis.sidebarResizeTestApi = {
    applySidebarExpandedWidth,
    enableSidebarMotionAfterRestore,
    reconcileSidebarWidthsToViewport,
    restoreSidebarExpandedWidth,
    sidebarRememberedWidth
  };`, context);

  return {
    api: context.sidebarResizeTestApi,
    body,
    context,
    leftHandle,
    rightHandle,
    rootStyle,
    windowTarget,
    closeCounts: () => ({ left: leftCloseCount, right: rightCloseCount })
  };
}

test('both sidebars share the accepted 220px default and minimum width', () => {
  assert.equal(sidebarResizeModel.DEFAULT_EXPANDED_WIDTH, 220);
  assert.equal(sidebarResizeModel.MIN_EXPANDED_WIDTH, sidebarResizeModel.DEFAULT_EXPANDED_WIDTH);
  assert.equal(sidebarResizeModel.clampExpandedWidth(100, {
    viewportWidth: 1200,
    otherSidebarWidth: 220
  }), 220);
  assert.equal(sidebarResizeModel.clampExpandedWidth(900, {
    viewportWidth: 1200,
    otherSidebarWidth: 220
  }), 660);
});

test('pointer widths are symmetric and collapse is reserved for the actual window edge', () => {
  assert.equal(sidebarResizeModel.pointerWidth('left', 340, 1200), 340);
  assert.equal(sidebarResizeModel.pointerWidth('right', 860, 1200), 340);
  assert.equal(sidebarResizeModel.pointerReachedOuterEdge('left', 29, 1200), false);
  assert.equal(sidebarResizeModel.pointerReachedOuterEdge('left', 28, 1200), true);
  assert.equal(sidebarResizeModel.pointerReachedOuterEdge('right', 1171, 1200), false);
  assert.equal(sidebarResizeModel.pointerReachedOuterEdge('right', 1172, 1200), true);
});

test('left drag resizes continuously, clamps at minimum, then uses the existing collapse state at the edge', async () => {
  const harness = await resizeHarness();
  harness.leftHandle.dispatch('pointerdown', { clientX: 220, pointerId: 7 });
  assert.equal(harness.body.classList.contains('sidebar-horizontal-resizing'), true);
  assert.equal(harness.body.dataset.sidebarResizeSide, 'left');

  harness.windowTarget.dispatch('pointermove', { clientX: 400, pointerId: 7 });
  assert.equal(harness.rootStyle.get('--left-sidebar-width'), '400px');
  assert.equal(harness.context.leftSidebarOpen, true);

  harness.windowTarget.dispatch('pointermove', { clientX: 100, pointerId: 7 });
  assert.equal(harness.rootStyle.get('--left-sidebar-width'), '220px');
  assert.equal(harness.context.leftSidebarOpen, true);

  harness.windowTarget.dispatch('pointermove', { clientX: 20, pointerId: 7 });
  assert.equal(harness.context.leftSidebarOpen, false);
  assert.deepEqual(harness.closeCounts(), { left: 1, right: 0 });
  assert.equal(harness.body.classList.contains('sidebar-horizontal-resizing'), false);
  assert.equal(harness.body.dataset.sidebarResizeSide, undefined);
  assert.equal(harness.leftHandle.capturedPointer, null);
  assert.equal(harness.api.sidebarRememberedWidth('left'), 220);
});

test('right drag is independent and reopening restores its remembered width', async () => {
  const harness = await resizeHarness();
  harness.rightHandle.dispatch('pointerdown', { clientX: 980, pointerId: 11 });
  harness.windowTarget.dispatch('pointermove', { clientX: 850, pointerId: 11 });
  harness.windowTarget.dispatch('pointerup', { clientX: 850, pointerId: 11 });

  assert.equal(harness.rootStyle.get('--right-sidebar-width'), '350px');
  assert.equal(harness.rootStyle.get('--left-sidebar-width'), '220px');
  assert.equal(harness.api.sidebarRememberedWidth('right'), 350);

  harness.context.rightSidebarOpen = false;
  harness.context.rightSidebarOpen = true;
  harness.api.restoreSidebarExpandedWidth('right');
  assert.equal(harness.rootStyle.get('--right-sidebar-width'), '350px');
});

test('resize handles reuse invisible canvas boundaries and do not invoke canvas reset paths', async () => {
  const [html, css, ui] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css'),
    read('public/js/sidebarResize.js')
  ]);

  assert.match(html, /id="left-sidebar-resize-handle"[^>]*role="separator"/);
  assert.match(html, /id="right-sidebar-resize-handle"[^>]*role="separator"/);
  assert.match(css, /--sidebar-default-width: 220px;[\s\S]*?--left-sidebar-width: var\(--sidebar-default-width\);[\s\S]*?--right-sidebar-width: var\(--sidebar-default-width\);/);
  assert.match(css, /\.sidebar-resize-handle \{[^}]*width: 9px;[^}]*background: transparent;[^}]*cursor: col-resize;/);
  assert.doesNotMatch(css, /\.sidebar-resize-handle \{[^}]*(?:border|box-shadow):/);
  assert.doesNotMatch(ui, /fitCenter|fitPage|resetCanvas|canvasView|renderPage/);
});

test('startup arms motion only after restored geometry and viewport changes reclamp live endpoints', async () => {
  const harness = await resizeHarness();
  assert.equal(harness.body.classList.contains('sidebar-motion-ready'), false);
  harness.api.enableSidebarMotionAfterRestore();
  assert.equal(harness.body.classList.contains('sidebar-motion-ready'), true);

  harness.context.leftSidebarExpandedWidth = 500;
  harness.context.rightSidebarExpandedWidth = 500;
  harness.windowTarget.innerWidth = 900;
  harness.context.document.documentElement.clientWidth = 900;
  harness.windowTarget.dispatch('resize');

  assert.equal(harness.body.classList.contains('sidebar-viewport-reconciling'), false);
  assert.equal(harness.api.sidebarRememberedWidth('left'), 220);
  assert.equal(harness.api.sidebarRememberedWidth('right'), 360);
  assert.equal(harness.rootStyle.get('--left-sidebar-width'), '220px');
  assert.equal(harness.rootStyle.get('--right-sidebar-width'), '360px');
});
