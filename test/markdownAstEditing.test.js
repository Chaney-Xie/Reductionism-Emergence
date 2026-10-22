const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const viewSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
  'utf8'
);

const mixedIndentFixture = [
  '1. Glycolysis',
  '2. Link reaction',
  '3. TCA cycle',
  '\t1. Citrate',
  '    2. Isocitrate'
].join('\n');

function listItemsAtDepth(source) {
  const items = [];
  const visit = (node, listDepth = 0) => {
    const nextDepth = node.type === 'list' ? listDepth + 1 : listDepth;
    if (node.type === 'listItem') {
      const paragraph = (node.children || []).find((child) => child.type === 'paragraph');
      const text = (paragraph?.children || []).map((child) => child.value || '').join('');
      items.push({ depth: listDepth, text, node });
    }
    (node.children || []).forEach((child) => visit(child, nextDepth));
  };
  visit(markdown.parseMarkdownDocument(source));
  return items;
}

test('AST structural context treats tab and four spaces as sibling nested-list levels', () => {
  const citrate = markdown.markdownStructuralContextAtOffset(
    mixedIndentFixture,
    mixedIndentFixture.indexOf('Citrate')
  );
  const isocitrate = markdown.markdownStructuralContextAtOffset(
    mixedIndentFixture,
    mixedIndentFixture.indexOf('Isocitrate')
  );

  assert.equal(citrate.astNodeType, 'listItem');
  assert.equal(isocitrate.astNodeType, 'listItem');
  assert.equal(citrate.listDepth, 2);
  assert.equal(isocitrate.listDepth, 2);
  assert.equal(citrate.listStart, isocitrate.listStart);
  assert.equal(citrate.indentation, '\t');
  assert.equal(isocitrate.indentation, '    ');
  assert.deepEqual(
    listItemsAtDepth(mixedIndentFixture).map(({ depth, text }) => ({ depth, text })),
    [
      { depth: 1, text: 'Glycolysis' },
      { depth: 1, text: 'Link reaction' },
      { depth: 1, text: 'TCA cycle' },
      { depth: 2, text: 'Citrate' },
      { depth: 2, text: 'Isocitrate' }
    ]
  );
});

test('Enter continues the parser-owned list level and renumbers only later siblings', () => {
  const caret = mixedIndentFixture.indexOf('Citrate') + 'Citrate'.length;
  const result = markdown.applyMarkdownNewline(
    mixedIndentFixture,
    { anchor: caret, focus: caret }
  );
  const expected = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '\t1. Citrate',
    '\t2. ',
    '    3. Isocitrate'
  ].join('\n');

  assert.equal(result.source, expected);
  assert.equal(result.editKind, 'list-continuation');
  assert.deepEqual(result.selection, { anchor: caret + '\n\t2. '.length, focus: caret + '\n\t2. '.length });
  const nested = listItemsAtDepth(result.source).filter((item) => item.depth === 2);
  assert.deepEqual(nested.map((item) => item.text), ['Citrate', '', 'Isocitrate']);
  assert.equal(nested.every((item) => item.depth === 2), true);
});

test('Enter derives its raw prefix from the replacement start before O1 ordered normalization', () => {
  const source = '1. Shallow\n\t1. Deep';
  const anchor = source.indexOf('Shallow') + 3;
  const focus = source.indexOf('Deep') + 2;
  const result = markdown.applyMarkdownNewline(source, { anchor, focus });

  // The expanded O1 list oracle established that the inserted prefix is
  // derived from the shallow replacement start, then the resulting physical
  // ordered run is normalized.  The old assertion stopped before that second
  // source-authoritative step and therefore expected a stale `1.` marker.
  assert.equal(result.replacement, '\n1. ');
  assert.equal(result.source, '1. Sha\n2. ep');
  assert.deepEqual(result.selection, { anchor: 10, focus: 10 });
  assert.equal(result.replacement.includes('\t'), false);
});

test('Enter preserves quote-like code indentation while O1 continues a physical ordered marker', () => {
  // O1 treats the source-visible ordered token as the editing owner even
  // though CommonMark parses this standalone four-space row as indented code.
  const ordered = '    2. code';
  const orderedResult = markdown.applyMarkdownNewline(ordered, {
    anchor: ordered.length,
    focus: ordered.length
  });
  assert.equal(orderedResult.source, `${ordered}\n    3. `);
  assert.equal(orderedResult.editKind, 'list-continuation');

  // The frozen non-list control remains parser-owned indented code.
  const quoted = '    > code';
  const quotedResult = markdown.applyMarkdownNewline(quoted, {
    anchor: quoted.length,
    focus: quoted.length
  });
  assert.equal(quotedResult.source, `${quoted}\n    `);
  assert.equal(quotedResult.editKind, 'indented-code-continuation');

  const crlf = '```js\r\n  first\r\n```';
  const caret = crlf.indexOf('first') + 'first'.length;
  const result = markdown.applyMarkdownNewline(crlf, { anchor: caret, focus: caret });
  assert.equal(result.replacement, '\r\n  ');
  assert.equal(result.editKind, 'fenced-code-continuation');

  for (const fenced of ['```\n1. A\n```', '~~~js\n9) code\n~~~']) {
    const fencedCaret = fenced.indexOf('\n', fenced.indexOf('\n') + 1);
    const fencedResult = markdown.applyMarkdownNewline(fenced, {
      anchor: fencedCaret,
      focus: fencedCaret
    });
    assert.equal(
      fencedResult.source,
      `${fenced.slice(0, fencedCaret)}\n${fenced.slice(fencedCaret)}`
    );
    assert.equal(fencedResult.editKind, 'fenced-code-continuation');
  }
});

