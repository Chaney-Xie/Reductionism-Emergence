const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEditableProjection,
  positionKey,
  samePosition
} = require('../public/js/markdownEditableProjection');
const markdownPageModel = require('../public/markdownPage');
const {
  buildEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeNode {
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
    nodes.forEach((node) => {
      const child = typeof node === 'string'
        ? this.ownerDocument.createTextNode(node)
        : node;
      if (child.parentNode) {
        const previousIndex = child.parentNode.childNodes.indexOf(child);
        if (previousIndex >= 0) child.parentNode.childNodes.splice(previousIndex, 1);
      }
      child.parentNode = this;
      child.parentElement = this.nodeType === 1 ? this : this.parentElement;
      this.childNodes.push(child);
    });
  }

  replaceChildren(...nodes) {
    this.childNodes.forEach((child) => {
      child.parentNode = null;
      child.parentElement = null;
    });
    this.childNodes = [];
    this.append(...nodes);
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child.contains?.(node));
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

class FakeText extends FakeNode {
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

function rect(left, top, width = 0, height = 18) {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top
  };
}

function rowFor(node) {
  let current = node?.nodeType === 3 ? node.parentNode : node;
  while (current) {
    if (current.dataset?.markdownEditableRow === 'true') return current;
    current = current.parentNode;
  }
  return null;
}

class FakeElement extends FakeNode {
  constructor(document, tagName) {
    super(document, 1);
    this.tagName = String(tagName).toUpperCase();
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.classList = new FakeClassList();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  getBoundingClientRect() {
    const row = rowFor(this);
    if (row) {
      const top = Number(row.dataset.physicalLineIndex) * 24;
      if (this.dataset.markdownEmptyCaretHost === 'true') return rect(0, top, 1, 18);
      if (this.dataset.markdownProjectedLeaf === 'true') {
        const rowStart = Number(row.dataset.sourceStart);
        const start = Number(this.dataset.sourceStart);
        const end = Number(this.dataset.sourceEnd);
        return rect((start - rowStart) * 10, top, Math.max(0, end - start) * 10, 18);
      }
      return rect(0, top, Math.max(1, row.textContent.length * 10), 18);
    }
    return rect(0, 0, 500, Math.max(18, this.childNodes.length * 24));
  }
}

class FakeRange {
  constructor(document = null) {
    this.ownerDocument = document;
    this.startContainer = null;
    this.startOffset = 0;
    this.endContainer = null;
    this.endOffset = 0;
  }

  setStart(node, offset) {
    this.startContainer = node;
    this.startOffset = offset;
    if (!this.endContainer) {
      this.endContainer = node;
      this.endOffset = offset;
    }
  }

  setEnd(node, offset) {
    this.endContainer = node;
    this.endOffset = offset;
  }

  collapse(toStart) {
    if (toStart) {
      this.endContainer = this.startContainer;
      this.endOffset = this.startOffset;
    }
  }

  expand(granularity) {
    const expansion = this.ownerDocument?.rangeExpansion?.({
      granularity,
      startContainer: this.startContainer,
      startOffset: this.startOffset
    });
    if (!expansion) throw new TypeError('Range expansion is unavailable.');
    this.setStart(expansion.startContainer, expansion.startOffset);
    this.setEnd(expansion.endContainer, expansion.endOffset);
  }

  getBoundingClientRect() {
    const row = rowFor(this.startContainer);
    if (!row) return rect(0, 0, 0, 0);
    const top = Number(row.dataset.physicalLineIndex) * 24;
    if (this.startContainer.nodeType === 3) {
      const leaf = this.startContainer.parentNode?.dataset?.markdownProjectedLeaf === 'true'
        ? this.startContainer.parentNode
        : null;
      const baseColumn = leaf
        ? Number(leaf.dataset.sourceStart) - Number(row.dataset.sourceStart)
        : 0;
      const left = (baseColumn + this.startOffset) * 10;
      const width = this.endContainer === this.startContainer
        ? Math.max(0, (this.endOffset - this.startOffset) * 10)
        : 0;
      return rect(left, top, width, 18);
    }
    return rect(0, top, 0, 18);
  }

  getClientRects() {
    return [this.getBoundingClientRect()];
  }
}

class FakeSelection {
  constructor(log = null) {
    this.log = log;
    this.anchorNode = null;
    this.anchorOffset = 0;
    this.focusNode = null;
    this.focusOffset = 0;
  }

  setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
    this.log?.push('place');
    this.anchorNode = anchorNode;
    this.anchorOffset = anchorOffset;
    this.focusNode = focusNode;
    this.focusOffset = focusOffset;
  }
}

class FakeDocument {
  constructor() {
    this.root = null;
    this.selection = new FakeSelection();
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createTextNode(value) {
    return new FakeText(this, value);
  }

  createRange() {
    return new FakeRange(this);
  }

  getSelection() {
    return this.selection;
  }

  rowAtY(clientY) {
    const rows = this.root?.childNodes || [];
    const index = Math.max(0, Math.min(rows.length - 1, Math.floor(clientY / 24)));
    return rows[index] || null;
  }

  caretPositionFromPoint(clientX, clientY) {
    const row = this.rowAtY(clientY);
    if (!row) return null;
    if (row.firstChild?.dataset?.markdownEmptyCaretHost === 'true') {
      return { offsetNode: row.firstChild.firstChild, offset: 0 };
    }
    const leaves = row.childNodes.filter((child) => (
      child.dataset?.markdownProjectedLeaf === 'true'
        && Number(child.dataset.sourceEnd) > Number(child.dataset.sourceStart)
    ));
    if (leaves.length) {
      const rowStart = Number(row.dataset.sourceStart);
      const rowEnd = Number(row.dataset.sourceContentEnd);
      const sourceOffset = Math.max(
        rowStart,
        Math.min(rowEnd, rowStart + Math.round(clientX / 10))
      );
      const leaf = leaves.find((candidate) => (
        Number(candidate.dataset.sourceStart) <= sourceOffset
          && sourceOffset < Number(candidate.dataset.sourceEnd)
      )) || leaves.at(-1);
      return {
        offsetNode: leaf.firstChild,
        offset: Math.max(0, Math.min(
          leaf.firstChild.nodeValue.length,
          sourceOffset - Number(leaf.dataset.sourceStart)
        ))
      };
    }
    return {
      offsetNode: row.firstChild,
      offset: Math.max(0, Math.min(row.textContent.length, Math.round(clientX / 10)))
    };
  }

  elementFromPoint(_clientX, clientY) {
    return this.rowAtY(clientY);
  }
}

function createEnvironment() {
  const document = new FakeDocument();
  const root = document.createElement('div');
  document.root = root;
  return { document, root };
}

function sourceSnapshot() {
  const markdownBody = 'a\r\n\r\nb\n';
  return Object.freeze({
    version: 1,
    markdownBody,
    physicalLineIndex: Object.freeze({
      lines: Object.freeze([
        Object.freeze({ id: 'line-a', index: 0, start: 0, contentEnd: 1, text: 'a', lineEnding: '\r\n', sourceEnd: 3 }),
        Object.freeze({ id: 'line-blank', index: 1, start: 3, contentEnd: 3, text: '', lineEnding: '\r\n', sourceEnd: 5 }),
        Object.freeze({ id: 'line-b', index: 2, start: 5, contentEnd: 6, text: 'b', lineEnding: '\n', sourceEnd: 7 }),
        Object.freeze({ id: 'line-terminal', index: 3, start: 7, contentEnd: 7, text: '', lineEnding: '', sourceEnd: 7 })
      ])
    })
  });
}

function rawPresentation(snapshot, mode = 'source') {
  return deepFreeze({
    sourceVersion: snapshot.version,
    markdownBody: snapshot.markdownBody,
    mode,
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
        kind: line.text.length ? 'source' : 'empty-row',
        visibility: 'visible',
        interactionPolicy: line.text.length ? 'editable-text' : 'editable-empty-row'
      }],
      anchors: [],
      metadata: {}
    }))
  });
}

