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
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

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

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  contains(target) {
    for (let current = target; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

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

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

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
    this.renderCount = 0;
  }

  render(snapshot, options) {
    this.renderCount += 1;
    this.snapshotValue = snapshot;
    this.plan = options.presentationPlan;
    this.mode = options.mode;
    if (!this.selection) {
      const position = foundation.createEditablePosition(snapshot, snapshot.markdownBody.length);
      this.selection = { anchor: position, focus: position, collapsed: true };
    }
  }

  enumerateProjectedLeaves() {
    return [];
  }

  snapshot() {
    return this.snapshotValue ? {
      sourceVersion: this.snapshotValue.version,
      markdownBody: this.snapshotValue.markdownBody
    } : null;
  }

  getSelection() {
    return this.selection;
  }

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

  preferredXFor(position) {
    return position.logicalColumn;
  }

  moveVertical(position, direction) {
    const lines = this.snapshotValue.physicalLineIndex.lines;
    const target = lines[position.physicalLineIndex + (direction === 'up' ? -1 : 1)];
    return target ? foundation.createEditableLinePosition(
      this.snapshotValue,
      target.id,
      position.logicalColumn
    ) : position;
  }

  pointerToPosition(event) {
    return event.canonicalPosition || null;
  }
}

function fakeProjectionRuntime() {
  return { createEditableProjection: (options) => new FakeProjection(options) };
}

function fakePresentationRuntime() {
  const calls = { clear: 0, decorate: 0, lists: 0, math: 0 };
  return {
    calls,
    clearEditablePresentationMountState() { calls.clear += 1; },
    decorateEditableProjectedLeaves() { calls.decorate += 1; },
    mountEditableListPresentations() { calls.lists += 1; },
    mountEditableMathPresentations() { calls.math += 1; }
  };
}

function createSession(source, initialSelection) {
  const subscribers = new Map();
  const selections = new Map();
  const calls = {
    subscriptions: 0,
    transactions: [],
    captures: [],
    undo: 0,
    redo: 0
  };
  let currentSource = source;
  let sourceVersion = 1;
  return {
    focusedViewId: null,
    revision: 0,
    saveStatus: { readOnly: false },
    calls,
    currentSnapshot() {
      return Object.freeze({
        pageId: 'page-cne-syntax',
        schemaVersion: 3,
        revision: this.revision,
        source: currentSource,
        anchors: Object.freeze({}),
        sourceVersion,
        readOnly: false
      });
    },
    subscribe(viewId, subscriber) {
      calls.subscriptions += 1;
      subscribers.set(viewId, subscriber);
      selections.set(viewId, subscriber.paneState?.selection || initialSelection || {
        anchor: currentSource.length,
        focus: currentSource.length,
        anchorAffinity: 'before',
        focusAffinity: 'before'
      });
      subscriber.updateState(this.currentSnapshot(), { reason: 'subscribe' });
      return () => subscribers.delete(viewId);
    },
    paneStateForView(viewId) {
      return { selection: selections.get(viewId), focused: false };
    },
    selectionForView(viewId) {
      return selections.get(viewId);
    },
    captureSelection(viewId, selection) {
      calls.captures.push({ viewId, selection });
      selections.set(viewId, selection);
      return true;
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
      subscribers.forEach((subscriber) => subscriber.updateState(this.currentSnapshot(), {
        reason: 'source',
        originViewId: viewId,
        transaction
      }));
      return this.currentSnapshot();
    },
    replaceSource(nextSource) {
      currentSource = String(nextSource);
      sourceVersion += 1;
      subscribers.forEach((subscriber) => subscriber.updateState(this.currentSnapshot(), {
        reason: 'external-source',
        originViewId: null,
        transaction: null
      }));
      return this.currentSnapshot();
    },
    undo() { calls.undo += 1; return true; },
    redo() { calls.redo += 1; return true; }
  };
}

