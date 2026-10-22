'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const hnTextModel = require('../public/hnText');
const {
  createHnPageDocumentSession,
  createPaneLocalState
} = require('../public/js/hnPageDocumentSession');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(document, tagName = 'div') {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.children = [];
    this.parentElement = null;
    this.textContent = '';
  }
  set className(value) {
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return [...this.classList.values].join(' '); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }
  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }
  replaceChildren(...children) {
    this.children = [];
    this.textContent = '';
    this.append(...children);
  }
  contains(target) {
    for (let current = target; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  focus() { this.ownerDocument.activeElement = this; }
  dispatch(type, patch = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...patch
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.listeners = new Map();
  }
  createElement(tagName) { return new FakeElement(this, tagName); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }
  dispatch(type, patch = {}) {
    const event = { type, ...patch };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class FakeProjection {
  constructor(options) {
    this.root = options.root;
    this.snapshotValue = null;
    this.selection = null;
  }
  render(snapshot, options) {
    this.renderCount = Number(this.renderCount || 0) + 1;
    this.snapshotValue = snapshot;
    this.plan = options.presentationPlan;
    if (!this.selection) {
      const position = foundation.createEditablePosition(snapshot, snapshot.markdownBody.length);
      this.selection = { anchor: position, focus: position, collapsed: true };
    }
  }
  snapshot() {
    return this.snapshotValue ? {
      sourceVersion: this.snapshotValue.version,
      markdownBody: this.snapshotValue.markdownBody
    } : null;
  }
  getSelection() { return this.selection; }
  restoreSelection(selection) {
    this.selection = {
      anchor: selection.anchor,
      focus: selection.focus,
      collapsed: selection.anchor.offset === selection.focus.offset
    };
    return true;
  }
  moveHorizontal(position, direction) {
    return foundation.createEditablePosition(
      this.snapshotValue,
      position.offset + (direction === 'left' ? -1 : 1)
    );
  }
  preferredXFor(position) { return position.logicalColumn; }
  moveVertical(position, direction) {
    const lines = this.snapshotValue.physicalLineIndex.lines;
    const target = lines[position.physicalLineIndex + (direction === 'up' ? -1 : 1)];
    return target ? foundation.createEditableLinePosition(
      this.snapshotValue,
      target.id,
      position.logicalColumn
    ) : position;
  }
  pointerToPosition(event) { return event.canonicalPosition || null; }
}

function fakeProjectionRuntime() {
  return { createEditableProjection: (options) => new FakeProjection(options) };
}

function createSession(source = '') {
  const subscribers = new Map();
  const selections = new Map();
  const calls = { transactions: [], undo: 0, redo: 0, captures: [], blur: [] };
  let sourceVersion = 1;
  let currentSource = source;
  const session = {
    focusedViewId: null,
    revision: 0,
    saveStatus: { readOnly: false },
    calls,
    currentSnapshot() {
      return Object.freeze({
        pageId: 'page-cne',
        schemaVersion: 3,
        revision: this.revision,
        source: currentSource,
        anchors: Object.freeze({}),
        sourceVersion,
        readOnly: this.saveStatus.readOnly
      });
    },
    subscribe(viewId, subscriber) {
      subscribers.set(viewId, subscriber);
      selections.set(viewId, subscriber.paneState?.selection || {
        anchor: 0, focus: 0, anchorAffinity: 'after', focusAffinity: 'after'
      });
      subscriber.updateState(this.currentSnapshot(), { reason: 'subscribe' });
      return () => subscribers.delete(viewId);
    },
    paneStateForView(viewId) { return { selection: selections.get(viewId), focused: false }; },
    selectionForView(viewId) { return selections.get(viewId); },
    captureSelection(viewId, selection) {
      calls.captures.push({ viewId, selection });
      selections.set(viewId, selection);
      return true;
    },
    setFocusedView(viewId) { this.focusedViewId = viewId; return selections.get(viewId); },
    clearFocusedView(viewId) {
      if (this.focusedViewId !== viewId) return false;
      this.focusedViewId = null;
      calls.blur.push(viewId);
      return true;
    },
    restoreSelection(viewId) {
      return this.focusedViewId === viewId ? selections.get(viewId) : null;
    },
    applySourceTransaction(viewId, transaction, options) {
      assert.equal(options.sourceVersion, sourceVersion);
      calls.transactions.push({ viewId, transaction, options });
      currentSource = currentSource.slice(0, transaction.from)
        + transaction.insert + currentSource.slice(transaction.to);
      sourceVersion += 1;
      selections.set(viewId, options.selection);
      subscribers.forEach((subscriber) => subscriber.updateState(this.currentSnapshot(), {
        reason: 'source',
        originViewId: viewId,
        transaction
      }));
      return this.currentSnapshot();
    },
    publish(reason = 'persisted') {
      subscribers.forEach((subscriber) => subscriber.updateState(this.currentSnapshot(), {
        reason,
        originViewId: null,
        transaction: null
      }));
    },
    replaceSource(sourceValue) {
      currentSource = String(sourceValue);
      sourceVersion += 1;
      this.publish('external-source');
    },
    undo() { calls.undo += 1; return true; },
    redo() { calls.redo += 1; return true; }
  };
  return session;
}

function createController(source = 'Alpha') {
  const document = new FakeDocument();
  const root = document.createElement('div');
  const session = createSession(source);
  const controller = sourceEditor.createSourceCanonicalEditor({
    root,
    document,
    session,
    viewId: 'pane-a:tab-a:page-cne',
    paneState: { selection: { anchor: 0, focus: 0 }, focused: false },
    foundation,
    projectionRuntime: fakeProjectionRuntime()
  });
  return { controller, document, root, session };
}

test('identity snapshot and PresentationPlan cover exact source rows without syntax policy', () => {
  const source = '1. A\r\n9. B\n\n😀';
  const snapshot = sourceEditor.createIdentitySourceSnapshot(source, { version: 7 });
  const plan = sourceEditor.createIdentityPresentationPlan(snapshot);

  assert.equal(snapshot.source, source);
  assert.equal(snapshot.markdownBody, source);
  assert.equal(snapshot.version, 7);
  assert.equal(plan.mode, 'source');
  assert.equal(plan.markdownBody, source);
  assert.equal(plan.lines.length, snapshot.physicalLineIndex.lines.length);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.lines), true);
  for (const line of plan.lines) {
    assert.equal(line.leaves.length, 1);
    assert.equal(line.leaves[0].text, source.slice(line.start, line.contentEnd));
    assert.equal(line.leaves[0].sourceStart, line.start);
    assert.equal(line.leaves[0].sourceEnd, line.contentEnd);
    assert.equal(line.anchors.length, 0);
  }
});

test('Edit mode routes exact text/delete/paste mutations only through the source session', () => {
  const { controller, root, session } = createController('1. A\n9. B');
  controller.focus();
  controller.restoreSelection({ anchor: 8, focus: 8 });

  root.dispatch('beforeinput', { inputType: 'insertText', data: '!' });
  assert.equal(controller.source(), '1. A\n9. !B');
  assert.deepEqual(session.calls.transactions[0].transaction, { from: 8, to: 8, insert: '!' });
  assert.equal(controller.source().includes('2. B'), false, 'identity edits never renumber literal source');

  root.dispatch('keydown', { key: 'Backspace' });
  assert.equal(controller.source(), '1. A\n9. B');

  const clipboardData = { getData: () => '\nPaste', setData() {} };
  root.dispatch('paste', { clipboardData });
  assert.equal(controller.source(), '1. A\n9. \nPasteB');
  assert.equal(session.calls.transactions.at(-1).options.inputType, 'insertFromPaste');
  controller.destroy();
});

test('Browser keeps partial canonical copy but rejects text, paste, cut, delete, and Undo mutation', () => {
  const { controller, root, session } = createController('Alpha\nBeta');
  controller.focus();
  controller.restoreSelection({ anchor: 1, focus: 5 });
  controller.setMode('browser');

  const copied = {};
  const clipboardData = {
    setData(type, value) { copied[type] = value; },
    getData() { return 'rejected'; }
  };
  const copy = root.dispatch('copy', { clipboardData });
  assert.equal(copy.defaultPrevented, true);
  assert.equal(copied['text/plain'], 'lpha');

  root.dispatch('beforeinput', { inputType: 'insertText', data: 'X' });
  root.dispatch('paste', { clipboardData });
  root.dispatch('keydown', { key: 'Delete' });
  root.dispatch('keydown', { key: 'z', metaKey: true });
  assert.equal(controller.source(), 'Alpha\nBeta');
  assert.equal(session.calls.transactions.length, 0);
  assert.equal(session.calls.undo, 0, 'Browser consumes body Undo without touching Page-wide history');
  assert.deepEqual(controller.capabilities(), {
    mode: 'browser',
    canEdit: false,
    canNavigateAnchors: true,
    canSelect: true,
    canCopy: true,
    readOnly: true,
    sessionReadOnly: false,
    pageEditMode: false
  });
  controller.destroy();
});

test('IME keeps provisional DOM view-local across publication and commits multiple updates once', async () => {
  const { controller, root, document, session } = createController('');
  controller.focus();
  const renderCountBefore = controller.projection.renderCount;
  root.dispatch('compositionstart');
  const first = root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'n', isComposing: true
  });
  root.textContent = 'n';
  root.dispatch('input', { inputType: 'insertCompositionText', data: 'n', isComposing: true });
  session.publish('persisted');
  document.dispatch('selectionchange');
  const second = root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'ni', isComposing: true
  });
  root.textContent = 'ni';
  root.dispatch('input', { inputType: 'insertCompositionText', data: 'ni', isComposing: true });

  assert.equal(first.defaultPrevented, false, 'native provisional composition owns its DOM');
  assert.equal(second.defaultPrevented, false, 'later provisional updates keep the same native owner');
  assert.equal(controller.source(), '', 'provisional DOM is not canonical Page source');
  assert.equal(session.calls.transactions.length, 0, 'provisional updates do not publish/remount');
  assert.equal(controller.projection.renderCount, renderCountBefore,
    'projection remains mounted throughout native composition');

  root.dispatch('compositionend', { data: '你好' });
  const redundantCommit = root.dispatch('beforeinput', {
    inputType: 'insertText', data: '你好', isComposing: false
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(controller.source(), '你好');
  assert.equal(redundantCommit.defaultPrevented, true,
    'the native final insert settles the active composition instead of appending');
  assert.equal(session.calls.transactions.length, 1);
  assert.ok(session.calls.transactions[0].options.compositionId);
  assert.deepEqual(session.calls.transactions[0].transaction, {
    from: 0, to: 0, insert: '你好'
  });
  assert.equal(controller.projection.renderCount, renderCountBefore + 1,
    'one final canonical publication reconciles the projection once');
  controller.destroy();
});

