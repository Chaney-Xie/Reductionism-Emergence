'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const hnText = require('../public/hnText');
const structureModel = require('../public/hnStructureIndex');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const syntaxAdapters = require('../public/js/markdownEditableSyntaxAdapters');

function build(source, version = 1) {
  const snapshot = markdown.createSourceSnapshot(source, { version });
  return {
    source,
    snapshot,
    index: structureModel.createHnStructureIndex(snapshot)
  };
}

function slice(source, range) {
  return source.slice(range.start, range.end);
}

function descriptorShape(index) {
  return index.concepts.map((concept) => ({
    id: concept.id,
    kind: concept.kind,
    headerRange: concept.headerRange,
    markerRange: concept.markerRange,
    titleRange: concept.titleRange,
    contentRange: concept.contentRange,
    fullRange: concept.fullRange,
    physicalLineExtent: concept.physicalLineExtent,
    semanticBlocks: concept.semanticBlocks.map((block) => ({ ...block }))
  }));
}

function headingShape(index) {
  return index.headings.map((heading) => ({
    id: heading.id,
    headingLevel: heading.headingLevel,
    headerRange: heading.headerRange,
    markerRange: heading.markerRange,
    titleRange: heading.titleRange,
    physicalLineExtent: heading.physicalLineExtent
  }));
}

function assertDeeplyFrozen(value, seen = new WeakSet()) {
  if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeeplyFrozen(child, seen));
}

test('exact line-start Concept headers partition source into primary and question blocks', () => {
  const source = '-## A\ntext\n\n-## B\ntext\n\n?## C\ntext';
  const { index } = build(source, 7);

  assert.equal(index.sourceVersion, 7);
  assert.equal(index.sourceLength, source.length);
  assert.deepEqual(index.concepts.map((concept) => concept.kind), [
    'concept-primary',
    'concept-primary',
    'concept-question'
  ]);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.fullRange)), [
    '-## A\ntext\n\n',
    '-## B\ntext\n\n',
    '?## C\ntext'
  ]);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.headerRange)), [
    '-## A', '-## B', '?## C'
  ]);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.markerRange)), [
    '-##', '-##', '?##'
  ]);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.titleRange)), [
    'A', 'B', 'C'
  ]);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.contentRange)), [
    'text\n\n', 'text\n\n', 'text'
  ]);
  assert.deepEqual(index.concepts.map((concept) => concept.physicalLineExtent), [
    { startLineIndex: 0, endLineIndex: 2, lineCount: 3 },
    { startLineIndex: 3, endLineIndex: 5, lineCount: 3 },
    { startLineIndex: 6, endLineIndex: 7, lineCount: 2 }
  ]);
  assert.equal(index.conceptAtOffset(12), index.concepts[1]);
  assert.equal(index.conceptAtOffset(source.length), index.concepts[2]);
});

test('one structure owner exposes the exact three-level HN heading presentation hierarchy', () => {
  const source = [
    '# Root',
    '?## Question Concept',
    'question body',
    '-## Primary Concept',
    '?### Question Subheading',
    '-### Primary Subheading',
    'tail'
  ].join('\n');
  const { index } = build(source, 8);

  assert.deepEqual(index.headings.map((heading) => heading.headingLevel), [1, 2, 2, 3, 3]);
  assert.deepEqual(index.headings.map((heading) => slice(source, heading.headerRange)), [
    '# Root',
    '?## Question Concept',
    '-## Primary Concept',
    '?### Question Subheading',
    '-### Primary Subheading'
  ]);
  assert.deepEqual(index.headings.map((heading) => slice(source, heading.markerRange)), [
    '#', '?##', '-##', '?###', '-###'
  ]);
  assert.deepEqual(index.headings.map((heading) => slice(source, heading.titleRange)), [
    'Root', 'Question Concept', 'Primary Concept', 'Question Subheading', 'Primary Subheading'
  ]);
  assert.ok(index.headings.every((heading) => (
    heading.physicalLineExtent.lineCount === 1
      && heading.physicalLineExtent.startLineIndex === heading.physicalLineExtent.endLineIndex
  )));

  assert.deepEqual(index.concepts.map((concept) => concept.kind), [
    'concept-question', 'concept-primary'
  ], 'the predecessor Concept API remains level-2-only');
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.fullRange)), [
    '?## Question Concept\nquestion body\n',
    '-## Primary Concept\n?### Question Subheading\n-### Primary Subheading\ntail'
  ], 'H1/H3 presentation descriptors never repartition existing level-2 Concepts');
  assert.equal(Object.hasOwn(index.headings[0], 'kind'), false,
    'the root heading does not invent a primary/question Concept kind');
  assertDeeplyFrozen(index.headings);
});

