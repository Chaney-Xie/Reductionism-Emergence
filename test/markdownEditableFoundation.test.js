const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');
const markdown = require('../public/markdownPage');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function bareEdits(edits) {
  return edits.map(({ start, end, replacement }) => ({ start, end, replacement }));
}

test('SourceSnapshot owns one immutable exact PhysicalLineIndex', () => {
  const fixtures = [
    ['', [[0, 0, 0, '', '']]],
    ['A\nB', [[0, 1, 2, 'A', '\n'], [2, 3, 3, 'B', '']]],
    ['A\r\nB', [[0, 1, 3, 'A', '\r\n'], [3, 4, 4, 'B', '']]],
    ['\n\n', [[0, 0, 1, '', '\n'], [1, 1, 2, '', '\n'], [2, 2, 2, '', '']]],
    ['A\n', [[0, 1, 2, 'A', '\n'], [2, 2, 2, '', '']]]
  ];
  for (const [source, expected] of fixtures) {
    const snapshot = foundation.createSourceSnapshot(source, {
      parseMarkdown: (markdownBody) => ({
        type: 'root',
        position: { start: { offset: 0 }, end: { offset: markdownBody.length } },
        children: []
      })
    });
    assert.equal(snapshot.markdownBody, source);
    assert.equal(snapshot.PhysicalLineIndex, snapshot.physicalLineIndex);
    assert.deepEqual(
      snapshot.physicalLineIndex.lines.map((line) => [
        line.start, line.contentEnd, line.sourceEnd, line.text, line.lineEnding
      ]),
      expected
    );
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.physicalLineIndex), true);
    assert.equal(Object.isFrozen(snapshot.physicalLineIndex.lines), true);
    assert.equal(Object.isFrozen(snapshot.parserAst), true);
  }
});

test('snapshot versions advance once and unchanged physical rows retain identity', () => {
  const first = foundation.createSourceSnapshot('A\nB\nC');
  const second = foundation.createSourceSnapshot('A\nBee\nC', { previousSnapshot: first });
  assert.equal(second.version, first.version + 1);
  assert.equal(second.physicalLineIndex.lines[0].id, first.physicalLineIndex.lines[0].id);
  assert.equal(second.physicalLineIndex.lines[1].id, first.physicalLineIndex.lines[1].id);
  assert.equal(second.physicalLineIndex.lines[2].id, first.physicalLineIndex.lines[2].id);
  assert.equal(
    foundation.createSourceSnapshot(second.markdownBody, { previousSnapshot: second }),
    second
  );
});

test('EditablePosition resolves exact row, column, affinity, and hidden CRLF interior', () => {
  const snapshot = foundation.createSourceSnapshot('A\r\nB');
  assert.deepEqual(plain(foundation.createEditablePosition(snapshot, 0, 'after')), {
    sourceVersion: snapshot.version,
    offset: 0,
    affinity: 'after',
    physicalLineId: snapshot.physicalLineIndex.lines[0].id,
    physicalLineIndex: 0,
    logicalColumn: 0,
    semanticOwnerId: null,
    visibility: 'visible',
    interactionPolicy: 'editable'
  });
  assert.equal(foundation.createEditablePosition(snapshot, 2, 'after').visibility, 'structural-hidden');
  assert.equal(foundation.createEditablePosition(snapshot, 3, 'after').physicalLineIndex, 1);
  assert.equal(foundation.createEditablePosition(snapshot, 3, 'before').physicalLineIndex, 1);
});