function project(snapshot = sourceSnapshot(), options = {}) {
  const environment = createEnvironment();
  const projection = createEditableProjection({ ...environment, ...options });
  const mode = options.mode || 'source';
  projection.render(snapshot, {
    mode,
    presentationPlan: options.presentationPlan || rawPresentation(snapshot, mode)
  });
  return { ...environment, projection };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function plannedSnapshot() {
  const markdownBody = 'abcd\n\nxy\n';
  return Object.freeze({
    version: 1,
    markdownBody,
    physicalLineIndex: Object.freeze({
      lines: Object.freeze([
        Object.freeze({ id: 'line-abcd', index: 0, start: 0, contentEnd: 4, text: 'abcd', lineEnding: '\n', sourceEnd: 5 }),
        Object.freeze({ id: 'line-blank', index: 1, start: 5, contentEnd: 5, text: '', lineEnding: '\n', sourceEnd: 6 }),
        Object.freeze({ id: 'line-xy', index: 2, start: 6, contentEnd: 8, text: 'xy', lineEnding: '\n', sourceEnd: 9 }),
        Object.freeze({ id: 'line-terminal', index: 3, start: 9, contentEnd: 9, text: '', lineEnding: '', sourceEnd: 9 })
      ])
    })
  });
}

function plannedPresentation(snapshot = plannedSnapshot(), mode = 'live-preview') {
  const leaf = (line, start, end, kind, visibility = 'visible') => ({
    leafId: `${line.id}:${start}:${end}:${kind}`,
    physicalLineId: line.id,
    lineIndex: line.index,
    sourceStart: start,
    sourceEnd: end,
    text: snapshot.markdownBody.slice(start, end),
    semanticOwnerId: kind === 'right' ? 'semantic-right' : null,
    kind,
    visibility,
    interactionPolicy: visibility === 'visible' ? 'editable-text' : 'activate-source'
  });
  const lines = snapshot.physicalLineIndex.lines.map((line) => {
    let leaves;
    if (line.id === 'line-abcd') {
      leaves = [
        leaf(line, 0, 2, 'left'),
        leaf(line, 2, 4, 'right', 'activatable')
      ];
    } else if (line.id === 'line-xy') {
      leaves = [leaf(line, 6, 7, 'x'), leaf(line, 7, 8, 'y')];
    } else {
      leaves = [leaf(line, line.start, line.contentEnd, 'empty-row')];
    }
    const anchors = line.id === 'line-abcd' ? [{
      kind: 'math-rendered-activation',
      ownerId: 'semantic-right',
      position: {
        sourceVersion: snapshot.version,
        offset: 2,
        affinity: 'after',
        physicalLineId: line.id,
        physicalLineIndex: line.index,
        logicalColumn: 2,
        semanticOwnerId: 'semantic-right',
        visibility: 'activatable',
        interactionPolicy: 'activate-owner'
      }
    }] : [];
    return {
      physicalLineId: line.id,
      index: line.index,
      start: line.start,
      contentEnd: line.contentEnd,
      sourceEnd: line.sourceEnd,
      lineEnding: line.lineEnding,
      text: line.text,
      leaves,
      anchors,
      metadata: line.id === 'line-abcd' ? { semanticFamily: 'fixture' } : {}
    };
  });
  return deepFreeze({
    sourceVersion: snapshot.version,
    markdownBody: snapshot.markdownBody,
    mode,
    lines,
    controls: [],
    constructs: {}
  });
}

function allElements(node) {
  const result = [];
  const visit = (current) => {
    if (current?.nodeType === 1) result.push(current);
    current?.childNodes?.forEach(visit);
  };
  visit(node);
  return result;
}

test('renders one exact raw row for LF, CRLF, repeated blank, and terminal rows', () => {
  const { root, projection } = project();
  const rows = projection.enumeratePhysicalRows();

  assert.equal(root.childNodes.length, 4);
  assert.deepEqual(rows.map((row) => row.text), ['a', '', 'b', '']);
  assert.deepEqual(
    root.childNodes.map((row) => row.textContent.replaceAll('\u200b', '')),
    ['a', '', 'b', '']
  );
  assert.deepEqual(
    root.childNodes.map((row) => row.dataset.lineEnding),
    ['crlf', 'crlf', 'lf', 'none']
  );
  assert.ok(root.childNodes[1].firstChild.classList.contains('markdown-editable-empty-caret-host'));
  assert.ok(root.childNodes[3].firstChild.getBoundingClientRect().height > 0);
  assert.equal(root.childNodes[0].tagName, 'DIV');
  assert.equal(allElements(root).some((element) => ['OL', 'UL', 'LI'].includes(element.tagName)), false);
});

test('declares only visible physical-row positions and excludes CRLF interiors', () => {
  const { projection } = project();
  const positions = projection.enumerateDeclaredPositions();

  assert.deepEqual(positions.map((position) => position.offset), [0, 1, 3, 5, 6, 7]);
  assert.deepEqual(
    positions.map((position) => position.affinity),
    ['after', 'before', 'after', 'after', 'before', 'after']
  );
  assert.equal(projection.sourceToDom({ sourceVersion: 1, offset: 2 }), null);
  assert.equal(projection.sourceToDom({ sourceVersion: 1, offset: 4 }), null);
  assert.equal(projection.sourceToDom({
    sourceVersion: 1,
    physicalLineId: 'line-a',
    offset: 1,
    affinity: 'after'
  }), null);
});

test('source and DOM positions round-trip with offset, affinity, row, and column intact', () => {
  const { projection } = project();

  projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = projection.sourceToDom(position);
    assert.ok(dom);
    const restored = projection.domToSource(dom.node, dom.offset, { allowRowFallback: false });
    assert.ok(samePosition(restored, position), `${positionKey(position)} failed to round-trip`);
    assert.equal(restored.logicalColumn, position.logicalColumn);
  });
});

