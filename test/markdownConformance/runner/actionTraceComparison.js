'use strict';

const {
  STATUS,
  countStatuses
} = require('./comparator');
const {
  compareNormalizedCrossRuntimeScenario,
  isExpandedListBehaviorScenario
} = require('./crossRuntimeContract');
const { observationArray, scenarioArray } = require('./finalTraceEvidence');
const { canonicalize, deepEqual } = require('./utils');

const AUTHORITATIVE_SURFACES = Object.freeze(['source', 'selection', 'physical']);
const EXPANDED_LIST_AUTHORITATIVE_SURFACES = Object.freeze([
  'source',
  'selection',
  'physical',
  'semantic',
  'presentation'
]);
const GENERIC_SEMANTIC_ADAPTER = 'generic-structural-concept-v1';
const GENERIC_PRESENTATION_TAXONOMY_PATHS = Object.freeze([
  'presentation.controls',
  'presentation.elementType',
  'presentation.layout',
  'presentation.markerVisibility',
  'presentation.quoteRailText',
  'presentation.renderedState',
  'presentation.visibleMarkers'
]);

function assertSequence(sequence) {
  if (!sequence || typeof sequence !== 'object' || Array.isArray(sequence)) {
    throw new TypeError('Sequence must be an object.');
  }
  if (typeof sequence.id !== 'string' || !sequence.id) {
    throw new TypeError('Sequence is missing string id.');
  }
  if (!Array.isArray(sequence.actions)) {
    throw new TypeError(`${sequence.id} is missing actions[].`);
  }
  return sequence;
}

function traceArray(observation) {
  return Array.isArray(observation?.actionTrace) ? observation.actionTrace : [];
}

function traceEntryIndex(entry, fallbackIndex) {
  const requested = entry?.index ?? entry?.actionIndex;
  if (requested == null) return fallbackIndex;
  const index = Number(requested);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError(`Action trace index must be a non-negative integer; received ${requested}.`);
  }
  return index;
}

function indexTrace(observation, role) {
  const indexed = new Map();
  traceArray(observation).forEach((entry, fallbackIndex) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`${role} actionTrace[${fallbackIndex}] must be an object.`);
    }
    const index = traceEntryIndex(entry, fallbackIndex);
    if (indexed.has(index)) throw new Error(`Duplicate ${role} action trace index: ${index}`);
    indexed.set(index, entry);
  });
  return indexed;
}

function inheritedStepObservation(parent, entry, scenarioId) {
  if (!entry) return null;
  const raw = entry.observation && typeof entry.observation === 'object'
    ? entry.observation
    : entry;
  return {
    ...raw,
    scenarioId,
    evidenceLevel: raw.evidenceLevel ?? parent?.evidenceLevel,
    automatable: raw.automatable ?? parent?.automatable ?? true
  };
}

function stepScenario(sequence, actionIndex) {
  const requestedObservations = Array.isArray(sequence.requiredObservations)
    ? sequence.requiredObservations
    : [];
  // Reading-mode list inspections intentionally have no editable caret. Keep
  // the declared observation surface in that case instead of manufacturing a
  // selection requirement that turns a valid O1/V1 capture into AMBIGUOUS.
  const requiredObservations = isExpandedListBehaviorScenario(sequence)
    ? [...new Set([
        'source',
        ...requestedObservations
      ])]
    : [...new Set([
        ...AUTHORITATIVE_SURFACES,
        'semantic',
        ...requestedObservations
      ])];
  return {
    ...sequence,
    id: `${sequence.id}.action.${actionIndex + 1}`,
    originScenarioId: sequence.id,
    actionIndex,
    actionNumber: actionIndex + 1,
    action: sequence.actions[actionIndex],
    actions: undefined,
    requiredObservations
  };
}

function authoritativeSurfacesForScenario(scenario) {
  if (!isExpandedListBehaviorScenario(scenario)) return AUTHORITATIVE_SURFACES;
  const requested = new Set(Array.isArray(scenario?.requiredObservations)
    ? scenario.requiredObservations
    : EXPANDED_LIST_AUTHORITATIVE_SURFACES);
  requested.add('source');
  return EXPANDED_LIST_AUTHORITATIVE_SURFACES.filter((surface) => requested.has(surface));
}

