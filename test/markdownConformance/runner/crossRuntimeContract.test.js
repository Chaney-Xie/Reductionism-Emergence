'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const overrides = require('../overrides/viewerOverrides.json');
const generatedScenarios = require('../scenarios/generated-v0.3.json');
const capturedOverrideEvidence = require('../fixtures/oracles/overrides-v0.3-o1-v1.json');
const {
  compareNormalizedCrossRuntimeEvidence,
  compareNormalizedCrossRuntimeScenario,
  isExpandedListBehaviorScenario,
  listPresentationContract,
  listSemanticContract,
  normalizedDisplayedListMarker,
  normalizedListMarkerOwner,
  normalizedViewerQuoteCapture,
  orderedListNumberingContract,
  observedThematicBreakSemanticBridge,
  projectObservation,
  stripRuntimeChrome
} = require('./crossRuntimeContract');
const { selectScenariosByEvidenceIds } = require('./finalTraceEvidence');

function scenario(id, family, mode, state = {}) {
  return {
    id,
    fixtureId: id,
    syntaxFamily: family,
    mode,
    state,
    requiredObservations: ['source', 'physical', 'semantic', 'presentation']
  };
}

function observation(scenarioId, evidenceLevel, source, semantic, presentation, additions = {}) {
  return {
    scenarioId,
    evidenceLevel,
    automatable: true,
    source,
    sourceBytesBase64: Buffer.from(source).toString('base64'),
    selection: { anchor: source.length, focus: source.length },
    semantic,
    presentation,
    metadata: {
      adapter: evidenceLevel === 'O1' ? 'obsidian-o1' : 'viewer-v1',
      ...(evidenceLevel === 'O1' ? { activeFile: 'Conformance.md' } : {})
    },
    ...additions
  };
}

