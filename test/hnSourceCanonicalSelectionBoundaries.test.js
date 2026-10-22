'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const {
  createCertificationProjection,
  samePosition
} = require('./helpers/markdownEditableCertificationHarness');

function installEventTarget(target) {
  const listeners = new Map();
  target.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  target.removeEventListener = (type, listener) => {
    const current = listeners.get(type) || [];
    listeners.set(type, current.filter((candidate) => candidate !== listener));
  };
  target.dispatch = (type, patch = {}) => {
    const event = {
      type,
      target,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...patch
    };
    for (const listener of listeners.get(type) || []) listener(event);
    return event;
  };
  return target;
}

function installInteractiveDom(document, root) {
  installEventTarget(document);
  installEventTarget(root);
  document.activeElement = null;
  root.focus = () => { document.activeElement = root; };
  root.removeAttribute = (name) => { delete root.attributes[name]; };
  root.classList.remove = (...names) => {
    names.forEach((name) => root.classList.values.delete(name));
  };
  root.classList.toggle = (name, force) => {
    const enabled = force === undefined ? !root.classList.values.has(name) : Boolean(force);
    if (enabled) root.classList.values.add(name);
    else root.classList.values.delete(name);
    return enabled;
  };
}

function presentationRuntime() {
  return Object.freeze({
    clearEditablePresentationMountState() {},
    decorateEditableProjectedLeaves() {},
    mountEditableListPresentations() {},
    mountEditableMathPresentations() {}
  });
}

function selection(anchor, affinity) {
  return Object.freeze({
    anchor,
    focus: anchor,
    anchorAffinity: affinity,
    focusAffinity: affinity
  });
}

function createSession(source, initialSelection) {
  const subscribers = new Map();
  const selections = new Map();
  const calls = { transactions: [], captures: [] };
  let currentSource = String(source);
  let sourceVersion = 1;
  const paneState = { selection: initialSelection, focused: false };
  const session = {
    focusedViewId: null,
    saveStatus: { readOnly: false },
    calls,
    currentSnapshot() {
      return Object.freeze({
        pageId: 'page-cne-selection-boundaries',
        schemaVersion: 3,
        revision: sourceVersion - 1,
        source: currentSource,
        anchors: Object.freeze({}),
        sourceVersion,
        readOnly: false
      });
    },
    subscribe(viewId, subscriber) {
      subscribers.set(viewId, subscriber);
      selections.set(viewId, initialSelection);
      subscriber.updateState(this.currentSnapshot(), { reason: 'subscribe' });
      return () => subscribers.delete(viewId);
    },
    paneStateForView() { return paneState; },
    selectionForView(viewId) { return selections.get(viewId); },
    captureSelection(viewId, nextSelection) {
      calls.captures.push({ viewId, selection: nextSelection });
      selections.set(viewId, nextSelection);
      paneState.selection = nextSelection;
      return true;
    },
    forceSelection(viewId, nextSelection) {
      selections.set(viewId, nextSelection);
      paneState.selection = nextSelection;
    },
    setFocusedView(viewId) {
      this.focusedViewId = viewId;
      return selections.get(viewId);
    },
    restoreSelection(viewId) {
      return this.focusedViewId === viewId ? selections.get(viewId) : null;
    },
    clearFocusedView(viewId) {
      if (this.focusedViewId !== viewId) return false;
      this.focusedViewId = null;
      return true;
    },
    applySourceTransaction(viewId, transaction, options) {
      assert.equal(options.sourceVersion, sourceVersion);
      calls.transactions.push({ viewId, transaction, options });
      currentSource = currentSource.slice(0, transaction.from)
        + transaction.insert + currentSource.slice(transaction.to);
      sourceVersion += 1;
      selections.set(viewId, options.selection);
      paneState.selection = options.selection;
      for (const subscriber of subscribers.values()) {
        subscriber.updateState(this.currentSnapshot(), {
          reason: 'source',
          originViewId: viewId,
          transaction
        });
      }
      return this.currentSnapshot();
    },
    undo() { return false; },
    redo() { return false; }
  };
  return session;
}

