'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const numbering = require('../public/hnListNumbering');
const structureModel = require('../public/hnStructureIndex');
const { createHnListIndex } = require('../public/hnListIndex');

const { SCHEMES } = numbering;

function build(source, version = 1) {
  const snapshot = markdown.createSourceSnapshot(source, { version });
  return {
    source,
    snapshot,
    index: createHnListIndex(snapshot)
  };
}

function slice(source, range) {
  return source.slice(range.start, range.end);
}

function assertDeeplyFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, 'every exposed index value is immutable');
  Object.values(value).forEach((child) => assertDeeplyFrozen(child, seen));
}

test('acceptance source derives two items and exact first/continuation/item ranges', () => {
  const source = '1. First\n   second paragraph\n2. Third';
  const { index } = build(source, 17);

  assert.equal(index.kind, 'hn-list-index');
  assert.equal(index.sourceVersion, 17);
  assert.equal(index.sourceLength, source.length);
  assert.equal(index.sequences.length, 1);
  assert.equal(index.items.length, 2);

  const sequence = index.sequences[0];
  const [first, second] = index.items;
  assert.deepEqual({
    depth: sequence.depth,
    scheme: sequence.scheme,
    dottedPrefix: sequence.dottedPrefix,
    startOrdinal: sequence.startOrdinal,
    authoredOrdinals: sequence.authoredOrdinals,
    sequential: sequence.sequential
  }, {
    depth: 0,
    scheme: SCHEMES.DECIMAL,
    dottedPrefix: null,
    startOrdinal: 1,
    authoredOrdinals: [1, 2],
    sequential: true
  });
  assert.equal(slice(source, sequence.sourceRange), source);
  assert.deepEqual(sequence.itemIds, [first.id, second.id]);
  assert.strictEqual(sequence.items[0], first);
  assert.strictEqual(sequence.items[1], second);

  assert.deepEqual(first.tabsRange, { start: 0, end: 0 });
  assert.deepEqual(first.markerRange, { start: 0, end: 2 });
  assert.deepEqual(first.separatorRange, { start: 2, end: 3 });
  assert.deepEqual(first.prefixRange, { start: 0, end: 3 });
  assert.deepEqual(first.firstParagraphRange, { start: 3, end: 8 });
  assert.equal(slice(source, first.markerRange), '1.');
  assert.equal(slice(source, first.separatorRange), ' ');
  assert.equal(slice(source, first.firstParagraphRange), 'First');
  assert.equal(first.textColumnWidth, 3);
  assert.equal(first.empty, false);

  assert.equal(first.continuationParagraphs.length, 1);
  const continuation = first.continuationParagraphs[0];
  assert.deepEqual(continuation.tabsRange, { start: 9, end: 9 });
  assert.deepEqual(continuation.paddingRange, { start: 9, end: 12 });
  assert.deepEqual(continuation.contentRange, { start: 12, end: 28 });
  assert.equal(slice(source, continuation.paddingRange), '   ');
  assert.equal(slice(source, continuation.contentRange), 'second paragraph');
  assert.equal(slice(source, continuation.fullRange), '   second paragraph\n');
  assert.deepEqual(first.paragraphRanges, [
    first.firstParagraphRange,
    continuation.contentRange
  ]);
  assert.equal(slice(source, first.itemRange), '1. First\n   second paragraph\n');
  assert.deepEqual(first.subtreeRange, first.itemRange);

  assert.equal(slice(source, second.markerRange), '2.');
  assert.equal(slice(source, second.firstParagraphRange), 'Third');
  assert.equal(slice(source, second.itemRange), '2. Third');
  assert.deepEqual(second.subtreeRange, second.itemRange);

  assert.strictEqual(index.sequenceById(sequence.id), sequence);
  assert.strictEqual(index.itemById(first.id), first);
  assert.strictEqual(index.itemAtOffset(first.markerRange.start), first);
  assert.strictEqual(index.itemAtOffset(continuation.contentRange.start + 3), first);
  assert.strictEqual(index.itemAtOffset(second.firstParagraphRange.end - 1), second);
  assert.strictEqual(index.itemAtLineIndex(1), first);
  assert.equal(index.parentOf(first.id), null);
  assert.deepEqual(index.childSequencesOf(first.id), []);
});