function structuralSemantic(types) {
  return {
    rootTypes: [...types],
    nodes: types.map((type, index) => ({
      path: String(index), type, quoteDepth: 0, listDepth: 0
    })),
    typeCounts: types.reduce((counts, type) => {
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {}),
    maximumQuoteDepth: 0,
    maximumListDepth: 0
  };
}

function thematicBreakBridgePair(id, source, obsidianTypes, viewerTypes) {
  const markerText = source.split(/\r\n|\n|\r/).find((line) => line === '***') || '***';
  const markerStart = source.indexOf(markerText);
  const selection = { anchor: source.length, focus: source.length };
  const presentation = {
    mode: 'live-preview',
    visibleText: source,
    visibleLines: source.split('\n'),
    markerVisibility: 'hidden',
    visibleMarkers: '',
    quoteRailText: null,
    elementType: null,
    layout: null,
    controls: null,
    renderedState: 'mixed',
    geometry: null
  };
  const obsidian = observation(
    id, 'O1', source, structuralSemantic(obsidianTypes), presentation,
    { selection, raw: { editorSource: source, runtime: { markers: [] } } }
  );
  const viewer = observation(
    id, 'V1', source, structuralSemantic(viewerTypes), presentation,
    {
      selection,
      integrityFailure: [],
      raw: {
        domSource: source,
        runtime: {
          markers: [{
            text: markerText,
            visible: false,
            sourceStart: markerStart,
            sourceEnd: markerStart + markerText.length,
            kind: 'thematic-break'
          }],
          presentationFacts: {
            thematicBreak: {
              elementPresent: true,
              elementVisible: true,
              markerVisible: false,
              markerText,
              elementTag: 'div'
            }
          }
        }
      }
    }
  );
  return { obsidian, viewer };
}

function quoteObservation(id, level, source, visibleText, quoteRailText, additions = {}) {
  const mode = additions.mode || 'reading';
  const markerVisibility = additions.markerVisibility || (mode === 'reading' ? 'hidden' : 'visible');
  return observation(id, level, source, {
    rootTypes: ['blockquote'],
    nodes: [
      { path: '0', type: 'blockquote', quoteDepth: 1, listDepth: 0 },
      { path: '0.0', type: 'paragraph', quoteDepth: 1, listDepth: 0 }
    ],
    typeCounts: { blockquote: 1, paragraph: 1 },
    maximumQuoteDepth: 1,
    maximumListDepth: 0
  }, {
    mode,
    visibleText,
    visibleLines: visibleText.split('\n'),
    markerVisibility,
    visibleMarkers: additions.visibleMarkers ?? '',
    quoteRailText,
    renderedState: mode === 'reading' ? 'rendered' : mode === 'source' ? 'raw' : 'mixed',
    geometry: additions.geometry ?? null
  }, additions.observation || {});
}

test('runtime chrome is removed only from independently identified Obsidian title text', () => {
  const obsidian = { metadata: { activeFile: 'Conformance.md' } };
  assert.deepEqual(stripRuntimeChrome('Conformance\n\nA\nB', obsidian, 'obsidian'), {
    text: 'A\nB',
    titleStripped: true
  });
  assert.deepEqual(stripRuntimeChrome('Conformance\n\nA', obsidian, 'viewer'), {
    text: 'Conformance\n\nA',
    titleStripped: false
  });
});

test('marker-only quote capture recovers the visible marker from the closest quote context', () => {
  const inspect = scenario('quote-marker', 'quotes', 'source', { active: true, quoteDepth: 1 });
  const viewer = quoteObservation('quote-marker', 'V1', '>', '>', '|', {
    mode: 'source',
    visibleMarkers: '>',
    geometry: { rails: [{}] },
    observation: {
      raw: {
        runtime: {
          markers: [{
            text: '>', visible: true, sourceStart: 0, sourceEnd: 1, kind: 'syntax'
          }],
          presentationFacts: {
            quote: { depth: 1, visibleRailCount: 1, visibleMarker: null }
          }
        }
      }
    }
  });
  const recovered = normalizedViewerQuoteCapture(inspect, viewer);
  assert.equal(recovered.quoteRailText, '|>');
  assert.equal(recovered.recoveryApplied, true);
  assert.deepEqual(recovered.markerSourceRange, { start: 0, end: 1 });
});

test('DOM architecture, title scope, and pixel geometry normalize without weakening overrides', () => {
  const inspect = scenario('quote-simple', 'quotes', 'live-preview', {
    active: true,
    quoteDepth: 1
  });
  const obsidian = quoteObservation(
    inspect.id,
    'O1',
    '> A',
    'Conformance\n\n> A',
    null,
    { mode: 'live-preview', visibleMarkers: '>' }
  );
  const viewer = quoteObservation(inspect.id, 'V1', '> A', '> \nA', '|>', {
    mode: 'live-preview',
    visibleMarkers: '> ',
    geometry: { rails: [{ x: 100, width: 500 }] }
  });
  viewer.semantic.nodes.push({ path: '0.0.0', type: 'break', quoteDepth: 1, listDepth: 0 });
  viewer.semantic.typeCounts.break = 1;

  const result = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(result.status, 'INTENTIONAL_VIEWER_OVERRIDE');
  assert.equal(result.rawStrictStatus, 'VIEWER_FAIL');
  assert.equal(result.normalizedEvidence.obsidian.presentation.visibleText, 'A');
  assert.equal(result.normalizedEvidence.viewer.presentation.visibleText, 'A');
  assert.deepEqual(result.normalizedEvidence.obsidian.semantic, {
    construct: 'blockquote', maximumDepth: 1, recognized: true
  });
  assert.deepEqual(result.normalizedEvidence.viewer.semantic, {
    construct: 'blockquote', maximumDepth: 1, recognized: true
  });
  assert.ok(result.differences.every(({ path: differencePath }) => (
    !differencePath.includes('nodes')
    && !differencePath.includes('visibleLines')
    && !differencePath.includes('.x')
    && !differencePath.includes('.width')
  )));
});

test('Reading-mode quote line breaks remain independently observed strict behavior', () => {
  const inspect = scenario('quote-soft-line', 'quotes', 'reading', {
    active: false,
    quoteDepth: 1
  });
  const obsidian = quoteObservation(
    inspect.id, 'O1', '> A\n> B', 'Conformance\n\nA\nB', null
  );
  const viewer = quoteObservation(inspect.id, 'V1', '> A\n> B', 'A B', '|', {
    geometry: { rails: [{}] }
  });
  const result = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.reasonCode, 'normalized-behavior-mismatch');
  assert.deepEqual(result.differences.filter(({ path: differencePath }) => (
    differencePath === 'presentation.visibleText'
  )), [{ path: 'presentation.visibleText', expected: 'A\nB', actual: 'A B' }]);
});