test('visible selection normalization owns row boundaries, CRLF interiors, and Unicode offsets', () => {
  const cases = [
    {
      label: 'empty source',
      source: '',
      value: {},
      expected: { anchor: 0, focus: 0, anchorAffinity: 'after', focusAffinity: 'after' }
    },
    {
      label: 'final nonempty row end',
      source: 'Alpha',
      value: { anchor: 5, focus: 5, anchorAffinity: 'after', focusAffinity: 'after' },
      expected: { anchor: 5, focus: 5, anchorAffinity: 'before', focusAffinity: 'before' }
    },
    {
      label: 'nonfinal row end',
      source: 'Alpha\nBeta',
      value: { anchor: 5, focus: 5, anchorAffinity: 'after', focusAffinity: 'after' },
      expected: { anchor: 5, focus: 5, anchorAffinity: 'before', focusAffinity: 'before' }
    },
    {
      label: 'next row start',
      source: 'Alpha\nBeta',
      value: { anchor: 6, focus: 6, anchorAffinity: 'before', focusAffinity: 'before' },
      expected: { anchor: 6, focus: 6, anchorAffinity: 'after', focusAffinity: 'after' }
    },
    {
      label: 'terminal empty row',
      source: 'Alpha\n',
      value: { anchor: 6, focus: 6, anchorAffinity: 'before', focusAffinity: 'before' },
      expected: { anchor: 6, focus: 6, anchorAffinity: 'after', focusAffinity: 'after' }
    },
    {
      label: 'CRLF interior and boundary after a surrogate pair',
      source: 'A\r\n😀B',
      value: { anchor: 2, focus: 5, anchorAffinity: 'after', focusAffinity: 'before' },
      expected: { anchor: 1, focus: 5, anchorAffinity: 'before', focusAffinity: 'after' }
    },
    {
      label: 'surrogate interior with before affinity',
      source: 'A😀B',
      value: { anchor: 2, focus: 2, anchorAffinity: 'before', focusAffinity: 'before' },
      expected: { anchor: 1, focus: 1, anchorAffinity: 'after', focusAffinity: 'after' }
    },
    {
      label: 'surrogate interior with after affinity',
      source: 'A😀B',
      value: { anchor: 2, focus: 2, anchorAffinity: 'after', focusAffinity: 'after' },
      expected: { anchor: 3, focus: 3, anchorAffinity: 'after', focusAffinity: 'after' }
    }
  ];

  for (const fixture of cases) {
    const normalized = foundation.normalizeVisibleSelection(fixture.source, fixture.value);
    assert.deepEqual(normalized, fixture.expected, fixture.label);
    assert.equal(Object.isFrozen(normalized), true, `${fixture.label}: immutable result`);
  }

  assert.deepEqual(foundation.normalizeVisibleSelection('Alpha'), {
    anchor: 5,
    focus: 5,
    anchorAffinity: 'before',
    focusAffinity: 'before'
  }, 'an omitted selection defaults to the visible source end, not offset zero');

  assert.deepEqual(foundation.exactDeletionRange('A😀B', 3, 'backward'), {
    start: 1,
    end: 3
  }, 'Backspace owns the complete surrogate pair');
  assert.deepEqual(foundation.exactDeletionRange('A😀B', 1, 'forward'), {
    start: 1,
    end: 3
  }, 'Delete owns the complete surrogate pair');
  assert.deepEqual(foundation.exactDeletionRange('A😀B', 2, 'backward'), {
    start: 1,
    end: 3
  }, 'Backspace from a surrogate interior still owns the complete code point');
  assert.deepEqual(foundation.exactDeletionRange('A😀B', 2, 'forward'), {
    start: 1,
    end: 3
  }, 'Delete from a surrogate interior still owns the complete code point');
  assert.deepEqual(foundation.exactDeletionRange('A\r\nB', 3, 'backward'), {
    start: 1,
    end: 3
  }, 'Backspace owns the complete CRLF');
  assert.deepEqual(foundation.exactDeletionRange('A\r\nB', 1, 'forward'), {
    start: 1,
    end: 3
  }, 'Delete owns the complete CRLF');
});

