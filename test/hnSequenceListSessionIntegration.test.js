'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const hnTextModel = require('../public/hnText');
const foundation = require('../public/markdownEditableFoundation');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const {
  createHnPageDocumentSession,
  createPaneLocalState
} = require('../public/js/hnPageDocumentSession');
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

function collapsed(offset, affinity = 'after') {
  return Object.freeze({
    anchor: offset,
    focus: offset,
    anchorAffinity: affinity,
    focusAffinity: affinity
  });
}

function envelope(source, revision = 0) {
  return {
    schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
    revision,
    source,
    anchors: {}
  };
}

function createFixture(source) {
  const saves = [];
  const changes = [];
  let revision = 0;
  const session = createHnPageDocumentSession({
    pageId: 'page-hn-sequence-list-integration',
    cneText: envelope(source),
    saveDelayMs: 60_000,
    async save(payload) {
      saves.push(structuredClone(payload));
      revision += 1;
      return { cneText: { ...payload.cneText, revision } };
    },
    onDocumentChange(change) {
      changes.push(structuredClone(change));
    }
  });
  const views = [];

  function mount(viewId, mode, initialSelection) {
    const strategy = sourceEditor.createHnBasicPresentationStrategy({
      presentationRuntime: presentationRuntime()
    });
    const initialSnapshot = strategy.createSourceSnapshot(session.source, {
      version: session.sourceVersion
    });
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
    const errors = [];
    const updates = [];
    const paneState = createPaneLocalState({ selection: initialSelection });
    const controller = sourceEditor.createSourceCanonicalEditor({
      root,
      document,
      session,
      viewId,
      paneState,
      foundation,
      projectionRuntime: {
        createEditableProjection() { return projection; },
        samePosition
      },
      presentationStrategy: strategy,
      mode,
      onSnapshot(snapshot, metadata) {
        updates.push({ snapshot, metadata });
      },
      onError(error) {
        errors.push(error);
      }
    });
    const view = { controller, document, errors, mode, paneState, projection, root, updates };
    views.push(view);
    return view;
  }

  async function dispose() {
    views.forEach((view) => view.controller.destroy());
    await session.dispose({ flush: false });
  }

  return { changes, dispose, mount, saves, session, views };
}

function selectionOffsets(projection) {
  const current = projection.getSelection();
  return current ? {
    anchor: current.anchor.offset,
    focus: current.focus.offset
  } : null;
}

function numericSelection(value) {
  return value ? { anchor: value.anchor, focus: value.focus } : null;
}

function sequenceRows(controller) {
  return controller.presentationPlan.constructs.listRows
    .filter((row) => row.hnSequenceList === true)
    .map((row) => ({
      sequenceId: row.hnSequenceId,
      itemId: row.hnItemId,
      continuation: row.continuation,
      markerStart: row.markerStart,
      markerEnd: row.markerEnd,
      contentStart: row.contentStart,
      contentEnd: row.contentEnd,
      markerSource: row.markerSource,
      contentSource: row.contentSource
    }));
}

function sequenceIndexSemantics(controller) {
  return controller.sourceSnapshot.hnListIndex.sequences.map((sequence) => ({
    depth: sequence.depth,
    scheme: sequence.scheme,
    startOrdinal: sequence.startOrdinal,
    authoredOrdinals: [...sequence.authoredOrdinals],
    sequential: sequence.sequential,
    sourceRange: sequence.sourceRange,
    markerColumnWidth: sequence.markerColumnWidth,
    items: sequence.items.map((item) => ({
      depth: item.depth,
      tabs: item.tabs,
      scheme: item.scheme,
      ordinal: item.ordinal,
      path: item.path,
      marker: item.marker,
      prefixRange: item.prefixRange,
      paragraphRanges: item.paragraphRanges,
      itemRange: item.itemRange,
      subtreeRange: item.subtreeRange,
      empty: item.empty
    }))
  }));
}

function focusAt(view, selection) {
  assert.equal(view.controller.focus(), true);
  assert.equal(view.controller.restoreSelection(selection), true);
  assert.deepEqual(numericSelection(view.controller.captureSelection()), {
    anchor: selection.anchor,
    focus: selection.focus
  });
}