test('source authority remains exact before any normalized semantic comparison', () => {
  const inspect = scenario('quote-source-fail', 'quotes', 'source', {
    active: true,
    quoteDepth: 1
  });
  const obsidian = quoteObservation(inspect.id, 'O1', '> A', 'Conformance\n> A', null, {
    mode: 'source', visibleMarkers: '>'
  });
  const viewer = quoteObservation(inspect.id, 'V1', '> B', '> B', '|>', {
    mode: 'source', visibleMarkers: '>'
  });
  const result = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.sourceAuthorityFailed, true);
  assert.match(result.differences[0].path, /^source\./);
});

test('current source-backed thematic breaks bridge two bold-italic origins to semantic MATCH', () => {
  const cases = [
    {
      id: 'certification-random.d1d10a2425ab1f965f48',
      source: '***\n    \nBold italic text***',
      obsidianTypes: ['thematicBreak', 'paragraph'],
      viewerTypes: ['break', 'paragraph']
    },
    {
      id: 'certification-random.8789462a2ce726f7c440',
      source: '***\nB  o\n\nd italic text***',
      obsidianTypes: ['thematicBreak', 'paragraph', 'paragraph'],
      viewerTypes: ['paragraph', 'break', 'paragraph']
    }
  ];
  cases.forEach(({ id, source, obsidianTypes, viewerTypes }) => {
    const inspect = scenario(id, 'bold-italic', 'live-preview', { active: true });
    inspect.requiredObservations = ['source', 'selection', 'physical', 'semantic'];
    const { obsidian, viewer } = thematicBreakBridgePair(
      id, source, obsidianTypes, viewerTypes
    );
    const result = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);

    assert.equal(result.status, 'MATCH');
    assert.equal(result.rawStrictStatus, 'VIEWER_FAIL');
    assert.equal(result.overrideId, undefined);
    assert.equal(result.observedSemanticBridge.construct, 'thematic-break');
    assert.deepEqual(result.differences, []);
    assert.equal(result.normalizedEvidence.obsidian.semantic.thematicBreakRecognized, true);
    assert.equal(result.normalizedEvidence.viewer.semantic.thematicBreakRecognized, true);
    assert.deepEqual(result.normalizedEvidence.obsidian.semantic.concepts, []);
    assert.deepEqual(result.normalizedEvidence.viewer.semantic.concepts, []);
    assert.equal(
      result.normalizationAudit.viewer.semanticAdapter,
      'observed-thematic-break-semantic-bridge-v1'
    );
    assert.deepEqual(result.normalizationAudit.viewer.semanticBridge.viewer.markerRange, {
      start: 0, end: 3
    });
  });
});

test('the thematic-break bridge requires every independent source and Viewer proof', () => {
  const source = '***\nA';
  const makePair = () => thematicBreakBridgePair(
    'bridge-proof', source, ['thematicBreak', 'paragraph'], ['break', 'paragraph']
  );
  const mutations = [
    ({ obsidian }) => { obsidian.raw.editorSource = `${source}!`; },
    ({ viewer }) => { viewer.raw.domSource = `${source}!`; },
    ({ viewer }) => { viewer.raw.runtime.markers[0].kind = 'syntax'; },
    ({ viewer }) => { viewer.raw.runtime.markers[0].visible = true; },
    ({ viewer }) => { viewer.raw.runtime.markers[0].sourceEnd = 2; },
    ({ viewer }) => { viewer.raw.runtime.markers[0].text = '**'; },
    ({ viewer }) => {
      viewer.raw.runtime.presentationFacts.thematicBreak.elementPresent = false;
    },
    ({ viewer }) => {
      viewer.raw.runtime.presentationFacts.thematicBreak.elementTag = 'hr';
    },
    ({ viewer }) => {
      viewer.raw.runtime.presentationFacts.thematicBreak.markerVisible = true;
    },
    ({ viewer }) => {
      viewer.raw.runtime.presentationFacts.thematicBreak.markerText = '---';
    },
    ({ viewer }) => { viewer.integrityFailure = ['dom']; },
    ({ obsidian }) => { obsidian.semantic = structuralSemantic(['paragraph']); }
  ];
  mutations.forEach((mutate) => {
    const pair = makePair();
    mutate(pair);
    assert.equal(observedThematicBreakSemanticBridge(pair.obsidian, pair.viewer), null);
  });

  const nonStandalone = thematicBreakBridgePair(
    'not-standalone', 'A *** B', ['thematicBreak'], ['paragraph']
  );
  assert.equal(
    observedThematicBreakSemanticBridge(nonStandalone.obsidian, nonStandalone.viewer),
    null
  );
});