function createRealProjectionController(source, initialSelection, options = {}) {
  const mode = options.mode === 'browser' ? 'browser' : 'edit';
  const strategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: presentationRuntime()
  });
  const initialSnapshot = strategy.createSourceSnapshot(source, { version: 1 });
  const initialPlan = strategy.createPresentationPlan(initialSnapshot, {
    mode,
    activeOwnerIds: []
  });
  const { document, root, projection } = createCertificationProjection(
    initialSnapshot,
    strategy.projectionMode,
    { presentationPlan: initialPlan }
  );
  installInteractiveDom(document, root);
  const session = createSession(source, initialSelection);
  const paneState = { selection: initialSelection, focused: false };
  const restoreCalls = [];
  const restoreSelection = projection.restoreSelection.bind(projection);
  projection.restoreSelection = (value, selectionInput) => {
    const restored = restoreSelection(value, selectionInput);
    restoreCalls.push({ value, restored });
    return restored;
  };
  const controller = sourceEditor.createSourceCanonicalEditor({
    root,
    document,
    session,
    viewId: 'pane-a:tab-a:page-cne-selection-boundaries',
    paneState,
    foundation,
    projectionRuntime: {
      createEditableProjection() { return projection; },
      samePosition
    },
    presentationStrategy: strategy,
    mode
  });
  assert.equal(controller.focus(), true);
  assert.equal(controller.restoreSelection(initialSelection), true);
  restoreCalls.length = 0;
  return {
    controller,
    document,
    paneState: controller.paneState,
    projection,
    restoreCalls,
    root,
    session
  };
}

function numericProjectionSelection(projection) {
  const current = projection.getSelection();
  if (!current) return null;
  return {
    anchor: current.anchor.offset,
    focus: current.focus.offset,
    anchorAffinity: current.anchor.affinity,
    focusAffinity: current.focus.affinity
  };
}

function nativeSelectionState(fixture) {
  const native = fixture.document.getSelection();
  const anchor = fixture.projection.domToSource(native.anchorNode, native.anchorOffset);
  const focus = fixture.projection.domToSource(native.focusNode, native.focusOffset);
  return {
    anchorConnected: fixture.root.contains(native.anchorNode),
    focusConnected: fixture.root.contains(native.focusNode),
    anchor: anchor ? { offset: anchor.offset, affinity: anchor.affinity } : null,
    focus: focus ? { offset: focus.offset, affinity: focus.affinity } : null
  };
}

function assertRestoredSelection(fixture, expected, message) {
  assert.deepEqual(numericProjectionSelection(fixture.projection), expected, message);
  assert.deepEqual(nativeSelectionState(fixture), {
    anchorConnected: true,
    focusConnected: true,
    anchor: { offset: expected.anchor, affinity: expected.anchorAffinity },
    focus: { offset: expected.focus, affinity: expected.focusAffinity }
  }, `${message}: native Range`);
  assert.equal(fixture.restoreCalls.at(-1)?.restored, true, `${message}: restoreSelection`);
}

function emulateChromiumDetachedSelectionFallback(fixture) {
  const native = fixture.document.getSelection();
  if (fixture.root.contains(native.anchorNode) && fixture.root.contains(native.focusNode)) return;
  native.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
}

function declaredPosition(fixture, offset, affinity = 'after') {
  const position = fixture.projection.enumerateDeclaredPositions().find((candidate) => (
    candidate.offset === offset && candidate.affinity === affinity
  ));
  assert.ok(position, `missing declared position ${offset}:${affinity}`);
  return position;
}

function pointerEventAt(fixture, offset, affinity = 'after', patch = {}) {
  const position = declaredPosition(fixture, offset, affinity);
  const rect = fixture.projection.collapsedPositionRect(position);
  const row = fixture.projection.enumeratePhysicalRows().find((candidate) => (
    candidate.physicalLineId === position.physicalLineId
  ));
  assert.ok(rect && row?.element, `missing pointer geometry for ${offset}:${affinity}`);
  return {
    target: row.element,
    clientX: rect.left,
    clientY: rect.top + (rect.height / 2),
    button: 0,
    pointerId: 41,
    ...patch
  };
}

function declaredPositionAtOffset(fixture, offset) {
  const position = fixture.projection.enumerateDeclaredPositions().find((candidate) => (
    candidate.offset === offset
  ));
  assert.ok(position, `missing declared position at source offset ${offset}`);
  return position;
}

function numericSelectionOffsets(value) {
  return value ? { anchor: value.anchor, focus: value.focus } : null;
}

function installPointerProbe(fixture) {
  const originalPointerToPosition = fixture.projection.pointerToPosition.bind(fixture.projection);
  const calls = [];
  fixture.projection.pointerToPosition = (event) => {
    calls.push({ clientX: event?.clientX, clientY: event?.clientY, target: event?.target });
    return originalPointerToPosition(event);
  };
  return calls;
}

function installGranularityStub(fixture, resolveRange) {
  const calls = [];
  fixture.projection.selectTextGranularity = (position, granularity, options = {}) => {
    calls.push({
      offset: position?.offset ?? null,
      sourceVersion: position?.sourceVersion ?? null,
      granularity,
      apply: options.apply !== false
    });
    const offsets = resolveRange(position, granularity, options);
    if (!Array.isArray(offsets) || offsets.length !== 2) return null;
    const anchor = declaredPositionAtOffset(fixture, offsets[0]);
    const focus = declaredPositionAtOffset(fixture, offsets[1]);
    const result = Object.freeze({
      sourceVersion: fixture.controller.sourceVersion(),
      anchor,
      focus,
      collapsed: anchor.offset === focus.offset,
      granularity
    });
    if (options.apply !== false
      && fixture.projection.restoreSelection({ anchor, focus }) !== true) return null;
    return result;
  };
  return calls;
}

