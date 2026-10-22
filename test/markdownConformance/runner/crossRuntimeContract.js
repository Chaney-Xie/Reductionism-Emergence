'use strict';

const path = require('node:path');
const {
  STATUS,
  countStatuses
} = require('./comparator');
const {
  compareFinalTraceScenario,
  observationArray,
  scenarioArray
} = require('./finalTraceEvidence');
const { canonicalize, digest } = require('./utils');

const CONTRACT_VERSION = 2;
const NORMALIZED_FAMILIES = new Set([
  'quotes',
  'inline-latex',
  'display-latex',
  'thematic-break',
  'tables'
]);
const LIST_FAMILIES = new Set([
  'ordered-lists',
  'unordered-lists',
  'mixed-lists',
  'task-lists'
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function indexUnique(entries, idField, label) {
  const indexed = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    const id = entry[idField];
    if (typeof id !== 'string' || !id) {
      throw new TypeError(`${label} entry is missing string ${idField}.`);
    }
    if (indexed.has(id)) throw new Error(`Duplicate ${label} scenario ID: ${id}`);
    indexed.set(id, entry);
  }
  return indexed;
}

function semanticTypes(observation) {
  const semantic = observation?.semantic || {};
  const values = [
    ...(Array.isArray(semantic.rootTypes) ? semantic.rootTypes : []),
    ...(Array.isArray(semantic.nodes) ? semantic.nodes.map(({ type }) => type) : []),
    ...(Array.isArray(semantic.elements) ? semantic.elements.map(({ type }) => type) : []),
    ...Object.keys(semantic.typeCounts || {})
  ];
  return [...new Set(values.filter((value) => typeof value === 'string' && value))].sort();
}

function presentationFacts(observation) {
  return observation?.raw?.runtime?.presentationFacts || {};
}

function observationSourceText(observation) {
  const direct = observation?.source
    ?? observation?.fileSource
    ?? observation?.resultingSource;
  if (typeof direct === 'string') return direct;
  if (direct && typeof direct.text === 'string') return direct.text;
  const encoded = observation?.sourceBytesBase64
    ?? observation?.fileBytesBase64
    ?? observation?.fileBytes?.base64;
  return typeof encoded === 'string'
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : '';
}

function sourceBytesAgreeWithText(observation, source) {
  const encoded = observation?.sourceBytesBase64
    ?? observation?.fileBytesBase64
    ?? observation?.fileBytes?.base64;
  if (encoded == null) return true;
  if (typeof encoded !== 'string') return false;
  return Buffer.from(encoded, 'base64').equals(Buffer.from(source, 'utf8'));
}

function selectionsExactlyAgree(obsidian, viewer) {
  const obsidianAnchor = Number(obsidian?.selection?.anchor);
  const obsidianFocus = Number(obsidian?.selection?.focus);
  const viewerAnchor = Number(viewer?.selection?.anchor);
  const viewerFocus = Number(viewer?.selection?.focus);
  return Number.isSafeInteger(obsidianAnchor)
    && Number.isSafeInteger(obsidianFocus)
    && obsidianAnchor === viewerAnchor
    && obsidianFocus === viewerFocus;
}

function sourceLines(source) {
  const canonical = String(source ?? '');
  const lines = [];
  const endings = /\r\n|\n|\r/g;
  let start = 0;
  let match;
  while ((match = endings.exec(canonical))) {
    lines.push({
      index: lines.length,
      start,
      end: match.index,
      text: canonical.slice(start, match.index)
    });
    start = match.index + match[0].length;
  }
  lines.push({
    index: lines.length,
    start,
    end: canonical.length,
    text: canonical.slice(start)
  });
  return lines;
}

function thematicBreakSourceLines(source) {
  return sourceLines(source).filter(({ text }) => (
    /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(text)
  ));
}

function semanticRecognizesThematicBreak(observation) {
  const types = semanticTypes(observation);
  return types.includes('thematicBreak') || types.includes('thematic-break');
}

function viewerIntegrityIsClean(viewer) {
  const failure = viewer?.integrityFailure;
  if (failure == null || failure === false || failure === '') return true;
  if (Array.isArray(failure)) return failure.length === 0;
  if (failure && typeof failure === 'object') {
    return Object.values(failure).every((value) => !value);
  }
  return false;
}

/**
 * V1 intentionally represents a thematic break with a source-backed div
 * rather than an hr node. Bridge that capture taxonomy only when both
 * runtimes and every independent Viewer surface prove the current construct.
 */
function observedThematicBreakSemanticBridge(obsidian, viewer) {
  if (obsidian?.evidenceLevel !== 'O1' || viewer?.evidenceLevel !== 'V1') return null;
  if (obsidian?.automatable === false || viewer?.automatable === false) return null;
  if (!viewerIntegrityIsClean(viewer)) return null;

  const obsidianSource = observationSourceText(obsidian);
  const viewerSource = observationSourceText(viewer);
  if (obsidianSource !== viewerSource) return null;
  if (!selectionsExactlyAgree(obsidian, viewer)) return null;
  if (!sourceBytesAgreeWithText(obsidian, obsidianSource)
    || !sourceBytesAgreeWithText(viewer, viewerSource)) return null;
  if (obsidian?.raw?.editorSource !== obsidianSource) return null;
  if (viewer?.raw?.domSource !== viewerSource) return null;
  if (!semanticRecognizesThematicBreak(obsidian)
    || semanticRecognizesThematicBreak(viewer)) return null;

  const facts = presentationFacts(viewer).thematicBreak || {};
  if (facts.elementPresent !== true
    || facts.elementTag !== 'div'
    || facts.markerVisible !== false) return null;
  const markers = Array.isArray(viewer?.raw?.runtime?.markers)
    ? viewer.raw.runtime.markers
    : [];
  const candidates = thematicBreakSourceLines(viewerSource);
  for (const candidate of candidates) {
    const marker = markers.find((entry) => (
      entry?.kind === 'thematic-break'
      && entry.visible === false
      && entry.text === candidate.text
      && entry.sourceStart === candidate.start
      && entry.sourceEnd === candidate.end
      && viewerSource.slice(entry.sourceStart, entry.sourceEnd) === entry.text
    ));
    if (!marker || facts.markerText !== marker.text) continue;
    return canonicalize({
      construct: 'thematic-break',
      obsidianSemanticType: 'thematicBreak',
      sourceLine: candidate,
      viewer: {
        domSourceExact: true,
        elementPresent: true,
        elementTag: facts.elementTag,
        markerHidden: true,
        markerKind: marker.kind,
        markerRange: { start: marker.sourceStart, end: marker.sourceEnd },
        markerText: marker.text
      }
    });
  }
  return null;
}

function quoteDepth(observation) {
  const candidates = [
    observation?.semantic?.maximumQuoteDepth,
    presentationFacts(observation)?.quote?.depth,
    observation?.raw?.runtime?.semantic?.maximumQuoteDepth
  ].map(Number).filter(Number.isFinite);
  return candidates.length ? Math.max(0, ...candidates) : 0;
}

function genericSemanticContract(observation, options = {}) {
  const types = semanticTypes(observation);
  const nodes = Array.isArray(observation.semantic.nodes) ? observation.semantic.nodes : [];
  const thematicBreakBridge = Boolean(options.thematicBreakBridge);
  const conceptTypes = types.filter((type) => (
    type !== 'paragraph'
    && type !== 'break'
    && (!thematicBreakBridge || (type !== 'thematicBreak' && type !== 'thematic-break'))
  ));
  const listStructure = nodes
    .filter(({ type }) => type === 'list' || type === 'listItem')
    .map((node) => ({
      type: node.type,
      quoteDepth: Number(node.quoteDepth) || 0,
      listDepth: Number(node.listDepth) || 0,
      ordered: node.ordered ?? null,
      startNumber: node.startNumber ?? null,
      ordinal: node.ordinal ?? null,
      checked: node.checked ?? null
    }));
  const headingDepths = nodes
    .filter(({ type }) => type === 'heading')
    .map(({ depth }) => Number(depth) || null);
  const tableCells = nodes
    .filter(({ type }) => type === 'tableCell')
    .map(({ header }) => ({ header: header ?? null }));
  return {
    contentBlockRecognized: thematicBreakBridge
      || types.some((type) => type !== 'break'),
    concepts: conceptTypes,
    maximumQuoteDepth: Number(observation.semantic.maximumQuoteDepth) || 0,
    maximumListDepth: Number(observation.semantic.maximumListDepth) || 0,
    listStructure,
    headingDepths,
    tableCells,
    ...(thematicBreakBridge ? { thematicBreakRecognized: true } : {})
  };
}

function isExpandedListBehaviorScenario(scenario) {
  if (!LIST_FAMILIES.has(scenario?.syntaxFamily)) return false;
  if (Array.isArray(scenario?.tags)
    && scenario.tags.includes('list-editing-expanded')) return true;

  // Some focused lifecycle probes predate the expanded-list tag. Promote a
  // list action sequence only when it explicitly requests both normalized
  // list surfaces. actionIndex/originScenarioId keeps that classification on
  // the derived per-action scenario used by action-trace comparison.
  const required = new Set(Array.isArray(scenario?.requiredObservations)
    ? scenario.requiredObservations
    : []);
  const isActionSequence = Array.isArray(scenario?.actions)
    && scenario.actions.length > 0;
  const isDerivedAction = Number.isInteger(scenario?.actionIndex)
    && typeof scenario?.originScenarioId === 'string'
    && scenario.originScenarioId.length > 0;
  return (isActionSequence || isDerivedAction)
    && required.has('semantic')
    && required.has('presentation');
}

function observedListFacts(observation) {
  return observation?.presentation?.list
    || presentationFacts(observation).list
    || null;
}

function normalizedListStructure(observation) {
  const facts = observedListFacts(observation);
  if (!facts || !Array.isArray(facts.items)) return null;
  return facts.items.map((item) => {
    const itemPath = item?.itemPath ?? null;
    // itemPath/parentPath come from the same canonical physical-source
    // inventory in O1 and V1. Renderer depth classes are not comparable when
    // a parser absorbs a later physical marker into a same-line list item, so
    // derive the redundant depth field from canonical hierarchy identity.
    const canonicalDepth = typeof itemPath === 'string' && itemPath.length
      ? itemPath.split('.').length
      : 0;
    return {
      itemPath,
      parentPath: item?.parentPath ?? null,
      lineIndex: Number.isInteger(item?.lineIndex) ? item.lineIndex : null,
      listDepth: canonicalDepth || Number(item?.listDepth) || 0,
      quoteDepth: Number(item?.quoteDepth) || 0,
      kind: item?.kind ?? null,
      recognized: item?.recognized === true,
      checked: typeof item?.checked === 'boolean' ? item.checked : null
    };
  });
}

function listSemanticContract(observation) {
  const items = normalizedListStructure(observation);
  if (!items) return null;
  return {
    construct: 'list',
    items,
    maximumListDepth: items.reduce(
      (maximum, item) => Math.max(maximum, item.listDepth),
      0
    )
  };
}

function normalizedListMarkerOwner(owner) {
  const value = String(owner ?? '').trim().toLowerCase();
  if (!value || value === 'unknown') return 'unknown';
  if (value === 'none') return 'none';
  if (value === 'source'
    || value === 'source-marker'
    || value === 'raw-source'
    || value === 'canonical-source') return 'source';
  if (value === 'semantic'
    || value === 'native-list'
    || value === 'custom-generated'
    || value === 'semantic-list') return 'semantic';
  return 'unknown';
}

function normalizedDisplayedListMarker(item) {
  const owner = normalizedListMarkerOwner(item?.markerOwner);
  if (owner === 'none' || item?.markerVisible !== true) return null;
  // Native/custom unordered bullets expose incomparable implementation text
  // (`disc`, a zero-width custom glyph, etc.). Their behavioral contract is a
  // visible semantic bullet. Source-owned `-`, `*`, and `+` remain exact.
  if (owner === 'semantic' && item?.kind === 'unordered') return 'unordered-bullet';
  return item?.displayedMarker ?? null;
}

function listPresentationContract(observation) {
  const facts = observedListFacts(observation);
  if (!facts || !Array.isArray(facts.items)) return null;
  return {
    active: observation?.presentation?.active ?? facts.focus?.editorActive ?? null,
    focus: facts.focus ? {
      editorActive: facts.focus.editorActive === true,
      activeItemPaths: Array.isArray(facts.focus.activeItemPaths)
        ? [...facts.focus.activeItemPaths]
        : [],
      activeLineIndexes: Array.isArray(facts.focus.activeLineIndexes)
        ? [...facts.focus.activeLineIndexes]
        : []
    } : null,
    markers: facts.items.map((item) => ({
      itemPath: item?.itemPath ?? null,
      lineIndex: Number.isInteger(item?.lineIndex) ? item.lineIndex : null,
      kind: item?.kind ?? null,
      markerOwner: normalizedListMarkerOwner(item?.markerOwner),
      displayedMarker: normalizedDisplayedListMarker(item),
      displayedOrdinal: item?.displayedOrdinal != null
        && Number.isFinite(Number(item.displayedOrdinal))
        ? Number(item.displayedOrdinal)
        : null,
      markerVisible: item?.markerVisible === true,
      active: item?.active === true
    }))
  };
}

function semanticContract(scenario, observation, options = {}) {
  if (observation?.semantic == null) return null;
  const family = scenario.syntaxFamily;
  const types = semanticTypes(observation);
  const facts = presentationFacts(observation);
  if (options.thematicBreakBridge && family !== 'thematic-break') {
    return genericSemanticContract(observation, { thematicBreakBridge: true });
  }
  if (isExpandedListBehaviorScenario(scenario)) {
    return listSemanticContract(observation);
  }
  if (family === 'quotes') {
    const maximumDepth = quoteDepth(observation);
    return {
      construct: 'blockquote',
      recognized: types.includes('blockquote')
        || maximumDepth > 0
        || Number(facts.quote?.visibleRailCount || 0) > 0,
      maximumDepth
    };
  }
  if (family === 'inline-latex' || family === 'display-latex') {
    return {
      construct: family,
      recognized: types.includes('math')
        || observation.presentation?.elementType === 'math'
        || facts.math?.sourceVisible === true
        || facts.math?.renderedVisible === true
    };
  }
  if (family === 'thematic-break') {
    return {
      construct: 'thematic-break',
      recognized: types.includes('thematicBreak')
        || types.includes('thematic-break')
        || facts.thematicBreak?.elementPresent === true
    };
  }
  if (family === 'tables') {
    return {
      construct: 'table',
      recognized: types.includes('table')
        || observation.presentation?.elementType === 'table'
        || facts.table?.present === true
    };
  }
  return genericSemanticContract(observation);
}

function titleFromObservation(observation) {
  const activeFile = observation?.metadata?.activeFile
    || observation?.raw?.runtime?.activeFile
    || null;
  if (typeof activeFile !== 'string' || !activeFile) return null;
  return path.basename(activeFile, path.extname(activeFile));
}

function stripRuntimeChrome(text, observation, role) {
  const normalized = String(text ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n');
  if (role !== 'obsidian') return { text: normalized, titleStripped: false };
  const title = titleFromObservation(observation);
  if (!title) return { text: normalized, titleStripped: false };
  const lines = normalized.split('\n');
  if (lines[0] !== title) return { text: normalized, titleStripped: false };
  lines.shift();
  if (lines[0] === '') lines.shift();
  return { text: lines.join('\n'), titleStripped: true };
}

function normalizedQuoteEditingText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:>\s*)+/, '').trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

