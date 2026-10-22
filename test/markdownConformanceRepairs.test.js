'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function exact(result, source, anchor, editKind) {
  assert.equal(result.source, source);
  assert.deepEqual(result.selection, { anchor, focus: anchor });
  if (editKind) assert.equal(result.editKind, editKind);
}

test('O1 1.13.6 Tab transactions use four spaces at plain source boundaries', () => {
  for (const [caret, expectedCaret] of [[0, 4], [2, 6], [5, 9]]) {
    exact(
      markdown.applyMarkdownIndentation('Alpha', { anchor: caret, focus: caret }),
      '    Alpha',
      expectedCaret,
      'plain-caret'
    );
  }
});

test('O1 1.13.6 Tab transactions create one four-space list level', () => {
  const cases = [
    ['1. A\n2. Target', 14, '1. A\n    1. Target', 18],
    ['- A\n- Target', 12, '- A\n    - Target', 16],
    ['- [ ] A\n- [ ] Target', 20, '- [ ] A\n    - [ ] Target', 24]
  ];
  for (const [source, caret, expectedSource, expectedCaret] of cases) {
    exact(
      markdown.applyMarkdownIndentation(source, { anchor: caret, focus: caret }),
      expectedSource,
      expectedCaret,
      'lines'
    );
  }
});

test('O1 ordered marker-boundary indentation restores the caret to the marker start', () => {
  const cases = [
    ['1. Alpha\n2. Aeta\n3. Gamma', 11, 'indent',
      '1. Alpha\n    1. Aeta\n2. Gamma', 13],
    ['1) Alpha\n2) *\n    1) Beta\n3) Gamma', 20, 'outdent',
      '1) Alpha\n2) *\n3) Beta\n4) Gamma', 14],
    ['1. Alpha\n2. A\n3. eta\n4. Gamma', 16, 'indent',
      '1. Alpha\n2. A\n    1. eta\n3. Gamma', 18]
  ];

  for (const [source, caret, direction, expected, expectedCaret] of cases) {
    exact(
      markdown.applyMarkdownIndentation(
        source,
        { anchor: caret, focus: caret },
        direction
      ),
      expected,
      expectedCaret,
      'lines'
    );
  }
});

test('O1 physical continuation outdent normalizes the destination ordered run', () => {
  const cases = [
    [
      '1) Alpha\n2) A\n    1) \n    2) \n    3) Beta\n3) Gamma',
      37,
      '1) Alpha\n2) A\n    1) \n    2) \n3) Beta\n4) Gamma',
      33
    ],
    [
      '1. Alpha\n       - A \n       -  eta\n2. Gamma',
      31,
      '1. Alpha\n       - A \n   -  eta\n1. Gamma',
      27
    ],
    [
      '1. Alpha\n        1. *\n        2. Beta\n2. Gamma',
      32,
      '1. Alpha\n        1. *\n    1. Beta\n2. Gamma',
      26
    ],
    [
      '9. A\n        1. x\n        2. B\n10. C',
      29,
      '9. A\n        1. x\n    1. B\n10. C',
      25
    ],
    [
      '1. Alpha\n       - Beta\n2. Gamma',
      18,
      '1. Alpha\n   - Beta\n1. Gamma',
      14
    ]
  ];

  for (const [source, caret, expected, expectedCaret] of cases) {
    exact(
      markdown.applyMarkdownIndentation(
        source,
        { anchor: caret, focus: caret },
        'outdent'
      ),
      expected,
      expectedCaret,
      'lines'
    );
  }
});

test('O1 detached arbitrary ordered indent starts its new run at one', () => {
  exact(
    markdown.applyMarkdownIndentation(
      '9. A\n\n10. C',
      { anchor: 4, focus: 4 },
      'indent'
    ),
    '    1. A\n\n10. C',
    8,
    'lines'
  );
});

test('O1 1.13.6 Enter continues singleton ordered runs from two', () => {
  exact(
    markdown.applyMarkdownNewline('1. Item', { anchor: 7, focus: 7 }),
    '1. Item\n2. ',
    11,
    'list-continuation'
  );
  const mixed = '1. Root\n    - Bullet\n        1. Child\n2. Tail';
  exact(
    markdown.applyMarkdownNewline(mixed, { anchor: 37, focus: 37 }),
    '1. Root\n    - Bullet\n        1. Child\n        2. \n2. Tail',
    49,
    'list-continuation'
  );
});

test('O1 1.13.6 Enter exits marker-only root list items', () => {
  for (const source of ['1. ', '- ', '- [ ] ']) {
    exact(
      markdown.applyMarkdownNewline(source, { anchor: source.length, focus: source.length }),
      '',
      0,
      'list-exit'
    );
  }
});

