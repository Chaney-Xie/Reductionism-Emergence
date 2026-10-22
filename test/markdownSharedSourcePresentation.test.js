'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
const {
  createCertificationProjection,
  positionKey
} = require('./helpers/markdownEditableCertificationHarness');

const view = loadMarkdownPageViewInternals([
  'semanticSyntaxSegments',
  'renderSemanticBlockContents'
]);

const quoteFixture = [
  '> Quote one',
  '',
  '>> Quote two',
  '',
  '>>> Quote three'
].join('\n');

const listFixture = [
  '1. Glycolysis',
  '2. Link reaction',
  '3. TCA cycle',
  '    1. Citrate',
  '    2. Isocitrate',
  '        1. deeper',
  '    3. Succinate',
  '4. Next top-level',
  '',
  '- Parent',
  '    - child',
  '    - child two',
  '        - deeper',
  '- Next parent'
].join('\n');

function readingRender(source) {
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const rendered = renderSemanticSegments(view, source, {
    mode: 'reading',
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version
  });
  const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
  return { ...rendered, nodes, sourceSnapshot };
}

function presentationPlan(sourceSnapshot, mode, options = {}) {
  const plan = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode,
    ...options
  });
  const validation = validateEditablePresentationPlan(plan, sourceSnapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return plan;
}

function sourceAndLive(source, liveOptions = {}) {
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const sourcePlan = presentationPlan(sourceSnapshot, 'source');
  const livePlan = presentationPlan(sourceSnapshot, 'live-preview', liveOptions);
  const sourceProjection = createCertificationProjection(sourceSnapshot, 'source', {
    presentationPlan: sourcePlan
  });
  const liveProjection = createCertificationProjection(sourceSnapshot, 'live-preview', {
    presentationPlan: livePlan
  });
  return {
    source,
    sourceSnapshot,
    sourcePlan,
    livePlan,
    sourceProjection,
    liveProjection
  };
}

function plannedSource(sourceSnapshot, plan) {
  return plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('').slice(0, sourceSnapshot.markdownBody.length);
}

function elements(nodes, className) {
  return nodes.filter((node) => (
    node?.nodeType === 1 && node.classList.contains(className)
  ));
}

function containingListDepth(nodes, item) {
  return elements(nodes, 'markdown-page-list').filter((list) => list.contains(item)).length;
}

function listLabel(item) {
  const body = item.children.find((child) => (
    child.classList.contains('markdown-page-list-item-body')
  ));
  return body?.textContent.trim().split(/\n/)[0] || '';
}

function readingListProjection(source) {
  const { nodes } = readingRender(source);
  return elements(nodes, 'markdown-page-list-item').map((item) => ({
    label: listLabel(item),
    depth: containingListDepth(nodes, item)
  }));
}

function quotePrefixForLine(source, content) {
  const contentStart = source.indexOf(content);
  const lineStart = source.lastIndexOf('\n', contentStart - 1) + 1;
  return {
    contentStart,
    lineStart,
    value: source.slice(lineStart, contentStart)
  };
}

