'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const foundation = require('../public/markdownEditableFoundation');
const {
  certifyPositionSets,
  createCertificationProjection,
  positionKey,
  samePosition
} = require('./helpers/markdownEditableCertificationHarness');
const { loadMarkdownPageViewInternals } = require('./helpers/markdownFakeDom');

const TRACE_COUNT = 512;
const ACTIONS_PER_TRACE = 14;
const TOTAL_ACTIONS = TRACE_COUNT * ACTIONS_PER_TRACE;
const RANDOM_SEED = 0x03c0ffee;
const EDGE_RANDOM_SEED = 0x0ed6e5;
const EDGE_ROUNDS = 10;
const EDGE_ORDERED_STARTS = Object.freeze(['1', '3', '0', '007']);
const EDGE_CARET_CLASSES = Object.freeze([
  'row-start-before-marker',
  'inside-marker',
  'after-marker-before-space',
  'content-start',
  'content-middle',
  'content-end'
]);
const EXPECTED_CERTIFICATION = Object.freeze({
  traces: 512,
  actions: 7168,
  mutations: 5120,
  changedTransactions: 4927,
  noOps: 193,
  undoReplays: 1024,
  redoReplays: 1024,
  projectionCertifications: 7168,
  projectedPositions: 358952,
  pkvCertifications: 512,
  pkvPositions: 26171,
  digest: '6da186249535b5152ebb44fa42762ca514de0732ebb0be74348cbf9b780eca77'
});
const EXPECTED_EDGE_CERTIFICATION = Object.freeze({
  traces: 180,
  mutations: 180,
  changedTransactions: 180,
  undoReplays: 180,
  redoReplays: 180,
  projectionCertifications: 360,
  firstMemberIndents: 40,
  firstMemberOutdents: 40,
  firstMemberStarts: Object.freeze({ '0': 20, '1': 20, '3': 20, '007': 20 }),
  destinationSequenceJoins: 40,
  destinationStarts: Object.freeze({ '0': 10, '1': 10, '3': 10, '007': 10 }),
  markerBoundaryEnters: 60,
  caretClasses: Object.freeze({
    'row-start-before-marker': 10,
    'inside-marker': 10,
    'after-marker-before-space': 10,
    'content-start': 10,
    'content-middle': 10,
    'content-end': 10
  }),
  digest: '08aae5ee589343838d1641bfbb5d8ad65fd508194c0f587be9f4bb2c5a0bd00f'
});

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function randomInteger(random, limit) {
  return limit > 0 ? Math.floor(random() * limit) : 0;
}

function pick(random, values) {
  return values[randomInteger(random, values.length)];
}

function shuffled(random, values) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const replacement = randomInteger(random, index + 1);
    [result[index], result[replacement]] = [result[replacement], result[index]];
  }
  return result;
}

// This deliberately does not call the production PhysicalLineIndex implementation.
function oraclePhysicalLines(source) {
  const lines = [];
  let start = 0;
  while (start < source.length) {
    let contentEnd = start;
    while (contentEnd < source.length
      && source[contentEnd] !== '\r'
      && source[contentEnd] !== '\n') contentEnd += 1;
    let sourceEnd = contentEnd;
    if (source.slice(sourceEnd, sourceEnd + 2) === '\r\n') sourceEnd += 2;
    else if (source[sourceEnd] === '\r' || source[sourceEnd] === '\n') sourceEnd += 1;
    lines.push({
      index: lines.length,
      start,
      contentEnd,
      sourceEnd,
      text: source.slice(start, contentEnd),
      lineEnding: source.slice(contentEnd, sourceEnd)
    });
    start = sourceEnd;
  }
  if (lines.length === 0 || lines.at(-1).lineEnding !== '') {
    lines.push({
      index: lines.length,
      start: source.length,
      contentEnd: source.length,
      sourceEnd: source.length,
      text: '',
      lineEnding: ''
    });
  }
  return lines;
}

function oracleFencedLineIndices(lines) {
  const masked = new Set();
  let openFence = null;
  for (const line of lines) {
    if (!openFence) {
      const opening = line.text.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!opening) continue;
      openFence = { character: opening[1][0], length: opening[1].length };
      masked.add(line.index);
      continue;
    }
    masked.add(line.index);
    const closing = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (closing
      && closing[1][0] === openFence.character
      && closing[1].length >= openFence.length) openFence = null;
  }
  return masked;
}

// Independent, intentionally narrow v0.3 list recognizer.
function oracleStrictListRows(source) {
  const lines = oraclePhysicalLines(source);
  const fenced = oracleFencedLineIndices(lines);
  const rows = [];
  const byLineIndex = new Map();
  for (const line of lines) {
    if (fenced.has(line.index)) continue;
    const match = line.text.match(/^(\t*)(?:(\d+)\. |(-) )(.*)$/);
    if (!match) continue;
    const tabs = match[1];
    const digits = match[2] || null;
    const ordered = digits !== null;
    const markerStart = line.start + tabs.length;
    const markerEnd = markerStart + (ordered ? digits.length + 1 : 1);
    const contentStart = markerEnd + 1;
    const row = {
      lineIndex: line.index,
      line,
      start: line.start,
      end: line.contentEnd,
      sourceEnd: line.sourceEnd,
      tabs,
      tabDepth: tabs.length,
      depth: tabs.length + 1,
      ordered,
      kind: ordered ? 'ordered' : 'unordered',
      number: ordered ? Number(digits) : null,
      digits,
      marker: ordered ? `${digits}.` : '-',
      markerStart,
      markerEnd,
      numberStart: ordered ? markerStart : null,
      numberEnd: ordered ? markerStart + digits.length : null,
      prefixStart: line.start,
      prefixEnd: contentStart,
      contentStart,
      contentEnd: line.contentEnd,
      content: source.slice(contentStart, line.contentEnd),
      empty: source.slice(contentStart, line.contentEnd).trim().length === 0
    };
    rows.push(row);
    byLineIndex.set(line.index, row);
  }
  return { lines, rows, byLineIndex, fenced };
}

function oracleOrderedSequences(scan) {
  const sequences = [];
  const active = new Map();
  for (const line of scan.lines) {
    const row = scan.byLineIndex.get(line.index);
    if (!row) {
      active.clear();
      continue;
    }
    for (const depth of [...active.keys()]) {
      if (depth > row.depth) active.delete(depth);
    }
    if (!row.ordered) {
      active.delete(row.depth);
      continue;
    }
    let sequence = active.get(row.depth);
    if (!sequence) {
      sequence = {
        depth: row.depth,
        startNumber: row.number,
        rows: []
      };
      sequences.push(sequence);
      active.set(row.depth, sequence);
    }
    sequence.rows.push(row);
  }
  return sequences;
}