test('Enter and Shift+Enter use the raw physical quote-depth state machine', () => {
  for (const prefix of ['> ', '>> ', '>>> ', '> > ']) {
    const source = `${prefix}Quote`;
    const result = markdown.applyMarkdownNewline(source, {
      anchor: source.length,
      focus: source.length
    });
    assert.equal(result.source, `${source}\n${prefix}`);
    assert.equal(result.replacement, `\n${prefix}`);
    assert.equal(result.editKind, 'quote-continuation');
    assert.deepEqual(result.selection, {
      anchor: source.length + prefix.length + 1,
      focus: source.length + prefix.length + 1
    });
  }

  const middle = '>> abcdef';
  const middleCaret = '>> abc'.length;
  const split = markdown.applyMarkdownNewline(middle, {
    anchor: middleCaret,
    focus: middleCaret
  });
  assert.equal(split.source, '>> abc\n>> def');
  assert.deepEqual(split.selection, {
    anchor: middleCaret + '\n>> '.length,
    focus: middleCaret + '\n>> '.length
  });

  let stepped = '>>> Quote\n>>> ';
  for (const expected of [
    '>>> Quote\n>> ',
    '>>> Quote\n> ',
    '>>> Quote\n\n'
  ]) {
    const result = markdown.applyMarkdownNewline(stepped, {
      anchor: stepped.length,
      focus: stepped.length
    });
    assert.equal(result.source, expected);
    assert.equal(result.editKind, 'quote-outdent');
    assert.deepEqual(result.selection, {
      anchor: expected.length,
      focus: expected.length
    });
    stepped = result.source;
  }

  const shiftedNonempty = markdown.applyMarkdownNewline('>> Quote', {
    anchor: '>> Quote'.length,
    focus: '>> Quote'.length
  }, { inputType: 'insertLineBreak' });
  assert.equal(shiftedNonempty.source, '>> Quote\n>> ');
  assert.equal(shiftedNonempty.editKind, 'quote-continuation');

  const shiftedEmptySource = '>> Quote\n>> ';
  const shiftedEmpty = markdown.applyMarkdownNewline(shiftedEmptySource, {
    anchor: shiftedEmptySource.length,
    focus: shiftedEmptySource.length
  }, { inputType: 'insertLineBreak' });
  assert.equal(shiftedEmpty.source, '>> Quote\n>> \n>> ');
  assert.equal(shiftedEmpty.editKind, 'quote-continuation');

  const crlf = '> Quote\r\n> ';
  const crlfExit = markdown.applyMarkdownNewline(crlf, {
    anchor: crlf.length,
    focus: crlf.length
  });
  assert.equal(crlfExit.source, '> Quote\r\n\r\n');

  const quotedList = '> 1. Item';
  const listContinuation = markdown.applyMarkdownNewline(quotedList, {
    anchor: quotedList.length,
    focus: quotedList.length
  });
  assert.equal(listContinuation.source, '> 1. Item\n> 1. ');
  assert.equal(listContinuation.editKind, 'list-continuation');
});

test('explicitly lowered quote prefixes close lazy inner quote ownership', () => {
  const depthTwo = markdown.parseMarkdownDocument('>> Quote\n> X');
  assert.deepEqual(
    depthTwo.children[0].children.map((node) => node.type),
    ['blockquote', 'paragraph']
  );
  assert.equal(depthTwo.children[0].children[1].children[0].value, 'X');
  assert.deepEqual(depthTwo.children[0].children[1].position, {
    start: { line: 2, column: 3, offset: 11 },
    end: { line: 2, column: 4, offset: 12 }
  });
  const depthThree = markdown.parseMarkdownDocument('>>> Quote\n>> X');
  assert.deepEqual(
    depthThree.children[0].children[0].children.map((node) => node.type),
    ['blockquote', 'paragraph']
  );
  const ordinaryLazy = markdown.parseMarkdownDocument('>> Quote\nX');
  assert.equal(ordinaryLazy.children[0].children[0].children.length, 1);
  assert.equal(ordinaryLazy.children[0].children[0].children[0].children[0].value, 'Quote\nX');
});

