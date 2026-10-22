const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = require('../public/markdownPage');

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...names) {
    names.filter(Boolean).forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  [Symbol.iterator]() {
    return this.values[Symbol.iterator]();
  }
}

class FakeText {
  constructor(value = '') {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.parentElement = null;
    this.parentNode = null;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value || '');
  }
}

class FakeElement {
  constructor({ dataset = {}, tagName = 'br', children = [], nodeType = 1 } = {}) {
    this.nodeType = nodeType;
    this.dataset = { ...dataset };
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.style = {
      setProperty(name, value) {
        this[name] = String(value);
      },
      removeProperty(name) {
        delete this[name];
      }
    };
    this.attributes = {};
    this.classList = new FakeClassList(this);
    this.contentEditable = 'inherit';
    this.spellcheck = true;
    this.tabIndex = 0;
    this.append(...children);
  }

  get children() {
    return this.childNodes.filter((child) => child?.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get className() {
    return [...this.classList].join(' ');
  }

  set className(value) {
    this.classList.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }

  set textContent(value) {
    this.replaceChildren();
    if (value !== undefined && value !== null && String(value)) {
      this.append(new FakeText(value));
    }
  }

  append(...nodes) {
    nodes.flat().filter((node) => node !== null && node !== undefined).forEach((node) => {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parentElement = this.nodeType === 1 ? this : this.parentElement;
      child.parentNode = this;
      this.childNodes.push(child);
    });
  }

  replaceChildren(...nodes) {
    this.childNodes.forEach((child) => {
      if (child.parentNode === this) {
        child.parentElement = null;
        child.parentNode = null;
      }
    });
    this.childNodes = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener() {}

  removeEventListener() {}

  matches(selector) {
    return selector.split(',').some((candidate) => {
      const value = candidate.trim();
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      const attributes = [...value.matchAll(/\[data-([a-z0-9-]+)(?:="([^"]*)")?\]/gi)];
      if (attributes.length) {
        return attributes.every(([, name, expected]) => {
          const property = name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
          return Object.hasOwn(this.dataset, property)
            && (expected === undefined || this.dataset[property] === expected);
        });
      }
      return value.toLowerCase() === this.tagName.toLowerCase();
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => (
      child === node || (typeof child.contains === 'function' && child.contains(node))
    ));
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      (node?.childNodes || []).forEach((child) => {
        if (child?.nodeType === 1 && child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

class FakeDocumentFragment extends FakeElement {
  constructor() {
    super({ tagName: '#document-fragment', nodeType: 11 });
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement({ tagName });
  },
  createElementNS(_namespace, tagName) {
    return new FakeElement({ tagName });
  },
  createTextNode(value) {
    return new FakeText(value);
  },
  createDocumentFragment() {
    return new FakeDocumentFragment();
  },
  createTreeWalker(root) {
    const textNodes = [];
    const visit = (node) => {
      (node?.childNodes || []).forEach((child) => {
        if (child?.nodeType === 3) textNodes.push(child);
        else visit(child);
      });
    };
    visit(root);
    let index = 0;
    return {
      nextNode() {
        const node = textNodes[index] || null;
        index += 1;
        return node;
      }
    };
  },
  addEventListener() {},
  removeEventListener() {}
};

function loadMarkdownPageViewModel() {
  let source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );
  const internalNames = [
    'isCanonicalSourceBreak',
    'exactSemanticTextInsertion',
    'markdownTextInsertionEdit',
    'markdownSourceMarkerRanges',
    'markdownMarkerDeletionEdit',
    'semanticSourceFromNode',
    'semanticOffsetAtDomPoint',
    'semanticSourceRangeOwnsOffset',
    'semanticRangeCandidatesAtOffset',
    'semanticBoundaryAroundHiddenSource',
    'semanticDomPointAtOffset',
    'semanticBlockAtSourceOffset',
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    'sourceEditNeedsLocalRender',
    'sourceEditCanReconcileLocally',
    'sourceDifference'
  ].filter((name) => source.includes(`function ${name}(`));
  if (internalNames.length > 0) {
    source = source.replace(
      '  const api = Object.freeze({',
      `  globalThis.__markdownNewlineTestInternals = { ${internalNames.join(', ')} };\n\n  const api = Object.freeze({`
    );
  }
  const context = {
    globalThis: { markdownPageModel: markdown },
    window: { getSelection() { return null; } },
    Node: { TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11 },
    NodeFilter: { SHOW_TEXT: 4 },
    Element: FakeElement,
    document: fakeDocument
  };
  vm.runInNewContext(source, context);
  return {
    ...context.globalThis.markdownPageView,
    ...(context.globalThis.__markdownNewlineTestInternals || {})
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function descendants(node) {
  const result = [];
  const visit = (current) => {
    if (!current) return;
    result.push(current);
    (current.childNodes || []).forEach(visit);
  };
  visit(node);
  return result;
}

function elementsWithClass(node, className) {
  return descendants(node).filter((candidate) => candidate?.classList?.contains(className));
}

function renderSemanticSegments(view, source) {
  const state = { body: source };
  const segments = view.semanticSyntaxSegments(state);
  state.semanticBlocks = segments.map((segment, index) => ({
    ...segment,
    hasFollowingBlock: index < segments.length - 1,
    element: new FakeElement({ tagName: 'div' })
  }));
  state.semanticBlocks.forEach((block) => view.renderSemanticBlockContents(state, block));
  return { state, segments, blocks: state.semanticBlocks };
}

function replaceRange(source, start, end, replacement) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function renderSemanticRoot(view, source) {
  const rendered = renderSemanticSegments(view, source);
  const root = new FakeElement({ tagName: 'div' });
  root.append(...rendered.blocks.map((block) => block.element));
  return { ...rendered, root };
}

function pointElement(point) {
  return point?.node?.nodeType === 1 ? point.node : point?.node?.parentElement;
}

function editableSourceLeafEndingAt(root, offset) {
  return descendants(root).find((element) => (
    element?.nodeType === 1
    && (element.classList?.contains('markdown-source-mapped-text')
      || element.classList?.contains('markdown-source-marker'))
    && Number(element.dataset?.markdownSourceEnd) === offset
    && element.childNodes?.length === 1
    && element.firstChild?.nodeType === 3
  ));
}

test('ordinary source lines remain adjacent and blank lines remain exact source', () => {
  const view = loadMarkdownPageViewModel();

  const adjacent = Array.from(view.sourceSegments('123\n45'), (segment) => ({
    start: segment.start,
    end: segment.end,
    raw: segment.raw
  }));
  assert.deepEqual(adjacent, [{ start: 0, end: 6, raw: '123\n45' }]);

  const separatedSource = '123\n\n45';
  const separated = Array.from(view.sourceSegments(separatedSource), (segment) => ({
    start: segment.start,
    end: segment.end,
    raw: segment.raw
  }));
  assert.deepEqual(separated, [
    { start: 0, end: 3, raw: '123' },
    { start: 5, end: 7, raw: '45' }
  ]);
  assert.equal(
    separatedSource.slice(separated[0].end, separated[1].start),
    '\n\n'
  );
});

test('semantic source offsets use half-open ownership at shared boundaries', () => {
  const view = loadMarkdownPageViewModel();
  const entries = [
    { id: 'previous-gap', start: 3, end: 5, depth: 4 },
    { id: 'next-block', start: 5, end: 7, depth: 1 },
    { id: 'next-text', start: 5, end: 7, depth: 4 }
  ];

  assert.equal(view.semanticSourceRangeOwnsOffset(3, 5, 4, 7), true);
  assert.equal(view.semanticSourceRangeOwnsOffset(3, 5, 5, 7), false);
  assert.equal(view.semanticSourceRangeOwnsOffset(5, 7, 5, 7), true);
  assert.equal(
    view.semanticRangeCandidatesAtOffset(entries, 5, 7)[0].id,
    'next-text',
    'the following mapped text owns its exact start instead of the preceding gap end'
  );
  assert.ok(
    view.semanticRangeCandidatesAtOffset(entries, 5, 7)
      .every((entry) => entry.id !== 'previous-gap')
  );
});

test('document-final, empty, and inline shared offsets remain explicitly addressable', () => {
  const view = loadMarkdownPageViewModel();
  const finalEntries = [
    { id: 'block', start: 0, end: 4, depth: 1 },
    { id: 'trailing-break', start: 3, end: 4, depth: 4 }
  ];
  assert.equal(
    view.semanticRangeCandidatesAtOffset(finalEntries, 4, 4)[0].id,
    'trailing-break',
    'only the true document end may fall back to an ending source range'
  );
  assert.equal(
    view.semanticRangeCandidatesAtOffset(
      [{ id: 'empty', start: 0, end: 0, depth: 1 }],
      0,
      0
    )[0].id,
    'empty'
  );

  const inlineEntries = [
    { id: 'construct', start: 0, end: 7, depth: 1 },
    { id: 'opening-marker', start: 0, end: 2, depth: 3 },
    { id: 'content', start: 2, end: 5, depth: 3 },
    { id: 'closing-marker', start: 5, end: 7, depth: 3 }
  ];
  assert.equal(view.semanticRangeCandidatesAtOffset(inlineEntries, 2, 7)[0].id, 'content');
  assert.equal(view.semanticRangeCandidatesAtOffset(inlineEntries, 5, 7)[0].id, 'closing-marker');
});

test('rendered source-to-DOM mapping gives a following paragraph its shared start', () => {
  const view = loadMarkdownPageViewModel();
  const rendered = renderSemanticSegments(view, '123\n\n45');
  const root = new FakeElement({ tagName: 'div' });
  root.append(...rendered.blocks.map((block) => block.element));
  const gap = elementsWithClass(rendered.blocks[0].element, 'markdown-source-block-gap')[0];
  const nextText = elementsWithClass(rendered.blocks[1].element, 'markdown-source-mapped-text')[0];

  assert.ok(gap);
  assert.ok(nextText?.firstChild);
  assert.equal(gap.dataset.markdownSourceEnd, '5');
  const nextStart = view.semanticDomPointAtOffset(root, 5);
  assert.equal(nextStart.node, nextText.firstChild);
  assert.equal(nextStart.offset, 0);

  const genuineGapPoint = view.semanticDomPointAtOffset(root, 4);
  assert.ok(
    genuineGapPoint.node === gap || gap.contains(genuineGapPoint.node),
    'a genuine blank-row offset remains owned by the source-gap subtree'
  );
});

test('ordinary end-of-line typing keeps source-gap ownership without restoring into its next visual row', async (t) => {
  const view = loadMarkdownPageViewModel();
  const fixtures = [
    {
      name: 'ordinary paragraph',
      before: 'alpha\n\nbeta',
      insertionOffset: 5,
      after: 'alphaX\n\nbeta',
      firstType: 'paragraph'
    },
    {
      name: 'heading',
      before: '# Head\n\nAfter',
      insertionOffset: 6,
      after: '# HeadX\n\nAfter',
      firstType: 'heading'
    },
    {
      name: 'emphasis followed by ordinary text',
      before: '**bold**\n\nAfter',
      insertionOffset: 8,
      after: '**bold**X\n\nAfter',
      firstType: 'paragraph'
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const expectedCaret = fixture.insertionOffset + 1;
      assert.equal(
        replaceRange(fixture.before, fixture.insertionOffset, fixture.insertionOffset, 'X'),
        fixture.after,
        'the ordinary character transaction changes exactly one canonical byte'
      );
      assert.equal(
        markdown.parseMarkdownDocument(fixture.after).children[0].type,
        fixture.firstType
      );

      const rendered = renderSemanticRoot(view, fixture.after);
      assert.equal(view.semanticSourceFromNode(rendered.root), fixture.after);
      const gap = elementsWithClass(rendered.root, 'markdown-source-block-gap')[0];
      const followingText = elementsWithClass(rendered.root, 'markdown-source-mapped-text')
        .find((element) => Number(element.dataset.markdownSourceStart) > expectedCaret);
      assert.ok(gap);
      assert.equal(Number(gap.dataset.markdownSourceStart), expectedCaret);
      assert.ok(Number(followingText.dataset.markdownSourceStart) > expectedCaret);

      const point = view.semanticDomPointAtOffset(rendered.root, expectedCaret);
      const precedingLeaf = editableSourceLeafEndingAt(rendered.root, expectedCaret);
      assert.ok(precedingLeaf?.firstChild);
      assert.equal(point.node, precedingLeaf.firstChild);
      assert.equal(point.offset, precedingLeaf.firstChild.nodeValue.length);
      assert.equal(
        view.semanticOffsetAtDomPoint(rendered.root, point.node, point.offset),
        expectedCaret,
        'the upstream DOM affinity still round-trips to the newline-owned canonical offset'
      );
      assert.equal(
        replaceRange(fixture.after, expectedCaret - 1, expectedCaret, ''),
        fixture.before,
        'Backspace at the restored leaf end removes the previous canonical character'
      );
      assert.equal(
        rendered.blocks[1].element.contains(point.node),
        false,
        'caret restoration must not choose the following paragraph'
      );
    });
  }
});

test('quote and list line breaks keep the canonical caret before their next visual line', async (t) => {
  const view = loadMarkdownPageViewModel();
  for (const fixture of [
    {
      name: 'quote line',
      before: '> one\n> two',
      insertionOffset: 5,
      after: '> oneX\n> two',
      breakClass: 'markdown-source-line-break',
      astType: 'blockquote'
    },
    {
      name: 'list item',
      before: '- one\n- two',
      insertionOffset: 5,
      after: '- oneX\n- two',
      breakClass: 'markdown-source-structural-break',
      astType: 'list'
    }
  ]) {
    await t.test(fixture.name, () => {
      const expectedCaret = fixture.insertionOffset + 1;
      assert.equal(
        replaceRange(fixture.before, fixture.insertionOffset, fixture.insertionOffset, 'X'),
        fixture.after
      );
      assert.equal(markdown.parseMarkdownDocument(fixture.after).children[0].type, fixture.astType);
      const rendered = renderSemanticRoot(view, fixture.after);
      assert.equal(view.semanticSourceFromNode(rendered.root), fixture.after);
      const sourceBreak = elementsWithClass(rendered.root, fixture.breakClass)[0];
      assert.ok(sourceBreak);

      if (fixture.breakClass === 'markdown-source-line-break') {
        assert.equal(Number(sourceBreak.dataset.markdownSourceStart), expectedCaret);
      } else {
        assert.equal(Number(sourceBreak.dataset.markdownStructuralStart), expectedCaret);
      }

      const point = view.semanticDomPointAtOffset(rendered.root, expectedCaret);
      const precedingLeaf = editableSourceLeafEndingAt(rendered.root, expectedCaret);
      assert.ok(precedingLeaf?.firstChild);
      assert.equal(point.node, precedingLeaf.firstChild);
      assert.equal(point.offset, precedingLeaf.firstChild.nodeValue.length);
      assert.equal(
        view.semanticOffsetAtDomPoint(rendered.root, point.node, point.offset),
        expectedCaret,
        'the newline keeps canonical ownership while its DOM caret uses upstream text affinity'
      );
    });
  }
});

test('one structural newline owns its exact range while caret affinity stays editable', async (t) => {
  const view = loadMarkdownPageViewModel();
  for (const fixture of [
    { name: 'paragraph to heading', source: 'YaZQ\n# b', types: ['paragraph', 'heading'] },
    { name: 'paragraph to list', source: 'YaZQ\n- b', types: ['paragraph', 'list'] }
  ]) {
    await t.test(fixture.name, () => {
      const rendered = renderSemanticRoot(view, fixture.source);
      assert.deepEqual(rendered.segments.map((segment) => segment.node.type), fixture.types);
      const previousNodeEnd = rendered.segments[0].node.position.end.offset;
      const nextNodeStart = rendered.segments[1].node.position.start.offset;
      assert.equal(fixture.source.slice(previousNodeEnd, nextNodeStart), '\n');

      const structuralBreak = elementsWithClass(
        rendered.blocks[0].element,
        'markdown-source-structural-break'
      )[0];
      assert.ok(structuralBreak);
      assert.equal(Number(structuralBreak.dataset.markdownSourceStart), previousNodeEnd);
      assert.equal(Number(structuralBreak.dataset.markdownSourceEnd), nextNodeStart);

      const precedingLeaf = editableSourceLeafEndingAt(rendered.root, previousNodeEnd);
      assert.ok(precedingLeaf?.firstChild);
      const beforeNewline = view.semanticDomPointAtOffset(rendered.root, previousNodeEnd);
      assert.equal(beforeNewline.node, precedingLeaf.firstChild);
      assert.equal(beforeNewline.offset, precedingLeaf.firstChild.nodeValue.length);
      assert.equal(
        view.semanticOffsetAtDomPoint(rendered.root, beforeNewline.node, beforeNewline.offset),
        previousNodeEnd
      );
      assert.equal(
        replaceRange(fixture.source, previousNodeEnd - 1, previousNodeEnd, ''),
        `YaZ${fixture.source.slice(previousNodeEnd)}`,
        'Backspace is represented as deleting the preceding source character, not its block'
      );

      const nextBlockStart = view.semanticDomPointAtOffset(rendered.root, nextNodeStart);
      assert.equal(rendered.blocks[1].element.contains(nextBlockStart.node), true);
      assert.equal(
        view.semanticOffsetAtDomPoint(rendered.root, nextBlockStart.node, nextBlockStart.offset),
        nextNodeStart,
        'the half-open end remains owned by the following semantic block'
      );
    });
  }
});

test('syntax-changing ordinary deletions preserve exact source, DOM and same-line caret offsets', async (t) => {
  const view = loadMarkdownPageViewModel();
  const fixtures = [
    {
      name: 'heading marker',
      before: '# Heading\n\nNext',
      start: 0,
      end: 1,
      after: ' Heading\n\nNext',
      beforeType: 'heading',
      afterType: 'paragraph'
    },
    {
      name: 'emphasis marker',
      before: '**bold**\n\nNext',
      start: 1,
      end: 2,
      after: '*bold**\n\nNext',
      beforeType: 'paragraph',
      afterType: 'paragraph'
    },
    {
      name: 'quote marker',
      before: '> quote\n\nNext',
      start: 0,
      end: 1,
      after: ' quote\n\nNext',
      beforeType: 'blockquote',
      afterType: 'paragraph'
    },
    {
      name: 'ordered-list marker digit',
      before: '1. item\n\nNext',
      start: 0,
      end: 1,
      after: '. item\n\nNext',
      beforeType: 'list',
      afterType: 'paragraph'
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      assert.equal(replaceRange(fixture.before, fixture.start, fixture.end, ''), fixture.after);
      const beforeTree = markdown.parseMarkdownDocument(fixture.before);
      const afterTree = markdown.parseMarkdownDocument(fixture.after);
      assert.equal(beforeTree.children[0].type, fixture.beforeType);
      assert.equal(afterTree.children[0].type, fixture.afterType);

      const previous = renderSemanticSegments(view, fixture.before);
      const difference = view.sourceDifference(fixture.before, fixture.after);
      const nextSegments = view.semanticSyntaxSegments({ body: fixture.after });
      const canReconcileLocally = view.sourceEditCanReconcileLocally(
        previous.state,
        previous.blocks[0],
        difference,
        nextSegments
      );
      if (fixture.name === 'emphasis marker') {
        assert.notDeepEqual(
          beforeTree.children[0].children.map((node) => node.type),
          afterTree.children[0].children.map((node) => node.type),
          'the inline AST ownership really changes even though the outer paragraph remains'
        );
        assert.equal(canReconcileLocally, true);
        previous.state.body = fixture.after;
        assert.equal(view.sourceEditNeedsLocalRender(
          previous.state,
          previous.blocks[0],
          difference,
          { inputType: 'deleteContentBackward' },
          fixture.before
        ), true, 'an inline AST ownership change forces a fresh semantic block render');
      } else {
        assert.equal(
          canReconcileLocally,
          false,
          'a top-level AST ownership change must force conservative full reconciliation'
        );
      }

      const rendered = renderSemanticRoot(view, fixture.after);
      assert.equal(view.semanticSourceFromNode(rendered.root), fixture.after);
      const expectedCaret = fixture.start;
      const point = view.semanticDomPointAtOffset(rendered.root, expectedCaret);
      assert.ok(point);
      assert.equal(
        rendered.blocks[0].element.contains(point.node),
        true,
        'the canonical caret stays in the rebuilt first semantic block'
      );
      assert.equal(
        rendered.blocks[1].element.contains(point.node),
        false,
        'the canonical caret does not drift into the next paragraph'
      );
      assert.equal(
        view.semanticBlockAtSourceOffset({
          body: fixture.after,
          semanticBlocks: rendered.blocks
        }, expectedCaret),
        rendered.blocks[0]
      );
      assert.ok(pointElement(point));
    });
  }
});

test('hidden list indentation restores the caret to visible source boundaries', () => {
  const view = loadMarkdownPageViewModel();
  const source = '- parent\n\t- child\n\t- second';
  const rendered = renderSemanticSegments(view, source);
  const root = new FakeElement({ tagName: 'div' });
  root.append(...rendered.blocks.map((block) => block.element));
  const indentation = elementsWithClass(root, 'markdown-source-indentation')[1];

  assert.ok(indentation);
  const parent = indentation.parentNode;
  const index = parent.childNodes.indexOf(indentation);
  const start = Number(indentation.dataset.markdownSourceStart);
  const end = Number(indentation.dataset.markdownSourceEnd);

  const beforeBoundary = view.semanticBoundaryAroundHiddenSource(indentation, false);
  assert.equal(beforeBoundary.node, parent);
  assert.equal(beforeBoundary.offset, index);
  const afterBoundary = view.semanticBoundaryAroundHiddenSource(indentation, true);
  assert.equal(afterBoundary.node, parent);
  assert.equal(afterBoundary.offset, index + 1);
  const atIndentationStart = view.semanticDomPointAtOffset(root, start);
  assert.equal(atIndentationStart.node, parent);
  assert.equal(atIndentationStart.offset, index);
  const afterIndentation = view.semanticDomPointAtOffset(root, end);
  assert.equal(indentation.contains(afterIndentation.node), false);
});

test('canonical block ownership prefers the following segment at a shared start', () => {
  const view = loadMarkdownPageViewModel();
  const state = {
    body: '123\n\n45',
    semanticBlocks: [
      { id: 'first', start: 0, end: 5 },
      { id: 'second', start: 5, end: 7 }
    ]
  };
  assert.equal(view.semanticBlockAtSourceOffset(state, 4).id, 'first');
  assert.equal(view.semanticBlockAtSourceOffset(state, 5).id, 'second');
  assert.equal(view.semanticBlockAtSourceOffset(state, 7).id, 'second');
});

test('only strictly contained one-segment edits qualify for local reconciliation', () => {
  const view = loadMarkdownPageViewModel();
  const oldSource = 'alpha text\n\nbeta text';
  const oldState = { body: oldSource };
  const oldSegments = view.semanticSyntaxSegments(oldState);
  oldState.semanticBlocks = oldSegments.map((segment) => ({ ...segment }));

  const interiorSource = 'alXpha text\n\nbeta text';
  const interiorDifference = view.sourceDifference(oldSource, interiorSource);
  const interiorSegments = view.semanticSyntaxSegments({ body: interiorSource });
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[0],
      interiorDifference,
      interiorSegments
    ),
    true
  );

  const secondStart = oldState.semanticBlocks[1].start;
  const boundarySource = replaceRange(oldSource, secondStart, secondStart, 'X');
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[1],
      view.sourceDifference(oldSource, boundarySource),
      view.semanticSyntaxSegments({ body: boundarySource })
    ),
    false,
    'an insertion at the next segment start must force complete reconciliation'
  );

  const firstNodeEnd = oldState.semanticBlocks[0].node.position.end.offset;
  const gapSource = replaceRange(oldSource, firstNodeEnd, firstNodeEnd, '\n');
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[0],
      view.sourceDifference(oldSource, gapSource),
      view.semanticSyntaxSegments({ body: gapSource })
    ),
    false,
    'changing an inter-block source gap cannot use one-block reconciliation'
  );

  const segmentEndSource = replaceRange(oldSource, firstNodeEnd - 1, firstNodeEnd, '');
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[0],
      view.sourceDifference(oldSource, segmentEndSource),
      view.semanticSyntaxSegments({ body: segmentEndSource })
    ),
    false,
    'an edit ending at the semantic node boundary must force complete reconciliation'
  );

  const acrossBoundarySource = replaceRange(oldSource, firstNodeEnd - 1, secondStart + 1, 'X');
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[0],
      view.sourceDifference(oldSource, acrossBoundarySource),
      view.semanticSyntaxSegments({ body: acrossBoundarySource })
    ),
    false,
    'a deletion spanning a block boundary must force complete reconciliation'
  );

  const gapShrinkSource = replaceRange(oldSource, firstNodeEnd, firstNodeEnd + 1, '');
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[0],
      view.sourceDifference(oldSource, gapShrinkSource),
      view.semanticSyntaxSegments({ body: gapShrinkSource })
    ),
    false,
    'shrinking an inter-block source gap must force complete reconciliation'
  );

  const typeChangeSource = '# alpha text\n\nbeta text';
  assert.equal(
    view.sourceEditCanReconcileLocally(
      oldState,
      oldState.semanticBlocks[0],
      view.sourceDifference(oldSource, typeChangeSource),
      view.semanticSyntaxSegments({ body: typeChangeSource })
    ),
    false,
    'an AST node-type change must force complete reconciliation'
  );
});