function createController(source, options = {}) {
  const document = new FakeDocument();
  const host = document.createElement('div');
  const root = document.createElement('div');
  host.append(root);
  const initialSelection = options.initialSelection || {
    anchor: source.length,
    focus: source.length,
    anchorAffinity: 'before',
    focusAffinity: 'before'
  };
  const session = createSession(source, initialSelection);
  const presentationRuntime = fakePresentationRuntime();
  const presentationStrategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime
  });
  const controller = sourceEditor.createSourceCanonicalEditor({
    root,
    document,
    session,
    viewId: options.viewId || 'pane-a:tab-a:page-cne-syntax',
    paneState: { selection: initialSelection, focused: false },
    foundation,
    projectionRuntime: fakeProjectionRuntime(),
    presentationStrategy,
    mode: options.mode || 'edit'
  });
  return { controller, document, host, root, session, presentationRuntime };
}

function leaves(plan) {
  return plan.lines.flatMap((line) => line.leaves);
}

function markerLeaves(plan, family) {
  return leaves(plan).filter((leaf) => String(leaf.kind).startsWith(`${family}-`)
    && leaf.semanticRoles?.some((role) => role.family === family && role.role === 'marker'));
}

test('missing shared presentation cleanup fails before DOM, projection, or session ownership begins', () => {
  const source = '$x$';
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sentinel = document.createElement('span');
  sentinel.textContent = 'preserve';
  root.append(sentinel);
  const session = createSession(source);
  const presentationRuntime = fakePresentationRuntime();
  delete presentationRuntime.clearEditablePresentationMountState;
  const presentationStrategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime
  });
  let projectionCreations = 0;

  assert.throws(() => sourceEditor.createSourceCanonicalEditor({
    root,
    document,
    session,
    viewId: 'pane-a:tab-a:page-cne-preflight',
    foundation,
    projectionRuntime: {
      createEditableProjection(options) {
        projectionCreations += 1;
        return new FakeProjection(options);
      }
    },
    presentationStrategy,
    mode: 'edit'
  }), /shared Markdown presentation primitives are unavailable/);

  assert.equal(projectionCreations, 0, 'projection ownership is not created');
  assert.equal(session.calls.subscriptions, 0, 'the Page session gains no leaked subscriber');
  assert.deepEqual(root.children, [sentinel], 'existing DOM remains untouched');
  assert.deepEqual([...root.classList.values], [], 'editor classes are not mounted');
  assert.deepEqual([...root.attributes], [], 'editor accessibility state is not mounted');
  assert.deepEqual(root.dataset, {}, 'editor dataset state is not mounted');
});

test('one controller and session switch Edit/Browser in place while exact markers reveal only in active Edit', () => {
  const source = '**bold** tail';
  const { controller, host, root, session, presentationRuntime } = createController(source);
  const sourceSnapshot = controller.sourceSnapshot;

  assert.equal(host.children.filter((child) => (
    child.dataset.hnStructureRailLayer === 'true'
  )).length, 1, 'one sibling structure layer is mounted outside contenteditable');

  assert.equal(controller.diagnostics().presentationStrategy, 'hn-basic');
  assert.equal(controller.diagnostics().projectionMode, 'live-preview');
  assert.deepEqual(controller.diagnostics().activeOwnerIds, []);
  assert.deepEqual(markerLeaves(controller.presentationPlan, 'strong').map((leaf) => ({
    text: leaf.text,
    visibility: leaf.visibility
  })), [
    { text: '**', visibility: 'activatable' },
    { text: '**', visibility: 'activatable' }
  ]);

  controller.focus();
  controller.restoreSelection({ anchor: 4, focus: 4 });
  controller.captureSelection();
  assert.equal(controller.diagnostics().activeOwnerIds.length, 1);
  assert.deepEqual(markerLeaves(controller.presentationPlan, 'strong').map((leaf) => ({
    text: leaf.text,
    visibility: leaf.visibility
  })), [
    { text: '**', visibility: 'visible' },
    { text: '**', visibility: 'visible' }
  ]);

  controller.restoreSelection({ anchor: 0, focus: 8 });
  const clipboard = {};
  const copy = root.dispatch('copy', {
    clipboardData: {
      setData(type, value) { clipboard[type] = value; }
    }
  });
  assert.equal(copy.defaultPrevented, true);
  assert.equal(clipboard['text/plain'], '**bold**', 'copy uses exact canonical source offsets');

  controller.restoreSelection({ anchor: 4, focus: 4 });
  const browserCapabilities = controller.setMode('browser');
  assert.equal(browserCapabilities.canEdit, false);
  assert.equal(controller.sourceSnapshot, sourceSnapshot, 'mode switches reuse one canonical snapshot');
  assert.equal(session.calls.subscriptions, 1, 'mode switches do not replace the Page session');
  assert.deepEqual(controller.diagnostics().activeOwnerIds, []);
  assert.ok(markerLeaves(controller.presentationPlan, 'strong')
    .every((leaf) => leaf.visibility === 'activatable'));

  controller.restoreSelection({ anchor: 4, focus: 4 });
  controller.captureSelection();
  assert.deepEqual(controller.diagnostics().activeOwnerIds, [],
    'Browser never reveals syntax for an active selection');

  const editCapabilities = controller.setMode('edit');
  assert.equal(editCapabilities.canEdit, true);
  assert.equal(controller.sourceSnapshot, sourceSnapshot);
  assert.equal(session.calls.subscriptions, 1);
  assert.equal(controller.diagnostics().activeOwnerIds.length, 1);
  assert.ok(markerLeaves(controller.presentationPlan, 'strong')
    .every((leaf) => leaf.visibility === 'visible'));
  assert.equal(controller.source(), source);
  assert.equal(session.calls.transactions.length, 0);
  controller.blur();
  assert.deepEqual(controller.diagnostics().activeOwnerIds, []);
  assert.ok(markerLeaves(controller.presentationPlan, 'strong')
    .every((leaf) => leaf.visibility === 'activatable'),
  'an unfocused Edit projection returns to its inactive presentation');
  assert.ok(presentationRuntime.calls.decorate >= 4);
  controller.destroy();
  assert.equal(host.children.filter((child) => (
    child.dataset.hnStructureRailLayer === 'true'
  )).length, 0, 'controller destruction removes the sibling structure layer');
});

