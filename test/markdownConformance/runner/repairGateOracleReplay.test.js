'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  STATUS,
  isCleanOracleReplay,
  validateRepairGateOracleReplay
} = require('./repairGateOracleReplay');

function scenario(id, source = 'A', offset = 1, additions = {}) {
  return {
    id,
    fixtureId: 'plain',
    mode: 'source',
    actions: [{ type: 'input', command: 'insertText', text: 'A' }],
    oracleExpected: {
      source,
      selection: { anchor: offset, focus: offset }
    },
    ...additions
  };
}

function observation(scenarioId, source, offset, additions = {}) {
  return {
    scenarioId,
    evidenceLevel: 'O1',
    automatable: true,
    source,
    selection: {
      anchor: offset,
      focus: offset,
      start: offset,
      end: offset,
      collapsed: true,
      direction: 'forward'
    },
    ...additions
  };
}

function tracedObservation(gateScenario, steps) {
  const last = steps[steps.length - 1];
  return observation(gateScenario.id, last.source, last.offset, {
    actionTrace: steps.map((step, index) => ({
      index,
      action: gateScenario.actions[index],
      observation: observation(gateScenario.id, step.source, step.offset)
    })),
    metadata: {
      actionTrace: {
        complete: true,
        expectedActionCount: gateScenario.actions.length,
        capturedActionCount: gateScenario.actions.length,
        timingPreservingIntermediateCapture: true
      }
    }
  });
}

test('classifies exact, unavailable, and stale oracle outcomes explicitly', () => {
  const gate = { sequences: [
    scenario('exact'),
    scenario('unavailable', 'B', 1),
    scenario('mismatch', 'C', 1),
    scenario('not-o1', 'D', 1)
  ] };
  const evidence = { results: { obsidian: { observations: [
    observation('exact', 'A', 1),
    observation('unavailable', 'B', 1, {
      automatable: false,
      metadata: { automationError: { message: 'Editor could not be focused.' } }
    }),
    observation('mismatch', 'Different', 2),
    observation('not-o1', 'D', 1, { evidenceLevel: 'U' })
  ] } } };

  const result = validateRepairGateOracleReplay(gate, evidence);

  assert.deepEqual(result.results.map(({ status, reasonCode }) => [status, reasonCode]), [
    [STATUS.REPRODUCIBLE, 'oracle-reproduced'],
    [STATUS.OBSIDIAN_NOT_AUTOMATABLE, 'obsidian-not-automatable'],
    [STATUS.AMBIGUOUS_ORACLE_MISMATCH, 'oracle-final-mismatch'],
    [STATUS.OBSIDIAN_NOT_AUTOMATABLE, 'obsidian-evidence-not-o1']
  ]);
  assert.deepEqual(result.results[2].differences.map(({ path: field }) => field), [
    'source', 'selection.anchor', 'selection.focus'
  ]);
  assert.equal(result.results[0].actionReplay.status, 'NOT_CAPTURED');
  assert.equal(result.totals.REPRODUCIBLE, 1);
  assert.equal(result.totals.OBSIDIAN_NOT_AUTOMATABLE, 2);
  assert.equal(result.totals.AMBIGUOUS_ORACLE_MISMATCH, 1);
  assert.equal(isCleanOracleReplay(result), false);
});

