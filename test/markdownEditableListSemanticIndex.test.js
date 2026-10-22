'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const foundation = require('../public/markdownEditableFoundation');
const markdown = require('../public/markdownPage');
const adapters = require('../public/js/markdownEditableSyntaxAdapters');
const { loadMarkdownPageViewInternals } = require('./helpers/markdownFakeDom');
const corpus = require('./fixtures/markdownEditableListSemanticIndexCorpus.json');

function legacyFenceMask(snapshot) {
  const fenced = new Set();
  let open = null;
  snapshot.physicalLineIndex.lines.forEach((line) => {
    if (!open) {
      const match = line.text.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!match) return;
      open = { character: match[1][0], length: match[1].length };
      fenced.add(line.index);
      return;
    }
    fenced.add(line.index);
    const closing = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (closing && closing[1][0] === open.character
      && closing[1].length >= open.length) open = null;
  });
  return fenced;
}

function legacyStrictRows(snapshot) {
  const fenced = legacyFenceMask(snapshot);
  return snapshot.physicalLineIndex.lines.flatMap((line) => {
    if (fenced.has(line.index)) return [];
    const match = line.text.match(/^(\t*)(?:(\d+)\. |(-) )(.*)$/);
    if (!match) return [];
    const ordered = match[2] !== undefined;
    const markerStart = line.start + match[1].length;
    const markerEnd = markerStart + (ordered ? match[2].length + 1 : 1);
    const contentStart = markerEnd + 1;
    const content = snapshot.markdownBody.slice(contentStart, line.contentEnd);
    const taskMatch = ordered ? null : content.match(/^\[([ xX])\] (.*)$/);
    return [{
      lineIndex: line.index,
      start: line.start,
      end: line.contentEnd,
      prefixStart: line.start,
      prefixEnd: contentStart,
      markerStart,
      markerEnd,
      contentStart,
      contentEnd: line.contentEnd,
      kind: ordered ? 'ordered' : 'unordered',
      depth: match[1].length + 1,
      marker: ordered ? `${match[2]}.` : '-',
      number: ordered ? Number(match[2]) : null,
      task: taskMatch !== null,
      checked: taskMatch ? taskMatch[1].toLowerCase() === 'x' : null,
      taskTokenStart: taskMatch ? contentStart : null,
      taskTokenEnd: taskMatch ? contentStart + 3 : null,
      content
    }];
  });
}

function comparableRow(row) {
  return {
    lineIndex: row.lineIndex,
    start: row.start,
    end: row.end,
    prefixStart: row.prefixStart,
    prefixEnd: row.prefixEnd,
    markerStart: row.markerStart,
    markerEnd: row.markerEnd,
    contentStart: row.contentStart,
    contentEnd: row.contentEnd,
    kind: row.kind,
    depth: row.depth,
    marker: row.marker,
    number: row.number,
    task: row.task,
    checked: row.checked,
    taskTokenStart: row.taskTokenStart,
    taskTokenEnd: row.taskTokenEnd,
    content: row.content
  };
}

test('SourceSnapshot owns one immutable EditableListSemanticIndex for the dedicated corpus', () => {
  corpus.forEach((fixture) => {
    const snapshot = markdown.createSourceSnapshot(fixture.source);
    const index = snapshot.editableListSemanticIndex;
    assert.equal(snapshot.EditableListSemanticIndex, index, fixture.id);
    assert.equal(Object.isFrozen(index), true, fixture.id);
    assert.equal(Object.isFrozen(index.rows), true, fixture.id);
    assert.equal(Object.isFrozen(index.orderedSequences), true, fixture.id);
    assert.equal(Object.isFrozen(index.astLists), true, fixture.id);
    assert.equal(Object.isFrozen(index.astListItems), true, fixture.id);
    assert.equal(Object.isFrozen(index.byLineIndex), true, fixture.id);
    assert.equal(index.markdownBody, snapshot.markdownBody, fixture.id);
    assert.equal(index.sourceLength, snapshot.markdownBody.length, fixture.id);
    assert.equal(index.physicalLineIndex, snapshot.physicalLineIndex, fixture.id);
    assert.equal(typeof index.byLineIndex.set, 'undefined', fixture.id);
    assert.equal(typeof index.byLineIndex.delete, 'undefined', fixture.id);
    assert.equal(typeof index.byLineIndex.clear, 'undefined', fixture.id);
    assert.deepEqual(index.rows.map((row) => [
      row.lineIndex, row.kind, row.depth, row.marker, row.task
    ]), fixture.rows, fixture.id);
    index.rows.forEach((row) => {
      assert.equal(Object.isFrozen(row), true, `${fixture.id}:${row.lineIndex}`);
      assert.equal(Object.isFrozen(row.commandTargets), true, `${fixture.id}:${row.lineIndex}`);
      assert.equal(fixture.source.slice(row.markerStart, row.markerEnd), row.marker);
      assert.equal(fixture.source.slice(row.contentStart, row.contentEnd), row.content);
      assert.equal(fixture.source.slice(row.prefixStart, row.prefixEnd), row.line.text.slice(0, row.prefixEnd - row.start));
    });
  });
});

