'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const view = loadMarkdownPageViewInternals([
  'semanticSyntaxSegments',
  'renderSemanticBlockContents'
]);

function bareEdits(edits) {
  return edits.map(({ start, end, replacement }) => ({ start, end, replacement }));
}

function plannedSource(snapshot, plan) {
  return plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('').slice(0, snapshot.markdownBody.length);
}

function editableModeEvidence(source) {
  const snapshot = markdown.createSourceSnapshot(source);
  return ['source', 'live-preview'].map((mode) => {
    const plan = buildEditablePresentationPlan(snapshot, { model: markdown, mode });
    const validation = validateEditablePresentationPlan(plan, snapshot);
    assert.equal(validation.ok, true, `${mode}: ${validation.errors.join('\n')}`);
    assert.equal(plannedSource(snapshot, plan), source, `${mode}: source reconstruction`);
    return {
      mode,
      orderedMarkers: plan.constructs.orderedListMarkers.map((marker) => marker.raw)
    };
  });
}

function readingTopology(source) {
  const snapshot = markdown.createSourceSnapshot(source);
  const rendered = renderSemanticSegments(view, source, {
    mode: 'reading',
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version
  });
  const elements = rendered.blocks
    .flatMap((block) => descendants(block.element))
    .filter((node) => node?.nodeType === 1);
  const lists = elements.filter((node) => node.classList.contains('markdown-page-list'));
  const items = elements.filter((node) => node.classList.contains('markdown-page-list-item'));
  return {
    lists: lists.map((list) => ({ tagName: list.tagName, text: list.textContent })),
    items: items.map((item) => ({
      text: item.textContent,
      depth: lists.filter((list) => list.contains(item)).length
    }))
  };
}

function assertOneHistoryAction(before, result) {
  const history = view.createMarkdownEditHistory(before);
  assert.equal(view.recordMarkdownEditTransaction(history, {
    ...result.transaction,
    timestamp: 100
  }, { coalesce: false }), true);
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.redoStack.length, 0);

  const undo = view.stepMarkdownEditHistory(history, 'undo', result.source);
  assert.equal(undo.source, before);
  assert.deepEqual({ ...undo.selection }, { ...result.transaction.beforeSelection });
  const redo = view.stepMarkdownEditHistory(history, 'redo', before);
  assert.equal(redo.source, result.source);
  assert.deepEqual({ ...redo.selection }, { ...result.transaction.afterSelection });
  assert.equal(view.stepMarkdownEditHistory(history, 'redo', result.source), null);
}

test('first-member indent carries the old sequence start through its physical survivor', () => {
  const fixtures = [
    { start: '1', next: '2', expected: ['1', '2'] },
    { start: '3', next: '4', expected: ['3', '4'] },
    { start: '0', next: '1', expected: ['0', '1'] },
    { start: '007', next: '008', expected: ['7', '8'] }
  ];

  for (const fixture of fixtures) {
    const before = [
      '- parent',
      `${fixture.start}. A`,
      `${fixture.next}. B`,
      `${Number(fixture.next) + 1}. C`
    ].join('\n');
    const snapshot = markdown.createSourceSnapshot(before);
    const moved = snapshot.editableListSemanticIndex.rows.find((row) => row.content === 'A');
    assert.equal(moved.orderedSequencePosition, 0, `${fixture.start}: structural first member`);

    const result = markdown.applyMarkdownIndentation(before, {
      anchor: moved.contentStart,
      focus: moved.contentStart
    }, 'indent');
    const expected = [
      '- parent',
      '\t1. A',
      `${fixture.expected[0]}. B`,
      `${fixture.expected[1]}. C`
    ].join('\n');

    assert.equal(result.source, expected, `${fixture.start}: closed source and destination sequences`);
    assert.equal(result.transaction.transactionKind, 'list-tab');
    assert.equal(result.primaryEdits.length, 1);
    assert.equal(result.snapshot.editableListSemanticIndex.rows.find((row) => (
      row.content === 'B'
    )).orderedSequencePosition, 0);
    assert.equal(result.source.includes('008. B'), false,
      'command-driven renumbering may normalize leading-zero spelling');
  }
});