test('HN heading recognition stays exact at physical line start and accepts inline title syntax', () => {
  const source = [
    '## Not a HN heading',
    '### Not a HN heading',
    '#### Not a HN heading',
    '?#### Too deep',
    '-#### Too deep',
    ' # Indented',
    'text # Inline',
    '#No space',
    '#\tTab separator',
    '#   ',
    '# Root **bold** $x$',
    '?### [Linked](https://example.com) *question*',
    '-### <u>Primary</u> `code`'
  ].join('\n');
  const { index } = build(source);

  assert.deepEqual(index.headings.map((heading) => slice(source, heading.headerRange)), [
    '# Root **bold** $x$',
    '?### [Linked](https://example.com) *question*',
    '-### <u>Primary</u> `code`'
  ]);
  assert.deepEqual(index.headings.map((heading) => heading.headingLevel), [1, 3, 3]);
  assert.deepEqual(index.concepts, [], 'H1/H3 do not create level-2 Concepts');
});

test('reserved source owners suppress heading-like prefixes without hiding legitimate titles', () => {
  const source = [
    '# Visible root',
    '-## Visible concept',
    '```text',
    '# Hidden root',
    '?### Hidden subheading',
    '```',
    '$$',
    '-### Hidden math subheading',
    '$$',
    '<div>',
    '# Hidden html root',
    '</div>',
    '| A |',
    '| --- |',
    '-### Hidden table subheading',
    '',
    '?### Visible [link](https://example.com) title'
  ].join('\n');
  const { index } = build(source);

  assert.deepEqual(index.headings.map((heading) => slice(source, heading.headerRange)), [
    '# Visible root',
    '-## Visible concept',
    '?### Visible [link](https://example.com) title'
  ]);
});

test('heading presentation does not widen root block ownership or the strict Semantic Block grammar', () => {
  const source = [
    '# Root',
    '?{',
    'root-only remains literal',
    '/}',
    '-## Concept',
    '?{',
    '?### Heading inside description',
    '/}',
    '>> ',
    'trailing-space opener stays literal',
    '>>'
  ].join('\n');
  const { index } = build(source);

  assert.deepEqual(index.headings.map((heading) => heading.headingLevel), [1, 2, 3]);
  assert.deepEqual(index.semanticBlocks.map((block) => block.kind), ['description']);
  assert.equal(slice(source, index.semanticBlocks[0].fullRange), [
    '?{', '?### Heading inside description', '/}'
  ].join('\n') + '\n');
  assert.ok(index.semanticBlocks[0].fullRange.start <= index.headings[2].headerRange.start
    && index.headings[2].headerRange.end <= index.semanticBlocks[0].fullRange.end,
  'a heading may share presentation with an existing uninterrupted Semantic Block');
});

test('reserved inline syntax in a Concept title does not mask its line-start structural prefix', () => {
  const source = [
    '-## Energy $E=mc^2$',
    'text',
    '?## Compare `x`',
    'text',
    '-## [Linked](https://example.com) title',
    'text',
    '?## <u>under</u> title',
    'text'
  ].join('\n');
  const { index } = build(source);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.headerRange)), [
    '-## Energy $E=mc^2$',
    '?## Compare `x`',
    '-## [Linked](https://example.com) title',
    '?## <u>under</u> title'
  ]);
  assert.deepEqual(index.concepts.map((concept) => concept.kind), [
    'concept-primary', 'concept-question', 'concept-primary', 'concept-question'
  ]);
});

