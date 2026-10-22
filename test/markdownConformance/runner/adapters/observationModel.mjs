import crypto from 'node:crypto';

function finiteOffset(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

export function normalizeSelection(selection, sourceLength = 0) {
  if (!selection || typeof selection !== 'object') return null;
  const length = Math.max(0, finiteOffset(sourceLength));
  const anchor = Math.min(length, finiteOffset(selection.anchor, 0));
  const focus = Math.min(length, finiteOffset(selection.focus, anchor));
  return {
    anchor,
    focus,
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
    collapsed: anchor === focus,
    direction: anchor <= focus ? 'forward' : 'backward'
  };
}

function indentColumns(prefix, tabSize = 4) {
  let columns = 0;
  for (const character of prefix) {
    columns = character === '\t'
      ? columns + (tabSize - (columns % tabSize))
      : columns + 1;
  }
  return columns;
}

function lineStructure(text, index, start, end, ending) {
  const indentation = text.match(/^[\t ]*/)?.[0] || '';
  let remainder = text.slice(indentation.length);
  let quoteDepth = 0;
  while (remainder.startsWith('>')) {
    quoteDepth += 1;
    remainder = remainder.slice(1);
    if (remainder.startsWith(' ')) remainder = remainder.slice(1);
  }
  const list = remainder.match(/^([-+*]|\d+[.)])([\t ]+|$)/);
  const task = list ? remainder.slice(list[0].length).match(/^\[([ xX])\]([\t ]+|$)/) : null;
  const heading = remainder.match(/^(#{1,6})(?:[\t ]+|$)/);
  const fence = remainder.match(/^(`{3,}|~{3,})(.*)$/);
  return {
    index,
    start,
    end,
    endWithEnding: end + ending.length,
    text,
    ending,
    blank: text.length === 0,
    whitespaceOnly: text.length > 0 && /^[\t ]+$/.test(text),
    indentation,
    indentColumns: indentColumns(indentation),
    quoteDepth,
    list: list ? {
      kind: /^\d/.test(list[1]) ? 'ordered' : 'unordered',
      marker: list[1],
      task: task ? { checked: task[1].toLowerCase() === 'x', marker: task[0].trimEnd() } : null
    } : null,
    headingDepth: heading ? heading[1].length : 0,
    fence: fence ? { marker: fence[1], info: fence[2].trim() } : null,
    thematicBreakCandidate: /^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/.test(remainder)
  };
}

export function canonicalSourceFacts(value) {
  const source = typeof value === 'string' ? value : String(value ?? '');
  const lines = [];
  let start = 0;
  let index = 0;
  const matcher = /\r\n|\n|\r/g;
  let match;
  while ((match = matcher.exec(source))) {
    lines.push(lineStructure(source.slice(start, match.index), index, start, match.index, match[0]));
    start = match.index + match[0].length;
    index += 1;
  }
  lines.push(lineStructure(source.slice(start), index, start, source.length, ''));
  const lineEndings = {
    lf: (source.match(/(?<!\r)\n/g) || []).length,
    crlf: (source.match(/\r\n/g) || []).length,
    cr: (source.match(/\r(?!\n)/g) || []).length
  };
  return {
    byteLength: Buffer.byteLength(source, 'utf8'),
    characterLength: source.length,
    physicalLineCount: lines.length,
    physicalLines: lines,
    lineEndings,
    leadingBlankLine: lines[0]?.blank === true,
    trailingEmptyRow: lines.length > 1 && lines.at(-1)?.blank === true,
    trailingNewline: /(?:\r\n|\n|\r)$/.test(source),
    blankLineCount: lines.filter((line) => line.blank).length,
    maximumQuoteDepth: Math.max(0, ...lines.map((line) => line.quoteDepth)),
    maximumIndentColumns: Math.max(0, ...lines.map((line) => line.indentColumns))
  };
}

export function utf8FileBytes(source, { kind = 'canonical-markdown-utf8', path = null } = {}) {
  const bytes = Buffer.from(typeof source === 'string' ? source : String(source ?? ''), 'utf8');
  return {
    kind,
    path,
    byteLength: bytes.byteLength,
    base64: bytes.toString('base64'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

function normalizedGeometry(value) {
  if (!value || typeof value !== 'object') return null;
  const round = (number) => Number.isFinite(Number(number))
    ? Math.round(Number(number) * 100) / 100
    : null;
  const rect = (candidate) => candidate ? {
    x: round(candidate.x ?? candidate.left),
    y: round(candidate.y ?? candidate.top),
    left: round(candidate.left ?? candidate.x),
    top: round(candidate.top ?? candidate.y),
    right: round(candidate.right),
    bottom: round(candidate.bottom),
    width: round(candidate.width),
    height: round(candidate.height)
  } : null;
  return {
    viewport: rect(value.viewport),
    editor: rect(value.editor),
    lines: (value.lines || []).map((line, index) => ({
      index: Number.isInteger(line.index) ? line.index : index,
      text: typeof line.text === 'string' ? line.text : '',
      sourceStart: Number.isFinite(Number(line.sourceStart)) ? Number(line.sourceStart) : null,
      sourceEnd: Number.isFinite(Number(line.sourceEnd)) ? Number(line.sourceEnd) : null,
      rect: rect(line.rect || line)
    }))
  };
}

export function buildRuntimeObservation({
  scenarioId,
  evidenceLevel,
  source,
  fileBytes,
  selection,
  runtime = {},
  metadata = {},
  automatable = true,
  raw = {}
}) {
  const canonicalSource = typeof source === 'string' ? source : String(source ?? '');
  const facts = canonicalSourceFacts(canonicalSource);
  const normalized = normalizeSelection(selection, canonicalSource.length);
  const geometry = normalizedGeometry(runtime.geometry);
  const semanticElements = Array.isArray(runtime.semanticElements)
    ? runtime.semanticElements
    : Array.isArray(runtime.dom?.semanticElements)
      ? runtime.dom.semanticElements
      : [];
  const markerState = Array.isArray(runtime.markers)
    ? runtime.markers
    : Array.isArray(runtime.dom?.markers)
      ? runtime.dom.markers
      : [];
  const visibleMarkerText = markerState
    .filter((marker) => marker?.visible !== false)
    .map((marker) => String(marker?.text || ''))
    .join('');
  const visibleText = typeof runtime.visibleText === 'string' ? runtime.visibleText : '';
  const effectiveFileBytes = fileBytes || utf8FileBytes(canonicalSource);
  const semantic = runtime.semantic && typeof runtime.semantic === 'object'
    ? runtime.semantic
    : {
        physicalLineCount: facts.physicalLineCount,
        physicalLines: facts.physicalLines,
        sourceStructure: {
          maximumQuoteDepth: facts.maximumQuoteDepth,
          maximumIndentColumns: facts.maximumIndentColumns,
          blankLineCount: facts.blankLineCount,
          leadingBlankLine: facts.leadingBlankLine,
          trailingEmptyRow: facts.trailingEmptyRow,
          trailingNewline: facts.trailingNewline,
          lineEndings: facts.lineEndings
        },
        elements: semanticElements,
        renderedElementTypes: [...new Set(semanticElements.map((element) => element.type).filter(Boolean))]
      };
  return {
    scenarioId,
    evidenceLevel,
    automatable: Boolean(automatable),
    source: canonicalSource,
    fileBytes: effectiveFileBytes,
    sourceBytesBase64: effectiveFileBytes.base64 || null,
    fileBytesBase64: effectiveFileBytes.base64 || null,
    selection: normalized,
    physicalLines: facts.physicalLines.map((line) => line.text),
    physicalLineCount: facts.physicalLineCount,
    semantic,
    presentation: {
      mode: runtime.mode || metadata.mode || null,
      active: typeof runtime.active === 'boolean' ? runtime.active : null,
      visibleText,
      visibleLines: visibleText.split('\n'),
      markerVisibility: runtime.markerVisibility
        || (visibleMarkerText ? 'visible' : 'hidden'),
      visibleMarkers: runtime.visibleMarkers
        || visibleMarkerText,
      quoteRailText: runtime.quoteRailText || null,
      elementType: runtime.elementType || null,
      layout: runtime.layout || null,
      controls: runtime.controls || null,
      renderedState: runtime.renderedState || null,
      geometry: runtime.presentationGeometry || null,
      list: runtime.presentationFacts?.list || runtime.listPresentation || null,
      focus: runtime.presentationFacts?.focus || runtime.focus || null
    },
    geometry,
    visibleText,
    metadata: {
      ...metadata,
      evidenceLevel,
      sourceCharacterLength: facts.characterLength,
      sourceByteLength: facts.byteLength
    },
    raw: { ...raw, runtime }
  };
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function compactFileBytes(value) {
  if (!value || typeof value !== 'object') return undefined;
  return definedEntries({
    kind: value.kind,
    path: value.path,
    byteLength: value.byteLength,
    base64: value.base64,
    sha256: value.sha256
  });
}

function compactTraceMetadata(metadata = {}) {
  const packageFreshness = metadata.packageFreshness;
  return definedEntries({
    adapter: metadata.adapter,
    evidenceLevel: metadata.evidenceLevel,
    mode: metadata.mode,
    active: metadata.active,
    versions: metadata.versions,
    viewerVersion: metadata.viewerVersion,
    viewerCommit: metadata.viewerCommit,
    settings: metadata.settings,
    activeFile: metadata.activeFile,
    isolated: metadata.isolated,
    artifactsRetained: metadata.artifactsRetained,
    fileEditorMatch: metadata.fileEditorMatch,
    persistedJsonError: metadata.persistedJsonError,
    consistency: metadata.consistency,
    selectionOrigin: metadata.selectionOrigin,
    runtimeExpectation: metadata.runtimeExpectation,
    asarSha256: metadata.asarSha256,
    setupAttemptCount: metadata.setupAttemptCount,
    packageAsarSha256: packageFreshness?.asarSha256,
    sourceCharacterLength: metadata.sourceCharacterLength,
    sourceByteLength: metadata.sourceByteLength,
    actionTraceCapture: metadata.actionTraceCapture,
    actionTraceCaptureDurationMs: metadata.actionTraceCaptureDurationMs,
    automationError: metadata.automationError
  });
}

function compactTraceRuntime(runtime = {}) {
  return definedEntries({
    activeFile: runtime.activeFile,
    semantic: runtime.semantic,
    markers: runtime.markers,
    presentationFacts: runtime.presentationFacts
  });
}

/**
 * Keep every comparison field plus exact persisted-byte authority, but omit
 * repeated process logs, complete runtime snapshots, and duplicate page
 * objects from observations captured after each action.
 */
export function compactActionTraceObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('Action trace observation must be an object.');
  }
  const raw = observation.raw && typeof observation.raw === 'object'
    ? observation.raw
    : {};
  return definedEntries({
    scenarioId: observation.scenarioId,
    evidenceLevel: observation.evidenceLevel,
    automatable: observation.automatable,
    ambiguity: observation.ambiguity,
    reason: observation.reason,
    source: observation.source,
    fileBytes: compactFileBytes(observation.fileBytes),
    selection: observation.selection,
    physicalLines: observation.physicalLines,
    physicalLineCount: observation.physicalLineCount,
    semantic: observation.semantic,
    presentation: observation.presentation,
    geometry: observation.geometry,
    visibleText: observation.visibleText,
    metadata: compactTraceMetadata(observation.metadata),
    consistency: observation.consistency,
    integrityFailure: observation.integrityFailure,
    persistedFileBytes: compactFileBytes(observation.persistedFileBytes),
    raw: definedEntries({
      runtime: compactTraceRuntime(raw.runtime),
      editorSource: raw.editorSource,
      domSource: raw.domSource
    })
  });
}

export function nonAutomatableObservation({
  scenarioId,
  evidenceLevel,
  error,
  metadata = {},
  source = ''
}) {
  return buildRuntimeObservation({
    scenarioId,
    evidenceLevel,
    source,
    automatable: false,
    metadata: {
      ...metadata,
      automationError: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        details: error?.details || null
      }
    }
  });
}

export function scenarioSelection(scenario, source = scenario?.initialSource || '') {
  const supplied = scenario?.initialSelection || scenario?.selection;
  if (supplied) return normalizeSelection(supplied, source.length);
  return normalizeSelection({ anchor: source.length, focus: source.length }, source.length);
}

export function scenarioActionSequence(scenario) {
  if (Array.isArray(scenario?.sequence)) return scenario.sequence;
  if (Array.isArray(scenario?.actions)) return scenario.actions;
  if (scenario?.action !== undefined && scenario?.action !== null) return [scenario.action];
  return [];
}
