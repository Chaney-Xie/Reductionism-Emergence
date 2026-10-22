'use strict';

const {
  STATUS,
  compareScenario,
  countStatuses
} = require('./comparator');

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function scenarioArray(document) {
  if (Array.isArray(document)) return document;
  const root = assertObject(document, 'Scenario document');
  const candidates = [
    root.sequence ? [root.sequence] : null,
    root.scenarios,
    root.sequences,
    root.random?.sequences
  ];
  const scenarios = candidates.find((candidate) => (
    Array.isArray(candidate) && candidate.every((entry) => entry && typeof entry === 'object')
  ));
  if (!scenarios) {
    throw new TypeError(
      'Scenario document must contain scenario objects in scenarios[], sequences[], or random.sequences[].'
    );
  }
  return scenarios;
}

function scenarioIdArray(document) {
  const values = Array.isArray(document)
    ? document
    : assertObject(document, 'Scenario ID document').scenarios;
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string' && value)) {
    throw new TypeError('Scenario ID document must be an array or contain string scenarios[].');
  }
  if (new Set(values).size !== values.length) {
    throw new Error('Scenario ID document contains duplicate scenario IDs.');
  }
  return values;
}

function selectScenariosByEvidenceIds(scenarioDocument, scenarioIdDocument) {
  const scenarios = scenarioArray(scenarioDocument);
  const scenarioById = indexUnique(scenarios, { idField: 'id', label: 'scenario' });
  const ids = scenarioIdArray(scenarioIdDocument);
  const missing = ids.filter((id) => !scenarioById.has(id));
  if (missing.length) {
    throw new Error(`Generated corpus is missing requested scenario IDs: ${missing.join(', ')}`);
  }
  return {
    schemaVersion: 1,
    selectedScenarioCount: ids.length,
    sourceCorpusScenarioCount: scenarios.length,
    sourceCorpusSha256: scenarioDocument?.corpusSha256 || null,
    scenarios: ids.map((id) => scenarioById.get(id))
  };
}

function observationArray(document, role) {
  if (Array.isArray(document)) return document;
  const root = assertObject(document, `${role} evidence document`);
  const resultKeys = role === 'Obsidian'
    ? ['obsidian', 'o1', 'obsidian-o1']
    : ['viewer', 'v1', 'viewer-v1'];
  const candidates = [
    ...resultKeys.map((key) => root.results?.[key]?.observations),
    ...resultKeys.map((key) => root[key]?.observations),
    root.observations
  ];
  const observations = candidates.find(Array.isArray);
  if (!observations) {
    throw new TypeError(
      `${role} evidence must be an observation array or realRuntimeCli output containing ${role} observations.`
    );
  }
  return observations;
}

function indexUnique(entries, { idField, label }) {
  const indexed = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    const id = entry[idField];
    if (typeof id !== 'string' || !id) {
      throw new TypeError(`${label} entry is missing string ${idField}.`);
    }
    if (indexed.has(id)) throw new Error(`Duplicate ${label} scenario ID: ${id}`);
    indexed.set(id, entry);
  }
  return indexed;
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

function envelope(scenario, status, reasonCode, reason, details = {}) {
  return {
    scenarioId: scenario.id,
    fixtureId: scenario.fixtureId || null,
    syntaxFamily: scenario.syntaxFamily || null,
    mode: scenario.mode || null,
    requiredObservations: scenario.requiredObservations
      || ['source', 'selection', 'physical', 'semantic'],
    status,
    reasonCode,
    reason,
    ...details
  };
}