test('all three Semantic Block families expose exact child and parent source ranges', () => {
  const source = [
    '-## A',
    '',
    '>',
    'analogy',
    '>',
    '',
    '>>',
    'example',
    '>>',
    '',
    '?{',
    'description',
    '/}'
  ].join('\n');
  const { index } = build(source, 3);
  const concept = index.concepts[0];
  const blocks = concept.semanticBlocks;

  assert.deepEqual(blocks.map((block) => block.kind), [
    'reformulation', 'example', 'description'
  ]);
  assert.deepEqual(blocks.map((block) => slice(source, block.fullRange)), [
    '>\nanalogy\n>\n',
    '>>\nexample\n>>\n',
    '?{\ndescription\n/}'
  ]);
  assert.deepEqual(blocks.map((block) => slice(source, block.bodyRange)), [
    'analogy\n', 'example\n', 'description\n'
  ]);
  assert.deepEqual(blocks.map((block) => slice(source, block.openingMarkerRange)), [
    '>', '>>', '?{'
  ]);
  assert.deepEqual(blocks.map((block) => slice(source, block.closingMarkerRange)), [
    '>', '>>', '/}'
  ]);
  assert.ok(blocks.every((block) => block.parentConceptId === concept.id));
  assert.ok(blocks.every((block) => (
    concept.fullRange.start <= block.fullRange.start
      && block.fullRange.end <= concept.fullRange.end
  )));
  assert.equal(index.semanticBlocks.length, 3);
  assert.equal(index.semanticBlockAtOffset(blocks[1].bodyRange.start), blocks[1]);
  assert.equal(index.semanticBlockById(blocks[2].id), blocks[2]);
});

test('multiline bodies remain exact and Description closes only on standalone /}', () => {
  const multiline = build('-## A\n>>\nline 1\nline 2\nline 3\n>>').index.semanticBlocks[0];
  assert.equal(multiline.kind, 'example');
  assert.equal(multiline.physicalLineExtent.lineCount, 5);

  const source = [
    '-## A',
    '?{',
    'x^{2}',
    'ordinary }',
    'ordinary ?}',
    'ordinary /} inside text',
    '/}'
  ].join('\n');
  const { index } = build(source);
  assert.equal(index.semanticBlocks.length, 1);
  assert.equal(slice(source, index.semanticBlocks[0].bodyRange), [
    'x^{2}',
    'ordinary }',
    'ordinary ?}',
    'ordinary /} inside text',
    ''
  ].join('\n'));
  assert.equal(slice(source, index.semanticBlocks[0].closingMarkerRange), '/}');
});

test('markers are strict physical lines and semantic pairs outside Concepts stay literal', () => {
  const source = [
    '>',
    'outside',
    '>',
    '-##A',
    '?##C',
    ' -## Indented',
    'text -## Inline',
    '-## A',
    'text ?{ text',
    'text /} text',
    '?}',
    '}',
    '^{}',
    '^^{}',
    ' ?{',
    '?{ ',
    '/} ',
    '> text',
    '> ',
    '>',
    'valid',
    '>'
  ].join('\n');
  const { index } = build(source);
  assert.equal(index.concepts.length, 1);
  assert.equal(index.semanticBlocks.length, 1);
  assert.equal(index.semanticBlocks[0].kind, 'reformulation');
  assert.equal(slice(source, index.semanticBlocks[0].bodyRange), 'valid\n');
});

test('existing inline/display math ownership suppresses structural recognition', () => {
  const source = [
    '-## A',
    '$?{ x /}$',
    '$$',
    '?{',
    'x^{2}',
    '/}',
    '-## Hidden',
    '>>',
    '$$',
    '?{',
    'real',
    '/}',
    '?## B',
    'tail'
  ].join('\n');
  const { snapshot, index } = build(source, 11);
  assert.deepEqual(snapshot.semanticIndex.ownersOfType('inlineMath', 'math').map((owner) => (
    slice(source, owner)
  )), [
    '$?{ x /}$',
    '$$\n?{\nx^{2}\n/}\n-## Hidden\n>>\n$$'
  ]);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.headerRange)), [
    '-## A', '?## B'
  ]);
  assert.equal(index.concepts[0].semanticBlocks.length, 1);
  assert.equal(index.concepts[0].semanticBlocks[0].kind, 'description');
  assert.equal(slice(source, index.concepts[0].semanticBlocks[0].bodyRange), 'real\n');
  assert.equal(index.concepts[1].semanticBlocks.length, 0);

  const unclosed = build('-## A\n$$\n?{\n/}\n?## Hidden').index;
  assert.deepEqual(unclosed.concepts.map((concept) => concept.kind), ['concept-primary']);
  assert.deepEqual(unclosed.semanticBlocks, []);

  const multilineInlineSource = [
    '-## A',
    '$inline',
    '-## Hidden inline',
    '?{',
    '/}',
    'inline$',
    '?## B'
  ].join('\n');
  const multilineInline = build(multilineInlineSource);
  assert.deepEqual(multilineInline.snapshot.semanticIndex.ownersOfType('inlineMath')
    .map((owner) => slice(multilineInlineSource, owner)), [
    '$inline\n-## Hidden inline\n?{\n/}\ninline$'
  ]);
  assert.deepEqual(multilineInline.index.concepts.map((concept) => (
    slice(multilineInlineSource, concept.headerRange)
  )), ['-## A', '?## B']);
  assert.deepEqual(multilineInline.index.semanticBlocks, []);
});