test('a persisted selection inside syntax stays inactive until focus and hides again on blur', () => {
  const source = '**bold** tail';
  const persistedSelection = {
    anchor: 4,
    focus: 4,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  };
  const { controller, document, root, session } = createController(source, {
    initialSelection: persistedSelection
  });

  assert.equal(controller.ownsFocus(), false);
  assert.deepEqual(controller.diagnostics().selection, persistedSelection);
  assert.deepEqual(controller.diagnostics().activeOwnerIds, [],
    'restored numeric selection alone cannot reveal syntax in an unfocused Pane');
  assert.ok(markerLeaves(controller.presentationPlan, 'strong')
    .every((leaf) => leaf.visibility === 'activatable'));

  controller.focus();
  assert.equal(controller.ownsFocus(), true);
  assert.equal(controller.diagnostics().activeOwnerIds.length, 1);
  assert.ok(markerLeaves(controller.presentationPlan, 'strong')
    .every((leaf) => leaf.visibility === 'visible'));

  document.activeElement = null;
  root.dispatch('focusout', { relatedTarget: null });
  assert.equal(controller.ownsFocus(), false);
  assert.deepEqual(controller.diagnostics().activeOwnerIds, []);
  assert.ok(markerLeaves(controller.presentationPlan, 'strong')
    .every((leaf) => leaf.visibility === 'activatable'));
  assert.equal(controller.source(), source);
  assert.equal(session.calls.transactions.length, 0);
  controller.destroy();
});

test('unordered Enter continuation and empty-item exit each publish one canonical transaction', async (t) => {
  await t.test('continuation', () => {
    const { controller, root, session } = createController('- Alpha');
    controller.focus();
    controller.restoreSelection({ anchor: 7, focus: 7 });
    const event = root.dispatch('keydown', { key: 'Enter' });

    assert.equal(event.defaultPrevented, true);
    assert.equal(controller.source(), '- Alpha\n- ');
    assert.equal(session.calls.transactions.length, 1);
    assert.deepEqual(session.calls.transactions[0].transaction, {
      from: 7,
      to: 7,
      insert: '\n- '
    });
    assert.equal(session.calls.transactions[0].options.inputType, 'insertParagraph');
    controller.destroy();
  });

  await t.test('empty root exit', () => {
    const { controller, root, session } = createController('- ');
    controller.focus();
    controller.restoreSelection({ anchor: 2, focus: 2 });
    const event = root.dispatch('beforeinput', { inputType: 'insertParagraph' });

    assert.equal(event.defaultPrevented, true);
    assert.equal(controller.source(), '');
    assert.equal(session.calls.transactions.length, 1);
    assert.deepEqual(session.calls.transactions[0].transaction, {
      from: 0,
      to: 2,
      insert: ''
    });
    assert.equal(session.calls.transactions[0].options.inputType, 'insertParagraph');
    controller.destroy();
  });
});