test('one sequence-list command is one Page transaction shared by Edit and Browser projections', async (t) => {
  const source = '1. Alpha\n2. Beta';
  const alphaEnd = source.indexOf('Alpha') + 'Alpha'.length;
  const betaEnd = source.length;
  const fixture = createFixture(source);
  t.after(() => fixture.dispose());
  const editA = fixture.mount('pane-a:tab-a:page-list', 'edit', collapsed(alphaEnd));
  const editB = fixture.mount('pane-b:tab-b:page-list', 'edit', collapsed(betaEnd));
  const browser = fixture.mount('pane-c:tab-c:page-list', 'browser', collapsed(3));

  focusAt(editA, collapsed(alphaEnd));
  const updateBaselines = fixture.views.map((view) => view.updates.length);
  const enter = editA.root.dispatch('keydown', { key: 'Enter' });
  const expected = '1. Alpha\n2. \n3. Beta';

  assert.equal(enter.defaultPrevented, true);
  assert.equal(fixture.session.source, expected);
  assert.deepEqual(fixture.session.historyDepth, { undo: 1, redo: 0 });
  assert.equal(fixture.session.documentGeneration, 1);
  assert.equal(editA.controller.diagnostics().transactionCount, 1);
  assert.equal(fixture.changes.length, 1);
  assert.equal(fixture.changes[0].source, expected);
  assert.equal(fixture.changes[0].cneText.source, expected);
  fixture.views.forEach((view, index) => {
    assert.equal(view.controller.source(), expected);
    assert.equal(view.updates.length, updateBaselines[index] + 1,
      `${view.mode} projection receives exactly one canonical publication`);
    assert.equal(view.updates.at(-1).metadata.reason, 'source');
  });

  assert.deepEqual(numericSelection(fixture.session.selectionForView(editA.controller.viewId)), {
    anchor: 12,
    focus: 12
  });
  assert.deepEqual(numericSelection(fixture.session.selectionForView(editB.controller.viewId)), {
    anchor: betaEnd + 4,
    focus: betaEnd + 4
  });
  assert.deepEqual(numericSelection(fixture.session.selectionForView(browser.controller.viewId)), {
    anchor: 3,
    focus: 3
  });
  assert.notDeepEqual(
    fixture.session.selectionForView(editA.controller.viewId),
    fixture.session.selectionForView(editB.controller.viewId),
    'Pane-local selections remain independent'
  );

  assert.ok(Object.isFrozen(editA.controller.sourceSnapshot.hnListIndex));
  assert.ok(Object.isFrozen(browser.controller.sourceSnapshot.hnListIndex));
  assert.deepEqual(sequenceIndexSemantics(browser.controller), sequenceIndexSemantics(editA.controller),
    'Browser consumes the same immutable list semantics as Edit');
  assert.deepEqual(sequenceRows(browser.controller), sequenceRows(editA.controller),
    'Browser and Edit consume one source-derived list presentation');
  assert.equal(browser.controller.capabilities().canEdit, false);
  const browserHistory = fixture.session.historyDepth;
  const rejected = browser.root.dispatch('beforeinput', {
    inputType: 'insertText',
    data: 'X'
  });
  assert.equal(rejected.defaultPrevented, true);
  assert.equal(fixture.session.source, expected);
  assert.deepEqual(fixture.session.historyDepth, browserHistory);

  editA.root.dispatch('keydown', { key: 'z', metaKey: true });
  assert.equal(fixture.session.source, source);
  assert.equal(editA.controller.source(), source);
  assert.equal(editB.controller.source(), source);
  assert.equal(browser.controller.source(), source);
  assert.deepEqual(fixture.session.historyDepth, { undo: 0, redo: 1 });
  assert.deepEqual(numericSelection(fixture.session.selectionForView(editA.controller.viewId)), {
    anchor: alphaEnd,
    focus: alphaEnd
  });
  assert.deepEqual(numericSelection(fixture.session.selectionForView(editB.controller.viewId)), {
    anchor: betaEnd,
    focus: betaEnd
  });

  editA.root.dispatch('keydown', { key: 'z', metaKey: true, shiftKey: true });
  assert.equal(fixture.session.source, expected);
  assert.equal(editB.controller.source(), expected);
  assert.equal(browser.controller.source(), expected);
  assert.deepEqual(fixture.session.historyDepth, { undo: 1, redo: 0 });
  assert.deepEqual(numericSelection(fixture.session.selectionForView(editB.controller.viewId)), {
    anchor: betaEnd + 4,
    focus: betaEnd + 4
  });

  await fixture.session.flush();
  assert.equal(fixture.saves.length, 1, 'dirty generations coalesce into one revisioned save');
  assert.equal(fixture.saves[0].cneText.source, expected);
  assert.equal(fixture.saves[0].baseRevision, 0);
  assert.equal(editA.errors.length + editB.errors.length + browser.errors.length, 0);
});