function clampOffset(value, sourceLength, fallback = 0) {
  const number = Number(value);
  return Math.min(
    sourceLength,
    Math.max(0, Number.isFinite(number) ? number : fallback)
  );
}

function oracleSelection(source, selection, fallback = source.length) {
  const endpoint = (value, endpointFallback) => {
    if (value && typeof value === 'object') {
      return {
        offset: clampOffset(value.offset, source.length, endpointFallback),
        affinity: value.affinity === 'before' ? 'before' : 'after'
      };
    }
    return {
      offset: clampOffset(value, source.length, endpointFallback),
      affinity: 'after'
    };
  };
  const anchor = endpoint(selection?.anchor, fallback);
  const focus = endpoint(selection?.focus, anchor.offset);
  return { anchor, focus };
}

function publicSelection(selection) {
  return {
    anchor: selection.anchor.offset,
    focus: selection.focus.offset,
    anchorAffinity: selection.anchor.affinity,
    focusAffinity: selection.focus.affinity
  };
}

function oracleVisibleSelectionAtOffsets(source, selection, fallback = source.length) {
  const numeric = oracleSelection(source, selection, fallback);
  const lines = oraclePhysicalLines(source);
  const endpoint = ({ offset }) => {
    const line = oracleLineAtOffset(lines, offset, 'after');
    const logicalColumn = Math.max(0, Math.min(line.text.length, offset - line.start));
    return {
      offset: line.start + logicalColumn,
      affinity: logicalColumn === 0 ? 'after' : (
        logicalColumn === line.text.length ? 'before' : 'after'
      )
    };
  };
  return { anchor: endpoint(numeric.anchor), focus: endpoint(numeric.focus) };
}

function oracleApplyEdits(source, edits) {
  let result = source;
  for (const edit of edits.slice().sort((left, right) => (
    right.start - left.start || right.end - left.end
  ))) {
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  }
  return result;
}

function oracleOffsetAfterEdits(offset, edits, affinity) {
  let delta = 0;
  for (const edit of edits) {
    if (offset < edit.start || (offset === edit.start && affinity === 'before')) break;
    if (offset > edit.end || (offset === edit.end && affinity === 'after')) {
      delta += edit.replacement.length - (edit.end - edit.start);
    } else {
      return edit.start + delta + (affinity === 'before' ? 0 : edit.replacement.length);
    }
  }
  return offset + delta;
}

function oracleMapSelection(selection, edits) {
  return {
    anchor: {
      ...selection.anchor,
      offset: oracleOffsetAfterEdits(selection.anchor.offset, edits, selection.anchor.affinity)
    },
    focus: {
      ...selection.focus,
      offset: oracleOffsetAfterEdits(selection.focus.offset, edits, selection.focus.affinity)
    }
  };
}

function oracleResolveOrdered(source, resetLineIndices = [], preservedStarts = new Map()) {
  const scan = oracleStrictListRows(source);
  const resets = new Set(resetLineIndices);
  const starts = preservedStarts instanceof Map
    ? preservedStarts
    : new Map(Object.entries(preservedStarts).map(([lineIndex, value]) => [Number(lineIndex), value]));
  const sequences = new Map();
  const edits = [];
  for (const line of scan.lines) {
    const row = scan.byLineIndex.get(line.index);
    if (!row) {
      sequences.clear();
      continue;
    }
    for (const depth of [...sequences.keys()]) {
      if (depth > row.depth) sequences.delete(depth);
    }
    if (!row.ordered) {
      sequences.delete(row.depth);
      continue;
    }
    const preservedStart = starts.get(line.index);
    const resetStartsNewSequence = resets.has(line.index) && !sequences.has(row.depth);
    const startsNewSequence = resetStartsNewSequence || Number.isFinite(preservedStart);
    const active = startsNewSequence ? null : sequences.get(row.depth);
    const expected = active
      ? active.next
      : resetStartsNewSequence
        ? 1
        : Number.isFinite(preservedStart) ? preservedStart : row.number;
    if (row.number !== expected) {
      edits.push({
        start: row.numberStart,
        end: row.numberEnd,
        replacement: String(expected)
      });
    }
    sequences.set(row.depth, { next: expected + 1 });
  }
  edits.sort((left, right) => left.start - right.start || left.end - right.end);
  return { source: oracleApplyEdits(source, edits), edits };
}

function oracleNoOp(source, selection) {
  return {
    changed: false,
    source,
    selection: publicSelection(oracleSelection(source, selection)),
    primaryEdits: [],
    renumberEdits: [],
    transactionKind: null,
    inputType: null
  };
}

function oracleCanonicalEdit(source, selection, requestedEdit, options = {}) {
  const start = clampOffset(
    Math.min(requestedEdit.start, requestedEdit.end),
    source.length
  );
  const end = clampOffset(
    Math.max(requestedEdit.start, requestedEdit.end),
    source.length,
    start
  );
  const edit = {
    start,
    end: Math.max(start, end),
    replacement: String(requestedEdit.replacement ?? '')
  };
  const beforeSelection = oracleSelection(source, selection, edit.start);
  if (edit.start === edit.end && edit.replacement === '') return oracleNoOp(source, selection);
  const primaryEdits = [edit];
  const primarySource = oracleApplyEdits(source, primaryEdits);
  const primarySelection = options.afterPrimarySelection
    ? oracleVisibleSelectionAtOffsets(
      primarySource,
      options.afterPrimarySelection,
      edit.start + edit.replacement.length
    )
    : oracleMapSelection(beforeSelection, primaryEdits);
  const ordered = options.resolveOrdered === true
    ? oracleResolveOrdered(
      primarySource,
      options.resetLineIndices,
      options.preservedOrderedStarts
    )
    : { source: primarySource, edits: [] };
  const afterSelection = oracleMapSelection(primarySelection, ordered.edits);
  return {
    changed: ordered.source !== source,
    source: ordered.source,
    selection: publicSelection(afterSelection),
    beforeSelection: publicSelection(beforeSelection),
    primaryEdits,
    renumberEdits: ordered.edits,
    transactionKind: options.transactionKind || 'canonical-edit',
    inputType: options.inputType || 'insertText'
  };
}

function oracleLineAtOffset(lines, requestedOffset, affinity = 'after') {
  const sourceLength = lines.at(-1)?.sourceEnd || 0;
  const offset = clampOffset(requestedOffset, sourceLength);
  let index = 0;
  for (let candidate = 0; candidate < lines.length; candidate += 1) {
    if (lines[candidate].start <= offset) index = candidate;
    else break;
  }
  if (affinity === 'after' && lines[index + 1]?.start === offset) index += 1;
  return lines[index];
}

