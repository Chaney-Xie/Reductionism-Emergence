const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const markdown = require('../public/markdownPage');
const round2MinimizedGate = require(
  './markdownConformance/scenarios/v0.3ListRandom500MinimizedRegressionsRound2.json'
);

async function markdownHistoryApi() {
  const source = await fs.readFile(
    path.join(__dirname, '..', 'public/js/markdownPageView.js'),
    'utf8'
  );
  const root = { addEventListener() {} };
  vm.runInNewContext(source, {
    console,
    globalThis: root,
    window: root
  });
  return root.markdownPageView;
}

async function markdownHistoryModelHarness() {
  const source = await fs.readFile(
    path.join(__dirname, '..', 'public/js/markdownPageView.js'),
    'utf8'
  );
  const root = {
    addEventListener() {},
    markdownPageModel: markdown
  };
  vm.runInNewContext(source, {
    console,
    globalThis: root,
    window: root
  });
  return { api: root.markdownPageView, model: markdown };
}

function caret(offset) {
  return { anchor: offset, focus: offset };
}

function plainSelection(selection) {
  return { anchor: selection.anchor, focus: selection.focus };
}

function record(api, history, {
  before,
  after,
  beforeOffset,
  afterOffset,
  inputType,
  timestamp
}) {
  return api.recordMarkdownEditTransaction(history, {
    beforeSource: before,
    afterSource: after,
    beforeSelection: caret(beforeOffset),
    afterSelection: caret(afterOffset),
    inputType,
    timestamp
  });
}

test('quote Shift-Enter, navigation, Shift-Enter, and text use two Obsidian history groups', async () => {
  const api = await markdownHistoryApi();
  const initial = '> A\n> B';
  const firstBreak = '> \n> A\n> B';
  const secondBreak = '> \n> A\n> \n> B';
  const final = '> \n> A\n>  \n> B';
  const history = api.createMarkdownEditHistory(initial);

  record(api, history, {
    before: initial,
    after: firstBreak,
    beforeOffset: 2,
    afterOffset: 5,
    inputType: 'insertLineBreak',
    timestamp: 0
  });
  api.markMarkdownEditHistorySelectionBoundary(history, caret(6));
  record(api, history, {
    before: firstBreak,
    after: secondBreak,
    beforeOffset: 6,
    afterOffset: 9,
    inputType: 'insertLineBreak',
    timestamp: 100
  });
  record(api, history, {
    before: secondBreak,
    after: final,
    beforeOffset: 9,
    afterOffset: 10,
    inputType: 'insertText',
    timestamp: 200
  });

  assert.equal(history.undoStack.length, 2);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, firstBreak);
  assert.deepEqual(plainSelection(undo.selection), caret(6));
  const redo = api.stepMarkdownEditHistory(history, 'redo', firstBreak);
  assert.equal(redo.source, final);
  assert.deepEqual(plainSelection(redo.selection), caret(10));
});

test('plain Enter and adjacent Backspace retain a net-zero Obsidian history group', async () => {
  const api = await markdownHistoryApi();
  const initial = 'Plain paragraph alpha.\n\nPlain paragraph beta.';
  const spaced = 'Plain  paragraph alpha.\n\nPlain paragraph beta.';
  const split = 'Plain  \nparagraph alpha.\n\nPlain paragraph beta.';
  const history = api.createMarkdownEditHistory(initial);

  record(api, history, {
    before: initial,
    after: spaced,
    beforeOffset: 6,
    afterOffset: 7,
    inputType: 'insertText',
    timestamp: 0
  });
  record(api, history, {
    before: spaced,
    after: split,
    beforeOffset: 7,
    afterOffset: 8,
    inputType: 'insertParagraph',
    timestamp: 100
  });
  record(api, history, {
    before: split,
    after: spaced,
    beforeOffset: 8,
    afterOffset: 7,
    inputType: 'deleteContentBackward',
    timestamp: 200
  });

  assert.equal(history.undoStack.length, 2);
  assert.equal(history.undoStack[1].beforeSource, history.undoStack[1].afterSource);
  const consumeNetZero = api.stepMarkdownEditHistory(history, 'undo', spaced);
  assert.equal(consumeNetZero.source, spaced);
  assert.deepEqual(plainSelection(consumeNetZero.selection), caret(7));
  const undoSpace = api.stepMarkdownEditHistory(history, 'undo', spaced);
  assert.equal(undoSpace.source, initial);
  assert.deepEqual(plainSelection(undoSpace.selection), caret(6));
  assert.equal(api.stepMarkdownEditHistory(history, 'redo', initial).source, spaced);
  assert.equal(api.stepMarkdownEditHistory(history, 'redo', spaced).source, spaced);
});

test('auto-indented Enter, text, and Enter coalesce as one Obsidian history group', async () => {
  const api = await markdownHistoryApi();
  const initial = '    indented code\n    second line';
  const firstBreak = '    \n    indented code\n    second line';
  const inserted = '    \n    $indented code\n    second line';
  const final = '    \n    $\n    indented code\n    second line';
  const history = api.createMarkdownEditHistory(initial);

  record(api, history, {
    before: initial,
    after: firstBreak,
    beforeOffset: 4,
    afterOffset: 9,
    inputType: 'insertParagraph',
    timestamp: 0
  });
  record(api, history, {
    before: firstBreak,
    after: inserted,
    beforeOffset: 9,
    afterOffset: 10,
    inputType: 'insertText',
    timestamp: 100
  });
  record(api, history, {
    before: inserted,
    after: final,
    beforeOffset: 10,
    afterOffset: 15,
    inputType: 'insertParagraph',
    timestamp: 200
  });

  assert.equal(history.undoStack.length, 1);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, initial);
  assert.deepEqual(plainSelection(undo.selection), caret(4));
  const redo = api.stepMarkdownEditHistory(history, 'redo', initial);
  assert.equal(redo.source, final);
  assert.deepEqual(plainSelection(redo.selection), caret(15));
});

test('plain Shift-Enter is separate while indent and following prefixed newlines coalesce', async () => {
  const api = await markdownHistoryApi();
  const initial = 'Setext one\n==========\n\nSetext two\n----------';
  const firstBreak = `\n${initial}`;
  const indented = `\n    ${initial}`;
  const secondBreak = `\n    \n    ${initial}`;
  const final = `\n    \n    \n    ${initial}`;
  const history = api.createMarkdownEditHistory(initial);

  record(api, history, {
    before: initial,
    after: firstBreak,
    beforeOffset: 0,
    afterOffset: 1,
    inputType: 'insertLineBreak',
    timestamp: 0
  });
  record(api, history, {
    before: firstBreak,
    after: indented,
    beforeOffset: 1,
    afterOffset: 5,
    inputType: 'formatIndent',
    timestamp: 100
  });
  record(api, history, {
    before: indented,
    after: secondBreak,
    beforeOffset: 5,
    afterOffset: 10,
    inputType: 'insertLineBreak',
    timestamp: 200
  });
  record(api, history, {
    before: secondBreak,
    after: final,
    beforeOffset: 10,
    afterOffset: 15,
    inputType: 'insertParagraph',
    timestamp: 300
  });

  assert.equal(history.undoStack.length, 2);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, firstBreak);
  assert.deepEqual(plainSelection(undo.selection), caret(1));
  const redo = api.stepMarkdownEditHistory(history, 'redo', firstBreak);
  assert.equal(redo.source, final);
  assert.deepEqual(plainSelection(redo.selection), caret(15));
});

