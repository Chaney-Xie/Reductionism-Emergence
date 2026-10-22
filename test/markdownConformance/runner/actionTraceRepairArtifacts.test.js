'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildActionTraceRepairGate } = require('./actionTraceRepairArtifacts');

function observation(scenarioId, steps) {
  return {
    scenarioId,
    evidenceLevel: 'O1',
    automatable: true,
    actionTrace: steps.map((step, index) => ({ index, observation: step }))
  };
}

function listStep(marker, source = '1. A\n7. B') {
  const list = {
    items: [{
      itemPath: '0', parentPath: null, lineIndex: 0, listDepth: 1,
      quoteDepth: 0, kind: 'ordered', recognized: true, checked: null,
      displayedMarker: marker, displayedOrdinal: Number.parseInt(marker, 10),
      markerVisible: true, active: true
    }],
    focus: { editorActive: true, activeItemPaths: ['0'], activeLineIndexes: [0] }
  };
  return {
    source,
    selection: { anchor: 3, focus: 3 },
    semantic: {
      rootTypes: ['list'],
      nodes: [{ path: '0', type: 'list', quoteDepth: 0, listDepth: 1, ordered: true }],
      typeCounts: { list: 1 },
      maximumQuoteDepth: 0,
      maximumListDepth: 1
    },
    presentation: { mode: 'live-preview', active: true, list },
    raw: { runtime: { presentationFacts: { list } } }
  };
}

test('authoritative repair gate preserves Tab affinity and history state', () => {
  const ordinary = {
    id: 'certification-random.ordinary', fixtureId: 'plain', syntaxFamily: 'paragraphs',
    mode: 'source', state: { active: true }, initialSource: 'A',
    initialSelection: { anchor: 1, focus: 1 }, comparisonPolicy: { kind: 'fully-comparable' },
    actions: [
      { type: 'input', command: 'insertText', text: 'x' },
      { type: 'keyboard', key: 'Tab' }
    ]
  };
  const history = {
    ...ordinary,
    id: 'certification-random.history',
    actions: [
      { type: 'input', command: 'insertText', text: 'x' },
      { type: 'keyboard', key: 'z', modifiers: ['platform-primary'], certificationEffect: 'undo' }
    ]
  };
  const comparison = {
    kind: 'o1-v1-action-trace-evidence-comparison',
    results: [ordinary, history].map((sequence) => ({
      scenarioId: sequence.id,
      firstAuthoritativeDivergence: {
        actionIndex: 1,
        authoritativeDifferencePaths: ['source.text']
      }
    }))
  };
  const obsidian = { results: { obsidian: { observations: [
    observation(ordinary.id, [
      { source: 'Ax', selection: { anchor: 2, focus: 2 } },
      { source: '    Ax', selection: { anchor: 6, focus: 6 } }
    ]),
    observation(history.id, [
      { source: 'Ax', selection: { anchor: 2, focus: 2 } },
      { source: 'A', selection: { anchor: 1, focus: 1 } }
    ])
  ] } } };
  const viewer = { results: { viewer: { observations: [
    observation(ordinary.id, [
      { source: 'Ax', selection: { anchor: 2, focus: 2 } },
      { source: ' Ax', selection: { anchor: 3, focus: 3 } }
    ]),
    observation(history.id, [
      { source: 'Ax', selection: { anchor: 2, focus: 2 } },
      { source: 'Ax', selection: { anchor: 2, focus: 2 } }
    ])
  ] } } };

  const gate = buildActionTraceRepairGate(
    { corpusSha256: 'source-sha', sequences: [ordinary, history] },
    comparison,
    obsidian,
    viewer
  );

  assert.equal(gate.caseCount, 2);
  assert.equal(gate.oneActionRebasedCount, 0);
  assert.equal(gate.preservedPrefixCount, 2);
  assert.equal(gate.sequences[0].initialSource, 'A');
  assert.deepEqual(gate.sequences[0].actions, ordinary.actions);
  assert.equal(gate.sequences[0].repairMetadata.expectedO1.source, '    Ax');
  assert.deepEqual(gate.sequences[0].oracleExpected, {
    source: '    Ax',
    selection: { anchor: 6, focus: 6 }
  });
  assert.equal(gate.sequences[1].initialSource, 'A');
  assert.deepEqual(gate.sequences[1].actions, history.actions);
  assert.equal(gate.sequences[1].repairCategory, 'history');
  assert.match(gate.corpusSha256, /^[a-f0-9]{64}$/);
});