test('verifies complete, history-reduced, and rebased origin metadata', () => {
  const firstAction = { type: 'input', command: 'insertText', text: 'A' };
  const secondAction = { type: 'input', command: 'insertText', text: 'B' };
  const preserved = scenario('preserved', 'AB', 2, {
    actions: [firstAction, secondAction],
    repairMetadata: {
      originScenarioId: 'certification-random.preserved',
      prefixStatePreserved: true,
      firstDivergentActionIndex: 1,
      firstDivergentActionNumber: 2,
      minimizedActionCount: 2,
      expectedO1: { source: 'AB', selection: { anchor: 2, focus: 2 } }
    }
  });
  const rebased = scenario('rebased', 'A', 1, {
    repairMetadata: {
      originScenarioId: 'certification-random.rebased',
      prefixStatePreserved: false,
      firstDivergentActionIndex: 4,
      firstDivergentActionNumber: 5,
      minimizedActionCount: 1,
      expectedO1: { source: 'A', selection: { anchor: 1, focus: 1 } }
    }
  });
  const historyReduced = scenario('history-reduced', 'AB', 2, {
    actions: [firstAction, secondAction],
    repairMetadata: {
      originScenarioId: 'certification-random.history-reduced',
      prefixStatePreserved: true,
      historyDependencyReduced: true,
      historyReplayStartActionIndex: 3,
      firstDivergentActionIndex: 4,
      firstDivergentActionNumber: 5,
      minimizedActionCount: 2,
      expectedO1: { source: 'AB', selection: { anchor: 2, focus: 2 } }
    }
  });
  const result = validateRepairGateOracleReplay(
    { sequences: [preserved, historyReduced, rebased] },
    { observations: [
      tracedObservation(preserved, [
        { source: 'A', offset: 1 },
        { source: 'AB', offset: 2 }
      ]),
      tracedObservation(historyReduced, [
        { source: 'A', offset: 1 },
        { source: 'AB', offset: 2 }
      ]),
      tracedObservation(rebased, [{ source: 'A', offset: 1 }])
    ] }
  );

  assert.deepEqual(result.results.map(({ status }) => status), [
    STATUS.REPRODUCIBLE, STATUS.REPRODUCIBLE, STATUS.REPRODUCIBLE
  ]);
  assert.deepEqual(result.results.map(({ actionReplay }) => actionReplay.status), [
    'VERIFIED', 'VERIFIED', 'VERIFIED'
  ]);
  assert.deepEqual(result.results.map(({ originReplay }) => originReplay.status), [
    'VERIFIED', 'VERIFIED', 'REBASED_NOT_APPLICABLE'
  ]);
  assert.equal(result.totals.verifiedActionReplayCount, 3);
  assert.equal(result.totals.verifiedOriginPrefixCount, 2);
  assert.equal(result.totals.rebasedOriginPrefixCount, 1);
  assert.equal(isCleanOracleReplay(result), true);
});

test('rejects inconsistent history-reduction metadata', () => {
  const invalid = scenario('invalid-history-reduction', 'AB', 2, {
    actions: [
      { type: 'input', command: 'insertText', text: 'A' },
      { type: 'input', command: 'insertText', text: 'B' }
    ],
    repairMetadata: {
      originScenarioId: 'certification-random.invalid-history-reduction',
      prefixStatePreserved: true,
      historyDependencyReduced: true,
      historyReplayStartActionIndex: 2,
      firstDivergentActionIndex: 4,
      firstDivergentActionNumber: 5,
      minimizedActionCount: 2,
      expectedO1: { source: 'AB', selection: { anchor: 2, focus: 2 } }
    }
  });

  const result = validateRepairGateOracleReplay(
    { sequences: [invalid] },
    { observations: [tracedObservation(invalid, [
      { source: 'A', offset: 1 },
      { source: 'AB', offset: 2 }
    ])] }
  );

  assert.equal(result.results[0].status, STATUS.AMBIGUOUS_ORACLE_MISMATCH);
  assert.equal(result.results[0].reasonCode, 'origin-metadata-mismatch');
  assert.deepEqual(result.results[0].originReplay.differences, [{
    path: 'actions.length',
    expected: 3,
    actual: 2
  }]);
});

test('verifies honest dependency-suffix metadata without calling it a preserved prefix', () => {
  const firstAction = { type: 'input', command: 'insertText', text: '*' };
  const secondAction = { type: 'keyboard', key: 'Tab' };
  const dependencySuffix = scenario('dependency-suffix', 'AB', 2, {
    actions: [firstAction, secondAction],
    repairMetadata: {
      originScenarioId: 'list-random.dependency-suffix',
      prefixStateRequired: true,
      prefixStatePreserved: false,
      dependencySuffixPreserved: true,
      originReplayStartActionIndex: 3,
      caretAffinityDependencyPreserved: true,
      caretAffinityReplayStartActionIndex: 3,
      historyDependencyResolved: false,
      historyDependencyReduced: false,
      firstDivergentActionIndex: 4,
      firstDivergentActionNumber: 5,
      minimizedActionCount: 2,
      expectedO1: { source: 'AB', selection: { anchor: 2, focus: 2 } }
    }
  });

  const result = validateRepairGateOracleReplay(
    { sequences: [dependencySuffix] },
    { observations: [tracedObservation(dependencySuffix, [
      { source: 'A', offset: 1 },
      { source: 'AB', offset: 2 }
    ])] }
  );

  assert.equal(result.results[0].status, STATUS.REPRODUCIBLE);
  assert.deepEqual(result.results[0].originReplay, {
    status: 'VERIFIED',
    originScenarioId: 'list-random.dependency-suffix',
    prefixStatePreserved: false,
    prefixStateRequired: true,
    dependencySuffixPreserved: true,
    firstDivergentActionIndex: 4,
    firstDivergentActionNumber: 5,
    gateActionCount: 2,
    differences: []
  });
});