function sourceSliceForMarker(source, marker) {
  const start = Number(marker?.sourceStart);
  const end = Number(marker?.sourceEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return null;
  }
  return String(source ?? '').slice(start, end);
}

function visibleQuoteMarkerCandidates(observation) {
  const runtime = observation?.raw?.runtime || {};
  const markers = Array.isArray(runtime.markers) ? runtime.markers : [];
  const depth = quoteDepth(observation);
  const hasQuoteContainer = depth > 0
    || Number(runtime.presentationFacts?.quote?.visibleRailCount || 0) > 0;
  return markers.filter((marker) => {
    if (marker?.visible === false) return false;
    const markerText = String(marker?.text ?? sourceSliceForMarker(observation?.source, marker) ?? '');
    if (!/^\s*>+\s*$/.test(markerText)) return false;
    return marker.kind === 'quote' || hasQuoteContainer;
  });
}

/**
 * Older V1 evidence labelled a marker-only `>` as generic syntax because the
 * marker sits directly under `.markdown-page-quote`, not under the usual
 * `.markdown-page-quote-source-line`. The rail and the marker were both
 * independently observed; this repairs only that capture taxonomy.
 */
function normalizedViewerQuoteCapture(scenario, observation) {
  const presentation = observation?.presentation || {};
  const runtime = observation?.raw?.runtime || {};
  const candidates = visibleQuoteMarkerCandidates(observation);
  const visibleMarker = candidates[0] || null;
  const markerText = visibleMarker
    ? String(visibleMarker.text ?? sourceSliceForMarker(observation?.source, visibleMarker) ?? '')
    : '';
  const modeShowsSource = scenario.mode === 'source'
    || (scenario.mode === 'live-preview' && scenario.state?.active === true);
  const recovered = Boolean(
    modeShowsSource
    && visibleMarker
    && visibleMarker.kind !== 'quote'
    && runtime.presentationFacts?.quote
  );
  return {
    quoteRailText: modeShowsSource && markerText
      ? `|${markerText.replace(/\s/g, '')}`
      : (presentation.quoteRailText ?? null),
    recoveryApplied: recovered,
    markerCaptureKind: visibleMarker?.kind || null,
    markerSourceRange: visibleMarker ? {
      start: Number.isFinite(Number(visibleMarker.sourceStart))
        ? Number(visibleMarker.sourceStart) : null,
      end: Number.isFinite(Number(visibleMarker.sourceEnd))
        ? Number(visibleMarker.sourceEnd) : null
    } : null
  };
}

