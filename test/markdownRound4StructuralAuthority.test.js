'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function assertExact(result, expected, caret, id) {
  assert.equal(result.source, expected, `${id}: source`);
  assert.deepEqual(
    { ...result.selection },
    { anchor: caret, focus: caret },
    `${id}: selection`
  );
}

test('Round-4 0d41 Shift-Tab retains indentation-boundary caret affinity', () => {
  const source = [
    '- A',
    '  - ',
    '    ',
    '            $ $',
    '             ',
    '              C'
  ].join('\n');
  assertExact(
    markdown.applyMarkdownIndentation(
      source,
      { anchor: 56, focus: 56 },
      'outdent'
    ),
    [
      '- A',
      '  - ',
      '    ',
      '            $ $',
      '             ',
      '          C'
    ].join('\n'),
    54,
    'v0.3-full-trace-repair.0d41a3de9d2bd48b00dc.action-18'
  );
});

test('Round-4 9f6cc9 Enter exits a repeated delayed quote-marker run', () => {
  const result = markdown.applyMarkdownNewline(
    '>>  \n>>     \n>>     >\n>>     >\n> B\nC',
    { anchor: 30, focus: 30 }
  );
  assertExact(
    result,
    '>>  \n>>     \n>>     \n>>     \n> B\nC',
    28,
    'v0.3-full-trace-repair.9f6cc92b1d816115d2c1.action-12'
  );
  assert.equal(result.editKind, 'quote-marker-run-exit');
});

test('Round-4 b2e410 Tab continues an ordered run across whitespace continuation', () => {
  assertExact(
    markdown.applyMarkdownIndentation(
      '1. A\n\t1. \n\t2.  B\n\t   \n  2. C',
      { anchor: 24, focus: 24 },
      'indent'
    ),
    '1. A\n\t1. \n\t2.  B\n\t   \n      3. C',
    28,
    'v0.3-full-trace-repair.b2e410bc3e8beae135f7.action-15'
  );
});

test('Round-4 170d1f Enter continues a task owner at its exact content column', () => {
  const source = [
    '- [ ] Open',
    '- [x] Done',
    '  - [X] Nested done',
    '  - [ ] ',
    '            ',
    '            x ',
    '            ',
    '        ested open',
    '- [ ] Last'
  ].join('\n');
  const result = markdown.applyMarkdownNewline(
    source,
    { anchor: 100, focus: 100 }
  );
  assertExact(
    result,
    [
      '- [ ] Open',
      '- [x] Done',
      '  - [X] Nested done',
      '  - [ ] ',
      '            ',
      '            x ',
      '            ',
      '        ',
      '  - [ ] ested open',
      '- [ ] Last'
    ].join('\n'),
    109,
    'v0.3-full-trace-repair.170d1fc84d06025f2e0d.action-12'
  );
  assert.equal(result.editKind, 'list-continuation');
});
