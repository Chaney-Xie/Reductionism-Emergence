'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  contains(name) { return this.values.has(name); }
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
    this.textContent = '';
  }

  set className(value) {
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() { return [...this.classList.values].join(' '); }

  append(...nodes) {
    nodes.forEach((node) => {
      if (!(node instanceof FakeElement)) return;
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    });
  }

  replaceChildren(...nodes) {
    this.children.forEach((node) => { node.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  contains(target) {
    for (let current = target; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (selector.startsWith('.') && current.classList.contains(selector.slice(1))) return current;
    }
    return null;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, patch = {}) {
    const event = { type, target: this, ...patch };
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  }
}

function createSession(source = 'Alpha', options = {}) {
  let snapshot = Object.freeze({
    pageId: options.pageId || 'page-cne',
    schemaVersion: 3,
    revision: options.revision || 0,
    source: options.migrationFailure ? null : source,
    anchors: Object.freeze({}),
    sourceVersion: options.sourceVersion || 1,
    readOnly: options.readOnly === true || Boolean(options.migrationFailure),
    migrationFailure: options.migrationFailure || null
  });
  return {
    revision: snapshot.revision,
    focusedViewId: null,
    subscriberCount: 1,
    referenceCount: 1,
    mountEpoch: 1,
    saveStatus: { dirty: false, readOnly: snapshot.readOnly },
    currentSnapshot() { return snapshot; },
    setSnapshot(value) { snapshot = Object.freeze({ ...snapshot, ...value }); },
    diagnostics() {
      return {
        revision: this.revision,
        subscriberCount: this.subscriberCount,
        referenceCount: this.referenceCount,
        mountEpoch: this.mountEpoch,
        saveStatus: this.saveStatus
      };
    }
  };
}

function createHarness() {
  const controllers = [];
  const presentationStrategies = [];
  const paneStates = [];
  const document = { createElement: (tagName) => new FakeElement(tagName) };
  const shellCalls = {
    mount: [], title: [], camera: [], textFrame: [], pageEditMode: [],
    objectBounds: [], bounds: [], ownsPointer: [], destroy: []
  };
  const shellStates = new WeakMap();
  const shell = {
    mount(options) {
      shellCalls.mount.push(options);
      let state = shellStates.get(options.stage);
      if (!state) {
        const title = new FakeElement('h1');
        title.className = 'structured-text-bound-title markdown-page-title';
        const surface = new FakeElement('article');
        surface.append(title);
        options.area.append(surface);
        state = { surface, title };
        shellStates.set(options.stage, state);
      }
      this.updateBoundTitle(state.title, options.boundTitle);
      return state;
    },
    updateBoundTitle(title, patch = {}) {
      shellCalls.title.push({ title, patch });
      if (Object.hasOwn(patch, 'title')) title.textContent = patch.title || 'Untitled';
      else if (typeof patch.page?.title === 'string') title.textContent = patch.page.title;
      title.contentEditable = patch.editable === false ? 'inherit' : 'plaintext-only';
      return title;
    },
    setCamera(target, patch) { shellCalls.camera.push({ target, patch }); return true; },
    setTextFrame(target, value) { shellCalls.textFrame.push({ target, value }); return true; },
    setPageEditMode(target, value) {
      shellCalls.pageEditMode.push({ target, value }); return true;
    },
    setObjectBounds(target, value) {
      shellCalls.objectBounds.push({ target, value }); return true;
    },
    getDocumentBounds(target) {
      shellCalls.bounds.push(target);
      return { left: -380, top: 0, right: 380, bottom: 900 };
    },
    ownsPointer(target) { shellCalls.ownsPointer.push(target); return Boolean(target?.shellOwned); },
    destroy(target) {
      shellCalls.destroy.push(target);
      shellStates.get(target)?.surface.remove();
      shellStates.delete(target);
      return true;
    }
  };

  const sourceCanonicalEditor = {
    normalizeMode: (value) => value === 'browser' ? 'browser' : 'edit',
    createHnBasicPresentationStrategy() {
      const strategy = Object.freeze({
        kind: 'hn-basic-markdown-compatible',
        sequence: presentationStrategies.length + 1
      });
      presentationStrategies.push(strategy);
      return strategy;
    },
    createSourceCanonicalEditor(options) {
      const record = {
        options,
        mode: options.mode,
        pageEditMode: options.pageEditMode,
        destroyed: false,
        ownsFocusValue: false,
        selection: { anchor: 1, focus: 4 },
        calls: { mode: [], pageEdit: [], refresh: 0, capture: 0, reassert: 0, commit: 0 },
        capabilities() {
          const snapshot = options.session.currentSnapshot();
          const sessionReadOnly = snapshot.readOnly === true
            || options.session.saveStatus?.readOnly === true;
          const canEdit = this.mode === 'edit' && !this.pageEditMode
            && !sessionReadOnly && typeof snapshot.source === 'string';
          return {
            mode: this.mode,
            canEdit,
            canNavigateAnchors: this.mode === 'browser',
            canSelect: true,
            canCopy: true,
            readOnly: !canEdit,
            sessionReadOnly,
            pageEditMode: this.pageEditMode
          };
        },
        applyCapabilities() {
          const capabilities = this.capabilities();
          options.root.setAttribute('contenteditable', capabilities.canEdit ? 'true' : 'false');
          options.root.dataset.hnCanEdit = String(capabilities.canEdit);
          options.root.dataset.hnCanNavigateAnchors = String(capabilities.canNavigateAnchors);
        },
        setMode(mode, patch = {}) {
          this.calls.mode.push({ mode, patch });
          this.mode = mode === 'browser' ? 'browser' : 'edit';
          if (Object.hasOwn(patch, 'pageEditMode')) this.pageEditMode = Boolean(patch.pageEditMode);
          this.applyCapabilities();
          return this.capabilities();
        },
        setPageEditMode(value) {
          this.calls.pageEdit.push(Boolean(value));
          this.pageEditMode = Boolean(value);
          this.applyCapabilities();
          return this.capabilities();
        },
        refresh() {
          this.calls.refresh += 1;
          options.onSnapshot(options.session.currentSnapshot(), { reason: 'refresh' });
          this.applyCapabilities();
          return options.session.currentSnapshot();
        },
        captureSelection() { this.calls.capture += 1; return this.selection; },
        reassertSelection() { this.calls.reassert += 1; return this.selection.anchor !== this.selection.focus; },
        commit() { this.calls.commit += 1; return true; },
        ownsFocus() { return this.ownsFocusValue; },
        diagnostics() {
          const snapshot = options.session.currentSnapshot();
          return {
            capabilities: this.capabilities(),
            sourceVersion: snapshot.sourceVersion,
            sourceLength: typeof snapshot.source === 'string' ? snapshot.source.length : 0,
            selection: this.selection,
            migrationFailure: snapshot.migrationFailure,
            transactionCount: 0,
            compositionCount: 0,
            destroyed: this.destroyed
          };
        },
        destroy() { this.destroyed = true; return true; }
      };
      record.applyCapabilities();
      controllers.push(record);
      options.onSnapshot(options.session.currentSnapshot(), { reason: 'subscribe' });
      return record;
    }
  };

  const context = {
    console,
    document,
    Element: FakeElement,
    structuredTextPageShell: shell,
    sourceCanonicalEditor,
    hnPageDocumentSessionModel: {
      createPaneLocalState() {
        const state = {
          selection: { anchor: 0, focus: 0, anchorAffinity: 'after', focusAffinity: 'after' },
          focused: false,
          camera: {}
        };
        paneStates.push(state);
        return state;
      }
    }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../public/js/hnTextPageView.js'), 'utf8'
  ), context, { filename: 'hnTextPageView.js' });

  const area = new FakeElement('div');
  area.className = 'canvas-area';
  const stage = new FakeElement('div');
  stage.className = 'canvas-stage';
  area.append(stage);
  return { context, pageView: context.hnTextPageView, shell, shellCalls,
    controllers, presentationStrategies, paneStates, area, stage };
}

function page(id = 'page-cne', source = 'Alpha') {
  return {
    id,
    title: 'HN Page',
    type: 'cne-text',
    textFrame: { centerWorldX: 120, preferredWidth: 840 },
    cneText: { schemaVersion: 3, revision: 0, source, anchors: {} }
  };
}

function renderOptions(harness, session, patch = {}) {
  return {
    page: page(),
    stage: harness.stage,
    area: harness.area,
    paneId: 'pane-a',
    tabId: 'tab-a',
    zoom: 1.1,
    cameraOffsetX: 12,
    cameraOffsetY: -30,
    objectBounds: { minX: -10, minY: 0, maxX: 20, maxY: 40 },
    session,
    ...patch
  };
}

test('one Pane identity keeps one source controller and canonical snapshots publish without DOM authority', () => {
  const harness = createHarness();
  const session = createSession('Alpha');
  const states = [];
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session, {
    onDocumentState: (value) => states.push(value)
  }));
  const same = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session, {
    mode: 'browser',
    onDocumentState: (value) => states.push(value)
  }));

  assert.equal(same, layer);
  assert.equal(harness.controllers.length, 1);
  assert.equal(harness.controllers[0].mode, 'browser');
  assert.ok(harness.controllers[0].calls.refresh >= 1);
  assert.equal(states.at(-1).source, 'Alpha');
  assert.equal(states.at(-1).schemaVersion, 3);
  assert.equal(Object.hasOwn(states.at(-1), 'document'), false);
});