test('O1 1.13.6 mixed-list outdent starts a new ordered run at one', () => {
  const source = '1. Root\n    - Bullet\n        1. Child\n        2. Target\n2. Tail';
  exact(
    markdown.applyMarkdownIndentation(source, { anchor: 55, focus: 55 }, 'outdent'),
    '1. Root\n    - Bullet\n        1. Child\n    1. Target\n2. Tail',
    51,
    'lines'
  );
});

test('O1 1.13.6 Backspace deletes only the ATX heading separator', () => {
  exact(
    markdown.applyMarkdownStructuralDeletion(
      '# Heading',
      { anchor: 2, focus: 2 },
      'backward'
    ),
    '#Heading',
    1,
    'heading-separator'
  );
  exact(
    markdown.applyMarkdownStructuralDeletion(
      '#   Heading',
      { anchor: 4, focus: 4 },
      'backward'
    ),
    '#  Heading',
    3,
    'heading-separator'
  );
});

test('O1 1.13.6 ordinary Enter consumes right separator whitespace', () => {
  exact(
    markdown.applyMarkdownNewline('Alpha Beta', { anchor: 5, focus: 5 }),
    'Alpha\nBeta',
    6,
    'paragraph'
  );
  exact(
    markdown.applyMarkdownNewline('Alpha  ', { anchor: 5, focus: 5 }),
    'Alpha\n  ',
    6,
    'paragraph'
  );
  exact(
    markdown.applyMarkdownNewline('123 abc', { anchor: 3, focus: 3 }),
    '123\nabc',
    4,
    'paragraph'
  );
});

test('O1 Enter splits source-owned physical marker tokens without inventing a list owner', () => {
  const cases = [
    [
      '- Alpha\n-ABeta\n- Gamma',
      10,
      '- Alpha\n-A\nBeta\n- Gamma',
      11,
      'physical-list-marker-split'
    ],
    [
      '- Alpha\n* Beta\n+ Gamma',
      9,
      '- Alpha\n*\nBeta\n+ Gamma',
      10,
      'physical-list-marker-split'
    ],
    [
      '1. A\n    1. *B\n2. C',
      11,
      '1. A\n    1.\n    *B\n2. C',
      16,
      'physical-list-marker-split'
    ],
    [
      '- Alpha\n  continued alpha\n      1. \n              1.eta\n- Gamma',
      52,
      '- Alpha\n  continued alpha\n      1. \n              1.\n              eta\n- Gamma',
      67,
      'physical-list-marker-split'
    ],
    [
      '1. A\n2. AB\n3. C',
      7,
      '1. A\n2.\nAB\n2. C',
      8,
      'physical-list-marker-split'
    ],
    [
      '1. Alpha\n- Beta\n1. Gamma',
      10,
      '1. Alpha\n-\nBeta\n2. Gamma',
      11,
      'physical-list-marker-split'
    ],
    [
      '1. Alpha\n   - \n   -Beta\n1. Gamma',
      19,
      '1. Alpha\n   - \n   -\n2. Beta\n3. Gamma',
      23,
      'physical-parent-list-continuation'
    ]
  ];

  for (const [source, caret, expected, expectedCaret, editKind] of cases) {
    exact(
      markdown.applyMarkdownNewline(source, { anchor: caret, focus: caret }),
      expected,
      expectedCaret,
      editKind
    );
  }
});

test('O1 Enter preserves line-start bytes and consumes only a semantic right separator', () => {
  const cases = [
    ['1. A\n    1. *\n2. C', 14, '1. A\n    1. *\n\n2. C', 15, 'physical-line-start'],
    ['1. Alpha\n\n 1Beta\n1. Gamma', 10,
      '1. Alpha\n\n\n 1Beta\n1. Gamma', 12, 'physical-line-start'],
    ['+ Alpha\n+ A* Beta\n+ Gamma', 12,
      '+ Alpha\n+ A*\n+ Beta\n+ Gamma', 15, 'list-continuation'],
    ['0. A\n    1.  B\n1. C', 12,
      '0. A\n    1. \n    2. B\n1. C', 20, 'list-continuation']
  ];

  for (const [source, caret, expected, expectedCaret, editKind] of cases) {
    exact(
      markdown.applyMarkdownNewline(source, { anchor: caret, focus: caret }),
      expected,
      expectedCaret,
      editKind
    );
  }
});