function differencePaths(result) {
  return Array.isArray(result?.differences)
    ? result.differences.map(({ path }) => path)
    : [];
}

function isSurfacePath(path, surface) {
  return path === surface || path.startsWith(`${surface}.`);
}

function authoritativeDifferencePaths(result) {
  return differencePaths(result).filter((path) => (
    AUTHORITATIVE_SURFACES.some((surface) => isSurfacePath(path, surface))
  ));
}

function semanticDifferencePaths(result) {
  return differencePaths(result).filter((path) => isSurfacePath(path, 'semantic'));
}

function presentationDifferencePaths(result) {
  return differencePaths(result).filter((path) => isSurfacePath(path, 'presentation'));
}

function listContractDifferencePaths(scenario, result) {
  if (!isExpandedListBehaviorScenario(scenario)) return [];
  const authoritative = new Set(authoritativeSurfacesForScenario(scenario));
  return differencePaths(result).filter((path) => (
    (authoritative.has('semantic') && isSurfacePath(path, 'semantic'))
    || (authoritative.has('presentation') && isSurfacePath(path, 'presentation'))
  ));
}

function observationSource(observation) {
  return String(observation?.source
    ?? observation?.fileSource
    ?? observation?.resultingSource
    ?? '');
}

function sourceLineAtOffset(source, requestedOffset) {
  const canonical = String(source ?? '');
  const offset = Math.max(0, Math.min(canonical.length, Number(requestedOffset) || 0));
  const endings = /\r\n|\n|\r/g;
  let start = 0;
  let index = 0;
  let match;
  while ((match = endings.exec(canonical))) {
    if (offset <= match.index) {
      return { index, start, end: match.index, text: canonical.slice(start, match.index) };
    }
    start = match.index + match[0].length;
    index += 1;
  }
  return { index, start, end: canonical.length, text: canonical.slice(start) };
}

function observationSemanticTypes(observation) {
  const semantic = observation?.semantic || {};
  return new Set([
    ...(Array.isArray(semantic.rootTypes) ? semantic.rootTypes : []),
    ...(Array.isArray(semantic.nodes) ? semantic.nodes.map(({ type }) => type) : []),
    ...Object.keys(semantic.typeCounts || {})
  ]);
}

function isViewerOnlyCodeConceptDifference(difference) {
  return /^semantic\.concepts\.\d+$/.test(difference?.path || '')
    && difference.expected === undefined
    && difference.actual === 'code';
}

/**
 * In active Live Preview, Obsidian's semantic DOM omits the active raw line.
 * Treat Viewer-only `code` as an observation gap only when the exact source,
 * caret, current line, presentation state, and paired thematic-break bridge
 * independently prove that narrow condition.
 */
function activeIndentedCodeObservationGap(
  compared,
  scenario,
  obsidianObservation,
  viewerObservation,
  authoritativeDifferences,
  differences
) {
  if (authoritativeDifferences.length > 0) return null;
  if (compared?.observedSemanticBridge?.construct !== 'thematic-break') return null;
  if (scenario.mode !== 'live-preview' || scenario.state?.active !== true) return null;
  if (obsidianObservation?.presentation?.mode !== 'live-preview'
    || obsidianObservation?.presentation?.renderedState !== 'mixed'
    || viewerObservation?.presentation?.mode !== 'live-preview'
    || viewerObservation?.presentation?.renderedState !== 'mixed') return null;

  const source = observationSource(obsidianObservation);
  if (source !== observationSource(viewerObservation)) return null;
  const anchor = Number(obsidianObservation?.selection?.anchor);
  const focus = Number(obsidianObservation?.selection?.focus);
  if (!Number.isSafeInteger(anchor) || anchor !== focus) return null;
  const line = sourceLineAtOffset(source, anchor);
  if (!/^ {4,}\S/.test(line.text)
    || anchor < line.start + 4
    || anchor > line.end) return null;
  const visibleLines = String(obsidianObservation?.presentation?.visibleText ?? '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .split('\n');
  if (!visibleLines.includes(line.text)) return null;

  const obsidianTypes = observationSemanticTypes(obsidianObservation);
  const viewerTypes = observationSemanticTypes(viewerObservation);
  if (obsidianTypes.has('code') || !viewerTypes.has('code')) return null;
  const codeDifferences = differences.filter(isViewerOnlyCodeConceptDifference);
  if (!codeDifferences.length) return null;
  return canonicalize({
    kind: 'obsidian-active-indented-code-line',
    differencePaths: codeDifferences.map(({ path }) => path),
    line: {
      index: line.index,
      start: line.start,
      end: line.end,
      indentation: line.text.match(/^ */)[0].length
    },
    caretOffset: anchor,
    obsidianRenderedState: obsidianObservation.presentation.renderedState,
    viewerSemanticType: 'code'
  });
}

function sourceExposesMarkdownImage(observation) {
  return /(^|[^\\])!\[[^\]\n]*\]\([^\n)]*(?:\)|$)/.test(observationSource(observation));
}

