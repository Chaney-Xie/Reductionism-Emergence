const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const { normalizeSemanticDeletionFiller } = loadMarkdownPageViewInternals([
  'normalizeSemanticDeletionFiller'
]);

test('native Delete sync ignores stale source metadata at a physical-line boundary', () => {
  const source = 'A\nB\nC';
  const beforeSelection = { anchor: 2, focus: 2 };
  let liveSelection = null;
  let expectedRangeEnd = null;
  const runtime = loadMarkdownPageViewInternals([
    'captureSemanticMutationSelection',
    'renderSemanticBlockContents',
    'semanticOffsetAtDomPoint',
    'semanticSourceFromNode',
    'semanticSyntaxSegments',
    'syncSemanticDocumentInput'
  ], {
    window: {
      getSelection() {
        return liveSelection;
      }
    },
    document: {
      createRange() {
        let endNode = null;
        let endOffset = null;
        return {
          selectNodeContents() {},
          setEnd(node, offset) {
            endNode = node;
            endOffset = offset;
          },
          cloneContents() {
            assert.equal(endNode, expectedRangeEnd);
            assert.equal(endOffset, 0);
            return {
              nodeType: 11,
              childNodes: [{ nodeType: 3, nodeValue: 'A\n' }]
            };
          }
        };
      }
    }
  });
  const structural = markdown.applyMarkdownStructuralDeletion(
    source,
    beforeSelection,
    'forward'
  );
  assert.equal(structural.changed, false, 'plain character Delete stays native');

  const rendered = renderSemanticSegments(runtime, source, { mode: 'source' });
  const bodyRoot = new FakeElement();
  bodyRoot.isConnected = true;
  bodyRoot.focus = () => {};
  rendered.blocks.forEach((block) => bodyRoot.append(block.element));
  const middleText = descendants(bodyRoot).find((node) => (
    node?.classList?.contains('markdown-source-mapped-text')
      && node.dataset.markdownSourceStart === '2'
      && node.dataset.markdownSourceEnd === '3'
  ));
  const followingBreak = descendants(bodyRoot).find((node) => (
    node?.classList?.contains('markdown-source-line-break')
      && node.dataset.markdownSourceStart === '3'
      && node.dataset.markdownSourceEnd === '4'
  ));
  assert.equal(middleText?.textContent, 'B');
  assert.equal(followingBreak?.textContent, '\n');

  // Chromium removes the mapped B span and moves its caret to the start of
  // the following newline. That unchanged span still has its pre-edit 3..4
  // metadata until input synchronization reconciles the source.
  const paragraph = middleText.parentElement;
  paragraph.childNodes.splice(paragraph.childNodes.indexOf(middleText), 1);
  middleText.parentElement = null;
  expectedRangeEnd = followingBreak.firstChild;
  liveSelection = {
    rangeCount: 1,
    anchorNode: followingBreak.firstChild,
    anchorOffset: 0,
    focusNode: followingBreak.firstChild,
    focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };

  assert.equal(runtime.semanticSourceFromNode(bodyRoot), 'A\n\nC');
  assert.equal(
    runtime.semanticOffsetAtDomPoint(bodyRoot, followingBreak.firstChild, 0),
    3,
    'the normal selection path sees the deliberately stale mapped range'
  );
  assert.deepEqual(
    { ...runtime.captureSemanticMutationSelection(bodyRoot) },
    { anchor: 2, focus: 2 },
    'input sync instead measures the serialized mutated DOM prefix'
  );

  Object.assign(rendered.state, {
    bodyRoot,
    page: { id: 'regression.9cdc6c4c75aadfc6a4ca' },
    paneId: 'pane-regression',
    semanticDirty: false,
    editHistory: runtime.createMarkdownEditHistory(source),
    pendingEditTransaction: {
      beforeSource: source,
      beforeSelection,
      inputType: 'deleteContentForward',
      timestamp: 1
    }
  });
  runtime.syncSemanticDocumentInput(rendered.state, {
    inputType: 'deleteContentForward'
  });

  assert.equal(rendered.state.body, 'A\n\nC');
  assert.equal(runtime.semanticSourceFromNode(bodyRoot), 'A\n\nC');
  const transaction = rendered.state.editHistory.undoStack[0];
  assert.deepEqual(
    { ...transaction.afterSelection },
    { anchor: 2, focus: 2 }
  );
  assert.equal(liveSelection.anchorOffset, 0);
  assert.equal(liveSelection.anchorNode.dataset.markdownSourceStart, '2');
  assert.equal(liveSelection.anchorNode.dataset.markdownSourceEnd, '3');
});

test('Delete normalizes only Chromium NBSP fillers in the unchanged source prefix', () => {
  const before = 'A\nB\n    * C\nD';
  const chromium = 'A\nB\n    *\u00a0\nD';

  assert.equal(normalizeSemanticDeletionFiller(
    before,
    chromium,
    { anchor: 10, focus: 10 },
    'deleteContentForward'
  ), 'A\nB\n    * \nD');
});

test('Backspace normalizes a preceding filler but preserves literal NBSP source', () => {
  assert.equal(normalizeSemanticDeletionFiller(
    'A  x',
    'A\u00a0x',
    { anchor: 3, focus: 3 },
    'deleteContentBackward'
  ), 'A x');

  assert.equal(normalizeSemanticDeletionFiller(
    'A \u00a0x',
    'A \u00a0',
    { anchor: 4, focus: 4 },
    'deleteContentForward'
  ), 'A \u00a0');
  assert.equal(normalizeSemanticDeletionFiller(
    'A x',
    'A\u00a0x',
    { anchor: 2, focus: 2 },
    'insertText'
  ), 'A\u00a0x');

  assert.equal(normalizeSemanticDeletionFiller(
    '🧠  x',
    '🧠\u00a0x',
    { anchor: 4, focus: 4 },
    'deleteContentBackward'
  ), '🧠 x');
});

test('9ceb Round-2 Backspace restores a Chromium filler to the literal tab run', () => {
  const before = '- A\n\t- \n\t- \n  \nA> `xA\t\t- C';
  const chromium = '- A\n\t- \n\t- \n  \nA> `x\u00a0 - C';

  assert.equal(normalizeSemanticDeletionFiller(
    before,
    chromium,
    { anchor: 21, focus: 21 },
    'deleteContentBackward'
  ), '- A\n\t- \n\t- \n  \nA> `x\t\t- C');
});