test('editable list grammar is deliberately strict and fenced code is masked', () => {
  const source = [
    '1. ordered',
    '12. ordered',
    '\t- nested',
    '\t\t3. deep',
    ' 1. space is ordinary',
    '1) ordinary',
    '* ordinary',
    '+ ordinary',
    '> 1. quoted ordered is ordinary',
    '> - quoted unordered is ordinary',
    '-valid-without-space',
    '1.invalid',
    '```md',
    '1. fenced ordinary',
    '```'
  ].join('\n');
  const scan = foundation.createSourceSnapshot(source).editableListSemanticIndex;
  assert.deepEqual(scan.rows.map((row) => ({
    line: row.lineIndex,
    kind: row.kind,
    depth: row.depth,
    marker: row.marker,
    content: row.content
  })), [
    { line: 0, kind: 'ordered', depth: 1, marker: '1.', content: 'ordered' },
    { line: 1, kind: 'ordered', depth: 1, marker: '12.', content: 'ordered' },
    { line: 2, kind: 'unordered', depth: 2, marker: '-', content: 'nested' },
    { line: 3, kind: 'ordered', depth: 3, marker: '3.', content: 'deep' }
  ]);
});

test('OrderedSequenceResolver is the sole pure idempotent digit owner', () => {
  const source = [
    '1. A',
    '9. B',
    '\t4. child',
    '\t8. child two',
    '7. C',
    '- break same depth',
    '12. new ordered run',
    '19. next'
  ].join('\n');
  const first = foundation.resolveOrderedSequences(source);
  assert.equal(first.source, [
    '1. A',
    '2. B',
    '\t4. child',
    '\t5. child two',
    '3. C',
    '- break same depth',
    '12. new ordered run',
    '13. next'
  ].join('\n'));
  const second = foundation.resolveOrderedSequences(first.source);
  assert.equal(second.source, first.source);
  assert.equal(second.changed, false);
  assert.deepEqual(second.edits, []);
});

test('exact deletion removes ordinary marker characters and immediately rescans syntax', () => {
  const period = foundation.applyExactDeletion('1. Hello', { anchor: 2, focus: 2 }, 'backward');
  assert.equal(period.source, '1 Hello');
  assert.equal(period.selection.anchor, 1);
  assert.equal(period.snapshot.editableListSemanticIndex.rows.length, 0);

  const space = foundation.applyExactDeletion('1. Hello', { anchor: 3, focus: 3 }, 'backward');
  assert.equal(space.source, '1.Hello');
  assert.equal(space.snapshot.editableListSemanticIndex.rows.length, 0);

  const digit = foundation.applyExactDeletion('1. Hello', { anchor: 1, focus: 1 }, 'backward');
  assert.equal(digit.source, '. Hello');
  assert.equal(digit.snapshot.editableListSemanticIndex.rows.length, 0);

  assert.equal(
    foundation.applyExactDeletion('A\r\nB', { anchor: 3, focus: 3 }, 'backward').source,
    'AB'
  );
});

test('Tab and Shift+Tab move exactly one recognized physical line', () => {
  const source = '1. A\n2. B\n3. C';
  for (const column of [5, 6, 7, 8]) {
    const result = foundation.applyEditableListIndentation(
      source,
      { anchor: column, focus: column },
      'indent'
    );
    assert.equal(result.source, '1. A\n\t1. B\n2. C');
    assert.equal(result.primaryEdits.length, 1);
    assert.deepEqual(
      { start: result.primaryEdits[0].start, end: result.primaryEdits[0].end,
        replacement: result.primaryEdits[0].replacement },
      { start: 5, end: 5, replacement: '\t' }
    );
    assert.equal(result.transaction.transactionKind, 'list-tab');
  }

  const outdent = foundation.applyEditableListIndentation(
    '1. A\n\t1. B\n2. C',
    { anchor: 9, focus: 9 },
    'outdent'
  );
  assert.equal(outdent.source, '1. A\n2. B\n3. C');
  const rootNoOp = foundation.applyEditableListIndentation(
    '- A',
    { anchor: 2, focus: 2 },
    'outdent'
  );
  assert.equal(rootNoOp.changed, false);
  assert.equal(rootNoOp.source, '- A');

  const lookalike = foundation.applyEditableListIndentation(
    '* ordinary',
    { anchor: 5, focus: 5 },
    'indent'
  );
  assert.equal(lookalike.changed, false);
});