test('typing after Tab starts a new undo group while preserving quote indentation', async () => {
  const api = await markdownHistoryApi();
  const before = '>>>  \n>>>      ';
  const indented = '>>>  \n>>>          ';
  const marker = '>>>  \n>>>          >';
  const math = '>>>  \n>>>          >$';
  const final = '>>>  \n>>>          >$ ';
  const history = api.createMarkdownEditHistory(before);

  record(api, history, {
    before,
    after: indented,
    beforeOffset: 15,
    afterOffset: 19,
    inputType: 'formatIndent',
    timestamp: 0
  });
  record(api, history, {
    before: indented,
    after: marker,
    beforeOffset: 19,
    afterOffset: 20,
    inputType: 'insertText',
    timestamp: 100
  });
  record(api, history, {
    before: marker,
    after: math,
    beforeOffset: 20,
    afterOffset: 21,
    inputType: 'insertText',
    timestamp: 200
  });
  record(api, history, {
    before: math,
    after: final,
    beforeOffset: 21,
    afterOffset: 22,
    inputType: 'insertText',
    timestamp: 300
  });
  api.markMarkdownEditHistorySelectionBoundary(history, caret(21));

  assert.equal(history.undoStack.length, 2);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, indented);
  assert.deepEqual(plainSelection(undo.selection), caret(19));
});

test('history joins at 499ms and starts a new group at exactly 500ms', async () => {
  const api = await markdownHistoryApi();
  const history = api.createMarkdownEditHistory('');
  record(api, history, {
    before: '', after: 'a', beforeOffset: 0, afterOffset: 1,
    inputType: 'insertText', timestamp: 0
  });
  record(api, history, {
    before: 'a', after: 'ab', beforeOffset: 1, afterOffset: 2,
    inputType: 'insertText', timestamp: 499
  });
  record(api, history, {
    before: 'ab', after: 'abc', beforeOffset: 2, afterOffset: 3,
    inputType: 'insertText', timestamp: 999
  });

  assert.equal(history.undoStack.length, 2);
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', 'abc').source, 'ab');
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', 'ab').source, '');
});

test('navigation away and back remains a history boundary at the same final caret', async () => {
  const api = await markdownHistoryApi();
  const history = api.createMarkdownEditHistory('');
  record(api, history, {
    before: '', after: 'a', beforeOffset: 0, afterOffset: 1,
    inputType: 'insertText', timestamp: 0
  });
  api.markMarkdownEditHistorySelectionBoundary(history, caret(0));
  api.markMarkdownEditHistorySelectionBoundary(history, caret(1));
  record(api, history, {
    before: 'a', after: 'ab', beforeOffset: 1, afterOffset: 2,
    inputType: 'insertText', timestamp: 1
  });

  assert.equal(history.undoStack.length, 2);
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', 'ab').source, 'a');
});

test('only adjacent or overlapping changed ranges coalesce', async (t) => {
  const api = await markdownHistoryApi();

  await t.test('adjacent insertions join', () => {
    const history = api.createMarkdownEditHistory('ab');
    record(api, history, {
      before: 'ab', after: 'aXb', beforeOffset: 1, afterOffset: 2,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: 'aXb', after: 'aXYb', beforeOffset: 2, afterOffset: 3,
      inputType: 'insertText', timestamp: 1
    });
    assert.equal(history.undoStack.length, 1);
  });

  await t.test('non-adjacent changes split even when selections claim continuity', () => {
    const history = api.createMarkdownEditHistory('abcd');
    record(api, history, {
      before: 'abcd', after: 'aXbcd', beforeOffset: 1, afterOffset: 2,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: 'aXbcd', after: 'aXbcYd', beforeOffset: 2, afterOffset: 2,
      inputType: 'insertText', timestamp: 1
    });
    assert.equal(history.undoStack.length, 2);
  });
});

test('paste, cut, formatting, task, and table operations are isolated on both sides', async () => {
  const api = await markdownHistoryApi();
  const isolatedTypes = [
    'insertFromPaste',
    'deleteByCut',
    'formatBold',
    'formatTaskList',
    'formatTableStructure'
  ];

  for (const inputType of isolatedTypes) {
    const history = api.createMarkdownEditHistory('');
    record(api, history, {
      before: '', after: 'a', beforeOffset: 0, afterOffset: 1,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: 'a', after: 'ab', beforeOffset: 1, afterOffset: 2,
      inputType, timestamp: 1
    });
    record(api, history, {
      before: 'ab', after: 'abc', beforeOffset: 2, afterOffset: 3,
      inputType: 'insertText', timestamp: 2
    });
    assert.equal(history.undoStack.length, 3, inputType);
  }
});

test('outdent uses the joinable delete.dedent history event', async () => {
  const api = await markdownHistoryApi();
  const before = 'Plain\n        *paragraph';
  const outdented = 'Plain\n    *paragraph';
  const final = 'Plain\n     *paragraph';
  const history = api.createMarkdownEditHistory(before);

  record(api, history, {
    before,
    after: outdented,
    beforeOffset: 14,
    afterOffset: 10,
    inputType: 'formatOutdent',
    timestamp: 0
  });
  record(api, history, {
    before: outdented,
    after: final,
    beforeOffset: 10,
    afterOffset: 11,
    inputType: 'insertText',
    timestamp: 100
  });

  assert.equal(history.undoStack.length, 1);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, before);
  assert.deepEqual(plainSelection(undo.selection), caret(14));
});

test('a no-op indentation selection transaction separates later typing', async () => {
  const api = await markdownHistoryApi();
  const initial = 'x';
  const broken = 'x\n';
  const final = 'x\n1';
  const history = api.createMarkdownEditHistory(initial);

  record(api, history, {
    before: initial,
    after: broken,
    beforeOffset: 1,
    afterOffset: 2,
    inputType: 'insertLineBreak',
    timestamp: 0
  });
  api.markMarkdownEditHistorySelectionBoundary(history, caret(2));
  record(api, history, {
    before: broken,
    after: final,
    beforeOffset: 2,
    afterOffset: 3,
    inputType: 'insertText',
    timestamp: 100
  });

  assert.equal(history.undoStack.length, 2);
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', final).source, broken);
});

test('line-start Shift-Enter joins the preceding adjacent history group', async (t) => {
  const api = await markdownHistoryApi();

  await t.test('Enter then Shift-Enter', () => {
    const initial = '[full][example]';
    const first = '[\nfull][example]';
    const second = '[\n\nfull][example]';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: first, beforeOffset: 1, afterOffset: 2,
      inputType: 'insertParagraph', timestamp: 0
    });
    record(api, history, {
      before: first, after: second, beforeOffset: 2, afterOffset: 3,
      inputType: 'insertLineBreak', timestamp: 100
    });
    assert.equal(history.undoStack.length, 1);
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', second).source, initial);
  });

  await t.test('two Shift-Enters and Delete', () => {
    const initial = '*Italic text*';
    const first = '*\nItalic text*';
    const second = '*\n\nItalic text*';
    const deleted = '*\n\ntalic text*';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: first, beforeOffset: 1, afterOffset: 2,
      inputType: 'insertLineBreak', timestamp: 0
    });
    record(api, history, {
      before: first, after: second, beforeOffset: 2, afterOffset: 3,
      inputType: 'insertLineBreak', timestamp: 100
    });
    record(api, history, {
      before: second, after: deleted, beforeOffset: 3, afterOffset: 3,
      inputType: 'deleteContentForward', timestamp: 200
    });
    assert.equal(history.undoStack.length, 1);
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', deleted).source, initial);
  });

  await t.test('marker-only prefix joins typed marker and Shift-Enter', () => {
    const initial = '### \nHeading 3';
    const marked = '### \n*Heading 3';
    const broken = '### \n*\nHeading 3';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: marked, beforeOffset: 5, afterOffset: 6,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: marked, after: broken, beforeOffset: 6, afterOffset: 7,
      inputType: 'insertLineBreak', timestamp: 100
    });
    assert.equal(history.undoStack.length, 1);
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', broken).source, initial);
  });
});

