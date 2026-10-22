/* PaneRuntime-owned, plain-text Block and Highlight Group Info panels. */
const INFO_PANEL_DEFAULT_WIDTH = 320;
const INFO_PANEL_DEFAULT_HEIGHT = 220;
const INFO_PANEL_MIN_WIDTH = 220;
const INFO_PANEL_MIN_HEIGHT = 120;
const INFO_PANEL_INSET = 16;
const INFO_PANEL_STACK_OFFSET = 34;
let infoPanelSaveQueue = Promise.resolve();
const pendingInfoPanelSaves = new Map();
const infoPanelPageDeletionEpochs = new Map();
// The browser owns one pointer/focus surface at a time. This broker identifies
// that surface's exact PaneRuntime; all mutable gesture/editor state remains on
// the runtime itself.
let infoPanelGestureOwnerRuntime = null;

function ensureInfoPanelRuntimeState(runtime) {
  if (!runtime) return null;
  if (!Number.isInteger(runtime.infoPanelEditorRevision)) runtime.infoPanelEditorRevision = 0;
  if (!Object.prototype.hasOwnProperty.call(runtime, 'infoPanelEditor')) {
    runtime.infoPanelEditor = null;
  }
  if (!Object.prototype.hasOwnProperty.call(runtime, 'suspendedInfoPanelEditor')) {
    runtime.suspendedInfoPanelEditor = null;
  }
  if (!Object.prototype.hasOwnProperty.call(runtime, 'infoPanelGeometryGesture')) {
    runtime.infoPanelGeometryGesture = null;
  }
  if (!Object.prototype.hasOwnProperty.call(runtime, 'infoPanelFocusFrame')) {
    runtime.infoPanelFocusFrame = null;
  }
  if (!Object.prototype.hasOwnProperty.call(runtime, 'infoPanelsSuspended')) {
    runtime.infoPanelsSuspended = false;
  }
  if (!Object.prototype.hasOwnProperty.call(runtime, 'temporaryInfoBlockId')) {
    runtime.temporaryInfoBlockId = null;
  }
  return runtime;
}

function infoPanelRuntimePane(runtime) {
  if (!runtimeIsLive(runtime)) return null;
  const pane = getWorkspacePane(runtime.paneId);
  return pane?.viewContext === runtime ? pane : null;
}

function infoPanelRuntimeToken(runtime, {
  kind = null,
  ownerId = null,
  revision = null,
  includeMount = false
} = {}) {
  const liveRuntime = runtimeIsLive(runtime) ? ensureInfoPanelRuntimeState(runtime) : null;
  const tab = liveRuntime?.session?.activeTab?.();
  const pageId = tab?.currentPageId || liveRuntime?.currentPage?.id || null;
  if (!liveRuntime || !tab?.id || !pageId) return null;
  return {
    runtime: liveRuntime,
    runtimeId: liveRuntime.runtimeId,
    lifecycleEpoch: liveRuntime.lifecycleEpoch,
    session: liveRuntime.session,
    tabId: tab.id,
    pageId,
    mountGeneration: includeMount ? (liveRuntime.mounted?.generation ?? null) : null,
    kind,
    ownerId,
    revision
  };
}

function infoPanelRuntimeTokenIsCurrent(token, {
  requireOwner = false,
  requireRevision = false,
  requireMount = false
} = {}) {
  if (!token) return false;
  const runtime = token?.runtime;
  if (!runtimeIsLive(runtime) || infoPanelRuntimePane(runtime)?.viewContext !== runtime
    || runtime.runtimeId !== token.runtimeId || runtime.lifecycleEpoch !== token.lifecycleEpoch
    || runtime.session !== token.session) return false;
  const tab = runtime.session?.activeTab?.();
  if (!tab || tab.id !== token.tabId || tab.currentPageId !== token.pageId
    || runtime.currentPage?.id !== token.pageId) return false;
  if (requireMount && (runtime.mounted?.generation ?? null) !== token.mountGeneration) return false;
  if (requireRevision && runtime.infoPanelEditorRevision !== token.revision) return false;
  return !requireOwner || Boolean(infoPanelOwner(
    runtime.currentPage, token.kind, token.ownerId
  ));
}

function advanceInfoPanelEditorRevision(runtime) {
  ensureInfoPanelRuntimeState(runtime);
  runtime.infoPanelEditorRevision += 1;
  return runtime.infoPanelEditorRevision;
}

function cancelInfoPanelFocusFrame(runtime) {
  if (!runtime || runtime.infoPanelFocusFrame === null
    || runtime.infoPanelFocusFrame === undefined) return false;
  window.cancelAnimationFrame(runtime.infoPanelFocusFrame);
  runtime.infoPanelFocusFrame = null;
  return true;
}

function infoPanelPageDeletionEpoch(pageId) {
  return infoPanelPageDeletionEpochs.get(pageId) || 0;
}

function infoPanelSaveIntentIsCurrent(intent) {
  return Boolean(intent?.pageId
    && infoPanelPageDeletionEpoch(intent.pageId) === intent.pageDeletionEpoch
    && canonicalPages.has(intent.pageId));
}

function captureInfoPanelEditorDomState(runtime) {
  const editor = runtime?.infoPanelEditor;
  const textarea = editor?.textarea;
  if (!editor || !textarea) return false;
  editor.draftText = String(textarea.value ?? editor.draftText ?? '');
  if (Number.isFinite(textarea.selectionStart)) {
    editor.selectionOffset = textarea.selectionStart;
    editor.selectionEnd = Number.isFinite(textarea.selectionEnd)
      ? textarea.selectionEnd
      : textarea.selectionStart;
    editor.selectionDirection = textarea.selectionDirection || 'none';
  }
  return true;
}

function infoPanelKey(kind, ownerId) {
  return `${kind}:${ownerId}`;
}

function infoPanelPageForRuntime(runtime) {
  return runtimeIsLive(runtime) ? runtime.currentPage : null;
}

function infoPanelOwner(page, kind, ownerId) {
  if (kind === 'block') return (page?.blocks || []).find((block) => block.id === ownerId) || null;
  if (kind === 'highlight') {
    return (page?.highlightGroups || []).find((group) => group.id === ownerId) || null;
  }
  return null;
}

function infoPanelText(page, kind, ownerId) {
  const value = infoPanelOwner(page, kind, ownerId)?.info;
  return typeof value === 'string' ? value : '';
}

function infoPanelReadModeAvailable(runtime) {
  return Boolean(runtimeIsLive(runtime) && runtime.currentPage
    && !runtime.blockEditMode && !runtime.pageEditMode && !runtime.highlightEditDraft
    && !pageMetaModal && !runtime.linkPickMode && !runtime.addLinkInProgress
    && !pageDeleteInProgress && !runtime.blockDrawing && !runtime.blockTransform
    && !runtime.pageObjectDrag && !runtime.infoPanelEditor);
}

function infoPanelStateForRuntime(runtime) {
  const tab = runtime?.session?.activeTab?.();
  if (!tab) return null;
  if (!Array.isArray(tab.viewState.infoPanels)) tab.viewState.infoPanels = [];
  if (!Number.isFinite(tab.viewState.infoPanelZCounter)) tab.viewState.infoPanelZCounter = 0;
  return { tab, viewState: tab.viewState, panels: tab.viewState.infoPanels };
}

function infoPanelsSuspendedForRuntime(runtime) {
  return runtime?.infoPanelsSuspended === true;
}

function setInfoPanelLayerSuspended(runtime, suspended) {
  const layer = infoPanelLayerForRuntime(runtime);
  if (!layer) return;
  layer.classList.toggle('is-suspended', suspended);
  layer.hidden = suspended;
}

function preserveInfoPanelEditorForSuspension(runtime) {
  const editor = runtime?.infoPanelEditor;
  if (!editor || editor.runtime !== runtime) return false;
  const textarea = editor.textarea;
  editor.draftText = String(textarea?.value ?? editor.draftText ?? '');
  if (Number.isFinite(textarea?.selectionStart)) {
    editor.selectionOffset = textarea.selectionStart;
    editor.selectionEnd = Number.isFinite(textarea.selectionEnd)
      ? textarea.selectionEnd
      : textarea.selectionStart;
    editor.selectionDirection = textarea.selectionDirection || 'none';
  }
  editor.textarea = null;
  runtime.suspendedInfoPanelEditor = editor;
  runtime.infoPanelEditor = null;
  return true;
}

