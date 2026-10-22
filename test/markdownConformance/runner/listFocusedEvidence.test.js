'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { digest } = require('./utils');

const SCENARIO_PATH = path.join(
  __dirname,
  '..',
  'scenarios',
  'v0.3ListFocusedEvidence.json'
);
const EVIDENCE_PATH = path.join(
  __dirname,
  '..',
  'fixtures',
  'oracles',
  'v0.3-list-focused-o1-v1-final.json'
);
const COMPARISON_PATH = path.join(
  __dirname,
  '..',
  'fixtures',
  'oracles',
  'v0.3-list-focused-normalized-comparison-final.json'
);

const EXPECTED_ENTRIES = [
  { listDepth: 1, ordinal: 3 },
  { listDepth: 1, ordinal: 4 },
  { listDepth: 2, ordinal: 1 },
  { listDepth: 1, ordinal: 5 }
];
const EXPECTED_ASAR_SHA256 = '97f4cc0f861804a3e43b287732567915c9ea3efffb89547eed2c65f21e986fdc';
const CROSS_SELECTION_ID = 'v0.3-list-selection.live-preview.active.cross-items';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('focused ordered-list O1/V1 evidence retains numbering and cross-item selection proof', () => {
  const scenarioDocument = readJson(SCENARIO_PATH);
  const evidence = readJson(EVIDENCE_PATH);
  const comparison = readJson(COMPARISON_PATH);

  assert.equal(scenarioDocument.scenarioCount, 3);
  assert.equal(scenarioDocument.scenarios.length, 3);
  assert.equal(scenarioDocument.corpusSha256, digest(scenarioDocument.scenarios));
  const crossScenario = scenarioDocument.scenarios.find(({ id }) => id === CROSS_SELECTION_ID);
  assert.ok(crossScenario);
  assert.deepEqual(crossScenario.action, {
    id: 'select-cross-items',
    type: 'select',
    anchor: 3,
    focus: 15,
    steps: 20,
    durationMs: 300
  });
  assert.match(crossScenario.initialSource.slice(3, 15), /\n4\. /);

  assert.deepEqual(evidence.safety, {
    isolatedProfiles: true,
    realVaultsTouched: false,
    realConfigurationsTouched: false
  });

  for (const runtimeName of ['obsidian', 'viewer']) {
    const runtime = evidence.results[runtimeName];
    assert.equal(runtime.scenarioCount, 3);
    assert.equal(runtime.observationCount, 3);
    assert.equal(runtime.automatableCount, 3);
    assert.equal(runtime.actionTraceObservationCount, 3);
    assert.equal(runtime.automatableActionTraceCount, 3);

    for (const observation of runtime.observations) {
      assert.equal(observation.automatable, true);
      assert.equal(observation.actionTrace.length, 1);
      assert.equal(observation.metadata.actionTrace.complete, true);
      const numbering = observation.raw.runtime.presentationFacts.orderedList;
      assert.deepEqual(numbering.entries, EXPECTED_ENTRIES);
      assert.equal(numbering.rendered, true);
      if (runtimeName === 'viewer') {
        assert.equal(observation.metadata.packageFreshness.asarSha256, EXPECTED_ASAR_SHA256);
        assert.ok(observation.metadata.packageFreshness.checked.every(
          ({ sourceSha256, packagedSha256 }) => sourceSha256 === packagedSha256
        ));
      }
    }

    const crossObservation = runtime.observations.find(({ scenarioId }) => (
      scenarioId === CROSS_SELECTION_ID
    ));
    assert.ok(crossObservation);
    assert.deepEqual(
      { anchor: crossObservation.selection.anchor, focus: crossObservation.selection.focus },
      { anchor: 3, focus: 15 }
    );
    assert.equal(crossObservation.selection.collapsed, false);
  }

  assert.equal(comparison.contractVersion, 2);
  assert.equal(comparison.scenarioSource.corpusSha256, scenarioDocument.corpusSha256);
  assert.deepEqual(comparison.counts, {
    AMBIGUOUS: 0,
    INTENTIONAL_VIEWER_OVERRIDE: 0,
    MATCH: 3,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    VIEWER_FAIL: 0
  });
  assert.deepEqual(comparison.rawStrictCounts, {
    AMBIGUOUS: 0,
    INTENTIONAL_VIEWER_OVERRIDE: 0,
    MATCH: 0,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    VIEWER_FAIL: 3
  });
  assert.ok(comparison.results.every(({ status, rawStrictStatus, differences }) => (
    status === 'MATCH' && rawStrictStatus === 'VIEWER_FAIL' && differences.length === 0
  )));
});