test('exact source spelling and canonical command ranges remain byte-owned', () => {
  const source = '\t007. value\r\n- [X] done';
  const index = markdown.createSourceSnapshot(source).editableListSemanticIndex;
  const [ordered, task] = index.rows;
  assert.equal(ordered.digits, '007');
  assert.equal(ordered.number, 7);
  assert.equal(source.slice(ordered.markerRange.start, ordered.markerRange.end), '007.');
  assert.equal(source.slice(ordered.indentationRange.start, ordered.indentationRange.end), '\t');
  assert.equal(ordered.commandTargets.continuationPrefix, '\t1. ');
  assert.deepEqual(ordered.commandTargets.indentInsertion, { start: 0, end: 0 });
  assert.deepEqual(ordered.commandTargets.outdentRange, { start: 0, end: 1 });
  assert.equal(source.slice(task.taskTokenRange.start, task.taskTokenRange.end), '[X]');
  assert.equal(source.slice(task.taskCheckRange.start, task.taskCheckRange.end), 'X');
  assert.deepEqual(task.commandTargets.taskCheckRange, task.taskCheckRange);
  assert.equal(task.commandTargets.continuationPrefix, '- [ ] ');
});

test('the new owner is differentially exact with the retired strict scanner contract', () => {
  corpus.forEach((fixture) => {
    const snapshot = markdown.createSourceSnapshot(fixture.source);
    assert.deepEqual(
      snapshot.editableListSemanticIndex.rows.map(comparableRow),
      legacyStrictRows(snapshot).map(comparableRow),
      fixture.id
    );
    assert.deepEqual(
      snapshot.editableListSemanticIndex.fencedLineIndices,
      [...legacyFenceMask(snapshot)],
      fixture.id
    );
  });
});

test('hierarchy, direct children, descendants, and subtree extents are derived once', () => {
  const source = '- a\n\t- b\n\t\t- c\n\t- d\n- e';
  const index = markdown.createSourceSnapshot(source).editableListSemanticIndex;
  const [a, b, c, d, e] = index.rows;
  assert.equal(index.parentOf(a), null);
  assert.equal(index.parentOf(b), a);
  assert.equal(index.parentOf(c), b);
  assert.equal(index.parentOf(d), a);
  assert.equal(index.parentOf(e), null);
  assert.deepEqual(index.childrenOf(a), [b, d]);
  assert.deepEqual(index.childrenOf(b), [c]);
  assert.deepEqual(index.descendantsOf(a), [b, c, d]);
  assert.deepEqual(index.descendantsOf(b), [c]);
  assert.equal(a.subtreeEndOrdinal, 4);
  assert.equal(a.subtreeEnd, d.sourceEnd);
  assert.equal(source.slice(a.commandTargets.subtreeRange.start, a.commandTargets.subtreeRange.end), '- a\n\t- b\n\t\t- c\n\t- d\n');
});