test('each nested quote line owns one contiguous canonical prefix in Source and Live', () => {
  const result = sourceAndLive(quoteFixture);
  const expected = ['Quote one', 'Quote two', 'Quote three'].map((content, index) => {
    const prefix = quotePrefixForLine(quoteFixture, content);
    return {
      lineIndex: index * 2,
      depth: index + 1,
      prefixStart: prefix.lineStart,
      prefixEnd: prefix.contentStart,
      prefix: prefix.value
    };
  });

  for (const [mode, plan] of [
    ['source', result.sourcePlan],
    ['live-preview', result.livePlan]
  ]) {
    assert.deepEqual(plan.constructs.quotes.map((quote) => ({
      lineIndex: quote.lineIndex,
      depth: quote.depth,
      prefixStart: quote.prefixStart,
      prefixEnd: quote.prefixEnd,
      prefix: quote.prefix
    })), expected, `${mode}: quote prefix ownership differs`);
    plan.constructs.quotes.forEach((quote) => {
      assert.equal(
        quote.prefix,
        quoteFixture.slice(quote.prefixStart, quote.prefixEnd),
        `${mode}: prefix is not an exact SourceSnapshot slice`
      );
      assert.equal(quote.ownerIds.length, quote.depth,
        `${mode}: parser ancestry owns the complete nested depth`);
    });
    assert.equal(plannedSource(result.sourceSnapshot, plan), quoteFixture);
  }

  assert.deepEqual(
    result.sourceProjection.projection.enumerateDeclaredPositions().map(positionKey),
    result.liveProjection.projection.enumerateDeclaredPositions().map(positionKey),
    'quote presentation shape cannot change canonical positions'
  );

  const reading = readingRender(quoteFixture);
  for (const content of ['Quote one', 'Quote two', 'Quote three']) {
    const text = elements(reading.nodes, 'markdown-source-mapped-text')
      .find((node) => node.textContent === content);
    const semanticDepth = elements(reading.nodes, 'markdown-page-quote')
      .filter((quote) => quote.contains(text)).length;
    assert.equal(semanticDepth, quotePrefixForLine(quoteFixture, content).value.trim().length,
      'Reading keeps the parser-owned nested quote hierarchy');
  }
});

test('active Live reveals only the selected physical quote prefix', () => {
  const inactive = sourceAndLive(quoteFixture);
  const targetLine = inactive.sourceSnapshot.physicalLineIndex.lines[2];
  const activePlan = presentationPlan(inactive.sourceSnapshot, 'live-preview', {
    activePhysicalLineIds: [targetLine.id]
  });

  assert.deepEqual(
    activePlan.constructs.quotes.filter((quote) => quote.active)
      .map((quote) => quote.prefix),
    ['>> ']
  );
  activePlan.lines.filter((line) => line.metadata.quote).forEach((line) => {
    const prefix = line.leaves.find((leaf) => leaf.kind === 'quote-prefix');
    if (line.physicalLineId === targetLine.id) {
      assert.equal(prefix, undefined,
        'an active quote row replaces the hidden prefix with an editable marker role');
      assert.deepEqual(line.leaves.map((leaf) => [leaf.text, leaf.visibility]), [
        [line.metadata.quote.prefix, 'visible'],
        [line.text.slice(line.metadata.quote.prefix.length), 'visible']
      ]);
      assert.deepEqual(line.leaves.map((leaf) => leaf.kind), [
        'quote-marker',
        'quote-content'
      ]);
    } else {
      assert.ok(prefix);
      assert.equal(prefix.visibility, 'activatable');
    }
  });
  assert.deepEqual(
    activePlan.constructs.quotes.map((quote) => [quote.prefixStart, quote.prefixEnd]),
    inactive.sourcePlan.constructs.quotes.map((quote) => [quote.prefixStart, quote.prefixEnd]),
    'activation changes presentation only, never source ownership'
  );
  assert.equal(plannedSource(inactive.sourceSnapshot, activePlan), quoteFixture);
});

