'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

function assertExact(result, source, caret, id) {
  assert.equal(result.source, source, `${id}: source`);
  assert.deepEqual(
    { ...result.selection },
    { anchor: caret, focus: caret },
    `${id}: selection`
  );
}

function semanticRoot(rendered) {
  const root = new FakeElement({ tagName: 'div' });
  root.isConnected = true;
  root.focus = () => {};
  root.append(...rendered.blocks.map((block) => block.element));
  return root;
}

test('Round-3 random .040 Shift-Tab keeps consecutive nested marker-only rows recognized', () => {
  const before = '- Alpha\n  continued alpha\n  1.  \n  2. \n  3. eta\n- Gamma';
  const expected = '- Alpha\n  continued alpha\n  1.  \n  2. \n3. eta\n- Gamma';
  assertExact(
    markdown.applyMarkdownIndentation(
      before,
      { anchor: 44, focus: 44 },
      'outdent'
    ),
    expected,
    42,
    'list-random-500.040.action-6'
  );

  const view = loadMarkdownPageViewInternals([
    'renderSemanticBlockContents',
    'semanticSourceFromNode',
    'semanticSyntaxSegments'
  ]);
  for (const source of [
    expected,
    '- Alpha\n  continued alpha\n  1.  \n  2. \n3. \n4. eta\n- Gamma'
  ]) {
    const rendered = renderSemanticSegments(view, source, { mode: 'source' });
    const root = semanticRoot(rendered);
    // This is the production projection boundary consumed by viewerV1.mjs:
    // it enumerates `.markdown-source-marker` and then requires the editing
    // prefix flag, exact source range, and physical depth.
    const projectedMarker = descendants(root).find((node) => (
      node?.classList?.contains('markdown-source-marker')
        && node.classList.contains('markdown-list-editing-prefix')
        && node.dataset.markdownSourceStart === '35'
        && node.dataset.markdownSourceEnd === '37'
    ));
    assert.ok(projectedMarker, 'the second marker-only row projects as a source-owned marker');
    assert.equal(projectedMarker.textContent, '2.');
    assert.equal(projectedMarker.dataset.markdownListDepth, '2');
    assert.equal(view.semanticSourceFromNode(root), source);
  }
});

test('Round-3 random .325 Enter preserves the O1 caret across the inline-star rerender', () => {
  const before = '- Alpha\n  continued alpha\n- *Beta\n- Gamma';
  const expected = '- Alpha\n  continued alpha\n- *B\n- eta\n- Gamma';
  assertExact(
    markdown.applyMarkdownNewline(before, { anchor: 30, focus: 30 }),
    expected,
    33,
    'list-random-500.325.action-4'
  );

  const browserSelection = {
    rangeCount: 1,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset });
    }
  };
  const view = loadMarkdownPageViewInternals([
    'captureSemanticSelection',
    'renderSemanticBlockContents',
    'restoreSemanticSelection',
    'semanticSyntaxSegments'
  ], {
    window: { getSelection: () => browserSelection },
    document: {
      createTreeWalker(element) {
        const textNodes = descendants(element).filter((node) => node?.nodeType === 3);
        let index = 0;
        return { nextNode: () => textNodes[index++] || null };
      }
    }
  });
  const root = semanticRoot(renderSemanticSegments(view, expected, { mode: 'source' }));
  assert.equal(view.restoreSemanticSelection(root, { anchor: 33, focus: 33 }), true);
  assert.deepEqual(
    { ...view.captureSemanticSelection(root) },
    { anchor: 33, focus: 33 },
    'the first byte after the continued marker remains an exact DOM/source caret boundary'
  );
});

test('Round-3 random .387 Enter preserves the following outer ordered ordinal', () => {
  const before = '1. Alpha\n   continued alpha\n       1. 1Beta\n2. Gamma';
  assertExact(
    markdown.applyMarkdownNewline(before, { anchor: 35, focus: 35 }),
    '1. Alpha\n   continued alpha\n       \n       1. 1Beta\n2. Gamma',
    43,
    'list-random-500.387.action-6'
  );
});

test('Round-3 random .404 Delete starts the newly nested ordered run at one', () => {
  const result = markdown.applyMarkdownStructuralDeletion(
    '1. A\n    \n2. C',
    { anchor: 9, focus: 9 },
    'forward'
  );
  assertExact(
    result,
    '1. A\n    1. C',
    9,
    'list-random-500.404.action-8'
  );
  assert.equal(result.editKind, 'line-boundary');
});