test('immutable presentation plans render exact leaf-local text and round-trip boundary affinity', () => {
  const snapshot = plannedSnapshot();
  const presentationPlan = plannedPresentation(snapshot);
  const { root, projection } = project(snapshot, {
    mode: 'live-preview',
    presentationPlan
  });
  const leaves = projection.enumerateProjectedLeaves();
  const positions = projection.enumerateDeclaredPositions();
  const at = (lineId, logicalColumn) => positions.find((position) => (
    position.physicalLineId === lineId && position.logicalColumn === logicalColumn
  ));

  assert.equal(root.dataset.presentationPlan, 'true');
  assert.equal(root.childNodes.length, 4);
  assert.equal(root.childNodes[0].childNodes.length, 2);
  assert.deepEqual(root.childNodes[0].childNodes.map((child) => child.textContent), ['ab', 'cd']);
  assert.ok(root.childNodes[0].childNodes.every((child) => (
    child.dataset.markdownProjectedLeaf === 'true'
  )));
  assert.ok(root.childNodes[1].firstChild.classList.contains('markdown-editable-empty-caret-host'));
  assert.ok(root.childNodes[3].firstChild.classList.contains('markdown-editable-empty-caret-host'));
  assert.deepEqual(leaves.map((leaf) => [leaf.sourceStart, leaf.sourceEnd]), [
    [0, 2], [2, 4], [5, 5], [6, 7], [7, 8], [9, 9]
  ]);
  leaves.forEach((leaf) => {
    assert.equal(leaf.text, snapshot.markdownBody.slice(leaf.sourceStart, leaf.sourceEnd));
    if (!leaf.emptyCaretHost) assert.equal(leaf.domText, leaf.text);
    const start = projection.domToSource(leaf.textNode, 0, { allowRowFallback: false });
    const end = projection.domToSource(
      leaf.textNode,
      leaf.emptyCaretHost ? 0 : leaf.domText.length,
      { allowRowFallback: false }
    );
    assert.equal(start.offset, leaf.sourceStart);
    assert.equal(end.offset, leaf.sourceEnd);
  });

  positions.forEach((position) => {
    const dom = projection.sourceToDom(position);
    const restored = projection.domToSource(dom.node, dom.offset, { allowRowFallback: false });
    assert.ok(samePosition(restored, position), `${positionKey(position)} failed at a leaf boundary`);
    assert.ok(position.leafId);
  });
  const boundary = at('line-abcd', 2);
  const boundaryDom = projection.sourceToDom(boundary);
  assert.equal(boundary.affinity, 'after');
  assert.equal(boundary.leafId, presentationPlan.lines[0].leaves[1].leafId);
  assert.equal(boundaryDom.node, root.childNodes[0].childNodes[1].firstChild);
  assert.equal(boundaryDom.offset, 0);
  assert.ok(samePosition(
    projection.domToSource(root.childNodes[0].childNodes[0].firstChild, 2),
    boundary
  ));
  const lineEnd = at('line-abcd', 4);
  assert.equal(lineEnd.affinity, 'before');
  assert.equal(projection.sourceToDom(lineEnd).offset, 2);
  assert.deepEqual(projection.positionRect(boundary), rect(20, 0, 0, 18));

  const diagnostic = projection.diagnosticSnapshot();
  assert.equal(diagnostic.presentationPlan, presentationPlan);
  assert.equal(diagnostic.projectedLeaves.length, 6);
  assert.equal(diagnostic.positions.find((entry) => samePosition(entry.position, boundary)).leafId,
    boundary.leafId);
  assert.ok(diagnostic.positions.every((entry) => entry.roundTripExact));
  assert.equal(projection.certifyPositions().equal, true);
});

