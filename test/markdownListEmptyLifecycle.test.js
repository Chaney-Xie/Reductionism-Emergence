'use strict';

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

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

function collapsed(offset) {
  return { anchor: offset, focus: offset };
}

function plainSelection(selection) {
  return { anchor: selection.anchor, focus: selection.focus };
}

function directListItems(list) {
  return (list?.children || []).filter((child) => child.type === 'listItem');
}

function astListFacts(source) {
  const tree = markdown.parseMarkdownDocument(source);
  const rootList = (tree.children || []).find((child) => child.type === 'list');
  const rootItems = directListItems(rootList);
  const nestedLists = rootItems.flatMap((item, rootIndex) => (
    (item.children || [])
      .filter((child) => child.type === 'list')
      .map((list) => ({ list, rootIndex }))
  ));
  const itemText = (item) => {
    const values = [];
    const visit = (node) => {
      if (node?.type === 'text') values.push(String(node.value || ''));
      if (node?.type === 'list') return;
      (node?.children || []).forEach(visit);
    };
    visit(item);
    return values.join('');
  };
  return {
    rootCount: rootItems.length,
    nestedCount: nestedLists.reduce(
      (count, entry) => count + directListItems(entry.list).length,
      0
    ),
    nestedParentIndexes: nestedLists.map((entry) => entry.rootIndex),
    emptyRootIndexes: rootItems
      .map((item, index) => itemText(item) ? null : index)
      .filter((index) => index !== null)
  };
}

function renderedListFacts(source, mode = 'live-preview') {
  const view = loadMarkdownPageViewInternals([
    'canonicalRawListSourceMarker',
    'renderSemanticBlockContents',
    'semanticSourceFromNode',
    'semanticSyntaxSegments'
  ]);
  const rendered = renderSemanticSegments(view, source, { mode });
  const root = new FakeElement({ tagName: 'div' });
  root.append(...rendered.blocks.map((block) => block.element));
  const nodes = descendants(root).filter((node) => node?.nodeType === 1);
  const lists = nodes.filter((node) => node.classList.contains('markdown-page-list'));
  const rootList = lists.find((list) => !list.parentElement?.closest?.('.markdown-page-list'));
  const rootItems = (rootList?.children || []).filter((node) => (
    node.classList.contains('markdown-page-list-item')
  ));
  const nestedLists = lists.filter((list) => list !== rootList);
  const nestedItems = nestedLists.flatMap((list) => (
    (list.children || []).filter((node) => node.classList.contains('markdown-page-list-item'))
  ));
  const editableMarkers = nodes.filter((node) => (
    node.classList.contains('markdown-source-marker')
      && node.classList.contains('markdown-list-editing-prefix')
  ));
  const sourceMarkers = nodes.filter((node) => (
    node.classList.contains('markdown-source-marker')
  ));
  const semanticItems = [...rootItems, ...nestedItems];
  const markerOwnerCounts = semanticItems.map((item) => {
    const itemStart = Number(item.dataset.markdownSourceStart);
    return sourceMarkers.filter((marker) => (
      Number(marker.dataset.markdownSourceStart) === itemStart
    )).length;
  });
  return {
    view,
    root,
    nodes,
    rootItems,
    nestedItems,
    nestedLists,
    editableMarkers,
    sourceMarkers,
    markerOwnerCounts,
    source: view.semanticSourceFromNode(root)
  };
}

function assertTreeAndDom(source, expected, label) {
  assert.deepEqual(astListFacts(source), expected, `${label}: AST`);
  const rendered = renderedListFacts(source);
  assert.equal(rendered.source, source, `${label}: canonical DOM serialization`);
  assert.equal(rendered.rootItems.length, expected.rootCount, `${label}: root LI count`);
  assert.equal(rendered.nestedItems.length, expected.nestedCount, `${label}: nested LI count`);
  assert.deepEqual(
    rendered.markerOwnerCounts,
    Array(expected.rootCount + expected.nestedCount).fill(1),
    `${label}: one source presentation owner per semantic LI`
  );
  return rendered;
}

function runParentNestedEnterLifecycle({ initial, firstSource, secondSource, thirdSource }) {
  const initialCaret = initial.indexOf('\n    ');
  const first = markdown.applyMarkdownNewline(initial, collapsed(initialCaret));
  const second = markdown.applyMarkdownNewline(first.source, first.selection);
  const third = markdown.applyMarkdownNewline(second.source, second.selection);

  assert.equal(first.source, firstSource, 'first Enter creates one canonical empty root item');
  assert.equal(first.editKind, 'list-continuation');
  assert.equal(second.source, secondSource, 'second Enter exits that empty item to one blank row');
  assert.equal(second.editKind, 'list-exit');
  assert.equal(third.source, thirdSource, 'third Enter adds one ordinary blank row');
  assert.equal(third.editKind, 'physical-line-start');

  const emptyLineStart = secondSource.indexOf('\n\n') + 1;
  assert.deepEqual(plainSelection(second.selection), collapsed(emptyLineStart));
  assert.deepEqual(plainSelection(third.selection), collapsed(emptyLineStart + 1));

  return { first, second, third };
}

