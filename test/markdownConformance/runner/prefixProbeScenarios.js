'use strict';

const { observationArray, scenarioArray } = require('./finalTraceEvidence');
const { boundedInteger, digest } = require('./utils');

function indexBy(entries, field, label) {
  const indexed = new Map();
  for (const entry of entries) {
    const id = entry?.[field];
    if (typeof id !== 'string' || !id) {
      throw new TypeError(`${label} is missing string ${field}.`);
    }
    if (indexed.has(id)) throw new Error(`Duplicate ${label} ${field}: ${id}`);
    indexed.set(id, entry);
  }
  return indexed;
}

function exactSelection(observation) {
  if (!observation?.selection) return null;
  return {
    anchor: observation.selection.anchor,
    focus: observation.selection.focus
  };
}

function sameSelection(left, right) {
  const leftSelection = exactSelection(left);
  const rightSelection = exactSelection(right);
  return leftSelection?.anchor === rightSelection?.anchor
    && leftSelection?.focus === rightSelection?.focus;
}

function hasIntegrityFailure(observation) {
  const failure = observation?.integrityFailure;
  if (Array.isArray(failure)) return failure.some(Boolean);
  if (typeof failure === 'string') return Boolean(failure);
  if (failure === true) return true;
  if (failure && typeof failure === 'object') return Object.values(failure).some(Boolean);
  return false;
}

function authoritativeMismatchKind(obsidian, viewer) {
  if (!obsidian || !viewer) return null;
  if (obsidian.automatable === false || viewer.automatable === false) return null;
  if (hasIntegrityFailure(viewer)) return null;
  if (obsidian.source !== viewer.source) return 'source-mismatch';
  if (!sameSelection(obsidian, viewer)) return 'caret-only-mismatch';
  return null;
}

function prefixLengths(actionCount, maximumEarlyPrefix) {
  const earlyCount = Math.min(actionCount, maximumEarlyPrefix);
  const lengths = Array.from({ length: earlyCount }, (_, index) => index + 1);
  if (actionCount > earlyCount) lengths.push(actionCount);
  return lengths;
}

function buildPrefixProbeScenarios(
  scenarioDocument,
  obsidianEvidenceDocument,
  viewerEvidenceDocument,
  options = {}
) {
  const maximumEarlyPrefix = boundedInteger(
    options.maximumEarlyPrefix,
    6,
    1,
    100,
    'maximumEarlyPrefix'
  );
  const scenarios = scenarioArray(scenarioDocument);
  const obsidianById = indexBy(
    observationArray(obsidianEvidenceDocument, 'Obsidian'),
    'scenarioId',
    'Obsidian observation'
  );
  const viewerById = indexBy(
    observationArray(viewerEvidenceDocument, 'Viewer'),
    'scenarioId',
    'Viewer observation'
  );
  const probes = [];
  const origins = [];

  for (const scenario of scenarios) {
    if (!Array.isArray(scenario.actions) || !scenario.actions.length) continue;
    const mismatchKind = authoritativeMismatchKind(
      obsidianById.get(scenario.id),
      viewerById.get(scenario.id)
    );
    if (!mismatchKind) continue;
    const actionCount = scenario.actions.length;
    const lengths = prefixLengths(actionCount, maximumEarlyPrefix);
    origins.push({
      scenarioId: scenario.id,
      mismatchKind,
      actionCount,
      emittedPrefixLengths: lengths
    });
    for (const prefixLength of lengths) {
      probes.push({
        ...scenario,
        id: `${scenario.id}.prefix.${prefixLength}`,
        actions: scenario.actions.slice(0, prefixLength),
        prefixProbe: {
          originScenarioId: scenario.id,
          mismatchKind,
          prefixLength,
          originalActionCount: actionCount,
          isFullTrace: prefixLength === actionCount
        }
      });
    }
  }

  const sourceMismatchOriginCount = origins.filter((entry) => (
    entry.mismatchKind === 'source-mismatch'
  )).length;
  const caretOnlyOriginCount = origins.filter((entry) => (
    entry.mismatchKind === 'caret-only-mismatch'
  )).length;

  return {
    schemaVersion: 1,
    kind: 'o1-v1-authoritative-prefix-probes',
    deterministic: true,
    maximumEarlyPrefix,
    sourceCorpusSha256: scenarioDocument?.corpusSha256 || null,
    sourceScenarioCount: scenarios.length,
    originScenarioCount: origins.length,
    sourceMismatchOriginCount,
    caretOnlyOriginCount,
    count: probes.length,
    corpusSha256: digest(probes),
    origins,
    sequences: probes
  };
}

module.exports = Object.freeze({
  authoritativeMismatchKind,
  buildPrefixProbeScenarios,
  exactSelection,
  hasIntegrityFailure,
  prefixLengths,
  sameSelection
});
