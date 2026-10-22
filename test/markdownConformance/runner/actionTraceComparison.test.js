'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compareActionTrace,
  compareActionTraceEvidence
} = require('./actionTraceComparison');

function semantic({ maximumListDepth = 0, paths = ['0'], rootTypes = ['paragraph'] } = {}) {
  return {
    rootTypes,
    nodes: paths.map((path, index) => ({
      path,
      type: index === 0 ? 'paragraph' : 'break',
      quoteDepth: 0,
      listDepth: maximumListDepth
    })),
    typeCounts: paths.length > 1 ? { paragraph: 1, break: paths.length - 1 } : { paragraph: 1 },
    maximumQuoteDepth: 0,
    maximumListDepth
  };
}

function step(source, anchor = source.length, semanticValue = semantic()) {
  return {
    source,
    selection: { anchor, focus: anchor },
    semantic: semanticValue
  };
}

function breakOnlySemantic() {
  return {
    rootTypes: ['break'],
    nodes: [{ path: '0', type: 'break', quoteDepth: 0, listDepth: 0 }],
    typeCounts: { break: 1 },
    maximumQuoteDepth: 0,
    maximumListDepth: 0
  };
}

function listSemantic({ ordered = false, ordinal = null } = {}) {
  return {
    rootTypes: ['list'],
    nodes: [
      {
        path: '0', type: 'list', quoteDepth: 0, listDepth: 1,
        ordered, startNumber: ordered ? 1 : null
      },
      {
        path: '0.0', type: 'listItem', quoteDepth: 0, listDepth: 1,
        ordered: null, ordinal
      }
    ],
    typeCounts: { list: 1, listItem: 1 },
    maximumQuoteDepth: 0,
    maximumListDepth: 1
  };
}