test('one soft newline remains inside one paragraph with one exact source range', () => {
  const source = '第一行\n第二行';
  const tree = markdown.parseMarkdownDocument(source);
  const blocks = markdown.sourceBlocks(source);

  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].type, 'paragraph');
  assert.deepEqual(plain(tree.children[0].position), {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 2, column: 4, offset: source.length }
  });
  assert.equal(tree.children[0].children.length, 1);
  assert.equal(tree.children[0].children[0].type, 'text');
  assert.equal(tree.children[0].children[0].value, source);
  assert.deepEqual(blocks.map((block) => ({
    type: block.type,
    start: block.start,
    end: block.end,
    source: block.source
  })), [{ type: 'paragraph', start: 0, end: source.length, source }]);

  const view = loadMarkdownPageViewModel();
  const rendered = renderSemanticSegments(view, source);
  assert.equal(rendered.segments.length, 1);
  assert.deepEqual(plain(rendered.segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    raw: segment.raw,
    type: segment.node?.type
  }))), [{ start: 0, end: source.length, raw: source, type: 'paragraph' }]);
  assert.equal(elementsWithClass(rendered.blocks[0].element, 'markdown-source-block-gap').length, 0);
  const lineBreaks = elementsWithClass(
    rendered.blocks[0].element,
    'markdown-source-line-break'
  );
  assert.equal(lineBreaks.length, 1, 'one canonical soft newline has one line-break owner');
  assert.equal(lineBreaks[0].dataset.markdownSourceStart, '3');
  assert.equal(lineBreaks[0].dataset.markdownSourceEnd, '4');
  assert.equal(lineBreaks[0].dataset.markdownSourceBreak, 'true');
  assert.equal(view.semanticSourceFromNode(rendered.blocks[0].element), source);

  const secondLineStart = source.indexOf('\n') + 1;
  assert.equal(secondLineStart, 4);
  const mappedText = elementsWithClass(
    rendered.blocks[0].element,
    'markdown-source-mapped-text'
  );
  assert.equal(mappedText.length, 2, 'the source break separates the two mapped text runs');
  assert.equal(mappedText[0].textContent, '第一行');
  assert.equal(mappedText[1].textContent, '第二行');
  assert.equal(
    view.semanticOffsetAtDomPoint(
      rendered.blocks[0].element,
      mappedText[1].firstChild,
      0
    ),
    secondLineStart,
    'the visible beginning of line two maps immediately after the canonical newline'
  );
  assert.equal(replaceRange(source, secondLineStart, secondLineStart, '新'), '第一行\n新第二行');
});

