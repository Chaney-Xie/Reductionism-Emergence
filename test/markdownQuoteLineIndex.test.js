'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const foundation = require('../public/markdownEditableFoundation');
const markdown = require('../public/markdownPage');
const adapters = require('../public/js/markdownEditableSyntaxAdapters');
const {
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');
const {
  createCertificationProjection,
  positionKey
} = require('./helpers/markdownEditableCertificationHarness');

const CORPUS = Object.freeze([
  '> simple',
  '> first\n> second\n> third',
  '>> nested',
  '> > spaced nested',
  '> outer\n>> inner\n> outer again',
  'plain\n> quote\nplain',
  '> quote\n\n> quote after blank',
  '> \n> empty prefixed line',
  '> first\ncontinued',
  '>> inner\ncontinued\n> outer',
  '> heading\n# Heading',
  '> quote\n- unordered\n1. ordered\n- [ ] task',
  '> quote\n```md\n> fenced literal\n```',
  '    > indented code\n> quote',
  '> quote\n---\n| A | B |\n| - | - |\n| 1 | 2 |',
  '> *inline* [link](https://example.com) <u>html</u>',
  '\\> escaped\na > midline\n> quoted',
  '   > three spaces\n    > four spaces\n\t> tab',
  '>  > two-space nested\n>   > three-space nested\n>    > four-space nested\n>     > delayed',
  '>\t> tab nested\n>\t\t> delayed tab',
  '> CRLF\r\n> second\r\nplain',
  '> bare CR\r> second\rplain',
  '>> lowered\n> closes inner',
  '>>> lowered\n>> closes deepest',
  '```\n> not quote\n```\n\n> quote'
]);

function legacyBasePrefix(text) {
  const source = String(text || '');
  const leading = source.match(/^[ \t]*/)?.[0] || '';
  let cursor = leading.length;
  let depth = 0;
  const segmentEnds = [];
  while (source[cursor] === '>') {
    depth += 1;
    cursor += 1;
    if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
    segmentEnds.push(cursor);
  }
  return { leading, depth, end: cursor, segmentEnds };
}

function legacyPresentationPrefix(text, maximumDepth = Infinity) {
  const source = String(text || '');
  let cursor = 0;
  let depth = 0;
  const markerOffsets = [];
  while (cursor < source.length && depth < maximumDepth) {
    const attemptStart = cursor;
    let spaces = 0;
    while (spaces < 4 && source[cursor] === ' ') {
      cursor += 1;
      spaces += 1;
    }
    if (spaces > 3 || source[cursor] !== '>') {
      cursor = attemptStart;
      break;
    }
    markerOffsets.push(cursor);
    cursor += 1;
    if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
    depth += 1;
  }
  return { depth, start: 0, end: cursor, raw: source.slice(0, cursor), markerOffsets };
}

function legacyCommandFacts(text) {
  const source = String(text || '');
  const base = legacyBasePrefix(source);
  if (!base.depth) return {
    depth: 0,
    prefix: '',
    content: source,
    empty: false,
    oneLevelUpPrefix: ''
  };
  let prefixEnd = base.end;
  const padding = source.slice(prefixEnd).match(/^[ \t]*/)?.[0] || '';
  prefixEnd += padding.length;
  while (source[prefixEnd] === '>') {
    prefixEnd += 1;
    if (source[prefixEnd] === ' ' || source[prefixEnd] === '\t') prefixEnd += 1;
    prefixEnd += source.slice(prefixEnd).match(/^[ \t]*/)?.[0].length || 0;
  }
  const retainedEnd = base.depth > 1 ? base.segmentEnds[base.depth - 2] : 0;
  const retained = source.slice(0, retainedEnd);
  return {
    depth: base.depth,
    prefix: source.slice(0, prefixEnd),
    content: source.slice(prefixEnd),
    empty: source.slice(prefixEnd).trim().length === 0,
    oneLevelUpPrefix: retained && !/[ \t]$/.test(retained) ? `${retained} ` : retained
  };
}

function lineIntersectsOwner(owner, line) {
  const effectiveEnd = Math.max(line.contentEnd, line.sourceEnd, line.start + 1);
  return owner.start < effectiveEnd && owner.end > line.start;
}

function legacyQuoteDescriptors(snapshot) {
  return snapshot.physicalLineIndex.lines.flatMap((line) => {
    let best = null;
    snapshot.semanticIndex.owners.forEach((owner) => {
      if (!lineIntersectsOwner(owner, line)) return;
      const types = [...owner.ancestorTypes, owner.type];
      const ids = [...owner.ancestorIds, owner.id];
      const ownerIds = ids.filter((_id, index) => types[index] === 'blockquote');
      if (!ownerIds.length || best && best.ownerIds.length >= ownerIds.length) return;
      best = { ownerIds };
    });
    if (!best) return [];
    const prefix = legacyPresentationPrefix(line.text, best.ownerIds.length);
    return [{
      lineIndex: line.index,
      physicalLineId: line.id,
      depth: best.ownerIds.length,
      ownerIds: best.ownerIds.map(String),
      prefixStart: line.start,
      prefixEnd: line.start + prefix.end,
      prefix: snapshot.markdownBody.slice(line.start, line.start + prefix.end),
      contentStart: line.start + prefix.end,
      contentEnd: line.contentEnd,
      prefixDepth: prefix.depth
    }];
  });
}

function legacyRegions(quotes) {
  const tracks = new Map();
  quotes.forEach((quote) => {
    for (let depth = 1; depth <= quote.depth; depth += 1) {
      const ownerId = quote.ownerIds[depth - 1];
      const key = JSON.stringify([depth, ownerId]);
      if (!tracks.has(key)) tracks.set(key, []);
      tracks.get(key).push(quote);
    }
  });
  const regions = [];
  tracks.forEach((rows, key) => {
    const [depth, ownerId] = JSON.parse(key);
    let current = null;
    rows.sort((left, right) => left.lineIndex - right.lineIndex).forEach((row) => {
      if (!current || row.lineIndex !== current.lastLineIndex + 1) {
        current = {
          depth,
          ownerId,
          firstLineIndex: row.lineIndex,
          lastLineIndex: row.lineIndex,
          physicalLineIds: [row.physicalLineId]
        };
        regions.push(current);
      } else {
        current.lastLineIndex = row.lineIndex;
        current.physicalLineIds.push(row.physicalLineId);
      }
    });
  });
  return regions.sort((left, right) => left.firstLineIndex - right.firstLineIndex
    || left.depth - right.depth || left.lastLineIndex - right.lastLineIndex);
}

function legacyShadowInsertions(snapshot) {
  const lines = snapshot.physicalLineIndex.lines;
  return lines.slice(1).flatMap((line, index) => {
    const previous = lines[index];
    const previousPrefix = legacyBasePrefix(previous.text);
    const currentPrefix = legacyBasePrefix(line.text);
    if (currentPrefix.depth <= 0
      || previousPrefix.depth <= currentPrefix.depth
      || previous.text.slice(previousPrefix.end).trim().length === 0) return [];
    return [{
      offset: line.start,
      value: `${line.text.slice(0, currentPrefix.end)}${previous.lineEnding || '\n'}`,
      previousLineIndex: previous.index,
      lineIndex: line.index
    }];
  });
}

test('one immutable revision-owned QuoteLineIndex mirrors the exact physical source', () => {
  const snapshot = markdown.createSourceSnapshot('> A\r\ncontinued\r\n> B');
  const index = snapshot.quoteLineIndex;
  assert.equal(snapshot.QuoteLineIndex, index);
  assert.equal(index.sourceVersion, snapshot.version);
  assert.equal(index.markdownBody, snapshot.markdownBody);
  assert.equal(index.sourceLength, snapshot.markdownBody.length);
  assert.equal(index.physicalLineIndex, snapshot.physicalLineIndex);
  assert.equal(index.lines.length, snapshot.physicalLineIndex.lines.length);
  assert.ok(Object.isFrozen(index));
  assert.ok(Object.isFrozen(index.lines));
  assert.ok(Object.isFrozen(index.regions));
  index.lines.forEach((line, lineIndex) => {
    const physical = snapshot.physicalLineIndex.lines[lineIndex];
    assert.equal(line.physicalLineId, physical.id);
    assert.deepEqual({ ...line.sourceRange }, {
      start: physical.start,
      contentEnd: physical.contentEnd,
      sourceEnd: physical.sourceEnd
    });
    assert.equal(index.lineAt(lineIndex), line);
    assert.equal(index.lineByPhysicalLineId(physical.id), line);
    assert.ok(Object.isFrozen(line));
    assert.ok(Object.isFrozen(line.command));
  });
});

test('the differential corpus preserves every legacy prefix, AST merge, region, and shadow fact', () => {
  CORPUS.forEach((source) => {
    const snapshot = markdown.createSourceSnapshot(source);
    const index = snapshot.quoteLineIndex;
    const legacyQuotes = legacyQuoteDescriptors(snapshot);
    assert.deepEqual(index.quotedLines.map((line) => ({
      lineIndex: line.lineIndex,
      physicalLineId: line.physicalLineId,
      depth: line.semanticDepth,
      ownerIds: [...line.ownerIds],
      prefixStart: line.prefixStart,
      prefixEnd: line.prefixEnd,
      prefix: line.prefix,
      contentStart: line.contentStart,
      contentEnd: line.contentEnd,
      prefixDepth: line.prefixDepth
    })), legacyQuotes, source);
    assert.deepEqual(index.regions.map((region) => ({
      depth: region.depth,
      ownerId: region.ownerId,
      firstLineIndex: region.firstLineIndex,
      lastLineIndex: region.lastLineIndex,
      physicalLineIds: [...region.physicalLineIds]
    })), legacyRegions(legacyQuotes), source);
    assert.deepEqual(index.lines.map((line) => ({
      depth: line.presentationPrefix.depth,
      start: line.presentationPrefix.start,
      end: line.presentationPrefix.end,
      raw: line.presentationPrefix.raw,
      markerOffsets: [...line.presentationPrefix.markerOffsets]
    })), snapshot.physicalLineIndex.lines.map((line) => (
      legacyPresentationPrefix(line.text)
    )), source);
    index.lines.forEach((line) => {
      const expected = legacyCommandFacts(line.text);
      assert.deepEqual({
        depth: line.command.depth,
        prefix: line.command.prefix,
        content: line.command.content,
        empty: line.command.empty,
        oneLevelUpPrefix: line.command.oneLevelUpPrefix
      }, expected, `${source}: command line ${line.lineIndex}`);
    });
    assert.deepEqual(
      foundation.createQuoteLineSeed(source, snapshot.physicalLineIndex)
        .parserShadowInsertions.map((entry) => ({ ...entry })),
      legacyShadowInsertions(snapshot),
      `${source}: parser shadow insertions`
    );
  });
});

test('physical, semantic, and command quote facts stay deliberately distinct', () => {
  const facts = (source, lineIndex = 0) => {
    const line = markdown.createSourceSnapshot(source).quoteLineIndex.lines[lineIndex];
    return {
    membership: line.membershipKind,
    reconciliation: line.reconciliationStatus,
    semanticDepth: line.semanticDepth,
    physicalDepth: line.physicalDepth,
    prefixDepth: line.prefixDepth,
    commandDepth: line.command.depth,
    commandPrefix: line.command.prefix
    };
  };
  assert.deepEqual([
    facts('> A'),
    facts('> A\ncontinued', 1),
    facts('>  > two-space'),
    facts('>     > delayed'),
    facts('    > code'),
    facts('plain'),
    facts('```\n> fenced\n```', 1),
    facts('```', 0)
  ], [
    { membership: 'explicit', reconciliation: 'aligned', semanticDepth: 1,
      physicalDepth: 1, prefixDepth: 1, commandDepth: 1, commandPrefix: '> ' },
    { membership: 'lazy', reconciliation: 'lazy', semanticDepth: 1,
      physicalDepth: 0, prefixDepth: 0, commandDepth: 0, commandPrefix: '' },
    { membership: 'explicit', reconciliation: 'aligned', semanticDepth: 2,
      physicalDepth: 2, prefixDepth: 2, commandDepth: 1, commandPrefix: '>  > ' },
    { membership: 'explicit', reconciliation: 'aligned', semanticDepth: 1,
      physicalDepth: 1, prefixDepth: 1, commandDepth: 1, commandPrefix: '>     > ' },
    { membership: 'physical-only', reconciliation: 'physical-only', semanticDepth: 0,
      physicalDepth: 0, prefixDepth: 0, commandDepth: 1, commandPrefix: '    > ' },
    { membership: 'none', reconciliation: 'none', semanticDepth: 0,
      physicalDepth: 0, prefixDepth: 0, commandDepth: 0, commandPrefix: '' },
    { membership: 'physical-only', reconciliation: 'physical-only', semanticDepth: 0,
      physicalDepth: 1, prefixDepth: 0, commandDepth: 1, commandPrefix: '> ' },
    { membership: 'none', reconciliation: 'none', semanticDepth: 0,
      physicalDepth: 0, prefixDepth: 0, commandDepth: 0, commandPrefix: '' }
  ]);
  const nested = markdown.createSourceSnapshot('>> nested').quoteLineIndex;
  assert.ok(Object.isFrozen(nested.explicitPrefixSegments));
  assert.deepEqual(nested.explicitPrefixSegments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    lineIndex: segment.lineIndex,
    physicalLineId: segment.physicalLineId,
    ownerId: segment.ownerId
  })), [
    { start: 0, end: 1, lineIndex: 0, physicalLineId: nested.lines[0].physicalLineId,
      ownerId: nested.lines[0].ownerIds[0] },
    { start: 1, end: 3, lineIndex: 0, physicalLineId: nested.lines[0].physicalLineId,
      ownerId: nested.lines[0].ownerIds[1] }
  ]);
  assert.equal(nested.prefixSegmentsInRange(0, 3).length, 2);
  assert.equal(nested.prefixSegmentsInRange(1, 3).length, 1);
  assert.ok(Object.isFrozen(nested.prefixSegmentsInRange(0, 3)));
  const spaced = markdown.createSourceSnapshot('>  > nested').quoteLineIndex;
  assert.equal(spaced.prefixSegmentsInRange(0, 5).length, 2);
  assert.equal(spaced.prefixSegmentsInRange(3, 5).length, 1);
});