function typedSemantic(types) {
  return {
    rootTypes: [...types],
    nodes: types.map((type, index) => ({
      path: String(index),
      type,
      ...(type === 'heading' ? { depth: 2 } : {}),
      quoteDepth: 0,
      listDepth: 0
    })),
    typeCounts: types.reduce((counts, type) => {
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {}),
    maximumQuoteDepth: 0,
    maximumListDepth: 0
  };
}

function activeThematicBreakStep(role, source, anchor, semanticValue) {
  const markerStart = source.indexOf('***');
  const base = {
    source,
    selection: { anchor, focus: anchor },
    semantic: semanticValue,
    presentation: {
      mode: 'live-preview',
      visibleText: source,
      visibleLines: source.split('\n'),
      markerVisibility: 'hidden',
      visibleMarkers: '',
      renderedState: 'mixed'
    }
  };
  if (role === 'obsidian') {
    return {
      ...base,
      raw: { editorSource: source, runtime: { markers: [] } }
    };
  }
  return {
    ...base,
    integrityFailure: [],
    raw: {
      domSource: source,
      runtime: {
        markers: [{
          text: '***',
          visible: false,
          sourceStart: markerStart,
          sourceEnd: markerStart + 3,
          kind: 'thematic-break'
        }],
        presentationFacts: {
          thematicBreak: {
            elementPresent: true,
            elementVisible: true,
            markerVisible: false,
            markerText: '***',
            elementTag: 'div'
          }
        }
      }
    }
  };
}

function sequence(actionCount = 3) {
  return {
    id: 'trace.sequence',
    fixtureId: 'plain',
    syntaxFamily: 'paragraphs',
    mode: 'source',
    state: { active: true },
    actions: Array.from({ length: actionCount }, (_, index) => ({
      type: 'input', command: 'insertText', text: String(index)
    }))
  };
}

function parent(level, actionTrace) {
  return { evidenceLevel: level, automatable: true, actionTrace };
}

function expandedListStep({
  marker = '7.',
  ordinal = 7,
  parentPath = null,
  selection = { anchor: 4, focus: 4 },
  mode = 'live-preview'
} = {}) {
  const items = [{
    itemPath: '0',
    parentPath,
    lineIndex: 0,
    listDepth: parentPath == null ? 1 : 2,
    quoteDepth: 0,
    kind: 'ordered',
    recognized: true,
    checked: null,
    displayedMarker: marker,
    displayedOrdinal: ordinal,
    markerVisible: true,
    active: mode === 'live-preview'
  }];
  const list = {
    items,
    focus: {
      editorActive: mode === 'live-preview',
      activeItemPaths: mode === 'live-preview' ? ['0'] : [],
      activeLineIndexes: mode === 'live-preview' ? [0] : []
    }
  };
  return {
    source: '7. A',
    selection,
    semantic: listSemantic({ ordered: true, ordinal }),
    physical: { lineCount: 1, lines: [{ index: 0, start: 0, end: 4, text: '7. A' }] },
    presentation: { mode, active: mode === 'live-preview', list },
    raw: { runtime: { presentationFacts: { list } } }
  };
}

function expandedListSequence(mode = 'live-preview') {
  return {
    id: `trace.expanded-list.${mode}`,
    fixtureId: 'ordered-arbitrary',
    syntaxFamily: 'ordered-lists',
    tags: ['list-editing-expanded'],
    mode,
    state: { active: mode === 'live-preview' },
    requiredObservations: mode === 'reading'
      ? ['source', 'physical', 'semantic', 'presentation']
      : ['source', 'selection', 'physical', 'semantic', 'presentation'],
    actions: [{ type: 'inspect', id: 'inspect', editable: false }]
  };
}

test('aligned action traces normalize DOM paths and report a full match', () => {
  const inspect = sequence(2);
  const obsidian = parent('O1', [
    { index: 0, action: inspect.actions[0], observation: step('A', 1, semantic()) },
    { index: 1, action: inspect.actions[1], observation: step('AB', 2, semantic()) }
  ]);
  const viewer = parent('V1', [
    step('A', 1, semantic({ paths: ['9', '9.1'] })),
    step('AB', 2, semantic({ paths: ['5'] }))
  ]);
  const result = compareActionTrace(inspect, obsidian, viewer);

  assert.equal(result.status, 'MATCH');
  assert.equal(result.comparisonLayer, 'cross-runtime-behavior-contract-v2');
  assert.ok(result.steps.every(({ comparisonLayer }) => (
    comparisonLayer === result.comparisonLayer
  )));
  assert.equal(result.alignedStepCount, 2);
  assert.equal(result.divergenceCount, 0);
  assert.equal(result.firstAuthoritativeDivergence, null);
  assert.deepEqual(result.counts, {
    AMBIGUOUS: 0,
    INTENTIONAL_VIEWER_OVERRIDE: 0,
    MATCH: 2,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    VIEWER_FAIL: 0
  });
});

test('first source divergence and downstream authoritative failures are explicit', () => {
  const inspect = sequence(3);
  const obsidian = parent('O1', [step('A'), step('AB'), step('ABC')]);
  const viewer = parent('V1', [step('A'), step('AX'), step('AXC')]);
  const result = compareActionTrace(inspect, obsidian, viewer);

  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.authoritativeDivergenceCount, 2);
  assert.equal(result.firstAuthoritativeDivergence.actionIndex, 1);
  assert.equal(result.firstAuthoritativeDivergence.actionNumber, 2);
  assert.match(result.firstAuthoritativeDivergence.authoritativeDifferencePaths[0], /^source\./);
  assert.equal(result.downstreamStepCount, 1);
  assert.equal(result.downstreamDivergenceCount, 1);
  assert.equal(result.downstreamAuthoritativeDivergenceCount, 1);
  assert.deepEqual(result.counts, {
    AMBIGUOUS: 0,
    INTENTIONAL_VIEWER_OVERRIDE: 0,
    MATCH: 1,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    VIEWER_FAIL: 2
  });
});

test('caret-only mismatch is authoritative even when source and semantics match', () => {
  const inspect = sequence(1);
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('AB', 2)]),
    parent('V1', [step('AB', 1)])
  );

  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.firstAuthoritativeDivergence.actionIndex, 0);
  assert.equal(result.firstAuthoritativeDivergence.authoritativeDifferencePaths.some((path) => (
    path.startsWith('selection.')
  )), true);
  assert.equal(result.semanticContractDivergenceCount, 0);
});