test('O1 ordered parent-end Enter lifecycle never stacks synthetic root items', () => {
  const initial = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n');
  const firstSource = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '4. ',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n');
  const secondSource = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n');
  const thirdSource = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '',
    '',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n');

  const lifecycle = runParentNestedEnterLifecycle({
    initial,
    firstSource,
    secondSource,
    thirdSource
  });

  assertTreeAndDom(initial, {
    rootCount: 3,
    nestedCount: 2,
    nestedParentIndexes: [2],
    emptyRootIndexes: []
  }, 'initial');
  assertTreeAndDom(lifecycle.first.source, {
    rootCount: 4,
    nestedCount: 2,
    nestedParentIndexes: [3],
    emptyRootIndexes: [3]
  }, 'first Enter');
  assertTreeAndDom(lifecycle.second.source, {
    rootCount: 3,
    nestedCount: 2,
    nestedParentIndexes: [2],
    emptyRootIndexes: []
  }, 'second Enter');
  assertTreeAndDom(lifecycle.third.source, {
    rootCount: 3,
    nestedCount: 2,
    nestedParentIndexes: [2],
    emptyRootIndexes: []
  }, 'third Enter');

});

test('O1 root marker exit joins separate nested ordered runs in one transaction', () => {
  const before = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '    1. Citrate',
    '4. ',
    '    1. Isocitrate'
  ].join('\n');
  const after = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '    1. Citrate',
    '',
    '    2. Isocitrate'
  ].join('\n');
  const beforeSelection = collapsed(before.indexOf('4. ') + '4. '.length);
  const result = markdown.applyMarkdownNewline(before, beforeSelection);

  assert.deepEqual(plainSelection(beforeSelection), collapsed(62));
  assert.equal(result.source, after);
  assert.deepEqual(plainSelection(result.selection), collapsed(59));
  assert.equal(result.editKind, 'list-exit');
  assertTreeAndDom(before, {
    rootCount: 4,
    nestedCount: 2,
    nestedParentIndexes: [2, 3],
    emptyRootIndexes: [3]
  }, 'separate nested runs before root exit');
  assertTreeAndDom(after, {
    rootCount: 3,
    nestedCount: 2,
    nestedParentIndexes: [2],
    emptyRootIndexes: []
  }, 'joined nested run after root exit');

  const view = loadMarkdownPageViewInternals([]);
  const history = view.createMarkdownEditHistory(before);
  assert.equal(view.recordMarkdownEditTransaction(history, {
    beforeSource: before,
    afterSource: after,
    beforeSelection,
    afterSelection: result.selection,
    inputType: 'insertParagraph',
    timestamp: 1
  }), true);
  assert.equal(history.undoStack.length, 1);

  const undo = view.stepMarkdownEditHistory(history, 'undo', after);
  assert.equal(undo.source, before);
  assert.deepEqual(plainSelection(undo.selection), collapsed(62));
  const redo = view.stepMarkdownEditHistory(history, 'redo', before);
  assert.equal(redo.source, after);
  assert.deepEqual(plainSelection(redo.selection), collapsed(59));
});

test('O1 root marker exit continues across an ordered delimiter boundary', () => {
  const before = [
    '1. A',
    '    1. X',
    '2. ',
    '    1) Y'
  ].join('\n');
  const after = [
    '1. A',
    '    1. X',
    '',
    '    2) Y'
  ].join('\n');
  const result = markdown.applyMarkdownNewline(
    before,
    collapsed(before.indexOf('2. ') + '2. '.length)
  );

  assert.equal(result.source, after);
  assert.deepEqual(plainSelection(result.selection), collapsed(14));
  assert.equal(result.editKind, 'list-exit');
  assertTreeAndDom(after, {
    rootCount: 1,
    nestedCount: 2,
    nestedParentIndexes: [0, 0],
    emptyRootIndexes: []
  }, 'ordered delimiter boundary after root exit');
});