test('selection envelopes and plain selection objects are both retained exactly', () => {
  const { exactSelection } = require('./actionTraceRepairArtifacts');
  assert.deepEqual(exactSelection({ anchor: 7, focus: 5 }), { anchor: 7, focus: 5 });
  assert.deepEqual(
    exactSelection({ selection: { anchor: 9, focus: 8 } }),
    { anchor: 9, focus: 8 }
  );
});

test('hidden Live Preview HTML affinity rebases the ordinary Backspace predecessor', () => {
  const {
    buildActionTraceRepairGate,
    requiresPrefixState
  } = require('./actionTraceRepairArtifacts');
  const action = {
    type: 'keyboard',
    key: 'Backspace',
    certificationEffect: 'possible-edit'
  };

  assert.equal(requiresPrefixState(action, {
    originScenarioId: 'certification-random.6b79cb9a3ebc970e5b3b',
    predecessor: {
      source: '<u  nerline</u>.',
      selection: { anchor: 5, focus: 5 }
    },
    expected: {
      source: '<u  erline</u>.',
      selection: { anchor: 4, focus: 4 }
    }
  }), false);

  assert.equal(requiresPrefixState(action, {
    originScenarioId: 'certification-random.ordinary-backspace'
  }), true);

  const id = 'certification-random.6b79cb9a3ebc970e5b3b';
  const scenario = {
    id,
    fixtureId: 'safe-inline-html',
    syntaxFamily: 'paragraphs',
    mode: 'live-preview',
    state: { active: true },
    initialSource: '<u>underline</u>.',
    initialSelection: { anchor: 3, focus: 3 },
    comparisonPolicy: { kind: 'fully-comparable' },
    actions: [
      { type: 'input', command: 'insertText', text: '`' },
      action
    ]
  };
  const gate = buildActionTraceRepairGate(
    { sequences: [scenario] },
    { kind: 'comparison', results: [{
      scenarioId: id,
      firstAuthoritativeDivergence: {
        actionIndex: 1,
        authoritativeDifferencePaths: ['source.text']
      }
    }] },
    { results: { obsidian: { observations: [observation(id, [
      { source: '<u  nerline</u>.', selection: { anchor: 5, focus: 5 } },
      { source: '<u  erline</u>.', selection: { anchor: 4, focus: 4 } }
    ])] } } },
    { results: { viewer: { observations: [observation(id, [
      { source: '<u  nerline</u>.', selection: { anchor: 5, focus: 5 } },
      { source: '<u erline</u>.', selection: { anchor: 3, focus: 3 } }
    ])] } } }
  );

  assert.equal(gate.oneActionRebasedCount, 1);
  assert.equal(gate.preservedPrefixCount, 0);
  assert.equal(gate.sequences[0].initialSource, '<u  nerline</u>.');
  assert.deepEqual(gate.sequences[0].initialSelection, { anchor: 5, focus: 5 });
  assert.deepEqual(gate.sequences[0].actions, [action]);
  assert.deepEqual(gate.sequences[0].repairMetadata.o1SetupAnnotation, {
    status: 'source-affinity-ambiguous',
    boundary: 'hidden-live-preview-html',
    resolution: 'rebase-authoritative-predecessor'
  });
});

test('Tab and Shift+Tab retain their producing prefix for semantic caret affinity', () => {
  const { actionHistoryEffect, requiresPrefixState } = require('./actionTraceRepairArtifacts');

  assert.equal(requiresPrefixState({
    type: 'keyboard',
    key: 'Tab',
    certificationEffect: 'possible-edit'
  }, { originScenarioId: 'certification-random.tab' }), true);
  assert.equal(requiresPrefixState({
    type: 'keyboard',
    key: 'Tab',
    shiftKey: true,
    certificationEffect: 'possible-edit'
  }, { originScenarioId: 'certification-random.shift-tab' }), true);
  assert.equal(requiresPrefixState({
    type: 'keyboard',
    key: 'Backspace',
    certificationEffect: 'possible-edit'
  }, {
    originScenarioId: 'list-editing-expanded.backspace',
    expandedListBehavior: true
  }), false);
  assert.equal(actionHistoryEffect({
    id: 'undo',
    historyEffect: 'undo',
    key: 'z'
  }), 'undo');
  assert.equal(requiresPrefixState({
    id: 'undo',
    historyEffect: 'undo',
    key: 'z'
  }, {
    originScenarioId: 'list-editing-expanded.history',
    expandedListBehavior: true
  }), true);
});

