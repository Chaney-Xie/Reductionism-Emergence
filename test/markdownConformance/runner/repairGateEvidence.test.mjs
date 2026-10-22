import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  compareRepairGateEvidence,
  isCleanRepairGate
} from './repairGateEvidence.mjs';

function scenario(id, expectedSource, expectedOffset, additions = {}) {
  return {
    id,
    syntaxFamily: additions.syntaxFamily || 'paragraphs',
    oracleExpected: {
      source: expectedSource,
      selection: { anchor: expectedOffset, focus: expectedOffset }
    },
    ...additions
  };
}

function observation(scenarioId, source, offset, additions = {}) {
  return {
    scenarioId,
    evidenceLevel: 'V1',
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
    integrityFailure: [],
    ...additions
  };
}

test('source repair bridge compares authoritative source and anchor/focus exactly', () => {
  const scenarios = { scenarios: [
    scenario('match', '    Alpha', 4),
    scenario('source-fail', 'A', 1),
    scenario('selection-fail', 'B', 1)
  ] };
  const viewer = { results: { viewer: { observations: [
    observation('match', '    Alpha', 4),
    observation('source-fail', 'Different', 1),
    observation('selection-fail', 'B', 2)
  ] } } };
  const result = compareRepairGateEvidence(scenarios, viewer);

  assert.deepEqual(result.results.map(({ status }) => status), [
    'MATCH', 'VIEWER_FAIL', 'VIEWER_FAIL'
  ]);
  assert.deepEqual(result.results[1].differences.map(({ path: field }) => field), ['source']);
  assert.deepEqual(result.results[2].differences.map(({ path: field }) => field), [
    'selection.anchor', 'selection.focus'
  ]);
  assert.equal(result.totals.MATCH, 1);
  assert.equal(result.totals.VIEWER_FAIL, 2);
  assert.equal(result.totals.sourceMismatchCount, 1);
  assert.equal(result.totals.selectionMismatchCount, 1);
});

test('source repair bridge accepts generated repair artifacts with sequences[]', () => {
  const scenarios = { sequences: [scenario('generated', 'Alpha!', 6)] };
  const viewer = { results: { viewer: { observations: [
    observation('generated', 'Alpha!', 6)
  ] } } };

  const result = compareRepairGateEvidence(scenarios, viewer);

  assert.equal(result.totals.MATCH, 1);
  assert.equal(result.totals.VIEWER_FAIL, 0);
  assert.equal(isCleanRepairGate(result), true);
});

test('Reading repair artifacts do not invent a selection requirement', () => {
  const reading = scenario('reading', '* Alpha\n* Beta', 0, {
    mode: 'reading',
    requiredObservations: ['source', 'physical', 'semantic', 'presentation']
  });
  const viewer = { observations: [observation(
    'reading',
    '* Alpha\n* Beta',
    0,
    { selection: null }
  )] };

  const result = compareRepairGateEvidence({ sequences: [reading] }, viewer);

  assert.equal(result.totals.MATCH, 1);
  assert.equal(result.totals.selectionMismatchCount, 0);
  assert.equal(result.results[0].expected.selectionRequired, false);
  assert.equal(result.results[0].expected.selection, null);
  assert.equal(isCleanRepairGate(result), true);
});

test('product decisions stay ambiguous, while Viewer integrity failure takes precedence', () => {
  const scenarios = { scenarios: [
    scenario('decision', '>\n>', 3, { productDecisionRequired: true }),
    scenario('decision-match', '>\n>', 3, { productDecisionRequired: true }),
    scenario('integrity', '>\n>', 3, { productDecisionRequired: true })
  ] };
  const viewer = { observations: [
    observation('decision', '>', 1),
    observation('decision-match', '>\n>', 3),
    observation('integrity', '>', 1, { integrityFailure: ['canonicalMap', 'dom'] })
  ] };
  const result = compareRepairGateEvidence(scenarios, viewer);

  assert.deepEqual(result.results.map(({ status, reasonCode }) => [status, reasonCode]), [
    ['AMBIGUOUS', 'product-decision-required'],
    ['MATCH', 'authoritative-fields-match'],
    ['VIEWER_FAIL', 'viewer-integrity-failure']
  ]);
  assert.equal(result.totals.productDecisionAmbiguous, 1);
  assert.equal(result.totals.integrityFailureViewerFail, 1);
  assert.equal(isCleanRepairGate(result), false);
});

test('missing, non-automatable, and non-V1 observations are explicit ambiguity', () => {
  const scenarios = { scenarios: [
    scenario('missing', 'A', 1),
    scenario('unavailable', 'B', 1),
    scenario('unit', 'C', 1)
  ] };
  const viewer = { observations: [
    observation('unavailable', 'B', 1, {
      automatable: false,
      metadata: { automationError: { message: 'Editor could not be focused.' } }
    }),
    observation('unit', 'C', 1, { evidenceLevel: 'U' }),
    observation('extra', 'D', 1)
  ] };
  const result = compareRepairGateEvidence(scenarios, viewer);

  assert.deepEqual(result.results.map(({ reasonCode }) => reasonCode), [
    'missing-viewer-observation',
    'viewer-not-automatable',
    'viewer-evidence-not-v1'
  ]);
  assert.deepEqual(result.totals, {
    scenarioCount: 3,
    observationCount: 3,
    classifiedCount: 3,
    MATCH: 0,
    VIEWER_FAIL: 0,
    AMBIGUOUS: 3,
    productDecisionAmbiguous: 0,
    nonAutomatableAmbiguous: 1,
    missingObservationAmbiguous: 1,
    nonV1EvidenceAmbiguous: 1,
    integrityFailureViewerFail: 0,
    sourceMismatchCount: 0,
    selectionMismatchCount: 0,
    unexpectedObservationCount: 1
  });
  assert.equal(isCleanRepairGate(result), false);
});

test('CLI accepts realRuntimeCli output and require-clean allows only decision ambiguity', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'cne-repair-gate-test-'));
  try {
    const scenarioFile = path.join(temporary, 'scenarios.json');
    const viewerFile = path.join(temporary, 'viewer.json');
    const outputFile = path.join(temporary, 'comparison.json');
    writeFileSync(scenarioFile, JSON.stringify({ scenarios: [
      scenario('match', 'A', 1),
      scenario('decision', '>\n>', 3, { productDecisionRequired: true })
    ] }));
    writeFileSync(viewerFile, JSON.stringify({ results: { viewer: { observations: [
      observation('match', 'A', 1),
      observation('decision', '>', 1)
    ] } } }));

    const cli = path.resolve(
      'test/markdownConformance/runner/repairGateEvidenceCli.mjs'
    );
    const completed = spawnSync(process.execPath, [
      cli,
      '--scenarios', scenarioFile,
      '--viewer', viewerFile,
      '--output', outputFile,
      '--require-clean'
    ], { encoding: 'utf8' });

    assert.equal(completed.status, 0, completed.stderr);
    const result = JSON.parse(readFileSync(outputFile, 'utf8'));
    assert.equal(result.totals.MATCH, 1);
    assert.equal(result.totals.AMBIGUOUS, 1);
    assert.equal(result.totals.productDecisionAmbiguous, 1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