test('O1 1.13.7 conventions remain explicit around the repaired transactions', () => {
  exact(
    markdown.applyMarkdownNewline('1. A\n1. B', { anchor: 9, focus: 9 }),
    '1. A\n1. B\n1. ',
    13,
    'list-continuation'
  );
  exact(
    markdown.applyMarkdownNewline('> 1. Item', { anchor: 9, focus: 9 }),
    '> 1. Item\n> 1. ',
    15,
    'list-continuation'
  );
  exact(
    markdown.applyMarkdownNewline('>> ', { anchor: 3, focus: 3 }),
    '> ',
    2,
    'quote-outdent'
  );
  exact(
    markdown.applyMarkdownNewline('>>> ', { anchor: 4, focus: 4 }),
    '>> ',
    3,
    'quote-outdent'
  );
  exact(
    markdown.applyMarkdownIndentation(
      '1. A\n\t1. Anchor\n\t2. Target',
      { anchor: 22, focus: 22 }
    ),
    // Current O1 applies the configured four-space physical editor step;
    // it does not derive a second literal tab from neighbouring source.
    '1. A\n\t1. Anchor\n    \t1. Target',
    26,
    'lines'
  );
});

test('O1 1.13.6 Tab and Shift+Tab preserve quote markers while editing content indentation', () => {
  const source = '> A\n> B';
  const indented = markdown.applyMarkdownIndentation(
    source,
    { anchor: 2, focus: 2 },
    'indent'
  );
  assert.equal(indented.source, '>     A\n> B');
  assert.deepEqual(indented.selection, { anchor: 6, focus: 6 });

  const unchanged = markdown.applyMarkdownIndentation(
    source,
    { anchor: 2, focus: 2 },
    'outdent'
  );
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.source, source);
  assert.deepEqual(unchanged.selection, { anchor: 2, focus: 2 });
});

test('O1 1.13.6 Shift+Enter inserts a soft line with physical-context indentation', () => {
  const plain = markdown.applyMarkdownNewline(
    'Alpha',
    { anchor: 5, focus: 5 },
    { inputType: 'insertLineBreak' }
  );
  assert.equal(plain.source, 'Alpha\n');
  assert.equal(plain.replacement, '\n');
  assert.equal(plain.editKind, 'line-break');
  assert.deepEqual(plain.selection, { anchor: 6, focus: 6 });

  const indentedSource = 'A\nB\n    C\nD';
  const indented = markdown.applyMarkdownNewline(
    indentedSource,
    { anchor: 9, focus: 9 },
    { inputType: 'insertLineBreak' }
  );
  assert.equal(indented.source, 'A\nB\n    C\n    \nD');
  assert.equal(indented.replacement, '\n    ');
  assert.equal(indented.editKind, 'indented-line-break');
  assert.deepEqual(indented.selection, { anchor: 14, focus: 14 });

  const unordered = markdown.applyMarkdownNewline(
    '- Alpha',
    { anchor: 7, focus: 7 },
    { inputType: 'insertLineBreak' }
  );
  assert.equal(unordered.source, '- Alpha\n  ');
  assert.equal(unordered.editKind, 'list-line-break');
  assert.deepEqual(unordered.selection, { anchor: 10, focus: 10 });

  const ordered = markdown.applyMarkdownNewline(
    '1. Alpha',
    { anchor: 8, focus: 8 },
    { inputType: 'insertLineBreak' }
  );
  assert.equal(ordered.source, '1. Alpha\n   ');
  assert.deepEqual(ordered.selection, { anchor: 12, focus: 12 });
});

test('O1 quote Enter preserves source padding after the structural quote prefix', () => {
  const cases = [
    ['>  A', 3, '>  \n>  A', 7],
    ['>>>  A', 5, '>>>  \n>>>  A', 11]
  ];
  for (const [source, caret, expectedSource, expectedCaret] of cases) {
    const context = markdown.markdownStructuralContextAtOffset(source, caret);
    assert.equal(source.slice(context.indentationStart, context.contentStart), ' ');
    exact(
      markdown.applyMarkdownNewline(source, { anchor: caret, focus: caret }),
      expectedSource,
      expectedCaret,
      'quote-continuation'
    );
  }
});

test('O1 task-list Shift+Enter aligns continuation text after the full task prefix', () => {
  exact(
    markdown.applyMarkdownNewline(
      '- [ ] A\n- [ ] ',
      { anchor: 14, focus: 14 },
      { inputType: 'insertLineBreak' }
    ),
    '- [ ] A\n- [ ] \n      ',
    21,
    'list-line-break'
  );
});

test('O1 1.13.6 ordinary Enter retains raw continuation indentation outside code AST nodes', () => {
  const source = 'A\nB\n    C\nD';
  const result = markdown.applyMarkdownNewline(source, { anchor: 9, focus: 9 });
  assert.equal(result.source, 'A\nB\n    C\n    \nD');
  assert.equal(result.replacement, '\n    ');
  assert.deepEqual(result.selection, { anchor: 14, focus: 14 });

  const tabbed = markdown.applyMarkdownNewline(
    '\tAlpha',
    { anchor: 6, focus: 6 },
    { inputType: 'insertLineBreak' }
  );
  assert.equal(tabbed.source, '\tAlpha\n\t');
  assert.deepEqual(tabbed.selection, { anchor: 8, focus: 8 });
});