test('projection consumes the syntax-adapter plan contract without inventing source ownership', () => {
  const source = '[Safe](https://example.com) and $x^2$\r\n\r\n| A | B |\r\n| - | - |\r\n| | value |';
  const snapshot = markdownPageModel.createSourceSnapshot(source);
  const presentationPlan = buildEditablePresentationPlan(snapshot, {
    model: markdownPageModel,
    mode: 'live-preview'
  });
  const { projection } = project(snapshot, {
    mode: 'live-preview',
    presentationPlan
  });

  assert.equal(projection.enumerateProjectedLeaves().length,
    presentationPlan.lines.flatMap((line) => line.leaves).length);
  projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = projection.sourceToDom(position);
    const roundTrip = projection.domToSource(dom.node, dom.offset, {
      allowRowFallback: false
    });
    assert.ok(samePosition(position, roundTrip), positionKey(position));
  });
  assert.deepEqual(
    projection.enumeratePlanActivationAnchors().map((anchor) => anchor.kind).sort(),
    presentationPlan.lines.flatMap((line) => line.anchors).map((anchor) => anchor.kind).sort()
  );
  assert.equal(projection.diagnosticSnapshot().presentationPlan, presentationPlan);
});

test('presentation plan validation rejects mutation, stale ownership, and non-exact leaves atomically', () => {
  const snapshot = plannedSnapshot();
  const environment = createEnvironment();
  const projection = createEditableProjection(environment);
  projection.render(snapshot, {
    mode: 'source',
    presentationPlan: rawPresentation(snapshot, 'source')
  });
  const originalRows = environment.root.childNodes.slice();

  assert.throws(() => projection.render(snapshot, {
    mode: 'live-preview',
    presentationPlan: { ...plannedPresentation(snapshot) }
  }), /must be immutable/);
  assert.deepEqual(environment.root.childNodes, originalRows);

  const stale = JSON.parse(JSON.stringify(plannedPresentation(snapshot)));
  stale.sourceVersion = 'stale-version';
  assert.throws(() => projection.render(snapshot, {
    mode: 'live-preview',
    presentationPlan: deepFreeze(stale)
  }), /sourceVersion/);
  assert.deepEqual(environment.root.childNodes, originalRows);

  const overlapping = JSON.parse(JSON.stringify(plannedPresentation(snapshot)));
  overlapping.lines[0].leaves[1].sourceStart = 1;
  overlapping.lines[0].leaves[1].text = 'bcd';
  assert.throws(() => projection.render(snapshot, {
    mode: 'live-preview',
    presentationPlan: deepFreeze(overlapping)
  }), /not an exact canonical slice/);
  assert.deepEqual(environment.root.childNodes, originalRows);
});