test('expanded-list marker presentation and hierarchy are authoritative per action', () => {
  const inspect = expandedListSequence();
  const markerResult = compareActionTrace(
    inspect,
    parent('O1', [expandedListStep()]),
    parent('V1', [expandedListStep({ marker: '2.', ordinal: 2 })])
  );

  assert.equal(markerResult.status, 'VIEWER_FAIL');
  assert.equal(markerResult.authoritativeStatus, 'VIEWER_FAIL');
  assert.equal(markerResult.authoritativeDivergenceCount, 1);
  assert.equal(markerResult.listContractDivergenceCount, 1);
  assert.deepEqual(markerResult.authoritativeSurfaces, [
    'source', 'selection', 'physical', 'semantic', 'presentation'
  ]);
  assert.equal(markerResult.steps[0].authoritativeDifferencePaths.some((path) => (
    path.startsWith('presentation.list.markers.0.displayed')
  )), true);

  const hierarchyResult = compareActionTrace(
    inspect,
    parent('O1', [expandedListStep()]),
    parent('V1', [expandedListStep({ parentPath: '9' })])
  );
  assert.equal(hierarchyResult.authoritativeStatus, 'VIEWER_FAIL');
  assert.equal(hierarchyResult.steps[0].authoritativeDifferencePaths.includes(
    'semantic.items.0.parentPath'
  ), true);

  const overridden = compareActionTrace(
    inspect,
    parent('O1', [expandedListStep()]),
    parent('V1', [expandedListStep({ marker: '2.', ordinal: 2 })]),
    { overrides: [{
      id: 'do-not-conceal-list-presentation',
      syntaxFamilies: ['ordered-lists'],
      allowedDifferencePaths: ['presentation.list'],
      expectations: [{
        path: 'presentation.list.markers.0.displayedMarker',
        equals: '2.'
      }]
    }] }
  );
  assert.equal(
    overridden.steps[0].normalizedStatusBeforeActionTraceComparability,
    'INTENTIONAL_VIEWER_OVERRIDE'
  );
  assert.equal(overridden.status, 'VIEWER_FAIL');
  assert.equal(overridden.authoritativeStatus, 'VIEWER_FAIL');
  assert.equal(overridden.listContractDivergenceCount, 1);
});

test('untagged full-surface list sequences retain the list contract at each action', () => {
  const inspect = expandedListSequence();
  inspect.id = 'list-exit-merge.legacy-probe';
  delete inspect.tags;
  const obsidian = expandedListStep();
  obsidian.presentation.visibleText = `Conformance\n${obsidian.source}`;
  const viewer = expandedListStep();
  viewer.presentation.visibleText = 'A';

  const result = compareActionTrace(
    inspect,
    parent('O1', [obsidian]),
    parent('V1', [viewer])
  );

  assert.equal(result.status, 'MATCH');
  assert.equal(result.authoritativeStatus, 'MATCH');
  assert.equal(result.semanticObservationGapCount, 0);
  assert.equal(result.nonComparableSemanticDifferenceCount, 0);
  assert.deepEqual(result.authoritativeSurfaces, [
    'source', 'selection', 'physical', 'semantic', 'presentation'
  ]);
});

test('Reading list action traces do not invent a selection requirement', () => {
  const inspect = expandedListSequence('reading');
  const obsidian = expandedListStep({ mode: 'reading', selection: { anchor: 0, focus: 0 } });
  const viewer = expandedListStep({ mode: 'reading', selection: null });
  const result = compareActionTrace(
    inspect,
    parent('O1', [obsidian]),
    parent('V1', [viewer])
  );

  assert.equal(result.status, 'MATCH');
  assert.equal(result.authoritativeStatus, 'MATCH');
  assert.deepEqual(result.authoritativeSurfaces, [
    'source', 'physical', 'semantic', 'presentation'
  ]);
  assert.equal(result.steps[0].authoritativeDifferencePaths.some((path) => (
    path.startsWith('selection.')
  )), false);
});