test('indenting the first ordered member renumbers its surviving source sequence structurally', () => {
  const fixtures = [
    {
      source: '1. A\n2. B\n3. C',
      expected: '\t1. A\n1. B\n2. C',
      renumbered: ['1', '2']
    },
    {
      source: '3. A\n4. B\n5. C',
      expected: '\t1. A\n3. B\n4. C',
      renumbered: ['1', '3', '4']
    },
    {
      source: '0. A\n1. B\n2. C',
      expected: '\t1. A\n0. B\n1. C',
      renumbered: ['1', '0', '1']
    },
    {
      source: '007. A\n008. B\n009. C',
      expected: '\t1. A\n7. B\n8. C',
      renumbered: ['1', '7', '8']
    }
  ];

  for (const fixture of fixtures) {
    const result = foundation.applyEditableListIndentation(
      fixture.source,
      { anchor: 0, focus: 0 },
      'indent'
    );
    assert.equal(result.source, fixture.expected, fixture.source);
    assert.deepEqual(bareEdits(result.primaryEdits), [
      { start: 0, end: 0, replacement: '\t' }
    ], fixture.source);
    assert.deepEqual(
      result.renumberEdits.map(({ replacement }) => replacement),
      fixture.renumbered,
      fixture.source
    );
    assert.deepEqual(
      result.snapshot.editableListSemanticIndex.rows.map((row) => [
        row.tabs, row.marker, row.content, row.orderedSequencePosition
      ]),
      [
        ['\t', '1.', 'A', 0],
        ['', fixture.expected.split('\n')[1].split(' ')[0], 'B', 0],
        ['', fixture.expected.split('\n')[2].split(' ')[0], 'C', 1]
      ],
      fixture.source
    );
  }

  const later = foundation.applyEditableListIndentation(
    '3. A\n4. B\n5. C',
    { anchor: 8, focus: 8 },
    'indent'
  );
  assert.equal(later.source, '3. A\n\t1. B\n4. C');
  assert.deepEqual(later.renumberEdits.map(({ replacement }) => replacement), ['1', '4']);

  for (const fixture of [
    {
      source: '1. A\n\t1. child\n2. B\n3. C',
      expected: '1. A\n\t1. child\n\t2. B\n2. C'
    },
    {
      source: '3. A\n\t7. child\n4. B\n5. C',
      expected: '3. A\n\t7. child\n\t8. B\n4. C'
    }
  ]) {
    const joinedDestination = foundation.applyEditableListIndentation(
      fixture.source,
      { anchor: fixture.source.indexOf('B'), focus: fixture.source.indexOf('B') },
      'indent'
    );
    assert.equal(joinedDestination.source, fixture.expected);
    const immediateResolution = foundation.resolveOrderedSequences(joinedDestination.snapshot);
    assert.equal(immediateResolution.changed, false,
      'a closed list command must be idempotent under its canonical resolver');
    assert.deepEqual(immediateResolution.edits, []);
  }
});

