'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const markdown = require('../public/markdownPage');

const scenarioDocument = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  'markdownConformance',
  'scenarios',
  'v0.3ListEditingExpanded.json'
), 'utf8'));
const comparison = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  'markdownConformance',
  'evidence',
  'v0.3-list-editing-expanded-comparison-before-repair.json'
), 'utf8'));
const obsidianEvidence = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  'markdownConformance',
  'evidence',
  'v0.3-list-editing-expanded-o1-before-repair.json'
), 'utf8'));
const postRepairObsidianEvidence = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  'markdownConformance',
  'evidence',
  'v0.3-list-editing-expanded-o1-after-repair.json'
), 'utf8'));

const POST_REPAIR_RESIDUALS = Object.freeze([
  'list-editing-expanded.nested.mixed.depth-3.enter',
  'list-editing-expanded.physical.ordered-continuation-with-child.delete'
]);

function applyKeyboardAction(source, selection, action) {
  if (action.key === 'Enter') {
    return markdown.applyMarkdownNewline(source, selection);
  }
  if (action.key === 'Tab') {
    return markdown.applyMarkdownIndentation(
      source,
      selection,
      action.shiftKey ? 'outdent' : 'indent'
    );
  }
  if (action.key === 'Backspace' || action.key === 'Delete') {
    return markdown.applyMarkdownStructuralDeletion(
      source,
      selection,
      action.key === 'Delete' ? 'forward' : 'backward'
    );
  }
  throw new Error(`Unsupported focused oracle action: ${action.key}`);
}

function focusedSourceOracleCases() {
  const scenarios = new Map(scenarioDocument.scenarios.map((scenario) => [
    scenario.id,
    scenario
  ]));
  const observations = new Map(
    obsidianEvidence.results.obsidian.observations.map((observation) => [
      observation.scenarioId,
      observation
    ])
  );
  const unique = new Map();
  for (const result of comparison.results.filter(({ sourceAuthorityFailed }) => (
    sourceAuthorityFailed
  ))) {
    const scenario = scenarios.get(result.scenarioId);
    const observation = observations.get(result.scenarioId);
    assert.ok(scenario, `missing scenario ${result.scenarioId}`);
    assert.ok(observation, `missing O1 observation ${result.scenarioId}`);
    const identity = JSON.stringify([
      scenario.initialSource,
      scenario.initialSelection,
      scenario.actions,
      observation.source,
      observation.selection.anchor,
      observation.selection.focus
    ]);
    if (!unique.has(identity)) unique.set(identity, { scenario, observation });
  }
  return [...unique.values()];
}

const cases = focusedSourceOracleCases();

function postRepairResidualCases() {
  const scenarios = new Map(scenarioDocument.scenarios.map((scenario) => [
    scenario.id,
    scenario
  ]));
  const observations = postRepairObsidianEvidence.results.obsidian.observations.filter(
    ({ scenarioId }) => POST_REPAIR_RESIDUALS.some((prefix) => scenarioId.startsWith(prefix))
  );
  assert.equal(observations.length, 4);
  const unique = new Map();
  for (const observation of observations) {
    const scenario = scenarios.get(observation.scenarioId);
    assert.ok(scenario, `missing post-repair scenario ${observation.scenarioId}`);
    const identity = JSON.stringify([
      scenario.initialSource,
      scenario.initialSelection,
      scenario.actions,
      observation.source,
      observation.selection.anchor,
      observation.selection.focus
    ]);
    if (!unique.has(identity)) unique.set(identity, { scenario, observation });
  }
  return [...unique.values()];
}

const postRepairCases = postRepairResidualCases();

test('expanded list source repair gate is exactly 38 unique O1 1.13.7 actions', () => {
  assert.equal(cases.length, 38);
  assert.ok(cases.every(({ scenario }) => scenario.actions.length === 1));
  assert.ok(cases.every(({ observation }) => (
    observation.metadata.versions.obsidian === '1.13.7'
  )));
});

test('post-repair real recapture adds exactly two unique O1 1.13.7 source residuals', () => {
  assert.equal(postRepairCases.length, 2);
  assert.ok(postRepairCases.every(({ scenario }) => scenario.actions.length === 1));
  assert.ok(postRepairCases.every(({ observation }) => (
    observation.metadata.versions.obsidian === '1.13.7'
  )));
});

for (const { scenario, observation } of cases) {
  test(`O1 source oracle: ${scenario.fixtureId} / ${scenario.action.id}`, () => {
    const result = applyKeyboardAction(
      scenario.initialSource,
      scenario.initialSelection,
      scenario.actions[0]
    );
    assert.deepEqual(
      {
        source: result.source,
        selection: {
          anchor: result.selection.anchor,
          focus: result.selection.focus
        }
      },
      {
        source: observation.source,
        selection: {
          anchor: observation.selection.anchor,
          focus: observation.selection.focus
        }
      }
    );
  });
}

for (const { scenario, observation } of postRepairCases) {
  test(`post-repair O1 source oracle: ${scenario.fixtureId} / ${scenario.action.id}`, () => {
    const result = applyKeyboardAction(
      scenario.initialSource,
      scenario.initialSelection,
      scenario.actions[0]
    );
    assert.deepEqual(
      {
        source: result.source,
        selection: {
          anchor: result.selection.anchor,
          focus: result.selection.focus
        }
      },
      {
        source: observation.source,
        selection: {
          anchor: observation.selection.anchor,
          focus: observation.selection.focus
        }
      }
    );
  });
}
