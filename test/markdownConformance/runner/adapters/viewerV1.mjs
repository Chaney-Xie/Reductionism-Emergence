import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  LaunchedCdpProcess,
  cdpDelay,
  dispatchTrustedAction
} from './cdpTransport.mjs';
import {
  IsolationSafetyError,
  assertIsolatedChild,
  createIsolatedRuntimeRoot,
  readExactFileObservation,
  removeIsolatedRuntimeRoot,
  sha256File,
  validateIsolatedRuntimeRoot
} from './isolation.mjs';
import {
  buildRuntimeObservation,
  compactActionTraceObservation,
  nonAutomatableObservation,
  scenarioActionSequence,
  scenarioSelection,
  utf8FileBytes
} from './observationModel.mjs';
import { SEMANTIC_DOM_FUNCTION_SOURCE } from './semanticDomRuntime.mjs';
import {
  AST_LIST_ITEMS_FUNCTION_SOURCE,
  CANONICAL_LIST_ITEMS_FUNCTION_SOURCE,
  LIST_LIFECYCLE_DOM_FUNCTION_SOURCE,
  LIST_LIFECYCLE_INTEGRITY_FUNCTION_SOURCE,
  SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE
} from './listObservationRuntime.mjs';
import { AutomationUnavailableError } from './obsidianO1.mjs';

const require = createRequire(import.meta.url);

export const VIEWER_V1_DEFAULTS = Object.freeze({
  executablePath: path.resolve(
    process.cwd(),
    'out/Reductionism & Emergence-darwin-arm64/Reductionism & Emergence.app/Contents/MacOS/Reductionism & Emergence'
  ),
  freshnessFiles: Object.freeze([
    'package.json',
    'forge.config.js',
    'desktop/main.js',
    'desktop/nativeContextMenu.js',
    'server/appServer.js',
    'server/hnTextPage.js',
    'server/importService.js',
    'server/vaultContext.js',
    'public/index.html',
    'public/structuredTextCount.js',
    'public/hnText.js',
    'public/hnListNumbering.js',
    'public/hnStructureIndex.js',
    'public/hnListIndex.js',
    'public/hnListCommands.js',
    'public/pageTypes.js',
    'public/app.js',
    'public/markdownEditableFoundation.js',
    'public/markdownPage.js',
    'public/styles.css',
    'public/js/appBootstrap.js',
    'public/js/canvasBlocks.js',
    'public/js/hnPageDocumentSession.js',
    'public/js/hnTextPageView.js',
    'public/js/structuredTextPageShell.js',
    'public/js/vaultSettings.js',
    'public/js/workspaceState.js',
    'public/js/markdownEditableProjection.js',
    'public/js/markdownEditableSyntaxAdapters.js',
    'public/js/markdownPageView.js'
  ])
});

