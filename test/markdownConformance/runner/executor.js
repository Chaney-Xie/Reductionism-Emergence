'use strict';

function requiredMethod(adapter, name) {
  if (typeof adapter?.[name] !== 'function') {
    throw new TypeError(`Conformance adapter must implement ${name}().`);
  }
  return adapter[name].bind(adapter);
}

function expandedActions(action) {
  return action?.type === 'sequence' ? [...(action.steps || [])] : [action];
}

async function executeScenario(adapter, scenario) {
  if (typeof adapter?.runScenario === 'function') return adapter.runScenario(scenario);
  const replaceSource = requiredMethod(adapter, 'replaceSource');
  const setMode = requiredMethod(adapter, 'setMode');
  const setSelection = requiredMethod(adapter, 'setSelection');
  const performAction = requiredMethod(adapter, 'performAction');
  const capture = requiredMethod(adapter, 'capture');
  if (typeof adapter.openFixture === 'function') await adapter.openFixture(scenario);
  await replaceSource(scenario.initialSource, scenario);
  await setMode(scenario.mode, scenario.state || {}, scenario);
  await setSelection(scenario.initialSelection, scenario);
  for (const action of expandedActions(scenario.action)) await performAction(action, scenario);
  const result = await capture(scenario);
  return {scenarioId: scenario.id, ...result};
}

async function executeCorpus(adapter, scenarioDocument, options = {}) {
  const scenarios = Array.isArray(scenarioDocument)
    ? scenarioDocument
    : (scenarioDocument?.scenarios || []);
  const observations = [];
  for (const scenario of scenarios) {
    try {
      observations.push(await executeScenario(adapter, scenario));
    } catch (error) {
      if (options.stopOnError !== false) throw error;
      observations.push({
        scenarioId: scenario.id,
        automatable: false,
        reason: error.message,
        evidenceLevel: options.evidenceLevel
      });
    }
  }
  return {schemaVersion: 1, observationCount: observations.length, observations};
}

async function executeRandomSequence(adapter, sequence) {
  if (typeof adapter?.runSequence === 'function') return adapter.runSequence(sequence);
  const replaceSource = requiredMethod(adapter, 'replaceSource');
  const setMode = requiredMethod(adapter, 'setMode');
  const setSelection = requiredMethod(adapter, 'setSelection');
  const performAction = requiredMethod(adapter, 'performAction');
  const capture = requiredMethod(adapter, 'capture');
  if (typeof adapter.openFixture === 'function') await adapter.openFixture(sequence);
  await replaceSource(sequence.initialSource, sequence);
  await setMode(sequence.mode, {active: sequence.mode !== 'reading'}, sequence);
  await setSelection(sequence.initialSelection, sequence);
  const trace = [];
  for (let index = 0; index < sequence.actions.length; index += 1) {
    const action = sequence.actions[index];
    await performAction(action, sequence);
    trace.push({index, action, observation: await capture(sequence)});
  }
  return {
    scenarioId: sequence.id,
    sequenceId: sequence.id,
    trace,
    finalObservation: trace.at(-1)?.observation || await capture(sequence)
  };
}

module.exports = Object.freeze({
  executeCorpus,
  executeRandomSequence,
  executeScenario,
  expandedActions
});
