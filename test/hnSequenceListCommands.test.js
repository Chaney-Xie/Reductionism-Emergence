'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdownPage = require('../public/markdownPage');
const foundation = require('../public/markdownEditableFoundation');
const listIndexModel = require('../public/hnListIndex');
const commands = require('../public/hnListCommands');

function snapshot(source) {
  return foundation.createSourceSnapshot(source, {
    parseMarkdown: markdownPage.parseMarkdownDocument
  });
}

function collapsed(offset, affinity = 'after') {
  return {
    anchor: offset,
    focus: offset,
    anchorAffinity: affinity,
    focusAffinity: affinity
  };
}

function selected(anchor, focus) {
  return { anchor, focus, anchorAffinity: 'after', focusAffinity: 'after' };
}

function enter(source, selection, options = {}) {
  return commands.applyHnSequenceListNewline(snapshot(source), selection, options);
}

function indent(source, selection, direction = 'indent') {
  return commands.applyHnSequenceListIndentation(
    snapshot(source),
    selection,
    direction
  );
}

function deletion(source, selection, direction) {
  return commands.applyHnSequenceListDeletion(snapshot(source), selection, direction);
}

function listIndex(source) {
  return listIndexModel.createHnListIndex(snapshot(source));
}

function assertChanged(result, expectedSource, expectedInputType) {
  assert.ok(result);
  assert.equal(result.changed, true);
  assert.equal(result.source, expectedSource);
  assert.equal(result.transaction.inputType, expectedInputType);
  assert.equal(result.transaction.structural, true);
  assert.equal(result.transaction.listTransform, true);
}

test('Enter continues every retained HN sequence marker family', async (t) => {
  const cases = [
    ['decimal', '1. Alpha', '1. Alpha\n2. '],
    ['dotted decimal', '3.7.4. Alpha', '3.7.4. Alpha\n3.7.5. '],
    ['upper Roman left-parenthesis', '(IV Alpha', '(IV Alpha\n(V '],
    ['lower Roman left-parenthesis', '(iv Alpha', '(iv Alpha\n(v '],
    ['lower alphabetic left-parenthesis', '(h Alpha', '(h Alpha\n(i ']
  ];
  for (const [label, source, expected] of cases) {
    await t.test(label, () => {
      const result = enter(source, collapsed(source.length));
      assertChanged(result, expected, 'insertParagraph');
      assert.equal(result.selection.anchor, expected.length);
      assert.equal(result.selection.focus, expected.length);
    });
  }
});

test('Enter splits selected content and moves later continuations and dotted descendants', () => {
  const source = [
    '3.7.9. AlphaBeta',
    '       Later',
    '\t3.7.9.1. Child',
    '3.7.10. Tail'
  ].join('\n');
  const start = source.indexOf('Beta');
  const result = enter(source, collapsed(start));
  const expected = [
    '3.7.9. Alpha',
    '3.7.10. Beta',
    '        Later',
    '\t3.7.10.1. Child',
    '3.7.11. Tail'
  ].join('\n');
  assertChanged(result, expected, 'insertParagraph');
  assert.equal(result.selection.anchor, expected.indexOf('Beta'));
  assert.equal(result.source.slice(result.selection.anchor), 'Beta\n        Later\n\t3.7.10.1. Child\n3.7.11. Tail');
});

test('Enter treats a noncollapsed selection inside one paragraph as the split range', () => {
  const source = '1. ABCDEF\n2. Tail';
  const start = source.indexOf('CD');
  const result = enter(source, selected(start, start + 2));
  const expected = '1. AB\n2. EF\n3. Tail';
  assertChanged(result, expected, 'insertParagraph');
  assert.equal(result.selection.anchor, expected.indexOf('EF'));
  assert.equal(result.selection.focus, expected.indexOf('EF'));
});

test('9 to 10 Enter rewrites transferred and later continuation padding only', () => {
  const source = [
    '9. Alpha',
    '   Alpha continuation',
    '10. Tail',
    '    Tail continuation',
    '',
    '7. Independent',
    '   untouched'
  ].join('\n');
  const result = enter(source, collapsed(source.indexOf('Alpha')));
  const expected = [
    '9. ',
    '10. Alpha',
    '    Alpha continuation',
    '11. Tail',
    '    Tail continuation',
    '',
    '7. Independent',
    '   untouched'
  ].join('\n');
  assertChanged(result, expected, 'insertParagraph');
  assert.match(result.source, /\n\n7\. Independent\n   untouched$/);
});