test('plan semantic presentation descendants map only through one registered exact activation anchor', () => {
  const snapshot = plannedSnapshot();
  const presentationPlan = plannedPresentation(snapshot);
  const { document, root, projection } = project(snapshot, {
    mode: 'live-preview',
    presentationPlan
  });
  const presentation = document.createElement('span');
  const inner = document.createElement('span');
  const renderedText = document.createTextNode('rendered expression with unrelated geometry');
  inner.append(renderedText);
  presentation.append(inner);
  root.childNodes[0].append(presentation);

  assert.equal(projection.domToSource(renderedText, 0), null);
  assert.equal(projection.domToSource(renderedText, 19), null);
  const [descriptor] = projection.enumeratePlanActivationAnchors();
  assert.equal(descriptor.position.offset, 2);
  assert.equal(descriptor.position.affinity, 'after');
  const registered = projection.registerPlanActivationAnchor(presentation, descriptor.anchorId);
  assert.equal(registered.offset, 2);
  assert.equal(registered.semanticOwnerId, 'semantic-right');
  assert.equal(presentation.attributes.contenteditable, 'false');
  assert.equal(presentation.dataset.markdownSemanticOnly, 'true');
  [0, 19, renderedText.nodeValue.length].forEach((offset) => {
    const mapped = projection.domToSource(renderedText, offset, { allowRowFallback: false });
    assert.equal(mapped.offset, 2);
    assert.equal(mapped.affinity, 'after');
    assert.equal(mapped.semanticOwnerId, 'semantic-right');
  });
  assert.equal(projection.pointerToPosition({
    clientX: 0,
    clientY: 1,
    target: inner
  }).offset, 2, 'the registered semantic target wins over an adjacent native caret');
  const diagnostics = projection.diagnosticSnapshot();
  assert.equal(diagnostics.planActivationAnchors.length, 1);
  assert.equal(diagnostics.registeredActivationAnchors.length, 1);
  assert.equal(diagnostics.registeredActivationAnchors[0].planAnchorId, descriptor.anchorId);

  assert.equal(projection.unregisterActivationAnchor(presentation), true);
  assert.equal(projection.domToSource(renderedText, 5), null);
});