function normalizedMode(value) {
  const mode = String(value || 'source').toLowerCase();
  if (['live', 'live-preview', 'livepreview'].includes(mode)) return 'live-preview';
  if (['reading', 'preview', 'read'].includes(mode)) return 'reading';
  if (['source', 'source-mode'].includes(mode)) return 'source';
  throw new AutomationUnavailableError(`Unsupported Viewer editing mode: ${value}`);
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function packagedAsarPath(executablePath) {
  return path.resolve(path.dirname(executablePath), '..', 'Resources', 'app.asar');
}

export async function verifyPackagedViewerFreshness({
  executablePath = VIEWER_V1_DEFAULTS.executablePath,
  sourceRoot = process.cwd(),
  files = VIEWER_V1_DEFAULTS.freshnessFiles
} = {}) {
  const asarPath = packagedAsarPath(executablePath);
  await stat(executablePath);
  await stat(asarPath);
  let asar;
  try {
    asar = require('@electron/asar');
  } catch (error) {
    throw new AutomationUnavailableError(`Packaged Viewer freshness requires @electron/asar: ${error.message}`);
  }
  const mismatches = [];
  const checked = [];
  for (const relativePath of files) {
    const sourcePath = path.resolve(sourceRoot, relativePath);
    const sourceBytes = await readFile(sourcePath);
    let packagedBytes;
    try {
      packagedBytes = asar.extractFile(asarPath, relativePath);
    } catch (error) {
      mismatches.push({ relativePath, reason: `missing from package: ${error.message}` });
      continue;
    }
    const sourceSha256 = sha256Bytes(sourceBytes);
    const packagedSha256 = sha256Bytes(packagedBytes);
    checked.push({ relativePath, sourceSha256, packagedSha256 });
    if (sourceSha256 !== packagedSha256) {
      mismatches.push({ relativePath, sourceSha256, packagedSha256 });
    }
  }
  if (mismatches.length) {
    throw new AutomationUnavailableError(
      'Packaged Viewer is stale relative to the current source tree; rebuild before claiming V1 evidence.',
      { executablePath, asarPath, mismatches }
    );
  }
  let packageMetadata = null;
  try {
    packageMetadata = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  } catch {}
  return {
    executablePath,
    asarPath,
    asarSha256: await sha256File(asarPath),
    checked,
    packageMetadata
  };
}

/* Serialized into the packaged Viewer renderer. */
export function viewerSourceMarkerKind(marker) {
  if (marker?.closest?.('.markdown-page-list-prefix')) return 'list';
  if ([
    'markdown-list-editing-prefix',
    'markdown-list-editing-token',
    'markdown-exited-list-marker',
    'markdown-list-recognition-only-token'
  ].some((className) => marker?.classList?.contains?.(className))) return 'list';
  if (marker?.closest?.('.markdown-page-rule-source')) return 'thematic-break';
  if (marker?.closest?.('.markdown-page-quote-source-line,.markdown-page-quote')) return 'quote';
  return 'syntax';
}

const VIEWER_SOURCE_MARKER_KIND_FUNCTION_SOURCE = viewerSourceMarkerKind.toString();

/* Serialized into the packaged Viewer renderer. */
export function viewerListPresentationFromRuntime(input = {}) {
  const source = typeof input.source === 'string' ? input.source : '';
  const sourceItems = Array.isArray(input.sourceItems) ? input.sourceItems : [];
  const astItems = Array.isArray(input.astItems) ? input.astItems : [];
  const semanticItems = Array.isArray(input.semanticItems) ? input.semanticItems : [];
  const markers = Array.isArray(input.markers) ? input.markers : [];
  const selection = input.selection && typeof input.selection === 'object'
    ? input.selection
    : null;
  const editorActive = input.editorActive === true;
  const finiteInteger = (value) => Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
  const markerStart = (item) => finiteInteger(
    item?.markerStart ?? item?.markerRange?.start
  );
  const markerEnd = (item) => finiteInteger(
    item?.markerEnd ?? item?.markerRange?.end
  );
  const observedMarkerToken = (marker) => {
    if (marker?.kind !== 'list') return null;
    const match = /^([+-]?\d+[.)]|[-+*])(?:[\t \u00a0]+\[[ xX]\])?[\t \u00a0]*$/.exec(
      String(marker?.text ?? '')
    );
    return match?.[1] ?? null;
  };
  const observedMarkerMatches = (marker, rawMarker) => (
    typeof rawMarker === 'string' && rawMarker.length > 0
    && observedMarkerToken(marker) === rawMarker
  );
  const astOwnerFor = (sourceItem) => {
    const start = markerStart(sourceItem);
    const end = markerEnd(sourceItem);
    if (start == null || end == null) return null;
    const exact = astItems.find((item) => markerStart(item) === start) || null;
    if (exact) return exact;
    return astItems.filter((item) => {
      const itemStart = finiteInteger(item?.sourceStart);
      const itemEnd = finiteInteger(item?.sourceEnd);
      return itemStart != null && itemEnd != null
        && itemStart <= start && itemEnd >= end;
    }).sort((left, right) => (
      (Number(right?.listDepth) || 0) - (Number(left?.listDepth) || 0)
      || (finiteInteger(right?.sourceStart) ?? -1)
        - (finiteInteger(left?.sourceStart) ?? -1)
      || (finiteInteger(left?.sourceEnd) ?? Number.MAX_SAFE_INTEGER)
        - (finiteInteger(right?.sourceEnd) ?? Number.MAX_SAFE_INTEGER)
    ))[0] || null;
  };
  const markerForToken = (start, end, rawMarker) => {
    if (start == null || end == null || rawMarker == null) return null;
    return markers.filter((marker) => (
      observedMarkerMatches(marker, rawMarker)
      &&
      finiteInteger(marker?.sourceStart) != null
      && finiteInteger(marker?.sourceEnd) != null
      && marker.sourceStart <= start
      && marker.sourceEnd >= end
      && source.slice(start, end) === rawMarker
    )).sort((left, right) => (
      (right.sourceStart === start) - (left.sourceStart === start)
      || (left.sourceEnd - left.sourceStart) - (right.sourceEnd - right.sourceStart)
      || right.sourceStart - left.sourceStart
    ))[0] || null;
  };
  const physicalSourceMarkerFor = (sourceItem) => markerForToken(
    markerStart(sourceItem),
    markerEnd(sourceItem),
    sourceItem?.rawMarker ?? null
  );
  const exactSourceMarkerFor = (sourceItem, astItem) => {
    const physicalMarker = physicalSourceMarkerFor(sourceItem);
    if (physicalMarker) return physicalMarker;
    // A containing AST item may absorb a later physical marker. Reuse its
    // marker only when both inventories identify the same logical item;
    // otherwise one visible AST token would be projected onto two rows.
    if (typeof sourceItem?.path === 'string'
      && typeof astItem?.path === 'string'
      && sourceItem.path !== astItem.path) return null;
    return markerForToken(
      markerStart(astItem),
      markerEnd(astItem),
      astItem?.rawMarker ?? null
    );
  };
  const activeSourceOffset = editorActive && selection
    ? Math.min(Number(selection.anchor) || 0, Number(selection.focus) || 0)
    : null;
  const sourceLineAt = (requestedOffset) => {
    if (requestedOffset == null) return null;
    const offset = Math.max(0, Math.min(source.length, Number(requestedOffset) || 0));
    const endings = /\r\n|\n|\r/g;
    let start = 0;
    let index = 0;
    let match;
    while ((match = endings.exec(source))) {
      if (offset <= match.index) {
        return { index, start, end: match.index, text: source.slice(start, match.index) };
      }
      start = match.index + match[0].length;
      index += 1;
    }
    return { index, start, end: source.length, text: source.slice(start) };
  };
  const sourceItemByPath = new Map(sourceItems.map((item) => [item?.path, item]));
  const exitedItemPaths = sourceItems.filter((item) => (
    physicalSourceMarkerFor(item)?.exitedListMarker === true
  )).map((item) => item.path);
  const activeLine = sourceLineAt(activeSourceOffset);
  const activePlainLine = activeLine
    && activeLine.text.trim().length > 0
    && !sourceItems.some((item) => item?.line?.index === activeLine.index)
    ? activeLine
    : null;
  const interruptedItemPaths = activePlainLine ? sourceItems.filter((item) => {
    const parent = sourceItemByPath.get(item?.parentPath);
    return parent
      && Number(parent?.line?.index) < activePlainLine.index
      && Number(item?.line?.index) > activePlainLine.index;
  }).map((item) => item.path) : [];
  const suppressedItemPaths = [...exitedItemPaths, ...interruptedItemPaths];
  const representationSuppressedFor = (item) => suppressedItemPaths.some((path) => (
    typeof path === 'string'
    && (item?.path === path || item?.path?.startsWith(path + '.'))
  ));
  const items = sourceItems.map((sourceItem) => {
    const astItem = astOwnerFor(sourceItem);
    const astSourceStart = finiteInteger(astItem?.sourceStart);
    const semanticItem = astSourceStart == null
      ? null
      : semanticItems.find((item) => finiteInteger(item?.sourceStart) === astSourceStart)
        || null;
    const sourceMarker = exactSourceMarkerFor(sourceItem, astItem);
    const representationSuppressed = representationSuppressedFor(sourceItem);
    const sourceMarkerVisible = !representationSuppressed
      && sourceMarker?.visible === true
      && sourceMarker?.listRecognitionOnly !== true;
    const nativeMarkerVisible = !representationSuppressed
      && semanticItem?.nativeMarker?.rendered === true;
    const observedDisplayedMarker = observedMarkerToken(sourceMarker);
    const observedDisplayedOrdinal = (() => {
      const ordered = /^([+-]?\d+)[.)]$/.exec(observedDisplayedMarker || '');
      return ordered ? Number(ordered[1]) : null;
    })();
    // O1 can recognize an exact visible physical list prefix even when a
    // blank separator keeps that token outside the parser-owned semantic
    // list. This is presentation recognition only; lifecycle ownership still
    // requires the independent AST/LI integrity chain.
    const recognized = !representationSuppressed
      && Boolean((astItem && semanticItem) || sourceMarkerVisible);
    const active = activeSourceOffset != null
      && activeSourceOffset >= sourceItem.line.start
      && activeSourceOffset <= sourceItem.line.end;
    const displayedOrdinal = sourceItem.kind === 'ordered'
      ? sourceMarkerVisible
        ? observedDisplayedOrdinal
        : nativeMarkerVisible
          ? sourceMarker ? observedDisplayedOrdinal : semanticItem?.ordinal ?? null
          : null
      : null;
    const displayedMarker = sourceMarkerVisible
      ? observedDisplayedMarker
      : nativeMarkerVisible
        ? sourceMarker
          ? observedDisplayedMarker
          : sourceItem.kind === 'ordered'
            ? Number.isFinite(Number(semanticItem?.ordinal))
              ? String(semanticItem.ordinal) + '.'
              : null
            : 'unordered-bullet'
        : null;
    const markerVisible = sourceMarkerVisible || nativeMarkerVisible;
    // markerOwner is canonical ownership. markerPaintOwner retains the actual
    // DOM paint mechanism when a hidden source token is represented by the
    // semantic LI's native marker in inactive Live Preview.
    const markerOwner = markerVisible && sourceMarker
      ? 'source-marker'
      : nativeMarkerVisible ? 'native-list' : 'none';
    const markerPaintOwner = sourceMarkerVisible
      ? 'source-marker'
      : nativeMarkerVisible ? 'native-list' : 'none';
    return {
      itemPath: sourceItem.path,
      parentPath: sourceItem.parentPath,
      semanticItemPath: astItem?.path ?? semanticItem?.path ?? null,
      semanticParentPath: astItem?.parentPath ?? semanticItem?.parentPath ?? null,
      semanticSourceStart: astSourceStart,
      sourceOrder: sourceItem.sourceOrder,
      lineIndex: sourceItem.line.index,
      markerStart: markerStart(sourceItem),
      markerEnd: markerEnd(sourceItem),
      rawMarker: sourceItem.rawMarker,
      rawOrdinal: sourceItem.ordinal,
      kind: sourceItem.kind,
      listDepth: recognized
        ? Number(semanticItem?.listDepth) || Number(sourceItem?.physicalDepth) || 0
        : 0,
      quoteDepth: sourceItem.quoteDepth,
      recognized,
      checked: semanticItem?.checked ?? null,
      displayedMarker,
      displayedOrdinal,
      markerVisible,
      markerOwner,
      markerPaintOwner,
      active
    };
  });
  return {
    items,
    focus: {
      editorActive,
      activeItemPaths: items.filter((item) => item.active).map((item) => item.itemPath),
      activeLineIndexes: items.filter((item) => item.active).map((item) => item.lineIndex)
    }
  };
}

const VIEWER_LIST_PRESENTATION_FUNCTION_SOURCE = viewerListPresentationFromRuntime.toString();

/* Serialized into the packaged Viewer renderer. */
export function viewerLifecycleSourceMarkersFromRuntime(input = {}) {
  const source = typeof input.source === 'string' ? input.source : '';
  const astItems = Array.isArray(input.astItems) ? input.astItems : [];
  const sourceItems = Array.isArray(input.sourceItems) ? input.sourceItems : [];
  const markers = Array.isArray(input.markers) ? input.markers : [];
  const observedMarkerToken = (marker) => {
    if (marker?.kind !== 'list') return null;
    const match = /^([+-]?\d+[.)]|[-+*])(?:[\t \u00a0]+\[[ xX]\])?[\t \u00a0]*$/.exec(
      String(marker?.text ?? '')
    );
    return match?.[1] ?? null;
  };
  const observedMarkerMatches = (marker, rawMarker) => (
    typeof rawMarker === 'string' && rawMarker.length > 0
    && observedMarkerToken(marker) === rawMarker
  );
  return markers.flatMap((marker) => {
    if (marker?.kind !== 'list') return [];
    const visibleOwnerlessCandidate = marker.visible === true
      && String(marker.text ?? '').trim().length > 0;
    const validSourceRange = Number.isSafeInteger(marker?.sourceStart)
      && Number.isSafeInteger(marker?.sourceEnd);
    if (!validSourceRange && !visibleOwnerlessCandidate) return [];
    const astOwners = validSourceRange ? astItems.filter((item) => (
      Number.isSafeInteger(item?.markerStart)
      && Number.isSafeInteger(item?.markerEnd)
      && marker.sourceStart <= item.markerStart
      && marker.sourceEnd >= item.markerEnd
      && source.slice(item.markerStart, item.markerEnd) === item.rawMarker
      && observedMarkerMatches(marker, item.rawMarker)
    )) : [];
    const presentationOwners = validSourceRange ? sourceItems.filter((item) => (
      Number.isSafeInteger(item?.markerRange?.start)
      && Number.isSafeInteger(item?.markerRange?.end)
      && marker.sourceStart <= item.markerRange.start
      && marker.sourceEnd >= item.markerRange.end
      && source.slice(item.markerRange.start, item.markerRange.end)
        === item.rawMarker
      && observedMarkerMatches(marker, item.rawMarker)
    )) : [];
    const declaredListMarker = marker.editingListPrefix === true
      || marker.editingListToken === true
      || marker.exitedListMarker === true;
    // Exact canonical token ownership is authoritative even when an inactive
    // marker lacks an editing-state CSS class. Retain decorated ownerless
    // markers so the integrity evaluator can still report them as orphans.
    if (!astOwners.length && !presentationOwners.length
      && !declaredListMarker
      && !visibleOwnerlessCandidate) return [];
    const owners = astOwners.length
      ? astOwners.map((astItem) => ({ astItem, sourceItem: null }))
      : presentationOwners.length
        ? presentationOwners.map((sourceItem) => ({ astItem: null, sourceItem }))
        : [{ astItem: null, sourceItem: null }];
    return owners.map(({ astItem, sourceItem }, ownerIndex) => ({
      markerId: marker.markerId + '-owner-' + ownerIndex,
      kind: 'source-marker',
      astSourceStart: astItem?.sourceStart ?? null,
      presentationOnly: Boolean(sourceItem && !astItem),
      presentationSourceStart: sourceItem?.markerRange?.start ?? null,
      presentationItemPath: sourceItem?.path ?? null,
      presentationParentPath: sourceItem?.parentPath ?? null,
      presentationListDepth: sourceItem?.physicalDepth ?? null,
      ownerSourceStart: marker.ownerSourceStart,
      ownerSourceEnd: marker.ownerSourceEnd,
      sourceStart: marker.sourceStart,
      sourceEnd: marker.sourceEnd,
      tokenStart: astItem?.markerStart ?? sourceItem?.markerRange?.start ?? null,
      tokenEnd: astItem?.markerEnd ?? sourceItem?.markerRange?.end ?? null,
      displayedMarker: observedMarkerToken(marker)
        ?? (String(marker.text ?? '').trim() || null),
      displayedOrdinal: (() => {
        const ordered = /^([+-]?\d+)[.)]$/.exec(observedMarkerToken(marker) || '');
        return ordered ? Number(ordered[1]) : null;
      })(),
      effective: marker.visible === true
        && marker.listRecognitionOnly !== true
        && !sourceItem
        && astItem?.checked == null,
      presentationEffective: marker.visible === true
        && marker.listRecognitionOnly !== true
        && Boolean(sourceItem && !astItem),
      rect: marker.rect,
      geometrySource: 'source-marker-element'
    }));
  });
}