/**
 * O1 action snapshots are captured immediately after the native input event.
 * At that point Obsidian may expose only break nodes, or an image belonging to
 * application chrome, while its Markdown decorations are still settling. Such
 * nodes do not prove that the generic Markdown semantic adapter ran.
 */
function obsidianActionSemanticSignalTypes(compared, obsidianObservation) {
  const observed = compared?.normalizationAudit?.obsidian?.observedSemanticTypes;
  return (Array.isArray(observed) ? observed : []).filter((type) => (
    type !== 'break'
    && (type !== 'image' || sourceExposesMarkdownImage(obsidianObservation))
  ));
}

function isGenericPresentationTaxonomyPath(path) {
  return GENERIC_PRESENTATION_TAXONOMY_PATHS.some((root) => isSurfacePath(path, root));
}

/**
 * Separate behavior-contract differences from capture-taxonomy gaps. This is
 * intentionally action-trace-specific: final settled O1 observations retain
 * the stricter normalized cross-runtime contract.
 */
function classifyActionTraceDifferences(
  compared,
  scenario,
  obsidianObservation,
  viewerObservation,
  extraDifferences = []
) {
  const merged = new Map();
  [...(compared?.differences || []), ...extraDifferences].forEach((difference) => {
    if (difference?.path) merged.set(difference.path, difference);
  });
  const observedDifferences = [...merged.values()];
  const semanticSignalTypes = obsidianActionSemanticSignalTypes(compared, obsidianObservation);
  const genericSemanticAdapter = compared?.normalizationAudit?.obsidian?.semanticAdapter
    === GENERIC_SEMANTIC_ADAPTER;
  const genericSemanticComparable = !genericSemanticAdapter || semanticSignalTypes.length > 0;
  const activeCodeGap = activeIndentedCodeObservationGap(
    compared,
    scenario,
    obsidianObservation,
    viewerObservation,
    extraDifferences,
    observedDifferences
  );
  const activeCodeGapPaths = new Set(activeCodeGap?.differencePaths || []);
  const nonComparableDifferences = observedDifferences.filter(({ path }) => (
    activeCodeGapPaths.has(path)
    || (!genericSemanticComparable
      && (isSurfacePath(path, 'semantic') || isGenericPresentationTaxonomyPath(path)))
  ));
  const nonComparablePaths = new Set(nonComparableDifferences.map(({ path }) => path));
  const comparableDifferences = observedDifferences.filter(({ path }) => (
    !nonComparablePaths.has(path)
  ));
  return {
    comparableDifferences,
    genericSemanticAdapter,
    genericSemanticComparable,
    nonComparableDifferences,
    observedDifferences,
    semanticSignalTypes,
    semanticObservationGaps: activeCodeGap ? [activeCodeGap] : []
  };
}

function actionMetadataMatches(entry, action) {
  return entry?.action == null || deepEqual(entry.action, action);
}

