const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

const cases = [
  {
    id: '8c8f0f95409b9058eb39',
    direction: 'outdent',
    source: '    Plain  \n\n    *aragraph alpha.\n\nPlain paragraph beta.',
    caret: 18,
    expected: '    Plain  \n\n*aragraph alpha.\n\nPlain paragraph beta.',
    expectedCaret: 14
  },
  {
    id: 'daa564d97259e8507239',
    direction: 'indent',
    source: '```js\n\n    1\n    \n \n ```',
    caret: 21,
    expected: '```js\n\n    1\n    \n \n     ```',
    expectedCaret: 25
  },
  {
    id: '47ccd353a53a2f38af51',
    direction: 'indent',
    source: 'Inline code: `\n   const x = "$notMath$";`',
    caret: 18,
    expected: 'Inline code: `\n       const x = "$notMath$";`',
    expectedCaret: 22
  },
  {
    id: 'd16b3c0cb5aa8bddbf47',
    direction: 'indent',
    source: 'Escaped symbols: \\*\n \n \n not italic\\*, \\# not a heading.',
    caret: 25,
    expected: 'Escaped symbols: \\*\n \n \n     not italic\\*, \\# not a heading.',
    expectedCaret: 29
  },
  {
    id: '3c0e520ce213a67fa278',
    direction: 'outdent',
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
    id: 'e69e1b3a4a9450cfa16d',
    direction: 'indent',
    source: 'A\n  B\nC',
    caret: 4,
    expected: 'A\n      B\nC',
    expectedCaret: 8
  },
  {
    id: 'a6b348d91b3f2d1c3a26',
    direction: 'indent',
    source: [
      '',
      '    ',
      '    ',
      '        ',
      '        ',
      '        ',
      '         xetext one',
      '==========',
      '',
      'Setext two',
      '----------'
    ].join('\n'),
    caret: 48,
    expected: [
      '',
      '    ',
      '    ',
      '        ',
      '        ',
      '        ',
      '             xetext one',
      '==========',
      '',
      'Setext two',
      '----------'
    ].join('\n'),
    expectedCaret: 52
  },
  {
    id: '7702c590d13c232e046f',
    direction: 'outdent',
    source: '    **A\n     d text**',
    caret: 13,
    expected: '    **A\n d text**',
    expectedCaret: 9
  },
  {
    id: 'd3476e60f57e58913d4d',
    direction: 'indent',
    source: '~~\n1\n trikethrough text~~',
    caret: 6,
    expected: '~~\n1\n     trikethrough text~~',
    expectedCaret: 10
  },
  {
    id: 'a6c40579ea7842824697',
    direction: 'indent',
    source: '<\n    \n    \n    \n     ttps://example.com> and https://literal.example/path',
    caret: 22,
    expected: '<\n    \n    \n    \n         ttps://example.com> and https://literal.example/path',
    expectedCaret: 26
  }
];

test('O1 generic collapsed Tab and Shift+Tab use one exact four-space physical delta', () => {
  for (const fixture of cases) {
    const result = markdown.applyMarkdownIndentation(
      fixture.source,
      { anchor: fixture.caret, focus: fixture.caret },
      fixture.direction
    );
    assert.equal(result.source, fixture.expected, `${fixture.id}: source`);
    assert.deepEqual(
      { ...result.selection },
      { anchor: fixture.expectedCaret, focus: fixture.expectedCaret },
      `${fixture.id}: selection`
    );
  }
});