test('O1 1.13.6 native deletion renumbers only the touched physical ordered-list run', () => {
  const normalize = (before, after, selection = { anchor: 3, focus: 3 }) => (
    markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, after, {
      inputType: 'deleteContentForward',
      selection
    })
  );

  assert.equal(
    normalize('1. Alpha\n2. Beta', '1. lpha\n2. Beta').source,
    '1. lpha\n2. Beta'
  );
  assert.equal(
    normalize('3. Alpha\n4. Beta', '3. lpha\n4. Beta').source,
    '3. lpha\n4. Beta'
  );
  assert.equal(
    normalize('1. Alpha\n1. Beta', '1. lpha\n1. Beta').source,
    '1. lpha\n2. Beta'
  );

  const nested = normalize(
    '1. Root\n   - Child\n2. Next\n3. Last',
    '1. Root\n   - hild\n2. Next\n3. Last',
    { anchor: 13, focus: 13 }
  );
  assert.equal(nested.source, '1. Root\n   - hild\n1. Next\n2. Last');
  assert.deepEqual(nested.selection, { anchor: 13, focus: 13 });
  assert.equal(nested.edits.length, 2);
});

test('O1 physical marker invalidation continues from the edited ordinal', () => {
  const backward = markdown.applyMarkdownStructuralDeletion(
    '1. Alpha\n2. Beta\n3. Gamma',
    { anchor: 12, focus: 12 },
    'backward'
  );
  assert.equal(backward.source, '1. Alpha\n2.Beta\n2. Gamma');
  assert.deepEqual(backward.selection, { anchor: 11, focus: 11 });
  assert.equal(backward.editKind, 'list-separator');

  const forward = markdown.applyMarkdownStructuralDeletion(
    '1. A\n2. 1B\n3. C',
    { anchor: 7, focus: 7 },
    'forward'
  );
  assert.equal(forward.source, '1. A\n2.1B\n2. C');
  assert.deepEqual(forward.selection, { anchor: 7, focus: 7 });
  assert.equal(forward.editKind, 'ordered-character');

  const delimiter = markdown.applyMarkdownStructuralDeletion(
    '1. Alpha\n2. Beta\n3. Gamma',
    { anchor: 11, focus: 11 },
    'backward'
  );
  assert.equal(delimiter.source, '1. Alpha\n2 Beta\n2. Gamma');
  assert.deepEqual(delimiter.selection, { anchor: 10, focus: 10 });
  assert.equal(delimiter.editKind, 'ordered-character');
});

test('O1 invalidated nested bullet separator bridges its parent ordered run', () => {
  for (const [content, expectedContent] of [
    ['Beta', 'Beta'],
    ['1Beta', '1Beta'],
    ['*Beta', '*Beta']
  ]) {
    const result = markdown.applyMarkdownStructuralDeletion(
      `1. Alpha\n   - ${content}\n1. Gamma`,
      { anchor: 14, focus: 14 },
      'backward'
    );
    assert.equal(result.source, `1. Alpha\n   -${expectedContent}\n2. Gamma`);
    assert.deepEqual(result.selection, { anchor: 13, focus: 13 });
    assert.equal(result.editKind, 'list-separator');
  }
});

test('O1 claims a list-content Backspace that would create a Chromium NBSP filler', () => {
  const result = markdown.applyMarkdownStructuralDeletion(
    '4. A\n5. *\n6. x B\n7. C',
    { anchor: 14, focus: 14 },
    'backward'
  );
  assert.equal(result.source, '4. A\n5. *\n6.  B\n7. C');
  assert.equal(result.source.includes('\u00a0'), false);
  assert.deepEqual(result.selection, { anchor: 13, focus: 13 });
  assert.equal(result.editKind, 'list-content-filler-boundary');
});