function alignmentFailure(sequence, actionIndex, role, reason) {
  const scenario = stepScenario(sequence, actionIndex);
  const status = role === 'obsidian'
    ? STATUS.OBSIDIAN_NOT_AUTOMATABLE
    : STATUS.AMBIGUOUS;
  return canonicalize({
    scenarioId: scenario.id,
    originScenarioId: sequence.id,
    fixtureId: sequence.fixtureId,
    syntaxFamily: sequence.syntaxFamily,
    mode: sequence.mode,
    actionIndex,
    actionNumber: actionIndex + 1,
    action: sequence.actions[actionIndex],
    status,
    reasonCode: `${role}-action-trace-misaligned`,
    reason,
    authoritativeStatus: status,
    exactAuthoritativeStatus: status,
    authoritativeReasonCode: `${role}-action-trace-misaligned`,
    differences: [],
    observedDifferencePaths: [],
    nonComparableDifferences: [],
    nonComparableDifferencePaths: [],
    authoritativeDifferencePaths: [],
    unavailableAuthoritativeDifferencePaths: [],
    listContractDifferencePaths: [],
    unavailableListContractDifferencePaths: [],
    semanticDifferencePaths: [],
    observedSemanticDifferencePaths: [],
    nonComparableSemanticDifferencePaths: [],
    authoritativeDivergence: false,
    semanticContractDivergence: false,
    semanticObservationGap: false,
    semanticObservationGaps: [],
    semanticSignalTypes: []
  });
}