test('Enter and Shift+Enter consume indexed command facts without changing approved bytes', () => {
  const continuations = [
    ['> text', '> '],
    ['>  text', '>  '],
    ['>> text', '>> '],
    ['> > text', '> > '],
    ['   > text', '   > '],
    ['    > text', '    > '],
    ['\t> text', '\t> '],
    ['>     > text', '>     > ']
  ];
  continuations.forEach(([source, prefix]) => {
    for (const options of [{}, { inputType: 'insertLineBreak' }]) {
      const result = markdown.applyMarkdownNewline(
        source,
        { anchor: source.length, focus: source.length },
        options
      );
      assert.equal(result.source, `${source}\n${prefix}`, source);
      assert.equal(result.editKind, 'quote-continuation');
      assert.equal(result.replacement, `\n${prefix}`);
    }
  });
  for (const [source, expected] of [
    ['>', '\n'],
    ['> ', '\n'],
    ['>> ', '> '],
    ['> > ', '> '],
    ['>    > ', '\n']
  ]) {
    const result = markdown.applyMarkdownNewline(source, {
      anchor: source.length,
      focus: source.length
    });
    assert.equal(result.source, expected, source);
    assert.equal(result.editKind, 'quote-outdent');
  }
});

test('Source and Live project the same indexed descriptors and never mutate them with activation', () => {
  const source = '> outer\n>> inner\ncontinued\n> outer';
  const snapshot = markdown.createSourceSnapshot(source);
  const before = JSON.stringify(snapshot.quoteLineIndex.lines.map((line) => ({
    prefix: line.prefix,
    ownerIds: line.ownerIds,
    regions: line.regionIds
  })));
  const sourcePlan = adapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'source'
  });
  const activeLine = snapshot.physicalLineIndex.lines[1];
  const livePlan = adapters.buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview',
    activePhysicalLineIds: [activeLine.id]
  });
  assert.deepEqual(sourcePlan.constructs.quotes.map((quote) => quote.regionIds),
    livePlan.constructs.quotes.map((quote) => quote.regionIds));
  assert.equal(livePlan.constructs.quotes.filter((quote) => quote.active).length, 1);
  assert.equal(JSON.stringify(snapshot.quoteLineIndex.lines.map((line) => ({
    prefix: line.prefix,
    ownerIds: line.ownerIds,
    regions: line.regionIds
  }))), before);
});

