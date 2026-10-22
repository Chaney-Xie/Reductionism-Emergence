(function exposeSessionTabs(root, factory) {
  const structuredTextFrameModel = (() => {
    if (root?.structuredTextFrameModel) return root.structuredTextFrameModel;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./structuredTextFrame');
    }
    throw new Error('The shared structured-text frame model is unavailable.');
  })();
  const api = factory(structuredTextFrameModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.sessionTabsModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (structuredTextFrameModel) => {
  const MAX_MARKDOWN_STRUCTURAL_FOLDS = 2000;

  function normalizeMarkdownStructuralFolds(value) {
    if (!Array.isArray(value)) return [];
    const folds = [];
    const seen = new Set();
    for (const descriptor of value) {
      if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) continue;
      const kind = descriptor.kind === 'heading' || descriptor.kind === 'list'
        ? descriptor.kind : null;
      const lineIndex = Number.isInteger(descriptor.lineIndex) && descriptor.lineIndex >= 0
        ? descriptor.lineIndex : null;
      const depth = Number.isInteger(descriptor.depth) && descriptor.depth > 0
        ? descriptor.depth : null;
      if (!kind || lineIndex === null || depth === null) continue;
      const physicalLineId = typeof descriptor.physicalLineId === 'string'
        && descriptor.physicalLineId.length > 0
        ? descriptor.physicalLineId : null;
      const key = physicalLineId !== null
        ? `${kind}:physical:${physicalLineId}`
        : `${kind}:line:${lineIndex}:depth:${depth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      folds.push({ kind, physicalLineId, lineIndex, depth });
      if (folds.length >= MAX_MARKDOWN_STRUCTURAL_FOLDS) break;
    }
    return folds;
  }

  function defaultViewState() {
    return {
      panX: 0,
      panY: 0,
      zoom: 1,
      viewportInitialized: false,
      checkedHighlightGroupIds: [],
      activeHighlightGroupId: null,
      highlightDisplayState: { enabled: false, dimmed: false },
      infoPanels: [],
      infoPanelZCounter: 0,
      markdownStructuralFolds: []
    };
  }

  function cloneInfoPanels(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const panels = [];
    for (const panel of value) {
      const kind = panel?.kind === 'highlight' ? 'highlight'
        : panel?.kind === 'block' ? 'block' : null;
      const ownerId = typeof panel?.ownerId === 'string' ? panel.ownerId : '';
      const key = `${kind}:${ownerId}`;
      if (!kind || !ownerId || seen.has(key)) continue;
      seen.add(key);
      panels.push({
        kind,
        ownerId,
        x: Number.isFinite(panel.x) ? panel.x : 16,
        y: Number.isFinite(panel.y) ? panel.y : 16,
        width: Number.isFinite(panel.width) && panel.width > 0 ? panel.width : 320,
        height: Number.isFinite(panel.height) && panel.height > 0 ? panel.height : 220,
        z: Number.isFinite(panel.z) ? panel.z : panels.length + 1,
        minimized: kind === 'highlight' && panel.minimized === true,
        autoPositioned: panel.autoPositioned !== false
      });
    }
    return panels;
  }

  function cloneViewState(value = {}) {
    const defaults = defaultViewState();
    const source = structuredTextFrameModel.migrateLegacyFrameViewState(value);
    return {
      ...defaults,
      ...source,
      checkedHighlightGroupIds: [...new Set(
        (Array.isArray(source.checkedHighlightGroupIds) ? source.checkedHighlightGroupIds : [])
          .filter((groupId) => typeof groupId === 'string' && groupId)
      )],
      highlightDisplayState: {
        ...defaults.highlightDisplayState,
        ...(source.highlightDisplayState || {})
      },
      infoPanels: cloneInfoPanels(source.infoPanels),
      infoPanelZCounter: Number.isFinite(source.infoPanelZCounter)
        ? Math.max(0, source.infoPanelZCounter)
        : 0,
      markdownStructuralFolds: normalizeMarkdownStructuralFolds(
        source.markdownStructuralFolds
      )
    };
  }

  function createTabSession({ createId = null } = {}) {
    let tabs = [];
    let activeTabId = null;
    let idSequence = 0;
    let activitySequence = 0;
    const nextId = () => createId?.() || `tab_${Date.now().toString(36)}_${++idSequence}`;

    function tabById(tabId) {
      return tabs.find((tab) => tab.id === tabId) || null;
    }

    function activeTab() {
      return tabById(activeTabId);
    }

    function createTab(pageId = null, { activate = true, insertionIndex = null } = {}) {
      const hasPage = typeof pageId === 'string' && Boolean(pageId);
      const tab = {
        id: nextId(),
        currentPageId: hasPage ? pageId : null,
        history: hasPage ? [pageId] : [],
        historyIndex: hasPage ? 0 : -1,
        viewState: defaultViewState(),
        pageViewStates: {},
        lastActiveSequence: 0
      };
      const index = Number.isInteger(insertionIndex)
        ? Math.min(tabs.length, Math.max(0, insertionIndex))
        : tabs.length;
      tabs.splice(index, 0, tab);
      if (activate) activateTab(tab.id);
      return tab;
    }

    function activateTab(tabId) {
      const tab = tabById(tabId);
      if (!tab) return null;
      activeTabId = tab.id;
      tab.lastActiveSequence = ++activitySequence;
      return tab;
    }

    function reset(pageId = null) {
      tabs = [];
      activeTabId = null;
      return createTab(pageId);
    }

    function saveViewState(tabId, viewState) {
      const tab = tabById(tabId);
      if (!tab) return false;
      tab.viewState = cloneViewState(viewState);
      if (tab.currentPageId) tab.pageViewStates[tab.currentPageId] = cloneViewState(viewState);
      return true;
    }

    function viewStateForPage(tab, pageId) {
      return cloneViewState(tab?.pageViewStates?.[pageId] || defaultViewState());
    }

    function navigate(tab, pageId, { mode = 'push', historyIndex = null } = {}) {
      if (!tab || typeof pageId !== 'string' || !pageId) return false;
      if (mode === 'push') {
        if (tab.currentPageId === pageId) return false;
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(pageId);
        tab.historyIndex = tab.history.length - 1;
      } else if (mode === 'back-forward') {
        if (!Number.isInteger(historyIndex) || tab.history[historyIndex] !== pageId) return false;
        tab.historyIndex = historyIndex;
      } else if (mode === 'replace') {
        tab.history = [pageId];
        tab.historyIndex = 0;
        tab.pageViewStates = {};
      } else if (mode !== 'preserve') return false;
      tab.currentPageId = pageId;
      tab.viewState = mode === 'replace'
        ? defaultViewState()
        : viewStateForPage(tab, pageId);
      return true;
    }

    function navigateActive(pageId, options) {
      return navigate(activeTab(), pageId, options);
    }

    function historyTarget(direction, pageExists, fromIndex = activeTab()?.historyIndex) {
      const tab = activeTab();
      if (!tab || typeof pageExists !== 'function' || !Number.isInteger(fromIndex)) return null;
      const step = direction < 0 ? -1 : 1;
      for (let index = fromIndex + step; index >= 0 && index < tab.history.length; index += step) {
        if (pageExists(tab.history[index])) return { pageId: tab.history[index], index };
      }
      return null;
    }

    function mostRecentTabForPage(pageId) {
      return tabs
        .filter((tab) => tab.currentPageId === pageId)
        .sort((left, right) => right.lastActiveSequence - left.lastActiveSequence)[0] || null;
    }

    function closeTab(tabId, { ensureEmptyTab = true } = {}) {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return null;
      const wasActive = activeTabId === tabId;
      tabs.splice(index, 1);
      if (!tabs.length) {
        activeTabId = null;
        return ensureEmptyTab ? createTab(null) : null;
      }
      if (!wasActive) return activeTab();
      return activateTab(tabs[Math.max(0, index - 1)]?.id || tabs[0].id);
    }

    function extractTab(tabId, { ensureEmptyTab = true } = {}) {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return null;
      const wasActive = activeTabId === tabId;
      const [tab] = tabs.splice(index, 1);
      if (!tabs.length) {
        activeTabId = null;
        if (ensureEmptyTab) createTab(null);
      } else if (wasActive) {
        activateTab(tabs[Math.max(0, index - 1)]?.id || tabs[0].id);
      }
      return tab;
    }

    function insertTab(tab, { activate = true, insertionIndex = null } = {}) {
      if (!tab || typeof tab.id !== 'string' || !tab.id || tabById(tab.id)) return null;
      const index = Number.isInteger(insertionIndex)
        ? Math.min(tabs.length, Math.max(0, insertionIndex))
        : tabs.length;
      tabs.splice(index, 0, tab);
      if (activate) activateTab(tab.id);
      return tab;
    }

    function reorderTab(tabId, insertionIndex) {
      const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
      if (fromIndex < 0 || !Number.isInteger(insertionIndex)) return false;
      const toIndex = Math.min(tabs.length - 1, Math.max(0, insertionIndex));
      if (fromIndex === toIndex) return false;
      const [tab] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, tab);
      return true;
    }

    function placePagesContiguously(pageIds, {
      insertionIndex = tabs.length,
      activePageId = null
    } = {}) {
      const orderedPageIds = [...new Set((Array.isArray(pageIds) ? pageIds : [])
        .filter((pageId) => typeof pageId === 'string' && pageId))];
      if (!orderedPageIds.length) {
        return { placedTabs: [], createdTabIds: [], activeTab: activeTab() };
      }
      const originalTabs = [...tabs];
      const reusableTabs = new Map();
      for (const pageId of orderedPageIds) {
        const tab = mostRecentTabForPage(pageId);
        if (tab) reusableTabs.set(pageId, tab);
      }
      const reusableIds = new Set([...reusableTabs.values()].map((tab) => tab.id));
      const requestedIndex = Number.isInteger(insertionIndex)
        ? Math.max(0, Math.min(originalTabs.length, insertionIndex))
        : originalTabs.length;
      const removedBeforeTarget = originalTabs
        .slice(0, requestedIndex)
        .filter((tab) => reusableIds.has(tab.id)).length;
      let nextIndex = requestedIndex - removedBeforeTarget;
      for (const tab of reusableTabs.values()) {
        extractTab(tab.id, { ensureEmptyTab: false });
      }
      const placedTabs = [];
      const createdTabIds = [];
      for (const pageId of orderedPageIds) {
        const reusable = reusableTabs.get(pageId);
        const tab = reusable
          ? insertTab(reusable, { activate: false, insertionIndex: nextIndex })
          : createTab(pageId, { activate: false, insertionIndex: nextIndex });
        if (!reusable && tab) createdTabIds.push(tab.id);
        if (tab) placedTabs.push(tab);
        nextIndex += 1;
      }
      const preferredIndex = orderedPageIds.indexOf(activePageId);
      const preferredTab = placedTabs[preferredIndex] || placedTabs[0] || null;
      if (preferredTab) activateTab(preferredTab.id);
      return { placedTabs, createdTabIds, activeTab: preferredTab };
    }

    return Object.freeze({
      activateTab,
      activeTab,
      closeTab,
      createTab,
      extractTab,
      historyTarget,
      insertTab,
      mostRecentTabForPage,
      navigateActive,
      placePagesContiguously,
      reorderTab,
      reset,
      saveViewState,
      tabById,
      tabs: () => [...tabs]
    });
  }

  return Object.freeze({
    createTabSession,
    defaultViewState,
    normalizeMarkdownStructuralFolds
  });
}));