test('one HN presentation strategy stays bound to one controller and session across mode switches and same-identity rerender', () => {
  const harness = createHarness();
  const session = createSession('**Exact** source');
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session, {
    mode: 'edit'
  }));
  const controller = harness.controllers[0];
  const strategy = harness.presentationStrategies[0];

  assert.equal(harness.presentationStrategies.length, 1);
  assert.equal(harness.controllers.length, 1);
  assert.equal(controller.options.presentationStrategy, strategy);
  assert.equal(controller.options.session, session);

  harness.pageView.updateHnTextPageLayer(layer, { mode: 'browser' });
  harness.pageView.updateHnTextPageLayer(layer, { mode: 'edit' });
  const same = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session, {
    mode: 'browser'
  }));

  assert.equal(same, layer);
  assert.equal(harness.presentationStrategies.length, 1);
  assert.equal(harness.controllers.length, 1);
  assert.equal(harness.controllers[0], controller);
  assert.equal(controller.options.presentationStrategy, strategy);
  assert.equal(controller.options.session, session);
  assert.deepEqual(controller.calls.mode.map((call) => call.mode), [
    'browser',
    'edit',
    'browser'
  ]);
  assert.equal(controller.destroyed, false);
});

test('Edit and Browser switch body capabilities without changing title, frame, camera, or session identity', () => {
  const harness = createHarness();
  const session = createSession('Exact source');
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session));
  const controller = harness.controllers[0];
  const title = layer.parentElement.children[0];
  const sourceBefore = session.currentSnapshot().source;

  assert.equal(layer.dataset.hnMode, 'edit');
  assert.equal(controller.options.root.getAttribute('contenteditable'), 'true');
  assert.equal(title.contentEditable, 'plaintext-only');

  harness.pageView.updateHnTextPageLayer(layer, { mode: 'browser' });
  assert.equal(layer.dataset.hnMode, 'browser');
  assert.equal(controller.options.root.getAttribute('contenteditable'), 'false');
  assert.equal(layer.dataset.hnCanNavigateAnchors, 'true');
  assert.equal(title.contentEditable, 'plaintext-only', 'Browser locks only the body');
  assert.equal(session.currentSnapshot().source, sourceBefore);
  assert.equal(harness.controllers.length, 1);

  harness.pageView.updateHnTextPageLayer(layer, { pageEditMode: true });
  assert.equal(title.contentEditable, 'inherit');
  assert.equal(layer.dataset.hnPageEditMode, 'true');
  assert.equal(session.currentSnapshot().source, sourceBefore);
  assert.equal(harness.shellCalls.camera.length, 0);
  assert.equal(harness.shellCalls.textFrame.length, 0);
});