test('first-member indent keeps descendants with their existing physical rows and closes both runs', () => {
  const before = [
    '- parent',
    '3. A',
    '\t1. child',
    '4. B',
    '5. C'
  ].join('\n');
  const moved = markdown.createSourceSnapshot(before)
    .editableListSemanticIndex.rows.find((row) => row.content === 'A');
  const result = markdown.applyMarkdownIndentation(before, {
    anchor: moved.contentStart,
    focus: moved.contentStart
  }, 'indent');

  assert.equal(result.source, [
    '- parent',
    '\t1. A',
    '\t2. child',
    '3. B',
    '4. C'
  ].join('\n'));
  assert.deepEqual(result.snapshot.editableListSemanticIndex.orderedSequences.map((sequence) => ({
    depth: sequence.depth,
    start: sequence.startNumber,
    contents: sequence.rows.map((row) => row.content)
  })), [
    { depth: 2, start: 1, contents: ['A', 'child'] },
    { depth: 1, start: 3, contents: ['B', 'C'] }
  ]);

  const later = markdown.applyMarkdownIndentation('1. A\n2. B\n3. C', {
    anchor: 8,
    focus: 8
  }, 'indent');
  assert.equal(later.source, '1. A\n\t1. B\n2. C', 'known-good later-member behavior is unchanged');

  const joinBefore = '3. A\n\t7. child\n4. B\n5. C';
  const joinRow = markdown.createSourceSnapshot(joinBefore)
    .editableListSemanticIndex.rows.find((row) => row.content === 'B');
  const joined = markdown.applyMarkdownIndentation(joinBefore, {
    anchor: joinRow.contentStart,
    focus: joinRow.contentStart
  }, 'indent');
  assert.equal(joined.source, '3. A\n\t7. child\n\t8. B\n4. C',
    'a moved row joins the existing destination sequence instead of restarting it');
  assert.equal(markdown.resolveOrderedSequences(joined.snapshot).changed, false,
    'the completed command is a fixed point of the same canonical resolver');
  assert.deepEqual(joined.snapshot.editableListSemanticIndex.orderedSequences.map((sequence) => ({
    depth: sequence.depth,
    start: sequence.startNumber,
    contents: sequence.rows.map((row) => row.content)
  })), [
    { depth: 1, start: 3, contents: ['A', 'C'] },
    { depth: 2, start: 7, contents: ['child', 'B'] }
  ]);

  const outdentBefore = '1. parent\n\t3. A\n\t4. B\n2. next';
  const outdentRow = markdown.createSourceSnapshot(outdentBefore)
    .editableListSemanticIndex.rows.find((row) => row.content === 'A');
  const outdent = markdown.applyMarkdownIndentation(outdentBefore, {
    anchor: outdentRow.contentStart,
    focus: outdentRow.contentStart
  }, 'outdent');
  assert.equal(outdent.source, '1. parent\n2. A\n\t3. B\n3. next',
    'moving a nested first member retains the truncated old nested sequence start');

  const dissolveBefore = '1. parent\n\t3. A\n2. next';
  const dissolveRow = markdown.createSourceSnapshot(dissolveBefore)
    .editableListSemanticIndex.rows.find((row) => row.content === 'A');
  const dissolved = markdown.applyMarkdownIndentation(dissolveBefore, {
    anchor: dissolveRow.contentStart,
    focus: dissolveRow.contentStart
  }, 'outdent');
  assert.equal(dissolved.source, '1. parent\n2. A\n3. next');
  assert.deepEqual(dissolved.snapshot.editableListSemanticIndex.orderedSequences.map((sequence) => ({
    depth: sequence.depth,
    start: sequence.startNumber,
    contents: sequence.rows.map((row) => row.content)
  })), [
    { depth: 1, start: 1, contents: ['parent', 'A', 'next'] }
  ], 'the single-member nested sequence is fully dissolved in the post-command index');
});