test('Enter implements the three strict list transactions and Shift+Enter stays literal', () => {
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
  assert.equal(ordered.renumberEdits[0].kind, 'ordered-sequence-renumber');

  const nonOneStart = foundation.applyEditableNewline('5. A', { anchor: 4, focus: 4 });
  assert.equal(nonOneStart.source, '5. A\n6. ');
  assert.equal(nonOneStart.primaryEdits[0].replacement, '\n1. ');
  assert.equal(nonOneStart.renumberEdits[0].replacement, '6');

  const unordered = foundation.applyEditableNewline('\t- A', { anchor: 4, focus: 4 });
  assert.equal(unordered.source, '\t- A\n\t- ');

  const nestedEmpty = foundation.applyEditableNewline(
    '1. parent\n\t2. ',
    { anchor: 14, focus: 14 }
  );
  assert.equal(nestedEmpty.source, '1. parent\n2. ');
  assert.equal(nestedEmpty.transaction.transactionKind, 'list-enter-empty-nested');

  const rootEmpty = foundation.applyEditableNewline('2. ', { anchor: 3, focus: 3 });
  assert.equal(rootEmpty.source, '');
  assert.equal(rootEmpty.snapshot.physicalLineIndex.lineCount, 1);
  assert.equal(rootEmpty.transaction.transactionKind, 'list-enter-empty-root');

  const shifted = foundation.applyEditableNewline('1. A', { anchor: 4, focus: 4 }, {
    inputType: 'insertLineBreak'
  });
  assert.equal(shifted.source, '1. A\n');
});

test('ordered Enter distinguishes marker-start boundary from marker, gap, and content carets', () => {
  const source = '2. 123123';
  const boundary = foundation.applyEditableNewline(source, { anchor: 0, focus: 0 });
  assert.equal(boundary.source, '2. \n3. 123123');
  assert.deepEqual(boundary.selection, {
    anchor: 3,
    focus: 3,
    anchorAffinity: 'before',
    focusAffinity: 'before'
  });
  assert.deepEqual(bareEdits(boundary.primaryEdits), [
    { start: 0, end: 0, replacement: '2. \n' }
  ]);
  assert.equal(boundary.primaryEdits[0].kind, 'ordered-list-boundary-sibling');
  assert.deepEqual(bareEdits(boundary.renumberEdits), [
    { start: 4, end: 5, replacement: '3' }
  ]);
  assert.doesNotMatch(boundary.source, /\\\./);
  assert.deepEqual(
    boundary.snapshot.editableListSemanticIndex.rows.map((row) => [
      row.marker, row.content, row.orderedSequencePosition
    ]),
    [['2.', '', 0], ['3.', '123123', 1]]
  );

  const controls = [
    [1, '2\n1. . 123123', 5, 'list-continuation'],
    [2, '2.\n1.  123123', 6, 'list-continuation'],
    [3, '2. \n3. 123123', 7, 'list-continuation'],
    [6, '2. 123\n3. 123', 10, 'list-continuation'],
    [9, '2. 123123\n3. ', 13, 'list-continuation']
  ];
  for (const [offset, expected, caret, kind] of controls) {
    const result = foundation.applyEditableNewline(source, { anchor: offset, focus: offset });
    assert.equal(result.source, expected, `caret ${offset}`);
    assert.equal(result.selection.anchor, caret, `caret ${offset}`);
    assert.equal(result.selection.focus, caret, `caret ${offset}`);
    assert.equal(result.primaryEdits[0].kind, kind, `caret ${offset}`);
  }

  const sequence = '1. abc\n2. 123123\n3. xyz';
  const inserted = foundation.applyEditableNewline(sequence, { anchor: 7, focus: 7 });
  assert.equal(inserted.source, '1. abc\n2. \n3. 123123\n4. xyz');
  assert.equal(inserted.selection.anchor, 10);
  assert.deepEqual(bareEdits(inserted.primaryEdits), [
    { start: 7, end: 7, replacement: '2. \n' }
  ]);
  assert.deepEqual(inserted.renumberEdits.map(({ replacement }) => replacement), ['3', '4']);
  assert.deepEqual(
    inserted.snapshot.editableListSemanticIndex.rows.map((row) => [
      row.marker, row.content, row.orderedSequencePosition
    ]),
    [['1.', 'abc', 0], ['2.', '', 1], ['3.', '123123', 2], ['4.', 'xyz', 3]]
  );
  assert.doesNotMatch(inserted.source, /\\\./);
});