test('unordered Tab and Shift+Tab each publish exactly one indentation transaction', () => {
  const { controller, root, session } = createController('- Alpha');
  controller.focus();
  controller.restoreSelection({ anchor: 2, focus: 2 });

  const indent = root.dispatch('keydown', { key: 'Tab' });
  assert.equal(indent.defaultPrevented, true);
  assert.equal(controller.source(), '\t- Alpha');
  assert.equal(session.calls.transactions.length, 1);
  assert.deepEqual(session.calls.transactions[0].transaction, {
    from: 0,
    to: 0,
    insert: '\t'
  });
  assert.equal(session.calls.transactions[0].options.inputType, 'formatIndent');

  controller.restoreSelection({ anchor: 3, focus: 3 });
  const outdent = root.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(outdent.defaultPrevented, true);
  assert.equal(controller.source(), '- Alpha');
  assert.equal(session.calls.transactions.length, 2);
  assert.deepEqual(session.calls.transactions[1].transaction, {
    from: 0,
    to: 1,
    insert: ''
  });
  assert.equal(session.calls.transactions[1].options.inputType, 'formatOutdent');
  controller.destroy();
});

test('unordered commands never reconcile adjacent HN sequence neighbours', async (t) => {
  const fixtures = [
    {
      name: 'Enter continuation',
      source: '- U\n1. O\n3. P',
      selection: { anchor: 3, focus: 3 },
      dispatch(root) { root.dispatch('keydown', { key: 'Enter' }); },
      expected: '- U\n- \n1. O\n3. P'
    },
    {
      name: 'Tab indent',
      source: '- U\n3. O\n9. P',
      selection: { anchor: 1, focus: 1 },
      dispatch(root) { root.dispatch('keydown', { key: 'Tab' }); },
      expected: '\t- U\n3. O\n9. P'
    },
    {
      name: 'Shift+Tab outdent',
      source: '\t- U\n3. O\n9. P',
      selection: { anchor: 2, focus: 2 },
      dispatch(root) { root.dispatch('keydown', { key: 'Tab', shiftKey: true }); },
      expected: '- U\n3. O\n9. P'
    },
    {
      name: 'empty-item exit',
      source: '- \n1. O\n3. P',
      selection: { anchor: 2, focus: 2 },
      dispatch(root) { root.dispatch('keydown', { key: 'Enter' }); },
      expected: '\n1. O\n3. P'
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const { controller, root, session } = createController(fixture.source);
      assert.equal(controller.presentationPlan.constructs.listRows.filter((row) => (
        row.hnSequenceList === true
      )).length, 2);
      controller.focus();
      controller.restoreSelection(fixture.selection);
      fixture.dispatch(root);
      assert.equal(controller.source(), fixture.expected);
      assert.equal(session.calls.transactions.length, 1);
      assert.equal(
        controller.source().split('\n').slice(-2).join('\n'),
        fixture.source.split('\n').slice(-2).join('\n'),
        'the separately owned HN sequence source remains byte-identical'
      );
      controller.destroy();
    });
  }
});

