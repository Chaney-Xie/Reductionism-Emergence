'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const hnTextModel = require('../public/hnText');
const foundation = require('../public/markdownEditableFoundation');
const {
  createHnPageDocumentSession,
  createPaneLocalState
} = require('../public/js/hnPageDocumentSession');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const {
  samePosition
} = require('../public/js/markdownEditableProjection');
const {
  createCertificationProjection
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

function exactSelection(anchor, focus = anchor) {
  const affinity = anchor === focus ? 'before' : 'after';
  return Object.freeze({
    anchor,
    focus,
    anchorAffinity: affinity,
    focusAffinity: affinity
  });
}

function numericProjectionSelection(projection) {
  const value = projection.getSelection();
  if (!value) return null;
  return {
    anchor: value.anchor.offset,
    focus: value.focus.offset,
    anchorAffinity: value.anchor.affinity,
    focusAffinity: value.focus.affinity
  };
}

function sequenceTopology(snapshot) {
  return snapshot.hnListIndex.sequences.map((sequence) => ({
    depth: sequence.depth,
    scheme: sequence.scheme,
    itemLines: sequence.items.map((item) => item.lineIndex),
    childCounts: sequence.items.map((item) => item.childSequenceIds.length)
  }));
}

function canonicalProjectionState(controller, root, projection) {
  const rows = projection.enumeratePhysicalRows();
  const leaves = projection.enumerateProjectedLeaves();
  assert.equal(root.dataset.sourceVersion, String(controller.sourceVersion()));
  assert.equal(root.dataset.hnSourceVersion, String(controller.sourceVersion()));
  assert.equal(projection.snapshot().markdownBody, controller.source());
  assert.equal(projection.snapshot().sourceVersion, controller.sourceVersion());
  rows.forEach((row) => {
    assert.equal(row.element.dataset.physicalLineId, String(row.physicalLineId));
    assert.equal(row.element.dataset.sourceStart, String(row.start));
    assert.equal(row.element.dataset.sourceContentEnd, String(row.contentEnd));
    assert.equal(row.element.dataset.sourceEnd, String(row.sourceEnd));
  });
  leaves.forEach((leaf) => {
    assert.equal(leaf.element.dataset.leafId, String(leaf.leafId));
    assert.equal(leaf.element.dataset.physicalLineId, String(leaf.physicalLineId));
    assert.equal(leaf.element.dataset.sourceStart, String(leaf.sourceStart));
    assert.equal(leaf.element.dataset.sourceEnd, String(leaf.sourceEnd));
    assert.equal(leaf.element.dataset.presentationRole, String(leaf.kind));
    assert.equal(leaf.textNode.nodeValue, leaf.text || '\u200b');
  });
  return { rows, leaves };
}

function createFixture(t, source, selection) {
  const calls = {
    clearMountState: 0,
    decorate: 0,
    listMounts: 0,
    mathMounts: 0,
    renders: 0,
    reconciles: [],
    documentChanges: []
  };
  const presentationRuntime = Object.freeze({
    clearEditablePresentationMountState() { calls.clearMountState += 1; },
    decorateEditableProjectedLeaves() { calls.decorate += 1; },
    mountEditableListPresentations() { calls.listMounts += 1; },
    mountEditableMathPresentations() { calls.mathMounts += 1; }
  });
  const strategy = sourceEditor.createHnBasicPresentationStrategy({ presentationRuntime });
  const initialSnapshot = strategy.createSourceSnapshot(source, { version: 0 });
  const initialPlan = strategy.createPresentationPlan(initialSnapshot, {
    mode: 'edit',
    activeOwnerIds: []
  });
  const { document, root, projection } = createCertificationProjection(
    initialSnapshot,
    strategy.projectionMode,
    { presentationPlan: initialPlan }
  );
  installInteractiveDom(document, root);

  const originalRender = projection.render.bind(projection);
  projection.render = (...args) => {
    calls.renders += 1;
    return originalRender(...args);
  };
  const originalReconcile = projection.reconcileExactSourceRevision.bind(projection);
  projection.reconcileExactSourceRevision = (...args) => {
    const result = originalReconcile(...args);
    calls.reconciles.push(result);
    return result;
  };

  const session = createHnPageDocumentSession({
    pageId: `page-hn-list-reconcile-${source.length}`,
    cneText: {
      schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
      revision: 0,
      source,
      anchors: {}
    },
    save: async ({ cneText }) => ({ cneText: { ...cneText, revision: cneText.revision + 1 } }),
    saveDelayMs: 60_000,
    onDocumentChange(change) { calls.documentChanges.push(change); }
  });
  const viewId = `pane-a:tab-a:${session.pageId}`;
  const paneState = createPaneLocalState({ selection });
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
    mode: 'edit'
  });
  assert.equal(controller.focus(), true);
  assert.equal(controller.restoreSelection(selection), true);
  assert.deepEqual(controller.captureSelection(), selection);

  calls.clearMountState = 0;
  calls.decorate = 0;
  calls.listMounts = 0;
  calls.mathMounts = 0;
  calls.renders = 0;
  calls.reconciles.length = 0;
  calls.documentChanges.length = 0;

  t.after(async () => {
    controller.destroy();
    await session.dispose({ flush: false });
  });
  return { calls, controller, document, projection, root, session, viewId };
}