const VIEWER_LIFECYCLE_SOURCE_MARKERS_FUNCTION_SOURCE =
  viewerLifecycleSourceMarkersFromRuntime.toString();

/* Serialized into the packaged Viewer renderer. */
export function installViewerSelectionHelpers(target = globalThis) {
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const selectionElement = (node) => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const editableProjectionApi = (root) => {
    if (!root || root.dataset?.markdownEditableProjection !== 'true') return null;
    const api = target.markdownPageView || globalThis.markdownPageView;
    return api?.editableProjectionSnapshot
      && api?.editablePositionAtDomPoint
      && api?.editableSelection
      && api?.editableDomPoint
      && api?.restoreEditableSelection
      && api?.enumerateEditablePositions
      ? api
      : null;
  };
  const editableProjectionSnapshot = (root) => {
    const api = editableProjectionApi(root);
    if (!api) return null;
    const snapshot = api.editableProjectionSnapshot(root);
    return snapshot && typeof snapshot.markdownBody === 'string' ? snapshot : null;
  };
  const editablePositionAtOffset = (root, requestedOffset, sourceLength, preferEndBoundary = false) => {
    const api = editableProjectionApi(root);
    if (!api) return null;
    const offset = clamp(finite(requestedOffset), 0, sourceLength);
    const positions = api.enumerateEditablePositions(root)
      .filter((position) => position?.offset === offset);
    if (!positions.length) return null;
    if (preferEndBoundary) {
      return positions.find((position) => position.affinity === 'before') || positions.at(-1);
    }
    return positions.find((position) => position.affinity === 'after') || positions[0];
  };
  const sourceFromNode = (node) => {
    if (!node) return '';
    const projected = editableProjectionSnapshot(node);
    if (projected) return projected.markdownBody;
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      return [...node.childNodes].map(sourceFromNode).join('');
    }
    if (!(node instanceof Element)) return '';
    if (node.dataset?.markdownSemanticOnly === 'true') return '';
    if (Object.hasOwn(node.dataset || {}, 'markdownSourceValue')) {
      const value = String(node.dataset.markdownSourceValue || '');
      return value.slice(0, Math.min(value.length, String(node.textContent || '').length));
    }
    if (node.matches('br')) {
      const mapped = node.dataset?.markdownSourceBreak === 'true'
        || (Object.hasOwn(node.dataset || {}, 'markdownSourceStart')
          && Object.hasOwn(node.dataset || {}, 'markdownSourceEnd'));
      return mapped ? '\n' : '';
    }
    if (node.matches('input,hr')) return '';
    return [...node.childNodes].map(sourceFromNode).join('');
  };
  const offsetAtPoint = (root, node, offset) => {
    if (!root || !node || !(root === node || root.contains(node))) return null;
    const projectionApi = editableProjectionApi(root);
    if (projectionApi) {
      const position = projectionApi.editablePositionAtDomPoint(root, node, offset);
      return Number.isInteger(position?.offset) ? position.offset : null;
    }
    const element = selectionElement(node);
    const semanticOnly = element?.closest?.('[data-markdown-semantic-only="true"]');
    if (semanticOnly && (root === semanticOnly || root.contains(semanticOnly))) {
      const mapped = element.closest?.('[data-markdown-source-start][data-markdown-source-end]');
      const owner = mapped && semanticOnly.contains(mapped)
        ? mapped
        : semanticOnly.closest?.('[data-markdown-source-start][data-markdown-source-end]');
      if (owner) {
        const start = finite(owner.dataset.markdownSourceStart, 0);
        const end = finite(owner.dataset.markdownSourceEnd, start);
        if (node.nodeType === Node.TEXT_NODE) {
          const length = Math.max(0, String(node.nodeValue || '').length);
          return length
            ? clamp(Math.round(start + ((end - start) * clamp(finite(offset), 0, length) / length)), start, end)
            : start;
        }
        return offset <= 0 ? start : offset >= (node.childNodes?.length || 0) ? end : start;
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const owner = node.parentElement?.closest?.('[data-markdown-source-start][data-markdown-source-end]');
      if (owner && (root === owner || root.contains(owner))
        && !owner.closest('[data-markdown-semantic-only="true"]')) {
        const start = finite(owner.dataset.markdownSourceStart, 0);
        const end = finite(owner.dataset.markdownSourceEnd, start);
        const text = String(node.nodeValue || '');
        if (owner.childNodes.length === 1 && owner.firstChild === node && text.length === end - start) {
          return start + clamp(finite(offset), 0, text.length);
        }
      }
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(node, Math.max(0, offset));
      return sourceFromNode(range.cloneContents()).length;
    } catch {
      return null;
    }
  };
  const selectionOffsets = (root) => {
    const projectionApi = editableProjectionApi(root);
    if (projectionApi) {
      const selection = projectionApi.editableSelection(root);
      return Number.isInteger(selection?.anchor?.offset) && Number.isInteger(selection?.focus?.offset)
        ? { anchor: selection.anchor.offset, focus: selection.focus.offset }
        : null;
    }
    const selection = getSelection();
    if (!selection?.rangeCount) return null;
    const anchor = offsetAtPoint(root, selection.anchorNode, selection.anchorOffset);
    const focus = offsetAtPoint(root, selection.focusNode, selection.focusOffset);
    return Number.isFinite(anchor) && Number.isFinite(focus) ? { anchor, focus } : null;
  };
  const textPoint = (element, requestedOffset) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, requestedOffset);
    let node = walker.nextNode();
    let last = null;
    while (node) {
      if (!node.parentElement?.closest?.('[data-markdown-semantic-only="true"]')) {
        last = node;
        const length = String(node.nodeValue || '').length;
        if (remaining <= length) return { node, offset: remaining };
        remaining -= length;
      }
      node = walker.nextNode();
    }
    return last
      ? { node: last, offset: String(last.nodeValue || '').length }
      : { node: element, offset: element.childNodes.length };
  };
  const pointAtOffset = (root, requestedOffset, sourceLength, preferEndBoundary = false) => {
    const offset = clamp(finite(requestedOffset), 0, sourceLength);
    const projectionApi = editableProjectionApi(root);
    if (projectionApi) {
      const position = editablePositionAtOffset(
        root, offset, sourceLength, preferEndBoundary
      );
      const point = position ? projectionApi.editableDomPoint(root, position) : null;
      if (point?.node) {
        return {
          node: point.node,
          offset: point.offset,
          owner: selectionElement(point.node),
          position
        };
      }
      return null;
    }
    const entries = [...root.querySelectorAll('[data-markdown-source-start][data-markdown-source-end]')]
      .filter((element) => !element.closest('[data-markdown-semantic-only="true"]'))
      .map((element) => ({
        element,
        start: finite(element.dataset.markdownSourceStart, 0),
        end: finite(element.dataset.markdownSourceEnd, 0),
        depth: (() => {
          let value = 0;
          let current = element;
          while (current && current !== root) { value += 1; current = current.parentElement; }
          return value;
        })()
      }))
      .filter((entry) => entry.start <= offset && offset <= entry.end)
      .sort((left, right) => {
        if (preferEndBoundary) {
          const rightEnd = Number(right.end === offset && right.start < offset
            && !right.element.matches('br'));
          const leftEnd = Number(left.end === offset && left.start < offset
            && !left.element.matches('br'));
          if (rightEnd !== leftEnd) return rightEnd - leftEnd;
        }
        const starts = Number(right.start === offset) - Number(left.start === offset);
        return starts || right.depth - left.depth || (left.end - left.start) - (right.end - right.start);
      });
    for (const entry of entries) {
      const { element, start, end } = entry;
      if (element.matches('br')) {
        const index = [...element.parentNode.childNodes].indexOf(element);
        return { node: element.parentNode, offset: index + (offset > start ? 1 : 0), owner: element };
      }
      const onlyText = element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE
        ? element.firstChild
        : null;
      if (onlyText && String(onlyText.nodeValue || '').length === end - start) {
        return { node: onlyText, offset: clamp(offset - start, 0, end - start), owner: element };
      }
      if (Object.hasOwn(element.dataset || {}, 'markdownSourceValue')) {
        if (onlyText) return { node: onlyText, offset: clamp(offset - start, 0, onlyText.length), owner: element };
        const index = [...element.parentNode.childNodes].indexOf(element);
        return { node: element.parentNode, offset: index + (offset > start ? 1 : 0), owner: element };
      }
      const point = textPoint(element, offset - start);
      if (point) return { ...point, owner: element };
    }
    return textPoint(root, offset);
  };
  const setSelection = (root, anchor, focus, sourceLength) => {
    const projectionApi = editableProjectionApi(root);
    if (projectionApi) {
      const anchorPosition = editablePositionAtOffset(root, anchor, sourceLength);
      const focusPosition = editablePositionAtOffset(root, focus, sourceLength);
      if (!anchorPosition || !focusPosition) return null;
      const restored = projectionApi.restoreEditableSelection(root, {
        anchor: anchorPosition,
        focus: focusPosition
      });
      return restored ? selectionOffsets(root) : null;
    }
    const anchorPoint = pointAtOffset(root, anchor, sourceLength);
    const focusPoint = pointAtOffset(root, focus, sourceLength);
    if (!anchorPoint || !focusPoint) return null;
    const selection = getSelection();
    selection.removeAllRanges();
    if (selection.setBaseAndExtent) {
      selection.setBaseAndExtent(
        anchorPoint.node, anchorPoint.offset, focusPoint.node, focusPoint.offset
      );
    } else {
      const range = document.createRange();
      range.setStart(anchorPoint.node, anchorPoint.offset);
      range.setEnd(focusPoint.node, focusPoint.offset);
      selection.addRange(range);
    }
    return selectionOffsets(root);
  };
  const coordinates = (root, requestedOffset, sourceLength) => {
    let point = pointAtOffset(root, requestedOffset, sourceLength);
    let owner = point?.owner || selectionElement(point?.node);
    if (!owner) return null;
    const caretBoxFor = (candidate) => {
      try {
        const range = document.createRange();
        range.setStart(candidate.node, candidate.offset);
        range.collapse(true);
        return Array.from(range.getClientRects?.() || []).find((box) => (
          Number.isFinite(Number(box?.left))
          && Number.isFinite(Number(box?.top))
          && Number(box?.height) > 0
        )) || range.getBoundingClientRect?.() || null;
      } catch {
        return null;
      }
    };
    const usableCaretBox = (box) => box
      && Number.isFinite(Number(box.left))
      && Number.isFinite(Number(box.top))
      && Number(box.height) > 0;
    let caretBox = caretBoxFor(point);
    // A mapped structural gap beginning at this offset remains the logical
    // selection priority, but inactive BR and hidden indentation/newline spans
    // have no clickable caret box. For trusted clicks only, retry the deepest
    // mapped text owner ending here before falling back to the editor corner.
    if (!usableCaretBox(caretBox)) {
      const endPoint = pointAtOffset(root, requestedOffset, sourceLength, true);
      const endOwner = endPoint?.owner || selectionElement(endPoint?.node);
      if (endPoint && endOwner && endOwner !== owner) {
        point = endPoint;
        owner = endOwner;
        caretBox = caretBoxFor(point);
      }
    }
    if (usableCaretBox(caretBox)) {
      const atTextEnd = point.node?.nodeType === Node.TEXT_NODE
        && point.offset >= String(point.node.nodeValue || '').length;
      return {
        x: Number(caretBox.left) + (atTextEnd ? -0.5 : 0.5),
        y: Number(caretBox.top) + (Number(caretBox.height) / 2),
        offset: requestedOffset
      };
    }
    const box = owner.getBoundingClientRect();
    const start = finite(owner.dataset?.markdownSourceStart, requestedOffset);
    const end = finite(owner.dataset?.markdownSourceEnd, start);
    const ratio = end > start ? clamp((requestedOffset - start) / (end - start), 0, 1) : 0.5;
    const fallback = root.getBoundingClientRect();
    return {
      x: box.width > 0 ? box.left + Math.max(1, box.width * ratio) : fallback.left + 2,
      y: box.height > 0 ? (box.top + box.bottom) / 2 : fallback.top + 2,
      offset: requestedOffset
    };
  };
  target.__cneMarkdownConformance = Object.freeze({
    sourceFromNode,
    offsetAtPoint,
    selectionOffsets,
    pointAtOffset,
    setSelection,
    coordinates
  });
  return true;
}

