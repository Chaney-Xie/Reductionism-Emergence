'use strict';

const { observationArray, scenarioArray } = require('./finalTraceEvidence');
const {
  isExpandedListBehaviorScenario,
  projectObservation
} = require('./crossRuntimeContract');
const { digest } = require('./utils');

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

function exactSelection(observation, fallback = { anchor: 0, focus: 0 }) {
  const selection = observation?.selection || observation;
  if (!selection || !Number.isFinite(Number(selection.anchor))) return { ...fallback };
  return {
    anchor: Number(selection.anchor) || 0,
    focus: Number(selection.focus) || 0
  };
}

function traceObservation(parent, actionIndex, role) {
  const entry = parent?.actionTrace?.find((candidate, fallbackIndex) => (
    Number(candidate?.index ?? candidate?.actionIndex ?? fallbackIndex) === actionIndex
  ));
  const observation = entry?.observation || entry;
  if (!observation) throw new Error(`${role} is missing action ${actionIndex + 1}.`);
  return observation;
}

function exactSourceSelectionState(observation, fallbackSelection = { anchor: 0, focus: 0 }) {
  return {
    source: observation?.source ?? '',
    selection: exactSelection(observation, fallbackSelection)
  };
}

function sameExactSourceSelection(left, right) {
  return left?.source === right?.source
    && left?.selection?.anchor === right?.selection?.anchor
    && left?.selection?.focus === right?.selection?.focus;
}

function historyStateCandidates(
  origin,
  obsidianParent,
  targetState,
  upperStateIndex,
  undoIndex
) {
  const candidates = [];
  for (let candidate = upperStateIndex; candidate >= -1; candidate -= 1) {
    const state = candidate < 0
      ? {
          source: origin.initialSource ?? '',
          selection: exactSelection(origin.initialSelection)
        }
      : exactSourceSelectionState(
          traceObservation(obsidianParent, candidate, 'O1 history predecessor'),
          exactSelection(origin.initialSelection)
        );
    const replayActions = origin.actions.slice(candidate + 1, undoIndex);
    const firstHistoryOperation = replayActions.find((action) => {
      const declared = action.historyEffect ?? action.certificationEffect;
      return declared === 'undo' || declared === 'redo'
        || declared === 'guaranteed-edit' || declared === 'possible-edit';
    });
    const beginsWithFreshEdit = firstHistoryOperation != null
      && actionHistoryEffect(firstHistoryOperation) == null;
    if (!beginsWithFreshEdit || state.source !== targetState.source) continue;
    candidates.push({
      candidate,
      exact: sameExactSourceSelection(state, targetState)
    });
  }
  return candidates;
}

function preferredHistoryStateCandidate(candidates = []) {
  return candidates.find(({ exact }) => exact) || candidates[0] || null;
}

function sourceSelectionStateAt(origin, obsidianParent, stateIndex, role) {
  if (stateIndex < 0) {
    return {
      source: origin.initialSource ?? '',
      selection: exactSelection(origin.initialSelection)
    };
  }
  return exactSourceSelectionState(
    traceObservation(obsidianParent, stateIndex, role),
    exactSelection(origin.initialSelection)
  );
}

function selectedSourceLine(observation) {
  const source = observation?.source;
  const selection = exactSelection(observation, { anchor: NaN, focus: NaN });
  if (typeof source !== 'string'
    || !Number.isSafeInteger(selection.anchor)
    || selection.anchor !== selection.focus
    || selection.anchor < 0
    || selection.anchor > source.length) return null;
  const start = source.lastIndexOf('\n', Math.max(0, selection.anchor - 1)) + 1;
  const nextBreak = source.indexOf('\n', selection.anchor);
  return source.slice(start, nextBreak < 0 ? source.length : nextBreak);
}

function hasLivePreviewAsteriskCaretAffinity(scenario, observation) {
  if (scenario?.mode !== 'live-preview') return false;
  const source = observation?.source;
  const selection = exactSelection(observation, { anchor: NaN, focus: NaN });
  if (typeof source !== 'string'
    || !Number.isSafeInteger(selection.anchor)
    || selection.anchor !== selection.focus) return false;
  return source[selection.anchor - 1] === '*' || source[selection.anchor] === '*';
}