function dispatchMouseClick(fixture, offset, detail = 1, patch = {}) {
  const pointer = pointerEventAt(fixture, offset, 'after', {
    pointerType: 'mouse',
    isPrimary: true,
    ...patch
  });
  const pointerdown = fixture.root.dispatch('pointerdown', pointer);
  const mousedown = fixture.root.dispatch('mousedown', {
    ...pointer,
    detail,
    ...patch
  });
  return { mousedown, pointer, pointerdown };
}

function endPointerGesture(fixture, pointerId = 41) {
  return fixture.document.dispatch('pointerup', { pointerId });
}

function destroyAfter(t, fixture) {
  t.after(() => fixture.controller.destroy());
  return fixture;
}

test('HN EOF Enter restores the terminal empty-row affinity and the next key stays there', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha',
    selection(5, 'before')
  ));

  const enter = fixture.root.dispatch('keydown', { key: 'Enter' });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(fixture.controller.source(), 'Alpha\n');
  assert.deepEqual(fixture.session.calls.transactions[0].options.selection, selection(6, 'after'));
  assertRestoredSelection(fixture, selection(6, 'after'), 'EOF Enter caret');

  // Chromium can normalize a detached native Range to the editable root. If
  // restoration ever regresses, model that real fallback before selectionchange.
  emulateChromiumDetachedSelectionFallback(fixture);
  fixture.document.dispatch('selectionchange');
  assert.deepEqual(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  ), selection(6, 'after'), 'selectionchange must not capture root offset zero');

  const nextKey = fixture.root.dispatch('beforeinput', {
    inputType: 'insertText',
    data: 'X'
  });
  assert.equal(nextKey.defaultPrevented, true);
  assert.equal(fixture.controller.source(), 'Alpha\nX');
  assert.deepEqual(fixture.session.calls.transactions[1].transaction, {
    from: 6,
    to: 6,
    insert: 'X'
  });
  assertRestoredSelection(fixture, selection(7, 'before'), 'next-key caret');
});

test('HN suppresses root-zero selection capture after restore failure until explicit recovery', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha',
    selection(5, 'before')
  ));
  const workingRestore = fixture.projection.restoreSelection.bind(fixture.projection);
  let rejectRestore = true;
  fixture.projection.restoreSelection = (...args) => (
    rejectRestore ? false : workingRestore(...args)
  );
  fixture.root.dispatch('beforeinput', { inputType: 'insertText', data: '!' });
  assert.equal(fixture.controller.source(), 'Alpha!');
  assert.equal(fixture.controller.diagnostics().selectionCaptureSuppressed, true);
  assert.deepEqual(fixture.controller.diagnostics().selectionRestoreFailure, {
    sourceVersion: 2,
    anchor: 6,
    anchorAffinity: 'before',
    focus: 6,
    focusAffinity: 'before'
  });
  const capturesBeforeFallback = fixture.session.calls.captures.length;

  emulateChromiumDetachedSelectionFallback(fixture);
  fixture.document.dispatch('selectionchange');
  assert.equal(fixture.session.calls.captures.length, capturesBeforeFallback,
    'selectionchange is ignored while restoration is unqualified');
  assert.deepEqual(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  ), selection(6, 'before'), 'root offset zero never replaces the session selection');

  rejectRestore = false;
  assert.equal(fixture.controller.restoreSelection(selection(6, 'before')), true);
  assert.equal(fixture.controller.diagnostics().selectionCaptureSuppressed, false);
  assert.equal(fixture.controller.diagnostics().selectionRestoreFailure, null);
  fixture.document.dispatch('selectionchange');
  assert.deepEqual(fixture.session.calls.captures.at(-1).selection, selection(6, 'before'),
    'capture resumes only after a successful explicit restoration');

  fixture.root.dispatch('beforeinput', { inputType: 'insertText', data: 'X' });
  assert.equal(fixture.controller.source(), 'Alpha!X');
  assert.deepEqual(fixture.session.calls.transactions.at(-1).transaction, {
    from: 6,
    to: 6,
    insert: 'X'
  });
  assertRestoredSelection(fixture, selection(7, 'before'), 'post-recovery next-key caret');
});