const VIEWER_SELECTION_HELPERS_SOURCE = installViewerSelectionHelpers.toString();

function viewerSetupExpression({
  source,
  mode,
  selection,
  active,
  existingPageId,
  reuseExistingPage = false
}) {
  return `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    (${VIEWER_SELECTION_HELPERS_SOURCE})(globalThis);
    if (typeof closeVaultNameModal === 'function') closeVaultNameModal({ restoreFocus: false });
    if (typeof closeVaultSettings === 'function') closeVaultSettings();
    document.activeElement?.blur?.();
    await pause(80);
    await globalThis.flushMarkdownBodySavesNow?.();
    const desiredSource = ${JSON.stringify(source)};
    const desiredMode = ${JSON.stringify(mode)};
    const desiredSelection = ${JSON.stringify(selection)};
    const desiredActive = ${JSON.stringify(active)};
    const preferences = await request('/api/vault-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultPageType: 'markdown', lastMarkdownMode: desiredMode })
    });
    applyVaultMarkdownPreferences(preferences);
    const reuseExistingPage = ${JSON.stringify(Boolean(reuseExistingPage))};
    let pageId = reuseExistingPage
      ? (${JSON.stringify(existingPageId)} || globalThis.__cneConformancePageId || null)
      : null;
    let entry = pageId ? pageIndex?.pages?.find((candidate) => candidate.id === pageId) : null;
    if (pageId && typeof discardPagePersistenceState === 'function') {
      discardPagePersistenceState(pageId);
    }
    let saved;
    if (!entry) {
      const created = await request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      project = created.project;
      pageIndex = created.pageIndex;
      navigation = created.navigation;
      pageId = created.page.id;
      entry = created.pageEntry;
      renderPageList();
    }
    saved = await request(pageApiUrl(pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdownBody: desiredSource })
    });
    globalThis.__cneConformancePageId = pageId;
    const runtime = activePaneRuntime();
    if (!runtime) throw new Error('Packaged Viewer has no active Pane runtime.');
    globalThis.forgetMarkdownEditHistory?.(activeTab(runtime));
    if (!runtime.currentPage || runtime.currentPage.id !== pageId) {
      await completePageOpen(runtime, entry, saved, {
        historyMode: activeTab(runtime)?.currentPageId ? 'preserve' : 'replace'
      });
    } else {
      runtime.currentPageEntry = entry;
      runtime.currentPage = commitCanonicalPage(saved, { originRuntime: runtime });
      renderPage(runtime, runtime.currentPage, { installCanonical: false });
      restoreActiveTabViewState(runtime);
    }
    setVaultMarkdownMode(desiredMode);
    await globalThis.flushMarkdownPreferenceSavesNow?.();
    await pause(180);
    const body = document.querySelector(
      '.workspace-pane.is-workspace-pane-active .markdown-page-body'
    ) || document.querySelector('.markdown-page-body');
    if (!body) throw new Error('Packaged Viewer did not render a Markdown body.');
    const vaultNameOverlay = document.querySelector('#vault-name-overlay');
    const vaultSettingsOverlay = document.querySelector('#vault-settings-overlay');
    if (vaultNameOverlay && !vaultNameOverlay.hidden) throw new Error('Vault name modal remained open.');
    if (vaultSettingsOverlay && !vaultSettingsOverlay.hidden) throw new Error('Vault settings remained open.');
    let actualSelection = null;
    if (desiredMode !== 'reading') {
      body.focus({ preventScroll: true });
      actualSelection = globalThis.__cneMarkdownConformance.setSelection(
        body, desiredSelection.anchor, desiredSelection.focus, desiredSource.length
      );
      await pause(40);
      if (desiredMode === 'live-preview' && !desiredActive) {
        globalThis.__cneConformanceLogicalSelection = actualSelection || desiredSelection;
        getSelection()?.removeAllRanges?.();
        if (body === document.activeElement || body.contains(document.activeElement)) {
          document.activeElement?.blur?.();
        }
        await pause(30);
      } else {
        globalThis.__cneConformanceLogicalSelection = null;
      }
    }
    const canonical = canonicalPages.get(pageId);
    return {
      pageId,
      pagePath: entry.path,
      source: canonical?.markdownBody,
      mode: markdownPageModel.normalizeMarkdownMode(vaultPreferences.lastMarkdownMode),
      selection: actualSelection,
      active: desiredMode !== 'reading'
        && (body === document.activeElement || body.contains(document.activeElement)),
      requestedActive: desiredActive
    };
  })()`;
}

