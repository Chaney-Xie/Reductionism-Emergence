const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = require('../public/markdownPage');
const foundation = require('../public/markdownEditableFoundation');
const projectionRuntime = require('../public/js/markdownEditableProjection');
const syntaxAdapters = require('../public/js/markdownEditableSyntaxAdapters');
const runtime = require('../public/vendor/markdownRuntime');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

if (typeof FakeElement.prototype.before !== 'function') {
  Object.defineProperty(FakeElement.prototype, 'before', {
    configurable: true,
    value(...nodes) {
      const parent = this.parentNode;
      if (!parent) return;
      const insertionIndex = parent.childNodes.indexOf(this);
      nodes.forEach((node, offset) => {
        node.parentNode = parent;
        node.parentElement = parent.nodeType === 1 ? parent : parent.parentElement;
        parent.childNodes.splice(insertionIndex + offset, 0, node);
      });
    }
  });
}

function loadMarkdownPageViewApi() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public/js/markdownPageView.js'),
    'utf8'
  );
  const root = {
    addEventListener() {},
    markdownPageModel: markdown,
    markdownRuntime: runtime
  };
  vm.runInNewContext(source, { console, globalThis: root, window: root });
  return root.markdownPageView;
}

function loadFreshMarkdownController(names) {
  return loadMarkdownPageViewInternals(names, {
    globalThis: {
      markdownRuntime: runtime,
      markdownEditableFoundation: foundation,
      markdownEditableProjection: projectionRuntime,
      markdownEditableSyntaxAdapters: syntaxAdapters
    }
  });
}

function elementWithClass(root, className) {
  return descendants(root).find((element) => element?.classList?.contains(className)) || null;
}

function firstFencedCodeNode(source) {
  const tree = markdown.parseMarkdownDocument(source);
  return (tree.children || []).find((node) => node.type === 'code');
}

function replaceOpeningFenceLanguage(source, languageId) {
  const language = runtime.languageMetadata.find((candidate) => candidate.id === languageId);
  assert.ok(language, `expected a selectable language for ${languageId}`);
  const node = firstFencedCodeNode(source);
  assert.ok(node, 'expected a fenced code node');
  const fence = markdown.codeFenceRanges(source, node);
  assert.equal(fence.fenced, true);
  const replacement = language.id === 'plaintext' ? '' : language.id;
  return {
    fence,
    source: source.slice(0, fence.infoStart) + replacement + source.slice(fence.infoEnd)
  };
}

test('code-language menu metadata exposes the approved 20 languages and aliases', () => {
  const expected = [
    ['plaintext', 'Plain Text', ['text', 'txt']],
    ['javascript', 'JavaScript', ['js', 'jsx', 'mjs', 'cjs']],
    ['typescript', 'TypeScript', ['ts', 'tsx']],
    ['json', 'JSON', ['jsonc']],
    ['xml', 'HTML/XML', ['html', 'htm', 'svg']],
    ['css', 'CSS', ['scss', 'less']],
    ['python', 'Python', ['py']],
    ['r', 'R', []],
    ['bash', 'Bash/Shell', ['sh', 'shell', 'zsh']],
    ['sql', 'SQL', []],
    ['java', 'Java', []],
    ['c', 'C', ['h']],
    ['cpp', 'C++', ['c++', 'cc', 'cxx', 'hpp']],
    ['csharp', 'C#', ['cs']],
    ['rust', 'Rust', ['rs']],
    ['go', 'Go', ['golang']],
    ['matlab', 'MATLAB', []],
    ['markdown', 'Markdown', ['md']],
    ['yaml', 'YAML', ['yml']],
    ['latex', 'LaTeX', ['tex']]
  ];

  assert.equal(runtime.languageMetadata.length, 20);
  assert.deepEqual(
    runtime.languageMetadata.map(({ id, label, aliases }) => [id, label, [...aliases]]),
    expected
  );

  for (const [id, label, aliases] of expected) {
    for (const spelling of [id, ...aliases]) {
      const resolved = runtime.resolveCodeLanguage(spelling);
      assert.equal(resolved.id, id, `${spelling} resolves to ${id}`);
      assert.equal(resolved.label, label, `${spelling} keeps the menu label`);
      assert.equal(resolved.known, true, `${spelling} is locally bundled`);
    }
  }
});

