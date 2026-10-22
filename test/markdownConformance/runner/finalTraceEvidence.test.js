'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  compareFinalTraceEvidence,
  isCleanFinalTrace,
  scenarioArray,
  selectScenariosByEvidenceIds
} = require('./finalTraceEvidence');

function scenario(id, requiredObservations = ['source', 'selection']) {
  return {
    id,
    fixtureId: 'plain',
    syntaxFamily: 'paragraphs',
    mode: 'source',
    requiredObservations
  };
}

function observation(scenarioId, evidenceLevel, additions = {}) {
  const source = additions.source ?? 'A';
  return {
    scenarioId,
    evidenceLevel,
    automatable: true,
    source,
    sourceBytesBase64: Buffer.from(source).toString('base64'),
    selection: { anchor: source.length, focus: source.length },
    semantic: { rootTypes: ['paragraph'] },
    integrityFailure: [],
    ...additions
  };
}

function realOutput(role, observations) {
  return { results: { [role]: { observations } } };
}

test('final traces pair by scenarioId and compare only required observations', () => {
  const scenarios = { sequences: [
    scenario('source-only', ['source']),
    scenario('source-fail', ['source', 'selection'])
  ] };
  const obsidian = realOutput('obsidian', [
    observation('source-fail', 'O1', { source: 'A' }),
    observation('source-only', 'O1', {
      source: 'A', selection: { anchor: 0, focus: 0 }, semantic: { rootTypes: ['heading'] }
    })
  ]);
  const viewer = realOutput('viewer', [
    observation('source-only', 'V1', {
      source: 'A', selection: { anchor: 1, focus: 1 }, semantic: { rootTypes: ['paragraph'] }
    }),
    observation('source-fail', 'V1', { source: 'B' })
  ]);
  const result = compareFinalTraceEvidence(scenarios, obsidian, viewer);

  assert.deepEqual(result.results.map(({ status }) => status), ['MATCH', 'VIEWER_FAIL']);
  assert.deepEqual(result.scenarioSource, {
    corpusSha256: null,
    corpusScenarioCount: 2,
    selectedScenarioCount: 2
  });
  assert.equal(result.results[1].sourceAuthorityFailed, true);
  assert.deepEqual(result.counts, {
    MATCH: 1,
    INTENTIONAL_VIEWER_OVERRIDE: 0,
    VIEWER_FAIL: 1,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    AMBIGUOUS: 0
  });
});

test('unavailable evidence and integrity use explicit classification precedence', () => {
  const ids = [
    'o1-unavailable',
    'missing-o1',
    'missing-v1',
    'v1-unavailable',
    'not-v1',
    'integrity',
    'not-o1'
  ];
  const scenarios = ids.map((id) => scenario(id, ['source']));
  const obsidian = [
    observation('o1-unavailable', 'O1', { automatable: false }),
    observation('missing-v1', 'O1'),
    observation('v1-unavailable', 'O1'),
    observation('not-v1', 'O1'),
    observation('integrity', 'O1'),
    observation('not-o1', 'U')
  ];
  const viewer = [
    observation('o1-unavailable', 'V1', { integrityFailure: ['dom'] }),
    observation('missing-o1', 'V1'),
    observation('v1-unavailable', 'V1', {
      automatable: false,
      integrityFailure: ['dom']
    }),
    observation('not-v1', 'U', { integrityFailure: ['dom'] }),
    observation('integrity', 'V1', { integrityFailure: ['canonicalMap', 'dom'] }),
    observation('not-o1', 'V1')
  ];
  const result = compareFinalTraceEvidence(scenarios, obsidian, viewer);

  assert.deepEqual(result.results.map(({ status, reasonCode }) => [status, reasonCode]), [
    ['OBSIDIAN_NOT_AUTOMATABLE', 'obsidian-not-automatable'],
    ['AMBIGUOUS', 'missing-runtime-observation'],
    ['AMBIGUOUS', 'missing-runtime-observation'],
    ['AMBIGUOUS', 'viewer-not-automatable'],
    ['AMBIGUOUS', 'viewer-evidence-not-v1'],
    ['VIEWER_FAIL', 'viewer-integrity-failure'],
    ['OBSIDIAN_NOT_AUTOMATABLE', 'obsidian-evidence-not-o1']
  ]);
  assert.equal(isCleanFinalTrace(result), false);
});

