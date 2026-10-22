const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
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

function taskItemFor(source) {
  const tree = markdown.parseMarkdownDocument(source);
  const list = tree.children[0];
  return list?.type === 'list' ? list.children?.[0] : null;
}

function firstTaskItem(source) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'listItem' && typeof node.checked === 'boolean') return node;
    for (const child of node.children || []) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };
  return visit(markdown.parseMarkdownDocument(source));
}

function renderSource(source, mode = 'reading') {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents'
  ]);
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const rendered = renderSemanticSegments(view, source, {
    mode,
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version
  });
  const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
  return { view, rendered, nodes, sourceSnapshot };
}

function functionSource(name) {
  const start = viewSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = viewSource.indexOf('{', viewSource.indexOf(') {', start));
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

function elements(nodes, predicate) {
  return nodes.filter((node) => node?.nodeType === 1 && predicate(node));
}

test('GFM task syntax requires both list and checkbox spacing', () => {
  const valid = [
    { source: '- [ ] item', checked: false },
    { source: '- [x] item', checked: true },
    { source: '- [X] item', checked: true }
  ];
  valid.forEach(({ source, checked }) => {
    const item = taskItemFor(source);
    assert.ok(item, `${JSON.stringify(source)} is a list item`);
    assert.equal(item.checked, checked, `${JSON.stringify(source)} is a valid task item`);
    assert.equal(source.slice(item.position.start.offset, item.position.end.offset), source);
  });

  const malformed = ['-[]123', '-[ ]123', '- [] 123', '- [ ]123', '- [y] 123'];
  malformed.forEach((source) => {
    const item = taskItemFor(source);
    assert.notEqual(typeof item?.checked, 'boolean', `${JSON.stringify(source)} is not a task`);
    assert.doesNotMatch(markdown.renderMarkdown(source), /type="checkbox"/);
    assert.equal(
      markdown.sourceBlocks(source).map((block) => block.raw).join(''),
      source,
      `${JSON.stringify(source)} remains exact canonical Markdown`
    );
  });

  for (const source of ['-[]123', '-[ ]123']) {
    const tree = markdown.parseMarkdownDocument(source);
    assert.deepEqual(tree.children.map((node) => node.type), ['paragraph']);
    assert.equal(markdown.renderMarkdown(source), `<p>${source}</p>`);
  }
});

test('valid task DOM owns one canonical marker and one visual checkbox', () => {
  for (const source of ['- [ ] 123', '- [x] 123', '- [X] 123']) {
    const { rendered, nodes, sourceSnapshot } = renderSource(source);
    const inputs = elements(nodes, (node) => node.tagName === 'INPUT' && node.type === 'checkbox');
    const markers = elements(nodes, (node) => node.classList.contains('markdown-source-marker'));
    const prefix = source.slice(0, 6);
    const taskMarker = markers.filter((marker) => marker.textContent === prefix);

    assert.equal(inputs.length, 1, `${source}: exactly one visual checkbox exists`);
    assert.equal(taskMarker.length, 1, `${source}: complete task source prefix has one owner`);
    assert.equal(taskMarker[0].dataset.markdownSourceStart, '0');
    assert.equal(taskMarker[0].dataset.markdownSourceEnd, '6');
    assert.equal(
      sourceSnapshot.markdownBody.slice(
        Number(taskMarker[0].dataset.markdownSourceStart),
        Number(taskMarker[0].dataset.markdownSourceEnd)
      ),
      prefix,
      `${source}: the Reading marker is an exact canonical SourceSnapshot slice`
    );
    assert.equal(
      rendered.state.body,
      source,
      `${source}: the Reading projection never replaces canonical state authority`
    );
  }
});

test('malformed task-like text never creates a detached checkbox DOM node', () => {
  for (const source of ['-[]123', '-[ ]123', '- [] 123', '- [ ]123']) {
    const { rendered, nodes, sourceSnapshot } = renderSource(source);
    assert.equal(
      elements(nodes, (node) => node.tagName === 'INPUT' && node.type === 'checkbox').length,
      0,
      `${source}: no checkbox is synthesized`
    );
    assert.equal(
      rendered.state.body,
      source,
      `${source}: canonical state remains exact`
    );
    assert.equal(sourceSnapshot.markdownBody, source);
    assert.deepEqual(
      sourceSnapshot.physicalLineIndex.lines.map((line) => line.text),
      [source],
      `${source}: malformed text remains one exact physical source row`
    );
  }
});

test('task items reuse the existing Filter checkbox component instead of a private skin', () => {
  const { nodes } = renderSource('- [ ] 123', 'reading');
  const filterComponents = elements(nodes, (node) => node.classList.contains('filter-checkbox'));
  const inputs = elements(nodes, (node) => node.tagName === 'INPUT' && node.type === 'checkbox');
  const privateCheckboxes = elements(
    nodes,
    (node) => node.classList.contains('markdown-page-task-checkbox')
  );

  assert.equal(filterComponents.length, 1, 'the task row mounts the shared Filter checkbox component');
  assert.equal(filterComponents[0].tagName, 'LABEL', 'the shared component keeps Filter semantics');
  assert.equal(inputs.length, 1);
  assert.ok(filterComponents[0].contains(inputs[0]), 'the Filter component owns the task input');
  assert.equal(privateCheckboxes.length, 0, 'no task-specific checkbox skin is mounted');
  assert.doesNotMatch(styles, /\.markdown-page-task-checkbox\b/);
  assert.match(viewSource, /filter-checkbox/);
});

test('rendered task checkbox is enabled and has one canonical interaction owner', () => {
  const { nodes } = renderSource('- [ ] 123', 'reading');
  const inputs = elements(nodes, (node) => node.tagName === 'INPUT' && node.type === 'checkbox');
  const taskRow = elements(nodes, (node) => node.classList.contains('task-list-item'))[0];
  const filterComponent = elements(nodes, (node) => node.classList.contains('filter-checkbox'))[0];
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].disabled, false, 'Reading task checkbox remains interactive');
  assert.notEqual(inputs[0].tabIndex, -1, 'the rendered control is not removed from interaction');
  const owners = [inputs[0], filterComponent, taskRow].filter(Boolean);
  assert.equal(
    owners.flatMap((owner) => [...owner.listeners.values()].flat()).length,
    1,
    'exactly one handler in the shared checkbox row owns the canonical toggle'
  );
  assert.doesNotMatch(styles, /\.filter-checkbox\s+input\s*\{[^}]*pointer-events\s*:\s*none/s);
});