test('the thematic-break bridge cannot conceal source, caret, or unrelated semantic failures', () => {
  const inspect = scenario('bridge-safety', 'bold-italic', 'live-preview', { active: true });
  inspect.requiredObservations = ['source', 'selection', 'physical', 'semantic'];

  const sourceMismatch = thematicBreakBridgePair(
    inspect.id, '***\nA', ['thematicBreak', 'paragraph'], ['break', 'paragraph']
  );
  sourceMismatch.viewer.source = '***\r\nA';
  sourceMismatch.viewer.sourceBytesBase64 = Buffer.from(sourceMismatch.viewer.source).toString('base64');
  sourceMismatch.viewer.raw.domSource = sourceMismatch.viewer.source;
  const wrongSource = compareNormalizedCrossRuntimeScenario(
    inspect, sourceMismatch.obsidian, sourceMismatch.viewer, overrides
  );
  assert.equal(wrongSource.status, 'VIEWER_FAIL');
  assert.equal(wrongSource.sourceAuthorityFailed, true);
  assert.equal(wrongSource.observedSemanticBridge, null);
  assert.equal(wrongSource.differences.some(({ path: differencePath }) => (
    differencePath.startsWith('physical.')
  )), true);

  const caretMismatch = thematicBreakBridgePair(
    inspect.id, '***\nA', ['thematicBreak', 'paragraph'], ['break', 'paragraph']
  );
  caretMismatch.viewer.selection = { anchor: 4, focus: 4 };
  const wrongCaret = compareNormalizedCrossRuntimeScenario(
    inspect, caretMismatch.obsidian, caretMismatch.viewer, overrides
  );
  assert.equal(wrongCaret.status, 'VIEWER_FAIL');
  assert.equal(wrongCaret.observedSemanticBridge, null);
  assert.equal(wrongCaret.differences.some(({ path: differencePath }) => (
    differencePath.startsWith('selection.')
  )), true);

  const extraCode = thematicBreakBridgePair(
    inspect.id, '***\n    A', ['thematicBreak'], ['code']
  );
  const semanticFailure = compareNormalizedCrossRuntimeScenario(
    inspect, extraCode.obsidian, extraCode.viewer, overrides
  );
  assert.equal(semanticFailure.observedSemanticBridge.construct, 'thematic-break');
  assert.equal(semanticFailure.status, 'VIEWER_FAIL');
  assert.deepEqual(semanticFailure.differences, [{
    path: 'semantic.concepts.0', expected: undefined, actual: 'code'
  }]);
});