test('ordered sequences and canonical renumber targets are owned by the index', () => {
  const source = '3. a\n8. b\n\t4. child\n\t9. child\n7. c\n\n2. next\n6. last';
  const snapshot = markdown.createSourceSnapshot(source);
  const index = snapshot.editableListSemanticIndex;
  assert.equal(index.orderedSequences.length, 3);
  assert.deepEqual(index.orderedSequences.map((sequence) => ({
    depth: sequence.depth,
    startNumber: sequence.startNumber,
    positions: sequence.rows.map((row) => row.orderedSequencePosition),
    values: sequence.rows.map((row) => row.number)
  })), [
    { depth: 1, startNumber: 3, positions: [0, 1, 2], values: [3, 8, 7] },
    { depth: 2, startNumber: 4, positions: [0, 1], values: [4, 9] },
    { depth: 1, startNumber: 2, positions: [0, 1], values: [2, 6] }
  ]);
  index.orderedRows.forEach((row) => {
    assert.equal(row.commandTargets.orderedSequenceId, row.orderedSequenceId);
    assert.equal(index.orderedSequenceForRow(row).id, row.orderedSequenceId);
  });
  assert.equal(foundation.resolveOrderedSequences(snapshot).source,
    '3. a\n4. b\n\t4. child\n\t5. child\n5. c\n\n2. next\n3. last');
  const zeroStartSnapshot = markdown.createSourceSnapshot('0. zero');
  assert.equal(markdown.sourceBlocks('0. zero')[0].orderedStart, 0);
  assert.equal(zeroStartSnapshot.editableListSemanticIndex.astListItems[0].readingOrdinal, 0);
});

test('AST reconciliation centrally records Viewer/parser dialect asymmetries', () => {
  const orderedTask = markdown.createSourceSnapshot('1. [ ] task').editableListSemanticIndex;
  assert.equal(orderedTask.rows[0].task, false);
  assert.equal(orderedTask.rows[0].reconciliation.status, 'dialect-task-divergence');
  assert.equal(orderedTask.astListItems[0].kind, 'task-ordered');
  assert.equal(orderedTask.astListItems[0].reconciliationStatus, 'dialect-task-divergence');

  const parserOnly = markdown.createSourceSnapshot('* [ ] star\n  - spaces\n> - quoted')
    .editableListSemanticIndex;
  assert.equal(parserOnly.rows.length, 0);
  assert.ok(parserOnly.astListItems.length >= 3);
  assert.ok(parserOnly.astListItems.every((item) => item.reconciliationStatus === 'parser-only'));

  const sameLineNested = markdown.createSourceSnapshot('2. * nested')
    .editableListSemanticIndex;
  assert.equal(sameLineNested.rows.length, 1);
  assert.equal(sameLineNested.astListItems.length, 2);
  assert.equal(sameLineNested.astListItems.filter((item) => item.editableRowId).length, 1);
  assert.equal(sameLineNested.astListItems.filter((item) => !item.editableRowId).length, 1);
});

test('parser-owned multiline tasks retain exact Reading task ranges without broadening Viewer rows', () => {
  for (const source of [
    '- [ ]\n  continued',
    '- [x]\n\tcontinued',
    '> - [ ]\n>   continued',
    '1. [ ]\n   continued',
    '- [ ]\r\n  continued'
  ]) {
    const snapshot = markdown.createSourceSnapshot(source);
    const item = snapshot.editableListSemanticIndex.astListItems.find((entry) => entry.task);
    assert.ok(item, JSON.stringify(source));
    assert.equal(source.slice(item.taskTokenStart, item.taskTokenEnd).toLowerCase(),
      item.checked ? '[x]' : '[ ]');
    assert.equal(source.slice(item.taskCheckStart, item.taskCheckEnd).toLowerCase(),
      item.checked ? 'x' : ' ');
    assert.match(markdown.renderMarkdown(source), /class="task-list-item"/);
  }
  const strict = markdown.createSourceSnapshot('- [ ]\n  continued')
    .editableListSemanticIndex;
  assert.equal(strict.rows[0].task, false);
  assert.equal(strict.rows[0].reconciliation.status, 'dialect-task-divergence');
});