test('every physical line boundary round-trips through DOM ownership inside one paragraph', () => {
  const view = loadMarkdownPageViewModel();
  const fixtures = [
    { source: 'A\nB\nC', offsets: [0, 1, 2, 3, 4, 5] },
    { source: 'A\nB\n\tC', offsets: [0, 1, 2, 3, 4, 5, 6] }
  ];

  fixtures.forEach(({ source, offsets }) => {
    const tree = markdown.parseMarkdownDocument(source);
    assert.equal(tree.children.length, 1, JSON.stringify(source));
    assert.equal(tree.children[0].type, 'paragraph', JSON.stringify(source));

    for (let pass = 0; pass < 2; pass += 1) {
      const { root } = renderSemanticRoot(view, source);
      assert.equal(view.semanticSourceFromNode(root), source, JSON.stringify(source));
      offsets.forEach((offset) => {
        const point = view.semanticDomPointAtOffset(root, offset);
        assert.ok(point?.node, `${JSON.stringify(source)} offset ${offset} has a DOM owner`);
        assert.equal(
          view.semanticOffsetAtDomPoint(root, point.node, point.offset),
          offset,
          `${JSON.stringify(source)} offset ${offset} round-trips on pass ${pass}`
        );
      });
    }
  });
});

test('Enter inside a soft-line paragraph preserves every neighbouring physical row after rerender', () => {
  const view = loadMarkdownPageViewModel();
  const source = 'A\nB\nC';
  const caret = source.indexOf('B') + 1;
  const entered = markdown.applyMarkdownNewline(source, { anchor: caret, focus: caret });
  assert.equal(entered.source, 'A\nB\n\nC');
  assert.deepEqual(entered.selection, { anchor: caret + 1, focus: caret + 1 });

  for (let pass = 0; pass < 2; pass += 1) {
    const { root } = renderSemanticRoot(view, entered.source);
    const mappedLines = elementsWithClass(root, 'markdown-source-mapped-text')
      .map((node) => node.textContent)
      .filter(Boolean);
    assert.deepEqual(mappedLines, ['A', 'B', 'C'], `pass ${pass}: nonblank rows`);
    assert.equal(
      elementsWithClass(root, 'markdown-source-gap-line').length,
      1,
      `pass ${pass}: inserted blank row`
    );
    assert.equal(view.semanticSourceFromNode(root), entered.source, `pass ${pass}: source`);
  }
});

