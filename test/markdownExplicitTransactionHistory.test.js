const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

function loadHistoryApi() {
  return loadMarkdownPageViewInternals([
    'snapshotMarkdownEditHistory',
    'restoreMarkdownEditHistorySnapshot'
  ]);
}

function caret(offset, extra = {}) {
  return { anchor: offset, focus: offset, ...extra };
}

function editableCaret(offset, affinity, physicalLineId, sourceVersion) {
  const position = {
    offset,
    affinity,
    physicalLineId,
    logicalColumn: offset,
    sourceVersion
  };
  return { anchor: { ...position }, focus: { ...position } };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function record(api, history, transaction, options) {
  return api.recordMarkdownEditTransaction(history, transaction, options);
}

test('ordinary typing and deletion coalesce only by event, selection, time, and touching range', () => {
  const api = loadHistoryApi();
  const initial = '1) malformed\n*Beta';
  const typedOnce = `${initial}x`;
  const typedTwice = `${initial}xy`;
  const history = api.createMarkdownEditHistory(initial);

  record(api, history, {
    beforeSource: initial,
    afterSource: typedOnce,
    beforeSelection: caret(initial.length),
    afterSelection: caret(typedOnce.length),
    inputType: 'insertText',
    timestamp: 100
  });
  record(api, history, {
    beforeSource: typedOnce,
    afterSource: typedTwice,
    beforeSelection: caret(typedOnce.length),
    afterSelection: caret(typedTwice.length),
    inputType: 'insertText',
    timestamp: 150
  });

  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undoStack[0].commandKind, 'typing');
  assert.equal(history.undoStack[0].changeCount, 2);
  assert.equal(Object.hasOwn(history.undoStack[0], 'listOwned'), false);

  const deletion = api.createMarkdownEditHistory('abc');
  record(api, deletion, {
    beforeSource: 'abc',
    afterSource: 'ab',
    beforeSelection: caret(3),
    afterSelection: caret(2),
    inputType: 'deleteContentBackward',
    timestamp: 200
  });
  record(api, deletion, {
    beforeSource: 'ab',
    afterSource: 'a',
    beforeSelection: caret(2),
    afterSelection: caret(1),
    inputType: 'deleteContentBackward',
    timestamp: 250
  });
  assert.equal(deletion.undoStack.length, 1);

  record(api, deletion, {
    beforeSource: 'a',
    afterSource: '',
    beforeSelection: caret(0),
    afterSelection: caret(0),
    inputType: 'deleteContentForward',
    timestamp: 300
  });
  assert.equal(deletion.undoStack.length, 2, 'delete direction starts a new transaction');
});

test('composition coalesces, while moved selection, distant ranges, and elapsed time close a group', () => {
  const api = loadHistoryApi();
  const composition = api.createMarkdownEditHistory('');

  record(api, composition, {
    beforeSource: '',
    afterSource: '你',
    beforeSelection: caret(0),
    afterSelection: caret(1),
    inputType: 'insertCompositionText',
    compositionId: 'ime-1',
    timestamp: 0
  });
  record(api, composition, {
    beforeSource: '你',
    afterSource: '你好',
    beforeSelection: caret(1),
    afterSelection: caret(2),
    inputType: 'insertCompositionText',
    compositionId: 'ime-1',
    timestamp: 2_000
  });
  assert.equal(composition.undoStack.length, 1, 'an explicit composition id owns its IME group');

  const distant = api.createMarkdownEditHistory('abcd');
  record(api, distant, {
    beforeSource: 'abcd',
    afterSource: 'Xabcd',
    beforeSelection: caret(0),
    afterSelection: caret(1),
    inputType: 'insertText',
    timestamp: 10
  });
  record(api, distant, {
    beforeSource: 'Xabcd',
    afterSource: 'XabcdY',
    beforeSelection: caret(1),
    afterSelection: caret(6),
    inputType: 'insertText',
    timestamp: 20
  });
  assert.equal(distant.undoStack.length, 2, 'non-touching source ranges do not join');

  const delayed = api.createMarkdownEditHistory('');
  record(api, delayed, {
    beforeSource: '',
    afterSource: 'a',
    beforeSelection: caret(0),
    afterSelection: caret(1),
    inputType: 'insertText',
    timestamp: 0
  });
  record(api, delayed, {
    beforeSource: 'a',
    afterSource: 'ab',
    beforeSelection: caret(1),
    afterSelection: caret(2),
    inputType: 'insertText',
    timestamp: 501
  });
  assert.equal(delayed.undoStack.length, 2);
});

