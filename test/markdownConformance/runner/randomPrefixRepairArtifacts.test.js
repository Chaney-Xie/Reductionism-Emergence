'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const source = require('../scenarios/random-v0.3-valid.json');
const prefixes = require('../scenarios/random-v0.3-valid-prefix-probes.json');
const obsidian = require('../fixtures/oracles/random-v0.3-valid-prefix-probes-o1.json');
const viewer = require('../fixtures/oracles/random-v0.3-valid-prefix-probes-v1.json');
const checkedInGate = require('../scenarios/v0.3ValidRandomTargetedRepairGate.json');
const checkedInNoEarly = require('../scenarios/v0.3ValidRandomNoEarlyDivergence.json');
const {
  GATE_CASES,
  NO_EARLY_DIVERGENCE_IDS,
  buildNoEarlyDivergenceCorpus,
  buildRepairGate
} = require('./randomPrefixRepairArtifacts');

test('targeted repair gate is reproducible and preserves all four history prefixes', () => {
  const generated = buildRepairGate(prefixes, obsidian, viewer);
  assert.deepEqual(generated, checkedInGate);
  assert.equal(generated.caseCount, 22);
  assert.equal(new Set(generated.sequences.map(({ id }) => id)).size, 22);
  assert.deepEqual(generated.categoryCounts, {
    backspace: 3,
    'exact-insertion': 4,
    history: 4,
    'list-structural': 3,
    nbsp: 1,
    'ordered-renumber': 4,
    'quote-padding': 2,
    'task-shift-enter': 1
  });
  const history = generated.sequences.filter(({ repairCategoryGroup }) => (
    repairCategoryGroup === 'history'
  ));
  assert.equal(history.length, 4);
  assert.equal(history.every(({ actions, repairMetadata }) => (
    actions.length > 1 && repairMetadata.preservedHistoryPrefix === true
  )), true);
  assert.equal(generated.sequences.filter(({ repairCategoryGroup }) => (
    repairCategoryGroup !== 'history'
  )).every(({ actions }) => actions.length === 1), true);
  assert.equal(GATE_CASES.length, generated.caseCount);
});

test('late-divergence corpus is reproducible and flags only possible quote-policy intersections', () => {
  const generated = buildNoEarlyDivergenceCorpus(source, prefixes, obsidian, viewer);
  assert.deepEqual(generated, checkedInNoEarly);
  assert.equal(generated.count, 24);
  assert.equal(new Set(generated.sequences.map(({ id }) => id)).size, 24);
  assert.equal(NO_EARLY_DIVERGENCE_IDS.length, generated.count);
  assert.equal(generated.sequences.every(({ lateDivergenceMetadata }) => (
    lateDivergenceMetadata.exactSourceAndSelectionThroughAction === 6
    && lateDivergenceMetadata.fullTraceSourceDiverges === true
    && lateDivergenceMetadata.requiresPerActionTrace === true
  )), true);
  assert.deepEqual(generated.sequences.filter(({ lateDivergenceMetadata }) => (
    lateDivergenceMetadata.possibleMarkerOnlyQuoteDecisionIntersection
  )).map(({ id }) => id), [
    'certification-random.29910640d4db8641345d',
    'certification-random.2f0d23515af9d9b56cd9',
    'certification-random.0ac274b17cd0e55956bb'
  ]);
});