function oracleIsHighSurrogate(codeUnit) {
  return Number.isInteger(codeUnit) && codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function oracleIsLowSurrogate(codeUnit) {
  return Number.isInteger(codeUnit) && codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

// Independent code-point boundary owner for the randomized oracle. CRLF and a
// valid UTF-16 surrogate pair are each one deletion unit. Malformed lone
// surrogates remain literal one-code-unit source and are deleted alone.
function oracleExactDeletionRange(source, caret, direction) {
  const offset = clampOffset(caret, source.length);
  const insideSurrogatePair = offset > 0 && offset < source.length
    && oracleIsHighSurrogate(source.charCodeAt(offset - 1))
    && oracleIsLowSurrogate(source.charCodeAt(offset));
  if (insideSurrogatePair) return { start: offset - 1, end: offset + 1 };
  if (direction === 'forward') {
    if (offset >= source.length) return { start: offset, end: offset };
    if (source.slice(offset, offset + 2) === '\r\n') {
      return { start: offset, end: offset + 2 };
    }
    if (oracleIsHighSurrogate(source.charCodeAt(offset))
      && oracleIsLowSurrogate(source.charCodeAt(offset + 1))) {
      return { start: offset, end: offset + 2 };
    }
    return { start: offset, end: offset + 1 };
  }
  if (offset <= 0) return { start: offset, end: offset };
  if (source.slice(offset - 2, offset) === '\r\n') {
    return { start: offset - 2, end: offset };
  }
  if (oracleIsHighSurrogate(source.charCodeAt(offset - 2))
    && oracleIsLowSurrogate(source.charCodeAt(offset - 1))) {
    return { start: offset - 2, end: offset };
  }
  return { start: offset - 1, end: offset };
}

function oracleExactDeletion(source, selection, direction) {
  const normalized = oracleSelection(source, selection, 0);
  let start = Math.min(normalized.anchor.offset, normalized.focus.offset);
  let end = Math.max(normalized.anchor.offset, normalized.focus.offset);
  if (start === end) ({ start, end } = oracleExactDeletionRange(source, start, direction));
  return oracleCanonicalEdit(source, selection, { start, end, replacement: '' }, {
    resolveOrdered: true,
    transactionKind: 'exact-deletion',
    inputType: direction === 'forward' ? 'deleteContentForward' : 'deleteContentBackward'
  });
}

function oracleListIndentation(source, selection, direction) {
  const normalized = oracleSelection(source, selection, 0);
  const scan = oracleStrictListRows(source);
  const line = oracleLineAtOffset(scan.lines, normalized.focus.offset, 'after');
  const row = scan.byLineIndex.get(line.index);
  if (!row || (direction === 'outdent' && row.tabDepth === 0)) {
    return oracleNoOp(source, selection);
  }
  const outdent = direction === 'outdent';
  const sequence = row.ordered
    ? oracleOrderedSequences(scan).find((candidate) => candidate.rows.includes(row)) || null
    : null;
  const isFirstMember = sequence?.rows[0] === row;
  const nextOldMember = isFirstMember ? sequence.rows[1] || null : null;
  const preservedOrderedStarts = nextOldMember
    ? new Map([[nextOldMember.lineIndex, sequence.startNumber]])
    : new Map();
  return oracleCanonicalEdit(source, selection, outdent
    ? { start: line.start, end: line.start + 1, replacement: '' }
    : { start: line.start, end: line.start, replacement: '\t' }, {
    resolveOrdered: true,
    resetLineIndices: row.ordered && !outdent ? [line.index] : [],
    preservedOrderedStarts,
    transactionKind: outdent ? 'list-shift-tab' : 'list-tab',
    inputType: outdent ? 'formatOutdent' : 'formatIndent'
  });
}

function oraclePreferredLineEnding(lines, line) {
  if (line.lineEnding) return line.lineEnding;
  for (let index = line.index - 1; index >= 0; index -= 1) {
    if (lines[index].lineEnding) return lines[index].lineEnding;
  }
  return '\n';
}

function oracleNewline(source, selection, shiftKey) {
  const normalized = oracleSelection(source, selection, 0);
  const start = Math.min(normalized.anchor.offset, normalized.focus.offset);
  const end = Math.max(normalized.anchor.offset, normalized.focus.offset);
  const scan = oracleStrictListRows(source);
  const line = oracleLineAtOffset(scan.lines, start, 'after');
  const row = scan.byLineIndex.get(line.index);
  const lineEnding = oraclePreferredLineEnding(scan.lines, line);
  if (!row || shiftKey) {
    const caret = start + lineEnding.length;
    return oracleCanonicalEdit(source, selection, {
      start,
      end,
      replacement: lineEnding
    }, {
      transactionKind: 'newline',
      inputType: shiftKey ? 'insertLineBreak' : 'insertParagraph',
      afterPrimarySelection: { anchor: caret, focus: caret }
    });
  }
  if (row.ordered && start === end && start <= row.markerStart) {
    const prefix = source.slice(row.prefixStart, row.prefixEnd);
    const caret = row.start + prefix.length;
    return oracleCanonicalEdit(source, selection, {
      start: row.start,
      end: row.start,
      replacement: `${prefix}${lineEnding}`
    }, {
      resolveOrdered: true,
      transactionKind: 'list-enter-ordered',
      inputType: 'insertParagraph',
      afterPrimarySelection: { anchor: caret, focus: caret }
    });
  }
  if (row.empty && row.depth > 1) {
    return oracleCanonicalEdit(source, selection, {
      start: line.start,
      end: line.start + 1,
      replacement: ''
    }, {
      resolveOrdered: true,
      transactionKind: 'list-enter-empty-nested',
      inputType: 'insertParagraph'
    });
  }
  if (row.empty) {
    return oracleCanonicalEdit(source, selection, {
      start: line.start,
      end: line.contentEnd,
      replacement: ''
    }, {
      resolveOrdered: true,
      transactionKind: 'list-enter-empty-root',
      inputType: 'insertParagraph'
    });
  }
  const nextPrefix = row.ordered
    ? `${row.tabs}1. `
    : `${row.tabs}- `;
  const caret = start + lineEnding.length + nextPrefix.length;
  return oracleCanonicalEdit(source, selection, {
    start,
    end,
    replacement: `${lineEnding}${nextPrefix}`
  }, {
    resolveOrdered: true,
    transactionKind: row.ordered ? 'list-enter-ordered' : 'list-enter-unordered',
    inputType: 'insertParagraph',
    afterPrimarySelection: { anchor: caret, focus: caret }
  });
}

function bareEdits(edits) {
  return edits.map(({ start, end, replacement }) => ({ start, end, replacement }));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function comparableRows(rows) {
  return rows.map((row) => ({
    lineIndex: row.lineIndex,
    start: row.start,
    end: row.end,
    sourceEnd: row.sourceEnd,
    tabs: row.tabs,
    tabDepth: row.tabDepth,
    depth: row.depth,
    ordered: row.ordered,
    kind: row.kind,
    number: row.number,
    digits: row.digits,
    marker: row.marker,
    markerStart: row.markerStart,
    markerEnd: row.markerEnd,
    numberStart: row.numberStart,
    numberEnd: row.numberEnd,
    prefixStart: row.prefixStart,
    prefixEnd: row.prefixEnd,
    contentStart: row.contentStart,
    contentEnd: row.contentEnd,
    content: row.content,
    empty: row.empty
  }));
}

function assertSnapshotInvariants(snapshot, expectedSource, label) {
  assert.equal(snapshot.markdownBody, expectedSource, `${label}: snapshot source diverged`);
  assert.ok(Object.isFrozen(snapshot), `${label}: SourceSnapshot is mutable`);
  assert.ok(Object.isFrozen(snapshot.physicalLineIndex.lines), `${label}: physical rows are mutable`);
  const oracleLines = oraclePhysicalLines(expectedSource);
  assert.deepEqual(snapshot.physicalLineIndex.lines.map((line) => ({
    index: line.index,
    start: line.start,
    contentEnd: line.contentEnd,
    sourceEnd: line.sourceEnd,
    text: line.text,
    lineEnding: line.lineEnding
  })), oracleLines, `${label}: PhysicalLineIndex differs from oracle`);

  const oracleScan = oracleStrictListRows(expectedSource);
  const productionScan = snapshot.editableListSemanticIndex;
  assert.deepEqual(
    comparableRows(productionScan.rows),
    comparableRows(oracleScan.rows),
    `${label}: strict list scan differs from oracle`
  );
  assert.deepEqual(
    productionScan.fencedLineIndices,
    [...oracleScan.fenced],
    `${label}: fenced-code exclusion differs from oracle`
  );
  const expectedResolution = oracleResolveOrdered(expectedSource);
  const productionResolution = foundation.resolveOrderedSequences(snapshot);
  assert.equal(
    productionResolution.source,
    expectedResolution.source,
    `${label}: ordered resolver source differs from oracle`
  );
  assert.deepEqual(
    bareEdits(productionResolution.edits),
    expectedResolution.edits,
    `${label}: ordered resolver edits differ from oracle`
  );
}

function expectedProjectionPositions(snapshot, oracleLines) {
  return oracleLines.flatMap((line) => {
    const physicalLine = snapshot.physicalLineIndex.lines[line.index];
    return Array.from({ length: line.text.length + 1 }, (_unused, logicalColumn) => ({
      sourceVersion: snapshot.version,
      offset: line.start + logicalColumn,
      affinity: logicalColumn === 0 ? 'after' : (
        logicalColumn === line.text.length ? 'before' : 'after'
      ),
      physicalLineId: physicalLine.id,
      logicalColumn
    }));
  });
}

function assertProjectionInvariants(snapshot, label, mode) {
  const oracleLines = oraclePhysicalLines(snapshot.markdownBody);
  const expected = expectedProjectionPositions(snapshot, oracleLines);
  const { projection } = createCertificationProjection(snapshot, mode);
  const rows = projection.enumeratePhysicalRows();
  assert.deepEqual(rows.map((row) => ({
    index: row.index,
    start: row.start,
    contentEnd: row.contentEnd,
    sourceEnd: row.sourceEnd,
    text: row.text,
    lineEnding: row.lineEnding
  })), oracleLines, `${label}: projected physical rows differ from oracle`);

  const declared = projection.enumerateDeclaredPositions();
  assert.deepEqual(
    declared.map(positionKey),
    expected.map(positionKey),
    `${label}: declared projection positions differ from oracle`
  );
  for (let index = 0; index < declared.length; index += 1) {
    const position = declared[index];
    const dom = projection.sourceToDom(position);
    assert.ok(dom, `${label}: sourceToDom failed for ${positionKey(position)}`);
    const roundTrip = projection.domToSource(dom.node, dom.offset, { allowRowFallback: false });
    assert.ok(
      samePosition(position, roundTrip),
      `${label}: DOM round trip changed ${positionKey(position)}`
    );
    assert.equal(roundTrip.logicalColumn, position.logicalColumn);
    const left = projection.moveHorizontal(position, 'left');
    const right = projection.moveHorizontal(position, 'right');
    assert.ok(samePosition(left, declared[Math.max(0, index - 1)]));
    assert.ok(samePosition(right, declared[Math.min(declared.length - 1, index + 1)]));
  }
  return declared.length;
}

function initialSource(traceIndex, random) {
  const ending = pick(random, ['\n', '\r\n', '\r']);
  const fixtures = [
    ['1. alpha', '2. beta', '3. gamma'],
    ['7. parent', '\t3. child', '\t4. child two', '8. sibling'],
    ['- parent', '\t- child', '\t\t- grandchild', '- sibling'],
    ['1. before', '2. after', '1) ordinary reset', '9. new sequence'],
    ['1. parent', '\t2. ', '2. sibling'],
    ['2. '],
    ['```md', '1. fenced fake', '- fenced fake', '```', '', '4. real'],
    ['1. brain 🧠', '2. cortex e\u0301', '\t- synapse', '3. tail']
  ];
  const lines = fixtures[traceIndex % fixtures.length].slice();
  if (traceIndex % 5 === 0) lines.push(' 1. leading-space ordinary');
  if (traceIndex % 7 === 0) lines.push('* noncanonical bullet');
  if (traceIndex % 11 === 0) lines.push('');
  const joined = traceIndex % 13 === 0
    ? lines.map((line, index) => (
      index === lines.length - 1 ? line : `${line}${['\r\n', '\n', '\r'][index % 3]}`
    )).join('')
    : lines.join(ending);
  return oracleResolveOrdered(joined).source;
}

function randomVisibleOffset(source, random) {
  const positions = oraclePhysicalLines(source).flatMap((line) => (
    Array.from({ length: line.text.length + 1 }, (_unused, column) => line.start + column)
  ));
  return pick(random, positions);
}

function chooseRow(random, rows, predicate = () => true) {
  const candidates = rows.filter(predicate);
  return candidates.length > 0 ? pick(random, candidates) : null;
}

function buildMutationAction(type, source, random) {
  const scan = oracleStrictListRows(source);
  const row = chooseRow(random, scan.rows);
  if (type === 'indent') {
    const offset = row
      ? row.contentStart + randomInteger(random, row.content.length + 1)
      : randomVisibleOffset(source, random);
    return { type, selection: { anchor: offset, focus: offset } };
  }
  if (type === 'outdent') {
    const nested = chooseRow(random, scan.rows, (candidate) => candidate.tabDepth > 0);
    const target = random() < 0.8 && nested ? nested : row;
    const offset = target
      ? target.contentStart + randomInteger(random, target.content.length + 1)
      : randomVisibleOffset(source, random);
    return { type, selection: { anchor: offset, focus: offset } };
  }
  if (type === 'newline') {
    const offset = row ? row.contentEnd : randomVisibleOffset(source, random);
    return { type, selection: { anchor: offset, focus: offset } };
  }
  if (type === 'shift-newline') {
    const target = row && random() < 0.75 ? row.contentEnd : randomVisibleOffset(source, random);
    return { type, selection: { anchor: target, focus: target } };
  }
  if (type === 'insert') {
    const offset = row && random() < 0.8
      ? row.contentStart + randomInteger(random, row.content.length + 1)
      : randomVisibleOffset(source, random);
    return {
      type,
      selection: { anchor: offset, focus: offset },
      replacement: pick(random, ['x', '*', '9', '🧠', '\\'])
    };
  }
  if (type === 'delete-backward') {
    const offset = row && random() < 0.65
      ? row.markerEnd
      : randomVisibleOffset(source, random);
    return { type, selection: { anchor: offset, focus: offset } };
  }
  if (type === 'delete-forward') {
    const offset = row && random() < 0.65
      ? row.markerStart
      : randomVisibleOffset(source, random);
    return { type, selection: { anchor: offset, focus: offset } };
  }
  if (type === 'delete-range') {
    const target = row && random() < 0.6
      ? row.line
      : pick(random, scan.lines.filter((line) => line.text.length > 0));
    if (!target || target.text.length === 0) {
      const offset = randomVisibleOffset(source, random);
      return { type, selection: { anchor: offset, focus: offset } };
    }
    let start;
    let end;
    const targetRow = scan.byLineIndex.get(target.index);
    if (targetRow && random() < 0.6) {
      start = targetRow.prefixStart;
      end = Math.min(targetRow.prefixEnd, start + 1 + randomInteger(random, 2));
    } else {
      const firstColumn = randomInteger(random, target.text.length);
      const span = 1 + randomInteger(random, Math.min(3, target.text.length - firstColumn));
      start = target.start + firstColumn;
      end = start + span;
    }
    return {
      type,
      selection: random() < 0.5
        ? { anchor: start, focus: end }
        : { anchor: end, focus: start }
    };
  }
  throw new TypeError(`Unknown mutation action ${type}`);
}

function executeMutation(snapshot, action) {
  const source = snapshot.markdownBody;
  if (action.type === 'insert') {
    const start = Math.min(action.selection.anchor, action.selection.focus);
    const end = Math.max(action.selection.anchor, action.selection.focus);
    return {
      expected: oracleCanonicalEdit(source, action.selection, {
        start,
        end,
        replacement: action.replacement
      }, {
        resolveOrdered: true,
        transactionKind: 'insert-text',
        inputType: 'insertText'
      }),
      actual: foundation.applyCanonicalEdit(snapshot, action.selection, {
        start,
        end,
        replacement: action.replacement,
        kind: 'randomized-insert'
      }, {
        resolveOrderedSequences: true,
        transactionKind: 'insert-text',
        inputType: 'insertText'
      })
    };
  }
  if (action.type === 'delete-backward' || action.type === 'delete-forward'
    || action.type === 'delete-range') {
    const direction = action.type === 'delete-forward' ? 'forward' : 'backward';
    return {
      expected: oracleExactDeletion(source, action.selection, direction),
      actual: foundation.applyExactDeletion(snapshot, action.selection, direction)
    };
  }
  if (action.type === 'indent' || action.type === 'outdent') {
    return {
      expected: oracleListIndentation(source, action.selection, action.type),
      actual: foundation.applyEditableListIndentation(snapshot, action.selection, action.type)
    };
  }
  if (action.type === 'newline' || action.type === 'shift-newline') {
    const shiftKey = action.type === 'shift-newline';
    return {
      expected: oracleNewline(source, action.selection, shiftKey),
      actual: foundation.applyEditableNewline(snapshot, action.selection, shiftKey
        ? { shiftKey: true, inputType: 'insertLineBreak' }
        : { inputType: 'insertParagraph' })
    };
  }
  throw new TypeError(`Cannot execute mutation ${action.type}`);
}

function orderedDigits(startDigits, offset) {
  const next = String(Number(startDigits) + offset);
  return startDigits.length > 1 && startDigits.startsWith('0')
    ? next.padStart(startDigits.length, '0')
    : next;
}

function firstMemberEdgeFixture(startDigits, direction, round, random) {
  const lineEnding = pick(random, ['\n', '\r\n', '\r']);
  const descendant = random() < 0.5
    ? [`${direction === 'outdent' ? '\t\t' : '\t'}- descendant ${round}`]
    : [];
  const lines = direction === 'outdent'
    ? [
        `1. root ${round}`,
        `\t${orderedDigits(startDigits, 0)}. alpha ${round}`,
        ...descendant,
        `\t${orderedDigits(startDigits, 1)}. beta ${round}`,
        `\t${orderedDigits(startDigits, 2)}. gamma ${round}`,
        `2. tail ${round}`
      ]
    : [
        `- root ${round}`,
        `${orderedDigits(startDigits, 0)}. alpha ${round}`,
        ...descendant,
        `${orderedDigits(startDigits, 1)}. beta ${round}`,
        `${orderedDigits(startDigits, 2)}. gamma ${round}`,
        `- tail ${round}`
      ];
  const source = lines.join(lineEnding);
  const scan = oracleStrictListRows(source);
  const target = scan.rows.find((row) => row.content === `alpha ${round}`);
  const sequence = oracleOrderedSequences(scan).find((candidate) => (
    candidate.rows.includes(target)
  ));
  assert.ok(target?.ordered, `${direction} ${startDigits}: target is not ordered`);
  assert.equal(sequence?.rows[0], target,
    `${direction} ${startDigits}: generated target is not the first sequence member`);
  assert.equal(sequence.startNumber, Number(startDigits));
  const offset = target.contentStart + randomInteger(random, target.content.length + 1);
  return {
    source,
    startDigits,
    startNumber: Number(startDigits),
    direction,
    targetLineIndex: target.lineIndex,
    selection: { anchor: offset, focus: offset },
    hasDescendant: descendant.length > 0
  };
}

function markerBoundaryEdgeFixture(caretClass, round, random) {
  const lineEnding = pick(random, ['\n', '\r\n', '\r']);
  const source = [
    `1. abc ${round}`,
    '2. 123123',
    `3. xyz ${round}`
  ].join(lineEnding);
  const row = oracleStrictListRows(source).rows.find((candidate) => (
    candidate.content === '123123'
  ));
  assert.ok(row?.ordered);
  const offsets = {
    'row-start-before-marker': row.markerStart,
    'inside-marker': row.markerStart + 1,
    'after-marker-before-space': row.markerEnd,
    'content-start': row.contentStart,
    'content-middle': row.contentStart + 3,
    'content-end': row.contentEnd
  };
  const offset = offsets[caretClass];
  assert.ok(Number.isSafeInteger(offset), `Unknown caret class ${caretClass}`);
  return {
    source,
    caretClass,
    targetLineIndex: row.lineIndex,
    selection: { anchor: offset, focus: offset }
  };
}

function destinationSequenceJoinFixture(startDigits, round, random) {
  const lineEnding = pick(random, ['\n', '\r\n', '\r']);
  const source = [
    `1. parent ${round}`,
    `\t${orderedDigits(startDigits, 0)}. child ${round}`,
    `2. moved ${round}`,
    `3. tail ${round}`
  ].join(lineEnding);
  const scan = oracleStrictListRows(source);
  const target = scan.rows.find((row) => row.content === `moved ${round}`);
  const destination = scan.rows.find((row) => row.content === `child ${round}`);
  assert.ok(target?.ordered && destination?.ordered);
  const sourceSequence = oracleOrderedSequences(scan)
    .find((sequence) => sequence.rows.includes(target));
  const destinationSequence = oracleOrderedSequences(scan)
    .find((sequence) => sequence.rows.includes(destination));
  assert.equal(sourceSequence?.rows.indexOf(target), 1,
    'generated moved row must be a later member of its source sequence');
  assert.equal(destinationSequence?.startNumber, Number(startDigits));
  return {
    source,
    startDigits,
    destinationStartNumber: Number(startDigits),
    targetLineIndex: target.lineIndex,
    selection: { anchor: target.contentStart, focus: target.contentStart }
  };
}

function assertCanonicalOrderedSequences(source, label) {
  const scan = oracleStrictListRows(source);
  for (const sequence of oracleOrderedSequences(scan)) {
    sequence.rows.forEach((row, position) => {
      assert.equal(
        row.number,
        sequence.startNumber + position,
        `${label}: ordered sequence is stale at line ${row.lineIndex}`
      );
    });
  }
}

function assertExactHistoryReplay(historyApi, beforeSnapshot, actual, expected, label) {
  const history = historyApi.createMarkdownEditHistory(beforeSnapshot.markdownBody);
  assert.equal(historyApi.recordMarkdownEditTransaction(
    history,
    actual.transaction,
    { coalesce: false }
  ), true, `${label}: history rejected the edge transaction`);
  assert.equal(history.undoStack.length, 1, `${label}: command must create one history action`);
  const undo = historyApi.stepMarkdownEditHistory(history, 'undo', actual.source);
  assert.ok(undo, `${label}: Undo did not replay`);
  assert.equal(undo.source, beforeSnapshot.markdownBody, `${label}: Undo source`);
  assert.deepEqual(plain(undo.selection), expected.beforeSelection, `${label}: Undo selection`);
  const redo = historyApi.stepMarkdownEditHistory(history, 'redo', undo.source);
  assert.ok(redo, `${label}: Redo did not replay`);
  assert.equal(redo.source, expected.source, `${label}: Redo source`);
  assert.deepEqual(plain(redo.selection), expected.selection, `${label}: Redo selection`);
}

function assertMutationResult(beforeSnapshot, action, expected, actual, label) {
  assert.equal(actual.source, expected.source, `${label}: source differs from oracle`);
  assert.equal(actual.markdownBody, expected.source, `${label}: markdownBody differs from oracle`);
  assert.equal(actual.changed, expected.changed, `${label}: changed flag differs from oracle`);
  assert.deepEqual(actual.selection, expected.selection, `${label}: selection differs from oracle`);
  assert.deepEqual(
    bareEdits(actual.primaryEdits),
    expected.primaryEdits,
    `${label}: primary edits differ from oracle`
  );
  assert.deepEqual(
    bareEdits(actual.renumberEdits),
    expected.renumberEdits,
    `${label}: renumber edits differ from oracle`
  );
  if (expected.transactionKind === null) {
    assert.equal(actual.transaction, null, `${label}: no-op created a transaction`);
    assert.equal(actual.snapshot, beforeSnapshot, `${label}: no-op replaced its snapshot`);
    return;
  }
  assert.ok(actual.transaction, `${label}: mutation did not create a transaction`);
  assert.ok(Object.isFrozen(actual.transaction), `${label}: transaction is mutable`);
  assert.equal(actual.transaction.transactionKind, expected.transactionKind);
  assert.equal(actual.transaction.inputType, expected.inputType);
  assert.equal(actual.transaction.beforeSource, beforeSnapshot.markdownBody);
  assert.equal(actual.transaction.afterSource, expected.source);
  assert.deepEqual(actual.transaction.beforeSelection, expected.beforeSelection);
  assert.deepEqual(actual.transaction.afterSelection, expected.selection);
  assert.equal(actual.transaction.sourceVersionBefore, beforeSnapshot.version);
  assert.equal(actual.transaction.sourceVersionAfter, beforeSnapshot.version + 1);
  assert.equal(actual.snapshot.version, beforeSnapshot.version + 1);
}

test('randomized deletion oracle owns only valid CRLF/surrogate units and preserves malformed literals', () => {
  const cases = [
    ['valid surrogate interior backward', 'A😀B', 2, 'backward', { start: 1, end: 3 }],
    ['valid surrogate interior forward', 'A😀B', 2, 'forward', { start: 1, end: 3 }],
    ['valid surrogate edge backward', 'A😀B', 3, 'backward', { start: 1, end: 3 }],
    ['valid surrogate edge forward', 'A😀B', 1, 'forward', { start: 1, end: 3 }],
    ['CRLF backward', 'A\r\nB', 3, 'backward', { start: 1, end: 3 }],
    ['CRLF forward', 'A\r\nB', 1, 'forward', { start: 1, end: 3 }],
    ['lone high backward', `A\ud83dB`, 2, 'backward', { start: 1, end: 2 }],
    ['lone high forward', `A\ud83dB`, 1, 'forward', { start: 1, end: 2 }],
    ['lone low backward', `A\ude00B`, 2, 'backward', { start: 1, end: 2 }],
    ['lone low forward', `A\ude00B`, 1, 'forward', { start: 1, end: 2 }]
  ];

  for (const [label, source, caret, direction, expected] of cases) {
    assert.deepEqual(oracleExactDeletionRange(source, caret, direction), expected, `${label}: oracle`);
    assert.deepEqual(foundation.exactDeletionRange(source, caret, direction), expected,
      `${label}: production`);
  }
});

test('v0.3 randomized certification: canonical transactions and replay preserve source and projection invariants', (t) => {
  const historyApi = loadMarkdownPageViewInternals([
    'createMarkdownEditHistory',
    'recordMarkdownEditTransaction',
    'stepMarkdownEditHistory'
  ]);
  const random = seededRandom(RANDOM_SEED);
  const digest = createHash('sha256');
  const totals = {
    traces: 0,
    actions: 0,
    mutations: 0,
    changedTransactions: 0,
    noOps: 0,
    undoReplays: 0,
    redoReplays: 0,
    projectionCertifications: 0,
    projectedPositions: 0,
    pkvCertifications: 0,
    pkvPositions: 0
  };

  for (let traceIndex = 0; traceIndex < TRACE_COUNT; traceIndex += 1) {
    const source = initialSource(traceIndex, random);
    let snapshot = foundation.createSourceSnapshot(source);
    let currentSelection = { anchor: 0, focus: 0 };
    const history = historyApi.createMarkdownEditHistory(source);
    const oracleUndo = [];
    const oracleRedo = [];
    const mutationTypes = [
      'indent',
      'newline',
      ...shuffled(random, [
        'insert',
        'insert',
        'delete-backward',
        'delete-forward',
        'delete-range',
        'outdent',
        'shift-newline',
        'newline'
      ])
    ];
    const actionTypes = [...mutationTypes, 'undo', 'undo', 'redo', 'redo'];
    assert.equal(actionTypes.length, ACTIONS_PER_TRACE);
    assertSnapshotInvariants(snapshot, source, `trace ${traceIndex} initial`);

    for (let actionIndex = 0; actionIndex < actionTypes.length; actionIndex += 1) {
      const type = actionTypes[actionIndex];
      const label = `trace ${traceIndex} action ${actionIndex} (${type})`;
      const beforeSource = snapshot.markdownBody;
      if (type === 'undo' || type === 'redo') {
        const sourceStack = type === 'undo' ? oracleUndo : oracleRedo;
        const targetStack = type === 'undo' ? oracleRedo : oracleUndo;
        const expectedTransaction = sourceStack.at(-1);
        assert.ok(expectedTransaction, `${label}: independent history stack is empty`);
        const expectedSource = type === 'undo'
          ? expectedTransaction.beforeSource
          : expectedTransaction.afterSource;
        const expectedSelection = type === 'undo'
          ? expectedTransaction.beforeSelection
          : expectedTransaction.afterSelection;
        const replay = historyApi.stepMarkdownEditHistory(history, type, beforeSource);
        assert.ok(replay, `${label}: runtime history replay failed`);
        assert.equal(replay.source, expectedSource, `${label}: replay source differs from oracle`);
        assert.deepEqual(
          plain(replay.selection),
          expectedSelection,
          `${label}: replay selection differs from oracle`
        );
        assert.equal(replay.transaction.beforeSource, expectedTransaction.beforeSource);
        assert.equal(replay.transaction.afterSource, expectedTransaction.afterSource);
        sourceStack.pop();
        targetStack.push(expectedTransaction);
        snapshot = foundation.createSourceSnapshot(replay.source, { previousSnapshot: snapshot });
        currentSelection = replay.selection;
        if (type === 'undo') totals.undoReplays += 1;
        else totals.redoReplays += 1;
      } else {
        const action = buildMutationAction(type, beforeSource, random);
        const { expected, actual } = executeMutation(snapshot, action);
        assertMutationResult(snapshot, action, expected, actual, label);
        currentSelection = actual.selection;
        snapshot = actual.snapshot;
        totals.mutations += 1;
        if (actual.transaction && actual.changed) {
          const expectedTransaction = {
            beforeSource,
            afterSource: expected.source,
            beforeSelection: expected.beforeSelection,
            afterSelection: expected.selection
          };
          assert.equal(historyApi.recordMarkdownEditTransaction(
            history,
            actual.transaction,
            { coalesce: false }
          ), true, `${label}: runtime history rejected the transaction`);
          oracleUndo.push(expectedTransaction);
          oracleRedo.length = 0;
          totals.changedTransactions += 1;
        } else {
          totals.noOps += 1;
        }
      }

      assert.equal(history.currentSource, snapshot.markdownBody, `${label}: history source diverged`);
      assertSnapshotInvariants(snapshot, snapshot.markdownBody, label);
      totals.projectedPositions += assertProjectionInvariants(
        snapshot,
        label,
        (traceIndex + actionIndex) % 2 === 0 ? 'source' : 'live-preview'
      );
      totals.projectionCertifications += 1;
      totals.actions += 1;
      digest.update(JSON.stringify([
        traceIndex,
        actionIndex,
        type,
        beforeSource,
        snapshot.markdownBody,
        currentSelection
      ]));
    }

    const pkv = certifyPositionSets(
      snapshot,
      traceIndex % 2 === 0 ? 'source' : 'live-preview'
    );
    assert.deepEqual(pkv.P, pkv.K, `trace ${traceIndex}: P differs from K`);
    assert.deepEqual(pkv.K, pkv.V, `trace ${traceIndex}: K differs from V`);
    totals.pkvCertifications += 1;
    totals.pkvPositions += pkv.declared.length;
    totals.traces += 1;
  }

  const result = { ...totals, digest: digest.digest('hex') };
  assert.equal(result.traces, TRACE_COUNT);
  assert.equal(result.actions, TOTAL_ACTIONS);
  assert.equal(result.mutations, TRACE_COUNT * 10);
  assert.equal(result.undoReplays, TRACE_COUNT * 2);
  assert.equal(result.redoReplays, TRACE_COUNT * 2);
  assert.equal(result.projectionCertifications, TOTAL_ACTIONS);
  assert.equal(result.pkvCertifications, TRACE_COUNT);
  assert.deepEqual(result, EXPECTED_CERTIFICATION, 'seeded certification corpus drifted');
  t.diagnostic(`randomized certification totals: ${JSON.stringify(result)}`);
});

test('v0.3 randomized edge certification reaches first-member sequence moves and every ordered marker boundary', (t) => {
  const historyApi = loadMarkdownPageViewInternals([
    'createMarkdownEditHistory',
    'recordMarkdownEditTransaction',
    'stepMarkdownEditHistory'
  ]);
  const random = seededRandom(EDGE_RANDOM_SEED);
  const digest = createHash('sha256');
  const totals = {
    traces: 0,
    mutations: 0,
    changedTransactions: 0,
    undoReplays: 0,
    redoReplays: 0,
    projectionCertifications: 0,
    firstMemberIndents: 0,
    firstMemberOutdents: 0,
    firstMemberStarts: { '0': 0, '1': 0, '3': 0, '007': 0 },
    destinationSequenceJoins: 0,
    destinationStarts: { '0': 0, '1': 0, '3': 0, '007': 0 },
    markerBoundaryEnters: 0,
    caretClasses: Object.fromEntries(EDGE_CARET_CLASSES.map((name) => [name, 0]))
  };
  let traceIndex = 0;

  const certify = (fixture, action) => {
    const label = `edge trace ${traceIndex} (${action.edgeKind})`;
    const beforeSnapshot = foundation.createSourceSnapshot(fixture.source);
    const { expected, actual } = executeMutation(beforeSnapshot, action);
    assertMutationResult(beforeSnapshot, action, expected, actual, label);
    assert.ok(actual.changed && actual.transaction, `${label}: expected a changed transaction`);
    assertSnapshotInvariants(actual.snapshot, expected.source, label);
    assertCanonicalOrderedSequences(actual.source, label);
    if (action.type === 'indent' || action.type === 'outdent') {
      const immediateResolution = foundation.resolveOrderedSequences(actual.snapshot);
      assert.equal(immediateResolution.changed, false,
        `${label}: list command did not close its canonical sequence transaction`);
      assert.deepEqual(immediateResolution.edits, [],
        `${label}: immediate canonical resolution planned follow-up edits`);
    }
    for (const mode of ['source', 'live-preview']) {
      assertProjectionInvariants(actual.snapshot, `${label} ${mode}`, mode);
      totals.projectionCertifications += 1;
    }
    assertExactHistoryReplay(historyApi, beforeSnapshot, actual, expected, label);
    assert.doesNotMatch(actual.source, /\\\./u, `${label}: structural command escaped a marker dot`);
    digest.update(JSON.stringify({
      traceIndex,
      fixture,
      action,
      source: actual.source,
      selection: actual.selection,
      primaryEdits: bareEdits(actual.primaryEdits),
      renumberEdits: bareEdits(actual.renumberEdits)
    }));
    totals.traces += 1;
    totals.mutations += 1;
    totals.changedTransactions += 1;
    totals.undoReplays += 1;
    totals.redoReplays += 1;
    traceIndex += 1;
    return actual;
  };

  for (let round = 0; round < EDGE_ROUNDS; round += 1) {
    for (const direction of shuffled(random, ['indent', 'outdent'])) {
      for (const startDigits of shuffled(random, EDGE_ORDERED_STARTS)) {
        const fixture = firstMemberEdgeFixture(startDigits, direction, round, random);
        const actual = certify(fixture, {
          type: direction,
          selection: fixture.selection,
          edgeKind: `first-member-${direction}-${startDigits}`
        });
        const afterScan = oracleStrictListRows(actual.source);
        const oldRemainder = afterScan.rows.find((row) => row.content === `beta ${round}`);
        assert.ok(oldRemainder?.ordered);
        const oldSequence = oracleOrderedSequences(afterScan)
          .find((sequence) => sequence.rows.includes(oldRemainder));
        assert.equal(oldSequence?.rows[0], oldRemainder,
          `${direction} ${startDigits}: old remainder is not a sequence start`);
        assert.equal(oldSequence.startNumber, Number(startDigits),
          `${direction} ${startDigits}: old sequence start was not preserved`);
        if (direction === 'indent') totals.firstMemberIndents += 1;
        else totals.firstMemberOutdents += 1;
        totals.firstMemberStarts[startDigits] += 1;
      }
    }

    for (const caretClass of shuffled(random, EDGE_CARET_CLASSES)) {
      const fixture = markerBoundaryEdgeFixture(caretClass, round, random);
      const actual = certify(fixture, {
        type: 'newline',
        selection: fixture.selection,
        edgeKind: `ordered-enter-${caretClass}`
      });
      if (caretClass === 'row-start-before-marker') {
        const afterScan = oracleStrictListRows(actual.source);
        const original = afterScan.rows.find((row) => row.content === '123123');
        assert.ok(original?.ordered, 'marker-start Enter must preserve the original ordered row');
        const sequence = oracleOrderedSequences(afterScan)
          .find((candidate) => candidate.rows.includes(original));
        const position = sequence.rows.indexOf(original);
        assert.ok(position > 0, 'marker-start Enter must insert an ordered sibling before the original');
        assert.equal(sequence.rows[position - 1].content, '',
          'marker-start Enter must insert an empty exact-prefix sibling');
      }
      totals.markerBoundaryEnters += 1;
      totals.caretClasses[caretClass] += 1;
    }

    for (const startDigits of shuffled(random, EDGE_ORDERED_STARTS)) {
      const fixture = destinationSequenceJoinFixture(startDigits, round, random);
      const actual = certify(fixture, {
        type: 'indent',
        selection: fixture.selection,
        edgeKind: `destination-sequence-join-${startDigits}`
      });
      const afterScan = oracleStrictListRows(actual.source);
      const moved = afterScan.rows.find((row) => row.content === `moved ${round}`);
      const sequence = oracleOrderedSequences(afterScan)
        .find((candidate) => candidate.rows.includes(moved));
      const position = sequence.rows.indexOf(moved);
      assert.ok(position > 0, `${startDigits}: moved row did not join the destination sequence`);
      assert.equal(sequence.startNumber, fixture.destinationStartNumber);
      assert.equal(moved.number, fixture.destinationStartNumber + position);
      totals.destinationSequenceJoins += 1;
      totals.destinationStarts[startDigits] += 1;
    }
  }

  const result = { ...totals, digest: digest.digest('hex') };
  assert.equal(result.traces, EDGE_ROUNDS * (
    EDGE_ORDERED_STARTS.length * 3 + EDGE_CARET_CLASSES.length
  ));
  assert.deepEqual(result, EXPECTED_EDGE_CERTIFICATION,
    'seeded ordered-list edge certification corpus drifted');
  t.diagnostic(`randomized ordered-list edge totals: ${JSON.stringify(result)}`);
});