test('N newline separators expose exactly N - 1 genuine blank editable lines', () => {
  const view = loadMarkdownPageViewModel();

  for (let newlineCount = 1; newlineCount <= 5; newlineCount += 1) {
    const separator = '\n'.repeat(newlineCount);
    const source = `甲${separator}乙`;
    const { segments, blocks } = renderSemanticSegments(view, source);

    if (newlineCount === 1) {
      assert.equal(segments.length, 1, 'one newline is an internal paragraph transition');
      assert.equal(segments[0].node.type, 'paragraph');
      assert.equal(segments[0].raw, source);
      assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-block-gap').length, 0);
      assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-gap-line').length, 0);
      assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-line-break').length, 1);
    } else {
      assert.equal(segments.length, 2, `${newlineCount} newlines separate two paragraphs`);
      const nodeEnd = segments[0].node.position.end.offset;
      const suffix = source.slice(nodeEnd, segments[0].end);
      assert.equal(suffix, separator);
      assert.deepEqual(plain(view.editableSourceGapLayout(suffix, { betweenBlocks: true })), {
        source: separator,
        structuralLength: 1,
        visibleSource: '\n'.repeat(newlineCount - 1),
        visibleBlankLines: newlineCount - 1,
        visibleLineOffsets: Array.from({ length: newlineCount - 1 }, (_, index) => index + 1)
      });
      assert.equal(
        elementsWithClass(blocks[0].element, 'markdown-source-gap-line').length,
        newlineCount - 1,
        `${newlineCount} canonical newlines render ${newlineCount - 1} blank rows`
      );
      assert.deepEqual(
        elementsWithClass(blocks[0].element, 'markdown-source-gap-line')
          .map((line) => Number(line.dataset.markdownGapOffset)),
        Array.from({ length: newlineCount - 1 }, (_, index) => index + 1),
        'every clickable blank line owns its exact offset inside the canonical separator'
      );
    }

    assert.equal(
      blocks.map((block) => view.semanticSourceFromNode(block.element)).join(''),
      source,
      'semantic block DOM round-trips every canonical newline exactly once'
    );
  }
});

