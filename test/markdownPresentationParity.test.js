'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const view = loadMarkdownPageViewInternals([
  'editableQuoteRailIntervals',
  'reconcileEditableQuoteRailOverlay',
  'semanticSyntaxSegments',
  'renderSemanticBlockContents',
  'unorderedMarkerForDepth'
]);

const nestedQuote = [
  '> ATP transfers chemical energy.',
  '>> This is a nested quotation.',
  '>> Another nested line.',
  '> Back to outer quote.'
].join('\n');

function presentationPlan(source, mode = 'live-preview') {
  const snapshot = markdown.createSourceSnapshot(source);
  const plan = buildEditablePresentationPlan(snapshot, { model: markdown, mode });
  const validation = validateEditablePresentationPlan(plan, snapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return { snapshot, plan };
}

function plainIntervals(quotes) {
  return Array.from(view.editableQuoteRailIntervals(quotes), (interval) => ({
    depth: interval.depth,
    ownerId: interval.ownerId,
    firstLineIndex: interval.firstLineIndex,
    lastLineIndex: interval.lastLineIndex,
    physicalLineIds: [...interval.physicalLineIds]
  }));
}

function numericStyle(element, name) {
  return Number.parseFloat(element.style.getPropertyValue(name));
}

test('quote rail intervals consume parser-owned depth ancestry and coalesce semantic regions', () => {
  const { snapshot, plan } = presentationPlan(nestedQuote);
  const [outerOwner, nestedOwner] = [
    plan.constructs.quotes[0].ownerIds[0],
    plan.constructs.quotes[1].ownerIds[1]
  ];
  assert.deepEqual(plainIntervals(plan.constructs.quotes), [
    {
      depth: 1,
      ownerId: outerOwner,
      firstLineIndex: 0,
      lastLineIndex: 3,
      physicalLineIds: snapshot.physicalLineIndex.lines.map((line) => line.id)
    },
    {
      depth: 2,
      ownerId: nestedOwner,
      firstLineIndex: 1,
      lastLineIndex: 2,
      physicalLineIds: snapshot.physicalLineIndex.lines.slice(1, 3).map((line) => line.id)
    }
  ]);

  const separated = presentationPlan('> first\n\n> second').plan;
  assert.deepEqual(plainIntervals(separated.constructs.quotes).map((interval) => (
    [interval.depth, interval.firstLineIndex, interval.lastLineIndex]
  )), [[1, 0, 0], [1, 2, 2]], 'non-quote rows terminate semantic rail intervals');

  const fenced = presentationPlan('```md\n> not a quote\n```').plan;
  assert.deepEqual(fenced.constructs.quotes, []);
  assert.deepEqual(plainIntervals(fenced.constructs.quotes), [],
    'presentation cannot recognize quote syntax independently of parser metadata');
  assert.throws(() => view.editableQuoteRailIntervals([{
    physicalLineId: 'row-1',
    lineIndex: 0,
    depth: Number.NaN,
    ownerIds: ['quote-owner']
  }]), /QuoteLineIndex region metadata/,
  'invalid semantic descriptors cannot silently become presentation inference');
});

test('one document overlay produces seam-free simple and nested rails at every required zoom', () => {
  const { snapshot, plan } = presentationPlan(nestedQuote);
  const zooms = [0.5, 0.67, 0.8, 1, 1.1, 1.25, 1.5];
  const localRows = [
    { top: 100, bottom: 126, left: 40 },
    { top: 126, bottom: 152, left: 40 },
    { top: 152, bottom: 178, left: 40 },
    { top: 178, bottom: 204, left: 40 }
  ];

  zooms.forEach((zoom) => {
    const surface = new FakeElement({ tagName: 'article' });
    const layer = new FakeElement();
    layer.classList.add('markdown-editable-quote-rail-layer');
    layer.contentEditable = 'false';
    layer.dataset.markdownSemanticOnly = 'true';
    const bodyRoot = new FakeElement();
    const surfaceLeft = 230;
    const surfaceTop = 310;
    // Deliberately fractional and different from the world-space width: the
    // overlay must consume the canonical CSS zoom, never rounded offsetWidth.
    surface.offsetWidth = 799.25;
    surface.getBoundingClientRect = () => ({
      left: surfaceLeft,
      top: surfaceTop,
      right: surfaceLeft + (800 * zoom),
      bottom: surfaceTop + (600 * zoom),
      width: 800 * zoom,
      height: 600 * zoom
    });
    surface.append(layer, bodyRoot);

    const rows = snapshot.physicalLineIndex.lines.map((line, index) => {
      const element = new FakeElement();
      const local = localRows[index];
      element.getBoundingClientRect = () => ({
        left: surfaceLeft + (local.left * zoom),
        top: surfaceTop + (local.top * zoom),
        right: surfaceLeft + (760 * zoom),
        bottom: surfaceTop + (local.bottom * zoom),
        width: 720 * zoom,
        height: (local.bottom - local.top) * zoom
      });
      bodyRoot.append(element);
      return { physicalLineId: line.id, element };
    });
    const state = {
      mode: 'live-preview',
      zoom,
      documentSurface: surface,
      quoteRailLayer: layer,
      bodyRoot,
      editablePresentationPlan: plan,
      editableProjection: {
        enumeratePhysicalRows() {
          return rows;
        }
      }
    };

    const rails = view.reconcileEditableQuoteRailOverlay(state);
    assert.equal(rails.length, 2, `${zoom}: one rail per semantic depth interval`);
    assert.equal(layer.hidden, false);
    assert.equal(bodyRoot.contains(layer), false,
      `${zoom}: overlay must remain outside the editable projection root`);
    assert.equal(surface.contains(layer), true);
    assert.deepEqual(Array.from(rails, (rail) => rail.dataset.markdownQuoteRailDepth), ['1', '2']);
    assert.deepEqual(Array.from(rails, (rail) => rail.style.getPropertyValue(
      '--markdown-editable-quote-rail-index'
    )), ['0', '1']);
    assert.ok(Math.abs(numericStyle(
      rails[0], '--markdown-editable-quote-rail-top'
    ) - 100) < 1e-9, `${zoom}: outer top`);
    assert.ok(Math.abs(numericStyle(
      rails[0], '--markdown-editable-quote-rail-height'
    ) - 104) < 1e-9, `${zoom}: outer rail spans exact contiguous row union`);
    assert.ok(Math.abs(numericStyle(
      rails[1], '--markdown-editable-quote-rail-top'
    ) - 126) < 1e-9, `${zoom}: nested top`);
    assert.ok(Math.abs(numericStyle(
      rails[1], '--markdown-editable-quote-rail-height'
    ) - 52) < 1e-9, `${zoom}: nested rail has no row-boundary seam`);
    assert.ok(rails.every((rail) => Math.abs(numericStyle(
      rail, '--markdown-editable-quote-rail-left'
    ) - 40) < 1e-9), `${zoom}: rail anchor remains stable`);
    assert.ok(rails.every((rail) => rail.contentEditable === 'false'));
    assert.ok(rails.every((rail) => rail.dataset.markdownSemanticOnly === 'true'));
    assert.ok(rails.every((rail) => rail.childNodes.length === 0),
      `${zoom}: presentation rails cannot introduce editable leaves`);
  });
});

test('Source and Live share the overlay intervals without altering physical editable rows', () => {
  const source = presentationPlan(nestedQuote, 'source');
  const live = presentationPlan(nestedQuote, 'live-preview');
  assert.deepEqual(
    plainIntervals(source.plan.constructs.quotes).map((interval) => ({
      depth: interval.depth,
      firstLineIndex: interval.firstLineIndex,
      lastLineIndex: interval.lastLineIndex
    })),
    plainIntervals(live.plan.constructs.quotes).map((interval) => ({
      depth: interval.depth,
      firstLineIndex: interval.firstLineIndex,
      lastLineIndex: interval.lastLineIndex
    }))
  );
  for (const result of [source, live]) {
    assert.equal(result.plan.lines.length, result.snapshot.physicalLineIndex.lines.length);
    assert.deepEqual(result.plan.lines.map((line) => line.physicalLineId),
      result.snapshot.physicalLineIndex.lines.map((line) => line.id));
    assert.equal(result.plan.lines.map((line) => (
      line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
    )).join(''), nestedQuote);
  }
});

test('one unordered marker mapping is consumed by Reading and inactive Live', () => {
  const expected = [
    { glyph: '\u2022', listStyleType: 'disc' },
    { glyph: '\u25e6', listStyleType: 'circle' },
    { glyph: '\u25aa', listStyleType: 'square' }
  ];
  assert.deepEqual([0, 1, 2].map((depth) => ({
    glyph: view.unorderedMarkerForDepth(depth).glyph,
    listStyleType: view.unorderedMarkerForDepth(depth).listStyleType
  })), expected);
  assert.equal(view.unorderedMarkerForDepth(12), view.unorderedMarkerForDepth(2));
  assert.ok([0, 1, 2].every((depth) => Object.isFrozen(
    view.unorderedMarkerForDepth(depth)
  )));

  const source = '- Parent\n\t- Child\n\t\t- Grandchild';
  const snapshot = markdown.createSourceSnapshot(source);
  const reading = renderSemanticSegments(view, source, {
    mode: 'reading',
    sourceSnapshot: snapshot,
    sourceVersion: snapshot.version
  });
  const lists = reading.blocks.flatMap((block) => descendants(block.element))
    .filter((element) => element?.classList?.contains('markdown-page-list'));
  assert.deepEqual(lists.map((list) => ({
    glyph: list.dataset.markdownUnorderedMarker,
    listStyleType: list.dataset.markdownUnorderedMarkerStyle,
    inlineStyle: list.style.listStyleType
  })), expected.map((marker) => ({ ...marker, inlineStyle: marker.listStyleType })));
  assert.ok(lists.every((list) => list.tagName === 'UL'));

  const plan = presentationPlan(source).plan;
  assert.deepEqual(plan.constructs.listRows.map((row) => row.depth), [1, 2, 3]);
  assert.equal(plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join(''), source, 'the marker map is presentation-only');
});
