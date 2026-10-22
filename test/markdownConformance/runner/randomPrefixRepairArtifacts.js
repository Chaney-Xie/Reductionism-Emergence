'use strict';

const { observationArray, scenarioArray } = require('./finalTraceEvidence');
const { deepEqual, digest } = require('./utils');

const GATE_CASES = Object.freeze([
  { origin: 'certification-random.cefdf2028632fd423fb9', prefix: 1, category: 'ordered-renumber-enter-nested' },
  { origin: 'certification-random.4c7d32d5c375dcd398ca', prefix: 1, category: 'ordered-renumber-enter-blank-item' },
  { origin: 'certification-random.11a090f7e3bb618edb45', prefix: 1, category: 'ordered-renumber-insert-nested' },
  { origin: 'certification-random.781644fa90606e8dc84d', prefix: 1, category: 'ordered-renumber-insert-mixed-list' },
  { origin: 'certification-random.4862111c0826e1a0f802', prefix: 3, category: 'list-structural-root-tab' },
  { origin: 'certification-random.9423a4532d045e7d4d19', prefix: 3, category: 'list-structural-child-shift-tab' },
  { origin: 'certification-random.170d1fc84d06025f2e0d', prefix: 2, category: 'list-structural-task-continuation-tab' },
  { origin: 'certification-random.d378320c9c2b0002a6f5', prefix: 5, category: 'exact-insertion-star-autopair' },
  { origin: 'certification-random.3afc6d8f4178ba691588', prefix: 5, category: 'exact-insertion-backtick-autopair' },
  { origin: 'certification-random.86b8ac65128482b298c4', prefix: 6, category: 'exact-insertion-tabbed-list-offset' },
  { origin: 'certification-random.295e722f4b8d8a45154a', prefix: 1, category: 'exact-insertion-fenced-blank-gap' },
  { origin: 'certification-random.517bd62abc30bd945fa4', prefix: 4, category: 'quote-padding-depth-1-enter' },
  { origin: 'certification-random.84c3897d0b2b358690a8', prefix: 2, category: 'quote-padding-depth-3-enter' },
  {
    origin: 'certification-random.763ca18a9a3ecb56c0d0', prefix: 5,
    category: 'history-shift-enter-text-coalescing', preserveHistory: true
  },
  {
    origin: 'certification-random.bd0ecc13fcbaea5f9427', prefix: 4,
    category: 'history-enter-backspace-cancellation', preserveHistory: true
  },
  {
    origin: 'certification-random.712817c748db56d6f914', prefix: 4,
    category: 'history-indented-code-coalescing', preserveHistory: true,
    intermediateSelectionLossAtPrefix: 2
  },
  {
    origin: 'certification-random.a6b348d91b3f2d1c3a26', prefix: 5,
    category: 'history-blank-indent-coalescing', preserveHistory: true
  },
  { origin: 'certification-random.41ec1818829f06e37103', prefix: 3, category: 'backspace-marker-separator' },
  { origin: 'certification-random.1c7706220688af8fba13', prefix: 5, category: 'backspace-indentation-tab-stop' },
  { origin: 'certification-random.a9d2369975b2475835fe', prefix: 5, category: 'backspace-inline-link-caret' },
  { origin: 'certification-random.410d77b9df51f401b0bc', prefix: 3, category: 'nbsp-delete-filler' },
  { origin: 'certification-random.d13d18dc6021e3bb2176', prefix: 1, category: 'task-shift-enter-continuation-width' }
]);

const NO_EARLY_DIVERGENCE_IDS = Object.freeze([
  'certification-random.b70cdcd288fc512627c9',
  'certification-random.29910640d4db8641345d',
  'certification-random.bf5e375582da1e34ad90',
  'certification-random.daa564d97259e8507239',
  'certification-random.f79fc4408b365dfd8324',
  'certification-random.880082c8f52c0b9cd738',
  'certification-random.5df46df19892f564e46b',
  'certification-random.80f2f5b9f741836d5e14',
  'certification-random.d1d10a2425ab1f965f48',
  'certification-random.47ccd353a53a2f38af51',
  'certification-random.b2e410bc3e8beae135f7',
  'certification-random.9c53360236d14caafdb5',
  'certification-random.2f0d23515af9d9b56cd9',
  'certification-random.d16b3c0cb5aa8bddbf47',
  'certification-random.6b79cb9a3ebc970e5b3b',
  'certification-random.3c0e520ce213a67fa278',
  'certification-random.34d89c0a86b97b2f23a6',
  'certification-random.364050e858701174832e',
  'certification-random.0ac274b17cd0e55956bb',
  'certification-random.d3476e60f57e58913d4d',
  'certification-random.a6c40579ea7842824697',
  'certification-random.82e3bf1768aa31d45b99',
  'certification-random.3a4704aa4e590c0a9804',
  'certification-random.0d46d3187e24cacbaf75'
]);

