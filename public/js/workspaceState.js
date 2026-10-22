/* Stable per-vault workspace restoration. Transient interaction state is never collected. */
const WORKSPACE_STATE_SAVE_DELAY = 180;

let workspaceStateReady = false;
let workspaceStateSaveTimer = null;
let workspaceStateSaveQueue = Promise.resolve();
let restoredWorkspacePageViewStates = {};

function desktopWorkspaceStateAvailable() {
  const bridge = window.cneDesktop;
  return bridge?.isDesktop === true
    && typeof bridge.getWorkspaceState === 'function'
    && typeof bridge.setWorkspaceState === 'function';
}

async function loadWorkspaceState() {
  if (!desktopWorkspaceStateAvailable()) return { exists: false, workspaceState: null };
  try {
    const result = await window.cneDesktop.getWorkspaceState();
    if (result?.ok === false) throw new Error(result.error || 'Workspace state could not be loaded.');
    return {
      exists: result?.exists === true,
      workspaceState: workspaceStateModel.normalizeWorkspaceState(result?.workspaceState)
    };
  } catch {
    return { exists: false, workspaceState: null };
  }
}

function workspaceCategoryItemIds() {
  const ids = new Set();
  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'item' && typeof node.id === 'string') ids.add(node.id);
      else visit(node.children);
    }
  };
  visit(categoryRoots());
  return ids;
}

function workspaceCategoryGroupIds() {
  return new Set(categoryRoots().map((root) => root.id || root.label || 'category-group'));
}

function replaceSetFromValidIds(target, values, validIds) {
  target.clear();
  for (const value of values || []) {
    if (validIds.has(value)) target.add(value);
  }
}

function restoreWorkspaceState(saved) {
  if (!saved?.exists) return null;
  const state = workspaceStateModel.normalizeWorkspaceState(saved.workspaceState);

  leftSidebarOpen = state.leftSidebarOpen;
  rightSidebarOpen = state.rightSidebarOpen;
  leftSidebarExpandedWidth = state.leftSidebarWidth;
  rightSidebarExpandedWidth = state.rightSidebarWidth;
  descriptorSearchOpen = state.searchPanelOpen;
  descriptorSearchText = state.searchText;
  filterPanelOpen = state.categoryFilterPanelOpen;
  externalLinkTargetMode = state.externalLinkTargetMode;
  rightSidebarView = state.rightSidebarView;
  for (const [sectionId, height] of Object.entries(state.rightSectionHeights)) {
    if (workspaceStateModel.RIGHT_SECTION_IDS.has(sectionId)) {
      rightSectionHeights.set(sectionId, height);
    }
  }

  replaceSetFromValidIds(
    selectedCategoryFilterIds,
    state.selectedCategoryFilterIds,
    workspaceCategoryItemIds()
  );
  replaceSetFromValidIds(
    collapsedCategoryFilterGroupIds,
    state.collapsedCategoryFilterGroupIds,
    workspaceCategoryGroupIds()
  );
  categoryFilterGroupsInitialized = true;
  restoredWorkspacePageViewStates = { ...state.pageViewStates };

  collapsedRightSectionIds.clear();
  for (const sectionId of state.collapsedRightSectionIds) {
    if (workspaceStateModel.RIGHT_SECTION_IDS.has(sectionId)) collapsedRightSectionIds.add(sectionId);
  }

  restoreSidebarExpandedWidth('left');
  restoreSidebarExpandedWidth('right');
  return state;
}

function collectWorkspaceState() {
  if (typeof saveActiveTabViewState === 'function') saveActiveTabViewState();
  const pageViewStates = {};
  const validPageIds = new Set((pageIndex?.pages || []).map((page) => page.id));
  const panes = typeof workspace !== 'undefined' && Array.isArray(workspace?.state?.panes)
    ? workspace.state.panes : [];
  const activePane = typeof getActivePane === 'function' ? getActivePane() : null;
  const orderedPanes = [
    ...panes.filter((pane) => pane !== activePane),
    ...(activePane ? [activePane] : [])
  ];
  for (const pane of orderedPanes) {
    for (const tab of pane?.session?.tabs?.() || []) {
      for (const [pageId, viewState] of Object.entries(tab.pageViewStates || {})) {
        if (validPageIds.has(pageId)) pageViewStates[pageId] = viewState;
      }
      if (validPageIds.has(tab.currentPageId)) pageViewStates[tab.currentPageId] = tab.viewState;
    }
  }
  return workspaceStateModel.normalizeWorkspaceState({
    leftSidebarOpen,
    rightSidebarOpen,
    leftSidebarWidth: leftSidebarExpandedWidth,
    rightSidebarWidth: rightSidebarExpandedWidth,
    searchPanelOpen: descriptorSearchOpen,
    searchText: descriptorSearchText,
    categoryFilterPanelOpen: filterPanelOpen,
    selectedCategoryFilterIds: [...selectedCategoryFilterIds],
    collapsedCategoryFilterGroupIds: [...collapsedCategoryFilterGroupIds],
    externalLinkTargetMode,
    rightSidebarView,
    rightSectionHeights: Object.fromEntries(rightSectionHeights),
    collapsedRightSectionIds: [...collapsedRightSectionIds],
    pageViewStates
  });
}

