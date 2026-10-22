'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalize, isPlainObject } = require('./utils');

const EVIDENCE_LEVELS = Object.freeze(['O1', 'V1', 'U']);

function physicalLines(source) {
  const canonical = String(source ?? '');
  const lines = [];
  const endings = /\r\n|\n|\r/g;
  let lineStart = 0;
  let match;
  while ((match = endings.exec(canonical))) {
    lines.push({
      index: lines.length,
      number: lines.length + 1,
      start: lineStart,
      end: match.index,
      endWithEnding: match.index + match[0].length,
      text: canonical.slice(lineStart, match.index),
      lineEnding: match[0],
      blank: match.index === lineStart,
      terminal: false
    });
    lineStart = match.index + match[0].length;
  }
  lines.push({
    index: lines.length,
    number: lines.length + 1,
    start: lineStart,
    end: canonical.length,
    endWithEnding: canonical.length,
    text: canonical.slice(lineStart),
    lineEnding: '',
    blank: canonical.length === lineStart,
    terminal: true
  });
  return lines;
}

function sourcePoint(source, requestedOffset) {
  const canonical = String(source ?? '');
  const offset = Math.max(0, Math.min(canonical.length, Number(requestedOffset) || 0));
  const lines = physicalLines(canonical);
  let line = lines[lines.length - 1];
  for (const candidate of lines) {
    if (offset <= candidate.end
      || offset < candidate.endWithEnding
      || candidate.terminal) {
      line = candidate;
      break;
    }
  }
  return {
    offset,
    line: line.number,
    column: Math.min(offset, line.end) - line.start + 1,
    lineIndex: line.index
  };
}

function normalizeSelection(source, selection = {}) {
  const canonical = String(source ?? '');
  const rawAnchor = selection.anchor ?? selection.start ?? selection.focus ?? 0;
  const rawFocus = selection.focus ?? selection.end ?? selection.anchor ?? rawAnchor;
  const anchor = Math.max(0, Math.min(canonical.length, Number(rawAnchor) || 0));
  const focus = Math.max(0, Math.min(canonical.length, Number(rawFocus) || 0));
  return {
    anchor,
    focus,
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
    direction: anchor <= focus ? 'forward' : 'backward',
    collapsed: anchor === focus,
    anchorPoint: sourcePoint(canonical, anchor),
    focusPoint: sourcePoint(canonical, focus)
  };
}

function sourceObservation(source, rawBytes = null) {
  const canonical = String(source ?? '');
  const lines = physicalLines(canonical);
  const bytes = Buffer.isBuffer(rawBytes)
    ? rawBytes
    : (typeof rawBytes === 'string' ? Buffer.from(rawBytes, 'base64') : Buffer.from(canonical, 'utf8'));
  return {
    text: canonical,
    bytesBase64: bytes.toString('base64'),
    byteLength: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    lineEndingKinds: [...new Set(lines.map((line) => line.lineEnding).filter(Boolean))],
    endsWithLineEnding: /(?:\r\n|\n|\r)$/.test(canonical)
  };
}

function normalizedPosition(node) {
  const start = Number(node?.position?.start?.offset);
  const end = Number(node?.position?.end?.offset);
  return {
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null,
    startLine: Number(node?.position?.start?.line) || null,
    endLine: Number(node?.position?.end?.line) || null
  };
}

function semanticObservationFromTree(tree) {
  const nodes = [];

  function visit(node, context, nodePath) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    const quoteDepth = context.quoteDepth + (node.type === 'blockquote' ? 1 : 0);
    const listDepth = context.listDepth + (node.type === 'list' ? 1 : 0);
    const entry = {
      path: nodePath,
      type: node.type,
      ...normalizedPosition(node),
      quoteDepth,
      listDepth
    };
    if (node.type === 'heading') entry.depth = Number(node.depth) || null;
    if (node.type === 'list') {
      entry.ordered = Boolean(node.ordered);
      entry.startNumber = node.ordered ? Number(node.start || 1) : null;
      entry.spread = Boolean(node.spread);
    }
    if (node.type === 'listItem') {
      entry.checked = typeof node.checked === 'boolean' ? node.checked : null;
      entry.ordinal = context.ordinal ?? null;
      entry.spread = Boolean(node.spread);
    }
    if (typeof node.lang === 'string' || node.lang === null) entry.lang = node.lang;
    if (typeof node.url === 'string') entry.url = node.url;
    if (Array.isArray(node.align)) entry.align = [...node.align];
    if (typeof node.value === 'string') entry.value = node.value;
    nodes.push(entry);

    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, index) => {
      const ordinal = node.type === 'list' && node.ordered
        ? Number(node.start || 1) + index
        : undefined;
      visit(child, { quoteDepth, listDepth, ordinal }, `${nodePath}.${index}`);
    });
  }

  visit(tree, { quoteDepth: 0, listDepth: 0, ordinal: undefined }, '0');
  return {
    rootTypes: (tree?.children || []).map((node) => node.type),
    nodes,
    typeCounts: nodes.reduce((counts, node) => {
      counts[node.type] = (counts[node.type] || 0) + 1;
      return counts;
    }, {}),
    maximumQuoteDepth: nodes.reduce((maximum, node) => Math.max(maximum, node.quoteDepth), 0),
    maximumListDepth: nodes.reduce((maximum, node) => Math.max(maximum, node.listDepth), 0)
  };
}

function semanticOwnersForPhysicalLine(snapshot, line, editableListRow) {
  const firstNonWhitespace = line.text.search(/\S/);
  const probeOffset = editableListRow
    ? editableListRow.contentStart
    : firstNonWhitespace >= 0
      ? line.start + firstNonWhitespace
      : line.start;
  return snapshot.semanticIndex?.ownersAtOffset?.(probeOffset) || [];
}

