const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');
const {
  certifyPositionSets,
  createCertificationProjection,
  expectedDeclaredPositions,
  rawCertificationPresentationPlan,
  positionKey,
  samePosition
} = require('./helpers/markdownEditableCertificationHarness');

const SYNTAX_FAMILY_SOURCE = [
  'plain *em* **strong** ~~strike~~ \\*',
  '',
  '# heading',
  '> quote',
  '1. ordered marker',
  '- unordered marker',
  '`inline code` and [link](https://example.test)',
  '$x^2 + y^2$',
  '| A | B |',
  '| --- | --- |',
  '| one | two |',
  '```js',
  'const value = 1;',
  '```',
  ''
].join('\r\n');

test('certification: P == K == V for all declared Source and Live Preview positions', () => {
  const snapshot = foundation.createSourceSnapshot(SYNTAX_FAMILY_SOURCE);

  for (const mode of ['source', 'live-preview']) {
    const certified = certifyPositionSets(snapshot, mode);
    assert.deepEqual(certified.P, certified.K, `${mode}: pointer and keyboard sets differ`);
    assert.deepEqual(certified.K, certified.V, `${mode}: keyboard and visible sets differ`);
    assert.equal(certified.declared.length, expectedDeclaredPositions(snapshot).length);
    assert.equal(
      certified.root.childNodes.some((row) => ['OL', 'UL', 'LI'].includes(row.tagName)),
      false
    );
  }
});

test('certification: LF/CRLF interiors are hidden while repeated blank and terminal rows stay addressable', () => {
  const source = 'a\r\n\r\nb\n\n';
  const snapshot = foundation.createSourceSnapshot(source);
  const certified = certifyPositionSets(snapshot, 'source');
  const offsets = certified.declared.map((key) => Number(key.split('|')[2]));

  for (const hiddenOffset of [2, 4]) {
    assert.equal(offsets.includes(hiddenOffset), false, `CRLF interior ${hiddenOffset} was declared`);
  }
  assert.deepEqual(snapshot.physicalLineIndex.lines.map((line) => line.text), ['a', '', 'b', '', '']);
  assert.equal(certified.root.childNodes.length, 5);
  for (const lineIndex of [1, 3, 4]) {
    const row = certified.root.childNodes[lineIndex];
    assert.equal(row.dataset.markdownEditableRow, 'true');
    assert.ok(row.firstChild.getBoundingClientRect().height > 0);
  }
});

test('certification: every restorable caret performs an exact canonical insertion at its declared offset', () => {
  const source = '1. Item\r\n\r\nend\n';
  const snapshot = foundation.createSourceSnapshot(source);
  const { projection } = createCertificationProjection(snapshot, 'source');
  const declared = projection.enumerateDeclaredPositions();

  for (const position of declared) {
    assert.ok(projection.restoreSelection({ anchor: position, focus: position }));
    const restored = projection.getSelection();
    assert.ok(restored && samePosition(restored.focus, position), positionKey(position));
    const result = foundation.applyCanonicalEdit(
      snapshot,
      { anchor: restored.focus, focus: restored.focus },
      {
        start: restored.focus.offset,
        end: restored.focus.offset,
        replacement: '\u00a7',
        kind: 'position-certification'
      },
      { transactionKind: 'position-certification', inputType: 'insertText' }
    );
    assert.deepEqual(
      result.primaryEdits.map(({ start, end, replacement }) => ({ start, end, replacement })),
      [{ start: position.offset, end: position.offset, replacement: '\u00a7' }]
    );
    assert.equal(
      result.source,
      `${source.slice(0, position.offset)}\u00a7${source.slice(position.offset)}`,
      `canonical insertion targeted the wrong offset for ${positionKey(position)}`
    );
  }
});

test('certification: list prefix characters are independently addressable positions', () => {
  const source = '12. item\n- item';
  const snapshot = foundation.createSourceSnapshot(source);
  const certified = certifyPositionSets(snapshot, 'live-preview');
  const positions = certified.projection.enumerateDeclaredPositions();

  const orderedLine = snapshot.physicalLineIndex.lines[0];
  const orderedColumns = positions
    .filter((position) => position.physicalLineId === orderedLine.id)
    .map((position) => position.logicalColumn);
  assert.deepEqual(orderedColumns, Array.from({ length: orderedLine.text.length + 1 }, (_, index) => index));

  for (const column of [0, 1, 2, 3]) {
    const position = positions.find((candidate) => (
      candidate.physicalLineId === orderedLine.id && candidate.logicalColumn === column
    ));
    assert.ok(position, `ordered prefix boundary ${column} is unreachable`);
    assert.ok(certified.P.includes(positionKey(position)));
    assert.ok(certified.K.includes(positionKey(position)));
    assert.ok(certified.V.includes(positionKey(position)));
  }
});

test('certification: a Source/Live transition retains the same physical rows and position keys', () => {
  const snapshot = foundation.createSourceSnapshot('paragraph\n\n1. item\n');
  const { projection, root } = createCertificationProjection(snapshot, 'source');
  const sourceRows = projection.enumeratePhysicalRows().map((row) => ({
    id: row.physicalLineId,
    text: row.text,
    ending: row.lineEnding
  }));
  const sourcePositions = projection.enumerateDeclaredPositions().map(positionKey);

  projection.render(snapshot, {
    mode: 'live-preview',
    presentationPlan: rawCertificationPresentationPlan(snapshot, 'live-preview')
  });
  assert.deepEqual(projection.enumeratePhysicalRows().map((row) => ({
    id: row.physicalLineId,
    text: row.text,
    ending: row.lineEnding
  })), sourceRows);
  assert.deepEqual(projection.enumerateDeclaredPositions().map(positionKey), sourcePositions);
  assert.ok(root.childNodes.every((row) => row.dataset.editableMode === 'live-preview'));

  projection.render(snapshot, {
    mode: 'source',
    presentationPlan: rawCertificationPresentationPlan(snapshot, 'source')
  });
  assert.deepEqual(projection.enumerateDeclaredPositions().map(positionKey), sourcePositions);
  assert.ok(root.childNodes.every((row) => row.dataset.editableMode === 'source'));
});
