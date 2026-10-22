const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function apply(source, anchor, focus = anchor, direction = 'indent') {
  return markdown.applyMarkdownIndentation(source, { anchor, focus }, direction);
}

test('single-caret ordered indentation creates a real nested list and restores local numbering', () => {
  const source = '1. Parent\n2. Child';
  const caret = source.indexOf('Child') + 2;
  const indented = apply(source, caret);

  assert.equal(indented.source, '1. Parent\n    1. Child');
  assert.equal(indented.indentUnit, '    ');
  assert.equal(indented.selection.anchor, caret + 4);
  assert.equal(indented.selection.focus, caret + 4);
  const tree = markdown.parseMarkdownDocument(indented.source);
  const parentItem = tree.children[0].children[0];
  const nestedList = parentItem.children.find((child) => child.type === 'list');
  assert.equal(nestedList?.ordered, true);
  assert.equal(nestedList?.start, 1);
  assert.match(
    markdown.renderMarkdown(indented.source),
    /<ol><li><p>Parent<\/p><ol><li><p>Child<\/p><\/li><\/ol><\/li><\/ol>/
  );

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
  assert.deepEqual(restored.selection, { anchor: caret, focus: caret });
});

test('O1 task-list Tab moves only the active physical item by four spaces', () => {
  const source = '- Parent\n- [ ] Child\n    - Existing grandchild\n- Sibling';
  const caret = source.indexOf('Child') + 2;
  const indented = apply(source, caret);

  assert.equal(indented.indentUnit, '    ');
  // The expanded O1 list oracle supersedes the former subtree transaction:
  // Tab owns the active physical row and does not rewrite descendant bytes.
  assert.equal(
    indented.source,
    '- Parent\n    - [ ] Child\n    - Existing grandchild\n- Sibling'
  );
  assert.deepEqual(indented.affectedLineIndices, [1]);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('O1 list Tab uses a four-space physical delta across local indentation styles', () => {
  const fixtures = [
    {
      name: 'required ordered fixture',
      source: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. Isocitrate',
        '      1. deeper',
        '   3. Succinate',
        '4. Next'
      ].join('\n'),
      target: 'Isocitrate',
      indentedLine: '       1. Isocitrate',
      retainedDescendant: '      2. deeper'
    },
    {
      name: 'two-space unordered fixture',
      source: '- Parent\n  - A\n  - B\n- Next',
      target: 'B',
      indentedLine: '      - B'
    },
    {
      name: 'two-space task fixture',
      source: '- [ ] Parent\n  - [ ] A\n  - [ ] B\n- [ ] Next',
      target: 'B',
      indentedLine: '      - [ ] B'
    },
    {
      name: 'three-space mixed fixture',
      source: [
        '1. Ordered parent',
        '   - Bullet child',
        '     1. Number grandchild',
        '     2. Number sibling',
        '   - Bullet sibling',
        '2. Ordered next'
      ].join('\n'),
      target: 'Bullet sibling',
      indentedLine: '       - Bullet sibling',
      roundTripExpected: [
        '1. Ordered parent',
        '   - Bullet child',
        '     1. Number grandchild',
        '     2. Number sibling',
        '   - Bullet sibling',
        '1. Ordered next'
      ].join('\n')
    }
  ];

  for (const fixture of fixtures) {
    const caret = fixture.source.indexOf(fixture.target) + 1;
    const indented = apply(fixture.source, caret);
    assert.equal(indented.changed, true, `${fixture.name}: indent changed`);
    assert.equal(indented.source.includes(fixture.indentedLine), true,
      `${fixture.name}: exact one-level indentation`);
    if (fixture.retainedDescendant) {
      assert.equal(indented.source.includes(fixture.retainedDescendant), true,
        `${fixture.name}: descendant bytes stay put while O1 renumbers the physical run`);
    }

    const outdented = apply(
      indented.source,
      indented.selection.anchor,
      indented.selection.focus,
      'outdent'
    );
    assert.equal(outdented.changed, true, `${fixture.name}: outdent changed`);
    assert.equal(
      outdented.source,
      fixture.roundTripExpected || fixture.source,
      `${fixture.name}: exact O1 physical transaction and ordered normalization`
    );
  }
});

test('O1 first-item Tab remains physical before a blank-separated blockquote', () => {
  const source = [
    '- Child',
    '    - Existing grandchild',
    '',
    '> First',
    '> Second'
  ].join('\n');
  const caret = source.indexOf('Child') + 2;
  const indented = apply(source, caret);

  assert.equal(indented.source, [
    '    - Child',
    '    - Existing grandchild',
    '',
    '> First',
    '> Second'
  ].join('\n'));
  assert.equal(indented.changed, true);
  assert.equal(indented.editKind, 'lines');
  assert.deepEqual(indented.affectedLineIndices, [0]);
});

test('O1 first-item Tab remains physical before an immediate blockquote', () => {
  const source = '- Child\n    - Existing grandchild\n> First\n> Second';
  const caret = source.indexOf('Child') + 2;
  const indented = apply(source, caret);

  assert.equal(indented.source, '    - Child\n    - Existing grandchild\n> First\n> Second');
  assert.equal(indented.changed, true);
  assert.equal(indented.editKind, 'lines');
  assert.deepEqual(indented.affectedLineIndices, [0]);
});

test('a list inside an outer blockquote indents its content without deepening the quote', () => {
  const source = [
    '> - Parent',
    '> - Child',
    '>     - Existing grandchild',
    '>',
    '> Separate quote'
  ].join('\n');
  const caret = source.indexOf('Child') + 2;
  const indented = apply(source, caret);

  assert.equal(indented.source, [
    '> - Parent',
    '>     - Child',
    '>         - Existing grandchild',
    '>',
    '> Separate quote'
  ].join('\n'));
  assert.deepEqual(indented.affectedLineIndices, [1, 2]);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('O1 list Tab moves the active ordered row without rewriting mixed descendants', () => {
  const source = [
    '1. Parent',
    '2. Child',
    '    - Nested unordered',
    '        1. Nested ordered',
    '3. Peer'
  ].join('\n');
  const caret = source.indexOf('Child');
  const indented = apply(source, caret);

  assert.equal(indented.source, [
    '1. Parent',
    '    1. Child',
    '    - Nested unordered',
    '        1. Nested ordered',
    '3. Peer'
  ].join('\n'));
  // Exact expanded O1 traces make Tab a physical-line edit. Descendant
  // marker bytes remain untouched even when parser ownership changes.
  assert.deepEqual(indented.affectedLineIndices, [1]);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('ordered run indentation resets only its new nested root', () => {
  const source = [
    '1. Parent',
    '2. First child',
    '3. Second child',
    '',
    '9. Unrelated list'
  ].join('\n');
  const anchor = source.indexOf('2. First');
  const focus = source.indexOf('3. Second') + '3. Second child'.length;
  const indented = apply(source, anchor, focus);

  assert.equal(indented.source, [
    '1. Parent',
    '    1. First child',
    '    3. Second child',
    '',
    '9. Unrelated list'
  ].join('\n'));

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('ordered sibling runs remain one run when their descendants occupy intervening lines', () => {
  const source = [
    '1. Root',
    '   1. Anchor',
    '   2. First',
    '      - First child',
    '   3. Second',
    '      - Second child',
    '2. Next'
  ].join('\n');
  const anchor = source.indexOf('2. First');
  const focus = source.indexOf('Second child') + 'Second child'.length;
  const indented = apply(source, anchor, focus);

  assert.equal(indented.source, [
    '1. Root',
    '   1. Anchor',
    '      1. First',
    '         - First child',
    '      3. Second',
    '         - Second child',
    '2. Next'
  ].join('\n'));

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('an explicit nonsequential marker becomes a valid nested-list start', () => {
  const source = '1. A\n3. B';
  const caret = source.indexOf('B');
  const indented = apply(source, caret);

  assert.equal(indented.source, '1. A\n    1. B');
  assert.equal(
    markdown.markdownStructuralContextAtOffset(
      indented.source,
      indented.source.indexOf('B')
    ).listDepth,
    2
  );
});

test('O1 wide ordered-marker Tab still uses the four-space editor unit', () => {
  const source = '999. A\n1000. B';
  const caret = source.indexOf('B');
  const indented = apply(source, caret);

  assert.equal(indented.changed, true);
  assert.equal(indented.source, '999. A\n    1. B');
  assert.equal(indented.indentUnit, '    ');
  assert.equal(
    markdown.markdownStructuralContextAtOffset(
      indented.source,
      indented.source.indexOf('B')
    ).astNodeType,
    'text'
  );
  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('O1 physical Tab leaves unquoted descendants while quoted-list ownership stays frozen', () => {
  const fixtures = [
    {
      source: [
        '- Root',
        '  - Anchor',
        '  - Target',
        '    > Quote one',
        '    > Quote two',
        '  - Peer',
        '- Next'
      ].join('\n'),
      expected: [
        '- Root',
        '  - Anchor',
        '      - Target',
        '    > Quote one',
        '    > Quote two',
        '  - Peer',
        '- Next'
      ].join('\n'),
      affectedLineIndices: [2]
    },
    {
      source: [
        '> - Root',
        '>   - Anchor',
        '>   - Target',
        '>     > Quote one',
        '>     > Quote two',
        '>   - Peer',
        '> - Next'
      ].join('\n'),
      expected: [
        '> - Root',
        '>   - Anchor',
        '>     - Target',
        '>       > Quote one',
        '>       > Quote two',
        '>   - Peer',
        '> - Next'
      ].join('\n'),
      affectedLineIndices: [2, 3, 4]
    }
  ];

  for (const fixture of fixtures) {
    const caret = fixture.source.indexOf('Target') + 1;
    const quoteDepth = markdown.markdownStructuralContextAtOffset(
      fixture.source,
      fixture.source.indexOf('Quote one')
    ).quoteDepth;
    const indented = apply(fixture.source, caret);

    assert.equal(indented.source, fixture.expected);
    assert.deepEqual(indented.affectedLineIndices, fixture.affectedLineIndices);
    assert.equal(
      markdown.markdownStructuralContextAtOffset(
        indented.source,
        indented.source.indexOf('Quote one')
      ).quoteDepth,
      quoteDepth
    );

    const restored = apply(
      indented.source,
      indented.selection.anchor,
      indented.selection.focus,
      'outdent'
    );
    assert.equal(restored.source, fixture.source);
  }
});

test('a quoted-list lazy continuation round-trips without inventing a raw quote marker', () => {
  const source = [
    '> - Root',
    '>   - Anchor',
    '>   - Target',
    'lazy continuation',
    '>   - Peer',
    '> - Next'
  ].join('\n');
  const caret = source.indexOf('Target') + 1;
  const before = markdown.markdownStructuralContextAtOffset(
    source,
    source.indexOf('lazy continuation')
  );
  assert.equal(before.listDepth, 2);
  assert.equal(before.quoteDepth, 1);

  const indented = apply(source, caret);
  assert.equal(indented.source, [
    '> - Root',
    '>   - Anchor',
    '>     - Target',
    '  lazy continuation',
    '>   - Peer',
    '> - Next'
  ].join('\n'));
  const after = markdown.markdownStructuralContextAtOffset(
    indented.source,
    indented.source.indexOf('lazy continuation')
  );
  assert.equal(after.listDepth, 3);
  assert.equal(after.quoteDepth, 1);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('outdenting a top-level quoted list removes one ambient quote from its whole subtree', () => {
  const source = [
    '> - Root',
    '> - Target',
    '>   - Child',
    '>     > Quote child',
    '> - Peer'
  ].join('\n');
  const caret = source.indexOf('Target') + 1;
  const outdented = apply(source, caret, caret, 'outdent');

  assert.equal(outdented.source, [
    '> - Root',
    '- Target',
    '  - Child',
    '    > Quote child',
    '> - Peer'
  ].join('\n'));
  for (const content of ['Target', 'Child', 'Quote child']) {
    const before = markdown.markdownStructuralContextAtOffset(source, source.indexOf(content));
    const after = markdown.markdownStructuralContextAtOffset(
      outdented.source,
      outdented.source.indexOf(content)
    );
    assert.equal(after.listDepth, before.listDepth);
    assert.equal(after.quoteDepth, before.quoteDepth - 1);
  }
});

test('outdenting an unindented top-level list root cannot detach its child subtree', () => {
  const source = '- Root\n  - Child\n    > Quote child\n- Peer';
  const caret = source.indexOf('Root') + 1;
  const outdented = apply(source, caret, caret, 'outdent');

  assert.equal(outdented.changed, false);
  assert.equal(outdented.source, source);
});

test('O1 outdent aligns only the active source-indented root row', () => {
  const source = '  - Root\n    - Child\n      > Quote child\n- Peer';
  const caret = source.indexOf('Root') + 1;
  const outdented = apply(source, caret, caret, 'outdent');

  assert.equal(outdented.source, '- Root\n    - Child\n      > Quote child\n- Peer');
  assert.deepEqual(outdented.affectedLineIndices, [0]);
});

test('O1 deep list Tab applies four physical spaces and exact ordered normalization', () => {
  const fixtures = [
    {
      source: [
        '1. Root',
        '   1. Branch',
        '      1. Anchor',
        '      2. Target',
        '   2. Peer',
        '2. Next'
      ].join('\n'),
      expectedLine: '          1. Target',
      roundTripExpected: [
        '1. Root',
        '   1. Branch',
        '      1. Anchor',
        '      2. Target',
        '   2. Peer',
        '3. Next'
      ].join('\n')
    },
    {
      source: [
        '- Root',
        '  - Branch',
        '    - Anchor',
        '    - Target',
        '  - Peer',
        '- Next'
      ].join('\n'),
      expectedLine: '        - Target'
    },
    {
      source: [
        '1. Root',
        '   - Branch',
        '     - Anchor',
        '     - Target',
        '   - Peer',
        '2. Next'
      ].join('\n'),
      expectedLine: '         - Target'
    },
    {
      source: [
        '1. Root',
        '   - Branch',
        '     1. Anchor',
        '     2. Target',
        '   - Peer',
        '2. Next'
      ].join('\n'),
      expectedLine: '         1. Target'
    }
  ];

  for (const fixture of fixtures) {
    const caret = fixture.source.indexOf('Target') + 1;
    const indented = apply(fixture.source, caret);

    assert.equal(indented.changed, true);
    assert.equal(indented.source.includes(fixture.expectedLine), true);
    assert.equal(indented.indentUnit, '    ');
    assert.equal(indented.affectedLineIndices.includes(3), true);

    const restored = apply(
      indented.source,
      indented.selection.anchor,
      indented.selection.focus,
      'outdent'
    );
    assert.equal(restored.source, fixture.roundTripExpected || fixture.source);
  }
});

test('O1 list Tab uses four spaces while preserving untouched literal-tab rows', () => {
  const source = '- Parent\n\t- Anchor\n\t- Child\n\t\t- Grandchild';
  const caret = source.indexOf('Child');
  const indented = apply(source, caret);

  assert.equal(indented.indentUnit, '    ');
  assert.equal(
    indented.source,
    '- Parent\n\t- Anchor\n    \t- Child\n\t\t- Grandchild'
  );
  assert.deepEqual(indented.affectedLineIndices, [2]);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('multi-line partial selections indent once and retain forward direction', () => {
  const source = 'alpha\nbeta\ngamma\ntail';
  const anchor = source.indexOf('alpha') + 1;
  const focus = source.indexOf('gamma') + 3;
  const indented = apply(source, anchor, focus);

  assert.equal(indented.source, '    alpha\n    beta\n    gamma\ntail');
  assert.ok(indented.selection.anchor < indented.selection.focus);
  assert.deepEqual(indented.selectedLineIndices, [0, 1, 2]);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
  assert.deepEqual(restored.selection, { anchor, focus });
});

test('multi-line partial selections retain backward direction and exact CRLF bytes', () => {
  const source = 'alpha\r\nbeta\r\ngamma';
  const anchor = source.indexOf('gamma') + 2;
  const focus = source.indexOf('alpha') + 2;
  const indented = apply(source, anchor, focus);

  assert.equal(indented.source, '    alpha\r\n    beta\r\n    gamma');
  assert.ok(indented.selection.anchor > indented.selection.focus);
  assert.equal(indented.source.match(/\r\n/g)?.length, 2);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
  assert.deepEqual(restored.selection, { anchor, focus });
});

test('a selection ending at the next line start does not indent that next line', () => {
  const source = 'one\ntwo';
  const result = apply(source, 0, source.indexOf('two'));

  assert.equal(result.source, '    one\ntwo');
  assert.deepEqual(result.selectedLineIndices, [0]);
});

test('blockquote indentation changes content indentation without changing quote depth', () => {
  const source = '> First\n> Second';
  const caret = source.indexOf('Second') + 2;
  const indented = apply(source, caret);

  assert.equal(indented.source, '> First\n>     Second');
  assert.equal(indented.source.includes('> \n'), false);

  const restored = apply(
    indented.source,
    indented.selection.anchor,
    indented.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('blockquote indentation edits only the selected physical line', () => {
  const source = '> Parent\n> > Child\n> Peer';
  const caret = source.indexOf('Parent') + 1;
  const indented = apply(source, caret);

  assert.equal(indented.source, '>     Parent\n> > Child\n> Peer');
  assert.deepEqual(indented.affectedLineIndices, [0]);
});

test('Shift+Tab does not remove an unindented blockquote marker', () => {
  const source = '> A\n> B';
  const result = apply(source, source.indexOf('A'), source.indexOf('A'), 'outdent');

  assert.equal(result.changed, false);
  assert.equal(result.source, source);
  assert.deepEqual(result.selection, { anchor: 2, focus: 2 });
});

test('repeated blockquote Tab keeps indentation after the quote marker', () => {
  const source = '>     A';
  const result = apply(source, source.indexOf('A'));

  assert.equal(result.source, '>         A');
  assert.equal(result.source.startsWith('    >'), false);
  assert.deepEqual(result.selection, { anchor: 10, focus: 10 });
});

test('fenced code content indents at line starts without touching fences or code bytes', () => {
  const source = [
    '```javascript',
    'const formula = "$x^2$";',
    'return formula;',
    '```'
  ].join('\n');
  const firstCaret = source.indexOf('formula');
  const oneLine = apply(source, firstCaret);

  assert.equal(oneLine.source, [
    '```javascript',
    '    const formula = "$x^2$";',
    'return formula;',
    '```'
  ].join('\n'));

  const bodyStart = source.indexOf('const');
  const bodyEnd = source.indexOf('return') + 'return formula;'.length;
  const bothLines = apply(source, bodyStart, bodyEnd);
  assert.equal(bothLines.source, [
    '```javascript',
    '    const formula = "$x^2$";',
    '    return formula;',
    '```'
  ].join('\n'));
  assert.equal(bothLines.source.includes('$x^2$'), true);

  const restored = apply(
    bothLines.source,
    bothLines.selection.anchor,
    bothLines.selection.focus,
    'outdent'
  );
  assert.equal(restored.source, source);
});

test('plain paragraph Tab indents only the current physical line from any caret position', () => {
  const source = '你好你好\n你坏你坏\n我？\n草\n修好了吗？';
  const lineStart = source.indexOf('修好了吗？');
  const expected = `${source.slice(0, lineStart)}    ${source.slice(lineStart)}`;

  for (const caret of [lineStart, lineStart + 2, source.length]) {
    const inserted = apply(source, caret);
    assert.equal(inserted.source, expected);
    assert.deepEqual(inserted.selection, { anchor: caret + 4, focus: caret + 4 });
    assert.deepEqual(inserted.selectedLineIndices, [4]);
    assert.deepEqual(inserted.affectedLineIndices, [4]);
    assert.equal(inserted.editKind, 'plain-caret');

    const restored = apply(
      inserted.source,
      inserted.selection.anchor,
      inserted.selection.focus,
      'outdent'
    );
    assert.equal(restored.source, source);
    assert.deepEqual(restored.selection, { anchor: caret, focus: caret });
  }

  const twiceIndented = apply(expected, expected.indexOf('修好了吗？') + 2);
  assert.equal(
    twiceIndented.source,
    `${source.slice(0, lineStart)}        ${source.slice(lineStart)}`
  );
  assert.deepEqual(twiceIndented.affectedLineIndices, [4]);

  const unchanged = apply(source, lineStart + 2, lineStart + 2, 'outdent');
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.source, source);
  assert.deepEqual(unchanged.selection, {
    anchor: lineStart + 2,
    focus: lineStart + 2
  });
});

test('plain multi-line selection targets canonical physical lines three through five only', () => {
  const source = 'line one\nline two\nline three\nline four\nline five';
  const anchor = source.indexOf('line three') + 2;
  const focus = source.length;
  const indented = apply(source, anchor, focus);

  assert.equal(
    indented.source,
    'line one\nline two\n    line three\n    line four\n    line five'
  );
  assert.deepEqual(indented.selectedLineIndices, [2, 3, 4]);
  assert.deepEqual(indented.affectedLineIndices, [2, 3, 4]);
});

test('multi-line outdent removes at most one local indentation unit per line', () => {
  const source = '    alpha\n  beta\n\tgamma\nplain';
  const result = apply(source, 0, source.length, 'outdent');

  assert.equal(result.source, 'alpha\nbeta\ngamma\nplain');
  assert.deepEqual(result.affectedLineIndices, [0, 1, 2]);
});