test('missing required dimensions never become MATCH', () => {
  const scenarios = [
    scenario('missing-o1-semantic', ['source', 'semantic']),
    scenario('missing-v1-selection', ['source', 'selection'])
  ];
  const obsidian = [
    observation('missing-o1-semantic', 'O1', { semantic: null }),
    observation('missing-v1-selection', 'O1')
  ];
  const viewer = [
    observation('missing-o1-semantic', 'V1'),
    observation('missing-v1-selection', 'V1', { selection: null })
  ];
  const result = compareFinalTraceEvidence(scenarios, obsidian, viewer);

  assert.deepEqual(result.results.map(({ status }) => status), [
    'OBSIDIAN_NOT_AUTOMATABLE', 'AMBIGUOUS'
  ]);
  assert.match(result.results[0].reason, /missing: semantic/);
  assert.match(result.results[1].reason, /missing: selection/);
});

test('evidence ID selection uses only requested generated scenarios in listed order', () => {
  const generated = {
    corpusSha256: 'generated-corpus-sha',
    scenarios: [scenario('one'), scenario('two'), scenario('three')]
  };
  const selected = selectScenariosByEvidenceIds(generated, {
    scenarios: ['three', 'one']
  });

  assert.deepEqual(selected.scenarios.map(({ id }) => id), ['three', 'one']);
  assert.equal(selected.selectedScenarioCount, 2);
  assert.equal(selected.sourceCorpusScenarioCount, 3);
  assert.equal(selected.sourceCorpusSha256, 'generated-corpus-sha');
  assert.throws(
    () => selectScenariosByEvidenceIds(generated, { scenarios: ['missing'] }),
    /missing requested scenario IDs: missing/
  );
  assert.throws(
    () => selectScenariosByEvidenceIds(generated, { scenarios: ['one', 'one'] }),
    /duplicate scenario IDs/
  );
});

test('a promoted regression document can expose one top-level sequence', () => {
  assert.deepEqual(
    scenarioArray({ sequence: scenario('one') }).map(({ id }) => id),
    ['one']
  );
});

test('CLI reads separate realRuntimeCli outputs and emits results plus complete counts', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cne-final-trace-test-'));
  try {
    const scenariosFile = path.join(temporary, 'scenarios.json');
    const obsidianFile = path.join(temporary, 'o1.json');
    const viewerFile = path.join(temporary, 'v1.json');
    const idsFile = path.join(temporary, 'ids.json');
    const outputFile = path.join(temporary, 'comparison.json');
    fs.writeFileSync(scenariosFile, JSON.stringify({ random: { sequences: [
      scenario('ignored', ['source']),
      scenario('one', ['source'])
    ] } }));
    fs.writeFileSync(idsFile, JSON.stringify({ scenarios: ['one'] }));
    fs.writeFileSync(obsidianFile, JSON.stringify(realOutput('obsidian', [
      observation('one', 'O1')
    ])));
    fs.writeFileSync(viewerFile, JSON.stringify(realOutput('viewer', [
      observation('one', 'V1')
    ])));

    const cli = path.resolve('test/markdownConformance/runner/finalTraceEvidenceCli.js');
    const completed = spawnSync(process.execPath, [
      cli,
      '--scenarios', scenariosFile,
      '--scenario-ids-from', idsFile,
      '--obsidian', obsidianFile,
      '--viewer', viewerFile,
      '--output', outputFile,
      '--require-clean'
    ], { encoding: 'utf8' });
    assert.equal(completed.status, 0, completed.stderr);
    const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    assert.equal(result.scenarioCount, 1);
    assert.equal(result.results.length, 1);
    assert.equal(result.counts.MATCH, 1);
    assert.equal(result.scenarioSource.corpusScenarioCount, 2);
    assert.equal(result.scenarioSource.selectedScenarioCount, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
