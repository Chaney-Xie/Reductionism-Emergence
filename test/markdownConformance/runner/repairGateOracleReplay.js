'use strict';

const { observationArray, scenarioArray } = require('./finalTraceEvidence');
const { deepEqual } = require('./utils');

const STATUS = Object.freeze({
  REPRODUCIBLE: 'REPRODUCIBLE',
  OBSIDIAN_NOT_AUTOMATABLE: 'OBSIDIAN_NOT_AUTOMATABLE',
  AMBIGUOUS_ORACLE_MISMATCH: 'AMBIGUOUS_ORACLE_MISMATCH'
});

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function indexUnique(entries, field, label) {
  const indexed = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    const id = entry[field];
    if (typeof id !== 'string' || !id) {
      throw new TypeError(`${label} entry is missing string ${field}.`);
    }
    if (indexed.has(id)) throw new Error(`Duplicate ${label} ${field}: ${id}`);
    indexed.set(id, entry);
  }
  return indexed;
}

function exactOracle(scenario) {
  const expected = assertObject(scenario.oracleExpected, `${scenario.id}.oracleExpected`);
  if (typeof expected.source !== 'string') {
    throw new TypeError(`${scenario.id}.oracleExpected.source must be a string.`);
  }
  const selection = assertObject(expected.selection, `${scenario.id}.oracleExpected.selection`);
  for (const field of ['anchor', 'focus']) {
    if (!Number.isSafeInteger(selection[field]) || selection[field] < 0) {
      throw new TypeError(
        `${scenario.id}.oracleExpected.selection.${field} must be a non-negative integer.`
      );
    }
  }
  return {
    source: expected.source,
    selection: { anchor: selection.anchor, focus: selection.focus }
  };
}

function exactObservation(observation) {
  if (!observation) return null;
  return {
    source: typeof observation.source === 'string' ? observation.source : null,
    selection: {
      anchor: Number.isSafeInteger(observation.selection?.anchor)
        ? observation.selection.anchor
        : null,
      focus: Number.isSafeInteger(observation.selection?.focus)
        ? observation.selection.focus
        : null
    }
  };
}

function authoritativeDifferences(expected, actual, prefix = '') {
  const differences = [];
  if (actual?.source !== expected.source) {
    differences.push({
      path: `${prefix}source`,
      expected: expected.source,
      actual: actual?.source ?? null
    });
  }
  for (const field of ['anchor', 'focus']) {
    if (actual?.selection?.[field] !== expected.selection[field]) {
      differences.push({
        path: `${prefix}selection.${field}`,
        expected: expected.selection[field],
        actual: actual?.selection?.[field] ?? null
      });
    }
  }
  return differences;
}

function traceEntryObservation(entry) {
  return entry?.observation || entry || null;
}

function actionReplayFor(scenario, observation) {
  const expectedActions = Array.isArray(scenario.actions) ? scenario.actions : [];
  const trace = Array.isArray(observation?.actionTrace) ? observation.actionTrace : null;
  if (!trace) {
    return {
      status: 'NOT_CAPTURED',
      expectedActionCount: expectedActions.length,
      capturedActionCount: 0,
      differences: []
    };
  }

  const differences = [];
  if (trace.length !== expectedActions.length) {
    differences.push({
      path: 'actionTrace.length',
      expected: expectedActions.length,
      actual: trace.length
    });
  }
  const sharedLength = Math.min(trace.length, expectedActions.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const entry = trace[index];
    const actualIndex = Number(entry?.index ?? entry?.actionIndex ?? index);
    if (actualIndex !== index) {
      differences.push({
        path: `actionTrace.${index}.index`,
        expected: index,
        actual: actualIndex
      });
    }
    if (!deepEqual(entry?.action, expectedActions[index])) {
      differences.push({
        path: `actionTrace.${index}.action`,
        expected: expectedActions[index],
        actual: entry?.action ?? null
      });
    }
  }

  const metadata = observation?.metadata?.actionTrace || null;
  if (metadata?.complete === false) {
    differences.push({ path: 'metadata.actionTrace.complete', expected: true, actual: false });
  }
  for (const field of ['expectedActionCount', 'capturedActionCount']) {
    if (Number.isSafeInteger(metadata?.[field])
      && metadata[field] !== expectedActions.length) {
      differences.push({
        path: `metadata.actionTrace.${field}`,
        expected: expectedActions.length,
        actual: metadata[field]
      });
    }
  }

  if (trace.length) {
    const traceFinal = exactObservation(traceEntryObservation(trace[trace.length - 1]));
    const parentFinal = exactObservation(observation);
    differences.push(...authoritativeDifferences(
      parentFinal,
      traceFinal,
      'actionTrace.final.'
    ));
  }

  return {
    status: differences.length ? 'MISMATCH' : 'VERIFIED',
    expectedActionCount: expectedActions.length,
    capturedActionCount: trace.length,
    complete: metadata?.complete ?? trace.length === expectedActions.length,
    timingPreservingIntermediateCapture:
      metadata?.timingPreservingIntermediateCapture ?? null,
    differences
  };
}