test('newline transactions place a row-end BEFORE caret after inserted source', () => {
  const beforeEnd = {
    anchor: { offset: 4, affinity: 'before' },
    focus: { offset: 4, affinity: 'before' }
  };
  const ordered = foundation.applyEditableNewline('1. A', beforeEnd);
  assert.equal(ordered.source, '1. A\n2. ');
  assert.deepEqual(ordered.selection, {
    anchor: 8,
    focus: 8,
    anchorAffinity: 'before',
    focusAffinity: 'before'
  });

  const quote = markdown.applyMarkdownNewline('>> Quote', {
    anchor: { offset: 8, affinity: 'before' },
    focus: { offset: 8, affinity: 'before' }
  });
  assert.equal(quote.source, '>> Quote\n>> ');
  assert.equal(quote.selection.anchor, 12);
  assert.equal(quote.selection.focus, 12);
  assert.equal(quote.selection.anchorAffinity, 'before');
  assert.equal(quote.selection.focusAffinity, 'before');

  const plain = foundation.applyEditableNewline('A', {
    anchor: { offset: 1, affinity: 'before' },
    focus: { offset: 1, affinity: 'before' }
  });
  assert.equal(plain.source, 'A\n');
  assert.equal(plain.selection.anchor, 2);
  assert.equal(plain.selection.anchorAffinity, 'after');
});

test('quote-contained list lookalikes retain only generic quote continuation', () => {
  for (const source of ['> 1. A', '> - A']) {
    const result = markdown.applyMarkdownNewline(source, {
      anchor: source.length,
      focus: source.length
    });
    assert.equal(result.source, `${source}\n> `);
    assert.equal(result.editKind, 'quote-continuation');
    assert.equal(result.transaction.transactionKind, 'quote-continuation');
    assert.equal(result.renumberEdits.length, 0);
  }
});

test('prefix completion and renumber edits are one explicit canonical transaction', () => {
  const source = '1. A\n2. B\n5 C';
  const result = foundation.applyCanonicalEdit(
    source,
    { anchor: 11, focus: 11 },
    { start: 11, end: 11, replacement: '.', kind: 'typed-character' },
    { transactionKind: 'insert-text', inputType: 'insertText' }
  );
  assert.equal(result.source, '1. A\n2. B\n3. C');
  assert.equal(result.primaryEdits.length, 1);
  assert.equal(result.renumberEdits.length, 1);
  assert.equal(result.transaction.beforeSource, source);
  assert.equal(result.transaction.afterSource, result.source);
  assert.equal(result.transaction.sourceVersionAfter, result.transaction.sourceVersionBefore + 1);
  assert.equal(result.transaction.transactionKind, 'insert-text');
});

test('canonical post-primary gate detects a row-end blank split at ordered depths one through three', () => {
  for (let depth = 1; depth <= 3; depth += 1) {
    const tabs = '\t'.repeat(depth - 1);
    const source = [
      `${tabs}1. A`,
      `${tabs}2. B`,
      `${tabs}9. C`
    ].join('\n');
    const snapshot = foundation.createSourceSnapshot(source);
    const splitOffset = snapshot.physicalLineIndex.lines[0].contentEnd;
    const result = foundation.applyCanonicalEdit(
      snapshot,
      { anchor: splitOffset, focus: splitOffset },
      {
        start: splitOffset,
        end: splitOffset,
        replacement: '\n',
        kind: 'ordinary-row-end-insert'
      },
      { transactionKind: 'insert-text', inputType: 'insertText' }
    );

    assert.equal(result.source, [
      `${tabs}1. A`,
      '',
      `${tabs}2. B`,
      `${tabs}3. C`
    ].join('\n'), `depth ${depth}`);
    assert.deepEqual(bareEdits(result.primaryEdits), [
      { start: splitOffset, end: splitOffset, replacement: '\n' }
    ], `depth ${depth}`);
    assert.deepEqual(result.renumberEdits.map(({ replacement }) => replacement), ['3']);
    assert.equal(result.transaction.beforeSource, source);
    assert.equal(result.transaction.afterSource, result.source);
    assert.equal(
      result.transaction.sourceVersionAfter,
      result.transaction.sourceVersionBefore + 1
    );
  }
});