test('a captured action mismatch cannot pass on final state alone', () => {
  const gateScenario = scenario('trace-mismatch');
  const actual = tracedObservation(gateScenario, [{ source: 'A', offset: 1 }]);
  actual.actionTrace[0].action = {
    type: 'input', command: 'insertText', text: 'Different'
  };

  const result = validateRepairGateOracleReplay(
    { sequences: [gateScenario] },
    { observations: [actual] }
  );

  assert.equal(result.results[0].status, STATUS.AMBIGUOUS_ORACLE_MISMATCH);
  assert.equal(result.results[0].reasonCode, 'action-replay-mismatch');
  assert.equal(result.results[0].actionReplay.status, 'MISMATCH');
  assert.deepEqual(result.results[0].actionReplay.differences.map(({ path: field }) => field), [
    'actionTrace.0.action'
  ]);
});

test('CLI writes a replay record and require-reproducible exits 2 on mismatch', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'cne-o1-replay-test-'));
  try {
    const gateFile = path.join(temporary, 'gate.json');
    const evidenceFile = path.join(temporary, 'o1.json');
    const outputFile = path.join(temporary, 'validation.json');
    writeFileSync(gateFile, JSON.stringify({ sequences: [scenario('mismatch')] }));
    writeFileSync(evidenceFile, JSON.stringify({ observations: [
      observation('mismatch', 'Different', 1)
    ] }));

    const cli = path.resolve(__dirname, 'repairGateOracleReplayCli.js');
    const completed = spawnSync(process.execPath, [
      cli,
      '--gate', gateFile,
      '--obsidian', evidenceFile,
      '--output', outputFile,
      '--require-reproducible'
    ], { encoding: 'utf8' });

    assert.equal(completed.status, 2, completed.stderr);
    const result = JSON.parse(readFileSync(outputFile, 'utf8'));
    assert.equal(result.totals.REPRODUCIBLE, 0);
    assert.equal(result.totals.AMBIGUOUS_ORACLE_MISMATCH, 1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('pre-rebase Round-2 O1 evidence exposes the 6b79 source-affinity mismatch', () => {
  const gate = require('../scenarios/v0.3ValidRandomFullTraceRepairGateRound2.json');
  const evidence = require(
    '../fixtures/oracles/v0.3-valid-random-full-trace-repair-gate-round2-o1.json'
  );
  const recorded = require(
    '../fixtures/oracles/v0.3-valid-random-full-trace-repair-gate-round2-o1-replay-validation.json'
  );

  const result = validateRepairGateOracleReplay(gate, evidence);
  const mismatches = result.results.filter(({ status }) => (
    status === STATUS.AMBIGUOUS_ORACLE_MISMATCH
  ));

  assert.deepEqual(result.totals, {
    scenarioCount: 30,
    observationCount: 30,
    classifiedCount: 30,
    REPRODUCIBLE: 29,
    OBSIDIAN_NOT_AUTOMATABLE: 0,
    AMBIGUOUS_ORACLE_MISMATCH: 1,
    exactFinalMismatchCount: 1,
    verifiedActionReplayCount: 29,
    actionReplayMismatchCount: 1,
    actionReplayNotCapturedCount: 0,
    verifiedOriginPrefixCount: 12,
    rebasedOriginPrefixCount: 18,
    originMetadataMismatchCount: 0,
    missingObservationCount: 0,
    unexpectedObservationCount: 0
  });
  assert.equal(mismatches.length, 1);
  assert.equal(
    mismatches[0].scenarioId,
    'v0.3-full-trace-repair.6b79cb9a3ebc970e5b3b.action-20'
  );
  assert.equal(mismatches[0].reasonCode, 'oracle-final-mismatch');
  assert.deepEqual(mismatches[0].differences.map(({ path: field }) => field), [
    'source', 'selection.anchor', 'selection.focus'
  ]);
  assert.deepEqual(recorded, result);
});