test('marker-start Enter inserts an exact-prefix sibling and never demotes marker bytes', () => {
  const single = markdown.applyMarkdownNewline('2. 123123', { anchor: 0, focus: 0 });
  assert.equal(single.source, '2. \n3. 123123');
  assert.equal(single.selection.anchor, 3);
  assert.deepEqual(bareEdits(single.primaryEdits), [
    { start: 0, end: 0, replacement: '2. \n' }
  ]);
  assert.deepEqual(bareEdits(single.renumberEdits), [
    { start: 4, end: 5, replacement: '3' }
  ]);
  assert.equal(single.primaryEdits[0].kind, 'ordered-list-boundary-sibling');
  assert.equal(single.source.includes('\\.'), false);
  assert.deepEqual(single.snapshot.editableListSemanticIndex.rows.map((row) => ({
    marker: row.marker,
    content: row.content,
    position: row.orderedSequencePosition
  })), [
    { marker: '2.', content: '', position: 0 },
    { marker: '3.', content: '123123', position: 1 }
  ]);

  const nestedBefore = '\t7. nested\n\t8. tail';
  const nestedRow = markdown.createSourceSnapshot(nestedBefore)
    .editableListSemanticIndex.rows[0];
  for (const offset of [nestedRow.start, nestedRow.markerStart]) {
    const nested = markdown.applyMarkdownNewline(nestedBefore, {
      anchor: offset,
      focus: offset
    });
    assert.equal(nested.source, '\t7. \n\t8. nested\n\t9. tail',
      `nested structural boundary at ${offset}`);
    assert.equal(nested.selection.anchor, nestedRow.contentStart);
    assert.equal(nested.source.includes('\\.'), false);
  }

  const before = '1. abc\n2. 123123\n3. xyz';
  const offset = before.indexOf('2. 123123');
  const sequence = markdown.applyMarkdownNewline(before, { anchor: offset, focus: offset });
  assert.equal(sequence.source, '1. abc\n2. \n3. 123123\n4. xyz');
  assert.deepEqual(sequence.snapshot.editableListSemanticIndex.orderedRows.map((row) => [
    row.marker,
    row.content,
    row.orderedSequencePosition
  ]), [
    ['1.', 'abc', 0],
    ['2.', '', 1],
    ['3.', '123123', 2],
    ['4.', 'xyz', 3]
  ]);
  assert.equal(sequence.source.includes('2\\.'), false);
});

test('corrected canonical commands agree in Source, Live, Reading, and one-step history', () => {
  const indentBefore = '- parent\n3. A\n4. B\n5. C';
  const indent = markdown.applyMarkdownIndentation(indentBefore, {
    anchor: indentBefore.indexOf('A'),
    focus: indentBefore.indexOf('A')
  }, 'indent');
  assert.equal(indent.source, '- parent\n\t1. A\n3. B\n4. C');
  for (const evidence of editableModeEvidence(indent.source)) {
    assert.deepEqual(evidence.orderedMarkers, ['\t1. ', '3. ', '4. '], evidence.mode);
  }
  const indentReading = readingTopology(indent.source);
  assert.deepEqual(indentReading.lists.map((list) => list.tagName), ['UL', 'OL', 'OL']);
  assert.deepEqual(indentReading.items.map((item) => item.depth), [1, 2, 1, 1]);
  assertOneHistoryAction(indentBefore, indent);

  const enterBefore = '1. abc\n2. 123123\n3. xyz';
  const markerStart = enterBefore.indexOf('2. 123123');
  const enter = markdown.applyMarkdownNewline(enterBefore, {
    anchor: markerStart,
    focus: markerStart
  });
  for (const evidence of editableModeEvidence(enter.source)) {
    assert.deepEqual(evidence.orderedMarkers, ['1. ', '2. ', '3. ', '4. '], evidence.mode);
  }
  const enterReading = readingTopology(enter.source);
  assert.deepEqual(enterReading.lists.map((list) => list.tagName), ['OL']);
  assert.deepEqual(enterReading.items.map((item) => item.depth), [1, 1, 1, 1]);
  assertOneHistoryAction(enterBefore, enter);
});