test('missing editable caret cannot be promoted into a list-focus Viewer failure', () => {
  const inspect = expandedListSequence('live-preview');
  const obsidian = expandedListStep();
  const viewer = expandedListStep({ selection: null });
  viewer.presentation.active = false;
  viewer.presentation.list.focus = {
    editorActive: false,
    activeItemPaths: [],
    activeLineIndexes: []
  };
  viewer.presentation.list.items[0].active = false;

  const result = compareActionTrace(
    inspect,
    parent('O1', [obsidian]),
    parent('V1', [viewer])
  );

  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.authoritativeStatus, 'AMBIGUOUS');
  assert.equal(result.authoritativeDivergenceCount, 0);
  assert.equal(result.listContractDivergenceCount, 0);
  assert.equal(result.firstAuthoritativeDivergence, null);
  assert.equal(result.steps[0].reasonCode,
    'required-authoritative-observation-indeterminate');
  assert.deepEqual(result.steps[0].authoritativeDifferencePaths, []);
  assert.equal(result.steps[0].unavailableListContractDifferencePaths.some((path) => (
    path.startsWith('presentation.list.focus')
  )), true);
});

test('indeterminate action state taints downstream differences until exact state is restored', () => {
  const inspect = sequence(4);
  const missingCaret = { ...step('A', 1), selection: null };
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('A', 1), step('AB', 2), step('ABC', 3), step('ABCD', 4)]),
    parent('V1', [missingCaret, step('AX', 2), step('ABC', 3), step('ABCX', 4)])
  );

  assert.equal(result.steps[0].status, 'AMBIGUOUS');
  assert.equal(result.steps[1].status, 'AMBIGUOUS');
  assert.equal(result.steps[1].reasonCode, 'downstream-of-indeterminate-action');
  assert.equal(result.steps[1].authoritativeDivergence, false);
  assert.equal(result.steps[1].unavailableAuthoritativeDifferencePaths.some((path) => (
    path.startsWith('source.')
  )), true);
  assert.equal(result.steps[2].status, 'MATCH');
  assert.equal(result.steps[3].status, 'VIEWER_FAIL');
  assert.equal(result.authoritativeDivergenceCount, 1);
  assert.equal(result.firstAuthoritativeDivergence.actionIndex, 3);
});

test('normalized semantic mismatch is reported without claiming source authority failed', () => {
  const inspect = sequence(1);
  const obsidianSemantic = semantic();
  const viewerSemantic = {
    rootTypes: ['list'],
    nodes: [{ path: '8', type: 'list', quoteDepth: 0, listDepth: 1, ordered: false }],
    typeCounts: { list: 1 },
    maximumQuoteDepth: 0,
    maximumListDepth: 1
  };
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('A', 1, obsidianSemantic)]),
    parent('V1', [step('A', 1, viewerSemantic)])
  );

  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.authoritativeDivergenceCount, 0);
  assert.equal(result.firstAuthoritativeDivergence, null);
  assert.equal(result.semanticContractDivergenceCount, 1);
  assert.equal(result.firstDivergence.actionIndex, 0);
  assert.equal(result.steps[0].semanticDifferencePaths.every((path) => (
    path.startsWith('semantic.')
  )), true);
});

test('transient generic O1 semantic gaps remain auditable without becoming Viewer failures', () => {
  const inspect = sequence(1);
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('A', 1, breakOnlySemantic())]),
    parent('V1', [step('A', 1, semantic())])
  );

  assert.equal(result.status, 'MATCH');
  assert.equal(result.authoritativeStatus, 'MATCH');
  assert.equal(result.semanticContractDivergenceCount, 0);
  assert.equal(result.semanticObservationGapCount, 1);
  assert.equal(result.steps[0].normalizedStatusBeforeActionTraceComparability, 'VIEWER_FAIL');
  assert.deepEqual(result.steps[0].differences, []);
  assert.deepEqual(result.steps[0].semanticSignalTypes, []);
  assert.deepEqual(result.steps[0].nonComparableSemanticDifferencePaths, [
    'semantic.contentBlockRecognized'
  ]);
});