test('Shift+Enter creates exact-width continuation paragraphs from first and continuation rows', () => {
  let source = '10. First';
  let result = enter(source, collapsed(source.length), { shiftKey: true });
  assertChanged(result, '10. First\n    ', 'insertLineBreak');
  assert.equal(result.selection.anchor, result.source.length);

  source = '10. First\n    Second';
  result = enter(source, collapsed(source.length), { inputType: 'insertLineBreak' });
  assertChanged(result, '10. First\n    Second\n    ', 'insertLineBreak');
  assert.equal(result.selection.anchor, result.source.length);
});

test('Shift+Enter and ordinary Enter preserve CRLF and terminal EOF policy', () => {
  let source = '1. Alpha\r\n2. Beta';
  let result = enter(source, collapsed(source.indexOf('Beta')));
  assertChanged(result, '1. Alpha\r\n2. \r\n3. Beta', 'insertParagraph');
  assert.doesNotMatch(result.source, /(^|[^\r])\n/);

  source = '10. Alpha\r\n    Beta';
  result = enter(source, collapsed(source.length), { shiftKey: true });
  assertChanged(result, '10. Alpha\r\n    Beta\r\n    ', 'insertLineBreak');
});

test('empty root Enter consumes the complete empty item and leaves an ordinary paragraph', () => {
  let source = '1. Alpha\n2. \n   ';
  let result = enter(source, collapsed(source.indexOf('2. ') + 3));
  assertChanged(result, '1. Alpha\n', 'insertParagraph');
  assert.equal(result.selection.anchor, result.source.length);

  source = '1. Alpha\n2. \n3. Later';
  result = enter(source, collapsed(source.indexOf('2. ') + 3));
  assertChanged(result, '1. Alpha\n\n3. Later', 'insertParagraph');
  assert.equal(result.selection.anchor, '1. Alpha\n'.length);

  source = '1. ';
  result = enter(source, collapsed(source.length));
  assertChanged(result, '', 'insertParagraph');
  assert.equal(result.selection.anchor, 0);
});

test('empty nested Enter lifts after the complete parent subtree and renumbers both sequences only', () => {
  const source = [
    '5. Parent',
    '\t7. Child A',
    '\t8. ',
    '\t9. Child C',
    '6. Sibling',
    '',
    '100. Independent'
  ].join('\n');
  const result = enter(source, collapsed(source.indexOf('\t8. ') + 4));
  const expected = [
    '5. Parent',
    '\t7. Child A',
    '\t8. Child C',
    '6. ',
    '7. Sibling',
    '',
    '100. Independent'
  ].join('\n');
  assertChanged(result, expected, 'insertParagraph');
  assert.equal(result.selection.anchor, expected.indexOf('6. ') + 3);
  assert.match(result.source, /\n\n100\. Independent$/);
});

test('empty nested dotted Enter uses the parent path and rebases later root items', () => {
  const source = [
    '1.1. Parent',
    '\t1.1.1. Child',
    '\t1.1.2. ',
    '1.2. Tail'
  ].join('\n');
  const result = enter(source, collapsed(
    source.indexOf('\t1.1.2. ') + '\t1.1.2. '.length
  ));
  const expected = [
    '1.1. Parent',
    '\t1.1.1. Child',
    '1.2. ',
    '1.3. Tail'
  ].join('\n');
  assertChanged(result, expected, 'insertParagraph');
  assert.equal(result.selection.anchor, expected.indexOf('1.2. ') + 5);
});

