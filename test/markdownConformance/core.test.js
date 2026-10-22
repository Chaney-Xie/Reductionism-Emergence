'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const fixtures = require('./fixtures/canonicalFixtures.json');
const inventory = require('./inventory/supportedSyntax.json');
const actions = require('./scenarios/actionCatalog.json');
const overrides = require('./overrides/viewerOverrides.json');
const { validateFixtures } = require('./runner/fixtureValidation');
const { generateScenarios, boundaryPositions } = require('./scenarios/generator');
const {
  normalizeObservation,
  observeViewerSource,
  physicalLines,
  semanticObservationFromViewer,
  sourcePoint
} = require('./runner/observations');
const { compareCorpus, compareScenario, STATUS } = require('./runner/comparator');
const {
  CERTIFICATION_PROFILE,
  generateCertificationRandomSequences,
  generateRandomSequences,
  validateCertificationHistory
} = require('./runner/randomSequences');
const { ddmin, minimizeFailure, writeMinimizedRegression } = require('./runner/minimizer');
const { executeRandomSequence, executeScenario } = require('./runner/executor');
const { matrixMarkdown, summaryMarkdown } = require('./runner/report');
const { writeVersionedOracle } = require('./runner/oracleStore');

function observation(evidenceLevel, source = 'A', additions = {}) {
  return {
    scenarioId: additions.scenarioId,
    evidenceLevel,
    automatable: true,
    source,
    selection: additions.selection || {anchor: source.length, focus: source.length},
    semantic: additions.semantic || {rootTypes: ['paragraph']},
    ...additions
  };
}

test('current inventory retains all 22 supported rows and additional existing forms', () => {
  assert.equal(inventory.syntax.length, 22);
  assert.equal(new Set(inventory.syntax.map((entry) => entry.id)).size, 22);
  const forms = inventory.additionalSupportedForms.flatMap((entry) => entry.forms);
  for (const expected of [
    'Setext H1 with equals underline',
    'backslash hard break',
    'double-underscore bold',
    'right-parenthesis ordered-list delimiter',
    'tilde fence',
    'full reference link',
    'reference Markdown image'
  ]) assert.ok(forms.includes(expected), expected);
  assert.ok(inventory.explicitlyUnsupportedOrOutOfScope.includes('Obsidian wikilinks and embeds'));
});

test('all canonical fixtures resolve and satisfy physical and Viewer semantic assertions', () => {
  const result = validateFixtures(fixtures, inventory);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.ok(fixtures.fixtures.length >= 58);
});

test('physical lines retain endings, blank rows, and a terminal empty row independently of semantics', () => {
  assert.deepEqual(physicalLines('A\r\n\r\nB\n').map((line) => ({
    text: line.text,
    ending: line.lineEnding,
    terminal: line.terminal
  })), [
    {text: 'A', ending: '\r\n', terminal: false},
    {text: '', ending: '\r\n', terminal: false},
    {text: 'B', ending: '\n', terminal: false},
    {text: '', ending: '', terminal: true}
  ]);
  const semantic = semanticObservationFromViewer('A\nB\nC');
  assert.deepEqual(semantic.rootTypes, ['paragraph']);
  assert.equal(physicalLines('A\nB\nC').length, 3);
  assert.deepEqual(sourcePoint('A\nB', 2), {offset: 2, line: 2, column: 1, lineIndex: 1});
});