test('O1 Backspace removes only a root marker-only separator', () => {
  const ordered = markdown.applyMarkdownStructuralDeletion(
    '1. A\n2. *B\n3. \n4. C',
    { anchor: 14, focus: 14 },
    'backward'
  );
  assert.equal(ordered.source, '1. A\n2. *B\n3.\n3. C');
  assert.deepEqual(ordered.selection, { anchor: 13, focus: 13 });
  assert.equal(ordered.editKind, 'list-separator');

  const unordered = markdown.applyMarkdownStructuralDeletion(
    '* Alpha\n* ea\n* \n* Gamma',
    { anchor: 15, focus: 15 },
    'backward'
  );
  assert.equal(unordered.source, '* Alpha\n* ea\n*\n* Gamma');
  assert.deepEqual(unordered.selection, { anchor: 14, focus: 14 });
  assert.equal(unordered.editKind, 'list-separator');

  const remainingSeparator = markdown.applyMarkdownStructuralDeletion(
    '0. A\n1.  \n2. C',
    { anchor: 9, focus: 9 },
    'backward'
  );
  assert.equal(remainingSeparator.source, '0. A\n1. \n2. C');
  assert.deepEqual(remainingSeparator.selection, { anchor: 8, focus: 8 });
});

test('ordered post-edit normalization preserves physical buckets, starts, delimiters, and boundaries', () => {
  const normalize = (before, after, selection = { anchor: 13, focus: 13 }) => (
    markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, after, {
      inputType: 'deleteContentForward',
      selection
    })
  );

  assert.equal(
    normalize(
      '3. Root\n   - Child\n8. Next\n9. Last',
      '3. Root\n   - hild\n8. Next\n9. Last'
    ).source,
    '3. Root\n   - hild\n3. Next\n4. Last'
  );
  assert.equal(
    normalize(
      '1. Root\n    - Child\n2. Next',
      '1. Root\n    - hild\n2. Next',
      { anchor: 14, focus: 14 }
    ).source,
    '1. Root\n    - hild\n2. Next'
  );
  assert.equal(
    normalize(
      '1) Root\n   - Child\n2) Next',
      '1) Root\n   - hild\n2) Next'
    ).source,
    '1) Root\n   - hild\n1) Next'
  );
  assert.equal(
    normalize(
      '1. Root\n   - Child\n\n2. Next',
      '1. Root\n   - hild\n\n2. Next'
    ).source,
    '1. Root\n   - hild\n\n2. Next'
  );

  const multiDigitBefore = '9. Root\n   - Child\n10. Next';
  const multiDigitAfter = '9. Root\n   - hild\n10. Next';
  const mapped = normalize(multiDigitBefore, multiDigitAfter, {
    anchor: multiDigitAfter.length,
    focus: 13
  });
  assert.equal(mapped.source, '9. Root\n   - hild\n9. Next');
  assert.deepEqual(mapped.selection, {
    anchor: multiDigitAfter.length - 1,
    focus: 13
  });

  const insertion = markdown.normalizeMarkdownOrderedMarkersAfterEdit(
    '1. Alpha\n1. Beta',
    '1. xAlpha\n1. Beta',
    {
      inputType: 'insertText',
      selection: { anchor: 4, focus: 4 }
    }
  );
  assert.equal(insertion.source, '1. xAlpha\n2. Beta');
  assert.equal(insertion.changed, true);
});

test('O1 1.13.7 ordered Enter broadly normalizes across descendant boundaries', () => {
  const source = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '   1. Citrate',
    '   2. Isocitrate',
    '      1. deeper',
    '   3. Succinate',
    '4. Next'
  ].join('\n');
  exact(
    markdown.applyMarkdownNewline(source, { anchor: 64, focus: 64 }),
    [
      '1. Glycolysis',
      '2. Link reaction',
      '3. TCA cycle',
      '   1. Citrate',
      '   2. ',
      '   3. Isocitrate',
      '      1. deeper',
      // The current physical-source transaction continues through both the
      // later nested sibling and the following root item.
      '   4. Succinate',
      '5. Next'
    ].join('\n'),
    71,
    'list-continuation'
  );
});

test('O1 marker-only ordered Enter vacates and compacts its root ordinal', () => {
  exact(
    markdown.applyMarkdownNewline('1. A\n2. \n3. C', { anchor: 8, focus: 8 }),
    '1. A\n\n2. C',
    5,
    'list-exit'
  );
});

test('O1 nested bullet edits restart the following three-space physical ordered run', () => {
  const source = [
    '1. Ordered parent',
    '   - Bullet child',
    '     1. Number grandchild',
    '     2. Number sibling',
    '   - Bullet sibling',
    '2. Ordered next'
  ].join('\n');
  exact(
    markdown.applyMarkdownNewline(source, { anchor: 90, focus: 90 }),
    [
      '1. Ordered parent',
      '   - Bullet child',
      '     1. Number grandchild',
      '     2. Number sibling',
      '   - ',
      '   - Bullet sibling',
      '1. Ordered next'
    ].join('\n'),
    96,
    'list-continuation'
  );

  const rawAfter = `${source.slice(0, 90)} ${source.slice(90)}`;
  const inserted = markdown.normalizeMarkdownOrderedMarkersAfterEdit(source, rawAfter, {
    inputType: 'insertText',
    selection: { anchor: 91, focus: 91 }
  });
  assert.equal(inserted.source, [
    '1. Ordered parent',
    '   - Bullet child',
    '     1. Number grandchild',
    '     2. Number sibling',
    '   -  Bullet sibling',
    '1. Ordered next'
  ].join('\n'));
  assert.deepEqual(inserted.selection, { anchor: 91, focus: 91 });
});