function caretAffinityDependencyReduction(
  origin,
  obsidianParent,
  actionIndex,
  proposedStartActionIndex
) {
  const unsafeStateIndex = proposedStartActionIndex - 1;
  const unsafeState = sourceSelectionStateAt(
    origin,
    obsidianParent,
    unsafeStateIndex,
    'O1 caret-affinity predecessor'
  );
  if (!hasLivePreviewAsteriskCaretAffinity(origin, unsafeState)) return null;

  // A fresh Live Preview load may not expose a source position adjacent to an
  // incomplete `*` delimiter. Retain the shortest observed producing suffix
  // whose initial active line predates that delimiter. This is intentionally
  // activated only by a failed strict O1 replay; ordinary selectable `*`
  // positions remain one-action cases.
  for (let candidate = unsafeStateIndex - 1; candidate >= -1; candidate -= 1) {
    const state = sourceSelectionStateAt(
      origin,
      obsidianParent,
      candidate,
      'O1 caret-affinity producing predecessor'
    );
    const line = selectedSourceLine(state);
    if (line == null || line.includes('*')) continue;
    return {
      initialSource: state.source,
      initialSelection: state.selection,
      startActionIndex: candidate + 1,
      predecessorStateIndex: candidate,
      unsafeStateIndex,
      kind: 'live-preview-asterisk-caret-affinity'
    };
  }
  return null;
}

function replayResultArray(document) {
  return Array.isArray(document?.results) ? document.results : [];
}

function failedO1SetupReplay(result) {
  return result?.status === 'OBSIDIAN_NOT_AUTOMATABLE'
    && result?.reasonCode === 'obsidian-not-automatable';
}

function reproducedO1Replay(result) {
  return result?.status === 'REPRODUCIBLE'
    && result?.reasonCode === 'oracle-reproduced';
}

function failedO1OracleReplay(result) {
  return result?.status === 'AMBIGUOUS_ORACLE_MISMATCH'
    && (result?.reasonCode === 'oracle-final-mismatch'
      || result?.actionReplay?.status === 'MISMATCH');
}

function replayGateStartActionIndex(result, actionIndex) {
  const originReplay = result?.originReplay;
  const replayTarget = Number(
    originReplay?.firstDivergentActionIndex
      ?? originReplay?.divergentActionIndex
  );
  const gateActionCount = Number(originReplay?.gateActionCount);
  if (originReplay?.status !== 'VERIFIED'
    || !Number.isSafeInteger(replayTarget)
    || replayTarget !== actionIndex
    || !Number.isSafeInteger(gateActionCount)
    || gateActionCount < 1
    || gateActionCount > actionIndex + 1) return null;
  return actionIndex - gateActionCount + 1;
}

function actionCanCreateReplayDependency(action = {}) {
  if (actionHistoryEffect(action)) return false;
  const declared = action.historyEffect ?? action.certificationEffect;
  return declared === 'guaranteed-edit' || declared === 'possible-edit';
}

function strictReplayDependencyReduction(
  origin,
  actionIndex,
  priorReplayStartActionIndex
) {
  const boundedStart = Number.isSafeInteger(priorReplayStartActionIndex)
    ? Math.max(0, Math.min(actionIndex, priorReplayStartActionIndex))
    : actionIndex;
  for (let candidate = boundedStart - 1; candidate >= 0; candidate -= 1) {
    if (!actionCanCreateReplayDependency(origin.actions[candidate])) continue;
    return {
      startActionIndex: candidate,
      previousStartActionIndex: boundedStart,
      kind: 'preceding-edit-boundary'
    };
  }
  if (boundedStart === 0) return null;
  return {
    startActionIndex: 0,
    previousStartActionIndex: boundedStart,
    kind: 'conservative-original-prefix'
  };
}

