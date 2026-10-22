import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import actionTraceComparison from '../actionTraceComparison.js';
import {
  CDP_MODIFIERS,
  dispatchTrustedAction,
  modifiersMask
} from './cdpTransport.mjs';
import {
  IsolationSafetyError,
  assertTemporaryRoot,
  copyReadOnlyIntoIsolation,
  createIsolatedRuntimeRoot,
  readExactFileObservation,
  removeIsolatedRuntimeRoot,
  writeIsolatedFile
} from './isolation.mjs';
import {
  buildRuntimeObservation,
  canonicalSourceFacts,
  compactActionTraceObservation,
  utf8FileBytes
} from './observationModel.mjs';
import { semanticObservationFromDom } from './semanticDomRuntime.mjs';
import { evaluateListLifecycleIntegrity } from './listObservationRuntime.mjs';
import {
  adapterOptions,
  parseArguments as parseRealRuntimeArguments,
  readScenarios,
  selectScenarios,
  usage as realRuntimeUsage
} from './realRuntimeCli.mjs';
import {
  ObsidianO1Adapter,
  obsidianListPresentationFromRuntime
} from './obsidianO1.mjs';
import {
  loadSequence,
  parseArguments as parseMinimizerArguments,
  transportUnavailable
} from './realFailureMinimizer.mjs';
import {
  VIEWER_V1_DEFAULTS,
  ViewerV1Adapter,
  installViewerSelectionHelpers,
  verifyPackagedViewerFreshness,
  viewerCaptureExpression,
  viewerLifecycleSourceMarkersFromRuntime,
  viewerListPresentationFromRuntime,
  viewerListLifecycleFailures,
  viewerSourceMarkerKind
} from './viewerV1.mjs';

const { compareActionTrace } = actionTraceComparison;

test('trusted action normalization covers generated input, shift, primary modifier, and sequence forms', async () => {
  const calls = [];
  const client = {
    typeText: async (text) => calls.push({ type: 'typeText', text }),
    insertText: async (text) => calls.push({ type: 'insertText', text }),
    dispatchKey: async (key, options) => calls.push({ type: 'key', key, options }),
    click: async (options) => calls.push({ type: 'click', options }),
    drag: async (start, end, options) => calls.push({ type: 'drag', start, end, options })
  };
  await dispatchTrustedAction(client, {
    type: 'sequence',
    steps: [
      { type: 'input', command: 'insertText', text: 'x' },
      { type: 'keyboard', key: 'Enter', shiftKey: true },
      { type: 'keyboard', key: 'z', modifiers: ['platform-primary', 'shift'] }
    ]
  }, { platform: 'darwin' });
  assert.deepEqual(calls[0], { type: 'typeText', text: 'x' });
  assert.equal(calls[1].key, 'Enter');
  assert.equal(calls[1].options.modifiers, CDP_MODIFIERS.SHIFT);
  assert.equal(calls[2].key, 'z');
  assert.equal(
    calls[2].options.modifiers,
    CDP_MODIFIERS.META | CDP_MODIFIERS.SHIFT
  );
  assert.equal(modifiersMask(['command', 'shift']), CDP_MODIFIERS.META | CDP_MODIFIERS.SHIFT);
});

test('Viewer scenarios default to fresh page isolation within each runtime batch', () => {
  const isolated = new ViewerV1Adapter({ requireFreshPackage: false });
  const explicitlyReused = new ViewerV1Adapter({
    requireFreshPackage: false,
    reusePageAcrossScenarios: true
  });
  assert.equal(isolated.options.reusePageAcrossScenarios, false);
  assert.equal(explicitlyReused.options.reusePageAcrossScenarios, true);
});

test('isolated runtime roots validate descendants, exact bytes, read-only copies, and token teardown', async () => {
  const isolation = await createIsolatedRuntimeRoot('adapter-test');
  try {
    const source = path.join(isolation.vault, 'source.asar');
    await writeIsolatedFile(isolation.root, source, 'effective-runtime', { encoding: 'utf8' });
    const copied = path.join(isolation.profile, 'runtime.asar');
    await copyReadOnlyIntoIsolation(isolation.root, source, copied);
    const copiedMode = (await stat(copied)).mode;
    assert.equal(copiedMode & 0o222, 0);
    const bytes = await readExactFileObservation(isolation.root, copied);
    assert.equal(bytes.utf8, 'effective-runtime');
    assert.equal(Buffer.from(bytes.base64, 'base64').toString('utf8'), 'effective-runtime');
    await assert.rejects(
      () => assertTemporaryRoot(process.cwd(), { requireSentinel: true }),
      IsolationSafetyError
    );
  } finally {
    await removeIsolatedRuntimeRoot(isolation.root, { expectedToken: isolation.sentinel.token });
  }
  await assert.rejects(() => stat(isolation.root), { code: 'ENOENT' });
});

test('shared observation includes exact byte aliases and one product-neutral semantic schema', () => {
  const source = '> A\r\n> B\n';
  const facts = canonicalSourceFacts(source);
  assert.equal(facts.physicalLineCount, 3);
  assert.equal(facts.lineEndings.crlf, 1);
  assert.equal(facts.lineEndings.lf, 1);
  assert.equal(facts.maximumQuoteDepth, 1);
  const semantic = {
    rootTypes: ['blockquote'],
    nodes: [{ path: '0', type: 'blockquote', quoteDepth: 1, listDepth: 0 }],
    typeCounts: { blockquote: 1 },
    maximumQuoteDepth: 1,
    maximumListDepth: 0
  };
  const observation = buildRuntimeObservation({
    scenarioId: 'unit.shared-schema',
    evidenceLevel: 'O1',
    source,
    selection: { anchor: 2, focus: 2 },
    runtime: { semantic, visibleText: 'A\nB', markers: [] }
  });
  assert.deepEqual(observation.semantic, semantic);
  assert.equal(observation.visibleText, 'A\nB');
  assert.equal(observation.sourceBytesBase64, observation.fileBytes.base64);
  assert.equal(observation.fileBytesBase64, observation.fileBytes.base64);
});

test('semantic DOM list ordinals honor explicit li[value] ownership', () => {
  const element = (tagName, attributes = {}) => ({
    tagName,
    children: [],
    parentElement: null,
    getAttribute(name) { return attributes[name] ?? null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name); },
    querySelector() { return null; }
  });
  const root = element('DIV');
  const list = element('OL', { start: '4' });
  const first = element('LI');
  const second = element('LI', { value: '19' });
  root.children.push(list);
  list.parentElement = root;
  list.children.push(first, second);
  first.parentElement = list;
  second.parentElement = list;

  const semantic = semanticObservationFromDom(root);
  assert.deepEqual(
    semantic.nodes.filter(({ type }) => type === 'listItem').map(({ ordinal }) => ordinal),
    [4, 19]
  );
});