function originReplayFor(scenario) {
  const metadata = scenario.repairMetadata;
  if (!metadata || typeof metadata !== 'object') {
    return { status: 'UNAVAILABLE', differences: [] };
  }
  const actions = Array.isArray(scenario.actions) ? scenario.actions : [];
  const preserved = metadata.prefixStatePreserved === true;
  const honestPrefixMetadata = Object.prototype.hasOwnProperty.call(
    metadata,
    'prefixStateRequired'
  );
  const prefixRequired = honestPrefixMetadata
    ? metadata.prefixStateRequired === true
    : preserved;
  const dependencySuffixPreserved = honestPrefixMetadata
    && metadata.dependencySuffixPreserved === true;
  const historyReduced = metadata.historyDependencyReduced === true;
  const differences = [];
  const actionIndex = metadata.firstDivergentActionIndex;
  const actionNumber = metadata.firstDivergentActionNumber;
  if (Number.isSafeInteger(actionIndex) && Number.isSafeInteger(actionNumber)
    && actionIndex + 1 !== actionNumber) {
    differences.push({
      path: 'repairMetadata.firstDivergentActionNumber',
      expected: actionIndex + 1,
      actual: actionNumber
    });
  }
  if (Number.isSafeInteger(metadata.minimizedActionCount)
    && metadata.minimizedActionCount !== actions.length) {
    differences.push({
      path: 'repairMetadata.minimizedActionCount',
      expected: actions.length,
      actual: metadata.minimizedActionCount
    });
  }
  if (honestPrefixMetadata && Number.isSafeInteger(actionIndex)) {
    const replayStart = metadata.originReplayStartActionIndex;
    if (!Number.isSafeInteger(replayStart)
      || replayStart < 0
      || replayStart > actionIndex) {
      differences.push({
        path: 'repairMetadata.originReplayStartActionIndex',
        expected: `an integer from 0 through ${actionIndex}`,
        actual: replayStart ?? null
      });
    } else {
      const expectedLength = actionIndex - replayStart + 1;
      if (actions.length !== expectedLength) {
        differences.push({
          path: 'actions.length',
          expected: expectedLength,
          actual: actions.length
        });
      }
      const expectedPrefixPreserved = prefixRequired
        && replayStart === 0
        && actionIndex > 0;
      if (preserved !== expectedPrefixPreserved) {
        differences.push({
          path: 'repairMetadata.prefixStatePreserved',
          expected: expectedPrefixPreserved,
          actual: preserved
        });
      }
      const expectedDependencySuffix = prefixRequired
        && replayStart > 0
        && replayStart < actionIndex;
      if (dependencySuffixPreserved !== expectedDependencySuffix) {
        differences.push({
          path: 'repairMetadata.dependencySuffixPreserved',
          expected: expectedDependencySuffix,
          actual: dependencySuffixPreserved
        });
      }
      if (prefixRequired && actionIndex > 0
        && !expectedPrefixPreserved && !expectedDependencySuffix) {
        differences.push({
          path: 'repairMetadata.originReplayStartActionIndex',
          expected: `an integer from 0 through ${actionIndex - 1}`,
          actual: replayStart
        });
      }
      if (metadata.historyDependencyResolved === true
        && metadata.historyReplayStartActionIndex !== replayStart) {
        differences.push({
          path: 'repairMetadata.historyReplayStartActionIndex',
          expected: replayStart,
          actual: metadata.historyReplayStartActionIndex ?? null
        });
      }
      if (metadata.caretAffinityDependencyPreserved === true
        && metadata.caretAffinityReplayStartActionIndex !== replayStart) {
        differences.push({
          path: 'repairMetadata.caretAffinityReplayStartActionIndex',
          expected: replayStart,
          actual: metadata.caretAffinityReplayStartActionIndex ?? null
        });
      }
    }
    if (!prefixRequired && actions.length !== 1) {
      differences.push({ path: 'actions.length', expected: 1, actual: actions.length });
    }
  } else if (preserved && Number.isSafeInteger(actionNumber)) {
    const replayStart = metadata.historyReplayStartActionIndex;
    if (historyReduced) {
      if (!Number.isSafeInteger(replayStart)
        || replayStart < 0
        || replayStart > actionIndex) {
        differences.push({
          path: 'repairMetadata.historyReplayStartActionIndex',
          expected: `an integer from 0 through ${actionIndex}`,
          actual: replayStart ?? null
        });
      } else {
        const expectedLength = actionIndex - replayStart + 1;
        if (actions.length !== expectedLength) {
          differences.push({
            path: 'actions.length',
            expected: expectedLength,
            actual: actions.length
          });
        }
      }
    } else if (actions.length !== actionNumber) {
      differences.push({
        path: 'actions.length',
        expected: actionNumber,
        actual: actions.length
      });
    }
  }
  if (!honestPrefixMetadata && historyReduced && !preserved) {
    differences.push({
      path: 'repairMetadata.prefixStatePreserved',
      expected: true,
      actual: false
    });
  }
  if (!honestPrefixMetadata && !preserved && actions.length !== 1) {
    differences.push({ path: 'actions.length', expected: 1, actual: actions.length });
  }
  if (metadata.expectedO1) {
    const expected = exactOracle(scenario);
    const metadataExpected = exactObservation(metadata.expectedO1);
    differences.push(...authoritativeDifferences(
      expected,
      metadataExpected,
      'repairMetadata.expectedO1.'
    ));
  }

  return {
    status: differences.length
      ? 'MISMATCH'
      : (preserved || dependencySuffixPreserved)
        ? 'VERIFIED'
        : 'REBASED_NOT_APPLICABLE',
    originScenarioId: typeof metadata.originScenarioId === 'string'
      ? metadata.originScenarioId
      : null,
    prefixStatePreserved: preserved,
    ...(honestPrefixMetadata ? {
      prefixStateRequired: prefixRequired,
      dependencySuffixPreserved
    } : {}),
    firstDivergentActionIndex: Number.isSafeInteger(actionIndex) ? actionIndex : null,
    firstDivergentActionNumber: Number.isSafeInteger(actionNumber) ? actionNumber : null,
    gateActionCount: actions.length,
    differences
  };
}