function restoreInfoPanelEditorAfterSuspension(runtime) {
  const editor = runtime?.suspendedInfoPanelEditor || null;
  if (runtime) runtime.suspendedInfoPanelEditor = null;
  if (!editor) return false;
  const tab = runtime.session?.activeTab?.();
  const page = infoPanelPageForRuntime(runtime);
  if (!tab || tab.id !== editor.tabId || tab.currentPageId !== editor.pageId
    || page?.id !== editor.pageId || !infoPanelOwner(page, editor.kind, editor.ownerId)
    || !infoPanelRuntimeTokenIsCurrent(editor.runtimeToken, {
      requireOwner: true,
      requireRevision: true
    })) {
    advanceInfoPanelEditorRevision(runtime);
    return false;
  }
  editor.textarea = null;
  runtime.infoPanelEditor = editor;
  return true;
}

function suspendInfoPanelsForRuntime(runtime) {
  if (!runtimeIsLive(runtime)) return false;
  ensureInfoPanelRuntimeState(runtime);
  if (infoPanelsSuspendedForRuntime(runtime)) return true;
  preserveInfoPanelEditorForSuspension(runtime);
  cancelInfoPanelFocusFrame(runtime);
  cancelInfoPanelGeometryGesture(runtime);
  hideTemporaryBlockInfo(runtime);
  runtime.infoPanelsSuspended = true;
  setInfoPanelLayerSuspended(runtime, true);
  return true;
}

function resumeInfoPanelsForRuntime(runtime) {
  if (!runtimeIsLive(runtime) || !infoPanelsSuspendedForRuntime(runtime)) return false;
  runtime.infoPanelsSuspended = false;
  runtime.temporaryInfoBlockId = null;
  setInfoPanelLayerSuspended(runtime, false);
  restoreInfoPanelEditorAfterSuspension(runtime);
  renderInfoPanelsForRuntime(runtime);
  return true;
}

function infoPanelIdentityForRuntime(runtime, kind, ownerId) {
  const token = infoPanelRuntimeToken(runtime, { kind, ownerId });
  return token ? { ...token } : null;
}

function infoPanelStateForIdentity(runtime, identity) {
  if (!runtime || !identity || runtime !== identity.runtime
    || runtime.runtimeId !== identity.runtimeId
    || runtime.lifecycleEpoch !== identity.lifecycleEpoch
    || runtime.session !== identity.session) return null;
  const tab = runtime.session?.tabById?.(identity.tabId);
  if (!tab || tab.currentPageId !== identity.pageId) return null;
  if (!Array.isArray(tab.viewState.infoPanels)) tab.viewState.infoPanels = [];
  if (!Number.isFinite(tab.viewState.infoPanelZCounter)) tab.viewState.infoPanelZCounter = 0;
  return { tab, viewState: tab.viewState, panels: tab.viewState.infoPanels };
}

function infoPanelEntryForIdentity(runtime, identity) {
  return infoPanelStateForIdentity(runtime, identity)?.panels.find((panel) => (
    panel.kind === identity.kind && panel.ownerId === identity.ownerId
  )) || null;
}

function commitInfoPanelGeometryToViewState(runtime, identity, rect) {
  const state = infoPanelStateForIdentity(runtime, identity);
  const entry = state?.panels.find((panel) => (
    panel.kind === identity.kind && panel.ownerId === identity.ownerId
  ));
  if (!state || !entry || !rect) return null;
  entry.x = rect.left;
  entry.y = rect.top;
  entry.width = rect.width;
  entry.height = rect.height;
  entry.autoPositioned = false;
  return { ...state, entry };
}

function saveInfoPanelViewState(runtime) {
  const state = infoPanelStateForRuntime(runtime);
  if (!state) return false;
  const saved = runtime.session.saveViewState(state.tab.id, { ...state.tab.viewState });
  if (saved && typeof scheduleWorkspaceStateSave === 'function') scheduleWorkspaceStateSave();
  return saved;
}

function infoPanelLayerForRuntime(runtime) {
  const area = runtime?.dom?.canvasArea;
  if (!area) return null;
  let layer = area.querySelector(':scope > .info-panel-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'info-panel-layer';
    layer.dataset.paneId = runtime.paneId;
    area.append(layer);
  }
  runtime.dom.infoPanelLayer = layer;
  return layer;
}

function infoPanelEditorMatches(runtime, kind, ownerId) {
  const editor = runtime?.infoPanelEditor;
  return Boolean(editor && editor.runtime === runtime
    && editor.tabId === runtime?.session?.activeTab?.()?.id
    && editor.kind === kind && editor.ownerId === ownerId);
}

function activateInfoPanelRuntime(runtime) {
  if (!runtimeIsLive(runtime)) return null;
  if (activePaneRuntime() === runtime) return runtime;
  setActiveWorkspacePane(runtime.paneId);
  return activePaneRuntime() === runtime ? runtime : null;
}

function infoPanelNextZ(viewState) {
  viewState.infoPanelZCounter = Math.max(
    Number(viewState.infoPanelZCounter) || 0,
    ...(viewState.infoPanels || []).map((panel) => Number(panel.z) || 0)
  ) + 1;
  return viewState.infoPanelZCounter;
}

function infoPanelEntry(runtime, kind, ownerId) {
  return infoPanelStateForRuntime(runtime)?.panels.find((panel) => (
    panel.kind === kind && panel.ownerId === ownerId
  )) || null;
}

function ensureInfoPanelEntry(runtime, kind, ownerId, { bringToFront = false } = {}) {
  const state = infoPanelStateForRuntime(runtime);
  if (!state) return null;
  let entry = state.panels.find((panel) => panel.kind === kind && panel.ownerId === ownerId);
  if (!entry) {
    entry = {
      kind,
      ownerId,
      x: INFO_PANEL_INSET,
      y: INFO_PANEL_INSET,
      width: INFO_PANEL_DEFAULT_WIDTH,
      height: INFO_PANEL_DEFAULT_HEIGHT,
      z: infoPanelNextZ(state.viewState),
      minimized: false,
      autoPositioned: true
    };
    state.panels.push(entry);
  } else if (bringToFront) {
    entry.z = infoPanelNextZ(state.viewState);
  }
  return entry;
}

function removeInfoPanelEntry(runtime, kind, ownerId) {
  const state = infoPanelStateForRuntime(runtime);
  if (!state) return false;
  const next = state.panels.filter((panel) => !(panel.kind === kind && panel.ownerId === ownerId));
  if (next.length === state.panels.length) return false;
  state.viewState.infoPanels = next;
  return true;
}

function checkedHighlightInfoIds(runtime) {
  return new Set(checkedHighlightGroupIdsForViewState(
    runtime?.session?.activeTab?.()?.viewState
  ));
}

function orderedInfoPanelEntries(page, panels) {
  const groupOrder = new Map((page?.highlightGroups || []).map((group, index) => [group.id, index]));
  return [...panels].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'highlight' ? -1 : 1;
    if (left.kind === 'highlight') {
      return (groupOrder.get(left.ownerId) ?? Number.MAX_SAFE_INTEGER)
        - (groupOrder.get(right.ownerId) ?? Number.MAX_SAFE_INTEGER);
    }
    return (left.z || 0) - (right.z || 0);
  });
}

function restackAutomaticInfoPanels(page, panels) {
  const occupied = panels.filter((panel) => panel.autoPositioned === false)
    .map((panel) => ({ x: panel.x, y: panel.y }));
  for (const panel of orderedInfoPanelEntries(page, panels)) {
    if (panel.autoPositioned === false) continue;
    let y = INFO_PANEL_INSET;
    while (occupied.some((point) => (
      Math.abs(point.x - INFO_PANEL_INSET) < 2 && Math.abs(point.y - y) < INFO_PANEL_STACK_OFFSET
    ))) y += INFO_PANEL_STACK_OFFSET;
    panel.x = INFO_PANEL_INSET;
    panel.y = y;
    occupied.push({ x: panel.x, y: panel.y });
  }
}