test('sequence Enter publishes one canonical transaction while task and plain rows stay literal', async (t) => {
  await t.test('HN sequence', () => {
    const source = '1. Ordered';
    const { controller, root, session } = createController(source);
    assert.equal(controller.presentationPlan.constructs.listRows.length, 1);
    assert.equal(controller.presentationPlan.constructs.listRows[0].hnSequenceList, true);
    controller.focus();
    controller.restoreSelection({ anchor: source.length, focus: source.length });
    const event = root.dispatch('keydown', { key: 'Enter' });

    assert.equal(event.defaultPrevented, true);
    assert.equal(controller.source(), '1. Ordered\n2. ');
    assert.equal(session.calls.transactions.length, 1,
      'one sequence command contributes one Page-wide source transaction');
    assert.deepEqual(session.calls.transactions[0].transaction, {
      from: source.length,
      to: source.length,
      insert: '\n2. '
    });
    assert.equal(session.calls.transactions[0].options.inputType, 'insertParagraph');
    assert.deepEqual({
      anchor: session.calls.transactions[0].options.selection.anchor,
      focus: session.calls.transactions[0].options.selection.focus
    }, { anchor: 14, focus: 14 });
    assert.equal(controller.diagnostics().transactionCount, 1);
    controller.destroy();
  });

  const fixtures = [
    ['task', '- [ ] Task'],
    ['plain', 'Plain']
  ];
  for (const [name, source] of fixtures) {
    await t.test(name, () => {
      const { controller, root, session } = createController(source);
      assert.equal(controller.presentationPlan.constructs.listRows.length, 0);
      controller.focus();
      controller.restoreSelection({ anchor: source.length, focus: source.length });
      root.dispatch('keydown', { key: 'Enter' });

      assert.equal(controller.source(), `${source}\n`);
      assert.equal(session.calls.transactions.length, 1);
      assert.deepEqual(session.calls.transactions[0].transaction, {
        from: source.length,
        to: source.length,
        insert: '\n'
      });
      assert.equal(session.calls.transactions[0].options.inputType, 'insertParagraph');
      controller.destroy();
    });
  }
});

test('non-list Tab remains the exact literal source fallback', () => {
  const source = 'Plain';
  const { controller, root, session } = createController(source);
  controller.focus();
  controller.restoreSelection({ anchor: source.length, focus: source.length });
  root.dispatch('keydown', { key: 'Tab' });

  assert.equal(controller.source(), 'Plain\t');
  assert.equal(session.calls.transactions.length, 1);
  assert.deepEqual(session.calls.transactions[0].transaction, {
    from: source.length,
    to: source.length,
    insert: '\t'
  });
  assert.equal(session.calls.transactions[0].options.inputType, 'insertText');
  controller.destroy();
});

test('sequence Backspace joins sibling items and publishes one atomic Page transaction', () => {
  const { controller, root, session } = createController('1. A\n2. B\n3. C');
  controller.focus();
  controller.restoreSelection({ anchor: 8, focus: 8 });

  const event = root.dispatch('keydown', { key: 'Backspace' });

  assert.equal(event.defaultPrevented, true);
  assert.equal(controller.source(), '1. AB\n2. C');
  assert.equal(session.calls.transactions.length, 1);
  assert.equal(session.calls.transactions[0].options.inputType, 'deleteContentBackward');
  assert.equal(controller.transactionCount, 1);
  assert.deepEqual(session.calls.transactions[0].options.selection, {
    anchor: 4,
    focus: 4,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  });
  controller.destroy();
});

test('a cross-row Tab selection cannot import HN sequence command ownership', () => {
  const source = '- Approved\n1. Literal';
  const { controller, root, session } = createController(source);
  assert.equal(controller.presentationPlan.constructs.listRows.filter((row) => (
    row.hnSequenceList === true
  )).length, 1);
  controller.focus();
  controller.restoreSelection({
    anchor: 2,
    focus: source.length,
    anchorAffinity: 'after',
    focusAffinity: 'before'
  });
  root.dispatch('keydown', { key: 'Tab' });

  assert.equal(controller.source(), '- \t');
  assert.equal(session.calls.transactions.length, 1);
  assert.deepEqual(session.calls.transactions[0].transaction, {
    from: 2,
    to: source.length,
    insert: '\t'
  });
  assert.equal(session.calls.transactions[0].options.inputType, 'insertText');
  controller.destroy();
});