test('expanded-list repair gate saves every divergent action with normalized behavior oracle', () => {
  const id = 'list-editing-expanded.activation';
  const actions = [
    { type: 'click', command: 'click', offset: 3 },
    { type: 'click', command: 'click', offset: 8 }
  ];
  const scenario = {
    id,
    fixtureId: 'arbitrary-order',
    syntaxFamily: 'ordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'live-preview',
    state: { active: true },
    initialSource: '1. A\n7. B',
    initialSelection: { anchor: 0, focus: 0 },
    requiredObservations: ['source', 'selection', 'physical', 'semantic', 'presentation'],
    actions
  };
  const comparison = {
    kind: 'o1-v1-action-trace-evidence-comparison',
    results: [{
      scenarioId: id,
      firstAuthoritativeDivergence: { actionIndex: 0 },
      steps: actions.map((action, actionIndex) => ({
        action,
        actionIndex,
        authoritativeDivergence: true,
        authoritativeDifferencePaths: [
          'presentation.list.markers.0.displayedMarker'
        ],
        listContractDifferencePaths: [
          'presentation.list.markers.0.displayedMarker'
        ]
      }))
    }]
  };
  const obsidian = { results: { obsidian: { observations: [
    observation(id, [listStep('1.'), listStep('7.')])
  ] } } };
  const viewer = { results: { viewer: { observations: [
    observation(id, [listStep('2.'), listStep('2.')])
  ] } } };

  const gate = buildActionTraceRepairGate(
    { corpusSha256: 'list-sha', scenarios: [scenario] },
    comparison,
    obsidian,
    viewer
  );

  assert.equal(gate.sourceMismatchScenarioCount, 1);
  assert.equal(gate.caseCount, 2);
  assert.equal(gate.everyAuthoritativeDivergentActionSaved, true);
  assert.equal(gate.oneMinimalCaseCount, 2);
  assert.equal(gate.oneActionRebasedCount, 1);
  assert.equal(gate.authoritativePredecessorRebasedCount, 1);
  assert.equal(gate.originalSingleActionCount, 1);
  assert.deepEqual(gate.sequences.map(({ actions: minimized }) => minimized), [
    [actions[0]],
    [actions[1]]
  ]);
  assert.equal(gate.sequences[1].initialSource, '1. A\n7. B');
  assert.equal(
    gate.sequences[1].oracleExpected.presentation.list.markers[0].displayedMarker,
    '7.'
  );
  assert.equal(
    gate.sequences[1].repairMetadata.observedV1BeforeRepair
      .presentation.list.markers[0].displayedMarker,
    '2.'
  );
  assert.deepEqual(gate.sequences[1].requiredObservations, [
    'source', 'selection', 'physical', 'semantic', 'presentation'
  ]);
});

test('expanded-list historyEffect Undo and Redo reduce to exact history-producing suffixes', () => {
  const id = 'list-editing-expanded.history-effect';
  const actions = [
    { id: 'click', type: 'click', historyEffect: 'navigation' },
    { id: 'type-text', type: 'input', text: 'x', historyEffect: 'guaranteed-edit' },
    { id: 'undo', type: 'keyboard', key: 'z', historyEffect: 'undo' },
    { id: 'redo', type: 'keyboard', key: 'z', historyEffect: 'redo' }
  ];
  const scenario = {
    id,
    fixtureId: 'ordered-history',
    syntaxFamily: 'ordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'source',
    state: { active: true },
    initialSource: '1. A',
    initialSelection: { anchor: 0, focus: 0 },
    requiredObservations: ['source', 'selection', 'physical', 'semantic', 'presentation'],
    actions
  };
  const leftSteps = [
    listStep('1.', '1. A'),
    listStep('1.', '1. xA'),
    listStep('1.', '1. A'),
    listStep('1.', '1. xA')
  ];
  const rightSteps = [
    leftSteps[0],
    leftSteps[1],
    listStep('1.', '1. xA'),
    listStep('1.', '1. A')
  ];
  const comparison = {
    kind: 'o1-v1-action-trace-evidence-comparison',
    results: [{
      scenarioId: id,
      steps: [2, 3].map((actionIndex) => ({
        action: actions[actionIndex],
        actionIndex,
        authoritativeDivergence: true,
        authoritativeDifferencePaths: ['source.text'],
        listContractDifferencePaths: []
      }))
    }]
  };
  const gate = buildActionTraceRepairGate(
    { corpusSha256: 'history-list-sha', scenarios: [scenario] },
    comparison,
    { results: { obsidian: { observations: [observation(id, leftSteps)] } } },
    { results: { viewer: { observations: [observation(id, rightSteps)] } } }
  );

  assert.equal(gate.automaticMinimizationComplete, true);
  assert.equal(gate.preservedPrefixCount, 0);
  assert.equal(gate.dependencySuffixCount, 2);
  assert.deepEqual(gate.sequences.map(({ actions: minimized }) => minimized), [
    actions.slice(1, 3),
    actions.slice(1, 4)
  ]);
  assert.deepEqual(gate.sequences.map(({ repairMetadata }) => ({
    strategy: repairMetadata.minimizationStrategy,
    start: repairMetadata.historyReplayStartActionIndex,
    match: repairMetadata.historyAnchorMatch
  })), [
    { strategy: 'exact-history-dependency-suffix', start: 1, match: 'source-and-selection' },
    { strategy: 'exact-history-dependency-suffix', start: 1, match: 'source-and-selection' }
  ]);
});