test('code overlap policy is one index decision and preserves the historical asymmetry', () => {
  const unordered = markdown.createSourceSnapshot('\t- tabbed').editableListSemanticIndex;
  const unorderedRow = unordered.rows[0];
  assert.equal(unorderedRow.reconciliation.status, 'viewer-row-overrides-code');
  assert.ok(unorderedRow.overlappingCodeOwnerIds.length > 0);
  assert.deepEqual(unorderedRow.reconciliation.suppressedCodeOwnerIds,
    unorderedRow.overlappingCodeOwnerIds);
  assert.ok(unorderedRow.overlappingCodeOwnerIds.every((ownerId) => unordered.suppressesAstOwner(ownerId)));

  const ordered = markdown.createSourceSnapshot('\t1. tabbed').editableListSemanticIndex;
  const orderedRow = ordered.rows[0];
  assert.equal(orderedRow.reconciliation.status, 'parser-code-retained');
  assert.ok(orderedRow.overlappingCodeOwnerIds.length > 0);
  assert.deepEqual(orderedRow.reconciliation.suppressedCodeOwnerIds, []);
  assert.ok(orderedRow.overlappingCodeOwnerIds.every((ownerId) => !ordered.suppressesAstOwner(ownerId)));

  for (const source of ['\t- unordered\n\t1. ordered', '\t1. ordered\n\t- unordered']) {
    const mixed = markdown.createSourceSnapshot(source).editableListSemanticIndex;
    const mixedUnordered = mixed.rows.find((row) => row.unordered);
    const mixedOrdered = mixed.rows.find((row) => row.ordered);
    assert.ok(mixedUnordered);
    assert.ok(mixedOrdered);
    assert.deepEqual(mixedUnordered.overlappingCodeOwnerIds,
      mixedOrdered.overlappingCodeOwnerIds, source);
    assert.equal(mixedUnordered.reconciliation.status,
      'viewer-row-overrides-code', source);
    assert.equal(mixedOrdered.reconciliation.status,
      'shared-code-owner-suppressed', source);
    assert.deepEqual(mixedOrdered.reconciliation.suppressedCodeOwnerIds,
      mixedOrdered.overlappingCodeOwnerIds, source);
    assert.ok(mixedOrdered.overlappingCodeOwnerIds.every((ownerId) => (
      mixed.suppressesAstOwner(ownerId)
    )), source);
  }
});

test('Live and Reading resolve one exact index-owned task mutation range', () => {
  const source = '- [ ] todo\n- [x] done';
  const snapshot = markdown.createSourceSnapshot(source);
  const index = snapshot.editableListSemanticIndex;
  const livePlan = adapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const view = loadMarkdownPageViewInternals(['toggleMarkdownTaskItemSource']);
  index.taskRows.forEach((row) => {
    const item = index.astListItemForOwner(row.astOwnerId);
    const liveRow = livePlan.constructs.listRows.find((entry) => (
      entry.editableListRowId === row.id
    ));
    const readingToggle = view.toggleMarkdownTaskItemSource(snapshot, item);
    assert.ok(item);
    assert.ok(liveRow?.control);
    assert.ok(readingToggle);
    assert.equal(item.task, true);
    assert.deepEqual(
      { start: item.taskCheckStart, end: item.taskCheckEnd },
      row.commandTargets.taskCheckRange
    );
    assert.deepEqual(
      { start: liveRow.control.sourceStart, end: liveRow.control.sourceEnd },
      row.commandTargets.taskCheckRange
    );
    assert.deepEqual(
      { start: readingToggle.markerStart, end: readingToggle.markerEnd },
      row.commandTargets.taskCheckRange
    );
    assert.equal(source.slice(item.taskCheckStart, item.taskCheckEnd), row.checked ? 'x' : ' ');
  });
});

