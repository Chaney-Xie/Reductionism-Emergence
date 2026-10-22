const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

const view = loadMarkdownPageViewInternals([
  'markdownMarkerDeletionEdit',
  'markdownTextInsertionEdit'
]);

test('O1 Markdown pairing uses whitespace boundaries and overtypes a paired closer', () => {
  const insert = (source, caret, text) => JSON.parse(JSON.stringify(
    view.markdownTextInsertionEdit(
      source,
      { anchor: caret, focus: caret },
      text
    )
  ));

  assert.deepEqual(insert('A\n\n$\nC', 4, '*'), {
    changed: true,
    source: 'A\n\n$*\nC',
    start: 4,
    end: 4,
    replacement: '*',
    selection: { anchor: 5, focus: 5 },
    autoPaired: false
  });

  assert.deepEqual(insert('Plain \n    >paragraph alpha.', 11, '`'), {
    changed: true,
    source: 'Plain \n    `>paragraph alpha.',
    start: 11,
    end: 11,
    replacement: '`',
    selection: { anchor: 12, focus: 12 },
    autoPaired: false
  });

  const pairedCloser = '    \n    * $ A**Setext one';
  assert.deepEqual(insert(pairedCloser, 14, '*'), {
    changed: true,
    source: pairedCloser,
    start: 14,
    end: 14,
    replacement: '',
    selection: { anchor: 15, focus: 15 },
    autoPaired: false,
    overtypedCloser: true
  });

  const emptyLinePair = insert('```js\n\n```', 6, '*');
  assert.equal(emptyLinePair.source, '```js\n**\n```');
  assert.equal(emptyLinePair.autoPaired, true);

  const beforeSameMarker = insert('    \n    *Setext one', 9, '*');
  assert.equal(beforeSameMarker.source, '    \n    ***Setext one');
  assert.equal(beforeSameMarker.autoPaired, true);
});

test('O1 Backspace removes an empty pair while Delete removes one marker byte', () => {
  const paired = view.markdownMarkerDeletionEdit(
    '```js \n``',
    { anchor: 8, focus: 8 },
    'backward',
    []
  );
  assert.equal(paired.source, '```js \n');
  assert.deepEqual(
    { ...paired.selection },
    { anchor: 7, focus: 7 }
  );

  for (const [source, caret, expected, expectedCaret] of [
    ['**', 1, '', 0],
    ['****', 2, '**', 1]
  ]) {
    const emphasisPair = view.markdownMarkerDeletionEdit(
      source,
      { anchor: caret, focus: caret },
      'backward',
      []
    );
    assert.equal(emphasisPair.source, expected);
    assert.deepEqual(
      { ...emphasisPair.selection },
      { anchor: expectedCaret, focus: expectedCaret }
    );
  }

  const inlinePairDelete = view.markdownMarkerDeletionEdit(
    '``',
    { anchor: 1, focus: 1 },
    'forward',
    []
  );
  assert.equal(inlinePairDelete.source, '`');
  assert.deepEqual(
    { ...inlinePairDelete.selection },
    { anchor: 1, focus: 1 }
  );
});

test('O1 forward Delete owns an unparsed backtick without consuming adjacent whitespace', () => {
  const source = '<u  `\nnderline</u>, H<sub>2</sub>O, x<sup>2</sup>, <br> next; <kbd>escaped</kbd>.';
  const result = view.markdownMarkerDeletionEdit(
    source,
    { anchor: 4, focus: 4 },
    'forward',
    []
  );
  assert.equal(
    result.source,
    '<u  \nnderline</u>, H<sub>2</sub>O, x<sup>2</sup>, <br> next; <kbd>escaped</kbd>.'
  );
  assert.deepEqual(
    { ...result.selection },
    { anchor: 4, focus: 4 }
  );
});