test('history minimization retains an adjacent edit group when Viewer crosses the O1 boundary', () => {
  const id = 'list-editing-expanded.history-boundary-crossing';
  const actions = [
    { id: 'click', type: 'click', historyEffect: 'navigation' },
    { id: 'tab', type: 'keyboard', key: 'Tab', historyEffect: 'possible-edit' },
    { id: 'backspace', type: 'keyboard', key: 'Backspace', historyEffect: 'possible-edit' },
    { id: 'undo', type: 'keyboard', key: 'z', historyEffect: 'undo' }
  ];
  const scenario = {
    id,
    fixtureId: 'ordered-history-boundary',
    syntaxFamily: 'ordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'source',
    state: { active: true },
    initialSource: '1. A\n2. B',
    initialSelection: { anchor: 8, focus: 8 },
    requiredObservations: ['source', 'selection', 'physical', 'semantic', 'presentation'],
    actions
  };
  const beforeTab = listStep('2.', '1. A\n2. B');
  const afterTab = listStep('1.', '1. A\n    1. B');
  const afterBackspace = listStep('1.', '1. A\n    1. ');
  const leftSteps = [beforeTab, afterTab, afterBackspace, afterTab];
  const rightSteps = [beforeTab, afterTab, afterBackspace, beforeTab];
  const comparison = {
    kind: 'o1-v1-action-trace-evidence-comparison',
    results: [{
      scenarioId: id,
      steps: [{
        action: actions[3],
        actionIndex: 3,
        authoritativeDivergence: true,
        authoritativeDifferencePaths: ['source.text'],
        listContractDifferencePaths: []
      }]
    }]
  };

  const gate = buildActionTraceRepairGate(
    { corpusSha256: 'history-boundary-sha', scenarios: [scenario] },
    comparison,
    { results: { obsidian: { observations: [observation(id, leftSteps)] } } },
    { results: { viewer: { observations: [observation(id, rightSteps)] } } }
  );

  assert.deepEqual(gate.sequences[0].actions, actions.slice(1));
  assert.equal(gate.sequences[0].repairMetadata.historyReplayStartActionIndex, 1);
  assert.equal(gate.sequences[0].repairMetadata.historyViewerTargetStateIndex, 0);
  assert.equal(gate.sequences[0].repairMetadata.historyViewerTargetMatch, 'source-and-selection');
});

test('Redo minimization retains the edit crossed by the paired Viewer Undo', () => {
  const id = 'list-editing-expanded.redo-boundary-crossing';
  const actions = [
    { id: 'edit-one', type: 'input', text: 'B', historyEffect: 'guaranteed-edit' },
    { id: 'edit-two', type: 'input', text: 'C', historyEffect: 'guaranteed-edit' },
    { id: 'undo', type: 'keyboard', key: 'z', historyEffect: 'undo' },
    { id: 'redo', type: 'keyboard', key: 'z', historyEffect: 'redo' }
  ];
  const scenario = {
    id,
    fixtureId: 'ordered-redo-history-boundary',
    syntaxFamily: 'ordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'source',
    state: { active: true },
    initialSource: '1. A',
    initialSelection: { anchor: 4, focus: 4 },
    requiredObservations: ['source', 'selection', 'physical', 'semantic', 'presentation'],
    actions
  };
  const state = (source, offset) => ({
    ...listStep('1.', source),
    selection: { anchor: offset, focus: offset }
  });
  const afterEditOne = state('1. AB', 5);
  const afterEditTwo = state('1. ABC', 6);
  const initial = state('1. A', 4);
  const leftSteps = [afterEditOne, afterEditTwo, afterEditOne, afterEditTwo];
  const rightSteps = [afterEditOne, afterEditTwo, initial, afterEditOne];
  const comparison = {
    kind: 'o1-v1-action-trace-evidence-comparison',
    results: [{
      scenarioId: id,
      steps: [{
        action: actions[3],
        actionIndex: 3,
        authoritativeDivergence: true,
        authoritativeDifferencePaths: ['source.text'],
        listContractDifferencePaths: []
      }]
    }]
  };

  const gate = buildActionTraceRepairGate(
    { corpusSha256: 'redo-history-boundary-sha', scenarios: [scenario] },
    comparison,
    { results: { obsidian: { observations: [observation(id, leftSteps)] } } },
    { results: { viewer: { observations: [observation(id, rightSteps)] } } }
  );

  assert.deepEqual(gate.sequences[0].actions, actions);
  assert.equal(gate.sequences[0].repairMetadata.historyReplayStartActionIndex, 0);
  assert.equal(gate.sequences[0].repairMetadata.historyViewerTargetStateIndex, -1);
  assert.equal(gate.sequences[0].repairMetadata.historyViewerUndoTargetStateIndex, -1);
  assert.equal(
    gate.sequences[0].repairMetadata.historyViewerUndoTargetMatch,
    'source-and-selection'
  );
  assert.equal(gate.sequences[0].repairMetadata.historyViewerRedoTargetStateIndex, 0);
  assert.equal(
    gate.sequences[0].repairMetadata.historyViewerRedoTargetMatch,
    'source-and-selection'
  );
  assert.equal(gate.automaticMinimizationComplete, true);
});