test('a structural newline between real Markdown blocks is not a source-gap node', () => {
  const view = loadMarkdownPageViewModel();
  const cases = [
    { source: '第一行\n# 标题', types: ['paragraph', 'heading'] },
    { source: '第一行\n- 列表', types: ['paragraph', 'list'] }
  ];

  cases.forEach(({ source, types }) => {
    const { segments, blocks } = renderSemanticSegments(view, source);
    assert.deepEqual(segments.map((segment) => segment.node.type), types);
    assert.equal(source.slice(segments[0].node.position.end.offset, segments[0].end), '\n');
    assert.equal(
      elementsWithClass(blocks[0].element, 'markdown-source-block-gap').length,
      0,
      'the block transition owns the one structural newline without mounting a gap row'
    );
    assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-gap-line').length, 0);
    assert.equal(blocks.map((block) => view.semanticSourceFromNode(block.element)).join(''), source);
  });
});

test('quote continuation and formatted soft lines remain single semantic blocks', () => {
  const view = loadMarkdownPageViewModel();
  const cases = [
    { source: '> 引用\n下一行', type: 'blockquote' },
    { source: '第一 *行*\n第二 **行**', type: 'paragraph' }
  ];

  cases.forEach(({ source, type }) => {
    const { segments, blocks } = renderSemanticSegments(view, source);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].node.type, type);
    assert.equal(segments[0].start, 0);
    assert.equal(segments[0].end, source.length);
    assert.equal(segments[0].raw, source);
    assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-block-gap').length, 0);
    assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-line-break').length, 1);
    assert.equal(view.semanticSourceFromNode(blocks[0].element), source);
  });
});

