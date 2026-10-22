'use strict';

const {
  canonicalize,
  deepEqual,
  getPath,
  hasPath,
  matchesWhen,
  pathMatches
} = require('./utils');
const { normalizeObservation } = require('./observations');

const STATUS = Object.freeze({
  MATCH: 'MATCH',
  INTENTIONAL_VIEWER_OVERRIDE: 'INTENTIONAL_VIEWER_OVERRIDE',
  VIEWER_FAIL: 'VIEWER_FAIL',
  OBSIDIAN_NOT_AUTOMATABLE: 'OBSIDIAN_NOT_AUTOMATABLE',
  AMBIGUOUS: 'AMBIGUOUS'
});

const OBSERVATION_PATHS = Object.freeze({
  source: 'source',
  selection: 'selection',
  physical: 'physical',
  semantic: 'semantic',
  presentation: 'presentation',
  geometry: 'geometry',
  visibleText: 'visibleText'
});

function diffValues(expected, actual, basePath, differences) {
  if (deepEqual(expected, actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      diffValues(expected[index], actual[index], `${basePath}.${index}`, differences);
    }
    return;
  }
  const expectedObject = expected && typeof expected === 'object' && !Array.isArray(expected);
  const actualObject = actual && typeof actual === 'object' && !Array.isArray(actual);
  if (expectedObject && actualObject) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    keys.forEach((key) => diffValues(
      expected[key],
      actual[key],
      basePath ? `${basePath}.${key}` : key,
      differences
    ));
    return;
  }
  differences.push({path: basePath, expected, actual});
}

function differenceAuthority(path) {
  if (path === 'source' || path.startsWith('source.')) return 1;
  if (path === 'selection' || path.startsWith('selection.')) return 2;
  if (path === 'physical' || path.startsWith('physical.')) return 3;
  if (path === 'semantic' || path.startsWith('semantic.')) return 4;
  if (path.includes('marker')) return 5;
  if (path.startsWith('presentation.')) return 6;
  if (path.startsWith('geometry.')) return 7;
  return 8;
}

function pathIsAllowed(pattern, path) {
  return pattern === path
    || path.startsWith(`${pattern}.`)
    || pathMatches(pattern, path);
}

function scenarioContext(scenario) {
  return {
    syntaxFamily: scenario.syntaxFamily,
    mode: scenario.mode,
    active: Boolean(scenario.state?.active),
    ...scenario.state
  };
}

function matchingOverrides(scenario, overridesDocument) {
  return (overridesDocument?.overrides || []).filter((override) => (
    (!override.syntaxFamilies || override.syntaxFamilies.includes(scenario.syntaxFamily))
    && matchesWhen(override.when, scenarioContext(scenario))
  ));
}

function evaluateExpectation(expectation, viewer, context) {
  if (!matchesWhen(expectation.when, context)) return {applicable: false, passed: true};
  if (!hasPath(viewer, expectation.path)) {
    return {applicable: true, passed: false, reason: `Viewer observation is missing ${expectation.path}.`};
  }
  const actual = getPath(viewer, expectation.path);
  if (Object.prototype.hasOwnProperty.call(expectation, 'equals')) {
    return {
      applicable: true,
      passed: deepEqual(actual, expectation.equals),
      actual,
      expected: expectation.equals
    };
  }
  if (Object.prototype.hasOwnProperty.call(expectation, 'notEquals')) {
    return {
      applicable: true,
      passed: !deepEqual(actual, expectation.notEquals),
      actual,
      forbidden: expectation.notEquals
    };
  }
  if (Array.isArray(expectation.oneOf)) {
    return {
      applicable: true,
      passed: expectation.oneOf.some((value) => deepEqual(value, actual)),
      actual,
      expectedOneOf: expectation.oneOf
    };
  }
  return {applicable: true, passed: false, reason: 'Expectation has no supported predicate.'};
}