test('compact action observations retain exact file authority and integrity without repeated runtime bulk', () => {
  const source = '> A';
  const observation = buildRuntimeObservation({
    scenarioId: 'trace.compact',
    evidenceLevel: 'V1',
    source,
    fileBytes: utf8FileBytes(source, { kind: 'canonical-markdown-body-utf8' }),
    selection: { anchor: source.length, focus: source.length },
    runtime: {
      semantic: { rootTypes: ['blockquote'] },
      markers: [{ kind: 'quote', text: '>', visible: true }],
      presentationFacts: { quote: { depth: 1 } },
      visibleText: 'A'
    },
    metadata: {
      adapter: 'viewer-v1',
      consistency: { currentPage: true, dom: true },
      packageFreshness: { asarSha256: 'package-sha', checked: [{ repeated: true }] }
    },
    raw: {
      domSource: source,
      processLog: 'large repeated process log'
    }
  });
  const persisted = Buffer.from(JSON.stringify({ markdownBody: source }), 'utf8');
  observation.persistedFileBytes = {
    kind: 'actual-viewer-page-json',
    byteLength: persisted.byteLength,
    base64: persisted.toString('base64'),
    sha256: 'persisted-sha'
  };
  observation.persistedFileBytesBase64 = observation.persistedFileBytes.base64;
  observation.consistency = { currentPage: true, dom: true };
  observation.integrityFailure = [];

  const compact = compactActionTraceObservation(observation);
  assert.equal(compact.fileBytes.base64, observation.fileBytes.base64);
  assert.equal(compact.persistedFileBytes.base64, observation.persistedFileBytes.base64);
  assert.deepEqual(compact.integrityFailure, []);
  assert.deepEqual(compact.consistency, observation.consistency);
  assert.equal(compact.raw.domSource, source);
  assert.deepEqual(compact.raw.runtime.presentationFacts, { quote: { depth: 1 } });
  assert.equal(compact.raw.processLog, undefined);
  assert.equal(compact.metadata.packageAsarSha256, 'package-sha');
  assert.equal(compact.metadata.packageFreshness, undefined);
});

test('real adapters use timing-preserving action captures and one final persisted capture', async () => {
  const actions = [
    { type: 'input', command: 'insertText', text: 'B' },
    { type: 'input', command: 'insertText', text: 'C' }
  ];
  const results = new Map();
  const scenario = {
    id: 'trace.real-adapters',
    fixtureId: 'plain',
    syntaxFamily: 'paragraphs',
    mode: 'source',
    initialSource: 'A',
    actions
  };
  for (const [label, Adapter, evidenceLevel] of [
    ['Obsidian', ObsidianO1Adapter, 'O1'],
    ['Viewer', ViewerV1Adapter, 'V1']
  ]) {
    const adapter = new Adapter({ traceActions: true, requireFreshPackage: false });
    let source = 'A';
    let captureCount = 0;
    let traceCaptureCount = 0;
    adapter.setup = async () => {};
    adapter.dispatch = async (action) => { source += action.text || ''; };
    const observationFor = (scenario, { trace = false } = {}) => {
      const observation = buildRuntimeObservation({
        scenarioId: scenario.id,
        evidenceLevel,
        source,
        fileBytes: utf8FileBytes(source, {
          kind: trace
            ? `${evidenceLevel.toLowerCase()}-timing-preserving-action-trace`
            : evidenceLevel === 'O1' ? 'actual-markdown-file' : 'canonical-markdown-body-utf8'
        }),
        selection: { anchor: source.length, focus: source.length },
        runtime: {
          semantic: { rootTypes: ['paragraph'] },
          presentationFacts: { paragraph: { present: true } }
        },
        metadata: evidenceLevel === 'O1'
          ? {
              adapter: 'obsidian-o1',
              fileEditorMatch: trace ? undefined : true,
              actionTraceCapture: trace ? { timingPreserving: true } : undefined
            }
          : {
              adapter: 'viewer-v1',
              consistency: { currentPage: true, dom: true },
              actionTraceCapture: trace ? { timingPreserving: true } : undefined
            },
        raw: evidenceLevel === 'O1'
          ? { editorSource: source, processLog: 'omit from steps' }
          : { domSource: source, processLog: 'omit from steps' }
      });
      if (evidenceLevel === 'V1' && !trace) {
        const persisted = Buffer.from(JSON.stringify({ markdownBody: source }), 'utf8');
        observation.persistedFileBytes = {
          kind: 'actual-viewer-page-json',
          byteLength: persisted.byteLength,
          base64: persisted.toString('base64'),
          sha256: `persisted-${captureCount}`
        };
        observation.persistedFileBytesBase64 = observation.persistedFileBytes.base64;
        observation.consistency = { currentPage: true, dom: true };
        observation.integrityFailure = [];
      }
      return observation;
    };
    adapter.captureActionTrace = async (capturedScenario) => {
      traceCaptureCount += 1;
      const observation = observationFor(capturedScenario, { trace: true });
      if (evidenceLevel === 'V1') {
        observation.consistency = { currentPage: true, dom: true };
        observation.integrityFailure = [];
      }
      return observation;
    };
    adapter.capture = async (capturedScenario) => {
      captureCount += 1;
      return observationFor(capturedScenario);
    };

    const result = await adapter.runScenario(scenario);
    results.set(evidenceLevel, result);
    assert.equal(traceCaptureCount, actions.length, `${label} should trace each action`);
    assert.equal(captureCount, 1, `${label} should perform one final persisted capture`);
    assert.equal(result.source, 'ABC');
    assert.equal(result.actionTrace.length, actions.length);
    assert.deepEqual(result.actionTrace.map(({ index }) => index), [0, 1]);
    assert.deepEqual(result.actionTrace.map(({ action }) => action), actions);
    assert.deepEqual(result.actionTrace.map(({ observation: step }) => step.source), ['AB', 'ABC']);
    assert.equal(result.actionTrace[1].observation.fileBytes.base64,
      Buffer.from('ABC').toString('base64'));
    assert.equal(result.actionTrace[1].observation.raw.processLog, undefined);
    assert.equal(result.metadata.actionTrace.complete, true);
    assert.equal(result.metadata.actionTrace.finalObservationReused, false);
    assert.equal(result.metadata.actionTrace.timingPreservingIntermediateCapture, true);
    assert.equal(result.actionTrace[1].observation.metadata.actionTraceCapture.timingPreserving, true);
    if (evidenceLevel === 'O1') {
      assert.equal(result.actionTrace[1].observation.raw.editorSource, 'ABC');
    } else {
      assert.deepEqual(result.actionTrace[1].observation.integrityFailure, []);
      assert.equal(result.actionTrace[1].observation.persistedFileBytes, undefined);
      assert.equal(result.actionTrace[1].observation.raw.domSource, 'ABC');
    }
  }
  const compared = compareActionTrace(scenario, results.get('O1'), results.get('V1'));
  assert.equal(compared.status, 'MATCH');
  assert.equal(compared.alignedStepCount, actions.length);
});

test('real adapter action tracing remains opt-in', async () => {
  for (const Adapter of [ObsidianO1Adapter, ViewerV1Adapter]) {
    const adapter = new Adapter({ requireFreshPackage: false });
    let captureCount = 0;
    adapter.setup = async () => {};
    adapter.dispatch = async () => {};
    adapter.capture = async (scenario) => {
      captureCount += 1;
      return buildRuntimeObservation({
        scenarioId: scenario.id,
        evidenceLevel: Adapter === ObsidianO1Adapter ? 'O1' : 'V1',
        source: 'A',
        selection: { anchor: 1, focus: 1 },
        runtime: { semantic: { rootTypes: ['paragraph'] } }
      });
    };
    const result = await adapter.runScenario({
      id: 'trace.opt-in',
      initialSource: 'A',
      actions: [{ type: 'keyboard', key: 'ArrowLeft' }, { type: 'keyboard', key: 'ArrowRight' }]
    });
    assert.equal(captureCount, 1);
    assert.equal(result.actionTrace, undefined);
  }
});

test('real-runtime CLI wires --trace-actions into both adapter types', () => {
  const parsed = parseRealRuntimeArguments([
    'run', '--adapter', 'both', '--trace-actions', '--scenarios', 'scenarios.json'
  ]);
  assert.equal(parsed.options['trace-actions'], true);
  assert.equal(adapterOptions('obsidian', parsed.options).traceActions, true);
  assert.equal(adapterOptions('viewer', parsed.options).traceActions, true);
  assert.match(realRuntimeUsage(), /--trace-actions/);
});