test('explicit commit settles the focused controller and target-specific conversion boundary', () => {
  const harness = createHarness();
  const session = createSession('Alpha');
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session));
  const controller = harness.controllers[0];

  assert.equal(harness.pageView.commitFocusedHnTextEditor(layer), true);
  assert.equal(controller.calls.commit, 1);
  controller.ownsFocusValue = true;
  assert.equal(harness.pageView.commitFocusedHnTextEditor(), true);
  assert.equal(controller.calls.commit, 2);
  assert.equal(harness.pageView.commitFocusedHnTextEditor(new FakeElement()), false);
});

test('selection capture and reassertion remain Pane-local and require focused session ownership', () => {
  const harness = createHarness();
  const session = createSession('Alpha');
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session));
  const controller = harness.controllers[0];

  assert.equal(harness.pageView.captureHnTextSelection(layer), false);
  session.focusedViewId = controller.options.viewId;
  assert.equal(harness.pageView.captureHnTextSelection(layer), true);
  assert.equal(harness.pageView.reassertHnTextSelection(layer), true);
  assert.equal(controller.calls.capture, 1);
  assert.equal(controller.calls.reassert, 1);
  controller.selection = { anchor: 2, focus: 2 };
  assert.equal(harness.pageView.reassertHnTextSelection(layer), false);
});