test('IME-owned Enter remains native and the next ordinary Enter runs one newline command', async () => {
  const { controller, root, session } = createController('');
  controller.focus();
  root.dispatch('compositionstart');
  root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'n', isComposing: true
  });

  const imeEnter = root.dispatch('keydown', {
    key: 'Enter', keyCode: 13, isComposing: false
  });
  assert.equal(imeEnter.defaultPrevented, false);
  assert.equal(imeEnter.propagationStopped, false);
  assert.equal(session.calls.transactions.length, 0);

  const paragraphTail = root.dispatch('beforeinput', {
    inputType: 'insertParagraph', isComposing: false
  });
  assert.equal(paragraphTail.defaultPrevented, false);
  assert.equal(paragraphTail.propagationStopped, false);
  assert.equal(session.calls.transactions.length, 0,
    'the composition keypress tail cannot create a newline transaction');

  root.dispatch('compositionend', { data: '你' });
  root.dispatch('beforeinput', {
    inputType: 'insertText', data: '你', isComposing: false
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.source(), '你');
  assert.equal(session.calls.transactions.length, 1,
    'composition settlement publishes exactly one canonical transaction');

  const ordinaryEnter = root.dispatch('keydown', {
    key: 'Enter', keyCode: 13, isComposing: false
  });
  assert.equal(ordinaryEnter.defaultPrevented, true);
  assert.equal(ordinaryEnter.propagationStopped, true);
  assert.equal(controller.source(), '你\n');
  assert.equal(session.calls.transactions.length, 2,
    'the later ordinary Enter resumes the existing newline owner exactly once');
  controller.destroy();
});

