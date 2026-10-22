const assert = require('node:assert/strict');

const {
  createEditableProjection,
  positionKey,
  samePosition
} = require('../../public/js/markdownEditableProjection');

function rawCertificationPresentationPlan(snapshot, mode) {
  const lines = snapshot.physicalLineIndex.lines.map((line) => Object.freeze({
    physicalLineId: line.id,
    index: line.index,
    start: line.start,
    contentEnd: line.contentEnd,
    sourceEnd: line.sourceEnd,
    lineEnding: line.lineEnding,
    text: line.text,
    leaves: Object.freeze([Object.freeze({
      leafId: `${line.id}:${line.start}:${line.contentEnd}:certification-source`,
      physicalLineId: line.id,
      lineIndex: line.index,
      sourceStart: line.start,
      sourceEnd: line.contentEnd,
      text: line.text,
      semanticOwnerId: null,
      kind: line.text.length ? 'source' : 'empty-row',
      visibility: 'visible',
      interactionPolicy: line.text.length ? 'editable-text' : 'editable-empty-row'
    })]),
    anchors: Object.freeze([]),
    metadata: Object.freeze({})
  }));
  return Object.freeze({
    sourceVersion: snapshot.version,
    markdownBody: snapshot.markdownBody,
    mode,
    lines: Object.freeze(lines),
    controls: Object.freeze([]),
    constructs: Object.freeze({})
  });
}

class CertificationClassList {
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

class CertificationNode {
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
    nodes.forEach((value) => {
      const node = typeof value === 'string'
        ? this.ownerDocument.createTextNode(value)
        : value;
      node.parentNode = this;
      node.parentElement = this.nodeType === 1 ? this : this.parentElement;
      this.childNodes.push(node);
    });
  }