export function viewerCaptureExpression({ timingPreserving = false } = {}) {
  return `(async () => {
    const timingPreserving = ${JSON.stringify(Boolean(timingPreserving))};
    (${VIEWER_SELECTION_HELPERS_SOURCE})(globalThis);
    const flush = timingPreserving ? null : await globalThis.flushMarkdownBodySavesNow?.();
    const runtime = activePaneRuntime();
    const currentPage = runtime?.currentPage || null;
    const pageId = globalThis.__cneConformancePageId || currentPage?.id || null;
    const canonicalPage = pageId ? canonicalPages.get(pageId) : null;
    const apiPage = timingPreserving || !pageId ? null : await request(pageApiUrl(pageId));
    const body = document.querySelector(
      '.workspace-pane.is-workspace-pane-active .markdown-page-body'
    ) || document.querySelector('.markdown-page-body');
    const layer = body?.closest('.markdown-page-layer');
    const mode = layer?.classList.contains('is-source')
      ? 'source'
      : layer?.classList.contains('is-reading')
        ? 'reading'
        : 'live-preview';
    const selection = body ? globalThis.__cneMarkdownConformance.selectionOffsets(body) : null;
    const storedSelection = globalThis.__cneConformanceLogicalSelection || null;
    const effectiveSelection = selection || storedSelection;
    const domSource = body ? globalThis.__cneMarkdownConformance.sourceFromNode(body) : null;
    const capturedSource = timingPreserving
      ? (domSource ?? currentPage?.markdownBody ?? canonicalPage?.markdownBody ?? '')
      : (apiPage?.markdownBody ?? canonicalPage?.markdownBody ?? domSource ?? '');
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0 && box.width > 0 && box.height > 0;
    };
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        x: value.x, y: value.y, left: value.left, top: value.top,
        right: value.right, bottom: value.bottom, width: value.width, height: value.height
      };
    };
    const sourceOffsetAttribute = (element, name) => {
      const raw = element?.getAttribute?.(name);
      if (raw == null || !/^[+-]?\\d+$/.test(String(raw).trim())) return null;
      const value = Number(raw);
      return Number.isSafeInteger(value) ? value : null;
    };
    const markers = body ? [...body.querySelectorAll('.markdown-source-marker')]
      .map((marker, markerIndex) => {
        const ownerItem = marker.closest('li');
        return {
          markerId: 'source-marker-' + markerIndex,
          text: marker.textContent || '',
          visible: visible(marker),
          rect: rect(marker),
          sourceStart: sourceOffsetAttribute(marker, 'data-markdown-source-start'),
          sourceEnd: sourceOffsetAttribute(marker, 'data-markdown-source-end'),
          ownerSourceStart: sourceOffsetAttribute(ownerItem, 'data-markdown-source-start'),
          ownerSourceEnd: sourceOffsetAttribute(ownerItem, 'data-markdown-source-end'),
          editingListPrefix: marker.classList.contains('markdown-list-editing-prefix'),
          editingListToken: marker.classList.contains('markdown-list-editing-token'),
          exitedListMarker: marker.classList.contains('markdown-exited-list-marker'),
          listRecognitionOnly: marker.classList.contains('markdown-list-recognition-only-token'),
          listDepth: Number.isFinite(Number(marker.dataset.markdownListDepth))
            ? Number(marker.dataset.markdownListDepth) : null,
          kind: (${VIEWER_SOURCE_MARKER_KIND_FUNCTION_SOURCE})(marker)
        };
      }) : [];
    const semantic = (${SEMANTIC_DOM_FUNCTION_SOURCE})(body || document.createElement('div'));
    const sourceListItems = (${CANONICAL_LIST_ITEMS_FUNCTION_SOURCE})(capturedSource);
    const semanticListItems = (${SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE})(
      body || document.createElement('div')
    );
    let listAstParseError = null;
    let astListItems = [];
    try {
      if (!globalThis.markdownPageModel?.parseMarkdownDocument) {
        throw new Error('markdownPageModel.parseMarkdownDocument is unavailable');
      }
      const listAst = globalThis.markdownPageModel.parseMarkdownDocument(capturedSource);
      astListItems = (${AST_LIST_ITEMS_FUNCTION_SOURCE})(listAst, capturedSource);
    } catch (error) {
      listAstParseError = String(error?.message || error || 'unknown parser error');
    }
    const listDomLifecycle = (${LIST_LIFECYCLE_DOM_FUNCTION_SOURCE})(
      body || document.createElement('div')
    );
    const blocks = body ? [...body.querySelectorAll(
      '.markdown-page-semantic-block,[data-markdown-source-start][data-markdown-source-end]'
    )].filter((element, index, values) => {
      const owner = element.closest('.markdown-page-semantic-block') || element;
      return values.findIndex((candidate) => (candidate.closest('.markdown-page-semantic-block') || candidate) === owner) === index;
    }) : [];
    const geometryLines = blocks.map((element, index) => ({
      index,
      text: element.innerText || element.textContent || '',
      sourceStart: Number.isFinite(Number(element.dataset.markdownSourceStart))
        ? Number(element.dataset.markdownSourceStart) : null,
      sourceEnd: Number.isFinite(Number(element.dataset.markdownSourceEnd))
        ? Number(element.dataset.markdownSourceEnd) : null,
      rect: rect(element)
    }));
    const quoteElements = body ? [...body.querySelectorAll('.markdown-page-quote')] : [];
    const visibleQuoteRails = quoteElements.filter((quote) => {
      const colour = getComputedStyle(quote).borderLeftColor;
      return visible(quote) && colour !== 'transparent' && !/rgba?\([^)]*,\s*0\s*\)$/.test(colour);
    });
    const visibleQuoteMarker = markers.find((marker) => marker.kind === 'quote' && marker.visible);
    const quoteDepth = Math.max(0, ...quoteElements.map((quote) => {
      let depth = 1;
      let parent = quote.parentElement?.closest('.markdown-page-quote');
      while (parent) { depth += 1; parent = parent.parentElement?.closest('.markdown-page-quote'); }
      return depth;
    }));
    const rule = body?.querySelector('.markdown-page-rule-source') || null;
    const ruleMarker = rule?.querySelector('.markdown-source-marker') || null;
    const table = body?.querySelector('.markdown-page-table') || null;
    const tableControls = body ? [...body.querySelectorAll('.markdown-table-add-control')]
      .map((control) => control.getAttribute('aria-label') || control.textContent || '') : [];
    const orderedListItems = body ? [...body.querySelectorAll('ol > li')].map((item) => {
      const list = item.parentElement;
      const siblings = list
        ? [...list.children].filter((candidate) => candidate.tagName === 'LI')
        : [];
      const siblingIndex = Math.max(0, siblings.indexOf(item));
      const startNumber = Number(list?.getAttribute('start') || 1);
      const explicitValue = item.hasAttribute('value')
        ? Number(item.getAttribute('value')) : null;
      const ordinal = Number.isFinite(explicitValue)
        ? explicitValue : startNumber + siblingIndex;
      let listDepth = 0;
      let owner = list;
      while (owner) {
        listDepth += 1;
        owner = owner.parentElement?.closest?.('ol,ul');
      }
      const itemStyle = getComputedStyle(item);
      const markerStyle = getComputedStyle(item, '::marker');
      const listStyleType = itemStyle.listStyleType || getComputedStyle(list).listStyleType;
      const markerRendered = visible(item)
        && itemStyle.display === 'list-item'
        && listStyleType !== 'none'
        && markerStyle.display !== 'none'
        && markerStyle.visibility !== 'hidden';
      return {
        listDepth,
        startNumber,
        ordinal,
        listStyleType,
        markerContent: markerStyle.content,
        markerRendered
      };
    }) : [];
    const visibleOrderedListSourceMarkerOrdinals = markers
      .filter((marker) => marker.kind === 'list' && marker.visible)
      .map((marker) => Number(/^\\s*(\\d+)\\./.exec(marker.text || '')?.[1]))
      .filter(Number.isFinite);
    const expectedOrderedListOrdinals = orderedListItems
      .map(({ ordinal }) => ordinal)
      .sort((left, right) => left - right);
    const visibleOrderedListOrdinals = orderedListItems
      .filter(({ markerRendered }) => markerRendered)
      .map(({ ordinal }) => ordinal)
      .concat(visibleOrderedListSourceMarkerOrdinals)
      .sort((left, right) => left - right);
    const orderedListRendered = expectedOrderedListOrdinals.length > 0
      && expectedOrderedListOrdinals.length === visibleOrderedListOrdinals.length
      && expectedOrderedListOrdinals.every(
        (ordinal, index) => ordinal === visibleOrderedListOrdinals[index]
      );
    const editorActive = mode !== 'reading' && Boolean(body
      && (body === document.activeElement || body.contains(document.activeElement)));
    const listProjection = (${VIEWER_LIST_PRESENTATION_FUNCTION_SOURCE})({
      source: capturedSource,
      sourceItems: sourceListItems,
      astItems: astListItems,
      semanticItems: semanticListItems,
      markers,
      mode,
      selection: effectiveSelection,
      editorActive
    });
    const listItems = listProjection.items;
    const listFocus = listProjection.focus;
    const lifecycleSourceMarkers = (${VIEWER_LIFECYCLE_SOURCE_MARKERS_FUNCTION_SOURCE})({
      source: capturedSource,
      astItems: astListItems,
      sourceItems: sourceListItems,
      markers
    });
    const lifecycleNativeMarkers = listDomLifecycle.items
      .filter((item) => item?.nativeMarker?.rendered === true)
      .map((item) => ({
        markerId: 'native-marker-' + item.domOrder,
        kind: 'native-list',
        astSourceStart: item.sourceStart,
        ownerSourceStart: item.sourceStart,
        ownerSourceEnd: item.sourceEnd,
        displayedMarker: item.ordered
          ? Number.isFinite(Number(item.ordinal)) ? String(item.ordinal) + '.' : null
          : 'unordered-bullet',
        displayedOrdinal: item.ordered ? item.ordinal : null,
        effective: true,
        rect: item.rect,
        geometrySource: 'semantic-list-item-box'
      }));
    const lifecycleTaskMarkers = listDomLifecycle.items
      .filter((item) => item?.taskMarker?.visible === true)
      .map((item) => ({
        markerId: 'task-marker-' + item.domOrder,
        kind: 'task-checkbox',
        astSourceStart: item.sourceStart,
        ownerSourceStart: item.sourceStart,
        ownerSourceEnd: item.sourceEnd,
        displayedMarker: item.checked === true ? '[x]' : '[ ]',
        displayedOrdinal: null,
        effective: true,
        rect: item.taskMarker.rect,
        geometrySource: 'task-checkbox-element'
      }));
    const lifecycleMarkers = [
      ...lifecycleSourceMarkers,
      ...lifecycleNativeMarkers,
      ...lifecycleTaskMarkers
    ];
    const lifecycleIntegrity = (${LIST_LIFECYCLE_INTEGRITY_FUNCTION_SOURCE})({
      astAvailable: listAstParseError == null,
      astItems: astListItems,
      sourceItems: sourceListItems,
      semanticItems: listDomLifecycle.items,
      markers: lifecycleMarkers
    });
    const listPresentation = {
      sourceItems: sourceListItems,
      semanticItems: semanticListItems,
      astItems: astListItems,
      domLifecycle: listDomLifecycle,
      lifecycleMarkers,
      lifecycleIntegrity,
      astParseError: listAstParseError,
      items: listItems,
      focus: listFocus
    };
    const mathSource = body?.querySelector('.markdown-math-source-text') || null;
    const mathRendered = body?.querySelector('.katex,.markdown-math-rendered') || null;
    let vaultInfo = null;
    if (!timingPreserving) {
      try { vaultInfo = await globalThis.cneDesktop?.getVaultInfo?.(); } catch {}
    }
    return {
      pageId,
      source: capturedSource,
      selection: effectiveSelection,
      selectionOrigin: selection ? 'browser' : storedSelection ? 'inactive-logical' : null,
      mode,
      active: editorActive,
      visibleText: body?.innerText || '',
      semantic,
      markers,
      renderedState: mode === 'source' ? 'raw' : mode === 'reading' ? 'rendered' : 'mixed',
      geometry: {
        viewport: rect(document.documentElement),
        editor: rect(body),
        lines: geometryLines
      },
      presentationFacts: {
        quote: {
          depth: quoteDepth,
          visibleRailCount: visibleQuoteRails.length,
          visibleMarker: visibleQuoteMarker?.text || null,
          railRects: visibleQuoteRails.map(rect)
        },
        thematicBreak: {
          elementPresent: Boolean(rule),
          elementVisible: visible(rule),
          markerVisible: visible(ruleMarker),
          markerText: ruleMarker?.textContent || null,
          elementTag: rule?.tagName?.toLowerCase?.() || null
        },
        table: {
          present: Boolean(table),
          visible: visible(table),
          controls: tableControls,
          rect: rect(table)
        },
        orderedList: {
          entries: orderedListItems.map(({ listDepth, ordinal }) => ({ listDepth, ordinal })),
          rendered: orderedListRendered,
          visibleSourceMarkerOrdinals: visibleOrderedListSourceMarkerOrdinals,
          itemFacts: orderedListItems
        },
        list: listPresentation,
        focus: listFocus,
        math: {
          sourceVisible: visible(mathSource),
          renderedVisible: visible(mathRendered),
          sourceRect: rect(mathSource),
          renderedRect: rect(mathRendered)
        }
      },
      canonicalCurrentPage: currentPage ? JSON.parse(JSON.stringify(currentPage)) : null,
      canonicalMapPage: canonicalPage ? JSON.parse(JSON.stringify(canonicalPage)) : null,
      apiPage,
      domSource,
      flush,
      settings: JSON.parse(JSON.stringify(vaultPreferences || {})),
      versions: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        electron: typeof process !== 'undefined' ? process.versions?.electron : null,
        chrome: typeof process !== 'undefined' ? process.versions?.chrome : null
      },
      vaultInfo,
      targetUrl: location.href
    };
  })()`;
}