function geometryLeaf(presentation, key) {
  const geometry = presentation?.geometry;
  if (!geometry || !Object.prototype.hasOwnProperty.call(geometry, key)) return { [key]: null };
  const value = geometry[key];
  if (key === 'rails') {
    return { rails: Array.isArray(value) ? { visibleRailCount: value.length } : null };
  }
  if (key === 'formula') {
    return {
      formula: value ? {
        sourceVisible: Boolean(value.source),
        renderedVisible: Boolean(value.rendered)
      } : null
    };
  }
  if (key === 'table') return { table: value ? { present: true } : null };
  return { [key]: value == null ? null : { present: true } };
}

function isFocusedOrderedListNumberingScenario(scenario) {
  return scenario?.syntaxFamily === 'ordered-lists'
    && Array.isArray(scenario?.tags)
    && scenario.tags.includes('ordered-numbering');
}

function orderedListNumberingContract(observation) {
  const facts = presentationFacts(observation).orderedList || {};
  const entries = Array.isArray(facts.entries)
    ? facts.entries.map((entry) => ({
        listDepth: Number(entry?.listDepth) || 0,
        ordinal: Number.isFinite(Number(entry?.ordinal)) ? Number(entry.ordinal) : null
      }))
    : null;
  return {
    entries,
    rendered: facts.rendered === true
  };
}

