'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const textEditingModel = require('../public/textEditing');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this._className = '';
    this._isDocumentRoot = false;
    this.ownerDocument = null;
    this.textContent = '';
    this.contentEditable = 'inherit';
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.scrollHeight = 0;
    this.offsetHeight = 0;
    this.pointerCapture = new Set();
  }

  set className(value) {
    this._className = String(value);
    this.classList.values = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  get className() {
    return this._className;
  }

  get isConnected() {
    return this._isDocumentRoot || Boolean(this.parentElement?.isConnected);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof FakeElement)) continue;
      if (node.parentElement) {
        const previousIndex = node.parentElement.children.indexOf(node);
        if (previousIndex >= 0) node.parentElement.children.splice(previousIndex, 1);
      }
      node.parentElement = this;
      this.children.push(node);
    }
  }

  prepend(...nodes) {
    [...nodes].reverse().forEach((node) => {
      if (!(node instanceof FakeElement)) return;
      if (node.parentElement) {
        const previousIndex = node.parentElement.children.indexOf(node);
        if (previousIndex >= 0) node.parentElement.children.splice(previousIndex, 1);
      }
      node.parentElement = this;
      this.children.unshift(node);
    });
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'contenteditable') this.contentEditable = 'inherit';
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  get isContentEditable() {
    return this.contentEditable === 'true' || this.contentEditable === 'plaintext-only';
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  setPointerCapture(pointerId) {
    this.pointerCapture.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.pointerCapture.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.pointerCapture.delete(pointerId);
  }

  async dispatch(type, patch = {}) {
    const event = {
      type,
      target: this,
      key: '',
      keyCode: 0,
      isComposing: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...patch
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    return event;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null;
    return this.dispatch('blur');
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight
    };
  }

  closest(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    let current = this;
    while (current) {
      if (className && current.classList.contains(className)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    if (selector === ':scope > .canvas-stage') {
      return this.children.find((child) => child.classList.contains('canvas-stage')) || null;
    }
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    if (!className) return null;
    const queue = [...this.children];
    while (queue.length) {
      const node = queue.shift();
      if (node.classList.contains(className)) return node;
      queue.push(...node.children);
    }
    return null;
  }
}

function createHarness({ width = 1200, height = 800 } = {}) {
  const observers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnectCount = 0;
      observers.push(this);
    }

    observe(element) {
      this.observed.push(element);
    }

    disconnect() {
      this.disconnectCount += 1;
      this.observed = [];
    }
  }

  const selection = {
    ranges: [],
    removeAllRanges() { this.ranges = []; },
    addRange(range) { this.ranges.push(range); }
  };
  const document = {
    activeElement: null,
    body: null,
    createElement(tagName) {
      const created = new FakeElement(tagName);
      created.ownerDocument = document;
      return created;
    },
    createRange() {
      return {
        selected: null,
        collapsed: null,
        selectNodeContents(node) { this.selected = node; },
        collapse(value) { this.collapsed = value; }
      };
    }
  };
  const body = new FakeElement('body');
  body.ownerDocument = document;
  body._isDocumentRoot = true;
  document.body = body;
  const area = new FakeElement('div');
  area.ownerDocument = document;
  area.className = 'canvas-area';
  area.clientWidth = width;
  area.clientHeight = height;
  const stage = new FakeElement('div');
  stage.ownerDocument = document;
  stage.className = 'canvas-stage';
  area.append(stage);
  body.append(area);

  const context = {
    console,
    Element: FakeElement,
    ResizeObserver: FakeResizeObserver,
    document,
    textEditingModel,
    getSelection() { return selection; },
    getComputedStyle() {
      return { paddingBottom: '128px' };
    }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  const frameSource = fs.readFileSync(
    path.join(__dirname, '../public/structuredTextFrame.js'),
    'utf8'
  );
  const source = fs.readFileSync(
    path.join(__dirname, '../public/js/structuredTextPageShell.js'),
    'utf8'
  );
  vm.runInContext(frameSource, context, { filename: 'structuredTextFrame.js' });
  vm.runInContext(source, context, { filename: 'structuredTextPageShell.js' });
  return {
    shell: context.structuredTextPageShell,
    observers,
    body,
    area,
    stage,
    document,
    selection
  };
}

function mountIdentity(shell, stage, area, patch = {}) {
  return shell.mount({
    stage,
    area,
    pageId: 'page-1',
    paneId: 'pane-1',
    tabId: 'tab-1',
    offsetX: area.clientWidth / 2,
    textFrame: { centerWorldX: 0, preferredWidth: 760 },
    ...patch
  });
}

test('mount reuses one stable shell for the same Page/Pane/Tab identity', () => {
  const { shell, observers, area, stage } = createHarness();
  const first = mountIdentity(shell, stage, area);
  const second = mountIdentity(shell, stage, area, {
    textFrame: { centerWorldX: 140, preferredWidth: 900 },
    offsetX: 24
  });

  assert.strictEqual(second, first);
  assert.strictEqual(second.camera, first.camera);
  assert.strictEqual(second.surface, first.surface);
  assert.equal(second.boundary.children.length, 2,
    'the shared boundary owns one left and one right Page Edit handle');
  assert.equal(area.children.filter((node) => (
    node.classList.contains('structured-text-page-camera-layer')
  )).length, 1);
  assert.equal(observers.length, 1, 'same identity must not create a second observer/mount');
  assert.equal(second.frame.dataset.preferredWidth, '900');
  assert.equal(second.frame.dataset.centerWorldX, '140');
  assert.equal(second.frame.style.left, '-310px');
  assert.equal(second.camera.style.transform, 'translate3d(24px, 0px, 0)');
});

test('mount destroys the old shell before mounting a changed identity', () => {
  const { shell, observers, area, stage } = createHarness();
  const first = mountIdentity(shell, stage, area);
  const oldCamera = first.camera;
  const second = mountIdentity(shell, stage, area, { tabId: 'tab-2' });

  assert.notStrictEqual(second, first);
  assert.notStrictEqual(second.camera, oldCamera);
  assert.equal(oldCamera.parentElement, null);
  assert.equal(observers[0].disconnectCount, 1);
  assert.equal(observers.length, 2);
  assert.equal(second.frame.dataset.tabId, 'tab-2');
  assert.strictEqual(shell.mount({
    stage,
    area,
    pageId: 'page-1',
    paneId: 'pane-1',
    tabId: 'tab-2'
  }), second);
});

test('camera, zoom, and viewport updates never mutate canonical frame geometry', () => {
  const { shell, area, stage } = createHarness({ width: 1000 });
  const state = mountIdentity(shell, stage, area, {
    textFrame: { centerWorldX: 225, preferredWidth: 180 },
    scale: 1,
    offsetX: 5,
    offsetY: -7
  });

  assert.equal(state.frame.dataset.preferredWidth, '320', 'preferred width has a safe minimum');
  assert.equal(state.frame.dataset.worldWidth, '320');
  assert.equal(state.frame.dataset.centerWorldX, '225');
  assert.equal(state.frame.style.left, '65px');
  assert.equal(state.camera.style.transform, 'translate3d(5px, -7px, 0)');
  assert.equal(state.world.style.zoom, '1');

  assert.equal(shell.setTextFrame(stage, { preferredWidth: 5000 }), true);
  assert.equal(state.frame.dataset.preferredWidth, '2400', 'preferred width has a safe maximum');
  assert.equal(state.frame.dataset.worldWidth, '2400');
  assert.equal(state.frame.dataset.centerWorldX, '225',
    'a width-only merge preserves the canonical Page centre');

  assert.equal(shell.setCamera(stage, { scale: 2, offsetX: 30, offsetY: -45 }), true);
  assert.strictEqual(shell.mount({
    stage,
    area,
    pageId: 'page-1',
    paneId: 'pane-1',
    tabId: 'tab-1',
    scale: 2,
    offsetX: 30,
    offsetY: -45
  }), state);
  assert.equal(state.camera.style.transform, 'translate3d(30px, -45px, 0)');
  assert.equal(state.world.style.zoom, '2');
  assert.equal(state.frame.dataset.worldWidth, '2400');
  assert.equal(state.frame.dataset.centerWorldX, '225');
});

test('surface observation updates vertical extent but cannot compress or move the frame', () => {
  const { shell, observers, area, stage } = createHarness({ width: 1000 });
  const state = mountIdentity(shell, stage, area, {
    textFrame: { centerWorldX: 500, preferredWidth: 760 },
    scale: 3,
    offsetX: -1200
  });
  const before = shell.getDocumentBounds(stage);
  area.clientWidth = 180;
  observers[0].callback([{ target: area }]);
  const after = shell.getDocumentBounds(stage);

  assert.equal(observers[0].observed.includes(area), false,
    'the viewport is not a frame-geometry observer');
  assert.deepEqual(
    [after.centerWorldX, after.leftWorld, after.rightWorld, after.worldWidth],
    [before.centerWorldX, before.leftWorld, before.rightWorld, before.worldWidth]
  );
  assert.deepEqual([after.centerWorldX, after.leftWorld, after.rightWorld, after.worldWidth], [
    500, 120, 880, 760
  ]);
  assert.equal(state.frame.style.width, '760px');
});

test('document extent combines text documentBottom with Canvas Object bounds', () => {
  const { shell, area, stage } = createHarness({ width: 1200 });
  const notifications = [];
  const state = mountIdentity(shell, stage, area, {
    textFrame: { centerWorldX: 0, preferredWidth: 760 },
    objectBounds: { minX: -500, minY: -40, maxX: 900, maxY: 700 },
    onExtentChange: (extent) => notifications.push(extent)
  });

  assert.equal(shell.setDocumentContentBottom(state, 920), true);
  let bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.frameLeft, -380);
  assert.equal(bounds.frameRight, 380);
  assert.equal(bounds.left, -500);
  assert.equal(bounds.right, 900);
  assert.equal(bounds.contentBottom, 920);
  assert.equal(bounds.objectBottom, 700);
  assert.equal(bounds.bottom, 1048, 'text bottom plus 128 world-unit padding wins');
  assert.equal(state.extent.style.height, '1048px');
  assert.equal(state.frame.style.minHeight, '1048px');

  assert.equal(shell.setObjectBounds(stage, {
    minX: -100,
    minY: 0,
    maxX: 400,
    maxY: 1100
  }), true);
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.left, -380, 'text frame still contributes horizontal extent');
  assert.equal(bounds.right, 400);
  assert.equal(bounds.contentBottom, 920);
  assert.equal(bounds.objectBottom, 1100);
  assert.equal(bounds.bottom, 1228, 'lower Canvas Object extends documentBottom');
  assert.ok(notifications.length >= 2);

  state.surface.scrollHeight = 1400;
  assert.equal(shell.setDocumentContentBottom(state, null), true);
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.contentBottom, 1272,
    'null clears the explicit override and returns ownership to measured prose');
  assert.equal(bounds.bottom, 1400);
});