test('O1 insertText numbers one three-space physical ordered stream across AST depths', () => {
  const source = '1. A\n2. B\n   1. C\n   2. D\n3. E';
  for (const [text, expectedLine] of [[' ', '   3.  C'], ['>', '   3. >C']]) {
    const rawAfter = `${source.slice(0, 16)}${text}${source.slice(16)}`;
    const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit(source, rawAfter, {
      inputType: 'insertText',
      selection: { anchor: 17, focus: 17 }
    });
    assert.equal(result.source, [
      '1. A',
      '2. B',
      expectedLine,
      '   4. D',
      '5. E'
    ].join('\n'));
    assert.deepEqual(result.selection, { anchor: 17, focus: 17 });
  }
});

test('O1 insertText bridges an owned physical continuation before an ordered child', () => {
  const source = [
    '1. Alpha',
    '   continued alpha',
    '   1. Beta',
    '2. Gamma'
  ].join('\n');

  for (const inserted of ['A', 'x', '1', '*', ' ']) {
    const rawAfter = `${source.slice(0, 34)}${inserted}${source.slice(34)}`;
    const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit(source, rawAfter, {
      inputType: 'insertText',
      selection: { anchor: 35, focus: 35 }
    });
    assert.equal(result.source, [
      '1. Alpha',
      '   continued alpha',
      `   2. ${inserted}Beta`,
      '3. Gamma'
    ].join('\n'));
    assert.deepEqual(result.selection, { anchor: 35, focus: 35 });
  }
});

test('O1 Tab keeps a marker-only ordered item as nested source and compacts its old run', () => {
  exact(
    markdown.applyMarkdownIndentation(
      '1. A\n2.  \n3. C',
      { anchor: 9, focus: 9 },
      'indent'
    ),
    '1. A\n    1.  \n2. C',
    13,
    'lines'
  );
});

test('ordered post-edit normalization does not merge nested ordered scopes', () => {
  const before = '1. Root\n   1. Child\n2. Next';
  const rawAfter = '1. Root\n   1. hild\n2. Next';
  const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, rawAfter, {
    inputType: 'deleteContentForward',
    selection: { anchor: 13, focus: 13 }
  });

  assert.equal(result.source, rawAfter);
  assert.equal(result.changed, false);
  assert.deepEqual(result.edits, []);
});

test('ordered post-edit normalization keeps code opaque when deletion breaks its opening fence', () => {
  const before = '```\n9. A\n9. B\n```';
  const rawAfter = '``\n9. A\n9. B\n```';
  const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, rawAfter, {
    inputType: 'deleteContentBackward',
    selection: { anchor: 2, focus: 2 }
  });

  assert.equal(result.source, rawAfter);
  assert.equal(result.changed, false);
  assert.deepEqual(result.edits, []);
});

test('ordered post-edit normalization does not override a directly edited marker', () => {
  const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit('10. A', '1. A', {
    inputType: 'deleteContentBackward',
    selection: { anchor: 1, focus: 1 }
  });

  assert.equal(result.source, '1. A');
  assert.equal(result.changed, false);
  assert.deepEqual(result.selection, { anchor: 1, focus: 1 });
});

test('ordered post-edit normalization compacts after a marker becomes invalid', () => {
  const before = '1. Alpha\n2. *\n3. Beta\n4. Gamma';
  const inserted = markdown.normalizeMarkdownOrderedMarkersAfterEdit(
    before,
    '1. Alpha\n2. *\n3.* Beta\n4. Gamma',
    {
      inputType: 'insertText',
      selection: { anchor: 17, focus: 17 }
    }
  );
  assert.equal(inserted.source, '1. Alpha\n2. *\n3.* Beta\n3. Gamma');
  assert.deepEqual(inserted.selection, { anchor: 17, focus: 17 });

  const deleted = markdown.normalizeMarkdownOrderedMarkersAfterEdit(
    '1. Alpha\n2. Beta\n3. Gamma',
    '1. Alpha\n2 Beta\n3. Gamma',
    {
      inputType: 'deleteContentBackward',
      selection: { anchor: 10, focus: 10 }
    }
  );
  assert.equal(deleted.source, '1. Alpha\n2 Beta\n2. Gamma');
  assert.deepEqual(deleted.selection, { anchor: 10, focus: 10 });
});

