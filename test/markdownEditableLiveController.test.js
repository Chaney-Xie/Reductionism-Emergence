'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const foundation = require('../public/markdownEditableFoundation');
const projectionRuntime = require('../public/js/markdownEditableProjection');
const syntaxAdapters = require('../public/js/markdownEditableSyntaxAdapters');
const textEditingModel = require('../public/textEditing');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');
const {
  createCertificationProjection,
  positionKey
} = require('./helpers/markdownEditableCertificationHarness');

const viewSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
  'utf8'
);
const stylesSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

function functionSource(name) {
  const start = viewSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = viewSource.indexOf('{', viewSource.indexOf(') {', start));
  let depth = 0;
  for (let index = bodyStart; index < viewSource.length; index += 1) {
    if (viewSource[index] === '{') depth += 1;
    else if (viewSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return viewSource.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to isolate ${name}`);
}

function loadController(names = [], environment = {}) {
  const exposedNames = [...new Set(['createLinkArrowController', ...names])];
  return loadMarkdownPageViewInternals(exposedNames, {
    ...environment,
    globalThis: {
      markdownEditableFoundation: foundation,
      markdownEditableProjection: projectionRuntime,
      markdownEditableSyntaxAdapters: syntaxAdapters,
      textEditingModel,
      ...(environment.globalThis || {})
    }
  });
}

function loadDeletionTraceController(names = []) {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const trace = {
    exactDeletionCalls: 0,
    canonicalReplayCalls: 0,
    parseCalls: 0,
    result: null
  };
  const tracedFoundation = {
    ...foundation,
    applyExactDeletion(...args) {
      trace.exactDeletionCalls += 1;
      trace.result = foundation.applyExactDeletion(...args);
      return trace.result;
    },
    applyCanonicalEdit(...args) {
      trace.canonicalReplayCalls += 1;
      return foundation.applyCanonicalEdit(...args);
    }
  };
  const tracedModel = {
    ...markdown,
    parseMarkdownDocument(...args) {
      trace.parseCalls += 1;
      return markdown.parseMarkdownDocument(...args);
    }
  };
  return {
    trace,
    view: loadController(names, {
      window: { getSelection: () => browserSelection },
      document: { getSelection: () => browserSelection },
      globalThis: {
        markdownEditableFoundation: tracedFoundation,
        markdownPageModel: tracedModel
      }
    })
  };
}

function createImeCaptureDocument() {
  const listeners = new Map();
  return {
    activeElement: null,
    addEventListener(type, listener, options = false) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({
        listener,
        capture: options === true || options?.capture === true
      });
    },
    removeEventListener(type, listener, options = false) {
      const capture = options === true || options?.capture === true;
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => (
        entry.listener !== listener || entry.capture !== capture
      )));
    },
    dispatchCapture(type, event) {
      event.type = type;
      for (const entry of listeners.get(type) || []) {
        if (entry.capture) entry.listener(event);
      }
    }
  };
}

function createMarkdownEvent(init = {}) {
  const calls = {
    preventDefault: 0,
    stopPropagation: 0,
    stopImmediatePropagation: 0
  };
  const event = {
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    ...init,
    preventDefault() {
      calls.preventDefault += 1;
      this.defaultPrevented = true;
    },
    stopPropagation() {
      calls.stopPropagation += 1;
      this.propagationStopped = true;
    },
    stopImmediatePropagation() {
      calls.stopImmediatePropagation += 1;
      this.immediatePropagationStopped = true;
      this.propagationStopped = true;
    }
  };
  return { event, calls };
}

function dispatchMarkdownBodyEvent(bodyRoot, type, event) {
  const listeners = bodyRoot.listeners.get(type) || [];
  assert.equal(listeners.length, 1, `Markdown body must own one ${type} listener`);
  listeners[0](event);
}

function markImeEditableSurface(bodyRoot, documentRef) {
  const matches = bodyRoot.matches.bind(bodyRoot);
  bodyRoot.matches = (selector) => String(selector).split(',').some((candidate) => (
    candidate.trim() === '[contenteditable]'
  )) || matches(selector);
  bodyRoot.setAttribute('contenteditable', 'plaintext-only');
  bodyRoot.ownerDocument = documentRef;
  documentRef.activeElement = bodyRoot;
}

function createBrowserSelection() {
  return {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
}

function createTimerQueue() {
  let sequence = 0;
  const callbacks = new Map();
  return {
    setTimeout(callback) {
      const token = ++sequence;
      callbacks.set(token, callback);
      return token;
    },
    clearTimeout(token) {
      callbacks.delete(token);
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    get size() {
      return callbacks.size;
    }
  };
}

function nativeCompositionMutation(browserSelection) {
  const anchorNode = browserSelection.anchorNode;
  const focusNode = browserSelection.focusNode;
  assert.ok(anchorNode && focusNode, 'composition requires one native selection');
  assert.strictEqual(anchorNode, focusNode,
    'the focused IME fixtures keep their replacement range in one native host');
  const start = Math.min(browserSelection.anchorOffset, browserSelection.focusOffset);
  const end = Math.max(browserSelection.anchorOffset, browserSelection.focusOffset);
  if (anchorNode.nodeType === 3) {
    const baseText = String(anchorNode.nodeValue || '');
    return {
      host: anchorNode.parentNode,
      node: anchorNode,
      apply(value) {
        const text = String(value ?? '');
        anchorNode.nodeValue = `${baseText.slice(0, start)}${text}${baseText.slice(end)}`;
        const offset = start + text.length;
        browserSelection.setBaseAndExtent(anchorNode, offset, anchorNode, offset);
      }
    };
  }
  const host = anchorNode;
  return {
    host,
    node: null,
    apply(value) {
      const text = String(value ?? '');
      host.textContent = text;
      const node = host.firstChild || host;
      const offset = node.nodeType === 3 ? text.length : host.childNodes.length;
      browserSelection.setBaseAndExtent(node, offset, node, offset);
    }
  };
}

function dispatchNativeCompositionRevision(bodyRoot, mutation, data) {
  dispatchMarkdownBodyEvent(bodyRoot, 'compositionupdate', { data });
  const provisional = createMarkdownEvent({
    target: bodyRoot,
    inputType: 'insertCompositionText',
    data,
    isComposing: true
  });
  dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', provisional.event);
  mutation.apply(data);
  dispatchMarkdownBodyEvent(bodyRoot, 'input', {
    target: bodyRoot,
    inputType: 'insertCompositionText',
    data,
    isComposing: true
  });
  return provisional;
}

function installFixtureLinkArrowController(view, state) {
  state.linkArrowController = view.createLinkArrowController();
  state.linkArrowAnchorSink = null;
  state.linkArrowDescriptorAtRange = null;
  return state;
}

function mountMarkdownImeFixture(view, source, browserSelection, {
  anchor = source.length,
  focus = anchor,
  id = 'markdown-ime-fixture',
  bodyRoot: providedBodyRoot = null
} = {}) {
  const snapshot = markdown.createSourceSnapshot(source);
  const bodyRoot = providedBodyRoot || new FakeElement();
  bodyRoot.isConnected = true;
  const bodyInputs = [];
  const state = {
    body: source,
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version,
    bodyRoot,
    mode: 'live-preview',
    pageEditMode: false,
    bodyReadOnly: false,
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set(),
    editableForcedRawOwnerIds: new Set(),
    editHistory: view.createMarkdownEditHistory(source),
    page: { id },
    paneId: `pane-${id}`,
    onBodyInput: (detail) => bodyInputs.push(detail)
  };
  installFixtureLinkArrowController(view, state);
  view.renderSemanticDocument(state, bodyRoot);
  const anchorPosition = view.projectionPositionAtOffset(state.editableProjection, anchor);
  const focusPosition = view.projectionPositionAtOffset(state.editableProjection, focus);
  assert.ok(anchorPosition && focusPosition, 'IME fixture selection must map to canonical positions');
  assert.ok(state.editableProjection.restoreSelection({
    anchor: anchorPosition,
    focus: focusPosition
  }));
  assert.equal(browserSelection.anchorNode !== null, true);
  return { state, bodyRoot, bodyInputs };
}

function leafAtOffset(plan, lineId, offset) {
  const line = plan?.lines?.find((candidate) => (
    String(candidate.physicalLineId) === String(lineId)
  ));
  if (!line) return null;
  const candidates = line.leaves.filter((leaf) => (
    leaf.sourceStart <= offset && offset <= leaf.sourceEnd
  ));
  return candidates.find((leaf) => leaf.sourceStart < offset && offset < leaf.sourceEnd)
    || candidates.find((leaf) => leaf.sourceStart === offset)
    || candidates[candidates.length - 1]
    || null;
}

function positionsForPlan(snapshot, plan) {
  return snapshot.physicalLineIndex.lines.flatMap((line) => (
    Array.from({ length: line.text.length + 1 }, (_unused, logicalColumn) => {
      const offset = line.start + logicalColumn;
      const leaf = leafAtOffset(plan, line.id, offset);
      return {
        sourceVersion: snapshot.version,
        offset,
        affinity: logicalColumn === line.text.length ? 'before' : 'after',
        physicalLineId: line.id,
        logicalColumn,
        leafId: leaf?.leafId || null,
        semanticOwnerId: leaf?.semanticOwnerId || null,
        visibility: leaf?.visibility || 'visible',
        interactionPolicy: leaf?.interactionPolicy || 'editable-text'
      };
    })
  ));
}

function createProjectionSpy() {
  return {
    renderCalls: [],
    positions: [],
    projectedLeaves: [],
    root: null,
    currentSnapshot: null,
    currentSelection: null,
    render(snapshot, options) {
      this.currentSnapshot = snapshot;
      this.renderCalls.push({ snapshot, options });
      this.positions = positionsForPlan(snapshot, options.presentationPlan);
      this.root?.replaceChildren?.();
      this.projectedLeaves = options.presentationPlan.lines.flatMap((line) => (
        line.leaves.map((leaf) => {
          const element = new FakeElement({ tagName: 'span' });
          element.dataset.markdownSourceStart = String(leaf.sourceStart);
          element.dataset.markdownSourceEnd = String(leaf.sourceEnd);
          element.textContent = leaf.text;
          this.root?.append?.(element);
          return { ...leaf, element };
        })
      ));
      return this;
    },
    snapshot() {
      return this.currentSnapshot;
    },
    enumerateDeclaredPositions() {
      return this.positions.slice();
    },
    enumerateProjectedLeaves() {
      return this.projectedLeaves.slice();
    },
    enumeratePhysicalRows() {
      return [];
    },
    enumeratePlanActivationAnchors() {
      return [];
    },
    getSelection() {
      return this.currentSelection;
    },
    restoreSelection(selection) {
      this.currentSelection = selection;
      return true;
    },
    pointerToPosition() {
      return null;
    }
  };
}

function createMarkdownSelectionGestureRuntime() {
  const listeners = new Map();
  const timers = new Map();
  let timerSequence = 0;
  return {
    globalThis: {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      removeEventListener(type, listener) {
        const current = listeners.get(type) || [];
        listeners.set(type, current.filter((candidate) => candidate !== listener));
      },
      setTimeout(callback) {
        const token = ++timerSequence;
        timers.set(token, callback);
        return token;
      },
      clearTimeout(token) {
        timers.delete(token);
      }
    },
    dispatch(type, event) {
      [...(listeners.get(type) || [])].forEach((listener) => listener(event));
    },
    flushTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    }
  };
}

function createMultiClickProjection(source, sourceVersion, ranges = {}) {
  const domNode = new FakeElement({ tagName: 'span' });
  domNode.isConnected = true;
  const positions = Array.from({ length: source.length + 1 }, (_unused, offset) => ({
    sourceVersion,
    physicalLineId: 'multiclick-line-0',
    logicalColumn: offset,
    offset,
    affinity: offset === source.length ? 'before' : 'after',
    leafId: 'multiclick-leaf-0',
    semanticOwnerId: null,
    visibility: 'visible',
    interactionPolicy: 'editable-text'
  }));
  let selection = { anchor: positions[0], focus: positions[0], collapsed: true };
  let mappingEnabled = true;
  const pointerCalls = [];
  const granularityCalls = [];
  const restoredSelections = [];
  const at = (offset) => positions[Math.max(0, Math.min(source.length, offset))];
  const rangeAt = (position, granularity) => {
    const configured = ranges[`${granularity}:${position.offset}`]
      || ranges[granularity]
      || [position.offset, position.offset];
    return {
      sourceVersion,
      anchor: at(configured[0]),
      focus: at(configured[1]),
      collapsed: configured[0] === configured[1],
      granularity
    };
  };
  return {
    pointerCalls,
    granularityCalls,
    restoredSelections,
    at,
    snapshot() {
      return { markdownBody: source, version: sourceVersion, sourceVersion };
    },
    enumerateDeclaredPositions() {
      return positions.slice();
    },
    pointerToPosition(event) {
      pointerCalls.push(event);
      return Number.isInteger(event?.canonicalOffset) ? at(event.canonicalOffset) : null;
    },
    getSelection() {
      return selection;
    },
    restoreSelection(next) {
      if (!next?.anchor || !next?.focus) return false;
      selection = {
        sourceVersion,
        anchor: next.anchor,
        focus: next.focus,
        collapsed: projectionRuntime.samePosition(next.anchor, next.focus)
      };
      restoredSelections.push(selection);
      return true;
    },
    sourceToDom(position) {
      return mappingEnabled && position?.sourceVersion === sourceVersion
        ? { node: domNode, offset: position.offset }
        : null;
    },
    domToSource(node, offset) {
      return mappingEnabled && node === domNode ? at(offset) : null;
    },
    selectTextGranularity(position, granularity, options = {}) {
      granularityCalls.push({ position, granularity, apply: options.apply !== false });
      const selected = rangeAt(position, granularity);
      if (selected.collapsed) return null;
      if (options.apply !== false) selection = selected;
      return selected;
    },
    disableMapping() {
      mappingEnabled = false;
    }
  };
}

function createMultiClickControllerFixture(source, ranges = {}, mode = 'live-preview') {
  const runtime = createMarkdownSelectionGestureRuntime();
  const view = loadController([
    'renderSemanticDocument',
    'markdownTextInsertionEdit',
    'extendMarkdownSelectionGesture'
  ], {
    globalThis: runtime.globalThis
  });
  const snapshot = markdown.createSourceSnapshot(source);
  const bodyRoot = new FakeElement();
  bodyRoot.isConnected = true;
  bodyRoot.focusCalls = 0;
  bodyRoot.focus = () => {
    bodyRoot.focusCalls += 1;
  };
  const state = {
    body: source,
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version,
    bodyRoot,
    mode: 'reading',
    pageEditMode: false,
    bodyReadOnly: false,
    semanticBlocks: [],
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set(),
    editableForcedRawOwnerIds: new Set(),
    editHistory: view.createMarkdownEditHistory(source),
    page: { id: 'multiclick-page' },
    paneId: 'multiclick-pane',
    tabId: 'multiclick-tab'
  };
  installFixtureLinkArrowController(view, state);
  view.renderSemanticDocument(state, bodyRoot);
  const projection = createMultiClickProjection(source, snapshot.version, ranges);
  state.mode = mode;
  state.editableProjection = projection;
  state.editablePresentationPlan = null;
  const ordinary = new FakeElement({ tagName: 'span' });
  bodyRoot.append(ordinary);
  const pointerDown = bodyRoot.listeners.get('pointerdown')[0];
  const mouseDown = bodyRoot.listeners.get('mousedown')[0];
  return {
    view,
    state,
    projection,
    bodyRoot,
    ordinary,
    runtime,
    pointerDown,
    mouseDown
  };
}

function controllerState(source, projection = createProjectionSpy()) {
  const view = loadController();
  const snapshot = markdown.createSourceSnapshot(source);
  const bodyRoot = new FakeElement();
  bodyRoot.isConnected = true;
  projection.root = bodyRoot;
  return {
    state: installFixtureLinkArrowController(view, {
      body: source,
      sourceSnapshot: snapshot,
      sourceVersion: snapshot.version,
      editableProjection: projection,
      editablePresentationPlan: null,
      editableActiveOwnerIds: new Set(),
      editableActiveLineIds: new Set(),
      editableForcedRawOwnerIds: new Set(),
      bodyRoot,
      mode: 'live-preview',
      pageEditMode: false,
      bodyReadOnly: false,
      semanticDirty: false,
      pendingEditTransaction: null,
      page: { id: 'controller-test' },
      paneId: 'pane-controller'
    }),
    projection
  };
}

function assertPlanRender(call, expectedSource) {
  assert.ok(call, 'the editable projection must be refreshed');
  assert.equal(call.snapshot.markdownBody, expectedSource);
  assert.equal(call.options.mode, 'live-preview');
  assert.equal(call.options.presentationPlan.sourceVersion, call.snapshot.version);
  call.options.presentationPlan.lines.forEach((line) => {
    assert.equal(
      line.leaves.map((leaf) => leaf.text).join(''),
      expectedSource.slice(line.start, line.contentEnd),
      `line ${line.index} is not an exact canonical presentation plan`
    );
  });
}

test('canonical mutation, undo, and unexpected native input all refresh one planned projection', () => {
  const view = loadController([
    'refreshEditableProjection',
    'replaceSemanticSourceRange',
    'syncSemanticDocumentInput',
    'applyMarkdownEditHistory'
  ]);

  const mutation = controllerState('alpha');
  assert.equal(view.replaceSemanticSourceRange(
    mutation.state,
    5,
    5,
    '!',
    {
      beforeSelection: { anchor: 5, focus: 5 },
      afterSelection: { anchor: 6, focus: 6 },
      restoreSelection: false,
      recordHistory: false
    }
  ), true);
  assert.equal(mutation.state.body, 'alpha!');
  assertPlanRender(mutation.projection.renderCalls.at(-1), 'alpha!');
  assert.equal(
    mutation.state.editablePresentationPlan,
    mutation.projection.renderCalls.at(-1).options.presentationPlan
  );

  const history = view.createMarkdownEditHistory('alpha');
  view.recordMarkdownEditTransaction(history, {
    beforeSource: 'alpha',
    afterSource: 'alpha!',
    beforeSelection: { anchor: 5, focus: 5 },
    afterSelection: { anchor: 6, focus: 6 },
    inputType: 'insertText',
    timestamp: 1
  });
  const undo = controllerState('alpha!');
  undo.state.editHistory = history;
  assert.equal(view.applyMarkdownEditHistory(undo.state, 'undo'), true);
  assert.equal(undo.state.body, 'alpha');
  assertPlanRender(undo.projection.renderCalls.at(-1), 'alpha');

  const unexpected = controllerState('canonical');
  unexpected.state.pendingEditTransaction = {
    beforeSelection: { anchor: 3, focus: 3 }
  };
  view.syncSemanticDocumentInput(unexpected.state, {
    inputType: 'insertFromDrop'
  });
  assert.equal(unexpected.state.body, 'canonical', 'native DOM never becomes source authority');
  assertPlanRender(unexpected.projection.renderCalls.at(-1), 'canonical');

  const mutationSource = functionSource('replaceSemanticSourceRange');
  const undoSource = functionSource('applyMarkdownEditHistory');
  const unexpectedSource = functionSource('syncSemanticDocumentInput');
  [mutationSource, undoSource, unexpectedSource].forEach((source) => {
    assert.match(source, /refreshEditableProjection\(state\)/);
    assert.doesNotMatch(source, /editableProjection\.render\(/,
      'write paths must not bypass presentation-plan construction');
  });
});

test('semantic controls bypass selection while mouse hit-testing begins at mousedown', () => {
  const view = loadController(['renderSemanticDocument']);
  const bodyRoot = new FakeElement();
  const state = {
    body: '',
    sourceSnapshot: markdown.createSourceSnapshot(''),
    sourceVersion: 1,
    mode: 'reading',
    pageEditMode: false,
    bodyReadOnly: false,
    bodyRoot,
    semanticBlocks: [],
    editHistory: view.createMarkdownEditHistory('')
  };
  installFixtureLinkArrowController(view, state);
  view.renderSemanticDocument(state, bodyRoot);

  let pointerClaims = 0;
  state.mode = 'live-preview';
  state.editableProjection = {
    pointerToPosition() {
      pointerClaims += 1;
      return null;
    }
  };
  const control = new FakeElement({
    dataset: { markdownSemanticControl: 'true' },
    tagName: 'button'
  });
  const ordinary = new FakeElement({ tagName: 'span' });
  bodyRoot.append(control, ordinary);
  const [pointerListener] = bodyRoot.listeners.get('pointerdown');
  const [mouseListener] = bodyRoot.listeners.get('mousedown');

  const controlPointer = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse',
    target: control
  });
  pointerListener(controlPointer.event);
  assert.equal(pointerClaims, 0, 'semantic controls never ask the position mapper to claim them');
  assert.equal(state.pendingSemanticMousePointer?.pointerId, 1,
    'pointer identity is retained so a reflowed detail-2 target can continue its old anchor');
  const controlMouse = createMarkdownEvent({ button: 0, detail: 1, target: control });
  mouseListener(controlMouse.event);
  assert.equal(pointerClaims, 0, 'semantic-control mousedown remains native-control owned');
  assert.equal(state.pendingSemanticMousePointer, null,
    'a genuine detail-1 semantic-control click clears the pending text sequence');

  const ordinaryPointer = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 2,
    pointerType: 'mouse',
    target: ordinary
  });
  pointerListener(ordinaryPointer.event);
  assert.equal(pointerClaims, 0,
    'mouse pointerdown records identity but does not hit-test or prevent Chromium');
  assert.equal(ordinaryPointer.calls.preventDefault, 0);
  assert.equal(ordinaryPointer.calls.stopPropagation, 1);

  const ordinaryMouse = createMarkdownEvent({
    button: 0,
    detail: 1,
    target: ordinary
  });
  mouseListener(ordinaryMouse.event);
  assert.equal(pointerClaims, 1,
    'detail-bearing mousedown is the one canonical mouse hit-test owner');

  const touchPointer = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 3,
    pointerType: 'touch',
    target: ordinary
  });
  pointerListener(touchPointer.event);
  assert.equal(pointerClaims, 2,
    'non-mouse pointer input retains the existing pointerdown canonical path');

  const listenerSource = functionSource('renderSemanticDocument');
  const controlGuard = listenerSource.indexOf('if (semanticControl) return;');
  const pendingMouse = listenerSource.indexOf('state.pendingSemanticMousePointer');
  assert.ok(controlGuard >= 0 && pendingMouse >= 0 && pendingMouse < controlGuard,
    'pointer identity precedes the control guard, while canonical hit-testing remains guarded');
});

test('double and triple click reuse the first canonical mousedown anchor after geometry shifts', () => {
  const source = 'Alpha beta gamma.';
  const fixture = createMultiClickControllerFixture(source, {
    'word:7': [6, 10],
    'block:7': [0, source.length]
  });
  const mousePointer = (pointerId, target = fixture.ordinary) => createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId,
    pointerType: 'mouse',
    target
  });
  const mouseDown = (detail, canonicalOffset, target = fixture.ordinary) => createMarkdownEvent({
    button: 0,
    detail,
    canonicalOffset,
    target
  });

  const firstPointer = mousePointer(10);
  fixture.pointerDown(firstPointer.event);
  assert.equal(fixture.projection.pointerCalls.length, 0,
    'mouse pointerdown does not claim a coordinate or disturb the browser default');
  assert.equal(firstPointer.calls.preventDefault, 0);
  const firstMouse = mouseDown(1, 7);
  fixture.mouseDown(firstMouse.event);
  assert.equal(fixture.projection.pointerCalls.length, 1);
  assert.equal(fixture.state.semanticMultiClickAnchor?.position?.offset, 7);
  assert.deepEqual({
    anchor: fixture.projection.getSelection().anchor.offset,
    focus: fixture.projection.getSelection().focus.offset
  }, { anchor: 7, focus: 7 });

  const shiftedSemanticControl = new FakeElement({
    dataset: { markdownSemanticControl: 'true' },
    tagName: 'button'
  });
  fixture.bodyRoot.append(shiftedSemanticControl);
  const secondPointer = mousePointer(11, shiftedSemanticControl);
  fixture.pointerDown(secondPointer.event);
  const secondMouse = mouseDown(2, 15, shiftedSemanticControl);
  fixture.mouseDown(secondMouse.event);
  assert.equal(fixture.projection.pointerCalls.length, 1,
    'the shifted second-click coordinate is never hit-tested');
  assert.deepEqual(fixture.projection.granularityCalls.at(-1), {
    position: fixture.projection.at(7),
    granularity: 'word',
    apply: true
  });
  assert.deepEqual({
    anchor: fixture.projection.getSelection().anchor.offset,
    focus: fixture.projection.getSelection().focus.offset
  }, { anchor: 6, focus: 10 });

  const selectedWord = fixture.projection.getSelection();
  const replacement = fixture.view.markdownTextInsertionEdit(source, {
    anchor: selectedWord.anchor.offset,
    focus: selectedWord.focus.offset,
    anchorPosition: selectedWord.anchor,
    focusPosition: selectedWord.focus
  }, 'ATP');
  assert.equal(replacement.source, 'Alpha ATP gamma.',
    'typing replaces the exact canonical word selection');
  assert.deepEqual({
    anchor: replacement.selection.anchor,
    focus: replacement.selection.focus
  }, { anchor: 9, focus: 9 });

  const thirdPointer = mousePointer(12, shiftedSemanticControl);
  fixture.pointerDown(thirdPointer.event);
  const thirdMouse = mouseDown(3, 1, shiftedSemanticControl);
  fixture.mouseDown(thirdMouse.event);
  assert.equal(fixture.projection.pointerCalls.length, 1,
    'the shifted third-click coordinate is never hit-tested');
  assert.deepEqual(fixture.projection.granularityCalls.at(-1), {
    position: fixture.projection.at(7),
    granularity: 'block',
    apply: true
  });
  assert.deepEqual({
    anchor: fixture.projection.getSelection().anchor.offset,
    focus: fixture.projection.getSelection().focus.offset
  }, { anchor: 0, focus: source.length });
  assert.equal(fixture.bodyRoot.focusCalls, 3);

  const mouseHandlerSource = functionSource('handleMarkdownTextMouseDown');
  assert.doesNotMatch(mouseHandlerSource, /setTimeout|Date\.now|clientX|clientY/,
    'click count and browser granularity must not be recreated with timers or shifted geometry');
});

test('Source and Live share the same canonical-anchored browser word selection', async (t) => {
  for (const mode of ['source', 'live-preview']) {
    await t.test(mode, () => {
      const source = 'Alpha beta';
      const fixture = createMultiClickControllerFixture(source, {
        'word:7': [6, 10]
      }, mode);
      const pointer = (pointerId) => createMarkdownEvent({
        button: 0,
        isPrimary: true,
        pointerId,
        pointerType: 'mouse',
        target: fixture.ordinary
      });
      fixture.pointerDown(pointer(15).event);
      fixture.mouseDown(createMarkdownEvent({
        button: 0,
        detail: 1,
        canonicalOffset: 7,
        target: fixture.ordinary
      }).event);
      fixture.pointerDown(pointer(16).event);
      fixture.mouseDown(createMarkdownEvent({
        button: 0,
        detail: 2,
        canonicalOffset: 1,
        target: fixture.ordinary
      }).event);
      assert.equal(fixture.projection.pointerCalls.length, 1);
      assert.deepEqual({
        anchor: fixture.projection.getSelection().anchor.offset,
        focus: fixture.projection.getSelection().focus.offset
      }, { anchor: 6, focus: 10 });
      assert.equal(fixture.projection.granularityCalls.at(-1).position.offset, 7);
    });
  }
});

test('stale or unmappable multi-click anchors fail closed without offset-zero fallback', () => {
  const source = 'Alpha beta';
  const fixture = createMultiClickControllerFixture(source, {
    'word:7': [6, 10]
  });
  const firstPointer = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 20,
    pointerType: 'mouse',
    target: fixture.ordinary
  });
  fixture.pointerDown(firstPointer.event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 1,
    canonicalOffset: 7,
    target: fixture.ordinary
  }).event);
  const before = fixture.projection.getSelection();
  fixture.projection.disableMapping();

  const secondPointer = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 21,
    pointerType: 'mouse',
    target: fixture.ordinary
  });
  fixture.pointerDown(secondPointer.event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 2,
    canonicalOffset: 0,
    target: fixture.ordinary
  }).event);

  assert.equal(fixture.projection.pointerCalls.length, 1,
    'failure does not re-hit-test the new coordinate');
  assert.equal(fixture.projection.granularityCalls.length, 0,
    'an unmappable saved anchor never reaches browser granularity selection');
  assert.strictEqual(fixture.projection.getSelection(), before,
    'the prior canonical caret remains intact');
  assert.equal(fixture.state.semanticMultiClickAnchor, null);

  const stale = createMultiClickControllerFixture(source, {
    'word:7': [6, 10]
  });
  stale.pointerDown(createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 22,
    pointerType: 'mouse',
    target: stale.ordinary
  }).event);
  stale.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 1,
    canonicalOffset: 7,
    target: stale.ordinary
  }).event);
  stale.state.sourceVersion += 1;
  stale.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 2,
    canonicalOffset: 0,
    target: stale.ordinary
  }).event);
  assert.equal(stale.projection.granularityCalls.length, 0);
  assert.equal(stale.projection.pointerCalls.length, 1);
  assert.equal(stale.state.semanticMultiClickAnchor, null,
    'revision drift invalidates the complete sequence instead of guessing');
});

test('word and block multi-click drag extend by browser-provided canonical ranges', async (t) => {
  const cases = [
    {
      name: 'word drag',
      source: 'Alpha beta gamma.',
      detail: 2,
      granularity: 'word',
      ranges: {
        'word:7': [6, 10],
        'word:14': [11, 16],
        'word:1': [0, 5]
      },
      forward: { anchor: 6, focus: 16 },
      backward: { anchor: 10, focus: 0 }
    },
    {
      name: 'block drag',
      source: 'Alpha beta.\nGamma delta.',
      detail: 3,
      granularity: 'block',
      ranges: {
        'block:7': [0, 11],
        'block:18': [12, 24]
      },
      forward: { anchor: 0, focus: 24 },
      backward: null
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const fixture = createMultiClickControllerFixture(entry.source, entry.ranges);
      const pointer = (pointerId) => createMarkdownEvent({
        button: 0,
        isPrimary: true,
        pointerId,
        pointerType: 'mouse',
        target: fixture.ordinary
      });
      fixture.pointerDown(pointer(30).event);
      fixture.mouseDown(createMarkdownEvent({
        button: 0,
        detail: 1,
        canonicalOffset: 7,
        target: fixture.ordinary
      }).event);
      fixture.pointerDown(pointer(31).event);
      fixture.mouseDown(createMarkdownEvent({
        button: 0,
        detail: entry.detail,
        canonicalOffset: 15,
        target: fixture.ordinary
      }).event);

      const forwardOffset = entry.granularity === 'word' ? 14 : 18;
      const forward = createMarkdownEvent({
        button: 0,
        isPrimary: true,
        pointerId: 31,
        pointerType: 'mouse',
        canonicalOffset: forwardOffset,
        target: fixture.ordinary
      });
      fixture.runtime.dispatch('pointermove', forward.event);
      assert.equal(forward.calls.preventDefault, 1);
      assert.deepEqual({
        anchor: fixture.projection.getSelection().anchor.offset,
        focus: fixture.projection.getSelection().focus.offset
      }, entry.forward);
      assert.deepEqual(fixture.projection.granularityCalls.at(-1), {
        position: fixture.projection.at(forwardOffset),
        granularity: entry.granularity,
        apply: false
      });

      if (entry.backward) {
        const backward = createMarkdownEvent({
          button: 0,
          isPrimary: true,
          pointerId: 31,
          pointerType: 'mouse',
          canonicalOffset: 1,
          target: fixture.ordinary
        });
        fixture.runtime.dispatch('pointermove', backward.event);
        assert.deepEqual({
          anchor: fixture.projection.getSelection().anchor.offset,
          focus: fixture.projection.getSelection().focus.offset
        }, entry.backward);
      }

      fixture.runtime.dispatch('pointerup', {
        pointerId: 31,
        clientX: 0,
        clientY: 0,
        preventDefault() {}
      });
      fixture.runtime.flushTimers();
    });
  }
});

test('granular drag fails closed when Chromium cannot expand the moving endpoint', () => {
  const source = 'Alpha beta gamma.';
  const fixture = createMultiClickControllerFixture(source, {
    'word:7': [6, 10]
  });
  const pointer = (pointerId) => createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId,
    pointerType: 'mouse',
    target: fixture.ordinary
  });
  fixture.pointerDown(pointer(35).event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 1,
    canonicalOffset: 7,
    target: fixture.ordinary
  }).event);
  fixture.pointerDown(pointer(36).event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 2,
    canonicalOffset: 7,
    target: fixture.ordinary
  }).event);
  const selectedWord = fixture.projection.getSelection();
  const restoreCount = fixture.projection.restoredSelections.length;

  const rejectedMove = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 36,
    pointerType: 'mouse',
    canonicalOffset: 14,
    target: fixture.ordinary
  });
  fixture.runtime.dispatch('pointermove', rejectedMove.event);

  assert.equal(rejectedMove.calls.preventDefault, 1);
  assert.deepEqual(fixture.projection.granularityCalls.at(-1), {
    position: fixture.projection.at(14),
    granularity: 'word',
    apply: false
  });
  assert.strictEqual(fixture.projection.getSelection(), selectedWord,
    'a rejected browser range leaves the installed word selection untouched');
  assert.equal(fixture.projection.restoredSelections.length, restoreCount,
    'the granular gesture never falls back to a character-range restoration');
});

test('granular drag uses the projection that owns the post-hit-test table state', () => {
  const source = 'Alpha beta gamma.';
  const fixture = createMultiClickControllerFixture(source);
  const staleProjection = fixture.projection;
  const successor = createMultiClickProjection(source, fixture.state.sourceVersion, {
    'word:14': [11, 16]
  });
  assert.ok(successor.restoreSelection({
    anchor: successor.at(6),
    focus: successor.at(10)
  }));
  let staleGranularityCalls = 0;
  staleProjection.selectTextGranularity = () => {
    staleGranularityCalls += 1;
    return null;
  };
  staleProjection.pointerToPosition = (event) => {
    staleProjection.pointerCalls.push(event);
    // This mirrors editable table activation: resolving the pointer can
    // synchronously refresh the projection before granularity is applied.
    fixture.state.editableProjection = successor;
    return successor.at(event.canonicalOffset);
  };

  const extended = fixture.view.extendMarkdownSelectionGesture({
    state: fixture.state,
    editor: fixture.bodyRoot,
    editorType: 'body',
    anchorPosition: successor.at(6),
    multiClickAnchorPosition: successor.at(7),
    granularity: 'word',
    granularitySelection: {
      sourceVersion: fixture.state.sourceVersion,
      anchor: successor.at(6),
      focus: successor.at(10),
      collapsed: false,
      granularity: 'word'
    }
  }, {
    canonicalOffset: 14,
    target: fixture.ordinary
  });

  assert.equal(extended, true);
  assert.strictEqual(fixture.state.editableProjection, successor);
  assert.equal(staleGranularityCalls, 0,
    'the pre-activation projection never receives the browser-granularity request');
  assert.deepEqual(successor.granularityCalls, [{
    position: successor.at(14),
    granularity: 'word',
    apply: false
  }]);
  assert.deepEqual({
    anchor: successor.getSelection().anchor.offset,
    focus: successor.getSelection().focus.offset
  }, { anchor: 6, focus: 16 });
});

test('fresh failed text clicks and guarded controls retire an older multi-click anchor', async (t) => {
  const source = 'Alpha beta';
  const seedAnchor = (fixture, pointerId) => {
    fixture.pointerDown(createMarkdownEvent({
      button: 0,
      isPrimary: true,
      pointerId,
      pointerType: 'mouse',
      target: fixture.ordinary
    }).event);
    fixture.mouseDown(createMarkdownEvent({
      button: 0,
      detail: 1,
      canonicalOffset: 7,
      target: fixture.ordinary
    }).event);
    assert.equal(fixture.state.semanticMultiClickAnchor?.position?.offset, 7);
  };

  await t.test('unmappable ordinary detail-1', () => {
    const fixture = createMultiClickControllerFixture(source, {
      'word:7': [6, 10]
    });
    seedAnchor(fixture, 60);
    fixture.pointerDown(createMarkdownEvent({
      button: 0,
      isPrimary: true,
      pointerId: 61,
      pointerType: 'mouse',
      target: fixture.ordinary
    }).event);
    fixture.mouseDown(createMarkdownEvent({
      button: 0,
      detail: 1,
      target: fixture.ordinary
    }).event);
    assert.equal(fixture.state.semanticMultiClickAnchor, null);

    fixture.pointerDown(createMarkdownEvent({
      button: 0,
      isPrimary: true,
      pointerId: 62,
      pointerType: 'mouse',
      target: fixture.ordinary
    }).event);
    fixture.mouseDown(createMarkdownEvent({
      button: 0,
      detail: 2,
      canonicalOffset: 7,
      target: fixture.ordinary
    }).event);
    assert.equal(fixture.projection.granularityCalls.length, 0,
      'detail-2 cannot revive the anchor retired by a failed fresh click');
  });

  await t.test('guarded semantic-control detail-1', () => {
    const fixture = createMultiClickControllerFixture(source, {
      'word:7': [6, 10]
    });
    seedAnchor(fixture, 63);
    const control = new FakeElement({
      dataset: { markdownSemanticControl: 'true' },
      tagName: 'button'
    });
    fixture.bodyRoot.append(control);
    fixture.pointerDown(createMarkdownEvent({
      button: 0,
      isPrimary: true,
      pointerId: 64,
      pointerType: 'mouse',
      target: control
    }).event);
    assert.equal(fixture.state.pendingSemanticMousePointer?.pointerId, 64,
      'the capture owner retains identity until detail establishes the sequence');
    fixture.mouseDown(createMarkdownEvent({
      button: 0,
      detail: 1,
      target: control
    }).event);
    assert.equal(fixture.state.semanticMultiClickAnchor, null);
    assert.equal(fixture.state.pendingSemanticMousePointer, null);

    fixture.pointerDown(createMarkdownEvent({
      button: 0,
      isPrimary: true,
      pointerId: 65,
      pointerType: 'mouse',
      target: fixture.ordinary
    }).event);
    fixture.mouseDown(createMarkdownEvent({
      button: 0,
      detail: 2,
      canonicalOffset: 7,
      target: fixture.ordinary
    }).event);
    assert.equal(fixture.projection.granularityCalls.length, 0,
      'detail-2 cannot revive the anchor retired by a control-owned fresh click');
  });
});

test('multi-click keeps active table presentation mounted and delimiter-free', () => {
  const source = [
    '| Name | Score |',
    '| --- | ---: |',
    '| Alpha | 5 |'
  ].join('\n');
  const alpha = source.indexOf('Alpha');
  const fixture = createMultiClickControllerFixture(source, {
    [`word:${alpha + 2}`]: [alpha, alpha + 5]
  });
  const table = new FakeElement({ tagName: 'table' });
  table.classList.add('markdown-page-table');
  table.textContent = 'NameScoreAlpha5';
  const tableShell = new FakeElement({ tagName: 'div' });
  tableShell.classList.add('markdown-page-table-shell');
  tableShell.append(table);
  fixture.bodyRoot.append(tableShell);
  const originalTable = tableShell.firstChild;
  const originalSource = fixture.state.body;

  fixture.pointerDown(createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 40,
    pointerType: 'mouse',
    target: table
  }).event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 1,
    canonicalOffset: alpha + 2,
    target: table
  }).event);
  fixture.pointerDown(createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 41,
    pointerType: 'mouse',
    target: table
  }).event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 2,
    canonicalOffset: source.indexOf('|'),
    target: table
  }).event);

  assert.strictEqual(tableShell.firstChild, originalTable,
    'multi-click does not remount the rendered table');
  assert.equal(table.textContent, 'NameScoreAlpha5');
  assert.doesNotMatch(table.textContent, /\|/,
    'selection does not reveal Markdown table delimiters');
  assert.equal(fixture.state.body, originalSource,
    'presentation selection never mutates canonical table source');
  assert.deepEqual({
    anchor: fixture.projection.getSelection().anchor.offset,
    focus: fixture.projection.getSelection().focus.offset
  }, { anchor: alpha, focus: alpha + 5 });
});

test('right click, Shift extension, and pen input retain their existing owners', () => {
  const source = 'Alpha beta gamma';
  const fixture = createMultiClickControllerFixture(source, {
    'word:7': [6, 10]
  });
  const right = createMarkdownEvent({
    button: 2,
    isPrimary: true,
    pointerId: 50,
    pointerType: 'mouse',
    target: fixture.ordinary
  });
  fixture.pointerDown(right.event);
  assert.equal(fixture.projection.pointerCalls.length, 0);
  assert.equal(right.calls.preventDefault, 0);

  assert.ok(fixture.projection.restoreSelection({
    anchor: fixture.projection.at(2),
    focus: fixture.projection.at(4)
  }));
  fixture.pointerDown(createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 51,
    pointerType: 'mouse',
    target: fixture.ordinary
  }).event);
  fixture.mouseDown(createMarkdownEvent({
    button: 0,
    detail: 1,
    shiftKey: true,
    canonicalOffset: 8,
    target: fixture.ordinary
  }).event);
  assert.deepEqual({
    anchor: fixture.projection.getSelection().anchor.offset,
    focus: fixture.projection.getSelection().focus.offset
  }, { anchor: 2, focus: 8 });
  assert.equal(fixture.state.semanticMultiClickAnchor, null,
    'Shift selection does not seed a later multi-click sequence');

  const pen = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 52,
    pointerType: 'pen',
    canonicalOffset: 12,
    target: fixture.ordinary
  });
  fixture.pointerDown(pen.event);
  assert.equal(fixture.projection.pointerCalls.at(-1), pen.event);
  assert.equal(fixture.projection.getSelection().focus.offset, 12);
  assert.equal(pen.event.defaultPrevented, true,
    'pen retains the existing canonical pointerdown path');
});

test('hidden syntax positions activate before exact restoration', async (t) => {
  const view = loadController([
    'refreshEditableProjection',
    'ensureEditableSelectionVisible'
  ]);
  const fixtures = [
    { name: 'quote prefix', source: '> quote', offset: 1, activation: 'line' },
    { name: 'heading source', source: '# Heading', offset: 0, activation: 'owner' },
    { name: 'emphasis source', source: '*word*', offset: 0, activation: 'owner' },
    { name: 'inline code source', source: '`code`', offset: 0, activation: 'owner' },
    { name: 'fenced code source', source: '```js\ncode\n```', offset: 1, activation: 'owner' },
    { name: 'link source', source: '[label](https://example.com)', offset: 0, activation: 'owner' },
    { name: 'math source', source: '$x^2$', offset: 2, activation: 'owner' }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const { state, projection } = controllerState(fixture.source);
      view.refreshEditableProjection(state);
      const initial = projection.positions.find((position) => position.offset === fixture.offset);
      assert.ok(initial);
      assert.notEqual(initial.visibility, 'visible');
      const renderCount = projection.renderCalls.length;

      const restored = view.ensureEditableSelectionVisible(state, {
        anchor: initial,
        focus: initial
      });
      assert.ok(restored);
      assert.equal(projection.renderCalls.length, renderCount + 1,
        'activation refreshes the plan before a DOM restoration is attempted');
      assert.equal(restored.anchor.offset, initial.offset);
      assert.equal(restored.anchor.affinity, initial.affinity);
      assert.equal(restored.focus.offset, initial.offset);
      assert.equal(restored.focus.affinity, initial.affinity);
      assert.equal(restored.anchor.visibility, 'visible');
      if (fixture.activation === 'line') {
        assert.ok(state.editableActiveLineIds.has(String(initial.physicalLineId)));
      } else {
        assert.ok(state.editableActiveOwnerIds.size > 0);
      }
      assert.equal(
        projection.renderCalls.at(-1).options.presentationPlan,
        state.editablePresentationPlan
      );
    });
  }
});

test('Live heading first click hit-tests the old presentation before syntax activation', () => {
  const source = '## 对不可说的，我们必须报以沉默。';
  const browserSelection = createBrowserSelection();
  const view = loadController([
    'renderEditableDocumentBlocks',
    'beginCanonicalMarkdownPointerSelection',
    'clearMarkdownSelectionGesture'
  ], {
    window: {
      getSelection: () => browserSelection,
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout
    },
    document: { getSelection: () => browserSelection },
    globalThis: {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout
    }
  });
  const rendered = renderEditableFixture(view, source);
  const heading = descendants(rendered.bodyRoot).find((node) => (
    node?.classList?.contains('markdown-editable-heading-presentation')
  ));
  const mapped = descendants(heading).find((node) => (
    node?.classList?.contains('markdown-source-mapped-text')
      && node.textContent === '对不可说的，我们必须报以沉默。'
  ));
  assert.ok(heading);
  assert.ok(mapped);
  rendered.bodyRoot.focus = () => {};
  rendered.projection.document.getSelection = () => browserSelection;
  const oldTextNode = mapped.firstChild;
  const oldPresentationOffset = 5;
  const expectedCanonicalOffset = Number(mapped.dataset.markdownSourceStart)
    + oldPresentationOffset;
  assert.equal(source.slice(expectedCanonicalOffset - 1, expectedCanonicalOffset + 1), '的，');
  rendered.projection.document.caretPositionFromPoint = () => ({
    offsetNode: oldTextNode,
    offset: oldPresentationOffset
  });
  const click = createMarkdownEvent({
    button: 0,
    isPrimary: true,
    pointerId: 73,
    pointerType: 'mouse',
    clientX: 120,
    clientY: 8,
    target: mapped
  });

  assert.equal(view.beginCanonicalMarkdownPointerSelection(
    rendered.state,
    rendered.bodyRoot,
    click.event,
    { pointerId: 73, recordMultiClick: true }
  ), true);
  const selection = rendered.state.editableProjection.getSelection();
  assert.equal(selection.anchor.offset, expectedCanonicalOffset);
  assert.equal(selection.focus.offset, expectedCanonicalOffset);
  assert.equal(selection.anchor.affinity, 'after');
  assert.equal(rendered.state.semanticMultiClickAnchor.position.offset, expectedCanonicalOffset);
  assert.ok(rendered.state.editableActiveOwnerIds.size > 0,
    'the exact old-presentation hit activates heading source only after capture');
  assert.equal(rendered.bodyRoot.contains(oldTextNode), false,
    'syntax activation replaces the old presentation DOM after the hit-test');
  view.clearMarkdownSelectionGesture();
});

test('table cells retain exact projected leaves and exact activation anchors', () => {
  const source = [
    '| A | B |',
    '| - | - |',
    '| one | two |',
    '| | four |'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const plan = syntaxAdapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const { document, root, projection } = createCertificationProjection(
    snapshot,
    'live-preview',
    { presentationPlan: plan }
  );
  const table = plan.constructs.tables[0];
  const leaves = projection.enumerateProjectedLeaves();
  const cellLeaves = leaves.filter((leaf) => leaf.kind === 'table-cell');
  assert.ok(table);
  assert.ok(cellLeaves.length > 0);
  cellLeaves.forEach((leaf) => {
    assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
    const start = projection.domToSource(leaf.textNode, 0, { allowRowFallback: false });
    const end = projection.domToSource(leaf.textNode, leaf.domText.length, {
      allowRowFallback: false
    });
    assert.equal(start.offset, leaf.sourceStart);
    assert.equal(end.offset, leaf.sourceEnd);
  });

  const canonicalCell = table.cells.find((cell) => cell.canonical && cell.source === 'one');
  const exactPosition = projection.enumerateDeclaredPositions().find((position) => (
    position.offset === canonicalCell.start
  ));
  const renderedCell = document.createElement('td');
  const renderedDescendant = document.createElement('span');
  const unrelatedRendering = document.createTextNode('rendered cell geometry is unrelated');
  renderedDescendant.append(unrelatedRendering);
  renderedCell.append(renderedDescendant);
  root.childNodes[2].append(renderedCell);
  assert.equal(projection.domToSource(unrelatedRendering, 9, {
    allowRowFallback: false
  }), null, 'unregistered presentation descendants own no canonical position');
  projection.registerActivationAnchor(renderedCell, exactPosition, {
    kind: 'table-cell-background',
    semanticOwnerId: table.ownerId,
    interactionPolicy: 'editable-table-cell'
  });
  for (const descendantOffset of [0, 9, unrelatedRendering.nodeValue.length]) {
    const mapped = projection.domToSource(unrelatedRendering, descendantOffset, {
      allowRowFallback: false
    });
    assert.equal(mapped.offset, canonicalCell.start);
    assert.equal(mapped.affinity, exactPosition.affinity);
  }

  const emptyDescriptor = projection.enumeratePlanActivationAnchors().find((anchor) => (
    anchor.kind === 'table-empty-cell'
  ));
  assert.ok(emptyDescriptor, 'a canonical empty cell exposes one exact plan anchor');
  const emptyCell = document.createElement('td');
  const emptyCaret = document.createTextNode('\u200b');
  emptyCell.append(emptyCaret);
  root.childNodes[3].append(emptyCell);
  projection.registerPlanActivationAnchor(emptyCell, emptyDescriptor.anchorId);
  const emptyMapped = projection.domToSource(emptyCaret, 1, { allowRowFallback: false });
  assert.equal(emptyMapped.offset, emptyDescriptor.position.offset);
  assert.equal(emptyMapped.affinity, emptyDescriptor.position.affinity);

  const mountSource = functionSource('mountEditableTablePresentations');
  assert.match(mountSource, /leaf\.kind === 'table-cell'/);
  assert.match(mountSource, /renderedCell\.replaceChildren\(\.\.\.cellLeaves\.map\(\(leaf\) => leaf\.element\)\)/);
  assert.match(mountSource, /projection\.registerActivationAnchor\(renderedCell, position,/);
  assert.match(mountSource, /kind: 'table-cell-end-caret'/);
  assert.match(mountSource, /restoreTarget: true/,
    'a nonempty cell end remains a visible canonical caret target');
  assert.doesNotMatch(mountSource, /clientX[^]*?\/[^]*?(?:width|length)|Math\.round\([^]*?(?:width|length)/,
    'rendered descendants must never proportionally guess a table source offset');
});

test('Live table mount marks semantic empty cells without creation-history state', () => {
  const source = [
    '| A | B | C |',
    '| - | - | - |',
    '| one |  | three |',
    '|  |  |  |'
  ].join('\n');
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const cells = descendants(rendered.bodyRoot).filter((node) => (
    node?.dataset?.markdownEditableTableCell === 'true'
  ));
  const emptyCells = cells.filter((cell) => (
    cell.dataset.markdownEditableTableCellEmpty === 'true'
  ));

  assert.equal(cells.length, 9);
  assert.equal(emptyCells.length, 4);
  assert.deepEqual(emptyCells.map((cell) => [
    cell.dataset.markdownTableRowIndex,
    cell.dataset.markdownTableColumnIndex
  ]), [['0', '1'], ['1', '0'], ['1', '1'], ['1', '2']]);
  assert.ok(cells.filter((cell) => !emptyCells.includes(cell)).every((cell) => (
    cell.dataset.markdownEditableTableCellEmpty === 'false'
  )));
  assert.ok(cells.every((cell) => (
    !Object.keys(cell.dataset).some((key) => /insert|create|manual|fresh/i.test(key))
  )), 'cell presentation metadata derives only from current parsed semantics');
});

test('Live table pointer mapping uses the clicked projected character and keeps cell ends visible', () => {
  let caretOffset = 3;
  const cell = new FakeElement({
    dataset: {
      markdownEditableTableCell: 'true',
      markdownEditablePresentationOwner: 'table-owner',
      markdownTableRowIndex: '0',
      markdownTableColumnIndex: '0'
    },
    tagName: 'td'
  });
  const projectedLeaf = new FakeElement({ tagName: 'span' });
  projectedLeaf.textContent = 'Name';
  cell.append(projectedLeaf);
  const bodyRoot = new FakeElement();
  bodyRoot.append(cell);
  const fallback = {
    sourceVersion: 1,
    physicalLineId: 'line-1',
    logicalColumn: 2,
    offset: 2,
    affinity: 'after',
    visibility: 'visible',
    interactionPolicy: 'editable-table-cell'
  };
  const projection = {
    domToSource(node, offset) {
      if (node !== projectedLeaf.firstChild) return null;
      return {
        ...fallback,
        logicalColumn: 2 + offset,
        offset: 2 + offset,
        visibility: offset === 4 ? 'source-only' : 'visible',
        interactionPolicy: offset === 4 ? 'activate-table-source' : 'editable-table-cell'
      };
    },
    pointerToPosition() {
      return fallback;
    }
  };
  const view = loadMarkdownPageViewInternals([
    'editableTableCellPointerPosition',
    'editablePointerPosition'
  ], {
    globalThis: {
      markdownEditableFoundation: foundation,
      markdownEditableProjection: projectionRuntime,
      markdownEditableSyntaxAdapters: syntaxAdapters
    },
    document: {
      caretPositionFromPoint() {
        return { offsetNode: projectedLeaf.firstChild, offset: caretOffset };
      }
    }
  });
  const state = {
    bodyRoot,
    mode: 'live-preview',
    editableProjection: projection,
    editablePresentationPlan: {
      constructs: {
        tables: [{
          ownerId: 'table-owner',
          start: 0,
          cells: [{
            canonical: true,
            header: false,
            rowIndex: 0,
            columnIndex: 0,
            start: 2,
            end: 6
          }]
        }]
      }
    },
    editableActiveTableCell: {
      tableStart: 0,
      header: false,
      rowIndex: 0,
      columnIndex: 0
    }
  };

  const interior = view.editablePointerPosition(state, {
    target: projectedLeaf,
    clientX: 10,
    clientY: 10
  });
  assert.equal(interior.offset, 5, 'the clicked character offset is preserved');
  assert.equal(interior.visibility, 'visible');
  assert.equal(interior.interactionPolicy, 'editable-table-cell');

  caretOffset = 4;
  const end = view.editablePointerPosition(state, {
    target: projectedLeaf,
    clientX: 12,
    clientY: 10
  });
  assert.equal(end.offset, 6, 'the visual cell end maps to the exact canonical cell end');
  assert.equal(end.visibility, 'visible');
  assert.equal(end.interactionPolicy, 'editable-table-cell');
});

test('Live table structural positions resolve to cell boundaries without activating raw source', () => {
  const source = [
    '| Name | Score |',
    '| --- | ---: |',
    '| A | 5 |',
    '| B | 8 |'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const plan = syntaxAdapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const { projection } = createCertificationProjection(snapshot, 'live-preview', {
    presentationPlan: plan
  });
  const view = loadController([
    'editableActiveStateForSelection',
    'ensureEditableSelectionVisible'
  ]);
  const state = {
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version,
    mode: 'live-preview',
    editableProjection: projection,
    editablePresentationPlan: plan,
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set()
  };
  const table = plan.constructs.tables[0];
  const structural = projection.enumerateDeclaredPositions().find((position) => (
    table.start <= position.offset
      && position.offset <= table.end
      && position.interactionPolicy === 'activate-table-source'
  ));
  assert.ok(structural);

  const active = view.editableActiveStateForSelection(state, {
    anchor: structural,
    focus: structural
  });
  assert.deepEqual([...active.ownerIds], [],
    'hidden table structure is never a generic active-source owner');

  const visible = view.ensureEditableSelectionVisible(state, {
    anchor: structural,
    focus: structural
  }, { direction: 'ArrowRight' });
  assert.equal(visible.anchor.visibility, 'visible');
  assert.equal(visible.anchor.interactionPolicy, 'editable-table-cell');
  assert.ok(table.cells.some((cell) => (
    cell.canonical
      && (visible.anchor.offset === cell.start || visible.anchor.offset === cell.end)
  )), 'navigation lands only on an exact canonical cell boundary');
  assert.equal(plan.constructs.tables[0].activeRaw, false);
});

test('Live table cell adapter owns content edits and rejects structural byte targets', () => {
  const source = [
    '| Name | Score |',
    '| --- | ---: |',
    '| A | 5 |',
    '| B | 8 |'
  ].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'applyEditableTableCellTextInput',
    'applyEditableTableCellDeletion'
  ]);
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const cell = () => rendered.state.editablePresentationPlan.constructs.tables[0]
    .rows[0][0];

  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'backward',
    { anchor: cell().start, focus: cell().start }
  ), true);
  assert.equal(rendered.state.body, source, 'Backspace at cell start cannot consume padding or a pipe');
  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'forward',
    { anchor: cell().end, focus: cell().end }
  ), true);
  assert.equal(rendered.state.body, source, 'Delete at cell end cannot consume padding or a pipe');

  const pipe = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell().end, focus: cell().end },
    '|'
  );
  assert.equal(pipe.handled, true);
  assert.match(rendered.state.body, /\| A\\\| \| 5 \|/);
  assert.equal(markdown.parseMarkdownTableStructure(rendered.state.body, 0).columnCount, 2,
    'a literal pipe is escaped as cell content instead of becoming a column');
  assert.equal(rendered.state.editablePresentationPlan.constructs.tables[0].activeRaw, false);

  const beforeLineBreak = rendered.state.body;
  const lineBreak = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell().end, focus: cell().end },
    '\n'
  );
  assert.equal(lineBreak.handled, true);
  assert.equal(rendered.state.body, beforeLineBreak,
    'Enter-style input is claimed without splitting the canonical table row');

  const pasted = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell().end, focus: cell().end },
    ' x\n|y',
    { inputType: 'insertFromPaste', normalizeLineBreaks: true }
  );
  assert.equal(pasted.handled, true);
  assert.match(rendered.state.body, /A\\\| x \\\|y/);
  assert.equal(markdown.parseMarkdownTableStructure(rendered.state.body, 0).columnCount, 2);

  const table = rendered.state.editablePresentationPlan.constructs.tables[0];
  const first = table.rows[0][0];
  const second = table.rows[0][1];
  const beforeCrossCellDelete = rendered.state.body;
  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'forward',
    { anchor: first.end, focus: second.start }
  ), true);
  assert.equal(rendered.state.body, beforeCrossCellDelete,
    'a cross-cell destructive selection cannot consume canonical separators');

  const paddedSource = [
    '| H1 | H2 | H3 | H4 |',
    '| --- | --- | --- | --- |',
    '| A\\|B | C | D |'
  ].join('\n');
  const padded = renderEditableFixture(view, paddedSource);
  padded.state.editHistory = view.createMarkdownEditHistory(paddedSource);
  const escaped = padded.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  assert.equal(view.applyEditableTableCellDeletion(
    padded.state,
    'backward',
    { anchor: escaped.start + 2, focus: escaped.start + 2 }
  ), true);
  assert.equal(padded.state.body, paddedSource,
    'deleting an escape cannot reclassify its pipe as a delimiter in a padded row');
});

test('Live table cells retain user-entered boundary and empty-cell Spaces canonically', async (t) => {
  const source = [
    '| First | Second | Empty |',
    '| --- | --- | --- |',
    '| Alpha | Beta |  |'
  ].join('\n');
  const cases = [
    {
      name: 'cell start',
      columnIndex: 0,
      offset: (cell) => cell.start,
      logicalSource: ' Alpha',
      followedByText: ' xAlpha'
    },
    {
      name: 'cell end',
      columnIndex: 0,
      offset: (cell) => cell.end,
      logicalSource: 'Alpha ',
      followedByText: 'Alpha x'
    },
    {
      name: 'empty cell',
      columnIndex: 2,
      offset: (cell) => cell.start,
      logicalSource: ' ',
      followedByText: ' x'
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const browserSelection = createBrowserSelection();
      const view = loadController([
        'renderEditableDocumentBlocks',
        'editableVisibleTableCellPosition',
        'applyEditableTableCellTextInput',
        'applyMarkdownEditHistory'
      ], {
        window: { getSelection: () => browserSelection },
        document: { getSelection: () => browserSelection }
      });
      const rendered = renderEditableFixture(view, source);
      rendered.state.editHistory = view.createMarkdownEditHistory(source);
      const initialTable = rendered.state.editablePresentationPlan.constructs.tables[0];
      const initialCell = initialTable.rows[0][fixture.columnIndex];
      const editOffset = fixture.offset(initialCell);
      const activation = rendered.projection.enumerateDeclaredPositions().find((position) => (
        position.offset === editOffset
          && (position.interactionPolicy === 'editable-table-cell'
            || position.interactionPolicy === 'activate-table-source')
      ));
      assert.ok(activation);
      const activePosition = view.editableVisibleTableCellPosition(rendered.state, activation);
      assert.ok(activePosition);
      assert.equal(rendered.projection.restoreSelection({
        anchor: activePosition,
        focus: activePosition
      }), true);

      const elements = () => descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
      const tableElement = elements().find((node) => node.classList.contains('markdown-page-table'));
      const cellElements = elements().filter((node) => (
        node.dataset.markdownEditableTableCell === 'true'
      ));
      const expectedSource = `${source.slice(0, editOffset)} ${source.slice(editOffset)}`;
      const result = view.applyEditableTableCellTextInput(
        rendered.state,
        { anchor: editOffset, focus: editOffset },
        ' ',
        { coalesceHistory: false }
      );

      assert.equal(result?.handled, true);
      assert.equal(result?.changed, true);
      assert.equal(result?.replacement, ' ');
      assert.equal(result?.caret, editOffset + 1);
      assert.equal(result?.reconciled, true);
      assert.equal(rendered.state.body, expectedSource);
      assert.equal(rendered.state.sourceSnapshot.markdownBody, expectedSource);
      assert.equal(rendered.state.editHistory.undoStack.length, 1);
      assert.equal(rendered.state.editHistory.undoStack[0].primaryEdit.start, editOffset);
      assert.equal(rendered.state.editHistory.undoStack[0].primaryEdit.end, editOffset);
      assert.equal(rendered.state.editHistory.undoStack[0].primaryEdit.replacement, ' ');
      assert.equal(rendered.state.editHistory.undoStack[0].beforeSource, source);
      assert.equal(rendered.state.editHistory.undoStack[0].afterSource, expectedSource);

      const nextTable = rendered.state.editablePresentationPlan.constructs.tables[0];
      const nextCell = nextTable.rows[0][fixture.columnIndex];
      const active = rendered.state.editableActiveTableCell;
      assert.equal(
        expectedSource.slice(active.effectiveStart, active.effectiveEnd),
        fixture.logicalSource
      );
      assert.equal(nextCell.source, fixture.columnIndex === 2 ? '' : 'Alpha',
        'the parser keeps its ordinary table-padding interpretation');
      assert.equal(nextTable.columnCount, initialTable.columnCount);
      assert.equal(nextTable.rows.length, initialTable.rows.length);
      assert.deepEqual(nextTable.alignments, initialTable.alignments);
      assert.equal(elements().find((node) => node.classList.contains('markdown-page-table')), tableElement);
      elements().filter((node) => (
        node.dataset.markdownEditableTableCell === 'true'
      )).forEach((cellElement, index) => {
        assert.equal(cellElement, cellElements[index], `cell ${index} retains identity`);
      });
      const caret = rendered.projection.getSelection()?.focus;
      assert.equal(caret?.offset, editOffset + 1);
      assert.equal(caret?.interactionPolicy, 'editable-table-cell',
        'the canonical caret after the Space remains cell-owned');
      const followingText = view.applyEditableTableCellTextInput(
        rendered.state,
        { anchor: result.caret, focus: result.caret },
        'x',
        { coalesceHistory: false }
      );
      assert.equal(followingText?.changed, true);
      assert.equal(followingText?.reconciled, true);
      assert.equal(
        rendered.state.body.slice(
          rendered.state.editableActiveTableCell.effectiveStart,
          rendered.state.editableActiveTableCell.effectiveEnd
        ),
        fixture.followedByText
      );
      const finalSource = rendered.state.body;
      assert.equal(view.applyMarkdownEditHistory(rendered.state, 'undo'), true);
      assert.equal(rendered.state.body, expectedSource);
      assert.equal(rendered.state.sourceSnapshot.markdownBody, expectedSource);
      assert.equal(view.applyMarkdownEditHistory(rendered.state, 'undo'), true);
      assert.equal(rendered.state.body, source);
      assert.equal(rendered.state.sourceSnapshot.markdownBody, source);
      assert.equal(view.applyMarkdownEditHistory(rendered.state, 'redo'), true);
      assert.equal(rendered.state.body, expectedSource);
      assert.equal(rendered.state.sourceSnapshot.markdownBody, expectedSource);
      assert.equal(view.applyMarkdownEditHistory(rendered.state, 'redo'), true);
      assert.equal(rendered.state.body, finalSource);
      assert.equal(rendered.state.sourceSnapshot.markdownBody, finalSource);
    });
  }
});

test('Live table boundary Space remains owned by the next ordinary character', () => {
  const source = [
    '| First | Second | Empty |',
    '| --- | --- | --- |',
    '| hello | Beta |  |'
  ].join('\n');
  const browserSelection = createBrowserSelection();
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput',
    'applyEditableTableCellDeletion'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  let cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const activation = rendered.projection.enumerateDeclaredPositions().find((position) => (
    position.offset === cell.end
  ));
  const activePosition = view.editableVisibleTableCellPosition(rendered.state, activation);
  assert.ok(activePosition);
  assert.equal(rendered.projection.restoreSelection({
    anchor: activePosition,
    focus: activePosition
  }), true);

  const space = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.end, focus: cell.end },
    ' '
  );
  assert.equal(space?.changed, true);
  assert.equal(space?.reconciled, true);
  const word = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: space.caret, focus: space.caret },
    'world'
  );
  assert.equal(word?.changed, true);
  assert.equal(word?.reconciled, true);
  assert.match(rendered.state.body, /\| hello world \| Beta \|  \|$/);
  cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  assert.equal(cell.source, 'hello world');

  const secondSpace = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.end, focus: cell.end },
    ' '
  );
  const thirdSpace = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: secondSpace.caret, focus: secondSpace.caret },
    ' '
  );
  assert.equal(thirdSpace?.changed, true);
  assert.equal(
    rendered.state.body.slice(
      rendered.state.editableActiveTableCell.effectiveStart,
      rendered.state.editableActiveTableCell.effectiveEnd
    ),
    'hello world  '
  );
  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'backward',
    { anchor: thirdSpace.caret, focus: thirdSpace.caret }
  ), true);
  assert.equal(
    rendered.state.body.slice(
      rendered.state.editableActiveTableCell.effectiveStart,
      rendered.state.editableActiveTableCell.effectiveEnd
    ),
    'hello world '
  );
  const beforeStructuralDelete = rendered.state.body;
  cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'forward',
    { anchor: rendered.state.editableActiveTableCell.effectiveEnd, focus: rendered.state.editableActiveTableCell.effectiveEnd }
  ), true);
  assert.equal(rendered.state.body, beforeStructuralDelete,
    'Delete at the authored range end still cannot consume table padding or a pipe');
});

test('Live table cells retain whitespace-only editing intent after semantic content is removed', () => {
  const source = ['| First |', '| --- |', '| Alpha |'].join('\n');
  const browserSelection = createBrowserSelection();
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput',
    'applyMarkdownEditHistory'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const initialCell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const activation = rendered.projection.enumerateDeclaredPositions().find((position) => (
    position.offset === initialCell.start
      && position.interactionPolicy === 'editable-table-cell'
  ));
  assert.ok(view.editableVisibleTableCellPosition(rendered.state, activation));

  const whitespaceOnly = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: initialCell.start, focus: initialCell.end },
    ' ',
    { coalesceHistory: false }
  );
  assert.equal(whitespaceOnly?.changed, true);
  assert.equal(whitespaceOnly?.reconciled, true);
  assert.equal(
    rendered.state.body.slice(
      rendered.state.editableActiveTableCell.effectiveStart,
      rendered.state.editableActiveTableCell.effectiveEnd
    ),
    ' '
  );
  assert.equal(
    rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0].source,
    '',
    'the parser still treats the authored boundary Space as ordinary table padding'
  );
  assert.equal(rendered.projection.getSelection()?.focus?.offset, whitespaceOnly.caret);

  const secondSpace = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: whitespaceOnly.caret, focus: whitespaceOnly.caret },
    ' ',
    { coalesceHistory: false }
  );
  assert.equal(secondSpace?.changed, true);
  assert.equal(secondSpace?.reconciled, true);
  assert.equal(
    rendered.state.body.slice(
      rendered.state.editableActiveTableCell.effectiveStart,
      rendered.state.editableActiveTableCell.effectiveEnd
    ),
    '  '
  );
  const spacedSource = rendered.state.body;
  assert.equal(rendered.state.editHistory.undoStack.length, 2);
  assert.equal(view.applyMarkdownEditHistory(rendered.state, 'undo'), true);
  assert.equal(
    rendered.state.body.slice(
      rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0].outerStart,
      rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0].outerEnd
    ),
    '|   |'
  );
  assert.equal(view.applyMarkdownEditHistory(rendered.state, 'redo'), true);
  assert.equal(rendered.state.body, spacedSource);
});

test('table boundary Space beforeinput commits canonically and prevents native DOM mutation', () => {
  const source = ['| First |', '| --- |', '| Alpha |'].join('\n');
  const cell = markdown.parseMarkdownTableStructure(source, 0).rows[0][0];
  const browserSelection = createBrowserSelection();
  const view = loadController([
    'renderSemanticDocument',
    'editableVisibleTableCellPosition',
    'projectionPositionAtOffset'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const mounted = mountMarkdownImeFixture(view, source, browserSelection, {
    anchor: cell.end,
    id: 'table-boundary-space-beforeinput'
  });
  const sourcePosition = mounted.state.editableProjection.getSelection().focus;
  const activePosition = view.editableVisibleTableCellPosition(
    mounted.state,
    sourcePosition
  );
  assert.ok(activePosition);
  assert.equal(mounted.state.editableProjection.restoreSelection({
    anchor: activePosition,
    focus: activePosition
  }), true);
  const inserted = createMarkdownEvent({
    target: mounted.bodyRoot,
    inputType: 'insertText',
    data: ' ',
    isComposing: false,
    cancelable: true
  });
  dispatchMarkdownBodyEvent(mounted.bodyRoot, 'beforeinput', inserted.event);

  assert.equal(inserted.calls.preventDefault, 1);
  assert.equal(inserted.event.defaultPrevented, true);
  assert.equal(mounted.state.body, ['| First |', '| --- |', '| Alpha  |'].join('\n'));
  assert.equal(mounted.state.editHistory.undoStack.length, 1);
  assert.equal(mounted.bodyInputs.length, 1,
    'canonical input notification replaces, rather than follows, native DOM mutation');

  const restored = mounted.state.editableProjection.getSelection();
  assert.equal(restored?.focus?.offset, cell.end + 1);
  const following = createMarkdownEvent({
    target: mounted.bodyRoot,
    inputType: 'insertText',
    data: 'x',
    isComposing: false,
    cancelable: true
  });
  dispatchMarkdownBodyEvent(mounted.bodyRoot, 'beforeinput', following.event);
  assert.equal(following.calls.preventDefault, 1);
  assert.equal(mounted.state.body, ['| First |', '| --- |', '| Alpha x |'].join('\n'));
  assert.equal(mounted.state.editHistory.undoStack.length, 1,
    'the native beforeinput sequence remains one coalesced typing history group');
  assert.equal(mounted.bodyInputs.length, 2);
});

function performanceTableFixture(rowCount, columnCount) {
  const header = Array.from({ length: columnCount }, (_unused, index) => `H${index + 1}`);
  const delimiter = Array.from({ length: columnCount }, (_unused, index) => (
    index % 3 === 0 ? ':---' : index % 3 === 1 ? ':---:' : '---:'
  ));
  const rows = Array.from({ length: rowCount - 1 }, (_unused, rowIndex) => (
    Array.from({ length: columnCount }, (_cell, columnIndex) => (
      (rowIndex + columnIndex) % 5 === 0
        ? `long-${rowIndex}-${columnIndex}-content`
        : `r${rowIndex + 1}c${columnIndex + 1}`
    ))
  ));
  return [header, delimiter, ...rows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

test('ordinary Live table typing reconciles exact revisions without remounting table DOM', async (t) => {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput',
    'applyEditableTableCellDeletion'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });

  for (const [rowCount, columnCount] of [[3, 3], [10, 8], [40, 10]]) {
    await t.test(`${rowCount}x${columnCount}`, () => {
      const source = performanceTableFixture(rowCount, columnCount);
      const rendered = renderEditableFixture(view, source);
      rendered.state.editHistory = view.createMarkdownEditHistory(source);
      const initialTablePlan = rendered.state.editablePresentationPlan.constructs.tables[0];
      const initialCellPlan = initialTablePlan.rows[Math.max(0, rowCount - 2)][
        Math.floor(columnCount / 2)
      ];
      const activationOffset = initialCellPlan.start + Math.min(1, initialCellPlan.source.length);
      const initialPosition = rendered.projection.enumerateDeclaredPositions().find((position) => (
        position.offset === activationOffset
          && position.interactionPolicy === 'editable-table-cell'
      ));
      assert.ok(initialPosition);
      assert.ok(view.editableVisibleTableCellPosition(
        rendered.state,
        initialPosition
      ));

      const elements = () => descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
      const tableElement = elements().find((node) => node.classList.contains('markdown-page-table'));
      const cellElements = elements().filter((node) => (
        node.dataset.markdownEditableTableCell === 'true'
      ));
      const activeCellElement = cellElements.find((node) => (
        node.dataset.markdownEditableTableCellActive === 'true'
      ));
      const projectedLeaf = descendants(activeCellElement).find((node) => (
        node?.dataset?.markdownProjectedLeaf === 'true'
      ));
      const projectedText = projectedLeaf?.firstChild;
      assert.ok(tableElement && activeCellElement && projectedText);
      assert.equal(cellElements.length, rowCount * columnCount);

      const unitBurst = rowCount >= 40 ? 'abc' : rowCount >= 10 ? 'abcdef' : 'abcdefghij';
      for (const character of unitBurst) {
        const tablePlan = rendered.state.editablePresentationPlan.constructs.tables[0];
        const cellPlan = tablePlan.rows[Math.max(0, rowCount - 2)][Math.floor(columnCount / 2)];
        const result = view.applyEditableTableCellTextInput(
          rendered.state,
          { anchor: cellPlan.end, focus: cellPlan.end },
          character
        );
        assert.equal(result?.reconciled, true);
        assert.equal(
          elements().find((node) => node.classList.contains('markdown-page-table')) === tableElement,
          true,
          'the table element retains identity'
        );
        const currentCells = elements().filter((node) => (
          node.dataset.markdownEditableTableCell === 'true'
        ));
        assert.equal(currentCells.length, cellElements.length);
        currentCells.forEach((cell, index) => {
          assert.equal(cell === cellElements[index], true, `cell ${index} retains identity`);
        });
        assert.equal(descendants(activeCellElement).find((node) => (
          node?.dataset?.markdownProjectedLeaf === 'true'
        ))?.firstChild === projectedText, true, 'the active Text node retains identity');
      }

      for (let index = 0; index < Math.min(4, unitBurst.length); index += 1) {
        const tablePlan = rendered.state.editablePresentationPlan.constructs.tables[0];
        const cellPlan = tablePlan.rows[Math.max(0, rowCount - 2)][Math.floor(columnCount / 2)];
        assert.equal(view.applyEditableTableCellDeletion(
          rendered.state,
          'backward',
          { anchor: cellPlan.end, focus: cellPlan.end }
        ), true);
        assert.ok(rendered.state.editableTableReconciliationDiagnostics);
        assert.equal(
          elements().find((node) => node.classList.contains('markdown-page-table')) === tableElement,
          true,
          'deletion keeps the table element mounted'
        );
      }

      rendered.projection.enumerateDeclaredPositions().forEach((position) => {
        const dom = rendered.projection.sourceToDom(position);
        assert.ok(dom, `missing DOM point for ${positionKey(position)}`);
        assert.equal(positionKey(rendered.projection.domToSource(dom.node, dom.offset)), positionKey(position));
      });
    });
  }
});

test('an active empty Live table cell changes leaf topology without remounting its table or cell', () => {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput',
    'applyEditableTableCellDeletion'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const source = [
    '| Empty | Value |',
    '| --- | --- |',
    '|  | retained |'
  ].join('\n');
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const emptyAnchor = rendered.projection.enumeratePlanActivationAnchors().find((anchor) => (
    anchor.kind === 'table-empty-cell' && anchor.rowIndex === 0 && anchor.columnIndex === 0
  ));
  assert.ok(emptyAnchor);
  assert.ok(view.editableVisibleTableCellPosition(rendered.state, emptyAnchor.position));

  const elements = () => descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
  const tableElement = elements().find((node) => node.classList.contains('markdown-page-table'));
  const activeCell = elements().find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  ));
  const originalEmptyHost = activeCell.querySelector('.markdown-editable-table-empty-cell');
  const retainedCell = elements().find((node) => (
    node.dataset.markdownEditableTableCell === 'true'
      && node.dataset.markdownTableRowIndex === '0'
      && node.dataset.markdownTableColumnIndex === '1'
  ));
  assert.ok(tableElement && activeCell && originalEmptyHost && retainedCell);

  let cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const inserted = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.start, focus: cell.start },
    'q'
  );
  assert.equal(inserted?.reconciled, true);
  assert.equal(rendered.state.editableTableReconciliationDiagnostics.leavesCreated, 2);
  assert.equal(rendered.state.editableTableReconciliationDiagnostics.leavesRemoved, 0);
  assert.equal(tableElement.parentNode !== null, true);
  assert.equal(activeCell.parentNode !== null, true);
  assert.equal(retainedCell.parentNode !== null, true);
  assert.equal(originalEmptyHost.parentNode, null);
  assert.equal(elements().find((node) => node.classList.contains('markdown-page-table')), tableElement);
  assert.equal(elements().find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  )), activeCell);
  const projectedLeaf = activeCell.querySelector('[data-markdown-projected-leaf="true"]');
  const endHost = activeCell.querySelector('.markdown-editable-table-cell-end-caret');
  assert.equal(projectedLeaf?.textContent, 'q');
  assert.ok(endHost);
  assert.equal(rendered.projection.enumeratePlanActivationAnchors().some((anchor) => (
    anchor.kind === 'table-empty-cell' && anchor.rowIndex === 0 && anchor.columnIndex === 0
  )), false);

  cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'backward',
    { anchor: cell.end, focus: cell.end }
  ), true);
  assert.equal(rendered.state.body, source);
  assert.equal(rendered.state.editableTableReconciliationDiagnostics.leavesCreated, 0);
  assert.equal(rendered.state.editableTableReconciliationDiagnostics.leavesRemoved, 2);
  assert.equal(projectedLeaf.parentNode, null);
  assert.equal(endHost.parentNode, null);
  assert.equal(elements().find((node) => node.classList.contains('markdown-page-table')), tableElement);
  assert.equal(elements().find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  )), activeCell);
  const replacementEmptyHost = activeCell.querySelector('.markdown-editable-table-empty-cell');
  assert.ok(replacementEmptyHost);
  assert.notEqual(replacementEmptyHost, originalEmptyHost);
  assert.ok(rendered.projection.enumeratePlanActivationAnchors().some((anchor) => (
    anchor.kind === 'table-empty-cell' && anchor.rowIndex === 0 && anchor.columnIndex === 0
  )));
  const emptySelection = rendered.state.editableProjection.getSelection();
  const firstSpace = view.applyEditableTableCellTextInput(
    rendered.state,
    {
      anchor: emptySelection.anchor.offset,
      focus: emptySelection.focus.offset
    },
    ' ',
    { coalesceHistory: false }
  );
  assert.equal(firstSpace?.changed, true);
  assert.equal(firstSpace?.reconciled, true);
  const secondSpace = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: firstSpace.caret, focus: firstSpace.caret },
    ' ',
    { coalesceHistory: false }
  );
  assert.equal(secondSpace?.changed, true);
  assert.equal(secondSpace?.reconciled, true);
  assert.equal(
    rendered.state.body.slice(
      rendered.state.editableActiveTableCell.effectiveStart,
      rendered.state.editableActiveTableCell.effectiveEnd
    ),
    '  ',
    'an emptied cell retains repeated user-entered Spaces as canonical editing intent'
  );
  assert.equal(rendered.state.editableProjection.getSelection()?.focus?.offset,
    secondSpace.caret,
    'the visible empty host remains anchored at the authored range end');
  assert.equal(elements().find((node) => node.classList.contains('markdown-page-table')),
    tableElement);
  assert.equal(elements().find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  )), activeCell);
  rendered.projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = rendered.projection.sourceToDom(position);
    assert.ok(dom, `missing DOM point for ${positionKey(position)}`);
    assert.equal(positionKey(rendered.projection.domToSource(dom.node, dom.offset)), positionKey(position));
  });
});

test('table-cell IME keeps provisional DOM view-local and settles once without remounting', () => {
  const browserSelection = createBrowserSelection();
  const timers = createTimerQueue();
  const view = loadController([
    'renderSemanticDocument',
    'editableVisibleTableCellPosition',
    'applyMarkdownEditHistory'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection },
    globalThis: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout
    }
  });
  const source = [
    '| Term | Value |',
    '| --- | --- |',
    '|  | stable |'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const bodyRoot = new FakeElement();
  bodyRoot.isConnected = true;
  const bodyInputs = [];
  const state = {
    body: source,
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version,
    bodyRoot,
    mode: 'live-preview',
    pageEditMode: false,
    bodyReadOnly: false,
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set(),
    editableForcedRawOwnerIds: new Set(),
    editHistory: view.createMarkdownEditHistory(source),
    page: { id: 'table-ime' },
    paneId: 'pane-table-ime',
    onBodyInput: (detail) => bodyInputs.push(detail)
  };
  installFixtureLinkArrowController(view, state);
  view.renderSemanticDocument(state, bodyRoot);
  const initialEmptyCell = state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const expectedComposedSource = `${source.slice(0, initialEmptyCell.start)}`
    + `你${source.slice(initialEmptyCell.end)}`;
  const emptyAnchor = state.editableProjection.enumeratePlanActivationAnchors().find((anchor) => (
    anchor.kind === 'table-empty-cell' && anchor.rowIndex === 0 && anchor.columnIndex === 0
  ));
  const activePosition = view.editableVisibleTableCellPosition(state, emptyAnchor.position);
  assert.ok(state.editableProjection.restoreSelection({
    anchor: activePosition,
    focus: activePosition
  }));
  const elements = () => descendants(bodyRoot).filter((node) => node?.nodeType === 1);
  const tableElement = elements().find((node) => node.classList.contains('markdown-page-table'));
  const activeCell = elements().find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  ));
  const stableCell = elements().find((node) => (
    node.dataset.markdownEditableTableCell === 'true'
      && node.dataset.markdownTableRowIndex === '0'
      && node.dataset.markdownTableColumnIndex === '1'
  ));
  assert.ok(tableElement && activeCell && stableCell);

  const initialVersion = state.sourceVersion;
  const initialProjectionVersion = state.editableProjection.snapshot().sourceVersion;
  bodyRoot.listeners.get('compositionstart')[0]({});
  const mutation = nativeCompositionMutation(browserSelection);
  for (const data of ['n', 'ni']) {
    const provisional = dispatchNativeCompositionRevision(bodyRoot, mutation, data);
    assert.deepEqual(provisional.calls, {
      preventDefault: 0,
      stopPropagation: 1,
      stopImmediatePropagation: 0
    }, 'native composition owns provisional table DOM');
    assert.equal(state.body, source, 'provisional text is not canonical Page source');
    assert.equal(state.sourceVersion, initialVersion);
    assert.equal(state.editableProjection.snapshot().sourceVersion, initialProjectionVersion);
    assert.equal(state.editHistory.undoStack.length, 0);
    assert.equal(bodyInputs.length, 0, 'provisional text is not published to another Pane');
    assert.equal(mutation.host.parentNode !== null, true,
      'the native composition host stays mounted until settlement');
    assert.equal(elements().find((node) => node.classList.contains('markdown-page-table')), tableElement);
    assert.equal(elements().find((node) => (
      node.dataset.markdownEditableTableCellActive === 'true'
    )), activeCell);
    assert.equal(stableCell.parentNode !== null, true);
  }

  bodyRoot.listeners.get('compositionend')[0]({ data: '你' });
  assert.equal(timers.size, 1, 'compositionend defers settlement for the browser final tail');
  assert.equal(state.body, source);
  assert.equal(state.editHistory.undoStack.length, 0);
  const finalTail = createMarkdownEvent({
    target: bodyRoot,
    inputType: 'insertFromComposition',
    data: '你',
    isComposing: false
  });
  dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', finalTail.event);
  assert.deepEqual(finalTail.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 0
  });
  assert.equal(timers.size, 0, 'the final tail consumes the deferred settlement timer');

  assert.equal(state.body, expectedComposedSource);
  assert.equal(bodyInputs.length, 1, 'settlement publishes one canonical source revision');
  assert.equal(state.editHistory.undoStack.length, 1);
  assert.equal(state.editHistory.undoStack[0].inputType, 'insertCompositionText');
  assert.equal(state.editableComposition, null);
  assert.equal(state.editableProjection.snapshot().sourceVersion, state.sourceVersion);
  assert.equal(elements().find((node) => node.classList.contains('markdown-page-table')), tableElement);
  assert.equal(elements().find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  )), activeCell);
  assert.equal(stableCell.parentNode !== null, true);
  assert.equal(view.applyMarkdownEditHistory(state, 'undo'), true);
  assert.equal(state.body, source);
  assert.equal(view.applyMarkdownEditHistory(state, 'redo'), true);
  assert.equal(state.body, expectedComposedSource);
});

test('IME-owned Enter stays native across Markdown Live contexts and the next Enter stays ordinary', async (t) => {
  const browserSelection = createBrowserSelection();
  const timers = createTimerQueue();
  const view = loadController([
    'renderSemanticDocument',
    'projectionPositionAtOffset',
    'editableVisibleTableCellPosition',
    'applyMarkdownEditHistory'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection },
    globalThis: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout
    }
  });
  const tableSource = [
    '| Term | Value |',
    '| --- | --- |',
    '|  | stable |'
  ].join('\n');
  const populatedTableSource = [
    '| Term | Value |',
    '| --- | --- |',
    '| Alpha | stable |'
  ].join('\n');
  const fixtures = [
    { id: 'paragraph', source: 'Alpha', offset: 5 },
    { id: 'ordered-list', source: '1. Alpha', offset: 8 },
    { id: 'unordered-list', source: '- Alpha', offset: 7 },
    { id: 'table-cell', source: tableSource, table: true },
    {
      id: 'table-cell-native-normalization',
      source: populatedTableSource,
      table: true,
      tableInsertion: 'end',
      normalizeNativeCell: true
    },
    { id: 'math-adjacent', source: 'before$x$after', offset: 6 },
    {
      id: 'math-adjacent-after',
      source: 'Before $x+1$ after',
      offset: 'Before $x+1$'.length
    }
  ];
  const compositions = [
    {
      id: 'candidate', updates: ['n', 'ni', '你'], committed: '你', tailType: 'insertFromComposition'
    },
    { id: 'raw-latin', updates: ['r', 'ra', 'raw'], committed: 'raw', tailType: 'insertText' }
  ];

  for (const fixture of fixtures) {
    for (const composition of compositions) {
      await t.test(`${fixture.id} / ${composition.id}`, () => {
        const documentRef = createImeCaptureDocument();
        const bodyRoot = new FakeElement();
        bodyRoot.isConnected = true;
        markImeEditableSurface(bodyRoot, documentRef);
        const bodyInputs = [];
        const snapshot = markdown.createSourceSnapshot(fixture.source);
        const state = {
          body: fixture.source,
          sourceSnapshot: snapshot,
          sourceVersion: snapshot.version,
          bodyRoot,
          mode: 'live-preview',
          pageEditMode: false,
          bodyReadOnly: false,
          editableActiveOwnerIds: new Set(),
          editableActiveLineIds: new Set(),
          editableForcedRawOwnerIds: new Set(),
          editHistory: view.createMarkdownEditHistory(fixture.source),
          page: { id: `markdown-ime-${fixture.id}-${composition.id}` },
          paneId: `pane-ime-${fixture.id}-${composition.id}`,
          onBodyInput: (detail) => bodyInputs.push(detail)
        };
        installFixtureLinkArrowController(view, state);
        view.renderSemanticDocument(state, bodyRoot);

        let insertionOffset = fixture.offset;
        let initialPosition = null;
        if (fixture.table) {
          const fixtureCell = state.editablePresentationPlan.constructs.tables[0].rows[0][0];
          insertionOffset = fixture.tableInsertion === 'end'
            ? fixtureCell.end
            : fixtureCell.start;
          const activationPosition = fixtureCell.start === fixtureCell.end
            ? state.editableProjection.enumeratePlanActivationAnchors()
              .find((anchor) => (
                anchor.kind === 'table-empty-cell'
                  && anchor.rowIndex === 0
                  && anchor.columnIndex === 0
              ))?.position
            : state.editableProjection.enumerateDeclaredPositions().find((position) => (
              position.offset === insertionOffset
                && position.interactionPolicy === 'editable-table-cell'
            )) || view.projectionPositionAtOffset(state.editableProjection, insertionOffset);
          assert.ok(activationPosition, 'the table fixture exposes its activation owner');
          initialPosition = view.editableVisibleTableCellPosition(state, activationPosition);
        } else {
          const candidates = state.editableProjection.enumerateDeclaredPositions()
            .filter((position) => position.offset === insertionOffset);
          initialPosition = candidates.find((position) => (
            position.visibility === 'visible'
              && !String(position.interactionPolicy || '').startsWith('activate-')
          )) || view.projectionPositionAtOffset(state.editableProjection, insertionOffset);
        }
        assert.ok(initialPosition, `missing editable position at ${insertionOffset}`);
        assert.ok(state.editableProjection.restoreSelection({
          anchor: initialPosition,
          focus: initialPosition
        }));

        const elements = () => descendants(bodyRoot).filter((node) => node?.nodeType === 1);
        const tableElement = fixture.table
          ? elements().find((node) => node.classList.contains('markdown-page-table'))
          : null;
        const tableCell = fixture.table
          ? elements().find((node) => node.dataset.markdownEditableTableCellActive === 'true')
          : null;
        if (fixture.table) assert.ok(tableElement && tableCell);
        const initialListRows = state.editablePresentationPlan.constructs.listRows.length;
        const expectedComposedSource = `${fixture.source.slice(0, insertionOffset)}`
          + `${composition.committed}${fixture.source.slice(insertionOffset)}`;
        const owner = textEditingModel.installImeCompositionOwnership(documentRef);
        const initialVersion = state.sourceVersion;
        const initialProjectionVersion = state.editableProjection.snapshot().sourceVersion;

        try {
          const compositionStart = createMarkdownEvent({ target: bodyRoot }).event;
          documentRef.dispatchCapture('compositionstart', compositionStart);
          dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', compositionStart);
          const nativeMutation = nativeCompositionMutation(browserSelection);

          for (const data of composition.updates) {
            const provisional = dispatchNativeCompositionRevision(bodyRoot, nativeMutation, data);
            assert.deepEqual(provisional.calls, {
              preventDefault: 0,
              stopPropagation: 1,
              stopImmediatePropagation: 0
            }, 'provisional composition remains browser-owned and view-local');
            assert.equal(state.body, fixture.source,
              'provisional native DOM never publishes canonical Page source');
            assert.equal(state.sourceVersion, initialVersion);
            assert.equal(state.editableProjection.snapshot().sourceVersion,
              initialProjectionVersion);
            assert.equal(state.editHistory.undoStack.length, 0,
              'provisional composition does not publish history');
            assert.equal(bodyInputs.length, 0,
              'provisional composition does not publish to another Pane');
            assert.equal(nativeMutation.host.parentNode !== null, true,
              'the native projection host stays mounted throughout composition');
            if (fixture.table) {
              assert.strictEqual(elements().find((node) => (
                node.classList.contains('markdown-page-table')
              )), tableElement);
              assert.strictEqual(elements().find((node) => (
                node.dataset.markdownEditableTableCellActive === 'true'
              )), tableCell);
            }
          }

          const sourceBeforeImeEnter = state.body;
          const selectionBeforeImeEnter = state.editableProjection.getSelection();
          const selectionKeysBeforeImeEnter = {
            anchor: positionKey(selectionBeforeImeEnter.anchor),
            focus: positionKey(selectionBeforeImeEnter.focus)
          };
          const imeEnter = createMarkdownEvent({
            target: bodyRoot,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            isComposing: false,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false
          });
          documentRef.dispatchCapture('keydown', imeEnter.event);
          dispatchMarkdownBodyEvent(bodyRoot, 'keydown', imeEnter.event);
          assert.deepEqual(imeEnter.calls, {
            preventDefault: 0,
            stopPropagation: 0,
            stopImmediatePropagation: 0
          }, 'Viewer must not claim the composition-ending Enter');
          assert.equal(state.body, sourceBeforeImeEnter);
          const selectionAfterImeEnter = state.editableProjection.getSelection();
          assert.deepEqual({
            anchor: positionKey(selectionAfterImeEnter.anchor),
            focus: positionKey(selectionAfterImeEnter.focus)
          }, selectionKeysBeforeImeEnter,
            'the first Enter does not run a Markdown selection action');
          assert.equal(state.editHistory.undoStack.length, 0);
          assert.equal(state.editablePresentationPlan.constructs.listRows.length, initialListRows);
          if (fixture.table) {
            assert.strictEqual(elements().find((node) => (
              node.classList.contains('markdown-page-table')
            )), tableElement);
            assert.strictEqual(elements().find((node) => (
              node.dataset.markdownEditableTableCellActive === 'true'
            )), tableCell);
          }

          if (fixture.normalizeNativeCell) {
            const cell = state.editablePresentationPlan.constructs.tables[0].rows[0][0];
            const relativeOffset = insertionOffset - cell.start;
            tableCell.textContent = `${cell.source.slice(0, relativeOffset)}`
              + `${composition.committed}${cell.source.slice(relativeOffset)}`;
            assert.strictEqual(tableCell.parentNode !== null, true,
              'Chromium-style final input normalization keeps the TD itself mounted');
          }

          const compositionEnd = createMarkdownEvent({
            target: bodyRoot,
            data: composition.committed
          }).event;
          documentRef.dispatchCapture('compositionend', compositionEnd);
          dispatchMarkdownBodyEvent(bodyRoot, 'compositionend', compositionEnd);
          assert.equal(timers.size, 1,
            'compositionend waits for the browser final input tail');
          assert.equal(state.body, fixture.source);
          assert.equal(state.editHistory.undoStack.length, 0);
          const finalTail = createMarkdownEvent({
            target: bodyRoot,
            inputType: composition.tailType,
            data: composition.committed,
            isComposing: false
          });
          dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', finalTail.event);
          assert.deepEqual(finalTail.calls, {
            preventDefault: 1,
            stopPropagation: 1,
            stopImmediatePropagation: 0
          }, `${composition.tailType} settles the composition exactly once`);
          assert.equal(timers.size, 0);
          assert.equal(state.body, expectedComposedSource);
          assert.equal(bodyInputs.length, 1,
            'only settled canonical composition publishes to sibling Panes');
          assert.equal(state.editHistory.undoStack.length, 1,
            'composition settlement publishes exactly one history item');
          assert.equal(state.editHistory.redoStack.length, 0);
          assert.equal(state.editHistory.undoStack[0].inputType, 'insertCompositionText');
          assert.equal(state.editHistory.undoStack[0].beforeSource, fixture.source);
          assert.equal(state.editHistory.undoStack[0].afterSource, expectedComposedSource);
          assert.equal(state.editHistory.undoStack[0].afterSelection.anchor.offset,
            insertionOffset + composition.committed.length);
          assert.equal(state.editHistory.undoStack[0].afterSelection.focus.offset,
            insertionOffset + composition.committed.length);
          const settledSelection = state.editableProjection.getSelection();
          assert.equal(settledSelection.anchor.offset,
            insertionOffset + composition.committed.length);
          assert.equal(settledSelection.focus.offset,
            insertionOffset + composition.committed.length);

          for (const inputType of ['insertParagraph', 'insertLineBreak']) {
            const imeTail = createMarkdownEvent({
              target: bodyRoot,
              inputType,
              data: null,
              isComposing: false
            });
            dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', imeTail.event);
            assert.deepEqual(imeTail.calls, {
              preventDefault: 0,
              stopPropagation: 0,
              stopImmediatePropagation: 0
            }, `${inputType} from the same physical IME keypress remains native`);
            assert.equal(state.body, expectedComposedSource);
            assert.equal(state.editHistory.undoStack.length, 1);
          }
          assert.equal(state.editablePresentationPlan.constructs.listRows.length, initialListRows,
            'the IME keypress tail cannot run a list continuation or exit');
          if (fixture.table) {
            assert.ok(state.editableTableReconciliationDiagnostics,
              'composition settlement must retain the exact table reconciliation path');
            assert.strictEqual(elements().find((node) => (
              node.classList.contains('markdown-page-table')
            )), tableElement);
            assert.strictEqual(elements().find((node) => (
              node.dataset.markdownEditableTableCellActive === 'true'
            )), tableCell);
          }

          documentRef.dispatchCapture('keyup', createMarkdownEvent({
            target: bodyRoot,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            isComposing: false
          }).event);

          const composedCaret = insertionOffset + composition.committed.length;
          const expectedOrdinary = fixture.table
            ? {
                source: expectedComposedSource,
                selection: { anchor: composedCaret, focus: composedCaret }
              }
            : markdown.applyMarkdownNewline(
                expectedComposedSource,
                { anchor: composedCaret, focus: composedCaret },
                { inputType: 'insertParagraph' }
              );
          const ordinaryEnter = createMarkdownEvent({
            target: bodyRoot,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            isComposing: false,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false
          });
          documentRef.dispatchCapture('keydown', ordinaryEnter.event);
          dispatchMarkdownBodyEvent(bodyRoot, 'keydown', ordinaryEnter.event);
          assert.deepEqual(ordinaryEnter.calls, {
            preventDefault: 1,
            stopPropagation: 1,
            stopImmediatePropagation: 0
          }, 'the next ordinary Enter retains Viewer ownership');

          const ordinaryTail = createMarkdownEvent({
            target: bodyRoot,
            inputType: 'insertParagraph',
            data: null,
            isComposing: false
          });
          dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', ordinaryTail.event);
          assert.deepEqual(ordinaryTail.calls, {
            preventDefault: 1,
            stopPropagation: 1,
            stopImmediatePropagation: 0
          }, 'the ordinary beforeinput tail is claimed exactly once');
          assert.equal(state.body, expectedOrdinary.source);
          const ordinarySelection = state.editableProjection.getSelection();
          assert.equal(ordinarySelection.anchor.offset, expectedOrdinary.selection.anchor);
          assert.equal(ordinarySelection.focus.offset, expectedOrdinary.selection.focus);

          if (fixture.table) {
            assert.equal(state.editHistory.undoStack.length, 1,
              'table Enter is claimed without a source or history delta');
            assert.strictEqual(elements().find((node) => (
              node.classList.contains('markdown-page-table')
            )), tableElement);
            assert.strictEqual(elements().find((node) => (
              node.dataset.markdownEditableTableCellActive === 'true'
            )), tableCell);
            assert.equal(view.applyMarkdownEditHistory(state, 'undo'), true);
            assert.equal(state.body, fixture.source);
            assert.equal(view.applyMarkdownEditHistory(state, 'redo'), true);
            assert.equal(state.body, expectedComposedSource);
          } else {
            assert.equal(state.editHistory.undoStack.length, 2,
              'composition and the subsequent ordinary Enter remain separate history items');
            assert.equal(state.editHistory.undoStack[1].inputType, 'insertParagraph');
            assert.equal(state.editHistory.undoStack[1].beforeSource, expectedComposedSource);
            assert.equal(state.editHistory.undoStack[1].afterSource, expectedOrdinary.source);
            assert.equal(view.applyMarkdownEditHistory(state, 'undo'), true);
            assert.equal(state.body, expectedComposedSource,
              'first Undo removes only the ordinary Enter');
            assert.equal(view.applyMarkdownEditHistory(state, 'undo'), true);
            assert.equal(state.body, fixture.source,
              'second Undo removes only the settled composition');
            assert.equal(view.applyMarkdownEditHistory(state, 'redo'), true);
            assert.equal(state.body, expectedComposedSource,
              'first Redo restores only the composition');
            assert.equal(view.applyMarkdownEditHistory(state, 'redo'), true);
            assert.equal(state.body, expectedOrdinary.source,
              'second Redo restores only the ordinary Enter');
          }
        } finally {
          timers.flush();
          owner?.dispose();
        }
      });
    }
  }
});

test('final composition input tails settle exactly one canonical transaction', async (t) => {
  for (const inputType of ['insertText', 'insertFromComposition']) {
    await t.test(inputType, () => {
      const browserSelection = createBrowserSelection();
      const timers = createTimerQueue();
      const view = loadController([
        'renderSemanticDocument',
        'projectionPositionAtOffset',
        'applyMarkdownEditHistory'
      ], {
        window: { getSelection: () => browserSelection },
        document: { getSelection: () => browserSelection },
        globalThis: {
          setTimeout: timers.setTimeout,
          clearTimeout: timers.clearTimeout
        }
      });
      const source = 'Base';
      const expected = 'Base你';
      const { state, bodyRoot, bodyInputs } = mountMarkdownImeFixture(
        view,
        source,
        browserSelection,
        { id: `final-tail-${inputType}` }
      );
      const initialVersion = state.sourceVersion;
      dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', {});
      const mutation = nativeCompositionMutation(browserSelection);
      const provisional = dispatchNativeCompositionRevision(bodyRoot, mutation, 'n');
      assert.equal(provisional.event.defaultPrevented, false);
      assert.equal(state.body, source);
      assert.equal(state.sourceVersion, initialVersion);
      assert.equal(state.editHistory.undoStack.length, 0);
      assert.equal(bodyInputs.length, 0);

      dispatchMarkdownBodyEvent(bodyRoot, 'compositionend', { data: '你' });
      assert.equal(timers.size, 1);
      const tail = createMarkdownEvent({
        target: bodyRoot,
        inputType,
        data: '你',
        isComposing: false
      });
      dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', tail.event);
      assert.deepEqual(tail.calls, {
        preventDefault: 1,
        stopPropagation: 1,
        stopImmediatePropagation: 0
      });
      assert.equal(timers.size, 0);
      timers.flush();
      assert.equal(state.body, expected);
      assert.equal(bodyInputs.length, 1);
      assert.equal(state.editHistory.undoStack.length, 1);
      assert.equal(state.editHistory.undoStack[0].inputType, 'insertCompositionText');
      assert.equal(state.editableComposition, null);
      assert.equal(view.applyMarkdownEditHistory(state, 'undo'), true);
      assert.equal(state.body, source);
      assert.equal(view.applyMarkdownEditHistory(state, 'redo'), true);
      assert.equal(state.body, expected);
    });
  }
});

test('same-root presentation updates retain the one-shot final composition tail guard', () => {
  const browserSelection = createBrowserSelection();
  const documentRef = createImeCaptureDocument();
  documentRef.getSelection = () => browserSelection;
  const bodyInputs = [];
  const view = loadController(['resolveLayerState'], {
    window: { getSelection: () => browserSelection },
    document: documentRef
  });
  const area = new FakeElement();
  const stage = new FakeElement();
  area.isConnected = true;
  stage.isConnected = true;
  area.append(stage);
  const source = ['| Term | Value |', '| --- | --- |', '| x | stable |'].join('\n');
  const insertionOffset = source.lastIndexOf('x');
  const page = {
    id: 'markdown-ime-same-root-boundary',
    type: 'markdown',
    title: 'Same-root boundary',
    markdownBody: source
  };
  const layer = view.renderMarkdownPageLayer({
    page,
    stage,
    area,
    mode: 'live-preview',
    markdownStructuralFolds: [],
    onBodyInput: (detail) => bodyInputs.push(detail)
  });
  let bodyRoot = layer.querySelector('.markdown-page-body');
  const position = view.enumerateEditablePositions(layer).find((candidate) => (
    candidate.offset === insertionOffset
      && candidate.interactionPolicy === 'editable-table-cell'
  ));
  assert.ok(position);
  assert.equal(view.restoreEditableSelection(layer, {
    anchor: position,
    focus: position
  }), true);
  bodyRoot = layer.querySelector('.markdown-page-body');
  bodyRoot.isConnected = true;
  markImeEditableSurface(bodyRoot, documentRef);

  dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', {});
  const mutation = nativeCompositionMutation(browserSelection);
  dispatchNativeCompositionRevision(bodyRoot, mutation, '你');
  const state = view.resolveLayerState(layer);
  assert.deepEqual({
    latestText: state.editableComposition?.latestText,
    from: state.editableComposition?.from,
    to: state.editableComposition?.to,
    cancelled: state.editableComposition?.cancelled
  }, {
    latestText: '你',
    from: insertionOffset,
    to: insertionOffset,
    cancelled: false
  });
  assert.strictEqual(view.updateMarkdownPageLayer(layer, {
    markdownStructuralFolds: []
  }), layer);
  assert.strictEqual(layer.querySelector('.markdown-page-body'), bodyRoot,
    'an unchanged fold patch keeps the exact editable body root');
  const composed = `${source.slice(0, insertionOffset)}你${source.slice(insertionOffset)}`;
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, composed);
  assert.equal(bodyInputs.length, 1);

  const lateTail = createMarkdownEvent({
    target: bodyRoot,
    inputType: 'insertText',
    data: '你',
    isComposing: false
  });
  dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', lateTail.event);
  assert.deepEqual(lateTail.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 0
  });
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, composed,
    'the late native tail cannot duplicate the settled table-cell candidate');
  assert.equal(bodyInputs.length, 1);
});

test('composition no-op and cancellation restore exact source, selection, and history', async (t) => {
  const cases = [
    {
      id: 'exact-no-op',
      anchor: 0,
      focus: 5,
      provisional: 'Al',
      finalText: 'Alpha',
      tailType: 'insertText',
      expectedSelection: { anchor: 5, focus: 5 }
    },
    {
      id: 'collapsed-cancellation',
      anchor: 5,
      focus: 5,
      provisional: 'x',
      finalText: '',
      expectedSelection: { anchor: 5, focus: 5 }
    },
    {
      id: 'selected-range-cancellation',
      anchor: 0,
      focus: 5,
      provisional: 'x',
      finalText: '',
      expectedSelection: { anchor: 0, focus: 5 }
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.id, () => {
      const browserSelection = createBrowserSelection();
      const timers = createTimerQueue();
      const documentRef = createImeCaptureDocument();
      const ownedBodyRoot = new FakeElement();
      ownedBodyRoot.isConnected = true;
      markImeEditableSurface(ownedBodyRoot, documentRef);
      documentRef.getSelection = () => browserSelection;
      const view = loadController([
        'renderSemanticDocument',
        'projectionPositionAtOffset'
      ], {
        window: { getSelection: () => browserSelection },
        document: documentRef,
        globalThis: {
          setTimeout: timers.setTimeout,
          clearTimeout: timers.clearTimeout
        }
      });
      const source = 'Alpha';
      const { state, bodyRoot, bodyInputs } = mountMarkdownImeFixture(
        view,
        source,
        browserSelection,
        { ...fixture, bodyRoot: ownedBodyRoot }
      );
      const initialVersion = state.sourceVersion;
      dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', {});
      const mutation = nativeCompositionMutation(browserSelection);
      const provisional = dispatchNativeCompositionRevision(
        bodyRoot,
        mutation,
        fixture.provisional
      );
      assert.equal(provisional.event.defaultPrevented, false);
      assert.equal(state.body, source);
      assert.equal(state.sourceVersion, initialVersion);
      assert.equal(state.editHistory.undoStack.length, 0);
      assert.equal(bodyInputs.length, 0);

      dispatchMarkdownBodyEvent(bodyRoot, 'compositionend', { data: fixture.finalText });
      assert.equal(timers.size, 1);
      if (fixture.tailType) {
        const tail = createMarkdownEvent({
          target: bodyRoot,
          inputType: fixture.tailType,
          data: fixture.finalText,
          isComposing: false
        });
        dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', tail.event);
        assert.equal(tail.event.defaultPrevented, true);
      } else {
        timers.flush();
      }
      assert.equal(timers.size, 0);
      timers.flush();

      assert.equal(state.body, source);
      assert.equal(state.sourceVersion, initialVersion);
      assert.equal(state.editHistory.undoStack.length, 0);
      assert.equal(state.editHistory.redoStack.length, 0);
      assert.equal(bodyInputs.length, 0);
      assert.equal(state.editableComposition, null);
      const selection = state.editableProjection.getSelection();
      assert.deepEqual({
        anchor: selection.anchor.offset,
        focus: selection.focus.offset
      }, fixture.expectedSelection);
    });
  }
});

test('external canonical publication invalidates native composition and wins without local history', () => {
  const browserSelection = createBrowserSelection();
  const timers = createTimerQueue();
  const documentRef = createImeCaptureDocument();
  const bodyInputs = [];
  const view = loadController([], {
    window: { getSelection: () => browserSelection },
    document: { ...documentRef, getSelection: () => browserSelection },
    globalThis: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout
    }
  });
  const area = new FakeElement();
  const stage = new FakeElement();
  area.isConnected = true;
  stage.isConnected = true;
  area.append(stage);
  const page = {
    id: 'markdown-ime-external-publication',
    type: 'markdown',
    title: 'External publication',
    markdownBody: 'Alpha'
  };
  const layer = view.renderMarkdownPageLayer({
    page,
    stage,
    area,
    mode: 'live-preview',
    onBodyInput: (detail) => bodyInputs.push(detail)
  });
  assert.ok(layer);
  const bodyRoot = layer.querySelector('.markdown-page-body');
  assert.ok(bodyRoot);
  bodyRoot.isConnected = true;
  markImeEditableSurface(bodyRoot, documentRef);
  const position = view.enumerateEditablePositions(layer)
    .find((candidate) => candidate.offset === page.markdownBody.length
      && candidate.visibility === 'visible');
  assert.ok(position);
  assert.equal(view.restoreEditableSelection(layer, {
    anchor: position,
    focus: position
  }), true);

  dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', {});
  const nativeMutation = nativeCompositionMutation(browserSelection);
  dispatchNativeCompositionRevision(bodyRoot, nativeMutation, 'n');
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, 'Alpha');
  assert.equal(bodyInputs.length, 0);

  const remotePage = {
    ...page,
    markdownBody: 'Remote canonical'
  };
  assert.strictEqual(view.updateMarkdownPageLayer(layer, {
    page: remotePage,
    mode: 'reading',
    zoom: 2
  }), layer);
  assert.strictEqual(layer.querySelector('.markdown-page-body'), bodyRoot,
    'the external publication waits while Chromium owns the composition host');
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, 'Alpha');
  assert.equal(bodyInputs.length, 0);

  const latestRemotePage = {
    ...page,
    title: 'Latest external title',
    markdownBody: 'Alpha'
  };
  assert.strictEqual(view.updateMarkdownPageLayer(layer, {
    page: latestRemotePage
  }), layer);
  assert.strictEqual(layer.querySelector('.markdown-page-body'), bodyRoot,
    'a later authoritative publication also remains deferred');
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, 'Alpha');
  assert.strictEqual(view.updateMarkdownPageLayer(layer, {
    mode: 'live-preview',
    zoom: 1
  }), layer);
  assert.strictEqual(layer.querySelector('.markdown-page-body'), bodyRoot,
    'later page-less presentation state also remains ordered behind invalidation');

  dispatchMarkdownBodyEvent(bodyRoot, 'compositionend', { data: '你' });
  assert.equal(timers.size, 1);
  const tail = createMarkdownEvent({
    target: bodyRoot,
    inputType: 'insertText',
    data: '你',
    isComposing: false
  });
  dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', tail.event);
  assert.deepEqual(tail.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 0
  });
  assert.equal(timers.size, 0);
  assert.strictEqual(layer.querySelector('.markdown-page-body'), bodyRoot,
    'a latest same-source publication reuses the current projection after invalidation');
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, 'Alpha',
    'the latest authoritative body wins even when it returns to the composition base');
  assert.equal(bodyRoot.textContent, 'Alpha',
    'same-source external settlement removes the provisional native DOM candidate');
  const settledSelection = view.editableSelection(bodyRoot);
  assert.deepEqual({
    anchor: settledSelection?.anchor?.offset,
    focus: settledSelection?.focus?.offset,
    collapsed: settledSelection?.collapsed
  }, {
    anchor: 5,
    focus: 5,
    collapsed: true
  }, 'same-source external settlement restores a canonical selection');
  assert.equal(layer.querySelector('[data-markdown-role="title"]')?.textContent,
    'Latest external title', 'the latest deferred Page metadata wins with its body');
  assert.equal(layer.classList.contains('is-live-preview'), true,
    'the latest deferred page-less mode wins over an older invalidated patch');
  assert.equal(bodyInputs.length, 0,
    'an external publication never becomes a local composition transaction');

  const currentBody = layer.querySelector('.markdown-page-body');
  const undo = createMarkdownEvent({
    target: currentBody,
    inputType: 'historyUndo'
  });
  dispatchMarkdownBodyEvent(currentBody, 'beforeinput', undo.event);
  assert.equal(undo.event.defaultPrevented, true);
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, 'Alpha',
    'the invalidated local composition leaves no Undo entry');

  const detachedPage = {
    ...latestRemotePage,
    markdownBody: 'Detached canonical'
  };
  assert.strictEqual(view.updateMarkdownPageLayer(layer, { page: detachedPage }), layer);
  assert.notStrictEqual(layer.querySelector('.markdown-page-body'), bodyRoot,
    'a later differing canonical source detaches the former composition host');

  dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', {});
  const staleBeforeInput = createMarkdownEvent({
    target: bodyRoot,
    inputType: 'insertText',
    data: 'stale',
    isComposing: false
  });
  dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', staleBeforeInput.event);
  assert.equal(staleBeforeInput.event.defaultPrevented, false,
    'a detached root cannot claim a later native edit');
  dispatchMarkdownBodyEvent(bodyRoot, 'input', {
    target: bodyRoot,
    inputType: 'insertCompositionText',
    data: '你',
    isComposing: false
  });
  assert.equal(view.editableProjectionSnapshot(layer).markdownBody, 'Detached canonical',
    'late events from the detached host cannot overwrite canonical source');
  assert.equal(bodyInputs.length, 0);
});

test('focusout settles native composition once and consumes its late browser tail', () => {
  const browserSelection = createBrowserSelection();
  const timers = createTimerQueue();
  const animationFrames = [];
  const documentRef = createImeCaptureDocument();
  const view = loadController([
    'renderSemanticDocument',
    'projectionPositionAtOffset',
    'applyMarkdownEditHistory'
  ], {
    window: { getSelection: () => browserSelection },
    document: { ...documentRef, getSelection: () => browserSelection },
    globalThis: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      }
    }
  });
  const source = 'Alpha';
  const { state, bodyRoot, bodyInputs } = mountMarkdownImeFixture(
    view,
    source,
    browserSelection,
    { id: 'focusout-settlement' }
  );
  markImeEditableSurface(bodyRoot, documentRef);
  dispatchMarkdownBodyEvent(bodyRoot, 'compositionstart', {});
  const mutation = nativeCompositionMutation(browserSelection);
  dispatchNativeCompositionRevision(bodyRoot, mutation, '你');
  let refocusCount = 0;
  bodyRoot.focus = () => { refocusCount += 1; };
  documentRef.activeElement = new FakeElement();
  dispatchMarkdownBodyEvent(bodyRoot, 'focusout', {
    target: bodyRoot,
    relatedTarget: documentRef.activeElement
  });
  assert.equal(state.body, 'Alpha你');
  assert.equal(bodyInputs.length, 1);
  assert.equal(state.editHistory.undoStack.length, 1);
  assert.equal(state.editableComposition, null);
  assert.equal(refocusCount, 0,
    'focusout settlement never steals focus back from the new active element');
  assert.equal(animationFrames.length, 1);
  animationFrames.shift()();

  dispatchMarkdownBodyEvent(bodyRoot, 'compositionend', { data: '你' });
  const lateTail = createMarkdownEvent({
    target: bodyRoot,
    inputType: 'insertText',
    data: '你',
    isComposing: false
  });
  dispatchMarkdownBodyEvent(bodyRoot, 'beforeinput', lateTail.event);
  assert.deepEqual(lateTail.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 0
  }, 'the settled blur boundary consumes exactly one late browser commit tail');
  assert.equal(state.body, 'Alpha你');
  assert.equal(bodyInputs.length, 1);
  assert.equal(state.editHistory.undoStack.length, 1);
  assert.equal(view.applyMarkdownEditHistory(state, 'undo'), true);
  assert.equal(state.body, source);
  assert.equal(view.applyMarkdownEditHistory(state, 'redo'), true);
  assert.equal(state.body, 'Alpha你');
});

test('selection replacement and paste keep both table DOMs and adjacent presentations stable', () => {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const source = [
    '# Fold owner',
    '- list item',
    '',
    '| First | Middle | Last |',
    '| --- | --- | --- |',
    '| **Alpha** | short | omega |',
    '',
    '$x^2$',
    '',
    '| Other | Stable |',
    '| --- | --- |',
    '| one | two |'
  ].join('\n');
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const initialPlan = rendered.state.editablePresentationPlan;
  const target = initialPlan.constructs.tables[0].rows[0][0];
  const targetPosition = rendered.projection.enumerateDeclaredPositions().find((position) => (
    target.start <= position.offset && position.offset <= target.end
      && position.interactionPolicy === 'editable-table-cell'
  ));
  assert.ok(view.editableVisibleTableCellPosition(rendered.state, targetPosition));

  const elements = () => descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
  const tableElements = elements().filter((node) => node.classList.contains('markdown-page-table'));
  const tableCells = elements().filter((node) => node.dataset.markdownEditableTableCell === 'true');
  const activeCell = tableCells.find((node) => (
    node.dataset.markdownEditableTableCellActive === 'true'
  ));
  const mathPresentation = elements().find((node) => (
    node.classList.contains('markdown-editable-math-presentation')
  ));
  const listPresentation = elements().find((node) => (
    node.classList.contains('markdown-editable-list-bullet')
  ));
  assert.equal(tableElements.length, 2);
  assert.ok(activeCell && mathPresentation && listPresentation);

  let cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  let result = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.start + 3, focus: cell.start + 6 },
    'XYZ',
    { inputType: 'insertReplacementText' }
  );
  assert.equal(result?.reconciled, true);

  cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  result = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.end - 2, focus: cell.end - 2 },
    '-a-very-long-pasted-value',
    { inputType: 'insertFromPaste', normalizeLineBreaks: true }
  );
  assert.equal(result?.reconciled, true);

  cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  result = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.start + 2, focus: cell.end - 2 },
    'x',
    { inputType: 'insertReplacementText' }
  );
  assert.equal(result?.reconciled, true);

  const currentTables = elements().filter((node) => node.classList.contains('markdown-page-table'));
  const currentCells = elements().filter((node) => (
    node.dataset.markdownEditableTableCell === 'true'
  ));
  assert.deepEqual(currentTables.map((table, index) => table === tableElements[index]), [true, true]);
  assert.equal(currentCells.length, tableCells.length);
  currentCells.forEach((tableCell, index) => {
    assert.equal(tableCell, tableCells[index], `cell ${index} retains identity`);
  });
  assert.equal(mathPresentation.parentNode !== null, true);
  assert.equal(listPresentation.parentNode !== null, true);
  const secondPlan = rendered.state.editablePresentationPlan.constructs.tables[1];
  assert.equal(tableElements[1].dataset.markdownSourceStart, String(secondPlan.start));
  assert.equal(tableElements[1].dataset.markdownSourceEnd, String(secondPlan.end));
  const mathPlan = rendered.state.editablePresentationPlan.constructs.math[0];
  const mathAnchor = rendered.projection.enumerateRegisteredActivationAnchors().find((record) => (
    record.element === mathPresentation
  ));
  assert.equal(mathAnchor.position.sourceVersion, rendered.state.sourceVersion);
  assert.ok(mathPlan.start <= mathAnchor.position.offset && mathAnchor.position.offset <= mathPlan.end);
  assert.equal(rendered.projection.snapshot().markdownBody, rendered.state.body);
});

test('header and body edits in first, middle, and last columns all use the local table path', async (t) => {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const source = [
    '| First | Middle | Last |',
    '| --- | --- | --- |',
    '| alpha | beta | gamma |'
  ].join('\n');
  const cases = [
    { name: 'header first', header: true, columnIndex: 0 },
    { name: 'header middle', header: true, columnIndex: 1 },
    { name: 'header last', header: true, columnIndex: 2 },
    { name: 'body first', header: false, columnIndex: 0 },
    { name: 'body middle', header: false, columnIndex: 1 },
    { name: 'body last', header: false, columnIndex: 2 }
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const rendered = renderEditableFixture(view, source);
      rendered.state.editHistory = view.createMarkdownEditHistory(source);
      const table = rendered.state.editablePresentationPlan.constructs.tables[0];
      const cell = fixture.header
        ? table.header[fixture.columnIndex]
        : table.rows[0][fixture.columnIndex];
      const position = rendered.projection.enumerateDeclaredPositions().find((candidate) => (
        cell.start <= candidate.offset && candidate.offset <= cell.end
          && candidate.interactionPolicy === 'editable-table-cell'
      ));
      const activePosition = view.editableVisibleTableCellPosition(rendered.state, position);
      assert.ok(activePosition);
      assert.ok(rendered.projection.restoreSelection({
        anchor: activePosition,
        focus: activePosition
      }));
      const elements = () => descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
      const tableElement = elements().find((node) => node.classList.contains('markdown-page-table'));
      const cells = elements().filter((node) => node.dataset.markdownEditableTableCell === 'true');
      const active = rendered.state.editablePresentationPlan.constructs.tables[0];
      const activeCell = fixture.header
        ? active.header[fixture.columnIndex]
        : active.rows[0][fixture.columnIndex];
      const result = view.applyEditableTableCellTextInput(
        rendered.state,
        { anchor: activeCell.end, focus: activeCell.end },
        '!'
      );
      assert.equal(result?.reconciled, true);
      assert.equal(
        elements().find((node) => node.classList.contains('markdown-page-table')) === tableElement,
        true
      );
      const currentCells = elements().filter((node) => (
        node.dataset.markdownEditableTableCell === 'true'
      ));
      currentCells.forEach((current, index) => assert.equal(current === cells[index], true));
    });
  }
});

test('table fast-path preflight fails closed to the existing full projection refresh', () => {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const source = [
    '| A | B |',
    '| --- | --- |',
    '| alpha | beta |'
  ].join('\n');
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const position = rendered.projection.enumerateDeclaredPositions().find((candidate) => (
    candidate.offset === cell.start + 1
      && candidate.interactionPolicy === 'editable-table-cell'
  ));
  const activePosition = view.editableVisibleTableCellPosition(rendered.state, position);
  assert.ok(rendered.projection.restoreSelection({
    anchor: activePosition,
    focus: activePosition
  }));
  const oldTable = descendants(rendered.bodyRoot).find((node) => (
    node.classList?.contains('markdown-page-table')
  ));
  rendered.state.editableTablePresentations.clear();

  const activeCell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const result = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: activeCell.end, focus: activeCell.end },
    ' '
  );
  assert.equal(result?.changed, true);
  assert.equal(result?.reconciled, false);
  assert.equal(rendered.state.body, source.replace('alpha', 'alpha '));
  const nextTable = descendants(rendered.bodyRoot).find((node) => (
    node.classList?.contains('markdown-page-table')
  ));
  assert.equal(nextTable === oldTable, false);
  const remountedCell = descendants(rendered.bodyRoot).find((node) => (
    node.dataset?.markdownEditableTableCellActive === 'true'
  ));
  assert.equal(Number(remountedCell?.dataset?.markdownSourceStart), activeCell.start);
  assert.equal(Number(remountedCell?.dataset?.markdownSourceEnd), result.caret,
    'a full refresh preserves the active authored-space range on the TD');
  const restoredSelection = rendered.state.editableProjection.getSelection();
  assert.equal(restoredSelection?.focus?.offset, result.caret);
  const nextInput = view.applyEditableTableCellTextInput(
    rendered.state,
    {
      anchor: restoredSelection.anchor.offset,
      focus: restoredSelection.focus.offset
    },
    'x'
  );
  assert.equal(nextInput?.changed, true);
  assert.equal(nextInput?.reconciled, true,
    'the next character returns to the exact local table revision path');
  assert.equal(rendered.state.body, source.replace('alpha', 'alpha x'));
  assert.equal(descendants(rendered.bodyRoot).find((node) => (
    node.classList?.contains('markdown-page-table')
  )), nextTable);
  assert.equal(rendered.projection.snapshot().markdownBody, rendered.state.body);
  rendered.projection.enumerateDeclaredPositions().forEach((declared) => {
    const dom = rendered.projection.sourceToDom(declared);
    assert.ok(dom);
    assert.equal(positionKey(rendered.projection.domToSource(dom.node, dom.offset)),
      positionKey(declared));
  });

  const fastPathSource = [
    functionSource('reconcileEditableTableRevision'),
    functionSource('editableTableReconciliationPreflight'),
    functionSource('applyEditableTablePresentationRevision')
  ].join('\n');
  assert.doesNotMatch(fastPathSource,
    /getBoundingClientRect|offsetWidth|offsetHeight|clientWidth|clientHeight|requestAnimationFrame|setTimeout/);
  assert.doesNotMatch(functionSource('reconcileEditableTableRevision'),
    /clearEditablePresentationMountState|refreshEditableProjection/);
});

test('Live table reconciliation preserves an adjacent collapsed list visibility index', () => {
  const browserSelection = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const view = loadController([
    'renderEditableDocumentBlocks',
    'toggleMarkdownStructuralFold',
    'markdownStructuralVisiblePosition',
    'editableVisibleTableCellPosition',
    'applyEditableTableCellTextInput'
  ], {
    window: { getSelection: () => browserSelection },
    document: { getSelection: () => browserSelection }
  });
  const source = [
    '- Parent',
    '\t- Hidden child',
    '\t\t- Hidden grandchild',
    '',
    '| A | B |',
    '| --- | --- |',
    '| alpha | beta |'
  ].join('\n');
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const parentOwner = rendered.state.markdownFoldIndex?.foldableOwners?.find((owner) => (
    owner.kind === 'list' && owner.lineIndex === 0
  ));
  assert.ok(parentOwner, 'the parent list row is foldable');
  assert.equal(view.toggleMarkdownStructuralFold(
    rendered.state,
    parentOwner.key,
    true
  ), true);

  const hiddenLine = rendered.state.sourceSnapshot.physicalLineIndex.lines[1];
  const hiddenRow = rendered.projection.enumeratePhysicalRows().find((entry) => (
    String(entry.physicalLineId) === String(hiddenLine.id)
  ));
  assert.ok(rendered.state.markdownFoldVisibility.hiddenLineIndices.has(hiddenLine.index));
  assert.equal(hiddenRow.element.hidden, true);

  const cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  const cellPosition = rendered.projection.enumerateDeclaredPositions().find((position) => (
    position.offset === cell.start
      && position.interactionPolicy === 'editable-table-cell'
  ));
  const activeCellPosition = view.editableVisibleTableCellPosition(
    rendered.state,
    cellPosition
  );
  assert.ok(activeCellPosition);
  assert.ok(rendered.projection.restoreSelection({
    anchor: activeCellPosition,
    focus: activeCellPosition
  }));
  const result = view.applyEditableTableCellTextInput(
    rendered.state,
    { anchor: cell.end, focus: cell.end },
    '!'
  );
  assert.equal(result?.reconciled, true);
  assert.ok(rendered.state.markdownFoldIndex,
    'the exact source revision installs the successor fold index');
  assert.ok(rendered.state.markdownFoldVisibility.hiddenLineIndices.has(hiddenLine.index),
    'collapsed visibility remains authoritative after table input');
  assert.equal(rendered.projection.enumeratePhysicalRows().find((entry) => (
    String(entry.physicalLineId) === String(hiddenLine.id)
  ))?.element === hiddenRow.element, true);
  assert.equal(hiddenRow.element.hidden, true, 'the collapsed row remains hidden in place');

  const hiddenPosition = rendered.projection.enumerateDeclaredPositions().find((position) => (
    String(position.physicalLineId) === String(hiddenLine.id)
  ));
  const visiblePosition = view.markdownStructuralVisiblePosition(
    rendered.state,
    hiddenPosition,
    'ArrowDown'
  );
  const visibleLine = rendered.state.sourceSnapshot.physicalLineIndex.lines.find((line) => (
    String(line.id) === String(visiblePosition.physicalLineId)
  ));
  assert.ok(visibleLine);
  assert.equal(
    rendered.state.markdownFoldVisibility.hiddenLineIndices.has(visibleLine.index),
    false,
    'caret navigation still skips the visually collapsed subtree'
  );
});

test('Live table mount keeps nested math and literal image source inside semantic cells', () => {
  const source = [
    '| Formula | Diagram |',
    '| --- | --- |',
    '| $x^2$ | ![alt](assets/x.png) |'
  ].join('\n');
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const elements = descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
  const mathPresentation = elements.find((node) => (
    node.classList.contains('markdown-page-math-inline-construct')
  ));
  const imageSource = elements.find((node) => (
    node.classList.contains('markdown-page-image-source-only')
  ));
  const canonicalDepot = elements.find((node) => (
    node.classList.contains('markdown-editable-table-canonical-depot')
  ));
  const imageSourceLeaves = descendants(canonicalDepot).filter((node) => (
    node?.dataset?.markdownProjectedLeaf === 'true'
      && String(node.dataset.markdownSemanticFamilies || '').split(' ').includes('image-source')
  ));

  assert.ok(mathPresentation?.closest('td'), 'LaTeX stays rendered inside its table cell');
  assert.ok(imageSource?.closest('td'), 'the AST-backed image source stays literal inside its table cell');
  assert.equal(imageSource.textContent, '![alt](assets/x.png)');
  assert.equal(imageSource.dataset.markdownImagePresentation, 'source-only');
  assert.equal(elements.filter((node) => node.tagName === 'IMG').length, 0);
  assert.equal(
    imageSourceLeaves.map((leaf) => leaf.textContent).join(''),
    '![alt](assets/x.png)',
    'the canonical image source remains projection-owned in the hidden depot'
  );
  assert.deepEqual({ ...rendered.state.editablePresentationPlan.constructs.images[0].presentation }, {
    sourceVisible: true,
    renderedMounted: false,
    layout: 'source-only'
  });
  assert.equal(rendered.state.editablePresentationPlan.constructs.tables[0].activeRaw, false);
});

test('horizontal navigation can leave the first and last Live table cells', () => {
  const source = [
    'Before',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'After'
  ].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'editableVisibleTableCellPosition'
  ]);
  const rendered = renderEditableFixture(view, source);
  const table = rendered.state.editablePresentationPlan.constructs.tables[0];
  const cells = table.cells.filter((cell) => cell.canonical);
  const declared = rendered.projection.enumerateDeclaredPositions();
  const beforeFirst = declared.find((position) => position.offset === cells[0].start - 1);
  const afterLast = declared.find((position) => position.offset === cells.at(-1).end + 1);
  const left = view.editableVisibleTableCellPosition(
    rendered.state,
    beforeFirst,
    'ArrowLeft'
  );
  const right = view.editableVisibleTableCellPosition(
    rendered.state,
    afterLast,
    'ArrowRight'
  );

  assert.ok(left.offset < table.start, 'ArrowLeft exits to visible content before the table');
  assert.equal(left.visibility, 'visible');
  assert.ok(right.offset > table.end, 'ArrowRight exits to visible content after the table');
  assert.equal(right.visibility, 'visible');
});

test('fresh Source and Live projections keep one canonical position shape across mode changes', () => {
  const source = '> [label](https://example.com) and $x$';
  const snapshot = markdown.createSourceSnapshot(source);
  const sourcePlan = syntaxAdapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'source'
  });
  const livePlan = syntaxAdapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const sourceProjection = createCertificationProjection(snapshot, 'source', {
    presentationPlan: sourcePlan
  }).projection;
  const liveProjection = createCertificationProjection(snapshot, 'live-preview', {
    presentationPlan: livePlan
  }).projection;

  assert.deepEqual(
    sourceProjection.enumerateDeclaredPositions().map(positionKey),
    liveProjection.enumerateDeclaredPositions().map(positionKey),
    'mode presentation cannot change physical canonical positions'
  );
  assert.ok(sourceProjection.enumerateProjectedLeaves().every((leaf) => (
    leaf.visibility === 'visible'
  )));
  assert.ok(liveProjection.enumerateProjectedLeaves().some((leaf) => (
    leaf.visibility !== 'visible'
  )), 'Live Preview gets a distinct semantic presentation shape');

  const renderState = functionSource('renderState');
  assert.match(renderState, /state\.layer\.replaceChildren\(\)/);
  assert.match(renderState, /const bodyRoot = createElement\('div', 'markdown-page-body structured-text-page-body'\)/);
  assert.match(renderState, /renderSemanticDocument\(state, bodyRoot\)/);
  const updateLayer = functionSource('updateMarkdownPageLayer');
  assert.match(updateLayer, /if \(requiresRender\) \{[^]*?renderState\(state\)[^]*?restoreSemanticSelection/s,
    'a mode transition creates a fresh projection shape, then restores the canonical selection');
  const modeBranch = updateLayer.indexOf("Object.hasOwn(patch, 'mode')");
  const activeReset = updateLayer.indexOf('state.editableActiveOwnerIds = new Set()', modeBranch);
  const destinationMode = updateLayer.indexOf('state.mode = mode', modeBranch);
  assert.ok(activeReset > modeBranch && activeReset < destinationMode,
    'every destination mode starts without stale Live active owners');
  const restoredSelection = updateLayer.indexOf(
    'restoreSemanticSelection(state.bodyRoot, modeSelection)',
    destinationMode
  );
  const recomputedLiveState = updateLayer.indexOf(
    'updateLiveMarkerVisibility(state)',
    restoredSelection
  );
  assert.ok(restoredSelection > destinationMode && recomputedLiveState > restoredSelection,
    'Source to Live recomputes activation from the restored exact projection selection');
});

function renderEditableFixture(view, source, mode = 'live-preview') {
  const snapshot = markdown.createSourceSnapshot(source);
  const bodyRoot = new FakeElement();
  bodyRoot.isConnected = true;
  const state = {
    body: source,
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version,
    bodyRoot,
    mode,
    pageEditMode: false,
    bodyReadOnly: false,
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set(),
    editableForcedRawOwnerIds: new Set(),
    page: { id: `editable-${mode}` },
    paneId: `pane-${mode}`
  };
  installFixtureLinkArrowController(view, state);
  const projection = view.renderEditableDocumentBlocks(state, bodyRoot);
  return { state, projection, bodyRoot };
}

test('global Markdown deletion commits one prepared canonical result without replaying it', async (t) => {
  for (const mode of ['source', 'live-preview']) {
    await t.test(mode, () => {
      const { trace, view } = loadDeletionTraceController([
        'renderEditableDocumentBlocks',
        'applyMarkdownDeletionShortcut'
      ]);
      const source = 'alpha beta';
      const rendered = renderEditableFixture(view, source, mode);
      rendered.state.editHistory = view.createMarkdownEditHistory(source);
      const caret = rendered.projection.enumerateDeclaredPositions().find((position) => (
        position.offset === source.length
      ));
      assert.ok(caret);
      assert.equal(rendered.projection.restoreSelection({ anchor: caret, focus: caret }), true);

      trace.exactDeletionCalls = 0;
      trace.canonicalReplayCalls = 0;
      trace.parseCalls = 0;
      trace.result = null;

      assert.equal(view.applyMarkdownDeletionShortcut(rendered.state, 'backward'), true);
      assert.equal(rendered.state.body, 'alpha bet');
      assert.equal(trace.exactDeletionCalls, 1,
        'the existing SourceSnapshot is deleted exactly once');
      assert.equal(trace.canonicalReplayCalls, 0,
        'the view never replays the prepared deletion as a second canonical edit');
      assert.equal(trace.parseCalls, 2,
        'only the Foundation primary/final snapshots are parsed');
      assert.equal(rendered.state.sourceSnapshot, trace.result.snapshot,
        'the validated prepared snapshot becomes the view snapshot by identity');
      assert.equal(rendered.state.sourceVersion, trace.result.snapshot.version);
      assert.equal(rendered.state.editHistory.undoStack.length, 1);
      assert.equal(rendered.state.editHistory.undoStack[0].beforeSource, source);
      assert.equal(rendered.state.editHistory.undoStack[0].afterSource, 'alpha bet');

      const undo = view.stepMarkdownEditHistory(
        rendered.state.editHistory,
        'undo',
        rendered.state.body
      );
      assert.equal(undo.source, source);
      const redo = view.stepMarkdownEditHistory(
        rendered.state.editHistory,
        'redo',
        undo.source
      );
      assert.equal(redo.source, 'alpha bet');
    });
  }
});

test('one-result deletion preserves ordered renumber, CRLF, and Unicode selection semantics', async (t) => {
  const fixtures = [
    {
      name: 'ordered-selection-renumber',
      source: '1. A\n2. B\n3. C',
      selection: { anchor: 5, focus: 10 },
      direction: 'backward'
    },
    {
      name: 'crlf-backspace',
      source: 'A\r\nB',
      selection: { anchor: 3, focus: 3 },
      direction: 'backward'
    },
    {
      name: 'surrogate-backspace',
      source: 'A\ud83e\udde0B',
      selection: { anchor: 3, focus: 3 },
      direction: 'backward'
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const expected = markdown.applyMarkdownDeletion(
        fixture.source,
        fixture.selection,
        fixture.direction
      );
      const { trace, view } = loadDeletionTraceController([
        'renderEditableDocumentBlocks',
        'applyMarkdownDeletionShortcut',
        'captureSemanticSelection'
      ]);
      const rendered = renderEditableFixture(view, fixture.source, 'source');
      rendered.state.editHistory = view.createMarkdownEditHistory(fixture.source);
      const atOffset = (offset) => rendered.projection.enumerateDeclaredPositions().find(
        (position) => position.offset === offset && position.affinity === 'after'
      ) || rendered.projection.enumerateDeclaredPositions().find(
        (position) => position.offset === offset
      );
      const anchor = atOffset(fixture.selection.anchor);
      const focus = atOffset(fixture.selection.focus);
      assert.ok(anchor && focus);
      assert.equal(rendered.projection.restoreSelection({ anchor, focus }), true);

      trace.exactDeletionCalls = 0;
      trace.canonicalReplayCalls = 0;
      trace.parseCalls = 0;
      trace.result = null;
      assert.equal(view.applyMarkdownDeletionShortcut(
        rendered.state,
        fixture.direction
      ), true);
      assert.equal(rendered.state.body, expected.source);
      const actualSelection = view.captureSemanticSelection(rendered.state.bodyRoot);
      assert.deepEqual(
        {
          anchor: actualSelection.anchor,
          focus: actualSelection.focus,
          anchorAffinity: actualSelection.anchorAffinity,
          focusAffinity: actualSelection.focusAffinity
        },
        {
          anchor: expected.selection.anchor,
          focus: expected.selection.focus,
          anchorAffinity: expected.selection.anchorAffinity,
          focusAffinity: expected.selection.focusAffinity
        }
      );
      assert.equal(trace.exactDeletionCalls, 1);
      assert.equal(trace.canonicalReplayCalls, 0);
      assert.equal(trace.parseCalls, 2);
    });
  }
});

test('a stale or mismatched prepared deletion fails closed to the ordinary canonical edit', () => {
  const { trace, view } = loadDeletionTraceController([
    'renderEditableDocumentBlocks',
    'replaceSemanticSourceRange'
  ]);
  const rendered = renderEditableFixture(view, 'alpha', 'source');
  trace.exactDeletionCalls = 0;
  trace.canonicalReplayCalls = 0;
  trace.parseCalls = 0;

  const untrusted = foundation.applyExactDeletion(
    markdown.createSourceSnapshot('different'),
    { anchor: 9, focus: 9 },
    'backward'
  );
  assert.equal(view.replaceSemanticSourceRange(
    rendered.state,
    5,
    5,
    '!',
    {
      beforeSelection: { anchor: 5, focus: 5 },
      afterSelection: { anchor: 6, focus: 6 },
      canonicalResult: untrusted,
      recordHistory: false,
      restoreSelection: false
    }
  ), true);
  assert.equal(rendered.state.body, 'alpha!');
  assert.equal(trace.exactDeletionCalls, 0);
  assert.equal(trace.canonicalReplayCalls, 1,
    'untrusted prepared state cannot bypass the canonical edit owner');
  assert.equal(trace.parseCalls, 2);
  assert.notEqual(rendered.state.sourceSnapshot, untrusted.snapshot);
});

test('same-output prepared deletions cannot substitute a different range or affinity', async (t) => {
  await t.test('different range', () => {
    const { trace, view } = loadDeletionTraceController([
      'renderEditableDocumentBlocks',
      'replaceSemanticSourceRange'
    ]);
    const rendered = renderEditableFixture(view, 'aa', 'source');
    const wrongRange = foundation.applyExactDeletion(
      markdown.createSourceSnapshot('aa'),
      { anchor: 1, focus: 1 },
      'backward'
    );
    trace.canonicalReplayCalls = 0;
    assert.equal(view.replaceSemanticSourceRange(rendered.state, 1, 2, '', {
      beforeSelection: { anchor: 2, focus: 2 },
      afterSelection: { anchor: 1, focus: 1 },
      inputType: 'deleteContentBackward',
      transactionMetadata: { commandKind: 'exact-deletion' },
      canonicalResult: wrongRange,
      canonicalResultTransactionKind: 'exact-deletion',
      recordHistory: false,
      restoreSelection: false
    }), true);
    assert.equal(rendered.state.body, 'a');
    assert.equal(trace.canonicalReplayCalls, 1);
    assert.notEqual(rendered.state.sourceSnapshot, wrongRange.snapshot);
  });

  await t.test('different before affinity', () => {
    const { trace, view } = loadDeletionTraceController([
      'renderEditableDocumentBlocks',
      'replaceSemanticSourceRange'
    ]);
    const rendered = renderEditableFixture(view, 'ab', 'source');
    const wrongAffinity = foundation.applyExactDeletion(
      markdown.createSourceSnapshot('ab'),
      {
        anchor: 2,
        focus: 2,
        anchorAffinity: 'after',
        focusAffinity: 'after'
      },
      'backward'
    );
    trace.canonicalReplayCalls = 0;
    assert.equal(view.replaceSemanticSourceRange(rendered.state, 1, 2, '', {
      beforeSelection: {
        anchor: 2,
        focus: 2,
        anchorAffinity: 'before',
        focusAffinity: 'before'
      },
      afterSelection: {
        anchor: 1,
        focus: 1,
        anchorAffinity: 'before',
        focusAffinity: 'before'
      },
      inputType: 'deleteContentBackward',
      transactionMetadata: { commandKind: 'exact-deletion' },
      canonicalResult: wrongAffinity,
      canonicalResultTransactionKind: 'exact-deletion',
      recordHistory: false,
      restoreSelection: false
    }), true);
    assert.equal(rendered.state.body, 'a');
    assert.equal(trace.canonicalReplayCalls, 1);
    assert.notEqual(rendered.state.sourceSnapshot, wrongAffinity.snapshot);
  });
});

test('table-cell deletion shares the one-result path and retains exact-revision DOM identity', () => {
  const { trace, view } = loadDeletionTraceController([
    'renderEditableDocumentBlocks',
    'applyEditableTableCellDeletion',
    'editableVisibleTableCellPosition'
  ]);
  const source = [
    '| H1 | H2 |',
    '| --- | --- |',
    '| Alpha | Beta |'
  ].join('\n');
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const cell = rendered.state.editablePresentationPlan.constructs.tables[0].rows[0][0];
  assert.ok(cell);
  const activation = rendered.projection.enumerateDeclaredPositions().find((position) => (
    position.offset === Math.min(cell.end, cell.start + 1)
      && position.interactionPolicy === 'editable-table-cell'
  ));
  assert.ok(activation);
  assert.ok(view.editableVisibleTableCellPosition(rendered.state, activation));
  const tableBefore = descendants(rendered.bodyRoot).find((node) => (
    node?.classList?.contains('markdown-page-table')
  ));
  assert.ok(tableBefore);

  trace.exactDeletionCalls = 0;
  trace.canonicalReplayCalls = 0;
  trace.parseCalls = 0;
  trace.result = null;

  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'backward',
    { anchor: cell.end, focus: cell.end }
  ), true);
  assert.equal(trace.exactDeletionCalls, 1);
  assert.equal(trace.canonicalReplayCalls, 0);
  assert.equal(trace.parseCalls, 2);
  assert.equal(rendered.state.sourceSnapshot, trace.result.snapshot);
  assert.ok(rendered.state.editableTableReconciliationDiagnostics);
  assert.equal(descendants(rendered.bodyRoot).find((node) => (
    node?.classList?.contains('markdown-page-table')
  )), tableBefore, 'the existing table reconciliation still retains its DOM owner');
});

test('table deletion commits its local primary edit before an adjacent ordered renumber', () => {
  const { trace, view } = loadDeletionTraceController([
    'renderEditableDocumentBlocks',
    'applyEditableTableCellDeletion'
  ]);
  const source = [
    '| H |',
    '| --- |',
    '| AA |',
    '',
    '1. one',
    '9. two'
  ].join('\n');
  const expected = markdown.applyMarkdownDeletion(
    source,
    { anchor: 18, focus: 18 },
    'backward'
  );
  assert.ok(expected.renumberEdits.length > 0);
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  trace.exactDeletionCalls = 0;
  trace.canonicalReplayCalls = 0;
  trace.parseCalls = 0;
  trace.result = null;

  assert.equal(view.applyEditableTableCellDeletion(
    rendered.state,
    'backward',
    { anchor: 18, focus: 18 }
  ), true);
  assert.equal(rendered.state.body, expected.source,
    'the cell byte and the canonical adjacent sequence are committed together');
  assert.equal(trace.exactDeletionCalls, 1);
  assert.equal(trace.canonicalReplayCalls, 0);
  assert.equal(trace.parseCalls, 2);
  assert.equal(rendered.state.editableTableReconciliationDiagnostics, null,
    'cross-region renumbering intentionally takes the existing full-refresh fallback');
});

test('Live mounts one non-owning unordered bullet or task checkbox per inactive physical row', () => {
  const source = ['- A', '\t- B', '- [ ] todo', '\t- [x] done'].join('\n');
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const elements = descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
  const bullets = elements.filter((node) => node.classList.contains('markdown-editable-list-bullet'));
  const taskControls = elements.filter((node) => (
    node.classList.contains('markdown-editable-task-control')
  ));
  const taskFoldTriggers = elements.filter((node) => (
    node.classList.contains('markdown-structural-task-marker-trigger')
  ));
  const foldControls = elements.filter((node) => (
    node.classList.contains('markdown-structural-fold-control')
  ));
  const nativeLists = elements.filter((node) => ['UL', 'OL', 'LI'].includes(node.tagName));
  const rows = rendered.projection.enumeratePhysicalRows();

  assert.equal(bullets.length, 2);
  assert.equal(taskControls.length, 2);
  assert.equal(taskFoldTriggers.length, 0, 'Live list source never becomes a direct fold target');
  assert.equal(foldControls.length, 2, 'each foldable owner gets one hover disclosure');
  assert.ok(foldControls.every((control) => (
    control.attributes['aria-expanded'] === 'true'
      && control.dataset.markdownStructuralFoldKind === 'list'
  )));
  assert.ok(taskControls.every((control) => (
    control.dataset.markdownStructuralFoldTrigger === undefined
      && control.querySelector('input[type="checkbox"]')
        .dataset.markdownStructuralFoldTrigger === undefined
  )));
  assert.equal(nativeLists.length, 0, 'editable presentation never mounts native list owners');
  assert.deepEqual(taskControls.map((control) => (
    control.querySelector('input[type="checkbox"]').checked
  )), [false, true]);
  assert.ok([...bullets, ...taskControls].every((control) => (
    control.contentEditable === 'false'
      && control.dataset.markdownSemanticOnly === 'true'
      && control.dataset.markdownEditablePresentationOwner
  )));
  assert.deepEqual(rows.slice(0, 4).map((entry) => ({
    depth: entry.element.dataset.editableListDepth,
    rendered: entry.element.classList.contains('is-editable-list-presentation-rendered'),
    task: entry.element.classList.contains('is-editable-task-list-row')
  })), [
    { depth: '1', rendered: true, task: false },
    { depth: '2', rendered: true, task: false },
    { depth: '1', rendered: true, task: true },
    { depth: '2', rendered: true, task: true }
  ]);
  rendered.projection.enumerateProjectedLeaves()
    .filter((leaf) => /-row-hidden-source$/.test(leaf.kind))
    .forEach((leaf) => {
      assert.equal(leaf.visibility, 'activatable');
      assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
    });
});

test('row-local Live activation reveals one canonical prefix without a duplicate bullet or checkbox', () => {
  const source = ['- A', '- B', '- [ ] todo'].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection',
    'ensureEditableSelectionVisible'
  ]);
  const rendered = renderEditableFixture(view, source);
  const first = rendered.state.editablePresentationPlan.constructs.listRows[0];
  const hiddenPosition = rendered.projection.enumerateDeclaredPositions().find((position) => (
    position.offset === first.markerStart && position.visibility === 'activatable'
  ));
  assert.ok(hiddenPosition);
  const visible = view.ensureEditableSelectionVisible(rendered.state, {
    anchor: hiddenPosition,
    focus: hiddenPosition
  });
  assert.equal(visible.anchor.offset, first.markerStart);
  assert.ok(rendered.state.editableActiveOwnerIds.has(first.ownerId));

  const plan = rendered.state.editablePresentationPlan;
  assert.equal(plan.constructs.listRows[0].presentation.sourceVisible, true);
  assert.equal(plan.constructs.listRows[1].presentation.sourceVisible, false);
  const rows = rendered.projection.enumeratePhysicalRows();
  const firstPresentations = descendants(rows[0].element).filter((node) => (
    node?.dataset?.markdownEditablePresentationOwner
  ));
  assert.equal(firstPresentations.length, 0, 'active row exposes only its canonical prefix');
  assert.equal(rows[0].element.textContent, '- A');
  assert.ok(descendants(rows[1].element).some((node) => (
    node.classList?.contains('markdown-editable-list-bullet')
  )), 'inactive sibling keeps its semantic bullet');
  assert.ok(descendants(rows[2].element).some((node) => (
    node.classList?.contains('markdown-editable-task-control')
  )), 'inactive task sibling keeps its checkbox');

  const sourceRendered = renderEditableFixture(view, source, 'source');
  assert.equal(descendants(sourceRendered.bodyRoot).filter((node) => (
    node.classList?.contains('markdown-editable-list-bullet')
      || node.classList?.contains('markdown-editable-task-control')
  )).length, 0);
  assert.equal(sourceRendered.state.editablePresentationPlan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join(''), source);
});

test('unordered Live rows keep canonical markers and content in stable depth-aware slots', () => {
  const source = ['- Parent', '\t- Child', '\t\t- Grandchild'].join('\n');
  const expectedMarkers = ['\u2022', '\u25e6', '\u25aa'];
  const expectedMarkerStyles = ['disc', 'circle', 'square'];
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection'
  ]);
  const rendered = renderEditableFixture(view, source);
  const listRows = rendered.state.editablePresentationPlan.constructs.listRows;

  const assertSlots = (active) => {
    const rows = rendered.projection.enumeratePhysicalRows();
    assert.deepEqual(rows.map((entry) => (
      entry.element.style.getPropertyValue('--markdown-editable-list-depth')
    )), ['0', '1', '2']);
    rows.forEach((entry, index) => {
      const markerSlot = entry.element.children.find((element) => (
        element.classList.contains('markdown-editable-list-marker-slot')
      ));
      const contentSlot = entry.element.children.find((element) => (
        element.classList.contains('markdown-editable-list-content-slot')
      ));
      assert.ok(markerSlot, `depth ${index + 1} must have one marker slot`);
      assert.ok(contentSlot, `depth ${index + 1} must have one content slot`);
      assert.equal(entry.element.children[0], markerSlot);
      assert.equal(entry.element.children[1], contentSlot);
      assert.equal(markerSlot.dataset.markdownEditableListSlot, 'marker');
      assert.equal(contentSlot.dataset.markdownEditableListSlot, 'content');
      const markerLeaf = descendants(markerSlot).find((element) => (
        element.classList?.contains('is-unordered-list-marker')
      ));
      const contentLeaf = descendants(contentSlot).find((element) => (
        element.classList?.contains('is-unordered-list-row-content')
      ));
      assert.ok(markerLeaf, 'the canonical marker remains the only editable marker owner');
      assert.ok(contentLeaf, 'canonical content remains in the stable content column');
      assert.equal(markerLeaf.textContent, `${'\t'.repeat(index)}- `);
      assert.equal(contentLeaf.textContent, ['Parent', 'Child', 'Grandchild'][index]);
      const bullets = descendants(markerSlot).filter((element) => (
        element.classList?.contains('markdown-editable-list-bullet')
      ));
      assert.equal(bullets.length, active ? 0 : 1);
      if (!active) {
        assert.equal(bullets[0].textContent, expectedMarkers[index]);
        assert.equal(
          bullets[0].dataset.markdownUnorderedMarkerStyle,
          expectedMarkerStyles[index]
        );
      }
      assert.equal(entry.element.textContent, active
        ? `${'\t'.repeat(index)}- ${['Parent', 'Child', 'Grandchild'][index]}`
        : `${'\t'.repeat(index)}- ${expectedMarkers[index]}${[
          'Parent',
          'Child',
          'Grandchild'
        ][index]}`);
    });
  };

  assertSlots(false);
  rendered.state.editableActiveOwnerIds = new Set(listRows.map((row) => row.ownerId));
  view.refreshEditableProjection(rendered.state);
  assertSlots(true);
  rendered.state.editableActiveOwnerIds = new Set();
  view.refreshEditableProjection(rendered.state);
  assertSlots(false);

  const sourceRendered = renderEditableFixture(view, source, 'source');
  assert.equal(descendants(sourceRendered.bodyRoot).filter((element) => (
    element.classList?.contains('markdown-editable-list-marker-slot')
      || element.classList?.contains('markdown-editable-list-content-slot')
  )).length, 0, 'Source keeps the unwrapped canonical physical-row projection');
  assert.deepEqual(sourceRendered.projection.enumeratePhysicalRows().map((entry) => (
    entry.element.textContent
  )), source.split('\n'));

  const taskRendered = renderEditableFixture(view, '- [ ] task');
  assert.equal(descendants(taskRendered.bodyRoot).filter((element) => (
    element.classList?.contains('markdown-editable-list-marker-slot')
      || element.classList?.contains('markdown-editable-list-content-slot')
  )).length, 0, 'task-checkbox presentation keeps its existing specialized layout');
});

test('inactive Live underline hides both tags and pair-local activation restores exact source', () => {
  const source = '<u>first</u> and <u>second</u>';
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection',
    'editableActiveStateForSelection'
  ]);
  const rendered = renderEditableFixture(view, source);
  const underlines = rendered.state.editablePresentationPlan.constructs.underlines;
  assert.equal(underlines.length, 2);
  assert.notEqual(underlines[0].activationOwnerId, underlines[1].activationOwnerId);
  assert.equal(underlines[0].ownerId, underlines[1].ownerId,
    'pair-local activation cannot reuse the shared paragraph semantic owner');

  const sourcePlan = syntaxAdapters.buildEditablePresentationPlan(
    rendered.state.sourceSnapshot,
    { model: markdown, mode: 'source' }
  );
  const firstActivePlan = syntaxAdapters.buildEditablePresentationPlan(
    rendered.state.sourceSnapshot,
    {
      model: markdown,
      mode: 'live-preview',
      activeOwnerIds: [underlines[0].activationOwnerId]
    }
  );
  const positionShapes = [
    ['source', sourcePlan],
    ['live-preview', rendered.state.editablePresentationPlan],
    ['live-preview', firstActivePlan]
  ].map(([mode, presentationPlan]) => createCertificationProjection(
    rendered.state.sourceSnapshot,
    mode,
    { presentationPlan }
  ).projection.enumerateDeclaredPositions().map(positionKey));
  assert.deepEqual(positionShapes[1], positionShapes[0]);
  assert.deepEqual(positionShapes[2], positionShapes[0],
    'underline visibility changes cannot change canonical editable positions');

  const markerLeaves = (underline) => rendered.projection.enumerateProjectedLeaves()
    .filter((leaf) => (
      underline.markerRanges.some((range) => (
        leaf.sourceStart >= range.start && leaf.sourceEnd <= range.end
      ))
    ));
  underlines.forEach((underline) => {
    const markers = markerLeaves(underline);
    assert.deepEqual(markers.map((leaf) => leaf.text), ['<', 'u', '>', '</', 'u', '>']);
    assert.ok(markers.every((leaf) => leaf.visibility === 'activatable'));
    assert.ok(markers.every((leaf) => leaf.interactionPolicy === 'activate-owner'));
    assert.ok(markers.every((leaf) => (
      leaf.element.dataset.visibility === 'activatable'
    )));
  });
  assert.deepEqual(rendered.projection.enumerateProjectedLeaves()
    .filter((leaf) => leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'underline' && role.role === 'content'
    )))
    .map((leaf) => leaf.text), ['first', 'second']);

  const firstCaret = underlines[0].contentStart + 2;
  const active = view.editableActiveStateForSelection(rendered.state, {
    anchor: { offset: firstCaret },
    focus: { offset: firstCaret }
  });
  assert.deepEqual([...active.ownerIds], [underlines[0].activationOwnerId]);
  rendered.state.editableActiveOwnerIds = active.ownerIds;
  view.refreshEditableProjection(rendered.state);

  const refreshed = rendered.state.editablePresentationPlan.constructs.underlines;
  assert.equal(refreshed[0].active, true);
  assert.equal(refreshed[1].active, false);
  const firstMarkers = markerLeaves(refreshed[0]);
  const secondMarkers = markerLeaves(refreshed[1]);
  assert.ok(firstMarkers.every((leaf) => leaf.visibility === 'visible'));
  assert.ok(firstMarkers.every((leaf) => leaf.interactionPolicy === 'editable-text'));
  assert.ok(secondMarkers.every((leaf) => leaf.visibility === 'activatable'));
  assert.equal(rendered.state.body, source);
  assert.equal(rendered.projection.enumerateProjectedLeaves().map((leaf) => leaf.text).join(''), source);

  const sourceRendered = renderEditableFixture(view, source, 'source');
  assert.equal(sourceRendered.projection.enumerateProjectedLeaves()
    .map((leaf) => leaf.text).join(''), source);
  assert.ok(sourceRendered.projection.enumerateProjectedLeaves()
    .every((leaf) => leaf.visibility === 'visible'));
});

test('unordered Live CSS reserves one state-independent marker/content grid', () => {
  assert.match(
    stylesSource,
    /\.markdown-editable-physical-row\.has-editable-list-row-presentation:not\(\.is-editable-task-list-row\)\s*\{[^}]*display:\s*grid\s*!important;[^}]*grid-template-columns:[^}]*--markdown-editable-list-depth[^}]*--markdown-editable-list-indent-step[^}]*--markdown-editable-list-marker-width[^}]*minmax\(0,\s*1fr\)/s
  );
  assert.match(
    stylesSource,
    /\.markdown-editable-list-marker-slot\s*\{[^}]*white-space:\s*pre;[^}]*tab-size:\s*var\(--markdown-editable-list-indent-step\)/s
  );
  assert.match(
    stylesSource,
    /\.markdown-editable-list-content-slot\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*pre-wrap;/s
  );
  assert.match(
    stylesSource,
    /\.markdown-editable-list-marker-slot\s*>\s*\.markdown-editable-list-bullet\s*\{[^}]*margin-inline-start:\s*calc\([^}]*--markdown-editable-list-depth[^}]*--markdown-editable-list-indent-step/s
  );
  assert.doesNotMatch(
    stylesSource,
    /\.markdown-editable-physical-row\.is-editable-list-presentation-rendered\s*\{[^}]*padding-left/s,
    'ordinary unordered rows cannot reserve depth only while inactive'
  );
  assert.doesNotMatch(
    stylesSource,
    /\.markdown-editable-list-(?:marker|content)-slot\s*\{[^}]*margin(?:-inline-start|-left)?\s*:\s*-/s,
    'the stable gutter cannot depend on a font-specific negative-margin offset'
  );
});

test('Live task checkbox performs one exact canonical toggle with one Undo and Redo entry', () => {
  const source = ['- [ ] todo', '\t- [X] done'].join('\n');
  let commits = 0;
  const view = loadController([
    'renderEditableDocumentBlocks',
    'createMarkdownEditHistory',
    'applyMarkdownEditHistory'
  ]);
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  rendered.state.onBodyCommit = () => { commits += 1; };
  const firstControl = descendants(rendered.bodyRoot).find((node) => (
    node.classList?.contains('markdown-editable-task-control')
  ));
  const input = firstControl.querySelector('input[type="checkbox"]');
  const change = input.listeners.get('change')[0];
  input.checked = true;
  change({
    currentTarget: input,
    stopPropagation() {}
  });

  const toggled = ['- [x] todo', '\t- [X] done'].join('\n');
  assert.equal(rendered.state.body, toggled);
  assert.equal(commits, 1);
  assert.equal(rendered.state.editHistory.undoStack.length, 1);
  const transaction = rendered.state.editHistory.undoStack[0];
  assert.equal(transaction.inputType, 'formatTaskList');
  assert.deepEqual({
    start: transaction.primaryEdit.start,
    end: transaction.primaryEdit.end,
    replacement: transaction.primaryEdit.replacement
  }, {
    start: source.indexOf('[ ]') + 1,
    end: source.indexOf('[ ]') + 2,
    replacement: 'x'
  });
  assert.equal(view.applyMarkdownEditHistory(rendered.state, 'undo'), true);
  assert.equal(rendered.state.body, source);
  assert.equal(view.applyMarkdownEditHistory(rendered.state, 'redo'), true);
  assert.equal(rendered.state.body, toggled);
});

test('Live renders newly continued empty list rows and toggles an empty task by exact source range', () => {
  const view = loadController([
    'renderEditableDocumentBlocks',
    'createMarkdownEditHistory'
  ]);

  for (const source of ['- ', '- [ ] ', '- [x] ']) {
    const rendered = renderEditableFixture(view, source);
    assert.equal(rendered.state.editablePresentationPlan.constructs.listRows.length, 1);
    assert.equal(rendered.projection.enumeratePhysicalRows().length, 1);
    assert.equal(
      rendered.projection.enumeratePlanActivationAnchors().length,
      1,
      `${JSON.stringify(source)} keeps one exact inactive-Live activation anchor`
    );
  }

  for (const source of ['- [ ] Alpha', '- [x] Alpha', '\t- [X] Alpha']) {
    const continued = markdown.applyMarkdownNewline(
      source,
      { anchor: source.length, focus: source.length },
      { inputType: 'insertParagraph' }
    );
    const rendered = renderEditableFixture(view, continued.source);
    assert.equal(continued.source.endsWith('\n' + source.match(/^\t*/)[0] + '- [ ] '), true);
    assert.equal(rendered.state.editablePresentationPlan.constructs.listRows.length, 2);
    assert.equal(descendants(rendered.bodyRoot).filter((node) => (
      node.classList?.contains('markdown-editable-task-control')
    )).length, 2);
  }

  const source = '- [ ] ';
  const rendered = renderEditableFixture(view, source);
  rendered.state.editHistory = view.createMarkdownEditHistory(source);
  const control = descendants(rendered.bodyRoot).find((node) => (
    node.classList?.contains('markdown-editable-task-control')
  ));
  const input = control.querySelector('input[type="checkbox"]');
  input.checked = true;
  input.listeners.get('change')[0]({
    currentTarget: input,
    stopPropagation() {}
  });
  assert.equal(rendered.state.body, '- [x] ');
  assert.equal(rendered.state.editHistory.undoStack.length, 1);
  assert.deepEqual({ ...rendered.state.editHistory.undoStack[0].primaryEdit }, {
    start: 3,
    end: 4,
    replacement: 'x',
    kind: 'task-list-toggle'
  });
});

test('Live keeps strict ordered marker leaves editable and folds only through the disclosure', () => {
  const source = ['1. Parent', '\t1. Child', '2. Next'].join('\n');
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const rows = rendered.projection.enumeratePhysicalRows();
  const marker = rendered.projection.enumerateProjectedLeaves().find((leaf) => (
    leaf.physicalLineId === rows[0].physicalLineId
    && leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'ordered-list' && role.role === 'marker'
    ))
  ));
  assert.ok(marker);
  assert.equal(marker.element.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(marker.element.classList.contains(
    'markdown-structural-editable-list-marker-trigger'
  ), false);
  assert.equal(descendants(rendered.bodyRoot).some((node) => (
    ['OL', 'UL', 'LI'].includes(node.tagName)
  )), false);

  const control = descendants(rendered.bodyRoot).find((node) => (
    node.classList?.contains('markdown-structural-fold-control')
      && node.dataset.markdownStructuralFoldKind === 'list'
  ));
  assert.ok(control);
  assert.equal(control.attributes['aria-expanded'], 'true');
  const calls = { preventDefault: 0, stopPropagation: 0, stopImmediatePropagation: 0 };
  control.listeners.get('click')[0]({
    button: 0,
    target: control,
    clientX: 1,
    clientY: 1,
    preventDefault() { calls.preventDefault += 1; },
    stopPropagation() { calls.stopPropagation += 1; },
    stopImmediatePropagation() { calls.stopImmediatePropagation += 1; }
  });

  assert.deepEqual(calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 1
  });
  assert.equal(rows[1].element.hidden, true);
  assert.equal(Boolean(rows[2].element.hidden), false);
  assert.equal(rendered.state.body, source);
  assert.equal(rendered.state.markdownFoldDescriptors.length, 1);
  assert.equal(rendered.state.markdownFoldDescriptors[0].kind, 'list');
});

test('Live unordered bullet and active canonical marker never steal the fold interaction', () => {
  const source = ['- Parent', '\t- Child', '- Next'].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection'
  ]);
  const rendered = renderEditableFixture(view, source);
  const parentListRow = rendered.state.editablePresentationPlan.constructs.listRows[0];
  let firstRow = rendered.projection.enumeratePhysicalRows()[0].element;
  const bullet = descendants(firstRow).find((node) => (
    node.classList?.contains('markdown-editable-list-bullet')
  ));
  assert.ok(bullet);
  assert.equal(bullet.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(
    firstRow.querySelector('.markdown-editable-list-marker-slot')
      .dataset.markdownStructuralFoldTrigger,
    undefined,
    'the indentation-bearing slot is not the fold hit owner'
  );

  rendered.state.editableActiveOwnerIds = new Set([parentListRow.ownerId]);
  view.refreshEditableProjection(rendered.state);
  firstRow = rendered.projection.enumeratePhysicalRows()[0].element;
  const markerLeaf = rendered.projection.enumerateProjectedLeaves().find((leaf) => (
    leaf.physicalLineId === rendered.projection.enumeratePhysicalRows()[0].physicalLineId
    && leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'unordered-list' && role.role === 'marker'
    ))
  ));
  const contentLeaf = rendered.projection.enumerateProjectedLeaves().find((leaf) => (
    leaf.physicalLineId === rendered.projection.enumeratePhysicalRows()[0].physicalLineId
    && leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'unordered-list' && role.role === 'content'
    ))
  ));
  assert.equal(markerLeaf.element.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(markerLeaf.element.dataset.markdownStructuralFoldSourceStart, undefined);
  assert.equal(markerLeaf.element.dataset.markdownStructuralFoldSourceEnd, undefined);
  assert.equal(contentLeaf.element.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(descendants(firstRow).some((node) => (
    node.classList?.contains('markdown-editable-list-bullet')
  )), false);
  const control = descendants(firstRow).find((node) => (
    node.classList?.contains('markdown-structural-fold-control')
  ));
  assert.ok(control);
  assert.equal(control.attributes['aria-expanded'], 'true');
});

test('nested active Live task keeps its exact dash editable and measures disclosure marker x', () => {
  const source = ['\t\t- [ ] Parent', '\t\t\t- Child', '- Next'].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection',
    'applyMarkdownStructuralFolding'
  ]);
  const rendered = renderEditableFixture(view, source);
  const parentListRow = rendered.state.editablePresentationPlan.constructs.listRows[0];
  rendered.state.editableActiveOwnerIds = new Set([parentListRow.ownerId]);
  view.refreshEditableProjection(rendered.state);

  const firstRowEntry = rendered.projection.enumeratePhysicalRows()[0];
  const firstRow = firstRowEntry.element;
  const markerLeaf = rendered.projection.enumerateProjectedLeaves().find((leaf) => (
    leaf.physicalLineId === firstRowEntry.physicalLineId
    && leaf.visibility === 'visible'
    && leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'task-list' && role.role === 'marker'
    ))
  ));
  assert.ok(markerLeaf);
  assert.equal(markerLeaf.element.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(markerLeaf.element.dataset.markdownStructuralFoldSourceStart, undefined);
  assert.equal(markerLeaf.element.dataset.markdownStructuralFoldSourceEnd, undefined);
  assert.equal(markerLeaf.element.dataset.markdownSemanticControl, undefined);
  assert.equal(descendants(firstRow).some((node) => (
    node.classList?.contains('markdown-structural-task-marker-trigger')
  )), false, 'active raw source uses its exact marker instead of a synthetic hit box');

  const owner = rendered.state.markdownFoldIndex.foldableOwners.find((candidate) => (
    candidate.kind === 'list' && candidate.lineIndex === 0
  ));
  rendered.state.markdownFoldDescriptors = [{
    kind: owner.kind,
    physicalLineId: owner.physicalLineId,
    lineIndex: owner.lineIndex,
    depth: owner.depth
  }];
  rendered.state.zoom = 2;
  firstRow.getBoundingClientRect = () => ({
    left: 100, right: 500, top: 20, bottom: 44, width: 400, height: 24
  });
  rendered.projection.collapsedPositionRect = () => ({
    left: 164, right: 164, top: 20, bottom: 44, width: 0, height: 24
  });
  view.applyMarkdownStructuralFolding(rendered.state);
  assert.equal(
    firstRow.style.getPropertyValue('--markdown-structural-fold-anchor-inline'),
    '32px',
    'viewport marker geometry is normalized back into local CSS pixels at 2x zoom'
  );
  assert.equal(descendants(firstRow).filter((node) => (
    node.classList?.contains('markdown-structural-fold-control')
  )).length, 1);
});

test('collapsed heading controls stay at line start and co-located heading/list controls do not share a host', () => {
  const view = loadController([
    'renderEditableDocumentBlocks',
    'applyMarkdownStructuralFolding'
  ]);
  const h6 = renderEditableFixture(view, '###### Heading\nchild');
  const h6Owner = h6.state.markdownFoldIndex.foldableOwners.find((owner) => (
    owner.kind === 'heading'
  ));
  h6.state.markdownFoldDescriptors = [{
    kind: h6Owner.kind,
    physicalLineId: h6Owner.physicalLineId,
    lineIndex: h6Owner.lineIndex,
    depth: h6Owner.depth
  }];
  view.applyMarkdownStructuralFolding(h6.state);
  const h6Control = descendants(h6.bodyRoot).find((node) => (
    node.classList?.contains('markdown-structural-fold-control')
  ));
  assert.equal(h6Control.parentNode, h6.projection.enumeratePhysicalRows()[0].element);

  const colocated = renderEditableFixture(view, '- # Heading\n\t- Child\n- Next');
  const colocatedOwners = colocated.state.markdownFoldIndex.foldableOwners.filter((owner) => (
    owner.lineIndex === 0
  ));
  assert.deepEqual(Array.from(colocatedOwners, (owner) => owner.kind), ['heading', 'list']);
  colocated.state.markdownFoldDescriptors = colocatedOwners.map((owner) => ({
    kind: owner.kind,
    physicalLineId: owner.physicalLineId,
    lineIndex: owner.lineIndex,
    depth: owner.depth
  }));
  view.applyMarkdownStructuralFolding(colocated.state);
  const controlsByKind = new Map(descendants(colocated.bodyRoot)
    .filter((node) => node.classList?.contains('markdown-structural-fold-control'))
    .map((node) => [node.dataset.markdownStructuralFoldKind, node]));
  assert.equal(controlsByKind.size, 2);
  assert.notEqual(
    controlsByKind.get('heading').parentNode,
    controlsByKind.get('list').parentNode
  );
  assert.equal(
    controlsByKind.get('list').parentNode,
    colocated.projection.enumeratePhysicalRows()[0].element
  );
  assert.equal(
    controlsByKind.get('heading').parentNode.classList.contains(
      'markdown-structural-fold-control-host'
    ),
    true
  );
  assert.notEqual(
    controlsByKind.get('heading').parentNode.dataset.visibility,
    'activatable',
    'the control cannot be mounted inside the inactive hidden raw heading marker'
  );
});

test('Tab-depth strict list rows mount only list presentation, never parser indented code', () => {
  const view = loadController(['renderEditableDocumentBlocks']);
  [
    { source: '\t- A', bullet: 1, task: 0 },
    { source: '\t- [ ] task', bullet: 0, task: 1 },
    { source: '\t- [ ] ', bullet: 0, task: 1 }
  ].forEach(({ source, bullet, task }) => {
    const rendered = renderEditableFixture(view, source);
    const elements = descendants(rendered.bodyRoot).filter((node) => node?.nodeType === 1);
    assert.equal(elements.filter((node) => (
      node.classList.contains('markdown-editable-list-bullet')
    )).length, bullet);
    assert.equal(elements.filter((node) => (
      node.classList.contains('markdown-editable-task-control')
    )).length, task);
    assert.equal(elements.filter((node) => (
      node.classList.contains('markdown-editable-code-block-presentation')
    )).length, 0);
    assert.equal(rendered.state.editablePresentationPlan.constructs.codeBlocks.length, 0);
  });
});

test('PageView materializes nested immutable semantic roles without changing leaf ownership', () => {
  const source = 'plain **bold *italic*** and `code`';
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source, 'source');
  const leaves = rendered.projection.enumerateProjectedLeaves();

  leaves.forEach((leaf) => {
    assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
    assert.equal(
      leaf.element.dataset.semanticOwnerId || null,
      leaf.semanticOwnerId == null ? null : String(leaf.semanticOwnerId),
      'semantic decoration cannot replace the projection-owned source owner'
    );
  });
  const nested = leaves.find((leaf) => leaf.text.includes('italic'));
  assert.ok(nested?.element.classList.contains('is-strong-content'));
  assert.ok(nested?.element.classList.contains('is-emphasis-content'));
  assert.match(nested.element.dataset.markdownSemanticRoles, /strong-content/);
  assert.match(nested.element.dataset.markdownSemanticRoles, /emphasis-content/);

  const inlineCode = rendered.state.editablePresentationPlan.constructs.inlineCode[0];
  const markers = leaves.filter((leaf) => (
    leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'inline-code' && role.role === 'marker'
    ))
  ));
  assert.equal(markers.length, 2);
  assert.equal(markers[0].sourceStart, inlineCode.start);
  assert.ok(markers[0].element.classList.contains('is-opening-marker'));
  assert.equal(markers[1].sourceEnd, inlineCode.end);
  assert.ok(markers[1].element.classList.contains('is-closing-marker'));
});

test('PageView emits stable appearance-role classes on canonical projected leaves', () => {
  const source = [
    '$x$',
    '',
    '<u>under</u>',
    '',
    '1. item',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |'
  ].join('\n');
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source, 'source');
  const leaves = rendered.projection.enumerateProjectedLeaves();
  const leavesForRole = (family, role) => leaves.filter((leaf) => (
    leaf.planLeaf.semanticRoles.some((candidate) => (
      candidate.family === family && candidate.role === role
    ))
  ));

  assert.deepEqual(leavesForRole('math-delimiter', 'marker').map((leaf) => leaf.text), ['$', '$']);
  assert.ok(leavesForRole('math-delimiter', 'marker').every((leaf) => (
    leaf.element.classList.contains('is-math-delimiter-marker')
  )));
  assert.deepEqual(leavesForRole('underline-symbol', 'marker').map((leaf) => leaf.text), ['u', 'u']);
  assert.ok(leavesForRole('underline-symbol', 'marker').every((leaf) => (
    leaf.element.classList.contains('is-underline-symbol-marker')
  )));
  assert.equal(leavesForRole('underline', 'content')[0].text, 'under');
  assert.ok(leavesForRole('underline', 'content')[0].element.classList
    .contains('is-underline-content'));
  assert.deepEqual(leavesForRole('ordered-list', 'marker').map((leaf) => leaf.text), ['1. ']);
  assert.ok(leavesForRole('ordered-list', 'marker')[0].element.classList
    .contains('is-ordered-list-marker'));
  assert.ok(leavesForRole('table-symbol', 'marker').length > 0);
  assert.ok(leavesForRole('table-symbol', 'marker').every((leaf) => (
    leaf.element.classList.contains('is-table-symbol-marker')
  )));

  leaves.forEach((leaf) => {
    assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
  });
});

test('inactive nested link markers keep role-local visibility on otherwise visible label leaves', () => {
  const source = '[**Bold**](https://example.com)';
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const leaves = rendered.projection.enumerateProjectedLeaves();
  const strongMarkers = leaves.filter((leaf) => (
    leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'strong' && role.role === 'marker'
    ))
  ));
  const strongContent = leaves.find((leaf) => (
    leaf.planLeaf.semanticRoles.some((role) => (
      role.family === 'strong' && role.role === 'content'
    ))
  ));
  assert.equal(strongMarkers.length, 2);
  strongMarkers.forEach((leaf) => {
    assert.equal(leaf.kind, 'link-label');
    assert.ok(leaf.element.classList.contains('is-strong-marker-source-hidden'));
    assert.equal(
      leaf.element.classList.contains('is-markdown-semantic-source-visible'),
      false,
      'an outer visible link-content role cannot expose a nested raw marker'
    );
  });
  assert.ok(strongContent.element.classList.contains('is-strong-content-source-visible'));
  assert.ok(strongContent.element.classList.contains('is-markdown-semantic-source-visible'));
});

test('inactive underline tags remain hidden inside an otherwise visible Live link label', () => {
  const source = '[<u>under</u>](https://example.test)';
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const plan = rendered.state.editablePresentationPlan;
  assert.equal(plan.constructs.links.length, 1);
  assert.equal(plan.constructs.underlines.length, 1);
  const underline = plan.constructs.underlines[0];
  const leaves = rendered.projection.enumerateProjectedLeaves();
  const markers = leaves.filter((leaf) => underline.markerRanges.some((range) => (
    range.start <= leaf.sourceStart && leaf.sourceEnd <= range.end
  )));
  assert.deepEqual(markers.map((leaf) => leaf.text), ['<', 'u', '>', '</', 'u', '>']);
  assert.ok(markers.every((leaf) => leaf.kind === 'link-label'));
  assert.ok(markers.every((leaf) => leaf.visibility === 'visible'));
  assert.ok(markers.every((leaf) => leaf.element.classList
    .contains('is-underline-tag-marker-source-hidden')));
  assert.ok(markers.every((leaf) => leaf.planLeaf.semanticRoles.some((role) => (
    role.family === 'link' && role.role === 'content'
  ))), 'the visible link-label role remains composed rather than replaced');
  assert.equal(rendered.state.body, source);
  assert.equal(leaves.map((leaf) => leaf.text).join(''), source);
});

test('inactive underline tags hide role-locally without stealing Live table-cell ownership', () => {
  const source = ['| A |', '| --- |', '| <u>under</u> |'].join('\n');
  const view = loadController(['renderEditableDocumentBlocks']);
  const rendered = renderEditableFixture(view, source);
  const plan = rendered.state.editablePresentationPlan;
  assert.equal(plan.constructs.tables.length, 1);
  assert.equal(plan.constructs.underlines.length, 1);
  const underline = plan.constructs.underlines[0];
  const leaves = rendered.projection.enumerateProjectedLeaves();
  const markers = leaves.filter((leaf) => underline.markerRanges.some((range) => (
    range.start <= leaf.sourceStart && leaf.sourceEnd <= range.end
  )));
  assert.deepEqual(markers.map((leaf) => leaf.text), ['<', 'u', '>', '</', 'u', '>']);
  assert.ok(markers.every((leaf) => leaf.kind === 'table-cell'));
  assert.ok(markers.every((leaf) => leaf.visibility === 'visible'));
  assert.ok(markers.every((leaf) => leaf.interactionPolicy === 'editable-table-cell'));
  assert.ok(markers.every((leaf) => leaf.element.classList
    .contains('is-underline-tag-marker-source-hidden')));
  assert.ok(markers.every((leaf) => leaf.element.dataset.semanticOwnerId
    === plan.constructs.tables[0].ownerId));
  assert.equal(rendered.state.body, source);
  assert.equal(plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join(''), source);
});

test('a Source destination clears Live-only state before building its first plan', () => {
  const source = '**bold**';
  const snapshot = markdown.createSourceSnapshot(source);
  const livePlan = syntaxAdapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const ownerId = livePlan.constructs.strong[0].ownerId;
  const view = loadController(['renderEditableDocumentBlocks']);
  const bodyRoot = new FakeElement();
  bodyRoot.isConnected = true;
  const state = {
    body: source,
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version,
    bodyRoot,
    mode: 'source',
    pageEditMode: false,
    bodyReadOnly: false,
    editableActiveOwnerIds: new Set([String(ownerId)]),
    editableActiveLineIds: new Set([String(snapshot.physicalLineIndex.lines[0].id)]),
    editableForcedRawOwnerIds: new Set([String(ownerId)])
  };
  installFixtureLinkArrowController(view, state);
  view.renderEditableDocumentBlocks(state, bodyRoot);
  assert.equal(state.editableActiveOwnerIds.size, 0);
  assert.equal(state.editableActiveLineIds.size, 0);
  assert.equal(state.editableForcedRawOwnerIds.size, 0);
  assert.equal(state.editablePresentationPlan.constructs.strong[0].active, false);
  assert.equal(state.editablePresentationPlan.mode, 'source');
});

test('quote rail depth and raw-prefix state update deterministically on reused physical rows', () => {
  const source = '> > > Quote';
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection'
  ]);
  const sourceRender = renderEditableFixture(view, source, 'source');
  const sourceRow = sourceRender.projection.enumeratePhysicalRows()[0].element;
  assert.equal(sourceRow.dataset.editableQuoteDepth, '3');
  assert.equal(sourceRow.dataset.editableQuoteRailDepth, '3');
  assert.equal(sourceRow.dataset.editableQuoteSourceVisible, 'true');

  const live = renderEditableFixture(view, source);
  const lineId = live.state.sourceSnapshot.physicalLineIndex.lines[0].id;
  const inactiveRow = live.projection.enumeratePhysicalRows()[0].element;
  assert.equal(inactiveRow.dataset.editableQuoteDepth, '3');
  assert.equal(inactiveRow.dataset.editableQuoteRailDepth, '3');
  assert.equal(inactiveRow.dataset.editableQuoteSourceVisible, 'false');
  assert.ok(live.projection.enumerateProjectedLeaves()[0].element.classList
    .contains('is-quote-marker'));

  live.state.editableActiveLineIds = new Set([String(lineId)]);
  view.refreshEditableProjection(live.state);
  const activeRow = live.projection.enumeratePhysicalRows()[0].element;
  assert.equal(activeRow, inactiveRow, 'the physical row is deterministically reconciled');
  assert.equal(activeRow.dataset.editableQuoteDepth, '3');
  assert.equal(activeRow.dataset.editableQuoteRailDepth, '3');
  assert.equal(activeRow.dataset.editableQuoteSourceVisible, 'true');
  assert.ok(activeRow.classList.contains('is-editable-quote-active'));
  assert.equal(
    live.projection.enumerateProjectedLeaves().map((leaf) => leaf.text).join(''),
    source
  );
});

test('display math transitions clean stale row state and order raw source above its preview', () => {
  const source = ['$$', 'x^2 + y^2', '$$'].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection'
  ]);
  const rendered = renderEditableFixture(view, source);
  const math = rendered.state.editablePresentationPlan.constructs.math[0];
  const inactiveRows = rendered.projection.enumeratePhysicalRows();
  const inactiveHost = descendants(rendered.bodyRoot).find((element) => (
    element.classList?.contains('markdown-editable-math-presentation')
  ));
  const inactiveFirstLeaf = rendered.projection.enumerateProjectedLeaves()[0].element;
  assert.ok(inactiveHost);
  assert.ok(inactiveRows[0].element.childNodes.indexOf(inactiveHost)
    < inactiveRows[0].element.childNodes.indexOf(inactiveFirstLeaf));
  assert.ok(inactiveRows.slice(1).every((entry) => (
    entry.element.classList.contains('is-editable-presentation-collapsed')
  )));

  rendered.state.editableActiveOwnerIds = new Set([String(math.ownerId)]);
  view.refreshEditableProjection(rendered.state);
  const activeMath = rendered.state.editablePresentationPlan.constructs.math[0];
  const activeRows = rendered.projection.enumeratePhysicalRows();
  const activeHost = descendants(rendered.bodyRoot).find((element) => (
    element.classList?.contains('markdown-editable-math-presentation')
  ));
  const activeLeaves = rendered.projection.enumerateProjectedLeaves()
    .filter((leaf) => leaf.semanticOwnerId === activeMath.ownerId);
  const lastLeaf = activeLeaves.at(-1).element;
  assert.equal(activeMath.presentation.layout, 'source-above-rendered');
  assert.ok(activeRows.at(-1).element.childNodes.indexOf(activeHost)
    > activeRows.at(-1).element.childNodes.indexOf(lastLeaf));
  assert.ok(activeRows.every((entry) => (
    !entry.element.classList.contains('is-editable-presentation-collapsed')
  )), 'active display math cannot retain inactive collapsed-row state');
  assert.equal(
    rendered.state.editablePresentationPlan.lines.map((line) => (
      line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
    )).join('').slice(0, source.length),
    source
  );
});

test('rendered Setext heading keeps both physical rows and only collapses its continuation', () => {
  const source = ['Heading', '======='].join('\n');
  const view = loadController([
    'renderEditableDocumentBlocks',
    'refreshEditableProjection'
  ]);
  const rendered = renderEditableFixture(view, source);
  const heading = rendered.state.editablePresentationPlan.constructs.headings[0];
  const inactiveRows = rendered.projection.enumeratePhysicalRows();
  assert.equal(heading.style, 'setext');
  assert.equal(inactiveRows.length, 2, 'presentation cannot merge physical editing rows');
  assert.equal(inactiveRows[0].element.dataset.editableHeadingDepth, '1');
  assert.ok(inactiveRows[0].element.classList.contains('is-editable-heading-depth-1'));
  assert.ok(inactiveRows[0].element.classList.contains('has-editable-heading-presentation'));
  assert.equal(
    inactiveRows[0].element.classList.contains('is-editable-presentation-collapsed'),
    false
  );
  assert.ok(inactiveRows[1].element.classList.contains('is-editable-presentation-collapsed'));

  rendered.state.editableActiveOwnerIds = new Set([String(heading.ownerId)]);
  view.refreshEditableProjection(rendered.state);
  const activeRows = rendered.projection.enumeratePhysicalRows();
  assert.equal(activeRows.length, 2);
  assert.ok(activeRows.every((entry) => (
    !entry.element.classList.contains('is-editable-presentation-collapsed')
  )));
  assert.equal(
    rendered.projection.enumerateProjectedLeaves().map((leaf) => leaf.text)
      .join('\n'),
    source
  );
});

test('selection loss clears Live active owners and rebuilds the inactive plan', () => {
  const view = loadController([
    'refreshEditableProjection',
    'updateLiveMarkerVisibility'
  ]);
  const rendered = controllerState('**bold**');
  view.refreshEditableProjection(rendered.state);
  const ownerId = rendered.state.editablePresentationPlan.constructs.strong[0].ownerId;
  rendered.state.editableActiveOwnerIds = new Set([String(ownerId)]);
  view.refreshEditableProjection(rendered.state);
  assert.equal(rendered.state.editablePresentationPlan.constructs.strong[0].active, true);
  const priorRenders = rendered.projection.renderCalls.length;

  rendered.projection.currentSelection = null;
  view.updateLiveMarkerVisibility(rendered.state);
  assert.equal(rendered.state.editableActiveOwnerIds.size, 0);
  assert.equal(rendered.state.editableActiveLineIds.size, 0);
  assert.equal(rendered.projection.renderCalls.length, priorRenders + 1);
  assert.equal(rendered.state.editablePresentationPlan.constructs.strong[0].active, false);
});

test('selection loss clears a table-only active cell and rebuilds its inactive DOM', () => {
  const source = ['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n');
  const view = loadController([
    'refreshEditableProjection',
    'clearEditableLiveActiveState'
  ]);
  const rendered = controllerState(source);
  view.refreshEditableProjection(rendered.state);
  const table = rendered.state.editablePresentationPlan.constructs.tables[0];
  rendered.state.editableActiveTableCell = {
    tableStart: table.start,
    header: false,
    rowIndex: 0,
    columnIndex: 0
  };
  view.refreshEditableProjection(rendered.state);
  const priorRenders = rendered.projection.renderCalls.length;

  assert.equal(view.clearEditableLiveActiveState(rendered.state), true);
  assert.equal(rendered.state.editableActiveTableCell, null);
  assert.equal(rendered.projection.renderCalls.length, priorRenders + 1);
  assert.equal(
    rendered.state.editablePresentationPlan.constructs.tables[0].activeRaw,
    false
  );
  assert.equal(view.clearEditableLiveActiveState(rendered.state), false,
    'repeated inactive cleanup is idempotent');
});

test('body focusout delegates table-cell clearing to the invalidating lifecycle', () => {
  const renderSource = functionSource('renderSemanticDocument');
  const focusoutStart = renderSource.indexOf("bodyRoot.addEventListener('focusout'");
  const focusoutEnd = renderSource.indexOf('updateSemanticEditorMode(state);', focusoutStart);
  assert.ok(focusoutStart >= 0 && focusoutEnd > focusoutStart,
    'renderSemanticDocument must retain one auditable focusout lifecycle');
  const focusoutSource = renderSource.slice(focusoutStart, focusoutEnd);
  assert.match(focusoutSource, /clearEditableLiveActiveState\(state\)/,
    'focusout must let the shared clearing function observe and invalidate table state');
  assert.doesNotMatch(focusoutSource, /editableActiveTableCell\s*=\s*null/,
    'focusout must not pre-clear the descriptor and suppress table-only invalidation');
});