test('list-item transitions never expose the structural newline as a visible marker', () => {
  const view = loadMarkdownPageViewModel();
  const source = '- 第一\n- 第二';
  const { segments, blocks } = renderSemanticSegments(view, source);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].node.type, 'list');
  assert.equal(elementsWithClass(blocks[0].element, 'markdown-source-block-gap').length, 0);
  assert.equal(
    elementsWithClass(blocks[0].element, 'markdown-source-marker')
      .filter((marker) => marker.textContent === '\n').length,
    0,
    'the list layout owns its item transition; the canonical newline must not paint again'
  );
  assert.equal(view.semanticSourceFromNode(blocks[0].element), source);
});

test('empty and trailing-line editor segments retain exact canonical ownership', () => {
  const view = loadMarkdownPageViewModel();
  const empty = renderSemanticSegments(view, '');
  assert.deepEqual(plain(empty.segments.map(({ start, end, raw, node }) => ({
    start, end, raw, node
  }))), [{ start: 0, end: 0, raw: '', node: null }]);

  const source = '末行\n';
  const trailing = renderSemanticRoot(view, source);
  assert.equal(trailing.segments.length, 1);
  assert.equal(trailing.segments[0].raw, source);
  assert.equal(trailing.segments[0].node.position.end.offset, source.length - 1);
  const trailingLines = elementsWithClass(
    trailing.blocks[0].element,
    'markdown-source-gap-line'
  );
  assert.equal(trailingLines.length, 1);
  assert.equal(trailingLines[0].dataset.markdownSourceStart, String(source.length));
  assert.equal(trailingLines[0].dataset.markdownSourceEnd, String(source.length));
  assert.equal(trailingLines[0].dataset.markdownGapOffset, '1');
  assert.equal(
    trailingLines[0].firstChild.dataset.markdownSourceBreak,
    undefined,
    'the terminal caret placeholder must not serialize as another newline'
  );
  const terminalPoint = view.semanticDomPointAtOffset(trailing.root, source.length);
  assert.equal(terminalPoint.node, trailingLines[0]);
  assert.equal(terminalPoint.offset, 0);
  assert.equal(view.semanticSourceFromNode(trailing.blocks[0].element), source);
});

test('physical source-line starts have distinct DOM owners across exact newline fixtures', () => {
  const view = loadMarkdownPageViewModel();
  const fixtures = [
    { source: 'A\nB', blankOwners: [] },
    { source: 'A\n\nB', blankOwners: [[2, 3]] },
    { source: 'A\n\n\nB', blankOwners: [[2, 3], [3, 4]] },
    { source: '\nA', blankOwners: [[0, 1]] },
    { source: 'A\n', blankOwners: [[2, 2]] },
    { source: 'A\n\n', blankOwners: [[2, 3], [3, 3]] }
  ];

  fixtures.forEach(({ source, blankOwners }) => {
    const rendered = renderSemanticRoot(view, source);
    const lines = elementsWithClass(rendered.root, 'markdown-source-gap-line');
    assert.deepEqual(
      lines.map((line) => [
        Number(line.dataset.markdownSourceStart),
        Number(line.dataset.markdownSourceEnd)
      ]),
      blankOwners,
      JSON.stringify(source)
    );
    assert.equal(view.semanticSourceFromNode(rendered.root), source, JSON.stringify(source));
    lines.forEach((line) => {
      const offset = Number(line.dataset.markdownSourceStart);
      const point = view.semanticDomPointAtOffset(rendered.root, offset);
      assert.equal(
        pointElement(point),
        line,
        `${JSON.stringify(source)} offset ${offset} must restore to its physical row`
      );
    });
  });
});