test('ordered post-edit normalization treats dot and parenthesis delimiters as separate runs', () => {
  const before = '1. Alpha\n7) Beta\n8) Gamma';
  const rawAfter = '1. lpha\n7) Beta\n8) Gamma';
  const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, rawAfter, {
    inputType: 'deleteContentForward',
    selection: { anchor: 3, focus: 3 }
  });

  assert.equal(result.source, rawAfter);
  assert.equal(result.changed, false);
  assert.deepEqual(result.edits, []);
});

test('O1 ordinary ordered content Delete stays native without compacting explicit ordinals', () => {
  for (const [source, caret, expected] of [
    ['1. A\n2. B\n3. C', 8, '1. A\n2. \n3. C'],
    ['4. A\n5.  B\n6. C', 9, '4. A\n5.  \n6. C'],
    ['1. A\n2. \n3. x\n4. C', 12, '1. A\n2. \n3. \n4. C']
  ]) {
    const structural = markdown.applyMarkdownStructuralDeletion(
      source,
      { anchor: caret, focus: caret },
      'forward'
    );
    assert.equal(structural.changed, false);
    const normalized = markdown.normalizeMarkdownOrderedMarkersAfterEdit(
      source,
      expected,
      {
        inputType: 'deleteContentForward',
        selection: { anchor: caret, focus: caret }
      }
    );
    assert.equal(normalized.source, expected);
    assert.deepEqual(normalized.selection, { anchor: caret, focus: caret });
  }
});

test('O1 malformed continuation outdent preserves the following explicit run', () => {
  for (const [source, caret, expected, expectedCaret] of [
    [
      '1. Alpha\n2. \n    1. \n    2.\n    eta\n3. Gamma',
      31,
      '1. Alpha\n2. \n    1. \n    2.\neta\n3. Gamma',
      28
    ],
    [
      '1) Alpha\n    1) 1\n    2)eta\n2) Gamma',
      25,
      '1) Alpha\n    1) 1\n2)eta\n2) Gamma',
      21
    ],
    [
      '- Alpha\n  continued alpha\n  1.  \n  2. eta\n- Gamma',
      37,
      '- Alpha\n  continued alpha\n  1.  \n2. eta\n- Gamma',
      35
    ]
  ]) {
    exact(
      markdown.applyMarkdownIndentation(
        source,
        { anchor: caret, focus: caret },
        'outdent'
      ),
      expected,
      expectedCaret,
      'lines'
    );
  }
});

test('O1 malformed physical markers split and continue by source geometry', () => {
  for (const [source, caret, expected, expectedCaret, kind] of [
    ['0. A\n1B\n1. C', 6, '0. A\n1\nB\n1. C', 7, 'physical-list-marker-split'],
    [
      '1. Alpha\n   -eta\n2. Gamma',
      13,
      '1. Alpha\n   -\n2. eta\n3. Gamma',
      17,
      'physical-parent-list-continuation'
    ],
    [
      '1. Alpha\n        2.1Beta\n2. Gamma',
      18,
      '1. Alpha\n        2\n        .1Beta\n2. Gamma',
      27,
      'physical-list-marker-split'
    ],
    [
      '    1. A\n\n10. C',
      8,
      '    1. A\n    2. \n\n10. C',
      16,
      'list-continuation'
    ],
    [
      '1. Alpha\n   -\n   a\n     1. Gamma\n2. Delta',
      16,
      '1. Alpha\n   -\n  \n   a\n     1. Gamma\n2. Delta',
      20,
      'indentation-boundary'
    ]
  ]) {
    exact(
      markdown.applyMarkdownNewline(source, { anchor: caret, focus: caret }),
      expected,
      expectedCaret,
      kind
    );
  }
});

test('O1 continuation Enter restarts or extends only the physically owned ordered run', () => {
  for (const [source, caret, expected, expectedCaret] of [
    [
      '1. Alpha\n    2.x\n    Beta\n2. Gamma',
      21,
      '1. Alpha\n    2.x\n    \n    Beta\n1. Gamma',
      26
    ],
    [
      '1) Alpha\n2)\n    xBeta\n2) Gamma',
      16,
      '1) Alpha\n2)\n    \n    xBeta\n1) Gamma',
      21
    ],
    [
      '1. Alpha\n   Beta\n2. Gamma',
      12,
      '1. Alpha\n   \n2. Beta\n3. Gamma',
      16
    ]
  ]) {
    const result = markdown.applyMarkdownNewline(
      source,
      { anchor: caret, focus: caret }
    );
    assert.equal(result.source, expected);
    assert.deepEqual(result.selection, { anchor: expectedCaret, focus: expectedCaret });
  }
});