  replaceChildren(...nodes) {
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

class CertificationText extends CertificationNode {
  constructor(document, value) {
    super(document, 3);
    this.nodeValue = String(value);
  }

  contains(node) {
    return node === this;
  }

  get textContent() {
    return this.nodeValue;
  }
}

function makeRect(left, top, width = 0, height = 18) {
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

function owningRow(node) {
  let current = node?.nodeType === 3 ? node.parentNode : node;
  while (current) {
    if (current.dataset?.markdownEditableRow === 'true') return current;
    current = current.parentNode;
  }
  return null;
}

class CertificationElement extends CertificationNode {
  constructor(document, tagName) {
    super(document, 1);
    this.tagName = String(tagName).toUpperCase();
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.classList = new CertificationClassList();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getBoundingClientRect() {
    const row = owningRow(this);
    if (row) {
      const top = Number(row.dataset.physicalLineIndex) * 22;
      if (this.dataset.markdownEmptyCaretHost === 'true') return makeRect(0, top, 1, 18);
      return makeRect(0, top, Math.max(1, row.textContent.length * 8), 18);
    }
    return makeRect(0, 0, 640, Math.max(18, this.childNodes.length * 22));
  }
}

class CertificationRange {
  constructor() {
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

  getBoundingClientRect() {
    const row = owningRow(this.startContainer);
    if (!row) return makeRect(0, 0, 0, 0);
    const top = Number(row.dataset.physicalLineIndex) * 22;
    const leaf = this.startContainer?.nodeType === 3
      && this.startContainer.parentNode?.dataset?.markdownProjectedLeaf === 'true'
      ? this.startContainer.parentNode
      : null;
    const baseColumn = leaf
      ? Number(leaf.dataset.sourceStart) - Number(row.dataset.sourceStart)
      : 0;
    const left = this.startContainer?.nodeType === 3
      ? (baseColumn + this.startOffset) * 8
      : 0;
    const width = this.startContainer === this.endContainer
      ? Math.max(0, (this.endOffset - this.startOffset) * 8)
      : 0;
    return makeRect(left, top, width, 18);
  }

  getClientRects() {
    return [this.getBoundingClientRect()];
  }
}

class CertificationSelection {
  constructor() {
    this.anchorNode = null;
    this.anchorOffset = 0;
    this.focusNode = null;
    this.focusOffset = 0;
  }

  setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
    this.anchorNode = anchorNode;
    this.anchorOffset = anchorOffset;
    this.focusNode = focusNode;
    this.focusOffset = focusOffset;
  }
}

class CertificationDocument {
  constructor() {
    this.root = null;
    this.selection = new CertificationSelection();
  }

  createElement(tagName) {
    return new CertificationElement(this, tagName);
  }

  createTextNode(value) {
    return new CertificationText(this, value);
  }

  createRange() {
    return new CertificationRange();
  }

  getSelection() {
    return this.selection;
  }

  rowAt(clientY) {
    const rows = this.root?.childNodes || [];
    if (!rows.length) return null;
    const index = Math.max(0, Math.min(rows.length - 1, Math.floor(clientY / 22)));
    return rows[index];
  }

  caretPositionFromPoint(clientX, clientY) {
    const row = this.rowAt(clientY);
    if (!row) return null;
    if (row.firstChild?.dataset?.markdownEmptyCaretHost === 'true') {
      return { offsetNode: row.firstChild.firstChild, offset: 0 };
    }
    const sourceOffset = Math.max(
      Number(row.dataset.sourceStart),
      Math.min(
        Number(row.dataset.sourceContentEnd),
        Number(row.dataset.sourceStart) + Math.round(clientX / 8)
      )
    );
    const leaves = row.childNodes.filter((child) => (
      child.dataset?.markdownProjectedLeaf === 'true'
      && Number(child.dataset.sourceEnd) > Number(child.dataset.sourceStart)
    ));
    const leaf = leaves.find((candidate) => (
      Number(candidate.dataset.sourceStart) <= sourceOffset
      && sourceOffset < Number(candidate.dataset.sourceEnd)
    )) || leaves.at(-1);
    if (leaf?.firstChild) {
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
      offset: Math.max(0, Math.min(row.textContent.length, Math.round(clientX / 8)))
    };
  }

  elementFromPoint(_clientX, clientY) {
    return this.rowAt(clientY);
  }
}

function createCertificationProjection(snapshot, mode = 'source', options = {}) {
  const document = new CertificationDocument();
  const root = document.createElement('div');
  document.root = root;
  const projection = createEditableProjection({ root, document, mode });
  const presentationPlan = options.presentationPlan
    || rawCertificationPresentationPlan(snapshot, mode);
  projection.render(snapshot, { mode, ...options, presentationPlan });
  return { document, root, projection };
}

function expectedDeclaredPositions(snapshot) {
  return snapshot.physicalLineIndex.lines.flatMap((line) => (
    Array.from({ length: line.text.length + 1 }, (_unused, logicalColumn) => ({
      sourceVersion: snapshot.version,
      offset: line.start + logicalColumn,
      affinity: logicalColumn === 0
        ? 'after'
        : logicalColumn === line.text.length
          ? 'before'
          : 'after',
      physicalLineId: line.id,
      logicalColumn
    }))
  ));
}

function traverseKeyboard(projection, firstPosition, count) {
  const positions = [];
  const seen = new Set();
  let current = firstPosition;
  while (current && !seen.has(positionKey(current))) {
    positions.push(current);
    seen.add(positionKey(current));
    const next = projection.moveHorizontal(current, 'right');
    if (samePosition(next, current)) break;
    current = next;
    assert.ok(positions.length <= count, 'horizontal keyboard traversal entered a cycle');
  }
  return positions;
}

function certifyPositionSets(snapshot, mode = 'source') {
  const { root, projection } = createCertificationProjection(snapshot, mode);
  const expected = expectedDeclaredPositions(snapshot);
  const declared = projection.enumerateDeclaredPositions();
  const expectedKeys = expected.map(positionKey);
  assert.deepEqual(declared.map(positionKey), expectedKeys, 'declared positions differ from physical rows');

  const keyboard = traverseKeyboard(projection, declared[0], declared.length);
  assert.deepEqual(keyboard.map(positionKey), expectedKeys, 'ArrowRight does not reach every position once');
  let reverse = keyboard[keyboard.length - 1];
  for (let index = keyboard.length - 2; index >= 0; index -= 1) {
    reverse = projection.moveHorizontal(reverse, 'left');
    assert.ok(samePosition(reverse, keyboard[index]), `ArrowLeft skipped ${positionKey(keyboard[index])}`);
  }

  const pointerKeys = [];
  const visibleKeys = [];
  for (const position of declared) {
    const dom = projection.sourceToDom(position);
    assert.ok(dom, `sourceToDom failed for ${positionKey(position)}`);
    const roundTrip = projection.domToSource(dom.node, dom.offset, { allowRowFallback: false });
    assert.ok(samePosition(position, roundTrip), `DOM round trip changed ${positionKey(position)}`);
    assert.equal(roundTrip.logicalColumn, position.logicalColumn);

    const row = root.childNodes.find((candidate) => (
      candidate.dataset.physicalLineId === String(position.physicalLineId)
    ));
    assert.ok(row, `no DOM row owns ${String(position.physicalLineId)}`);
    assert.equal(row.dataset.physicalLineId, String(position.physicalLineId));
    const rect = projection.collapsedPositionRect(position);
    assert.ok(rect && rect.height > 0, `missing positive caret rect for ${positionKey(position)}`);
    assert.ok(projection.restoreSelection({ anchor: position, focus: position }));
    const restored = projection.getSelection();
    if (restored && samePosition(restored.anchor, position) && samePosition(restored.focus, position)) {
      visibleKeys.push(positionKey(position));
    }

    const pointed = projection.pointerToPosition({
      clientX: rect.left,
      clientY: rect.top + (rect.height / 2),
      target: row
    });
    assert.ok(samePosition(pointed, position), `pointer resolved the wrong position for ${positionKey(position)}`);
    pointerKeys.push(positionKey(pointed));
  }

  assert.deepEqual(pointerKeys, expectedKeys, 'P differs from declared physical positions');
  assert.deepEqual(keyboard.map(positionKey), expectedKeys, 'K differs from declared physical positions');
  assert.deepEqual(visibleKeys, expectedKeys, 'V differs from declared physical positions');

  return {
    P: pointerKeys,
    K: keyboard.map(positionKey),
    V: visibleKeys,
    declared: expectedKeys,
    projection,
    root
  };
}

module.exports = {
  certifyPositionSets,
  createCertificationProjection,
  expectedDeclaredPositions,
  rawCertificationPresentationPlan,
  positionKey,
  samePosition
};