function decorateViewerPresentation(runtime, scenario) {
  const family = scenario?.syntaxFamily;
  const facts = runtime.presentationFacts || {};
  if (family === 'thematic-break') {
    const rule = facts.thematicBreak || {};
    runtime.renderedState = rule.markerVisible ? 'raw' : 'hidden';
    runtime.markerVisibility = rule.markerVisible ? 'visible' : 'hidden';
    runtime.elementType = rule.elementTag;
    runtime.visibleText = rule.markerVisible ? String(rule.markerText || '') : '';
  } else if (family === 'tables') {
    runtime.renderedState = runtime.mode === 'source'
      ? 'raw'
      : runtime.mode === 'reading'
        ? 'static'
        : facts.table?.controls?.length ? 'interactive' : 'static';
    runtime.controls = facts.table?.controls || [];
    runtime.elementType = facts.table?.present ? 'table' : null;
    runtime.presentationGeometry = { table: facts.table?.rect || null };
  } else if (family === 'inline-latex' || family === 'display-latex') {
    const math = facts.math || {};
    runtime.renderedState = math.sourceVisible && math.renderedVisible
      ? 'source-above-rendered'
      : math.sourceVisible ? 'raw' : math.renderedVisible ? 'rendered' : 'hidden';
    runtime.layout = math.sourceVisible && math.renderedVisible ? 'column' : null;
    runtime.elementType = math.renderedVisible ? 'math' : null;
    runtime.presentationGeometry = {
      formula: { source: math.sourceRect || null, rendered: math.renderedRect || null }
    };
  } else if (family === 'quotes') {
    const quote = facts.quote || {};
    runtime.quoteRailText = quote.visibleMarker
      ? `|${String(quote.visibleMarker).replace(/\s/g, '')}`
      : '|'.repeat(Math.max(0, quote.visibleRailCount || quote.depth || 0));
    runtime.visibleMarkers = runtime.markers
      .filter((marker) => marker.visible)
      .map((marker) => marker.text)
      .join('');
    runtime.markerVisibility = runtime.visibleMarkers ? 'visible' : 'hidden';
    runtime.presentationGeometry = { rails: quote.railRects || [] };
  }
  return runtime;
}