test('Viewer observation uses snapshot physical rows and strict editable-list ownership', () => {
  const source = [
    '1. ordered',
    '\t- nested',
    ' 1. space is ordinary',
    '1) paren is ordinary',
    '* star is ordinary',
    '+ plus is ordinary',
    '```md',
    '2. fenced is ordinary',
    '```'
  ].join('\r\n');
  const semantic = semanticObservationFromViewer(source);
  const contexts = semantic.physicalLineContexts;

  assert.deepEqual(contexts.map((context) => context.lineStart), [
    0, 12, 23, 46, 68, 88, 108, 115, 138
  ]);
  assert.deepEqual(contexts
    .filter((context) => context.editableList)
    .map((context) => ({
      lineIndex: context.lineIndex,
      kind: context.editableList.kind,
      depth: context.editableList.depth,
      marker: context.editableList.marker
    })), [
    {lineIndex: 0, kind: 'ordered', depth: 1, marker: '1.'},
    {lineIndex: 1, kind: 'unordered', depth: 2, marker: '-'}
  ]);
  assert.equal(contexts[2].semanticOwnerTypes.includes('list'), true);
  assert.equal(contexts[2].editableList, null);
  assert.equal(contexts[3].editableList, null);
  assert.equal(contexts[4].editableList, null);
  assert.equal(contexts[5].editableList, null);
  assert.equal(contexts[7].inFencedCode, true);
  assert.equal(contexts[7].editableList, null);
  assert.ok(contexts.every((context) => context.lineEnding === '\r\n' || context.terminal));
});

test('Viewer observation never calls the removed structural-context API', () => {
  const realModel = require('../../public/markdownPage');
  const model = {
    createSourceSnapshot: realModel.createSourceSnapshot,
    markdownStructuralContextAtOffset() {
      throw new Error('legacy structural context must not be called');
    }
  };
  const semantic = semanticObservationFromViewer('> quote\n\n- item', model);
  assert.equal(semantic.maximumQuoteDepth, 1);
  assert.equal(semantic.physicalLineContexts[2].editableList.kind, 'unordered');
});

test('boundary generator names all required meaningful source positions', () => {
  const fixture = fixtures.fixtures.find((entry) => entry.id === 'bold');
  const names = boundaryPositions(fixture).map((boundary) => boundary.name);
  for (const name of [
    'document-start',
    'after-opening-marker',
    'text-start',
    'text-middle',
    'text-end',
    'before-closing-marker',
    'physical-line-end',
    'terminal-line',
    'document-end'
  ]) assert.ok(names.includes(name), name);
});

test('deterministic boundary/action generation produces thousands with stable hashes and executable actions', () => {
  const first = generateScenarios(fixtures, actions);
  const second = generateScenarios(fixtures, actions);
  assert.equal(first.scenarioCount, 14328);
  assert.equal(new Set(first.scenarios.map((scenario) => scenario.id)).size, first.scenarioCount);
  assert.equal(first.corpusSha256, second.corpusSha256);
  assert.deepEqual(first.scenarios, second.scenarios);
  assert.ok(first.scenarios.every((scenario) => scenario.initialSelection && scenario.action.type));
  assert.ok(first.scenarios.some((scenario) => scenario.action.id === 'undo'));
  assert.ok(first.scenarios.some((scenario) => scenario.action.id === 'redo'));
  assert.ok(first.scenarios.some((scenario) => scenario.action.id === 'shift-tab'));
});

test('unit semantic helper labels itself U and never masquerades as O1 or V1', () => {
  const observed = observeViewerSource('> A', {anchor: 3, focus: 3});
  assert.equal(observed.evidenceLevel, 'U');
  assert.equal(observed.semantic.maximumQuoteDepth, 1);
  assert.equal(observed.physical.lineCount, 1);
});

test('comparator makes source authoritative and requires real evidence by default', () => {
  const scenario = {
    id: 'plain.edit', fixtureId: 'plain', syntaxFamily: 'paragraphs', mode: 'source',
    state: {active: true}, action: {id: 'insert-text'},
    requiredObservations: ['source', 'selection', 'physical', 'semantic']
  };
  const left = observation('O1', 'Ax');
  const right = observation('V1', 'Ax');
  assert.equal(compareScenario(scenario, left, right, overrides).status, STATUS.MATCH);
  const failed = compareScenario(scenario, left, observation('V1', 'Ay'), overrides);
  assert.equal(failed.status, STATUS.VIEWER_FAIL);
  assert.equal(failed.sourceAuthorityFailed, true);
  assert.equal(compareScenario(scenario, observation('U', 'Ax'), right, overrides).status,
    STATUS.OBSIDIAN_NOT_AUTOMATABLE);
});