test('IME cancellation, mode settlement, blur, and external source changes remain owner-safe', async () => {
  const cancelled = createController('Alpha');
  cancelled.controller.focus();
  cancelled.controller.restoreSelection({ anchor: 0, focus: 5 });
  cancelled.root.dispatch('compositionstart');
  cancelled.root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'A', isComposing: true
  });
  cancelled.root.dispatch('compositionend', { data: '' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled.controller.source(), 'Alpha');
  assert.equal(cancelled.session.calls.transactions.length, 0,
    'empty compositionend cancels without deleting selected authored text');
  cancelled.controller.destroy();

  const mode = createController('');
  mode.controller.focus();
  mode.root.dispatch('compositionstart');
  mode.root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: '模式', isComposing: true
  });
  mode.controller.setMode('browser');
  assert.equal(mode.controller.source(), '模式');
  assert.equal(mode.session.calls.transactions.length, 1);
  assert.equal(mode.controller.diagnostics().selection.anchor, 2,
    'mode switch preserves the settled canonical caret');
  mode.controller.destroy();

  const blur = createController('');
  blur.controller.focus();
  blur.root.dispatch('compositionstart');
  blur.root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: '离开', isComposing: true
  });
  blur.document.activeElement = null;
  blur.root.dispatch('focusout', { relatedTarget: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(blur.controller.source(), '离开');
  assert.equal(blur.session.focusedViewId, null,
    'settlement timer cannot reactivate a blurred Pane owner');
  assert.deepEqual(blur.session.selectionForView('pane-a:tab-a:page-cne'), {
    anchor: 2,
    focus: 2,
    anchorAffinity: 'before',
    focusAffinity: 'before'
  }, 'blur trusts the final canonical transaction selection after focus leaves');
  blur.controller.destroy();

  const remote = createController('Base');
  remote.controller.focus();
  remote.controller.restoreSelection({ anchor: 4, focus: 4 });
  remote.root.dispatch('compositionstart');
  remote.root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'stale', isComposing: true
  });
  remote.session.replaceSource('Remote');
  await new Promise((resolve) => setTimeout(resolve, 0));
  remote.root.dispatch('compositionend', { data: 'stale' });
  const staleTail = remote.root.dispatch('beforeinput', {
    inputType: 'insertFromComposition', data: 'stale', isComposing: false
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(staleTail.defaultPrevented, true,
    'the invalidated native composition tail is consumed');
  assert.equal(remote.controller.source(), 'Remote');
  assert.equal(remote.session.calls.transactions.length, 0,
    'a changed canonical source cancels stale local composition offsets');
  remote.controller.destroy();

  const restarted = createController('Base');
  restarted.controller.focus();
  restarted.controller.restoreSelection({ anchor: 4, focus: 4 });
  restarted.root.dispatch('compositionstart');
  restarted.root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'stale', isComposing: true
  });
  restarted.session.replaceSource('Remote');
  await new Promise((resolve) => setTimeout(resolve, 0));
  restarted.root.dispatch('compositionstart');
  restarted.root.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: '新', isComposing: true
  });
  restarted.root.dispatch('beforeinput', {
    inputType: 'insertFromComposition', data: '新', isComposing: false
  });
  restarted.root.dispatch('compositionend', { data: '新' });
  assert.equal(restarted.controller.source(), 'Remo新te',
    'a new IME composition starts cleanly after a stranded invalidated predecessor');
  assert.equal(restarted.session.calls.transactions.length, 1);
  restarted.controller.destroy();
});