function recordedCaretAffinityDependencyReduction(
  origin,
  obsidianParent,
  proposedStartActionIndex,
  recordedStartActionIndex
) {
  if (!Number.isSafeInteger(recordedStartActionIndex)
    || recordedStartActionIndex < 0
    || recordedStartActionIndex >= proposedStartActionIndex) return null;
  const unsafeStateIndex = proposedStartActionIndex - 1;
  const unsafeState = sourceSelectionStateAt(
    origin,
    obsidianParent,
    unsafeStateIndex,
    'O1 replay-recorded caret-affinity predecessor'
  );
  if (!hasLivePreviewAsteriskCaretAffinity(origin, unsafeState)) return null;
  const predecessorStateIndex = recordedStartActionIndex - 1;
  const predecessor = sourceSelectionStateAt(
    origin,
    obsidianParent,
    predecessorStateIndex,
    'O1 replay-recorded caret-affinity producing predecessor'
  );
  const line = selectedSourceLine(predecessor);
  if (line == null || line.includes('*')) return null;
  return {
    initialSource: predecessor.source,
    initialSelection: predecessor.selection,
    startActionIndex: recordedStartActionIndex,
    predecessorStateIndex,
    unsafeStateIndex,
    kind: 'live-preview-asterisk-caret-affinity'
  };
}

function historyDependencyReduction(origin, obsidianParent, viewerParent, actionIndex) {
  const effect = actionHistoryEffect(origin.actions[actionIndex]);
  if (!effect) return null;
  let undoIndex = actionIndex;
  if (effect === 'redo') {
    undoIndex = -1;
    for (let candidate = actionIndex - 1; candidate >= 0; candidate -= 1) {
      if (actionHistoryEffect(origin.actions[candidate]) === 'undo') {
        undoIndex = candidate;
        break;
      }
    }
    if (undoIndex < 0) return null;
  }
  const undoState = exactSourceSelectionState(
    traceObservation(obsidianParent, undoIndex, 'O1 history target'),
    exactSelection(origin.initialSelection)
  );
  const selected = preferredHistoryStateCandidate(historyStateCandidates(
    origin,
    obsidianParent,
    undoState,
    undoIndex - 2,
    undoIndex
  ));
  if (selected && !selected.exact) return null;
  let matchingStateIndex = selected?.candidate ?? -2;
  const anchorMatch = selected
    ? (selected.exact ? 'source-and-selection' : 'source-only')
    : null;
  if (matchingStateIndex < -1) return null;

  // A history mismatch can be caused by crossing the boundary immediately
  // before O1's restored group. Looking only at O1's target would turn, for
  // example, `Tab, Backspace, Undo` into `Backspace, Undo`: that shorter trace
  // passes in a fresh Viewer because the wrongly merged Tab transaction is no
  // longer present. Map V1's state after the paired Undo back onto the aligned
  // O1 prefix and retain the earlier target state. For Redo, also map the final
  // V1 state: the Undo result identifies the crossed boundary while the Redo
  // result can expose an additional earlier dependency.
  const viewerUndoTarget = viewerParent
    ? exactSourceSelectionState(
        traceObservation(viewerParent, undoIndex, 'V1 Undo target'),
        exactSelection(origin.initialSelection)
      )
    : null;
  const viewerUndoSelected = viewerUndoTarget
    ? preferredHistoryStateCandidate(historyStateCandidates(
        origin,
        obsidianParent,
        viewerUndoTarget,
        undoIndex - 1,
        undoIndex
      ))
    : null;
  const viewerRedoTarget = effect === 'redo' && viewerParent
    ? exactSourceSelectionState(
        traceObservation(viewerParent, actionIndex, 'V1 Redo target'),
        exactSelection(origin.initialSelection)
      )
    : null;
  const viewerRedoSelected = viewerRedoTarget
    ? preferredHistoryStateCandidate(historyStateCandidates(
        origin,
        obsidianParent,
        viewerRedoTarget,
        undoIndex - 1,
        undoIndex
      ))
    : null;
  const viewerSelected = [viewerUndoSelected, viewerRedoSelected]
    .filter(Boolean)
    .sort((left, right) => (
      left.candidate - right.candidate || Number(right.exact) - Number(left.exact)
    ))[0] || null;
  if (viewerSelected) {
    matchingStateIndex = Math.min(matchingStateIndex, viewerSelected.candidate);
  }

  const startActionIndex = matchingStateIndex + 1;
  if (startActionIndex >= undoIndex) return null;
  const predecessor = matchingStateIndex < 0
    ? {
        source: origin.initialSource ?? '',
        selection: exactSelection(origin.initialSelection)
      }
    : traceObservation(obsidianParent, matchingStateIndex, 'O1 history replay predecessor');
  return {
    actions: origin.actions.slice(startActionIndex, actionIndex + 1),
    initialSource: predecessor.source ?? '',
    initialSelection: exactSelection(predecessor, exactSelection(origin.initialSelection)),
    matchingStateIndex,
    anchorMatch,
    viewerTargetStateIndex: viewerSelected?.candidate ?? null,
    viewerTargetMatch: viewerSelected
      ? (viewerSelected.exact ? 'source-and-selection' : 'source-only')
      : null,
    viewerUndoTargetStateIndex: viewerUndoSelected?.candidate ?? null,
    viewerUndoTargetMatch: viewerUndoSelected
      ? (viewerUndoSelected.exact ? 'source-and-selection' : 'source-only')
      : null,
    viewerRedoTargetStateIndex: viewerRedoSelected?.candidate ?? null,
    viewerRedoTargetMatch: viewerRedoSelected
      ? (viewerRedoSelected.exact ? 'source-and-selection' : 'source-only')
      : null,
    startActionIndex,
    undoIndex
  };
}