test('list-content IME, clipboard selection, Undo, and Redo keep one fresh semantic owner', () => {
  const view = loadMarkdownPageViewInternals([
    'canonicalMarkdownSelectionText',
    'createMarkdownEditHistory',
    'recordMarkdownEditTransaction',
    'stepMarkdownEditHistory'
  ]);
  const source = '- [ ] ATP\n2. second';
  const before = markdown.createSourceSnapshot(source);
  const start = source.indexOf('ATP');
  const composition = foundation.applyCanonicalEdit(before, {
    anchor: start,
    focus: start + 3
  }, {
    start,
    end: start + 3,
    replacement: '腺苷三磷酸',
    kind: 'composition'
  }, {
    parseMarkdown: before.parseMarkdown,
    transactionKind: 'composition',
    inputType: 'insertCompositionText'
  });

  assert.equal(composition.source, '- [ ] 腺苷三磷酸\n2. second');
  assert.notEqual(composition.snapshot.editableListSemanticIndex,
    before.editableListSemanticIndex);
  assert.equal(composition.snapshot.editableListSemanticIndex.rows[0].task, true);
  assert.equal(composition.snapshot.editableListSemanticIndex.rows[0].taskContent,
    '腺苷三磷酸');
  assert.deepEqual(composition.transaction.beforeSelection, {
    anchor: start,
    focus: start + 3,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  });
  assert.equal(view.canonicalMarkdownSelectionText(composition.source, {
    anchor: 0,
    focus: composition.source.indexOf('\n')
  }), '- [ ] 腺苷三磷酸');

  const history = view.createMarkdownEditHistory(source);
  view.recordMarkdownEditTransaction(history, composition.transaction, {
    compositionId: 'list-ime-1'
  });
  const undone = view.stepMarkdownEditHistory(history, 'undo', composition.source);
  assert.equal(undone.source, source);
  const redone = view.stepMarkdownEditHistory(history, 'redo', source);
  assert.equal(redone.source, composition.source);
});

test('structural edits produce a fresh revision-scoped index and preserve stable physical fold identity', () => {
  const first = markdown.createSourceSnapshot('- parent\n\t- child\nplain');
  const second = markdown.createSourceSnapshot('- parent changed\n\t- child\nplain', {
    previousSnapshot: first
  });
  assert.notEqual(second.editableListSemanticIndex, first.editableListSemanticIndex);
  assert.equal(second.editableListSemanticIndex.sourceVersion, first.sourceVersion + 1);
  assert.equal(second.editableListSemanticIndex.rows[0].physicalLineId,
    first.editableListSemanticIndex.rows[0].physicalLineId);
  assert.equal(second.editableListSemanticIndex.rows[1].physicalLineId,
    first.editableListSemanticIndex.rows[1].physicalLineId);
  assert.notEqual(second.editableListSemanticIndex.rows[0].id,
    first.editableListSemanticIndex.rows[0].id);
});

test('production consumers expose no retired standalone list scanner', () => {
  const files = [
    'public/markdownEditableFoundation.js',
    'public/markdownPage.js',
    'public/js/markdownEditableSyntaxAdapters.js',
    'public/js/markdownPageView.js'
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /scanEditableListRows/, file);
  });
  assert.equal('scanEditableListRows' in foundation, false);
  assert.equal('scanEditableListRows' in markdown, false);
});

test('large hierarchy construction keeps linear descriptor storage', () => {
  const source = Array.from({ length: 10000 }, (_, index) => (
    `${'\t'.repeat(index % 8)}- row ${index}`
  )).join('\n');
  const started = performance.now();
  const index = foundation.createSourceSnapshot(source).editableListSemanticIndex;
  const elapsed = performance.now() - started;
  assert.equal(index.rows.length, 10000);
  assert.equal(index.rows.reduce((sum, row) => sum + row.childRowIds.length, 0), 8750);
  assert.ok(index.rows.every((row) => !Object.hasOwn(row, 'descendantRowIds')));
  const orderedSource = Array.from({ length: 8000 }, (_, rowIndex) => (
    `${'\t'.repeat(rowIndex % 128)}1. row ${rowIndex}`
  )).join('\n');
  const orderedStarted = performance.now();
  const orderedIndex = foundation.createSourceSnapshot(orderedSource)
    .editableListSemanticIndex;
  const orderedElapsed = performance.now() - orderedStarted;
  assert.equal(orderedIndex.rows.length, 8000);
  const foundationSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'public/markdownEditableFoundation.js'),
    'utf8'
  );
  const indexBody = foundationSource.slice(
    foundationSource.indexOf('function createEditableListSemanticIndex'),
    foundationSource.indexOf('function resolveOrderedSequences')
  );
  assert.doesNotMatch(indexBody, /rawRows\.find/);
  assert.doesNotMatch(indexBody, /descendantRowIds/);
  assert.doesNotMatch(indexBody, /activeSequences\.keys/);
  assert.ok(elapsed < 2000, `10k-row index construction took ${elapsed.toFixed(1)}ms`);
  assert.ok(orderedElapsed < 2000,
    `8k nested ordered-row index construction took ${orderedElapsed.toFixed(1)}ms`);
});