test('natural HN surface measurement grows and shrinks document extent without an explicit override', () => {
  const { shell, observers, area, stage } = createHarness({ width: 1200 });
  const state = mountIdentity(shell, stage, area);

  state.surface.scrollHeight = 1400;
  observers[0].callback([{ target: state.surface }]);
  let bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.contentBottom, 1272);
  assert.equal(bounds.bottom, 1400);
  assert.equal(state.extent.style.height, '1400px');

  state.surface.scrollHeight = 0;
  observers[0].callback([{ target: state.surface }]);
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.contentBottom, 352);
  assert.equal(bounds.bottom, 608, 'removed prose can shrink back to the document floor');
});

test('visual frame covers its owning Pane while semantic document bounds stay content-derived', () => {
  const { shell, observers, area, stage } = createHarness({ width: 1200, height: 800 });
  const state = mountIdentity(shell, stage, area);

  let bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.bottom, 608, 'semantic bottom remains the 480 + 128 document floor');
  assert.equal(bounds.visualFrameBottom, 800);
  assert.equal(bounds.viewportWorldBottom, 800);
  assert.equal(state.extent.style.height, '608px');
  assert.equal(state.frame.style.minHeight, '800px');

  assert.equal(shell.setCamera(stage, { scale: 0.5, offsetY: -40 }), true);
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.bottom, 608);
  assert.equal(bounds.viewportWorldBottom, 1680);
  assert.equal(bounds.visualFrameBottom, 1680);
  assert.equal(state.extent.style.height, '608px');
  assert.equal(state.frame.style.minHeight, '1680px');

  assert.equal(shell.setCamera(stage, { scale: 2, offsetY: 0 }), true);
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.bottom, 608);
  assert.equal(bounds.viewportWorldBottom, 400);
  assert.equal(bounds.visualFrameBottom, 608, 'semantic document wins when it is already taller');
  assert.equal(state.frame.style.minHeight, '608px');

  assert.equal(shell.setCamera(stage, { scale: 1, offsetY: 0 }), true);
  area.clientHeight = 1000;
  observers[0].callback();
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.bottom, 608);
  assert.equal(bounds.visualFrameBottom, 1000);
  assert.equal(state.frame.style.minHeight, '1000px');

  area.clientHeight = 500;
  observers[0].callback();
  bounds = shell.getDocumentBounds(stage);
  assert.equal(bounds.bottom, 608);
  assert.equal(bounds.visualFrameBottom, 608);
  assert.equal(state.frame.style.minHeight, '608px');
});