function syncInfoPanelEntriesForRuntime(runtime) {
  const state = infoPanelStateForRuntime(runtime);
  const page = infoPanelPageForRuntime(runtime);
  if (!state || !page) return false;
  const before = JSON.stringify(state.panels);
  const validBlocks = new Set((page.blocks || []).map((block) => block.id));
  const groups = Array.isArray(page.highlightGroups) ? page.highlightGroups : [];
  const validGroups = new Set(groups.map((group) => group.id));
  const checked = checkedHighlightInfoIds(runtime);
  state.viewState.infoPanels = state.panels.filter((panel) => {
    if (panel.kind === 'block') {
      return validBlocks.has(panel.ownerId)
        && (Boolean(infoPanelText(page, 'block', panel.ownerId))
          || infoPanelEditorMatches(runtime, 'block', panel.ownerId));
    }
    if (panel.kind !== 'highlight' || !validGroups.has(panel.ownerId)) return false;
    return infoPanelEditorMatches(runtime, 'highlight', panel.ownerId)
      || (checked.has(panel.ownerId)
        && Boolean(infoPanelText(page, 'highlight', panel.ownerId)));
  });
  for (const group of groups) {
    if (checked.has(group.id) && infoPanelText(page, 'highlight', group.id)) {
      ensureInfoPanelEntry(runtime, 'highlight', group.id);
    }
  }
  const refreshed = infoPanelStateForRuntime(runtime);
  restackAutomaticInfoPanels(page, refreshed.panels);
  const changed = before !== JSON.stringify(refreshed.panels);
  if (changed) saveInfoPanelViewState(runtime);
  return changed;
}

function clampInfoPanelGeometry(entry, layer) {
  const availableWidth = Math.max(1, layer.clientWidth - INFO_PANEL_INSET * 2);
  const availableHeight = Math.max(1, layer.clientHeight - INFO_PANEL_INSET * 2);
  const width = Math.min(entry.width, availableWidth);
  const height = Math.min(entry.height, availableHeight);
  return {
    x: Math.max(0, Math.min(entry.x, layer.clientWidth - width)),
    y: Math.max(0, Math.min(entry.y, layer.clientHeight - height)),
    width,
    height
  };
}

function infoPanelTitle(page, kind, ownerId) {
  if (kind === 'block') return 'Block info';
  const group = infoPanelOwner(page, kind, ownerId);
  return `Highlight: ${group?.name || ownerId}`;
}

function bringInfoPanelToFront(runtime, kind, ownerId, element = null, { persist = true } = {}) {
  const state = infoPanelStateForRuntime(runtime);
  const entry = infoPanelEntry(runtime, kind, ownerId);
  if (!state || !entry) return false;
  entry.z = infoPanelNextZ(state.viewState);
  if (element) element.style.zIndex = String(entry.z);
  if (persist) saveInfoPanelViewState(runtime);
  return true;
}

function infoPanelGeometryGestureForRuntime(runtime) {
  return runtime?.infoPanelGeometryGesture || null;
}

function infoPanelGeometryGestureOwner() {
  const runtime = infoPanelGestureOwnerRuntime;
  const gesture = infoPanelGeometryGestureForRuntime(runtime);
  if (!gesture) infoPanelGestureOwnerRuntime = null;
  return gesture;
}

function infoPanelStyleNumber(element, property, fallback) {
  const value = Number.parseFloat(element?.style?.[property]);
  return Number.isFinite(value) ? value : fallback;
}

function infoPanelGestureStartRect(panel, entry, layer) {
  const clamped = clampInfoPanelGeometry(entry, layer);
  return {
    left: infoPanelStyleNumber(panel, 'left', clamped.x),
    top: infoPanelStyleNumber(panel, 'top', clamped.y),
    width: infoPanelStyleNumber(panel, 'width', clamped.width),
    height: infoPanelStyleNumber(panel, 'height', clamped.height)
  };
}

function infoPanelGestureRect(gesture, clientX, clientY) {
  const dx = clientX - gesture.startClientX;
  const dy = clientY - gesture.startClientY;
  const start = gesture.startRect;
  const layerWidth = gesture.layer.clientWidth;
  const layerHeight = gesture.layer.clientHeight;
  if (gesture.type === 'drag') {
    return {
      left: Math.max(0, Math.min(start.left + dx, layerWidth - start.width)),
      top: Math.max(0, Math.min(start.top + dy, layerHeight - start.height)),
      width: start.width,
      height: start.height
    };
  }

  const right = start.left + start.width;
  const bottom = start.top + start.height;
  let left = start.left;
  let top = start.top;
  let width = start.width;
  let height = start.height;
  if (gesture.edge.includes('e')) {
    const maximumWidth = Math.max(0, layerWidth - left);
    const minimumWidth = Math.min(INFO_PANEL_MIN_WIDTH, maximumWidth);
    width = Math.max(minimumWidth, Math.min(start.width + dx, maximumWidth));
  }
  if (gesture.edge.includes('s')) {
    const maximumHeight = Math.max(0, layerHeight - top);
    const minimumHeight = Math.min(INFO_PANEL_MIN_HEIGHT, maximumHeight);
    height = Math.max(minimumHeight, Math.min(start.height + dy, maximumHeight));
  }
  if (gesture.edge.includes('w')) {
    const minimumWidth = Math.min(INFO_PANEL_MIN_WIDTH, right);
    left = Math.max(0, Math.min(start.left + dx, right - minimumWidth));
    width = right - left;
  }
  if (gesture.edge.includes('n')) {
    const minimumHeight = Math.min(INFO_PANEL_MIN_HEIGHT, bottom);
    top = Math.max(0, Math.min(start.top + dy, bottom - minimumHeight));
    height = bottom - top;
  }
  return { left, top, width, height };
}