test('missing Obsidian semantic inspection is never silently MATCH', () => {
  const scenario = {
    id: 'missing.semantic', fixtureId: 'plain', syntaxFamily: 'paragraphs', mode: 'source',
    action: {id: 'inspect'}, requiredObservations: ['source', 'semantic']
  };
  const obsidian = {evidenceLevel: 'O1', automatable: true, source: 'A'};
  const viewer = observation('V1', 'A');
  assert.equal(compareScenario(scenario, obsidian, viewer, overrides).status,
    STATUS.OBSIDIAN_NOT_AUTOMATABLE);
});

test('unavailable Viewer evidence is ambiguous and persistence disagreement is a failure', () => {
  const scenario = {
    id: 'viewer.capture', fixtureId: 'plain', syntaxFamily: 'paragraphs', mode: 'source',
    action: {id: 'inspect'}, requiredObservations: ['source']
  };
  const obsidian = observation('O1', 'A');
  assert.equal(compareScenario(scenario, obsidian, {
    ...observation('V1', 'A'),
    automatable: false,
    metadata: {automationError: {message: 'capture unavailable'}}
  }, overrides).status, STATUS.AMBIGUOUS);
  assert.equal(compareScenario(scenario, obsidian, {
    ...observation('V1', 'A'),
    integrityFailure: ['api', 'dom']
  }, overrides).status, STATUS.VIEWER_FAIL);
});

test('strict overrides accept only allowed presentation paths and validated Viewer rules', () => {
  const scenario = {
    id: 'hr.reading', fixtureId: 'thematic-break', syntaxFamily: 'thematic-break',
    mode: 'reading', state: {active: false}, action: {id: 'inspect'},
    requiredObservations: ['source', 'physical', 'presentation']
  };
  const obsidian = observation('O1', '---', {
    presentation: {renderedState: 'visible', markerVisibility: 'hidden', visibleText: '', elementType: 'hr'}
  });
  const viewer = observation('V1', '---', {
    presentation: {renderedState: 'hidden', markerVisibility: 'hidden', visibleText: '', elementType: 'none'}
  });
  const intentional = compareScenario(scenario, obsidian, viewer, overrides);
  assert.equal(intentional.status, STATUS.INTENTIONAL_VIEWER_OVERRIDE);
  assert.equal(intentional.overrideId, 'viewer-hidden-horizontal-rule');

  const brokenViewer = observation('V1', '---', {
    presentation: {renderedState: 'visible', markerVisibility: 'hidden', visibleText: '', elementType: 'div'}
  });
  assert.equal(compareScenario(scenario, obsidian, brokenViewer, overrides).status,
    STATUS.VIEWER_FAIL);

  const wrongSource = observation('V1', '--', {
    presentation: {renderedState: 'hidden', markerVisibility: 'hidden', visibleText: '', elementType: 'none'}
  });
  assert.equal(compareScenario(scenario, obsidian, wrongSource, overrides).status,
    STATUS.VIEWER_FAIL);
});

test('depth-three Viewer quote rails are explicitly covered', () => {
  const scenario = {
    id: 'quote.3.active', fixtureId: 'quote-depth-3', syntaxFamily: 'quotes', mode: 'live-preview',
    state: {active: true, quoteDepth: 3}, action: {id: 'inspect'},
    requiredObservations: ['source', 'physical', 'presentation']
  };
  const obsidian = observation('O1', '>>> A', {presentation: {quoteRailText: 'obsidian'}});
  const viewer = observation('V1', '>>> A', {presentation: {quoteRailText: '|>>>'}});
  assert.equal(compareScenario(scenario, obsidian, viewer, overrides).status,
    STATUS.INTENTIONAL_VIEWER_OVERRIDE);
});

test('corpus comparison joins by scenario ID and emits complete status counts', () => {
  const scenario = {
    id: 'one', fixtureId: 'one', syntaxFamily: 'paragraphs', mode: 'source',
    state: {active: true}, action: {id: 'inspect'}, requiredObservations: ['source', 'semantic']
  };
  const compared = compareCorpus(
    {scenarios: [scenario]},
    {observations: [{...observation('O1', 'A'), scenarioId: 'one'}]},
    {observations: [{...observation('V1', 'A'), scenarioId: 'one'}]},
    overrides
  );
  assert.equal(compared.counts.MATCH, 1);
  assert.equal(compared.counts.VIEWER_FAIL, 0);
});