function evaluateOverride(override, differences, viewer, scenario) {
  const context = scenarioContext(scenario);
  const unexpectedPaths = differences
    .map((difference) => difference.path)
    .filter((path) => !(override.allowedDifferencePaths || []).some((pattern) => (
      pathIsAllowed(pattern, path)
    )));
  const expectationResults = (override.expectations || []).map((expectation) => ({
    expectation,
    ...evaluateExpectation(expectation, viewer, context)
  }));
  const applicableExpectations = expectationResults.filter((result) => result.applicable);
  const failedExpectations = applicableExpectations.filter((result) => !result.passed);
  return {
    overrideId: override.id,
    applies: unexpectedPaths.length === 0
      && applicableExpectations.length > 0
      && failedExpectations.length === 0,
    unexpectedPaths,
    applicableExpectationCount: applicableExpectations.length,
    failedExpectations
  };
}

function evaluateOverrideSet(overrides, differences, viewer, scenario) {
  const context = scenarioContext(scenario);
  const patterns = overrides.flatMap((override) => override.allowedDifferencePaths || []);
  const unexpectedPaths = differences
    .map((difference) => difference.path)
    .filter((path) => !patterns.some((pattern) => pathIsAllowed(pattern, path)));
  const expectationResults = overrides.flatMap((override) => (
    (override.expectations || []).map((expectation) => ({
      overrideId: override.id,
      expectation,
      ...evaluateExpectation(expectation, viewer, context)
    }))
  ));
  const applicableExpectations = expectationResults.filter((result) => result.applicable);
  const failedExpectations = applicableExpectations.filter((result) => !result.passed);
  return {
    overrideIds: overrides.map((override) => override.id),
    applies: unexpectedPaths.length === 0
      && applicableExpectations.length > 0
      && failedExpectations.length === 0,
    unexpectedPaths,
    applicableExpectationCount: applicableExpectations.length,
    failedExpectations
  };
}

function missingRequired(observation, required) {
  return required.filter((name) => !observation.availability?.[name]);
}

function comparisonEnvelope(scenario, status, details = {}) {
  return canonicalize({
    scenarioId: scenario.id,
    fixtureId: scenario.fixtureId,
    syntaxFamily: scenario.syntaxFamily,
    mode: scenario.mode,
    actionId: scenario.action?.id,
    status,
    ...details
  });
}