function applyInfoPanelGeometryFrame(gesture) {
  if (infoPanelGeometryGestureForRuntime(gesture?.runtime) !== gesture
    || !infoPanelRuntimeTokenIsCurrent(gesture.identity, {
      requireOwner: true,
      requireMount: true
    }) || !gesture.panel.isConnected) return;
  gesture.frameRequest = null;
  const rect = infoPanelGestureRect(gesture, gesture.lastClientX, gesture.lastClientY);
  gesture.liveRect = rect;
  if (gesture.type === 'drag') {
    const dx = rect.left - gesture.startRect.left;
    const dy = rect.top - gesture.startRect.top;
    gesture.panel.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    return;
  }
  Object.assign(gesture.panel.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
}

function scheduleInfoPanelGeometryFrame(gesture, event) {
  if (infoPanelGeometryGestureForRuntime(gesture?.runtime) !== gesture
    || event.pointerId !== gesture.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  gesture.lastClientX = event.clientX;
  gesture.lastClientY = event.clientY;
  if (gesture.frameRequest === null) {
    gesture.frameRequest = window.requestAnimationFrame(() => applyInfoPanelGeometryFrame(gesture));
  }
}

function removeInfoPanelGeometryListeners(gesture) {
  window.removeEventListener('pointermove', gesture.move, true);
  window.removeEventListener('pointerup', gesture.up, true);
  window.removeEventListener('pointercancel', gesture.cancel, true);
  gesture.surface.removeEventListener('lostpointercapture', gesture.lostCapture);
  window.removeEventListener('blur', gesture.blur);
}

function finishInfoPanelGeometryGesture(gesture, { event = null, persist = true } = {}) {
  const runtime = gesture?.runtime;
  if (!gesture || infoPanelGeometryGestureForRuntime(runtime) !== gesture) return false;
  if (event?.pointerId !== undefined && event.pointerId !== gesture.pointerId) return false;
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    gesture.lastClientX = event.clientX;
    gesture.lastClientY = event.clientY;
  }
  if (gesture.frameRequest !== null) {
    window.cancelAnimationFrame(gesture.frameRequest);
    gesture.frameRequest = null;
  }
  applyInfoPanelGeometryFrame(gesture);
  const finalRect = gesture.liveRect || gesture.startRect;
  runtime.infoPanelGeometryGesture = null;
  if (infoPanelGestureOwnerRuntime === runtime) infoPanelGestureOwnerRuntime = null;
  removeInfoPanelGeometryListeners(gesture);
  try {
    if (gesture.surface.hasPointerCapture?.(gesture.pointerId)) {
      gesture.surface.releasePointerCapture(gesture.pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  const ownerCurrent = infoPanelRuntimeTokenIsCurrent(gesture.identity, {
    requireOwner: true,
    requireMount: true
  });
  const committed = ownerCurrent
    ? commitInfoPanelGeometryToViewState(runtime, gesture.identity, finalRect)
    : null;
  if (committed) gesture.entry = committed.entry;
  gesture.panel.classList.remove('is-dragging', 'is-resizing');
  Object.assign(gesture.panel.style, {
    left: `${finalRect.left}px`,
    top: `${finalRect.top}px`,
    width: `${finalRect.width}px`,
    height: `${finalRect.height}px`,
    transform: ''
  });
  if (persist && committed) {
    runtime.session.saveViewState(committed.tab.id, { ...committed.viewState });
  }
  if (ownerCurrent && gesture.renderPending && gesture.panel.isConnected) {
    renderInfoPanelsForRuntime(runtime);
  }
  return true;
}

function cancelInfoPanelGeometryGesture(runtime, { persist = true } = {}) {
  const gesture = infoPanelGeometryGestureForRuntime(runtime);
  if (!gesture) return false;
  return finishInfoPanelGeometryGesture(gesture, { persist });
}

function resolveInfoPanelGestureElements(runtime, entry, panel, selector) {
  const activeRuntime = activePaneRuntime() === runtime
    ? runtime
    : activateInfoPanelRuntime(runtime);
  const identity = infoPanelRuntimeToken(activeRuntime, {
    kind: entry.kind,
    ownerId: entry.ownerId,
    includeMount: true
  });
  const activeEntry = infoPanelEntryForIdentity(activeRuntime, identity);
  const activePanel = activePaneRuntime() === runtime && panel?.isConnected
    ? panel
    : infoPanelLayerForRuntime(activeRuntime)?.querySelector(
    `.info-panel.is-fixed[data-info-panel-kind="${CSS.escape(entry.kind)}"]`
      + `[data-info-panel-owner-id="${CSS.escape(entry.ownerId)}"]`
    );
  return {
    runtime: activeRuntime,
    entry: activeEntry,
    panel: activePanel,
    surface: activePanel?.querySelector(selector),
    identity
  };
}

function startInfoPanelGeometryGesture(event, runtime, entry, panel, type, edge = null) {
  if (event.button !== 0 || event.isPrimary === false
    || infoPanelsSuspendedForRuntime(runtime)) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  const currentGesture = infoPanelGeometryGestureOwner();
  if (currentGesture) finishInfoPanelGeometryGesture(currentGesture);
  const selector = type === 'drag'
    ? '.info-panel-titlebar'
    : `.info-panel-resize-handle.is-${edge}`;
  const resolved = resolveInfoPanelGestureElements(runtime, entry, panel, selector);
  if (!resolved.runtime || !resolved.entry || !resolved.panel || !resolved.surface) return false;
  const layer = infoPanelLayerForRuntime(resolved.runtime);
  if (!layer) return false;
  bringInfoPanelToFront(
    resolved.runtime,
    resolved.entry.kind,
    resolved.entry.ownerId,
    resolved.panel,
    { persist: false }
  );
  const gesture = {
    type,
    edge,
    runtime: resolved.runtime,
    entry: resolved.entry,
    identity: resolved.identity,
    panel: resolved.panel,
    surface: resolved.surface,
    layer,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    startRect: infoPanelGestureStartRect(resolved.panel, resolved.entry, layer),
    liveRect: null,
    frameRequest: null,
    renderPending: false
  };
  gesture.liveRect = gesture.startRect;
  gesture.move = (moveEvent) => scheduleInfoPanelGeometryFrame(gesture, moveEvent);
  gesture.up = (upEvent) => {
    if (upEvent.pointerId !== gesture.pointerId) return;
    upEvent.preventDefault();
    upEvent.stopPropagation();
    finishInfoPanelGeometryGesture(gesture, { event: upEvent });
  };
  gesture.cancel = (cancelEvent) => {
    if (cancelEvent.pointerId !== gesture.pointerId) return;
    cancelEvent.preventDefault();
    cancelEvent.stopPropagation();
    finishInfoPanelGeometryGesture(gesture);
  };
  gesture.lostCapture = () => finishInfoPanelGeometryGesture(gesture);
  gesture.blur = () => finishInfoPanelGeometryGesture(gesture);
  resolved.runtime.infoPanelGeometryGesture = gesture;
  infoPanelGestureOwnerRuntime = resolved.runtime;
  resolved.panel.classList.add(type === 'drag' ? 'is-dragging' : 'is-resizing');
  window.addEventListener('pointermove', gesture.move, { capture: true, passive: false });
  window.addEventListener('pointerup', gesture.up, true);
  window.addEventListener('pointercancel', gesture.cancel, true);
  resolved.surface.addEventListener('lostpointercapture', gesture.lostCapture);
  window.addEventListener('blur', gesture.blur);
  try {
    resolved.surface.setPointerCapture(event.pointerId);
  } catch {
    finishInfoPanelGeometryGesture(gesture);
    return false;
  }
  return true;
}

function beginInfoPanelDrag(event, runtime, entry, panel) {
  if (event.target.closest('button, textarea')) return false;
  return startInfoPanelGeometryGesture(event, runtime, entry, panel, 'drag');
}

function beginInfoPanelResize(event, runtime, entry, panel, edge) {
  return startInfoPanelGeometryGesture(event, runtime, entry, panel, 'resize', edge);
}

function createInfoPanelElement(runtime, page, entry) {
  const editing = infoPanelEditorMatches(runtime, entry.kind, entry.ownerId);
  const mountToken = infoPanelRuntimeToken(runtime, {
    kind: entry.kind,
    ownerId: entry.ownerId,
    includeMount: true
  });
  const panel = document.createElement('section');
  panel.className = `info-panel is-fixed is-${entry.kind}`;
  panel.dataset.infoPanelKind = entry.kind;
  panel.dataset.infoPanelOwnerId = entry.ownerId;
  panel.classList.toggle('is-editing', editing);
  panel.classList.toggle('is-minimized', entry.kind === 'highlight' && entry.minimized && !editing);
  const layer = infoPanelLayerForRuntime(runtime);
  const geometry = clampInfoPanelGeometry(entry, layer);
  Object.assign(panel.style, {
    left: `${geometry.x}px`,
    top: `${geometry.y}px`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
    zIndex: String(entry.z || 1)
  });
  panel.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (!infoPanelRuntimeTokenIsCurrent(mountToken, {
      requireOwner: true, requireMount: true
    })) return;
    let ownerRuntime = runtime;
    let ownerPanel = panel;
    if (activePaneRuntime() !== runtime) {
      ownerRuntime = activateInfoPanelRuntime(runtime);
      ownerPanel = infoPanelLayerForRuntime(ownerRuntime)?.querySelector(
        `.info-panel.is-fixed[data-info-panel-kind="${CSS.escape(entry.kind)}"]`
          + `[data-info-panel-owner-id="${CSS.escape(entry.ownerId)}"]`
      ) || panel;
    }
    if (!ownerRuntime) return;
    bringInfoPanelToFront(ownerRuntime, entry.kind, entry.ownerId, ownerPanel, {
      persist: !event.target.closest('button')
    });
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('contextmenu', (event) => event.stopPropagation());
  panel.addEventListener('wheel', (event) => event.stopPropagation());
  panel.addEventListener('pointerenter', () => clearCanvasPointerHover(runtime));
  panel.addEventListener('pointermove', (event) => event.stopPropagation());
  panel.addEventListener('pointerup', (event) => event.stopPropagation());

  const header = document.createElement('header');
  header.className = 'info-panel-titlebar';
  const title = document.createElement('span');
  title.className = 'info-panel-title';
  title.textContent = infoPanelTitle(page, entry.kind, entry.ownerId);
  const controls = document.createElement('span');
  controls.className = 'info-panel-controls';
  if (editing) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'info-panel-control is-save';
    save.textContent = '✓';
    save.setAttribute('aria-label', 'Save info');
    save.addEventListener('click', () => {
      if (!infoPanelRuntimeTokenIsCurrent(mountToken, {
        requireOwner: true, requireMount: true
      })) return;
      saveInfoPanelEditor(runtime);
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'info-panel-control';
    cancel.textContent = '×';
    cancel.setAttribute('aria-label', 'Cancel info edits');
    cancel.addEventListener('click', () => {
      if (!infoPanelRuntimeTokenIsCurrent(mountToken, {
        requireOwner: true, requireMount: true
      })) return;
      cancelInfoPanelEditor(runtime);
    });
    controls.append(save, cancel);
  } else if (entry.kind === 'highlight') {
    const minimise = document.createElement('button');
    minimise.type = 'button';
    minimise.className = 'info-panel-control';
    minimise.textContent = entry.minimized ? '□' : '−';
    minimise.setAttribute('aria-label', entry.minimized ? 'Restore Highlight Group info' : 'Minimise Highlight Group info');
    minimise.addEventListener('click', () => {
      if (!infoPanelRuntimeTokenIsCurrent(mountToken, {
        requireOwner: true, requireMount: true
      })) return;
      const fresh = infoPanelEntry(runtime, entry.kind, entry.ownerId);
      if (!fresh) return;
      fresh.minimized = !fresh.minimized;
      saveInfoPanelViewState(runtime);
      renderInfoPanelsForRuntime(runtime);
    });
    controls.append(minimise);
  } else {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'info-panel-control';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close Block info');
    close.addEventListener('click', () => {
      if (!infoPanelRuntimeTokenIsCurrent(mountToken, {
        requireOwner: true, requireMount: true
      })) return;
      closeFixedBlockInfoPanel(runtime, entry.ownerId);
    });
    controls.append(close);
  }
  header.append(title, controls);
  header.addEventListener('pointerdown', (event) => (
    beginInfoPanelDrag(event, runtime, entry, panel)
  ));
  if (entry.kind === 'highlight' && entry.minimized && !editing) {
    title.addEventListener('click', () => {
      if (!infoPanelRuntimeTokenIsCurrent(mountToken, {
        requireOwner: true, requireMount: true
      })) return;
      entry.minimized = false;
      saveInfoPanelViewState(runtime);
      renderInfoPanelsForRuntime(runtime);
    });
  }
  panel.append(header);

  if (!(entry.kind === 'highlight' && entry.minimized && !editing)) {
    const body = document.createElement('div');
    body.className = 'info-panel-body';
    if (editing) {
      const textarea = document.createElement('textarea');
      textarea.className = 'info-panel-editor';
      const editor = runtime.infoPanelEditor;
      textarea.value = editor.draftText;
      textarea.setAttribute('aria-label', infoPanelTitle(page, entry.kind, entry.ownerId));
      textarea.addEventListener('input', () => {
        if (infoPanelEditorMatches(runtime, entry.kind, entry.ownerId)
          && runtime.infoPanelEditor.textarea === textarea) {
          runtime.infoPanelEditor.draftText = textarea.value;
        }
      });
      textarea.addEventListener('keydown', (event) => {
        if (globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
          event,
          textarea
        )) return;
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelInfoPanelEditor(runtime);
          return;
        }
        const saveShortcut = (event.key === 'Enter' && event.shiftKey)
          || (String(event.key).toLowerCase() === 's' && (event.metaKey || event.ctrlKey));
        if (saveShortcut) {
          event.preventDefault();
          event.stopImmediatePropagation();
          saveInfoPanelEditor(runtime);
        }
      });
      if (runtime.infoPanelEditor === editor) editor.textarea = textarea;
      body.append(textarea);
    } else {
      const content = document.createElement('div');
      content.className = 'info-panel-content';
      content.textContent = infoPanelText(page, entry.kind, entry.ownerId);
      content.tabIndex = 0;
      content.addEventListener('click', () => (
        beginInfoPanelEditing(runtime, entry.kind, entry.ownerId)
      ));
      content.addEventListener('keydown', (event) => {
        if (event.key === 'Enter'
          && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
            event,
            content
          )) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          beginInfoPanelEditing(runtime, entry.kind, entry.ownerId);
        }
      });
      body.append(content);
    }
    panel.append(body);
  }

  for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    const handle = document.createElement('span');
    handle.className = `info-panel-resize-handle is-${edge}`;
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', (event) => beginInfoPanelResize(
      event, runtime, entry, panel, edge
    ));
    panel.append(handle);
  }
  return panel;
}