test('Reading keeps its accepted DOM geometry while every quote container is index-backed', () => {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents'
  ]);
  const fixtures = [
    {
      source: '> A\n>\n> B',
      quoteCount: 1,
      paragraphTags: ['P', 'P'],
      blankCount: 1,
      sourceDepths: [1, 1],
      transitionCount: 1
    },
    {
      source: '>> A\n> B\nC',
      quoteCount: 2,
      paragraphTags: ['DIV', 'DIV'],
      blankCount: 0,
      sourceDepths: [2, 1, 1],
      transitionCount: 1
    },
    {
      source: '>> Quote\n>> ',
      quoteCount: 2,
      paragraphTags: ['P'],
      blankCount: 1,
      sourceDepths: [2, 1],
      transitionCount: 1
    },
    {
      source: '> outer\n>> inner\n> back',
      quoteCount: 2,
      paragraphTags: ['DIV', 'DIV', 'DIV'],
      blankCount: 0,
      sourceDepths: [1, 2, 1, 1],
      transitionCount: 2
    }
  ];
  fixtures.forEach((fixture) => {
    const snapshot = markdown.createSourceSnapshot(fixture.source);
    const rendered = renderSemanticSegments(view, fixture.source, {
      mode: 'reading',
      sourceSnapshot: snapshot,
      sourceVersion: snapshot.version
    });
    const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
    const elements = (className) => nodes.filter((node) => (
      node?.nodeType === 1 && node.classList.contains(className)
    ));
    const quotes = elements('markdown-page-quote');
    assert.equal(quotes.length, fixture.quoteCount, fixture.source);
    assert.deepEqual(quotes.map((quote) => quote.dataset.markdownQuoteOwner),
      snapshot.quoteLineIndex.astQuotes.map((quote) => quote.ownerId), fixture.source);
    assert.deepEqual(quotes.map((quote) => quote.dataset.markdownQuoteRegions),
      snapshot.quoteLineIndex.astQuotes.map((quote) => quote.regionIds.join(' ')), fixture.source);
    assert.deepEqual(elements('markdown-page-paragraph').map((node) => node.tagName),
      fixture.paragraphTags, fixture.source);
    assert.equal(elements('markdown-page-quote-blank-line').length,
      fixture.blankCount, fixture.source);
    assert.equal(elements('markdown-page-quote-transition').length,
      fixture.transitionCount, fixture.source);
    assert.deepEqual(elements('markdown-page-quote-source-line').map((node) => (
      Number(node.dataset.markdownQuoteDepth)
    )), fixture.sourceDepths, fixture.source);
  });
});