function compareScenario(scenario, obsidianRaw, viewerRaw, overridesDocument = {}, options = {}) {
  if (!obsidianRaw || obsidianRaw.automatable === false) {
    return comparisonEnvelope(scenario, STATUS.OBSIDIAN_NOT_AUTOMATABLE, {
      reason: obsidianRaw?.reason || 'No automatable Obsidian observation was supplied.'
    });
  }
  if (!viewerRaw) {
    return comparisonEnvelope(scenario, STATUS.AMBIGUOUS, {
      reason: 'No Viewer observation was supplied.'
    });
  }
  if (Array.isArray(viewerRaw.integrityFailure) && viewerRaw.integrityFailure.length) {
    return comparisonEnvelope(scenario, STATUS.VIEWER_FAIL, {
      reason: `Viewer integrity checks failed: ${viewerRaw.integrityFailure.join(', ')}.`,
      integrityFailure: viewerRaw.integrityFailure
    });
  }
  if (viewerRaw.automatable === false) {
    return comparisonEnvelope(scenario, STATUS.AMBIGUOUS, {
      reason: viewerRaw.reason
        || viewerRaw.metadata?.automationError?.message
        || 'Viewer observation was not automatable.'
    });
  }
  const obsidian = normalizeObservation(obsidianRaw, {
    scenarioId: scenario.id,
    defaultEvidenceLevel: 'O1'
  });
  const viewer = normalizeObservation(viewerRaw, {
    scenarioId: scenario.id,
    defaultEvidenceLevel: 'V1'
  });
  if (scenario.ambiguity || obsidian.ambiguity || viewer.ambiguity) {
    return comparisonEnvelope(scenario, STATUS.AMBIGUOUS, {
      reason: scenario.ambiguity || obsidian.ambiguity || viewer.ambiguity,
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel}
    });
  }
  if (options.strictEvidence !== false && obsidian.evidenceLevel !== 'O1') {
    return comparisonEnvelope(scenario, STATUS.OBSIDIAN_NOT_AUTOMATABLE, {
      reason: `Expected O1 evidence but received ${obsidian.evidenceLevel}.`,
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel}
    });
  }
  if (options.strictEvidence !== false && viewer.evidenceLevel !== 'V1') {
    return comparisonEnvelope(scenario, STATUS.AMBIGUOUS, {
      reason: `Expected V1 evidence but received ${viewer.evidenceLevel}.`,
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel}
    });
  }
  const required = scenario.requiredObservations || ['source', 'selection', 'physical', 'semantic'];
  const missingObsidian = missingRequired(obsidian, required);
  if (missingObsidian.length) {
    return comparisonEnvelope(scenario, STATUS.OBSIDIAN_NOT_AUTOMATABLE, {
      reason: `Obsidian observation is missing: ${missingObsidian.join(', ')}.`,
      missingObservations: missingObsidian,
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel}
    });
  }
  const missingViewer = missingRequired(viewer, required);
  if (missingViewer.length) {
    return comparisonEnvelope(scenario, STATUS.AMBIGUOUS, {
      reason: `Viewer observation is missing: ${missingViewer.join(', ')}.`,
      missingObservations: missingViewer,
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel}
    });
  }

  const differences = [];
  required.forEach((name) => {
    const path = OBSERVATION_PATHS[name];
    if (path) diffValues(getPath(obsidian, path), getPath(viewer, path), path, differences);
  });
  differences.sort((left, right) => (
    differenceAuthority(left.path) - differenceAuthority(right.path)
    || left.path.localeCompare(right.path)
  ));
  if (!differences.length) {
    return comparisonEnvelope(scenario, STATUS.MATCH, {
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel},
      differences: []
    });
  }

  const overrides = matchingOverrides(scenario, overridesDocument);
  const overrideEvaluations = overrides
    .map((override) => evaluateOverride(override, differences, viewer, scenario));
  const combinedOverrideEvaluation = evaluateOverrideSet(overrides, differences, viewer, scenario);
  const accepted = overrideEvaluations.find((evaluation) => evaluation.applies)
    || (combinedOverrideEvaluation.applies ? combinedOverrideEvaluation : null);
  if (accepted) {
    return comparisonEnvelope(scenario, STATUS.INTENTIONAL_VIEWER_OVERRIDE, {
      overrideId: accepted.overrideId || accepted.overrideIds.join('+'),
      evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel},
      differences
    });
  }
  return comparisonEnvelope(scenario, STATUS.VIEWER_FAIL, {
    evidence: {obsidian: obsidian.evidenceLevel, viewer: viewer.evidenceLevel},
    sourceAuthorityFailed: differences.some((difference) => (
      difference.path === 'source' || difference.path.startsWith('source.')
    )),
    differences,
    overrideEvaluations,
    combinedOverrideEvaluation
  });
}

function observationMap(document) {
  const values = Array.isArray(document) ? document : (document?.observations || document?.results || []);
  if (!Array.isArray(values) && values && typeof values === 'object') return new Map(Object.entries(values));
  return new Map((values || []).map((observation) => [observation.scenarioId, observation]));
}

function countStatuses(results) {
  const counts = Object.fromEntries(Object.values(STATUS).map((status) => [status, 0]));
  results.forEach((result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
  });
  return counts;
}

function compareCorpus(scenarioDocument, obsidianDocument, viewerDocument, overridesDocument, options = {}) {
  const scenarios = Array.isArray(scenarioDocument)
    ? scenarioDocument
    : (scenarioDocument?.scenarios || []);
  const obsidian = observationMap(obsidianDocument);
  const viewer = observationMap(viewerDocument);
  const results = scenarios.map((scenario) => compareScenario(
    scenario,
    obsidian.get(scenario.id),
    viewer.get(scenario.id),
    overridesDocument,
    options
  ));
  return {
    schemaVersion: 1,
    scenarioCount: scenarios.length,
    counts: countStatuses(results),
    results
  };
}

module.exports = Object.freeze({
  OBSERVATION_PATHS,
  STATUS,
  compareCorpus,
  compareScenario,
  countStatuses,
  diffValues,
  evaluateOverride,
  evaluateOverrideSet,
  observationMap,
  pathIsAllowed
});