test('suppressed HN selection rejects root-zero arrows and Shift-pointer but allows plain pointer recovery', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha',
    selection(5, 'before')
  ));
  const workingRestore = fixture.projection.restoreSelection.bind(fixture.projection);
  const attemptedRestores = [];
  let rejectRestore = true;
  fixture.projection.restoreSelection = (value, ...rest) => {
    attemptedRestores.push({
      anchor: value?.anchor?.offset ?? null,
      focus: value?.focus?.offset ?? null
    });
    return rejectRestore ? false : workingRestore(value, ...rest);
  };

  fixture.root.dispatch('beforeinput', { inputType: 'insertText', data: '!' });
  assert.equal(fixture.controller.source(), 'Alpha!');
  assert.equal(fixture.controller.diagnostics().selectionCaptureSuppressed, true);
  emulateChromiumDetachedSelectionFallback(fixture);
  fixture.document.dispatch('selectionchange');
  attemptedRestores.length = 0;

  const left = fixture.root.dispatch('keydown', { key: 'ArrowLeft' });
  const right = fixture.root.dispatch('keydown', { key: 'ArrowRight' });
  const shiftedPointer = fixture.root.dispatch('pointerdown', pointerEventAt(
    fixture,
    3,
    'after',
    { shiftKey: true }
  ));
  assert.equal(left.defaultPrevented, true);
  assert.equal(right.defaultPrevented, true);
  assert.equal(shiftedPointer.defaultPrevented, true);
  assert.ok(attemptedRestores.every(({ anchor, focus }) => anchor >= 5 && focus >= 5),
    `suppressed interactions used an untrusted root-zero selection: ${JSON.stringify(attemptedRestores)}`);
  assert.deepEqual(fixture.controller.diagnostics().selection, selection(6, 'before'));
  assert.deepEqual(fixture.controller.diagnostics().selectionRestoreFailure, {
    sourceVersion: 2,
    anchor: 6,
    anchorAffinity: 'before',
    focus: 6,
    focusAffinity: 'before'
  }, 'rejected navigation does not replace the qualified failure boundary with root zero');
  assert.deepEqual(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  ), selection(6, 'before'));
  assert.equal(fixture.session.calls.transactions.length, 1,
    'navigation and selection gestures do not add canonical history');

  rejectRestore = false;
  const plainPointer = fixture.root.dispatch('pointerdown', pointerEventAt(fixture, 3));
  fixture.document.dispatch('pointerup', { pointerId: 41 });
  assert.equal(plainPointer.defaultPrevented, true);
  assert.equal(fixture.controller.diagnostics().selectionCaptureSuppressed, false,
    'a self-contained non-shift pointer selection is a legitimate recovery');
  assert.deepEqual(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  ), selection(3, 'after'));
  assertRestoredSelection(fixture, selection(3, 'after'), 'plain-pointer recovery caret');
  assert.equal(fixture.session.calls.transactions.length, 1,
    'pointer recovery preserves canonical history');
});

for (const operation of [
  { key: 'ArrowRight', start: 1, expected: 3 },
  { key: 'ArrowLeft', start: 3, expected: 1 }
]) {
  test(`HN ${operation.key} skips the declared UTF-16 interior of a surrogate pair`, (t) => {
    const fixture = destroyAfter(t, createRealProjectionController(
      'A😀B',
      selection(operation.start, 'after')
    ));

    fixture.root.dispatch('keydown', { key: operation.key });

    assertRestoredSelection(
      fixture,
      selection(operation.expected, 'after'),
      `${operation.key} surrogate caret`
    );
    assert.equal(fixture.session.calls.transactions.length, 0,
      'horizontal movement does not create canonical history');
  });
}

test('HN mouse detail reuses the first canonical anchor for native word and block selection', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha beta\nGamma delta',
    selection(0, 'after')
  ));
  const pointerCalls = installPointerProbe(fixture);
  const granularityCalls = installGranularityStub(fixture, (_position, granularity) => (
    granularity === 'word' ? [0, 5] : [0, 10]
  ));

  const first = dispatchMouseClick(fixture, 2, 1);
  assert.equal(first.pointerdown.defaultPrevented, false,
    'mouse pointerdown leaves Chromium click counting and native gesture recognition available');
  assert.equal(first.pointerdown.propagationStopped, true,
    'the Page surface still owns the pointer gesture outside surrounding UI');
  assert.equal(first.mousedown.defaultPrevented, true,
    'the canonical single-click owner installs the exact source caret');
  assert.equal(pointerCalls.length, 1, 'only mousedown detail 1 performs a coordinate hit test');
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 2,
    focus: 2
  });
  assert.equal(fixture.controller.multiClickAnchor?.position?.offset, 2);
  endPointerGesture(fixture);

  const second = dispatchMouseClick(fixture, 8, 2);
  assert.equal(second.pointerdown.defaultPrevented, false);
  assert.equal(second.mousedown.defaultPrevented, true);
  assert.equal(pointerCalls.length, 1,
    'detail 2 does not re-hit-test coordinates after presentation geometry can move');
  assert.deepEqual(granularityCalls.at(-1), {
    offset: 2,
    sourceVersion: fixture.controller.sourceVersion(),
    granularity: 'word',
    apply: true
  });
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 0,
    focus: 5
  });
  assert.deepEqual(numericSelectionOffsets(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  )), { anchor: 0, focus: 5 }, 'word selection is captured by the existing Page session');
  assert.deepEqual(numericSelectionOffsets(fixture.paneState.selection), {
    anchor: 0,
    focus: 5
  }, 'word selection is captured by the existing Pane-local state');
  endPointerGesture(fixture);

  dispatchMouseClick(fixture, 15, 3);
  assert.equal(pointerCalls.length, 1,
    'detail 3 also stays anchored to the first canonical click');
  assert.deepEqual(granularityCalls.at(-1), {
    offset: 2,
    sourceVersion: fixture.controller.sourceVersion(),
    granularity: 'block',
    apply: true
  });
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 0,
    focus: 10
  });
  assert.equal(fixture.session.calls.transactions.length, 0,
    'selection gestures never create canonical history');
});