test('language selection replaces only the opening info string and is one Undo/Redo transaction', () => {
  const view = loadMarkdownPageViewApi();
  const before = [
    'Before',
    '',
    '~~~~future-lang metadata that is replaced',
    'const formula = "$x^2$";',
    '``` remains code content',
    '~~~~~',
    '',
    'After'
  ].join('\n');
  const originalNode = firstFencedCodeNode(before);
  const originalFence = markdown.codeFenceRanges(before, originalNode);
  const originalBody = before.slice(originalFence.bodyStart, originalFence.bodyEnd);
  const originalClosingAndSuffix = before.slice(originalFence.closingStart);
  const changed = replaceOpeningFenceLanguage(before, 'javascript');
  const after = changed.source;
  const changedNode = firstFencedCodeNode(after);
  const changedFence = markdown.codeFenceRanges(after, changedNode);

  assert.equal(
    after.slice(0, changed.fence.infoStart),
    before.slice(0, originalFence.infoStart),
    'opening fence marker and preceding source are unchanged'
  );
  assert.equal(after.slice(changedFence.bodyStart, changedFence.bodyEnd), originalBody);
  assert.equal(after.slice(changedFence.closingStart), originalClosingAndSuffix);
  assert.equal(changedNode.lang, 'javascript');
  assert.equal(changedNode.meta, null);

  const history = view.createMarkdownEditHistory(before);
  assert.equal(view.recordMarkdownEditTransaction(history, {
    beforeSource: before,
    afterSource: after,
    beforeSelection: { anchor: originalFence.bodyStart, focus: originalFence.bodyEnd },
    afterSelection: { anchor: changedFence.bodyStart, focus: changedFence.bodyEnd },
    inputType: 'formatCodeLanguage',
    timestamp: 100
  }, { coalesce: false }), true);
  assert.equal(history.undoStack.length, 1);

  const undo = view.stepMarkdownEditHistory(history, 'undo', after);
  assert.equal(undo.source, before);
  assert.deepEqual(
    { ...undo.selection },
    { anchor: originalFence.bodyStart, focus: originalFence.bodyEnd }
  );
  assert.equal(view.stepMarkdownEditHistory(history, 'undo', before), null);

  const redo = view.stepMarkdownEditHistory(history, 'redo', before);
  assert.equal(redo.source, after);
  assert.deepEqual(
    { ...redo.selection },
    { anchor: changedFence.bodyStart, focus: changedFence.bodyEnd }
  );
  assert.equal(view.stepMarkdownEditHistory(history, 'redo', after), null);
});