function compareActionStep(
  sequence,
  actionIndex,
  obsidianParent,
  viewerParent,
  obsidianEntry,
  viewerEntry,
  overridesDocument
) {
  const scenario = stepScenario(sequence, actionIndex);
  if (!obsidianEntry) {
    return alignmentFailure(
      sequence,
      actionIndex,
      'obsidian',
      `Obsidian action trace is missing sequence action ${actionIndex}.`
    );
  }
  if (!viewerEntry) {
    return alignmentFailure(
      sequence,
      actionIndex,
      'viewer',
      `Viewer action trace is missing sequence action ${actionIndex}.`
    );
  }
  if (!actionMetadataMatches(obsidianEntry, scenario.action)) {
    return alignmentFailure(
      sequence,
      actionIndex,
      'obsidian',
      `Obsidian trace action metadata does not match sequence action ${actionIndex}.`
    );
  }
  if (!actionMetadataMatches(viewerEntry, scenario.action)) {
    return alignmentFailure(
      sequence,
      actionIndex,
      'viewer',
      `Viewer trace action metadata does not match sequence action ${actionIndex}.`
    );
  }
  const obsidianStep = inheritedStepObservation(obsidianParent, obsidianEntry, scenario.id);
  const viewerStep = inheritedStepObservation(viewerParent, viewerEntry, scenario.id);
  const compared = compareNormalizedCrossRuntimeScenario(
    scenario,
    obsidianStep,
    viewerStep,
    overridesDocument
  );
  // Run the exact surfaces independently so semantic ambiguity or an accepted
  // presentation override cannot conceal a source/selection/physical failure.
  const authoritativeSurfaces = authoritativeSurfacesForScenario(scenario);
  const exactAuthoritativeSurfaces = authoritativeSurfaces.filter((surface) => (
    AUTHORITATIVE_SURFACES.includes(surface)
  ));
  const authoritativeCompared = compareNormalizedCrossRuntimeScenario(
    { ...scenario, requiredObservations: exactAuthoritativeSurfaces },
    obsidianStep,
    viewerStep,
    {}
  );
  const listAuthoritativeSurfaces = authoritativeSurfaces.filter((surface) => (
    surface === 'semantic' || surface === 'presentation'
  ));
  const listContractCompared = listAuthoritativeSurfaces.length > 0
    ? compareNormalizedCrossRuntimeScenario(
        { ...scenario, requiredObservations: listAuthoritativeSurfaces },
        obsidianStep,
        viewerStep,
        {}
      )
    : null;
  const exactAuthoritativePaths = authoritativeDifferencePaths(authoritativeCompared);
  const observedListContractPaths = listContractDifferencePaths(
    scenario,
    listContractCompared
  );
  // Semantic/list presentation facts cannot upgrade an incomplete required
  // exact capture into a confirmed product failure. In particular, focus and
  // active-marker facts are derived from the caret; when V1 loses that caret,
  // the resulting empty focus set is an observation gap, not Viewer behavior.
  const exactAuthoritativeIndeterminate = authoritativeCompared.status === STATUS.AMBIGUOUS
    || authoritativeCompared.status === STATUS.OBSIDIAN_NOT_AUTOMATABLE;
  const listContractPaths = exactAuthoritativeIndeterminate
    ? []
    : observedListContractPaths;
  const authoritativePaths = [...new Set([
    ...exactAuthoritativePaths,
    ...listContractPaths
  ])];
  const authoritativeDivergence = !exactAuthoritativeIndeterminate && (
    authoritativeCompared.status === STATUS.VIEWER_FAIL
    || authoritativeCompared.reasonCode === 'viewer-integrity-failure'
    || listContractCompared?.status === STATUS.VIEWER_FAIL
    || listContractCompared?.reasonCode === 'viewer-integrity-failure'
    || authoritativePaths.length > 0
  );
  const authoritativeStatus = exactAuthoritativeIndeterminate
    ? authoritativeCompared.status
    : authoritativeDivergence
    ? STATUS.VIEWER_FAIL
    : (isExpandedListBehaviorScenario(scenario)
      && (listContractCompared?.status === STATUS.AMBIGUOUS
        || listContractCompared?.status === STATUS.OBSIDIAN_NOT_AUTOMATABLE)
      ? listContractCompared.status
      : authoritativeCompared.status);
  const authoritativeReasonCode = exactAuthoritativeIndeterminate
    ? 'required-authoritative-observation-indeterminate'
    : authoritativeDivergence && listContractPaths.length > 0
    ? 'expanded-list-authoritative-contract-mismatch'
    : authoritativeCompared.reasonCode;
  const classified = classifyActionTraceDifferences(
    compared,
    scenario,
    obsidianStep,
    viewerStep,
    [
      ...(authoritativeCompared.differences || []),
      ...(listContractCompared?.differences || [])
    ]
  );
  const effectiveComparison = {
    ...compared,
    differences: classified.comparableDifferences
  };
  const semanticPaths = semanticDifferencePaths(effectiveComparison);
  const presentationPaths = presentationDifferencePaths(effectiveComparison);
  const observedSemanticPaths = classified.observedDifferences
    .map(({ path }) => path)
    .filter((path) => isSurfacePath(path, 'semantic'));
  const nonComparableSemanticPaths = classified.nonComparableDifferences
    .map(({ path }) => path)
    .filter((path) => isSurfacePath(path, 'semantic'));
  const suppressedObservationOnlyFailure = compared.status === STATUS.VIEWER_FAIL
    && !authoritativeDivergence
    && classified.comparableDifferences.length === 0
    && classified.nonComparableDifferences.length > 0;
  const status = exactAuthoritativeIndeterminate
    ? authoritativeStatus
    : authoritativeDivergence
    ? STATUS.VIEWER_FAIL
    : (suppressedObservationOnlyFailure ? STATUS.MATCH : compared.status);
  const reasonCode = exactAuthoritativeIndeterminate
    ? authoritativeReasonCode
    : authoritativeDivergence && compared.status !== STATUS.VIEWER_FAIL
    ? authoritativeReasonCode
    : (suppressedObservationOnlyFailure
      ? (classified.semanticObservationGaps.length
        ? 'action-trace-semantic-observation-gap'
        : 'action-trace-comparable-contract-match')
      : compared.reasonCode);
  const reason = suppressedObservationOnlyFailure
    ? (classified.semanticObservationGaps.length
      ? 'Authoritative surfaces match; active Live Preview exposes the indented code line as raw O1 text, outside O1 semantic DOM coverage.'
      : 'Authoritative surfaces match; O1 did not expose comparable generic semantic/presentation taxonomy in this intermediate capture.')
    : compared.reason;
  return canonicalize({
    ...compared,
    scenarioId: scenario.id,
    originScenarioId: sequence.id,
    actionIndex,
    actionNumber: actionIndex + 1,
    action: scenario.action,
    status,
    reasonCode,
    reason,
    normalizedStatusBeforeActionTraceComparability: compared.status,
    differences: classified.comparableDifferences,
    observedDifferencePaths: classified.observedDifferences.map(({ path }) => path),
    nonComparableDifferences: classified.nonComparableDifferences,
    nonComparableDifferencePaths: classified.nonComparableDifferences.map(({ path }) => path),
    authoritativeDifferencePaths: authoritativePaths,
    authoritativeStatus,
    exactAuthoritativeStatus: authoritativeCompared.status,
    authoritativeReasonCode,
    authoritativeSurfaces,
    semanticDifferencePaths: semanticPaths,
    presentationDifferencePaths: presentationPaths,
    listContractDifferencePaths: listContractPaths,
    unavailableListContractDifferencePaths: exactAuthoritativeIndeterminate
      ? observedListContractPaths
      : [],
    observedSemanticDifferencePaths: observedSemanticPaths,
    nonComparableSemanticDifferencePaths: nonComparableSemanticPaths,
    authoritativeDivergence,
    listContractDivergence: listContractPaths.length > 0,
    semanticContractDivergence: semanticPaths.length > 0,
    semanticObservationGap: nonComparableSemanticPaths.length > 0,
    semanticObservationGaps: classified.semanticObservationGaps,
    semanticSignalTypes: classified.semanticSignalTypes
  });
}