test('Reading continuation projection preserves the indexed one-separator dialect', () => {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents'
  ]);
  for (const fixture of [
    { source: '>  > e\n>  > e', prefixEnd: 5, value: 'e' },
    { source: '>   > f\n>   > f', prefixEnd: 6, value: 'f' },
    { source: '>    > g\n>    > g', prefixEnd: 7, value: 'g' }
  ]) {
    const snapshot = markdown.createSourceSnapshot(fixture.source);
    const secondLine = snapshot.quoteLineIndex.lines[1];
    assert.equal(secondLine.readingContinuationPrefix.present, true);
    assert.equal(secondLine.readingContinuationPrefix.depth, 1);
    assert.equal(secondLine.readingContinuationPrefix.raw, '> ');
    assert.ok(secondLine.readingContinuationPrefix.end < secondLine.prefixEnd);

    const rendered = renderSemanticSegments(view, fixture.source, {
      mode: 'reading',
      sourceSnapshot: snapshot,
      sourceVersion: snapshot.version
    });
    const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
    const elements = (className) => nodes.filter((node) => (
      node?.nodeType === 1 && node.classList.contains(className)
    ));
    assert.equal(elements('markdown-page-quote').length, 2, fixture.source);
    assert.deepEqual(elements('markdown-page-quote-source-line').map((line) => (
      Number(line.dataset.markdownQuoteDepth)
    )), [2, 1], fixture.source);
    assert.equal(elements('is-quote-source-continuation').length, 1, fixture.source);
    const decoded = elements('markdown-decoded-source-construct');
    assert.equal(decoded.length, 1, fixture.source);
    assert.deepEqual([
      Number(decoded[0].dataset.markdownSourceStart),
      Number(decoded[0].dataset.markdownSourceEnd)
    ], [fixture.prefixEnd, fixture.source.length], fixture.source);
    assert.equal(elements('markdown-decoded-rendered')[0]?.textContent,
      `${fixture.value}\n${fixture.value}`, fixture.source);
    assert.equal(elements('is-inline-quote-source-line').length, 0, fixture.source);
    assert.equal(elements('markdown-source-line-break').length, 0, fixture.source);
    assert.equal(elements('markdown-source-mapped-text').length, 0, fixture.source);
  }
});