test('vertical clamp keeps short documents top-aligned and long documents within bounds', () => {
  const { shell } = createHarness();

  assert.ok(shell.clampVerticalOffset({
    offsetY: -200,
    scale: 1,
    viewportHeight: 800,
    documentTop: 0,
    documentBottom: 400
  }) === 0);

  assert.ok(shell.clampVerticalOffset({
    offsetY: 100,
    scale: 1,
    viewportHeight: 500,
    documentTop: 0,
    documentBottom: 1000
  }) === 0);
  assert.equal(shell.clampVerticalOffset({
    offsetY: -900,
    scale: 1,
    viewportHeight: 500,
    documentTop: 0,
    documentBottom: 1000
  }), -500);
  assert.equal(shell.clampVerticalOffset({
    offsetY: -350,
    scale: 2,
    viewportHeight: 300,
    documentTop: 100,
    documentBottom: 500
  }), -350);
});

test('bound Page titles share Markdown editing, commit, cancellation, and focus semantics', async () => {
  const { shell, area, stage, document, selection } = createHarness();
  const commits = [];
  const resolutions = [];
  const first = mountIdentity(shell, stage, area, {
    boundTitle: {
      page: { id: 'page-1', title: 'Alpha' },
      title: 'Alpha',
      editable: true,
      onCommit: async (detail) => {
        commits.push(detail);
        return { id: 'page-1', title: 'Canonical title' };
      },
      onResolvedTitle: (title) => resolutions.push(title)
    }
  });
  const secondStage = new FakeElement('div');
  secondStage.ownerDocument = document;
  secondStage.className = 'canvas-stage';
  area.append(secondStage);
  const second = shell.mount({
    stage: secondStage,
    area,
    pageId: 'page-1',
    paneId: 'pane-2',
    tabId: 'tab-2',
    textFrame: { centerWorldX: 0, preferredWidth: 760 },
    offsetX: area.clientWidth / 2,
    boundTitle: {
      page: { id: 'page-1', title: 'Alpha' },
      title: 'Alpha',
      editable: true
    }
  });

  assert.strictEqual(first.surface.children[0], first.title);
  assert.ok(first.title.classList.contains('structured-text-bound-title'));
  assert.ok(first.title.classList.contains('markdown-page-title'));
  assert.equal(first.title.textContent, 'Alpha');
  assert.equal(first.title.contentEditable, 'plaintext-only');
  assert.equal(first.title.getAttribute('role'), 'textbox');

  assert.equal(shell.focusBoundTitleForStage(stage, { selectAll: true }), true);
  assert.strictEqual(document.activeElement, first.title);
  assert.strictEqual(selection.ranges[0].selected, first.title);

  first.title.textContent = 'Discarded draft';
  const escape = await first.title.dispatch('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(first.title.textContent, 'Alpha');
  assert.equal(commits.length, 0, 'Escape never persists a Page title');

  first.title.focus();
  first.title.textContent = '  Beta\nTitle  ';
  await first.title.dispatch('input');
  assert.equal(first.title.textContent, '  Beta Title  ', 'title input remains one plaintext line');
  await first.title.blur();
  assert.equal(commits.length, 1);
  assert.equal(commits[0].pageId, 'page-1');
  assert.equal(commits[0].paneId, 'pane-1');
  assert.equal(commits[0].title, 'Beta Title');
  assert.equal(commits[0].previousTitle, 'Alpha');
  assert.equal(first.title.textContent, 'Canonical title');
  assert.equal(second.title.textContent, 'Canonical title',
    'all mounted Panes for the Page converge on the canonical title');
  assert.deepEqual(resolutions, ['Canonical title']);

  shell.updateBoundTitle(first.title, { editable: false });
  assert.equal(first.title.isContentEditable, false);
  assert.equal(first.title.getAttribute('aria-label'), null,
    'a read-only h1 exposes its actual Page title as the accessible name');
  assert.equal(shell.focusBoundTitle(first.title), false);
});

test('bound Page title IME Enter stays native and the next ordinary Enter commits once', async () => {
  for (const authoredText of ['你好', 'raw latin']) {
    const { shell, area, stage, document } = createHarness();
    const commits = [];
    const mounted = mountIdentity(shell, stage, area, {
      boundTitle: {
        page: { id: 'page-1', title: 'Alpha' },
        title: 'Alpha',
        editable: true,
        onCommit: async (detail) => {
          commits.push(detail);
          return { id: 'page-1', title: detail.title };
        }
      }
    });
    mounted.title.focus();
    mounted.title.textContent = authoredText;
    await mounted.title.dispatch('input');

    const imeEnter = await mounted.title.dispatch('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true
    });
    assert.equal(imeEnter.defaultPrevented, false);
    assert.equal(imeEnter.propagationStopped, false);
    assert.equal(commits.length, 0);
    assert.equal(mounted.title.textContent, authoredText);
    assert.strictEqual(document.activeElement, mounted.title);

    const ordinaryEnter = await mounted.title.dispatch('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false
    });
    await Promise.resolve();
    assert.equal(ordinaryEnter.defaultPrevented, true);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].title, authoredText);
  }
});