test('active indented code omitted from O1 semantic DOM is an explicit narrow observation gap', () => {
  const inspect = {
    ...sequence(1),
    syntaxFamily: 'bold-italic',
    mode: 'live-preview',
    state: { active: true }
  };
  const source = '***\n    Bold italic text***';
  const anchor = 8;
  const result = compareActionTrace(
    inspect,
    parent('O1', [activeThematicBreakStep(
      'obsidian', source, anchor, typedSemantic(['break', 'thematicBreak'])
    )]),
    parent('V1', [activeThematicBreakStep(
      'viewer', source, anchor, typedSemantic(['code'])
    )])
  );

  assert.equal(result.status, 'MATCH');
  assert.equal(result.authoritativeStatus, 'MATCH');
  assert.equal(result.semanticContractDivergenceCount, 0);
  assert.equal(result.semanticObservationGapCount, 1);
  assert.equal(result.nonComparableSemanticDifferenceCount, 1);
  assert.equal(result.steps[0].normalizedStatusBeforeActionTraceComparability, 'VIEWER_FAIL');
  assert.equal(result.steps[0].reasonCode, 'action-trace-semantic-observation-gap');
  assert.equal(result.steps[0].observedSemanticBridge.construct, 'thematic-break');
  assert.deepEqual(result.steps[0].differences, []);
  assert.deepEqual(result.steps[0].nonComparableSemanticDifferencePaths, [
    'semantic.concepts.0'
  ]);
  assert.deepEqual(result.steps[0].semanticObservationGaps, [{
    kind: 'obsidian-active-indented-code-line',
    differencePaths: ['semantic.concepts.0'],
    line: { index: 1, start: 4, end: source.length, indentation: 4 },
    caretOffset: anchor,
    obsidianRenderedState: 'mixed',
    viewerSemanticType: 'code'
  }]);
});

test('active-code gap classification rejects nearby modes, carets, indentation, and semantics', () => {
  const source = '***\n    Code';
  const make = () => ({
    inspect: {
      ...sequence(1),
      syntaxFamily: 'bold-italic',
      mode: 'live-preview',
      state: { active: true }
    },
    obsidian: activeThematicBreakStep(
      'obsidian', source, 8, typedSemantic(['thematicBreak'])
    ),
    viewer: activeThematicBreakStep('viewer', source, 8, typedSemantic(['code']))
  });
  const mutations = [
    ({ inspect }) => { inspect.mode = 'source'; },
    ({ inspect }) => { inspect.state.active = false; },
    ({ obsidian, viewer }) => {
      obsidian.selection = { anchor: 0, focus: 0 };
      viewer.selection = { anchor: 0, focus: 0 };
    },
    ({ obsidian }) => { obsidian.presentation.renderedState = 'raw'; },
    ({ viewer }) => { viewer.presentation.renderedState = 'raw'; },
    ({ obsidian }) => { obsidian.presentation.visibleText = '***'; }
  ];
  mutations.forEach((mutate) => {
    const value = make();
    mutate(value);
    const result = compareActionTrace(
      value.inspect,
      parent('O1', [value.obsidian]),
      parent('V1', [value.viewer])
    );
    assert.equal(result.status, 'VIEWER_FAIL');
    assert.equal(result.semanticObservationGapCount, 0);
    assert.equal(result.steps[0].semanticDifferencePaths.includes('semantic.concepts.0'), true);
  });

  const shallowSource = '***\n   Code';
  const shallow = make();
  shallow.obsidian = activeThematicBreakStep(
    'obsidian', shallowSource, 7, typedSemantic(['thematicBreak'])
  );
  shallow.viewer = activeThematicBreakStep('viewer', shallowSource, 7, typedSemantic(['code']));
  const shallowResult = compareActionTrace(
    shallow.inspect,
    parent('O1', [shallow.obsidian]),
    parent('V1', [shallow.viewer])
  );
  assert.equal(shallowResult.status, 'VIEWER_FAIL');
  assert.equal(shallowResult.semanticObservationGapCount, 0);

  const extraSemantic = make();
  extraSemantic.viewer.semantic = typedSemantic(['code', 'heading']);
  const extraResult = compareActionTrace(
    extraSemantic.inspect,
    parent('O1', [extraSemantic.obsidian]),
    parent('V1', [extraSemantic.viewer])
  );
  assert.equal(extraResult.status, 'VIEWER_FAIL');
  assert.equal(extraResult.semanticObservationGapCount, 1);
  assert.equal(extraResult.steps[0].nonComparableSemanticDifferencePaths.includes(
    'semantic.concepts.0'
  ), true);
  assert.equal(extraResult.steps[0].semanticDifferencePaths.some((path) => (
    path === 'semantic.concepts.1' || path.startsWith('semantic.headingDepths')
  )), true);
});