test('fenced code, multiline links, raw HTML, and Tables keep marker-looking rows reserved', () => {
  const source = [
    '-## A',
    '```text',
    '-## Hidden code',
    '?{',
    '/}',
    '>>',
    '```',
    '[label',
    '-## Hidden link',
    '?{',
    '/}',
    '](https://example.com)',
    '<div>',
    '-## Hidden html',
    '?{',
    '/}',
    '</div>',
    '',
    '| A |',
    '| --- |',
    '-## Hidden table',
    '?{',
    '/}',
    '',
    '?## B',
    'done'
  ].join('\n');
  const { snapshot, index } = build(source);
  assert.ok(snapshot.semanticIndex.ownersOfType('code').length > 0);
  assert.ok(snapshot.semanticIndex.ownersOfType('link').length > 0);
  assert.ok(snapshot.semanticIndex.ownersOfType('html').length > 0);
  assert.ok(snapshot.semanticIndex.ownersOfType('table').length > 0);
  assert.deepEqual(index.concepts.map((concept) => slice(source, concept.headerRange)), [
    '-## A', '?## B'
  ]);
  assert.deepEqual(index.semanticBlocks, []);
});

test('Semantic Blocks do not nest and unmatched openers remain literal without swallowing later structure', () => {
  const nonNestedSource = [
    '-## A',
    '?{',
    'outer',
    '>>',
    'inner-looking',
    '>>',
    '>',
    'also literal',
    '>',
    '/}'
  ].join('\n');
  const nonNested = build(nonNestedSource).index;
  assert.equal(nonNested.semanticBlocks.length, 1);
  assert.equal(nonNested.semanticBlocks[0].kind, 'description');
  assert.equal(slice(nonNestedSource, nonNested.semanticBlocks[0].bodyRange), [
    'outer', '>>', 'inner-looking', '>>', '>', 'also literal', '>', ''
  ].join('\n'));

  const malformedSource = [
    '-## A',
    '?{',
    'description with no close',
    '',
    '-## B',
    '>',
    'unmatched reformulation',
    '>>',
    'valid example',
    '>>'
  ].join('\n');
  const malformed = build(malformedSource).index;
  assert.equal(malformed.concepts.length, 2);
  assert.equal(malformed.concepts[0].semanticBlocks.length, 0);
  assert.deepEqual(malformed.concepts[1].semanticBlocks.map((block) => block.kind), ['example']);
  assert.equal(slice(malformedSource, malformed.concepts[1].semanticBlocks[0].bodyRange),
    'valid example\n');

  for (const opener of ['>', '>>', '?{']) {
    const eof = build(`-## A\n${opener}\nunclosed at EOF`).index;
    assert.deepEqual(eof.semanticBlocks, [], `${opener} remains literal at EOF`);
  }
});

