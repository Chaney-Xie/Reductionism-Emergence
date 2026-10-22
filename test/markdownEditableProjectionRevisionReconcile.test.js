const test = require('node:test');
const assert = require('node:assert/strict');

const markdownPageModel = require('../public/markdownPage');
const foundation = require('../public/markdownEditableFoundation');
const {
  createEditableProjection,
  samePosition
} = require('../public/js/markdownEditableProjection');
const {
  buildEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');

class TestNode {
  constructor(document, nodeType) {
    this.ownerDocument = document;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.parentElement = null;
    this.childNodes = [];
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  append(...nodes) {
    nodes.forEach((input) => {
      const node = typeof input === 'string' ? this.ownerDocument.createTextNode(input) : input;
      if (node.parentNode) {
        const index = node.parentNode.childNodes.indexOf(node);
        if (index >= 0) node.parentNode.childNodes.splice(index, 1);
      }
      node.parentNode = this;
      node.parentElement = this.nodeType === 1 ? this : this.parentElement;
      this.childNodes.push(node);
    });
  }

  insertBefore(input, before) {
    const node = typeof input === 'string' ? this.ownerDocument.createTextNode(input) : input;
    const beforeIndex = this.childNodes.indexOf(before);
    if (beforeIndex < 0) throw new Error('Reference node is not a child.');
    if (node.parentNode) {
      const previousIndex = node.parentNode.childNodes.indexOf(node);
      if (previousIndex >= 0) node.parentNode.childNodes.splice(previousIndex, 1);
    }
    const insertionIndex = this.childNodes.indexOf(before);
    node.parentNode = this;
    node.parentElement = this.nodeType === 1 ? this : this.parentElement;
    this.childNodes.splice(insertionIndex, 0, node);
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
    this.parentElement = null;
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCalls += 1;
    this.childNodes.forEach((node) => {
      node.parentNode = null;
      node.parentElement = null;
    });
    this.childNodes = [];
    this.append(...nodes);
  }

  contains(node) {
    return node === this || this.childNodes.some((child) => child.contains?.(node));
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

class TestText extends TestNode {
  constructor(document, value) {
    super(document, 3);
    this.nodeValue = String(value);
  }

  get textContent() {
    return this.nodeValue;
  }

  contains(node) {
    return node === this;
  }
}

class TestElement extends TestNode {
  constructor(document, tagName) {
    super(document, 1);
    this.tagName = String(tagName).toUpperCase();
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.replaceChildrenCalls = 0;
    const classes = new Set();
    this.classList = {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      contains(name) {
        return classes.has(name);
      }
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

class TestDocument {
  createElement(tagName) {
    return new TestElement(this, tagName);
  }

  createTextNode(value) {
    return new TestText(this, value);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function createSnapshot(source, previousSnapshot = null) {
  return markdownPageModel.createSourceSnapshot(source, previousSnapshot ? {
    previousSnapshot,
    version: previousSnapshot.version + 1,
    forceVersion: true
  } : {});
}

function livePlan(snapshot) {
  return buildEditablePresentationPlan(snapshot, {
    model: markdownPageModel,
    mode: 'live-preview'
  });
}

function rawPlan(snapshot) {
  return deepFreeze({
    sourceVersion: snapshot.version,
    markdownBody: snapshot.markdownBody,
    mode: 'source',
    lines: snapshot.physicalLineIndex.lines.map((line) => ({
      physicalLineId: line.id,
      index: line.index,
      start: line.start,
      contentEnd: line.contentEnd,
      sourceEnd: line.sourceEnd,
      lineEnding: line.lineEnding,
      text: line.text,
      leaves: [{
        leafId: `${line.id}:${line.start}:${line.contentEnd}:source`,
        physicalLineId: line.id,
        lineIndex: line.index,
        sourceStart: line.start,
        sourceEnd: line.contentEnd,
        text: line.text,
        semanticOwnerId: null,
        kind: line.text ? 'source' : 'empty-row',
        visibility: 'visible',
        interactionPolicy: line.text ? 'editable-text' : 'editable-empty-row',
        semanticRoles: []
      }],
      anchors: [],
      metadata: {}
    }))
  });
}

function segmentedTablePlan(snapshot, segments, anchorCells = new Map()) {
  return deepFreeze({
    sourceVersion: snapshot.version,
    markdownBody: snapshot.markdownBody,
    mode: 'live-preview',
    lines: snapshot.physicalLineIndex.lines.map((line) => {
      const lineSegments = segments.get(line.id) || [{
        start: 0,
        end: line.text.length,
        kind: line.text ? 'source' : 'empty-row'
      }];
      const anchors = (anchorCells.get(line.id) || []).map((cell) => ({
        kind: 'table-empty-cell',
        ownerId: 'table-owner',
        rowIndex: cell.rowIndex,
        columnIndex: cell.columnIndex,
        position: foundation.createEditableLinePosition(
          snapshot,
          line.id,
          cell.logicalColumn,
          {
            semanticOwnerId: 'table-owner',
            visibility: 'activatable',
            interactionPolicy: 'activate-owner'
          }
        )
      }));
      return {
        physicalLineId: line.id,
        index: line.index,
        start: line.start,
        contentEnd: line.contentEnd,
        sourceEnd: line.sourceEnd,
        lineEnding: line.lineEnding,
        text: line.text,
        leaves: lineSegments.map((segment, index) => ({
          leafId: `${line.id}:${line.start + segment.start}:${line.start + segment.end}:${segment.kind}:${index}`,
          physicalLineId: line.id,
          lineIndex: line.index,
          sourceStart: line.start + segment.start,
          sourceEnd: line.start + segment.end,
          text: line.text.slice(segment.start, segment.end),
          semanticOwnerId: segment.kind.startsWith('table-') ? 'table-owner' : null,
          kind: segment.kind,
          visibility: 'visible',
          interactionPolicy: segment.kind === 'table-cell'
            ? 'editable-table-cell'
            : 'activate-table-source',
          semanticRoles: []
        })),
        anchors,
        metadata: {}
      };
    })
  });
}

function createProjection(snapshot, presentationPlan, mode = 'live-preview') {
  const document = new TestDocument();
  const root = document.createElement('div');
  const projection = createEditableProjection({ document, root, foundation, mode });
  projection.render(snapshot, { mode, presentationPlan });
  return { document, root, projection };
}

function replaceAt(source, edit) {
  return `${source.slice(0, edit.start)}${edit.replacement}${source.slice(edit.end)}`;
}

test('exact table-cell revision reuses every row, leaf, and text node while rebuilding exact maps', () => {
  const source = '| Head | Value |\n| --- | --- |\n| alpha | beta |\n\nplain tail';
  const before = createSnapshot(source);
  const beforePlan = livePlan(before);
  const { document, root, projection } = createProjection(before, beforePlan);
  const oldRows = projection.enumeratePhysicalRows().map((row) => row.element);
  const oldLeaves = projection.enumerateProjectedLeaves();
  const oldLeafElements = oldLeaves.map((leaf) => leaf.element);
  const oldTextNodes = oldLeaves.map((leaf) => leaf.textNode);

  const activeLeaf = oldLeaves.find((leaf) => leaf.kind === 'table-cell' && leaf.domText === 'alpha');
  const tableHost = document.createElement('div');
  const activeCell = document.createElement('td');
  const endHost = document.createElement('span');
  endHost.append(document.createTextNode('\u200b'));
  tableHost.append(activeCell);
  oldRows[0].append(tableHost);
  activeCell.append(activeLeaf.element, endHost);
  const activeStart = foundation.createEditablePosition(before, activeLeaf.sourceStart, 'after');
  const activeEnd = foundation.createEditablePosition(before, activeLeaf.sourceEnd, 'after');
  assert.ok(projection.registerActivationAnchor(activeCell, activeStart, {
    anchorId: 'active-table-cell',
    semanticOwnerId: activeLeaf.semanticOwnerId,
    contentEditable: true
  }));
  assert.ok(projection.registerActivationAnchor(endHost, activeEnd, {
    anchorId: 'active-table-cell-end',
    semanticOwnerId: activeLeaf.semanticOwnerId,
    contentEditable: true,
    restoreTarget: true
  }));

  const tailLine = before.physicalLineIndex.lines.at(-1);
  const oldTailPosition = foundation.createEditableLinePosition(before, tailLine.id, 2);
  const activation = document.createElement('span');
  activation.append(document.createTextNode('presentation'));
  oldRows.at(-1).append(activation);
  assert.ok(projection.registerActivationAnchor(activation, oldTailPosition, {
    anchorId: 'tail-presentation',
    restoreTarget: true,
    domOffset: 0
  }));

  root.replaceChildrenCalls = 0;
  oldRows.forEach((row) => { row.replaceChildrenCalls = 0; });
  const insertion = source.indexOf('alpha') + 'alpha'.length;
  const edit = { start: insertion, end: insertion, replacement: 'x' };
  const after = createSnapshot(replaceAt(source, edit), before);
  const affectedLine = before.physicalLineIndex.lineAtOffset(insertion, 'after');
  const result = projection.reconcileExactSourceRevision(after, {
    mode: 'live-preview',
    presentationPlan: livePlan(after),
    edits: [edit],
    affectedPhysicalLineIds: [affectedLine.id]
  });

  assert.deepEqual(result, {
    reconciled: true,
    sourceVersion: after.version,
    rowsReused: oldRows.length,
    leavesReused: oldLeaves.length,
    leavesCreated: 0,
    leavesRemoved: 0,
    activationAnchorsDiscarded: 0,
    topologyReconciledPhysicalLineId: null,
    textMutations: 1,
    affectedPhysicalLineIds: [affectedLine.id]
  });
  assert.equal(root.replaceChildrenCalls, 0);
  assert.ok(oldRows.every((row) => row.replaceChildrenCalls === 0));
  assert.deepEqual(
    projection.enumeratePhysicalRows().map((row) => row.element),
    oldRows
  );
  assert.deepEqual(
    projection.enumerateProjectedLeaves().map((leaf) => leaf.element),
    oldLeafElements
  );
  assert.deepEqual(
    projection.enumerateProjectedLeaves().map((leaf) => leaf.textNode),
    oldTextNodes
  );
  assert.equal(oldTextNodes.some((textNode) => textNode.nodeValue === 'alphax'), true);
  assert.equal(projection.snapshot().markdownBody, after.markdownBody);

  projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = projection.sourceToDom(position);
    assert.ok(dom);
    assert.ok(samePosition(projection.domToSource(dom.node, dom.offset), position));
    assert.equal(position.sourceVersion, after.version);
  });

  const registered = projection.enumerateRegisteredActivationAnchors();
  const remappedCell = registered.find((record) => record.anchorId === 'active-table-cell');
  const remappedEnd = registered.find((record) => record.anchorId === 'active-table-cell-end');
  const remappedAnchor = registered.find((record) => record.anchorId === 'tail-presentation');
  const nextTableOwner = livePlan(after).constructs.tables[0].ownerId;
  assert.equal(remappedCell.element, activeCell);
  assert.equal(remappedCell.position.offset, activeStart.offset);
  assert.equal(remappedCell.position.semanticOwnerId, nextTableOwner);
  assert.equal(remappedEnd.element, endHost);
  assert.equal(remappedEnd.position.offset, activeEnd.offset + 1);
  assert.equal(remappedEnd.position.semanticOwnerId, nextTableOwner);
  assert.equal(projection.sourceToDom(remappedEnd.position).node, endHost.firstChild);
  assert.equal(remappedAnchor.element, activation);
  assert.equal(remappedAnchor.position.sourceVersion, after.version);
  assert.equal(remappedAnchor.position.physicalLineId, tailLine.id);
  assert.equal(remappedAnchor.position.offset, oldTailPosition.offset + 1);
  assert.equal(projection.sourceToDom(remappedAnchor.position).node, activation.firstChild);
  assert.ok(samePosition(
    projection.domToSource(activation.firstChild, 0),
    remappedAnchor.position
  ));
});

test('one table-cell leaf may be inserted then removed through a fully preflighted local topology plan', () => {
  const source = 'ab\ntail';
  const before = createSnapshot(source);
  const editedLineId = before.physicalLineIndex.lines[0].id;
  const tailLineId = before.physicalLineIndex.lines[1].id;
  const beforePlan = segmentedTablePlan(before, new Map([[editedLineId, [
    { start: 0, end: 1, kind: 'table-structural-source' },
    { start: 1, end: 2, kind: 'table-structural-source' }
  ]]]), new Map([[editedLineId, [{
    rowIndex: 0,
    columnIndex: 0,
    logicalColumn: 1
  }]]]));
  const { document, root, projection } = createProjection(before, beforePlan);
  const rows = projection.enumeratePhysicalRows().map((row) => row.element);
  const initialLeaves = projection.enumerateProjectedLeaves();
  const initialLeft = initialLeaves[0];
  const initialRight = initialLeaves[1];
  const tailAnchorElement = document.createElement('span');
  tailAnchorElement.append(document.createTextNode('tail-anchor'));
  rows[1].append(tailAnchorElement);
  const oldTailPosition = foundation.createEditableLinePosition(before, tailLineId, 1);
  projection.registerActivationAnchor(tailAnchorElement, oldTailPosition, {
    anchorId: 'stable-tail'
  });
  const [initialEmptyPlanAnchor] = projection.enumeratePlanActivationAnchors();
  assert.equal(initialEmptyPlanAnchor.kind, 'table-empty-cell');
  assert.equal(initialEmptyPlanAnchor.sourceAnchor.rowIndex, 0);
  assert.equal(initialEmptyPlanAnchor.sourceAnchor.columnIndex, 0);
  assert.equal(initialEmptyPlanAnchor.position.logicalColumn, 1);
  root.replaceChildrenCalls = 0;
  rows.forEach((row) => { row.replaceChildrenCalls = 0; });

  const insertion = { start: 1, end: 1, replacement: 'x' };
  const withCell = createSnapshot(replaceAt(source, insertion), before);
  const withCellPlan = segmentedTablePlan(withCell, new Map([[editedLineId, [
    { start: 0, end: 1, kind: 'table-structural-source' },
    { start: 1, end: 2, kind: 'table-cell' },
    { start: 2, end: 3, kind: 'table-structural-source' }
  ]]]));
  let insertedElement = null;
  const inserted = projection.reconcileExactSourceRevision(withCell, {
    mode: 'live-preview',
    presentationPlan: withCellPlan,
    edits: [insertion],
    affectedPhysicalLineIds: [editedLineId],
    leafTopologyReconciler(context) {
      assert.equal(context.transition, 'empty-to-nonempty');
      assert.equal(context.previousAnchors.length, 1);
      assert.equal(context.nextAnchors.length, 0);
      assert.equal(context.planAnchorDelta.changeKind, 'removed');
      assert.equal(context.planAnchorDelta.previousIndex, 0);
      assert.equal(context.planAnchorDelta.nextIndex, null);
      assert.equal(context.planAnchorDelta.anchor.kind, 'table-empty-cell');
      assert.equal(context.planAnchorDelta.anchor.rowIndex, 0);
      assert.equal(context.planAnchorDelta.anchor.columnIndex, 0);
      insertedElement = document.createElement('span');
      const insertedText = document.createTextNode('x');
      insertedElement.append(insertedText);
      return {
        transition: context.transition,
        bindings: [
          { nextLeafIndex: 0, previousLeafIndex: 0 },
          { nextLeafIndex: 1, element: insertedElement, textNode: insertedText },
          { nextLeafIndex: 2, previousLeafIndex: 1 }
        ],
        removePreviousLeafIndices: [],
        placements: [{
          nextLeafIndex: 1,
          parent: rows[0],
          before: initialRight.element
        }]
      };
    }
  });

  assert.equal(inserted.reconciled, true);
  assert.equal(inserted.topologyReconciledPhysicalLineId, editedLineId);
  assert.equal(inserted.leavesReused, initialLeaves.length);
  assert.equal(inserted.leavesCreated, 1);
  assert.equal(inserted.leavesRemoved, 0);
  assert.equal(inserted.activationAnchorsDiscarded, 0);
  assert.deepEqual(rows[0].childNodes.slice(0, 3), [
    initialLeft.element,
    insertedElement,
    initialRight.element
  ]);
  assert.equal(root.replaceChildrenCalls, 0);
  assert.ok(rows.every((row) => row.replaceChildrenCalls === 0));
  assert.equal(projection.enumerateProjectedLeaves()[0].element, initialLeft.element);
  assert.equal(projection.enumerateProjectedLeaves()[1].element, insertedElement);
  assert.equal(projection.enumerateProjectedLeaves()[2].element, initialRight.element);
  assert.equal(projection.enumeratePlanActivationAnchors().length, 0);
  let tailRecord = projection.enumerateRegisteredActivationAnchors()
    .find((record) => record.anchorId === 'stable-tail');
  assert.equal(tailRecord.position.offset, oldTailPosition.offset + 1);

  const disposableCaret = document.createElement('span');
  disposableCaret.append(document.createTextNode('\u200b'));
  rows[0].append(disposableCaret);
  const insertedEnd = foundation.createEditableLinePosition(withCell, editedLineId, 2);
  projection.registerActivationAnchor(disposableCaret, insertedEnd, {
    anchorId: 'discarded-cell-caret',
    restoreTarget: true
  });
  const deletion = { start: 1, end: 2, replacement: '' };
  const withoutCell = createSnapshot(replaceAt(withCell.markdownBody, deletion), withCell);
  const withoutCellPlan = segmentedTablePlan(withoutCell, new Map([[editedLineId, [
    { start: 0, end: 1, kind: 'table-structural-source' },
    { start: 1, end: 2, kind: 'table-structural-source' }
  ]]]), new Map([[editedLineId, [{
    rowIndex: 0,
    columnIndex: 0,
    logicalColumn: 1
  }]]]));
  const removed = projection.reconcileExactSourceRevision(withoutCell, {
    mode: 'live-preview',
    presentationPlan: withoutCellPlan,
    edits: [deletion],
    affectedPhysicalLineIds: [editedLineId],
    leafTopologyReconciler(context) {
      assert.equal(context.transition, 'nonempty-to-empty');
      assert.equal(context.previousAnchors.length, 0);
      assert.equal(context.nextAnchors.length, 1);
      assert.equal(context.planAnchorDelta.changeKind, 'inserted');
      assert.equal(context.planAnchorDelta.previousIndex, null);
      assert.equal(context.planAnchorDelta.nextIndex, 0);
      assert.equal(context.planAnchorDelta.anchor.kind, 'table-empty-cell');
      assert.equal(context.planAnchorDelta.anchor.rowIndex, 0);
      assert.equal(context.planAnchorDelta.anchor.columnIndex, 0);
      return {
        transition: context.transition,
        bindings: [
          { nextLeafIndex: 0, previousLeafIndex: 0 },
          { nextLeafIndex: 1, previousLeafIndex: 2 }
        ],
        removePreviousLeafIndices: [1],
        removeElements: [disposableCaret],
        discardedActivationAnchorElements: [disposableCaret],
        placements: []
      };
    }
  });

  assert.equal(removed.reconciled, true);
  assert.equal(removed.topologyReconciledPhysicalLineId, editedLineId);
  assert.equal(removed.leavesReused, initialLeaves.length);
  assert.equal(removed.leavesCreated, 0);
  assert.equal(removed.leavesRemoved, 1);
  assert.equal(removed.activationAnchorsDiscarded, 1);
  assert.equal(insertedElement.parentNode, null);
  assert.equal(disposableCaret.parentNode, null);
  assert.equal(disposableCaret.dataset.markdownActivationAnchor, undefined);
  assert.deepEqual(rows[0].childNodes.slice(0, 2), [initialLeft.element, initialRight.element]);
  assert.equal(projection.enumerateRegisteredActivationAnchors().some((record) => (
    record.anchorId === 'discarded-cell-caret'
  )), false);
  tailRecord = projection.enumerateRegisteredActivationAnchors()
    .find((record) => record.anchorId === 'stable-tail');
  assert.equal(tailRecord.position.sourceVersion, withoutCell.version);
  assert.equal(tailRecord.position.offset, oldTailPosition.offset);
  const [restoredEmptyPlanAnchor] = projection.enumeratePlanActivationAnchors();
  assert.equal(restoredEmptyPlanAnchor.kind, 'table-empty-cell');
  assert.equal(restoredEmptyPlanAnchor.sourceAnchor.rowIndex, 0);
  assert.equal(restoredEmptyPlanAnchor.sourceAnchor.columnIndex, 0);
  assert.equal(restoredEmptyPlanAnchor.position.sourceVersion, withoutCell.version);
  assert.equal(restoredEmptyPlanAnchor.position.logicalColumn, 1);
  projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = projection.sourceToDom(position);
    assert.ok(dom);
    assert.ok(samePosition(projection.domToSource(dom.node, dom.offset), position));
  });
  assert.equal(root.replaceChildrenCalls, 0);
  assert.ok(rows.every((row) => row.replaceChildrenCalls === 0));
});

test('topology mismatch fails closed before text, datasets, rows, or revision state change', () => {
  const source = 'abc\ntail';
  const before = createSnapshot(source);
  const beforePlan = rawPlan(before);
  const { root, projection } = createProjection(before, beforePlan, 'source');
  const oldRows = projection.enumeratePhysicalRows().map((row) => row.element);
  const oldLeaves = projection.enumerateProjectedLeaves();
  const oldDataset = { ...oldLeaves[0].element.dataset };
  root.replaceChildrenCalls = 0;
  oldRows.forEach((row) => { row.replaceChildrenCalls = 0; });

  const edit = { start: 2, end: 2, replacement: 'x' };
  const after = createSnapshot(replaceAt(source, edit), before);
  const incompatible = JSON.parse(JSON.stringify(rawPlan(after)));
  const firstLine = incompatible.lines[0];
  firstLine.leaves = [
    {
      ...firstLine.leaves[0],
      leafId: `${firstLine.physicalLineId}:0:2:left`,
      sourceStart: 0,
      sourceEnd: 2,
      text: after.markdownBody.slice(0, 2),
      kind: 'left'
    },
    {
      ...firstLine.leaves[0],
      leafId: `${firstLine.physicalLineId}:2:4:right`,
      sourceStart: 2,
      sourceEnd: 4,
      text: after.markdownBody.slice(2, 4),
      kind: 'right'
    }
  ];

  assert.equal(projection.reconcileExactSourceRevision(after, {
    mode: 'source',
    presentationPlan: deepFreeze(incompatible),
    edits: [edit],
    affectedPhysicalLineIds: [before.physicalLineIndex.lines[0].id]
  }), false);
  assert.equal(projection.snapshot().sourceVersion, before.version);
  assert.equal(projection.snapshot().markdownBody, before.markdownBody);
  assert.equal(oldLeaves[0].textNode.nodeValue, 'abc');
  assert.deepEqual(oldLeaves[0].element.dataset, oldDataset);
  assert.deepEqual(projection.enumeratePhysicalRows().map((row) => row.element), oldRows);
  assert.equal(root.replaceChildrenCalls, 0);
  assert.ok(oldRows.every((row) => row.replaceChildrenCalls === 0));
});

test('structural, stale-revision, wrong-edit, and undeclared-row changes all fail closed', () => {
  const source = 'abc\ntail';
  const before = createSnapshot(source);
  const { root, projection } = createProjection(before, rawPlan(before), 'source');
  const originalText = root.textContent;

  const newlineEdit = { start: 1, end: 1, replacement: '\n' };
  const structural = createSnapshot(replaceAt(source, newlineEdit), before);
  assert.equal(projection.reconcileExactSourceRevision(structural, {
    mode: 'source',
    presentationPlan: rawPlan(structural),
    edits: [newlineEdit],
    affectedPhysicalLineIds: [before.physicalLineIndex.lines[0].id]
  }), false);

  const edit = { start: 1, end: 1, replacement: 'x' };
  const after = createSnapshot(replaceAt(source, edit), before);
  assert.equal(projection.reconcileExactSourceRevision(after, {
    mode: 'source',
    presentationPlan: rawPlan(after),
    edits: [{ ...edit, replacement: 'wrong' }],
    affectedPhysicalLineIds: [before.physicalLineIndex.lines[0].id]
  }), false);
  assert.equal(projection.reconcileExactSourceRevision(after, {
    mode: 'source',
    presentationPlan: rawPlan(after),
    edits: [edit],
    affectedPhysicalLineIds: [before.physicalLineIndex.lines[1].id]
  }), false);

  const stale = deepFreeze({
    ...after,
    version: before.version
  });
  assert.equal(projection.reconcileExactSourceRevision(stale, {
    mode: 'source',
    presentationPlan: deepFreeze({ ...rawPlan(after), sourceVersion: before.version }),
    edits: [edit],
    affectedPhysicalLineIds: [before.physicalLineIndex.lines[0].id]
  }), false);
  assert.equal(projection.snapshot().sourceVersion, before.version);
  assert.equal(root.textContent, originalText);
});