test('Tab and Shift+Tab change one parser-owned list level with mixed local styles', () => {
  const caret = mixedIndentFixture.indexOf('Isocitrate') + 2;
  const indented = markdown.applyMarkdownIndentation(
    mixedIndentFixture,
    { anchor: caret, focus: caret },
    'indent'
  );
  assert.equal(indented.changed, true);
  assert.equal(indented.indentUnit, '    ');
  assert.equal(
    markdown.markdownStructuralContextAtOffset(
      indented.source,
      indented.source.indexOf('Isocitrate')
    ).listDepth,
    3
  );

  const restored = markdown.applyMarkdownIndentation(
    indented.source,
    indented.selection,
    'outdent'
  );
  assert.equal(restored.source, mixedIndentFixture);
  assert.equal(
    markdown.markdownStructuralContextAtOffset(
      restored.source,
      restored.source.indexOf('Isocitrate')
    ).listDepth,
    2
  );
});

test('O1 Tab keeps the active physical list row even when CommonMark reparses it as code', () => {
  const source = '- First item\n    - Existing child';
  const caret = source.indexOf('First');
  const result = markdown.applyMarkdownIndentation(
    source,
    { anchor: caret, focus: caret },
    'indent'
  );

  // Expanded O1 depth fixtures prove Tab is a physical-line transaction;
  // parser ownership is an observation, not permission to cancel the edit.
  assert.equal(result.changed, true);
  assert.equal(result.source, '    - First item\n    - Existing child');
  assert.deepEqual(result.affectedLineIndices, [0]);
  assert.equal(result.editKind, 'lines');
});

test('O1 list Tab edits the active physical item without rewriting its lazy continuation', () => {
  const source = '- Anchor\n- Parent\nlazy continuation\n- Peer';
  const caret = source.indexOf('Parent');
  const result = markdown.applyMarkdownIndentation(
    source,
    { anchor: caret, focus: caret },
    'indent'
  );

  // This supersedes the old subtree rewrite assertion.  Exact O1 list
  // captures move the active physical row and leave continuation bytes alone.
  assert.equal(result.source, '- Anchor\n    - Parent\nlazy continuation\n- Peer');
  assert.deepEqual(result.affectedLineIndices, [1]);
  assert.equal(
    markdown.markdownStructuralContextAtOffset(
      result.source,
      result.source.indexOf('Parent')
    ).listDepth,
    2
  );
});

test('Tab from a lazy continuation edits that authoritative physical line', () => {
  const source = '- Anchor\n- Parent\nlazy continuation\n- Peer';
  const caret = source.indexOf('continuation') + 3;
  const result = markdown.applyMarkdownIndentation(
    source,
    { anchor: caret, focus: caret },
    'indent'
  );

  assert.equal(result.source, '- Anchor\n- Parent\n    lazy continuation\n- Peer');
  assert.deepEqual(result.affectedLineIndices, [2]);
  assert.equal(result.selection.anchor, caret + 4);
  assert.equal(
    markdown.markdownStructuralContextAtOffset(
      result.source,
      result.source.indexOf('continuation')
    ).listDepth,
    1
  );
});

