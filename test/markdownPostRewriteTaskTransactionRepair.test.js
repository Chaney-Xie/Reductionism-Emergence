const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');

function bareEdits(edits) {
  return edits.map(({ start, end, replacement }) => ({ start, end, replacement }));
}

test('strict editable-list scan identifies exact task tokens and task content ranges', () => {
  const source = [
    '- [ ] open',
    '\t- [x] done',
    '\t\t- [X] DONE',
    '- [ ] ',
    '- [ ]missing checkbox spacing',
    '- [y] invalid state',
    '1. [ ] ordered content'
  ].join('\n');
  const rows = foundation.createSourceSnapshot(source).editableListSemanticIndex.rows;

  assert.deepEqual(rows.slice(0, 4).map((row) => ({
    depth: row.depth,
    task: row.task,
    isTask: row.isTask,
    checked: row.checked,
    token: row.taskToken,
    tokenSource: source.slice(row.taskTokenStart, row.taskTokenEnd),
    prefixSource: source.slice(row.taskPrefixStart, row.taskPrefixEnd),
    taskContent: row.taskContent,
    taskContentSource: source.slice(row.taskContentStart, row.taskContentEnd),
    empty: row.empty
  })), [
    {
      depth: 1,
      task: true,
      isTask: true,
      checked: false,
      token: '[ ]',
      tokenSource: '[ ]',
      prefixSource: '- [ ] ',
      taskContent: 'open',
      taskContentSource: 'open',
      empty: false
    },
    {
      depth: 2,
      task: true,
      isTask: true,
      checked: true,
      token: '[x]',
      tokenSource: '[x]',
      prefixSource: '\t- [x] ',
      taskContent: 'done',
      taskContentSource: 'done',
      empty: false
    },
    {
      depth: 3,
      task: true,
      isTask: true,
      checked: true,
      token: '[X]',
      tokenSource: '[X]',
      prefixSource: '\t\t- [X] ',
      taskContent: 'DONE',
      taskContentSource: 'DONE',
      empty: false
    },
    {
      depth: 1,
      task: true,
      isTask: true,
      checked: false,
      token: '[ ]',
      tokenSource: '[ ]',
      prefixSource: '- [ ] ',
      taskContent: '',
      taskContentSource: '',
      empty: true
    }
  ]);

  for (const row of rows.slice(4)) {
    assert.equal(row.task, false);
    assert.equal(row.isTask, false);
    assert.equal(row.checked, null);
    assert.equal(row.taskToken, null);
    assert.equal(row.taskContent, null);
  }
});

test('task Enter continues every checkbox state and literal-Tab depth as one unchecked task', () => {
  const cases = [
    { source: '- [ ] open', expected: '- [ ] open\n- [ ] ' },
    { source: '\t- [x] done', expected: '\t- [x] done\n\t- [ ] ' },
    { source: '\t\t- [X] DONE', expected: '\t\t- [X] DONE\n\t\t- [ ] ' }
  ];

  for (const { source, expected } of cases) {
    const result = foundation.applyEditableNewline(source, {
      anchor: source.length,
      focus: source.length
    });
    const prefix = `${source.match(/^\t*/)[0]}- [ ] `;

    assert.equal(result.source, expected);
    assert.equal(result.selection.anchor, expected.length);
    assert.equal(result.selection.focus, expected.length);
    assert.equal(result.transaction.transactionKind, 'list-enter-unordered');
    assert.equal(result.transaction.structural, true);
    assert.equal(result.transaction.listTransform, true);
    assert.deepEqual(bareEdits(result.primaryEdits), [{
      start: source.length,
      end: source.length,
      replacement: `\n${prefix}`
    }]);
    assert.deepEqual(result.renumberEdits, []);
    assert.equal(result.transaction.sourceVersionAfter, result.transaction.sourceVersionBefore + 1);
    assert.equal(
      result.snapshot.editableListSemanticIndex.rows.at(-1).taskContent,
      ''
    );
  }
});

test('empty task Enter reuses one-level nested ascent and root list exit', () => {
  const levelThree = foundation.applyEditableNewline(
    '\t\t- [x] ',
    { anchor: 8, focus: 8 }
  );
  assert.equal(levelThree.source, '\t- [x] ');
  assert.equal(levelThree.transaction.transactionKind, 'list-enter-empty-nested');
  assert.equal(levelThree.snapshot.editableListSemanticIndex.rows[0].depth, 2);
  assert.equal(levelThree.snapshot.editableListSemanticIndex.rows[0].task, true);

  const levelTwo = foundation.applyEditableNewline(
    levelThree.snapshot,
    { anchor: levelThree.source.length, focus: levelThree.source.length }
  );
  assert.equal(levelTwo.source, '- [x] ');
  assert.equal(levelTwo.transaction.transactionKind, 'list-enter-empty-nested');

  const root = foundation.applyEditableNewline(
    levelTwo.snapshot,
    { anchor: levelTwo.source.length, focus: levelTwo.source.length }
  );
  assert.equal(root.source, '');
  assert.equal(root.transaction.transactionKind, 'list-enter-empty-root');
  assert.equal(root.snapshot.physicalLineIndex.lineCount, 1);
});

test('ordinary deletion inside a task prefix remains one exact deletion', () => {
  const source = '- [ ] task';
  const result = foundation.applyExactDeletion(
    source,
    { anchor: 4, focus: 4 },
    'backward'
  );

  assert.equal(result.source, '- [] task');
  assert.equal(result.transaction.transactionKind, 'exact-deletion');
  assert.deepEqual(bareEdits(result.primaryEdits), [
    { start: 3, end: 4, replacement: '' }
  ]);
  assert.equal(result.snapshot.editableListSemanticIndex.rows[0].task, false);
});

test('ordered Enter already continues the same depth at levels one through three', () => {
  const cases = [
    {
      source: '1. one\n2. two',
      target: '2. two',
      expected: '1. one\n2. two\n3. '
    },
    {
      source: '1. parent\n\t1. one\n\t2. two\n2. sibling',
      target: '\t2. two',
      expected: '1. parent\n\t1. one\n\t2. two\n\t3. \n2. sibling'
    },
    {
      source: '1. parent\n\t1. child\n\t\t1. one\n\t\t2. two\n\t2. child sibling\n2. sibling',
      target: '\t\t2. two',
      expected: '1. parent\n\t1. child\n\t\t1. one\n\t\t2. two\n\t\t3. \n\t2. child sibling\n2. sibling'
    }
  ];

  for (const { source, target, expected } of cases) {
    const caret = source.indexOf(target) + target.length;
    const result = foundation.applyEditableNewline(source, {
      anchor: caret,
      focus: caret
    });
    assert.equal(result.source, expected);
    assert.equal(result.transaction.transactionKind, 'list-enter-ordered');
    assert.equal(result.primaryEdits.length, 1);
    assert.equal(result.renumberEdits.length, 1);
    assert.equal(result.renumberEdits[0].replacement, '3');
  }
});