function normalizedBehaviorOracle(scenario, observation, role) {
  if (!isExpandedListBehaviorScenario(scenario)) return null;
  const projected = projectObservation(scenario, observation, role).observation;
  return {
    semantic: projected?.semantic ?? null,
    presentation: projected?.presentation ?? null
  };
}

function oracleSnapshot(scenario, observation, role) {
  const snapshot = {
    source: observation?.source ?? '',
    selection: exactSelection(observation)
  };
  const behavior = normalizedBehaviorOracle(scenario, observation, role);
  return behavior ? { ...snapshot, ...behavior } : snapshot;
}

function authoritativeDivergences(result) {
  const steps = Array.isArray(result?.steps)
    ? result.steps.filter(({ authoritativeDivergence }) => authoritativeDivergence === true)
    : [];
  if (steps.length > 0) return steps;
  return result?.firstAuthoritativeDivergence
    ? [result.firstAuthoritativeDivergence]
    : [];
}

function actionHistoryEffect(action = {}) {
  const declared = action.historyEffect ?? action.certificationEffect;
  if (declared === 'undo' || declared === 'redo') return declared;
  const id = String(action.id || '').toLowerCase();
  return id === 'undo' || id === 'redo' ? id : null;
}

function repairCategory(action = {}) {
  if (actionHistoryEffect(action)) {
    return 'history';
  }
  if (action.type === 'input') return 'text-insertion';
  if (action.key === 'Tab') return action.shiftKey ? 'shift-tab' : 'tab';
  if (action.key === 'Enter') return action.shiftKey ? 'shift-enter' : 'enter';
  if (action.key === 'Backspace') return 'backspace';
  if (action.key === 'Delete') return 'delete';
  if (/^Arrow/.test(action.key || '')) return 'navigation';
  return 'other';
}

const O1_REBASE_UNSELECTABLE_ORIGINS = new Set([
  // These intermediate list states are real and selectable while editing,
  // but Obsidian normalizes their caret by one byte when they are loaded as
  // a fresh note. Preserve the producing prefix rather than fabricating a
  // one-action oracle from a state the real app cannot establish exactly.
  'certification-random.cdf1ab53a7fb7967a478',
  'certification-random.cdec4d9548fafea97331'
]);

const O1_PREFIX_SOURCE_AFFINITY_REBASE_ORIGINS = new Map([
  // Offset 3 in `<u>underline</u>` has two Live Preview DOM affinities because
  // the opening HTML tag is hidden. Fresh O1 launches repeatedly place the
  // caret after `</u>`, while the stale original trace placed it after `<u>`.
  // The eventual Backspace is an ordinary byte deletion, so rebase that
  // action from its authoritative predecessor instead of replaying the
  // non-reproducible hidden-boundary prefix.
  ['certification-random.6b79cb9a3ebc970e5b3b', Object.freeze({
    status: 'source-affinity-ambiguous',
    boundary: 'hidden-live-preview-html',
    resolution: 'rebase-authoritative-predecessor'
  })]
]);