test('source-only Undo anchors retain the original prefix and are not automatically complete', () => {
  const id = 'list-editing-expanded.history-source-only-anchor';
  const actions = [
    { id: 'navigate', type: 'click', historyEffect: 'navigation' },
    { id: 'edit', type: 'input', text: 'B', historyEffect: 'guaranteed-edit' },
    { id: 'undo', type: 'keyboard', key: 'z', historyEffect: 'undo' }
  ];
  const scenario = {
    id,
    fixtureId: 'ordered-history-source-only',
    syntaxFamily: 'ordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'source',
    state: { active: true },
    initialSource: '1. A',
    initialSelection: { anchor: 0, focus: 0 },
    actions
  };
  const state = (source, offset) => ({
    ...listStep('1.', source),
    selection: { anchor: offset, focus: offset }
  });
  const leftSteps = [
    state('1. A', 1),
    state('1. AB', 5),
    state('1. A', 4)
  ];
  const rightSteps = [leftSteps[0], leftSteps[1], leftSteps[1]];
  const gate = buildActionTraceRepairGate(
    { scenarios: [scenario] },
    { results: [{
      scenarioId: id,
      steps: [{ actionIndex: 2, authoritativeDivergence: true }]
    }] },
    { results: { obsidian: { observations: [observation(id, leftSteps)] } } },
    { results: { viewer: { observations: [observation(id, rightSteps)] } } }
  );

  assert.deepEqual(gate.sequences[0].actions, actions);
  assert.equal(gate.sequences[0].repairMetadata.historyDependencyResolved, false);
  assert.equal(gate.sequences[0].repairMetadata.prefixStatePreserved, true);
  assert.equal(
    gate.sequences[0].repairMetadata.minimizationStrategy,
    'dependency-preserving-prefix'
  );
  assert.equal(gate.sequences[0].repairMetadata.automaticMinimizationComplete, false);
  assert.equal(gate.automaticMinimizationComplete, false);
});

