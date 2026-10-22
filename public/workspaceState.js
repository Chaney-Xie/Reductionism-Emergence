(function exposeWorkspaceState(root, factory) {
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
  else root.workspaceStateModel = api;
}(typeof globalThis === 'object' ? globalThis : this, (structuredTextFrameModel) => {
  const DEFAULT_SIDEBAR_WIDTH = 220;
  const DEFAULT_RIGHT_SECTION_IDS = Object.freeze(['maintenance', 'category', 'descriptor']);
  const RIGHT_SECTION_IDS = new Set([
    'maintenance', 'external-links', 'category', 'descriptor', 'relations'
  ]);
  const RIGHT_SIDEBAR_VIEWS = new Set(['relations', 'resources']);
  const MAX_MARKDOWN_STRUCTURAL_FOLDS = 2000;

  function normalizedIdentifier(value) {
    if (typeof value !== 'string') return null;
    const identifier = value.trim();
    return identifier && identifier.length <= 256 ? identifier : null;
  }

  function normalizeIdentifierList(value, { allowed } = {}) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const item of value) {
      const identifier = normalizedIdentifier(item);
      if (!identifier || seen.has(identifier) || (allowed && !allowed.has(identifier))) continue;
      seen.add(identifier);
      result.push(identifier);
      if (result.length >= 1000) break;
    }
    return result;
  }

  function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function normalizeSidebarWidth(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_SIDEBAR_WIDTH;
  }

  function normalizeRightSidebarView(value) {
    return RIGHT_SIDEBAR_VIEWS.has(value) ? value : 'relations';
  }

  function normalizeExternalLinkTargetMode(value) {
    return value === 'file' ? 'file' : 'url';
  }

  function normalizeRightSectionHeights(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const sectionId of RIGHT_SECTION_IDS) {
      const height = value[sectionId];
      if (typeof height !== 'number' || !Number.isFinite(height)) continue;
      result[sectionId] = Math.max(64, Math.min(10000, height));
    }
    return result;
  }

  function normalizeInfoPanels(value) {
    if (!Array.isArray(value)) return [];
    const panels = [];
    const seen = new Set();
    for (const panel of value) {
      const kind = panel?.kind === 'block' || panel?.kind === 'highlight' ? panel.kind : null;
      const ownerId = normalizedIdentifier(panel?.ownerId);
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
      if (panels.length >= 1000) break;
    }
    return panels;
  }

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

  function normalizePageViewState(value) {
    const source = structuredTextFrameModel.migrateLegacyFrameViewState(value);
    return {
      panX: Number.isFinite(source.panX) ? source.panX : 0,
      panY: Number.isFinite(source.panY) ? source.panY : 0,
      zoom: Number.isFinite(source.zoom) && source.zoom > 0 ? source.zoom : 1,
      viewportInitialized: source.viewportInitialized === true,
      checkedHighlightGroupIds: normalizeIdentifierList(source.checkedHighlightGroupIds),
      activeHighlightGroupId: normalizedIdentifier(source.activeHighlightGroupId),
      highlightDisplayState: {
        enabled: source.highlightDisplayState?.enabled === true,
        dimmed: source.highlightDisplayState?.dimmed === true
      },
      infoPanels: normalizeInfoPanels(source.infoPanels),
      infoPanelZCounter: Number.isFinite(source.infoPanelZCounter)
        ? Math.max(0, source.infoPanelZCounter) : 0,
      markdownStructuralFolds: normalizeMarkdownStructuralFolds(
        source.markdownStructuralFolds
      )
    };
  }

  function normalizePageViewStates(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const states = {};
    for (const [rawPageId, viewState] of Object.entries(value)) {
      const pageId = normalizedIdentifier(rawPageId);
      if (!pageId || Object.hasOwn(states, pageId)) continue;
      states[pageId] = normalizePageViewState(viewState);
      if (Object.keys(states).length >= 1000) break;
    }
    return states;
  }

  function normalizeWorkspaceState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      version: 1,
      leftSidebarOpen: normalizeBoolean(source.leftSidebarOpen, true),
      rightSidebarOpen: normalizeBoolean(source.rightSidebarOpen, true),
      leftSidebarWidth: normalizeSidebarWidth(source.leftSidebarWidth),
      rightSidebarWidth: normalizeSidebarWidth(source.rightSidebarWidth),
      searchPanelOpen: normalizeBoolean(source.searchPanelOpen, false),
      searchText: typeof source.searchText === 'string' ? source.searchText.slice(0, 2048) : '',
      categoryFilterPanelOpen: normalizeBoolean(source.categoryFilterPanelOpen, false),
      selectedCategoryFilterIds: normalizeIdentifierList(source.selectedCategoryFilterIds),
      collapsedCategoryFilterGroupIds: normalizeIdentifierList(source.collapsedCategoryFilterGroupIds),
      externalLinkTargetMode: normalizeExternalLinkTargetMode(source.externalLinkTargetMode),
      rightSidebarView: normalizeRightSidebarView(source.rightSidebarView),
      rightSectionHeights: normalizeRightSectionHeights(source.rightSectionHeights),
      collapsedRightSectionIds: Array.isArray(source.collapsedRightSectionIds)
        ? normalizeIdentifierList(source.collapsedRightSectionIds, { allowed: RIGHT_SECTION_IDS })
        : [...DEFAULT_RIGHT_SECTION_IDS],
      pageViewStates: normalizePageViewStates(source.pageViewStates)
    };
  }

  return {
    DEFAULT_RIGHT_SECTION_IDS,
    DEFAULT_SIDEBAR_WIDTH,
    RIGHT_SECTION_IDS,
    RIGHT_SIDEBAR_VIEWS,
    normalizeIdentifierList,
    normalizeExternalLinkTargetMode,
    normalizeMarkdownStructuralFolds,
    normalizePageViewState,
    normalizePageViewStates,
    normalizeRightSectionHeights,
    normalizeRightSidebarView,
    normalizeWorkspaceState
  };
}));