test('prefix, content, and cross-row caret positions round-trip in Source and Live', () => {
  const source = 'plain\n> > quoted\ncontinued\nplain';
  const snapshot = markdown.createSourceSnapshot(source);
  const quoteLine = snapshot.quoteLineIndex.lines[1];
  for (const mode of ['source', 'live-preview']) {
    const plan = adapters.buildEditablePresentationPlan(snapshot, { model: markdown, mode });
    const { projection } = createCertificationProjection(snapshot, mode, {
      presentationPlan: plan
    });
    const declared = projection.enumerateDeclaredPositions();
    const offsets = [
      quoteLine.prefixStart,
      quoteLine.prefixStart + 1,
      quoteLine.prefixStart + 2,
      quoteLine.prefixEnd,
      quoteLine.contentEnd,
      snapshot.quoteLineIndex.lines[2].start,
      snapshot.quoteLineIndex.lines[2].contentEnd
    ];
    const positions = offsets.map((offset) => declared.find((position) => (
      position.offset === offset
    ))).filter(Boolean);
    assert.equal(positions.length, offsets.length, `${mode}: every quote boundary is declared`);
    positions.forEach((position) => {
      const dom = projection.sourceToDom(position);
      assert.ok(dom, `${mode}: sourceToDom ${positionKey(position)}`);
      const roundTrip = projection.domToSource(dom.node, dom.offset, {
        allowRowFallback: false
      });
      assert.equal(positionKey(roundTrip), positionKey(position));
    });
    const selection = { anchor: positions[1], focus: positions.at(-1) };
    assert.equal(projection.restoreSelection(selection), true);
    const restored = projection.getSelection();
    assert.equal(positionKey(restored.anchor), positionKey(selection.anchor));
    assert.equal(positionKey(restored.focus), positionKey(selection.focus));
  }
});