test('HN Edit syntax reveal cannot move the saved click anchor and typing replaces its word range', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    '**Alpha** Beta',
    selection(0, 'after')
  ));
  const pointerCalls = installPointerProbe(fixture);
  const granularityCalls = installGranularityStub(fixture, () => [2, 7]);

  dispatchMouseClick(fixture, 3, 1);
  endPointerGesture(fixture);
  assert.ok(fixture.controller.diagnostics().activeOwnerIds.length > 0,
    'the first Edit click activates the shared syntax owner and can remount presentation');
  assert.equal(fixture.controller.multiClickAnchor?.position?.offset, 3,
    'the anchor remains a canonical position rather than a rendered coordinate');

  dispatchMouseClick(fixture, 11, 2);
  assert.equal(pointerCalls.length, 1,
    'the second click does not use the shifted coordinate after syntax reveal');
  assert.equal(granularityCalls.at(-1)?.offset, 3);
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 2,
    focus: 7
  });

  const replace = fixture.root.dispatch('beforeinput', {
    inputType: 'insertText',
    data: 'Omega'
  });
  assert.equal(replace.defaultPrevented, true);
  assert.equal(fixture.controller.source(), '**Omega** Beta');
  assert.deepEqual(fixture.session.calls.transactions.at(-1).transaction, {
    from: 2,
    to: 7,
    insert: 'Omega'
  }, 'typing replaces the exact canonical word range through the existing transaction owner');
});

test('HN Browser selects ordinary words and blocks without mutating canonical source', (t) => {
  const source = 'Alpha beta\nGamma delta';
  const fixture = destroyAfter(t, createRealProjectionController(
    source,
    selection(0, 'after'),
    { mode: 'browser' }
  ));
  installGranularityStub(fixture, (_position, granularity) => (
    granularity === 'word' ? [0, 5] : [0, 10]
  ));

  dispatchMouseClick(fixture, 2, 1);
  endPointerGesture(fixture);
  dispatchMouseClick(fixture, 8, 2);
  assert.deepEqual(numericSelectionOffsets(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  )), { anchor: 0, focus: 5 });
  endPointerGesture(fixture);
  dispatchMouseClick(fixture, 15, 3);
  assert.deepEqual(numericSelectionOffsets(fixture.paneState.selection), {
    anchor: 0,
    focus: 10
  });

  const rejectedTyping = fixture.root.dispatch('beforeinput', {
    inputType: 'insertText',
    data: 'X'
  });
  assert.equal(rejectedTyping.defaultPrevented, true);
  assert.equal(fixture.controller.source(), source,
    'Browser selection never becomes a Page mutation owner');
  assert.equal(fixture.session.calls.transactions.length, 0);
});

test('HN Browser inactive syntax fails closed when browser granularity cannot exact-roundtrip', (t) => {
  const source = '**Alpha**';
  const fixture = destroyAfter(t, createRealProjectionController(
    source,
    selection(0, 'after'),
    { mode: 'browser' }
  ));
  const pointerCalls = installPointerProbe(fixture);
  const granularityCalls = installGranularityStub(fixture, () => null);

  dispatchMouseClick(fixture, 3, 1);
  endPointerGesture(fixture);
  const before = fixture.controller.diagnostics().selection;
  const second = dispatchMouseClick(fixture, 7, 2);

  assert.equal(second.mousedown.defaultPrevented, true);
  assert.equal(pointerCalls.length, 1,
    'a rejected Browser syntax expansion never falls back to shifted coordinates');
  assert.deepEqual(granularityCalls.map((call) => ({ offset: call.offset, granularity: call.granularity })), [
    { offset: 3, granularity: 'word' }
  ]);
  assert.deepEqual(fixture.controller.diagnostics().selection, before,
    'unmappable browser granularity preserves the previously qualified selection');
  assert.equal(fixture.controller.source(), source);
  assert.equal(fixture.session.calls.transactions.length, 0);
});