test('O1 unordered root exit joins its separate ordered child runs', () => {
  const before = [
    '- A',
    '    1. X',
    '- ',
    '    1. Y'
  ].join('\n');
  const after = [
    '- A',
    '    1. X',
    '',
    '    2. Y'
  ].join('\n');
  const beforeSelection = collapsed(before.lastIndexOf('- ') + '- '.length);
  const result = markdown.applyMarkdownNewline(before, beforeSelection);

  assert.deepEqual(plainSelection(beforeSelection), collapsed(15));
  assert.equal(result.source, after);
  assert.deepEqual(plainSelection(result.selection), collapsed(13));
  assert.equal(result.editKind, 'list-exit');
  assertTreeAndDom(before, {
    rootCount: 2,
    nestedCount: 2,
    nestedParentIndexes: [0, 1],
    emptyRootIndexes: [1]
  }, 'unordered owner with separate ordered children before root exit');
  assertTreeAndDom(after, {
    rootCount: 1,
    nestedCount: 2,
    nestedParentIndexes: [0],
    emptyRootIndexes: []
  }, 'unordered owner with joined ordered children after root exit');
});

test('O1 root marker exit leaves a child at one without an ordered predecessor', () => {
  const before = [
    '1. A',
    '2. ',
    '    1. Y'
  ].join('\n');
  const after = [
    '1. A',
    '',
    '    1. Y'
  ].join('\n');
  const result = markdown.applyMarkdownNewline(
    before,
    collapsed(before.indexOf('2. ') + '2. '.length)
  );

  assert.equal(result.source, after);
  assert.deepEqual(plainSelection(result.selection), collapsed(5));
  assert.equal(result.editKind, 'list-exit');
  assertTreeAndDom(after, {
    rootCount: 1,
    nestedCount: 1,
    nestedParentIndexes: [0],
    emptyRootIndexes: []
  }, 'no ordered predecessor after root exit');
});

test('O1 root marker exit continues from an explicit physical child start', () => {
  const before = [
    '1. A',
    '    3. X',
    '2. ',
    '    1. Y'
  ].join('\n');
  const after = [
    '1. A',
    '    3. X',
    '',
    '    4. Y'
  ].join('\n');
  const result = markdown.applyMarkdownNewline(
    before,
    collapsed(before.indexOf('2. ') + '2. '.length)
  );

  assert.equal(result.source, after);
  assert.deepEqual(plainSelection(result.selection), collapsed(14));
  assert.equal(result.editKind, 'list-exit');
});

test('O1 unordered parent-end Enter lifecycle exits before a second empty item can exist', () => {
  const initial = [
    '- Glycolysis',
    '- Link reaction',
    '- TCA cycle',
    '    - Citrate',
    '    - Isocitrate'
  ].join('\n');
  const firstSource = [
    '- Glycolysis',
    '- Link reaction',
    '- TCA cycle',
    '- ',
    '    - Citrate',
    '    - Isocitrate'
  ].join('\n');
  const secondSource = [
    '- Glycolysis',
    '- Link reaction',
    '- TCA cycle',
    '',
    '    - Citrate',
    '    - Isocitrate'
  ].join('\n');
  const thirdSource = [
    '- Glycolysis',
    '- Link reaction',
    '- TCA cycle',
    '',
    '',
    '    - Citrate',
    '    - Isocitrate'
  ].join('\n');

  const lifecycle = runParentNestedEnterLifecycle({
    initial,
    firstSource,
    secondSource,
    thirdSource
  });
  assertTreeAndDom(lifecycle.first.source, {
    rootCount: 4,
    nestedCount: 2,
    nestedParentIndexes: [3],
    emptyRootIndexes: [3]
  }, 'unordered first Enter');
  assertTreeAndDom(lifecycle.second.source, {
    rootCount: 3,
    nestedCount: 2,
    nestedParentIndexes: [2],
    emptyRootIndexes: []
  }, 'unordered second Enter');
  assertTreeAndDom(lifecycle.third.source, {
    rootCount: 3,
    nestedCount: 2,
    nestedParentIndexes: [2],
    emptyRootIndexes: []
  }, 'unordered third Enter');
});

test('empty-parent list exit is one exact Undo and Redo transaction', () => {
  const initial = '1. Parent\n    1. Child';
  const first = markdown.applyMarkdownNewline(initial, collapsed('1. Parent'.length));
  const second = markdown.applyMarkdownNewline(first.source, first.selection);
  const view = loadMarkdownPageViewInternals([]);
  const history = view.createMarkdownEditHistory(first.source);

  assert.equal(view.recordMarkdownEditTransaction(history, {
    beforeSource: first.source,
    afterSource: second.source,
    beforeSelection: first.selection,
    afterSelection: second.selection,
    inputType: 'insertParagraph',
    timestamp: 1
  }), true);
  assert.equal(history.undoStack.length, 1);

  const undo = view.stepMarkdownEditHistory(history, 'undo', second.source);
  assert.equal(undo.source, first.source);
  assert.deepEqual(plainSelection(undo.selection), plainSelection(first.selection));
  const redo = view.stepMarkdownEditHistory(history, 'redo', first.source);
  assert.equal(redo.source, second.source);
  assert.deepEqual(plainSelection(redo.selection), plainSelection(second.selection));
});

