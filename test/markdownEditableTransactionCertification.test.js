const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');

function recognized(source) {
  return foundation.createSourceSnapshot(source).editableListSemanticIndex.rows;
}

function bareEdits(edits) {
  return edits.map(({ start, end, replacement }) => ({ start, end, replacement }));
}

test('certification: the editable list grammar accepts only leading Tabs plus digits-dot-space or dash-space', () => {
  const source = [
    '1. root ordered',
    '12. root ordered',
    '\t3. nested ordered',
    '\t\t- nested unordered',
    ' 1. leading space is ordinary',
    '\t 1. Tab then space is ordinary',
    '1) alternate ordered is ordinary',
    '* alternate bullet is ordinary',
    '+ alternate bullet is ordinary',
    '> 1. quoted ordered is ordinary',
    '> - quoted unordered is ordinary',
    '1.no required space',
    '-no required space',
    '```md',
    '1. fenced source is ordinary',
    '- fenced source is ordinary',
    '```'
  ].join('\n');

  assert.deepEqual(recognized(source).map((row) => ({
    lineIndex: row.lineIndex,
    kind: row.kind,
    depth: row.depth,
    marker: row.marker
  })), [
    { lineIndex: 0, kind: 'ordered', depth: 1, marker: '1.' },
    { lineIndex: 1, kind: 'ordered', depth: 1, marker: '12.' },
    { lineIndex: 2, kind: 'ordered', depth: 2, marker: '3.' },
    { lineIndex: 3, kind: 'unordered', depth: 3, marker: '-' }
  ]);
});

test('certification: generic character deletion immediately destroys invalidated list syntax', () => {
  const cases = [
    { selection: { anchor: 1, focus: 1 }, direction: 'backward', expected: '. Hello' },
    { selection: { anchor: 2, focus: 2 }, direction: 'backward', expected: '1 Hello' },
    { selection: { anchor: 3, focus: 3 }, direction: 'backward', expected: '1.Hello' },
    { selection: { anchor: 0, focus: 0 }, direction: 'forward', expected: '. Hello' },
    { selection: { anchor: 1, focus: 1 }, direction: 'forward', expected: '1 Hello' },
    { selection: { anchor: 2, focus: 2 }, direction: 'forward', expected: '1.Hello' }
  ];

  for (const fixture of cases) {
    const result = foundation.applyExactDeletion('1. Hello', fixture.selection, fixture.direction);
    assert.equal(result.source, fixture.expected);
    assert.equal(recognized(result.source).length, 0);
    assert.equal(result.transaction.transactionKind, 'exact-deletion');
    assert.equal(result.primaryEdits.length, 1);
  }

  assert.equal(
    foundation.applyExactDeletion('A\r\nB', { anchor: 3, focus: 3 }, 'backward').source,
    'AB'
  );
  assert.equal(
    foundation.applyExactDeletion('A\ud83e\udde0B', { anchor: 3, focus: 3 }, 'backward').source,
    'AB'
  );
});

test('certification: Tab means one leading Tab on only the recognized physical row at every caret column', () => {
  const source = '- parent\n\t- child\n\t\t- grandchild\n- sibling';
  const snapshot = foundation.createSourceSnapshot(source);
  const line = snapshot.physicalLineIndex.lines[1];
  const expected = '- parent\n\t\t- child\n\t\t- grandchild\n- sibling';

  for (let offset = line.start; offset <= line.contentEnd; offset += 1) {
    const result = foundation.applyEditableListIndentation(
      snapshot,
      { anchor: offset, focus: offset },
      'indent'
    );
    assert.equal(result.source, expected, `Tab varied at source offset ${offset}`);
    assert.deepEqual(bareEdits(result.primaryEdits), [
      { start: line.start, end: line.start, replacement: '\t' }
    ]);
    assert.equal(result.source.split('\n')[2], '\t\t- grandchild');
  }

  for (const ordinary of ['* item', '+ item', '1) item', ' 1. item']) {
    const result = foundation.applyEditableListIndentation(
      ordinary,
      { anchor: ordinary.length, focus: ordinary.length },
      'indent'
    );
    assert.equal(result.changed, false);
    assert.equal(result.source, ordinary);
  }
});

test('certification: Shift+Tab removes one leading Tab and root Shift+Tab is a no-op', () => {
  const nested = foundation.applyEditableListIndentation(
    '1. parent\n\t- child\n2. sibling',
    { anchor: 14, focus: 14 },
    'outdent'
  );
  assert.equal(nested.source, '1. parent\n- child\n2. sibling');
  assert.deepEqual(bareEdits(nested.primaryEdits), [
    { start: 10, end: 11, replacement: '' }
  ]);

  const root = foundation.applyEditableListIndentation(
    '- root',
    { anchor: 4, focus: 4 },
    'outdent'
  );
  assert.equal(root.changed, false);
  assert.equal(root.transaction, null);
  assert.equal(root.source, '- root');
});

test('certification: first-member ordered indent closes both destination and survivor sequences', () => {
  const result = foundation.applyEditableListIndentation(
    '007. A\n008. B\n009. C',
    { anchor: 0, focus: 0 },
    'indent'
  );
  assert.equal(result.source, '\t1. A\n7. B\n8. C');
  assert.deepEqual(bareEdits(result.primaryEdits), [
    { start: 0, end: 0, replacement: '\t' }
  ]);
  assert.deepEqual(result.renumberEdits.map(({ replacement }) => replacement), ['1', '7', '8']);
  assert.equal(result.transaction.transactionKind, 'list-tab');
  assert.equal(result.transaction.structural, true);
  assert.equal(result.transaction.listTransform, true);

  const later = foundation.applyEditableListIndentation(
    '3. A\n4. B\n5. C',
    { anchor: 8, focus: 8 },
    'indent'
  );
  assert.equal(later.source, '3. A\n\t1. B\n4. C');

  const joined = foundation.applyEditableListIndentation(
    '3. A\n\t7. child\n4. B\n5. C',
    { anchor: 18, focus: 18 },
    'indent'
  );
  assert.equal(joined.source, '3. A\n\t7. child\n\t8. B\n4. C');
  assert.equal(foundation.resolveOrderedSequences(joined.snapshot).changed, false,
    'the completed destination sequence must already be canonical');
});