test('text, IME, and cross-paragraph copy keep exact canonical bytes and caret ownership', async (t) => {
  const source = '1. Alpha\n   continuation\n2. Tail';
  const fixture = createFixture(source);
  t.after(() => fixture.dispose());
  const editA = fixture.mount(
    'pane-a:tab-a:page-list-input',
    'edit',
    collapsed(source.indexOf('Alpha') + 'Alpha'.length)
  );
  const editB = fixture.mount('pane-b:tab-b:page-list-input', 'edit', collapsed(source.length));
  focusAt(editA, collapsed(source.indexOf('Alpha') + 'Alpha'.length));

  function insertText(text, expectedCaret) {
    const changesBefore = fixture.changes.length;
    const generationBefore = fixture.session.documentGeneration;
    const event = editA.root.dispatch('beforeinput', {
      inputType: 'insertText',
      data: text
    });
    assert.equal(event.defaultPrevented, true);
    assert.equal(fixture.changes.length, changesBefore + 1);
    assert.equal(fixture.session.documentGeneration, generationBefore + 1);
    assert.equal(fixture.changes.at(-1).source, fixture.session.source);
    assert.deepEqual(selectionOffsets(editA.projection), {
      anchor: expectedCaret,
      focus: expectedCaret
    });
  }

  function composeAt(offset, text) {
    focusAt(editA, collapsed(offset));
    const changesBefore = fixture.changes.length;
    const historyBefore = fixture.session.historyDepth.undo;
    editA.root.dispatch('compositionstart');
    const provisional = editA.root.dispatch('beforeinput', {
      inputType: 'insertCompositionText',
      data: 'x',
      isComposing: true
    });
    editA.root.dispatch('input', {
      inputType: 'insertCompositionText',
      data: 'x',
      isComposing: true
    });
    assert.equal(provisional.defaultPrevented, false);
    assert.equal(fixture.changes.length, changesBefore,
      'provisional IME text is not canonical publication');
    const finalInput = editA.root.dispatch('beforeinput', {
      inputType: 'insertFromComposition',
      data: text,
      isComposing: false
    });
    editA.root.dispatch('compositionend', { data: text });
    assert.equal(finalInput.defaultPrevented, true);
    assert.equal(fixture.changes.length, changesBefore + 1);
    assert.equal(fixture.session.historyDepth.undo, historyBefore + 1);
    assert.equal(fixture.changes.at(-1).source, fixture.session.source);
    assert.deepEqual(selectionOffsets(editA.projection), {
      anchor: offset + text.length,
      focus: offset + text.length
    });
  }

  let offset = fixture.session.source.indexOf('Alpha') + 'Alpha'.length;
  focusAt(editA, collapsed(offset));
  insertText('!', offset + 1);
  insertText('?', offset + 2);
  assert.equal(fixture.session.source, '1. Alpha!?\n   continuation\n2. Tail');
  assert.equal(editB.controller.source(), fixture.session.source);

  offset = fixture.session.source.indexOf('continuation') + 'continuation'.length;
  focusAt(editA, collapsed(offset));
  insertText('+', offset + 1);
  insertText('=', offset + 2);
  assert.equal(fixture.session.source, '1. Alpha!?\n   continuation+=\n2. Tail');
  assert.equal(editB.controller.source(), fixture.session.source);

  offset = fixture.session.source.indexOf('Alpha') + 2;
  composeAt(offset, '界');
  assert.equal(fixture.session.source, '1. Al界pha!?\n   continuation+=\n2. Tail');
  assert.equal(editB.controller.source(), fixture.session.source);

  offset = fixture.session.source.indexOf('continuation') + 3;
  composeAt(offset, '文');
  assert.equal(fixture.session.source, '1. Al界pha!?\n   con文tinuation+=\n2. Tail');
  assert.equal(editB.controller.source(), fixture.session.source);

  const copyFrom = fixture.session.source.indexOf('Al');
  const copyTo = fixture.session.source.indexOf('\n2. Tail');
  focusAt(editA, {
    anchor: copyFrom,
    focus: copyTo,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  });
  const clipboard = {};
  const historyBeforeCopy = fixture.session.historyDepth;
  const copy = editA.root.dispatch('copy', {
    clipboardData: {
      setData(type, value) { clipboard[type] = value; }
    }
  });
  assert.equal(copy.defaultPrevented, true);
  assert.equal(clipboard['text/plain'], fixture.session.source.slice(copyFrom, copyTo));
  assert.equal(clipboard['text/plain'], 'Al界pha!?\n   con文tinuation+=');
  assert.deepEqual(fixture.session.historyDepth, historyBeforeCopy);

  assert.equal(fixture.changes.length, 6,
    'four sequential native inputs and two compositions each publish once');
  assert.equal(fixture.changes.at(-1).cneText.source, fixture.session.source);
  await fixture.session.flush();
  assert.equal(fixture.saves.length, 1);
  assert.equal(fixture.saves[0].cneText.source, fixture.session.source);
  assert.equal(fixture.saves[0].cneText.source, '1. Al界pha!?\n   con文tinuation+=\n2. Tail');
  assert.equal(editA.errors.length + editB.errors.length, 0);
});