test('migration failure mounts one safe exact diagnostic and permanently disables mutation', () => {
  const document = new FakeDocument();
  const root = document.createElement('div');
  const failure = Object.freeze({
    error: 'Unsupported legacy node: mystery.',
    errors: Object.freeze([{ path: 'document.content[0]' }]),
    legacyEnvelope: Object.freeze({ schemaVersion: 2, document: Object.freeze({ type: 'doc' }) })
  });
  const session = createSession('');
  session.saveStatus.readOnly = true;
  session.currentSnapshot = () => Object.freeze({
    pageId: 'page-cne', schemaVersion: 2, revision: 4, source: null,
    sourceVersion: 0, readOnly: true, migrationFailure: failure
  });
  const controller = sourceEditor.createSourceCanonicalEditor({
    root, document, session, viewId: 'failure-view', foundation,
    projectionRuntime: fakeProjectionRuntime()
  });

  assert.equal(root.dataset.hnMigrationFailure, 'true');
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].textContent, failure.error);
  root.dispatch('beforeinput', { inputType: 'insertText', data: 'lost' });
  assert.equal(session.calls.transactions.length, 0);
  assert.equal(controller.diagnostics().migrationFailure.message, failure.error);
  controller.destroy();
});

test('focus lifecycle clears only the owning session view while retaining numeric selection', () => {
  const { controller, root, document, session } = createController('Alpha');
  controller.focus();
  controller.restoreSelection({ anchor: 1, focus: 4 });
  controller.captureSelection();
  document.activeElement = null;
  root.dispatch('focusout', { relatedTarget: null });

  assert.equal(session.focusedViewId, null);
  assert.deepEqual(session.calls.blur, ['pane-a:tab-a:page-cne']);
  assert.deepEqual(session.selectionForView('pane-a:tab-a:page-cne'), {
    anchor: 1,
    focus: 4,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  });
  controller.destroy();
});