function acceptedStatus(status) {
  return status === STATUS.MATCH || status === STATUS.INTENTIONAL_VIEWER_OVERRIDE;
}

function firstDivergenceEnvelope(step) {
  if (!step) return null;
  return canonicalize({
    scenarioId: step.scenarioId,
    actionIndex: step.actionIndex,
    actionNumber: step.actionNumber,
    action: step.action,
    status: step.status,
    reasonCode: step.reasonCode || null,
    authoritativeStatus: step.authoritativeStatus,
    authoritativeSurfaces: step.authoritativeSurfaces,
    authoritativeDifferencePaths: step.authoritativeDifferencePaths,
    semanticDifferencePaths: step.semanticDifferencePaths,
    presentationDifferencePaths: step.presentationDifferencePaths,
    listContractDifferencePaths: step.listContractDifferencePaths,
    nonComparableSemanticDifferencePaths: step.nonComparableSemanticDifferencePaths
  });
}

function aggregateStatus(steps) {
  if (steps.some(({ status }) => status === STATUS.VIEWER_FAIL)) return STATUS.VIEWER_FAIL;
  if (steps.some(({ status }) => status === STATUS.OBSIDIAN_NOT_AUTOMATABLE)) {
    return STATUS.OBSIDIAN_NOT_AUTOMATABLE;
  }
  if (steps.some(({ status }) => status === STATUS.AMBIGUOUS)) return STATUS.AMBIGUOUS;
  if (steps.some(({ status }) => status === STATUS.INTENTIONAL_VIEWER_OVERRIDE)) {
    return STATUS.INTENTIONAL_VIEWER_OVERRIDE;
  }
  return STATUS.MATCH;
}

function indeterminateStatus(status) {
  return status === STATUS.AMBIGUOUS || status === STATUS.OBSIDIAN_NOT_AUTOMATABLE;
}

function resolveIndeterminateActionDependencies(rawSteps) {
  let dependency = null;
  return rawSteps.map((step) => {
    const exactStatus = step.exactAuthoritativeStatus ?? step.authoritativeStatus;
    if (dependency) {
      // Exact source/caret/physical agreement re-establishes a comparable
      // runtime state. A list-only difference on that same step is therefore
      // still independently classifiable.
      if (exactStatus === STATUS.MATCH
        || exactStatus === STATUS.INTENTIONAL_VIEWER_OVERRIDE) {
        dependency = null;
      } else {
        const dependencyStatus = dependency.status === STATUS.OBSIDIAN_NOT_AUTOMATABLE
          ? STATUS.OBSIDIAN_NOT_AUTOMATABLE
          : STATUS.AMBIGUOUS;
        const unavailableAuthoritativeDifferencePaths = [...new Set([
          ...(step.unavailableAuthoritativeDifferencePaths || []),
          ...(step.authoritativeDifferencePaths || [])
        ])];
        const unavailableListContractDifferencePaths = [...new Set([
          ...(step.unavailableListContractDifferencePaths || []),
          ...(step.listContractDifferencePaths || [])
        ])];
        const adjusted = canonicalize({
          ...step,
          status: dependencyStatus,
          reasonCode: 'downstream-of-indeterminate-action',
          reason:
            `Action ${step.actionNumber} depends on indeterminate action ${dependency.actionNumber}; exact runtime state was not re-established.`,
          authoritativeStatus: dependencyStatus,
          authoritativeReasonCode: 'downstream-of-indeterminate-action',
          authoritativeDifferencePaths: [],
          unavailableAuthoritativeDifferencePaths,
          listContractDifferencePaths: [],
          unavailableListContractDifferencePaths,
          authoritativeDivergence: false,
          listContractDivergence: false,
          semanticContractDivergence: false,
          semanticDifferencePaths: [],
          presentationDifferencePaths: [],
          downstreamIndeterminateFrom: {
            actionIndex: dependency.actionIndex,
            actionNumber: dependency.actionNumber,
            reasonCode: dependency.reasonCode
          }
        });
        if (indeterminateStatus(exactStatus)) dependency = dependency || step;
        return adjusted;
      }
    }
    if (indeterminateStatus(exactStatus)) dependency = step;
    return step;
  });
}