test('a stray O1 chrome image is not treated as Markdown semantic coverage', () => {
  const inspect = { ...sequence(1), syntaxFamily: 'headings' };
  const chromeImage = {
    rootTypes: ['image'],
    nodes: [{ path: '0', type: 'image', quoteDepth: 0, listDepth: 0 }],
    typeCounts: { image: 1 },
    maximumQuoteDepth: 0,
    maximumListDepth: 0
  };
  const heading = {
    rootTypes: ['heading'],
    nodes: [{ path: '0', type: 'heading', depth: 1, quoteDepth: 0, listDepth: 0 }],
    typeCounts: { heading: 1 },
    maximumQuoteDepth: 0,
    maximumListDepth: 0
  };
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('# Heading', 9, chromeImage)]),
    parent('V1', [step('# Heading', 9, heading)])
  );

  assert.equal(result.status, 'MATCH');
  assert.deepEqual(result.steps[0].semanticSignalTypes, []);
  assert.equal(result.steps[0].nonComparableSemanticDifferencePaths.some((path) => (
    path.startsWith('semantic.headingDepths')
  )), true);
});

test('independently exposed list structure remains a comparable semantic failure', () => {
  const inspect = { ...sequence(1), syntaxFamily: 'unordered-lists' };
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('- A', 3, listSemantic({ ordered: false }))]),
    parent('V1', [step('- A', 3, listSemantic({ ordered: true, ordinal: 1 }))])
  );

  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.authoritativeStatus, 'MATCH');
  assert.equal(result.semanticContractDivergenceCount, 1);
  assert.deepEqual(result.steps[0].semanticSignalTypes, ['list', 'listItem']);
  assert.equal(result.steps[0].semanticDifferencePaths.some((path) => (
    path.startsWith('semantic.listStructure')
  )), true);
});

test('authoritative differences cannot be suppressed by a generic semantic gap', () => {
  const inspect = sequence(1);
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('A', 1, breakOnlySemantic())]),
    parent('V1', [step('B', 1, semantic())])
  );

  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.authoritativeStatus, 'VIEWER_FAIL');
  assert.equal(result.authoritativeDivergenceCount, 1);
  assert.equal(result.steps[0].authoritativeDifferencePaths.length > 0, true);
  assert.deepEqual(result.steps[0].semanticDifferencePaths, []);
  assert.deepEqual(result.steps[0].nonComparableSemanticDifferencePaths, [
    'semantic.contentBlockRecognized'
  ]);
});

test('an override cannot conceal an authoritative action-step difference', () => {
  const inspect = sequence(1);
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('A', 1)]),
    parent('V1', [step('B', 1)]),
    {
      overrides: [{
        id: 'test-source-override',
        syntaxFamilies: ['paragraphs'],
        allowedDifferencePaths: ['source', 'physical'],
        expectations: [{ path: 'source.text', equals: 'B' }]
      }]
    }
  );

  assert.equal(result.steps[0].normalizedStatusBeforeActionTraceComparability,
    'INTENTIONAL_VIEWER_OVERRIDE');
  assert.equal(result.status, 'VIEWER_FAIL');
  assert.equal(result.authoritativeStatus, 'VIEWER_FAIL');
  assert.equal(result.authoritativeDivergenceCount, 1);
});

test('specialized construct ambiguity remains explicit while authority is independently exact', () => {
  const inspect = { ...sequence(1), syntaxFamily: 'quotes', mode: 'live-preview' };
  const quote = {
    rootTypes: ['blockquote'],
    nodes: [{ path: '0', type: 'blockquote', quoteDepth: 1, listDepth: 0 }],
    typeCounts: { blockquote: 1 },
    maximumQuoteDepth: 1,
    maximumListDepth: 0
  };
  const result = compareActionTrace(
    inspect,
    parent('O1', [step('> A', 3, { ...breakOnlySemantic(), rootTypes: [], nodes: [], typeCounts: {} })]),
    parent('V1', [step('> A', 3, quote)])
  );

  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.authoritativeStatus, 'MATCH');
  assert.equal(result.semanticObservationGapCount, 0);
});