test('canonical post-primary gate normalizes joined ordered runs at depths one through three', () => {
  for (let depth = 1; depth <= 3; depth += 1) {
    const tabs = '\t'.repeat(depth - 1);
    const source = [
      `${tabs}1. A`,
      '',
      `${tabs}7. B`,
      `${tabs}8. C`
    ].join('\n');
    const snapshot = foundation.createSourceSnapshot(source);
    const blank = snapshot.physicalLineIndex.lines[1];
    const result = foundation.applyCanonicalEdit(
      snapshot,
      { anchor: blank.start, focus: blank.sourceEnd },
      {
        start: blank.start,
        end: blank.sourceEnd,
        replacement: '',
        kind: 'ordinary-boundary-delete'
      },
      { transactionKind: 'delete-by-cut', inputType: 'deleteByCut' }
    );

    assert.equal(result.source, [
      `${tabs}1. A`,
      `${tabs}2. B`,
      `${tabs}3. C`
    ].join('\n'), `depth ${depth}`);
    assert.deepEqual(result.renumberEdits.map(({ replacement }) => replacement), ['2', '3']);
    assert.equal(result.transaction.primaryEdits.length, 1);
    assert.equal(result.transaction.renumberEdits.length, 2);
  }
});

test('ordinary paragraph insertion participates in sequence membership without global opportunistic repair', () => {
  const source = '1. A\n2. B\n9. C';
  const snapshot = foundation.createSourceSnapshot(source);
  const boundary = snapshot.physicalLineIndex.lines[0].contentEnd;
  const separated = foundation.applyCanonicalEdit(
    snapshot,
    { anchor: boundary, focus: boundary },
    {
      start: boundary,
      end: boundary,
      replacement: '\nparagraph',
      kind: 'ordinary-text-insert'
    },
    { transactionKind: 'insert-text', inputType: 'insertText' }
  );
  assert.equal(separated.source, '1. A\nparagraph\n2. B\n3. C');
  assert.deepEqual(separated.renumberEdits.map(({ replacement }) => replacement), ['3']);

  const unrelatedSource = '1. A\n9. B\n\nordinary';
  const ordinaryOffset = unrelatedSource.indexOf('ry');
  const unrelated = foundation.applyCanonicalEdit(
    unrelatedSource,
    { anchor: ordinaryOffset, focus: ordinaryOffset },
    {
      start: ordinaryOffset,
      end: ordinaryOffset,
      replacement: '!',
      kind: 'ordinary-text-insert'
    },
    { transactionKind: 'insert-text', inputType: 'insertText' }
  );
  assert.equal(unrelated.source, '1. A\n9. B\n\nordina!ry');
  assert.deepEqual(unrelated.renumberEdits, []);
});

test('ordered-row content edits normalize the affected run in the same canonical transaction', () => {
  const source = '1. A\n9. B';
  const editOffset = source.length;
  const result = foundation.applyCanonicalEdit(
    source,
    { anchor: editOffset, focus: editOffset },
    {
      start: editOffset,
      end: editOffset,
      replacement: '!',
      kind: 'ordered-row-content-insert'
    },
    { transactionKind: 'insert-text', inputType: 'insertText' }
  );

  assert.equal(result.source, '1. A\n2. B!');
  assert.deepEqual(bareEdits(result.primaryEdits), [
    { start: editOffset, end: editOffset, replacement: '!' }
  ]);
  assert.deepEqual(result.renumberEdits.map(({ replacement }) => replacement), ['2']);
  assert.equal(result.transaction.beforeSource, source);
  assert.equal(result.transaction.afterSource, result.source);
  assert.equal(result.transaction.primaryEdits.length, 1);
  assert.equal(result.transaction.renumberEdits.length, 1);
  assert.equal(
    result.transaction.sourceVersionAfter,
    result.transaction.sourceVersionBefore + 1
  );
});