test('mid-line Shift-Enter remains separate while a later line-start Shift-Enter joins', async () => {
  const api = await markdownHistoryApi();
  const typed = '~~ A Strikethrough text~~';
  const firstBreak = '~~ A \nStrikethrough text~~';
  const secondBreak = '~~ A \n\nStrikethrough text~~';
  const deleted = '~~ A \n\ntrikethrough text~~';
  const final = '~~ A \n\n\ntrikethrough text~~';
  const history = api.createMarkdownEditHistory(typed);

  record(api, history, {
    before: typed, after: firstBreak, beforeOffset: 5, afterOffset: 6,
    inputType: 'insertLineBreak', timestamp: 0
  });
  record(api, history, {
    before: firstBreak, after: secondBreak, beforeOffset: 6, afterOffset: 7,
    inputType: 'insertParagraph', timestamp: 100
  });
  record(api, history, {
    before: secondBreak, after: deleted, beforeOffset: 7, afterOffset: 7,
    inputType: 'deleteContentForward', timestamp: 200
  });
  record(api, history, {
    before: deleted, after: final, beforeOffset: 7, afterOffset: 8,
    inputType: 'insertLineBreak', timestamp: 300
  });

  assert.equal(history.undoStack.length, 2);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, firstBreak);
  assert.deepEqual(plainSelection(undo.selection), caret(6));
});

test('deep indented Shift-Enter does not coalesce with its preceding Tab', async () => {
  const api = await markdownHistoryApi();
  const before = '    \n    $\n    \n    ndented code\n    second line';
  const indented = '    \n    $\n    \n        ndented code\n    second line';
  const final = '    \n    $\n    \n        \n        ndented code\n    second line';
  const history = api.createMarkdownEditHistory(before);

  record(api, history, {
    before,
    after: indented,
    beforeOffset: 20,
    afterOffset: 24,
    inputType: 'formatIndent',
    timestamp: 0
  });
  record(api, history, {
    before: indented,
    after: final,
    beforeOffset: 24,
    afterOffset: 33,
    inputType: 'insertLineBreak',
    timestamp: 100
  });

  assert.equal(history.undoStack.length, 2);
  const undo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(undo.source, indented);
  assert.deepEqual(plainSelection(undo.selection), caret(24));
});

test('redo and repeated undo replay CodeMirror edge selections', async (t) => {
  const api = await markdownHistoryApi();

  await t.test('redo of an auto-pair selects the inserted range end', () => {
    const initial = '```js\n\n```';
    const paired = '```js\n**\n```';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: paired, beforeOffset: 6, afterOffset: 7,
      inputType: 'insertText', timestamp: 0
    });
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', paired).selection.anchor, 6);
    const redo = api.stepMarkdownEditHistory(history, 'redo', initial);
    assert.equal(redo.source, paired);
    assert.deepEqual(plainSelection(redo.selection), caret(8));
  });

  await t.test('undo after a redo restores a deleted range at its far edge', () => {
    const initial = 'ADiagram';
    const deleted = 'Aiagram';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: deleted, beforeOffset: 1, afterOffset: 1,
      inputType: 'deleteContentForward', timestamp: 0
    });
    assert.deepEqual(
      plainSelection(api.stepMarkdownEditHistory(history, 'undo', deleted).selection),
      caret(1)
    );
    assert.deepEqual(
      plainSelection(api.stepMarkdownEditHistory(history, 'redo', initial).selection),
      caret(1)
    );
    const secondUndo = api.stepMarkdownEditHistory(history, 'undo', deleted);
    assert.equal(secondUndo.source, initial);
    assert.deepEqual(plainSelection(secondUndo.selection), caret(2));
  });
});

test('Round-2 Tab-started prefixes keep their following edits in one history group', async (t) => {
  const api = await markdownHistoryApi();
  const cases = [
    {
      id: 'daa564d97259e8507239',
      states: [
        ['```js\n\n```', 7, null],
        ['```js\n\n    ```', 11, 'formatIndent'],
        ['```js\n\n    1```', 12, 'insertText'],
        ['```js\n\n    1\n    ```', 17, 'insertParagraph'],
        ['```js\n\n    1\n    \n    ```', 22, 'insertLineBreak']
      ]
    },
    {
      id: '9f6cc92b1d816115d2c1',
      states: [
        ['>>  \n>> \n> B\nC', 8, null],
        ['>>  \n>>     \n> B\nC', 12, 'formatIndent'],
        ['>>  \n>>     \n>>     \n> B\nC', 20, 'insertLineBreak']
      ]
    },
    {
      id: '410d77b9df51f401b0bc',
      states: [
        ['A\nB\n    * \n  \n  \n', 17, null],
        ['A\nB\n    * \n  \n  \n    ', 21, 'formatIndent'],
        ['A\nB\n    * \n  \n  \n    1', 22, 'insertText'],
        ['A\nB\n    * \n  \n  \n    1\n    ', 27, 'insertLineBreak'],
        ['A\nB\n    * \n  \n  \n    1\n    \n    ', 32, 'insertLineBreak']
      ]
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.id, () => {
      const [initialSource, initialOffset] = fixture.states[0];
      const history = api.createMarkdownEditHistory(initialSource);
      fixture.states.slice(1).forEach(([afterSource, afterOffset, inputType], index) => {
        const [beforeSource, beforeOffset] = fixture.states[index];
        record(api, history, {
          before: beforeSource,
          after: afterSource,
          beforeOffset,
          afterOffset,
          inputType,
          timestamp: index * 100
        });
      });

      assert.equal(history.undoStack.length, 1);
      const [finalSource] = fixture.states.at(-1);
      const undo = api.stepMarkdownEditHistory(history, 'undo', finalSource);
      assert.equal(undo.source, initialSource);
      assert.deepEqual(plainSelection(undo.selection), caret(initialOffset));
    });
  }
});

test('Round-2 295e72 Enter-started prefix remains one adjacent history group', async () => {
  const api = await markdownHistoryApi();
  const initial = '```js\n\n```';
  const paired = '```js\n**\n```';
  const history = api.createMarkdownEditHistory(initial);
  record(api, history, {
    before: initial,
    after: paired,
    beforeOffset: 6,
    afterOffset: 7,
    inputType: 'insertText',
    timestamp: 0
  });
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', paired).source, initial);
  assert.equal(api.stepMarkdownEditHistory(history, 'redo', initial).source, paired);

  const states = [
    [paired, 8, null],
    ['```js\n**\n\n```', 9, 'insertParagraph'],
    ['```js\n**\n**\n```', 10, 'insertText'],
    ['```js\n**\n*\n*\n```', 11, 'insertParagraph'],
    ['```js\n**\n*\n\n```', 11, 'deleteContentForward'],
    ['```js\n**\n*\nA\n```', 12, 'insertText'],
    ['```js\n**\n*\nA\n\n```', 13, 'insertLineBreak']
  ];
  states.slice(1).forEach(([afterSource, afterOffset, inputType], index) => {
    const [beforeSource, beforeOffset] = states[index];
    record(api, history, {
      before: beforeSource,
      after: afterSource,
      beforeOffset,
      afterOffset,
      inputType,
      timestamp: 100 + (index * 100)
    });
  });

  assert.equal(history.undoStack.length, 2, 'the replayed auto-pair remains the lower group');
  const undo = api.stepMarkdownEditHistory(history, 'undo', states.at(-1)[0]);
  assert.equal(undo.source, paired);
  assert.deepEqual(plainSelection(undo.selection), caret(8));
});

test('Round-2 82e3bf immediate Shift-Tab stays separate from its inverse Tab', async () => {
  const api = await markdownHistoryApi();
  const before = 'A\nB\n        A\n        \nD';
  const indented = 'A\nB\n        A\n            \nD';
  const history = api.createMarkdownEditHistory(before);
  record(api, history, {
    before,
    after: indented,
    beforeOffset: 22,
    afterOffset: 26,
    inputType: 'formatIndent',
    timestamp: 0
  });
  record(api, history, {
    before: indented,
    after: before,
    beforeOffset: 26,
    afterOffset: 22,
    inputType: 'formatOutdent',
    timestamp: 100
  });

  assert.equal(history.undoStack.length, 2);
  const undo = api.stepMarkdownEditHistory(history, 'undo', before);
  assert.equal(undo.source, indented);
  assert.deepEqual(plainSelection(undo.selection), caret(26));
});