test('generic marker taxonomy is non-comparable without O1 semantics, but visible text is not', () => {
  const inspect = {
    ...sequence(1),
    requiredObservations: ['source', 'selection', 'physical', 'semantic', 'presentation']
  };
  const observation = (semanticValue, visibleText, markerVisibility) => ({
    ...step('A', 1, semanticValue),
    presentation: {
      mode: 'source',
      visibleText,
      markerVisibility,
      visibleMarkers: markerVisibility === 'visible' ? '*' : '',
      renderedState: 'raw'
    }
  });
  const obsidian = parent('O1', [observation(breakOnlySemantic(), 'A', 'visible')]);
  const markerOnly = compareActionTrace(
    inspect,
    obsidian,
    parent('V1', [observation(semantic(), 'A', 'hidden')])
  );
  const visibleTextMismatch = compareActionTrace(
    inspect,
    obsidian,
    parent('V1', [observation(semantic(), 'B', 'hidden')])
  );

  assert.equal(markerOnly.status, 'MATCH');
  assert.equal(markerOnly.steps[0].nonComparableDifferencePaths.includes(
    'presentation.markerVisibility'
  ), true);
  assert.equal(markerOnly.steps[0].nonComparableDifferencePaths.includes(
    'presentation.visibleMarkers'
  ), true);
  assert.equal(visibleTextMismatch.status, 'VIEWER_FAIL');
  assert.equal(visibleTextMismatch.steps[0].differences.some(({ path }) => (
    path === 'presentation.visibleText'
  )), true);
});

test('missing and misaligned steps retain comparator-compatible indeterminate statuses', () => {
  const inspect = sequence(2);
  const obsidian = parent('O1', [step('A')]);
  const viewer = parent('V1', [
    { index: 0, action: inspect.actions[0], observation: step('A') },
    { index: 1, action: { type: 'keyboard', key: 'Enter' }, observation: step('AB') },
    { index: 9, observation: step('extra') }
  ]);
  const result = compareActionTrace(inspect, obsidian, viewer);

  assert.equal(result.status, 'OBSIDIAN_NOT_AUTOMATABLE');
  assert.equal(result.steps[1].status, 'OBSIDIAN_NOT_AUTOMATABLE');
  assert.equal(result.steps[1].reasonCode, 'obsidian-action-trace-misaligned');
  assert.deepEqual(result.coverage.missingObsidianActionIndexes, [1]);
  assert.deepEqual(result.coverage.unexpectedViewerActionIndexes, [9]);
  assert.equal(result.alignedStepCount, 1);
});

test('evidence comparison pairs sequences by ID and aggregates action-level coverage', () => {
  const first = sequence(2);
  const second = { ...sequence(1), id: 'trace.second' };
  const obsidian = {
    results: {
      obsidian: {
        observations: [
          { scenarioId: first.id, ...parent('O1', [step('A'), step('AB')]) },
          { scenarioId: second.id, ...parent('O1', [step('A')]) },
          { scenarioId: 'unexpected.o1', ...parent('O1', []) }
        ]
      }
    }
  };
  const viewer = {
    results: {
      viewer: {
        observations: [
          { scenarioId: second.id, ...parent('V1', [step('B')]) },
          { scenarioId: first.id, ...parent('V1', [step('A'), step('AB')]) },
          { scenarioId: 'unexpected.v1', ...parent('V1', []) }
        ]
      }
    }
  };
  const result = compareActionTraceEvidence(
    { sequences: [first, second] },
    obsidian,
    viewer
  );

  assert.equal(result.scenarioCount, 2);
  assert.equal(result.expectedActionCount, 3);
  assert.equal(result.alignedStepCount, 3);
  assert.equal(result.authoritativeDivergenceScenarioCount, 1);
  assert.equal(result.authoritativeDivergenceStepCount, 1);
  assert.equal(result.counts.MATCH, 1);
  assert.equal(result.counts.VIEWER_FAIL, 1);
  assert.deepEqual(result.coverage.unexpectedObsidianScenarioIds, ['unexpected.o1']);
  assert.deepEqual(result.coverage.unexpectedViewerScenarioIds, ['unexpected.v1']);
});