function requiresPrefixState(action = {}, context = {}) {
  const historyEffect = actionHistoryEffect(action);
  // List editing commands are reconstructed from the exact O1 predecessor
  // source/caret and the same mode. Unlike delimiter overtype/history, their
  // behavior state is encoded by that source context, so rebasing is the
  // smaller faithful reproducer even for Backspace and Tab.
  if (context.expandedListBehavior === true
    && historyEffect == null) return false;
  return !O1_PREFIX_SOURCE_AFFINITY_REBASE_ORIGINS.has(context.originScenarioId)
    && (historyEffect === 'undo'
    || historyEffect === 'redo'
    // Tab/Shift+Tab can resolve the same canonical source offset through a
    // different semantic DOM owner after a fresh load. Preserve the producing
    // prefix so a minimized Viewer gate retains the runtime caret affinity
    // that exposed the authoritative divergence.
    || action.key === 'Tab'
    // Paired-delimiter deletion depends on editor pair state, not merely on
    // the two adjacent source bytes.
    || action.key === 'Backspace'
    // Overtype is likewise editor-pair state: loading the same adjacent
    // source bytes afresh does not mark the second delimiter as a closer.
    || (action.type === 'input'
      && context.predecessor?.source === context.expected?.source)
    || O1_REBASE_UNSELECTABLE_ORIGINS.has(context.originScenarioId));
}