test('Backspace-created bare root marker has one presentation owner and no editing-depth claim', () => {
  const source = '1. A\n2. \n    1. Child';
  const caret = source.indexOf('\n    ');
  const result = markdown.applyMarkdownStructuralDeletion(
    source,
    collapsed(caret),
    'backward'
  );
  assert.equal(result.source, '1. A\n2.\n    1. Child');
  assert.equal(result.editKind, 'list-separator');
  assert.deepEqual(plainSelection(result.selection), collapsed(7));

  const rendered = renderedListFacts(result.source);
  const markerStart = result.source.indexOf('2.');
  const owners = rendered.nodes.filter((node) => (
    node.classList.contains('markdown-source-marker')
      && Number(node.dataset.markdownSourceStart) === markerStart
  ));
  assert.equal(owners.length, 1, 'the canonical bare marker has one source presentation owner');
  const [owner] = owners;
  assert.equal(owner.textContent.startsWith('2.'), true);
  assert.equal(
    result.source.slice(markerStart, markerStart + 2),
    '2.',
    'the presentation owner starts on the complete bare marker range'
  );
  assert.equal(owner.classList.contains('markdown-list-editing-prefix'), false);
  assert.equal(owner.classList.contains('markdown-list-editing-token'), false);
  assert.equal(owner.dataset.markdownListDepth, undefined);

  const childStart = result.source.indexOf('1. Child');
  const childOwners = rendered.nodes.filter((node) => (
    node.classList.contains('markdown-source-marker')
      && Number(node.dataset.markdownSourceStart) === childStart
  ));
  assert.equal(childOwners.length, 1, 'the preserved child prefix has one source presentation owner');
  assert.equal(childOwners[0].classList.contains('markdown-list-editing-prefix'), false);
  assert.equal(childOwners[0].classList.contains('markdown-list-editing-token'), false);
  assert.equal(childOwners[0].dataset.markdownListDepth, undefined);
  assert.equal(rendered.source, result.source);
});

test('three Backspaces remove an ordered empty-parent marker without joining its children', () => {
  const initial = '1. A\n2. \n    1. C\n    2. D';
  const expected = [
    { source: '1. A\n2.\n    1. C\n    2. D', caret: 7, editKind: 'list-separator' },
    { source: '1. A\n2\n    1. C\n    2. D', caret: 6, editKind: 'physical-marker-character' },
    { source: '1. A\n\n    1. C\n    2. D', caret: 5, editKind: 'physical-marker-character' }
  ];
  let source = initial;
  let selection = collapsed(8);

  expected.forEach((step, index) => {
    const result = markdown.applyMarkdownStructuralDeletion(source, selection, 'backward');
    assert.equal(result.source, step.source, `Backspace ${index + 1}: source`);
    assert.deepEqual(
      plainSelection(result.selection),
      collapsed(step.caret),
      `Backspace ${index + 1}: caret`
    );
    assert.equal(result.editKind, step.editKind, `Backspace ${index + 1}: transaction kind`);
    source = result.source;
    selection = result.selection;
  });

  assertTreeAndDom(source, {
    rootCount: 1,
    nestedCount: 2,
    nestedParentIndexes: [0],
    emptyRootIndexes: []
  }, 'three-Backspace minimized lifecycle result');
});

test('a legitimate canonical empty list item owns one full physical row', () => {
  const source = '1. A\n2. ';
  const rendered = renderedListFacts(source);
  const emptyItem = rendered.rootItems[1];
  assert.ok(emptyItem, 'the canonical second marker owns one semantic LI');
  assert.equal(
    emptyItem.children.some((child) => child.classList.contains('markdown-page-list-prefix')),
    true,
    'the empty item keeps the same source-prefix column as a nonempty item'
  );
  assert.equal(
    emptyItem.children.some((child) => child.classList.contains('markdown-page-list-item-body')),
    true,
    'the empty item owns a body row instead of using its LI as a caret placeholder'
  );
  assert.equal(rendered.source, source);

  const physicalRowRules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => (
    match[1].includes('.markdown-page-list-item')
      && /min-height:\s*1lh\s*;/.test(match[2])
      && !/position:\s*absolute\s*;/.test(match[2])
  ));
  assert.ok(
    physicalRowRules.length > 0,
    'an AST-owned empty LI/body must reserve one in-flow line instead of collapsing marker y-coordinates'
  );
});
