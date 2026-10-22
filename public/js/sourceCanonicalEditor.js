(function exposeSourceCanonicalEditor(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const api = factory(
    root,
    isCommonJs ? require('../markdownEditableFoundation') : root?.markdownEditableFoundation,
    isCommonJs ? require('./markdownEditableProjection') : root?.markdownEditableProjection,
    isCommonJs ? require('../markdownPage') : root?.markdownPageModel,
    isCommonJs ? require('./markdownEditableSyntaxAdapters') : root?.markdownEditableSyntaxAdapters,
    isCommonJs ? require('../textEditing') : root?.textEditingModel,
    isCommonJs ? require('../hnStructureIndex') : root?.hnStructureIndexModel,
    isCommonJs ? require('../hnListIndex') : root?.hnListIndexModel,
    isCommonJs ? require('../hnListCommands') : root?.hnListCommands
  );
  if (isCommonJs) module.exports = api;
  if (root) root.sourceCanonicalEditor = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (
  root,
  defaultFoundation,
  defaultProjectionRuntime,
  defaultMarkdownModel,
  defaultSyntaxAdapters,
  defaultTextEditingModel,
  defaultHnStructureIndexModel,
  defaultHnListIndexModel,
  defaultHnListCommands
) => {
  'use strict';

  const MODES = Object.freeze({ EDIT: 'edit', BROWSER: 'browser' });
  const PROJECTION_MODE = 'source';
  const HN_SYNTAX_PROJECTION_MODE = 'live-preview';
  const HN_HEADING_ROW_CLASSES = Object.freeze([
    'is-hn-heading-row',
    'is-hn-heading-level-1',
    'is-hn-heading-level-2',
    'is-hn-heading-level-3'
  ]);
  const HN_SEMANTIC_BLOCK_KINDS = new Set([
    'description',
    'example',
    'reformulation'
  ]);
  const hnStructurePresentationStates = new WeakMap();
  let compositionSequence = 0;

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((child) => deepFreeze(child, seen));
    return Object.freeze(value);
  }

  function normalizeMode(value) {
    return value === MODES.BROWSER ? MODES.BROWSER : MODES.EDIT;
  }

  function modeCapabilities(value) {
    const mode = normalizeMode(value);
    return Object.freeze({
      mode,
      canEdit: mode === MODES.EDIT,
      canNavigateAnchors: mode === MODES.BROWSER,
      canSelect: true,
      canCopy: true
    });
  }

  function sourceFromSnapshot(snapshot) {
    return typeof snapshot?.source === 'string' ? snapshot.source : null;
  }

  function sourceVersionFromSnapshot(snapshot, fallback = 0) {
    const value = Number(snapshot?.sourceVersion);
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  function createIdentitySourceSnapshot(source, options = {}) {
    const foundation = options.foundation || defaultFoundation;
    if (!foundation?.createSourceSnapshot) {
      throw new TypeError('The source editor requires the canonical editable foundation.');
    }
    const canonical = typeof source === 'string' ? source : String(source ?? '');
    const previousSnapshot = options.previousSnapshot || null;
    const requestedVersion = Number(options.version);
    const version = Number.isSafeInteger(requestedVersion) && requestedVersion >= 0
      ? requestedVersion
      : Math.max(1, Number(previousSnapshot?.version || 0) + 1);
    const snapshot = foundation.createSourceSnapshot(canonical, {
      previousSnapshot,
      version,
      forceVersion: Boolean(previousSnapshot && previousSnapshot.version !== version)
    });
    if (snapshot.source === canonical) return snapshot;
    return Object.freeze({ ...snapshot, source: canonical });
  }

  function createIdentityPresentationPlan(snapshot) {
    if (!snapshot?.physicalLineIndex?.lines || typeof snapshot.markdownBody !== 'string') {
      throw new TypeError('Identity presentation requires one exact SourceSnapshot.');
    }
    const lines = snapshot.physicalLineIndex.lines.map((line) => Object.freeze({
      physicalLineId: line.id,
      index: line.index,
      start: line.start,
      contentEnd: line.contentEnd,
      sourceEnd: line.sourceEnd,
      lineEnding: line.lineEnding,
      text: line.text,
      leaves: Object.freeze([Object.freeze({
        leafId: `${line.id}:${line.start}:${line.contentEnd}:identity`,
        physicalLineId: line.id,
        lineIndex: line.index,
        sourceStart: line.start,
        sourceEnd: line.contentEnd,
        text: snapshot.markdownBody.slice(line.start, line.contentEnd),
        semanticOwnerId: null,
        kind: line.text.length ? 'source' : 'empty-row',
        visibility: 'visible',
        interactionPolicy: line.text.length ? 'editable-text' : 'editable-empty-row'
      })]),
      anchors: Object.freeze([]),
      metadata: Object.freeze({ identity: true })
    }));
    return deepFreeze({
      sourceVersion: snapshot.version,
      markdownBody: snapshot.markdownBody,
      mode: PROJECTION_MODE,
      lines: Object.freeze(lines),
      controls: Object.freeze([]),
      constructs: Object.freeze({})
    });
  }

  function normalizeSelection(value, sourceLength, fallback = sourceLength) {
    const endpoint = (name) => {
      const direct = value?.[name];
      const position = direct && typeof direct === 'object' ? direct : null;
      const numeric = position?.offset ?? direct;
      return clamp(Number.isFinite(Number(numeric)) ? Number(numeric) : fallback, 0, sourceLength);
    };
    const affinity = (name, offset) => {
      const direct = value?.[name];
      const candidate = direct && typeof direct === 'object'
        ? direct.affinity
        : value?.[`${name}Affinity`];
      if (candidate === 'before' || candidate === 'after') return candidate;
      return offset === sourceLength && sourceLength > 0 ? 'before' : 'after';
    };
    const anchor = endpoint('anchor');
    const focus = endpoint('focus');
    return Object.freeze({
      anchor,
      focus,
      anchorAffinity: affinity('anchor', anchor),
      focusAffinity: affinity('focus', focus)
    });
  }

  function selectedRange(selection) {
    return Object.freeze({
      from: Math.min(selection.anchor, selection.focus),
      to: Math.max(selection.anchor, selection.focus)
    });
  }

  function projectionPositionAtOffset(projection, foundation, snapshot, offset, affinity) {
    if (typeof projection?.enumerateDeclaredPositions === 'function') {
      const candidates = projection.enumerateDeclaredPositions()
        .filter((position) => position.offset === offset);
      if (!candidates.length) return null;
      return candidates.find((position) => position.affinity === affinity) || candidates[0];
    }
    return foundation.createEditablePosition(snapshot, offset, affinity);
  }

  function sourceDifference(previousSource, nextSource) {
    const previous = String(previousSource || '');
    const next = String(nextSource || '');
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) {
      start += 1;
    }
    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start
      && previous[previousEnd - 1] === next[nextEnd - 1]) {
      previousEnd -= 1;
      nextEnd -= 1;
    }
    return Object.freeze({ start, previousEnd, nextEnd, changed: previous !== next });
  }

  function stringSetsEqual(left, right) {
    const leftSet = left || new Set();
    const rightSet = right || new Set();
    return leftSet.size === rightSet.size
      && [...leftSet].every((value) => rightSet.has(value));
  }

  function hnProjectionRows(projection) {
    const rows = projection?.enumeratePhysicalRows?.();
    return Array.isArray(rows) ? rows : [];
  }

  function clearHnHeadingRows(projection) {
    hnProjectionRows(projection).forEach(({ element }) => {
      element?.classList?.remove?.(...HN_HEADING_ROW_CLASSES);
      if (!element?.dataset) return;
      delete element.dataset.hnHeadingId;
      delete element.dataset.hnHeadingLevel;
    });
  }

  function hnElementLocalBox(element, ancestor) {
    if (!element || !ancestor) return null;
    let current = element;
    let top = 0;
    const visited = new Set();
    while (current && current !== ancestor && !visited.has(current)) {
      visited.add(current);
      const offsetTop = Number(current.offsetTop);
      if (!Number.isFinite(offsetTop)) {
        current = null;
        break;
      }
      top += offsetTop;
      current = current.offsetParent || current.parentElement || null;
    }
    const offsetHeight = Number(element.offsetHeight);
    if (current === ancestor && Number.isFinite(offsetHeight) && offsetHeight > 0) {
      return Object.freeze({ top, bottom: top + offsetHeight });
    }

    const elementRect = element.getBoundingClientRect?.();
    const ancestorRect = ancestor.getBoundingClientRect?.();
    if (!elementRect || !ancestorRect) return null;
    const ancestorLayoutHeight = Number(ancestor.offsetHeight);
    const renderedHeight = Number(ancestorRect.height);
    const scale = Number.isFinite(ancestorLayoutHeight) && ancestorLayoutHeight > 0
      && Number.isFinite(renderedHeight) && renderedHeight > 0
      ? renderedHeight / ancestorLayoutHeight
      : 1;
    const localTop = (Number(elementRect.top) - Number(ancestorRect.top)) / scale;
    const localBottom = (Number(elementRect.bottom) - Number(ancestorRect.top)) / scale;
    return Number.isFinite(localTop) && Number.isFinite(localBottom) && localBottom > localTop
      ? Object.freeze({ top: localTop, bottom: localBottom })
      : null;
  }

  function cancelHnStructurePresentationFrame(state) {
    if (!state || state.frameRequest === null) return;
    root?.cancelAnimationFrame?.(state.frameRequest);
    state.frameRequest = null;
  }

  function clearHnStructurePresentation(context = {}) {
    const editorRoot = context.root || context.projection?.root || null;
    if (!editorRoot) return false;
    clearHnHeadingRows(context.projection);
    const state = hnStructurePresentationStates.get(editorRoot);
    if (!state) return false;
    cancelHnStructurePresentationFrame(state);
    state.resizeObserver?.disconnect?.();
    state.resizeObserver = null;
    state.layer?.replaceChildren?.();
    state.layer?.remove?.();
    hnStructurePresentationStates.delete(editorRoot);
    return true;
  }

  function ensureHnStructurePresentationState(context = {}) {
    const editorRoot = context.root || context.projection?.root || null;
    const host = editorRoot?.parentElement || null;
    const document = context.document || editorRoot?.ownerDocument || null;
    if (!editorRoot || !host || !document?.createElement) return null;
    const existing = hnStructurePresentationStates.get(editorRoot);
    if (existing?.host === host) return existing;
    if (existing) clearHnStructurePresentation({ root: editorRoot, projection: context.projection });

    const layer = document.createElement('div');
    layer.className = 'hn-structure-rail-layer';
    layer.contentEditable = 'false';
    layer.dataset.hnStructureRailLayer = 'true';
    layer.setAttribute?.('aria-hidden', 'true');
    layer.hidden = true;
    host.append?.(layer);
    const state = {
      editorRoot,
      host,
      document,
      layer,
      projection: context.projection || null,
      sourceSnapshot: context.sourceSnapshot || null,
      resizeObserver: null,
      frameRequest: null
    };
    hnStructurePresentationStates.set(editorRoot, state);
    return state;
  }

  function reconcileHnStructureRails(state) {
    const layer = state?.layer;
    const projection = state?.projection;
    const snapshot = state?.sourceSnapshot;
    const structure = snapshot?.hnStructureIndex;
    if (!layer || !projection || !structure
      || Number(structure.sourceVersion) !== Number(snapshot.version)) return Object.freeze([]);
    layer.replaceChildren?.();
    layer.hidden = true;
    const rows = hnProjectionRows(projection);
    const rowsByIndex = new Map(rows.map((entry) => [Number(entry.index), entry]));
    const rails = [];
    (structure.semanticBlocks || []).forEach((block) => {
      const kind = String(block?.kind || '');
      const firstIndex = Number(block?.physicalLineExtent?.startLineIndex);
      const lastIndex = Number(block?.physicalLineExtent?.endLineIndex);
      if (!HN_SEMANTIC_BLOCK_KINDS.has(kind)
        || !Number.isInteger(firstIndex) || !Number.isInteger(lastIndex)
        || lastIndex < firstIndex) return;
      const first = rowsByIndex.get(firstIndex);
      const last = rowsByIndex.get(lastIndex);
      const firstBox = hnElementLocalBox(first?.element, state.host);
      const lastBox = hnElementLocalBox(last?.element, state.host);
      if (!firstBox || !lastBox || !(lastBox.bottom > firstBox.top)) return;
      const rail = state.document.createElement('div');
      rail.className = `hn-semantic-block-rail is-hn-${kind}-rail`;
      rail.contentEditable = 'false';
      rail.dataset.hnSemanticBlockId = String(block.id || '');
      rail.dataset.hnSemanticBlockKind = kind;
      rail.dataset.hnSemanticBlockStart = String(block.fullRange?.start ?? '');
      rail.dataset.hnSemanticBlockEnd = String(block.fullRange?.end ?? '');
      rail.dataset.hnSemanticBlockFirstLine = String(first?.physicalLineId || '');
      rail.dataset.hnSemanticBlockLastLine = String(last?.physicalLineId || '');
      rail.setAttribute?.('aria-hidden', 'true');
      rail.style?.setProperty?.('--hn-semantic-rail-top', `${firstBox.top}px`);
      rail.style?.setProperty?.(
        '--hn-semantic-rail-height',
        `${lastBox.bottom - firstBox.top}px`
      );
      rails.push(rail);
    });
    if (rails.length) {
      layer.append?.(...rails);
      layer.hidden = false;
    }
    layer.dataset.hnStructureRailCount = String(rails.length);
    return Object.freeze(rails);
  }

  function scheduleHnStructureRailReconciliation(state) {
    if (!state || state.frameRequest !== null) return;
    if (typeof root?.requestAnimationFrame !== 'function') {
      reconcileHnStructureRails(state);
      return;
    }
    state.frameRequest = root.requestAnimationFrame(() => {
      state.frameRequest = null;
      reconcileHnStructureRails(state);
    });
  }

  function observeHnStructureGeometry(state) {
    state?.resizeObserver?.disconnect?.();
    if (!state || typeof root?.ResizeObserver !== 'function') return;
    state.resizeObserver = new root.ResizeObserver(() => (
      scheduleHnStructureRailReconciliation(state)
    ));
    state.resizeObserver.observe(state.editorRoot);
    hnProjectionRows(state.projection).forEach(({ element }) => {
      if (element) state.resizeObserver.observe(element);
    });
  }

  function mountHnStructurePresentation(context = {}) {
    const projection = context.projection;
    const snapshot = context.sourceSnapshot;
    const structure = snapshot?.hnStructureIndex;
    const rows = hnProjectionRows(projection);
    clearHnHeadingRows(projection);
    if (!structure || Number(structure.sourceVersion) !== Number(snapshot?.version)) {
      clearHnStructurePresentation(context);
      return Object.freeze({ headingCount: 0, railCount: 0 });
    }
    const rowsByIndex = new Map(rows.map((entry) => [Number(entry.index), entry]));
    let headingCount = 0;
    (structure.headings || []).forEach((heading) => {
      const level = Number(heading?.headingLevel);
      const lineIndex = Number(heading?.physicalLineExtent?.startLineIndex);
      const row = rowsByIndex.get(lineIndex)?.element;
      if (!row || ![1, 2, 3].includes(level)) return;
      row.classList?.add?.('is-hn-heading-row', `is-hn-heading-level-${level}`);
      if (row.dataset) {
        row.dataset.hnHeadingId = String(heading.id || '');
        row.dataset.hnHeadingLevel = String(level);
      }
      headingCount += 1;
    });

    const state = ensureHnStructurePresentationState(context);
    if (!state) return Object.freeze({ headingCount, railCount: 0 });
    state.projection = projection;
    state.sourceSnapshot = snapshot;
    const rails = reconcileHnStructureRails(state);
    observeHnStructureGeometry(state);
    return Object.freeze({ headingCount, railCount: rails.length });
  }

  function createIdentityPresentationStrategy(options = {}) {
    const foundation = options.foundation || defaultFoundation;
    return Object.freeze({
      id: 'identity',
      projectionMode: PROJECTION_MODE,
      modeSensitive: false,
      createSourceSnapshot: (source, snapshotOptions = {}) => createIdentitySourceSnapshot(
        source,
        { ...snapshotOptions, foundation }
      ),
      createPresentationPlan: (snapshot) => createIdentityPresentationPlan(snapshot),
      activeOwnerIdsForSelection: () => Object.freeze([]),
      mountPresentation: () => Object.freeze([]),
      applyNewline: () => null,
      applyIndentation: () => null,
      applyDeletion: () => null
    });
  }

  function approvedHnUnorderedRow(snapshot, selection = {}, endpoint = 'start') {
    const sourceLength = String(snapshot?.markdownBody || '').length;
    const normalized = normalizeSelection(selection, sourceLength, 0);
    const position = endpoint === 'focus'
      ? { offset: normalized.focus, affinity: normalized.focusAffinity }
      : normalized.anchor < normalized.focus
        ? { offset: normalized.anchor, affinity: normalized.anchorAffinity }
        : { offset: normalized.focus, affinity: normalized.focusAffinity };
    const line = snapshot?.physicalLineIndex?.lineAtOffset?.(
      position.offset,
      position.affinity
    );
    const row = snapshot?.editableListSemanticIndex?.byLineIndex?.get?.(line?.index);
    return row?.unordered === true && row?.task !== true ? row : null;
  }

  function sourceAfterPrimaryEdits(source, edits = []) {
    return [...edits].reverse().reduce((value, edit) => (
      `${value.slice(0, edit.start)}${edit.replacement}${value.slice(edit.end)}`
    ), source);
  }

  function offsetBeforeEdits(requestedOffset, edits = [], affinity = 'after') {
    const offset = Number(requestedOffset) || 0;
    let delta = 0;
    for (const edit of edits) {
      const replacementLength = String(edit.replacement || '').length;
      const afterStart = Number(edit.start) + delta;
      const afterEnd = afterStart + replacementLength;
      if (offset < afterStart || offset === afterStart && affinity === 'before') break;
      if (offset > afterEnd || offset === afterEnd && affinity === 'after') {
        delta += replacementLength - (Number(edit.end) - Number(edit.start));
        continue;
      }
      return affinity === 'before' ? Number(edit.start) : Number(edit.end);
    }
    return offset - delta;
  }

  function hnPrimaryListCommandResult(snapshot, result, createSnapshot = null) {
    if (!result?.changed || !Array.isArray(result.primaryEdits)
      || result.primaryEdits.length === 0) return result;
    const source = String(snapshot?.markdownBody || '');
    const primaryEdits = result.primaryEdits;
    const primarySource = sourceAfterPrimaryEdits(source, primaryEdits);
    const renumberEdits = Array.isArray(result.renumberEdits) ? result.renumberEdits : [];
    const afterSelection = result.transaction?.afterSelection || result.selection || {};
    const endpoint = (name) => {
      const affinity = afterSelection[`${name}Affinity`] === 'before' ? 'before' : 'after';
      return {
        offset: offsetBeforeEdits(afterSelection[name], renumberEdits, affinity),
        affinity
      };
    };
    const anchor = endpoint('anchor');
    const focus = endpoint('focus');
    const selection = Object.freeze({
      anchor: anchor.offset,
      focus: focus.offset,
      anchorAffinity: anchor.affinity,
      focusAffinity: focus.affinity
    });
    const primarySnapshot = typeof createSnapshot === 'function'
      ? createSnapshot(primarySource)
      : result.snapshot;
    const affectedPhysicalLineIds = Object.freeze([...new Set(primaryEdits.flatMap((edit) => {
      const startLine = snapshot?.physicalLineIndex?.lineAtOffset?.(edit.start, 'after');
      const endLine = snapshot?.physicalLineIndex?.lineAtOffset?.(edit.end, 'before');
      return [startLine?.id, endLine?.id].filter(Boolean).map(String);
    }))]);
    return Object.freeze({
      ...result,
      source: primarySource,
      markdownBody: primarySource,
      selection,
      snapshot: primarySnapshot,
      renumberEdits: Object.freeze([]),
      affectedPhysicalLineIds,
      transaction: result.transaction ? Object.freeze({
        ...result.transaction,
        afterSource: primarySource,
        afterSelection: selection,
        renumberEdits: Object.freeze([]),
        affectedPhysicalLineIds
      }) : null
    });
  }

  function createHnBasicPresentationStrategy(options = {}) {
    const foundation = options.foundation || defaultFoundation;
    const model = options.model || defaultMarkdownModel;
    const syntaxAdapters = options.syntaxAdapters || defaultSyntaxAdapters;
    const structureIndexModel = options.structureIndexModel || defaultHnStructureIndexModel;
    const listIndexModel = options.listIndexModel || defaultHnListIndexModel;
    const listCommands = options.listCommands || defaultHnListCommands;
    if (!foundation?.applyEditableNewline || !foundation?.applyEditableListIndentation
      || !model?.createSourceSnapshot
      || !syntaxAdapters?.buildHnBasicPresentationPlan
      || !syntaxAdapters?.activePresentationOwnerIdsForSelection
      || !structureIndexModel?.createHnStructureIndex
      || !listIndexModel?.createHnListIndex
      || !listCommands?.applyHnSequenceListNewline
      || !listCommands?.applyHnSequenceListIndentation
      || !listCommands?.applyHnSequenceListDeletion) {
      throw new TypeError('The HN basic syntax strategy requires shared Markdown owners.');
    }
    const presentationRuntime = () => options.presentationRuntime || root?.markdownPageView || null;
    const requirePresentationRuntime = () => {
      const runtime = presentationRuntime();
      if (!runtime?.clearEditablePresentationMountState
        || !runtime?.decorateEditableProjectedLeaves
        || !runtime?.mountEditableListPresentations
        || !runtime?.mountEditableMathPresentations) {
        throw new TypeError('The shared Markdown presentation primitives are unavailable.');
      }
      return runtime;
    };
    return Object.freeze({
      id: 'hn-basic',
      projectionMode: HN_SYNTAX_PROJECTION_MODE,
      modeSensitive: true,
      preflightPresentation() {
        requirePresentationRuntime();
        return true;
      },
      createSourceSnapshot(source, snapshotOptions = {}) {
        const canonical = typeof source === 'string' ? source : String(source ?? '');
        const snapshot = model.createSourceSnapshot(canonical, snapshotOptions);
        if (snapshot.source === canonical && snapshot.hnStructureIndex
          && snapshot.hnListIndex) return snapshot;
        const hnStructureIndex = snapshot.hnStructureIndex
          || structureIndexModel.createHnStructureIndex(snapshot);
        const structureSnapshot = snapshot.hnStructureIndex
          ? snapshot
          : Object.freeze({ ...snapshot, hnStructureIndex });
        const hnListIndex = listIndexModel.createHnListIndex(structureSnapshot);
        return Object.freeze({
          ...structureSnapshot,
          source: canonical,
          hnListIndex
        });
      },
      createPresentationPlan(snapshot, planOptions = {}) {
        return syntaxAdapters.buildHnBasicPresentationPlan(snapshot, {
          model,
          hnMode: normalizeMode(planOptions.mode),
          activeOwnerIds: planOptions.activeOwnerIds || []
        });
      },
      activeOwnerIdsForSelection(plan, selection, planOptions = {}) {
        if (normalizeMode(planOptions.mode) !== MODES.EDIT) return Object.freeze([]);
        return syntaxAdapters.activePresentationOwnerIdsForSelection(plan, selection);
      },
      mountPresentation(context = {}) {
        const runtime = requirePresentationRuntime();
        const projection = context.projection;
        const plan = context.presentationPlan;
        const leaves = projection.enumerateProjectedLeaves();
        const state = {
          editableProjection: projection,
          editablePresentationPlan: plan,
          sourceSnapshot: context.sourceSnapshot,
          sourceVersion: context.sourceSnapshot?.version,
          body: context.sourceSnapshot?.markdownBody || '',
          mode: HN_SYNTAX_PROJECTION_MODE
        };
        runtime.clearEditablePresentationMountState(state);
        runtime.decorateEditableProjectedLeaves(plan, leaves);
        runtime.mountEditableListPresentations(state, projection, plan, leaves);
        runtime.mountEditableMathPresentations(state, projection, plan, leaves);
        mountHnStructurePresentation(context);
        return Object.freeze(leaves);
      },
      clearPresentation(context = {}) {
        presentationRuntime()?.clearEditablePresentationMountState?.({
          editableProjection: context.projection,
          bodyRoot: context.root
        });
        return clearHnStructurePresentation(context);
      },
      destroyPresentation(context = {}) {
        return clearHnStructurePresentation(context);
      },
      applyNewline(snapshot, selection, commandOptions = {}) {
        const sequenceResult = listCommands.applyHnSequenceListNewline(
          snapshot,
          selection,
          commandOptions
        );
        if (sequenceResult) return sequenceResult;
        if (commandOptions.inputType === 'insertLineBreak'
          || !approvedHnUnorderedRow(snapshot, selection)) return null;
        return hnPrimaryListCommandResult(
          snapshot,
          foundation.applyEditableNewline(snapshot, selection, commandOptions),
          (source) => model.createSourceSnapshot(source, {
            previousSnapshot: snapshot,
            version: Number(snapshot.version || 0) + 1
          })
        );
      },
      applyIndentation(snapshot, selection, direction = 'indent') {
        const sequenceResult = listCommands.applyHnSequenceListIndentation(
          snapshot,
          selection,
          direction
        );
        if (sequenceResult) return sequenceResult;
        if (!approvedHnUnorderedRow(snapshot, selection, 'focus')) return null;
        return hnPrimaryListCommandResult(
          snapshot,
          foundation.applyEditableListIndentation(snapshot, selection, direction),
          (source) => model.createSourceSnapshot(source, {
            previousSnapshot: snapshot,
            version: Number(snapshot.version || 0) + 1
          })
        );
      },
      applyDeletion(snapshot, selection, direction, commandOptions = {}) {
        return listCommands.applyHnSequenceListDeletion(
          snapshot,
          selection,
          direction,
          commandOptions
        );
      }
    });
  }

  function eventIsPrimaryModifier(event) {
    return Boolean(event && !event.altKey && (event.metaKey || event.ctrlKey));
  }

  function eventInside(rootElement, event) {
    const target = event?.target;
    return Boolean(target && (target === rootElement || rootElement.contains?.(target)));
  }

  function projectionPositionPrecedes(left, right) {
    if (!left || !right) return false;
    if (left.offset !== right.offset) return left.offset < right.offset;
    if (left.affinity === right.affinity) return false;
    return left.affinity === 'before';
  }

  function orderedProjectionSelection(selection) {
    if (!selection?.anchor || !selection?.focus) return null;
    return projectionPositionPrecedes(selection.focus, selection.anchor)
      ? { start: selection.focus, end: selection.anchor }
      : { start: selection.anchor, end: selection.focus };
  }

  class SourceCanonicalEditorController {
    constructor(options = {}) {
      if (!options.root || !options.session || typeof options.viewId !== 'string') {
        throw new TypeError('Source editor requires root, session, and viewId.');
      }
      const foundation = options.foundation || defaultFoundation;
      const projectionRuntime = options.projectionRuntime || defaultProjectionRuntime;
      if (!foundation?.createSourceSnapshot || !foundation?.createEditablePosition
        || !foundation?.normalizeVisibleSelection || !foundation?.exactDeletionRange
        || !projectionRuntime?.createEditableProjection) {
        throw new TypeError('Source editor projection dependencies are unavailable.');
      }
      this.root = options.root;
      this.document = options.document || this.root.ownerDocument || root?.document || null;
      this.foundation = foundation;
      this.projectionRuntime = projectionRuntime;
      this.presentationStrategy = options.presentationStrategy
        || createIdentityPresentationStrategy({ foundation });
      if (!this.presentationStrategy?.createSourceSnapshot
        || !this.presentationStrategy?.createPresentationPlan
        || !this.presentationStrategy?.projectionMode) {
        throw new TypeError('Source editor requires one complete presentation strategy.');
      }
      this.presentationStrategy.preflightPresentation?.();
      this.session = options.session;
      this.viewId = options.viewId;
      this.referenceId = options.referenceId || null;
      this.paneState = options.paneState || null;
      this.mode = normalizeMode(options.mode);
      this.pageEditMode = options.pageEditMode === true;
      this.onSnapshot = typeof options.onSnapshot === 'function' ? options.onSnapshot : null;
      this.onDispose = typeof options.onDispose === 'function' ? options.onDispose : null;
      this.onError = typeof options.onError === 'function' ? options.onError : null;
      this.projection = projectionRuntime.createEditableProjection({
        root: this.root,
        document: this.document,
        foundation
      });
      this.sourceSnapshot = null;
      this.presentationPlan = null;
      this.activeOwnerIds = new Set();
      this.sessionSnapshot = null;
      this.localSelection = Object.freeze({
        anchor: 0,
        focus: 0,
        anchorAffinity: 'after',
        focusAffinity: 'after'
      });
      this.composition = null;
      this.preferredArrowX = null;
      this.pointerGesture = null;
      this.pendingMousePointer = null;
      this.multiClickAnchor = null;
      this.unsubscribe = null;
      this.destroyed = false;
      this.transactionCount = 0;
      this.compositionCount = 0;
      this.updateCount = 0;
      this.selectionCaptureSuppressed = false;
      this.selectionRestoreFailure = null;
      this._listeners = [];
      this._diagnostic = null;

      this.root.classList?.add?.('hn-source-editor');
      this.root.setAttribute?.('role', 'textbox');
      this.root.setAttribute?.('aria-label', options.ariaLabel || 'HN Text document');
      this.root.setAttribute?.('aria-multiline', 'true');
      this.root.setAttribute?.('spellcheck', 'true');
      this.root.dataset.hnSourceEditor = 'true';
      this.root.dataset.hnViewId = this.viewId;
      this._installEvents();

      const subscriber = {
        paneState: this.paneState,
        updateState: (snapshot, metadata) => this._receiveSnapshot(snapshot, metadata),
        onDispose: () => {
          if (!this.destroyed) this.onDispose?.();
        }
      };
      if (this.referenceId) subscriber.referenceId = this.referenceId;
      const subscription = this.session.subscribe(this.viewId, subscriber);
      this.unsubscribe = typeof subscription === 'function'
        ? subscription
        : subscription?.unsubscribe?.bind(subscription) || (() => false);
      this.paneState = this.session.paneStateForView?.(this.viewId) || this.paneState;
      this._applyCapabilities();
    }

    capabilities() {
      const base = modeCapabilities(this.mode);
      const sessionReadOnly = this.sessionSnapshot?.readOnly === true
        || this.session.saveStatus?.readOnly === true;
      return Object.freeze({
        ...base,
        canEdit: base.canEdit && !sessionReadOnly && !this.pageEditMode
          && typeof sourceFromSnapshot(this.sessionSnapshot) === 'string',
        readOnly: !base.canEdit || sessionReadOnly || this.pageEditMode,
        sessionReadOnly,
        pageEditMode: this.pageEditMode
      });
    }

    source() {
      return sourceFromSnapshot(this.sessionSnapshot) ?? '';
    }

    sourceVersion() {
      return sourceVersionFromSnapshot(this.sessionSnapshot, this.sourceSnapshot?.version || 0);
    }

    _applyCapabilities() {
      const capabilities = this.capabilities();
      this.root.setAttribute?.('contenteditable', capabilities.canEdit ? 'true' : 'false');
      this.root.setAttribute?.('aria-readonly', String(!capabilities.canEdit));
      this.root.setAttribute?.('tabindex', '0');
      this.root.dataset.hnMode = capabilities.mode;
      this.root.dataset.hnCanEdit = String(capabilities.canEdit);
      this.root.dataset.hnCanNavigateAnchors = String(capabilities.canNavigateAnchors);
      this.root.dataset.hnSessionReadOnly = String(capabilities.sessionReadOnly);
      this.root.dataset.hnPageEditMode = String(capabilities.pageEditMode);
      this.root.classList?.toggle?.('is-hn-edit-mode', capabilities.mode === MODES.EDIT);
      this.root.classList?.toggle?.('is-hn-browser-mode', capabilities.mode === MODES.BROWSER);
      return capabilities;
    }

    _renderMigrationDiagnostic(snapshot) {
      this.presentationStrategy.clearPresentation?.({
        root: this.root,
        document: this.document,
        projection: this.projection,
        sourceSnapshot: this.sourceSnapshot,
        presentationPlan: this.presentationPlan,
        mode: this.mode
      });
      const diagnostic = snapshot?.migrationFailure || null;
      const message = String(diagnostic?.error || 'HN Text source is unavailable.');
      const element = this.document?.createElement?.('p');
      if (element) {
        element.className = 'hn-source-migration-diagnostic';
        element.dataset.hnMigrationFailure = 'true';
        element.setAttribute?.('role', 'status');
        element.textContent = message;
        this.root.replaceChildren?.(element);
      } else {
        this.root.textContent = message;
      }
      this._diagnostic = Object.freeze({ message, errors: diagnostic?.errors || null });
      this.root.dataset.hnMigrationFailure = 'true';
      this.sourceSnapshot = null;
      this.presentationPlan = null;
      this.activeOwnerIds = new Set();
      this._applyCapabilities();
    }

    _planForActiveOwners(activeOwnerIds = this.activeOwnerIds) {
      if (!this.sourceSnapshot) return null;
      return this.presentationStrategy.createPresentationPlan(this.sourceSnapshot, {
        mode: this.mode,
        activeOwnerIds: [...(activeOwnerIds || [])]
      });
    }

    _renderPresentation(plan = this._planForActiveOwners()) {
      if (!this.sourceSnapshot || !plan) return null;
      this.presentationStrategy.preflightPresentation?.();
      this.presentationPlan = plan;
      this.projection.render(this.sourceSnapshot, {
        mode: this.presentationStrategy.projectionMode,
        presentationPlan: plan
      });
      this.presentationStrategy.mountPresentation?.({
        root: this.root,
        document: this.document,
        projection: this.projection,
        sourceSnapshot: this.sourceSnapshot,
        presentationPlan: plan,
        mode: this.mode
      });
      return plan;
    }

    _reconcileExactPresentationRevision(previousSnapshot, previousPlan, nextPlan, metadata = {}) {
      const transaction = metadata?.transaction;
      if (!previousSnapshot
        || !previousPlan
        || !nextPlan
        || typeof this.projection?.reconcileExactSourceRevision !== 'function'
        || !transaction
        || !Number.isInteger(transaction.from)
        || !Number.isInteger(transaction.to)
        || typeof transaction.insert !== 'string'
        || metadata.sourceVersionBefore !== previousSnapshot.version
        || metadata.sourceVersionAfter !== this.sourceSnapshot?.version
        || this.sourceSnapshot.version !== previousSnapshot.version + 1
        || /[\r\n]/.test(transaction.insert)
        || /[\r\n]/.test(previousSnapshot.markdownBody.slice(
          transaction.from,
          transaction.to
        ))
        || previousSnapshot.physicalLineIndex.lines.length
          !== this.sourceSnapshot.physicalLineIndex.lines.length) return false;

      const startLine = previousSnapshot.physicalLineIndex.lineAtOffset(
        transaction.from,
        'after'
      );
      const endLine = previousSnapshot.physicalLineIndex.lineAtOffset(
        transaction.to,
        'before'
      );
      const affectedPhysicalLineIds = [...new Set([
        startLine?.id,
        endLine?.id
      ].filter(Boolean).map(String))];
      if (affectedPhysicalLineIds.length === 0) return false;

      this.presentationStrategy.clearPresentation?.({
        root: this.root,
        document: this.document,
        projection: this.projection,
        sourceSnapshot: previousSnapshot,
        presentationPlan: previousPlan,
        mode: this.mode
      });
      const reconciled = this.projection.reconcileExactSourceRevision(
        this.sourceSnapshot,
        {
          mode: this.presentationStrategy.projectionMode,
          presentationPlan: nextPlan,
          edits: [Object.freeze({
            start: transaction.from,
            end: transaction.to,
            replacement: transaction.insert
          })],
          affectedPhysicalLineIds
        }
      );
      if (!reconciled) return false;
      this.presentationPlan = nextPlan;
      this.presentationStrategy.mountPresentation?.({
        root: this.root,
        document: this.document,
        projection: this.projection,
        sourceSnapshot: this.sourceSnapshot,
        presentationPlan: nextPlan,
        mode: this.mode
      });
      return true;
    }

    _activeOwnersForSelection(selection, plan = this.presentationPlan) {
      if (!this.ownsFocus()) return new Set();
      const values = this.presentationStrategy.activeOwnerIdsForSelection?.(
        plan,
        selection,
        { mode: this.mode, sourceSnapshot: this.sourceSnapshot }
      ) || [];
      return new Set(Array.from(values, (value) => String(value)));
    }

    _syncActivePresentation(selection, { force = false } = {}) {
      if (!this.sourceSnapshot || this.composition) return false;
      const nextOwners = this._activeOwnersForSelection(selection);
      if (!force && stringSetsEqual(this.activeOwnerIds, nextOwners)) return false;
      this.activeOwnerIds = nextOwners;
      const plan = this._planForActiveOwners(nextOwners);
      this._renderPresentation(plan);
      if (this.ownsFocus() && selection) this.restoreSelection(selection);
      return true;
    }

    _receiveSnapshot(snapshot, metadata = {}) {
      if (this.destroyed) return;
      this.updateCount += 1;
      this.sessionSnapshot = snapshot || this.session.currentSnapshot?.() || null;
      const source = sourceFromSnapshot(this.sessionSnapshot);
      if (this.composition) {
        const sourceUnchanged = source !== null && source === this.composition.baseSource;
        if (!sourceUnchanged || !this.capabilities().canEdit) {
          this.composition.invalidated = true;
          this.composition.cancelled = true;
        }
        // Chromium owns the provisional replacement range until composition
        // settles. Defer every canonical projection rebuild, including an
        // external Pane publication, so that owner is never remounted away.
        this.onSnapshot?.(this.sessionSnapshot, metadata);
        return;
      }
      if (source === null) {
        this._renderMigrationDiagnostic(this.sessionSnapshot);
        this.onSnapshot?.(this.sessionSnapshot, metadata);
        return;
      }
      this._diagnostic = null;
      delete this.root.dataset.hnMigrationFailure;
      const version = sourceVersionFromSnapshot(
        this.sessionSnapshot,
        Math.max(1, Number(this.sourceSnapshot?.version || 0) + 1)
      );
      if (this.multiClickAnchor?.sourceVersion !== version) this._clearMultiClickAnchor();
      const previousSourceSnapshot = this.sourceSnapshot;
      const previousPresentationPlan = this.presentationPlan;
      this.sourceSnapshot = this.presentationStrategy.createSourceSnapshot(source, {
        previousSnapshot: previousSourceSnapshot,
        version
      });
      const selection = this.session.selectionForView?.(this.viewId)
        || this.paneState?.selection
        || this.localSelection;
      this.localSelection = normalizeSelection(selection, source.length, source.length);
      const inactivePlan = this._planForActiveOwners(new Set());
      this.activeOwnerIds = this._activeOwnersForSelection(this.localSelection, inactivePlan);
      const nextPlan = this._planForActiveOwners(this.activeOwnerIds);
      if (!this._reconcileExactPresentationRevision(
        previousSourceSnapshot,
        previousPresentationPlan,
        nextPlan,
        metadata
      )) this._renderPresentation(nextPlan);
      this.root.dataset.hnSourceVersion = String(version);
      this._applyCapabilities();
      if (this.ownsFocus()) this.restoreSelection(this.localSelection);
      this.onSnapshot?.(this.sessionSnapshot, metadata);
    }

    refresh() {
      const snapshot = this.session.currentSnapshot?.() || this.sessionSnapshot;
      if (snapshot) this._receiveSnapshot(snapshot, { reason: 'refresh' });
      return this.sessionSnapshot;
    }

    setMode(mode, options = {}) {
      const next = normalizeMode(mode);
      const nextPageEditMode = options.pageEditMode === undefined
        ? this.pageEditMode
        : Boolean(options.pageEditMode);
      if (next === this.mode && nextPageEditMode === this.pageEditMode) {
        return this.capabilities();
      }
      this._clearMultiClickAnchor();
      const hadFocus = this.ownsFocus();
      this._settleComposition();
      const preservedSelection = this.captureSelection() || this.localSelection;
      this.mode = next;
      this.pageEditMode = nextPageEditMode;
      if (this.presentationStrategy.modeSensitive && this.sourceSnapshot) {
        const inactivePlan = this._planForActiveOwners(new Set());
        this.activeOwnerIds = this._activeOwnersForSelection(preservedSelection, inactivePlan);
        this._renderPresentation(this._planForActiveOwners(this.activeOwnerIds));
      }
      const capabilities = this._applyCapabilities();
      if (hadFocus && options.restoreFocus !== false) {
        this.root.focus?.({ preventScroll: true });
        this.restoreSelection(preservedSelection);
      }
      return capabilities;
    }

    setPageEditMode(enabled) {
      const next = Boolean(enabled);
      if (next === this.pageEditMode) return this.capabilities();
      this._clearMultiClickAnchor();
      this._settleComposition();
      this.pageEditMode = next;
      return this._applyCapabilities();
    }

    ownsFocus() {
      const active = this.document?.activeElement;
      return Boolean(active && (active === this.root || this.root.contains?.(active)));
    }

    _resolvedProjectionSelection(value) {
      if (!this.sourceSnapshot) return null;
      if (!value?.anchor || !value?.focus) return null;
      const selection = this.foundation.normalizeVisibleSelection(
        this.sourceSnapshot,
        value,
        this.source().length
      );
      const anchor = projectionPositionAtOffset(
        this.projection,
        this.foundation,
        this.sourceSnapshot,
        selection.anchor,
        selection.anchorAffinity
      );
      const focus = projectionPositionAtOffset(
        this.projection,
        this.foundation,
        this.sourceSnapshot,
        selection.focus,
        selection.focusAffinity
      );
      if (!anchor || !focus) return null;
      return Object.freeze({
        anchor,
        focus,
        collapsed: anchor.offset === focus.offset
      });
    }

    _visibleProjectionPosition(position, affinity = position?.affinity) {
      if (!position || !this.sourceSnapshot) return null;
      const selection = this.foundation.normalizeVisibleSelection(
        this.sourceSnapshot,
        {
          anchor: { offset: position.offset, affinity },
          focus: { offset: position.offset, affinity }
        },
        this.source().length
      );
      return projectionPositionAtOffset(
        this.projection,
        this.foundation,
        this.sourceSnapshot,
        selection.focus,
        selection.focusAffinity
      );
    }

    _projectionSelection() {
      const selection = this._resolvedProjectionSelection(this.projection.getSelection?.());
      if (!selection) return null;
      return Object.freeze({
        anchor: selection.anchor.offset,
        focus: selection.focus.offset,
        anchorAffinity: selection.anchor.affinity,
        focusAffinity: selection.focus.affinity
      });
    }

    _projectionSelectionForDirectionalGesture(event) {
      if (this.selectionCaptureSuppressed && !this.restoreSelection(this.localSelection)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return null;
      }
      return this._resolvedProjectionSelection(this.projection.getSelection?.());
    }

    captureSelection() {
      if (this.composition || this.selectionCaptureSuppressed) return this.localSelection;
      const selection = this._projectionSelection();
      if (!selection) return null;
      this.localSelection = selection;
      this.paneState && (this.paneState.selection = selection);
      this.session.captureSelection?.(this.viewId, selection);
      this._syncActivePresentation(selection);
      return selection;
    }

    _restoreProjectionSelection(selection) {
      const restored = Boolean(selection?.anchor && selection?.focus)
        && this.projection.restoreSelection?.(selection) === true;
      this.selectionCaptureSuppressed = !restored;
      if (restored) {
        this.selectionRestoreFailure = null;
        return true;
      }
      this.selectionRestoreFailure = Object.freeze({
        sourceVersion: this.sourceVersion(),
        anchor: selection?.anchor?.offset ?? null,
        anchorAffinity: selection?.anchor?.affinity ?? null,
        focus: selection?.focus?.offset ?? null,
        focusAffinity: selection?.focus?.affinity ?? null
      });
      const error = new Error('HN source selection could not be restored to the current projection.');
      error.code = 'HN_SELECTION_RESTORE_FAILED';
      error.selection = this.selectionRestoreFailure;
      this.onError?.(error);
      return false;
    }

    restoreSelection(value) {
      if (!this.sourceSnapshot) return false;
      const selection = this.foundation.normalizeVisibleSelection(
        this.sourceSnapshot,
        value,
        this.source().length
      );
      const anchor = projectionPositionAtOffset(
        this.projection,
        this.foundation,
        this.sourceSnapshot,
        selection.anchor,
        selection.anchorAffinity
      );
      const focus = projectionPositionAtOffset(
        this.projection,
        this.foundation,
        this.sourceSnapshot,
        selection.focus,
        selection.focusAffinity
      );
      const restored = this._restoreProjectionSelection({ anchor, focus });
      if (restored) {
        const resolvedSelection = Object.freeze({
          anchor: anchor.offset,
          focus: focus.offset,
          anchorAffinity: anchor.affinity,
          focusAffinity: focus.affinity
        });
        this.localSelection = resolvedSelection;
        this.paneState && (this.paneState.selection = resolvedSelection);
      }
      return restored;
    }

    focus({ restore = true } = {}) {
      if (this.destroyed || !this.sourceSnapshot) return false;
      let selection = null;
      try {
        selection = this.session.setFocusedView?.(this.viewId, { restore: false }) || null;
        if (restore) selection = this.session.restoreSelection?.(this.viewId) || selection;
      } catch (error) {
        this.onError?.(error);
        return false;
      }
      if (this.paneState) this.paneState.focused = true;
      this.root.focus?.({ preventScroll: true });
      const restoredSelection = selection || this.localSelection;
      if (restore) this.restoreSelection(restoredSelection);
      this._syncActivePresentation(restoredSelection);
      return true;
    }

    blur() {
      this._clearMultiClickAnchor();
      const hadComposition = Boolean(this.composition);
      this._settleComposition();
      if (!hadComposition) this.captureSelection();
      if (this.paneState) this.paneState.focused = false;
      if (typeof this.session.clearFocusedView === 'function') {
        this.session.clearFocusedView(this.viewId);
      } else if (typeof this.session.blurView === 'function') {
        this.session.blurView(this.viewId);
      }
      if (this.presentationStrategy.modeSensitive && this.activeOwnerIds.size > 0) {
        this.activeOwnerIds = new Set();
        this._renderPresentation(this._planForActiveOwners(this.activeOwnerIds));
      }
      return true;
    }

    reassertSelection() {
      const selection = this.session.selectionForView?.(this.viewId) || this.localSelection;
      if (!selection || selection.anchor === selection.focus) return false;
      return this.focus({ restore: false }) && this.restoreSelection(selection);
    }

    commit() {
      if (this.destroyed) return false;
      const hadComposition = Boolean(this.composition);
      this._settleComposition();
      const selection = hadComposition
        ? this.localSelection
        : this.captureSelection() || this.localSelection;
      if (selection) this.session.captureSelection?.(this.viewId, selection);
      return true;
    }

    _applySourceRange(from, to, insert, options = {}) {
      const capabilities = this.capabilities();
      if (!capabilities.canEdit || !this.sourceSnapshot) return false;
      const source = this.source();
      const start = clamp(Math.min(from, to), 0, source.length);
      const end = clamp(Math.max(from, to), start, source.length);
      const replacement = typeof insert === 'string' ? insert : String(insert ?? '');
      const caret = start + replacement.length;
      const nextSource = source.slice(0, start) + replacement + source.slice(end);
      const afterSelection = this.foundation.normalizeVisibleSelection(
        nextSource,
        options.selection || { anchor: caret, focus: caret },
        caret
      );
      try {
        this.session.setFocusedView?.(this.viewId, { restore: false });
        this.transactionCount += 1;
        this.session.applySourceTransaction(
          this.viewId,
          Object.freeze({ from: start, to: end, insert: replacement }),
          Object.freeze({
            sourceVersion: this.sourceVersion(),
            selection: afterSelection,
            inputType: options.inputType || 'insertText',
            compositionId: options.compositionId || null
          })
        );
        this.localSelection = afterSelection;
        return true;
      } catch (error) {
        this.onError?.(error);
        this.refresh();
        return false;
      }
    }

    _replaceSelection(insert, options = {}) {
      const selection = this.captureSelection()
        || normalizeSelection(this.session.selectionForView?.(this.viewId), this.source().length);
      const range = selectedRange(selection);
      return this._applySourceRange(range.from, range.to, insert, options);
    }

    _delete(direction, inputType) {
      const selection = this.captureSelection()
        || normalizeSelection(this.session.selectionForView?.(this.viewId), this.source().length);
      const structuralResult = this.presentationStrategy.applyDeletion?.(
        this.sourceSnapshot,
        selection,
        direction,
        { inputType }
      );
      if (structuralResult) {
        return this._applyCanonicalCommandResult(structuralResult, inputType);
      }
      let { from, to } = selectedRange(selection);
      if (from === to) {
        ({ start: from, end: to } = this.foundation.exactDeletionRange(
          this.source(),
          from,
          direction === 'forward' ? 'forward' : 'backward'
        ));
      }
      if (from === to) return false;
      return this._applySourceRange(from, to, '', { inputType });
    }

    _applyCanonicalCommandResult(result, fallbackInputType) {
      if (!result) return false;
      if (result.changed !== true || result.source === this.source()) return true;
      const difference = sourceDifference(this.source(), result.source);
      if (!difference.changed) return true;
      this._applySourceRange(
        difference.start,
        difference.previousEnd,
        result.source.slice(difference.start, difference.nextEnd),
        {
          selection: result.selection,
          inputType: result.transaction?.inputType || fallbackInputType
        }
      );
      return true;
    }

    _applyPresentationNewline(inputType, { shiftKey = false } = {}) {
      if (!this.sourceSnapshot || !this.presentationStrategy.applyNewline) return false;
      const selection = this.captureSelection()
        || normalizeSelection(this.session.selectionForView?.(this.viewId), this.source().length);
      const result = this.presentationStrategy.applyNewline(
        this.sourceSnapshot,
        selection,
        { inputType, shiftKey }
      );
      return this._applyCanonicalCommandResult(result, inputType);
    }

    _applyPresentationIndentation(direction) {
      if (!this.sourceSnapshot || !this.presentationStrategy.applyIndentation) return false;
      const selection = this.captureSelection()
        || normalizeSelection(this.session.selectionForView?.(this.viewId), this.source().length);
      const result = this.presentationStrategy.applyIndentation(
        this.sourceSnapshot,
        selection,
        direction
      );
      return this._applyCanonicalCommandResult(
        result,
        direction === 'outdent' ? 'formatOutdent' : 'formatIndent'
      );
    }

    _copy(event, { cut = false } = {}) {
      if (!eventInside(this.root, event)) return false;
      const selection = this.captureSelection();
      if (!selection) return false;
      const range = selectedRange(selection);
      if (range.from === range.to) return false;
      const text = this.source().slice(range.from, range.to);
      if (!event.clipboardData?.setData) return false;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault?.();
      event.stopPropagation?.();
      if (cut && this.capabilities().canEdit) {
        this._applySourceRange(range.from, range.to, '', { inputType: 'deleteByCut' });
      }
      return true;
    }

    _paste(event) {
      if (!eventInside(this.root, event)) return false;
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!this.capabilities().canEdit) return true;
      const text = event.clipboardData?.getData?.('text/plain');
      if (typeof text !== 'string') return true;
      return this._replaceSelection(text, { inputType: 'insertFromPaste' });
    }

    _selectAll(event) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const length = this.source().length;
      const selection = normalizeSelection({ anchor: 0, focus: length }, length);
      this.restoreSelection(selection);
      this.captureSelection();
      return true;
    }

    _moveHorizontal(event, direction) {
      const current = this._projectionSelectionForDirectionalGesture(event);
      if (!current?.anchor || !current?.focus) return false;
      let anchor = current.anchor;
      let focus = current.focus;
      if (!event.shiftKey && !current.collapsed) {
        const selection = normalizeSelection({ anchor, focus }, this.source().length);
        const offset = direction === 'left'
          ? Math.min(selection.anchor, selection.focus)
          : Math.max(selection.anchor, selection.focus);
        focus = this.foundation.createEditablePosition(
          this.sourceSnapshot,
          offset,
          direction === 'left' ? 'after' : 'before'
        );
        anchor = focus;
      } else {
        focus = this.projection.moveHorizontal?.(focus, direction) || focus;
        focus = this._visibleProjectionPosition(
          focus,
          direction === 'left' ? 'before' : 'after'
        );
        if (!focus) return false;
        if (!event.shiftKey) anchor = focus;
      }
      event.preventDefault?.();
      this.preferredArrowX = null;
      if (this.restoreSelection({ anchor, focus })) this.captureSelection();
      return true;
    }

    _moveVertical(event, direction) {
      const current = this._projectionSelectionForDirectionalGesture(event);
      if (!current?.anchor || !current?.focus) return false;
      const preferredX = Number.isFinite(this.preferredArrowX)
        ? this.preferredArrowX
        : this.projection.preferredXFor?.(current.focus);
      const movedFocus = this.projection.moveVertical?.(current.focus, direction, preferredX);
      const focus = this._visibleProjectionPosition(movedFocus, movedFocus?.affinity);
      if (!focus) return false;
      event.preventDefault?.();
      this.preferredArrowX = preferredX;
      if (this.restoreSelection({
        anchor: event.shiftKey ? current.anchor : focus,
        focus
      })) this.captureSelection();
      return true;
    }

    _beforeInput(event) {
      if (!eventInside(this.root, event)) return;
      const inputType = String(event.inputType || '');
      if (!this.capabilities().canEdit) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      if (inputType === 'historyUndo' || inputType === 'historyRedo') {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (this.capabilities().canEdit) {
          if (inputType === 'historyUndo') this.session.undo?.(this.viewId);
          else this.session.redo?.(this.viewId);
        }
        return;
      }
      if ((inputType === 'insertCompositionText' || inputType === 'insertFromComposition')
        && (event.isComposing || this.composition)) {
        if (!this.composition) this._startComposition();
        const replacement = typeof event.data === 'string' ? event.data : '';
        this.composition.latestText = replacement;
        this.composition.cancelled = false;
        event.stopPropagation?.();
        if (event.isComposing && !this.composition.ending) return;
        event.preventDefault?.();
        this._settleComposition(event);
        return;
      }
      if (this.composition && inputType === 'insertText'
        && typeof event.data === 'string') {
        event.preventDefault?.();
        event.stopPropagation?.();
        this._settleComposition(event);
        return;
      }
      if ((inputType === 'insertParagraph' || inputType === 'insertLineBreak')
        && defaultTextEditingModel?.isImeCompositionOwnedKeyEvent?.(
          event,
          this.root,
          null,
          Boolean(this.composition)
        )) return;
      let handled = false;
      if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
        handled = this._applyPresentationNewline(inputType, {
          shiftKey: inputType === 'insertLineBreak'
        }) || this._replaceSelection('\n', { inputType });
      } else if (inputType === 'deleteContentBackward') {
        handled = this._delete('backward', inputType);
      } else if (inputType === 'deleteContentForward') {
        handled = this._delete('forward', inputType);
      } else if (inputType.startsWith('insert') && typeof event.data === 'string') {
        handled = this._replaceSelection(event.data, { inputType });
      }
      // Canonical source is the only mutation owner. Unknown browser mutations
      // are rejected rather than accepted into the projected DOM.
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!handled) this.refresh();
    }

    _startComposition() {
      this._clearMultiClickAnchor();
      if (this.composition?.invalidated) this._settleComposition();
      if (this.composition) return this.composition;
      const selection = this.captureSelection()
        || normalizeSelection(this.session.selectionForView?.(this.viewId), this.source().length);
      const range = selectedRange(selection);
      this.compositionCount += 1;
      this.composition = {
        id: `hn-composition-${Date.now()}-${++compositionSequence}`,
        from: range.from,
        to: range.to,
        baseSource: this.source(),
        latestText: null,
        cancelled: false,
        invalidated: false,
        ending: false,
        settleTimer: null
      };
      this.session.setFocusedView?.(this.viewId, { restore: false });
      return this.composition;
    }

    _scheduleCompositionSettlement(event = null) {
      if (!this.composition) return false;
      const composition = this.composition;
      if (typeof event?.data === 'string') {
        composition.latestText = event.data;
        composition.cancelled = event.data.length === 0;
      }
      composition.ending = true;
      if (composition.settleTimer !== null) return true;
      composition.settleTimer = root.setTimeout?.(() => {
        if (this.composition === composition) this._settleComposition();
      }, 0) ?? null;
      if (composition.settleTimer === null) this._settleComposition();
      return true;
    }

    _clearComposition() {
      const composition = this.composition;
      if (!composition) return null;
      if (composition.settleTimer !== null) {
        root.clearTimeout?.(composition.settleTimer);
        composition.settleTimer = null;
      }
      this.composition = null;
      return composition;
    }

    _settleComposition(event = null) {
      if (!this.composition) return false;
      const composition = this.composition;
      if (typeof event?.data === 'string') {
        composition.latestText = event.data;
        composition.cancelled = event.data.length === 0;
      }
      const finalText = composition.latestText;
      this._clearComposition();
      let applied = false;
      if (!composition.cancelled && !composition.invalidated
        && finalText !== null && this.capabilities().canEdit
        && this.source() === composition.baseSource) {
        applied = this._applySourceRange(composition.from, composition.to, finalText, {
          inputType: 'insertCompositionText',
          compositionId: composition.id
        });
      }
      if (!applied) this.refresh();
      if (this.ownsFocus()) this.captureSelection();
      return applied;
    }

    _keydown(event) {
      if (!eventInside(this.root, event)) return;
      if (defaultTextEditingModel?.isImeCompositionOwnedKeyEvent?.(
        event,
        this.root,
        null,
        Boolean(this.composition)
      )) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (this.composition?.invalidated) this._settleComposition();
      const key = String(event.key || '');
      const lower = key.toLowerCase();
      if (eventIsPrimaryModifier(event) && lower === 'a') {
        this._selectAll(event);
        return;
      }
      if (eventIsPrimaryModifier(event) && (lower === 'z' || lower === 'y')) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (this.capabilities().canEdit) {
          const redo = lower === 'y' || (lower === 'z' && event.shiftKey);
          if (redo) this.session.redo?.(this.viewId);
          else this.session.undo?.(this.viewId);
        }
        return;
      }
      if (!this.capabilities().canEdit) return;
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        this._moveHorizontal(event, key === 'ArrowLeft' ? 'left' : 'right');
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this._moveVertical(event, key === 'ArrowUp' ? 'up' : 'down');
        return;
      }
      if (key === 'Enter') {
        event.preventDefault?.();
        event.stopPropagation?.();
        const inputType = event.shiftKey ? 'insertLineBreak' : 'insertParagraph';
        if (!this._applyPresentationNewline(inputType, { shiftKey: event.shiftKey })) {
          this._replaceSelection('\n', { inputType });
        }
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault?.();
        event.stopPropagation?.();
        this._delete(key === 'Backspace' ? 'backward' : 'forward',
          key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward');
        return;
      }
      if (key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (!this._applyPresentationIndentation(event.shiftKey ? 'outdent' : 'indent')) {
          this._replaceSelection('\t', { inputType: 'insertText' });
        }
      }
    }

    _clearMultiClickAnchor() {
      const changed = Boolean(this.multiClickAnchor || this.pendingMousePointer);
      this.multiClickAnchor = null;
      this.pendingMousePointer = null;
      return changed;
    }

    _recordMultiClickAnchor(position) {
      if (!position) return null;
      const anchor = Object.freeze({
        viewId: this.viewId,
        sourceVersion: this.sourceVersion(),
        position: Object.freeze({ ...position })
      });
      this.multiClickAnchor = anchor;
      return anchor;
    }

    _currentMultiClickAnchorPosition() {
      const saved = this.multiClickAnchor;
      if (!saved || saved.viewId !== this.viewId
        || saved.sourceVersion !== this.sourceVersion()
        || saved.position?.sourceVersion !== this.sourceSnapshot?.version) return null;
      const dom = this.projection.sourceToDom?.(saved.position);
      const exact = dom && this.projection.domToSource?.(dom.node, dom.offset);
      return exact && this.projectionRuntime.samePosition?.(exact, saved.position)
        ? exact
        : null;
    }

    _beginPointerSelection(event, pointerId = event?.pointerId, { recordMultiClick = false } = {}) {
      if (this.composition?.invalidated) this._settleComposition();
      const rawPointed = this.projection.pointerToPosition?.(event);
      const pointed = this._visibleProjectionPosition(rawPointed, rawPointed?.affinity);
      if (!pointed) return false;
      event.preventDefault?.();
      event.stopPropagation?.();
      this.focus({ restore: false });
      const current = event.shiftKey
        ? this._projectionSelectionForDirectionalGesture(event)
        : null;
      if (event.shiftKey && !current?.anchor) return false;
      const anchor = event.shiftKey ? current.anchor : pointed;
      if (!this.restoreSelection({ anchor, focus: pointed })) return false;
      this.captureSelection();
      const installed = this._resolvedProjectionSelection(this.projection.getSelection?.());
      const gestureAnchor = installed?.anchor || anchor;
      const clickPosition = installed?.focus || pointed;
      if (recordMultiClick && !event.shiftKey) this._recordMultiClickAnchor(clickPosition);
      else this._clearMultiClickAnchor();
      this.pointerGesture = { anchor: gestureAnchor, pointerId };
      if (pointerId !== undefined) this.root.setPointerCapture?.(pointerId);
      return true;
    }

    _pointerDown(event) {
      if (!eventInside(this.root, event) || event.button === 2
        || event.button === 0 && event.ctrlKey) return;
      if (event.pointerType === 'mouse' && (event.button === undefined || event.button === 0)
        && event.isPrimary !== false) {
        if (this.composition?.invalidated) this._settleComposition();
        this.pendingMousePointer = Object.freeze({
          viewId: this.viewId,
          pointerId: event.pointerId
        });
        event.stopPropagation?.();
        return;
      }
      this._clearMultiClickAnchor();
      this._beginPointerSelection(event);
    }

    _applyAnchoredMultiClick(event, pointerId) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const anchor = this._currentMultiClickAnchorPosition();
      const previous = this.localSelection;
      if (!anchor || typeof this.projection.selectTextGranularity !== 'function') {
        this._clearMultiClickAnchor();
        return false;
      }
      this.focus({ restore: false });
      const granularity = Number(event.detail) === 2 ? 'word' : 'block';
      const selected = this.projection.selectTextGranularity(anchor, granularity, { apply: true });
      if (!selected?.anchor || !selected?.focus || selected.collapsed) {
        this.restoreSelection(previous);
        this._clearMultiClickAnchor();
        return false;
      }
      this.captureSelection();
      const installed = this._resolvedProjectionSelection(this.projection.getSelection?.()) || selected;
      this.pointerGesture = {
        anchor,
        pointerId,
        multiClickAnchorPosition: anchor,
        granularity,
        granularitySelection: installed
      };
      if (pointerId !== undefined) this.root.setPointerCapture?.(pointerId);
      return true;
    }

    _mouseDown(event) {
      if (!eventInside(this.root, event) || event.button === 2
        || event.button === 0 && event.ctrlKey) return;
      const pending = this.pendingMousePointer;
      this.pendingMousePointer = null;
      const detail = Math.max(1, Math.trunc(Number(event.detail) || 1));
      if (detail === 1 || event.shiftKey) {
        // A fresh browser click count starts a fresh canonical anchor. If
        // exact placement fails, a later detail-2 event must fail closed
        // instead of reviving an older sequence.
        this._clearMultiClickAnchor();
        this._beginPointerSelection(event, pending?.pointerId, {
          recordMultiClick: !event.shiftKey
        });
        return;
      }
      this._applyAnchoredMultiClick(event, pending?.pointerId);
    }

    _pointerMove(event) {
      if (!this.pointerGesture || (this.pointerGesture.pointerId !== undefined
        && event.pointerId !== this.pointerGesture.pointerId)) return;
      const rawPointed = this.projection.pointerToPosition?.(event);
      const pointed = this._visibleProjectionPosition(rawPointed, rawPointed?.affinity);
      if (!pointed) return;
      event.preventDefault?.();
      let requested = { anchor: this.pointerGesture.anchor, focus: pointed };
      if (this.pointerGesture.granularity
        && typeof this.projection.selectTextGranularity === 'function') {
        const moving = this.projection.selectTextGranularity(
          pointed,
          this.pointerGesture.granularity,
          { apply: false }
        );
        const initialRange = orderedProjectionSelection(this.pointerGesture.granularitySelection);
        const movingRange = orderedProjectionSelection(moving);
        if (!initialRange || !movingRange || !this.pointerGesture.multiClickAnchorPosition) return;
        requested = projectionPositionPrecedes(
          pointed,
          this.pointerGesture.multiClickAnchorPosition
        )
          ? { anchor: initialRange.end, focus: movingRange.start }
          : { anchor: initialRange.start, focus: movingRange.end };
      }
      if (this.restoreSelection(requested)) this.captureSelection();
    }

    _pointerUp(event) {
      if (!this.pointerGesture) {
        if (this.pendingMousePointer?.pointerId === undefined
          || event.pointerId === this.pendingMousePointer.pointerId) {
          this.pendingMousePointer = null;
        }
        return;
      }
      if (this.pointerGesture.pointerId !== undefined
        && event.pointerId !== this.pointerGesture.pointerId) return;
      if (event.pointerId !== undefined) this.root.releasePointerCapture?.(event.pointerId);
      this.pointerGesture = null;
      this.pendingMousePointer = null;
      this.captureSelection();
    }

    _listen(target, type, listener, options) {
      target?.addEventListener?.(type, listener, options);
      this._listeners.push(() => target?.removeEventListener?.(type, listener, options));
    }

    _installEvents() {
      this._listen(this.root, 'focusin', () => this.focus({ restore: true }));
      this._listen(this.root, 'focusout', (event) => {
        if (event?.relatedTarget && this.root.contains?.(event.relatedTarget)) return;
        this.blur();
      });
      this._listen(this.root, 'compositionstart', () => this._startComposition());
      this._listen(this.root, 'compositionupdate', (event) => {
        if (this.composition && typeof event?.data === 'string') {
          this.composition.latestText = event.data;
          this.composition.cancelled = false;
        }
      });
      this._listen(this.root, 'compositionend', (event) => {
        this._scheduleCompositionSettlement(event);
      });
      this._listen(this.root, 'beforeinput', (event) => this._beforeInput(event));
      this._listen(this.root, 'input', () => {
        if (!this.composition) this.refresh();
      });
      this._listen(this.root, 'keydown', (event) => this._keydown(event));
      this._listen(this.root, 'copy', (event) => this._copy(event));
      this._listen(this.root, 'cut', (event) => this._copy(event, { cut: true }));
      this._listen(this.root, 'paste', (event) => this._paste(event));
      this._listen(this.root, 'pointerdown', (event) => this._pointerDown(event), true);
      this._listen(this.root, 'mousedown', (event) => this._mouseDown(event), true);
      this._listen(this.document, 'pointermove', (event) => this._pointerMove(event), true);
      this._listen(this.document, 'pointerup', (event) => this._pointerUp(event), true);
      this._listen(this.document, 'pointercancel', (event) => this._pointerUp(event), true);
      this._listen(this.document, 'selectionchange', () => {
        if (!this.composition && this.ownsFocus()) this.captureSelection();
      });
    }

    diagnostics() {
      return Object.freeze({
        viewId: this.viewId,
        mode: this.mode,
        presentationStrategy: this.presentationStrategy.id || 'custom',
        projectionMode: this.presentationStrategy.projectionMode,
        activeOwnerIds: Object.freeze([...this.activeOwnerIds]),
        capabilities: this.capabilities(),
        sourceVersion: this.sourceVersion(),
        sourceLength: this.source().length,
        selection: this.localSelection,
        compositionActive: Boolean(this.composition),
        compositionCount: this.compositionCount,
        transactionCount: this.transactionCount,
        updateCount: this.updateCount,
        selectionCaptureSuppressed: this.selectionCaptureSuppressed,
        selectionRestoreFailure: this.selectionRestoreFailure,
        migrationFailure: this._diagnostic,
        projection: this.sourceSnapshot ? this.projection.snapshot?.() || null : null,
        destroyed: this.destroyed
      });
    }

    destroy() {
      if (this.destroyed) return false;
      this._clearMultiClickAnchor();
      const hadComposition = Boolean(this.composition);
      this._settleComposition();
      if (!hadComposition) this.captureSelection();
      if (this.ownsFocus()) this.blur();
      this.destroyed = true;
      this.pointerGesture = null;
      this.presentationStrategy.destroyPresentation?.({
        root: this.root,
        document: this.document,
        projection: this.projection,
        sourceSnapshot: this.sourceSnapshot,
        presentationPlan: this.presentationPlan,
        mode: this.mode
      });
      this._listeners.splice(0).forEach((remove) => remove());
      this.unsubscribe?.();
      this.unsubscribe = null;
      return true;
    }
  }

  function createSourceCanonicalEditor(options) {
    return new SourceCanonicalEditorController(options);
  }

  return Object.freeze({
    MODES,
    PROJECTION_MODE,
    HN_SYNTAX_PROJECTION_MODE,
    normalizeMode,
    modeCapabilities,
    createIdentitySourceSnapshot,
    createIdentityPresentationPlan,
    createIdentityPresentationStrategy,
    createHnBasicPresentationStrategy,
    approvedHnUnorderedRow,
    normalizeSelection,
    selectedRange,
    SourceCanonicalEditorController,
    createSourceCanonicalEditor
  });
}));