test('pointer hit-tests exact old-presentation text before activation-anchor fallback', () => {
  const snapshot = plannedSnapshot();
  const presentationPlan = plannedPresentation(snapshot);
  const { document, root, projection } = project(snapshot, {
    mode: 'live-preview',
    presentationPlan
  });
  const presentation = document.createElement('span');
  const mapped = document.createElement('span');
  mapped.dataset.markdownSourceStart = '1';
  mapped.dataset.markdownSourceEnd = '4';
  const mappedText = document.createTextNode('bcd');
  mapped.append(mappedText);
  presentation.append(mapped);
  root.childNodes[0].append(presentation);

  const [descriptor] = projection.enumeratePlanActivationAnchors();
  assert.equal(descriptor.position.offset, 2);
  projection.registerPlanActivationAnchor(presentation, descriptor.anchorId);
  let caretOffset = 2;
  document.caretPositionFromPoint = () => ({ offsetNode: mappedText, offset: caretOffset });

  const pointed = projection.pointerToPosition({
    clientX: 20,
    clientY: 1,
    target: mapped
  });
  assert.equal(pointed.offset, 3,
    'the pre-activation rendered descendant chooses its exact canonical character');
  assert.equal(pointed.affinity, 'after');
  assert.equal(projection.domToSource(mappedText, 2).offset, 2,
    'ordinary DOM mapping remains the non-proportional activation owner');

  caretOffset = 3;
  const atPhysicalRowEnd = projection.pointerToPosition({
    clientX: 30,
    clientY: 1,
    target: mapped
  });
  assert.equal(atPhysicalRowEnd.offset, 4);
  assert.equal(atPhysicalRowEnd.physicalLineId, 'line-abcd');
  assert.equal(atPhysicalRowEnd.affinity, 'before',
    'the old presentation hit retains the canonical physical-row boundary affinity');

  mappedText.nodeValue = 'not the canonical slice';
  const fallback = projection.pointerToPosition({
    clientX: 20,
    clientY: 1,
    target: mapped
  });
  assert.equal(fallback.offset, 2,
    'a presentation/source mismatch fails closed to the declared activation anchor');
});

test('rendering without a plan is rejected and cannot replace the planned projection', () => {
  const snapshot = plannedSnapshot();
  const environment = createEnvironment();
  const projection = createEditableProjection(environment);
  projection.render(snapshot, {
    mode: 'live-preview',
    presentationPlan: plannedPresentation(snapshot)
  });
  const oldLeafText = environment.root.childNodes[0].firstChild.firstChild;

  assert.throws(
    () => projection.render(snapshot, { mode: 'source' }),
    /requires one immutable presentationPlan/
  );
  assert.equal(environment.root.dataset.presentationPlan, 'true');
  assert.equal(environment.root.childNodes[0].firstChild.firstChild.nodeType, 3);
  assert.equal(environment.root.childNodes[0].textContent, 'abcd');
  assert.equal(projection.enumerateProjectedLeaves().length, 6);
  assert.equal(projection.domToSource(oldLeafText, 1).offset, 1);
});

test('presentation-only text has no proportional mapping and explicit anchors are exact', () => {
  const { document, root, projection } = project();
  const row = root.childNodes[0];
  const presentation = document.createElement('span');
  const semanticText = document.createTextNode('a much longer semantic rendering');
  presentation.append(semanticText);
  row.append(presentation);

  assert.equal(
    projection.domToSource(semanticText, 17, { allowRowFallback: false }),
    null
  );
  const anchorTarget = projection.enumerateDeclaredPositions()[1];
  projection.registerActivationAnchor(presentation, anchorTarget, { semanticOwnerId: 'semantic-a' });
  const atStart = projection.domToSource(semanticText, 0, { allowRowFallback: false });
  const atEnd = projection.domToSource(semanticText, semanticText.nodeValue.length, {
    allowRowFallback: false
  });
  assert.equal(atStart.offset, anchorTarget.offset);
  assert.equal(atEnd.offset, anchorTarget.offset);
  assert.equal(atStart.semanticOwnerId, 'semantic-a');
});

test('claimed pointers prevent Chromium placement before restoring Viewer selection', () => {
  const log = [];
  const { document, projection } = project();
  document.selection = new FakeSelection(log);
  const event = {
    clientX: 10,
    clientY: 1,
    target: document.root.childNodes[0],
    preventDefault() {
      log.push('prevent');
    }
  };

  const position = projection.claimPointer(event);
  assert.equal(position.offset, 1);
  assert.deepEqual(log, ['prevent', 'place']);
  assert.equal(projection.getSelection().anchor.offset, 1);
});