test('syntax-aware IME locations keep provisional text native and publish one final source transaction', async (t) => {
  const fixtures = [
    {
      name: 'ordinary text',
      source: 'Alpha',
      offset: 2,
      expected: 'Al界pha'
    },
    {
      name: 'bold content',
      source: '**bold**',
      offset: 4,
      expected: '**bo界ld**'
    },
    {
      name: 'italic content',
      source: '*italic*',
      offset: 3,
      expected: '*it界alic*'
    },
    {
      name: 'unordered-list content',
      source: '- Item',
      offset: 4,
      expected: '- It界em'
    },
    {
      name: 'LaTeX content',
      source: '$x$',
      offset: 2,
      expected: '$x界$'
    },
    {
      name: 'LaTeX-adjacent text',
      source: '$x$ tail',
      offset: 3,
      expected: '$x$界 tail'
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const selection = {
        anchor: fixture.offset,
        focus: fixture.offset,
        anchorAffinity: 'after',
        focusAffinity: 'after'
      };
      const { controller, root, session } = createController(fixture.source, {
        initialSelection: selection
      });
      controller.focus();
      controller.restoreSelection(selection);
      controller.captureSelection();
      const renderCount = controller.projection.renderCount;

      root.dispatch('compositionstart');
      const first = root.dispatch('beforeinput', {
        inputType: 'insertCompositionText',
        data: 'j',
        isComposing: true
      });
      root.dispatch('input', {
        inputType: 'insertCompositionText',
        data: 'j',
        isComposing: true
      });
      const second = root.dispatch('beforeinput', {
        inputType: 'insertCompositionText',
        data: 'ji',
        isComposing: true
      });
      root.dispatch('input', {
        inputType: 'insertCompositionText',
        data: 'ji',
        isComposing: true
      });

      assert.equal(first.defaultPrevented, false);
      assert.equal(second.defaultPrevented, false);
      assert.equal(controller.source(), fixture.source,
        'provisional IME text never becomes canonical source');
      assert.equal(session.calls.transactions.length, 0,
        'provisional IME updates never publish a source transaction');
      assert.equal(controller.projection.renderCount, renderCount,
        'provisional IME updates never remount syntax presentation');

      const finalInput = root.dispatch('beforeinput', {
        inputType: 'insertFromComposition',
        data: '界',
        isComposing: false
      });
      root.dispatch('compositionend', { data: '界' });

      const expectedOffset = fixture.offset + 1;
      const expectedSelection = {
        anchor: expectedOffset,
        focus: expectedOffset,
        anchorAffinity: 'after',
        focusAffinity: 'after'
      };
      assert.equal(finalInput.defaultPrevented, true);
      assert.equal(controller.source(), fixture.expected);
      assert.equal(session.calls.transactions.length, 1,
        'one native composition produces one canonical transaction');
      assert.deepEqual(session.calls.transactions[0].transaction, {
        from: fixture.offset,
        to: fixture.offset,
        insert: '界'
      });
      assert.equal(session.calls.transactions[0].options.inputType, 'insertCompositionText');
      assert.ok(session.calls.transactions[0].options.compositionId);
      assert.deepEqual(session.calls.transactions[0].options.selection, expectedSelection);
      assert.deepEqual(controller.diagnostics().selection, expectedSelection);
      assert.equal(controller.projection.renderCount, renderCount + 1,
        'the final canonical publication reconciles syntax presentation once');
      controller.destroy();
    });
  }
});

