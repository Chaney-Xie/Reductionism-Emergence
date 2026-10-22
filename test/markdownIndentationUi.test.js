const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const viewSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
  'utf8'
);
const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

function functionSource(name) {
  const start = viewSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = viewSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < viewSource.length; index += 1) {
    if (viewSource[index] === '{') depth += 1;
    else if (viewSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return viewSource.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to isolate ${name}`);
}

function markdownBodyKeydownSource() {
  const renderStart = viewSource.indexOf('  function renderSemanticDocument(state, bodyRoot)');
  assert.notEqual(renderStart, -1);
  const listenerStart = viewSource.indexOf(
    "    bodyRoot.addEventListener('keydown', (event) => {",
    renderStart
  );
  const listenerEnd = viewSource.indexOf(
    "    bodyRoot.addEventListener('focusout'",
    listenerStart
  );
  assert.notEqual(listenerStart, -1);
  assert.notEqual(listenerEnd, -1);
  return viewSource.slice(listenerStart, listenerEnd);
}

function canonicalSource(view, rendered) {
  return rendered.blocks
    .map((block) => view.semanticSourceFromNode(block.element))
    .join('');
}

test('Tab ownership is local to the editable Markdown body and prevents native focus movement', () => {
  const listener = markdownBodyKeydownSource();
  const editableGuard = listener.indexOf('if (!semanticModeEditable(state)) return;');
  const tabBranch = listener.indexOf("if (event.key === 'Tab'");
  const preventDefault = listener.indexOf('event.preventDefault();', tabBranch);
  const applyShortcut = listener.indexOf('applyMarkdownIndentationShortcut(', tabBranch);

  assert.ok(editableGuard >= 0 && editableGuard < tabBranch,
    'Reading Mode exits before the Tab command and keeps native focus navigation');
  assert.match(listener, /document\.activeElement === bodyRoot/);
  assert.match(listener, /stateOwnsActivePane\(state\)/);
  assert.match(listener, /!event\.metaKey && !event\.ctrlKey && !event\.altKey/);
  assert.ok(tabBranch < preventDefault && preventDefault < applyShortcut,
    'Tab is consumed before the indentation result is known, including a no-op outdent');
  assert.match(listener, /event\.shiftKey \? 'outdent' : 'indent'/);

  const documentHandler = functionSource('handleMarkdownKeyboardCommand');
  assert.doesNotMatch(documentHandler, /key\s*===\s*['"]Tab['"]/,
    'Tab is not captured globally from titles, search fields, Info editors, or modal controls');
});

test('the view routes indentation through one canonical format transaction', () => {
  const shortcut = functionSource('applyMarkdownIndentationShortcut');
  assert.match(shortcut, /semanticModeEditable\(state\)/);
  assert.match(shortcut, /captureSemanticSelection\(state\.bodyRoot\)/);
  assert.equal((shortcut.match(/model\.applyMarkdownIndentation\(/g) || []).length, 1);
  assert.equal((shortcut.match(/replaceSemanticSourceRange\(/g) || []).length, 1);
  assert.match(shortcut, /afterSelection:\s*result\.selection/);
  assert.match(shortcut, /beforeSelection/);
  assert.match(
    shortcut,
    /inputType:\s*direction === 'outdent' \? 'formatOutdent' : 'formatIndent'/
  );
  assert.doesNotMatch(shortcut, /state\.body\s*=/,
    'the shortcut does not create a parallel mutable body path');

  const history = loadMarkdownPageViewInternals([]).createMarkdownEditHistory('- Parent\n- Child');
  const before = '- Parent\n- Child';
  const result = markdown.applyMarkdownIndentation(
    before,
    { anchor: before.indexOf('Child'), focus: before.indexOf('Child') },
    'indent'
  );
  const view = loadMarkdownPageViewInternals([]);
  view.recordMarkdownEditTransaction(history, {
    beforeSource: before,
    afterSource: result.source,
    beforeSelection: { anchor: before.indexOf('Child'), focus: before.indexOf('Child') },
    afterSelection: result.selection,
    inputType: 'formatIndent',
    timestamp: 1
  });
  assert.equal(history.undoStack.length, 1);
  const undone = view.stepMarkdownEditHistory(history, 'undo', result.source);
  assert.equal(undone.source, before);
  assert.deepEqual({ ...undone.selection }, {
    anchor: before.indexOf('Child'),
    focus: before.indexOf('Child')
  });
  const redone = view.stepMarkdownEditHistory(history, 'redo', before);
  assert.equal(redone.source, result.source);
  assert.deepEqual({ ...redone.selection }, { ...result.selection });
});

test('exact and native insertText paths share ordered-marker source authority', () => {
  assert.match(
    viewSource,
    /function replaceSemanticSourceRange\([^]*?inputType === 'insertText'[^]*?normalizeSemanticOrderedMarkerInput\(/
  );
  assert.match(
    viewSource,
    /function syncSemanticDocumentInput\([^]*?normalizeSemanticOrderedMarkerInput\(/
  );

  const view = loadMarkdownPageViewInternals([
    'replaceSemanticSourceRange',
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    'semanticSourceFromNode'
  ]);
  const source = '1. A\n2. B\n   1. C\n   2. D\n3. E';
  for (const mode of ['source', 'live-preview']) {
    const rendered = renderSemanticSegments(view, source, { mode });
    const bodyRoot = new FakeElement();
    bodyRoot.isConnected = true;
    rendered.blocks.forEach((block) => bodyRoot.append(block.element));
    Object.assign(rendered.state, {
      bodyRoot,
      page: { id: `ordered-${mode}` },
      paneId: 'pane-ordered',
      semanticDirty: false
    });

    assert.equal(view.replaceSemanticSourceRange(
      rendered.state,
      16,
      16,
      '>',
      {
        afterSelection: { anchor: 17, focus: 17 },
        beforeSelection: { anchor: 16, focus: 16 },
        inputType: 'insertText',
        recordHistory: false,
        restoreSelection: false
      }
    ), true);
    assert.equal(
      rendered.state.body,
      '1. A\n2. B\n   3. >C\n   4. D\n5. E',
      `${mode}: canonical source follows O1 physical marker ownership`
    );
    assert.equal(view.semanticSourceFromNode(bodyRoot), rendered.state.body);
  }
});

test('an immediate Shift+Tab reverses an ambiguous source-normalizing Tab exactly', () => {
  const view = loadMarkdownPageViewInternals([
    'immediateMarkdownIndentationInverse'
  ]);
  for (const before of ['1. A\n3. B', '1. A\n1. B']) {
    const beforeSelection = { anchor: before.indexOf('B'), focus: before.indexOf('B') };
    const indented = markdown.applyMarkdownIndentation(before, beforeSelection, 'indent');
    const history = view.createMarkdownEditHistory(before);
    view.recordMarkdownEditTransaction(history, {
      beforeSource: before,
      afterSource: indented.source,
      beforeSelection,
      afterSelection: indented.selection,
      inputType: 'formatIndent',
      timestamp: 1
    });
    const inverse = view.immediateMarkdownIndentationInverse({
      body: indented.source,
      editHistory: history
    }, indented.selection, 'outdent');

    assert.equal(inverse.source, before);
    assert.deepEqual({ ...inverse.selection }, beforeSelection);
  }
});

test('Shift+Tab does not invert a Tab history group that later acquired Enter rows', () => {
  const view = loadMarkdownPageViewInternals([
    'immediateMarkdownIndentationInverse'
  ]);
  const fixtures = [
    {
      id: '8c8f0f95409b9058eb39',
      before: 'Plain  paragraph alpha.\n\nPlain paragraph beta.',
      beforeCaret: 7,
      indented: '    Plain  paragraph alpha.\n\nPlain paragraph beta.',
      indentedCaret: 11,
      current: '    Plain  \n    paragraph alpha.\n\nPlain paragraph beta.',
      currentCaret: 16,
      enterType: 'insertParagraph',
      expected: '    Plain  \nparagraph alpha.\n\nPlain paragraph beta.',
      expectedCaret: 12
    },
    {
      id: '4862111c0826e1a0f802',
      before: '    *  Star\n\n+ Plus',
      beforeCaret: 10,
      indented: '        *  Star\n\n+ Plus',
      indentedCaret: 14,
      current: '        *  Sta\n          r\n\n+ Plus',
      currentCaret: 25,
      enterType: 'insertLineBreak',
      expected: '        *  Sta\n      r\n\n+ Plus',
      expectedCaret: 21
    },
    {
      id: 'd16b3c0cb5aa8bddbf47',
      before: 'Escaped symbols: \\*\n \n \n not italic\\*, \\# not a heading.',
      beforeCaret: 25,
      indented: 'Escaped symbols: \\*\n \n \n     not italic\\*, \\# not a heading.',
      indentedCaret: 29,
      current: 'Escaped symbols: \\*\n \n \n     \n     not italic\\*, \\# not a heading.',
      currentCaret: 35,
      enterType: 'insertParagraph',
      expected: 'Escaped symbols: \\*\n \n \n     \n not italic\\*, \\# not a heading.',
      expectedCaret: 31
    },
    {
      id: '3c0e520ce213a67fa278',
      before: '[1  full][example] and [collapsed][].\n\n[example]: https://example.com\n[collapsed]: https://collapsed.example',
      beforeCaret: 3,
      indented: '    [1  full][example] and [collapsed][].\n\n[example]: https://example.com\n[collapsed]: https://collapsed.example',
      indentedCaret: 7,
      current: '    [1 \n     full][example] and [collapsed][].\n\n[example]: https://example.com\n[collapsed]: https://collapsed.example',
      currentCaret: 12,
      enterType: 'insertParagraph',
      expected: '    [1 \n full][example] and [collapsed][].\n\n[example]: https://example.com\n[collapsed]: https://collapsed.example',
      expectedCaret: 9
    }
  ];

  for (const fixture of fixtures) {
    const history = view.createMarkdownEditHistory(fixture.before);
    view.recordMarkdownEditTransaction(history, {
      beforeSource: fixture.before,
      afterSource: fixture.indented,
      beforeSelection: {
        anchor: fixture.beforeCaret,
        focus: fixture.beforeCaret
      },
      afterSelection: {
        anchor: fixture.indentedCaret,
        focus: fixture.indentedCaret
      },
      inputType: 'formatIndent',
      timestamp: 0
    });
    // Recreate the packaged trace shape directly. History policy may later
    // choose to split a particular deep newline, but persisted/older groups
    // labelled by their first formatIndent event must remain safe to invert.
    const composite = history.undoStack[0];
    composite.afterSource = fixture.current;
    composite.afterSelection = {
      anchor: fixture.currentCaret,
      focus: fixture.currentCaret
    };
    history.currentSource = fixture.current;
    history.lastSelection = composite.afterSelection;
    assert.equal(composite.inputType, 'formatIndent');
    assert.equal(view.immediateMarkdownIndentationInverse({
      body: fixture.current,
      editHistory: history
    }, {
      anchor: fixture.currentCaret,
      focus: fixture.currentCaret
    }, 'outdent'), null, `${fixture.id}: coalesced prefix is not a pure Tab inverse`);

    const outdented = markdown.applyMarkdownIndentation(
      fixture.current,
      { anchor: fixture.currentCaret, focus: fixture.currentCaret },
      'outdent'
    );
    assert.equal(outdented.source, fixture.expected, `${fixture.id}: source`);
    assert.deepEqual(
      { ...outdented.selection },
      { anchor: fixture.expectedCaret, focus: fixture.expectedCaret },
      `${fixture.id}: selection`
    );
  }
});

test('no-op outdent leaves canonical source unchanged while the body contract still owns Tab', () => {
  const source = 'plain paragraph';
  const result = markdown.applyMarkdownIndentation(
    source,
    { anchor: 4, focus: 4 },
    'outdent'
  );
  assert.equal(result.changed, false);
  assert.equal(result.source, source);
  assert.deepEqual(result.selection, { anchor: 4, focus: 4 });

  const listener = markdownBodyKeydownSource();
  const tabBranch = listener.indexOf("if (event.key === 'Tab'");
  const preventDefault = listener.indexOf('event.preventDefault();', tabBranch);
  const shortcut = listener.indexOf('applyMarkdownIndentationShortcut(', tabBranch);
  assert.ok(tabBranch < preventDefault && preventDefault < shortcut);
});

test('indented list, quote, and fenced-code source round-trip through Source and Live DOM', () => {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    'semanticSourceFromNode'
  ]);
  const fixtures = [
    {
      source: '- Parent\n- Child\n    - Existing grandchild',
      selection: (source) => ({
        anchor: source.indexOf('Child'),
        focus: source.indexOf('Child')
      }),
      verify(nodes) {
        assert.equal(nodes.filter((node) => (
          node?.classList?.contains('markdown-page-list-item')
        )).length, 3);
      }
    },
    {
      source: '> First\n> Second',
      selection: (source) => ({
        anchor: source.indexOf('Second'),
        focus: source.indexOf('Second')
      }),
      verify(nodes) {
        assert.equal(nodes.filter((node) => (
          node?.classList?.contains('markdown-page-quote')
        )).length, 1);
      }
    },
    {
      source: '```javascript\nline1\nline2\n```',
      selection: (source) => ({
        anchor: source.indexOf('line1'),
        focus: source.indexOf('line2') + 'line2'.length
      }),
      verify(nodes) {
        assert.equal(nodes.some((node) => (
          node?.classList?.contains('markdown-page-code-shell')
        )), true);
      }
    }
  ];

  for (const fixture of fixtures) {
    const result = markdown.applyMarkdownIndentation(
      fixture.source,
      fixture.selection(fixture.source),
      'indent'
    );
    assert.equal(result.changed, true);
    for (const mode of ['source', 'live-preview']) {
      const rendered = renderSemanticSegments(view, result.source, { mode });
      const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
      assert.equal(canonicalSource(view, rendered), result.source, `${mode}: canonical round-trip`);
      fixture.verify(nodes);
    }
  }
});

test('parser-normalized continuation indentation keeps physical editable source rows', () => {
  const source = '你好你好\n你坏你坏\n我？\n草\n\t修好了吗？';
  const tree = markdown.parseMarkdownDocument(source);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].type, 'paragraph');
  assert.deepEqual(tree.children[0].position, {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 5, column: 7, offset: source.length }
  });
  assert.equal(tree.children[0].children[0].value, source.replace('\n\t', '\n'));

  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    'semanticSourceFromNode'
  ]);
  for (const mode of ['source', 'live-preview']) {
    for (let pass = 0; pass < 2; pass += 1) {
      const rendered = renderSemanticSegments(view, source, { mode });
      const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
      const physical = nodes.filter((node) => (
        node?.classList?.contains('markdown-physical-source-lines')
      ));
      const breaks = nodes.filter((node) => (
        node?.classList?.contains('markdown-source-line-break')
      ));
      const mapped = nodes.filter((node) => (
        node?.classList?.contains('markdown-source-mapped-text')
      ));
      const indentation = nodes.filter((node) => (
        node?.classList?.contains('markdown-physical-line-indentation')
      ));
      const paragraphMarkers = nodes.filter((node) => (
        node?.classList?.contains('markdown-source-marker')
        && String(node.textContent || '').includes('\n')
      ));

      assert.equal(physical.length, 1, `${mode} pass ${pass}: one source owner`);
      assert.deepEqual(
        breaks.map((node) => [
          Number(node.dataset.markdownSourceStart),
          Number(node.dataset.markdownSourceEnd)
        ]),
        [[4, 5], [9, 10], [12, 13], [14, 15]],
        `${mode} pass ${pass}: physical newline ownership`
      );
      assert.equal(paragraphMarkers.length, 0, `${mode} pass ${pass}: no coarse marker`);
      assert.deepEqual(
        indentation.map((node) => ({
          start: Number(node.dataset.markdownSourceStart),
          end: Number(node.dataset.markdownSourceEnd),
          source: node.textContent
        })),
        [{ start: 15, end: 16, source: '\t' }],
        `${mode} pass ${pass}: one line-local indentation owner`
      );
      assert.equal(
        mapped.some((node) => (
          node.dataset.markdownSourceStart === '16'
          && node.dataset.markdownSourceEnd === '21'
          && node.textContent === '修好了吗？'
        )),
        true,
        `${mode} pass ${pass}: indented line content owner`
      );
      assert.equal(canonicalSource(view, rendered), source, `${mode} pass ${pass}: source`);
    }
  }

  assert.match(
    styles,
    /\.markdown-physical-source-lines\s*\{[^}]*white-space:\s*normal;/,
    'Reading keeps one semantic paragraph while sharing the same canonical source owner'
  );
  assert.match(
    styles,
    /\.markdown-physical-line-indentation\s*\{[^}]*white-space:\s*normal;[^}]*tab-size:\s*4;/,
    'Reading collapses source indentation while retaining its exact canonical owner'
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-source \.markdown-physical-line-indentation,[^}]*\.markdown-page-layer\.is-live-preview \.markdown-physical-line-indentation\s*\{[^}]*white-space:\s*pre;/,
    'both editable modes give only the physical-line indentation its source geometry'
  );
});