test('selection restoration and horizontal/vertical movement share declared positions', () => {
  const snapshot = {
    version: 3,
    markdownBody: 'abc\nx\nwxyz',
    physicalLineIndex: {
      lines: [
        { id: 'one', index: 0, start: 0, contentEnd: 3, text: 'abc', lineEnding: '\n', sourceEnd: 4 },
        { id: 'two', index: 1, start: 4, contentEnd: 5, text: 'x', lineEnding: '\n', sourceEnd: 6 },
        { id: 'three', index: 2, start: 6, contentEnd: 10, text: 'wxyz', lineEnding: '', sourceEnd: 10 }
      ]
    }
  };
  const { projection } = project(snapshot);
  const positions = projection.enumerateDeclaredPositions();
  const at = (line, column) => positions.find((position) => (
    position.physicalLineId === line && position.logicalColumn === column
  ));

  assert.ok(samePosition(projection.moveHorizontal(at('one', 3), 'right'), at('two', 0)));
  assert.ok(samePosition(projection.moveHorizontal(at('two', 0), 'left'), at('one', 3)));
  assert.ok(samePosition(projection.moveVertical(at('one', 2), 'down'), at('two', 1)));
  assert.ok(samePosition(projection.moveVertical(at('one', 2), 'down', 0), at('two', 0)));
  assert.ok(samePosition(projection.moveVertical(at('one', 2), 'down', 20), at('two', 1)));
  assert.ok(projection.restoreSelection({ anchor: at('one', 1), focus: at('three', 3) }));
  const restored = projection.getSelection();
  assert.ok(samePosition(restored.anchor, at('one', 1)));
  assert.ok(samePosition(restored.focus, at('three', 3)));
});

test('browser Range expansion measures word and block granularity from one exact canonical anchor', () => {
  const snapshot = markdownPageModel.createSourceSnapshot('hello world\nsecond line', {
    version: 7
  });
  const { document, root, projection } = project(snapshot);
  const positions = projection.enumerateDeclaredPositions();
  const at = (lineIndex, column) => positions.find((position) => (
    position.physicalLineIndex === lineIndex && position.logicalColumn === column
  ));
  const firstText = root.childNodes[0].firstChild.firstChild;
  const originalSelection = {
    anchor: at(0, 0),
    focus: at(0, 5)
  };
  assert.equal(projection.restoreSelection(originalSelection), true);

  const expansionCalls = [];
  document.rangeExpansion = ({ granularity, startContainer, startOffset }) => {
    expansionCalls.push({ granularity, startContainer, startOffset });
    return granularity === 'word'
      ? {
        startContainer: firstText,
        startOffset: 6,
        endContainer: firstText,
        endOffset: 11
      }
      : {
        startContainer: firstText,
        startOffset: 0,
        endContainer: firstText,
        endOffset: 11
      };
  };

  const word = projection.selectTextGranularity(at(0, 8), 'word', { apply: false });
  assert.equal(word.sourceVersion, 7);
  assert.equal(word.anchor.offset, 6);
  assert.equal(word.focus.offset, 11);
  assert.equal(word.granularity, 'word');
  assert.equal(word.collapsed, false);
  assert.deepEqual(
    [document.selection.anchorOffset, document.selection.focusOffset],
    [0, 5],
    'detached Range measurement must not disturb the browser Selection'
  );

  const block = projection.selectTextGranularity(at(0, 8), 'block');
  assert.equal(block.anchor.offset, 0);
  assert.equal(block.focus.offset, 11);
  assert.equal(block.granularity, 'block');
  assert.ok(samePosition(projection.getSelection().anchor, block.anchor));
  assert.ok(samePosition(projection.getSelection().focus, block.focus));
  assert.deepEqual(
    expansionCalls.map(({ granularity, startContainer, startOffset }) => (
      [granularity, startContainer === firstText, startOffset]
    )),
    [['word', true, 8], ['block', true, 8]],
    'both granularities must be delegated to Chromium from the saved source position'
  );
});

test('granularity selection fails closed for stale, hidden, disconnected, and unmappable DOM', () => {
  const snapshot = markdownPageModel.createSourceSnapshot('hello world', { version: 9 });
  const { document, root, projection } = project(snapshot);
  const positions = projection.enumerateDeclaredPositions();
  const at = (column) => positions.find((position) => position.logicalColumn === column);
  const text = root.firstChild.firstChild.firstChild;
  let expansions = 0;
  document.rangeExpansion = () => {
    expansions += 1;
    return {
      startContainer: text,
      startOffset: 0,
      endContainer: text,
      endOffset: 5
    };
  };
  projection.restoreSelection({ anchor: at(6), focus: at(11) });

  assert.equal(projection.selectTextGranularity({ ...at(2), sourceVersion: 8 }, 'word'), null);
  assert.equal(expansions, 0, 'a stale source revision must never reach browser expansion');
  assert.deepEqual(
    [document.selection.anchorOffset, document.selection.focusOffset],
    [6, 11]
  );

  root.firstChild.firstChild.style.display = 'none';
  assert.equal(projection.selectTextGranularity(at(2), 'word'), null);
  assert.equal(expansions, 0, 'hidden source text must not become a selection anchor');
  root.firstChild.firstChild.style.display = '';

  const outside = document.createTextNode('outside');
  document.rangeExpansion = () => ({
    startContainer: outside,
    startOffset: 0,
    endContainer: outside,
    endOffset: 7
  });
  assert.equal(projection.selectTextGranularity(at(2), 'word'), null);
  assert.deepEqual(
    [document.selection.anchorOffset, document.selection.focusOffset],
    [6, 11],
    'an unmappable expansion must leave the prior native Selection intact'
  );

  root.replaceChildren();
  assert.equal(projection.selectTextGranularity(at(2), 'word'), null);
  assert.equal(projection.selectTextGranularity(at(2), 'sentence'), null);
});