test('multi-line indentation preserves each line local tab-or-space convention', () => {
  const source = '```text\n\talpha\n    beta\n```';
  const anchor = source.indexOf('alpha');
  const focus = source.indexOf('beta') + 'beta'.length;
  const result = markdown.applyMarkdownIndentation(
    source,
    { anchor, focus },
    'indent'
  );

  assert.equal(result.source, '```text\n\t\talpha\n        beta\n```');
  const restored = markdown.applyMarkdownIndentation(
    result.source,
    result.selection,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('indented code keeps AST ownership while O1 normalizes only its physical ordered token', () => {
  for (const source of ['    2. indented code', '    > indented code']) {
    const caret = source.indexOf('indented');
    const before = markdown.markdownStructuralContextAtOffset(source, caret);
    const result = markdown.applyMarkdownIndentation(
      source,
      { anchor: caret, focus: caret },
      'indent'
    );
    const after = markdown.markdownStructuralContextAtOffset(
      result.source,
      result.source.indexOf('indented')
    );

    assert.equal(before.astNodeType, 'code');
    assert.equal(after.astNodeType, 'code');
    const expected = source.includes('2.')
      ? '        1. indented code'
      : '        > indented code';
    assert.equal(result.source, expected);
    // The physical ordered token follows the captured O1 Tab normalization;
    // the frozen quote-like code control remains byte-stable.
    assert.equal(result.source.includes('1. indented'), source.includes('2.'));
    assert.equal(result.source.includes('> >'), false);
  }
});

test('canonical Backspace follows O1 list-byte ownership and frozen non-list boundaries', () => {
  const nested = '1. Parent\n\t1. Child';
  const childStart = nested.indexOf('Child');
  const outdented = markdown.applyMarkdownStructuralDeletion(
    nested,
    { anchor: childStart, focus: childStart },
    'backward'
  );
  // O1 1.13.7 deletes the nested marker separator byte here.  The previous
  // subtree-outdent expectation directly conflicted with the captured list
  // source oracle and the focused physical-line regression.
  assert.equal(outdented.source, '1. Parent\n\t1.Child');
  assert.deepEqual(outdented.selection, {
    anchor: childStart - 1,
    focus: childStart - 1
  });
  assert.equal(outdented.editKind, 'list-separator');

  const rootItem = markdown.applyMarkdownStructuralDeletion(
    '- item',
    { anchor: 2, focus: 2 },
    'backward'
  );
  assert.equal(rootItem.source, '-item');
  assert.equal(rootItem.selection.anchor, 1);
  assert.equal(rootItem.editKind, 'list-separator');

  const markerOnlyRoot = markdown.applyMarkdownStructuralDeletion(
    '- ',
    { anchor: 2, focus: 2 },
    'backward'
  );
  assert.equal(markerOnlyRoot.source, '');
  assert.equal(markerOnlyRoot.editKind, 'list-marker');

  const quote = markdown.applyMarkdownStructuralDeletion(
    '> quote',
    { anchor: 2, focus: 2 },
    'backward'
  );
  assert.equal(quote.source, '>quote');
  assert.equal(quote.editKind, 'quote-separator');

  const unspacedQuote = markdown.applyMarkdownStructuralDeletion(
    '>quote',
    { anchor: 1, focus: 1 },
    'backward'
  );
  assert.equal(unspacedQuote.source, 'quote');
  assert.equal(unspacedQuote.editKind, 'quote-marker');

  const heading = markdown.applyMarkdownStructuralDeletion(
    '# Heading',
    { anchor: 2, focus: 2 },
    'backward'
  );
  assert.equal(heading.source, '#Heading');
  assert.equal(heading.selection.anchor, 1);
  assert.equal(heading.editKind, 'heading-separator');

  const boundary = markdown.applyMarkdownStructuralDeletion(
    'first\r\nsecond',
    { anchor: 7, focus: 7 },
    'backward'
  );
  assert.equal(boundary.source, 'firstsecond');
  assert.equal(boundary.editKind, 'line-boundary');

  const forwardBoundary = markdown.applyMarkdownStructuralDeletion(
    '1. item\nparagraph',
    { anchor: '1. item'.length, focus: '1. item'.length },
    'forward'
  );
  assert.equal(forwardBoundary.source, '1. itemparagraph');
  assert.equal(forwardBoundary.editKind, 'line-boundary');
});

test('the semantic editor routes Enter and structural deletion through the AST-owned model', () => {
  assert.match(
    viewSource,
    /function applySemanticNewlineInput\([^]*?model\.applyMarkdownNewline\(state\.body, selection, \{ inputType \}\)[^]*?afterSelection: result\.selection/
  );
  assert.match(
    viewSource,
    /function applyMarkdownStructuralDeletionShortcut\([^]*?model\.applyMarkdownStructuralDeletion\([^]*?afterSelection: result\.selection/
  );
  assert.match(
    viewSource,
    /const result = structural\?\.changed[^]*?markdownMarkerDeletionEdit\([^]*?markdownSourceMarkerRanges\(state\.bodyRoot\)/
  );
  assert.match(
    viewSource,
    /event\.key === 'Backspace' \|\| event\.key === 'Delete'[^]*?applyMarkdownStructuralDeletionShortcut/
  );
  assert.match(
    viewSource,
    /function syncSemanticDocumentInput\([^]*?semanticSourceFromNode\(state\.bodyRoot\)[^]*?normalizeSemanticOrderedMarkerInput\([^]*?previousSource,[^]*?rawNextSource,[^]*?const nextSource = normalizedOrderedMarkers[^]*?recordStateMarkdownEdit/
  );
  assert.match(
    viewSource,
    /function normalizeSemanticOrderedMarkerInput\([^]*?normalizeMarkdownOrderedMarkersAfterEdit\(previousSource, rawNextSource/
  );
  assert.match(
    viewSource,
    /if \(!difference\.changed && !forceRender\) \{[^]*?if \((?:raw|dom)Difference\.changed\) \{[^]*?renderSemanticDocumentBlocks\(state, state\.bodyRoot\)[^]*?restoreSemanticSelection/
  );
  assert.doesNotMatch(
    viewSource,
    /function markdownEnterReplacement|currentLine\.match\(\/\^\\s\*\(\?:\[-\+\*\]/,
    'production Enter must not retain a regex-owned list/quote hierarchy'
  );
});