test('Tab derives the approved default child marker for every marker family', async (t) => {
  const cases = [
    ['decimal', '1. Parent\n2. Move', '1. Parent\n\t1. Move'],
    ['dotted decimal', '3.7.4. Parent\n3.7.5. Move', '3.7.4. Parent\n\t3.7.4.1. Move'],
    ['upper Roman', '(IV Parent\n(V Move', '(IV Parent\n\t(I Move'],
    ['lower Roman', '(iv Parent\n(v Move', '(iv Parent\n\t(i Move'],
    ['lower alphabetic', '(h Parent\n(i Move', '(h Parent\n\t(a Move']
  ];
  for (const [label, source, expected] of cases) {
    await t.test(label, () => {
      const result = indent(source, collapsed(source.indexOf('Move')));
      assertChanged(result, expected, 'formatIndent');
      assert.equal(result.source[result.selection.focus], 'M');
    });
  }
});

test('Tab appends to a compatible existing child sequence', () => {
  const source = [
    '1. Parent',
    '\t1. Existing',
    '2. Move',
    '3. Tail'
  ].join('\n');
  const result = indent(source, collapsed(source.indexOf('Move')));
  const expected = [
    '1. Parent',
    '\t1. Existing',
    '\t2. Move',
    '2. Tail'
  ].join('\n');
  assertChanged(result, expected, 'formatIndent');
});

test('Tab moves every paragraph and descendant while preserving relative depth', () => {
  const source = [
    '1. Alpha',
    '2. Move',
    '   second paragraph',
    '\t(a child',
    '\t   child continuation',
    '3. Tail',
    '',
    '50. Independent'
  ].join('\n');
  const result = indent(source, collapsed(source.indexOf('Move')));
  const expected = [
    '1. Alpha',
    '\t1. Move',
    '\t   second paragraph',
    '\t\t(a child',
    '\t\t   child continuation',
    '2. Tail',
    '',
    '50. Independent'
  ].join('\n');
  assertChanged(result, expected, 'formatIndent');
  assert.equal(result.source[result.selection.focus], 'M');
});

test('Shift+Tab relocates a complete subtree after remaining child siblings', () => {
  const source = [
    '(a Parent',
    '\t1. Move',
    '\t   second paragraph',
    '\t\t(a deep child',
    '\t2. Stay',
    '(b Tail',
    '',
    '100. Independent'
  ].join('\n');
  const result = indent(source, collapsed(source.indexOf('Move')), 'outdent');
  const expected = [
    '(a Parent',
    '\t1. Stay',
    '(b Move',
    '   second paragraph',
    '\t(a deep child',
    '(c Tail',
    '',
    '100. Independent'
  ].join('\n');
  assertChanged(result, expected, 'formatOutdent');
  assert.equal(result.source[result.selection.focus], 'M');
});

test('Shift+Tab rotates the separator correctly when relocation targets EOF', () => {
  const source = '1. Parent\n\t1. Move\n\t2. Stay';
  const result = indent(source, collapsed(source.indexOf('Move')), 'outdent');
  assertChanged(result, '1. Parent\n\t1. Stay\n2. Move', 'formatOutdent');
  assert.equal(result.source[result.selection.focus], 'M');
  assert.equal(result.source.endsWith('\n'), false);
});

test('first-sibling Tab and root Shift+Tab are owned fail-closed no-ops', () => {
  const source = '1. First\n2. Second';
  const firstTab = indent(source, collapsed(source.indexOf('First')), 'indent');
  assert.ok(firstTab);
  assert.equal(firstTab.changed, false);
  assert.equal(firstTab.source, source);
  assert.equal(firstTab.transaction, null);

  const rootOutdent = indent(source, collapsed(source.indexOf('First')), 'outdent');
  assert.ok(rootOutdent);
  assert.equal(rootOutdent.changed, false);
  assert.equal(rootOutdent.source, source);
  assert.equal(rootOutdent.transaction, null);
});

test('dotted Tab extends the parent path and rebases dependent dotted descendants', () => {
  const source = [
    '3.7.4. Parent',
    '3.7.5. Move',
    '\t3.7.5.1. Child',
    '\t\t3.7.5.1.1. Grandchild'
  ].join('\n');
  const result = indent(source, collapsed(source.indexOf('Move')));
  const expected = [
    '3.7.4. Parent',
    '\t3.7.4.1. Move',
    '\t\t3.7.4.1.1. Child',
    '\t\t\t3.7.4.1.1.1. Grandchild'
  ].join('\n');
  assertChanged(result, expected, 'formatIndent');
});