export function viewerListLifecycleFailures(runtime, scenario = null) {
  if (scenario) {
    const family = String(scenario.syntaxFamily || '');
    const listFocused = [
      'ordered-lists', 'unordered-lists', 'mixed-lists', 'task-lists'
    ].includes(family) || (Array.isArray(scenario.tags)
      && scenario.tags.some((tag) => String(tag).includes('list')));
    if (!listFocused) return [];
  }
  const integrity = runtime?.presentationFacts?.list?.lifecycleIntegrity;
  if (!integrity || integrity.valid !== false) return [];
  const violations = Array.isArray(integrity.violations) ? integrity.violations : [];
  if (!violations.length) return ['list-lifecycle:unspecified'];
  return [...new Set(violations.map((violation) => {
    const code = String(violation?.code || 'unspecified');
    const sourceStartValue = [
      violation?.sourceStart,
      violation?.astSourceStart,
      violation?.presentationSourceStart,
      violation?.expectedParentSourceStart
    ].find((value) => value != null && Number.isSafeInteger(Number(value)));
    const sourceStart = sourceStartValue == null ? null : Number(sourceStartValue);
    return `list-lifecycle:${code}${sourceStart == null ? '' : `@${sourceStart}`}`;
  }))];
}

export class ViewerV1Adapter {
  constructor(options = {}) {
    this.options = {
      executablePath: VIEWER_V1_DEFAULTS.executablePath,
      sourceRoot: process.cwd(),
      requireFreshPackage: true,
      keepArtifacts: false,
      traceActions: false,
      launchTimeoutMs: 35_000,
      settleMs: 120,
      reusePageAcrossScenarios: false,
      ...options
    };
    this.isolation = null;
    this.process = null;
    this.packageMetadata = null;
    this.pageId = null;
    this.pagePath = null;
    this.persistedPagePath = null;
    this.currentScenario = null;
    this.closed = false;
  }

  static async launch(options = {}) {
    const adapter = new ViewerV1Adapter(options);
    try {
      await adapter.launch();
      return adapter;
    } catch (error) {
      await adapter.close().catch(() => {});
      throw error;
    }
  }

  get client() {
    if (!this.process?.client) throw new AutomationUnavailableError('Viewer CDP client is not available.');
    return this.process.client;
  }