function presentationContract(scenario, observation, role) {
  const presentation = observation?.presentation;
  if (presentation == null) return { contract: null, audit: {} };
  const family = scenario.syntaxFamily;
  if (isExpandedListBehaviorScenario(scenario)) {
    const facts = observedListFacts(observation);
    return {
      contract: {
        mode: presentation.mode ?? null,
        list: listPresentationContract(observation)
      },
      audit: canonicalize({
        adapter: 'list-editing-behavior-v1',
        role,
        sourceItems: facts?.sourceItems || null,
        markerOwners: Array.isArray(facts?.items)
          ? facts.items.map(({ itemPath, markerOwner }) => ({ itemPath, markerOwner }))
          : null,
        lifecycle: role === 'viewer' ? {
          parserAstItems: facts?.astItems || null,
          semanticDom: facts?.domLifecycle || null,
          effectiveMarkers: facts?.lifecycleMarkers || null,
          integrity: facts?.lifecycleIntegrity || null,
          parserError: facts?.astParseError || null
        } : null
      })
    };
  }
  if (isFocusedOrderedListNumberingScenario(scenario)) {
    const facts = presentationFacts(observation).orderedList || {};
    return {
      contract: {
        mode: presentation.mode ?? null,
        active: scenario.state?.active === true,
        orderedNumbering: orderedListNumberingContract(observation)
      },
      audit: canonicalize({
        adapter: 'ordered-list-numbering-behavior-v1',
        role,
        visibleMarkerOrdinals: facts.visibleMarkerOrdinals || null,
        itemFacts: facts.itemFacts || null
      })
    };
  }
  if (!NORMALIZED_FAMILIES.has(family)) {
    const scoped = stripRuntimeChrome(presentation.visibleText, observation, role);
    return {
      contract: {
        mode: presentation.mode ?? null,
        visibleText: scoped.text,
        markerVisibility: presentation.markerVisibility ?? null,
        visibleMarkers: presentation.visibleMarkers ?? '',
        quoteRailText: presentation.quoteRailText ?? null,
        elementType: presentation.elementType ?? null,
        layout: presentation.layout ?? null,
        controls: presentation.controls ?? null,
        renderedState: presentation.renderedState ?? null
      },
      audit: {
        adapter: 'generic-observable-presentation-v1',
        titleStripped: scoped.titleStripped
      }
    };
  }
  const scoped = stripRuntimeChrome(presentation.visibleText, observation, role);
  if (family === 'quotes') {
    const quoteCapture = role === 'viewer'
      ? normalizedViewerQuoteCapture(scenario, observation)
      : { quoteRailText: presentation.quoteRailText ?? null, recoveryApplied: false };
    return {
      contract: {
        mode: presentation.mode ?? null,
        visibleText: scenario.mode === 'reading'
          ? scoped.text.trim()
          : normalizedQuoteEditingText(scoped.text),
        markerVisibility: presentation.markerVisibility ?? null,
        visibleMarkers: presentation.visibleMarkers ?? '',
        quoteRailText: quoteCapture.quoteRailText,
        renderedState: presentation.renderedState ?? null,
        geometry: geometryLeaf(presentation, 'rails')
      },
      audit: {
        adapter: 'quote-behavior-v1',
        titleStripped: scoped.titleStripped,
        editingTextTokenized: scenario.mode !== 'reading',
        quoteMarkerRecoveryApplied: quoteCapture.recoveryApplied,
        markerCaptureKind: quoteCapture.markerCaptureKind || null,
        markerSourceRange: quoteCapture.markerSourceRange || null
      }
    };
  }
  if (family === 'inline-latex' || family === 'display-latex') {
    return {
      contract: {
        mode: presentation.mode ?? null,
        visibleText: scoped.text,
        markerVisibility: presentation.markerVisibility ?? null,
        elementType: presentation.elementType ?? null,
        layout: presentation.layout ?? null,
        renderedState: presentation.renderedState ?? null,
        geometry: geometryLeaf(presentation, 'formula')
      },
      audit: {
        adapter: 'math-behavior-v1',
        titleStripped: scoped.titleStripped
      }
    };
  }
  if (family === 'thematic-break') {
    return {
      contract: {
        mode: presentation.mode ?? null,
        visibleText: scoped.text,
        markerVisibility: presentation.markerVisibility ?? null,
        elementType: presentation.elementType ?? null,
        renderedState: presentation.renderedState ?? null
      },
      audit: {
        adapter: 'thematic-break-behavior-v1',
        titleStripped: scoped.titleStripped
      }
    };
  }
  return {
    contract: {
      mode: presentation.mode ?? null,
      markerVisibility: presentation.markerVisibility ?? null,
      elementType: presentation.elementType ?? null,
      controls: presentation.controls ?? null,
      renderedState: presentation.renderedState ?? null,
      geometry: geometryLeaf(presentation, 'table')
    },
    audit: { adapter: 'table-behavior-v1' }
  };
}

