'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function assertExact(result, fixture) {
  assert.equal(result.source, fixture.expected, fixture.id);
  assert.deepEqual(
    { ...result.selection },
    { anchor: fixture.expectedCaret, focus: fixture.expectedCaret },
    fixture.id
  );
}

test('Round-2 list authority preserves exact Tab and Shift-Tab transactions', () => {
  const fixtures = [
    {
      id: 'v0.3-full-trace-repair.0d41a3de9d2bd48b00dc.action-7',
      source: '- A\n  - \n    \n        - C',
      caret: 18,
      direction: 'outdent',
      expected: '- A\n  - \n    \n    - C',
      expectedCaret: 18
    },
    {
      id: 'v0.3-full-trace-repair.a58b5941c6274445bfa5.action-4',
      source: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. ',
        '   3. >$Isocitrate',
        '      1. deeper',
        '   4. Succinate',
        '5. Next'
      ].join('\n'),
      caret: 73,
      direction: 'indent',
      expected: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. ',
        '       1. >$Isocitrate',
        '      2. deeper',
        '   4. Succinate',
        '5. Next'
      ].join('\n'),
      expectedCaret: 77
    },
    {
      id: 'v0.3-full-trace-repair.cdec4d9548fafea97331.action-15',
      source: '1. A\n   - \n   - \n     *\n- B\n     1. C',
      caret: 25,
      direction: 'indent',
      expected: '1. A\n   - \n   - \n     *\n    - B\n     1. C',
      expectedCaret: 29
    },
    {
      id: 'v0.3-full-trace-repair.9423a4532d045e7d4d19.action-13',
      source: '- A\n  - 1\n    -B\n \n    - C',
      caret: 19,
      direction: 'outdent',
      expected: '- A\n  - 1\n    -B\n \n- C',
      expectedCaret: 19
    }
  ];

  for (const fixture of fixtures) {
    assertExact(markdown.applyMarkdownIndentation(
      fixture.source,
      { anchor: fixture.caret, focus: fixture.caret },
      fixture.direction
    ), fixture);
  }
});

test('Round-2 list authority preserves exact Enter continuations', () => {
  const fixtures = [
    {
      id: 'v0.3-full-trace-repair.5cb9e8d7cd01f6445f9c.action-18',
      source: '- A\n  - x\n-$> \n    - C',
      caret: 12,
      expected: '- A\n  - x\n-$\n> \n    - C',
      expectedCaret: 13
    },
    {
      id: 'v0.3-full-trace-repair.86b8ac65128482b298c4.action-9',
      source: '- A\n\t-   A\n\t- C',
      caret: 12,
      expected: '- A\n\t-   A\n\t\n    - C',
      expectedCaret: 17
    },
    {
      id: 'v0.3-full-trace-repair.170d1fc84d06025f2e0d.action-3',
      source: [
        '- [ ] Open',
        '- [x] Done',
        '  - [X] Nested done',
        '  - [ ] ',
        '            Nested open',
        '- [ ] Last'
      ].join('\n'),
      caret: 63,
      expected: [
        '- [ ] Open',
        '- [x] Done',
        '  - [X] Nested done',
        '  - [ ] ',
        '            ',
        '            Nested open',
        '- [ ] Last'
      ].join('\n'),
      expectedCaret: 76
    },
    {
      id: 'v0.3-full-trace-repair.0d46d3187e24cacbaf75.action-13',
      source: '- Item first line\n    x` ordinary continuation\n- Next',
      caret: 23,
      expected: '- Item first line\n    x\n    ` ordinary continuation\n- Next',
      expectedCaret: 28
    }
  ];

  for (const fixture of fixtures) {
    assertExact(markdown.applyMarkdownNewline(
      fixture.source,
      { anchor: fixture.caret, focus: fixture.caret }
    ), fixture);
  }
});

test('Round-2 ordered-list authority preserves exact Backspace and Delete cascades', () => {
  const fixtures = [
    {
      id: 'v0.3-full-trace-repair.cefdf2028632fd423fb9.action-4',
      source: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. ',
        '3. socitrate',
        '      1. deeper',
        '   4. Succinate',
        '5. Next'
      ].join('\n'),
      caret: 68,
      direction: 'backward',
      expected: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle',
        '   1. Citrate',
        '   2. ',
        '3.socitrate',
        '      1. deeper',
        '   4. Succinate',
        '5. Next'
      ].join('\n'),
      expectedCaret: 67
    },
    {
      id: 'v0.3-full-trace-repair.b2e410bc3e8beae135f7.action-11',
      source: '1. A\n\t1. \n\t2.  B\n\t   \n\t\t1. C',
      caret: 23,
      direction: 'backward',
      expected: '1. A\n\t1. \n\t2.  B\n\t   \n\t3. C',
      expectedCaret: 22
    },
    {
      id: 'v0.3-full-trace-repair.11a090f7e3bb618edb45.action-4',
      source: '1. A\n2. B\n   3.  \n   4. \n   5. C\n   6. D\n7. E',
      caret: 31,
      direction: 'backward',
      expected: '1. A\n2. B\n   3.  \n   4. \n   5.C\n   5. D\n6. E',
      expectedCaret: 30
    },
    {
      id: 'v0.3-full-trace-repair.cdf1ab53a7fb7967a478.action-14',
      source: '1. A\n2. B\n           1. >\n           2. \n   3. D\n4. E',
      caret: 40,
      direction: 'forward',
      expected: '1. A\n2. B\n           1. >\n           2.    3. D\n3. E',
      expectedCaret: 40
    }
  ];

  for (const fixture of fixtures) {
    assertExact(markdown.applyMarkdownStructuralDeletion(
      fixture.source,
      { anchor: fixture.caret, focus: fixture.caret },
      fixture.direction
    ), fixture);
  }
});