test('captured v0.3 override controls leave only Reading soft-line behavior eligible to fail', () => {
  const selectedScenarios = selectScenariosByEvidenceIds(
    generatedScenarios,
    { scenarios: capturedOverrideEvidence.scenarios }
  );
  const result = compareNormalizedCrossRuntimeEvidence(
    selectedScenarios,
    capturedOverrideEvidence,
    capturedOverrideEvidence,
    overrides
  );
  assert.equal(result.counts.AMBIGUOUS, 0);
  assert.equal(result.counts.MATCH, 0);
  assert.equal(result.counts.OBSIDIAN_NOT_AUTOMATABLE, 8);
  assert.equal(
    result.counts.INTENTIONAL_VIEWER_OVERRIDE + result.counts.VIEWER_FAIL,
    44
  );
  assert.equal(result.rawStrictCounts.VIEWER_FAIL, 44);
  const possibleReadingFailures = new Set([
      'quotes.quote-transition.reading.inactive.text-middle.inspect',
      'quotes.quote-two-lines-depth-2.reading.inactive.text-middle.inspect',
      'quotes.quote-two-lines.reading.inactive.text-middle.inspect'
  ]);
  const viewerFailures = result.results.filter(({ status }) => status === 'VIEWER_FAIL');
  assert.ok(viewerFailures.every(({ scenarioId, differences }) => (
    possibleReadingFailures.has(scenarioId)
    && differences.some(({ path: differencePath }) => differencePath === 'presentation.visibleText')
  )));
  const markerOnly = result.results.filter(({ scenarioId }) => (
    scenarioId === 'quotes.quote-marker-only.live-preview.active.text-middle.inspect'
    || scenarioId === 'quotes.quote-marker-only.source.active.text-middle.inspect'
  ));
  assert.equal(markerOnly.length, 2);
  assert.ok(markerOnly.every((entry) => (
    entry.status === 'INTENTIONAL_VIEWER_OVERRIDE'
    && entry.normalizedEvidence.viewer.presentation.quoteRailText === '|>'
  )));
});

test('families without a specialized adapter use the generic structural contract', () => {
  const inspect = scenario('paragraph', 'paragraphs', 'reading');
  const raw = observation(inspect.id, 'O1', 'A', { rootTypes: ['paragraph'] }, {
    mode: 'reading', visibleText: 'Conformance\n\nA', visibleLines: ['Conformance', '', 'A']
  });
  const projected = projectObservation(inspect, raw, 'obsidian');
  assert.notEqual(projected.observation, raw);
  assert.equal(projected.audit.normalized, true);
  assert.equal(projected.audit.semanticAdapter, 'generic-structural-concept-v1');
  assert.deepEqual(projected.observation.semantic, {
    contentBlockRecognized: true,
    concepts: [],
    headingDepths: [],
    listStructure: [],
    maximumListDepth: 0,
    maximumQuoteDepth: 0,
    tableCells: []
  });
  assert.equal(projected.observation.presentation.visibleText, 'A');
  assert.equal(Object.hasOwn(projected.observation.presentation, 'visibleLines'), false);
});

test('focused ordered-list numbering compares observed ordinals and rendered markers, not DOM text architecture', () => {
  const inspect = scenario('ordered-numbering', 'ordered-lists', 'live-preview', {
    active: false
  });
  inspect.tags = ['ordered-numbering'];
  const source = '3. Alpha\n4. Beta\n    1. Child\n5. Gamma';
  const semantic = {
    rootTypes: ['list'],
    nodes: [
      { path: '0', type: 'list', quoteDepth: 0, listDepth: 1, ordered: true, startNumber: 3 },
      { path: '0.0', type: 'listItem', quoteDepth: 0, listDepth: 1, ordinal: 3 },
      { path: '0.1', type: 'listItem', quoteDepth: 0, listDepth: 1, ordinal: 4 },
      { path: '0.1.0', type: 'list', quoteDepth: 0, listDepth: 2, ordered: true, startNumber: 1 },
      { path: '0.1.0.0', type: 'listItem', quoteDepth: 0, listDepth: 2, ordinal: 1 },
      { path: '0.2', type: 'listItem', quoteDepth: 0, listDepth: 1, ordinal: 5 }
    ],
    typeCounts: { list: 2, listItem: 4 },
    maximumQuoteDepth: 0,
    maximumListDepth: 2
  };
  const entries = [
    { listDepth: 1, ordinal: 3 },
    { listDepth: 1, ordinal: 4 },
    { listDepth: 2, ordinal: 1 },
    { listDepth: 1, ordinal: 5 }
  ];
  const obsidian = observation(inspect.id, 'O1', source, semantic, {
    mode: 'live-preview',
    visibleText: `Conformance\n${source}`,
    markerVisibility: 'visible',
    visibleMarkers: '3.4.1.5.',
    renderedState: 'mixed'
  }, {
    raw: { runtime: { presentationFacts: { orderedList: {
      entries, rendered: true, visibleMarkerOrdinals: [3, 4, 1, 5]
    } } } }
  });
  const viewer = observation(inspect.id, 'V1', source, semantic, {
    mode: 'live-preview',
    visibleText: 'Alpha\n\nBeta\n\nChild\n\nGamma',
    markerVisibility: 'hidden',
    visibleMarkers: '',
    renderedState: 'mixed'
  }, {
    raw: { runtime: { presentationFacts: { orderedList: {
      entries,
      rendered: true,
      itemFacts: entries.map((entry) => ({ ...entry, listStyleType: 'decimal' }))
    } } } }
  });

  assert.deepEqual(orderedListNumberingContract(viewer), { entries, rendered: true });
  const result = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(result.status, 'MATCH');
  assert.equal(result.rawStrictStatus, 'VIEWER_FAIL');
  assert.deepEqual(result.normalizedEvidence.viewer.presentation.orderedNumbering, {
    entries,
    rendered: true
  });

  viewer.raw.runtime.presentationFacts.orderedList.rendered = false;
  const hiddenMarkers = compareNormalizedCrossRuntimeScenario(
    inspect, obsidian, viewer, overrides
  );
  assert.equal(hiddenMarkers.status, 'VIEWER_FAIL');
  assert.deepEqual(hiddenMarkers.differences, [{
    path: 'presentation.orderedNumbering.rendered', expected: true, actual: false
  }]);
});