function createTemporaryBlockInfoPanel(runtime, page, blockId, panels) {
  const mountToken = infoPanelRuntimeToken(runtime, {
    kind: 'block', ownerId: blockId, includeMount: true
  });
  const panel = document.createElement('section');
  panel.className = 'info-panel is-temporary is-block';
  panel.dataset.infoPanelKind = 'block';
  panel.dataset.infoPanelOwnerId = blockId;
  panel.setAttribute('aria-label', 'Block info');
  const temporaryEntry = {
    x: INFO_PANEL_INSET,
    y: INFO_PANEL_INSET,
    width: INFO_PANEL_DEFAULT_WIDTH,
    height: INFO_PANEL_DEFAULT_HEIGHT
  };
  const occupied = panels.map((entry) => ({ x: entry.x, y: entry.y }));
  while (occupied.some((point) => (
    Math.abs(point.x - temporaryEntry.x) < 2
      && Math.abs(point.y - temporaryEntry.y) < INFO_PANEL_STACK_OFFSET
  ))) temporaryEntry.y += INFO_PANEL_STACK_OFFSET;
  const geometry = clampInfoPanelGeometry(temporaryEntry, infoPanelLayerForRuntime(runtime));
  Object.assign(panel.style, {
    left: `${geometry.x}px`,
    top: `${geometry.y}px`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`
  });
  const header = document.createElement('header');
  header.className = 'info-panel-titlebar';
  header.textContent = 'Block info';
  const body = document.createElement('div');
  body.className = 'info-panel-body info-panel-content';
  body.textContent = infoPanelText(page, 'block', blockId);
  panel.append(header, body);
  panel.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (event.button === 0) event.preventDefault();
  });
  panel.addEventListener('pointermove', (event) => event.stopPropagation());
  panel.addEventListener('pointerup', (event) => event.stopPropagation());
  panel.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  panel.addEventListener('wheel', (event) => event.stopPropagation());
  panel.addEventListener('pointerleave', (event) => {
    if (temporaryInfoHoverOwnsPoint(
      runtime, blockId, event.relatedTarget, event.clientX, event.clientY
    )) return;
    clearCanvasPointerHover(runtime);
  });
  panel.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!body.contains(event.target)
      || !infoPanelRuntimeTokenIsCurrent(mountToken, {
        requireOwner: true, requireMount: true
      })) return;
    promoteTemporaryBlockInfoPanel(runtime, blockId, panel, body, event);
  });
  return panel;
}

function renderInfoPanelsForRuntime(runtime) {
  if (!runtimeIsLive(runtime)) return;
  ensureInfoPanelRuntimeState(runtime);
  cancelInfoPanelFocusFrame(runtime);
  captureInfoPanelEditorDomState(runtime);
  const layer = infoPanelLayerForRuntime(runtime);
  const page = infoPanelPageForRuntime(runtime);
  if (!layer) return;
  const suspended = infoPanelsSuspendedForRuntime(runtime);
  layer.classList.toggle('is-suspended', suspended);
  if (suspended) {
    layer.hidden = true;
    return;
  }
  const geometryGesture = infoPanelGeometryGestureForRuntime(runtime);
  if (geometryGesture?.panel.isConnected) {
    geometryGesture.renderPending = true;
    return;
  }
  if (!page || infoPanelRuntimePane(runtime)?.mode === 'collapsed') {
    layer.replaceChildren();
    layer.hidden = true;
    return;
  }
  layer.hidden = false;
  syncInfoPanelEntriesForRuntime(runtime);
  const state = infoPanelStateForRuntime(runtime);
  const elements = orderedInfoPanelEntries(page, state?.panels || [])
    .map((entry) => createInfoPanelElement(runtime, page, entry));
  const temporaryBlockId = runtime.temporaryInfoBlockId;
  if (temporaryBlockId && infoPanelReadModeAvailable(runtime)
    && infoPanelText(page, 'block', temporaryBlockId)
    && !infoPanelEntry(runtime, 'block', temporaryBlockId)) {
    elements.push(createTemporaryBlockInfoPanel(
      runtime, page, temporaryBlockId, state?.panels || []
    ));
  }
  layer.replaceChildren(...elements);
  const textarea = runtime.infoPanelEditor
    ? layer.querySelector('.info-panel-editor') : null;
  if (textarea && activePaneRuntime() === runtime && document.activeElement !== textarea) {
    const editor = runtime.infoPanelEditor;
    const token = infoPanelRuntimeToken(runtime, {
      kind: editor.kind,
      ownerId: editor.ownerId,
      revision: editor.revision,
      includeMount: true
    });
    runtime.infoPanelFocusFrame = window.requestAnimationFrame(() => {
      runtime.infoPanelFocusFrame = null;
      if (activePaneRuntime() !== runtime || !textarea.isConnected
        || runtime.infoPanelEditor !== editor
        || !infoPanelRuntimeTokenIsCurrent(token, {
          requireOwner: true,
          requireRevision: true,
          requireMount: true
        })) return;
      textarea.focus();
      if (!Number.isFinite(editor.selectionOffset)) return;
      const start = Math.max(0, Math.min(editor.selectionOffset, textarea.value.length));
      const end = Number.isFinite(editor.selectionEnd)
        ? Math.max(start, Math.min(editor.selectionEnd, textarea.value.length))
        : start;
      textarea.setSelectionRange(start, end, editor.selectionDirection || 'none');
      editor.selectionOffset = null;
      editor.selectionEnd = null;
      editor.selectionDirection = null;
    });
  }
}

function renderInfoPanelsForPage(pageId) {
  for (const runtime of livingPaneRuntimes()) {
    if (runtime.session.activeTab()?.currentPageId === pageId) {
      renderInfoPanelsForRuntime(runtime);
    }
  }
}

function renderAllInfoPanels() {
  for (const runtime of livingPaneRuntimes()) renderInfoPanelsForRuntime(runtime);
}

function hideTemporaryBlockInfo(runtime) {
  if (!runtime?.temporaryInfoBlockId) return false;
  runtime.temporaryInfoBlockId = null;
  infoPanelLayerForRuntime(runtime)?.querySelector('.info-panel.is-temporary')?.remove();
  return true;
}

function hideAllTemporaryInfoPanels() {
  for (const runtime of livingPaneRuntimes()) {
    runtime.temporaryInfoBlockId = null;
    infoPanelLayerForRuntime(runtime)?.querySelector('.info-panel.is-temporary')?.remove();
  }
}

function pointerIsOverTemporaryInfoPanel(runtime, clientX, clientY) {
  if (infoPanelsSuspendedForRuntime(runtime)) return false;
  const temporary = infoPanelLayerForRuntime(runtime)?.querySelector(
    '.info-panel.is-temporary'
  );
  if (!temporary) return false;
  const rect = temporary.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right
    && clientY >= rect.top && clientY <= rect.bottom;
}

function temporaryInfoHoverOwnsPoint(runtime, blockId, relatedTarget, clientX, clientY) {
  if (infoPanelsSuspendedForRuntime(runtime)) return false;
  const relatedPanel = relatedTarget?.closest?.('.info-panel');
  if (relatedPanel) {
    return relatedPanel.classList.contains('is-temporary')
      && relatedPanel.dataset.infoPanelOwnerId === blockId;
  }
  if (activePaneRuntime() !== runtime
    || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false;
  }
  return resolveCanvasPointer(runtime, clientX, clientY)?.block?.id === blockId;
}

function textOffsetAtPoint(root, clientX, clientY) {
  let node = null;
  let offset = 0;
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(clientX, clientY);
    node = position?.offsetNode || null;
    offset = position?.offset || 0;
  } else if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(clientX, clientY);
    node = range?.startContainer || null;
    offset = range?.startOffset || 0;
  }
  if (!node || (node !== root && !root.contains(node))) return root.textContent.length;
  try {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, offset);
    return Math.max(0, Math.min(prefix.toString().length, root.textContent.length));
  } catch {
    return root.textContent.length;
  }
}

function promoteTemporaryBlockInfoPanel(runtime, blockId, panel, content, event) {
  if (infoPanelsSuspendedForRuntime(runtime)
    || runtime?.temporaryInfoBlockId !== blockId || !panel.isConnected) return false;
  const layer = infoPanelLayerForRuntime(runtime);
  const panelRect = panel.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  return beginInfoPanelEditing(runtime, 'block', blockId, {
    selectionOffset: textOffsetAtPoint(content, event.clientX, event.clientY),
    geometry: {
      x: panelRect.left - layerRect.left,
      y: panelRect.top - layerRect.top,
      width: panelRect.width,
      height: panelRect.height,
      autoPositioned: false
    }
  });
}

function showTemporaryBlockInfo(runtime, block) {
  const page = infoPanelPageForRuntime(runtime);
  if (!runtimeIsLive(runtime) || !block || !blockIsInteractive(runtime, block)
    || infoPanelsSuspendedForRuntime(runtime) || !infoPanelReadModeAvailable(runtime)
    || !infoPanelText(page, 'block', block.id)
    || infoPanelEntry(runtime, 'block', block.id)) {
    hideTemporaryBlockInfo(runtime);
    return false;
  }
  const layer = infoPanelLayerForRuntime(runtime);
  const existing = layer?.querySelector('.info-panel.is-temporary');
  if (runtime.temporaryInfoBlockId === block.id
    && existing?.dataset.infoPanelOwnerId === block.id) return true;
  existing?.remove();
  runtime.temporaryInfoBlockId = block.id;
  const state = infoPanelStateForRuntime(runtime);
  layer?.append(createTemporaryBlockInfoPanel(
    runtime, page, block.id, state?.panels || []
  ));
  return true;
}

function closeFixedBlockInfoPanel(runtime, blockId) {
  if (!runtimeIsLive(runtime) || infoPanelsSuspendedForRuntime(runtime)) return false;
  const gesture = infoPanelGeometryGestureForRuntime(runtime);
  if (gesture?.entry.kind === 'block' && gesture.entry.ownerId === blockId) {
    cancelInfoPanelGeometryGesture(runtime);
  }
  if (infoPanelEditorMatches(runtime, 'block', blockId)) cancelInfoPanelEditor(runtime);
  const removed = removeInfoPanelEntry(runtime, 'block', blockId);
  if (removed) {
    advanceInfoPanelEditorRevision(runtime);
    saveInfoPanelViewState(runtime);
  }
  renderInfoPanelsForRuntime(runtime);
  return removed;
}

function beginInfoPanelEditing(runtime, kind, ownerId, {
  selectionOffset = null,
  geometry = null
} = {}) {
  if (!runtimeIsLive(runtime)) return false;
  if (activePaneRuntime() !== runtime) runtime = activateInfoPanelRuntime(runtime);
  if (!runtime || infoPanelsSuspendedForRuntime(runtime) || !runtime.currentPage
    || runtime.blockEditMode || runtime.pageEditMode || runtime.highlightEditDraft
    || pageMetaModal || runtime.linkPickMode || runtime.addLinkInProgress) return false;
  ensureInfoPanelRuntimeState(runtime);
  if (runtime.infoPanelEditor
    && !infoPanelEditorMatches(runtime, kind, ownerId)) saveInfoPanelEditor(runtime);
  const page = infoPanelPageForRuntime(runtime);
  const owner = infoPanelOwner(page, kind, ownerId);
  const tab = runtime.session.activeTab();
  if (!owner || !tab) return false;
  hideAllTemporaryInfoPanels();
  const entry = ensureInfoPanelEntry(runtime, kind, ownerId, { bringToFront: true });
  if (entry && geometry) Object.assign(entry, geometry);
  const revision = advanceInfoPanelEditorRevision(runtime);
  const runtimeToken = infoPanelRuntimeToken(runtime, {
    kind,
    ownerId,
    revision,
    includeMount: true
  });
  runtime.infoPanelEditor = {
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    paneId: runtime.paneId,
    tabId: tab.id,
    pageId: page.id,
    kind,
    ownerId,
    originalText: infoPanelText(page, kind, ownerId),
    draftText: infoPanelText(page, kind, ownerId),
    selectionOffset,
    revision,
    runtimeToken,
    textarea: null
  };
  saveInfoPanelViewState(runtime);
  renderInfoPanelsForRuntime(runtime);
  return true;
}

function openBlockInfoEditor(runtime, blockId) {
  return beginInfoPanelEditing(runtime, 'block', blockId);
}

function openHighlightGroupInfoEditor(runtime, groupId) {
  setHighlightMenuOpen(runtime, false);
  return beginInfoPanelEditing(runtime, 'highlight', groupId);
}

function optimisticInfoPage(page, kind, ownerId, text) {
  if (kind === 'block') {
    return {
      ...page,
      blocks: (page.blocks || []).map((block) => (
        block.id === ownerId ? { ...block, info: text } : block
      ))
    };
  }
  return {
    ...page,
    highlightGroups: (page.highlightGroups || []).map((group) => (
      group.id === ownerId ? { ...group, info: text } : group
    ))
  };
}

function restoreFailedInfoPanelEditor(intent) {
  const pendingKey = `${intent?.pageId}:${infoPanelKey(intent?.kind, intent?.ownerId)}`;
  const runtime = intent?.runtime;
  if (!runtime || runtime.infoPanelEditor
    || !infoPanelRuntimeTokenIsCurrent(intent.runtimeToken, {
      requireOwner: true,
      requireRevision: true
    })
    || !infoPanelSaveIntentIsCurrent(intent)
    || pendingInfoPanelSaves.get(pendingKey) !== intent) return false;
  const tab = runtime.session?.tabById(intent.tabId);
  if (!tab || runtime.session.activeTab()?.id !== tab.id
    || tab.currentPageId !== intent.pageId) return false;
  const page = canonicalPages.get(intent.pageId);
  if (!page || !infoPanelOwner(page, intent.kind, intent.ownerId)) return false;
  const entry = ensureInfoPanelEntry(runtime, intent.kind, intent.ownerId);
  if (!entry) return false;
  if (intent.panelState) Object.assign(entry, intent.panelState, {
    kind: intent.kind,
    ownerId: intent.ownerId
  });
  runtime.infoPanelEditor = {
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    paneId: runtime.paneId,
    tabId: tab.id,
    pageId: intent.pageId,
    kind: intent.kind,
    ownerId: intent.ownerId,
    originalText: intent.previousText,
    draftText: intent.text,
    selectionOffset: intent.selectionOffset,
    revision: intent.revision,
    runtimeToken: intent.runtimeToken,
    retryIntent: intent,
    textarea: null
  };
  saveInfoPanelViewState(runtime);
  renderInfoPanelsForRuntime(runtime);
  return true;
}

function queueInfoTextSave(editor, text, previousText) {
  const runtime = editor.runtime;
  const revision = Number.isInteger(editor.revision)
    ? editor.revision
    : runtime?.infoPanelEditorRevision;
  const capturedRuntimeToken = infoPanelRuntimeToken(runtime, {
    kind: editor.kind,
    ownerId: editor.ownerId,
    revision,
    includeMount: true
  });
  const runtimeToken = capturedRuntimeToken?.tabId === editor.tabId
    && capturedRuntimeToken?.pageId === editor.pageId
    ? capturedRuntimeToken
    : null;
  const intent = {
    runtime,
    paneId: editor.paneId || null,
    tabId: editor.tabId || null,
    pageId: editor.pageId,
    kind: editor.kind,
    ownerId: editor.ownerId,
    text,
    previousText,
    revision,
    runtimeToken,
    panelState: editor.panelState ? { ...editor.panelState } : null,
    selectionOffset: Number.isFinite(editor.textarea?.selectionStart)
      ? editor.textarea.selectionStart
      : editor.selectionOffset,
    pageDeletionEpoch: infoPanelPageDeletionEpoch(editor.pageId),
    error: null
  };
  const intentKey = infoPanelKey(intent.kind, intent.ownerId);
  const pendingKey = `${intent.pageId}:${intentKey}`;
  pendingInfoPanelSaves.set(pendingKey, intent);
  const liveEditor = runtime?.infoPanelEditor;
  if (liveEditor?.retryIntent && liveEditor.revision === intent.revision
    && liveEditor.pageId === intent.pageId && liveEditor.kind === intent.kind
    && liveEditor.ownerId === intent.ownerId) {
    liveEditor.retryIntent = intent;
  }
  infoPanelSaveQueue = infoPanelSaveQueue.catch(() => {}).then(async () => {
    const latest = canonicalPages.get(intent.pageId);
    if (!latest || !infoPanelOwner(latest, intent.kind, intent.ownerId)) {
      if (pendingInfoPanelSaves.get(pendingKey) === intent) pendingInfoPanelSaves.delete(pendingKey);
      return { ok: true, skipped: true };
    }
    const nextPage = optimisticInfoPage(latest, intent.kind, intent.ownerId, intent.text);
    const body = intent.kind === 'block'
      ? { blocks: nextPage.blocks }
      : { highlightGroups: normalizedHighlightGroupsForClient(
        nextPage.highlightGroups,
        nextPage.blocks || []
      ) };
    try {
      const saved = await request(pageApiUrl(intent.pageId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!infoPanelSaveIntentIsCurrent(intent)) {
        if (pendingInfoPanelSaves.get(pendingKey) === intent) {
          pendingInfoPanelSaves.delete(pendingKey);
        }
        return { ok: true, skipped: true, discarded: true };
      }
      const canonical = commitCanonicalPage(saved, {
        originRuntime: runtime,
        preserveDocumentBody: true
      });
      if (pendingInfoPanelSaves.get(pendingKey) === intent) pendingInfoPanelSaves.delete(pendingKey);
      renderInfoPanelsForPage(intent.pageId);
      if (infoPanelRuntimeTokenIsCurrent(intent.runtimeToken, {
        requireRevision: true,
        requireMount: true
      })) {
        showRuntimeStatus(runtime, 'Saved', false, 1800);
      }
      return { ok: true, page: canonical };
    } catch (error) {
      intent.error = error.message || 'Info could not be saved.';
      if (!infoPanelSaveIntentIsCurrent(intent)) {
        if (pendingInfoPanelSaves.get(pendingKey) === intent) {
          pendingInfoPanelSaves.delete(pendingKey);
        }
        return { ok: false, error: intent.error, discarded: true };
      }
      const current = canonicalPages.get(intent.pageId);
      if (infoPanelText(current, intent.kind, intent.ownerId) === intent.text) {
        const rolledBack = optimisticInfoPage(
          current, intent.kind, intent.ownerId, intent.previousText
        );
        commitCanonicalPage(rolledBack, {
          originRuntime: runtime,
          preserveDocumentBody: true
        });
        renderInfoPanelsForPage(intent.pageId);
      }
      restoreFailedInfoPanelEditor(intent);
      if (infoPanelRuntimeTokenIsCurrent(intent.runtimeToken, {
        requireRevision: true,
        requireMount: true
      })) {
        showRuntimeStatus(runtime, intent.error, true);
      }
      return { ok: false, error: intent.error };
    }
  });
  return infoPanelSaveQueue;
}

function saveInfoPanelEditor(runtime) {
  const editor = runtime?.infoPanelEditor;
  if (!editor) return Promise.resolve(false);
  const revision = advanceInfoPanelEditorRevision(runtime);
  cancelInfoPanelGeometryGesture(runtime);
  const tab = runtime.session?.tabById(editor.tabId);
  const panelIdentity = tab ? {
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    tabId: tab.id,
    pageId: editor.pageId,
    kind: editor.kind,
    ownerId: editor.ownerId
  } : null;
  const livePanelState = infoPanelStateForIdentity(runtime, panelIdentity);
  const livePanelIndex = livePanelState?.panels.findIndex((panel) => (
    panel.kind === editor.kind && panel.ownerId === editor.ownerId
  )) ?? -1;
  const panelState = livePanelIndex >= 0
    ? { ...livePanelState.panels[livePanelIndex] }
    : null;
  const page = canonicalPages.get(editor.pageId) || infoPanelPageForRuntime(runtime);
  const text = String(editor.textarea?.value ?? editor.draftText ?? '');
  const previousText = editor.originalText;
  runtime.infoPanelEditor = null;
  if (!page || !infoPanelOwner(page, editor.kind, editor.ownerId)) {
    renderInfoPanelsForRuntime(runtime);
    return Promise.resolve(false);
  }
  const optimistic = optimisticInfoPage(page, editor.kind, editor.ownerId, text);
  commitCanonicalPage(optimistic, {
    originRuntime: runtime,
    preserveDocumentBody: true
  });
  const shouldRemovePanel = !text || (editor.kind === 'highlight'
    && !checkedHighlightGroupIdsForViewState(tab?.viewState).includes(editor.ownerId));
  if (shouldRemovePanel && livePanelState && livePanelIndex >= 0) {
    livePanelState.viewState.infoPanels.splice(livePanelIndex, 1);
    runtime.session.saveViewState(livePanelState.tab.id, { ...livePanelState.viewState });
  }
  renderInfoPanelsForPage(editor.pageId);
  return queueInfoTextSave({ ...editor, panelState, revision }, text, previousText);
}

function queueSuspendedInfoPanelEditorForSave(runtime) {
  const editor = runtime?.suspendedInfoPanelEditor;
  if (!editor) return false;
  runtime.suspendedInfoPanelEditor = null;
  if (runtime.infoPanelEditor && runtime.infoPanelEditor !== editor) {
    saveInfoPanelEditor(runtime);
  }
  runtime.infoPanelEditor = editor;
  saveInfoPanelEditor(runtime);
  return true;
}

function queueSuspendedInfoPanelEditorsForSave() {
  let queued = 0;
  for (const runtime of livingPaneRuntimes()) {
    if (queueSuspendedInfoPanelEditorForSave(runtime)) queued += 1;
  }
  return queued;
}

async function flushInfoPanelSavesNow() {
  // Queue every live draft synchronously before awaiting persistence. Strong
  // edit modes park their editor on the owning Pane so the UI can resume it;
  // shutdown must drain those parked drafts as well as the visible editor.
  for (const runtime of livingPaneRuntimes()) {
    if (runtime.infoPanelEditor) saveInfoPanelEditor(runtime);
  }
  queueSuspendedInfoPanelEditorsForSave();
  await infoPanelSaveQueue.catch(() => {});
  // A failed close-time save stays as an explicit retryable intent. A second
  // close attempt must retry the exact draft instead of silently accepting the
  // rolled-back canonical value.
  for (let pass = 0; pass < 2 && pendingInfoPanelSaves.size; pass += 1) {
    const pending = [...pendingInfoPanelSaves.values()];
    for (const intent of pending) {
      queueInfoTextSave(intent, intent.text, intent.previousText);
    }
    await infoPanelSaveQueue.catch(() => {});
  }
  if (pendingInfoPanelSaves.size) {
    const error = [...pendingInfoPanelSaves.values()]
      .map((intent) => intent.error)
      .find(Boolean) || 'Info could not be saved.';
    return { ok: false, error };
  }
  return { ok: true };
}

function discardInfoPanelSavesForPage(pageId) {
  if (typeof pageId !== 'string' || !pageId) return 0;
  infoPanelPageDeletionEpochs.set(pageId, infoPanelPageDeletionEpoch(pageId) + 1);
  let discarded = 0;
  for (const runtime of livingPaneRuntimes()) {
    if (runtime.infoPanelEditor?.pageId === pageId) {
      cancelInfoPanelGeometryGesture(runtime);
      runtime.infoPanelEditor = null;
      cancelInfoPanelFocusFrame(runtime);
      advanceInfoPanelEditorRevision(runtime);
      discarded += 1;
    }
    if (runtime.suspendedInfoPanelEditor?.pageId === pageId) {
      runtime.suspendedInfoPanelEditor = null;
      advanceInfoPanelEditorRevision(runtime);
      discarded += 1;
    }
  }
  for (const [key, intent] of pendingInfoPanelSaves) {
    if (intent.pageId !== pageId) continue;
    pendingInfoPanelSaves.delete(key);
    discarded += 1;
  }
  return discarded;
}

function cancelInfoPanelEditor(runtime) {
  const editor = runtime?.infoPanelEditor;
  if (!editor) return false;
  cancelInfoPanelGeometryGesture(runtime);
  cancelInfoPanelFocusFrame(runtime);
  runtime.infoPanelEditor = null;
  advanceInfoPanelEditorRevision(runtime);
  if (editor.retryIntent) {
    const pendingKey = `${editor.pageId}:${infoPanelKey(editor.kind, editor.ownerId)}`;
    if (pendingInfoPanelSaves.get(pendingKey) === editor.retryIntent) {
      pendingInfoPanelSaves.delete(pendingKey);
    }
  }
  const tab = runtime.session?.tabById(editor.tabId);
  if (tab && (!editor.originalText || (editor.kind === 'highlight'
    && !checkedHighlightGroupIdsForViewState(tab.viewState).includes(editor.ownerId)))) {
    removeInfoPanelEntry(runtime, editor.kind, editor.ownerId);
  }
  saveInfoPanelViewState(runtime);
  renderInfoPanelsForPage(editor.pageId);
  return true;
}

function prepareInfoPanelsForRuntimeContextChange(runtime, { persistGesture = true } = {}) {
  if (!runtime) return false;
  cancelInfoPanelGeometryGesture(runtime, { persist: persistGesture });
  cancelInfoPanelFocusFrame(runtime);
  hideTemporaryBlockInfo(runtime);
  if (runtime.infoPanelEditor) saveInfoPanelEditor(runtime);
  // Context changes run before strong edit modes are cancelled. Drain their
  // parked drafts now so the subsequent resume cannot restore an editor whose
  // textarea is about to be detached with the old Page or Tab.
  queueSuspendedInfoPanelEditorForSave(runtime);
  advanceInfoPanelEditorRevision(runtime);
  return true;
}

function disposeInfoPanelsForRuntime(runtime) {
  if (!runtime) return false;
  prepareInfoPanelsForRuntimeContextChange(runtime, { persistGesture: false });
  if (infoPanelGestureOwnerRuntime === runtime) infoPanelGestureOwnerRuntime = null;
  cancelInfoPanelFocusFrame(runtime);
  const layer = runtime.dom?.infoPanelLayer;
  if (layer) {
    layer.replaceChildren();
    layer.hidden = true;
  }
  runtime.infoPanelEditor = null;
  runtime.suspendedInfoPanelEditor = null;
  runtime.infoPanelGeometryGesture = null;
  runtime.infoPanelsSuspended = false;
  runtime.temporaryInfoBlockId = null;
  return true;
}

function syncHighlightInfoPanelsForRuntime(runtime) {
  if (!runtimeIsLive(runtime) || infoPanelsSuspendedForRuntime(runtime)) return;
  syncInfoPanelEntriesForRuntime(runtime);
  renderInfoPanelsForRuntime(runtime);
}

function pruneInfoPanelsForDeletedOwner(pageId, kind, ownerId) {
  for (const runtime of livingPaneRuntimes()) {
    const gesture = infoPanelGeometryGestureForRuntime(runtime);
    if (gesture?.entry.kind === kind && gesture.entry.ownerId === ownerId
      && infoPanelPageForRuntime(runtime)?.id === pageId) {
      cancelInfoPanelGeometryGesture(runtime);
    }
    if (runtime.infoPanelEditor?.pageId === pageId
      && runtime.infoPanelEditor.kind === kind
      && runtime.infoPanelEditor.ownerId === ownerId) {
      runtime.infoPanelEditor = null;
      cancelInfoPanelFocusFrame(runtime);
      advanceInfoPanelEditorRevision(runtime);
    }
    const suspendedEditor = runtime.suspendedInfoPanelEditor;
    if (suspendedEditor?.pageId === pageId && suspendedEditor.kind === kind
      && suspendedEditor.ownerId === ownerId) {
      runtime.suspendedInfoPanelEditor = null;
      advanceInfoPanelEditorRevision(runtime);
    }
    for (const tab of runtime.session.tabs()) {
      const viewStates = [];
      if (tab.currentPageId === pageId) viewStates.push(tab.viewState);
      if (tab.pageViewStates?.[pageId]) viewStates.push(tab.pageViewStates[pageId]);
      for (const viewState of new Set(viewStates)) {
        viewState.infoPanels = (viewState.infoPanels || []).filter((panel) => (
          !(panel.kind === kind && panel.ownerId === ownerId)
        ));
      }
    }
    if (runtime.session.activeTab()?.currentPageId === pageId) {
      renderInfoPanelsForRuntime(runtime);
    }
  }
}

globalThis.flushInfoPanelSavesNow = flushInfoPanelSavesNow;
globalThis.discardInfoPanelSavesForPage = discardInfoPanelSavesForPage;