test('all five historical marker spellings retain exact scheme and ordinal metadata', () => {
  const source = [
    '12. Decimal',
    'plain barrier',
    '3.7.4. Dotted',
    'plain barrier',
    '(IV Upper Roman',
    'plain barrier',
    '(iv Lower Roman',
    'plain barrier',
    '(a Lower alpha'
  ].join('\n');
  const { index } = build(source);

  assert.equal(index.sequences.length, 5);
  assert.equal(index.items.length, 5);
  assert.deepEqual(index.items.map((item) => ({
    marker: slice(source, item.markerRange),
    markerValue: item.marker,
    scheme: item.scheme,
    ordinal: item.ordinal,
    path: item.path,
    depth: item.depth,
    textColumnWidth: item.textColumnWidth
  })), [
    { marker: '12.', markerValue: '12.', scheme: SCHEMES.DECIMAL,
      ordinal: 12, path: null, depth: 0, textColumnWidth: 4 },
    { marker: '3.7.4.', markerValue: '3.7.4.', scheme: SCHEMES.DOTTED_DECIMAL,
      ordinal: 4, path: [3, 7, 4], depth: 0, textColumnWidth: 7 },
    { marker: '(IV', markerValue: '(IV', scheme: SCHEMES.UPPER_ROMAN_LEFT,
      ordinal: 4, path: null, depth: 0, textColumnWidth: 4 },
    { marker: '(iv', markerValue: '(iv', scheme: SCHEMES.LOWER_ROMAN_LEFT,
      ordinal: 4, path: null, depth: 0, textColumnWidth: 4 },
    { marker: '(a', markerValue: '(a', scheme: SCHEMES.LOWER_ALPHA_LEFT,
      ordinal: 1, path: null, depth: 0, textColumnWidth: 3 }
  ]);
  assert.deepEqual(index.sequences.map((sequence) => sequence.dottedPrefix), [
    null, [3, 7], null, null, null
  ]);
});

test('one literal ASCII separator Space completes syntax and sequence context resolves alpha/Roman ambiguity', () => {
  const source = [
    '1.',
    '1.\tTab is not a separator',
    `1.\u00a0NBSP is not a separator`,
    '1. Complete',
    '2. ',
    '3.  leading content Space',
    'plain barrier',
    '(h Alpha',
    '(i Ambiguous alpha',
    '(j Alpha',
    'plain barrier',
    '(i Roman',
    '(ii Roman'
  ].join('\n');
  const { index } = build(source);

  assert.deepEqual(index.items.map((item) => slice(source, item.markerRange)), [
    '1.', '2.', '3.', '(h', '(i', '(j', '(i', '(ii'
  ]);
  assert.deepEqual(index.items.slice(0, 3).map((item) => (
    slice(source, item.firstParagraphRange)
  )), ['Complete', '', ' leading content Space']);
  assert.equal(index.items[1].empty, true, 'a prefix-only item is structurally empty');
  assert.equal(index.items[2].empty, false,
    'an additional authored Space belongs to content and must not be trimmed');

  const alphaSequence = index.sequences.find((sequence) => (
    sequence.scheme === SCHEMES.LOWER_ALPHA_LEFT
  ));
  const romanSequence = index.sequences.find((sequence) => (
    sequence.scheme === SCHEMES.LOWER_ROMAN_LEFT
  ));
  assert.deepEqual(alphaSequence.authoredOrdinals, [8, 9, 10]);
  assert.equal(alphaSequence.sequential, true);
  assert.deepEqual(romanSequence.authoredOrdinals, [1, 2]);
  assert.equal(romanSequence.sequential, true);
});