function physicalLineContextFromSnapshot(snapshot, editableListScan, line) {
  const editableListRow = editableListScan.byLineIndex.get(line.index) || null;
  const owners = semanticOwnersForPhysicalLine(snapshot, line, editableListRow);
  const semanticOwnerTypes = owners.map((owner) => owner.type);
  const deepestOwner = owners.at(-1) || null;
  const semanticListDepth = semanticOwnerTypes.filter((type) => type === 'list').length;
  const quoteDepth = semanticOwnerTypes.filter((type) => type === 'blockquote').length;
  return canonicalize({
    lineIndex: line.index,
    lineStart: line.start,
    lineEnd: line.contentEnd,
    lineSourceEnd: line.sourceEnd,
    lineEnding: line.lineEnding,
    blank: line.blank,
    terminal: line.terminal,
    semanticOwnerType: deepestOwner?.type || null,
    semanticOwnerTypes,
    semanticListDepth,
    quoteDepth,
    inCode: semanticOwnerTypes.includes('code') || semanticOwnerTypes.includes('inlineCode'),
    inFencedCode: editableListScan.fencedLineIndices.includes(line.index),
    editableList: editableListRow ? {
      recognized: true,
      kind: editableListRow.kind,
      ordered: editableListRow.ordered,
      tabDepth: editableListRow.tabDepth,
      depth: editableListRow.depth,
      number: editableListRow.number,
      marker: editableListRow.marker,
      markerStart: editableListRow.markerStart,
      markerEnd: editableListRow.markerEnd,
      prefixStart: editableListRow.prefixStart,
      prefixEnd: editableListRow.prefixEnd,
      contentStart: editableListRow.contentStart,
      contentEnd: editableListRow.contentEnd,
      empty: editableListRow.empty
    } : null
  });
}

function loadViewerMarkdownModel() {
  // Kept lazy so O1 adapters never need to load Viewer parser code.
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.resolve(__dirname, '../../../public/markdownPage.js'));
}

function semanticObservationFromViewer(source, model = loadViewerMarkdownModel()) {
  const canonical = String(source ?? '');
  const snapshot = model.createSourceSnapshot(canonical);
  const tree = snapshot.parserAst;
  const editableListScan = snapshot.editableListSemanticIndex;
  return {
    ...semanticObservationFromTree(tree),
    physicalLineContexts: snapshot.physicalLineIndex.lines.map((line) => (
      physicalLineContextFromSnapshot(snapshot, editableListScan, line)
    ))
  };
}

function normalizeGeometry(value, precision = 3) {
  if (Array.isArray(value)) return value.map((entry) => normalizeGeometry(entry, precision));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      normalizeGeometry(value[key], precision)
    ]));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(precision));
  }
  return value;
}

function normalizeObservation(raw = {}, options = {}) {
  const encodedBytes = raw.sourceBytesBase64
    ?? raw.fileBytesBase64
    ?? raw.fileBytes?.base64
    ?? null;
  const source = String(raw.source
    ?? raw.fileSource
    ?? raw.resultingSource
    ?? (encodedBytes == null ? '' : Buffer.from(encodedBytes, 'base64').toString('utf8')));
  const evidenceLevel = EVIDENCE_LEVELS.includes(raw.evidenceLevel)
    ? raw.evidenceLevel
    : (options.defaultEvidenceLevel || 'U');
  const semantic = raw.semantic == null ? null : canonicalize(raw.semantic);
  const presentation = raw.presentation == null ? null : canonicalize(raw.presentation);
  const geometry = raw.geometry == null ? null : normalizeGeometry(raw.geometry, options.geometryPrecision ?? 3);
  return canonicalize({
    scenarioId: raw.scenarioId ?? options.scenarioId ?? null,
    evidenceLevel,
    automatable: raw.automatable !== false,
    ambiguity: raw.ambiguity ?? null,
    source: sourceObservation(source, encodedBytes),
    selection: raw.selection == null ? null : normalizeSelection(source, raw.selection),
    physical: {
      lineCount: physicalLines(source).length,
      lines: physicalLines(source)
    },
    semantic,
    presentation,
    geometry,
    visibleText: raw.visibleText == null ? null : String(raw.visibleText),
    metadata: canonicalize(raw.metadata || {}),
    availability: {
      source: raw.source != null || raw.fileSource != null || raw.resultingSource != null || encodedBytes != null,
      sourceBytes: encodedBytes != null,
      selection: raw.selection != null,
      physical: raw.source != null || raw.fileSource != null || raw.resultingSource != null,
      semantic: semantic != null,
      presentation: presentation != null,
      geometry: geometry != null,
      visibleText: raw.visibleText != null
    }
  });
}

function observeViewerSource(source, selection = {}, options = {}) {
  const canonical = String(source ?? '');
  return normalizeObservation({
    scenarioId: options.scenarioId ?? null,
    evidenceLevel: 'U',
    automatable: true,
    source: canonical,
    selection,
    semantic: semanticObservationFromViewer(canonical, options.model),
    metadata: {runtime: 'public/markdownPage.js', ...options.metadata}
  });
}

module.exports = Object.freeze({
  EVIDENCE_LEVELS,
  loadViewerMarkdownModel,
  normalizeGeometry,
  normalizeObservation,
  normalizeSelection,
  physicalLines,
  semanticObservationFromTree,
  semanticObservationFromViewer,
  sourceObservation,
  sourcePoint,
  observeViewerSource
});