test('Roman overflow remains an owned no-op with no transaction', () => {
  const source = '(MMMCMXCIX Final';
  const result = enter(source, collapsed(source.length));
  assert.ok(result);
  assert.equal(result.changed, false);
  assert.equal(result.source, source);
  assert.equal(result.transaction, null);
  assert.equal(result.selection.anchor, source.length);
});

test('partial markers, prose, cross-item and cross-paragraph selections stay unowned', () => {
  assert.equal(enter('1.', collapsed(2)), null);
  assert.equal(enter('ordinary prose', collapsed(4)), null);
  assert.equal(indent('ordinary prose', collapsed(4)), null);

  let source = '1. First\n2. Second';
  assert.equal(enter(source, selected(source.indexOf('First'), source.indexOf('Second') + 2)), null);
  assert.equal(indent(source, selected(source.indexOf('First'), source.indexOf('Second') + 2)), null);

  source = '1. First\n   Second';
  assert.equal(enter(source, selected(source.indexOf('First'), source.indexOf('Second') + 2)), null);
});

test('Tab preserves forward and reversed marker-to-continuation selections with affinities', () => {
  const source = '1. Previous\n9. Move\n   Continuation';
  const before = listIndex(source).items[1];
  const forward = {
    anchor: before.markerRange.start + 1,
    focus: before.continuationParagraphs[0].paddingRange.start + 2,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  };
  let result = indent(source, forward, 'indent');
  let moved = listIndex(result.source).items[1];
  assert.deepEqual(result.selection, {
    anchor: moved.markerRange.start + 1,
    focus: moved.continuationParagraphs[0].paddingRange.start + 2,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  });
  assert.ok(result.selection.anchor < result.selection.focus);

  const reversed = {
    anchor: before.continuationParagraphs[0].paddingRange.start + 2,
    focus: before.markerRange.start + 1,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  };
  result = indent(source, reversed, 'indent');
  moved = listIndex(result.source).items[1];
  assert.deepEqual(result.selection, {
    anchor: moved.continuationParagraphs[0].paddingRange.start + 2,
    focus: moved.markerRange.start + 1,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  });
  assert.ok(result.selection.anchor > result.selection.focus);
});

test('Tab maps collapsed marker and separator endpoints without collapsing to replacement end', () => {
  const source = '1. Previous\n9. Move';
  const before = listIndex(source).items[1];
  const cases = [
    ['marker interior', before.markerRange.start + 1, 'before', (item) => item.markerRange.start + 1],
    ['marker end', before.markerRange.end, 'before', (item) => item.markerRange.end],
    ['separator start', before.separatorRange.start, 'after', (item) => item.separatorRange.start],
    ['separator end', before.separatorRange.end, 'before', (item) => item.separatorRange.end]
  ];
  cases.forEach(([label, offset, affinity, expectedOffset]) => {
    const result = indent(source, collapsed(offset, affinity), 'indent');
    const moved = listIndex(result.source).items[1];
    assert.equal(result.selection.anchor, expectedOffset(moved), label);
    assert.equal(result.selection.focus, expectedOffset(moved), label);
    assert.equal(result.selection.anchorAffinity, affinity, label);
    assert.equal(result.selection.focusAffinity, affinity, label);
  });
});

test('Shift+Tab preserves Tab and padding endpoints while marker width changes', () => {
  const source = [
    '1. Root',
    '\t9. Parent',
    '\t\t1. Move',
    '\t\t   Continuation'
  ].join('\n');
  const before = listIndex(source).items[2];
  const selection = {
    anchor: before.continuationParagraphs[0].paddingRange.end,
    focus: before.tabsRange.start + 1,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  };
  const result = indent(source, selection, 'outdent');
  const moved = listIndex(result.source).items.find((item) => (
    result.source.slice(item.firstParagraphRange.start, item.firstParagraphRange.end) === 'Move'
  ));
  assert.equal(moved.marker, '10.');
  assert.deepEqual(result.selection, {
    anchor: moved.continuationParagraphs[0].paddingRange.end,
    focus: moved.tabsRange.start,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  });
  assert.ok(result.selection.anchor > result.selection.focus, 'reversed direction survives');
});