test('same-depth sequences span child subtrees while barriers and incompatible schemes partition ownership', () => {
  const source = [
    '5. Root A',
    '7. Root B',
    '\t1. Child A',
    '\t   Child continuation',
    '\t\t1. Grandchild',
    '\t2. Child B',
    '8. Root C',
    '',
    '9. Independent',
    '(IV Roman A',
    '(V Roman B',
    'plain barrier',
    '10. Later'
  ].join('\n');
  const { index } = build(source, 5);

  assert.equal(index.sequences.length, 6);
  const rootSequence = index.sequences.find((sequence) => (
    sequence.depth === 0 && sequence.startOrdinal === 5
  ));
  const childSequence = index.sequences.find((sequence) => (
    sequence.depth === 1 && sequence.startOrdinal === 1
  ));
  const grandchildSequence = index.sequences.find((sequence) => sequence.depth === 2);
  const independent = index.sequences.find((sequence) => (
    sequence.depth === 0 && sequence.startOrdinal === 9
  ));
  const roman = index.sequences.find((sequence) => (
    sequence.depth === 0 && sequence.scheme === SCHEMES.UPPER_ROMAN_LEFT
  ));
  const later = index.sequences.find((sequence) => (
    sequence.depth === 0 && sequence.startOrdinal === 10
  ));

  assert.deepEqual(rootSequence.authoredOrdinals, [5, 7, 8]);
  assert.equal(rootSequence.sequential, false,
    'authored gaps remain source truth and are reported rather than rewritten');
  assert.equal(slice(source, rootSequence.sourceRange), [
    '5. Root A',
    '7. Root B',
    '\t1. Child A',
    '\t   Child continuation',
    '\t\t1. Grandchild',
    '\t2. Child B',
    '8. Root C',
    ''
  ].join('\n'));
  assert.deepEqual(childSequence.authoredOrdinals, [1, 2]);
  assert.equal(childSequence.parentItemId, rootSequence.items[1].id);
  assert.equal(grandchildSequence.parentItemId, childSequence.items[0].id);
  assert.equal(independent.items.length, 1);
  assert.deepEqual(roman.authoredOrdinals, [4, 5]);
  assert.equal(later.items.length, 1);

  const rootB = rootSequence.items[1];
  const childA = childSequence.items[0];
  const grandchild = grandchildSequence.items[0];
  assert.strictEqual(index.parentOf(childA.id), rootB);
  assert.strictEqual(index.parentOf(childSequence.items[1].id), rootB);
  assert.strictEqual(index.parentOf(grandchild.id), childA);
  assert.deepEqual(index.childSequencesOf(rootB.id), [childSequence]);
  assert.deepEqual(index.childSequencesOf(childA.id), [grandchildSequence]);
  assert.deepEqual(rootB.childSequenceIds, [childSequence.id]);
  assert.deepEqual(rootB.childSequenceRanges, [childSequence.sourceRange]);

  assert.equal(slice(source, rootB.itemRange), '7. Root B\n');
  assert.equal(slice(source, rootB.subtreeRange), [
    '7. Root B',
    '\t1. Child A',
    '\t   Child continuation',
    '\t\t1. Grandchild',
    '\t2. Child B',
    ''
  ].join('\n'));
  assert.equal(slice(source, childA.itemRange), '\t1. Child A\n\t   Child continuation\n');
  assert.equal(slice(source, childA.subtreeRange), [
    '\t1. Child A',
    '\t   Child continuation',
    '\t\t1. Grandchild',
    ''
  ].join('\n'));
  assert.equal(slice(source, childA.tabsRange), '\t');
  assert.equal(slice(source, childA.continuationParagraphs[0].tabsRange), '\t');
  assert.equal(slice(source, childA.continuationParagraphs[0].paddingRange), '   ');
  assert.equal(slice(source, childA.continuationParagraphs[0].contentRange),
    'Child continuation');
});

test('ranges use physical UTF-16 offsets and preserve CRLF, Unicode, and revision-scoped identity', () => {
  const source = '10. 🧠α\r\n    続き🙂\r\n11. café';
  const firstBuild = build(source, 41);
  const repeatedBuild = build(source, 41);
  const nextRevision = build(source, 42);
  const { index } = firstBuild;
  const [first, second] = index.items;

  assert.equal(first.lineIndex, 0);
  assert.equal(second.lineIndex, 2);
  assert.equal(slice(source, first.firstParagraphRange), '🧠α');
  assert.equal(first.firstParagraphRange.end - first.firstParagraphRange.start, 3,
    'ranges are UTF-16 offsets, so the astral symbol occupies two code units');
  assert.equal(slice(source, first.continuationParagraphs[0].contentRange), '続き🙂');
  assert.equal(first.continuationParagraphs[0].contentRange.end
    - first.continuationParagraphs[0].contentRange.start, 4);
  assert.equal(slice(source, first.itemRange), '10. 🧠α\r\n    続き🙂\r\n');
  assert.equal(slice(source, index.sequences[0].sourceRange), source);
  assert.strictEqual(index.itemAtLineIndex(0), first);
  assert.strictEqual(index.itemAtLineIndex(1), first);
  assert.strictEqual(index.itemAtLineIndex(2), second);

  assert.deepEqual(repeatedBuild.index.items.map((item) => item.id),
    index.items.map((item) => item.id), 'same source revision has deterministic IDs');
  assert.deepEqual(repeatedBuild.index.sequences.map((sequence) => sequence.id),
    index.sequences.map((sequence) => sequence.id));
  assert.notDeepEqual(nextRevision.index.items.map((item) => item.id),
    index.items.map((item) => item.id), 'derived identities are revision-scoped');
  assert.notDeepEqual(nextRevision.index.sequences.map((sequence) => sequence.id),
    index.sequences.map((sequence) => sequence.id));
});