function compareFinalTraceScenario(scenario, obsidian, viewer, overridesDocument = {}) {
  if (obsidian?.automatable === false) {
    return envelope(
      scenario,
      STATUS.OBSIDIAN_NOT_AUTOMATABLE,
      'obsidian-not-automatable',
      obsidian.reason
        || obsidian.metadata?.automationError?.message
        || 'The Obsidian observation was marked automatable:false.'
    );
  }

  if (!obsidian || !viewer) {
    const missing = [
      ...(!obsidian ? ['Obsidian'] : []),
      ...(!viewer ? ['Viewer'] : [])
    ];
    return envelope(
      scenario,
      STATUS.AMBIGUOUS,
      'missing-runtime-observation',
      `Missing ${missing.join(' and ')} observation for this scenario.`,
      { missing }
    );
  }

  if (viewer.automatable === false) {
    return envelope(
      scenario,
      STATUS.AMBIGUOUS,
      'viewer-not-automatable',
      viewer.reason
        || viewer.metadata?.automationError?.message
        || 'The Viewer observation was marked automatable:false.'
    );
  }

  if (viewer.evidenceLevel !== 'V1') {
    return envelope(
      scenario,
      STATUS.AMBIGUOUS,
      'viewer-evidence-not-v1',
      `Expected V1 evidence but received ${String(viewer.evidenceLevel ?? 'none')}.`,
      { evidence: { obsidian: obsidian.evidenceLevel ?? null, viewer: viewer.evidenceLevel ?? null } }
    );
  }

  const integrityFailure = integrityFailureEntries(viewer.integrityFailure);
  if (integrityFailure.length) {
    return envelope(
      scenario,
      STATUS.VIEWER_FAIL,
      'viewer-integrity-failure',
      `Viewer integrity checks failed: ${integrityFailure.join(', ')}.`,
      { integrityFailure }
    );
  }

  if (obsidian.evidenceLevel !== 'O1') {
    return envelope(
      scenario,
      STATUS.OBSIDIAN_NOT_AUTOMATABLE,
      'obsidian-evidence-not-o1',
      `Expected O1 evidence but received ${String(obsidian.evidenceLevel ?? 'none')}.`,
      { evidence: { obsidian: obsidian.evidenceLevel ?? null, viewer: viewer.evidenceLevel } }
    );
  }

  return compareScenario(scenario, obsidian, viewer, overridesDocument, {
    strictEvidence: true
  });
}

function unexpectedIds(observations, scenarios) {
  return [...observations.keys()].filter((id) => !scenarios.has(id));
}

/**
 * Pair isolated real-runtime O1 and V1 final observations by scenarioId and
 * compare only the generated scenario's requiredObservations.
 */
function compareFinalTraceEvidence(
  scenarioDocument,
  obsidianEvidenceDocument,
  viewerEvidenceDocument,
  overridesDocument = {}
) {
  const scenarios = scenarioArray(scenarioDocument);
  const obsidianObservations = observationArray(obsidianEvidenceDocument, 'Obsidian');
  const viewerObservations = observationArray(viewerEvidenceDocument, 'Viewer');
  const scenarioById = indexUnique(scenarios, { idField: 'id', label: 'scenario' });
  const obsidianById = indexUnique(obsidianObservations, {
    idField: 'scenarioId',
    label: 'Obsidian observation'
  });
  const viewerById = indexUnique(viewerObservations, {
    idField: 'scenarioId',
    label: 'Viewer observation'
  });
  const results = scenarios.map((scenario) => compareFinalTraceScenario(
    scenario,
    obsidianById.get(scenario.id),
    viewerById.get(scenario.id),
    overridesDocument
  ));

  return {
    schemaVersion: 1,
    kind: 'o1-v1-final-trace-comparison',
    scenarioCount: scenarios.length,
    scenarioSource: {
      corpusSha256: scenarioDocument?.sourceCorpusSha256
        || scenarioDocument?.corpusSha256
        || null,
      corpusScenarioCount: scenarioDocument?.sourceCorpusScenarioCount
        || scenarioDocument?.scenarioCount
        || scenarioDocument?.count
        || scenarios.length,
      selectedScenarioCount: scenarios.length
    },
    counts: countStatuses(results),
    coverage: {
      obsidianObservationCount: obsidianObservations.length,
      viewerObservationCount: viewerObservations.length,
      unexpectedObsidianScenarioIds: unexpectedIds(obsidianById, scenarioById),
      unexpectedViewerScenarioIds: unexpectedIds(viewerById, scenarioById)
    },
    results
  };
}

function isCleanFinalTrace(result) {
  assertObject(result, 'Final trace result');
  return Array.isArray(result.results) && result.results.every((entry) => (
    entry.status === STATUS.MATCH
    || entry.status === STATUS.INTENTIONAL_VIEWER_OVERRIDE
  ));
}

module.exports = Object.freeze({
  STATUS,
  compareFinalTraceEvidence,
  compareFinalTraceScenario,
  integrityFailureEntries,
  isCleanFinalTrace,
  observationArray,
  scenarioArray,
  scenarioIdArray,
  selectScenariosByEvidenceIds
});
