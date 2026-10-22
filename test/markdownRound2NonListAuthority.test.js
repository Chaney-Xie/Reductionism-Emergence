'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function exact(result, source, anchor, editKind = null) {
  assert.equal(result.source, source);
  assert.deepEqual({ ...result.selection }, { anchor, focus: anchor });
  if (editKind) assert.equal(result.editKind, editKind);
}

test('O1 Enter retains physically separated nested quote markers', () => {
  exact(
    markdown.applyMarkdownNewline(
      '> \n> \n>   >A\n>\n> B',
      { anchor: 11, focus: 11 }
    ),
    '> \n> \n>   >\n>   >A\n>\n> B',
    17,
    'quote-continuation'
  );
});

test('O1 Enter retains a delayed quote marker inside AST-indented code', () => {
  exact(
    markdown.applyMarkdownNewline(
      '>>>  \n>>>          >$ **',
      { anchor: 24, focus: 24 }
    ),
    '>>>  \n>>>          >$ **\n>>>          >',
    39,
    'quote-continuation'
  );
});

test('O1 Shift+Enter retains a delayed inner quote marker inside AST-indented code', () => {
  exact(
    markdown.applyMarkdownNewline(
      '>>  \n>>     \n>>     >\n> B\nC',
      { anchor: 21, focus: 21 },
      { inputType: 'insertLineBreak' }
    ),
    '>>  \n>>     \n>>     >\n>>     >\n> B\nC',
    30,
    'quote-continuation'
  );
});

test('O1 Tab edits a first root row with only unindented lazy descendants', () => {
  exact(
    markdown.applyMarkdownIndentation(
      '    \n* $ A* Setext one\n==========\n\nSetext two\n----------',
      { anchor: 13, focus: 13 },
      'indent'
    ),
    '    \n    * $ A* Setext one\n==========\n\nSetext two\n----------',
    17,
    'lines'
  );
});

test('O1 Shift+Tab preserves one residual space for generic code indentation', () => {
  exact(
    markdown.applyMarkdownIndentation(
      'Escaped symbols: \\*\n \n \n     \n     not italic\\*, \\# not a heading.',
      { anchor: 35, focus: 35 },
      'outdent'
    ),
    'Escaped symbols: \\*\n \n \n     \n not italic\\*, \\# not a heading.',
    31,
    'lines'
  );
});

test('O1 Shift+Tab fully aligns an over-indented physical quote marker', () => {
  exact(
    markdown.applyMarkdownIndentation(
      'A\n      >1\nC',
      { anchor: 10, focus: 10 },
      'outdent'
    ),
    'A\n>1\nC',
    4,
    'lines'
  );
});

test('O1 Shift+Tab removes one four-space plain paragraph level byte-exactly', () => {
  exact(
    markdown.applyMarkdownIndentation(
      'Plain \n    `>paragraph alpha.\n\nPlain paragraph beta.',
      { anchor: 12, focus: 12 },
      'outdent'
    ),
    'Plain \n`>paragraph alpha.\n\nPlain paragraph beta.',
    8,
    'lines'
  );
});

test('O1 Enter removes blank quote indentation before exiting the quote', () => {
  exact(
    markdown.applyMarkdownNewline(
      '\n\n>\n>     \n>\n>    ',
      { anchor: 18, focus: 18 }
    ),
    '\n\n>\n>     \n>\n>',
    14,
    'quote-indentation-outdent'
  );
});