test('reserved code, math, table, and safe-HTML owners suppress false markers without over-masking item content', () => {
  const source = [
    '```text',
    '1. hidden code',
    '```',
    '',
    '$$',
    '2. hidden math',
    '$$',
    '',
    '<div>',
    '3. hidden html',
    '</div>',
    '',
    '| Value |',
    '| --- |',
    '| 4. hidden table |',
    '',
    '5. [visible link](https://example.com)',
    '6. inline $math$ remains content'
  ].join('\n');
  const { snapshot, index } = build(source);
  const ownerTypes = new Set(snapshot.semanticIndex.owners.map((owner) => owner.type));

  for (const type of ['code', 'math', 'table', 'html', 'link', 'inlineMath']) {
    assert.equal(ownerTypes.has(type), true, `fixture exercises reserved ${type} ownership`);
  }
  assert.deepEqual(index.items.map((item) => slice(source, item.markerRange)), ['5.', '6.']);
  assert.deepEqual(index.items.map((item) => slice(source, item.firstParagraphRange)), [
    '[visible link](https://example.com)',
    'inline $math$ remains content'
  ]);
  assert.equal(index.sequences.length, 1);
  assert.equal(index.sequences[0].sequential, true);
});

test('all matched HN Semantic Block families keep marker-looking body rows literal', () => {
  const source = [
    '-## Concept',
    '>>',
    '1. literal Example body',
    '>>',
    '?{',
    '2. literal Description body',
    '/}',
    '>',
    '3. literal Reformulation body',
    '>',
    '4. Outside block'
  ].join('\n');
  const { snapshot, index } = build(source);
  const structure = structureModel.createHnStructureIndex(snapshot);

  assert.deepEqual(structure.semanticBlocks.map((block) => block.kind), [
    structureModel.SEMANTIC_KINDS.EXAMPLE,
    structureModel.SEMANTIC_KINDS.DESCRIPTION,
    structureModel.SEMANTIC_KINDS.REFORMULATION
  ], 'the fixture must exercise all three matched higher-precedence HN blocks');
  assert.deepEqual(index.items.map((item) => slice(source, item.markerRange)), ['4.']);
  for (const literal of [
    '1. literal Example body',
    '2. literal Description body',
    '3. literal Reformulation body'
  ]) {
    assert.equal(index.itemAtOffset(source.indexOf(literal)), null,
      'a marker-looking Semantic Block body row remains literal');
  }
});

test('continuations stop at explicit block owners without over-masking inline content or structural padding', () => {
  const blockFixtures = [
    {
      ownerType: 'code',
      lines: ['   ```text', '   9. fenced body', '   ```']
    },
    {
      ownerType: 'html',
      lines: ['   <div>', '   9. HTML body', '   </div>']
    },
    {
      ownerType: 'table',
      lines: ['   | Value |', '   | --- |', '   | 9. table body |']
    },
    {
      ownerType: 'math',
      lines: ['   $$', '   9. display math body', '   $$']
    }
  ];

  for (const fixture of blockFixtures) {
    const source = ['1. Before block', ...fixture.lines, '2. After block'].join('\n');
    const { snapshot, index } = build(source);
    const reservedOwner = snapshot.semanticIndex.owners.find((owner) => (
      owner.type === fixture.ownerType
    ));

    assert.ok(reservedOwner, `fixture must exercise reserved ${fixture.ownerType} ownership`);
    assert.deepEqual(index.items.map((item) => slice(source, item.markerRange)), ['1.', '2.']);
    assert.equal(index.items[0].continuationParagraphs.length, 0,
      `${fixture.ownerType} cannot be absorbed as List continuation paragraphs`);
    fixture.lines.forEach((lineText, lineOffset) => {
      assert.equal(index.itemAtLineIndex(lineOffset + 1), null,
        `${fixture.ownerType} row ${lineOffset + 1} remains outside List ownership`);
    });
  }

  const inlineSource = [
    '1. Inline owners remain content',
    '   [linked continuation](https://example.com)',
    '   inline $math$ continuation',
    '   <u>underlined continuation</u>',
    '2. Next'
  ].join('\n');
  const inline = build(inlineSource);
  assert.deepEqual(inline.index.items[0].paragraphs.map((paragraph) => (
    slice(inlineSource, paragraph.contentRange)
  )), [
    'Inline owners remain content',
    '[linked continuation](https://example.com)',
    'inline $math$ continuation',
    '<u>underlined continuation</u>'
  ]);
  assert.equal(inline.index.sequences.length, 1);

  const widePrefixSource = '3.7.4. Dotted\n       exact structural continuation';
  const widePrefix = build(widePrefixSource);
  assert.equal(widePrefix.index.items.length, 1);
  assert.deepEqual(widePrefix.index.items[0].paragraphs.map((paragraph) => (
    slice(widePrefixSource, paragraph.contentRange)
  )), ['Dotted', 'exact structural continuation'],
  'four-or-more exact structural padding spaces cannot be rejected merely as indented code');
});