function applyRestoredPageViewState(tab, pageId) {
  if (!tab || !pageId) return false;
  const restored = restoredWorkspacePageViewStates[pageId];
  if (!restored) return false;
  // A persisted Page view is a one-shot startup restoration, not a global
  // default for every new Tab opened later in this renderer. Consume it even
  // when the current Tab already owns a newer session-local state so the stale
  // startup snapshot cannot leak into a subsequently created Tab.
  delete restoredWorkspacePageViewStates[pageId];
  if (tab.pageViewStates?.[pageId]) return false;
  const normalized = workspaceStateModel.normalizePageViewState(restored);
  tab.pageViewStates[pageId] = normalized;
  if (tab.currentPageId === pageId) tab.viewState = normalized;
  return true;
}

function queueWorkspaceStateSave(snapshot, { reportErrors = true } = {}) {
  if (!desktopWorkspaceStateAvailable()) return Promise.resolve({ ok: true });
  const operation = workspaceStateSaveQueue
    .catch(() => {})
    .then(async () => {
      const result = await window.cneDesktop.setWorkspaceState(snapshot);
      if (result?.ok === false) throw new Error(result.error || 'Workspace state could not be saved.');
      return result;
    });
  workspaceStateSaveQueue = operation;
  return operation.catch((error) => {
    if (reportErrors && typeof showStatus === 'function') showStatus(error.message, true, 2200);
    return { ok: false, error: error.message };
  });
}

function scheduleWorkspaceStateSave() {
  if (!workspaceStateReady || !desktopWorkspaceStateAvailable()) return;
  if (workspaceStateSaveTimer !== null) clearTimeout(workspaceStateSaveTimer);
  workspaceStateSaveTimer = setTimeout(() => {
    workspaceStateSaveTimer = null;
    queueWorkspaceStateSave(collectWorkspaceState());
  }, WORKSPACE_STATE_SAVE_DELAY);
}

async function flushWorkspaceStateNow() {
  const requireSuccessfulFlush = (label, result) => {
    if (result !== false && result?.ok !== false) return;
    throw new Error(result?.error || `${label} could not be saved.`);
  };
  try {
    if (typeof globalThis.flushInfoPanelSavesNow === 'function') {
      requireSuccessfulFlush('Info', await globalThis.flushInfoPanelSavesNow());
    }
    if (typeof globalThis.flushMarkdownBodySavesNow === 'function') {
      requireSuccessfulFlush('Markdown text', await globalThis.flushMarkdownBodySavesNow());
    }
    if (typeof globalThis.flushHnPageDocumentSessionsNow === 'function') {
      requireSuccessfulFlush(
        'HN Text', await globalThis.flushHnPageDocumentSessionsNow()
      );
    }
    if (typeof globalThis.flushPageTitleSavesNow === 'function') {
      requireSuccessfulFlush('Page title', await globalThis.flushPageTitleSavesNow());
    } else if (typeof globalThis.flushMarkdownTitleSavesNow === 'function') {
      requireSuccessfulFlush('Page title', await globalThis.flushMarkdownTitleSavesNow());
    }
    if (typeof globalThis.flushMarkdownPreferenceSavesNow === 'function') {
      requireSuccessfulFlush(
        'Markdown preferences', await globalThis.flushMarkdownPreferenceSavesNow()
      );
    }
    if (typeof globalThis.flushVaultAppearanceSavesNow === 'function') {
      requireSuccessfulFlush(
        'Vault Appearance', await globalThis.flushVaultAppearanceSavesNow()
      );
    }
    if (typeof globalThis.flushNavigationSortModeSavesNow === 'function') {
      await globalThis.flushNavigationSortModeSavesNow();
    }
    if (workspaceStateSaveTimer !== null) {
      clearTimeout(workspaceStateSaveTimer);
      workspaceStateSaveTimer = null;
    }
    if (!workspaceStateReady || !desktopWorkspaceStateAvailable()) return { ok: true };
    const result = await queueWorkspaceStateSave(collectWorkspaceState(), { reportErrors: false });
    requireSuccessfulFlush('Workspace state', result);
    return { ok: true };
  } catch (error) {
    const message = error.message || 'Pending changes could not be saved.';
    if (typeof showStatus === 'function') showStatus(message, true, 4000);
    return { ok: false, error: message };
  }
}

function enableWorkspaceStatePersistence() {
  workspaceStateReady = desktopWorkspaceStateAvailable();
}

globalThis.flushWorkspaceStateNow = flushWorkspaceStateNow;
globalThis.applyRestoredPageViewState = applyRestoredPageViewState;