test('expanded list behavior compares per-item hierarchy, displayed markers, and observed focus', () => {
  const inspect = scenario('list-expanded', 'ordered-lists', 'live-preview', { active: false });
  inspect.tags = ['list-editing-expanded'];
  const source = '1. Alpha\n7. Beta\n3. Gamma';
  const items = [
    { itemPath: '0', parentPath: null, lineIndex: 0, listDepth: 1, quoteDepth: 0,
      kind: 'ordered', displayedMarker: '1.', displayedOrdinal: 1,
      markerVisible: true, markerOwner: 'source', active: false, checked: null },
    { itemPath: '1', parentPath: null, lineIndex: 1, listDepth: 1, quoteDepth: 0,
      kind: 'ordered', displayedMarker: '7.', displayedOrdinal: 7,
      markerVisible: true, markerOwner: 'source', active: false, checked: null },
    { itemPath: '2', parentPath: null, lineIndex: 2, listDepth: 1, quoteDepth: 0,
      kind: 'ordered', displayedMarker: '3.', displayedOrdinal: 3,
      markerVisible: true, markerOwner: 'source', active: false, checked: null }
  ];
  const focus = { editorActive: false, activeItemPaths: [], activeLineIndexes: [] };
  const make = (level, visibleText) => {
    const runtimeItems = items.map((item) => ({ ...item }));
    const list = { items: runtimeItems, focus: { ...focus } };
    return observation(
      inspect.id,
      level,
      source,
      structuralSemantic(['list']),
      { mode: 'live-preview', active: false, visibleText, list },
      { raw: { runtime: { presentationFacts: { list } } } }
    );
  };
  const obsidian = make('O1', `Conformance\n${source}`);
  const viewer = make('V1', 'Alpha\nBeta\nGamma');

  const matched = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(matched.status, 'MATCH');
  assert.equal(
    matched.normalizationAudit.viewer.semanticAdapter,
    'list-editing-behavior-v1'
  );
  assert.equal(listSemanticContract(obsidian).maximumListDepth, 1);
  assert.deepEqual(listPresentationContract(obsidian).markers.map(({ displayedMarker }) => displayedMarker), [
    '1.', '7.', '3.'
  ]);

  viewer.presentation.list.items[1] = {
    ...viewer.presentation.list.items[1], displayedMarker: '2.', displayedOrdinal: 2,
    markerOwner: 'native'
  };
  viewer.raw.runtime.presentationFacts.list = viewer.presentation.list;
  const numberingFailure = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(numberingFailure.status, 'VIEWER_FAIL');
  assert.equal(numberingFailure.differences.some(({ path }) => (
    path.includes('presentation.list.markers.1.displayed')
  )), true);

  viewer.presentation.list.items[1] = {
    ...items[1], listDepth: 2, parentPath: '0'
  };
  viewer.raw.runtime.presentationFacts.list = viewer.presentation.list;
  const hierarchyFailure = compareNormalizedCrossRuntimeScenario(inspect, obsidian, viewer, overrides);
  assert.equal(hierarchyFailure.status, 'VIEWER_FAIL');
  assert.equal(hierarchyFailure.differences.some(({ path }) => path.includes('semantic.items.1')), true);
});