test('fabricated frozen bodies fail closed before marker scanning begins', () => {
  function fabricatedSnapshot(source) {
    const line = Object.freeze({
      id: 'forged-line',
      index: 0,
      start: 0,
      contentEnd: source.length,
      sourceEnd: source.length,
      text: source
    });
    const lines = Object.freeze([line]);
    return Object.freeze({
      version: 1,
      sourceVersion: 1,
      markdownBody: source,
      physicalLineIndex: Object.freeze({
        lines,
        lineAtOffset() {
          return line;
        }
      }),
      semanticIndex: Object.freeze({ owners: Object.freeze([]) })
    });
  }

  for (const source of ['', 'plain source without a complete marker']) {
    assert.throws(
      () => createHnListIndex(fabricatedSnapshot(source)),
      /SourceSnapshot/,
      'parser/semantic provenance is required even when marker scanning would find nothing'
    );
  }
});

test('malformed prefixes and wrong continuation padding fail locally without swallowing later valid lists', () => {
  const source = [
    '1. Before',
    '2.',
    '3. After partial',
    '  wrong continuation width',
    '4. Recovered',
    '01. leading zero is invalid',
    '1.0. zero dotted component is invalid',
    '(IIII noncanonical Roman is invalid',
    '5. Final'
  ].join('\n');
  const { index } = build(source);

  assert.deepEqual(index.items.map((item) => slice(source, item.markerRange)), [
    '1.', '3.', '4.', '5.'
  ]);
  assert.deepEqual(index.items.map((item) => slice(source, item.firstParagraphRange)), [
    'Before', 'After partial', 'Recovered', 'Final'
  ]);
  assert.equal(index.sequences.length, 4,
    'each unrelated or malformed source barrier ends only the local sequence');
  assert.equal(index.itemAtOffset(source.indexOf('2.')), null);
  assert.equal(index.itemAtOffset(source.indexOf('wrong continuation')), null);
  assert.equal(index.itemAtOffset(source.indexOf('01.')), null);
  assert.equal(index.itemAtOffset(source.indexOf('(IIII')), null);
});

test('the public index, descriptors, ranges, arrays, and helper results are deeply immutable', () => {
  const source = '1. Parent\n\t1. Child\n2. Sibling';
  const { index } = build(source, 9);
  const parent = index.items.find((item) => item.depth === 0 && item.ordinal === 1);
  const child = index.items.find((item) => item.depth === 1);
  const children = index.childSequencesOf(parent.id);

  assertDeeplyFrozen(index);
  assertDeeplyFrozen(children);
  assert.strictEqual(index.itemById(child.id), child);
  assert.strictEqual(index.sequenceById(child.sequenceId), children[0]);
  assert.strictEqual(index.parentOf(child.id), parent);
  assert.equal(index.itemById('missing-item'), null);
  assert.equal(index.sequenceById('missing-sequence'), null);
  assert.equal(index.parentOf('missing-item'), null);
  assert.deepEqual(index.childSequencesOf('missing-item'), []);

  assert.throws(() => index.items.push(child), TypeError);
  assert.throws(() => children.push(index.sequences[0]), TypeError);
  assert.throws(() => {
    child.markerRange.start = 99;
  }, TypeError);
  assert.throws(() => createHnListIndex({
    markdownBody: source,
    physicalLineIndex: { lines: [] },
    semanticIndex: { owners: [] }
  }), TypeError, 'a mutable ad-hoc body cannot become a second canonical parser input');
});