test('real-runtime corpus selection supports deterministic per-family slices', () => {
  const scenarios = [
    { id: 'a1', syntaxFamily: 'a' },
    { id: 'a2', syntaxFamily: 'a' },
    { id: 'b1', syntaxFamily: 'b' },
    { id: 'b2', syntaxFamily: 'b' }
  ];
  assert.deepEqual(
    selectScenarios(scenarios, { 'per-family': '1' }).map(({ id }) => id),
    ['a1', 'b1']
  );
  assert.deepEqual(
    selectScenarios(scenarios, { families: 'b', limit: '1' }).map(({ id }) => id),
    ['b1']
  );
  const detailed = [
    { id: 's1', syntaxFamily: 'a', mode: 'source', action: { id: 'inspect' } },
    { id: 's2', syntaxFamily: 'a', mode: 'reading', action: { id: 'inspect' } },
    { id: 's3', syntaxFamily: 'a', mode: 'source', action: { id: 'enter' } }
  ];
  assert.deepEqual(selectScenarios(detailed, {
    modes: 'source',
    actions: 'inspect'
  }).map(({ id }) => id), ['s1']);
  assert.deepEqual(selectScenarios(detailed, { ids: 's3,s1' }).map(({ id }) => id), ['s1', 's3']);
});

test('real-runtime reader accepts a root certification sequences document', async () => {
  const isolation = await createIsolatedRuntimeRoot('certification-sequences-test');
  try {
    const filename = path.join(isolation.root, 'sequences.json');
    await writeIsolatedFile(isolation.root, filename, JSON.stringify({
      sequences: [{ id: 'certification.one', actions: [] }]
    }), { encoding: 'utf8' });
    const sequences = await readScenarios(filename, 'random');
    assert.deepEqual(sequences.map(({ id }) => id), ['certification.one']);
  } finally {
    await removeIsolatedRuntimeRoot(isolation.root, { expectedToken: isolation.sentinel.token });
  }
});

test('Obsidian scenarios default to fresh editor history isolation', () => {
  const adapter = new ObsidianO1Adapter();
  assert.equal(adapter.options.fastSetup, false);
});

test('Obsidian list capture does not coerce null ordinals to ordered zero', async () => {
  const source = await readFile(new URL('./obsidianO1.mjs', import.meta.url), 'utf8');
  assert.match(
    source,
    /ordered: node\.ordinal != null && Number\.isFinite\(Number\(node\.ordinal\)\)/
  );
  assert.match(
    source,
    /node\.ordinal != null\s*&& Number\.isFinite\(Number\(node\.ordinal\)\)/
  );
});