test('HN stale and unmappable saved anchors fail closed without coordinate or offset-zero fallback', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha beta',
    selection(0, 'after')
  ));
  const pointerCalls = installPointerProbe(fixture);
  const granularityCalls = installGranularityStub(fixture, () => [0, 5]);

  dispatchMouseClick(fixture, 2, 1);
  endPointerGesture(fixture);
  const qualified = fixture.controller.diagnostics().selection;
  fixture.controller.multiClickAnchor = Object.freeze({
    ...fixture.controller.multiClickAnchor,
    sourceVersion: fixture.controller.sourceVersion() + 1
  });
  dispatchMouseClick(fixture, 8, 2);
  assert.equal(pointerCalls.length, 1);
  assert.equal(granularityCalls.length, 0);
  assert.deepEqual(fixture.controller.diagnostics().selection, qualified,
    'a stale anchor preserves the qualified first-click caret');
  assert.notEqual(fixture.controller.diagnostics().selection.anchor, 0,
    'failure cannot silently substitute the root-zero caret');
  endPointerGesture(fixture);

  dispatchMouseClick(fixture, 2, 1);
  endPointerGesture(fixture);
  const sourceToDom = fixture.projection.sourceToDom.bind(fixture.projection);
  fixture.projection.sourceToDom = (position) => (
    position?.offset === 2 ? null : sourceToDom(position)
  );
  dispatchMouseClick(fixture, 8, 2);
  fixture.projection.sourceToDom = sourceToDom;
  assert.equal(pointerCalls.length, 2,
    'only the two explicit first clicks ever invoke pointer hit-testing');
  assert.equal(granularityCalls.length, 0);
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 2,
    focus: 2
  }, 'an unmappable saved anchor leaves the first-click caret intact');
  assert.equal(fixture.session.calls.transactions.length, 0);
});

test('HN failed fresh detail-1 placement invalidates the prior multi-click anchor', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha beta',
    selection(0, 'after')
  ));
  const pointerCalls = installPointerProbe(fixture);
  const granularityCalls = installGranularityStub(fixture, () => [0, 5]);

  dispatchMouseClick(fixture, 2, 1);
  endPointerGesture(fixture);
  const qualified = fixture.controller.diagnostics().selection;
  assert.equal(fixture.controller.multiClickAnchor?.position?.offset, 2);

  const restoreSelection = fixture.projection.restoreSelection.bind(fixture.projection);
  const rejectedPlacements = [];
  fixture.projection.restoreSelection = (value, ...rest) => {
    if (value?.anchor?.offset === 8 && value?.focus?.offset === 8) {
      rejectedPlacements.push({
        anchor: value.anchor.offset,
        focus: value.focus.offset
      });
      return false;
    }
    return restoreSelection(value, ...rest);
  };

  const failedFirst = dispatchMouseClick(fixture, 8, 1);
  assert.equal(failedFirst.mousedown.defaultPrevented, true,
    'a mapped fresh click stays inside the canonical selection owner even when restoration fails');
  assert.deepEqual(rejectedPlacements, [{ anchor: 8, focus: 8 }]);
  assert.equal(fixture.controller.multiClickAnchor, null,
    'detail 1 invalidates the preceding click sequence before attempting canonical placement');
  assert.deepEqual(fixture.controller.diagnostics().selection, qualified,
    'failed fresh placement keeps the previously qualified canonical selection');
  endPointerGesture(fixture);

  const rejectedSecond = dispatchMouseClick(fixture, 5, 2);
  assert.equal(rejectedSecond.mousedown.defaultPrevented, true);
  assert.equal(pointerCalls.length, 2,
    'the failed detail 1 is the last coordinate hit test; detail 2 cannot re-hit or revive an old anchor');
  assert.equal(granularityCalls.length, 0,
    'no browser granularity operation runs without the new sequence anchor');
  assert.deepEqual(fixture.controller.diagnostics().selection, qualified);
  assert.deepEqual(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  ), qualified, 'the existing Page session retains the qualified selection');
  assert.deepEqual(fixture.paneState.selection, qualified,
    'the existing Pane state retains the qualified selection');
  assert.notEqual(qualified.anchor, 0,
    'failure does not substitute the editable root or source offset zero');
  assert.equal(fixture.session.calls.transactions.length, 0);
});