test('CRLF, Unicode, trailing newline, identities, and all descriptors remain exact and immutable', () => {
  const source = '-## α\r\n>>\r\nline 👩🏽‍🔬\r\n>>\r\n';
  const first = build(source, 21);
  const second = build(source, 21);
  const changedVersion = build(source, 22);

  assert.equal(slice(source, first.index.concepts[0].fullRange), source);
  assert.equal(slice(source, first.index.semanticBlocks[0].bodyRange), 'line 👩🏽‍🔬\r\n');
  assert.deepEqual(first.index.concepts[0].physicalLineExtent, {
    startLineIndex: 0,
    endLineIndex: 4,
    lineCount: 5
  }, 'a final Concept reaches the SourceSnapshot terminal empty row at EOF');
  assert.deepEqual(first.index.semanticBlocks[0].physicalLineExtent, {
    startLineIndex: 1,
    endLineIndex: 3,
    lineCount: 3
  }, 'a Semantic Block ends on its closing marker rather than the following EOF row');
  assert.deepEqual(descriptorShape(first.index), descriptorShape(second.index));
  assert.deepEqual(headingShape(first.index), headingShape(second.index));
  assert.notEqual(first.index.concepts[0].id, changedVersion.index.concepts[0].id);
  assert.notEqual(first.index.headings[0].id, changedVersion.index.headings[0].id);
  assert.deepEqual(first.index.concepts[0].fullRange, changedVersion.index.concepts[0].fullRange);
  assertDeeplyFrozen(first.index);
  assert.throws(() => {
    first.index.concepts.push({});
  }, TypeError);
  assert.throws(() => {
    first.index.concepts[0].fullRange.end = 0;
  }, TypeError);
  assert.equal(Object.hasOwn(first.index.concepts[0], 'title'), false,
    'derived descriptors do not copy canonical title text');
});

test('builder fails closed without parsed ownership and never becomes persisted HN metadata', () => {
  assert.throws(() => structureModel.createHnStructureIndex({
    markdownBody: '-## A',
    physicalLineIndex: { lines: [] }
  }), /immutable SourceSnapshot/);

  const parsed = markdown.createSourceSnapshot('-## A', { version: 1 });
  const mutableSnapshotLike = { ...parsed };
  assert.throws(() => structureModel.createHnStructureIndex(mutableSnapshotLike),
    /immutable SourceSnapshot/);
  const invalidVersionSnapshot = Object.freeze({
    ...parsed,
    version: undefined,
    sourceVersion: undefined
  });
  assert.throws(() => structureModel.createHnStructureIndex(invalidVersionSnapshot),
    /valid SourceSnapshot version/);

  const envelope = hnText.createEmptyEnvelope();
  assert.equal(hnText.validateCurrentEnvelope({
    ...envelope,
    hnStructureIndex: {}
  }).ok, false);
  assert.deepEqual(envelope, {
    schemaVersion: 3,
    revision: 0,
    source: '',
    anchors: {}
  });
});

test('HN strategy attaches one revision-scoped index without changing exact-source plans or Markdown snapshots', () => {
  const source = '-## A\n?{\nbody\n/}';
  const strategy = sourceEditor.createHnBasicPresentationStrategy();
  const first = strategy.createSourceSnapshot(source, { version: 5 });
  const reused = strategy.createSourceSnapshot(source, {
    previousSnapshot: first,
    version: 5
  });
  const changed = strategy.createSourceSnapshot(`${source}\nnext`, {
    previousSnapshot: first,
    version: 6
  });

  assert.equal(reused, first);
  assert.equal(first.hnStructureIndex.sourceVersion, 5);
  assert.deepEqual(first.hnStructureIndex.headings.map((heading) => heading.headingLevel), [2]);
  assert.equal(changed.hnStructureIndex.sourceVersion, 6);
  assert.notEqual(changed.hnStructureIndex, first.hnStructureIndex);
  assert.equal(first.source, source);
  assert.equal(first.markdownBody, source);

  const edit = strategy.createPresentationPlan(first, { mode: 'edit' });
  const browser = strategy.createPresentationPlan(first, { mode: 'browser' });
  for (const plan of [edit, browser]) {
    assert.equal(syntaxAdapters.validateEditablePresentationPlan(plan, first).ok, true);
    assert.equal(plan.lines.map((line) => (
      line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
    )).join(''), source);
    assert.equal(Object.hasOwn(plan.constructs, 'hnStructure'), false);
    assert.equal(Object.hasOwn(plan.constructs, 'concepts'), false);
  }

  const genericMarkdownSnapshot = markdown.createSourceSnapshot(source, { version: 5 });
  assert.equal(Object.hasOwn(genericMarkdownSnapshot, 'hnStructureIndex'), false,
    'the generic Markdown SourceSnapshot remains unchanged');
});