test('Round-2 027508 repeated Undo restores the far edge of a replaced range', async () => {
  const api = await markdownHistoryApi();
  const before = '~~ A \nStrikethrough text~~';
  const firstEnter = '~~ A \n\nStrikethrough text~~';
  const deleted = '~~ A \n\ntrikethrough text~~';
  const final = '~~ A \n\n\ntrikethrough text~~';
  const history = api.createMarkdownEditHistory(before);
  record(api, history, {
    before,
    after: firstEnter,
    beforeOffset: 6,
    afterOffset: 7,
    inputType: 'insertParagraph',
    timestamp: 0
  });
  record(api, history, {
    before: firstEnter,
    after: deleted,
    beforeOffset: 7,
    afterOffset: 7,
    inputType: 'deleteContentForward',
    timestamp: 100
  });
  record(api, history, {
    before: deleted,
    after: final,
    beforeOffset: 7,
    afterOffset: 8,
    inputType: 'insertLineBreak',
    timestamp: 200
  });

  assert.deepEqual(
    plainSelection(api.stepMarkdownEditHistory(history, 'undo', final).selection),
    caret(6)
  );
  assert.deepEqual(
    plainSelection(api.stepMarkdownEditHistory(history, 'redo', before).selection),
    caret(8)
  );
  api.markMarkdownEditHistorySelectionBoundary(history, caret(8));
  const repeatedUndo = api.stepMarkdownEditHistory(history, 'undo', final);
  assert.equal(repeatedUndo.source, before);
  assert.deepEqual(plainSelection(repeatedUndo.selection), caret(7));
});

test('Round-3 preserved history prefixes replay Obsidian undo groups', async (t) => {
  const api = await markdownHistoryApi();

  await t.test('3afc6d8f4178ba691588 action 11 consumes a net-zero newline group', () => {
    const initial = '```js';
    const spaced = '```js ';
    const broken = '```js \n';
    const paired = '```js \n``';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: spaced, beforeOffset: 5, afterOffset: 6,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: spaced, after: broken, beforeOffset: 6, afterOffset: 7,
      inputType: 'insertLineBreak', timestamp: 100
    });
    record(api, history, {
      before: broken, after: paired, beforeOffset: 7, afterOffset: 8,
      inputType: 'insertText', timestamp: 200
    });
    record(api, history, {
      before: paired, after: broken, beforeOffset: 8, afterOffset: 7,
      inputType: 'deleteContentBackward', timestamp: 300
    });
    api.markMarkdownEditHistorySelectionBoundary(history, caret(6));
    record(api, history, {
      before: broken, after: spaced, beforeOffset: 6, afterOffset: 6,
      inputType: 'deleteContentForward', timestamp: 400
    });
    record(api, history, {
      before: spaced, after: broken, beforeOffset: 6, afterOffset: 7,
      inputType: 'insertLineBreak', timestamp: 500
    });

    const undo = api.stepMarkdownEditHistory(history, 'undo', broken);
    assert.equal(undo.source, broken);
    assert.deepEqual(plainSelection(undo.selection), caret(6));
  });

  await t.test('a58b5941c6274445bfa5 actions 10 and 12 isolate Tab from deletions', () => {
    const initial = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. Isocitrate\n      1. deeper\n   3. Succinate\n4. Next';
    const entered = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n   3. Isocitrate\n      1. deeper\n   3. Succinate\n4. Next';
    const quoted = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n   3. >Isocitrate\n      1. deeper\n   4. Succinate\n5. Next';
    const math = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n   3. >$Isocitrate\n      1. deeper\n   4. Succinate\n5. Next';
    const firstIndent = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n       1. >$Isocitrate\n      2. deeper\n   4. Succinate\n5. Next';
    const typed = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n       1. > $Isocitrate\n      2. deeper\n   4. Succinate\n5. Next';
    const secondIndent = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n           1. > $Isocitrate\n      1. deeper\n   4. Succinate\n5. Next';
    const deletedMath = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n           1. > Isocitrate\n      1. deeper\n   4. Succinate\n5. Next';
    const final = '1. Glycolysis\n2. Link reaction\n3. TCA cycle\n   1. Citrate\n   2. \n           1. >Isocitrate\n      1. deeper\n   4. Succinate\n5. Next';
    const history = api.createMarkdownEditHistory(initial);
    const prefix = [
      [entered, 71, 'insertParagraph'],
      [quoted, 72, 'insertText'],
      [math, 73, 'insertText'],
      [firstIndent, 77, 'formatIndent']
    ];
    let before = initial;
    let beforeOffset = 64;
    prefix.forEach(([after, afterOffset, inputType], index) => {
      record(api, history, {
        before, after, beforeOffset, afterOffset, inputType, timestamp: index * 100
      });
      before = after;
      beforeOffset = afterOffset;
    });
    api.markMarkdownEditHistorySelectionBoundary(history, caret(76));
    record(api, history, {
      before: firstIndent, after: typed, beforeOffset: 76, afterOffset: 77,
      inputType: 'insertText', timestamp: 400
    });
    record(api, history, {
      before: typed, after: secondIndent, beforeOffset: 77, afterOffset: 81,
      inputType: 'formatIndent', timestamp: 500
    });
    record(api, history, {
      before: secondIndent, after: deletedMath, beforeOffset: 81, afterOffset: 81,
      inputType: 'deleteContentForward', timestamp: 600
    });
    record(api, history, {
      before: deletedMath, after: final, beforeOffset: 81, afterOffset: 80,
      inputType: 'deleteContentBackward', timestamp: 700
    });

    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, secondIndent);
    assert.deepEqual(plainSelection(undo.selection), caret(81));
    assert.deepEqual(
      plainSelection(api.stepMarkdownEditHistory(history, 'redo', secondIndent).selection),
      caret(80)
    );
    const repeatedUndo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(repeatedUndo.source, secondIndent);
    assert.deepEqual(plainSelection(repeatedUndo.selection), caret(82));
  });

  await t.test('47ccd353a53a2f38af51 action 12 isolates typing after an in-history Tab', () => {
    const initial = 'Inline code: `const x = "$notMath$";`';
    const inserted = 'Inline code: `Aconst x = "$notMath$";`';
    const broken = 'Inline code: `\nconst x = "$notMath$";`';
    const firstIndent = 'Inline code: `\n    const x = "$notMath$";`';
    const deleted = 'Inline code: `\n   const x = "$notMath$";`';
    const secondIndent = 'Inline code: `\n       const x = "$notMath$";`';
    const final = 'Inline code: `\n        const x = "$notMath$";`';
    const history = api.createMarkdownEditHistory(initial);
    record(api, history, {
      before: initial, after: inserted, beforeOffset: 14, afterOffset: 15,
      inputType: 'insertText', timestamp: 0
    });
    api.markMarkdownEditHistorySelectionBoundary(history, caret(14));
    record(api, history, {
      before: inserted, after: initial, beforeOffset: 14, afterOffset: 14,
      inputType: 'deleteContentForward', timestamp: 100
    });
    record(api, history, {
      before: initial, after: broken, beforeOffset: 14, afterOffset: 15,
      inputType: 'insertLineBreak', timestamp: 200
    });
    record(api, history, {
      before: broken, after: firstIndent, beforeOffset: 15, afterOffset: 19,
      inputType: 'formatIndent', timestamp: 300
    });
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', firstIndent).source, broken);
    assert.equal(api.stepMarkdownEditHistory(history, 'redo', broken).source, firstIndent);
    api.markMarkdownEditHistorySelectionBoundary(history, caret(18));
    record(api, history, {
      before: firstIndent, after: deleted, beforeOffset: 18, afterOffset: 18,
      inputType: 'deleteContentForward', timestamp: 400
    });
    record(api, history, {
      before: deleted, after: secondIndent, beforeOffset: 18, afterOffset: 22,
      inputType: 'formatIndent', timestamp: 500
    });
    record(api, history, {
      before: secondIndent, after: final, beforeOffset: 22, afterOffset: 23,
      inputType: 'insertText', timestamp: 600
    });

    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, secondIndent);
    assert.deepEqual(plainSelection(undo.selection), caret(22));
  });

  await t.test('11a090f7e3bb618edb45 action 7 joins broad ordered-list renumbering', () => {
    const states = [
      ['1. A\n2. B\n   1. C\n   2. D\n3. E', 16, null],
      ['1. A\n2. B\n   3.  C\n   4. D\n5. E', 17, 'insertText'],
      ['1. A\n2. B\n   3.  \n   4. C\n   5. D\n6. E', 24, 'insertParagraph'],
      ['1. A\n2. B\n   3.  \n   4. \n   5. C\n   6. D\n7. E', 31, 'insertParagraph'],
      ['1. A\n2. B\n   3.  \n   4. \n   5.C\n   5. D\n6. E', 30, 'deleteContentBackward'],
      ['1. A\n2. B\n   3.  \n   4. \n5.C\n   5. D\n6. E', 27, 'formatOutdent'],
      ['1. A\n2. B\n   3.  \n   4. \n5.\n   5. D\n6. E', 27, 'deleteContentForward']
    ];
    const history = api.createMarkdownEditHistory(states[0][0]);
    states.slice(1).forEach(([after, afterOffset, inputType], index) => {
      const [before, beforeOffset] = states[index];
      record(api, history, {
        before, after, beforeOffset, afterOffset, inputType, timestamp: index * 100
      });
    });

    assert.equal(history.undoStack.length, 1);
    const undo = api.stepMarkdownEditHistory(history, 'undo', states.at(-1)[0]);
    assert.equal(undo.source, states[0][0]);
    assert.deepEqual(plainSelection(undo.selection), caret(16));
  });

  await t.test('cdf1ab53a7fb7967a478 action 17 joins normalized Enter to deletions', () => {
    const initial = '1. A\n2. B\n   1. C\n   2. D\n3. E';
    const marked = '1. A\n2. B\n   3. >C\n   4. D\n5. E';
    const ticked = '1. A\n2. B\n   3. >`C\n   4. D\n5. E';
    const firstIndent = '1. A\n2. B\n       1. >`C\n   3. D\n4. E';
    const spaced = '1. A\n2. B\n       1. >` C\n   3. D\n4. E';
    const deleted = '1. A\n2. B\n       1. >` \n   3. D\n4. E';
    const secondIndent = '1. A\n2. B\n           1. >` \n   3. D\n4. E';
    const noSpace = '1. A\n2. B\n           1. >`\n   3. D\n4. E';
    const noTick = '1. A\n2. B\n           1. >\n   3. D\n4. E';
    const entered = '1. A\n2. B\n           1. >\n           2. \n   3. D\n4. E';
    const joined = '1. A\n2. B\n           1. >\n           2.    3. D\n3. E';
    const trimmedOnce = '1. A\n2. B\n           1. >\n           2.   3. D\n3. E';
    const final = '1. A\n2. B\n           1. >\n           2.  3. D\n3. E';
    const history = api.createMarkdownEditHistory(initial);
    const prefix = [
      [marked, 17, 'insertText'],
      [ticked, 18, 'insertText'],
      [firstIndent, 22, 'formatIndent'],
      [spaced, 23, 'insertText'],
      [deleted, 23, 'deleteContentForward'],
      [secondIndent, 27, 'formatIndent']
    ];
    let before = initial;
    let beforeOffset = 16;
    prefix.forEach(([after, afterOffset, inputType], index) => {
      record(api, history, {
        before, after, beforeOffset, afterOffset, inputType, timestamp: index * 100
      });
      before = after;
      beforeOffset = afterOffset;
    });
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', secondIndent).source, deleted);
    assert.equal(api.stepMarkdownEditHistory(history, 'redo', deleted).source, secondIndent);
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', secondIndent).source, deleted);
    assert.equal(api.stepMarkdownEditHistory(history, 'redo', deleted).source, secondIndent);
    record(api, history, {
      before: secondIndent, after: noSpace, beforeOffset: 27, afterOffset: 26,
      inputType: 'deleteContentBackward', timestamp: 600
    });
    record(api, history, {
      before: noSpace, after: noTick, beforeOffset: 26, afterOffset: 25,
      inputType: 'deleteContentBackward', timestamp: 700
    });
    record(api, history, {
      before: noTick, after: entered, beforeOffset: 25, afterOffset: 40,
      inputType: 'insertParagraph', timestamp: 800
    });
    record(api, history, {
      before: entered, after: joined, beforeOffset: 40, afterOffset: 40,
      inputType: 'deleteContentForward', timestamp: 900
    });
    record(api, history, {
      before: joined, after: trimmedOnce, beforeOffset: 40, afterOffset: 40,
      inputType: 'deleteContentForward', timestamp: 1000
    });
    record(api, history, {
      before: trimmedOnce, after: final, beforeOffset: 40, afterOffset: 40,
      inputType: 'deleteContentForward', timestamp: 1100
    });

    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, secondIndent);
    assert.deepEqual(plainSelection(undo.selection), caret(27));
  });
});