test('seeded random sequences are deterministic and bounded', () => {
  const options = {seed: 'fixed-seed', count: 40, minimumActions: 3, maximumActions: 12};
  const first = generateRandomSequences(fixtures, options);
  const second = generateRandomSequences(fixtures, options);
  assert.deepEqual(first, second);
  assert.equal(first.sequences.length, 40);
  assert.ok(first.sequences.every((sequence) => (
    sequence.actions.length >= 3 && sequence.actions.length <= 12
  )));
  assert.throws(() => generateRandomSequences(fixtures, {count: 10001}), /count/);
  assert.throws(() => generateRandomSequences(fixtures, {count: 1, maximumActions: 101}), /maximumActions/);
});

test('v0.3 certification random corpus has valid history and comparable navigation', () => {
  const first = generateCertificationRandomSequences(fixtures);
  const second = generateCertificationRandomSequences(fixtures);
  assert.deepEqual(first, second);
  assert.equal(first.profile, 'v0.3-valid');
  assert.equal(first.seed, 'cogneuro-v0.3-certification-random-001');
  assert.equal(first.count, 100);
  assert.equal(first.corpusSha256,
    '6085a46a252f666a9f0ae3e60e9d649a797039c84500e8f385b86cf78db24868');
  assert.ok(first.sequences.every((sequence) => (
    sequence.actions.length >= CERTIFICATION_PROFILE.minimumActions
    && sequence.actions.length <= CERTIFICATION_PROFILE.maximumActions
  )));
  assert.ok(first.sequences.every((sequence) => validateCertificationHistory(sequence.actions).valid));
  assert.ok(first.sequences.every((sequence) => sequence.actions.every((action) => (
    !['ArrowUp', 'ArrowDown'].includes(action.key)
  ))));
  const allActions = first.sequences.flatMap((sequence) => sequence.actions);
  assert.ok(allActions.some((action) => action.certificationEffect === 'undo'));
  assert.ok(allActions.some((action) => action.certificationEffect === 'redo'));
  allActions.forEach((action, index) => {
    if (action.certificationEffect !== 'redo') return;
    assert.equal(allActions[index - 1]?.certificationEffect, 'undo');
  });
  assert.throws(() => generateCertificationRandomSequences(fixtures, {count: 101}), /count/);
});

test('certification history validator rejects invalid Undo, Redo, and vertical navigation', () => {
  assert.equal(validateCertificationHistory([
    {type: 'keyboard', key: 'z', modifiers: ['platform-primary'], certificationEffect: 'undo'}
  ]).valid, false);
  assert.equal(validateCertificationHistory([
    {type: 'input', command: 'insertText', text: 'x', certificationEffect: 'guaranteed-edit'},
    {type: 'keyboard', key: 'z', modifiers: ['platform-primary'], certificationEffect: 'undo'},
    {type: 'keyboard', key: 'ArrowRight', certificationEffect: 'navigation'},
    {type: 'keyboard', key: 'z', modifiers: ['platform-primary', 'shift'], certificationEffect: 'redo'}
  ]).valid, false);
  assert.equal(validateCertificationHistory([
    {type: 'keyboard', key: 'ArrowUp', certificationEffect: 'navigation'}
  ]).valid, false);
});