test('IME, clipboard, exact deletion, and Undo keep canonical quote bytes and fresh indexes', () => {
  const view = loadMarkdownPageViewInternals([
    'canonicalMarkdownSelectionText',
    'createMarkdownEditHistory',
    'recordMarkdownEditTransaction',
    'stepMarkdownEditHistory'
  ]);
  const source = '> ATP transfers energy.';
  const before = markdown.createSourceSnapshot(source);
  const start = source.indexOf('ATP');
  const composition = foundation.applyCanonicalEdit(before, {
    anchor: start,
    focus: start + 3
  }, {
    start,
    end: start + 3,
    replacement: '腺苷三磷酸',
    kind: 'composition'
  }, {
    parseMarkdown: before.parseMarkdown,
    transactionKind: 'composition',
    inputType: 'insertCompositionText'
  });
  assert.equal(composition.source, '> 腺苷三磷酸 transfers energy.');
  assert.notEqual(composition.snapshot.quoteLineIndex, before.quoteLineIndex);
  assert.equal(composition.snapshot.quoteLineIndex.lines[0].prefix, '> ');
  assert.equal(composition.snapshot.quoteLineIndex.lines[0].semanticDepth, 1);

  assert.equal(view.canonicalMarkdownSelectionText(composition.source, {
    anchor: 0,
    focus: composition.source.indexOf('transfers') - 1
  }), '> 腺苷三磷酸');
  const deletion = markdown.applyMarkdownDeletion(composition.source, {
    anchor: 2,
    focus: 2
  }, 'backward');
  assert.equal(deletion.source, '>腺苷三磷酸 transfers energy.');
  assert.equal(deletion.snapshot.quoteLineIndex.lines[0].prefix, '>');

  const history = view.createMarkdownEditHistory(source);
  view.recordMarkdownEditTransaction(history, composition.transaction, {
    compositionId: 'quote-ime-1'
  });
  const undone = view.stepMarkdownEditHistory(history, 'undo', composition.source);
  assert.equal(undone.source, source);
  const redone = view.stepMarkdownEditHistory(history, 'redo', source);
  assert.equal(redone.source, composition.source);
});