function projectObservation(scenario, observation, role, options = {}) {
  if (!observation) return { observation: null, audit: { available: false } };
  const thematicBreakBridge = options.thematicBreakBridge || null;
  const semantic = semanticContract(scenario, observation, {
    role,
    thematicBreakBridge
  });
  const presentation = presentationContract(scenario, observation, role);
  const needsSemantic = (scenario.requiredObservations || []).includes('semantic');
  const missingIndependentRecognition = needsSemantic
    && semantic
    && Object.prototype.hasOwnProperty.call(semantic, 'recognized')
    && semantic.recognized !== true;
  const projected = {
    ...observation,
    semantic,
    presentation: presentation.contract,
    ambiguity: observation.ambiguity || (missingIndependentRecognition
      ? `${role} did not independently expose the expected ${scenario.syntaxFamily} construct.`
      : null)
  };
  const semanticAdapter = thematicBreakBridge && scenario.syntaxFamily !== 'thematic-break'
    ? 'observed-thematic-break-semantic-bridge-v1'
    : (isExpandedListBehaviorScenario(scenario)
      ? 'list-editing-behavior-v1'
      : (NORMALIZED_FAMILIES.has(scenario.syntaxFamily)
        ? `${scenario.syntaxFamily}-concept-v1`
        : 'generic-structural-concept-v1'));
  return {
    observation: projected,
    audit: canonicalize({
      available: true,
      normalized: true,
      semanticAdapter,
      semanticBridge: role === 'viewer' ? thematicBreakBridge : null,
      observedSemanticTypes: semanticTypes(observation),
      semanticContract: semantic,
      presentation: presentation.audit
    })
  };
}