test('Viewer capture classifies marker-only syntax from the closest quote container', () => {
  const capture = viewerCaptureExpression();
  assert.match(
    capture,
    /closest\?\.\('\.markdown-page-quote-source-line,\.markdown-page-quote'\)/
  );
  assert.match(capture, /itemPath: sourceItem\.path/);
  assert.match(capture, /semanticItemPath: astItem\?\.path \?\? semanticItem\?\.path \?\? null/);
  assert.match(capture, /: 'unordered-bullet'/);
  assert.match(capture, /const listProjection = \(function viewerListPresentationFromRuntime/);
  assert.match(capture,
    /const lifecycleSourceMarkers = \(function viewerLifecycleSourceMarkersFromRuntime/);
  assert.match(capture, /marker\.editingListPrefix === true/);
  assert.match(capture, /marker\.editingListToken === true/);
  assert.match(capture, /sourceMarker\?\.listRecognitionOnly !== true/);
  assert.match(capture, /source\.slice\(item\.markerStart, item\.markerEnd\) === item\.rawMarker/);
  assert.match(capture, /semanticSourceStart: astSourceStart/);
  assert.match(capture, /markdownPageModel\?\.parseMarkdownDocument/);
  assert.match(capture, /const lifecycleMarkers = \[/);
  assert.match(capture, /const lifecycleIntegrity =/);
  assert.match(capture, /ownerSourceStart: marker\.ownerSourceStart/);
  assert.match(capture, /presentationOnly: Boolean\(sourceItem && !astItem\)/);
  assert.equal(capture.includes('!/^[+-]?\\d+$/.test'), true);
  assert.doesNotMatch(capture, /semanticListItems\[index\]/);
  assert.doesNotMatch(capture, /markers\.filter\(\(marker\) => marker\.kind === 'list'\)/);
  assert.equal(VIEWER_V1_DEFAULTS.freshnessFiles.includes('public/styles.css'), true);
  assert.equal(VIEWER_V1_DEFAULTS.freshnessFiles.includes('public/index.html'), true);
  assert.equal(VIEWER_V1_DEFAULTS.freshnessFiles.includes('desktop/nativeContextMenu.js'), true);
  for (const relativePath of [
    'forge.config.js',
    'server/hnTextPage.js',
    'public/structuredTextCount.js',
    'public/hnText.js',
    'public/hnListNumbering.js',
    'public/hnStructureIndex.js',
    'public/hnListIndex.js',
    'public/hnListCommands.js',
    'public/js/hnPageDocumentSession.js',
    'public/js/hnTextPageView.js',
    'public/js/structuredTextPageShell.js',
    'public/js/workspaceState.js'
  ]) {
    assert.equal(
      VIEWER_V1_DEFAULTS.freshnessFiles.includes(relativePath),
      true,
      `packaged freshness must cover ${relativePath}`
    );
  }
});

test('Viewer admits exact AST-owned list markers without editing-state CSS flags', () => {
  const source = '1. A\n2.   1. C\n    1. D';
  const astItems = [
    { path: '0', sourceStart: 0, sourceEnd: 4, markerStart: 0, markerEnd: 2,
      rawMarker: '1.', lexicalOrdinal: 1, checked: null },
    { path: '1', sourceStart: 5, sourceEnd: 23, markerStart: 5, markerEnd: 7,
      rawMarker: '2.', lexicalOrdinal: 2, checked: null },
    { path: '1.0', parentPath: '1', sourceStart: 10, sourceEnd: 23,
      markerStart: 10, markerEnd: 12, rawMarker: '1.', lexicalOrdinal: 1, checked: null }
  ];
  const sourceItems = [{
    path: '1.0', parentPath: '1', physicalDepth: 2, rawMarker: '1.', ordinal: 1,
    markerRange: { start: 19, end: 21 }
  }];
  const box = { left: 10, top: 20, right: 20, bottom: 38, width: 10, height: 18 };
  const result = viewerLifecycleSourceMarkersFromRuntime({
    source,
    astItems,
    sourceItems,
    markers: [
      {
        markerId: 'same-line', text: '1. ', sourceStart: 10, sourceEnd: 13,
        ownerSourceStart: 10, ownerSourceEnd: 23, visible: true, rect: box,
        kind: 'list',
        editingListPrefix: false, editingListToken: false, exitedListMarker: false
      },
      {
        markerId: 'absorbed-physical', text: '1. ', sourceStart: 19, sourceEnd: 22,
        ownerSourceStart: 10, ownerSourceEnd: 23, visible: true, rect: box,
        kind: 'syntax',
        editingListPrefix: false, editingListToken: false, exitedListMarker: false
      }
    ]
  });

  assert.equal(result.length, 1);
  assert.deepEqual({
    astSourceStart: result[0].astSourceStart,
    effective: result[0].effective,
    ownerSourceStart: result[0].ownerSourceStart,
    tokenStart: result[0].tokenStart,
    tokenEnd: result[0].tokenEnd
  }, {
    astSourceStart: 10,
    effective: true,
    ownerSourceStart: 10,
    tokenStart: 10,
    tokenEnd: 12
  });
});

test('Viewer classifies a list prefix inside a quote as a list marker', () => {
  const visited = [];
  const marker = {
    closest(selector) {
      visited.push(selector);
      if (selector === '.markdown-page-list-prefix') return { className: 'markdown-page-list-prefix' };
      if (selector === '.markdown-page-quote-source-line,.markdown-page-quote') {
        return { className: 'markdown-page-quote' };
      }
      return null;
    }
  };
  assert.equal(viewerSourceMarkerKind(marker), 'list');
  assert.deepEqual(visited, ['.markdown-page-list-prefix']);

  const markers = viewerLifecycleSourceMarkersFromRuntime({
    source: '> 1. A',
    astItems: [{
      path: '0', sourceStart: 2, sourceEnd: 6, markerStart: 2, markerEnd: 4,
      rawMarker: '1.', lexicalOrdinal: 1, checked: null
    }],
    sourceItems: [],
    markers: [{
      markerId: 'quoted-list', kind: viewerSourceMarkerKind(marker), text: '1. ',
      sourceStart: 2, sourceEnd: 5, ownerSourceStart: 2, ownerSourceEnd: 6,
      visible: true, rect: { left: 1, top: 1, right: 10, bottom: 19, width: 9, height: 18 },
      editingListPrefix: false, editingListToken: false, exitedListMarker: false
    }]
  });
  assert.equal(markers.length, 1);
  assert.equal(markers[0].astSourceStart, 2);
  assert.equal(markers[0].effective, true);
});

test('Viewer classifies a detached explicit list editing marker as list syntax', () => {
  const classes = new Set(['markdown-source-marker', 'markdown-list-editing-prefix']);
  const marker = {
    classList: { contains: (className) => classes.has(className) },
    closest: () => null
  };
  assert.equal(viewerSourceMarkerKind(marker), 'list');

  classes.delete('markdown-list-editing-prefix');
  assert.equal(viewerSourceMarkerKind(marker), 'syntax');
});

test('Viewer owns task-prefixed source spans while the checkbox stays effective', () => {
  const rect = { left: 10, top: 20, right: 22, bottom: 38, width: 12, height: 18 };
  for (const { box, checked } of [
    { box: '[ ]', checked: false },
    { box: '[x]', checked: true }
  ]) {
    const source = `- ${box} Task`;
    const astItems = [{
      path: '0', parentPath: null, parentSourceStart: null,
      sourceStart: 0, sourceEnd: source.length, markerStart: 0, markerEnd: 1,
      rawMarker: '-', lexicalOrdinal: null, checked, listDepth: 1, ordered: false
    }];
    const semanticItems = [{
      path: '0', parentPath: null, parentSourceStart: null,
      sourceStart: 0, sourceEnd: source.length, checked, listDepth: 1, ordered: false,
      nativeMarker: { rendered: false }, rect
    }];
    const capturedMarkers = [{
      markerId: `task-prefix-${box}`, kind: 'list', text: `- ${box} `,
      sourceStart: 0, sourceEnd: 6, ownerSourceStart: 0, ownerSourceEnd: source.length,
      visible: true, rect,
      editingListPrefix: false, editingListToken: false, exitedListMarker: false
    }];
    const sourceMarkers = viewerLifecycleSourceMarkersFromRuntime({
      source, astItems, sourceItems: [], markers: capturedMarkers
    });

    assert.equal(sourceMarkers.length, 1);
    assert.equal(sourceMarkers[0].astSourceStart, 0);
    assert.equal(sourceMarkers[0].displayedMarker, '-');
    assert.equal(sourceMarkers[0].effective, false);

    const projection = viewerListPresentationFromRuntime({
      source,
      sourceItems: [{
        path: '0', parentPath: null, sourceOrder: 0,
        line: { index: 0, start: 0, end: source.length },
        markerRange: { start: 0, end: 1 }, rawMarker: '-', ordinal: null,
        kind: 'unordered', quoteDepth: 0
      }],
      astItems,
      semanticItems,
      markers: capturedMarkers,
      mode: 'live-preview', selection: null, editorActive: false
    });
    assert.equal(projection.items[0].displayedMarker, '-');
    assert.equal(projection.items[0].markerOwner, 'source-marker');

    const integrity = evaluateListLifecycleIntegrity({
      astAvailable: true,
      astItems,
      sourceItems: [],
      semanticItems,
      markers: sourceMarkers.concat({
        markerId: `task-checkbox-${box}`,
        kind: 'task-checkbox',
        astSourceStart: 0,
        ownerSourceStart: 0,
        ownerSourceEnd: source.length,
        displayedMarker: box,
        effective: true,
        rect,
        geometrySource: 'task-checkbox-element'
      })
    });
    assert.equal(integrity.valid, true, JSON.stringify(integrity.violations));
  }
});

test('Viewer rejects marker impostors and retains visible ownerless list residue', () => {
  const source = '1. A';
  const astItems = [{
    path: '0', parentPath: null, parentSourceStart: null,
    sourceStart: 0, sourceEnd: 4, markerStart: 0, markerEnd: 2,
    rawMarker: '1.', lexicalOrdinal: 1, checked: null, listDepth: 1, ordered: true
  }];
  const rect = { left: 10, top: 20, right: 20, bottom: 38, width: 10, height: 18 };
  const markers = viewerLifecycleSourceMarkersFromRuntime({
    source,
    astItems,
    sourceItems: [],
    markers: [
      { markerId: 'quote-impostor', kind: 'quote', text: '1. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0, rect },
      { markerId: 'syntax-impostor', kind: 'syntax', text: '1. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0, rect },
      { markerId: 'wrong-token', kind: 'list', text: '9. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0, rect,
        editingListPrefix: false, editingListToken: false, exitedListMarker: false },
      { markerId: 'correct-token', kind: 'list', text: '1. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0, rect,
        editingListPrefix: false, editingListToken: false, exitedListMarker: false },
      { markerId: 'range-less-residue', kind: 'list', text: '9. ', visible: true,
        sourceStart: null, sourceEnd: null, ownerSourceStart: null, rect,
        editingListPrefix: false, editingListToken: false, exitedListMarker: false },
      { markerId: 'orphan-residue', kind: 'list', text: '2. ', visible: true,
        sourceStart: 5, sourceEnd: 8, ownerSourceStart: 5, rect,
        editingListPrefix: false, editingListToken: false, exitedListMarker: false },
      { markerId: 'bogus-residue', kind: 'list', text: 'bogus', visible: true,
        sourceStart: 9, sourceEnd: 14, ownerSourceStart: 9, rect,
        editingListPrefix: false, editingListToken: false, exitedListMarker: false }
    ]
  });

  assert.deepEqual(markers.map((marker) => ({
    markerId: marker.markerId,
    astSourceStart: marker.astSourceStart,
    displayedMarker: marker.displayedMarker,
    effective: marker.effective
  })), [
    { markerId: 'wrong-token-owner-0', astSourceStart: null,
      displayedMarker: '9.', effective: true },
    { markerId: 'correct-token-owner-0', astSourceStart: 0,
      displayedMarker: '1.', effective: true },
    { markerId: 'range-less-residue-owner-0', astSourceStart: null,
      displayedMarker: '9.', effective: true },
    { markerId: 'orphan-residue-owner-0', astSourceStart: null,
      displayedMarker: '2.', effective: true },
    { markerId: 'bogus-residue-owner-0', astSourceStart: null,
      displayedMarker: 'bogus', effective: true }
  ]);

  const integrity = evaluateListLifecycleIntegrity({
    astAvailable: true,
    astItems,
    sourceItems: [],
    semanticItems: [{
      sourceStart: 0, sourceEnd: 4, parentSourceStart: null,
      listDepth: 1, ordered: true, rect
    }],
    markers
  });
  assert.equal(integrity.valid, false);
  assert.deepEqual(integrity.violations.filter(({ code }) => (
    code === 'orphan-effective-list-marker'
  )).map(({ markerId }) => markerId), [
    'wrong-token-owner-0',
    'range-less-residue-owner-0',
    'orphan-residue-owner-0',
    'bogus-residue-owner-0'
  ]);

  const projection = viewerListPresentationFromRuntime({
    source,
    sourceItems: [{
      path: '0', parentPath: null, sourceOrder: 0,
      line: { index: 0, start: 0, end: 4 },
      markerRange: { start: 0, end: 2 }, rawMarker: '1.', ordinal: 1,
      kind: 'ordered', quoteDepth: 0
    }],
    astItems,
    semanticItems: [{
      path: '0', parentPath: null, sourceStart: 0, sourceEnd: 4,
      listDepth: 1, ordinal: 1, checked: null, nativeMarker: { rendered: false }
    }],
    markers: [
      { markerId: 'quote-impostor', kind: 'quote', text: '1. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0 },
      { markerId: 'wrong-token', kind: 'list', text: '9. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0 }
    ],
    mode: 'live-preview', selection: null, editorActive: false
  });
  assert.deepEqual({
    recognized: projection.items[0].recognized,
    displayedMarker: projection.items[0].displayedMarker,
    markerVisible: projection.items[0].markerVisible,
    markerOwner: projection.items[0].markerOwner
  }, {
    recognized: true,
    displayedMarker: null,
    markerVisible: false,
    markerOwner: 'none'
  });
});

test('Viewer list projection maps parser-absorbed physical markers to their semantic owner', () => {
  const source = '1. A\n2.   1. C\n    1. D';
  const sourceItems = [{
    path: '1.0', parentPath: '1', sourceOrder: 2,
    line: { index: 2, start: 15, end: 23 },
    markerRange: { start: 19, end: 21 }, rawMarker: '1.', ordinal: 1,
    kind: 'ordered', quoteDepth: 0
  }];
  const projection = viewerListPresentationFromRuntime({
    source,
    sourceItems,
    astItems: [{
      path: '1.0', parentPath: '1', sourceStart: 10, sourceEnd: 23,
      markerStart: 10, markerEnd: 12, rawMarker: '1.', listDepth: 2
    }],
    semanticItems: [{
      path: '1.0', parentPath: '1', sourceStart: 10, sourceEnd: 23,
      listDepth: 2, ordinal: 1, checked: null,
      nativeMarker: { rendered: true }
    }],
    markers: [
      {
        markerId: 'semantic-owner', kind: 'list', text: '1. ',
        sourceStart: 10, sourceEnd: 13,
        ownerSourceStart: 10, ownerSourceEnd: 23, visible: false,
        listRecognitionOnly: false
      },
      {
        markerId: 'absorbed-physical', kind: 'syntax', text: '1. ',
        sourceStart: 19, sourceEnd: 22,
        ownerSourceStart: 10, ownerSourceEnd: 23, visible: false,
        listRecognitionOnly: false
      }
    ],
    mode: 'live-preview',
    selection: { anchor: 7, focus: 7 },
    editorActive: true
  });

  assert.deepEqual(projection.items[0], {
    itemPath: '1.0',
    parentPath: '1',
    semanticItemPath: '1.0',
    semanticParentPath: '1',
    semanticSourceStart: 10,
    sourceOrder: 2,
    lineIndex: 2,
    markerStart: 19,
    markerEnd: 21,
    rawMarker: '1.',
    rawOrdinal: 1,
    kind: 'ordered',
    listDepth: 2,
    quoteDepth: 0,
    recognized: true,
    checked: null,
    displayedMarker: '1.',
    displayedOrdinal: 1,
    markerVisible: true,
    markerOwner: 'source-marker',
    markerPaintOwner: 'native-list',
    active: false
  });
});

test('Viewer projection reports the observed AST fallback marker, not a different physical token', () => {
  const projection = viewerListPresentationFromRuntime({
    source: '7. C\n    3. D',
    sourceItems: [{
      path: '0', parentPath: null, sourceOrder: 0,
      line: { index: 1, start: 5, end: 13 },
      markerRange: { start: 9, end: 11 }, rawMarker: '3.', ordinal: 3,
      kind: 'ordered', quoteDepth: 0
    }],
    astItems: [{
      path: '0', parentPath: null, sourceStart: 0, sourceEnd: 13,
      markerStart: 0, markerEnd: 2, rawMarker: '7.', listDepth: 1
    }],
    semanticItems: [{
      path: '0', parentPath: null, sourceStart: 0, sourceEnd: 13,
      listDepth: 1, ordinal: 7, checked: null, nativeMarker: { rendered: false }
    }],
    markers: [
      {
        markerId: 'ast-owner', kind: 'list', text: '7. ', visible: true,
        sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0, ownerSourceEnd: 13,
        listRecognitionOnly: false
      },
      {
        markerId: 'physical-syntax', kind: 'syntax', text: '3. ', visible: true,
        sourceStart: 9, sourceEnd: 12, ownerSourceStart: 0, ownerSourceEnd: 13,
        listRecognitionOnly: false
      }
    ],
    mode: 'live-preview', selection: null, editorActive: false
  });

  assert.equal(projection.items[0].rawMarker, '3.');
  assert.equal(projection.items[0].rawOrdinal, 3);
  assert.equal(projection.items[0].displayedMarker, '7.');
  assert.equal(projection.items[0].displayedOrdinal, 7);
  assert.equal(projection.items[0].markerOwner, 'source-marker');
});

test('Viewer projection hides an exited marker subtree without weakening lifecycle integrity', () => {
  const source = '1. A\n2.\n    1. C';
  const sourceItems = [
    {
      path: '0', parentPath: null, sourceOrder: 0,
      line: { index: 0, start: 0, end: 4 },
      markerRange: { start: 0, end: 2 }, rawMarker: '1.', ordinal: 1,
      kind: 'ordered', quoteDepth: 0, physicalDepth: 1
    },
    {
      path: '1', parentPath: null, sourceOrder: 1,
      line: { index: 1, start: 5, end: 7 },
      markerRange: { start: 5, end: 7 }, rawMarker: '2.', ordinal: 2,
      kind: 'ordered', quoteDepth: 0, physicalDepth: 1
    },
    {
      path: '1.0', parentPath: '1', sourceOrder: 2,
      line: { index: 2, start: 8, end: 16 },
      markerRange: { start: 12, end: 14 }, rawMarker: '1.', ordinal: 1,
      kind: 'ordered', quoteDepth: 0, physicalDepth: 2
    }
  ];
  const astItems = [
    { path: '0', parentPath: null, parentSourceStart: null,
      sourceStart: 0, sourceEnd: 4, markerStart: 0, markerEnd: 2,
      rawMarker: '1.', lexicalOrdinal: 1, checked: null, listDepth: 1, ordered: true },
    { path: '1', parentPath: null, parentSourceStart: null,
      sourceStart: 5, sourceEnd: 16, markerStart: 5, markerEnd: 7,
      rawMarker: '2.', lexicalOrdinal: 2, checked: null, listDepth: 1, ordered: true },
    { path: '1.0', parentPath: '1', parentSourceStart: 5,
      sourceStart: 12, sourceEnd: 16, markerStart: 12, markerEnd: 14,
      rawMarker: '1.', lexicalOrdinal: 1, checked: null, listDepth: 2, ordered: true }
  ];
  const box = (top) => ({
    left: 10, top, right: 22, bottom: top + 18, width: 12, height: 18
  });
  const semanticItems = astItems.map((item, index) => ({
    path: item.path,
    parentPath: item.parentPath,
    parentSourceStart: item.parentSourceStart,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    listDepth: item.listDepth,
    ordered: true,
    ordinal: item.lexicalOrdinal,
    checked: null,
    nativeMarker: { rendered: false },
    rect: box(index * 24)
  }));
  const markers = [
    { markerId: 'normal', kind: 'list', text: '1. ', visible: true,
      sourceStart: 0, sourceEnd: 3, ownerSourceStart: 0, ownerSourceEnd: 4,
      editingListPrefix: true, exitedListMarker: false, rect: box(0) },
    { markerId: 'exited', kind: 'list', text: '2.', visible: true,
      sourceStart: 5, sourceEnd: 7, ownerSourceStart: 5, ownerSourceEnd: 16,
      editingListPrefix: false, exitedListMarker: true, rect: box(24) },
    { markerId: 'descendant', kind: 'list', text: '1. ', visible: true,
      sourceStart: 12, sourceEnd: 15, ownerSourceStart: 12, ownerSourceEnd: 16,
      editingListPrefix: false, exitedListMarker: false, rect: box(48) }
  ];

  const projection = viewerListPresentationFromRuntime({
    source, sourceItems, astItems, semanticItems, markers,
    selection: { anchor: 7, focus: 7 }, editorActive: true
  });
  assert.deepEqual(projection.items.map((item) => ({
    recognized: item.recognized,
    displayedMarker: item.displayedMarker,
    markerVisible: item.markerVisible,
    markerOwner: item.markerOwner
  })), [
    { recognized: true, displayedMarker: '1.', markerVisible: true,
      markerOwner: 'source-marker' },
    { recognized: false, displayedMarker: null, markerVisible: false,
      markerOwner: 'none' },
    { recognized: false, displayedMarker: null, markerVisible: false,
      markerOwner: 'none' }
  ]);

  const lifecycleMarkers = viewerLifecycleSourceMarkersFromRuntime({
    source, sourceItems, astItems, markers
  });
  const integrity = evaluateListLifecycleIntegrity({
    astAvailable: true, astItems, sourceItems, semanticItems,
    markers: lifecycleMarkers
  });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.violations));
  assert.equal(lifecycleMarkers.every((marker) => marker.effective), true);
});

test('Viewer projection limits plain active-line interruption to its following descendants', () => {
  const project = (plainLine) => {
    const source = `1. A\n${plainLine}\n    1. C`;
    const childLineStart = 6 + plainLine.length;
    const childMarkerStart = childLineStart + 4;
    const sourceItems = [
      {
        path: '0', parentPath: null, sourceOrder: 0,
        line: { index: 0, start: 0, end: 4 },
        markerRange: { start: 0, end: 2 }, rawMarker: '1.', ordinal: 1,
        kind: 'ordered', quoteDepth: 0
      },
      {
        path: '0.0', parentPath: '0', sourceOrder: 1,
        line: { index: 2, start: childLineStart, end: source.length },
        markerRange: { start: childMarkerStart, end: childMarkerStart + 2 },
        rawMarker: '1.', ordinal: 1, kind: 'ordered', quoteDepth: 0
      }
    ];
    const astItems = [
      { path: '0', parentPath: null, sourceStart: 0, sourceEnd: source.length,
        markerStart: 0, markerEnd: 2, rawMarker: '1.', listDepth: 1 },
      { path: '0.0', parentPath: '0', sourceStart: childMarkerStart,
        sourceEnd: source.length, markerStart: childMarkerStart,
        markerEnd: childMarkerStart + 2, rawMarker: '1.', listDepth: 2 }
    ];
    const semanticItems = astItems.map((item) => ({
      path: item.path, parentPath: item.parentPath,
      sourceStart: item.sourceStart, sourceEnd: item.sourceEnd,
      listDepth: item.listDepth, ordinal: 1, checked: null,
      nativeMarker: { rendered: false }
    }));
    return viewerListPresentationFromRuntime({
      source, sourceItems, astItems, semanticItems,
      markers: [
        { markerId: 'parent', kind: 'list', text: '1. ', visible: true,
          sourceStart: 0, sourceEnd: 3 },
        { markerId: 'child', kind: 'list', text: '1. ', visible: true,
          sourceStart: childMarkerStart, sourceEnd: childMarkerStart + 3 }
      ],
      selection: { anchor: 5 + plainLine.length, focus: 5 + plainLine.length },
      editorActive: true
    });
  };

  const interrupted = project('2');
  assert.deepEqual({
    recognized: interrupted.items[1].recognized,
    displayedMarker: interrupted.items[1].displayedMarker,
    markerOwner: interrupted.items[1].markerOwner
  }, { recognized: false, displayedMarker: null, markerOwner: 'none' });

  const blank = project('');
  assert.deepEqual({
    recognized: blank.items[1].recognized,
    displayedMarker: blank.items[1].displayedMarker,
    markerOwner: blank.items[1].markerOwner
  }, { recognized: true, displayedMarker: '1.', markerOwner: 'source-marker' });
});

test('Viewer projection does not reuse an absorbed parent marker on a second physical row', () => {
  const projection = viewerListPresentationFromRuntime({
    source: '1. A\n    1.',
    sourceItems: [
      { path: '0', parentPath: null, sourceOrder: 0,
        line: { index: 0, start: 0, end: 4 }, markerRange: { start: 0, end: 2 },
        rawMarker: '1.', ordinal: 1, kind: 'ordered', quoteDepth: 0 },
      { path: '0.0', parentPath: '0', sourceOrder: 1,
        line: { index: 1, start: 5, end: 11 }, markerRange: { start: 9, end: 11 },
        rawMarker: '1.', ordinal: 1, kind: 'ordered', quoteDepth: 0 }
    ],
    astItems: [{
      path: '0', parentPath: null, sourceStart: 0, sourceEnd: 11,
      markerStart: 0, markerEnd: 2, rawMarker: '1.', listDepth: 1
    }],
    semanticItems: [{
      path: '0', parentPath: null, sourceStart: 0, sourceEnd: 11,
      listDepth: 1, ordinal: 1, checked: null, nativeMarker: { rendered: false }
    }],
    markers: [
      { markerId: 'parent', kind: 'list', text: '1. ', visible: true,
        sourceStart: 0, sourceEnd: 3 },
      { markerId: 'absorbed', kind: 'syntax', text: '1.', visible: true,
        sourceStart: 9, sourceEnd: 11, editingListToken: true,
        listRecognitionOnly: true }
    ],
    selection: { anchor: 11, focus: 11 }, editorActive: true
  });

  assert.equal(projection.items[1].recognized, true);
  assert.equal(projection.items[1].displayedMarker, null);
  assert.equal(projection.items[1].displayedOrdinal, null);
  assert.equal(projection.items[1].markerVisible, false);
  assert.equal(projection.items[1].markerOwner, 'none');
});

test('Viewer projection reports a hidden canonical bullet when native paint is visible', () => {
  const projection = viewerListPresentationFromRuntime({
    source: '- A\n    - B',
    sourceItems: [{
      path: '0.0', parentPath: '0', sourceOrder: 1,
      line: { index: 1, start: 4, end: 11 }, markerRange: { start: 8, end: 9 },
      rawMarker: '-', ordinal: null, kind: 'unordered', quoteDepth: 0
    }],
    astItems: [{
      path: '0.0', parentPath: '0', sourceStart: 8, sourceEnd: 11,
      markerStart: 8, markerEnd: 9, rawMarker: '-', listDepth: 2
    }],
    semanticItems: [{
      path: '0.0', parentPath: '0', sourceStart: 8, sourceEnd: 11,
      listDepth: 2, ordinal: null, checked: null, nativeMarker: { rendered: true }
    }],
    markers: [{
      markerId: 'hidden-source', kind: 'list', text: '- ', visible: false,
      sourceStart: 8, sourceEnd: 10
    }],
    selection: { anchor: 3, focus: 3 }, editorActive: true
  });

  assert.equal(projection.items[0].displayedMarker, '-');
  assert.equal(projection.items[0].markerVisible, true);
  assert.equal(projection.items[0].markerOwner, 'source-marker');
  assert.equal(projection.items[0].markerPaintOwner, 'native-list');
});

test('Viewer recognizes a visible source-only list marker without inventing a semantic item', () => {
  const source = '1. A\n\n    1. B';
  const projection = viewerListPresentationFromRuntime({
    source,
    sourceItems: [{
      path: '0.0', parentPath: '0', sourceOrder: 1,
      line: { index: 2, start: 6, end: 14 },
      markerRange: { start: 10, end: 12 }, rawMarker: '1.', ordinal: 1,
      kind: 'ordered', quoteDepth: 0, physicalDepth: 2
    }],
    astItems: [],
    semanticItems: [],
    markers: [{
      markerId: 'source-only', kind: 'list', text: '1. ', visible: true,
      sourceStart: 10, sourceEnd: 13, ownerSourceStart: null,
      listRecognitionOnly: false
    }],
    selection: { anchor: 5, focus: 5 },
    editorActive: true
  });

  assert.deepEqual({
    recognized: projection.items[0].recognized,
    listDepth: projection.items[0].listDepth,
    semanticItemPath: projection.items[0].semanticItemPath,
    displayedMarker: projection.items[0].displayedMarker,
    markerOwner: projection.items[0].markerOwner
  }, {
    recognized: true,
    listDepth: 2,
    semanticItemPath: null,
    displayedMarker: '1.',
    markerOwner: 'source-marker'
  });
});

test('Viewer list lifecycle violations become stable internal integrity failure signatures', () => {
  assert.deepEqual(viewerListLifecycleFailures({}), []);
  const runtime = {
    presentationFacts: {
      list: {
        lifecycleIntegrity: {
          valid: false,
          violations: [
            { code: 'missing-effective-list-marker', sourceStart: 14 },
            { code: 'missing-effective-list-marker', sourceStart: 14 },
            { code: 'effective-marker-geometry-collision' }
          ]
        }
      }
    }
  };
  assert.deepEqual(viewerListLifecycleFailures(runtime, {
    syntaxFamily: 'plain-text'
  }), []);
  assert.deepEqual(viewerListLifecycleFailures(runtime, {
    syntaxFamily: 'ordered-lists'
  }), [
    'list-lifecycle:missing-effective-list-marker@14',
    'list-lifecycle:effective-marker-geometry-collision'
  ]);
});

test('Viewer trusted source clicks prefer exact collapsed-caret geometry', () => {
  const previousNode = globalThis.Node;
  const previousDocument = globalThis.document;
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11 };
  const textNode = {
    nodeType: 3,
    nodeValue: 'Beta',
    length: 4,
    parentElement: null
  };
  const root = {
    childNodes: [],
    querySelectorAll: () => mappedOwners,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 100 })
  };
  const owner = {
    nodeType: 1,
    dataset: { markdownSourceStart: '12', markdownSourceEnd: '16' },
    childNodes: [textNode],
    firstChild: textNode,
    parentElement: root,
    closest: () => null,
    matches: () => false,
    getBoundingClientRect: () => ({ left: 100, top: 10, width: 80, height: 20 })
  };
  textNode.parentElement = owner;
  const breakOwner = {
    nodeType: 1,
    dataset: { markdownSourceStart: '16', markdownSourceEnd: '17' },
    childNodes: [],
    parentNode: root,
    parentElement: root,
    closest: () => null,
    matches: (selector) => selector === 'br',
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
  };
  const hiddenGapText = {
    nodeType: 3,
    nodeValue: '\n    ',
    length: 5,
    parentElement: null
  };
  const hiddenGapOwner = {
    nodeType: 1,
    dataset: { markdownSourceStart: '16', markdownSourceEnd: '21' },
    childNodes: [hiddenGapText],
    firstChild: hiddenGapText,
    parentNode: root,
    parentElement: root,
    closest: () => null,
    matches: () => false,
    getBoundingClientRect: () => ({ left: 100, top: 30, width: 0, height: 0 })
  };
  hiddenGapText.parentElement = hiddenGapOwner;
  let mappedOwners = [owner];
  root.childNodes = [owner, breakOwner];
  let rangeStart = null;
  globalThis.document = {
    createRange: () => ({
      setStart(node, offset) { rangeStart = { node, offset }; },
      collapse() {},
      getClientRects: () => rangeStart?.node === textNode
        ? [{ left: 141, top: 15, width: 0, height: 18 }]
        : [],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
    })
  };
  try {
    const target = {};
    installViewerSelectionHelpers(target);
    assert.deepEqual(target.__cneMarkdownConformance.coordinates(root, 12, 16), {
      x: 141.5,
      y: 24,
      offset: 12
    });
    assert.deepEqual(rangeStart, { node: textNode, offset: 0 });
    assert.deepEqual(target.__cneMarkdownConformance.coordinates(root, 16, 20), {
      x: 140.5,
      y: 24,
      offset: 16
    });
    assert.deepEqual(rangeStart, { node: textNode, offset: 4 });

    // Logical mapping still prioritizes the BR beginning at 16, but trusted
    // click geometry falls back to the mapped text owner ending at 16 when
    // that collapsed BR exposes no usable caret rectangle.
    mappedOwners = [owner, breakOwner];
    assert.equal(
      target.__cneMarkdownConformance.pointAtOffset(root, 16, 20).owner,
      breakOwner
    );
    assert.deepEqual(target.__cneMarkdownConformance.coordinates(root, 16, 20), {
      x: 140.5,
      y: 24,
      offset: 16
    });
    assert.deepEqual(rangeStart, { node: textNode, offset: 4 });

    // Real inactive list DOM represents the newline plus nested indentation as
    // a zero-geometry mapped span, rather than a BR. It must use the same
    // end-boundary retry instead of falling back to the editor's top-left.
    mappedOwners = [owner, hiddenGapOwner];
    assert.equal(
      target.__cneMarkdownConformance.pointAtOffset(root, 16, 21).owner,
      hiddenGapOwner
    );
    assert.deepEqual(target.__cneMarkdownConformance.coordinates(root, 16, 21), {
      x: 140.5,
      y: 24,
      offset: 16
    });
    assert.deepEqual(rangeStart, { node: textNode, offset: 4 });
  } finally {
    if (previousNode === undefined) delete globalThis.Node;
    else globalThis.Node = previousNode;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Viewer v0.3 evidence helpers delegate source and selection identity to EditableProjection', () => {
  const previousNode = globalThis.Node;
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11 };
  const textNode = { nodeType: 3, nodeValue: 'B', parentElement: null };
  const owner = { nodeType: 1, dataset: {}, parentElement: null };
  textNode.parentElement = owner;
  const root = {
    nodeType: 1,
    dataset: { markdownEditableProjection: 'true' },
    contains: (node) => node === textNode || node === owner,
    querySelectorAll: () => []
  };
  const positions = [
    { sourceVersion: 4, offset: 0, affinity: 'after', physicalLineId: 'a', logicalColumn: 0 },
    { sourceVersion: 4, offset: 2, affinity: 'after', physicalLineId: 'b', logicalColumn: 0 },
    { sourceVersion: 4, offset: 3, affinity: 'before', physicalLineId: 'b', logicalColumn: 1 }
  ];
  let restored = null;
  const target = {
    markdownPageView: {
      editableProjectionSnapshot: () => ({ sourceVersion: 4, markdownBody: 'A\nB' }),
      editablePositionAtDomPoint: () => positions[1],
      editableSelection: () => ({ anchor: positions[1], focus: positions[2] }),
      editableDomPoint: (_root, position) => ({
        node: textNode,
        offset: position.offset === 3 ? 1 : 0,
        position
      }),
      restoreEditableSelection: (_root, selection) => {
        restored = selection;
        return true;
      },
      enumerateEditablePositions: () => positions
    }
  };
  try {
    installViewerSelectionHelpers(target);
    const helpers = target.__cneMarkdownConformance;
    assert.equal(helpers.sourceFromNode(root), 'A\nB');
    assert.equal(helpers.offsetAtPoint(root, textNode, 0), 2);
    assert.deepEqual(helpers.selectionOffsets(root), { anchor: 2, focus: 3 });
    assert.equal(helpers.pointAtOffset(root, 2, 3).position, positions[1]);
    assert.deepEqual(helpers.setSelection(root, 2, 3, 3), { anchor: 2, focus: 3 });
    assert.deepEqual(restored, { anchor: positions[1], focus: positions[2] });
  } finally {
    if (previousNode === undefined) delete globalThis.Node;
    else globalThis.Node = previousNode;
  }
});

test('Obsidian final capture retries a nonempty Reading source while its preview DOM is empty', async () => {
  const source = await readFile(new URL('./obsidianO1.mjs', import.meta.url), 'utf8');
  assert.match(source, /const readingSurfacePending = runtime\?\.mode === 'reading'/);
  assert.match(source, /String\(runtime\.visibleText \|\| ''\)\.trim\(\)\.length === 0/);
  assert.match(source, /captureAttemptCount/);
});

test('Obsidian Reading observes its custom unordered bullet instead of a transparent native marker', () => {
  const item = {
    querySelectorAll: () => [bullet]
  };
  const bullet = {
    className: 'list-bullet',
    closest: (selector) => selector === 'li' ? item : null,
    getBoundingClientRect: () => ({ width: 0, height: 0 })
  };
  const surface = {
    querySelectorAll: (selector) => selector === 'li' ? [item] : []
  };
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (_element, pseudo) => {
    if (pseudo === '::after') {
      return {
        display: 'block', visibility: 'visible', opacity: '1',
        content: 'normal', width: '6px', height: '6px',
        color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(1, 2, 3)',
        borderColor: 'transparent'
      };
    }
    return {
      display: 'inline-block', visibility: 'visible', opacity: '1',
      content: 'normal', width: '0px', height: '0px',
      color: 'transparent', backgroundColor: 'transparent', borderColor: 'transparent'
    };
  };
  try {
    const result = obsidianListPresentationFromRuntime({
      sourceItems: [{
        path: '0', parentPath: null, sourceOrder: 0,
        line: { index: 0, start: 0, end: 7 },
        markerRange: { start: 0, end: 1 }, rawMarker: '-', ordinal: null,
        kind: 'unordered', physicalDepth: 1, quoteDepth: 0
      }],
      semanticItems: [{
        listDepth: 1, checked: null,
        nativeMarker: { rendered: false, color: 'rgba(0, 0, 0, 0)' }
      }],
      mode: 'reading',
      surface,
      selection: null,
      editorActive: false
    });
    assert.equal(result.items[0].displayedMarker, 'unordered-bullet');
    assert.equal(result.items[0].markerOwner, 'custom-generated');
    assert.equal(result.items[0].markerOwnerDetail, 'obsidian-list-bullet');
    assert.equal(result.items[0].customMarker.after.rendered, true);
    assert.equal(result.items[0].nativeMarker.rendered, false);
  } finally {
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test('real failure minimizer recognizes bounded options, single sequences, and transport loss', async () => {
  assert.deepEqual(parseMinimizerArguments([
    '--id', 'random.one', '--predicate', 'list-contract',
    '--difference-path-prefix', 'presentation.list', '--max-evaluations', '25'
  ]), {
    id: 'random.one',
    predicate: 'list-contract',
    'difference-path-prefix': 'presentation.list',
    'max-evaluations': '25'
  });
  assert.equal(transportUnavailable({
    automatable: false,
    metadata: { automationError: { message: 'CDP socket is not open.' } }
  }), true);
  assert.equal(transportUnavailable({ automatable: false }), false);

  const isolation = await createIsolatedRuntimeRoot('minimizer-sequence-test');
  try {
    const filename = path.join(isolation.root, 'single-sequence.json');
    await writeIsolatedFile(isolation.root, filename, JSON.stringify({
      sequence: {
        id: 'diagnostic.single',
        actions: [{ type: 'input', command: 'insertText', text: ' ' }]
      }
    }), { encoding: 'utf8' });
    const sequence = await loadSequence(filename, 'diagnostic.single');
    assert.equal(sequence.id, 'diagnostic.single');
    assert.equal(sequence.actions.length, 1);

    const sequencesFilename = path.join(isolation.root, 'root-sequences.json');
    await writeIsolatedFile(isolation.root, sequencesFilename, JSON.stringify({
      sequences: [{
        id: 'certification.root-sequences',
        actions: [{ type: 'keyboard', key: 'Enter' }]
      }]
    }), { encoding: 'utf8' });
    const rootSequence = await loadSequence(sequencesFilename, 'certification.root-sequences');
    assert.equal(rootSequence.id, 'certification.root-sequences');
    assert.equal(rootSequence.actions.length, 1);
  } finally {
    await removeIsolatedRuntimeRoot(isolation.root, { expectedToken: isolation.sentinel.token });
  }
});

test('rebuilt packaged R&E freshness guard compares critical source bytes to app.asar', async () => {
  const result = await verifyPackagedViewerFreshness();
  assert.equal(result.packageMetadata.version, '0.4.2');
  assert.deepEqual(result.checked.map((entry) => entry.relativePath), [
    'package.json',
    'forge.config.js',
    'desktop/main.js',
    'desktop/nativeContextMenu.js',
    'server/appServer.js',
    'server/hnTextPage.js',
    'server/importService.js',
    'server/vaultContext.js',
    'public/index.html',
    'public/structuredTextCount.js',
    'public/hnText.js',
    'public/hnListNumbering.js',
    'public/hnStructureIndex.js',
    'public/hnListIndex.js',
    'public/hnListCommands.js',
    'public/pageTypes.js',
    'public/app.js',
    'public/markdownEditableFoundation.js',
    'public/markdownPage.js',
    'public/styles.css',
    'public/js/appBootstrap.js',
    'public/js/canvasBlocks.js',
    'public/js/hnPageDocumentSession.js',
    'public/js/hnTextPageView.js',
    'public/js/structuredTextPageShell.js',
    'public/js/vaultSettings.js',
    'public/js/workspaceState.js',
    'public/js/markdownEditableProjection.js',
    'public/js/markdownEditableSyntaxAdapters.js',
    'public/js/markdownPageView.js'
  ]);
  assert.match(result.asarSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.checked.every((entry) => (
    entry.sourceSha256 === entry.packagedSha256
  )), true);
});