test('a slow title save never overwrites a newer refocused draft', async () => {
  const { shell, area, stage, document } = createHarness();
  let settleCommit;
  const commits = [];
  const first = mountIdentity(shell, stage, area, {
    boundTitle: {
      page: { id: 'page-1', title: 'Alpha' },
      title: 'Alpha',
      onCommit: (detail) => {
        commits.push(detail);
        return new Promise((resolve) => { settleCommit = resolve; });
      }
    }
  });
  const secondStage = new FakeElement('div');
  secondStage.ownerDocument = document;
  secondStage.className = 'canvas-stage';
  area.append(secondStage);
  const second = shell.mount({
    stage: secondStage,
    area,
    pageId: 'page-1',
    paneId: 'pane-2',
    tabId: 'tab-2',
    textFrame: { centerWorldX: 0, preferredWidth: 760 },
    offsetX: area.clientWidth / 2,
    boundTitle: { page: { id: 'page-1', title: 'Alpha' }, title: 'Alpha' }
  });

  first.title.focus();
  first.title.textContent = 'First save';
  const pendingBlur = first.title.blur();
  await Promise.resolve();
  assert.equal(commits.length, 1);
  first.title.focus();
  first.title.textContent = 'Newer draft';
  settleCommit({ id: 'page-1', title: 'Canonical first save' });
  await pendingBlur;

  assert.equal(first.title.textContent, 'Newer draft');
  assert.equal(second.title.textContent, 'Canonical first save');
  assert.strictEqual(document.activeElement, first.title);
});