function indexUnique(entries, field, label) {
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

/**
 * Compare transport-neutral, per-action O1 and V1 observations. Trace entries
 * may be flat observations or `{index, action, observation}` envelopes. Indexes
 * are zero-based; when omitted, array order is authoritative.
 */
function compareActionTrace(
  sequenceRaw,
  obsidianObservation,
  viewerObservation,
  overridesDocument = {}
) {
  const sequence = assertSequence(sequenceRaw);
  const obsidian = indexTrace(obsidianObservation, 'Obsidian');
  const viewer = indexTrace(viewerObservation, 'Viewer');
  const expectedIndexes = new Set(sequence.actions.map((_, index) => index));
  const steps = resolveIndeterminateActionDependencies(sequence.actions.map(
    (_, actionIndex) => compareActionStep(
      sequence,
      actionIndex,
      obsidianObservation,
      viewerObservation,
      obsidian.get(actionIndex),
      viewer.get(actionIndex),
      overridesDocument
    )
  ));
  const divergentSteps = steps.filter(({ status }) => !acceptedStatus(status));
  const authoritativeSteps = steps.filter(({ authoritativeDivergence }) => authoritativeDivergence);
  const semanticSteps = steps.filter(({ semanticContractDivergence }) => semanticContractDivergence);
  const listContractSteps = steps.filter(({ listContractDivergence }) => listContractDivergence);
  const semanticObservationGapSteps = steps.filter(({ semanticObservationGap }) => (
    semanticObservationGap
  ));
  const authoritativeResults = steps.map(({ authoritativeStatus: status }) => ({ status }));
  const firstDivergence = divergentSteps[0] || null;
  const firstAuthoritative = authoritativeSteps[0] || null;
  const afterFirst = firstAuthoritative == null
    ? []
    : steps.slice(firstAuthoritative.actionIndex + 1);

  return canonicalize({
    schemaVersion: 1,
    kind: 'o1-v1-action-trace-comparison',
    comparisonLayer: 'cross-runtime-behavior-contract-v2',
    scenarioId: sequence.id,
    fixtureId: sequence.fixtureId || null,
    syntaxFamily: sequence.syntaxFamily || null,
    mode: sequence.mode || null,
    actionCount: sequence.actions.length,
    alignedStepCount: steps.filter((step) => !/-action-trace-misaligned$/.test(
      step.reasonCode || ''
    )).length,
    status: aggregateStatus(steps),
    counts: countStatuses(steps),
    authoritativeStatus: aggregateStatus(authoritativeResults),
    authoritativeCounts: countStatuses(authoritativeResults),
    authoritativeSurfaces: authoritativeSurfacesForScenario(sequence),
    divergenceCount: divergentSteps.length,
    authoritativeDivergenceCount: authoritativeSteps.length,
    semanticContractDivergenceCount: semanticSteps.length,
    listContractDivergenceCount: listContractSteps.length,
    semanticObservationGapCount: semanticObservationGapSteps.length,
    nonComparableDifferenceCount: steps.reduce((sum, step) => (
      sum + step.nonComparableDifferencePaths.length
    ), 0),
    nonComparableSemanticDifferenceCount: steps.reduce((sum, step) => (
      sum + step.nonComparableSemanticDifferencePaths.length
    ), 0),
    firstDivergence: firstDivergenceEnvelope(firstDivergence),
    firstAuthoritativeDivergence: firstDivergenceEnvelope(firstAuthoritative),
    downstreamStepCount: afterFirst.length,
    downstreamDivergenceCount: afterFirst.filter(({ status }) => (
      !acceptedStatus(status)
    )).length,
    downstreamAuthoritativeDivergenceCount: afterFirst.filter(({ authoritativeDivergence }) => (
      authoritativeDivergence
    )).length,
    coverage: {
      expectedStepCount: sequence.actions.length,
      obsidianTraceCount: obsidian.size,
      viewerTraceCount: viewer.size,
      missingObsidianActionIndexes: [...expectedIndexes].filter((index) => !obsidian.has(index)),
      missingViewerActionIndexes: [...expectedIndexes].filter((index) => !viewer.has(index)),
      unexpectedObsidianActionIndexes: [...obsidian.keys()].filter((index) => (
        !expectedIndexes.has(index)
      )),
      unexpectedViewerActionIndexes: [...viewer.keys()].filter((index) => (
        !expectedIndexes.has(index)
      ))
    },
    steps
  });
}

function compareActionTraceEvidence(
  scenarioDocument,
  obsidianEvidenceDocument,
  viewerEvidenceDocument,
  overridesDocument = {}
) {
  const scenarios = scenarioArray(scenarioDocument);
  const obsidianObservations = observationArray(obsidianEvidenceDocument, 'Obsidian');
  const viewerObservations = observationArray(viewerEvidenceDocument, 'Viewer');
  const scenarioById = indexUnique(scenarios, 'id', 'scenario');
  const obsidianById = indexUnique(obsidianObservations, 'scenarioId', 'Obsidian observation');
  const viewerById = indexUnique(viewerObservations, 'scenarioId', 'Viewer observation');
  const results = scenarios.map((sequence) => compareActionTrace(
    sequence,
    obsidianById.get(sequence.id),
    viewerById.get(sequence.id),
    overridesDocument
  ));

  return canonicalize({
    schemaVersion: 1,
    kind: 'o1-v1-action-trace-evidence-comparison',
    comparisonLayer: 'cross-runtime-behavior-contract-v2',
    scenarioCount: scenarios.length,
    expectedActionCount: results.reduce((sum, result) => sum + result.actionCount, 0),
    alignedStepCount: results.reduce((sum, result) => sum + result.alignedStepCount, 0),
    counts: countStatuses(results),
    authoritativeCounts: countStatuses(results.map(({ authoritativeStatus: status }) => ({ status }))),
    authoritativeDivergenceScenarioCount: results.filter(({ firstAuthoritativeDivergence }) => (
      firstAuthoritativeDivergence != null
    )).length,
    authoritativeDivergenceStepCount: results.reduce((sum, result) => (
      sum + result.authoritativeDivergenceCount
    ), 0),
    listContractDivergenceScenarioCount: results.filter(({ listContractDivergenceCount }) => (
      listContractDivergenceCount > 0
    )).length,
    listContractDivergenceStepCount: results.reduce((sum, result) => (
      sum + result.listContractDivergenceCount
    ), 0),
    downstreamAuthoritativeDivergenceStepCount: results.reduce((sum, result) => (
      sum + result.downstreamAuthoritativeDivergenceCount
    ), 0),
    semanticObservationGapScenarioCount: results.filter(({ semanticObservationGapCount }) => (
      semanticObservationGapCount > 0
    )).length,
    semanticObservationGapStepCount: results.reduce((sum, result) => (
      sum + result.semanticObservationGapCount
    ), 0),
    nonComparableSemanticDifferenceCount: results.reduce((sum, result) => (
      sum + result.nonComparableSemanticDifferenceCount
    ), 0),
    coverage: {
      obsidianObservationCount: obsidianObservations.length,
      viewerObservationCount: viewerObservations.length,
      unexpectedObsidianScenarioIds: [...obsidianById.keys()].filter((id) => !scenarioById.has(id)),
      unexpectedViewerScenarioIds: [...viewerById.keys()].filter((id) => !scenarioById.has(id))
    },
    results
  });
}

module.exports = Object.freeze({
  AUTHORITATIVE_SURFACES,
  EXPANDED_LIST_AUTHORITATIVE_SURFACES,
  acceptedStatus,
  aggregateStatus,
  authoritativeDifferencePaths,
  authoritativeSurfacesForScenario,
  compareActionStep,
  compareActionTrace,
  compareActionTraceEvidence,
  inheritedStepObservation,
  obsidianActionSemanticSignalTypes,
  listContractDifferencePaths,
  presentationDifferencePaths,
  semanticDifferencePaths,
  traceEntryIndex
});
