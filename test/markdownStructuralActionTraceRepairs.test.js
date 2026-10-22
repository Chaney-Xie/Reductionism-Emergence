'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function exact(result, source, anchor) {
  assert.equal(result.source, source);
  assert.deepEqual({ ...result.selection }, { anchor, focus: anchor });
}

test('O1 collapsed list Tab targets the authoritative physical line', () => {
  const cases = [
    {
      id: '0d41a3de9d2bd48b00dc',
      source: '- A\n  - \n    \n        - C',
      caret: 18,
      direction: 'outdent',
      expected: '- A\n  - \n    \n    - C',
      expectedCaret: 18
    },
    {
      id: '5cb9e8d7cd01f6445f9c',
      source: '- A\n  - x\n- \n    - C',
      caret: 12,
      direction: 'indent',
      expected: '- A\n  - x\n    - \n    - C',
      expectedCaret: 16
    },
    {
      id: '170d1fc84d06025f2e0d',
      source: [
        '- [ ] Open',
        '- [x] Done',
        '  - [X] Nested done',
        '  - [ ] ',
        '            ',
        '            x ',
        '            ',
        '            ested open',
        '- [ ] Last'
      ].join('\n'),
      caret: 104,
      direction: 'outdent',
      expected: [
        '- [ ] Open',
        '- [x] Done',
        '  - [X] Nested done',
        '  - [ ] ',
        '            ',
        '            x ',
        '            ',
        '        ested open',
        '- [ ] Last'
      ].join('\n'),
      expectedCaret: 100
    },
    {
      id: '0d46d3187e24cacbaf75',
      source: '- Item first line\nx` ordinary continuation\n- Next',
      caret: 19,
      direction: 'indent',
      expected: '- Item first line\n    x` ordinary continuation\n- Next',
      expectedCaret: 23
    }
  ];

  for (const fixture of cases) {
    exact(
      markdown.applyMarkdownIndentation(
        fixture.source,
        { anchor: fixture.caret, focus: fixture.caret },
        fixture.direction
      ),
      fixture.expected,
      fixture.expectedCaret,
      fixture.id
    );
  }
});

test('O1 collapsed leaf-list Tab keeps the four-space editor unit', () => {
  const before = [
    '1. Ordered parent',
    '   - Bullet child',
    '     1. Number grandchild',
    '     2. Number sibling',
    '   - ',
    '   -  Bullet sibling',
    '1. Ordered next'
  ].join('\n');
  const first = markdown.applyMarkdownIndentation(
    before,
    { anchor: 97, focus: 97 },
    'indent'
  );

  exact(first, [
    '1. Ordered parent',
    '   - Bullet child',
    '     1. Number grandchild',
    '     2. Number sibling',
    '   - ',
    '       -  Bullet sibling',
    '1. Ordered next'
  ].join('\n'), 101);
  assert.equal(first.indentUnit, '    ');

  exact(
    markdown.applyMarkdownIndentation(
      first.source,
      first.selection,
      'indent'
    ),
    [
      '1. Ordered parent',
      '   - Bullet child',
      '     1. Number grandchild',
      '     2. Number sibling',
      '   - ',
      '           -  Bullet sibling',
      '1. Ordered next'
    ].join('\n'),
    105
  );
});

test('O1 ordered markers normalize the touched physical run after Tab', () => {
  const cases = [
    {
      source: '1. A\n2.  Ax\n3. C',
      caret: 10,
      direction: 'indent',
      expected: '1. A\n    1.  Ax\n2. C',
      expectedCaret: 14
    },
    {
      source: '1. \n2. C',
      caret: 3,
      direction: 'indent',
      expected: '    1. \n1. C',
      expectedCaret: 7
    },
    {
      source: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. ',
        '   3. Isocitrate',
        '      1. deeper',
        '   3. Succinate',
        '4. Next'
      ].join('\n'),
      caret: 71,
      direction: 'outdent',
      expected: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. ',
        '3. Isocitrate',
        '      1. deeper',
        '   4. Succinate',
        '5. Next'
      ].join('\n'),
      expectedCaret: 68
    },
    {
      source: '1. A\n2. B\n   3. >`C\n   4. D\n5. E',
      caret: 18,
      direction: 'indent',
      expected: '1. A\n2. B\n       1. >`C\n   3. D\n4. E',
      expectedCaret: 22
    }
  ];

  for (const fixture of cases) {
    exact(
      markdown.applyMarkdownIndentation(
        fixture.source,
        { anchor: fixture.caret, focus: fixture.caret },
        fixture.direction
      ),
      fixture.expected,
      fixture.expectedCaret
    );
  }
});

test('O1 ordered normalization continues from an unchanged touched marker', () => {
  const before = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '   1. Citrate',
    '   2. ',
    '   3. Isocitrate',
    '      1. deeper',
    '   3. Succinate',
    '4. Next'
  ].join('\n');
  const rawAfter = `${before.slice(0, 71)}>${before.slice(71)}`;
  exact(
    markdown.normalizeMarkdownOrderedMarkersAfterEdit(before, rawAfter, {
      inputType: 'insertText',
      selection: { anchor: 72, focus: 72 }
    }),
    [
      '1. Glycolysis',
      '2. Link reaction',
      '3. TCA cycle',
      '   1. Citrate',
      '   2. ',
      '   3. >Isocitrate',
      '      1. deeper',
      '   4. Succinate',
      '5. Next'
    ].join('\n'),
    72
  );
});