test('consecutive quote lines keep complete prefixes beside exact content positions', () => {
  for (const fixture of [
    {
      source: '> one\n> two',
      prefix: '> ',
      prefixRanges: [[0, 2], [6, 8]],
      contentRanges: [[2, 5], [8, 11]],
      depth: 1
    },
    {
      source: '>> one\n>> two',
      prefix: '>> ',
      prefixRanges: [[0, 3], [7, 10]],
      contentRanges: [[3, 6], [10, 13]],
      depth: 2
    }
  ]) {
    const result = sourceAndLive(fixture.source);
    for (const plan of [result.sourcePlan, result.livePlan]) {
      assert.deepEqual(plan.constructs.quotes.map((quote) => quote.prefix), [
        fixture.prefix,
        fixture.prefix
      ]);
      assert.deepEqual(plan.constructs.quotes.map((quote) => [
        quote.prefixStart,
        quote.prefixEnd
      ]), fixture.prefixRanges);
      assert.deepEqual(plan.constructs.quotes.map((quote) => quote.depth), [
        fixture.depth,
        fixture.depth
      ]);
      assert.equal(plannedSource(result.sourceSnapshot, plan), fixture.source);
    }
    const liveContent = result.livePlan.lines.flatMap((line) => line.leaves)
      .filter((leaf) => leaf.kind === 'quote-content' && ['one', 'two'].includes(leaf.text));
    assert.deepEqual(liveContent.map((leaf) => [leaf.sourceStart, leaf.sourceEnd]),
      fixture.contentRanges);
    liveContent.forEach((leaf) => {
      assert.equal(leaf.text, fixture.source.slice(leaf.sourceStart, leaf.sourceEnd));
    });
    fixture.contentRanges.flat().forEach((offset) => {
      assert.ok(result.sourceProjection.projection.enumerateDeclaredPositions()
        .some((position) => position.offset === offset));
      assert.ok(result.liveProjection.projection.enumerateDeclaredPositions()
        .some((position) => position.offset === offset));
    });
  }
});

test('Reading retains parser list hierarchy while Source and Live own physical rows', () => {
  const reading = readingListProjection(listFixture);
  const byLabel = new Map(reading.map((item) => [item.label, item]));
  assert.equal(byLabel.get('Citrate').depth, 2);
  assert.equal(byLabel.get('Isocitrate').depth, 2);
  assert.equal(byLabel.get('Succinate').depth, 2);
  assert.equal(byLabel.get('deeper').depth, 3);
  assert.equal(byLabel.get('child').depth, 2);
  assert.equal(byLabel.get('child two').depth, 2);

  const result = sourceAndLive(listFixture);
  assert.deepEqual(
    result.sourceProjection.projection.enumerateDeclaredPositions().map(positionKey),
    result.liveProjection.projection.enumerateDeclaredPositions().map(positionKey)
  );
  assert.deepEqual(
    result.sourceProjection.projection.enumeratePhysicalRows().map((row) => row.text),
    result.sourceSnapshot.physicalLineIndex.lines.map((line) => line.text)
  );
  for (const root of [result.sourceProjection.root, result.liveProjection.root]) {
    assert.equal(descendants(root).some((node) => (
      ['OL', 'UL', 'LI'].includes(node?.tagName)
    )), false, 'editable lists never synthesize native list DOM');
  }

  const strictRows = result.sourceSnapshot.editableListSemanticIndex.rows;
  assert.deepEqual(strictRows.map((row) => row.lineIndex), [0, 1, 2, 7, 9, 13]);
  assert.ok(strictRows.every((row) => row.depth === 1));
  assert.equal(strictRows.some((row) => row.line.text === '    1. Citrate'), false,
    'space-indented parser lists are ordinary editable rows');

  const tabbed = listFixture.replace('    1. Citrate', '\t1. Citrate');
  const tabbedSnapshot = markdown.createSourceSnapshot(tabbed);
  const tabbedCitrate = tabbedSnapshot.editableListSemanticIndex.rows.find((row) => (
    row.content === 'Citrate'
  ));
  assert.equal(tabbedCitrate.depth, 2);
  assert.equal(tabbedCitrate.tabs, '\t');
  assert.deepEqual(
    readingListProjection(tabbed).map((item) => [item.label, item.depth]),
    reading.map((item) => [item.label, item.depth]),
    'Reading parser hierarchy is unchanged by an equivalent tab indentation'
  );
});