test('certification: list Enter covers nonempty ordered/unordered and one-level empty ascent', () => {
  const ordered = foundation.applyEditableNewline('1. A', { anchor: 4, focus: 4 });
  assert.equal(ordered.source, '1. A\n2. ');
  assert.equal(ordered.selection.anchor, 8);
  assert.equal(ordered.transaction.transactionKind, 'list-enter-ordered');
  assert.deepEqual(bareEdits(ordered.primaryEdits), [
    { start: 4, end: 4, replacement: '\n1. ' }
  ]);
  assert.deepEqual(bareEdits(ordered.renumberEdits), [
    { start: 5, end: 6, replacement: '2' }
  ]);

  const unordered = foundation.applyEditableNewline('\t- A', { anchor: 4, focus: 4 });
  assert.equal(unordered.source, '\t- A\n\t- ');
  assert.equal(unordered.transaction.transactionKind, 'list-enter-unordered');

  const levelThree = foundation.applyEditableNewline('\t\t3. ', { anchor: 5, focus: 5 });
  assert.equal(levelThree.source, '\t3. ');
  assert.equal(recognized(levelThree.source)[0].depth, 2);
  const levelTwo = foundation.applyEditableNewline(
    levelThree.snapshot,
    { anchor: levelThree.source.length, focus: levelThree.source.length }
  );
  assert.equal(levelTwo.source, '3. ');
  assert.equal(recognized(levelTwo.source)[0].depth, 1);
});

test('certification: ordered marker-start Enter inserts an exact-prefix sibling transaction', () => {
  const single = foundation.applyEditableNewline(
    '2. 123123',
    { anchor: 0, focus: 0 }
  );
  assert.equal(single.source, '2. \n3. 123123');
  assert.deepEqual(bareEdits(single.primaryEdits), [
    { start: 0, end: 0, replacement: '2. \n' }
  ]);
  assert.deepEqual(bareEdits(single.renumberEdits), [
    { start: 4, end: 5, replacement: '3' }
  ]);
  assert.equal(single.transaction.transactionKind, 'list-enter-ordered');
  assert.equal(single.transaction.structural, true);
  assert.equal(single.transaction.listTransform, true);
  assert.doesNotMatch(single.source, /\\\./);
  assert.deepEqual(recognized(single.source).map((row) => [row.marker, row.content]), [
    ['2.', ''],
    ['3.', '123123']
  ]);

  const sequence = foundation.applyEditableNewline(
    '1. abc\n2. 123123\n3. xyz',
    { anchor: 7, focus: 7 }
  );
  assert.equal(sequence.source, '1. abc\n2. \n3. 123123\n4. xyz');
  assert.deepEqual(sequence.renumberEdits.map(({ replacement }) => replacement), ['3', '4']);
  assert.doesNotMatch(sequence.source, /\\\./);
});

test('certification: Enter on an empty root prefix leaves one canonical blank physical row', () => {
  for (const source of ['2. ', '- ']) {
    const result = foundation.applyEditableNewline(
      source,
      { anchor: source.length, focus: source.length }
    );
    assert.equal(result.source, '');
    assert.equal(result.snapshot.physicalLineIndex.lineCount, 1);
    assert.equal(result.snapshot.physicalLineIndex.lines[0].text, '');
    assert.equal(result.transaction.transactionKind, 'list-enter-empty-root');
  }
});

test('certification: completing an ordered prefix renumbers canonical source in one explicit transaction', () => {
  const source = '1. A\n2. B\n5 C';
  const result = foundation.applyCanonicalEdit(
    source,
    { anchor: 11, focus: 11 },
    { start: 11, end: 11, replacement: '.', kind: 'typed-character' },
    { transactionKind: 'insert-text', inputType: 'insertText' }
  );

  assert.equal(result.source, '1. A\n2. B\n3. C');
  assert.deepEqual(bareEdits(result.primaryEdits), [
    { start: 11, end: 11, replacement: '.' }
  ]);
  assert.deepEqual(bareEdits(result.renumberEdits), [
    { start: 10, end: 11, replacement: '3' }
  ]);
  assert.equal(result.transaction.beforeSource, source);
  assert.equal(result.transaction.afterSource, result.source);
  assert.equal(
    result.transaction.sourceVersionAfter,
    result.transaction.sourceVersionBefore + 1
  );
  assert.equal(result.transaction.transactionKind, 'insert-text');

  const idempotent = foundation.resolveOrderedSequences(result.source);
  assert.equal(idempotent.changed, false);
  assert.deepEqual(idempotent.edits, []);
});

test('certification: Shift+Enter is a literal line break, not list continuation', () => {
  const result = foundation.applyEditableNewline(
    '1. A',
    { anchor: 4, focus: 4 },
    { inputType: 'insertLineBreak', shiftKey: true }
  );
  assert.equal(result.source, '1. A\n');
  assert.equal(result.transaction.transactionKind, 'newline');
  assert.equal(result.primaryEdits[0].replacement, '\n');
});