test('shared frame boundary lifecycle keeps the opposite edge fixed and restores on cancel', async () => {
  const { shell } = createHarness();
  let frame = { centerWorldX: 100, preferredWidth: 760 };
  const inputs = [];
  const commits = [];
  const boundary = shell.createFrameBoundary({
    className: 'markdown-page-frame-boundary',
    handles: true,
    handleClassName: 'markdown-page-frame-handle',
    handleDatasetName: 'markdownFrameSide',
    frameEditor: {
      enabled: true,
      getFrame: () => frame,
      getZoom: () => 2,
      setFrame: (value) => { frame = value; },
      onInput: (value, detail) => inputs.push({ value, detail }),
      onCommit: (value, detail) => commits.push({ value, detail })
    }
  });

  assert.ok(boundary.classList.contains('structured-text-page-boundary'));
  assert.ok(boundary.classList.contains('markdown-page-frame-boundary'));
  assert.equal(boundary.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(boundary.children.map((handle) => handle.dataset.structuredTextFrameSide), [
    'left', 'right'
  ]);
  assert.deepEqual(boundary.children.map((handle) => handle.dataset.markdownFrameSide), [
    'left', 'right'
  ]);
  const right = boundary.children[1];
  await right.dispatch('pointerdown', { button: 0, pointerId: 7, clientX: 500 });
  await right.dispatch('pointermove', { pointerId: 7, clientX: 700 });
  assert.deepEqual([frame.centerWorldX, frame.preferredWidth], [150, 860]);
  assert.equal(shell.edgesForTextFrame(frame).leftWorld, -280,
    'right drag keeps the starting left boundary fixed');
  await right.dispatch('pointerup', { pointerId: 7, clientX: 700 });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].detail.side, 'right');
  assert.deepEqual([
    commits[0].detail.startFrame.centerWorldX,
    commits[0].detail.startFrame.preferredWidth
  ], [100, 760]);

  const committed = { ...frame };
  const left = boundary.children[0];
  await left.dispatch('pointerdown', { button: 0, pointerId: 8, clientX: 400 });
  await left.dispatch('pointermove', { pointerId: 8, clientX: 600 });
  assert.notDeepEqual(
    [frame.centerWorldX, frame.preferredWidth],
    [committed.centerWorldX, committed.preferredWidth]
  );
  await left.dispatch('pointercancel', { pointerId: 8, clientX: 600 });
  assert.deepEqual(
    [frame.centerWorldX, frame.preferredWidth],
    [committed.centerWorldX, committed.preferredWidth],
    'pointer cancellation restores the drag snapshot'
  );
  assert.equal(inputs.at(-1).detail.cancelled, true);
  assert.equal(commits.length, 1, 'a cancelled drag never commits');
});