test('untagged full-surface list action sequences use the expanded list behavior contract', () => {
  const inspect = scenario(
    'list-exit-merge.legacy-probe',
    'ordered-lists',
    'live-preview',
    { active: true }
  );
  inspect.actions = [{ type: 'keyboard', key: 'Enter' }];

  assert.equal(isExpandedListBehaviorScenario(inspect), true);
  assert.equal(isExpandedListBehaviorScenario({
    ...inspect,
    id: `${inspect.id}.action.1`,
    originScenarioId: inspect.id,
    actionIndex: 0,
    actions: undefined
  }), true);
  assert.equal(isExpandedListBehaviorScenario({
    ...inspect,
    requiredObservations: ['source', 'selection', 'physical']
  }), false);
  assert.equal(isExpandedListBehaviorScenario({
    ...inspect,
    actions: undefined,
    action: inspect.actions[0]
  }), false);
});

test('list marker ownership and semantic unordered bullets normalize product-neutrally', () => {
  assert.equal(normalizedListMarkerOwner('source-marker'), 'source');
  assert.equal(normalizedListMarkerOwner('native-list'), 'semantic');
  assert.equal(normalizedListMarkerOwner('custom-generated'), 'semantic');
  assert.equal(normalizedListMarkerOwner('none'), 'none');
  assert.equal(normalizedDisplayedListMarker({
    kind: 'unordered', markerOwner: 'custom-generated', markerVisible: true,
    displayedMarker: '\u200b'
  }), 'unordered-bullet');
  assert.equal(normalizedDisplayedListMarker({
    kind: 'unordered', markerOwner: 'native-list', markerVisible: true,
    displayedMarker: 'disc'
  }), 'unordered-bullet');
  assert.equal(normalizedDisplayedListMarker({
    kind: 'unordered', markerOwner: 'source-marker', markerVisible: true,
    displayedMarker: '*'
  }), '*');

  const make = (markerOwner, displayedMarker) => ({
    presentation: {
      active: false,
      list: {
        items: [{
          itemPath: '0', lineIndex: 0, kind: 'unordered', markerOwner,
          displayedMarker, displayedOrdinal: null, markerVisible: true, active: false
        }],
        focus: { editorActive: false, activeItemPaths: [], activeLineIndexes: [] }
      }
    }
  });
  assert.deepEqual(
    listPresentationContract(make('custom-generated', '\u200b')),
    listPresentationContract(make('native-list', 'disc'))
  );
  assert.notDeepEqual(
    listPresentationContract(make('source-marker', '-')),
    listPresentationContract(make('source-marker', '*'))
  );
});

test('list semantic depth follows canonical item hierarchy across absorbed source markers', () => {
  const make = (listDepth) => ({
    presentation: {
      list: {
        items: [{
          itemPath: '1.0', parentPath: '1', lineIndex: 2, listDepth,
          quoteDepth: 0, kind: 'ordered', recognized: true, checked: null
        }]
      }
    }
  });

  assert.deepEqual(listSemanticContract(make(1)), listSemanticContract(make(2)));
  assert.equal(listSemanticContract(make(1)).items[0].listDepth, 2);
});

test('the normalized final repair trace excludes wrapper paragraphs, spacer breaks, and node paths', () => {
  const scenarios = require('../scenarios/v0.3FinalRepairGate.json');
  const obsidian = require('../fixtures/oracles/v0.3-final-repair-gate-o1.json');
  const viewer = require('../fixtures/oracles/v0.3-final-repair-gate-v1.json');
  const result = compareNormalizedCrossRuntimeEvidence(scenarios, obsidian, viewer, overrides);
  assert.equal(result.scenarioCount, 13);
  assert.deepEqual(result.counts, {
    AMBIGUOUS: 0,
    INTENTIONAL_VIEWER_OVERRIDE: 0,
    MATCH: 13,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    VIEWER_FAIL: 0
  });
  assert.equal(
    Object.values(result.rawStrictCounts).reduce((total, count) => total + count, 0),
    13
  );
});
