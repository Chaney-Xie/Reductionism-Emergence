'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const foundation = require('../public/markdownEditableFoundation');
const numbering = require('../public/hnListNumbering');
const { createEditableProjection } = require('../public/js/markdownEditableProjection');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const syntaxAdapters = require('../public/js/markdownEditableSyntaxAdapters');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

const { SCHEMES } = numbering;

class ProjectionText {
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

  contains(node) {
    return node === this;
  }
}

function projectionDocument() {
  return {
    createElement(tagName) {
      return new FakeElement({ tagName });
    },
    createTextNode(value) {
      return new ProjectionText(value);
    },
    createDocumentFragment() {
      return new FakeElement({ tagName: '#document-fragment', nodeType: 11 });
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createRuntime() {
  return loadMarkdownPageViewInternals([], {
    globalThis: {
      markdownRuntime: {
        renderLatex(source) {
          return `<span>${String(source)}</span>`;
        }
      }
    }
  });
}

function buildPlan(source, options = {}) {
  const strategy = sourceEditor.createHnBasicPresentationStrategy();
  const sourceSnapshot = strategy.createSourceSnapshot(source, {
    version: options.version ?? 1
  });
  const presentationPlan = strategy.createPresentationPlan(sourceSnapshot, {
    mode: options.mode || 'edit',
    activeOwnerIds: options.activeOwnerIds || []
  });
  return { source, strategy, sourceSnapshot, presentationPlan };
}

function renderHn(source, options = {}) {
  const view = options.view || createRuntime();
  const strategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: view
  });
  const sourceSnapshot = strategy.createSourceSnapshot(source, {
    version: options.version ?? 1
  });
  const presentationPlan = strategy.createPresentationPlan(sourceSnapshot, {
    mode: options.mode || 'edit',
    activeOwnerIds: options.activeOwnerIds || []
  });
  const document = projectionDocument();
  const host = document.createElement('div');
  host.classList.add('hn-text-editor-host');
  const root = document.createElement('div');
  root.classList.add('hn-source-editor');
  host.append(root);
  const projection = createEditableProjection({ root, document, foundation });
  projection.render(sourceSnapshot, {
    mode: strategy.projectionMode,
    presentationPlan
  });
  strategy.mountPresentation({
    root,
    document,
    projection,
    presentationPlan,
    sourceSnapshot
  });
  return {
    source,
    view,
    strategy,
    sourceSnapshot,
    presentationPlan,
    projection,
    host,
    root
  };
}

function hnRows(plan) {
  return plan.constructs.listRows.filter((row) => row.hnSequenceList === true);
}

function projectedLeaves(result) {
  return result.projection.enumerateProjectedLeaves();
}

function exactProjectedSource(result) {
  return result.presentationPlan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('');
}

function elementsWithClass(root, className) {
  return descendants(root).filter((element) => element?.classList?.contains(className));
}

test('sequence items and continuation paragraphs expose exact canonical row ranges and shared width', () => {
  const source = '9. Nine\n   continuation\n10. Ten\n    wider';
  const { sourceSnapshot, presentationPlan } = buildPlan(source, { version: 23 });
  const rows = hnRows(presentationPlan);
  const sequence = sourceSnapshot.hnListIndex.sequences[0];
  const [nine, ten] = sequence.items;

  assert.equal(rows.length, 4);
  assert.equal(sequence.markerColumnWidth, 4,
    'the widest authored prefix owns one presentation column for the sequence');
  assert.deepEqual(rows.map((row) => row.markerColumnWidth), [4, 4, 4, 4]);
  assert.deepEqual(rows.map((row) => ({
    kind: row.kind,
    continuation: row.continuation,
    paragraphIndex: row.paragraphIndex,
    raw: row.raw,
    markerSource: row.markerSource,
    contentSource: row.contentSource,
    ownerId: row.ownerId,
    sequenceId: row.hnSequenceId,
    itemId: row.hnItemId
  })), [
    {
      kind: 'hn-sequence-list-item',
      continuation: false,
      paragraphIndex: 0,
      raw: '9. Nine',
      markerSource: '9. ',
      contentSource: 'Nine',
      ownerId: nine.id,
      sequenceId: sequence.id,
      itemId: nine.id
    },
    {
      kind: 'hn-sequence-list-continuation',
      continuation: true,
      paragraphIndex: 1,
      raw: '   continuation',
      markerSource: '   ',
      contentSource: 'continuation',
      ownerId: nine.id,
      sequenceId: sequence.id,
      itemId: nine.id
    },
    {
      kind: 'hn-sequence-list-item',
      continuation: false,
      paragraphIndex: 0,
      raw: '10. Ten',
      markerSource: '10. ',
      contentSource: 'Ten',
      ownerId: ten.id,
      sequenceId: sequence.id,
      itemId: ten.id
    },
    {
      kind: 'hn-sequence-list-continuation',
      continuation: true,
      paragraphIndex: 1,
      raw: '    wider',
      markerSource: '    ',
      contentSource: 'wider',
      ownerId: ten.id,
      sequenceId: sequence.id,
      itemId: ten.id
    }
  ]);

  rows.forEach((row, index) => {
    const item = index < 2 ? nine : ten;
    const paragraph = item.paragraphs[index % 2];
    assert.equal(row.family, 'hn-sequence-list');
    assert.equal(row.reconciliation.status, 'hn-source-derived');
    assert.equal(row.start, paragraph.fullRange.start);
    assert.equal(row.end, paragraph.contentRange.end);
    assert.equal(row.markerStart, paragraph.prefixRange.start);
    assert.equal(row.markerEnd, paragraph.contentRange.start);
    assert.equal(row.contentStart, paragraph.contentRange.start);
    assert.equal(row.contentEnd, paragraph.contentRange.end);
    assert.equal(row.raw, source.slice(row.start, row.end));
    assert.equal(row.markerSource, source.slice(row.markerStart, row.markerEnd));
    assert.equal(row.contentSource, source.slice(row.contentStart, row.contentEnd));
    assert.deepEqual(row.lineIds, [row.physicalLineId]);
    assert.equal(row.task, false);
    assert.equal(row.control, null);
    assert.equal(row.activationAnchor, null);
    assert.deepEqual(row.presentation, {
      sourceVisible: true,
      renderedMounted: false,
      layout: 'source-two-column',
      role: row.continuation
        ? 'hn-sequence-list-continuation'
        : 'hn-sequence-list-item',
      tagName: 'span'
    });
  });

  const validation = syntaxAdapters.validateEditablePresentationPlan(
    presentationPlan,
    sourceSnapshot
  );
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(presentationPlan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join(''), source);
});

test('all retained decimal, dotted, Roman, and alphabetic marker families use derived item identity', () => {
  const source = [
    '12. Decimal',
    'ordinary barrier',
    '3.7.4. Dotted',
    'ordinary barrier',
    '(IV Upper Roman',
    'ordinary barrier',
    '(iv Lower Roman',
    'ordinary barrier',
    '(a Lower alpha'
  ].join('\n');
  const { sourceSnapshot, presentationPlan } = buildPlan(source, { version: 31 });
  const rows = hnRows(presentationPlan);
  const items = sourceSnapshot.hnListIndex.items;

  assert.deepEqual(items.map((item) => item.scheme), [
    SCHEMES.DECIMAL,
    SCHEMES.DOTTED_DECIMAL,
    SCHEMES.UPPER_ROMAN_LEFT,
    SCHEMES.LOWER_ROMAN_LEFT,
    SCHEMES.LOWER_ALPHA_LEFT
  ]);
  assert.deepEqual(rows.map((row) => ({
    raw: row.raw,
    prefix: row.markerSource,
    content: row.contentSource,
    ownerId: row.ownerId,
    itemId: row.hnItemId,
    sequenceId: row.hnSequenceId
  })), items.map((item) => {
    const sequence = sourceSnapshot.hnListIndex.sequenceById(item.sequenceId);
    return {
      raw: source.slice(item.itemRange.start, item.firstParagraphRange.end),
      prefix: source.slice(item.prefixRange.start, item.firstParagraphRange.start),
      content: source.slice(item.firstParagraphRange.start, item.firstParagraphRange.end),
      ownerId: item.id,
      itemId: item.id,
      sequenceId: sequence.id
    };
  }));
  assert.deepEqual(rows.map((row) => row.markerSource), [
    '12. ', '3.7.4. ', '(IV ', '(iv ', '(a '
  ]);
  assert.ok(rows.every((row) => row.presentation.sourceVisible === true));
  assert.ok(rows.every((row) => row.presentation.renderedMounted === false));
});

test('the real projection mount keeps canonical marker bytes visible and mounts no duplicate marker glyph', () => {
  const source = '9. Nine\n   continuation\n10. Ten\n    wider';
  const result = renderHn(source, { version: 8 });
  const rows = hnRows(result.presentationPlan);

  assert.equal(exactProjectedSource(result), source);
  assert.equal(elementsWithClass(result.root, 'markdown-editable-list-bullet').length, 0,
    'HN sequence markers never acquire the rendered unordered-list glyph');
  assert.equal(result.root.querySelectorAll('[data-markdown-semantic-only="true"]').length, 0,
    'no duplicate semantic-only marker text is mounted');

  rows.forEach((listRow) => {
    const row = result.projection.enumeratePhysicalRows().find((entry) => (
      String(entry.physicalLineId) === String(listRow.physicalLineId)
    )).element;
    const markerSlot = row.querySelector('.markdown-editable-list-marker-slot');
    const contentSlot = row.querySelector('.markdown-editable-list-content-slot');
    const lineLeaves = projectedLeaves(result).filter((leaf) => (
      String(leaf.physicalLineId) === String(listRow.physicalLineId)
    ));
    const markerLeaves = lineLeaves.filter((leaf) => (
      listRow.markerStart <= leaf.sourceStart && leaf.sourceEnd <= listRow.markerEnd
    ));
    const contentLeaves = lineLeaves.filter((leaf) => (
      listRow.contentStart <= leaf.sourceStart && leaf.sourceEnd <= listRow.contentEnd
    ));

    assert.ok(row.classList.contains('has-editable-list-row-presentation'));
    assert.ok(row.classList.contains('is-hn-sequence-list-row'));
    assert.equal(row.classList.contains('is-hn-sequence-list-item-row'),
      listRow.continuation !== true);
    assert.equal(row.classList.contains('is-hn-sequence-list-continuation-row'),
      listRow.continuation === true);
    assert.equal(row.dataset.hnListSequenceId, listRow.hnSequenceId);
    assert.equal(row.dataset.hnListItemId, listRow.hnItemId);
    assert.equal(row.dataset.hnListParagraphKind,
      listRow.continuation ? 'continuation' : 'first');
    assert.equal(row.style.getPropertyValue('--hn-sequence-list-marker-columns'), '4');
    assert.equal(row.style.getPropertyValue('--hn-sequence-list-marker-width'), '4em');
    assert.equal(row.style.getPropertyValue('--hn-sequence-list-leading-width'), '4em');
    assert.ok(markerSlot);
    assert.ok(contentSlot);
    assert.equal(markerSlot.dataset.hnListMarkerCell, 'true');
    assert.equal(markerSlot.dataset.hnListMarker,
      listRow.continuation ? undefined : 'true');
    assert.equal(markerSlot.textContent, listRow.markerSource);
    assert.equal(contentSlot.textContent, listRow.contentSource);
    assert.equal(row.textContent, listRow.raw);
    assert.ok(markerLeaves.length >= 1);
    assert.ok(contentLeaves.length >= 1);
    assert.ok(markerLeaves.every((leaf) => (
      leaf.visibility === 'visible'
        && leaf.element.dataset.visibility === 'visible'
        && markerSlot.contains(leaf.element)
        && leaf.element.classList.contains('is-hn-sequence-list-marker')
        && leaf.element.classList.contains('is-hn-sequence-list-marker-source-visible')
    )));
    assert.ok(contentLeaves.every((leaf) => (
      leaf.visibility === 'visible'
        && contentSlot.contains(leaf.element)
        && leaf.element.classList.contains('is-hn-sequence-list-content')
    )));
  });
});

test('nested sequence rows materialize source depth and sequence width as one valid CSS length', () => {
  const source = '1. Parent\n\t1. Child\n\t\t1. Grandchild';
  const result = renderHn(source, { version: 9 });
  const sequenceRows = result.projection.enumeratePhysicalRows().map((entry) => entry.element)
    .filter((row) => row.classList.contains('is-hn-sequence-list-row'));

  assert.deepEqual(sequenceRows.map((row) => ({
    depth: row.style.getPropertyValue('--markdown-editable-list-depth'),
    markerColumns: row.style.getPropertyValue('--hn-sequence-list-marker-columns'),
    markerWidth: row.style.getPropertyValue('--hn-sequence-list-marker-width'),
    leadingWidth: row.style.getPropertyValue('--hn-sequence-list-leading-width')
  })), [
    { depth: '0', markerColumns: '3', markerWidth: '3em', leadingWidth: '3em' },
    { depth: '1', markerColumns: '3', markerWidth: '3em', leadingWidth: '4.35em' },
    { depth: '2', markerColumns: '3', markerWidth: '3em', leadingWidth: '5.7em' }
  ]);
});

test('existing strict unordered presentation remains separate and task rows stay literal', () => {
  const source = '1. Sequence\n\n- Unordered\n- [ ] Task';
  const result = renderHn(source, { version: 12 });
  const allRows = result.presentationPlan.constructs.listRows;
  const sequenceRows = allRows.filter((row) => row.hnSequenceList === true);
  const unorderedRows = allRows.filter((row) => row.family === 'unordered-list');

  assert.equal(exactProjectedSource(result), source);
  assert.equal(sequenceRows.length, 1);
  assert.equal(unorderedRows.length, 1);
  assert.deepEqual(result.presentationPlan.constructs.orderedListMarkers, [],
    'HN sequence presentation does not restore the Markdown ordered-list owner');
  assert.deepEqual(result.presentationPlan.controls, [],
    'task checkbox controls remain outside the HN Basic whitelist');
  assert.deepEqual({
    sourceVisible: sequenceRows[0].presentation.sourceVisible,
    renderedMounted: sequenceRows[0].presentation.renderedMounted,
    family: sequenceRows[0].family
  }, {
    sourceVisible: true,
    renderedMounted: false,
    family: 'hn-sequence-list'
  });
  assert.deepEqual({
    sourceVisible: unorderedRows[0].presentation.sourceVisible,
    renderedMounted: unorderedRows[0].presentation.renderedMounted,
    family: unorderedRows[0].family
  }, {
    sourceVisible: false,
    renderedMounted: true,
    family: 'unordered-list'
  });

  const physicalRows = result.projection.enumeratePhysicalRows();
  const sequenceRow = physicalRows[0].element;
  const unorderedRow = physicalRows[2].element;
  const taskRow = physicalRows[3].element;
  assert.equal(sequenceRow.querySelector('.markdown-editable-list-bullet'), null);
  assert.ok(unorderedRow.querySelector('.markdown-editable-list-bullet'));
  assert.equal(taskRow.querySelector('.markdown-editable-task-control'), null);
  assert.equal(taskRow.classList.contains('has-editable-list-row-presentation'), false);
  assert.ok(projectedLeaves(result).filter((leaf) => leaf.physicalLineId === 'physical-line-4')
    .every((leaf) => leaf.visibility === 'visible'
      && (leaf.planLeaf.semanticRoles || []).length === 0));
});

test('partial markers and reserved code/math/table/HTML source never create HN sequence rows', () => {
  const source = [
    '1.',
    '1.\tTab is not the separator',
    `1.\u00a0NBSP is not the separator`,
    '```text',
    '2. hidden code',
    '```',
    '',
    '$$',
    '3. hidden math',
    '$$',
    '',
    '<div>',
    '4. hidden html',
    '</div>',
    '',
    '| Value |',
    '| --- |',
    '| 5. hidden table |',
    '',
    '6. [visible link](https://example.com)',
    '7. inline $math$ remains item content'
  ].join('\n');
  const { sourceSnapshot, presentationPlan } = buildPlan(source, { version: 19 });
  const rows = hnRows(presentationPlan);
  const ownerTypes = new Set(sourceSnapshot.semanticIndex.owners.map((owner) => owner.type));

  for (const type of ['code', 'math', 'table', 'html', 'link', 'inlineMath']) {
    assert.equal(ownerTypes.has(type), true, `fixture exercises ${type} ownership`);
  }
  assert.deepEqual(rows.map((row) => row.raw), [
    '6. [visible link](https://example.com)',
    '7. inline $math$ remains item content'
  ]);
  assert.deepEqual(rows.map((row) => row.markerSource), ['6. ', '7. ']);
  assert.deepEqual(rows.map((row) => row.contentSource), [
    '[visible link](https://example.com)',
    'inline $math$ remains item content'
  ]);
  assert.equal(presentationPlan.constructs.listRows.length, 2,
    'literal and reserved marker-looking lines do not leak through another list owner');
  assert.equal(presentationPlan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join(''), source);
});
