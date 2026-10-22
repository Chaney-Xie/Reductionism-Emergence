const STATUS = Object.freeze({
  MATCH: 'MATCH',
  VIEWER_FAIL: 'VIEWER_FAIL',
  AMBIGUOUS: 'AMBIGUOUS'
});

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function scenarioArray(document) {
  if (Array.isArray(document)) return document;
  const root = assertObject(document, 'Scenario document');
  return Array.isArray(root.scenarios) ? root.scenarios : root.sequences;
}

function viewerObservationArray(document) {
  if (Array.isArray(document)) return document;
  const root = assertObject(document, 'Viewer evidence document');
  const candidates = [
    root.results?.viewer?.observations,
    root.results?.v1?.observations,
    root.results?.['viewer-v1']?.observations,
    root.viewer?.observations,
    root.observations
  ];
  return candidates.find(Array.isArray);
}

function assertUniqueIds(entries, label) {
  const indexed = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    if (typeof entry.id !== 'string' && typeof entry.scenarioId !== 'string') {
      throw new TypeError(`${label} entry is missing a string scenario ID.`);
    }
    const id = entry.id ?? entry.scenarioId;
    if (indexed.has(id)) throw new Error(`Duplicate ${label} scenario ID: ${id}`);
    indexed.set(id, entry);
  }
  return indexed;
}

function expectedForScenario(scenario) {
  const expected = assertObject(scenario.oracleExpected, `${scenario.id}.oracleExpected`);
  if (typeof expected.source !== 'string') {
    throw new TypeError(`${scenario.id}.oracleExpected.source must be a string.`);
  }
  const selectionRequired = !Array.isArray(scenario.requiredObservations)
    || scenario.requiredObservations.includes('selection');
  let selection = null;
  if (selectionRequired) {
    selection = assertObject(
      expected.selection,
      `${scenario.id}.oracleExpected.selection`
    );
    for (const field of ['anchor', 'focus']) {
      if (!Number.isSafeInteger(selection[field]) || selection[field] < 0) {
        throw new TypeError(
          `${scenario.id}.oracleExpected.selection.${field} must be a non-negative integer.`
        );
      }
    }
  }
  return {
    source: expected.source,
    selection: selectionRequired
      ? { anchor: selection.anchor, focus: selection.focus }
      : null,
    selectionRequired
  };
}

function actualForObservation(observation) {
  if (!observation) return null;
  return {
    source: typeof observation.source === 'string' ? observation.source : null,
    selection: observation.selection && typeof observation.selection === 'object'
      ? {
          anchor: Number.isSafeInteger(observation.selection.anchor)
            ? observation.selection.anchor
            : null,
          focus: Number.isSafeInteger(observation.selection.focus)
            ? observation.selection.focus
            : null
        }
      : null
  };
}

function compareAuthoritativeFields(expected, actual) {
  if (!actual) return [];
  const differences = [];
  if (actual.source !== expected.source) {
    differences.push({ path: 'source', expected: expected.source, actual: actual.source });
  }
  if (expected.selectionRequired) {
    for (const field of ['anchor', 'focus']) {
      const actualValue = actual.selection?.[field] ?? null;
      if (actualValue !== expected.selection[field]) {
        differences.push({
          path: `selection.${field}`,
          expected: expected.selection[field],
          actual: actualValue
        });
      }
    }
  }
  return differences;
}

function integrityFailureEntries(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') return value ? [value] : [];
  if (value === true) return ['unspecified'];
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, failed]) => Boolean(failed))
      .map(([surface]) => surface);
  }
  return [];
}