test('relocating Shift+Tab preserves a reversed structural selection through both renumbers', () => {
  const source = [
    '1. Root',
    '\t9. Parent',
    '\t\t1. Move',
    '\t\t   Continuation',
    '\t\t2. Stay',
    '\t10. Tail'
  ].join('\n');
  const beforeIndex = listIndex(source);
  const before = beforeIndex.items.find((item) => (
    source.slice(item.firstParagraphRange.start, item.firstParagraphRange.end) === 'Move'
  ));
  const result = indent(source, {
    anchor: before.continuationParagraphs[0].paddingRange.end,
    focus: before.markerRange.start + 1,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  }, 'outdent');
  const afterIndex = listIndex(result.source);
  const moved = afterIndex.items.find((item) => (
    result.source.slice(item.firstParagraphRange.start, item.firstParagraphRange.end) === 'Move'
  ));
  assert.deepEqual(result.selection, {
    anchor: moved.continuationParagraphs[0].paddingRange.end,
    focus: moved.markerRange.start + 1,
    anchorAffinity: 'before',
    focusAffinity: 'after'
  });
  assert.ok(result.selection.anchor > result.selection.focus);
  assert.match(result.source, /\t9\. Parent\n\t\t1\. Stay\n\t10\. Move/);
  assert.match(result.source, /\n\t11\. Tail$/);
});

test('Backspace and Delete join the same sequence boundary symmetrically', () => {
  const source = [
    '3.7.9. Alpha',
    '3.7.10. Beta',
    '        More',
    '\t3.7.10.1. Child',
    '3.7.11. Tail',
    '',
    '1. Independent'
  ].join('\n');
  const index = listIndex(source);
  const previous = index.items[0];
  const current = index.items[1];
  const backward = deletion(
    source,
    collapsed(current.firstParagraphRange.start),
    'backward'
  );
  const forward = deletion(
    source,
    collapsed(previous.paragraphs.at(-1).contentRange.end, 'before'),
    'forward'
  );
  const expected = [
    '3.7.9. AlphaBeta',
    '       More',
    '\t3.7.9.1. Child',
    '3.7.10. Tail',
    '',
    '1. Independent'
  ].join('\n');
  assertChanged(backward, expected, 'deleteContentBackward');
  assertChanged(forward, expected, 'deleteContentForward');
  assert.equal(backward.selection.anchor, '3.7.9. Alpha'.length);
  assert.equal(forward.selection.anchor, backward.selection.anchor);
  assert.equal(backward.transaction.transactionKind, 'hn-sequence-list-backspace-join');
  assert.equal(forward.transaction.transactionKind, 'hn-sequence-list-delete-join');
});

test('sequence join appends to the previous final continuation and preserves the current subtree', () => {
  const source = [
    '1. First',
    '   Previous continuation',
    '2. Second',
    '   Current continuation',
    '\t(a Child',
    '3. Tail'
  ].join('\n');
  const index = listIndex(source);
  const previous = index.items[0];
  const current = index.items[1];
  const result = deletion(
    source,
    collapsed(current.firstParagraphRange.start),
    'Backspace'
  );
  const expected = [
    '1. First',
    '   Previous continuationSecond',
    '   Current continuation',
    '\t(a Child',
    '2. Tail'
  ].join('\n');
  assertChanged(result, expected, 'deleteContentBackward');
  assert.equal(
    result.selection.anchor,
    previous.paragraphs.at(-1).contentRange.end
  );
  const forward = deletion(
    source,
    collapsed(previous.paragraphs.at(-1).contentRange.end, 'before'),
    'Delete'
  );
  assertChanged(forward, expected, 'deleteContentForward');
  assert.equal(forward.selection.anchor, result.selection.anchor);
});