test('Plain Text removes the info string while unknown source languages remain safe and byte-stable', () => {
  const unknownSource = [
    '```future-lang',
    '<script>alert(1)</script>',
    '```'
  ].join('\n');
  const unknownNode = firstFencedCodeNode(unknownSource);
  const unknownFence = markdown.codeFenceRanges(unknownSource, unknownNode);
  const unknownBody = unknownSource.slice(unknownFence.bodyStart, unknownFence.bodyEnd);
  const unknownResolution = runtime.resolveCodeLanguage(unknownNode.lang);
  const unknown = runtime.highlightCode(unknownNode.value, unknownNode.lang);

  assert.deepEqual(
    {
      id: unknownResolution.id,
      label: unknownResolution.label,
      declaredLanguage: unknownResolution.declaredLanguage,
      known: unknownResolution.known
    },
    {
      id: null,
      label: 'future-lang',
      declaredLanguage: 'future-lang',
      known: false
    }
  );
  assert.equal(unknown.html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(unknownNode.value, '<script>alert(1)</script>');

  const plainSource = replaceOpeningFenceLanguage(unknownSource, 'plaintext').source;
  const plainNode = firstFencedCodeNode(plainSource);
  const plainFence = markdown.codeFenceRanges(plainSource, plainNode);
  const plain = runtime.resolveCodeLanguage(plainNode.lang || '');

  assert.equal(plainSource.split('\n')[0], '```');
  assert.equal(plainNode.lang, null);
  assert.equal(plain.id, 'plaintext');
  assert.equal(plain.label, 'Plain Text');
  assert.equal(plain.known, true);
  assert.equal(plainSource.slice(plainFence.bodyStart, plainFence.bodyEnd), unknownBody);
  assert.equal(plainSource.slice(plainFence.closingStart), unknownSource.slice(unknownFence.closingStart));
});

test('code-body copy slices exact canonical bytes without fences or their structural newline', () => {
  const view = loadMarkdownPageViewApi();
  const fixtures = [
    {
      source: [
        '```javascript',
        '  const width = 760;',
        '',
        '  console.log("width:", width);',
        '```'
      ].join('\n'),
      expected: '  const width = 760;\n\n  console.log("width:", width);'
    },
    {
      source: '```python\r\n  value = "quoted"\r\n\r\n  print(value)\r\n```',
      expected: '  value = "quoted"\r\n\r\n  print(value)'
    },
    {
      source: '```\n```',
      expected: ''
    },
    {
      source: '~~~~javascript\nconst marker = "```";\n~~~~~',
      expected: 'const marker = "```";'
    },
    {
      source: '```\nunterminated body\n',
      expected: 'unterminated body\n'
    }
  ];

  for (const fixture of fixtures) {
    const node = firstFencedCodeNode(fixture.source);
    assert.ok(node, `expected a code node for ${JSON.stringify(fixture.source)}`);
    const fence = markdown.codeFenceRanges(fixture.source, node);
    assert.equal(
      view.canonicalCodeBodyText(fixture.source, fence),
      fixture.expected
    );
  }
});

test('code-body copy accepts live shifted source ranges after an earlier block edit', () => {
  const view = loadMarkdownPageViewApi();
  const original = '```javascript\nconst value = 1;\n```';
  const node = firstFencedCodeNode(original);
  const fence = markdown.codeFenceRanges(original, node);
  const prefix = '# Inserted earlier\n\n';
  const shifted = prefix + original;
  const liveRange = { ...fence };
  [
    'start', 'end', 'fenceStart', 'fenceEnd', 'infoStart', 'infoEnd',
    'bodyStart', 'bodyEnd', 'closingStart'
  ].forEach((key) => {
    if (Number.isFinite(liveRange[key])) liveRange[key] += prefix.length;
  });

  assert.equal(
    view.canonicalCodeBodyText(shifted, liveRange),
    'const value = 1;'
  );

  const expanded = shifted.replace(
    'const value = 1;',
    'const value = 1;\n\n  console.log("expanded");'
  );
  const growth = expanded.length - shifted.length;
  const expandedRange = { ...liveRange };
  ['end', 'bodyEnd', 'closingStart'].forEach((key) => {
    expandedRange[key] += growth;
  });
  assert.equal(
    view.canonicalCodeBodyText(expanded, expandedRange),
    'const value = 1;\n\n  console.log("expanded");'
  );
});

test('fresh Reading and Live code layers preserve language identity and one canonical transaction', () => {
  const source = [
    '~~~javascript',
    'const value = 1;',
    '~~~'
  ].join('\n');
  const view = loadFreshMarkdownController([
    'createLinkArrowController',
    'renderSemanticDocumentBlocks',
    'renderEditableDocumentBlocks',
    'replaceSemanticSourceRange'
  ]);

  const readingSnapshot = markdown.createSourceSnapshot(source);
  const readingRoot = new FakeElement();
  const readingState = {
    body: source,
    sourceSnapshot: readingSnapshot,
    sourceVersion: readingSnapshot.version,
    mode: 'reading',
    pageEditMode: false,
    bodyReadOnly: false,
    bodyRoot: readingRoot,
    page: { id: 'code-language-reading' },
    paneId: 'code-language-reading-pane'
  };
  view.renderSemanticDocumentBlocks(readingState, readingRoot);

  const highlightedCode = elementWithClass(readingRoot, 'language-javascript');
  const selector = elementWithClass(readingRoot, 'markdown-code-language-selector');
  const copy = elementWithClass(readingRoot, 'markdown-code-language-copy');
  assert.ok(highlightedCode, 'the fresh Reading render retains its language class');
  assert.equal(highlightedCode.tagName, 'CODE');
  assert.equal(highlightedCode.dataset.language, 'javascript');
  assert.ok(selector, 'the language selector is rendered');
  assert.ok(copy, 'the canonical code-body copy action is rendered separately');
  assert.notEqual(selector, copy);
  assert.equal(selector.closest('.markdown-code-language-control'), copy.parentElement);
  assert.equal(selector.attributes['aria-label'], 'Change code language');
  assert.equal(copy.attributes['aria-label'], 'Copy JavaScript code body');
  assert.equal(copy.textContent, 'JavaScript');
  assert.equal(selector.listeners.get('click')?.length, 1);
  assert.equal(copy.listeners.get('click')?.length, 1);
  assert.equal(readingState.body, source, 'rendering cannot rewrite canonical bytes');
  assert.equal(readingState.sourceSnapshot.markdownBody, source);

  const liveSnapshot = markdown.createSourceSnapshot(source);
  const liveRoot = new FakeElement();
  liveRoot.isConnected = true;
  const bodyInputs = [];
  const liveState = {
    body: source,
    sourceSnapshot: liveSnapshot,
    sourceVersion: liveSnapshot.version,
    mode: 'live-preview',
    pageEditMode: false,
    bodyReadOnly: false,
    bodyRoot: liveRoot,
    page: { id: 'code-language-live' },
    paneId: 'code-language-live-pane',
    editHistory: view.createMarkdownEditHistory(source),
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set(),
    editableForcedRawOwnerIds: new Set(),
    linkArrowController: view.createLinkArrowController(),
    linkArrowAnchorSink: null,
    linkArrowDescriptorAtRange: null,
    onBodyInput(payload) {
      bodyInputs.push(payload);
    }
  };
  const projection = view.renderEditableDocumentBlocks(liveState, liveRoot);
  const initialCode = liveState.editablePresentationPlan.constructs.codeBlocks[0];
  assert.ok(initialCode, 'the fresh Live projection contains the fenced code construct');
  assert.equal(initialCode.language, 'javascript');
  assert.equal(initialCode.infoSource, 'javascript');
  assert.equal(
    initialCode.bodySource,
    source.slice(initialCode.bodyStart, initialCode.bodyEnd),
    'the presentation plan retains the exact structural body range'
  );
  assert.equal(view.canonicalCodeBodyText(source, initialCode), 'const value = 1;');
  assert.equal(initialCode.raw, source);
  assert.deepEqual(
    projection.enumeratePhysicalRows().map((row) => row.text),
    source.split('\n'),
    'every physical row remains an exact canonical line'
  );
  projection.enumerateProjectedLeaves().forEach((leaf) => {
    assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
  });

  const livePresentation = elementWithClass(liveRoot, 'markdown-editable-code-block-presentation');
  const livePre = elementWithClass(liveRoot, 'markdown-page-code-block');
  const liveValue = elementWithClass(liveRoot, 'markdown-editable-code-block-value');
  const liveSelector = elementWithClass(liveRoot, 'markdown-code-language-selector');
  const liveCopy = elementWithClass(liveRoot, 'markdown-code-language-copy');
  assert.ok(livePresentation, 'Live mounts a semantic code presentation');
  assert.equal(livePresentation.tagName, 'DIV');
  assert.ok(livePresentation.classList.contains('markdown-page-code-shell'));
  assert.equal(livePre?.tagName, 'PRE');
  assert.equal(liveValue?.tagName, 'CODE');
  assert.equal(
    String(liveValue?.innerHTML || liveValue?.textContent || '').replace(/<[^>]+>/g, ''),
    'const value = 1;'
  );
  assert.ok(liveSelector, 'Live reuses the approved language selector');
  assert.ok(liveCopy, 'Live reuses the canonical code-body copy control');
  assert.equal(liveSelector.closest('.markdown-code-language-control'), liveCopy.parentElement);
  assert.equal(liveValue.dataset.markdownSourceStart, String(initialCode.bodyStart));
  assert.equal(liveValue.dataset.markdownSourceEnd, String(initialCode.bodyEnd));
  assert.equal(
    livePresentation.dataset.markdownEditablePresentationId,
    initialCode.presentationId
  );
  const activation = projection.enumerateRegisteredActivationAnchors().find((entry) => (
    entry.element === livePresentation
  ));
  assert.ok(activation, 'the rendered presentation owns an exact activation anchor');
  assert.equal(activation.semanticOwnerId, initialCode.ownerId);
  assert.equal(activation.planAnchorId, activation.anchorId);

  const afterSource = source.slice(0, initialCode.infoStart)
    + 'python'
    + source.slice(initialCode.infoEnd);
  assert.equal(view.replaceSemanticSourceRange(
    liveState,
    initialCode.infoStart,
    initialCode.infoEnd,
    'python',
    {
      beforeSelection: { anchor: initialCode.infoStart, focus: initialCode.infoEnd },
      afterSelection: {
        anchor: initialCode.infoStart,
        focus: initialCode.infoStart + 'python'.length
      },
      inputType: 'formatCodeLanguage',
      timestamp: 100,
      restoreSelection: false,
      transactionMetadata: { commandKind: 'code-language' }
    }
  ), true);

  const changedCode = liveState.editablePresentationPlan.constructs.codeBlocks[0];
  assert.equal(liveState.body, afterSource);
  assert.equal(liveState.sourceSnapshot.markdownBody, afterSource);
  assert.equal(changedCode.language, 'python');
  assert.equal(changedCode.infoSource, 'python');
  assert.equal(changedCode.bodySource, initialCode.bodySource);
  assert.equal(changedCode.raw, afterSource);
  assert.equal(liveState.editHistory.undoStack.length, 1);
  assert.deepEqual({ ...liveState.editHistory.undoStack[0].primaryEdit }, {
    start: initialCode.infoStart,
    end: initialCode.infoEnd,
    replacement: 'python'
  });
  assert.equal(liveState.editHistory.undoStack[0].commandKind, 'code-language');
  assert.equal(bodyInputs.length, 1);
  assert.equal(bodyInputs[0].markdownBody, afterSource);

  const undo = view.stepMarkdownEditHistory(liveState.editHistory, 'undo', afterSource);
  assert.equal(undo?.source, source);
  const redo = view.stepMarkdownEditHistory(liveState.editHistory, 'redo', source);
  assert.equal(redo?.source, afterSource);
});

test('desktop code-body copy bridge writes only the supplied canonical text', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop/main.js'), 'utf8');

  assert.match(preload, /writeClipboardText: \(text\) => ipcRenderer\.invoke\('cne-desktop:write-clipboard-text', text\)/);
  assert.match(main, /WRITE_CLIPBOARD_TEXT: 'cne-desktop:write-clipboard-text'/);
  assert.match(main, /ipcMain\.handle\(IPC\.WRITE_CLIPBOARD_TEXT,[^]*?clipboard\.writeText\(typeof text === 'string' \? text : String\(text \|\| ''\)\)/);
});