test('failed O1 asterisk-affinity setup retains the producing suffix for actions and history', () => {
  const id = 'list-editing-expanded.live-preview-asterisk-affinity';
  const actions = [
    { id: 'navigate', type: 'click', historyEffect: 'navigation' },
    { id: 'insert-asterisk', type: 'input', text: '*', historyEffect: 'guaranteed-edit' },
    { id: 'tab', type: 'keyboard', key: 'Tab', historyEffect: 'possible-edit' },
    { id: 'undo', type: 'keyboard', key: 'z', historyEffect: 'undo' }
  ];
  const scenario = {
    id,
    fixtureId: 'unordered-live-preview-affinity',
    syntaxFamily: 'unordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'live-preview',
    state: { active: true },
    initialSource: '- Alpha\n  - Beta',
    initialSelection: { anchor: 2, focus: 2 },
    actions
  };
  const state = (source, offset) => ({
    ...listStep('1.', source),
    selection: { anchor: offset, focus: offset }
  });
  const safe = state('- Alpha\n  - Beta', 12);
  const withAsterisk = state('- Alpha\n  - *Beta', 13);
  const indented = state('- Alpha\n      - *Beta', 17);
  const leftSteps = [safe, withAsterisk, indented, withAsterisk];
  const rightSteps = [safe, withAsterisk, state('- Alpha\n   - *Beta', 14), state('broken', 0)];
  const comparison = {
    results: [{
      scenarioId: id,
      steps: [2, 3].map((actionIndex) => ({
        actionIndex,
        authoritativeDivergence: true
      }))
    }]
  };
  const gateIds = [3, 4].map((number) => (
    `v0.3-full-trace-repair.${id}.action-${number}`
  ));
  const replayValidation = {
    results: gateIds.map((scenarioId) => ({
      scenarioId,
      status: 'OBSIDIAN_NOT_AUTOMATABLE',
      reasonCode: 'obsidian-not-automatable'
    }))
  };
  const gate = buildActionTraceRepairGate(
    { scenarios: [scenario] },
    comparison,
    { results: { obsidian: { observations: [observation(id, leftSteps)] } } },
    { results: { viewer: { observations: [observation(id, rightSteps)] } } },
    replayValidation
  );

  assert.deepEqual(gate.sequences.map(({ actions: minimized }) => (
    minimized.map(({ id: actionId }) => actionId)
  )), [
    ['insert-asterisk', 'tab'],
    ['insert-asterisk', 'tab', 'undo']
  ]);
  assert.deepEqual(gate.sequences.map(({ initialSource }) => initialSource), [
    safe.source, safe.source
  ]);
  assert.deepEqual(gate.sequences.map(({ repairMetadata }) => ({
    strategy: repairMetadata.minimizationStrategy,
    start: repairMetadata.originReplayStartActionIndex,
    historyCoreStart: repairMetadata.historyCoreReplayStartActionIndex,
    affinity: repairMetadata.caretAffinityDependencyPreserved,
    dependencySuffix: repairMetadata.dependencySuffixPreserved,
    prefix: repairMetadata.prefixStatePreserved,
    automatic: repairMetadata.automaticMinimizationComplete
  })), [
    {
      strategy: 'caret-affinity-producing-suffix',
      start: 1,
      historyCoreStart: null,
      affinity: true,
      dependencySuffix: true,
      prefix: false,
      automatic: false
    },
    {
      strategy: 'caret-affinity-history-dependency-suffix',
      start: 1,
      historyCoreStart: 2,
      affinity: true,
      dependencySuffix: true,
      prefix: false,
      automatic: false
    }
  ]);
  assert.equal(gate.caretAffinityProducingSuffixCount, 2);
  assert.equal(gate.requiresO1ReplayValidationCount, 2);
  assert.equal(gate.automaticMinimizationComplete, false);
});

test('a successful strict O1 replay preserves its proven caret-affinity suffix', () => {
  const id = 'list-editing-expanded.strict-replay-affinity';
  const actions = [
    { id: 'navigate', type: 'click', historyEffect: 'navigation' },
    { id: 'insert-asterisk', type: 'input', text: '*', historyEffect: 'guaranteed-edit' },
    { id: 'tab', type: 'keyboard', key: 'Tab', historyEffect: 'possible-edit' }
  ];
  const scenario = {
    id,
    fixtureId: 'strict-replay-affinity',
    syntaxFamily: 'unordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'live-preview',
    state: { active: true },
    initialSource: '- Alpha\n  - Beta',
    initialSelection: { anchor: 2, focus: 2 },
    actions
  };
  const state = (source, offset) => ({
    ...listStep('1.', source),
    selection: { anchor: offset, focus: offset }
  });
  const safe = state('- Alpha\n  - Beta', 12);
  const withAsterisk = state('- Alpha\n  - *Beta', 13);
  const indented = state('- Alpha\n      - *Beta', 17);
  const gateId = `v0.3-full-trace-repair.${id}.action-3`;
  const gate = buildActionTraceRepairGate(
    { scenarios: [scenario] },
    { results: [{
      scenarioId: id,
      steps: [{ actionIndex: 2, authoritativeDivergence: true }]
    }] },
    { results: { obsidian: { observations: [observation(id, [
      safe, withAsterisk, indented
    ])] } } },
    { results: { viewer: { observations: [observation(id, [
      safe, withAsterisk, state('broken', 0)
    ])] } } },
    { results: [{
      scenarioId: gateId,
      status: 'REPRODUCIBLE',
      reasonCode: 'oracle-reproduced',
      originReplay: {
        status: 'VERIFIED',
        firstDivergentActionIndex: 2,
        gateActionCount: 2
      }
    }] }
  );

  const saved = gate.sequences[0];
  assert.deepEqual(saved.actions, actions.slice(1));
  assert.equal(saved.repairMetadata.originReplayStartActionIndex, 1);
  assert.equal(saved.repairMetadata.caretAffinityDependencyPreserved, true);
  assert.equal(saved.repairMetadata.o1ReplayPriorStartActionIndex, 1);
  assert.equal(saved.repairMetadata.o1ReplayReproduced, true);
  assert.equal(saved.repairMetadata.automaticMinimizationComplete, true);
  assert.equal(saved.repairMetadata.requiresO1ReplayValidation, false);
  assert.equal(gate.o1ReplayReproducedCount, 1);
  assert.equal(gate.automaticMinimizationComplete, true);
});