test('Save settlement retires one active boundary gesture before later pointer events', async () => {
  const { shell, area } = createHarness();
  let interactionEnabled = true;
  let frame = { centerWorldX: 100, preferredWidth: 760 };
  const inputs = [];
  const commits = [];
  const boundary = shell.createFrameBoundary({
    frameEditor: {
      enabled: () => interactionEnabled,
      getFrame: () => frame,
      getZoom: () => 2,
      setFrame: (value) => { frame = value; },
      onInput: (value, detail) => {
        inputs.push({ value, detail });
        return true;
      },
      onCommit: (value, detail) => {
        commits.push({ value, detail });
        return true;
      }
    }
  });
  area.append(boundary);
  const right = boundary.children[1];

  await right.dispatch('pointerdown', { button: 0, pointerId: 21, clientX: 500 });
  await right.dispatch('pointermove', { pointerId: 21, clientX: 700 });
  const latestAccepted = { ...frame };
  const left = boundary.children[0];
  await left.dispatch('pointerdown', { button: 0, pointerId: 20, clientX: -300 });
  assert.equal(left.hasPointerCapture(20), false,
    'one boundary owns at most one active gesture');
  interactionEnabled = false;
  const settlement = shell.settleActiveBoundaryDragForSave(area);

  assert.equal(settlement.boundaryFound, true);
  assert.equal(settlement.settled, 1);
  assert.equal(settlement.changed, 1);
  assert.equal(settlement.committed, 1);
  assert.equal(settlement.accepted, true);
  assert.deepEqual([
    settlement.frame.centerWorldX,
    settlement.frame.preferredWidth
  ], [latestAccepted.centerWorldX, latestAccepted.preferredWidth]);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].detail.settlement, 'page-edit-save');
  assert.equal(commits[0].detail.cancelled, false);
  assert.equal(right.hasPointerCapture(21), false);

  await right.dispatch('pointermove', { pointerId: 21, clientX: 900 });
  await right.dispatch('pointerup', { pointerId: 21, clientX: 900 });
  await right.dispatch('pointercancel', { pointerId: 21, clientX: 900 });
  await right.dispatch('lostpointercapture', { pointerId: 21 });
  assert.deepEqual([
    frame.centerWorldX,
    frame.preferredWidth
  ], [latestAccepted.centerWorldX, latestAccepted.preferredWidth]);
  assert.equal(inputs.length, 1);
  assert.equal(commits.length, 1,
    'retired pointer completion cannot create a second commit');

  const repeated = shell.settleActiveBoundaryDragForSave(boundary);
  assert.equal(repeated.settled, 0);
  assert.equal(repeated.accepted, true, 'settlement is idempotent');

  await right.dispatch('pointerdown', { button: 0, pointerId: 22, clientX: 700 });
  await right.dispatch('pointermove', { pointerId: 22, clientX: 1000 });
  assert.equal(right.hasPointerCapture(22), false,
    'the dynamic Save fence rejects a new gesture');
  assert.deepEqual([
    frame.centerWorldX,
    frame.preferredWidth
  ], [latestAccepted.centerWorldX, latestAccepted.preferredWidth]);
  assert.equal(commits.length, 1);
});