function buildActionTraceRepairGate(
  scenarioDocument,
  comparisonDocument,
  obsidianEvidenceDocument,
  viewerEvidenceDocument,
  o1ReplayValidationDocument = null
) {
  const scenarios = indexUnique(scenarioArray(scenarioDocument), 'id', 'scenario');
  const obsidian = indexUnique(
    observationArray(obsidianEvidenceDocument, 'Obsidian'),
    'scenarioId',
    'O1 observation'
  );
  const viewer = indexUnique(
    observationArray(viewerEvidenceDocument, 'Viewer'),
    'scenarioId',
    'V1 observation'
  );
  const results = Array.isArray(comparisonDocument?.results)
    ? comparisonDocument.results
    : [];
  const replayResults = replayResultArray(o1ReplayValidationDocument);
  const o1Replay = replayResults.length
    ? indexUnique(replayResults, 'scenarioId', 'O1 replay result')
    : new Map();
  const sequences = [];

  for (const result of results) {
    const divergences = authoritativeDivergences(result);
    if (divergences.length === 0) continue;
    const origin = scenarios.get(result.scenarioId);
    const left = obsidian.get(result.scenarioId);
    const right = viewer.get(result.scenarioId);
    if (!origin || !left || !right) {
      throw new Error(`Missing source evidence for ${result.scenarioId}.`);
    }
    for (const divergence of divergences) {
      const actionIndex = Number(divergence.actionIndex);
      if (!Number.isSafeInteger(actionIndex) || actionIndex < 0
        || actionIndex >= origin.actions.length) {
        throw new Error(`Invalid authoritative action index for ${result.scenarioId}.`);
      }
      const expected = traceObservation(left, actionIndex, 'O1');
      const actual = traceObservation(right, actionIndex, 'V1');
      const action = origin.actions[actionIndex];
      const predecessor = actionIndex > 0
        ? traceObservation(left, actionIndex - 1, 'O1 predecessor')
        : null;
      const prefixStateRequiredByAction = requiresPrefixState(action, {
        originScenarioId: result.scenarioId,
        expandedListBehavior: isExpandedListBehaviorScenario(origin),
        predecessor,
        expected
      });
      const historyReduction = prefixStateRequiredByAction
        ? historyDependencyReduction(origin, left, right, actionIndex)
        : null;
      const o1SetupAnnotation = O1_PREFIX_SOURCE_AFFINITY_REBASE_ORIGINS.get(
        result.scenarioId
      );
      const shortId = result.scenarioId.replace(/^certification-random\./, '');
      const gateId = `v0.3-full-trace-repair.${shortId}.action-${actionIndex + 1}`;
      const replayResult = o1Replay.get(gateId) || null;
      const o1SetupReplayFailed = failedO1SetupReplay(replayResult);
      const o1OracleReplayFailed = failedO1OracleReplay(replayResult);
      const o1ReplayReproduced = reproducedO1Replay(replayResult);
      const provisionalStartActionIndex = historyReduction
        ? historyReduction.startActionIndex
        : prefixStateRequiredByAction
          ? 0
          : actionIndex;
      const priorReplayStartActionIndex = replayGateStartActionIndex(
        replayResult,
        actionIndex
      );
      const strictReplayReduction = o1OracleReplayFailed
        ? strictReplayDependencyReduction(
            origin,
            actionIndex,
            priorReplayStartActionIndex ?? provisionalStartActionIndex
          )
        : null;
      const recordedReplayStartActionIndex = [
        priorReplayStartActionIndex,
        strictReplayReduction?.startActionIndex
      ].filter(Number.isSafeInteger).reduce((minimum, candidate) => (
        Math.min(minimum, candidate)
      ), provisionalStartActionIndex);
      const setupAffinityReduction = o1SetupReplayFailed
        ? caretAffinityDependencyReduction(
            origin,
            left,
            actionIndex,
            provisionalStartActionIndex
          )
        : null;
      const recordedAffinityReduction = recordedCaretAffinityDependencyReduction(
        origin,
        left,
        provisionalStartActionIndex,
        recordedReplayStartActionIndex
      );
      const affinityReduction = setupAffinityReduction || recordedAffinityReduction;
      const originReplayStartActionIndex = [
        provisionalStartActionIndex,
        priorReplayStartActionIndex,
        strictReplayReduction?.startActionIndex,
        affinityReduction?.startActionIndex
      ].filter(Number.isSafeInteger).reduce((minimum, candidate) => (
        Math.min(minimum, candidate)
      ), provisionalStartActionIndex);
      const replayPredecessor = sourceSelectionStateAt(
        origin,
        left,
        originReplayStartActionIndex - 1,
        'O1 minimized replay predecessor'
      );
      const initialSource = replayPredecessor.source;
      const initialSelection = replayPredecessor.selection;
      const actions = origin.actions.slice(
        originReplayStartActionIndex,
        actionIndex + 1
      );
      const prefixStateRequired = prefixStateRequiredByAction
        || Boolean(affinityReduction);
      const prefixStatePreserved = prefixStateRequired
        && originReplayStartActionIndex === 0
        && actionIndex > 0;
      const dependencySuffixPreserved = prefixStateRequired
        && originReplayStartActionIndex > 0
        && originReplayStartActionIndex < actionIndex;
      const historyDependencyResolved = Boolean(historyReduction);
      const historyDependencyReduced = historyDependencyResolved
        && originReplayStartActionIndex > 0;
      const o1ReplayValidationObserved = replayResult != null;
      const automaticCaseComplete = o1ReplayReproduced || (
        !o1ReplayValidationObserved
        && (actions.length === 1 || historyDependencyResolved)
      );
      const minimizationStrategy = affinityReduction
        ? (historyReduction
          ? (originReplayStartActionIndex === 0
            ? 'caret-affinity-history-dependency-prefix'
            : 'caret-affinity-history-dependency-suffix')
          : (originReplayStartActionIndex === 0
            ? 'caret-affinity-producing-prefix'
            : 'caret-affinity-producing-suffix'))
        : prefixStateRequiredByAction
          ? (historyReduction
            ? (originReplayStartActionIndex === 0
              ? 'exact-history-dependency-prefix'
              : 'exact-history-dependency-suffix')
            : 'dependency-preserving-prefix')
          : (predecessor
            ? 'rebase-o1-authoritative-predecessor'
            : 'retain-original-target-action');
      const expectedOracle = oracleSnapshot(origin, expected, 'obsidian');
      const actualBeforeRepair = oracleSnapshot(origin, actual, 'viewer');
      const requiredObservations = isExpandedListBehaviorScenario(origin)
        ? [...new Set(origin.requiredObservations || [
            'source', 'selection', 'physical', 'semantic', 'presentation'
          ])]
        : ['source', 'selection', 'physical', 'semantic'];
      sequences.push({
        id: gateId,
        schemaVersion: 1,
        fixtureId: origin.fixtureId,
        syntaxFamily: origin.syntaxFamily,
        tags: origin.tags,
        mode: origin.mode,
        state: origin.state,
        initialSource,
        initialSelection,
        actions,
        requiredObservations,
        comparisonPolicy: origin.comparisonPolicy,
        repairCategory: repairCategory(action),
        oracleExpected: expectedOracle,
        repairMetadata: {
          originScenarioId: result.scenarioId,
          firstDivergentActionIndex: actionIndex,
          firstDivergentActionNumber: actionIndex + 1,
          divergentActionIndex: actionIndex,
          divergentActionNumber: actionIndex + 1,
          prefixStateRequired,
          prefixStatePreserved,
          dependencySuffixPreserved,
          originReplayStartActionIndex,
          historyDependencyResolved,
          historyDependencyReduced,
          historyCoreReplayStartActionIndex: historyReduction?.startActionIndex ?? null,
          historyReplayStartActionIndex: historyReduction
            ? originReplayStartActionIndex
            : null,
          historyUndoActionIndex: historyReduction?.undoIndex ?? null,
          historyAnchorMatch: historyReduction?.anchorMatch ?? null,
          historyViewerTargetStateIndex:
            historyReduction?.viewerTargetStateIndex ?? null,
          historyViewerTargetMatch: historyReduction?.viewerTargetMatch ?? null,
          historyViewerUndoTargetStateIndex:
            historyReduction?.viewerUndoTargetStateIndex ?? null,
          historyViewerUndoTargetMatch:
            historyReduction?.viewerUndoTargetMatch ?? null,
          historyViewerRedoTargetStateIndex:
            historyReduction?.viewerRedoTargetStateIndex ?? null,
          historyViewerRedoTargetMatch:
            historyReduction?.viewerRedoTargetMatch ?? null,
          caretAffinityDependencyPreserved: Boolean(affinityReduction),
          caretAffinityKind: affinityReduction?.kind ?? null,
          caretAffinityUnsafeStateIndex:
            affinityReduction?.unsafeStateIndex ?? null,
          caretAffinityPredecessorStateIndex:
            affinityReduction?.predecessorStateIndex ?? null,
          caretAffinityReplayStartActionIndex:
            affinityReduction?.startActionIndex ?? null,
          o1ReplaySetupFailureObserved: o1SetupReplayFailed,
          o1ReplaySetupStatus: o1SetupReplayFailed
            ? replayResult.status
            : null,
          o1ReplaySetupReasonCode: o1SetupReplayFailed
            ? replayResult.reasonCode
            : null,
          o1ReplayValidationObserved,
          o1ReplayStatus: replayResult?.status ?? null,
          o1ReplayReasonCode: replayResult?.reasonCode ?? null,
          o1ReplayReproduced,
          o1ReplayOracleMismatchObserved: o1OracleReplayFailed,
          o1ReplayPriorGateActionCount:
            replayResult?.originReplay?.gateActionCount ?? null,
          o1ReplayPriorStartActionIndex: priorReplayStartActionIndex,
          o1ReplayDependencyExpanded: Boolean(strictReplayReduction),
          o1ReplayDependencyExpansionKind: strictReplayReduction?.kind ?? null,
          o1ReplayDependencyPreviousStartActionIndex:
            strictReplayReduction?.previousStartActionIndex ?? null,
          requiresO1ReplayValidation: !automaticCaseComplete,
          automaticMinimizationComplete: automaticCaseComplete,
          minimizedActionCount: actions.length,
          minimizationStrategy,
          oneMinimalByActionCount: actions.length === 1,
          authoritativeDifferencePaths: divergence.authoritativeDifferencePaths || [],
          listContractDifferencePaths: divergence.listContractDifferencePaths || [],
          expectedO1: expectedOracle,
          observedV1BeforeRepair: actualBeforeRepair,
          ...(o1SetupAnnotation ? { o1SetupAnnotation } : {})
        }
      });
    }
  }

  const categoryCounts = sequences.reduce((counts, sequence) => {
    counts[sequence.repairCategory] = (counts[sequence.repairCategory] || 0) + 1;
    return counts;
  }, {});
  const divergentScenarioCount = results.filter((result) => (
    authoritativeDivergences(result).length > 0
  )).length;
  const expandedListGate = sequences.some((sequence) => (
    isExpandedListBehaviorScenario(sequence)
  ));
  return {
    schemaVersion: 1,
    kind: expandedListGate
      ? 'v0.3-list-editing-expanded-minimized-action-repair-gate'
      : 'v0.3-valid-random-full-action-trace-repair-gate',
    deterministic: true,
    sourceCorpusSha256: scenarioDocument?.corpusSha256 || null,
    sourceComparisonKind: comparisonDocument?.kind || null,
    sourceO1ReplayKind: o1ReplayValidationDocument?.kind || null,
    sourceO1ReplayGateCorpusSha256:
      o1ReplayValidationDocument?.gate?.corpusSha256 || null,
    divergentScenarioCount,
    // Backward-compatible alias retained for older repair-gate consumers.
    sourceMismatchScenarioCount: divergentScenarioCount,
    caseCount: sequences.length,
    divergentActionCount: sequences.length,
    everyAuthoritativeDivergentActionSaved: true,
    oneMinimalCaseCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.oneMinimalByActionCount
    )).length,
    oneActionRebasedCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.minimizationStrategy === 'rebase-o1-authoritative-predecessor'
    )).length,
    authoritativePredecessorRebasedCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.minimizationStrategy === 'rebase-o1-authoritative-predecessor'
    )).length,
    originalSingleActionCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.minimizationStrategy === 'retain-original-target-action'
    )).length,
    preservedPrefixCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.prefixStatePreserved
    )).length,
    prefixStateRequiredCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.prefixStateRequired
    )).length,
    dependencySuffixCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.dependencySuffixPreserved
    )).length,
    historyDependencyResolvedCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.historyDependencyResolved
    )).length,
    historyDependencySuffixCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.historyDependencyReduced
    )).length,
    caretAffinityDependencyCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.caretAffinityDependencyPreserved
    )).length,
    caretAffinityProducingSuffixCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.caretAffinityDependencyPreserved
        && repairMetadata.originReplayStartActionIndex > 0
    )).length,
    caretAffinityProducingPrefixCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.caretAffinityDependencyPreserved
        && repairMetadata.originReplayStartActionIndex === 0
    )).length,
    requiresO1ReplayValidationCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.requiresO1ReplayValidation
    )).length,
    o1ReplayReproducedCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.o1ReplayReproduced
    )).length,
    o1ReplayOracleMismatchCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.o1ReplayOracleMismatchObserved
    )).length,
    o1ReplayDependencyExpandedCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.o1ReplayDependencyExpanded
    )).length,
    automaticMinimizationCaseCount: sequences.filter(({ repairMetadata }) => (
      repairMetadata.automaticMinimizationComplete
    )).length,
    automaticMinimizationComplete: sequences.every(({ repairMetadata }) => (
      repairMetadata.automaticMinimizationComplete === true
    )),
    minimizationPolicy: {
      target: 'every-authoritative-divergent-action',
      ordinaryAction: 'rebase-from-exact-o1-predecessor',
      statefulAction:
        'retain the shortest contiguous suffix spanning both the O1-restored state and the aligned prior state restored by V1, so an incorrect merge/split boundary remains reproducible; Redo retains that edit suffix plus Undo/Redo',
      freshLoadCaretAffinity:
        'after a strict O1 setup failure adjacent to an incomplete Live Preview asterisk delimiter, retain the shortest observed suffix beginning on an active line before that delimiter was produced; require a new strict O1 replay before certification',
      oneActionMinimality:
        'Target action is required to produce its action-trace observation; no proper non-empty action subsequence exists.'
    },
    categoryCounts,
    corpusSha256: digest(sequences),
    sequences
  };
}

module.exports = Object.freeze({
  actionHistoryEffect,
  buildActionTraceRepairGate,
  authoritativeDivergences,
  exactSelection,
  historyDependencyReduction,
  normalizedBehaviorOracle,
  oracleSnapshot,
  repairCategory,
  requiresPrefixState,
  traceObservation
});
