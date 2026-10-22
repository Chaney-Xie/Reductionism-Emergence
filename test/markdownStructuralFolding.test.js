const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

const selectionProbe = { reads: 0 };
const view = loadMarkdownPageViewInternals([
  'applyMarkdownStructuralFolding',
  'createMarkdownStructuralFoldControl',
  'ensureEditableSelectionVisible',
  'markdownStructuralVisiblePosition',
  'refreshMarkdownStructuralFoldGeometry',
  'readingMarkdownStructuralListMarkerCharacters',
  'reconcileMarkdownStructuralFoldState',
  'toggleMarkdownStructuralFold'
], {
  window: {
    getSelection() {
      selectionProbe.reads += 1;
      return null;
    }
  }
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function ownerSummary(owner) {
  return {
    kind: owner.kind,
    lineIndex: owner.lineIndex,
    endLineIndex: owner.endLineIndex,
    depth: owner.depth,
    listKind: owner.listKind || null,
    hiddenStartLineIndex: owner.hiddenStartLineIndex,
    hiddenEndLineIndex: owner.hiddenEndLineIndex,
    foldable: owner.foldable
  };
}

function element(tagName, className, start, end) {
  const result = new FakeElement({ tagName });
  result.className = className || '';
  result.hidden = false;
  if (Number.isFinite(start)) result.dataset.markdownSourceStart = String(start);
  if (Number.isFinite(end)) result.dataset.markdownSourceEnd = String(end);
  return result;
}

function controls(root) {
  return descendants(root).filter((node) => (
    node?.nodeType === 1
      && node.classList.contains('markdown-structural-fold-control')
  ));
}

function fire(elementValue, type, overrides = {}) {
  const calls = { preventDefault: 0, stopPropagation: 0, stopImmediatePropagation: 0 };
  const event = {
    button: 0,
    target: elementValue,
    preventDefault() {
      calls.preventDefault += 1;
    },
    stopPropagation() {
      calls.stopPropagation += 1;
    },
    stopImmediatePropagation() {
      calls.stopImmediatePropagation += 1;
    },
    ...overrides
  };
  (elementValue.listeners.get(type) || []).forEach((listener) => listener(event));
  return { event, calls };
}

function baseFoldState(source, mode, bodyRoot, descriptors = []) {
  const foldNotifications = [];
  return {
    body: source,
    page: { id: 'page-fold-test', markdownBody: source },
    sourceSnapshot: markdown.createSourceSnapshot(source),
    bodyRoot,
    editableProjection: null,
    mode,
    paneId: 'pane-test',
    tabId: 'tab-test',
    markdownFoldDescriptors: plain(descriptors),
    markdownFoldCollapsedKeys: new Set(),
    markdownFoldIndex: null,
    markdownFoldVisibility: null,
    editHistory: view.createMarkdownEditHistory(source),
    foldNotifications,
    onFoldStateChange(detail) {
      foldNotifications.push(plain(detail));
    }
  };
}

function editableRowsState(source, mode = 'live-preview', descriptors = []) {
  const bodyRoot = new FakeElement({ tagName: 'main' });
  const state = baseFoldState(source, mode, bodyRoot, descriptors);
  const rows = state.sourceSnapshot.physicalLineIndex.lines.map((line) => {
    const row = element(
      'div',
      'markdown-editable-physical-row',
      line.start,
      line.sourceEnd
    );
    row.dataset.physicalLineId = line.id;
    bodyRoot.append(row);
    return { index: line.index, physicalLineId: line.id, element: row };
  });
  const declaredPositions = [];
  for (let offset = 0; offset <= source.length; offset += 1) {
    const line = state.sourceSnapshot.physicalLineIndex.lineAtOffset(offset, 'after');
    declaredPositions.push({
      offset,
      affinity: 'after',
      physicalLineId: line.id,
      sourceVersion: state.sourceSnapshot.version
    });
  }
  const projection = {
    projectionSelection: null,
    restoredSelection: null,
    enumeratePhysicalRows() {
      return rows;
    },
    enumerateDeclaredPositions() {
      return declaredPositions;
    },
    snapshot() {
      return state.sourceSnapshot;
    },
    getSelection() {
      return projection.projectionSelection;
    },
    restoreSelection(selection) {
      projection.restoredSelection = selection;
      projection.projectionSelection = selection;
      return true;
    }
  };
  state.editableProjection = projection;
  return { state, rows, bodyRoot };
}

function descriptor(owner) {
  return {
    kind: owner.kind,
    physicalLineId: owner.physicalLineId,
    lineIndex: owner.lineIndex,
    depth: owner.depth
  };
}

test('fold descriptors validate, de-duplicate, clone, and cap pane-local state', () => {
  const source = [{
    kind: 'heading',
    physicalLineId: 'physical-line-7',
    lineIndex: 7,
    depth: 2
  }, {
    kind: 'heading',
    physicalLineId: 'physical-line-7',
    lineIndex: 99,
    depth: 6
  }, {
    kind: 'list',
    physicalLineId: '',
    lineIndex: 4,
    depth: 0
  }, {
    kind: 'paragraph',
    physicalLineId: 'ignored',
    lineIndex: 0,
    depth: 1
  }, {
    kind: 'list',
    physicalLineId: null,
    lineIndex: -1,
    depth: 2
  }, null];

  const normalized = plain(view.normalizeMarkdownStructuralFoldDescriptors({ folds: source }));
  assert.deepEqual(normalized, [{
    kind: 'heading',
    physicalLineId: 'physical-line-7',
    lineIndex: 7,
    depth: 2
  }, {
    kind: 'list',
    physicalLineId: null,
    lineIndex: 4,
    depth: 1
  }]);
  assert.notEqual(normalized, source);
  assert.notEqual(normalized[0], source[0]);

  source[0].physicalLineId = 'mutated-after-normalization';
  assert.equal(normalized[0].physicalLineId, 'physical-line-7');

  const oversized = Array.from({ length: 2105 }, (_unused, lineIndex) => ({
    kind: lineIndex % 2 ? 'list' : 'heading',
    physicalLineId: null,
    lineIndex,
    depth: 1
  }));
  assert.equal(view.normalizeMarkdownStructuralFoldDescriptors(oversized).length, 2000);
});

test('ATX heading ranges honor level boundaries and exact document end', () => {
  const source = [
    '# A',
    'intro',
    '## B',
    'b',
    '### C',
    'c',
    '## D',
    'd',
    '# E',
    'e'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const owners = view.markdownHeadingFoldOwners(snapshot).map(ownerSummary);

  assert.deepEqual(plain(owners), [
    {
      kind: 'heading', lineIndex: 0, endLineIndex: 0, depth: 1, listKind: null,
      hiddenStartLineIndex: 1, hiddenEndLineIndex: 8, foldable: true
    },
    {
      kind: 'heading', lineIndex: 2, endLineIndex: 2, depth: 2, listKind: null,
      hiddenStartLineIndex: 3, hiddenEndLineIndex: 6, foldable: true
    },
    {
      kind: 'heading', lineIndex: 4, endLineIndex: 4, depth: 3, listKind: null,
      hiddenStartLineIndex: 5, hiddenEndLineIndex: 6, foldable: true
    },
    {
      kind: 'heading', lineIndex: 6, endLineIndex: 6, depth: 2, listKind: null,
      hiddenStartLineIndex: 7, hiddenEndLineIndex: 8, foldable: true
    },
    {
      kind: 'heading', lineIndex: 8, endLineIndex: 8, depth: 1, listKind: null,
      hiddenStartLineIndex: 9, hiddenEndLineIndex: 10, foldable: true
    }
  ]);
  assert.equal(snapshot.physicalLineIndex.lines.length, 10);
  assert.equal(source.slice(
    snapshot.physicalLineIndex.lines[3].start,
    snapshot.physicalLineIndex.lines[6].start
  ), 'b\n### C\nc\n');

  const leaf = view.markdownHeadingFoldOwners(
    markdown.createSourceSnapshot('## Alone')
  )[0];
  assert.equal(leaf.foldable, false);
  assert.equal(leaf.hiddenStartLineIndex, leaf.hiddenEndLineIndex);

  const trailing = view.markdownHeadingFoldOwners(
    markdown.createSourceSnapshot('# Tail\nchild\n')
  )[0];
  assert.equal(trailing.foldable, true);
  assert.equal(trailing.hiddenEndLineIndex, 3, 'a real EOF descendant also hides the terminal row');
  assert.equal(
    view.markdownHeadingFoldOwners(markdown.createSourceSnapshot('# Tail\n'))[0].foldable,
    false,
    'a synthetic terminal row alone is not a foldable descendant'
  );
});

test('Setext headings own both physical rows and fold only after the underline', () => {
  const source = [
    'Top',
    '===',
    'lead',
    '',
    'Sub',
    '---',
    'tail',
    '# Next'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const owners = view.markdownHeadingFoldOwners(snapshot);

  assert.deepEqual(plain(owners.map(ownerSummary)), [
    {
      kind: 'heading', lineIndex: 0, endLineIndex: 1, depth: 1, listKind: null,
      hiddenStartLineIndex: 2, hiddenEndLineIndex: 7, foldable: true
    },
    {
      kind: 'heading', lineIndex: 4, endLineIndex: 5, depth: 2, listKind: null,
      hiddenStartLineIndex: 6, hiddenEndLineIndex: 7, foldable: true
    },
    {
      kind: 'heading', lineIndex: 7, endLineIndex: 7, depth: 1, listKind: null,
      hiddenStartLineIndex: 8, hiddenEndLineIndex: 8, foldable: false
    }
  ]);
  assert.equal(owners[0].hiddenStartOffset, snapshot.physicalLineIndex.lines[2].start);
  assert.equal(owners[1].hiddenStartOffset, snapshot.physicalLineIndex.lines[6].start);
});

test('one strict resolver covers ordered, unordered, and task subtrees and stops on exit', () => {
  const source = [
    '1. Ordered parent',
    '\t- Unordered child',
    '\t\t- [ ] Task grandchild',
    '\t2. Ordered child',
    '2. Ordered next',
    'ordinary',
    '- Unordered parent',
    '\t1. Ordered child',
    'not a list',
    '\t- Orphan after subtree exit',
    '- [x] Task parent',
    '\t- [ ] Task child',
    '- Next',
    '    - four-space indentation is not editable-list grammar',
    '* star is not editable-list grammar',
    '+ plus is not editable-list grammar'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const owners = view.markdownListFoldOwners(snapshot);
  const byLine = new Map(owners.map((owner) => [owner.lineIndex, owner]));

  assert.deepEqual([...byLine.keys()], [0, 1, 2, 3, 4, 6, 7, 9, 10, 11, 12]);
  assert.deepEqual(plain(ownerSummary(byLine.get(0))), {
    kind: 'list', lineIndex: 0, endLineIndex: 0, depth: 1, listKind: 'ordered',
    hiddenStartLineIndex: 1, hiddenEndLineIndex: 4, foldable: true
  });
  assert.deepEqual(plain(ownerSummary(byLine.get(1))), {
    kind: 'list', lineIndex: 1, endLineIndex: 1, depth: 2, listKind: 'unordered',
    hiddenStartLineIndex: 2, hiddenEndLineIndex: 3, foldable: true
  });
  assert.equal(byLine.get(2).listKind, 'task');
  assert.equal(byLine.get(2).task, true);
  assert.equal(byLine.get(6).hiddenStartLineIndex, 7);
  assert.equal(byLine.get(6).hiddenEndLineIndex, 8, 'ordinary text exits the subtree');
  assert.equal(byLine.get(9).depth, 2, 'strict recognized rows remain metadata owners');
  assert.equal(byLine.get(10).listKind, 'task');
  assert.equal(byLine.get(10).hiddenStartLineIndex, 11);
  assert.equal(byLine.get(10).hiddenEndLineIndex, 12);
  assert.equal(byLine.has(13), false);
  assert.equal(byLine.has(14), false);
  assert.equal(byLine.has(15), false);

  const trailing = view.markdownListFoldOwners(
    markdown.createSourceSnapshot('- Parent\n\t- Child\n')
  )[0];
  assert.equal(trailing.foldable, true);
  assert.equal(trailing.hiddenEndLineIndex, 3, 'list subtrees include a synthetic EOF row only after a real child');
  assert.equal(
    view.markdownListFoldOwners(markdown.createSourceSnapshot('- Parent\n'))[0].foldable,
    false
  );
});

test('physical owner identity survives ordinary edits and disappears when syntax is destroyed', () => {
  const firstSource = '# Stable title\nbody\n\n1. Parent\n\t- Child';
  const first = markdown.createSourceSnapshot(firstSource);
  const firstIndex = view.buildMarkdownStructuralFoldIndex(first);
  const firstHeading = firstIndex.owners.find((owner) => owner.kind === 'heading');
  const firstList = firstIndex.owners.find((owner) => owner.kind === 'list' && owner.depth === 1);

  const editedSource = '# Renamed title\nbody changed\n\n1. Parent renamed\n\t- Child';
  const edited = markdown.createSourceSnapshot(editedSource, { previousSnapshot: first });
  const editedIndex = view.buildMarkdownStructuralFoldIndex(edited);
  const editedHeading = editedIndex.owners.find((owner) => owner.kind === 'heading');
  const editedList = editedIndex.owners.find((owner) => owner.kind === 'list' && owner.depth === 1);

  assert.equal(editedHeading.physicalLineId, firstHeading.physicalLineId);
  assert.equal(editedList.physicalLineId, firstList.physicalLineId);
  assert.notEqual(editedSource, firstSource, 'identity is not bound to visible title text');

  const destroyed = markdown.createSourceSnapshot(
    'Stable title\nbody changed\n\nParent renamed\n\t- Child',
    { previousSnapshot: edited }
  );
  const destroyedIndex = view.buildMarkdownStructuralFoldIndex(destroyed);
  assert.equal(
    destroyedIndex.byPhysicalIdentity.has(`heading:${firstHeading.physicalLineId}`),
    false
  );
  assert.equal(
    destroyedIndex.byPhysicalIdentity.has(`list:${firstList.physicalLineId}`),
    false
  );
});

test('first hydration resolves persisted folds by line/depth before adopting runtime IDs', () => {
  const snapshot = markdown.createSourceSnapshot('# Wrong\nwrong child\n# Intended\nintended child');
  const index = view.buildMarkdownStructuralFoldIndex(snapshot);
  const wrong = index.foldableOwners.find((owner) => owner.lineIndex === 0);
  const intended = index.foldableOwners.find((owner) => owner.lineIndex === 2);
  const notifications = [];
  const state = {
    sourceSnapshot: snapshot,
    markdownFoldDescriptors: [{
      kind: 'heading',
      physicalLineId: wrong.physicalLineId,
      lineIndex: intended.lineIndex,
      depth: intended.depth
    }],
    markdownFoldCollapsedKeys: new Set(),
    markdownFoldIndex: null,
    onFoldStateChange(detail) {
      notifications.push(plain(detail));
    }
  };

  view.reconcileMarkdownStructuralFoldState(state);
  assert.deepEqual(plain(state.markdownFoldDescriptors), [descriptor(intended)]);
  assert.deepEqual([...state.markdownFoldCollapsedKeys], [intended.key]);
  assert.equal(notifications.length, 1, 'hydration publishes the adopted runtime identity');
});

test('a collapsed owner remains dormant while temporarily leaf and survives another toggle', () => {
  const initial = markdown.createSourceSnapshot([
    '# Dormant',
    'temporary child',
    '# Active',
    'active child'
  ].join('\n'));
  const initialIndex = view.buildMarkdownStructuralFoldIndex(initial);
  const dormant = initialIndex.foldableOwners.find((owner) => owner.lineIndex === 0);
  const edited = markdown.createSourceSnapshot([
    '# Dormant',
    '# Active',
    'active child'
  ].join('\n'), { previousSnapshot: initial });
  const bodyRoot = new FakeElement({ tagName: 'main' });
  const state = {
    body: edited.markdownBody,
    page: { id: 'page-dormant', markdownBody: edited.markdownBody },
    sourceSnapshot: edited,
    bodyRoot,
    mode: 'source',
    editableProjection: null,
    markdownFoldDescriptors: [descriptor(dormant)],
    markdownFoldCollapsedKeys: new Set(),
    markdownFoldIndex: initialIndex,
    markdownFoldVisibility: null,
    foldNotifications: [],
    onFoldStateChange(detail) {
      state.foldNotifications.push(plain(detail));
    }
  };

  const editedIndex = view.reconcileMarkdownStructuralFoldState(state, { notify: false });
  const dormantNow = editedIndex.owners.find((owner) => (
    owner.kind === 'heading' && owner.physicalLineId === dormant.physicalLineId
  ));
  const active = editedIndex.foldableOwners.find((owner) => owner.lineIndex === 1);
  assert.ok(dormantNow);
  assert.equal(dormantNow.foldable, false);
  assert.deepEqual(plain(state.markdownFoldDescriptors), [descriptor(dormantNow)]);

  assert.equal(view.toggleMarkdownStructuralFold(state, active.key, true), true);
  assert.deepEqual(
    plain(state.markdownFoldDescriptors),
    [descriptor(dormantNow), descriptor(active)],
    'toggling another owner does not discard dormant state'
  );

  state.sourceSnapshot = markdown.createSourceSnapshot(initial.markdownBody, {
    previousSnapshot: edited
  });
  state.body = initial.markdownBody;
  const restoredIndex = view.reconcileMarkdownStructuralFoldState(state, { notify: false });
  const restoredDormant = restoredIndex.owners.find((owner) => (
    owner.kind === 'heading' && owner.physicalLineId === dormant.physicalLineId
  ));
  assert.equal(restoredDormant.foldable, true);
  assert.equal(state.markdownFoldCollapsedKeys.has(restoredDormant.key), true);
});

test('nested collapsed state composes without erasing hidden descendant owners', () => {
  const source = [
    '- Outer',
    '\t- Inner',
    '\t\t- Grandchild',
    '- Next'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const index = view.buildMarkdownStructuralFoldIndex(snapshot);
  const outer = index.owners.find((owner) => owner.kind === 'list' && owner.lineIndex === 0);
  const inner = index.owners.find((owner) => owner.kind === 'list' && owner.lineIndex === 1);

  const both = view.deriveMarkdownStructuralFoldVisibility(
    index,
    new Set([outer.key, inner.key])
  );
  assert.deepEqual([...both.hiddenLineIndices].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(plain(both.collapsed.map((owner) => owner.key)), [outer.key, inner.key]);
  assert.deepEqual(
    plain(both.hiddenByLineIndex.get(2).map((owner) => owner.key)),
    [outer.key, inner.key]
  );

  const afterOuterExpand = view.deriveMarkdownStructuralFoldVisibility(
    index,
    new Set([inner.key])
  );
  assert.deepEqual([...afterOuterExpand.hiddenLineIndices], [2]);
  assert.deepEqual(plain(afterOuterExpand.collapsed.map((owner) => owner.key)), [inner.key]);
});

test('range/index derivation is presentation-only and leaves canonical structures byte-identical', () => {
  const source = '# H\r\ntext\r\n1. Parent\r\n\t- Child';
  const snapshot = markdown.createSourceSnapshot(source);
  const before = {
    markdownBody: snapshot.markdownBody,
    lines: snapshot.physicalLineIndex.lines.map((line) => ({
      id: line.id,
      text: line.text,
      lineEnding: line.lineEnding,
      start: line.start,
      sourceEnd: line.sourceEnd
    })),
    syntaxTree: JSON.stringify(snapshot.syntaxTree)
  };

  const index = view.buildMarkdownStructuralFoldIndex(snapshot);
  view.deriveMarkdownStructuralFoldVisibility(
    index,
    new Set(index.foldableOwners.map((owner) => owner.key))
  );

  assert.equal(snapshot.markdownBody, source);
  assert.equal(snapshot.markdownBody, before.markdownBody);
  assert.deepEqual(plain(snapshot.physicalLineIndex.lines.map((line) => ({
    id: line.id,
    text: line.text,
    lineEnding: line.lineEnding,
    start: line.start,
    sourceEnd: line.sourceEnd
  }))), before.lines);
  assert.equal(JSON.stringify(snapshot.syntaxTree), before.syntaxTree);
});

test('Reading heading click and the shared hover disclosure both toggle without source history', () => {
  const source = '# Heading\nfolded paragraph';
  const snapshot = markdown.createSourceSnapshot(source);
  const line0 = snapshot.physicalLineIndex.lines[0];
  const line1 = snapshot.physicalLineIndex.lines[1];
  const bodyRoot = new FakeElement({ tagName: 'main' });
  const heading = element('h1', 'markdown-page-heading', line0.start, line0.contentEnd);
  const paragraph = element('p', 'markdown-page-paragraph', line1.start, line1.contentEnd);
  heading.textContent = 'Heading';
  paragraph.textContent = 'folded paragraph';
  bodyRoot.append(heading, paragraph);
  const state = baseFoldState(source, 'reading', bodyRoot);
  state.sourceSnapshot = snapshot;
  const historyBefore = JSON.stringify(state.editHistory);
  const selectionReadsBefore = selectionProbe.reads;

  view.applyMarkdownStructuralFolding(state);
  assert.equal(controls(bodyRoot).length, 1, 'one expanded hover disclosure is mounted out of flow');
  assert.equal(controls(bodyRoot)[0].attributes['aria-expanded'], 'true');
  assert.equal(controls(bodyRoot)[0].tabIndex, -1, 'the invisible hover target is not tabbable');
  assert.equal(controls(bodyRoot)[0].attributes['aria-label'], 'Collapse expanded heading');
  assert.equal(heading.listeners.get('click')?.length, 1);

  const collapseEvent = fire(heading, 'click');
  assert.deepEqual(collapseEvent.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 1
  });
  assert.equal(paragraph.hidden, true);
  assert.equal(paragraph.classList.contains('is-markdown-structural-fold-hidden'), true);
  assert.equal(state.markdownFoldDescriptors.length, 1);
  assert.equal(state.foldNotifications.length, 1);
  assert.equal(controls(bodyRoot).length, 1);
  assert.equal(
    selectionProbe.reads,
    selectionReadsBefore + 1,
    'Reading collapse inspects Selection before hiding descendants'
  );

  const control = controls(bodyRoot)[0];
  assert.equal(control.tagName, 'BUTTON');
  assert.equal(control.classList.contains('nav-folder-disclosure-button'), true);
  assert.equal(control.attributes['aria-expanded'], 'false');
  assert.equal(control.tabIndex, 0, 'the persistent collapsed disclosure remains keyboard reachable');
  assert.equal(control.dataset.markdownSourceStart, undefined);
  assert.equal(control.dataset.markdownSourceEnd, undefined);
  assert.equal(control.textContent, '');
  assert.equal(control.children.length, 1);
  assert.equal(control.children[0].classList.contains('nav-folder-disclosure'), true);
  assert.equal(control.children[0].classList.contains('disclosure-chevron'), true);
  assert.equal(control.listeners.get('pointerdown')?.length, 1);
  assert.equal(control.listeners.get('mousedown')?.length, 1);

  const selectionReadsBeforeExpand = selectionProbe.reads;
  const expandEvent = fire(control, 'click');
  assert.deepEqual(expandEvent.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 1
  });
  assert.equal(paragraph.hidden, false);
  assert.equal(controls(bodyRoot).length, 1);
  assert.equal(controls(bodyRoot)[0].attributes['aria-expanded'], 'true');
  assert.deepEqual(plain(state.markdownFoldDescriptors), []);
  assert.equal(state.foldNotifications.length, 2);
  assert.equal(state.body, source);
  assert.equal(state.page.markdownBody, source);
  assert.equal(state.sourceSnapshot.markdownBody, source);
  assert.equal(JSON.stringify(state.editHistory), historyBefore, 'folding creates no Undo entry');
  assert.equal(
    selectionProbe.reads,
    selectionReadsBeforeExpand,
    'the expand arrow leaves Selection untouched'
  );
});

test('Reading collapse relocates descendant and crossing DOM ranges while expand preserves them', () => {
  ['inside', 'crossing'].forEach((selectionKind) => {
    const source = '# Heading\nhidden paragraph\n# Next';
    const snapshot = markdown.createSourceSnapshot(source);
    const lines = snapshot.physicalLineIndex.lines;
    const bodyRoot = new FakeElement({ tagName: 'main' });
    const heading = element('h1', 'markdown-page-heading', lines[0].start, lines[0].contentEnd);
    const paragraph = element(
      'p',
      'markdown-page-paragraph',
      lines[1].start,
      lines[1].contentEnd
    );
    const next = element('h1', 'markdown-page-heading', lines[2].start, lines[2].contentEnd);
    heading.textContent = 'Heading';
    paragraph.textContent = 'hidden paragraph';
    next.textContent = 'Next';
    bodyRoot.append(heading, paragraph, next);
    const outsideTitle = element('h1', 'markdown-page-title');
    outsideTitle.textContent = 'Outside title';

    const selection = {
      rangeCount: 1,
      anchorNode: selectionKind === 'inside' ? paragraph.firstChild : outsideTitle.firstChild,
      anchorOffset: 1,
      focusNode: selectionKind === 'inside' ? paragraph.firstChild : next.firstChild,
      focusOffset: 2,
      reads: 0,
      removed: 0,
      added: 0,
      currentRange: {
        intersectsNode(node) {
          return node === paragraph;
        }
      },
      getRangeAt() {
        return this.currentRange;
      },
      removeAllRanges() {
        this.removed += 1;
      },
      addRange(range) {
        this.added += 1;
        this.currentRange = range;
        this.anchorNode = range.selectedNode;
        this.anchorOffset = 0;
        this.focusNode = range.selectedNode;
        this.focusOffset = 0;
      }
    };
    const selectionView = loadMarkdownPageViewInternals(['applyMarkdownStructuralFolding'], {
      window: {
        getSelection() {
          selection.reads += 1;
          return selection;
        }
      },
      document: {
        createRange() {
          return {
            selectedNode: null,
            collapsed: false,
            selectNodeContents(node) {
              this.selectedNode = node;
            },
            collapse(value) {
              this.collapsed = value;
            }
          };
        }
      }
    });
    const state = baseFoldState(source, 'reading', bodyRoot);
    state.sourceSnapshot = snapshot;

    selectionView.applyMarkdownStructuralFolding(state);
    fire(heading, 'click');
    assert.equal(selection.removed, 1, `${selectionKind} selection was replaced`);
    assert.equal(selection.added, 1);
    assert.equal(selection.currentRange.selectedNode, heading);
    assert.equal(selection.currentRange.collapsed, true);
    const afterCollapse = {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      reads: selection.reads,
      removed: selection.removed,
      added: selection.added
    };

    fire(controls(bodyRoot)[0], 'click');
    assert.deepEqual({
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      reads: selection.reads,
      removed: selection.removed,
      added: selection.added
    }, afterCollapse, `${selectionKind} Selection remains exact on arrow expansion`);
  });
});

test('Live and Source content clicks keep caret ownership while disclosure folding stays shared', () => {
  const source = '# Heading\nbody';
  const initial = editableRowsState(source, 'live-preview');
  view.applyMarkdownStructuralFolding(initial.state);
  const headingOwner = initial.state.markdownFoldIndex.owners.find(
    (owner) => owner.kind === 'heading'
  );
  assert.ok(headingOwner.foldable);
  assert.equal(initial.rows[0].element.listeners.get('click'), undefined);
  assert.equal(initial.rows[0].element.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(controls(initial.bodyRoot).length, 1);
  assert.equal(controls(initial.bodyRoot)[0].attributes['aria-expanded'], 'true');

  initial.state.mode = 'source';
  view.applyMarkdownStructuralFolding(initial.state);
  assert.equal(initial.rows[1].element.hidden, false);
  assert.equal(controls(initial.bodyRoot)[0].attributes['aria-expanded'], 'true');
  const hiddenPosition = initial.state.editableProjection.enumerateDeclaredPositions()
    .find((position) => position.offset === initial.state.sourceSnapshot.physicalLineIndex.lines[1].start);
  initial.state.editableProjection.projectionSelection = {
    anchor: hiddenPosition,
    focus: hiddenPosition
  };
  fire(controls(initial.bodyRoot)[0], 'click');
  assert.equal(initial.rows[1].element.hidden, true);
  assert.equal(controls(initial.bodyRoot).length, 1);
  assert.equal(initial.rows[0].element.listeners.get('click'), undefined);
  assert.equal(initial.rows[0].element.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(controls(initial.bodyRoot)[0].attributes['aria-expanded'], 'false');
  assert.equal(
    initial.state.editableProjection.restoredSelection.anchor.offset,
    headingOwner.safeOffset,
    'Source disclosure collapse relocates a descendant caret before hiding it'
  );

  initial.state.mode = 'live-preview';
  view.applyMarkdownStructuralFolding(initial.state);
  assert.equal(initial.rows[1].element.hidden, true, 'Source collapse survives into Live');
  assert.equal(controls(initial.bodyRoot)[0].attributes['aria-expanded'], 'false');

  initial.state.mode = 'source';
  view.applyMarkdownStructuralFolding(initial.state);
  fire(controls(initial.bodyRoot)[0], 'click');
  assert.equal(initial.rows[1].element.hidden, false);
  assert.equal(controls(initial.bodyRoot).length, 1);
  assert.equal(controls(initial.bodyRoot)[0].attributes['aria-expanded'], 'true');
  assert.deepEqual(plain(initial.state.markdownFoldDescriptors), []);

  initial.state.mode = 'live-preview';
  view.applyMarkdownStructuralFolding(initial.state);
  assert.equal(initial.rows[1].element.hidden, false);
  assert.equal(initial.rows[0].element.listeners.get('click'), undefined);
  assert.equal(initial.state.body, source);
});

test('keyboard position resolution skips hidden rows in both directions', () => {
  const source = '# First\nhidden\n# Next';
  const editable = editableRowsState(source);
  view.applyMarkdownStructuralFolding(editable.state);
  const first = editable.state.markdownFoldIndex.owners.find((owner) => (
    owner.kind === 'heading' && owner.lineIndex === 0
  ));
  editable.state.markdownFoldDescriptors = [descriptor(first)];
  view.applyMarkdownStructuralFolding(editable.state);

  const lines = editable.state.sourceSnapshot.physicalLineIndex.lines;
  const hiddenPosition = editable.state.editableProjection.enumerateDeclaredPositions()
    .find((position) => position.offset === lines[1].start);
  const forward = view.markdownStructuralVisiblePosition(
    editable.state,
    hiddenPosition,
    'ArrowDown'
  );
  const backward = view.markdownStructuralVisiblePosition(
    editable.state,
    hiddenPosition,
    'ArrowUp'
  );
  const neutral = view.markdownStructuralVisiblePosition(
    editable.state,
    hiddenPosition
  );

  assert.equal(forward.offset, lines[2].start);
  assert.equal(forward.physicalLineId, lines[2].id);
  assert.equal(backward.offset, lines[0].contentEnd);
  assert.equal(backward.physicalLineId, lines[0].id);
  assert.equal(neutral.offset, first.safeOffset);
  assert.equal(neutral.physicalLineId, lines[0].id);

  editable.state.mode = 'source';
  assert.equal(view.markdownStructuralVisiblePosition(
    editable.state,
    hiddenPosition,
    'ArrowDown'
  ).physicalLineId, lines[2].id, 'Source navigation uses the same visibility mask');
  editable.state.editablePresentationPlan = {};
  const ensuredSourceSelection = view.ensureEditableSelectionVisible(
    editable.state,
    { anchor: hiddenPosition, focus: hiddenPosition },
    { direction: 'ArrowDown' }
  );
  assert.equal(ensuredSourceSelection.anchor.physicalLineId, lines[2].id);
  assert.equal(ensuredSourceSelection.focus.physicalLineId, lines[2].id);

  const eofSource = '# Tail\nhidden\n';
  const eof = editableRowsState(eofSource);
  view.applyMarkdownStructuralFolding(eof.state);
  const eofOwner = eof.state.markdownFoldIndex.foldableOwners[0];
  eof.state.markdownFoldDescriptors = [descriptor(eofOwner)];
  view.applyMarkdownStructuralFolding(eof.state);
  const eofLines = eof.state.sourceSnapshot.physicalLineIndex.lines;
  [eofLines[1].start, eofSource.length].forEach((offset) => {
    const hidden = eof.state.editableProjection.enumerateDeclaredPositions()
      .find((position) => position.offset === offset);
    const resolved = view.markdownStructuralVisiblePosition(
      eof.state,
      hidden,
      'ArrowDown'
    );
    assert.equal(resolved.physicalLineId, eofLines[0].id);
    assert.equal(resolved.offset, eofLines[0].contentEnd);
    assert.equal(eof.state.markdownFoldVisibility.hiddenLineIndices.has(
      eofLines.findIndex((line) => line.id === resolved.physicalLineId)
    ), false);
  });
});

test('Live list marker keeps editing ownership while disclosure folds and task checkbox stays independent', () => {
  const orderedSource = '1. Parent\n\t- Child\n2. Next';
  const ordered = editableRowsState(orderedSource);
  const marker = element('span', 'markdown-editable-list-marker-slot');
  const content = element('span', 'markdown-editable-list-content');
  ordered.rows[0].element.append(marker, content);

  view.applyMarkdownStructuralFolding(ordered.state);
  assert.equal(marker.listeners.get('click'), undefined);
  assert.equal(marker.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(content.listeners.get('click'), undefined);
  assert.equal(controls(ordered.bodyRoot).length, 1);
  const childPosition = ordered.state.editableProjection.enumerateDeclaredPositions()
    .find((position) => position.offset === ordered.state.sourceSnapshot.physicalLineIndex.lines[1].start);
  ordered.state.editableProjection.projectionSelection = {
    anchor: childPosition,
    focus: childPosition
  };
  const parentControl = controls(ordered.bodyRoot).find((control) => (
    control.dataset.markdownStructuralFoldOwnerKey
      === ordered.state.markdownFoldIndex.owners.find((owner) => owner.lineIndex === 0).key
  ));
  fire(parentControl, 'click');
  assert.equal(ordered.rows[1].element.hidden, true);
  assert.equal(ordered.rows[2].element.hidden, false);
  assert.equal(
    ordered.state.editableProjection.restoredSelection.anchor.offset,
    ordered.state.markdownFoldIndex.owners.find((owner) => owner.lineIndex === 0).safeOffset,
    'caret inside the hidden subtree moves to the structural parent first'
  );
  assert.equal(controls(ordered.bodyRoot).length, 1);
  assert.equal(ordered.state.body, orderedSource);

  const taskSource = '- [ ] Parent\n\t- Child\n- Next';
  const task = editableRowsState(taskSource);
  const checkbox = element('input', 'markdown-page-task-checkbox');
  checkbox.type = 'checkbox';
  const taskContent = element('span', 'markdown-editable-list-content');
  task.rows[0].element.append(checkbox, taskContent);
  view.applyMarkdownStructuralFolding(task.state);

  const taskTriggers = descendants(task.rows[0].element).filter((node) => (
    node?.dataset?.markdownStructuralFoldTrigger === 'list'
  ));
  assert.equal(taskTriggers.length, 0);
  assert.equal(checkbox.listeners.get('click'), undefined);
  assert.equal(checkbox.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(checkbox.dataset.markdownSemanticControl, undefined);
  const taskParentControl = controls(task.bodyRoot).find((control) => (
    control.dataset.markdownStructuralFoldOwnerKey
      === task.state.markdownFoldIndex.owners.find((owner) => owner.lineIndex === 0).key
  ));
  fire(taskParentControl, 'click');
  assert.equal(task.rows[1].element.hidden, true);
  assert.equal(checkbox.checked, false);
  assert.equal(task.state.body, taskSource);
});

test('Source list source remains editable and only its disclosure changes visibility', () => {
  const source = '1. Parent\n\t- Child\n2. Next';
  const editable = editableRowsState(source, 'source');
  const marker = element('span', 'markdown-editable-list-marker-slot');
  const content = element('span', 'markdown-editable-list-content');
  editable.rows[0].element.append(marker, content);

  view.applyMarkdownStructuralFolding(editable.state);
  assert.equal(marker.dataset.markdownStructuralFoldTrigger, undefined);
  assert.equal(marker.listeners.get('pointerdown'), undefined);
  assert.equal(marker.listeners.get('click'), undefined);
  assert.deepEqual(fire(marker, 'click').calls, {
    preventDefault: 0,
    stopPropagation: 0,
    stopImmediatePropagation: 0
  });
  assert.deepEqual(plain(editable.state.markdownFoldDescriptors), []);

  const control = controls(editable.bodyRoot)[0];
  assert.equal(control.attributes['aria-expanded'], 'true');
  fire(control, 'click');
  assert.equal(editable.rows[1].element.hidden, true);
  assert.equal(editable.rows[2].element.hidden, false);
  assert.equal(controls(editable.bodyRoot)[0].attributes['aria-expanded'], 'false');
  assert.equal(editable.state.body, source);
});

test('leaf owners mount no disclosure in any mode', () => {
  ['live-preview', 'source'].forEach((mode) => {
    const heading = editableRowsState('# Alone', mode);
    view.applyMarkdownStructuralFolding(heading.state);
    assert.equal(controls(heading.bodyRoot).length, 0);

    const list = editableRowsState('- Alone', mode);
    view.applyMarkdownStructuralFolding(list.state);
    assert.equal(controls(list.bodyRoot).length, 0);
  });
});

test('Reading direct-fold listeners are inert after a mode transition', () => {
  const source = '# Heading\nbody';
  const snapshot = markdown.createSourceSnapshot(source);
  const lines = snapshot.physicalLineIndex.lines;
  const bodyRoot = new FakeElement({ tagName: 'main' });
  const heading = element('h1', 'markdown-page-heading', lines[0].start, lines[0].contentEnd);
  const paragraph = element('p', 'markdown-page-paragraph', lines[1].start, lines[1].contentEnd);
  bodyRoot.append(heading, paragraph);
  const state = baseFoldState(source, 'reading', bodyRoot);
  state.sourceSnapshot = snapshot;
  view.applyMarkdownStructuralFolding(state);
  assert.equal(heading.listeners.get('click')?.length, 1);

  state.mode = 'source';
  const result = fire(heading, 'click');
  assert.deepEqual(result.calls, {
    preventDefault: 0,
    stopPropagation: 0,
    stopImmediatePropagation: 0
  });
  assert.deepEqual(plain(state.markdownFoldDescriptors), []);
  assert.equal(paragraph.hidden, false);
});

test('live typography geometry invalidation remeasures collapsed projected marker anchors', () => {
  const source = '1. Parent\n\t1. Child\n2. Next';
  const editable = editableRowsState(source);
  const marker = element('span', 'markdown-editable-list-marker-slot');
  editable.rows[0].element.append(marker);
  editable.rows[0].element.getBoundingClientRect = () => ({
    left: 100, right: 500, top: 20, bottom: 44, width: 400, height: 24
  });
  let markerLeft = 124;
  editable.state.editableProjection.collapsedPositionRect = () => ({
    left: markerLeft, right: markerLeft, top: 20, bottom: 44, width: 0, height: 24
  });

  view.applyMarkdownStructuralFolding(editable.state);
  const owner = editable.state.markdownFoldIndex.foldableOwners[0];
  editable.state.markdownFoldDescriptors = [descriptor(owner)];
  view.applyMarkdownStructuralFolding(editable.state);
  assert.equal(
    editable.rows[0].element.style.getPropertyValue(
      '--markdown-structural-fold-anchor-inline'
    ),
    '24px'
  );

  markerLeft = 156;
  assert.equal(view.refreshMarkdownStructuralFoldGeometry(editable.state), true);
  assert.equal(
    editable.rows[0].element.style.getPropertyValue(
      '--markdown-structural-fold-anchor-inline'
    ),
    '56px'
  );
  assert.equal(editable.state.body, source);
  const pageViewSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );
  assert.match(
    pageViewSource,
    /geometryDocument\.fonts\.addEventListener\?\.\(\s*'loadingdone'/
  );
  assert.match(pageViewSource, /geometryDocument\.fonts\.ready\?\.then\?\.\(/);
  assert.doesNotThrow(() => loadMarkdownPageViewInternals([], {
    document: {
      fonts: {
        ready: true,
        addEventListener() {}
      }
    }
  }));
});

test('Reading list collapse is marker-only and leaves item content clicks unclaimed', () => {
  const source = '- Parent\n\t- Child\n- Next';
  const snapshot = markdown.createSourceSnapshot(source);
  const lines = snapshot.physicalLineIndex.lines;
  const bodyRoot = new FakeElement({ tagName: 'main' });
  const parent = element('li', 'markdown-page-list-item', lines[0].start, lines[0].contentEnd);
  const content = element('span', 'markdown-page-list-item-body');
  parent.append(content);
  const child = element('li', 'markdown-page-list-item', lines[1].start, lines[1].contentEnd);
  const next = element('li', 'markdown-page-list-item', lines[2].start, lines[2].contentEnd);
  bodyRoot.append(parent, child, next);
  const state = baseFoldState(source, 'reading', bodyRoot);
  state.sourceSnapshot = snapshot;

  view.applyMarkdownStructuralFolding(state);
  const markerTriggers = descendants(parent).filter((node) => (
    node?.classList?.contains('markdown-structural-reading-list-marker-trigger')
  ));
  assert.equal(markerTriggers.length, 1);
  assert.equal(markerTriggers[0].listeners.get('click')?.length, 1);
  assert.equal(parent.listeners.get('click'), undefined);
  assert.equal(content.listeners.get('click'), undefined);
  assert.equal(state.markdownFoldDescriptors.length, 0);
  assert.equal(child.hidden, false);

  fire(markerTriggers[0], 'click');
  assert.equal(child.hidden, true);
  assert.equal(next.hidden, false);
  assert.equal(controls(bodyRoot).length, 1);
  assert.equal(controls(bodyRoot)[0].attributes['aria-expanded'], 'false');

  const collapsedMarkerTrigger = descendants(parent).find((node) => (
    node?.classList?.contains('markdown-structural-reading-list-marker-trigger')
  ));
  fire(collapsedMarkerTrigger, 'click');
  assert.equal(child.hidden, false, 'the Reading structural target toggles open too');
  assert.equal(controls(bodyRoot)[0].attributes['aria-expanded'], 'true');
});

test('Reading ordered marker geometry follows the rendered ordinal, not each raw marker', () => {
  const source = [
    '9999. Parent',
    '\t- Child',
    '1. Next',
    '\t- Child'
  ].join('\n');
  const snapshot = markdown.createSourceSnapshot(source);
  const lines = snapshot.physicalLineIndex.lines;
  const bodyRoot = new FakeElement({ tagName: 'main' });
  const list = element('ol', 'markdown-page-list');
  list.start = 9999;
  const first = element(
    'li',
    'markdown-page-list-item',
    lines[0].start,
    lines[0].contentEnd
  );
  const second = element(
    'li',
    'markdown-page-list-item',
    lines[2].start,
    lines[2].contentEnd
  );
  list.append(first, second);
  bodyRoot.append(list);
  const state = baseFoldState(source, 'reading', bodyRoot);
  state.sourceSnapshot = snapshot;

  view.applyMarkdownStructuralFolding(state);

  assert.equal(
    first.style.getPropertyValue('--markdown-structural-list-marker-characters'),
    '5',
    'the first semantic ordinal is 9999.'
  );
  assert.equal(
    second.style.getPropertyValue('--markdown-structural-list-marker-characters'),
    '6',
    'the browser displays 10000. even though the second raw marker is 1.'
  );
  const secondTrigger = descendants(second).find((node) => (
    node?.classList?.contains('markdown-structural-reading-list-marker-trigger')
  ));
  assert.equal(
    secondTrigger.style.getPropertyValue('--markdown-structural-marker-characters'),
    '6'
  );
});

test('fold CSS reuses the shared hollow disclosure and keeps controls out of flow', () => {
  const styles = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'styles.css'),
    'utf8'
  );
  const sharedDisclosure = styles.match(
    /\.disclosure-chevron \{[^}]*\}[\s\S]*?\.disclosure-chevron::after \{[^}]*\}/
  )?.[0] || '';
  const controlRule = styles.match(
    /\.markdown-structural-fold-control\.nav-folder-disclosure-button \{[^}]*\}/
  )?.[0] || '';
  const hiddenRule = styles.match(
    /\.is-markdown-structural-fold-hidden \{[^}]*\}/
  )?.[0] || '';

  assert.match(sharedDisclosure, /width:\s*7px/);
  assert.match(sharedDisclosure, /height:\s*1px/);
  assert.match(sharedDisclosure, /background:\s*currentColor/);
  assert.match(controlRule, /position:\s*absolute/);
  assert.match(controlRule, /top:\s*0\.5lh/);
  assert.match(controlRule, /font:\s*inherit/);
  assert.match(controlRule, /line-height:\s*inherit/);
  assert.match(controlRule, /margin:\s*0/);
  assert.match(controlRule, /padding:\s*0/);
  assert.match(controlRule, /background:\s*transparent/);
  assert.match(
    styles,
    /markdown-structural-fold-control\[aria-expanded="true"\][\s\S]*?visibility:\s*visible[\s\S]*?opacity:\s*0[\s\S]*?pointer-events:\s*auto/
  );
  assert.match(
    styles,
    /markdown-structural-fold-control\[aria-expanded="true"\]:hover[\s\S]*?visibility:\s*visible[\s\S]*?opacity:\s*1/
  );
  assert.match(
    styles,
    /markdown-page-layer:is\(\.is-live-preview, \.is-source\)[\s\S]*?markdown-structural-fold-owner:hover[\s\S]*?visibility:\s*visible[\s\S]*?opacity:\s*1[\s\S]*?pointer-events:\s*auto/
  );
  assert.match(styles, /markdown-structural-fold-control\[aria-expanded="true"\]::after[\s\S]*?width:\s*0\.25rem/);
  assert.match(styles, /\[aria-expanded="true"\] > \.disclosure-chevron[\s\S]*?rotate\(90deg\)/);
  assert.match(hiddenRule, /display:\s*none\s*!important/);
  assert.match(hiddenRule, /pointer-events:\s*none\s*!important/);
  assert.match(
    styles,
    /markdown-page-layer:is\(\.is-live-preview, \.is-source\)[\s\S]*?markdown-editable-physical-row\.is-markdown-structural-fold-hidden\[hidden\][\s\S]*?display:\s*none\s*!important/
  );
  assert.match(
    styles,
    /markdown-structural-fold-owner\.is-editable-task-list-row[^}]*1\.35rem/
  );
  assert.doesNotMatch(styles, /markdown-structural-fold[^\n{]*[\s\S]{0,300}[▶▼]/);
});

test('public fold snapshot is non-invasive for targets outside a Markdown layer', () => {
  const target = new FakeElement({ tagName: 'div' });
  assert.equal(view.markdownStructuralFoldSnapshot(target), null);
});