test('O1 inline marker insertion overtypes the extra local auto-pair byte', () => {
  const before = '1. Alpha\n   - *Beta\n     1. Gamma\n2. Delta';
  const rawAfter = '1. Alpha\n   - ***Beta\n     1. Gamma\n2. Delta';
  const result = markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, rawAfter, {
    inputType: 'insertText',
    selection: { anchor: 15, focus: 15 }
  });
  assert.equal(result.source, '1. Alpha\n   - **Beta\n     1. Gamma\n2. Delta');
  assert.deepEqual(result.selection, { anchor: 15, focus: 15 });
});

const round2DirectSourceGate = require(
  './markdownConformance/scenarios/v0.3ListRandom500MinimizedRegressionsRound2.json'
);

function round2TypeTextAction(source, selection, text) {
  const start = Math.min(selection.anchor, selection.focus);
  const end = Math.max(selection.anchor, selection.focus);
  const pairedMarker = text === '*' || text === '`';
  if (start === end
    && pairedMarker
    && source[start] === text
    && source[start + 1] === text) {
    return {
      source,
      selection: { anchor: start + 1, focus: start + 1 }
    };
  }
  const autoPaired = start === end
    && pairedMarker
    && (!source[start - 1] || /\s/u.test(source[start - 1]))
    && (!source[start] || /\s/u.test(source[start]) || source[start] === text);
  const replacement = autoPaired ? `${text}${text}` : text;
  const rawAfter = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  return markdown.normalizeMarkdownOrderedMarkersAfterEdit(source, rawAfter, {
    inputType: 'insertText',
    selection: { anchor: start + text.length, focus: start + text.length }
  });
}

function round2DirectActionResult(scenario) {
  const source = scenario.initialSource;
  const selection = scenario.initialSelection;
  const action = scenario.actions[0];
  if (action.id === 'enter') {
    return markdown.applyMarkdownNewline(source, selection);
  }
  if (action.id === 'tab' || action.id === 'shift-tab') {
    return markdown.applyMarkdownIndentation(
      source,
      selection,
      action.id === 'tab' ? 'indent' : 'outdent'
    );
  }
  if (action.id === 'type-text') {
    return round2TypeTextAction(source, selection, action.text);
  }
  if (action.id === 'arrowleft' || action.id === 'arrowright') {
    const delta = action.id === 'arrowleft' ? -1 : 1;
    return {
      source,
      selection: {
        anchor: selection.anchor + delta,
        focus: selection.focus + delta
      }
    };
  }
  if (action.id === 'backspace' || action.id === 'delete') {
    const forward = action.id === 'delete';
    const structural = markdown.applyMarkdownStructuralDeletion(
      source,
      selection,
      forward ? 'forward' : 'backward'
    );
    if (structural.changed) return structural;
    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    if (start !== end) {
      return {
        source: `${source.slice(0, start)}${source.slice(end)}`,
        selection: { anchor: start, focus: start }
      };
    }
    const deletionStart = forward ? start : Math.max(0, start - 1);
    const deletionEnd = forward ? Math.min(source.length, start + 1) : start;
    return {
      source: `${source.slice(0, deletionStart)}${source.slice(deletionEnd)}`,
      selection: { anchor: deletionStart, focus: deletionStart }
    };
  }
  throw new Error(`Unsupported Round-2 direct action ${action.id}`);
}

test('Round-2 one-action source replay is exact and proven affinity suffixes stay explicit', () => {
  const cases = round2DirectSourceGate.sequences.filter((scenario) => {
    const paths = scenario.repairMetadata?.authoritativeDifferencePaths || [];
    return !['undo', 'redo'].includes(scenario.actions.at(-1)?.id)
      && paths.some((path) => path.startsWith('source.') || path.startsWith('selection.'));
  });
  assert.equal(cases.length, 88);
  const oneActionCases = cases.filter((scenario) => scenario.actions.length === 1);
  const affinitySuffixes = cases.filter((scenario) => scenario.actions.length > 1);
  assert.equal(oneActionCases.length, 81);
  assert.equal(affinitySuffixes.length, 7);
  assert.ok(affinitySuffixes.every((scenario) => (
    scenario.repairMetadata?.minimizationStrategy === 'caret-affinity-producing-suffix'
      && scenario.repairMetadata?.o1ReplayReproduced === true
      && scenario.repairMetadata?.requiresO1ReplayValidation === false
  )));
  for (const scenario of oneActionCases) {
    const result = round2DirectActionResult(scenario);
    assert.equal(result.source, scenario.oracleExpected.source, scenario.id);
    assert.deepEqual(
      result.selection,
      scenario.oracleExpected.selection,
      scenario.id
    );
  }
});
