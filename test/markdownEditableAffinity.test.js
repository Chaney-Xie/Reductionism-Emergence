'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');
const markdown = require('../public/markdownPage');

function collapsed(offset, affinity = 'before') {
  return {
    anchor: offset,
    focus: offset,
    anchorAffinity: affinity,
    focusAffinity: affinity
  };
}

function assertSelection(selection, anchor, focus, anchorAffinity, focusAffinity) {
  assert.deepEqual(selection, {
    anchor,
    focus,
    anchorAffinity,
    focusAffinity
  });
}

function assertBeforeAffinityTransaction(result, beforeOffset, afterOffset) {
  assertSelection(result.transaction.beforeSelection, beforeOffset, beforeOffset, 'before', 'before');
  assertSelection(result.transaction.afterSelection, afterOffset, afterOffset, 'before', 'before');
  assertSelection(result.selection, afterOffset, afterOffset, 'before', 'before');
}

test('canonical edits preserve independent before/after endpoint affinity and history metadata', () => {
  const result = foundation.applyCanonicalEdit(
    'ab',
    {
      anchor: 1,
      focus: 1,
      anchorAffinity: 'before',
      focusAffinity: 'after'
    },
    { start: 1, end: 1, replacement: 'X', kind: 'typed-character' },
    { transactionKind: 'insert-text', inputType: 'insertText' }
  );

  assert.equal(result.source, 'aXb');
  assertSelection(result.transaction.beforeSelection, 1, 1, 'before', 'after');
  assertSelection(result.transaction.afterSelection, 1, 2, 'before', 'after');
  assertSelection(result.selection, 1, 2, 'before', 'after');
});

test('foundation accepts EditablePosition, numeric sidecars, and page selectionAffinity inputs', () => {
  const source = 'ab';
  const forms = [
    {
      anchor: { offset: 1, affinity: 'before' },
      focus: { offset: 1, affinity: 'before' }
    },
    collapsed(1),
    {
      anchor: 1,
      focus: 1,
      anchorPosition: { offset: 1, affinity: 'before' },
      focusPosition: { offset: 1, affinity: 'before' }
    },
    {
      anchor: 1,
      focus: 1,
      selectionAffinity: { anchor: 'before', focus: 'before' }
    }
  ];

  for (const selection of forms) {
    const result = foundation.applyCanonicalEdit(
      source,
      selection,
      { start: 1, end: 1, replacement: 'X' }
    );
    assertBeforeAffinityTransaction(result, 1, 1);
  }

  const anchorOnly = foundation.applyCanonicalEdit(
    source,
    { anchor: { offset: 1, affinity: 'before' } },
    { start: 1, end: 1, replacement: 'X' }
  );
  assertBeforeAffinityTransaction(anchorOnly, 1, 1);
});

test('ordinary and strict-list indentation preserve before affinity through page API results', () => {
  const ordinary = markdown.applyMarkdownIndentation('alpha', collapsed(2), 'indent');
  assert.equal(ordinary.source, '    alpha');
  assertBeforeAffinityTransaction(ordinary, 2, 6);
  assert.deepEqual(ordinary.selectionAffinity, { anchor: 'before', focus: 'before' });

  const list = markdown.applyMarkdownIndentation('1. A', collapsed(4), 'indent');
  assert.equal(list.source, '\t1. A');
  assertBeforeAffinityTransaction(list, 4, 5);

  const restored = markdown.applyMarkdownIndentation(list.source, list.selection, 'outdent');
  assert.equal(restored.source, '1. A');
  assertBeforeAffinityTransaction(restored, 5, 4);
});

test('newline transactions retain the before-selection and target the new visible row position', () => {
  const ordinary = markdown.applyMarkdownNewline('ab', collapsed(1));
  assert.equal(ordinary.source, 'a\nb');
  assertSelection(ordinary.transaction.beforeSelection, 1, 1, 'before', 'before');
  assertSelection(ordinary.transaction.afterSelection, 2, 2, 'after', 'after');
  assertSelection(ordinary.selection, 2, 2, 'after', 'after');
  assert.deepEqual(ordinary.selectionAffinity, { anchor: 'after', focus: 'after' });

  const list = markdown.applyMarkdownNewline('1. A', collapsed(4));
  assert.equal(list.source, '1. A\n2. ');
  assertSelection(list.transaction.beforeSelection, 4, 4, 'before', 'before');
  assertSelection(list.transaction.afterSelection, 8, 8, 'before', 'before');
  assertSelection(list.selection, 8, 8, 'before', 'before');

  const indentedLineStart = markdown.applyMarkdownNewline('    code', collapsed(0));
  assert.equal(indentedLineStart.source, '\n    code');
  assertSelection(indentedLineStart.transaction.beforeSelection, 0, 0, 'before', 'before');
  assertSelection(indentedLineStart.transaction.afterSelection, 5, 5, 'after', 'after');
  assertSelection(indentedLineStart.selection, 5, 5, 'after', 'after');
});

test('exact deletion retains affinity in page result and Undo transaction selections', () => {
  const backward = markdown.applyMarkdownDeletion('abc', collapsed(2), 'backward');
  assert.equal(backward.source, 'ac');
  assertBeforeAffinityTransaction(backward, 2, 1);
  assert.deepEqual(backward.selectionAffinity, { anchor: 'before', focus: 'before' });

  const forward = markdown.applyMarkdownDeletion('abc', collapsed(1), 'forward');
  assert.equal(forward.source, 'ac');
  assertBeforeAffinityTransaction(forward, 1, 1);
});

test('explicit afterSelection and no-op results do not synthesize after affinity', () => {
  const explicit = foundation.applyCanonicalEdit(
    'ab',
    collapsed(1),
    { start: 1, end: 1, replacement: 'X' },
    { afterSelection: collapsed(2) }
  );
  assertBeforeAffinityTransaction(explicit, 1, 2);

  const noOp = foundation.applyEditableListIndentation('- A', collapsed(2), 'outdent');
  assert.equal(noOp.changed, false);
  assertSelection(noOp.selection, 2, 2, 'before', 'before');
});