test('lost pointer capture cancels an ordinary boundary gesture without a commit', async () => {
  const { shell } = createHarness();
  const start = { centerWorldX: 0, preferredWidth: 760 };
  let frame = { ...start };
  const commits = [];
  const boundary = shell.createFrameBoundary({
    frameEditor: {
      enabled: true,
      getFrame: () => frame,
      getZoom: () => 1,
      setFrame: (value) => { frame = value; },
      onInput: () => true,
      onCommit: (value) => {
        commits.push(value);
        return true;
      }
    }
  });
  const left = boundary.children[0];

  await left.dispatch('pointerdown', { button: 0, pointerId: 31, clientX: 100 });
  await left.dispatch('pointermove', { pointerId: 31, clientX: 0 });
  assert.notDeepEqual(frame, start);
  await left.dispatch('lostpointercapture', { pointerId: 31 });
  assert.deepEqual([
    frame.centerWorldX,
    frame.preferredWidth
  ], [start.centerWorldX, start.preferredWidth]);
  assert.equal(commits.length, 0);
  await left.dispatch('pointerup', { pointerId: 31 });
  assert.equal(commits.length, 0);
});

test('Save settlement fails closed when an unchanged frame cannot reach its draft owner', async () => {
  const { shell, area } = createHarness();
  const frame = { centerWorldX: 0, preferredWidth: 760 };
  const boundary = shell.createFrameBoundary({
    frameEditor: {
      enabled: true,
      getFrame: () => frame,
      getZoom: () => 1,
      setFrame: () => {},
      onInput: () => false,
      onCommit: () => {
        assert.fail('an unchanged gesture must not commit');
      }
    }
  });
  area.append(boundary);
  const right = boundary.children[1];
  await right.dispatch('pointerdown', { button: 0, pointerId: 32, clientX: 380 });

  const settlement = shell.settleActiveBoundaryDragForSave(area);
  assert.equal(settlement.settled, 1);
  assert.equal(settlement.changed, 0);
  assert.equal(settlement.committed, 0);
  assert.equal(settlement.accepted, false);
  assert.equal(right.hasPointerCapture(32), false);

  await right.dispatch('pointerup', { pointerId: 32, clientX: 380 });
  assert.equal(shell.settleActiveBoundaryDragForSave(area).settled, 0,
    'a rejected Save settlement still retires its pointer lifecycle exactly once');
});

test('pointer ownership is frame-scoped and destroy disconnects and clears the stage', () => {
  const { shell, observers, area, stage } = createHarness();
  const state = mountIdentity(shell, stage, area);
  const editorChild = new FakeElement('span');
  state.surface.append(editorChild);
  const outside = new FakeElement('button');
  area.append(outside);

  assert.equal(shell.ownsPointer(editorChild), true);
  assert.equal(shell.ownsPointer(state.frame), true);
  assert.equal(shell.ownsPointer(outside), false);
  assert.equal(shell.ownsPointer(null), false);

  assert.equal(shell.destroy(editorChild), true, 'descendant resolution reaches its stage state');
  assert.equal(observers[0].disconnectCount, 1);
  assert.equal(state.camera.parentElement, null);
  assert.equal(shell.getDocumentBounds(stage), null);
  assert.equal(shell.setCamera(stage, { offsetX: 1 }), false);
  assert.equal(shell.destroy(stage), false);
});