test('source-mode quote padding offsets restore to the same canonical position', () => {
  const view = loadMarkdownPageViewModel();
  const source = '>>>  \n>>>   A';
  const { root } = renderSemanticRoot(view, source);

  for (const offset of [10, 11, 12]) {
    const point = view.semanticDomPointAtOffset(root, offset);
    assert.ok(point?.node, `offset ${offset} has a DOM point`);
    assert.equal(
      view.semanticOffsetAtDomPoint(root, point.node, point.offset),
      offset,
      `offset ${offset} survives source-to-DOM-to-source mapping`
    );
  }
});

test('the exact inter-block blank row owns edits at canonical offset four', () => {
  const view = loadMarkdownPageViewModel();
  const source = 'AAA\n\nBBB';
  const rendered = renderSemanticRoot(view, source);
  const blankLine = elementsWithClass(rendered.root, 'markdown-source-gap-line')[0];

  assert.ok(blankLine);
  assert.equal(blankLine.dataset.markdownSourceStart, '4');
  assert.equal(blankLine.dataset.markdownSourceEnd, '5');
  assert.equal(pointElement(view.semanticDomPointAtOffset(rendered.root, 4)), blankLine);
  assert.equal(replaceRange(source, 4, 4, 'X'), 'AAA\nX\nBBB');

  const entered = markdown.applyMarkdownNewline(source, { anchor: 4, focus: 4 });
  assert.equal(entered.source, 'AAA\n\n\nBBB');
  assert.deepEqual(entered.selection, { anchor: 5, focus: 5 });
  assert.equal(replaceRange(source, 3, 4, ''), 'AAA\nBBB');
  assert.equal(replaceRange(source, 4, 5, ''), 'AAA\nBBB');
});

test('inter-block source gaps consume one structural newline and no more', () => {
  const view = loadMarkdownPageViewModel();

  assert.deepEqual(
    JSON.parse(JSON.stringify(view.editableSourceGapLayout('\n', { betweenBlocks: true }))),
    {
      source: '\n',
      structuralLength: 1,
      visibleSource: '',
      visibleBlankLines: 0,
      visibleLineOffsets: []
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(view.editableSourceGapLayout('\n\n', { betweenBlocks: true }))),
    {
      source: '\n\n',
      structuralLength: 1,
      visibleSource: '\n',
      visibleBlankLines: 1,
      visibleLineOffsets: [1]
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(view.editableSourceGapLayout('\n\n\n', { betweenBlocks: true }))),
    {
      source: '\n\n\n',
      structuralLength: 1,
      visibleSource: '\n\n',
      visibleBlankLines: 2,
      visibleLineOffsets: [1, 2]
    }
  );
});

test('Enter and Shift+Enter use one canonical soft newline under the certified default', () => {
  const selection = { anchor: 0, focus: 0 };
  assert.equal(markdown.applyMarkdownNewline('', selection).replacement, '\n');
  assert.equal(markdown.applyMarkdownNewline('', selection, {
    inputType: 'insertLineBreak'
  }).replacement, '\n');
});

test('beforeinput-only paragraph and line-break actions use the canonical newline transaction', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );
  const listenerStart = source.indexOf("bodyRoot.addEventListener('beforeinput'");
  const inputStart = source.indexOf("bodyRoot.addEventListener('input'", listenerStart);
  assert.notEqual(listenerStart, -1);
  assert.notEqual(inputStart, -1);
  const branch = source.slice(listenerStart, inputStart);
  const compositionGuard = branch.indexOf('isImeCompositionOwnedKeyEvent');
  const newlineBranch = branch.indexOf(
    "event.inputType === 'insertParagraph'",
    compositionGuard + 'isImeCompositionOwnedKeyEvent'.length
  );
  const preventDefault = branch.indexOf('event.preventDefault();');
  assert.ok(compositionGuard >= 0 && compositionGuard < newlineBranch,
    'the shared IME owner classifies a composition-ending newline before its command branch');
  assert.ok(compositionGuard < preventDefault,
    'an IME-owned newline returns before Viewer cancellation');
  assert.match(branch, /event\.inputType === 'insertParagraph' \|\| event\.inputType === 'insertLineBreak'/);
  assert.match(branch, /event\.preventDefault\(\);[^]*?applySemanticNewlineInput\(state/);
  assert.match(branch, /semanticNewlineKeydownGuard[^]*?state\.semanticNewlineKeydownGuard = null;[^]*?return;/);
});

