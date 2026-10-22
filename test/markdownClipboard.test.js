const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function markdownViewApi() {
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

const SOURCE = [
  '# Heading',
  '',
  'Normal **bold**, *italic*, ~~strike~~ and `code`.',
  '',
  '[Link](https://example.com)',
  '',
  'Inline formula: $C_6H_{12}O_6$.',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```javascript',
  'const formula = "$x^2$";',
  '```'
].join('\n');

test('canonical Markdown clipboard ranges preserve exact bytes and direction', async () => {
  const api = await markdownViewApi();
  const strike = SOURCE.indexOf('~~strike~~');
  const crossBlockStart = SOURCE.indexOf('Normal');
  const crossBlockEnd = SOURCE.indexOf('| 1 | 2 |') + '| 1 | 2 |'.length;

  assert.equal(api.canonicalMarkdownSelectionText(SOURCE, {
    kind: 'whole-body'
  }), SOURCE);
  assert.equal(api.canonicalMarkdownSelectionText(SOURCE, {
    kind: 'partial-body', anchor: strike, focus: strike + '~~strike~~'.length
  }), '~~strike~~');
  assert.equal(api.canonicalMarkdownSelectionText(SOURCE, {
    kind: 'partial-body', anchor: strike + 2, focus: strike + 8
  }), 'strike');
  assert.equal(api.canonicalMarkdownSelectionText(SOURCE, {
    kind: 'partial-body', anchor: strike + 4, focus: strike
  }), '~~st');
  assert.equal(api.canonicalMarkdownSelectionText(SOURCE, {
    kind: 'partial-body', anchor: crossBlockEnd, focus: crossBlockStart
  }), SOURCE.slice(crossBlockStart, crossBlockEnd));
});

test('canonical Markdown clipboard ranges clamp safely without changing source', async () => {
  const api = await markdownViewApi();
  assert.deepEqual(
    { ...api.normalizedMarkdownSelectionRange(SOURCE.length, { anchor: -50, focus: 1e9 }) },
    { start: 0, end: SOURCE.length }
  );
  assert.equal(
    api.canonicalMarkdownSelectionText(SOURCE, { anchor: SOURCE.length, focus: 0 }),
    SOURCE
  );
  assert.equal(SOURCE.includes('\u200b'), false);
});

test('Markdown source history coalesces typing and restores exact source selections', async () => {
  const api = await markdownViewApi();
  const history = api.createMarkdownEditHistory('');
  api.recordMarkdownEditTransaction(history, {
    beforeSource: '',
    afterSource: 'a',
    beforeSelection: { anchor: 0, focus: 0 },
    afterSelection: { anchor: 1, focus: 1 },
    inputType: 'insertText',
    timestamp: 100
  });
  api.recordMarkdownEditTransaction(history, {
    beforeSource: 'a',
    afterSource: 'abc',
    beforeSelection: { anchor: 1, focus: 1 },
    afterSelection: { anchor: 3, focus: 3 },
    inputType: 'insertText',
    timestamp: 200
  });

  assert.equal(history.undoStack.length, 1);
  const undone = api.stepMarkdownEditHistory(history, 'undo', 'abc');
  assert.equal(undone.source, '');
  assert.deepEqual({ ...undone.selection }, { anchor: 0, focus: 0 });
  const redone = api.stepMarkdownEditHistory(history, 'redo', '');
  assert.equal(redone.source, 'abc');
  assert.deepEqual({ ...redone.selection }, { anchor: 3, focus: 3 });
});

test('Markdown source history treats paste, cut, and marker replacements as exact transactions', async () => {
  const api = await markdownViewApi();
  const history = api.createMarkdownEditHistory('~~strike~~');
  api.recordMarkdownEditTransaction(history, {
    beforeSource: '~~strike~~',
    afterSource: 'strike',
    beforeSelection: { anchor: 0, focus: 10 },
    afterSelection: { anchor: 6, focus: 6 },
    inputType: 'deleteByCut',
    timestamp: 100
  });
  api.recordMarkdownEditTransaction(history, {
    beforeSource: 'strike',
    afterSource: '**strike**',
    beforeSelection: { anchor: 0, focus: 6 },
    afterSelection: { anchor: 10, focus: 10 },
    inputType: 'insertFromPaste',
    timestamp: 200
  });

  assert.equal(history.undoStack.length, 2);
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', '**strike**').source, 'strike');
  assert.equal(api.stepMarkdownEditHistory(history, 'undo', 'strike').source, '~~strike~~');
  assert.equal(api.stepMarkdownEditHistory(history, 'redo', '~~strike~~').source, 'strike');

  api.recordMarkdownEditTransaction(history, {
    beforeSource: 'strike',
    afterSource: '*strike*',
    beforeSelection: { anchor: 0, focus: 6 },
    afterSelection: { anchor: 8, focus: 8 },
    inputType: 'insertText',
    timestamp: 5000
  });
  assert.equal(history.redoStack.length, 0);
});

test('external canonical Markdown changes rebase a view instead of becoming local Undo', async () => {
  const api = await markdownViewApi();
  const history = api.createMarkdownEditHistory('local');
  api.recordMarkdownEditTransaction(history, {
    beforeSource: 'local',
    afterSource: 'local edit',
    beforeSelection: { anchor: 5, focus: 5 },
    afterSelection: { anchor: 10, focus: 10 },
    inputType: 'insertText',
    timestamp: 100
  });

  assert.equal(api.stepMarkdownEditHistory(history, 'undo', 'remote edit'), null);
  assert.equal(history.currentSource, 'remote edit');
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
});