const POSSIBLE_MARKER_ONLY_DECISION_INTERSECTION = new Set([
  'certification-random.29910640d4db8641345d',
  'certification-random.2f0d23515af9d9b56cd9',
  'certification-random.0ac274b17cd0e55956bb'
]);

function indexUnique(entries, field, label) {
  const indexed = new Map();
  for (const entry of entries) {
    const id = entry?.[field];
    if (typeof id !== 'string' || !id) throw new TypeError(`${label} is missing string ${field}.`);
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

function prefixId(origin, prefix) {
  return `${origin}.prefix.${prefix}`;
}

function categoryGroup(category) {
  if (category.startsWith('ordered-renumber-')) return 'ordered-renumber';
  if (category.startsWith('list-structural-')) return 'list-structural';
  if (category.startsWith('exact-insertion-')) return 'exact-insertion';
  if (category.startsWith('quote-padding-')) return 'quote-padding';
  if (category.startsWith('history-')) return 'history';
  if (category.startsWith('backspace-')) return 'backspace';
  if (category.startsWith('nbsp-')) return 'nbsp';
  if (category.startsWith('task-shift-enter-')) return 'task-shift-enter';
  return 'other';
}

function buildRepairGate(prefixScenarioDocument, obsidianEvidenceDocument, viewerEvidenceDocument) {
  const prefixScenarios = indexUnique(scenarioArray(prefixScenarioDocument), 'id', 'prefix scenario');
  const obsidian = indexUnique(observationArray(obsidianEvidenceDocument, 'Obsidian'), 'scenarioId', 'O1 observation');
  const viewer = indexUnique(observationArray(viewerEvidenceDocument, 'Viewer'), 'scenarioId', 'V1 observation');
  const sequences = GATE_CASES.map((entry) => {
    const targetId = prefixId(entry.origin, entry.prefix);
    const target = prefixScenarios.get(targetId);
    const expected = obsidian.get(targetId);
    const beforeId = entry.prefix > 1 ? prefixId(entry.origin, entry.prefix - 1) : null;
    const beforeO1 = beforeId ? obsidian.get(beforeId) : null;
    const beforeV1 = beforeId ? viewer.get(beforeId) : null;
    const actual = viewer.get(targetId);
    if (!target || !expected || !actual) throw new Error(`Missing gate evidence: ${targetId}`);
    if (beforeId && (!beforeO1 || !beforeV1)) throw new Error(`Missing gate predecessor: ${beforeId}`);
    if (beforeId && (
      beforeO1.source !== beforeV1.source
      || !deepEqual(exactSelection(beforeO1), exactSelection(beforeV1))
    )) throw new Error(`Gate predecessor is not authoritative-match: ${beforeId}`);
    const initialSource = entry.preserveHistory ? target.initialSource : (beforeO1?.source ?? target.initialSource);
    const initialSelection = entry.preserveHistory
      ? target.initialSelection
      : (exactSelection(beforeO1) ?? target.initialSelection);
    const actions = entry.preserveHistory
      ? target.actions.slice(0, entry.prefix)
      : [target.actions[entry.prefix - 1]];
    const differenceKind = expected.source !== actual.source ? 'source' : 'selection';
    const shortOrigin = entry.origin.slice('certification-random.'.length);
    return {
      id: `v0.3-random-repair.${entry.category}.${shortOrigin}`,
      schemaVersion: 1,
      fixtureId: target.fixtureId,
      syntaxFamily: target.syntaxFamily,
      mode: target.mode,
      state: target.state,
      initialSource,
      initialSelection,
      actions,
      requiredObservations: ['source', 'selection', 'physical', 'semantic'],
      comparisonPolicy: target.comparisonPolicy,
      repairCategory: entry.category,
      repairCategoryGroup: categoryGroup(entry.category),
      repairMetadata: {
        originScenarioId: entry.origin,
        firstDivergentPrefixLength: entry.prefix,
        preservedHistoryPrefix: Boolean(entry.preserveHistory),
        intermediateSelectionLossAtPrefix: entry.intermediateSelectionLossAtPrefix || null,
        authoritativeDifferenceKind: differenceKind,
        expectedO1: {
          source: expected.source,
          selection: exactSelection(expected)
        },
        observedV1BeforeRepair: {
          source: actual.source,
          selection: exactSelection(actual)
        }
      }
    };
  });
  const categoryCounts = sequences.reduce((counts, sequence) => {
    counts[sequence.repairCategoryGroup] = (counts[sequence.repairCategoryGroup] || 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: 1,
    kind: 'v0.3-valid-random-targeted-repair-gate',
    deterministic: true,
    sourcePrefixCorpusSha256: prefixScenarioDocument?.corpusSha256 || null,
    caseCount: sequences.length,
    categoryCounts,
    corpusSha256: digest(sequences),
    sequences
  };
}

function buildNoEarlyDivergenceCorpus(
  sourceScenarioDocument,
  prefixScenarioDocument,
  obsidianEvidenceDocument,
  viewerEvidenceDocument
) {
  const sourceScenarios = indexUnique(scenarioArray(sourceScenarioDocument), 'id', 'source scenario');
  const obsidian = indexUnique(observationArray(obsidianEvidenceDocument, 'Obsidian'), 'scenarioId', 'O1 observation');
  const viewer = indexUnique(observationArray(viewerEvidenceDocument, 'Viewer'), 'scenarioId', 'V1 observation');
  const sequences = NO_EARLY_DIVERGENCE_IDS.map((id) => {
    const scenario = sourceScenarios.get(id);
    if (!scenario) throw new Error(`Missing no-early-divergence source scenario: ${id}`);
    for (let prefix = 1; prefix <= Math.min(6, scenario.actions.length); prefix += 1) {
      const probeId = prefixId(id, prefix);
      const left = obsidian.get(probeId);
      const right = viewer.get(probeId);
      if (!left || !right) throw new Error(`Missing no-early-divergence probe: ${probeId}`);
      if (left.source !== right.source
        || !deepEqual(exactSelection(left), exactSelection(right))) {
        throw new Error(`Origin diverges before or at prefix 6: ${probeId}`);
      }
    }
    const fullProbe = scenario.actions.length <= 6
      ? prefixId(id, scenario.actions.length)
      : prefixId(id, scenario.actions.length);
    const fullO1 = obsidian.get(fullProbe);
    const fullV1 = viewer.get(fullProbe);
    if (!fullO1 || !fullV1 || fullO1.source === fullV1.source) {
      throw new Error(`Origin lacks the expected full source divergence: ${id}`);
    }
    return {
      ...scenario,
      lateDivergenceMetadata: {
        exactSourceAndSelectionThroughAction: 6,
        fullTraceSourceDiverges: true,
        requiresPerActionTrace: true,
        possibleMarkerOnlyQuoteDecisionIntersection:
          POSSIBLE_MARKER_ONLY_DECISION_INTERSECTION.has(id),
        fullExpectedO1: {
          source: fullO1.source,
          selection: exactSelection(fullO1)
        },
        fullObservedV1: {
          source: fullV1.source,
          selection: exactSelection(fullV1)
        }
      }
    };
  });
  return {
    schemaVersion: 1,
    kind: 'v0.3-valid-random-no-early-divergence',
    deterministic: true,
    exactThroughAction: 6,
    sourceCorpusSha256: sourceScenarioDocument?.corpusSha256 || null,
    sourcePrefixCorpusSha256: prefixScenarioDocument?.corpusSha256 || null,
    count: sequences.length,
    possibleMarkerOnlyQuoteDecisionIntersectionCount: sequences.filter((sequence) => (
      sequence.lateDivergenceMetadata.possibleMarkerOnlyQuoteDecisionIntersection
    )).length,
    corpusSha256: digest(sequences),
    sequences
  };
}

module.exports = Object.freeze({
  GATE_CASES,
  NO_EARLY_DIVERGENCE_IDS,
  POSSIBLE_MARKER_ONLY_DECISION_INTERSECTION,
  buildNoEarlyDivergenceCorpus,
  buildRepairGate,
  categoryGroup,
  exactSelection,
  prefixId
});