test('Reading and inactive Live use semantic task controls while Source keeps raw projection text', () => {
  assert.ok(
    /\.task-list-item\b[^\{]*\{[^}]*list-style(?:-type)?\s*:\s*none/s.test(styles),
    'task rows never retain the unordered-list bullet'
  );
  assert.ok(
    /\.task-list-item\b[^\{]*\{[^}]*display\s*:\s*(?:inline-)?(?:flex|grid)/s.test(styles),
    'checkbox/source prefix and task text remain one row in every mode'
  );
  assert.ok(
    /\.filter-checkbox\b[^\{]*\{[^}]*display\s*:\s*(?:inline-)?flex/s.test(styles),
    'Reading tasks reuse the shared Filter checkbox row layout'
  );
  assert.match(
    styles,
    /\.markdown-page-body\[data-markdown-editable-projection="true"\]/,
    'Source and Live use the physical editable projection surface'
  );
  const documentRenderer = functionSource('renderSemanticDocument');
  assert.match(
    documentRenderer,
    /state\.mode === 'reading'[^]*?renderSemanticDocumentBlocks\(state, bodyRoot\)[^]*?else renderEditableDocumentBlocks\(state, bodyRoot\)/,
    'Reading keeps its semantic list renderer while editable modes keep the physical projection'
  );
  const editableRenderer = functionSource('renderEditableDocumentBlocks');
  assert.match(editableRenderer, /createEditableProjection/);
  assert.doesNotMatch(editableRenderer, /\b(?:createElement\(['"](?:ol|ul|li)['"]|OL|UL|LI)\b/,
    'editable modes never synthesize native list DOM');
  const editableMount = functionSource('mountEditableListPresentations');
  assert.match(editableMount, /filterCheckboxControl\?\.create/,
    'inactive Live reuses the shared Filter checkbox control');
  assert.match(editableMount, /markdownSemanticControl = 'true'/);
  assert.match(editableMount, /replaceSemanticSourceRange/,
    'the Live checkbox targets an exact canonical source range');
  assert.doesNotMatch(editableMount, /state\.body\s*=\s*[^;]*(?:innerText|textContent)/,
    'the task control never serializes presentation DOM back into Markdown');
});

test('task source remains byte-stable across all view modes before an explicit toggle', () => {
  const source = '- [X] 123';
  const reading = renderSource(source, 'reading');
  assert.equal(reading.rendered.state.body, source);
  assert.equal(reading.sourceSnapshot.markdownBody, source);

  for (const mode of ['live-preview', 'source']) {
    const sourceSnapshot = markdown.createSourceSnapshot(source);
    const plan = buildEditablePresentationPlan(sourceSnapshot, {
      model: markdown,
      mode
    });
    const validation = validateEditablePresentationPlan(plan, sourceSnapshot);
    assert.equal(validation.ok, true, validation.errors.join('\n'));
    assert.equal(
      plan.lines.map((line) => line.leaves.map((leaf) => leaf.text).join('')
        + line.lineEnding).join(''),
      source,
      `${mode} projects exact uppercase checked source bytes from one SourceSnapshot`
    );
  }
});

test('one task toggle changes one canonical marker and is one exact Undo transaction', () => {
  const view = loadMarkdownPageViewInternals([
    'toggleMarkdownTaskItemSource',
    'createMarkdownEditHistory',
    'recordMarkdownEditTransaction',
    'stepMarkdownEditHistory'
  ]);
  const before = ['Before', '', '- [ ] item with **formatting**', '', 'After'].join('\n');
  const itemNode = firstTaskItem(before);
  const toggled = view.toggleMarkdownTaskItemSource(before, itemNode);
  const expected = ['Before', '', '- [x] item with **formatting**', '', 'After'].join('\n');

  assert.ok(toggled, 'a strict GFM task item has one canonical toggle operation');
  assert.equal(toggled.source, expected);
  assert.equal(toggled.checked, true);
  assert.equal(toggled.markerStart, before.indexOf('[ ]') + 1);
  assert.equal(toggled.markerEnd, before.indexOf('[ ]') + 2);
  assert.equal(before.slice(toggled.markerStart, toggled.markerEnd), ' ');
  assert.equal(toggled.source.slice(toggled.markerStart, toggled.markerEnd), 'x');
  assert.equal(
    toggled.source.slice(0, before.indexOf('[ ]')),
    before.slice(0, before.indexOf('[ ]')),
    'bytes before the task marker remain exact'
  );
  assert.equal(
    toggled.source.slice(before.indexOf('[ ]') + 3),
    before.slice(before.indexOf('[ ]') + 3),
    'bytes after the task marker remain exact'
  );

  const history = view.createMarkdownEditHistory(before);
  assert.equal(view.recordMarkdownEditTransaction(history, {
    beforeSource: before,
    afterSource: toggled.source,
    beforeSelection: { anchor: toggled.markerStart, focus: toggled.markerEnd },
    afterSelection: { anchor: toggled.markerStart, focus: toggled.markerEnd },
    inputType: 'formatTaskList',
    timestamp: 100
  }, { coalesce: false }), true);
  assert.equal(history.undoStack.length, 1, 'one click records one non-coalesced transaction');
  assert.equal(view.stepMarkdownEditHistory(history, 'undo', toggled.source).source, before);
  assert.equal(view.stepMarkdownEditHistory(history, 'redo', before).source, expected);

  for (const checkedSource of ['- [x] item', '- [X] item']) {
    const unchecked = view.toggleMarkdownTaskItemSource(checkedSource, firstTaskItem(checkedSource));
    assert.equal(unchecked.source, '- [ ] item');
    assert.equal(unchecked.checked, false);
  }
  const repeated = ['- [ ] first', '- [ ] second'].join('\n');
  const repeatedTree = markdown.parseMarkdownDocument(repeated);
  assert.equal(
    view.toggleMarkdownTaskItemSource(repeated, repeatedTree.children[0].children[1]).source,
    ['- [ ] first', '- [x] second'].join('\n'),
    'the selected item node, not matching text, owns the replacement range'
  );
  const nested = ['- parent', '  - [ ] nested'].join('\n');
  assert.equal(
    view.toggleMarkdownTaskItemSource(nested, firstTaskItem(nested)).source,
    ['- parent', '  - [x] nested'].join('\n'),
    'nested indentation remains byte-identical'
  );
  for (const malformed of ['-[]123', '-[ ]123', '- [] 123', '- [ ]123']) {
    const tree = markdown.parseMarkdownDocument(malformed);
    const candidate = tree.children?.[0]?.children?.[0] || tree.children?.[0];
    assert.equal(view.toggleMarkdownTaskItemSource(malformed, candidate), null);
  }
});