function unavailableResult(scenario, observation, expected, reasonCode, reason) {
  return {
    scenarioId: scenario.id,
    originScenarioId: scenario.repairMetadata?.originScenarioId || null,
    fixtureId: scenario.fixtureId || null,
    mode: scenario.mode || null,
    status: STATUS.OBSIDIAN_NOT_AUTOMATABLE,
    reasonCode,
    reason,
    expected,
    actual: exactObservation(observation),
    evidenceLevel: observation?.evidenceLevel ?? null,
    automatable: observation?.automatable ?? null,
    differences: [],
    actionReplay: actionReplayFor(scenario, observation),
    originReplay: originReplayFor(scenario)
  };
}

function classifyReplay(scenario, observation) {
  const expected = exactOracle(scenario);
  if (!observation) {
    return unavailableResult(
      scenario,
      null,
      expected,
      'missing-obsidian-observation',
      'No Obsidian observation was supplied for the gate scenario.'
    );
  }
  if (observation.automatable === false) {
    return unavailableResult(
      scenario,
      observation,
      expected,
      'obsidian-not-automatable',
      observation.reason
        || observation.metadata?.automationError?.message
        || 'The Obsidian observation was marked automatable:false.'
    );
  }
  if (observation.evidenceLevel !== 'O1') {
    return unavailableResult(
      scenario,
      observation,
      expected,
      'obsidian-evidence-not-o1',
      `Expected O1 evidence, received ${String(observation.evidenceLevel ?? 'none')}.`
    );
  }

  const actual = exactObservation(observation);
  const differences = authoritativeDifferences(expected, actual);
  const actionReplay = actionReplayFor(scenario, observation);
  const originReplay = originReplayFor(scenario);
  const common = {
    scenarioId: scenario.id,
    originScenarioId: scenario.repairMetadata?.originScenarioId || null,
    fixtureId: scenario.fixtureId || null,
    mode: scenario.mode || null,
    expected,
    actual,
    evidenceLevel: observation.evidenceLevel,
    automatable: observation.automatable,
    differences,
    actionReplay,
    originReplay
  };

  if (differences.length) {
    return {
      ...common,
      status: STATUS.AMBIGUOUS_ORACLE_MISMATCH,
      reasonCode: 'oracle-final-mismatch',
      reason: 'Fresh O1 source and/or selection does not reproduce the embedded oracle.'
    };
  }
  if (actionReplay.status === 'MISMATCH') {
    return {
      ...common,
      status: STATUS.AMBIGUOUS_ORACLE_MISMATCH,
      reasonCode: 'action-replay-mismatch',
      reason: 'The captured O1 action trace does not reproduce the generated gate actions.'
    };
  }
  if (originReplay.status === 'MISMATCH') {
    return {
      ...common,
      status: STATUS.AMBIGUOUS_ORACLE_MISMATCH,
      reasonCode: 'origin-metadata-mismatch',
      reason: 'The generated gate is inconsistent with its origin repair metadata.'
    };
  }
  return {
    ...common,
    status: STATUS.REPRODUCIBLE,
    reasonCode: 'oracle-reproduced',
    reason: actionReplay.status === 'VERIFIED'
      ? 'Fresh O1 source/selection and the captured action trace reproduce the embedded oracle.'
      : 'Fresh O1 source/selection reproduce the embedded oracle; no action trace was captured.'
  };
}