test('same-line marker growth reconciles the exact revision without remounting rows or leaves', async (t) => {
  const source = 'intro\n9. alpha\n10. beta\ntail';
  const alphaStart = source.indexOf('alpha');
  const beforeSelection = exactSelection(alphaStart + 1, alphaStart + 4);
  const fixture = createFixture(t, source, beforeSelection);
  const beforeSnapshot = fixture.controller.sourceSnapshot;
  const beforeTopology = sequenceTopology(beforeSnapshot);
  const beforeState = canonicalProjectionState(
    fixture.controller,
    fixture.root,
    fixture.projection
  );
  const oldRows = beforeState.rows.map((row) => row.element);
  const oldLeafElements = beforeState.leaves.map((leaf) => leaf.element);
  const oldTextNodes = beforeState.leaves.map((leaf) => leaf.textNode);
  const affectedLine = beforeSnapshot.physicalLineIndex.lines[1];
  const affectedRow = beforeState.rows[1].element;
  const affectedLeaves = beforeState.leaves.filter((leaf) => (
    leaf.physicalLineId === affectedLine.id
  ));
  const markerStart = source.indexOf('9.');
  const afterSelection = exactSelection(alphaStart + 2, alphaStart + 5);

  const result = fixture.session.applySourceTransaction(
    fixture.viewId,
    { from: markerStart, to: markerStart + 1, insert: '10' },
    {
      sourceVersion: 0,
      selection: afterSelection,
      inputType: 'insertText'
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.source, 'intro\n10. alpha\n10. beta\ntail');
  assert.deepEqual(fixture.session.historyDepth, { undo: 1, redo: 0 },
    'one canonical Page-session transaction owns the change');
  assert.equal(fixture.calls.documentChanges.length, 1);
  assert.equal(fixture.calls.renders, 0, 'exact reconciliation avoids the full render path');
  assert.equal(fixture.calls.reconciles.length, 1);
  assert.deepEqual(fixture.calls.reconciles[0], {
    reconciled: true,
    sourceVersion: 1,
    rowsReused: oldRows.length,
    leavesReused: oldLeafElements.length,
    leavesCreated: 0,
    leavesRemoved: 0,
    activationAnchorsDiscarded: 0,
    topologyReconciledPhysicalLineId: null,
    textMutations: 1,
    affectedPhysicalLineIds: [affectedLine.id]
  });
  assert.equal(fixture.calls.listMounts, 1, 'list presentation slots remount exactly once');
  assert.equal(fixture.calls.decorate, 1);
  assert.equal(fixture.calls.mathMounts, 1);

  const afterState = canonicalProjectionState(
    fixture.controller,
    fixture.root,
    fixture.projection
  );
  assert.deepEqual(afterState.rows.map((row) => row.element), oldRows,
    'unaffected and affected physical rows retain identity');
  assert.deepEqual(afterState.leaves.map((leaf) => leaf.element), oldLeafElements,
    'unaffected and affected projected leaves retain identity');
  assert.deepEqual(afterState.leaves.map((leaf) => leaf.textNode), oldTextNodes,
    'unaffected and affected leaf text nodes retain identity');
  assert.equal(afterState.rows[1].element, affectedRow);
  assert.deepEqual(
    afterState.leaves.filter((leaf) => leaf.physicalLineId === affectedLine.id)
      .map((leaf) => leaf.element),
    affectedLeaves.map((leaf) => leaf.element)
  );
  assert.deepEqual(sequenceTopology(fixture.controller.sourceSnapshot), beforeTopology,
    'the source-derived list topology is unchanged');

  const markerLeaf = afterState.leaves.find((leaf) => (
    leaf.physicalLineId === affectedLine.id && leaf.kind === 'hn-sequence-list-item-marker'
  ));
  const contentLeaf = afterState.leaves.find((leaf) => (
    leaf.physicalLineId === affectedLine.id && leaf.kind === 'hn-sequence-list-item-content'
  ));
  assert.equal(markerLeaf.textNode.nodeValue, '10. ');
  assert.equal(markerLeaf.sourceStart, markerStart);
  assert.equal(markerLeaf.sourceEnd, markerStart + 4);
  assert.equal(contentLeaf.textNode.nodeValue, 'alpha');
  assert.equal(contentLeaf.sourceStart, markerStart + 4);
  assert.equal(contentLeaf.sourceEnd, markerStart + 9);
  assert.equal(markerLeaf.element.dataset.semanticOwnerId, markerLeaf.planLeaf.semanticOwnerId,
    'revision-scoped owner metadata is refreshed on the retained node');

  assert.deepEqual(fixture.session.selectionForView(fixture.viewId), afterSelection);
  assert.deepEqual(fixture.controller.diagnostics().selection, afterSelection);
  assert.deepEqual(numericProjectionSelection(fixture.projection), afterSelection,
    'the exact native/projection selection survives the in-place revision');
});

test('marker completion changes topology, fails exact reconciliation closed, and fully renders a list row', async (t) => {
  const source = 'before\n1.\nafter';
  const markerStart = source.indexOf('1.');
  const beforeSelection = exactSelection(markerStart + 2);
  const fixture = createFixture(t, source, beforeSelection);
  const beforeState = canonicalProjectionState(
    fixture.controller,
    fixture.root,
    fixture.projection
  );
  const oldRows = beforeState.rows.map((row) => row.element);
  const oldLeafElements = beforeState.leaves.map((leaf) => leaf.element);
  const afterSelection = exactSelection(markerStart + 3);

  fixture.session.applySourceTransaction(
    fixture.viewId,
    { from: markerStart + 2, to: markerStart + 2, insert: ' ' },
    {
      sourceVersion: 0,
      selection: afterSelection,
      inputType: 'insertText'
    }
  );

  assert.equal(fixture.controller.source(), 'before\n1. \nafter');
  assert.equal(fixture.calls.reconciles.length, 1);
  assert.equal(fixture.calls.reconciles[0], false,
    'literal-to-sequence leaf topology is rejected by exact reconciliation');
  assert.equal(fixture.calls.renders, 1, 'the controller performs one safe full render fallback');
  assert.equal(fixture.calls.listMounts, 1, 'the recognized list presentation remounts once');
  assert.equal(fixture.calls.decorate, 1);
  assert.equal(fixture.calls.mathMounts, 1);
  assert.equal(fixture.calls.documentChanges.length, 1);

  const afterState = canonicalProjectionState(
    fixture.controller,
    fixture.root,
    fixture.projection
  );
  assert.deepEqual(afterState.rows.map((row) => row.element), oldRows,
    'the full render may safely reuse physical row shells');
  assert.ok(afterState.leaves.every((leaf) => !oldLeafElements.includes(leaf.element)),
    'the full render replaces projected leaves instead of forcing incompatible topology reuse');
  const listLine = fixture.controller.presentationPlan.lines[1];
  assert.equal(listLine.metadata.listRow.kind, 'hn-sequence-list-item');
  assert.deepEqual(listLine.leaves.map((leaf) => ({ kind: leaf.kind, text: leaf.text })), [
    { kind: 'hn-sequence-list-item-marker', text: '1. ' }
  ]);
  assert.equal(fixture.controller.sourceSnapshot.hnListIndex.sequences.length, 1);
  assert.equal(fixture.controller.sourceSnapshot.hnListIndex.items.length, 1);
  assert.deepEqual(fixture.session.selectionForView(fixture.viewId), afterSelection);
  assert.deepEqual(fixture.controller.diagnostics().selection, afterSelection);
  assert.deepEqual(numericProjectionSelection(fixture.projection), afterSelection,
    'selection is restored exactly after the full-render fallback');
});