test('optional vertical certification probes are terminal and explicitly non-comparable', () => {
  const corpus = generateCertificationRandomSequences(fixtures, {
    count: 12,
    includeNonComparableVerticalNavigation: true
  });
  assert.equal(corpus.verticalNavigation, 'terminal-non-comparable');
  corpus.sequences.forEach((sequence) => {
    const terminal = sequence.actions.at(-1);
    assert.ok(['ArrowUp', 'ArrowDown'].includes(terminal.key));
    assert.equal(terminal.comparison, 'non-comparable');
    assert.deepEqual(terminal.nonComparableDimensions, ['selection']);
    assert.deepEqual(sequence.comparisonPolicy.nonComparableDimensions, ['selection']);
    assert.ok(!sequence.requiredObservations.includes('selection'));
    assert.ok(sequence.actions.length <= CERTIFICATION_PROFILE.maximumActions);
    assert.equal(validateCertificationHistory(sequence.actions).valid, true);
  });
});

test('ddmin and failure wrapper preserve a reproducing minimal action sequence', async () => {
  const minimized = await ddmin(['noise-1', 'trigger', 'noise-2'], async (items) => items.includes('trigger'));
  assert.deepEqual(minimized.minimized, ['trigger']);
  const record = await minimizeFailure({
    id: 'random.old', fixtureId: 'plain', initialSource: 'A', actions: [
      {id: 'noise'}, {id: 'trigger'}, {id: 'noise-2'}
    ]
  }, async (sequence) => sequence.actions.some((action) => action.id === 'trigger'));
  assert.deepEqual(record.minimizedSequence.actions, [{id: 'trigger'}]);
  assert.match(record.minimizedSequence.id, /^regression\./);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'md-regression-'));
  const destination = writeMinimizedRegression(directory, record, {
    obsidianVersion: 'test', viewerCommit: 'test'
  });
  assert.equal(JSON.parse(fs.readFileSync(destination)).sequence.actions.length, 1);
  assert.throws(() => writeMinimizedRegression(directory, record), /not overwritten/);
});

test('transport-neutral executor performs setup, actions, and post-action capture', async () => {
  const calls = [];
  const adapter = {
    async replaceSource(value) { calls.push(['source', value]); },
    async setMode(mode) { calls.push(['mode', mode]); },
    async setSelection(selection) { calls.push(['selection', selection]); },
    async performAction(action) { calls.push(['action', action.key || action.command]); },
    async capture() { calls.push(['capture']); return {evidenceLevel: 'V1', source: 'A'}; }
  };
  const scenario = {
    id: 'exec', initialSource: 'A', mode: 'source', state: {active: true},
    initialSelection: {anchor: 1, focus: 1},
    action: {type: 'sequence', steps: [{type: 'keyboard', key: 'Enter'}, {type: 'input', command: 'insertText'}]}
  };
  const result = await executeScenario(adapter, scenario);
  assert.equal(result.scenarioId, 'exec');
  assert.deepEqual(calls.map((call) => call[0]), ['source', 'mode', 'selection', 'action', 'action', 'capture']);

  calls.length = 0;
  const random = await executeRandomSequence(adapter, {
    id: 'random.exec', initialSource: 'A', mode: 'source', initialSelection: {anchor: 1, focus: 1},
    actions: [{type: 'keyboard', key: 'Enter'}, {type: 'keyboard', key: 'Backspace'}]
  });
  assert.equal(random.trace.length, 2);
  assert.equal(calls.filter((call) => call[0] === 'capture').length, 2);
});

test('reports include the human matrix and required summary totals', () => {
  const comparison = {
    scenarioCount: 1,
    counts: {MATCH: 1, INTENTIONAL_VIEWER_OVERRIDE: 0, VIEWER_FAIL: 0, OBSIDIAN_NOT_AUTOMATABLE: 0, AMBIGUOUS: 0},
    results: [{scenarioId: 'one', syntaxFamily: 'paragraphs', mode: 'source', actionId: 'inspect', status: 'MATCH', differences: []}]
  };
  assert.match(matrixMarkdown(comparison, {obsidianVersion: '1.2.3'}), /\| paragraphs \| one \|/);
  const summary = summaryMarkdown(comparison, {
    obsidianVersion: '1.2.3', viewerCommit: 'abc', randomSequenceCount: 10,
    productionFilesChanged: [], viewerSuiteTotals: '10/10 PASS'
  });
  assert.match(summary, /Viewer FAIL after repair: 0/);
  assert.match(summary, /Random sequences: 10/);
  assert.match(summary, /Production files changed: none/);
});