function rawDigest(observation) {
  return observation == null ? null : digest(observation);
}

function differencePaths(result) {
  return Array.isArray(result?.differences)
    ? result.differences.map(({ path: differencePath }) => differencePath)
    : [];
}

function normalizedReasonCode(result) {
  if (result.reasonCode) return result.reasonCode;
  if (result.status === STATUS.MATCH) return 'normalized-contract-match';
  if (result.status === STATUS.INTENTIONAL_VIEWER_OVERRIDE) return 'normalized-override-accepted';
  if (result.sourceAuthorityFailed) return 'source-authority-failed';
  if (result.status === STATUS.VIEWER_FAIL) return 'normalized-behavior-mismatch';
  return 'normalized-comparison-indeterminate';
}

function compareNormalizedCrossRuntimeScenario(
  scenario,
  obsidian,
  viewer,
  overridesDocument = {}
) {
  const raw = compareFinalTraceScenario(scenario, obsidian, viewer, overridesDocument);
  const thematicBreakBridge = observedThematicBreakSemanticBridge(obsidian, viewer);
  const projectionOptions = { thematicBreakBridge };
  const projectedObsidian = projectObservation(
    scenario, obsidian, 'obsidian', projectionOptions
  );
  const projectedViewer = projectObservation(
    scenario, viewer, 'viewer', projectionOptions
  );
  const compared = compareFinalTraceScenario(
    scenario,
    projectedObsidian.observation,
    projectedViewer.observation,
    overridesDocument
  );
  return canonicalize({
    ...compared,
    reasonCode: normalizedReasonCode(compared),
    comparisonLayer: `cross-runtime-behavior-contract-v${CONTRACT_VERSION}`,
    observedSemanticBridge: thematicBreakBridge,
    rawStrictStatus: raw.status,
    rawEvidence: {
      preservedInSourceDocuments: true,
      obsidianSha256: rawDigest(obsidian),
      viewerSha256: rawDigest(viewer),
      rawDifferencePaths: differencePaths(raw)
    },
    normalizedEvidence: {
      obsidian: projectedObsidian.observation ? {
        semantic: projectedObsidian.observation.semantic,
        presentation: projectedObsidian.observation.presentation
      } : null,
      viewer: projectedViewer.observation ? {
        semantic: projectedViewer.observation.semantic,
        presentation: projectedViewer.observation.presentation
      } : null
    },
    normalizationAudit: {
      obsidian: projectedObsidian.audit,
      viewer: projectedViewer.audit
    }
  });
}