test('Round-4 preserved history prefixes replay Obsidian undo groups', async (t) => {
  const api = await markdownHistoryApi();
  const replay = (history, initialSource, initialOffset, steps) => {
    let source = initialSource;
    let offset = initialOffset;
    steps.forEach(([kind, value, nextOffset, inputType], index) => {
      if (kind === 'edit') {
        record(api, history, {
          before: source,
          after: value,
          beforeOffset: offset,
          afterOffset: nextOffset,
          inputType,
          timestamp: index * 100
        });
        source = value;
        offset = nextOffset;
        return;
      }
      if (kind === 'select') {
        api.markMarkdownEditHistorySelectionBoundary(history, caret(value));
        offset = value;
        return;
      }
      const result = api.stepMarkdownEditHistory(history, kind, source);
      assert.ok(result, `${kind} step ${index + 1} is available`);
      assert.equal(result.source, value, `${kind} step ${index + 1} source`);
      assert.deepEqual(
        plainSelection(result.selection),
        caret(nextOffset),
        `${kind} step ${index + 1} selection`
      );
      source = value;
      offset = nextOffset;
    });
    return { source, offset };
  };

  await t.test('daa564d97259e8507239 action 12 includes blank-line Tab in typing group', () => {
    const initial = '```js\n\n```';
    const oneBreak = '```js\n\n\n```';
    const indented = '```js\n\n    ```';
    const history = api.createMarkdownEditHistory(initial);
    const final = '```js\n\n    1\n    \n    ```';
    const state = replay(history, initial, 6, [
      ['edit', '```js\n \n```', 7, 'insertText'],
      ['edit', initial, 6, 'deleteContentBackward'],
      ['edit', oneBreak, 7, 'insertLineBreak'],
      ['edit', '```js\n\n \n```', 8, 'insertText'],
      ['edit', oneBreak, 7, 'deleteContentBackward'],
      ['edit', initial, 7, 'deleteContentForward'],
      ['edit', indented, 11, 'formatIndent'],
      ['edit', '```js\n\n    1```', 12, 'insertText'],
      ['edit', '```js\n\n    1\n    ```', 17, 'insertParagraph'],
      ['edit', final, 22, 'insertLineBreak']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', state.source);
    assert.equal(undo.source, initial);
    assert.deepEqual(plainSelection(undo.selection), caret(7));
  });

  await t.test('f79fc4408b365dfd8324 action 12 consumes inverse second indentation', () => {
    const initial = 'Escaped symbols: \\*not italic\\*, \\# not a heading.';
    const inserted = 'Escaped symbols: \\**not italic\\*, \\# not a heading.';
    const broken = 'Escaped symbols: \\*\nnot italic\\*, \\# not a heading.';
    const firstIndent = 'Escaped symbols: \\*\n    not italic\\*, \\# not a heading.';
    const secondIndent = 'Escaped symbols: \\*\n        not italic\\*, \\# not a heading.';
    const history = api.createMarkdownEditHistory(initial);
    replay(history, initial, 19, [
      ['edit', inserted, 20, 'insertText'],
      ['undo', initial, 19],
      ['redo', inserted, 20],
      ['select', 19],
      ['edit', initial, 19, 'deleteContentForward'],
      ['edit', broken, 20, 'insertParagraph'],
      ['edit', firstIndent, 24, 'formatIndent'],
      ['undo', broken, 20],
      ['redo', firstIndent, 24],
      ['edit', secondIndent, 28, 'formatIndent'],
      ['edit', firstIndent, 24, 'deleteContentBackward']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', firstIndent);
    assert.equal(undo.source, firstIndent);
    assert.deepEqual(plainSelection(undo.selection), caret(24));
  });

  await t.test('6318e4b97afcd2a786c3 action 4 consumes inverse blank-line indentation', () => {
    const broken = '\n';
    const indented = '\n    ';
    const history = api.createMarkdownEditHistory('');
    replay(history, '', 0, [
      ['edit', broken, 1, 'insertLineBreak'],
      ['edit', indented, 5, 'formatIndent'],
      ['edit', broken, 1, 'deleteContentBackward']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', broken);
    assert.equal(undo.source, broken);
    assert.deepEqual(plainSelection(undo.selection), caret(1));
  });

  await t.test('4862111c0826e1a0f802 action 12 starts at deep Shift-Enter', () => {
    const initial = '* Star\n\n+ Plus';
    const spaced = '*  Star\n\n+ Plus';
    const firstIndent = '    *  Star\n\n+ Plus';
    const secondIndent = '        *  Star\n\n+ Plus';
    const broken = '        *  Sta\n          r\n\n+ Plus';
    const outdented = '        *  Sta\n      r\n\n+ Plus';
    const final = '        *  Sta\n    r\n\n+ Plus';
    const history = api.createMarkdownEditHistory(initial);
    replay(history, initial, 2, [
      ['edit', spaced, 3, 'insertText'],
      ['select', 4],
      ['edit', firstIndent, 8, 'formatIndent'],
      ['select', 9],
      ['select', 10],
      ['edit', '    *  Sta r\n\n+ Plus', 11, 'insertText'],
      ['edit', firstIndent, 10, 'deleteContentBackward'],
      ['edit', secondIndent, 14, 'formatIndent'],
      ['edit', broken, 25, 'insertLineBreak'],
      ['edit', outdented, 21, 'formatOutdent'],
      ['edit', final, 19, 'deleteContentBackward']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, secondIndent);
    assert.deepEqual(plainSelection(undo.selection), caret(14));
  });

  await t.test('11a090f7e3bb618edb45 action 9 replays insertion-led undo caret', () => {
    const states = [
      ['1. A\n2. B\n   1. C\n   2. D\n3. E', 16, null],
      ['1. A\n2. B\n   3.  C\n   4. D\n5. E', 17, 'insertText'],
      ['1. A\n2. B\n   3.  \n   4. C\n   5. D\n6. E', 24, 'insertParagraph'],
      ['1. A\n2. B\n   3.  \n   4. \n   5. C\n   6. D\n7. E', 31, 'insertParagraph'],
      ['1. A\n2. B\n   3.  \n   4. \n   5.C\n   5. D\n6. E', 30, 'deleteContentBackward'],
      ['1. A\n2. B\n   3.  \n   4. \n5.C\n   5. D\n6. E', 27, 'formatOutdent'],
      ['1. A\n2. B\n   3.  \n   4. \n5.\n   5. D\n6. E', 27, 'deleteContentForward']
    ];
    const history = api.createMarkdownEditHistory(states[0][0]);
    states.slice(1).forEach(([after, afterOffset, inputType], index) => {
      const [before, beforeOffset] = states[index];
      record(api, history, {
        before, after, beforeOffset, afterOffset, inputType, timestamp: index * 100
      });
    });
    const final = states.at(-1)[0];
    assert.deepEqual(
      plainSelection(api.stepMarkdownEditHistory(history, 'undo', final).selection),
      caret(16)
    );
    assert.deepEqual(
      plainSelection(api.stepMarkdownEditHistory(history, 'redo', states[0][0]).selection),
      caret(27)
    );
    const repeatedUndo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(repeatedUndo.source, states[0][0]);
    assert.deepEqual(plainSelection(repeatedUndo.selection), caret(17));
  });

  await t.test('a6c40579ea7842824697 action 13 joins inverse Tab and Shift-Enter', () => {
    const initial = '<https://example.com> and https://literal.example/path';
    const broken = '<\nhttps://example.com> and https://literal.example/path';
    const firstIndent = '<\n    https://example.com> and https://literal.example/path';
    const firstBreak = '<\n    \n    https://example.com> and https://literal.example/path';
    const secondIndent = '<\n    \n        https://example.com> and https://literal.example/path';
    const final = '<\n    \n    \n    https://example.com> and https://literal.example/path';
    const history = api.createMarkdownEditHistory(initial);
    replay(history, initial, 1, [
      ['edit', broken, 2, 'insertParagraph'],
      ['undo', initial, 1],
      ['redo', broken, 2],
      ['edit', firstIndent, 6, 'formatIndent'],
      ['undo', broken, 2],
      ['redo', firstIndent, 6],
      ['undo', broken, 2],
      ['redo', firstIndent, 6],
      ['edit', firstBreak, 11, 'insertParagraph'],
      ['edit', secondIndent, 15, 'formatIndent'],
      ['edit', firstBreak, 11, 'deleteContentBackward'],
      ['edit', final, 16, 'insertLineBreak']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, firstBreak);
    assert.deepEqual(plainSelection(undo.selection), caret(11));
  });

  await t.test('410d77b9df51f401b0bc action 15 includes blank-line Tab in typing group', () => {
    const initial = 'A\nB\n    C\nD';
    const emptyTail = 'A\nB\n    * \n  \n  \n';
    const indented = `${emptyTail}    `;
    const final = `${emptyTail}    1\n    \n    `;
    const history = api.createMarkdownEditHistory(initial);
    replay(history, initial, 8, [
      ['edit', 'A\nB\n    *C\nD', 9, 'insertText'],
      ['edit', 'A\nB\n    * C\nD', 10, 'insertText'],
      ['edit', 'A\nB\n    * \nD', 10, 'deleteContentForward'],
      ['edit', 'A\nB\n    * \n      \nD', 17, 'insertLineBreak'],
      ['edit', 'A\nB\n    * \n  \nD', 13, 'insertParagraph'],
      ['select', 12],
      ['select', 13],
      ['edit', 'A\nB\n    * \n  \n  \nD', 16, 'insertLineBreak'],
      ['select', 17],
      ['edit', emptyTail, 17, 'deleteContentForward'],
      ['edit', indented, 21, 'formatIndent'],
      ['edit', `${emptyTail}    1`, 22, 'insertText'],
      ['edit', `${emptyTail}    1\n    `, 27, 'insertLineBreak'],
      ['edit', final, 32, 'insertLineBreak']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, emptyTail);
    assert.deepEqual(plainSelection(undo.selection), caret(17));
  });

  await t.test('1c7706220688af8fba13 action 6 consumes inverse second indentation', () => {
    const initial = '![Diagram][asset]\n\n[asset]: assets/images/example.png "Example title"';
    const inserted = '![xDiagram][asset]\n\n[asset]: assets/images/example.png "Example title"';
    const broken = '![x\nDiagram][asset]\n\n[asset]: assets/images/example.png "Example title"';
    const firstIndent = '![x\n    Diagram][asset]\n\n[asset]: assets/images/example.png "Example title"';
    const secondIndent = '![x\n        Diagram][asset]\n\n[asset]: assets/images/example.png "Example title"';
    const history = api.createMarkdownEditHistory(initial);
    replay(history, initial, 2, [
      ['edit', inserted, 3, 'insertText'],
      ['edit', broken, 4, 'insertLineBreak'],
      ['edit', firstIndent, 8, 'formatIndent'],
      ['edit', secondIndent, 12, 'formatIndent'],
      ['edit', firstIndent, 8, 'deleteContentBackward']
    ]);

    const undo = api.stepMarkdownEditHistory(history, 'undo', firstIndent);
    assert.equal(undo.source, firstIndent);
    assert.deepEqual(plainSelection(undo.selection), caret(8));
  });
});

test('v0.3 list-random history groups replay the minimized O1 contracts', async (t) => {
  const api = await markdownHistoryApi();

  await t.test('Tab then Shift-Tab is one consumable net-zero list group', () => {
    const before = '- Alpha\n* eta\n+ Gamma';
    const indented = '- Alpha\n    * eta\n+ Gamma';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after: indented, beforeOffset: 10, afterOffset: 14,
      inputType: 'formatIndent', timestamp: 0
    });
    record(api, history, {
      before: indented, after: before, beforeOffset: 14, afterOffset: 10,
      inputType: 'formatOutdent', timestamp: 100
    });

    assert.equal(history.undoStack.length, 1);
    const undo = api.stepMarkdownEditHistory(history, 'undo', before);
    assert.equal(undo.source, before);
    assert.deepEqual(plainSelection(undo.selection), caret(10));
  });

  await t.test('Shift-Tab then inverse Tab remains two list groups', () => {
    const indented = '- Alpha\n    * eta\n+ Gamma';
    const outdented = '- Alpha\n* eta\n+ Gamma';
    const history = api.createMarkdownEditHistory(indented);
    record(api, history, {
      before: indented, after: outdented, beforeOffset: 14, afterOffset: 10,
      inputType: 'formatOutdent', timestamp: 0
    });
    record(api, history, {
      before: outdented, after: indented, beforeOffset: 10, afterOffset: 14,
      inputType: 'formatIndent', timestamp: 100
    });

    assert.equal(history.undoStack.length, 2);
    const undo = api.stepMarkdownEditHistory(history, 'undo', indented);
    assert.equal(undo.source, outdented);
    assert.deepEqual(plainSelection(undo.selection), caret(10));
  });

  await t.test('list Tab is isolated from Enter while following text joins Enter', () => {
    const before = '0. A\n1. xB\n2. C';
    const indented = '0. A\n    1. xB\n1. C';
    const entered = '0. A\n    1. x\n    2. B\n1. C';
    const typed = '0. A\n    1. x\n    2. xB\n1. C';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after: indented, beforeOffset: 9, afterOffset: 13,
      inputType: 'formatIndent', timestamp: 0
    });
    record(api, history, {
      before: indented, after: entered, beforeOffset: 13, afterOffset: 21,
      inputType: 'insertParagraph', timestamp: 100
    });
    record(api, history, {
      before: entered, after: typed, beforeOffset: 21, afterOffset: 22,
      inputType: 'insertText', timestamp: 200
    });

    assert.equal(history.undoStack.length, 2);
    const undo = api.stepMarkdownEditHistory(history, 'undo', typed);
    assert.equal(undo.source, indented);
    assert.deepEqual(plainSelection(undo.selection), caret(13));
  });

  await t.test('ordered-marker Backspaces stay in their preceding Tab group', () => {
    const before = '1. A\n2. 1B\n3. C';
    const indented = '1. A\n    1. 1B\n2. C';
    const firstDelete = '1. A\n    1. B\n2. C';
    const final = '1. A\n    1.B\n2. C';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after: indented, beforeOffset: 9, afterOffset: 13,
      inputType: 'formatIndent', timestamp: 0
    });
    record(api, history, {
      before: indented, after: firstDelete, beforeOffset: 13, afterOffset: 12,
      inputType: 'deleteContentBackward', timestamp: 100
    });
    record(api, history, {
      before: firstDelete, after: final, beforeOffset: 12, afterOffset: 11,
      inputType: 'deleteContentBackward', timestamp: 200
    });

    assert.equal(history.undoStack.length, 1);
    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, before);
    assert.deepEqual(plainSelection(undo.selection), caret(9));
  });

  await t.test('list Shift-Tab isolates the following deletion', () => {
    const indented = '1. Alpha\n    1. xxBeta\n2. Gamma';
    const outdented = '1. Alpha\n2. xxBeta\n3. Gamma';
    const deleted = '1. Alpha\n2. xxeta\n3. Gamma';
    const history = api.createMarkdownEditHistory(indented);
    record(api, history, {
      before: indented, after: outdented, beforeOffset: 18, afterOffset: 14,
      inputType: 'formatOutdent', timestamp: 0
    });
    record(api, history, {
      before: outdented, after: deleted, beforeOffset: 14, afterOffset: 14,
      inputType: 'deleteContentForward', timestamp: 100
    });

    assert.equal(history.undoStack.length, 2);
    const undo = api.stepMarkdownEditHistory(history, 'undo', deleted);
    assert.equal(undo.source, outdented);
    assert.deepEqual(plainSelection(undo.selection), caret(14));
  });

  await t.test('plain consecutive Enters in a list continuation remain separate', () => {
    const before = '- Alpha\n*  \n*Beta\n+ Gamma';
    const first = '- Alpha\n*  \n*B\neta\n+ Gamma';
    const second = '- Alpha\n*  \n*B\n\neta\n+ Gamma';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after: first, beforeOffset: 14, afterOffset: 15,
      inputType: 'insertParagraph', timestamp: 0
    });
    record(api, history, {
      before: first, after: second, beforeOffset: 15, afterOffset: 16,
      inputType: 'insertParagraph', timestamp: 100
    });

    assert.equal(history.undoStack.length, 2);
    const undo = api.stepMarkdownEditHistory(history, 'undo', second);
    assert.equal(undo.source, first);
    assert.deepEqual(plainSelection(undo.selection), caret(15));
  });

  await t.test('list typing and deletion use the O1 action-trace grouping window', () => {
    const before = '- Alpha\n  continued alpha\n  1. 1Beta\n- Gamma';
    const typed = '- Alpha\n  continued alpha\n  1. 1Bexta\n- Gamma';
    const deleted = '- Alpha\n  continued alpha\n  1. 1Bexa\n- Gamma';
    const final = '- Alpha\n  continued alpha\n  1. 1Bex*a\n- Gamma';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after: typed, beforeOffset: 34, afterOffset: 35,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: typed, after: deleted, beforeOffset: 35, afterOffset: 35,
      inputType: 'deleteContentForward', timestamp: 900
    });
    record(api, history, {
      before: deleted, after: final, beforeOffset: 35, afterOffset: 36,
      inputType: 'insertText', timestamp: 1_800
    });

    assert.equal(history.undoStack.length, 1);
    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, before);
    assert.deepEqual(plainSelection(undo.selection), caret(34));
  });

  await t.test('normalized unordered edit does not absorb the next Enter group', () => {
    const before = '1. Alpha\n   - Beta\n2. Gamma';
    const typed = '1. Alpha\n   - 1Beta\n1. Gamma';
    const normalized = '1. Alpha\n   - Beta\n1. Gamma';
    const entered = '1. Alpha\n   - \n   - Beta\n1. Gamma';
    const final = '1. Alpha\n   - \n   -Beta\n1. Gamma';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after: typed, beforeOffset: 14, afterOffset: 15,
      inputType: 'insertText', timestamp: 0
    });
    record(api, history, {
      before: typed, after: normalized, beforeOffset: 15, afterOffset: 14,
      inputType: 'deleteContentBackward', timestamp: 100
    });
    record(api, history, {
      before: normalized, after: entered, beforeOffset: 14, afterOffset: 20,
      inputType: 'insertParagraph', timestamp: 200
    });
    record(api, history, {
      before: entered, after: final, beforeOffset: 20, afterOffset: 19,
      inputType: 'deleteContentBackward', timestamp: 300
    });

    assert.equal(history.undoStack.length, 2);
    const undo = api.stepMarkdownEditHistory(history, 'undo', final);
    assert.equal(undo.source, normalized);
    assert.deepEqual(plainSelection(undo.selection), caret(14));
  });

  await t.test('repeated list Undo restores the transaction before-selection', () => {
    const before = '4. A\n2. B\n19. C';
    const after = '4. A\n5. *B\n6. C';
    const history = api.createMarkdownEditHistory(before);
    record(api, history, {
      before, after, beforeOffset: 8, afterOffset: 9,
      inputType: 'insertText', timestamp: 0
    });
    assert.equal(api.stepMarkdownEditHistory(history, 'undo', after).source, before);
    assert.equal(api.stepMarkdownEditHistory(history, 'redo', before).source, after);
    const repeatedUndo = api.stepMarkdownEditHistory(history, 'undo', after);
    assert.equal(repeatedUndo.source, before);
    assert.deepEqual(plainSelection(repeatedUndo.selection), caret(8));
  });

  await t.test('a root-list no-op Shift-Tab consumes its own history entry', () => {
    const source = '9. A\n10. B\n11. C';
    const history = api.createMarkdownEditHistory(source);
    api.recordMarkdownEditTransaction(history, {
      beforeSource: source,
      afterSource: source,
      beforeSelection: caret(10),
      afterSelection: caret(10),
      inputType: 'formatOutdent',
      timestamp: 0
    }, {
      coalesce: false,
      recordNoOp: true
    });

    assert.equal(history.undoStack.length, 1);
    const undo = api.stepMarkdownEditHistory(history, 'undo', source);
    assert.equal(undo.source, source);
    assert.deepEqual(plainSelection(undo.selection), caret(10));
  });
});