test('nested sequence join renumbers that child sequence without changing its parent sequence', () => {
  const source = [
    '1. Parent',
    '\t(a Alpha',
    '\t(b Beta',
    '\t(c Gamma',
    '2. Tail'
  ].join('\n');
  const index = listIndex(source);
  const beta = index.items.find((item) => (
    source.slice(item.firstParagraphRange.start, item.firstParagraphRange.end) === 'Beta'
  ));
  const result = deletion(
    source,
    collapsed(beta.firstParagraphRange.start),
    'backward'
  );
  const expected = [
    '1. Parent',
    '\t(a AlphaBeta',
    '\t(b Gamma',
    '2. Tail'
  ].join('\n');
  assertChanged(result, expected, 'deleteContentBackward');
});

test('sequence joins preserve CRLF in both directions and terminal EOF', () => {
  const source = '1. Alpha\r\n2. Beta';
  const index = listIndex(source);
  const backward = deletion(
    source,
    collapsed(index.items[1].firstParagraphRange.start),
    'deleteContentBackward'
  );
  const forward = deletion(
    source,
    collapsed(index.items[0].firstParagraphRange.end, 'before'),
    'deleteContentForward'
  );
  assertChanged(backward, '1. AlphaBeta', 'deleteContentBackward');
  assertChanged(forward, '1. AlphaBeta', 'deleteContentForward');
  assert.equal(backward.source.endsWith('\r\n'), false);
  assert.equal(forward.source.endsWith('\r\n'), false);
});

test('deletion owner rejects ordinary, partial, cross-sequence, first and final boundaries', () => {
  let source = '1. Alpha\n2. Beta';
  let index = listIndex(source);
  assert.equal(deletion(source, collapsed(source.indexOf('Alpha') + 2), 'backward'), null);
  assert.equal(deletion(source, collapsed(source.indexOf('Alpha') + 2), 'forward'), null);
  assert.equal(deletion(source, selected(
    index.items[1].firstParagraphRange.start,
    index.items[1].firstParagraphRange.start + 1
  ), 'backward'), null);
  assert.equal(deletion(source, collapsed(index.items[0].firstParagraphRange.start), 'backward'), null);
  assert.equal(deletion(source, collapsed(index.items[1].firstParagraphRange.end), 'forward'), null);
  assert.equal(deletion(source, collapsed(index.items[1].firstParagraphRange.start), 'sideways'), null);

  source = '1. Alpha\n\n2. Beta';
  index = listIndex(source);
  assert.equal(deletion(source, collapsed(index.items[1].firstParagraphRange.start), 'backward'), null);

  source = '1. Alpha\n(a Beta';
  index = listIndex(source);
  assert.equal(deletion(source, collapsed(index.items[1].firstParagraphRange.start), 'backward'), null);
});

test('changed and no-op command results expose only frozen canonical transaction metadata', () => {
  const source = '1. Alpha';
  const result = enter(source, collapsed(source.length));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.selection), true);
  assert.equal(Object.isFrozen(result.transaction), true);
  assert.equal(Object.isFrozen(result.transaction.beforeSelection), true);
  assert.equal(Object.isFrozen(result.transaction.afterSelection), true);
  assert.deepEqual(Object.keys(result).sort(), [
    'changed', 'selection', 'source', 'transaction'
  ]);
  assert.deepEqual(Object.keys(result.transaction).sort(), [
    'afterSelection',
    'beforeSelection',
    'inputType',
    'listTransform',
    'structural',
    'transactionKind'
  ]);
  assert.equal(Object.hasOwn(result, 'document'), false);
  assert.equal(Object.hasOwn(result, 'session'), false);

  const noOp = indent('1. Alpha', collapsed('1. '.length), 'indent');
  assert.equal(Object.isFrozen(noOp), true);
  assert.equal(Object.isFrozen(noOp.selection), true);
  assert.equal(noOp.transaction, null);

  const joinSource = '1. Alpha\n2. Beta';
  const joinIndex = listIndex(joinSource);
  const joined = deletion(
    joinSource,
    collapsed(joinIndex.items[1].firstParagraphRange.start),
    'backward'
  );
  assert.equal(Object.isFrozen(joined), true);
  assert.equal(Object.isFrozen(joined.selection), true);
  assert.equal(Object.isFrozen(joined.transaction), true);
  assert.equal(Object.isFrozen(joined.transaction.beforeSelection), true);
  assert.equal(Object.isFrozen(joined.transaction.afterSelection), true);
});