test('IME-owned Enter cannot run HN newline/list commands before composition settlement', async (t) => {
  const syntaxFixtures = [
    {
      name: 'plain text',
      source: 'Alpha',
      afterEnter(composed) { return `Alpha${composed}\n`; }
    },
    {
      name: 'unordered list',
      source: '- Item',
      afterEnter(composed) { return `- Item${composed}\n- `; }
    },
    {
      name: 'inline-math adjacent',
      source: '$x$',
      afterEnter(composed) { return `$x$${composed}\n`; }
    }
  ];
  for (const syntax of syntaxFixtures) {
    for (const composed of ['界', 'raw']) {
      await t.test(`${syntax.name} / ${composed === 'raw' ? 'raw Latin' : 'candidate'}`, () => {
        const offset = syntax.source.length;
        const selection = { anchor: offset, focus: offset };
        const { controller, root, session } = createController(syntax.source, {
          initialSelection: selection
        });
        controller.focus();
        controller.restoreSelection(selection);
        controller.captureSelection();

        root.dispatch('compositionstart');
        for (const provisional of ['r', 'ra', composed]) {
          const update = root.dispatch('beforeinput', {
            inputType: 'insertCompositionText',
            data: provisional,
            isComposing: true
          });
          root.dispatch('input', {
            inputType: 'insertCompositionText',
            data: provisional,
            isComposing: true
          });
          assert.equal(update.defaultPrevented, false);
        }

        const firstEnter = root.dispatch('keydown', {
          key: 'Enter', keyCode: 13, isComposing: false
        });
        const newlineTail = root.dispatch('beforeinput', {
          inputType: 'insertParagraph', isComposing: false
        });
        assert.equal(firstEnter.defaultPrevented, false);
        assert.equal(firstEnter.propagationStopped, false);
        assert.equal(newlineTail.defaultPrevented, false);
        assert.equal(newlineTail.propagationStopped, false);
        assert.equal(controller.source(), syntax.source);
        assert.equal(session.calls.transactions.length, 0);

        const commit = root.dispatch('beforeinput', {
          inputType: 'insertFromComposition',
          data: composed,
          isComposing: false
        });
        root.dispatch('compositionend', { data: composed });
        assert.equal(commit.defaultPrevented, true);
        assert.equal(controller.source(), `${syntax.source}${composed}`);
        assert.equal(session.calls.transactions.length, 1,
          'IME settlement publishes one canonical source transaction');

        const ordinaryEnter = root.dispatch('keydown', {
          key: 'Enter', keyCode: 13, isComposing: false
        });
        assert.equal(ordinaryEnter.defaultPrevented, true);
        assert.equal(controller.source(), syntax.afterEnter(composed));
        assert.equal(session.calls.transactions.length, 2,
          'the next ordinary Enter contributes exactly one existing command transaction');
        controller.destroy();
      });
    }
  }
});