test('O1 Enter preserves a right-hand list marker and replaces only its indentation', () => {
  const cases = [
    ['- A\n  - \n  - `B*    - C', 16, '- A\n  - \n  - `B*\n  - C', 19],
    ['- A\n\t-   A\t\t- C', 10, '- A\n\t-   A\n\t- C', 12],
    [
      [
        '1. Ordered parent',
        '   - Bullet child',
        '     1. Number grandchild',
        '     2. Number sibling',
        '   -    Bullet sibling',
        '1. Ordered next'
      ].join('\n'),
      93,
      [
        '1. Ordered parent',
        '   - Bullet child',
        '     1. Number grandchild',
        '     2. Number sibling',
        '   -    ',
        '   - Bullet sibling',
        '1. Ordered next'
      ].join('\n'),
      99
    ],
    [
      '1. A\n   - \n   - \n     *B\n     1. C',
      23,
      '1. A\n   - \n   - \n     *\n   - B\n     1. C',
      29
    ],
    ['1. A\n   - \n   - *     1. C', 17, '1. A\n   - \n   - *\n   1. C', 21]
  ];

  for (const [source, caret, expected, expectedCaret] of cases) {
    exact(
      markdown.applyMarkdownNewline(source, { anchor: caret, focus: caret }),
      expected,
      expectedCaret
    );
  }
});

test('O1 Enter continues the root ordinal after Delete folds a child marker onto it', () => {
  const initial = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n');
  const first = markdown.applyMarkdownNewline(
    initial,
    { anchor: 43, focus: 43 }
  );
  exact(first, [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '4. ',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n'), 47);

  const second = markdown.applyMarkdownStructuralDeletion(
    first.source,
    first.selection,
    'forward'
  );
  exact(second, [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '4.     1. Citrate',
    '    1. Isocitrate'
  ].join('\n'), 47);

  // This is the one-action authoritative predecessor state from lifecycle
  // random-500 scenario .200: the next Enter keeps the caret before the
  // exposed marker while continuing the root physical run from 4 to 5.
  const third = markdown.applyMarkdownNewline(second.source, second.selection);
  exact(third, [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '4. ',
    '5. Citrate',
    '    1. Isocitrate'
  ].join('\n'), 48);
  assert.deepEqual(third.edits.at(-1), {
    start: 48,
    end: 49,
    replacement: '5',
    lineIndex: 4,
    kind: 'ordered-list-post-edit-renumber'
  });
});

test('O1 Enter on a physical ordered continuation cascades later ordinals', () => {
  exact(
    markdown.applyMarkdownNewline(
      '1. A\n2. B\n   3.  C\n   4. D\n5. E',
      { anchor: 17, focus: 17 }
    ),
    '1. A\n2. B\n   3.  \n   4. C\n   5. D\n6. E',
    24
  );
});

test('O1 Shift+Enter aligns after canonical physical list and quote prefixes', () => {
  const cases = [
    ['        *  Star\n\n+ Plus', 14, '        *  Sta\n          r\n\n+ Plus', 25],
    ['1. A\n\t1. \n\t2.  B\n\t\t1. C', 16, '1. A\n\t1. \n\t2.  B\n\t   \n\t\t1. C', 21],
    ['A\nB\n    * \nD', 10, 'A\nB\n    * \n      \nD', 17],
    ['\n\n>\n>     A', 10, '\n\n>\n>     \n>     A', 17]
  ];

  for (const [source, caret, expected, expectedCaret] of cases) {
    exact(
      markdown.applyMarkdownNewline(
        source,
        { anchor: caret, focus: caret },
        { inputType: 'insertLineBreak' }
      ),
      expected,
      expectedCaret
    );
  }
});

test('O1 Enter resolves raw indentation boundaries without splitting the prefix', () => {
  exact(
    markdown.applyMarkdownNewline(
      '\n        iagram][asset]\n\n[asset]: assets/images/example.png "Example title"',
      { anchor: 8, focus: 8 }
    ),
    '\n\n        iagram][asset]\n\n[asset]: assets/images/example.png "Example title"',
    10
  );
  exact(
    markdown.applyMarkdownNewline(
      'A\nB\n        A\n        \nD',
      { anchor: 22, focus: 22 }
    ),
    'A\nB\n        A\n    \nD',
    18
  );
});

test('O1 quote continuations preserve the complete physical prefix', () => {
  const cases = [
    ['> \n> A\n>  \n>     B', 10, true, '> \n> A\n>  \n>  \n>     B', 14],
    ['>  \n>  \n>     A ', 16, true, '>  \n>  \n>     A \n>     ', 23],
    ['>>  \n>>     \n> B\nC', 12, true, '>>  \n>>     \n>>     \n> B\nC', 20],
    ['>>      x A', 10, false, '>>      x \n>>      A', 19]
  ];

  for (const [source, caret, shifted, expected, expectedCaret] of cases) {
    exact(
      markdown.applyMarkdownNewline(
        source,
        { anchor: caret, focus: caret },
        { inputType: shifted ? 'insertLineBreak' : 'insertParagraph' }
      ),
      expected,
      expectedCaret
    );
  }
});

test('O1 quote Backspace removes padding before it removes a marker', () => {
  for (const [source, caret, expected, expectedCaret, editKind] of [
    ['>> \n>> A', 7, '>> \n>>A', 6, 'quote-separator'],
    ['>> \n>> \n>> \n>> \n>> A\n>> B', 19,
      '>> \n>> \n>> \n>> \n>>A\n>> B', 18, 'quote-separator'],
    ['>A', 1, 'A', 0, 'quote-marker']
  ]) {
    const result = markdown.applyMarkdownStructuralDeletion(
      source,
      { anchor: caret, focus: caret },
      'backward'
    );
    exact(result, expected, expectedCaret);
    assert.equal(result.editKind, editKind);
  }
});