test('Enter, typing, Backspace, Undo, and Redo preserve exact newline offsets', () => {
  const view = loadMarkdownPageViewModel();
  const original = '第一行第二行';
  const splitOffset = 3;
  const newline = markdown.applyMarkdownNewline(original, {
    anchor: splitOffset,
    focus: splitOffset
  }).replacement;
  const split = replaceRange(original, splitOffset, splitOffset, newline);
  const lineTwoOffset = splitOffset + newline.length;

  assert.equal(newline, '\n');
  assert.equal(split, '第一行\n第二行');
  assert.equal(lineTwoOffset, 4);
  assert.deepEqual(plain(view.sourceDifference(original, split)), {
    start: splitOffset,
    previousEnd: splitOffset,
    nextEnd: lineTwoOffset,
    delta: 1,
    changed: true
  });
  assert.equal(
    view.semanticSyntaxSegments({ body: original }).length,
    view.semanticSyntaxSegments({ body: split }).length,
    'splitting an ordinary paragraph keeps one semantic block for local reconciliation'
  );
  assert.equal(replaceRange(split, lineTwoOffset, lineTwoOffset, '新'), '第一行\n新第二行');
  assert.equal(replaceRange(split, splitOffset, lineTwoOffset, ''), original);

  const history = view.createMarkdownEditHistory(original);
  view.recordMarkdownEditTransaction(history, {
    beforeSource: original,
    afterSource: split,
    beforeSelection: { anchor: splitOffset, focus: splitOffset },
    afterSelection: { anchor: lineTwoOffset, focus: lineTwoOffset },
    inputType: 'insertParagraph',
    timestamp: 1
  });
  const undoSplit = view.stepMarkdownEditHistory(history, 'undo', split);
  assert.equal(undoSplit.source, original);
  assert.deepEqual({ ...undoSplit.selection }, { anchor: splitOffset, focus: splitOffset });
  const redoSplit = view.stepMarkdownEditHistory(history, 'redo', original);
  assert.equal(redoSplit.source, split);
  assert.deepEqual({ ...redoSplit.selection }, { anchor: lineTwoOffset, focus: lineTwoOffset });

  const merged = replaceRange(split, splitOffset, lineTwoOffset, '');
  view.recordMarkdownEditTransaction(history, {
    beforeSource: split,
    afterSource: merged,
    beforeSelection: { anchor: lineTwoOffset, focus: lineTwoOffset },
    afterSelection: { anchor: splitOffset, focus: splitOffset },
    inputType: 'deleteContentBackward',
    timestamp: 2
  });
  assert.equal(merged, original);
  assert.deepEqual(plain(view.sourceDifference(split, merged)), {
    start: splitOffset,
    previousEnd: lineTwoOffset,
    nextEnd: splitOffset,
    delta: -1,
    changed: true
  });
  const undoMerge = view.stepMarkdownEditHistory(history, 'undo', merged);
  assert.equal(undoMerge.source, split);
  assert.deepEqual({ ...undoMerge.selection }, { anchor: lineTwoOffset, focus: lineTwoOffset });
  const redoMerge = view.stepMarkdownEditHistory(history, 'redo', split);
  assert.equal(redoMerge.source, original);
  assert.deepEqual({ ...redoMerge.selection }, { anchor: splitOffset, focus: splitOffset });
});

test('browser placeholder BR nodes do not become canonical newlines', () => {
  const view = loadMarkdownPageViewModel();
  assert.equal(typeof view.semanticSourceFromNode, 'function');

  const browserPlaceholder = new FakeElement({ dataset: {} });
  const rendererOwned = new FakeElement({
    dataset: { markdownSourceBreak: 'true' }
  });
  const sourceMapped = new FakeElement({
    dataset: {
      markdownSourceStart: '4',
      markdownSourceEnd: '5'
    }
  });

  assert.equal(view.semanticSourceFromNode(browserPlaceholder), '');
  assert.equal(view.semanticSourceFromNode(rendererOwned), '\n');
  assert.equal(view.semanticSourceFromNode(sourceMapped), '\n');
});

test('trusted text input is owned before Chromium can mutate hidden source boundaries', () => {
  const view = loadMarkdownPageViewModel();
  const insert = (data, extra = {}) => view.exactSemanticTextInsertion({
    inputType: 'insertText',
    data,
    cancelable: true,
    ...extra
  });

  assert.equal(insert(' '), ' ');
  assert.equal(insert('\u00a0'), '\u00a0');
  assert.equal(insert('x'), 'x');
  assert.equal(insert('星'), '星');
  assert.equal(insert(' ', { cancelable: false }), null);
  assert.equal(insert(' ', { isComposing: true }), null);
  assert.equal(insert(' ', { inputType: 'insertFromPaste' }), null);
});

test('captured O1 Markdown auto-pairs only at non-word boundaries', () => {
  const view = loadMarkdownPageViewModel();
  const insert = (source, offset, text) => JSON.parse(JSON.stringify(
    view.markdownTextInsertionEdit(
      source,
      { anchor: offset, focus: offset },
      text
    )
  ));

  assert.deepEqual(insert('```js\n\n```', 6, '*'), {
    changed: true,
    source: '```js\n**\n```',
    start: 6,
    end: 6,
    replacement: '**',
    selection: { anchor: 7, focus: 7 },
    autoPaired: true
  });
  assert.equal(insert('```js \n', 7, '`').source, '```js \n``');
  assert.equal(insert('    \n    *Setext one', 9, '*').source, '    \n    ***Setext one');

  const atWordStart = insert('Setext one', 0, '*');
  assert.equal(atWordStart.source, '*Setext one');
  assert.equal(atWordStart.autoPaired, false);
  const closingEmphasis = insert('- A\n  - \n  - `B\n    - C', 15, '*');
  assert.equal(closingEmphasis.source, '- A\n  - \n  - `B*\n    - C');
  assert.equal(closingEmphasis.selection.anchor, 16);
  assert.equal(closingEmphasis.autoPaired, false);
});

test('exact text insertion stays on canonical nested-list boundaries', () => {
  const view = loadMarkdownPageViewModel();
  const spaceIndented = '- A\n  - \n  - `B\n    - C';
  const star = view.markdownTextInsertionEdit(
    spaceIndented,
    { anchor: 15, focus: 15 },
    '*'
  );
  assert.equal(star.source, '- A\n  - \n  - `B*\n    - C');
  assert.deepEqual({ ...star.selection }, { anchor: 16, focus: 16 });

  const tabIndented = '- A\n\t-   \n\t\t- C';
  const letter = view.markdownTextInsertionEdit(
    tabIndented,
    { anchor: 9, focus: 9 },
    'A'
  );
  assert.equal(letter.source, '- A\n\t-   A\n\t\t- C');
  assert.deepEqual({ ...letter.selection }, { anchor: 10, focus: 10 });
});

test('source-marker deletion owns the canonical caret after removing a link opener', () => {
  const view = loadMarkdownPageViewModel();
  const source = '[Example Domain](https://example.com/docs?q=1)';
  const rendered = renderSemanticRoot(view, source);
  const markerRanges = view.markdownSourceMarkerRanges(rendered.root);
  assert.ok(markerRanges.some(({ start, end }) => start === 0 && end === 1));
  const result = view.markdownMarkerDeletionEdit(
    source,
    { anchor: 1, focus: 1 },
    'backward',
    markerRanges
  );
  assert.equal(result.source, 'Example Domain](https://example.com/docs?q=1)');
  assert.deepEqual({ ...result.selection }, { anchor: 0, focus: 0 });
  assert.equal(result.editKind, 'source-marker');
  assert.equal(view.markdownMarkerDeletionEdit(
    source,
    { anchor: 2, focus: 2 },
    'backward',
    [{ start: 0, end: 1 }]
  ), null);
});