test('a concurrent Pane publication waits for native IME settlement before remounting syntax', async () => {
  const { controller, root, session } = createController('**bold**');
  controller.focus();
  controller.restoreSelection({ anchor: 4, focus: 4 });
  controller.captureSelection();
  const renderCount = controller.projection.renderCount;

  root.dispatch('compositionstart');
  root.dispatch('beforeinput', {
    inputType: 'insertCompositionText',
    data: '临',
    isComposing: true
  });
  session.replaceSource('**remote**');

  assert.equal(controller.source(), '**remote**');
  assert.equal(controller.projection.renderCount, renderCount,
    'the remote canonical publication does not replace Chromium provisional DOM');
  assert.equal(session.calls.transactions.length, 0);

  root.dispatch('compositionend', { data: '临' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(controller.source(), '**remote**');
  assert.equal(controller.sourceSnapshot.markdownBody, '**remote**');
  assert.equal(controller.projection.renderCount, renderCount + 1,
    'the deferred canonical snapshot mounts once after composition ownership ends');
  assert.equal(session.calls.transactions.length, 0,
    'stale provisional text cannot publish over the remote Page source');
  controller.destroy();
});

test('two syntax-aware Pane projections share one HN Page source and one Page-wide Undo', async () => {
  const source = '**bold**';
  const savedEnvelopes = [];
  const session = createHnPageDocumentSession({
    pageId: 'page-cne-syntax-shared',
    cneText: {
      schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
      revision: 0,
      source,
      anchors: {}
    },
    save: async ({ cneText }) => {
      savedEnvelopes.push(cneText);
      return { cneText: { ...cneText, revision: 1 } };
    },
    saveDelayMs: 60_000
  });
  const documentA = new FakeDocument();
  const documentB = new FakeDocument();
  const rootA = documentA.createElement('div');
  const rootB = documentB.createElement('div');
  const runtimeA = fakePresentationRuntime();
  const runtimeB = fakePresentationRuntime();
  const strategyA = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: runtimeA
  });
  const strategyB = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: runtimeB
  });
  const sharedSelection = {
    anchor: 4,
    focus: 4,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  };
  const controllerA = sourceEditor.createSourceCanonicalEditor({
    root: rootA,
    document: documentA,
    session,
    viewId: 'pane-a:tab-a:page-cne-syntax-shared',
    paneState: createPaneLocalState({ selection: sharedSelection }),
    foundation,
    projectionRuntime: fakeProjectionRuntime(),
    presentationStrategy: strategyA,
    mode: 'edit'
  });
  const controllerB = sourceEditor.createSourceCanonicalEditor({
    root: rootB,
    document: documentB,
    session,
    viewId: 'pane-b:tab-b:page-cne-syntax-shared',
    paneState: createPaneLocalState({ selection: sharedSelection }),
    foundation,
    projectionRuntime: fakeProjectionRuntime(),
    presentationStrategy: strategyB,
    mode: 'browser'
  });

  controllerB.focus();
  controllerB.restoreSelection(sharedSelection);
  controllerB.captureSelection();
  controllerA.focus();
  controllerA.restoreSelection(sharedSelection);
  controllerA.captureSelection();

  assert.notEqual(strategyA, strategyB);
  assert.notEqual(controllerA.sourceSnapshot, controllerB.sourceSnapshot);
  assert.notEqual(controllerA.presentationPlan, controllerB.presentationPlan);
  assert.equal(controllerA.diagnostics().activeOwnerIds.length, 1,
    'Edit projection independently reveals its active strong construct');
  assert.deepEqual(controllerB.diagnostics().activeOwnerIds, [],
    'Browser projection independently keeps source markers inactive');
  assert.equal(controllerB.capabilities().canEdit, false);
  assert.equal(controllerB.capabilities().canSelect, true);

  const rendersBeforeA = controllerA.projection.renderCount;
  const rendersBeforeB = controllerB.projection.renderCount;
  controllerA.focus();
  controllerA.restoreSelection(sharedSelection);
  const edit = rootA.dispatch('beforeinput', { inputType: 'insertText', data: '!' });

  assert.equal(edit.defaultPrevented, true);
  assert.equal(session.currentSnapshot().source, '**bo!ld**');
  assert.equal(controllerA.source(), '**bo!ld**');
  assert.equal(controllerB.source(), '**bo!ld**');
  assert.equal(controllerA.diagnostics().transactionCount, 1);
  assert.equal(controllerB.diagnostics().transactionCount, 0);
  assert.deepEqual(session.historyDepth, { undo: 1, redo: 0 });
  assert.equal(controllerA.projection.renderCount, rendersBeforeA + 1);
  assert.equal(controllerB.projection.renderCount, rendersBeforeB + 1);
  assert.notEqual(controllerA.presentationPlan, controllerB.presentationPlan);

  await session.flush();
  assert.equal(savedEnvelopes.length, 1);
  assert.equal(savedEnvelopes[0].source, '**bo!ld**',
    'rendered syntax persists only as exact canonical cneText.source bytes');

  const rejected = rootB.dispatch('beforeinput', { inputType: 'insertText', data: 'X' });
  assert.equal(rejected.defaultPrevented, true);
  assert.equal(session.currentSnapshot().source, '**bo!ld**');
  assert.deepEqual(session.historyDepth, { undo: 1, redo: 0 });

  rootA.dispatch('keydown', { key: 'z', metaKey: true });
  assert.equal(session.currentSnapshot().source, source);
  assert.equal(controllerA.source(), source);
  assert.equal(controllerB.source(), source);
  assert.deepEqual(session.historyDepth, { undo: 0, redo: 1 });
  assert.ok(runtimeA.calls.decorate >= 3);
  assert.ok(runtimeB.calls.decorate >= 3);

  controllerA.destroy();
  controllerB.destroy();
  await session.dispose({ flush: false });
});

test('IME composition suppresses marker activation rerenders until native composition settles', async () => {
  const source = '**bold** tail';
  const { controller, document, root, session } = createController(source);
  controller.focus();
  controller.restoreSelection({ anchor: source.length, focus: source.length });
  controller.captureSelection();
  const renderCount = controller.projection.renderCount;

  root.dispatch('compositionstart');
  const inside = foundation.createEditablePosition(controller.sourceSnapshot, 4);
  controller.projection.restoreSelection({ anchor: inside, focus: inside });
  document.dispatch('selectionchange');
  controller.captureSelection();

  assert.equal(controller.projection.renderCount, renderCount,
    'selection changes do not remount presentation during native IME');
  assert.deepEqual(controller.diagnostics().activeOwnerIds, []);
  assert.equal(session.calls.transactions.length, 0);

  root.dispatch('compositionend', { data: '' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.source(), source);
  assert.equal(session.calls.transactions.length, 0);
  assert.equal(controller.diagnostics().compositionActive, false);
  controller.destroy();
});