test('a strict O1 oracle mismatch expands one earlier edit dependency boundary', () => {
  const historyId = 'list-editing-expanded.strict-replay-history-expansion';
  const historyActions = [
    { id: 'navigate', type: 'click', historyEffect: 'navigation' },
    { id: 'insert-asterisk', type: 'input', text: '*', historyEffect: 'guaranteed-edit' },
    { id: 'undo', type: 'keyboard', key: 'z', historyEffect: 'undo' },
    { id: 'redo', type: 'keyboard', key: 'z', historyEffect: 'redo' },
    { id: 'tab', type: 'keyboard', key: 'Tab', historyEffect: 'possible-edit' }
  ];
  const indentationId = 'list-editing-expanded.strict-replay-indentation-expansion';
  const indentationActions = [
    { id: 'navigate', type: 'click', historyEffect: 'navigation' },
    { id: 'type-x', type: 'input', text: 'x', historyEffect: 'guaranteed-edit' },
    { id: 'tab-one', type: 'keyboard', key: 'Tab', historyEffect: 'possible-edit' },
    { id: 'insert-asterisk', type: 'input', text: '*', historyEffect: 'guaranteed-edit' },
    { id: 'tab-two', type: 'keyboard', key: 'Tab', historyEffect: 'possible-edit' },
    { id: 'type-space', type: 'input', text: ' ', historyEffect: 'guaranteed-edit' }
  ];
  const scenario = (id, actions) => ({
    id,
    fixtureId: 'strict-replay-expansion',
    syntaxFamily: 'unordered-lists',
    tags: ['list-editing-expanded'],
    mode: 'live-preview',
    state: { active: true },
    initialSource: '- Alpha\n- Beta',
    initialSelection: { anchor: 2, focus: 2 },
    actions
  });
  const state = (source, offset) => ({
    ...listStep('1.', source),
    selection: { anchor: offset, focus: offset }
  });
  const historySteps = [
    state('- Alpha\n- Beta', 10),
    state('- Alpha\n- *Beta', 11),
    state('- Alpha\n- Beta', 10),
    state('- Alpha\n- *Beta', 11),
    state('- Alpha\n    - *Beta', 15)
  ];
  const indentationSteps = [
    state('- Alpha\n- Beta', 10),
    state('- Alpha\n- xBeta', 11),
    state('- Alpha\n    - xBeta', 15),
    state('- Alpha\n    - x*Beta', 16),
    state('- Alpha\n        - x*Beta', 20),
    state('- Alpha\n        - x* Beta', 21)
  ];
  const scenarios = [
    scenario(historyId, historyActions),
    scenario(indentationId, indentationActions)
  ];
  const targetIndexes = [4, 5];
  const obsidianObservations = [
    observation(historyId, historySteps),
    observation(indentationId, indentationSteps)
  ];
  const viewerObservations = [
    observation(historyId, [...historySteps.slice(0, 4), state('broken-history', 0)]),
    observation(indentationId, [
      ...indentationSteps.slice(0, 5), state('broken-indentation', 0)
    ])
  ];
  const replayResults = scenarios.map((entry, index) => ({
    scenarioId: `v0.3-full-trace-repair.${entry.id}.action-${targetIndexes[index] + 1}`,
    status: 'AMBIGUOUS_ORACLE_MISMATCH',
    reasonCode: 'oracle-final-mismatch',
    originReplay: {
      status: 'VERIFIED',
      firstDivergentActionIndex: targetIndexes[index],
      gateActionCount: index === 0 ? 2 : 3
    }
  }));
  const gate = buildActionTraceRepairGate(
    { scenarios },
    { results: scenarios.map((entry, index) => ({
      scenarioId: entry.id,
      steps: [{
        actionIndex: targetIndexes[index],
        authoritativeDivergence: true
      }]
    })) },
    { results: { obsidian: { observations: obsidianObservations } } },
    { results: { viewer: { observations: viewerObservations } } },
    { results: replayResults }
  );

  assert.deepEqual(gate.sequences.map(({ actions: saved }) => (
    saved.map(({ id: actionId }) => actionId)
  )), [
    ['insert-asterisk', 'undo', 'redo', 'tab'],
    ['tab-one', 'insert-asterisk', 'tab-two', 'type-space']
  ]);
  assert.deepEqual(gate.sequences.map(({ repairMetadata }) => ({
    start: repairMetadata.originReplayStartActionIndex,
    previous: repairMetadata.o1ReplayDependencyPreviousStartActionIndex,
    kind: repairMetadata.o1ReplayDependencyExpansionKind,
    mismatch: repairMetadata.o1ReplayOracleMismatchObserved,
    automatic: repairMetadata.automaticMinimizationComplete
  })), [
    {
      start: 1,
      previous: 3,
      kind: 'preceding-edit-boundary',
      mismatch: true,
      automatic: false
    },
    {
      start: 2,
      previous: 3,
      kind: 'preceding-edit-boundary',
      mismatch: true,
      automatic: false
    }
  ]);
  assert.equal(gate.o1ReplayOracleMismatchCount, 2);
  assert.equal(gate.o1ReplayDependencyExpandedCount, 2);
  assert.equal(gate.requiresO1ReplayValidationCount, 2);
  assert.equal(gate.automaticMinimizationComplete, false);
});