  async launch() {
    if (this.process) return this;
    if (this.options.requireFreshPackage) {
      this.packageMetadata = await verifyPackagedViewerFreshness({
        executablePath: this.options.executablePath,
        sourceRoot: this.options.sourceRoot,
        files: this.options.freshnessFiles || VIEWER_V1_DEFAULTS.freshnessFiles
      });
    }
    this.isolation = await createIsolatedRuntimeRoot('viewer-v1', {
      label: this.options.label || ''
    });
    await validateIsolatedRuntimeRoot(this.isolation);
    this.process = await LaunchedCdpProcess.launch({
      executablePath: this.options.executablePath,
      timeoutMs: this.options.launchTimeoutMs,
      args: ({ port }) => [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
        '--headless',
        '--disable-gpu',
        `--user-data-dir=${this.isolation.profile}`
      ],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        VIEWER_LEGACY_ROOT: this.isolation.vault
      },
      targetPredicate: (target) => target.type === 'page'
        && /^http:\/\/127\.0\.0\.1:\d+\/?/.test(target.url)
    });
    await this.client.waitForValue(
      `document.readyState === 'complete'
        && typeof request === 'function'
        && typeof markdownPageModel === 'object'
        && Boolean(globalThis.cneDesktop?.isDesktop)`,
      { timeoutMs: 20_000, description: 'packaged Viewer application runtime' }
    );
    const registryPath = path.join(this.isolation.profile, 'vault-registry.json');
    await assertIsolatedChild(this.isolation.root, registryPath, { mustExist: true });
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    const current = registry.vaults?.find((vault) => vault.vaultId === registry.currentVaultId);
    if (!current?.vaultRoot) {
      throw new IsolationSafetyError('Packaged Viewer did not create an isolated current Vault.', { registry });
    }
    await assertIsolatedChild(this.isolation.root, current.vaultRoot, { mustExist: true });
    this.viewerVaultRoot = path.resolve(current.vaultRoot);
    return this;
  }

  async setup(scenario) {
    const source = typeof scenario?.initialSource === 'string' ? scenario.initialSource : '';
    const mode = normalizedMode(scenario?.mode || 'source');
    const selection = scenarioSelection(scenario, source);
    const requestedActive = scenario?.state?.active !== false;
    const result = await this.client.evaluate(viewerSetupExpression({
      source,
      mode,
      selection,
      active: requestedActive,
      existingPageId: this.pageId,
      reuseExistingPage: this.options.reusePageAcrossScenarios === true
    }), { timeoutMs: 25_000 });
    if (result.source !== source || result.mode !== mode) {
      throw new AutomationUnavailableError('Packaged Viewer setup did not reach the requested source/mode.', {
        requested: { source, mode, selection, active: requestedActive },
        actual: result
      });
    }
    if (mode !== 'reading' && (
      result.selection?.anchor !== selection.anchor
      || result.selection?.focus !== selection.focus
    )) {
      throw new AutomationUnavailableError('Packaged Viewer could not establish the exact source selection.', {
        requested: selection,
        actual: result.selection
      });
    }
    if (mode === 'live-preview' && result.active !== requestedActive) {
      throw new AutomationUnavailableError('Packaged Viewer could not establish the active/inactive Live Preview state.', {
        requestedActive,
        actualActive: result.active
      });
    }
    this.pageId = result.pageId;
    this.pagePath = result.pagePath;
    this.persistedPagePath = path.resolve(this.viewerVaultRoot, result.pagePath);
    await assertIsolatedChild(this.isolation.root, this.persistedPagePath, { mustExist: true });
    this.currentScenario = scenario;
    return result;
  }

  sourceCoordinates(offset) {
    return this.client.evaluate(`(() => {
      (${VIEWER_SELECTION_HELPERS_SOURCE})(globalThis);
      const body = document.querySelector('.workspace-pane.is-workspace-pane-active .markdown-page-body')
        || document.querySelector('.markdown-page-body');
      const sourceLength = canonicalPages.get(globalThis.__cneConformancePageId)?.markdownBody?.length || 0;
      return body ? globalThis.__cneMarkdownConformance.coordinates(
        body, ${Number(offset)}, sourceLength
      ) : null;
    })()`);
  }

  async reopen() {
    const result = await this.client.evaluate(`(async () => {
      await globalThis.flushMarkdownBodySavesNow?.();
      const pageId = globalThis.__cneConformancePageId;
      createEmptyTab();
      await openPageFromSidebar(pageId);
      await new Promise((resolve) => setTimeout(resolve, 220));
      const currentPage = activePaneRuntime()?.currentPage || null;
      return { pageId: currentPage?.id || null, source: currentPage?.markdownBody || '' };
    })()`);
    if (result.pageId !== this.pageId) {
      throw new AutomationUnavailableError('Packaged Viewer failed to reopen its isolated Markdown Page.', result);
    }
  }

  async switchMode() {
    return this.client.evaluate(`(async () => {
      const before = markdownPageModel.normalizeMarkdownMode(vaultPreferences.lastMarkdownMode);
      const expected = before === 'live-preview' ? 'source' : before === 'source' ? 'reading' : 'live-preview';
      cycleVaultMarkdownMode();
      await globalThis.flushMarkdownPreferenceSavesNow?.();
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        before,
        expected,
        after: markdownPageModel.normalizeMarkdownMode(vaultPreferences.lastMarkdownMode)
      };
    })()`);
  }

  async dispatch(rawAction) {
    const action = typeof rawAction === 'string' ? rawAction : { ...rawAction };
    const type = typeof action === 'string'
      ? action.toLowerCase()
      : String(action.type || action.kind || action.op || '').toLowerCase();
    const command = typeof action === 'object' ? String(action.command || '').toLowerCase() : '';
    if (type === 'inspect' || (type === 'selection' && command === 'select-target')) return;
    if (type === 'blur' || command === 'blur' || action.target === 'outside-editor') {
      await this.client.evaluate(`(() => {
        document.activeElement?.blur?.();
        document.querySelector('.workspace-pane-header')?.focus?.({ preventScroll: true });
        return !document.activeElement?.classList?.contains('markdown-page-body');
      })()`);
    } else if (type === 'reopen' || command === 'reopen-note' || String(action).toLowerCase() === 'reopen') {
      await this.reopen();
    } else if (type === 'mode' || type === 'switch-mode'
      || (type === 'application' && command === 'switch-mode')) {
      const switched = await this.switchMode();
      if (switched.after !== switched.expected) {
        throw new AutomationUnavailableError('Viewer mode switch did not reach the expected next mode.', switched);
      }
    } else if (['click', 'mouse'].includes(type)
      && Number.isFinite(Number(action.offset))
      && !Number.isFinite(Number(action.x))) {
      const point = await this.sourceCoordinates(action.offset);
      if (!point) throw new AutomationUnavailableError('Could not map Viewer source offset to viewport coordinates.', action);
      await this.client.click({ ...action, ...point });
    } else if (type === 'select' && Number.isFinite(Number(action.anchor))
      && Number.isFinite(Number(action.focus))) {
      const [start, end] = await Promise.all([
        this.sourceCoordinates(action.anchor),
        this.sourceCoordinates(action.focus)
      ]);
      if (!start || !end) throw new AutomationUnavailableError('Could not map Viewer selection to viewport coordinates.', action);
      await this.client.drag(start, end, action);
    } else {
      const handled = await dispatchTrustedAction(this.client, action, { platform: 'darwin' });
      if (!handled) throw new AutomationUnavailableError('Unsupported Viewer scenario action.', { action });
    }
    await cdpDelay(this.options.settleMs);
  }

  captureRuntime() {
    return this.client.evaluate(viewerCaptureExpression(), { timeoutMs: 25_000 });
  }

  captureActionTraceRuntime() {
    return this.client.evaluate(
      viewerCaptureExpression({ timingPreserving: true }),
      { timeoutMs: 5_000 }
    );
  }

  async captureActionTrace(scenario = this.currentScenario || {}) {
    const runtime = decorateViewerPresentation(
      await this.captureActionTraceRuntime(),
      scenario
    );
    const source = typeof runtime.source === 'string' ? runtime.source : '';
    const consistency = {
      currentPage: runtime.canonicalCurrentPage?.markdownBody === source,
      canonicalMap: runtime.canonicalMapPage?.markdownBody === source,
      dom: runtime.domSource === source
    };
    const observation = buildRuntimeObservation({
      scenarioId: scenario.id || 'viewer-v1-scenario',
      evidenceLevel: 'V1',
      automatable: true,
      source,
      fileBytes: utf8FileBytes(source, { kind: 'viewer-dom-action-trace' }),
      selection: runtime.selection,
      runtime,
      metadata: {
        adapter: 'viewer-v1',
        mode: runtime.mode,
        active: runtime.active,
        versions: runtime.versions,
        viewerVersion: this.packageMetadata?.packageMetadata?.version || null,
        viewerCommit: this.options.viewerCommit || process.env.VIEWER_COMMIT || null,
        settings: runtime.settings,
        targetUrl: runtime.targetUrl,
        isolated: true,
        artifactsRetained: Boolean(this.options.keepArtifacts),
        packageFreshness: this.packageMetadata,
        consistency,
        selectionOrigin: runtime.selectionOrigin,
        actionTraceCapture: {
          timingPreserving: true,
          sourceAuthority: 'canonical-rendered-dom',
          persistedFileAuthorityAtFinalObservation: true
        }
      },
      raw: {
        canonicalCurrentPage: runtime.canonicalCurrentPage,
        canonicalMapPage: runtime.canonicalMapPage,
        domSource: runtime.domSource
      }
    });
    observation.consistency = consistency;
    observation.integrityFailure = Object.entries(consistency)
      .filter(([, matches]) => matches !== true)
      .map(([surface]) => surface)
      .concat(viewerListLifecycleFailures(runtime, scenario));
    return observation;
  }

  async capture(scenario = this.currentScenario || {}) {
    const runtime = decorateViewerPresentation(await this.captureRuntime(), scenario);
    const persistedFileBytes = await readExactFileObservation(
      this.isolation.root,
      this.persistedPagePath
    );
    let persistedPage = null;
    let persistedJsonError = null;
    try {
      persistedPage = JSON.parse(persistedFileBytes.utf8);
    } catch (error) {
      persistedJsonError = error.message;
    }
    const source = typeof persistedPage?.markdownBody === 'string'
      ? persistedPage.markdownBody
      : runtime.source;
    const consistency = {
      currentPage: runtime.canonicalCurrentPage?.markdownBody === source,
      canonicalMap: runtime.canonicalMapPage?.markdownBody === source,
      api: runtime.apiPage?.markdownBody === source,
      dom: runtime.domSource === source,
      persistedJsonReadable: !persistedJsonError
    };
    const observation = buildRuntimeObservation({
      scenarioId: scenario.id || 'viewer-v1-scenario',
      evidenceLevel: 'V1',
      automatable: !persistedJsonError,
      source,
      fileBytes: utf8FileBytes(source, { kind: 'canonical-markdown-body-utf8' }),
      selection: runtime.selection,
      runtime,
      metadata: {
        adapter: 'viewer-v1',
        mode: runtime.mode,
        active: runtime.active,
        versions: runtime.versions,
        viewerVersion: this.packageMetadata?.packageMetadata?.version || null,
        viewerCommit: this.options.viewerCommit || process.env.VIEWER_COMMIT || null,
        settings: runtime.settings,
        targetUrl: runtime.targetUrl,
        isolated: true,
        isolatedRoot: this.isolation.root,
        isolatedProfile: this.isolation.profile,
        isolatedVault: this.viewerVaultRoot,
        artifactsRetained: Boolean(this.options.keepArtifacts),
        packageFreshness: this.packageMetadata,
        persistedJsonError,
        consistency,
        selectionOrigin: runtime.selectionOrigin
      },
      raw: {
        canonicalCurrentPage: runtime.canonicalCurrentPage,
        canonicalMapPage: runtime.canonicalMapPage,
        apiPage: runtime.apiPage,
        domSource: runtime.domSource,
        persistedPage,
        persistedFileBytes: { ...persistedFileBytes, kind: 'actual-viewer-page-json' },
        processLog: this.process.log
      }
    });
    observation.persistedFileBytes = {
      ...persistedFileBytes,
      kind: 'actual-viewer-page-json'
    };
    observation.persistedFileBytesBase64 = persistedFileBytes.base64;
    observation.consistency = consistency;
    observation.integrityFailure = Object.entries(consistency)
      .filter(([, matches]) => matches !== true)
      .map(([surface]) => surface)
      .concat(viewerListLifecycleFailures(runtime, scenario));
    return observation;
  }

  async runScenario(scenario) {
    const actions = scenarioActionSequence(scenario);
    const traceActions = this.options.traceActions === true;
    const actionTrace = [];
    let finalObservation = null;
    let lastTraceObservation = null;
    let activeActionIndex = null;
    try {
      await this.setup(scenario);
      for (let index = 0; index < actions.length; index += 1) {
        const rawAction = actions[index];
        activeActionIndex = index;
        const action = rawAction?.type === 'mouse' && rawAction.command === 'click'
          && !Number.isFinite(Number(rawAction.offset))
          ? { ...rawAction, offset: scenario?.boundary?.offset ?? scenario?.initialSelection?.focus }
          : rawAction;
        await this.dispatch(action);
        if (traceActions) {
          const captureStartedAt = Date.now();
          lastTraceObservation = await this.captureActionTrace(scenario);
          lastTraceObservation.metadata = {
            ...lastTraceObservation.metadata,
            actionTraceCaptureDurationMs: Date.now() - captureStartedAt
          };
          actionTrace.push({
            index,
            action: rawAction,
            observation: compactActionTraceObservation(lastTraceObservation)
          });
        }
        activeActionIndex = null;
      }
      finalObservation = await this.capture(scenario);
      if (traceActions) {
        finalObservation.actionTrace = actionTrace;
        finalObservation.metadata = {
          ...finalObservation.metadata,
          actionTrace: {
            enabled: true,
            expectedActionCount: actions.length,
            capturedActionCount: actionTrace.length,
            complete: true,
            finalObservationReused: false,
            timingPreservingIntermediateCapture: true
          }
        };
      }
      return finalObservation;
    } catch (error) {
      if (error instanceof IsolationSafetyError) throw error;
      const failed = nonAutomatableObservation({
        scenarioId: scenario?.id || 'viewer-v1-scenario',
        evidenceLevel: 'V1',
        source: finalObservation?.source
          ?? lastTraceObservation?.source
          ?? (typeof scenario?.initialSource === 'string' ? scenario.initialSource : ''),
        error,
        metadata: {
          adapter: 'viewer-v1',
          isolated: true,
          isolatedRoot: this.isolation?.root || null,
          targetUrl: this.process?.target?.url || null
        }
      });
      if (traceActions) {
        if (activeActionIndex != null && !actionTrace.some(({ index }) => index === activeActionIndex)) {
          actionTrace.push({
            index: activeActionIndex,
            action: actions[activeActionIndex],
            observation: compactActionTraceObservation(failed)
          });
        }
        failed.actionTrace = actionTrace;
        failed.metadata = {
          ...failed.metadata,
          actionTrace: {
            enabled: true,
            expectedActionCount: actions.length,
            capturedActionCount: actionTrace.length,
            complete: false,
            finalObservationReused: false
          }
        };
      }
      return failed;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.process?.stop().catch(() => {});
    this.process = null;
    if (this.isolation && !this.options.keepArtifacts) {
      await removeIsolatedRuntimeRoot(this.isolation.root, {
        expectedToken: this.isolation.sentinel.token
      });
    }
  }
}

export async function runViewerV1Scenario(scenario, options = {}) {
  let adapter;
  try {
    adapter = await ViewerV1Adapter.launch(options);
    return await adapter.runScenario(scenario);
  } catch (error) {
    if (error instanceof IsolationSafetyError) throw error;
    return nonAutomatableObservation({
      scenarioId: scenario?.id || 'viewer-v1-scenario',
      evidenceLevel: 'V1',
      source: typeof scenario?.initialSource === 'string' ? scenario.initialSource : '',
      error,
      metadata: { adapter: 'viewer-v1', isolated: true }
    });
  } finally {
    await adapter?.close();
  }
}