test('failed browser Selection application restores the exact prior native endpoints', () => {
  const snapshot = markdownPageModel.createSourceSnapshot('hello world\nsecond line', {
    version: 11
  });
  const { document, root, projection } = project(snapshot);
  const positions = projection.enumerateDeclaredPositions();
  const at = (lineIndex, column) => positions.find((position) => (
    position.physicalLineIndex === lineIndex && position.logicalColumn === column
  ));
  const firstText = root.childNodes[0].firstChild.firstChild;
  const secondText = root.childNodes[1].firstChild.firstChild;
  const selection = new FakeSelection();
  selection.anchorNode = secondText;
  selection.anchorOffset = 0;
  selection.focusNode = secondText;
  selection.focusOffset = 6;
  let placements = 0;
  selection.setBaseAndExtent = function setBaseAndExtent(
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset
  ) {
    placements += 1;
    this.anchorNode = anchorNode;
    this.anchorOffset = anchorOffset;
    this.focusNode = placements === 1 ? anchorNode : focusNode;
    this.focusOffset = placements === 1 ? anchorOffset : focusOffset;
  };
  document.rangeExpansion = () => ({
    startContainer: firstText,
    startOffset: 6,
    endContainer: firstText,
    endOffset: 11
  });

  assert.equal(projection.selectTextGranularity(at(0, 8), 'word', { selection }), null);
  assert.equal(placements, 2);
  assert.equal(selection.anchorNode, secondText);
  assert.equal(selection.anchorOffset, 0);
  assert.equal(selection.focusNode, secondText);
  assert.equal(selection.focusOffset, 6);
});

test('browser word expansion maps rendered table-cell text without selecting source delimiters', () => {
  const source = '| Alpha | Beta |\n| --- | --- |';
  const snapshot = markdownPageModel.createSourceSnapshot(source, { version: 13 });
  const presentationPlan = buildEditablePresentationPlan(snapshot, {
    model: markdownPageModel,
    mode: 'live-preview'
  });
  const { document, projection } = project(snapshot, {
    mode: 'live-preview',
    presentationPlan
  });
  const alphaStart = source.indexOf('Alpha');
  const cellLeaf = projection.enumerateProjectedLeaves().find((leaf) => (
    leaf.kind === 'table-cell' && leaf.sourceStart === alphaStart
  ));
  const anchor = projection.enumerateDeclaredPositions().find((position) => (
    position.offset === alphaStart + 2
  ));
  assert.ok(cellLeaf);
  assert.ok(anchor);
  document.rangeExpansion = ({ granularity, startContainer, startOffset }) => {
    assert.equal(granularity, 'word');
    assert.equal(startContainer, cellLeaf.textNode);
    assert.equal(startOffset, 2);
    return {
      startContainer: cellLeaf.textNode,
      startOffset: 0,
      endContainer: cellLeaf.textNode,
      endOffset: 5
    };
  };

  const selected = projection.selectTextGranularity(anchor, 'word', { apply: false });
  assert.equal(selected.anchor.offset, alphaStart);
  assert.equal(selected.focus.offset, alphaStart + 5);
  assert.equal(source.slice(selected.anchor.offset, selected.focus.offset), 'Alpha');
  assert.equal(source[selected.anchor.offset - 1], ' ');
  assert.equal(source[selected.focus.offset], ' ');
});

test('diagnostic certification proves P equals K equals V with positive caret rectangles', () => {
  const { projection } = project();
  const diagnostic = projection.diagnosticSnapshot();
  const certification = projection.certifyPositions();

  assert.ok(diagnostic.positions.every((entry) => entry.roundTripExact));
  assert.ok(diagnostic.positions.every((entry) => entry.pointerRoundTripExact));
  assert.ok(diagnostic.positions.every((entry) => entry.positiveCaretRect));
  assert.ok(diagnostic.positions.every((entry) => entry.positiveCollapsedCaretRect));
  assert.equal(certification.equal, true);
  assert.deepEqual(certification.P, certification.K);
  assert.deepEqual(certification.K, certification.V);
  assert.deepEqual(certification.failures, []);
});