test('permanent Round-5 list gate saves all seven divergent states exactly once', () => {
  const { digest } = require('./utils');
  const gate = require(
    '../scenarios/v0.3ListRandom500MinimizedRegressionsRound5.json'
  );

  assert.equal(gate.caseCount, 7);
  assert.equal(gate.divergentActionCount, 7);
  assert.equal(gate.divergentScenarioCount, 4);
  assert.equal(gate.everyAuthoritativeDivergentActionSaved, true);
  assert.equal(gate.oneMinimalCaseCount, 3);
  assert.equal(gate.authoritativePredecessorRebasedCount, 3);
  assert.equal(gate.historyDependencyResolvedCount, 4);
  assert.equal(gate.historyDependencySuffixCount, 4);
  assert.equal(gate.dependencySuffixCount, 4);
  assert.deepEqual(gate.categoryCounts, {
    delete: 1,
    history: 4,
    navigation: 1,
    'text-insertion': 1
  });
  assert.equal(gate.corpusSha256, digest(gate.sequences));

  const originActions = gate.sequences.map(({ repairMetadata }) => (
    `${repairMetadata.originScenarioId}@${repairMetadata.divergentActionIndex}`
  ));
  assert.equal(new Set(originActions).size, 7);
  assert.equal(new Set(gate.sequences.map(({ id }) => id)).size, 7);

  const historyCases = gate.sequences.filter(({ repairCategory }) => (
    repairCategory === 'history'
  ));
  const rebasedCases = gate.sequences.filter(({ repairMetadata }) => (
    repairMetadata.oneMinimalByActionCount
  ));
  assert.equal(historyCases.length, 4);
  assert.equal(rebasedCases.length, 3);
  for (const scenario of historyCases) {
    const metadata = scenario.repairMetadata;
    assert.ok(scenario.actions.length > 1, scenario.id);
    assert.ok(['undo', 'redo'].includes(scenario.actions.at(-1).id), scenario.id);
    assert.equal(metadata.historyDependencyResolved, true, scenario.id);
    assert.equal(metadata.historyDependencyReduced, true, scenario.id);
    assert.equal(metadata.historyAnchorMatch, 'source-and-selection', scenario.id);
    assert.equal(metadata.historyViewerTargetMatch, 'source-and-selection', scenario.id);
    assert.equal(metadata.dependencySuffixPreserved, true, scenario.id);
    assert.equal(metadata.minimizedActionCount, scenario.actions.length, scenario.id);
  }
  for (const scenario of rebasedCases) {
    const metadata = scenario.repairMetadata;
    assert.equal(scenario.actions.length, 1, scenario.id);
    assert.equal(
      metadata.minimizationStrategy,
      'rebase-o1-authoritative-predecessor',
      scenario.id
    );
    assert.equal(metadata.prefixStateRequired, false, scenario.id);
  }
  for (const scenario of gate.sequences) {
    assert.deepEqual(
      scenario.oracleExpected,
      scenario.repairMetadata.expectedO1,
      scenario.id
    );
    assert.notDeepEqual(
      scenario.repairMetadata.expectedO1,
      scenario.repairMetadata.observedV1BeforeRepair,
      scenario.id
    );
  }
});
