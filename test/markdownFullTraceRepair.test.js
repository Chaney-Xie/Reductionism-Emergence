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

function semanticRoot(rendered) {
  const root = new FakeElement({ tagName: 'div' });
  root.isConnected = true;
  root.focus = () => {};
  root.append(...rendered.blocks.map((block) => block.element));
  return root;
}

test('v0.3 full-trace repair keeps forward Delete at an unclosed-fence EOF canonical no-op', () => {
  let browserSelection = null;
  const view = loadMarkdownPageViewInternals([
    'applyMarkdownStructuralDeletionShortcut',
    'markdownMarkerDeletionEdit',
    'markdownSourceMarkerRanges',
    'markdownTextInsertionEdit',
    'renderSemanticBlockContents',
    'semanticSyntaxSegments'
  ], {
    window: {
      getSelection() {
        return browserSelection;
      }
    }
  });

  let source = '```js';
  let selection = { anchor: 5, focus: 5 };
  const observations = [];
  const record = () => observations.push({ source, selection: { ...selection } });

  let result = view.markdownTextInsertionEdit(source, selection, ' ');
  source = result.source;
  selection = result.selection;
  record();

  result = markdown.applyMarkdownNewline(source, selection, {
    inputType: 'insertLineBreak'
  });
  source = result.source;
  selection = result.selection;
  record();

  const deleteRendered = renderSemanticSegments(view, source, { mode: 'live-preview' });
  const deleteRoot = semanticRoot(deleteRendered);
  const fenceMarker = descendants(deleteRoot).find((node) => (
    node?.classList?.contains('markdown-source-marker')
      && node.dataset.markdownSourceStart === '0'
      && node.dataset.markdownSourceEnd === String(source.length)
  ));
  assert.ok(fenceMarker?.firstChild);
  browserSelection = {
    rangeCount: 1,
    anchorNode: fenceMarker.firstChild,
    anchorOffset: source.length,
    focusNode: fenceMarker.firstChild,
    focusOffset: source.length
  };
  const deleteState = {
    body: source,
    bodyRoot: deleteRoot,
    mode: 'live-preview',
    pageEditMode: false,
    bodyReadOnly: false
  };
  assert.equal(
    view.applyMarkdownStructuralDeletionShortcut(deleteState, 'forward'),
    true,
    'the keydown owner must consume Delete before Chromium mutates the adjacent empty code leaf'
  );
  assert.equal(deleteState.body, source);
  record();

  result = markdown.applyMarkdownIndentation(source, selection, 'outdent');
  source = result.source;
  selection = result.selection;
  record();

  result = view.markdownTextInsertionEdit(source, selection, '`');
  source = result.source;
  selection = result.selection;
  record();

  const backspaceRendered = renderSemanticSegments(view, source, { mode: 'live-preview' });
  const backspaceRoot = semanticRoot(backspaceRendered);
  result = markdown.applyMarkdownStructuralDeletion(source, selection, 'backward');
  if (!result.changed) {
    result = view.markdownMarkerDeletionEdit(
      source,
      selection,
      'backward',
      view.markdownSourceMarkerRanges(backspaceRoot)
    );
  }
  source = result.source;
  selection = result.selection;
  record();

  assert.deepEqual(observations, [
    { source: '```js ', selection: { anchor: 6, focus: 6 } },
    { source: '```js \n', selection: { anchor: 7, focus: 7 } },
    { source: '```js \n', selection: { anchor: 7, focus: 7 } },
    { source: '```js \n', selection: { anchor: 7, focus: 7 } },
    { source: '```js \n``', selection: { anchor: 8, focus: 8 } },
    { source: '```js \n', selection: { anchor: 7, focus: 7 } }
  ]);
});