const round2FirstHistoryTargets = new Set([
  'list-random-500.013.7bb2baa01bed4f63:9',
  'list-random-500.028.a4e3a12defe67693:6',
  'list-random-500.060.47458f3aa535ff0c:4',
  'list-random-500.064.09177cdb4fef1983:7',
  'list-random-500.067.4355144eb48a5e0a:9',
  'list-random-500.074.84babbee15e832f3:10',
  'list-random-500.084.c9e9818f4f4d90c6:9',
  'list-random-500.096.3505c719308d7450:8',
  'list-random-500.121.b0427133d006a700:6',
  'list-random-500.144.168da368bbc4d832:5',
  'list-random-500.163.8a67c2da55d306bd:8',
  'list-random-500.189.2d0cc0f56528bc3b:8',
  'list-random-500.195.c3bc6e1ed4cc8e9f:4',
  'list-random-500.199.24ab105962e61f0c:11',
  'list-random-500.208.1b15297196987188:7',
  'list-random-500.217.20a42f390724b7c4:9',
  'list-random-500.236.4f41553442c20a9a:7',
  'list-random-500.238.b60d90de3b1a67d6:5',
  'list-random-500.240.357297e007fcaef2:6',
  'list-random-500.285.117114749c7929c2:5',
  'list-random-500.309.c0d523c07aedce8c:10',
  'list-random-500.340.d751fd1d3920bbc4:7',
  'list-random-500.364.75b1a3cad13300fd:9',
  'list-random-500.402.037495b3870a2c0e:4',
  'list-random-500.414.4ad68a4ced9ab16f:9',
  'list-random-500.423.57ce3263ddc4fae0:6'
]);