test('versioned oracle store refuses silent overwrite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'md-oracle-'));
  const document = {metadata: {obsidianVersion: '1.2.3'}, observations: []};
  const filename = writeVersionedOracle(directory, document);
  assert.equal(path.basename(filename), 'obsidian-1.2.3.json');
  assert.throws(() => writeVersionedOracle(directory, document), /not overwritten/);
});

test('JSON CLI generates the same deterministic corpus', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cli-'));
  const destination = path.join(directory, 'scenarios.json');
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'runner/cli.js'),
    'generate',
    '--families', 'thematic-break',
    '--output', destination
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const generated = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.ok(generated.scenarioCount > 100);
  assert.ok(generated.scenarios.every((scenario) => scenario.syntaxFamily === 'thematic-break'));
});

test('JSON CLI exposes the bounded v0.3-valid certification random profile', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cert-random-cli-'));
  const destination = path.join(directory, 'certification-random.json');
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'runner/cli.js'),
    'generate',
    '--random-profile', 'v0.3-valid',
    '--random-only',
    '--output', destination
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const generated = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.equal(generated.profile, 'v0.3-valid');
  assert.equal(generated.count, 100);
  assert.equal(generated.corpusSha256,
    '6085a46a252f666a9f0ae3e60e9d649a797039c84500e8f385b86cf78db24868');
});

test('JSON CLI compares captures and emits both report artifacts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cli-report-'));
  const scenarioPath = path.join(directory, 'scenarios.json');
  const obsidianPath = path.join(directory, 'obsidian.json');
  const viewerPath = path.join(directory, 'viewer.json');
  const comparisonPath = path.join(directory, 'comparison.json');
  const matrixPath = path.join(directory, 'MARKDOWN_CONFORMANCE_MATRIX.md');
  const summaryPath = path.join(directory, 'MARKDOWN_CONFORMANCE_SUMMARY.md');
  const scenario = {
    id: 'cli.one', fixtureId: 'plain', syntaxFamily: 'paragraphs', mode: 'source',
    state: {active: true}, action: {id: 'inspect'}, requiredObservations: ['source', 'semantic']
  };
  fs.writeFileSync(scenarioPath, JSON.stringify({scenarios: [scenario]}));
  fs.writeFileSync(obsidianPath, JSON.stringify({observations: [
    {...observation('O1', 'A'), scenarioId: 'cli.one'}
  ]}));
  fs.writeFileSync(viewerPath, JSON.stringify({observations: [
    {...observation('V1', 'A'), scenarioId: 'cli.one'}
  ]}));
  const compare = spawnSync(process.execPath, [
    path.join(__dirname, 'runner/cli.js'), 'compare',
    '--scenarios', scenarioPath, '--obsidian', obsidianPath, '--viewer', viewerPath,
    '--output', comparisonPath
  ], {encoding: 'utf8'});
  assert.equal(compare.status, 0, compare.stderr);
  assert.equal(JSON.parse(fs.readFileSync(comparisonPath)).counts.MATCH, 1);
  const report = spawnSync(process.execPath, [
    path.join(__dirname, 'runner/cli.js'), 'report', '--comparisons', comparisonPath,
    '--format', 'both', '--matrix', matrixPath, '--summary', summaryPath
  ], {encoding: 'utf8'});
  assert.equal(report.status, 0, report.stderr);
  assert.match(fs.readFileSync(matrixPath, 'utf8'), /cli\.one/);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /MATCH: 1/);
});

test('raw normalization preserves capture provenance and rounds stable geometry only', () => {
  const normalized = normalizeObservation({
    scenarioId: 'geometry', evidenceLevel: 'V1', source: 'A', selection: {anchor: 1, focus: 1},
    semantic: {rootTypes: ['paragraph']}, geometry: {line: {height: 12.34567}}
  });
  assert.equal(normalized.geometry.line.height, 12.346);
  assert.equal(normalized.evidenceLevel, 'V1');
  assert.equal(normalized.source.text, 'A');
});