test('v0.3 task-blank-item ArrowLeft round-trips through terminal hidden indentation', () => {
  let browserSelection = null;
  const view = loadMarkdownPageViewInternals([
    'applySemanticArrowNavigation',
    'captureSemanticSelection',
    'renderSemanticBlockContents',
    'semanticDomPointAtOffset',
    'semanticSyntaxSegments'
  ], {
    window: {
      getSelection() {
        return browserSelection;
      }
    }
  });
  const source = '- [ ] A\n- [ ] \n      \n      ';
  const rendered = renderSemanticSegments(view, source, { mode: 'source' });
  const root = semanticRoot(rendered);
  const indentation = descendants(root).find((node) => (
    node?.classList?.contains('markdown-source-indentation')
      && node.dataset.markdownSourceStart === '22'
      && node.dataset.markdownSourceEnd === '28'
  ));
  assert.ok(indentation?.firstChild);

  browserSelection = {
    rangeCount: 1,
    anchorNode: indentation.firstChild,
    anchorOffset: 6,
    focusNode: indentation.firstChild,
    focusOffset: 6,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  const state = {
    body: source,
    bodyRoot: root,
    mode: 'source',
    pageEditMode: false,
    bodyReadOnly: false,
    editHistory: null,
    semanticArrowColumn: null
  };
  let prevented = 0;
  let stopped = 0;
  const event = {
    key: 'ArrowLeft',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  };

  assert.deepEqual(
    { ...view.captureSemanticSelection(root) },
    { anchor: 28, focus: 28 }
  );
  assert.equal(view.applySemanticArrowNavigation(state, event), true);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(browserSelection.anchorNode, indentation.firstChild);
  assert.equal(browserSelection.anchorOffset, 5);
  assert.deepEqual(
    { ...view.captureSemanticSelection(root) },
    { anchor: 27, focus: 27 }
  );
});

test('v0.3 malformed inline HTML Backspace preserves an adjacent literal space run', () => {
  let browserSelection = null;
  const view = loadMarkdownPageViewInternals([
    'applyMarkdownStructuralDeletionShortcut',
    'captureSemanticSelection',
    'markdownCollapsibleWhitespaceDeletionEdit',
    'renderSemanticBlockContents',
    'semanticSourceFromNode',
    'semanticSyntaxSegments'
  ], {
    window: {
      getSelection() {
        return browserSelection;
      }
    },
    document: {
      createTreeWalker(element) {
        const textNodes = descendants(element).filter((node) => node?.nodeType === 3);
        let index = 0;
        return {
          nextNode() {
            const node = textNodes[index] || null;
            index += 1;
            return node;
          }
        };
      }
    }
  });
  const source = '<u  nerline</u>, H<sub>2</sub>O, x<sup>2</sup>, <br> next; <kbd>escaped</kbd>.';
  const expected = '<u  erline</u>, H<sub>2</sub>O, x<sup>2</sup>, <br> next; <kbd>escaped</kbd>.';
  const rendered = renderSemanticSegments(view, source, { mode: 'live-preview' });
  const root = semanticRoot(rendered);
  const mappedPrefix = descendants(root).find((node) => (
    node?.classList?.contains('markdown-source-mapped-text')
      && node.dataset.markdownSourceStart === '0'
      && node.dataset.markdownSourceEnd === '11'
  ));
  assert.equal(mappedPrefix?.textContent, '<u  nerline');
  browserSelection = {
    rangeCount: 1,
    anchorNode: mappedPrefix.firstChild,
    anchorOffset: 5,
    focusNode: mappedPrefix.firstChild,
    focusOffset: 5,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      this.anchorNode = anchorNode;
      this.anchorOffset = anchorOffset;
      this.focusNode = focusNode;
      this.focusOffset = focusOffset;
    }
  };
  Object.assign(rendered.state, {
    bodyRoot: root,
    pageEditMode: false,
    bodyReadOnly: false,
    editHistory: view.createMarkdownEditHistory(source),
    semanticDirty: false,
    pendingEditTransaction: null
  });

  assert.deepEqual(
    { ...view.captureSemanticSelection(root) },
    { anchor: 5, focus: 5 },
    'the runtime caret maps exactly after n; the source-affinity mapping is not off by one'
  );
  assert.equal(
    view.applyMarkdownStructuralDeletionShortcut(rendered.state, 'backward'),
    true,
    'keydown must own this edit before Chromium collapses the two source spaces'
  );
  assert.equal(rendered.state.body, expected);
  assert.equal(view.semanticSourceFromNode(root), expected);
  assert.deepEqual(
    { ...view.captureSemanticSelection(root) },
    { anchor: 4, focus: 4 }
  );
});