test('Enter, Tab, Shift-Tab, and explicitly identified list transforms are isolated', () => {
  const api = loadHistoryApi();
  const history = api.createMarkdownEditHistory('a');
  const steps = [
    ['a', 'ab', 1, 2, 'insertText', {}],
    ['ab', 'a\nb', 2, 2, 'insertParagraph', {}],
    ['a\nb', 'a\n\tb', 2, 3, 'formatIndent', {}],
    ['a\n\tb', 'a\nb', 3, 2, 'formatOutdent', {}],
    ['a\nb', '- a\n- b', 2, 4, 'insertText', {
      commandKind: 'list-toggle',
      structural: true,
      listTransform: true
    }]
  ];

  steps.forEach(([beforeSource, afterSource, beforeOffset, afterOffset, inputType, metadata], index) => {
    record(api, history, {
      beforeSource,
      afterSource,
      beforeSelection: caret(beforeOffset),
      afterSelection: caret(afterOffset),
      inputType,
      timestamp: index * 50,
      ...metadata
    });
  });

  assert.equal(history.undoStack.length, steps.length);
  assert.deepEqual(
    plain(history.undoStack.map(({ isolated }) => isolated)),
    [false, true, true, true, true]
  );
});

test('primary and renumber edits remain one transaction with exact source and affinity selections', () => {
  const api = loadHistoryApi();
  const beforeSource = '1. A\n3. B';
  const afterSource = '\t1. A\n2. B';
  const beforeSelection = editableCaret(4, 'before', 'line-a', 1);
  const afterSelection = editableCaret(5, 'after', 'line-a', 2);
  const primaryEdit = { start: 0, end: 0, replacement: '\t', kind: 'indent-item' };
  const renumberEdits = [
    { start: 6, end: 7, replacement: '2', kind: 'ordered-list-renumber' }
  ];
  const historyMetadata = { intent: 'list-tab', source: { lineId: 'line-a' } };
  const history = api.createMarkdownEditHistory(beforeSource);

  record(api, history, {
    beforeSource,
    afterSource,
    beforeSelection,
    afterSelection,
    inputType: 'insertText',
    timestamp: 10,
    commandKind: 'list-tab',
    primaryEdit,
    renumberEdits,
    affectedLineIds: ['line-a', 'line-b'],
    historyMetadata
  });

  primaryEdit.replacement = 'mutated';
  renumberEdits[0].replacement = 'mutated';
  historyMetadata.source.lineId = 'mutated';

  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undoStack[0].isolated, true);
  assert.deepEqual(plain(history.undoStack[0].primaryEdit), {
    start: 0,
    end: 0,
    replacement: '\t',
    kind: 'indent-item'
  });
  assert.deepEqual(plain(history.undoStack[0].renumberEdits), [
    { start: 6, end: 7, replacement: '2', kind: 'ordered-list-renumber' }
  ]);
  assert.deepEqual(plain(history.undoStack[0].affectedLineIds), ['line-a', 'line-b']);
  assert.equal(history.undoStack[0].historyMetadata.source.lineId, 'line-a');

  const undo = api.stepMarkdownEditHistory(history, 'undo', afterSource);
  assert.equal(undo.source, beforeSource);
  assert.deepEqual(plain(undo.selection), beforeSelection);
  const redo = api.stepMarkdownEditHistory(history, 'redo', beforeSource);
  assert.equal(redo.source, afterSource);
  assert.deepEqual(plain(redo.selection), afterSelection);
  assert.equal(history.undoStack.length, 1, 'redo restores the same compound transaction');
});

test('history snapshots deeply clone explicit transaction metadata', () => {
  const api = loadHistoryApi();
  const history = api.createMarkdownEditHistory('a');
  record(api, history, {
    beforeSource: 'a',
    afterSource: 'ab',
    beforeSelection: caret(1, { anchorAffinity: 'upstream' }),
    afterSelection: caret(2, { anchorAffinity: 'downstream' }),
    inputType: 'insertText',
    timestamp: 0,
    historyMetadata: { nested: { value: 1 } }
  });

  const snapshot = api.snapshotMarkdownEditHistory(history);
  snapshot.undoStack[0].historyMetadata.nested.value = 2;
  snapshot.undoStack[0].afterSelection.anchorAffinity = 'mutated';
  assert.equal(history.undoStack[0].historyMetadata.nested.value, 1);
  assert.equal(history.undoStack[0].afterSelection.anchorAffinity, 'downstream');

  api.restoreMarkdownEditHistorySnapshot(history, snapshot);
  snapshot.undoStack[0].historyMetadata.nested.value = 3;
  assert.equal(history.undoStack[0].historyMetadata.nested.value, 2);
});