function unexpectedIds(observations, scenarios) {
  return [...observations.keys()].filter((id) => !scenarios.has(id));
}

function compareNormalizedCrossRuntimeEvidence(
  scenarioDocument,
  obsidianEvidenceDocument,
  viewerEvidenceDocument,
  overridesDocument = {}
) {
  const scenarios = scenarioArray(scenarioDocument);
  const obsidianObservations = observationArray(obsidianEvidenceDocument, 'Obsidian');
  const viewerObservations = observationArray(viewerEvidenceDocument, 'Viewer');
  const scenarioById = indexUnique(scenarios, 'id', 'scenario');
  const obsidianById = indexUnique(obsidianObservations, 'scenarioId', 'Obsidian observation');
  const viewerById = indexUnique(viewerObservations, 'scenarioId', 'Viewer observation');
  const results = scenarios.map((scenario) => compareNormalizedCrossRuntimeScenario(
    scenario,
    obsidianById.get(scenario.id),
    viewerById.get(scenario.id),
    overridesDocument
  ));
  const rawStrictCounts = countStatuses(results.map((result) => ({ status: result.rawStrictStatus })));
  return canonicalize({
    schemaVersion: 1,
    kind: 'o1-v1-normalized-cross-runtime-comparison',
    contractVersion: CONTRACT_VERSION,
    scenarioCount: scenarios.length,
    scenarioSource: {
      corpusSha256: scenarioDocument?.sourceCorpusSha256
        || scenarioDocument?.corpusSha256
        || null,
      corpusScenarioCount: scenarioDocument?.sourceCorpusScenarioCount
        || scenarioDocument?.scenarioCount
        || scenarioDocument?.count
        || scenarios.length,
      selectedScenarioCount: scenarios.length
    },
    policy: {
      sourceSelectionAndPhysicalRemainExact: true,
      rawEvidencePreservedByDigestAndSourceDocument: true,
      normalizedFamilies: [...NORMALIZED_FAMILIES].sort(),
      genericStructuralContractAppliesToAllOtherFamilies: true,
      readingVisibleTextRemainsLineBreakSensitive: true,
      editingQuoteTextComparesContentTokens: true,
      focusedOrderedListNumberingUsesObservedOrdinalsAndMarkerRendering: true,
      expandedListEditingUsesPerItemHierarchyMarkersAndObservedFocus: true,
      expandedListMarkerOwnershipUsesSourceSemanticNoneClasses: true,
      viewerListLifecycleUsesParserAstSemanticOwnershipAndRelativeGeometry: true,
      semanticUnorderedBulletImplementationTextIsNormalized: true,
      domNodePathsTagsAndInternalCountsExcluded: true,
      strictOverrideEngineUnchanged: true
    },
    counts: countStatuses(results),
    rawStrictCounts,
    coverage: {
      obsidianObservationCount: obsidianObservations.length,
      viewerObservationCount: viewerObservations.length,
      unexpectedObsidianScenarioIds: unexpectedIds(obsidianById, scenarioById),
      unexpectedViewerScenarioIds: unexpectedIds(viewerById, scenarioById)
    },
    results
  });
}

function isCleanNormalizedCrossRuntimeEvidence(result) {
  assertObject(result, 'Normalized cross-runtime result');
  return Array.isArray(result.results) && result.results.every((entry) => (
    entry.status === STATUS.MATCH
    || entry.status === STATUS.INTENTIONAL_VIEWER_OVERRIDE
  ));
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  NORMALIZED_FAMILIES,
  compareNormalizedCrossRuntimeEvidence,
  compareNormalizedCrossRuntimeScenario,
  isExpandedListBehaviorScenario,
  isCleanNormalizedCrossRuntimeEvidence,
  listPresentationContract,
  listSemanticContract,
  normalizedDisplayedListMarker,
  normalizedListMarkerOwner,
  normalizedQuoteEditingText,
  normalizedViewerQuoteCapture,
  orderedListNumberingContract,
  observedThematicBreakSemanticBridge,
  projectObservation,
  semanticContract,
  stripRuntimeChrome
});