const round2HistoryInputTypes = Object.freeze({
  backspace: 'deleteContentBackward',
  delete: 'deleteContentForward',
  enter: 'insertParagraph',
  'shift-enter': 'insertLineBreak',
  'shift-tab': 'formatOutdent',
  tab: 'formatIndent',
  'type-text': 'insertText'
});

function round2HistoryTypeText(model, source, selection, text) {
  const start = Math.min(selection.anchor, selection.focus);
  const end = Math.max(selection.anchor, selection.focus);
  const pairedMarker = text === '*' || text === '`';
  if (start === end
    && pairedMarker
    && source[start] === text
    && source[start + 1] === text) {
    return {
      source,
      selection: caret(start + 1)
    };
  }
  const autoPaired = start === end
    && pairedMarker
    && (!source[start - 1] || /\s/u.test(source[start - 1]))
    && (!source[start] || /\s/u.test(source[start]) || source[start] === text);
  const replacement = autoPaired ? `${text}${text}` : text;
  const rawAfter = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  return model.normalizeMarkdownOrderedMarkersAfterEdit(source, rawAfter, {
    inputType: 'insertText',
    selection: caret(start + text.length)
  });
}

function round2HistoryDirectAction(model, source, selection, action) {
  if (action.id === 'enter' || action.id === 'shift-enter') {
    return model.applyMarkdownNewline(source, selection, {
      inputType: action.id === 'enter' ? 'insertParagraph' : 'insertLineBreak'
    });
  }
  if (action.id === 'tab' || action.id === 'shift-tab') {
    return model.applyMarkdownIndentation(
      source,
      selection,
      action.id === 'tab' ? 'indent' : 'outdent'
    );
  }
  if (action.id === 'type-text') {
    return round2HistoryTypeText(model, source, selection, action.text);
  }
  if (action.type === 'click'
    && action.fixedOffset === true
    && Number.isSafeInteger(action.offset)) {
    return {
      source,
      selection: caret(action.offset)
    };
  }
  if (action.id === 'arrowleft' || action.id === 'arrowright') {
    const delta = action.id === 'arrowleft' ? -1 : 1;
    return {
      source,
      selection: caret(selection.focus + delta)
    };
  }
  if (action.id === 'backspace' || action.id === 'delete') {
    const forward = action.id === 'delete';
    const structural = model.applyMarkdownStructuralDeletion(
      source,
      selection,
      forward ? 'forward' : 'backward'
    );
    if (structural.changed) return structural;
    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    const deletionStart = start !== end
      ? start
      : forward ? start : Math.max(0, start - 1);
    const deletionEnd = start !== end
      ? end
      : forward ? Math.min(source.length, start + 1) : start;
    return {
      source: `${source.slice(0, deletionStart)}${source.slice(deletionEnd)}`,
      selection: caret(deletionStart)
    };
  }
  throw new Error(`Unsupported Round-2 history action ${action.id}`);
}