test('real Page source session propagates one Edit transaction across Pane projections and one Page-wide Undo', async () => {
  const session = createHnPageDocumentSession({
    pageId: 'page-cne-shared',
    cneText: {
      schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
      revision: 0,
      source: 'Alpha',
      anchors: {}
    },
    save: async ({ cneText }) => ({ cneText: { ...cneText, revision: 1 } }),
    saveDelayMs: 60_000
  });
  const documentA = new FakeDocument();
  const documentB = new FakeDocument();
  const rootA = documentA.createElement('div');
  const rootB = documentB.createElement('div');
  const controllerA = sourceEditor.createSourceCanonicalEditor({
    root: rootA,
    document: documentA,
    session,
    viewId: 'pane-a:tab-a:page-cne-shared',
    paneState: createPaneLocalState(),
    foundation,
    projectionRuntime: fakeProjectionRuntime(),
    mode: 'edit'
  });
  const controllerB = sourceEditor.createSourceCanonicalEditor({
    root: rootB,
    document: documentB,
    session,
    viewId: 'pane-b:tab-b:page-cne-shared',
    paneState: createPaneLocalState(),
    foundation,
    projectionRuntime: fakeProjectionRuntime(),
    mode: 'browser'
  });

  controllerB.focus();
  controllerB.restoreSelection({ anchor: 5, focus: 5 });
  controllerB.captureSelection();
  controllerA.focus();
  controllerA.restoreSelection({ anchor: 0, focus: 0 });
  controllerA.captureSelection();
  rootA.dispatch('beforeinput', { inputType: 'insertText', data: '!' });

  assert.equal(session.currentSnapshot().source, '!Alpha');
  assert.equal(controllerA.source(), '!Alpha');
  assert.equal(controllerB.source(), '!Alpha');
  assert.equal(controllerB.diagnostics().selection.anchor, 6);
  assert.equal(controllerB.capabilities().canEdit, false);
  assert.equal(controllerB.capabilities().canNavigateAnchors, true);

  rootA.dispatch('keydown', { key: 'z', metaKey: true });
  assert.equal(session.currentSnapshot().source, 'Alpha');
  assert.equal(controllerB.source(), 'Alpha');

  controllerA.destroy();
  controllerB.destroy();
  await session.dispose({ flush: false });
});

test('real Page session receives one final IME transaction and one Undo across Pane projections', async () => {
  const session = createHnPageDocumentSession({
    pageId: 'page-cne-ime-shared',
    cneText: {
      schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
      revision: 0,
      source: 'Alpha',
      anchors: {}
    },
    save: async ({ cneText }) => ({ cneText: { ...cneText, revision: 1 } }),
    saveDelayMs: 60_000
  });
  const documentA = new FakeDocument();
  const documentB = new FakeDocument();
  const rootA = documentA.createElement('div');
  const rootB = documentB.createElement('div');
  const controllerA = sourceEditor.createSourceCanonicalEditor({
    root: rootA, document: documentA, session,
    viewId: 'pane-a:tab-a:page-cne-ime-shared',
    paneState: createPaneLocalState(), foundation,
    projectionRuntime: fakeProjectionRuntime(), mode: 'edit'
  });
  const controllerB = sourceEditor.createSourceCanonicalEditor({
    root: rootB, document: documentB, session,
    viewId: 'pane-b:tab-b:page-cne-ime-shared',
    paneState: createPaneLocalState(), foundation,
    projectionRuntime: fakeProjectionRuntime(), mode: 'browser'
  });

  controllerA.focus();
  controllerA.restoreSelection({ anchor: 5, focus: 5 });
  rootA.dispatch('compositionstart');
  rootA.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'n', isComposing: true
  });
  rootA.dispatch('beforeinput', {
    inputType: 'insertCompositionText', data: 'ni', isComposing: true
  });
  const finalInput = rootA.dispatch('beforeinput', {
    inputType: 'insertFromComposition', data: '你好', isComposing: false
  });
  rootA.dispatch('compositionend', { data: '你好' });

  assert.equal(finalInput.defaultPrevented, true);
  assert.equal(session.currentSnapshot().source, 'Alpha你好');
  assert.equal(controllerB.source(), 'Alpha你好');
  assert.deepEqual(session.historyDepth, { undo: 1, redo: 0 });
  rootA.dispatch('keydown', { key: 'z', metaKey: true });
  assert.equal(session.currentSnapshot().source, 'Alpha');
  assert.equal(controllerB.source(), 'Alpha');
  assert.deepEqual(session.historyDepth, { undo: 0, redo: 1 });

  controllerA.destroy();
  controllerB.destroy();
  await session.dispose({ flush: false });
});