function classifyScenario(scenario, observation) {
  const expected = expectedForScenario(scenario);
  const actual = actualForObservation(observation);
  const differences = compareAuthoritativeFields(expected, actual);
  const common = {
    scenarioId: scenario.id,
    syntaxFamily: scenario.syntaxFamily || null,
    productDecisionRequired: scenario.productDecisionRequired === true,
    expected,
    actual,
    differences
  };

  if (!observation) {
    return {
      ...common,
      status: STATUS.AMBIGUOUS,
      reasonCode: 'missing-viewer-observation',
      reason: 'No Viewer observation was supplied for the scenario.',
      integrityFailure: []
    };
  }

  const integrityFailure = integrityFailureEntries(observation.integrityFailure);
  if (integrityFailure.length) {
    return {
      ...common,
      status: STATUS.VIEWER_FAIL,
      reasonCode: 'viewer-integrity-failure',
      reason: `Viewer authoritative surfaces disagree: ${integrityFailure.join(', ')}.`,
      integrityFailure
    };
  }

  if (observation.automatable === false) {
    return {
      ...common,
      status: STATUS.AMBIGUOUS,
      reasonCode: 'viewer-not-automatable',
      reason: observation.metadata?.automationError?.message
        || 'The Viewer observation was marked automatable:false.',
      integrityFailure
    };
  }

  if (observation.evidenceLevel !== 'V1') {
    return {
      ...common,
      status: STATUS.AMBIGUOUS,
      reasonCode: 'viewer-evidence-not-v1',
      reason: `Expected V1 evidence, received ${String(observation.evidenceLevel ?? 'none')}.`,
      integrityFailure
    };
  }

  if (differences.length === 0) {
    return {
      ...common,
      status: STATUS.MATCH,
      reasonCode: 'authoritative-fields-match',
      reason: 'Viewer source and selection exactly match the Obsidian oracle.',
      integrityFailure
    };
  }

  if (scenario.productDecisionRequired === true) {
    return {
      ...common,
      status: STATUS.AMBIGUOUS,
      reasonCode: 'product-decision-required',
      reason: 'The authoritative mismatch is explicitly reserved for a product decision.',
      integrityFailure
    };
  }

  return {
    ...common,
    status: STATUS.VIEWER_FAIL,
    reasonCode: 'authoritative-fields-mismatch',
    reason: 'Viewer source and/or selection differs from the Obsidian oracle.',
    integrityFailure
  };
}

function buildTotals(results, observationCount, unexpectedObservationCount) {
  const count = (predicate) => results.filter(predicate).length;
  return {
    scenarioCount: results.length,
    observationCount,
    classifiedCount: results.length,
    MATCH: count((result) => result.status === STATUS.MATCH),
    VIEWER_FAIL: count((result) => result.status === STATUS.VIEWER_FAIL),
    AMBIGUOUS: count((result) => result.status === STATUS.AMBIGUOUS),
    productDecisionAmbiguous: count(
      (result) => result.reasonCode === 'product-decision-required'
    ),
    nonAutomatableAmbiguous: count(
      (result) => result.reasonCode === 'viewer-not-automatable'
    ),
    missingObservationAmbiguous: count(
      (result) => result.reasonCode === 'missing-viewer-observation'
    ),
    nonV1EvidenceAmbiguous: count(
      (result) => result.reasonCode === 'viewer-evidence-not-v1'
    ),
    integrityFailureViewerFail: count(
      (result) => result.reasonCode === 'viewer-integrity-failure'
    ),
    sourceMismatchCount: count(
      (result) => result.differences.some((difference) => difference.path === 'source')
    ),
    selectionMismatchCount: count(
      (result) => result.differences.some((difference) => difference.path.startsWith('selection.'))
    ),
    unexpectedObservationCount
  };
}

/**
 * Compare a source-repair scenario document with realRuntimeCli Viewer output.
 * The Viewer observation's top-level source is the authoritative persisted source.
 */
export function compareRepairGateEvidence(scenarioDocument, viewerEvidenceDocument) {
  const scenarios = scenarioArray(scenarioDocument);
  if (!Array.isArray(scenarios)) {
    throw new TypeError(
      'Scenario document must be an array or contain scenarios[] or sequences[].'
    );
  }
  const observations = viewerObservationArray(viewerEvidenceDocument);
  if (!Array.isArray(observations)) {
    throw new TypeError(
      'Viewer evidence must be an observation array or realRuntimeCli output containing Viewer observations.'
    );
  }

  const scenarioById = assertUniqueIds(scenarios, 'scenario');
  const observationById = assertUniqueIds(observations, 'Viewer observation');
  const results = scenarios.map((scenario) => (
    classifyScenario(scenario, observationById.get(scenario.id))
  ));
  const unexpectedObservationCount = [...observationById.keys()]
    .filter((id) => !scenarioById.has(id)).length;

  return {
    schemaVersion: 1,
    kind: 'obsidian-source-repair-gate-evidence',
    totals: buildTotals(results, observations.length, unexpectedObservationCount),
    results
  };
}

export function isCleanRepairGate(result) {
  assertObject(result, 'Repair gate result');
  const classifications = Array.isArray(result.results) ? result.results : [];
  return classifications.every((classification) => (
    classification.status === STATUS.MATCH
    || classification.reasonCode === 'product-decision-required'
  ));
}

export { STATUS };