test('HN word and block drag extend by browser granularity from the immutable first anchor', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha beta\nGamma delta',
    selection(0, 'after')
  ));
  installGranularityStub(fixture, (position, granularity) => {
    if (granularity === 'word') return position.offset <= 5 ? [0, 5] : [6, 10];
    return position.offset <= 10 ? [0, 10] : [11, 22];
  });

  dispatchMouseClick(fixture, 2, 1);
  endPointerGesture(fixture);
  dispatchMouseClick(fixture, 8, 2);
  const wordDrag = fixture.document.dispatch('pointermove', pointerEventAt(fixture, 8));
  assert.equal(wordDrag.defaultPrevented, true);
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 0,
    focus: 10
  }, 'double-click drag extends to the complete moving word');
  endPointerGesture(fixture);

  dispatchMouseClick(fixture, 14, 3);
  const blockDrag = fixture.document.dispatch('pointermove', pointerEventAt(fixture, 14));
  assert.equal(blockDrag.defaultPrevented, true);
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 0,
    focus: 22
  }, 'triple-click drag extends to the complete moving browser block');
  assert.equal(fixture.session.calls.transactions.length, 0);
});

test('HN preserves right-click, Shift, touch, and pen selection ownership', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha beta',
    selection(0, 'after')
  ));
  const pointerCalls = installPointerProbe(fixture);
  const granularityCalls = installGranularityStub(fixture, () => [0, 5]);

  const right = fixture.root.dispatch('pointerdown', pointerEventAt(fixture, 2, 'after', {
    button: 2,
    pointerType: 'mouse'
  }));
  const controlClick = fixture.root.dispatch('pointerdown', pointerEventAt(fixture, 2, 'after', {
    button: 0,
    ctrlKey: true,
    pointerType: 'mouse'
  }));
  assert.equal(right.defaultPrevented, false);
  assert.equal(right.propagationStopped, false);
  assert.equal(controlClick.defaultPrevented, false);
  assert.equal(controlClick.propagationStopped, false);
  assert.equal(pointerCalls.length, 0, 'context-menu gestures never enter text hit-testing');

  dispatchMouseClick(fixture, 2, 1);
  endPointerGesture(fixture);
  const shifted = dispatchMouseClick(fixture, 8, 2, { shiftKey: true });
  assert.equal(shifted.mousedown.defaultPrevented, true);
  assert.equal(granularityCalls.length, 0,
    'Shift keeps directional character selection rather than multi-click granularity');
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 2,
    focus: 8
  });
  endPointerGesture(fixture);

  const touch = fixture.root.dispatch('pointerdown', pointerEventAt(fixture, 4, 'after', {
    pointerId: 51,
    pointerType: 'touch'
  }));
  assert.equal(touch.defaultPrevented, true);
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 4,
    focus: 4
  });
  endPointerGesture(fixture, 51);

  const pen = fixture.root.dispatch('pointerdown', pointerEventAt(fixture, 6, 'after', {
    pointerId: 61,
    pointerType: 'pen'
  }));
  assert.equal(pen.defaultPrevented, true);
  assert.deepEqual(numericSelectionOffsets(fixture.controller.diagnostics().selection), {
    anchor: 6,
    focus: 6
  });
  endPointerGesture(fixture, 61);
  assert.equal(fixture.session.calls.transactions.length, 0);
});

test('HN native surrogate-interior capture normalizes to a code-point boundary', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'A😀B',
    selection(1, 'after')
  ));
  const interior = declaredPosition(fixture, 2, 'after');
  assert.equal(fixture.projection.restoreSelection({ anchor: interior, focus: interior }), true);
  assert.equal(fixture.projection.getSelection().focus.offset, 2,
    'the native regression setup reaches the Projection UTF-16 interior');

  fixture.controller.captureSelection();

  assert.deepEqual(fixture.session.selectionForView(
    'pane-a:tab-a:page-cne-selection-boundaries'
  ), selection(3, 'after'), 'native after-affinity snaps past the complete surrogate pair');
  assert.deepEqual(fixture.controller.diagnostics().selection, selection(3, 'after'));
  assert.notEqual(fixture.controller.diagnostics().selection.focus, 2,
    'a surrogate-interior offset cannot persist into Page/session selection');

  assert.equal(fixture.controller.restoreSelection(selection(2, 'before')), true);
  assertRestoredSelection(fixture, selection(1, 'after'),
    'programmatic before-affinity snaps before the complete surrogate pair');
});