test('a new source revision always owns a fresh index even when physical IDs survive', () => {
  const first = markdown.createSourceSnapshot('> A\nplain\n> B');
  const second = markdown.createSourceSnapshot('> A\nplain edited\n> B', {
    previousSnapshot: first
  });
  assert.notEqual(second.quoteLineIndex, first.quoteLineIndex);
  assert.equal(second.quoteLineIndex.sourceVersion, second.version);
  assert.equal(second.quoteLineIndex.lineAt(0).physicalLineId,
    first.quoteLineIndex.lineAt(0).physicalLineId);
  assert.equal(second.quoteLineIndex.lineAt(2).physicalLineId,
    first.quoteLineIndex.lineAt(2).physicalLineId);
  assert.equal(markdown.createSourceSnapshot(second.markdownBody, {
    previousSnapshot: second
  }), second);
});

test('production quote consumers contain no legacy raw scanner or rail coalescer', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const page = read('public/markdownPage.js');
  const adaptersSource = read('public/js/markdownEditableSyntaxAdapters.js');
  const view = read('public/js/markdownPageView.js');
  assert.doesNotMatch(page, /function markdownQuotePrefix\s*\(/);
  assert.doesNotMatch(page, /function editableQuoteContinuation\s*\(/);
  assert.doesNotMatch(adaptersSource, /function quotePrefix\s*\(/);
  const quoteMetadata = adaptersSource.slice(
    adaptersSource.indexOf('function quoteMetadata('),
    adaptersSource.indexOf('function linkLabelRange(', adaptersSource.indexOf('function quoteMetadata('))
  );
  assert.doesNotMatch(quoteMetadata, /entryIntersectsLine/);
  const intervals = view.slice(
    view.indexOf('function editableQuoteRailIntervals('),
    view.indexOf('function clearEditableQuoteRailOverlay(')
  );
  assert.doesNotMatch(intervals, /lastLineIndex\s*\+\s*1/);
  assert.match(intervals, /QuoteLineIndex region metadata/);
  assert.doesNotMatch(view, /function quoteHasReadingDepthTransition\s*\(/);
  assert.doesNotMatch(view, /match\(\/>\/g\)/);
});
