'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function assertExact(result, fixture) {
  assert.equal(result.source, fixture.expected, `${fixture.id}: source`);
  assert.deepEqual(
    { ...result.selection },
    { anchor: fixture.expectedCaret, focus: fixture.expectedCaret },
    `${fixture.id}: selection`
  );
}

test('Round-3 timing-preserved Shift-Tab prefixes keep one exact physical transaction', () => {
  const fixtures = [
    {
      id: 'v0.3-full-trace-repair.0d41a3de9d2bd48b00dc.action-7',
      source: '- A\n  - \n    \n        - C',
      caret: 18,
      expected: '- A\n  - \n    \n    - C',
      expectedCaret: 18
    },
    {
      id: 'v0.3-full-trace-repair.8c8f0f95409b9058eb39.action-4',
      source: '    Plain  \n    paragraph alpha.\n\nPlain paragraph beta.',
      caret: 16,
      expected: '    Plain  \nparagraph alpha.\n\nPlain paragraph beta.',
      expectedCaret: 12
    },
    {
      id: 'v0.3-full-trace-repair.4862111c0826e1a0f802.action-10',
      source: '        *  Sta\n          r\n\n+ Plus',
      caret: 25,
      expected: '        *  Sta\n      r\n\n+ Plus',
      expectedCaret: 21
    },
    {
      id: 'v0.3-full-trace-repair.5332ec0dec2b31113fed.action-9',
      source: [
        '1. Ordered parent',
        '   - Bullet child',
        '     1. Number grandchild',
        '     2. Number sibling',
        '   - ',
        '           -   ',
        '             * Bullet sibling',
        '1. Ordered next'
      ].join('\n'),
      caret: 122,
      expected: [
        '1. Ordered parent',
        '   - Bullet child',
        '     1. Number grandchild',
        '     2. Number sibling',
        '   - ',
        '           -   ',
        '         * Bullet sibling',
        '1. Ordered next'
      ].join('\n'),
      expectedCaret: 118
    },
    {
      id: 'v0.3-full-trace-repair.d16b3c0cb5aa8bddbf47.action-9',
      source: 'Escaped symbols: \\*\n \n \n     \n     not italic\\*, \\# not a heading.',
      caret: 35,
      expected: 'Escaped symbols: \\*\n \n \n     \n not italic\\*, \\# not a heading.',
      expectedCaret: 31
    },
    {
      id: 'v0.3-full-trace-repair.3c0e520ce213a67fa278.action-7',
      source: [
        '    [1 ',
        '     full][example] and [collapsed][].',
        '',
        '[example]: https://example.com',
        '[collapsed]: https://collapsed.example'
      ].join('\n'),
      caret: 12,
      expected: [
        '    [1 ',
        ' full][example] and [collapsed][].',
        '',
        '[example]: https://example.com',
        '[collapsed]: https://collapsed.example'
      ].join('\n'),
      expectedCaret: 9
    },
    {
      id: 'v0.3-full-trace-repair.e69e1b3a4a9450cfa16d.action-12',
      source: 'A\n      >1\nC',
      caret: 10,
      expected: 'A\n>1\nC',
      expectedCaret: 4
    },
    {
      id: 'v0.3-full-trace-repair.0ac274b17cd0e55956bb.action-10',
      source: '\n\n>\n>     \n>     A',
      caret: 17,
      expected: '\n\n>\n>     \n> A',
      expectedCaret: 13
    },
    {
      id: 'v0.3-full-trace-repair.e8b4d1582ef18eabe54f.action-12',
      source: 'Plain \n    `>paragraph alpha.\n\nPlain paragraph beta.',
      caret: 12,
      expected: 'Plain \n`>paragraph alpha.\n\nPlain paragraph beta.',
      expectedCaret: 8
    },
    {
      id: 'v0.3-full-trace-repair.170d1fc84d06025f2e0d.action-11',
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
    }
  ];

  for (const fixture of fixtures) {
    assertExact(markdown.applyMarkdownIndentation(
      fixture.source,
      { anchor: fixture.caret, focus: fixture.caret },
      'outdent'
    ), fixture);
  }
});

test('Round-3 b2e4 insertion inherits the ordered continuation ordinal', () => {
  const fixture = {
    id: 'v0.3-full-trace-repair.b2e410bc3e8beae135f7.action-12',
    expected: '1. A\n\t1. \n\t2.  B\n\t   \n \t2. C',
    expectedCaret: 23
  };
  const before = '1. A\n\t1. \n\t2.  B\n\t   \n\t3. C';
  const rawAfter = '1. A\n\t1. \n\t2.  B\n\t   \n \t3. C';

  assertExact(markdown.normalizeMarkdownOrderedMarkersAfterEdit(
    before,
    rawAfter,
    {
      inputType: 'insertText',
      selection: { anchor: 23, focus: 23 }
    }
  ), fixture);
});

test('Round-3 86b8 Backspace deletes the physical marker separator only', () => {
  const fixture = {
    id: 'v0.3-full-trace-repair.86b8ac65128482b298c4.action-13',
    expected: '- A\n\t-   A\n\t\n    -',
    expectedCaret: 18
  };
  const result = markdown.applyMarkdownStructuralDeletion(
    '- A\n\t-   A\n\t\n    - ',
    { anchor: 19, focus: 19 },
    'backward'
  );

  assertExact(result, fixture);
  assert.equal(result.editKind, 'list-separator');
});