function buildTotals(results, observations, unexpectedObservationCount) {
  const count = (predicate) => results.filter(predicate).length;
  return {
    scenarioCount: results.length,
    observationCount: observations.length,
    classifiedCount: results.length,
    REPRODUCIBLE: count((result) => result.status === STATUS.REPRODUCIBLE),
    OBSIDIAN_NOT_AUTOMATABLE: count(
      (result) => result.status === STATUS.OBSIDIAN_NOT_AUTOMATABLE
    ),
    AMBIGUOUS_ORACLE_MISMATCH: count(
      (result) => result.status === STATUS.AMBIGUOUS_ORACLE_MISMATCH
    ),
    exactFinalMismatchCount: count((result) => result.reasonCode === 'oracle-final-mismatch'),
    verifiedActionReplayCount: count((result) => result.actionReplay.status === 'VERIFIED'),
    actionReplayMismatchCount: count((result) => result.actionReplay.status === 'MISMATCH'),
    actionReplayNotCapturedCount: count(
      (result) => result.actionReplay.status === 'NOT_CAPTURED'
    ),
    verifiedOriginPrefixCount: count((result) => result.originReplay.status === 'VERIFIED'),
    rebasedOriginPrefixCount: count(
      (result) => result.originReplay.status === 'REBASED_NOT_APPLICABLE'
    ),
    originMetadataMismatchCount: count(
      (result) => result.originReplay.status === 'MISMATCH'
    ),
    missingObservationCount: count(
      (result) => result.reasonCode === 'missing-obsidian-observation'
    ),
    unexpectedObservationCount
  };
}

function validateRepairGateOracleReplay(gateDocument, obsidianEvidenceDocument) {
  const scenarios = scenarioArray(gateDocument);
  const observations = observationArray(obsidianEvidenceDocument, 'Obsidian');
  const scenarioById = indexUnique(scenarios, 'id', 'gate scenario');
  const observationById = indexUnique(observations, 'scenarioId', 'Obsidian observation');
  const results = scenarios.map((scenario) => (
    classifyReplay(scenario, observationById.get(scenario.id))
  ));
  const unexpectedObservationCount = [...observationById.keys()]
    .filter((id) => !scenarioById.has(id)).length;

  return {
    schemaVersion: 1,
    kind: 'repair-gate-o1-oracle-replay-validation',
    gate: {
      kind: gateDocument?.kind || null,
      corpusSha256: gateDocument?.corpusSha256 || null,
      sourceCorpusSha256: gateDocument?.sourceCorpusSha256 || null
    },
    totals: buildTotals(results, observations, unexpectedObservationCount),
    results
  };
}

function isCleanOracleReplay(result) {
  assertObject(result, 'O1 replay result');
  return Array.isArray(result.results) && result.results.every((entry) => (
    entry.status === STATUS.REPRODUCIBLE
  ));
}

module.exports = Object.freeze({
  STATUS,
  actionReplayFor,
  classifyReplay,
  isCleanOracleReplay,
  originReplayFor,
  validateRepairGateOracleReplay
});