for (const operation of ['Backspace', 'Delete']) {
  test(`HN ${operation} defensively removes a complete surrogate from a suppressed interior`, (t) => {
    const fixture = destroyAfter(t, createRealProjectionController(
      'A😀B',
      selection(1, 'after')
    ));
    const viewId = 'pane-a:tab-a:page-cne-selection-boundaries';
    const workingRestore = fixture.projection.restoreSelection.bind(fixture.projection);
    fixture.controller.localSelection = selection(2, 'after');
    fixture.session.forceSelection(viewId, selection(2, 'after'));
    fixture.projection.restoreSelection = () => false;
    assert.equal(fixture.controller.restoreSelection(selection(2, 'after')), false,
      'forced restore failure enters the defensive suppression path');
    fixture.projection.restoreSelection = workingRestore;
    assert.equal(fixture.controller.diagnostics().selectionCaptureSuppressed, true);
    emulateChromiumDetachedSelectionFallback(fixture);
    assert.deepEqual(fixture.session.selectionForView(
      viewId
    ), selection(2, 'after'), 'the defensive regression begins with local/session interior state');

    fixture.root.dispatch('keydown', { key: operation });

    assert.equal(fixture.controller.source(), 'AB');
    assert.deepEqual(fixture.session.calls.transactions[0].transaction, {
      from: 1,
      to: 3,
      insert: ''
    });
    assertRestoredSelection(fixture, selection(1, 'after'), `${operation} surrogate caret`);
  });
}

test('HN Space at a nonfinal row end keeps the caret on that row', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha\nBeta',
    selection(5, 'before')
  ));

  fixture.root.dispatch('beforeinput', { inputType: 'insertText', data: ' ' });

  assert.equal(fixture.controller.source(), 'Alpha \nBeta');
  assert.deepEqual(fixture.session.calls.transactions[0].options.selection, selection(6, 'before'));
  assertRestoredSelection(fixture, selection(6, 'before'), 'nonfinal row-end Space caret');
});

test('HN Backspace at a nonfinal row end keeps the caret on that row', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    'Alpha \nBeta',
    selection(6, 'before')
  ));

  fixture.root.dispatch('keydown', { key: 'Backspace' });

  assert.equal(fixture.controller.source(), 'Alpha\nBeta');
  assert.deepEqual(fixture.session.calls.transactions[0].options.selection, selection(5, 'before'));
  assertRestoredSelection(fixture, selection(5, 'before'), 'nonfinal row-end Backspace caret');
});

for (const operation of [
  {
    name: 'Backspace',
    initial: selection(7, 'before'),
    event: ['keydown', { key: 'Backspace' }]
  },
  {
    name: 'Delete',
    initial: selection(6, 'after'),
    event: ['keydown', { key: 'Delete' }]
  }
]) {
  test(`HN ${operation.name} that leaves a terminal empty row restores its only declared caret`, (t) => {
    const fixture = destroyAfter(t, createRealProjectionController(
      'Alpha\nX',
      operation.initial
    ));

    fixture.root.dispatch(...operation.event);

    assert.equal(fixture.controller.source(), 'Alpha\n');
    assert.deepEqual(fixture.session.calls.transactions[0].options.selection, selection(6, 'after'));
    assertRestoredSelection(fixture, selection(6, 'after'), `${operation.name} terminal-empty caret`);
  });
}

test('HN Backspace at an authored sequence marker start remains an exact CRLF source edit', (t) => {
  const fixture = destroyAfter(t, createRealProjectionController(
    '1. A\r\n9. B',
    selection(6, 'after')
  ));

  fixture.root.dispatch('keydown', { key: 'Backspace' });

  assert.equal(fixture.controller.source(), '1. A9. B');
  assert.deepEqual(fixture.session.calls.transactions[0].transaction, {
    from: 4,
    to: 6,
    insert: ''
  });
  assert.equal(fixture.controller.source().includes('2. B'), false,
    'editing before the canonical marker may invalidate syntax but never invokes Markdown numbering');
  assertRestoredSelection(fixture, selection(4, 'after'), 'authored marker-boundary CRLF caret');
});

for (const operation of [
  {
    name: 'Backspace',
    initial: selection(7, 'after'),
    event: ['keydown', { key: 'Backspace' }]
  },
  {
    name: 'Delete',
    initial: selection(5, 'before'),
    event: ['keydown', { key: 'Delete' }]
  }
]) {
  test(`HN ${operation.name} removes CRLF atomically and restores a visible joined-row caret`, (t) => {
    const fixture = destroyAfter(t, createRealProjectionController(
      'Alpha\r\nX',
      operation.initial
    ));

    fixture.root.dispatch(...operation.event);

    assert.equal(fixture.controller.source(), 'AlphaX');
    assert.deepEqual(fixture.session.calls.transactions[0].transaction, {
      from: 5,
      to: 7,
      insert: ''
    });
    assert.deepEqual(fixture.session.calls.transactions[0].options.selection, selection(5, 'after'));
    assertRestoredSelection(fixture, selection(5, 'after'), `${operation.name} CRLF caret`);
  });
}