test('identity change destroys the old source controller and shell before mounting the successor', () => {
  const harness = createHarness();
  const firstSession = createSession('One');
  const first = harness.pageView.renderHnTextPageLayer(renderOptions(harness, firstSession));
  const firstController = harness.controllers[0];
  const secondSession = createSession('Two', { pageId: 'page-two' });
  const second = harness.pageView.renderHnTextPageLayer(renderOptions(harness, secondSession, {
    page: page('page-two', 'Two'),
    tabId: 'tab-two'
  }));

  assert.notEqual(second, first);
  assert.equal(firstController.destroyed, true);
  assert.equal(harness.shellCalls.destroy.length, 1);
  assert.equal(harness.controllers.length, 2);
  assert.equal(harness.pageView.diagnostics(second).pageId, 'page-two');
});

test('migration failure is published read-only without manufacturing an empty source document', () => {
  const harness = createHarness();
  const migrationFailure = {
    error: 'Unsupported legacy CNE node: mystery',
    errors: ['document.content[0].type']
  };
  const session = createSession('', { migrationFailure });
  const states = [];
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session, {
    onDocumentState: (value) => states.push(value)
  }));

  assert.equal(layer.dataset.hnSessionReadOnly, 'true');
  assert.equal(layer.dataset.hnMigrationFailure, 'true');
  assert.equal(states.at(-1).source, null);
  assert.deepEqual(states.at(-1).migrationFailure, migrationFailure);
  assert.equal(harness.controllers[0].options.root.getAttribute('contenteditable'), 'false');
});

test('camera, frame, object extents, bounds, title, and pointer ownership remain shell-owned', () => {
  const harness = createHarness();
  const session = createSession('Alpha');
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session));
  const nextPage = {
    ...page(),
    title: 'Renamed',
    textFrame: { centerWorldX: -40, preferredWidth: 900 }
  };

  harness.pageView.updateHnTextPageLayer(layer, {
    page: nextPage,
    zoom: 1.4,
    cameraOffsetY: 27,
    objectBounds: null
  });
  assert.equal(harness.shellCalls.camera.at(-1).patch.scale, 1.4);
  assert.equal(harness.shellCalls.camera.at(-1).patch.offsetY, 27);
  assert.deepEqual(Object.keys(harness.shellCalls.camera.at(-1).patch).sort(), ['offsetY', 'scale']);
  assert.deepEqual(harness.shellCalls.textFrame.at(-1).value, nextPage.textFrame);
  assert.equal(harness.shellCalls.objectBounds.at(-1).value, null);
  assert.equal(harness.pageView.getHnTextDocumentBounds(layer).bottom, 900);
  assert.equal(harness.pageView.diagnostics(layer).title, 'Renamed');

  const shellTarget = new FakeElement('div');
  shellTarget.shellOwned = true;
  assert.equal(harness.pageView.hnTextPageOwnsPointer(shellTarget), true);
  const child = new FakeElement('span');
  layer.append(child);
  assert.equal(harness.pageView.hnTextPageOwnsPointer(child), true);
});

test('destroy is idempotent and clears diagnostics without mutating Page data', () => {
  const harness = createHarness();
  const session = createSession('Alpha');
  const canonicalPage = page();
  const before = JSON.stringify(canonicalPage);
  const layer = harness.pageView.renderHnTextPageLayer(renderOptions(harness, session, {
    page: canonicalPage
  }));

  assert.equal(harness.pageView.destroyHnTextPageLayer(layer), true);
  assert.equal(harness.pageView.destroyHnTextPageLayer(layer), false);
  assert.equal(harness.controllers[0].destroyed, true);
  assert.equal(harness.pageView.diagnostics(layer), null);
  assert.equal(JSON.stringify(canonicalPage), before);
});