test('Enter, Tab, and Shift-Tab use strict physical-line list ownership', () => {
  const spacedCaret = listFixture.indexOf('Citrate') + 'Citrate'.length;
  const ordinaryEnter = markdown.applyMarkdownNewline(listFixture, {
    anchor: spacedCaret,
    focus: spacedCaret
  });
  assert.equal(ordinaryEnter.replacement, '\n    ');
  assert.equal(ordinaryEnter.transaction.structural, false);
  assert.equal(ordinaryEnter.transaction.listTransform, false);

  const strictFixture = listFixture.replace('    1. Citrate', '\t1. Citrate');
  const strictCaret = strictFixture.indexOf('Citrate') + 'Citrate'.length;
  const continued = markdown.applyMarkdownNewline(strictFixture, {
    anchor: strictCaret,
    focus: strictCaret
  });
  assert.equal(continued.primaryEdits[0].replacement, '\n\t1. ');
  assert.deepEqual(
    continued.renumberEdits.map(({ start, end, replacement }) => ({ start, end, replacement })),
    [{ start: strictCaret + 2, end: strictCaret + 3, replacement: '2' }]
  );
  assert.equal(continued.transaction.transactionKind, 'list-enter-ordered');
  const continuationRow = continued.snapshot.editableListSemanticIndex.rows.find((row) => (
    row.empty && row.number === 2 && row.tabs === '\t'
  ));
  assert.ok(continuationRow);
  assert.equal(continuationRow.depth, 2);

  const citrateOffset = strictFixture.indexOf('Citrate') + 2;
  const indented = markdown.applyMarkdownIndentation(
    strictFixture,
    { anchor: citrateOffset, focus: citrateOffset },
    'indent'
  );
  const indentedCitrate = indented.snapshot.editableListSemanticIndex.rows.find((row) => (
    row.content === 'Citrate'
  ));
  assert.equal(indentedCitrate.tabs, '\t\t');
  assert.equal(indentedCitrate.depth, 3);
  assert.equal(
    indented.source.slice(
      indented.source.indexOf('    2. Isocitrate'),
      indented.source.indexOf('    2. Isocitrate') + '    2. Isocitrate'.length
    ),
    '    2. Isocitrate',
    'Tab changes only the recognized physical row'
  );
  const restored = markdown.applyMarkdownIndentation(
    indented.source,
    indented.selection,
    'outdent'
  );
  assert.equal(restored.source, strictFixture);
});

test('Source and Live share paragraph, heading, link, table, blank, and terminal positions', () => {
  const source = [
    '# Heading',
    '',
    'Paragraph with [link](https://example.com).',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    ''
  ].join('\r\n');
  const result = sourceAndLive(source);

  assert.equal(plannedSource(result.sourceSnapshot, result.sourcePlan), source);
  assert.equal(plannedSource(result.sourceSnapshot, result.livePlan), source);
  assert.deepEqual(
    result.sourceProjection.projection.enumerateDeclaredPositions().map(positionKey),
    result.liveProjection.projection.enumerateDeclaredPositions().map(positionKey)
  );
  const expectedRows = result.sourceSnapshot.physicalLineIndex.lines.map((line) => ({
    id: String(line.id),
    start: line.start,
    end: line.contentEnd,
    text: line.text
  }));
  for (const projection of [
    result.sourceProjection.projection,
    result.liveProjection.projection
  ]) {
    assert.deepEqual(projection.enumeratePhysicalRows().map((row) => ({
      id: String(row.physicalLineId),
      start: row.start,
      end: row.contentEnd,
      text: row.text
    })), expectedRows);
  }
  assert.equal(result.sourceSnapshot.physicalLineIndex.lines.at(-1).text, '');
  assert.equal(result.sourceSnapshot.physicalLineIndex.lines.at(-1).terminal, true);
  assert.ok(result.livePlan.constructs.headings.length > 0);
  assert.equal(result.livePlan.constructs.links.length, 1);
  assert.equal(result.livePlan.constructs.tables.length, 1);

  const reading = readingRender(source);
  assert.equal(elements(reading.nodes, 'markdown-page-heading').length, 1);
  assert.equal(elements(reading.nodes, 'markdown-page-link').length, 1);
  assert.equal(elements(reading.nodes, 'markdown-page-table').length, 1);
  assert.equal(reading.rendered?.state?.body ?? reading.state.body, source);
  assert.equal(reading.sourceSnapshot.markdownBody, source);
});