test('corrected Round-2 first history divergences replay exact O1 source and selection', async () => {
  const { api, model } = await markdownHistoryModelHarness();
  const cases = round2MinimizedGate.sequences.filter((scenario) => {
    const metadata = scenario.repairMetadata || {};
    return round2FirstHistoryTargets.has(
      `${metadata.originScenarioId}:${metadata.divergentActionNumber}`
    );
  });
  assert.equal(cases.length, 26);

  for (const scenario of cases) {
    let source = scenario.initialSource;
    let selection = plainSelection(scenario.initialSelection);
    const history = api.createMarkdownEditHistory(source);
    for (const [index, action] of scenario.actions.entries()) {
      if (action.id === 'undo' || action.id === 'redo') {
        const result = api.stepMarkdownEditHistory(history, action.id, source);
        assert.ok(result, `${scenario.id} ${action.id} is available`);
        source = result.source;
        selection = plainSelection(result.selection);
        continue;
      }

      const result = round2HistoryDirectAction(model, source, selection, action);
      if (action.historyEffect === 'navigation') {
        if (!result.selection
          || result.selection.anchor !== selection.anchor
          || result.selection.focus !== selection.focus) {
          api.markMarkdownEditHistorySelectionBoundary(history, result.selection);
        }
      } else if (result.source !== source) {
        api.recordMarkdownEditTransaction(history, {
          beforeSource: source,
          afterSource: result.source,
          beforeSelection: selection,
          afterSelection: result.selection,
          inputType: round2HistoryInputTypes[action.id],
          timestamp: index * 100
        });
      } else if (action.id === 'shift-tab') {
        api.recordMarkdownEditTransaction(history, {
          beforeSource: source,
          afterSource: source,
          beforeSelection: selection,
          afterSelection: result.selection,
          inputType: 'formatOutdent',
          timestamp: index * 100
        }, {
          coalesce: false,
          recordNoOp: true
        });
      }
      source = result.source;
      selection = plainSelection(result.selection);
    }

    assert.equal(source, scenario.oracleExpected.source, scenario.id);
    assert.deepEqual(selection, scenario.oracleExpected.selection, scenario.id);
  }
});
